import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ContextPack } from "../../runtime-context/src/index.ts";
import type { EvidenceGraph } from "../../runtime-evidence/src/index.ts";

export interface AgentModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  reportedCostUsd: number;
}

export interface AgentRunSummary {
  schemaVersion: "scoutpi.agent.run-summary.v1";
  runId: string;
  sessionId: string;
  state: "running" | "completed" | "interrupted";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  model?: string;
  promptHash: string;
  promptChars: number;
  promptPreview?: string;
  turns: number;
  toolCalls: number;
  failedToolCalls: number;
  approvalCount: number;
  modelUsage: AgentModelUsage;
}

export interface AgentRunEvent {
  schemaVersion: "scoutpi.agent.run-event.v1";
  eventId: string;
  runId: string;
  at: string;
  kind: "agent" | "turn" | "tool" | "context" | "provider" | "approval";
  name: string;
  toolCallId?: string;
  toolName?: string;
  elapsedMs?: number;
  inputBytes?: number;
  outputBytes?: number;
  isError?: boolean;
  operation?: string;
  targetId?: string;
  approvalId?: string;
}

const emptyUsage = (): AgentModelUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, reportedCostUsd: 0 });

function bytes(value: unknown): number {
  try { return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value) || ""); }
  catch { return 0; }
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function aggregateModelUsage(messages: unknown[]): AgentModelUsage {
  const total = emptyUsage();
  for (const message of messages) {
    if (!message || typeof message !== "object" || (message as any).role !== "assistant") continue;
    const usage = (message as any).usage;
    if (!usage || typeof usage !== "object") continue;
    total.inputTokens += finite(usage.input);
    total.outputTokens += finite(usage.output);
    total.cacheReadTokens += finite(usage.cacheRead);
    total.cacheWriteTokens += finite(usage.cacheWrite);
    total.totalTokens += finite(usage.totalTokens) || finite(usage.input) + finite(usage.output) + finite(usage.cacheRead) + finite(usage.cacheWrite);
    total.reportedCostUsd += finite(usage.cost?.total);
  }
  total.reportedCostUsd = Math.round(total.reportedCostUsd * 1_000_000) / 1_000_000;
  return total;
}

export class AgentRunStore {
  readonly root: string;
  readonly debugText: boolean;
  private readonly summaryQueues = new Map<string, Promise<void>>();

  constructor(root = process.env.SCOUTPI_RUNS_ROOT ?? ".scoutpi/runs", debugText = process.env.SCOUTPI_TRACE_DEBUG_TEXT === "1") {
    this.root = resolve(root);
    this.debugText = debugText;
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async start(input: { sessionId: string; prompt: string; model?: string }): Promise<AgentRunSummary> {
    await this.init();
    const runId = `run_${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
    const summary: AgentRunSummary = {
      schemaVersion: "scoutpi.agent.run-summary.v1",
      runId,
      sessionId: input.sessionId,
      state: "running",
      startedAt: new Date().toISOString(),
      model: input.model,
      promptHash: createHash("sha256").update(input.prompt).digest("hex"),
      promptChars: input.prompt.length,
      promptPreview: this.debugText ? input.prompt.replace(/\s+/g, " ").slice(0, 160) : undefined,
      turns: 0,
      toolCalls: 0,
      failedToolCalls: 0,
      approvalCount: 0,
      modelUsage: emptyUsage(),
    };
    const directory = this.directory(runId);
    await mkdir(directory, { recursive: true });
    await this.writeSummary(summary);
    await writeFile(join(directory, "run.json"), `${JSON.stringify({ schemaVersion: "scoutpi.agent.run.v1", runId, sessionId: input.sessionId, model: input.model, promptHash: summary.promptHash, promptChars: summary.promptChars, startedAt: summary.startedAt, privacy: { rawTextStored: this.debugText } }, null, 2)}\n`);
    await writeFile(join(directory, "context_pack.json"), `${JSON.stringify({ schemaVersion: "scoutpi.context-pack.v1", runId, sourceMemoryIds: [], maxTokens: 0, status: "not_connected" }, null, 2)}\n`);
    await writeFile(join(directory, "evidence_graph.json"), `${JSON.stringify({ schemaVersion: "scoutpi.evidence-graph.v1", runId, nodes: [], edges: [], status: "not_connected" }, null, 2)}\n`);
    return summary;
  }

  async event(runId: string, input: Omit<AgentRunEvent, "schemaVersion" | "eventId" | "runId" | "at">): Promise<AgentRunEvent> {
    const event: AgentRunEvent = { schemaVersion: "scoutpi.agent.run-event.v1", eventId: `event_${randomUUID()}`, runId, at: new Date().toISOString(), ...input };
    await appendFile(join(this.directory(runId), "events.jsonl"), `${JSON.stringify(event)}\n`);
    if (event.kind === "tool") await appendFile(join(this.directory(runId), "tool_calls.jsonl"), `${JSON.stringify(event)}\n`);
    if (event.isError) await appendFile(join(this.directory(runId), "failures.jsonl"), `${JSON.stringify(event)}\n`);
    if (event.kind === "approval") await appendFile(join(this.directory(runId), "approvals.jsonl"), `${JSON.stringify(event)}\n`);
    return event;
  }

  async complete(runId: string, input: { messages?: unknown[]; interrupted?: boolean }): Promise<AgentRunSummary> {
    const summary = await this.updateSummary(runId, (current) => {
      current.state = input.interrupted ? "interrupted" : "completed";
      current.completedAt = new Date().toISOString();
      current.durationMs = Math.max(0, Date.parse(current.completedAt) - Date.parse(current.startedAt));
      current.modelUsage = aggregateModelUsage(input.messages || []);
    });
    await writeFile(join(this.directory(runId), "model_usage.json"), `${JSON.stringify(summary.modelUsage, null, 2)}\n`);
    return summary;
  }

  async attachContextPack(runId: string, pack: ContextPack): Promise<void> {
    if (pack.schemaVersion !== "scoutpi.context-pack.v1" || !/^[a-f0-9]{64}$/.test(pack.queryHash)) throw Object.assign(new Error("CONTEXT_PACK_INVALID"), { code: "CONTEXT_PACK_INVALID" });
    await this.get(runId);
    await writeFile(join(this.directory(runId), "context_pack.json"), `${JSON.stringify(pack, null, 2)}\n`);
  }

  async attachEvidenceGraph(runId: string, graph: EvidenceGraph): Promise<void> {
    if (graph.schemaVersion !== "scoutpi.evidence-graph.v1" || !graph.investigationId) throw Object.assign(new Error("EVIDENCE_GRAPH_INVALID"), { code: "EVIDENCE_GRAPH_INVALID" });
    await this.get(runId);
    await writeFile(join(this.directory(runId), "evidence_graph.json"), `${JSON.stringify(graph, null, 2)}\n`);
  }

  async increment(runId: string, field: "turns" | "toolCalls" | "failedToolCalls" | "approvalCount", amount = 1): Promise<AgentRunSummary> {
    return await this.updateSummary(runId, (summary) => { summary[field] += amount; });
  }

  async get(runId: string): Promise<AgentRunSummary> {
    if (!/^run_[0-9]{14}_[a-f0-9-]{8}$/.test(runId || "")) throw Object.assign(new Error("RUN_ID_INVALID"), { code: "RUN_ID_INVALID" });
    return JSON.parse(await readFile(join(this.directory(runId), "summary.json"), "utf8")) as AgentRunSummary;
  }

  async list(limit = 100): Promise<AgentRunSummary[]> {
    await this.init();
    const rows: AgentRunSummary[] = [];
    for (const name of (await readdir(this.root)).filter((value) => value.startsWith("run_")).sort().reverse().slice(0, Math.max(1, Math.min(1_000, limit)))) {
      try { rows.push(await this.get(name)); } catch {}
    }
    return rows;
  }

  measure(value: unknown): number {
    return bytes(value);
  }

  private directory(runId: string): string {
    return join(this.root, runId);
  }

  private async writeSummary(summary: AgentRunSummary): Promise<void> {
    await writeFile(join(this.directory(summary.runId), "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  }

  private async updateSummary(runId: string, update: (summary: AgentRunSummary) => void): Promise<AgentRunSummary> {
    let result: AgentRunSummary | undefined;
    const previous = this.summaryQueues.get(runId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const summary = await this.get(runId);
      update(summary);
      await this.writeSummary(summary);
      result = summary;
    });
    this.summaryQueues.set(runId, next);
    try { await next; }
    finally { if (this.summaryQueues.get(runId) === next) this.summaryQueues.delete(runId); }
    return result!;
  }
}
