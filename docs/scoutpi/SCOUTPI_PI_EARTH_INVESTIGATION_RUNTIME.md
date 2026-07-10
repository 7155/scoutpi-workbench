# ScoutPi Pi-native Earth Investigation Runtime

## Product Boundary

This runtime is not an urban-development, lake, flood, fire, or photovoltaic project. Those are replaceable investigation fixtures.

The reusable product is:

> A Pi-native runtime that turns a real-world question into a typed investigation, routes observable proxies to Earth Engine datasets, compiles a deterministic analysis DAG, supervises execution and exports, validates local results, and binds claims and computed evidence into an auditable story.

Pi owns the agent loop. BrowserBridge, memory, Earth Engine, Python analysis, and EarthStory are tools around Pi rather than independent agents.

```text
Pi
├─ installed research / MCP / memory providers
├─ optional BrowserBridge for existing Edge state
├─ earth_workspace
├─ python_analysis
└─ earth_story
```

The open-source reuse decision is documented in [PI_OPEN_SOURCE_ECOSYSTEM_REUSE_AUDIT.md](PI_OPEN_SOURCE_ECOSYSTEM_REUSE_AUDIT.md). ScoutPi does not duplicate generic Pi research, MCP, memory, context-compression, browser-test, or subagent packages.

## Implemented Modules

```text
packages/earth-investigation-core/
  InvestigationSpec
  declarative adapter and skill contracts
  Dataset Router
  Analysis DAG compiler
  Evidence Critic checks

packages/earth-workspace/
  versioned adapter registry and live probes
  artifact store
  dry-run and live execution supervisor
  Earth Engine Python worker
  Drive task supervision and geedim local export
  deterministic CSV/JSON statistics
  recipe registry
  EarthStory JSON/Markdown compiler

apps/web/
  responsive investigation Workbench
  live map, metrics, DAG, runs, evidence and audit views

packages/pi-ecosystem/
  installed Pi capability detection
  explicit reuse and fallback routing

.pi/extensions/scoutpi-earth/
  earth_workspace
  python_analysis
  earth_story
```

The worker accepts typed JSON only. It does not execute model-generated Python or JavaScript.

## Workbench

Start the API and Vue application together:

```bash
pnpm workbench:dev
```

Default endpoints:

```text
Workbench  http://127.0.0.1:5173/
API        http://127.0.0.1:17420/
```

The Workbench is the operating UI, not a marketing page. It supports plan creation, direct Earth Engine tile layers, deterministic DAG review, dry-run/live job supervision, adapter probes, generated skill review, backend capability state, bounded local GeoTIFF export, evidence, and job artifacts. Desktop and mobile layouts are both verified with Playwright.

## Why Two Catalog Layers

`catalog_search` reads a workspace registry containing declarative dataset adapters with band, quality-mask, scale, metric, visualization, limitation, and guardrail contracts. The core starts without scenario adapters. Pi or a human may inspect primary catalog documentation, register an adapter, and verify it against the live collection. `examples/adapter-packs/` contains explicit demo inputs and is never silently loaded.

This avoids a dangerous failure mode where Pi finds a dataset name but guesses its bands, scale factors, masks, or temporal coverage.

## Pi Tools

### earth_workspace

Operations:

```text
catalog_search
environment
contract
adapter_register / adapter_import / adapter_list
adapter_probe / adapter_enable / adapter_disable
skill_save / skill_list / skill_publish
plan
preview
visualize
run
status
cancel
retry
artifacts
export
export_local
save_recipe
load_recipe
list_recipes
```

`plan` accepts `scoutpi.investigation.v1`. A project is data, not code:

```json
{
  "schemaVersion": "scoutpi.investigation.v1",
  "investigationId": "my-investigation",
  "question": "What changed and what evidence supports it?",
  "region": { "kind": "bbox", "bbox": [120.9, 30.8, 121.2, 31.1] },
  "period": { "startYear": 2018, "endYear": 2024, "startMonth": 6, "endMonth": 8 },
  "hypotheses": [
    { "id": "h1", "statement": "Vegetation changed", "observableRoles": ["vegetation"] }
  ],
  "confounders": ["Use the same season in every year"]
}
```

Regions may be a bbox, GeoJSON geometry, or Earth Engine asset. Observable roles, not project names, route datasets.

### python_analysis

Reads an allowlisted local CSV, JSON row list, or GeoJSON FeatureCollection and writes deterministic count, mean, range, standard deviation, OLS slope, and R-squared artifacts. It never treats LLM-written numbers as computed evidence.

### earth_story

Requires explicit claims, hypothesis status, computed evidence, metrics, layers, charts, uncertainties, and provenance. It writes both JSON for Workbench and Markdown for review.

## GEE Runtime

The minimal optional environment is installed with:

```bash
uv sync --extra gee
```

Add stable local export and reviewed preprocessing dependencies with:

```bash
uv sync --extra pipeline
```

Authenticate and set a Cloud project once:

```bash
uv run earthengine authenticate
uv run earthengine set_project YOUR_GOOGLE_CLOUD_PROJECT
set -x EARTHENGINE_PROJECT YOUR_GOOGLE_CLOUD_PROJECT  # fish
```

The Python API requires authentication and initialization with an eligible Cloud project. Export tasks are started through `ee.batch` and expose task states for supervision. See the official [authentication guide](https://developers.google.com/earth-engine/guides/auth), [Python installation guide](https://developers.google.com/earth-engine/guides/python_install), [image export guide](https://developers.google.com/earth-engine/guides/exporting_images), and [table export guide](https://developers.google.com/earth-engine/guides/exporting_tables).

Without credentials, `dry_run` remains available and `live` returns `blocked_auth`; it never generates sample measurements and labels them as real results.

## Execution Modes

```text
dry_run:
  validate spec -> route datasets -> compile DAG -> write execution manifest

live + inline:
  initialize EE -> compute annual server-side FeatureCollection
  -> retrieve one bounded metrics payload -> local artifact

live + drive:
  initialize EE -> create annual-metrics CSV and change-GeoTIFF Drive tasks
  -> return task ID with running state
  -> status(refresh=true) supervises terminal state
  -> cancel requests provider-side task cancellation

visualize:
  build one typed role/year image -> request a short-lived Earth Engine map ID
  -> stream tiles directly into MapLibre without downloading a GeoTIFF

export_local:
  validate role/year/change/scale/CRS/dtype and pixel budget
  -> run geedim in a supervised child process
  -> write GeoTIFF, manifest, byte count, and SHA-256 under the job directory
  -> expose the result through the job-scoped artifact endpoint
```

Large dataset-year or high nominal-pixel plans require explicit `confirmed=true`. Export and analysis artifacts live under `.scoutpi/earth_workspace/` and are ignored by Git. Job-scoped artifact reads validate both the job ID and filename before accessing disk.

## Evidence Critic

The compiler creates checks before execution:

- same-season comparison
- explicit user-provided confounders
- dataset temporal coverage must match the requested period
- requested maximum scale must match the selected adapter
- every adapter contributes its own domain guardrails and limitations

These checks constrain the final language; they do not automatically prove or disprove a hypothesis.

## Recipes and Ecosystem Memory

Recipes persist an `InvestigationSpec`, not temporary task IDs or generated source code. A recipe can patch region, period, question, and hypotheses before producing a new plan. Successful reusable instructions can also be saved as `scoutpi.earth.skill.v1`; publishing requires confirmation and cannot overwrite a human-authored Pi skill.

The full builder lifecycle is documented in [AGENT_TOOL_SKILL_BUILDER.md](AGENT_TOOL_SKILL_BUILDER.md).

Use an installed Pi memory provider for cross-session recall. Earth Workspace keeps recipes, plans, jobs, and artifacts as deterministic workspace state and does not register a duplicate memory surface.

The Pi package uses a progressive-disclosure skill and exposes exactly three Earth tools. `/earth-ecosystem` reports detected research, MCP, browser, memory, context, and subagent capability groups and the preferred routing for each.

## Verification

```bash
pnpm test
pnpm typecheck
pnpm harness:earth
pnpm web:build
```

Tests cover multiple unrelated example inputs, dynamic adapter versioning, fingerprints, live probes, enable/disable state, unverified-live blocking, typed DAG generation, cost estimates, remote task transitions, local export supervision and retry, skill publication protection, bounded artifacts, recipes, statistics, story generation, invalid geometry, path escape rejection, the three-tool Pi surface, and ecosystem routing.
