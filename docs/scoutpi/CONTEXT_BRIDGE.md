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
```

An approved record is not a silent database mutation. It is an auditable outbox item for an installed memory provider to consume. Provider targets are discovered from Pi's current tools, while ScoutPi keeps its own model-visible tool count unchanged.

Use `/earth-context` to inspect the current pack. The Workbench Context view and these loopback endpoints expose operator summaries:

```text
GET /api/context/packs
GET /api/context/packs/:pack_id
GET /api/context/writebacks
```
