<template>
  <div v-if="open" class="recipe-backdrop" @mousedown.self="$emit('close')">
    <section class="recipe-dialog" role="dialog" aria-modal="true" aria-label="Investigation recipes">
      <header>
        <div><p>Reusable workflows</p><h2>Investigation recipes</h2></div>
        <button class="icon-button" title="Close" @click="$emit('close')"><X :size="18" /></button>
      </header>

      <form v-if="currentSpec" class="recipe-save" @submit.prevent="save">
        <div><strong>Save current investigation</strong><span>Stores the typed spec only.</span></div>
        <label><span>Recipe ID</span><input v-model="recipeId" pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,100}" required></label>
        <label><span>Name</span><input v-model="name" required></label>
        <button class="primary" :disabled="saving"><LoaderCircle v-if="saving" class="spin" :size="15" /><BookmarkPlus v-else :size="15" />Save</button>
      </form>

      <div class="recipe-list">
        <div class="recipe-list-head"><strong>Saved recipes</strong><span>{{ recipes.length }}</span></div>
        <article v-for="recipe in recipes" :key="recipe.recipeId">
          <div><strong>{{ recipe.name }}</strong><code>{{ recipe.recipeId }}</code><small>{{ formatDate(recipe.savedAt) }}</small></div>
          <button :disabled="saving" @click="$emit('instantiate', recipe.recipeId)"><Play :size="14" />Create plan</button>
        </article>
        <div v-if="!recipes.length" class="recipe-empty"><BookOpen :size="24" /><span>No saved recipes.</span></div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { BookmarkPlus, BookOpen, LoaderCircle, Play, X } from "lucide-vue-next";
import type { InvestigationSpec, RecipeSummary } from "../types";

const props = defineProps<{ open: boolean; saving: boolean; recipes: RecipeSummary[]; currentSpec?: InvestigationSpec }>();
const emit = defineEmits<{ close: []; save: [recipe: { recipeId: string; name: string; spec: InvestigationSpec }]; instantiate: [recipeId: string] }>();
const recipeId = ref("");
const name = ref("");

watch(() => [props.open, props.currentSpec?.investigationId] as const, () => {
  if (!props.open || !props.currentSpec) return;
  recipeId.value = `${props.currentSpec.investigationId}-recipe`.slice(0, 100);
  name.value = props.currentSpec.region.name || props.currentSpec.question.slice(0, 72);
}, { immediate: true });

function save() {
  if (!props.currentSpec) return;
  emit("save", { recipeId: recipeId.value, name: name.value.trim(), spec: props.currentSpec });
}
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(new Date(value)); }
</script>

<style scoped>
.recipe-backdrop { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; padding: 18px; background: rgba(24, 31, 27, .45); backdrop-filter: blur(3px); }
.recipe-dialog { display: grid; width: min(680px, 100%); max-height: min(720px, calc(100vh - 36px)); overflow: hidden; border: 1px solid #cfd7d2; border-radius: 8px; background: #fff; box-shadow: 0 24px 70px rgba(24, 38, 30, .25); }
header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid #e0e5e2; } header p { margin: 0 0 2px; color: #617168; font-size: 10px; font-weight: 700; text-transform: uppercase; } h2 { margin: 0; font-size: 19px; }
.icon-button { display: grid; width: 34px; height: 34px; place-items: center; border: 1px solid #cfd7d2; border-radius: 5px; padding: 0; background: #fff; }
.recipe-save { display: grid; grid-template-columns: minmax(150px, 1fr) 150px 190px auto; gap: 10px; align-items: end; padding: 14px 18px; border-bottom: 1px solid #e0e5e2; background: #f8faf8; }.recipe-save > div { display: grid; gap: 3px; align-self: center; }.recipe-save > div strong { font-size: 12px; }.recipe-save > div span { color: #6d7972; font-size: 10px; }.recipe-save label { display: grid; gap: 4px; }.recipe-save label span { color: #53635a; font-size: 10px; font-weight: 700; }.recipe-save input { min-width: 0; border: 1px solid #ccd5cf; border-radius: 5px; padding: 7px 8px; }.recipe-save button, article button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; border: 1px solid #cad3cd; border-radius: 5px; padding: 7px 9px; background: #fff; cursor: pointer; }.recipe-save .primary { border-color: #1f6846; background: #1f6846; color: #fff; font-weight: 700; }
.recipe-list { min-height: 180px; overflow: auto; padding: 12px 18px 18px; }.recipe-list-head { display: flex; justify-content: space-between; padding: 4px 0 8px; color: #637168; font-size: 10px; text-transform: uppercase; }.recipe-list article { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; border-top: 1px solid #e2e7e4; padding: 11px 0; }.recipe-list article > div { display: grid; min-width: 0; gap: 3px; }.recipe-list article strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }.recipe-list code, .recipe-list small { color: #748079; font-size: 9px; }.recipe-empty { display: grid; justify-items: center; gap: 7px; padding: 38px 0; color: #829087; font-size: 11px; }.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 680px) { .recipe-save { grid-template-columns: 1fr 1fr; }.recipe-save > div { grid-column: 1 / -1; }.recipe-save .primary { align-self: stretch; }.recipe-list article { grid-template-columns: 1fr; }.recipe-list article button { justify-self: end; } }
</style>
