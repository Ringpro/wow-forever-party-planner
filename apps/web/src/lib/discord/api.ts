// Discord REST calls made with the bot token (architecture §5, B3).
import { env } from "cloudflare:workers";
import type { MessagePayload } from "./types.ts";

const API = "https://discord.com/api/v10";

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | undefined,
    message: string,
  ) {
    super(message);
  }
}

export async function discordApi<T>(method: string, path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429 && attempt === 0) {
      const { retry_after } = (await res.json()) as { retry_after?: number };
      await new Promise((r) => setTimeout(r, Math.min((retry_after ?? 1) * 1000, 5000)));
      continue;
    }
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
      throw new DiscordApiError(res.status, err.code, err.message ?? res.statusText);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }
}

export function postMessage(channelId: string, message: MessagePayload) {
  return discordApi<{ id: string }>("POST", `/channels/${channelId}/messages`, message);
}

export function editMessage(channelId: string, messageId: string, message: MessagePayload) {
  return discordApi<{ id: string }>("PATCH", `/channels/${channelId}/messages/${messageId}`, message);
}

export function deleteMessage(channelId: string, messageId: string) {
  return discordApi<void>("DELETE", `/channels/${channelId}/messages/${messageId}`);
}

// Discord JSON error codes we react to.
export const ErrorCode = { UnknownChannel: 10003, UnknownMessage: 10008, MissingAccess: 50001 } as const;
