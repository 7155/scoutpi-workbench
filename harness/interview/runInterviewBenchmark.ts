import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import setupEarthPi from "../../.pi/extensions/scoutpi-earth/index.ts";
import { EarthWorkspace, type EarthAdapterPack, type InvestigationSpec } from "../../packages/earth-workspace/src/index.ts";
import { buildContextPack, type ContextCandidate } from "../../packages/runtime-context/src/index.ts";
import { EvaluationStore, type EvaluationMetric, type EvaluationReport } from "../../packages/runtime-evaluation/src/index.ts";
import { MixedTextTokenEstimator } from "../../packages/runtime-telemetry/src/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const estimator = new MixedTextTokenEstimator();
const createdAt = new Date();
const runId = `interview_${createdAt.toISOString().replace(/[^0-9]/g, "").slice(0, 17)}_${randomUUID().slice(0, 8)}`;
const outputDir = join(root, "exports/interview_benchmarks", runId);
const temporaryRoot = await mkdtemp(join(tmpdir(), "scoutpi-interview-benchmark-"));

class DeterministicInterviewWorkspace extends EarthWorkspace {
  protected override async callWorker(payload: Record<string, any>): Promise<any> {
    if (payload.op === "probe_adapter") {
      const requestedBands = payload.adapter?.preprocessing?.requiredBands || [];
      return { ok: true, sampleCount: 2, availableBands: requestedBands, requestedBands, outputBands: payload.adapter?.preprocessing?.outputBands || [], sampleTime: "2024-07-01" };
    }
    if (payload.op === "run") {
      await mkdir(payload.artifactDir, { recursive: true });
      await writeFile(join(payload.artifactDir, "execution_manifest.json"), `${JSON.stringify({ mode: payload.mode, fixture: "deterministic-interview" }, null, 2)}\n`);
      return { ok: true, mode: payload.mode, execution: "inline", taskIds: [], artifact: "execution_manifest.json" };
    }
    if (payload.op === "environment") return { ok: true, installed: true, authenticated: true, backends: [] };
    return { ok: true };
  }
}

function improvement(baseline: number, current: number): number {
  return baseline > 0 ? Math.round((baseline - current) / baseline * 10_000) / 100 : 0;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

async function toolSurfaceBenchmark() {
  const previousEarth = process.env.SCOUTPI_EARTH_ROOT;
  const previousEcosystem = process.env.SCOUTPI_ECOSYSTEM_ROOT;
  process.env.SCOUTPI_EARTH_ROOT = join(temporaryRoot, "tool-surface-earth");
  process.env.SCOUTPI_ECOSYSTEM_ROOT = join(temporaryRoot, "tool-surface-ecosystem");
  try {
    const tools: any[] = [];
    let active: string[] = [];
    await setupEarthPi({
      registerTool(tool: any) { tools.push(tool); },
      getActiveTools() { return active; },
      setActiveTools(names: string[]) { active = names; },
      getAllTools() { return tools; },
      getCommands() { return []; },
      on() {},
      registerCommand() {},
    } as any);
    const workspace = new EarthWorkspace(process.env.SCOUTPI_EARTH_ROOT);
    const surface = tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
    const contractNames = (workspace.contract() as { contracts: string[] }).contracts;
    const eager = { tools: surface, contracts: contractNames.map((name) => workspace.contract(name)) };
    const currentTokens = estimator.estimate(JSON.stringify(surface));
    const baselineTokens = estimator.estimate(JSON.stringify(eager));
    return { toolNames: tools.map((tool) => tool.name), contractCount: contractNames.length, baselineTokens, currentTokens, improvementPercent: improvement(baselineTokens, currentTokens) };
  } finally {
    if (previousEarth === undefined) delete process.env.SCOUTPI_EARTH_ROOT; else process.env.SCOUTPI_EARTH_ROOT = previousEarth;
    if (previousEcosystem === undefined) delete process.env.SCOUTPI_ECOSYSTEM_ROOT; else process.env.SCOUTPI_ECOSYSTEM_ROOT = previousEcosystem;
  }
}

async function contextBenchmark() {
  const candidates = JSON.parse(await readFile(join(root, "harness/interview/fixtures/context-candidates.json"), "utf8")) as ContextCandidate[];
  const query = "Explain ScoutPi tool token budgets, governance, workflow replay, evidence and recovery for an interview.";
  const baselineTokens = estimator.estimate(JSON.stringify(candidates));
  const pack = buildContextPack({ sessionId: "interview-benchmark", query, candidates, maxTokens: 420, now: createdAt });
  return {
    candidateCount: candidates.length,
    selectedCount: pack.budget.selectedCount,
    selectedIds: pack.items.map((item) => item.candidateId),
    baselineTokens,
    currentTokens: pack.budget.deliveredTokens,
    improvementPercent: improvement(baselineTokens, pack.budget.deliveredTokens),
    estimator: pack.budget.estimator,
  };
}

async function workflowBenchmark() {
  const workspace = new DeterministicInterviewWorkspace(join(temporaryRoot, "workflow"));
  const pack = JSON.parse(await readFile(join(root, "examples/adapter-packs/earth-engine-starter.json"), "utf8")) as EarthAdapterPack;
  await workspace.importAdapterPack(pack, "example");
  for (const adapter of pack.adapters) await workspace.probeAdapter(adapter.datasetId);
  const spec: InvestigationSpec = {
    schemaVersion: "scoutpi.investigation.v1",
    investigationId: "interview-workflow-source",
    question: "Did the vegetation proxy change within the review area?",
    phenomenon: "generic_change",
    region: { kind: "bbox", bbox: [121.45, 31.18, 121.50, 31.23], name: "Interview review area" },
    period: { startYear: 2020, endYear: 2024, startMonth: 6, endMonth: 8 },
    hypotheses: [{ id: "h1", statement: "The vegetation proxy changed.", observableRoles: ["vegetation"], falsification: "No comparable same-season change is observed." }],
    confounders: ["Compare the same season and retain cloud-mask uncertainty."],
    preferredOutputs: ["yearly_csv", "metrics_json"],
  };
  const sourceStarted = performance.now();
  const planned = await workspace.plan(spec);
  const job = await workspace.run(planned.plan.planId, { mode: "dry_run" });
  const compiled = await workspace.compileWorkflow({ workflowId: "interview-workflow", name: "Interview workflow replay", planId: planned.plan.planId, jobId: job.jobId, stage: "ready" });
  const sourceElapsedMs = performance.now() - sourceStarted;
  const replayStarted = performance.now();
  const replayed = await workspace.replayWorkflow(compiled.stored.workflow.workflowId, { patch: { investigationId: "interview-workflow-replay" }, confirmed: true });
  const replayElapsedMs = performance.now() - replayStarted;
  const artifacts = replayed.job ? (await workspace.listJobArtifacts(replayed.job.jobId)).filter((item) => item.name !== "job.json").length : 0;
  return {
    sourceControlCalls: 3,
    replayControlCalls: 1,
    improvementPercent: improvement(3, 1),
    sourceElapsedMs: Math.round(sourceElapsedMs * 100) / 100,
    replayElapsedMs: Math.round(replayElapsedMs * 100) / 100,
    replayState: replayed.replay.state,
    artifactCount: artifacts,
    adapterAssertionsPassed: replayed.replay.assertions.every((assertion) => assertion.ok),
  };
}

try {
  await mkdir(outputDir, { recursive: true });
  // The Pi extension can flush small registry files after setup; keep fixture phases ordered.
  const toolSurface = await toolSurfaceBenchmark();
  const context = await contextBenchmark();
  const workflow = await workflowBenchmark();
  const checks = [
    { checkId: "three_gateway_tools", label: "Exactly three Pi Earth gateway tools", status: toolSurface.toolNames.length === 3 ? "passed" as const : "failed" as const, detail: toolSurface.toolNames.join(", ") },
    { checkId: "context_budget", label: "Context Pack honors the 420-token fixture budget", status: context.currentTokens <= 420 ? "passed" as const : "failed" as const, detail: `${context.selectedCount}/${context.candidateCount} candidates selected` },
    { checkId: "workflow_replay", label: "Deterministic workflow replay completes with assertions", status: workflow.replayState === "completed" && workflow.adapterAssertionsPassed ? "passed" as const : "failed" as const, detail: `${workflow.artifactCount} replay artifacts` },
  ];
  const state = checks.every((check) => check.status === "passed") ? "passed" as const : "failed" as const;
  const benchmark = { schemaVersion: "scoutpi.interview-benchmark.v1", runId, createdAt: createdAt.toISOString(), state, estimator: estimator.name, toolSurface, context, workflow, privacy: { promptsStored: false, credentialsStored: false, providerUrlsStored: false } };
  const benchmarkBody = `${JSON.stringify(benchmark, null, 2)}\n`;
  await writeFile(join(outputDir, "report.json"), benchmarkBody);
  const metrics: EvaluationMetric[] = [
    { metricId: "tool_schema_tokens", label: "Eager contracts vs gateway schema", value: toolSurface.currentTokens, unit: "tokens", baseline: toolSurface.baselineTokens, current: toolSurface.currentTokens, improvementPercent: toolSurface.improvementPercent, direction: "lower_is_better", detail: `${toolSurface.contractCount} contracts disclosed on demand` },
    { metricId: "context_tokens", label: "All candidates vs Context Pack", value: context.currentTokens, unit: "tokens", baseline: context.baselineTokens, current: context.currentTokens, improvementPercent: context.improvementPercent, direction: "lower_is_better", detail: `${context.selectedCount}/${context.candidateCount} task-ranked candidates` },
    { metricId: "workflow_calls", label: "Exploration controls vs replay", value: workflow.replayControlCalls, unit: "calls", baseline: workflow.sourceControlCalls, current: workflow.replayControlCalls, improvementPercent: workflow.improvementPercent, direction: "lower_is_better", detail: "Replay validates frozen adapter fingerprints and assertions" },
    { metricId: "workflow_replay_ms", label: "Deterministic replay latency", value: workflow.replayElapsedMs, unit: "ms", direction: "lower_is_better" },
  ];
  const evaluation: EvaluationReport = {
    schemaVersion: "scoutpi.evaluation.v1",
    evaluationId: runId,
    kind: "benchmark",
    title: "Interview efficiency benchmark",
    state,
    createdAt: createdAt.toISOString(),
    summary: "Measured current gateway disclosure, Context Pack budgeting and deterministic workflow replay on fixed local fixtures.",
    metrics,
    checks,
    privacy: { rawPromptStored: false, rawToolPayloadStored: false, credentialsStored: false, providerUrlStored: false },
    provenance: { source: "interview-benchmark", command: "pnpm harness:interview", sourceSha256: sha256(benchmarkBody) },
  };
  await new EvaluationStore(join(root, ".scoutpi/evaluations")).save(evaluation);
  console.log(JSON.stringify({ ok: state === "passed", state, report: join(outputDir, "report.json"), metrics }, null, 2));
  if (state !== "passed") process.exitCode = 1;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
