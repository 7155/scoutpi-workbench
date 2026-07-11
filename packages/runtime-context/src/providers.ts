import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ContextCandidateEnvelope, ContextWriteback, ContextWritebackDelivery, ContextWritebackProviderReceipt } from "./index.ts";

export type ContextProviderCapability = "query" | "writeback";
export type ContextProviderState = "ready" | "unavailable" | "failed";

export interface ContextProviderStatus {
  providerId: string;
  displayName: string;
  transport: "process" | "http" | "file";
  state: ContextProviderState;
  capabilities: ContextProviderCapability[];
  checkedAt: string;
  latencyMs: number;
  sourceLatencyMs?: number;
  processMode?: "persistent" | "one_shot";
  workerReused?: boolean;
  itemCount: number;
  errorCode?: string;
}

export interface ContextProviderQuery {
  sessionId: string;
  query: string;
  project: string;
  maxItems: number;
  timeoutMs: number;
}

export interface ContextProviderResult {
  envelope?: ContextCandidateEnvelope;
  status: ContextProviderStatus;
}

export interface ContextProviderWritebackRequest {
  writeback: ContextWriteback;
  delivery: ContextWritebackDelivery;
  project: string;
  timeoutMs: number;
}

export interface ContextProviderWritebackResult {
  receipt?: ContextWritebackProviderReceipt;
  errorCode?: string;
}

export interface ContextProvider {
  readonly providerId: string;
  readonly displayName: string;
  readonly capabilities: ContextProviderCapability[];
  query(input: ContextProviderQuery, signal?: AbortSignal): Promise<ContextProviderResult>;
  deliverWriteback?(input: ContextProviderWritebackRequest, signal?: AbortSignal): Promise<ContextProviderWritebackResult>;
  close?(): Promise<void>;
}

export interface ImeCoreContextProviderConfig {
  coreRoot: string;
  dbPath: string;
  project?: string;
  pythonCommand?: string;
  useUv?: boolean;
  scriptPath?: string;
  writebackEnabled?: boolean;
  persistent?: boolean;
}

type ProcessResponse = {
  ok?: boolean;
  error?: { code?: string; message?: string };
  envelope?: ContextCandidateEnvelope;
  receipt?: ContextWritebackProviderReceipt;
  diagnostics?: { latencyMs?: number; candidateCount?: number };
};

type ProcessInvocation = { response: ProcessResponse; workerReused: boolean };

const defaultScript = fileURLToPath(new URL("../python/ime_core_context_provider.py", import.meta.url));

function safeErrorCode(value: unknown): string {
  const code = typeof value === "object" && value && "code" in value ? String((value as { code?: unknown }).code || "") : "";
  return /^[A-Z0-9_:-]{1,80}$/.test(code) ? code : "CONTEXT_PROVIDER_FAILED";
}

async function runJsonProcess(command: string, args: string[], cwd: string, input: unknown, timeoutMs: number, signal?: AbortSignal): Promise<ProcessResponse> {
  return await new Promise<ProcessResponse>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error?: Error, value?: ProcessResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) rejectPromise(error); else resolvePromise(value || {});
    };
    const abort = () => {
      child.kill("SIGTERM");
      finish(Object.assign(new Error("context provider cancelled"), { code: "CONTEXT_PROVIDER_CANCELLED" }));
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(Object.assign(new Error("context provider timed out"), { code: "CONTEXT_PROVIDER_TIMEOUT" }));
    }, timeoutMs);
    timer.unref();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (Buffer.byteLength(stdout) > 2 * 1024 * 1024) {
        child.kill("SIGTERM");
        finish(Object.assign(new Error("context provider output exceeded 2 MB"), { code: "CONTEXT_PROVIDER_OUTPUT_TOO_LARGE" }));
      }
    });
    child.stderr.on("data", (chunk) => { if (Buffer.byteLength(stderr) < 16_384) stderr += String(chunk); });
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => finish(Object.assign(error, { code: "CONTEXT_PROVIDER_SPAWN_FAILED" })));
    child.on("close", (code) => {
      if (settled) return;
      try {
        const response = JSON.parse(stdout) as ProcessResponse;
        if (code !== 0 && response.ok === undefined) throw new Error("missing provider status");
        finish(undefined, response);
      } catch {
        finish(Object.assign(new Error("context provider returned invalid JSON"), { code: code === 0 ? "CONTEXT_PROVIDER_RESPONSE_INVALID" : "CONTEXT_PROVIDER_PROCESS_FAILED", cause: stderr.slice(0, 500) }));
      }
    });
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
}

class PersistentJsonProcess {
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd: string;
  private readonly idleMs: number;
  private child?: ChildProcessWithoutNullStreams;
  private stdout = "";
  private stderr = "";
  private pending?: { resolve: (value: ProcessInvocation) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; abort?: () => void; signal?: AbortSignal; reused: boolean };
  private queue: Promise<void> = Promise.resolve();
  private idleTimer?: ReturnType<typeof setTimeout>;

  constructor(command: string, args: string[], cwd: string, idleMs = 5 * 60_000) {
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.idleMs = idleMs;
  }

  request(input: unknown, timeoutMs: number, signal?: AbortSignal): Promise<ProcessInvocation> {
    const operation = this.queue.then(() => this.requestNow(input, timeoutMs, signal));
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async close(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    const child = this.child;
    if (!child) return;
    this.child = undefined;
    this.rejectPending(Object.assign(new Error("context provider worker closed"), { code: "CONTEXT_PROVIDER_WORKER_CLOSED" }));
    child.kill("SIGTERM");
    await new Promise<void>((resolveClose) => {
      if (child.exitCode !== null) return resolveClose();
      const timer = setTimeout(resolveClose, 500);
      timer.unref();
      child.once("close", () => { clearTimeout(timer); resolveClose(); });
    });
  }

  private requestNow(input: unknown, timeoutMs: number, signal?: AbortSignal): Promise<ProcessInvocation> {
    if (signal?.aborted) return Promise.reject(Object.assign(new Error("context provider cancelled"), { code: "CONTEXT_PROVIDER_CANCELLED" }));
    const payload = `${JSON.stringify(input)}\n`;
    if (Buffer.byteLength(payload) > 256 * 1024) return Promise.reject(Object.assign(new Error("context provider request exceeded 256 KB"), { code: "CONTEXT_PROVIDER_REQUEST_TOO_LARGE" }));
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    const reused = Boolean(this.child && this.child.exitCode === null && !this.child.killed);
    const child = reused ? this.child! : this.start();
    return new Promise<ProcessInvocation>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => this.terminate(Object.assign(new Error("context provider timed out"), { code: "CONTEXT_PROVIDER_TIMEOUT" })), timeoutMs);
      timer.unref();
      const abort = signal ? () => this.terminate(Object.assign(new Error("context provider cancelled"), { code: "CONTEXT_PROVIDER_CANCELLED" })) : undefined;
      if (abort) signal!.addEventListener("abort", abort, { once: true });
      this.pending = { resolve: resolvePromise, reject: rejectPromise, timer, abort, signal, reused };
      child.stdin.write(payload, (error) => { if (error) this.terminate(Object.assign(error, { code: "CONTEXT_PROVIDER_PROCESS_FAILED" })); });
    });
  }

  private start(): ChildProcessWithoutNullStreams {
    this.stdout = "";
    this.stderr = "";
    const child = spawn(this.command, [...this.args, "--serve"], { cwd: this.cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    child.stdout.on("data", (chunk) => this.handleStdout(String(chunk)));
    child.stderr.on("data", (chunk) => { if (Buffer.byteLength(this.stderr) < 16_384) this.stderr = `${this.stderr}${String(chunk)}`.slice(0, 16_384); });
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => this.terminate(Object.assign(error, { code: "CONTEXT_PROVIDER_SPAWN_FAILED" })));
    child.on("close", () => {
      if (this.child !== child) return;
      this.child = undefined;
      this.rejectPending(Object.assign(new Error("context provider worker exited"), { code: "CONTEXT_PROVIDER_PROCESS_FAILED" }));
    });
    return child;
  }

  private handleStdout(chunk: string): void {
    this.stdout += chunk;
    if (Buffer.byteLength(this.stdout) > 2 * 1024 * 1024) return this.terminate(Object.assign(new Error("context provider output exceeded 2 MB"), { code: "CONTEXT_PROVIDER_OUTPUT_TOO_LARGE" }));
    const newline = this.stdout.indexOf("\n");
    if (newline < 0) return;
    const line = this.stdout.slice(0, newline).trim();
    this.stdout = this.stdout.slice(newline + 1);
    if (!this.pending || !line) return this.terminate(Object.assign(new Error("context provider protocol desynchronized"), { code: "CONTEXT_PROVIDER_RESPONSE_INVALID" }));
    try {
      const response = JSON.parse(line) as ProcessResponse;
      const pending = this.takePending();
      pending?.resolve({ response, workerReused: pending.reused });
      this.scheduleIdle();
    } catch {
      this.terminate(Object.assign(new Error("context provider returned invalid JSON"), { code: "CONTEXT_PROVIDER_RESPONSE_INVALID" }));
    }
  }

  private takePending() {
    const pending = this.pending;
    if (!pending) return undefined;
    this.pending = undefined;
    clearTimeout(pending.timer);
    if (pending.abort) pending.signal?.removeEventListener("abort", pending.abort);
    return pending;
  }

  private rejectPending(error: Error): void {
    this.takePending()?.reject(error);
  }

  private terminate(error: Error): void {
    const child = this.child;
    this.child = undefined;
    this.stdout = "";
    this.rejectPending(error);
    child?.kill("SIGTERM");
  }

  private scheduleIdle(): void {
    if (!this.child || this.pending) return;
    this.idleTimer = setTimeout(() => { if (!this.pending) void this.close(); }, this.idleMs);
    this.idleTimer.unref();
  }
}

export class ImeCoreContextProvider implements ContextProvider {
  readonly providerId = "wisdom-weasel-rag-ime";
  readonly displayName = "Wisdom Weasel RAG Core";
  readonly capabilities: ContextProviderCapability[];
  readonly coreRoot: string;
  readonly dbPath: string;
  readonly project: string;
  readonly pythonCommand: string;
  readonly useUv: boolean;
  readonly scriptPath: string;
  readonly writebackEnabled: boolean;
  readonly persistent: boolean;
  private worker?: PersistentJsonProcess;
  private launcherPromise?: Promise<{ command: string; args: string[] }>;

  constructor(config: ImeCoreContextProviderConfig) {
    this.coreRoot = resolve(config.coreRoot);
    this.dbPath = resolve(config.dbPath);
    this.project = config.project || basename(process.cwd());
    this.pythonCommand = config.pythonCommand || "python3";
    this.useUv = config.useUv ?? true;
    this.scriptPath = resolve(config.scriptPath || defaultScript);
    this.writebackEnabled = config.writebackEnabled === true;
    this.persistent = config.persistent !== false;
    this.capabilities = this.writebackEnabled ? ["query", "writeback"] : ["query"];
  }

  async query(input: ContextProviderQuery, signal?: AbortSignal): Promise<ContextProviderResult> {
    const started = Date.now();
    const base = { providerId: this.providerId, displayName: this.displayName, transport: "process" as const, capabilities: this.capabilities, checkedAt: new Date().toISOString(), processMode: this.persistent ? "persistent" as const : "one_shot" as const };
    try {
      await this.assertConfigured();
      const invocation = await this.invoke({
        schemaVersion: "scoutpi.context-provider.request.v1",
        op: "query",
        coreRoot: this.coreRoot,
        dbPath: this.dbPath,
        query: input.query,
        project: input.project || this.project,
        app: "ScoutPi",
        topK: Math.max(1, Math.min(16, Math.floor(input.maxItems))),
        sourceBudgetMs: Math.max(20, Math.min(2_000, Math.floor(input.timeoutMs * 0.7))),
      }, input.timeoutMs, signal);
      const response = invocation.response;
      if (!response.ok || !response.envelope) throw Object.assign(new Error("context provider rejected the query"), { code: response.error?.code || "CONTEXT_PROVIDER_REJECTED" });
      return {
        envelope: response.envelope,
        status: { ...base, state: "ready", latencyMs: Date.now() - started, sourceLatencyMs: Number(response.diagnostics?.latencyMs) || undefined, workerReused: invocation.workerReused, itemCount: response.envelope.items.length },
      };
    } catch (error) {
      const code = safeErrorCode(error);
      const unavailable = code === "ENOENT" || code === "CONTEXT_PROVIDER_NOT_CONFIGURED" || code === "CONTEXT_PROVIDER_SPAWN_FAILED";
      return { status: { ...base, state: unavailable ? "unavailable" : "failed", latencyMs: Date.now() - started, workerReused: false, itemCount: 0, errorCode: code } };
    }
  }

  async deliverWriteback(input: ContextProviderWritebackRequest, signal?: AbortSignal): Promise<ContextProviderWritebackResult> {
    if (!this.writebackEnabled) return { errorCode: "CONTEXT_PROVIDER_WRITEBACK_DISABLED" };
    try {
      await this.assertConfigured(true);
      const invocation = await this.invoke({
        schemaVersion: "scoutpi.context-provider.request.v1",
        op: "writeback",
        coreRoot: this.coreRoot,
        dbPath: this.dbPath,
        project: input.project || this.project,
        delivery: input.delivery,
        writeback: input.writeback,
      }, Math.max(300, Math.min(10_000, input.timeoutMs)), signal);
      const response = invocation.response;
      if (!response.ok || !response.receipt) return { errorCode: safeErrorCode(response.error || { code: "CONTEXT_PROVIDER_WRITEBACK_REJECTED" }) };
      if (response.receipt.providerId !== this.providerId || response.receipt.deliveryId !== input.delivery.deliveryId) return { errorCode: "CONTEXT_PROVIDER_RECEIPT_MISMATCH" };
      return { receipt: response.receipt };
    } catch (error) {
      return { errorCode: safeErrorCode(error) };
    }
  }

  async close(): Promise<void> {
    await this.worker?.close();
    this.worker = undefined;
  }

  private async assertConfigured(requireWriteback = false): Promise<void> {
    try {
      const [rootInfo, dbInfo] = await Promise.all([stat(this.coreRoot), stat(this.dbPath)]);
      if (!rootInfo.isDirectory() || !dbInfo.isFile()) throw new Error("invalid provider path");
      await Promise.all([
        access(join(this.coreRoot, "rag_ime", "local_sqlite_core.py")),
        access(join(this.coreRoot, "rag_ime", "memory_models.py")),
        ...(requireWriteback ? [access(join(this.coreRoot, "rag_ime", "adapter.py"))] : []),
        access(this.scriptPath),
      ]);
    } catch (error) {
      throw Object.assign(new Error("Wisdom Weasel RAG Core is not configured"), { code: "CONTEXT_PROVIDER_NOT_CONFIGURED", cause: error });
    }
  }

  private async launcher(): Promise<{ command: string; args: string[] }> {
    if (!this.useUv) return { command: this.pythonCommand, args: [this.scriptPath] };
    const candidates = process.platform === "win32"
      ? [join(this.coreRoot, ".venv", "Scripts", "python.exe")]
      : [join(this.coreRoot, ".venv", "bin", "python3"), join(this.coreRoot, ".venv", "bin", "python")];
    for (const command of candidates) {
      try { await access(command); return { command, args: [this.scriptPath] }; }
      catch {}
    }
    return { command: "uv", args: ["run", "--project", this.coreRoot, "python", this.scriptPath] };
  }

  private async invoke(input: unknown, timeoutMs: number, signal?: AbortSignal): Promise<ProcessInvocation> {
    this.launcherPromise ||= this.launcher();
    const { command, args } = await this.launcherPromise;
    if (!this.persistent) return { response: await runJsonProcess(command, args, this.coreRoot, input, timeoutMs, signal), workerReused: false };
    this.worker ||= new PersistentJsonProcess(command, args, this.coreRoot);
    return await this.worker.request(input, timeoutMs, signal);
  }
}

export function configuredContextProviders(): ContextProvider[] {
  const root = process.env.SCOUTPI_IME_CORE_ROOT?.trim();
  if (!root) return [];
  const dbPath = process.env.SCOUTPI_IME_CORE_DB?.trim() || join(homedir(), "Library", "Application Support", "RagIme", "rag-ime.sqlite");
  return [new ImeCoreContextProvider({
    coreRoot: root,
    dbPath,
    project: process.env.SCOUTPI_IME_CONTEXT_PROJECT?.trim(),
    pythonCommand: process.env.SCOUTPI_IME_CONTEXT_PYTHON?.trim(),
    useUv: process.env.SCOUTPI_IME_CONTEXT_USE_UV !== "0",
    writebackEnabled: process.env.SCOUTPI_IME_CONTEXT_WRITEBACK === "1",
    persistent: process.env.SCOUTPI_IME_CONTEXT_PERSISTENT !== "0",
  })];
}
