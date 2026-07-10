# Agent-Built Tool And Skill Runtime

ScoutPi Workbench does not encode a forest, flood, agriculture, city, or climate product in the core. Those are possible investigations. The core owns the contracts that let Pi discover a missing capability, create a bounded adapter, verify it, execute it, and preserve a successful workflow as a skill.

## Runtime Boundary

```text
Pi Agent
  -> research primary dataset documentation
  -> draft declarative adapter
  -> schema validation
  -> Earth Engine probe
  -> typed InvestigationSpec
  -> deterministic plan and job
  -> map tiles or durable export artifact
  -> evidence critic and EarthStory
  -> optional generated skill
```

Pi may create data and instructions. It may not add arbitrary Python, JavaScript, shell commands, or Earth Engine `eval` payloads to the runtime. New executable backends remain reviewed code modules.

## Adapter Lifecycle

An adapter uses `scoutpi.earth.adapter.v1` and describes one Earth Engine image collection:

```json
{
  "schemaVersion": "scoutpi.earth.adapter.v1",
  "datasetId": "example-observable",
  "title": "Example observable",
  "provider": "Dataset provider",
  "collectionId": "PROVIDER/COLLECTION",
  "documentationUrl": "https://primary.example/dataset",
  "roles": ["observable_role"],
  "startYear": 2018,
  "scaleMeters": 30,
  "cadence": "monthly",
  "limitations": ["This observable is a proxy and needs independent validation."],
  "analysis": {
    "metric": "band_mean",
    "bands": ["value_band"],
    "outputName": "observable_mean",
    "visualization": {
      "min": 0,
      "max": 1,
      "palette": ["f7fcf5", "238b45"]
    }
  },
  "guardrails": [
    {
      "id": "proxy-boundary",
      "severity": "warning",
      "message": "Do not present this proxy as direct field truth."
    }
  ]
}
```

Registration performs structural validation, assigns a revision, computes a SHA-256 fingerprint, and appends an audit event. Registering identical content is idempotent. Changed content receives a new revision and loses its previous verification state.

The live probe then checks the current Earth Engine collection:

1. The collection can be opened.
2. At least one image exists in the requested year and optional region.
3. Every metric and quality-mask band exists in the sample image.
4. The sample date, available bands, requested bands, and check time are persisted.

Planning uses enabled adapters only. Live execution requires the plan fingerprint to match a currently enabled adapter with a passed probe. A human can explicitly approve an unverified adapter, but the bypass is never implicit.

## Declarative Operation Surface

The built-in metric DSL stays deliberately small:

```text
normalized_difference_mean
band_mean
band_sum
class_probability_mean
threshold_fraction
```

Quality masks support typed comparisons and bit checks. This surface is enough for Pi to assemble many first-pass investigations while keeping behavior testable. A missing algorithm should become a reviewed backend adapter, not generated source code hidden inside a dataset manifest.

## Skill Lifecycle

An Earth skill uses `scoutpi.earth.skill.v1`:

```json
{
  "schemaVersion": "scoutpi.earth.skill.v1",
  "skillId": "example-investigation",
  "name": "Example investigation",
  "description": "A verified workflow for a recurring investigation.",
  "whenToUse": ["The question and evidence requirements match this workflow."],
  "instructions": [
    "Check the current adapter fingerprint and probe state.",
    "Compile and inspect a dry run before live execution.",
    "Bind computed artifacts and uncertainty into EarthStory."
  ],
  "requiredAdapterIds": ["example-observable"],
  "safetyNotes": ["Do not reuse a result artifact for a different region or period."],
  "createdBy": "pi"
}
```

Saving validates the definition and confirms that required adapters exist. Publishing writes a generated `SKILL.md` only after explicit confirmation. The publisher refuses to overwrite a human-authored skill and tells the operator that Pi must reload.

## Execution Backends

Backends are optional and capability-probed:

| Backend | Runtime responsibility |
| --- | --- |
| Earth Engine API | Server-side collections, metrics, tasks, cancellation, and temporary map tiles |
| geedim | Bounded local GeoTIFF delivery from a typed plan |
| geetools | Candidate reviewed implementation layer for reusable preprocessing operations |
| geemap | Optional analyst review and notebook/map export surface |
| leafmap | Optional local raster, vector, STAC, and database review surface |
| Xee/wxee | Optional Xarray bridge for climate and long time-series analysis |

The default core does not import all of them. `earth_workspace(environment)` reports what is installed. This keeps the Pi tool schema stable while Python capabilities can grow independently.

Install profiles:

```bash
uv sync --extra gee
uv sync --extra pipeline
uv sync --extra workbench
uv sync --extra climate
uv sync --extra full
```

## Visualization Versus Export

Visualization and delivery are separate operations:

```text
visualize
  -> Earth Engine map ID
  -> short-lived raster tile URL
  -> MapLibre layer
  -> no local GeoTIFF required

export_local
  -> checked role/year/change request
  -> pixel and scale budget
  -> supervised geedim process
  -> GeoTIFF + manifest + SHA-256
  -> job-scoped download endpoint
```

Local export is asynchronous from the Workbench API. Its request and job state are persisted, the child process can be cancelled, and a failed export can be retried as a new audited job.

## Pi Operations

The three-tool Pi surface does not grow when new adapters are registered. `earth_workspace` exposes compact operations:

```text
adapter_register / adapter_import / adapter_list
adapter_probe / adapter_enable / adapter_disable
contract / catalog_search / plan / preview / visualize
run / status / cancel / retry
export / export_local / artifacts
skill_save / skill_list / skill_publish
save_recipe / load_recipe / list_recipes
```

Complete payloads and results stay in `.scoutpi/earth_workspace`; Pi receives concise IDs, states, and artifact paths.

## When To Add Code

Add a declarative adapter when a new dataset can be expressed by the existing metric and mask contracts. Add a reviewed backend module only when the task requires a genuinely new algorithm or execution system, such as segmentation, continuous change detection, flood compositing, or a domain-specific model ensemble.

This separation lets community projects become optional providers without turning the core into a pile of scenario branches.
