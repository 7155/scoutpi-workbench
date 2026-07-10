import { randomUUID } from "node:crypto";

export type EarthBackendRisk = "read" | "compute" | "artifact" | "state_change";

export interface EarthBackendOperationDefinition {
  name: string;
  description: string;
  risk: EarthBackendRisk;
  timeoutMs: number;
  requiredFields?: string[];
  requiresConfirmation?: boolean;
  artifactKinds?: string[];
  maxInlineResultBytes?: number;
}

export interface EarthBackendManifest {
  schemaVersion: "scoutpi.earth.backend.v1";
  backendId: string;
  displayName: string;
  description: string;
  version: string;
  provider: string;
  capabilities: string[];
  dependencies?: Array<{ packageName: string; optional?: boolean }>;
  operations: EarthBackendOperationDefinition[];
}

export interface EarthBackendProbe {
  backendId: string;
  available: boolean;
  version?: string;
  reason?: string;
  checkedAt: string;
  details?: Record<string, unknown>;
}

export interface EarthBackendExecutionContext {
  executionId: string;
  workspaceRoot: string;
  artifactDir?: string;
  workerId?: string;
  signal: AbortSignal;
  report(update: EarthBackendProgress): void;
}

export interface EarthBackendProgress {
  phase: string;
  message: string;
  percent?: number;
  details?: Record<string, string | number | boolean>;
}

export interface EarthBackendCriticRule {
  ruleId: string;
  description: string;
  severity: "warning" | "blocking";
}

export interface EarthBackendProvider {
  manifest: EarthBackendManifest;
  probe?(context: Omit<EarthBackendExecutionContext, "executionId">): Promise<EarthBackendProbe>;
  validate?(operation: string, payload: Record<string, unknown>): void;
  criticRules?(): EarthBackendCriticRule[];
  execute(operation: string, payload: Record<string, unknown>, context: EarthBackendExecutionContext): Promise<Record<string, unknown>>;
}

export interface EarthBackendExecution {
  backendId: string;
  operation: string;
  executionId: string;
  elapsedMs: number;
  requestBytes: number;
  resultBytes: number;
  result: Record<string, unknown>;
}

function invalid(message: string): never {
  throw Object.assign(new Error(`BACKEND_MANIFEST_INVALID: ${message}`), { code: "BACKEND_MANIFEST_INVALID" });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function validateEarthBackendManifest(input: EarthBackendManifest): EarthBackendManifest {
  if (!isPlainObject(input) || input.schemaVersion !== "scoutpi.earth.backend.v1") invalid("unsupported schemaVersion");
  const allowedManifestKeys = new Set(["schemaVersion", "backendId", "displayName", "description", "version", "provider", "capabilities", "dependencies", "operations"]);
  if (Object.keys(input).some((key) => !allowedManifestKeys.has(key))) invalid("unknown manifest fields are not allowed");
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(input.backendId || "")) invalid("backendId must be a safe lowercase identifier");
  if (!input.displayName?.trim() || input.displayName.length > 120 || !input.description?.trim() || input.description.length > 500 || !input.provider?.trim() || input.provider.length > 120) invalid("displayName, description and provider must be concise");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(input.version || "")) invalid("version must be semantic version text");
  if (!Array.isArray(input.capabilities) || !input.capabilities.length || input.capabilities.length > 24 || input.capabilities.some((value) => !/^[a-z][a-z0-9_]{1,63}$/.test(value)) || new Set(input.capabilities).size !== input.capabilities.length) invalid("capabilities must contain 1-24 unique safe identifiers");
  if (!Array.isArray(input.operations) || !input.operations.length || input.operations.length > 32) invalid("operations must contain 1-32 definitions");
  const names = new Set<string>();
  for (const operation of input.operations) {
    const allowedOperationKeys = new Set(["name", "description", "risk", "timeoutMs", "requiredFields", "requiresConfirmation", "artifactKinds", "maxInlineResultBytes"]);
    if (!isPlainObject(operation) || Object.keys(operation).some((key) => !allowedOperationKeys.has(key))) invalid("operation contains unknown fields");
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(operation.name || "") || names.has(operation.name)) invalid("operation names must be unique safe identifiers");
    names.add(operation.name);
    if (!operation.description?.trim() || operation.description.length > 300 || !["read", "compute", "artifact", "state_change"].includes(operation.risk)) invalid(`${operation.name} has invalid metadata`);
    if (!Number.isInteger(operation.timeoutMs) || operation.timeoutMs < 100 || operation.timeoutMs > 900_000) invalid(`${operation.name} timeoutMs must be 100-900000`);
    if ((operation.requiredFields || []).some((field) => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field)) || new Set(operation.requiredFields || []).size !== (operation.requiredFields || []).length) invalid(`${operation.name} requiredFields are invalid`);
    if ((operation.artifactKinds || []).some((kind) => !/^[a-z][a-z0-9_]{1,63}$/.test(kind))) invalid(`${operation.name} artifactKinds are invalid`);
    const maxBytes = operation.maxInlineResultBytes ?? 64 * 1024;
    if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 1024 * 1024) invalid(`${operation.name} maxInlineResultBytes must be 1024-1048576`);
  }
  for (const dependency of input.dependencies || []) {
    if (!isPlainObject(dependency) || !/^[A-Za-z0-9_.@/-]{1,120}$/.test(dependency.packageName || "")) invalid("dependency packageName is invalid");
  }
  return structuredClone(input);
}

export class EarthBackendRegistry {
  private readonly providers = new Map<string, EarthBackendProvider>();

  constructor(providers: EarthBackendProvider[] = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: EarthBackendProvider): void {
    const manifest = validateEarthBackendManifest(provider.manifest);
    if (this.providers.has(manifest.backendId)) throw Object.assign(new Error(`BACKEND_DUPLICATE: ${manifest.backendId}`), { code: "BACKEND_DUPLICATE" });
    this.providers.set(manifest.backendId, { ...provider, manifest });
  }

  manifests(): EarthBackendManifest[] {
    return [...this.providers.values()].map((provider) => structuredClone(provider.manifest)).sort((a, b) => a.backendId.localeCompare(b.backendId));
  }

  get(backendId: string): EarthBackendProvider {
    const provider = this.providers.get(backendId);
    if (!provider) throw Object.assign(new Error(`BACKEND_NOT_FOUND: ${backendId}`), { code: "BACKEND_NOT_FOUND" });
    return provider;
  }

  async probe(backendId: string, context: { workspaceRoot: string; artifactDir?: string; workerId?: string; signal?: AbortSignal }): Promise<EarthBackendProbe> {
    const provider = this.get(backendId);
    if (!provider.probe) return { backendId, available: true, version: provider.manifest.version, checkedAt: new Date().toISOString() };
    const controller = new AbortController();
    const onAbort = () => controller.abort(context.signal?.reason);
    context.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await provider.probe({ workspaceRoot: context.workspaceRoot, artifactDir: context.artifactDir, workerId: context.workerId, signal: controller.signal, report() {} });
    } finally {
      context.signal?.removeEventListener("abort", onAbort);
    }
  }

  async execute(backendId: string, operationName: string, payload: Record<string, unknown>, context: { workspaceRoot: string; artifactDir?: string; workerId?: string; signal?: AbortSignal; onUpdate?: (update: EarthBackendProgress) => void }): Promise<EarthBackendExecution> {
    const provider = this.get(backendId);
    const operation = provider.manifest.operations.find((item) => item.name === operationName);
    if (!operation) throw Object.assign(new Error(`BACKEND_OPERATION_NOT_ALLOWED: ${backendId}/${operationName}`), { code: "BACKEND_OPERATION_NOT_ALLOWED" });
    if (!isPlainObject(payload)) throw Object.assign(new Error("BACKEND_INPUT_INVALID: payload must be a plain object"), { code: "BACKEND_INPUT_INVALID" });
    const missing = (operation.requiredFields || []).filter((field) => !(field in payload));
    if (missing.length) throw Object.assign(new Error(`BACKEND_INPUT_INVALID: missing ${missing.join(", ")}`), { code: "BACKEND_INPUT_INVALID" });
    if (operation.requiresConfirmation && payload.confirmed !== true) throw Object.assign(new Error(`BACKEND_CONFIRMATION_REQUIRED: ${backendId}/${operationName}`), { code: "BACKEND_CONFIRMATION_REQUIRED" });
    provider.validate?.(operationName, structuredClone(payload));

    const executionId = `backend_${randomUUID()}`;
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort(context.signal?.reason);
    context.signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => { timedOut = true; controller.abort(new Error("backend timeout")); }, operation.timeoutMs);
    const started = performance.now();
    try {
      const result = await provider.execute(operationName, structuredClone(payload), {
        executionId,
        workspaceRoot: context.workspaceRoot,
        artifactDir: context.artifactDir,
        workerId: context.workerId,
        signal: controller.signal,
        report(update) {
          if (!update || !/^[a-z][a-z0-9_-]{1,63}$/.test(update.phase || "") || !update.message?.trim() || update.message.length > 500 || (update.percent !== undefined && (!Number.isFinite(update.percent) || update.percent < 0 || update.percent > 100))) {
            throw Object.assign(new Error("BACKEND_PROGRESS_INVALID"), { code: "BACKEND_PROGRESS_INVALID" });
          }
          context.onUpdate?.(structuredClone(update));
        },
      });
      if (controller.signal.aborted) throw Object.assign(new Error(timedOut ? `BACKEND_TIMEOUT: ${backendId}/${operationName}` : `BACKEND_CANCELLED: ${backendId}/${operationName}`), { code: timedOut ? "BACKEND_TIMEOUT" : "BACKEND_CANCELLED" });
      if (!isPlainObject(result)) throw Object.assign(new Error("BACKEND_RESULT_INVALID: provider must return a plain object"), { code: "BACKEND_RESULT_INVALID" });
      const resultBytes = Buffer.byteLength(JSON.stringify(result));
      if (resultBytes > (operation.maxInlineResultBytes ?? 64 * 1024)) throw Object.assign(new Error(`BACKEND_RESULT_TOO_LARGE: ${resultBytes} bytes; write the full result as an artifact`), { code: "BACKEND_RESULT_TOO_LARGE" });
      return {
        backendId,
        operation: operationName,
        executionId,
        elapsedMs: Math.round((performance.now() - started) * 100) / 100,
        requestBytes: Buffer.byteLength(JSON.stringify(payload)),
        resultBytes,
        result,
      };
    } catch (error) {
      if (timedOut) throw Object.assign(new Error(`BACKEND_TIMEOUT: ${backendId}/${operationName}`), { code: "BACKEND_TIMEOUT", cause: error });
      if (context.signal?.aborted) throw Object.assign(new Error(`BACKEND_CANCELLED: ${backendId}/${operationName}`), { code: "BACKEND_CANCELLED", cause: error });
      throw error;
    } finally {
      clearTimeout(timeout);
      context.signal?.removeEventListener("abort", onAbort);
    }
  }
}
