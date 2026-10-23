# Getting the Discord app and WoW addon from the website

**Requirement:** People can get both the Discord app and the WoW addon from the website, so it stays the one place to go to "get set up". Both stay optional (brief §2, §3).

The two work very differently. A Discord app is not downloaded. It is *installed* through a Discord authorization link. A WoW addon *is* a file people download. So the website has one **Get the tools** page (`/get`) with two different flows on it.

---

## 1. Discord app: "Add to Discord" (Phase 1)

### How it works
Discord apps live on Discord's servers and ours. Users add them by opening an OAuth2 install link. The website just shows that link as buttons:

| Button | Install context | Who uses it | What it gives |
| --- | --- | --- | --- |
| **Add to my server** | Guild install (`integration_type=0`, scopes `bot applications.commands`) | Group admin with Manage Server on that server | Persistent 7-day availability board in a channel, `/who`, reminders posted in the channel |
| **Add to my account** | User install (`integration_type=1`, scope `applications.commands`) | Any user, no admin rights needed | `/play now`, `/delay 30`, `/avail` in any server, DM or group DM, even where the bot isn't installed |

User install matters for this audience. A dad in a coworkers' server where nobody will add a bot can still update availability with a quick slash command. The guild install is only needed for the shared board.

### Website behavior
- `/get` shows both buttons, a short "what each one does" line, and the list of bot permissions with the reason for each.
- After someone **creates a group**, onboarding offers "Connect this group to a Discord channel" → server install → channel picker → links `group ↔ discord_guild_id + channel_id`.
- If the user logged in with Discord OAuth, their Discord identity is already linked. Nothing more to do.
- If they logged in another way, the first slash command they use replies with an ephemeral "Link your account" button (a one-time, short-lived token in the URL, never personal data).
- Show install status: "Installed in *The Dads* server · board in #wow-nights", with a "Remove" help link (users remove apps in Discord itself).

### Permissions (keep minimal)
`View Channels`, `Send Messages`, `Embed Links`, `Use Application Commands`. The bot can edit its own board message without extra permissions. Don't ask for `Administrator`, `Manage Messages` or message-content intent. All input comes from interactions.

### Implementation notes
- Build the install URL on the server from config (`DISCORD_CLIENT_ID`, permissions integer). Don't hard-code it in the client bundle more than once.
- Handle the `APPLICATION_AUTHORIZED` webhook event (or the OAuth redirect with `guild_id`) to record guild installs and deauthorizations idempotently.
- One bot instance serves every server. Open question 6 in the brief can be settled as "one app, both install types".

---

## 2. WoW addon: "Download addon" (Phase 3)

### How it works
An addon is a folder of `.toc` / `.lua` / `.xml` files. Users extract it into the game's `Interface/AddOns` folder. There is no executable, which keeps distribution low-risk.

### Website behavior
- `/get` shows **Download addon** with: version, supported client(s) and Interface number, release date, file size, SHA-256 checksum, and short release notes.
- Install instructions for each client, with screenshots: extract the zip to
  `World of Warcraft/<client folder>/Interface/AddOns/`
  The `<client folder>` (`_retail_`, `_classic_`, `_classic_era_`, …) depends on what "WoW Forever" turns out to be. **Confirm the target client first** (brief §13 Q1). If it's an unofficial/private server, the folder layout, Interface version and distribution conventions may all be different.
- Common pitfalls: a nested folder after unzipping (`AddOns/PartyPlanner-1.2.0/PartyPlanner/`), "Load out of date AddOns", and restarting the game vs `/reload`.
- Also link the same release on **CurseForge and/or Wago**. A zip from the website never updates itself. Most players already use an addon manager, and these sites handle updates for them. The website download is the zero-account fallback.

### Packaging and trust
- CI builds the zip from a tagged release (e.g. the BigWigs packager or a small script). The same artifact goes to the website, CurseForge and Wago, so the checksums match everywhere.
- Serve from our own domain/storage over HTTPS. Don't link to unofficial mirrors.
- Follow Blizzard's UI Add-On Development Policy (official clients): free of charge, code not obfuscated, no paid features locked in the addon.
- The addon can't fetch updates over HTTP. It can still say "a newer version exists" by comparing version strings with other participating players over addon messages (common pattern, no web access needed).

### Account linking (optional, later)
Downloading the addon never requires a website account (user story 8). Linking a character to an account belongs with the identity/impersonation question (brief §13 Q7) and the sync spike. Don't build it into the download flow.

---

## 3. Later: desktop companion
If the sync spike picks the optional desktop companion (brief §7, path 3), it would be the first real executable. That brings in code signing (Windows Authenticode / macOS notarization), auto-update and much stricter release hygiene. Keep it out of `/get` until that decision is made.

---

## 4. Where this lands in the phases

| Phase | `/get` page contents |
| --- | --- |
| 1 — Scheduling MVP | "Add to my server" + "Add to my account" buttons, permission list, group→channel linking in onboarding |
| 2 — Characters | No change (manual character entry on the website / `/level` in Discord) |
| 3 — Addon | Addon download, checksum, per-client instructions, CurseForge/Wago links |
| Later | Desktop companion only if the sync spike picks it |

## 5. Acceptance checks
- A new user can go from the website to running `/play now` in Discord in under a minute, without being a server admin (user install).
- A group admin can connect a group to a channel and see the board post, with no permissions beyond those listed above.
- Uninstalling from Discord is reflected on the website (install status, board no longer updated) without errors.
- The downloaded addon zip extracts to the right folder structure on the confirmed client, and its checksum matches the CurseForge/Wago release.
- No step on `/get` requires the addon or the Discord app to use the website's scheduling.
