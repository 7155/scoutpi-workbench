import { createHash } from "node:crypto";
import type { AdapterBinding, EarthJob, EarthLocalExportRequest, InvestigationPlan, InvestigationSpec } from "../../earth-investigation-core/src/index.ts";

export type EarthWorkflowExecution =
  | { kind: "run"; mode: "dry_run" | "live"; execution: "inline" | "drive"; outputs?: string[] }
  | { kind: "local_export"; request: Omit<EarthLocalExportRequest, "confirmed" | "cloudProject"> };

export interface EarthWorkflow {
  schemaVersion: "scoutpi.earth.workflow.v1";
  workflowId: string;
  name: string;
  description: string;
  specTemplate: InvestigationSpec;
  requiredRoles: string[];
  adapterBindings: AdapterBinding[];
  execution: EarthWorkflowExecution;
  preconditions: Array<
    | { kind: "adapter_probe_passed"; datasetId: string; fingerprint: string }
    | { kind: "earth_engine_authenticated" }
  >;
  expectedArtifacts: string[];
  recovery: Array<{ code: string; action: "reprobe_and_recompile" | "request_human_approval" | "return_to_pi" }>;
  assertions: Array<
    | { kind: "adapter_fingerprint"; datasetId: string; fingerprint: string }
    | { kind: "required_role"; role: string }
    | { kind: "max_nominal_pixels"; value: number }
  >;
  safety: {
    requiresConfirmation: boolean;
    sourceBlockingChecks: string[];
    doesNotReplayNarrative: true;
  };
  provenance: {
    sourcePlanId: string;
    sourceJobId: string;
    compiledAt: string;
  };
}

export interface StoredEarthWorkflow {
  workflow: EarthWorkflow;
  revision: number;
  fingerprint: string;
  savedAt: string;
  stage: "candidate" | "ready";
  replayCount: number;
  successCount: number;
  failureCount: number;
}

export interface EarthWorkflowReplayRecord {
  schemaVersion: "scoutpi.earth.workflow-run.v1";
  replayId: string;
  workflowId: string;
  workflowRevision: number;
  state: "running" | "completed" | "failed" | "cancelled" | "blocked";
  planId?: string;
  jobId?: string;
  startedAt: string;
  updatedAt: string;
  error?: string;
  countedTerminal?: boolean;
  assertions: Array<{ kind: string; ok: boolean; message: string }>;
}

function invalid(message: string, code = "WORKFLOW_INVALID"): never {
  throw Object.assign(new Error(`${code}: ${message}`), { code });
}

function safeId(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{2,100}$/.test(value || "")) invalid(`${label} must be a lowercase safe identifier`);
}

function executionFromJob(job: EarthJob): EarthWorkflowExecution {
  if (job.result?.execution === "local_export") {
    const request = structuredClone(job.result.request || {}) as EarthLocalExportRequest;
    delete request.confirmed;
    delete request.cloudProject;
    if (!request.role || !request.kind) invalid("local export source job has no replayable request");
    return { kind: "local_export", request };
  }
  const execution = job.mode === "dry_run" ? "inline" : job.result?.execution === "drive" ? "drive" : "inline";
  const outputs = Array.isArray((job.result as any)?.request?.outputs) ? (job.result as any).request.outputs.map(String) : undefined;
  return { kind: "run", mode: job.mode, execution, outputs };
}

function expectedArtifacts(execution: EarthWorkflowExecution): string[] {
  if (execution.kind === "local_export") return ["geotiff", "export_manifest", "job_manifest"];
  if (execution.mode === "dry_run") return ["execution_manifest"];
  return [...new Set(["execution_manifest", ...(execution.outputs || [])])];
}

export function compileEarthWorkflow(input: {
  workflowId: string;
  name: string;
  description?: string;
  plan: InvestigationPlan;
  job: EarthJob;
  confirmedBlockingChecks?: boolean;
}): EarthWorkflow {
  safeId(input.workflowId, "workflowId");
  if (!input.name?.trim() || input.name.length > 160 || (input.description?.length || 0) > 800) invalid("name and description must be concise");
  if (input.job.planId !== input.plan.planId) invalid("job does not belong to the source plan");
  if (input.job.state !== "completed") invalid("source job must be completed", "WORKFLOW_SOURCE_NOT_SUCCESSFUL");
  const blocking = input.plan.criticChecks.filter((check) => check.severity === "blocking").map((check) => check.checkId);
  if (blocking.length && input.confirmedBlockingChecks !== true) invalid(`source plan has blocking critic checks: ${blocking.join(", ")}`, "WORKFLOW_CRITIC_BLOCKED");
  const bindings = input.plan.datasets.map((item) => item.adapterBinding);
  if (bindings.some((binding) => !binding)) invalid("source plan lacks immutable adapter bindings");
  const adapterBindings = bindings as AdapterBinding[];
  if (adapterBindings.some((binding) => binding.verificationStatus !== "passed")) invalid("all source adapters must have passed verification", "WORKFLOW_ADAPTER_UNVERIFIED");
  const requiredRoles = [...new Set(input.plan.datasets.map((item) => item.role))];
  const assertions: EarthWorkflow["assertions"] = [
    ...adapterBindings.map((binding) => ({ kind: "adapter_fingerprint" as const, datasetId: binding.datasetId, fingerprint: binding.fingerprint })),
    ...requiredRoles.map((role) => ({ kind: "required_role" as const, role })),
  ];
  if (input.plan.estimatedCost.nominalPixels !== undefined) assertions.push({ kind: "max_nominal_pixels", value: input.plan.estimatedCost.nominalPixels });
  const execution = executionFromJob(input.job);
  return {
    schemaVersion: "scoutpi.earth.workflow.v1",
    workflowId: input.workflowId,
    name: input.name.trim(),
    description: input.description?.trim() || `Replay the verified execution contract compiled from ${input.plan.spec.question}`,
    specTemplate: structuredClone(input.plan.spec),
    requiredRoles,
    adapterBindings: structuredClone(adapterBindings),
    execution,
    preconditions: [
      ...adapterBindings.map((binding) => ({ kind: "adapter_probe_passed" as const, datasetId: binding.datasetId, fingerprint: binding.fingerprint })),
      ...(execution.kind === "local_export" || (execution.kind === "run" && execution.mode === "live") ? [{ kind: "earth_engine_authenticated" as const }] : []),
    ],
    expectedArtifacts: expectedArtifacts(execution),
    recovery: [
      { code: "WORKFLOW_ADAPTER_DRIFT", action: "reprobe_and_recompile" },
      { code: "WORKFLOW_COST_INCREASE_CONFIRMATION_REQUIRED", action: "request_human_approval" },
      { code: "WORKFLOW_REPLAY_FAILED", action: "return_to_pi" },
    ],
    assertions,
    safety: {
      requiresConfirmation: input.plan.estimatedCost.requiresApproval || execution.kind === "local_export" || (execution.kind === "run" && execution.mode === "live"),
      sourceBlockingChecks: blocking,
      doesNotReplayNarrative: true,
    },
    provenance: { sourcePlanId: input.plan.planId, sourceJobId: input.job.jobId, compiledAt: new Date().toISOString() },
  };
}

export function validateEarthWorkflow(input: EarthWorkflow): EarthWorkflow {
  const workflow = structuredClone(input);
  if (workflow?.schemaVersion !== "scoutpi.earth.workflow.v1") invalid("unsupported schemaVersion");
  safeId(workflow.workflowId, "workflowId");
  if (!workflow.name?.trim() || !workflow.description?.trim() || !workflow.requiredRoles?.length || !workflow.adapterBindings?.length) invalid("workflow metadata, roles and bindings are required");
  if (workflow.requiredRoles.some((role) => !/^[a-z][a-z0-9_]{1,63}$/.test(role)) || new Set(workflow.requiredRoles).size !== workflow.requiredRoles.length) invalid("requiredRoles are invalid");
  if (workflow.adapterBindings.some((binding) => !binding.datasetId || !/^[a-f0-9]{64}$/.test(binding.fingerprint) || !Number.isInteger(binding.revision) || binding.revision < 1)) invalid("adapter bindings are invalid");
  if (workflow.execution.kind === "run" && !["dry_run", "live"].includes(workflow.execution.mode)) invalid("run execution mode is invalid");
  if (workflow.execution.kind === "local_export" && (!workflow.execution.request.role || !workflow.execution.request.kind)) invalid("local export request is invalid");
  if (!Array.isArray(workflow.preconditions) || workflow.preconditions.some((item) => !["adapter_probe_passed", "earth_engine_authenticated"].includes(item.kind))) invalid("workflow preconditions are invalid");
  if (!Array.isArray(workflow.expectedArtifacts) || workflow.expectedArtifacts.some((item) => !/^[a-z][a-z0-9_-]{1,63}$/.test(item))) invalid("workflow expectedArtifacts are invalid");
  if (!Array.isArray(workflow.recovery) || workflow.recovery.some((item) => !/^[A-Z][A-Z0-9_]{2,100}$/.test(item.code) || !["reprobe_and_recompile", "request_human_approval", "return_to_pi"].includes(item.action))) invalid("workflow recovery policy is invalid");
  if (workflow.safety?.doesNotReplayNarrative !== true) invalid("workflows must not replay narrative findings");
  return workflow;
}

export function earthWorkflowFingerprint(workflow: EarthWorkflow): string {
  const normalized = validateEarthWorkflow(workflow);
  normalized.provenance.compiledAt = "";
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function instantiateWorkflowSpec(workflowInput: EarthWorkflow, patch: Partial<InvestigationSpec>, fallbackInvestigationId: string): InvestigationSpec {
  const workflow = validateEarthWorkflow(workflowInput);
  const spec = workflow.specTemplate;
  const patched: InvestigationSpec = {
    ...spec,
    ...structuredClone(patch),
    investigationId: patch.investigationId || fallbackInvestigationId,
    region: patch.region ?? spec.region,
    period: patch.period ?? spec.period,
    hypotheses: patch.hypotheses ?? spec.hypotheses,
    confounders: patch.confounders ?? spec.confounders,
    constraints: {
      ...(spec.constraints || {}),
      ...(patch.constraints || {}),
      preferredAdapterIds: workflow.adapterBindings.map((binding) => binding.datasetId),
    },
  };
  return patched;
}
