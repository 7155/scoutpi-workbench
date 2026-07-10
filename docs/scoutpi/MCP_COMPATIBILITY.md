# MCP Compatibility Server

ScoutPi remains Pi-native. The MCP server is a local compatibility boundary for external hosts, not a second Agent loop and not another generic MCP client.

## Surface

```text
external MCP host
  -> local stdio transport
  -> four compact ScoutPi gateways
  -> the same EarthWorkspace contracts and artifacts

Pi
  -> three native Earth gateways
  -> governance, lifecycle events, checkpoints, context, and trace
```

The server uses the stable 1.x line of the official [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk). The upstream project currently recommends 1.x for production while the split-package 2.x API is still under development.

| MCP tool | Operations | Boundary |
| --- | --- | --- |
| `scoutpi_investigation` | `list`, `get`, `plan`, `dry_run` | No live Earth execution |
| `scoutpi_status` | `overview`, `jobs`, `job`, `workflows`, `environment` | Read-only status and provider polling |
| `scoutpi_artifact` | `list`, `preview` | Job-scoped names, bounded text preview, resource links for full content |
| `scoutpi_evidence` | `list`, `graph` | Compact records and graph coverage; full graph is a resource |

The server does not expose live runs, exports, adapter mutation, workflow publishing, or approval issuance. Those state-changing operations remain in Pi, where the governance extension can obtain a real user decision and mint a parameter-bound receipt.

## Resources

```text
scoutpi://jobs/{jobId}/artifacts/{name}
scoutpi://investigations/{investigationId}/evidence
```

Tool calls return links before content. Text previews are capped at 8,000 characters. Resource reads default to 1 MB and can be bounded further with `SCOUTPI_MCP_RESOURCE_MAX_BYTES`; the hard maximum is 5 MB. Artifact paths never enter the tool result.

## Run

```bash
pnpm mcp:stdio
```

Example client entry:

```json
{
  "mcpServers": {
    "scoutpi-workbench": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "/absolute/path/to/scoutpi-workbench/packages/scoutpi-mcp-server/src/index.ts"
      ],
      "env": {
        "SCOUTPI_EARTH_ROOT": "/absolute/path/to/.scoutpi/earth_workspace"
      }
    }
  }
}
```

The transport owns stdout for JSON-RPC. Operational diagnostics must go to stderr or persisted runtime artifacts.

## Verification

```bash
pnpm harness:mcp
```

The harness launches the actual stdio process with the official MCP client, performs the initialization handshake, lists tools and resources, calls the status gateway, and verifies that no live operation appears in the schemas. It writes an ignored report under `exports/mcp_harness/`.
