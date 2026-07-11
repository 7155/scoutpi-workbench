import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { formatPiEcosystemProfile, inspectPiEcosystem } from "../packages/pi-ecosystem/src/index.ts";

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
