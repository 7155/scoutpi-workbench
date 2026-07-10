import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { EarthAdapterPack, InvestigationSpec } from "../packages/earth-investigation-core/src/index.ts";
import { earthWorkflowFingerprint } from "../packages/earth-workflow-compiler/src/index.ts";
import { EarthWorkspace } from "../packages/earth-workspace/src/index.ts";
import { createEarthWorkspaceServer } from "../packages/earth-workspace-server/src/server.ts";

const starterPack = JSON.parse(await readFile(new URL("../examples/adapter-packs/earth-engine-starter.json", import.meta.url), "utf8")) as EarthAdapterPack;
const sentinel = starterPack.adapters.find((adapter) => adapter.datasetId === "sentinel2-sr")!;

function spec(investigationId: string, bbox: [number, number, number, number] = [121, 31, 121.02, 31.02]): InvestigationSpec {
  return {
    schemaVersion: "scoutpi.investigation.v1",
    investigationId,
    question: "Did vegetation change in the same seasonal window?",
    region: { kind: "bbox", bbox, name: "workflow fixture" },
    period: { startYear: 2020, endYear: 2021, startMonth: 5, endMonth: 9 },
    hypotheses: [{ id: "h1", statement: "Vegetation changed", observableRoles: ["vegetation"] }],
    confounders: ["Compare the same months."],
    preferredOutputs: ["yearly_csv"],
  };
}

class WorkflowWorkspace extends EarthWorkspace {
  protected override async callWorker(payload: Record<string, unknown>): Promise<any> {
    if (payload.op === "probe_adapter") return { ok: true, sampleCount: 2, availableBands: ["B4", "B8", "SCL"], requestedBands: ["B4", "B8", "SCL"], outputBands: ["ndvi"], sampleTime: "2021-06-01" };
    if (payload.op === "run") return { ok: true, mode: payload.mode, execution: "inline", taskIds: [], artifact: "fixture/execution_manifest.json" };
    if (payload.op === "environment") return { ok: true, installed: true, authenticated: true, backends: [] };
    return { ok: true };
  }
}

async function verifiedSource(workspace: WorkflowWorkspace, investigationId: string) {
  await workspace.registerAdapter(sentinel, "example");
  await workspace.probeAdapter(sentinel.datasetId);
  const planned = await workspace.plan(spec(investigationId));
  const job = await workspace.run(planned.plan.planId, { mode: "dry_run", outputs: ["yearly_csv"] });
  return { planned, job };
}

test("successful verified jobs become replayable workflow candidates without narrative output", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-workflow-"));
  try {
    const workspace = new WorkflowWorkspace(root, process.execPath);
    const { planned, job } = await verifiedSource(workspace, "workflow-source");
    assert.equal(job.state, "completed");
    assert.equal((job.result?.workflowCandidate as any).workflowId, "auto-workflow-source");

    const candidate = await workspace.getWorkflow("auto-workflow-source");
    assert.equal(candidate.stage, "candidate");
    assert.equal(candidate.workflow.safety.doesNotReplayNarrative, true);
    assert.deepEqual(candidate.workflow.expectedArtifacts, ["execution_manifest"]);
    assert.equal(candidate.workflow.preconditions[0]?.kind, "adapter_probe_passed");
    assert.equal(JSON.stringify(candidate.workflow).includes("EarthStory"), false);
    await assert.rejects(() => workspace.replayWorkflow("auto-workflow-source"), /WORKFLOW_CONFIRMATION_REQUIRED/);

    const promoted = await workspace.compileWorkflow({
      workflowId: candidate.workflow.workflowId,
      name: candidate.workflow.name,
      description: candidate.workflow.description,
      planId: planned.plan.planId,
      jobId: job.jobId,
      stage: "ready",
    });
    assert.equal(promoted.stored.stage, "ready");
    assert.deepEqual({ ...promoted.stored.workflow, provenance: { ...promoted.stored.workflow.provenance, compiledAt: "" } }, { ...candidate.workflow, provenance: { ...candidate.workflow.provenance, compiledAt: "" } });
    assert.equal(candidate.fingerprint, earthWorkflowFingerprint(candidate.workflow));
    assert.equal(promoted.stored.fingerprint, candidate.fingerprint);
    assert.equal(promoted.stored.revision, 1);

    const replayed = await workspace.replayWorkflow("auto-workflow-source", { patch: { investigationId: "workflow-replay" } });
    assert.equal(replayed.replay.state, "completed");
    assert.equal(replayed.plan?.spec.investigationId, "workflow-replay");
    assert.notEqual(replayed.job?.jobId, job.jobId);
    assert.equal((await workspace.listWorkflows()).length, 1);
    const after = await workspace.getWorkflow("auto-workflow-source");
    assert.equal(after.replayCount, 2);
    assert.equal(after.successCount, 1);
    assert.equal(after.failureCount, 1);
    assert.equal((await workspace.telemetrySummary()).calls.workflow >= 3, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workflow replay blocks adapter drift and cost expansion instead of silently repairing it", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-workflow-guards-"));
  try {
    const workspace = new WorkflowWorkspace(root, process.execPath);
    const { planned, job } = await verifiedSource(workspace, "guard-source");
    const candidate = await workspace.getWorkflow("auto-guard-source");
    await workspace.compileWorkflow({ workflowId: candidate.workflow.workflowId, name: candidate.workflow.name, description: candidate.workflow.description, planId: planned.plan.planId, jobId: job.jobId, stage: "ready" });

    await assert.rejects(
      () => workspace.replayWorkflow("auto-guard-source", { patch: { investigationId: "larger-region", region: { kind: "bbox", bbox: [120.8, 30.8, 121.4, 31.4], name: "larger" } } }),
      /WORKFLOW_COST_INCREASE_CONFIRMATION_REQUIRED/,
    );

    await workspace.registerAdapter({ ...sentinel, title: `${sentinel.title} revised` }, "human");
    await workspace.probeAdapter(sentinel.datasetId);
    await assert.rejects(() => workspace.replayWorkflow("auto-guard-source", { confirmedCostIncrease: true }), /WORKFLOW_ADAPTER_DRIFT/);
    const runs = await workspace.listWorkflowRuns();
    assert.equal(runs.filter((run) => run.state === "blocked").length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Workbench API compiles, lists and deterministically replays workflows", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-workflow-api-"));
  const workspace = new WorkflowWorkspace(root, process.execPath);
  const { planned, job } = await verifiedSource(workspace, "workflow-api");
  const runtime = await createEarthWorkspaceServer({ host: "127.0.0.1", port: 0, workspace });
  await runtime.listen();
  const address = runtime.server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const compiledResponse = await fetch(`${base}/api/workflows/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workflowId: "api-ready-workflow", name: "API ready workflow", planId: planned.plan.planId, jobId: job.jobId, stage: "ready" }),
    });
    assert.equal(compiledResponse.status, 201);
    const listed: any = await (await fetch(`${base}/api/workflows`)).json();
    assert.equal(listed.workflows.some((row: any) => row.workflowId === "api-ready-workflow" && row.stage === "ready"), true);
    const replay: any = await (await fetch(`${base}/api/workflows/api-ready-workflow/replay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patch: { investigationId: "api-replay-copy" } }),
    })).json();
    assert.equal(replay.replay.state, "completed");
    const status: any = await (await fetch(`${base}/api/workflow-runs/${replay.replay.replayId}`)).json();
    assert.equal(status.jobId, replay.job.jobId);
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});
