import { Buffer } from "node:buffer";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { EarthJob, InvestigationPlan, InvestigationSpec } from "../../earth-investigation-core/src/index.ts";
import { EarthWorkspace } from "../../earth-workspace/src/index.ts";
import { SCOUTPI_MCP_PROFILE } from "./profile.ts";

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const artifactNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,160}$/;

function requiredId(value: string | undefined, label: string): string {
  if (!value || !idPattern.test(value) || value.includes("..")) throw Object.assign(new Error(`${label} is required and must be a safe identifier`), { code: "MCP_INPUT_INVALID" });
  return value;
}

function clipped(value: unknown, max = 180): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function planSummary(plan: InvestigationPlan) {
  return {
    planId: plan.planId,
    investigationId: plan.spec.investigationId,
    question: clipped(plan.spec.question),
    period: `${plan.spec.period.startYear}-${plan.spec.period.endYear}`,
    hypotheses: plan.spec.hypotheses.length,
    datasets: plan.datasets.map((item) => `${item.role}:${item.dataset.datasetId}`),
    blockingChecks: plan.criticChecks.filter((item) => item.severity === "blocking").length,
    requiresApproval: plan.estimatedCost.requiresApproval,
    createdAt: plan.createdAt,
  };
}

function jobSummary(job: EarthJob) {
  return {
    jobId: job.jobId,
    planId: job.planId,
    mode: job.mode,
    state: job.state,
    tasks: job.taskIds.length,
    error: job.error ? clipped(job.error, 240) : undefined,
    updatedAt: job.updatedAt,
  };
}

function textResult(label: string, value: unknown, links: Array<{ uri: string; name: string; mimeType?: string; description?: string }> = []): CallToolResult {
  return {
    content: [
      { type: "text", text: `${label}\n${JSON.stringify(value)}` },
      ...links.map((link) => ({ type: "resource_link" as const, ...link })),
    ],
  };
}

function errorResult(error: unknown): CallToolResult {
  const value = error as Error & { code?: string };
  return { isError: true, content: [{ type: "text", text: `${value.code || "SCOUTPI_MCP_ERROR"}: ${clipped(value.message || String(error), 500)}` }] };
}

function resourceUri(jobId: string, name: string): string {
  return `scoutpi://jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(name)}`;
}

function contentTypeForArtifact(kind: string): string {
  if (kind === "json") return "application/json";
  if (kind === "csv") return "text/csv";
  if (kind === "md") return "text/markdown";
  if (kind === "txt" || kind === "jsonl" || kind === "log") return "text/plain";
  if (kind === "png") return "image/png";
  if (kind === "jpg" || kind === "jpeg") return "image/jpeg";
  if (kind === "tif" || kind === "tiff") return "image/tiff";
  return "application/octet-stream";
}

function isTextMime(mimeType: string): boolean {
  return mimeType.startsWith("text/") || mimeType === "application/json" || mimeType.endsWith("+json");
}

export interface ScoutPiMcpServerOptions {
  workspace?: EarthWorkspace;
  workspaceRoot?: string;
  python?: string;
  resourceMaxBytes?: number;
}

export function createScoutPiMcpServer(options: ScoutPiMcpServerOptions = {}): { server: McpServer; workspace: EarthWorkspace } {
  const workspace = options.workspace ?? new EarthWorkspace(options.workspaceRoot, options.python);
  const configuredResourceMaxBytes = options.resourceMaxBytes ?? Number(process.env.SCOUTPI_MCP_RESOURCE_MAX_BYTES || 1024 * 1024);
  const resourceMaxBytes = Number.isFinite(configuredResourceMaxBytes) ? Math.max(1_024, Math.min(5 * 1024 * 1024, configuredResourceMaxBytes)) : 1024 * 1024;
  const server = new McpServer(
    { name: SCOUTPI_MCP_PROFILE.name, version: SCOUTPI_MCP_PROFILE.version },
    {
      instructions: "ScoutPi exposes compact investigation, status, artifact, and evidence gateways. This stdio surface never performs live Earth runs, exports, adapter changes, workflow publication, or approval bypass. Use Pi for governed state-changing work and fetch resource content only when the compact result is insufficient.",
    },
  );

  server.registerTool("scoutpi_investigation", {
    title: "ScoutPi Investigation",
    description: "List, inspect, compile, or dry-run a typed investigation. Live execution is intentionally unavailable over MCP.",
    inputSchema: z.object({
      op: z.enum(["list", "get", "plan", "dry_run"]),
      id: z.string().max(160).optional(),
      spec: z.unknown().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }).strict(),
    annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ op, id, spec, limit }, extra) => {
    try {
      if (op === "list") {
        const plans = (await workspace.listPlans()).slice(0, limit ?? 20).map(planSummary);
        return textResult(`plans=${plans.length}`, plans);
      }
      if (op === "get") {
        const plan = await workspace.getPlan(requiredId(id, "plan id"));
        return textResult(`plan=${plan.planId}`, await workspace.preview(plan.planId));
      }
      if (op === "plan") {
        if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw Object.assign(new Error("spec is required for plan"), { code: "MCP_INPUT_INVALID" });
        const created = await workspace.plan(spec as InvestigationSpec);
        return textResult(`plan=${created.plan.planId} created`, planSummary(created.plan));
      }
      const planId = requiredId(id, "plan id");
      const job = await workspace.run(planId, { mode: "dry_run", signal: extra.signal, suppressWorkflowCompile: true });
      return textResult(`dry_run=${job.jobId} ${job.state}`, jobSummary(job));
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("scoutpi_status", {
    title: "ScoutPi Runtime Status",
    description: "Read compact workspace, job, workflow, or backend-environment status.",
    inputSchema: z.object({
      op: z.enum(["overview", "jobs", "job", "workflows", "environment"]),
      id: z.string().max(160).optional(),
      refresh: z.boolean().optional(),
      cloudProject: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ op, id, refresh, cloudProject, limit }, extra) => {
    try {
      if (op === "overview") {
        const [plans, jobs, workflows, evidence] = await Promise.all([workspace.listPlans(), workspace.listJobs(), workspace.listWorkflows(), workspace.listEvidence(undefined, 1_000)]);
        return textResult("runtime overview", {
          plans: plans.length,
          jobs: jobs.length,
          running: jobs.filter((job) => job.state === "running").length,
          failed: jobs.filter((job) => job.state === "failed" || job.state === "blocked_auth").length,
          workflows: workflows.length,
          evidence: evidence.length,
        });
      }
      if (op === "jobs") {
        const jobs = (await workspace.listJobs()).slice(0, limit ?? 25).map(jobSummary);
        return textResult(`jobs=${jobs.length}`, jobs);
      }
      if (op === "job") {
        const job = await workspace.status(requiredId(id, "job id"), refresh === true, extra.signal);
        return textResult(`job=${job.jobId} ${job.state}`, jobSummary(job));
      }
      if (op === "workflows") {
        const workflows = (await workspace.listWorkflows()).slice(0, limit ?? 25).map((item) => ({ workflowId: item.workflowId, name: clipped(item.name), stage: item.stage, revision: item.revision, replayCount: item.replayCount, successCount: item.successCount, failureCount: item.failureCount }));
        return textResult(`workflows=${workflows.length}`, workflows);
      }
      return textResult("environment", await workspace.environment(cloudProject, extra.signal));
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("scoutpi_artifact", {
    title: "ScoutPi Artifact",
    description: "List job artifacts as MCP resource links or return a bounded text preview. Binary and large payloads stay out of tool context.",
    inputSchema: z.object({
      op: z.enum(["list", "preview"]),
      jobId: z.string().max(160),
      name: z.string().max(161).optional(),
      maxChars: z.number().int().min(256).max(8_000).optional(),
    }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ op, jobId: rawJobId, name, maxChars }) => {
    try {
      const jobId = requiredId(rawJobId, "job id");
      if (op === "list") {
        const artifacts = await workspace.listJobArtifacts(jobId);
        const compact = artifacts.map((artifact) => ({ name: artifact.name, bytes: artifact.size, kind: artifact.kind, uri: resourceUri(jobId, artifact.name) }));
        const links = compact.map((artifact) => ({ uri: artifact.uri, name: artifact.name, mimeType: contentTypeForArtifact(artifact.kind), description: `${artifact.bytes} bytes · ${artifact.kind}` }));
        return textResult(`artifacts=${compact.length} job=${jobId}`, compact, links);
      }
      if (!name || !artifactNamePattern.test(name) || name.includes("..")) throw Object.assign(new Error("artifact name is required for preview"), { code: "MCP_INPUT_INVALID" });
      const artifact = await workspace.readJobArtifact(jobId, name);
      if (!isTextMime(artifact.contentType)) return textResult(`artifact=${name} binary`, { uri: resourceUri(jobId, name), bytes: artifact.content.length, mimeType: artifact.contentType }, [{ uri: resourceUri(jobId, name), name, mimeType: artifact.contentType }]);
      const cap = maxChars ?? 4_000;
      const text = artifact.content.toString("utf8");
      return textResult(`artifact=${name} preview chars=${Math.min(cap, text.length)}/${text.length}`, { text: text.slice(0, cap), truncated: text.length > cap, uri: resourceUri(jobId, name) });
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("scoutpi_evidence", {
    title: "ScoutPi Evidence",
    description: "Read compact browser evidence records or an investigation evidence graph. Relations are explicit and dry runs are not computed evidence.",
    inputSchema: z.object({
      op: z.enum(["list", "graph"]),
      investigationId: z.string().max(160),
      limit: z.number().int().min(1).max(50).optional(),
    }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ op, investigationId: rawInvestigationId, limit }) => {
    try {
      const investigationId = requiredId(rawInvestigationId, "investigation id");
      if (op === "list") {
        const records = (await workspace.listEvidence(investigationId, limit ?? 20)).map((record) => ({ evidenceId: record.evidenceId, title: clipped(record.source.title), url: record.source.url, trust: record.source.trust, claim: clipped(record.claim.text, 280), hypothesisId: record.binding?.hypothesisId, relation: record.binding?.relation, capturedAt: record.source.capturedAt }));
        return textResult(`evidence=${records.length} investigation=${investigationId}`, records);
      }
      const graph = await workspace.evidenceGraph(investigationId);
      return textResult(`graph=${graph.graphId} coverage=${graph.coverage.coveredHypotheses}/${graph.coverage.hypotheses}`, { graphId: graph.graphId, updatedAt: graph.updatedAt, coverage: graph.coverage, nodes: graph.nodes.length, edges: graph.edges.length }, [{ uri: `scoutpi://investigations/${encodeURIComponent(investigationId)}/evidence`, name: `${investigationId} evidence graph`, mimeType: "application/json" }]);
    } catch (error) { return errorResult(error); }
  });

  const artifactTemplate = new ResourceTemplate("scoutpi://jobs/{jobId}/artifacts/{name}", {
    list: async () => {
      const resources = [];
      for (const job of (await workspace.listJobs()).slice(0, 25)) {
        for (const artifact of await workspace.listJobArtifacts(job.jobId)) {
          if (resources.length >= 100) break;
          resources.push({ uri: resourceUri(job.jobId, artifact.name), name: `${job.jobId}/${artifact.name}`, mimeType: contentTypeForArtifact(artifact.kind), description: `${artifact.size} bytes · ${artifact.kind}` });
        }
        if (resources.length >= 100) break;
      }
      return { resources };
    },
  });
  server.registerResource("job-artifact", artifactTemplate, { title: "ScoutPi job artifact", description: "Job-scoped artifact. Tool results return links before content is fetched." }, async (uri, variables): Promise<ReadResourceResult> => {
    const jobId = requiredId(String(variables.jobId), "job id");
    const name = decodeURIComponent(String(variables.name));
    if (!artifactNamePattern.test(name) || name.includes("..")) throw Object.assign(new Error("artifact name is invalid"), { code: "MCP_INPUT_INVALID" });
    const artifact = await workspace.readJobArtifact(jobId, name);
    if (artifact.content.length > resourceMaxBytes) throw Object.assign(new Error(`artifact exceeds MCP resource limit of ${resourceMaxBytes} bytes`), { code: "MCP_RESOURCE_TOO_LARGE" });
    if (isTextMime(artifact.contentType)) return { contents: [{ uri: uri.href, mimeType: artifact.contentType, text: artifact.content.toString("utf8") }] };
    return { contents: [{ uri: uri.href, mimeType: artifact.contentType, blob: artifact.content.toString("base64") }] };
  });

  const evidenceTemplate = new ResourceTemplate("scoutpi://investigations/{investigationId}/evidence", { list: undefined });
  server.registerResource("investigation-evidence", evidenceTemplate, { title: "ScoutPi evidence graph", description: "Canonical evidence graph for one investigation", mimeType: "application/json" }, async (uri, variables): Promise<ReadResourceResult> => {
    const graph = await workspace.evidenceGraph(requiredId(String(variables.investigationId), "investigation id"));
    const text = JSON.stringify(graph, null, 2);
    if (Buffer.byteLength(text) > resourceMaxBytes) throw Object.assign(new Error(`evidence graph exceeds MCP resource limit of ${resourceMaxBytes} bytes`), { code: "MCP_RESOURCE_TOO_LARGE" });
    return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
  });

  return { server, workspace };
}
