# Spatial Canvas Runtime

ScoutPi is not a human-first remote-sensing dashboard. Pi is the primary operator; the Workbench exposes the spatial state Pi is reading and changing.

```text
user request
  -> Pi chooses tools, datasets and reviewed adapters
  -> typed spatial runtime computes or retrieves bounded results
  -> durable Pi spatial focus state
  -> shared region, layer and evidence contracts
  -> MapLibre 2D or CesiumJS 3D
  -> operator reviews state, evidence and execution
```

## Interface Boundary

The interface has three operational surfaces:

| Surface | Purpose |
| --- | --- |
| Left rail: From Pi | Read-only current and previous tasks issued through Pi; the question is primary and the current Pi focus is marked |
| Center: Pi spatial focus | The exact region, observable, year, imagery, and renderer currently controlled by Pi |
| Right rail: Pi understanding | The task, current spatial state, tested hypothesis, selected data, evidence, workflow, and run history available to Pi |

The two side rails are read-oriented projections of Pi runtime state and can be collapsed independently. They are not separate GIS toolboxes and they do not decide what analysis runs. That decision starts in the Pi session. The canvas resizes without recreating the task or requesting a new Earth Engine computation.

## Pi Control Contract

Pi controls the Workbench through the existing `earth_workspace` gateway rather than browser clicks or another model-facing tool:

```text
earth_workspace(view_set)
  planId + role + year + mode(2d|3d)
  -> validate against the persisted InvestigationPlan
  -> write scoutpi.spatial-view.v1 atomically
  -> Workbench observes the revision
  -> select task/layer/year and switch renderer
```

`view_get` returns the current compact focus. `plan`, `preview`, `visualize`, `run`, `status`, export, evidence review, and workflow replay advance the same state automatically. The state contains only IDs, role, year, phase, renderer, operation, and a tool-call ID; it never stores prompts, model text, raster pixels, or credentials.

The Workbench polls this tiny local state independently from long Earth Engine jobs. **Follow Pi** is enabled by default. Selecting another task, role, year, or renderer switches to local inspection without changing Pi's durable focus; selecting **Follow Pi** reapplies the latest revision.

Normal builds do not display direct plan/run/export controls. `VITE_SCOUTPI_MANUAL_CONTROLS=1` enables a secondary local-test menu for development only. Production authorization still belongs to Pi lifecycle governance and its parameter-bound approval receipts.

## One Contract, Two Renderers

Both renderers consume the same runtime values:

```text
RegionSpec
  bbox | GeoJSON Geometry | Feature | FeatureCollection

EarthVisualization
  planId + role + year + tileUrl + legend
```

MapLibre renders the conventional 2D view. CesiumJS is loaded only on the first 3D switch, then drapes the same short-lived Earth Engine XYZ tile URL over the globe and synchronizes the same investigation geometry and selected layer. Switching renderers does not download a GeoTIFF and does not add another Pi tool.

When Pi is being followed, the Workbench requests a live tile only after Pi successfully calls `visualize`. A mere task or view change does not silently start Earth Engine work. In local inspection mode, the operator may preview another reviewed layer without mutating Pi's focus.

The shared geometry normalizer derives bounds for generic GeoJSON, including geometry collections. Cesium starts with a pitched camera around those bounds so the operator can distinguish the 3D state immediately.

## Deployment

Cesium's `Workers`, `ThirdParty`, `Assets`, and `Widgets` directories are served from `/cesium-static/` in development and copied into the production build. The initial application bundle does not execute the 3D runtime until requested.

The default 3D base layer uses OpenStreetMap and loads ArcGIS WorldElevation3D as a real elevation terrain provider without a Cesium ion token. `VITE_CESIUM_TERRAIN_URL` may point to a reviewed Cesium terrain service. A failed terrain request degrades explicitly to the ellipsoid provider; the canvas exposes `data-terrain-state` and `data-terrain-provider`, and the operator sees the fallback rather than a false “3D terrain ready” state. 3D Tiles, point clouds, and model layers must still enter through reviewed typed layer contracts rather than arbitrary page JavaScript.

For non-commercial development, a local `apps/web/.env.local` may set `VITE_CESIUM_ION_TOKEN` and `VITE_CESIUM_ION_BUILDINGS=osm`. The renderer then prefers Cesium World Terrain and adds Cesium OSM Buildings; failures remain isolated and fall back to ArcGIS terrain without breaking the GEE analysis layer. Tokens are browser-visible by design, so use an `assets:read`-only token restricted to the deployment origins, never commit it, and rotate any token exposed in chat or screenshots. See `apps/web/.env.example`.

## Runtime Safety

- Pi still sees only the existing three Earth gateway tools.
- Pi renderer focus is durable runtime state; local inspection remains browser-only and cannot overwrite it.
- Earth Engine tile URLs remain short-lived visualization artifacts.
- Full GeoTIFF export remains a separate reviewed operation.
- No arbitrary JavaScript or generated Cesium expression is executed.
- Attribution remains visible in both renderers.

## Verification

The implementation is covered by deterministic mode/GeoJSON tests and real-browser checks at desktop and mobile sizes. Browser verification confirms a non-zero Cesium canvas, at least two rendered frames, one synchronized region source, the live analysis imagery layer, no horizontal overflow, and zero console errors. A cropped rendered-frame pixel scan is also required to reject a blank WebGL canvas.

Primary references:

- [CesiumJS Quickstart](https://cesium.com/learn/cesiumjs-learn/cesiumjs-quickstart/)
- [Configuring Vite for CesiumJS](https://cesium.com/blog/2024/02/13/configuring-vite-or-webpack-for-cesiumjs/)
- [Cesium Viewer reference](https://cesium.com/learn/cesiumjs/ref-doc/Viewer.html)
