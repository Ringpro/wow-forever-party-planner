// The small subset of Discord's interaction and message shapes we use.
export const InteractionType = { Ping: 1, ApplicationCommand: 2, MessageComponent: 3 } as const;
export const ResponseType = { Pong: 1, ChannelMessage: 4, UpdateMessage: 7 } as const;
export const ComponentType = { ActionRow: 1, Button: 2, StringSelect: 3 } as const;
export const ButtonStyle = { Primary: 1, Secondary: 2, Success: 3, Danger: 4, Link: 5 } as const;
export const EPHEMERAL = 1 << 6;

export const Permission = {
  Administrator: 1n << 3n,
  ManageChannels: 1n << 4n,
} as const;

export type DiscordUser = { id: string; username: string; global_name?: string | null };

export type CommandOption = {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: CommandOption[];
};

export type Interaction = {
  id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  member?: { user: DiscordUser; permissions: string };
  user?: DiscordUser;
  data?: {
    name?: string;
    options?: CommandOption[];
    custom_id?: string;
    component_type?: number;
    values?: string[];
  };
};

export type Button =
  | { type: 2; style: 1 | 2 | 3 | 4; label: string; custom_id: string; disabled?: boolean }
  | { type: 2; style: 5; label: string; url: string };

export type StringSelect = {
  type: 3;
  custom_id: string;
  placeholder?: string;
  options: { label: string; value: string; description?: string; default?: boolean }[];
};

export type ActionRow = { type: 1; components: (Button | StringSelect)[] };

export type Embed = { title?: string; description?: string; footer?: { text: string }; color?: number };

export type MessagePayload = {
  content?: string;
  embeds?: Embed[];
  components?: ActionRow[];
  flags?: number;
  allowed_mentions?: { parse: string[] };
};

export type InteractionResponse =
  | { type: typeof ResponseType.Pong }
  | { type: typeof ResponseType.ChannelMessage | typeof ResponseType.UpdateMessage; data: MessagePayload };

export function row(...components: (Button | StringSelect)[]): ActionRow {
  return { type: 1, components };
}

/** A new ephemeral reply, never pinging anyone. */
export function reply(data: MessagePayload): InteractionResponse {
  return {
    type: ResponseType.ChannelMessage,
    data: { allowed_mentions: { parse: [] }, ...data, flags: (data.flags ?? 0) | EPHEMERAL },
  };
}

/** Replaces the message the component was on. */
export function update(data: MessagePayload): InteractionResponse {
  return { type: ResponseType.UpdateMessage, data: { allowed_mentions: { parse: [] }, components: [], ...data } };
}

export function hasPermission(permissions: string | undefined, permission: bigint): boolean {
  if (!permissions) return false;
  const bits = BigInt(permissions);
  return (bits & Permission.Administrator) !== 0n || (bits & permission) !== 0n;
}
