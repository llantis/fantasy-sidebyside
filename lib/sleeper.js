import fs from 'node:fs/promises';
import path from 'node:path';
import { gameFor } from './nfl.js';
import { finishSide, finishMatchup, formatRecord, round1 } from "./model.js";

const API = 'https://api.sleeper.app/v1';
const PROJ = 'https://api.sleeper.com/projections/nfl';
const PLAYERS_TTL_MS = 24 * 60 * 60 * 1000;
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

async function j(url) {
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Sleeper HTTP ${r.status} for ${url}`);
  return r.json();
}

// The full player DB is ~5 MB and changes rarely; Sleeper asks that you fetch it
// at most once a day. Cache on disk.
let playersMem = null;
async function getPlayers(cacheDir) {
  if (playersMem && Date.now() - playersMem.at < PLAYERS_TTL_MS) return playersMem.data;
  const file = path.join(cacheDir, 'sleeper-players.json');
  try {
    const stat = await fs.stat(file);
    if (Date.now() - stat.mtimeMs < PLAYERS_TTL_MS) {
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      playersMem = { at: stat.mtimeMs, data };
      return data;
    }
  } catch {}
  const data = await j(`${API}/players/nfl`);
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data));
  playersMem = { at: Date.now(), data };
  return data;
}

// Undocumented but stable endpoint used by Sleeper's own web app.
// Cached per (season, week) for 15 minutes; failures degrade to "no projections".
let projMem = null;
async function getProjections(season, week) {
  const key = `${season}-${week}`;
  if (projMem && projMem.key === key && Date.now() - projMem.at < 15 * 60 * 1000) return projMem.data;
  try {
    const qs = POSITIONS.map((p) => `position[]=${p}`).join('&');
    const list = await j(`${PROJ}/${season}/${week}?season_type=regular&${qs}&order_by=ppr`);
    const data = {};
    for (const row of list ?? []) if (row?.player_id && row.stats) data[row.player_id] = row.stats;
    projMem = { key, at: Date.now(), data };
    return data;
  } catch (e) {
    console.warn('sleeper projections unavailable:', e.message);
    return projMem?.data ?? {};
  }
}

function scoringKey(league) {
  const rec = league.scoring_settings?.rec ?? 0;
  if (rec >= 1) return 'pts_ppr';
  if (rec >= 0.5) return 'pts_half_ppr';
  return 'pts_std';
}

export async function getSleeperMatchups(cfg, nfl, cacheDir) {
  const user = await j(`${API}/user/${encodeURIComponent(cfg.username)}`);
  if (!user) throw new Error(`Sleeper user "${cfg.username}" not found`);

  const state = await j(`${API}/state/nfl`);
  const season = state.season;
  const week = state.week;

  let leagues = (await j(`${API}/user/${user.user_id}/leagues/nfl/${season}`)) ?? [];
  if (cfg.leagueIds?.length) {
    const want = new Set(cfg.leagueIds.map(String));
    leagues = leagues.filter((l) => want.has(String(l.league_id)));
  }

  const [players, projections] = await Promise.all([getPlayers(cacheDir), getProjections(season, week)]);

  return Promise.all(
    leagues.map(async (league) => {
      const base = { platform: 'sleeper', leagueId: league.league_id, leagueName: league.name, week };
      try {
        const [rosters, users, matchups] = await Promise.all([
          j(`${API}/league/${league.league_id}/rosters`),
          j(`${API}/league/${league.league_id}/users`),
          j(`${API}/league/${league.league_id}/matchups/${week}`),
        ]);

        const myRoster = rosters.find(
          (r) => r.owner_id === user.user_id || (r.co_owners ?? []).includes(user.user_id),
        );
        if (!myRoster) throw new Error('you have no roster in this league');

        const mine = (matchups ?? []).find((m) => m.roster_id === myRoster.roster_id);
        if (!mine) throw new Error(`no matchup data for week ${week} yet`);
        const opp = matchups.find((m) => m.matchup_id === mine.matchup_id && m.roster_id !== mine.roster_id);

        const slots = (league.roster_positions ?? []).filter((p) => !['BN', 'IR', 'TAXI'].includes(p));
        const pk = scoringKey(league);

        const buildPlayer = (pid, i, m) => {
          if (!pid || pid === '0') {
            return { id: `empty-${i}`, name: 'Empty', pos: '', slot: slots[i], team: null, points: 0, projected: 0, game: { state: 'bye', label: '', remaining: 0 } };
          }
          const p = players[pid] ?? {};
          const team = p.team ?? (p.position === 'DEF' ? pid : null);
          return {
            id: pid,
            name: p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(' ') ?? pid,
            pos: p.position ?? '',
            slot: slots[i] ?? '',
            team,
            points: round1(m.starters_points?.[i] ?? m.players_points?.[pid] ?? 0),
            projected: round1(projections[pid]?.[pk] ?? 0),
            injury: p.injury_status ?? null,
            game: gameFor(nfl.games, team),
          };
        };

        const side = (m) => {
          const roster = rosters.find((r) => r.roster_id === m.roster_id);
          const owner = users.find((u) => u.user_id === roster?.owner_id);
          return finishSide({
            teamName: owner?.metadata?.team_name || owner?.display_name || `Team ${m.roster_id}`,
            owner: owner?.display_name ?? null,
            record: formatRecord(roster?.settings?.wins, roster?.settings?.losses, roster?.settings?.ties),
            points: m.points ?? 0,
            starters: (m.starters ?? []).map((pid, i) => buildPlayer(pid, i, m)),
          });
        };

        return finishMatchup({ ...base, me: side(mine), opp: opp ? side(opp) : null });
      } catch (e) {
        return { ...base, error: e.message };
      }
    }),
  );
}
