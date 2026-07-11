import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { chmod, link, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { EarthWorkflowReplayRecord } from "../../earth-workflow-compiler/src/index.ts";
import { EarthWorkspace } from "../../earth-workspace/src/index.ts";

export type RuntimePrincipalKind = "human" | "pi" | "service";
export type TriggerState = "draft" | "active" | "paused" | "revoked";
export type TriggerRunState = "running" | "completed" | "failed" | "blocked";

export interface RuntimePrincipal {
  principalId: string;
  kind: RuntimePrincipalKind;
  displayName: string;
}

export type TriggerCondition =
  | { kind: "manual" }
  | { kind: "interval"; everyMinutes: number }
  | { kind: "event"; eventName: string };

export interface WorkflowTrigger {
  schemaVersion: "scoutpi.runtime.trigger.v1";
  triggerId: string;
  name: string;
  workflowId: string;
  state: TriggerState;
  condition: TriggerCondition;
  subject: RuntimePrincipal;
  limits: {
    maxRuns: number;
    cooldownSeconds: number;
    expiresAt: string;
  };
  grantId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DelegationGrant {
  schemaVersion: "scoutpi.runtime.delegation.v1";
  grantId: string;
  triggerId: string;
  workflowId: string;
  triggerFingerprint: string;
  issuer: RuntimePrincipal;
  subject: RuntimePrincipal;
  scopes: ["workflow:replay:dry_run"];
  issuedAt: string;
  expiresAt: string;
  maxRuns: number;
  usedRuns: number;
  state: "active" | "exhausted" | "expired" | "revoked";
  signature: string;
}

export interface TriggerRun {
  schemaVersion: "scoutpi.runtime.trigger-run.v1";
  runId: string;
  triggerId: string;
  workflowId: string;
  grantId: string;
  eventKey: string;
  state: TriggerRunState;
  startedAt: string;
  updatedAt: string;
  replayId?: string;
  planId?: string;
  jobId?: string;
  error?: string;
}

export interface TriggerEventReceipt {
  schemaVersion: "scoutpi.runtime.trigger-event.v1";
  eventId: string;
  eventName: string;
  occurredAt: string;
  acceptedAt: string;
  payloadSha256: string;
  payloadBytes: number;
  triggerIds: string[];
}

type TriggerDraftInput = {
  triggerId?: string;
  name: string;
  workflowId: string;
  condition: TriggerCondition;
  subject?: Partial<RuntimePrincipal>;
  limits?: Partial<WorkflowTrigger["limits"]>;
};

function fail(message: string, code: string): never {
  throw Object.assign(new Error(message), { code });
}

function safeId(value: unknown, label: string, max = 120): string {
  if (typeof value !== "string" || !new RegExp(`^[A-Za-z0-9][A-Za-z0-9._:-]{1,${max - 1}}$`).test(value) || value.includes("..")) fail(`${label} is invalid`, "TRIGGER_INPUT_INVALID");
  return value;
}

function cleanText(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string") fail(`${label} must be text`, "TRIGGER_INPUT_INVALID");
  const text = value.replace(/\0/g, "").replace(/\s+/g, " ").trim();
  if (!text || text.length > max) fail(`${label} is invalid`, "TRIGGER_INPUT_INVALID");
  if (/(?:\bsk-[A-Za-z0-9_-]{10,}|\bBearer\s+\S{12,}|(?:password|secret|token)\s*[:=]\s*\S{6,})/i.test(text)) fail(`${label} looks like secret material`, "TRIGGER_SECRET_REJECTED");
  return text;
}

function finiteInt(value: unknown, fallback: number, min: number, max: number, label: string): number {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) fail(`${label} is invalid`, "TRIGGER_INPUT_INVALID");
  return number;
}

function futureDate(value: unknown, fallbackMs: number, maxMs: number): string {
  const now = Date.now();
  const timestamp = typeof value === "string" ? Date.parse(value) : now + fallbackMs;
  if (!Number.isFinite(timestamp) || timestamp <= now || timestamp > now + maxMs) fail("trigger expiry is invalid", "TRIGGER_INPUT_INVALID");
  return new Date(timestamp).toISOString();
}

function principal(input: Partial<RuntimePrincipal> | undefined, fallback: RuntimePrincipal): RuntimePrincipal {
  return {
    principalId: input?.principalId ? safeId(input.principalId, "principalId", 100) : fallback.principalId,
    kind: input?.kind && ["human", "pi", "service"].includes(input.kind) ? input.kind : fallback.kind,
    displayName: input?.displayName ? cleanText(input.displayName, "principal display name", 120) : fallback.displayName,
  };
}

function condition(input: TriggerCondition): TriggerCondition {
  if (!input || typeof input !== "object") fail("trigger condition is required", "TRIGGER_INPUT_INVALID");
  if (input.kind === "manual") return { kind: "manual" };
  if (input.kind === "interval") return { kind: "interval", everyMinutes: finiteInt(input.everyMinutes, 60, 1, 10_080, "interval minutes") };
  if (input.kind === "event") return { kind: "event", eventName: safeId(input.eventName, "eventName", 100) };
  return fail("trigger condition is invalid", "TRIGGER_INPUT_INVALID");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (key === "signature") continue;
    output[key] = canonical((value as Record<string, unknown>)[key]);
  }
  return output;
}

function payloadHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function triggerFingerprint(trigger: WorkflowTrigger): string {
  return payloadHash({ triggerId: trigger.triggerId, workflowId: trigger.workflowId, subject: trigger.subject, condition: trigger.condition, limits: trigger.limits });
}

function boundedError(value: unknown): string {
  const text = String(value ?? "Unknown trigger failure").replace(/\0/g, "").replace(/(?:\bsk-[A-Za-z0-9_-]{6,}|\bBearer\s+\S+|(?:password|secret|token)\s*[:=]\s*\S+)/gi, "[redacted]").replace(/\s+/g, " ").trim();
  return text.slice(0, 500) || "Unknown trigger failure";
}

async function atomicWrite(path: string, value: unknown, exclusive = false): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  try {
    if (exclusive) {
      await link(temporary, path);
      await unlink(temporary);
    } else await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function runState(replay: EarthWorkflowReplayRecord): TriggerRunState {
  if (replay.state === "completed") return "completed";
  if (replay.state === "blocked") return "blocked";
  if (replay.state === "failed" || replay.state === "cancelled") return "failed";
  return "running";
}

export class TriggerRuntime {
  readonly root: string;
  readonly triggersDirectory: string;
  readonly grantsDirectory: string;
  readonly runsDirectory: string;
  readonly eventsDirectory: string;
  readonly locksDirectory: string;
  readonly workspace: EarthWorkspace;
  private readonly keyPath: string;
  private readonly leasePath: string;
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(workspace: EarthWorkspace, root = process.env.SCOUTPI_TRIGGER_ROOT ?? join(dirname(workspace.root), "triggers")) {
    this.workspace = workspace;
    this.root = resolve(root);
    this.triggersDirectory = join(this.root, "definitions");
    this.grantsDirectory = join(this.root, "grants");
    this.runsDirectory = join(this.root, "runs");
    this.eventsDirectory = join(this.root, "events");
    this.locksDirectory = join(this.root, "locks");
    this.keyPath = join(this.root, "delegation.key");
    this.leasePath = join(this.root, "supervisor.lease.json");
  }

  async init(): Promise<void> {
    await Promise.all([this.root, this.triggersDirectory, this.grantsDirectory, this.runsDirectory, this.eventsDirectory, this.locksDirectory].map((path) => mkdir(path, { recursive: true })));
    try { await writeFile(this.keyPath, randomBytes(32).toString("base64url"), { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    await chmod(this.keyPath, 0o600).catch(() => undefined);
  }

  async createDraft(input: TriggerDraftInput): Promise<WorkflowTrigger> {
    await this.init();
    const now = new Date().toISOString();
    const triggerId = input.triggerId ? safeId(input.triggerId, "triggerId") : `trigger_${randomUUID()}`;
    const workflowId = safeId(input.workflowId, "workflowId");
    await this.workspace.getWorkflow(workflowId);
    const trigger: WorkflowTrigger = {
      schemaVersion: "scoutpi.runtime.trigger.v1",
      triggerId,
      name: cleanText(input.name, "trigger name", 160),
      workflowId,
      state: "draft",
      condition: condition(input.condition),
      subject: principal(input.subject, { principalId: `service:${triggerId}`, kind: "service", displayName: input.name }),
      limits: {
        maxRuns: finiteInt(input.limits?.maxRuns, 30, 1, 1_000, "maxRuns"),
        cooldownSeconds: finiteInt(input.limits?.cooldownSeconds, 60, 0, 86_400, "cooldownSeconds"),
        expiresAt: futureDate(input.limits?.expiresAt, 30 * 24 * 60 * 60_000, 365 * 24 * 60 * 60_000),
      },
      createdAt: now,
      updatedAt: now,
    };
    await atomicWrite(join(this.triggersDirectory, `${triggerId}.json`), trigger, true);
    return trigger;
  }

  async approve(triggerId: string, issuerInput?: Partial<RuntimePrincipal>): Promise<{ trigger: WorkflowTrigger; grant: DelegationGrant }> {
    const trigger = await this.getTrigger(triggerId);
    if (trigger.state !== "draft" && trigger.state !== "paused") fail("only a draft or paused trigger can be approved", "TRIGGER_STATE_INVALID");
    const stored = await this.workspace.getWorkflow(trigger.workflowId);
    if (stored.stage !== "ready") fail("trigger workflow must be promoted to ready", "TRIGGER_WORKFLOW_NOT_READY");
    if (stored.workflow.execution.kind !== "run" || stored.workflow.execution.mode !== "dry_run") fail("automatic triggers currently allow dry-run workflows only", "TRIGGER_SCOPE_BLOCKED");
    if (trigger.grantId) {
      const previous = await this.getGrant(trigger.grantId);
      previous.state = "revoked";
      previous.signature = await this.sign(previous);
      await atomicWrite(join(this.grantsDirectory, `${previous.grantId}.json`), previous);
    }
    const issuedAt = new Date().toISOString();
    const grantWithoutSignature: Omit<DelegationGrant, "signature"> = {
      schemaVersion: "scoutpi.runtime.delegation.v1",
      grantId: `grant_${randomUUID()}`,
      triggerId: trigger.triggerId,
      workflowId: trigger.workflowId,
      triggerFingerprint: triggerFingerprint(trigger),
      issuer: principal(issuerInput, { principalId: "local-operator", kind: "human", displayName: "Local operator" }),
      subject: trigger.subject,
      scopes: ["workflow:replay:dry_run"],
      issuedAt,
      expiresAt: trigger.limits.expiresAt,
      maxRuns: trigger.limits.maxRuns,
      usedRuns: 0,
      state: "active",
    };
    const grant: DelegationGrant = { ...grantWithoutSignature, signature: await this.sign(grantWithoutSignature) };
    trigger.state = "active";
    trigger.grantId = grant.grantId;
    trigger.updatedAt = issuedAt;
    await atomicWrite(join(this.grantsDirectory, `${grant.grantId}.json`), grant, true);
    await atomicWrite(join(this.triggersDirectory, `${trigger.triggerId}.json`), trigger);
    return { trigger, grant };
  }

  async setState(triggerId: string, state: "paused" | "active" | "revoked"): Promise<WorkflowTrigger> {
    const trigger = await this.getTrigger(triggerId);
    if (trigger.state === "revoked") fail("revoked triggers cannot be resumed", "TRIGGER_STATE_INVALID");
    if (state === "active") await this.verifyGrant(trigger);
    trigger.state = state;
    trigger.updatedAt = new Date().toISOString();
    await atomicWrite(join(this.triggersDirectory, `${trigger.triggerId}.json`), trigger);
    if (state === "revoked" && trigger.grantId) {
      const grant = await this.getGrant(trigger.grantId);
      grant.state = "revoked";
      grant.signature = await this.sign(grant);
      await atomicWrite(join(this.grantsDirectory, `${grant.grantId}.json`), grant);
    }
    return trigger;
  }

  async invoke(triggerId: string, idempotencyKey: string): Promise<{ run: TriggerRun; deduplicated: boolean }> {
    const safeTriggerId = safeId(triggerId, "triggerId");
    const eventKey = cleanText(idempotencyKey, "idempotency key", 200);
    return await this.serial(safeTriggerId, async () => await this.withTriggerLease(safeTriggerId, async () => await this.execute(safeTriggerId, eventKey)));
  }

  async dispatchEvent(input: { eventId: string; eventName: string; occurredAt?: string; payload?: unknown }): Promise<{ receipt: TriggerEventReceipt; duplicate: boolean; runs: TriggerRun[] }> {
    await this.init();
    const eventId = safeId(input.eventId, "eventId", 160);
    const eventName = safeId(input.eventName, "eventName", 100);
    const serialized = JSON.stringify(input.payload ?? null);
    if (Buffer.byteLength(serialized) > 64 * 1024) fail("event payload exceeds 64 KB", "TRIGGER_EVENT_TOO_LARGE");
    const matching = (await this.listTriggers()).filter((trigger) => trigger.state === "active" && trigger.condition.kind === "event" && trigger.condition.eventName === eventName);
    const receipt: TriggerEventReceipt = {
      schemaVersion: "scoutpi.runtime.trigger-event.v1",
      eventId,
      eventName,
      occurredAt: input.occurredAt && Number.isFinite(Date.parse(input.occurredAt)) ? new Date(input.occurredAt).toISOString() : new Date().toISOString(),
      acceptedAt: new Date().toISOString(),
      payloadSha256: createHash("sha256").update(serialized).digest("hex"),
      payloadBytes: Buffer.byteLength(serialized),
      triggerIds: matching.map((trigger) => trigger.triggerId).sort(),
    };
    let duplicate = false;
    try { await atomicWrite(join(this.eventsDirectory, `${eventId}.json`), receipt, true); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") duplicate = true; else throw error; }
    const stored = duplicate ? JSON.parse(await readFile(join(this.eventsDirectory, `${eventId}.json`), "utf8")) as TriggerEventReceipt : receipt;
    if (stored.eventName !== eventName || stored.payloadSha256 !== receipt.payloadSha256) fail("eventId is already bound to different event content", "TRIGGER_EVENT_ID_COLLISION");
    const runs = await Promise.all(stored.triggerIds.map(async (triggerId) => (await this.invoke(triggerId, `event:${eventId}`)).run));
    return { receipt: stored, duplicate, runs };
  }

  async tick(now = Date.now(), ownerId = `supervisor:${process.pid}`): Promise<{ acquired: boolean; due: number; runs: TriggerRun[] }> {
    const lease = await this.acquireLease(ownerId, 30_000);
    if (!lease) return { acquired: false, due: 0, runs: [] };
    try {
      const due = (await this.listTriggers()).filter((trigger) => trigger.state === "active" && trigger.condition.kind === "interval" && Date.parse(trigger.limits.expiresAt) > now);
      const runs: TriggerRun[] = [];
      for (const trigger of due) {
        if (trigger.condition.kind !== "interval") continue;
        const slot = Math.floor(now / (trigger.condition.everyMinutes * 60_000));
        runs.push((await this.invoke(trigger.triggerId, `interval:${slot}`)).run);
      }
      return { acquired: true, due: due.length, runs };
    } finally { await this.releaseLease(lease.token); }
  }

  async getTrigger(triggerId: string): Promise<WorkflowTrigger> {
    await this.init();
    return JSON.parse(await readFile(join(this.triggersDirectory, `${safeId(triggerId, "triggerId")}.json`), "utf8")) as WorkflowTrigger;
  }

  async listTriggers(): Promise<WorkflowTrigger[]> {
    await this.init();
    const rows: WorkflowTrigger[] = [];
    for (const name of (await readdir(this.triggersDirectory)).filter((item) => item.endsWith(".json")).sort().reverse()) {
      try { rows.push(JSON.parse(await readFile(join(this.triggersDirectory, name), "utf8")) as WorkflowTrigger); } catch {}
    }
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listRuns(limit = 100): Promise<TriggerRun[]> {
    await this.init();
    const rows: TriggerRun[] = [];
    for (const name of (await readdir(this.runsDirectory)).filter((item) => item.endsWith(".json")).sort().reverse().slice(0, Math.max(1, Math.min(1_000, limit)))) {
      try { rows.push(JSON.parse(await readFile(join(this.runsDirectory, name), "utf8")) as TriggerRun); } catch {}
    }
    return rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async listGrants(limit = 100): Promise<DelegationGrant[]> {
    await this.init();
    const rows: DelegationGrant[] = [];
    for (const name of (await readdir(this.grantsDirectory)).filter((item) => item.endsWith(".json")).sort().reverse().slice(0, Math.max(1, Math.min(1_000, limit)))) {
      rows.push(await this.readVerifiedGrant(join(this.grantsDirectory, name)));
    }
    return rows.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  }

  private async execute(triggerId: string, eventKey: string): Promise<{ run: TriggerRun; deduplicated: boolean }> {
    const runId = `trigger_run_${payloadHash({ triggerId, eventKey }).slice(0, 24)}`;
    const path = join(this.runsDirectory, `${runId}.json`);
    try {
      const existing = JSON.parse(await readFile(path, "utf8")) as TriggerRun;
      return { run: existing, deduplicated: true };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const trigger = await this.getTrigger(triggerId);
    if (trigger.state !== "active") fail("trigger is not active", "TRIGGER_NOT_ACTIVE");
    const grant = await this.verifyGrant(trigger);
    const recent = (await this.listRuns(1_000)).find((run) => run.triggerId === triggerId && run.state !== "blocked");
    if (recent && trigger.limits.cooldownSeconds > 0 && Date.parse(recent.startedAt) + trigger.limits.cooldownSeconds * 1_000 > Date.now()) fail("trigger cooldown is active", "TRIGGER_COOLDOWN_ACTIVE");
    const now = new Date().toISOString();
    const run: TriggerRun = { schemaVersion: "scoutpi.runtime.trigger-run.v1", runId, triggerId, workflowId: trigger.workflowId, grantId: grant.grantId, eventKey, state: "running", startedAt: now, updatedAt: now };
    try { await atomicWrite(path, run, true); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return { run: JSON.parse(await readFile(path, "utf8")) as TriggerRun, deduplicated: true };
      throw error;
    }
    grant.usedRuns += 1;
    if (grant.usedRuns >= grant.maxRuns) grant.state = "exhausted";
    grant.signature = await this.sign(grant);
    await atomicWrite(join(this.grantsDirectory, `${grant.grantId}.json`), grant);
    try {
      const result = await this.workspace.replayWorkflow(trigger.workflowId, { confirmed: true });
      run.state = runState(result.replay);
      run.replayId = result.replay.replayId;
      run.planId = result.replay.planId;
      run.jobId = result.replay.jobId;
    } catch (error) {
      const code = String((error as { code?: string }).code || "");
      run.state = code.includes("REQUIRED") || code.includes("DRIFT") || code.includes("BLOCKED") ? "blocked" : "failed";
      run.error = boundedError((error as Error).message || String(error));
    }
    run.updatedAt = new Date().toISOString();
    await atomicWrite(path, run);
    if (grant.state === "exhausted") {
      trigger.state = "paused";
      trigger.updatedAt = run.updatedAt;
      await atomicWrite(join(this.triggersDirectory, `${trigger.triggerId}.json`), trigger);
    }
    return { run, deduplicated: false };
  }

  private async verifyGrant(trigger: WorkflowTrigger): Promise<DelegationGrant> {
    if (!trigger.grantId) fail("trigger has no delegation grant", "TRIGGER_GRANT_REQUIRED");
    const grant = await this.getGrant(trigger.grantId);
    if (grant.triggerId !== trigger.triggerId || grant.workflowId !== trigger.workflowId || grant.subject.principalId !== trigger.subject.principalId || grant.triggerFingerprint !== triggerFingerprint(trigger)) fail("delegation does not match trigger identity or definition", "TRIGGER_GRANT_MISMATCH");
    if (Date.parse(grant.expiresAt) <= Date.now()) {
      grant.state = "expired";
      grant.signature = await this.sign(grant);
      await atomicWrite(join(this.grantsDirectory, `${grant.grantId}.json`), grant);
      fail("delegation grant expired", "TRIGGER_GRANT_EXPIRED");
    }
    if (grant.state !== "active" || grant.usedRuns >= grant.maxRuns) fail("delegation grant is not active", "TRIGGER_GRANT_EXHAUSTED");
    return grant;
  }

  private async getGrant(grantId: string): Promise<DelegationGrant> {
    return await this.readVerifiedGrant(join(this.grantsDirectory, `${safeId(grantId, "grantId")}.json`));
  }

  private async readVerifiedGrant(path: string): Promise<DelegationGrant> {
    const grant = JSON.parse(await readFile(path, "utf8")) as DelegationGrant;
    const expected = await this.sign(grant);
    if (!grant.signature || grant.signature !== expected) fail("delegation grant integrity check failed", "TRIGGER_GRANT_INTEGRITY_FAILED");
    return grant;
  }

  private async sign(value: Omit<DelegationGrant, "signature"> | DelegationGrant): Promise<string> {
    await this.init();
    const key = (await readFile(this.keyPath, "utf8")).trim();
    return createHmac("sha256", key).update(JSON.stringify(canonical(value))).digest("hex");
  }

  private async serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.queues.set(key, current);
    try { return await current; }
    finally { if (this.queues.get(key) === current) this.queues.delete(key); }
  }

  private async withTriggerLease<T>(triggerId: string, operation: () => Promise<T>): Promise<T> {
    const path = join(this.locksDirectory, `${triggerId}.lease.json`);
    let lease: { ownerId: string; token: string; expiresAt: string } | undefined;
    for (let attempt = 0; attempt < 100 && !lease; attempt += 1) {
      lease = await this.acquireLeaseAt(path, `trigger:${process.pid}`, 10 * 60_000);
      if (!lease) await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
    if (!lease) fail("trigger is busy in another runtime process", "TRIGGER_BUSY");
    try { return await operation(); }
    finally { await this.releaseLeaseAt(path, lease.token); }
  }

  private async acquireLease(ownerId: string, ttlMs: number): Promise<{ ownerId: string; token: string; expiresAt: string } | undefined> {
    return await this.acquireLeaseAt(this.leasePath, ownerId, ttlMs);
  }

  private async acquireLeaseAt(path: string, ownerId: string, ttlMs: number): Promise<{ ownerId: string; token: string; expiresAt: string } | undefined> {
    await this.init();
    const lease = { ownerId: safeId(ownerId, "lease owner", 120), token: randomUUID(), expiresAt: new Date(Date.now() + ttlMs).toISOString() };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { await atomicWrite(path, lease, true); return lease; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await readFile(path, "utf8").then((text) => JSON.parse(text) as { expiresAt?: string }).catch(() => undefined);
        if (existing?.expiresAt && Date.parse(existing.expiresAt) > Date.now()) return undefined;
        await unlink(path).catch(() => undefined);
      }
    }
    return undefined;
  }

  private async releaseLease(token: string): Promise<void> {
    await this.releaseLeaseAt(this.leasePath, token);
  }

  private async releaseLeaseAt(path: string, token: string): Promise<void> {
    const existing = await readFile(path, "utf8").then((text) => JSON.parse(text) as { token?: string }).catch(() => undefined);
    if (existing?.token === token) await unlink(path).catch(() => undefined);
  }
}
