// Diffs the live stat feed between polls and hands each player's accumulated stat delta to the
// next points change for that player. The feed and the fantasy platforms are each 0–60 s apart,
// so a delta is held ("pending") until the points move, with a TTL so a stale delta can't be
// pinned on a play ten minutes later.
import { pickTracked, diffLines, sumDeltas, formatDelta, formatLine } from './statfmt.js';

const PENDING_TTL_MS = 10 * 60 * 1000;

export function createStatTracker() {
  let weekKey = null;
  let lastFeed = null;
  const last = new Map();      // playerKey -> { pos, line, updatedAt }
  const pending = new Map();   // playerKey -> { delta, since }

  return {
    // Once per refresh, before detectChanges. First sighting of a (week, player) seeds silently.
    // Returns the set of player keys whose stats moved this poll.
    ingest(feed, key, now = Date.now()) {
      const moved = new Set();
      if (feed === lastFeed) return moved;            // memo hit (forced refresh within a few seconds)
      lastFeed = feed;
      if (key !== weekKey) { last.clear(); pending.clear(); weekKey = key; }
      for (const [k, row] of feed) {
        const line = pickTracked(row.stats);
        const prev = last.get(k);
        last.set(k, { pos: row.pos, line, updatedAt: row.updatedAt });
        if (!prev) continue;
        const d = diffLines(prev.line, line);
        if (!d) continue;
        const p = pending.get(k);
        const fresh = p && now - p.since < PENDING_TTL_MS;
        pending.set(k, { delta: fresh ? sumDeltas(p.delta, d) : d, since: fresh ? p.since : now });
        moved.add(k);
      }
      for (const [k, p] of pending) if (now - p.since >= PENDING_TTL_MS) pending.delete(k);
      return moved;
    },

    // For a player whose points just moved: consume his pending delta. null = not in the feed.
    take(playerKey) {
      const cur = last.get(playerKey);
      if (!cur) return null;
      const p = pending.get(playerKey);
      pending.delete(playerKey);
      const delta = p?.delta ?? null;
      return {
        delta,
        text: (delta && formatDelta(cur.pos, delta)) || null,
        line: cur.line,
        lineText: formatLine(cur.pos, cur.line) || null,
        at: cur.updatedAt ?? null,
      };
    },
  };
}
