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
  const days = ["2026-10-23", "2026-10-24"];
  const base = {
    tz: "Europe/Copenhagen",
    days,
    selectedDay: "2026-10-23",
    pendingStart: "21:00",
    sharedWith: ["The Dads"],
    websiteUrl: "https://example.test",
  };

  it("puts the chosen start time into the status buttons", () => {
    const m = plannerMessage({ ...base, entries: new Map() });
    expect(ids(m)).toContain("pl:set:2026-10-23:yes:2100");
    expect(ids(m)).not.toContain("pl:clear:2026-10-23");
    expect(m.content).toContain("Shared with: The Dads");
  });

  it("highlights the current answer and offers Clear", () => {
    const m = plannerMessage({
      ...base,
      entries: new Map([["2026-10-23", { status: "maybe" as const, startLocal: "20:30", endLocal: null }]]),
    });
    const maybe = m.components![2]!.components.find((c) => "custom_id" in c && c.custom_id.includes(":maybe:"));
    expect(maybe && "style" in maybe ? maybe.style : null).toBe(1);
    expect(ids(m)).toContain("pl:clear:2026-10-23");
    expect(m.content).toContain("~ Maybe from 20:30");
  });

  it("stays within Discord's component limits", () => {
    const m = plannerMessage({ ...base, entries: new Map() });
    expect(m.components!.length).toBeLessThanOrEqual(5);
    for (const r of m.components!) {
      for (const c of r.components) {
        if ("custom_id" in c) expect(c.custom_id.length).toBeLessThanOrEqual(100);
        if ("options" in c) expect(c.options.length).toBeLessThanOrEqual(25);
      }
    }
  });
});

describe("delay", () => {
  it("offers +30 more and an absolute undo", () => {
    const m = delayMessage({ day: "2026-10-23", from: "20:30", to: "21:00", ignored: false, sharedWith: [] });
    expect(m.content).toContain("**21:00** (was 20:30)");
    expect(ids(m)).toEqual(["dl:to:2026-10-23:2130:2100", "dl:to:2026-10-23:2030:2030"]);
  });

  it("says so when a double tap was ignored", () => {
    const m = delayMessage({ day: "2026-10-23", from: "21:00", to: "21:00", ignored: true, sharedWith: [] });
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
      { displayName: "Anders", status: "yes" as const, startsAt: at("2026-10-28T19:30:00Z") },
      { displayName: "Bo", status: "maybe" as const, startsAt: at("2026-10-28T20:00:00Z") },
      { displayName: "Hidden", status: "unknown" as const, startsAt: null },
    ],
    counts: { yes: 1, maybe: 1, no: 0, unknown: 1 },
    best: { startsAt: at("2026-10-28T20:00:00Z"), memberIds: ["a", "b"], includesMaybe: true },
  };

  it("renders the board in the group's time zone without leaking hidden members", () => {
    const m = boardMessage({
      groupId: "g1",
      groupName: "The Dads",
      tz: "Europe/Copenhagen",
      days: [day],
      freeNow: [{ displayName: "Carsten", until: at("2026-10-28T21:30:00Z") }],
      websiteUrl: "https://example.test",
    });
    const text = m.embeds![0]!.description!;
    expect(text).toContain("2 can play from **21:00** (counting Maybes)");
    expect(text).toContain("✓ Anders 20:30 · ~ Bo 21:00");
    expect(text).toContain("Free now: Carsten (until 22:30)");
    expect(text).not.toContain("Hidden");
    expect(ids(m)).toContain("bd:plan:g1");
  });

  it("shows /who in the viewer's time zone", () => {
    const m = whoMessage([{ groupName: "The Dads", day, freeNow: [] }], "Europe/London");
    expect(m.content).toContain("from **20:00**");
    expect(m.content).toContain("Times in Europe/London");
  });
});
