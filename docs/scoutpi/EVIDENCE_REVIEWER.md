# Evidence Reviewer

ScoutPi runs a deterministic Evidence Reviewer before it persists an `EarthStory`. The reviewer is part of the runtime boundary, not another Pi tool and not a second model call.

```text
InvestigationPlan
+ candidate EarthStory
+ persisted Earth jobs
+ canonical browser evidence
  -> deterministic review
  -> persisted review report
  -> block unsafe story or write reviewed story
```

## What It Checks

The v1 reviewer verifies:

- every plan hypothesis has a finding and every finding names a real hypothesis;
- `supported`, `not_supported`, and `mixed` statuses have matching source relations or a completed live computation;
- dry runs are never represented as computed evidence;
- metrics reference the current plan and completed live job IDs;
- numeric metric objects declare a unit;
- claim IDs, captured text, source time, and source place remain aligned with imported evidence;
- supported hypotheses with a falsification condition disclose missing counterevidence;
- adapter-declared proxy rules prevent a proxy metric from being promoted to a direct real-world fact.

Blocking findings reject the story with `STORY_REVIEW_BLOCKED`. Warnings remain visible in the returned result, generated Markdown, API, and Workbench Evidence view.

## Declarative Claim Rules

Domain semantics remain in reviewed adapters instead of hard-coded runtime branches:

```json
{
  "id": "proxy-interpretation",
  "severity": "blocking",
  "message": "Nighttime light is an activity proxy, not direct GDP evidence.",
  "claimRule": {
    "forbiddenTerms": ["GDP", "economic output"],
    "requiredQualifiers": ["proxy", "activity indicator", "nighttime light"]
  }
}
```

Rules are validated as bounded literal term lists. They cannot contain executable code or arbitrary regular expressions. A new adapter can therefore add a reviewed interpretation boundary without changing the reviewer.

## Persistence And API

Reports are content-minimal and stored at:

```text
.scoutpi/earth_workspace/stories/reviews/<investigation-id>.json
```

The report stores issue codes, remediation, references, a story hash, and the IDs of reviewed jobs and evidence. It does not duplicate source text or full computation artifacts.

```http
GET /api/evidence/review/:investigationId
```

The Workbench renders review status above the Evidence Graph so operators can distinguish evidence coverage from claim validity.

## Boundary

The reviewer does not decide whether a scientific claim is true. It enforces evidence and provenance contracts before a story can present the claim. More specialized checks belong in adapter guardrails or a reviewed Backend Provider, while an optional independent reviewer Agent may add analysis but cannot bypass this deterministic gate.
