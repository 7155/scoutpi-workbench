import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ImeCoreContextProvider } from "../../packages/runtime-context/src/index.ts";

type Sample = { run: number; state: string; totalMs: number; sourceMs?: number; workerReused: boolean; itemCount: number; errorCode?: string };

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function pathHash(value: string): string {
  return createHash("sha256").update(resolve(value)).digest("hex").slice(0, 16);
}

async function sample(input: { coreRoot: string; dbPath: string; query: string; iterations: number; persistent: boolean }): Promise<Sample[]> {
  const provider = new ImeCoreContextProvider({ coreRoot: input.coreRoot, dbPath: input.dbPath, persistent: input.persistent });
  const rows: Sample[] = [];
  try {
    for (let index = 0; index < input.iterations; index += 1) {
      const result = await provider.query({ sessionId: `benchmark-${input.persistent ? "persistent" : "one-shot"}-${index + 1}`, query: input.query, project: "scoutpi-workbench-benchmark", maxItems: 5, timeoutMs: 5_000 });
      rows.push({ run: index + 1, state: result.status.state, totalMs: result.status.latencyMs, sourceMs: result.status.sourceLatencyMs, workerReused: result.status.workerReused === true, itemCount: result.status.itemCount, errorCode: result.status.errorCode });
    }
  } finally { await provider.close(); }
  return rows;
}

const coreRoot = process.env.SCOUTPI_IME_CORE_ROOT?.trim();
const dbPath = process.env.SCOUTPI_IME_CORE_DB?.trim();
if (!coreRoot || !dbPath) throw new Error("SCOUTPI_IME_CORE_ROOT and SCOUTPI_IME_CORE_DB are required");
const query = process.env.SCOUTPI_CONTEXT_BENCHMARK_QUERY?.trim() || "输入法 RAG Core 上下文";
const iterations = Math.max(3, Math.min(10, Number(process.env.SCOUTPI_CONTEXT_BENCHMARK_ITERATIONS || 4) || 4));

const warmup = await sample({ coreRoot, dbPath, query, iterations: 1, persistent: false });
const oneShot = await sample({ coreRoot, dbPath, query, iterations, persistent: false });
const persistent = await sample({ coreRoot, dbPath, query, iterations, persistent: true });
const failed = [...warmup, ...oneShot, ...persistent].filter((row) => row.state !== "ready");
const oneShotMedianMs = median(oneShot.map((row) => row.totalMs));
const persistentWarm = persistent.slice(1);
const persistentWarmMedianMs = median(persistentWarm.map((row) => row.totalMs));
const reductionPercent = oneShotMedianMs ? Math.round((1 - persistentWarmMedianMs / oneShotMedianMs) * 1_000) / 10 : 0;
const createdAt = new Date().toISOString();
const runId = `context_${createdAt.replace(/[^0-9]/g, "").slice(0, 17)}`;
const outputDirectory = resolve("exports", "context_benchmarks", runId);
await mkdir(outputDirectory, { recursive: true });
const report = {
  schemaVersion: "scoutpi.context-provider-benchmark.v1",
  runId,
  createdAt,
  providerId: "wisdom-weasel-rag-ime",
  coreRootHash: pathHash(coreRoot),
  dbPathHash: pathHash(dbPath),
  queryHash: createHash("sha256").update(query).digest("hex"),
  iterations,
  passed: failed.length === 0,
  summary: { oneShotMedianMs, persistentColdMs: persistent[0]?.totalMs, persistentWarmMedianMs, reductionPercent },
  samples: { oneShot, persistent },
};
const reportPath = join(outputDirectory, "report.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ passed: report.passed, summary: report.summary, reportPath }, null, 2));
if (!report.passed) process.exitCode = 2;
