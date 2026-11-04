// Routes verified Discord interactions to use cases. Every handler acts as the Discord user who
// clicked or typed; custom_ids only say what to do, never who may do it (architecture §5.1).
import { env } from "cloudflare:workers";
import { HOUR, isoWeekday, type LocalDate } from "@muster/domain";
import type { Db } from "@muster/db";
import { dayLabel } from "../format.ts";
import {
  clearAvailability,
  clearFreeNow,
  groupWeek,
  moveStart,
  addSlot,
  myDays,
  removeSlot,
  setDayStatus,
  setFreeNow,
  sharedGroupNames,
  shiftToday,
  planningDays,
} from "../server/availability.ts";
import { setMainLevel } from "../server/characters.ts";
import { syncFromInteraction } from "../server/discord-sync.ts";
import { boardForChannel, refreshBoardsFor, removeBoard, setupBoard } from "../server/boards.ts";
import { getGroupAsMember, listMyGroups, setGameOnPosts } from "../server/groups.ts";
import type { SessionUser } from "../server/session.ts";
import { UserError, discordIdsFor, findOrCreateDiscordUser, getUser, setTimezone } from "../server/users.ts";
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
  try {
    const known = await getUser(ctx.db, userId);
    await syncFromInteraction(ctx.db, userId, interaction, known?.timezone ?? null);
  } catch (e) {
    console.log(JSON.stringify({ event: "interaction_sync_failed", error: String(e) }));
  }
  const user = await getUser(ctx.db, userId);
  if (!user) return null;

  let handler: Handler | undefined;
  let parts: string[] = [];
  if (interaction.type === InteractionType.ApplicationCommand) {
    handler = COMMANDS[interaction.data?.name ?? ""];
  } else if (interaction.type === InteractionType.MessageComponent) {
    parts = (interaction.data?.custom_id ?? "").split(":");
    if (parts[0] === "tz" && parts[1] === "set") return pickTimezone(ctx, user, interaction);
    handler = COMPONENTS[`${parts[0]}:${parts[1]}`] ?? COMPONENTS[parts[0] ?? ""];
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
  const days = planningDays(actor.timezone);
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

const showDay: Handler = async ({ ctx, interaction, actor, parts }) =>
  update(await planner(ctx.db, actor, parts[2] || interaction.data?.values?.[0]));

const showWeek: Handler = async ({ ctx, actor, parts }) => {
  const days = planningDays(actor.timezone);
  const nextWeekAt = days.findIndex((d, i) => i > 0 && isoWeekday(d) === 1);
  return update(await planner(ctx.db, actor, parts[2] === "next" && nextWeekAt !== -1 ? days[nextWeekAt] : days[0]));
};

const addTime: Handler = async ({ ctx, actor, parts }) => {
  const [, , day = "", time, status] = parts;
  const start = fromHhmm(time);
  if (!start) throw new UserError("Pick a start time first.");
  await addSlot(ctx.db, actor, day, "discord", start, status === "maybe" ? "maybe" : "yes");
  refresh(ctx, actor.id);
  return update(await planner(ctx.db, actor, day, start, `Saved ${start} on **${dayLabel(day)}**.`));
};

const cantPlay: Handler = async ({ ctx, actor, parts }) => {
  const day = parts[2] ?? "";
  await setDayStatus(ctx.db, actor, day, "no", "discord");
  refresh(ctx, actor.id);
  return update(await planner(ctx.db, actor, day, null, `Saved: can't play **${dayLabel(day)}**.`));
};

const removeTime: Handler = async ({ ctx, actor, parts }) => {
  const [, , day = "", index = "0"] = parts;
  await removeSlot(ctx.db, actor, day, Number(index), "discord");
  refresh(ctx, actor.id);
  return update(await planner(ctx.db, actor, day, null, `Removed a time from **${dayLabel(day)}**.`));
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

/** Who's playing on one day, with clickable names and a picker for other days. */
async function whoOn(ctx: InteractionContext, actor: SessionUser & { timezone: string }, scope: string, day?: string) {
  const days = planningDays(actor.timezone);
  const selected = day && days.includes(day) ? day : days[0]!;
  const groupIds = scope === "all" ? (await listMyGroups(ctx.db, actor.id)).map((g) => g.id) : [scope];
  const groups = [];
  const memberIds = new Set<string>();
  for (const groupId of groupIds) {
    const week = await groupWeek(ctx.db, actor, groupId, [selected]);
    const groupDay = week?.days[0];
    if (!week || !groupDay) continue;
    groups.push({ groupName: week.group.name, day: groupDay, freeNow: selected === days[0] ? week.freeNow : [] });
    for (const m of week.members) memberIds.add(m.userId);
  }
  const mentions = await discordIdsFor(ctx.db, [...memberIds]);
  return whoMessage(groups, actor.timezone, mentions, { customId: `wd:${scope}`, days, selected });
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

  // This server and its squads first, then private groups; only ones the actor can manage.
  const mine = (await listMyGroups(ctx.db, actor.id)).filter((g) => g.role === "admin");
  const adminGroups = [
    ...mine.filter((g) => g.discordGuildId === interaction.guild_id),
    ...mine.filter((g) => g.kind === "private"),
  ];
  if (adminGroups.length === 0) {
    return reply({
      content: `Only people who can manage this server (or admins of a private group) can set up a board.`,
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
        options: adminGroups.slice(0, 25).map((g) => ({
          label: g.kind === "squad" ? `Squad: ${g.name}` : g.name,
          value: g.id,
        })),
      }),
    ],
  });
};

/** The reply after posting a board, with the switch for daily "game on" posts. */
function boardPostedMessage(groupId: string, gameOn: boolean): MessagePayload {
  return {
    content:
      "Board posted. It updates by itself whenever anyone changes their plans.\n" +
      (gameOn
        ? "**Game on posts are on:** once a day, when enough people said Yes for tonight, I'll post here and mention them."
        : "Want a ping when a game comes together? Turn on **game on posts**: once a day, when enough people said Yes for tonight, I'll post here and mention them."),
    components: [
      row(
        gameOn
          ? { type: 2, style: 2, label: "Turn off game on posts", custom_id: `gs:off:${groupId}` }
          : { type: 2, style: 3, label: "Turn on game on posts", custom_id: `gs:on:${groupId}` },
      ),
    ],
  };
}

const pickBoardGroup: Handler = async ({ ctx, interaction, actor }) => {
  const target = requireManageChannels(interaction);
  const groupId = interaction.data?.values?.[0] ?? "";
  await setupBoard(ctx.db, actor.id, { groupId, ...target });
  const access = await getGroupAsMember(ctx.db, actor.id, groupId);
  return update(boardPostedMessage(groupId, access?.group.gameOnPosts ?? false));
};

/** "Game on" buttons: Count me in adds a Yes at tonight's start, I'm out says can't play. */
const gameOnIn: Handler = async ({ ctx, actor, parts }) => {
  const [, , groupId = "", day = "", time] = parts;
  await requireMember(ctx, actor.id, groupId);
  const start = fromHhmm(time);
  if (!start) throw new UserError("That button has expired.");
  if (day !== planningDays(actor.timezone)[0]) throw new UserError("That game night is over.");
  await addSlot(ctx.db, actor, day, "discord", start, "yes");
  refresh(ctx, actor.id);
  return reply({ content: `You're in from **${start}** tonight. Change it any time with \`/avail\`.` });
};

const gameOnOut: Handler = async ({ ctx, actor, parts }) => {
  const [, , groupId = "", day = ""] = parts;
  await requireMember(ctx, actor.id, groupId);
  if (day !== planningDays(actor.timezone)[0]) throw new UserError("That game night is over.");
  await setDayStatus(ctx.db, actor, day, "no", "discord");
  refresh(ctx, actor.id);
  return reply({ content: "Okay, you're out tonight. The post updates for everyone." });
};

const toggleGameOn: Handler = async ({ ctx, interaction, actor, parts }) => {
  const on = parts[1] === "on";
  const groupId = parts[2] ?? "";
  requireManageChannels(interaction);
  await setGameOnPosts(ctx.db, actor.id, groupId, on);
  ctx.waitUntil(refreshBoardsFor(ctx.db, { groupIds: [groupId] }));
  return update(boardPostedMessage(groupId, on));
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
    const tomorrow = option(interaction.data?.options, "day") === "tomorrow";
    const board = interaction.channel_id ? await boardForChannel(ctx.db, interaction.channel_id) : undefined;
    const inBoardGroup = board && (await getGroupAsMember(ctx.db, actor.id, board.groupId));
    const days = planningDays(actor.timezone);
    return reply(await whoOn(ctx, actor, inBoardGroup ? board.groupId : "all", tomorrow ? days[1] : days[0]));
  },
  level: async ({ ctx, interaction, actor }) => {
    const character = await setMainLevel(ctx.db, actor.id, Number(option(interaction.data?.options, "level")), "discord");
    refresh(ctx, actor.id);
    return reply({ content: `**${character.name}** is now level ${character.level}. Ding!` });
  },
  board: boardCommand,
};

const COMPONENTS: Record<string, Handler> = {
  "pl:day": showDay,
  "pl:week": showWeek,
  "pl:start": async ({ ctx, interaction, actor, parts }) =>
    update(await planner(ctx.db, actor, parts[2], fromHhmm(interaction.data?.values?.[0]))),
  "pl:add": addTime,
  "pl:no": cantPlay,
  "pl:rm": removeTime,
  "pl:clear": clearDay,
  // "Who's on" day picker: wd:all or wd:<groupId>.
  wd: async ({ ctx, interaction, actor, parts }) => {
    const scope = parts[1] ?? "all";
    if (scope !== "all") await requireMember(ctx, actor.id, scope);
    return update(await whoOn(ctx, actor, scope, interaction.data?.values?.[0]));
  },
  "dl:to": async ({ ctx, actor, parts }) => {
    const [, , day = "", slot = "0", to, was] = parts;
    const target = fromHhmm(to);
    if (!target) throw new UserError("That button has expired. Run /delay again.");
    const result = await moveStart(ctx.db, actor, day as LocalDate, Number(slot), target, "discord");
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
  "gs:on": toggleGameOn,
  "gs:off": toggleGameOn,
  "go:in": gameOnIn,
  "go:out": gameOnOut,
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
    return reply(await whoOn(ctx, actor, groupId));
  },
};
