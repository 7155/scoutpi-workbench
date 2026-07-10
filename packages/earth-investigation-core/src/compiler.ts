import { createHash, randomUUID } from "node:crypto";
import type { AnalysisNode, CriticCheck, DatasetDescriptor, DatasetPlanItem, InvestigationPlan, InvestigationSpec, RegionSpec } from "./types.ts";

function fail(message: string): never { throw Object.assign(new Error(`INVESTIGATION_INVALID: ${message}`), { code: "INVESTIGATION_INVALID" }); }

export function validateRegion(region: RegionSpec): void {
  if (!region || typeof region !== "object") fail("region is required");
  if (region.kind === "bbox") {
    if (!Array.isArray(region.bbox) || region.bbox.length !== 4 || region.bbox.some((value) => !Number.isFinite(value))) fail("bbox must contain four finite numbers");
    const [west, south, east, north] = region.bbox;
    if (west >= east || south >= north || west < -180 || east > 180 || south < -90 || north > 90) fail("bbox is invalid");
  } else if (region.kind === "asset") {
    if (!region.assetId?.startsWith("projects/") && !region.assetId?.startsWith("users/")) fail("assetId must be an Earth Engine asset path");
  } else if (region.kind === "geojson") {
    if (!region.geometry || typeof region.geometry.type !== "string") fail("GeoJSON geometry is invalid");
  } else fail("unsupported region kind");
}

export function validateInvestigationSpec(spec: InvestigationSpec): InvestigationSpec {
  if (spec.schemaVersion !== "scoutpi.investigation.v1") fail("unsupported schemaVersion");
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(spec.investigationId || "")) fail("investigationId must be a safe lowercase identifier");
  if (!spec.question?.trim()) fail("question is required");
  validateRegion(spec.region);
  const { startYear, endYear } = spec.period || {} as any;
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear > endYear || startYear < 1950 || endYear > new Date().getUTCFullYear()) fail("period years are invalid");
  const { startMonth = 1, endMonth = 12 } = spec.period;
  if (!Number.isInteger(startMonth) || !Number.isInteger(endMonth) || startMonth < 1 || startMonth > 12 || endMonth < 1 || endMonth > 12) fail("period months must be integers from 1 to 12");
  if (endYear - startYear > (spec.constraints?.maxYears ?? 40)) fail("period exceeds maxYears");
  if (!Array.isArray(spec.hypotheses) || spec.hypotheses.length === 0 || spec.hypotheses.length > 12) fail("1-12 hypotheses are required");
  const hypothesisIds = new Set<string>();
  for (const hypothesis of spec.hypotheses) {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(hypothesis.id || "") || !hypothesis.statement?.trim() || !hypothesis.observableRoles?.length) fail("each hypothesis needs a safe id, statement and observableRoles");
    if (hypothesisIds.has(hypothesis.id)) fail(`duplicate hypothesis id ${hypothesis.id}`);
    hypothesisIds.add(hypothesis.id);
    if (hypothesis.observableRoles.some((role) => !/^[a-z][a-z0-9_]{1,63}$/.test(role))) fail(`hypothesis ${hypothesis.id} has an invalid observable role`);
  }
  if ((spec.claims || []).length > 100) fail("claims exceed the 100-item limit");
  for (const claim of spec.claims || []) {
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(claim.claimId || "") || !claim.claim?.trim() || claim.claim.length > 2000) fail("each claim needs a safe id and concise text");
    try {
      const url = new URL(claim.sourceUrl);
      if (!["http:", "https:"].includes(url.protocol)) fail("claim sourceUrl must use http or https");
    } catch { fail("claim sourceUrl is invalid"); }
  }
  if (spec.region.kind === "geojson" && JSON.stringify(spec.region.geometry).length > 500_000) fail("GeoJSON geometry exceeds the 500 KB planning limit");
  return structuredClone(spec);
}

function bboxAreaKm2(region: RegionSpec): number | undefined {
  if (region.kind !== "bbox") return undefined;
  const [west, south, east, north] = region.bbox;
  const midLatitude = ((south + north) / 2) * Math.PI / 180;
  const widthKm = (east - west) * 111.32 * Math.cos(midLatitude);
  const heightKm = (north - south) * 110.57;
  return Math.max(0, widthKm * heightKm);
}

function routeDatasets(spec: InvestigationSpec, registry: DatasetDescriptor[]): DatasetPlanItem[] {
  const roleMap = new Map<string, string[]>();
  for (const hypothesis of spec.hypotheses) for (const role of hypothesis.observableRoles) roleMap.set(role, [...(roleMap.get(role) || []), hypothesis.id]);
  const items: DatasetPlanItem[] = [];
  for (const [role, hypothesisIds] of roleMap) {
    const candidates = registry.filter((dataset) => dataset.roles.includes(role) && dataset.startYear <= spec.period.startYear && (dataset.endYear === undefined || dataset.endYear >= spec.period.endYear));
    const fallback = candidates.length ? candidates : registry.filter((dataset) => dataset.roles.includes(role));
    if (!fallback.length) fail(`no registered dataset supports observable role ${role}`);
    const preferred = spec.constraints?.preferredAdapterIds || [];
    const [rawDataset, ...alternatives] = fallback.sort((a, b) => {
      const ai = preferred.indexOf(a.datasetId); const bi = preferred.indexOf(b.datasetId);
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || a.scaleMeters - b.scaleMeters;
    });
    const dataset = { ...rawDataset, analysis: rawDataset.analysisByRole?.[role] ?? rawDataset.analysis };
    items.push({ role, dataset, reason: `Covers role ${role}, requested period where available, and provides ${dataset.scaleMeters} m nominal scale.`, hypothesisIds, alternatives: alternatives.map((item) => item.datasetId) });
  }
  return items;
}

function compileDag(spec: InvestigationSpec, datasets: DatasetPlanItem[]): AnalysisNode[] {
  const nodes: AnalysisNode[] = [];
  for (const item of datasets) {
    const prefix = item.role.replace(/[^a-z0-9]+/gi, "_");
    nodes.push({ nodeId: `${prefix}_source`, op: "source", dependsOn: [], params: { datasetId: item.dataset.datasetId, collectionId: item.dataset.collectionId } });
    nodes.push({ nodeId: `${prefix}_region`, op: "filter_region", dependsOn: [`${prefix}_source`], params: { region: spec.region } });
    nodes.push({ nodeId: `${prefix}_time`, op: "filter_time", dependsOn: [`${prefix}_region`], params: { period: spec.period } });
    if (item.dataset.analysis.qualityMask) nodes.push({ nodeId: `${prefix}_quality`, op: "quality_mask", dependsOn: [`${prefix}_time`], params: { rules: item.dataset.analysis.qualityMask.rules } });
    const upstream = item.dataset.analysis.qualityMask ? `${prefix}_quality` : `${prefix}_time`;
    const processingScale = item.dataset.scaleMeters;
    nodes.push({ nodeId: `${prefix}_annual`, op: "annual_metric", dependsOn: [upstream], params: { role: item.role, analysis: item.dataset.analysis, scaleMeters: processingScale } });
    nodes.push({ nodeId: `${prefix}_compare`, op: "compare", dependsOn: [`${prefix}_annual`], params: { baseline: spec.period.startYear, target: spec.period.endYear } });
    nodes.push({ nodeId: `${prefix}_trend`, op: "trend", dependsOn: [`${prefix}_annual`], params: { method: "ols", uncertainty: true } });
  }
  nodes.push({ nodeId: "critic", op: "critic", dependsOn: datasets.flatMap((item) => [`${item.role}_compare`, `${item.role}_trend`]), params: {} });
  nodes.push({ nodeId: "export", op: "export", dependsOn: ["critic"], params: { outputs: spec.preferredOutputs || ["metrics_json", "yearly_csv", "story"] } });
  return nodes;
}

function criticChecks(spec: InvestigationSpec, datasets: DatasetPlanItem[]): CriticCheck[] {
  const checks: CriticCheck[] = spec.confounders.map((message, index) => ({ checkId: `confounder_${index + 1}`, severity: "warning", message, resolution: "Address this confounder in the analysis or final uncertainty section." }));
  if ((spec.period.startMonth || 1) !== 1 || (spec.period.endMonth || 12) !== 12) checks.push({ checkId: "season_alignment", severity: "warning", message: "Use the same month window in every comparison year." });
  for (const item of datasets) {
    for (const guardrail of item.dataset.guardrails || []) checks.push({ checkId: `${item.dataset.datasetId}_${guardrail.id}`, severity: guardrail.severity, message: guardrail.message, resolution: guardrail.resolution });
    if (item.dataset.startYear > spec.period.startYear || (item.dataset.endYear !== undefined && item.dataset.endYear < spec.period.endYear)) {
      checks.push({ checkId: `coverage_${item.role}`, severity: "blocking", message: `${item.dataset.title} does not cover the complete requested period for ${item.role}.`, resolution: "Shorten the period or review an alternative executable adapter." });
    }
    if (spec.constraints?.maxScaleMeters && item.dataset.scaleMeters > spec.constraints.maxScaleMeters) {
      checks.push({ checkId: `scale_${item.role}`, severity: "blocking", message: `${item.dataset.title} is coarser than the requested ${spec.constraints.maxScaleMeters} m maximum scale.`, resolution: "Relax the scale constraint or register a finer reviewed dataset." });
    }
  }
  return checks;
}

export function compileInvestigation(input: InvestigationSpec, registry: DatasetDescriptor[] = []): InvestigationPlan {
  const spec = validateInvestigationSpec(input);
  const datasets = routeDatasets(spec, registry);
  const years = spec.period.endYear - spec.period.startYear + 1;
  const areaKm2 = bboxAreaKm2(spec.region);
  const finestScale = Math.max(1, Math.min(...datasets.map((item) => item.dataset.scaleMeters)));
  const nominalPixels = areaKm2 === undefined ? undefined : Math.ceil(areaKm2 * 1_000_000 / (finestScale * finestScale));
  const requiresApproval = years * datasets.length > 24 || (nominalPixels !== undefined && nominalPixels * years * datasets.length > 100_000_000);
  const digest = createHash("sha256").update(JSON.stringify(spec)).digest("hex").slice(0, 12);
  return {
    schemaVersion: "scoutpi.earth.plan.v1", planId: `plan_${digest}_${randomUUID().slice(0, 6)}`, spec, datasets,
    dag: compileDag(spec, datasets), criticChecks: criticChecks(spec, datasets),
    estimatedCost: { years, datasetCount: datasets.length, nominalPixels, requiresApproval }, createdAt: new Date().toISOString(),
  };
}
