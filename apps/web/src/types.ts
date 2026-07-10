export interface RegionSpec { kind: "bbox" | "geojson" | "asset"; bbox?: [number, number, number, number]; geometry?: Record<string, unknown>; assetId?: string; name?: string }
export interface Hypothesis { id: string; statement: string; observableRoles: string[]; falsification?: string }
export interface EvidenceClaim { claimId: string; claim: string; sourceUrl: string; time?: string; location?: string; trust?: string }
export interface InvestigationSpec {
  schemaVersion: "scoutpi.investigation.v1";
  investigationId: string;
  question: string;
  phenomenon?: string;
  region: RegionSpec;
  period: { startYear: number; endYear: number; startMonth?: number; endMonth?: number };
  hypotheses: Hypothesis[];
  confounders: string[];
  claims?: EvidenceClaim[];
  preferredOutputs?: string[];
}
export interface DatasetPlanItem {
  role: string;
  reason: string;
  hypothesisIds: string[];
  dataset: { datasetId: string; title: string; provider: string; scaleMeters: number; cadence: string; limitations: string[]; analysis: { outputName: string; metric: string } };
  adapterBinding?: { datasetId: string; revision: number; fingerprint: string; verificationStatus: "not_run" | "passed" | "failed" };
}
export interface AnalysisNode { nodeId: string; op: string; dependsOn: string[]; params: Record<string, unknown> }
export interface CriticCheck { checkId: string; severity: "info" | "warning" | "blocking"; message: string; resolution?: string }
export interface InvestigationPlan {
  planId: string; spec: InvestigationSpec; datasets: DatasetPlanItem[]; dag: AnalysisNode[]; criticChecks: CriticCheck[];
  estimatedCost: { years: number; datasetCount: number; nominalPixels?: number; requiresApproval: boolean }; createdAt: string;
}
export type EarthJobState = "queued" | "running" | "completed" | "failed" | "cancelled" | "blocked_auth";
export interface EarthJob { jobId: string; planId: string; mode: "dry_run" | "live"; state: EarthJobState; createdAt: string; updatedAt: string; taskIds: string[]; artifactDir: string; error?: string; result?: Record<string, unknown> }
export interface JobArtifact { name: string; path: string; size: number; kind: string }
export interface RecipeSummary { recipeId: string; name: string; savedAt: string }
export interface EarthStory { investigationId: string; question: string; claims: EvidenceClaim[]; findings: Array<{ hypothesisId: string; status: "supported" | "mixed" | "not_supported" | "unknown"; evidence: string[] }>; metrics: Record<string, unknown>; layers: Array<Record<string, unknown>>; charts: Array<Record<string, unknown>>; uncertainties: string[]; provenance: Record<string, unknown> }
export interface RuntimeBackend { id: string; installed: boolean; version?: string; purpose: string }
export interface EnvironmentStatus { installed?: boolean; authenticated?: boolean; earthengineVersion?: string; project?: string; code?: string; message?: string; backends?: RuntimeBackend[] }
export interface EarthVisualization { planId: string; role: string; year: number; datasetId: string; outputName: string; tileUrl: string; mapId: string; legend: { min: number; max: number; palette: string[] }; generatedAt: string; cacheHit?: boolean; cacheExpiresAt?: string }
export interface RegisteredAdapter {
  adapter: { datasetId: string; title: string; provider: string; collectionId: string; roles: string[]; scaleMeters: number; documentationUrl?: string };
  revision: number;
  fingerprint: string;
  registeredAt: string;
  source: string;
  enabled: boolean;
  verification: { status: "not_run" | "passed" | "failed"; checkedAt?: string; sampleCount?: number; availableBands?: string[]; requestedBands?: string[]; outputBands?: string[]; sampleTime?: string; error?: string };
}
export interface EarthSkillSummary { skillId: string; name: string; description: string; requiredAdapterIds: string[]; savedAt: string }
