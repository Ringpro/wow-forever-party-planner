// The daily "game on" post: once a day, when tonight first has enough people who said Yes, the
// bot posts in the board channel and mentions them. The board itself is only ever edited, which
// notifies nobody; this is the one message meant to ping. Pure, so it's easy to test.
import { HOUR, minutesIntoGamingDay, utcToZoned, type LocalDate, type Status } from "@muster/domain";
import { timeIn } from "../format.ts";
import { card, row, text, type MessagePayload } from "./types.ts";
import { hhmm } from "./views.ts";

/** No new posts before this local time, so nobody is pinged at breakfast. */
export const GAME_ON_FROM = "10:00";
/** Nor once the session has been going this long. */
const LATE_LIMIT = HOUR;

type Best = { startsAt: number; memberIds: string[]; includesMaybe: boolean };

/** On when enough people overlap on Yes alone; a start that needs the Maybes doesn't count. */
export const isGameOn = (best: Best | null): best is Best => best !== null && !best.includesMaybe;

/**
 * What to do with a board channel's game-on post on this tick: post today's first one, keep an
 * existing one up to date (it can go off and on again, without pinging), or nothing.
 */
export function gameOnAction(input: {
  enabled: boolean;
  today: LocalDate;
  best: Best | null;
  postedDay: string | null;
  hasMessage: boolean;
  now: number;
  tz: string;
}): "post" | "update" | "none" {
  if (!input.enabled) return "none";
  if (input.postedDay === input.today) return input.hasMessage ? "update" : "none";
  if (!isGameOn(input.best)) return "none";
  const local = utcToZoned(input.now, input.tz).time;
  if (minutesIntoGamingDay(local) < minutesIntoGamingDay(GAME_ON_FROM)) return "none";
  if (input.now > input.best.startsAt + LATE_LIMIT) return "none";
  return "post";
}

type Member = {
  userId?: string;
  displayName: string;
  status: Status | "unknown";
  slots?: { status: "yes" | "maybe"; startsAt: number }[];
};

export type GameOnInput = {
  groupId: string;
  groupName: string;
  tz: string;
  minPlayers: number;
  day: { day: LocalDate; members: Member[]; best: Best | null };
  /** Our user id → Discord user id. */
  mentions: Map<string, string>;
};

const zoneName = (tz: string) => tz.split("/").pop()!.replaceAll("_", " ");

export function gameOnMessage(input: GameOnInput): MessagePayload {
  const { day, tz, groupId, mentions } = input;
  const best = day.best;
  const nameOf = (m: Member) => {
    const id = m.userId ? mentions.get(m.userId) : undefined;
    return id ? `<@${id}>` : `**${m.displayName}**`;
  };
  const firstTime = (m: Member) => (m.slots?.[0] ? ` ${timeIn(m.slots[0].startsAt, tz)}` : "");

  if (!isGameOn(best)) {
    const yes = day.members.filter((m) => m.status === "yes").length;
    return {
      ...card(
        [
          text(
            [
              "### Off tonight",
              yes < input.minPlayers
                ? `Only ${yes} said Yes now, ${input.minPlayers} needed.`
                : "The Yes times don't overlap enough right now.",
              `-# ${input.groupName} · ${zoneName(tz)} time`,
            ].join("\n"),
          ),
          row({ type: 2, style: 2, label: "Plan tonight", custom_id: `bd:plan:${groupId}` }),
        ],
        0x4e5058,
      ),
      allowed_mentions: { parse: [] },
    };
  }

  const inParty = day.members.filter((m) => m.userId && best.memberIds.includes(m.userId));
  const others = day.members.filter(
    (m) => (m.status === "yes" || m.status === "maybe") && !(m.userId && best.memberIds.includes(m.userId)),
  );
  const start = timeIn(best.startsAt, tz);
  const pinged = inParty.flatMap((m) => (m.userId && mentions.has(m.userId) ? [mentions.get(m.userId)!] : []));

  const lines = [
    `### ⚔️ Game on tonight · ${start}`,
    `${inParty.length} can play: ${inParty.map((m) => `${nameOf(m)}${firstTime(m)}`).join("  ·  ")}`,
  ];
  if (others.length > 0) {
    lines.push(
      `-# Also: ${others.map((m) => `${m.displayName}${m.status === "maybe" ? " (maybe)" : ""}${firstTime(m)}`).join(", ")}`,
    );
  }
  lines.push(`-# ${input.groupName} · ${zoneName(tz)} time`);

  return {
    ...card(
      [
        text(lines.join("\n")),
        row(
          { type: 2, style: 3, label: "Count me in", custom_id: `go:in:${groupId}:${day.day}:${hhmm(start)}` },
          { type: 2, style: 2, label: "+30 min", custom_id: `bd:delay:${groupId}` },
          { type: 2, style: 4, label: "I'm out", custom_id: `go:out:${groupId}:${day.day}` },
        ),
      ],
      0x3ba36b,
    ),
    // Only the people in tonight's party get a notification.
    allowed_mentions: { parse: [], users: pinged.slice(0, 100) },
  };
}
