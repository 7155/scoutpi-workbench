<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark"><Orbit :size="20" /></div>
        <div><strong>ScoutPi Earth</strong><span>Investigation Workbench</span></div>
      </div>
      <div class="top-context" v-if="selectedPlan">
        <span>{{ selectedPlan.spec.region.name || selectedPlan.spec.investigationId }}</span>
        <ChevronRight :size="14" />
        <strong>{{ selectedPlan.spec.period.startYear }}-{{ selectedPlan.spec.period.endYear }}</strong>
      </div>
      <div class="top-actions">
        <span :class="['environment-pill', environment.authenticated ? 'ready' : 'offline']"><span></span>{{ environment.authenticated ? 'GEE ready' : 'Dry-run mode' }}</span>
        <button class="icon-button mobile-only" title="Investigations" @click="showSidebar = !showSidebar"><PanelLeft :size="18" /></button>
        <button class="icon-button" title="Refresh workspace" :disabled="loading" @click="refresh"><RefreshCw :class="{ spin: loading }" :size="17" /></button>
        <button class="icon-button" title="Investigation recipes" @click="recipeDialog = true"><BookOpen :size="17" /></button>
        <button class="icon-button" :title="geedimReady ? 'Export selected layer' : 'Install the pipeline extra to export GeoTIFF'" :disabled="!selectedPlan || !environment.authenticated || !geedimReady" @click="exportDialog = true"><Download :size="17" /></button>
        <button class="secondary" :disabled="!selectedPlan || running" @click="runPlan('dry_run')"><FlaskConical :size="16" />Dry run</button>
        <button class="primary" :disabled="!selectedPlan || running || !environment.authenticated" @click="runPlan('live')"><Play :size="16" />Run live</button>
      </div>
    </header>

    <aside :class="['sidebar', { open: showSidebar }]">
      <div class="sidebar-head">
        <div><span>Workspace</span><strong>Investigations</strong></div>
        <button class="icon-button primary-icon" title="New investigation" @click="newDialog = true"><Plus :size="18" /></button>
      </div>
      <label class="search-box"><Search :size="15" /><input v-model="search" placeholder="Search investigations"></label>
      <div class="plan-list">
        <button v-for="plan in filteredPlans" :key="plan.planId" :class="['plan-item', { active: plan.planId === selectedPlanId }]" @click="selectPlan(plan.planId)">
          <span class="plan-state" :class="latestJob(plan.planId)?.state || 'draft'"></span>
          <span class="plan-copy"><strong>{{ plan.spec.region.name || plan.spec.investigationId }}</strong><small>{{ plan.spec.question }}</small></span>
          <span class="plan-years">{{ plan.spec.period.startYear }}-{{ plan.spec.period.endYear }}</span>
        </button>
        <div v-if="!filteredPlans.length" class="sidebar-empty"><FolderSearch :size="26" /><span>No investigations</span></div>
      </div>
      <div class="environment-block">
        <div><Server :size="15" /><span>Earth runtime</span><strong>{{ environment.installed ? environment.earthengineVersion || 'installed' : 'missing' }}</strong></div>
        <div><KeyRound :size="15" /><span>Authentication</span><strong>{{ environment.authenticated ? 'connected' : 'required for live' }}</strong></div>
        <div><Database :size="15" /><span>Plans / runs</span><strong>{{ plans.length }} / {{ jobs.length }}</strong></div>
        <button title="Runtime registry" @click="registryDialog = true"><Blocks :size="15" /><span>Tool registry</span><strong>{{ adapters.length }} / {{ skills.length }}</strong></button>
      </div>
    </aside>

    <main class="workspace">
      <template v-if="selectedPlan">
        <div class="map-region"><InvestigationMap :plan="selectedPlan" :selected-year="selectedYear" :selected-role="selectedRole" :visualization="visualization" :visualization-loading="visualizationLoading" :visualization-error="visualizationError" @select-role="selectedRole = $event" /></div>
        <div class="timeline">
          <button class="icon-button" title="Previous year" @click="stepYear(-1)"><ChevronLeft :size="17" /></button>
          <div class="timeline-track">
            <button v-for="year in years" :key="year" :class="{ active: year === selectedYear, edge: year === years[0] || year === years.at(-1) }" @click="selectedYear = year"><span></span><small>{{ year }}</small></button>
          </div>
          <button class="icon-button" title="Next year" @click="stepYear(1)"><ChevronRight :size="17" /></button>
          <div class="year-readout"><span>View year</span><strong>{{ selectedYear }}</strong></div>
        </div>
      </template>
      <div v-else class="empty-workspace">
        <div class="empty-map-grid"></div>
        <Orbit :size="36" />
        <h1>Earth Investigation Workbench</h1>
        <p>Create a typed investigation to compile datasets, evidence checks and an executable analysis graph.</p>
        <button class="primary" @click="newDialog = true"><Plus :size="16" />New investigation</button>
      </div>
    </main>

    <aside class="inspector">
      <template v-if="selectedPlan">
        <header class="inspector-head">
          <div><span>Investigation</span><h1>{{ selectedPlan.spec.question }}</h1></div>
          <button class="icon-button" title="Runtime registry" @click="registryDialog = true"><MoreHorizontal :size="18" /></button>
        </header>
        <div class="role-strip"><span v-for="item in selectedPlan.datasets" :key="item.role">{{ item.role.replaceAll('_', ' ') }}</span></div>
        <nav class="inspector-tabs">
          <button v-for="tab in tabs" :key="tab.id" :class="{ active: activeTab === tab.id }" :title="tab.label" @click="activeTab = tab.id"><component :is="tab.icon" :size="16" /><span>{{ tab.label }}</span></button>
        </nav>

        <div class="inspector-scroll">
          <div v-if="activeTab === 'evidence'" class="panel-section evidence-section">
            <section>
              <div class="section-heading"><h2>Hypotheses</h2><span>{{ selectedPlan.spec.hypotheses.length }}</span></div>
              <article v-for="hypothesis in selectedPlan.spec.hypotheses" :key="hypothesis.id" class="hypothesis">
                <code>{{ hypothesis.id }}</code><p>{{ hypothesis.statement }}</p>
                <span v-for="role in hypothesis.observableRoles" :key="role">{{ role.replaceAll('_', ' ') }}</span>
              </article>
            </section>
            <section>
              <div class="section-heading"><h2>Evidence critic</h2><span>{{ selectedPlan.criticChecks.length }}</span></div>
              <article v-for="check in selectedPlan.criticChecks" :key="check.checkId" :class="['critic', check.severity]">
                <AlertTriangle v-if="check.severity !== 'info'" :size="16" /><Info v-else :size="16" />
                <div><strong>{{ check.message }}</strong><p v-if="check.resolution">{{ check.resolution }}</p></div>
              </article>
            </section>
            <section v-if="selectedStory?.claims.length">
              <div class="section-heading"><h2>Source claims</h2><span>{{ selectedStory.claims.length }}</span></div>
              <article v-for="claim in selectedStory.claims" :key="claim.claimId" class="claim"><p>{{ claim.claim }}</p><a :href="claim.sourceUrl" target="_blank">Open source <ExternalLink :size="12" /></a></article>
            </section>
          </div>
          <MetricsPanel v-else-if="activeTab === 'metrics'" :plan="selectedPlan" />
          <div v-else-if="activeTab === 'plan'" class="panel-section plan-section">
            <div class="section-heading"><h2>Analysis graph</h2><span>{{ selectedPlan.dag.length }} nodes</span></div>
            <PlanGraph :nodes="selectedPlan.dag" />
            <section class="dataset-table">
              <div class="dataset-row dataset-head"><span>Role</span><span>Dataset</span><span>Scale</span></div>
              <div v-for="item in selectedPlan.datasets" :key="item.role" class="dataset-row"><span>{{ item.role.replaceAll('_', ' ') }}</span><strong>{{ item.dataset.title }}</strong><code>{{ item.dataset.scaleMeters }} m</code></div>
            </section>
          </div>
          <div v-else class="panel-section runs-section">
            <div class="section-heading"><h2>Run ledger</h2><span>{{ planJobs.length }}</span></div>
            <RunLedger :jobs="planJobs" @select="selectJob" />
            <section v-if="selectedJob" class="job-detail">
              <div class="job-actions">
                <button title="Refresh job" :disabled="refreshingJob" @click="refreshSelectedJob"><RotateCw :class="{ spin: refreshingJob }" :size="14" />Refresh</button>
                <button v-if="selectedJob.state === 'failed' && selectedJob.result?.execution === 'local_export'" title="Retry local export" :disabled="retryingJob" @click="retrySelectedJob"><RotateCcw :class="{ spin: retryingJob }" :size="14" />Retry</button>
                <button v-if="selectedJob.state === 'running' || selectedJob.state === 'queued'" class="danger-button" title="Cancel job" :disabled="cancelling" @click="cancelSelectedJob"><Ban :size="14" />Cancel</button>
              </div>
              <dl><dt>State</dt><dd>{{ selectedJob.state }}</dd><dt>Mode</dt><dd>{{ selectedJob.mode }}</dd><dt>Tasks</dt><dd>{{ selectedJob.taskIds.length }}</dd><dt>Artifact</dt><dd>{{ selectedJob.artifactDir }}</dd></dl>
              <p v-if="selectedJob.error" class="job-error">{{ selectedJob.error }}</p>
              <div class="artifact-list">
                <div class="section-heading"><h2>Artifacts</h2><span>{{ artifacts.length }}</span></div>
                <a v-for="artifact in artifacts" :key="artifact.name" :href="api.artifactUrl(selectedJob.jobId, artifact.name)" target="_blank">
                  <FileText :size="14" /><span><strong>{{ artifact.name }}</strong><small>{{ formatBytes(artifact.size) }}</small></span><Download :size="13" />
                </a>
                <p v-if="!artifacts.length" class="artifact-empty">No artifacts recorded.</p>
              </div>
            </section>
          </div>
        </div>
      </template>
      <div v-else class="inspector-empty"><ScanSearch :size="28" /><span>Select an investigation</span></div>
    </aside>

    <NewInvestigationDialog :open="newDialog" :saving="saving" @close="newDialog = false" @create="createPlan" />
    <RecipeDialog :open="recipeDialog" :saving="savingRecipe" :recipes="recipes" :current-spec="selectedPlan?.spec" @close="recipeDialog = false" @save="saveRecipe" @instantiate="instantiateRecipe" />
    <LocalExportDialog :open="exportDialog" :saving="exportingLocal" :plan="selectedPlan" :selected-role="selectedRole" :selected-year="selectedYear" @close="exportDialog = false" @export="queueLocalExport" />
    <RuntimeRegistryDialog :open="registryDialog" :saving="savingRegistry" :adapters="adapters" :skills="skills" :backends="environment.backends || []" @close="registryDialog = false" @import="importRegistry" @probe="probeRegistryAdapter" @state="setRegistryAdapterState" @save-skill="saveGeneratedSkill" @publish="publishGeneratedSkill" @invalid="error = $event" />
    <div v-if="error" class="toast"><AlertCircle :size="17" /><span>{{ error }}</span><button title="Dismiss" @click="error = ''"><X :size="15" /></button></div>
    <div v-if="running" class="run-progress"><LoaderCircle class="spin" :size="16" /><span>Submitting Earth workspace job</span></div>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { AlertCircle, AlertTriangle, Ban, BarChart3, Blocks, BookOpen, ChevronLeft, ChevronRight, Database, Download, ExternalLink, FileText, FlaskConical, FolderSearch, GitBranch, Info, KeyRound, Layers3, ListChecks, LoaderCircle, MoreHorizontal, Orbit, PanelLeft, Play, Plus, RefreshCw, RotateCcw, RotateCw, ScanSearch, Search, Server, X } from "lucide-vue-next";
import { api } from "./api";
import InvestigationMap from "./components/InvestigationMap.vue";
import LocalExportDialog from "./components/LocalExportDialog.vue";
import MetricsPanel from "./components/MetricsPanel.vue";
import NewInvestigationDialog from "./components/NewInvestigationDialog.vue";
import PlanGraph from "./components/PlanGraph.vue";
import RecipeDialog from "./components/RecipeDialog.vue";
import RuntimeRegistryDialog from "./components/RuntimeRegistryDialog.vue";
import RunLedger from "./components/RunLedger.vue";
import type { EarthJob, EarthSkillSummary, EarthStory, EarthVisualization, EnvironmentStatus, InvestigationPlan, InvestigationSpec, JobArtifact, RecipeSummary, RegisteredAdapter } from "./types";

const plans = ref<InvestigationPlan[]>([]);
const jobs = ref<EarthJob[]>([]);
const stories = ref<EarthStory[]>([]);
const recipes = ref<RecipeSummary[]>([]);
const adapters = ref<RegisteredAdapter[]>([]);
const skills = ref<EarthSkillSummary[]>([]);
const environment = ref<EnvironmentStatus>({});
const selectedPlanId = ref("");
const selectedJob = ref<EarthJob>();
const artifacts = ref<JobArtifact[]>([]);
const selectedYear = ref(new Date().getUTCFullYear());
const selectedRole = ref("");
const visualization = ref<EarthVisualization>();
const visualizationLoading = ref(false);
const visualizationError = ref("");
const search = ref("");
const activeTab = ref("evidence");
const loading = ref(false);
const saving = ref(false);
const running = ref(false);
const refreshingJob = ref(false);
const retryingJob = ref(false);
const cancelling = ref(false);
const newDialog = ref(false);
const recipeDialog = ref(false);
const exportDialog = ref(false);
const exportingLocal = ref(false);
const savingRecipe = ref(false);
const registryDialog = ref(false);
const savingRegistry = ref(false);
const showSidebar = ref(false);
const error = ref("");
const tabs = [
  { id: "evidence", label: "Evidence", icon: markRaw(ListChecks) },
  { id: "metrics", label: "Metrics", icon: markRaw(BarChart3) },
  { id: "plan", label: "Plan", icon: markRaw(GitBranch) },
  { id: "runs", label: "Runs", icon: markRaw(Layers3) },
];

const selectedPlan = computed(() => plans.value.find((plan) => plan.planId === selectedPlanId.value));
const selectedStory = computed(() => stories.value.find((story) => story.investigationId === selectedPlan.value?.spec.investigationId));
const geedimReady = computed(() => environment.value.backends?.some((backend) => backend.id === "geedim" && backend.installed) === true);
const planJobs = computed(() => jobs.value.filter((job) => job.planId === selectedPlanId.value).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
const years = computed(() => selectedPlan.value ? Array.from({ length: selectedPlan.value.spec.period.endYear - selectedPlan.value.spec.period.startYear + 1 }, (_, index) => selectedPlan.value!.spec.period.startYear + index) : []);
const filteredPlans = computed(() => {
  const query = search.value.trim().toLowerCase();
  return query ? plans.value.filter((plan) => `${plan.spec.question} ${plan.spec.region.name} ${plan.spec.investigationId}`.toLowerCase().includes(query)) : plans.value;
});

function latestJob(planId: string) { return jobs.value.filter((job) => job.planId === planId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]; }
function replaceJob(job: EarthJob) {
  const index = jobs.value.findIndex((item) => item.jobId === job.jobId);
  if (index >= 0) jobs.value.splice(index, 1, job); else jobs.value.unshift(job);
  if (selectedJob.value?.jobId === job.jobId) selectedJob.value = job;
}
async function selectJob(job: EarthJob | undefined) {
  selectedJob.value = job; artifacts.value = [];
  if (!job) return;
  try { artifacts.value = await api.artifacts(job.jobId); }
  catch (value) { error.value = value instanceof Error ? value.message : String(value); }
}
function selectPlan(id: string) {
  selectedPlanId.value = id;
  void selectJob(latestJob(id));
  const plan = plans.value.find((item) => item.planId === id);
  if (plan) { selectedYear.value = plan.spec.period.endYear; selectedRole.value = plan.datasets[0]?.role || ""; }
  showSidebar.value = false;
}
function stepYear(delta: number) {
  const index = years.value.indexOf(selectedYear.value);
  selectedYear.value = years.value[Math.max(0, Math.min(years.value.length - 1, index + delta))] ?? selectedYear.value;
}
async function refresh() {
  loading.value = true; error.value = "";
  try {
    const [nextEnvironment, nextPlans, nextJobs, nextStories, nextRecipes, nextAdapters, nextSkills] = await Promise.all([api.environment(), api.plans(), api.jobs(), api.stories(), api.recipes(), api.adapters(), api.skills()]);
    environment.value = nextEnvironment; plans.value = nextPlans; jobs.value = nextJobs; stories.value = nextStories; recipes.value = nextRecipes; adapters.value = nextAdapters; skills.value = nextSkills;
    if (selectedJob.value) await selectJob(nextJobs.find((job) => job.jobId === selectedJob.value?.jobId));
    if (!selectedPlanId.value && nextPlans[0]) selectPlan(nextPlans[0].planId);
  } catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { loading.value = false; }
}
async function createPlan(spec: InvestigationSpec) {
  saving.value = true; error.value = "";
  try {
    const result = await api.createPlan(spec);
    plans.value.unshift(result.plan); selectPlan(result.plan.planId); newDialog.value = false; activeTab.value = "plan";
  } catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { saving.value = false; }
}
async function runPlan(mode: "dry_run" | "live") {
  if (!selectedPlan.value) return;
  if (mode === "live" && selectedPlan.value.estimatedCost.requiresApproval && !window.confirm("This investigation crosses the review threshold. Submit the Earth Engine job?")) return;
  const registry = new Map(adapters.value.map((row) => [row.adapter.datasetId, row]));
  const unverified = selectedPlan.value.datasets.filter((item) => {
    const current = registry.get(item.dataset.datasetId);
    return !current || !current.enabled || current.verification.status !== "passed" || current.fingerprint !== item.adapterBinding?.fingerprint;
  }).map((item) => item.dataset.datasetId);
  if (mode === "live" && unverified.length && !window.confirm(`These adapters have not passed a live probe: ${[...new Set(unverified)].join(", ")}. Continue with explicit approval?`)) return;
  running.value = true; error.value = "";
  try {
    const job = await api.run(selectedPlan.value.planId, { mode, confirmed: mode === "live", confirmedUnverifiedAdapters: mode === "live" && unverified.length > 0, execution: mode === "live" ? "drive" : "inline", outputs: ["table_csv", "change_geotiff"] });
    replaceJob(job); await selectJob(job); activeTab.value = "runs";
  } catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { running.value = false; }
}
async function saveRecipe(recipe: { recipeId: string; name: string; spec: InvestigationSpec }) {
  savingRecipe.value = true; error.value = "";
  try { await api.saveRecipe(recipe); recipes.value = await api.recipes(); }
  catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { savingRecipe.value = false; }
}
async function queueLocalExport(request: Record<string, unknown>) {
  if (!selectedPlan.value) return;
  const estimatedPixels = typeof request.estimatedPixels === "number" ? request.estimatedPixels : undefined;
  const estimate = estimatedPixels === undefined ? "an unknown number of pixels" : `${estimatedPixels.toLocaleString()} pixels`;
  if (!window.confirm(`Queue a local GeoTIFF export of ${estimate}? The artifact remains inside this workspace.`)) return;
  const { estimatedPixels: _estimatedPixels, ...options } = request;
  exportingLocal.value = true; error.value = "";
  try {
    const job = await api.exportLocal(selectedPlan.value.planId, { ...options, confirmed: true });
    replaceJob(job); await selectJob(job); exportDialog.value = false; activeTab.value = "runs";
  } catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { exportingLocal.value = false; }
}
async function instantiateRecipe(recipeId: string) {
  savingRecipe.value = true; error.value = "";
  try {
    const suffix = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const result = await api.instantiateRecipe(recipeId, { investigationId: `${recipeId}-${suffix}`.slice(0, 79) });
    plans.value.unshift(result.plan); selectPlan(result.plan.planId); recipeDialog.value = false; activeTab.value = "plan";
  } catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { savingRecipe.value = false; }
}
async function importRegistry(payload: Record<string, unknown>) {
  savingRegistry.value = true; error.value = "";
  try { await api.importRegistry(payload); adapters.value = await api.adapters(); }
  catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { savingRegistry.value = false; }
}
async function probeRegistryAdapter(datasetId: string) {
  savingRegistry.value = true; error.value = "";
  try {
    await api.probeAdapter(datasetId);
    adapters.value = await api.adapters();
  } catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { savingRegistry.value = false; }
}
async function setRegistryAdapterState(datasetId: string, enabled: boolean) {
  savingRegistry.value = true; error.value = "";
  try {
    await api.setAdapterEnabled(datasetId, enabled);
    adapters.value = await api.adapters();
  } catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { savingRegistry.value = false; }
}
async function saveGeneratedSkill(payload: Record<string, unknown>) {
  savingRegistry.value = true; error.value = "";
  try { await api.saveSkill(payload); skills.value = await api.skills(); }
  catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { savingRegistry.value = false; }
}
async function publishGeneratedSkill(skillId: string) {
  if (!window.confirm(`Publish ${skillId} into .pi/skills? Pi must reload before it becomes active.`)) return;
  savingRegistry.value = true; error.value = "";
  try { await api.publishSkill(skillId); }
  catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { savingRegistry.value = false; }
}
let visualizationRequest = 0;
async function loadVisualization() {
  const requestId = ++visualizationRequest;
  visualization.value = undefined; visualizationError.value = "";
  if (!environment.value.authenticated || !selectedPlan.value || !selectedRole.value) return;
  visualizationLoading.value = true;
  try {
    const next = await api.visualization(selectedPlan.value.planId, selectedRole.value, selectedYear.value);
    if (requestId === visualizationRequest) visualization.value = next;
  } catch (value) {
    if (requestId === visualizationRequest) visualizationError.value = value instanceof Error ? value.message : String(value);
  } finally { if (requestId === visualizationRequest) visualizationLoading.value = false; }
}

async function refreshSelectedJob() {
  if (!selectedJob.value) return;
  refreshingJob.value = true; error.value = "";
  try { const job = await api.job(selectedJob.value.jobId, true); replaceJob(job); await selectJob(job); }
  catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { refreshingJob.value = false; }
}
async function retrySelectedJob() {
  if (!selectedJob.value || !window.confirm("Retry this persisted local export as a new job?")) return;
  retryingJob.value = true; error.value = "";
  try { const job = await api.retryJob(selectedJob.value.jobId); replaceJob(job); await selectJob(job); }
  catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { retryingJob.value = false; }
}
async function cancelSelectedJob() {
  if (!selectedJob.value || !window.confirm("Cancel this Earth Engine job?")) return;
  cancelling.value = true; error.value = "";
  try { const job = await api.cancelJob(selectedJob.value.jobId); replaceJob(job); await selectJob(job); }
  catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { cancelling.value = false; }
}
function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

let pollTimer: number | undefined;
let polling = false;
async function pollJobs() {
  if (polling) return;
  const active = jobs.value.filter((job) => job.state === "running" || job.state === "queued");
  if (!active.length) return;
  polling = true;
  try {
    for (const job of active) replaceJob(await api.job(job.jobId, true));
    if (selectedJob.value) await selectJob(jobs.value.find((job) => job.jobId === selectedJob.value?.jobId));
  } catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { polling = false; }
}

onMounted(async () => { await refresh(); pollTimer = window.setInterval(pollJobs, 4000); });
onBeforeUnmount(() => { if (pollTimer !== undefined) window.clearInterval(pollTimer); });
watch([selectedPlanId, selectedYear, selectedRole, () => environment.value.authenticated], () => { void loadVisualization(); });
</script>
