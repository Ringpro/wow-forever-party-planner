// Keeps server groups and squads in line with Discord (architecture §4.6): at website login from
// the user's server list, and on every interaction in a server from the member data Discord sends.
import type { Db } from "@muster/db";
import { DiscordApiError, discordApi } from "../discord/api.ts";
import type { Interaction } from "../discord/types.ts";
import { ensureServerGroup, serverGroupFor, syncServerMemberships, syncSquadMemberships } from "./groups.ts";

const ADMINISTRATOR = 1n << 3n;
const MANAGE_GUILD = 1n << 5n;
const FALLBACK_TIMEZONE = "Europe/London";

/** A server from Discord's OAuth `/users/@me/guilds` (the user's view of it). */
export type OAuthGuild = { id: string; name: string; icon: string | null; owner?: boolean; permissions?: string };

export function guildIconUrl(guildId: string, icon: string | null | undefined): string | null {
  return icon ? `https://cdn.discordapp.com/icons/${guildId}/${icon}.png?size=64` : null;
}

export function canManageServer(permissions: string | undefined, owner = false): boolean {
  if (owner) return true;
  if (!permissions) return false;
  const bits = BigInt(permissions);
  return (bits & ADMINISTRATOR) !== 0n || (bits & MANAGE_GUILD) !== 0n;
}

let botGuildCache: { at: number; ids: Set<string> } | undefined;

/** Servers the bot is in. Cached briefly; logins come in bursts at most. */
async function botGuildIds(): Promise<Set<string>> {
  if (botGuildCache && Date.now() - botGuildCache.at < 60_000) return botGuildCache.ids;
  const guilds = await discordApi<{ id: string }[]>("GET", "/users/@me/guilds?limit=200");
  botGuildCache = { at: Date.now(), ids: new Set(guilds.map((g) => g.id)) };
  return botGuildCache.ids;
}

/** A member's role IDs in a server, read with the bot token. Null if they aren't in it. */
async function memberRoles(guildId: string, discordUserId: string): Promise<string[] | null> {
  try {
    const member = await discordApi<{ roles: string[] }>("GET", `/guilds/${guildId}/members/${discordUserId}`);
    return member.roles;
  } catch (e) {
    if (e instanceof DiscordApiError && e.status === 404) return null;
    throw e;
  }
}

/** The roles people can pick for a squad: not @everyone, not roles owned by bots. */
export async function guildRoles(guildId: string): Promise<{ id: string; name: string }[]> {
  const roles = await discordApi<{ id: string; name: string; managed: boolean; position: number }[]>(
    "GET",
    `/guilds/${guildId}/roles`,
  );
  return roles
    .filter((r) => r.id !== guildId && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map(({ id, name }) => ({ id, name }));
}

/**
 * At website login: join every server the user shares with the bot, leave the ones they've left,
 * and sync squads. New servers start unshared; the website asks the user.
 */
export async function syncAtLogin(
  db: Db,
  userId: string,
  discordUserId: string,
  guilds: OAuthGuild[],
  timezone: string | null,
): Promise<void> {
  const botGuilds = await botGuildIds();
  const shared = guilds.filter((g) => botGuilds.has(g.id));
  const servers = [];
  for (const guild of shared) {
    const group = await ensureServerGroup(
      db,
      { guildId: guild.id, name: guild.name, iconUrl: guildIconUrl(guild.id, guild.icon) },
      timezone ?? FALLBACK_TIMEZONE,
    );
    servers.push({ group, admin: canManageServer(guild.permissions, guild.owner) });
  }
  await syncServerMemberships(
    db,
    userId,
    servers.map((s) => ({ groupId: s.group.id, admin: s.admin })),
    { complete: true, shareByDefault: false },
  );
  for (const { group } of servers) {
    const roles = await memberRoles(group.discordGuildId!, discordUserId);
    if (roles) await syncSquadMemberships(db, userId, group.id, roles);
  }
}

/**
 * On an interaction inside a server where the bot is installed: make sure the server has a group
 * and the user is in it (sharing, since they're using Muster there), with squads from their roles.
 */
export async function syncFromInteraction(db: Db, userId: string, interaction: Interaction, timezone: string | null) {
  const guildId = interaction.guild_id;
  const member = interaction.member;
  if (!guildId || !member) return;

  let group = await serverGroupFor(db, guildId);
  if (!group) {
    const installed = interaction.authorizing_integration_owners?.["0"] === guildId;
    if (!installed) return;
    const guild = await discordApi<{ id: string; name: string; icon: string | null }>("GET", `/guilds/${guildId}`);
    group = await ensureServerGroup(
      db,
      { guildId, name: guild.name, iconUrl: guildIconUrl(guildId, guild.icon) },
      timezone ?? FALLBACK_TIMEZONE,
    );
  }
  await syncServerMemberships(db, userId, [{ groupId: group.id, admin: canManageServer(member.permissions) }], {
    complete: false,
    shareByDefault: true,
  });
  await syncSquadMemberships(db, userId, group.id, member.roles ?? []);
}
