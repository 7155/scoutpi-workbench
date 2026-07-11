import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EarthWorkspace, type EarthAdapterPack, type InvestigationSpec } from "../../packages/earth-workspace/src/index.ts";
import { EvaluationStore, type EvaluationReport } from "../../packages/runtime-evaluation/src/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const createdAt = new Date();
const runId = `demo_${createdAt.toISOString().replace(/[^0-9]/g, "").slice(0, 17)}_${randomUUID().slice(0, 8)}`;
const runDir = join(root, "exports/interview_runs", runId);
const workspaceRoot = join(runDir, "workspace");
const browserRoot = join(runDir, "browser_runs");
const evidenceRoot = join(runDir, "evidence");
const previousBrowserRoots = process.env.SCOUTPI_BROWSER_EVIDENCE_ROOTS;
const previousEvidenceRoot = process.env.SCOUTPI_EVIDENCE_ROOT;
const pixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

try {
  await mkdir(browserRoot, { recursive: true });
  process.env.SCOUTPI_BROWSER_EVIDENCE_ROOTS = browserRoot;
  process.env.SCOUTPI_EVIDENCE_ROOT = evidenceRoot;
  const browserRun = join(browserRoot, "run_demo");
  const screenshots = join(browserRun, "screenshots");
  await mkdir(screenshots, { recursive: true });
  const screenshotPath = join(screenshots, "claim.png");
  await writeFile(screenshotPath, pixelPng);
  const evidenceCardsPath = join(browserRun, "evidence_cards.json");
  await writeFile(evidenceCardsPath, `${JSON.stringify([{
    evidenceId: "interview-browser-evidence",
    commandId: "browser-command-demo",
    url: "https://example.com/public-project-notice",
    title: "Public project milestone notice",
    capturedAt: createdAt.toISOString(),
    summary: "The public notice records a 2024 construction milestone while final acceptance remains pending.",
    extractedText: "A construction milestone was reported in 2024. Final acceptance remains pending.",
    screenshotPath,
    sourceType: "public_webpage",
    trust: "high",
  }], null, 2)}\n`);

  const workspace = new DeterministicInterviewWorkspace(workspaceRoot);
  const adapterPack = JSON.parse(await readFile(join(root, "examples/adapter-packs/earth-engine-starter.json"), "utf8")) as EarthAdapterPack;
  await workspace.importAdapterPack(adapterPack, "example");
  for (const adapter of adapterPack.adapters) await workspace.probeAdapter(adapter.datasetId);
  const spec: InvestigationSpec = {
    schemaVersion: "scoutpi.investigation.v1",
    investigationId: "interview-generic-investigation",
    question: "Does the documented milestone have corresponding observable land-surface evidence?",
    phenomenon: "generic_change",
    region: { kind: "bbox", bbox: [121.45, 31.18, 121.50, 31.23], name: "Generic review area" },
    period: { startYear: 2020, endYear: 2024, startMonth: 6, endMonth: 8 },
    hypotheses: [{ id: "h1", statement: "A comparable built-surface proxy changed by 2024.", observableRoles: ["built_surface"], falsification: "No same-season proxy change is observed." }],
    confounders: ["Use the same season.", "Classification probabilities are not field acceptance evidence."],
    claims: [{ claimId: "claim-milestone", claim: "A construction milestone was reported in 2024.", sourceUrl: "https://example.com/public-project-notice", time: "2024", location: "Generic review area", trust: "high" }],
    preferredOutputs: ["yearly_csv", "metrics_json", "story"],
  };
  const planned = await workspace.plan(spec);
  const dryRun = await workspace.run(planned.plan.planId, { mode: "dry_run" });
  const imported = await workspace.importBrowserEvidence(evidenceCardsPath, {
    binding: { investigationId: spec.investigationId, claimId: "claim-milestone", hypothesisId: "h1", relation: "contextualizes" },
    timeReferences: ["2024"],
    placeReferences: ["Generic review area"],
    runId,
    snapshotId: "snapshot-demo",
  });
  const story = await workspace.story({
    schemaVersion: "scoutpi.earth.story.v1",
    investigationId: spec.investigationId,
    question: spec.question,
    claims: [{ claimId: "claim-milestone", claim: imported.records[0].claim.text, sourceUrl: imported.records[0].source.url, evidenceArtifact: imported.records[0].evidenceId, trust: "primary" }],
    findings: [{ hypothesisId: "h1", status: "mixed", evidence: ["The public milestone is documented; the dry run validates execution structure but is not computed scientific evidence."] }],
    metrics: {},
    layers: [],
    charts: [],
    uncertainties: ["A reviewed live computation and independent acceptance evidence are still required."],
    provenance: { planId: planned.plan.planId },
  });
  const graph = await workspace.evidenceGraph(spec.investigationId);
  const compiled = await workspace.compileWorkflow({ workflowId: "interview-generic-workflow", name: "Generic claim-to-evidence workflow", description: "Replays the typed investigation without replaying narrative findings.", planId: planned.plan.planId, jobId: dryRun.jobId, stage: "ready" });
  const replayed = await workspace.replayWorkflow(compiled.stored.workflow.workflowId, { patch: { investigationId: "interview-generic-replay" }, confirmed: true });
  const sourceArtifacts = (await workspace.listJobArtifacts(dryRun.jobId)).filter((item) => item.name !== "job.json");
  const replayArtifacts = replayed.job ? (await workspace.listJobArtifacts(replayed.job.jobId)).filter((item) => item.name !== "job.json") : [];
  const checks = [
    { checkId: "browser_evidence", label: "Browser evidence normalized and bound", status: imported.records.length === 1 && graph.coverage.browserEvidence === 1 ? "passed" as const : "failed" as const, detail: `${graph.coverage.browserEvidence} browser source` },
    { checkId: "typed_plan", label: "Investigation compiled into a typed plan", status: planned.plan.datasets.length > 0 && planned.plan.dag.length > 0 ? "passed" as const : "failed" as const, detail: `${planned.plan.datasets.length} datasets and ${planned.plan.dag.length} DAG nodes` },
    { checkId: "dry_run_boundary", label: "Dry run not counted as computed evidence", status: dryRun.state === "completed" && graph.coverage.computedRuns === 0 ? "passed" as const : "failed" as const, detail: `computed runs=${graph.coverage.computedRuns}` },
    { checkId: "evidence_review", label: "Evidence Reviewer accepts uncertainty-bound story", status: story.review.status === "passed" ? "passed" as const : "failed" as const, detail: `review=${story.review.status}` },
    { checkId: "workflow_replay", label: "Successful trace replays deterministically", status: replayed.replay.state === "completed" && replayed.replay.assertions.every((item) => item.ok) ? "passed" as const : "failed" as const, detail: `replay=${replayed.replay.state}` },
    { checkId: "no_live_compute", label: "Interview demo performs no live compute", status: (await workspace.listJobs()).every((job) => job.mode === "dry_run") ? "passed" as const : "failed" as const, detail: "All jobs remain deterministic dry runs" },
  ];
  const state = checks.every((check) => check.status === "passed") ? "passed" as const : "failed" as const;
  const report = {
    schemaVersion: "scoutpi.interview-demo.v1",
    runId,
    createdAt: createdAt.toISOString(),
    state,
    stages: ["browser_evidence", "investigation_plan", "dry_run", "evidence_review", "evidence_graph", "workflow_compile", "workflow_replay"],
    outcomes: { datasets: planned.plan.datasets.length, dagNodes: planned.plan.dag.length, browserEvidence: graph.coverage.browserEvidence, sourceArtifacts: sourceArtifacts.length, replayArtifacts: replayArtifacts.length, review: story.review.status, replay: replayed.replay.state, liveJobs: (await workspace.listJobs()).filter((job) => job.mode === "live").length },
    checks,
    privacy: { credentialsStored: false, providerUrlStored: false, modelCalled: false },
  };
  const body = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(join(runDir, "report.json"), body);
  const evaluation: EvaluationReport = {
    schemaVersion: "scoutpi.evaluation.v1",
    evaluationId: runId,
    kind: "end_to_end",
    title: "Claim-to-spatial-evidence interview demo",
    state,
    createdAt: createdAt.toISOString(),
    summary: "A generic public claim was bound to a typed spatial investigation, reviewed, compiled and replayed without live compute or model narration.",
    metrics: [
      { metricId: "stages", label: "Verified stages", value: report.stages.length, unit: "count", direction: "higher_is_better" },
      { metricId: "browser_evidence", label: "Bound browser evidence", value: graph.coverage.browserEvidence, unit: "count", direction: "higher_is_better" },
      { metricId: "artifacts", label: "Dry-run artifacts", value: sourceArtifacts.length + replayArtifacts.length, unit: "count", direction: "higher_is_better" },
      { metricId: "live_jobs", label: "Live jobs", value: report.outcomes.liveJobs, unit: "count", direction: "lower_is_better" },
      { metricId: "model_calls", label: "Model calls in deterministic demo", value: 0, unit: "calls", direction: "lower_is_better" },
    ],
    checks,
    privacy: { rawPromptStored: false, rawToolPayloadStored: false, credentialsStored: false, providerUrlStored: false },
    provenance: { source: "interview-demo", command: "pnpm harness:interview-demo", sourceSha256: sha256(body) },
  };
  await new EvaluationStore(join(root, ".scoutpi/evaluations")).save(evaluation);
  console.log(JSON.stringify({ ok: state === "passed", state, report: join(runDir, "report.json"), outcomes: report.outcomes }, null, 2));
  if (state !== "passed") process.exitCode = 1;
} finally {
  if (previousBrowserRoots === undefined) delete process.env.SCOUTPI_BROWSER_EVIDENCE_ROOTS; else process.env.SCOUTPI_BROWSER_EVIDENCE_ROOTS = previousBrowserRoots;
  if (previousEvidenceRoot === undefined) delete process.env.SCOUTPI_EVIDENCE_ROOT; else process.env.SCOUTPI_EVIDENCE_ROOT = previousEvidenceRoot;
}
