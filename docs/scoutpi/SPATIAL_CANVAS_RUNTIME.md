# Spatial Canvas Runtime

ScoutPi is not a human-first remote-sensing dashboard. Pi is the primary operator; the Workbench exposes the spatial state Pi is reading and changing.

```text
user request
  -> Pi chooses tools, datasets and reviewed adapters
  -> typed spatial runtime computes or retrieves bounded results
  -> shared region, layer and evidence contracts
  -> MapLibre 2D or CesiumJS 3D
  -> operator reviews state, evidence and execution
```

## Interface Boundary

The interface has three operational surfaces:

| Surface | Purpose |
| --- | --- |
| Pi tasks | Current and previous spatial tasks plus runtime/data-access health |
| Spatial canvas | The exact region and imagery state controlled by Pi, switchable between 2D and 3D |
| Spatial state | Layers, evidence, analysis graph, metrics and execution records |

The two side rails are secondary inspection surfaces and can be collapsed independently. The canvas resizes without recreating the task or requesting a new Earth Engine computation.

## One Contract, Two Renderers

Both renderers consume the same runtime values:

```text
RegionSpec
  bbox | GeoJSON Geometry | Feature | FeatureCollection

EarthVisualization
  planId + role + year + tileUrl + legend
```

MapLibre renders the conventional 2D view. CesiumJS is loaded only on the first 3D switch, then drapes the same short-lived Earth Engine XYZ tile URL over the globe and synchronizes the same investigation geometry and selected layer. Switching renderers does not download a GeoTIFF and does not add another Pi tool.

The shared geometry normalizer derives bounds for generic GeoJSON, including geometry collections. Cesium starts with a pitched camera around those bounds so the operator can distinguish the 3D state immediately.

## Deployment

Cesium's `Workers`, `ThirdParty`, `Assets`, and `Widgets` directories are served from `/cesium-static/` in development and copied into the production build. The initial application bundle does not execute the 3D runtime until requested.

The default 3D base layer uses OpenStreetMap and ellipsoid terrain, so this path requires no Cesium ion token. Terrain providers, 3D Tiles, point clouds, and model layers should later enter through reviewed typed layer contracts rather than arbitrary page JavaScript.

## Runtime Safety

- Pi still sees only the existing three Earth gateway tools.
- Renderer switching is browser-local presentation state.
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
