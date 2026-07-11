# Chat Summary

The architecture is Pi-first. Pi performs planning and tool selection. Memory restores cross-application research state, BrowserBridge gathers claims and documentation, Earth Workspace compiles and supervises typed GEE work, Python validates exported numbers, and EarthStory binds claims, computed evidence, uncertainty, and provenance. Project names and demo topics remain input data and recipes rather than branches in the runtime.

### 2026-07-10 - Ecosystem-aware package boundary

- ScoutPi reuses installed Pi research, lazy MCP, generic browser, memory, context, and subagent providers instead of reimplementing them.
- The distributed package exposes one investigation skill and exactly three Earth tools. BrowserBridge and local memory are optional integrations.
- Workbench desktop/mobile visual QA, typecheck, 21 tests, Earth harness, web build, and extension build pass.
- The BrowserBridge public project is maintained separately at `/Volumes/undo 4t/git/scoutpi-browserbridge`; Earth/Workbench changes must not be pushed to the legacy `nc_query` remote.

### 2026-07-10 - Agent-built Earth runtime

- Dataset and workflow capability is now constructed through versioned declarative adapters and generated skills, not scenario-specific core code.
- Pi retrieves contracts only when needed, probes adapters against live Earth Engine data, and cannot silently execute an unverified fingerprint.
- Workbench can stream GEE tiles without downloading and can queue durable geedim GeoTIFF artifacts when local delivery is required.
- Local export state survives as a persisted request; cancellation, retry, and startup recovery prevent detached processes from staying permanently `running`.
- Foundational projects such as geemap, geedim, geetools, leafmap, Xee/wxee, segment-geospatial, and HYDRAFloods are documented as optional providers or references, not as the source of ScoutPi's product direction.

### 2026-07-11 - Durable Agent runtime checkpoint

- Pi sessions now preserve content-minimal, integrity-checked recovery state across restart and compaction without adding another model-visible tool.
- Interrupted state-changing calls are never assumed complete; Pi receives one bounded instruction to inspect persisted job/workflow state before retrying.
- The real Pi RPC harness now isolates cases and enforces explicit tool, turn, token, output, cost, and full-run budgets.
- Workbench shows checkpoint state alongside Agent runs, approvals, and telemetry; desktop/mobile visual checks and the 36-test full check pass.
- Next: Context Pack/provenance/approved writeback, then Browser Evidence Contract and evidence graph.

### 2026-07-10 - Reliable Agent Runtime P0

- Backend execution now uses a reviewed provider contract; telemetry separates estimated runtime work from provider-reported model billing.
- High-risk Pi calls require a real, single-use user approval receipt bound to the exact call and parameters.
- Pi lifecycle events create privacy-preserving run traces without adding model-visible tools.
- Verified successful jobs become guarded workflow candidates; explicit promotion and replay enforce adapter fingerprints and cost assertions.
- The real Pi RPC runtime, 32 tests, full project check, and desktop/mobile Workbench QA pass. Live `gpt-5.6` evaluation remains externally blocked because the configured provider does not advertise that model.
- Next: durable Agent checkpoints, a narrow MCP compatibility server, and event-triggered runs while keeping the three-tool model surface unchanged.

### 2026-07-11 - Context Bridge and runtime continuity

- Provider-neutral memories now become provenance-bound, task-ranked Context Packs under an explicit mixed-text token budget; recalled content is lower-trust context, never policy.
- Runtime learning is staged as a structured writeback outbox and requires direct user approval before another memory provider can consume it.
- Observability binds the exact Context Pack used by a Pi run, while the Workbench Context view shows packs, durable checkpoints, and writeback review state.
- The real Pi RPC process initializes `gpt-5.6`, `xhigh`, and all five public extensions without extension errors; the configured endpoint still does not list that model for paid evaluation.
- Next: mature the Runtime Center UI, then add Browser Evidence Contract, evidence graph, and investigation trace without expanding the three-tool model surface.

### 2026-07-11 - Runtime Center product pass

- Workbench now opens with a compact runtime health signal and exposes an operator-first Runtime Center rather than a registry utility.
- Overview separates runtime posture from human attention; detailed views retain adapters, skills, backends, context, continuity, governance, Agent traces, and cost telemetry.
- Mobile keeps all workspace commands through an overflow menu, has no horizontal layout drift at 390 px, and preserves the same Runtime Center information hierarchy.
- The UI deliberately uses the live Earth map instead of decorative generated imagery; visual emphasis stays on inspectable state and evidence.
- Next: Browser Evidence Contract, trace import, and an investigation evidence graph integrated into this same operator surface.

### 2026-07-11 - Browser Evidence Bridge

- BrowserBridge output now enters the runtime through a canonical, provenance-bound contract without adding a model-facing tool.
- Imports enforce real-path roots, size and secret checks, copied artifact hashes, exclusive record creation, payload integrity, deduplication, and explicit claim/hypothesis relations.
- The persisted Evidence Graph distinguishes browser documentation, completed live computation, and EarthStory findings; dry runs are not promoted to computed evidence.
- Workbench exposes compact coverage and per-hypothesis evidence chains on desktop and mobile, while observability can attach the exact graph to the current Agent run.
- All 47 tests and the full project check pass. Next: add a narrow MCP compatibility server and durable event triggers while preserving the three-tool Pi surface.

### 2026-07-11 - MCP compatibility

- External MCP hosts can now access four compact, local stdio gateways and two resource templates backed by the same Earth Workspace.
- Pi still exposes exactly three native tools; MCP live execution and administrative mutations are intentionally absent so governance cannot be bypassed.
- Artifact and Evidence Graph payloads use resource links and bounded reads instead of entering every tool result.
- The official MCP client passes both in-memory and real stdio harnesses. Runtime Center desktop/mobile QA clearly separates the Pi and MCP surfaces.
- Next: durable event triggers with idempotency, execution leases, identity/delegation, and an operator-facing trigger ledger.

### 2026-07-11 - Durable automation and ecosystem direction

- Reviewed dry-run workflows can now be delegated to identity-bound manual, interval, or named-event triggers without adding a fourth Pi tool.
- Signed grants, durable leases, immutable event receipts, content-collision detection, restart-safe idempotency, and bounded run/cooldown/expiry limits keep unattended replay narrow and auditable.
- Runtime Center now has a polished Automation view and operator queue; desktop/mobile visual QA and all 54 tests pass.
- Pi's official package catalog will be treated as the generic capability supply layer. ScoutPi should broker compatible research, MCP, subagent, security, and context packages instead of cloning them.
- Cross-application memory should come from the existing `wisdom-weasel-rag-ime` Core through a typed Context Provider and reviewed writeback protocol, while ScoutPi owns task ranking, token budgets, provenance, and runtime attachment.
- Next: commit this Trigger milestone, then upgrade the capability broker and implement the IME Core provider integration.

### 2026-07-11 - Pi market broker and Wisdom Weasel Context Provider

- ScoutPi now treats Pi's official extension market as the reusable capability supply layer and detects both tool-based and command-only packages without auto-installing or silently activating them.
- The existing `wisdom-weasel-rag-ime` Core is now the preferred opt-in memory source through a typed, query-only provider; ScoutPi still owns task ranking, token budgets, provenance, Context Pack attachment, and provider health.
- The provider fails closed, rejects sensitive-looking material, caps process I/O and latency, and never enables raw-event retrieval or mutates the Core SQLite database.
- Runtime Center shows provider readiness, latency, and selected candidate count. All 58 tests, Earth/MCP harnesses, Python compile, production build, and production dependency audit pass.
- Next: deliver user-approved writebacks through a reviewed staging/import protocol rather than writing the Core database directly, then optimize cold-start latency only if measured runtime data justifies it.

### 2026-07-11 - Approved Wisdom Weasel writeback loop

- Wisdom Weasel remains query-only by default. Enabling writeback adds capability but still requires the current user to approve the exact reviewed payload in Pi.
- Approval now creates a canonical payload hash, approval ID, durable delivery record, cross-process lease, and content-minimal provider receipt.
- The provider imports through the Core's privacy-aware `InputMethodAdapter`; ScoutPi does not issue SQL. Deterministic Core event tags make process retries deduplicate already committed items.
- Runtime Center distinguishes pending review, approved outbox, failed/staged delivery, and delivered memory. Desktop/mobile QA and all 60 tests pass.
- Next: measure Context Provider cold-start cost across repeated turns and add a bounded persistent worker only if it materially reduces latency without expanding the privacy boundary.

### 2026-07-11 - Warm Context Provider runtime

- A single bounded Python worker now serves serialized query/writeback requests during the Pi session and closes on idle or session shutdown; one-shot mode remains available.
- Timeout and cancellation kill the worker, and the next request starts cleanly. The worker opens no network listener and preserves the existing size, secret, provenance, and approval checks.
- Context telemetry distinguishes total latency, Core latency, process mode, and warm reuse. Runtime Center displays warm/cold state without adding model-visible tools.
- The real content-free benchmark measured 144.5 ms one-shot median and 37 ms persistent warm median, a 74.4% local reduction. All 61 tests and full runtime checks pass.
- Next: use the Capability Broker to expose operator-controlled installation/readiness guidance for compatible market extensions, without implementing another package manager or auto-install path.

### 2026-07-11 - Operator-facing Pi extension ecosystem

- Pi session start and the explicit `/earth-ecosystem` rescan now write a sanitized capability profile for installed tools, slash commands, source provenance, routing boundaries, and 11 reusable capability groups.
- Runtime Center adds an Extensions view with detected readiness, missing capabilities, official catalog links, and native `pi list/config/install/update/remove` guidance.
- ScoutPi remains read-only toward the package market: it neither fetches the catalog in the background nor installs, activates, updates, or removes packages.
- Stored profile links, command hints, metadata shape, credentials, and local path exposure are validated before the Workbench can render them.
- Desktop and 390x844 mobile QA, all 62 tests, Earth/MCP harnesses, production build, dependency audit, and a real content-free Pi RPC smoke pass. Next: commit, push, and watch CI.

### 2026-07-11 - Pi gallery packaging gate

- The public repository now has npm/Pi-gallery metadata, a fixed public preview image, explicit public publish configuration, and correct Pi host peer dependencies.
- The tarball is restricted to seven extensions, one skill, deterministic runtime modules, bounded Python workers, and public policy/docs; frontend source, tests, harnesses, devlogs, state, exports, lockfiles, and credentials are excluded.
- `pnpm package:verify` packs and extracts the real archive, checks metadata/content/size/privacy, and boots every extension plus the skill through offline Pi RPC without a model request.
- The verified archive is 138,909 packed bytes, 501,989 unpacked bytes, and 50 entries. Publication remains an explicit operator release action rather than an automated side effect.
- All 62 tests, Earth/MCP harnesses, Python compile, extracted-package RPC verification, production build, dependency audit, and diff checks pass. Next: commit, push, and confirm CI.

### 2026-07-11 - Evidence review gate

- EarthStory now passes a deterministic review before persistence; the gate adds no Pi tool and makes no second model request.
- The reviewer binds metrics to the current plan and completed live jobs, rejects dry-run/computed confusion and unsupported statuses, validates browser-evidence bindings, and surfaces time/place drift, missing units, and missing counterevidence.
- Proxy semantics are declared by reviewed adapters through bounded literal `claimRule` metadata rather than hard-coded project branches.
- Review reports are content-minimal artifacts available through the API and the Workbench Evidence view. A blocked candidate does not overwrite the last accepted story.
- Desktop/mobile QA, all 65 tests, full package verification, production build/audit, and a real `gpt-5.6` Pi RPC startup pass. Next: commit and push this reviewer milestone, then continue with the real Pi Agent evaluation layer.

### 2026-07-11 - Bilingual Workbench

- Workbench now switches immediately between English and Simplified Chinese, persists the browser-local choice, and follows browser language on first use.
- Desktop uses a stable segmented control; mobile exposes the same command through the existing overflow menu to avoid crowding map/run controls.
- Core navigation, dialogs, maps, evidence, charts, Runtime Center, status/role labels, and automation controls are localized. User-authored and evidence-bearing domain content remains verbatim by design.
- Desktop/mobile screenshots, locale persistence, document metadata, no-overflow checks, zero-console-error checks, all 66 tests, full build, and extracted Pi package verification pass.
- Next: commit and push this UI milestone, then return to privacy-safe real Pi Agent evaluation artifacts and outcome scoring.

### 2026-07-11 - Pi-operated spatial canvas

- The Workbench now presents Pi tasks on the left, the shared spatial canvas in the center, and Pi spatial/evidence/execution state on the right; both desktop rails can be collapsed for a full-canvas view.
- The same typed region and visualization contracts drive MapLibre 2D and a lazy CesiumJS 3D renderer. Renderer selection is browser-local, persists across reloads, and adds no model-facing tool.
- Generic bbox, GeoJSON geometry, Feature and FeatureCollection inputs share one bounds/feature normalizer. Live GEE imagery is streamed to both renderers without a GeoTIFF download.
- Desktop/mobile screenshots, canvas frame/state checks, pixel analysis, all 68 tests, full build/package verification and dependency audit pass.
- Next: restore the stashed privacy-safe Pi evaluation scorer work and continue real Pi Agent outcome evaluation.

### 2026-07-11 - Pi spatial focus contract

- Corrected the remaining UI ambiguity: Pi now owns a durable, revisioned plan/role/year/renderer focus through `earth_workspace(view_set|view_get)`, while the Workbench follows it as a read-oriented runtime console.
- Left is the Pi task stream, center is the shared spatial canvas, and right is the structured context Pi can reason over. Human map changes enter local inspection and never overwrite Pi state.
- Normal product builds hide direct create/run/export controls; a development-only environment flag restores them in a secondary menu.
- Desktop/mobile visual QA, dynamic follow/detach behavior, 73 tests, package extraction, full build, audit, and runtime harnesses pass.
- Next: finish the privacy-safe real Pi RPC evaluation harness, including explicit skill loading and outcome-based scoring, without weakening the new Pi-first product boundary.

### 2026-07-11 - Pi-first Workbench comprehension

- Corrected the visible product model again: users assign work in Pi; the Workbench does not decide the investigation.
- Left now shows read-only tasks from Pi with question-first hierarchy and a current-focus marker; center shows the Pi-controlled spatial focus; right shows current spatial state, tested hypothesis and Pi-selected data before any technical runtime IDs.
- Technical operation/revision/plan/geometry fields moved behind disclosure, while local map inspection still detaches without mutating Pi state.
- Bilingual desktop/mobile QA, nonblank Cesium checks, 73 tests, TypeScript and the production frontend build pass.
- Next: commit this UI milestone without staging the separate Pi RPC scorer work, then continue the privacy-safe real Agent evaluation layer.

### 2026-07-11 - Real Pi RPC outcome evaluator

- Rebuilt the paid Pi harness around a fresh read-only Pi runtime, an explicitly loaded investigation Skill and the existing three Earth gateway tools.
- Scoring now requires Skill-first use, successful operations, policy compliance and real persisted workspace outcomes; reports use schema v2 and content-minimal traces with no raw prompts, provider URLs, credentials or tool payloads.
- Fixed provider-specific tool-call IDs so spatial-focus persistence hashes unsupported IDs instead of failing an otherwise successful plan.
- The requested `gpt-5.6-sol` route boots correctly but is currently rejected by the configured provider at the live Responses request. Controlled `gpt-5.5` plan-only and dry-run cases passed without changing the default or silently downgrading.
- Full verification passes 76 tests, Python compile, Earth/MCP harnesses, extracted-package Pi boot, production build, audit and diff checks. Failed pre-score usage now counts toward the cumulative run budget.
- Next: scoped commit/push and CI confirmation.
