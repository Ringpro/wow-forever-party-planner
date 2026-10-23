import type { APIRoute } from "astro";
import { authorizationUrl } from "../../../lib/server/discord-oauth.ts";
import { randomToken } from "../../../lib/server/crypto.ts";
import { RETURN_TO_COOKIE, STATE_COOKIE, oauthConfig } from "../../../lib/server/login.ts";
import { safeReturnTo } from "../../../lib/server/session.ts";

export const GET: APIRoute = ({ url, cookies, redirect }) => {
  const config = oauthConfig();
  if (!config.clientId || !config.clientSecret) {
    return new Response("Discord login isn't configured on this server.", { status: 503 });
  }

  const state = randomToken(16);
  const cookie = { httpOnly: true, secure: url.protocol === "https:", sameSite: "lax", path: "/auth", maxAge: 600 } as const;
  cookies.set(STATE_COOKIE, state, cookie);
  cookies.set(RETURN_TO_COOKIE, safeReturnTo(url.searchParams.get("return_to")), cookie);
  return redirect(authorizationUrl(config, state));
};
