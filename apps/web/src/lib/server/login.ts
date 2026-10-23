import { env } from "cloudflare:workers";
import type { DiscordOAuthConfig } from "./discord-oauth.ts";

export const STATE_COOKIE = "oauth_state";
export const RETURN_TO_COOKIE = "return_to";

export function oauthConfig(): DiscordOAuthConfig {
  return {
    clientId: env.DISCORD_CLIENT_ID,
    clientSecret: env.DISCORD_CLIENT_SECRET,
    redirectUri: `${env.PUBLIC_BASE_URL}/auth/discord/callback`,
  };
}
