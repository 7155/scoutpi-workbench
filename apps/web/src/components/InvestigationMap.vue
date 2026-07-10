<template>
  <div ref="container" class="map-shell">
    <div class="map-overlay map-title">
      <span>{{ regionName }}</span>
      <strong>{{ periodLabel }}</strong>
      <small v-if="visualizationLoading">Loading Earth Engine layer</small>
      <small v-else-if="visualizationError" class="layer-error">{{ visualizationError }}</small>
      <small v-else-if="visualization">Live tile · {{ visualization.outputName }}</small>
    </div>
    <div class="map-overlay map-legend">
      <span><i class="swatch boundary"></i>Investigation area</span>
      <button v-for="item in plan?.datasets || []" :key="item.role" :class="{ active: item.role === selectedRole }" @click="$emit('selectRole', item.role)">
        <i v-if="item.role === selectedRole && visualization" class="swatch ramp" :style="{ background: `linear-gradient(90deg, ${visualization.legend.palette.map((color) => `#${color}`).join(', ')})` }"></i>
        <i v-else class="swatch dataset"></i>{{ item.role.replaceAll('_', ' ') }}
      </button>
      <div v-if="visualization" class="legend-range"><code>{{ visualization.legend.min }}</code><span></span><code>{{ visualization.legend.max }}</code></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import maplibregl, { type GeoJSONSource, type Map } from "maplibre-gl";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { EarthVisualization, InvestigationPlan } from "../types";

const props = defineProps<{ plan?: InvestigationPlan; selectedYear?: number; selectedRole?: string; visualization?: EarthVisualization; visualizationLoading?: boolean; visualizationError?: string }>();
defineEmits<{ selectRole: [role: string] }>();
const container = ref<HTMLElement>();
let map: Map | undefined;
let regionSyncPending = false;
let visualizationSyncPending = false;

const regionName = computed(() => props.plan?.spec.region.name || "No region selected");
const periodLabel = computed(() => props.visualization ? `${props.visualization.year} · ${props.visualization.datasetId}` : props.plan ? `${props.plan.spec.period.startYear}-${props.plan.spec.period.endYear}` : "-");

function regionGeoJson() {
  const region = props.plan?.spec.region;
  if (!region) return { type: "FeatureCollection", features: [] } as any;
  if (region.kind === "geojson" && region.geometry) return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: region.geometry }] } as any;
  if (region.kind === "bbox" && region.bbox) {
    const [w, s, e, n] = region.bbox;
    return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } }] } as any;
  }
  return { type: "FeatureCollection", features: [] } as any;
}

function syncRegion() {
  if (!map || !map.isStyleLoaded() || !map.getSource("investigation")) {
    regionSyncPending = true;
    return;
  }
  regionSyncPending = false;
  map.resize();
  const source = map.getSource("investigation") as GeoJSONSource | undefined;
  source?.setData(regionGeoJson());
  const bbox = props.plan?.spec.region.bbox;
  if (bbox) {
    const bounds = new maplibregl.LngLatBounds([bbox[0], bbox[1]], [bbox[2], bbox[3]]);
    map.fitBounds(bounds, { padding: 72, duration: 0, maxZoom: 12 });
  }
}

function syncVisualization() {
  if (!map || !map.isStyleLoaded()) { visualizationSyncPending = true; return; }
  visualizationSyncPending = false;
  if (map.getLayer("earth-analysis")) map.removeLayer("earth-analysis");
  if (map.getSource("earth-analysis")) map.removeSource("earth-analysis");
  if (!props.visualization?.tileUrl) return;
  map.addSource("earth-analysis", { type: "raster", tiles: [props.visualization.tileUrl], tileSize: 256 });
  map.addLayer({ id: "earth-analysis", type: "raster", source: "earth-analysis", paint: { "raster-opacity": 0.72, "raster-resampling": "linear" } }, map.getLayer("investigation-fill") ? "investigation-fill" : undefined);
}

onMounted(() => {
  const initialBbox = props.plan?.spec.region.bbox;
  map = new maplibregl.Map({
    container: container.value!,
    ...(initialBbox
      ? {
          bounds: new maplibregl.LngLatBounds(
            [initialBbox[0], initialBbox[1]],
            [initialBbox[2], initialBbox[3]],
          ),
          fitBoundsOptions: { padding: 72, maxZoom: 12 },
        }
      : { center: [110, 30] as [number, number], zoom: 3.2 }),
    attributionControl: false,
    style: {
      version: 8,
      sources: {
        osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "OpenStreetMap" },
      },
      layers: [
        { id: "base", type: "raster", source: "osm", paint: { "raster-saturation": -0.55, "raster-contrast": 0.08, "raster-brightness-max": 0.94 } },
      ],
    },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
  map.on("load", () => {
    map!.addSource("investigation", { type: "geojson", data: regionGeoJson() });
    map!.addLayer({ id: "investigation-fill", type: "fill", source: "investigation", paint: { "fill-color": "#2f7d59", "fill-opacity": 0.2 } });
    map!.addLayer({ id: "investigation-line", type: "line", source: "investigation", paint: { "line-color": "#14563a", "line-width": 2.5, "line-dasharray": [2, 1] } });
    syncVisualization();
    requestAnimationFrame(() => requestAnimationFrame(syncRegion));
  });
  map.on("idle", () => {
    if (regionSyncPending) syncRegion();
    if (visualizationSyncPending) syncVisualization();
  });
});

watch(() => props.plan?.planId, syncRegion);
watch(() => props.visualization?.tileUrl, syncVisualization);
onBeforeUnmount(() => map?.remove());
</script>

<style scoped>
.map-shell { position: relative; width: 100%; height: 100%; min-height: 360px; background: #d9dfdc; }
.map-overlay { position: absolute; z-index: 3; border: 1px solid rgba(43, 56, 49, .18); background: rgba(252, 253, 251, .92); box-shadow: 0 8px 20px rgba(32, 45, 38, .1); backdrop-filter: blur(8px); }
.map-title { top: 14px; left: 14px; display: grid; gap: 1px; max-width: min(360px, calc(100% - 28px)); padding: 9px 11px; border-radius: 6px; }
.map-title span { overflow: hidden; text-overflow: ellipsis; color: #25322b; font-weight: 700; white-space: nowrap; }
.map-title strong { color: #607067; font: 11px ui-monospace, SFMono-Regular, monospace; }
.map-title small { color: #2f7d59; font-size: 9px; }.map-title .layer-error { max-width: 280px; overflow: hidden; color: #a54450; text-overflow: ellipsis; white-space: nowrap; }
.map-legend { right: 14px; top: 14px; display: grid; gap: 6px; max-height: 165px; overflow: auto; padding: 9px 11px; border-radius: 6px; color: #46554d; font-size: 11px; }
.map-legend > span, .map-legend button { display: flex; align-items: center; gap: 7px; }.map-legend button { border: 0; border-radius: 3px; padding: 3px 4px; background: transparent; color: inherit; text-align: left; cursor: pointer; }.map-legend button:hover, .map-legend button.active { background: #e8efea; color: #1f6846; }
.swatch { width: 11px; height: 11px; flex: 0 0 auto; }
.boundary { border: 2px solid #14563a; background: rgba(47, 125, 89, .2); }
.dataset { border-radius: 50%; background: #d18b36; }
.ramp { width: 28px; border: 1px solid rgba(32, 45, 38, .18); }.legend-range { display: grid; grid-template-columns: auto 1fr auto; gap: 5px; align-items: center; padding: 1px 4px; }.legend-range span { height: 2px; background: #9ca9a2; }.legend-range code { font-size: 8px; }
@media (max-width: 760px) { .map-shell { min-height: 310px; } .map-legend { display: none; } }
</style>
