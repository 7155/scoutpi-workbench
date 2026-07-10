<template>
  <div v-if="open" class="backdrop" @mousedown.self="$emit('close')">
    <form class="dialog" @submit.prevent="submit">
      <header>
        <div><p>New investigation</p><h2>Define a testable question</h2></div>
        <button type="button" class="icon-button" title="Close" @click="$emit('close')"><X :size="18" /></button>
      </header>

      <div class="template-row" role="group" aria-label="Investigation templates">
        <button v-for="item in templates" :key="item.id" type="button" :class="{ active: template === item.id }" @click="applyTemplate(item.id)">{{ item.label }}</button>
      </div>

      <div class="form-scroll">
        <label class="wide"><span>Question</span><textarea v-model="form.question" rows="2" required></textarea></label>
        <label><span>Investigation ID</span><input v-model="form.investigationId" pattern="[a-z0-9][a-z0-9._\-]{2,79}" required></label>
        <label><span>Region name</span><input v-model="form.regionName" required></label>

        <fieldset class="wide bbox-fields">
          <legend>Bounding box</legend>
          <label><span>West</span><input v-model.number="form.west" type="number" step="0.0001" required></label>
          <label><span>South</span><input v-model.number="form.south" type="number" step="0.0001" required></label>
          <label><span>East</span><input v-model.number="form.east" type="number" step="0.0001" required></label>
          <label><span>North</span><input v-model.number="form.north" type="number" step="0.0001" required></label>
        </fieldset>

        <label><span>Start year</span><input v-model.number="form.startYear" type="number" min="1950" :max="currentYear" required></label>
        <label><span>End year</span><input v-model.number="form.endYear" type="number" min="1950" :max="currentYear" required></label>
        <label><span>Start month</span><select v-model.number="form.startMonth"><option v-for="month in 12" :key="month" :value="month">{{ month }}</option></select></label>
        <label><span>End month</span><select v-model.number="form.endMonth"><option v-for="month in 12" :key="month" :value="month">{{ month }}</option></select></label>

        <fieldset class="wide hypotheses">
          <legend>Hypotheses</legend>
          <div v-for="(hypothesis, index) in form.hypotheses" :key="hypothesis.id" class="hypothesis-row">
            <input v-model="hypothesis.statement" placeholder="Testable statement" required>
            <select v-model="hypothesis.role" aria-label="Observable role">
              <option v-for="role in roles" :key="role" :value="role">{{ role.replaceAll('_', ' ') }}</option>
            </select>
            <button type="button" class="icon-button" title="Remove hypothesis" :disabled="form.hypotheses.length === 1" @click="form.hypotheses.splice(index, 1)"><Trash2 :size="16" /></button>
          </div>
          <button type="button" class="text-button" @click="addHypothesis"><Plus :size="15" />Add hypothesis</button>
        </fieldset>

        <label class="wide"><span>Confounders, one per line</span><textarea v-model="form.confounders" rows="3"></textarea></label>
      </div>

      <footer>
        <span v-if="error" class="form-error">{{ error }}</span>
        <button type="button" @click="$emit('close')">Cancel</button>
        <button class="primary" :disabled="saving"><LoaderCircle v-if="saving" class="spin" :size="16" /><Play v-else :size="16" />Compile plan</button>
      </footer>
    </form>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from "vue";
import { LoaderCircle, Play, Plus, Trash2, X } from "lucide-vue-next";
import type { InvestigationSpec } from "../types";

defineProps<{ open: boolean; saving: boolean }>();
const emit = defineEmits<{ close: []; create: [spec: InvestigationSpec] }>();
const currentYear = new Date().getUTCFullYear();
const roles = ["built_surface", "human_activity", "vegetation", "surface_temperature", "water_extent", "precipitation", "fire_recovery", "climate_background", "flood_extent", "land_cover"];
const templates = [{ id: "blank", label: "Blank" }, { id: "urban", label: "Urban change" }, { id: "water", label: "Water balance" }, { id: "fire", label: "Fire recovery" }];
const template = ref("blank");
const error = ref("");
const form = reactive({ investigationId: "new-investigation", question: "What changed in this region, and which observations support or contradict it?", regionName: "Investigation area", west: 120.9, south: 30.8, east: 121.2, north: 31.1, startYear: 2018, endYear: Math.min(currentYear, 2025), startMonth: 6, endMonth: 8, hypotheses: [{ id: "h1", statement: "The observed phenomenon changed over time", role: "vegetation" }], confounders: "Use the same season in every comparison year" });

function applyTemplate(id: string) {
  template.value = id;
  if (id === "urban") {
    form.question = "Did built surface and nighttime activity increase, and what environmental changes accompanied them?";
    form.hypotheses = [{ id: "h1", statement: "Built surface increased", role: "built_surface" }, { id: "h2", statement: "Nighttime activity increased", role: "human_activity" }, { id: "h3", statement: "Vegetation changed", role: "vegetation" }];
    form.confounders = "Use the same season in every comparison year\nDo not interpret nighttime lights as GDP";
  } else if (id === "water") {
    form.question = "Did surface water extent change beyond normal rainfall variability?";
    form.hypotheses = [{ id: "h1", statement: "Surface water extent changed", role: "water_extent" }, { id: "h2", statement: "Precipitation explains part of the change", role: "precipitation" }];
    form.confounders = "Separate seasonal variability from long-term trend";
  } else if (id === "fire") {
    form.question = "How severe was the vegetation disturbance and how much recovery followed?";
    form.hypotheses = [{ id: "h1", statement: "Vegetation recovered after disturbance", role: "fire_recovery" }, { id: "h2", statement: "Climate background affected recovery", role: "climate_background" }];
    form.confounders = "Control seasonal phenology\nCheck cloud and smoke contamination";
  }
}
function addHypothesis() { form.hypotheses.push({ id: `h${form.hypotheses.length + 1}`, statement: "", role: "vegetation" }); }
function submit() {
  error.value = "";
  if (form.west >= form.east || form.south >= form.north) { error.value = "Bounding box order is invalid."; return; }
  emit("create", {
    schemaVersion: "scoutpi.investigation.v1", investigationId: form.investigationId, question: form.question, phenomenon: template.value,
    region: { kind: "bbox", bbox: [form.west, form.south, form.east, form.north], name: form.regionName },
    period: { startYear: form.startYear, endYear: form.endYear, startMonth: form.startMonth, endMonth: form.endMonth },
    hypotheses: form.hypotheses.map((item, index) => ({ id: item.id || `h${index + 1}`, statement: item.statement, observableRoles: [item.role] })),
    confounders: form.confounders.split("\n").map((item) => item.trim()).filter(Boolean), preferredOutputs: ["yearly_csv", "change_geotiff", "story"],
  });
}
</script>

<style scoped>
.backdrop { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; padding: 18px; background: rgba(24, 31, 27, .45); backdrop-filter: blur(3px); }
.dialog { display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; width: min(820px, 100%); max-height: min(820px, calc(100vh - 36px)); overflow: hidden; border: 1px solid #cfd7d2; border-radius: 8px; background: #fff; box-shadow: 0 24px 70px rgba(24, 38, 30, .25); }
header, footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px; }
header { border-bottom: 1px solid #e0e5e2; }
header p { margin: 0 0 2px; color: #617168; font-size: 11px; font-weight: 700; text-transform: uppercase; }
h2 { margin: 0; font-size: 19px; }
.template-row { display: flex; gap: 0; padding: 12px 18px 0; overflow-x: auto; }
.template-row button { border: 1px solid #d5ddd8; border-right: 0; padding: 7px 11px; background: #fff; color: #54635b; }
.template-row button:first-child { border-radius: 5px 0 0 5px; }.template-row button:last-child { border-right: 1px solid #d5ddd8; border-radius: 0 5px 5px 0; }.template-row button.active { background: #e7f0ea; color: #175b3b; font-weight: 700; }
.form-scroll { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; overflow: auto; padding: 16px 18px 20px; }
label { display: grid; gap: 5px; } label span, legend { color: #53635a; font-size: 11px; font-weight: 700; }
.wide { grid-column: 1 / -1; }
input, textarea, select { width: 100%; border: 1px solid #ccd5cf; border-radius: 5px; padding: 8px 9px; background: #fff; color: #17212b; font: inherit; }
textarea { resize: vertical; }
input:focus, textarea:focus, select:focus { outline: 2px solid rgba(47, 125, 89, .2); border-color: #2f7d59; }
fieldset { margin: 0; border: 1px solid #dce2de; border-radius: 6px; padding: 12px; }
.bbox-fields { display: grid; grid-template-columns: repeat(4, 1fr); gap: 9px; }
.hypotheses { display: grid; gap: 9px; }
.hypothesis-row { display: grid; grid-template-columns: minmax(180px, 1fr) 180px 34px; gap: 8px; }
button { border: 1px solid #cfd7d2; border-radius: 5px; padding: 8px 12px; background: #fff; color: #25322b; cursor: pointer; }
.icon-button { display: grid; width: 34px; height: 34px; place-items: center; padding: 0; }
.text-button { display: inline-flex; width: max-content; align-items: center; gap: 6px; border: 0; padding-left: 0; color: #236b49; }
footer { border-top: 1px solid #e0e5e2; justify-content: flex-end; }
.primary { display: inline-flex; align-items: center; gap: 7px; border-color: #1f6846; background: #1f6846; color: #fff; font-weight: 700; }
.form-error { margin-right: auto; color: #a53b49; font-size: 12px; }
.spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) { .form-scroll { grid-template-columns: 1fr; } .wide { grid-column: auto; } .bbox-fields { grid-template-columns: 1fr 1fr; } .hypothesis-row { grid-template-columns: 1fr; } .hypothesis-row .icon-button { justify-self: end; } }
</style>
