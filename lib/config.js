import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_FILE = 'config.json';
const PLACEHOLDER = /^(your_|PASTE)/;

// Turn whatever is in config.json (or the setup form) into a clean config object.
// Platforms with missing or placeholder values are dropped, so `isConfigured` is meaningful.
export function normalizeConfig(raw = {}) {
  const cfg = {
    port: Number(raw.port) || 5050,
    refreshSeconds: Math.max(10, Number(raw.refreshSeconds) || 30),
  };
  const s = raw.sleeper;
  if (s?.username && !PLACEHOLDER.test(s.username)) {
    cfg.sleeper = { username: String(s.username).trim(), leagueIds: toList(s.leagueIds).map(String) };
  }
  const e = raw.espn;
  const leagueIds = toList(e?.leagueIds).map(Number).filter(Boolean);
  if (e?.s2 && e?.swid && leagueIds.length && !PLACEHOLDER.test(e.s2)) {
    cfg.espn = {
      s2: String(e.s2).trim(),
      swid: String(e.swid).trim(),
      leagueIds,
      teamId: e.teamId != null && e.teamId !== '' ? Number(e.teamId) : null,
    };
  }
  return cfg;
}

export const isConfigured = (cfg) => Boolean(cfg.sleeper || cfg.espn);

export function readConfig(root) {
  const file = path.join(root, CONFIG_FILE);
  if (!fs.existsSync(file)) return normalizeConfig();
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    console.warn(`config.json could not be parsed (${e.message}); starting unconfigured.`);
    return normalizeConfig();
  }
}

export function writeConfig(root, cfg) {
  const out = { port: cfg.port, refreshSeconds: cfg.refreshSeconds };
  if (cfg.sleeper) out.sleeper = cfg.sleeper;
  if (cfg.espn) out.espn = cfg.espn;
  fs.writeFileSync(path.join(root, CONFIG_FILE), JSON.stringify(out, null, 2) + '\n');
}

// What the setup page is allowed to see: everything except the cookie values.
export function redactConfig(cfg) {
  return {
    configured: isConfigured(cfg),
    refreshSeconds: cfg.refreshSeconds,
    sleeper: cfg.sleeper ? { username: cfg.sleeper.username, leagueIds: cfg.sleeper.leagueIds } : null,
    espn: cfg.espn ? { leagueIds: cfg.espn.leagueIds, teamId: cfg.espn.teamId, hasCookies: true } : null,
  };
}

// Accepts an array or a comma/space/newline separated string.
function toList(v) {
  if (Array.isArray(v)) return v.filter((x) => x !== '' && x != null);
  if (typeof v === 'string') return v.split(/[\s,]+/).filter(Boolean);
  return [];
}
