// Slash command definitions, registered with `pnpm discord:register`.
// Keep this file free of runtime imports so the Node registration script can load it.
const OptionType = { SubCommand: 1, String: 3, Integer: 4 } as const;

// Guild install + user install; usable in servers, the bot's DMs and group DMs.
const EVERYWHERE = { integration_types: [0, 1], contexts: [0, 1, 2] };

export const COMMANDS = [
  {
    name: "avail",
    description: "Plan which evenings you can play this week",
    ...EVERYWHERE,
  },
  {
    name: "play",
    description: "Tell your groups you're free to play",
    ...EVERYWHERE,
    options: [
      {
        type: OptionType.SubCommand,
        name: "now",
        description: "You're free to play right now",
        options: [
          {
            type: OptionType.Integer,
            name: "hours",
            description: "How long you're free (default 2)",
            min_value: 1,
            max_value: 6,
          },
        ],
      },
    ],
  },
  {
    name: "delay",
    description: "Push today's start time later",
    ...EVERYWHERE,
    options: [
      {
        type: OptionType.Integer,
        name: "minutes",
        description: "How many minutes later (default 30)",
        min_value: 5,
        max_value: 180,
      },
    ],
  },
  {
    name: "who",
    description: "See who's playing",
    ...EVERYWHERE,
    options: [
      {
        type: OptionType.String,
        name: "day",
        description: "Which evening (default today)",
        choices: [
          { name: "Today", value: "today" },
          { name: "Tomorrow", value: "tomorrow" },
        ],
      },
    ],
  },
  {
    name: "board",
    description: "Your group's availability board in this channel",
    integration_types: [0],
    contexts: [0],
    default_member_permissions: String(1 << 4), // Manage Channels
    options: [
      { type: OptionType.SubCommand, name: "setup", description: "Post your group's board in this channel" },
      { type: OptionType.SubCommand, name: "remove", description: "Remove the board from this channel" },
    ],
  },
] as const;
