import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createEarthWorkspaceServer } from "../packages/earth-workspace-server/src/server.ts";
import { EarthWorkspace } from "../packages/earth-workspace/src/index.ts";
import { createScoutPiMcpServer } from "../packages/scoutpi-mcp-server/src/server.ts";

function textPayload(result: any): any {
  const text = result.content.find((item: any) => item.type === "text") as { text?: string } | undefined;
  assert.equal(typeof text?.text, "string");
  return JSON.parse(text!.text!.slice(text!.text!.indexOf("\n") + 1));
}

test("MCP server exposes four bounded gateways and artifact resource links", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-mcp-"));
  const workspace = new EarthWorkspace(join(root, "earth"));
  const { server } = createScoutPiMcpServer({ workspace, resourceMaxBytes: 1024 * 1024 });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "scoutpi-test", version: "1.0.0" });
  try {
    await workspace.importAdapterPack(JSON.parse(await readFile(join(process.cwd(), "examples/adapter-packs/earth-engine-starter.json"), "utf8")), "example");
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), ["scoutpi_artifact", "scoutpi_evidence", "scoutpi_investigation", "scoutpi_status"]);
    const investigationSchema: any = listed.tools.find((tool) => tool.name === "scoutpi_investigation")?.inputSchema;
    assert.deepEqual(investigationSchema.properties.op.enum, ["list", "get", "plan", "dry_run"]);
    assert.equal(investigationSchema.properties.op.enum.includes("live"), false);

    const invalid = await client.callTool({ name: "scoutpi_investigation", arguments: { op: "plan" } });
    assert.equal(invalid.isError, true);

    const spec = {
      schemaVersion: "scoutpi.investigation.v1",
      investigationId: "mcp-investigation",
      question: "What changed, and what evidence supports the hypotheses?",
      phenomenon: "generic_change",
      region: { kind: "bbox", bbox: [121.4, 31.1, 121.5, 31.2], name: "MCP test area" },
      period: { startYear: 2023, endYear: 2024, startMonth: 6, endMonth: 8 },
      hypotheses: [{ id: "h1", statement: "A measurable change occurred.", observableRoles: ["built_surface"] }],
      confounders: ["Compare the same season."],
    };
    const planned = textPayload(await client.callTool({ name: "scoutpi_investigation", arguments: { op: "plan", spec } }));
    assert.equal(planned.investigationId, "mcp-investigation");
    assert.equal(typeof planned.planId, "string");

    const dryRun = textPayload(await client.callTool({ name: "scoutpi_investigation", arguments: { op: "dry_run", id: planned.planId } }));
    assert.equal(dryRun.mode, "dry_run");
    assert.equal(dryRun.state, "completed");

    const artifactResult: any = await client.callTool({ name: "scoutpi_artifact", arguments: { op: "list", jobId: dryRun.jobId } });
    const artifacts = textPayload(artifactResult);
    assert.equal(artifacts.some((item: any) => item.name === "job.json"), true);
    assert.equal(artifactResult.content.some((item: any) => item.type === "resource_link"), true);
    assert.equal(JSON.stringify(artifacts).includes(root), false);

    const jobResource = artifacts.find((item: any) => item.name === "job.json").uri;
    const read = await client.readResource({ uri: jobResource });
    assert.equal(read.contents[0].mimeType, "application/json");
    assert.match(String((read.contents[0] as any).text), new RegExp(dryRun.jobId));

    const graph = textPayload(await client.callTool({ name: "scoutpi_evidence", arguments: { op: "graph", investigationId: "mcp-investigation" } }));
    assert.equal(graph.coverage.computedRuns, 0);
    assert.equal(graph.coverage.hypotheses, 1);

    const overview = textPayload(await client.callTool({ name: "scoutpi_status", arguments: { op: "overview" } }));
    assert.equal(overview.plans, 1);
    assert.equal(overview.jobs, 1);

    const runtime = await createEarthWorkspaceServer({ host: "127.0.0.1", port: 0, workspace });
    await runtime.listen();
    try {
      const address = runtime.server.address();
      if (!address || typeof address === "string") throw new Error("MCP profile test server unavailable");
      const profile: any = await (await fetch(`http://127.0.0.1:${address.port}/api/mcp`)).json();
      assert.deepEqual(profile.tools, ["scoutpi_investigation", "scoutpi_status", "scoutpi_artifact", "scoutpi_evidence"]);
      assert.equal(profile.modelSurface, "external_only");
    } finally { await runtime.close(); }
  } finally {
    await client.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
