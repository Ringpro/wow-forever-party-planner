import { describe, expect, it } from "vitest";
import { BOT_PERMISSIONS, serverInstallUrl, userInstallUrl } from "./install.ts";
import { allComponents, cardText, COMPONENTS_V2, hasPermission, Permission, type MessagePayload } from "./types.ts";
import { gameOnAction, gameOnMessage } from "./game-on.ts";
import { nudgeAction, nudgeMessage } from "./nudge.ts";
import { verifyDiscordRequest } from "./verify.ts";
import { BOARD_DOT, boardMessage, delayMessage, fromHhmm, hhmm, plannerMessage, whoMessage } from "./views.ts";

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

const ids = (m: MessagePayload) => allComponents(m).flatMap((c) => ("custom_id" in c ? [c.custom_id] : []));
const labels = (m: MessagePayload) => allComponents(m).flatMap((c) => ("label" in c ? [c.label] : []));
/** The first action row of buttons in the card. */
const firstButtonRow = (m: MessagePayload) =>
  allComponents(m).find((c) => c.type === 1 && c.components.some((b) => b.type === 2)) as { components: { label?: string; style?: number; emoji?: { name: string } }[] };

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

  it("shows this week as day buttons coloured by answer, with a jump to next week", () => {
    const m = plannerMessage({
      ...base,
      entries: new Map([
        ["2026-10-23", { status: "yes" as const, slots: [{ status: "yes" as const, startLocal: "20:30", endLocal: null }] }],
        ["2026-10-25", { status: "no" as const, slots: [] }],
      ]),
    });
    expect(m.flags).toBe(COMPONENTS_V2);
    const dayRow = firstButtonRow(m).components;
    expect(dayRow.map((c) => c.label)).toEqual(["Today · 20:30", "Sat 24", "Sun 25 · No", "Next week →"]);
    expect(dayRow.map((c) => c.style)).toEqual([3, 2, 4, 2]);
    expect(dayRow.map((c) => c.emoji?.name ?? "")).toEqual(["", "✏️", "", ""]);
    expect(ids(m)).toContain("pl:week:next");
  });

  it("switches to next week when a next-week day is selected", () => {
    const m = plannerMessage({ ...base, selectedDay: "2026-10-28", entries: new Map() });
    expect(labels(m)).toContain("Wed 28");
    expect(cardText(m)).toContain("**Wed 28 Oct**");
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
    const text = cardText(m);
    expect(text).toContain("**Maybe**  12:00 – 15:00");
    expect(text).toContain("**Yes**  20:30 – late");
    expect(text).toContain("Shared with The Dads");
    expect(labels(m)).toEqual(expect.arrayContaining(["+ Yes", "+ Maybe", "Can't play Sat", "Clear Sat", "Remove"]));
  });

  it("marks weekly defaults and offers no Clear for them", () => {
    const m = plannerMessage({
      ...base,
      entries: new Map([["2026-10-24", { status: "yes" as const, kind: "default" as const, slots: [{ status: "yes" as const, startLocal: "20:00", endLocal: null }] }]]),
    });
    expect(cardText(m)).toContain("weekly default");
    expect(ids(m)).not.toContain("pl:clear:2026-10-24");
  });

  it("stays within Discord's component limits on the busiest day", () => {
    const four = ["12:00", "15:00", "18:00", "21:00"].map((s) => ({ status: "yes" as const, startLocal: s, endLocal: null }));
    const m = plannerMessage({ ...base, selectedDay: "2026-10-26", entries: new Map([["2026-10-26", { status: "yes" as const, slots: four }]]) });
    const all = allComponents(m);
    expect(all.length).toBeLessThanOrEqual(40);
    for (const c of all) {
      if (c.type === 1) expect(c.components.length).toBeLessThanOrEqual(5);
      if ("custom_id" in c) expect(c.custom_id.length).toBeLessThanOrEqual(100);
      if ("label" in c) expect(c.label.length).toBeLessThanOrEqual(80);
      if ("options" in c) expect(c.options.length).toBeLessThanOrEqual(25);
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
  it("puts one line per day on the board, with names for today and tomorrow only", () => {
    const m = boardMessage({
      groupId: "g1",
      groupName: "The Dads",
      tz: "Europe/Copenhagen",
      minPlayers: 2,
      days: [day, { ...day, day: "2026-10-29" }, { ...day, day: "2026-10-30" }],
      freeNow: [{ displayName: "Carsten", until: at("2026-10-28T21:30:00Z") }],
      websiteUrl: "https://example.test",
    });
    expect(m.flags).toBe(COMPONENTS_V2);
    expect(m.embeds).toBeUndefined();
    const text = cardText(m);
    const strip = [BOARD_DOT.yes, BOARD_DOT.maybe, BOARD_DOT.no, BOARD_DOT.unknown].join("");
    expect(text).toContain(`\`Today  ~21:00\`  ${strip}  2 with Maybes`);
    expect(text).toContain("`Thu 29 ~21:00`");
    expect(text).toContain("> **Anders** 20:30  ·  **Bo** 21:00 (maybe)");
    expect(text.split("**Anders**")).toHaveLength(3);
    expect(text).not.toContain("<@");
    expect(text).toContain("`Fri 30 ~21:00`");
    expect(text).toContain("**Carsten** is free right now, until 22:30");
    expect(text).not.toContain("Hidden");
    expect(m.allowed_mentions).toEqual({ parse: [] });
    expect(ids(m)).toContain("bd:who:g1");
  });

  it("shows who's on in the viewer's time zone with a day picker", () => {
    const m = whoMessage([{ groupName: "The Dads", day, freeNow: [] }], "Europe/London", {
      customId: "wd:g1",
      days: ["2026-10-28", "2026-10-29"],
      selected: "2026-10-28",
    });
    const text = cardText(m);
    expect(text).toContain("Who's on today");
    expect(text).toContain("**Anders** 19:30");
    expect(text).toContain("Can't play: Frank");
    expect(text).toContain("No answer: Hidden");
    expect(text).toContain("Times in Europe/London");
    expect(ids(m)).toEqual(["wd:g1"]);
    expect(m.allowed_mentions).toEqual({ parse: [] });
  });
});

describe("game on", () => {
  const at = (iso: string) => Date.parse(iso);
  const tz = "Europe/Copenhagen"; // UTC+1 in November
  const best = { startsAt: at("2026-11-04T19:30:00Z"), memberIds: ["u1", "u2", "u3"], includesMaybe: false };
  const base = { enabled: true, today: "2026-11-04", best, postedDay: null, hasMessage: false, tz };
  const now = (localTime: string) => at(`2026-11-04T${localTime}:00+01:00`);

  it("posts once a day when enough people said Yes, not before 10:00 or long after the start", () => {
    expect(gameOnAction({ ...base, now: now("09:30") })).toBe("none");
    expect(gameOnAction({ ...base, now: now("10:00") })).toBe("post");
    expect(gameOnAction({ ...base, now: now("21:00") })).toBe("post");
    expect(gameOnAction({ ...base, now: now("21:45") })).toBe("none");
    expect(gameOnAction({ ...base, enabled: false, now: now("12:00") })).toBe("none");
  });

  it("doesn't count a start that needs the Maybes", () => {
    expect(gameOnAction({ ...base, best: { ...best, includesMaybe: true }, now: now("12:00") })).toBe("none");
    expect(gameOnAction({ ...base, best: null, now: now("12:00") })).toBe("none");
  });

  it("keeps today's post up to date instead of posting again, even after it goes off", () => {
    const posted = { ...base, postedDay: "2026-11-04", hasMessage: true };
    expect(gameOnAction({ ...posted, now: now("12:00") })).toBe("update");
    expect(gameOnAction({ ...posted, best: null, now: now("12:00") })).toBe("update");
    expect(gameOnAction({ ...posted, hasMessage: false, now: now("12:00") })).toBe("none");
    expect(gameOnAction({ ...posted, postedDay: "2026-11-03", now: now("12:00") })).toBe("post");
  });

  const members = [
    { userId: "u1", displayName: "Anders", status: "yes" as const, slots: [{ status: "yes" as const, startsAt: best.startsAt }] },
    { userId: "u2", displayName: "Bo", status: "yes" as const, slots: [{ status: "yes" as const, startsAt: best.startsAt }] },
    { userId: "u3", displayName: "Carsten", status: "yes" as const, slots: [{ status: "yes" as const, startsAt: best.startsAt }] },
    { userId: "u4", displayName: "Dennis", status: "maybe" as const, slots: [{ status: "maybe" as const, startsAt: best.startsAt }] },
    { userId: "u5", displayName: "Erik", status: "no" as const },
  ];
  const input = {
    groupId: "g1",
    groupName: "The Dads",
    tz,
    minPlayers: 3,
    day: { day: "2026-11-04", members, best },
    mentions: new Map([["u1", "111111111111"], ["u2", "222222222222"], ["u4", "444444444444"]]),
  };

  it("mentions only tonight's party, with buttons to join, run late or drop out", () => {
    const m = gameOnMessage(input);
    const text = cardText(m);
    expect(text).toContain("Game on tonight · 20:30");
    expect(text).toContain("3 can play: <@111111111111> 20:30  ·  <@222222222222> 20:30  ·  **Carsten** 20:30");
    expect(text).toContain("Also: Dennis (maybe) 20:30");
    expect(text).not.toContain("<@444444444444>");
    expect(m.allowed_mentions).toEqual({ parse: [], users: ["111111111111", "222222222222"] });
    expect(ids(m)).toEqual(["go:in:g1:2026-11-04:2030", "bd:delay:g1", "go:out:g1:2026-11-04"]);
  });

  it("says when it's off, without pinging anyone", () => {
    const m = gameOnMessage({ ...input, day: { ...input.day, best: null } });
    expect(cardText(m)).toContain("Off tonight");
    expect(cardText(m)).toContain("The Yes times don't overlap enough right now.");
    const few = gameOnMessage({ ...input, day: { ...input.day, best: null, members: members.slice(0, 2) } });
    expect(cardText(few)).toContain("Only 2 said Yes now, 3 needed.");
    expect(m.allowed_mentions).toEqual({ parse: [] });
  });
});

describe("Sunday reminder", () => {
  const tz = "Europe/Copenhagen"; // UTC+1 in November
  const sunday = "2026-11-08";
  const base = { enabled: true, today: sunday, nudgedWeek: null, hasMessage: false, tz };
  const now = (day: string, localTime: string) => Date.parse(`${day}T${localTime}:00+01:00`);

  it("posts on Sunday evening only, once per week", () => {
    expect(nudgeAction({ ...base, now: now(sunday, "17:59") })).toBe("none");
    expect(nudgeAction({ ...base, now: now(sunday, "18:00") })).toBe("post");
    expect(nudgeAction({ ...base, now: now(sunday, "21:59") })).toBe("post");
    expect(nudgeAction({ ...base, now: now(sunday, "22:00") })).toBe("none");
    expect(nudgeAction({ ...base, enabled: false, now: now(sunday, "19:00") })).toBe("none");
    expect(nudgeAction({ ...base, today: "2026-11-07", now: now("2026-11-07", "19:00") })).toBe("none");
    expect(nudgeAction({ ...base, nudgedWeek: "2026-11-02", now: now(sunday, "19:00") })).toBe("post");
  });

  it("keeps this week's post up to date for the rest of Sunday", () => {
    const posted = { ...base, nudgedWeek: "2026-11-09", hasMessage: true };
    expect(nudgeAction({ ...posted, now: now(sunday, "23:30") })).toBe("update");
    expect(nudgeAction({ ...posted, hasMessage: false, now: now(sunday, "19:00") })).toBe("none");
    expect(nudgeAction({ ...posted, today: "2026-11-09", now: now("2026-11-09", "19:00") })).toBe("none");
  });

  const members = [
    { userId: "u1", displayName: "Anders" },
    { userId: "u2", displayName: "Bo" },
    { userId: "u3", displayName: "Carsten" },
  ];
  const input = {
    groupId: "g1",
    groupName: "The Dads",
    monday: "2026-11-09",
    members,
    waiting: members.slice(1),
    mentions: new Map([["u1", "111111111111"], ["u2", "222222222222"]]),
  };

  it("mentions only the people still waiting, with one-tap buttons", () => {
    const m = nudgeMessage(input);
    const text = cardText(m);
    expect(text).toContain("Next week · Mon 9 Nov – Sun 15 Nov");
    expect(text).toContain("Still waiting on <@222222222222>, **Carsten**.");
    expect(text).toContain("1 of 3 have planned.");
    expect(text).not.toContain("<@111111111111>");
    expect(m.allowed_mentions).toEqual({ parse: [], users: ["222222222222"] });
    expect(ids(m)).toEqual(["nw:copy:g1", "nw:usual:g1", "nw:plan:g1"]);
  });

  it("says thanks when everyone has planned", () => {
    const m = nudgeMessage({ ...input, waiting: [] });
    expect(cardText(m)).toContain("Everyone has planned next week.");
    expect(m.allowed_mentions).toEqual({ parse: [], users: [] });
  });
});
