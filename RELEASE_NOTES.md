## Version 1.1.0-Alpha (Saber): Combat Initiative, Codex, and Fine-Tuning Revealing

TEMPEST is a world manager for tabletop GMs: build your campaign, then push what the players should see to a second screen, a TV or their phones. **Saber** brings fights to the table with an initiative tracker whose turn order stays on every player screen. It also gives players a Codex of everything they know, and lets you decide, field by field, exactly how much they see.

### Downloads

| File | For |
|---|---|
| `TEMPEST-Setup-1.1.0-alpha.exe` | **Windows 10/11 (x64): installer.** Per user, no admin rights. Adds Start Menu and desktop shortcuts and an uninstaller. Installs over 1.0.0-alpha. |
| `tempest-1.1.0-alpha-win-x64.zip` | Windows, portable: unpack anywhere and run `tempest.exe` |
| `tempest-1.1.0-alpha-linux-x64.tar.gz` | Linux (x64): unpack and run `./tempest` |

No Node.js needed. Your projects are kept in `%LOCALAPPDATA%\TEMPEST` (Linux: `~/.local/share/TEMPEST`) and are never touched by installing, updating or uninstalling.

### ⚔️ Combat Initiative

- **Initiative tracker** (**Combat › Initiative**):
  - **Joining:** characters join with the HP, initiative (or REF) and armor from their own sheets. Copies are numbered (*Junkyard Scav #1, #2*), and one-off foes need only a name.
  - **Rolling:** a Cyberpunk RED project rolls **1d10 + bonus**; other projects start on 1d20, and you can change the die.
  - **Each row:** damage, healing and temporary HP, armor, ability slots, and conditions that count down at the start of each turn.
  - **Hide and Down:** **Hide** keeps an ambusher off the screens; **Down** takes someone out of the turn order.
  - **Ending:** **End combat** can write the player characters' HP back to their sheets.
- **A turn bar on every player screen:** while a fight is on, the turn order runs across the top of every player screen, whatever else you push.
  - **The order:** whoever is acting comes first and larger; when a turn passes, the cards slide along and the one that just acted wraps round to the end.
  - **Attacks:** **Hit**, **Crit** or **Miss** plays out on every screen: the strike, the damage, and the target's health draining.
  - **What players see:** PCs show their HP. Foes show only *Unhurt / Wounded / Bloodied / Critical*, never numbers. Hidden and defeated foes don't appear at all.

### 📖 The players' Codex

- **A Codex button on every player screen** opens everything the party knows of: **Players, NPCs, Monsters, Creatures, World, Items, News and Places**.
- **Players browse it at their own pace,** with search, and pushes carry on underneath.
- **New entries are marked *New*,** and the Codex button counts them.
- **Putting entries in:** mark an entry **In the Codex** from its page, or just push it. Whatever the players have been shown stays in their Codex.
- **Each entry appears as its sheet allows,** so players see what you've revealed, and the rest stays hidden or obscured.

### 🔐 Fine-Tuning Revealing

- **Hide, Reveal or Obscure on the spot:** every field on a character, story, rumor, event or item page has its own control. Changes apply to that one entry and save at once.
- **Choices:**
  - **Reveal**
  - **Obscure:** Redacted, Static, the new **Encrypted** (shifting cipher text), or your own words
  - **Shown text:** players read your words instead
  - **Hide:** new; players get nothing of the field, not even its name
- **Screamsheets too:** the headline, byline, date line, outlet and article can each be obscured or hidden. With an obscured headline, the player screen's title says just *Screamsheet*.
- **Player view** on each page previews exactly what players get.

### 🎲 A fuller demo campaign

- **A ready-made fight** in the initiative tracker.
- **A stocked Codex.**
- **Story arcs that lead into each other.**
- **Finished player-character sheets.**
- **Secrets kept the new ways:** the Tin Man is known only by rumor.
- **Already have the demo?** When you start this version, files you never changed are updated. Anything you edited or deleted is left as you left it.

### Also in TEMPEST

- **Projects:** one per campaign, each with its own theme, money system and map settings.
- **The Forge:** design sheet presets for characters, stories and items, then fill them in. Includes ready-made **Cyberpunk RED** templates.
- **Netrunning:** forge net cards, build NET architectures and reveal them floor by floor.
- **Maps:** a 3D World View globe and the Night City City Map.
- **Screamsheets:** generate and print in-world news.
- **Player screens:** send to named screens on this PC or across your network (via a QR code).
- **Themes:** Cyberpunk RED, Moontown, Land of Sand and more.

### Good to know

- **Alpha software.** Back up your project folders before updating.
- **Unsigned files.** Windows SmartScreen may warn on first run: choose **More info → Run anyway**.
- **Linux build:** not yet tested on a real Linux machine. Reports welcome.
- **Screamsheet tables:** the generator reads them from R. Talsorian Games' free *Screamsheet Generator* PDF. Import it once from the app (needs Python 3 with `pypdf`).

TEMPEST is an unofficial fan tool, not affiliated with R. Talsorian Games or CD PROJEKT RED. Licensed under GPL-3.0. See the README for credits.
