// Routes verified Discord interactions to use cases. Every handler acts as the Discord user who
// clicked or typed; custom_ids only say what to do, never who may do it (architecture §5.1).
import { env } from "cloudflare:workers";
import { HOUR, minutesIntoGamingDay, type LocalDate } from "@party/domain";
import type { Db } from "@party/db";
import { dayLabel } from "../format.ts";
import {
  clearAvailability,
  clearFreeNow,
  groupWeek,
  moveStart,
  myDays,
  myEntries,
  setAvailability,
  setFreeNow,
  sharedGroupNames,
  shiftToday,
  upcomingDays,
} from "../server/availability.ts";
import { boardForChannel, refreshBoardsFor, removeBoard, setupBoard } from "../server/boards.ts";
import { getGroupAsMember, listMyGroups } from "../server/groups.ts";
import type { SessionUser } from "../server/session.ts";
import { UserError, findOrCreateDiscordUser, getUser, setTimezone } from "../server/users.ts";
import {
  InteractionType,
  Permission,
  ResponseType,
  hasPermission,
  reply,
  row,
  update,
  type CommandOption,
  type Interaction,
  type InteractionResponse,
  type MessagePayload,
} from "./types.ts";
import {
  delayMessage,
  freeNowMessage,
  fromHhmm,
  plannerMessage,
  plannerStart,
  timezoneMessage,
  whoMessage,
} from "./views.ts";

export type InteractionContext = { db: Db; waitUntil: (promise: Promise<unknown>) => void };

type Handler = (args: {
  ctx: InteractionContext;
  interaction: Interaction;
  actor: SessionUser & { timezone: string };
  parts: string[];
}) => Promise<InteractionResponse>;

export async function handleInteraction(
  interaction: Interaction,
  ctx: InteractionContext,
): Promise<InteractionResponse | null> {
  if (interaction.type === InteractionType.Ping) return { type: ResponseType.Pong };
  const discordUser = interaction.member?.user ?? interaction.user;
  if (!discordUser) return null;

  const userId = await findOrCreateDiscordUser(ctx.db, {
    id: discordUser.id,
    username: discordUser.username,
    displayName: discordUser.global_name ?? discordUser.username,
  });
  const user = await getUser(ctx.db, userId);
  if (!user) return null;

  let handler: Handler | undefined;
  let parts: string[] = [];
  if (interaction.type === InteractionType.ApplicationCommand) {
    handler = COMMANDS[interaction.data?.name ?? ""];
  } else if (interaction.type === InteractionType.MessageComponent) {
    parts = (interaction.data?.custom_id ?? "").split(":");
    if (parts[0] === "tz" && parts[1] === "set") return pickTimezone(ctx, user, interaction);
    handler = COMPONENTS[`${parts[0]}:${parts[1]}`];
  } else {
    return null;
  }
  if (!handler) return reply({ content: "That button or command has expired. Run the command again." });
  if (!user.timezone) return reply(timezoneMessage(env.PUBLIC_BASE_URL));

  try {
    return await handler({ ctx, interaction, actor: { ...user, timezone: user.timezone }, parts });
  } catch (e) {
    if (e instanceof UserError) return reply({ content: e.message });
    throw e;
  }
}

function refresh(ctx: InteractionContext, userId: string) {
  ctx.waitUntil(refreshBoardsFor(ctx.db, { userId }));
}

function option(options: CommandOption[] | undefined, name: string): CommandOption["value"] {
  return options?.find((o) => o.name === name)?.value;
}

// ── Planner ──────────────────────────────────────────────────────────────────────────────

async function planner(
  db: Db,
  actor: SessionUser & { timezone: string },
  selectedDay?: string,
  pendingStart?: string | null,
  notice?: string,
): Promise<MessagePayload> {
  const days = upcomingDays(actor.timezone);
  const entries = new Map(
    [...(await myDays(db, actor.id, days))].flatMap(([d, a]) => (a.kind === "unknown" ? [] : [[d, a] as const])),
  );
  const day = selectedDay && days.includes(selectedDay) ? selectedDay : days[0]!;
  return plannerMessage({
    tz: actor.timezone,
    days,
    entries,
    selectedDay: day,
    pendingStart: pendingStart ?? plannerStart(entries.get(day)),
    sharedWith: await sharedGroupNames(db, actor.id),
    websiteUrl: env.PUBLIC_BASE_URL,
    notice,
  });
}

async function pickTimezone(ctx: InteractionContext, user: SessionUser, interaction: Interaction) {
  const tz = interaction.data?.values?.[0] ?? "";
  try {
    await setTimezone(ctx.db, user.id, tz);
  } catch (e) {
    if (e instanceof UserError) return reply({ content: e.message });
    throw e;
  }
  return update(await planner(ctx.db, { ...user, timezone: tz }, undefined, undefined, `Time zone set to ${tz}.`));
}

const setDay: Handler = async ({ ctx, actor, parts }) => {
  const [, , day = "", status = "", time] = parts;
  const start = fromHhmm(time);
  const existing = (await myEntries(ctx.db, actor.id, [day])).get(day);
  // Discord has no end-time picker; keep the website's end time if it still fits.
  const endLocal =
    existing?.endLocal && start && minutesIntoGamingDay(existing.endLocal) > minutesIntoGamingDay(start)
      ? existing.endLocal
      : null;
  await setAvailability(ctx.db, actor, { day, status, startLocal: start, endLocal }, "discord");
  refresh(ctx, actor.id);
  return update(await planner(ctx.db, actor, day, start, `Saved **${dayLabel(day)}**.`));
};

const clearDay: Handler = async ({ ctx, actor, parts }) => {
  const day = parts[2] ?? "";
  await clearAvailability(ctx.db, actor.id, day);
  refresh(ctx, actor.id);
  return update(await planner(ctx.db, actor, day, null, `Cleared **${dayLabel(day)}**.`));
};

// ── Free now, delay, who ─────────────────────────────────────────────────────────────────

async function markFree(ctx: InteractionContext, actor: SessionUser & { timezone: string }, hours: number) {
  const until = Date.now() + hours * HOUR;
  await setFreeNow(ctx.db, actor.id, until);
  refresh(ctx, actor.id);
  return reply(freeNowMessage(until, actor.timezone, await sharedGroupNames(ctx.db, actor.id)));
}

async function delayToday(ctx: InteractionContext, actor: SessionUser & { timezone: string }, minutes: number) {
  const result = await shiftToday(ctx.db, actor, minutes, "discord");
  if (!result.ignored) refresh(ctx, actor.id);
  return reply(delayMessage({ ...result, sharedWith: await sharedGroupNames(ctx.db, actor.id) }));
}

async function who(ctx: InteractionContext, actor: SessionUser & { timezone: string }, groupIds: string[], offset: number) {
  const groups = [];
  for (const groupId of groupIds) {
    const week = await groupWeek(ctx.db, actor, groupId);
    const day = week?.days[offset];
    if (week && day) groups.push({ groupName: week.group.name, day, freeNow: week.freeNow });
  }
  return reply(whoMessage(groups, actor.timezone));
}

/** Board buttons only work for members of the board's group. */
async function requireMember(ctx: InteractionContext, actorId: string, groupId: string) {
  if (!(await getGroupAsMember(ctx.db, actorId, groupId))) {
    throw new UserError("You're not in this group yet. Ask someone in it for an invite link.");
  }
}

// ── Board setup ──────────────────────────────────────────────────────────────────────────

function requireManageChannels(interaction: Interaction) {
  if (!interaction.guild_id || !interaction.channel_id) throw new UserError("Boards can only be set up in a server channel.");
  if (!hasPermission(interaction.member?.permissions, Permission.ManageChannels)) {
    throw new UserError("You need the Manage Channels permission here to set up a board.");
  }
  return { guildId: interaction.guild_id, channelId: interaction.channel_id };
}

const boardCommand: Handler = async ({ ctx, interaction, actor }) => {
  const sub = interaction.data?.options?.[0]?.name;
  const { channelId } = requireManageChannels(interaction);
  if (sub === "remove") {
    const name = await removeBoard(ctx.db, actor.id, channelId);
    return reply({ content: `Removed the **${name}** board from this channel.` });
  }

  const adminGroups = (await listMyGroups(ctx.db, actor.id)).filter((g) => g.role === "admin");
  if (adminGroups.length === 0) {
    return reply({
      content: `You need to be an admin of a group first. Create one here: ${env.PUBLIC_BASE_URL}/groups/new`,
    });
  }
  return reply({
    content:
      "Which group's board should go in this channel?\n" +
      "Everyone who can see this channel will see it: member names, Yes/Maybe and start times for the next 7 days.",
    components: [
      row({
        type: 3,
        custom_id: "bs:pick",
        placeholder: "Choose a group",
        options: adminGroups.slice(0, 25).map((g) => ({ label: g.name, value: g.id })),
      }),
    ],
  });
};

const pickBoardGroup: Handler = async ({ ctx, interaction, actor }) => {
  const target = requireManageChannels(interaction);
  const groupId = interaction.data?.values?.[0] ?? "";
  await setupBoard(ctx.db, actor.id, { groupId, ...target });
  return update({ content: "Board posted. It updates by itself whenever anyone changes their plans." });
};

// ── Routing tables ───────────────────────────────────────────────────────────────────────

const COMMANDS: Record<string, Handler> = {
  avail: async ({ ctx, actor }) => reply(await planner(ctx.db, actor)),
  play: async ({ ctx, interaction, actor }) => {
    const sub = interaction.data?.options?.[0];
    return markFree(ctx, actor, Number(option(sub?.options, "hours") ?? 2));
  },
  delay: async ({ ctx, interaction, actor }) =>
    delayToday(ctx, actor, Number(option(interaction.data?.options, "minutes") ?? 30)),
  who: async ({ ctx, interaction, actor }) => {
    const offset = option(interaction.data?.options, "day") === "tomorrow" ? 1 : 0;
    const board = interaction.channel_id ? await boardForChannel(ctx.db, interaction.channel_id) : undefined;
    const inBoardGroup = board && (await getGroupAsMember(ctx.db, actor.id, board.groupId));
    const groupIds = inBoardGroup ? [board.groupId] : (await listMyGroups(ctx.db, actor.id)).map((g) => g.id);
    return who(ctx, actor, groupIds, offset);
  },
  board: boardCommand,
};

const COMPONENTS: Record<string, Handler> = {
  "pl:day": async ({ ctx, interaction, actor }) => update(await planner(ctx.db, actor, interaction.data?.values?.[0])),
  "pl:start": async ({ ctx, interaction, actor, parts }) =>
    update(await planner(ctx.db, actor, parts[2], fromHhmm(interaction.data?.values?.[0]))),
  "pl:set": setDay,
  "pl:clear": clearDay,
  "dl:to": async ({ ctx, actor, parts }) => {
    const [, , day = "", to, was] = parts;
    const target = fromHhmm(to);
    if (!target) throw new UserError("That button has expired. Run /delay again.");
    const result = await moveStart(ctx.db, actor, day as LocalDate, target, "discord");
    refresh(ctx, actor.id);
    return update(
      delayMessage({ ...result, from: fromHhmm(was) ?? result.from, sharedWith: await sharedGroupNames(ctx.db, actor.id) }),
    );
  },
  "fn:stop": async ({ ctx, actor }) => {
    await clearFreeNow(ctx.db, actor.id);
    refresh(ctx, actor.id);
    return update({ content: "Okay, you're no longer marked as free." });
  },
  "bs:pick": pickBoardGroup,
  "bd:plan": async ({ ctx, actor, parts }) => {
    await requireMember(ctx, actor.id, parts[2] ?? "");
    return reply(await planner(ctx.db, actor));
  },
  "bd:free": async ({ ctx, actor, parts }) => {
    await requireMember(ctx, actor.id, parts[2] ?? "");
    return markFree(ctx, actor, 2);
  },
  "bd:delay": async ({ ctx, actor, parts }) => {
    await requireMember(ctx, actor.id, parts[2] ?? "");
    return delayToday(ctx, actor, 30);
  },
  "bd:who": async ({ ctx, actor, parts }) => {
    const groupId = parts[2] ?? "";
    await requireMember(ctx, actor.id, groupId);
    return who(ctx, actor, [groupId], 0);
  },
};
