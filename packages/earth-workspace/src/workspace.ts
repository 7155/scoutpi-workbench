import { createHash, randomUUID } from "node:crypto";
import { access, appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { compileInvestigation, getEarthRuntimeContract, listEarthRuntimeContracts, searchCatalog, validateAdapterPack, validateDatasetDescriptor, validateInvestigationSpec, type AdapterVerification, type DatasetDescriptor, type EarthAdapterPack, type EarthJob, type EarthLocalExportRequest, type EarthSkillDefinition, type EarthStoryArtifact, type EarthVisualization, type InvestigationPlan, type InvestigationSpec } from "../../earth-investigation-core/src/index.ts";
import { EarthBackendRegistry, type EarthBackendExecution, type EarthBackendManifest, type EarthBackendProbe, type EarthBackendProgress, type EarthBackendProvider } from "../../earth-backend-sdk/src/index.ts";
import { RuntimeTelemetryStore, type RuntimeTelemetryEvent, type RuntimeTelemetrySummary } from "../../runtime-telemetry/src/index.ts";
import { ApprovalStore, type RuntimeApproval } from "../../runtime-governance/src/index.ts";
import { EvidenceStore, type BrowserEvidenceRecord, type EvidenceBinding, type EvidenceGraph } from "../../runtime-evidence/src/index.ts";
import { AgentRunStore, type AgentRunSummary } from "../../runtime-observability/src/index.ts";
import { compileEarthWorkflow, earthWorkflowFingerprint, instantiateWorkflowSpec, type EarthWorkflowReplayRecord, type StoredEarthWorkflow } from "../../earth-workflow-compiler/src/index.ts";
import { createBuiltinBackendProviders } from "./backends.ts";
import { renderEarthSkill, validateEarthSkill } from "./registry.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readJson<T>(path: string): Promise<T> { return JSON.parse(await readFile(path, "utf8")) as T; }
async function writeJson(path: string, value: unknown): Promise<void> { await mkdir(dirname(path), { recursive: true }); await writeFile(path, `${JSON.stringify(value, null, 2)}\n`); }

function safeId(value: string, label: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,100}$/i.test(value)) throw Object.assign(new Error(`${label} is invalid`), { code: "INVALID_ID" });
  return value;
}

type EarthTaskStatus = { state?: string; error_message?: string; errorMessage?: string; [key: string]: unknown };

export interface RegisteredEarthAdapter {
  adapter: DatasetDescriptor;
  revision: number;
  fingerprint: string;
  registeredAt: string;
  source: "pi" | "human" | "import" | "example";
  enabled: boolean;
  verification: AdapterVerification;
}

function normalizeRegisteredAdapter(row: RegisteredEarthAdapter): RegisteredEarthAdapter {
  return {
    ...row,
    enabled: row.enabled !== false,
    verification: row.verification ?? { status: "not_run" },
  };
}

export function deriveEarthJobState(tasks: EarthTaskStatus[], fallback: EarthJob["state"] = "running"): EarthJob["state"] {
  if (!tasks.length) return fallback;
  const states = tasks.map((task) => String(task.state || "UNKNOWN").toUpperCase());
  if (states.some((state) => state === "FAILED")) return "failed";
  if (states.some((state) => state === "CANCELLED" || state === "CANCEL_REQUESTED")) return "cancelled";
  if (states.every((state) => state === "COMPLETED")) return "completed";
  return "running";
}

function replayStateFromJob(state: EarthJob["state"]): EarthWorkflowReplayRecord["state"] {
  if (state === "completed") return "completed";
  if (state === "cancelled") return "cancelled";
  if (state === "failed") return "failed";
  if (state === "blocked_auth") return "blocked";
  return "running";
}

function normalizeStoredWorkflow(stored: StoredEarthWorkflow & { immediateSuccessCount?: number }): StoredEarthWorkflow {
  return {
    ...stored,
    stage: stored.stage ?? "ready",
    successCount: stored.successCount ?? stored.immediateSuccessCount ?? 0,
  };
}

function automaticWorkflowId(investigationId: string): string {
  const normalized = investigationId.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `auto-${normalized || "investigation"}`.slice(0, 100);
}

export class EarthWorkspace {
  readonly root: string;
  readonly python: string;
  readonly worker: string;
  readonly skillPublishRoot: string;
  readonly backendRegistry: EarthBackendRegistry;
  readonly telemetry: RuntimeTelemetryStore;
  readonly approvals: ApprovalStore;
  readonly agentRuns: AgentRunStore;
  readonly evidence: EvidenceStore;
  private readonly activeWorkers = new Map<string, ReturnType<typeof spawn>>();
  private readonly activeLocalExports = new Map<string, Promise<void>>();
  private readonly visualizationCache = new Map<string, { value: EarthVisualization; expiresAt: number }>();

  constructor(root = process.env.SCOUTPI_EARTH_ROOT ?? ".scoutpi/earth_workspace", python = process.env.SCOUTPI_EARTH_PYTHON ?? resolve(".venv/bin/python"), skillPublishRoot = process.env.SCOUTPI_SKILL_PUBLISH_ROOT ?? resolve(".pi", "skills"), backendProviders: EarthBackendProvider[] = []) {
    this.root = resolve(root);
    this.python = python;
    this.worker = join(packageRoot, "python", "worker.py");
    this.skillPublishRoot = resolve(skillPublishRoot);
    this.telemetry = new RuntimeTelemetryStore(this.root);
    this.approvals = new ApprovalStore(this.root);
    this.agentRuns = new AgentRunStore(process.env.SCOUTPI_RUNS_ROOT ?? join(dirname(this.root), "runs"));
    this.evidence = new EvidenceStore(process.env.SCOUTPI_EVIDENCE_ROOT ?? join(dirname(this.root), "evidence"));
    this.backendRegistry = new EarthBackendRegistry([
      ...createBuiltinBackendProviders(async (payload, workerId, signal) => await this.callWorker(payload, workerId, signal)),
      ...backendProviders,
    ]);
  }

  async init(): Promise<void> {
    await Promise.all(["plans", "jobs", "recipes", "stories", "analysis", "adapters", "skills", "workflows", "workflow_runs"].map((name) => mkdir(join(this.root, name), { recursive: true })));
    await this.telemetry.init();
    await this.approvals.init();
    await this.agentRuns.init();
    await this.evidence.init();
  }

  async recoverInterruptedJobs(): Promise<{ recovered: number; jobIds: string[] }> {
    await this.init();
    const jobIds: string[] = [];
    for (const job of await this.listJobs()) {
      if (job.state !== "running" || job.result?.execution !== "local_export" || this.activeWorkers.has(job.jobId)) continue;
      job.state = "failed";
      job.updatedAt = new Date().toISOString();
      job.error = "LOCAL_EXPORT_INTERRUPTED: the local worker is not attached to this runtime; retry the persisted export request.";
      job.result = { ...(job.result || {}), recovery: { retryable: true, detectedAt: job.updatedAt } };
      await writeJson(join(job.artifactDir, "job.json"), job);
      jobIds.push(job.jobId);
    }
    return { recovered: jobIds.length, jobIds };
  }

  async catalogSearch(input: { query: string; role?: string; year?: number; limit?: number }) {
    const registry = (await this.listAdapters()).filter((row) => row.enabled).map((row) => row.adapter);
    return { datasets: searchCatalog(registry, input.query, input.role, input.year, input.limit), registeredAdapters: registry.length, source: "ScoutPi workspace adapter registry", artifactPolicy: "Dataset metadata is compact; execution results are artifactized." };
  }

  contract(name?: string): Record<string, unknown> {
    if (!name) return { contracts: listEarthRuntimeContracts() };
    return getEarthRuntimeContract(name);
  }

  listBackendManifests(): EarthBackendManifest[] {
    return this.backendRegistry.manifests();
  }

  async probeBackend(backendId: string, signal?: AbortSignal): Promise<EarthBackendProbe> {
    return await this.backendRegistry.probe(backendId, { workspaceRoot: this.root, signal });
  }

  async telemetrySummary(limit?: number): Promise<RuntimeTelemetrySummary> {
    return await this.telemetry.summary(limit);
  }

  async recentTelemetry(limit?: number): Promise<RuntimeTelemetryEvent[]> {
    return await this.telemetry.recent(limit);
  }

  async listApprovals(limit?: number): Promise<RuntimeApproval[]> {
    return await this.approvals.list(limit);
  }

  async listAgentRuns(limit?: number): Promise<AgentRunSummary[]> {
    return await this.agentRuns.list(limit);
  }

  async getAgentRun(runId: string): Promise<AgentRunSummary> {
    return await this.agentRuns.get(runId);
  }

  async importBrowserEvidence(path: string, options: { binding?: Partial<EvidenceBinding>; timeReferences?: string[]; placeReferences?: string[]; runId?: string; snapshotId?: string } = {}) {
    return await this.evidence.importBrowserBridgeFile(path, options);
  }

  async bindEvidence(evidenceId: string, binding: Partial<EvidenceBinding>): Promise<BrowserEvidenceRecord> {
    return await this.evidence.bind(evidenceId, binding);
  }

  async listEvidence(investigationId?: string, limit?: number): Promise<BrowserEvidenceRecord[]> {
    return await this.evidence.list(investigationId, limit);
  }

  async evidenceGraph(investigationId: string): Promise<EvidenceGraph> {
    safeId(investigationId, "investigationId");
    const plans = (await this.listPlans()).filter((plan) => plan.spec.investigationId === investigationId);
    const plan = plans.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const jobs = plan ? (await this.listJobs()).filter((job) => job.planId === plan.planId) : [];
    let story: EarthStoryArtifact | undefined;
    try { story = await this.getStory(investigationId); } catch {}
    return await this.evidence.buildGraph({
      investigationId,
      hypotheses: plan?.spec.hypotheses.map((item) => ({ id: item.id, statement: item.statement })) || [],
      computedRuns: jobs.filter((job) => job.mode === "live" && job.state === "completed").map((job) => ({
        jobId: job.jobId,
        state: job.state,
        mode: job.mode,
        hypothesisIds: plan ? [...new Set(plan.datasets.flatMap((item) => item.hypothesisIds))] : [],
      })),
      findings: story?.findings.map((finding) => ({ hypothesisId: finding.hypothesisId, status: finding.status, evidenceCount: finding.evidence.length })) || [],
    });
  }

  private async recordTelemetry(input: Parameters<RuntimeTelemetryStore["record"]>[0]): Promise<RuntimeTelemetryEvent | undefined> {
    try { return await this.telemetry.record(input); }
    catch { return undefined; }
  }

  async recordToolTelemetry(operation: string, request: unknown, result: unknown, elapsedMs?: number, status: "ok" | "failed" = "ok", traceId?: string, errorCode?: string): Promise<RuntimeTelemetryEvent | undefined> {
    return await this.recordTelemetry({ kind: "pi_tool", operation: `earth_tool:${operation}`, request, result, elapsedMs, status, traceId, errorCode });
  }

  protected async executeBackend(backendId: string, operation: string, payload: Record<string, unknown>, options: { artifactDir?: string; workerId?: string; signal?: AbortSignal; onUpdate?: (update: EarthBackendProgress) => void; cost?: RuntimeTelemetryEvent["cost"] } = {}): Promise<EarthBackendExecution> {
    const started = performance.now();
    try {
      const execution = await this.backendRegistry.execute(backendId, operation, payload, { workspaceRoot: this.root, ...options });
      await this.recordTelemetry({
        kind: "backend",
        backendId,
        operation: `${backendId}:${operation}`,
        request: payload,
        result: execution.result,
        elapsedMs: execution.elapsedMs,
        artifactBytes: typeof execution.result.bytes === "number" ? execution.result.bytes : undefined,
        cost: options.cost,
      });
      return execution;
    } catch (error) {
      await this.recordTelemetry({
        kind: "backend",
        backendId,
        operation: `${backendId}:${operation}`,
        status: (error as any)?.code === "BACKEND_CANCELLED" ? "cancelled" : "failed",
        request: payload,
        result: { code: (error as any)?.code || "BACKEND_FAILED" },
        elapsedMs: performance.now() - started,
        cost: options.cost,
        errorCode: (error as any)?.code || "BACKEND_FAILED",
      });
      throw error;
    }
  }

  async registerAdapter(input: DatasetDescriptor, source: RegisteredEarthAdapter["source"] = "pi", options: { enabled?: boolean } = {}): Promise<RegisteredEarthAdapter> {
    await this.init();
    if (!["pi", "human", "import", "example"].includes(source)) throw Object.assign(new Error("adapter source is invalid"), { code: "ADAPTER_SOURCE_INVALID" });
    const adapter = validateDatasetDescriptor(input);
    const path = join(this.root, "adapters", `${adapter.datasetId}.json`);
    const fingerprint = createHash("sha256").update(JSON.stringify(adapter)).digest("hex");
    let revision = 1;
    try {
      const existing = normalizeRegisteredAdapter(await readJson<RegisteredEarthAdapter>(path));
      if (existing.fingerprint === fingerprint) return existing;
      revision = existing.revision + 1;
    } catch {}
    const stored: RegisteredEarthAdapter = {
      adapter,
      revision,
      fingerprint,
      registeredAt: new Date().toISOString(),
      source,
      enabled: options.enabled !== false,
      verification: { status: "not_run" },
    };
    await writeJson(path, stored);
    await this.writeRegistryEvent({ event: "adapter_registered", datasetId: adapter.datasetId, revision, fingerprint: stored.fingerprint, source, enabled: stored.enabled, at: stored.registeredAt });
    return stored;
  }

  async importAdapterPack(input: EarthAdapterPack, source: RegisteredEarthAdapter["source"] = "import"): Promise<{ packId: string; registered: RegisteredEarthAdapter[] }> {
    const pack = validateAdapterPack(input);
    const registered = [];
    for (const adapter of pack.adapters) registered.push(await this.registerAdapter(adapter, source));
    return { packId: pack.packId, registered };
  }

  async listAdapters(): Promise<RegisteredEarthAdapter[]> {
    await this.init();
    const rows: RegisteredEarthAdapter[] = [];
    for (const name of (await readdir(join(this.root, "adapters"))).filter((value) => value.endsWith(".json")).sort()) {
      try { rows.push(normalizeRegisteredAdapter(await readJson<RegisteredEarthAdapter>(join(this.root, "adapters", name)))); } catch {}
    }
    return rows;
  }

  async getAdapter(datasetId: string): Promise<RegisteredEarthAdapter> {
    safeId(datasetId, "datasetId");
    return normalizeRegisteredAdapter(await readJson<RegisteredEarthAdapter>(join(this.root, "adapters", `${datasetId}.json`)));
  }

  async setAdapterEnabled(datasetId: string, enabled: boolean): Promise<RegisteredEarthAdapter> {
    const stored = await this.getAdapter(datasetId);
    stored.enabled = enabled;
    await writeJson(join(this.root, "adapters", `${datasetId}.json`), stored);
    await this.writeRegistryEvent({ event: enabled ? "adapter_enabled" : "adapter_disabled", datasetId, revision: stored.revision, fingerprint: stored.fingerprint, at: new Date().toISOString() });
    return stored;
  }

  async probeAdapter(datasetId: string, input: { region?: InvestigationSpec["region"]; year?: number; cloudProject?: string; signal?: AbortSignal } = {}): Promise<RegisteredEarthAdapter> {
    const stored = await this.getAdapter(datasetId);
    const { signal, ...payload } = input;
    const result: any = await this.executeBackend("earth-engine", "probe_adapter", { adapter: stored.adapter, ...payload }, { signal }).then((execution) => execution.result).catch((error) => ({ ok: false, code: error.code || "ADAPTER_PROBE_FAILED", error: error.message || String(error) }));
    stored.verification = result.ok === true ? {
      status: "passed",
      checkedAt: new Date().toISOString(),
      sampleCount: Number(result.sampleCount ?? result.collectionSize ?? 0),
      availableBands: Array.isArray(result.availableBands) ? result.availableBands.map(String) : [],
      requestedBands: Array.isArray(result.requestedBands) ? result.requestedBands.map(String) : [],
      outputBands: Array.isArray(result.outputBands) ? result.outputBands.map(String) : [],
      sampleTime: result.sampleTime ? String(result.sampleTime) : undefined,
    } : {
      status: "failed",
      checkedAt: new Date().toISOString(),
      error: String(result.error || result.code || "Adapter probe failed"),
    };
    await writeJson(join(this.root, "adapters", `${datasetId}.json`), stored);
    await this.writeRegistryEvent({ event: "adapter_probe", datasetId, revision: stored.revision, fingerprint: stored.fingerprint, verification: stored.verification, at: stored.verification.checkedAt });
    return stored;
  }

  async environment(cloudProject?: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return (await this.executeBackend("earth-engine", "environment", { cloudProject }, { signal })).result;
  }

  async plan(spec: InvestigationSpec): Promise<{ plan: InvestigationPlan; path: string }> {
    await this.init();
    const registrations = (await this.listAdapters()).filter((row) => row.enabled);
    const plan = compileInvestigation(spec, registrations.map((row) => row.adapter));
    const byId = new Map(registrations.map((row) => [row.adapter.datasetId, row]));
    for (const item of plan.datasets) {
      const registration = byId.get(item.dataset.datasetId);
      if (registration) item.adapterBinding = {
        datasetId: registration.adapter.datasetId,
        revision: registration.revision,
        fingerprint: registration.fingerprint,
        verificationStatus: registration.verification.status,
      };
    }
    const path = join(this.root, "plans", `${plan.planId}.json`);
    await writeJson(path, plan);
    return { plan, path };
  }

  async preview(planId: string): Promise<Record<string, unknown>> {
    const plan = await this.getPlan(planId);
    return {
      planId,
      question: plan.spec.question,
      datasets: plan.datasets.map((item) => ({ role: item.role, datasetId: item.dataset.datasetId, scaleMeters: item.dataset.scaleMeters, reason: item.reason, limitations: item.dataset.limitations })),
      dag: plan.dag.map((node) => ({ nodeId: node.nodeId, op: node.op, dependsOn: node.dependsOn })),
      criticChecks: plan.criticChecks,
      estimatedCost: plan.estimatedCost,
    };
  }

  async run(planId: string, options: { mode?: "dry_run" | "live"; confirmed?: boolean; confirmedUnverifiedAdapters?: boolean; execution?: "inline" | "drive"; cloudProject?: string; driveFolder?: string; outputs?: string[]; signal?: AbortSignal; suppressWorkflowCompile?: boolean } = {}): Promise<EarthJob> {
    await this.init();
    const plan = await this.getPlan(planId);
    const mode = options.mode ?? "dry_run";
    if (mode === "live" && plan.estimatedCost.requiresApproval && options.confirmed !== true) {
      throw Object.assign(new Error("EARTH_APPROVAL_REQUIRED: this plan crosses the dataset-year approval threshold"), { code: "EARTH_APPROVAL_REQUIRED" });
    }
    const unverified = await this.unverifiedPlanAdapters(plan);
    if (mode === "live" && unverified.length && options.confirmedUnverifiedAdapters !== true) {
      throw Object.assign(new Error(`ADAPTER_VERIFICATION_REQUIRED: probe these adapters or explicitly confirm them: ${[...new Set(unverified)].join(", ")}`), { code: "ADAPTER_VERIFICATION_REQUIRED" });
    }
    const jobId = `earth_${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
    const artifactDir = join(this.root, "jobs", jobId);
    const now = new Date().toISOString();
    const request = { mode, execution: options.execution ?? "inline", outputs: options.outputs ? [...options.outputs] : undefined, suppressWorkflowCompile: options.suppressWorkflowCompile === true || undefined };
    let job: EarthJob = { jobId, planId, mode, state: "running", createdAt: now, updatedAt: now, taskIds: [], artifactDir, result: { request } };
    await writeJson(join(artifactDir, "job.json"), job);
    const nominalPixels = plan.estimatedCost.nominalPixels;
    const { signal, suppressWorkflowCompile, ...workerOptions } = options;
    const workerResult: any = await this.executeBackend("earth-engine", "run", { mode, plan, options: workerOptions, artifactDir }, {
      artifactDir,
      signal,
      cost: {
        nominalPixels,
        pixelYears: nominalPixels === undefined ? undefined : nominalPixels * plan.estimatedCost.years * plan.estimatedCost.datasetCount,
      },
    }).then((execution) => execution.result).catch((error) => ({ ok: false, code: error.code || "WORKER_FAILED", error: error.message || String(error) }));
    const taskIds = Array.isArray(workerResult.taskIds) ? workerResult.taskIds.map(String) : [];
    if (taskIds.length) await this.recordTelemetry({ kind: "runtime", operation: "earth_job:remote_tasks", request: { jobId, planId }, result: { remoteTasks: taskIds.length }, cost: { remoteTasks: taskIds.length } });
    job = {
      ...job,
      state: workerResult.ok === true ? (mode === "live" && taskIds.length > 0 ? "running" : "completed") : workerResult.code === "GEE_AUTH_REQUIRED" || workerResult.code === "GEE_NOT_INSTALLED" ? "blocked_auth" : "failed",
      updatedAt: new Date().toISOString(),
      taskIds,
      result: workerResult.ok === true ? { ...workerResult, request } : { request },
      error: workerResult.ok === true ? undefined : String(workerResult.error || workerResult.code || "worker failed"),
    };
    await writeJson(join(artifactDir, "job.json"), job);
    if (job.state === "completed" && suppressWorkflowCompile !== true) job = await this.attachAutomaticWorkflow(plan, job);
    return job;
  }

  async status(jobId: string, refresh = false, signal?: AbortSignal): Promise<EarthJob> {
    safeId(jobId, "jobId");
    const path = join(this.root, "jobs", jobId, "job.json");
    const job = await readJson<EarthJob>(path);
    if (!refresh || job.mode !== "live" || job.taskIds.length === 0) return job;
    const previousState = job.state;
    const result = await this.executeBackend("earth-engine", "status", { taskIds: job.taskIds, cloudProject: process.env.EARTHENGINE_PROJECT }, { signal }).then((execution) => execution.result).catch(() => null);
    if (result?.ok) {
      const tasks = Array.isArray(result.tasks) ? result.tasks as EarthTaskStatus[] : [];
      job.result = { ...(job.result || {}), taskStatus: tasks };
      job.state = deriveEarthJobState(tasks, job.state);
      const failed = tasks.find((task) => String(task.state).toUpperCase() === "FAILED");
      job.error = failed ? String(failed.error_message || failed.errorMessage || "Earth Engine task failed") : undefined;
      job.updatedAt = new Date().toISOString();
      await writeJson(path, job);
      if (previousState !== "completed" && job.state === "completed" && (job.result?.request as any)?.suppressWorkflowCompile !== true) return await this.attachAutomaticWorkflow(await this.getPlan(job.planId), job);
    }
    return job;
  }

  async visualize(planId: string, input: { role: string; year: number; cloudProject?: string; signal?: AbortSignal }): Promise<EarthVisualization> {
    const plan = await this.getPlan(planId);
    const role = String(input.role || "");
    if (!plan.datasets.some((item) => item.role === role)) throw Object.assign(new Error(`role ${role} is not part of plan ${planId}`), { code: "VISUALIZATION_ROLE_INVALID" });
    if (!Number.isInteger(input.year) || input.year < plan.spec.period.startYear || input.year > plan.spec.period.endYear) throw Object.assign(new Error("visualization year is outside the plan period"), { code: "VISUALIZATION_YEAR_INVALID" });
    const cacheKey = `${planId}:${role}:${input.year}:${input.cloudProject || process.env.EARTHENGINE_PROJECT || "default"}`;
    const cached = this.visualizationCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      const value = { ...cached.value, cacheHit: true, cacheExpiresAt: new Date(cached.expiresAt).toISOString() };
      await this.recordTelemetry({ kind: "cache", operation: "visualization:tile_contract", request: { planId, role, year: input.year }, result: { mapId: value.mapId }, cacheHit: true });
      return value;
    }
    const result: any = (await this.executeBackend("earth-engine", "visualize", { plan, role, year: input.year, cloudProject: input.cloudProject }, { signal: input.signal })).result;
    if (!result?.ok) throw Object.assign(new Error(String(result?.error || "visualization failed")), { code: result?.code || "VISUALIZATION_FAILED" });
    const expiresAt = Date.now() + 15 * 60 * 1000;
    const value = { ...(result as EarthVisualization), cacheHit: false, cacheExpiresAt: new Date(expiresAt).toISOString() };
    this.visualizationCache.set(cacheKey, { value, expiresAt });
    await this.recordTelemetry({ kind: "cache", operation: "visualization:tile_contract", request: { planId, role, year: input.year }, result: { mapId: value.mapId }, cacheHit: false });
    return value;
  }

  async exportLocal(planId: string, input: EarthLocalExportRequest, runtimeOptions: { suppressWorkflowCompile?: boolean } = {}): Promise<EarthJob> {
    await this.init();
    const plan = await this.getPlan(planId);
    const item = plan.datasets.find((row) => row.role === input.role);
    if (!item) throw Object.assign(new Error(`role ${input.role} is not part of plan ${planId}`), { code: "EXPORT_ROLE_INVALID" });
    const kind = input.kind || "year";
    const year = input.year ?? plan.spec.period.endYear;
    const baselineYear = input.baselineYear ?? plan.spec.period.startYear;
    const targetYear = input.targetYear ?? plan.spec.period.endYear;
    for (const value of kind === "year" ? [year] : [baselineYear, targetYear]) {
      if (!Number.isInteger(value) || value < plan.spec.period.startYear || value > plan.spec.period.endYear) {
        throw Object.assign(new Error("export years must be inside the plan period"), { code: "EXPORT_YEAR_INVALID" });
      }
    }
    if (kind === "change" && baselineYear >= targetYear) throw Object.assign(new Error("baselineYear must be before targetYear"), { code: "EXPORT_YEAR_INVALID" });
    const scaleMeters = input.scaleMeters ?? item.dataset.scaleMeters;
    if (!Number.isFinite(scaleMeters) || scaleMeters < Math.max(1, item.dataset.scaleMeters / 2) || scaleMeters > 100_000) {
      throw Object.assign(new Error(`scaleMeters must be between ${Math.max(1, item.dataset.scaleMeters / 2)} and 100000`), { code: "EXPORT_SCALE_INVALID" });
    }
    const maxPixels = input.maxPixels ?? 25_000_000;
    if (!Number.isInteger(maxPixels) || maxPixels < 10_000 || maxPixels > 1_000_000_000) throw Object.assign(new Error("maxPixels must be between 10000 and 1000000000"), { code: "EXPORT_LIMIT_INVALID" });
    const finestScale = Math.min(...plan.datasets.map((row) => row.dataset.scaleMeters));
    const estimatedPixels = plan.estimatedCost.nominalPixels === undefined ? undefined : Math.ceil(plan.estimatedCost.nominalPixels * (finestScale / scaleMeters) ** 2);
    if ((estimatedPixels === undefined || estimatedPixels > maxPixels) && input.confirmed !== true) {
      throw Object.assign(new Error(`EARTH_EXPORT_APPROVAL_REQUIRED: estimated pixels ${estimatedPixels ?? "unknown"} exceed the unattended export budget`), { code: "EARTH_EXPORT_APPROVAL_REQUIRED" });
    }
    const unverified = (await this.unverifiedPlanAdapters(plan)).includes(item.dataset.datasetId);
    if (unverified && input.confirmed !== true) throw Object.assign(new Error(`ADAPTER_VERIFICATION_REQUIRED: probe ${item.dataset.datasetId} or explicitly confirm the export`), { code: "ADAPTER_VERIFICATION_REQUIRED" });

    const jobId = `earth_${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
    const artifactDir = join(this.root, "jobs", jobId);
    const now = new Date().toISOString();
    const request: EarthLocalExportRequest & { format: "geotiff"; scaleMeters: number; maxPixels: number } = {
      ...input,
      kind,
      year,
      baselineYear,
      targetYear,
      format: "geotiff",
      scaleMeters,
      maxPixels,
      dtype: input.dtype ?? "float32",
      crs: input.crs ?? "EPSG:4326",
    };
    const job: EarthJob = {
      jobId,
      planId,
      mode: "live",
      state: "running",
      createdAt: now,
      updatedAt: now,
      taskIds: [],
      artifactDir,
      result: { execution: "local_export", backend: "geedim", request, estimatedPixels },
    };
    await writeJson(join(artifactDir, "job.json"), job);
    await writeJson(join(artifactDir, "export_request.json"), request);
    // Track the background completion separately from the child process so tests,
    // shutdown hooks, and embedding runtimes can drain even when a backend is in-process.
    const completion = Promise.resolve()
      .then(async () => await this.finishLocalExport(job, plan, request, runtimeOptions.suppressWorkflowCompile === true))
      .finally(() => this.activeLocalExports.delete(job.jobId));
    this.activeLocalExports.set(job.jobId, completion);
    return job;
  }

  async waitForLocalExport(jobId: string, timeoutMs = 30_000): Promise<EarthJob> {
    safeId(jobId, "jobId");
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 900_000) {
      throw Object.assign(new Error("timeoutMs must be between 1 and 900000"), { code: "WAIT_TIMEOUT_INVALID" });
    }
    const completion = this.activeLocalExports.get(jobId);
    if (completion) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          completion,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error(`LOCAL_EXPORT_WAIT_TIMEOUT: ${jobId}`), { code: "LOCAL_EXPORT_WAIT_TIMEOUT" })), timeoutMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    return await this.status(jobId);
  }

  async drainLocalExports(timeoutMs = 30_000): Promise<void> {
    const jobIds = [...this.activeLocalExports.keys()];
    await Promise.all(jobIds.map(async (jobId) => { await this.waitForLocalExport(jobId, timeoutMs); }));
  }

  async retryLocalExport(jobId: string, confirmed = false): Promise<EarthJob> {
    const job = await this.status(jobId);
    const request = await readJson<EarthLocalExportRequest>(join(job.artifactDir, "export_request.json"));
    return await this.exportLocal(job.planId, { ...request, confirmed });
  }

  private async finishLocalExport(job: EarthJob, plan: InvestigationPlan, request: EarthLocalExportRequest, suppressWorkflowCompile = false): Promise<void> {
    const estimatedPixels = typeof job.result?.estimatedPixels === "number" ? job.result.estimatedPixels : undefined;
    const dtypeBytes = request.dtype === "float64" ? 8 : request.dtype === "uint8" ? 1 : request.dtype === "int16" || request.dtype === "uint16" ? 2 : 4;
    const result = await this.executeBackend("geedim", "export_local", { plan, request, artifactDir: job.artifactDir }, {
      artifactDir: job.artifactDir,
      workerId: job.jobId,
      cost: { nominalPixels: estimatedPixels, estimatedRasterBytes: estimatedPixels === undefined ? undefined : estimatedPixels * dtypeBytes },
    }).then((execution) => execution.result).catch((error) => ({ ok: false, code: error.code || "LOCAL_EXPORT_FAILED", error: error.message || String(error) }));
    const path = join(job.artifactDir, "job.json");
    let latest: EarthJob;
    try { latest = await readJson<EarthJob>(path); } catch { return; }
    if (latest.state === "cancelled") return;
    latest.state = result.ok === true ? "completed" : result.code === "GEE_AUTH_REQUIRED" || result.code === "GEE_NOT_INSTALLED" ? "blocked_auth" : "failed";
    latest.updatedAt = new Date().toISOString();
    latest.result = result.ok === true ? { ...(latest.result || {}), ...result } : latest.result;
    latest.error = result.ok === true ? undefined : String(result.error || result.code || "local export failed");
    await writeJson(path, latest);
    if (latest.state === "completed" && !suppressWorkflowCompile) await this.attachAutomaticWorkflow(plan, latest);
  }

  async cancel(jobId: string, cloudProject = process.env.EARTHENGINE_PROJECT): Promise<EarthJob> {
    safeId(jobId, "jobId");
    const path = join(this.root, "jobs", jobId, "job.json");
    const job = await readJson<EarthJob>(path);
    if (["completed", "failed", "cancelled", "blocked_auth"].includes(job.state)) return job;
    const localWorker = this.activeWorkers.get(jobId);
    if (localWorker) {
      localWorker.kill("SIGTERM");
      job.result = { ...(job.result || {}), cancellation: { state: "PROCESS_TERMINATED" } };
    } else if (job.mode === "live" && job.taskIds.length > 0) {
      const result = (await this.executeBackend("earth-engine", "cancel", { taskIds: job.taskIds, cloudProject })).result;
      if (!result?.ok) throw Object.assign(new Error(String(result?.error || "Earth Engine cancellation failed")), { code: result?.code || "CANCEL_FAILED" });
      job.result = { ...(job.result || {}), cancellation: result.tasks || [] };
    }
    job.state = "cancelled";
    job.updatedAt = new Date().toISOString();
    await writeJson(path, job);
    return job;
  }

  private async attachAutomaticWorkflow(plan: InvestigationPlan, job: EarthJob): Promise<EarthJob> {
    if (job.state !== "completed") return job;
    if (plan.criticChecks.some((check) => check.severity === "blocking")) return job;
    if (plan.datasets.some((item) => item.adapterBinding?.verificationStatus !== "passed")) return job;
    try {
      const compiled = await this.compileWorkflow({
        workflowId: automaticWorkflowId(plan.spec.investigationId),
        name: plan.spec.question.slice(0, 160),
        description: `Automatically compiled candidate from verified job ${job.jobId}.`,
        planId: plan.planId,
        jobId: job.jobId,
        stage: "candidate",
      });
      job.result = {
        ...(job.result || {}),
        workflowCandidate: {
          workflowId: compiled.stored.workflow.workflowId,
          revision: compiled.stored.revision,
          fingerprint: compiled.stored.fingerprint,
          path: compiled.path,
        },
      };
      await writeJson(join(job.artifactDir, "job.json"), job);
    } catch (error) {
      await this.recordTelemetry({
        kind: "workflow",
        operation: "workflow:auto_compile",
        status: "failed",
        request: { planId: plan.planId, jobId: job.jobId },
        result: { skipped: true },
        errorCode: (error as any)?.code || "WORKFLOW_AUTO_COMPILE_FAILED",
      });
    }
    return job;
  }

  async compileWorkflow(input: { workflowId: string; name: string; description?: string; planId: string; jobId?: string; confirmedBlockingChecks?: boolean; stage?: "candidate" | "ready" }): Promise<{ stored: StoredEarthWorkflow; path: string }> {
    await this.init();
    const plan = await this.getPlan(input.planId);
    const job = input.jobId
      ? await this.status(input.jobId, true)
      : (await this.listJobs()).filter((item) => item.planId === input.planId && item.state === "completed").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (!job) throw Object.assign(new Error("WORKFLOW_SOURCE_NOT_SUCCESSFUL: no completed source job exists for this plan"), { code: "WORKFLOW_SOURCE_NOT_SUCCESSFUL" });
    const workflow = compileEarthWorkflow({ ...input, plan, job });
    const fingerprint = earthWorkflowFingerprint(workflow);
    const path = join(this.root, "workflows", `${workflow.workflowId}.json`);
    let existing: StoredEarthWorkflow | undefined;
    try { existing = normalizeStoredWorkflow(await readJson<StoredEarthWorkflow>(path)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (existing?.fingerprint === fingerprint) {
      if (input.stage === "ready" && existing.stage !== "ready") {
        existing.stage = "ready";
        existing.savedAt = new Date().toISOString();
        await writeJson(path, existing);
      }
      return { stored: existing, path };
    }
    const stored: StoredEarthWorkflow = {
      workflow,
      revision: (existing?.revision || 0) + 1,
      fingerprint,
      savedAt: new Date().toISOString(),
      stage: input.stage ?? "ready",
      replayCount: 0,
      successCount: 0,
      failureCount: 0,
    };
    await writeJson(path, stored);
    await this.recordTelemetry({ kind: "workflow", operation: "workflow:compile", request: { workflowId: workflow.workflowId, planId: plan.planId, jobId: job.jobId }, result: { revision: stored.revision, fingerprint: fingerprint.slice(0, 12) } });
    return { stored, path };
  }

  async getWorkflow(workflowId: string): Promise<StoredEarthWorkflow> {
    safeId(workflowId, "workflowId");
    return normalizeStoredWorkflow(await readJson<StoredEarthWorkflow>(join(this.root, "workflows", `${workflowId}.json`)));
  }

  async listWorkflows(): Promise<Array<{ workflowId: string; name: string; description: string; stage: "candidate" | "ready"; revision: number; fingerprint: string; savedAt: string; replayCount: number; successCount: number; failureCount: number; executionKind: string }>> {
    await this.init();
    const rows = [];
    for (const name of (await readdir(join(this.root, "workflows"))).filter((value) => value.endsWith(".json")).sort()) {
      try {
        const stored = normalizeStoredWorkflow(await readJson<StoredEarthWorkflow>(join(this.root, "workflows", name)));
        rows.push({
          workflowId: stored.workflow.workflowId,
          name: stored.workflow.name,
          description: stored.workflow.description,
          stage: stored.stage,
          revision: stored.revision,
          fingerprint: stored.fingerprint,
          savedAt: stored.savedAt,
          replayCount: stored.replayCount,
          successCount: stored.successCount,
          failureCount: stored.failureCount,
          executionKind: stored.workflow.execution.kind,
        });
      } catch {}
    }
    return rows.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async replayWorkflow(workflowId: string, input: { patch?: Partial<InvestigationSpec>; confirmed?: boolean; confirmedCostIncrease?: boolean; cloudProject?: string; signal?: AbortSignal } = {}): Promise<{ replay: EarthWorkflowReplayRecord; plan?: InvestigationPlan; job?: EarthJob }> {
    await this.init();
    const stored = await this.getWorkflow(workflowId);
    const replayId = `workflow_${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const replay: EarthWorkflowReplayRecord = {
      schemaVersion: "scoutpi.earth.workflow-run.v1",
      replayId,
      workflowId,
      workflowRevision: stored.revision,
      state: "running",
      startedAt: now,
      updatedAt: now,
      assertions: [],
    };
    const replayPath = join(this.root, "workflow_runs", `${replayId}.json`);
    await writeJson(replayPath, replay);
    try {
      if ((stored.stage === "candidate" || stored.workflow.safety.requiresConfirmation) && input.confirmed !== true) throw Object.assign(new Error("WORKFLOW_CONFIRMATION_REQUIRED"), { code: "WORKFLOW_CONFIRMATION_REQUIRED" });
      for (const binding of stored.workflow.adapterBindings) {
        const current = await this.getAdapter(binding.datasetId).catch(() => undefined);
        const ok = Boolean(current?.enabled && current.verification.status === "passed" && current.fingerprint === binding.fingerprint);
        replay.assertions.push({ kind: "adapter_fingerprint", ok, message: ok ? `${binding.datasetId} fingerprint verified` : `${binding.datasetId} changed, is disabled, or is unverified` });
        if (!ok) throw Object.assign(new Error(`WORKFLOW_ADAPTER_DRIFT: ${binding.datasetId}`), { code: "WORKFLOW_ADAPTER_DRIFT" });
      }
      const fallbackId = `${workflowId}-${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 12)}`.slice(0, 79);
      const spec = validateInvestigationSpec(instantiateWorkflowSpec(stored.workflow, input.patch || {}, fallbackId));
      const planned = await this.plan(spec);
      replay.planId = planned.plan.planId;
      for (const role of stored.workflow.requiredRoles) {
        const ok = planned.plan.datasets.some((item) => item.role === role);
        replay.assertions.push({ kind: "required_role", ok, message: ok ? `${role} routed` : `${role} missing from replay plan` });
        if (!ok) throw Object.assign(new Error(`WORKFLOW_ROLE_MISSING: ${role}`), { code: "WORKFLOW_ROLE_MISSING" });
      }
      const sourceMax = stored.workflow.assertions.find((assertion) => assertion.kind === "max_nominal_pixels")?.value;
      const currentPixels = planned.plan.estimatedCost.nominalPixels;
      if (sourceMax !== undefined && currentPixels !== undefined && currentPixels > sourceMax) {
        const ok = input.confirmedCostIncrease === true;
        replay.assertions.push({ kind: "max_nominal_pixels", ok, message: `replay pixels=${currentPixels} source=${sourceMax}` });
        if (!ok) throw Object.assign(new Error(`WORKFLOW_COST_INCREASE_CONFIRMATION_REQUIRED: ${currentPixels} > ${sourceMax}`), { code: "WORKFLOW_COST_INCREASE_CONFIRMATION_REQUIRED" });
      }
      let job: EarthJob;
      if (stored.workflow.execution.kind === "local_export") {
        job = await this.exportLocal(planned.plan.planId, { ...stored.workflow.execution.request, cloudProject: input.cloudProject, confirmed: input.confirmed === true }, { suppressWorkflowCompile: true });
      } else {
        job = await this.run(planned.plan.planId, {
          mode: stored.workflow.execution.mode,
          execution: stored.workflow.execution.execution,
          outputs: stored.workflow.execution.outputs,
          cloudProject: input.cloudProject,
          confirmed: input.confirmed === true,
          confirmedUnverifiedAdapters: false,
          signal: input.signal,
          suppressWorkflowCompile: true,
        });
      }
      replay.jobId = job.jobId;
      replay.state = replayStateFromJob(job.state);
      replay.updatedAt = new Date().toISOString();
      replay.countedTerminal = replay.state === "completed";
      stored.replayCount += 1;
      if (replay.state === "completed") stored.successCount += 1;
      await writeJson(join(this.root, "workflows", `${workflowId}.json`), stored);
      await writeJson(replayPath, replay);
      await this.recordTelemetry({ kind: "workflow", operation: "workflow:replay", request: { workflowId, revision: stored.revision }, result: { replayId, state: replay.state, planId: replay.planId, jobId: replay.jobId } });
      return { replay, plan: planned.plan, job };
    } catch (error) {
      replay.state = String((error as any)?.code || "").includes("REQUIRED") || String((error as any)?.code || "").includes("DRIFT") ? "blocked" : "failed";
      replay.error = (error as Error).message;
      replay.updatedAt = new Date().toISOString();
      replay.countedTerminal = true;
      stored.replayCount += 1;
      stored.failureCount += 1;
      await writeJson(join(this.root, "workflows", `${workflowId}.json`), stored);
      await writeJson(replayPath, replay);
      await this.recordTelemetry({ kind: "workflow", operation: "workflow:replay", status: "failed", request: { workflowId, revision: stored.revision }, result: { replayId, state: replay.state }, errorCode: (error as any)?.code || "WORKFLOW_REPLAY_FAILED" });
      throw error;
    }
  }

  async refreshWorkflowReplay(replayId: string): Promise<EarthWorkflowReplayRecord> {
    safeId(replayId, "replayId");
    const path = join(this.root, "workflow_runs", `${replayId}.json`);
    const replay = await readJson<EarthWorkflowReplayRecord>(path);
    if (!replay.jobId || replay.countedTerminal) return replay;
    const job = await this.status(replay.jobId, true);
    replay.state = replayStateFromJob(job.state);
    replay.updatedAt = new Date().toISOString();
    if (["completed", "failed", "cancelled", "blocked"].includes(replay.state)) {
      replay.countedTerminal = true;
      const stored = await this.getWorkflow(replay.workflowId);
      if (replay.state === "completed") stored.successCount += 1;
      else stored.failureCount += 1;
      await writeJson(join(this.root, "workflows", `${replay.workflowId}.json`), stored);
    }
    await writeJson(path, replay);
    return replay;
  }

  async listWorkflowRuns(): Promise<EarthWorkflowReplayRecord[]> {
    await this.init();
    const rows: EarthWorkflowReplayRecord[] = [];
    for (const name of (await readdir(join(this.root, "workflow_runs"))).filter((value) => value.endsWith(".json")).sort().reverse()) {
      try { rows.push(await readJson<EarthWorkflowReplayRecord>(join(this.root, "workflow_runs", name))); } catch {}
    }
    return rows;
  }

  async saveRecipe(recipe: { recipeId: string; name: string; spec: InvestigationSpec }): Promise<Record<string, unknown>> {
    await this.init();
    safeId(recipe.recipeId, "recipeId");
    const spec = validateInvestigationSpec(recipe.spec);
    const stored = { schemaVersion: "scoutpi.earth.recipe.v1", recipeId: recipe.recipeId, name: recipe.name, spec, savedAt: new Date().toISOString() };
    await writeJson(join(this.root, "recipes", `${recipe.recipeId}.json`), stored);
    return stored;
  }

  async loadRecipe(recipeId: string, patch: Partial<InvestigationSpec> = {}): Promise<InvestigationSpec> {
    safeId(recipeId, "recipeId");
    const stored = await readJson<{ spec: InvestigationSpec }>(join(this.root, "recipes", `${recipeId}.json`));
    return validateInvestigationSpec({ ...stored.spec, ...patch, region: patch.region ?? stored.spec.region, period: patch.period ?? stored.spec.period, hypotheses: patch.hypotheses ?? stored.spec.hypotheses });
  }

  async listRecipes(): Promise<Array<Record<string, unknown>>> {
    await this.init();
    const rows = [];
    for (const name of (await readdir(join(this.root, "recipes"))).filter((value) => value.endsWith(".json")).sort()) {
      const stored = await readJson<Record<string, unknown>>(join(this.root, "recipes", name));
      rows.push({ recipeId: stored.recipeId, name: stored.name, savedAt: stored.savedAt });
    }
    return rows;
  }

  async saveSkill(input: EarthSkillDefinition): Promise<{ skill: EarthSkillDefinition; jsonPath: string; markdownPath: string }> {
    await this.init();
    const skill = validateEarthSkill(input);
    const missing = [];
    for (const adapterId of skill.requiredAdapterIds || []) {
      try { await this.getAdapter(adapterId); } catch { missing.push(adapterId); }
    }
    if (missing.length) throw Object.assign(new Error(`required adapters are not registered: ${missing.join(", ")}`), { code: "SKILL_ADAPTER_MISSING" });
    const directory = join(this.root, "skills", skill.skillId);
    const jsonPath = join(directory, "skill.json");
    const markdownPath = join(directory, "SKILL.md");
    await writeJson(jsonPath, { ...skill, savedAt: new Date().toISOString() });
    await mkdir(directory, { recursive: true });
    await writeFile(markdownPath, renderEarthSkill(skill));
    return { skill, jsonPath, markdownPath };
  }

  async listSkills(): Promise<Array<Record<string, unknown>>> {
    await this.init();
    const rows = [];
    for (const name of (await readdir(join(this.root, "skills"))).sort()) {
      try {
        const stored = await readJson<Record<string, unknown>>(join(this.root, "skills", name, "skill.json"));
        rows.push({ skillId: stored.skillId, name: stored.name, description: stored.description, requiredAdapterIds: stored.requiredAdapterIds || [], savedAt: stored.savedAt });
      } catch {}
    }
    return rows;
  }

  async getSkill(skillId: string): Promise<EarthSkillDefinition> {
    safeId(skillId, "skillId");
    return validateEarthSkill(await readJson<EarthSkillDefinition>(join(this.root, "skills", skillId, "skill.json")));
  }

  async publishSkill(skillId: string, confirmed = false): Promise<{ skillId: string; path: string; reloadRequired: true }> {
    if (!confirmed) throw Object.assign(new Error("SKILL_PUBLISH_CONFIRMATION_REQUIRED"), { code: "SKILL_PUBLISH_CONFIRMATION_REQUIRED" });
    const skill = await this.getSkill(skillId);
    const destination = join(this.skillPublishRoot, skill.skillId, "SKILL.md");
    const allowedRoot = this.skillPublishRoot;
    if (!destination.startsWith(`${allowedRoot}${sep}`)) throw Object.assign(new Error("SKILL_PATH_BLOCKED"), { code: "SKILL_PATH_BLOCKED" });
    try {
      const existing = await readFile(destination, "utf8");
      if (!existing.includes("Generated by ScoutPi Earth Workspace")) throw Object.assign(new Error("Refusing to overwrite a non-ScoutPi skill"), { code: "SKILL_OVERWRITE_BLOCKED" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, renderEarthSkill(skill));
    return { skillId, path: destination, reloadRequired: true };
  }

  async getRecipe(recipeId: string): Promise<Record<string, unknown>> {
    safeId(recipeId, "recipeId");
    return await readJson<Record<string, unknown>>(join(this.root, "recipes", `${recipeId}.json`));
  }

  async instantiateRecipe(recipeId: string, patch: Partial<InvestigationSpec> = {}): Promise<{ plan: InvestigationPlan; path: string }> {
    return await this.plan(await this.loadRecipe(recipeId, patch));
  }

  async getPlan(planId: string): Promise<InvestigationPlan> {
    safeId(planId, "planId");
    return await readJson<InvestigationPlan>(join(this.root, "plans", `${planId}.json`));
  }

  async listPlans(): Promise<InvestigationPlan[]> {
    await this.init();
    const rows: InvestigationPlan[] = [];
    for (const name of (await readdir(join(this.root, "plans"))).filter((value) => value.endsWith(".json")).sort().reverse()) {
      try { rows.push(await readJson<InvestigationPlan>(join(this.root, "plans", name))); } catch {}
    }
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listJobs(): Promise<EarthJob[]> {
    await this.init();
    const rows: EarthJob[] = [];
    for (const name of (await readdir(join(this.root, "jobs"))).sort().reverse()) {
      try { rows.push(await readJson<EarthJob>(join(this.root, "jobs", name, "job.json"))); } catch {}
    }
    return rows;
  }

  async listStories(): Promise<EarthStoryArtifact[]> {
    await this.init();
    const rows: EarthStoryArtifact[] = [];
    for (const name of (await readdir(join(this.root, "stories"))).filter((value) => value.endsWith(".json")).sort().reverse()) {
      try { rows.push(await readJson<EarthStoryArtifact>(join(this.root, "stories", name))); } catch {}
    }
    return rows;
  }

  async getStory(investigationId: string): Promise<EarthStoryArtifact> {
    safeId(investigationId, "investigationId");
    return await readJson<EarthStoryArtifact>(join(this.root, "stories", `${investigationId}.json`));
  }

  async listJobArtifacts(jobId: string): Promise<Array<{ name: string; path: string; size: number; kind: string }>> {
    safeId(jobId, "jobId");
    const directory = join(this.root, "jobs", jobId);
    const rows = [];
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      const info = await stat(path);
      if (!info.isFile()) continue;
      rows.push({ name, path, size: info.size, kind: name.split(".").pop()?.toLowerCase() || "file" });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  async readArtifact(path: string): Promise<{ path: string; content: Buffer; contentType: string }> {
    const absolute = resolve(path);
    if (absolute !== this.root && !absolute.startsWith(`${this.root}${sep}`)) throw Object.assign(new Error("ARTIFACT_PATH_BLOCKED"), { code: "ARTIFACT_PATH_BLOCKED" });
    const content = await readFile(absolute);
    const extension = absolute.split(".").pop()?.toLowerCase();
    const contentType = extension === "json" ? "application/json" : extension === "csv" ? "text/csv" : extension === "md" ? "text/markdown" : extension === "png" ? "image/png" : "application/octet-stream";
    return { path: absolute, content, contentType };
  }

  async readJobArtifact(jobId: string, name: string): Promise<{ path: string; content: Buffer; contentType: string }> {
    safeId(jobId, "jobId");
    if (!/^[a-z0-9][a-z0-9._-]{0,160}$/i.test(name) || name.includes("..")) throw Object.assign(new Error("artifact name is invalid"), { code: "INVALID_ARTIFACT_NAME" });
    return await this.readArtifact(join(this.root, "jobs", jobId, name));
  }

  async analyze(inputPath: string, columns?: string[], signal?: AbortSignal): Promise<Record<string, unknown>> {
    const absolute = resolve(inputPath);
    const allowedRoots = (process.env.SCOUTPI_EARTH_ANALYSIS_ROOTS || [this.root, resolve("exports"), resolve("data")].join(delimiter)).split(delimiter).filter(Boolean).map((root) => resolve(root));
    if (!allowedRoots.some((root) => absolute === root || absolute.startsWith(`${root}${sep}`))) throw Object.assign(new Error("ANALYSIS_PATH_BLOCKED: input is outside allowed roots"), { code: "ANALYSIS_PATH_BLOCKED" });
    await access(absolute);
    const result = (await this.executeBackend("local-analysis", "analyze", { path: absolute, columns, artifactDir: join(this.root, "analysis") }, { artifactDir: join(this.root, "analysis"), signal })).result;
    if (!result.ok) throw Object.assign(new Error(String(result.error || "analysis failed")), { code: result.code || "ANALYSIS_FAILED" });
    return result;
  }

  async story(input: EarthStoryArtifact): Promise<{ story: EarthStoryArtifact; jsonPath: string; markdownPath: string }> {
    await this.init();
    if (input.schemaVersion !== "scoutpi.earth.story.v1" || !input.investigationId || !input.question) throw new Error("STORY_INVALID: schemaVersion, investigationId and question are required");
    safeId(input.investigationId, "investigationId");
    if (input.question.length > 2000 || !Array.isArray(input.claims) || input.claims.length > 100 || !Array.isArray(input.findings) || input.findings.length > 100 || !Array.isArray(input.uncertainties) || input.uncertainties.length > 100) throw Object.assign(new Error("STORY_INVALID: story collections exceed their limits"), { code: "STORY_INVALID" });
    for (const claim of input.claims) {
      safeId(claim.claimId, "claimId");
      if (!claim.claim?.trim() || claim.claim.length > 2000) throw Object.assign(new Error("STORY_INVALID: claim text is invalid"), { code: "STORY_INVALID" });
      try {
        const url = new URL(claim.sourceUrl);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("unsupported protocol");
      } catch { throw Object.assign(new Error("STORY_INVALID: claim sourceUrl must use http or https"), { code: "STORY_INVALID" }); }
      if (claim.evidenceArtifact) {
        const evidence = await this.evidence.get(claim.evidenceArtifact).catch(() => undefined);
        if (!evidence || evidence.binding?.investigationId !== input.investigationId || evidence.source.url !== new URL(claim.sourceUrl).toString()) throw Object.assign(new Error("STORY_INVALID: evidenceArtifact must reference bound browser evidence with the same source URL"), { code: "STORY_INVALID" });
      }
    }
    for (const finding of input.findings) {
      safeId(finding.hypothesisId, "hypothesisId");
      if (!["supported", "mixed", "not_supported", "unknown"].includes(finding.status) || !Array.isArray(finding.evidence) || finding.evidence.length > 100 || finding.evidence.some((value) => typeof value !== "string" || !value.trim() || value.length > 2000)) throw Object.assign(new Error("STORY_INVALID: finding is invalid"), { code: "STORY_INVALID" });
    }
    if (input.uncertainties.some((value) => typeof value !== "string" || !value.trim() || value.length > 2000)) throw Object.assign(new Error("STORY_INVALID: uncertainty is invalid"), { code: "STORY_INVALID" });
    const jsonPath = join(this.root, "stories", `${input.investigationId}.json`);
    const markdownPath = join(this.root, "stories", `${input.investigationId}.md`);
    const markdown = [
      `# ${input.question}`, "", "## Claims", ...input.claims.map((claim) => `- ${claim.claim} (${claim.sourceUrl})`), "",
      "## Findings", ...input.findings.map((finding) => `- **${finding.hypothesisId}**: ${finding.status}. ${finding.evidence.join(" ")}`), "",
      "## Uncertainty", ...input.uncertainties.map((item) => `- ${item}`), "", "## Reproducibility", "```json", JSON.stringify(input.provenance, null, 2), "```", "",
    ].join("\n");
    await writeJson(jsonPath, input);
    await writeFile(markdownPath, markdown);
    await this.evidenceGraph(input.investigationId);
    return { story: input, jsonPath, markdownPath };
  }

  private async writeRegistryEvent(event: Record<string, unknown>): Promise<void> {
    await this.init();
    await appendFile(join(this.root, "registry_events.jsonl"), `${JSON.stringify(event)}\n`);
  }

  private async unverifiedPlanAdapters(plan: InvestigationPlan): Promise<string[]> {
    const current = new Map((await this.listAdapters()).map((row) => [row.adapter.datasetId, row]));
    return [...new Set(plan.datasets.filter((item) => {
      const registration = current.get(item.dataset.datasetId);
      return !registration || !registration.enabled || registration.verification.status !== "passed" || registration.fingerprint !== item.adapterBinding?.fingerprint;
    }).map((item) => item.dataset.datasetId))];
  }

  protected async callWorker(payload: Record<string, unknown>, workerId?: string, signal?: AbortSignal): Promise<any> {
    return await new Promise((resolvePromise, reject) => {
      if (signal?.aborted) {
        reject(Object.assign(new Error("WORKER_ABORTED"), { code: "WORKER_ABORTED" }));
        return;
      }
      const child = spawn(this.python, [this.worker], { stdio: ["pipe", "pipe", "pipe"] });
      if (workerId) this.activeWorkers.set(workerId, child);
      let stdout = "";
      let stderr = "";
      const onAbort = () => child.kill("SIGTERM");
      const cleanup = () => {
        if (workerId) this.activeWorkers.delete(workerId);
        signal?.removeEventListener("abort", onAbort);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", (error) => {
        cleanup();
        reject(error);
      });
      child.on("close", (code) => {
        cleanup();
        if (signal?.aborted) {
          reject(Object.assign(new Error("WORKER_ABORTED"), { code: "WORKER_ABORTED" }));
          return;
        }
        try {
          const parsed = JSON.parse(stdout || "{}");
          if (code === 0 || parsed.code) resolvePromise(parsed);
          else reject(Object.assign(new Error(stderr || `worker exited ${code}`), { code: "WORKER_FAILED" }));
        } catch { reject(Object.assign(new Error(stderr || stdout || `worker exited ${code}`), { code: "WORKER_PROTOCOL_ERROR" })); }
      });
      child.stdin.end(JSON.stringify(payload));
    });
  }
}
