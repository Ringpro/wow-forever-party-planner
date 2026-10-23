import { describe, expect, it } from "vitest";
import { answerInterval, type AvailabilityAnswer } from "./availability.ts";
import { bestStart, type MemberInterval } from "./best-start.ts";

const DAY = "2026-10-28";

function member(
  memberId: string,
  status: "yes" | "maybe",
  startLocal: string,
  endLocal: string | null = null,
  tz = "Europe/Copenhagen",
): MemberInterval {
  const a: AvailabilityAnswer = { status, startLocal, endLocal, tz };
  return { memberId, status, interval: answerInterval(DAY, a, 120)! };
}

const at = (time: string) => Date.parse(`${DAY}T${time}:00+01:00`);

describe("bestStart", () => {
  const dads = [
    member("anders", "yes", "20:00", "23:00"),
    member("bo", "yes", "20:30"), // until 22:30
    member("carsten", "yes", "21:00", "23:00"),
    member("dennis", "maybe", "20:30", "23:30"),
  ];

  it("finds the earliest time enough Yes answers overlap", () => {
    expect(bestStart(dads, { minPlayers: 3, minOverlapMinutes: 60 })).toEqual({
      startsAt: at("21:00"),
      memberIds: ["anders", "bo", "carsten"],
      includesMaybe: false,
    });
  });

  it("falls back to counting Maybes", () => {
    expect(bestStart(dads, { minPlayers: 4, minOverlapMinutes: 60 })).toMatchObject({
      startsAt: at("21:00"),
      includesMaybe: true,
    });
  });

  it("requires the overlap to last long enough", () => {
    const short = [member("a", "yes", "20:00", "21:00"), member("b", "yes", "20:30", "22:00")];
    expect(bestStart(short, { minPlayers: 2, minOverlapMinutes: 60 })).toBeNull();
    expect(bestStart(short, { minPlayers: 2, minOverlapMinutes: 30 })?.startsAt).toBe(at("20:30"));
  });

  it("works past midnight", () => {
    const late = [member("a", "yes", "23:00", "01:30"), member("b", "yes", "23:30", "01:30")];
    expect(bestStart(late, { minPlayers: 2, minOverlapMinutes: 60 })?.startsAt).toBe(at("23:30"));
  });

  it("compares members in different time zones", () => {
    const mixed = [member("cph", "yes", "21:00", "23:00"), member("london", "yes", "20:00", "22:00", "Europe/London")];
    expect(bestStart(mixed, { minPlayers: 2, minOverlapMinutes: 60 })?.startsAt).toBe(at("21:00"));
  });

  it("returns null when there aren't enough players", () => {
    expect(bestStart(dads, { minPlayers: 5, minOverlapMinutes: 60 })).toBeNull();
  });
});
