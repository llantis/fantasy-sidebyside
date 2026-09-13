// Helpers that operate on the normalized matchup shape shared by both adapters.
//
// Player: { id, name, pos, slot, team, points, projected, injury, game: { state, label, remaining, ... } }
// Side:   { teamName, owner, record, points, projected, livePace, winPct, starters: Player[] }

// "On pace" score: actual points banked so far plus the still-unplayed share of each
// starter's pre-game projection. A player at halftime with 8 pts and a 14-pt projection
// contributes 8 + 14 * 0.5 = 15.
export function livePace(starters) {
  let total = 0;
  for (const p of starters) {
    const remaining = p.game?.remaining ?? 0;
    total += (p.points ?? 0) + (p.projected ?? 0) * remaining;
  }
  return round1(total);
}

// Typical one-game standard deviation of fantasy points by position (PPR-ish).
// Scaled by sqrt(fraction of game remaining) so a player who is nearly done
// contributes almost no uncertainty.
const POS_SIGMA = { QB: 7.5, RB: 6.5, WR: 7, TE: 5.5, K: 4, DEF: 6 };

function remainingVariance(starters) {
  let v = 0;
  for (const p of starters) {
    const remaining = p.game?.remaining ?? 0;
    if (remaining <= 0) continue;
    const sigma = POS_SIGMA[p.pos] ?? 6;
    v += sigma * sigma * remaining;
  }
  return v;
}

// Standard normal CDF (Abramowitz & Stegun 7.1.26, accurate to ~1e-7).
function phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

// Probability (0..1) that `me` beats `opp` given current scores, remaining projections,
// and remaining volatility.
export function winProbability(me, opp) {
  if (!opp) return 1;
  const margin = me.livePace - opp.livePace;
  const variance = remainingVariance(me.starters) + remainingVariance(opp.starters);
  if (variance < 1e-6) return margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
  return phi(margin / Math.sqrt(variance));
}

export function sumProjected(starters) {
  return round1(starters.reduce((a, p) => a + (p.projected ?? 0), 0));
}

export function sumPoints(starters) {
  return round1(starters.reduce((a, p) => a + (p.points ?? 0), 0));
}

export function round1(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function finishSide(side) {
  side.projected = sumProjected(side.starters);
  side.livePace = side.nativePace != null ? round1(side.nativePace) : livePace(side.starters);
  side.paceSource = side.nativePace != null ? "platform" : "model";
  if (side.points == null) side.points = sumPoints(side.starters);
  side.points = round1(side.points);
  return side;
}

export function finishMatchup(m) {
  if (!m.me) return m;
  const native = m.me.nativeWinProb;
  if (native != null) {
    // ESPN reports this as 0..1 (older responses used 0..100; handle both).
    m.me.winPct = Math.round(native > 1 ? native : native * 100);
    m.me.winSource = "platform";
  } else {
    const p = winProbability(m.me, m.opp);
    const variance = remainingVariance(m.me.starters) + (m.opp ? remainingVariance(m.opp.starters) : 0);
    let pct = Math.round(p * 100);
    // While anything is still to be played, never claim a lock: cap the estimate at 1..99.
    if (variance > 1e-6) pct = Math.min(99, Math.max(1, pct));
    m.me.winPct = pct;
    m.me.winSource = "model";
  }
  if (m.opp) { m.opp.winPct = 100 - m.me.winPct; m.opp.winSource = m.me.winSource; }
  return m;
}

export function formatRecord(w, l, t) {
  if (w == null && l == null) return null;
  return `${w ?? 0}-${l ?? 0}${t ? `-${t}` : ''}`;
}
