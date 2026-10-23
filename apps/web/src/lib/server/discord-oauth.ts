// Discord OAuth2 authorization code flow for website login. Scope `identify` only.
const AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const TOKEN_URL = "https://discord.com/api/oauth2/token";
const ME_URL = "https://discord.com/api/users/@me";

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
    scope: "identify",
    redirect_uri: config.redirectUri,
    state,
    prompt: "none",
  });
  return `${AUTHORIZE_URL}?${params}`;
}

export async function fetchDiscordUser(config: DiscordOAuthConfig, code: string): Promise<DiscordUser> {
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

  const meResponse = await fetch(ME_URL, { headers: { authorization: `Bearer ${access_token}` } });
  if (!meResponse.ok) throw new Error(`Discord user lookup failed: ${meResponse.status}`);
  return (await meResponse.json()) as DiscordUser;
}
