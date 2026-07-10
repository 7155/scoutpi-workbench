import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scorePiHarnessCase, type PiHarnessCase } from "./scorers.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = new Set(process.argv.slice(2));
const live = args.has("--live");
const rpcSmoke = args.has("--rpc-smoke");
const selectedCase = process.argv.find((value) => value.startsWith("--case="))?.slice("--case=".length);
const model = process.env.SCOUTPI_PI_MODEL || "gpt-5.6";
const baseUrl = (process.env.SCOUTPI_PI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

function loadKey(): string | undefined {
  if (process.env.SCOUTPI_HARNESS_API_KEY) return process.env.SCOUTPI_HARNESS_API_KEY;
  const path = process.env.SCOUTPI_HARNESS_KEY_FILE;
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
  readonly approvals: Array<{ title: string; message: string; confirmed: boolean }> = [];
  stderr = "";
  private readonly command: string;
  private readonly commandArgs: string[];
  private readonly cwd: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly allowApprovals: boolean;

  constructor(command: string, commandArgs: string[], cwd: string, env: NodeJS.ProcessEnv, allowApprovals: boolean) {
    this.command = command;
    this.commandArgs = commandArgs;
    this.cwd = cwd;
    this.env = env;
    this.allowApprovals = allowApprovals;
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
    this.process.kill("SIGTERM");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
    if (this.process.exitCode === null) this.process.kill("SIGKILL");
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
      this.approvals.push({ title: String(value.title || ""), message: String(value.message || ""), confirmed });
      this.process?.stdin?.write(`${JSON.stringify({ type: "extension_ui_response", id: value.id, confirmed })}\n`);
      return;
    }
    this.events.push(value);
  }
}

async function main(): Promise<void> {
  const cases = JSON.parse(await readFile(join(root, "harness/pi/cases/index.json"), "utf8")) as PiHarnessCase[];
  if (cases.length < 10 || cases.some((item) => !item.caseId || !item.prompt || !item.expectedOperations.length)) throw new Error("Pi harness cases are incomplete");
  const key = loadKey();
  const preflight = await modelPreflight(key);
  const runId = `pi_${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 17)}_${randomUUID().slice(0, 8)}`;
  const outputDir = join(root, "exports/pi_harness", runId);
  await mkdir(outputDir, { recursive: true });
  const report: any = { schemaVersion: "scoutpi.pi-harness-report.v1", runId, model, baseUrl, live, preflight, caseCount: cases.length, results: [] };

  if (!live && !rpcSmoke) {
    report.state = preflight.available ? "ready" : "blocked_model_unavailable";
    await writeFile(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, mode: "preflight", state: report.state, model, listedModels: preflight.listedModels, cases: cases.length, report: join(outputDir, "report.json") }, null, 2));
    return;
  }
  if (rpcSmoke) {
    if (!key) throw new Error("RPC smoke requires SCOUTPI_HARNESS_KEY_FILE or SCOUTPI_HARNESS_API_KEY");
    const agentDir = await mkdtemp(join(tmpdir(), "scoutpi-pi-agent-"));
    await writeFile(join(agentDir, "models.json"), `${JSON.stringify({ providers: { "scoutpi-harness": { baseUrl, api: "openai-responses", apiKey: "$SCOUTPI_HARNESS_API_KEY", authHeader: true, models: [{ id: model, name: `${model} via configured provider`, reasoning: true, thinkingLevelMap: { xhigh: "xhigh" }, input: ["text", "image"], contextWindow: 400000, maxTokens: 128000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }, null, 2)}\n`);
    const cli = process.env.SCOUTPI_PI_CLI || resolve(root, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
    const extensions = ["scoutpi-governance", "scoutpi-observability", "scoutpi-earth"].flatMap((name) => ["--extension", join(root, `.pi/extensions/${name}/index.ts`)]);
    const client = new JsonlRpcClient(process.execPath, [cli, "--mode", "rpc", "--provider", "scoutpi-harness", "--model", model, "--thinking", "xhigh", "--approve", "--no-session", "--no-builtin-tools", "--no-extensions", ...extensions], root, { ...process.env, PI_CODING_AGENT_DIR: agentDir, SCOUTPI_HARNESS_API_KEY: key }, false);
    try {
      await client.start();
      const state = await client.request({ type: "get_state" });
      if (state.data?.thinkingLevel !== "xhigh") throw new Error(`Pi RPC reasoning mismatch: expected xhigh, got ${String(state.data?.thinkingLevel)}`);
      report.state = "rpc_ready";
      report.rpc = { model: state.data?.model?.id, thinkingLevel: state.data?.thinkingLevel, sessionId: state.data?.sessionId, extensionErrors: /extension.*error/i.test(client.stderr) };
      await writeFile(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      console.log(JSON.stringify({ ok: true, mode: "rpc-smoke", state: report.state, rpc: report.rpc, report: join(outputDir, "report.json") }, null, 2));
    } finally { await client.stop(); }
    return;
  }
  if (!preflight.available || !key) {
    report.state = "blocked_model_unavailable";
    await writeFile(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.error(JSON.stringify({ ok: false, reason: report.state, model, listedModels: preflight.listedModels, error: preflight.error, report: join(outputDir, "report.json") }, null, 2));
    process.exitCode = 2;
    return;
  }

  const agentDir = await mkdtemp(join(tmpdir(), "scoutpi-pi-agent-"));
  const inputCost = Number(process.env.SCOUTPI_MODEL_INPUT_USD_PER_M || 0);
  const outputCost = Number(process.env.SCOUTPI_MODEL_OUTPUT_USD_PER_M || 0);
  await writeFile(join(agentDir, "models.json"), `${JSON.stringify({ providers: { "scoutpi-harness": { baseUrl, api: "openai-responses", apiKey: "$SCOUTPI_HARNESS_API_KEY", authHeader: true, models: [{ id: model, name: `${model} via configured provider`, reasoning: true, thinkingLevelMap: { xhigh: "xhigh" }, input: ["text", "image"], contextWindow: 400000, maxTokens: 128000, cost: { input: inputCost, output: outputCost, cacheRead: 0, cacheWrite: 0 } }] } } }, null, 2)}\n`);
  const cli = process.env.SCOUTPI_PI_CLI || resolve(root, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
  const extensions = ["scoutpi-governance", "scoutpi-observability", "scoutpi-earth"].flatMap((name) => ["--extension", join(root, `.pi/extensions/${name}/index.ts`)]);
  const selected = selectedCase ? cases.filter((item) => item.caseId === selectedCase) : cases;
  if (!selected.length) throw new Error(`Unknown case ${selectedCase}`);
  for (const item of selected) {
    const client = new JsonlRpcClient(process.execPath, [cli, "--mode", "rpc", "--provider", "scoutpi-harness", "--model", model, "--thinking", "xhigh", "--approve", "--no-session", "--no-builtin-tools", "--no-extensions", ...extensions], root, { ...process.env, PI_CODING_AGENT_DIR: agentDir, SCOUTPI_HARNESS_API_KEY: key }, item.allowApprovals);
    try {
      await client.start();
      const state = await client.request({ type: "get_state" });
      if (state.data?.thinkingLevel !== "xhigh") throw new Error(`Pi RPC reasoning mismatch: expected xhigh, got ${String(state.data?.thinkingLevel)}`);
      const events = await client.promptAndWait(item.prompt);
      await writeFile(join(outputDir, `${item.caseId}.events.jsonl`), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
      report.results.push(scorePiHarnessCase(item, events, client.approvals));
    } catch (error) {
      report.results.push({ caseId: item.caseId, passed: false, error: error instanceof Error ? error.message : String(error) });
    } finally { await client.stop(); }
  }
  report.state = report.results.every((result: any) => result.passed) ? "passed" : "failed";
  report.summary = {
    passed: report.results.filter((result: any) => result.passed).length,
    total: report.results.length,
    humanApprovalBypassRate: report.results.filter((result: any) => result.approvalBypass).length / report.results.length,
  };
  await writeFile(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: report.state === "passed", state: report.state, summary: report.summary, report: join(outputDir, "report.json") }, null, 2));
  if (report.state !== "passed") process.exitCode = 1;
}

await main();
