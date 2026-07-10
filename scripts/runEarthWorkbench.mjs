import { spawn } from "node:child_process";

const children = [
  spawn(process.execPath, ["--experimental-strip-types", "packages/earth-workspace-server/src/index.ts"], { stdio: "inherit" }),
  spawn("pnpm", ["--filter", "@scoutpi/earth-workbench", "dev"], { stdio: "inherit" }),
];

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 150).unref();
}

for (const child of children) child.on("exit", (code, signal) => {
  if (!stopping && code && signal !== "SIGTERM") stop(code);
});
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
