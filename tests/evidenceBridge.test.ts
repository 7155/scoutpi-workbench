import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import setupEvidence from "../.pi/extensions/scoutpi-evidence/index.ts";
import { createEarthWorkspaceServer } from "../packages/earth-workspace-server/src/server.ts";
import { EarthWorkspace } from "../packages/earth-workspace/src/index.ts";
import { EvidenceStore } from "../packages/runtime-evidence/src/index.ts";
import { AgentRunStore } from "../packages/runtime-observability/src/index.ts";

const pixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

async function browserFixture(root: string, summary = "The project page states that phase one was completed in 2024.") {
  const run = join(root, "run_fixture");
  const screenshots = join(run, "screenshots");
  await mkdir(screenshots, { recursive: true });
  const screenshotPath = join(screenshots, "capture.png");
  await writeFile(screenshotPath, pixelPng);
  const cardsPath = join(run, "evidence_cards.json");
  await writeFile(cardsPath, `${JSON.stringify([{
    evidenceId: "browser-ev-001",
    commandId: "command-001",
    url: "https://example.com/project/status",
    title: "Project status notice",
    capturedAt: "2026-07-11T01:00:00.000Z",
    summary,
    screenshotPath,
    extractedText: "Phase one was completed in 2024. Final acceptance remains pending.",
    sourceType: "public_webpage",
    trust: "high",
  }], null, 2)}\n`);
  return cardsPath;
}

test("BrowserBridge evidence is normalized, artifactized, deduplicated and bound into a typed graph", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-evidence-"));
  const browserRoot = join(root, "browser_runs");
  try {
    const cardsPath = await browserFixture(browserRoot);
    const store = new EvidenceStore(join(root, "evidence"), [browserRoot]);
    const first = await store.importBrowserBridgeFile(cardsPath, {
      binding: { investigationId: "investigation-001", claimId: "claim-phase-one", hypothesisId: "h1", relation: "supports" },
      timeReferences: ["2024"],
      placeReferences: ["phase one area"],
      snapshotId: "snapshot-001",
    });
    assert.equal(first.imported, 1);
    assert.equal(first.deduplicated, 0);
    assert.equal(first.records[0].schemaVersion, "scoutpi.browser.evidence.v1");
    assert.equal(first.records[0].binding?.relation, "supports");
    assert.deepEqual(first.records[0].claim.timeReferences, ["2024"]);
    assert.equal(first.records[0].artifacts.length, 2);
    for (const artifact of first.records[0].artifacts) {
      assert.match(artifact.path, /scoutpi-evidence-.+\/evidence\/artifacts\/browser-ev-001/);
      assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
      assert.equal((await readFile(artifact.path)).length > 0, true);
    }
    const second = await store.importBrowserBridgeFile(cardsPath, { binding: { investigationId: "investigation-001", claimId: "claim-phase-one", hypothesisId: "h1", relation: "supports" }, timeReferences: ["2024"], placeReferences: ["phase one area"], snapshotId: "snapshot-001" });
    assert.equal(second.imported, 0);
    assert.equal(second.deduplicated, 1);
    const rebound = await store.bind("browser-ev-001", { investigationId: "investigation-001", claimId: "claim-phase-one", hypothesisId: "h1", relation: "contextualizes" });
    assert.equal((await store.get(rebound.evidenceId)).binding?.relation, "contextualizes");
    const copiedScreenshot = first.records[0].artifacts.find((artifact) => artifact.kind === "screenshot")!;
    const copiedBeforeConflict = await readFile(copiedScreenshot.path);
    const conflictingCards = JSON.parse(await readFile(cardsPath, "utf8"));
    conflictingCards[0].summary = "A different claim using the same evidence identifier.";
    await writeFile(cardsPath, `${JSON.stringify(conflictingCards, null, 2)}\n`);
    await assert.rejects(() => store.importBrowserBridgeFile(cardsPath), /EVIDENCE_ID_CONFLICT|already exists/);
    assert.deepEqual(await readFile(copiedScreenshot.path), copiedBeforeConflict);
    const graph = await store.buildGraph({
      investigationId: "investigation-001",
      hypotheses: [{ id: "h1", statement: "Phase one was completed." }, { id: "h2", statement: "A measurable land change occurred." }],
      computedRuns: [{ jobId: "earth-job-001", state: "completed", mode: "live", hypothesisIds: ["h2"], artifactCount: 3 }],
      findings: [{ hypothesisId: "h1", status: "mixed", evidenceCount: 2 }],
    });
    assert.equal(graph.coverage.browserEvidence, 1);
    assert.equal(graph.coverage.coveredHypotheses, 2);
    assert.equal(graph.edges.some((edge) => edge.relation === "contextualizes"), true);
    assert.equal(graph.edges.some((edge) => edge.relation === "computed_for"), true);
    assert.equal(graph.edges.some((edge) => edge.relation === "evaluates"), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Evidence import blocks paths outside configured roots and secret-like page text", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-evidence-security-"));
  const allowed = join(root, "allowed");
  const outside = join(root, "outside");
  try {
    const outsidePath = await browserFixture(outside);
    const store = new EvidenceStore(join(root, "evidence"), [allowed]);
    await assert.rejects(() => store.importBrowserBridgeFile(outsidePath), /EVIDENCE_PATH_BLOCKED|outside configured roots/);
    await mkdir(allowed, { recursive: true });
    const linkedPath = join(allowed, "linked-evidence.json");
    await symlink(outsidePath, linkedPath);
    await assert.rejects(() => store.importBrowserBridgeFile(linkedPath), /EVIDENCE_PATH_BLOCKED|outside configured roots/);
    const secretPath = await browserFixture(allowed, "token=sk-this-must-not-enter-the-evidence-store");
    await assert.rejects(() => store.importBrowserBridgeFile(secretPath), /EVIDENCE_SECRET_REJECTED|secret material/);
    await assert.rejects(() => store.get("../escape"), /EVIDENCE_ID_INVALID|invalid/);
    const validPath = await browserFixture(allowed, "A public milestone was documented without secret material.");
    const imported = await store.importBrowserBridgeFile(validPath);
    const recordPath = join(root, "evidence", "records", `${imported.records[0].evidenceId}.json`);
    const tampered = JSON.parse(await readFile(recordPath, "utf8"));
    tampered.claim.text = "Tampered after import";
    await writeFile(recordPath, `${JSON.stringify(tampered, null, 2)}\n`);
    await assert.rejects(() => store.get(imported.records[0].evidenceId), /EVIDENCE_INTEGRITY_FAILED|integrity check failed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Agent observability can attach the exact investigation Evidence Graph", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-evidence-trace-"));
  try {
    const evidence = new EvidenceStore(join(root, "evidence"));
    const graph = await evidence.buildGraph({ investigationId: "trace-investigation", hypotheses: [{ id: "h1", statement: "A testable hypothesis." }] });
    const runs = new AgentRunStore(join(root, "runs"));
    const run = await runs.start({ sessionId: "session-evidence-trace", prompt: "Build the evidence graph", model: "OpenAI/gpt-5.6" });
    await runs.attachEvidenceGraph(run.runId, graph);
    const attached = JSON.parse(await readFile(join(root, "runs", run.runId, "evidence_graph.json"), "utf8"));
    assert.equal(attached.graphId, graph.graphId);
    assert.equal(attached.investigationId, "trace-investigation");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Pi Evidence Bridge consumes canonical browser tool details without registering another model tool", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-evidence-extension-"));
  const previousEvidence = process.env.SCOUTPI_EVIDENCE_ROOT;
  process.env.SCOUTPI_EVIDENCE_ROOT = root;
  try {
    const handlers = new Map<string, Function>();
    const entries: Array<{ type: string; data: any }> = [];
    const commands: string[] = [];
    let status = "";
    await setupEvidence({
      on(name: string, handler: Function) { handlers.set(name, handler); },
      getAllTools() { return [{ name: "browser_observe" }, { name: "earth_workspace" }]; },
      appendEntry(type: string, data: unknown) { entries.push({ type, data }); },
      registerCommand(name: string) { commands.push(name); },
    } as any);
    const context = { ui: { setStatus(_key: string, value: string | undefined) { status = value || ""; }, notify() {} } };
    await handlers.get("session_start")?.({ type: "session_start" }, context);
    assert.match(status, /BrowserBridge ready/);
    await handlers.get("tool_result")?.({
      type: "tool_result",
      toolName: "browser_observe",
      toolCallId: "browser-call-001",
      input: { op: "read" },
      content: [],
      isError: false,
      details: {
        browserEvidence: {
          schemaVersion: "scoutpi.browser.evidence.v1",
          evidenceId: "canonical-ev-001",
          source: { url: "https://example.com/document", title: "Primary document", capturedAt: "2026-07-11T02:00:00.000Z", sourceType: "docs", trust: "high" },
          claim: { text: "The primary document records a dated project milestone.", timeReferences: ["2024"], placeReferences: [] },
          browser: { commandId: "browser-call-001" },
          artifacts: [],
          provenance: { importedAt: "2026-07-11T02:00:00.000Z", adapter: "canonical-v1", sourcePathHash: "a".repeat(64), sourceFingerprint: "b".repeat(64) },
          integrity: { payloadSha256: "c".repeat(64) },
        },
      },
    }, context);
    const records = await new EvidenceStore(root).list();
    assert.equal(records.length, 1);
    assert.equal(records[0].evidenceId, "canonical-ev-001");
    assert.equal(entries.some((entry) => entry.type === "scoutpi:evidence-import"), true);
    assert.deepEqual(commands, ["earth-evidence"]);
  } finally {
    if (previousEvidence === undefined) delete process.env.SCOUTPI_EVIDENCE_ROOT; else process.env.SCOUTPI_EVIDENCE_ROOT = previousEvidence;
    await rm(root, { recursive: true, force: true });
  }
});

test("Earth Workspace and Workbench API expose investigation-scoped evidence and computed coverage", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-evidence-api-"));
  const browserRoot = join(root, "browser_runs");
  const previousRoots = process.env.SCOUTPI_BROWSER_EVIDENCE_ROOTS;
  const previousEvidence = process.env.SCOUTPI_EVIDENCE_ROOT;
  process.env.SCOUTPI_BROWSER_EVIDENCE_ROOTS = browserRoot;
  process.env.SCOUTPI_EVIDENCE_ROOT = join(root, "evidence");
  try {
    const cardsPath = await browserFixture(browserRoot);
    const workspace = new EarthWorkspace(join(root, "earth"), process.execPath);
    await workspace.importAdapterPack(JSON.parse(await readFile(join(process.cwd(), "examples/adapter-packs/earth-engine-starter.json"), "utf8")), "example");
    const plan = await workspace.plan({
      schemaVersion: "scoutpi.investigation.v1",
      investigationId: "evidence-api-investigation",
      question: "Does the browser claim have corresponding observable evidence?",
      phenomenon: "generic_change",
      region: { kind: "bbox", bbox: [121.4, 31.1, 121.5, 31.2], name: "Evidence API area" },
      period: { startYear: 2023, endYear: 2024, startMonth: 6, endMonth: 8 },
      hypotheses: [{ id: "h1", statement: "The reported change is observable.", observableRoles: ["built_surface"] }],
      confounders: ["Compare the same season."],
    });
    await workspace.run(plan.plan.planId, { mode: "dry_run" });
    const imported = await workspace.importBrowserEvidence(cardsPath, { binding: { investigationId: "evidence-api-investigation", claimId: "claim-browser", hypothesisId: "h1", relation: "contextualizes" } });
    await workspace.story({
      schemaVersion: "scoutpi.earth.story.v1",
      investigationId: "evidence-api-investigation",
      question: "Does the browser claim have corresponding observable evidence?",
      claims: [{ claimId: "claim-browser", claim: imported.records[0].claim.text, sourceUrl: imported.records[0].source.url, evidenceArtifact: imported.records[0].evidenceId, trust: "primary" }],
      findings: [{ hypothesisId: "h1", status: "mixed", evidence: ["The source claim is documented, while the dry run is not computed evidence."] }],
      metrics: {}, layers: [], charts: [], uncertainties: ["A live computation is still required."], provenance: { planId: plan.plan.planId },
    });
    await assert.rejects(() => workspace.story({
      schemaVersion: "scoutpi.earth.story.v1", investigationId: "evidence-api-investigation", question: "Invalid evidence reference",
      claims: [{ claimId: "bad-claim", claim: "Unsupported", sourceUrl: "https://example.com/other", evidenceArtifact: imported.records[0].evidenceId }],
      findings: [], metrics: {}, layers: [], charts: [], uncertainties: [], provenance: {},
    }), /STORY_INVALID/);
    const runtime = await createEarthWorkspaceServer({ host: "127.0.0.1", port: 0, workspace });
    await runtime.listen();
    try {
      const address = runtime.server.address();
      if (!address || typeof address === "string") throw new Error("test server address unavailable");
      const base = `http://127.0.0.1:${address.port}`;
      const evidence: any = await (await fetch(`${base}/api/evidence?investigationId=evidence-api-investigation`)).json();
      const graph: any = await (await fetch(`${base}/api/evidence/graph/evidence-api-investigation`)).json();
      assert.equal(evidence.evidence.length, 1);
      assert.equal(graph.coverage.browserEvidence, 1);
      assert.equal(graph.coverage.computedRuns, 0);
      assert.equal(graph.coverage.coveredHypotheses, 1);
      assert.equal(graph.nodes.some((node: any) => node.kind === "finding"), true);
    } finally { await runtime.close(); }
  } finally {
    if (previousRoots === undefined) delete process.env.SCOUTPI_BROWSER_EVIDENCE_ROOTS; else process.env.SCOUTPI_BROWSER_EVIDENCE_ROOTS = previousRoots;
    if (previousEvidence === undefined) delete process.env.SCOUTPI_EVIDENCE_ROOT; else process.env.SCOUTPI_EVIDENCE_ROOT = previousEvidence;
    await rm(root, { recursive: true, force: true });
  }
});
