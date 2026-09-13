import fs from 'node:fs';
import path from 'node:path';

export function loadConfig(root) {
  const file = path.join(root, 'config.json');
  if (!fs.existsSync(file)) {
    console.error(`\nNo config.json found.\n  cp config.example.json config.json\nthen fill in your Sleeper username and/or ESPN cookies. See README.md.\n`);
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  cfg.refreshSeconds = Math.max(10, Number(cfg.refreshSeconds) || 30);
  cfg.port = Number(cfg.port) || 5050;

  const hasSleeper = cfg.sleeper?.username && !cfg.sleeper.username.startsWith('your_');
  const hasEspn = cfg.espn?.leagueIds?.length && cfg.espn.s2 && !cfg.espn.s2.startsWith('PASTE');
  if (!hasSleeper) delete cfg.sleeper;
  if (!hasEspn) delete cfg.espn;
  if (!cfg.sleeper && !cfg.espn) {
    console.error('config.json has neither a Sleeper username nor ESPN cookies + leagueIds configured.');
    process.exit(1);
  }
  return cfg;
}
