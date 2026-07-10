import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { EarthWorkspace, type EarthAdapterPack, type InvestigationSpec } from "../../packages/earth-workspace/src/index.ts";

const root = resolve("exports/earth_runs/dry_run_demo");
await rm(root, { recursive: true, force: true });
const workspace = new EarthWorkspace(root);
const starterPack = JSON.parse(await readFile(resolve("examples/adapter-packs/earth-engine-starter.json"), "utf8")) as EarthAdapterPack;
await workspace.importAdapterPack(starterPack, "example");
const investigation: InvestigationSpec = {
  schemaVersion: "scoutpi.investigation.v1",
  investigationId: "phenomenon-demo",
  question: "What changed in this region, and which observations support or contradict the hypotheses?",
  phenomenon: "generic_change",
  region: { kind: "bbox", bbox: [121.0, 30.9, 121.3, 31.2], name: "demo region" },
  period: { startYear: 2018, endYear: 2021, startMonth: 6, endMonth: 8 },
  hypotheses: [
    { id: "h_built", statement: "Built surface increased", observableRoles: ["built_surface"] },
    { id: "h_activity", statement: "Night activity increased", observableRoles: ["human_activity"] },
    { id: "h_vegetation", statement: "Vegetation changed", observableRoles: ["vegetation"] },
  ],
  confounders: ["Use the same season.", "Do not equate night lights with GDP."],
  preferredOutputs: ["yearly_csv", "metrics_json", "story"],
};

const planned = await workspace.plan(investigation);
const preview = await workspace.preview(planned.plan.planId);
const job = await workspace.run(planned.plan.planId, { mode: "dry_run" });
const result = {
  caseId: "pi_native_generic_earth_investigation",
  passed: job.state === "completed" && planned.plan.datasets.length === 3 && planned.plan.criticChecks.some((check) => check.checkId.includes("proxy-boundary")),
  scores: {
    typedInvestigation: 1,
    datasetRouter: Number(planned.plan.datasets.length === 3),
    executableDag: Number(planned.plan.dag.length > 10),
    evidenceCritic: Number(planned.plan.criticChecks.length > 0),
    artifactizedDryRun: Number(job.state === "completed"),
  },
  artifacts: { plan: planned.path, job: job.artifactDir },
  preview,
};
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
