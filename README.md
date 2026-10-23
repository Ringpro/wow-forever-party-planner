# Party Planner

**Less time planning. More time playing together.**

A small, free scheduling tool for groups of World of Warcraft players with little and unpredictable free time. Mark which evenings you can play, from the website or (soon) from Discord, and see when enough of your group overlaps.

> **Status:** early development. Not hosted publicly yet. Expect things to change.

## What works today

- Log in with Discord
- Create groups, invite friends with a link, join several groups
- Mark each of the next 7 evenings as Yes / Maybe / No with a start time (and optional end)
- See your group's week: who's in, and the earliest time enough people overlap
- Choose per group whether it sees your availability; hidden and unanswered look the same to others
- Correct across time zones, daylight saving changes and sessions past midnight

## Planned

Discord commands and a live availability board, weekly defaults, reminders, characters and levels, and later a WoW addon. See [docs/prd.md](docs/prd.md) for the full plan.

## Tech

Astro (server-rendered) running as one Cloudflare Worker, with Cloudflare D1 as the database. One deploy covers the website, the Discord endpoint and background jobs, and it fits in Cloudflare's free tier. Details in [docs/architecture.md](docs/architecture.md).

| Path | What |
| --- | --- |
| `apps/web` | The Worker: website, Discord interactions endpoint, minute cron |
| `packages/domain` | Business rules: time zones, availability, best start time, sharing (pure TypeScript) |
| `packages/db` | Drizzle schema and D1 migrations |
| `docs/` | Product brief, requirements, architecture, distribution |

## Running it locally

Needs Node 24 and pnpm 9. No Cloudflare or Discord account needed.

```bash
pnpm install
```

```bash
pnpm db:migrate:local
```

```bash
pnpm dev
```

Then open <http://localhost:4321/auth/dev?name=Alice> to log in as a fake user (this route only exists in `pnpm dev`). Use a second browser profile with `?name=Bob` to try a group with two people.

To test real Discord login, create an app in the [Discord developer portal](https://discord.com/developers/applications), add `http://localhost:4321/auth/discord/callback` as a redirect, set `DISCORD_CLIENT_ID` in `apps/web/wrangler.jsonc`, and copy `apps/web/.dev.vars.example` to `apps/web/.dev.vars` with your secrets.

Checks (the same ones CI runs):

```bash
pnpm typecheck
```

```bash
pnpm test
```

## Deploying your own copy

You need a Cloudflare account (free plan is fine) and a Discord application.

1. From `apps/web`: `npx wrangler d1 create party-planner`, and put the printed id in `wrangler.jsonc`.
2. Set `DISCORD_CLIENT_ID` and `PUBLIC_BASE_URL` in `wrangler.jsonc`.
3. Set secrets: `npx wrangler secret put DISCORD_CLIENT_SECRET` (and `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`).
4. `pnpm db:migrate:remote`, then `pnpm deploy`.
5. In the Discord portal, add `<PUBLIC_BASE_URL>/auth/discord/callback` as an OAuth redirect and set the Interactions Endpoint URL to `<PUBLIC_BASE_URL>/api/discord/interactions`.

**Never commit secrets.** They belong in `wrangler secret` (production) or `apps/web/.dev.vars` (local, ignored by git). Client IDs, the Discord public key and D1 database IDs aren't secret.

## Contributing

Issues and pull requests are welcome. Please run `pnpm typecheck` and `pnpm test` before opening a PR, and keep changes small and focused. For anything bigger, open an issue first so we can agree on the approach.

## Security

Please report vulnerabilities privately, not in public issues. See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). World of Warcraft is a trademark of Blizzard Entertainment; this project isn't affiliated with or endorsed by Blizzard or Discord.
