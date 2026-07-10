import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createScoutPiMcpServer } from "./server.ts";

export * from "./server.ts";
export * from "./profile.ts";

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const { server, workspace } = createScoutPiMcpServer();
  await workspace.init();
  await server.connect(new StdioServerTransport());
}
