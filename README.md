# ScoutPi Workbench

**A Pi-native runtime for building and running evidence-backed Earth investigations.**

[![CI](https://github.com/7155/scoutpi-workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/7155/scoutpi-workbench/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)](#quick-start)
[![Pi native](https://img.shields.io/badge/Pi-native-111827)](#pi-integration)

ScoutPi Workbench gives Pi a small, typed Earth runtime instead of a permanent collection of scenario tools. At task time, Pi can research a dataset, create a declarative adapter, verify it against Earth Engine, compile an investigation, supervise compute and exports, and preserve a successful workflow as a skill.

Forest, flood, agriculture, urban change, water, climate, and disaster tasks are possible inputs. They are not hard-coded product branches.

![ScoutPi Workbench with a live Earth Engine layer](docs/assets/workbench-live-gee.png)

## Why This Runtime

```text
question + claims + region + time
  -> observable roles
  -> registered adapter search
  -> Agent drafts a missing adapter when needed
  -> schema validation + revision + fingerprint + live probe
  -> deterministic InvestigationSpec and AnalysisDAG
  -> supervised Earth Engine job or direct map tiles
  -> bounded local export and numerical checks
  -> evidence critic + EarthStory
  -> optional reusable Pi skill
```

The model does not execute generated Python, JavaScript, shell, or arbitrary Earth Engine expressions. Pi creates declarative contracts; reviewed runtime code executes them.

## Implemented

- Three Pi gateway tools: `earth_workspace`, `python_analysis`, and `earth_story`
- Progressive-disclosure Earth investigation skill
- Dynamic `scoutpi.earth.adapter.v1` registry with revisions, SHA-256 fingerprints, enable/disable state, and audit events
- Live adapter probes that check collection availability, sample time, required bands, and quality-mask bands
- Typed `InvestigationSpec -> DatasetPlan -> AnalysisDAG` compiler with cost and evidence checks
- Dry run, inline Earth Engine metrics, Drive export, task polling, cancellation, and retryable local export jobs
- Direct Earth Engine raster tiles in MapLibre, without first downloading a GeoTIFF
- Bounded geedim GeoTIFF export with scale/pixel review, manifest, byte count, and SHA-256
- Safe CSV/JSON/GeoJSON statistics without arbitrary code execution
- Generated `scoutpi.earth.skill.v1` drafts with confirmed publishing and overwrite protection
- Vue Workbench for maps, adapters, backends, skills, plans, jobs, artifacts, recipes, and evidence
- Pi ecosystem detection so generic research, MCP, memory, browser, context, and subagent capabilities are reused rather than copied

The core does not silently ship an active domain catalog. `examples/adapter-packs/earth-engine-starter.json` is an explicit demo pack and remains separate from runtime code.

## Quick Start

Requirements: Node.js 22.6+, pnpm, uv, and Python 3.11-3.13. The checkout pins Python 3.13 for reproducible local development.

```bash
git clone https://github.com/7155/scoutpi-workbench.git
cd scoutpi-workbench
pnpm install
uv sync --extra pipeline
pnpm examples:seed
pnpm check
pnpm workbench:dev
```

Open `http://127.0.0.1:5173`. The loopback API runs at `http://127.0.0.1:17420`.

`pnpm examples:seed` imports the demo adapter pack into ignored local workspace state. Omit it when Pi should construct every adapter from primary documentation.

The dry-run path does not need Earth Engine credentials. Live compute, probes, tiles, and exports require authentication:

```bash
uv run earthengine authenticate
```

Set `EARTHENGINE_PROJECT` when the account or deployment requires an explicit Google Cloud project.

### Optional Python Profiles

```bash
uv sync --extra gee        # official Earth Engine API only
uv sync --extra pipeline   # Earth Engine + geedim + geetools
uv sync --extra workbench  # Earth Engine + geemap + leafmap
uv sync --extra climate    # Earth Engine + wxee
uv sync --extra full       # all reviewed foundational backends
```

The Workbench reports installed backends. Optional libraries do not add Pi tool schemas.

## Pi Integration

Install from GitHub:

```bash
pi install git:github.com/7155/scoutpi-workbench
```

Or install the current checkout:

```bash
pi install /absolute/path/to/scoutpi-workbench
```

The package exposes one extension, one skill, and exactly three default tools:

| Tool | Responsibility |
| --- | --- |
| `earth_workspace` | Adapter/skill registry, catalog routing, planning, probes, tiles, execution, export, status, artifacts, and recipes |
| `python_analysis` | Bounded statistics over approved local artifact roots |
| `earth_story` | Evidence-bound story creation and persisted review artifacts |

Important `earth_workspace` operations:

```text
adapter_register / adapter_import / adapter_list
adapter_probe / adapter_enable / adapter_disable
contract / catalog_search / plan / preview / visualize
run / status / cancel / retry
export / export_local / artifacts
skill_save / skill_list / skill_publish
save_recipe / load_recipe / list_recipes
```

Use `/earth-ecosystem` in Pi to inspect reusable peer capabilities. Cross-session memory comes from an installed Pi provider; this package does not register a second memory tool surface.

For an existing Edge session, authenticated web research, and browser-managed downloads, install BrowserBridge separately:

```bash
pi install git:github.com/7155/scoutpi-browserbridge
```

## Runtime State

Complete plans and results are written below `.scoutpi/earth_workspace`; Pi receives compact IDs, states, and artifact paths.

```text
.scoutpi/earth_workspace/
├── adapters/             # versioned runtime adapters
├── skills/               # validated skill drafts
├── plans/                # immutable typed plans
├── jobs/                 # job state, requests, manifests, GeoTIFF/JSON artifacts
├── recipes/              # reusable InvestigationSpec inputs
├── stories/              # EarthStory JSON and Markdown
└── registry_events.jsonl # adapter audit trail
```

Temporary Earth Engine tile URLs are for visualization. Download/export is used only when a durable local artifact, offline computation, evidence package, or downstream delivery is required.

## Local API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/environment` | Earth Engine auth and optional backend capabilities |
| `GET /api/contracts/:id` | Fetch an adapter, skill, investigation, or export template on demand |
| `GET/POST /api/adapters` | List or register declarative adapters |
| `POST /api/adapters/:id/probe` | Verify collection and required bands against Earth Engine |
| `POST /api/adapters/:id/state` | Enable or disable an adapter |
| `GET /api/catalog` | Search enabled workspace adapters |
| `POST /api/plans` | Validate a spec and compile a plan |
| `GET /api/plans/:id/visualization` | Create a short-lived Earth Engine tile layer |
| `POST /api/plans/:id/run` | Start a dry run or Earth Engine execution |
| `POST /api/plans/:id/export-local` | Queue a supervised geedim GeoTIFF export |
| `GET /api/jobs/:id?refresh=true` | Refresh provider task state |
| `POST /api/jobs/:id/cancel` | Cancel a remote task or active local worker |
| `POST /api/jobs/:id/retry` | Retry a persisted local export as a new job |
| `GET /api/jobs/:id/artifacts/:name` | Read one bounded job artifact |
| `GET/POST /api/skills` | List or save generated skill definitions |
| `POST /api/skills/:id/publish` | Confirm and publish a generated Pi skill |

## Verification

```bash
pnpm typecheck
pnpm test
pnpm python:check
pnpm harness:earth
pnpm web:build
```

The current live smoke path also verifies a real Dynamic World tile and a small geedim GeoTIFF with Rasterio metadata inspection. Live checks depend on the operator's Earth Engine account and are not part of CI.

## Documentation

- [Runtime architecture](docs/scoutpi/SCOUTPI_PI_EARTH_INVESTIGATION_RUNTIME.md)
- [Agent-built adapters and skills](docs/scoutpi/AGENT_TOOL_SKILL_BUILDER.md)
- [Pi ecosystem reuse audit](docs/scoutpi/PI_OPEN_SOURCE_ECOSYSTEM_REUSE_AUDIT.md)
- [Project notes](docs/agent/notes.md)

## Project Status

The typed runtime, dynamic registry, Workbench, direct tiles, local export, and deterministic dry-run paths are implemented. Live results still depend on account authorization, quota, dataset availability, and requested region/scale. ScoutPi never labels a plan, mock, or missing artifact as a computed finding.

## Implementation References

The product direction and the `Pi -> typed investigation -> supervised compute -> evidence Workbench` architecture are original to this project. The implementation is independent and does not copy source from the projects below. They informed specific APIs and engineering tradeoffs:

| Project | What was studied | ScoutPi boundary |
| --- | --- | --- |
| [badlogic/pi-mono](https://github.com/badlogic/pi-mono) | Pi packages, extensions, commands, skills, and active-tool APIs | Pi remains the host Agent loop; ScoutPi contributes only the Earth runtime. |
| [google/earthengine-api](https://github.com/google/earthengine-api) | Initialization, map IDs, batch exports, task status, and cancellation | The worker exposes typed operations and never evaluates generated Earth Engine code. |
| [gee-community/geemap](https://github.com/gee-community/geemap) | Analyst-facing Earth Engine maps, charts, and export conventions | Optional review backend; BrowserBridge does not click through geemap widgets. |
| [leftfield-geospatial/geedim](https://github.com/leftfield-geospatial/geedim) | Tiled local GeoTIFF, NumPy, and Xarray delivery | Used behind a bounded, supervised `export_local` contract. |
| [gee-community/geetools](https://github.com/gee-community/geetools) | Reusable Earth Engine preprocessing and object extensions | Pipeline dependency; future operations remain reviewed and typed. |
| [davemlz/eemont](https://github.com/davemlz/eemont) | Concise preprocessing and spectral-index API design | Interface reference only to avoid two competing execution dialects. |
| [opengeos/leafmap](https://github.com/opengeos/leafmap) | Local raster/vector, STAC, PostGIS, and map integration | Optional local-data Workbench backend. |
| [google/Xee](https://github.com/google/Xee) and [aazuspan/wxee](https://github.com/aazuspan/wxee) | Earth Engine/Xarray bridges for long time series | Optional climate capability, not default tool surface. |
| [opengeos/GeoAgent](https://github.com/opengeos/GeoAgent) | Geospatial adapter metadata and confirmation boundaries | ScoutPi uses a small Pi gateway surface and deterministic compiler. |
| [opendatalab/Earth-Agent](https://github.com/opendatalab/Earth-Agent) | EO task taxonomy and trajectory evaluation ideas | ScoutPi emphasizes reproducible plans, probes, artifacts, and task supervision. |
| [microsoft/Earth-Copilot](https://github.com/microsoft/Earth-Copilot) | Separation of discovery, analysis, and visualization | ScoutPi is local-first, Pi-native, and dynamically adapter-driven. |
| [opengeos/segment-geospatial](https://github.com/opengeos/segment-geospatial) and [HYDRAFloods](https://github.com/Servir-Mekong/hydra-floods) | Examples of mature algorithm providers | Future optional backends, never hard-coded scenario branches. |
| [7155/scoutpi-browserbridge](https://github.com/7155/scoutpi-browserbridge) | Existing-browser research, downloads, and evidence capture | Browser control stays a separate install so Earth tools remain compact. |

See [PI_OPEN_SOURCE_ECOSYSTEM_REUSE_AUDIT.md](docs/scoutpi/PI_OPEN_SOURCE_ECOSYSTEM_REUSE_AUDIT.md) for the wider reuse decision.

## Contributing And Security

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contract-first workflow and [SECURITY.md](SECURITY.md) for the local runtime threat model. Contributions are accepted under the [Apache-2.0 license](LICENSE).
