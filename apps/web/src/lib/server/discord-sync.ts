// Keeps server groups and squads in line with Discord (architecture §4.6): at website login from
// the user's server list, and on every interaction in a server from the member data Discord sends.
import { schema, type Db } from "@muster/db";
import { and, eq } from "drizzle-orm";
import { DiscordApiError, discordApi } from "../discord/api.ts";
import type { Interaction } from "../discord/types.ts";
import {
  ensureServerGroup,
  leaveServer,
  serverGroupFor,
  setServerNickname,
  syncServerMemberships,
  syncSquadMemberships,
} from "./groups.ts";
import { renameUser } from "./users.ts";

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

type GuildMember = {
  roles: string[];
  nick?: string | null;
  user?: { id: string; username: string; global_name?: string | null };
};

let botGuildCache: { at: number; ids: Set<string> } | undefined;

/** Servers the bot is in. Cached briefly; logins come in bursts at most. */
async function botGuildIds(): Promise<Set<string>> {
  if (botGuildCache && Date.now() - botGuildCache.at < 60_000) return botGuildCache.ids;
  const guilds = await discordApi<{ id: string }[]>("GET", "/users/@me/guilds?limit=200");
  botGuildCache = { at: Date.now(), ids: new Set(guilds.map((g) => g.id)) };
  return botGuildCache.ids;
}

/** A member's roles and nickname in a server, read with the bot token. Null if they aren't in it. */
async function guildMember(guildId: string, discordUserId: string): Promise<GuildMember | null> {
  try {
    return await discordApi<GuildMember>("GET", `/guilds/${guildId}/members/${discordUserId}`);
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
    const member = await guildMember(group.discordGuildId!, discordUserId);
    if (!member) continue;
    await syncSquadMemberships(db, userId, group.id, member.roles);
    await setServerNickname(db, userId, group.id, member.nick);
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
  await setServerNickname(db, userId, group.id, member.nick);
}


/**
 * The regular check of one server's members, for changes nobody tells Muster about (Discord only
 * sends member events over its Gateway, which Muster doesn't use): people who left the server lose
 * the group and its squads, everyone else gets their current name and squads. Returns whether
 * anything changed, so the caller can redraw boards.
 */
export async function checkServerMembers(db: Db, serverGroupId: string, guildId: string): Promise<boolean> {
  const members = await db
    .select({ userId: schema.groupMemberships.userId, discordId: schema.userIdentities.externalId })
    .from(schema.groupMemberships)
    .innerJoin(
      schema.userIdentities,
      and(eq(schema.userIdentities.userId, schema.groupMemberships.userId), eq(schema.userIdentities.provider, "discord")),
    )
    .where(and(eq(schema.groupMemberships.groupId, serverGroupId), eq(schema.groupMemberships.source, "discord")));

  let changed = false;
  for (const m of members) {
    let member: GuildMember | null;
    try {
      member = await discordApi<GuildMember>("GET", `/guilds/${guildId}/members/${m.discordId}`);
    } catch (e) {
      // 404 Unknown Member: they left (or were removed). Anything else: try again next time.
      if (!(e instanceof DiscordApiError && e.status === 404)) throw e;
      member = null;
    }
    if (!member) {
      await leaveServer(db, m.userId, serverGroupId);
      console.log(JSON.stringify({ event: "member_left_server", groupId: serverGroupId }));
      changed = true;
      continue;
    }
    if (member.user && (await renameUser(db, m.userId, member.user.global_name ?? member.user.username))) changed = true;
    if (await setServerNickname(db, m.userId, serverGroupId, member.nick)) changed = true;
    await syncSquadMemberships(db, m.userId, serverGroupId, member.roles);
  }
  return changed;
}
