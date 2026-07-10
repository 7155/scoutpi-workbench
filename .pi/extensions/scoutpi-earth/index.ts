import type { AgentToolResult, AgentToolUpdateCallback, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { EarthWorkspace, earthOperationRisk, type EarthStoryArtifact, type InvestigationSpec } from "../../../packages/earth-workspace/src/index.ts";
import { formatPiEcosystemProfile, inspectPiEcosystem } from "../../../packages/pi-ecosystem/src/index.ts";

interface EarthToolDetails {
  phase?: string;
  operation?: string;
  artifactPath?: string;
  [key: string]: unknown;
}

const EarthWorkspaceSchema = Type.Object({
  op: Type.String({ minLength: 2, maxLength: 64 }),
  id: Type.Optional(Type.String({ maxLength: 160 })),
  query: Type.Optional(Type.String({ maxLength: 2_000 })),
  role: Type.Optional(Type.String({ maxLength: 80 })),
  year: Type.Optional(Type.Number()),
  payload: Type.Optional(Type.Unknown()),
  options: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
}, { additionalProperties: false });

const PythonAnalysisSchema = Type.Object({
  path: Type.String({ minLength: 1, maxLength: 2_000 }),
  columns: Type.Optional(Type.Array(Type.String({ maxLength: 160 }), { maxItems: 100 })),
}, { additionalProperties: false });

const EarthStorySchema = Type.Object({ story: Type.Unknown() }, { additionalProperties: false });

type EarthWorkspaceInput = Static<typeof EarthWorkspaceSchema>;

function objectOf(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function prepareEarthArguments(value: unknown): EarthWorkspaceInput {
  const input = objectOf(value);
  const payload = input.payload ?? input.spec ?? input.adapter ?? input.pack ?? input.skill;
  const options = { ...objectOf(input.options) };
  if (input.confirmed !== undefined) options.confirmed = input.confirmed;
  return {
    op: String(input.op || ""),
    ...(input.id === undefined ? {} : { id: String(input.id) }),
    ...(input.query === undefined ? {} : { query: String(input.query) }),
    ...(input.role === undefined ? {} : { role: String(input.role) }),
    ...(input.year === undefined ? {} : { year: Number(input.year) }),
    ...(payload === undefined ? {} : { payload }),
    ...(Object.keys(options).length ? { options } : {}),
  };
}

function compact(text: string, details: EarthToolDetails = {}): AgentToolResult<EarthToolDetails> {
  return { content: [{ type: "text", text: text.slice(0, 1_800) }], details };
}

function resultText(result: AgentToolResult<EarthToolDetails>): string {
  const first = result.content[0];
  return first?.type === "text" ? first.text : "";
}

function update(onUpdate: AgentToolUpdateCallback<EarthToolDetails> | undefined, phase: string, text: string): void {
  onUpdate?.(compact(text, { phase }));
}

function codeOf(error: unknown): string {
  return String((error as any)?.code || (error instanceof Error ? error.message.split(":", 1)[0] : "EARTH_TOOL_FAILED")).slice(0, 120);
}

function profileForPrompt(prompt: string): string[] {
  const tools = ["earth_workspace"];
  if (/analysis|analy[sz]e|metric|csv|统计|分析|数值|校验/i.test(prompt)) tools.push("python_analysis");
  if (/story|report|claim|evidence|conclusion|报告|结论|证据|叙事/i.test(prompt)) tools.push("earth_story");
  return tools;
}

export default async function setup(pi: ExtensionAPI): Promise<void> {
  const workspace = new EarthWorkspace();
  await workspace.init();
  await workspace.recoverInterruptedJobs();

  const setEarthProfile = (names: string[]): void => {
    const earthNames = new Set(["earth_workspace", "python_analysis", "earth_story"]);
    const peers = pi.getActiveTools().filter((name) => !earthNames.has(name));
    pi.setActiveTools([...new Set([...peers, ...names])]);
  };

  pi.registerTool({
    name: "earth_workspace",
    label: "Earth Workspace",
    description: "Plan, verify and supervise a typed Earth investigation. Request detailed contracts only when needed; full outputs stay in artifacts.",
    promptSnippet: "Use earth_workspace for Earth investigation planning, verified execution, artifacts and deterministic workflow replay.",
    parameters: EarthWorkspaceSchema,
    prepareArguments: prepareEarthArguments,
    executionMode: "sequential",
    async execute(toolCallId, input, signal, onUpdate, _ctx) {
      const started = performance.now();
      const options = objectOf(input.options);
      const payload = objectOf(input.payload);
      const respond = async (text: string, details: EarthToolDetails = {}): Promise<AgentToolResult<EarthToolDetails>> => {
        const result = compact(text, { operation: input.op, ...details });
        await workspace.recordToolTelemetry(input.op, input, resultText(result), performance.now() - started, "ok", toolCallId);
        return result;
      };
      try {
        const risk = earthOperationRisk(input as Record<string, unknown>);
        if (risk) {
          update(onUpdate, "approval", "Validating the user approval receipt...");
          await workspace.approvals.consume(String(options.approvalId || ""), {
            toolCallId,
            operation: `earth_workspace:${input.op}`,
            parameters: input as Record<string, unknown>,
          });
        }
        delete options.approvalId;
        delete options.confirmed;
        if (signal?.aborted) throw Object.assign(new Error("EARTH_TOOL_CANCELLED"), { code: "EARTH_TOOL_CANCELLED" });

        if (input.op === "environment") {
          update(onUpdate, "environment", "Checking the Earth runtime...");
          const result = await workspace.environment(options.cloudProject, signal);
          return await respond(`environment installed=${result.installed} authenticated=${result.authenticated}${result.project ? ` project=${result.project}` : ""}${result.code ? ` code=${result.code}` : ""}`, { installed: result.installed, authenticated: result.authenticated, project: result.project, code: result.code });
        }
        if (input.op === "telemetry") {
          const summary = await workspace.telemetrySummary(options.limit);
          return await respond(`telemetry events=${summary.eventCount} tool_calls=${summary.calls.piTool} backend_calls=${summary.calls.backend} workflow_calls=${summary.calls.workflow} tokens≈${summary.estimatedTokens.total} elapsed_ms=${summary.elapsedMs} cache_hits=${summary.cache.hits}/${summary.cache.hits + summary.cache.misses}`, { eventCount: summary.eventCount, estimatedTokens: summary.estimatedTokens, cache: summary.cache, cost: summary.cost });
        }
        if (input.op === "contract") {
          const result = workspace.contract(input.id);
          return await respond(`contract ${input.id || "index"}\n${JSON.stringify(result)}`, { contract: input.id || "index" });
        }
        if (input.op === "backend_list") {
          const manifests = workspace.listBackendManifests();
          return await respond(`backends=${manifests.length}\n${manifests.map((manifest) => `${manifest.backendId}@${manifest.version} operations=${manifest.operations.length} capabilities=${manifest.capabilities.join(",")}`).join("\n")}`, { backendIds: manifests.map((manifest) => manifest.backendId) });
        }
        if (input.op === "backend_probe") {
          update(onUpdate, "backend_probe", `Probing backend ${input.id || ""}...`);
          const probe = await workspace.probeBackend(String(input.id || ""), signal);
          return await respond(`backend probe id=${probe.backendId} available=${probe.available} version=${probe.version || "unknown"}${probe.reason ? ` reason=${probe.reason}` : ""}`, { backendId: probe.backendId, available: probe.available, version: probe.version });
        }
        if (input.op === "catalog_search") {
          const result = await workspace.catalogSearch({ query: String(input.query || ""), role: input.role, year: options.year, limit: options.limit });
          return await respond(`catalog ok registered=${result.registeredAdapters} matches=${result.datasets.length}\n${result.datasets.map((row) => `${row.datasetId} ${row.title} roles=${row.roles.join(",")}`).join("\n")}`, { datasetIds: result.datasets.map((row) => row.datasetId), registeredAdapters: result.registeredAdapters });
        }
        if (input.op === "adapter_register") {
          const stored = await workspace.registerAdapter(payload as any, "pi");
          return await respond(`adapter registered id=${stored.adapter.datasetId} revision=${stored.revision} fingerprint=${stored.fingerprint.slice(0, 12)}`, { datasetId: stored.adapter.datasetId, revision: stored.revision, fingerprint: stored.fingerprint });
        }
        if (input.op === "adapter_import") {
          const result = await workspace.importAdapterPack(payload as any, "pi");
          return await respond(`adapter pack imported id=${result.packId} count=${result.registered.length}\n${result.registered.map((row) => row.adapter.datasetId).join("\n")}`, { packId: result.packId, datasetIds: result.registered.map((row) => row.adapter.datasetId) });
        }
        if (input.op === "adapter_list") {
          const adapters = await workspace.listAdapters();
          return await respond(`adapters=${adapters.length}\n${adapters.map((row) => `${row.adapter.datasetId} rev=${row.revision} enabled=${row.enabled} verify=${row.verification.status} roles=${row.adapter.roles.join(",")}`).join("\n")}`, { datasetIds: adapters.map((row) => row.adapter.datasetId) });
        }
        if (input.op === "adapter_probe") {
          update(onUpdate, "adapter_probe", `Validating ${input.id || "adapter"} against Earth Engine...`);
          const stored = await workspace.probeAdapter(String(input.id || ""), { region: options.region, year: options.year, cloudProject: options.cloudProject, signal });
          return await respond(`adapter probe id=${stored.adapter.datasetId} status=${stored.verification.status} sample=${stored.verification.sampleTime || "n/a"} requested_bands=${stored.verification.requestedBands?.length || 0}${stored.verification.error ? ` error=${stored.verification.error}` : ""}`, { datasetId: stored.adapter.datasetId, status: stored.verification.status, sampleTime: stored.verification.sampleTime, requestedBands: stored.verification.requestedBands });
        }
        if (input.op === "adapter_enable" || input.op === "adapter_disable") {
          const stored = await workspace.setAdapterEnabled(String(input.id || ""), input.op === "adapter_enable");
          return await respond(`adapter state id=${stored.adapter.datasetId} enabled=${stored.enabled}`, { datasetId: stored.adapter.datasetId, enabled: stored.enabled });
        }
        if (input.op === "skill_save") {
          const result = await workspace.saveSkill(payload as any);
          return await respond(`skill saved id=${result.skill.skillId}\nmarkdown=${result.markdownPath}`, { skillId: result.skill.skillId, artifactPath: result.markdownPath });
        }
        if (input.op === "skill_list") {
          const skills = await workspace.listSkills();
          return await respond(`skills=${skills.length}\n${skills.map((row) => `${row.skillId} ${row.name}`).join("\n")}`, { skillIds: skills.map((row) => row.skillId) });
        }
        if (input.op === "skill_publish") {
          const result = await workspace.publishSkill(String(input.id || ""), true);
          return await respond(`skill published id=${result.skillId} reload_required=${result.reloadRequired}\npath=${result.path}`, { skillId: result.skillId, path: result.path, reloadRequired: true });
        }
        if (input.op === "evidence_import") {
          update(onUpdate, "evidence_import", "Validating and importing BrowserBridge evidence...");
          const path = String(options.path || payload.path || "");
          const result = await workspace.importBrowserEvidence(path, {
            binding: objectOf(options.binding || payload.binding),
            timeReferences: Array.isArray(options.timeReferences) ? options.timeReferences.map(String) : undefined,
            placeReferences: Array.isArray(options.placeReferences) ? options.placeReferences.map(String) : undefined,
            runId: options.runId ? String(options.runId) : undefined,
            snapshotId: options.snapshotId ? String(options.snapshotId) : undefined,
          });
          return await respond(`evidence imported=${result.imported} deduplicated=${result.deduplicated}\n${result.records.map((record) => `${record.evidenceId} ${record.source.title}`).join("\n")}`, { evidenceIds: result.records.map((record) => record.evidenceId), imported: result.imported, deduplicated: result.deduplicated });
        }
        if (input.op === "evidence_bind") {
          const record = await workspace.bindEvidence(String(input.id || ""), objectOf(options.binding || payload.binding));
          return await respond(`evidence bound id=${record.evidenceId} investigation=${record.binding?.investigationId || "n/a"} claim=${record.binding?.claimId || "n/a"} relation=${record.binding?.relation || "n/a"}`, { evidenceId: record.evidenceId, binding: record.binding });
        }
        if (input.op === "evidence_list") {
          const investigationId = input.id || (options.investigationId ? String(options.investigationId) : undefined);
          const records = await workspace.listEvidence(investigationId, options.limit ? Number(options.limit) : undefined);
          return await respond(`evidence=${records.length}${investigationId ? ` investigation=${investigationId}` : ""}\n${records.map((record) => `${record.evidenceId} trust=${record.source.trust} claim=${record.claim.text.slice(0, 120)}`).join("\n")}`, { evidenceIds: records.map((record) => record.evidenceId), investigationId });
        }
        if (input.op === "evidence_graph") {
          const graph = await workspace.evidenceGraph(String(input.id || options.investigationId || ""));
          return await respond(`evidence graph investigation=${graph.investigationId} nodes=${graph.nodes.length} edges=${graph.edges.length} browser=${graph.coverage.browserEvidence} computed=${graph.coverage.computedRuns} covered=${graph.coverage.coveredHypotheses}/${graph.coverage.hypotheses}`, { investigationId: graph.investigationId, graphId: graph.graphId, coverage: graph.coverage });
        }
        if (input.op === "plan") {
          update(onUpdate, "plan", "Compiling the InvestigationSpec into a dataset plan and analysis graph...");
          const result = await workspace.plan(payload as InvestigationSpec);
          return await respond(`plan ok id=${result.plan.planId} datasets=${result.plan.datasets.length} nodes=${result.plan.dag.length} approval=${result.plan.estimatedCost.requiresApproval}\nartifact=${result.path}`, { planId: result.plan.planId, artifactPath: result.path });
        }
        if (input.op === "preview") {
          const result = await workspace.preview(String(input.id || ""));
          return await respond(`preview ok id=${input.id} datasets=${(result.datasets as any[]).length} checks=${(result.criticChecks as any[]).length}\n${(result.datasets as any[]).map((row) => `${row.role}:${row.datasetId}`).join(" ")}`, { planId: input.id });
        }
        if (input.op === "visualize") {
          update(onUpdate, "visualize", "Creating a short-lived Earth Engine tile contract...");
          const layer = await workspace.visualize(String(input.id || ""), { role: String(input.role || ""), year: Number(input.year), cloudProject: options.cloudProject, signal });
          return await respond(`visualization ready plan=${layer.planId} role=${layer.role} year=${layer.year} dataset=${layer.datasetId} cache=${layer.cacheHit ? "hit" : "miss"}`, { planId: layer.planId, role: layer.role, year: layer.year, mapId: layer.mapId });
        }
        if (input.op === "run") {
          update(onUpdate, "run", options.mode === "live" ? "Submitting the approved Earth Engine run..." : "Executing a deterministic dry run...");
          const job = await workspace.run(String(input.id || ""), { ...options, signal, confirmed: risk !== undefined, confirmedUnverifiedAdapters: options.confirmedUnverifiedAdapters === true });
          return await respond(`run ${job.state} job=${job.jobId} mode=${job.mode} tasks=${job.taskIds.length}\nartifact=${job.artifactDir}${job.result?.workflowCandidate ? `\nworkflow_candidate=${(job.result.workflowCandidate as any).workflowId}` : ""}${job.error ? `\nerror=${job.error}` : ""}`, { jobId: job.jobId, state: job.state, artifactPath: job.artifactDir, workflowCandidate: job.result?.workflowCandidate });
        }
        if (input.op === "status") {
          const job = await workspace.status(String(input.id || ""), options.refresh === true, signal);
          return await respond(`status job=${job.jobId} state=${job.state} tasks=${job.taskIds.length}${job.error ? ` error=${job.error}` : ""}`, { jobId: job.jobId, state: job.state, artifactPath: job.artifactDir });
        }
        if (input.op === "cancel") {
          const job = await workspace.cancel(String(input.id || ""), options.cloudProject);
          return await respond(`cancel job=${job.jobId} state=${job.state}`, { jobId: job.jobId, state: job.state, artifactPath: job.artifactDir });
        }
        if (input.op === "retry") {
          const job = await workspace.retryLocalExport(String(input.id || ""), true);
          return await respond(`retry queued job=${job.jobId} state=${job.state}\nartifact=${job.artifactDir}`, { jobId: job.jobId, state: job.state, artifactPath: job.artifactDir });
        }
        if (input.op === "artifacts") {
          const artifacts = await workspace.listJobArtifacts(String(input.id || ""));
          return await respond(`artifacts job=${input.id} count=${artifacts.length}\n${artifacts.map((item) => `${item.name} ${item.size}B`).join("\n")}`, { jobId: input.id, artifactNames: artifacts.map((item) => item.name) });
        }
        if (input.op === "export") {
          update(onUpdate, "export", "Submitting the approved Google Drive export...");
          const job = await workspace.run(String(input.id || ""), { ...options, signal, mode: "live", execution: "drive", confirmed: true, confirmedUnverifiedAdapters: options.confirmedUnverifiedAdapters === true });
          return await respond(`export ${job.state} job=${job.jobId} tasks=${job.taskIds.length}\nartifact=${job.artifactDir}${job.error ? `\nerror=${job.error}` : ""}`, { jobId: job.jobId, state: job.state, taskIds: job.taskIds, artifactPath: job.artifactDir });
        }
        if (input.op === "export_local") {
          update(onUpdate, "export_local", "Queueing the approved supervised GeoTIFF export...");
          const job = await workspace.exportLocal(String(input.id || ""), { ...options, role: String(input.role || options.role || ""), kind: String(options.kind || "year") as "year" | "change", year: input.year ?? options.year, confirmed: true });
          return await respond(`local export queued job=${job.jobId} state=${job.state} backend=geedim\nartifact=${job.artifactDir}`, { jobId: job.jobId, state: job.state, artifactPath: job.artifactDir });
        }
        if (input.op === "save_recipe") {
          const recipe = await workspace.saveRecipe((Object.keys(payload).length ? payload : options.recipe) as any);
          return await respond(`recipe saved id=${recipe.recipeId}`, { recipeId: recipe.recipeId });
        }
        if (input.op === "load_recipe") {
          const spec = await workspace.loadRecipe(String(input.id || ""), options.patch || {});
          const result = await workspace.plan(spec);
          return await respond(`recipe loaded id=${input.id} plan=${result.plan.planId}\nartifact=${result.path}`, { recipeId: input.id, planId: result.plan.planId, artifactPath: result.path });
        }
        if (input.op === "list_recipes") {
          const recipes = await workspace.listRecipes();
          return await respond(`recipes=${recipes.length}\n${recipes.map((row) => `${row.recipeId} ${row.name}`).join("\n")}`, { recipeIds: recipes.map((row) => row.recipeId) });
        }
        if (input.op === "workflow_compile") {
          update(onUpdate, "workflow_compile", "Compiling the successful trace into a deterministic workflow contract...");
          const result = await workspace.compileWorkflow({
            workflowId: String(input.id || options.workflowId || ""),
            name: String(options.name || payload.name || "Compiled investigation workflow"),
            description: options.description ? String(options.description) : undefined,
            planId: String(options.planId || payload.planId || ""),
            jobId: options.jobId ? String(options.jobId) : undefined,
            confirmedBlockingChecks: risk !== undefined,
            stage: "ready",
          });
          return await respond(`workflow compiled id=${result.stored.workflow.workflowId} revision=${result.stored.revision} fingerprint=${result.stored.fingerprint.slice(0, 12)} stage=${result.stored.stage}\nartifact=${result.path}`, { workflowId: result.stored.workflow.workflowId, revision: result.stored.revision, fingerprint: result.stored.fingerprint, artifactPath: result.path });
        }
        if (input.op === "workflow_list") {
          const workflows = await workspace.listWorkflows();
          return await respond(`workflows=${workflows.length}\n${workflows.map((workflow) => `${workflow.workflowId} rev=${workflow.revision} stage=${workflow.stage} replay=${workflow.replayCount} success=${workflow.successCount}`).join("\n")}`, { workflowIds: workflows.map((workflow) => workflow.workflowId) });
        }
        if (input.op === "workflow_replay") {
          update(onUpdate, "workflow_replay", "Checking workflow preconditions and adapter fingerprints...");
          const result = await workspace.replayWorkflow(String(input.id || ""), { patch: options.patch, confirmed: true, confirmedCostIncrease: options.confirmedCostIncrease === true, cloudProject: options.cloudProject, signal });
          return await respond(`workflow replay ${result.replay.state} replay=${result.replay.replayId} plan=${result.replay.planId || "n/a"} job=${result.replay.jobId || "n/a"}`, { workflowId: input.id, replayId: result.replay.replayId, state: result.replay.state, planId: result.replay.planId, jobId: result.replay.jobId });
        }
        if (input.op === "workflow_status") {
          const replay = await workspace.refreshWorkflowReplay(String(input.id || ""));
          return await respond(`workflow status replay=${replay.replayId} state=${replay.state} plan=${replay.planId || "n/a"} job=${replay.jobId || "n/a"}${replay.error ? ` error=${replay.error}` : ""}`, { replayId: replay.replayId, workflowId: replay.workflowId, state: replay.state, planId: replay.planId, jobId: replay.jobId });
        }
        throw Object.assign(new Error(`INVALID_OPERATION: ${input.op}`), { code: "INVALID_OPERATION" });
      } catch (error) {
        await workspace.recordToolTelemetry(input.op || "invalid", input, { errorCode: codeOf(error) }, performance.now() - started, signal?.aborted ? "failed" : "failed", toolCallId, codeOf(error));
        throw error;
      }
    },
  });

  pi.registerTool({
    name: "python_analysis",
    label: "Python Analysis",
    description: "Deterministically validate exported CSV or JSON metrics and write a compact statistical artifact.",
    parameters: PythonAnalysisSchema,
    executionMode: "sequential",
    async execute(toolCallId, input, signal, onUpdate) {
      const started = performance.now();
      try {
        update(onUpdate, "python_analysis", "Validating the exported data with the reviewed local backend...");
        const result = await workspace.analyze(input.path, input.columns, signal);
        const summary = result.summary as any;
        const output = compact(`analysis ok rows=${summary.rowCount} columns=${Object.keys(summary.columns || {}).length}\nartifact=${result.artifact}`, { operation: "python_analysis", artifactPath: String(result.artifact), rowCount: summary.rowCount });
        await workspace.recordToolTelemetry("python_analysis", input, resultText(output), performance.now() - started, "ok", toolCallId);
        return output;
      } catch (error) {
        await workspace.recordToolTelemetry("python_analysis", input, { errorCode: codeOf(error) }, performance.now() - started, "failed", toolCallId, codeOf(error));
        throw error;
      }
    },
  });

  pi.registerTool({
    name: "earth_story",
    label: "Earth Story",
    description: "Bind claims, computed evidence, uncertainty, maps and provenance into an auditable EarthStory artifact.",
    parameters: EarthStorySchema,
    executionMode: "sequential",
    async execute(toolCallId, input, _signal, onUpdate) {
      const started = performance.now();
      try {
        update(onUpdate, "earth_story", "Validating claims, findings and provenance before writing EarthStory...");
        const result = await workspace.story(input.story as EarthStoryArtifact);
        const output = compact(`story ok investigation=${result.story.investigationId}\njson=${result.jsonPath}\nmarkdown=${result.markdownPath}`, { operation: "earth_story", jsonPath: result.jsonPath, markdownPath: result.markdownPath });
        await workspace.recordToolTelemetry("earth_story", input, resultText(output), performance.now() - started, "ok", toolCallId);
        return output;
      } catch (error) {
        await workspace.recordToolTelemetry("earth_story", input, { errorCode: codeOf(error) }, performance.now() - started, "failed", toolCallId, codeOf(error));
        throw error;
      }
    },
  });

  let ecosystem = inspectPiEcosystem([]);
  pi.on("session_start", async (_event, ctx) => {
    ecosystem = inspectPiEcosystem(pi.getAllTools());
    setEarthProfile(["earth_workspace"]);
    ctx.ui.setStatus("scoutpi-earth", `Earth | core profile | ${ecosystem.detectedCount} peers`);
  });
  pi.on("before_agent_start", async (event, ctx) => {
    const profile = profileForPrompt(event.prompt);
    setEarthProfile(profile);
    ctx.ui.setStatus("scoutpi-earth", `Earth | ${profile.length === 1 ? "core" : profile.includes("earth_story") ? "report" : "analysis"} profile`);
  });
  pi.on("tool_result", async (event) => {
    if (event.isError) return;
    if (event.toolName === "earth_workspace") setEarthProfile(["earth_workspace", "python_analysis"]);
    if (event.toolName === "python_analysis") setEarthProfile(["earth_workspace", "python_analysis", "earth_story"]);
  });
  pi.on("session_shutdown", async (_event, ctx) => { ctx.ui.setStatus("scoutpi-earth", undefined); });

  pi.registerCommand("earth-status", { description: "Show the ScoutPi Earth workspace root.", handler: async (_args, ctx) => ctx.ui.notify(`Earth workspace: ${workspace.root}`, "info") });
  pi.registerCommand("earth-tools", { description: "Show the current low-token Earth tool profile.", handler: async (_args, ctx) => ctx.ui.notify(`Active Earth tools: ${pi.getActiveTools().filter((name) => ["earth_workspace", "python_analysis", "earth_story"].includes(name)).join(", ")}`, "info") });
  pi.registerCommand("earth-ecosystem", { description: "Show detected Pi plugins and ScoutPi reuse boundaries.", handler: async (_args, ctx) => ctx.ui.notify(formatPiEcosystemProfile(ecosystem), "info") });
}
