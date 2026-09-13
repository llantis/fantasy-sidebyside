// Fantasy · Side by Side — page logic.
//
// The server (server.js) polls Sleeper / ESPN and keeps one snapshot. This file fetches that
// snapshot on the same interval and renders it. Data shapes are documented in lib/model.js.

'use strict';

// =============================================================================
// State & fetching
// =============================================================================

let snap = null;            // last snapshot from /api/matchups
let lastFetch = 0;          // Date.now() of the last successful fetch
let refreshSeconds = 30;    // taken from the snapshot; server decides the cadence
const prevPoints = new Map(); // player cell key -> last points, drives the score-change flash

async function load(force = false) {
  try {
    const r = await fetch('/api/matchups' + (force ? '?force=1' : ''), { cache: 'no-store' });
    snap = await r.json();
    refreshSeconds = snap.refreshSeconds || 30;
    lastFetch = Date.now();
    render();
  } catch (e) {
    document.getElementById('errors').textContent = 'Cannot reach local server: ' + e.message;
  }
}

// Once a second: update the "updated Xs ago / next in Ys" readout and trigger the next fetch.
function tick() {
  if (!snap) return;
  const ago = snap.updatedAt ? Math.max(0, Math.round((Date.now() - new Date(snap.updatedAt)) / 1000)) : null;
  document.getElementById('updated').textContent = ago == null ? '' : `updated ${ago}s ago`;
  const left = Math.max(0, refreshSeconds - Math.round((Date.now() - lastFetch) / 1000));
  document.getElementById('next').textContent = `next in ${left}s`;
  if (left === 0) load();
}

// =============================================================================
// Ordering
// =============================================================================

// Decides which league appears first on screen. Options worth considering:
//   - as configured (stable positions; you learn where each league lives)
//   - closest matchup first (smallest |my pace - opp pace|; the ones that need watching)
//   - biggest deficit first (where you're losing)
//   - most live players first (most action right now)
// Default: keep the server's order (Sleeper leagues, then ESPN, in config order).
function sortMatchups(matchups) {
  return matchups;
}

// =============================================================================
// Cross-league identity (Key / Controversial people)
// =============================================================================

// Players are matched across platforms by `p.key`, stamped by the server (see lib/model.js playerKey).

// Groups every starter across all matchups, then splits into three lists:
//   controversial — on your team in at least one league AND against you in at least one
//   mine          — on your team in 2+ leagues (and never against you)
//   theirs        — against you in 2+ leagues (and never on your team)
function crossLeaguePlayers(matchups) {
  const groups = new Map();
  for (const m of matchups) {
    if (m.error || !m.me) continue;
    const add = (p, side) => {
      if (!p || p.id?.startsWith('empty-')) return;
      const k = p.key;
      if (!groups.has(k)) groups.set(k, { player: p, mine: [], theirs: [] });
      const g = groups.get(k);
      if ((p.points ?? 0) > (g.player.points ?? 0)) g.player = p; // show the freshest-looking copy
      const teamName = side === 'me' ? m.me.teamName : m.opp.teamName;
      (side === 'me' ? g.mine : g.theirs).push({ league: m.leagueName, platform: m.platform, teamName });
    };
    m.me.starters.forEach((p) => add(p, 'me'));
    (m.opp?.starters ?? []).forEach((p) => add(p, 'opp'));
  }

  const controversial = [];
  const mine = [];
  const theirs = [];
  for (const g of groups.values()) {
    if (g.mine.length && g.theirs.length) controversial.push(g);
    else if (g.mine.length >= 2) mine.push(g);
    else if (g.theirs.length >= 2) theirs.push(g);
  }
  const byWeight = (a, b) =>
    (b.mine.length + b.theirs.length) - (a.mine.length + a.theirs.length) ||
    (b.player.points ?? 0) - (a.player.points ?? 0);
  controversial.sort(byWeight);
  mine.sort(byWeight);
  theirs.sort(byWeight);
  return { mine, controversial, theirs };
}

// =============================================================================
// Per-player display helpers
// =============================================================================

const fmt = (n) => (Math.round((n ?? 0) * 100) / 100).toFixed(2);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Points for a player who has not played yet: a dash, accounting-style, so a pre-game 0.00
// is not mistaken for a live goose egg.
function fmtPts(p) {
  const waiting = p.game?.state === 'pre' || p.game?.state === 'bye';
  return waiting && !(p.points > 0) ? '—' : fmt(p.points);
}

// An offensive player is "on the field" when his team has the ball; a defense when the
// other team does. Possession is unknown at halftime and between quarters, so nobody
// lights up then.
function onField(p) {
  const g = p.game || {};
  if (g.state !== 'in' || !g.onFieldKnown) return false;
  return p.pos === 'DEF' ? !g.hasBall : g.hasBall;
}

// CSS class for the status dot. See styles.css "status dots" for what each looks like.
function dotClass(p) {
  const g = p.game || { state: 'bye' };
  if (g.state !== 'in') return g.state;            // pre | post | bye
  return onField(p) ? (g.redZone ? 'on rz' : 'on') : 'in';
}

// Game clock text. Kickoff time is white; live clocks ramp with urgency:
// Q1–Q2 green, halftime + Q3 yellow, Q4 orange, red inside two minutes of Q4 or in overtime.
function gameLabel(g) {
  const txt = g.state === 'bye' ? (g.label || 'BYE') : (g.label || '');
  if (g.state === 'pre') return `<span class="gt">${esc(txt)}</span>`;
  if (g.state !== 'in') return esc(txt);
  const period = g.period ?? 0;
  const clock = g.clock ?? 0;
  let cls = 'q-early';
  if (/halftime/i.test(txt) || period === 3) cls = 'q-mid';
  else if (period === 4) cls = clock < 120 ? 'q-final' : 'q-late';
  else if (period >= 5) cls = 'q-final';
  return `<span class="gt ${cls}">${esc(txt)}</span>`;
}

// "POS · TEAM · clock · score · down & distance"
function subLine(p) {
  const g = p.game || { state: 'bye' };
  const score = g.state !== 'pre' && g.score ? ` · ${esc(g.score)}` : '';
  const dd = onField(p) && g.downDistance ? ` · ${esc(g.downDistance)}` : '';
  return `${esc(p.pos)}${p.team ? ' · ' + esc(p.team) : ''} · ${gameLabel(g)}${score}${dd}`;
}

// The player block used in lineup rows and in the people sections.
function playerBlock(p, extraCls = '', nameSuffix = '') {
  const g = p.game || { state: 'bye' };
  const cls = ['pl', extraCls, g.state === 'post' ? 'done' : '', g.state === 'pre' ? 'pre' : '', g.state === 'bye' ? 'bye' : '']
    .filter(Boolean).join(' ');
  const inj = p.injury ? ` <span class="inj">${esc(p.injury[0])}</span>` : '';
  return `<div class="${cls}">
    <span class="dot ${dotClass(p)}"></span>
    <div class="info">
      <div class="nm">${esc(p.name)}${inj}${nameSuffix}</div>
      <div class="sub">${subLine(p)}</div>
    </div>
    <div class="pts num"><span class="a">${fmtPts(p)}</span><span class="pj">proj ${fmt(p.projected)}</span></div>
  </div>`;
}

// =============================================================================
// Matchup cards
// =============================================================================

function playerCell(p, sideKey, cellKey) {
  if (!p) return '<td class="p"></td>';
  const prev = prevPoints.get(cellKey);
  let flash = '';
  if (prev != null && prev !== p.points) flash = p.points > prev ? ' flash' : ' flash down';
  prevPoints.set(cellKey, p.points);
  const rz = dotClass(p) === 'on rz' ? ' rz' : '';
  return `<td class="p${rz}${flash}">${playerBlock(p, sideKey)}</td>`;
}

function teamBlock(side, cls, isOpp) {
  if (!side) return `<div class="team ${cls}"><div class="tn">BYE</div></div>`;
  const rec = side.record ? `<span class="rec">${esc(side.record)}</span>` : '';
  const wpSrc = side.winSource === 'platform' ? 'ESPN' : 'EST';
  const wp = side.winPct == null ? '' :
    `<div class="wp num ${side.winPct >= 50 ? 'fav' : ''}">${side.winPct}%<small>WIN · ${wpSrc}</small></div>`;
  return `<div class="team ${cls}">
    <div class="tn">${isOpp ? rec : ''}${esc(side.teamName)}${isOpp ? '' : rec}</div>
    <div class="own">${esc(side.owner || '')}</div>
    <div class="pace">pace <b class="num">${fmt(side.livePace)}</b> · proj <span class="num">${fmt(side.projected)}</span></div>
    ${wp}
  </div>`;
}

function card(m) {
  const head = `<div class="title"><span class="badge ${m.platform}">${m.platform}</span><span class="name">${esc(m.leagueName)}</span><span class="wk">Week ${m.week ?? ''}</span></div>`;
  if (m.error || !m.me) return `<div class="card error">${head}<div class="body">${esc(m.error || 'No matchup data')}</div></div>`;

  const me = m.me;
  const op = m.opp;
  const opPts = op ? op.points : 0;
  const lead = me.points === opPts ? '' : me.points > opPts ? 'win' : 'lose';
  const oppLead = lead === 'win' ? 'lose' : lead === 'lose' ? 'win' : '';
  const paceDiff = op ? me.livePace - op.livePace : null;

  const rows = Math.max(me.starters.length, op ? op.starters.length : 0);
  let body = '';
  for (let i = 0; i < rows; i++) {
    const a = me.starters[i];
    const b = op && op.starters[i];
    const slot = (a && a.slot) || (b && b.slot) || '';
    body += `<tr>${playerCell(a, 'me', `${m.platform}|${m.leagueId}|me|${a?.id}`)}` +
            `<td class="slot">${esc(slot)}</td>` +
            `${playerCell(b, 'opp', `${m.platform}|${m.leagueId}|opp|${b?.id}`)}</tr>`;
  }

  const wpBar = me.winPct == null ? '' :
    `<div class="wpbar" title="win probability"><div class="l" style="width:${me.winPct}%"></div><div class="r"></div></div>`;
  const delta = paceDiff == null ? '' :
    `<div class="delta num">${paceDiff >= 0 ? 'ahead' : 'behind'} by ${fmt(Math.abs(paceDiff))} on pace</div>`;

  return `<div class="card">
    ${head}
    <div class="scoreboard">
      ${teamBlock(me, 'me', false)}
      <div>
        <div class="score">
          <span class="pts num ${lead}">${fmt(me.points)}</span>
          <span class="vs">vs</span>
          <span class="pts num ${oppLead}">${op ? fmt(op.points) : '—'}</span>
        </div>
        ${delta}
      </div>
      ${teamBlock(op, 'opp', true)}
    </div>
    ${wpBar}
    <table>${body}</table>
  </div>`;
}

// =============================================================================
// Key / Controversial sections
// =============================================================================

function personRow(g) {
  const p = g.player;
  const chips = [
    ...g.mine.map((a) => `<span class="chip me"><b>you</b> · ${esc(a.league)}</span>`),
    ...g.theirs.map((a) => `<span class="chip opp"><b>vs</b> · ${esc(a.league)} (${esc(a.teamName)})</span>`),
  ].join('');
  const cnt = [
    g.mine.length ? `for you ×${g.mine.length}` : '',
    g.theirs.length ? `against you ×${g.theirs.length}` : '',
  ].filter(Boolean).join(' · ');
  const rz = dotClass(p) === 'on rz' ? ' rz' : '';
  return `<tr>
    <td class="who${rz}">${playerBlock(p, '', `<span class="cnt">${cnt}</span>`)}</td>
    <td class="lg">${chips}</td>
  </tr>`;
}

function section(title, hint, list, emptyText) {
  const body = list.length ? `<table>${list.map(personRow).join('')}</table>` : `<div class="none">${esc(emptyText)}</div>`;
  return `<div class="card sec"><div class="title"><span class="name">${esc(title)}</span><span class="hint">${esc(hint)}</span></div>${body}</div>`;
}

// =============================================================================
// Recent changes feed
// =============================================================================

const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
const hhmm = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function changeRow(e) {
  const chips = e.appearances.map((a) => {
    const good = a.impact > 0, bad = a.impact < 0;
    const who = a.side === 'me' ? 'you' : `vs ${esc(a.teamName)}`;
    return `<span class="chip ${a.side}"><b class="num ${good ? 'up' : bad ? 'down' : ''}">${signed(a.impact)}</b> · ${who} · ${esc(a.league)}</span>`;
  }).join('');
  const net = e.appearances.length > 1
    ? `<div class="net num ${e.netImpact > 0 ? 'up' : e.netImpact < 0 ? 'down' : ''}">net ${signed(e.netImpact)}</div>` : '';
  const rz = dotClass(e) === 'on rz' ? ' rz' : '';
  return `<tr>
    <td class="when num">${hhmm(e.at)}</td>
    <td class="delta-cell num ${e.delta > 0 ? 'up' : 'down'}">${signed(e.delta)}</td>
    <td class="who${rz}">${playerBlock(e)}</td>
    <td class="lg">${chips}${net}</td>
  </tr>`;
}

function changesSection(list) {
  const rows = list.slice(0, 40).map(changeRow).join('');
  const body = rows ? `<table>${rows}</table>` : '<div class="none">No scoring changes yet since the app started. They appear here as points come in.</div>';
  return `<div class="card sec changes"><div class="title"><span class="name">Recent changes</span><span class="hint">newest first · effect on your margin in each league</span></div>${body}</div>`;
}

// =============================================================================
// Render
// =============================================================================

function render() {
  if (!snap) return;
  document.getElementById('week').textContent = snap.week ? `${snap.season} · Week ${snap.week}` : '';
  document.getElementById('errors').textContent = (snap.errors || []).join('  ·  ');

  const list = sortMatchups([...(snap.matchups || [])]);
  document.getElementById('main').innerHTML = list.length
    ? list.map(card).join('')
    : '<div class="empty">No matchups found. Check config.json.</div>';

  const { mine, controversial, theirs } = crossLeaguePlayers(list);
  document.getElementById('people').innerHTML =
    section('My key players', 'on your team in 2+ leagues', mine,
      'No player is on your team in more than one league this week.') +
    section('Controversial', 'on your team in one league, against you in another', controversial,
      'Nobody is both for you and against you this week.') +
    section('Enemy key players', 'against you in 2+ leagues', theirs,
      'No opponent starts the same player against you in more than one league this week.');
  document.getElementById('changes').innerHTML = changesSection(snap.changes || []);
}

document.getElementById('refreshBtn').addEventListener('click', () => load(true));
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
load();
setInterval(tick, 1000);
