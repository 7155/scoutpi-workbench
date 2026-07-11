<template>
  <div class="evidence-graph">
    <section v-if="review" :class="['review-card', review.status]">
      <header><span class="review-icon"><ShieldCheck v-if="review.status === 'passed'" :size="15" /><CircleAlert v-else :size="15" /></span><div><strong>{{ t('Evidence review') }}</strong><span>{{ t('Claim, computation and provenance gate') }}</span></div><b>{{ statusLabel(review.status) }}</b></header>
      <div class="review-metrics"><span><strong>{{ review.summary.blocking }}</strong> {{ t('blocking') }}</span><span><strong>{{ review.summary.warnings }}</strong> {{ t('warnings') }}</span><span><strong>{{ review.summary.completedLiveJobs }}</strong> {{ t('live runs') }}</span><span><strong>{{ review.summary.contradictingSources }}</strong> {{ t('counter sources') }}</span></div>
      <article v-for="item in review.issues.slice(0, 6)" :key="item.issueId"><span :class="['issue-dot', item.severity]"></span><div><strong>{{ item.code.replaceAll('_', ' ') }}</strong><p>{{ item.message }}</p><small>{{ item.resolution }}</small></div></article>
    </section>
    <div v-if="graph" class="coverage-strip">
      <div><Globe2 :size="14" /><span>{{ t('Sources') }}</span><strong>{{ graph.coverage.browserEvidence }}</strong></div>
      <div><Quote :size="14" /><span>{{ t('Claims') }}</span><strong>{{ graph.coverage.claims }}</strong></div>
      <div><Cpu :size="14" /><span>{{ t('Runs') }}</span><strong>{{ graph.coverage.computedRuns }}</strong></div>
      <div :class="{ warning: graph.coverage.coveredHypotheses < graph.coverage.hypotheses }"><Target :size="14" /><span>{{ t('Coverage') }}</span><strong>{{ graph.coverage.coveredHypotheses }}/{{ graph.coverage.hypotheses }}</strong></div>
    </div>

    <article v-for="row in hypothesisRows" :key="row.node.nodeId" class="hypothesis-chain">
      <header>
        <span :class="['coverage-dot', { covered: row.covered }]"></span>
        <div><code>{{ row.node.ref }}</code><strong>{{ row.node.label }}</strong></div>
        <span :class="['coverage-state', { covered: row.covered }]">{{ t(row.covered ? 'covered' : 'open') }}</span>
      </header>
      <div v-for="source in row.sources" :key="source.evidenceId" class="chain-row source-chain">
        <Globe2 :size="14" /><div><a :href="source.source.url" target="_blank">{{ source.source.title }}<ExternalLink :size="11" /></a><span>{{ statusLabel(source.binding?.relation || 'documents') }} · {{ statusLabel(source.source.trust) }} {{ t('trust') }}</span></div>
      </div>
      <div v-for="run in row.runs" :key="run.nodeId" class="chain-row run-chain">
        <Cpu :size="14" /><div><strong>{{ run.label }}</strong><span>{{ run.ref }} · {{ run.metadata?.artifactCount || 0 }} artifacts</span></div>
      </div>
      <div v-for="finding in row.findings" :key="finding.nodeId" class="chain-row finding-chain">
        <FileCheck2 :size="14" /><div><strong>{{ findingLabel(finding.label, finding.status) }}</strong><span>{{ t('EarthStory finding') }}</span></div>
      </div>
      <div v-if="!row.sources.length && !row.runs.length && !row.findings.length" class="chain-empty"><CircleAlert :size="14" />{{ t('No bound source or completed computation.') }}</div>
    </article>

    <section v-if="unassignedSources.length" class="unassigned-sources">
      <div class="mini-heading"><strong>{{ t('Unassigned browser evidence') }}</strong><span>{{ unassignedSources.length }}</span></div>
      <a v-for="source in unassignedSources" :key="source.evidenceId" :href="source.source.url" target="_blank"><Globe2 :size="13" /><span><strong>{{ source.source.title }}</strong><small>{{ source.evidenceId }}</small></span><ExternalLink :size="11" /></a>
    </section>

    <div v-if="!graph || (!hypothesisRows.length && !records.length)" class="graph-empty"><GitFork :size="24" /><span>{{ t('No evidence graph for this investigation.') }}</span></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { CircleAlert, Cpu, ExternalLink, FileCheck2, GitFork, Globe2, Quote, ShieldCheck, Target } from "lucide-vue-next";
import { useI18n } from "../i18n";
import type { BrowserEvidenceRecord, EvidenceGraph, EvidenceReviewReport } from "../types";

const props = defineProps<{ graph?: EvidenceGraph; records: BrowserEvidenceRecord[]; review?: EvidenceReviewReport }>();
const { t, statusLabel } = useI18n();

function findingLabel(label: string, status?: string): string {
  const count = label.match(/·\s*(\d+)\s+evidence statements?$/i)?.[1];
  return count ? `${statusLabel(status || label.split("·")[0].trim())} · ${count} ${t('evidence statements')}` : label;
}

const nodeMap = computed(() => new Map((props.graph?.nodes || []).map((node) => [node.nodeId, node])));
const hypothesisRows = computed(() => (props.graph?.nodes || []).filter((node) => node.kind === "hypothesis").map((node) => {
  const incoming = (props.graph?.edges || []).filter((edge) => edge.to === node.nodeId);
  const claimIds = new Set(incoming.filter((edge) => ["supports", "contradicts", "contextualizes", "documents"].includes(edge.relation)).map((edge) => edge.from));
  const evidenceNodeIds = new Set((props.graph?.edges || []).filter((edge) => edge.relation === "documents" && claimIds.has(edge.to)).map((edge) => edge.from));
  const evidenceIds = new Set([...evidenceNodeIds].map((id) => nodeMap.value.get(id)?.ref).filter((id): id is string => Boolean(id)));
  const sources = props.records.filter((record) => evidenceIds.has(record.evidenceId) || record.binding?.hypothesisId === node.ref);
  const runs = incoming.filter((edge) => edge.relation === "computed_for").map((edge) => nodeMap.value.get(edge.from)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const findings = incoming.filter((edge) => edge.relation === "evaluates").map((edge) => nodeMap.value.get(edge.from)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  return { node, sources, runs, findings, covered: sources.length > 0 || runs.some((run) => run.status === "completed") };
}));
const unassignedSources = computed(() => props.records.filter((record) => !record.binding?.hypothesisId));
</script>

<style scoped>
.evidence-graph { display: grid; gap: 0; }
.review-card { display: grid; margin-bottom: 11px; border: 1px solid #d7e1dc; background: #f8faf9; }
.review-card.warning { border-color: #e4d3a9; background: #fffaf0; }.review-card.blocked { border-color: #e3c2c6; background: #fff7f7; }
.review-card header { display: grid; grid-template-columns: 25px minmax(0, 1fr) auto; gap: 7px; align-items: center; border-bottom: 1px solid rgba(110, 126, 117, .16); padding: 8px 9px; }.review-icon { display: grid; width: 24px; height: 24px; place-items: center; border-radius: 4px; background: #dff1e7; color: #216845; }.review-card.warning .review-icon { background: #fff0cf; color: #875f0c; }.review-card.blocked .review-icon { background: #f8e2e4; color: #943f49; }.review-card header > div { display: grid; gap: 1px; }.review-card header strong { color: #34423a; font-size: 9px; text-transform: uppercase; }.review-card header span { color: #7b8780; font-size: 7px; }.review-card header b { border-radius: 10px; padding: 2px 6px; background: #e5f2ea; color: #276a49; font-size: 7px; text-transform: uppercase; }.review-card.warning header b { background: #fff0cf; color: #875f0c; }.review-card.blocked header b { background: #f8e2e4; color: #943f49; }
.review-metrics { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid rgba(110, 126, 117, .14); }.review-metrics span { display: grid; gap: 1px; border-right: 1px solid rgba(110, 126, 117, .14); padding: 6px 8px; color: #7b8780; font-size: 7px; text-transform: uppercase; }.review-metrics span:last-child { border-right: 0; }.review-metrics strong { color: #34423a; font-size: 10px; }
.review-card article { display: grid; grid-template-columns: 8px minmax(0, 1fr); gap: 7px; border-top: 1px solid rgba(110, 126, 117, .12); padding: 7px 9px; }.review-metrics + article { border-top: 0; }.issue-dot { width: 7px; height: 7px; margin-top: 3px; border-radius: 50%; background: #7e9287; }.issue-dot.warning { background: #c38a2f; }.issue-dot.blocking { background: #b44e5a; }.review-card article > div { display: grid; gap: 2px; }.review-card article strong { color: #46544c; font-size: 8px; text-transform: uppercase; }.review-card article p { margin: 0; color: #5d6a63; font-size: 8px; line-height: 1.35; }.review-card article small { color: #849087; font-size: 7px; line-height: 1.35; }
.coverage-strip { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #dfe5e1; background: #f8faf8; }
.coverage-strip > div { display: grid; grid-template-columns: 17px 1fr; gap: 1px 5px; align-items: center; min-width: 0; border-right: 1px solid #e1e6e3; padding: 7px; }
.coverage-strip > div:last-child { border-right: 0; }.coverage-strip svg { grid-row: 1 / 3; color: #397259; }.coverage-strip .warning svg { color: #b17616; }.coverage-strip span { color: #77837c; font-size: 7px; text-transform: uppercase; }.coverage-strip strong { color: #2d3a33; font-size: 10px; }
.hypothesis-chain { border-top: 1px solid #e2e7e4; padding: 10px 0 8px; }.coverage-strip + .hypothesis-chain { margin-top: 10px; }
.hypothesis-chain header { display: grid; grid-template-columns: 9px minmax(0, 1fr) auto; gap: 7px; align-items: start; }.hypothesis-chain header > div { display: grid; min-width: 0; gap: 2px; }.hypothesis-chain header code { color: #2f7d59; font-size: 8px; }.hypothesis-chain header strong { color: #2e3b34; font-size: 10px; line-height: 1.35; }.coverage-dot { width: 7px; height: 7px; margin-top: 4px; border-radius: 50%; background: #d18b36; }.coverage-dot.covered { background: #2f7d59; }.coverage-state { border-radius: 999px; padding: 2px 6px; background: #fff0cf; color: #8a6111; font-size: 7px; font-weight: 750; text-transform: uppercase; }.coverage-state.covered { background: #dff1e7; color: #216845; }
.chain-row { position: relative; display: grid; grid-template-columns: 17px minmax(0, 1fr); gap: 6px; margin-left: 3px; border-left: 1px solid #cdd8d2; padding: 8px 0 0 13px; }.chain-row::before { position: absolute; top: 15px; left: 0; width: 9px; height: 1px; background: #cdd8d2; content: ""; }.chain-row svg { color: #557b68; }.source-chain svg { color: #2f6fad; }.finding-chain svg { color: #7b5f9a; }.chain-row > div { display: grid; min-width: 0; gap: 2px; }.chain-row a { display: flex; min-width: 0; align-items: center; gap: 4px; overflow: hidden; color: #2c668f; font-size: 9px; font-weight: 650; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }.chain-row strong { overflow: hidden; color: #415048; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }.chain-row span { color: #7a867f; font-size: 8px; }.chain-empty { display: flex; align-items: center; gap: 6px; margin: 7px 0 0 12px; color: #8c7b55; font-size: 8px; }
.unassigned-sources { display: grid; margin-top: 12px; border-top: 1px solid #e2e7e4; padding-top: 9px; }.mini-heading { display: flex; justify-content: space-between; color: #68766e; font-size: 8px; text-transform: uppercase; }.mini-heading span { border-radius: 8px; padding: 1px 5px; background: #edf1ef; }.unassigned-sources > a { display: grid; grid-template-columns: 17px minmax(0, 1fr) 12px; gap: 6px; align-items: center; border-top: 1px solid #e8ece9; padding: 7px 0; color: #3b4b42; text-decoration: none; }.unassigned-sources > a > span { display: grid; min-width: 0; }.unassigned-sources strong, .unassigned-sources small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.unassigned-sources strong { font-size: 9px; }.unassigned-sources small { color: #859089; font-size: 7px; }
.graph-empty { display: grid; justify-items: center; gap: 6px; padding: 28px 10px; color: #849088; font-size: 9px; }
@media (max-width: 420px) { .review-metrics { grid-template-columns: 1fr 1fr; }.review-metrics span:nth-child(2) { border-right: 0; }.review-metrics span:nth-child(-n+2) { border-bottom: 1px solid rgba(110, 126, 117, .14); }.coverage-strip { grid-template-columns: 1fr 1fr; }.coverage-strip > div:nth-child(2) { border-right: 0; }.coverage-strip > div:nth-child(-n+2) { border-bottom: 1px solid #e1e6e3; } }
</style>
