# Fantasy · Side by Side

One local web page that shows **every fantasy league you're in, your lineup on the left, your
opponent on the right**, refreshed every 30 seconds while games are on. Works with **Sleeper**
and **ESPN** leagues at the same time.

What's on the page:

- Live score, season record, "on pace" total and win probability for both teams.
- Each starter with his points, projection, and a status dot: **pulsing green** when his team
  has the ball (a defense lights up when the *other* team has it), **red** in the red zone,
  dim green on the sideline, hollow ring before kickoff, gray when final.
- The game clock coloured by urgency: green in Q1–Q2, yellow at halftime/Q3, orange in Q4,
  red inside two minutes.
- **My key players** — on your team in 2+ leagues.
- **Controversial** — on your team in one league and against you in another.
- **Enemy key players** — started against you in 2+ leagues.
- **Win probability over time** — a small chart under each matchup's score: your win% through the
  week, tinted blue above 50 and orange below, with idle days collapsed. Hover for time, win% and score.
  History is saved next to the config so it survives restarts.
- **Recent changes** — every scoring change since the app started, newest first, with the effect on
  your margin in each league the player appears in (positive if he is yours, negative if he is against you).
  Each row shows what he did ("+1 rec, +32 yds, TD") from the live NFL stat feed and his week line;
  expand a row to see one line per play with a column per league, so the same play reported by
  Sleeper and ESPN a minute apart, or scored differently by league, lines up side by side.

Everything runs on your own computer. Nothing is uploaded anywhere.

---

## Setup (a few clicks)

1. **Get the folder.** Download the ZIP (green **Code** button → Download ZIP) and unzip it, or `git clone` it.
2. **Start it.**

   **macOS:** double-clicking `Start (Mac).command` will be blocked the first time with
   *"Apple could not verify … is free of malware"*. That's Gatekeeper reacting to any downloaded
   file; it isn't a problem with the app. Skip it like this:

   1. Open **Terminal** (press Cmd+Space, type `Terminal`, press Return).
   2. **Drag `Start (Mac).command` from the folder into the Terminal window** and press Return.

   That's it. Gatekeeper only checks things opened from Finder, not things run in Terminal.
   After the first run the launcher clears the download flag, so double-clicking works from then on.

   Don't have the folder yet? This one line in Terminal downloads and starts it (and installs Node.js
   if needed). Re-run it any time to start again or pick up updates:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/llantis/fantasy-sidebyside/main/install.sh | bash
   ```

   **Windows:** double-click `Start (Windows).bat`. It installs Node.js with winget if needed.

3. **Fill in the setup page** that opens. Sleeper only needs your username. ESPN needs your league
   ID and two cookies; the page walks you through copying them. Press **Check & save** — it
   verifies everything against Sleeper/ESPN before saving, then opens your dashboard.

Leave the terminal window open while you watch. Close it to stop. Next time, re-run the one-liner
or double-click the launcher again. The **⚙ settings** link in the header reopens the setup page.

Prefer the terminal? `npm start` does the same thing (Node 20+ required, no `npm install` needed).
Config lives in `config.json`; `config.example.json` shows the shape.

---

## Mac app (the real "drag to Applications" experience)

`mac/build-app.sh` builds **Fantasy Side by Side.app**: a menu bar app (🏈) with *Open Dashboard*,
*Settings…* and *Quit*, with Node bundled inside so nothing else needs installing. It ships as a DMG
with an Applications shortcut. Config and cache live in `~/Library/Application Support/Fantasy Side by Side/`.

```sh
./mac/build-app.sh          # → dist/Fantasy Side by Side.app + dist/Fantasy-Side-by-Side-<version>.dmg
```

**The catch: Gatekeeper.** An app that friends download only opens without the *"Apple could not
verify…"* dialog if it is signed with a **Developer ID** certificate and **notarized** by Apple.
That requires the paid Apple Developer Program (US$99/year). There is no packaging trick around it;
an unsigned `.app` gets exactly the same dialog as the `.command` file.

Once enrolled, it's a one-time setup and then one command:

1. Xcode → Settings → Accounts → your Apple ID → **Manage Certificates** → **+** → *Developer ID Application*.
2. Create an app-specific password at <https://appleid.apple.com>, then store it once:
   ```sh
   xcrun notarytool store-credentials fsbs --apple-id you@example.com --team-id YOURTEAMID
   ```
3. Build, sign, notarize and staple in one go:
   ```sh
   SIGN_IDENTITY="Developer ID Application: Your Name (YOURTEAMID)" NOTARY_PROFILE=fsbs ./mac/build-app.sh
   ```

The resulting DMG opens cleanly on any Mac: double-click, drag to Applications, done. Without
`SIGN_IDENTITY` the script still produces a working app for your own machine.

The build stages in a temp folder on purpose: bundles assembled inside iCloud Drive / Dropbox folders
pick up extended attributes that `codesign` rejects.

---

## Options

In `config.json`:

| key              | default | what it does                                          |
|------------------|---------|-------------------------------------------------------|
| `port`           | 5050    | the local port the page is served on                  |
| `refreshSeconds` | 30      | how often scores are re-fetched (minimum 10)          |

---

## How it works

```
server.js            polls all leagues on an interval, keeps one snapshot, serves /api/matchups
lib/nfl.js           public NFL scoreboard: game state, clock, possession, red zone per NFL team
lib/sleeper.js       Sleeper adapter  → normalized matchup
lib/espn.js          ESPN adapter     → normalized matchup
lib/model.js         shared shape, "on pace" maths, win probability estimate
lib/config.js        loads and validates config.json
public/app.js        renders the snapshot; cross-league player matching; dot/clock rules
public/setup.html    first-run setup page (/setup); posts to /api/setup, which validates then saves
public/setup.js
public/styles.css
public/index.html
install.sh           curl-pipe-bash installer for macOS/Linux: Node if missing, clone or update, run
mac/                 Mac app: Swift menu-bar launcher, build-app.sh (bundle Node, sign, notarize, DMG)
Start (Mac).command  double-click launchers: install Node if missing, run server, open browser
Start (Windows).bat
```

- Both adapters produce the same shape, so the page never knows which platform a card came from.
- **Win probability:** ESPN cards show ESPN's own number (`WIN · ESPN`). Sleeper's public API
  has none, so those cards show an estimate (`WIN · EST`): banked points plus remaining
  projections, with per-position volatility scaled by how much of each game is left
  (`winProbability` in `lib/model.js`). It's capped to 1–99% while anything is still live.
- **Cross-league matching:** Sleeper and ESPN use different player IDs, so players are matched
  by normalized name + position; defenses by NFL team.
- **On the field:** the scoreboard reports which team has possession between snaps. Offensive
  players light up when their team has the ball, defenses when the opponent does. Nobody lights
  up at halftime or between quarters.
- The Sleeper player database (~14 MB) is cached in `.cache/` for 24 hours.

No dependencies. `config.json` and `.cache/` are git-ignored so credentials never get committed.
