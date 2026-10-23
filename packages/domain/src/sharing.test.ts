import { describe, expect, it } from "vitest";
import { visibleInGroup } from "./sharing.ts";

const dads = { groupId: "dads", shareAvailability: true };

describe("visibleInGroup", () => {
  it("shows entries to groups the user shares with", () => {
    expect(visibleInGroup("dads", dads, { shareScope: "all_shared_groups" })).toBe(true);
    expect(visibleInGroup("dads", dads, null)).toBe(true);
  });

  it("hides everything when the membership switch is off", () => {
    const off = { groupId: "work", shareAvailability: false };
    expect(visibleInGroup("work", off, { shareScope: "all_shared_groups" })).toBe(false);
    expect(visibleInGroup("work", off, null)).toBe(false);
  });

  it("limits selected entries to the chosen groups", () => {
    const onlyDads = { shareScope: "selected", groupIds: ["dads"] } as const;
    expect(visibleInGroup("dads", dads, onlyDads)).toBe(true);
    expect(visibleInGroup("work", { groupId: "work", shareAvailability: true }, onlyDads)).toBe(false);
  });

  it("never shows anything to non-members or a mismatched membership", () => {
    expect(visibleInGroup("work", undefined, { shareScope: "all_shared_groups" })).toBe(false);
    expect(visibleInGroup("work", dads, { shareScope: "all_shared_groups" })).toBe(false);
  });
});
