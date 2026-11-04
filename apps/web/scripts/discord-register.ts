// Registers slash commands and install settings with Discord.
//   pnpm discord:register                       commands + install settings
//   pnpm discord:register --endpoint <url>      also sets the Interactions Endpoint URL
// Also uploads the board's dot emojis to the app (once) and writes their ids to
// src/lib/discord/emojis.json, which is committed: emoji ids aren't secret. Rebuild after.
// Reads DISCORD_CLIENT_ID from wrangler.jsonc and DISCORD_BOT_TOKEN from .dev.vars (or the environment).
import { readFileSync, writeFileSync } from "node:fs";
import { COMMANDS } from "../src/lib/discord/commands.ts";
import { DOT_EMOJI_NAMES, OLD_DOT_EMOJI_NAMES } from "../src/lib/discord/emoji-names.ts";
import { DOT_COLOURS, dotPng } from "./dot-emoji.ts";

const API = "https://discord.com/api/v10";
const BOT_PERMISSIONS = "2147503104"; // keep in sync with src/lib/discord/install.ts

function readDevVars(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(new URL("../.dev.vars", import.meta.url), "utf8")
        .split(/\r?\n/)
        .filter((line) => /^[A-Z_]+=/.test(line))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
    );
  } catch {
    return {};
  }
}

function readVars(): Record<string, string> {
  const jsonc = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  return JSON.parse(jsonc).vars;
}

const token = process.env.DISCORD_BOT_TOKEN ?? readDevVars().DISCORD_BOT_TOKEN;
const vars = readVars();
const clientId = vars.DISCORD_CLIENT_ID;
// The production site from wrangler.jsonc (not .dev.vars, which points at localhost).
const siteUrl = (vars.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
if (!token || !clientId) {
  console.error("Need DISCORD_BOT_TOKEN (.dev.vars) and DISCORD_CLIENT_ID (wrangler.jsonc).");
  process.exit(1);
}

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`${method} ${path} failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  return res.json();
}

const commands = (await call("PUT", `/applications/${clientId}/commands`, COMMANDS)) as { name: string }[];
console.log(`Registered commands: ${commands.map((c) => `/${c.name}`).join(", ")}`);

const endpointIndex = process.argv.indexOf("--endpoint");
const endpoint = endpointIndex > -1 ? process.argv[endpointIndex + 1] : undefined;
const settings: Record<string, unknown> = {
  // Shown on the app's profile. (The privacy and terms links can't be set through the API:
  // set them by hand under General Information in the Developer Portal.)
  tags: ["scheduling", "wow", "lfg", "gaming", "calendar"],
  integration_types_config: {
    0: { oauth2_install_params: { scopes: ["applications.commands", "bot"], permissions: BOT_PERMISSIONS } },
    1: { oauth2_install_params: { scopes: ["applications.commands"], permissions: "0" } },
  },
};
if (endpoint) settings.interactions_endpoint_url = `${endpoint.replace(/\/$/, "")}/api/discord/interactions`;
const app = (await call("PATCH", "/applications/@me", settings)) as { interactions_endpoint_url?: string };
console.log("App tags and install settings updated (server install includes the bot).");
if (siteUrl) console.log(`Policy links for the Developer Portal: ${siteUrl}/privacy and ${siteUrl}/terms`);
if (endpoint) console.log(`Interactions endpoint: ${app.interactions_endpoint_url}`);

// Board dots as app emojis. Existing ones are kept (renamed if their name changed), so ids stay stable.
type AppEmoji = { id: string; name: string };
const existing = ((await call("GET", `/applications/${clientId}/emojis`)) as { items: AppEmoji[] }).items;
const ids: Record<string, string> = {};
for (const [kind, colour] of Object.entries(DOT_COLOURS) as [keyof typeof DOT_COLOURS, (typeof DOT_COLOURS)[keyof typeof DOT_COLOURS]][]) {
  const name = DOT_EMOJI_NAMES[kind];
  const found = existing.find((e) => e.name === name) ?? existing.find((e) => e.name === OLD_DOT_EMOJI_NAMES[kind]);
  if (found && found.name !== name) {
    await call("PATCH", `/applications/${clientId}/emojis/${found.id}`, { name });
    console.log(`Renamed emoji :${found.name}: to :${name}:`);
  }
  ids[kind] = found
    ? found.id
    : ((await call("POST", `/applications/${clientId}/emojis`, {
        name,
        image: `data:image/png;base64,${dotPng(colour).toString("base64")}`,
      })) as AppEmoji).id;
}
const emojiFile = new URL("../src/lib/discord/emojis.json", import.meta.url);
const before = readFileSync(emojiFile, "utf8");
const after = `${JSON.stringify(ids, null, 2)}\n`;
if (before !== after) writeFileSync(emojiFile, after);
console.log(`Board dot emojis: ${Object.keys(ids).join(", ")}${before !== after ? " (ids saved, rebuild to use them)" : ""}`);
