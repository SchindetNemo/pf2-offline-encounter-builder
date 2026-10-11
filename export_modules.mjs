// Export Actor compendiums from installed Foundry modules (LevelDB) to JSON files that build_data.py reads.
//
// Usage: node encounter-builder/export_modules.mjs
// Writes encounter-builder/module-packs/<module>/<pack>/<actorId>.json (+ _module.json with pack metadata).
// Pack folders are copied to a temp dir first, so a running Foundry's lock is never touched.
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FOUNDRY_APP = "/media/nemo/UbuntuApps/Apps/FoundryVTT/V14/resources/app";
// Foundry's data folder (dataPath in Config/options.json), not the old copy on the UbuntuApps drive
const MODULES_DIR = "/home/nemo/.local/share/FoundryVTT/Data/modules";
const OUT = path.join(HERE, "module-packs");
// module id -> how the builder labels it
const MODULES = {
  "battlezoo-bestiary-pf2e": { group: "Battlezoo", game: "pf2e" },
  "battlezoo-bestiary-su-pf2e": { group: "Battlezoo", game: "pf2e" },
  "battlezoo-bestiary-es-pf2e": { group: "Battlezoo", game: "pf2e", packGame: { "sf2e-bestiary": "sf2e" } },
  "sf2e-anachronism": { group: "Starfinder", game: "sf2e" },
};
// pregenerated player characters are not encounter material
const SKIP_PACKS = new Set(["iconics", "paizo-pregens"]);

const require = createRequire(path.join(FOUNDRY_APP, "package.json"));
const { ClassicLevel } = require("classic-level");

/** id -> name for every document in a pack (resolves @UUID links into module compendiums). */
async function readNames(dir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eb-pack-"));
  fs.cpSync(dir, tmp, { recursive: true });
  fs.rmSync(path.join(tmp, "LOCK"), { force: true });
  const db = new ClassicLevel(tmp, { valueEncoding: "json" });
  const names = {};
  try {
    for await (const [key, value] of db.iterator()) {
      if (/^![a-z]+!/i.test(key) && value?._id && value?.name) names[value._id] = value.name;
    }
  } finally {
    await db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return names;
}

async function readPack(dir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eb-pack-"));
  fs.cpSync(dir, tmp, { recursive: true });
  fs.rmSync(path.join(tmp, "LOCK"), { force: true });
  const db = new ClassicLevel(tmp, { valueEncoding: "json" });
  const actors = new Map();
  const items = [];
  try {
    for await (const [key, value] of db.iterator()) {
      if (key.startsWith("!actors!")) actors.set(key.slice(8), value);
      else if (key.startsWith("!actors.items!")) items.push([key.slice(14), value]);
    }
  } finally {
    await db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  // embedded items are stored separately as "!actors.items!<actorId>.<itemId>"; the actor lists item ids
  const byId = new Map(items.map(([k, v]) => [k, v]));
  for (const [id, actor] of actors) {
    actor.items = (actor.items || []).map(itemId => byId.get(`${id}.${itemId}`)).filter(Boolean);
  }
  return [...actors.values()];
}

fs.rmSync(OUT, { recursive: true, force: true });
for (const [moduleId, meta] of Object.entries(MODULES)) {
  const manifestPath = path.join(MODULES_DIR, moduleId, "module.json");
  if (!fs.existsSync(manifestPath)) {
    console.log(`skip ${moduleId}: not installed`);
    continue;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const packs = (manifest.packs || []).filter(p => p.type === "Actor" && !SKIP_PACKS.has(p.name));
  const { packGame, ...rest } = meta;
  const info = { id: moduleId, title: manifest.title, version: manifest.version, ...rest, packs: {} };
  for (const p of packs) {
    const actors = (await readPack(path.join(MODULES_DIR, moduleId, p.path))).filter(a => ["npc", "hazard"].includes(a.type));
    const dir = path.join(OUT, moduleId, p.name);
    fs.mkdirSync(dir, { recursive: true });
    for (const a of actors) fs.writeFileSync(path.join(dir, `${a._id}.json`), JSON.stringify(a));
    const game = meta.packGame?.[p.name] ?? meta.game;
    info.packs[p.name] = { label: p.label, collection: `${moduleId}.${p.name}`, game, count: actors.length };
    console.log(`${moduleId}.${p.name} (${game}): ${actors.length} creatures/hazards`);
  }
  let names = {};
  for (const p of manifest.packs || []) {
    const dir = path.join(MODULES_DIR, moduleId, p.path);
    if (fs.existsSync(path.join(dir, "CURRENT"))) Object.assign(names, await readNames(dir));
  }
  fs.mkdirSync(path.join(OUT, moduleId), { recursive: true });
  fs.writeFileSync(path.join(OUT, moduleId, "_names.json"), JSON.stringify(names));
  fs.writeFileSync(path.join(OUT, moduleId, "_module.json"), JSON.stringify(info, null, 1));
}
