# Browser Evidence Bridge

ScoutPi keeps browser control in the separate BrowserBridge package and imports only evidence artifacts into the Earth runtime. The bridge adds no model-facing tool: Pi continues to see `earth_workspace`, `python_analysis`, and `earth_story` only.

## Boundary

```text
ScoutPi BrowserBridge
  -> evidence_cards.json or scoutpi.browser.evidence.v1
  -> allowed-root and secret checks
  -> copied screenshot/text artifacts with SHA-256
  -> investigation / claim / hypothesis binding
  -> scoutpi.evidence-graph.v1
  -> EarthStory and Agent run trace
```

BrowserBridge owns the signed-in Edge session, page interaction, snapshots, screenshots, and downloads. This repository owns the investigation binding, evidence integrity, relation semantics, computed-result boundary, and Workbench review UI.

## Canonical contract

```json
{
  "schemaVersion": "scoutpi.browser.evidence.v1",
  "evidenceId": "browser-ev-001",
  "source": {
    "url": "https://example.com/project/status",
    "title": "Project status notice",
    "capturedAt": "2026-07-11T01:00:00.000Z",
    "sourceType": "public_webpage",
    "trust": "high"
  },
  "claim": {
    "text": "The notice reports completion in 2024.",
    "timeReferences": ["2024"],
    "placeReferences": ["phase one area"]
  },
  "browser": {
    "commandId": "command-001",
    "runId": "run-001",
    "snapshotId": "snapshot-001"
  },
  "binding": {
    "investigationId": "investigation-001",
    "claimId": "claim-phase-one",
    "hypothesisId": "h1",
    "relation": "supports"
  },
  "artifacts": [],
  "provenance": {
    "importedAt": "2026-07-11T01:01:00.000Z",
    "adapter": "canonical-v1",
    "sourcePathHash": "...",
    "sourceFingerprint": "..."
  },
  "integrity": {
    "payloadSha256": "..."
  }
}
```

Relations are explicit: `supports`, `contradicts`, `contextualizes`, or `documents`. The bridge never infers a relation from page text.

## Pi operations

All operations remain behind `earth_workspace`:

| Operation | Purpose |
| --- | --- |
| `evidence_import` | Normalize a BrowserBridge `evidence_cards.json` file from an allowed root |
| `evidence_bind` | Bind a record to an investigation, claim, hypothesis, and explicit relation |
| `evidence_list` | Return a compact investigation-scoped evidence list |
| `evidence_graph` | Join browser sources, claims, hypotheses, completed live runs, and EarthStory findings |

The event-only `scoutpi-evidence` extension also accepts a canonical `browserEvidence` object or an allowlisted `evidencePath` in BrowserBridge tool-result details. It writes a session entry and status but registers no tool.

## Local API

```text
GET  /api/evidence?investigationId=...
POST /api/evidence/import
POST /api/evidence/:evidenceId/bind
GET  /api/evidence/graph/:investigationId
```

## Security and integrity

- Configure BrowserBridge export roots with `SCOUTPI_BROWSER_EVIDENCE_ROOTS`, using the platform path delimiter for multiple roots.
- The default import root is `.scoutpi/evidence/inbox`; arbitrary filesystem reads and symlink escapes are rejected after real-path resolution.
- Source files are limited to 2 MB, screenshots to 20 MB, and URLs to HTTP(S).
- Common secret material is rejected even if BrowserBridge already redacted the page.
- Screenshot and extracted-text artifacts are copied under `.scoutpi/evidence/artifacts` and hashed.
- Canonical records carry a payload hash that is verified again whenever a record is read or used to build a graph.
- Source fingerprints deduplicate imports; an existing `evidenceId` cannot be replaced with different content.
- A dry run remains planning evidence only. It is never counted as a completed computation in the Evidence Graph.
- `earth_story` accepts `evidenceArtifact` only when the record is bound to the same investigation and source URL.

Generated runtime state under `.scoutpi/evidence` is ignored by Git.
