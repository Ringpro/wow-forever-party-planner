// Pure renderers for Discord messages. No database or network access, so they're easy to test.
import { addMinutesInGamingDay, type LocalDate, type Status, type WallTime } from "@party/domain";
import { DEFAULT_START, TIME_OPTIONS, dayLabel, timeIn } from "../format.ts";
import { row, type ActionRow, type Button, type MessagePayload } from "./types.ts";

type Answer = { status: Status; startLocal: string | null; endLocal: string | null };

type DayView = {
  day: LocalDate;
  members: { displayName: string; status: Status | "unknown"; startsAt: number | null }[];
  counts: Record<Status | "unknown", number>;
  best: { startsAt: number; memberIds: string[]; includesMaybe: boolean } | null;
};

type FreeNowView = { displayName: string; until: number };

const ICON = { yes: "✓", maybe: "~", no: "✗" } as const;
const ACCENT = 0x5865f2;

// ── custom_id helpers ────────────────────────────────────────────────────────────────
// Wall times go into custom_ids as HHMM so ':' can separate fields.
export const hhmm = (t: WallTime) => t.replace(":", "");
export function fromHhmm(value: string | undefined): WallTime | null {
  return value && /^([01]\d|2[0-3])[0-5]\d$/.test(value) ? `${value.slice(0, 2)}:${value.slice(2)}` : null;
}

function answerText(a: Answer | undefined): string {
  if (!a) return "not set";
  if (a.status === "no") return `${ICON.no} No`;
  const label = a.status === "yes" ? "Yes" : "Maybe";
  return `${ICON[a.status]} ${label} from ${a.startLocal}${a.endLocal ? `–${a.endLocal}` : ""}`;
}

function sharedLine(sharedWith: string[]): string {
  return sharedWith.length > 0
    ? `Shared with: ${sharedWith.join(", ")}`
    : "Not shared with any group yet. Join or create one on the website.";
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

export function plannerMessage(input: PlannerInput): MessagePayload {
  const { days, entries, selectedDay } = input;
  const current = entries.get(selectedDay);
  const lines = days.map((d) => `\`${dayLabel(d).padEnd(10)}\` ${answerText(entries.get(d))}`);

  const statusButton = (status: Status, label: string, activeStyle: 1 | 3 | 4): Button => ({
    type: 2,
    style: current?.status === status ? activeStyle : 2,
    label,
    custom_id: `pl:set:${selectedDay}:${status}:${hhmm(input.pendingStart)}`,
  });
  const buttons: Button[] = [
    statusButton("yes", `${ICON.yes} Yes`, 3),
    statusButton("maybe", `${ICON.maybe} Maybe`, 1),
    statusButton("no", `${ICON.no} No`, 4),
  ];
  if (current) buttons.push({ type: 2, style: 2, label: "Clear", custom_id: `pl:clear:${selectedDay}` });

  const components: ActionRow[] = [
    row({
      type: 3,
      custom_id: "pl:day",
      options: days.map((d) => ({
        label: dayLabel(d),
        description: answerText(entries.get(d)),
        value: d,
        default: d === selectedDay,
      })),
    }),
    row({
      type: 3,
      custom_id: `pl:start:${selectedDay}`,
      options: TIME_OPTIONS.map((t) => ({ label: `From ${t}`, value: hhmm(t), default: t === input.pendingStart })),
    }),
    row(...buttons),
    row({ type: 2, style: 5, label: "Open website", url: `${input.websiteUrl}/app` }),
  ];

  return {
    content: [
      `**Your week** · times in ${input.tz.replaceAll("_", " ")}`,
      ...lines,
      "",
      input.notice ?? `Editing **${dayLabel(selectedDay)}**: pick a start time, then Yes, Maybe or No.`,
      sharedLine(input.sharedWith),
    ].join("\n"),
    components,
  };
}

export function plannerStart(entry: Answer | undefined): WallTime {
  return entry?.startLocal ?? DEFAULT_START;
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
  if (later) buttons.push({ type: 2, style: 1, label: "+30 more", custom_id: `dl:to:${day}:${hhmm(later)}:${hhmm(to)}` });
  if (from !== to) buttons.push({ type: 2, style: 2, label: `Undo (${from})`, custom_id: `dl:to:${day}:${hhmm(from)}:${hhmm(from)}` });
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

// ── Group days (board and /who) ──────────────────────────────────────────────────────────

function dayHeadline(d: DayView, tz: string): string {
  const label = `**${dayLabel(d.day)}**`;
  if (d.best) {
    const n = d.best.memberIds.length;
    const extra = d.best.includesMaybe ? " (counting Maybes)" : n >= 5 ? " · full party" : "";
    return `${label}: ${n} can play from **${timeIn(d.best.startsAt, tz)}**${extra}`;
  }
  if (d.counts.yes + d.counts.maybe === 0) return `${label}: no answers yet`;
  return `${label}: not enough players yet`;
}

function dayMembersLine(d: DayView, tz: string): string | null {
  const parts = d.members
    .filter((m) => m.status === "yes" || m.status === "maybe")
    .map((m) => `${ICON[m.status as "yes" | "maybe"]} ${m.displayName}${m.startsAt !== null ? ` ${timeIn(m.startsAt, tz)}` : ""}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function freeNowLine(freeNow: FreeNowView[], tz: string): string | null {
  if (freeNow.length === 0) return null;
  return `🟢 Free now: ${freeNow.map((f) => `${f.displayName} (until ${timeIn(f.until, tz)})`).join(", ")}`;
}

export type BoardInput = {
  groupId: string;
  groupName: string;
  tz: string;
  days: DayView[];
  freeNow: FreeNowView[];
  websiteUrl: string;
};

export function boardMessage(input: BoardInput): MessagePayload {
  const { tz, groupId } = input;
  const lines: string[] = [];
  const free = freeNowLine(input.freeNow, tz);
  if (free) lines.push(free, "");
  for (const d of input.days) {
    lines.push(dayHeadline(d, tz));
    const members = dayMembersLine(d, tz);
    if (members) lines.push(members);
  }
  return {
    content: "",
    embeds: [
      {
        title: `${input.groupName}: this week`,
        description: lines.join("\n"),
        footer: { text: `Times in ${tz.replaceAll("_", " ")}` },
        color: ACCENT,
      },
    ],
    components: [
      row(
        { type: 2, style: 1, label: "Plan my week", custom_id: `bd:plan:${groupId}` },
        { type: 2, style: 3, label: "Free now", custom_id: `bd:free:${groupId}` },
        { type: 2, style: 2, label: "+30 min", custom_id: `bd:delay:${groupId}` },
        { type: 2, style: 2, label: "Who's on?", custom_id: `bd:who:${groupId}` },
        { type: 2, style: 5, label: "Website", url: `${input.websiteUrl}/groups/${groupId}` },
      ),
    ],
    allowed_mentions: { parse: [] },
  };
}

export type WhoInput = { groupName: string; day: DayView; freeNow: FreeNowView[] };

export function whoMessage(groups: WhoInput[], tz: string): MessagePayload {
  if (groups.length === 0) {
    return { content: "You're not in any group yet. Create one or ask a friend for an invite link on the website." };
  }
  const blocks = groups.map((g) => {
    const lines = [`__${g.groupName}__`, dayHeadline(g.day, tz)];
    const members = dayMembersLine(g.day, tz);
    if (members) lines.push(members);
    const free = freeNowLine(g.freeNow, tz);
    if (free) lines.push(free);
    return lines.join("\n");
  });
  return { content: `${blocks.join("\n\n")}\n\n-# Times in ${tz.replaceAll("_", " ")}` };
}
