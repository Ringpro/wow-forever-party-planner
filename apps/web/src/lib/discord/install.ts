// "Add to Discord" links for the Get the tools page (docs/distribution.md §1).
const Permission = {
  ViewChannel: 1n << 10n,
  SendMessages: 1n << 11n,
  EmbedLinks: 1n << 14n,
  UseApplicationCommands: 1n << 31n,
} as const;

export const BOT_PERMISSIONS =
  Permission.ViewChannel | Permission.SendMessages | Permission.EmbedLinks | Permission.UseApplicationCommands;

const AUTHORIZE_URL = "https://discord.com/oauth2/authorize";

export function serverInstallUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "bot applications.commands",
    permissions: BOT_PERMISSIONS.toString(),
    integration_type: "0",
  });
  return `${AUTHORIZE_URL}?${params}`;
}

export function userInstallUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "applications.commands",
    integration_type: "1",
  });
  return `${AUTHORIZE_URL}?${params}`;
}
