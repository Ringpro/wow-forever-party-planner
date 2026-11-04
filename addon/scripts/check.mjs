// Checks the addon without a WoW client: every Lua file listed in the TOC exists and parses as
// Lua 5.1, and no file assigns accidental globals beyond the ones the addon means to define.
import { readFileSync } from "node:fs";
import luaparse from "luaparse";

const ADDON = new URL("../Muster/", import.meta.url);
const ALLOWED_GLOBALS = new Set(["MusterDB", "SLASH_MUSTER1", "SLASH_MUSTER2"]);

const toc = readFileSync(new URL("Muster.toc", ADDON), "utf8");
const files = toc
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

let failed = false;
for (const file of files) {
  const source = readFileSync(new URL(file, ADDON), "utf8");
  let ast;
  try {
    ast = luaparse.parse(source, { luaVersion: "5.1", scope: true, locations: true });
  } catch (e) {
    console.error(`${file}: ${e.message}`);
    failed = true;
    continue;
  }
  for (const global of ast.globals) {
    // Reading WoW API globals is fine; assigning new ones is what we guard against.
    const assigned = source.match(new RegExp(`^\\s*${global.name}\\s*=`, "m"));
    if (assigned && !ALLOWED_GLOBALS.has(global.name)) {
      console.error(`${file}: assigns unexpected global "${global.name}"`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(`Addon OK: ${files.length} Lua files parse, no stray globals.`);
