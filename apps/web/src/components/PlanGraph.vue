<template>
  <div class="graph-shell">
    <div class="stage-row" aria-hidden="true"><span>Source</span><span>Annual</span><span>Compare</span><span>Review</span><span>Export</span></div>
    <div ref="chartEl" class="graph" role="img" aria-label="Analysis plan dependency graph"></div>
  </div>
</template>

<script setup lang="ts">
import * as echarts from "echarts/core";
import { GraphChart } from "echarts/charts";
import { TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { AnalysisNode } from "../types";

echarts.use([GraphChart, TooltipComponent, CanvasRenderer]);
const props = defineProps<{ nodes: AnalysisNode[] }>();
const chartEl = ref<HTMLElement>();
let chart: echarts.ECharts | undefined;
const colors: Record<string, string> = { source: "#4e7396", annual_metric: "#2f7d59", compare: "#d18b36", trend: "#a85f48", critic: "#9d3f4f", export: "#725c96" };

function render() {
  if (!chart) return;
  const shown = props.nodes.filter((node) => ["source", "annual_metric", "compare", "trend", "critic", "export"].includes(node.op));
  const ids = new Set(shown.map((node) => node.nodeId));
  const rolePattern = /_(source|annual|compare|trend)$/;
  const roles = shown.filter((node) => node.op === "source").map((node) => node.nodeId.replace(rolePattern, ""));
  const position = (node: AnalysisNode) => {
    if (node.op === "critic") return { x: 300, y: Math.max(0, roles.length - 1) * 50 };
    if (node.op === "export") return { x: 400, y: Math.max(0, roles.length - 1) * 50 };
    const role = node.nodeId.replace(rolePattern, "");
    const row = Math.max(0, roles.indexOf(role)) * 100;
    const x = node.op === "source" ? 0 : node.op === "annual_metric" ? 100 : 200;
    return { x, y: row + (node.op === "compare" ? -17 : node.op === "trend" ? 17 : 0) };
  };
  chart.setOption({
    tooltip: { formatter: (value: any) => `${value.data.name}<br>${value.data.op}` },
    animationDurationUpdate: 350,
    series: [{
      type: "graph", layout: "none", roam: false,
      left: 18, right: 18, top: 18, bottom: 20,
      label: { color: "#17212b", fontSize: 9, width: 76, overflow: "truncate" },
      lineStyle: { color: "#9da9a2", width: 1.2, curveness: .08 },
      emphasis: { focus: "adjacency", lineStyle: { width: 2 } },
      data: shown.map((node) => ({
        id: node.nodeId,
        name: node.nodeId.replace(rolePattern, "").replaceAll("_", " "),
        op: node.op,
        ...position(node),
        symbolSize: node.op === "critic" || node.op === "export" ? 28 : node.op === "source" ? 22 : 17,
        label: node.op === "source"
          ? { show: true, position: "bottom" }
          : node.op === "critic" || node.op === "export"
            ? { show: true, position: "bottom" }
            : { show: false },
        itemStyle: { color: colors[node.op] || "#89958e", borderColor: "#fff", borderWidth: 2 },
      })),
      links: shown.flatMap((node) => node.dependsOn.filter((id) => ids.has(id)).map((source) => ({ source, target: node.nodeId }))),
    }],
  });
}

onMounted(() => { chart = echarts.init(chartEl.value!); render(); window.addEventListener("resize", resize); });
watch(() => props.nodes, render, { deep: true });
function resize() { chart?.resize(); }
onBeforeUnmount(() => { window.removeEventListener("resize", resize); chart?.dispose(); });
</script>

<style scoped>
.graph-shell { display: grid; grid-template-rows: 22px 1fr; width: 100%; height: 330px; }
.stage-row { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border-bottom: 1px solid #e6eae7; color: #75827b; font-size: 8px; text-align: center; text-transform: uppercase; }
.graph { width: 100%; min-height: 0; }
</style>
