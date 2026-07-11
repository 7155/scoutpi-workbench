import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createEarthWorkspaceServer } from "../packages/earth-workspace-server/src/server.ts";
import { EarthWorkspace } from "../packages/earth-workspace/src/index.ts";
import { formatPiEcosystemProfile, inspectPiEcosystem, PiEcosystemStore } from "../packages/pi-ecosystem/src/index.ts";

test("Pi ecosystem profile recognizes reusable peers without adding tool schemas", () => {
  const profile = inspectPiEcosystem([
    { name: "web_explore" }, { name: "mcp" }, { name: "browser" }, { name: "browser_session" },
    { name: "browser_observe" }, { name: "browser_act" }, { name: "memory_search" }, { name: "ctx_read" }, { name: "subagent" },
  ]);
  assert.equal(profile.detectedCount, 6);
  assert.deepEqual(profile.capabilities.find((item) => item.id === "research")?.tools, ["web_explore"]);
  assert.match(profile.routing.find((item) => item.task === "source research")?.preferred ?? "", /web research provider/);
  assert.match(formatPiEcosystemProfile(profile), /ready MCP gateway: mcp/);
});

test("Pi ecosystem profile keeps ScoutPi boundaries explicit when peers are absent", () => {
  const profile = inspectPiEcosystem([{ name: "browser_session" }, { name: "browser_observe" }, { name: "browser_act" }, { name: "earth_workspace" }]);
  assert.equal(profile.capabilities.find((item) => item.id === "research")?.detected, false);
  assert.match(profile.routing.find((item) => item.task === "source research")?.fallback ?? "", /interaction or an existing login/);
  assert.match(profile.capabilities.find((item) => item.id === "browser")?.scoutPiBoundary ?? "", /existing Edge session/);
});

test("Pi capability broker detects zero-tool market extensions from slash commands and preserves source provenance", () => {
  const profile = inspectPiEcosystem(
    [{ name: "earth_workspace" }],
    [
      { name: "goal", sourceInfo: { source: "npm:pi-goal", scope: "global" } },
      { name: "intercom", sourceInfo: { source: "npm:pi-intercom", scope: "global" } },
      { name: "access-guard", sourceInfo: { source: "git:github.com/sysid/pi-extensions", scope: "project" } },
      { name: "extensions", sourceInfo: { source: "npm:pi-extmgr", scope: "global" } },
    ],
  );
  assert.equal(profile.capabilities.find((item) => item.id === "goals")?.detected, true);
  assert.deepEqual(profile.capabilities.find((item) => item.id === "interop")?.commands, ["intercom"]);
  assert.match(profile.capabilities.find((item) => item.id === "security")?.sources[0] ?? "", /sysid\/pi-extensions/);
  assert.match(profile.routing.find((item) => item.task === "package discovery and updates")?.preferred ?? "", /package manager UI/);
  assert.match(formatPiEcosystemProfile(profile), /\/goal/);
});

test("Pi capability broker persists a path-safe operator profile and exposes it through the Workbench API", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-ecosystem-"));
  const store = new PiEcosystemStore(join(root, "ecosystem"));
  const profile = inspectPiEcosystem(
    [{ name: "memory_search", sourceInfo: { path: "/Users/private/.pi/agent/extensions/pi-memory", scope: "global" } }],
    [{ name: "extensions", sourceInfo: { source: "npm:@pi-stef/catalog", scope: "global" } }],
  );
  await store.save(profile);
  const runtime = await createEarthWorkspaceServer({ host: "127.0.0.1", port: 0, workspace: new EarthWorkspace(join(root, "earth"), process.execPath), ecosystemStore: store });
  await runtime.listen();
  try {
    const saved = await store.get();
    assert.equal(saved?.schemaVersion, "scoutpi.pi-ecosystem-profile.v1");
    assert.equal(JSON.stringify(saved).includes("/Users/private"), false);
    assert.match(saved?.capabilities.find((item) => item.id === "memory")?.sources[0] || "", /extensions\/pi-memory/);
    assert.match(saved?.capabilities.find((item) => item.id === "security")?.catalogUrl || "", /^https:\/\/pi\.dev\/packages/);
    const address = runtime.server.address();
    if (!address || typeof address === "string") throw new Error("test server address unavailable");
    const response: any = await (await fetch(`http://127.0.0.1:${address.port}/api/pi-ecosystem`)).json();
    assert.equal(response.profile.detectedCount, 2);
    assert.deepEqual(response.profile.packageCommands.slice(0, 2), ["pi list", "pi config"]);
    const tampered = structuredClone(profile);
    tampered.capabilities[0].catalogUrl = "javascript:alert(1)";
    await writeFile(store.profilePath, JSON.stringify(tampered));
    await assert.rejects(store.get(), (error: any) => error.code === "PI_ECOSYSTEM_PROFILE_INVALID");
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("the public Pi package loads the domain runtime plus zero-tool lifecycle extensions", async () => {
  const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
  assert.deepEqual(packageJson.pi.extensions, [
    "./.pi/extensions/scoutpi-context/index.ts",
    "./.pi/extensions/scoutpi-evidence/index.ts",
    "./.pi/extensions/scoutpi-triggers/index.ts",
    "./.pi/extensions/scoutpi-governance/index.ts",
    "./.pi/extensions/scoutpi-observability/index.ts",
    "./.pi/extensions/scoutpi-checkpoint/index.ts",
    "./.pi/extensions/scoutpi-earth/index.ts",
  ]);
  assert.deepEqual(packageJson.pi.skills, ["./.pi/skills/scoutpi-earth-investigation"]);

  await assert.rejects(() => readFile(resolve(".pi/extensions/scoutpi-memory/index.ts"), "utf8"), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
});
