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

## 2026-07-11 06:00 - Durable Agent checkpoint and bounded Pi evaluation

- Added an event-only Pi checkpoint extension with atomic revisions, SHA-256 integrity checks, allowlisted runtime references, one-time recovery injection, and compaction preservation rules.
- Added checkpoint API and Workbench telemetry visibility without adding a model-facing tool.
- Isolated every paid Pi RPC case in a fresh temporary Pi/Earth/runtime directory; added a deterministic export fixture, user-denial scoring, turn/tool/token/cost ceilings, live abort, and full-run budget.
- Fixed the GitHub Actions race where a retried in-process local export could still write while the test removed its directory; runtime now tracks and drains background export completions.
- Real provider evidence: `gpt-5.6` remains absent from the configured endpoint model list, while Pi RPC itself starts with `gpt-5.6`, `xhigh`, all four extensions, and no extension error. No key is persisted.
- Visual QA: desktop and 390x844 Telemetry dialog render with no overlap or console errors; checkpoints have a dedicated operator ledger.
- Commands: `git status -sb` showed 20 modified tracked paths plus the new checkpoint package/extension/tests; `git diff --stat` showed 410 insertions and 50 deletions before untracked files.
- Verification: `pnpm check` passes 36 tests, Python compile, Earth harness, and production web build; `pnpm audit --prod` reports no known vulnerabilities; `git diff --check` passes.

## 2026-07-10 23:42 - Agent Runtime P0 milestone

- Added the reviewed Backend Plugin SDK, mixed-text runtime telemetry, Agent lifecycle tracing, parameter-bound approval receipts, and successful-run Workflow Compiler.
- Migrated `scoutpi-earth` to the official Pi 0.80.2 extension contract with compact TypeBox schemas, cancellation, progress updates, and runtime-only dynamic tool profiles.
- Added an isolated real Pi RPC harness with ten natural-language cases. The extension process starts cleanly; the configured gateway currently lists 5.4/5.5 but not requested `gpt-5.6`, so live model evaluation is reported as unavailable rather than silently downgraded.
- Added Workbench Backend, Telemetry, Agent Run, Approval, Recipe, and Workflow views. Playwright desktop and 390 px mobile checks passed for the main map and both operational dialogs.
- Verification: `pnpm check` passes 32 tests, Python compile, Earth harness, and production web build; `pnpm harness:pi-rpc` reports `rpc_ready` with no extension errors.
- Git snapshot before milestone commit: branch `main`; runtime/UI/docs changes are intentionally scoped to this repository; generated `.scoutpi`, `exports`, build, and Playwright artifacts remain ignored.

## 2026-07-11 06:16 - Provenance-aware Context Bridge

- Added a zero-tool Context Bridge that accepts provider-neutral candidates, ranks them against the current task, enforces a mixed Chinese/English token budget, preserves source provenance, and treats recalled text as memory rather than policy.
- Added direct UI approval before runtime-derived procedures, failures, project state, or verified workflows enter a provider writeback outbox; no memory database is mutated silently.
- Attached the exact current Context Pack to privacy-preserving Agent traces and exposed packs/writebacks through the Workbench API and a dedicated Context view alongside durable checkpoints.
- Real Pi RPC smoke started `gpt-5.6` with `xhigh`, all five public extensions, and no extension errors. The configured provider still does not advertise `gpt-5.6`, so paid evaluation remains blocked rather than silently downgraded.
- Visual QA covered populated Context Pack/writeback states at desktop and 390x844 mobile widths with zero browser console errors.
- Git snapshot before commit: `main...origin/main`; 17 tracked files changed plus the new Context package, extension, tests, docs, and example envelope.
- Verification: `pnpm typecheck`, 42 tests, `pnpm web:build`, `git diff --check`, and `pnpm harness:pi-rpc` pass.

## 2026-07-11 06:32 - Operational Runtime Center UI

- Replaced the registry-first modal with a Runtime Center that leads with runtime posture, bounded tool surface, Context Pack budget, backend availability, operator attention, continuity, and the latest Agent run.
- Kept adapters, generated skills, backend probes, Context Packs, writeback review, checkpoints, approvals, Agent runs, operation tokens, and provider cost as focused operator views rather than decorative dashboard cards.
- Added a top-level runtime health control and a complete mobile overflow menu so refresh, recipe, and export actions remain reachable on narrow screens.
- Fixed a real 390 px overflow regression: the mobile page had a 407 px min-content width from the top action row; after the menu refactor, `scrollWidth === clientWidth` at 375 px CSS width.
- Visual QA: 1440x1000 overview/context, 390x844 overview/context, mobile action menu, Escape close, and zero console errors. No generated image was added because the live MapLibre/GEE layer is the product's meaningful visual asset.
- Verification: `pnpm check` passes 42 tests, Python compile, Earth harness, and production web build; `git diff --check` passes.

## 2026-07-11 07:03 - Browser Evidence Bridge and investigation graph

- Added the canonical `scoutpi.browser.evidence.v1` contract, BrowserBridge card adapter, copied screenshot/text artifacts, SHA-256 provenance, source-fingerprint deduplication, explicit claim relations, and persisted investigation graphs.
- Added a zero-tool Pi Evidence Bridge plus `evidence_import`, `evidence_bind`, `evidence_list`, and `evidence_graph` operations behind the existing `earth_workspace` gateway; the public model surface remains exactly three tools across six extensions.
- Connected browser sources, claims, hypotheses, completed live computations, and EarthStory findings without treating dry runs as computed evidence. Exact graphs can be attached to Agent run traces.
- Hardened import roots with real-path checks against symlink escape, made record creation exclusive and atomic, revalidated payload integrity on read, and fixed rebinding so the old checksum cannot contaminate the new checksum.
- Workbench Evidence now presents source/claim/run coverage and auditable per-hypothesis chains. Desktop and 390x844 mobile visual checks showed no overflow or console errors; live map state remains the primary visual asset.
- Real Pi RPC smoke initialized `gpt-5.6`, `xhigh`, all six extensions, and no extension errors. Provider model discovery still does not advertise 5.6, so paid evaluation remains blocked rather than silently downgraded.
- Git snapshot: `main...origin/main`; 24 tracked paths changed plus the evidence package, extension, component, docs, example, and tests. Generated `.scoutpi`, `exports`, and Playwright output remain ignored.
- Verification: `pnpm check` passes 47 tests, Python compile, Earth harness, and production web build; targeted evidence security tests and `git diff --check` pass.

## 2026-07-11 07:20 - Narrow MCP compatibility surface

- Added a local stdio MCP server on the stable official TypeScript SDK 1.x line. It exposes four high-level gateways for investigation, status, artifact, and evidence access without changing Pi's native three-tool surface.
- Deliberately omitted live runs, exports, adapter mutation, workflow publication, and approval issuance. State-changing work remains in Pi so lifecycle governance can obtain a real operator decision.
- Added job artifact and investigation Evidence Graph resources. Tool calls return compact summaries and resource links; text previews and full resource reads have explicit size limits and never expose absolute artifact paths.
- Added a real official-client stdio harness and in-memory protocol test covering schema discovery, invalid input, planning, dry run, artifact links, resource reads, Evidence Graph summaries, and the Workbench MCP profile endpoint.
- Runtime Center now distinguishes `3 Pi gateways` from `4 MCP gateways isolated`, and shows the MCP interface as an external compatibility layer rather than another Pi capability bundle.
- Visual QA: 1440x1000 and 390x844 Runtime Center screenshots show all seven runtime layers without horizontal overflow; browser console reports zero errors and warnings.
- Git snapshot: `main...origin/main`; 11 tracked paths plus the MCP package, harness, test, and documentation are pending this milestone commit. The official SDK adds the expected stable-v1 lockfile graph.
- Verification: `pnpm check` passes 48 tests, Earth and MCP harnesses, Python compile, and production build; `pnpm audit --prod` reports no known vulnerabilities; Evidence milestone CI is green.

## 2026-07-11 08:05 - Durable triggers, delegation and Automation UI

- Added a zero-tool Trigger extension and durable runtime for manual, interval, and named-event replay of reviewed dry-run workflows.
- Added service principals, HMAC-SHA256 delegation grants, complete trigger fingerprints, expiry/cooldown/run limits, grant revocation, and signature-free API summaries.
- Added durable idempotency, cross-process trigger leases, interval supervisor leases, event content collision checks, and replay-on-redelivery so a crash after receipt creation cannot lose an event.
- Browser Evidence imports can emit `browser.evidence.imported`; receipts retain only payload hash/byte count and the originally matched trigger IDs.
- Added the Runtime Center Automation view with delegation posture, operator review queue, run-budget progress, condition/identity state, direct authorization, and an idempotent execution ledger.
- Visual QA passed at 1440x1000 and 390x844 after fixing the mobile posture-row overlap; browser console reports zero errors and warnings.
- Pi package discovery research confirmed the official `pi.dev/packages` catalog and native `pi install/list/update/remove` flow. Future generic memory, MCP, subagent, web, and extension-management capability should be brokered from the market rather than reimplemented.
- The user's `wisdom-weasel-rag-ime` Core remains the preferred memory provider. Next implementation should add a typed provider contract, provenance-aware query adapter, health probe, and approved writeback delivery rather than installing a second memory surface.
- Verification: `pnpm check` passes 54 tests, Python compile, Earth and MCP harnesses, and production build. Real Pi RPC starts `gpt-5.6`, `xhigh`, all seven public extensions, and reports no extension errors.

## 2026-07-11 08:35 - Pi capability broker and input-method Core provider

- Audited Pi's official package catalog and read pinned source snapshots for package management, goals, inter-extension messaging, lazy MCP exposure, subagents, sandboxing, and access guards.
- Replaced tool-name-only ecosystem detection with a Capability Broker that also recognizes command-only extensions, preserves exposed source metadata, and keeps installation and activation under operator control.
- Added an opt-in, query-only Context Provider for the existing `wisdom-weasel-rag-ime` Core. It uses the Core's own `LocalSqliteCoreClient`, preserves memory IDs as provenance, disables raw-event candidates, and never writes the Core database.
- Added bounded process I/O, timeout/cancellation, item/text/output caps, secret-pattern rejection, provider health state, graceful degradation, and Context Pack/UI provider telemetry.
- Real local smoke reached the existing Core database and returned five bounded candidates without printing candidate text. Pi RPC initialized `gpt-5.6`, `xhigh`, all seven extensions, and no extension errors; no paid model turn containing private memory was sent.
- Commands: `git status --short --branch` confirmed only this milestone's tracked/new files; `git diff --stat` was reviewed before verification.
- Verification: `pnpm check` passes 58 tests, both harnesses, Python compile, and production build; `pnpm audit --prod` reports no known vulnerabilities.
