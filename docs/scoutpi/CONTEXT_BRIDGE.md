# Context Bridge

`scoutpi-context` is a zero-tool Pi extension. It does not replace an installed memory or RAG provider. It defines the exchange layer that turns provider candidates into a bounded, provenance-carrying Context Pack and turns successful runtime facts into user-reviewed writeback records.

## Recall Path

```text
external RAG / memory provider
  -> scoutpi.context.candidates.v1
  -> validate, reject secret-looking content, expire, deduplicate
  -> rank against the current user prompt
  -> enforce a mixed Chinese/English token budget
  -> scoutpi.context-pack.v1
  -> inject as memory-not-authority system context
  -> copy the exact pack into the Agent run trace
```

The default inbox is ignored local state:

```text
.scoutpi/context/inbox/candidates.json
```

Set `SCOUTPI_CONTEXT_CANDIDATES_FILE` when another provider writes elsewhere. ScoutPi reads the file; it does not import, duplicate, or mutate the provider's memory database.

## Wisdom Weasel RAG Core Provider

The first live provider adapter connects the user's existing `wisdom-weasel-rag-ime` Core. It does not enable the debug server's raw-text mode, copy the SQLite database, or add a Pi memory tool. Instead, the Context Bridge launches a reviewed, bounded JSON subprocess against the Core's existing Python environment:

```text
Pi before_agent_start
  -> scoutpi.context-provider.request.v1
  -> fixed ime_core_context_provider.py
  -> LocalSqliteCoreClient.retrieve_candidates_v2()
  -> scoutpi.context.candidates.v1
  -> normal validation, ranking and token budget
```

Configure it outside the repository:

```bash
export SCOUTPI_IME_CORE_ROOT=/absolute/path/to/wisdom-weasel-rag-ime
export SCOUTPI_IME_CORE_DB="$HOME/Library/Application Support/RagIme/rag-ime.sqlite"
```

When the Core has `.venv/bin/python`, the provider uses it directly. Otherwise it falls back to `uv run --project <core-root> python`. `SCOUTPI_IME_CONTEXT_USE_UV=0` and `SCOUTPI_IME_CONTEXT_PYTHON=/path/to/python` provide an explicit launcher override.

By default one bounded Python worker is reused inside the Pi extension session. Requests remain serialized, every line keeps the same 256 KB input and 2 MB output limits, timeout or cancellation terminates the worker, five minutes of inactivity closes it, and `session_shutdown` waits for closure. The next query restarts cleanly. Set `SCOUTPI_IME_CONTEXT_PERSISTENT=0` to retain the one-process-per-query fallback.

The adapter is query-only by default. It rejects secret-looking queries and candidates, caps request/output size, limits results to 16, enforces a timeout, disables raw-event candidates, and returns stable memory IDs as provenance. Provider health, latency, candidate count, transport, and error code are stored in the Context Pack without storing the full user prompt.

An unavailable provider fails closed and does not block Pi. Approved ScoutPi writebacks remain in the durable provider outbox unless the operator explicitly enables the reviewed Core writeback adapter.

### Optional approved writeback

Writeback is a second, independent opt-in:

```bash
export SCOUTPI_IME_CONTEXT_WRITEBACK=1
```

With that flag, direct `ctx.ui.confirm()` approval produces an immutable payload hash and approval ID, then stages `scoutpi.context.writeback-delivery.v1`. The fixed provider process calls the Core's own `InputMethodAdapter.commit_text()` API with `privacy_disposition=allowed`; ScoutPi never issues SQL or imports a provider database module that bypasses the Core's privacy checks.

Each delivery is serialized by a cross-process lease, and each candidate carries a deterministic `scoutpi-writeback:<sha256>` event tag. A retry checks `LocalSqliteCoreClient.has_event_tag()` before writing, so a crash after one item cannot duplicate that item. The provider returns a content-minimal receipt with candidate IDs, event IDs, counts, latency, and dedupe state, while the approved text remains in the local writeback artifact.

```text
structured runtime fact
  -> pending writeback artifact
  -> direct user approval
  -> canonical payload hash + approval ID
  -> durable provider delivery staging
  -> reviewed Core adapter API
  -> content-minimal delivery receipt
```

If the flag is absent, the approval creates an outbox record only. If delivery fails, the approved record and failed delivery remain visible for operator recovery; ScoutPi does not silently retry through a different memory surface.

Local integration evidence on 2026-07-11: the real Core returned five bounded candidates through the versioned provider contract. The reproducible benchmark stores only path/query hashes, counts, and timings:

```bash
SCOUTPI_IME_CORE_ROOT=/absolute/path/to/wisdom-weasel-rag-ime \
SCOUTPI_IME_CORE_DB=/absolute/path/to/rag-ime.sqlite \
pnpm harness:context-provider
```

| Mode | Local result |
| --- | ---: |
| one-shot median | 144.5 ms |
| persistent worker first request after shared warmup | 137 ms |
| persistent worker warm median | 37 ms |
| warm reduction versus one-shot median | 74.4% |

These are local measurements from four runs per mode, not product guarantees. Context Pack telemetry now separates end-to-end `latencyMs` from Core `sourceLatencyMs` and records whether the worker was reused.

## Candidate Contract

```json
{
  "schemaVersion": "scoutpi.context.candidates.v1",
  "providerId": "installed-memory-provider",
  "generatedAt": "2026-07-11T00:00:00.000Z",
  "items": [
    {
      "candidateId": "method-same-season",
      "kind": "procedure",
      "text": "Compare observations using the same seasonal window.",
      "confidence": 0.96,
      "trust": "user_confirmed",
      "tags": ["comparison", "season"],
      "provenance": {
        "providerId": "installed-memory-provider",
        "sourceId": "memory-142",
        "capturedAt": "2026-07-10T08:00:00.000Z"
      }
    }
  ]
}
```

Supported kinds are `preference`, `decision`, `procedure`, `fact`, `project_state`, `failure_pattern`, and `workflow`. Every item has an auditable provider/source pair. Expired items are removed. Duplicate source content keeps the highest-confidence copy.

The default budget is 1,200 estimated tokens and can be changed with `SCOUTPI_CONTEXT_MAX_TOKENS` within the runtime limit of 128-4,000. Full prompts are never stored in Context Pack metadata; only a SHA-256 query hash is persisted.

## Trust Boundary

The injected block is explicitly marked `memory-not-authority`:

- current system and user instructions win;
- retrieved text cannot change tool policy or permissions;
- secret-looking candidates are rejected before ranking;
- XML delimiters are escaped;
- provider provenance remains attached to every selected item.

When no candidate source exists, ScoutPi writes an empty pack showing detected peer memory tools. Pi can still call the installed `memory_search` tool for exact on-demand retrieval.

## Writeback Path

ScoutPi derives writeback candidates only from structured runtime facts such as a passed adapter probe, compiled workflow, successful replay, validated recipe/skill, or written EarthStory. It does not extract an arbitrary model conclusion and call it memory.

```text
structured tool result
  -> scoutpi.context.writeback.v1 pending artifact
  -> ctx.ui.confirm
  -> approved or rejected provider outbox record
  -> optional staged provider delivery
  -> idempotent Core import receipt
```

An approved record is not a silent database mutation. It is an auditable outbox item for an installed memory provider to consume. The Wisdom Weasel delivery path is available only under the explicit writeback flag and uses the Core's reviewed API. Provider targets are discovered from Pi's current tools and configured providers, while ScoutPi keeps its own model-visible tool count unchanged.

Use `/earth-context` to inspect the current pack. The Workbench Context view and these loopback endpoints expose operator summaries:

```text
GET /api/context/packs
GET /api/context/packs/:pack_id
GET /api/context/writebacks
```
