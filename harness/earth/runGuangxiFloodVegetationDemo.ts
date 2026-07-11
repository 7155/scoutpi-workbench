import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { EarthWorkspace, type EarthAdapterPack, type InvestigationSpec } from "../../packages/earth-workspace/src/index.ts";

const live = process.argv.includes("--live");
const persist = process.argv.includes("--persist");
const root = persist ? resolve(".scoutpi/earth_workspace") : resolve("exports/earth_runs/guangxi_flood_vegetation_demo");
if (!persist) await rm(root, { recursive: true, force: true });

const workspace = new EarthWorkspace(root);
const starterPack = JSON.parse(await readFile(resolve("examples/adapter-packs/earth-engine-starter.json"), "utf8")) as EarthAdapterPack;
const investigation = JSON.parse(await readFile(resolve("examples/investigations/guangxi-hengzhou-flood-vegetation-2026.json"), "utf8")) as InvestigationSpec;
await workspace.importAdapterPack(starterPack, "example");

const planned = await workspace.plan(investigation);
if (live) {
  for (const datasetId of ["sentinel1-vv", "sentinel2-sr"]) {
    await workspace.probeAdapter(datasetId, { region: investigation.region, year: 2026 });
  }
}
const job = await workspace.run(planned.plan.planId, {
  mode: live ? "live" : "dry_run",
  execution: "inline",
  confirmed: live,
});
const impact = job.result?.impactAssessment as Record<string, unknown> | undefined;
const passed = job.state === "completed"
  && planned.plan.dag.some((node) => node.op === "impact_overlap")
  && (!live || (typeof impact?.affectedExposureAreaHa === "number" && typeof job.result?.impactAssessmentPath === "string"));

console.log(JSON.stringify({
  caseId: "guangxi_hengzhou_flood_vegetation_2026",
  mode: live ? "live" : "dry_run",
  passed,
  planId: planned.plan.planId,
  jobId: job.jobId,
  datasets: planned.plan.datasets.map((row) => ({ role: row.role, datasetId: row.dataset.datasetId })),
  impactNode: planned.plan.dag.find((node) => node.op === "impact_overlap"),
  impactAssessment: impact,
  artifacts: { plan: planned.path, job: job.artifactDir, impact: job.result?.impactAssessmentPath },
}, null, 2));
if (!passed) process.exitCode = 1;
