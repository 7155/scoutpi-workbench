import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import setupContext from "../.pi/extensions/scoutpi-context/index.ts";
import { ContextPackStore, ImeCoreContextProvider, validateContextCandidateEnvelope } from "../packages/runtime-context/src/index.ts";

async function fixtureCore(root: string): Promise<{ coreRoot: string; dbPath: string }> {
  const coreRoot = join(root, "ime-core");
  const packageRoot = join(coreRoot, "rag_ime");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "__init__.py"), "");
  await writeFile(join(packageRoot, "memory_models.py"), [
    "from dataclasses import dataclass",
    "@dataclass(frozen=True)",
    "class ImeQueryContext:",
    "    current_input: str",
    "    recent_context: str = ''",
    "    committed_context: str = ''",
    "    preedit: str = ''",
    "    rime_candidates: tuple[str, ...] = ()",
    "    app: str = ''",
    "    project: str = ''",
    "    schema_id: str = ''",
    "    top_k: int = 5",
    "    source_budget_ms: int = 80",
    "    allow_cold_knowledge: bool = False",
    "    allow_raw_event_candidates: bool = False",
    "",
  ].join("\n"));
  await writeFile(join(packageRoot, "local_sqlite_core.py"), [
    "import json",
    "import time",
    "class LocalSqliteCoreClient:",
    "    def __init__(self, db_path): self.db_path = db_path",
    "    def retrieve_candidates_v2(self, *, context):",
    "        if context.current_input == 'slow': time.sleep(0.3)",
    "        return {'ok': True, 'candidates': [",
    "            {'text': 'Use the same seasonal window for every comparison.', 'sourceType': 'memory', 'memoryKind': 'procedure', 'score': 0.94, 'memoryIds': ['stable:same-season'], 'evidencePreview': 'confirmed project memory'},",
    "            {'text': 'token=sk-this-must-be-filtered', 'sourceType': 'memory', 'memoryKind': 'fact', 'score': 1.0, 'memoryIds': ['bad:secret']},",
    "        ], 'stats': {'latencyMs': 1}}",
    "    def has_event_tag(self, tag):",
    "        try:",
    "            rows = [json.loads(line) for line in open(self.db_path, encoding='utf-8') if line.strip()]",
    "        except Exception:",
    "            rows = []",
    "        return any(tag in row.get('tags', []) for row in rows)",
    "",
  ].join("\n"));
  await writeFile(join(packageRoot, "adapter.py"), [
    "import json",
    "class InputMethodAdapter:",
    "    def __init__(self, core, project='fixture'): self.core, self.project = core, project",
    "    def commit_text(self, text, **kwargs):",
    "        rows = []",
    "        try:",
    "            rows = [json.loads(line) for line in open(self.core.db_path, encoding='utf-8') if line.strip()]",
    "        except Exception:",
    "            pass",
    "        event_id = f'event:{len(rows) + 1}'",
    "        with open(self.core.db_path, 'a', encoding='utf-8') as handle:",
    "            handle.write(json.dumps({'eventId': event_id, 'text': text, 'tags': list(kwargs.get('tags', ())), 'source': kwargs.get('source')}, ensure_ascii=False) + '\\n')",
    "        return event_id",
    "",
  ].join("\n"));
  const dbPath = join(root, "rag-ime.sqlite");
  await writeFile(dbPath, "");
  return { coreRoot, dbPath };
}

test("Wisdom Weasel provider queries the existing Core through a bounded typed process contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-ime-provider-"));
  try {
    const fixture = await fixtureCore(root);
    const provider = new ImeCoreContextProvider({ ...fixture, useUv: false, pythonCommand: process.env.PYTHON || "python3" });
    const result = await provider.query({ sessionId: "session-ime", query: "How should seasonal comparisons be constrained?", project: "scoutpi-workbench", maxItems: 8, timeoutMs: 2_000 });
    assert.equal(result.status.state, "ready");
    assert.equal(result.status.itemCount, 1);
    assert.equal(result.envelope?.providerId, "wisdom-weasel-rag-ime");
    const validated = validateContextCandidateEnvelope(result.envelope);
    assert.equal(validated.items[0].kind, "procedure");
    assert.equal(validated.items[0].provenance.sourceId, "stable:same-season");
    assert.equal(validated.items.some((item) => item.text.includes("sk-this")), false);
    const warm = await provider.query({ sessionId: "session-ime", query: "How should seasonal comparisons be constrained?", project: "scoutpi-workbench", maxItems: 8, timeoutMs: 2_000 });
    assert.equal(result.status.processMode, "persistent");
    assert.equal(result.status.workerReused, false);
    assert.equal(warm.status.workerReused, true);
    assert.equal(typeof warm.status.sourceLatencyMs, "number");
    await provider.close();
    const oneShot = new ImeCoreContextProvider({ ...fixture, useUv: false, pythonCommand: process.env.PYTHON || "python3", persistent: false });
    const oneShotResult = await oneShot.query({ sessionId: "session-one-shot", query: "memory", project: "fixture", maxItems: 4, timeoutMs: 2_000 });
    assert.equal(oneShotResult.status.state, "ready");
    assert.equal(oneShotResult.status.processMode, "one_shot");
    assert.equal(oneShotResult.status.workerReused, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("persistent provider timeout and cancellation kill the worker and the next query starts cleanly", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-ime-worker-recovery-"));
  try {
    const fixture = await fixtureCore(root);
    const provider = new ImeCoreContextProvider({ ...fixture, useUv: false, pythonCommand: process.env.PYTHON || "python3" });
    const timedOut = await provider.query({ sessionId: "session-timeout", query: "slow", project: "fixture", maxItems: 4, timeoutMs: 50 });
    assert.equal(timedOut.status.state, "failed");
    assert.equal(timedOut.status.errorCode, "CONTEXT_PROVIDER_TIMEOUT");
    const recovered = await provider.query({ sessionId: "session-timeout", query: "memory", project: "fixture", maxItems: 4, timeoutMs: 2_000 });
    assert.equal(recovered.status.state, "ready");
    assert.equal(recovered.status.workerReused, false);
    const controller = new AbortController();
    const cancellation = provider.query({ sessionId: "session-timeout", query: "slow", project: "fixture", maxItems: 4, timeoutMs: 2_000 }, controller.signal);
    setTimeout(() => controller.abort(), 30);
    const cancelled = await cancellation;
    assert.equal(cancelled.status.errorCode, "CONTEXT_PROVIDER_CANCELLED");
    const restarted = await provider.query({ sessionId: "session-timeout", query: "memory", project: "fixture", maxItems: 4, timeoutMs: 2_000 });
    assert.equal(restarted.status.state, "ready");
    assert.equal(restarted.status.workerReused, false);
    await provider.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Wisdom Weasel provider fails closed when its configured Core is unavailable", async () => {
  const provider = new ImeCoreContextProvider({ coreRoot: "/missing/scoutpi-ime-core", dbPath: "/missing/rag-ime.sqlite", useUv: false, pythonCommand: process.env.PYTHON || "python3" });
  const result = await provider.query({ sessionId: "session-missing", query: "memory", project: "fixture", maxItems: 4, timeoutMs: 300 });
  assert.equal(result.status.state, "unavailable");
  assert.equal(result.status.errorCode, "CONTEXT_PROVIDER_NOT_CONFIGURED");
  assert.equal(result.envelope, undefined);
});

test("approved writebacks are staged and idempotently imported through the Core adapter", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-ime-writeback-"));
  try {
    const fixture = await fixtureCore(root);
    const store = new ContextPackStore(join(root, "context"));
    const pending = await store.createWriteback({ sessionId: "session-ime-writeback", providerTargets: ["wisdom-weasel-rag-ime"], candidates: [{ candidateId: "workflow-safe", kind: "workflow", text: "Verified workflow workflow-safe completed successfully.", confidence: 0.99, tags: ["workflow", "verified"], provenance: { source: "runtime_trace", toolCallId: "call-writeback", operation: "workflow_replay", targetId: "workflow-safe" } }] });
    await assert.rejects(() => store.stageWritebackDelivery(pending, "wisdom-weasel-rag-ime"), /CONTEXT_WRITEBACK_NOT_APPROVED|approval/);
    await assert.rejects(() => store.decideWriteback(pending.writebackId, true, "0".repeat(64)), /CONTEXT_WRITEBACK_APPROVAL_MISMATCH|reviewed/);
    const approved = await store.decideWriteback(pending.writebackId, true, pending.payloadSha256);
    await assert.rejects(() => store.stageWritebackDelivery({ ...approved, candidates: [{ ...approved.candidates[0], text: "tampered after approval" }] }, "wisdom-weasel-rag-ime"), /CONTEXT_WRITEBACK_INTEGRITY_FAILED|integrity/);
    const staged = await store.stageWritebackDelivery(approved, "wisdom-weasel-rag-ime");
    let activeLeases = 0;
    let maxActiveLeases = 0;
    const enterLease = async () => { activeLeases += 1; maxActiveLeases = Math.max(maxActiveLeases, activeLeases); await new Promise((resolveDelay) => setTimeout(resolveDelay, 70)); activeLeases -= 1; };
    await Promise.all([store.withWritebackDeliveryLease(staged.deliveryId, enterLease), new ContextPackStore(join(root, "context")).withWritebackDeliveryLease(staged.deliveryId, enterLease)]);
    assert.equal(maxActiveLeases, 1);
    const provider = new ImeCoreContextProvider({ ...fixture, useUv: false, pythonCommand: process.env.PYTHON || "python3", writebackEnabled: true });
    const first = await provider.deliverWriteback({ writeback: approved, delivery: staged, project: "scoutpi-workbench", timeoutMs: 2_000 });
    assert.equal(first.errorCode, undefined);
    assert.equal(first.receipt?.items[0].state, "delivered");
    assert.equal(JSON.stringify(first.receipt).includes(approved.candidates[0].text), false);
    await assert.rejects(() => store.completeWritebackDelivery(staged.deliveryId, { ...first.receipt!, duplicateCount: 1 }), /CONTEXT_PROVIDER_RECEIPT_INVALID|counters/);
    const delivered = await store.completeWritebackDelivery(staged.deliveryId, first.receipt!);
    assert.equal(delivered.state, "delivered");

    const retry = await provider.deliverWriteback({ writeback: approved, delivery: staged, project: "scoutpi-workbench", timeoutMs: 2_000 });
    assert.equal(retry.receipt?.duplicateCount, 1);
    assert.equal(retry.receipt?.items[0].state, "duplicate");
    const rows = (await readFile(fixture.dbPath, "utf8")).trim().split("\n").filter(Boolean);
    assert.equal(rows.length, 1);
    const listed = await store.listWritebacks();
    assert.equal(listed[0].deliveries?.[0].state, "delivered");
    await provider.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Pi Context Bridge merges Wisdom Weasel candidates into the exact token-bounded pack", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-ime-context-extension-"));
  const previous = {
    contextRoot: process.env.SCOUTPI_CONTEXT_ROOT,
    coreRoot: process.env.SCOUTPI_IME_CORE_ROOT,
    coreDb: process.env.SCOUTPI_IME_CORE_DB,
    useUv: process.env.SCOUTPI_IME_CONTEXT_USE_UV,
    python: process.env.SCOUTPI_IME_CONTEXT_PYTHON,
  };
  try {
    const fixture = await fixtureCore(root);
    process.env.SCOUTPI_CONTEXT_ROOT = join(root, "context");
    process.env.SCOUTPI_IME_CORE_ROOT = fixture.coreRoot;
    process.env.SCOUTPI_IME_CORE_DB = fixture.dbPath;
    process.env.SCOUTPI_IME_CONTEXT_USE_UV = "0";
    process.env.SCOUTPI_IME_CONTEXT_PYTHON = process.env.PYTHON || "python3";
    const handlers = new Map<string, Function>();
    await setupContext({
      on(name: string, handler: Function) { handlers.set(name, handler); },
      getAllTools() { return [{ name: "earth_workspace" }]; },
      appendEntry() {},
      registerCommand() {},
    } as any);
    let status = "";
    const context = { sessionManager: { getSessionId: () => "session-ime-provider" }, ui: { setStatus(_key: string, value?: string) { status = value || ""; } } };
    const injected = await handlers.get("before_agent_start")?.({ prompt: "Compare observations across seasonal windows", systemPrompt: "base" }, context);
    assert.match(injected.systemPrompt, /same seasonal window/);
    assert.match(status, /1\/1 providers/);
    const pack = await new ContextPackStore(process.env.SCOUTPI_CONTEXT_ROOT).latestForSession("session-ime-provider");
    assert.equal(pack?.providers[0].providerId, "wisdom-weasel-rag-ime");
    assert.equal(pack?.providers[0].state, "ready");
    assert.equal(pack?.sourceProviders.includes("wisdom-weasel-rag-ime"), true);
    await handlers.get("session_shutdown")?.({}, context);
  } finally {
    const restore = (name: string, value: string | undefined) => { if (value === undefined) delete process.env[name]; else process.env[name] = value; };
    restore("SCOUTPI_CONTEXT_ROOT", previous.contextRoot);
    restore("SCOUTPI_IME_CORE_ROOT", previous.coreRoot);
    restore("SCOUTPI_IME_CORE_DB", previous.coreDb);
    restore("SCOUTPI_IME_CONTEXT_USE_UV", previous.useUv);
    restore("SCOUTPI_IME_CONTEXT_PYTHON", previous.python);
    await rm(root, { recursive: true, force: true });
  }
});

test("Pi Context Bridge delivers only a directly approved writeback to the opt-in Core provider", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-ime-approved-delivery-"));
  const names = ["SCOUTPI_CONTEXT_ROOT", "SCOUTPI_IME_CORE_ROOT", "SCOUTPI_IME_CORE_DB", "SCOUTPI_IME_CONTEXT_USE_UV", "SCOUTPI_IME_CONTEXT_PYTHON", "SCOUTPI_IME_CONTEXT_WRITEBACK"] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]])) as Record<(typeof names)[number], string | undefined>;
  try {
    const fixture = await fixtureCore(root);
    process.env.SCOUTPI_CONTEXT_ROOT = join(root, "context");
    process.env.SCOUTPI_IME_CORE_ROOT = fixture.coreRoot;
    process.env.SCOUTPI_IME_CORE_DB = fixture.dbPath;
    process.env.SCOUTPI_IME_CONTEXT_USE_UV = "0";
    process.env.SCOUTPI_IME_CONTEXT_PYTHON = process.env.PYTHON || "python3";
    process.env.SCOUTPI_IME_CONTEXT_WRITEBACK = "1";
    const handlers = new Map<string, Function>();
    const entries: Array<{ type: string; data: any }> = [];
    await setupContext({
      on(name: string, handler: Function) { handlers.set(name, handler); },
      getAllTools() { return [{ name: "earth_workspace" }]; },
      appendEntry(type: string, data: unknown) { entries.push({ type, data }); },
      registerCommand() {},
    } as any);
    const context = { hasUI: true, sessionManager: { getSessionId: () => "session-ime-approved" }, ui: { setStatus() {}, async confirm() { return true; }, notify() {} } };
    await handlers.get("session_start")?.({}, context);
    await handlers.get("before_agent_start")?.({ prompt: "Run a verified workflow", systemPrompt: "base" }, context);
    await handlers.get("tool_result")?.({ toolCallId: "call-approved", toolName: "earth_workspace", input: { op: "workflow_compile", id: "workflow-approved" }, details: { workflowId: "workflow-approved", revision: 1, fingerprint: "b".repeat(64) }, isError: false }, context);
    await handlers.get("agent_end")?.({}, context);
    const store = new ContextPackStore(process.env.SCOUTPI_CONTEXT_ROOT);
    const writebacks = await store.listWritebacks();
    assert.equal(writebacks[0].state, "approved");
    assert.equal(writebacks[0].approvedBy, "user");
    assert.equal(writebacks[0].deliveries?.[0].state, "delivered");
    assert.equal(entries.some((entry) => entry.type === "scoutpi:context-writeback" && String(entry.data.deliveryState).includes("delivered")), true);
    assert.equal((await readFile(fixture.dbPath, "utf8")).includes("workflow-approved"), true);
    await handlers.get("session_shutdown")?.({}, context);
  } finally {
    for (const name of names) { const value = previous[name]; if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(root, { recursive: true, force: true });
  }
});
