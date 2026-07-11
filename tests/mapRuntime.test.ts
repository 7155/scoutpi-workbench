import assert from "node:assert/strict";
import test from "node:test";
import { loadMapViewMode, MAP_VIEW_MODE_STORAGE_KEY, normalizeMapViewMode, regionBounds, regionFeatureCollection, saveMapViewMode } from "../apps/web/src/mapRuntime.ts";

test("map view mode is persisted with a fail-closed 2D default", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };

  assert.equal(loadMapViewMode(storage), "2d");
  saveMapViewMode("3d", storage);
  assert.equal(values.get(MAP_VIEW_MODE_STORAGE_KEY), "3d");
  assert.equal(loadMapViewMode(storage), "3d");
  assert.equal(normalizeMapViewMode("terrain"), "2d");
});

test("region runtime normalizes bbox and arbitrary GeoJSON collections for both renderers", () => {
  const bboxRegion = { kind: "bbox" as const, bbox: [120, 30, 122, 32] as [number, number, number, number] };
  assert.equal(regionFeatureCollection(bboxRegion).features[0]?.geometry.type, "Polygon");
  assert.deepEqual(regionBounds(bboxRegion), [120, 30, 122, 32]);

  const geojsonRegion = {
    kind: "geojson" as const,
    geometry: {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { id: "a" }, geometry: { type: "Point", coordinates: [121.5, 31.2] } },
        { type: "Feature", properties: { id: "b" }, geometry: { type: "LineString", coordinates: [[120.8, 30.7], [122.1, 32.3]] } },
      ],
    },
  };
  assert.equal(regionFeatureCollection(geojsonRegion).features.length, 2);
  assert.deepEqual(regionBounds(geojsonRegion), [120.8, 30.7, 122.1, 32.3]);
});
