# Workflow Compiler

The Workflow Compiler turns a verified successful Earth job into a deterministic replay contract. It does not save an answer, narrative, task ID, or temporary Earth Engine token.

## Automatic Candidate

A completed job automatically creates a `candidate` only when:

- every plan adapter binding was probed successfully;
- the plan has no blocking critic check;
- the source job completed;
- the execution request is recoverable from persisted job state.

The candidate contains the InvestigationSpec template, required roles, immutable adapter revisions and SHA-256 fingerprints, execution mode, expected artifact kinds, maximum source pixel estimate, safety gates, and recovery actions.

## Promotion And Replay

An explicit compile action promotes a matching candidate to `ready`. Replay then:

1. validates the workflow schema;
2. checks current adapter enabled state, probe status and exact fingerprint;
3. creates a fresh InvestigationSpec, plan and job;
4. verifies every required role was routed;
5. blocks a pixel-cost increase unless separately approved;
6. executes the saved run or local-export contract;
7. persists replay assertions and outcome counters.

Adapter drift is never repaired by guessing a similar dataset. ScoutPi returns `WORKFLOW_ADAPTER_DRIFT`; Pi must re-probe, re-plan and compile a new revision.

```text
successful verified job
  -> automatic candidate
  -> human review / ready
  -> deterministic replay
  -> success or explicit blocked assertion
  -> telemetry + new artifacts
```

Workflow artifacts live under `.scoutpi/earth_workspace/workflows/` and replay records under `.scoutpi/earth_workspace/workflow_runs/`.
