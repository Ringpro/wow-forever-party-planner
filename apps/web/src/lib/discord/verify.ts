// Discord signs every interaction with Ed25519 over `timestamp + body` (architecture §5, B2).
export async function verifyDiscordRequest(
  body: string,
  signatureHex: string | null,
  timestamp: string | null,
  publicKeyHex: string,
): Promise<boolean> {
  if (!signatureHex || !timestamp) return false;
  const signature = hexToBytes(signatureHex);
  const publicKey = hexToBytes(publicKeyHex);
  if (!signature || !publicKey) return false;

  try {
    const key = await crypto.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, signature, new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
