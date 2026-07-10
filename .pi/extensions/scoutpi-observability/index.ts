import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AgentRunStore } from "../../../packages/runtime-observability/src/index.ts";

function modelName(model: unknown): string | undefined {
  if (!model || typeof model !== "object") return undefined;
  const provider = String((model as any).provider || "");
  const id = String((model as any).id || "");
  return [provider, id].filter(Boolean).join("/") || undefined;
}

function operationOf(value: unknown): { operation?: string; targetId?: string; approvalId?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const options = input.options && typeof input.options === "object" && !Array.isArray(input.options) ? input.options as Record<string, unknown> : {};
  return {
    operation: typeof input.op === "string" ? input.op : undefined,
    targetId: typeof input.id === "string" ? input.id : undefined,
    approvalId: typeof options.approvalId === "string" ? options.approvalId : undefined,
  };
}

export default async function setup(pi: ExtensionAPI): Promise<void> {
  const store = new AgentRunStore();
  await store.init();
  let runId: string | undefined;
  const startedTools = new Map<string, number>();

  const record = async (input: Parameters<AgentRunStore["event"]>[1]): Promise<void> => {
    if (!runId) return;
    try { await store.event(runId, input); } catch {}
  };

  pi.on("before_agent_start", async (event, ctx) => {
    if (runId) await store.complete(runId, { interrupted: true }).catch(() => undefined);
    const run = await store.start({ sessionId: ctx.sessionManager.getSessionId(), prompt: event.prompt, model: modelName(ctx.model) });
    runId = run.runId;
    await record({ kind: "agent", name: "before_agent_start", inputBytes: store.measure({ promptChars: event.prompt.length, imageCount: event.images?.length || 0 }) });
    ctx.ui.setStatus("scoutpi-observability", `Trace | ${runId}`);
  });

  pi.on("agent_start", async () => { await record({ kind: "agent", name: "agent_start" }); });
  pi.on("context", async (event) => { await record({ kind: "context", name: "context_assembled", inputBytes: store.measure(event.messages) }); });
  pi.on("before_provider_request", async (event) => { await record({ kind: "provider", name: "provider_request", inputBytes: store.measure(event.payload) }); });
  pi.on("after_provider_response", async (event) => { await record({ kind: "provider", name: "provider_response", outputBytes: store.measure(event.headers), isError: event.status >= 400 }); });

  pi.on("turn_start", async (event) => {
    if (runId) await store.increment(runId, "turns").catch(() => undefined);
    await record({ kind: "turn", name: "turn_start", operation: String(event.turnIndex) });
  });
  pi.on("turn_end", async (event) => { await record({ kind: "turn", name: "turn_end", operation: String(event.turnIndex), outputBytes: store.measure(event.message) }); });

  pi.on("tool_call", async (event) => {
    const fields = operationOf(event.input);
    if (fields.approvalId && runId) {
      await store.increment(runId, "approvalCount").catch(() => undefined);
      await record({ kind: "approval", name: "approval_attached", toolCallId: event.toolCallId, toolName: event.toolName, ...fields });
    }
  });
  pi.on("tool_execution_start", async (event) => {
    startedTools.set(event.toolCallId, performance.now());
    if (runId) await store.increment(runId, "toolCalls").catch(() => undefined);
    await record({ kind: "tool", name: "tool_execution_start", toolCallId: event.toolCallId, toolName: event.toolName, inputBytes: store.measure(event.args), ...operationOf(event.args) });
  });
  pi.on("tool_execution_update", async (event) => {
    await record({ kind: "tool", name: "tool_execution_update", toolCallId: event.toolCallId, toolName: event.toolName, outputBytes: store.measure(event.partialResult) });
  });
  pi.on("tool_execution_end", async (event) => {
    const started = startedTools.get(event.toolCallId);
    startedTools.delete(event.toolCallId);
    if (event.isError && runId) await store.increment(runId, "failedToolCalls").catch(() => undefined);
    await record({ kind: "tool", name: "tool_execution_end", toolCallId: event.toolCallId, toolName: event.toolName, elapsedMs: started === undefined ? undefined : performance.now() - started, outputBytes: store.measure(event.result), isError: event.isError });
  });

  pi.on("agent_end", async (event, ctx) => {
    if (!runId) return;
    await record({ kind: "agent", name: "agent_end", outputBytes: store.measure(event.messages) });
    await store.complete(runId, { messages: event.messages }).catch(() => undefined);
    runId = undefined;
    ctx.ui.setStatus("scoutpi-observability", "Trace | settled");
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    if (runId) await store.complete(runId, { interrupted: true }).catch(() => undefined);
    runId = undefined;
    ctx.ui.setStatus("scoutpi-observability", undefined);
  });
}
