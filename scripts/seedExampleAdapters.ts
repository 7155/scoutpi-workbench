import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { EarthWorkspace, type EarthAdapterPack } from "../packages/earth-workspace/src/index.ts";

const path = resolve(process.argv[2] || "examples/adapter-packs/earth-engine-starter.json");
const pack = JSON.parse(await readFile(path, "utf8")) as EarthAdapterPack;
const workspace = new EarthWorkspace();
const result = await workspace.importAdapterPack(pack, "example");
console.log(JSON.stringify({ packId: result.packId, registered: result.registered.map((row) => ({ datasetId: row.adapter.datasetId, revision: row.revision, fingerprint: row.fingerprint })) }, null, 2));
