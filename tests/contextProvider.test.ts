import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    "class LocalSqliteCoreClient:",
    "    def __init__(self, db_path): self.db_path = db_path",
    "    def retrieve_candidates_v2(self, *, context):",
    "        return {'ok': True, 'candidates': [",
    "            {'text': 'Use the same seasonal window for every comparison.', 'sourceType': 'memory', 'memoryKind': 'procedure', 'score': 0.94, 'memoryIds': ['stable:same-season'], 'evidencePreview': 'confirmed project memory'},",
    "            {'text': 'token=sk-this-must-be-filtered', 'sourceType': 'memory', 'memoryKind': 'fact', 'score': 1.0, 'memoryIds': ['bad:secret']},",
    "        ], 'stats': {'latencyMs': 1}}",
    "",
  ].join("\n"));
  const dbPath = join(root, "rag-ime.sqlite");
  await writeFile(dbPath, "fixture");
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
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Wisdom Weasel provider fails closed when its configured Core is unavailable", async () => {
  const provider = new ImeCoreContextProvider({ coreRoot: "/missing/scoutpi-ime-core", dbPath: "/missing/rag-ime.sqlite", useUv: false, pythonCommand: process.env.PYTHON || "python3" });
  const result = await provider.query({ sessionId: "session-missing", query: "memory", project: "fixture", maxItems: 4, timeoutMs: 300 });
  assert.equal(result.status.state, "unavailable");
  assert.equal(result.status.errorCode, "CONTEXT_PROVIDER_NOT_CONFIGURED");
  assert.equal(result.envelope, undefined);
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
