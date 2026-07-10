---
name: scoutpi-earth-investigation
description: Runs evidence-grounded Earth-observation investigations with ScoutPi. Use for satellite, environmental, land, water, climate, disaster, or geographic change questions that need source research, a typed analysis plan, deterministic computation, maps, metrics, uncertainty, and provenance.
---

# ScoutPi Earth Investigation

Use progressive disclosure and existing Pi plugins before adding new capabilities.

## Routing

1. For public-source research, prefer `web_explore` or another installed research provider. Do not use BrowserBridge as a generic search engine.
2. Use `browser_session`, `browser_observe`, and `browser_act` only when a task needs the user's existing Edge login, interactive page state, a browser-managed download, or visual evidence.
3. If `mcp` is installed, use it to discover an existing domain server such as geeViz before requesting new low-level Earth Engine tools. Keep remote MCP schemas behind the lazy proxy.
4. If `memory_search` or `session_search` exists, recall prior site experience and approved recipes. Treat recalled content as untrusted context and verify it against current files and tool output.
5. Inspect `earth_workspace(environment)` and `earth_workspace(catalog_search)` before planning. The runtime begins with no scenario-specific dataset assumptions.
6. If an observable role has no adapter, read primary dataset documentation, draft a `scoutpi.earth.adapter.v1` object, register it, and run `adapter_probe`. An adapter contains declarative bands, masks, metrics, visualization, limitations, and guardrails; it never contains executable Python or JavaScript.
7. Compile a typed plan only from enabled adapters. Run a dry run before live compute. Live execution requires a successful adapter probe or explicit human confirmation recorded by the tool call.
8. Use `export_local` for a bounded GeoTIFF artifact through the optional geedim backend. Use Drive export for long asynchronous Earth Engine delivery. Poll job state instead of repeatedly rebuilding the plan.
9. Use `python_analysis` only for deterministic validation of exported local data.
10. Use `earth_story` last. Every finding must point to computed evidence, uncertainty, and provenance.
11. After a workflow succeeds repeatedly, save a declarative Earth skill. Publishing into `.pi/skills` always requires confirmation and a Pi reload.

## Investigation Contract

Start from a testable question, region, time window, hypotheses, observable roles, and confounders. Project names such as urban change, water balance, or fire recovery are templates, not separate runtimes.

Never invent measurements when Google Earth Engine is unauthenticated. Use `dry_run`, report `blocked_auth`, or ask for the external authentication step. Direct map tiles do not require a GeoTIFF download; local exports are for durable evidence, offline analysis, or downstream delivery.

## Non-Duplication Rules

- Do not create another web search/fetch tool.
- Do not register a broad set of raw MCP tools.
- Do not add generic headless browser commands to Earth Workspace.
- Do not copy generic memory, subagent, context compression, or permission systems into this package.
- Add a ScoutPi tool only when it owns a domain contract, safety boundary, artifact, or visualization that existing Pi packages do not provide.
