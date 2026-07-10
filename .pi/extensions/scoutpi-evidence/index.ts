import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { EvidenceStore } from "../../../packages/runtime-evidence/src/index.ts";

function objectOf(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function errorCode(error: unknown): string {
  return String((error as { code?: string })?.code || "EVIDENCE_IMPORT_FAILED").slice(0, 120);
}

export default async function setup(pi: ExtensionAPI): Promise<void> {
  const store = new EvidenceStore();
  await store.init();
  let imported = 0;
  let browserAvailable = false;

  pi.on("session_start", async (_event, ctx) => {
    browserAvailable = pi.getAllTools().some((tool) => tool.name.startsWith("browser_"));
    ctx.ui.setStatus("scoutpi-evidence", browserAvailable ? "Evidence | BrowserBridge ready" : "Evidence | inbox only");
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.isError || !event.toolName.startsWith("browser_")) return;
    const details = objectOf(event.details);
    try {
      if (details.browserEvidence?.schemaVersion === "scoutpi.browser.evidence.v1") {
        const result = await store.importCanonical(details.browserEvidence, details.evidencePath);
        if (!result.deduplicated) imported += 1;
        pi.appendEntry("scoutpi:evidence-import", { evidenceId: result.record.evidenceId, deduplicated: result.deduplicated, source: "browser_tool_result" });
      } else if (typeof details.evidencePath === "string") {
        const result = await store.importBrowserBridgeFile(details.evidencePath, {
          binding: objectOf(details.binding),
          timeReferences: Array.isArray(details.timeReferences) ? details.timeReferences.map(String) : undefined,
          placeReferences: Array.isArray(details.placeReferences) ? details.placeReferences.map(String) : undefined,
          runId: typeof details.runId === "string" ? details.runId : undefined,
          snapshotId: typeof details.snapshotId === "string" ? details.snapshotId : undefined,
        });
        imported += result.imported;
        pi.appendEntry("scoutpi:evidence-import", { evidenceIds: result.records.map((record) => record.evidenceId), imported: result.imported, deduplicated: result.deduplicated, source: "browser_tool_result" });
      } else return;
      ctx.ui.setStatus("scoutpi-evidence", `Evidence | ${imported} imported`);
    } catch (error) {
      pi.appendEntry("scoutpi:evidence-import-error", { code: errorCode(error), toolName: event.toolName });
      ctx.ui.setStatus("scoutpi-evidence", `Evidence | blocked ${errorCode(error)}`);
    }
  });

  pi.registerCommand("earth-evidence", {
    description: "Show Browser Evidence Bridge state without adding a model-facing tool.",
    handler: async (_args, ctx) => {
      const records = await store.list(undefined, 1_000);
      ctx.ui.notify(`Browser Evidence Bridge: ${browserAvailable ? "BrowserBridge detected" : "inbox mode"}; records=${records.length}; imported_this_session=${imported}`, "info");
    },
  });

  pi.on("session_shutdown", async (_event, ctx) => { ctx.ui.setStatus("scoutpi-evidence", undefined); });
}
