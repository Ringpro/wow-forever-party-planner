// Minimal interaction router. Commands get real handlers as the MVP flows are built.
const InteractionType = { Ping: 1, ApplicationCommand: 2 } as const;
const ResponseType = { Pong: 1, ChannelMessage: 4 } as const;
const EPHEMERAL = 1 << 6;

export type Interaction = {
  type: number;
  data?: { name?: string };
};

export type InteractionResponse =
  | { type: typeof ResponseType.Pong }
  | { type: typeof ResponseType.ChannelMessage; data: { content: string; flags?: number } };

export function handleInteraction(interaction: Interaction): InteractionResponse | null {
  switch (interaction.type) {
    case InteractionType.Ping:
      return { type: ResponseType.Pong };
    case InteractionType.ApplicationCommand:
      return {
        type: ResponseType.ChannelMessage,
        data: { content: `\`/${interaction.data?.name ?? "?"}\` is coming soon.`, flags: EPHEMERAL },
      };
    default:
      return null;
  }
}
