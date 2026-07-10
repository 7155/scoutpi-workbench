export const SCOUTPI_MCP_PROFILE = {
  schemaVersion: "scoutpi.mcp-profile.v1",
  name: "scoutpi-workbench",
  version: "0.2.0",
  transport: "stdio",
  tools: ["scoutpi_investigation", "scoutpi_status", "scoutpi_artifact", "scoutpi_evidence"],
  resources: ["scoutpi://jobs/{jobId}/artifacts/{name}", "scoutpi://investigations/{investigationId}/evidence"],
  blockedOperations: ["live_run", "export", "adapter_change", "workflow_publish", "approval_issue"],
  modelSurface: "external_only",
} as const;

export type ScoutPiMcpProfile = typeof SCOUTPI_MCP_PROFILE;
