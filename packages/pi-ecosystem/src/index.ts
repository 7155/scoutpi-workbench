export type ScoutPiCapabilityId = "research" | "mcp" | "browser" | "memory" | "context" | "subagents" | "goals" | "interop" | "security" | "package_market" | "evaluation";

export interface PiSourceInfo {
  path?: string;
  source?: string;
  scope?: string;
  origin?: string;
}

export interface PiToolMetadata {
  name: string;
  description?: string;
  sourceInfo?: PiSourceInfo;
}

export interface PiCommandMetadata {
  name: string;
  description?: string;
  sourceInfo?: PiSourceInfo;
}

export interface DetectedCapability {
  id: ScoutPiCapabilityId;
  label: string;
  detected: boolean;
  tools: string[];
  commands: string[];
  sources: string[];
  reuse: string;
  scoutPiBoundary: string;
}

export interface PiEcosystemProfile {
  toolCount: number;
  commandCount: number;
  detectedCount: number;
  capabilities: DetectedCapability[];
  routing: Array<{ task: string; preferred: string; fallback: string }>;
}

type Match = string | RegExp;
type Definition = Omit<DetectedCapability, "detected" | "tools" | "commands" | "sources"> & { toolMatches?: Match[]; commandMatches?: Match[] };

const DEFINITIONS: Definition[] = [
  {
    id: "research", label: "Web research", toolMatches: ["web_explore", "web_search", "web_fetch", "web_fetch_md"], commandMatches: [/^web(?:-search|-access)?$/],
    reuse: "Use an installed research package for source discovery, ranking and HTTP/headless escalation.",
    scoutPiBoundary: "BrowserBridge is reserved for interactive, signed-in or download workflows in the user's browser.",
  },
  {
    id: "mcp", label: "MCP gateway", toolMatches: ["mcp"], commandMatches: ["mcp"],
    reuse: "Use a lazy MCP proxy for third-party servers instead of registering every remote schema in Pi.",
    scoutPiBoundary: "ScoutPi exposes only its typed compatibility server and does not implement another generic MCP client.",
  },
  {
    id: "browser", label: "Browser control", toolMatches: ["browser", "browser_session", "browser_observe", "browser_act", /^chrome_/], commandMatches: [/^browser/],
    reuse: "Use isolated agent-browser tools for generic headless tests when available.",
    scoutPiBoundary: "ScoutPi keeps the existing Edge session, extension permissions, downloads, evidence and geo semantics.",
  },
  {
    id: "memory", label: "Memory", toolMatches: [/^memory_/, "session_search", "scoutpi_knowledge", /^hivemind_/], commandMatches: [/^memory$/, /^memories$/, /^knowledge$/],
    reuse: "Use the installed memory provider for durable cross-session recall and governed writes.",
    scoutPiBoundary: "Context Bridge ranks provider results; Earth recipes and run artifacts remain deterministic workspace state.",
  },
  {
    id: "context", label: "Context compression", toolMatches: [/^ctx_/, /^hypa_/, /^lean_ctx/, /^rtk_/], commandMatches: [/^context(?:-usage|-burden)?$/],
    reuse: "Let context runtimes compress shell and file output while retaining recoverable full artifacts.",
    scoutPiBoundary: "ScoutPi meters browser and Earth observations at the domain boundary rather than replacing shell tools.",
  },
  {
    id: "subagents", label: "Subagents", toolMatches: [/^subagent/, /^hyperpi_subagent/, /^delegate_/], commandMatches: [/^subagents?$/, /^agents$/],
    reuse: "Delegate independent research or review lanes to an installed subagent package.",
    scoutPiBoundary: "The Earth execution DAG stays deterministic and does not become another generic agent scheduler.",
  },
  {
    id: "goals", label: "Autonomous goals", toolMatches: [/^goal_/], commandMatches: ["goal"],
    reuse: "Use an installed goal package for long-lived autonomous continuation and token/time budgets.",
    scoutPiBoundary: "ScoutPi workflows and triggers own deterministic replay, not the generic conversational goal loop.",
  },
  {
    id: "interop", label: "Agent interoperability", toolMatches: [/^intercom_/, /^messenger_/, /^a2a_/], commandMatches: [/^intercom/, /^messenger/, /^a2a/],
    reuse: "Use an installed bounded session-messaging package for cross-agent coordination.",
    scoutPiBoundary: "ScoutPi exchanges typed evidence, context, and trigger events rather than inventing a second message bus.",
  },
  {
    id: "security", label: "Runtime security", toolMatches: [/^sandbox_/, /^permission_/, /^heimdall_/], commandMatches: ["access-guard", "sandbox", "permissions", "mode", "heimdall"],
    reuse: "Compose with an installed path guard or OS sandbox for generic file and process isolation.",
    scoutPiBoundary: "ScoutPi governance remains responsible for domain risk, exact parameter receipts and delegated workflow scope.",
  },
  {
    id: "package_market", label: "Package market", toolMatches: [/^package_/], commandMatches: ["extensions", "packages"],
    reuse: "Use Pi's package catalog and package manager for discovery, install, update, filtering and removal.",
    scoutPiBoundary: "ScoutPi reports compatible peers but never installs or silently activates a package.",
  },
  {
    id: "evaluation", label: "Agent evaluation", toolMatches: [/^eval_/, /^benchmark_/], commandMatches: [/^eval/, /^benchmark/, "token-burden", "context-usage"],
    reuse: "Reuse generic token/context inspection packages and compare them with ScoutPi's domain harness.",
    scoutPiBoundary: "ScoutPi keeps task completion, evidence coverage, unsupported claims and approval bypass as domain scorers.",
  },
];

function matchesName(name: string, pattern: Match): boolean {
  return typeof pattern === "string" ? name === pattern : pattern.test(name);
}

function sourceLabel(metadata: { sourceInfo?: PiSourceInfo }): string | undefined {
  const source = metadata.sourceInfo?.source || metadata.sourceInfo?.origin || metadata.sourceInfo?.path;
  if (!source) return undefined;
  return `${metadata.sourceInfo?.scope ? `${metadata.sourceInfo.scope}:` : ""}${source}`.slice(0, 240);
}

export function inspectPiEcosystem(tools: PiToolMetadata[], commands: PiCommandMetadata[] = []): PiEcosystemProfile {
  const normalizedTools = [...new Map(tools.filter((tool) => tool.name).map((tool) => [tool.name, tool])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const normalizedCommands = [...new Map(commands.filter((command) => command.name).map((command) => [command.name, command])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const capabilities = DEFINITIONS.map(({ toolMatches = [], commandMatches = [], ...definition }) => {
    const matchedTools = normalizedTools.filter((tool) => toolMatches.some((pattern) => matchesName(tool.name, pattern)));
    const matchedCommands = normalizedCommands.filter((command) => commandMatches.some((pattern) => matchesName(command.name, pattern)));
    const sources = [...new Set([...matchedTools, ...matchedCommands].map(sourceLabel).filter((value): value is string => Boolean(value)))].sort();
    return { ...definition, detected: matchedTools.length > 0 || matchedCommands.length > 0, tools: matchedTools.map((tool) => tool.name), commands: matchedCommands.map((command) => command.name), sources };
  });
  const capability = (id: ScoutPiCapabilityId) => capabilities.find((item) => item.id === id);
  const has = (id: ScoutPiCapabilityId) => capability(id)?.detected === true;
  const browserTools = capability("browser")?.tools ?? [];
  const hasScoutPiBrowser = browserTools.some((name) => name.startsWith("browser_") && name !== "browser_status");

  return {
    toolCount: normalizedTools.length,
    commandCount: normalizedCommands.length,
    detectedCount: capabilities.filter((item) => item.detected).length,
    capabilities,
    routing: [
      { task: "source research", preferred: has("research") ? "installed web research provider" : hasScoutPiBrowser ? "browser_observe" : "Pi package catalog", fallback: "BrowserBridge only when the task requires interaction or an existing login, download, or evidence" },
      { task: "generic headless browser test", preferred: browserTools.includes("browser") ? "installed agent-browser provider" : hasScoutPiBrowser ? "BrowserBridge" : "Pi package catalog", fallback: "BrowserBridge for the user's current Edge session" },
      { task: "third-party service tools", preferred: has("mcp") ? "installed lazy MCP proxy" : "direct API or CLI", fallback: "Do not add permanent remote schemas to ScoutPi" },
      { task: "cross-session recall", preferred: has("memory") ? "installed memory provider through Context Bridge" : "workspace recipes and artifacts", fallback: "Configure Wisdom Weasel RAG Core or another provider; do not add a second memory surface" },
      { task: "independent research or review", preferred: has("subagents") ? "installed subagent runtime" : "current Pi session", fallback: "Keep Earth computation in the deterministic DAG" },
      { task: "long-running conversational goal", preferred: has("goals") ? "installed goal runtime" : "Pi session plus durable checkpoint", fallback: "Use ScoutPi Trigger only for reviewed deterministic workflow replay" },
      { task: "generic filesystem/process safety", preferred: has("security") ? "installed sandbox or access guard" : "Pi project trust and operator policy", fallback: "ScoutPi governance still enforces domain approvals" },
      { task: "package discovery and updates", preferred: has("package_market") ? "installed package manager UI" : "pi.dev/packages and pi install/list/update/remove", fallback: "Never auto-install from ScoutPi" },
    ],
  };
}

export function formatPiEcosystemProfile(profile: PiEcosystemProfile): string {
  const lines = [
    `Pi ecosystem: ${profile.detectedCount}/${profile.capabilities.length} capability groups detected (${profile.toolCount} tools, ${profile.commandCount} commands)`,
    ...profile.capabilities.map((item) => {
      const surfaces = [...item.tools, ...item.commands.map((name) => `/${name}`)].join(", ") || "none";
      return `${item.detected ? "ready" : "missing"} ${item.label}: ${surfaces}${item.sources.length ? ` [${item.sources.join(" · ")}]` : ""}`;
    }),
    "",
    "Routing",
    ...profile.routing.map((item) => `- ${item.task}: ${item.preferred}; fallback=${item.fallback}`),
  ];
  return lines.join("\n");
}
