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
- **Key people** — players on your team, or against you, in 2+ leagues.
- **Controversial people** — players on your team in one league and against you in another.

Everything runs on your own computer. Nothing is uploaded anywhere.

---

## Setup (a few clicks)

1. **Get the folder.** Download the ZIP (green **Code** button → Download ZIP) and unzip it, or `git clone` it.
2. **Double-click the launcher** in the folder:
   - macOS: **`Start (Mac).command`** — if macOS says it can't be opened, right-click → Open the first time.
   - Windows: **`Start (Windows).bat`**
   
   It installs Node.js if you don't have it (Homebrew on Mac, winget on Windows), starts the app,
   and opens your browser.
3. **Fill in the setup page** that opens. Sleeper only needs your username. ESPN needs your league
   ID and two cookies; the page walks you through copying them. Press **Check & save** — it
   verifies everything against Sleeper/ESPN before saving, then opens your dashboard.

Leave the terminal window open while you watch. Close it to stop. Next time, just double-click
the launcher again. The **⚙ settings** link in the header reopens the setup page.

Prefer the terminal? `npm start` does the same thing (Node 20+ required, no `npm install` needed).
Config lives in `config.json`; `config.example.json` shows the shape.

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
