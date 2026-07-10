import { createHash, randomUUID } from "node:crypto";
import { access, appendFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { delimiter, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { compileInvestigation, getEarthRuntimeContract, listEarthRuntimeContracts, searchCatalog, validateAdapterPack, validateDatasetDescriptor, validateInvestigationSpec, type AdapterVerification, type DatasetDescriptor, type EarthAdapterPack, type EarthJob, type EarthLocalExportRequest, type EarthSkillDefinition, type EarthStoryArtifact, type EarthVisualization, type InvestigationPlan, type InvestigationSpec } from "../../earth-investigation-core/src/index.ts";
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

export class EarthWorkspace {
  readonly root: string;
  readonly python: string;
  readonly worker: string;
  readonly skillPublishRoot: string;
  private readonly activeWorkers = new Map<string, ReturnType<typeof spawn>>();
  private readonly visualizationCache = new Map<string, { value: EarthVisualization; expiresAt: number }>();

  constructor(root = process.env.SCOUTPI_EARTH_ROOT ?? ".scoutpi/earth_workspace", python = process.env.SCOUTPI_EARTH_PYTHON ?? resolve(".venv/bin/python"), skillPublishRoot = process.env.SCOUTPI_SKILL_PUBLISH_ROOT ?? resolve(".pi", "skills")) {
    this.root = resolve(root);
    this.python = python;
    this.worker = join(packageRoot, "python", "worker.py");
    this.skillPublishRoot = resolve(skillPublishRoot);
  }

  async init(): Promise<void> {
    await Promise.all(["plans", "jobs", "recipes", "stories", "analysis", "adapters", "skills"].map((name) => mkdir(join(this.root, name), { recursive: true })));
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

  async probeAdapter(datasetId: string, input: { region?: InvestigationSpec["region"]; year?: number; cloudProject?: string } = {}): Promise<RegisteredEarthAdapter> {
    const stored = await this.getAdapter(datasetId);
    const result = await this.callWorker({ op: "probe_adapter", adapter: stored.adapter, ...input }).catch((error) => ({ ok: false, code: error.code || "ADAPTER_PROBE_FAILED", error: error.message || String(error) }));
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

  async environment(cloudProject?: string): Promise<Record<string, unknown>> {
    return await this.callWorker({ op: "environment", cloudProject });
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

  async run(planId: string, options: { mode?: "dry_run" | "live"; confirmed?: boolean; confirmedUnverifiedAdapters?: boolean; execution?: "inline" | "drive"; cloudProject?: string; driveFolder?: string; outputs?: string[] } = {}): Promise<EarthJob> {
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
    let job: EarthJob = { jobId, planId, mode, state: "running", createdAt: now, updatedAt: now, taskIds: [], artifactDir };
    await writeJson(join(artifactDir, "job.json"), job);
    const workerResult = await this.callWorker({ op: "run", mode, plan, options, artifactDir }).catch((error) => ({ ok: false, code: error.code || "WORKER_FAILED", error: error.message || String(error) }));
    const taskIds = Array.isArray(workerResult.taskIds) ? workerResult.taskIds.map(String) : [];
    job = {
      ...job,
      state: workerResult.ok === true ? (mode === "live" && taskIds.length > 0 ? "running" : "completed") : workerResult.code === "GEE_AUTH_REQUIRED" || workerResult.code === "GEE_NOT_INSTALLED" ? "blocked_auth" : "failed",
      updatedAt: new Date().toISOString(),
      taskIds,
      result: workerResult.ok === true ? workerResult : undefined,
      error: workerResult.ok === true ? undefined : String(workerResult.error || workerResult.code || "worker failed"),
    };
    await writeJson(join(artifactDir, "job.json"), job);
    return job;
  }

  async status(jobId: string, refresh = false): Promise<EarthJob> {
    safeId(jobId, "jobId");
    const path = join(this.root, "jobs", jobId, "job.json");
    const job = await readJson<EarthJob>(path);
    if (!refresh || job.mode !== "live" || job.taskIds.length === 0) return job;
    const result = await this.callWorker({ op: "status", taskIds: job.taskIds, cloudProject: process.env.EARTHENGINE_PROJECT }).catch(() => null);
    if (result?.ok) {
      const tasks = Array.isArray(result.tasks) ? result.tasks as EarthTaskStatus[] : [];
      job.result = { ...(job.result || {}), taskStatus: tasks };
      job.state = deriveEarthJobState(tasks, job.state);
      const failed = tasks.find((task) => String(task.state).toUpperCase() === "FAILED");
      job.error = failed ? String(failed.error_message || failed.errorMessage || "Earth Engine task failed") : undefined;
      job.updatedAt = new Date().toISOString();
      await writeJson(path, job);
    }
    return job;
  }

  async visualize(planId: string, input: { role: string; year: number; cloudProject?: string }): Promise<EarthVisualization> {
    const plan = await this.getPlan(planId);
    const role = String(input.role || "");
    if (!plan.datasets.some((item) => item.role === role)) throw Object.assign(new Error(`role ${role} is not part of plan ${planId}`), { code: "VISUALIZATION_ROLE_INVALID" });
    if (!Number.isInteger(input.year) || input.year < plan.spec.period.startYear || input.year > plan.spec.period.endYear) throw Object.assign(new Error("visualization year is outside the plan period"), { code: "VISUALIZATION_YEAR_INVALID" });
    const cacheKey = `${planId}:${role}:${input.year}:${input.cloudProject || process.env.EARTHENGINE_PROJECT || "default"}`;
    const cached = this.visualizationCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.value, cacheHit: true, cacheExpiresAt: new Date(cached.expiresAt).toISOString() };
    const result = await this.callWorker({ op: "visualize", plan, role, year: input.year, cloudProject: input.cloudProject });
    if (!result?.ok) throw Object.assign(new Error(String(result?.error || "visualization failed")), { code: result?.code || "VISUALIZATION_FAILED" });
    const expiresAt = Date.now() + 15 * 60 * 1000;
    const value = { ...(result as EarthVisualization), cacheHit: false, cacheExpiresAt: new Date(expiresAt).toISOString() };
    this.visualizationCache.set(cacheKey, { value, expiresAt });
    return value;
  }

  async exportLocal(planId: string, input: EarthLocalExportRequest): Promise<EarthJob> {
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
    void this.finishLocalExport(job, plan, request);
    return job;
  }

  async retryLocalExport(jobId: string, confirmed = false): Promise<EarthJob> {
    const job = await this.status(jobId);
    const request = await readJson<EarthLocalExportRequest>(join(job.artifactDir, "export_request.json"));
    return await this.exportLocal(job.planId, { ...request, confirmed });
  }

  private async finishLocalExport(job: EarthJob, plan: InvestigationPlan, request: EarthLocalExportRequest): Promise<void> {
    const result = await this.callWorker({ op: "export_local", plan, request, artifactDir: job.artifactDir }, job.jobId).catch((error) => ({ ok: false, code: error.code || "LOCAL_EXPORT_FAILED", error: error.message || String(error) }));
    const path = join(job.artifactDir, "job.json");
    let latest: EarthJob;
    try { latest = await readJson<EarthJob>(path); } catch { return; }
    if (latest.state === "cancelled") return;
    latest.state = result.ok === true ? "completed" : result.code === "GEE_AUTH_REQUIRED" || result.code === "GEE_NOT_INSTALLED" ? "blocked_auth" : "failed";
    latest.updatedAt = new Date().toISOString();
    latest.result = result.ok === true ? { ...(latest.result || {}), ...result } : latest.result;
    latest.error = result.ok === true ? undefined : String(result.error || result.code || "local export failed");
    await writeJson(path, latest);
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
      const result = await this.callWorker({ op: "cancel", taskIds: job.taskIds, cloudProject });
      if (!result?.ok) throw Object.assign(new Error(String(result?.error || "Earth Engine cancellation failed")), { code: result?.code || "CANCEL_FAILED" });
      job.result = { ...(job.result || {}), cancellation: result.tasks || [] };
    }
    job.state = "cancelled";
    job.updatedAt = new Date().toISOString();
    await writeJson(path, job);
    return job;
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

  async analyze(inputPath: string, columns?: string[]): Promise<Record<string, unknown>> {
    const absolute = resolve(inputPath);
    const allowedRoots = (process.env.SCOUTPI_EARTH_ANALYSIS_ROOTS || [this.root, resolve("exports"), resolve("data")].join(delimiter)).split(delimiter).filter(Boolean).map((root) => resolve(root));
    if (!allowedRoots.some((root) => absolute === root || absolute.startsWith(`${root}${sep}`))) throw Object.assign(new Error("ANALYSIS_PATH_BLOCKED: input is outside allowed roots"), { code: "ANALYSIS_PATH_BLOCKED" });
    await access(absolute);
    const result = await this.callWorker({ op: "analyze", path: absolute, columns, artifactDir: join(this.root, "analysis") });
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

  protected async callWorker(payload: Record<string, unknown>, workerId?: string): Promise<any> {
    return await new Promise((resolvePromise, reject) => {
      const child = spawn(this.python, [this.worker], { stdio: ["pipe", "pipe", "pipe"] });
      if (workerId) this.activeWorkers.set(workerId, child);
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", (error) => {
        if (workerId) this.activeWorkers.delete(workerId);
        reject(error);
      });
      child.on("close", (code) => {
        if (workerId) this.activeWorkers.delete(workerId);
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
