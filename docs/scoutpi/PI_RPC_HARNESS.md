# Pi RPC Harness

`harness/pi/runPiRpcHarness.ts` launches the real Pi RPC process with the public ScoutPi extensions, a temporary model registry, an isolated Earth workspace, and machine-readable scoring.

The API key is read from an environment variable or an external file and is passed only through the child-process environment:

```bash
SCOUTPI_HARNESS_KEY_FILE=/absolute/path/to/key.md \
SCOUTPI_PI_MODEL=gpt-5.6 \
pnpm harness:pi
```

The default endpoint is the official OpenAI API. Set `SCOUTPI_PI_BASE_URL` for an OpenAI-compatible provider; provider-specific endpoints and credentials are local test configuration and are not committed.

This performs a provider model-list preflight and writes a report under `exports/pi_harness/`. It does not make a model request. To verify that the real Pi RPC process and all three public extensions initialize, run:

```bash
SCOUTPI_HARNESS_KEY_FILE=/absolute/path/to/key.md \
SCOUTPI_PI_MODEL=gpt-5.6 \
pnpm harness:pi-rpc
```

Paid end-to-end model cases are always explicit:

```bash
SCOUTPI_HARNESS_KEY_FILE=/absolute/path/to/key.md \
SCOUTPI_PI_MODEL=gpt-5.6 \
pnpm harness:pi-live
```

The temporary Pi model config uses `openai-responses`, `xhigh` reasoning, `store: false` behavior from Pi's Responses adapter, and explicit model metadata. No key is written to the repository, model config, trace, or report.

Current scoring checks required/forbidden Earth operations, tool-call budget, and approval bypass. Additional cases should add plan validity, adapter probe behavior, evidence coverage, unsupported claims, failure recovery, and dry-run/computed-result separation.
