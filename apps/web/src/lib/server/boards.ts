// Discord boards: one live message per linked channel (architecture §6.4).
import { env } from "cloudflare:workers";
import { schema, type Db } from "@party/db";
import { eq, inArray } from "drizzle-orm";
import { DiscordApiError, ErrorCode, deleteMessage, editMessage, postMessage } from "../discord/api.ts";
import { boardMessage } from "../discord/views.ts";
import { boardWeek } from "./availability.ts";
import { sha256Hex } from "./crypto.ts";
import { getGroupAsMember } from "./groups.ts";
import { UserError } from "./users.ts";

type Board = typeof schema.discordBoards.$inferSelect;

async function renderBoard(db: Db, groupId: string) {
  const week = await boardWeek(db, groupId);
  if (!week) return null;
  return boardMessage({
    groupId,
    groupName: week.group.name,
    tz: week.group.timezone,
    days: week.days,
    freeNow: week.freeNow,
    websiteUrl: env.PUBLIC_BASE_URL,
  });
}

/** Posts (or moves) a group's board to a channel. The actor must be a group admin. */
export async function setupBoard(
  db: Db,
  actorId: string,
  input: { groupId: string; guildId: string; channelId: string },
): Promise<void> {
  const access = await getGroupAsMember(db, actorId, input.groupId);
  if (access?.membership.role !== "admin") throw new UserError("Only group admins can set up a board.");

  const message = await renderBoard(db, input.groupId);
  if (!message) throw new UserError("That group doesn't exist anymore.");

  let posted: { id: string };
  try {
    posted = await postMessage(input.channelId, message);
  } catch (e) {
    if (e instanceof DiscordApiError && (e.status === 403 || e.code === ErrorCode.MissingAccess)) {
      throw new UserError(
        "I can't post in this channel. Add the bot to this server (Add to my server on the website) and make sure it can view and send messages here.",
      );
    }
    throw e;
  }

  const existing = await db
    .select()
    .from(schema.discordBoards)
    .where(eq(schema.discordBoards.channelId, input.channelId))
    .get();
  if (existing?.messageId) await deleteMessage(existing.channelId, existing.messageId).catch(() => {});

  const values = {
    groupId: input.groupId,
    guildId: input.guildId,
    messageId: posted.id,
    lastRenderedAt: Date.now(),
    lastRenderHash: await sha256Hex(JSON.stringify(message)),
  };
  await db
    .insert(schema.discordBoards)
    .values({ id: crypto.randomUUID(), channelId: input.channelId, ...values })
    .onConflictDoUpdate({ target: schema.discordBoards.channelId, set: values });
}

/** Removes the board from a channel. The actor must be an admin of the board's group. */
export async function removeBoard(db: Db, actorId: string, channelId: string): Promise<string> {
  const board = await boardForChannel(db, channelId);
  if (!board) throw new UserError("There's no board in this channel.");
  const access = await getGroupAsMember(db, actorId, board.groupId);
  if (access?.membership.role !== "admin") throw new UserError("Only admins of the board's group can remove it.");
  await db.delete(schema.discordBoards).where(eq(schema.discordBoards.id, board.id));
  if (board.messageId) await deleteMessage(board.channelId, board.messageId).catch(() => {});
  return access.group.name;
}

export async function boardForChannel(db: Db, channelId: string): Promise<Board | undefined> {
  return db.select().from(schema.discordBoards).where(eq(schema.discordBoards.channelId, channelId)).get();
}

async function refreshBoard(db: Db, board: Board): Promise<void> {
  const message = await renderBoard(db, board.groupId);
  if (!message) return;
  const hash = await sha256Hex(JSON.stringify(message));
  if (hash === board.lastRenderHash && board.messageId) return;

  let messageId = board.messageId;
  try {
    if (!messageId) throw new DiscordApiError(404, ErrorCode.UnknownMessage, "no message yet");
    await editMessage(board.channelId, messageId, message);
  } catch (e) {
    if (!(e instanceof DiscordApiError)) throw e;
    if (e.code === ErrorCode.UnknownMessage) {
      // Someone deleted the board message: post a fresh one.
      messageId = (await postMessage(board.channelId, message)).id;
    } else if (e.code === ErrorCode.UnknownChannel || e.status === 403) {
      // Channel gone or bot lost access: drop the board instead of retrying forever.
      console.log(JSON.stringify({ event: "board_dropped", boardId: board.id, status: e.status, code: e.code }));
      await db.delete(schema.discordBoards).where(eq(schema.discordBoards.id, board.id));
      return;
    } else {
      throw e;
    }
  }
  await db
    .update(schema.discordBoards)
    .set({ messageId, lastRenderHash: hash, lastRenderedAt: Date.now(), dirtySince: null })
    .where(eq(schema.discordBoards.id, board.id));
}

async function refreshEach(db: Db, boards: Board[]): Promise<void> {
  for (const board of boards) {
    try {
      await refreshBoard(db, board);
    } catch (e) {
      console.log(JSON.stringify({ event: "board_refresh_failed", boardId: board.id, error: String(e) }));
    }
  }
}

/** Refreshes the boards a change may affect: every group the user is in, plus any extra groups. */
export async function refreshBoardsFor(db: Db, change: { userId?: string; groupIds?: string[] }): Promise<void> {
  const groupIds = new Set(change.groupIds ?? []);
  if (change.userId) {
    const rows = await db
      .select({ groupId: schema.groupMemberships.groupId })
      .from(schema.groupMemberships)
      .where(eq(schema.groupMemberships.userId, change.userId));
    for (const r of rows) groupIds.add(r.groupId);
  }
  if (groupIds.size === 0) return;
  const boards = await db
    .select()
    .from(schema.discordBoards)
    .where(inArray(schema.discordBoards.groupId, [...groupIds]));
  await refreshEach(db, boards);
}

/** Minute tick: re-render every board; unchanged ones are skipped by hash. Covers day rollover and missed refreshes. */
export async function refreshAllBoards(db: Db): Promise<void> {
  await refreshEach(db, await db.select().from(schema.discordBoards));
}
