// Pure renderers for Discord messages. No database or network access, so they're easy to test.
// The planner, board and Who's on are Components V2 cards: text, dividers and buttons inside one
// box with the gold accent stripe, matching the mockups.
import { addMinutesInGamingDay, isoWeekday, type LocalDate, type Status, type WallTime } from "@muster/domain";
import { DEFAULT_START, DISCORD_TIME_OPTIONS, dayLabel, timeIn, timeOptionsWith } from "../format.ts";
import EMOJI_IDS from "./emojis.json";
import {
  card,
  divider,
  row,
  section,
  text,
  type Button,
  type CardChild,
  type MessagePayload,
} from "./types.ts";

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

type DotKind = Status | "unknown";
const UNICODE_DOT = { yes: "🟢", maybe: "🟡", no: "🔴", unknown: "⚪" } as const;

/**
 * Dots for the board's day strips. The app's own small dot emojis when they've been uploaded
 * (`pnpm discord:register` writes their ids to emojis.json), else the standard emoji circles.
 */
const CUSTOM_IDS = EMOJI_IDS as Partial<Record<DotKind, string>>;
export const BOARD_DOT: Record<DotKind, string> = {
  yes: CUSTOM_IDS.yes ? `<:mu_yes:${CUSTOM_IDS.yes}>` : UNICODE_DOT.yes,
  maybe: CUSTOM_IDS.maybe ? `<:mu_maybe:${CUSTOM_IDS.maybe}>` : UNICODE_DOT.maybe,
  no: CUSTOM_IDS.no ? `<:mu_no:${CUSTOM_IDS.no}>` : UNICODE_DOT.no,
  unknown: CUSTOM_IDS.unknown ? `<:mu_unknown:${CUSTOM_IDS.unknown}>` : UNICODE_DOT.unknown,
};
const MAX_DOTS = 12;

// ── custom_id helpers ────────────────────────────────────────────────────────────────
// Wall times go into custom_ids as HHMM so ':' can separate fields.
export const hhmm = (t: WallTime) => t.replace(":", "");
export function fromHhmm(value: string | undefined): WallTime | null {
  return value && /^([01]\d|2[0-3])[0-5]\d$/.test(value) ? `${value.slice(0, 2)}:${value.slice(2)}` : null;
}

const shortDay = (day: LocalDate) => dayLabel(day).slice(0, 3);
const dom = (day: LocalDate) => String(Number(day.slice(8)));
const zoneName = (tz: string) => tz.split("/").pop()!.replaceAll("_", " ");

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

function dayButtonLabel(day: LocalDate, answer: Answer | undefined, today: LocalDate): string {
  const name = day === today ? "Today" : `${shortDay(day)} ${dom(day)}`;
  if (!answer) return name;
  if (answer.status === "no") return `${name} · No`;
  if (answer.slots.length > 1) return `${name} · ${answer.slots.length} times`;
  const start = answer.slots[0]?.startLocal;
  return start ? `${name} · ${answer.status === "maybe" ? "~" : ""}${start}` : name;
}

/** Discord button colours for a day: green yes, blurple maybe, red no, grey not set. */
function dayButtonStyle(answer: Answer | undefined): 1 | 2 | 3 | 4 {
  if (!answer) return 2;
  return answer.status === "yes" ? 3 : answer.status === "maybe" ? 1 : 4;
}

function slotText(s: Answer["slots"][number]): string {
  const maybe = s.status === "maybe";
  return `${maybe ? UNICODE_DOT.maybe : UNICODE_DOT.yes} **${maybe ? "Maybe" : "Yes"}**  ${s.startLocal} – ${s.endLocal ?? "late"}`;
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
    label: dayButtonLabel(d, entries.get(d), today),
    custom_id: `pl:day:${d}`,
    // The day being edited gets a pencil; Discord has no outline for buttons.
    ...(d === selectedDay ? { emoji: { name: "✏️" } } : {}),
  }));
  if (nextWeek.length > 0) {
    dayButtons.push({
      type: 2,
      style: 2,
      label: showingNext ? "← This week" : "Next week →",
      custom_id: `pl:week:${showingNext ? "this" : "next"}`,
    });
  }

  const short = selectedDay === today ? "today" : shortDay(selectedDay);
  const start = input.pendingStart;
  const actions: Button[] = [
    { type: 2, style: 3, label: "+ Yes", custom_id: `pl:add:${selectedDay}:${hhmm(start)}:yes` },
    { type: 2, style: 1, label: "+ Maybe", custom_id: `pl:add:${selectedDay}:${hhmm(start)}:maybe` },
    { type: 2, style: 4, label: `Can't play ${short}`, custom_id: `pl:no:${selectedDay}` },
  ];
  if (current && current.kind !== "default") {
    actions.push({ type: 2, style: 2, label: `Clear ${short}`, custom_id: `pl:clear:${selectedDay}` });
  }

  const dayTitle = [
    `**${dayLabel(selectedDay)}**`,
    ...(current?.kind === "default" ? ["-# From your weekly default. Changing it only changes this day."] : []),
  ].join("\n");
  const dayBody: CardChild[] = !current
    ? [text("Not set yet. Pick a start time, then **+ Yes** or **+ Maybe**.")]
    : current.status === "no"
      ? [text(`${UNICODE_DOT.no} **Can't play**`)]
      : current.slots.map((s, i) =>
          section(slotText(s), { type: 2, style: 2, label: "Remove", custom_id: `pl:rm:${selectedDay}:${i}` }),
        );

  return card([
    text(`### Your plans\n-# Tap a day to change it · ${zoneName(input.tz)} time`),
    row(...dayButtons.slice(0, 5)),
    ...(dayButtons.length > 5 ? [row(...dayButtons.slice(5, 10))] : []),
    divider(),
    text(dayTitle),
    ...dayBody,
    row({
      type: 3,
      custom_id: `pl:start:${selectedDay}`,
      placeholder: "New time",
      options: timeOptionsWith(DISCORD_TIME_OPTIONS, start)
        .slice(-25)
        .map((t) => ({ label: `From ${t}`, value: hhmm(t), default: t === start })),
    }),
    row(...actions),
    text([...(input.notice ? [`✅ ${input.notice}`] : []), sharedLine(input.sharedWith)].join("\n")),
  ]);
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

/** A card too, so picking a zone can turn it into the planner card in place. */
export function timezoneMessage(websiteUrl: string): MessagePayload {
  return card([
    text("### Which time zone are you in?\n-# Not listed? Set it on the website instead."),
    row({
      type: 3,
      custom_id: "tz:set",
      placeholder: "Your time zone",
      options: COMMON_ZONES.map((z) => ({ label: z.replaceAll("_", " "), value: z })),
    }),
    row({ type: 2, style: 5, label: "Set on website", url: `${websiteUrl}/onboarding?return_to=/app` }),
  ]);
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
  const shown = sorted.slice(0, MAX_DOTS).map((m) => BOARD_DOT[m.status]).join("");
  return sorted.length > MAX_DOTS ? `${shown} +${sorted.length - MAX_DOTS}` : shown;
}

function note(d: DayView, groupSize: number): string {
  if (!d.best) return d.counts.yes + d.counts.maybe > 0 ? "not enough yet" : "nobody yet";
  const n = d.best.memberIds.length;
  if (d.best.includesMaybe) return `${n} with Maybes`;
  return n >= 5 ? `${n} of ${groupSize} · full party` : `${n} of ${groupSize}`;
}

/**
 * Day and best time in one fixed-width code chip, so the columns line up like a table:
 * `Today   21:00`, `Fri 6  ~21:30` (~ = only with Maybes), `Sun 8     –  `.
 */
function dayChip(d: DayView, tz: string, isToday: boolean): string {
  const name = (isToday ? "Today" : `${shortDay(d.day)} ${dom(d.day)}`).padEnd(6, " ");
  const time = d.best ? `${d.best.includesMaybe ? "~" : " "}${timeIn(d.best.startsAt, tz)}` : "   –  ";
  return `\`${name} ${time}\``;
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

function freeNowLine(freeNow: FreeNowView[], tz: string): string {
  const names = freeNow.map((f) => `**${f.displayName}**`);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const until = freeNow.length === 1 ? `, until ${timeIn(freeNow[0]!.until, tz)}` : "";
  return `${UNICODE_DOT.yes} ${list} ${freeNow.length === 1 ? "is" : "are"} free right now${until}`;
}

export function boardMessage(input: BoardInput): MessagePayload {
  const { tz, groupId } = input;
  const groupSize = input.days[0]?.members.length ?? 0;
  const lines: string[] = [];
  input.days.forEach((d, i) => {
    lines.push(`${dayChip(d, tz, i === 0)}  ${dots(d)}  ${note(d, groupSize)}`);
    if (i === 0) {
      const playing = d.members.filter((m) => m.status === "yes" || m.status === "maybe");
      if (playing.length > 0) lines.push(`> ${playing.map((m) => who(m, tz, input.mentions)).join("  ·  ")}`);
    }
  });

  const message = card([
    text(
      `### ${input.groupName} · this week\n-# Earliest time ${input.minPlayers} or more can play · ${zoneName(tz)} time`,
    ),
    ...(input.freeNow.length > 0 ? [text(freeNowLine(input.freeNow, tz))] : []),
    divider(),
    text(lines.join("\n")),
    divider(),
    row(
      { type: 2, style: 1, label: "Plan my week", custom_id: `bd:plan:${groupId}` },
      { type: 2, style: 3, label: "I'm free now", custom_id: `bd:free:${groupId}` },
      { type: 2, style: 2, label: "+30 min", custom_id: `bd:delay:${groupId}` },
      { type: 2, style: 2, label: "Who's on?", custom_id: `bd:who:${groupId}` },
      { type: 2, style: 5, label: "Website", url: `${input.websiteUrl}/groups/${groupId}` },
    ),
    text(`-# Click a name to open their profile and message them. Nobody gets pinged. "Who's on?" shows any day.`),
  ]);
  return { ...message, allowed_mentions: { parse: [] } };
}

export type WhoInput = { groupName: string; day: DayView; freeNow: FreeNowView[] };

const MAX_WHO_GROUPS = 10;

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
  const title = !pick
    ? "Who's on"
    : pick.selected === pick.days[0]
      ? "Who's on today"
      : `Who's on ${dayLabel(pick.selected)}`;
  const header = text(`### ${title}\n-# Times in ${tz.replaceAll("_", " ")} · click a name to message them`);

  const blocks: CardChild[] =
    groups.length === 0
      ? [text("You're not in any group yet. Add Muster to your Discord server, or create a group on the website.")]
      : groups.slice(0, MAX_WHO_GROUPS).flatMap((g) => {
          const d = g.day;
          const playing = d.members.filter((m) => m.status === "yes" || m.status === "maybe");
          const out = d.members.filter((m) => m.status === "no").map((m) => m.displayName);
          const unknown = d.members.filter((m) => m.status === "unknown").map((m) => m.displayName);
          const best = d.best
            ? `starts \`${timeIn(d.best.startsAt, tz)}\` · ${note(d, d.members.length)}`
            : note(d, d.members.length);
          const lines = [`**${g.groupName}** · ${best}`];
          lines.push(playing.length > 0 ? playing.map((m) => who(m, tz, mentions)).join("  ·  ") : "Nobody has said yes yet.");
          const small = [
            ...(out.length > 0 ? [`Can't play: ${out.join(", ")}`] : []),
            ...(unknown.length > 0 ? [`No answer: ${unknown.join(", ")}`] : []),
          ];
          if (small.length > 0) lines.push(`-# ${small.join(" · ")}`);
          if (g.freeNow.length > 0) lines.push(freeNowLine(g.freeNow, tz));
          return [divider(), text(lines.join("\n"))];
        });

  const message = card([
    header,
    ...blocks,
    ...(pick && groups.length > 0
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
      : []),
  ]);
  return { ...message, allowed_mentions: { parse: [] } };
}
