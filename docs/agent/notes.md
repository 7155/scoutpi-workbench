# Agent Notes

## 2026-07-10 - Pi-native Earth investigation runtime

- Clarified that urban development, water, flood, fire, and similar domains are replaceable examples, not separate products.
- Added a generic `InvestigationSpec -> DatasetPlan -> AnalysisDAG -> EarthJob -> EarthStory` pipeline owned by Pi.
- Registered only three Earth gateway tools: `earth_workspace`, `python_analysis`, and `earth_story`.
- Added reviewed execution adapters for Sentinel-2, Landsat L2, Dynamic World, VIIRS, ERA5-Land, JRC Surface Water, Sentinel-1, and MODIS NDVI.
- Added dry-run artifacts, GEE inline/Drive execution, task status, CSV/GeoTIFF export, recipes, evidence critic checks, local statistics, and the Workbench EarthStory panel.
- Installed the optional Earth environment. `earthengine-api`, geemap, pandas, and scipy import successfully; Google Earth Engine account authorization is still user-owned external state.
- Verification: Earth-focused TypeScript check, 14 tests, Python compile, and generic dry-run harness all pass.

## 2026-07-10 18:05 - Pi ecosystem reuse and Workbench QA

- Audited Pi's package/skill/tool-profile primitives and targeted open-source providers for research, MCP, browser automation, memory, context compression, subagents, and Earth Engine access.
- Added `packages/pi-ecosystem`, `/earth-ecosystem`, and a progressive-disclosure investigation skill. Generic peer capabilities are detected and routed, not copied.
- Public Pi package now loads only `earth_workspace`, `python_analysis`, and `earth_story`; local ScoutPi memory requires `SCOUTPI_LOCAL_MEMORY=1`.
- BrowserBridge defaults to three gateway tools and keeps granular compatibility behind `SCOUTPI_BROWSER_LEGACY_TOOLS=1`.
- Added the ecosystem reuse audit and updated the Earth/Browser runbooks.
- Verified `pnpm typecheck`, 21 tests, Earth dry-run harness, Workbench production build, and extension build.
- Playwright desktop/mobile/drawer checks passed with zero console errors. Active Workbench: `http://127.0.0.1:5175/`, API: `http://127.0.0.1:17420/`.

## 2026-07-10 22:05 - Dynamic runtime, verified adapters and durable export

- Reset the boundary: the core contains no forest/flood/agriculture/urban product branches. Pi builds declarative dataset adapters and reusable skills at task time; reviewed code owns execution backends.
- Added on-demand runtime contracts so Pi can request adapter/skill/spec/export templates without permanently expanding the three-tool schema.
- Added adapter revisions, SHA-256 fingerprints, enable/disable state, live Earth Engine probes, required-band/output-band checks, audit events, and live-run verification gates.
- Added direct GEE tile caching plus asynchronous geedim GeoTIFF jobs with scale/pixel review, manifests, SHA-256, cancellation, retry, and interrupted-process recovery.
- Added Workbench registry verification controls, backend capability view, template loading, a typed local-export dialog, job retry, and artifact downloads.
- Installed the `pipeline` profile on Python 3.13: Earth Engine 1.7.34, geedim 2.0.0, geetools 1.18.1, and Xee 0.1.1 are detected.
- Real smoke evidence: Dynamic World probe passed; live raster tiles returned HTTP 200; a 100 m local GeoTIFF completed with 2,388 bytes and was verified by Rasterio as GTiff, EPSG:4326, 12x13, float32.
- Removed the unbundled duplicate memory extension and unused memory/browser UI panels from the public project; memory remains a Pi ecosystem peer.
- Verification: `pnpm check` passes 18 tests, Python compile, Earth harness, and production web build; `pnpm audit --prod` reports no known vulnerabilities.
