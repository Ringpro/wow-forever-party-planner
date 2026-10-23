# WoW addon: feasibility notes

> Brief §7 and §13 Q1/Q8. Status 2026-10-23. Facts below come from public sources found today; **re-check them in-game at launch**.

## What "WoW Forever" is

**World of Warcraft: Forever** is Blizzard's official third permanent version of WoW, next to retail and Classic. It goes back to the original continents with a level cap of 60, adds new zones, quests and dungeons, and is included in a normal WoW subscription. Global launch is **4 November 2026**. The beta (installed as `_classic_beta_`, product `wow_classic_beta`, last build 1.60.1.70532) **ended on 23 October 2026**, so the next chance to test in-game is launch day.

Sources: [Warcraft Wiki: Patch 1.60.1](https://warcraft.wiki.gg/wiki/Patch_1.60.1), [Patch 1.60.1 API changes](https://warcraft.wiki.gg/wiki/Patch_1.60.1/API_changes), [TechSpot](https://www.techspot.com/news/113832-world-warcraft-forever-launches-november-4-new-race.html), [Blizzard Watch](https://blizzardwatch.com/category/warcraft/wow-forever/).

## Technical facts for the addon

| Topic | What we know | Confidence |
| --- | --- | --- |
| API family | Forever uses the **modern (Mainline) code base**, shared with retail 12.x, not the Classic Era API. So `C_QuestLog.*`, `C_ChatInfo.*`, `C_Timer` etc. are the modern versions. | Wiki, API changes page |
| TOC interface | `## Interface: 16001` | Confirmed in the beta client (other addons use it too); **re-check at launch** |
| Game type | TOC game type `forever` (alias of `camelot`). `## AllowLoadGameType: forever` limits an addon to Forever; `_Forever.toc` suffix works for multi-client packages. Lua detection: `WOW_PROJECT_ID == WOW_PROJECT_CAMELOT` (18). | Wiki |
| Install folder | Beta: `World of Warcraft/_classic_beta_/Interface/AddOns/`. Live: not known yet. | Beta confirmed |
| Restrictions | Retail's "addon disarmament" rules (secret values in combat and encounters) are active. Trial accounts can't send addon messages. | Wiki |
| Quest data | Own quest log via `C_QuestLog.GetNumQuestLogEntries` / `GetInfo` / `IsComplete`; completion via `C_QuestLog.IsQuestFlaggedCompleted(questID)` | Standard modern API; **verify** |
| Addon messages | `C_ChatInfo.RegisterAddonMessagePrefix` + `SendAddonMessage` over PARTY / RAID / INSTANCE_CHAT / GUILD / WHISPER, ~255 bytes per message, throttled | Standard modern API; **verify behaviour in instances and combat** |

## Data paths (brief §7)

| Path | Verdict for now |
| --- | --- |
| 1. Addon-to-addon messages | **Feasible and the starting point.** Players in the same party/raid (or guild) who run the addon exchange level and active quest IDs. Only works while they're online and grouped. |
| 2. Blizzard Web API | **Unknown.** Check after launch whether the Battle.net profile API has a Forever namespace. Even then, it won't have detailed quest progress. |
| 3. Desktop companion reading SavedVariables | **Later, if ever.** Extra install and security work; only consider once the addon is useful on its own. |
| 4. Manual (website / `/level` in Discord) | Planned for Phase 2 regardless. |

The addon **can't make web requests**, so it can't sync with the website by itself. It's useful on its own first.

## Addon v0.1 (in `addon/PartyPlanner`)

- **Local snapshot** of your character: name, realm, class, race, faction, level, zone, active quests (ID, title, level, done), with time and source. Saved per character in SavedVariables.
- **Party sharing:** when you're in a group, the addon sends your level, class and active quest IDs to party members who also run it, and builds a list of theirs.
- `/pp`: your status and who in your group runs the addon. `/pp shared`: quests you share with each of them, and quests they have that you don't. `/pp share on|off`: stop sending your data.
- No UI frames yet, no website sync, no guild-wide sharing.

### Privacy and rules
- Sharing goes only to your current party or raid, people who already see your level and location. It can be turned off.
- Follows Blizzard's UI Add-On Development Policy: free, readable code, no automation of gameplay.

## In-game checklist (launch day, 4 November)

1. At launch: find the live install folder and `## Interface` number; update the TOC.
2. Load the addon, check for Lua errors (`/console scriptErrors 1`).
3. `/pp` shows the right level, zone and quests; check quest IDs match Wowhead's Forever pages.
4. Two players in a party: `/pp shared` lists the right overlap. Try in the open world, in a dungeon, and during combat.
5. Check that `SendAddonMessage` returns success and isn't silently blocked in instances.
6. Check `C_QuestLog.IsQuestFlaggedCompleted` for completed quests (needed for "who already did this").
7. Check the Battle.net API for a Forever profile namespace (data path 2).
8. Note anything that differs from this page and update it.

## Later
- A small UI frame instead of chat output.
- "Who already completed this?" using completion checks over a shared list of quest IDs.
- Guild-wide sharing (opt-in).
- Packaging and publishing (CurseForge/Wago + the website's Get the tools page), see [distribution.md](distribution.md).
