<template>
  <div class="evaluation-view">
    <section class="evaluation-focus">
      <header class="evaluation-heading">
        <div><strong>{{ t('Measured runtime evidence') }}</strong><span>{{ t('Reproducible harness output, not claimed estimates') }}</span></div>
        <span :class="['evaluation-state', selected?.state || 'blocked']">{{ statusLabel(selected?.state || 'no_runs') }}</span>
      </header>

      <div v-if="selected" class="evaluation-summary">
        <div class="evaluation-title"><span :class="['kind-mark', selected.kind]"><component :is="kindIcon(selected.kind)" :size="17" /></span><div><strong>{{ selected.title }}</strong><code>{{ selected.evaluationId }}</code></div><time>{{ formatTime(selected.createdAt) }}</time></div>
        <p>{{ selected.summary }}</p>
        <div class="metric-grid">
          <article v-for="metric in selected.metrics.slice(0, 6)" :key="metric.metricId">
            <span>{{ metric.label }}</span>
            <strong>{{ formatMetric(metric) }}</strong>
            <small v-if="metric.baseline !== undefined && metric.current !== undefined">{{ t('baseline') }} {{ formatValue(metric.baseline, metric.unit) }} · {{ t('current') }} {{ formatValue(metric.current, metric.unit) }}</small>
            <small v-else>{{ metric.detail || metric.direction?.replaceAll('_', ' ') || t('measured') }}</small>
            <b v-if="metric.improvementPercent !== undefined" :class="{ positive: metric.improvementPercent >= 0 }">{{ formatSigned(metric.improvementPercent) }}%</b>
          </article>
        </div>
      </div>
      <div v-else class="evaluation-empty"><FlaskConical :size="28" /><strong>{{ t('No evaluation report') }}</strong><span>{{ t('Run an interview harness to create signed local evidence.') }}</span></div>

      <section v-if="selected" class="check-ledger">
        <div class="subheading"><strong>{{ t('Acceptance checks') }}</strong><span>{{ selected.checks.filter((item) => item.status === 'passed').length }}/{{ selected.checks.length }}</span></div>
        <article v-for="check in selected.checks" :key="check.checkId">
          <CircleCheck v-if="check.status === 'passed'" :size="15" />
          <Ban v-else-if="check.status === 'blocked'" :size="15" />
          <CircleX v-else :size="15" />
          <div><strong>{{ check.label }}</strong><span>{{ check.detail || check.checkId }}</span></div>
          <small :class="check.status">{{ statusLabel(check.status) }}</small>
        </article>
      </section>
    </section>

    <aside class="evaluation-ledger">
      <header class="evaluation-heading"><div><strong>{{ t('Evaluation ledger') }}</strong><span>{{ t('Pi, benchmark, demo and recovery runs') }}</span></div><span>{{ evaluations.length }}</span></header>
      <button v-for="report in evaluations" :key="report.evaluationId" :class="['evaluation-row', { selected: report.evaluationId === selectedId }]" @click="selectedId = report.evaluationId">
        <span :class="['run-dot', report.state]"></span>
        <div><strong>{{ report.title }}</strong><small>{{ kindLabel(report.kind) }} · {{ formatTime(report.createdAt) }}</small></div>
        <span :class="['row-state', report.state]">{{ statusLabel(report.state) }}</span>
      </button>
      <div v-if="!evaluations.length" class="evaluation-empty compact"><ListChecks :size="24" /><strong>{{ t('Ledger empty') }}</strong><span>{{ t('No benchmark has been persisted yet.') }}</span></div>
      <footer v-if="selected" class="provenance-line"><Fingerprint :size="14" /><div><strong>{{ t('Provenance') }}</strong><code>{{ selected.provenance.command }}</code></div><span>{{ selected.integrity ? 'SHA-256' : t('unsigned') }}</span></footer>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw, ref, watch } from "vue";
import { Ban, CircleCheck, CircleX, Fingerprint, FlaskConical, Gauge, ListChecks, RefreshCw, Route, TerminalSquare } from "lucide-vue-next";
import { useI18n } from "../i18n";
import type { EvaluationKind, EvaluationMetric, EvaluationReport } from "../types";

const props = defineProps<{ evaluations: EvaluationReport[] }>();
const { locale, t, statusLabel } = useI18n();
const selectedId = ref("");
const evaluations = computed(() => [...props.evaluations].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
const selected = computed(() => evaluations.value.find((item) => item.evaluationId === selectedId.value) || evaluations.value[0]);

watch(evaluations, (rows) => {
  if (!rows.some((item) => item.evaluationId === selectedId.value)) selectedId.value = rows[0]?.evaluationId || "";
}, { immediate: true });

function kindIcon(kind: EvaluationKind) { return markRaw(kind === "benchmark" ? Gauge : kind === "end_to_end" ? Route : kind === "recovery" ? RefreshCw : TerminalSquare); }
function kindLabel(kind: EvaluationKind) { return t(kind === "pi_rpc" ? "Pi RPC" : kind === "end_to_end" ? "End to end" : kind === "recovery" ? "Recovery" : "Benchmark"); }
function formatSigned(value: number) { return `${value > 0 ? "+" : ""}${new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(value)}`; }
function formatValue(value: number, unit: EvaluationMetric["unit"]) {
  if (unit === "percent") return `${new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(value)}%`;
  if (unit === "ms") return value < 1_000 ? `${Math.round(value)} ms` : `${(value / 1_000).toFixed(1)} s`;
  if (unit === "usd") return `$${value.toFixed(4)}`;
  if (unit === "bytes") return value < 1_024 ? `${value} B` : `${(value / 1_024).toFixed(1)} KB`;
  return `${new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(value)} ${t(unit)}`;
}
function formatMetric(metric: EvaluationMetric) { return formatValue(metric.current ?? metric.value, metric.unit); }
function formatTime(value: string) { return new Intl.DateTimeFormat(locale.value, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
</script>

<style scoped>
.evaluation-view { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(300px, .8fr); min-height: 0; overflow: hidden; }
.evaluation-focus, .evaluation-ledger { min-width: 0; overflow: auto; }
.evaluation-focus { padding: 17px 19px 22px; }
.evaluation-ledger { border-left: 1px solid #e0e5e2; background: #fbfcfb; padding: 17px 0 22px; }
.evaluation-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 34px; padding-bottom: 10px; }
.evaluation-ledger .evaluation-heading { padding-right: 17px; padding-left: 17px; }
.evaluation-heading > div { display: grid; min-width: 0; gap: 1px; }
.evaluation-heading strong, .subheading strong { color: #28352e; font-size: 11px; text-transform: uppercase; }
.evaluation-heading div span { overflow: hidden; color: #829087; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.evaluation-heading > span, .subheading > span { min-width: 20px; border-radius: 9px; padding: 3px 7px; background: #edf1ef; color: #68766e; font-size: 9px; font-weight: 750; text-align: center; text-transform: uppercase; }
.evaluation-heading > span.passed { background: #dff1e7; color: #216845; }
.evaluation-heading > span.failed { background: #f8e2e4; color: #943f49; }
.evaluation-heading > span.blocked { background: #fff0cf; color: #875f0c; }
.evaluation-summary { display: grid; gap: 10px; border-top: 1px solid #e2e7e4; padding-top: 13px; }
.evaluation-title { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; gap: 9px; align-items: center; }
.kind-mark { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 6px; background: #e4f0e9; color: #246849; }
.kind-mark.pi_rpc { background: #e5eef7; color: #2f6592; }.kind-mark.recovery { background: #fff0cf; color: #8a600d; }.kind-mark.end_to_end { background: #e8ece9; color: #4e6157; }
.evaluation-title > div { display: grid; min-width: 0; gap: 3px; }
.evaluation-title strong { overflow: hidden; color: #27342d; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.evaluation-title code { overflow: hidden; color: #47705b; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.evaluation-title time { color: #7d8982; font-size: 9px; }
.evaluation-summary > p { margin: 0; color: #5d6b63; font-size: 10px; line-height: 1.45; }
.metric-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid #dfe5e1; border-radius: 6px; }
.metric-grid article { position: relative; display: grid; min-width: 0; gap: 2px; min-height: 76px; border-right: 1px solid #e1e6e2; border-bottom: 1px solid #e1e6e2; padding: 10px 11px; }
.metric-grid article:nth-child(3n) { border-right: 0; }.metric-grid article:nth-last-child(-n+3) { border-bottom: 0; }
.metric-grid span { overflow: hidden; color: #748078; font-size: 8px; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
.metric-grid strong { color: #25332b; font-size: 15px; }
.metric-grid small { display: -webkit-box; overflow: hidden; color: #829087; font-size: 8px; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.metric-grid b { position: absolute; right: 9px; bottom: 8px; color: #9b4a53; font-size: 9px; }.metric-grid b.positive { color: #24704d; }
.subheading { display: flex; align-items: center; justify-content: space-between; padding: 18px 0 8px; }
.check-ledger article { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; gap: 8px; align-items: center; min-height: 47px; border-top: 1px solid #e3e8e5; }
.check-ledger article > svg { color: #2d7b56; }.check-ledger article > svg:nth-child(1):not(:only-child) { flex: none; }
.check-ledger article > div { display: grid; min-width: 0; gap: 2px; }.check-ledger article strong { overflow: hidden; color: #334139; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }.check-ledger article span { overflow: hidden; color: #7c8981; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.check-ledger article > small { border-radius: 8px; padding: 2px 6px; background: #edf1ef; color: #67746c; font-size: 8px; text-transform: uppercase; }.check-ledger article > small.passed { background: #dff1e7; color: #216845; }.check-ledger article > small.failed { background: #f8e2e4; color: #943f49; }.check-ledger article > small.blocked { background: #fff0cf; color: #875f0c; }
.evaluation-row { display: grid; width: 100%; grid-template-columns: 9px minmax(0, 1fr) auto; gap: 9px; align-items: center; min-height: 57px; border: 0; border-top: 1px solid #e3e8e5; border-radius: 0; padding: 8px 17px; background: transparent; color: inherit; text-align: left; }
.evaluation-row:hover { background: #f5f8f6; }.evaluation-row.selected { box-shadow: inset 2px 0 #1f6846; background: #f0f6f2; }
.run-dot { width: 8px; height: 8px; border-radius: 50%; background: #9da7a1; }.run-dot.passed { background: #2f7d59; }.run-dot.failed { background: #b44e5a; }.run-dot.blocked { background: #b88723; }
.evaluation-row > div { display: grid; min-width: 0; gap: 3px; }.evaluation-row strong { overflow: hidden; color: #2a3730; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }.evaluation-row small { color: #7a877f; font-size: 8px; }
.row-state { border-radius: 8px; padding: 2px 6px; background: #edf1ef; color: #68756d; font-size: 8px; text-transform: uppercase; }.row-state.passed { background: #dff1e7; color: #216845; }.row-state.failed { background: #f8e2e4; color: #943f49; }.row-state.blocked { background: #fff0cf; color: #875f0c; }
.provenance-line { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; gap: 8px; align-items: center; margin: 14px 17px 0; border-top: 1px solid #dfe5e1; padding-top: 12px; color: #607168; }.provenance-line > div { display: grid; min-width: 0; gap: 2px; }.provenance-line strong { color: #516158; font-size: 8px; text-transform: uppercase; }.provenance-line code { overflow: hidden; color: #2d5f48; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }.provenance-line > span { color: #7d8982; font-size: 8px; }
.evaluation-empty { display: grid; justify-items: center; gap: 5px; padding: 64px 20px; color: #819087; text-align: center; }.evaluation-empty strong { color: #65736b; font-size: 11px; }.evaluation-empty span { font-size: 9px; }.evaluation-empty.compact { padding: 34px 18px; }
@media (max-width: 820px) { .evaluation-view { grid-template-columns: 1fr; overflow: auto; }.evaluation-focus, .evaluation-ledger { overflow: visible; }.evaluation-ledger { border-top: 1px solid #e0e5e2; border-left: 0; }.metric-grid { grid-template-columns: repeat(2, 1fr); }.metric-grid article:nth-child(3n) { border-right: 1px solid #e1e6e2; }.metric-grid article:nth-child(even) { border-right: 0; }.metric-grid article:nth-last-child(-n+3) { border-bottom: 1px solid #e1e6e2; }.metric-grid article:nth-last-child(-n+2) { border-bottom: 0; } }
@media (max-width: 520px) { .evaluation-focus { padding: 14px 16px 18px; }.evaluation-title { grid-template-columns: 34px minmax(0, 1fr); }.evaluation-title time { grid-column: 2; }.metric-grid { grid-template-columns: 1fr; }.metric-grid article, .metric-grid article:nth-child(3n), .metric-grid article:nth-child(even), .metric-grid article:nth-last-child(-n+2) { border-right: 0; border-bottom: 1px solid #e1e6e2; }.metric-grid article:last-child { border-bottom: 0; } }
</style>
