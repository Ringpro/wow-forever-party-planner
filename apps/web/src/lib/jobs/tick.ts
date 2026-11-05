// Runs every minute from the cron trigger. Each job must be idempotent (docs/architecture.md §8).
import { createDb, schema, type Db } from "@muster/db";
import { and, isNotNull, isNull } from "drizzle-orm";
import { refreshAllBoards } from "../server/boards.ts";
import { checkServerMembers } from "../server/discord-sync.ts";

/** How often server members are checked against Discord (people leaving, renames, roles). */
const MEMBER_CHECK_EVERY_MINUTES = 15;

export async function runTick(env: Env, scheduledTime: number): Promise<void> {
  const db = createDb(env.DB);
  if (new Date(scheduledTime).getUTCMinutes() % MEMBER_CHECK_EVERY_MINUTES === 0) {
    await checkAllServers(db);
  }
  // After the member check, so its changes are on the boards straight away.
  await refreshAllBoards(db);
}

async function checkAllServers(db: Db): Promise<void> {
  const servers = await db
    .select({ id: schema.groups.id, guildId: schema.groups.discordGuildId })
    .from(schema.groups)
    .where(and(isNotNull(schema.groups.discordGuildId), isNull(schema.groups.parentGroupId)));
  for (const server of servers) {
    try {
      await checkServerMembers(db, server.id, server.guildId!);
    } catch (e) {
      // The bot may have been removed from the server; the next login sorts that out.
      console.log(JSON.stringify({ event: "member_check_failed", groupId: server.id, error: String(e) }));
    }
  }
}
