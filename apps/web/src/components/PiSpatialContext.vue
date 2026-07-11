<template>
  <div class="spatial-context">
    <section class="focus-summary">
      <div class="focus-heading">
        <span><Bot :size="13" />{{ followPi ? t('Current Pi focus') : t('Local inspection') }}</span>
        <strong :class="['phase-badge', view?.phase || 'idle']">{{ statusLabel(view?.phase || 'idle') }}</strong>
      </div>
      <h2>{{ focusTitle }}</h2>
      <p>{{ regionName }} · {{ activeYear || '-' }} · {{ followPi ? (view?.mode || '2d').toUpperCase() : t('Local inspection') }}</p>
      <div :class="['control-banner', { detached: !followPi }]">
        <Crosshair :size="14" />
        <span>{{ followPi ? t('Pi controls this view') : t('Local view detached from Pi') }}</span>
      </div>
    </section>

    <section class="state-section">
      <div class="section-heading"><h2>{{ t('Current spatial state') }}</h2><span>{{ t('count.sources', { count: plan?.datasets.length || 0 }) }}</span></div>
      <div class="state-list">
        <div><MapPin :size="14" /><span>{{ t('Region') }}</span><strong>{{ regionName }}</strong></div>
        <div><CalendarDays :size="14" /><span>{{ t('Time window') }}</span><strong>{{ plan ? `${plan.spec.period.startYear}-${plan.spec.period.endYear}` : '-' }}</strong></div>
        <div><ScanSearch :size="14" /><span>{{ t('Observable') }}</span><strong>{{ activeRole ? roleLabel(activeRole) : '-' }}</strong></div>
        <div><Layers3 :size="14" /><span>{{ t('Current data source') }}</span><strong>{{ activeSource?.dataset.title || '-' }}</strong></div>
      </div>
    </section>

    <section v-if="activeHypotheses.length" class="hypothesis-section">
      <div class="section-heading"><h2>{{ t('Question being tested') }}</h2><span>{{ activeHypotheses.length }}</span></div>
      <article v-for="hypothesis in activeHypotheses" :key="hypothesis.id">
        <span>{{ hypothesis.id }}</span>
        <p>{{ hypothesis.statement }}</p>
      </article>
    </section>

    <section class="source-section">
      <div class="section-heading"><h2>{{ t('Spatial data selected by Pi') }}</h2><span>{{ plan?.datasets.length || 0 }}</span></div>
      <article v-for="item in plan?.datasets || []" :key="item.role" :class="['source-row', { active: item.role === activeRole }]">
        <div class="source-title">
          <span class="source-state" :class="item.adapterBinding?.verificationStatus || 'not_run'"></span>
          <strong>{{ roleLabel(item.role) }}</strong>
          <small>{{ item.dataset.scaleMeters }} m</small>
        </div>
        <p>{{ item.dataset.title }}</p>
        <div class="source-meta">
          <span>{{ item.dataset.provider }}</span>
          <span>{{ item.dataset.cadence }}</span>
          <span>{{ statusLabel(item.adapterBinding?.verificationStatus || 'not_run') }}</span>
        </div>
      </article>
    </section>

    <details class="runtime-details">
      <summary>{{ t('Runtime details') }}</summary>
      <dl>
        <dt>{{ t('Operation') }}</dt><dd><code>{{ view?.control.operation || '-' }}</code></dd>
        <dt>{{ t('Revision') }}</dt><dd>{{ view?.revision || 0 }}</dd>
        <dt>{{ t('Plan') }}</dt><dd><code>{{ view?.target?.planId || plan?.planId || '-' }}</code></dd>
        <dt>{{ t('Geometry') }}</dt><dd>{{ geometryLabel }}</dd>
      </dl>
    </details>
  </div>
</template>

<script setup lang="ts">
import { Bot, CalendarDays, Crosshair, Layers3, MapPin, ScanSearch } from "lucide-vue-next";
import { computed } from "vue";
import { useI18n } from "../i18n";
import type { InvestigationPlan, SpatialViewState } from "../types";

const props = defineProps<{ plan?: InvestigationPlan; view?: SpatialViewState; selectedRole?: string; selectedYear?: number; followPi: boolean }>();
const { t, roleLabel, statusLabel } = useI18n();

const activeRole = computed(() => props.followPi ? props.view?.target?.role || props.selectedRole || props.plan?.datasets[0]?.role || "" : props.selectedRole || props.plan?.datasets[0]?.role || "");
const activeYear = computed(() => props.followPi ? props.view?.target?.year || props.selectedYear || props.plan?.spec.period.endYear : props.selectedYear || props.plan?.spec.period.endYear);
const regionName = computed(() => props.plan?.spec.region.name || props.plan?.spec.investigationId || "-");
const activeSource = computed(() => props.plan?.datasets.find((item) => item.role === activeRole.value));
const activeHypotheses = computed(() => props.plan?.spec.hypotheses.filter((item) => !activeRole.value || item.observableRoles.includes(activeRole.value)) || []);
const focusTitle = computed(() => t(props.followPi ? "Pi is examining {{role}}" : "Inspecting {{role}}", { role: activeRole.value ? roleLabel(activeRole.value) : t("spatial data") }));
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
section { min-width: 0; }
.focus-summary { display: grid; gap: 6px; border-bottom: 1px solid #dce4df; padding-bottom: 16px; }
.focus-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.focus-heading > span { display: inline-flex; align-items: center; gap: 6px; color: #637169; font-size: 9px; font-weight: 750; text-transform: uppercase; }
.focus-heading > span svg { color: #1f6846; }
.focus-summary h2 { margin: 2px 0 0; color: #1c2b23; font-size: 17px; line-height: 1.28; }
.focus-summary > p { margin: 0; color: #69776f; font-size: 10px; }
.phase-badge { border: 1px solid #cbd8d0; border-radius: 999px; padding: 3px 7px; background: #f3f7f4; color: #38634d; font-size: 9px; }
.phase-badge.computing { border-color: #dec88e; background: #fff8e9; color: #8a620f; }
.phase-badge.failed, .phase-badge.blocked { border-color: #ddb7bd; background: #fff4f5; color: #973e4a; }
.control-banner { display: flex; align-items: center; gap: 7px; margin-top: 5px; border-left: 2px solid #2f7d59; padding: 7px 9px; background: #f1f7f3; color: #235b40; font-size: 10px; font-weight: 700; }
.control-banner.detached { border-left-color: #d18b36; background: #fbf7ee; color: #825d17; }
.section-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.section-heading h2 { margin: 0; color: #45534b; font-size: 10px; text-transform: uppercase; }
.section-heading > span { color: #748079; font-size: 9px; }
.state-list { display: grid; border-top: 1px solid #e1e6e3; }
.state-list > div { display: grid; grid-template-columns: 18px 82px minmax(0, 1fr); gap: 6px; align-items: center; border-bottom: 1px solid #e6eae7; padding: 8px 1px; }
.state-list svg { color: #5f796a; }
.state-list span { color: #748079; font-size: 10px; }
.state-list strong { min-width: 0; overflow: hidden; color: #27352d; font-size: 10px; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
.hypothesis-section { border-top: 1px solid #e1e6e3; padding-top: 14px; }
.hypothesis-section article { display: grid; grid-template-columns: 66px minmax(0, 1fr); gap: 8px; border-top: 1px solid #e6eae7; padding: 9px 1px; }
.hypothesis-section article span { overflow: hidden; color: #2f7d59; font: 9px ui-monospace, SFMono-Regular, monospace; text-overflow: ellipsis; white-space: nowrap; }
.hypothesis-section article p { margin: 0; color: #34423a; font-size: 10px; line-height: 1.45; }
.source-section { border-top: 1px solid #e1e6e3; padding-top: 14px; }
.source-row { display: grid; gap: 4px; border-top: 1px solid #e6eae7; padding: 9px 2px; }
.source-row.active { box-shadow: inset 2px 0 #2f7d59; padding-left: 9px; background: #f7faf8; }
.source-title { display: grid; grid-template-columns: 7px minmax(0, 1fr) auto; gap: 7px; align-items: center; }
.source-state { width: 6px; height: 6px; border-radius: 50%; background: #98a39d; }
.source-state.passed { background: #2f7d59; }
.source-state.failed { background: #a54450; }
.source-title strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.source-title small { color: #5f6e66; font: 9px ui-monospace, SFMono-Regular, monospace; }
.source-row p { margin: 0; color: #3c4942; font-size: 10px; line-height: 1.35; }
.source-meta { display: flex; gap: 5px; overflow-x: auto; }
.source-meta span { flex: 0 0 auto; border-right: 1px solid #dce3de; padding-right: 5px; color: #748079; font-size: 8px; }
.source-meta span:last-child { border-right: 0; }
.runtime-details { border-top: 1px solid #e1e6e3; padding-top: 12px; }
.runtime-details summary { color: #647169; cursor: pointer; font-size: 10px; font-weight: 700; }
.runtime-details dl { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 7px 10px; margin: 11px 0 0; font-size: 9px; }
.runtime-details dt { color: #748079; }
.runtime-details dd { min-width: 0; margin: 0; overflow-wrap: anywhere; color: #2f3c35; }
.runtime-details code { font-size: 8px; }
@media (max-width: 620px) {
  .focus-summary h2 { font-size: 16px; }
  .state-list > div { grid-template-columns: 18px 76px minmax(0, 1fr); }
}
</style>
