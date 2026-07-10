import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

export type AgentCheckpointState = "idle" | "running" | "tool_running" | "paused" | "settled" | "failed";
export type AgentCheckpointReferenceKind = "investigation" | "plan" | "job" | "workflow" | "replay" | "recipe" | "approval" | "artifact";

export interface AgentCheckpointReference {
  kind: AgentCheckpointReferenceKind;
  id: string;
  source: string;
}

export interface AgentCheckpointActivity {
  toolCallId: string;
  toolName: string;
  operation?: string;
  targetId?: string;
  startedAt: string;
  finishedAt?: string;
  status?: "ok" | "failed" | "interrupted";
}

export interface AgentCheckpoint {
  schemaVersion: "scoutpi.agent.checkpoint.v1";
  checkpointId: string;
  sessionId: string;
  revision: number;
  state: AgentCheckpointState;
  reason?: string;
  createdAt: string;
  updatedAt: string;
  resumeCount: number;
  turnIndex?: number;
  active?: AgentCheckpointActivity;
  lastCompleted?: AgentCheckpointActivity;
  references: AgentCheckpointReference[];
  runtime: {
    model?: string;
    contextTokens?: number;
    contextWindow?: number;
    contextPercent?: number;
  };
  compaction: {
    count: number;
    lastReason?: "manual" | "threshold" | "overflow";
    lastAt?: string;
  };
  recovery: {
    recoverable: boolean;
    nextAction?: string;
    injectedAt?: string;
  };
  checksum: string;
}

function safeSessionId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(value)) throw Object.assign(new Error("CHECKPOINT_SESSION_ID_INVALID"), { code: "CHECKPOINT_SESSION_ID_INVALID" });
  return value;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code || "") : undefined;
}

function checkpointChecksum(value: Omit<AgentCheckpoint, "checksum">): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function seal(value: Omit<AgentCheckpoint, "checksum">): AgentCheckpoint {
  return { ...value, checksum: checkpointChecksum(value) };
}

function verify(value: AgentCheckpoint): AgentCheckpoint {
  if (value.schemaVersion !== "scoutpi.agent.checkpoint.v1") throw Object.assign(new Error("CHECKPOINT_SCHEMA_INVALID"), { code: "CHECKPOINT_SCHEMA_INVALID" });
  const { checksum, ...unsigned } = value;
  if (checkpointChecksum(unsigned) !== checksum) throw Object.assign(new Error("CHECKPOINT_INTEGRITY_FAILED"), { code: "CHECKPOINT_INTEGRITY_FAILED" });
  return value;
}

function compactId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim().slice(0, 240);
  return result || undefined;
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function addReference(rows: AgentCheckpointReference[], kind: AgentCheckpointReferenceKind, value: unknown, source: string): void {
  const id = compactId(value);
  if (!id) return;
  const normalized = kind === "artifact" ? basename(id) : id;
  if (!rows.some((row) => row.kind === kind && row.id === normalized)) rows.push({ kind, id: normalized, source });
}

export function checkpointReferencesFromTool(toolName: string, input: unknown, details?: unknown): AgentCheckpointReference[] {
  const rows: AgentCheckpointReference[] = [];
  if (toolName !== "earth_workspace" && toolName !== "python_analysis" && toolName !== "earth_story") return rows;
  const request = objectOf(input);
  const options = objectOf(request.options);
  const payload = objectOf(request.payload);
  const result = objectOf(details);
  const op = compactId(request.op);
  const target = request.id;

  addReference(rows, "investigation", payload.investigationId, "tool.input.payload");
  addReference(rows, "investigation", result.investigationId, "tool.result");
  addReference(rows, "plan", options.planId, "tool.input.options");
  addReference(rows, "plan", result.planId, "tool.result");
  addReference(rows, "job", options.jobId, "tool.input.options");
  addReference(rows, "job", result.jobId, "tool.result");
  addReference(rows, "workflow", options.workflowId, "tool.input.options");
  addReference(rows, "workflow", result.workflowId, "tool.result");
  addReference(rows, "replay", options.replayId, "tool.input.options");
  addReference(rows, "replay", result.replayId, "tool.result");
  addReference(rows, "recipe", result.recipeId, "tool.result");
  addReference(rows, "approval", options.approvalId, "tool.input.options");
  addReference(rows, "approval", result.approvalId, "tool.result");
  addReference(rows, "artifact", result.artifactPath, "tool.result");

  if (["preview", "visualize", "run", "export", "export_local"].includes(op || "")) addReference(rows, "plan", target, "tool.input.id");
  if (["status", "cancel", "retry", "artifacts"].includes(op || "")) addReference(rows, "job", target, "tool.input.id");
  if (["workflow_replay"].includes(op || "")) addReference(rows, "workflow", target, "tool.input.id");
  if (["workflow_status"].includes(op || "")) addReference(rows, "replay", target, "tool.input.id");
  if (["load_recipe"].includes(op || "")) addReference(rows, "recipe", target, "tool.input.id");
  if (toolName === "python_analysis") addReference(rows, "artifact", request.path, "tool.input.path");
  return rows;
}

function mergeReferences(current: AgentCheckpointReference[], next: AgentCheckpointReference[]): AgentCheckpointReference[] {
  const result = [...current];
  for (const row of next) if (!result.some((item) => item.kind === row.kind && item.id === row.id)) result.push(row);
  return result.slice(-100);
}

export function isRecoverableCheckpoint(value: AgentCheckpoint): boolean {
  return value.recovery.recoverable || ["running", "tool_running", "paused", "failed"].includes(value.state);
}

export function renderCheckpointResume(value: AgentCheckpoint): string {
  const references = value.references.slice(-16).map((row) => `${row.kind}=${row.id}`).join(", ") || "none";
  const interrupted = value.active
    ? `The previous ${value.active.toolName}${value.active.operation ? `:${value.active.operation}` : ""} call (${value.active.toolCallId}) may have been interrupted; do not assume it completed.`
    : "No in-flight tool call was recorded.";
  return [
    "ScoutPi durable checkpoint (runtime-authored, not page or user content).",
    `session=${value.sessionId} revision=${value.revision} previous_state=${value.state} reason=${value.reason || "runtime_restart"}`,
    interrupted,
    `durable_refs: ${references}`,
    value.recovery.nextAction || "Re-read persisted status before repeating any state-changing operation.",
  ].join("\n").slice(0, 1_800);
}

export class AgentCheckpointStore {
  readonly root: string;
  private readonly queues = new Map<string, Promise<void>>();

  constructor(root = process.env.SCOUTPI_CHECKPOINT_ROOT ?? ".scoutpi/checkpoints") {
    this.root = resolve(root);
  }

  async init(): Promise<void> {
    await Promise.all([mkdir(this.root, { recursive: true }), mkdir(join(this.root, "journal"), { recursive: true })]);
  }

  async open(sessionId: string, runtime: AgentCheckpoint["runtime"] = {}): Promise<AgentCheckpoint> {
    safeSessionId(sessionId);
    await this.init();
    try { return await this.get(sessionId); }
    catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      const at = new Date().toISOString();
      const value = seal({
        schemaVersion: "scoutpi.agent.checkpoint.v1",
        checkpointId: `checkpoint_${randomUUID()}`,
        sessionId,
        revision: 1,
        state: "idle",
        createdAt: at,
        updatedAt: at,
        resumeCount: 0,
        references: [],
        runtime,
        compaction: { count: 0 },
        recovery: { recoverable: false },
      });
      await this.write(value);
      return value;
    }
  }

  async get(sessionId: string): Promise<AgentCheckpoint> {
    safeSessionId(sessionId);
    return verify(JSON.parse(await readFile(this.path(sessionId), "utf8")) as AgentCheckpoint);
  }

  async list(limit = 100): Promise<AgentCheckpoint[]> {
    await this.init();
    const rows: AgentCheckpoint[] = [];
    const names = (await readdir(this.root)).filter((name) => name.endsWith(".json")).sort().reverse();
    for (const name of names.slice(0, Math.max(1, Math.min(1_000, limit)))) {
      try { rows.push(verify(JSON.parse(await readFile(join(this.root, name), "utf8")) as AgentCheckpoint)); } catch {}
    }
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async transition(sessionId: string, update: (value: AgentCheckpoint) => void): Promise<AgentCheckpoint> {
    safeSessionId(sessionId);
    let result: AgentCheckpoint | undefined;
    const previous = this.queues.get(sessionId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const current = await this.open(sessionId);
      update(current);
      current.revision += 1;
      current.updatedAt = new Date().toISOString();
      const { checksum: _checksum, ...unsigned } = current;
      result = seal(unsigned);
      await this.write(result);
    });
    this.queues.set(sessionId, next);
    try { await next; }
    finally { if (this.queues.get(sessionId) === next) this.queues.delete(sessionId); }
    return result!;
  }

  async prepareResume(sessionId: string, reason = "runtime_restart"): Promise<AgentCheckpoint | undefined> {
    let current: AgentCheckpoint;
    try { current = await this.get(sessionId); } catch (error) { if (errorCode(error) === "ENOENT") return undefined; throw error; }
    if (!isRecoverableCheckpoint(current)) return undefined;
    return await this.transition(sessionId, (value) => {
      if (value.active && !value.active.finishedAt) value.active.status = "interrupted";
      value.state = "paused";
      value.reason = reason;
      value.resumeCount += 1;
      value.recovery = {
        recoverable: true,
        nextAction: value.active
          ? "Query persisted job or workflow status before retrying; never repeat the interrupted state-changing operation blindly."
          : "Resume from durable references and verify current runtime state before continuing.",
      };
    });
  }

  async markResumeInjected(sessionId: string): Promise<AgentCheckpoint> {
    return await this.transition(sessionId, (value) => { value.recovery.injectedAt = new Date().toISOString(); });
  }

  async addReferences(sessionId: string, references: AgentCheckpointReference[]): Promise<AgentCheckpoint> {
    return await this.transition(sessionId, (value) => { value.references = mergeReferences(value.references, references); });
  }

  private path(sessionId: string): string {
    return join(this.root, `${safeSessionId(sessionId)}.json`);
  }

  private async write(value: AgentCheckpoint): Promise<void> {
    const path = this.path(value.sessionId);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temporary, path);
    await appendFile(join(this.root, "journal", `${value.sessionId}.jsonl`), `${JSON.stringify({ checkpointId: value.checkpointId, sessionId: value.sessionId, revision: value.revision, state: value.state, reason: value.reason, updatedAt: value.updatedAt, active: value.active ? { toolCallId: value.active.toolCallId, toolName: value.active.toolName, operation: value.active.operation, status: value.active.status } : undefined, referenceCount: value.references.length, checksum: value.checksum })}\n`);
  }
}
