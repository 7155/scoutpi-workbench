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

### 2026-07-10 - Reliable Agent Runtime P0

- Backend execution now uses a reviewed provider contract; telemetry separates estimated runtime work from provider-reported model billing.
- High-risk Pi calls require a real, single-use user approval receipt bound to the exact call and parameters.
- Pi lifecycle events create privacy-preserving run traces without adding model-visible tools.
- Verified successful jobs become guarded workflow candidates; explicit promotion and replay enforce adapter fingerprints and cost assertions.
- The real Pi RPC runtime, 32 tests, full project check, and desktop/mobile Workbench QA pass. Live `gpt-5.6` evaluation remains externally blocked because the configured provider does not advertise that model.
- Next: durable Agent checkpoints, a narrow MCP compatibility server, and event-triggered runs while keeping the three-tool model surface unchanged.
