# ScoutPi Workbench Agent Guide

This is a Pi-native Earth observation investigation runtime. Preserve the typed pipeline and evidence boundaries before adding product surface.

## Architecture

```text
Pi extension/skill
  -> InvestigationSpec
  -> versioned/probed Adapter Registry
  -> DatasetPlan + AnalysisDAG
  -> EarthWorkspace jobs and artifacts
  -> typed Python/GEE worker
  -> EarthStory evidence package
  -> Vue Workbench
```

- Pi owns planning and tool selection.
- `packages/earth-investigation-core` owns declarative contracts, validation, routing, and compilation. It must not contain a scenario catalog.
- `packages/earth-workspace` owns dynamic adapters, probes, generated skill drafts, durable plans, jobs, exports, recipes, analysis, and stories.
- `packages/earth-workspace-server` exposes the local HTTP API.
- `apps/web` is an operational workbench, not a marketing page.
- Browser automation is an optional external package: `7155/scoutpi-browserbridge`.
- Generic research, memory, MCP, context compression, and subagents should be reused from the Pi ecosystem rather than duplicated.

## Commands

```bash
pnpm install
uv sync --extra pipeline
pnpm check
pnpm workbench:dev
```

The Workbench defaults to `http://127.0.0.1:5173`; the API defaults to `http://127.0.0.1:17420`.

## Engineering Rules

- Keep the default Pi surface at three Earth gateway tools.
- Never evaluate model-generated Python or JavaScript.
- Pi may create declarative adapter and skill definitions. It may not create executable runtime source.
- New executable datasets require versioned band, scale, mask, metric, limitation, guardrail, and live-probe evidence.
- Keep optional providers such as geedim, geetools, geemap, leafmap, Xarray bridges, segmentation, and flood algorithms behind typed backend boundaries.
- Full artifacts stay on disk; model-facing results remain compact.
- Live GEE authentication remains explicit user-owned external state.
- Never turn example regions or phenomena into separate product branches; use specs and recipes.
- Add tests for contract, safety, persistence, and API changes.
- Do not commit `.scoutpi`, `.memory`, exports, credentials, datasets, or build output.
