import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runtimeRoot = await mkdtemp(join(tmpdir(), "scoutpi-mcp-smoke-"));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--experimental-strip-types", join(root, "packages/scoutpi-mcp-server/src/index.ts")],
  cwd: root,
  env: { ...getDefaultEnvironment(), SCOUTPI_EARTH_ROOT: join(runtimeRoot, "earth"), SCOUTPI_RUNS_ROOT: join(runtimeRoot, "runs"), SCOUTPI_EVIDENCE_ROOT: join(runtimeRoot, "evidence") },
  stderr: "pipe",
});
const client = new Client({ name: "scoutpi-mcp-harness", version: "0.2.0" });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const resources = await client.listResources();
  const overview = await client.callTool({ name: "scoutpi_status", arguments: { op: "overview" } });
  const passed = tools.tools.length === 4 && tools.tools.every((tool) => tool.name.startsWith("scoutpi_")) && overview.isError !== true;
  const report = {
    schemaVersion: "scoutpi.mcp-smoke.v1",
    passed,
    transport: "stdio",
    tools: tools.tools.map((tool) => tool.name),
    listedResources: resources.resources.length,
    liveOperationsExposed: JSON.stringify(tools.tools.map((tool) => tool.inputSchema)).includes('"live"'),
  };
  const runId = `mcp_${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 17)}`;
  const reportPath = join(root, "exports", "mcp_harness", runId, "report.json");
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
  if (!passed || report.liveOperationsExposed) process.exitCode = 2;
} finally {
  await client.close().catch(() => undefined);
  await rm(runtimeRoot, { recursive: true, force: true });
}
