import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { EarthWorkspace, earthOperationRisk, type InvestigationPlan } from "../../../packages/earth-workspace/src/index.ts";

function optionsOf(input: Record<string, unknown>): Record<string, unknown> {
  return input.options && typeof input.options === "object" && !Array.isArray(input.options) ? input.options as Record<string, unknown> : {};
}

function regionLabel(plan: InvestigationPlan): string {
  if (plan.spec.region.name) return plan.spec.region.name;
  if (plan.spec.region.kind === "bbox") return plan.spec.region.bbox?.join(", ") || "bbox";
  return plan.spec.region.kind;
}

async function approvalCard(workspace: EarthWorkspace, input: Record<string, unknown>): Promise<{ text: string; fingerprints: string[]; limits?: { maxPixels?: number; maxBytes?: number } }> {
  const op = String(input.op || "");
  const id = String(input.id || "");
  const options = optionsOf(input);
  let plan: InvestigationPlan | undefined;
  if (id && ["run", "export", "export_local"].includes(op)) plan = await workspace.getPlan(id).catch(() => undefined);
  if (op === "workflow_replay" && id) {
    const workflow = await workspace.getWorkflow(id).catch(() => undefined);
    if (workflow) plan = await workspace.getPlan(workflow.workflow.provenance.sourcePlanId).catch(() => undefined);
  }
  const operationNames: Record<string, string> = {
    run: "Live Earth Engine run",
    export: "Google Drive export",
    export_local: "Local GeoTIFF export",
    retry: "Retry persisted export",
    adapter_enable: "Enable execution adapter",
    skill_publish: "Publish generated Pi skill",
    workflow_compile: "Override blocking critic checks",
    workflow_replay: "Replay compiled workflow",
  };
  const fingerprints = plan?.datasets.map((item) => item.adapterBinding?.fingerprint).filter((value): value is string => Boolean(value)) || [];
  const maxPixels = typeof options.maxPixels === "number" ? options.maxPixels : plan?.estimatedCost.nominalPixels;
  const maxBytes = typeof options.maxBytes === "number" ? options.maxBytes : undefined;
  const lines = [
    `Operation: ${operationNames[op] || op}`,
    `Target: ${id || "workspace"}`,
    ...(plan ? [
      `Region: ${regionLabel(plan)}`,
      `Period: ${plan.spec.period.startYear}-${plan.spec.period.endYear}`,
      `Datasets: ${plan.datasets.map((item) => item.dataset.datasetId).join(", ")}`,
      `Adapter status: ${plan.datasets.map((item) => `${item.dataset.datasetId}=${item.adapterBinding?.verificationStatus || "unbound"}`).join(", ")}`,
      `Adapter verification: ${plan.datasets.map((item) => `${item.dataset.datasetId}=${item.adapterBinding?.verificationStatus || "missing"}`).join(", ")}`,
      `Estimated pixels: ${plan.estimatedCost.nominalPixels?.toLocaleString() || "unknown"}`,
    ] : []),
    ...(options.year ? [`Year: ${String(options.year)}`] : []),
    ...(options.scaleMeters ? [`Resolution: ${String(options.scaleMeters)} m`] : []),
    ...(fingerprints.length ? [`Adapter fingerprints: ${fingerprints.map((value) => value.slice(0, 12)).join(", ")}`] : []),
    `Risk: ${earthOperationRisk(input)}`,
  ];
  return { text: lines.join("\n"), fingerprints, limits: maxPixels === undefined && maxBytes === undefined ? undefined : { maxPixels, maxBytes } };
}

export default async function setup(pi: ExtensionAPI): Promise<void> {
  const workspace = new EarthWorkspace();
  await workspace.init();

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "earth_workspace") return;
    const input = event.input as Record<string, unknown>;
    const risk = earthOperationRisk(input);
    if (!risk) return;
    const options = optionsOf(input);
    delete options.approvalId;
    input.options = options;
    if (!ctx.hasUI) return { block: true, reason: `GOVERNANCE_UI_REQUIRED: ${String(input.op)} needs direct user approval` };
    const card = await approvalCard(workspace, input);
    const approved = await ctx.ui.confirm("ScoutPi execution approval", card.text);
    if (!approved) return { block: true, reason: `USER_DENIED: ${String(input.op)}` };
    const receipt = await workspace.approvals.issue({
      toolCallId: event.toolCallId,
      operation: `earth_workspace:${String(input.op)}`,
      risk,
      parameters: input,
      summary: card.text,
      adapterFingerprints: card.fingerprints,
      limits: card.limits,
    });
    input.options = { ...options, approvalId: receipt.approvalId };
    pi.appendEntry("scoutpi:approval", { approvalId: receipt.approvalId, toolCallId: event.toolCallId, operation: receipt.operation, risk, approvedAt: receipt.approvedAt });
  });

  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("scoutpi-governance", "Governance | user receipts required");
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus("scoutpi-governance", undefined);
  });
}
