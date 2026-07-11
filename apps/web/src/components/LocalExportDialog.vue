<template>
  <div v-if="open && plan" class="export-backdrop" @mousedown.self="$emit('close')">
    <form class="export-dialog" role="dialog" aria-modal="true" :aria-label="t('Local GeoTIFF export')" @submit.prevent="submit">
      <header>
        <div><p>{{ t('Artifact export') }}</p><h2>{{ t('Local GeoTIFF') }}</h2></div>
        <button type="button" class="icon-button" :title="t('Close')" @click="$emit('close')"><X :size="18" /></button>
      </header>

      <div class="export-body">
        <div class="mode-control" role="group" :aria-label="t('Export mode')">
          <button type="button" :class="{ active: mode === 'year' }" @click="mode = 'year'">{{ t('Single year') }}</button>
          <button type="button" :class="{ active: mode === 'change' }" :disabled="years.length < 2" @click="mode = 'change'">{{ t('Change layer') }}</button>
        </div>

        <label><span>{{ t('Observable') }}</span><select v-model="role"><option v-for="item in plan.datasets" :key="item.role" :value="item.role">{{ roleLabel(item.role) }} · {{ item.dataset.title }}</option></select></label>
        <div v-if="mode === 'year'" class="field-grid single">
          <label><span>{{ t('Year') }}</span><select v-model.number="year"><option v-for="value in years" :key="value" :value="value">{{ value }}</option></select></label>
        </div>
        <div v-else class="field-grid">
          <label><span>{{ t('Baseline') }}</span><select v-model.number="baselineYear"><option v-for="value in years.slice(0, -1)" :key="value" :value="value">{{ value }}</option></select></label>
          <label><span>{{ t('Target') }}</span><select v-model.number="targetYear"><option v-for="value in years.slice(1)" :key="value" :value="value">{{ value }}</option></select></label>
        </div>
        <div class="field-grid">
          <label><span>{{ t('Scale (m)') }}</span><input v-model.number="scaleMeters" type="number" :min="minimumScale" max="100000" step="1" required></label>
          <label><span>CRS</span><select v-model="crs"><option value="EPSG:4326">EPSG:4326</option><option value="EPSG:3857">EPSG:3857</option></select></label>
        </div>
        <label><span>{{ t('Data type') }}</span><select v-model="dtype"><option value="float32">float32</option><option value="float64">float64</option><option value="int16">int16</option><option value="uint16">uint16</option><option value="uint8">uint8</option></select></label>

        <div class="export-estimate"><Gauge :size="17" /><div><span>{{ t('Estimated export') }}</span><strong>{{ estimatedPixels === undefined ? t('review required') : formatPixels(estimatedPixels) }}</strong></div><code>geedim</code></div>
      </div>

      <footer>
        <button type="button" class="secondary" @click="$emit('close')">{{ t('Cancel') }}</button>
        <button class="primary" :disabled="saving || !valid"><LoaderCircle v-if="saving" class="spin" :size="15" /><Download v-else :size="15" />{{ t('Queue export') }}</button>
      </footer>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Download, Gauge, LoaderCircle, X } from "lucide-vue-next";
import { useI18n } from "../i18n";
import type { InvestigationPlan } from "../types";

const props = defineProps<{ open: boolean; saving: boolean; plan?: InvestigationPlan; selectedRole: string; selectedYear: number }>();
const emit = defineEmits<{ close: []; export: [request: Record<string, unknown>] }>();
const { t, roleLabel } = useI18n();
const mode = ref<"year" | "change">("year");
const role = ref("");
const year = ref(0);
const baselineYear = ref(0);
const targetYear = ref(0);
const scaleMeters = ref(30);
const crs = ref("EPSG:4326");
const dtype = ref("float32");
const years = computed(() => props.plan ? Array.from({ length: props.plan.spec.period.endYear - props.plan.spec.period.startYear + 1 }, (_, index) => props.plan!.spec.period.startYear + index) : []);
const selectedDataset = computed(() => props.plan?.datasets.find((item) => item.role === role.value));
const minimumScale = computed(() => Math.max(1, (selectedDataset.value?.dataset.scaleMeters || 1) / 2));
const estimatedPixels = computed(() => {
  const nominal = props.plan?.estimatedCost.nominalPixels;
  if (!nominal || !props.plan || !scaleMeters.value) return undefined;
  const finest = Math.min(...props.plan.datasets.map((item) => item.dataset.scaleMeters));
  return Math.ceil(nominal * (finest / scaleMeters.value) ** 2);
});
const valid = computed(() => Boolean(role.value) && scaleMeters.value >= minimumScale.value && (mode.value === "year" || baselineYear.value < targetYear.value));

watch(() => props.open, (open) => {
  if (!open || !props.plan) return;
  role.value = props.selectedRole || props.plan.datasets[0]?.role || "";
  year.value = props.selectedYear || props.plan.spec.period.endYear;
  baselineYear.value = props.plan.spec.period.startYear;
  targetYear.value = props.plan.spec.period.endYear;
  scaleMeters.value = Math.max(30, props.plan.datasets.find((item) => item.role === role.value)?.dataset.scaleMeters || 30);
});
watch(role, () => { scaleMeters.value = Math.max(scaleMeters.value, minimumScale.value); });

function formatPixels(value: number) { return value >= 1_000_000 ? t("{{count}} pixels", { count: `${(value / 1_000_000).toFixed(1)}M` }) : value >= 1_000 ? t("{{count}} pixels", { count: `${(value / 1_000).toFixed(1)}K` }) : t("{{count}} pixels", { count: value }); }
function submit() {
  if (!valid.value) return;
  emit("export", {
    role: role.value,
    kind: mode.value,
    year: year.value,
    baselineYear: baselineYear.value,
    targetYear: targetYear.value,
    scaleMeters: scaleMeters.value,
    crs: crs.value,
    dtype: dtype.value,
    maxPixels: 25_000_000,
    estimatedPixels: estimatedPixels.value,
  });
}
</script>

<style scoped>
.export-backdrop { position: fixed; inset: 0; z-index: 31; display: grid; place-items: center; padding: 18px; background: rgba(24, 31, 27, .48); backdrop-filter: blur(3px); }.export-dialog { width: min(480px, 100%); max-height: calc(100vh - 36px); overflow: auto; border: 1px solid #cfd7d2; border-radius: 8px; background: #fff; box-shadow: 0 24px 70px rgba(24, 38, 30, .25); }.export-dialog header, .export-dialog footer { display: flex; align-items: center; justify-content: space-between; padding: 15px 17px; }.export-dialog header { border-bottom: 1px solid #e0e5e2; }.export-dialog footer { justify-content: flex-end; gap: 8px; border-top: 1px solid #e0e5e2; background: #f8faf8; }.export-dialog header p { margin: 0 0 2px; color: #617168; font-size: 10px; font-weight: 700; text-transform: uppercase; }.export-dialog h2 { margin: 0; font-size: 19px; }.icon-button { display: grid; width: 34px; height: 34px; place-items: center; border: 1px solid #cfd7d2; border-radius: 5px; padding: 0; background: #fff; }.export-body { display: grid; gap: 13px; padding: 17px; }.mode-control { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #cad3cd; border-radius: 5px; overflow: hidden; }.mode-control button { border: 0; border-right: 1px solid #cad3cd; border-radius: 0; padding: 8px; background: #f5f7f5; color: #657269; }.mode-control button:last-child { border-right: 0; }.mode-control button.active { background: #1f6846; color: #fff; font-weight: 700; }.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }.field-grid.single { grid-template-columns: 1fr; }.export-body label { display: grid; gap: 5px; }.export-body label span { color: #617067; font-size: 10px; font-weight: 700; }.export-body input, .export-body select { width: 100%; min-height: 36px; border: 1px solid #cbd4ce; border-radius: 5px; padding: 7px 9px; background: #fff; color: #25332b; }.export-estimate { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 8px; align-items: center; border-top: 1px solid #e1e6e2; padding-top: 12px; color: #496257; }.export-estimate div { display: grid; gap: 2px; }.export-estimate span { color: #758179; font-size: 9px; }.export-estimate strong { font-size: 11px; }.export-estimate code { color: #2f7d59; font-size: 9px; }.primary, .secondary { display: inline-flex; align-items: center; gap: 6px; border-radius: 5px; padding: 8px 11px; font-weight: 700; }.primary { border: 1px solid #1f6846; background: #1f6846; color: #fff; }.secondary { border: 1px solid #cbd4ce; background: #fff; color: #36453c; }.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 520px) { .field-grid { grid-template-columns: 1fr; } }
</style>
