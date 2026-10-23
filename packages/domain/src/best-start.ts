import type { Interval } from "./availability.ts";
import { MINUTE } from "./time.ts";

export type MemberInterval = {
  memberId: string;
  status: "yes" | "maybe";
  interval: Interval;
};

export type BestStart = {
  startsAt: number;
  memberIds: string[];
  /** True when the minimum is only reached by counting Maybe answers. */
  includesMaybe: boolean;
};

export type BestStartOptions = {
  minPlayers: number;
  minOverlapMinutes: number;
};

/**
 * Earliest time at which at least `minPlayers` members overlap for `minOverlapMinutes`,
 * using Yes answers first and falling back to Yes + Maybe (PRD §5.1).
 */
export function bestStart(intervals: readonly MemberInterval[], options: BestStartOptions): BestStart | null {
  const yesOnly = earliestOverlap(
    intervals.filter((i) => i.status === "yes"),
    options,
  );
  if (yesOnly) return { ...yesOnly, includesMaybe: false };
  const withMaybe = earliestOverlap(intervals, options);
  return withMaybe ? { ...withMaybe, includesMaybe: true } : null;
}

// The earliest qualifying time is always some member's start time: at any qualifying time t,
// the latest start among the covering intervals also qualifies and is ≤ t.
function earliestOverlap(intervals: readonly MemberInterval[], { minPlayers, minOverlapMinutes }: BestStartOptions) {
  const overlapMs = minOverlapMinutes * MINUTE;
  const starts = [...new Set(intervals.map((i) => i.interval.start))].sort((a, b) => a - b);
  for (const t of starts) {
    const memberIds = [
      ...new Set(
        intervals.filter((i) => i.interval.start <= t && i.interval.end >= t + overlapMs).map((i) => i.memberId),
      ),
    ];
    if (memberIds.length >= minPlayers) return { startsAt: t, memberIds };
  }
  return null;
}
