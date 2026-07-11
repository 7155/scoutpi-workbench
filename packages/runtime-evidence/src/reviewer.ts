import { createHash } from "node:crypto";
import type { EarthJob, EarthStoryArtifact, InvestigationPlan } from "../../earth-investigation-core/src/index.ts";
import type { BrowserEvidenceRecord } from "./index.ts";

export type EvidenceReviewSeverity = "info" | "warning" | "blocking";
export type EvidenceReviewStatus = "passed" | "warning" | "blocked";

export interface EvidenceReviewIssue {
  issueId: string;
  code:
    | "unknown_hypothesis"
    | "missing_finding"
    | "unsupported_finding"
    | "dry_run_as_computed"
    | "metrics_without_live_run"
    | "provenance_plan_mismatch"
    | "provenance_job_missing"
    | "claim_binding_mismatch"
    | "claim_text_drift"
    | "claim_time_mismatch"
    | "claim_place_mismatch"
    | "proxy_overclaim"
    | "missing_counterevidence"
    | "metric_unit_missing";
  severity: EvidenceReviewSeverity;
  message: string;
  resolution: string;
  refs: { claimId?: string; hypothesisId?: string; jobId?: string; datasetId?: string; metricId?: string };
}

export interface EvidenceReviewReport {
  schemaVersion: "scoutpi.evidence-review.v1";
  reviewId: string;
  investigationId: string;
  planId: string;
  reviewedAt: string;
  status: EvidenceReviewStatus;
  summary: {
    blocking: number;
    warnings: number;
    info: number;
    claims: number;
    findings: number;
    referencedJobs: number;
    completedLiveJobs: number;
    supportingSources: number;
    contradictingSources: number;
  };
  issues: EvidenceReviewIssue[];
  provenance: { storySha256: string; evidenceIds: string[]; jobIds: string[] };
}

export interface EvidenceReviewInput {
  plan: InvestigationPlan;
  story: EarthStoryArtifact;
  jobs: EarthJob[];
  records: BrowserEvidenceRecord[];
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, " ").trim();
}

function referencedYears(values: string[]): number[] {
  return [...new Set(values.flatMap((value) => [...value.matchAll(/(?:19|20)\d{2}/g)].map((match) => Number(match[0]))))];
}

function assertsComputedEvidence(text: string): boolean {
  const value = normalized(text);
  if (/(?:not|no) computed|not measured|not calculated|未计算|没有计算|并非计算|尚未计算/.test(value)) return false;
  return /\b(?:computed|measured|calculated|metric|statistic|increase|increased|decrease|decreased|trend)\b|[%°]|计算结果|测得|指标|增长|下降|趋势/.test(value);
}

function storyJobIds(story: EarthStoryArtifact): string[] {
  const value = story.provenance as { jobId?: unknown; jobIds?: unknown };
  const ids = [
    ...(typeof value.jobId === "string" ? [value.jobId] : []),
    ...(Array.isArray(value.jobIds) ? value.jobIds.filter((item): item is string => typeof item === "string") : []),
  ];
  return [...new Set(ids)].slice(0, 100);
}

function issue(input: Omit<EvidenceReviewIssue, "issueId">): EvidenceReviewIssue {
  const issueId = `review_${createHash("sha256").update(JSON.stringify({ code: input.code, refs: input.refs })).digest("hex").slice(0, 16)}`;
  return { issueId, ...input };
}

function placeMatches(expected: string, references: string[]): boolean {
  const target = normalized(expected);
  return references.some((reference) => {
    const candidate = normalized(reference);
    return candidate.includes(target) || target.includes(candidate);
  });
}

export function reviewEvidence(input: EvidenceReviewInput): EvidenceReviewReport {
  const { plan, story, jobs, records } = input;
  const issues: EvidenceReviewIssue[] = [];
  const hypotheses = new Map(plan.spec.hypotheses.map((hypothesis) => [hypothesis.id, hypothesis]));
  const findings = new Map(story.findings.map((finding) => [finding.hypothesisId, finding]));
  const recordsById = new Map(records.map((record) => [record.evidenceId, record]));
  const jobsById = new Map(jobs.map((job) => [job.jobId, job]));
  const jobIds = storyJobIds(story);
  const referencedJobs = jobIds.map((jobId) => jobsById.get(jobId)).filter((job): job is EarthJob => Boolean(job));
  const completedLiveJobs = referencedJobs.filter((job) => job.mode === "live" && job.state === "completed" && job.planId === plan.planId);
  const hasMetrics = Object.keys(story.metrics || {}).length > 0;
  const storyPlanId = typeof story.provenance?.planId === "string" ? story.provenance.planId : undefined;

  if (hasMetrics && storyPlanId !== plan.planId) {
    issues.push(issue({ code: "provenance_plan_mismatch", severity: "blocking", message: "Computed metrics are not bound to the current investigation plan.", resolution: "Set provenance.planId to the exact plan that produced the metrics.", refs: {} }));
  }
  for (const jobId of jobIds) {
    const job = jobsById.get(jobId);
    if (!job || job.planId !== plan.planId) issues.push(issue({ code: "provenance_job_missing", severity: "blocking", message: `Referenced job ${jobId} is missing or belongs to another plan.`, resolution: "Reference only persisted jobs produced by the current plan.", refs: { jobId } }));
    else if (hasMetrics && job.mode === "dry_run") issues.push(issue({ code: "dry_run_as_computed", severity: "blocking", message: `Dry-run job ${jobId} cannot support computed metrics.`, resolution: "Run reviewed live computation or remove computed metrics and describe the result as a plan preview.", refs: { jobId } }));
  }
  if (hasMetrics && completedLiveJobs.length === 0) {
    issues.push(issue({ code: "metrics_without_live_run", severity: "blocking", message: "The story contains metrics but references no completed live job from this plan.", resolution: "Bind provenance.jobIds to completed live computation or remove the metrics.", refs: {} }));
  }

  for (const [metricId, metric] of Object.entries(story.metrics || {})) {
    if (metric && typeof metric === "object" && !Array.isArray(metric) && typeof (metric as { value?: unknown }).value === "number" && (typeof (metric as { unit?: unknown }).unit !== "string" || !(metric as { unit: string }).unit.trim())) {
      issues.push(issue({ code: "metric_unit_missing", severity: "warning", message: `Metric ${metricId} has a numeric value without a unit.`, resolution: "Add an explicit unit, or use unit=dimensionless when appropriate.", refs: { metricId } }));
    }
  }

  for (const claim of story.claims) {
    const record = claim.evidenceArtifact ? recordsById.get(claim.evidenceArtifact) : undefined;
    if (claim.evidenceArtifact && record?.binding?.claimId !== claim.claimId) {
      issues.push(issue({ code: "claim_binding_mismatch", severity: "blocking", message: `Claim ${claim.claimId} points to evidence bound to a different claim.`, resolution: "Rebind the evidence explicitly or use the binding's canonical claim ID.", refs: { claimId: claim.claimId } }));
    }
    if (record && normalized(record.claim.text) !== normalized(claim.claim)) {
      issues.push(issue({ code: "claim_text_drift", severity: "warning", message: `Claim ${claim.claimId} differs from its captured evidence statement.`, resolution: "Keep the canonical captured claim or record the interpretation as a separate finding.", refs: { claimId: claim.claimId } }));
    }
    const years = referencedYears([claim.time || "", ...(record?.claim.timeReferences || [])]);
    if (years.length && !years.some((year) => year >= plan.spec.period.startYear && year <= plan.spec.period.endYear)) {
      issues.push(issue({ code: "claim_time_mismatch", severity: "warning", message: `Claim ${claim.claimId} references time outside the analysis period.`, resolution: "Explain the temporal mismatch or adjust the investigation period.", refs: { claimId: claim.claimId } }));
    }
    const expectedPlace = plan.spec.region.name;
    const places = [claim.location || "", ...(record?.claim.placeReferences || [])].filter(Boolean);
    if (expectedPlace && places.length && !placeMatches(expectedPlace, places)) {
      issues.push(issue({ code: "claim_place_mismatch", severity: "warning", message: `Claim ${claim.claimId} does not reference the named investigation region.`, resolution: "Bind location evidence for the same region or mark the claim as contextual only.", refs: { claimId: claim.claimId } }));
    }
  }

  for (const finding of story.findings) {
    const hypothesis = hypotheses.get(finding.hypothesisId);
    if (!hypothesis) {
      issues.push(issue({ code: "unknown_hypothesis", severity: "blocking", message: `Finding ${finding.hypothesisId} is not declared by the current plan.`, resolution: "Use a hypothesis ID from the persisted InvestigationSpec.", refs: { hypothesisId: finding.hypothesisId } }));
      continue;
    }
    const related = records.filter((record) => record.binding?.hypothesisId === finding.hypothesisId);
    const supports = related.filter((record) => record.binding?.relation === "supports");
    const contradicts = related.filter((record) => record.binding?.relation === "contradicts");
    const anyDocument = related.length > 0;
    const hasLive = completedLiveJobs.length > 0 && plan.datasets.some((dataset) => dataset.hypothesisIds.includes(finding.hypothesisId));
    const evidenceText = finding.evidence.join(" ");
    if (assertsComputedEvidence(evidenceText) && !hasLive) {
      issues.push(issue({ code: "dry_run_as_computed", severity: "blocking", message: `Finding ${finding.hypothesisId} uses computed-result language without a referenced completed live run.`, resolution: "Reference the completed live job or rewrite the finding as an uncomputed hypothesis/plan result.", refs: { hypothesisId: finding.hypothesisId } }));
    }
    const supported = finding.status === "supported" && (supports.length > 0 || hasLive);
    const notSupported = finding.status === "not_supported" && (contradicts.length > 0 || hasLive);
    const mixed = finding.status === "mixed" && (anyDocument || hasLive);
    if ((finding.status === "supported" && !supported) || (finding.status === "not_supported" && !notSupported) || (finding.status === "mixed" && !mixed)) {
      issues.push(issue({ code: "unsupported_finding", severity: "blocking", message: `Finding ${finding.hypothesisId} has no evidence relation or completed computation matching status ${finding.status}.`, resolution: "Attach supporting/contradicting evidence, reference a completed live job, or use status unknown.", refs: { hypothesisId: finding.hypothesisId } }));
    }
    if (finding.status === "supported" && hypothesis.falsification?.trim() && contradicts.length === 0) {
      issues.push(issue({ code: "missing_counterevidence", severity: "warning", message: `Supported finding ${finding.hypothesisId} does not include evidence against its falsification condition.`, resolution: "Search for contradictory evidence or document why the falsification test could not be run.", refs: { hypothesisId: finding.hypothesisId } }));
    }
  }
  for (const hypothesisId of hypotheses.keys()) {
    if (!findings.has(hypothesisId)) issues.push(issue({ code: "missing_finding", severity: "blocking", message: `Hypothesis ${hypothesisId} has no EarthStory finding.`, resolution: "Add a finding with supported, mixed, not_supported, or unknown status.", refs: { hypothesisId } }));
  }

  const claimText = normalized([...story.claims.map((claim) => claim.claim), ...story.findings.flatMap((finding) => finding.evidence)].join(" "));
  for (const dataset of plan.datasets) {
    for (const guardrail of dataset.dataset.guardrails || []) {
      const rule = guardrail.claimRule;
      if (!rule) continue;
      const forbidden = rule.forbiddenTerms.find((term) => claimText.includes(normalized(term)));
      const qualified = (rule.requiredQualifiers || []).some((term) => claimText.includes(normalized(term)));
      if (forbidden && !qualified) {
        issues.push(issue({ code: "proxy_overclaim", severity: guardrail.severity, message: guardrail.message, resolution: guardrail.resolution || "Use the adapter's allowed proxy interpretation and add independent evidence.", refs: { datasetId: dataset.dataset.datasetId } }));
      }
    }
  }

  const counts = {
    blocking: issues.filter((row) => row.severity === "blocking").length,
    warnings: issues.filter((row) => row.severity === "warning").length,
    info: issues.filter((row) => row.severity === "info").length,
  };
  const supportingSources = records.filter((record) => record.binding?.relation === "supports").length;
  const contradictingSources = records.filter((record) => record.binding?.relation === "contradicts").length;
  const storySha256 = createHash("sha256").update(JSON.stringify(story)).digest("hex");
  return {
    schemaVersion: "scoutpi.evidence-review.v1",
    reviewId: `evidence-review:${story.investigationId}:${storySha256.slice(0, 12)}`,
    investigationId: story.investigationId,
    planId: plan.planId,
    reviewedAt: new Date().toISOString(),
    status: counts.blocking ? "blocked" : counts.warnings ? "warning" : "passed",
    summary: { ...counts, claims: story.claims.length, findings: story.findings.length, referencedJobs: referencedJobs.length, completedLiveJobs: completedLiveJobs.length, supportingSources, contradictingSources },
    issues,
    provenance: { storySha256, evidenceIds: records.map((record) => record.evidenceId).sort(), jobIds: jobIds.sort() },
  };
}
