## Version 1.2.0-Alpha: Sessions & Handouts, Factions & Timeline, and New Map Systems

TEMPEST is a world manager for tabletop GMs: build your campaign, then push what the players should see to a second screen, a TV or their phones. This release takes TEMPEST from fight night to the whole campaign:
- **Sessions** for planning each game night and handing out props.
- **Factions** and a **Timeline** for the world's powers and history.
- **Three new map systems** beyond the globe.
- **Screamsheets** rebuilt as full news issues.
- **Run the GM window from a tablet.**

### Downloads

| File | For |
|---|---|
| `TEMPEST-Setup-1.2.0-alpha.exe` | **Windows 10/11 (x64): installer.** Per user, no admin rights. Adds Start Menu and desktop shortcuts and an uninstaller. Installs over 1.1.0-alpha. |
| `tempest-1.2.0-alpha-win-x64.zip` | Windows, portable: unpack anywhere and run `tempest.exe` |
| `tempest-1.2.0-alpha-linux-x64.tar.gz` | Linux (x64): unpack and run `./tempest` |

No Node.js needed. Your projects are kept in `%LOCALAPPDATA%\TEMPEST` (Linux: `~/.local/share/TEMPEST`) and are never touched by installing, updating or uninstalling.

### 📜 Sessions & Handouts

- **Session log** (**Sessions › Session log**): one page per game night, saved as you type.
  - **Plan:** a checklist of scenes, beats and things to prepare, to tick off at the table.
  - **Featuring:** the NPCs, places, items, stories and factions the session is about, each one click from its page or from the player screen.
  - **GM notes** only you see, and a **recap for the players**. **⇪ Push recap** shows "Previously…" on every screen.
  - Each session is **Planned** or **Played**, with its date.
- **Handouts** (**Sessions › Handouts**): props to hand the players, each looking like what it is, whatever the theme:
  - a **letter** (paper and ink)
  - a **scrawled note**
  - a **typed document**
  - a glowing **datapad message**
  - a **picture** with its caption
- **Codes to crack:** a handout's text can reach players **redacted**, as **static** or **encrypted**. They see that something is written, but the words never leave your PC. Clear it when they crack it.
- **Pushing a handout or a recap** puts it in the players' Codex, under the new **Handouts** and **Sessions** tabs.

### ⚑ Factions & Timeline

- **Factions** (**World › Factions**): corporations, gangs, syndicates, governments, guilds, cults and more.
  - **Every faction has** a leader, headquarters and founding date. Filter the list by type.
  - **Relations:** a new field that ties factions and people together with a stance: Ally, Rival, Enemy, Member of, Leads, Controls…
  - Characters can add Relations too, as **Affiliations**.
- **Timeline** (**World › Timeline**): stories, rumors, events and factions in date order, in any calendar.
  - **Stretches of time** run as coloured rails beside the spine.
  - **⇪ Push timeline** shows players only what's in their Codex, dated as each sheet allows.

### 🗺️ New map systems

Pick one in **Project settings › Map system**. Each adds a section of its own, and everything starts **hidden** until you reveal it:

- **Planes:** a board of planes and realms joined by portals, gates and rifts. You can **hint** at a way without giving away where it leads.
- **Atlas:** upload your own maps and link them, land to city to dungeon.
  - **Pins and regions** mark places on each map.
  - **Fog of war:** brush it away as the party explores. Players only ever receive a copy with the fog painted in.
- **Star Map:** star systems, the lanes between them (with travel times) and coloured sectors. Night City is on it too, with its City Map.

The World View globe stays, as the **Planetary** system.

### 📰 Screamsheets, rebuilt

- **Full issues,** like *Night City Today*: a lead article, then more articles and **ads**.
  - **On each piece:** Link lines and bold notes (*Disclaimer:*, *Correction:*).
  - **Layouts:** a news-feed look with section tabs, plus Broadsheet, Terminal and Plain.
- **Pictures** before or after any article's text.
- **Roll or write:** **⚄ Generate one** with the generator, or **✎ Write your own** without any tables.
- **Links to your entries** open in the players' Codex once they know them.

### 📱 GM on your network

- **Run the GM window from a tablet or phone** while TEMPEST keeps your campaigns on the PC. Turn it on in **Project settings › GM on your network** and scan the QR code.
- **Its own key:** **New key** signs every device out. Shutting down and the network settings stay on the PC.

### ✨ Easier to use

- **+ New NPC** (Monster, Rumor, Item, Faction…) on every list opens The Forge's form with that type already set. The button names what it makes: *Create NPC*.
- **⚙ Edit fields:** add, remove or rearrange the fields of one existing entry, without touching its preset.
- **Hide all / Reveal all** on the character, event, story, rumor, faction and item lists, with **Undo**.
- **A tidier Forge:** **Save** stays beside the preset picker, and New, templates, Duplicate, Import, Export and Delete are in one **Preset ⋯** menu.
- **A tidier top bar:** Theme and Effects are in one **◐ Theme** menu.
- **Easier to read and tap:**
  - Faint text is easier to read in every theme.
  - Field visibility controls are bigger and easier to tap.
  - A *Loading…* line shows while a section opens.
- **Fewer accidents:** **Full rest** asks before healing everyone. Project **Delete** sits apart from **Open**.
- **On phones:** the turn bar takes less room, and the Codex button steps aside while the Codex is open.

### 🎲 A fuller demo campaign

- **Three sessions:** *The Halcyon Extraction* and *Patient Zero* (played, with recaps the players have), and *Cold Storage* (being planned).
- **Five handouts,** among them Mama Ndiaye's note, a floor plan and an encrypted intercept.
- **The campaign's factions:** the Static Saints, the Chrome Vultures, Halcyon Biotics, NCPD Task Force Vulture, and Site 9 (kept from the players). They're all on the Timeline.
- **Already have the demo?** When you start this version, new files arrive and files you never changed are updated. Anything you edited or deleted is left as you left it.

### Also in TEMPEST

- **Projects:** one per campaign, each with its own theme, money system and map system.
- **The Forge:** design sheet presets for characters, stories, items and factions, then fill them in. Includes ready-made **Cyberpunk RED** templates.
- **Combat:** an initiative tracker whose turn order stays on every player screen, plus netrunning with net cards and NET architectures.
- **The players' Codex:** everything the party knows, browsable on every player screen.
- **Fine-tuned revealing:** reveal, obscure or hide every field, entry by entry.
- **Player screens:** send to named screens on this PC or across your network (via a QR code).
- **Themes:** Cyberpunk RED, Moontown, Land of Sand and more.

### Good to know

- **Alpha software.** Back up your project folders before updating.
- **Unsigned files.** Windows SmartScreen may warn on first run: choose **More info → Run anyway**.
- **Linux build:** not yet tested on a real Linux machine. Reports welcome.
- **The Android app** (TEMPEST Companion, for GM mode on a tablet) isn't in these downloads; build it from `android/` (see `android/README.md`). Any browser on the tablet works too.
- **GM on a tablet:** the GM window is laid out for wide screens, so use tablets in landscape.
- **Screamsheet tables:** the generator reads them from R. Talsorian Games' free *Screamsheet Generator* PDF. Import it once from the app (needs Python 3 with `pypdf`). **✎ Write your own** works without them.

TEMPEST is an unofficial fan tool, not affiliated with R. Talsorian Games or CD PROJEKT RED. Licensed under GPL-3.0. See the README for credits.
