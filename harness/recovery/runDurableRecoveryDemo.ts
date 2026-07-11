import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EarthWorkspace } from "../../packages/earth-workspace/src/index.ts";
import { AgentCheckpointStore, renderCheckpointResume } from "../../packages/runtime-checkpoint/src/index.ts";
import { EvaluationStore, type EvaluationReport } from "../../packages/runtime-evaluation/src/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const createdAt = new Date();
const runId = `recovery_${createdAt.toISOString().replace(/[^0-9]/g, "").slice(0, 17)}_${randomUUID().slice(0, 8)}`;
const runDir = join(root, "exports/recovery_runs", runId);
const earthRoot = join(runDir, "earth");
const checkpointRoot = join(runDir, "checkpoints");

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

await mkdir(join(earthRoot, "jobs", "earth_local_interrupted"), { recursive: true });
await mkdir(join(earthRoot, "jobs", "earth_remote_running"), { recursive: true });
const base = { planId: "plan-recovery-demo", mode: "live", state: "running", createdAt: createdAt.toISOString(), updatedAt: createdAt.toISOString() };
const localDir = join(earthRoot, "jobs", "earth_local_interrupted");
const remoteDir = join(earthRoot, "jobs", "earth_remote_running");
await writeFile(join(localDir, "job.json"), `${JSON.stringify({ ...base, jobId: "earth_local_interrupted", taskIds: [], artifactDir: localDir, result: { execution: "local_export" } }, null, 2)}\n`);
await writeFile(join(remoteDir, "job.json"), `${JSON.stringify({ ...base, jobId: "earth_remote_running", taskIds: ["remote-task-1"], artifactDir: remoteDir, result: { execution: "drive" } }, null, 2)}\n`);

const beforeRestart = new AgentCheckpointStore(checkpointRoot);
await beforeRestart.open("session-recovery-demo", { model: "provider/model" });
await beforeRestart.transition("session-recovery-demo", (checkpoint) => {
  checkpoint.state = "tool_running";
  checkpoint.active = { toolCallId: "call-recovery", toolName: "earth_workspace", operation: "export_local", targetId: "plan-recovery-demo", startedAt: createdAt.toISOString() };
  checkpoint.references = [
    { kind: "plan", id: "plan-recovery-demo", source: "tool.input" },
    { kind: "job", id: "earth_local_interrupted", source: "tool.result" },
  ];
  checkpoint.recovery = { recoverable: true, nextAction: "Inspect persisted job status before retrying." };
});

const restartStarted = performance.now();
const restartedWorkspace = new EarthWorkspace(earthRoot);
const restartedCheckpointStore = new AgentCheckpointStore(checkpointRoot);
const recovered = await restartedWorkspace.recoverInterruptedJobs();
const checkpoint = await restartedCheckpointStore.get("session-recovery-demo");
const local = await restartedWorkspace.status("earth_local_interrupted");
const remote = await restartedWorkspace.status("earth_remote_running");
const resume = renderCheckpointResume(checkpoint);
const restartElapsedMs = Math.round((performance.now() - restartStarted) * 100) / 100;

const checks = [
  { checkId: "local_export_recovered", label: "Detached local export becomes retryable", status: local.state === "failed" && (local.result?.recovery as any)?.retryable === true ? "passed" as const : "failed" as const, detail: `state=${local.state}` },
  { checkId: "remote_task_preserved", label: "Remote provider task is not duplicated", status: remote.state === "running" && remote.taskIds.length === 1 ? "passed" as const : "failed" as const, detail: `state=${remote.state}` },
  { checkId: "checkpoint_integrity", label: "Checkpoint survives restart with durable references", status: checkpoint.recovery.recoverable && checkpoint.references.length === 2 ? "passed" as const : "failed" as const, detail: `${checkpoint.references.length} references` },
  { checkId: "resume_guard", label: "Resume instructs Pi to inspect before retry", status: /do not assume it completed|Inspect persisted status/i.test(resume) ? "passed" as const : "failed" as const, detail: "No blind repeat of the interrupted state change" },
  { checkId: "single_recovery", label: "Only the detached local job is recovered", status: recovered.jobIds.length === 1 && recovered.jobIds[0] === "earth_local_interrupted" ? "passed" as const : "failed" as const, detail: `${recovered.recovered} recovered job` },
];
const state = checks.every((check) => check.status === "passed") ? "passed" as const : "failed" as const;
const report = {
  schemaVersion: "scoutpi.recovery-demo.v1",
  runId,
  createdAt: createdAt.toISOString(),
  state,
  restartElapsedMs,
  outcomes: { recoveredJobs: recovered.recovered, localState: local.state, localRetryable: (local.result?.recovery as any)?.retryable === true, remoteState: remote.state, remoteTaskCount: remote.taskIds.length, checkpointReferences: checkpoint.references.length, checkpointRecoverable: checkpoint.recovery.recoverable },
  checks,
  privacy: { rawToolPayloadStored: false, credentialsStored: false },
};
const body = `${JSON.stringify(report, null, 2)}\n`;
await mkdir(runDir, { recursive: true });
await writeFile(join(runDir, "report.json"), body);
const evaluation: EvaluationReport = {
  schemaVersion: "scoutpi.evaluation.v1",
  evaluationId: runId,
  kind: "recovery",
  title: "Durable restart and recovery",
  state,
  createdAt: createdAt.toISOString(),
  summary: "A fresh runtime recovered a detached local export without duplicating the preserved remote task and restored a guarded checkpoint.",
  metrics: [
    { metricId: "restart_ms", label: "Restart recovery latency", value: restartElapsedMs, unit: "ms", direction: "lower_is_better" },
    { metricId: "recovered_jobs", label: "Recovered detached jobs", value: recovered.recovered, unit: "count", direction: "neutral" },
    { metricId: "preserved_remote_tasks", label: "Preserved remote tasks", value: remote.taskIds.length, unit: "count", direction: "higher_is_better" },
    { metricId: "checkpoint_refs", label: "Recovered checkpoint references", value: checkpoint.references.length, unit: "count", direction: "higher_is_better" },
  ],
  checks,
  privacy: { rawPromptStored: false, rawToolPayloadStored: false, credentialsStored: false, providerUrlStored: false },
  provenance: { source: "recovery-harness", command: "pnpm harness:recovery", sourceSha256: sha256(body) },
};
await new EvaluationStore(join(root, ".scoutpi/evaluations")).save(evaluation);
console.log(JSON.stringify({ ok: state === "passed", state, report: join(runDir, "report.json"), outcomes: report.outcomes }, null, 2));
if (state !== "passed") process.exitCode = 1;
