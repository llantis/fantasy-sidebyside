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

## Setup (about 5 minutes)

### 1. Install Node.js

You need Node.js 20 or newer. Download the "LTS" installer from <https://nodejs.org> and run it.
To check it worked, open a terminal (macOS: **Terminal** app; Windows: **PowerShell**) and run:

```sh
node --version
```

You should see something like `v22.x.x`.

### 2. Get the app

Either download this folder as a ZIP and unzip it, or clone it with git. Then open a terminal
**in that folder**.

### 3. Create your config

Copy the example config:

```sh
cp config.example.json config.json        # macOS / Linux
copy config.example.json config.json      # Windows
```

Open `config.json` in any text editor and fill in the platforms you use. Delete the section for
any platform you don't use.

#### Sleeper

```json
"sleeper": {
  "username": "your_sleeper_username",
  "leagueIds": []
}
```

That's it. Sleeper's API is public and read-only. Leave `leagueIds` empty to show every league
you're in this season, or list specific league IDs (from the URL: `sleeper.com/leagues/<id>`).

#### ESPN

ESPN needs two cookies from a browser where you're logged into ESPN Fantasy. They only ever
go into this file on your computer.

1. Open <https://fantasy.espn.com> and log in.
2. Open DevTools (**Cmd+Option+I** on Mac, **F12** on Windows) → **Application** tab
   (Firefox: **Storage**) → **Cookies** → `https://fantasy.espn.com`.
3. Copy the value of `espn_s2` into `"s2"` and the value of `SWID` (keep the curly braces)
   into `"swid"`.
4. Add your league ID(s). It's in the league URL: `fantasy.espn.com/football/league?leagueId=123456789`.

```json
"espn": {
  "s2": "AEB...very long...",
  "swid": "{1234ABCD-....}",
  "leagueIds": [123456789],
  "teamId": null
}
```

Your team is found automatically from the SWID. Only set `teamId` if the page says it can't
find your team (the number is in your team URL: `...&teamId=8`).

`espn_s2` expires every so often. If the ESPN card starts showing a 401/403 error, copy a
fresh one.

### 4. Run it

```sh
npm start
```

Open <http://localhost:5050>. Leave the terminal window open while you watch; press **Ctrl+C**
to stop.

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
public/styles.css
public/index.html
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
