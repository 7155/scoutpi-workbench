import { spawn } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ContextCandidateEnvelope } from "./index.ts";

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

export interface ContextProvider {
  readonly providerId: string;
  readonly displayName: string;
  readonly capabilities: ContextProviderCapability[];
  query(input: ContextProviderQuery, signal?: AbortSignal): Promise<ContextProviderResult>;
}

export interface ImeCoreContextProviderConfig {
  coreRoot: string;
  dbPath: string;
  project?: string;
  pythonCommand?: string;
  useUv?: boolean;
  scriptPath?: string;
}

type ProcessResponse = {
  ok?: boolean;
  error?: { code?: string; message?: string };
  envelope?: ContextCandidateEnvelope;
  diagnostics?: { latencyMs?: number; candidateCount?: number };
};

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
      if (code !== 0) return finish(Object.assign(new Error("context provider process failed"), { code: "CONTEXT_PROVIDER_PROCESS_FAILED", cause: stderr.slice(0, 500) }));
      try { finish(undefined, JSON.parse(stdout) as ProcessResponse); }
      catch { finish(Object.assign(new Error("context provider returned invalid JSON"), { code: "CONTEXT_PROVIDER_RESPONSE_INVALID" })); }
    });
    child.stdin.end(`${JSON.stringify(input)}\n`);
  });
}

export class ImeCoreContextProvider implements ContextProvider {
  readonly providerId = "wisdom-weasel-rag-ime";
  readonly displayName = "Wisdom Weasel RAG Core";
  readonly capabilities = ["query"] as ContextProviderCapability[];
  readonly coreRoot: string;
  readonly dbPath: string;
  readonly project: string;
  readonly pythonCommand: string;
  readonly useUv: boolean;
  readonly scriptPath: string;

  constructor(config: ImeCoreContextProviderConfig) {
    this.coreRoot = resolve(config.coreRoot);
    this.dbPath = resolve(config.dbPath);
    this.project = config.project || basename(process.cwd());
    this.pythonCommand = config.pythonCommand || "python3";
    this.useUv = config.useUv ?? true;
    this.scriptPath = resolve(config.scriptPath || defaultScript);
  }

  async query(input: ContextProviderQuery, signal?: AbortSignal): Promise<ContextProviderResult> {
    const started = Date.now();
    const base = { providerId: this.providerId, displayName: this.displayName, transport: "process" as const, capabilities: this.capabilities, checkedAt: new Date().toISOString() };
    try {
      await this.assertConfigured();
      const { command, args } = await this.launcher();
      const response = await runJsonProcess(command, args, this.coreRoot, {
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
      if (!response.ok || !response.envelope) throw Object.assign(new Error("context provider rejected the query"), { code: response.error?.code || "CONTEXT_PROVIDER_REJECTED" });
      return {
        envelope: response.envelope,
        status: { ...base, state: "ready", latencyMs: Number(response.diagnostics?.latencyMs) || Date.now() - started, itemCount: response.envelope.items.length },
      };
    } catch (error) {
      const code = safeErrorCode(error);
      const unavailable = code === "ENOENT" || code === "CONTEXT_PROVIDER_NOT_CONFIGURED" || code === "CONTEXT_PROVIDER_SPAWN_FAILED";
      return { status: { ...base, state: unavailable ? "unavailable" : "failed", latencyMs: Date.now() - started, itemCount: 0, errorCode: code } };
    }
  }

  private async assertConfigured(): Promise<void> {
    try {
      const [rootInfo, dbInfo] = await Promise.all([stat(this.coreRoot), stat(this.dbPath)]);
      if (!rootInfo.isDirectory() || !dbInfo.isFile()) throw new Error("invalid provider path");
      await Promise.all([
        access(join(this.coreRoot, "rag_ime", "local_sqlite_core.py")),
        access(join(this.coreRoot, "rag_ime", "memory_models.py")),
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
  })];
}
