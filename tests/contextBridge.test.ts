import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import setupContext from "../.pi/extensions/scoutpi-context/index.ts";
import setupObservability from "../.pi/extensions/scoutpi-observability/index.ts";
import { createEarthWorkspaceServer } from "../packages/earth-workspace-server/src/server.ts";
import { EarthWorkspace } from "../packages/earth-workspace/src/index.ts";
import { buildContextPack, ContextPackStore, contextQueryHash, renderContextPack, validateContextCandidate, type ContextCandidateEnvelope } from "../packages/runtime-context/src/index.ts";
import { AgentRunStore } from "../packages/runtime-observability/src/index.ts";

function envelope(): ContextCandidateEnvelope {
  return {
    schemaVersion: "scoutpi.context.candidates.v1",
    providerId: "fixture-memory",
    generatedAt: "2026-07-11T00:00:00.000Z",
    items: [
      { candidateId: "same-season", kind: "procedure", text: "Compare satellite observations using the same seasonal window.", confidence: 0.96, trust: "user_confirmed", tags: ["season", "comparison"], provenance: { providerId: "fixture-memory", sourceId: "memory-1", capturedAt: "2026-07-10T00:00:00.000Z" } },
      { candidateId: "proxy-boundary", kind: "decision", text: "Night lights are an activity proxy and must not be reported as GDP.", confidence: 0.99, trust: "project_artifact", tags: ["night lights", "proxy"], provenance: { providerId: "fixture-memory", sourceId: "memory-2" } },
      { candidateId: "expired", kind: "fact", text: "This expired item must not be delivered.", confidence: 1, trust: "external_memory", expiresAt: "2020-01-01T00:00:00.000Z", provenance: { providerId: "fixture-memory", sourceId: "memory-3" } },
    ],
  };
}

test("Context Pack ranks relevant memories, preserves provenance and honors a mixed-text token budget", () => {
  const pack = buildContextPack({ sessionId: "session-context", query: "Compare night lights across seasons without claiming GDP", candidates: envelope().items, detectedMemoryTools: ["memory_search", "memory_remember"], maxTokens: 120, now: new Date("2026-07-11T00:00:00.000Z") });
  assert.equal(pack.queryHash, contextQueryHash("Compare night lights across seasons without claiming GDP"));
  assert.equal(pack.items.some((item) => item.candidateId === "expired"), false);
  assert.equal(pack.items[0].candidateId, "proxy-boundary");
  assert.equal(pack.items[0].provenance.sourceId, "memory-2");
  assert.equal(pack.budget.deliveredTokens <= pack.budget.maxTokens, true);
  assert.match(renderContextPack(pack), /memory-not-authority/);
  assert.match(renderContextPack(pack), /must not be reported as GDP/);
});

test("Context candidates reject secret-looking material", () => {
  assert.throws(() => validateContextCandidate({ candidateId: "bad-secret", kind: "fact", text: "token=sk-this-should-never-enter-context", confidence: 1, trust: "external_memory", provenance: { providerId: "fixture", sourceId: "bad" } }), /CONTEXT_SECRET_REJECTED|secret material/);
});

test("Context artifact IDs cannot escape their store directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-context-path-"));
  try {
    const store = new ContextPackStore(root);
    await assert.rejects(() => store.getPack("../outside"), /CONTEXT_ID_INVALID|invalid/);
    await assert.rejects(() => store.decideWriteback("../outside", true), /CONTEXT_ID_INVALID|invalid/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Pi Context Bridge injects a bounded pack and requires direct approval for structured writeback", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-context-extension-"));
  const previousRoot = process.env.SCOUTPI_CONTEXT_ROOT;
  process.env.SCOUTPI_CONTEXT_ROOT = root;
  try {
    await writeFile(join(root, "candidates.json"), `${JSON.stringify(envelope(), null, 2)}\n`);
    process.env.SCOUTPI_CONTEXT_CANDIDATES_FILE = join(root, "candidates.json");
    const handlers = new Map<string, Function>();
    const entries: Array<{ type: string; data: any }> = [];
    let status = "";
    await setupContext({
      on(name: string, handler: Function) { handlers.set(name, handler); },
      getAllTools() { return [{ name: "memory_search" }, { name: "memory_remember" }, { name: "earth_workspace" }]; },
      appendEntry(type: string, data: unknown) { entries.push({ type, data }); },
      registerCommand() {},
    } as any);
    const context = { hasUI: true, sessionManager: { getSessionId: () => "session-context-extension" }, ui: { setStatus(_key: string, value: string | undefined) { status = value || ""; }, async confirm() { return true; }, notify() {} } };
    await handlers.get("session_start")?.({ type: "session_start", reason: "new" }, context);
    const injected = await handlers.get("before_agent_start")?.({ type: "before_agent_start", prompt: "Compare night lights and GDP carefully", systemPrompt: "base", images: [], systemPromptOptions: {} }, context);
    assert.match(injected.systemPrompt, /scoutpi_context_pack/);
    assert.match(injected.systemPrompt, /activity proxy/);
    assert.match(status, /items/);
    await handlers.get("tool_result")?.({ type: "tool_result", toolCallId: "call-workflow", toolName: "earth_workspace", input: { op: "workflow_compile", id: "workflow-safe" }, content: [], details: { workflowId: "workflow-safe", revision: 2, fingerprint: "a".repeat(64) }, isError: false }, context);
    await handlers.get("agent_end")?.({ type: "agent_end", messages: [] }, context);
    const writebacks = await new ContextPackStore(root).listWritebacks();
    assert.equal(writebacks.length, 1);
    assert.equal(writebacks[0].state, "approved");
    assert.deepEqual(writebacks[0].providerTargets, ["memory_remember"]);
    assert.equal(entries.some((entry) => entry.type === "scoutpi:context-pack"), true);
    assert.equal(entries.some((entry) => entry.type === "scoutpi:context-writeback" && entry.data.state === "approved"), true);
  } finally {
    delete process.env.SCOUTPI_CONTEXT_CANDIDATES_FILE;
    if (previousRoot === undefined) delete process.env.SCOUTPI_CONTEXT_ROOT;
    else process.env.SCOUTPI_CONTEXT_ROOT = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test("Observability binds the exact current Context Pack to the Agent run", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-context-observability-"));
  const contextRoot = join(root, "context");
  const runsRoot = join(root, "runs");
  const previousContext = process.env.SCOUTPI_CONTEXT_ROOT;
  const previousRuns = process.env.SCOUTPI_RUNS_ROOT;
  process.env.SCOUTPI_CONTEXT_ROOT = contextRoot;
  process.env.SCOUTPI_RUNS_ROOT = runsRoot;
  try {
    const store = new ContextPackStore(contextRoot);
    const prompt = "Use prior same-season guidance";
    const pack = buildContextPack({ sessionId: "session-observed", query: prompt, candidates: envelope().items, maxTokens: 300 });
    await store.savePack(pack);
    const handlers = new Map<string, Function>();
    await setupObservability({ on(name: string, handler: Function) { handlers.set(name, handler); } } as any);
    const context = { model: { provider: "OpenAI", id: "gpt-5.6" }, sessionManager: { getSessionId: () => "session-observed" }, ui: { setStatus() {} } };
    await handlers.get("before_agent_start")?.({ type: "before_agent_start", prompt, systemPrompt: "base", images: [], systemPromptOptions: {} }, context);
    const runs = await new AgentRunStore(runsRoot).list();
    const attached = JSON.parse(await readFile(join(runsRoot, runs[0].runId, "context_pack.json"), "utf8"));
    assert.equal(attached.packId, pack.packId);
    assert.equal(attached.queryHash, contextQueryHash(prompt));
  } finally {
    if (previousContext === undefined) delete process.env.SCOUTPI_CONTEXT_ROOT; else process.env.SCOUTPI_CONTEXT_ROOT = previousContext;
    if (previousRuns === undefined) delete process.env.SCOUTPI_RUNS_ROOT; else process.env.SCOUTPI_RUNS_ROOT = previousRuns;
    await rm(root, { recursive: true, force: true });
  }
});

test("Workbench API lists Context Packs and reviewed writebacks", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-context-api-"));
  const contextStore = new ContextPackStore(join(root, "context"));
  const pack = buildContextPack({ sessionId: "session-api", query: "same season", candidates: envelope().items, maxTokens: 300 });
  await contextStore.savePack(pack);
  const writeback = await contextStore.createWriteback({ sessionId: "session-api", candidates: [{ candidateId: "workflow-api", kind: "workflow", text: "Workflow workflow-api completed a verified replay.", confidence: 0.99, tags: ["workflow"], provenance: { source: "runtime_trace", toolCallId: "call-api", operation: "workflow_replay", targetId: "workflow-api" } }] });
  await contextStore.decideWriteback(writeback.writebackId, true, writeback.payloadSha256);
  const runtime = await createEarthWorkspaceServer({ host: "127.0.0.1", port: 0, workspace: new EarthWorkspace(join(root, "earth"), process.execPath), contextStore });
  await runtime.listen();
  try {
    const address = runtime.server.address();
    if (!address || typeof address === "string") throw new Error("test server address unavailable");
    const base = `http://127.0.0.1:${address.port}`;
    const packs: any = await (await fetch(`${base}/api/context/packs`)).json();
    const writebacks: any = await (await fetch(`${base}/api/context/writebacks`)).json();
    assert.equal(packs.packs[0].packId, pack.packId);
    assert.equal(writebacks.writebacks[0].state, "approved");
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});
