import { describe, expect, it } from "vitest";
import { BOT_PERMISSIONS, serverInstallUrl, userInstallUrl } from "./install.ts";
import { hasPermission, Permission } from "./types.ts";
import { verifyDiscordRequest } from "./verify.ts";
import { boardMessage, delayMessage, fromHhmm, hhmm, plannerMessage, whoMessage } from "./views.ts";

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function signer() {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKeyHex = toHex(await crypto.subtle.exportKey("raw", pair.publicKey));
  const sign = async (timestamp: string, body: string) =>
    toHex(await crypto.subtle.sign("Ed25519", pair.privateKey, new TextEncoder().encode(timestamp + body)));
  return { publicKeyHex, sign };
}

describe("verifyDiscordRequest", () => {
  it("accepts a valid signature", async () => {
    const { publicKeyHex, sign } = await signer();
    const body = '{"type":1}';
    expect(await verifyDiscordRequest(body, await sign("1700000000", body), "1700000000", publicKeyHex)).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const { publicKeyHex, sign } = await signer();
    const signature = await sign("1700000000", '{"type":1}');
    expect(await verifyDiscordRequest('{"type":2}', signature, "1700000000", publicKeyHex)).toBe(false);
  });

  it("rejects missing headers and malformed hex", async () => {
    const { publicKeyHex } = await signer();
    expect(await verifyDiscordRequest("{}", null, "1", publicKeyHex)).toBe(false);
    expect(await verifyDiscordRequest("{}", "zz", "1", publicKeyHex)).toBe(false);
    expect(await verifyDiscordRequest("{}", "ab", "1", "")).toBe(false);
  });
});

describe("install links", () => {
  it("asks only for the documented permissions", () => {
    expect(BOT_PERMISSIONS).toBe(2147503104n);
    expect(new URL(serverInstallUrl("123")).searchParams.get("permissions")).toBe("2147503104");
  });

  it("user install needs no bot scope", () => {
    const url = new URL(userInstallUrl("123"));
    expect(url.searchParams.get("scope")).toBe("applications.commands");
    expect(url.searchParams.get("integration_type")).toBe("1");
  });
});

describe("permissions", () => {
  it("accepts Manage Channels or Administrator", () => {
    expect(hasPermission("16", Permission.ManageChannels)).toBe(true);
    expect(hasPermission("8", Permission.ManageChannels)).toBe(true);
    expect(hasPermission("2048", Permission.ManageChannels)).toBe(false);
    expect(hasPermission(undefined, Permission.ManageChannels)).toBe(false);
  });
});

const ids = (m: ReturnType<typeof plannerMessage>) =>
  (m.components ?? []).flatMap((r) => r.components.map((c) => ("custom_id" in c ? c.custom_id : null)));

describe("planner", () => {
  // Fri 23 Oct 2026 to Sun 1 Nov: this week Fri–Sun, next week Mon–Sun.
  const days = ["2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];
  const base = {
    tz: "Europe/Copenhagen",
    days,
    selectedDay: "2026-10-24",
    pendingStart: "21:00",
    sharedWith: ["The Dads"],
    websiteUrl: "https://example.test",
  };
  const labels = (m: ReturnType<typeof plannerMessage>) =>
    (m.components ?? []).flatMap((r) => r.components.map((c) => ("label" in c ? c.label : null)));

  it("shows this week as day buttons coloured by answer, with a jump to next week", () => {
    const m = plannerMessage({
      ...base,
      entries: new Map([
        ["2026-10-23", { status: "yes" as const, slots: [{ status: "yes" as const, startLocal: "20:30", endLocal: null }] }],
        ["2026-10-25", { status: "no" as const, slots: [] }],
      ]),
    });
    const dayRow = m.components![0]!.components;
    expect(dayRow.map((c) => ("label" in c ? c.label : ""))).toEqual(["Today · 20:30", "▸ Sat 24", "Sun 25 ✗", "Next week →"]);
    expect(dayRow.map((c) => ("style" in c ? c.style : 0))).toEqual([3, 2, 4, 2]);
    expect(ids(m)).toContain("pl:week:next");
  });

  it("switches to next week when a next-week day is selected", () => {
    const m = plannerMessage({ ...base, selectedDay: "2026-10-28", entries: new Map() });
    expect(labels(m)).toContain("▸ Wed 28");
    expect(labels(m)).toContain("← This week");
    expect(labels(m)).not.toContain("Today");
  });

  it("adds times with the chosen start and can remove each one", () => {
    const m = plannerMessage({
      ...base,
      entries: new Map([
        [
          "2026-10-24",
          {
            status: "yes" as const,
            slots: [
              { status: "maybe" as const, startLocal: "12:00", endLocal: "15:00" },
              { status: "yes" as const, startLocal: "20:30", endLocal: null },
            ],
          },
        ],
      ]),
    });
    expect(ids(m)).toEqual(expect.arrayContaining(["pl:add:2026-10-24:2100:yes", "pl:add:2026-10-24:2100:maybe", "pl:no:2026-10-24", "pl:clear:2026-10-24", "pl:rm:2026-10-24:0", "pl:rm:2026-10-24:1"]));
    expect(m.content).toContain("~ Maybe 12:00–15:00");
    expect(m.content).toContain("✓ Yes 20:30–late");
    expect(m.content).toContain("Shared with The Dads");
  });

  it("marks weekly defaults and offers no Clear for them", () => {
    const m = plannerMessage({
      ...base,
      entries: new Map([["2026-10-24", { status: "yes" as const, kind: "default" as const, slots: [{ status: "yes" as const, startLocal: "20:00", endLocal: null }] }]]),
    });
    expect(m.content).toContain("weekly default");
    expect(ids(m)).not.toContain("pl:clear:2026-10-24");
  });

  it("stays within Discord's component limits on the busiest day", () => {
    const four = ["12:00", "15:00", "18:00", "21:00"].map((s) => ({ status: "yes" as const, startLocal: s, endLocal: null }));
    const m = plannerMessage({ ...base, selectedDay: "2026-10-26", entries: new Map([["2026-10-26", { status: "yes" as const, slots: four }]]) });
    expect(m.components!.length).toBeLessThanOrEqual(5);
    for (const r of m.components!) {
      expect(r.components.length).toBeLessThanOrEqual(5);
      for (const c of r.components) {
        if ("custom_id" in c) expect(c.custom_id.length).toBeLessThanOrEqual(100);
        if ("label" in c) expect(c.label.length).toBeLessThanOrEqual(80);
        if ("options" in c) expect(c.options.length).toBeLessThanOrEqual(25);
      }
    }
  });
});

describe("delay", () => {
  it("offers +30 more and an absolute undo", () => {
    const m = delayMessage({ day: "2026-10-23", slot: 1, from: "20:30", to: "21:00", ignored: false, sharedWith: [] });
    expect(m.content).toContain("**21:00** (was 20:30)");
    expect(ids(m)).toEqual(["dl:to:2026-10-23:1:2130:2100", "dl:to:2026-10-23:1:2030:2030"]);
  });

  it("says so when a double tap was ignored", () => {
    const m = delayMessage({ day: "2026-10-23", slot: 0, from: "21:00", to: "21:00", ignored: true, sharedWith: [] });
    expect(m.content).toContain("moved it a moment ago");
  });
});

describe("wall time ids", () => {
  it("round-trips and rejects junk", () => {
    expect(fromHhmm(hhmm("09:30"))).toBe("09:30");
    expect(fromHhmm("2460")).toBeNull();
    expect(fromHhmm(undefined)).toBeNull();
  });
});

describe("board and who", () => {
  const at = (iso: string) => Date.parse(iso);
  const day = {
    day: "2026-10-28",
    members: [
      { userId: "u1", displayName: "Anders", status: "yes" as const, startsAt: at("2026-10-28T19:30:00Z") },
      { userId: "u2", displayName: "Bo", status: "maybe" as const, startsAt: at("2026-10-28T20:00:00Z") },
      { userId: "u3", displayName: "Hidden", status: "unknown" as const, startsAt: null },
      { userId: "u4", displayName: "Frank", status: "no" as const, startsAt: null },
    ],
    counts: { yes: 1, maybe: 1, no: 1, unknown: 1 },
    best: { startsAt: at("2026-10-28T20:00:00Z"), memberIds: ["u1", "u2"], includesMaybe: true },
  };
  const mentions = new Map([["u1", "111111111111"]]);

  it("puts one line per day on the board, with clickable names for today only", () => {
    const m = boardMessage({
      groupId: "g1",
      groupName: "The Dads",
      tz: "Europe/Copenhagen",
      minPlayers: 2,
      days: [day, { ...day, day: "2026-10-29" }],
      freeNow: [{ displayName: "Carsten", until: at("2026-10-28T21:30:00Z") }],
      mentions,
      websiteUrl: "https://example.test",
    });
    const text = m.embeds![0]!.description!;
    expect(text).toContain("**Today** `21:00` 🟢🟡🔴⚪ 2 with Maybes");
    expect(text).toContain("**Thu 29** `21:00`");
    expect(text).toContain("-# <@111111111111> 20:30 · **Bo** 21:00 (maybe)");
    expect(text.match(/<@111111111111>/g)).toHaveLength(1);
    expect(text).toContain("**Carsten** until 22:30 is free right now");
    expect(text).not.toContain("Hidden");
    expect(m.allowed_mentions).toEqual({ parse: [] });
    expect(ids(m)).toContain("bd:who:g1");
  });

  it("shows who's on in the viewer's time zone with a day picker", () => {
    const m = whoMessage([{ groupName: "The Dads", day, freeNow: [] }], "Europe/London", mentions, {
      customId: "wd:g1",
      days: ["2026-10-28", "2026-10-29"],
      selected: "2026-10-28",
    });
    expect(m.content).toContain("<@111111111111> 19:30");
    expect(m.content).toContain("Can't play: Frank");
    expect(m.content).toContain("No answer: Hidden");
    expect(m.content).toContain("Times in Europe/London");
    expect(ids(m)).toEqual(["wd:g1"]);
    expect(m.allowed_mentions).toEqual({ parse: [] });
  });
});
