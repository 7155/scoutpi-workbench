import assert from "node:assert/strict";
import test from "node:test";
import { EarthBackendRegistry, type EarthBackendManifest, type EarthBackendProvider } from "../packages/earth-backend-sdk/src/index.ts";
import { EarthWorkspace } from "../packages/earth-workspace/src/index.ts";

const manifest: EarthBackendManifest = {
  schemaVersion: "scoutpi.earth.backend.v1",
  backendId: "test-backend",
  displayName: "Test backend",
  description: "A reviewed backend fixture.",
  version: "1.0.0",
  provider: "ScoutPi tests",
  capabilities: ["fixture_compute"],
  operations: [
    { name: "echo", description: "Echo a bounded payload.", risk: "read", timeoutMs: 1_000, requiredFields: ["value"], maxInlineResultBytes: 1024 },
    { name: "confirmed", description: "Require explicit confirmation.", risk: "state_change", timeoutMs: 1_000, requiresConfirmation: true },
    { name: "slow", description: "Exercise timeout cancellation.", risk: "compute", timeoutMs: 100 },
  ],
};

function provider(overrides: Partial<EarthBackendProvider> = {}): EarthBackendProvider {
  return {
    manifest,
    probe: async () => ({ backendId: manifest.backendId, available: true, version: manifest.version, checkedAt: new Date().toISOString() }),
    validate: (_operation, payload) => { if (payload.value === "blocked") throw Object.assign(new Error("fixture validation failed"), { code: "FIXTURE_INVALID" }); },
    execute: async (operation, payload, context) => {
      if (operation === "echo") context.report({ phase: "fixture_read", message: "Reading the fixture.", percent: 50 });
      if (operation === "slow") await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 500);
        context.signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true });
      });
      return { operation, value: payload.value ?? null };
    },
    ...overrides,
  };
}

test("Backend SDK registers reviewed manifests and enforces operation contracts", async () => {
  const registry = new EarthBackendRegistry([provider()]);
  assert.deepEqual(registry.manifests().map((item) => item.backendId), ["test-backend"]);
  assert.equal((await registry.probe("test-backend", { workspaceRoot: "/tmp" })).available, true);
  const updates: string[] = [];
  const executed = await registry.execute("test-backend", "echo", { value: "ok" }, { workspaceRoot: "/tmp", onUpdate: (update) => updates.push(update.phase) });
  assert.equal(executed.result.value, "ok");
  assert.equal(executed.requestBytes > 0, true);
  assert.deepEqual(updates, ["fixture_read"]);
  await assert.rejects(() => registry.execute("test-backend", "echo", { value: "blocked" }, { workspaceRoot: "/tmp" }), /fixture validation failed/);
  await assert.rejects(() => registry.execute("test-backend", "echo", {}, { workspaceRoot: "/tmp" }), /missing value/);
  await assert.rejects(() => registry.execute("test-backend", "confirmed", {}, { workspaceRoot: "/tmp" }), /CONFIRMATION_REQUIRED/);
  await assert.rejects(() => registry.execute("test-backend", "missing", {}, { workspaceRoot: "/tmp" }), /OPERATION_NOT_ALLOWED/);
  assert.throws(() => registry.register(provider()), /BACKEND_DUPLICATE/);
});

test("Backend SDK stops slow providers and rejects oversized inline output", async () => {
  const registry = new EarthBackendRegistry([provider()]);
  await assert.rejects(() => registry.execute("test-backend", "slow", {}, { workspaceRoot: "/tmp" }), /BACKEND_TIMEOUT/);
  const oversized = provider({ execute: async () => ({ body: "x".repeat(2_000) }) });
  const largeRegistry = new EarthBackendRegistry([oversized]);
  await assert.rejects(() => largeRegistry.execute("test-backend", "echo", { value: "ok" }, { workspaceRoot: "/tmp" }), /BACKEND_RESULT_TOO_LARGE/);
});

test("Earth Workspace accepts code-reviewed providers without exposing runtime module loading", () => {
  const workspace = new EarthWorkspace(".scoutpi/backend-sdk-test", process.execPath, ".pi/skills", [provider()]);
  const manifests = workspace.listBackendManifests();
  assert.equal(manifests.some((item) => item.backendId === "earth-engine"), true);
  assert.equal(manifests.some((item) => item.backendId === "geedim"), true);
  assert.equal(manifests.some((item) => item.backendId === "test-backend"), true);
  assert.equal(JSON.stringify(manifests).includes("modulePath"), false);
});
