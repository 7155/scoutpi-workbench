import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { EarthWorkspace } from "../../../packages/earth-workspace/src/index.ts";
import { TriggerRuntime, type WorkflowTrigger } from "../../../packages/runtime-trigger/src/index.ts";

function conditionLabel(trigger: WorkflowTrigger): string {
  if (trigger.condition.kind === "manual") return "manual invocation";
  if (trigger.condition.kind === "interval") return `every ${trigger.condition.everyMinutes} minutes`;
  return `event ${trigger.condition.eventName}`;
}

export default async function setup(pi: ExtensionAPI): Promise<void> {
  const workspace = new EarthWorkspace();
  const runtime = new TriggerRuntime(workspace);
  await runtime.init();

  async function updateStatus(ctx: any): Promise<void> {
    const triggers = await runtime.listTriggers();
    const drafts = triggers.filter((item) => item.state === "draft").length;
    const active = triggers.filter((item) => item.state === "active").length;
    ctx.ui.setStatus("scoutpi-triggers", `Triggers | ${active} active${drafts ? ` · ${drafts} review` : ""}`);
  }

  pi.on("session_start", async (_event, ctx) => { await updateStatus(ctx); });
  pi.on("session_shutdown", async (_event, ctx) => { ctx.ui.setStatus("scoutpi-triggers", undefined); });

  pi.registerCommand("earth-triggers", {
    description: "Show durable workflow triggers and delegation state.",
    handler: async (_args, ctx) => {
      const [triggers, runs] = await Promise.all([runtime.listTriggers(), runtime.listRuns(20)]);
      const counts = Object.fromEntries(["draft", "active", "paused", "revoked"].map((state) => [state, triggers.filter((item) => item.state === state).length]));
      ctx.ui.notify(`Triggers: active=${counts.active} draft=${counts.draft} paused=${counts.paused} revoked=${counts.revoked}\nRecent runs=${runs.length}`, "info");
    },
  });

  pi.registerCommand("earth-trigger-approve", {
    description: "Approve one reviewed dry-run workflow trigger with a signed delegation grant.",
    handler: async (args, ctx) => {
      const triggerId = args.trim();
      if (!triggerId) {
        const drafts = (await runtime.listTriggers()).filter((item) => item.state === "draft" || item.state === "paused");
        ctx.ui.notify(drafts.length ? drafts.map((item) => `${item.triggerId} · ${item.name} · ${conditionLabel(item)}`).join("\n") : "No trigger is waiting for approval.", "info");
        return;
      }
      const trigger = await runtime.getTrigger(triggerId);
      const workflow = await workspace.getWorkflow(trigger.workflowId);
      const card = [
        `Trigger: ${trigger.name}`,
        `Workflow: ${trigger.workflowId} · ${workflow.stage}`,
        `Condition: ${conditionLabel(trigger)}`,
        `Identity: ${trigger.subject.displayName} (${trigger.subject.principalId})`,
        `Scope: workflow:replay:dry_run`,
        `Maximum runs: ${trigger.limits.maxRuns}`,
        `Cooldown: ${trigger.limits.cooldownSeconds} seconds`,
        `Expires: ${trigger.limits.expiresAt}`,
      ].join("\n");
      const approved = await ctx.ui.confirm("Authorize durable trigger", card);
      if (!approved) { ctx.ui.notify("Trigger authorization cancelled.", "info"); return; }
      const result = await runtime.approve(trigger.triggerId, { principalId: "pi:operator", kind: "human", displayName: "Pi operator" });
      pi.appendEntry("scoutpi:trigger-delegation", { triggerId: result.trigger.triggerId, workflowId: result.trigger.workflowId, grantId: result.grant.grantId, scope: result.grant.scopes[0], expiresAt: result.grant.expiresAt, maxRuns: result.grant.maxRuns });
      await updateStatus(ctx);
      ctx.ui.notify(`Trigger ${result.trigger.triggerId} is active with a signed dry-run delegation.`, "info");
    },
  });
}
