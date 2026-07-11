<template>
  <div class="spatial-context">
    <div class="context-strip">
      <div><span>{{ t('Observable') }}</span><strong>{{ activeRole ? roleLabel(activeRole) : '-' }}</strong></div>
      <div><span>{{ t('Focus year') }}</span><strong>{{ activeYear || '-' }}</strong></div>
      <div><span>{{ t('Spatial sources') }}</span><strong>{{ plan?.datasets.length || 0 }}</strong></div>
      <div><span>{{ t('View') }}</span><strong>{{ view?.mode?.toUpperCase() || '2D' }}</strong></div>
    </div>

    <section class="focus-section">
      <div class="section-heading">
        <h2>{{ t('Pi focus') }}</h2>
        <span :class="['phase-badge', view?.phase || 'idle']">{{ statusLabel(view?.phase || 'idle') }}</span>
      </div>
      <dl>
        <dt>{{ t('Controller') }}</dt><dd>{{ followPi ? t('Pi') : t('Local inspection') }}</dd>
        <dt>{{ t('Operation') }}</dt><dd><code>{{ view?.control.operation || '-' }}</code></dd>
        <dt>{{ t('Revision') }}</dt><dd>{{ view?.revision || 0 }}</dd>
        <dt>{{ t('Plan') }}</dt><dd><code>{{ view?.target?.planId || plan?.planId || '-' }}</code></dd>
      </dl>
    </section>

    <section class="region-section">
      <div class="section-heading"><h2>{{ t('Region contract') }}</h2><span>{{ plan?.spec.region.kind || '-' }}</span></div>
      <dl>
        <dt>{{ t('Region') }}</dt><dd>{{ plan?.spec.region.name || plan?.spec.investigationId || '-' }}</dd>
        <dt>{{ t('Geometry') }}</dt><dd>{{ geometryLabel }}</dd>
        <dt>{{ t('Time window') }}</dt><dd>{{ plan ? `${plan.spec.period.startYear}-${plan.spec.period.endYear}` : '-' }}</dd>
        <dt>{{ t('Hypotheses') }}</dt><dd>{{ plan?.spec.hypotheses.length || 0 }}</dd>
      </dl>
    </section>

    <section class="source-section">
      <div class="section-heading"><h2>{{ t('Structured spatial inputs') }}</h2><span>{{ plan?.datasets.length || 0 }}</span></div>
      <article v-for="item in plan?.datasets || []" :key="item.role" :class="['source-row', { active: item.role === activeRole }]">
        <div class="source-title">
          <span class="source-state" :class="item.adapterBinding?.verificationStatus || 'not_run'"></span>
          <strong>{{ roleLabel(item.role) }}</strong>
          <small>{{ item.dataset.scaleMeters }} m</small>
        </div>
        <p>{{ item.dataset.title }}</p>
        <code>{{ item.dataset.collectionId || item.dataset.datasetId }}</code>
        <div class="source-meta"><span>{{ item.dataset.provider }}</span><span>{{ item.dataset.cadence }}</span><span>{{ item.dataset.analysis.outputName }}</span></div>
      </article>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "../i18n";
import type { InvestigationPlan, SpatialViewState } from "../types";

const props = defineProps<{ plan?: InvestigationPlan; view?: SpatialViewState; selectedRole?: string; selectedYear?: number; followPi: boolean }>();
const { t, roleLabel, statusLabel } = useI18n();

const activeRole = computed(() => props.view?.target?.role || props.selectedRole || props.plan?.datasets[0]?.role || "");
const activeYear = computed(() => props.view?.target?.year || props.selectedYear || props.plan?.spec.period.endYear);
const geometryLabel = computed(() => {
  const region = props.plan?.spec.region;
  if (!region) return "-";
  if (region.kind === "bbox" && region.bbox) return region.bbox.map((value) => Number(value).toFixed(3)).join(", ");
  if (region.kind === "asset") return region.assetId || t("Earth Engine asset");
  return t("GeoJSON geometry");
});
</script>

<style scoped>
.spatial-context { display: grid; gap: 18px; }
.context-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid #e0e5e2; }
.context-strip > div { display: grid; min-width: 0; gap: 3px; border-left: 1px solid #e0e5e2; padding: 0 9px 11px; }
.context-strip > div:first-child { border-left: 0; padding-left: 0; }
.context-strip span { color: #6b7871; font-size: 9px; text-transform: uppercase; }
.context-strip strong { overflow: hidden; color: #223029; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
section { min-width: 0; }
.section-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.section-heading h2 { margin: 0; font-size: 11px; text-transform: uppercase; }
.section-heading > span { color: #748079; font-size: 9px; }
.phase-badge { border: 1px solid #cbd8d0; border-radius: 999px; padding: 3px 7px; background: #f3f7f4; color: #38634d !important; font-weight: 700; }
.phase-badge.computing { border-color: #dec88e; background: #fff8e9; color: #8a620f !important; }
.phase-badge.failed, .phase-badge.blocked { border-color: #ddb7bd; background: #fff4f5; color: #973e4a !important; }
dl { display: grid; grid-template-columns: 82px minmax(0, 1fr); gap: 7px 10px; margin: 0; font-size: 10px; }
dt { color: #748079; }
dd { min-width: 0; margin: 0; overflow-wrap: anywhere; color: #2f3c35; }
dd code { font-size: 9px; }
.region-section, .source-section { border-top: 1px solid #e1e6e3; padding-top: 13px; }
.source-row { display: grid; gap: 4px; border-top: 1px solid #e6eae7; padding: 9px 2px; }
.source-row.active { box-shadow: inset 2px 0 #2f7d59; padding-left: 9px; background: #f7faf8; }
.source-title { display: grid; grid-template-columns: 7px minmax(0, 1fr) auto; gap: 7px; align-items: center; }
.source-state { width: 6px; height: 6px; border-radius: 50%; background: #98a39d; }
.source-state.passed { background: #2f7d59; }.source-state.failed { background: #a54450; }
.source-title strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.source-title small { color: #5f6e66; font: 9px ui-monospace, SFMono-Regular, monospace; }
.source-row p { margin: 0; color: #3c4942; font-size: 10px; line-height: 1.35; }
.source-row > code { overflow: hidden; color: #65736b; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.source-meta { display: flex; gap: 5px; overflow-x: auto; }
.source-meta span { flex: 0 0 auto; border-right: 1px solid #dce3de; padding-right: 5px; color: #748079; font-size: 8px; }
.source-meta span:last-child { border-right: 0; }
@media (max-width: 620px) { .context-strip { grid-template-columns: 1fr 1fr; row-gap: 10px; }.context-strip > div:nth-child(3) { border-left: 0; padding-left: 0; } }
</style>
