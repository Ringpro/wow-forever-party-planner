import { describe, expect, it } from "vitest";
import { answerInterval, dayIntervals, dayStatus, resolveEffective, type AvailabilityAnswer } from "./availability.ts";
import { HOUR } from "./time.ts";

const CPH = "Europe/Copenhagen";
const answer = (status: AvailabilityAnswer["status"], startLocal: string | null, endLocal: string | null = null) => ({
  status,
  startLocal,
  endLocal,
  tz: CPH,
});

describe("resolveEffective", () => {
  const defaults = { 5: [answer("yes", "21:00")] };

  it("prefers the explicit answer", () => {
    expect(resolveEffective("2026-10-23", [answer("no", null)], defaults)).toEqual({ kind: "explicit", status: "no", slots: [] });
  });

  it("falls back to the weekday default", () => {
    expect(resolveEffective("2026-10-30", [], defaults)).toMatchObject({
      kind: "default",
      status: "yes",
      slots: [{ startLocal: "21:00" }],
    });
  });

  it("is unknown without either", () => {
    expect(resolveEffective("2026-10-24", [], defaults)).toEqual({ kind: "unknown" });
  });

  it("keeps several slots in time order and sums up the day", () => {
    const day = resolveEffective("2026-10-24", [answer("maybe", "00:30"), answer("maybe", "20:00"), answer("yes", "12:00")], {});
    expect(day).toMatchObject({ kind: "explicit", status: "yes" });
    expect(day.kind !== "unknown" && day.slots.map((s) => s.startLocal)).toEqual(["12:00", "20:00", "00:30"]);
  });
});

describe("dayStatus", () => {
  it("ranks yes over maybe over no", () => {
    expect(dayStatus([{ status: "maybe" }, { status: "yes" }])).toBe("yes");
    expect(dayStatus([{ status: "maybe" }])).toBe("maybe");
    expect(dayStatus([])).toBe("no");
  });
});

describe("answerInterval", () => {
  it("runs until the end of the night (05:00) without an end time", () => {
    const i = answerInterval("2026-10-23", answer("yes", "20:30"))!;
    expect(i.start).toBe(Date.parse("2026-10-23T18:30:00Z"));
    expect(i.end).toBe(Date.parse("2026-10-24T03:00:00Z"));
  });

  it("handles windows past midnight", () => {
    const i = answerInterval("2026-10-23", answer("maybe", "21:30", "00:30"))!;
    expect(i.end - i.start).toBe(3 * HOUR);
  });

  it("puts after-midnight starts on the next calendar date", () => {
    const i = answerInterval("2026-10-23", answer("yes", "01:00", "03:00"))!;
    expect(i.start).toBe(Date.parse("2026-10-23T23:00:00Z"));
    expect(i.end - i.start).toBe(2 * HOUR);
  });

  it("measures real elapsed time across the fall-back night", () => {
    const i = answerInterval("2026-10-24", answer("yes", "22:00", "04:00"))!;
    expect(i.end - i.start).toBe(7 * HOUR);
  });

  it("returns null for no or missing start", () => {
    expect(answerInterval("2026-10-23", answer("no", "20:00"))).toBeNull();
    expect(answerInterval("2026-10-23", answer("yes", null))).toBeNull();
  });
});

describe("dayIntervals", () => {
  it("ends an open slot where the next one starts, and the last one at the end of the night", () => {
    const [midday, evening] = dayIntervals("2026-10-23", [answer("maybe", "12:00"), answer("yes", "20:30")]);
    expect(midday!.end).toBe(Date.parse("2026-10-23T18:30:00Z"));
    expect(evening!.end).toBe(Date.parse("2026-10-24T03:00:00Z"));
  });

  it("leaves slots with an end time alone", () => {
    const [a, b] = dayIntervals("2026-10-23", [answer("yes", "12:00", "15:00"), answer("yes", "20:30", "23:00")]);
    expect(b!.start - a!.end).toBe(5.5 * HOUR);
    expect(b!.end - b!.start).toBe(2.5 * HOUR);
  });
});
