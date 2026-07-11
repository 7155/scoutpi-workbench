import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileInvestigation, searchCatalog, type EarthAdapterPack, type InvestigationSpec } from "../packages/earth-investigation-core/src/index.ts";
import { deriveEarthJobState, EarthWorkspace } from "../packages/earth-workspace/src/index.ts";
import setupEarthPi from "../.pi/extensions/scoutpi-earth/index.ts";
import { createEarthWorkspaceServer } from "../packages/earth-workspace-server/src/server.ts";

const starterPack = JSON.parse(await readFile(new URL("../examples/adapter-packs/earth-engine-starter.json", import.meta.url), "utf8")) as EarthAdapterPack;
const starterAdapters = starterPack.adapters;

async function seedWorkspace(workspace: EarthWorkspace): Promise<void> {
  await workspace.importAdapterPack(starterPack, "example");
}

function spec(overrides: Partial<InvestigationSpec> = {}): InvestigationSpec {
  return {
    schemaVersion: "scoutpi.investigation.v1",
    investigationId: "generic-change-test",
    question: "Did the observed phenomenon change, and which evidence supports or contradicts it?",
    region: { kind: "bbox", bbox: [120.9, 30.8, 121.2, 31.1], name: "test region" },
    period: { startYear: 2018, endYear: 2021, startMonth: 5, endMonth: 9 },
    hypotheses: [{ id: "h1", statement: "Vegetation changed", observableRoles: ["vegetation"] }],
    confounders: ["Compare the same season every year."],
    preferredOutputs: ["yearly_csv", "story"],
    ...overrides,
  };
}

test("dataset router supports different phenomena without project-specific code", () => {
  const water = compileInvestigation(spec({ investigationId: "water-change", hypotheses: [{ id: "h1", statement: "Water extent declined", observableRoles: ["water_extent", "precipitation"] }] }), starterAdapters);
  const fire = compileInvestigation(spec({ investigationId: "fire-recovery", hypotheses: [{ id: "h1", statement: "Vegetation recovered after fire", observableRoles: ["fire_recovery", "climate_background"] }] }), starterAdapters);
  const urban = compileInvestigation(spec({ investigationId: "urban-change", hypotheses: [{ id: "h1", statement: "Built surface and activity increased", observableRoles: ["built_surface", "human_activity", "vegetation"] }] }), starterAdapters);
  assert.deepEqual(water.datasets.map((row) => row.role), ["water_extent", "precipitation"]);
  assert.equal(fire.datasets.some((row) => row.dataset.datasetId === "sentinel2-sr"), true);
  assert.equal(urban.datasets.some((row) => row.dataset.datasetId === "viirs-nightlights"), true);
  assert.equal(urban.criticChecks.some((row) => row.checkId.includes("proxy-boundary") && row.severity === "blocking"), true);
});

test("catalog search is role and time aware", () => {
  const results = searchCatalog(starterAdapters, "night activity", "human_activity", 2020);
  assert.equal(results[0].datasetId, "viirs-nightlights");
  assert.equal(searchCatalog(starterAdapters, "water", "water_extent", 2025).some((row) => row.datasetId === "jrc-surface-water"), false);
});

test("investigation validation rejects ambiguous time and hypothesis contracts", () => {
  assert.throws(() => compileInvestigation(spec({ period: { startYear: 2019, endYear: 2021, startMonth: 0, endMonth: 12 } }), starterAdapters), /period months/);
  assert.throws(() => compileInvestigation(spec({ hypotheses: [
    { id: "h1", statement: "Vegetation changed", observableRoles: ["vegetation"] },
    { id: "h1", statement: "Water changed", observableRoles: ["water_extent"] },
  ] }), starterAdapters), /duplicate hypothesis id/);
  const planned = compileInvestigation(spec(), starterAdapters);
  assert.equal(typeof planned.estimatedCost.nominalPixels, "number");
  assert.equal((planned.estimatedCost.nominalPixels || 0) > 0, true);
});

test("runtime contracts are disclosed on demand instead of inflating the permanent Pi schema", () => {
  const workspace = new EarthWorkspace(".scoutpi/contract-test", process.execPath);
  const index = workspace.contract() as { contracts: string[] };
  assert.deepEqual(index.contracts, ["investigation", "adapter", "adapter_pack", "skill", "local_export", "browser_evidence"]);
  const adapter = workspace.contract("adapter") as any;
  assert.equal(adapter.template.schemaVersion, "scoutpi.earth.adapter.v1");
  assert.throws(() => workspace.contract("arbitrary_code"), /CONTRACT_INVALID/);
});

test("Agent-built adapters are versioned, probed and can be disabled without changing core code", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-earth-registry-"));
  class ProbeWorkspace extends EarthWorkspace {
    protected override async callWorker(payload: Record<string, unknown>): Promise<any> {
      if (payload.op === "probe_adapter") return { ok: true, sampleCount: 2, availableBands: ["B4", "B8", "SCL"], requestedBands: ["B4", "B8", "SCL"], sampleTime: "2024-06-01" };
      return { ok: true };
    }
  }
  try {
    const workspace = new ProbeWorkspace(root, process.execPath);
    const first = await workspace.registerAdapter(starterAdapters[0], "pi");
    assert.equal(first.revision, 1);
    assert.equal(first.verification.status, "not_run");
    assert.equal((await workspace.registerAdapter(starterAdapters[0], "pi")).revision, 1);
    const revised = await workspace.registerAdapter({ ...starterAdapters[0], title: `${starterAdapters[0].title} reviewed` }, "pi");
    assert.equal(revised.revision, 2);
    assert.notEqual(revised.fingerprint, first.fingerprint);
    const probed = await workspace.probeAdapter(revised.adapter.datasetId);
    assert.equal(probed.verification.status, "passed");
    assert.equal(probed.verification.availableBands?.includes("B8"), true);
    assert.equal((await workspace.catalogSearch({ query: "vegetation", role: "vegetation" })).datasets.length, 1);
    await workspace.setAdapterEnabled(revised.adapter.datasetId, false);
    assert.equal((await workspace.catalogSearch({ query: "vegetation", role: "vegetation" })).datasets.length, 0);
    assert.match(await readFile(join(root, "registry_events.jsonl"), "utf8"), /adapter_probe/);
    await assert.rejects(() => workspace.registerAdapter({ ...starterAdapters[0], collectionId: "invalid" }, "pi"), /ADAPTER_INVALID/);
    await assert.rejects(() => workspace.registerAdapter({ ...starterAdapters[0], documentationUrl: "javascript:alert(1)" }, "pi"), /ADAPTER_INVALID/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("live execution requires adapter evidence while local exports run as supervised jobs", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-earth-export-"));
  class ExportWorkspace extends EarthWorkspace {
    protected override async callWorker(payload: Record<string, unknown>): Promise<any> {
      if (payload.op === "probe_adapter") return { ok: true, sampleCount: 1, availableBands: ["B2", "B3", "B4", "B8", "SCL"], requestedBands: ["B4", "B8", "SCL"], sampleTime: "2024-05-01" };
      if (payload.op === "run") return { ok: true, taskIds: [], artifact: "stub" };
      if (payload.op === "export_local") return { ok: true, execution: "local_export", backend: "geedim", artifact: join(String(payload.artifactDir), "vegetation_2021.tif"), bytes: 1024, sha256: "abc" };
      return { ok: true };
    }
  }
  try {
    const workspace = new ExportWorkspace(root, process.execPath);
    await workspace.registerAdapter(starterAdapters[0], "example");
    const planned = await workspace.plan(spec({ investigationId: "verified-live-run" }));
    await assert.rejects(() => workspace.run(planned.plan.planId, { mode: "live", execution: "inline", confirmed: true }), /ADAPTER_VERIFICATION_REQUIRED/);
    await workspace.probeAdapter(starterAdapters[0].datasetId);
    assert.equal((await workspace.run(planned.plan.planId, { mode: "live", execution: "inline", confirmed: true })).state, "completed");
    const queued = await workspace.exportLocal(planned.plan.planId, { role: "vegetation", kind: "year", year: 2021, scaleMeters: 1000 });
    assert.equal(queued.state, "running");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const completed = await workspace.status(queued.jobId);
    assert.equal(completed.state, "completed");
    assert.equal(completed.result?.backend, "geedim");
    const retried = await workspace.retryLocalExport(queued.jobId, true);
    assert.notEqual(retried.jobId, queued.jobId);
    assert.equal((await workspace.waitForLocalExport(retried.jobId)).state, "completed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("identical map requests reuse a short-lived tile contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-earth-tiles-"));
  class TileWorkspace extends EarthWorkspace {
    calls = 0;
    protected override async callWorker(payload: Record<string, unknown>): Promise<any> {
      if (payload.op === "visualize") {
        this.calls += 1;
        return { ok: true, planId: (payload.plan as any).planId, role: payload.role, year: payload.year, datasetId: "sentinel2-sr", outputName: "ndvi", tileUrl: "https://tiles.example/{z}/{x}/{y}", mapId: "map-1", legend: { min: -1, max: 1, palette: ["ffffff", "008000"] }, generatedAt: "2026-07-10T00:00:00Z" };
      }
      return { ok: true };
    }
  }
  try {
    const workspace = new TileWorkspace(root, process.execPath);
    await workspace.registerAdapter(starterAdapters[0], "example");
    const { plan } = await workspace.plan(spec({ investigationId: "tile-cache" }));
    const first = await workspace.visualize(plan.planId, { role: "vegetation", year: 2021 });
    const second = await workspace.visualize(plan.planId, { role: "vegetation", year: 2021 });
    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.equal(workspace.calls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Earth Engine task states remain running until terminal status and support cancellation", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-earth-lifecycle-"));
  class StubWorkerWorkspace extends EarthWorkspace {
    statusState = "RUNNING";
    protected override async callWorker(payload: Record<string, unknown>): Promise<any> {
      if (payload.op === "run") return { ok: true, taskIds: ["task-1"], taskStatus: [{ id: "task-1", state: "READY" }] };
      if (payload.op === "status") return { ok: true, tasks: [{ id: "task-1", state: this.statusState }] };
      if (payload.op === "cancel") return { ok: true, tasks: [{ id: "task-1", state: "CANCEL_REQUESTED" }] };
      return { ok: true };
    }
  }
  try {
    const workspace = new StubWorkerWorkspace(root, process.execPath);
    await seedWorkspace(workspace);
    const planned = await workspace.plan(spec({ investigationId: "task-lifecycle" }));
    const running = await workspace.run(planned.plan.planId, { mode: "live", execution: "drive", confirmed: true, confirmedUnverifiedAdapters: true });
    assert.equal(running.state, "running");
    assert.equal((await workspace.status(running.jobId, true)).state, "running");
    workspace.statusState = "COMPLETED";
    assert.equal((await workspace.status(running.jobId, true)).state, "completed");

    const cancellable = await workspace.run(planned.plan.planId, { mode: "live", execution: "drive", confirmed: true, confirmedUnverifiedAdapters: true });
    assert.equal((await workspace.cancel(cancellable.jobId)).state, "cancelled");
    assert.equal(deriveEarthJobState([{ state: "FAILED" }]), "failed");
    assert.equal(deriveEarthJobState([{ state: "CANCEL_REQUESTED" }]), "cancelled");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime recovery marks detached local exports retryable while preserving remote tasks", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-earth-recovery-"));
  try {
    const workspace = new EarthWorkspace(root, process.execPath);
    await workspace.init();
    const localDir = join(root, "jobs", "earth_local_interrupted");
    const remoteDir = join(root, "jobs", "earth_remote_running");
    await mkdir(localDir, { recursive: true });
    await mkdir(remoteDir, { recursive: true });
    const base = { planId: "plan_example", mode: "live", state: "running", createdAt: "2026-07-10T00:00:00Z", updatedAt: "2026-07-10T00:00:00Z" };
    await writeFile(join(localDir, "job.json"), JSON.stringify({ ...base, jobId: "earth_local_interrupted", taskIds: [], artifactDir: localDir, result: { execution: "local_export" } }));
    await writeFile(join(remoteDir, "job.json"), JSON.stringify({ ...base, jobId: "earth_remote_running", taskIds: ["remote-1"], artifactDir: remoteDir, result: { execution: "drive" } }));
    const recovered = await workspace.recoverInterruptedJobs();
    assert.deepEqual(recovered.jobIds, ["earth_local_interrupted"]);
    const local = await workspace.status("earth_local_interrupted");
    assert.equal(local.state, "failed");
    assert.equal((local.result?.recovery as any).retryable, true);
    assert.equal((await workspace.status("earth_remote_running")).state, "running");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace writes plan, dry-run artifacts, recipes, analysis and story", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-earth-"));
  try {
    const workspace = new EarthWorkspace(root, process.env.PYTHON ?? ".venv/bin/python");
    await seedWorkspace(workspace);
    const planned = await workspace.plan(spec());
    assert.equal(JSON.parse(await readFile(planned.path, "utf8")).planId, planned.plan.planId);
    const preview = await workspace.preview(planned.plan.planId);
    assert.equal((preview.datasets as any[]).length, 1);
    const job = await workspace.run(planned.plan.planId, { mode: "dry_run" });
    assert.equal(job.state, "completed");
    assert.match(String(job.result?.artifact), /execution_manifest\.json/);

    await workspace.saveRecipe({ recipeId: "generic-vegetation", name: "Generic vegetation change", spec: spec() });
    const loaded = await workspace.loadRecipe("generic-vegetation", { investigationId: "replayed-investigation" });
    assert.equal(loaded.investigationId, "replayed-investigation");

    const skill = await workspace.saveSkill({
      schemaVersion: "scoutpi.earth.skill.v1", skillId: "vegetation-review", name: "Vegetation review", description: "Review a vegetation investigation with registered adapters.",
      whenToUse: ["A task requires repeatable vegetation evidence."], instructions: ["Inspect registered adapters before compiling a plan.", "Run a dry-run before live execution."],
      requiredAdapterIds: ["sentinel2-sr"], safetyNotes: ["Do not claim a trend without computed artifacts."], createdBy: "pi",
    });
    assert.match(await readFile(skill.markdownPath, "utf8"), /Generated by ScoutPi Earth Workspace/);

    const csv = join(root, "yearly.csv");
    await writeFile(csv, "year,value\n2018,1\n2019,2\n2020,4\n");
    const analyzed = await workspace.analyze(csv, ["value"]);
    assert.equal((analyzed.summary as any).columns.value.trend.slope_per_step, 1.5);

    const story = await workspace.story({
      schemaVersion: "scoutpi.earth.story.v1", investigationId: "generic-change-test", question: "What changed?", claims: [],
      findings: [{ hypothesisId: "h1", status: "unknown", evidence: ["The dry-run plan completed; no computed metric is claimed."] }],
      metrics: {}, layers: [], charts: [], uncertainties: ["A reviewed live computation is still required."], provenance: { planId: planned.plan.planId },
    });
    const storyMarkdown = await readFile(story.markdownPath, "utf8");
    assert.match(storyMarkdown, /## Uncertainty/);
    assert.match(storyMarkdown, /## Evidence Review/);
    assert.equal(story.review.status, "passed");
    assert.equal((await workspace.getEvidenceReview("generic-change-test")).reviewId, story.review.reviewId);
    await assert.rejects(() => workspace.story({
      schemaVersion: "scoutpi.earth.story.v1", investigationId: "generic-change-test", question: "What changed?", claims: [],
      findings: [{ hypothesisId: "h1", status: "supported", evidence: ["The computed metric proves the change increased."] }],
      metrics: { value: { value: 4 } }, layers: [], charts: [], uncertainties: [], provenance: { planId: planned.plan.planId, jobIds: [job.jobId] },
    }), /STORY_REVIEW_BLOCKED/);
    assert.equal((await workspace.getEvidenceReview("generic-change-test")).status, "blocked");
    assert.equal((await workspace.getStory("generic-change-test")).findings[0].status, "unknown");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generated Pi skills require confirmation and never overwrite human-authored skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-earth-skill-"));
  const publishRoot = join(root, "published");
  try {
    const workspace = new EarthWorkspace(join(root, "workspace"), process.execPath, publishRoot);
    await workspace.saveSkill({
      schemaVersion: "scoutpi.earth.skill.v1",
      skillId: "catalog-investigation",
      name: "Catalog investigation",
      description: "Explore a catalog, register a typed adapter, verify it, and compile an investigation.",
      whenToUse: ["A new Earth-observation question has no registered adapter."],
      instructions: ["Search primary dataset documentation.", "Create and probe a declarative adapter before live execution."],
      safetyNotes: ["Never add arbitrary Python or JavaScript to a generated skill."],
      createdBy: "pi",
    });
    await assert.rejects(() => workspace.publishSkill("catalog-investigation"), /CONFIRMATION_REQUIRED/);
    const published = await workspace.publishSkill("catalog-investigation", true);
    assert.match(await readFile(published.path, "utf8"), /Generated by ScoutPi Earth Workspace/);
    await writeFile(published.path, "# Human skill\n");
    await assert.rejects(() => workspace.publishSkill("catalog-investigation", true), /Refusing to overwrite/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace rejects invalid regions, empty registries and analysis path escape", async () => {
  assert.throws(() => compileInvestigation(spec({ region: { kind: "bbox", bbox: [121, 31, 120, 32] } }), starterAdapters), /bbox is invalid/);
  assert.throws(() => compileInvestigation(spec(), []), /no registered dataset/);
  const root = await mkdtemp(join(tmpdir(), "scoutpi-earth-safe-"));
  try {
    const workspace = new EarthWorkspace(root, process.env.PYTHON ?? ".venv/bin/python");
    await assert.rejects(() => workspace.analyze("/etc/hosts"), /ANALYSIS_PATH_BLOCKED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Pi extension exposes exactly three compact Earth gateway tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-earth-pi-"));
  const previousRoot = process.env.SCOUTPI_EARTH_ROOT;
  const previousEcosystemRoot = process.env.SCOUTPI_ECOSYSTEM_ROOT;
  process.env.SCOUTPI_EARTH_ROOT = root;
  process.env.SCOUTPI_ECOSYSTEM_ROOT = join(root, "pi-ecosystem");
  try {
    const tools: any[] = [];
    const handlers = new Map<string, Function>();
    const commands = new Map<string, any>();
    let peerCommands: any[] = [];
    let active: string[] = ["memory_search", "browser_session"];
    await seedWorkspace(new EarthWorkspace(root, process.env.PYTHON ?? ".venv/bin/python"));
    await setupEarthPi({
      registerTool(tool: any) { tools.push(tool); },
      getActiveTools() { return active; },
      setActiveTools(names: string[]) { active = names; },
      getAllTools() { return tools; },
      getCommands() { return peerCommands; },
      on(name: string, handler: Function) { handlers.set(name, handler); },
      registerCommand(name: string, command: any) { commands.set(name, command); },
    } as any);
    assert.deepEqual(tools.map((tool) => tool.name), ["earth_workspace", "python_analysis", "earth_story"]);
    await handlers.get("session_start")?.({}, { ui: { setStatus() {} } });
    assert.equal(active.includes("earth_workspace"), true);
    peerCommands = [{ name: "goal", sourceInfo: { source: "npm:pi-goal", scope: "global" } }];
    let ecosystemNotice = "";
    await commands.get("earth-ecosystem").handler("", { ui: { notify(message: string) { ecosystemNotice = message; } } });
    assert.match(ecosystemNotice, /ready Autonomous goals: \/goal/);
    let call = 0;
    const executeEarth = async (input: Record<string, unknown>) => {
      const params = tools[0].prepareArguments ? tools[0].prepareArguments(input) : input;
      return await tools[0].execute(`test-call-${++call}`, params, undefined, undefined, {});
    };
    const environment = await executeEarth({ op: "environment" });
    assert.match(environment.content[0].text, /installed=true/);
    const contract = await executeEarth({ op: "contract", id: "adapter" });
    assert.match(contract.content[0].text, /scoutpi\.earth\.adapter\.v1/);
    assert.equal(contract.content[0].text.length < 1800, true);
    const catalog = await executeEarth({ op: "catalog_search", query: "night activity", role: "human_activity" });
    assert.match(catalog.content[0].text, /viirs-nightlights/);
    assert.equal(catalog.content[0].text.length < 1800, true);
    const planned = await executeEarth({ op: "plan", spec: spec({ investigationId: "pi-tool-plan" }) });
    assert.match(planned.content[0].text, /plan ok/);
    assert.equal(typeof planned.details.artifactPath, "string");
  } finally {
    if (previousRoot === undefined) delete process.env.SCOUTPI_EARTH_ROOT;
    else process.env.SCOUTPI_EARTH_ROOT = previousRoot;
    if (previousEcosystemRoot === undefined) delete process.env.SCOUTPI_ECOSYSTEM_ROOT;
    else process.env.SCOUTPI_ECOSYSTEM_ROOT = previousEcosystemRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test("Earth Workbench API persists plans, runs and bounded artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-earth-api-"));
  const workspace = new EarthWorkspace(root, process.env.PYTHON ?? ".venv/bin/python");
  await seedWorkspace(workspace);
  const runtime = await createEarthWorkspaceServer({ host: "127.0.0.1", port: 0, workspace });
  await runtime.listen();
  const address = runtime.server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const createdResponse = await fetch(`${base}/api/plans`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spec: spec({ investigationId: "api-plan" }) }) });
    assert.equal(createdResponse.status, 201);
    const contract: any = await (await fetch(`${base}/api/contracts/local_export`)).json();
    assert.equal(contract.template.format, "geotiff");
    const created: any = await createdResponse.json();
    const listed: any = await (await fetch(`${base}/api/plans`)).json();
    assert.equal(listed.plans[0].planId, created.plan.planId);
    const run: any = await (await fetch(`${base}/api/plans/${created.plan.planId}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "dry_run" }) })).json();
    assert.equal(run.state, "completed");
    const artifacts: any = await (await fetch(`${base}/api/jobs/${run.jobId}/artifacts`)).json();
    assert.equal(artifacts.artifacts.some((item: any) => item.name === "execution_manifest.json"), true);
    const manifest = await fetch(`${base}/api/jobs/${run.jobId}/artifacts/execution_manifest.json`);
    assert.equal(manifest.status, 200);
    assert.equal((await manifest.json()).planId, created.plan.planId);
    const savedRecipe = await fetch(`${base}/api/recipes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recipeId: "api-recipe", name: "API recipe", spec: spec({ investigationId: "api-recipe-source" }) }) });
    assert.equal(savedRecipe.status, 201);
    const instantiated: any = await (await fetch(`${base}/api/recipes/api-recipe/instantiate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ patch: { investigationId: "api-recipe-copy" } }) })).json();
    assert.equal(instantiated.plan.spec.investigationId, "api-recipe-copy");
    const blocked = await fetch(`${base}/api/artifact?path=${encodeURIComponent("/etc/hosts")}`);
    assert.equal(blocked.status, 400);
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Earth Workbench API exposes adapter probes, skill drafts and supervised local exports", async () => {
  const root = await mkdtemp(join(tmpdir(), "scoutpi-earth-api-runtime-"));
  class ApiWorkspace extends EarthWorkspace {
    protected override async callWorker(payload: Record<string, unknown>): Promise<any> {
      if (payload.op === "probe_adapter") return { ok: true, sampleCount: 1, availableBands: ["B4", "B8", "SCL"], requestedBands: ["B4", "B8", "SCL"], sampleTime: "2024-01-01" };
      if (payload.op === "export_local") return { ok: true, execution: "local_export", backend: "geedim", artifact: join(String(payload.artifactDir), "result.tif"), bytes: 12, sha256: "stub" };
      return { ok: true, taskIds: [] };
    }
  }
  const workspace = new ApiWorkspace(root, process.execPath, join(root, "published"));
  await workspace.registerAdapter(starterAdapters[0], "example");
  const runtime = await createEarthWorkspaceServer({ host: "127.0.0.1", port: 0, workspace });
  await runtime.listen();
  const address = runtime.server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const probe = await fetch(`${base}/api/adapters/sentinel2-sr/probe`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(probe.status, 200);
    assert.equal((await probe.json()).verification.status, "passed");
    const skill = await fetch(`${base}/api/skills`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      schemaVersion: "scoutpi.earth.skill.v1", skillId: "runtime-exploration", name: "Runtime exploration", description: "Build and verify a reusable adapter.",
      whenToUse: ["A dataset capability is missing."], instructions: ["Create a declarative adapter and probe it."], requiredAdapterIds: ["sentinel2-sr"], createdBy: "pi",
    }) });
    assert.equal(skill.status, 201);
    const created: any = await (await fetch(`${base}/api/plans`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spec: spec({ investigationId: "api-local-export" }) }) })).json();
    const exportResponse = await fetch(`${base}/api/plans/${created.plan.planId}/export-local`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "vegetation", kind: "year", year: 2021, scaleMeters: 1000 }) });
    assert.equal(exportResponse.status, 202);
    const queued: any = await exportResponse.json();
    await workspace.waitForLocalExport(queued.jobId);
    const completed: any = await (await fetch(`${base}/api/jobs/${queued.jobId}`)).json();
    assert.equal(completed.state, "completed");
    assert.equal(completed.result.backend, "geedim");
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});
