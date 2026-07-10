import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import setupCheckpoint from "../.pi/extensions/scoutpi-checkpoint/index.ts";
import { createEarthWorkspaceServer } from "../packages/earth-workspace-server/src/server.ts";
import { EarthWorkspace } from "../packages/earth-workspace/src/index.ts";
import { AgentCheckpointStore, checkpointReferencesFromTool, renderCheckpointResume } from "../packages/runtime-checkpoint/src/index.ts";

test("durable checkpoints persist only allowlisted runtime references and detect corruption", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-checkpoint-store-"));
  try {
    const store = new AgentCheckpointStore(root);
    await store.open("session-a", { model: "OpenAI/gpt-5.6" });
    const references = checkpointReferencesFromTool("earth_workspace", {
      op: "run",
      id: "plan-safe",
      payload: { investigationId: "investigation-safe", privatePrompt: "sensitive-value-must-not-persist" },
      options: { approvalId: "approval-safe", secret: "sensitive-value-must-not-persist" },
    }, { jobId: "job-safe", artifactPath: "/private/path/job-safe/result.json", raw: "sensitive-value-must-not-persist" });
    const value = await store.transition("session-a", (checkpoint) => {
      checkpoint.state = "tool_running";
      checkpoint.active = { toolCallId: "call-a", toolName: "earth_workspace", operation: "run", targetId: "plan-safe", startedAt: new Date().toISOString() };
      checkpoint.references = references;
      checkpoint.recovery = { recoverable: true };
    });
    const stored = await readFile(join(root, "session-a.json"), "utf8");
    assert.equal(stored.includes("sensitive-value-must-not-persist"), false);
    assert.match(stored, /plan-safe/);
    assert.match(stored, /job-safe/);
    assert.match(stored, /result\.json/);
    assert.match(renderCheckpointResume(value), /do not assume it completed/);

    await writeFile(join(root, "session-a.json"), stored.replace("plan-safe", "plan-tampered"));
    await assert.rejects(() => store.get("session-a"), /CHECKPOINT_INTEGRITY_FAILED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("checkpoint extension injects recovery once and preserves critical IDs during compaction", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-checkpoint-extension-"));
  const previous = process.env.SCOUTPI_CHECKPOINT_ROOT;
  process.env.SCOUTPI_CHECKPOINT_ROOT = root;
  try {
    const seed = new AgentCheckpointStore(root);
    await seed.open("session-resume");
    await seed.transition("session-resume", (checkpoint) => {
      checkpoint.state = "tool_running";
      checkpoint.active = { toolCallId: "call-running", toolName: "earth_workspace", operation: "workflow_replay", targetId: "workflow-safe", startedAt: new Date().toISOString() };
      checkpoint.references = [{ kind: "workflow", id: "workflow-safe", source: "test" }, { kind: "job", id: "job-safe", source: "test" }];
      checkpoint.recovery = { recoverable: true };
    });

    const handlers = new Map<string, Function>();
    let status = "";
    await setupCheckpoint({
      on(name: string, handler: Function) { handlers.set(name, handler); },
      registerCommand() {},
    } as any);
    const context = {
      model: { provider: "OpenAI", id: "gpt-5.6" },
      sessionManager: { getSessionId: () => "session-resume" },
      getContextUsage: () => ({ tokens: 120, contextWindow: 400_000, percent: 0.03 }),
      ui: { setStatus(_key: string, value: string | undefined) { status = value || ""; }, notify() {} },
    };
    await handlers.get("session_start")?.({ type: "session_start", reason: "resume" }, context);
    assert.match(status, /recovery/);
    const first = await handlers.get("before_agent_start")?.({ type: "before_agent_start", prompt: "continue" }, context);
    assert.match(String(first?.message?.content), /workflow=workflow-safe/);
    assert.match(String(first?.message?.content), /do not assume it completed/);
    const second = await handlers.get("before_agent_start")?.({ type: "before_agent_start", prompt: "continue again" }, context);
    assert.equal(second, undefined);

    const compactEvent: any = { type: "session_before_compact", reason: "threshold", customInstructions: "Keep the current hypothesis." };
    await handlers.get("session_before_compact")?.(compactEvent, context);
    assert.match(compactEvent.customInstructions, /approvalId/);
    assert.match(compactEvent.customInstructions, /Do not preserve raw tool payloads or secrets/);
    await handlers.get("session_compact")?.({ type: "session_compact", reason: "threshold" }, context);

    await handlers.get("agent_start")?.({ type: "agent_start" }, context);
    await handlers.get("tool_execution_start")?.({ type: "tool_execution_start", toolCallId: "call-new", toolName: "earth_workspace", args: { op: "status", id: "job-safe" } }, context);
    await handlers.get("session_shutdown")?.({ type: "session_shutdown", reason: "quit" }, context);
    const stored = await seed.get("session-resume");
    assert.equal(stored.state, "paused");
    assert.equal(stored.active?.status, "interrupted");
    assert.equal(stored.compaction.count, 1);
    assert.equal(stored.runtime.contextTokens, 120);
  } finally {
    if (previous === undefined) delete process.env.SCOUTPI_CHECKPOINT_ROOT;
    else process.env.SCOUTPI_CHECKPOINT_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("Workbench API exposes checkpoint summaries from the runtime store", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-checkpoint-api-"));
  const workspace = new EarthWorkspace(join(root, "earth"), process.execPath);
  const checkpointStore = new AgentCheckpointStore(join(root, "checkpoints"));
  await checkpointStore.open("session-api", { model: "OpenAI/gpt-5.6" });
  await checkpointStore.transition("session-api", (checkpoint) => {
    checkpoint.state = "paused";
    checkpoint.references = [{ kind: "plan", id: "plan-api", source: "test" }];
    checkpoint.recovery = { recoverable: true, nextAction: "Inspect plan status." };
  });
  const runtime = await createEarthWorkspaceServer({ host: "127.0.0.1", port: 0, workspace, checkpointStore });
  await runtime.listen();
  try {
    const address = runtime.server.address();
    if (!address || typeof address === "string") throw new Error("test server address unavailable");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/checkpoints`);
    assert.equal(response.status, 200);
    const body: any = await response.json();
    assert.equal(body.checkpoints[0].sessionId, "session-api");
    assert.equal(body.checkpoints[0].recovery.recoverable, true);
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});
