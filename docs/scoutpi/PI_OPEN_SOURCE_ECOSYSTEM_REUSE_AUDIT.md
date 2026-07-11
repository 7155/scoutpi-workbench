# Pi Open-Source Ecosystem Reuse Audit

- Audit date: 2026-07-11
- Scope: capabilities that overlap with ScoutPi Earth Workspace and BrowserBridge
- Decision rule: reuse mature generic infrastructure; implement only ScoutPi-owned domain contracts, safety boundaries, artifacts, and visualization.

## Decision

ScoutPi is a Pi package, not a second agent framework. Its default public package loads one progressive-disclosure skill and three Earth tools:

```text
scoutpi-earth-investigation skill
earth_workspace
python_analysis
earth_story
```

BrowserBridge and local memory remain optional integrations. The package does not register generic web search, MCP, memory, context-compression, or subagent schemas by default.

## Reuse Matrix

| Need | Existing implementation to reuse | ScoutPi boundary |
| --- | --- | --- |
| Public web research | [`pi-web-agent`](https://github.com/demigodmode/pi-web-agent) or another installed research provider | BrowserBridge is used only for the user's existing Edge state, interaction, download, or visual evidence. |
| Third-party MCP servers | [`pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter) | Remote schemas stay behind one lazy proxy; ScoutPi does not implement another MCP client. |
| Generic isolated browser automation | [`pi-agent-browser`](https://github.com/victor-software-house/pi-agent-browser) with [`agent-browser`](https://github.com/vercel-labs/agent-browser) | ScoutPi BrowserBridge owns connected Edge sessions, extension permissions, downloads, evidence, and future page-owned geo semantics. |
| Durable Agent memory | Installed Pi memory package, such as the audited Hypa/Hermes/Remnic-style providers | Investigation recipes and run artifacts remain deterministic workspace state. Local ScoutPi memory is an explicit fallback only. |
| Shell/file context compression | Installed Hypa- or lean-ctx-style runtime | ScoutPi meters browser observations and Earth results at its domain boundary; it does not replace shell tools. |
| Subagents | Installed Pi subagent package | Earth analysis remains a typed deterministic DAG, not another general scheduler. |
| Earth Engine domain access | Existing domain services such as [geeViz MCP](https://geeviz.org/mcp) or [GeoAgent](https://github.com/opengeos/GeoAgent) when suitable | ScoutPi owns the investigation compiler, Agent-built adapter registry, verification lifecycle, evidence critic, artifacts, and Workbench. |

## What The Audit Found

Pi already has the extension primitives ScoutPi needs:

- package manifests can bundle extensions and skills;
- skills provide progressive disclosure rather than permanent prompt text;
- `getAllTools()`, `getActiveTools()`, and `setActiveTools()` support capability-aware tool profiles;
- the event bus supports extension-to-extension coordination.

The public package catalog and the targeted source audit showed mature generic solutions for research, MCP, browser automation, memory, output compression, and subagents. Reimplementing those layers would add tool schemas and maintenance work without creating a ScoutPi advantage.

Pi's official extension gallery is [`pi.dev/packages`](https://pi.dev/packages?type=extension). The native package manager owns install, update, filtering, enable/disable, and removal. ScoutPi therefore treats the market as a capability supply layer, not as code to vendor or a catalog to duplicate in the Workbench.

The current operator flow stays entirely inside official Pi commands:

```text
pi list
pi config
pi install npm:<reviewed-package>
pi update --extensions
pi remove npm:<package>
```

ScoutPi now persists the last Pi session scan under `.scoutpi/pi-ecosystem/profile.json`, exposes the sanitized profile at `GET /api/pi-ecosystem`, and renders it in Runtime Center -> Extensions. The view separates detected surfaces, source provenance, ScoutPi ownership boundaries, missing capability groups, and links to filtered official-catalog searches. It does not query the catalog in the background, execute package commands, auto-install a recommendation, or change Pi's active tools.

## 2026-07-11 Source Pass

The audit used read-only shallow clones of the following repositories. Their commit snapshots are recorded so architecture claims remain reproducible without vendoring third-party source into this repository.

| Project | Snapshot | Concrete mechanism studied | ScoutPi decision |
| --- | --- | --- | --- |
| [`ayagmar/pi-extmgr`](https://github.com/ayagmar/pi-extmgr) | `870af8a33fde` | Pi package catalog, cancellable npm discovery, persistent cache, staged configuration, RPC fallback | Use the official market/package manager. Capability Broker reports peers but never installs them. |
| [`Michaelliv/pi-goal`](https://github.com/Michaelliv/pi-goal) | `3f100be54344` | Persistent goal state, token/time accounting, continuation and budget terminal states | Reuse a goal package for conversational autonomy; ScoutPi Trigger remains deterministic workflow replay. |
| [`nicobailon/pi-intercom`](https://github.com/nicobailon/pi-intercom) | `e234a4446e2b` | Length-prefixed bounded frames and partial-read handling for local session messages | Reuse inter-session transport; ScoutPi emits typed evidence/context/trigger contracts. |
| [`nicobailon/pi-mcp-adapter`](https://github.com/nicobailon/pi-mcp-adapter) | `82724dccc13a` | One lazy proxy instead of hundreds of schemas; byte/line guards and artifact spill | Keep third-party MCP behind the peer proxy; ScoutPi's server stays four compact domain gateways. |
| [`nicobailon/pi-subagents`](https://github.com/nicobailon/pi-subagents) | `c940fe20e86d` | Atomic state, artifacts, tool/turn budgets, watchdog recovery and intercom result delivery | Reuse the package for independent review/research; do not turn the Earth DAG into a generic scheduler. |
| [`sysid/pi-extensions`](https://github.com/sysid/pi-extensions) | `ec825d6a3acf` | Event interception, realpath/symlink-aware path guards, default-deny writes and sandbox policy | Compose generic isolation with ScoutPi's domain approvals and artifact-root enforcement. |
| [`7155/wisdom-weasel-rag-ime`](https://github.com/7155/wisdom-weasel-rag-ime) | local active branch | Local SQLite/FTS/vector memory, anti-echo ranking, source lanes, governance and cross-application context | Added a typed query-only Context Provider; no second memory database or Pi memory schema. |

`packages/pi-ecosystem` is now a Capability Broker rather than a tool-name-only detector. It inspects both `getAllTools()` and `getCommands()`, so command-only market packages such as goal, intercom, sandbox, and package managers can be recognized without adding their schemas to the model. Source metadata is retained when Pi exposes it. The broker recommends a provider and fallback but never auto-installs or silently activates a package.

The targeted audit did not find a mature Pi-native package that combines all of the following:

```text
testable InvestigationSpec
-> versioned and live-probed Earth adapters
-> deterministic analysis DAG
-> supervised GEE execution/export
-> evidence critic
-> bounded computed artifacts
-> auditable EarthStory
-> investigation Workbench
```

That end-to-end contract remains ScoutPi's implementation boundary. This is a targeted audit, not a claim that no related geospatial package exists anywhere in the catalog.

## Earth Python Ecosystem Decision

ScoutPi should not recreate mature Python geospatial infrastructure. These projects are optional execution or review backends behind the same typed Pi surface:

| Project | Useful capability | Integration decision |
| --- | --- | --- |
| [geemap](https://github.com/gee-community/geemap) | Interactive Earth Engine review, maps, charts, and export helpers | Optional analyst Workbench backend; do not automate its widgets through BrowserBridge. |
| [geedim](https://github.com/leftfield-geospatial/geedim) | Tiled Earth Engine export to GeoTIFF, NumPy, and Xarray | Integrated as the bounded `export_local` backend. |
| [geetools](https://github.com/gee-community/geetools) | Reusable server-side preprocessing and Earth Engine object extensions | Installed in the pipeline profile; future operations must be exposed through reviewed typed adapters. |
| [eemont](https://github.com/davemlz/eemont) | Concise preprocessing and spectral-index chaining | Interface reference only in the first phase to avoid two overlapping execution dialects. |
| [leafmap](https://github.com/opengeos/leafmap) | Local raster/vector, STAC, PostGIS, cloud data, and interactive maps | Optional local-data review backend, separate from cloud computation. |
| [Xee](https://github.com/google/Xee) and [wxee](https://github.com/aazuspan/wxee) | Earth Engine to Xarray for climate and long time series | Optional climate backend selected by capability, not loaded into the default Pi schema. |

Projects such as [segment-geospatial](https://github.com/opengeos/segment-geospatial), [HYDRAFloods](https://github.com/Servir-Mekong/hydra-floods), continuous-change toolkits, Dynamic World, and OpenET are possible provider adapters or recipes. They are not branches in the core runtime. An algorithm becomes executable only through a reviewed backend module with a typed request, bounded result, artifact policy, dependency probe, and tests.

The architecture `Pi -> typed investigation -> supervised compute -> evidence Workbench` is this project's own direction. The projects above informed specific API and packaging tradeoffs; they are not presented as the source of the product concept.

## Runtime Routing

```text
Pi task
├─ source discovery ───────────────> installed web research provider
├─ third-party domain service ─────> lazy MCP proxy
├─ generic isolated browser test ──> agent-browser provider
├─ existing Edge/login/download ───> ScoutPi BrowserBridge
├─ cross-session recall ───────────> installed memory provider
└─ Earth investigation
   ├─ compile/run/export ──────────> earth_workspace
   ├─ local numeric validation ────> python_analysis
   └─ evidence-bound narrative ───> earth_story
```

The `scoutpi-earth-investigation` skill applies this routing at task time. `/earth-ecosystem` reports which peer capability groups Pi currently exposes without adding their schemas to ScoutPi.

## Enforced Boundaries

The repository enforces the decision in code and tests:

- `package.json#pi` bundles only the Earth extension and skill.
- No local memory extension is bundled in the public Pi manifest; memory remains a peer capability.
- The separate BrowserBridge package defaults to `browser_session`, `browser_observe`, and `browser_act`; legacy granular tools require `SCOUTPI_BROWSER_LEGACY_TOOLS=1` in that repository.
- `packages/pi-ecosystem` detects tool- and command-based peer capabilities, strips credentials and absolute path prefixes from source metadata, persists an integrity-checked operator profile, and reports routing, but never installs, loads, activates, or copies packages.
- The Workbench reads the saved profile through `GET /api/pi-ecosystem`; catalog links and package commands are fixed to official Pi values and tampered profile links are rejected before rendering.
- tests verify the public Earth package surface, task boundaries, and peer-capability routing without importing BrowserBridge source.

## Primary References

- [Pi extensions documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi package documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md)
- [Pi package catalog](https://pi.dev/packages)
- [Pi skills](https://github.com/badlogic/pi-skills)
- [pi-web-agent](https://github.com/demigodmode/pi-web-agent)
- [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter)
- [pi-agent-browser](https://github.com/victor-software-house/pi-agent-browser)
- [agent-browser](https://github.com/vercel-labs/agent-browser)
- [geeViz MCP](https://geeviz.org/mcp)
- [GeoAgent](https://github.com/opengeos/GeoAgent)
- [Microsoft Earth Copilot](https://github.com/microsoft/Earth-Copilot)
