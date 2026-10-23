import type { APIRoute } from "astro";
import { getDb } from "../../../lib/server/db.ts";
import { fetchDiscordUser } from "../../../lib/server/discord-oauth.ts";
import { RETURN_TO_COOKIE, STATE_COOKIE, oauthConfig } from "../../../lib/server/login.ts";
import { createSession, safeReturnTo, setSessionCookie } from "../../../lib/server/session.ts";
import { findOrCreateDiscordUser } from "../../../lib/server/users.ts";

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const expectedState = cookies.get(STATE_COOKIE)?.value;
  const returnTo = safeReturnTo(cookies.get(RETURN_TO_COOKIE)?.value);
  cookies.delete(STATE_COOKIE, { path: "/auth" });
  cookies.delete(RETURN_TO_COOKIE, { path: "/auth" });

  const code = url.searchParams.get("code");
  if (!code || !expectedState || url.searchParams.get("state") !== expectedState) {
    return new Response("Login failed or expired. Please try again.", { status: 400 });
  }

  const discordUser = await fetchDiscordUser(oauthConfig(), code);
  const db = getDb();
  const userId = await findOrCreateDiscordUser(db, {
    id: discordUser.id,
    username: discordUser.username,
    displayName: discordUser.global_name ?? discordUser.username,
  });
  const session = await createSession(db, userId);
  setSessionCookie(cookies, url, session.token, session.expiresAt);
  return redirect(returnTo);
};
