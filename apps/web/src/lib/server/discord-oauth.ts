// Discord OAuth2 authorization code flow for website login. Scopes: `identify` (who you are) and
// `guilds` (which servers you're in, so Muster can put you in the ones that have the bot).
const AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const TOKEN_URL = "https://discord.com/api/oauth2/token";
const ME_URL = "https://discord.com/api/users/@me";
const GUILDS_URL = "https://discord.com/api/users/@me/guilds";

export type DiscordOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type DiscordUser = {
  id: string;
  username: string;
  global_name: string | null;
};

export function authorizationUrl(config: DiscordOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    scope: "identify guilds",
    redirect_uri: config.redirectUri,
    state,
    prompt: "none",
  });
  return `${AUTHORIZE_URL}?${params}`;
}

export type DiscordGuild = { id: string; name: string; icon: string | null; owner: boolean; permissions: string };

export async function fetchDiscordUser(
  config: DiscordOAuthConfig,
  code: string,
): Promise<{ user: DiscordUser; guilds: DiscordGuild[] }> {
  const tokenResponse = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: config.redirectUri }),
  });
  if (!tokenResponse.ok) throw new Error(`Discord token exchange failed: ${tokenResponse.status}`);
  const { access_token } = (await tokenResponse.json()) as { access_token: string };

  const headers = { authorization: `Bearer ${access_token}` };
  const [meResponse, guildsResponse] = await Promise.all([fetch(ME_URL, { headers }), fetch(GUILDS_URL, { headers })]);
  if (!meResponse.ok) throw new Error(`Discord user lookup failed: ${meResponse.status}`);
  const user = (await meResponse.json()) as DiscordUser;
  // Without the server list login still works; the user just isn't synced into servers this time.
  const guilds = guildsResponse.ok ? ((await guildsResponse.json()) as DiscordGuild[]) : [];
  return { user, guilds };
}
