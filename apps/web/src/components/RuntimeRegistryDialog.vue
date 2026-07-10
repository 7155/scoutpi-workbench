<template>
  <div v-if="open" class="registry-backdrop" @mousedown.self="$emit('close')">
    <section class="registry-dialog" role="dialog" aria-modal="true" aria-label="Runtime registry">
      <header>
        <div><p>Pi runtime</p><h2>Tool and skill registry</h2></div>
        <button class="icon-button" title="Close" @click="$emit('close')"><X :size="18" /></button>
      </header>
      <nav>
        <button v-for="tab in tabs" :key="tab.id" :class="{ active: active === tab.id }" @click="active = tab.id"><component :is="tab.icon" :size="15" />{{ tab.label }}<span>{{ tab.count }}</span></button>
      </nav>

      <div v-if="active === 'adapters'" class="registry-content">
        <div class="registry-list">
          <article v-for="row in adapters" :key="row.adapter.datasetId" :class="['adapter-row', { disabled: !row.enabled }]">
            <Database :size="16" />
            <div><strong>{{ row.adapter.title }}</strong><code>{{ row.adapter.datasetId }}</code><span>{{ row.adapter.roles.join(' · ') }}</span></div>
            <div class="registry-meta"><span :class="['verify-state', row.verification.status]">{{ row.verification.status.replace('_', ' ') }}</span><small>rev {{ row.revision }} · {{ row.adapter.scaleMeters }} m</small></div>
            <div class="registry-actions">
              <button title="Probe adapter against Earth Engine" :disabled="saving || !row.enabled" @click="$emit('probe', row.adapter.datasetId)"><ShieldCheck :size="14" /></button>
              <button :title="row.enabled ? 'Disable adapter' : 'Enable adapter'" :disabled="saving" @click="$emit('state', row.adapter.datasetId, !row.enabled)"><Power :size="14" /></button>
            </div>
          </article>
          <div v-if="!adapters.length" class="empty"><Blocks :size="25" /><span>No registered tool adapters.</span></div>
        </div>
        <form class="json-editor" @submit.prevent="submitRegistry">
          <label><span class="editor-title">Adapter or pack JSON<button type="button" title="Load adapter template" @click="loadTemplate('adapter')"><Braces :size="13" /></button></span><textarea v-model="registryJson" rows="9" spellcheck="false" required></textarea></label>
          <button class="primary" :disabled="saving"><LoaderCircle v-if="saving" class="spin" :size="15" /><Upload v-else :size="15" />Validate and import</button>
        </form>
      </div>

      <div v-else-if="active === 'skills'" class="registry-content">
        <div class="registry-list">
          <article v-for="skill in skills" :key="skill.skillId">
            <BookOpen :size="16" />
            <div><strong>{{ skill.name }}</strong><code>{{ skill.skillId }}</code><span>{{ skill.description }}</span></div>
            <button title="Publish skill to Pi" :disabled="saving" @click="$emit('publish', skill.skillId)"><Rocket :size="14" />Publish</button>
          </article>
          <div v-if="!skills.length" class="empty"><BookOpen :size="25" /><span>No generated skills.</span></div>
        </div>
        <form class="json-editor" @submit.prevent="submitSkill">
          <label><span class="editor-title">Skill definition JSON<button type="button" title="Load skill template" @click="loadTemplate('skill')"><Braces :size="13" /></button></span><textarea v-model="skillJson" rows="9" spellcheck="false" required></textarea></label>
          <button class="primary" :disabled="saving"><LoaderCircle v-if="saving" class="spin" :size="15" /><Save v-else :size="15" />Validate and save</button>
        </form>
      </div>

      <div v-else class="backend-grid">
        <article v-for="backend in backends" :key="backend.id" :class="{ installed: backend.installed }">
          <span class="backend-state"></span><div><strong>{{ backend.id }}</strong><p>{{ backend.purpose }}</p></div><code>{{ backend.installed ? backend.version || 'installed' : 'optional' }}</code>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw, ref } from "vue";
import { Blocks, BookOpen, Braces, Database, LoaderCircle, Power, Rocket, Save, ServerCog, ShieldCheck, Upload, X } from "lucide-vue-next";
import { api } from "../api";
import type { EarthSkillSummary, RegisteredAdapter, RuntimeBackend } from "../types";

const props = defineProps<{ open: boolean; saving: boolean; adapters: RegisteredAdapter[]; skills: EarthSkillSummary[]; backends: RuntimeBackend[] }>();
const emit = defineEmits<{ close: []; import: [payload: Record<string, unknown>]; probe: [datasetId: string]; state: [datasetId: string, enabled: boolean]; saveSkill: [payload: Record<string, unknown>]; publish: [skillId: string]; invalid: [message: string] }>();
const active = ref("adapters");
const registryJson = ref("");
const skillJson = ref("");
const tabs = computed(() => [
  { id: "adapters", label: "Tool adapters", icon: markRaw(Blocks), count: props.adapters.length },
  { id: "skills", label: "Skills", icon: markRaw(BookOpen), count: props.skills.length },
  { id: "backends", label: "Backends", icon: markRaw(ServerCog), count: props.backends.filter((row) => row.installed).length },
]);

function parse(value: string): Record<string, unknown> | undefined {
  try { const result = JSON.parse(value); if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("JSON must be an object"); return result; }
  catch (error) { emit("invalid", error instanceof Error ? error.message : String(error)); return undefined; }
}
function submitRegistry() { const value = parse(registryJson.value); if (value) emit("import", value); }
function submitSkill() { const value = parse(skillJson.value); if (value) emit("saveSkill", value); }
async function loadTemplate(name: "adapter" | "skill") {
  try {
    const result = await api.contract(name);
    const value = JSON.stringify(result.template, null, 2);
    if (name === "adapter") registryJson.value = value; else skillJson.value = value;
  } catch (error) { emit("invalid", error instanceof Error ? error.message : String(error)); }
}
</script>

<style scoped>
.registry-backdrop { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; padding: 18px; background: rgba(24, 31, 27, .48); backdrop-filter: blur(3px); }.registry-dialog { display: grid; grid-template-rows: auto auto minmax(0, 1fr); width: min(900px, 100%); max-height: min(760px, calc(100vh - 36px)); overflow: hidden; border: 1px solid #cfd7d2; border-radius: 8px; background: #fff; box-shadow: 0 24px 70px rgba(24, 38, 30, .25); }
header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid #e0e5e2; } header p { margin: 0 0 2px; color: #617168; font-size: 10px; font-weight: 700; text-transform: uppercase; } h2 { margin: 0; font-size: 19px; }.icon-button { display: grid; width: 34px; height: 34px; place-items: center; border: 1px solid #cfd7d2; border-radius: 5px; padding: 0; background: #fff; }
nav { display: grid; grid-template-columns: repeat(3, 1fr); border-bottom: 1px solid #dfe4e1; }nav button { display: flex; align-items: center; justify-content: center; gap: 6px; border: 0; border-right: 1px solid #e2e6e3; border-radius: 0; padding: 9px; background: #f7f9f7; color: #68756e; }nav button:last-child { border-right: 0; }nav button.active { box-shadow: inset 0 -2px #1f6846; background: #fff; color: #1f6846; font-weight: 700; }nav span { border-radius: 9px; padding: 1px 5px; background: #e7ece9; font-size: 9px; }
.registry-content { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(280px, .75fr); min-height: 0; }.registry-list { min-height: 260px; overflow: auto; padding: 12px 18px 18px; }.registry-list article { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; gap: 9px; align-items: start; border-bottom: 1px solid #e4e8e5; padding: 10px 0; color: #506057; }.registry-list article.adapter-row { grid-template-columns: 20px minmax(0, 1fr) auto auto; }.registry-list article.disabled { opacity: .55; }.registry-list article > div:nth-child(2) { display: grid; min-width: 0; gap: 3px; }.registry-list strong { overflow: hidden; color: #243129; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }.registry-list code { color: #2f7d59; font-size: 9px; }.registry-list span { overflow: hidden; color: #6e7b73; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }.registry-meta { display: grid; justify-items: end; gap: 3px; }.registry-meta small { color: #7a857f; font-size: 9px; white-space: nowrap; }.verify-state { border-radius: 8px; padding: 2px 6px; background: #edf0ee; color: #6d7972 !important; font-size: 8px !important; text-transform: uppercase; }.verify-state.passed { background: #dff1e7; color: #216845 !important; }.verify-state.failed { background: #f9e4e4; color: #9a3f46 !important; }.registry-actions { display: flex; gap: 4px; }.registry-actions button, .registry-list article > button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 29px; height: 29px; border: 1px solid #cad3cd; border-radius: 5px; padding: 5px 7px; background: #fff; color: #34423a; font-size: 10px; }.empty { display: grid; justify-items: center; gap: 7px; padding: 56px 0; color: #829087; font-size: 11px; }
.json-editor { display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 10px; border-left: 1px solid #e0e5e2; padding: 14px; background: #f7f9f7; }.json-editor label { display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 6px; }.json-editor label > span { color: #5c6a62; font-size: 10px; font-weight: 700; }.editor-title { display: flex; align-items: center; justify-content: space-between; }.editor-title button { display: grid; width: 25px; height: 23px; place-items: center; border: 1px solid #cad3cd; border-radius: 4px; padding: 0; background: #fff; color: #526159; }.json-editor textarea { width: 100%; min-height: 240px; resize: none; border: 1px solid #ccd5cf; border-radius: 5px; padding: 9px; background: #fff; color: #26342c; font: 10px/1.45 ui-monospace, SFMono-Regular, monospace; }.json-editor > button { justify-self: end; }.primary { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #1f6846; border-radius: 5px; padding: 8px 10px; background: #1f6846; color: #fff; font-weight: 700; }
.backend-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; overflow: auto; padding: 14px 18px 20px; }.backend-grid article { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; gap: 8px; align-items: start; border-bottom: 1px solid #e3e7e4; padding: 11px 0; }.backend-state { width: 8px; height: 8px; margin-top: 3px; border-radius: 50%; background: #a7b0ab; }.backend-grid article.installed .backend-state { background: #2f7d59; }.backend-grid article div { display: grid; gap: 3px; }.backend-grid strong { font-size: 11px; }.backend-grid p { margin: 0; color: #6d7972; font-size: 9px; }.backend-grid code { color: #718078; font-size: 9px; }.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 720px) { .registry-content { grid-template-columns: 1fr; overflow: auto; }.registry-list { overflow: visible; }.json-editor { border-top: 1px solid #e0e5e2; border-left: 0; }.backend-grid { grid-template-columns: 1fr; }nav button { font-size: 0; }nav button span { font-size: 9px; } }
</style>
