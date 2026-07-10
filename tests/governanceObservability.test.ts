import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import setupGovernance from "../.pi/extensions/scoutpi-governance/index.ts";
import setupObservability from "../.pi/extensions/scoutpi-observability/index.ts";
import { AgentRunStore, aggregateModelUsage } from "../packages/runtime-observability/src/index.ts";
import { ApprovalStore, approvalParametersHash, earthOperationRisk } from "../packages/runtime-governance/src/index.ts";

test("approval receipts are user-issued, parameter-bound, single-use and content-minimal", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-governance-"));
  try {
    const store = new ApprovalStore(root);
    const parameters = { op: "export_local", id: "plan-fixture", options: { kind: "year", maxPixels: 50_000, privateNote: "must-not-be-stored" } };
    assert.equal(earthOperationRisk(parameters), "high");
    const approval = await store.issue({
      toolCallId: "call-1",
      operation: "earth_workspace:export_local",
      risk: "high",
      parameters,
      summary: "Operation: Local GeoTIFF export\nTarget: plan-fixture\nRisk: high",
      limits: { maxPixels: 50_000 },
    });
    assert.equal(approval.parametersHash, approvalParametersHash(parameters));
    const storedText = await readFile(join(root, "approvals", `${approval.approvalId}.json`), "utf8");
    assert.equal(storedText.includes("must-not-be-stored"), false);
    assert.equal((await store.consume(approval.approvalId, { toolCallId: "call-1", operation: "earth_workspace:export_local", parameters })).state, "consumed");
    await assert.rejects(() => store.consume(approval.approvalId, { toolCallId: "call-1", operation: "earth_workspace:export_local", parameters }), /ALREADY_USED/);

    const mismatch = await store.issue({ toolCallId: "call-2", operation: "earth_workspace:retry", risk: "medium", parameters: { op: "retry", id: "job-a" }, summary: "Retry job-a" });
    await assert.rejects(() => store.consume(mismatch.approvalId, { toolCallId: "call-2", operation: "earth_workspace:retry", parameters: { op: "retry", id: "job-b" } }), /MISMATCH/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Pi governance turns a real UI decision into a bound receipt instead of trusting confirmed=true", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-governance-extension-"));
  const previousRoot = process.env.SCOUTPI_EARTH_ROOT;
  process.env.SCOUTPI_EARTH_ROOT = root;
  try {
    const handlers = new Map<string, Function>();
    const entries: Array<{ type: string; data: unknown }> = [];
    await setupGovernance({
      on(name: string, handler: Function) { handlers.set(name, handler); },
      appendEntry(type: string, data: unknown) { entries.push({ type, data }); },
    } as any);
    const input: Record<string, unknown> = { op: "export_local", id: "missing-plan", options: { kind: "year", confirmed: true } };
    let card = "";
    const result = await handlers.get("tool_call")?.({ type: "tool_call", toolName: "earth_workspace", toolCallId: "pi-call-1", input }, {
      hasUI: true,
      ui: { async confirm(_title: string, message: string) { card = message; return true; } },
    });
    assert.equal(result, undefined);
    assert.match(card, /Local GeoTIFF export/);
    const approvalId = String((input.options as any).approvalId);
    assert.match(approvalId, /^approval_/);
    assert.equal(entries[0]?.type, "scoutpi:approval");
    const store = new ApprovalStore(root);
    assert.equal((await store.consume(approvalId, { toolCallId: "pi-call-1", operation: "earth_workspace:export_local", parameters: input })).state, "consumed");

    const deniedInput = { op: "retry", id: "job-a", options: {} };
    const denied = await handlers.get("tool_call")?.({ type: "tool_call", toolName: "earth_workspace", toolCallId: "pi-call-2", input: deniedInput }, {
      hasUI: true,
      ui: { async confirm() { return false; } },
    });
    assert.equal(denied.block, true);
    assert.match(denied.reason, /USER_DENIED/);
  } finally {
    if (previousRoot === undefined) delete process.env.SCOUTPI_EARTH_ROOT;
    else process.env.SCOUTPI_EARTH_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test("Agent run observability records lifecycle, exact reported usage and no raw prompt by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-agent-runs-"));
  try {
    const store = new AgentRunStore(root, false);
    const run = await store.start({ sessionId: "session-1", prompt: "private prompt sensitive-value-never-persist-this", model: "OpenAI/gpt-5.6" });
    await store.increment(run.runId, "turns");
    await store.increment(run.runId, "toolCalls");
    await store.event(run.runId, { kind: "tool", name: "tool_execution_end", toolCallId: "call-1", toolName: "earth_workspace", operation: "plan", elapsedMs: 12, inputBytes: 40, outputBytes: 80 });
    const summary = await store.complete(run.runId, { messages: [{ role: "assistant", usage: { input: 120, output: 30, cacheRead: 50, cacheWrite: 0, totalTokens: 200, cost: { total: 0.0123 } } }] });
    assert.equal(summary.modelUsage.totalTokens, 200);
    assert.equal(summary.modelUsage.reportedCostUsd, 0.0123);
    assert.equal(summary.turns, 1);
    assert.equal(summary.toolCalls, 1);
    const allText = (await Promise.all((await readdir(join(root, run.runId))).map((name) => readFile(join(root, run.runId, name), "utf8")))).join("\n");
    assert.equal(allText.includes("sensitive-value-never-persist-this"), false);
    assert.equal(allText.includes("private prompt"), false);
    assert.match(allText, new RegExp(run.promptHash));
    assert.deepEqual(aggregateModelUsage([]), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, reportedCostUsd: 0 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Pi observability lifecycle produces a complete run trace without adding a tool", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-observability-extension-"));
  const previous = process.env.SCOUTPI_RUNS_ROOT;
  process.env.SCOUTPI_RUNS_ROOT = root;
  try {
    const handlers = new Map<string, Function>();
    let status = "";
    await setupObservability({ on(name: string, handler: Function) { handlers.set(name, handler); } } as any);
    const context = {
      model: { provider: "OpenAI", id: "gpt-5.6" },
      sessionManager: { getSessionId: () => "rpc-session-1" },
      ui: { setStatus(_key: string, value: string | undefined) { status = value || ""; } },
    };
    await handlers.get("before_agent_start")?.({ type: "before_agent_start", prompt: "investigate without storing this sentence", images: [] }, context);
    await handlers.get("agent_start")?.({ type: "agent_start" }, context);
    await handlers.get("turn_start")?.({ type: "turn_start", turnIndex: 0, timestamp: Date.now() }, context);
    await handlers.get("tool_execution_start")?.({ type: "tool_execution_start", toolCallId: "call-a", toolName: "earth_workspace", args: { op: "plan", payload: { large: "hidden" } } }, context);
    await handlers.get("tool_execution_end")?.({ type: "tool_execution_end", toolCallId: "call-a", toolName: "earth_workspace", result: { content: [{ type: "text", text: "plan ok" }] }, isError: false }, context);
    await handlers.get("agent_end")?.({ type: "agent_end", messages: [{ role: "assistant", usage: { input: 20, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 25, cost: { total: 0.001 } } }] }, context);
    const runs = await new AgentRunStore(root).list();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].state, "completed");
    assert.equal(runs[0].toolCalls, 1);
    assert.equal(runs[0].modelUsage.totalTokens, 25);
    assert.match(status, /settled/);
  } finally {
    if (previous === undefined) delete process.env.SCOUTPI_RUNS_ROOT;
    else process.env.SCOUTPI_RUNS_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});
