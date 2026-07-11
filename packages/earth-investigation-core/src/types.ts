export type RegionSpec =
  | { kind: "bbox"; bbox: [number, number, number, number]; name?: string }
  | { kind: "geojson"; geometry: Record<string, unknown>; name?: string }
  | { kind: "asset"; assetId: string; name?: string };

export interface InvestigationSpec {
  schemaVersion: "scoutpi.investigation.v1";
  investigationId: string;
  question: string;
  phenomenon?: string;
  region: RegionSpec;
  period: { startYear: number; endYear: number; startMonth?: number; endMonth?: number };
  hypotheses: Array<{ id: string; statement: string; observableRoles: string[]; falsification?: string }>;
  confounders: string[];
  claims?: EvidenceClaim[];
  preferredOutputs?: string[];
  constraints?: {
    maxScaleMeters?: number;
    maxYears?: number;
    comparisonSeason?: string;
    controlRegion?: RegionSpec;
    preferredAdapterIds?: string[];
    impactAssessment?: ImpactAssessmentSpec;
  };
}

export interface ImpactAssessmentSpec {
  hazardRole: string;
  exposureRole: string;
  hazardChangeThreshold: number;
  hazardComparison: "lte" | "gte";
  exposureThreshold: number;
  exposureComparison: "lte" | "gte";
  scaleMeters?: number;
  unit?: "hectares";
  baselineWindow?: { start: string; end: string };
  targetWindow?: { start: string; end: string };
}

export interface EvidenceClaim {
  claimId: string;
  claim: string;
  sourceUrl: string;
  time?: string;
  location?: string;
  evidenceArtifact?: string;
  trust?: "primary" | "secondary" | "unknown";
}

export type MetricKind = "normalized_difference_mean" | "band_mean" | "band_sum" | "class_probability_mean" | "threshold_fraction";

export interface QualityMaskRule {
  band: string;
  op: "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "bit_clear" | "bit_set";
  value?: number;
  bit?: number;
}

export interface DatasetAnalysis {
  metric: MetricKind;
  bands: string[];
  outputName: string;
  qualityMask?: { mode: "all"; rules: QualityMaskRule[] };
  scaleFactor?: number;
  offset?: number;
  threshold?: number;
  comparison?: "gte" | "eq";
  visualization?: {
    min: number;
    max: number;
    palette: string[];
  };
}

export interface DatasetDescriptor {
  schemaVersion: "scoutpi.earth.adapter.v1";
  datasetId: string;
  title: string;
  description?: string;
  provider: string;
  collectionId: string;
  documentationUrl?: string;
  roles: string[];
  startYear: number;
  endYear?: number;
  scaleMeters: number;
  cadence: string;
  limitations: string[];
  analysis: DatasetAnalysis;
  analysisByRole?: Record<string, DatasetAnalysis>;
  guardrails?: Array<{
    id: string;
    severity: "info" | "warning" | "blocking";
    message: string;
    resolution?: string;
    claimRule?: { forbiddenTerms: string[]; requiredQualifiers?: string[] };
  }>;
}

export interface EarthAdapterPack {
  schemaVersion: "scoutpi.earth.adapter-pack.v1";
  packId: string;
  title: string;
  description?: string;
  adapters: DatasetDescriptor[];
}

export type AdapterVerificationStatus = "not_run" | "passed" | "failed";

export interface AdapterVerification {
  status: AdapterVerificationStatus;
  checkedAt?: string;
  sampleCount?: number;
  availableBands?: string[];
  requestedBands?: string[];
  outputBands?: string[];
  sampleTime?: string;
  error?: string;
}

export interface AdapterBinding {
  datasetId: string;
  revision: number;
  fingerprint: string;
  verificationStatus: AdapterVerificationStatus;
}

export interface EarthSkillDefinition {
  schemaVersion: "scoutpi.earth.skill.v1";
  skillId: string;
  name: string;
  description: string;
  whenToUse: string[];
  instructions: string[];
  requiredAdapterIds?: string[];
  safetyNotes?: string[];
  createdBy?: "pi" | "human";
}

export interface DatasetPlanItem {
  role: string;
  dataset: DatasetDescriptor;
  reason: string;
  hypothesisIds: string[];
  alternatives: string[];
  adapterBinding?: AdapterBinding;
}

export interface AnalysisNode {
  nodeId: string;
  op: "source" | "filter_region" | "filter_time" | "quality_mask" | "annual_metric" | "compare" | "trend" | "impact_overlap" | "export" | "critic";
  dependsOn: string[];
  params: Record<string, unknown>;
}

export interface InvestigationPlan {
  schemaVersion: "scoutpi.earth.plan.v1";
  planId: string;
  spec: InvestigationSpec;
  datasets: DatasetPlanItem[];
  dag: AnalysisNode[];
  criticChecks: CriticCheck[];
  estimatedCost: { years: number; datasetCount: number; nominalPixels?: number; requiresApproval: boolean };
  createdAt: string;
}

export interface CriticCheck {
  checkId: string;
  severity: "info" | "warning" | "blocking";
  message: string;
  resolution?: string;
}

export interface EarthJob {
  jobId: string;
  planId: string;
  mode: "dry_run" | "live";
  state: "queued" | "running" | "completed" | "failed" | "cancelled" | "blocked_auth";
  createdAt: string;
  updatedAt: string;
  taskIds: string[];
  artifactDir: string;
  error?: string;
  result?: Record<string, unknown>;
}

export interface EarthStoryArtifact {
  schemaVersion: "scoutpi.earth.story.v1";
  investigationId: string;
  question: string;
  claims: EvidenceClaim[];
  findings: Array<{ hypothesisId: string; status: "supported" | "mixed" | "not_supported" | "unknown"; evidence: string[] }>;
  metrics: Record<string, unknown>;
  layers: Array<Record<string, unknown>>;
  charts: Array<Record<string, unknown>>;
  uncertainties: string[];
  provenance: Record<string, unknown>;
}

export interface EarthVisualization {
  planId: string;
  role: string;
  year: number;
  datasetId: string;
  outputName: string;
  tileUrl: string;
  mapId: string;
  legend: { min: number; max: number; palette: string[] };
  generatedAt: string;
  cacheHit?: boolean;
  cacheExpiresAt?: string;
}

export type SpatialViewMode = "2d" | "3d";

export type SpatialViewPhase =
  | "idle"
  | "planning"
  | "observing"
  | "computing"
  | "reviewing"
  | "complete"
  | "blocked"
  | "failed";

export interface SpatialViewState {
  schemaVersion: "scoutpi.spatial-view.v1";
  revision: number;
  updatedAt: string;
  mode: SpatialViewMode;
  phase: SpatialViewPhase;
  control: {
    source: "pi" | "operator" | "system";
    operation?: string;
    toolCallId?: string;
  };
  target?: {
    planId: string;
    investigationId: string;
    role: string;
    year: number;
    jobId?: string;
  };
}

export interface SpatialViewUpdate {
  source: "pi" | "operator" | "system";
  planId: string;
  role?: string;
  year?: number;
  mode?: SpatialViewMode;
  phase?: SpatialViewPhase;
  operation?: string;
  toolCallId?: string;
  jobId?: string;
}

export interface EarthLocalExportRequest {
  role: string;
  kind: "year" | "change";
  year?: number;
  baselineYear?: number;
  targetYear?: number;
  format?: "geotiff";
  scaleMeters?: number;
  crs?: string;
  dtype?: "float32" | "float64" | "int16" | "uint16" | "uint8";
  maxPixels?: number;
  cloudProject?: string;
  confirmed?: boolean;
}
