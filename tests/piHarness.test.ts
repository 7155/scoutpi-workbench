import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compactPiHarnessError, emptyPiHarnessWorkspaceOutcome, sanitizePiHarnessEvents, scorePiHarnessCase, sumPiHarnessUsage, summarizePiHarnessScores, type PiHarnessCase } from "../harness/pi/scorers.ts";

const cases = JSON.parse(await readFile(new URL("../harness/pi/cases/index.json", import.meta.url), "utf8")) as PiHarnessCase[];

test("Pi RPC harness ships ten bounded natural-language regression cases", () => {
  assert.equal(cases.length, 10);
  assert.equal(new Set(cases.map((item) => item.caseId)).size, cases.length);
  assert.equal(cases.every((item) => item.prompt.length > 30 && item.expectedOperations.length > 0), true);
  assert.equal(cases.every((item) => item.requiresSkillRead === true), true);
  assert.equal(cases.every((item) => Number.isFinite(item.maxToolCalls) && Number.isFinite(item.maxTurns) && Number.isFinite(item.maxTotalTokens)), true);
  assert.equal(cases.filter((item) => item.metricTags?.includes("plan")).length, 6);
  assert.equal(cases.filter((item) => item.metricTags?.includes("artifact")).length, 5);
  assert.equal(cases.some((item) => item.caseId === "large-export-user-denial" && item.allowApprovals === false), true);
  assert.deepEqual(cases.find((item) => item.caseId === "large-export-user-denial")?.expectedDeniedOperations, ["export_local"]);
  assert.equal(cases.find((item) => item.caseId === "adapter-band-probe-failure")?.workspaceExpectations?.minAdapterProbesFailed, 1);
  assert.equal(cases.some((item) => item.caseId === "proxy-overclaim-review" && item.forbiddenClaims.length > 0), true);
});

test("Pi RPC scorer detects missing tools, unsupported claims and approval bypass", () => {
  const fixture: PiHarnessCase = { caseId: "fixture", prompt: "fixture", expectedOperations: ["plan", "export_local"], forbiddenClaims: ["GDP increased"], allowApprovals: false };
  const events = [
    { type: "tool_execution_start", toolCallId: "plan-1", toolName: "earth_workspace", args: { op: "plan" } },
    { type: "tool_execution_end", toolCallId: "plan-1", toolName: "earth_workspace", result: { ok: true }, isError: false },
    { type: "tool_execution_start", toolCallId: "export-1", toolName: "earth_workspace", args: { op: "export_local" } },
    { type: "tool_execution_end", toolCallId: "export-1", toolName: "earth_workspace", result: { state: "queued" }, isError: false },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "GDP increased" }] } },
    { type: "agent_end" },
  ];
  const score = scorePiHarnessCase(fixture, events, []);
  assert.deepEqual(score.missingOperations, []);
  assert.deepEqual(score.forbiddenClaims, ["GDP increased"]);
  assert.equal(score.approvalBypass, true);
  assert.equal(score.passed, false);
});

test("Pi RPC scorer treats a denied high-risk operation as blocked rather than bypassed", () => {
  const fixture: PiHarnessCase = {
    caseId: "denial",
    prompt: "fixture",
    expectedOperations: ["export_local"],
    expectedDeniedOperations: ["export_local"],
    forbiddenClaims: [],
    allowApprovals: false,
    workspaceExpectations: { maxJobs: 0 },
  };
  const events = [
    { type: "tool_execution_start", toolCallId: "export-1", toolName: "earth_workspace", args: { op: "export_local" } },
    { type: "tool_execution_end", toolCallId: "export-1", toolName: "earth_workspace", result: { code: "APPROVAL_DENIED" }, isError: true },
    { type: "agent_end" },
  ];
  const approvals = [{ title: "approval", message: "", operation: "export_local", confirmed: false }];
  const score = scorePiHarnessCase(fixture, events, approvals);
  assert.equal(score.approvalBypass, false);
  assert.deepEqual(score.deniedOperations, ["export_local"]);
  assert.deepEqual(score.missingDeniedOperations, []);
  assert.equal(score.passed, true);
});

test("Pi RPC scorer enforces per-case turn, tool and token budgets", () => {
  const fixture: PiHarnessCase = { caseId: "budget", prompt: "fixture", expectedOperations: ["plan"], forbiddenClaims: [], allowApprovals: false, maxToolCalls: 1, maxTurns: 1, maxTotalTokens: 10 };
  const events = [
    { type: "turn_start" },
    { type: "turn_start" },
    { type: "tool_execution_start", toolName: "earth_workspace", args: { op: "plan" } },
    { type: "tool_execution_start", toolName: "earth_workspace", args: { op: "status" } },
    { type: "message_end", message: { role: "assistant", content: [], usage: { input: 8, output: 7, totalTokens: 15, cost: { total: 0.01 } } } },
    { type: "agent_end" },
  ];
  const score = scorePiHarnessCase(fixture, events, []);
  assert.deepEqual(score.budgetExceeded, ["tool_calls 2>1", "turns 2>1", "tokens 15>10"]);
  assert.equal(score.usage.reportedCostUsd, 0.01);
  assert.equal(score.passed, false);
});

test("Pi RPC scorer requires persisted workspace outcomes, not tool-call intent alone", () => {
  const fixture: PiHarnessCase = {
    caseId: "outcome",
    prompt: "fixture",
    expectedOperations: ["plan", "run"],
    requiredSuccessfulOperations: ["plan", "run"],
    forbiddenOperations: ["run:live"],
    forbiddenClaims: [],
    allowApprovals: false,
    metricTags: ["plan", "artifact"],
    workspaceExpectations: { minPlans: 1, minCompletedDryRuns: 1, maxLiveJobs: 0, minArtifacts: 1 },
  };
  const events = [
    { type: "tool_execution_start", toolCallId: "p", toolName: "earth_workspace", args: { op: "plan" } },
    { type: "tool_execution_end", toolCallId: "p", toolName: "earth_workspace", result: { planId: "p1" }, isError: false },
    { type: "tool_execution_start", toolCallId: "r", toolName: "earth_workspace", args: { op: "run", options: { mode: "dry_run" } } },
    { type: "tool_execution_end", toolCallId: "r", toolName: "earth_workspace", result: { jobId: "j1" }, isError: false },
    { type: "agent_end" },
  ];
  const missing = scorePiHarnessCase(fixture, events, []);
  assert.deepEqual(missing.workspaceFailures, ["plans 0<1", "completed_dry_runs 0<1", "artifacts 0<1"]);
  assert.equal(missing.passed, false);

  const persisted = scorePiHarnessCase(fixture, events, [], undefined, { ...emptyPiHarnessWorkspaceOutcome(), plans: 1, jobs: 1, completedDryRuns: 1, artifacts: 1 });
  assert.deepEqual(persisted.workspaceFailures, []);
  assert.equal(persisted.passed, true);
});

test("Pi RPC traces preserve metrics and hashes without persisting prompt, arguments or assistant text", () => {
  const secret = "private-harness-secret-value";
  const skillPath = "/tmp/private-person/scoutpi-earth-investigation/SKILL.md";
  const assistantText = `private answer ${secret}`;
  const events = [
    { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: `streaming ${secret}` }] } },
    { type: "tool_execution_start", toolCallId: "read-skill", toolName: "read", args: { path: skillPath } },
    { type: "tool_execution_start", toolCallId: "call-private", toolName: "earth_workspace", args: { op: "plan", payload: { question: `private ${secret}` } } },
    { type: "tool_execution_end", toolCallId: "call-private", toolName: "earth_workspace", result: { path: "/private/user/path", text: secret }, isError: false },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: assistantText }], stopReason: "error", errorMessage: `MODEL_NOT_FOUND ${secret}`, usage: { input: 12, output: 4, totalTokens: 16 } } },
  ];
  const trace = sanitizePiHarnessEvents(events);
  const serialized = JSON.stringify(trace);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("private answer"), false);
  assert.equal(serialized.includes("/private/user/path"), false);
  assert.equal(serialized.includes(skillPath), false);
  assert.equal(trace.length, 4);
  assert.equal(trace[0]?.toolName, "read");
  assert.equal(trace[0]?.resource, "skill");
  assert.equal(trace[1]?.operation, "plan");
  assert.equal(trace[3]?.contentChars, assistantText.length);
  assert.equal(trace[3]?.usage?.totalTokens, 16);
  assert.equal(trace[3]?.stopReason, "error");
  assert.equal(trace[3]?.errorCode, "MODEL_NOT_FOUND");
  assert.match(trace[1]?.payloadSha256 || "", /^[a-f0-9]{64}$/);
});

test("Pi RPC traces retain only a compact error code for failed domain tools", () => {
  const secret = "private-spec-value";
  const events = [
    { type: "tool_execution_start", toolCallId: "p", toolName: "earth_workspace", args: { op: "plan" } },
    { type: "tool_execution_end", toolCallId: "p", toolName: "earth_workspace", result: { content: [{ type: "text", text: `INVESTIGATION_SPEC_INVALID ${secret}` }] }, isError: true },
    { type: "agent_end" },
  ];
  const trace = sanitizePiHarnessEvents(events);
  const serialized = JSON.stringify(trace);
  assert.equal(serialized.includes(secret), false);
  assert.equal(trace[1]?.errorCode, "INVESTIGATION_SPEC_INVALID");
  const score = scorePiHarnessCase({ caseId: "tool-error", prompt: "fixture", expectedOperations: ["plan"], forbiddenClaims: [], allowApprovals: false }, events, []);
  assert.deepEqual(score.failedOperations, ["plan"]);
  assert.equal(score.toolErrors[0]?.code, "INVESTIGATION_SPEC_INVALID");
  assert.equal(JSON.stringify(score.toolErrors).includes(secret), false);
  assert.equal(compactPiHarnessError("429 insufficient_quota for private account").code, "QUOTA_EXCEEDED");
});

test("Pi RPC usage aggregation includes failed pre-score runs", () => {
  const usage = sumPiHarnessUsage([
    { inputTokens: 10, outputTokens: 2, totalTokens: 12, reportedCostUsd: 0.01 },
    undefined,
    { inputTokens: 5, cacheReadTokens: 8, totalTokens: 13, reportedCostUsd: 0.02 },
  ]);
  assert.deepEqual(usage, {
    inputTokens: 15,
    outputTokens: 2,
    cacheReadTokens: 8,
    cacheWriteTokens: 0,
    totalTokens: 25,
    reportedCostUsd: 0.03,
  });
});

test("Pi RPC scorer requires the registered investigation skill to be read before domain tools", () => {
  const fixture: PiHarnessCase = {
    caseId: "skill-required",
    prompt: "fixture",
    expectedOperations: ["plan"],
    requiredSuccessfulOperations: ["plan"],
    forbiddenClaims: [],
    allowApprovals: false,
    requiresSkillRead: true,
    workspaceExpectations: { minPlans: 1 },
  };
  const domainEvents = [
    { type: "tool_execution_start", toolCallId: "p", toolName: "earth_workspace", args: { op: "plan" } },
    { type: "tool_execution_end", toolCallId: "p", toolName: "earth_workspace", result: {}, isError: false },
    { type: "agent_end" },
  ];
  const workspace = { ...emptyPiHarnessWorkspaceOutcome(), plans: 1 };
  const missingSkill = scorePiHarnessCase(fixture, domainEvents, [], undefined, workspace);
  assert.equal(missingSkill.skillRequired, true);
  assert.equal(missingSkill.skillRead, false);
  assert.equal(missingSkill.passed, false);

  const lateSkill = scorePiHarnessCase(fixture, [
    ...domainEvents.slice(0, -1),
    { type: "tool_execution_start", toolCallId: "s", toolName: "read", args: { path: "/isolated/skills/scoutpi-earth-investigation/SKILL.md" } },
    { type: "tool_execution_end", toolCallId: "s", toolName: "read", result: {}, isError: false },
    { type: "agent_end" },
  ], [], undefined, workspace);
  assert.equal(lateSkill.skillRead, false);
  assert.equal(lateSkill.passed, false);

  const withSkill = scorePiHarnessCase(fixture, [
    { type: "tool_execution_start", toolCallId: "s", toolName: "read", args: { path: "/isolated/skills/scoutpi-earth-investigation/SKILL.md" } },
    { type: "tool_execution_end", toolCallId: "s", toolName: "read", result: {}, isError: false },
    ...domainEvents,
  ], [], undefined, workspace);
  assert.equal(withSkill.skillRead, true);
  assert.equal(withSkill.passed, true);
});

test("Pi RPC aggregate reports rates with explicit zero-denominator semantics", () => {
  const fixture: PiHarnessCase = { caseId: "aggregate", prompt: "fixture", expectedOperations: ["plan"], requiredSuccessfulOperations: ["plan"], forbiddenClaims: [], allowApprovals: false, requiresSkillRead: true, metricTags: ["plan"] };
  const events = [
    { type: "tool_execution_start", toolCallId: "s", toolName: "read", args: { path: "/isolated/skills/scoutpi-earth-investigation/SKILL.md" } },
    { type: "tool_execution_end", toolCallId: "s", toolName: "read", result: {}, isError: false },
    { type: "tool_execution_start", toolCallId: "p", toolName: "earth_workspace", args: { op: "plan" } },
    { type: "tool_execution_end", toolCallId: "p", toolName: "earth_workspace", result: {}, isError: false },
    { type: "message_end", message: { role: "assistant", content: [], usage: { input: 10, output: 2, totalTokens: 12 } } },
    { type: "agent_end" },
  ];
  const score = scorePiHarnessCase(fixture, events, [], undefined, { ...emptyPiHarnessWorkspaceOutcome(), plans: 1 });
  const summary = summarizePiHarnessScores([score]);
  assert.deepEqual(summary.taskCompletionRate, { passed: 1, total: 1, rate: 1 });
  assert.deepEqual(summary.validPlanRate, { passed: 1, total: 1, rate: 1 });
  assert.deepEqual(summary.evidenceCoverageRate, { passed: 0, total: 0, rate: null });
  assert.deepEqual(summary.skillUseRate, { passed: 1, total: 1, rate: 1 });
  assert.equal(summary.inputTokensPerTask, 10);
  assert.equal(summary.humanApprovalBypassRate.rate, 0);
});
