import { describe, expect, it } from "vitest";
import { handleInteraction } from "./interactions.ts";
import { BOT_PERMISSIONS, serverInstallUrl, userInstallUrl } from "./install.ts";
import { verifyDiscordRequest } from "./verify.ts";

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

describe("handleInteraction", () => {
  it("answers PING with PONG", () => {
    expect(handleInteraction({ type: 1 })).toEqual({ type: 1 });
  });

  it("answers commands ephemerally", () => {
    expect(handleInteraction({ type: 2, data: { name: "avail" } })).toMatchObject({ type: 4, data: { flags: 64 } });
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
