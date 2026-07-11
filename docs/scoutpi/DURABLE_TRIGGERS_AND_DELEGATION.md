# Durable Triggers And Delegation

ScoutPi can replay a reviewed workflow from a manual action, a bounded interval, or a named runtime event. Automation does not add another model tool and cannot turn an exploratory or live workflow into unattended execution.

## Runtime Boundary

```text
Pi exploration
  -> successful dry-run job
  -> reviewed workflow contract
  -> trigger draft
  -> direct operator authorization
  -> signed delegation grant
  -> manual / interval / named event
  -> idempotent workflow replay
  -> durable run ledger + existing telemetry
```

Only `ready` workflows with `executionKind: run` can be delegated. The resulting grant contains exactly one scope:

```text
workflow:replay:dry_run
```

Live Earth Engine execution, Drive export, local GeoTIFF export, adapter mutation, skill publication, approval issuance, and arbitrary event payload execution are outside the trigger runtime.

## Contracts

The runtime persists four versioned records under `.scoutpi/triggers`:

| Contract | Purpose |
| --- | --- |
| `scoutpi.runtime.trigger.v1` | Condition, service identity, limits, workflow binding, and current state |
| `scoutpi.runtime.delegation.v1` | Signed authorization, issuer, subject, scope, expiry, run budget, and trigger fingerprint |
| `scoutpi.runtime.trigger-run.v1` | One idempotent replay attempt and its terminal workflow identifiers |
| `scoutpi.runtime.trigger-event.v1` | Event name, event ID, payload hash, byte count, and matching trigger IDs |

Event receipts never persist the raw payload. Trigger errors are clipped and checked for common secret material before persistence.

## Identity And Authorization

Each trigger receives a stable service principal such as:

```json
{
  "principalId": "service:browser-evidence-arrived",
  "kind": "service",
  "displayName": "Browser evidence arrived"
}
```

Authorization signs the canonical grant body with an HMAC-SHA256 key generated at `.scoutpi/triggers/delegation.key`. The key is created with owner-only permissions. A grant binds:

- trigger ID and complete trigger fingerprint;
- exact workflow ID;
- issuer and service subject;
- dry-run replay scope;
- expiry and maximum run count;
- current usage count.

Changing the trigger condition, subject, limits, or workflow after authorization invalidates the fingerprint. Reauthorization revokes the previous grant. Signature or body tampering fails closed.

In Pi, `/earth-trigger-approve <trigger-id>` uses `ctx.ui.confirm()` before issuing the grant. The loopback Workbench can also authorize a draft, but it is an operator UI boundary and must not be exposed remotely without authentication, authorization, and CSRF protection.

## Conditions

### Manual

Manual triggers run only after an explicit invocation with a unique event key.

### Interval

The server supervisor periodically checks due interval triggers. A durable exclusive lease prevents two local supervisors from dispatching the same tick. A stale lease can be taken over after its bounded lifetime.

### Event

Named events are exact-match only. The Browser Evidence Bridge currently emits:

```text
browser.evidence.imported
```

The event ID is derived from evidence source fingerprints. Reimporting the same event produces the same durable run ID and does not replay the workflow again.

## Idempotency And Limits

The trigger runtime derives each run ID from `triggerId + eventKey` and creates the record exclusively. This provides durable idempotency across retries and process restarts.

Every invocation checks:

- active trigger state;
- grant signature and trigger fingerprint;
- workflow revision readiness and dry-run execution kind;
- grant expiry and trigger expiry;
- maximum runs;
- cooldown window;
- event payload size, capped at 64 KB.

An exhausted grant pauses its trigger. A revoked trigger cannot be resumed with the old grant.

## Pi Surface

The `scoutpi-triggers` extension registers no model-facing tool. It adds only operator commands:

```text
/earth-triggers
/earth-trigger-approve <trigger-id>
```

This keeps the default Pi tool surface at three Earth gateways while still using Pi's real UI and session journal for authorization evidence.

## Workbench And API

The Runtime Center `Automation` view shows delegation posture, drafts awaiting review, identity-bound trigger cards, run budgets, expiry, condition, grant state, and the idempotent run ledger.

Loopback endpoints:

```text
GET  /api/triggers
POST /api/triggers
POST /api/triggers/:id/approve
POST /api/triggers/:id/state
POST /api/triggers/:id/invoke
GET  /api/trigger-runs
GET  /api/delegations
POST /api/trigger-events
```

The delegation endpoint never returns the signature.

## Verification

`tests/triggerRuntime.test.ts` covers:

- signed authorization and maximum-run exhaustion;
- manual idempotency;
- event and interval replay;
- supervisor lease exclusion;
- trigger and grant tamper rejection;
- live-workflow rejection;
- direct Pi UI approval with zero registered tools;
- API creation, authorization, invocation, state change, and signature redaction.

The Browser Evidence Bridge test also verifies that a canonical evidence import writes an event receipt without persisting the event payload.
