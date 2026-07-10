<template>
  <div v-if="open" class="recipe-backdrop" @mousedown.self="$emit('close')">
    <section class="recipe-dialog" role="dialog" aria-modal="true" aria-label="Recipes and workflows">
      <header>
        <div><p>Deterministic reuse</p><h2>Recipes and workflows</h2></div>
        <button class="icon-button" title="Close" @click="$emit('close')"><X :size="18" /></button>
      </header>
      <nav>
        <button :class="{ active: active === 'recipes' }" @click="active = 'recipes'"><BookOpen :size="15" />Recipes<span>{{ recipes.length }}</span></button>
        <button :class="{ active: active === 'workflows' }" @click="active = 'workflows'"><Workflow :size="15" />Workflows<span>{{ workflows.length }}</span></button>
      </nav>

      <template v-if="active === 'recipes'">
        <form v-if="currentSpec" class="reuse-save" @submit.prevent="saveRecipe">
          <div><strong>Save typed spec</strong><span>{{ currentSpec.investigationId }}</span></div>
          <label><span>Recipe ID</span><input v-model="recipeId" pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,100}" required></label>
          <label><span>Name</span><input v-model="recipeName" required></label>
          <button class="primary" :disabled="saving"><LoaderCircle v-if="saving" class="spin" :size="15" /><BookmarkPlus v-else :size="15" />Save</button>
        </form>
        <div class="reuse-list">
          <div class="list-head"><strong>Saved recipes</strong><span>{{ recipes.length }}</span></div>
          <article v-for="recipe in recipes" :key="recipe.recipeId">
            <div><strong>{{ recipe.name }}</strong><code>{{ recipe.recipeId }}</code><small>{{ formatDate(recipe.savedAt) }}</small></div>
            <button :disabled="saving" @click="$emit('instantiate', recipe.recipeId)"><Play :size="14" />Create plan</button>
          </article>
          <div v-if="!recipes.length" class="empty"><BookOpen :size="24" /><span>No saved recipes.</span></div>
        </div>
      </template>

      <template v-else>
        <form v-if="currentPlan && currentJob?.state === 'completed'" class="reuse-save" @submit.prevent="compileWorkflow">
          <div><strong>Compile successful run</strong><span>{{ currentJob.jobId }}</span></div>
          <label><span>Workflow ID</span><input v-model="workflowId" pattern="[a-z0-9][a-z0-9._\-]{2,100}" required></label>
          <label><span>Name</span><input v-model="workflowName" required></label>
          <button class="primary" :disabled="saving"><LoaderCircle v-if="saving" class="spin" :size="15" /><GitMerge v-else :size="15" />Compile</button>
        </form>
        <div class="reuse-list workflow-list">
          <div class="list-head"><strong>Compiled workflows</strong><span>{{ workflows.length }}</span></div>
          <article v-for="workflow in workflows" :key="workflow.workflowId">
            <span :class="['stage', workflow.stage]">{{ workflow.stage }}</span>
            <div><strong>{{ workflow.name }}</strong><code>{{ workflow.workflowId }} · rev {{ workflow.revision }} · {{ workflow.fingerprint.slice(0, 12) }}</code><small>{{ workflow.executionKind }} · {{ workflow.successCount }}/{{ workflow.replayCount }} successful · {{ workflow.failureCount }} blocked/failed</small></div>
            <button :disabled="saving" @click="$emit('replay', workflow.workflowId)"><RefreshCw :size="14" />Replay</button>
          </article>
          <div v-if="!workflows.length" class="empty"><Workflow :size="24" /><span>No compiled workflows.</span></div>
          <div v-if="workflowRuns.length" class="run-strip">
            <span>Recent replay</span><code>{{ workflowRuns[0].replayId }}</code><strong :class="workflowRuns[0].state">{{ workflowRuns[0].state }}</strong>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { BookmarkPlus, BookOpen, GitMerge, LoaderCircle, Play, RefreshCw, Workflow, X } from "lucide-vue-next";
import type { EarthJob, EarthWorkflowReplay, EarthWorkflowSummary, InvestigationPlan, InvestigationSpec, RecipeSummary } from "../types";

const props = defineProps<{ open: boolean; saving: boolean; recipes: RecipeSummary[]; workflows: EarthWorkflowSummary[]; workflowRuns: EarthWorkflowReplay[]; currentSpec?: InvestigationSpec; currentPlan?: InvestigationPlan; currentJob?: EarthJob }>();
const emit = defineEmits<{
  close: [];
  save: [recipe: { recipeId: string; name: string; spec: InvestigationSpec }];
  instantiate: [recipeId: string];
  compile: [input: { workflowId: string; name: string; planId: string; jobId: string; stage: "ready" }];
  replay: [workflowId: string];
}>();
const active = ref<"recipes" | "workflows">("recipes");
const recipeId = ref("");
const recipeName = ref("");
const workflowId = ref("");
const workflowName = ref("");

watch(() => [props.open, props.currentSpec?.investigationId, props.currentJob?.jobId] as const, () => {
  if (!props.open || !props.currentSpec) return;
  recipeId.value = `${props.currentSpec.investigationId}-recipe`.slice(0, 100);
  recipeName.value = props.currentSpec.region.name || props.currentSpec.question.slice(0, 72);
  workflowId.value = `workflow-${props.currentSpec.investigationId}`.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 100);
  workflowName.value = props.currentSpec.question.slice(0, 120);
}, { immediate: true });

function saveRecipe() {
  if (props.currentSpec) emit("save", { recipeId: recipeId.value, name: recipeName.value.trim(), spec: props.currentSpec });
}
function compileWorkflow() {
  if (props.currentPlan && props.currentJob) emit("compile", { workflowId: workflowId.value, name: workflowName.value.trim(), planId: props.currentPlan.planId, jobId: props.currentJob.jobId, stage: "ready" });
}
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(new Date(value)); }
</script>

<style scoped>
.recipe-backdrop { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; padding: 18px; background: rgba(24, 31, 27, .45); backdrop-filter: blur(3px); }.recipe-dialog { display: grid; grid-template-rows: auto auto auto minmax(0, 1fr); width: min(760px, 100%); max-height: min(760px, calc(100vh - 36px)); overflow: hidden; border: 1px solid #cfd7d2; border-radius: 8px; background: #fff; box-shadow: 0 24px 70px rgba(24, 38, 30, .25); }
header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid #e0e5e2; }header p { margin: 0 0 2px; color: #617168; font-size: 10px; font-weight: 700; text-transform: uppercase; }h2 { margin: 0; font-size: 19px; }.icon-button { display: grid; width: 34px; height: 34px; place-items: center; border: 1px solid #cfd7d2; border-radius: 5px; padding: 0; background: #fff; }
nav { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #dfe4e1; }nav button { display: flex; align-items: center; justify-content: center; gap: 6px; border: 0; border-right: 1px solid #e2e6e3; border-radius: 0; padding: 9px; background: #f7f9f7; color: #68756e; }nav button:last-child { border-right: 0; }nav button.active { box-shadow: inset 0 -2px #1f6846; background: #fff; color: #1f6846; font-weight: 700; }nav span { border-radius: 9px; padding: 1px 5px; background: #e7ece9; font-size: 9px; }
.reuse-save { display: grid; grid-template-columns: minmax(150px, 1fr) 160px 210px auto; gap: 10px; align-items: end; padding: 14px 18px; border-bottom: 1px solid #e0e5e2; background: #f8faf8; }.reuse-save > div { display: grid; min-width: 0; gap: 3px; align-self: center; }.reuse-save > div strong { font-size: 12px; }.reuse-save > div span { overflow: hidden; color: #6d7972; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }.reuse-save label { display: grid; gap: 4px; }.reuse-save label span { color: #53635a; font-size: 10px; font-weight: 700; }.reuse-save input { min-width: 0; border: 1px solid #ccd5cf; border-radius: 5px; padding: 7px 8px; }.reuse-save button, article button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; border: 1px solid #cad3cd; border-radius: 5px; padding: 7px 9px; background: #fff; cursor: pointer; }.reuse-save .primary { border-color: #1f6846; background: #1f6846; color: #fff; font-weight: 700; }
.reuse-list { min-height: 180px; overflow: auto; padding: 12px 18px 18px; }.list-head { display: flex; justify-content: space-between; padding: 4px 0 8px; color: #637168; font-size: 10px; text-transform: uppercase; }.reuse-list article { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; border-top: 1px solid #e2e7e4; padding: 11px 0; }.reuse-list article > div { display: grid; min-width: 0; gap: 3px; }.reuse-list article strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }.reuse-list code, .reuse-list small { overflow: hidden; color: #748079; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }.workflow-list article { grid-template-columns: 58px minmax(0, 1fr) auto; }.stage { justify-self: start; border-radius: 8px; padding: 2px 6px; background: #f4ead1; color: #82641e; font-size: 8px; font-weight: 700; text-transform: uppercase; }.stage.ready { background: #dff1e7; color: #216845; }.empty { display: grid; justify-items: center; gap: 7px; padding: 38px 0; color: #829087; font-size: 11px; }.run-strip { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: center; border-top: 1px solid #dfe5e1; padding-top: 10px; color: #738078; font-size: 9px; }.run-strip code { color: #365f4a; }.run-strip strong { text-transform: uppercase; }.run-strip strong.completed { color: #216845; }.run-strip strong.blocked, .run-strip strong.failed { color: #9a3f46; }.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 720px) { .reuse-save { grid-template-columns: 1fr 1fr; }.reuse-save > div { grid-column: 1 / -1; }.reuse-save .primary { align-self: stretch; }.reuse-list article, .workflow-list article { grid-template-columns: 1fr; }.reuse-list article button { justify-self: end; } }
</style>
