# Pi RPC Harness

`harness/pi/runPiRpcHarness.ts` launches the real Pi RPC process with the public ScoutPi extensions, a temporary model registry, an isolated Earth workspace, and machine-readable scoring.

The API key is read from an environment variable or an external file and is passed only through the child-process environment:

```bash
SCOUTPI_HARNESS_KEY_FILE=/absolute/path/to/key.md \
SCOUTPI_PI_MODEL=gpt-5.6 \
pnpm harness:pi
```

The default endpoint is the official OpenAI API. Set `SCOUTPI_PI_BASE_URL` for an OpenAI-compatible provider; provider-specific endpoints and credentials are local test configuration and are not committed.

This performs a provider model-list preflight and writes a report under `exports/pi_harness/`. It does not make a model request. To verify that the real Pi RPC process and all seven public extensions initialize, run:

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

Live mode runs one bounded case by default. Select a case explicitly or opt into the full paid suite:

```bash
pnpm harness:pi-live -- --case=proxy-overclaim-review
pnpm harness:pi-live-all
```

Each case gets a fresh temporary Pi home, Earth workspace, run store, checkpoint store, and skill-publish root. The temporary directory is removed after the child process exits, so cases cannot pass by inheriting state from earlier runs.

The harness enforces limits while Pi is running and sends an RPC abort when a case crosses one. Defaults can be tightened per run:

```text
SCOUTPI_PI_MAX_OUTPUT_TOKENS=16384
SCOUTPI_PI_CASE_MAX_TOOL_CALLS=12
SCOUTPI_PI_CASE_MAX_TURNS=8
SCOUTPI_PI_CASE_MAX_TOKENS=120000
SCOUTPI_PI_CASE_MAX_COST_USD=0       # disabled unless a positive value is set
SCOUTPI_PI_RUN_MAX_TOKENS=500000
```

Model input/output prices are never guessed. Set `SCOUTPI_MODEL_INPUT_USD_PER_M` and `SCOUTPI_MODEL_OUTPUT_USD_PER_M` when the selected provider has known prices; otherwise cost remains zero and token ceilings still apply.

The temporary Pi model config uses `openai-responses`, `xhigh` reasoning, `store: false` behavior from Pi's Responses adapter, and explicit model metadata. No key is written to the repository, model config, trace, or report.

The ten current cases cover planning, dataset coverage, adapter probes, dry-run/computed-result separation, proxy overclaiming, approval denial, and approval bypass. Scoring records observed and missing operations, forbidden claims, completion, approvals, turns, tool calls, exact provider usage, cost, and budget violations.
