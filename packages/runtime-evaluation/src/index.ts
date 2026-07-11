import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type EvaluationKind = "pi_rpc" | "benchmark" | "end_to_end" | "recovery";
export type EvaluationState = "passed" | "failed" | "blocked";
export type EvaluationUnit = "percent" | "tokens" | "calls" | "turns" | "count" | "ms" | "bytes" | "usd";

export interface EvaluationMetric {
  metricId: string;
  label: string;
  value: number;
  unit: EvaluationUnit;
  baseline?: number;
  current?: number;
  improvementPercent?: number;
  direction?: "lower_is_better" | "higher_is_better" | "neutral";
  detail?: string;
}

export interface EvaluationCheck {
  checkId: string;
  label: string;
  status: "passed" | "failed" | "blocked" | "not_applicable";
  detail?: string;
}

export interface EvaluationReport {
  schemaVersion: "scoutpi.evaluation.v1";
  evaluationId: string;
  kind: EvaluationKind;
  title: string;
  state: EvaluationState;
  createdAt: string;
  model?: string;
  summary: string;
  metrics: EvaluationMetric[];
  checks: EvaluationCheck[];
  privacy: {
    rawPromptStored: false;
    rawToolPayloadStored: false;
    credentialsStored: false;
    providerUrlStored: false;
  };
  provenance: {
    source: string;
    command: string;
    sourceSha256?: string;
  };
  integrity?: { algorithm: "sha256-canonical-json-v1"; sha256: string };
}

const kinds = new Set<EvaluationKind>(["pi_rpc", "benchmark", "end_to_end", "recovery"]);
const states = new Set<EvaluationState>(["passed", "failed", "blocked"]);
const units = new Set<EvaluationUnit>(["percent", "tokens", "calls", "turns", "count", "ms", "bytes", "usd"]);
const checkStates = new Set<EvaluationCheck["status"]>(["passed", "failed", "blocked", "not_applicable"]);

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  throw Object.assign(new Error("evaluation value cannot be canonicalized"), { code: "EVALUATION_INVALID" });
}

function digest(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) || value.includes("..")) throw Object.assign(new Error(`${label} is invalid`), { code: "EVALUATION_ID_INVALID" });
  return value;
}

function safeText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== "string") throw Object.assign(new Error(`${label} must be text`), { code: "EVALUATION_TEXT_INVALID" });
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!text || text.length > maximum) throw Object.assign(new Error(`${label} is invalid`), { code: "EVALUATION_TEXT_INVALID" });
  if (/(?:\bsk-[A-Za-z0-9_-]{10,}|\bBearer\s+\S+|(?:password|secret|token)\s*[:=]\s*\S{6,})/i.test(text)) throw Object.assign(new Error(`${label} contains secret-like material`), { code: "EVALUATION_SECRET_REJECTED" });
  if (/^(?:\/|[A-Za-z]:[\\/])/.test(text)) throw Object.assign(new Error(`${label} must not expose an absolute path`), { code: "EVALUATION_PATH_REJECTED" });
  return text;
}

function finite(value: unknown, label: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw Object.assign(new Error(`${label} must be finite`), { code: "EVALUATION_NUMBER_INVALID" });
  return result;
}

function safeSha256(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw Object.assign(new Error("sourceSha256 is invalid"), { code: "EVALUATION_INTEGRITY_INVALID" });
  return value;
}

function normalizeMetric(input: EvaluationMetric): EvaluationMetric {
  if (!units.has(input.unit)) throw Object.assign(new Error("evaluation metric unit is invalid"), { code: "EVALUATION_METRIC_INVALID" });
  const optional = (value: unknown, label: string) => value === undefined ? undefined : finite(value, label);
  return {
    metricId: safeId(input.metricId, "metricId"),
    label: safeText(input.label, 160, "metric label"),
    value: finite(input.value, "metric value"),
    unit: input.unit,
    baseline: optional(input.baseline, "metric baseline"),
    current: optional(input.current, "metric current"),
    improvementPercent: optional(input.improvementPercent, "metric improvement"),
    direction: input.direction && ["lower_is_better", "higher_is_better", "neutral"].includes(input.direction) ? input.direction : undefined,
    detail: input.detail === undefined ? undefined : safeText(input.detail, 300, "metric detail"),
  };
}

function normalizeCheck(input: EvaluationCheck): EvaluationCheck {
  if (!checkStates.has(input.status)) throw Object.assign(new Error("evaluation check status is invalid"), { code: "EVALUATION_CHECK_INVALID" });
  return {
    checkId: safeId(input.checkId, "checkId"),
    label: safeText(input.label, 180, "check label"),
    status: input.status,
    detail: input.detail === undefined ? undefined : safeText(input.detail, 400, "check detail"),
  };
}

function withoutIntegrity(report: EvaluationReport): Omit<EvaluationReport, "integrity"> {
  const { integrity: _integrity, ...value } = report;
  return value;
}

export function validateEvaluationReport(input: EvaluationReport): EvaluationReport {
  if (!input || typeof input !== "object" || input.schemaVersion !== "scoutpi.evaluation.v1" || !kinds.has(input.kind) || !states.has(input.state)) throw Object.assign(new Error("evaluation report schema is invalid"), { code: "EVALUATION_INVALID" });
  if (!Array.isArray(input.metrics) || input.metrics.length > 64 || !Array.isArray(input.checks) || input.checks.length > 64) throw Object.assign(new Error("evaluation report exceeds result limits"), { code: "EVALUATION_LIMIT_EXCEEDED" });
  if (!Number.isFinite(Date.parse(input.createdAt))) throw Object.assign(new Error("evaluation createdAt is invalid"), { code: "EVALUATION_DATE_INVALID" });
  const report: EvaluationReport = {
    schemaVersion: "scoutpi.evaluation.v1",
    evaluationId: safeId(input.evaluationId, "evaluationId"),
    kind: input.kind,
    title: safeText(input.title, 200, "evaluation title"),
    state: input.state,
    createdAt: new Date(input.createdAt).toISOString(),
    model: input.model === undefined ? undefined : safeText(input.model, 160, "evaluation model"),
    summary: safeText(input.summary, 500, "evaluation summary"),
    metrics: input.metrics.map(normalizeMetric),
    checks: input.checks.map(normalizeCheck),
    privacy: { rawPromptStored: false, rawToolPayloadStored: false, credentialsStored: false, providerUrlStored: false },
    provenance: {
      source: safeText(input.provenance?.source, 120, "evaluation source"),
      command: safeText(input.provenance?.command, 180, "evaluation command"),
      sourceSha256: input.provenance?.sourceSha256 === undefined ? undefined : safeSha256(input.provenance.sourceSha256),
    },
  };
  report.integrity = { algorithm: "sha256-canonical-json-v1", sha256: digest(withoutIntegrity(report)) };
  return report;
}

export class EvaluationStore {
  readonly root: string;

  constructor(root = process.env.SCOUTPI_EVALUATION_ROOT || resolve(".scoutpi/evaluations")) {
    this.root = resolve(root);
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async save(input: EvaluationReport): Promise<EvaluationReport> {
    await this.init();
    const report = validateEvaluationReport(input);
    const path = join(this.root, `${report.evaluationId}.json`);
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
    return report;
  }

  async get(evaluationId: string): Promise<EvaluationReport> {
    await this.init();
    const id = safeId(evaluationId, "evaluationId");
    const stored = JSON.parse(await readFile(join(this.root, `${id}.json`), "utf8")) as EvaluationReport;
    const report = validateEvaluationReport(stored);
    if (stored.integrity?.sha256 !== report.integrity?.sha256) throw Object.assign(new Error("evaluation report integrity check failed"), { code: "EVALUATION_INTEGRITY_FAILED" });
    return report;
  }

  async list(limit = 50): Promise<EvaluationReport[]> {
    await this.init();
    const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 50;
    const rows: EvaluationReport[] = [];
    for (const name of (await readdir(this.root)).filter((value) => value.endsWith(".json")).sort().reverse()) {
      if (rows.length >= boundedLimit) break;
      try { rows.push(await this.get(name.slice(0, -5))); } catch {}
    }
    return rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
}

function rateValue(value: any): number | undefined {
  return typeof value?.rate === "number" && Number.isFinite(value.rate) ? value.rate * 100 : undefined;
}

export function evaluationFromPiHarness(input: any, sourceSha256?: string): EvaluationReport {
  const evaluation = input?.summary?.evaluation || {};
  const runUsage = input?.summary?.runUsage || evaluation;
  const results = Array.isArray(input?.results) ? input.results : [];
  const state: EvaluationState = ["passed", "rpc_ready", "ready", "ready_unlisted_model_override"].includes(String(input?.state)) ? "passed" : String(input?.state).startsWith("blocked") ? "blocked" : "failed";
  const metrics: EvaluationMetric[] = [];
  const addRate = (metricId: string, label: string, value: unknown, direction: EvaluationMetric["direction"] = "higher_is_better") => {
    if (typeof value === "number") metrics.push({ metricId, label, value, unit: "percent", direction });
  };
  addRate("task_completion", "Task completion", rateValue(evaluation.taskCompletionRate));
  addRate("skill_use", "Skill use", rateValue(evaluation.skillUseRate));
  addRate("approval_bypass", "Approval bypass", rateValue(evaluation.humanApprovalBypassRate), "lower_is_better");
  if (Number.isFinite(evaluation.toolCallsPerTask)) metrics.push({ metricId: "tool_calls", label: "Tool calls per task", value: evaluation.toolCallsPerTask, unit: "calls", direction: "lower_is_better" });
  if (Number.isFinite(evaluation.turnsPerTask)) metrics.push({ metricId: "turns", label: "Turns per task", value: evaluation.turnsPerTask, unit: "turns", direction: "lower_is_better" });
  if (Number.isFinite(runUsage?.totalTokens)) metrics.push({ metricId: "total_tokens", label: "Total tokens", value: runUsage.totalTokens, unit: "tokens", direction: "lower_is_better" });
  const passed = Number(input?.summary?.passed || 0);
  const total = Number(input?.summary?.total || input?.caseCount || 0);
  metrics.push({ metricId: "cases_passed", label: "Cases passed", value: passed, unit: "count", current: passed, baseline: total, direction: "higher_is_better", detail: `${passed}/${total || 0} selected cases` });
  const checks: EvaluationCheck[] = results.slice(0, 32).map((result: any) => {
    const code = result?.failure?.code || result?.modelErrors?.[0]?.code;
    return { checkId: `case:${safeId(String(result?.caseId || "unknown"), "caseId")}`, label: `Case ${String(result?.caseId || "unknown")}`, status: result?.passed ? "passed" : code === "MODEL_NOT_FOUND" ? "blocked" : "failed", detail: code ? `code=${String(code).slice(0, 80)}` : result?.passed ? "Outcome and policy checks passed" : "Outcome or policy check failed" };
  });
  if (!checks.length) checks.push({ checkId: "runtime_boot", label: "Pi RPC runtime boot", status: state === "passed" ? "passed" : state, detail: input?.rpc?.skillLoaded ? "Extensions and investigation Skill loaded" : "No model turn was required" });
  return validateEvaluationReport({
    schemaVersion: "scoutpi.evaluation.v1",
    evaluationId: safeId(String(input?.runId || `pi_${Date.now()}`), "evaluationId"),
    kind: "pi_rpc",
    title: "Real Pi RPC evaluation",
    state,
    createdAt: new Date().toISOString(),
    model: input?.model ? String(input.model) : undefined,
    summary: total ? `${passed}/${total} selected cases passed with persisted outcome and policy scoring.` : `Pi RPC state: ${String(input?.state || "unknown")}.`,
    metrics,
    checks,
    privacy: { rawPromptStored: false, rawToolPayloadStored: false, credentialsStored: false, providerUrlStored: false },
    provenance: { source: "pi-rpc-harness", command: "pnpm harness:pi-live", sourceSha256 },
  });
}
