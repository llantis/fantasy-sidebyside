import { gameFor } from './nfl.js';
import { finishSide, finishMatchup, formatRecord, round1 } from "./model.js";

const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };
const SLOT = {
  0: 'QB', 1: 'TQB', 2: 'RB', 3: 'RB/WR', 4: 'WR', 5: 'WR/TE', 6: 'TE', 7: 'OP',
  16: 'DEF', 17: 'K', 20: 'BN', 21: 'IR', 23: 'FLEX', 24: 'EDR',
};
const SLOT_ORDER = [0, 1, 7, 2, 4, 3, 5, 6, 23, 24, 16, 17];
const TEAM = {
  1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN',
  11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ',
  21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX',
  33: 'BAL', 34: 'HOU',
};
const INJURY = { ACTIVE: null, QUESTIONABLE: 'Questionable', DOUBTFUL: 'Doubtful', OUT: 'Out', INJURY_RESERVE: 'IR', SUSPENSION: 'Suspended' };

const normSwid = (s) => String(s ?? '').replace(/[{}]/g, '').toLowerCase();

export async function getEspnMatchups(cfg, nfl) {
  const { season, week } = nfl;
  const cookie = `espn_s2=${cfg.s2}; SWID=${cfg.swid}`;
  const mySwid = normSwid(cfg.swid);

  return Promise.all(
    cfg.leagueIds.map(async (leagueId) => {
      const base = { platform: 'espn', leagueId, leagueName: `ESPN ${leagueId}`, week };
      try {
        const url =
          `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}` +
          `?scoringPeriodId=${week}&view=mMatchup&view=mMatchupScore&view=mRoster&view=mTeam&view=mSettings`;
        const r = await fetch(url, {
          headers: { Cookie: cookie, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (fantasy-sidebyside)' },
        });
        if (r.status === 401 || r.status === 403) throw new Error('ESPN rejected the cookies. Refresh espn_s2 / SWID in config.json.');
        if (!r.ok) throw new Error(`ESPN HTTP ${r.status}`);
        const L = await r.json();
        base.leagueName = L.settings?.name ?? base.leagueName;

        let myTeam = L.teams.find((t) => (t.owners ?? []).some((o) => normSwid(o) === mySwid));
        if (!myTeam && cfg.teamId != null) myTeam = L.teams.find((t) => t.id === cfg.teamId);
        if (!myTeam) throw new Error('Could not find your team by SWID. Set espn.teamId in config.json.');

        const period = L.status?.currentMatchupPeriod ?? week;
        const game = (L.schedule ?? []).find(
          (s) => s.matchupPeriodId === period && (s.home?.teamId === myTeam.id || s.away?.teamId === myTeam.id),
        );
        if (!game) throw new Error(`no matchup scheduled for period ${period}`);
        const isHome = game.home?.teamId === myTeam.id;
        const meSide = isHome ? game.home : game.away;
        const oppSide = isHome ? game.away : game.home;

        const buildPlayer = (e) => {
          const p = e.playerPoolEntry?.player ?? {};
          const stats = p.stats ?? [];
          const forWeek = (src) => stats.find((s) => s.scoringPeriodId === week && s.statSourceId === src && s.statSplitTypeId === 1);
          const team = TEAM[p.proTeamId] ?? null;
          return {
            id: String(p.id ?? e.playerId),
            name: p.fullName ?? `Player ${e.playerId}`,
            pos: POS[p.defaultPositionId] ?? '',
            slot: SLOT[e.lineupSlotId] ?? String(e.lineupSlotId),
            team,
            points: round1(forWeek(0)?.appliedTotal ?? e.playerPoolEntry?.appliedStatTotal ?? 0),
            projected: round1(forWeek(1)?.appliedTotal ?? 0),
            injury: INJURY[p.injuryStatus] ?? (p.injured ? 'Injured' : null),
            game: gameFor(nfl.games, team),
          };
        };

        const side = (s) => {
          const t = L.teams.find((x) => x.id === s.teamId) ?? {};
          const owner = (L.members ?? []).find((m) => (t.owners ?? []).some((o) => normSwid(o) === normSwid(m.id)));
          const entries = s.rosterForCurrentScoringPeriod?.entries ?? t.roster?.entries ?? [];
          const starters = entries
            .filter((e) => e.lineupSlotId !== 20 && e.lineupSlotId !== 21)
            .sort((a, b) => SLOT_ORDER.indexOf(a.lineupSlotId) - SLOT_ORDER.indexOf(b.lineupSlotId))
            .map(buildPlayer);
          return finishSide({
            teamName: t.name || `${t.location ?? ''} ${t.nickname ?? ''}`.trim() || `Team ${s.teamId}`,
            owner: owner ? `${owner.firstName ?? ''} ${owner.lastName ?? ''}`.trim() || owner.displayName : null,
            record: formatRecord(t.record?.overall?.wins, t.record?.overall?.losses, t.record?.overall?.ties),
            points: s.totalPointsLive ?? s.totalPoints ?? null,
            nativeWinProb: s.winProbability ?? null,
            nativePace: s.totalProjectedPointsLive ?? null,
            starters,
          });
        };

        return finishMatchup({ ...base, week: period, me: side(meSide), opp: oppSide ? side(oppSide) : null });
      } catch (e) {
        return { ...base, error: e.message };
      }
    }),
  );
}
