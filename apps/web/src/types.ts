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
  dataset: { datasetId: string; title: string; provider: string; collectionId?: string; scaleMeters: number; cadence: string; limitations: string[]; analysis: { outputName: string; metric: string; bands?: string[] } };
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
export interface EarthBackendManifest {
  schemaVersion: "scoutpi.earth.backend.v1";
  backendId: string;
  displayName: string;
  description: string;
  version: string;
  provider: string;
  capabilities: string[];
  dependencies?: Array<{ packageName: string; optional?: boolean }>;
  operations: Array<{ name: string; description: string; risk: "read" | "compute" | "artifact" | "state_change"; timeoutMs: number; requiresConfirmation?: boolean; artifactKinds?: string[] }>;
}
export interface EarthBackendProbe { backendId: string; available: boolean; version?: string; reason?: string; checkedAt: string }
export interface RuntimeTelemetrySummary {
  schemaVersion: "scoutpi.runtime.telemetry-summary.v1";
  eventCount: number;
  since?: string;
  until?: string;
  calls: { backend: number; piTool: number; workflow: number };
  failures: number;
  elapsedMs: number;
  bytes: { input: number; output: number; artifacts: number };
  estimatedTokens: { input: number; output: number; total: number };
  cache: { hits: number; misses: number; hitRate?: number };
  cost: { nominalPixels: number; pixelYears: number; estimatedRasterBytes: number; remoteTasks: number };
  byOperation: Array<{ operation: string; calls: number; failures: number; elapsedMs: number; outputEstimatedTokens: number }>;
}
export interface RuntimeApproval { approvalId: string; toolCallId: string; operation: string; risk: "medium" | "high"; approvedAt: string; expiresAt: string; state: "pending" | "consumed"; summary: string; adapterFingerprints: string[] }
export interface AgentRunSummary {
  runId: string; sessionId: string; state: "running" | "completed" | "interrupted"; startedAt: string; completedAt?: string; durationMs?: number; model?: string;
  promptHash: string; promptChars: number; turns: number; toolCalls: number; failedToolCalls: number; approvalCount: number;
  modelUsage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; totalTokens: number; reportedCostUsd: number };
}
export interface AgentCheckpointSummary {
  checkpointId: string; sessionId: string; revision: number; state: "idle" | "running" | "tool_running" | "paused" | "settled" | "failed";
  reason?: string; createdAt: string; updatedAt: string; resumeCount: number; turnIndex?: number;
  references: Array<{ kind: "investigation" | "plan" | "job" | "workflow" | "replay" | "recipe" | "approval" | "artifact"; id: string; source: string }>;
  runtime: { model?: string; contextTokens?: number; contextWindow?: number; contextPercent?: number };
  recovery: { recoverable: boolean; nextAction?: string; injectedAt?: string };
}
export interface ContextPackSummary {
  packId: string; sessionId: string; queryHash: string; createdAt: string; sourceProviders: string[]; detectedMemoryTools: string[];
  providers: Array<{ providerId: string; displayName: string; transport: "process" | "http" | "file"; state: "ready" | "unavailable" | "failed"; capabilities: Array<"query" | "writeback">; checkedAt: string; latencyMs: number; sourceLatencyMs?: number; processMode?: "persistent" | "one_shot"; workerReused?: boolean; itemCount: number; errorCode?: string }>;
  budget: { estimator: string; maxTokens: number; deliveredTokens: number; candidateCount: number; selectedCount: number; truncated: boolean };
  items: Array<{ candidateId: string; kind: string; text: string; confidence: number; trust: string; provenance: { providerId: string; sourceId: string }; estimatedTokens: number; truncated: boolean }>;
}
export interface ContextWritebackSummary {
  writebackId: string; sessionId: string; state: "pending" | "approved" | "rejected"; createdAt: string; decidedAt?: string; approvalId?: string; approvedBy?: "user"; providerTargets: string[]; payloadSha256: string;
  candidates: Array<{ candidateId: string; kind: string; text: string; confidence: number; tags: string[] }>;
  deliveries?: Array<{ deliveryId: string; providerId: string; state: "staged" | "delivered" | "failed"; stagedAt: string; updatedAt: string; attemptCount: number; errorCode?: string; receipt?: { itemCount: number; duplicateCount: number; latencyMs: number } }>;
}
export interface BrowserEvidenceRecord {
  schemaVersion: "scoutpi.browser.evidence.v1";
  evidenceId: string;
  source: { url: string; title: string; capturedAt: string; sourceType: "local_ui" | "public_webpage" | "docs" | "dataset_page"; trust: "high" | "medium" | "low" };
  claim: { text: string; timeReferences: string[]; placeReferences: string[] };
  browser: { commandId?: string; runId?: string; snapshotId?: string };
  binding?: { investigationId: string; claimId: string; hypothesisId?: string; relation: "supports" | "contradicts" | "contextualizes" | "documents" };
  excerpt?: string;
  artifacts: Array<{ artifactId: string; kind: "screenshot" | "content"; path: string; sha256: string; bytes: number; mediaType: string }>;
  provenance: { importedAt: string; adapter: string; sourcePathHash: string; sourceFingerprint: string };
  integrity: { payloadSha256: string };
}
export interface EvidenceGraph {
  schemaVersion: "scoutpi.evidence-graph.v1"; graphId: string; investigationId: string; updatedAt: string;
  nodes: Array<{ nodeId: string; kind: "browser_evidence" | "claim" | "hypothesis" | "computed_run" | "finding"; label: string; status?: string; ref?: string; metadata?: Record<string, string | number | boolean | undefined> }>;
  edges: Array<{ edgeId: string; from: string; to: string; relation: string }>;
  coverage: { browserEvidence: number; claims: number; computedRuns: number; hypotheses: number; coveredHypotheses: number; uncoveredHypothesisIds: string[] };
}
export interface EvidenceReviewReport {
  schemaVersion: "scoutpi.evidence-review.v1"; reviewId: string; investigationId: string; planId: string; reviewedAt: string; status: "passed" | "warning" | "blocked";
  summary: { blocking: number; warnings: number; info: number; claims: number; findings: number; referencedJobs: number; completedLiveJobs: number; supportingSources: number; contradictingSources: number };
  issues: Array<{ issueId: string; code: string; severity: "info" | "warning" | "blocking"; message: string; resolution: string; refs: { claimId?: string; hypothesisId?: string; jobId?: string; datasetId?: string; metricId?: string } }>;
  provenance: { storySha256: string; evidenceIds: string[]; jobIds: string[] };
}
export interface ScoutPiMcpProfile {
  schemaVersion: "scoutpi.mcp-profile.v1";
  name: string;
  version: string;
  transport: "stdio";
  tools: string[];
  resources: string[];
  blockedOperations: string[];
  modelSurface: "external_only";
}
export interface PiEcosystemProfile {
  schemaVersion: "scoutpi.pi-ecosystem-profile.v1";
  generatedAt: string;
  officialCatalogUrl: "https://pi.dev/packages?type=extension";
  packageCommands: string[];
  toolCount: number;
  commandCount: number;
  detectedCount: number;
  capabilities: Array<{ id: string; label: string; detected: boolean; tools: string[]; commands: string[]; sources: string[]; catalogQuery: string; catalogUrl: string; operatorAction: string; reuse: string; scoutPiBoundary: string }>;
  routing: Array<{ task: string; preferred: string; fallback: string }>;
}
export interface WorkflowTrigger {
  schemaVersion: "scoutpi.runtime.trigger.v1";
  triggerId: string;
  name: string;
  workflowId: string;
  state: "draft" | "active" | "paused" | "revoked";
  condition: { kind: "manual" } | { kind: "interval"; everyMinutes: number } | { kind: "event"; eventName: string };
  subject: { principalId: string; kind: "human" | "pi" | "service"; displayName: string };
  limits: { maxRuns: number; cooldownSeconds: number; expiresAt: string };
  grantId?: string;
  createdAt: string;
  updatedAt: string;
}
export interface TriggerRun {
  schemaVersion: "scoutpi.runtime.trigger-run.v1";
  runId: string; triggerId: string; workflowId: string; grantId: string; eventKey: string;
  state: "running" | "completed" | "failed" | "blocked";
  startedAt: string; updatedAt: string; replayId?: string; planId?: string; jobId?: string; error?: string;
}
export interface DelegationGrantSummary {
  schemaVersion: "scoutpi.runtime.delegation.v1";
  grantId: string; triggerId: string; workflowId: string; triggerFingerprint: string;
  issuer: { principalId: string; kind: string; displayName: string };
  subject: { principalId: string; kind: string; displayName: string };
  scopes: ["workflow:replay:dry_run"];
  issuedAt: string; expiresAt: string; maxRuns: number; usedRuns: number; state: "active" | "exhausted" | "expired" | "revoked";
}
export interface EarthWorkflowSummary {
  workflowId: string; name: string; description: string; stage: "candidate" | "ready"; revision: number; fingerprint: string; savedAt: string;
  replayCount: number; successCount: number; failureCount: number; executionKind: "run" | "local_export";
}
export interface EarthWorkflowReplay {
  schemaVersion: "scoutpi.earth.workflow-run.v1"; replayId: string; workflowId: string; workflowRevision: number;
  state: "running" | "completed" | "failed" | "cancelled" | "blocked"; planId?: string; jobId?: string; startedAt: string; updatedAt: string; error?: string;
  assertions: Array<{ kind: string; ok: boolean; message: string }>;
}
export interface EarthVisualization { planId: string; role: string; year: number; datasetId: string; outputName: string; tileUrl: string; mapId: string; legend: { min: number; max: number; palette: string[] }; generatedAt: string; cacheHit?: boolean; cacheExpiresAt?: string }
export interface SpatialViewState {
  schemaVersion: "scoutpi.spatial-view.v1";
  revision: number;
  updatedAt: string;
  mode: "2d" | "3d";
  phase: "idle" | "planning" | "observing" | "computing" | "reviewing" | "complete" | "blocked" | "failed";
  control: { source: "pi" | "operator" | "system"; operation?: string; toolCallId?: string };
  target?: { planId: string; investigationId: string; role: string; year: number; jobId?: string };
}
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
