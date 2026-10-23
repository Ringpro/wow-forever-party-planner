// Registers slash commands and install settings with Discord.
//   pnpm discord:register                       commands + install settings
//   pnpm discord:register --endpoint <url>      also sets the Interactions Endpoint URL
// Reads DISCORD_CLIENT_ID from wrangler.jsonc and DISCORD_BOT_TOKEN from .dev.vars (or the environment).
import { readFileSync } from "node:fs";
import { COMMANDS } from "../src/lib/discord/commands.ts";

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

function readClientId(): string {
  const jsonc = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  return JSON.parse(jsonc).vars.DISCORD_CLIENT_ID;
}

const token = process.env.DISCORD_BOT_TOKEN ?? readDevVars().DISCORD_BOT_TOKEN;
const clientId = readClientId();
if (!token || !clientId) {
  console.error("Need DISCORD_BOT_TOKEN (.dev.vars) and DISCORD_CLIENT_ID (wrangler.jsonc).");
  process.exit(1);
}

async function call(method: string, path: string, body: unknown) {
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
  integration_types_config: {
    0: { oauth2_install_params: { scopes: ["applications.commands", "bot"], permissions: BOT_PERMISSIONS } },
    1: { oauth2_install_params: { scopes: ["applications.commands"], permissions: "0" } },
  },
};
if (endpoint) settings.interactions_endpoint_url = `${endpoint.replace(/\/$/, "")}/api/discord/interactions`;
const app = (await call("PATCH", "/applications/@me", settings)) as { interactions_endpoint_url?: string };
console.log("Install settings updated (server install includes the bot).");
if (endpoint) console.log(`Interactions endpoint: ${app.interactions_endpoint_url}`);
