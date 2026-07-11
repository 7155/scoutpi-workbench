import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { URL } from "node:url";
import { EarthWorkspace, type EarthStoryArtifact, type InvestigationSpec } from "../../earth-workspace/src/index.ts";
import { AgentCheckpointStore } from "../../runtime-checkpoint/src/index.ts";
import { ContextPackStore } from "../../runtime-context/src/index.ts";
import { TriggerRuntime } from "../../runtime-trigger/src/index.ts";
import { SCOUTPI_MCP_PROFILE } from "../../scoutpi-mcp-server/src/profile.ts";

export interface EarthWorkspaceServerOptions {
  host?: string;
  port?: number;
  workspace?: EarthWorkspace;
  checkpointStore?: AgentCheckpointStore;
  contextStore?: ContextPackStore;
  triggerRuntime?: TriggerRuntime;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(`${JSON.stringify(value)}\n`);
}

async function readBody(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw Object.assign(new Error("Request body exceeds 1 MB"), { statusCode: 413, code: "BODY_TOO_LARGE" });
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("Request body must be valid JSON"), { statusCode: 400, code: "INVALID_JSON" }); }
}

function routeId(pathname: string, prefix: string, suffix = ""): string | null {
  if (!pathname.startsWith(prefix) || (suffix && !pathname.endsWith(suffix))) return null;
  const end = suffix ? -suffix.length : undefined;
  const value = decodeURIComponent(pathname.slice(prefix.length, end));
  return value && !value.includes("/") ? value : null;
}

export async function createEarthWorkspaceServer(options: EarthWorkspaceServerOptions = {}) {
  const host = options.host ?? process.env.SCOUTPI_EARTH_HOST ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.SCOUTPI_EARTH_PORT ?? 17420);
  const workspace = options.workspace ?? new EarthWorkspace();
  const checkpointStore = options.checkpointStore ?? new AgentCheckpointStore(process.env.SCOUTPI_CHECKPOINT_ROOT ?? join(dirname(workspace.root), "checkpoints"));
  const contextStore = options.contextStore ?? new ContextPackStore(process.env.SCOUTPI_CONTEXT_ROOT ?? join(dirname(workspace.root), "context"));
  const triggerRuntime = options.triggerRuntime ?? new TriggerRuntime(workspace, process.env.SCOUTPI_TRIGGER_ROOT ?? join(dirname(workspace.root), "triggers"));
  await workspace.init();
  await checkpointStore.init();
  await contextStore.init();
  await triggerRuntime.init();
  await workspace.recoverInterruptedJobs();

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", `http://${host}:${port}`);
    try {
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, service: "scoutpi-earth-workspace", root: workspace.root });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/environment") {
        sendJson(response, 200, await workspace.environment(url.searchParams.get("project") || undefined));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/mcp") {
        sendJson(response, 200, SCOUTPI_MCP_PROFILE);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/triggers") {
        sendJson(response, 200, { triggers: await triggerRuntime.listTriggers() });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/triggers") {
        sendJson(response, 201, await triggerRuntime.createDraft(await readBody(request)));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/trigger-runs") {
        sendJson(response, 200, { runs: await triggerRuntime.listRuns(url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/delegations") {
        const grants = (await triggerRuntime.listGrants(url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined)).map(({ signature: _signature, ...grant }) => grant);
        sendJson(response, 200, { grants });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/trigger-events") {
        sendJson(response, 202, await triggerRuntime.dispatchEvent(await readBody(request)));
        return;
      }
      const approveTriggerId = routeId(url.pathname, "/api/triggers/", "/approve");
      if (request.method === "POST" && approveTriggerId) {
        sendJson(response, 200, await triggerRuntime.approve(approveTriggerId, { principalId: "workbench:operator", kind: "human", displayName: "Workbench operator" }));
        return;
      }
      const stateTriggerId = routeId(url.pathname, "/api/triggers/", "/state");
      if (request.method === "POST" && stateTriggerId) {
        const body = await readBody(request);
        sendJson(response, 200, await triggerRuntime.setState(stateTriggerId, body.state));
        return;
      }
      const invokeTriggerId = routeId(url.pathname, "/api/triggers/", "/invoke");
      if (request.method === "POST" && invokeTriggerId) {
        const body = await readBody(request);
        sendJson(response, 202, await triggerRuntime.invoke(invokeTriggerId, String(body.idempotencyKey || "")));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/contracts") {
        sendJson(response, 200, workspace.contract());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/backends") {
        sendJson(response, 200, { backends: workspace.listBackendManifests() });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/telemetry") {
        sendJson(response, 200, await workspace.telemetrySummary(url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/telemetry/events") {
        sendJson(response, 200, { events: await workspace.recentTelemetry(url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/approvals") {
        sendJson(response, 200, { approvals: await workspace.listApprovals(url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/agent-runs") {
        sendJson(response, 200, { runs: await workspace.listAgentRuns(url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/checkpoints") {
        sendJson(response, 200, { checkpoints: await checkpointStore.list(url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/context/packs") {
        sendJson(response, 200, { packs: await contextStore.listPacks(url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/context/writebacks") {
        sendJson(response, 200, { writebacks: await contextStore.listWritebacks(url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined) });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/evidence") {
        sendJson(response, 200, { evidence: await workspace.listEvidence(url.searchParams.get("investigationId") || undefined, url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/evidence/import") {
        const body = await readBody(request);
        sendJson(response, 201, await workspace.importBrowserEvidence(String(body.path || ""), { binding: body.binding, timeReferences: body.timeReferences, placeReferences: body.placeReferences, runId: body.runId, snapshotId: body.snapshotId }));
        return;
      }
      const evidenceGraphId = routeId(url.pathname, "/api/evidence/graph/");
      if (request.method === "GET" && evidenceGraphId) {
        sendJson(response, 200, await workspace.evidenceGraph(evidenceGraphId));
        return;
      }
      const bindEvidenceId = routeId(url.pathname, "/api/evidence/", "/bind");
      if (request.method === "POST" && bindEvidenceId) {
        sendJson(response, 200, await workspace.bindEvidence(bindEvidenceId, await readBody(request)));
        return;
      }
      const contextPackId = routeId(url.pathname, "/api/context/packs/");
      if (request.method === "GET" && contextPackId) {
        sendJson(response, 200, await contextStore.getPack(contextPackId));
        return;
      }
      const checkpointSessionId = routeId(url.pathname, "/api/checkpoints/");
      if (request.method === "GET" && checkpointSessionId) {
        sendJson(response, 200, await checkpointStore.get(checkpointSessionId));
        return;
      }
      const agentRunId = routeId(url.pathname, "/api/agent-runs/");
      if (request.method === "GET" && agentRunId) {
        sendJson(response, 200, await workspace.getAgentRun(agentRunId));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/workflows") {
        sendJson(response, 200, { workflows: await workspace.listWorkflows() });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/workflows/compile") {
        sendJson(response, 201, await workspace.compileWorkflow(await readBody(request)));
        return;
      }
      const replayWorkflowId = routeId(url.pathname, "/api/workflows/", "/replay");
      if (request.method === "POST" && replayWorkflowId) {
        sendJson(response, 202, await workspace.replayWorkflow(replayWorkflowId, await readBody(request)));
        return;
      }
      const workflowId = routeId(url.pathname, "/api/workflows/");
      if (request.method === "GET" && workflowId) {
        sendJson(response, 200, await workspace.getWorkflow(workflowId));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/workflow-runs") {
        sendJson(response, 200, { runs: await workspace.listWorkflowRuns() });
        return;
      }
      const workflowRunId = routeId(url.pathname, "/api/workflow-runs/");
      if (request.method === "GET" && workflowRunId) {
        sendJson(response, 200, await workspace.refreshWorkflowReplay(workflowRunId));
        return;
      }
      const probeBackendId = routeId(url.pathname, "/api/backends/", "/probe");
      if (request.method === "POST" && probeBackendId) {
        sendJson(response, 200, await workspace.probeBackend(probeBackendId));
        return;
      }
      const contractId = routeId(url.pathname, "/api/contracts/");
      if (request.method === "GET" && contractId) {
        sendJson(response, 200, workspace.contract(contractId));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/catalog") {
        sendJson(response, 200, await workspace.catalogSearch({
          query: url.searchParams.get("q") || "earth observation",
          role: url.searchParams.get("role") || undefined,
          year: url.searchParams.has("year") ? Number(url.searchParams.get("year")) : undefined,
          limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
        }));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/adapters") {
        sendJson(response, 200, { adapters: await workspace.listAdapters() });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/adapters") {
        const body = await readBody(request);
        sendJson(response, 201, await workspace.registerAdapter(body.adapter || body, body.source || "human"));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/adapter-packs") {
        const body = await readBody(request);
        sendJson(response, 201, await workspace.importAdapterPack(body.pack || body, body.source || "import"));
        return;
      }
      const probeAdapterId = routeId(url.pathname, "/api/adapters/", "/probe");
      if (request.method === "POST" && probeAdapterId) {
        sendJson(response, 200, await workspace.probeAdapter(probeAdapterId, await readBody(request)));
        return;
      }
      const stateAdapterId = routeId(url.pathname, "/api/adapters/", "/state");
      if (request.method === "POST" && stateAdapterId) {
        const body = await readBody(request);
        if (typeof body.enabled !== "boolean") throw Object.assign(new Error("enabled must be boolean"), { statusCode: 400, code: "ADAPTER_STATE_INVALID" });
        sendJson(response, 200, await workspace.setAdapterEnabled(stateAdapterId, body.enabled));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/plans") {
        sendJson(response, 200, { plans: await workspace.listPlans() });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/plans") {
        const body = await readBody(request);
        sendJson(response, 201, await workspace.plan((body.spec ?? body) as InvestigationSpec));
        return;
      }
      const runPlanId = routeId(url.pathname, "/api/plans/", "/run");
      if (request.method === "POST" && runPlanId) {
        sendJson(response, 202, await workspace.run(runPlanId, await readBody(request)));
        return;
      }
      const localExportPlanId = routeId(url.pathname, "/api/plans/", "/export-local");
      if (request.method === "POST" && localExportPlanId) {
        sendJson(response, 202, await workspace.exportLocal(localExportPlanId, await readBody(request)));
        return;
      }
      const visualizePlanId = routeId(url.pathname, "/api/plans/", "/visualization");
      if (request.method === "GET" && visualizePlanId) {
        sendJson(response, 200, await workspace.visualize(visualizePlanId, {
          role: url.searchParams.get("role") || "",
          year: Number(url.searchParams.get("year")),
          cloudProject: url.searchParams.get("project") || undefined,
        }));
        return;
      }
      const planId = routeId(url.pathname, "/api/plans/");
      if (request.method === "GET" && planId) {
        sendJson(response, 200, await workspace.getPlan(planId));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/jobs") {
        sendJson(response, 200, { jobs: await workspace.listJobs() });
        return;
      }
      const jobArtifactsId = routeId(url.pathname, "/api/jobs/", "/artifacts");
      if (request.method === "GET" && jobArtifactsId) {
        sendJson(response, 200, { artifacts: await workspace.listJobArtifacts(jobArtifactsId) });
        return;
      }
      const jobArtifactMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/artifacts\/([^/]+)$/);
      if (request.method === "GET" && jobArtifactMatch) {
        const artifact = await workspace.readJobArtifact(decodeURIComponent(jobArtifactMatch[1]), decodeURIComponent(jobArtifactMatch[2]));
        response.writeHead(200, { "content-type": artifact.contentType, "content-length": artifact.content.length, "cache-control": "no-store", "x-content-type-options": "nosniff" });
        response.end(artifact.content);
        return;
      }
      const cancelJobId = routeId(url.pathname, "/api/jobs/", "/cancel");
      if (request.method === "POST" && cancelJobId) {
        const body = await readBody(request);
        sendJson(response, 200, await workspace.cancel(cancelJobId, body.cloudProject));
        return;
      }
      const retryJobId = routeId(url.pathname, "/api/jobs/", "/retry");
      if (request.method === "POST" && retryJobId) {
        const body = await readBody(request);
        sendJson(response, 202, await workspace.retryLocalExport(retryJobId, body.confirmed === true));
        return;
      }
      const jobId = routeId(url.pathname, "/api/jobs/");
      if (request.method === "GET" && jobId) {
        sendJson(response, 200, await workspace.status(jobId, url.searchParams.get("refresh") === "true"));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/stories") {
        sendJson(response, 200, { stories: await workspace.listStories() });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/stories") {
        sendJson(response, 201, await workspace.story(await readBody(request) as EarthStoryArtifact));
        return;
      }
      const storyId = routeId(url.pathname, "/api/stories/");
      if (request.method === "GET" && storyId) {
        sendJson(response, 200, await workspace.getStory(storyId));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/recipes") {
        sendJson(response, 200, { recipes: await workspace.listRecipes() });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/skills") {
        sendJson(response, 200, { skills: await workspace.listSkills() });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/skills") {
        sendJson(response, 201, await workspace.saveSkill(await readBody(request)));
        return;
      }
      const publishSkillId = routeId(url.pathname, "/api/skills/", "/publish");
      if (request.method === "POST" && publishSkillId) {
        const body = await readBody(request);
        sendJson(response, 200, await workspace.publishSkill(publishSkillId, body.confirmed === true));
        return;
      }
      const skillId = routeId(url.pathname, "/api/skills/");
      if (request.method === "GET" && skillId) {
        sendJson(response, 200, await workspace.getSkill(skillId));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/recipes") {
        sendJson(response, 201, await workspace.saveRecipe(await readBody(request)));
        return;
      }
      const instantiateRecipeId = routeId(url.pathname, "/api/recipes/", "/instantiate");
      if (request.method === "POST" && instantiateRecipeId) {
        const body = await readBody(request);
        sendJson(response, 201, await workspace.instantiateRecipe(instantiateRecipeId, body.patch || body));
        return;
      }
      const recipeId = routeId(url.pathname, "/api/recipes/");
      if (request.method === "GET" && recipeId) {
        sendJson(response, 200, await workspace.getRecipe(recipeId));
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/artifact") {
        const artifact = await workspace.readArtifact(url.searchParams.get("path") || "");
        response.writeHead(200, { "content-type": artifact.contentType, "content-length": artifact.content.length, "cache-control": "no-store" });
        response.end(artifact.content);
        return;
      }
      sendJson(response, 404, { ok: false, error: { code: "NOT_FOUND", message: `${request.method} ${url.pathname}` } });
    } catch (error) {
      const value = error as Error & { code?: string; statusCode?: number };
      const status = value.statusCode ?? (value.code === "ENOENT" ? 404 : value.code?.startsWith("TRIGGER_") || value.code?.includes("REQUIRED") ? 409 : value.code?.includes("INVALID") || value.code?.includes("BLOCKED") ? 400 : 500);
      sendJson(response, status, { ok: false, error: { code: value.code || "EARTH_SERVER_ERROR", message: value.message } });
    }
  });

  let supervisorTimer: ReturnType<typeof setInterval> | undefined;
  let supervisorRun: Promise<void> | undefined;
  const supervisorIntervalMs = Math.max(5_000, Math.min(60_000, Number(process.env.SCOUTPI_TRIGGER_POLL_MS || 15_000) || 15_000));
  const supervise = () => {
    if (supervisorRun) return;
    const current = triggerRuntime.tick().then(() => undefined).catch(() => undefined).finally(() => {
      if (supervisorRun === current) supervisorRun = undefined;
    });
    supervisorRun = current;
  };
  return {
    host,
    port,
    workspace,
    checkpointStore,
    contextStore,
    triggerRuntime,
    server,
    listen: () => new Promise<void>((resolve) => server.listen(port, host, () => {
      supervise();
      supervisorTimer = setInterval(supervise, supervisorIntervalMs);
      supervisorTimer.unref();
      resolve();
    })),
    close: async () => {
      if (supervisorTimer) clearInterval(supervisorTimer);
      await supervisorRun;
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
