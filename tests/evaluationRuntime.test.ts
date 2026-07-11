import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createEarthWorkspaceServer } from "../packages/earth-workspace-server/src/server.ts";
import { EarthWorkspace } from "../packages/earth-workspace/src/index.ts";
import { EvaluationStore, evaluationFromPiHarness, type EvaluationReport } from "../packages/runtime-evaluation/src/index.ts";

function report(): EvaluationReport {
  return {
    schemaVersion: "scoutpi.evaluation.v1",
    evaluationId: "benchmark-fixture",
    kind: "benchmark",
    title: "Interview benchmark fixture",
    state: "passed",
    createdAt: "2026-07-11T06:00:00.000Z",
    summary: "Three deterministic comparisons passed.",
    metrics: [{ metricId: "tool_schema", label: "Tool schema tokens", value: 300, unit: "tokens", baseline: 1_000, current: 300, improvementPercent: 70, direction: "lower_is_better" }],
    checks: [{ checkId: "privacy", label: "Content-minimal report", status: "passed" }],
    privacy: { rawPromptStored: false, rawToolPayloadStored: false, credentialsStored: false, providerUrlStored: false },
    provenance: { source: "test-harness", command: "pnpm harness:interview" },
  };
}

test("evaluation store validates, integrity-binds and lists content-minimal reports", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-evaluation-"));
  try {
    const store = new EvaluationStore(root);
    const saved = await store.save(report());
    assert.match(saved.integrity?.sha256 || "", /^[a-f0-9]{64}$/);
    assert.equal((await store.list())[0].metrics[0].improvementPercent, 70);
    const storedPath = join(root, "benchmark-fixture.json");
    const stored = await readFile(storedPath, "utf8");
    assert.equal(stored.includes("rawPrompt"), true);
    assert.equal(stored.includes("private prompt"), false);
    await writeFile(storedPath, stored.replace("Three deterministic comparisons passed.", "Tampered summary."));
    await assert.rejects(() => store.get("benchmark-fixture"), (error: any) => error?.code === "EVALUATION_INTEGRITY_FAILED");
    await assert.rejects(() => store.save({ ...report(), evaluationId: "secret-fixture", summary: "token=private-secret-value" }), (error: any) => error?.code === "EVALUATION_SECRET_REJECTED");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Pi harness reports become bounded evaluation records without raw results", () => {
  const evaluation = evaluationFromPiHarness({
    runId: "pi-fixture",
    model: "gpt-test",
    state: "passed",
    summary: {
      passed: 1,
      total: 1,
      runUsage: { totalTokens: 120 },
      evaluation: {
        taskCompletionRate: { rate: 1 },
        skillUseRate: { rate: 1 },
        humanApprovalBypassRate: { rate: 0 },
        toolCallsPerTask: 4,
        turnsPerTask: 3,
      },
    },
    results: [{ caseId: "safe-case", passed: true, privatePrompt: "must-not-persist" }],
  });
  assert.equal(evaluation.state, "passed");
  assert.equal(evaluation.metrics.find((metric) => metric.metricId === "total_tokens")?.value, 120);
  assert.equal(JSON.stringify(evaluation).includes("must-not-persist"), false);
});

test("Workbench API exposes evaluation summaries from a dedicated store", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-evaluation-api-"));
  const evaluationStore = new EvaluationStore(join(root, "evaluations"));
  await evaluationStore.save(report());
  const runtime = await createEarthWorkspaceServer({ host: "127.0.0.1", port: 0, workspace: new EarthWorkspace(join(root, "earth"), process.execPath), evaluationStore });
  await runtime.listen();
  try {
    const address = runtime.server.address();
    if (!address || typeof address === "string") throw new Error("test server address unavailable");
    const base = `http://127.0.0.1:${address.port}`;
    const listed: any = await (await fetch(`${base}/api/evaluations`)).json();
    assert.equal(listed.evaluations[0].evaluationId, "benchmark-fixture");
    const detail: any = await (await fetch(`${base}/api/evaluations/benchmark-fixture`)).json();
    assert.equal(detail.metrics[0].baseline, 1_000);
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});
