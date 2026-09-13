// Setup page: prefill from the saved config (cookies never come back from the server),
// send the form to /api/setup, show what the server verified, then go to the dashboard.

'use strict';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function syncSections() {
  $('sleeperBody').classList.toggle('hidden', !$('useSleeper').checked);
  $('espnBody').classList.toggle('hidden', !$('useEspn').checked);
}
$('useSleeper').addEventListener('change', syncSections);
$('useEspn').addEventListener('change', syncSections);

async function prefill() {
  const c = await (await fetch('/api/config', { cache: 'no-store' })).json();
  $('refresh').value = c.refreshSeconds ?? 30;
  $('useSleeper').checked = Boolean(c.sleeper);
  $('useEspn').checked = Boolean(c.espn);
  if (!c.configured) { $('useSleeper').checked = true; $('useEspn').checked = true; $('backLink').classList.add('hidden'); }
  if (c.sleeper) {
    $('sleeperUser').value = c.sleeper.username;
    $('sleeperLeagues').value = (c.sleeper.leagueIds ?? []).join(', ');
  }
  if (c.espn) {
    $('espnLeagues').value = (c.espn.leagueIds ?? []).join(', ');
    $('espnTeam').value = c.espn.teamId ?? '';
    if (c.espn.hasCookies) {
      $('espnS2').placeholder = 'saved — leave blank to keep the current cookie';
      $('espnSwid').placeholder = 'saved — leave blank to keep';
    }
  }
  syncSections();
}

function renderResult(r) {
  const parts = [];
  if (r.error) parts.push(`<div class="bad">✗ ${esc(r.error)}</div>`);
  const s = r.results?.sleeper;
  if (s) {
    parts.push(s.ok
      ? `<div class="ok">✓ Sleeper: ${esc(s.username)} — ${s.leagues.length} league(s)</div><ul>${s.leagues.map((l) => `<li>${esc(l.name)}</li>`).join('')}</ul>`
      : `<div class="bad">✗ Sleeper: ${esc(s.error)}</div>`);
  }
  const e = r.results?.espn;
  if (e) {
    if (e.error) parts.push(`<div class="bad">✗ ESPN: ${esc(e.error)}</div>`);
    for (const l of e.leagues ?? []) {
      parts.push(l.ok
        ? `<div class="ok">✓ ESPN: ${esc(l.name)} — your team is “${esc(l.teamName)}”</div>`
        : `<div class="bad">✗ ESPN league ${esc(l.id)}: ${esc(l.error)}</div>`);
    }
  }
  $('result').innerHTML = parts.join('');
}

$('form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const body = { refreshSeconds: Number($('refresh').value) || 30 };
  if ($('useSleeper').checked) body.sleeper = { username: $('sleeperUser').value, leagueIds: $('sleeperLeagues').value };
  if ($('useEspn').checked) body.espn = { leagueIds: $('espnLeagues').value, s2: $('espnS2').value, swid: $('espnSwid').value, teamId: $('espnTeam').value };

  $('save').disabled = true;
  $('status').textContent = 'Checking with Sleeper / ESPN…';
  $('result').innerHTML = '';
  try {
    const r = await fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    renderResult(data);
    if (data.ok) {
      $('status').textContent = 'Saved. Opening your dashboard…';
      setTimeout(() => { location.href = '/'; }, 1200);
    } else {
      $('status').textContent = 'Fix the items marked ✗ and try again.';
    }
  } catch (e) {
    $('status').textContent = 'Could not reach the local server: ' + e.message;
  } finally {
    $('save').disabled = false;
  }
});

prefill();
