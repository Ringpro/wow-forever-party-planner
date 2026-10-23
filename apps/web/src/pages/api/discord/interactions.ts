import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { handleInteraction, type Interaction } from "../../../lib/discord/interactions.ts";
import { verifyDiscordRequest } from "../../../lib/discord/verify.ts";

export const POST: APIRoute = async ({ request }) => {
  const body = await request.text();
  const valid = await verifyDiscordRequest(
    body,
    request.headers.get("x-signature-ed25519"),
    request.headers.get("x-signature-timestamp"),
    env.DISCORD_PUBLIC_KEY,
  );
  if (!valid) return new Response("invalid request signature", { status: 401 });

  const response = handleInteraction(JSON.parse(body) as Interaction);
  if (!response) return new Response("unknown interaction type", { status: 400 });
  return Response.json(response);
};
