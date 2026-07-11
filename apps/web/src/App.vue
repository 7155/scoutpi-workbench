<template>
  <div :class="['app-shell', { 'left-collapsed': !leftPanelOpen, 'right-collapsed': !rightPanelOpen }]">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark"><Orbit :size="20" /></div>
        <div><strong>ScoutPi Spatial</strong><span>{{ t('Pi extension runtime') }}</span></div>
      </div>
      <div class="top-context" v-if="selectedPlan">
        <Bot :size="14" />
        <span>{{ selectedPlan.spec.region.name || selectedPlan.spec.investigationId }}</span>
        <ChevronRight :size="14" />
        <strong>{{ selectedPlan.spec.period.startYear }}-{{ selectedPlan.spec.period.endYear }}</strong>
      </div>
      <div class="top-actions">
        <div :class="['pi-control-status', piControlTone]"><Bot :size="15" /><span>{{ t('Pi control') }}</span><strong>{{ piControlLabel }}</strong></div>
        <div class="locale-switch" role="group" :aria-label="t('Language')"><button :class="{ active: locale === 'en' }" @click="setLocale('en')">EN</button><button :class="{ active: locale === 'zh-CN' }" @click="setLocale('zh-CN')">中</button></div>
        <button class="icon-button desktop-panel-toggle" :class="{ active: leftPanelOpen }" :title="leftPanelOpen ? t('Hide Pi tasks') : t('Show Pi tasks')" @click="leftPanelOpen = !leftPanelOpen"><PanelLeft :size="17" /></button>
        <button class="icon-button desktop-panel-toggle" :class="{ active: rightPanelOpen }" :title="rightPanelOpen ? t('Hide spatial state') : t('Show spatial state')" @click="rightPanelOpen = !rightPanelOpen"><PanelRight :size="17" /></button>
        <button :class="['runtime-launch', { attention: runtimeAttention > 0, ready: runtimeAttention === 0 && environment.authenticated }]" :title="t('Open Runtime Center')" @click="mobileActionMenu = false; registryDialog = true"><span class="runtime-dot"></span><span>{{ t('Runtime') }}</span><strong>{{ runtimeAttention ? t('count.review', { count: runtimeAttention }) : environment.authenticated ? t('Ready') : t('Dry run') }}</strong><Waypoints :size="15" /></button>
        <button class="icon-button mobile-only" :title="t('Investigations')" @click="mobileActionMenu = false; showSidebar = !showSidebar"><PanelLeft :size="18" /></button>
        <button class="icon-button compact-on-mobile" :title="t('Refresh workspace')" :disabled="loading" @click="refresh"><RefreshCw :class="{ spin: loading }" :size="17" /></button>
        <button class="icon-button" :title="t('Operator menu')" @click="mobileActionMenu = !mobileActionMenu"><MoreHorizontal :size="18" /></button>
        <div v-if="mobileActionMenu" class="mobile-action-menu">
          <button @click="toggleLocale"><Languages :size="16" /><span>{{ isChinese ? t('Switch to English') : t('Switch to Chinese') }}</span></button>
          <button :disabled="loading" @click="mobileActionMenu = false; refresh()"><RefreshCw :class="{ spin: loading }" :size="16" /><span>{{ t('Refresh workspace') }}</span></button>
          <button @click="mobileActionMenu = false; recipeDialog = true"><BookOpen :size="16" /><span>{{ t('Recipes and workflows') }}</span></button>
          <template v-if="manualControls">
            <div class="menu-divider"><span>{{ t('Local test controls') }}</span></div>
            <button @click="mobileActionMenu = false; newDialog = true"><Plus :size="16" /><span>{{ t('Create local test task') }}</span></button>
            <button :disabled="!selectedPlan || running" @click="mobileActionMenu = false; runPlan('dry_run')"><FlaskConical :size="16" /><span>{{ t('Dry run') }}</span></button>
            <button :disabled="!selectedPlan || running || !environment.authenticated" @click="mobileActionMenu = false; runPlan('live')"><Play :size="16" /><span>{{ t('Run live') }}</span></button>
            <button :disabled="!selectedPlan || !environment.authenticated || !geedimReady" @click="mobileActionMenu = false; exportDialog = true"><Download :size="16" /><span>{{ t('Export selected layer') }}</span></button>
          </template>
        </div>
      </div>
    </header>

    <aside :class="['sidebar', { open: showSidebar }]">
      <div class="sidebar-head">
        <div><span>{{ t('From Pi') }}</span><strong>{{ t('Pi task history') }}</strong></div>
        <button v-if="manualControls" class="icon-button" :title="t('Create local test task')" @click="newDialog = true"><Plus :size="18" /></button>
      </div>
      <label class="search-box"><Search :size="15" /><input v-model="search" :placeholder="t('Search Pi task history')"></label>
      <div class="plan-list">
        <button v-for="plan in filteredPlans" :key="plan.planId" :class="['plan-item', { active: plan.planId === selectedPlanId, current: plan.planId === spatialView?.target?.planId }]" @click="inspectPlan(plan.planId)">
          <span class="plan-state" :class="latestJob(plan.planId)?.state || 'draft'"></span>
          <span class="plan-copy">
            <strong>{{ plan.spec.question }}</strong>
            <small>{{ plan.spec.region.name || plan.spec.investigationId }}</small>
            <span class="plan-meta"><span>{{ plan.spec.period.startYear }}-{{ plan.spec.period.endYear }}</span><span>{{ statusLabel(latestJob(plan.planId)?.state || 'draft') }}</span></span>
          </span>
          <span v-if="plan.planId === spatialView?.target?.planId" class="pi-focus-tag">{{ t('Pi focus') }}</span>
        </button>
        <div v-if="!filteredPlans.length" class="sidebar-empty"><FolderSearch :size="26" /><span>{{ t('No Pi tasks') }}</span></div>
      </div>
      <div class="environment-block">
        <div><Bot :size="15" /><span>{{ t('Pi session') }}</span><strong>{{ piControlLabel }}</strong></div>
        <div><Database :size="15" /><span>{{ t('Tasks from Pi') }}</span><strong>{{ plans.length }}</strong></div>
        <div><Database :size="15" /><span>{{ t('Spatial data sources') }}</span><strong>{{ adapters.length }}</strong></div>
        <button :title="t('Open Runtime Center')" @click="registryDialog = true"><Waypoints :size="15" /><span>{{ t('Runtime center') }}</span><strong>{{ runtimeAttention ? t('count.review', { count: runtimeAttention }) : t('count.adapters', { count: adapters.length }) }}</strong></button>
      </div>
    </aside>

    <main class="workspace">
      <template v-if="selectedPlan">
        <div class="map-region"><InvestigationMap :plan="selectedPlan" :selected-year="selectedYear" :selected-role="selectedRole" :visualization="visualization" :visualization-loading="visualizationLoading" :visualization-error="visualizationError" :requested-mode="followPi ? spatialView?.mode : undefined" :follow-pi="followPi" @select-role="inspectRole" @mode-change="detachPiFocus" @toggle-follow="togglePiFollow" /></div>
        <div class="timeline">
          <button class="icon-button" :title="t('Previous year')" @click="inspectYearStep(-1)"><ChevronLeft :size="17" /></button>
          <div class="timeline-track">
            <button v-for="year in years" :key="year" :class="{ active: year === selectedYear, edge: year === years[0] || year === years.at(-1) }" @click="inspectYear(year)"><span></span><small>{{ year }}</small></button>
          </div>
          <button class="icon-button" :title="t('Next year')" @click="inspectYearStep(1)"><ChevronRight :size="17" /></button>
          <div class="year-readout"><span>{{ t('View year') }}</span><strong>{{ selectedYear }}</strong></div>
        </div>
      </template>
      <div v-else class="empty-workspace">
        <div class="empty-map-grid"></div>
        <Orbit :size="36" />
        <h1>{{ t('Pi spatial canvas') }}</h1>
        <p>{{ t('Waiting for a spatial task from Pi.') }}</p>
        <button v-if="manualControls" class="secondary" @click="newDialog = true"><Plus :size="16" />{{ t('Create local test task') }}</button>
      </div>
    </main>

    <aside class="inspector">
      <template v-if="selectedPlan">
        <header class="inspector-head">
          <div><span class="inspector-eyebrow"><Bot :size="12" />{{ followPi ? t('Pi understanding') : t('Local inspection') }}</span><h1>{{ selectedPlan.spec.question }}</h1><p>{{ selectedPlan.spec.region.name || selectedPlan.spec.investigationId }} · {{ selectedYear }}</p></div>
          <button class="icon-button" :title="t('Runtime registry')" @click="registryDialog = true"><MoreHorizontal :size="18" /></button>
        </header>
        <div class="role-strip"><strong>{{ followPi ? t('Pi selected') : t('Selected layer') }}</strong><span v-for="item in selectedPlan.datasets" :key="item.role" :class="{ active: item.role === selectedRole }">{{ roleLabel(item.role) }}</span></div>
        <nav class="inspector-tabs">
          <button v-for="tab in tabs" :key="tab.id" :class="{ active: activeTab === tab.id }" :title="tab.label" @click="activeTab = tab.id"><component :is="tab.icon" :size="16" /><span>{{ tab.label }}</span></button>
        </nav>

        <div class="inspector-scroll">
          <PiSpatialContext v-if="activeTab === 'context'" :plan="selectedPlan" :view="spatialView" :selected-role="selectedRole" :selected-year="selectedYear" :follow-pi="followPi" />
          <div v-else-if="activeTab === 'evidence'" class="panel-section evidence-section">
            <section>
              <div class="section-heading"><h2>{{ t('Evidence graph') }}</h2><span>{{ t('count.nodes', { count: evidenceGraph?.nodes.length || 0 }) }}</span></div>
              <EvidenceGraph :graph="evidenceGraph" :records="selectedEvidence" :review="evidenceReview" />
            </section>
            <section>
              <div class="section-heading"><h2>{{ t('Hypotheses') }}</h2><span>{{ selectedPlan.spec.hypotheses.length }}</span></div>
              <article v-for="hypothesis in selectedPlan.spec.hypotheses" :key="hypothesis.id" class="hypothesis">
                <code>{{ hypothesis.id }}</code><p>{{ hypothesis.statement }}</p>
                <span v-for="role in hypothesis.observableRoles" :key="role">{{ roleLabel(role) }}</span>
              </article>
            </section>
            <section>
              <div class="section-heading"><h2>{{ t('Evidence critic') }}</h2><span>{{ selectedPlan.criticChecks.length }}</span></div>
              <article v-for="check in selectedPlan.criticChecks" :key="check.checkId" :class="['critic', check.severity]">
                <AlertTriangle v-if="check.severity !== 'info'" :size="16" /><Info v-else :size="16" />
                <div><strong>{{ check.message }}</strong><p v-if="check.resolution">{{ check.resolution }}</p></div>
              </article>
            </section>
            <section v-if="selectedStory?.claims.length">
              <div class="section-heading"><h2>{{ t('Source claims') }}</h2><span>{{ selectedStory.claims.length }}</span></div>
              <article v-for="claim in selectedStory.claims" :key="claim.claimId" class="claim"><p>{{ claim.claim }}</p><a :href="claim.sourceUrl" target="_blank">{{ t('Open source') }} <ExternalLink :size="12" /></a></article>
            </section>
          </div>
          <div v-else-if="activeTab === 'plan'" class="panel-section plan-section">
            <div class="section-heading"><h2>{{ t('Analysis graph') }}</h2><span>{{ t('count.nodes', { count: selectedPlan.dag.length }) }}</span></div>
            <PlanGraph :nodes="selectedPlan.dag" />
            <section class="dataset-table">
              <div class="dataset-row dataset-head"><span>{{ t('Role') }}</span><span>{{ t('Dataset') }}</span><span>{{ t('Scale') }}</span></div>
              <div v-for="item in selectedPlan.datasets" :key="item.role" class="dataset-row"><span>{{ roleLabel(item.role) }}</span><strong>{{ item.dataset.title }}</strong><code>{{ item.dataset.scaleMeters }} m</code></div>
            </section>
          </div>
          <div v-else class="panel-section runs-section">
            <div class="section-heading"><h2>{{ t('Run ledger') }}</h2><span>{{ planJobs.length }}</span></div>
            <RunLedger :jobs="planJobs" @select="selectJob" />
            <section v-if="selectedJob" class="job-detail">
              <div class="job-actions">
                <button :title="t('Refresh job')" :disabled="refreshingJob" @click="refreshSelectedJob"><RotateCw :class="{ spin: refreshingJob }" :size="14" />{{ t('Refresh') }}</button>
                <button v-if="selectedJob.state === 'failed' && selectedJob.result?.execution === 'local_export'" :title="t('Retry local export')" :disabled="retryingJob" @click="retrySelectedJob"><RotateCcw :class="{ spin: retryingJob }" :size="14" />{{ t('Retry') }}</button>
                <button v-if="selectedJob.state === 'running' || selectedJob.state === 'queued'" class="danger-button" :title="t('Cancel job')" :disabled="cancelling" @click="cancelSelectedJob"><Ban :size="14" />{{ t('Cancel') }}</button>
              </div>
              <dl><dt>{{ t('State') }}</dt><dd>{{ statusLabel(selectedJob.state) }}</dd><dt>{{ t('Mode') }}</dt><dd>{{ statusLabel(selectedJob.mode) }}</dd><dt>{{ t('Tasks') }}</dt><dd>{{ selectedJob.taskIds.length }}</dd><dt>{{ t('Artifact') }}</dt><dd>{{ selectedJob.artifactDir }}</dd></dl>
              <p v-if="selectedJob.error" class="job-error">{{ selectedJob.error }}</p>
              <div class="artifact-list">
                <div class="section-heading"><h2>{{ t('Artifacts') }}</h2><span>{{ artifacts.length }}</span></div>
                <a v-for="artifact in artifacts" :key="artifact.name" :href="api.artifactUrl(selectedJob.jobId, artifact.name)" target="_blank">
                  <FileText :size="14" /><span><strong>{{ artifact.name }}</strong><small>{{ formatBytes(artifact.size) }}</small></span><Download :size="13" />
                </a>
                <p v-if="!artifacts.length" class="artifact-empty">{{ t('No artifacts recorded.') }}</p>
              </div>
            </section>
          </div>
        </div>
      </template>
      <div v-else class="inspector-empty"><Bot :size="28" /><strong>{{ t('Waiting for Pi') }}</strong><span>{{ t('No spatial task is active.') }}</span></div>
    </aside>

    <NewInvestigationDialog :open="newDialog" :saving="saving" @close="newDialog = false" @create="createPlan" />
    <RecipeDialog :open="recipeDialog" :saving="savingRecipe" :recipes="recipes" :workflows="workflows" :workflow-runs="workflowRuns" :current-spec="selectedPlan?.spec" :current-plan="selectedPlan" :current-job="workflowSourceJob" @close="recipeDialog = false" @save="saveRecipe" @instantiate="instantiateRecipe" @compile="compileSelectedWorkflow" @replay="replayCompiledWorkflow" />
    <LocalExportDialog :open="exportDialog" :saving="exportingLocal" :plan="selectedPlan" :selected-role="selectedRole" :selected-year="selectedYear" @close="exportDialog = false" @export="queueLocalExport" />
    <RuntimeRegistryDialog :open="registryDialog" :saving="savingRegistry || loading" :adapters="adapters" :skills="skills" :backend-manifests="backendManifests" :backend-probes="backendProbes" :telemetry="telemetry" :agent-runs="agentRuns" :checkpoints="checkpoints" :context-packs="contextPacks" :context-writebacks="contextWritebacks" :evidence-count="evidenceRecords.length" :mcp-profile="mcpProfile" :pi-ecosystem="piEcosystem" :triggers="triggers" :trigger-runs="triggerRuns" :delegations="delegations" :workflows="workflows" :approvals="approvals" @close="registryDialog = false" @refresh="refresh" @import="importRegistry" @probe="probeRegistryAdapter" @probe-backend="probeRuntimeBackend" @state="setRegistryAdapterState" @save-skill="saveGeneratedSkill" @publish="publishGeneratedSkill" @create-trigger="createTrigger" @approve-trigger="approveTrigger" @trigger-state="setTriggerState" @invoke-trigger="invokeTrigger" @invalid="error = $event" />
    <div v-if="error" class="toast"><AlertCircle :size="17" /><span>{{ error }}</span><button :title="t('Dismiss')" @click="error = ''"><X :size="15" /></button></div>
    <div v-if="running" class="run-progress"><LoaderCircle class="spin" :size="16" /><span>{{ t('Submitting Earth workspace job') }}</span></div>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Activity, AlertCircle, AlertTriangle, Ban, BookOpen, Bot, ChevronLeft, ChevronRight, Database, Download, ExternalLink, Eye, FileText, FlaskConical, FolderSearch, GitBranch, Info, Languages, ListChecks, LoaderCircle, MoreHorizontal, Orbit, PanelLeft, PanelRight, Play, Plus, RefreshCw, RotateCcw, RotateCw, Search, Waypoints, X } from "lucide-vue-next";
import { api } from "./api";
import { useI18n } from "./i18n";
import InvestigationMap from "./components/InvestigationMap.vue";
import EvidenceGraph from "./components/EvidenceGraph.vue";
import LocalExportDialog from "./components/LocalExportDialog.vue";
import NewInvestigationDialog from "./components/NewInvestigationDialog.vue";
import PiSpatialContext from "./components/PiSpatialContext.vue";
import PlanGraph from "./components/PlanGraph.vue";
import RecipeDialog from "./components/RecipeDialog.vue";
import RuntimeRegistryDialog from "./components/RuntimeRegistryDialog.vue";
import RunLedger from "./components/RunLedger.vue";
import type { AgentCheckpointSummary, AgentRunSummary, BrowserEvidenceRecord, ContextPackSummary, ContextWritebackSummary, DelegationGrantSummary, EarthBackendManifest, EarthBackendProbe, EarthJob, EarthSkillSummary, EarthStory, EarthVisualization, EarthWorkflowReplay, EarthWorkflowSummary, EnvironmentStatus, EvidenceGraph as EvidenceGraphState, EvidenceReviewReport, InvestigationPlan, InvestigationSpec, JobArtifact, PiEcosystemProfile, RecipeSummary, RegisteredAdapter, RuntimeApproval, RuntimeTelemetrySummary, ScoutPiMcpProfile, SpatialViewState, TriggerRun, WorkflowTrigger } from "./types";

const { locale, isChinese, t, statusLabel, roleLabel, setLocale, toggleLocale } = useI18n();

const plans = ref<InvestigationPlan[]>([]);
const jobs = ref<EarthJob[]>([]);
const stories = ref<EarthStory[]>([]);
const recipes = ref<RecipeSummary[]>([]);
const adapters = ref<RegisteredAdapter[]>([]);
const skills = ref<EarthSkillSummary[]>([]);
const backendManifests = ref<EarthBackendManifest[]>([]);
const backendProbes = ref<Record<string, EarthBackendProbe>>({});
const telemetry = ref<RuntimeTelemetrySummary>();
const agentRuns = ref<AgentRunSummary[]>([]);
const spatialView = ref<SpatialViewState>();
const checkpoints = ref<AgentCheckpointSummary[]>([]);
const contextPacks = ref<ContextPackSummary[]>([]);
const contextWritebacks = ref<ContextWritebackSummary[]>([]);
const evidenceRecords = ref<BrowserEvidenceRecord[]>([]);
const evidenceGraph = ref<EvidenceGraphState>();
const evidenceReview = ref<EvidenceReviewReport>();
const approvals = ref<RuntimeApproval[]>([]);
const workflows = ref<EarthWorkflowSummary[]>([]);
const workflowRuns = ref<EarthWorkflowReplay[]>([]);
const environment = ref<EnvironmentStatus>({});
const mcpProfile = ref<ScoutPiMcpProfile>();
const piEcosystem = ref<PiEcosystemProfile>();
const triggers = ref<WorkflowTrigger[]>([]);
const triggerRuns = ref<TriggerRun[]>([]);
const delegations = ref<DelegationGrantSummary[]>([]);
const selectedPlanId = ref("");
const selectedJob = ref<EarthJob>();
const artifacts = ref<JobArtifact[]>([]);
const selectedYear = ref(new Date().getUTCFullYear());
const selectedRole = ref("");
const visualization = ref<EarthVisualization>();
const visualizationLoading = ref(false);
const visualizationError = ref("");
const search = ref("");
const activeTab = ref("context");
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
const leftPanelOpen = ref(true);
const rightPanelOpen = ref(true);
const mobileActionMenu = ref(false);
const followPi = ref(true);
const error = ref("");
const manualControls = import.meta.env.VITE_SCOUTPI_MANUAL_CONTROLS === "1";
const tabs = computed(() => [
  { id: "context", label: t("Current state"), icon: markRaw(Eye) },
  { id: "evidence", label: t("Evidence"), icon: markRaw(ListChecks) },
  { id: "plan", label: t("Workflow"), icon: markRaw(GitBranch) },
  { id: "runs", label: t("Run history"), icon: markRaw(Activity) },
]);

const selectedPlan = computed(() => plans.value.find((plan) => plan.planId === selectedPlanId.value));
const selectedStory = computed(() => stories.value.find((story) => story.investigationId === selectedPlan.value?.spec.investigationId));
const selectedEvidence = computed(() => evidenceRecords.value.filter((record) => record.binding?.investigationId === selectedPlan.value?.spec.investigationId));
const geedimReady = computed(() => environment.value.backends?.some((backend) => backend.id === "geedim" && backend.installed) === true);
const runtimeAttention = computed(() => contextWritebacks.value.filter((item) => item.state === "pending").length + checkpoints.value.filter((item) => item.recovery.recoverable).length + approvals.value.filter((item) => item.state === "pending").length + agentRuns.value.filter((item) => item.state === "interrupted").length + triggers.value.filter((item) => item.state === "draft").length);
const latestAgentRun = computed(() => [...agentRuns.value].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]);
const piControlLabel = computed(() => latestAgentRun.value?.state === "running" ? t("Pi working") : spatialView.value?.control.source === "pi" && spatialView.value.revision > 0 ? t("Pi attached") : t("Waiting for Pi"));
const piControlTone = computed(() => latestAgentRun.value?.state === "running" || spatialView.value?.phase === "computing" ? "working" : spatialView.value?.control.source === "pi" && spatialView.value.revision > 0 ? "attached" : "waiting");
const planJobs = computed(() => jobs.value.filter((job) => job.planId === selectedPlanId.value).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
const workflowSourceJob = computed(() => planJobs.value.find((job) => job.state === "completed"));
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
  if (plan) void loadEvidenceGraph(plan.spec.investigationId);
  showSidebar.value = false;
}
function applyPiSpatialView(view = spatialView.value) {
  if (!followPi.value || !view?.target) return;
  const plan = plans.value.find((item) => item.planId === view.target!.planId);
  if (!plan) return;
  if (selectedPlanId.value !== plan.planId) selectPlan(plan.planId);
  if (plan.datasets.some((item) => item.role === view.target!.role)) selectedRole.value = view.target.role;
  if (view.target.year >= plan.spec.period.startYear && view.target.year <= plan.spec.period.endYear) selectedYear.value = view.target.year;
  const job = view.target.jobId ? jobs.value.find((item) => item.jobId === view.target!.jobId) : undefined;
  if (job) void selectJob(job);
}
function detachPiFocus() { followPi.value = false; }
function togglePiFollow() {
  followPi.value = !followPi.value;
  if (followPi.value) applyPiSpatialView();
}
function inspectPlan(id: string) { detachPiFocus(); selectPlan(id); }
function inspectRole(role: string) { detachPiFocus(); selectedRole.value = role; }
function inspectYear(year: number) { detachPiFocus(); selectedYear.value = year; }
function stepYear(delta: number) {
  const index = years.value.indexOf(selectedYear.value);
  selectedYear.value = years.value[Math.max(0, Math.min(years.value.length - 1, index + delta))] ?? selectedYear.value;
}
function inspectYearStep(delta: number) { detachPiFocus(); stepYear(delta); }
async function refresh() {
  loading.value = true; error.value = "";
  try {
    const [nextEnvironment, nextMcp, nextPiEcosystem, nextTriggers, nextTriggerRuns, nextDelegations, nextPlans, nextJobs, nextStories, nextRecipes, nextAdapters, nextSkills, nextBackends, nextTelemetry, nextAgentRuns, nextSpatialView, nextCheckpoints, nextContextPacks, nextContextWritebacks, nextEvidence, nextApprovals, nextWorkflows, nextWorkflowRuns] = await Promise.all([api.environment(), api.mcp(), api.piEcosystem(), api.triggers(), api.triggerRuns(), api.delegations(), api.plans(), api.jobs(), api.stories(), api.recipes(), api.adapters(), api.skills(), api.backends(), api.telemetry(), api.agentRuns(), api.spatialView(), api.checkpoints(), api.contextPacks(), api.contextWritebacks(), api.evidence(), api.approvals(), api.workflows(), api.workflowRuns()]);
    environment.value = nextEnvironment; mcpProfile.value = nextMcp; piEcosystem.value = nextPiEcosystem; triggers.value = nextTriggers; triggerRuns.value = nextTriggerRuns; delegations.value = nextDelegations; plans.value = nextPlans; jobs.value = nextJobs; stories.value = nextStories; recipes.value = nextRecipes; adapters.value = nextAdapters; skills.value = nextSkills; backendManifests.value = nextBackends; telemetry.value = nextTelemetry; agentRuns.value = nextAgentRuns; spatialView.value = nextSpatialView; checkpoints.value = nextCheckpoints; contextPacks.value = nextContextPacks; contextWritebacks.value = nextContextWritebacks; evidenceRecords.value = nextEvidence; approvals.value = nextApprovals; workflows.value = nextWorkflows; workflowRuns.value = nextWorkflowRuns;
    if (selectedJob.value) await selectJob(nextJobs.find((job) => job.jobId === selectedJob.value?.jobId));
    if (followPi.value && nextSpatialView.target && nextPlans.some((plan) => plan.planId === nextSpatialView.target?.planId)) applyPiSpatialView(nextSpatialView);
    else if (!selectedPlanId.value && nextPlans[0]) selectPlan(nextPlans[0].planId);
    else {
      const activePlan = nextPlans.find((plan) => plan.planId === selectedPlanId.value);
      if (activePlan) await loadEvidenceGraph(activePlan.spec.investigationId);
    }
  } catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { loading.value = false; }
}
async function loadEvidenceGraph(investigationId: string) {
  evidenceGraph.value = undefined; evidenceReview.value = undefined;
  try {
    const hasStory = stories.value.some((story) => story.investigationId === investigationId);
    const [graph, review] = await Promise.all([api.evidenceGraph(investigationId), hasStory ? api.evidenceReview(investigationId).catch(() => undefined) : Promise.resolve(undefined)]);
    evidenceGraph.value = graph; evidenceReview.value = review;
  } catch (value) { error.value = value instanceof Error ? value.message : String(value); }
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
async function compileSelectedWorkflow(input: { workflowId: string; name: string; planId: string; jobId: string; stage: "ready" }) {
  const sourcePlan = plans.value.find((item) => item.planId === input.planId);
  const confirmedBlockingChecks = sourcePlan?.criticChecks.some((check) => check.severity === "blocking") === true;
  if (confirmedBlockingChecks && !window.confirm("This source run has blocking critic checks. Compile only after explicit review?")) return;
  savingRecipe.value = true; error.value = "";
  try { await api.compileWorkflow({ ...input, confirmedBlockingChecks }); workflows.value = await api.workflows(); }
  catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { savingRecipe.value = false; }
}
async function replayCompiledWorkflow(workflowId: string) {
  const workflow = workflows.value.find((item) => item.workflowId === workflowId);
  if (!workflow) return;
  const warning = workflow.stage === "candidate" ? "This candidate was compiled automatically from one verified run. Review and replay it?" : `Replay ${workflow.workflowId} with its frozen adapter fingerprints and cost bounds?`;
  if (!window.confirm(warning)) return;
  savingRecipe.value = true; error.value = "";
  try {
    const suffix = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 12);
    const result = await api.replayWorkflow(workflow.workflowId, { patch: { investigationId: `${workflow.workflowId}-${suffix}`.slice(0, 79) }, confirmed: true });
    if (result.plan && !plans.value.some((plan) => plan.planId === result.plan!.planId)) plans.value.unshift(result.plan);
    if (result.job) replaceJob(result.job);
    workflowRuns.value = await api.workflowRuns(); workflows.value = await api.workflows(); telemetry.value = await api.telemetry();
    if (result.plan) selectPlan(result.plan.planId);
    if (result.job) await selectJob(result.job);
    recipeDialog.value = false; activeTab.value = "runs";
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
async function probeRuntimeBackend(backendId: string) {
  savingRegistry.value = true; error.value = "";
  try { backendProbes.value = { ...backendProbes.value, [backendId]: await api.probeBackend(backendId) }; }
  catch (value) { error.value = value instanceof Error ? value.message : String(value); }
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
async function createTrigger(payload: Record<string, unknown>) {
  savingRegistry.value = true; error.value = "";
  try {
    await api.createTrigger(payload);
    triggers.value = await api.triggers();
  } catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { savingRegistry.value = false; }
}
async function approveTrigger(triggerId: string) {
  const trigger = triggers.value.find((item) => item.triggerId === triggerId);
  if (!trigger) return;
  const condition = trigger.condition.kind === "manual" ? "manual" : trigger.condition.kind === "interval" ? `every ${trigger.condition.everyMinutes} minutes` : trigger.condition.eventName;
  const confirmation = isChinese.value
    ? `授权 ${trigger.name}？\n\n工作流：${trigger.workflowId}\n范围：仅试运行复放\n条件：${condition}\n最大运行次数：${trigger.limits.maxRuns}\n过期时间：${trigger.limits.expiresAt}`
    : `Authorize ${trigger.name}?\n\nWorkflow: ${trigger.workflowId}\nScope: dry-run replay only\nCondition: ${condition}\nMaximum runs: ${trigger.limits.maxRuns}\nExpires: ${trigger.limits.expiresAt}`;
  if (!window.confirm(confirmation)) return;
  savingRegistry.value = true; error.value = "";
  try {
    await api.approveTrigger(triggerId);
    [triggers.value, delegations.value] = await Promise.all([api.triggers(), api.delegations()]);
  } catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { savingRegistry.value = false; }
}
async function setTriggerState(triggerId: string, state: "paused" | "active" | "revoked") {
  savingRegistry.value = true; error.value = "";
  try {
    await api.setTriggerState(triggerId, state);
    [triggers.value, delegations.value] = await Promise.all([api.triggers(), api.delegations()]);
  } catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { savingRegistry.value = false; }
}
async function invokeTrigger(triggerId: string) {
  savingRegistry.value = true; error.value = "";
  try {
    await api.invokeTrigger(triggerId, `workbench:${crypto.randomUUID()}`);
    await refresh();
  } catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { savingRegistry.value = false; }
}
let visualizationRequest = 0;
async function loadVisualization() {
  const requestId = ++visualizationRequest;
  visualization.value = undefined; visualizationError.value = "";
  if (!environment.value.authenticated || !selectedPlan.value || !selectedRole.value) return;
  const piVisualizationRequested = spatialView.value?.control.source === "pi"
    && spatialView.value.control.operation === "visualize"
    && spatialView.value.target?.planId === selectedPlan.value.planId
    && spatialView.value.target.role === selectedRole.value
    && spatialView.value.target.year === selectedYear.value;
  if (followPi.value && !piVisualizationRequested) return;
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
  if (!selectedJob.value || !window.confirm(t("Retry this persisted local export as a new job?"))) return;
  retryingJob.value = true; error.value = "";
  try { const job = await api.retryJob(selectedJob.value.jobId); replaceJob(job); await selectJob(job); }
  catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { retryingJob.value = false; }
}
async function cancelSelectedJob() {
  if (!selectedJob.value || !window.confirm(t("Cancel this Earth Engine job?"))) return;
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
let spatialPollTimer: number | undefined;
let polling = false;
let spatialPolling = false;
async function pollJobs() {
  if (polling) return;
  const active = jobs.value.filter((job) => job.state === "running" || job.state === "queued");
  const activeReplays = workflowRuns.value.filter((run) => run.state === "running");
  if (!active.length && !activeReplays.length) return;
  polling = true;
  try {
    for (const job of active) replaceJob(await api.job(job.jobId, true));
    for (const replay of activeReplays) {
      const next = await api.workflowRun(replay.replayId);
      const index = workflowRuns.value.findIndex((item) => item.replayId === next.replayId);
      if (index >= 0) workflowRuns.value.splice(index, 1, next);
    }
    if (selectedJob.value) await selectJob(jobs.value.find((job) => job.jobId === selectedJob.value?.jobId));
  } catch (value) { error.value = value instanceof Error ? value.message : String(value); }
  finally { polling = false; }
}

async function pollSpatialView() {
  if (spatialPolling) return;
  spatialPolling = true;
  try {
    const next = await api.spatialView();
    if (next.revision !== spatialView.value?.revision || next.updatedAt !== spatialView.value?.updatedAt) {
      spatialView.value = next;
      applyPiSpatialView(next);
      if (next.target?.jobId) {
        const known = jobs.value.find((job) => job.jobId === next.target?.jobId);
        if (known && (known.state === "running" || known.state === "queued")) replaceJob(await api.job(known.jobId, true));
      }
    }
  } catch {
    // The main refresh surface reports API failures; background focus polling stays quiet.
  } finally { spatialPolling = false; }
}

onMounted(async () => { await refresh(); pollTimer = window.setInterval(pollJobs, 4000); spatialPollTimer = window.setInterval(pollSpatialView, 1800); });
onBeforeUnmount(() => { if (pollTimer !== undefined) window.clearInterval(pollTimer); if (spatialPollTimer !== undefined) window.clearInterval(spatialPollTimer); });
watch([selectedPlanId, selectedYear, selectedRole, () => environment.value.authenticated, () => spatialView.value?.revision, followPi], () => { void loadVisualization(); });
</script>
