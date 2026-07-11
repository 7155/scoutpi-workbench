<template>
  <div class="automation-view">
    <section class="automation-statusbar" :aria-label="t('Automation posture')">
      <div class="posture-copy">
        <span class="posture-icon"><ShieldCheck :size="17" /></span>
        <div>
          <span>{{ t('Delegation posture') }}</span>
          <strong>{{ activeTriggers.length ? t('count.active', { count: activeTriggers.length }) : t('No active delegation') }}</strong>
        </div>
      </div>
      <div class="posture-metrics">
        <div><span>{{ t('Review') }}</span><strong>{{ reviewTriggers.length }}</strong></div>
        <div><span>{{ t('Completed') }}</span><strong>{{ completedRuns.length }}</strong></div>
        <div><span>{{ t('Success') }}</span><strong>{{ successRate }}</strong></div>
      </div>
      <span class="scope-badge"><LockKeyhole :size="12" />{{ t('Dry-run replay only') }}</span>
    </section>

    <section class="trigger-column">
      <div class="automation-heading">
        <div><strong>{{ t('Durable triggers') }}</strong><span>{{ t('Identity-bound workflow authorization') }}</span></div>
        <span>{{ triggers.length }}</span>
      </div>
      <div class="trigger-list">
        <article v-for="trigger in orderedTriggers" :key="trigger.triggerId" :class="['trigger-row', trigger.state]">
          <div class="trigger-head">
            <span :class="['trigger-kind', trigger.condition.kind]"><component :is="conditionIcon(trigger)" :size="15" /></span>
            <div>
              <strong>{{ trigger.name }}</strong>
              <code>{{ trigger.triggerId }}</code>
            </div>
            <span :class="['trigger-state', trigger.state]">{{ statusLabel(trigger.state) }}</span>
          </div>

          <div class="trigger-contract">
            <span :title="t('Workflow')"><GitBranch :size="12" />{{ trigger.workflowId }}</span>
            <span :title="trigger.subject.principalId"><Fingerprint :size="12" />{{ trigger.subject.displayName }}</span>
            <span :title="t('Trigger condition')"><Clock3 :size="12" />{{ conditionLabel(trigger) }}</span>
          </div>

          <div class="grant-line">
            <div class="grant-copy">
              <span><KeyRound :size="12" />{{ grantLabel(trigger) }}</span>
              <span>{{ usedRuns(trigger) }}/{{ trigger.limits.maxRuns }} {{ t('Runs') }}</span>
            </div>
            <div class="grant-progress" aria-hidden="true"><i :style="{ width: `${grantProgress(trigger)}%` }"></i></div>
            <div class="trigger-limits">
              <span>{{ trigger.limits.cooldownSeconds }}s {{ t('cooldown') }}</span>
              <span>{{ t('expires') }} {{ formatDate(trigger.limits.expiresAt) }}</span>
            </div>
          </div>

          <div class="trigger-actions">
            <button v-if="trigger.state === 'draft' || (trigger.state === 'paused' && grantByTrigger.get(trigger.triggerId)?.state !== 'active')" class="primary-action" :title="t('Authorize dry-run delegation')" :disabled="saving" @click="$emit('approve', trigger.triggerId)"><ShieldCheck :size="14" />{{ t('Authorize') }}</button>
            <button v-if="trigger.state === 'paused' && grantByTrigger.get(trigger.triggerId)?.state === 'active'" :title="t('Resume trigger')" :disabled="saving" @click="$emit('state', trigger.triggerId, 'active')"><Play :size="14" />{{ t('Resume') }}</button>
            <button v-if="trigger.state === 'active'" :title="t('Invoke once with a unique idempotency key')" :disabled="saving" @click="$emit('invoke', trigger.triggerId)"><Play :size="14" />{{ t('Run now') }}</button>
            <button v-if="trigger.state === 'active'" class="icon-action" :aria-label="t('Pause trigger')" :title="t('Pause trigger')" :disabled="saving" @click="$emit('state', trigger.triggerId, 'paused')"><Pause :size="14" /></button>
            <button v-if="trigger.state !== 'revoked'" class="icon-action danger" :aria-label="t('Revoke trigger')" :title="t('Revoke trigger and delegation')" :disabled="saving" @click="revoke(trigger)"><Ban :size="14" /></button>
          </div>
        </article>
      </div>
      <div v-if="!triggers.length" class="automation-empty"><TimerReset :size="25" /><strong>{{ t('No durable trigger') }}</strong><span>{{ t('Reviewed workflows can be scheduled without adding another model tool.') }}</span></div>
    </section>

    <section class="automation-side">
      <form class="trigger-form" @submit.prevent="submit">
        <div class="automation-heading"><div><strong>{{ t('New trigger draft') }}</strong><span>{{ t('Authorization remains a separate operator action') }}</span></div><Plus :size="16" /></div>
        <label><span>{{ t('Name') }}</span><input v-model.trim="name" maxlength="160" :placeholder="t('Weekly evidence review')" required /></label>
        <label><span>{{ t('Ready workflow') }}</span><select v-model="workflowId" required><option value="" disabled>{{ t('Select workflow') }}</option><option v-for="workflow in readyWorkflows" :key="workflow.workflowId" :value="workflow.workflowId">{{ workflow.name }}</option></select></label>
        <div class="condition-switch" :aria-label="t('Trigger condition')">
          <button type="button" :class="{ active: kind === 'manual' }" :aria-pressed="kind === 'manual'" @click="kind = 'manual'"><MousePointerClick :size="14" />{{ t('Manual') }}</button>
          <button type="button" :class="{ active: kind === 'interval' }" :aria-pressed="kind === 'interval'" @click="kind = 'interval'"><Clock3 :size="14" />{{ t('Interval') }}</button>
          <button type="button" :class="{ active: kind === 'event' }" :aria-pressed="kind === 'event'" @click="kind = 'event'"><Radio :size="14" />{{ t('Event') }}</button>
        </div>
        <label v-if="kind === 'interval'"><span>{{ t('Every minutes') }}</span><input v-model.number="everyMinutes" type="number" min="1" max="10080" required /></label>
        <label v-if="kind === 'event'"><span>{{ t('Event name') }}</span><input v-model.trim="eventName" maxlength="100" pattern="[A-Za-z0-9][A-Za-z0-9._:-]+" placeholder="browser.evidence.imported" required /></label>
        <div class="limit-grid">
          <label><span>{{ t('Maximum runs') }}</span><input v-model.number="maxRuns" type="number" min="1" max="1000" required /></label>
          <label><span>{{ t('Cooldown seconds') }}</span><input v-model.number="cooldownSeconds" type="number" min="0" max="86400" required /></label>
          <label><span>{{ t('Expires in days') }}</span><input v-model.number="expiryDays" type="number" min="1" max="365" required /></label>
        </div>
        <button class="create-trigger" :disabled="saving || !readyWorkflows.length"><LoaderCircle v-if="saving" class="spin" :size="15" /><Plus v-else :size="15" />{{ t('Create draft') }}</button>
        <div v-if="!readyWorkflows.length" class="form-state"><TriangleAlert :size="14" /><span>{{ t('No reviewed dry-run workflow is ready.') }}</span></div>
      </form>

      <div class="run-ledger">
        <div class="automation-heading"><div><strong>{{ t('Trigger runs') }}</strong><span>{{ t('Idempotent replay ledger') }}</span></div><span>{{ runs.length }}</span></div>
        <article v-for="run in orderedRuns.slice(0, 10)" :key="run.runId">
          <span :class="['run-dot', run.state]"></span>
          <div><code>{{ run.triggerId }}</code><small>{{ run.eventKey }} · {{ formatTime(run.startedAt) }}</small></div>
          <span :class="['run-status', run.state]">{{ statusLabel(run.state) }}</span>
        </article>
        <div v-if="!runs.length" class="automation-empty compact"><History :size="22" /><strong>{{ t('No trigger run') }}</strong><span>{{ t('The execution ledger is empty.') }}</span></div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { Ban, Clock3, Fingerprint, GitBranch, History, KeyRound, LoaderCircle, LockKeyhole, MousePointerClick, Pause, Play, Plus, Radio, ShieldCheck, TimerReset, TriangleAlert } from "lucide-vue-next";
import { useI18n } from "../i18n";
import type { DelegationGrantSummary, EarthWorkflowSummary, TriggerRun, WorkflowTrigger } from "../types";

const props = defineProps<{ triggers: WorkflowTrigger[]; runs: TriggerRun[]; grants: DelegationGrantSummary[]; workflows: EarthWorkflowSummary[]; saving: boolean }>();
const emit = defineEmits<{ create: [input: Record<string, unknown>]; approve: [triggerId: string]; state: [triggerId: string, state: "paused" | "active" | "revoked"]; invoke: [triggerId: string] }>();
const { locale, isChinese, t, statusLabel } = useI18n();
const name = ref("");
const workflowId = ref("");
const kind = ref<"manual" | "interval" | "event">("manual");
const everyMinutes = ref(60);
const eventName = ref("browser.evidence.imported");
const maxRuns = ref(30);
const cooldownSeconds = ref(60);
const expiryDays = ref(30);

const readyWorkflows = computed(() => props.workflows.filter((workflow) => workflow.stage === "ready" && workflow.executionKind === "run"));
const grantByTrigger = computed(() => new Map(props.grants.map((grant) => [grant.triggerId, grant])));
const activeTriggers = computed(() => props.triggers.filter((trigger) => trigger.state === "active"));
const reviewTriggers = computed(() => props.triggers.filter((trigger) => trigger.state === "draft"));
const completedRuns = computed(() => props.runs.filter((run) => run.state === "completed"));
const finishedRuns = computed(() => props.runs.filter((run) => run.state === "completed" || run.state === "failed" || run.state === "blocked"));
const successRate = computed(() => finishedRuns.value.length ? `${Math.round(completedRuns.value.length / finishedRuns.value.length * 100)}%` : "--");
const orderedTriggers = computed(() => [...props.triggers].sort((a, b) => triggerRank(a.state) - triggerRank(b.state) || b.updatedAt.localeCompare(a.updatedAt)));
const orderedRuns = computed(() => [...props.runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt)));

function triggerRank(state: WorkflowTrigger["state"]) { return state === "draft" ? 0 : state === "active" ? 1 : state === "paused" ? 2 : 3; }
function conditionIcon(trigger: WorkflowTrigger) { return trigger.condition.kind === "manual" ? MousePointerClick : trigger.condition.kind === "interval" ? Clock3 : Radio; }
function conditionLabel(trigger: WorkflowTrigger) { return trigger.condition.kind === "manual" ? t("Manual") : trigger.condition.kind === "interval" ? t("every {{count}}m", { count: trigger.condition.everyMinutes }) : trigger.condition.eventName; }
function usedRuns(trigger: WorkflowTrigger) { return grantByTrigger.value.get(trigger.triggerId)?.usedRuns || 0; }
function grantProgress(trigger: WorkflowTrigger) { return Math.min(100, trigger.limits.maxRuns ? usedRuns(trigger) / trigger.limits.maxRuns * 100 : 0); }
function grantLabel(trigger: WorkflowTrigger) { const grant = grantByTrigger.value.get(trigger.triggerId); return grant ? t("{{state}} grant", { state: statusLabel(grant.state) }) : t("not authorized"); }
function formatDate(value: string) { return new Intl.DateTimeFormat(locale.value, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)); }
function formatTime(value: string) { return new Intl.DateTimeFormat(locale.value, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function revoke(trigger: WorkflowTrigger) { const message = isChinese.value ? `撤销 ${trigger.name} 及其委托？` : `Revoke ${trigger.name} and its delegation?`; if (window.confirm(message)) emit("state", trigger.triggerId, "revoked"); }
function submit() {
  const condition = kind.value === "manual" ? { kind: "manual" } : kind.value === "interval" ? { kind: "interval", everyMinutes: everyMinutes.value } : { kind: "event", eventName: eventName.value };
  emit("create", { name: name.value, workflowId: workflowId.value, condition, limits: { maxRuns: maxRuns.value, cooldownSeconds: cooldownSeconds.value, expiresAt: new Date(Date.now() + expiryDays.value * 86_400_000).toISOString() } });
  name.value = "";
}
</script>

<style scoped>
.automation-view { display: grid; grid-template: auto minmax(0, 1fr) / minmax(0, 1.35fr) minmax(300px, .85fr); min-height: 0; overflow: hidden; }
.automation-statusbar { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 18px; min-height: 58px; padding: 9px 16px; border-bottom: 1px solid #dfe5e1; background: #f6f8f7; }
.posture-copy { display: flex; min-width: 0; align-items: center; gap: 9px; }.posture-icon { display: grid; width: 31px; height: 31px; flex: 0 0 auto; place-items: center; border-radius: 6px; background: #dff0e7; color: #1e6b48; }.posture-copy > div { display: grid; min-width: 0; gap: 1px; }.posture-copy span, .posture-metrics span { color: #748178; font-size: 8px; font-weight: 750; text-transform: uppercase; }.posture-copy strong { overflow: hidden; color: #26342c; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.posture-metrics { display: grid; grid-template-columns: repeat(3, 64px); }.posture-metrics > div { display: grid; gap: 1px; border-left: 1px solid #dce3df; padding-left: 10px; }.posture-metrics strong { color: #29372f; font-size: 12px; }.scope-badge { display: inline-flex; align-items: center; gap: 5px; border: 1px solid #ced9d3; border-radius: 999px; padding: 5px 8px; background: #fff; color: #526159; font-size: 8px; font-weight: 750; text-transform: uppercase; white-space: nowrap; }
.trigger-column, .automation-side { min-width: 0; overflow: auto; padding: 14px 16px 18px; }.automation-side { border-left: 1px solid #e0e5e2; background: #fafbfa; }
.automation-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; color: #647169; }.automation-heading > div { display: grid; min-width: 0; gap: 1px; }.automation-heading strong { color: #2b382f; font-size: 11px; text-transform: uppercase; }.automation-heading span { overflow: hidden; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.trigger-list { display: grid; gap: 8px; }
.trigger-row { position: relative; display: grid; gap: 9px; overflow: hidden; border: 1px solid #dce3df; border-radius: 7px; padding: 11px 12px; background: #fff; }.trigger-row::before { position: absolute; inset: 0 auto 0 0; width: 3px; background: #a7b2ac; content: ""; }.trigger-row.active::before { background: #2b8158; }.trigger-row.draft::before { background: #d29125; }.trigger-row.revoked { background: #fafafa; opacity: .72; }.trigger-row.revoked::before { background: #ae555d; }
.trigger-head { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; align-items: center; gap: 9px; }.trigger-head > div { display: grid; gap: 2px; min-width: 0; }.trigger-head strong { overflow: hidden; color: #26342c; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }.trigger-head code { overflow: hidden; color: #748078; font-size: 9px; text-overflow: ellipsis; }
.trigger-kind { display: grid; width: 30px; height: 30px; place-items: center; border-radius: 6px; background: #e5f1eb; color: #21734e; }.trigger-kind.interval { background: #e7eef8; color: #356aa0; }.trigger-kind.event { background: #f5eddb; color: #9a6917; }
.trigger-state, .run-status { border-radius: 999px; padding: 3px 7px; background: #edf1ef; color: #657168; font-size: 8px; font-weight: 800; text-transform: uppercase; }.trigger-state.active, .run-status.completed { background: #dff1e7; color: #17623f; }.trigger-state.draft { background: #fff0cb; color: #8a5e12; }.trigger-state.revoked, .run-status.failed, .run-status.blocked { background: #f5e4e5; color: #963b42; }.run-status.running { background: #e2edf7; color: #2f6897; }
.trigger-contract { display: flex; min-width: 0; flex-wrap: wrap; gap: 6px 13px; padding-left: 39px; color: #66736b; font-size: 9px; }.trigger-contract span { display: flex; min-width: 0; align-items: center; gap: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.grant-line { display: grid; gap: 5px; padding-left: 39px; }.grant-copy, .trigger-limits { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #718078; font-size: 8px; }.grant-copy span:first-child { display: inline-flex; align-items: center; gap: 4px; color: #4d5e54; font-weight: 700; }.trigger-limits { justify-content: flex-start; gap: 12px; color: #8a958f; }.grant-progress { height: 3px; overflow: hidden; border-radius: 2px; background: #e6ebe8; }.grant-progress i { display: block; height: 100%; border-radius: inherit; background: #2d8059; transition: width .25s ease; }
.trigger-actions { display: flex; justify-content: flex-end; gap: 6px; }.trigger-actions button, .create-trigger { display: inline-flex; min-height: 30px; align-items: center; justify-content: center; gap: 6px; border: 1px solid #cbd5cf; border-radius: 5px; background: #fff; color: #33433a; font: inherit; font-size: 10px; font-weight: 750; cursor: pointer; }.trigger-actions button { padding: 0 9px; }.trigger-actions button:hover:not(:disabled) { border-color: #79a68d; color: #17623f; }.trigger-actions .primary-action { border-color: #246f4e; background: #246f4e; color: #fff; }.trigger-actions .primary-action:hover:not(:disabled) { border-color: #195f40; background: #195f40; color: #fff; }.trigger-actions .icon-action { width: 30px; padding: 0; }.trigger-actions .danger:hover:not(:disabled) { border-color: #c8878c; color: #9b3039; }button:disabled { cursor: not-allowed; opacity: .5; }
.trigger-form { display: grid; gap: 10px; padding-bottom: 14px; }.trigger-form label { display: grid; gap: 4px; color: #65726a; font-size: 9px; font-weight: 750; }.trigger-form input, .trigger-form select { min-width: 0; height: 34px; border: 1px solid #ccd6d0; border-radius: 5px; background: #fff; padding: 0 9px; color: #26332c; font: inherit; font-size: 11px; outline: none; }.trigger-form input:focus, .trigger-form select:focus { border-color: #3d8b64; box-shadow: 0 0 0 2px rgba(61,139,100,.12); }
.condition-switch { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid #ccd6d0; border-radius: 5px; overflow: hidden; }.condition-switch button { display: flex; height: 32px; align-items: center; justify-content: center; gap: 5px; border: 0; border-right: 1px solid #dbe1dd; background: #fff; color: #66736b; font: inherit; font-size: 9px; font-weight: 750; cursor: pointer; }.condition-switch button:last-child { border-right: 0; }.condition-switch button.active { background: #e6f1eb; color: #17623f; }
.limit-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }.create-trigger { border-color: #1f6a48; background: #1f6a48; color: #fff; }.create-trigger:hover:not(:disabled) { background: #185a3c; }.form-state { display: flex; align-items: center; gap: 6px; border-left: 2px solid #d29227; padding: 4px 7px; color: #80601f; font-size: 9px; }
.run-ledger { border-top: 1px solid #dfe5e1; padding-top: 13px; }.run-ledger article { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 8px 0; border-top: 1px solid #e6eae7; }.run-ledger article > div { display: grid; gap: 2px; min-width: 0; }.run-ledger code { overflow: hidden; color: #3d4c43; font-size: 9px; text-overflow: ellipsis; }.run-ledger small { overflow: hidden; color: #839087; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }.run-dot { width: 7px; height: 7px; border-radius: 50%; background: #a3ada7; }.run-dot.completed { background: #2c8a5d; }.run-dot.failed, .run-dot.blocked { background: #c5535b; }.run-dot.running { background: #3f76aa; }
.automation-empty { display: grid; justify-items: center; gap: 5px; padding: 34px 10px; color: #849087; text-align: center; }.automation-empty strong { color: #445249; font-size: 11px; }.automation-empty span { max-width: 260px; font-size: 9px; line-height: 1.45; }.automation-empty.compact { padding: 22px 10px; }.spin { animation: spin .8s linear infinite; }@keyframes spin { to { transform: rotate(360deg); } }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid #3d8b64; outline-offset: 2px; }
@media (max-width: 720px) {
  .automation-view { grid-template: auto auto auto / 1fr; overflow: auto; }.automation-statusbar { display: flex; grid-column: 1; min-height: auto; flex-wrap: wrap; row-gap: 9px; padding-bottom: 12px; }.posture-copy { order: 1; flex: 1 1 210px; }.posture-metrics { order: 3; flex: 0 0 100%; grid-template-columns: repeat(3, 1fr); width: 100%; border-top: 1px solid #dde4e0; padding-top: 8px; }.posture-metrics > div:first-child { border-left: 0; padding-left: 0; }.scope-badge { order: 2; margin-left: auto; font-size: 0; }.scope-badge svg { width: 14px; height: 14px; }.automation-side { border-top: 1px solid #e0e5e2; border-left: 0; }.trigger-column, .automation-side { overflow: visible; padding: 12px; }.trigger-contract, .grant-line { padding-left: 0; }.limit-grid { grid-template-columns: 1fr 1fr; }.limit-grid label:last-child { grid-column: 1 / -1; }.trigger-actions { flex-wrap: wrap; }
}
</style>
