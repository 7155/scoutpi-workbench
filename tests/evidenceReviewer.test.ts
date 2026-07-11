import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileInvestigation, type EarthAdapterPack, type EarthJob, type EarthStoryArtifact, type InvestigationPlan } from "../packages/earth-investigation-core/src/index.ts";
import type { BrowserEvidenceRecord, EvidenceRelation } from "../packages/runtime-evidence/src/index.ts";
import { reviewEvidence } from "../packages/runtime-evidence/src/reviewer.ts";

async function plan(): Promise<InvestigationPlan> {
  const pack = JSON.parse(await readFile("examples/adapter-packs/earth-engine-starter.json", "utf8")) as EarthAdapterPack;
  return compileInvestigation({
    schemaVersion: "scoutpi.investigation.v1",
    investigationId: "review-runtime-test",
    question: "Does the observable support the reported activity change?",
    region: { kind: "bbox", bbox: [121.4, 31.1, 121.5, 31.2], name: "Review test area" },
    period: { startYear: 2023, endYear: 2024 },
    hypotheses: [{ id: "h1", statement: "Night activity changed.", observableRoles: ["human_activity"], falsification: "A stable control and contradictory source would reject the claim." }],
    confounders: [],
  }, pack.adapters);
}

function job(planId: string, mode: "dry_run" | "live", state: EarthJob["state"] = "completed"): EarthJob {
  return { jobId: `job-${mode}`, planId, mode, state, createdAt: "2026-07-11T00:00:00.000Z", updatedAt: "2026-07-11T00:00:01.000Z", taskIds: [], artifactDir: `/tmp/${mode}` };
}

function evidence(id: string, relation: EvidenceRelation, options: { claimId?: string; year?: string; place?: string } = {}): BrowserEvidenceRecord {
  const payload: Omit<BrowserEvidenceRecord, "integrity"> = {
    schemaVersion: "scoutpi.browser.evidence.v1",
    evidenceId: id,
    source: { url: `https://example.com/${id}`, title: id, capturedAt: "2026-07-11T00:00:00.000Z", sourceType: "public_webpage", trust: "high" },
    claim: { text: "The source reports a change in the nighttime light activity proxy.", timeReferences: [options.year || "2024"], placeReferences: [options.place || "Review test area"] },
    browser: {},
    binding: { investigationId: "review-runtime-test", claimId: options.claimId || "claim-activity", hypothesisId: "h1", relation },
    artifacts: [],
    provenance: { importedAt: "2026-07-11T00:00:00.000Z", adapter: "canonical-v1", sourcePathHash: "a", sourceFingerprint: id },
  };
  return { ...payload, integrity: { payloadSha256: "test-only" } };
}

test("Evidence Reviewer blocks dry-run metrics, proxy overclaim and unsupported findings", async () => {
  const investigation = await plan();
  const dryRun = job(investigation.planId, "dry_run");
  const story: EarthStoryArtifact = {
    schemaVersion: "scoutpi.earth.story.v1",
    investigationId: investigation.spec.investigationId,
    question: investigation.spec.question,
    claims: [],
    findings: [{ hypothesisId: "h1", status: "supported", evidence: ["The computed metric proves GDP increased."] }],
    metrics: { gdp: { value: 12.5 } },
    layers: [], charts: [], uncertainties: [],
    provenance: { planId: investigation.planId, jobIds: [dryRun.jobId] },
  };
  const report = reviewEvidence({ plan: investigation, story, jobs: [dryRun], records: [] });
  const codes = new Set(report.issues.map((row) => row.code));
  assert.equal(report.status, "blocked");
  for (const code of ["dry_run_as_computed", "metrics_without_live_run", "unsupported_finding", "proxy_overclaim", "missing_counterevidence", "metric_unit_missing"]) assert.equal(codes.has(code as any), true, code);
});

test("Evidence Reviewer passes a provenance-bound live metric with support and counterevidence", async () => {
  const investigation = await plan();
  const live = job(investigation.planId, "live");
  const supporting = evidence("ev-support", "supports");
  const contradicting = evidence("ev-contradict", "contradicts", { claimId: "claim-counter" });
  const story: EarthStoryArtifact = {
    schemaVersion: "scoutpi.earth.story.v1",
    investigationId: investigation.spec.investigationId,
    question: investigation.spec.question,
    claims: [{ claimId: "claim-activity", claim: supporting.claim.text, sourceUrl: supporting.source.url, time: "2024", location: "Review test area", evidenceArtifact: supporting.evidenceId, trust: "primary" }],
    findings: [{ hypothesisId: "h1", status: "supported", evidence: ["The completed live metric shows the nighttime light activity proxy increased; contradictory evidence was reviewed."] }],
    metrics: { night_light_mean: { value: 4.2, unit: "nW cm-2 sr-1" } },
    layers: [], charts: [], uncertainties: ["Nighttime light is an activity proxy, not direct economic output."],
    provenance: { planId: investigation.planId, jobIds: [live.jobId] },
  };
  const report = reviewEvidence({ plan: investigation, story, jobs: [live], records: [supporting, contradicting] });
  assert.equal(report.status, "passed");
  assert.deepEqual(report.issues, []);
  assert.equal(report.summary.completedLiveJobs, 1);
  assert.equal(report.summary.contradictingSources, 1);
});

test("Evidence Reviewer exposes claim binding, time and place drift", async () => {
  const investigation = await plan();
  const mismatched = evidence("ev-mismatch", "contextualizes", { claimId: "other-claim", year: "2010", place: "Another region" });
  const story: EarthStoryArtifact = {
    schemaVersion: "scoutpi.earth.story.v1",
    investigationId: investigation.spec.investigationId,
    question: investigation.spec.question,
    claims: [{ claimId: "claim-activity", claim: mismatched.claim.text, sourceUrl: mismatched.source.url, evidenceArtifact: mismatched.evidenceId }],
    findings: [{ hypothesisId: "h1", status: "unknown", evidence: ["The available source is outside the requested space and time."] }],
    metrics: {}, layers: [], charts: [], uncertainties: ["No aligned evidence is available."], provenance: { planId: investigation.planId },
  };
  const report = reviewEvidence({ plan: investigation, story, jobs: [], records: [mismatched] });
  const codes = new Set(report.issues.map((row) => row.code));
  assert.equal(codes.has("claim_binding_mismatch"), true);
  assert.equal(codes.has("claim_time_mismatch"), true);
  assert.equal(codes.has("claim_place_mismatch"), true);
});
