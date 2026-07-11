import type { Feature, FeatureCollection, GeoJsonProperties, Geometry, Position } from "geojson";
import type { RegionSpec } from "./types.js";

export type MapViewMode = "2d" | "3d";

export const MAP_VIEW_MODE_STORAGE_KEY = "scoutpi.workbench.map-mode";

type MapModeStorage = Pick<Storage, "getItem" | "setItem">;

export function normalizeMapViewMode(value: unknown): MapViewMode {
  return value === "3d" ? "3d" : "2d";
}

export function loadMapViewMode(storage?: MapModeStorage): MapViewMode {
  if (!storage) return "2d";
  try {
    return normalizeMapViewMode(storage.getItem(MAP_VIEW_MODE_STORAGE_KEY));
  } catch {
    return "2d";
  }
}

export function saveMapViewMode(mode: MapViewMode, storage?: MapModeStorage): void {
  if (!storage) return;
  try {
    storage.setItem(MAP_VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // A blocked localStorage must not make the map unusable.
  }
}

function emptyCollection(): FeatureCollection<Geometry, GeoJsonProperties> {
  return { type: "FeatureCollection", features: [] };
}

function bboxFeature(bbox: [number, number, number, number]): Feature<Geometry, GeoJsonProperties> {
  const [west, south, east, north] = bbox;
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function regionFeatureCollection(region?: RegionSpec): FeatureCollection<Geometry, GeoJsonProperties> {
  if (!region) return emptyCollection();
  if (region.kind === "bbox" && region.bbox) {
    return { type: "FeatureCollection", features: [bboxFeature(region.bbox)] };
  }
  if (region.kind !== "geojson" || !isRecord(region.geometry)) return emptyCollection();

  if (region.geometry.type === "FeatureCollection" && Array.isArray(region.geometry.features)) {
    return region.geometry as unknown as FeatureCollection<Geometry, GeoJsonProperties>;
  }
  if (region.geometry.type === "Feature" && isRecord(region.geometry.geometry)) {
    return { type: "FeatureCollection", features: [region.geometry as unknown as Feature<Geometry, GeoJsonProperties>] };
  }
  if (typeof region.geometry.type === "string") {
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: region.geometry as unknown as Geometry }],
    };
  }
  return emptyCollection();
}

function visitCoordinates(value: unknown, visit: (position: Position) => void): void {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
    visit(value as Position);
    return;
  }
  for (const child of value) visitCoordinates(child, visit);
}

function visitGeometry(geometry: Geometry | null, visit: (position: Position) => void): void {
  if (!geometry) return;
  if (geometry.type === "GeometryCollection") {
    for (const child of geometry.geometries) visitGeometry(child, visit);
    return;
  }
  visitCoordinates(geometry.coordinates, visit);
}

export function regionBounds(region?: RegionSpec): [number, number, number, number] | undefined {
  if (region?.bbox?.length === 4 && region.bbox.every(Number.isFinite)) {
    return [region.bbox[0], region.bbox[1], region.bbox[2], region.bbox[3]];
  }

  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const feature of regionFeatureCollection(region).features) {
    visitGeometry(feature.geometry, ([longitude, latitude]) => {
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
      west = Math.min(west, longitude);
      south = Math.min(south, latitude);
      east = Math.max(east, longitude);
      north = Math.max(north, latitude);
    });
  }
  if (![west, south, east, north].every(Number.isFinite)) return undefined;

  const longitudePadding = west === east ? 0.05 : 0;
  const latitudePadding = south === north ? 0.05 : 0;
  return [west - longitudePadding, south - latitudePadding, east + longitudePadding, north + latitudePadding];
}
