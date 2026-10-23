import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { handleInteraction } from "../../../lib/discord/interactions.ts";
import type { Interaction } from "../../../lib/discord/types.ts";
import { verifyDiscordRequest } from "../../../lib/discord/verify.ts";
import { getDb } from "../../../lib/server/db.ts";

export const POST: APIRoute = async ({ request, locals }) => {
  const body = await request.text();
  const valid = await verifyDiscordRequest(
    body,
    request.headers.get("x-signature-ed25519"),
    request.headers.get("x-signature-timestamp"),
    env.DISCORD_PUBLIC_KEY,
  );
  if (!valid) return new Response("invalid request signature", { status: 401 });

  const interaction = JSON.parse(body) as Interaction;
  const response = await handleInteraction(interaction, {
    db: getDb(),
    waitUntil: (promise) =>
      locals.cfContext.waitUntil(
        promise.catch((e) => console.log(JSON.stringify({ event: "background_failed", error: String(e) }))),
      ),
  });
  if (!response) return new Response("unsupported interaction", { status: 400 });
  return Response.json(response);
};
