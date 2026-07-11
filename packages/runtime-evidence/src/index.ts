import { createHash, randomUUID } from "node:crypto";
import { copyFile, link, mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, delimiter, dirname, extname, join, resolve, sep } from "node:path";

export * from "./reviewer.ts";

export type BrowserEvidenceSourceType = "local_ui" | "public_webpage" | "docs" | "dataset_page";
export type BrowserEvidenceTrust = "high" | "medium" | "low";
export type EvidenceRelation = "supports" | "contradicts" | "contextualizes" | "documents";

export interface EvidenceBinding {
  investigationId: string;
  claimId: string;
  hypothesisId?: string;
  relation: EvidenceRelation;
}

export interface EvidenceArtifactRef {
  artifactId: string;
  kind: "screenshot" | "content";
  path: string;
  sha256: string;
  bytes: number;
  mediaType: string;
}

export interface BrowserEvidenceRecord {
  schemaVersion: "scoutpi.browser.evidence.v1";
  evidenceId: string;
  source: {
    url: string;
    title: string;
    capturedAt: string;
    sourceType: BrowserEvidenceSourceType;
    trust: BrowserEvidenceTrust;
  };
  claim: {
    text: string;
    timeReferences: string[];
    placeReferences: string[];
  };
  browser: {
    commandId?: string;
    runId?: string;
    snapshotId?: string;
  };
  binding?: EvidenceBinding;
  excerpt?: string;
  artifacts: EvidenceArtifactRef[];
  provenance: {
    importedAt: string;
    adapter: "browserbridge-evidence-card" | "canonical-v1";
    sourcePathHash: string;
    sourceFingerprint: string;
  };
  integrity: {
    payloadSha256: string;
  };
}

export interface EvidenceGraphNode {
  nodeId: string;
  kind: "browser_evidence" | "claim" | "hypothesis" | "computed_run" | "finding";
  label: string;
  status?: string;
  ref?: string;
  metadata?: Record<string, string | number | boolean | undefined>;
}

export interface EvidenceGraphEdge {
  edgeId: string;
  from: string;
  to: string;
  relation: EvidenceRelation | "documents" | "evaluates" | "computed_for";
}

export interface EvidenceGraph {
  schemaVersion: "scoutpi.evidence-graph.v1";
  graphId: string;
  investigationId: string;
  updatedAt: string;
  nodes: EvidenceGraphNode[];
  edges: EvidenceGraphEdge[];
  coverage: {
    browserEvidence: number;
    claims: number;
    computedRuns: number;
    hypotheses: number;
    coveredHypotheses: number;
    uncoveredHypothesisIds: string[];
  };
}

export interface EvidenceComputedRun {
  jobId: string;
  state: string;
  mode: string;
  hypothesisIds: string[];
  artifactCount?: number;
}

export interface EvidenceFinding {
  hypothesisId: string;
  status: string;
  evidenceCount: number;
}

interface BrowserBridgeEvidenceCard {
  evidenceId?: unknown;
  commandId?: unknown;
  url?: unknown;
  title?: unknown;
  capturedAt?: unknown;
  summary?: unknown;
  screenshotPath?: unknown;
  extractedText?: unknown;
  sourceType?: unknown;
  trust?: unknown;
}

const sourceTypes = new Set<BrowserEvidenceSourceType>(["local_ui", "public_webpage", "docs", "dataset_page"]);
const trusts = new Set<BrowserEvidenceTrust>(["high", "medium", "low"]);
const relations = new Set<EvidenceRelation>(["supports", "contradicts", "contextualizes", "documents"]);

function fail(message: string, code: string): never {
  throw Object.assign(new Error(message), { code });
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value) || value.includes("..")) fail(`${label} is invalid`, "EVIDENCE_ID_INVALID");
  return value;
}

function cleanText(value: unknown, max: number, label: string, required = true): string {
  if (typeof value !== "string") {
    if (!required && value === undefined) return "";
    fail(`${label} must be text`, "EVIDENCE_TEXT_INVALID");
  }
  const text = (value as string).replace(/\0/g, "").replace(/\s+/g, " ").trim();
  if ((required && !text) || text.length > max) fail(`${label} must be between ${required ? 1 : 0} and ${max} characters`, "EVIDENCE_TEXT_INVALID");
  if (/(?:\bsk-[A-Za-z0-9_-]{10,}|\bAKIA[0-9A-Z]{16}\b|\bBearer\s+[A-Za-z0-9._~-]{12,}|(?:password|secret|token)\s*[:=]\s*\S{6,})/i.test(text)) fail(`${label} looks like secret material`, "EVIDENCE_SECRET_REJECTED");
  return text;
}

function stringList(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) fail(`${label} is invalid`, "EVIDENCE_LIST_INVALID");
  return [...new Set(value.map((item) => cleanText(item, 160, label)))];
}

function isoDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail(`${label} is invalid`, "EVIDENCE_DATE_INVALID");
  return new Date(value).toISOString();
}

function webUrl(value: unknown): string {
  const text = cleanText(value, 2_000, "evidence URL");
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") fail("evidence URL must use HTTP or HTTPS", "EVIDENCE_URL_INVALID");
    url.username = "";
    url.password = "";
    return url.toString();
  } catch (error) {
    if ((error as { code?: string }).code === "EVIDENCE_URL_INVALID") throw error;
    return fail("evidence URL is invalid", "EVIDENCE_URL_INVALID");
  }
}

function normalizeBinding(input: Partial<EvidenceBinding> | undefined, fallbackEvidenceId: string): EvidenceBinding | undefined {
  if (!input?.investigationId) return undefined;
  const relation = (input.relation || "documents") as EvidenceRelation;
  if (!relations.has(relation)) fail("evidence relation is invalid", "EVIDENCE_BINDING_INVALID");
  return {
    investigationId: safeId(input.investigationId, "investigationId"),
    claimId: safeId(input.claimId || `claim-${fallbackEvidenceId}`.slice(0, 150), "claimId"),
    hypothesisId: input.hypothesisId ? safeId(input.hypothesisId, "hypothesisId") : undefined,
    relation,
  };
}

function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function payloadHash(record: Omit<BrowserEvidenceRecord, "integrity">): string {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

function verifyRecord(input: unknown): BrowserEvidenceRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("evidence record is invalid", "EVIDENCE_INTEGRITY_FAILED");
  const record = input as BrowserEvidenceRecord;
  if (record.schemaVersion !== "scoutpi.browser.evidence.v1" || !record.integrity?.payloadSha256) fail("evidence record is invalid", "EVIDENCE_INTEGRITY_FAILED");
  const { integrity, ...payload } = record;
  if (payloadHash(payload) !== integrity.payloadSha256) fail("evidence record integrity check failed", "EVIDENCE_INTEGRITY_FAILED");
  return record;
}

function graphNodeId(kind: string, id: string): string {
  return `${kind}:${id}`;
}

function edgeId(from: string, to: string, relation: string): string {
  return `edge_${createHash("sha256").update(`${from}|${relation}|${to}`).digest("hex").slice(0, 20)}`;
}

export class EvidenceStore {
  readonly root: string;
  readonly recordsDirectory: string;
  readonly artifactsDirectory: string;
  readonly graphsDirectory: string;
  readonly inboxDirectory: string;
  readonly allowedRoots: string[];

  constructor(root = process.env.SCOUTPI_EVIDENCE_ROOT ?? ".scoutpi/evidence", allowedRoots?: string[]) {
    this.root = resolve(root);
    this.recordsDirectory = join(this.root, "records");
    this.artifactsDirectory = join(this.root, "artifacts");
    this.graphsDirectory = join(this.root, "graphs");
    this.inboxDirectory = join(this.root, "inbox");
    const configured = (process.env.SCOUTPI_BROWSER_EVIDENCE_ROOTS || "").split(delimiter).filter(Boolean);
    this.allowedRoots = [...new Set((allowedRoots?.length ? allowedRoots : configured.length ? configured : [this.inboxDirectory]).map((path) => resolve(path)))];
  }

  async init(): Promise<void> {
    await Promise.all([this.recordsDirectory, this.artifactsDirectory, this.graphsDirectory, this.inboxDirectory].map((path) => mkdir(path, { recursive: true })));
  }

  async importBrowserBridgeFile(path: string, options: { binding?: Partial<EvidenceBinding>; timeReferences?: string[]; placeReferences?: string[]; runId?: string; snapshotId?: string } = {}): Promise<{ records: BrowserEvidenceRecord[]; imported: number; deduplicated: number }> {
    await this.init();
    const sourcePath = await realpath(resolve(path)).catch(() => fail("browser evidence file does not exist", "EVIDENCE_SOURCE_INVALID"));
    const allowedRoots = await Promise.all(this.allowedRoots.map(async (root) => await realpath(root).catch(() => root)));
    if (!allowedRoots.some((root) => isInside(sourcePath, root))) fail("browser evidence path is outside configured roots", "EVIDENCE_PATH_BLOCKED");
    const info = await stat(sourcePath).catch(() => undefined);
    if (!info?.isFile() || info.size > 2 * 1024 * 1024) fail("browser evidence file must be below 2 MB", "EVIDENCE_SOURCE_INVALID");
    let parsed: unknown;
    try { parsed = JSON.parse(await readFile(sourcePath, "utf8")); }
    catch { return fail("browser evidence file must contain valid JSON", "EVIDENCE_SOURCE_INVALID"); }
    const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray((parsed as { cards?: unknown[] }).cards) ? (parsed as { cards: unknown[] }).cards : [parsed];
    if (!rows.length || rows.length > 500) fail("browser evidence card count is invalid", "EVIDENCE_SOURCE_INVALID");
    const records: BrowserEvidenceRecord[] = [];
    let imported = 0;
    let deduplicated = 0;
    for (const row of rows) {
      const result = await this.importBrowserBridgeCard(row as BrowserBridgeEvidenceCard, sourcePath, options);
      records.push(result.record);
      if (result.deduplicated) deduplicated += 1; else imported += 1;
    }
    return { records, imported, deduplicated };
  }

  async importCanonical(input: unknown, sourcePath = join(this.inboxDirectory, "canonical.json")): Promise<{ record: BrowserEvidenceRecord; deduplicated: boolean }> {
    await this.init();
    if (!input || typeof input !== "object" || Array.isArray(input)) fail("canonical evidence must be an object", "EVIDENCE_SCHEMA_INVALID");
    const value = input as BrowserEvidenceRecord;
    if (value.schemaVersion !== "scoutpi.browser.evidence.v1") fail("canonical evidence schema is invalid", "EVIDENCE_SCHEMA_INVALID");
    const evidenceId = safeId(value.evidenceId, "evidenceId");
    const binding = normalizeBinding(value.binding, evidenceId);
    const source = {
      url: webUrl(value.source?.url),
      title: cleanText(value.source?.title, 300, "evidence title"),
      capturedAt: isoDate(value.source?.capturedAt, "capturedAt"),
      sourceType: sourceTypes.has(value.source?.sourceType) ? value.source.sourceType : fail("source type is invalid", "EVIDENCE_SCHEMA_INVALID"),
      trust: trusts.has(value.source?.trust) ? value.source.trust : fail("trust is invalid", "EVIDENCE_SCHEMA_INVALID"),
    };
    const claim = {
      text: cleanText(value.claim?.text, 2_000, "claim text"),
      timeReferences: stringList(value.claim?.timeReferences, "time reference"),
      placeReferences: stringList(value.claim?.placeReferences, "place reference"),
    };
    const recordWithoutIntegrity: Omit<BrowserEvidenceRecord, "integrity"> = {
      schemaVersion: "scoutpi.browser.evidence.v1",
      evidenceId,
      source,
      claim,
      browser: {
        commandId: value.browser?.commandId ? safeId(value.browser.commandId, "commandId") : undefined,
        runId: value.browser?.runId ? safeId(value.browser.runId, "runId") : undefined,
        snapshotId: value.browser?.snapshotId ? safeId(value.browser.snapshotId, "snapshotId") : undefined,
      },
      binding,
      excerpt: value.excerpt ? cleanText(value.excerpt, 600, "evidence excerpt") : undefined,
      artifacts: [],
      provenance: {
        importedAt: new Date().toISOString(),
        adapter: "canonical-v1",
        sourcePathHash: createHash("sha256").update(resolve(sourcePath)).digest("hex"),
        sourceFingerprint: createHash("sha256").update(JSON.stringify({ source: { ...source, capturedAt: undefined }, claim })).digest("hex"),
      },
    };
    return await this.persistRecord({ ...recordWithoutIntegrity, integrity: { payloadSha256: payloadHash(recordWithoutIntegrity) } });
  }

  async bind(evidenceId: string, binding: Partial<EvidenceBinding>): Promise<BrowserEvidenceRecord> {
    const record = await this.get(evidenceId);
    const normalized = normalizeBinding(binding, record.evidenceId);
    if (!normalized) fail("investigationId is required", "EVIDENCE_BINDING_INVALID");
    const { integrity: _previousIntegrity, ...payload } = record;
    const nextWithoutIntegrity: Omit<BrowserEvidenceRecord, "integrity"> = { ...payload, binding: normalized, provenance: { ...record.provenance } };
    const next = { ...nextWithoutIntegrity, integrity: { payloadSha256: payloadHash(nextWithoutIntegrity) } };
    await this.atomicWrite(join(this.recordsDirectory, `${record.evidenceId}.json`), next);
    return next;
  }

  async get(evidenceId: string): Promise<BrowserEvidenceRecord> {
    return verifyRecord(JSON.parse(await readFile(join(this.recordsDirectory, `${safeId(evidenceId, "evidenceId")}.json`), "utf8")));
  }

  async list(investigationId?: string, limit = 200): Promise<BrowserEvidenceRecord[]> {
    await this.init();
    if (investigationId) safeId(investigationId, "investigationId");
    const rows: BrowserEvidenceRecord[] = [];
    for (const name of (await readdir(this.recordsDirectory)).filter((item) => item.endsWith(".json")).sort().reverse().slice(0, Math.max(1, Math.min(1_000, limit)))) {
      const row = verifyRecord(JSON.parse(await readFile(join(this.recordsDirectory, name), "utf8")));
      if (!investigationId || row.binding?.investigationId === investigationId) rows.push(row);
    }
    return rows.sort((a, b) => b.source.capturedAt.localeCompare(a.source.capturedAt));
  }

  async buildGraph(input: { investigationId: string; hypotheses?: Array<{ id: string; statement: string }>; computedRuns?: EvidenceComputedRun[]; findings?: EvidenceFinding[] }): Promise<EvidenceGraph> {
    const investigationId = safeId(input.investigationId, "investigationId");
    const records = await this.list(investigationId, 1_000);
    const nodes = new Map<string, EvidenceGraphNode>();
    const edges = new Map<string, EvidenceGraphEdge>();
    const covered = new Set<string>();
    for (const hypothesis of input.hypotheses || []) {
      const id = safeId(hypothesis.id, "hypothesisId");
      nodes.set(graphNodeId("hypothesis", id), { nodeId: graphNodeId("hypothesis", id), kind: "hypothesis", label: cleanText(hypothesis.statement, 2_000, "hypothesis"), ref: id });
    }
    for (const record of records) {
      const evidenceNode = graphNodeId("browser", record.evidenceId);
      const claimId = record.binding?.claimId || `claim-${record.evidenceId}`;
      const claimNode = graphNodeId("claim", claimId);
      nodes.set(evidenceNode, { nodeId: evidenceNode, kind: "browser_evidence", label: record.source.title, status: record.source.trust, ref: record.evidenceId, metadata: { url: record.source.url, sourceType: record.source.sourceType } });
      nodes.set(claimNode, { nodeId: claimNode, kind: "claim", label: record.claim.text, ref: claimId });
      const documents = { edgeId: edgeId(evidenceNode, claimNode, "documents"), from: evidenceNode, to: claimNode, relation: "documents" as const };
      edges.set(documents.edgeId, documents);
      if (record.binding?.hypothesisId) {
        const hypothesisNode = graphNodeId("hypothesis", record.binding.hypothesisId);
        if (!nodes.has(hypothesisNode)) nodes.set(hypothesisNode, { nodeId: hypothesisNode, kind: "hypothesis", label: record.binding.hypothesisId, ref: record.binding.hypothesisId });
        const relation = record.binding.relation;
        const edge = { edgeId: edgeId(claimNode, hypothesisNode, relation), from: claimNode, to: hypothesisNode, relation };
        edges.set(edge.edgeId, edge);
        covered.add(record.binding.hypothesisId);
      }
    }
    for (const run of input.computedRuns || []) {
      const jobId = safeId(run.jobId, "jobId");
      const runNode = graphNodeId("job", jobId);
      nodes.set(runNode, { nodeId: runNode, kind: "computed_run", label: `${run.mode} · ${run.state}`, status: run.state, ref: jobId, metadata: { artifactCount: run.artifactCount || 0 } });
      for (const hypothesisId of run.hypothesisIds) {
        const safeHypothesisId = safeId(hypothesisId, "hypothesisId");
        const hypothesisNode = graphNodeId("hypothesis", safeHypothesisId);
        if (!nodes.has(hypothesisNode)) nodes.set(hypothesisNode, { nodeId: hypothesisNode, kind: "hypothesis", label: safeHypothesisId, ref: safeHypothesisId });
        const edge = { edgeId: edgeId(runNode, hypothesisNode, "computed_for"), from: runNode, to: hypothesisNode, relation: "computed_for" as const };
        edges.set(edge.edgeId, edge);
        if (run.state === "completed") covered.add(safeHypothesisId);
      }
    }
    for (const finding of input.findings || []) {
      const hypothesisId = safeId(finding.hypothesisId, "hypothesisId");
      const findingNode = graphNodeId("finding", hypothesisId);
      const hypothesisNode = graphNodeId("hypothesis", hypothesisId);
      nodes.set(findingNode, { nodeId: findingNode, kind: "finding", label: `${finding.status} · ${finding.evidenceCount} evidence statements`, status: finding.status, ref: hypothesisId });
      if (!nodes.has(hypothesisNode)) nodes.set(hypothesisNode, { nodeId: hypothesisNode, kind: "hypothesis", label: hypothesisId, ref: hypothesisId });
      const edge = { edgeId: edgeId(findingNode, hypothesisNode, "evaluates"), from: findingNode, to: hypothesisNode, relation: "evaluates" as const };
      edges.set(edge.edgeId, edge);
    }
    const hypothesisIds = [...nodes.values()].filter((node) => node.kind === "hypothesis").map((node) => String(node.ref));
    const graph: EvidenceGraph = {
      schemaVersion: "scoutpi.evidence-graph.v1",
      graphId: `evidence-graph:${investigationId}`,
      investigationId,
      updatedAt: new Date().toISOString(),
      nodes: [...nodes.values()],
      edges: [...edges.values()],
      coverage: {
        browserEvidence: records.length,
        claims: [...nodes.values()].filter((node) => node.kind === "claim").length,
        computedRuns: [...nodes.values()].filter((node) => node.kind === "computed_run").length,
        hypotheses: hypothesisIds.length,
        coveredHypotheses: hypothesisIds.filter((id) => covered.has(id)).length,
        uncoveredHypothesisIds: hypothesisIds.filter((id) => !covered.has(id)),
      },
    };
    await this.atomicWrite(join(this.graphsDirectory, `${investigationId}.json`), graph);
    return graph;
  }

  async getGraph(investigationId: string): Promise<EvidenceGraph> {
    return JSON.parse(await readFile(join(this.graphsDirectory, `${safeId(investigationId, "investigationId")}.json`), "utf8")) as EvidenceGraph;
  }

  private async importBrowserBridgeCard(card: BrowserBridgeEvidenceCard, sourcePath: string, options: { binding?: Partial<EvidenceBinding>; timeReferences?: string[]; placeReferences?: string[]; runId?: string; snapshotId?: string }): Promise<{ record: BrowserEvidenceRecord; deduplicated: boolean }> {
    if (!card || typeof card !== "object") fail("browser evidence card is invalid", "EVIDENCE_CARD_INVALID");
    const evidenceId = card.evidenceId ? safeId(card.evidenceId, "evidenceId") : `browser_ev_${randomUUID()}`;
    const sourceType = sourceTypes.has(card.sourceType as BrowserEvidenceSourceType) ? card.sourceType as BrowserEvidenceSourceType : "local_ui";
    const trust = trusts.has(card.trust as BrowserEvidenceTrust) ? card.trust as BrowserEvidenceTrust : "medium";
    const source = {
      url: webUrl(card.url),
      title: cleanText(card.title ?? "Browser evidence", 300, "evidence title"),
      capturedAt: card.capturedAt ? isoDate(card.capturedAt, "capturedAt") : new Date().toISOString(),
      sourceType,
      trust,
    };
    const summary = cleanText(card.summary, 2_000, "evidence summary");
    const extractedText = card.extractedText ? cleanText(card.extractedText, 20_000, "extracted text") : "";
    const artifacts: EvidenceArtifactRef[] = [];
    const artifactDirectory = join(this.artifactsDirectory, evidenceId);
    let screenshotCopy: { source: string; destination: string } | undefined;
    if (typeof card.screenshotPath === "string" && card.screenshotPath.trim()) {
      const screenshotSource = await realpath(resolve(dirname(sourcePath), card.screenshotPath)).catch(() => fail("screenshot artifact does not exist", "EVIDENCE_ARTIFACT_INVALID"));
      const allowedRoots = await Promise.all(this.allowedRoots.map(async (root) => await realpath(root).catch(() => root)));
      if (!allowedRoots.some((root) => isInside(screenshotSource, root))) fail("screenshot path is outside configured roots", "EVIDENCE_PATH_BLOCKED");
      const screenshotInfo = await stat(screenshotSource).catch(() => undefined);
      const extension = extname(screenshotSource).toLowerCase();
      const mediaType = extension === ".png" ? "image/png" : [".jpg", ".jpeg"].includes(extension) ? "image/jpeg" : extension === ".webp" ? "image/webp" : "";
      if (!screenshotInfo?.isFile() || screenshotInfo.size > 20 * 1024 * 1024 || !mediaType) fail("screenshot artifact is invalid", "EVIDENCE_ARTIFACT_INVALID");
      const destination = join(artifactDirectory, `screenshot${extension}`);
      artifacts.push({ artifactId: `${evidenceId}:screenshot`, kind: "screenshot", path: destination, sha256: await sha256File(screenshotSource), bytes: screenshotInfo.size, mediaType });
      screenshotCopy = { source: screenshotSource, destination };
    }
    if (extractedText) {
      const destination = join(artifactDirectory, "content.txt");
      const content = Buffer.from(`${extractedText}\n`);
      artifacts.push({ artifactId: `${evidenceId}:content`, kind: "content", path: destination, sha256: createHash("sha256").update(content).digest("hex"), bytes: content.length, mediaType: "text/plain" });
    }
    const inferredRunId = basename(dirname(sourcePath));
    const browser = {
      commandId: card.commandId ? safeId(card.commandId, "commandId") : undefined,
      runId: options.runId ? safeId(options.runId, "runId") : /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(inferredRunId) ? inferredRunId : undefined,
      snapshotId: options.snapshotId ? safeId(options.snapshotId, "snapshotId") : undefined,
    };
    const claim = { text: summary, timeReferences: stringList(options.timeReferences, "time reference"), placeReferences: stringList(options.placeReferences, "place reference") };
    const sourceFingerprint = createHash("sha256").update(JSON.stringify({ source: { ...source, capturedAt: undefined }, claim, artifacts: artifacts.map((item) => item.sha256) })).digest("hex");
    const existing = await this.matchExisting(evidenceId, sourceFingerprint);
    if (existing) return { record: existing, deduplicated: true };
    await mkdir(artifactDirectory, { recursive: true });
    if (screenshotCopy) await copyFile(screenshotCopy.source, screenshotCopy.destination);
    if (extractedText) await writeFile(join(artifactDirectory, "content.txt"), `${extractedText}\n`);
    const recordWithoutIntegrity: Omit<BrowserEvidenceRecord, "integrity"> = {
      schemaVersion: "scoutpi.browser.evidence.v1",
      evidenceId,
      source,
      claim,
      browser,
      binding: normalizeBinding(options.binding, evidenceId),
      excerpt: extractedText ? extractedText.slice(0, 600) : undefined,
      artifacts,
      provenance: {
        importedAt: new Date().toISOString(),
        adapter: "browserbridge-evidence-card",
        sourcePathHash: createHash("sha256").update(sourcePath).digest("hex"),
        sourceFingerprint,
      },
    };
    return await this.persistRecord({ ...recordWithoutIntegrity, integrity: { payloadSha256: payloadHash(recordWithoutIntegrity) } });
  }

  private async persistRecord(record: BrowserEvidenceRecord): Promise<{ record: BrowserEvidenceRecord; deduplicated: boolean }> {
    const existing = await this.matchExisting(record.evidenceId, record.provenance.sourceFingerprint);
    if (existing) return { record: existing, deduplicated: true };
    await this.atomicWrite(join(this.recordsDirectory, `${record.evidenceId}.json`), record, true);
    await writeFile(join(this.root, "imports.jsonl"), `${JSON.stringify({ at: record.provenance.importedAt, evidenceId: record.evidenceId, sourcePathHash: record.provenance.sourcePathHash, sourceFingerprint: record.provenance.sourceFingerprint })}\n`, { flag: "a" });
    return { record, deduplicated: false };
  }

  private async matchExisting(evidenceId: string, sourceFingerprint: string): Promise<BrowserEvidenceRecord | undefined> {
    for (const existing of await this.list(undefined, 1_000)) {
      if (existing.provenance.sourceFingerprint === sourceFingerprint) return existing;
      if (existing.evidenceId === evidenceId) fail("evidenceId already exists with different content", "EVIDENCE_ID_CONFLICT");
    }
    return undefined;
  }

  private async atomicWrite(path: string, value: unknown, exclusive = false): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
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
}
