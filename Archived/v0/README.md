# TEMPEST

A locally hosted world manager for TTRPG universes. It tracks how a world changes, builds it out, and displays it. Its look and vocabulary come from a hot-swappable **theme library**, so the tool matches whatever game is running.

## Install (Windows)

These commands need Node 20 or newer. Nothing needs admin rights, and everything is per-user.

```bash
npm run setup
```

This adds **TEMPEST** and **Quit TEMPEST** to the Start Menu. Launching TEMPEST starts the server in the background if it isn't already running, adds the **tray icon**, then opens a chromeless app window (Edge or Chrome, falling back to the default browser). Closing the window leaves the server running, so reopening is instant.

**Tray icon** (notification area, next to the clock). Right-click it for:

| Item | What it does |
|---|---|
| Show GM window | Brings an open GM window to the front, or opens one. Double-clicking the icon does the same. |
| Open player screen ▸ | Lists your universes; each opens a player screen in Station or Full-screen layout |
| Restart server | Stops and restarts the server; open windows reconnect on their own. Shows *Start server* when it's stopped. |
| Start with Windows | Toggles sign-in autostart (server + tray, no window) |
| Quit TEMPEST | Stops the server, closes TEMPEST's windows and removes the icon. The Start Menu shortcut does the same. |

If another TEMPEST server holds the port but uses a different data folder (for example a sandboxed copy started by another tool), the launcher replaces it instead of reusing it. `/api/health` reports each server's `dataDir` for this check.

The tray finds TEMPEST windows by their titles: `TEMPEST` / `TEMPEST · <universe>` for GM windows, and `… · Player Screen` for player screens. The tray is a hidden PowerShell script (`launcher/tray.ps1`, started through `launcher/tray.wsf`), and only one runs at a time.
- **Responsiveness:** nothing on its menu thread waits. A background worker polls the server every few seconds, and the menu draws from those results. Restart, Quit and the autostart toggle run in the background and report back with a balloon.
- **Diagnostics:** this prints how long the menu takes to open, along with what the worker sees:

```bash
powershell -STA -File launcher/tray.ps1 -Root . -Node node -SelfTest
```

Command-line equivalents:

```bash
npm run restart
```

```bash
npm run quit
```

For a server-only stop that leaves the tray running, use `npm run stop`.

**Start with Windows:** turn it on under *System* in the app, or at install time:

```bash
npm run setup:autostart
```

```bash
node launcher/install.js --autostart=window
```

The first mode starts only the server at sign-in. The second also opens the window.

To remove all shortcuts:

```bash
npm run uninstall-shortcuts
```

Notes:
- The shortcuts store the folder path and the `node.exe` path, so re-run `npm run setup` if either one moves.
- Logs go to `%LOCALAPPDATA%\TEMPEST\logs\server.log`.
- The server binds to 127.0.0.1 only. Requests that change anything must come from TEMPEST's own pages, with the host, origin and content type all checked.

## Run (development)

```bash
npm start
```

Then open http://127.0.0.1:4077. Set the `TEMPEST_PORT` environment variable to use a different port.

## Layout

```
server/index.js              Local host: static files, /api/themes, /api/health, /api/system/* (no dependencies)
launcher/                    Windows launcher (tempest.js), tray icon (tray.ps1 + tray.wsf), hidden runner (hidden.wsf), shortcut installer
scripts/make-icon.js         Generates assets/tempest.ico from vector shapes
src/theme-engine/            ThemeEngine: load, hot-swap, persist, lexicon
themes/_base/tokens.css      The theme contract: every --tp-* token, with neutral defaults
themes/_base/components.css  Theme-agnostic components (read tokens only)
themes/<id>/theme.json       Manifest: name, palette, fonts, lexicon
themes/<id>/theme.css        Token overrides + theme-only flavour, scoped to :root[data-theme="<id>"]
styleguide/                  Living style guide + theme switcher (Ctrl+Alt+T cycles)
```

## The app

Launching TEMPEST opens the app at `/`. The style guide has moved to `/styleguide/`.

- **Universes:** pick one or create one (name, game system, summary, theme, calendar). Opening a universe switches to its theme. Changing the theme while a universe is open saves it to that universe.
- **Top bar:** the current era and the world clock (+1h, +1d, or any duration such as `3h 30m` or `2y`), the theme and effects pickers, and the **Player screen** control. That control shows what's on screen and has Open, Full, Message and Clear.
- **Sidebar:** Universe, Time-Line, then every level in reading order with counts, named in the theme's vocabulary. Campaigns and Sessions sit under *Play*; Items and custom types under *Extras*.
- **Quick Search** (**Ctrl+K**, or the Search button in the top bar): jump to any entity, screamsheet or page in the open universe.
  - Names rank as you type: exact, then prefix, word start, initials (`knm` → Kabuki Night Market), substring, then scattered letters. Matching letters are highlighted. Pages (Overview, Time-Line, Screamsheet Generator, Settings, each level's list) are included too.
  - A moment later, a full-text search adds entities whose *contents* match, marked "Matches text".
  - With nothing typed, it lists your recently opened entities (kept per universe in this window).
  - **↑ ↓** move, **Enter** opens, **Ctrl+Enter** pushes the entity to the player screen, **Esc** closes.
- **Universe overview:** the premise, the eras strip, the **Atlas** (containment tree: System › World › Nation › Region › Community › Place), scheduled and recent changes, and counts.
- **Entity pages:** a searchable list and a detail panel.
  - The detail panel shows **breadcrumbs** (where the entity sits), its fields (secret ones are marked), what it **Contains**, its relationships (add/remove, with control shares as meters), what it's **Linked from** (members, followers, residents, owners…), and full history with diffs and per-change undo.
  - **Editing:** the editor is generated from the type's fields. It covers visibility (GM only / Rumoured / Known), a per-field secret toggle, custom fields, a change note, *Log as event*, and *When*: pick an earlier time to backdate or a later one to schedule. Relationships name themselves if you leave the name blank.
- **Time-Line:** every change grouped by era, then in-game day, with undo/redo. Scheduled entries are flagged.
- **Settings:** universe details, the current session (every change is stamped with it), the calendar, and custom entity types.
- **Player screen** (`#/u/<universe>/screen`): a bridge-console view for players, opened in its own window from the top bar. Every request it makes uses `view=player`, so the server strips every secret.
  - **Layouts** are chosen per window. **Station** (`/screen`) has a title bar, ambient side rails (clock, era, incidents, contacts, groups) and a central viewport for pushed views. **Full** (`/screen/full`) lets pushes take the whole screen and shows the ambient dashboard when idle. The STN/FULL tag in the corner switches between them.
  - **Pushing** from the GM window: **Push** on any entity shows a dossier (image, name, key stats, summary, known links). **Push list** on any list shows a roster of everything players know of that kind. **Push image** under any picture shows it as a handout. **Message** sends an announcement or a flashing alert, and **Clear** returns to the default. Every open player window shows the same push.
  - **Push animations** come from the theme. The player screen marks each push with `data-push-kind` (`entity`, `article`, `roster`, `handout` or `message`) and sets `--push-depth` to how far the view reaches down the viewport.
    - **Cyberpunk RED** (and Neo-Kitsch): pushes glitch in with torn slices, a red/cyan split, jitter and a static burst. Screamsheets print instead, feeding out line by line under a glowing print head.
    - **Moontown**: pushes unfurl like a scroll, tipping forward from a rolled edge behind a parchment roller while golden motes rise. **Shadow Village** uses a dark roller and violet motes.
    - **Land of Sand**: an uplink resolves. A cyan scan beam sweeps across the viewport, and the view resolves behind it through vertical blinds that widen until they close, over a fading holo-grid.
    - **Other themes**, effects set to *Off*, and Windows' reduce-motion setting all fall back to a short fade.
  - **Safety:** pushing a GM-only entity asks to reveal it first (a tracked change you can undo); the server refuses to push hidden entities otherwise. Pushes aren't part of world history.
- **Screamsheet Generator** (sidebar › Play): builds in-world news articles with the five steps from R. Talsorian's free *Screamsheet Generator* DLC for Cyberpunk RED.
  1. **Type of article:** pick one or roll Table A.
  2. **Content:** pick or reroll the intro, body and conclusion.
  3. **Headline:** choose one the conclusion suggests.
  4. **Fill in the details:** each blank suggests matching names from your universe ([Name] → Individuals, [Group] → Groups and factions, [Location] → Places and Communities). Descriptive blanks such as [Location Type] get word choices, and "[members of Group 2]" builds on Group 2's value.
  5. **Polish & publish:** outlet, byline, layout (Broadsheet, CRT terminal or Plain), and optional hand edits.

  The result saves as an **Article** (a "Screamsheet" in Cyberpunk RED's vocabulary) that mentions every entity you used, and **Save & push** sends it to the player screen as a styled newspaper.
  - **Tables are imported, not shipped.** The table text is RTG's copyrighted writing, so TEMPEST reads it from *your* PDF. The first time you open the generator it offers to import from `official_references/`. The tables are stored as a pack in `%LOCALAPPDATA%\TEMPEST\packs\screamsheet`. The import needs Python 3 with `pypdf`, and from a terminal it's `npm run import:screamsheet -- "<path to PDF>"`.
  - Packs are plain JSON in the same shape (article types → six intros, bodies and conclusions, with headline codes), so homebrew tables can be dropped into that folder too.
- **Maps:** Places (Locations), Sessions (Gigs) and Articles (Screamsheets) each hold a labelled list of map images.
  - **Adding:** drop, paste or choose several images at once in the editor. Each map is named after its file, and you can relabel, reorder or remove it.
  - **On the entity's page**, each map has:
    - **Push**, which shows that map full-screen on the player screen at any time.
    - **Reveal/Hide**, which includes it in, or removes it from, what players see of the entity. Revealing is recorded in history and can be undone.
  - **What players see:** the server never sends unrevealed maps to players. Revealed maps appear in the pushed view according to type:
    - **Places:** all revealed maps together, in a full-width section below everything else.
    - **Gigs:** a floor viewer showing the first map, with **▲ Up / ▼ Down** buttons (or the arrow and Page Up/Down keys) and a "2 / 3" counter.
    - **Screamsheets:** the same viewer with ◀ ▶, floated beside the text so the article wraps around it. That suits maps or images of the scene. On narrow screens it sits above the text instead.

    Each player window keeps its own position through live updates, and a fresh push starts on the first map. The GM's "As players see it" preview on a screamsheet uses the same viewer.
  - Maps are a general "gallery" field type, so custom types can have one too.
- **Initiative Tracker** (sidebar › Play; "Combat Ops" in Cyberpunk RED): runs combat. The sidebar link shows the round while a fight is on.
  - **Who fights:**
    - **Player characters** are Individuals with *Player character* ticked. **All PCs** adds every one at once.
    - **Mobs** ("Mooks" in Cyberpunk RED) are a new entity type for reusable stat blocks. Add several at once with **×N**. Each copy gets a number that's never reused in that fight, so "Raider #2" is always the same one. If a second copy joins, the first becomes #1.
    - **Any other Individual** joins on the side their disposition suggests.
    - **One-offs** need only a name, plus optional HP, armor and initiative bonus.
  - **Combat stats:** Individuals and Mobs have Hit points (maximum), Armor, Initiative bonus and Ability slots. Joining a fight copies these stats. Ability slots are written as `4 3 2` (1st–3rd level spell slots) or as named pools such as `Ki 5, Rage 3`. These fields are GM-only on dossiers.
  - **Each row:**
    - **Initiative:** type it in. **▲▼** reorders by hand (ties, readied or delayed turns).
    - **Side:** PC, Ally, Neutral or Enemy.
    - **Hit points:** type an amount and press **Enter** for damage. **Heal** (or typing `+5`) heals. **Temp** sets temporary hit points, which absorb damage first.
    - **Armor**, and **slot pips**: click a full pip to spend it, an empty one to restore it.
    - **Conditions:** the 5e list, or type any name. Add a number of rounds if it should expire on its own.
    - **Hide** keeps a combatant (an ambusher, say) off the player screen. **Down** takes them out of the turn order.
    - Mobs and NPCs go down automatically at 0 HP. PCs stay in at 0 for death saves.
  - **Running it:**
    - **Start combat** rolls d20 + bonus for everyone the GM controls who has no initiative yet, sorts the order and puts it on the player screen.
    - **Next turn** (or **N**) moves the turn on, skipping anyone who is down. Going past the last combatant starts a new round. Timed conditions tick down when their bearer's turn starts. **Back** (or **P**) steps back.
    - Someone joining mid-fight is rolled straight into the order.
    - **End combat** removes the foes and the turn bar. PCs stay with their hit points, slots and conditions until a **Long rest**. **Clear** empties the tracker entirely.
  - **On the player screen** (both layouts), a turn bar appears across the top while combat is on.
    - Whoever is acting is the first, larger card. When the turn passes, everyone slides one place left and the card that just acted leaves on the left and rejoins at the right, round-robin.
    - PCs show exact HP, temporary HP and armor, and their slots on their turn.
    - Everyone else shows only Unhurt, Wounded, Bloodied or Critical.
    - Hidden and defeated combatants never reach the players: the server filters them out.
  - **Attacks:** while combat is on, the **Attack** form under the controls records one combatant attacking another.
    - The attacker defaults to whoever's turn it is, and the target to the first foe on the other side. The last target stays picked for repeated swings.
    - Enter a damage amount, then **Hit** (or press Enter), **Crit** or **Miss**. Damage lands as usual (temporary hit points first), and "Last: …" confirms it.
    - On the player screen, both portraits take over the body for **12 seconds**: the attacker on the left, the target on the right. The attacker lunges and a strike crosses the gap.
    - On a hit, the target reels with a flash and slash marks, the damage number pops, and its health bar drains while a lighter chunk catches up behind it. A crit hits harder, in the accent colour. On a miss, the target sidesteps.
    - Someone taken to 0 gets a **Down** (PC) or **Defeated** stamp. Then the scene fades back to the usual screen.
    - The bar shows exact HP for PCs. For anyone else it shows only a position (to the nearest 5%) and Unhurt/Wounded/Bloodied/Critical.
    - An attack on a hidden combatant isn't shown. A hidden attacker appears as "Unknown attacker".
    - A player window opened mid-attack shows the outcome without replaying it. Effects *Off* drops the shaking.
  - The tracker is table state like the player screen, not world history. It's saved in the universe file, so a fight survives a restart.
- **Images:** every level has an image field (Portrait, Emblem, Flag, Map…). Drop, paste or choose an image in the editor. Large images are scaled to 1600px and converted to WebP before upload. Images are stored inside the universe file, deduplicated by content and checked by their bytes (PNG, JPEG, GIF and WebP only).

Code: `app/main.js` (shell, router, live sync), `app/views/*` (one module per screen; `screen.js` is the player screen), `app/push.js` (pushing to the player screen), `app/palette.js` (Quick Search), `app/initiative-bar.js` (the players' turn bar), `app/attack-scene.js` (the attack scene; the tracker's rules are in `world/encounter.js`), `app/model.js` (breadcrumbs, Atlas, backlinks), `app/ui.js`, `app/api.js`, `app/time.js`.

## World data model

### The levels

A **Universe** (Cyberpunk, D&D, Edge of the Empire…) is the top container and owns one shared **Time-Line**. Everything else is an entity inside it, presented in this order:

| # | Level | Typically sits in | Notes |
|---|---|---|---|
| 1 | Universe | — | The file itself: name, game system, summary, theme, calendar |
| 2 | Time-Line | — | The universe's full history (every change, at an in-game time) |
| 3 | Era | — | A named span of the Time-Line; the current one shows beside the clock |
| 4 | System | System | Solar system, plane of existence… |
| 4b | World | System | Planet, moon, station, realm |
| 5 | Religion | Religion (sects) | Followers are Individuals whose Faith points here |
| 6 | Global Faction | System / World | Members: Nations, Regional Factions, Groups |
| 7 | Nation | World | Capital, leader, government |
| 8 | Regional Faction | Nation / Region / Community | Governments, councils, police |
| 9 | Region | Nation / World / Region | |
| 10 | Community | Region / Nation / World | City, town, district, station |
| 11 | Event | — (placed by *Where* and time) | Batches of changes can be attributed to one |
| 12 | Place | Community / Region / World / Place | |
| 13 | Group | Global / Regional Faction, Group | Gangs, corps, guilds; *Based in* any space |
| 14 | Team | Group / Faction | Crews, squads, the players' party |
| 15 | Relationship | — (From → To) | Direct links of any kind, with a strength |
| 16 | Individual | — | Affiliation, memberships, location, nation, faith |

Play tracking sits beside the levels: **Campaigns** (an era, a party, a status), **Sessions** (which stamp every change made while active) and **Articles** (in-world press such as screamsheets, with outlet, byline, layout, text and mentions). **Mobs** (reusable stat blocks for the Initiative Tracker) sit with the people levels after Individuals. **Items** and custom types are extras.

**Nesting** uses one `parent` field ("Part of", "Located in", "Answers to"…). Each type lists which types it may sit in, so non-neat nesting works: a Community can sit directly on a World, and a Group can answer to a Megacorp. The server refuses loops. **Cross-cutting links** (members, affiliation, faith, citizenship, base, owner) are typed ref fields, and every page lists what links to it.

### Storage and history

Each universe is one SQLite file (`<id>.tempest`) in `%LOCALAPPDATA%\TEMPEST\universes`. Set `TEMPEST_UNIVERSES_DIR` to change the location. The default avoids OneDrive-synced folders, which can corrupt live SQLite files. Storage uses Node's built-in `node:sqlite`, so there's nothing to install. Files from the old `campaigns` folder are moved over automatically, and the first open upgrades them: Location becomes Place, Faction becomes Group and NPC becomes Individual, with history rewritten to match.

```bash
npm run seed
```

```bash
npm test
```

The first command creates the sample "Cyberpunk RED (Sample)" universe, which uses every level from Sol down to individual contacts. The second runs the world-model tests.

- **History is the source of truth.** Every edit is a *change* stamped with an in-game time, a real time and the active session. Changes are grouped into atomic *batches*, and a batch can be attributed to an in-world **Event**. Current state is a projection of history at the world clock.
- **Time:** in-game time is stored as minutes since the start of play. It can be negative, so history can reach back before the campaign begins.
  - **Calendars:** `gregorian` (real dates from an epoch), `years` (for example "1492 DR · Day 34, 14:00", with your own days per year and suffix) or `days` ("Day 3, 14:00").
  - **Eras** always apply, whenever they were recorded, so rewinding the clock still shows the right era.
  - **Time travel:** pass `at` to any read.
  - **Backdating:** a change can be recorded at an earlier time and slots into its correct place in history.
  - **Scheduling:** a batch dated after the clock is *scheduled*. It takes effect when the clock passes it, and un-applies if the clock is rewound.
- **Undo/redo** works per batch. An undone batch stays visible in history, marked as undone.
- **Validation:** field kinds are text, longtext, number, bool, enum, tier, meter, ref, refs, tags and gametime. Ref fields list which types they accept, and required fields (an Era's start; a Relationship's From, To and Kind) can't be left empty. Custom types use the same field kinds, and entities may also hold undeclared custom fields.
- **Visibility:** each entity is `hidden`, `rumored` (players see the name and the `rumor` field only) or `known`. Fields marked `secret` by their type, or listed in an entity's `secretFields`, never reach players. Refs to hidden entities are stripped, and so are relationships that touch them. The server enforces `view=player`; history and the Time-Line are GM-only.

Code: `world/universe.js` (store), `world/types.js` (levels, fields, validation), `world/time.js`, `world/universes.js` (universe library), `server/world-api.js` (routes are listed at the top of that file).

## Theme library

- **Installing a theme** means dropping a folder into `themes/`. The server finds it automatically; you don't register it anywhere. Folders whose names start with `_` are shared infrastructure.
- **Hot-swapping:** `engine.apply(id)` loads the new stylesheet and fonts *before* it flips `data-theme`, so nothing renders unstyled. It then removes the old stylesheet, re-renders lexicon terms, saves the choice, and broadcasts the change to other open TEMPEST windows (for example a player-facing screen).
- **Lexicon:** each theme renames core terms. In Cyberpunk RED, for example, `individual` becomes "Contact", `group` becomes "Gangs & Outfits", `global_faction` becomes "Megacorps & Blocs" and `currency` becomes "Eurobucks". Every level has a singular key and a `.plural` key. Mark text with `data-lex="key"` or call `engine.t('key')`.
- **Authoring a theme:** copy `themes/standard/`, change the `id` in both files, and override any `--tp-*` tokens. Only add component rules for flavour that tokens can't express.
- **Variants:** a theme whose manifest says `"extends": "<parent id>"` loads its parent's stylesheet first and layers its own on top. Its palette and lexicon are merged over the parent's. While a variant is active, `data-theme` stays the parent id and `data-variant` holds the variant id, so variant CSS scopes to `:root[data-theme="<parent>"][data-variant="<id>"]`.
- **Effects level:** `engine.setEffects('off' | 'subtle' | 'full')` sets `data-effects` on `:root`. The level is saved and kept in step across windows. Themes decide what each level means; the default is `subtle`.

### Cyberpunk RED (default)

This theme is based on the Neo-Militarism style from the Cyberpunk 2077 UI art bible ("substance over style").

| Role | Colour |
|---|---|
| HUD / structure / headings | Red `#F75049` |
| Interactive (focus, selection, actionable) | Cyan `#5EF6FF` |
| Backdrop | Darkest Blue `#0E0E17` |
| Tier ladder 1→5 | Grey `#D6D0D0` · Mint `#1DED83` · Steel `#2570D4` · Violet `#9D2BF5` · Gold `#F1B537` |
| Warning | Orange `#FB932E` |

Type: Rajdhani carries the UI, Orbitron is used only for decorative text, and Share Tech Mono covers data. Body text is a pale red tint (`#F3B3AE`), and headings and labels are full red. Signature details include chamfered frames, a corner tick, glitch headlines, segmented meters, bracketed tabs, and hazard-striped alerts. All animation respects `prefers-reduced-motion`.

Effects levels:

| Level | What you get |
|---|---|
| Off | No scanlines, glitch, or boot flicker |
| Subtle (default) | Light scanlines, a single-slice glitch every 12s, boot flicker |
| Full | Heavier scanlines, two-slice glitch every 4s, chromatic aberration on headings, a rolling refresh band |

### Cyberpunk RED · Neo-Kitsch (variant)

This variant extends Cyberpunk RED with the corporate-luxury era from the art bible. It uses holo magenta `#FF3EA5` and gold `#F1B537` on velvet `#120818`, and headings get a magenta-to-gold foil. Shapes are rounded: pill buttons, badges, and tabs, plus glossy solid meters. A sheen sweeps across panels in place of scanlines; at Full the backdrop also slowly shifts hue. Cyan is still the interactive colour, and the lexicon shifts to corporate terms (Associates, Sector, Market Share).

### Moontown (storybook fantasy)

Based on the MOONTOWN Fantasy Game UI portfolio (European storybook illustration, geometric compositions, tactile print textures). Unlike the Cyberpunk themes, it's a **light** theme and sets `color-scheme: light`.

| Role | Colour |
|---|---|
| Ground | Parchment `#EFE3C8`; panels are vellum `#F6EEDC` |
| Headings, frames, primary actions | Rust `#A8432E` |
| Interactive | Dusty Blue `#3F6596` |
| Reading text | Oak Ink `#3D2C20` |
| Tier ladder 1→5 | Fieldstone `#85776A` · Sage `#5E7A45` · Cornflower `#3F6596` · Heather `#7A4C7E` · Ochre `#A67814` |

- **Type:** Cinzel (Roman inscriptional capitals) for headings, labels and buttons, and EB Garamond for reading text, with old-style numerals.
- **Signature details:** double hairline frames with diamond corner ornaments, diamond-bulleted panel titles and selected tabs, cream buttons with an inner hairline (the primary is rust with a cream inner line), rounded tags and the slim stat bars from the character sheet.
- **Effects:** *Subtle* adds print grain. *Full* adds a vignette and riso-style misregistration on headings. *Off* is a clean page.
- **Vocabulary:** Realm, Chronicle, Ages, Planes, Orders & Alliances, Kingdoms, Courts & Councils, Provinces, Towns & Villages, Tidings, Landmarks, Guilds & Bands, Companies, Bonds, Characters, Sagas, Chapters, Notices, Inventory and Gold Crowns.

### Moontown · Shadow Village (variant)

A dark counterpart based on the portfolio's Shadow Village key art. It keeps Moontown's shapes and type on obsidian pages `#1C1920`, with parchment ink `#E4D9C6`, mauve frames `#B087A6` and arcane violet `#9F86FF` for anything interactive. At *Full*, headings take a violet glow instead of the print misregistration.

### Land of Sand (retro sci-fi RTS)

Based on Andrii Shafetov's *Land of Sand* personal UI design, a tribute to early-2000s real-time strategy games. It's a dark theme: gunmetal command panels over a starfield, with a desert planet glowing in the bottom-right corner.

| Role | Colour |
|---|---|
| Ground | Deep Space `#070B12`; panels are gunmetal `#0E1B28` |
| Frames and header bars | Steel Bevel `#6F94AD`, as a brushed gradient |
| Titles, primary actions | Sand Gold `#E8902F`, as an engraved orange-gold gradient |
| Interactive, field labels | Readout Cyan `#46C8FF` |
| Danger, back/cancel | Signal Red `#E0412F` |
| Tier ladder 1→5 | Silver `#A9B8C4` · Oasis Green `#5FD35A` · Argon Blue `#4AA3FF` · Nebula `#B77BFF` · Dune Gold `#F2B443` |

- **Type:** Cinzel for headings, buttons and tabs (the menus' engraved capitals), Exo 2 for the interface and reading text, and Share Tech Mono for figures.
- **Signature details:** bevelled steel frames with cut corners, cyan RTS selection brackets on the panels' square corners (they light up on hover), steel-gradient header bars like the load-game table, recessed dropdown wells, segmented blue bars like the options sliders, and an orange command plate for the primary button.
- **Effects:** *Subtle* adds faint CRT lines and a vignette. *Full* adds a slowly twinkling second star layer and an amber glow on titles. *Off* is a clean starfield. Switching to the theme powers the display on from a bright horizontal line.
- **Vocabulary:** Chronology, Epochs, Planets, Creeds, Great Houses & Guilds, Dominions, Syndicates & Councils, Sectors, Settlements, Field Reports, Sites, Clans & Orders, Squads, Links, Personnel, Sagas, Missions, Dispatches, Equipment and Credits.

## Roadmap

- Vendor the fonts locally so the app works fully offline (they currently come from Google Fonts, with system fallbacks).
- Optional: a bundled runtime (Electron/Tauri) so the app doesn't need Node installed. Needed if TEMPEST will be shared with players' machines.
- Convert an entity to another level (for example a Group that turns out to be a Regional Faction).
- Custom month-based calendars (Harptos, Galactic Standard).
