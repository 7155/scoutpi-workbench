import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedExtensions = [
  "scoutpi-context",
  "scoutpi-evidence",
  "scoutpi-triggers",
  "scoutpi-governance",
  "scoutpi-observability",
  "scoutpi-checkpoint",
  "scoutpi-earth",
];

function ensure(condition, message) {
  if (!condition) throw new Error(`PACKAGE_VERIFY_FAILED: ${message}`);
}

async function requestRpc(child, pending, type, diagnostic) {
  const id = `package_${randomUUID()}`;
  child.stdin.write(`${JSON.stringify({ type, id })}\n`);
  return await new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`PACKAGE_RPC_TIMEOUT: ${type}\n${diagnostic()}`));
    }, 15_000);
    pending.set(id, {
      resolve(value) { clearTimeout(timer); resolvePromise(value); },
      reject(error) { clearTimeout(timer); reject(error); },
    });
  });
}

async function smokePackedRuntime(packageRoot, agentDir) {
  await mkdir(agentDir, { recursive: true });
  const models = {
    providers: {
      "package-smoke": {
        baseUrl: "http://127.0.0.1:9/v1",
        api: "openai-responses",
        apiKey: "$SCOUTPI_PACKAGE_SMOKE_KEY",
        models: [{ id: "package-smoke", name: "Offline package smoke", reasoning: true, input: ["text"], contextWindow: 32_000, maxTokens: 1_024 }],
      },
    },
  };
  await writeFile(join(agentDir, "models.json"), `${JSON.stringify(models, null, 2)}\n`);
  const cli = join(root, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js");
  const extensionArgs = expectedExtensions.flatMap((name) => ["--extension", join(packageRoot, `.pi/extensions/${name}/index.ts`)]);
  const child = spawn(process.execPath, [
    cli,
    "--mode", "rpc",
    "--provider", "package-smoke",
    "--model", "package-smoke",
    "--approve",
    "--offline",
    "--no-session",
    "--no-builtin-tools",
    "--no-extensions",
    "--no-skills",
    ...extensionArgs,
    "--skill", join(packageRoot, ".pi/skills/scoutpi-earth-investigation"),
  ], {
    cwd: packageRoot,
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: agentDir,
      PI_OFFLINE: "1",
      SCOUTPI_PACKAGE_SMOKE_KEY: "not-used",
      SCOUTPI_EARTH_ROOT: join(agentDir, "earth_workspace"),
      SCOUTPI_RUNS_ROOT: join(agentDir, "runs"),
      SCOUTPI_CHECKPOINT_ROOT: join(agentDir, "checkpoints"),
      SCOUTPI_CONTEXT_ROOT: join(agentDir, "context"),
      SCOUTPI_EVIDENCE_ROOT: join(agentDir, "evidence"),
      SCOUTPI_TRIGGER_ROOT: join(agentDir, "triggers"),
      SCOUTPI_ECOSYSTEM_ROOT: join(agentDir, "pi-ecosystem"),
      SCOUTPI_SKILL_PUBLISH_ROOT: join(agentDir, "published_skills"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map();
  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  createInterface({ input: child.stdout }).on("line", (line) => {
    stdout = `${stdout}${line}\n`.slice(-4_000);
    let value;
    try { value = JSON.parse(line); } catch { return; }
    if (value.type !== "response" || !value.id || !pending.has(value.id)) return;
    const request = pending.get(value.id);
    pending.delete(value.id);
    if (value.success === false) request.reject(new Error(String(value.error || "RPC failed")));
    else request.resolve(value);
  });
  try {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 350));
    ensure(child.exitCode === null, `packed Pi runtime exited during startup: ${stderr.slice(-1_000)}`);
    const diagnostic = () => `stdout=${stdout.slice(-2_000)}\nstderr=${stderr.slice(-2_000)}`;
    const state = await requestRpc(child, pending, "get_state", diagnostic);
    const commands = await requestRpc(child, pending, "get_commands", diagnostic);
    const names = commands.data?.commands?.map((item) => item.name) || [];
    ensure(state.data?.model?.id === "package-smoke", "packed runtime did not initialize the offline model");
    ensure(["earth-status", "earth-tools", "earth-ecosystem", "earth-triggers", "earth-trigger-approve"].every((name) => names.includes(name)), "packed extensions did not register every operator command");
    ensure(names.includes("skill:scoutpi-earth-investigation"), "packed investigation skill was not discovered");
    ensure(!/extension[^\n]*(?:error|failed)/i.test(stderr), `packed extension reported an error: ${stderr.slice(-1_000)}`);
    return { commandCount: names.length, extensionCount: expectedExtensions.length, skillLoaded: true };
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolvePromise) => child.once("exit", resolvePromise)),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000)),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

async function main() {
  const temporary = await mkdtemp(join(tmpdir(), "scoutpi-package-"));
  try {
    const { stdout } = await execFileAsync("npm", ["pack", "--json", "--pack-destination", temporary], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
    const [pack] = JSON.parse(stdout);
    ensure(pack?.name === "scoutpi-workbench", "unexpected package name");
    ensure(pack.unpackedSize <= 900_000, `unpacked package is too large: ${pack.unpackedSize}`);
    const paths = pack.files.map((item) => item.path);
    const required = [
      ...expectedExtensions.map((name) => `.pi/extensions/${name}/index.ts`),
      ".pi/skills/scoutpi-earth-investigation/SKILL.md",
      "packages/earth-workspace/python/worker.py",
      "packages/runtime-context/python/ime_core_context_provider.py",
      "README.md",
      "LICENSE",
      "SECURITY.md",
    ];
    ensure(required.every((path) => paths.includes(path)), "one or more required runtime resources are absent from the tarball");
    const forbidden = [".env", ".github/", "apps/", "docs/agent/", "exports/", "harness/", "output/", "tests/", "uv.lock"];
    ensure(!paths.some((path) => forbidden.some((prefix) => path === prefix || path.startsWith(prefix))), "development or private state leaked into the tarball");
    const archive = join(temporary, pack.filename);
    await execFileAsync("tar", ["-xzf", archive, "-C", temporary]);
    const packageRoot = join(temporary, "package");
    const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
    ensure(manifest.private !== true, "package is still private");
    ensure(manifest.keywords?.includes("pi-package"), "pi-package keyword is missing");
    ensure(manifest.pi?.image === "https://raw.githubusercontent.com/7155/scoutpi-workbench/main/docs/assets/workbench-live-gee.png", "gallery image is not fixed to the public repository");
    ensure(manifest.peerDependencies?.["@earendil-works/pi-coding-agent"] === "*" && manifest.peerDependencies?.typebox === "*", "Pi runtime packages must remain peer dependencies");
    for (const file of pack.files.filter((item) => item.size <= 1_000_000)) {
      const text = await readFile(join(packageRoot, file.path), "utf8").catch(() => "");
      ensure(!/\/(?:Users|Volumes)\/undo\b|X1topsecretkey|sk-[A-Za-z0-9_-]{20,}/.test(text), `local path or credential-like material found in ${file.path}`);
    }
    const smoke = await smokePackedRuntime(packageRoot, join(temporary, "agent"));
    console.log(JSON.stringify({
      ok: true,
      schemaVersion: "scoutpi.pi-package-verification.v1",
      package: `${pack.name}@${pack.version}`,
      packedBytes: pack.size,
      unpackedBytes: pack.unpackedSize,
      entries: pack.entryCount,
      ...smoke,
    }, null, 2));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

await main();
