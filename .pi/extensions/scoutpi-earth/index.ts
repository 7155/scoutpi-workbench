import { EarthWorkspace, type EarthStoryArtifact, type InvestigationSpec } from "../../../packages/earth-workspace/src/index.ts";
import { formatPiEcosystemProfile, inspectPiEcosystem, type PiToolMetadata } from "../../../packages/pi-ecosystem/src/index.ts";

interface PiToolResult { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }
interface PiApi {
  registerTool?(tool: { name: string; description: string; parameters: Record<string, unknown>; execute: (...args: any[]) => Promise<PiToolResult> }): void;
  registerCommand?(name: string, command: { description: string; handler: (...args: any[]) => Promise<void> }): void;
  on?(event: string, handler: (...args: any[]) => Promise<void> | void): void;
  getActiveTools?(): string[];
  getAllTools?(): PiToolMetadata[];
  setActiveTools?(names: string[]): void;
  events?: { emit?(name: string, data: unknown): void };
}

function inputFrom(args: any[]): Record<string, any> {
  if (args.length >= 2 && args[1] && typeof args[1] === "object") return args[1];
  return args[0] && typeof args[0] === "object" ? args[0] : {};
}

function compact(text: string, details: Record<string, unknown> = {}): PiToolResult {
  return { content: [{ type: "text", text: text.slice(0, 1800) }], details };
}

const objectSchema = { type: "object", additionalProperties: true };

export default async function setup(pi: PiApi) {
  const workspace = new EarthWorkspace();
  await workspace.init();
  await workspace.recoverInterruptedJobs();

  pi.registerTool?.({
    name: "earth_workspace",
    description: "Plan and supervise a typed Earth-observation investigation; full outputs stay in artifacts.",
    parameters: {
      type: "object",
      properties: {
        op: { type: "string", enum: ["environment", "contract", "catalog_search", "adapter_register", "adapter_import", "adapter_list", "adapter_probe", "adapter_enable", "adapter_disable", "skill_save", "skill_list", "skill_publish", "plan", "preview", "visualize", "run", "status", "cancel", "retry", "artifacts", "export", "export_local", "save_recipe", "load_recipe", "list_recipes"] },
        query: { type: "string" }, role: { type: "string" }, year: { type: "number" }, id: { type: "string" }, spec: objectSchema, adapter: objectSchema, pack: objectSchema, skill: objectSchema, confirmed: { type: "boolean" }, options: objectSchema,
      },
      required: ["op"],
    },
    execute: async (...args) => {
      const input = inputFrom(args);
      const options = input.options || {};
      if (input.op === "environment") {
        const result = await workspace.environment(options.cloudProject);
        return compact(`environment installed=${result.installed} authenticated=${result.authenticated}${result.project ? ` project=${result.project}` : ""}${result.code ? ` code=${result.code}` : ""}`, { installed: result.installed, authenticated: result.authenticated, project: result.project, code: result.code });
      }
      if (input.op === "contract") {
        const result = workspace.contract(input.id ? String(input.id) : undefined);
        return compact(`contract ${input.id || "index"}\n${JSON.stringify(result)}`, { contract: input.id || "index" });
      }
      if (input.op === "catalog_search") {
        const result = await workspace.catalogSearch({ query: String(input.query || ""), role: input.role, year: options.year, limit: options.limit });
        return compact(`catalog ok registered=${result.registeredAdapters} matches=${result.datasets.length}\n${result.datasets.map((row) => `${row.datasetId} ${row.title} roles=${row.roles.join(",")}`).join("\n")}`, { datasetIds: result.datasets.map((row) => row.datasetId), registeredAdapters: result.registeredAdapters });
      }
      if (input.op === "adapter_register") {
        const stored = await workspace.registerAdapter(input.adapter, "pi");
        return compact(`adapter registered id=${stored.adapter.datasetId} revision=${stored.revision} fingerprint=${stored.fingerprint.slice(0, 12)}`, { datasetId: stored.adapter.datasetId, revision: stored.revision, fingerprint: stored.fingerprint });
      }
      if (input.op === "adapter_import") {
        const result = await workspace.importAdapterPack(input.pack, "pi");
        return compact(`adapter pack imported id=${result.packId} count=${result.registered.length}\n${result.registered.map((row) => row.adapter.datasetId).join("\n")}`, { packId: result.packId, datasetIds: result.registered.map((row) => row.adapter.datasetId) });
      }
      if (input.op === "adapter_list") {
        const adapters = await workspace.listAdapters();
        return compact(`adapters=${adapters.length}\n${adapters.map((row) => `${row.adapter.datasetId} rev=${row.revision} enabled=${row.enabled} verify=${row.verification.status} roles=${row.adapter.roles.join(",")}`).join("\n")}`, { datasetIds: adapters.map((row) => row.adapter.datasetId) });
      }
      if (input.op === "adapter_probe") {
        const stored = await workspace.probeAdapter(String(input.id || ""), { region: options.region, year: options.year, cloudProject: options.cloudProject });
        return compact(`adapter probe id=${stored.adapter.datasetId} status=${stored.verification.status} sample=${stored.verification.sampleTime || "n/a"} requested_bands=${stored.verification.requestedBands?.length || 0}${stored.verification.error ? ` error=${stored.verification.error}` : ""}`, { datasetId: stored.adapter.datasetId, status: stored.verification.status, sampleTime: stored.verification.sampleTime, requestedBands: stored.verification.requestedBands });
      }
      if (input.op === "adapter_enable" || input.op === "adapter_disable") {
        const stored = await workspace.setAdapterEnabled(String(input.id || ""), input.op === "adapter_enable");
        return compact(`adapter state id=${stored.adapter.datasetId} enabled=${stored.enabled}`, { datasetId: stored.adapter.datasetId, enabled: stored.enabled });
      }
      if (input.op === "skill_save") {
        const result = await workspace.saveSkill(input.skill);
        return compact(`skill saved id=${result.skill.skillId}\nmarkdown=${result.markdownPath}`, { skillId: result.skill.skillId, artifactPath: result.markdownPath });
      }
      if (input.op === "skill_list") {
        const skills = await workspace.listSkills();
        return compact(`skills=${skills.length}\n${skills.map((row) => `${row.skillId} ${row.name}`).join("\n")}`, { skillIds: skills.map((row) => row.skillId) });
      }
      if (input.op === "skill_publish") {
        const result = await workspace.publishSkill(String(input.id || ""), input.confirmed === true);
        return compact(`skill published id=${result.skillId} reload_required=${result.reloadRequired}\npath=${result.path}`, { skillId: result.skillId, path: result.path, reloadRequired: true });
      }
      if (input.op === "plan") {
        const result = await workspace.plan(input.spec as InvestigationSpec);
        return compact(`plan ok id=${result.plan.planId} datasets=${result.plan.datasets.length} nodes=${result.plan.dag.length} approval=${result.plan.estimatedCost.requiresApproval}\nartifact=${result.path}`, { planId: result.plan.planId, artifactPath: result.path });
      }
      if (input.op === "preview") {
        const result = await workspace.preview(String(input.id || ""));
        return compact(`preview ok id=${input.id} datasets=${(result.datasets as any[]).length} checks=${(result.criticChecks as any[]).length}\n${(result.datasets as any[]).map((row) => `${row.role}:${row.datasetId}`).join(" ")}`, { planId: input.id });
      }
      if (input.op === "visualize") {
        const layer = await workspace.visualize(String(input.id || ""), { role: String(input.role || ""), year: Number(input.year), cloudProject: options.cloudProject });
        return compact(`visualization ready plan=${layer.planId} role=${layer.role} year=${layer.year} dataset=${layer.datasetId}`, { planId: layer.planId, role: layer.role, year: layer.year, mapId: layer.mapId });
      }
      if (input.op === "run") {
        const job = await workspace.run(String(input.id || ""), options);
        return compact(`run ${job.state} job=${job.jobId} mode=${job.mode} tasks=${job.taskIds.length}\nartifact=${job.artifactDir}${job.error ? `\nerror=${job.error}` : ""}`, { jobId: job.jobId, state: job.state, artifactPath: job.artifactDir });
      }
      if (input.op === "status") {
        const job = await workspace.status(String(input.id || ""), options.refresh === true);
        return compact(`status job=${job.jobId} state=${job.state} tasks=${job.taskIds.length}${job.error ? ` error=${job.error}` : ""}`, { jobId: job.jobId, state: job.state, artifactPath: job.artifactDir });
      }
      if (input.op === "cancel") {
        const job = await workspace.cancel(String(input.id || ""), options.cloudProject);
        return compact(`cancel job=${job.jobId} state=${job.state}`, { jobId: job.jobId, state: job.state, artifactPath: job.artifactDir });
      }
      if (input.op === "retry") {
        const job = await workspace.retryLocalExport(String(input.id || ""), input.confirmed === true);
        return compact(`retry queued job=${job.jobId} state=${job.state}\nartifact=${job.artifactDir}`, { jobId: job.jobId, state: job.state, artifactPath: job.artifactDir });
      }
      if (input.op === "artifacts") {
        const artifacts = await workspace.listJobArtifacts(String(input.id || ""));
        return compact(`artifacts job=${input.id} count=${artifacts.length}\n${artifacts.map((item) => `${item.name} ${item.size}B`).join("\n")}`, { jobId: input.id, artifactNames: artifacts.map((item) => item.name) });
      }
      if (input.op === "export") {
        const job = await workspace.run(String(input.id || ""), { ...options, mode: "live", execution: "drive" });
        return compact(`export ${job.state} job=${job.jobId} tasks=${job.taskIds.length}\nartifact=${job.artifactDir}${job.error ? `\nerror=${job.error}` : ""}`, { jobId: job.jobId, state: job.state, taskIds: job.taskIds, artifactPath: job.artifactDir });
      }
      if (input.op === "export_local") {
        const job = await workspace.exportLocal(String(input.id || ""), { ...options, role: String(input.role || options.role || ""), year: input.year ?? options.year, confirmed: input.confirmed === true || options.confirmed === true });
        return compact(`local export queued job=${job.jobId} state=${job.state} backend=geedim\nartifact=${job.artifactDir}`, { jobId: job.jobId, state: job.state, artifactPath: job.artifactDir });
      }
      if (input.op === "save_recipe") {
        const recipe = await workspace.saveRecipe(options.recipe);
        return compact(`recipe saved id=${recipe.recipeId}`, { recipeId: recipe.recipeId });
      }
      if (input.op === "load_recipe") {
        const spec = await workspace.loadRecipe(String(input.id || ""), options.patch || {});
        const result = await workspace.plan(spec);
        return compact(`recipe loaded id=${input.id} plan=${result.plan.planId}\nartifact=${result.path}`, { recipeId: input.id, planId: result.plan.planId, artifactPath: result.path });
      }
      if (input.op === "list_recipes") {
        const recipes = await workspace.listRecipes();
        return compact(`recipes=${recipes.length}\n${recipes.map((row) => `${row.recipeId} ${row.name}`).join("\n")}`, { recipeIds: recipes.map((row) => row.recipeId) });
      }
      throw new Error(`INVALID_OPERATION: ${String(input.op)}`);
    },
  });

  pi.registerTool?.({
    name: "python_analysis",
    description: "Deterministically validate exported CSV/JSON metrics and write a compact statistical artifact.",
    parameters: { type: "object", properties: { path: { type: "string" }, columns: { type: "array", items: { type: "string" } } }, required: ["path"] },
    execute: async (...args) => {
      const input = inputFrom(args);
      const result = await workspace.analyze(String(input.path), input.columns);
      const summary = result.summary as any;
      return compact(`analysis ok rows=${summary.rowCount} columns=${Object.keys(summary.columns || {}).length}\nartifact=${result.artifact}`, { artifactPath: result.artifact, rowCount: summary.rowCount });
    },
  });

  pi.registerTool?.({
    name: "earth_story",
    description: "Bind claims, computed evidence, uncertainty, maps and provenance into an auditable EarthStory artifact.",
    parameters: { type: "object", properties: { story: objectSchema }, required: ["story"] },
    execute: async (...args) => {
      const input = inputFrom(args);
      const result = await workspace.story(input.story as EarthStoryArtifact);
      return compact(`story ok investigation=${result.story.investigationId}\njson=${result.jsonPath}\nmarkdown=${result.markdownPath}`, { jsonPath: result.jsonPath, markdownPath: result.markdownPath });
    },
  });

  const active = pi.getActiveTools?.();
  if (active && pi.setActiveTools) pi.setActiveTools([...new Set([...active, "earth_workspace", "python_analysis", "earth_story"])]);
  pi.registerCommand?.("earth-status", { description: "Show the ScoutPi Earth workspace root.", handler: async (_args, context) => context?.ui?.notify?.(`Earth workspace: ${workspace.root}`, "info") });
  let ecosystem = inspectPiEcosystem(pi.getAllTools?.() ?? []);
  pi.on?.("session_start", async (_event, context) => {
    ecosystem = inspectPiEcosystem(pi.getAllTools?.() ?? []);
    context?.ui?.setStatus?.("scoutpi-earth", `Earth | ${ecosystem.detectedCount} ecosystem peers`);
    pi.events?.emit?.("scoutpi:earth:capabilities", ecosystem);
  });
  pi.registerCommand?.("earth-ecosystem", {
    description: "Show detected Pi plugins and ScoutPi's reuse boundaries.",
    handler: async (_args, context) => context?.ui?.notify?.(formatPiEcosystemProfile(ecosystem), "info"),
  });
}
