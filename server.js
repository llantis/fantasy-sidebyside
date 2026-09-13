import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './lib/config.js';
import { getNflState } from './lib/nfl.js';
import { getSleeperMatchups } from './lib/sleeper.js';
import { getEspnMatchups } from './lib/espn.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const config = loadConfig(ROOT);
const CACHE_DIR = path.join(ROOT, '.cache');
const REFRESH_MS = config.refreshSeconds * 1000;

let snapshot = { updatedAt: null, season: null, week: null, refreshSeconds: config.refreshSeconds, matchups: [], errors: ['starting up…'] };
let inFlight = null;

async function refresh() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const errors = [];
    try {
      const nfl = await getNflState();
      const jobs = [];
      if (config.sleeper) jobs.push(getSleeperMatchups(config.sleeper, nfl, CACHE_DIR).catch((e) => { errors.push(`Sleeper: ${e.message}`); return []; }));
      if (config.espn) jobs.push(getEspnMatchups(config.espn, nfl).catch((e) => { errors.push(`ESPN: ${e.message}`); return []; }));
      const matchups = (await Promise.all(jobs)).flat();
      snapshot = { updatedAt: new Date().toISOString(), season: nfl.season, week: nfl.week, refreshSeconds: config.refreshSeconds, matchups, errors };
    } catch (e) {
      errors.push(`NFL scoreboard: ${e.message}`);
      snapshot = { ...snapshot, errors };
    }
    if (errors.length) console.warn(`[${new Date().toLocaleTimeString()}]`, errors.join(' | '));
    else console.log(`[${new Date().toLocaleTimeString()}] refreshed ${snapshot.matchups.length} matchup(s)`);
  })().finally(() => { inFlight = null; });
  return inFlight;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/matchups') {
    if (url.searchParams.has('force')) await refresh();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(snapshot));
  }
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(ROOT, 'public', path.normalize(rel));
  if (!file.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(file)) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

await refresh();
setInterval(refresh, REFRESH_MS);
server.listen(config.port, '127.0.0.1', () => {
  console.log(`fantasy-sidebyside → http://localhost:${config.port}  (refresh every ${config.refreshSeconds}s)`);
});
