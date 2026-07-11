<template>
  <div class="map-shell" :data-map-mode="mapMode" :data-control-source="followPi ? 'pi' : 'local'">
    <div ref="map2dContainer" :class="['map-surface', 'maplibre-surface', { active: mapMode === '2d' }]" :aria-hidden="mapMode !== '2d'"></div>
    <div
      ref="globe3dContainer"
      :class="['map-surface', 'cesium-surface', { active: mapMode === '3d' }]"
      :aria-hidden="mapMode !== '3d'"
      :data-ready="globeReady"
      :data-render-count="globeRenderCount"
      :data-region-features="globeRegionFeatureCount"
      :data-analysis-layer="globeHasAnalysisLayer"
    ></div>

    <div class="map-overlay map-title">
      <em>{{ t('Pi spatial focus') }}</em>
      <span>{{ regionName }}</span>
      <strong>{{ periodLabel }}</strong>
      <small v-if="visualizationLoading">{{ t('Loading Earth Engine layer') }}</small>
      <small v-else-if="visualizationError" class="layer-error">{{ visualizationError }}</small>
      <small v-else-if="visualization">{{ t('Live tile') }} · {{ visualization.outputName }}</small>
    </div>

    <div class="map-mode" role="group" :aria-label="t('Switch map view')">
      <button :class="{ active: mapMode === '2d' }" :aria-pressed="mapMode === '2d'" :title="t('2D map')" @click="selectMapMode('2d')">
        <MapIcon :size="15" /><span>2D</span>
      </button>
      <button :class="{ active: mapMode === '3d' }" :aria-pressed="mapMode === '3d'" :title="t('3D globe')" @click="selectMapMode('3d')">
        <Globe2 :size="15" /><span>3D</span>
      </button>
    </div>

    <button :class="['map-follow', { active: followPi }]" :title="followPi ? t('Following Pi spatial focus') : t('Resume following Pi')" @click="emit('toggleFollow')">
      <Crosshair :size="14" /><span>{{ followPi ? t('Pi controls view') : t('Local inspection') }}</span>
    </button>

    <div v-if="mapMode === '3d' && (globeLoading || globeError)" :class="['map-overlay', 'globe-status', { error: globeError }]" role="status">
      <LoaderCircle v-if="globeLoading" class="spin" :size="16" />
      <span>{{ globeError ? t('3D view unavailable') : t('Loading 3D globe') }}</span>
      <small v-if="globeError">{{ globeError }}</small>
    </div>

    <div class="map-overlay map-legend">
      <span><i class="swatch boundary"></i>{{ t('Investigation area') }}</span>
      <button v-for="item in plan?.datasets || []" :key="item.role" :class="{ active: item.role === selectedRole }" @click="$emit('selectRole', item.role)">
        <i v-if="item.role === selectedRole && visualization" class="swatch ramp" :style="{ background: `linear-gradient(90deg, ${visualization.legend.palette.map((color) => `#${color}`).join(', ')})` }"></i>
        <i v-else class="swatch dataset"></i>{{ roleLabel(item.role) }}
      </button>
      <div v-if="visualization" class="legend-range"><code>{{ visualization.legend.min }}</code><span></span><code>{{ visualization.legend.max }}</code></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import "cesium/Build/Cesium/Widgets/widgets.css";
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap } from "maplibre-gl";
import { Crosshair, Globe2, LoaderCircle, Map as MapIcon } from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "../i18n";
import { loadMapViewMode, regionBounds, regionFeatureCollection, saveMapViewMode, type MapViewMode } from "../mapRuntime";
import type { EarthVisualization, InvestigationPlan } from "../types";

type CesiumModule = typeof import("cesium");
type CesiumViewer = import("cesium").Viewer;
type CesiumRegionSource = import("cesium").GeoJsonDataSource;
type CesiumImageryLayer = import("cesium").ImageryLayer;

const props = defineProps<{ plan?: InvestigationPlan; selectedYear?: number; selectedRole?: string; visualization?: EarthVisualization; visualizationLoading?: boolean; visualizationError?: string; requestedMode?: MapViewMode; followPi?: boolean }>();
const emit = defineEmits<{ selectRole: [role: string]; modeChange: [mode: MapViewMode]; toggleFollow: [] }>();
const { t, roleLabel } = useI18n();

const map2dContainer = ref<HTMLElement>();
const globe3dContainer = ref<HTMLElement>();
const mapMode = ref<MapViewMode>(props.requestedMode ?? loadMapViewMode(typeof window === "undefined" ? undefined : window.localStorage));
const globeLoading = ref(false);
const globeError = ref("");
const globeReady = ref(false);
const globeRenderCount = ref(0);
const globeRegionFeatureCount = ref(0);
const globeHasAnalysisLayer = ref(false);

let map: MapLibreMap | undefined;
let cesium: CesiumModule | undefined;
let viewer: CesiumViewer | undefined;
let cesiumRegionSource: CesiumRegionSource | undefined;
let cesiumAnalysisLayer: CesiumImageryLayer | undefined;
let removePostRenderListener: (() => void) | undefined;
let resizeObserver: ResizeObserver | undefined;
let regionSyncPending = false;
let visualizationSyncPending = false;
let cesiumRegionRevision = 0;
let cesiumInitRevision = 0;
let disposed = false;

const regionName = computed(() => props.plan?.spec.region.name || t("No region selected"));
const periodLabel = computed(() => props.visualization ? `${props.visualization.year} · ${props.visualization.datasetId}` : props.plan ? `${props.plan.spec.period.startYear}-${props.plan.spec.period.endYear}` : "-");

function syncMapRegion() {
  if (!map || !map.isStyleLoaded() || !map.getSource("investigation")) {
    regionSyncPending = true;
    return;
  }
  regionSyncPending = false;
  map.resize();
  const source = map.getSource("investigation") as GeoJSONSource | undefined;
  source?.setData(regionFeatureCollection(props.plan?.spec.region));
  const bounds = regionBounds(props.plan?.spec.region);
  if (bounds) {
    map.fitBounds(new maplibregl.LngLatBounds([bounds[0], bounds[1]], [bounds[2], bounds[3]]), { padding: 72, duration: 0, maxZoom: 12 });
  }
}

function syncMapVisualization() {
  if (!map || !map.isStyleLoaded()) {
    visualizationSyncPending = true;
    return;
  }
  visualizationSyncPending = false;
  if (map.getLayer("earth-analysis")) map.removeLayer("earth-analysis");
  if (map.getSource("earth-analysis")) map.removeSource("earth-analysis");
  if (!props.visualization?.tileUrl) return;
  map.addSource("earth-analysis", { type: "raster", tiles: [props.visualization.tileUrl], tileSize: 256 });
  map.addLayer({ id: "earth-analysis", type: "raster", source: "earth-analysis", paint: { "raster-opacity": 0.72, "raster-resampling": "linear" } }, map.getLayer("investigation-fill") ? "investigation-fill" : undefined);
}

function cesiumRectangle() {
  if (!cesium) return undefined;
  const bounds = regionBounds(props.plan?.spec.region);
  return bounds ? cesium.Rectangle.fromDegrees(bounds[0], bounds[1], bounds[2], bounds[3]) : undefined;
}

function focusCesiumRegion() {
  if (!viewer || !cesium) return;
  const bounds = regionBounds(props.plan?.spec.region);
  if (!bounds) return;
  const [west, south, east, north] = bounds;
  const center = cesium.Cartesian3.fromDegrees((west + east) / 2, (south + north) / 2);
  const diagonal = cesium.Cartesian3.distance(
    cesium.Cartesian3.fromDegrees(west, south),
    cesium.Cartesian3.fromDegrees(east, north),
  );
  viewer.camera.lookAt(
    center,
    new cesium.HeadingPitchRange(
      cesium.Math.toRadians(18),
      cesium.Math.toRadians(-48),
      Math.max(diagonal * 1.65, 2_500),
    ),
  );
  viewer.camera.lookAtTransform(cesium.Matrix4.IDENTITY);
}

async function syncCesiumRegion() {
  if (!viewer || !cesium) return;
  const revision = ++cesiumRegionRevision;
  if (cesiumRegionSource) {
    viewer.dataSources.remove(cesiumRegionSource, true);
    cesiumRegionSource = undefined;
  }

  const collection = regionFeatureCollection(props.plan?.spec.region);
  globeRegionFeatureCount.value = collection.features.length;
  if (!collection.features.length) {
    viewer.scene.requestRender();
    return;
  }

  const source = await cesium.GeoJsonDataSource.load(collection, {
    stroke: cesium.Color.fromCssColorString("#14563a"),
    fill: cesium.Color.fromCssColorString("#2f7d59").withAlpha(0.2),
    strokeWidth: 2.5,
    clampToGround: false,
  });
  if (disposed || revision !== cesiumRegionRevision || !viewer || viewer.isDestroyed()) return;
  cesiumRegionSource = source;
  await viewer.dataSources.add(source);
  focusCesiumRegion();
  viewer.scene.requestRender();
}

function syncCesiumVisualization() {
  if (!viewer || !cesium) return;
  if (cesiumAnalysisLayer) {
    viewer.imageryLayers.remove(cesiumAnalysisLayer, true);
    cesiumAnalysisLayer = undefined;
  }
  globeHasAnalysisLayer.value = false;
  if (!props.visualization?.tileUrl) {
    viewer.scene.requestRender();
    return;
  }

  const provider = new cesium.UrlTemplateImageryProvider({
    url: props.visualization.tileUrl,
    rectangle: cesiumRectangle(),
    tileWidth: 256,
    tileHeight: 256,
    credit: "Google Earth Engine",
  });
  cesiumAnalysisLayer = new cesium.ImageryLayer(provider, { alpha: 0.72 });
  viewer.imageryLayers.add(cesiumAnalysisLayer);
  globeHasAnalysisLayer.value = true;
  viewer.scene.requestRender();
}

async function ensureCesium() {
  if (viewer || globeLoading.value || !globe3dContainer.value) return;
  const revision = ++cesiumInitRevision;
  globeLoading.value = true;
  globeError.value = "";
  try {
    const module = await import("cesium");
    if (disposed || revision !== cesiumInitRevision || !globe3dContainer.value) return;
    cesium = module;
    viewer = new module.Viewer(globe3dContainer.value, {
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      baseLayer: new module.ImageryLayer(new module.OpenStreetMapImageryProvider({ url: "https://tile.openstreetmap.org/", maximumLevel: 19 })),
      terrainProvider: new module.EllipsoidTerrainProvider(),
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      scene3DOnly: true,
      requestRenderMode: true,
      maximumRenderTimeChange: Number.POSITIVE_INFINITY,
      shouldAnimate: false,
      skyBox: false,
      skyAtmosphere: false,
    });
    viewer.scene.backgroundColor = module.Color.fromCssColorString("#dce7e1");
    viewer.scene.globe.baseColor = module.Color.fromCssColorString("#d9dfdc");
    viewer.scene.fog.enabled = false;
    removePostRenderListener = viewer.scene.postRender.addEventListener(() => {
      globeRenderCount.value += 1;
      if (globeRenderCount.value >= 2) {
        globeReady.value = true;
        removePostRenderListener?.();
        removePostRenderListener = undefined;
      }
    });
    await syncCesiumRegion();
    syncCesiumVisualization();
    await nextTick();
    viewer.resize();
    viewer.scene.requestRender();
  } catch (error) {
    globeError.value = error instanceof Error ? error.message : String(error);
  } finally {
    if (revision === cesiumInitRevision) globeLoading.value = false;
  }
}

async function setMapMode(mode: MapViewMode) {
  mapMode.value = mode;
  saveMapViewMode(mode, typeof window === "undefined" ? undefined : window.localStorage);
  await nextTick();
  if (mode === "3d") {
    await ensureCesium();
    viewer?.resize();
    viewer?.scene.requestRender();
  } else {
    map?.resize();
  }
}

async function selectMapMode(mode: MapViewMode) {
  await setMapMode(mode);
  emit("modeChange", mode);
}

onMounted(() => {
  const initialBounds = regionBounds(props.plan?.spec.region);
  map = new maplibregl.Map({
    container: map2dContainer.value!,
    ...(initialBounds
      ? {
          bounds: new maplibregl.LngLatBounds([initialBounds[0], initialBounds[1]], [initialBounds[2], initialBounds[3]]),
          fitBoundsOptions: { padding: 72, maxZoom: 12 },
        }
      : { center: [110, 30] as [number, number], zoom: 3.2 }),
    attributionControl: false,
    style: {
      version: 8,
      sources: {
        osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "OpenStreetMap" },
      },
      layers: [
        { id: "base", type: "raster", source: "osm", paint: { "raster-saturation": -0.55, "raster-contrast": 0.08, "raster-brightness-max": 0.94 } },
      ],
    },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "bottom-right");
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
  map.on("load", () => {
    map!.addSource("investigation", { type: "geojson", data: regionFeatureCollection(props.plan?.spec.region) });
    map!.addLayer({ id: "investigation-fill", type: "fill", source: "investigation", paint: { "fill-color": "#2f7d59", "fill-opacity": 0.2 } });
    map!.addLayer({ id: "investigation-line", type: "line", source: "investigation", paint: { "line-color": "#14563a", "line-width": 2.5, "line-dasharray": [2, 1] } });
    syncMapVisualization();
    requestAnimationFrame(() => requestAnimationFrame(syncMapRegion));
  });
  map.on("idle", () => {
    if (regionSyncPending) syncMapRegion();
    if (visualizationSyncPending) syncMapVisualization();
  });
  resizeObserver = new ResizeObserver(() => {
    map?.resize();
    viewer?.resize();
    viewer?.scene.requestRender();
  });
  resizeObserver.observe(map2dContainer.value!);
  if (mapMode.value === "3d") void ensureCesium();
});

watch(() => props.plan?.planId, () => {
  syncMapRegion();
  void syncCesiumRegion();
});
watch(() => props.visualization?.tileUrl, () => {
  syncMapVisualization();
  syncCesiumVisualization();
});
watch(() => props.requestedMode, (mode) => {
  if (mode && mode !== mapMode.value) void setMapMode(mode);
});

onBeforeUnmount(() => {
  disposed = true;
  cesiumInitRevision += 1;
  cesiumRegionRevision += 1;
  removePostRenderListener?.();
  resizeObserver?.disconnect();
  map?.remove();
  if (viewer && !viewer.isDestroyed()) viewer.destroy();
});
</script>

<style scoped>
.map-shell { position: relative; width: 100%; height: 100%; min-height: 360px; overflow: hidden; background: #d9dfdc; }
.map-surface { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 160ms ease; }
.map-surface.active { opacity: 1; visibility: visible; pointer-events: auto; }
.cesium-surface :deep(.cesium-viewer), .cesium-surface :deep(.cesium-viewer-cesiumWidgetContainer), .cesium-surface :deep(.cesium-widget), .cesium-surface :deep(canvas) { width: 100%; height: 100%; }
.cesium-surface :deep(.cesium-viewer-bottom) { right: 8px; bottom: 5px; left: auto; }
.map-overlay { position: absolute; z-index: 3; border: 1px solid rgba(43, 56, 49, .18); background: rgba(252, 253, 251, .92); box-shadow: 0 8px 20px rgba(32, 45, 38, .1); backdrop-filter: blur(8px); }
.map-title { top: 14px; left: 14px; display: grid; gap: 1px; max-width: min(360px, calc(100% - 410px)); padding: 9px 11px; border-radius: 6px; }
.map-title em { color: #748079; font-size: 8px; font-style: normal; font-weight: 750; text-transform: uppercase; }
.map-title span { overflow: hidden; color: #25322b; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.map-title strong { color: #607067; font: 11px ui-monospace, SFMono-Regular, monospace; }
.map-title small { color: #2f7d59; font-size: 9px; }
.map-title .layer-error { max-width: 280px; overflow: hidden; color: #a54450; text-overflow: ellipsis; white-space: nowrap; }
.map-mode { position: absolute; z-index: 5; top: 14px; left: 50%; display: grid; grid-template-columns: repeat(2, 54px); height: 36px; padding: 3px; border: 1px solid rgba(43, 56, 49, .2); border-radius: 6px; background: rgba(252, 253, 251, .94); box-shadow: 0 8px 20px rgba(32, 45, 38, .1); transform: translateX(-50%); backdrop-filter: blur(8px); }
.map-mode button { display: flex; align-items: center; justify-content: center; gap: 5px; border: 0; border-radius: 3px; background: transparent; color: #617068; font: 700 11px/1 system-ui, sans-serif; cursor: pointer; }
.map-mode button:hover { color: #1f6846; }
.map-mode button.active { background: #1f6846; color: #fff; box-shadow: 0 2px 6px rgba(31, 104, 70, .2); }
.map-follow { position: absolute; z-index: 5; top: 56px; left: 50%; display: flex; align-items: center; gap: 6px; border: 1px solid rgba(43, 56, 49, .2); border-radius: 5px; padding: 6px 9px; background: rgba(252, 253, 251, .94); box-shadow: 0 6px 16px rgba(32, 45, 38, .09); color: #68756e; font-size: 9px; font-weight: 700; transform: translateX(-50%); backdrop-filter: blur(8px); }
.map-follow.active { border-color: rgba(31, 104, 70, .38); background: rgba(239, 247, 242, .95); color: #1f6846; }
.globe-status { top: 64px; left: 50%; display: flex; align-items: center; gap: 7px; max-width: min(420px, calc(100% - 28px)); padding: 8px 10px; border-radius: 5px; color: #2f5e48; transform: translateX(-50%); }
.globe-status.error { color: #9d3341; }
.globe-status small { max-width: 260px; overflow: hidden; color: #68756e; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.map-legend { top: 14px; right: 14px; display: grid; gap: 6px; max-width: 210px; max-height: 165px; overflow: auto; padding: 9px 11px; border-radius: 6px; color: #46554d; font-size: 11px; }
.map-legend > span, .map-legend button { display: flex; align-items: center; gap: 7px; }
.map-legend button { border: 0; border-radius: 3px; padding: 3px 4px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.map-legend button:hover, .map-legend button.active { background: #e8efea; color: #1f6846; }
.swatch { width: 11px; height: 11px; flex: 0 0 auto; }
.boundary { border: 2px solid #14563a; background: rgba(47, 125, 89, .2); }
.dataset { border-radius: 50%; background: #d18b36; }
.ramp { width: 28px; border: 1px solid rgba(32, 45, 38, .18); }
.legend-range { display: grid; grid-template-columns: auto 1fr auto; gap: 5px; align-items: center; padding: 1px 4px; }
.legend-range span { height: 2px; background: #9ca9a2; }
.legend-range code { font-size: 8px; }
.spin { animation: spin 900ms linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 1050px) { .map-title { max-width: min(320px, calc(100% - 330px)); } .map-legend { max-width: 170px; } }
@media (max-width: 760px) {
  .map-shell { min-height: 310px; }
  .map-title { top: 10px; left: 10px; max-width: calc(100% - 132px); padding: 8px 9px; }
  .map-mode { top: 10px; right: 10px; left: auto; grid-template-columns: repeat(2, 48px); transform: none; }
  .map-follow { top: 54px; right: 10px; left: auto; transform: none; }
  .map-legend { display: none; }
  .globe-status { top: 58px; }
}
</style>
