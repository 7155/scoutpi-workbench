import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import setupTriggers from "../.pi/extensions/scoutpi-triggers/index.ts";
import type { EarthAdapterPack, InvestigationSpec } from "../packages/earth-investigation-core/src/index.ts";
import { EarthWorkspace } from "../packages/earth-workspace/src/index.ts";
import { createEarthWorkspaceServer } from "../packages/earth-workspace-server/src/server.ts";
import { TriggerRuntime } from "../packages/runtime-trigger/src/index.ts";

const starterPack = JSON.parse(await readFile(new URL("../examples/adapter-packs/earth-engine-starter.json", import.meta.url), "utf8")) as EarthAdapterPack;
const sentinel = starterPack.adapters.find((adapter) => adapter.datasetId === "sentinel2-sr")!;

class TriggerWorkspace extends EarthWorkspace {
  protected override async callWorker(payload: Record<string, unknown>): Promise<any> {
    if (payload.op === "probe_adapter") return { ok: true, sampleCount: 2, availableBands: ["B4", "B8", "SCL"], requestedBands: ["B4", "B8", "SCL"], outputBands: ["ndvi"], sampleTime: "2024-06-01" };
    if (payload.op === "run") return { ok: true, mode: payload.mode, execution: "inline", taskIds: [], artifact: "fixture/execution_manifest.json" };
    if (payload.op === "environment") return { ok: true, installed: true, authenticated: true, backends: [] };
    return { ok: true };
  }
}

function investigation(investigationId: string): InvestigationSpec {
  return {
    schemaVersion: "scoutpi.investigation.v1",
    investigationId,
    question: "Did the selected observable change in a comparable seasonal window?",
    region: { kind: "bbox", bbox: [121, 31, 121.02, 31.02], name: "trigger fixture" },
    period: { startYear: 2023, endYear: 2024, startMonth: 5, endMonth: 9 },
    hypotheses: [{ id: "h1", statement: "The observable changed.", observableRoles: ["vegetation"] }],
    confounders: ["Compare the same months."],
  };
}

async function readyWorkflow(workspace: TriggerWorkspace, investigationId: string, mode: "dry_run" | "live" = "dry_run") {
  if (!(await workspace.listAdapters()).some((item) => item.adapter.datasetId === sentinel.datasetId)) {
    await workspace.registerAdapter(sentinel, "example");
    await workspace.probeAdapter(sentinel.datasetId);
  }
  const planned = await workspace.plan(investigation(investigationId));
  const job = await workspace.run(planned.plan.planId, { mode, confirmed: mode === "live" });
  const candidate = await workspace.getWorkflow(`auto-${investigationId}`);
  return await workspace.compileWorkflow({ workflowId: candidate.workflow.workflowId, name: candidate.workflow.name, description: candidate.workflow.description, planId: planned.plan.planId, jobId: job.jobId, stage: "ready" });
}

test("delegated manual triggers replay only ready dry-run workflows with bounded idempotency", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-trigger-"));
  try {
    const workspace = new TriggerWorkspace(join(root, "earth"), process.execPath);
    const workflow = await readyWorkflow(workspace, "trigger-source");
    const runtime = new TriggerRuntime(workspace, join(root, "triggers"));
    const draft = await runtime.createDraft({
      triggerId: "manual-review",
      name: "Manual reviewed replay",
      workflowId: workflow.stored.workflow.workflowId,
      condition: { kind: "manual" },
      subject: { principalId: "service:review-bot", kind: "service", displayName: "Review bot" },
      limits: { maxRuns: 2, cooldownSeconds: 0 },
    });
    assert.equal(draft.state, "draft");
    const approved = await runtime.approve(draft.triggerId, { principalId: "operator:local", kind: "human", displayName: "Local operator" });
    assert.equal(approved.trigger.state, "active");
    assert.deepEqual(approved.grant.scopes, ["workflow:replay:dry_run"]);
    assert.match(approved.grant.signature, /^[a-f0-9]{64}$/);
    assert.equal((await stat(join(root, "triggers", "delegation.key"))).mode & 0o777, 0o600);

    const first = await runtime.invoke(draft.triggerId, "manual:request-001");
    assert.equal(first.deduplicated, false);
    assert.equal(first.run.state, "completed");
    const duplicate = await runtime.invoke(draft.triggerId, "manual:request-001");
    assert.equal(duplicate.deduplicated, true);
    assert.equal(duplicate.run.runId, first.run.runId);
    const second = await runtime.invoke(draft.triggerId, "manual:request-002");
    assert.equal(second.run.state, "completed");
    assert.equal((await runtime.getTrigger(draft.triggerId)).state, "paused");
    const grants = await runtime.listGrants();
    assert.equal(grants[0].usedRuns, 2);
    assert.equal(grants[0].state, "exhausted");
    await assert.rejects(() => runtime.invoke(draft.triggerId, "manual:request-003"), /TRIGGER_NOT_ACTIVE|not active/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("event and interval triggers are durable, payload-minimal and idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-trigger-events-"));
  try {
    const workspace = new TriggerWorkspace(join(root, "earth"), process.execPath);
    const workflow = await readyWorkflow(workspace, "event-source");
    const runtime = new TriggerRuntime(workspace, join(root, "triggers"));
    const eventTrigger = await runtime.createDraft({ name: "Evidence arrived", workflowId: workflow.stored.workflow.workflowId, condition: { kind: "event", eventName: "browser.evidence.imported" }, limits: { maxRuns: 4, cooldownSeconds: 0 } });
    await runtime.approve(eventTrigger.triggerId);
    const first = await runtime.dispatchEvent({ eventId: "event-001", eventName: "browser.evidence.imported", payload: { evidenceId: "ev-001", privatePageText: "not persisted" } });
    assert.equal(first.duplicate, false);
    assert.equal(first.runs.length, 1);
    const duplicate = await runtime.dispatchEvent({ eventId: "event-001", eventName: "browser.evidence.imported", payload: { evidenceId: "ev-001", privatePageText: "not persisted" } });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.runs.length, 1);
    assert.equal(duplicate.runs[0].runId, first.runs[0].runId);
    await assert.rejects(
      () => runtime.dispatchEvent({ eventId: "event-001", eventName: "browser.evidence.imported", payload: { changed: true } }),
      /TRIGGER_EVENT_ID_COLLISION|different event content/,
    );
    const receiptText = await readFile(join(root, "triggers", "events", "event-001.json"), "utf8");
    assert.equal(receiptText.includes("privatePageText"), false);
    assert.equal(receiptText.includes("not persisted"), false);

    const intervalTrigger = await runtime.createDraft({ name: "Scheduled review", workflowId: workflow.stored.workflow.workflowId, condition: { kind: "interval", everyMinutes: 5 }, limits: { maxRuns: 4, cooldownSeconds: 0 } });
    await runtime.approve(intervalTrigger.triggerId);
    const now = Date.now();
    const [tickA, tickB] = await Promise.all([runtime.tick(now, "supervisor:a"), runtime.tick(now, "supervisor:b")]);
    assert.equal([tickA, tickB].filter((item) => item.acquired).length, 1);
    const intervalRuns = (await runtime.listRuns()).filter((run) => run.triggerId === intervalTrigger.triggerId);
    assert.equal(intervalRuns.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("separate runtime instances serialize grant consumption through a durable trigger lease", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-trigger-concurrency-"));
  try {
    const workspace = new TriggerWorkspace(join(root, "earth"), process.execPath);
    const workflow = await readyWorkflow(workspace, "concurrency-source");
    const triggerRoot = join(root, "triggers");
    const runtimeA = new TriggerRuntime(workspace, triggerRoot);
    const runtimeB = new TriggerRuntime(workspace, triggerRoot);
    const draft = await runtimeA.createDraft({ name: "One delegated run", workflowId: workflow.stored.workflow.workflowId, condition: { kind: "manual" }, limits: { maxRuns: 1, cooldownSeconds: 0 } });
    await runtimeA.approve(draft.triggerId);
    const results = await Promise.allSettled([
      runtimeA.invoke(draft.triggerId, "runtime-a"),
      runtimeB.invoke(draft.triggerId, "runtime-b"),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal((await runtimeA.listRuns()).length, 1);
    assert.equal((await runtimeA.listGrants())[0].usedRuns, 1);
    assert.equal((await runtimeA.getTrigger(draft.triggerId)).state, "paused");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("delegation integrity and dry-run scope block tampering and state-changing workflows", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-trigger-security-"));
  try {
    const workspace = new TriggerWorkspace(join(root, "earth"), process.execPath);
    const dryWorkflow = await readyWorkflow(workspace, "security-dry");
    const runtime = new TriggerRuntime(workspace, join(root, "triggers"));
    const draft = await runtime.createDraft({ triggerId: "tamper-target", name: "Tamper target", workflowId: dryWorkflow.stored.workflow.workflowId, condition: { kind: "manual" }, limits: { maxRuns: 2, cooldownSeconds: 0 } });
    const { grant } = await runtime.approve(draft.triggerId);
    const triggerPath = join(root, "triggers", "definitions", `${draft.triggerId}.json`);
    const tamperedTrigger = JSON.parse(await readFile(triggerPath, "utf8"));
    tamperedTrigger.condition = { kind: "interval", everyMinutes: 1 };
    await writeFile(triggerPath, `${JSON.stringify(tamperedTrigger, null, 2)}\n`);
    await assert.rejects(() => runtime.invoke(draft.triggerId, "tampered-definition"), /TRIGGER_GRANT_MISMATCH|does not match/);

    const grantPath = join(root, "triggers", "grants", `${grant.grantId}.json`);
    const tamperedGrant = JSON.parse(await readFile(grantPath, "utf8"));
    tamperedGrant.maxRuns = 999;
    await writeFile(grantPath, `${JSON.stringify(tamperedGrant, null, 2)}\n`);
    await assert.rejects(() => runtime.listGrants(), /TRIGGER_GRANT_INTEGRITY_FAILED|integrity check failed/);

    const liveWorkflow = await readyWorkflow(workspace, "security-live", "live");
    const liveDraft = await runtime.createDraft({ name: "Blocked live replay", workflowId: liveWorkflow.stored.workflow.workflowId, condition: { kind: "manual" } });
    await assert.rejects(() => runtime.approve(liveDraft.triggerId), /TRIGGER_SCOPE_BLOCKED|dry-run workflows only/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Pi trigger extension authorizes a draft through direct UI without registering a model tool", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-trigger-extension-"));
  const previousEarth = process.env.SCOUTPI_EARTH_ROOT;
  const previousTrigger = process.env.SCOUTPI_TRIGGER_ROOT;
  process.env.SCOUTPI_EARTH_ROOT = join(root, "earth");
  process.env.SCOUTPI_TRIGGER_ROOT = join(root, "triggers");
  try {
    const workspace = new TriggerWorkspace(process.env.SCOUTPI_EARTH_ROOT, process.execPath);
    const workflow = await readyWorkflow(workspace, "extension-source");
    const runtime = new TriggerRuntime(workspace, process.env.SCOUTPI_TRIGGER_ROOT);
    const draft = await runtime.createDraft({ triggerId: "extension-draft", name: "Extension draft", workflowId: workflow.stored.workflow.workflowId, condition: { kind: "manual" }, limits: { maxRuns: 3, cooldownSeconds: 0 } });
    const handlers = new Map<string, Function>();
    const commands = new Map<string, any>();
    const entries: Array<{ type: string; data: any }> = [];
    let status = "";
    await setupTriggers({
      on(name: string, handler: Function) { handlers.set(name, handler); },
      registerCommand(name: string, command: any) { commands.set(name, command); },
      appendEntry(type: string, data: unknown) { entries.push({ type, data }); },
    } as any);
    assert.deepEqual([...commands.keys()].sort(), ["earth-trigger-approve", "earth-triggers"]);
    const context = { ui: { setStatus(_key: string, value?: string) { status = value || ""; }, notify() {}, async confirm() { return true; } } };
    await handlers.get("session_start")?.({ type: "session_start" }, context);
    assert.match(status, /1 review/);
    await commands.get("earth-trigger-approve").handler(draft.triggerId, context);
    assert.equal((await runtime.getTrigger(draft.triggerId)).state, "active");
    assert.equal(entries.some((entry) => entry.type === "scoutpi:trigger-delegation"), true);
  } finally {
    if (previousEarth === undefined) delete process.env.SCOUTPI_EARTH_ROOT; else process.env.SCOUTPI_EARTH_ROOT = previousEarth;
    if (previousTrigger === undefined) delete process.env.SCOUTPI_TRIGGER_ROOT; else process.env.SCOUTPI_TRIGGER_ROOT = previousTrigger;
    await rm(root, { recursive: true, force: true });
  }
});

test("Workbench API exposes draft, approval, invocation, delegation, and state transitions", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-trigger-api-"));
  try {
    const workspace = new TriggerWorkspace(join(root, "earth"), process.execPath);
    const workflow = await readyWorkflow(workspace, "api-trigger-source");
    const triggerRuntime = new TriggerRuntime(workspace, join(root, "triggers"));
    const runtime = await createEarthWorkspaceServer({ host: "127.0.0.1", port: 0, workspace, triggerRuntime });
    await runtime.listen();
    try {
      const address = runtime.server.address();
      if (!address || typeof address === "string") throw new Error("trigger API server unavailable");
      const base = `http://127.0.0.1:${address.port}`;
      const draft: any = await (await fetch(`${base}/api/triggers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ triggerId: "api-manual", name: "API manual", workflowId: workflow.stored.workflow.workflowId, condition: { kind: "manual" }, limits: { maxRuns: 3, cooldownSeconds: 0 } }) })).json();
      assert.equal(draft.state, "draft");
      const approval: any = await (await fetch(`${base}/api/triggers/${draft.triggerId}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
      assert.equal(approval.trigger.state, "active");
      assert.equal(approval.grant.issuer.principalId, "workbench:operator");
      const invoked: any = await (await fetch(`${base}/api/triggers/${draft.triggerId}/invoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: "api-request-001" }) })).json();
      assert.equal(invoked.run.state, "completed");
      const runs: any = await (await fetch(`${base}/api/trigger-runs`)).json();
      const grants: any = await (await fetch(`${base}/api/delegations`)).json();
      assert.equal(runs.runs.length, 1);
      assert.equal(grants.grants.length, 1);
      assert.equal("signature" in grants.grants[0], false);
      const paused: any = await (await fetch(`${base}/api/triggers/${draft.triggerId}/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ state: "paused" }) })).json();
      assert.equal(paused.state, "paused");
    } finally { await runtime.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
