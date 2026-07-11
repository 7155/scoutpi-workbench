<template>
  <div v-if="open" class="runtime-backdrop" @mousedown.self="$emit('close')">
    <section class="runtime-dialog" role="dialog" aria-modal="true" aria-label="Runtime Center">
      <header class="runtime-header">
        <div class="runtime-title">
          <span class="runtime-mark"><Waypoints :size="18" /></span>
          <div><p>Pi control plane</p><h2>Runtime Center</h2></div>
          <span :class="['posture-badge', runtimeTone]">{{ runtimeStatusLabel }}</span>
        </div>
        <div class="header-actions">
          <button class="icon-button" title="Refresh runtime state" :disabled="saving" @click="$emit('refresh')"><RefreshCw :class="{ spin: saving }" :size="17" /></button>
          <button class="icon-button" title="Close" @click="$emit('close')"><X :size="18" /></button>
        </div>
      </header>

      <section class="runtime-summary" aria-label="Runtime summary">
        <div><Boxes :size="17" /><span>Pi tool surface</span><strong>3 gateways</strong><small>{{ mcpProfile ? `${mcpProfile.tools.length} MCP gateways isolated` : `${adapters.length} adapters` }}</small></div>
        <div><BrainCircuit :size="17" /><span>Context budget</span><strong>{{ latestContext ? formatNumber(latestContext.budget.deliveredTokens) : 0 }} tokens</strong><small>{{ latestContext ? `${latestContext.budget.selectedCount} selected items` : 'No active pack' }}</small></div>
        <div><ServerCog :size="17" /><span>Backend probes</span><strong>{{ availableBackends }}/{{ backendManifests.length }}</strong><small>{{ backendManifests.length ? 'available now' : 'No providers' }}</small></div>
        <div :class="{ attention: runtimeAttention > 0 }"><ShieldCheck :size="17" /><span>Operator queue</span><strong>{{ runtimeAttention }}</strong><small>{{ runtimeAttention ? 'review required' : 'No action required' }}</small></div>
      </section>

      <nav class="runtime-tabs" aria-label="Runtime views">
        <button v-for="tab in tabs" :key="tab.id" :class="{ active: active === tab.id }" :aria-current="active === tab.id ? 'page' : undefined" @click="active = tab.id">
          <component :is="tab.icon" :size="16" /><span class="tab-label">{{ tab.label }}</span><span v-if="tab.count !== undefined" class="tab-count">{{ tab.count }}</span>
        </button>
      </nav>

      <div v-if="active === 'overview'" class="overview-view">
        <section class="overview-column">
          <div class="section-title"><div><strong>Runtime layers</strong><span>Current execution posture</span></div><span>{{ runtimeLayers.filter((item) => item.tone === 'ready').length }}/{{ runtimeLayers.length }} ready</span></div>
          <article v-for="layer in runtimeLayers" :key="layer.id" class="layer-row">
            <span :class="['layer-icon', layer.tone]"><component :is="layer.icon" :size="16" /></span>
            <div><strong>{{ layer.title }}</strong><span>{{ layer.detail }}</span></div>
            <div class="layer-value"><strong>{{ layer.value }}</strong><span :class="['state-label', layer.tone]">{{ layer.state }}</span></div>
          </article>
        </section>

        <section class="overview-column queue-column">
          <div class="section-title"><div><strong>Operator queue</strong><span>Human decisions and recovery</span></div><span>{{ operatorQueue.length }}</span></div>
          <article v-for="item in operatorQueue" :key="item.id" class="queue-row">
            <span :class="['queue-icon', item.tone]"><component :is="item.icon" :size="15" /></span>
            <div><strong>{{ item.title }}</strong><span>{{ item.detail }}</span></div>
            <button v-if="item.tab" title="Open related runtime view" @click="active = item.tab"><ArrowUpRight :size="14" /></button>
          </article>
          <div v-if="!operatorQueue.length" class="empty-state compact"><CircleCheck :size="25" /><strong>Queue clear</strong><span>No approval, writeback, or recovery action is waiting.</span></div>

          <div class="section-title recent-run-title"><div><strong>Latest Agent run</strong><span>Provider-reported usage</span></div><span>{{ agentRuns.length }}</span></div>
          <article v-if="latestRun" class="latest-run">
            <div class="latest-run-head"><span :class="['run-state', latestRun.state]"></span><code>{{ latestRun.runId }}</code><span :class="['state-label', latestRun.state === 'completed' ? 'ready' : latestRun.state === 'running' ? 'active' : 'attention']">{{ latestRun.state }}</span></div>
            <strong>{{ latestRun.model || 'Model not reported' }}</strong>
            <div class="run-metrics"><span><b>{{ latestRun.turns }}</b> turns</span><span><b>{{ latestRun.toolCalls }}</b> tools</span><span><b>{{ formatNumber(latestRun.modelUsage.totalTokens) }}</b> tokens</span><span><b>${{ latestRun.modelUsage.reportedCostUsd.toFixed(4) }}</b> cost</span></div>
          </article>
          <div v-else class="empty-state compact"><Radio :size="24" /><strong>No Agent trace</strong><span>The next Pi run will appear here.</span></div>
        </section>
      </div>

      <div v-else-if="active === 'adapters'" class="registry-content">
        <section class="registry-list">
          <div class="section-title"><div><strong>Dataset adapters</strong><span>Versioned and probe-bound execution contracts</span></div><span>{{ adapters.length }}</span></div>
          <article v-for="row in adapters" :key="row.adapter.datasetId" :class="['adapter-row', { disabled: !row.enabled }]">
            <Database :size="17" />
            <div><strong>{{ row.adapter.title }}</strong><code>{{ row.adapter.datasetId }}</code><span>{{ row.adapter.roles.join(' · ') }}</span></div>
            <div class="registry-meta"><span :class="['verify-state', row.verification.status]">{{ row.verification.status.replace('_', ' ') }}</span><small>rev {{ row.revision }} · {{ row.adapter.scaleMeters }} m</small></div>
            <div class="registry-actions">
              <button title="Probe adapter against Earth Engine" :disabled="saving || !row.enabled" @click="$emit('probe', row.adapter.datasetId)"><ShieldCheck :size="15" /></button>
              <button :title="row.enabled ? 'Disable adapter' : 'Enable adapter'" :disabled="saving" @click="$emit('state', row.adapter.datasetId, !row.enabled)"><Power :size="15" /></button>
            </div>
          </article>
          <div v-if="!adapters.length" class="empty-state"><Blocks :size="27" /><strong>No adapters</strong><span>Import a reviewed adapter contract to begin.</span></div>
        </section>
        <form class="json-editor" @submit.prevent="submitRegistry">
          <div class="editor-heading"><div><strong>Import contract</strong><span>Adapter or pack JSON</span></div><button type="button" title="Load adapter template" @click="loadTemplate('adapter')"><Braces :size="14" /></button></div>
          <textarea v-model="registryJson" rows="9" spellcheck="false" aria-label="Adapter or pack JSON" required></textarea>
          <button class="primary" :disabled="saving"><LoaderCircle v-if="saving" class="spin" :size="15" /><Upload v-else :size="15" />Validate and import</button>
        </form>
      </div>

      <div v-else-if="active === 'skills'" class="registry-content">
        <section class="registry-list">
          <div class="section-title"><div><strong>Generated skills</strong><span>Reviewed workflows prepared for Pi</span></div><span>{{ skills.length }}</span></div>
          <article v-for="skill in skills" :key="skill.skillId" class="skill-row">
            <BookOpen :size="17" />
            <div><strong>{{ skill.name }}</strong><code>{{ skill.skillId }}</code><span>{{ skill.description }}</span></div>
            <button title="Publish skill to Pi" :disabled="saving" @click="$emit('publish', skill.skillId)"><Rocket :size="14" />Publish</button>
          </article>
          <div v-if="!skills.length" class="empty-state"><BookOpen :size="27" /><strong>No generated skills</strong><span>Validated skill drafts will remain reviewable here.</span></div>
        </section>
        <form class="json-editor" @submit.prevent="submitSkill">
          <div class="editor-heading"><div><strong>Save skill draft</strong><span>Declarative definition JSON</span></div><button type="button" title="Load skill template" @click="loadTemplate('skill')"><Braces :size="14" /></button></div>
          <textarea v-model="skillJson" rows="9" spellcheck="false" aria-label="Skill definition JSON" required></textarea>
          <button class="primary" :disabled="saving"><LoaderCircle v-if="saving" class="spin" :size="15" /><Save v-else :size="15" />Validate and save</button>
        </form>
      </div>

      <div v-else-if="active === 'backends'" class="backend-view">
        <div class="section-title"><div><strong>Reviewed backend providers</strong><span>Executable code stays behind typed contracts</span></div><span>{{ backendManifests.length }}</span></div>
        <div class="backend-grid">
          <article v-for="backend in backendManifests" :key="backend.backendId" :class="{ installed: backendProbes[backend.backendId]?.available }">
            <span class="backend-state"></span>
            <div><strong>{{ backend.displayName }}</strong><code>{{ backend.backendId }}@{{ backend.version }}</code><p>{{ backend.description }}</p><span>{{ backend.capabilities.join(' · ') }}</span><small>{{ backend.provider }} · {{ backend.operations.length }} operations</small></div>
            <div class="backend-actions"><small>{{ probeLabel(backend.backendId) }}</small><button title="Probe backend" :disabled="saving" @click="$emit('probeBackend', backend.backendId)"><Radar :size="15" /></button></div>
          </article>
          <div v-if="!backendManifests.length" class="empty-state"><ServerCog :size="27" /><strong>No reviewed backends</strong><span>Executable providers must be installed through the Backend SDK.</span></div>
        </div>
      </div>

      <div v-else-if="active === 'ecosystem'" class="ecosystem-view">
        <header class="ecosystem-heading">
          <div><strong>Pi extension ecosystem</strong><span>Operator-selected capabilities from the official package catalog</span></div>
          <a :href="piEcosystem?.officialCatalogUrl || 'https://pi.dev/packages?type=extension'" target="_blank" title="Open the official Pi extension catalog"><ArrowUpRight :size="15" /></a>
        </header>
        <section v-if="piEcosystem" class="ecosystem-summary">
          <div><strong>{{ piEcosystem.detectedCount }}/{{ piEcosystem.capabilities.length }}</strong><span>capability groups ready</span></div>
          <div><strong>{{ piEcosystem.toolCount }}</strong><span>installed tools inspected</span></div>
          <div><strong>{{ piEcosystem.commandCount }}</strong><span>slash commands inspected</span></div>
          <div><strong>{{ formatTime(piEcosystem.generatedAt) }}</strong><span>last Pi session scan</span></div>
        </section>
        <section v-if="piEcosystem" class="ecosystem-ledger">
          <article v-for="capability in piEcosystem.capabilities" :key="capability.id">
            <span :class="['ecosystem-state', { ready: capability.detected }]"></span>
            <div class="ecosystem-copy"><strong>{{ capability.label }}</strong><span>{{ capability.detected ? capability.reuse : capability.operatorAction }}</span><small>{{ [...capability.tools, ...capability.commands.map((command) => `/${command}`)].join(' · ') || 'No installed surface detected' }}</small></div>
            <div class="ecosystem-source"><code>{{ capability.sources.join(' · ') || 'official catalog' }}</code><small>{{ capability.scoutPiBoundary }}</small></div>
            <a :href="capability.catalogUrl" target="_blank" :title="`Review ${capability.label} packages in the official catalog`"><ArrowUpRight :size="14" /></a>
          </article>
        </section>
        <div v-else class="empty-state"><Boxes :size="27" /><strong>No Pi session scan</strong><span>Start Pi once to inspect installed tools, commands, and source metadata. ScoutPi never installs a package automatically.</span></div>
        <footer class="ecosystem-commands"><code v-for="command in piEcosystem?.packageCommands || defaultPackageCommands" :key="command">{{ command }}</code></footer>
      </div>

      <div v-else-if="active === 'context'" class="context-view">
        <section class="context-column">
          <div class="section-title"><div><strong>Context packs</strong><span>Task-ranked memory with source provenance</span></div><span>{{ contextPacks.length }}</span></div>
          <article v-for="pack in contextPacks.slice(0, 10)" :key="pack.packId" class="context-pack-row">
            <div class="context-row-head"><BrainCircuit :size="16" /><code>{{ pack.packId }}</code><time>{{ formatTime(pack.createdAt) }}</time></div>
            <div class="context-budget"><span :style="{ width: `${budgetPercent(pack)}%` }"></span></div>
            <div class="context-row-meta"><span>{{ pack.budget.selectedCount }}/{{ pack.budget.candidateCount }} items</span><span>{{ pack.budget.deliveredTokens }}/{{ pack.budget.maxTokens }} tokens</span><span>{{ pack.budget.estimator }}</span><span v-if="pack.budget.truncated" class="warning-text">truncated</span></div>
            <p v-if="pack.items[0]">{{ pack.items[0].text }}</p>
            <div class="provider-line">
              <span v-for="provider in pack.providers || []" :key="provider.providerId" :class="['provider-status', provider.state]" :title="provider.errorCode || `${provider.itemCount} candidates · ${provider.latencyMs} ms end to end${provider.sourceLatencyMs ? ` · ${provider.sourceLatencyMs} ms Core` : ''}`"><i></i>{{ provider.displayName }}<b v-if="provider.state === 'ready'">{{ Math.round(provider.latencyMs) }} ms · {{ provider.workerReused ? 'warm' : 'cold' }} · {{ provider.itemCount }}</b><b v-else>{{ provider.state }}</b></span>
              <span v-for="provider in pack.sourceProviders.filter((providerId) => !(pack.providers || []).some((status) => status.providerId === providerId))" :key="provider">{{ provider }}</span>
              <small v-if="!pack.sourceProviders.length && !(pack.providers || []).length">{{ pack.detectedMemoryTools.length ? `Delegated to ${pack.detectedMemoryTools.join(' · ')}` : 'No provider data' }}</small>
            </div>
          </article>
          <div v-if="!contextPacks.length" class="empty-state"><BrainCircuit :size="27" /><strong>No context pack</strong><span>The next Pi turn can assemble a bounded pack from installed memory providers.</span></div>
        </section>
        <section class="context-column context-runtime-column">
          <div class="section-title"><div><strong>Durable checkpoints</strong><span>Content-minimal recovery state</span></div><span>{{ checkpoints.length }}</span></div>
          <article v-for="checkpoint in checkpoints.slice(0, 6)" :key="checkpoint.checkpointId" class="context-state-row">
            <History :size="15" /><div><code>{{ checkpoint.sessionId }}</code><small>{{ checkpoint.state }} · r{{ checkpoint.revision }} · {{ checkpoint.references.length }} refs</small></div><span :class="['state-label', checkpoint.recovery.recoverable ? 'attention' : 'ready']">{{ checkpoint.recovery.recoverable ? 'recover' : 'settled' }}</span>
          </article>
          <div v-if="!checkpoints.length" class="empty-state compact"><History :size="24" /><strong>No checkpoint</strong><span>No interrupted session needs recovery.</span></div>
          <div class="section-title writeback-heading"><div><strong>Writeback review</strong><span>Provider outbox, never silent mutation</span></div><span>{{ contextWritebacks.length }}</span></div>
          <article v-for="writeback in contextWritebacks.slice(0, 8)" :key="writeback.writebackId" class="context-state-row">
            <CircleCheck v-if="writebackState(writeback) === 'delivered'" :size="15" />
            <CircleX v-else-if="writebackState(writeback) === 'rejected' || writebackState(writeback) === 'failed'" :size="15" />
            <Hourglass v-else :size="15" />
            <div><code>{{ writeback.writebackId }}</code><small>{{ writeback.candidates.length }} candidates · {{ writebackDeliveryDetail(writeback) }}</small></div><span :class="['state-label', writebackStateTone(writeback)]">{{ writebackState(writeback) }}</span>
          </article>
          <div v-if="!contextWritebacks.length" class="empty-state compact"><Hourglass :size="24" /><strong>No writeback</strong><span>Runtime learning candidates will wait here for review.</span></div>
        </section>
      </div>

      <AutomationPanel v-else-if="active === 'automation'" :triggers="triggers" :runs="triggerRuns" :grants="delegations" :workflows="workflows" :saving="saving" @create="$emit('createTrigger', $event)" @approve="$emit('approveTrigger', $event)" @state="(id, state) => $emit('triggerState', id, state)" @invoke="$emit('invokeTrigger', $event)" />

      <div v-else class="telemetry-view">
        <section class="telemetry-metrics">
          <div><Activity :size="17" /><span>Events</span><strong>{{ telemetry?.eventCount || 0 }}</strong></div>
          <div><Gauge :size="17" /><span>Estimated tokens</span><strong>{{ formatNumber(telemetry?.estimatedTokens.total || 0) }}</strong></div>
          <div><Clock3 :size="17" /><span>Runtime</span><strong>{{ formatDuration(telemetry?.elapsedMs || 0) }}</strong></div>
          <div><Database :size="17" /><span>Pixel-years</span><strong>{{ formatNumber(telemetry?.cost.pixelYears || 0) }}</strong></div>
          <div><HardDriveDownload :size="17" /><span>Raster estimate</span><strong>{{ formatBytes(telemetry?.cost.estimatedRasterBytes || 0) }}</strong></div>
          <div><Coins :size="17" /><span>Reported cost</span><strong>${{ modelCost.toFixed(4) }}</strong></div>
        </section>
        <div class="telemetry-columns">
          <section class="operation-ledger">
            <div class="section-title"><div><strong>Operation ledger</strong><span>Output budget and elapsed time</span></div><span>{{ telemetry?.byOperation.length || 0 }}</span></div>
            <div class="operation-row operation-head"><span>Operation</span><span>Calls</span><span>Tokens</span><span>Time</span></div>
            <div v-for="row in telemetry?.byOperation.slice(0, 14) || []" :key="row.operation" class="operation-row">
              <div><code>{{ row.operation }}</code><span class="token-bar"><i :class="{ failed: row.failures > 0 }" :style="{ width: `${operationPercent(row.outputEstimatedTokens)}%` }"></i></span></div><span>{{ row.calls }}</span><span>{{ row.outputEstimatedTokens }}</span><span>{{ formatDuration(row.elapsedMs) }}</span>
            </div>
            <div v-if="!telemetry?.byOperation.length" class="empty-state compact"><Activity :size="24" /><strong>No telemetry</strong><span>Runtime operations will be aggregated here.</span></div>
          </section>
          <section class="agent-ledger">
            <div class="section-title"><div><strong>Agent runs</strong><span>Exact provider usage when reported</span></div><span>{{ agentRuns.length }}</span></div>
            <article v-for="run in agentRuns.slice(0, 8)" :key="run.runId"><span :class="['run-state', run.state]"></span><div><code>{{ run.runId }}</code><small>{{ run.model || 'model unknown' }} · {{ run.turns }} turns · {{ run.toolCalls }} tools · {{ formatNumber(run.modelUsage.totalTokens) }} tokens</small></div><strong>${{ run.modelUsage.reportedCostUsd.toFixed(4) }}</strong></article>
            <div v-if="!agentRuns.length" class="empty-state compact"><Radio :size="24" /><strong>No Agent runs</strong><span>Pi lifecycle traces will appear here.</span></div>
            <div class="section-title approval-heading"><div><strong>Approval receipts</strong><span>Bound to exact call parameters</span></div><span>{{ approvals.length }}</span></div>
            <article v-for="approval in approvals.slice(0, 6)" :key="approval.approvalId" class="approval-row"><ShieldCheck :size="15" /><div><code>{{ approval.operation }}</code><small>{{ approval.risk }} risk · {{ approval.state }} · {{ formatTime(approval.approvedAt) }}</small></div><span :class="['state-label', approval.state === 'pending' ? 'attention' : 'ready']">{{ approval.state }}</span></article>
          </section>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw, onBeforeUnmount, onMounted, ref } from "vue";
import { Activity, ArrowUpRight, Blocks, BookOpen, Boxes, Braces, BrainCircuit, CircleCheck, CircleX, Clock3, Coins, Database, Gauge, HardDriveDownload, History, Hourglass, LoaderCircle, Network, Power, Radar, Radio, RefreshCw, Rocket, Save, ServerCog, ShieldCheck, TimerReset, Upload, Waypoints, X } from "lucide-vue-next";
import { api } from "../api";
import AutomationPanel from "./AutomationPanel.vue";
import type { AgentCheckpointSummary, AgentRunSummary, ContextPackSummary, ContextWritebackSummary, DelegationGrantSummary, EarthBackendManifest, EarthBackendProbe, EarthSkillSummary, EarthWorkflowSummary, PiEcosystemProfile, RegisteredAdapter, RuntimeApproval, RuntimeTelemetrySummary, ScoutPiMcpProfile, TriggerRun, WorkflowTrigger } from "../types";

type RuntimeTab = "overview" | "adapters" | "skills" | "backends" | "ecosystem" | "context" | "automation" | "telemetry";
type RuntimeTone = "ready" | "active" | "idle" | "attention" | "blocked";

const props = defineProps<{ open: boolean; saving: boolean; adapters: RegisteredAdapter[]; skills: EarthSkillSummary[]; backendManifests: EarthBackendManifest[]; backendProbes: Record<string, EarthBackendProbe>; telemetry?: RuntimeTelemetrySummary; agentRuns: AgentRunSummary[]; checkpoints: AgentCheckpointSummary[]; contextPacks: ContextPackSummary[]; contextWritebacks: ContextWritebackSummary[]; evidenceCount: number; mcpProfile?: ScoutPiMcpProfile; piEcosystem?: PiEcosystemProfile; triggers: WorkflowTrigger[]; triggerRuns: TriggerRun[]; delegations: DelegationGrantSummary[]; workflows: EarthWorkflowSummary[]; approvals: RuntimeApproval[] }>();
const emit = defineEmits<{ close: []; refresh: []; import: [payload: Record<string, unknown>]; probe: [datasetId: string]; probeBackend: [backendId: string]; state: [datasetId: string, enabled: boolean]; saveSkill: [payload: Record<string, unknown>]; publish: [skillId: string]; createTrigger: [payload: Record<string, unknown>]; approveTrigger: [triggerId: string]; triggerState: [triggerId: string, state: "paused" | "active" | "revoked"]; invokeTrigger: [triggerId: string]; invalid: [message: string] }>();
const active = ref<RuntimeTab>("overview");
const registryJson = ref("");
const skillJson = ref("");
const defaultPackageCommands = ["pi list", "pi config", "pi install npm:<reviewed-package>"];

const availableBackends = computed(() => Object.values(props.backendProbes).filter((probe) => probe.available).length);
const pendingWritebacks = computed(() => props.contextWritebacks.filter((item) => item.state === "pending"));
const undeliveredWritebacks = computed(() => props.contextWritebacks.filter((item) => item.state === "approved" && !item.deliveries?.some((delivery) => delivery.state === "delivered")));
const recoverableCheckpoints = computed(() => props.checkpoints.filter((item) => item.recovery.recoverable));
const pendingApprovals = computed(() => props.approvals.filter((item) => item.state === "pending"));
const interruptedRuns = computed(() => props.agentRuns.filter((item) => item.state === "interrupted"));
const pendingTriggers = computed(() => props.triggers.filter((item) => item.state === "draft"));
const runtimeAttention = computed(() => pendingWritebacks.value.length + undeliveredWritebacks.value.length + recoverableCheckpoints.value.length + pendingApprovals.value.length + interruptedRuns.value.length + pendingTriggers.value.length);
const runtimeTone = computed<RuntimeTone>(() => runtimeAttention.value ? "attention" : props.agentRuns.some((item) => item.state === "running") ? "active" : "ready");
const runtimeStatusLabel = computed(() => runtimeAttention.value ? `${runtimeAttention.value} to review` : runtimeTone.value === "active" ? "Agent running" : "Operational");
const latestContext = computed(() => [...props.contextPacks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]);
const latestRun = computed(() => [...props.agentRuns].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]);
const modelCost = computed(() => props.agentRuns.reduce((sum, run) => sum + run.modelUsage.reportedCostUsd, 0));
const maxOperationTokens = computed(() => Math.max(1, ...(props.telemetry?.byOperation.map((item) => item.outputEstimatedTokens) || [1])));
const tabs = computed(() => [
  { id: "overview" as const, label: "Overview", icon: markRaw(Waypoints), count: runtimeAttention.value || undefined },
  { id: "adapters" as const, label: "Adapters", icon: markRaw(Blocks), count: props.adapters.length },
  { id: "skills" as const, label: "Skills", icon: markRaw(BookOpen), count: props.skills.length },
  { id: "backends" as const, label: "Backends", icon: markRaw(ServerCog), count: props.backendManifests.length },
  { id: "ecosystem" as const, label: "Extensions", icon: markRaw(Boxes), count: props.piEcosystem?.detectedCount },
  { id: "context" as const, label: "Context", icon: markRaw(BrainCircuit), count: props.contextPacks.length + props.contextWritebacks.length },
  { id: "automation" as const, label: "Automation", icon: markRaw(TimerReset), count: props.triggers.length },
  { id: "telemetry" as const, label: "Telemetry", icon: markRaw(Activity), count: props.agentRuns.length },
]);
const runtimeLayers = computed(() => [
  { id: "surface", title: "Pi tool surface", detail: `${props.adapters.length} dataset contracts behind a compact gateway`, value: "3 gateways", state: "bounded", tone: "ready" as RuntimeTone, icon: markRaw(Boxes) },
  { id: "context", title: "Context engineering", detail: latestContext.value ? `${latestContext.value.sourceProviders.length} providers · ${latestContext.value.budget.deliveredTokens}/${latestContext.value.budget.maxTokens} tokens` : "Waiting for the next task-ranked pack", value: latestContext.value ? `${latestContext.value.budget.selectedCount} items` : "No pack", state: latestContext.value ? "ready" : "idle", tone: latestContext.value ? "ready" as RuntimeTone : "idle" as RuntimeTone, icon: markRaw(BrainCircuit) },
  { id: "governance", title: "Execution governance", detail: `${props.approvals.length} receipts · ${pendingWritebacks.value.length} decisions · ${undeliveredWritebacks.value.length} deliveries`, value: runtimeAttention.value ? `${runtimeAttention.value} review` : "Clear", state: runtimeAttention.value ? "attention" : "ready", tone: runtimeAttention.value ? "attention" as RuntimeTone : "ready" as RuntimeTone, icon: markRaw(ShieldCheck) },
  { id: "continuity", title: "Durable continuity", detail: `${props.checkpoints.length} session checkpoints with integrity journals`, value: recoverableCheckpoints.value.length ? `${recoverableCheckpoints.value.length} recover` : "Settled", state: recoverableCheckpoints.value.length ? "attention" : "ready", tone: recoverableCheckpoints.value.length ? "attention" as RuntimeTone : "ready" as RuntimeTone, icon: markRaw(History) },
  { id: "evidence", title: "Evidence bridge", detail: "Browser sources normalized into provenance-bound investigation records", value: `${props.evidenceCount} sources`, state: props.evidenceCount ? "connected" : "idle", tone: props.evidenceCount ? "ready" as RuntimeTone : "idle" as RuntimeTone, icon: markRaw(Radio) },
  { id: "mcp", title: "MCP compatibility", detail: props.mcpProfile ? `${props.mcpProfile.transport} · external clients · state-changing operations blocked` : "Compatibility profile unavailable", value: props.mcpProfile ? `${props.mcpProfile.tools.length} gateways` : "Offline", state: props.mcpProfile ? "available" : "idle", tone: props.mcpProfile ? "ready" as RuntimeTone : "idle" as RuntimeTone, icon: markRaw(Network) },
  { id: "ecosystem", title: "Pi extension market", detail: props.piEcosystem ? `${props.piEcosystem.toolCount} tools · ${props.piEcosystem.commandCount} commands · operator-controlled packages` : "Waiting for a Pi session capability scan", value: props.piEcosystem ? `${props.piEcosystem.detectedCount}/${props.piEcosystem.capabilities.length}` : "Not scanned", state: props.piEcosystem ? "inspected" : "idle", tone: props.piEcosystem ? "ready" as RuntimeTone : "idle" as RuntimeTone, icon: markRaw(Boxes) },
  { id: "automation", title: "Event automation", detail: `${props.delegations.filter((item) => item.state === "active").length} signed delegations · ${props.triggerRuns.length} durable runs`, value: `${props.triggers.filter((item) => item.state === "active").length} active`, state: pendingTriggers.value.length ? `${pendingTriggers.value.length} review` : "bounded", tone: pendingTriggers.value.length ? "attention" as RuntimeTone : "ready" as RuntimeTone, icon: markRaw(TimerReset) },
  { id: "backends", title: "Backend providers", detail: `${props.backendManifests.length} reviewed manifests, executable code kept outside the model`, value: `${availableBackends.value}/${props.backendManifests.length}`, state: Object.keys(props.backendProbes).length ? "probed" : "not probed", tone: availableBackends.value ? "ready" as RuntimeTone : "idle" as RuntimeTone, icon: markRaw(ServerCog) },
]);
const operatorQueue = computed(() => [
  ...pendingWritebacks.value.slice(0, 3).map((item) => ({ id: item.writebackId, title: "Memory writeback awaiting decision", detail: `${item.candidates.length} candidates · ${item.providerTargets.join(" · ") || "provider outbox"}`, tone: "attention" as RuntimeTone, icon: markRaw(BrainCircuit), tab: "context" as RuntimeTab })),
  ...undeliveredWritebacks.value.slice(0, 2).map((item) => ({ id: `delivery:${item.writebackId}`, title: item.deliveries?.some((delivery) => delivery.state === "failed") ? "Memory provider delivery failed" : "Approved memory awaiting provider", detail: writebackDeliveryDetail(item), tone: item.deliveries?.some((delivery) => delivery.state === "failed") ? "blocked" as RuntimeTone : "attention" as RuntimeTone, icon: markRaw(BrainCircuit), tab: "context" as RuntimeTab })),
  ...pendingTriggers.value.slice(0, 3).map((item) => ({ id: item.triggerId, title: "Trigger delegation awaiting review", detail: `${item.name} · ${item.workflowId}`, tone: "attention" as RuntimeTone, icon: markRaw(TimerReset), tab: "automation" as RuntimeTab })),
  ...recoverableCheckpoints.value.slice(0, 2).map((item) => ({ id: item.checkpointId, title: "Interrupted session can recover", detail: `${item.sessionId} · ${item.references.length} durable references`, tone: "active" as RuntimeTone, icon: markRaw(History), tab: "context" as RuntimeTab })),
  ...pendingApprovals.value.slice(0, 2).map((item) => ({ id: item.approvalId, title: `${item.operation} receipt not consumed`, detail: `${item.risk} risk · expires ${formatTime(item.expiresAt)}`, tone: "attention" as RuntimeTone, icon: markRaw(ShieldCheck), tab: "telemetry" as RuntimeTab })),
  ...interruptedRuns.value.slice(0, 1).map((item) => ({ id: item.runId, title: "Agent run interrupted", detail: `${item.model || "model unknown"} · ${item.toolCalls} tool calls`, tone: "blocked" as RuntimeTone, icon: markRaw(Radio), tab: "telemetry" as RuntimeTab })),
].slice(0, 6));

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
function writebackState(writeback: ContextWritebackSummary) { if (writeback.state !== "approved") return writeback.state; if (writeback.deliveries?.some((delivery) => delivery.state === "delivered")) return "delivered"; if (writeback.deliveries?.some((delivery) => delivery.state === "failed")) return "failed"; return writeback.deliveries?.length ? "staged" : "approved"; }
function writebackStateTone(writeback: ContextWritebackSummary): RuntimeTone { const state = writebackState(writeback); return state === "delivered" ? "ready" : state === "rejected" || state === "failed" ? "blocked" : "attention"; }
function writebackDeliveryDetail(writeback: ContextWritebackSummary) { const delivery = writeback.deliveries?.[0]; if (!delivery) return writeback.providerTargets.join(" · ") || "provider outbox"; if (delivery.state === "delivered") return `${delivery.providerId} · ${delivery.receipt?.itemCount || writeback.candidates.length} delivered${delivery.receipt?.duplicateCount ? ` · ${delivery.receipt.duplicateCount} deduped` : ""}`; if (delivery.state === "failed") return `${delivery.providerId} · ${delivery.errorCode || "delivery failed"}`; return `${delivery.providerId} · staged`; }
function budgetPercent(pack: ContextPackSummary) { return Math.min(100, pack.budget.maxTokens ? pack.budget.deliveredTokens / pack.budget.maxTokens * 100 : 0); }
function operationPercent(tokens: number) { return Math.max(tokens ? 5 : 0, Math.min(100, tokens / maxOperationTokens.value * 100)); }
function formatNumber(value: number) { return new Intl.NumberFormat(undefined, { notation: value >= 100_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value); }
function formatDuration(value: number) { return value < 1_000 ? `${Math.round(value)} ms` : value < 60_000 ? `${(value / 1_000).toFixed(1)} s` : `${(value / 60_000).toFixed(1)} min`; }
function formatBytes(value: number) { if (value < 1_024) return `${value} B`; if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`; return `${(value / 1_048_576).toFixed(1)} MB`; }
function formatTime(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : value; }
function onKeydown(event: KeyboardEvent) { if (props.open && event.key === "Escape") emit("close"); }
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<style scoped>
.runtime-backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(22, 29, 26, .52);
  backdrop-filter: blur(4px);
}
.runtime-dialog {
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  width: min(1060px, 100%);
  height: min(760px, calc(100vh - 36px));
  min-height: 590px;
  overflow: hidden;
  border: 1px solid #cbd4cf;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 28px 80px rgba(20, 34, 27, .3);
}
.runtime-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  min-height: 68px;
  padding: 13px 16px;
  border-bottom: 1px solid #e0e5e2;
}
.runtime-title { display: flex; align-items: center; min-width: 0; gap: 11px; }
.runtime-mark { display: grid; width: 36px; height: 36px; flex: 0 0 auto; place-items: center; border-radius: 6px; background: #183f31; color: #fff; }
.runtime-title > div { display: grid; min-width: 0; }
.runtime-title p { margin: 0 0 1px; color: #68766e; font-size: 10px; font-weight: 750; text-transform: uppercase; }
.runtime-title h2 { margin: 0; color: #1d2922; font-size: 20px; line-height: 1.15; }
.posture-badge, .state-label { border-radius: 999px; padding: 3px 8px; background: #edf1ef; color: #637168; font-size: 9px; font-weight: 750; text-transform: uppercase; white-space: nowrap; }
.posture-badge.ready, .state-label.ready { background: #dff1e7; color: #216845; }
.posture-badge.active, .state-label.active { background: #e1ecf7; color: #2c6392; }
.posture-badge.attention, .state-label.attention { background: #fff0cf; color: #875f0c; }
.state-label.blocked { background: #f8e2e4; color: #943f49; }
.header-actions { display: flex; gap: 7px; }
.icon-button { display: grid; width: 34px; height: 34px; place-items: center; border: 1px solid #cfd7d2; border-radius: 5px; padding: 0; background: #fff; color: #334139; }
.icon-button:hover:not(:disabled) { border-color: #81958a; background: #f7f9f8; }

.runtime-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid #dfe5e1; background: #f6f8f7; }
.runtime-summary > div { display: grid; grid-template: auto auto / 22px minmax(0, 1fr); gap: 1px 8px; align-items: center; min-width: 0; padding: 10px 14px; border-right: 1px solid #e0e5e2; }
.runtime-summary > div:last-child { border-right: 0; }
.runtime-summary svg { grid-row: 1 / 3; color: #2f6fad; }
.runtime-summary > div:nth-child(1) svg, .runtime-summary > div:nth-child(3) svg { color: #287153; }
.runtime-summary > div.attention svg { color: #a56c0b; }
.runtime-summary span { color: #6d7a72; font-size: 9px; text-transform: uppercase; }
.runtime-summary strong { overflow: hidden; color: #243129; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.runtime-summary small { grid-column: 2; overflow: hidden; color: #7b8780; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }

.runtime-tabs { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); border-bottom: 1px solid #dfe4e1; }
.runtime-tabs button { display: flex; min-width: 0; align-items: center; justify-content: center; gap: 6px; border: 0; border-right: 1px solid #e3e7e4; border-radius: 0; padding: 10px 8px; background: #fbfcfb; color: #69776f; font-size: 11px; }
.runtime-tabs button:last-child { border-right: 0; }
.runtime-tabs button:hover { background: #f5f8f6; color: #34423a; }
.runtime-tabs button.active { box-shadow: inset 0 -2px #1f6846; background: #fff; color: #1f6846; font-weight: 750; }
.tab-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tab-count { min-width: 17px; border-radius: 9px; padding: 1px 5px; background: #e8edea; color: #647169; font-size: 9px; font-weight: 700; }
.runtime-tabs button.active .tab-count { background: #dff0e6; color: #216845; }

.overview-view { display: grid; grid-template-columns: 1.06fr .94fr; min-height: 0; overflow: hidden; }
.overview-column { min-width: 0; overflow: auto; padding: 17px 19px 22px; }
.queue-column { border-left: 1px solid #dfe5e1; background: #fbfcfb; }
.section-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 1px 0 10px; }
.section-title > div { display: grid; gap: 1px; min-width: 0; }
.section-title strong { color: #28352e; font-size: 11px; text-transform: uppercase; }
.section-title > div > span { overflow: hidden; color: #829087; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.section-title > span { min-width: 19px; border-radius: 9px; padding: 2px 6px; background: #edf1ef; color: #69766f; font-size: 9px; text-align: center; }
.layer-row { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px; align-items: center; min-height: 67px; border-top: 1px solid #e3e8e5; }
.layer-icon, .queue-icon { display: grid; width: 30px; height: 30px; place-items: center; border-radius: 6px; background: #edf1ef; color: #617168; }
.layer-icon.ready, .queue-icon.ready { background: #e3f0e8; color: #246849; }
.layer-icon.active, .queue-icon.active { background: #e5eef7; color: #2e6797; }
.layer-icon.attention, .queue-icon.attention { background: #fff0cf; color: #91630d; }
.layer-icon.blocked, .queue-icon.blocked { background: #f7e3e5; color: #98414c; }
.layer-row > div:nth-child(2), .queue-row > div { display: grid; min-width: 0; gap: 3px; }
.layer-row > div:nth-child(2) strong, .queue-row strong { overflow: hidden; color: #2a3730; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.layer-row > div:nth-child(2) span, .queue-row span { display: -webkit-box; overflow: hidden; color: #748179; font-size: 9px; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.layer-value { display: grid; justify-items: end; gap: 4px; }
.layer-value > strong { color: #314038; font-size: 11px; white-space: nowrap; }
.queue-row { display: grid; grid-template-columns: 32px minmax(0, 1fr) 30px; gap: 9px; align-items: center; min-height: 58px; border-top: 1px solid #e3e8e5; }
.queue-row button { display: grid; width: 28px; height: 28px; place-items: center; border: 1px solid #d2dad5; border-radius: 5px; padding: 0; background: #fff; color: #526159; }
.recent-run-title { margin-top: 18px; }
.latest-run { display: grid; gap: 8px; border-top: 1px solid #e3e8e5; padding: 13px 0 0; }
.latest-run-head { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; gap: 8px; align-items: center; }
.latest-run code, .context-row-head code, .context-state-row code, .registry-list code, .backend-grid code, .agent-ledger code { overflow: hidden; color: #2d5f48; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.latest-run > strong { font-size: 12px; }
.run-metrics { display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid #e4e8e5; }
.run-metrics span { display: grid; gap: 1px; border-right: 1px solid #e4e8e5; padding: 8px 7px 0; color: #7a867f; font-size: 9px; }
.run-metrics span:first-child { padding-left: 0; }
.run-metrics span:last-child { border-right: 0; }
.run-metrics b { color: #314038; font-size: 11px; }

.registry-content { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(300px, .65fr); min-height: 0; overflow: hidden; }
.registry-list { min-height: 0; overflow: auto; padding: 17px 19px 22px; }
.registry-list article { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 10px; align-items: start; border-top: 1px solid #e3e8e5; padding: 11px 0; color: #506057; }
.registry-list article.adapter-row { grid-template-columns: 22px minmax(0, 1fr) auto auto; }
.registry-list article.disabled { opacity: .55; }
.registry-list article > svg { margin-top: 1px; color: #48705c; }
.registry-list article > div:nth-child(2) { display: grid; min-width: 0; gap: 3px; }
.registry-list article > div:nth-child(2) strong { overflow: hidden; color: #243129; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.registry-list article > div:nth-child(2) span { overflow: hidden; color: #6e7b73; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.registry-meta { display: grid; justify-items: end; gap: 4px; }
.registry-meta small { color: #7a857f; font-size: 9px; white-space: nowrap; }
.verify-state { border-radius: 999px; padding: 3px 7px; background: #edf0ee; color: #6d7972; font-size: 8px; font-weight: 750; text-transform: uppercase; }
.verify-state.passed { background: #dff1e7; color: #216845; }
.verify-state.failed { background: #f9e4e4; color: #9a3f46; }
.registry-actions { display: flex; gap: 5px; }
.registry-actions button, .registry-list article > button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 31px; height: 31px; border: 1px solid #cad3cd; border-radius: 5px; padding: 5px 8px; background: #fff; color: #34423a; font-size: 10px; }
.json-editor { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 10px; min-height: 0; border-left: 1px solid #e0e5e2; padding: 16px; background: #f6f8f7; }
.editor-heading { display: flex; align-items: center; justify-content: space-between; }
.editor-heading > div { display: grid; gap: 1px; }
.editor-heading strong { color: #344139; font-size: 11px; text-transform: uppercase; }
.editor-heading span { color: #7a877f; font-size: 9px; }
.editor-heading button { display: grid; width: 28px; height: 27px; place-items: center; border: 1px solid #cad3cd; border-radius: 4px; padding: 0; background: #fff; color: #526159; }
.json-editor textarea { width: 100%; min-height: 240px; resize: none; border: 1px solid #ccd5cf; border-radius: 5px; padding: 10px; background: #fff; color: #26342c; font: 10px/1.5 ui-monospace, SFMono-Regular, monospace; }
.json-editor textarea:focus { outline: 2px solid rgba(47, 111, 173, .16); border-color: #4f83b5; }
.json-editor > button { justify-self: end; }
.primary { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #1f6846; border-radius: 5px; padding: 8px 11px; background: #1f6846; color: #fff; font-weight: 750; }

.backend-view { min-height: 0; overflow: auto; padding: 17px 19px 22px; }
.backend-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }
.backend-grid article { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; gap: 9px; align-items: start; min-height: 126px; border-top: 1px solid #e3e7e4; padding: 13px 0; }
.backend-state { width: 8px; height: 8px; margin-top: 4px; border-radius: 50%; background: #a7b0ab; }
.backend-grid article.installed .backend-state { background: #2f7d59; box-shadow: 0 0 0 3px rgba(47, 125, 89, .12); }
.backend-grid article > div { display: grid; min-width: 0; gap: 4px; }
.backend-grid strong { font-size: 12px; }
.backend-grid p { display: -webkit-box; overflow: hidden; margin: 0; color: #66746c; font-size: 10px; line-height: 1.4; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.backend-grid span { overflow: hidden; color: #61766b; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.backend-grid article > div > small { color: #87928c; font-size: 9px; }
.backend-actions { justify-items: end; }
.backend-actions small { max-width: 120px; overflow: hidden; color: #69776f; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.backend-actions button { display: grid; width: 31px; height: 31px; place-items: center; border: 1px solid #cad3cd; border-radius: 5px; padding: 0; background: #fff; color: #34423a; }

.ecosystem-view { display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; min-height: 0; overflow: hidden; }
.ecosystem-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid #e0e5e2; padding: 14px 19px; }
.ecosystem-heading > div { display: grid; gap: 2px; }
.ecosystem-heading strong { color: #28352e; font-size: 12px; text-transform: uppercase; }
.ecosystem-heading span { color: #7a877f; font-size: 9px; }
.ecosystem-heading a, .ecosystem-ledger article > a { display: grid; width: 30px; height: 30px; place-items: center; border: 1px solid #d1d9d4; border-radius: 5px; background: #fff; color: #526159; }
.ecosystem-summary { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid #e0e5e2; background: #f7f9f8; }
.ecosystem-summary > div { display: grid; gap: 2px; border-right: 1px solid #e0e5e2; padding: 10px 15px; }
.ecosystem-summary > div:last-child { border-right: 0; }
.ecosystem-summary strong { color: #27362e; font-size: 12px; }
.ecosystem-summary span { color: #76837b; font-size: 8px; text-transform: uppercase; }
.ecosystem-ledger { min-height: 0; overflow: auto; padding: 0 19px; }
.ecosystem-ledger article { display: grid; grid-template-columns: 10px minmax(0, 1fr) minmax(200px, .8fr) 30px; gap: 10px; align-items: center; min-height: 73px; border-bottom: 1px solid #e4e8e5; }
.ecosystem-state { width: 8px; height: 8px; border-radius: 50%; background: #a7b0ab; }
.ecosystem-state.ready { background: #2f7d59; box-shadow: 0 0 0 3px rgba(47, 125, 89, .12); }
.ecosystem-copy, .ecosystem-source { display: grid; min-width: 0; gap: 3px; }
.ecosystem-copy strong { color: #2a3730; font-size: 11px; }
.ecosystem-copy span, .ecosystem-source small { display: -webkit-box; overflow: hidden; color: #6f7c74; font-size: 9px; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.ecosystem-copy small { overflow: hidden; color: #3d6c55; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.ecosystem-source code { overflow: hidden; color: #52675b; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.ecosystem-commands { display: flex; flex-wrap: wrap; gap: 6px; border-top: 1px solid #dfe5e1; padding: 10px 19px; background: #f7f9f8; }
.ecosystem-commands code { border: 1px solid #dce3df; border-radius: 3px; padding: 3px 6px; background: #fff; color: #52645a; font-size: 8px; }

.context-view { display: grid; grid-template-columns: 1.08fr .92fr; min-height: 0; overflow: hidden; }
.context-column { min-width: 0; overflow: auto; padding: 17px 19px 22px; }
.context-runtime-column { border-left: 1px solid #e0e5e2; background: #fbfcfb; }
.context-pack-row { display: grid; gap: 8px; border-top: 1px solid #e1e6e2; padding: 12px 0; }
.context-row-head { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; gap: 7px; align-items: center; }
.context-row-head svg { color: #2f6fad; }
.context-row-head time { color: #7d8982; font-size: 9px; }
.context-budget { height: 5px; overflow: hidden; border-radius: 2px; background: #e5ebe7; }
.context-budget span { display: block; height: 100%; background: #2f7d59; }
.context-row-meta { display: flex; flex-wrap: wrap; gap: 10px; color: #718078; font-size: 9px; text-transform: uppercase; }
.warning-text { color: #986611; }
.context-pack-row p { display: -webkit-box; overflow: hidden; margin: 0; color: #445249; font-size: 10px; line-height: 1.45; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.provider-line { display: flex; flex-wrap: wrap; gap: 5px; }
.provider-line span { border-radius: 3px; padding: 2px 5px; background: #e9eef5; color: #42678b; font-size: 8px; }
.provider-line .provider-status { display: inline-flex; align-items: center; gap: 4px; background: #eef2f0; color: #53635a; }.provider-status i { width: 5px; height: 5px; border-radius: 50%; background: #9ba69f; }.provider-status b { color: #7b8780; font-size: 8px; font-weight: 650; }.provider-status.ready { background: #e4f1e9; color: #216845; }.provider-status.ready i { background: #2a8057; }.provider-status.failed { background: #f7e6e7; color: #94434b; }.provider-status.failed i { background: #b64e57; }.provider-status.unavailable { background: #f2eee4; color: #806425; }.provider-status.unavailable i { background: #ad8126; }
.provider-line small { color: #819087; font-size: 9px; }
.context-state-row { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; gap: 8px; align-items: center; border-top: 1px solid #e2e7e4; padding: 10px 0; }
.context-state-row > svg { color: #527363; }
.context-state-row > div { display: grid; min-width: 0; gap: 3px; }
.context-state-row small { overflow: hidden; color: #76837b; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.writeback-heading { margin-top: 20px; }

.telemetry-view { min-height: 0; overflow: auto; }
.telemetry-metrics { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); border-bottom: 1px solid #dfe4e1; background: #f7f9f8; }
.telemetry-metrics > div { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 2px 7px; align-items: center; min-width: 0; border-right: 1px solid #e1e6e2; padding: 12px 13px; }
.telemetry-metrics > div:last-child { border-right: 0; }
.telemetry-metrics svg { grid-row: 1 / 3; color: #397259; }
.telemetry-metrics > div:nth-child(2) svg, .telemetry-metrics > div:nth-child(6) svg { color: #2f6fad; }
.telemetry-metrics span { color: #6e7a73; font-size: 8px; text-transform: uppercase; }
.telemetry-metrics strong { overflow: hidden; color: #233129; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.telemetry-columns { display: grid; grid-template-columns: 1.08fr .92fr; min-height: 0; }
.operation-ledger, .agent-ledger { min-width: 0; padding: 17px 19px 22px; }
.agent-ledger { border-left: 1px solid #e0e5e2; }
.operation-row { display: grid; grid-template-columns: minmax(0, 1fr) 48px 62px 68px; gap: 8px; align-items: center; min-height: 38px; border-top: 1px solid #e5e9e6; color: #657269; font-size: 10px; }
.operation-row > div { display: grid; min-width: 0; gap: 4px; }
.token-bar { display: block; height: 3px; overflow: hidden; background: #e7ece9; }
.token-bar i { display: block; height: 100%; background: #3d7a5f; }
.token-bar i.failed { background: #ad5963; }
.operation-head { min-height: 28px; border: 0; color: #849087; font-size: 8px; text-transform: uppercase; }
.agent-ledger article { display: grid; grid-template-columns: 9px minmax(0, 1fr) auto; gap: 9px; align-items: center; border-top: 1px solid #e5e9e6; padding: 10px 0; }
.agent-ledger article > div { display: grid; min-width: 0; gap: 3px; }
.agent-ledger small { overflow: hidden; color: #758178; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.agent-ledger article > strong { font-size: 10px; }
.run-state { width: 8px; height: 8px; border-radius: 50%; background: #9ca7a1; }
.run-state.completed { background: #2f7d59; }
.run-state.interrupted { background: #b44e5a; }
.run-state.running { background: #2f6fad; box-shadow: 0 0 0 3px rgba(47, 111, 173, .12); }
.approval-heading { margin-top: 18px; }
.agent-ledger article.approval-row { grid-template-columns: 20px minmax(0, 1fr) auto; }
.approval-row svg { color: #7d6427; }

.empty-state { display: grid; justify-items: center; gap: 5px; padding: 58px 18px; color: #829087; text-align: center; }
.empty-state strong { color: #65736b; font-size: 11px; }
.empty-state span { max-width: 300px; font-size: 9px; line-height: 1.4; }
.empty-state.compact { padding: 28px 12px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 820px) {
  .runtime-dialog { min-height: 0; }
  .runtime-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .runtime-summary > div:nth-child(2) { border-right: 0; }
  .runtime-summary > div:nth-child(-n+2) { border-bottom: 1px solid #e0e5e2; }
  .runtime-tabs { display: flex; overflow-x: auto; }
  .runtime-tabs button { flex: 0 0 106px; }
  .overview-view, .context-view, .telemetry-columns, .registry-content { grid-template-columns: 1fr; overflow: auto; }
  .overview-column, .context-column, .operation-ledger, .agent-ledger, .registry-list { overflow: visible; }
  .queue-column, .context-runtime-column, .agent-ledger, .json-editor { border-top: 1px solid #e0e5e2; border-left: 0; }
  .backend-grid { grid-template-columns: 1fr; }
  .ecosystem-ledger article { grid-template-columns: 10px minmax(0, 1fr) minmax(160px, .7fr) 30px; }
  .telemetry-metrics { grid-template-columns: repeat(3, 1fr); }
  .telemetry-metrics > div:nth-child(3), .telemetry-metrics > div:nth-child(6) { border-right: 0; }
  .telemetry-metrics > div:nth-child(-n+3) { border-bottom: 1px solid #e1e6e2; }
}
@media (max-width: 520px) {
  .runtime-backdrop { place-items: start center; padding: 10px; overflow: auto; }
  .runtime-dialog { width: 100%; height: min(824px, calc(100vh - 20px)); border-radius: 7px; }
  .runtime-header { min-height: 62px; padding: 11px 12px; }
  .runtime-mark { width: 32px; height: 32px; }
  .runtime-title h2 { font-size: 18px; }
  .posture-badge { display: none; }
  .runtime-summary > div { padding: 9px 10px; }
  .runtime-summary strong { font-size: 11px; }
  .runtime-tabs button { flex-basis: 52px; padding: 10px 5px; }
  .runtime-tabs .tab-label { display: none; }
  .overview-column, .context-column, .operation-ledger, .agent-ledger, .registry-list, .backend-view { padding: 14px 16px 18px; }
  .layer-row { grid-template-columns: 32px minmax(0, 1fr); }
  .layer-value { grid-column: 2; grid-row: 2; display: flex; justify-items: initial; align-items: center; gap: 7px; margin-top: -8px; }
  .run-metrics { grid-template-columns: repeat(2, 1fr); }
  .run-metrics span:nth-child(2) { border-right: 0; }
  .registry-list article.adapter-row { grid-template-columns: 20px minmax(0, 1fr) auto; }
  .registry-meta { grid-column: 2; justify-items: start; }
  .registry-actions { grid-column: 3; grid-row: 1 / 3; }
  .json-editor { min-height: 420px; }
  .backend-grid article { grid-template-columns: 10px minmax(0, 1fr); }
  .backend-actions { grid-column: 2; display: flex !important; align-items: center; justify-content: space-between; }
  .ecosystem-summary { grid-template-columns: repeat(2, 1fr); }
  .ecosystem-summary > div:nth-child(2) { border-right: 0; }
  .ecosystem-summary > div:nth-child(-n+2) { border-bottom: 1px solid #e0e5e2; }
  .ecosystem-ledger { overflow: visible; padding: 0 16px; }
  .ecosystem-view { overflow: auto; }
  .ecosystem-ledger article { grid-template-columns: 10px minmax(0, 1fr) 30px; align-items: start; padding: 10px 0; }
  .ecosystem-source { grid-column: 2; }
  .ecosystem-ledger article > a { grid-column: 3; grid-row: 1 / 3; }
  .ecosystem-commands { padding: 10px 16px; }
  .telemetry-metrics { grid-template-columns: repeat(2, 1fr); }
  .telemetry-metrics > div:nth-child(odd) { border-right: 1px solid #e1e6e2; }
  .telemetry-metrics > div:nth-child(even) { border-right: 0; }
  .telemetry-metrics > div:nth-child(-n+4) { border-bottom: 1px solid #e1e6e2; }
  .operation-row { grid-template-columns: minmax(0, 1fr) 38px 48px 52px; gap: 5px; font-size: 9px; }
}
</style>
