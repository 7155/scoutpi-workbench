import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";
import { buildContextPack, configuredContextProviders, ContextPackStore, renderContextPack, validateContextCandidateEnvelope, type ContextCandidate, type ContextWritebackCandidate } from "../../../packages/runtime-context/src/index.ts";

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function compactTarget(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,239}$/.test(value) ? value : undefined;
}

function memoryTools(pi: ExtensionAPI): string[] {
  return pi.getAllTools().map((tool) => tool.name).filter((name) => /^(?:memory_|ctx_|session_search|scoutpi_knowledge)/.test(name)).sort();
}

function writeTargets(tools: string[]): string[] {
  return tools.filter((name) => /(?:remember|write|store|commit|learn)/i.test(name));
}

function writebackProviders(providers: ReturnType<typeof configuredContextProviders>) {
  return providers.filter((provider) => provider.capabilities.includes("writeback") && provider.deliverWriteback);
}

function candidate(event: { toolCallId: string; toolName: string; input: Record<string, unknown>; details: unknown; isError: boolean }): ContextWritebackCandidate | undefined {
  const input = objectOf(event.input);
  const details = objectOf(event.details);
  const operation = event.toolName === "earth_workspace" ? compactTarget(input.op) : event.toolName;
  if (!operation) return undefined;
  const targetId = compactTarget(input.id);
  const base = { source: "runtime_trace" as const, toolCallId: event.toolCallId, operation, targetId };
  if (event.isError) {
    if (!["adapter_probe", "workflow_replay", "workflow_compile"].includes(operation)) return undefined;
    return {
      candidateId: `failure-${event.toolCallId}`,
      kind: "failure_pattern",
      text: `${operation} failed${targetId ? ` for ${targetId}` : ""}; inspect the persisted trace and current runtime state before retrying.`,
      confidence: 0.75,
      tags: ["failure", operation],
      provenance: base,
    };
  }
  if (operation === "adapter_probe" && details.status === "passed" && compactTarget(details.datasetId)) {
    return { candidateId: `adapter-${event.toolCallId}`, kind: "project_state", text: `Adapter ${details.datasetId} passed a live probe${details.sampleTime ? ` using sample ${String(details.sampleTime).slice(0, 32)}` : ""}.`, confidence: 0.95, tags: ["adapter", "probe"], provenance: base };
  }
  if (operation === "workflow_compile" && compactTarget(details.workflowId) && compactTarget(details.fingerprint)) {
    return { candidateId: `workflow-${event.toolCallId}`, kind: "workflow", text: `Workflow ${details.workflowId} revision ${Number(details.revision) || 1} is ready with fingerprint ${details.fingerprint}.`, confidence: 0.99, tags: ["workflow", "compiled"], provenance: base };
  }
  if (operation === "workflow_replay" && details.state === "completed" && compactTarget(details.workflowId)) {
    return { candidateId: `replay-${event.toolCallId}`, kind: "workflow", text: `Workflow ${details.workflowId} replay ${String(details.replayId || "")} completed successfully.`, confidence: 0.98, tags: ["workflow", "replay", "success"], provenance: base };
  }
  if (operation === "save_recipe" && compactTarget(details.recipeId)) {
    return { candidateId: `recipe-${event.toolCallId}`, kind: "procedure", text: `Recipe ${details.recipeId} was validated and saved for future investigation planning.`, confidence: 0.92, tags: ["recipe", "procedure"], provenance: base };
  }
  if (operation === "skill_save" && compactTarget(details.skillId)) {
    return { candidateId: `skill-${event.toolCallId}`, kind: "procedure", text: `Generated skill ${details.skillId} was validated and saved as a draft.`, confidence: 0.9, tags: ["skill", "procedure"], provenance: base };
  }
  if (event.toolName === "earth_story" && compactTarget((objectOf(input.story)).investigationId)) {
    const investigationId = compactTarget((objectOf(input.story)).investigationId)!;
    return { candidateId: `story-${event.toolCallId}`, kind: "project_state", text: `EarthStory ${investigationId} was validated and written as an auditable artifact.`, confidence: 0.9, tags: ["story", "artifact"], provenance: { ...base, targetId: investigationId } };
  }
  return undefined;
}

export default async function setup(pi: ExtensionAPI): Promise<void> {
  const store = new ContextPackStore();
  await store.init();
  const providers = configuredContextProviders();
  let sessionId: string | undefined;
  let currentPackId: string | undefined;
  const pending = new Map<string, ContextWritebackCandidate>();

  pi.on("session_start", async (_event, ctx) => {
    sessionId = ctx.sessionManager.getSessionId();
    ctx.ui.setStatus("scoutpi-context", "Context | ready");
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const currentSessionId = ctx.sessionManager.getSessionId();
    sessionId = currentSessionId;
    pending.clear();
    const tools = memoryTools(pi);
    let candidates: ContextCandidate[] = [];
    const sourceErrors: string[] = [];
    try { candidates = (await store.loadCandidates())?.items || []; }
    catch (error) { sourceErrors.push(String((error as { code?: string }).code || "CONTEXT_FILE_SOURCE_REJECTED")); }
    const providerTimeout = Math.max(200, Math.min(5_000, Number(process.env.SCOUTPI_CONTEXT_PROVIDER_TIMEOUT_MS || 1_500) || 1_500));
    const providerResults = await Promise.all(providers.map((provider) => provider.query({
      sessionId: currentSessionId,
      query: event.prompt,
      project: process.env.SCOUTPI_CONTEXT_PROJECT?.trim() || basename(process.cwd()),
      maxItems: 12,
      timeoutMs: providerTimeout,
    })));
    for (const result of providerResults) {
      if (result.envelope) {
        try { candidates.push(...validateContextCandidateEnvelope(result.envelope).items); }
        catch (error) { sourceErrors.push(String((error as { code?: string }).code || "CONTEXT_PROVIDER_PAYLOAD_REJECTED")); }
      }
      if (result.status.state !== "ready") sourceErrors.push(result.status.errorCode || "CONTEXT_PROVIDER_FAILED");
    }
    const rawBudget = Number(process.env.SCOUTPI_CONTEXT_MAX_TOKENS || 1_200);
    const pack = buildContextPack({ sessionId: currentSessionId, query: event.prompt, candidates, detectedMemoryTools: tools, providerStatuses: providerResults.map((result) => result.status), maxTokens: Number.isFinite(rawBudget) ? rawBudget : 1_200 });
    await store.savePack(pack);
    currentPackId = pack.packId;
    pi.appendEntry("scoutpi:context-pack", { packId: pack.packId, queryHash: pack.queryHash, selectedCount: pack.items.length, deliveredTokens: pack.budget.deliveredTokens, sourceProviders: pack.sourceProviders, detectedMemoryTools: tools, providers: pack.providers, sourceErrors: [...new Set(sourceErrors)] });
    const readyProviders = pack.providers.filter((provider) => provider.state === "ready").length;
    ctx.ui.setStatus("scoutpi-context", sourceErrors.length && !pack.items.length ? "Context | source unavailable" : `Context | ${pack.items.length} items · ${pack.budget.deliveredTokens} tokens${providers.length ? ` · ${readyProviders}/${providers.length} providers` : ""}`);
    const rendered = renderContextPack(pack);
    if (!rendered) return;
    return { systemPrompt: `${event.systemPrompt}\n\n${rendered}` };
  });

  pi.on("tool_result", async (event) => {
    if (!sessionId) return;
    const value = candidate(event);
    if (value) pending.set(value.candidateId, value);
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (!sessionId || !pending.size) return;
    const tools = memoryTools(pi);
    const writableProviders = writebackProviders(providers);
    const writeback = await store.createWriteback({ sessionId, providerTargets: [...writeTargets(tools), ...writableProviders.map((provider) => provider.providerId)], candidates: [...pending.values()] });
    let approved = false;
    let deliveryState = "not configured";
    if (ctx.hasUI) {
      const preview = writeback.candidates.slice(0, 6).map((item) => `- [${item.kind}] ${item.text}`).join("\n");
      approved = await ctx.ui.confirm("ScoutPi context writeback", `Approve ${writeback.candidates.length} runtime-derived memory candidate(s)?\n\n${preview}\n\nApproval creates a durable outbox. Opt-in providers receive it through a reviewed, idempotent import adapter; ScoutPi never writes provider tables directly.`);
      const decided = await store.decideWriteback(writeback.writebackId, approved, approved ? writeback.payloadSha256 : undefined);
      if (approved && writableProviders.length) {
        const outcomes: string[] = [];
        for (const provider of writableProviders) {
          const staged = await store.stageWritebackDelivery(decided, provider.providerId);
          try {
            await store.withWritebackDeliveryLease(staged.deliveryId, async () => {
              const current = await store.getWritebackDelivery(staged.deliveryId);
              if (current.state === "delivered") { outcomes.push(`${provider.providerId}:delivered`); return; }
              const result = await provider.deliverWriteback!({ writeback: decided, delivery: current, project: process.env.SCOUTPI_CONTEXT_PROJECT?.trim() || basename(process.cwd()), timeoutMs: Math.max(500, Math.min(10_000, Number(process.env.SCOUTPI_CONTEXT_WRITEBACK_TIMEOUT_MS || 4_000) || 4_000)) });
              if (result.receipt) {
                await store.completeWritebackDelivery(current.deliveryId, result.receipt);
                outcomes.push(`${provider.providerId}:delivered`);
              } else {
                await store.failWritebackDelivery(current.deliveryId, result.errorCode || "CONTEXT_PROVIDER_WRITEBACK_FAILED");
                outcomes.push(`${provider.providerId}:failed`);
              }
            });
          } catch (error) {
            const code = String((error as { code?: string }).code || "CONTEXT_PROVIDER_WRITEBACK_FAILED");
            if (code !== "CONTEXT_DELIVERY_BUSY") await store.failWritebackDelivery(staged.deliveryId, code).catch(() => undefined);
            outcomes.push(`${provider.providerId}:${code === "CONTEXT_DELIVERY_BUSY" ? "busy" : "failed"}`);
          }
        }
        deliveryState = outcomes.join(", ");
      } else if (approved) deliveryState = "approved outbox";
      else deliveryState = "rejected";
    }
    pi.appendEntry("scoutpi:context-writeback", { writebackId: writeback.writebackId, state: ctx.hasUI ? approved ? "approved" : "rejected" : "pending", deliveryState, candidateIds: writeback.candidates.map((item) => item.candidateId), providerTargets: writeback.providerTargets, payloadSha256: writeback.payloadSha256 });
    ctx.ui.setStatus("scoutpi-context", `Context | pack ${currentPackId?.slice(-8) || "none"} · writeback ${ctx.hasUI ? approved ? deliveryState : "rejected" : "pending"}`);
    pending.clear();
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    sessionId = undefined;
    currentPackId = undefined;
    pending.clear();
    ctx.ui.setStatus("scoutpi-context", undefined);
  });

  pi.registerCommand("earth-context", {
    description: "Show the latest ScoutPi context pack and writeback state.",
    handler: async (_args, ctx) => {
      const id = ctx.sessionManager.getSessionId();
      const pack = await store.latestForSession(id).catch(() => undefined);
      const writebacks = (await store.listWritebacks(100)).filter((item) => item.sessionId === id);
      ctx.ui.notify(pack ? `Context ${pack.packId}\nitems=${pack.items.length} tokens=${pack.budget.deliveredTokens}/${pack.budget.maxTokens} truncated=${pack.budget.truncated}\nwritebacks=${writebacks.length}` : "No ScoutPi context pack for this session.", "info");
    },
  });
}
