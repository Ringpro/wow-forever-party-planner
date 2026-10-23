# WoW Party Planner — Product Brief

> **Working title:** DadCraft / Party Planner (not final)
>
> **Product promise:** Less time planning. More time playing together.
>
> **Status:** Product concept and initial technical direction. Assumptions should be verified before coding.

## 1. Context and problem

The initial users are six friends who are dads with families and limited, unpredictable gaming time. They want to keep playing World of Warcraft together long-term, but scheduling sessions and keeping characters at similar levels is difficult.

Their playing style is **a mix of planned sessions and spontaneous opportunities**. The target game is referred to by the founders as **"WoW Forever."** Before implementing game integrations, confirm precisely which WoW version/server/client this means and which addon APIs, external APIs, and terms apply. Do not assume that Retail/Classic API support automatically applies.

The product should also work beyond one friend group. The founder has coworkers who play and wants to find compatible players across different social circles without forcing everyone into the same guild or Discord server.

**Core problem:** People spend scarce gaming time coordinating availability, finding compatible players, and figuring out what game content they can do together.

**Core goal:** Make planning nearly frictionless so people can spend their limited time playing.

## 2. Product vision

Create **one shared platform with three optional entry points**:

1. **Website:** Register, manage identity and characters, create/join groups, see schedules, compare progress, and find people to play with.
2. **Discord app/bot:** Quickly publish or change availability, view upcoming sessions, get alerts, and coordinate in the place people already chat.
3. **WoW addon:** Read the local character's level and quest progress, show friends'/guildmates' progress when legitimately shared and technically available, and help players identify content they can do together.

Users **do not need all three**. Each should provide standalone value; connecting more of them should make the experience better. All three share the same backend data model and identity mapping where possible.

**The website is also where people get the other two:** an "Add to Discord" install flow for the Discord app and a download for the WoW addon. See [distribution.md](distribution.md).

The platform must be **multi-group by design**: the same person can belong to The Dads, Work Guild, a dungeon group, etc. A character belongs to a person/account and can be selectively shared across multiple groups.

## 3. Product principles

- **Minimal friction:** A few taps, not recurring forms or manual data entry.
- **Discord-first for frequent actions:** Users should not have to remember to open a website every day.
- **Website-first for overview:** Richer calendars, group administration, character profiles, and discovery work well on the web.
- **Optional integrations:** No required addon or desktop companion for basic scheduling.
- **Privacy by default:** Separate private schedules, group visibility, and opt-in discovery.
- **Honest freshness:** Show when each character/progress record was last updated and from which source.
- **Mobile-friendly:** Parents will often update schedules from a phone.
- **Asynchronous by nature:** Scheduling should still work even when nobody is online at the same time.
- **Multi-group from day one:** Avoid a single-group schema that must be rewritten later.

## 4. Key entities and relationships

### Users and identities
- **User:** Account, display name, timezone, preferences, notification settings, privacy settings.
- **Linked identities:** Discord user ID, Blizzard identity where supported/authorized, addon/character identifiers, potentially multiple game accounts.
- **Friend relationships:** Direct person-to-person connections, distinct from membership in a group.

### Groups and guilds
- **Group:** A social/scheduling community with name, admins, invite link, privacy/discoverability settings, and members.
- **Group membership:** Roles/permissions, notification preferences, visibility options.
- **In-game guild:** Separate entity that may optionally link to a group. One group can span guilds; one guild can contain several separate scheduling groups.

### Characters
- **Character:** Owner, game version/ruleset, realm/server, faction where relevant, name, class, role(s), current level, zone, and update source/timestamp.
- A user can own multiple characters, and choose which character(s) to expose in each group.
- **Progress snapshot:** Local addon data or verified API data, such as level, active quest IDs, completed quests, and relevant quest-chain metadata, subject to actual client capabilities.

### Availability and sessions
- **Availability:** User, local date, time window or expected start time, status (`yes`, `maybe`, `no`), recurrence/weekly defaults, exception overrides, shared groups, updated timestamp.
- **Session:** Optional planned event (e.g. dungeon night), time, participants, desired activity, group, RSVP state.
- **Spontaneous status:** "Free right now" with expiration; delay updates (e.g. +30 min).

### Discovery
- **Match:** Players with overlapping time windows, compatible game version/server/faction when relevant, appropriate levels and roles, matching activity interests, and permitted visibility.

## 5. Website experience

The website is the **home base** for overview, registration and management.

### Required features
1. Login/signup, ideally with Discord OAuth as a low-friction option.
2. Create or join multiple groups via invite links.
3. Weekly calendar showing who is available on which dates and their expected start times.
4. One-tap `Yes / Maybe / No` and optional time entry.
5. Weekly recurring patterns that can be copied forward and overridden for specific dates.
6. Group switcher and optionally a unified "my schedule" view across selected groups.
7. Character registration: name, game version, realm, faction if applicable, class, role, level; support manual entry initially.
8. Character overview for a group: levels, roles, approximate level spread, outliers, last-updated times.
9. Privacy choices for sharing schedule and character data with specific groups.
10. **Get the tools** page (`/get`): "Add to Discord" buttons (server install and user install) and, once it exists, the WoW addon download with version, checksum and install instructions. See [distribution.md](distribution.md).

### Later features
- Friend management and player discovery across groups.
- Activity matching for dungeons, questing, PvP, leveling.
- Quest-compatibility dashboard.
- Opt-in recommendation engine: "Who can play Thursday?" and "What should this party do together?"
- Cross-group invitations to a session without leaking private membership or calendars.

### Example group dashboard
A user can switch between **The Dads** and **Work Guild**. Each shows scheduled sessions, available players, character levels, and expected start times. The user can change availability once and share that entry to selected groups.

## 6. Discord app/bot experience

Discord is the **quick-interaction surface**, not a separate database.

### Essential actions
| Action | Possible interaction |
| --- | --- |
| Plan my week | Interactive weekly board with day selection and Yes/Maybe/No |
| Add start time | Time picker/presets (`20:00`, `20:30`, `21:00`, custom) |
| Change plans | Edit an earlier response in a few taps |
| Free right now | `/play now` or a persistent button |
| Running late | `/delay 30` |
| Who's on tonight? | `/who` or a persistent group overview |
| Find teammates | `/lfg dungeon` (later phase) |
| Levels/progress | `/party levels` and links to the website |

### Scheduling UX
- Show one persistent or regularly refreshed seven-day availability board per participating Discord group/channel.
- Make updating availability from mobile easy.
- Show availability counts and the earliest realistic common start time based on overlapping windows, not just the earliest individual's start time.
- Differentiate planned session RSVP from general availability.
- Support multiple groups and clearly disclose which groups an update will be shared with.
- Avoid excessive notifications; make digest/reminder settings opt-in or configurable.
- Gracefully support users who have not connected Discord (they can use the website).

### Example behavior
A user says they can play Wednesday at 20:30. They later hit "Kids aren't sleeping, +30 min." Everyone in the appropriate group sees the revised start time. On Thursday, they click "Free right now" and compatible friends can opt in to notifications.

## 7. WoW addon experience

The addon is the **in-game progress and party-compatibility surface**.

### Desired character data
- Character name, realm/server, version/ruleset, class, level, role/spec when reliably available.
- Current zone.
- Active quest identifiers and status when exposed by the game client.
- Completed quest history or checks when exposed by the game client.
- Freshness/source metadata.

### Desired player experience
- See your own progress automatically.
- See the progress of participating friends and guildmates **only when data is actually accessible and shared with appropriate permissions**.
- Compare several selected characters to find overlapping quest content.
- Identify which quests are shared, which members need prerequisites, and who already completed certain content.
- Identify a catch-up opportunity or an appropriate dungeon/zone for the group.
- Function locally even if website synchronization is absent.

### Important feasibility boundaries
Do **not** assume a WoW addon can make arbitrary external HTTP requests. In ordinary WoW addon environments, direct web synchronization is restricted. Verify specifics for the target client.

Possible data paths to evaluate:
1. **Addon-to-addon communication:** Exchange compatible data through game-provided addon message channels when available. Depends on client restrictions, online peers, and messaging rules.
2. **Blizzard or server API:** Pull public/authorized character or guild data via backend when the target game version actually supports it. Detailed quest progress may not be available.
3. **Optional desktop companion:** Read addon SavedVariables after they have been written by the game and sync with permission. This introduces an extra install and requires careful security, privacy and reliability design.
4. **Manual fallback:** Enter or update level on the website or with `/level 42` in Discord.

**Critical validation:** Confirm exact target game/version/server and its addon interface, addon communication restrictions, rules for data extraction, character identity mapping, quest API coverage and legal/terms constraints before committing to a sync architecture.

An addon cannot be assumed to inspect the complete quest history of arbitrary guild members. Shared progress generally requires participating clients and consent or some other supported data source.

### Quest matching details
Quest compatibility is more nuanced than matching quest IDs. Consider prerequisites, completion state, level requirements, faction, server, phase/ruleset, and whether the content can be completed together. Start with simple overlap reports before promising definitive "you can all do this" recommendations.

## 8. Multiple groups and player matching

Multi-group functionality is a core requirement, not an expansion feature.

### Examples
- **The Dads:** Original group of six friends.
- **Work Guild:** Coworkers who also play.
- **Dungeon group:** Temporary or long-term group focused on specific content.

A user can share their Thursday 20:30–22:30 availability with both The Dads and Work Guild, or just one of them. If only one friend is free, the system could optionally surface two available coworkers who have compatible characters.

### Privacy expectations
- Membership in a private group must not be exposed to another group without permission.
- A person's entire schedule should not become public merely because they joined one discoverable group.
- Character and quest data visibility must be configurable.
- Matchmaking should use privacy-safe summaries: "3 compatible players available," with identity revealed only as permitted.
- Avoid publicly disclosing calendar conflicts, family details, or other group conversations.

### Matching factors (later)
Time overlap; game version/ruleset; realm and faction if relevant; level range; class/role; quest stage; activity preferences; friend/group proximity; language/timezone preferences.

## 9. Suggested implementation architecture

> **Update 2026-10-23:** the chosen stack is Astro + Cloudflare Workers + D1, not Next.js + Supabase. See [architecture.md](architecture.md) §3.

**Initial direction, not a fixed requirement:**

- **Web:** Next.js, responsive/mobile-first.
- **Backend/database:** PostgreSQL, potentially Supabase (auth, database, row-level security, scheduled jobs).
- **Discord:** Application commands, components/interactions, bot service and scheduled message updates.
- **Addon:** Lua and game-provided UI/API calls for the actual client.
- **Sync:** Server-side game API where supported; optional later companion app if necessary.
- **Distribution:** Discord install links generated server-side; addon zips built by CI from tagged releases and served from our own storage, mirrored to CurseForge/Wago. See [distribution.md](distribution.md).

### Architectural rules
- One backend API and shared source of truth for account, groups, schedules, and authorized synced progress.
- Discord and website changes update the same availability records.
- Handle multiple user timezones and daylight-saving-time transitions; store timestamps in UTC plus meaningful local scheduling context.
- Store game version/ruleset as a first-class attribute to avoid mixing incompatible characters.
- Store `source` and `observed_at` timestamps on character and progress records.
- Have distinct concepts for **availability**, **RSVP**, and **currently online/free**.
- Use explicit permissions and group-scoped access controls; prevent cross-group data leakage.
- Use idempotent sync operations and resilient Discord interaction handling.
- Design for low-cost hosting and a small initial group, while keeping multi-group support.

## 10. Development phases

### Phase 1 — Scheduling MVP (highest priority)
Build a complete useful product without depending on any WoW integration.

**Scope:**
- Website registration and login (Discord login preferred when feasible).
- Create/join multiple private groups.
- Per-day Yes/Maybe/No availability with start times or time windows.
- Repeating weekly defaults plus exceptions.
- Group weekly overview and availability counts.
- Discord bot/app with quick schedule viewing and updating.
- Website/Discord sync.
- Timezone awareness, privacy, sensible reminders.
- `/get` page with "Add to Discord" (server and user install) and group→channel linking in onboarding.

**Success criterion:** The original six dads can plan their next week, update plans in seconds, and see when they overlap, without chasing each other in chat.

### Phase 2 — Characters and social discovery
- Manual registration and updating of characters.
- Group character overview, class/role/level and freshness.
- Friends and cross-group opt-in discovery.
- Match suggestions based on schedule overlaps, game version and role/level compatibility.
- Cross-group session invitations.

**Success criterion:** Someone with spare time can find a compatible player among both friends and coworkers, with privacy intact.

### Phase 3 — WoW addon and progress
- Confirm target client and addon feasibility.
- Local character and quest tracking.
- In-game display of shared progress for participating players.
- Quest overlap/catch-up views.
- Evaluate sync approaches, implement safe supported integration.
- Web progress view with last-updated timestamps.
- Addon download on `/get`: versioned zip, checksum, per-client install instructions, CurseForge/Wago links.

**Success criterion:** Users no longer need to update levels manually where automation works, and can identify useful content to play together.

### Phase 4 — Intelligent session recommendations (optional)
- Recommend quests/dungeons/zones based on who is free, roles, levels and progress.
- Low-noise "free now" matching and configurable alerts.
- More advanced planning and compatibility analysis.

## 11. MVP user stories

1. As a busy parent, I can mark Wednesday "Maybe from 20:30" in under ten seconds from my phone.
2. As a group member, I can see which evenings have enough players for a session.
3. As a member of two groups, I can share one availability update with selected groups without entering it twice.
4. As someone running late, I can shift my expected start time by 30 minutes in Discord.
5. As a group admin, I can invite friends without asking everyone to install a WoW addon.
6. As a privacy-conscious user, I can hide availability from my work group while still sharing it with my close friends.
7. As a player, I can register a character manually even if game API sync is unsupported.
8. As an addon user, I can inspect my own quest/level status without requiring a website account or external helper.
9. As a player with unexpected free time, I can quickly discover permitted contacts who might want to play.
10. As a new user, I can get the Discord app and (later) the WoW addon from one page on the website, with clear instructions and without needing server admin rights for the Discord app.

## 12. Non-goals and scope control

Do not build all the aspirational features before proving scheduling is useful.

**Not essential for the first release:** Automated quest sync; desktop companion; full guild import; sophisticated quest-prerequisite engine; public matchmaking marketplace; voice chat; native mobile app; advanced analytics.

Avoid making the product dependent on a single third-party game API or a single Discord server.

## 13. Outstanding product and technical questions

Proposed answers are in [prd.md](prd.md) §3.

1. **Exact game client:** What does "WoW Forever" refer to in practice, and what addon APIs are available there? (This also decides the addon's install folder and distribution channels.)
2. **Game constraints:** Are players all on one server/ruleset/faction or might these vary?
3. **Time entry:** Do users need start time only, or start and end windows?
4. **Recurring availability:** Should last week's schedule automatically carry over, or only explicit weekly defaults?
5. **Visibility model:** Is availability private by default and selectively shared to groups?
6. **Discord model:** One bot instance across servers, or a DM-based universal planner with server-specific boards? *(Proposed: one app with both server install and user install. See [distribution.md](distribution.md).)*
7. **Character identity:** How do we validate ownership and prevent impersonation?
8. **Addon data sharing:** What game-supported communications work in the target environment, and what consent UI is needed?
9. **Discoverability:** Should coworkers and other groups be accessible only through direct invitations initially?
10. **Notifications:** Which reminder and "free now" events are useful without becoming spam?
11. **Addon channels:** Website download only, or also CurseForge/Wago for automatic updates?

## 14. Suggested next deliverables

1. A concise PRD dividing **must-have MVP**, **next**, and **later** features.
2. A proposed system architecture with clear trust boundaries and integration assumptions.
3. A PostgreSQL schema supporting multi-group membership, selective visibility, availability, sessions, characters, and update provenance.
4. Discord command/component interaction flows for scheduling on mobile.
5. Wireframe-level descriptions of website screens: onboarding, group dashboard, weekly schedule, profile/characters, discovery, get-the-tools.
6. A separate WoW addon feasibility spike/checklist for the **actual target client**, emphasizing proof-of-concept before committing to automated synchronization.
7. An incremental implementation plan with milestones, tests, and low-maintenance deployment choices.

**Decision guidance:** Prioritize a real working scheduling MVP with a website and Discord integration. Treat the addon as an independently useful third interface and validate its technical constraints before connecting it to the wider platform. Keep all data models multi-group from day one.
