export type ScoutPiCapabilityId = "research" | "mcp" | "browser" | "memory" | "context" | "subagents";

export interface PiToolMetadata {
  name: string;
  description?: string;
  sourceInfo?: { path?: string; source?: string; scope?: string; origin?: string };
}

export interface DetectedCapability {
  id: ScoutPiCapabilityId;
  label: string;
  detected: boolean;
  tools: string[];
  reuse: string;
  scoutPiBoundary: string;
}

export interface PiEcosystemProfile {
  toolCount: number;
  detectedCount: number;
  capabilities: DetectedCapability[];
  routing: Array<{ task: string; preferred: string; fallback: string }>;
}

const DEFINITIONS: Array<Omit<DetectedCapability, "detected" | "tools"> & { matches: Array<string | RegExp> }> = [
  {
    id: "research",
    label: "Web research",
    matches: ["web_explore", "web_search", "web_fetch", "web_fetch_md"],
    reuse: "Use an installed research extension for source discovery, ranking and HTTP/headless escalation.",
    scoutPiBoundary: "BrowserBridge is reserved for interactive, signed-in or download workflows in the user's browser.",
  },
  {
    id: "mcp",
    label: "MCP gateway",
    matches: ["mcp"],
    reuse: "Use the lazy MCP proxy for third-party servers instead of registering every remote schema in Pi.",
    scoutPiBoundary: "ScoutPi exposes only its typed investigation gateways and does not implement another MCP client.",
  },
  {
    id: "browser",
    label: "Browser control",
    matches: ["browser", "browser_session", "browser_observe", "browser_act"],
    reuse: "Use isolated agent-browser tools for generic headless test automation when available.",
    scoutPiBoundary: "ScoutPi keeps the existing Edge session, extension permissions, downloads, evidence and geo semantics.",
  },
  {
    id: "memory",
    label: "Memory",
    matches: ["memory_search", "session_search", "scoutpi_knowledge"],
    reuse: "Use the installed Pi memory provider for durable cross-session recall and governance.",
    scoutPiBoundary: "Earth recipes and run artifacts remain deterministic workspace state, not generic memory records.",
  },
  {
    id: "context",
    label: "Context compression",
    matches: [/^ctx_/, /^hypa_/],
    reuse: "Let context runtimes compress shell and file output and retain recoverable full artifacts.",
    scoutPiBoundary: "ScoutPi meters browser and Earth observations at the domain boundary rather than rewriting shell tools.",
  },
  {
    id: "subagents",
    label: "Subagents",
    matches: ["subagent", "hyperpi_subagent"],
    reuse: "Delegate independent research or review lanes to the installed subagent package.",
    scoutPiBoundary: "The Earth execution DAG is deterministic and does not implement another general subagent scheduler.",
  },
];

function matchesTool(name: string, pattern: string | RegExp): boolean {
  return typeof pattern === "string" ? name === pattern : pattern.test(name);
}

export function inspectPiEcosystem(tools: PiToolMetadata[]): PiEcosystemProfile {
  const names = [...new Set(tools.map((tool) => tool.name).filter(Boolean))].sort();
  const capabilities = DEFINITIONS.map(({ matches, ...definition }) => {
    const matched = names.filter((name) => matches.some((pattern) => matchesTool(name, pattern)));
    return { ...definition, detected: matched.length > 0, tools: matched };
  });
  const has = (id: ScoutPiCapabilityId) => capabilities.find((item) => item.id === id)?.detected === true;
  const browserTools = capabilities.find((item) => item.id === "browser")?.tools ?? [];
  const hasScoutPiBrowser = browserTools.some((name) => name.startsWith("browser_") && name !== "browser_status");

  return {
    toolCount: names.length,
    detectedCount: capabilities.filter((item) => item.detected).length,
    capabilities,
    routing: [
      {
        task: "source research",
        preferred: has("research") ? "web research provider" : hasScoutPiBrowser ? "browser_observe" : "install a web research provider",
        fallback: "BrowserBridge only when the page requires interaction or an existing login",
      },
      {
        task: "generic headless browser test",
        preferred: browserTools.includes("browser") ? "browser" : hasScoutPiBrowser ? "BrowserBridge" : "install an agent-browser Pi package",
        fallback: "BrowserBridge for the user's current Edge session",
      },
      {
        task: "third-party service tools",
        preferred: has("mcp") ? "lazy mcp proxy" : "direct API or CLI",
        fallback: "Do not add permanent schemas to ScoutPi",
      },
      {
        task: "cross-session recall",
        preferred: has("memory") ? "installed memory provider" : "workspace recipes and artifacts",
        fallback: "Install one Pi memory provider; do not add another memory surface to ScoutPi",
      },
    ],
  };
}

export function formatPiEcosystemProfile(profile: PiEcosystemProfile): string {
  const lines = [
    `Pi ecosystem: ${profile.detectedCount}/${profile.capabilities.length} capability groups detected (${profile.toolCount} tools total)`,
    ...profile.capabilities.map((item) => `${item.detected ? "ready" : "missing"} ${item.label}: ${item.tools.join(", ") || "none"}`),
    "",
    "Routing",
    ...profile.routing.map((item) => `- ${item.task}: ${item.preferred}; fallback=${item.fallback}`),
  ];
  return lines.join("\n");
}
