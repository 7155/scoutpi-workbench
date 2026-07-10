import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EarthWorkspace, type EarthAdapterPack, type InvestigationSpec } from "../../packages/earth-workspace/src/index.ts";
import { scorePiHarnessCase, summarizePiHarnessEvents, type PiHarnessApproval, type PiHarnessBudget, type PiHarnessCase } from "./scorers.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = new Set(process.argv.slice(2));
const live = args.has("--live") || process.env.SCOUTPI_PI_LIVE === "1";
const rpcSmoke = args.has("--rpc-smoke");
const runAllCases = args.has("--all") || process.env.SCOUTPI_PI_ALL_CASES === "1";
const selectedCase = process.argv.find((value) => value.startsWith("--case="))?.slice("--case=".length) || process.env.SCOUTPI_PI_CASE;
const model = process.env.SCOUTPI_PI_MODEL || "gpt-5.6";
const baseUrl = (process.env.SCOUTPI_PI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

function boundedNumber(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  return value;
}

const modelMaxOutputTokens = Math.floor(boundedNumber("SCOUTPI_PI_MAX_OUTPUT_TOKENS", 16_384, 512, 128_000));
const defaultBudget: PiHarnessBudget = {
  maxToolCalls: Math.floor(boundedNumber("SCOUTPI_PI_CASE_MAX_TOOL_CALLS", 12, 1, 100)),
  maxTurns: Math.floor(boundedNumber("SCOUTPI_PI_CASE_MAX_TURNS", 8, 1, 100)),
  maxTotalTokens: Math.floor(boundedNumber("SCOUTPI_PI_CASE_MAX_TOKENS", 120_000, 1_000, 2_000_000)),
  maxReportedCostUsd: boundedNumber("SCOUTPI_PI_CASE_MAX_COST_USD", 0, 0, 1_000) || undefined,
};
const runMaxTokens = Math.floor(boundedNumber("SCOUTPI_PI_RUN_MAX_TOKENS", 500_000, 1_000, 20_000_000));

function loadKey(): string | undefined {
  if (process.env.SCOUTPI_HARNESS_API_KEY) return process.env.SCOUTPI_HARNESS_API_KEY;
  const path = process.env.SCOUTPI_HARNESS_KEY_FILE || process.env.SCOUTPI_OPENAI_KEY_FILE;
  if (!path) return undefined;
  const text = requireText(path);
  return text.match(/sk-[A-Za-z0-9_-]{10,}/)?.[0];
}

function requireText(path: string): string {
  try { return readFileSync(path, "utf8"); }
  catch { return ""; }
}

async function modelPreflight(key: string | undefined): Promise<{ available: boolean; status?: number; listedModels: string[]; error?: string }> {
  if (!key) return { available: false, listedModels: [], error: "SCOUTPI_HARNESS_KEY_FILE or SCOUTPI_HARNESS_API_KEY is required" };
  try {
    const response = await fetch(`${baseUrl}/models`, { headers: { authorization: `Bearer ${key}` } });
    const body: any = await response.json().catch(() => ({}));
    const listedModels = Array.isArray(body.data) ? body.data.map((item: any) => String(item.id)) : [];
    return { available: response.ok && listedModels.includes(model), status: response.status, listedModels, error: response.ok ? undefined : String(body.error?.message || response.statusText) };
  } catch (error) { return { available: false, listedModels: [], error: error instanceof Error ? error.message : String(error) }; }
}

class JsonlRpcClient {
  private process?: ChildProcess;
  private sequence = 0;
  private readonly pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  readonly events: any[] = [];
  readonly approvals: PiHarnessApproval[] = [];
  stderr = "";
  budgetExceeded?: string;
  private readonly command: string;
  private readonly commandArgs: string[];
  private readonly cwd: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly allowApprovals: boolean;
  private readonly budget?: PiHarnessBudget;
  private abortSent = false;

  constructor(command: string, commandArgs: string[], cwd: string, env: NodeJS.ProcessEnv, allowApprovals: boolean, budget?: PiHarnessBudget) {
    this.command = command;
    this.commandArgs = commandArgs;
    this.cwd = cwd;
    this.env = env;
    this.allowApprovals = allowApprovals;
    this.budget = budget;
  }

  async start(): Promise<void> {
    this.process = spawn(this.command, this.commandArgs, { cwd: this.cwd, env: this.env, stdio: ["pipe", "pipe", "pipe"] });
    this.process.stderr?.on("data", (chunk) => { this.stderr += String(chunk); });
    const lines = createInterface({ input: this.process.stdout! });
    lines.on("line", (line) => { void this.handleLine(line); });
    this.process.once("exit", (code, signal) => {
      const error = new Error(`Pi RPC exited code=${code} signal=${signal}: ${this.stderr.slice(-2_000)}`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    if (this.process.exitCode !== null) throw new Error(`Pi RPC failed to start: ${this.stderr}`);
  }

  async request(command: Record<string, unknown>): Promise<any> {
    if (!this.process?.stdin) throw new Error("Pi RPC is not running");
    const id = `harness_${++this.sequence}`;
    this.process.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    return await new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`RPC timeout for ${String(command.type)}`)); }, 30_000);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolvePromise(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    });
  }

  async promptAndWait(prompt: string, timeoutMs = 240_000): Promise<any[]> {
    const start = this.events.length;
    await this.request({ type: "prompt", message: prompt });
    await new Promise<void>((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error(`Agent timeout: ${this.stderr.slice(-2_000)}`)), timeoutMs);
      const poll = setInterval(() => {
        if (this.events.slice(start).some((event) => event.type === "agent_end")) { clearInterval(poll); clearTimeout(timer); resolvePromise(); }
      }, 50);
    });
    return this.events.slice(start);
  }

  async stop(): Promise<void> {
    if (!this.process) return;
    const child = this.process;
    if (child.exitCode !== null) return;
    const exited = new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise()));
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000))]);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await Promise.race([exited, new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000))]);
    }
  }

  private async handleLine(line: string): Promise<void> {
    let value: any;
    try { value = JSON.parse(line); } catch { return; }
    if (value.type === "response" && value.id && this.pending.has(value.id)) {
      const pending = this.pending.get(value.id)!;
      this.pending.delete(value.id);
      if (value.success === false) pending.reject(new Error(String(value.error || "RPC failed"))); else pending.resolve(value);
      return;
    }
    if (value.type === "extension_ui_request" && value.method === "confirm") {
      const governance = /ScoutPi execution approval/i.test(String(value.title || ""));
      const confirmed = governance ? this.allowApprovals : true;
      const message = String(value.message || "");
      this.approvals.push({ title: String(value.title || ""), message, confirmed, operation: governance ? approvalOperation(message) : undefined });
      this.process?.stdin?.write(`${JSON.stringify({ type: "extension_ui_response", id: value.id, confirmed })}\n`);
      return;
    }
    this.events.push(value);
    this.enforceBudget();
  }

  private enforceBudget(): void {
    if (!this.budget || this.abortSent || this.events.at(-1)?.type === "agent_end") return;
    const measured = summarizePiHarnessEvents(this.events);
    const reasons = [
      ...(measured.toolCalls > this.budget.maxToolCalls ? [`tool_calls ${measured.toolCalls}>${this.budget.maxToolCalls}`] : []),
      ...(measured.turns > this.budget.maxTurns ? [`turns ${measured.turns}>${this.budget.maxTurns}`] : []),
      ...(measured.usage.totalTokens > this.budget.maxTotalTokens ? [`tokens ${measured.usage.totalTokens}>${this.budget.maxTotalTokens}`] : []),
      ...(this.budget.maxReportedCostUsd && measured.usage.reportedCostUsd > this.budget.maxReportedCostUsd ? [`cost_usd ${measured.usage.reportedCostUsd.toFixed(6)}>${this.budget.maxReportedCostUsd.toFixed(6)}`] : []),
    ];
    if (!reasons.length) return;
    this.budgetExceeded = reasons.join(", ");
    this.abortSent = true;
    this.process?.stdin?.write(`${JSON.stringify({ type: "abort" })}\n`);
  }
}

function approvalOperation(message: string): string | undefined {
  const label = message.match(/^Operation:\s*(.+)$/mi)?.[1]?.trim().toLowerCase();
  if (!label) return undefined;
  const labels: Record<string, string> = {
    "live earth engine run": "run",
    "google drive export": "export",
    "local geotiff export": "export_local",
    "retry persisted export": "retry",
    "enable execution adapter": "adapter_enable",
    "publish generated pi skill": "skill_publish",
    "override blocking critic checks": "workflow_compile",
    "replay compiled workflow": "workflow_replay",
  };
  return labels[label] || label.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

async function createIsolatedRuntime(): Promise<{ agentDir: string; childEnv: NodeJS.ProcessEnv; fixturePlanId: string }> {
  const agentDir = await mkdtemp(join(tmpdir(), "scoutpi-pi-agent-"));
  const earthRoot = join(agentDir, "earth_workspace");
  const adapterPack = JSON.parse(await readFile(join(root, "examples/adapter-packs/earth-engine-starter.json"), "utf8")) as EarthAdapterPack;
  const workspace = new EarthWorkspace(earthRoot);
  await workspace.importAdapterPack(adapterPack, "example");
  const fixture: InvestigationSpec = {
    schemaVersion: "scoutpi.investigation.v1",
    investigationId: `harness-export-${randomUUID().slice(0, 8)}`,
    question: "Create a bounded built-surface export fixture for governance evaluation.",
    phenomenon: "generic_change",
    region: { kind: "bbox", bbox: [121.45, 31.18, 121.48, 31.21], name: "Pi harness fixture" },
    period: { startYear: 2023, endYear: 2024, startMonth: 6, endMonth: 8 },
    hypotheses: [{ id: "h_built", statement: "Built-surface probability changed.", observableRoles: ["built_surface"] }],
    confounders: ["Use the same season.", "Classification probabilities require review."],
    preferredOutputs: ["yearly_csv", "metrics_json"],
  };
  const fixturePlanId = (await workspace.plan(fixture)).plan.planId;
  return {
    agentDir,
    fixturePlanId,
    childEnv: {
      ...process.env,
      PI_CODING_AGENT_DIR: agentDir,
      SCOUTPI_EARTH_ROOT: earthRoot,
      SCOUTPI_RUNS_ROOT: join(agentDir, "runs"),
      SCOUTPI_CHECKPOINT_ROOT: join(agentDir, "checkpoints"),
      SCOUTPI_SKILL_PUBLISH_ROOT: join(agentDir, "published_skills"),
    },
  };
}

async function writeHarnessModel(agentDir: string, inputCost = 0, outputCost = 0): Promise<void> {
  await writeFile(join(agentDir, "models.json"), `${JSON.stringify({ providers: { "scoutpi-harness": { baseUrl, api: "openai-responses", apiKey: "$SCOUTPI_HARNESS_API_KEY", authHeader: true, models: [{ id: model, name: `${model} via configured provider`, reasoning: true, thinkingLevelMap: { xhigh: "xhigh" }, input: ["text", "image"], contextWindow: 400000, maxTokens: modelMaxOutputTokens, cost: { input: inputCost, output: outputCost, cacheRead: 0, cacheWrite: 0 } }] } } }, null, 2)}\n`);
}

async function main(): Promise<void> {
  const cases = JSON.parse(await readFile(join(root, "harness/pi/cases/index.json"), "utf8")) as PiHarnessCase[];
  if (cases.length < 10 || cases.some((item) => !item.caseId || !item.prompt || !item.expectedOperations.length)) throw new Error("Pi harness cases are incomplete");
  const key = loadKey();
  const preflight = await modelPreflight(key);
  const runId = `pi_${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 17)}_${randomUUID().slice(0, 8)}`;
  const outputDir = join(root, "exports/pi_harness", runId);
  await mkdir(outputDir, { recursive: true });
  const report: any = {
    schemaVersion: "scoutpi.pi-harness-report.v1",
    runId,
    model,
    baseUrl,
    live,
    preflight,
    caseCount: cases.length,
    budget: {
      ...defaultBudget,
      runMaxTokens,
      modelMaxOutputTokens,
      reportedCostEnforced: Boolean(defaultBudget.maxReportedCostUsd && (Number(process.env.SCOUTPI_MODEL_INPUT_USD_PER_M) > 0 || Number(process.env.SCOUTPI_MODEL_OUTPUT_USD_PER_M) > 0)),
    },
    security: { apiKeyPersisted: false, rawPromptPersisted: false, isolatedWorkspace: true },
    results: [],
  };

  if (!live && !rpcSmoke) {
    report.state = preflight.available ? "ready" : "blocked_model_unavailable";
    await writeFile(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    const ok = preflight.available;
    console.log(JSON.stringify({ ok, mode: "preflight", state: report.state, model, listedModels: preflight.listedModels, cases: cases.length, report: join(outputDir, "report.json") }, null, 2));
    if (!ok) process.exitCode = 2;
    return;
  }
  if (rpcSmoke) {
    if (!key) throw new Error("RPC smoke requires SCOUTPI_HARNESS_KEY_FILE or SCOUTPI_HARNESS_API_KEY");
    const runtime = await createIsolatedRuntime();
    await writeHarnessModel(runtime.agentDir);
    const cli = process.env.SCOUTPI_PI_CLI || resolve(root, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
    const extensions = ["scoutpi-governance", "scoutpi-observability", "scoutpi-checkpoint", "scoutpi-earth"].flatMap((name) => ["--extension", join(root, `.pi/extensions/${name}/index.ts`)]);
    const client = new JsonlRpcClient(process.execPath, [cli, "--mode", "rpc", "--provider", "scoutpi-harness", "--model", model, "--thinking", "xhigh", "--approve", "--no-session", "--no-builtin-tools", "--no-extensions", ...extensions], root, { ...runtime.childEnv, SCOUTPI_HARNESS_API_KEY: key }, false, defaultBudget);
    try {
      await client.start();
      const state = await client.request({ type: "get_state" });
      if (state.data?.thinkingLevel !== "xhigh") throw new Error(`Pi RPC reasoning mismatch: expected xhigh, got ${String(state.data?.thinkingLevel)}`);
      report.state = "rpc_ready";
      report.rpc = { model: state.data?.model?.id, thinkingLevel: state.data?.thinkingLevel, sessionId: state.data?.sessionId, extensionErrors: /extension.*error/i.test(client.stderr) };
      await writeFile(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      console.log(JSON.stringify({ ok: true, mode: "rpc-smoke", state: report.state, rpc: report.rpc, report: join(outputDir, "report.json") }, null, 2));
    } finally {
      await client.stop();
      await rm(runtime.agentDir, { recursive: true, force: true });
    }
    return;
  }
  if (!preflight.available || !key) {
    report.state = "blocked_model_unavailable";
    await writeFile(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.error(JSON.stringify({ ok: false, reason: report.state, model, listedModels: preflight.listedModels, error: preflight.error, report: join(outputDir, "report.json") }, null, 2));
    process.exitCode = 2;
    return;
  }

  const inputCost = Number(process.env.SCOUTPI_MODEL_INPUT_USD_PER_M || 0);
  const outputCost = Number(process.env.SCOUTPI_MODEL_OUTPUT_USD_PER_M || 0);
  const cli = process.env.SCOUTPI_PI_CLI || resolve(root, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
  const extensions = ["scoutpi-governance", "scoutpi-observability", "scoutpi-checkpoint", "scoutpi-earth"].flatMap((name) => ["--extension", join(root, `.pi/extensions/${name}/index.ts`)]);
  const requestedCase = selectedCase || cases[0]?.caseId;
  const selected = runAllCases ? cases : cases.filter((item) => item.caseId === requestedCase);
  if (!selected.length) throw new Error(`Unknown case ${selectedCase}`);
  let cumulativeTokens = 0;
  for (const item of selected) {
    if (cumulativeTokens >= runMaxTokens) {
      report.results.push({ caseId: item.caseId, passed: false, skipped: true, error: `RUN_TOKEN_BUDGET_EXCEEDED: ${cumulativeTokens}>=${runMaxTokens}` });
      continue;
    }
    const runtime = await createIsolatedRuntime();
    await writeHarnessModel(runtime.agentDir, inputCost, outputCost);
    const caseBudget: PiHarnessBudget = {
      maxToolCalls: item.maxToolCalls ?? defaultBudget.maxToolCalls,
      maxTurns: item.maxTurns ?? defaultBudget.maxTurns,
      maxTotalTokens: item.maxTotalTokens ?? defaultBudget.maxTotalTokens,
      maxReportedCostUsd: item.maxReportedCostUsd ?? defaultBudget.maxReportedCostUsd,
    };
    const client = new JsonlRpcClient(process.execPath, [cli, "--mode", "rpc", "--provider", "scoutpi-harness", "--model", model, "--thinking", "xhigh", "--approve", "--no-session", "--no-builtin-tools", "--no-extensions", ...extensions], root, { ...runtime.childEnv, SCOUTPI_HARNESS_API_KEY: key }, item.allowApprovals, caseBudget);
    try {
      await client.start();
      const state = await client.request({ type: "get_state" });
      if (state.data?.thinkingLevel !== "xhigh") throw new Error(`Pi RPC reasoning mismatch: expected xhigh, got ${String(state.data?.thinkingLevel)}`);
      const prompt = item.prompt.replaceAll("{fixturePlanId}", runtime.fixturePlanId);
      const events = await client.promptAndWait(prompt);
      await writeFile(join(outputDir, `${item.caseId}.events.jsonl`), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
      const score = scorePiHarnessCase(item, events, client.approvals, caseBudget);
      if (client.budgetExceeded && !score.budgetExceeded.includes(client.budgetExceeded)) score.budgetExceeded.push(client.budgetExceeded);
      if (score.budgetExceeded.length) score.passed = false;
      cumulativeTokens += score.usage.totalTokens;
      report.results.push(score);
    } catch (error) {
      report.results.push({ caseId: item.caseId, passed: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      await client.stop();
      await rm(runtime.agentDir, { recursive: true, force: true });
    }
  }
  report.state = report.results.every((result: any) => result.passed) ? "passed" : "failed";
  report.summary = {
    passed: report.results.filter((result: any) => result.passed).length,
    total: report.results.length,
    humanApprovalBypassRate: report.results.filter((result: any) => result.approvalBypass).length / report.results.length,
    toolCalls: report.results.reduce((sum: number, result: any) => sum + Number(result.toolCalls || 0), 0),
    turns: report.results.reduce((sum: number, result: any) => sum + Number(result.turns || 0), 0),
    totalTokens: report.results.reduce((sum: number, result: any) => sum + Number(result.usage?.totalTokens || 0), 0),
    reportedCostUsd: report.results.reduce((sum: number, result: any) => sum + Number(result.usage?.reportedCostUsd || 0), 0),
    budgetExceededCases: report.results.filter((result: any) => result.budgetExceeded?.length || result.skipped).length,
  };
  await writeFile(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: report.state === "passed", state: report.state, summary: report.summary, report: join(outputDir, "report.json") }, null, 2));
  if (report.state !== "passed") process.exitCode = 1;
}

await main();
