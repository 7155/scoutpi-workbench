import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentCheckpointStore, checkpointReferencesFromTool, isRecoverableCheckpoint, renderCheckpointResume, type AgentCheckpoint } from "../../../packages/runtime-checkpoint/src/index.ts";

function modelName(model: unknown): string | undefined {
  if (!model || typeof model !== "object") return undefined;
  const value = model as { provider?: unknown; id?: unknown };
  return [value.provider, value.id].filter((item) => typeof item === "string" && item).join("/") || undefined;
}

function operationOf(value: unknown): { operation?: string; targetId?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  return { operation: typeof input.op === "string" ? input.op : undefined, targetId: typeof input.id === "string" ? input.id : undefined };
}

export default async function setup(pi: ExtensionAPI): Promise<void> {
  const store = new AgentCheckpointStore();
  await store.init();
  let sessionId: string | undefined;
  let resumeCheckpoint: AgentCheckpoint | undefined;

  const transition = async (update: (value: AgentCheckpoint) => void): Promise<AgentCheckpoint | undefined> => {
    if (!sessionId) return undefined;
    try { return await store.transition(sessionId, update); } catch { return undefined; }
  };

  pi.on("session_start", async (event, ctx) => {
    sessionId = ctx.sessionManager.getSessionId();
    await store.open(sessionId, { model: modelName(ctx.model) });
    resumeCheckpoint = await store.prepareResume(sessionId, `session_${event.reason}`);
    ctx.ui.setStatus("scoutpi-checkpoint", resumeCheckpoint ? `Checkpoint | recovery r${resumeCheckpoint.revision}` : "Checkpoint | ready");
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (!sessionId) sessionId = ctx.sessionManager.getSessionId();
    if (!resumeCheckpoint || !isRecoverableCheckpoint(resumeCheckpoint) || resumeCheckpoint.recovery.injectedAt) return;
    const content = renderCheckpointResume(resumeCheckpoint);
    resumeCheckpoint = await store.markResumeInjected(sessionId);
    return { message: { customType: "scoutpi-checkpoint", content, display: true, details: { checkpointId: resumeCheckpoint.checkpointId, revision: resumeCheckpoint.revision } } };
  });

  pi.on("agent_start", async (_event, ctx) => {
    await transition((value) => {
      value.state = "running";
      value.reason = undefined;
      value.runtime.model = modelName(ctx.model);
      const usage = ctx.getContextUsage();
      value.runtime.contextTokens = usage?.tokens ?? undefined;
      value.runtime.contextWindow = usage?.contextWindow;
      value.runtime.contextPercent = usage?.percent ?? undefined;
      value.recovery.recoverable = true;
    });
  });

  pi.on("turn_start", async (event) => {
    await transition((value) => { value.state = "running"; value.turnIndex = event.turnIndex; value.recovery.recoverable = true; });
  });

  pi.on("tool_execution_start", async (event) => {
    const fields = operationOf(event.args);
    await transition((value) => {
      value.state = "tool_running";
      value.active = { toolCallId: event.toolCallId, toolName: event.toolName, operation: fields.operation, targetId: fields.targetId, startedAt: new Date().toISOString() };
      value.references = [...new Map([...value.references, ...checkpointReferencesFromTool(event.toolName, event.args)].map((row) => [`${row.kind}:${row.id}`, row])).values()].slice(-100);
      value.recovery = { recoverable: true, nextAction: "If the runtime stops, inspect persisted state before repeating this operation." };
    });
  });

  pi.on("tool_result", async (event) => {
    await transition((value) => {
      value.references = [...new Map([...value.references, ...checkpointReferencesFromTool(event.toolName, event.input, event.details)].map((row) => [`${row.kind}:${row.id}`, row])).values()].slice(-100);
    });
  });

  pi.on("tool_execution_end", async (event) => {
    await transition((value) => {
      const active = value.active?.toolCallId === event.toolCallId ? value.active : { toolCallId: event.toolCallId, toolName: event.toolName, startedAt: value.updatedAt };
      value.lastCompleted = { ...active, finishedAt: new Date().toISOString(), status: event.isError ? "failed" : "ok" };
      value.active = undefined;
      value.state = event.isError ? "failed" : "running";
      value.reason = event.isError ? "tool_failed" : undefined;
      value.recovery = event.isError
        ? { recoverable: true, nextAction: "Inspect the structured failure and persisted artifacts before selecting a recovery action." }
        : { recoverable: true };
    });
  });

  pi.on("session_before_compact", async (event) => {
    const preserve = "Preserve ScoutPi investigationId, planId, jobId, workflowId, replayId, approvalId, adapter fingerprints, artifact IDs, unresolved critic checks, and failed-operation recovery state. Do not preserve raw tool payloads or secrets.";
    event.customInstructions = event.customInstructions ? `${event.customInstructions}\n${preserve}` : preserve;
    await transition((value) => { value.compaction.lastReason = event.reason; value.recovery.recoverable = true; });
  });

  pi.on("session_compact", async (event) => {
    await transition((value) => { value.compaction.count += 1; value.compaction.lastReason = event.reason; value.compaction.lastAt = new Date().toISOString(); });
  });

  pi.on("agent_end", async () => {
    await transition((value) => { value.state = "settled"; value.active = undefined; value.reason = undefined; value.recovery = { recoverable: false }; });
  });

  pi.on("session_shutdown", async (event, ctx) => {
    await transition((value) => {
      if (["running", "tool_running", "failed"].includes(value.state)) {
        if (value.active && !value.active.finishedAt) value.active.status = "interrupted";
        value.state = "paused";
        value.reason = `session_${event.reason}`;
        value.recovery = { recoverable: true, nextAction: "Resume from the checkpoint and verify persisted operation status before retrying." };
      }
    });
    sessionId = undefined;
    resumeCheckpoint = undefined;
    ctx.ui.setStatus("scoutpi-checkpoint", undefined);
  });

  pi.registerCommand("earth-checkpoint", {
    description: "Show the current durable ScoutPi checkpoint.",
    handler: async (_args, ctx) => {
      const current = await store.get(ctx.sessionManager.getSessionId()).catch(() => undefined);
      ctx.ui.notify(current ? `Checkpoint ${current.state} r${current.revision}\nrefs=${current.references.length} recoverable=${current.recovery.recoverable}` : "No ScoutPi checkpoint for this session.", "info");
    },
  });
}
