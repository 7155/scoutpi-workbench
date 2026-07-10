export type EarthRuntimeContractName = "investigation" | "adapter" | "adapter_pack" | "skill" | "local_export";

const contracts: Record<EarthRuntimeContractName, Record<string, unknown>> = {
  investigation: {
    schemaVersion: "scoutpi.investigation.v1",
    investigationId: "lowercase-safe-id",
    question: "A testable question",
    region: { kind: "bbox", bbox: [0, 0, 1, 1], name: "Review area" },
    period: { startYear: 2020, endYear: 2024, startMonth: 1, endMonth: 12 },
    hypotheses: [{ id: "h1", statement: "A falsifiable statement", observableRoles: ["observable_role"], falsification: "Evidence that would contradict it" }],
    confounders: ["A competing explanation or comparability risk"],
    preferredOutputs: ["yearly_csv", "story"],
  },
  adapter: {
    schemaVersion: "scoutpi.earth.adapter.v1",
    datasetId: "lowercase-dataset-id",
    title: "Dataset title",
    provider: "Provider",
    collectionId: "PROVIDER/COLLECTION",
    documentationUrl: "https://primary.example/dataset",
    roles: ["observable_role"],
    startYear: 2020,
    scaleMeters: 30,
    cadence: "monthly",
    limitations: ["A required interpretation boundary"],
    analysis: {
      metric: "band_mean | band_sum | normalized_difference_mean | class_probability_mean | threshold_fraction",
      bands: ["BAND"],
      outputName: "safe_output_name",
      qualityMask: { mode: "all", rules: [{ band: "QA", op: "eq | neq | lt | lte | gt | gte | bit_clear | bit_set", value: 0, bit: 0 }] },
      visualization: { min: 0, max: 1, palette: ["f7fcf5", "238b45"] },
    },
    guardrails: [{ id: "interpretation-boundary", severity: "warning", message: "A claim this adapter cannot prove" }],
  },
  adapter_pack: {
    schemaVersion: "scoutpi.earth.adapter-pack.v1",
    packId: "lowercase-pack-id",
    title: "Adapter pack title",
    description: "Optional scope",
    adapters: ["Use one or more scoutpi.earth.adapter.v1 objects"],
  },
  skill: {
    schemaVersion: "scoutpi.earth.skill.v1",
    skillId: "lowercase-hyphenated-id",
    name: "Skill name",
    description: "When and why Pi should use this workflow",
    whenToUse: ["A concrete trigger"],
    instructions: ["A deterministic workflow step"],
    requiredAdapterIds: ["registered-adapter-id"],
    safetyNotes: ["A claim or execution boundary"],
    createdBy: "pi",
  },
  local_export: {
    role: "plan_observable_role",
    kind: "year | change",
    year: 2024,
    baselineYear: 2020,
    targetYear: 2024,
    format: "geotiff",
    scaleMeters: 100,
    crs: "EPSG:4326",
    dtype: "float32 | float64 | int16 | uint16 | uint8",
    maxPixels: 25000000,
    confirmed: false,
  },
};

export function getEarthRuntimeContract(name: string): { name: EarthRuntimeContractName; template: Record<string, unknown> } {
  if (!(name in contracts)) throw Object.assign(new Error(`CONTRACT_INVALID: expected one of ${Object.keys(contracts).join(", ")}`), { code: "CONTRACT_INVALID" });
  const key = name as EarthRuntimeContractName;
  return { name: key, template: structuredClone(contracts[key]) };
}

export function listEarthRuntimeContracts(): EarthRuntimeContractName[] {
  return Object.keys(contracts) as EarthRuntimeContractName[];
}
