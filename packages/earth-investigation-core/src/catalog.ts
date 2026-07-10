import type { DatasetAnalysis, DatasetDescriptor, EarthAdapterPack, QualityMaskRule } from "./types.ts";

function invalid(message: string): never {
  throw Object.assign(new Error(`ADAPTER_INVALID: ${message}`), { code: "ADAPTER_INVALID" });
}

function safeId(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9._-]{2,100}$/.test(value || "")) invalid(`${label} must be a lowercase safe identifier`);
}

function validateMaskRule(rule: QualityMaskRule, index: number): void {
  if (!/^[A-Za-z0-9_]{1,80}$/.test(rule.band || "")) invalid(`qualityMask rule ${index} has an invalid band`);
  if (!["eq", "neq", "lt", "lte", "gt", "gte", "bit_clear", "bit_set"].includes(rule.op)) invalid(`qualityMask rule ${index} has an unsupported op`);
  if (rule.op.startsWith("bit_") && (!Number.isInteger(rule.bit) || (rule.bit ?? -1) < 0 || (rule.bit ?? 64) > 63)) invalid(`qualityMask rule ${index} needs bit 0-63`);
  if (!rule.op.startsWith("bit_") && !Number.isFinite(rule.value)) invalid(`qualityMask rule ${index} needs a finite value`);
}

function validateAnalysis(analysis: DatasetAnalysis, label: string): void {
  const metrics = ["normalized_difference_mean", "band_mean", "band_sum", "class_probability_mean", "threshold_fraction"];
  if (!metrics.includes(analysis?.metric)) invalid(`${label} has an unsupported metric`);
  if (!Array.isArray(analysis.bands) || analysis.bands.length === 0 || analysis.bands.length > 8 || analysis.bands.some((band) => !/^[A-Za-z0-9_]{1,80}$/.test(band))) invalid(`${label} needs 1-8 safe band names`);
  if (analysis.metric === "normalized_difference_mean" && analysis.bands.length < 2) invalid(`${label} normalized difference needs two bands`);
  if (!/^[A-Za-z][A-Za-z0-9_]{1,80}$/.test(analysis.outputName || "")) invalid(`${label} has an invalid outputName`);
  if (analysis.qualityMask) {
    if (analysis.qualityMask.mode !== "all" || !analysis.qualityMask.rules.length || analysis.qualityMask.rules.length > 16) invalid(`${label} qualityMask must contain 1-16 all-mode rules`);
    analysis.qualityMask.rules.forEach(validateMaskRule);
  }
  if (analysis.visualization) {
    if (!Number.isFinite(analysis.visualization.min) || !Number.isFinite(analysis.visualization.max) || analysis.visualization.min >= analysis.visualization.max) invalid(`${label} visualization range is invalid`);
    if (!Array.isArray(analysis.visualization.palette) || analysis.visualization.palette.length < 2 || analysis.visualization.palette.length > 16 || analysis.visualization.palette.some((color) => !/^[0-9a-fA-F]{6}$/.test(color))) invalid(`${label} visualization palette must contain 2-16 hex colors without #`);
  }
}

export function validateDatasetDescriptor(input: DatasetDescriptor): DatasetDescriptor {
  const adapter = structuredClone(input);
  if (adapter.schemaVersion !== "scoutpi.earth.adapter.v1") invalid("unsupported schemaVersion");
  safeId(adapter.datasetId, "datasetId");
  if (!adapter.title?.trim() || adapter.title.length > 200 || !adapter.provider?.trim() || adapter.provider.length > 120) invalid("title and provider are required and must be concise");
  if (adapter.description && adapter.description.length > 1000) invalid("description exceeds 1000 characters");
  if (adapter.documentationUrl) {
    try {
      const url = new URL(adapter.documentationUrl);
      if (!["http:", "https:"].includes(url.protocol)) invalid("documentationUrl must use http or https");
    } catch { invalid("documentationUrl is invalid"); }
  }
  if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(adapter.collectionId || "")) invalid("collectionId is not a valid Earth Engine asset path");
  if (!Array.isArray(adapter.roles) || !adapter.roles.length || adapter.roles.length > 24 || adapter.roles.some((role) => !/^[a-z][a-z0-9_]{1,63}$/.test(role))) invalid("roles must contain 1-24 safe observable identifiers");
  if (new Set(adapter.roles).size !== adapter.roles.length) invalid("roles must be unique");
  if (!Number.isInteger(adapter.startYear) || adapter.startYear < 1950 || (adapter.endYear !== undefined && (!Number.isInteger(adapter.endYear) || adapter.endYear < adapter.startYear))) invalid("temporal coverage is invalid");
  if (!Number.isFinite(adapter.scaleMeters) || adapter.scaleMeters <= 0 || adapter.scaleMeters > 100_000) invalid("scaleMeters is invalid");
  if (!adapter.cadence?.trim() || adapter.cadence.length > 120 || !Array.isArray(adapter.limitations) || !adapter.limitations.length || adapter.limitations.length > 24 || adapter.limitations.some((value) => typeof value !== "string" || !value.trim() || value.length > 500)) invalid("cadence and 1-24 concise limitations are required");
  validateAnalysis(adapter.analysis, `${adapter.datasetId}.analysis`);
  for (const [role, analysis] of Object.entries(adapter.analysisByRole || {})) {
    if (!adapter.roles.includes(role)) invalid(`${adapter.datasetId}.analysisByRole contains undeclared role ${role}`);
    validateAnalysis(analysis, `${adapter.datasetId}.analysisByRole.${role}`);
  }
  if ((adapter.guardrails || []).length > 24) invalid("an adapter supports at most 24 guardrails");
  for (const guardrail of adapter.guardrails || []) {
    safeId(guardrail.id, "guardrail id");
    if (!["info", "warning", "blocking"].includes(guardrail.severity) || !guardrail.message?.trim() || guardrail.message.length > 500 || (guardrail.resolution?.length || 0) > 500) invalid(`${adapter.datasetId} has an invalid guardrail`);
  }
  return adapter;
}

export function validateAdapterPack(input: EarthAdapterPack): EarthAdapterPack {
  if (input?.schemaVersion !== "scoutpi.earth.adapter-pack.v1") invalid("unsupported adapter pack schemaVersion");
  safeId(input.packId, "packId");
  if (!input.title?.trim() || !Array.isArray(input.adapters) || !input.adapters.length || input.adapters.length > 100) invalid("adapter pack needs a title and 1-100 adapters");
  const adapters = input.adapters.map(validateDatasetDescriptor);
  if (new Set(adapters.map((adapter) => adapter.datasetId)).size !== adapters.length) invalid("adapter pack contains duplicate datasetId values");
  return { ...structuredClone(input), adapters };
}

export function searchCatalog(adapters: DatasetDescriptor[], query: string, role?: string, year?: number, limit = 8): DatasetDescriptor[] {
  const tokens = `${query} ${role ?? ""}`.toLowerCase().split(/[^a-z0-9\u3400-\u9fff]+/).filter(Boolean);
  return adapters.map((dataset) => {
    const text = `${dataset.datasetId} ${dataset.title} ${dataset.description || ""} ${dataset.provider} ${dataset.roles.join(" ")} ${dataset.limitations.join(" ")}`.toLowerCase();
    const score = tokens.reduce((sum, token) => sum + (text.includes(token) ? 2 : 0), 0) + (role && dataset.roles.includes(role) ? 8 : 0);
    const coversYear = year === undefined || (dataset.startYear <= year && (dataset.endYear === undefined || dataset.endYear >= year));
    return { dataset, score: coversYear ? score : score - 20 };
  }).filter((row) => row.score > 0).sort((a, b) => b.score - a.score || a.dataset.scaleMeters - b.dataset.scaleMeters).slice(0, Math.max(1, Math.min(20, limit))).map((row) => row.dataset);
}
