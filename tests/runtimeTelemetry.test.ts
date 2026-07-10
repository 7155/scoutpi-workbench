import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MixedTextTokenEstimator, RuntimeTelemetryStore } from "../packages/runtime-telemetry/src/index.ts";
import { EarthWorkspace } from "../packages/earth-workspace/src/index.ts";

test("mixed-text telemetry estimates Chinese and English without persisting payload content", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-telemetry-"));
  try {
    const estimator = new MixedTextTokenEstimator();
    assert.equal(estimator.estimate("地球观测调查") > estimator.estimate("earth"), true);
    const store = new RuntimeTelemetryStore(root);
    await store.record({
      kind: "pi_tool",
      operation: "earth_tool:plan",
      request: { token: "secret-value", question: "分析区域变化" },
      result: "plan ok",
      elapsedMs: 12,
      cost: { nominalPixels: 100, pixelYears: 400 },
    });
    await store.record({ kind: "cache", operation: "visualization:tile_contract", request: {}, result: {}, cacheHit: true });
    const persisted = await readFile(store.path, "utf8");
    assert.equal(persisted.includes("secret-value"), false);
    assert.equal(persisted.includes("分析区域变化"), false);
    const summary = await store.summary();
    assert.equal(summary.calls.piTool, 1);
    assert.equal(summary.estimatedTokens.total > 0, true);
    assert.equal(summary.cache.hitRate, 1);
    assert.equal(summary.cost.pixelYears, 400);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Earth Workspace records backend and Pi-facing telemetry as compact metrics", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-workspace-telemetry-"));
  class TelemetryWorkspace extends EarthWorkspace {
    protected override async callWorker(payload: Record<string, unknown>): Promise<any> {
      if (payload.op === "environment") return { ok: true, installed: true, authenticated: false, backends: [] };
      return { ok: true };
    }
  }
  try {
    const workspace = new TelemetryWorkspace(root, process.execPath);
    await workspace.init();
    await workspace.environment();
    await workspace.recordToolTelemetry("environment", { op: "environment" }, "environment installed=true");
    const summary = await workspace.telemetrySummary();
    assert.equal(summary.calls.backend, 1);
    assert.equal(summary.calls.piTool, 1);
    assert.equal(summary.byOperation.some((row) => row.operation === "earth-engine:environment"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
