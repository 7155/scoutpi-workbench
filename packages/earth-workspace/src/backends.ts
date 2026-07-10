import type { EarthBackendManifest, EarthBackendProvider } from "../../earth-backend-sdk/src/index.ts";

export type PythonWorkerRunner = (payload: Record<string, unknown>, workerId?: string, signal?: AbortSignal) => Promise<Record<string, unknown>>;

const earthEngineManifest: EarthBackendManifest = {
  schemaVersion: "scoutpi.earth.backend.v1",
  backendId: "earth-engine",
  displayName: "Google Earth Engine",
  description: "Typed server-side collection, task, probe, cancellation and tile operations.",
  version: "1.0.0",
  provider: "ScoutPi built-in",
  capabilities: ["dataset_probe", "cloud_compute", "task_supervision", "map_tiles"],
  dependencies: [{ packageName: "earthengine-api", optional: false }],
  operations: [
    { name: "environment", description: "Inspect Earth Engine installation and authentication.", risk: "read", timeoutMs: 30_000, maxInlineResultBytes: 128 * 1024 },
    { name: "probe_adapter", description: "Verify a declarative adapter against a live collection sample.", risk: "compute", timeoutMs: 90_000, requiredFields: ["adapter"], maxInlineResultBytes: 128 * 1024 },
    { name: "run", description: "Run a typed plan inline or submit provider tasks.", risk: "compute", timeoutMs: 900_000, requiredFields: ["mode", "plan", "options", "artifactDir"], artifactKinds: ["json", "csv", "geotiff"], maxInlineResultBytes: 256 * 1024 },
    { name: "status", description: "Read provider task states.", risk: "read", timeoutMs: 60_000, requiredFields: ["taskIds"], maxInlineResultBytes: 128 * 1024 },
    { name: "visualize", description: "Create a short-lived map tile contract.", risk: "read", timeoutMs: 90_000, requiredFields: ["plan", "role", "year"], maxInlineResultBytes: 64 * 1024 },
    { name: "cancel", description: "Request cancellation of provider tasks.", risk: "state_change", timeoutMs: 60_000, requiredFields: ["taskIds"], maxInlineResultBytes: 64 * 1024 },
  ],
};

const geedimManifest: EarthBackendManifest = {
  schemaVersion: "scoutpi.earth.backend.v1",
  backendId: "geedim",
  displayName: "geedim local export",
  description: "Bounded local GeoTIFF delivery from a typed Earth Engine image.",
  version: "1.0.0",
  provider: "ScoutPi built-in",
  capabilities: ["local_export", "artifact_delivery"],
  dependencies: [{ packageName: "geedim", optional: true }],
  operations: [
    { name: "export_local", description: "Write a checked GeoTIFF and manifest into a job directory.", risk: "artifact", timeoutMs: 900_000, requiredFields: ["plan", "request", "artifactDir"], artifactKinds: ["geotiff", "json"], maxInlineResultBytes: 64 * 1024 },
  ],
};

const localAnalysisManifest: EarthBackendManifest = {
  schemaVersion: "scoutpi.earth.backend.v1",
  backendId: "local-analysis",
  displayName: "Local deterministic analysis",
  description: "Bounded statistics over approved CSV, JSON and GeoJSON artifacts.",
  version: "1.0.0",
  provider: "ScoutPi built-in",
  capabilities: ["numeric_validation", "artifact_analysis"],
  operations: [
    { name: "analyze", description: "Compute deterministic numeric summaries and a local artifact.", risk: "compute", timeoutMs: 120_000, requiredFields: ["path", "artifactDir"], artifactKinds: ["json"], maxInlineResultBytes: 256 * 1024 },
  ],
};

function packageProbe(backendId: string, packageId: string, runner: PythonWorkerRunner) {
  return async (context: { workspaceRoot: string; artifactDir?: string; workerId?: string; signal: AbortSignal }) => {
    const environment = await runner({ op: "environment" }, context.workerId, context.signal);
    const row = Array.isArray(environment.backends) ? environment.backends.find((item: any) => item?.id === packageId) : undefined;
    const available = packageId === "earthengine" ? environment.installed === true : row?.installed === true;
    return {
      backendId,
      available,
      version: packageId === "earthengine" ? String(environment.earthengineVersion || "unknown") : row?.version ? String(row.version) : undefined,
      reason: available ? undefined : packageId === "earthengine" ? String(environment.code || "Earth Engine is not installed") : `${packageId} is not installed`,
      checkedAt: new Date().toISOString(),
      details: packageId === "earthengine" ? { authenticated: environment.authenticated === true, project: environment.project } : undefined,
    };
  };
}

function workerProvider(manifest: EarthBackendManifest, runner: PythonWorkerRunner, packageId?: string): EarthBackendProvider {
  return {
    manifest,
    probe: packageId ? packageProbe(manifest.backendId, packageId, runner) : async () => ({ backendId: manifest.backendId, available: true, version: manifest.version, checkedAt: new Date().toISOString() }),
    execute: async (operation, payload, context) => await runner({ op: operation, ...payload }, context.workerId, context.signal),
  };
}

export function createBuiltinBackendProviders(runner: PythonWorkerRunner): EarthBackendProvider[] {
  return [
    workerProvider(earthEngineManifest, runner, "earthengine"),
    workerProvider(geedimManifest, runner, "geedim"),
    workerProvider(localAnalysisManifest, runner),
  ];
}
