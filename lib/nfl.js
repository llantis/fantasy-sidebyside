// Shared NFL game-state source for both platforms.
// ESPN's public scoreboard needs no auth and tells us, for every NFL team this week,
// whether its game is pre / in / post, the clock, and the score.

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

// ESPN and Sleeper disagree on a couple of abbreviations. Normalize to Sleeper's.
const ABBR_FIX = { WSH: 'WAS' };

export async function getNflState() {
  const r = await fetch(SCOREBOARD);
  if (!r.ok) throw new Error(`NFL scoreboard HTTP ${r.status}`);
  const j = await r.json();

  const games = {};
  for (const ev of j.events ?? []) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;
    const st = ev.status ?? {};
    const state = st.type?.state ?? 'pre'; // 'pre' | 'in' | 'post'
    const label = st.type?.shortDetail ?? '';
    const clock = parseClock(st.displayClock);
    const period = st.period ?? 0;
    const sit = comp.situation ?? {};
    const poss = sit.possession != null ? String(sit.possession) : null;

    for (const c of comp.competitors) {
      const abbr = ABBR_FIX[c.team.abbreviation] ?? c.team.abbreviation;
      const opp = comp.competitors.find((x) => x !== c);
      games[abbr] = {
        state,
        label,
        period,
        clock,
        remaining: fractionRemaining(state, period, clock),
        opponent: (opp && (ABBR_FIX[opp.team.abbreviation] ?? opp.team.abbreviation)) || null,
        home: c.homeAway === 'home',
        score: opp ? `${c.score}-${opp.score}` : null,
        // Possession is only reported between snaps of a live game; null at halftime, timeouts, etc.
        onFieldKnown: state === "in" && poss != null,
        hasBall: poss != null && String(c.id) === poss,
        downDistance: sit.shortDownDistanceText ?? null,
        redZone: !!sit.isRedZone,
      };
    }
  }

  return { season: j.season?.year, week: j.week?.number, games };
}

export function gameFor(games, abbr) {
  if (!abbr) return { state: 'bye', label: 'FA', remaining: 0 };
  return games[abbr] ?? { state: 'bye', label: 'BYE', remaining: 0 };
}

function parseClock(s) {
  if (!s || typeof s !== 'string') return 0;
  const [m, sec] = s.split(':').map(Number);
  return (m || 0) * 60 + (sec || 0);
}

// Fraction of regulation game time still to be played, 0..1.
// Used to blend actual + projected points into an "on pace" number mid-game.
function fractionRemaining(state, period, clockSeconds) {
  if (state === 'pre') return 1;
  if (state === 'post') return 0;
  if (period >= 5) return 0; // overtime: treat projection as spent
  const quartersLeft = Math.max(0, 4 - period);
  return Math.min(1, Math.max(0, (quartersLeft + clockSeconds / 900) / 4));
}
