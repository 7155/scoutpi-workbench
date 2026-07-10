<template>
  <div class="metrics-wrap">
    <div class="metric-strip">
      <div><span>Datasets</span><strong>{{ plan?.datasets.length || 0 }}</strong></div>
      <div><span>Years</span><strong>{{ plan?.estimatedCost.years || 0 }}</strong></div>
      <div><span>DAG nodes</span><strong>{{ plan?.dag.length || 0 }}</strong></div>
      <div><span>Blocking checks</span><strong>{{ blocking }}</strong></div>
    </div>
    <div ref="chartEl" class="chart" role="img" aria-label="Dataset spatial resolution chart"></div>
  </div>
</template>

<script setup lang="ts">
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { InvestigationPlan } from "../types";

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);
const props = defineProps<{ plan?: InvestigationPlan }>();
const chartEl = ref<HTMLElement>();
let chart: echarts.ECharts | undefined;
const blocking = computed(() => props.plan?.criticChecks.filter((item) => item.severity === "blocking").length || 0);
function render() {
  if (!chart) return;
  const datasets = props.plan?.datasets || [];
  chart.setOption({
    animationDuration: 350,
    grid: { left: 90, right: 26, top: 18, bottom: 34 },
    tooltip: { trigger: "axis", formatter: (rows: any) => `${rows[0].name}<br>Nominal scale: ${rows[0].value} m` },
    xAxis: { type: "value", name: "Nominal scale (m)", nameLocation: "middle", nameGap: 25, axisLabel: { color: "#67746d" }, splitLine: { lineStyle: { color: "#e8ece9" } } },
    yAxis: { type: "category", data: datasets.map((item) => item.role.replaceAll("_", " ")), axisLabel: { width: 82, overflow: "truncate", color: "#4c5a52" }, axisTick: { show: false }, axisLine: { show: false } },
    series: [{ type: "bar", data: datasets.map((item, index) => ({ value: item.dataset.scaleMeters, itemStyle: { color: ["#2f7d59", "#d18b36", "#4e7396", "#a85f48"][index % 4], borderRadius: [0, 3, 3, 0] } })), barMaxWidth: 22 }],
  });
}
onMounted(() => { chart = echarts.init(chartEl.value!); render(); window.addEventListener("resize", resize); });
watch(() => props.plan?.planId, render);
function resize() { chart?.resize(); }
onBeforeUnmount(() => { window.removeEventListener("resize", resize); chart?.dispose(); });
</script>

<style scoped>
.metrics-wrap { display: grid; gap: 12px; }
.metric-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-bottom: 1px solid #e0e5e2; }
.metric-strip > div { display: grid; gap: 3px; padding: 0 12px 12px; border-left: 1px solid #e0e5e2; }
.metric-strip > div:first-child { border-left: 0; padding-left: 0; }
.metric-strip span { color: #6b7871; font-size: 11px; }
.metric-strip strong { font-size: 20px; font-weight: 650; }
.chart { width: 100%; height: 260px; }
@media (max-width: 620px) { .metric-strip { grid-template-columns: 1fr 1fr; row-gap: 12px; } .metric-strip > div:nth-child(3) { border-left: 0; padding-left: 0; } }
</style>
