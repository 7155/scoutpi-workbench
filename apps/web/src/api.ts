import type { AgentRunSummary, EarthBackendManifest, EarthBackendProbe, EarthJob, EarthSkillSummary, EarthStory, EarthVisualization, EarthWorkflowReplay, EarthWorkflowSummary, EnvironmentStatus, InvestigationPlan, InvestigationSpec, JobArtifact, RecipeSummary, RegisteredAdapter, RuntimeApproval, RuntimeTelemetrySummary } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `${response.status} ${response.statusText}`);
  return body as T;
}

export const api = {
  environment: () => request<EnvironmentStatus>("/api/environment"),
  backends: async () => (await request<{ backends: EarthBackendManifest[] }>("/api/backends")).backends,
  probeBackend: (backendId: string) => request<EarthBackendProbe>(`/api/backends/${encodeURIComponent(backendId)}/probe`, { method: "POST", body: "{}" }),
  telemetry: () => request<RuntimeTelemetrySummary>("/api/telemetry"),
  approvals: async () => (await request<{ approvals: RuntimeApproval[] }>("/api/approvals?limit=100")).approvals,
  agentRuns: async () => (await request<{ runs: AgentRunSummary[] }>("/api/agent-runs?limit=100")).runs,
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
