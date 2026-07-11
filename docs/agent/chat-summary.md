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
