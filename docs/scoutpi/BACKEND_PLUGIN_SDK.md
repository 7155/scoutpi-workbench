# Backend Plugin SDK

ScoutPi backend plugins extend reviewed execution code without expanding Pi's tool surface. Pi still sees the same Earth gateway. A backend provider is registered by application code, not loaded from an Agent-authored path.

## Contract

```ts
import type { EarthBackendProvider } from "@scoutpi/earth-backend-sdk";

export const provider: EarthBackendProvider = {
  manifest: {
    schemaVersion: "scoutpi.earth.backend.v1",
    backendId: "reviewed-provider",
    displayName: "Reviewed provider",
    description: "Runs one bounded analysis capability.",
    version: "1.0.0",
    provider: "Example maintainer",
    capabilities: ["bounded_analysis"],
    operations: [{
      name: "analyze",
      description: "Create a bounded analysis artifact.",
      risk: "artifact",
      timeoutMs: 120_000,
      requiredFields: ["plan"],
      artifactKinds: ["json"],
      maxInlineResultBytes: 16_384
    }]
  },
  validate(operation, payload) {
    if (operation === "analyze" && !payload.plan) throw new Error("plan is required");
  },
  async execute(operation, payload, context) {
    context.report({ phase: "analysis", message: "Running reviewed analysis.", percent: 25 });
    if (context.signal.aborted) throw new Error("cancelled");
    // Write large output under context.artifactDir.
    return { ok: true, artifact: "result.json" };
  }
};
```

Register reviewed providers when constructing the workspace:

```ts
const workspace = new EarthWorkspace(root, python, skillRoot, [provider]);
```

## Enforcement

- Manifest and operation names are allowlisted and schema-validated.
- Unknown manifest fields are rejected; there is no `modulePath`, runtime import, shell, or eval field.
- Each operation has a timeout and shared `AbortSignal`.
- Providers may stream bounded progress through `context.report()`.
- Optional provider validation runs before execution.
- Inline results are size-limited. Large results must be artifacts.
- Backend call duration, request/result size, artifact bytes, failures, and cost proxies are recorded without storing payload content.

Agent-created adapters and workflows are declarative data. New executable providers require tests and human code review.
