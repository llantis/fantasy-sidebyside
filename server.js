import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readConfig, writeConfig, normalizeConfig, redactConfig, isConfigured } from './lib/config.js';
import { getNflState } from './lib/nfl.js';
import { getSleeperMatchups, probeSleeper, getLiveStats } from "./lib/sleeper.js";
import { createStatTracker } from "./lib/stats.js";
import { createHistory } from "./lib/history.js";
import { getEspnMatchups, probeEspn } from "./lib/espn.js";
import { round1 } from "./lib/model.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
// Where config.json and the cache live. The packaged Mac app points this at
// ~/Library/Application Support so the signed bundle is never written to.
const DATA_DIR = process.env.FSBS_DATA_DIR || ROOT;
const CACHE_DIR = path.join(DATA_DIR, ".cache");
fs.mkdirSync(CACHE_DIR, { recursive: true });

let config = readConfig(DATA_DIR);
const PORT = Number(process.env.PORT) || config.port;

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

const emptySnapshot = () => ({ updatedAt: null, season: null, week: null, refreshSeconds: config.refreshSeconds, matchups: [], changes: [], history: {}, errors: [] });
let snapshot = emptySnapshot();
let inFlight = null;
let timer = null;

// Recent scoring changes, newest first. Compared per (league, side, player) across refreshes and
// grouped per player, with the effect on your margin in every league he appears in.
const MAX_CHANGES = 150;
const lastPoints = new Map();   // "platform|league|side|playerId" -> points
let changes = [];
const statTracker = createStatTracker();   // attaches "+1 rec, +32 yds, TD" to point changes
const history = createHistory(CACHE_DIR);   // win-probability samples for the week, on disk

// Returns the set of player keys that produced a change this poll.
function detectChanges(matchups, at) {
  const byPlayer = new Map();
  for (const m of matchups) {
    if (m.error || !m.me) continue;
    for (const side of ["me", "opp"]) {
      const s = m[side];
      if (!s) continue;
      for (const p of s.starters) {
        if (p.id.startsWith("empty-")) continue;
        const k = `${m.platform}|${m.leagueId}|${side}|${p.id}`;
        const prev = lastPoints.get(k);
        lastPoints.set(k, p.points);
        if (prev == null || prev === p.points) continue;
        const delta = round1(p.points - prev);
        if (!delta) continue;   // sub-cent wobble in a platform number, not a scoring change
        if (!byPlayer.has(p.key)) {
          byPlayer.set(p.key, { at, key: p.key, name: p.name, pos: p.pos, team: p.team, points: p.points, delta, game: p.game, appearances: [], stats: statTracker.take(p.key) });
        }
        byPlayer.get(p.key).appearances.push({
          platform: m.platform, league: m.leagueName, side, teamName: s.teamName, delta,
          impact: side === "me" ? delta : -delta,
        });
      }
    }
  }
  const fresh = [...byPlayer.values()].map((e) => ({ ...e, netImpact: round1(e.appearances.reduce((a, x) => a + x.impact, 0)) }));
  if (fresh.length) changes = [...fresh, ...changes].slice(0, MAX_CHANGES);
  return new Set(byPlayer.keys());
}

// Stats that arrive a poll or two after the points did: attach them to that player's most recent
// stats-less change instead of holding them for his next one.
const BACKFILL_MS = 3 * 60 * 1000;
function backfillStats(movedKeys, changedKeys, at) {
  const now = new Date(at).getTime();
  for (const k of movedKeys) {
    if (changedKeys.has(k)) continue;                                   // already attached this poll
    const c = changes.find((x) => x.key === k);                          // newest first
    if (!c || c.stats?.delta || now - new Date(c.at).getTime() > BACKFILL_MS) continue;
    c.stats = statTracker.take(k);
  }
}

async function refresh() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    if (!isConfigured(config)) { snapshot = emptySnapshot(); return; }
    const errors = [];
    try {
      const nfl = await getNflState();
      await history.use(nfl.season, nfl.week);
      // Live stat feed runs alongside the league fetches; its failure never blocks points.
      const statsJob = getLiveStats(nfl.season, nfl.week).catch((e) => { console.warn("live stats unavailable:", e.message); return null; });
      const jobs = [];
      if (config.sleeper) jobs.push(getSleeperMatchups(config.sleeper, nfl, CACHE_DIR).catch((e) => { errors.push(`Sleeper: ${e.message}`); return []; }));
      if (config.espn) jobs.push(getEspnMatchups(config.espn, nfl).catch((e) => { errors.push(`ESPN: ${e.message}`); return []; }));
      const matchups = (await Promise.all(jobs)).flat();
      const feed = await statsJob;
      const updatedAt = new Date().toISOString();
      const moved = feed ? statTracker.ingest(feed, `${nfl.season}-${nfl.week}`) : new Set();
      const changed = detectChanges(matchups, updatedAt);
      backfillStats(moved, changed, updatedAt);
      const appended = history.record(matchups, Date.parse(updatedAt));
      snapshot = { updatedAt, season: nfl.season, week: nfl.week, refreshSeconds: config.refreshSeconds, matchups, changes, history: history.thinned(), errors };
      if (appended) await history.save().catch((e) => console.warn('history save:', e.message));
    } catch (e) {
      errors.push(`NFL scoreboard: ${e.message}`);
      snapshot = { ...snapshot, errors };
    }
    const stamp = `[${new Date().toLocaleTimeString()}]`;
    if (errors.length) console.warn(stamp, errors.join(' | '));
    else console.log(stamp, `refreshed ${snapshot.matchups.length} matchup(s)`);
  })().finally(() => { inFlight = null; });
  return inFlight;
}

function schedule() {
  if (timer) clearInterval(timer);
  timer = setInterval(refresh, config.refreshSeconds * 1000);
}

// ---------------------------------------------------------------------------
// Setup: validate what the form sent against the real APIs, then save.
// ---------------------------------------------------------------------------

async function applySetup(body) {
  // Blank cookie fields mean "keep the ones already saved".
  const espnIn = body.espn ?? {};
  const merged = {
    ...body,
    espn: {
      ...espnIn,
      s2: espnIn.s2?.trim() || config.espn?.s2 || '',
      swid: espnIn.swid?.trim() || config.espn?.swid || '',
    },
  };
  const next = normalizeConfig({ port: config.port, ...merged });
  const results = {};

  if (!isConfigured(next)) return { ok: false, results, error: 'Enter a Sleeper username, or ESPN league IDs plus cookies.' };

  if (next.sleeper) {
    results.sleeper = await probeSleeper(next.sleeper.username).catch((e) => ({ ok: false, error: e.message }));
  }
  if (next.espn) {
    const { season } = await getNflState();
    results.espn = await probeEspn(next.espn, season).catch((e) => ({ ok: false, error: e.message }));
  }
  const ok = Object.values(results).every((r) => r.ok);
  if (!ok) return { ok, results };

  writeConfig(DATA_DIR, next);
  config = next;
  schedule();
  await refresh();
  return { ok, results };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > limit) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
}

function serveStatic(res, rel) {
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (p === '/api/matchups') {
      if (url.searchParams.has('force')) await refresh();
      return json(res, 200, snapshot);
    }
    if (p === '/api/config') return json(res, 200, redactConfig(config));
    if (p === '/api/setup' && req.method === 'POST') {
      const result = await applySetup(await readBody(req));
      return json(res, result.ok ? 200 : 400, result);
    }
    if (p === '/') {
      if (!isConfigured(config)) { res.writeHead(302, { Location: '/setup' }); return res.end(); }
      return serveStatic(res, '/index.html');
    }
    if (p === "/setup") return serveStatic(res, "/setup.html");
    if (p === "/statfmt.js") {   // shared formatter, also used by the page
      res.writeHead(200, { "Content-Type": MIME[".js"], "Cache-Control": "no-store" });
      return fs.createReadStream(path.join(ROOT, "lib", "statfmt.js")).pipe(res);
    }
    return serveStatic(res, p);
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
});

function openBrowser(target) {
  if (process.env.NO_OPEN) return;
  const cmd = process.platform === 'darwin' ? `open "${target}"`
    : process.platform === 'win32' ? `start "" "${target}"`
    : `xdg-open "${target}"`;
  exec(cmd, () => {});
}

// Packaged app: if the launcher dies without a clean quit, don't linger holding the port.
if (process.env.FSBS_PARENT_WATCH) {
  const parent = process.ppid;
  setInterval(() => { try { process.kill(parent, 0); } catch { process.exit(0); } }, 2000).unref();
}

await refresh();
schedule();
server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Is Fantasy Side by Side already running? Try http://localhost:${PORT}`);
    process.exit(1);
  }
  throw e;
});
server.listen(PORT, "127.0.0.1", () => {
  const base = `http://localhost:${PORT}`;
  console.log(`fantasy-sidebyside → ${base}  (refresh every ${config.refreshSeconds}s)`);
  if (!isConfigured(config)) console.log('No config yet — opening the setup page.');
  openBrowser(isConfigured(config) ? base : `${base}/setup`);
});
