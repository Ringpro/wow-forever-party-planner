// Pure renderers for Discord messages. No database or network access, so they're easy to test.
import { addMinutesInGamingDay, isoWeekday, type LocalDate, type Status, type WallTime } from "@muster/domain";
import { DEFAULT_START, DISCORD_TIME_OPTIONS, dayLabel, timeIn, timeOptionsWith } from "../format.ts";
import { row, type ActionRow, type Button, type MessagePayload } from "./types.ts";

/** A day as the user answered it: the day status plus its Yes/Maybe time slots. */
type Answer = {
  status: Status;
  kind?: "explicit" | "default";
  slots: { status: Status; startLocal: string | null; endLocal: string | null }[];
};

type MemberDay = {
  userId?: string;
  displayName: string;
  status: Status | "unknown";
  startsAt: number | null;
  slots?: { status: "yes" | "maybe"; startsAt: number }[];
};

type DayView = {
  day: LocalDate;
  members: MemberDay[];
  counts: Record<Status | "unknown", number>;
  best: { startsAt: number; memberIds: string[]; includesMaybe: boolean } | null;
};

type FreeNowView = { displayName: string; until: number };

const ICON = { yes: "✓", maybe: "~", no: "✗" } as const;
const DOT = { yes: "🟢", maybe: "🟡", no: "🔴", unknown: "⚪" } as const;
const ACCENT = 0xe3b341;
const MAX_DOTS = 12;

// ── custom_id helpers ────────────────────────────────────────────────────────────────
// Wall times go into custom_ids as HHMM so ':' can separate fields.
export const hhmm = (t: WallTime) => t.replace(":", "");
export function fromHhmm(value: string | undefined): WallTime | null {
  return value && /^([01]\d|2[0-3])[0-5]\d$/.test(value) ? `${value.slice(0, 2)}:${value.slice(2)}` : null;
}

const shortDay = (day: LocalDate) => dayLabel(day).slice(0, 3);
const dom = (day: LocalDate) => String(Number(day.slice(8)));

function sharedLine(sharedWith: string[]): string {
  return sharedWith.length > 0
    ? `-# Shared with ${sharedWith.join(", ")}`
    : "-# Not shared with any group yet. Join or create one on the website.";
}

/** "<@123> 20:30" when we know their Discord id, else their name. Mentions never ping (allowed_mentions). */
function who(m: MemberDay, tz: string, mentions?: Map<string, string>): string {
  const id = m.userId ? mentions?.get(m.userId) : undefined;
  const name = id ? `<@${id}>` : `**${m.displayName}**`;
  const times = m.slots?.length ? m.slots.map((s) => timeIn(s.startsAt, tz)) : m.startsAt !== null ? [timeIn(m.startsAt, tz)] : [];
  const maybe = m.status === "maybe" ? " (maybe)" : "";
  return `${name}${times.length ? ` ${times.join(" & ")}` : ""}${maybe}`;
}

// ── Week planner (/avail, "Plan my week") ────────────────────────────────────────────────

export type PlannerInput = {
  tz: string;
  days: LocalDate[];
  entries: Map<LocalDate, Answer>;
  selectedDay: LocalDate;
  pendingStart: WallTime;
  sharedWith: string[];
  websiteUrl: string;
  notice?: string;
};

function dayButtonLabel(day: LocalDate, answer: Answer | undefined, today: LocalDate, selected: boolean): string {
  const name = day === today ? "Today" : `${shortDay(day)} ${dom(day)}`;
  const detail = !answer
    ? ""
    : answer.status === "no"
      ? " ✗"
      : answer.slots.length > 1
        ? ` · ${answer.slots.length} times`
        : answer.slots[0]?.startLocal
          ? ` · ${answer.status === "maybe" ? "~" : ""}${answer.slots[0].startLocal}`
          : "";
  return `${selected ? "▸ " : ""}${name}${detail}`;
}

/** Discord button colours for a day: green yes, blurple maybe, red no, grey not set. */
function dayButtonStyle(answer: Answer | undefined): 1 | 2 | 3 | 4 {
  if (!answer) return 2;
  return answer.status === "yes" ? 3 : answer.status === "maybe" ? 1 : 4;
}

function slotText(s: Answer["slots"][number]): string {
  const label = s.status === "maybe" ? "Maybe" : "Yes";
  return `${ICON[s.status as "yes" | "maybe"]} ${label} ${s.startLocal}–${s.endLocal ?? "late"}`;
}

export function plannerMessage(input: PlannerInput): MessagePayload {
  const { days, entries, selectedDay } = input;
  const today = days[0]!;
  const current = entries.get(selectedDay);
  const nextWeekAt = days.findIndex((d, i) => i > 0 && isoWeekday(d) === 1);
  const thisWeek = nextWeekAt === -1 ? days : days.slice(0, nextWeekAt);
  const nextWeek = nextWeekAt === -1 ? [] : days.slice(nextWeekAt);
  const showingNext = nextWeek.includes(selectedDay);
  const shown = showingNext ? nextWeek : thisWeek;

  const dayButtons: Button[] = shown.map((d) => ({
    type: 2,
    style: dayButtonStyle(entries.get(d)),
    label: dayButtonLabel(d, entries.get(d), today, d === selectedDay),
    custom_id: `pl:day:${d}`,
  }));
  if (nextWeek.length > 0) {
    dayButtons.push({
      type: 2,
      style: 2,
      label: showingNext ? "← This week" : "Next week →",
      custom_id: `pl:week:${showingNext ? "this" : "next"}`,
    });
  }

  const start = input.pendingStart;
  const actions: Button[] = [
    { type: 2, style: 3, label: `+ Yes from ${start}`, custom_id: `pl:add:${selectedDay}:${hhmm(start)}:yes` },
    { type: 2, style: 1, label: "+ Maybe", custom_id: `pl:add:${selectedDay}:${hhmm(start)}:maybe` },
    { type: 2, style: 4, label: "Can't play", custom_id: `pl:no:${selectedDay}` },
  ];
  if (current && current.kind !== "default") {
    actions.push({ type: 2, style: 2, label: "Clear", custom_id: `pl:clear:${selectedDay}` });
  }
  const removers: Button[] =
    current && current.status !== "no"
      ? current.slots.map((s, i) => ({ type: 2, style: 2, label: `✕ ${s.startLocal}`, custom_id: `pl:rm:${selectedDay}:${i}` }))
      : [];

  const components: ActionRow[] = [
    row(...dayButtons.slice(0, 5)),
    ...(dayButtons.length > 5 ? [row(...dayButtons.slice(5, 10))] : []),
    row({
      type: 3,
      custom_id: `pl:start:${selectedDay}`,
      placeholder: "Start time",
      options: timeOptionsWith(DISCORD_TIME_OPTIONS, start)
        .slice(-25)
        .map((t) => ({ label: `From ${t}`, value: hhmm(t), default: t === start })),
    }),
    row(...actions),
    ...(removers.length > 0 ? [row(...removers)] : []),
  ];

  const dayLines = !current
    ? ["Not set yet. Pick a start time, then **+ Yes** or **+ Maybe**."]
    : current.status === "no"
      ? ["✗ Can't play"]
      : current.slots.map(slotText);
  const defaultNote = current?.kind === "default" ? ["-# From your weekly default. Changing it only changes this day."] : [];

  return {
    content: [
      `**Your plans** · times in ${input.tz.replaceAll("_", " ")}`,
      "",
      `**${dayLabel(selectedDay)}**`,
      ...dayLines,
      ...defaultNote,
      ...(input.notice ? ["", input.notice] : []),
      sharedLine(input.sharedWith),
    ].join("\n"),
    components,
  };
}

export function plannerStart(entry: Answer | undefined): WallTime {
  return entry?.slots[0]?.startLocal ?? DEFAULT_START;
}

// ── Time zone picker ─────────────────────────────────────────────────────────────────────

export const COMMON_ZONES = [
  "Europe/Copenhagen",
  "Europe/Stockholm",
  "Europe/Oslo",
  "Europe/Helsinki",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Brussels",
  "Europe/Paris",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Warsaw",
  "Europe/Athens",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Atlantic/Reykjavik",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Australia/Sydney",
  "Asia/Tokyo",
  "UTC",
];

export function timezoneMessage(websiteUrl: string): MessagePayload {
  return {
    content: "First, which time zone are you in? Not listed? Set it on the website instead.",
    components: [
      row({
        type: 3,
        custom_id: "tz:set",
        placeholder: "Your time zone",
        options: COMMON_ZONES.map((z) => ({ label: z.replaceAll("_", " "), value: z })),
      }),
      row({ type: 2, style: 5, label: "Set on website", url: `${websiteUrl}/onboarding?return_to=/app` }),
    ],
  };
}

// ── /delay and "+30 min" ─────────────────────────────────────────────────────────────────

export type DelayInput = {
  day: LocalDate;
  slot: number;
  from: WallTime;
  to: WallTime;
  ignored: boolean;
  sharedWith: string[];
};

export function delayMessage(input: DelayInput): MessagePayload {
  const { day, from, to } = input;
  const headline = input.ignored
    ? `${dayLabel(day)}: still **${to}** (you moved it a moment ago)`
    : from === to
      ? `${dayLabel(day)}: **${to}**`
      : `${dayLabel(day)}: **${to}** (was ${from})`;
  const buttons: Button[] = [];
  const later = addMinutesInGamingDay(to, 30);
  // Absolute targets, so pressing a button twice can't move the time twice. Slot = which time that day.
  const id = (target: WallTime, was: WallTime) => `dl:to:${day}:${input.slot}:${hhmm(target)}:${hhmm(was)}`;
  if (later) buttons.push({ type: 2, style: 1, label: "+30 more", custom_id: id(later, to) });
  if (from !== to) buttons.push({ type: 2, style: 2, label: `Undo (${from})`, custom_id: id(from, from) });
  return {
    content: `${headline}\n${sharedLine(input.sharedWith)}`,
    components: buttons.length > 0 ? [row(...buttons)] : [],
  };
}

// ── Free now ─────────────────────────────────────────────────────────────────────────────

export function freeNowMessage(until: number, tz: string, sharedWith: string[]): MessagePayload {
  return {
    content: `You're marked as **free to play until ${timeIn(until, tz)}**.\n${sharedLine(sharedWith)}`,
    components: [row({ type: 2, style: 2, label: "Not free anymore", custom_id: "fn:stop" })],
  };
}

// ── Group days (board and Who's on) ──────────────────────────────────────────────────────

const ORDER = { yes: 0, maybe: 1, no: 2, unknown: 3 } as const;

function dots(d: DayView): string {
  const sorted = [...d.members].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const shown = sorted.slice(0, MAX_DOTS).map((m) => DOT[m.status]).join("");
  return sorted.length > MAX_DOTS ? `${shown} +${sorted.length - MAX_DOTS}` : shown;
}

function dayLine(d: DayView, tz: string, isToday: boolean, groupSize: number): string {
  const name = isToday ? "**Today**" : `**${shortDay(d.day)} ${dom(d.day)}**`;
  const time = d.best ? `\`${timeIn(d.best.startsAt, tz)}\`` : "`  –  `";
  const note = d.best
    ? d.best.includesMaybe
      ? `${d.best.memberIds.length} with Maybes`
      : d.best.memberIds.length >= 5
        ? `${d.best.memberIds.length} of ${groupSize} · full party`
        : `${d.best.memberIds.length} of ${groupSize}`
    : d.counts.yes + d.counts.maybe > 0
      ? "not enough yet"
      : "nobody yet";
  return `${name} ${time} ${dots(d)} ${note}`;
}

export type BoardInput = {
  groupId: string;
  groupName: string;
  tz: string;
  minPlayers: number;
  days: DayView[];
  freeNow: FreeNowView[];
  /** Our user id → Discord user id, for clickable names. */
  mentions: Map<string, string>;
  websiteUrl: string;
};

export function boardMessage(input: BoardInput): MessagePayload {
  const { tz, groupId } = input;
  const groupSize = input.days[0]?.members.length ?? 0;
  const lines: string[] = [];
  if (input.freeNow.length > 0) {
    lines.push(
      `🟢 ${input.freeNow.map((f) => `**${f.displayName}** until ${timeIn(f.until, tz)}`).join(", ")} ${input.freeNow.length === 1 ? "is" : "are"} free right now`,
      "",
    );
  }
  input.days.forEach((d, i) => {
    lines.push(dayLine(d, tz, i === 0, groupSize));
    if (i === 0) {
      const playing = d.members.filter((m) => m.status === "yes" || m.status === "maybe");
      if (playing.length > 0) lines.push(`-# ${playing.map((m) => who(m, tz, input.mentions)).join(" · ")}`);
    }
  });
  return {
    content: "",
    embeds: [
      {
        title: `${input.groupName} · this week`,
        description: lines.join("\n"),
        footer: {
          text: `Earliest time ${input.minPlayers}+ can play · ${tz.replaceAll("_", " ")} time · Click a name to message them`,
        },
        color: ACCENT,
      },
    ],
    components: [
      row(
        { type: 2, style: 1, label: "Plan my week", custom_id: `bd:plan:${groupId}` },
        { type: 2, style: 3, label: "I'm free now", custom_id: `bd:free:${groupId}` },
        { type: 2, style: 2, label: "+30 min", custom_id: `bd:delay:${groupId}` },
        { type: 2, style: 2, label: "Who's on?", custom_id: `bd:who:${groupId}` },
        { type: 2, style: 5, label: "Website", url: `${input.websiteUrl}/groups/${groupId}` },
      ),
    ],
    allowed_mentions: { parse: [] },
  };
}

export type WhoInput = { groupName: string; day: DayView; freeNow: FreeNowView[] };

/**
 * Who's playing on one day, per group, with clickable names. `pick` adds a day picker
 * (custom_id prefix + the days to offer) so people can look at other evenings.
 */
export function whoMessage(
  groups: WhoInput[],
  tz: string,
  mentions: Map<string, string> = new Map(),
  pick?: { customId: string; days: LocalDate[]; selected: LocalDate },
): MessagePayload {
  if (groups.length === 0) {
    return { content: "You're not in any group yet. Add Muster to your Discord server, or create a group on the website." };
  }
  const blocks = groups.map((g) => {
    const playing = g.day.members.filter((m) => m.status === "yes" || m.status === "maybe");
    const out = g.day.members.filter((m) => m.status === "no").map((m) => m.displayName);
    const unknown = g.day.members.filter((m) => m.status === "unknown").map((m) => m.displayName);
    const lines = [`__${g.groupName}__ · ${dayLine(g.day, tz, false, g.day.members.length).replace(/^\*\*[^*]+\*\* /, "")}`];
    if (playing.length > 0) lines.push(playing.map((m) => who(m, tz, mentions)).join("\n"));
    if (out.length > 0) lines.push(`-# Can't play: ${out.join(", ")}`);
    if (unknown.length > 0) lines.push(`-# No answer: ${unknown.join(", ")}`);
    if (g.freeNow.length > 0) {
      lines.push(`🟢 Free now: ${g.freeNow.map((f) => `${f.displayName} (until ${timeIn(f.until, tz)})`).join(", ")}`);
    }
    return lines.join("\n");
  });
  const title = pick ? `**${dayLabel(pick.selected)}**` : "";
  return {
    content: [title, blocks.join("\n\n"), `-# Times in ${tz.replaceAll("_", " ")} · click a name to message them`]
      .filter(Boolean)
      .join("\n"),
    components: pick
      ? [
          row({
            type: 3,
            custom_id: pick.customId,
            placeholder: "Another day",
            options: pick.days.slice(0, 25).map((d, i) => ({
              label: i === 0 ? `Today (${dayLabel(d)})` : dayLabel(d),
              value: d,
              default: d === pick.selected,
            })),
          }),
        ]
      : [],
    allowed_mentions: { parse: [] },
  };
}
