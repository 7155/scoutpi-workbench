# Contributing

ScoutPi Workbench accepts focused changes that preserve its typed execution and evidence boundaries.

## Development Setup

```bash
pnpm install
uv sync --extra pipeline
pnpm check
```

Start the local application with `pnpm workbench:dev`.

## Change Rules

- Add or update a contract test before changing shared runtime behavior.
- Keep `earth_workspace`, `python_analysis`, and `earth_story` as the default Pi tool surface.
- Add example datasets as declarative adapter packs, not branches in the compiler. Include primary documentation, bands, scale factors, masks, temporal coverage, limitations, guardrails, and a probe test.
- Add a Python backend only when the capability cannot be expressed by the existing adapter DSL. New backends need typed requests, dependency detection, bounded artifacts, cancellation behavior, and tests.
- Do not add arbitrary Python, JavaScript, SQL, or Earth Engine evaluation tools.
- Preserve job, task, artifact, and evidence provenance.
- Keep BrowserBridge and generic Pi capabilities as optional peer packages.
- Never commit credentials, Earth Engine tokens, local `.scoutpi` state, exports, or downloaded datasets.

## Pull Requests

Describe the contract or user workflow changed, list verification commands, and include screenshots for Workbench UI changes. `pnpm check` must pass before review.
