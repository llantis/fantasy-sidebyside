// Per-matchup win-probability history for the week, persisted to CACHE_DIR so the chart survives
// restarts and covers Thursday to Monday. Only change points are stored; idle stretches collapse
// to a two-sample flat run whose end time is moved forward, which keeps the file small and lets
// the page compress days with no games.
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_SAMPLES = 3000;
const HEARTBEAT_MS = 5 * 60 * 1000;
const THIN_MAX = 400;

export const historyKey = (m) => `${m.platform}|${String(m.leagueId)}|${m.week}`;

export function createHistory(cacheDir) {
  let file = null;
  let weekKey = null;
  let samples = {};   // key -> [{ t, w, s, a, b }]

  return {
    // Switch to (and load) the file for this season/week. No-op when unchanged.
    async use(season, week) {
      const k = `${season}-${week}`;
      if (k === weekKey) return;
      weekKey = k;
      file = path.join(cacheDir, `history-${k}.json`);
      samples = {};
      try {
        const data = JSON.parse(await fs.readFile(file, 'utf8'));
        if (data && typeof data.samples === 'object') samples = data.samples;
      } catch {}
    },

    // Sample every healthy matchup. Returns true when something changed and should be saved.
    record(matchups, now) {
      let changed = false;
      for (const m of matchups) {
        if (m.error || !m.me || m.me.winPct == null) continue;
        const arr = (samples[historyKey(m)] ??= []);
        const s = { t: now, w: m.me.winPct, s: m.me.winSource === 'platform' ? 'p' : 'm', a: m.me.points, b: m.opp?.points ?? 0 };
        const last = arr[arr.length - 1];
        const prev = arr[arr.length - 2];
        const same = (x, y) => x && y && x.w === y.w && x.a === y.a && x.b === y.b;
        if (!same(last, s)) { arr.push(s); changed = true; }
        else if (now - last.t >= HEARTBEAT_MS) {
          if (same(prev, last)) last.t = now;   // extend the flat run instead of growing it
          else arr.push(s);
          changed = true;
        }
        if (arr.length > MAX_SAMPLES) arr.splice(0, arr.length - MAX_SAMPLES);
      }
      return changed;
    },

    async save() {
      if (!file) return;
      const tmp = `${file}.tmp`;
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(tmp, JSON.stringify({ week: weekKey, samples }));
      await fs.rename(tmp, file);
    },

    // Evenly decimated copy for the snapshot, keeping first and last points.
    thinned(max = THIN_MAX) {
      const out = {};
      for (const [k, a] of Object.entries(samples)) {
        if (a.length <= max) { out[k] = a; continue; }
        const step = (a.length - 1) / (max - 1);
        out[k] = [a[0], ...Array.from({ length: max - 2 }, (_, i) => a[Math.round((i + 1) * step)]), a[a.length - 1]];
      }
      return out;
    },
  };
}
