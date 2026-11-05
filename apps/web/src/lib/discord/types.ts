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
  member?: { user: DiscordUser; permissions: string; roles?: string[]; nick?: string | null };
  /** "0" = installed in this server (guild install), "1" = installed by the user. */
  authorizing_integration_owners?: Record<string, string>;
  user?: DiscordUser;
  data?: {
    name?: string;
    options?: CommandOption[];
    custom_id?: string;
    component_type?: number;
    values?: string[];
  };
};

export type Emoji = { name: string; id?: string };

export type Button =
  | { type: 2; style: 1 | 2 | 3 | 4; label: string; custom_id: string; disabled?: boolean; emoji?: Emoji }
  | { type: 2; style: 5; label: string; url: string; emoji?: Emoji };

export type StringSelect = {
  type: 3;
  custom_id: string;
  placeholder?: string;
  options: { label: string; value: string; description?: string; default?: boolean }[];
};

export type ActionRow = { type: 1; components: (Button | StringSelect)[] };

export type Embed = { title?: string; description?: string; footer?: { text: string }; color?: number };

// Components V2: a card (container) holding text, dividers, sections and button rows.
// A message using them has the IS_COMPONENTS_V2 flag and no content or embeds.
export const COMPONENTS_V2 = 1 << 15;
export type TextDisplay = { type: 10; content: string };
export type Separator = { type: 14; divider?: boolean; spacing?: 1 | 2 };
export type Section = { type: 9; components: TextDisplay[]; accessory: Button };
export type CardChild = TextDisplay | Separator | Section | ActionRow;
export type Container = { type: 17; accent_color?: number; components: CardChild[] };
export type Component = ActionRow | Container | TextDisplay | Separator | Section;

export type MessagePayload = {
  content?: string;
  embeds?: Embed[];
  components?: Component[];
  flags?: number;
  allowed_mentions?: { parse: string[]; users?: string[] };
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

export const text = (content: string): TextDisplay => ({ type: 10, content });
export const divider = (): Separator => ({ type: 14, divider: true, spacing: 1 });
export const section = (content: string, accessory: Button): Section => ({
  type: 9,
  components: [text(content)],
  accessory,
});

/** A Components V2 message: one card with an accent stripe. */
export function card(children: CardChild[], accent = 0xe3b341): MessagePayload {
  return { flags: COMPONENTS_V2, components: [{ type: 17, accent_color: accent, components: children }] };
}

/** Every component in a message, nested ones included (for tests and checks). */
export function allComponents(m: MessagePayload): (Component | Button | StringSelect)[] {
  const out: (Component | Button | StringSelect)[] = [];
  const visit = (c: Component | Button | StringSelect) => {
    out.push(c);
    if ("components" in c) for (const child of c.components as (Component | Button | StringSelect)[]) visit(child);
    if ("accessory" in c) visit(c.accessory);
  };
  for (const c of m.components ?? []) visit(c);
  return out;
}

/** All the text a card shows, joined by newlines. */
export function cardText(m: MessagePayload): string {
  return allComponents(m)
    .filter((c): c is TextDisplay => c.type === 10)
    .map((c) => c.content)
    .join("\n");
}

export function hasPermission(permissions: string | undefined, permission: bigint): boolean {
  if (!permissions) return false;
  const bits = BigInt(permissions);
  return (bits & Permission.Administrator) !== 0n || (bits & permission) !== 0n;
}
