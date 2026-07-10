import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type ApprovalRisk = "medium" | "high";

export interface RuntimeApproval {
  schemaVersion: "scoutpi.runtime.approval.v1";
  approvalId: string;
  toolCallId: string;
  operation: string;
  risk: ApprovalRisk;
  approvedBy: "user";
  approvedAt: string;
  expiresAt: string;
  state: "pending" | "consumed";
  parametersHash: string;
  summary: string;
  adapterFingerprints: string[];
  limits?: { maxPixels?: number; maxBytes?: number };
  consumedAt?: string;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (["approvalId", "confirmed", "confirmedBlockingChecks"].includes(key)) continue;
    output[key] = canonical((value as Record<string, unknown>)[key]);
  }
  return output;
}

export function approvalParametersHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(input))).digest("hex");
}

export function earthOperationRisk(input: Record<string, unknown>): ApprovalRisk | undefined {
  const op = String(input.op || "");
  const options = input.options && typeof input.options === "object" && !Array.isArray(input.options) ? input.options as Record<string, unknown> : {};
  if (op === "run" && options.mode === "live") return "high";
  if (["export", "export_local", "skill_publish", "adapter_enable"].includes(op)) return "high";
  if (["retry", "workflow_replay"].includes(op)) return "medium";
  if (op === "workflow_compile" && options.confirmedBlockingChecks === true) return "high";
  return undefined;
}

export class ApprovalStore {
  readonly root: string;
  readonly directory: string;
  readonly eventPath: string;

  constructor(workspaceRoot: string) {
    this.root = resolve(workspaceRoot);
    this.directory = join(this.root, "approvals");
    this.eventPath = join(this.root, "approval_events.jsonl");
  }

  async init(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  async issue(input: {
    toolCallId: string;
    operation: string;
    risk: ApprovalRisk;
    parameters: Record<string, unknown>;
    summary: string;
    adapterFingerprints?: string[];
    limits?: RuntimeApproval["limits"];
    ttlMs?: number;
  }): Promise<RuntimeApproval> {
    await this.init();
    if (!/^earth_workspace:[a-z][a-z0-9_]{1,63}$/.test(input.operation)) throw Object.assign(new Error("APPROVAL_OPERATION_INVALID"), { code: "APPROVAL_OPERATION_INVALID" });
    if (!input.toolCallId || input.toolCallId.length > 160 || !input.summary.trim() || input.summary.length > 4_000) throw Object.assign(new Error("APPROVAL_INPUT_INVALID"), { code: "APPROVAL_INPUT_INVALID" });
    const now = Date.now();
    const approval: RuntimeApproval = {
      schemaVersion: "scoutpi.runtime.approval.v1",
      approvalId: `approval_${randomUUID()}`,
      toolCallId: input.toolCallId,
      operation: input.operation,
      risk: input.risk,
      approvedBy: "user",
      approvedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + Math.max(10_000, Math.min(input.ttlMs ?? 5 * 60_000, 30 * 60_000))).toISOString(),
      state: "pending",
      parametersHash: approvalParametersHash(input.parameters),
      summary: input.summary.trim(),
      adapterFingerprints: [...new Set(input.adapterFingerprints || [])].filter((value) => /^[a-f0-9]{64}$/.test(value)),
      limits: input.limits,
    };
    await writeFile(join(this.directory, `${approval.approvalId}.json`), `${JSON.stringify(approval, null, 2)}\n`, { flag: "wx" });
    await appendFile(this.eventPath, `${JSON.stringify({ event: "approval_issued", approvalId: approval.approvalId, toolCallId: approval.toolCallId, operation: approval.operation, risk: approval.risk, at: approval.approvedAt })}\n`);
    return approval;
  }

  async consume(approvalId: string, input: { toolCallId: string; operation: string; parameters: Record<string, unknown> }): Promise<RuntimeApproval> {
    if (!/^approval_[a-f0-9-]{36}$/.test(approvalId || "")) throw Object.assign(new Error("GOVERNANCE_APPROVAL_REQUIRED"), { code: "GOVERNANCE_APPROVAL_REQUIRED" });
    const path = join(this.directory, `${approvalId}.json`);
    let approval: RuntimeApproval;
    try { approval = JSON.parse(await readFile(path, "utf8")) as RuntimeApproval; }
    catch { throw Object.assign(new Error("GOVERNANCE_APPROVAL_NOT_FOUND"), { code: "GOVERNANCE_APPROVAL_NOT_FOUND" }); }
    const expectedHash = approvalParametersHash(input.parameters);
    if (approval.schemaVersion !== "scoutpi.runtime.approval.v1" || approval.state !== "pending") throw Object.assign(new Error("GOVERNANCE_APPROVAL_ALREADY_USED"), { code: "GOVERNANCE_APPROVAL_ALREADY_USED" });
    if (approval.toolCallId !== input.toolCallId || approval.operation !== input.operation || approval.parametersHash !== expectedHash) throw Object.assign(new Error("GOVERNANCE_APPROVAL_MISMATCH"), { code: "GOVERNANCE_APPROVAL_MISMATCH" });
    if (Date.parse(approval.expiresAt) <= Date.now()) throw Object.assign(new Error("GOVERNANCE_APPROVAL_EXPIRED"), { code: "GOVERNANCE_APPROVAL_EXPIRED" });
    approval.state = "consumed";
    approval.consumedAt = new Date().toISOString();
    await writeFile(path, `${JSON.stringify(approval, null, 2)}\n`);
    await appendFile(this.eventPath, `${JSON.stringify({ event: "approval_consumed", approvalId, toolCallId: approval.toolCallId, operation: approval.operation, at: approval.consumedAt })}\n`);
    return approval;
  }

  async list(limit = 100): Promise<RuntimeApproval[]> {
    await this.init();
    const rows: RuntimeApproval[] = [];
    for (const name of (await readdir(this.directory)).filter((value) => value.endsWith(".json")).sort().reverse().slice(0, Math.max(1, Math.min(1_000, limit)))) {
      try { rows.push(JSON.parse(await readFile(join(this.directory, name), "utf8")) as RuntimeApproval); } catch {}
    }
    return rows.sort((a, b) => b.approvedAt.localeCompare(a.approvedAt));
  }
}
