<template>
  <div v-if="open" class="registry-backdrop" @mousedown.self="$emit('close')">
    <section class="registry-dialog" role="dialog" aria-modal="true" aria-label="Runtime registry">
      <header>
        <div><p>Pi runtime</p><h2>Registry and telemetry</h2></div>
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

      <div v-else-if="active === 'backends'" class="backend-grid">
        <article v-for="backend in backendManifests" :key="backend.backendId" :class="{ installed: backendProbes[backend.backendId]?.available }">
          <span class="backend-state"></span>
          <div><strong>{{ backend.displayName }}</strong><code>{{ backend.backendId }}@{{ backend.version }}</code><p>{{ backend.description }}</p><span>{{ backend.capabilities.join(' · ') }}</span></div>
          <div class="backend-actions"><small>{{ probeLabel(backend.backendId) }}</small><button title="Probe backend" :disabled="saving" @click="$emit('probeBackend', backend.backendId)"><Radar :size="14" /></button></div>
        </article>
        <div v-if="!backendManifests.length" class="empty"><ServerCog :size="25" /><span>No reviewed backends.</span></div>
      </div>

      <div v-else class="telemetry-view">
        <section class="telemetry-metrics">
          <div><Activity :size="15" /><span>Events</span><strong>{{ telemetry?.eventCount || 0 }}</strong></div>
          <div><Gauge :size="15" /><span>Estimated tokens</span><strong>{{ formatNumber(telemetry?.estimatedTokens.total || 0) }}</strong></div>
          <div><Clock3 :size="15" /><span>Runtime</span><strong>{{ formatDuration(telemetry?.elapsedMs || 0) }}</strong></div>
          <div><Database :size="15" /><span>Pixel-years</span><strong>{{ formatNumber(telemetry?.cost.pixelYears || 0) }}</strong></div>
          <div><HardDriveDownload :size="15" /><span>Raster estimate</span><strong>{{ formatBytes(telemetry?.cost.estimatedRasterBytes || 0) }}</strong></div>
          <div><Coins :size="15" /><span>Reported model cost</span><strong>${{ modelCost.toFixed(4) }}</strong></div>
        </section>
        <div class="telemetry-columns">
          <section class="operation-ledger">
            <div class="telemetry-heading"><strong>Operation ledger</strong><span>{{ telemetry?.byOperation.length || 0 }}</span></div>
            <div class="operation-row operation-head"><span>Operation</span><span>Calls</span><span>Tokens</span><span>Time</span></div>
            <div v-for="row in telemetry?.byOperation.slice(0, 14) || []" :key="row.operation" class="operation-row"><code>{{ row.operation }}</code><span>{{ row.calls }}</span><span>{{ row.outputEstimatedTokens }}</span><span>{{ formatDuration(row.elapsedMs) }}</span></div>
            <div v-if="!telemetry?.byOperation.length" class="empty compact"><Activity :size="22" /><span>No runtime telemetry yet.</span></div>
          </section>
          <section class="agent-ledger">
            <div class="telemetry-heading"><strong>Agent runs</strong><span>{{ agentRuns.length }}</span></div>
            <article v-for="run in agentRuns.slice(0, 8)" :key="run.runId"><span :class="['run-state', run.state]"></span><div><code>{{ run.runId }}</code><small>{{ run.model || 'model unknown' }} · {{ run.toolCalls }} tools · {{ formatNumber(run.modelUsage.totalTokens) }} tokens</small></div><strong>${{ run.modelUsage.reportedCostUsd.toFixed(4) }}</strong></article>
            <div v-if="!agentRuns.length" class="empty compact"><Radio :size="22" /><span>No Pi run traces yet.</span></div>
            <div class="telemetry-heading approval-heading"><strong>Durable checkpoints</strong><span>{{ checkpoints.length }}</span></div>
            <article v-for="checkpoint in checkpoints.slice(0, 5)" :key="checkpoint.checkpointId" class="checkpoint-row"><History :size="14" /><div><code>{{ checkpoint.sessionId }}</code><small>{{ checkpoint.state }} · r{{ checkpoint.revision }} · {{ checkpoint.references.length }} refs<span v-if="checkpoint.recovery.recoverable"> · recoverable</span></small></div></article>
            <div v-if="!checkpoints.length" class="empty compact"><History :size="22" /><span>No durable checkpoints yet.</span></div>
            <div class="telemetry-heading approval-heading"><strong>Approvals</strong><span>{{ approvals.length }}</span></div>
            <article v-for="approval in approvals.slice(0, 5)" :key="approval.approvalId" class="approval-row"><ShieldCheck :size="14" /><div><code>{{ approval.operation }}</code><small>{{ approval.risk }} · {{ approval.state }}</small></div></article>
          </section>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw, ref } from "vue";
import { Activity, Blocks, BookOpen, Braces, Clock3, Coins, Database, Gauge, HardDriveDownload, History, LoaderCircle, Power, Radar, Radio, Rocket, Save, ServerCog, ShieldCheck, Upload, X } from "lucide-vue-next";
import { api } from "../api";
import type { AgentCheckpointSummary, AgentRunSummary, EarthBackendManifest, EarthBackendProbe, EarthSkillSummary, RegisteredAdapter, RuntimeApproval, RuntimeTelemetrySummary } from "../types";

const props = defineProps<{ open: boolean; saving: boolean; adapters: RegisteredAdapter[]; skills: EarthSkillSummary[]; backendManifests: EarthBackendManifest[]; backendProbes: Record<string, EarthBackendProbe>; telemetry?: RuntimeTelemetrySummary; agentRuns: AgentRunSummary[]; checkpoints: AgentCheckpointSummary[]; approvals: RuntimeApproval[] }>();
const emit = defineEmits<{ close: []; import: [payload: Record<string, unknown>]; probe: [datasetId: string]; probeBackend: [backendId: string]; state: [datasetId: string, enabled: boolean]; saveSkill: [payload: Record<string, unknown>]; publish: [skillId: string]; invalid: [message: string] }>();
const active = ref("adapters");
const registryJson = ref("");
const skillJson = ref("");
const tabs = computed(() => [
  { id: "adapters", label: "Tool adapters", icon: markRaw(Blocks), count: props.adapters.length },
  { id: "skills", label: "Skills", icon: markRaw(BookOpen), count: props.skills.length },
  { id: "backends", label: "Backends", icon: markRaw(ServerCog), count: props.backendManifests.length },
  { id: "telemetry", label: "Telemetry", icon: markRaw(Activity), count: props.agentRuns.length + props.checkpoints.length },
]);
const modelCost = computed(() => props.agentRuns.reduce((sum, run) => sum + run.modelUsage.reportedCostUsd, 0));

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
function probeLabel(backendId: string) { const probe = props.backendProbes[backendId]; return !probe ? "not probed" : probe.available ? probe.version || "available" : probe.reason || "unavailable"; }
function formatNumber(value: number) { return new Intl.NumberFormat(undefined, { notation: value >= 100_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value); }
function formatDuration(value: number) { return value < 1_000 ? `${Math.round(value)} ms` : `${(value / 1_000).toFixed(1)} s`; }
function formatBytes(value: number) { if (value < 1_024) return `${value} B`; if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`; return `${(value / 1_048_576).toFixed(1)} MB`; }
</script>

<style scoped>
.registry-backdrop { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; padding: 18px; background: rgba(24, 31, 27, .48); backdrop-filter: blur(3px); }.registry-dialog { display: grid; grid-template-rows: auto auto minmax(0, 1fr); width: min(900px, 100%); max-height: min(760px, calc(100vh - 36px)); overflow: hidden; border: 1px solid #cfd7d2; border-radius: 8px; background: #fff; box-shadow: 0 24px 70px rgba(24, 38, 30, .25); }
header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border-bottom: 1px solid #e0e5e2; } header p { margin: 0 0 2px; color: #617168; font-size: 10px; font-weight: 700; text-transform: uppercase; } h2 { margin: 0; font-size: 19px; }.icon-button { display: grid; width: 34px; height: 34px; place-items: center; border: 1px solid #cfd7d2; border-radius: 5px; padding: 0; background: #fff; }
nav { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid #dfe4e1; }nav button { display: flex; align-items: center; justify-content: center; gap: 6px; border: 0; border-right: 1px solid #e2e6e3; border-radius: 0; padding: 9px; background: #f7f9f7; color: #68756e; }nav button:last-child { border-right: 0; }nav button.active { box-shadow: inset 0 -2px #1f6846; background: #fff; color: #1f6846; font-weight: 700; }nav span { border-radius: 9px; padding: 1px 5px; background: #e7ece9; font-size: 9px; }
.registry-content { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(280px, .75fr); min-height: 0; }.registry-list { min-height: 260px; overflow: auto; padding: 12px 18px 18px; }.registry-list article { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; gap: 9px; align-items: start; border-bottom: 1px solid #e4e8e5; padding: 10px 0; color: #506057; }.registry-list article.adapter-row { grid-template-columns: 20px minmax(0, 1fr) auto auto; }.registry-list article.disabled { opacity: .55; }.registry-list article > div:nth-child(2) { display: grid; min-width: 0; gap: 3px; }.registry-list strong { overflow: hidden; color: #243129; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }.registry-list code { color: #2f7d59; font-size: 9px; }.registry-list span { overflow: hidden; color: #6e7b73; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }.registry-meta { display: grid; justify-items: end; gap: 3px; }.registry-meta small { color: #7a857f; font-size: 9px; white-space: nowrap; }.verify-state { border-radius: 8px; padding: 2px 6px; background: #edf0ee; color: #6d7972 !important; font-size: 8px !important; text-transform: uppercase; }.verify-state.passed { background: #dff1e7; color: #216845 !important; }.verify-state.failed { background: #f9e4e4; color: #9a3f46 !important; }.registry-actions { display: flex; gap: 4px; }.registry-actions button, .registry-list article > button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 29px; height: 29px; border: 1px solid #cad3cd; border-radius: 5px; padding: 5px 7px; background: #fff; color: #34423a; font-size: 10px; }.empty { display: grid; justify-items: center; gap: 7px; padding: 56px 0; color: #829087; font-size: 11px; }
.json-editor { display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 10px; border-left: 1px solid #e0e5e2; padding: 14px; background: #f7f9f7; }.json-editor label { display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 6px; }.json-editor label > span { color: #5c6a62; font-size: 10px; font-weight: 700; }.editor-title { display: flex; align-items: center; justify-content: space-between; }.editor-title button { display: grid; width: 25px; height: 23px; place-items: center; border: 1px solid #cad3cd; border-radius: 4px; padding: 0; background: #fff; color: #526159; }.json-editor textarea { width: 100%; min-height: 240px; resize: none; border: 1px solid #ccd5cf; border-radius: 5px; padding: 9px; background: #fff; color: #26342c; font: 10px/1.45 ui-monospace, SFMono-Regular, monospace; }.json-editor > button { justify-self: end; }.primary { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #1f6846; border-radius: 5px; padding: 8px 10px; background: #1f6846; color: #fff; font-weight: 700; }
.backend-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; overflow: auto; padding: 14px 18px 20px; }.backend-grid article { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; gap: 8px; align-items: start; border-bottom: 1px solid #e3e7e4; padding: 11px 0; }.backend-state { width: 8px; height: 8px; margin-top: 3px; border-radius: 50%; background: #a7b0ab; }.backend-grid article.installed .backend-state { background: #2f7d59; }.backend-grid article > div { display: grid; min-width: 0; gap: 3px; }.backend-grid strong { font-size: 11px; }.backend-grid p { margin: 0; color: #6d7972; font-size: 9px; }.backend-grid code, .backend-grid span { overflow: hidden; color: #718078; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }.backend-actions { justify-items: end; }.backend-actions small { max-width: 110px; overflow: hidden; color: #69776f; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }.backend-actions button { display: grid; width: 29px; height: 29px; place-items: center; border: 1px solid #cad3cd; border-radius: 5px; padding: 0; background: #fff; color: #34423a; }
.telemetry-view { min-height: 0; overflow: auto; }.telemetry-metrics { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); border-bottom: 1px solid #dfe4e1; background: #f8faf8; }.telemetry-metrics > div { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 2px 6px; align-items: center; border-right: 1px solid #e1e6e2; padding: 11px 12px; }.telemetry-metrics > div:last-child { border-right: 0; }.telemetry-metrics svg { grid-row: 1 / 3; color: #397259; }.telemetry-metrics span { color: #6e7a73; font-size: 8px; text-transform: uppercase; }.telemetry-metrics strong { overflow: hidden; color: #233129; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }.telemetry-columns { display: grid; grid-template-columns: 1.1fr .9fr; min-height: 300px; }.operation-ledger, .agent-ledger { min-width: 0; padding: 14px 18px 18px; }.agent-ledger { border-left: 1px solid #e0e5e2; }.telemetry-heading { display: flex; align-items: center; justify-content: space-between; padding: 2px 0 9px; color: #5d6a62; font-size: 10px; text-transform: uppercase; }.telemetry-heading span { border-radius: 8px; padding: 1px 5px; background: #edf1ee; font-size: 9px; }.operation-row { display: grid; grid-template-columns: minmax(0, 1fr) 46px 58px 58px; gap: 7px; align-items: center; border-top: 1px solid #e5e9e6; padding: 7px 0; color: #657269; font-size: 9px; }.operation-row code { overflow: hidden; color: #2d5f48; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }.operation-head { border: 0; padding-top: 0; color: #849087; font-size: 8px; text-transform: uppercase; }.agent-ledger article { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; gap: 8px; align-items: center; border-top: 1px solid #e5e9e6; padding: 8px 0; }.agent-ledger article > div { display: grid; min-width: 0; gap: 2px; }.agent-ledger code { overflow: hidden; color: #2d5f48; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }.agent-ledger small { overflow: hidden; color: #758178; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }.agent-ledger article > strong { font-size: 9px; }.run-state { width: 7px; height: 7px; border-radius: 50%; background: #9ca7a1; }.run-state.completed { background: #2f7d59; }.run-state.interrupted { background: #b7791f; }.run-state.running { background: #2f6fad; }.approval-heading { margin-top: 13px; }.agent-ledger article.approval-row, .agent-ledger article.checkpoint-row { grid-template-columns: 18px minmax(0, 1fr); }.approval-row svg { color: #7d6427; }.checkpoint-row svg { color: #2f6fad; }.empty.compact { padding: 24px 0; }.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 720px) { .registry-content { grid-template-columns: 1fr; overflow: auto; }.registry-list { overflow: visible; }.json-editor { border-top: 1px solid #e0e5e2; border-left: 0; }.backend-grid { grid-template-columns: 1fr; }.telemetry-metrics { grid-template-columns: repeat(2, 1fr); }.telemetry-columns { grid-template-columns: 1fr; }.agent-ledger { border-top: 1px solid #e0e5e2; border-left: 0; }nav button { font-size: 0; }nav button span { font-size: 9px; } }
</style>
