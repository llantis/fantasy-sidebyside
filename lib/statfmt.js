// Turns Sleeper stat lines into short text. Pure ES module: used by the server and the page.
//
//   formatDelta('WR', { rec: 1, rec_yd: 32, rec_td: 1 })  -> "+1 rec, +32 yds, TD"
//   formatLine('WR',  { rec: 5, rec_yd: 76, rec_td: 1 })  -> "5 rec · 76 yds · 1 TD"

const trim = (n) => String(Math.round(n * 10) / 10);
const sgn = (v) => (v < 0 ? '−' : '+') + trim(Math.abs(v));
// "TD", "2 TD", "−1 TD"
const count = (label, v) => (v === 1 ? label : `${v < 0 ? '−' : ''}${trim(Math.abs(v))} ${label}`);

// Display order. `keys` are summed; `when` can suppress a part given the whole delta (ctx.delta);
// `total` is the week-line rendering (null = never shown in the line).
export const PARTS = [
  { keys: ['pass_yd'],  delta: (v) => `${sgn(v)} pass yds`,                                   total: (v) => `${v} pass yds` },
  { keys: ['pass_td'],  delta: (v, c) => count(c.pos === 'QB' ? 'TD' : 'pass TD', v),         total: (v) => `${v} pass TD` },
  { keys: ['pass_int'], delta: (v) => count('INT', v),                                        total: (v) => `${v} INT` },
  { keys: ['rush_att'], delta: (v) => `${sgn(v)} car`,                                        total: (v) => `${v} car` },
  { keys: ['rush_yd'],  delta: (v, c) => `${sgn(v)} ${c.multi ? 'rush ' : ''}yds`,            total: (v, c) => `${v} ${c.pos === 'QB' ? 'rush ' : ''}yds` },
  { keys: ['rec_tgt'],  when: (c) => !c.delta.rec, delta: (v) => `${sgn(v)} tgt`,             total: null },
  { keys: ['rec'],      delta: (v) => `${sgn(v)} rec`,                                        total: (v) => `${v} rec` },
  { keys: ['rec_yd'],   delta: (v, c) => `${sgn(v)} ${c.multi ? 'rec ' : ''}yds`,             total: (v) => `${v} yds` },
  { keys: ['rush_td', 'rec_td'], delta: (v, c) => count(c.pos === 'QB' ? 'rush TD' : 'TD', v), total: (v, c) => `${v} ${c.pos === 'QB' ? 'rush ' : ''}TD` },
  { keys: ['pass_2pt', 'rush_2pt', 'rec_2pt'], delta: (v) => count('2PT', v),                total: null },
  { keys: ['fum_lost'], delta: (v) => count('fumble', v),                                     total: (v) => `${v} fum lost` },
  { keys: ['fum'],      when: (c) => !c.delta.fum_lost, delta: (v) => count('fumble (kept)', v), total: null },
  // kicking
  { keys: ['fgm'],      delta: (v, c) => (v === 1 && c.delta.fgm_yds > 0 ? `FG (${c.delta.fgm_yds})` : count('FG', v)),
                        total: (v, c) => `${v}/${c.line.fga ?? v} FG` },
  { keys: ['fgmiss'],   delta: (v) => count('FG miss', v),                                    total: null },
  { keys: ['xpm'],      delta: (v) => count('XP', v),                                         total: (v, c) => `${v}/${c.line.xpa ?? v} XP` },
  { keys: ['xpmiss'],   delta: (v) => count('XP miss', v),                                    total: null },
  // defense / special teams
  { keys: ['sack'],     delta: (v) => count('sack', v),                                       total: (v) => `${v} sack` },
  { keys: ['int'],      delta: (v) => count('INT', v),                                        total: (v) => `${v} INT` },
  { keys: ['fum_rec'],  delta: (v) => count('fumble rec', v),                                 total: (v) => `${v} FR` },
  { keys: ['ff'],       when: (c) => !c.delta.fum_rec, delta: (v) => count('forced fumble', v), total: null },
  { keys: ['def_td', 'def_st_td'], delta: (v) => count('TD', v),                              total: (v) => `${v} TD` },
  { keys: ['safe'],     delta: (v) => count('safety', v),                                     total: null },
  { keys: ['blk_kick'], delta: (v) => count('blocked kick', v),                               total: null },
  { keys: ['pts_allow'], delta: (v) => `${sgn(v)} pts allowed`,                               total: (v) => `${v} pts allowed` },
];

// Tracked but only used inside other parts' rendering.
const HELPER_KEYS = ['fgm_yds', 'fga', 'xpa'];
export const TRACKED_KEYS = new Set([...PARTS.flatMap((p) => p.keys), ...HELPER_KEYS]);

// Keep only tracked, numeric fields of a raw Sleeper stat object.
export function pickTracked(stats) {
  const out = {};
  for (const k of TRACKED_KEYS) if (typeof stats?.[k] === 'number') out[k] = stats[k];
  return out;
}

// Nonzero differences between two tracked lines, or null if nothing moved.
export function diffLines(prev, next) {
  const out = {};
  let any = false;
  for (const k of new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})])) {
    const d = Math.round(((next?.[k] ?? 0) - (prev?.[k] ?? 0)) * 10) / 10;
    if (d) { out[k] = d; any = true; }
  }
  return any ? out : null;
}

// Merge two deltas, dropping keys that net to zero. Either side may be null.
export function sumDeltas(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const s = Math.round(((out[k] ?? 0) + v) * 10) / 10;
    if (s) out[k] = s; else delete out[k];
  }
  return Object.keys(out).length ? out : null;
}

function render(pos, values, ctx, field, sep) {
  const parts = [];
  for (const p of PARTS) {
    if (!p[field]) continue;
    const v = p.keys.reduce((s, k) => s + (values[k] ?? 0), 0);
    if (!v) continue;
    if (field === 'delta' && p.when && !p.when(ctx)) continue;
    parts.push(p[field](Math.round(v * 10) / 10, ctx));
  }
  return parts.join(sep);
}

// "+1 rec, +32 yds, TD" — what changed. Empty string if nothing renderable changed.
export function formatDelta(pos, delta) {
  if (!delta) return '';
  const ctx = { pos, delta, line: {}, multi: Boolean(delta.rush_yd && delta.rec_yd) };
  return render(pos, delta, ctx, 'delta', ', ');
}

// "5 rec · 76 yds · 1 TD" — the week so far.
export function formatLine(pos, line) {
  if (!line) return '';
  const ctx = { pos, delta: {}, line, multi: Boolean(line.rush_yd && line.rec_yd) };
  return render(pos, line, ctx, 'total', ' · ');
}
