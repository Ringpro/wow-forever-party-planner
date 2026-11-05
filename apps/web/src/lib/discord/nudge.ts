// The Sunday "plan next week" post: once a week, on Sunday evening, the bot posts in the board
// channel and mentions whoever hasn't said anything about next week (no answers and no weekly
// defaults). It's edited as people answer, which pings nobody. Pure, so it's easy to test.
import { addDays, isoWeekday, minutesIntoGamingDay, utcToZoned, type LocalDate } from "@muster/domain";
import { dayLabel } from "../format.ts";
import { card, row, text, type MessagePayload } from "./types.ts";

/** Posts go out on Sunday between these local times. */
export const NUDGE_FROM = "18:00";
export const NUDGE_UNTIL = "22:00";

const SUNDAY = 7;

/**
 * What to do with a board channel's Sunday post on this tick: post this week's, keep it up to
 * date for the rest of Sunday evening, or nothing. A post still needs someone to be waiting.
 */
export function nudgeAction(input: {
  enabled: boolean;
  /** Today's gaming day in the group's time zone. */
  today: LocalDate;
  /** The Monday the last post was for. */
  nudgedWeek: string | null;
  hasMessage: boolean;
  now: number;
  tz: string;
}): "post" | "update" | "none" {
  if (!input.enabled || isoWeekday(input.today) !== SUNDAY) return "none";
  if (input.nudgedWeek === addDays(input.today, 1)) return input.hasMessage ? "update" : "none";
  const minutes = minutesIntoGamingDay(utcToZoned(input.now, input.tz).time);
  if (minutes < minutesIntoGamingDay(NUDGE_FROM) || minutes >= minutesIntoGamingDay(NUDGE_UNTIL)) return "none";
  return "post";
}

type Person = { userId: string; displayName: string };

export type NudgeInput = {
  groupId: string;
  groupName: string;
  monday: LocalDate;
  members: Person[];
  waiting: Person[];
  /** Our user id → Discord user id. */
  mentions: Map<string, string>;
};

const weekRange = (monday: LocalDate) => `${dayLabel(monday)} – ${dayLabel(addDays(monday, 6))}`;

export function nudgeMessage(input: NudgeInput): MessagePayload {
  const { groupId, members, waiting, mentions } = input;
  const nameOf = (p: Person) => {
    const id = mentions.get(p.userId);
    return id ? `<@${id}>` : `**${p.displayName}**`;
  };
  const planned = members.length - waiting.length;
  const done = waiting.length === 0;

  const lines = [`### 📅 Next week · ${weekRange(input.monday)}`];
  if (done) {
    lines.push("Everyone has planned next week. Thanks!");
  } else {
    lines.push(`Still waiting on ${waiting.map(nameOf).join(", ")}.`);
    lines.push(
      `-# ${planned} of ${members.length} have planned. One tap below does it, and **Make it my usual week** means you won't be asked again.`,
    );
  }
  lines.push(`-# ${input.groupName}`);

  const pinged = waiting.flatMap((p) => (mentions.has(p.userId) ? [mentions.get(p.userId)!] : []));
  return {
    ...card(
      [
        text(lines.join("\n")),
        row(
          { type: 2, style: 3, label: "Same as this week", custom_id: `nw:copy:${groupId}` },
          { type: 2, style: 1, label: "Make it my usual week", custom_id: `nw:usual:${groupId}` },
          { type: 2, style: 2, label: "Plan next week", custom_id: `nw:plan:${groupId}` },
        ),
      ],
      done ? 0x3ba36b : 0x5865f2,
    ),
    // Only the people still waiting get a notification, and only when it's first posted.
    allowed_mentions: { parse: [], users: pinged.slice(0, 100) },
  };
}
