import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type RuntimeTelemetryKind = "backend" | "pi_tool" | "cache" | "workflow" | "runtime";

export interface RuntimeTelemetryEvent {
  schemaVersion: "scoutpi.runtime.telemetry.v1";
  eventId: string;
  at: string;
  kind: RuntimeTelemetryKind;
  operation: string;
  status: "ok" | "failed" | "cancelled";
  backendId?: string;
  traceId?: string;
  elapsedMs?: number;
  inputBytes: number;
  outputBytes: number;
  inputEstimatedTokens: number;
  outputEstimatedTokens: number;
  artifactBytes?: number;
  cacheHit?: boolean;
  cost?: {
    nominalPixels?: number;
    pixelYears?: number;
    estimatedRasterBytes?: number;
    remoteTasks?: number;
  };
  errorCode?: string;
}

export interface RuntimeTelemetrySummary {
  schemaVersion: "scoutpi.runtime.telemetry-summary.v1";
  eventCount: number;
  since?: string;
  until?: string;
  calls: { backend: number; piTool: number; workflow: number };
  failures: number;
  elapsedMs: number;
  bytes: { input: number; output: number; artifacts: number };
  estimatedTokens: { input: number; output: number; total: number };
  cache: { hits: number; misses: number; hitRate?: number };
  cost: { nominalPixels: number; pixelYears: number; estimatedRasterBytes: number; remoteTasks: number };
  byOperation: Array<{ operation: string; calls: number; failures: number; elapsedMs: number; outputEstimatedTokens: number }>;
}

export class MixedTextTokenEstimator {
  readonly name = "mixed-text-heuristic-v1";

  estimate(text: string): number {
    let score = 0;
    for (const char of text) {
      const cp = char.codePointAt(0) ?? 0;
      const cjk = (cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0xac00 && cp <= 0xd7af);
      if (cjk) score += 1;
      else if (/\s/.test(char)) score += 0.08;
      else if (/[A-Za-z0-9]/.test(char)) score += 0.25;
      else score += 0.45;
    }
    return Math.ceil(score * 1.1);
  }
}

function serialized(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value) ?? ""; } catch { return "[unserializable]"; }
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export class RuntimeTelemetryStore {
  readonly path: string;
  readonly estimator = new MixedTextTokenEstimator();

  constructor(root: string) {
    this.path = resolve(root, "telemetry", "events.jsonl");
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
  }

  async record(input: {
    kind: RuntimeTelemetryKind;
    operation: string;
    status?: RuntimeTelemetryEvent["status"];
    backendId?: string;
    traceId?: string;
    elapsedMs?: number;
    request?: unknown;
    result?: unknown;
    artifactBytes?: number;
    cacheHit?: boolean;
    cost?: RuntimeTelemetryEvent["cost"];
    errorCode?: string;
  }): Promise<RuntimeTelemetryEvent> {
    await this.init();
    if (!/^[a-z][a-z0-9_.:/-]{1,120}$/i.test(input.operation || "")) throw Object.assign(new Error("TELEMETRY_OPERATION_INVALID"), { code: "TELEMETRY_OPERATION_INVALID" });
    const requestText = serialized(input.request);
    const resultText = serialized(input.result);
    const event: RuntimeTelemetryEvent = {
      schemaVersion: "scoutpi.runtime.telemetry.v1",
      eventId: `telemetry_${randomUUID()}`,
      at: new Date().toISOString(),
      kind: input.kind,
      operation: input.operation,
      status: input.status ?? "ok",
      backendId: input.backendId,
      traceId: input.traceId,
      elapsedMs: finite(input.elapsedMs),
      inputBytes: Buffer.byteLength(requestText),
      outputBytes: Buffer.byteLength(resultText),
      inputEstimatedTokens: this.estimator.estimate(requestText),
      outputEstimatedTokens: this.estimator.estimate(resultText),
      artifactBytes: finite(input.artifactBytes),
      cacheHit: input.cacheHit,
      cost: input.cost ? {
        nominalPixels: finite(input.cost.nominalPixels),
        pixelYears: finite(input.cost.pixelYears),
        estimatedRasterBytes: finite(input.cost.estimatedRasterBytes),
        remoteTasks: finite(input.cost.remoteTasks),
      } : undefined,
      errorCode: input.errorCode?.slice(0, 120),
    };
    await appendFile(this.path, `${JSON.stringify(event)}\n`);
    return event;
  }

  async recent(limit = 100): Promise<RuntimeTelemetryEvent[]> {
    const bounded = Math.max(1, Math.min(2_000, Math.floor(limit)));
    let text = "";
    try { text = await readFile(this.path, "utf8"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const rows: RuntimeTelemetryEvent[] = [];
    for (const line of text.trim().split("\n").slice(-bounded)) {
      if (!line) continue;
      try {
        const row = JSON.parse(line) as RuntimeTelemetryEvent;
        if (row.schemaVersion === "scoutpi.runtime.telemetry.v1") rows.push(row);
      } catch {}
    }
    return rows.reverse();
  }

  async summary(limit = 5_000): Promise<RuntimeTelemetrySummary> {
    const events = (await this.recent(limit)).reverse();
    const byOperation = new Map<string, { operation: string; calls: number; failures: number; elapsedMs: number; outputEstimatedTokens: number }>();
    let backend = 0;
    let piTool = 0;
    let workflow = 0;
    let failures = 0;
    let elapsedMs = 0;
    let inputBytes = 0;
    let outputBytes = 0;
    let artifacts = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let hits = 0;
    let misses = 0;
    const cost = { nominalPixels: 0, pixelYears: 0, estimatedRasterBytes: 0, remoteTasks: 0 };
    for (const event of events) {
      if (event.kind === "backend") backend += 1;
      if (event.kind === "pi_tool") piTool += 1;
      if (event.kind === "workflow") workflow += 1;
      if (event.status !== "ok") failures += 1;
      elapsedMs += event.elapsedMs || 0;
      inputBytes += event.inputBytes;
      outputBytes += event.outputBytes;
      artifacts += event.artifactBytes || 0;
      inputTokens += event.inputEstimatedTokens;
      outputTokens += event.outputEstimatedTokens;
      if (event.cacheHit === true) hits += 1;
      if (event.cacheHit === false) misses += 1;
      cost.nominalPixels += event.cost?.nominalPixels || 0;
      cost.pixelYears += event.cost?.pixelYears || 0;
      cost.estimatedRasterBytes += event.cost?.estimatedRasterBytes || 0;
      cost.remoteTasks += event.cost?.remoteTasks || 0;
      const row = byOperation.get(event.operation) || { operation: event.operation, calls: 0, failures: 0, elapsedMs: 0, outputEstimatedTokens: 0 };
      row.calls += 1;
      row.failures += event.status === "ok" ? 0 : 1;
      row.elapsedMs += event.elapsedMs || 0;
      row.outputEstimatedTokens += event.outputEstimatedTokens;
      byOperation.set(event.operation, row);
    }
    return {
      schemaVersion: "scoutpi.runtime.telemetry-summary.v1",
      eventCount: events.length,
      since: events[0]?.at,
      until: events.at(-1)?.at,
      calls: { backend, piTool, workflow },
      failures,
      elapsedMs: Math.round(elapsedMs * 100) / 100,
      bytes: { input: inputBytes, output: outputBytes, artifacts },
      estimatedTokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
      cache: { hits, misses, hitRate: hits + misses ? hits / (hits + misses) : undefined },
      cost,
      byOperation: [...byOperation.values()].sort((a, b) => b.calls - a.calls || b.elapsedMs - a.elapsedMs),
    };
  }
}
