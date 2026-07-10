# Runtime Governance And Observability

ScoutPi uses Pi lifecycle events without adding governance or observability tools to the model schema.

## Approval Flow

```text
model proposes high-risk earth_workspace call
  -> scoutpi-governance receives tool_call
  -> ctx.ui.confirm renders operation, target, region, time, datasets,
     estimated pixels, verification state and adapter fingerprints
  -> user approves
  -> short-lived approval receipt is persisted
  -> receipt is injected into the same tool call
  -> scoutpi-earth consumes the exact receipt once
  -> execution begins
```

An approval is bound to:

- Pi `toolCallId`;
- operation;
- canonical parameter hash;
- expiry;
- adapter fingerprints and limits shown to the user.

`confirmed: true` from model output is not an approval. A missing, reused, expired, or mismatched receipt is rejected.

## Agent Run Trace

Each Pi agent loop writes an ignored local run directory:

```text
.scoutpi/runs/<run_id>/
├── run.json
├── summary.json
├── events.jsonl
├── tool_calls.jsonl
├── approvals.jsonl
├── failures.jsonl
├── model_usage.json
├── context_pack.json
└── evidence_graph.json
```

The default privacy mode stores prompt SHA-256, character count, event sizes, operation IDs, durations, exact provider-reported token usage, and reported model cost. It does not store raw prompt or tool payload text. Set `SCOUTPI_TRACE_DEBUG_TEXT=1` only for an intentionally local debug run.

The Workbench Telemetry view combines:

- deterministic backend and Pi-tool token estimates;
- pixel, pixel-year, raster-byte and remote-task cost proxies;
- cache hit rate and operation latency;
- exact model tokens and cost when the provider reports them;
- Agent run failures and human approval receipts.

Estimated runtime cost and reported model billing are displayed separately. ScoutPi does not invent a monetary value when model pricing metadata is absent.
