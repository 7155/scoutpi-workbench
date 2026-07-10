import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { scorePiHarnessCase, type PiHarnessCase } from "../harness/pi/scorers.ts";

const cases = JSON.parse(await readFile(new URL("../harness/pi/cases/index.json", import.meta.url), "utf8")) as PiHarnessCase[];

test("Pi RPC harness ships ten bounded natural-language regression cases", () => {
  assert.equal(cases.length, 10);
  assert.equal(new Set(cases.map((item) => item.caseId)).size, cases.length);
  assert.equal(cases.every((item) => item.prompt.length > 30 && item.expectedOperations.length > 0), true);
  assert.equal(cases.some((item) => item.caseId === "large-export-user-denial" && item.allowApprovals === false), true);
  assert.equal(cases.some((item) => item.caseId === "proxy-overclaim-review" && item.forbiddenClaims.length > 0), true);
});

test("Pi RPC scorer detects missing tools, unsupported claims and approval bypass", () => {
  const fixture: PiHarnessCase = { caseId: "fixture", prompt: "fixture", expectedOperations: ["plan", "export_local"], forbiddenClaims: ["GDP increased"], allowApprovals: false };
  const events = [
    { type: "tool_execution_start", toolName: "earth_workspace", args: { op: "plan" } },
    { type: "tool_execution_start", toolName: "earth_workspace", args: { op: "export_local" } },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "GDP increased" }] } },
    { type: "agent_end" },
  ];
  const score = scorePiHarnessCase(fixture, events, []);
  assert.deepEqual(score.missingOperations, []);
  assert.deepEqual(score.forbiddenClaims, ["GDP increased"]);
  assert.equal(score.approvalBypass, true);
  assert.equal(score.passed, false);
});
