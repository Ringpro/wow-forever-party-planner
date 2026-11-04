// Names of the board's dot emojis. Discord shows them when someone hovers a dot (":cant_play:"),
// so they say what the dot means. Shared by the board and the register script that uploads them.
export const DOT_EMOJI_NAMES = {
  yes: "yes",
  maybe: "maybe",
  no: "cant_play",
  unknown: "no_answer",
} as const;

/** Names used before, so the register script can rename them in place and keep their ids. */
export const OLD_DOT_EMOJI_NAMES = { yes: "mu_yes", maybe: "mu_maybe", no: "mu_no", unknown: "mu_unknown" } as const;
