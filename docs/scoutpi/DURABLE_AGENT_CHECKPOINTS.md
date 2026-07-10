# Durable Agent Checkpoints

`scoutpi-checkpoint` is an event-only Pi extension. It adds no model-visible tool and records the minimum runtime state needed to recover a stopped investigation safely.

## Lifecycle

```text
Pi session starts
  -> open or verify the session checkpoint
  -> detect a previous running, paused, failed, or interrupted operation
  -> inject one bounded recovery message before the next Agent turn
  -> require persisted job/workflow status to be read before retry
```

The extension listens to session, Agent, turn, tool, result, compaction, and shutdown events. Every transition is atomically written with a SHA-256 integrity checksum and a content-minimal journal entry.

## Persisted State

```text
.scoutpi/checkpoints/
├── <session_id>.json
└── journal/<session_id>.jsonl
```

A checkpoint contains:

- session, revision, model and context-window counters;
- active and last-completed tool call identifiers;
- allowlisted investigation, plan, job, workflow, replay, recipe, approval and artifact IDs;
- compaction count and reason;
- recovery state and next action.

It does not copy prompts, model messages, tool payloads, secrets, artifact contents, or arbitrary paths. Artifact references are reduced to their filename.

## Recovery Rule

An in-flight operation is marked `interrupted`, never `completed`. The recovery message tells Pi to inspect the durable job or workflow record before repeating a state-changing operation. This prevents a restarted Agent from submitting a second export merely because the previous model turn disappeared.

The resume message is injected once. Subsequent turns use normal context unless a new interruption creates another recoverable checkpoint.

## Compaction

Before Pi compacts a session, the extension adds a bounded preservation rule for IDs, adapter fingerprints, unresolved critic checks and failure recovery state. Raw tool output and secrets are explicitly excluded.

Use `/earth-checkpoint` in Pi to inspect the current state. The Workbench Telemetry view and `GET /api/checkpoints` expose checkpoint summaries for operator review.
