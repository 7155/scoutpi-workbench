import type { AgentCheckpointSummary, AgentRunSummary, BrowserEvidenceRecord, ContextPackSummary, ContextWritebackSummary, DelegationGrantSummary, EarthBackendManifest, EarthBackendProbe, EarthJob, EarthSkillSummary, EarthStory, EarthVisualization, EarthWorkflowReplay, EarthWorkflowSummary, EnvironmentStatus, EvidenceGraph, EvidenceReviewReport, InvestigationPlan, InvestigationSpec, JobArtifact, PiEcosystemProfile, RecipeSummary, RegisteredAdapter, RuntimeApproval, RuntimeTelemetrySummary, ScoutPiMcpProfile, TriggerRun, WorkflowTrigger } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `${response.status} ${response.statusText}`);
  return body as T;
}

export const api = {
  environment: () => request<EnvironmentStatus>("/api/environment"),
  mcp: () => request<ScoutPiMcpProfile>("/api/mcp"),
  piEcosystem: async () => (await request<{ profile?: PiEcosystemProfile }>("/api/pi-ecosystem")).profile,
  triggers: async () => (await request<{ triggers: WorkflowTrigger[] }>("/api/triggers")).triggers,
  triggerRuns: async () => (await request<{ runs: TriggerRun[] }>("/api/trigger-runs?limit=100")).runs,
  delegations: async () => (await request<{ grants: DelegationGrantSummary[] }>("/api/delegations?limit=100")).grants,
  createTrigger: (input: Record<string, unknown>) => request<WorkflowTrigger>("/api/triggers", { method: "POST", body: JSON.stringify(input) }),
  approveTrigger: (triggerId: string) => request<{ trigger: WorkflowTrigger; grant: DelegationGrantSummary }>(`/api/triggers/${encodeURIComponent(triggerId)}/approve`, { method: "POST", body: "{}" }),
  setTriggerState: (triggerId: string, state: "paused" | "active" | "revoked") => request<WorkflowTrigger>(`/api/triggers/${encodeURIComponent(triggerId)}/state`, { method: "POST", body: JSON.stringify({ state }) }),
  invokeTrigger: (triggerId: string, idempotencyKey: string) => request<{ run: TriggerRun; deduplicated: boolean }>(`/api/triggers/${encodeURIComponent(triggerId)}/invoke`, { method: "POST", body: JSON.stringify({ idempotencyKey }) }),
  backends: async () => (await request<{ backends: EarthBackendManifest[] }>("/api/backends")).backends,
  probeBackend: (backendId: string) => request<EarthBackendProbe>(`/api/backends/${encodeURIComponent(backendId)}/probe`, { method: "POST", body: "{}" }),
  telemetry: () => request<RuntimeTelemetrySummary>("/api/telemetry"),
  approvals: async () => (await request<{ approvals: RuntimeApproval[] }>("/api/approvals?limit=100")).approvals,
  agentRuns: async () => (await request<{ runs: AgentRunSummary[] }>("/api/agent-runs?limit=100")).runs,
  checkpoints: async () => (await request<{ checkpoints: AgentCheckpointSummary[] }>("/api/checkpoints?limit=100")).checkpoints,
  contextPacks: async () => (await request<{ packs: ContextPackSummary[] }>("/api/context/packs?limit=100")).packs,
  contextWritebacks: async () => (await request<{ writebacks: ContextWritebackSummary[] }>("/api/context/writebacks?limit=100")).writebacks,
  evidence: async (investigationId?: string) => (await request<{ evidence: BrowserEvidenceRecord[] }>(`/api/evidence?limit=200${investigationId ? `&investigationId=${encodeURIComponent(investigationId)}` : ""}`)).evidence,
  evidenceGraph: (investigationId: string) => request<EvidenceGraph>(`/api/evidence/graph/${encodeURIComponent(investigationId)}`),
  evidenceReview: (investigationId: string) => request<EvidenceReviewReport>(`/api/evidence/review/${encodeURIComponent(investigationId)}`),
  contract: (name: string) => request<{ name: string; template: Record<string, unknown> }>(`/api/contracts/${encodeURIComponent(name)}`),
  adapters: async () => (await request<{ adapters: RegisteredAdapter[] }>("/api/adapters")).adapters,
  importRegistry: (payload: Record<string, unknown>) => payload.schemaVersion === "scoutpi.earth.adapter-pack.v1"
    ? request<Record<string, unknown>>("/api/adapter-packs", { method: "POST", body: JSON.stringify({ pack: payload, source: "human" }) })
    : request<Record<string, unknown>>("/api/adapters", { method: "POST", body: JSON.stringify({ adapter: payload, source: "human" }) }),
  probeAdapter: (datasetId: string) => request<RegisteredAdapter>(`/api/adapters/${encodeURIComponent(datasetId)}/probe`, { method: "POST", body: "{}" }),
  setAdapterEnabled: (datasetId: string, enabled: boolean) => request<RegisteredAdapter>(`/api/adapters/${encodeURIComponent(datasetId)}/state`, { method: "POST", body: JSON.stringify({ enabled }) }),
  skills: async () => (await request<{ skills: EarthSkillSummary[] }>("/api/skills")).skills,
  saveSkill: (skill: Record<string, unknown>) => request<Record<string, unknown>>("/api/skills", { method: "POST", body: JSON.stringify(skill) }),
  publishSkill: (skillId: string) => request<{ skillId: string; path: string; reloadRequired: true }>(`/api/skills/${encodeURIComponent(skillId)}/publish`, { method: "POST", body: JSON.stringify({ confirmed: true }) }),
  plans: async () => (await request<{ plans: InvestigationPlan[] }>("/api/plans")).plans,
  plan: (id: string) => request<InvestigationPlan>(`/api/plans/${encodeURIComponent(id)}`),
  createPlan: (spec: InvestigationSpec) => request<{ plan: InvestigationPlan; path: string }>("/api/plans", { method: "POST", body: JSON.stringify({ spec }) }),
  jobs: async () => (await request<{ jobs: EarthJob[] }>("/api/jobs")).jobs,
  run: (planId: string, options: Record<string, unknown>) => request<EarthJob>(`/api/plans/${encodeURIComponent(planId)}/run`, { method: "POST", body: JSON.stringify(options) }),
  exportLocal: (planId: string, options: Record<string, unknown>) => request<EarthJob>(`/api/plans/${encodeURIComponent(planId)}/export-local`, { method: "POST", body: JSON.stringify(options) }),
  visualization: (planId: string, role: string, year: number) => request<EarthVisualization>(`/api/plans/${encodeURIComponent(planId)}/visualization?role=${encodeURIComponent(role)}&year=${year}`),
  job: (id: string, refresh = false) => request<EarthJob>(`/api/jobs/${encodeURIComponent(id)}?refresh=${refresh}`),
  cancelJob: (id: string) => request<EarthJob>(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST", body: "{}" }),
  retryJob: (id: string) => request<EarthJob>(`/api/jobs/${encodeURIComponent(id)}/retry`, { method: "POST", body: JSON.stringify({ confirmed: true }) }),
  artifacts: async (id: string) => (await request<{ artifacts: JobArtifact[] }>(`/api/jobs/${encodeURIComponent(id)}/artifacts`)).artifacts,
  artifactUrl: (jobId: string, name: string) => `/api/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(name)}`,
  recipes: async () => (await request<{ recipes: RecipeSummary[] }>("/api/recipes")).recipes,
  saveRecipe: (recipe: { recipeId: string; name: string; spec: InvestigationSpec }) => request<Record<string, unknown>>("/api/recipes", { method: "POST", body: JSON.stringify(recipe) }),
  instantiateRecipe: (recipeId: string, patch: Partial<InvestigationSpec>) => request<{ plan: InvestigationPlan; path: string }>(`/api/recipes/${encodeURIComponent(recipeId)}/instantiate`, { method: "POST", body: JSON.stringify({ patch }) }),
  workflows: async () => (await request<{ workflows: EarthWorkflowSummary[] }>("/api/workflows")).workflows,
  compileWorkflow: (input: { workflowId: string; name: string; description?: string; planId: string; jobId?: string; confirmedBlockingChecks?: boolean; stage?: "candidate" | "ready" }) => request<{ stored: { workflow: { workflowId: string }; revision: number; fingerprint: string; stage: "candidate" | "ready" }; path: string }>("/api/workflows/compile", { method: "POST", body: JSON.stringify(input) }),
  replayWorkflow: (workflowId: string, input: { patch?: Partial<InvestigationSpec>; confirmed?: boolean; confirmedCostIncrease?: boolean }) => request<{ replay: EarthWorkflowReplay; plan?: InvestigationPlan; job?: EarthJob }>(`/api/workflows/${encodeURIComponent(workflowId)}/replay`, { method: "POST", body: JSON.stringify(input) }),
  workflowRuns: async () => (await request<{ runs: EarthWorkflowReplay[] }>("/api/workflow-runs")).runs,
  workflowRun: (replayId: string) => request<EarthWorkflowReplay>(`/api/workflow-runs/${encodeURIComponent(replayId)}`),
  stories: async () => (await request<{ stories: EarthStory[] }>("/api/stories")).stories,
};
