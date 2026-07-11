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

## 2026-07-11 09:02 - Approved input-method Core writeback

- Added a second opt-in gate for Wisdom Weasel writeback; query remains read-only by default and `SCOUTPI_IME_CONTEXT_WRITEBACK=1` does not bypass direct Pi UI approval.
- Bound approval to a canonical payload hash and user-issued approval ID, then staged a durable provider delivery before any Core mutation.
- Delivered through the Core's own privacy-aware `InputMethodAdapter` rather than SQL. Deterministic event tags, cross-process leases, and content-minimal receipts support safe retry and partial-crash recovery.
- Added runtime validation for provider receipts, payload tamper rejection, failed/staged/delivered states, API enrichment, and Runtime Center operator visibility.
- Real Pi RPC smoke started `gpt-5.6`, `xhigh`, all seven extensions, and no extension errors with the real Core configured; no model turn and no personal-memory writeback were performed.
- Visual QA: 1440x1000 and 390x844 Context views show provider health and a delivered writeback with no horizontal overflow, console errors, or warnings.
- Git snapshot before commit: `main...origin/main`; 14 scoped paths, 553 insertions and 37 deletions. Generated Context state, Pi reports, builds, and Playwright screenshots remain ignored.
- Verification: `pnpm check` passes 60 tests, Python compile, Earth/MCP harnesses, and production build; targeted Context tests cover direct approval, integrity, receipt validation, cross-process serialization, and idempotent retry.

## 2026-07-11 09:25 - Bounded persistent Context worker

- Replaced one-Python-process-per-turn with a session-scoped, serialized JSONL worker while retaining one-shot fallback through `SCOUTPI_IME_CONTEXT_PERSISTENT=0`.
- Kept the privacy boundary unchanged: private stdin/stdout only, no network listener, 256 KB request and 2 MB response caps, five-minute idle shutdown, explicit Pi session cleanup, and worker restart after timeout or cancellation.
- Split end-to-end provider latency from Core source latency and surfaced warm/cold state in Context Pack telemetry and Runtime Center.
- Added a content-free benchmark harness that stores only path/query hashes, counts, and timings. Real local result: one-shot median 144.5 ms versus persistent warm median 37 ms, a 74.4% reduction across four runs per mode.
- Visual QA compares a 3 ms warm UI sample with the earlier 515 ms cold sample; 1440x1000 and 390x844 layouts remain readable, with no horizontal overflow, console errors, or warnings.
- Real Pi RPC smoke starts `gpt-5.6`, `xhigh`, all seven extensions, and no extension errors with the real Core configured. No paid model turn or private candidate content was emitted.
- Git snapshot before commit: 13 scoped tracked paths plus the new Context benchmark harness; generated benchmark reports and screenshots remain ignored.
- Verification: `pnpm check` passes 61 tests, Python compile, Earth/MCP harnesses, and production build; `pnpm harness:context-provider` passes; `pnpm audit --prod` reports no known vulnerabilities.

## 2026-07-11 09:46 - Pi extension market capability profile

- Problem: Pi has an official extension market, but ScoutPi only printed ephemeral capability detection inside Pi and gave Workbench operators no installed/missing readiness view.
- Decision: keep Pi's package manager authoritative; persist a read-only capability scan and expose guidance, never implement auto-install or another market client.
- Changes: added the atomic `PiEcosystemStore`, `GET /api/pi-ecosystem`, session-start persistence, an explicit `/earth-ecosystem` rescan, fixed official catalog links/commands, strict stored-profile validation, and a responsive Runtime Center Extensions ledger.
- Security: source metadata removes credentials, secret-like query material, control characters, and absolute path prefixes; tampered catalog links fail closed before UI rendering.
- UI finding: adding the eighth Runtime Center tab initially left a seven-column desktop grid. Updated it to eight columns and verified the full tab bar.
- Visual QA: 1440x1000 and 390x844 screenshots render the populated Extensions view; mobile reports `documentScroll=390`, `dialogScroll=dialogClient=368`, with zero console errors and warnings.
- Commands: `git status -sb` showed 12 scoped tracked paths; `git diff --stat` showed 277 insertions and 32 deletions before this devlog entry.
- Verification: `pnpm check` passes all 62 tests, Python compile, Earth/MCP harnesses, and the production build; `pnpm audit --prod` and `git diff --check` pass. A real content-free Pi RPC smoke initializes `gpt-5.6`, `xhigh`, all seven extensions, and no extension errors while recording the actual 10-tool/15-command capability scan.

## 2026-07-11 10:06 - Publishable Pi package boundary

- Problem: the GitHub package had the `pi-package` keyword but remained `private: true`, had no gallery image or file allowlist, treated TypeBox as a bundled dependency, and `npm pack` shipped 124 entries / 2.19 MB including tests, Workbench source, devlogs, lockfiles and local-development material.
- Decision: npm distributes the compact Pi runtime; the GitHub checkout remains the source for the full Vue Workbench. Registry publication itself stays explicit and is not performed by tests or the application.
- Changes: removed the private flag, added public publish/gallery metadata, moved Pi host libraries to peers, restricted package files, added `prepublishOnly`, and documented the release/security workflow.
- Verifier: `scripts/verifyPiPackage.mjs` creates and extracts the actual tarball, checks required/forbidden files, metadata, path/credential patterns and size, then starts seven extensions plus the investigation skill in an isolated offline Pi RPC process.
- Result: 50 entries, 138,909 packed bytes, 501,989 unpacked bytes, 9 registered commands, 7 loaded extensions, and the skill discovered; no model or network request occurs.
- Commands: `npm view scoutpi-workbench` currently returns 404, proving this work prepares publication but does not falsely claim the package is already in the official catalog. `pnpm package:verify`, all 62 tests, Earth/MCP harnesses, Python compile, production build, `pnpm audit --prod`, and `git diff --check` pass.
- Git snapshot: seven tracked files plus the new release guide and verifier are scoped to this milestone before final verification.

## 2026-07-11 10:52 - Deterministic Evidence Reviewer

- Problem: EarthStory validated shape and evidence URLs, but could still phrase a dry run as computed evidence, cite a missing/wrong job, overstate a proxy, omit a hypothesis finding, or mark a conclusion supported without a matching evidence relation.
- Decision: add a deterministic runtime gate rather than another model-facing tool or a scenario-specific reviewer. Adapter-specific interpretation boundaries remain declarative `claimRule` metadata.
- Changes: added plan/job/source provenance checks, finding support checks, dry-run blocking, metric-unit and counterevidence warnings, claim binding/time/place drift checks, content-minimal persisted reports, an API endpoint, compact Pi output, and a Workbench review card above the Evidence Graph.
- Safety: blocked candidates persist their review but never replace the last accepted EarthStory. Claim rules accept bounded literal terms only and cannot execute arbitrary code or regular expressions.
- Visual QA: 1440x1000 and 390x844 Evidence views show the review status without horizontal overflow; console reports zero errors and warnings.
- Verification: all 65 tests, TypeScript, Python compile, Earth/MCP harnesses, package extraction/RPC boot, and production build pass. The package remains 7 extensions/1 skill and is now 51 entries, 143,405 packed bytes, and 518,945 unpacked bytes. Production audit is clean; real Pi RPC initializes `gpt-5.6`, `xhigh`, all extensions, and no extension errors.

## 2026-07-11 11:20 - English and Chinese Workbench

- Added a dependency-free reactive locale store with browser-language detection, explicit `EN / 中` desktop control, mobile overflow action, local persistence, and synchronized document language/title.
- Localized product-owned navigation, maps, evidence review, charts, plan/run controls, creation/export/reuse dialogs, Runtime Center, extension/context/telemetry views, and durable automation controls.
- Kept investigation questions, claims, evidence excerpts, dataset titles, identifiers, and provider errors verbatim so localization cannot mutate provenance or scientific content.
- Known runtime states and observable roles use bounded bilingual label maps; unknown values remain visible through a readable fallback.
- Visual QA: English and Chinese switch immediately on desktop and mobile, the mobile language action remains available without crowding primary controls, 1440x1000 and 390x844 have no horizontal overflow, and a fresh browser session reports zero console errors/warnings.
- Verification: all 66 tests, TypeScript, Python compile, Earth/MCP harnesses, extracted Pi package boot, and production Workbench build pass. Package size is 51 entries, 143,529 packed bytes, and 519,388 unpacked bytes.

## 2026-07-11 11:49 - Pi spatial canvas and Cesium switching

- Corrected the product boundary: Pi is the primary operator; the Workbench is a runtime console for observing tasks, spatial state, evidence and execution rather than a scenario-specific manual dashboard.
- Added a persistent MapLibre 2D / lazy CesiumJS 3D switch over the same generic bbox/GeoJSON region, selected layer, GEE tile URL, legend and year. No new Pi tool or download path was introduced.
- Added self-hosted Cesium workers/assets for Vite, OSM plus ellipsoid terrain without an ion token, pitched region framing, renderer resize observation, visible attribution and a bounded 3D failure state.
- Renamed the interface around Pi tasks and Pi spatial state, made both desktop rails independently collapsible, and kept local task creation as a secondary testing action.
- Added bilingual labels, deterministic geometry/mode tests, a public architecture document, Cesium reference and a new README screenshot.
- Visual QA: desktop and 390x844 Playwright runs have zero console errors/warnings and no horizontal overflow. Cesium reports two frames, one region feature and one live analysis layer; collapsed rails expand canvas to 1439x872.
- Pixel scan over the rendered 3D canvas: YMIN 28, YAVG 182.274, YMAX 235 and SATAVG 15.7683, rejecting a blank frame.
- Verification: `pnpm check` passes 68 tests, TypeScript, Python compile, Earth/MCP harnesses, extracted package boot and production build. Package is 51 entries, 143,845 packed bytes and 520,148 unpacked bytes. `pnpm audit --prod`, built Cesium asset checks and `git diff --check` pass.

## 2026-07-11 12:47 - Durable Pi spatial focus and console hierarchy

- Problem: although the rails were renamed around Pi, the Workbench still read like a human-operated GIS dashboard and the direct run/export controls obscured that Pi is the controller.
- Decision: make Pi control a persisted runtime contract. The Workbench follows that state by default and treats human map changes as temporary local inspection rather than runtime mutation.
- Added atomic, revisioned `scoutpi.spatial-view.v1` state plus `view_get` / `view_set` inside the existing `earth_workspace` gateway. Plan, preview, visualization, run/status, exports, evidence review, story completion, and workflow replay update the same state without adding a fourth tool.
- Reframed the visible hierarchy as Pi task stream / shared spatial canvas / Pi context. The right rail now shows the exact structured region, observable, year, datasets and current operation instead of a generic metrics dashboard.
- Direct create/run/export commands are absent by default and available only through the secondary local-test menu when `VITE_SCOUTPI_MANUAL_CONTROLS=1`. Governance remains authoritative for real Pi actions.
- Follow mode dynamically switched a live browser from a Yangtze Delta 2D `built_surface` focus to a Shanghai 3D `land_cover` visualization after a state revision. Manual 2D selection detached to local inspection; Follow Pi restored the durable 3D focus.
- Visual QA: 1440x1000 and 390x844 have no horizontal overflow or console errors. Cesium reports ready=true, two frames, one region feature, one live analysis layer and an 869x872 canvas.
- Verification: `pnpm check` passes all 73 tests, Python compile, Earth/MCP harnesses, extracted Pi package boot, and production build. Package is 51 entries, 146,815 packed bytes and 533,936 unpacked bytes; production audit and diff checks pass.

## 2026-07-11 13:21 - Pi-first Workbench comprehension pass

- Problem: the two rails still looked like an independent GIS dashboard, so it was not immediately clear that the user gives work to Pi and that Pi chooses the spatial task, data, focus and execution.
- Decision: keep the Workbench read-oriented. Reframe the left rail as task history **from Pi**, the center as the **Pi spatial focus**, and the right rail as Pi's current structured spatial understanding. Local 2D/3D inspection remains non-authoritative.
- Changes: promoted task questions above regions in history, marked the durable Pi focus, replaced technical context blocks with current focus/state/tested-hypothesis/selected-data sections, moved operation/revision/plan/geometry into collapsed runtime details, and aligned English/Chinese labels and public docs.
- Visual QA: 1440x1000 and 390x844 render without horizontal overflow; 3D reports ready=true, two frames, one region feature and one analysis layer. The desktop canvas is 819x872 and its cropped screenshot has YAVG=189.157 and SATAVG=12.6384, rejecting a blank frame. Browser console reports zero errors and warnings.
- Commands: `pnpm web:build`; `pnpm typecheck && pnpm test`; Playwright desktop/mobile screenshots and state checks; `ffmpeg` cropped-frame signal statistics.
- Git snapshot: the UI/docs milestone is scoped separately from the existing unstaged Pi RPC harness work in `harness/pi/` and `tests/piHarness.test.ts`.
