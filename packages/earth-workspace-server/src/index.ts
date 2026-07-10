import { fileURLToPath } from "node:url";
import { createEarthWorkspaceServer } from "./server.ts";

export * from "./server.ts";

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const runtime = await createEarthWorkspaceServer();
  await runtime.listen();
  console.log(`ScoutPi Earth Workspace API listening on http://${runtime.host}:${runtime.port}`);
}
