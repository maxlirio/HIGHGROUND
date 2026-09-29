// Reference-counted closures of nav-grid cells. Several things can close the same 25 m cell: a wall
// stretch, the flank of a gate, the gate itself when it is shut. Each owner registers the cells it closes
// under its own key, and a cell opens again only when no owner holds it any more. Its original costs are
// restored at that point. A breach reopens only the cells of the broken modules, and only if nothing else
// holds them.
//
// syncFeatureNav (features.js) saves and restores its own multipliers, so it can overwrite a closed cell
// with a stale value. navReassert() closes every held cell again and runs after each feature sync.

function state(w) { return w.navBlk || (w.navBlk = { byKey: new Map(), cnt: new Map(), saved: new Map() }); }

export function navSetBlock(w, key, cells) {
  const nav = w.nav; if (!nav) return;
  const B = state(w), old = B.byKey.get(key) || [];
  const next = cells ? [...new Set(cells)] : [];
  const nextSet = new Set(next), oldSet = new Set(old);
  for (const k of old) if (!nextSet.has(k)) {
    const c = (B.cnt.get(k) || 1) - 1;
    if (c > 0) { B.cnt.set(k, c); continue; }
    B.cnt.delete(k);
    const sv = B.saved.get(k); B.saved.delete(k);
    if (sv) for (const cls in sv) nav.classes[cls][k] = sv[cls];
  }
  for (const k of next) if (!oldSet.has(k)) {
    const c = B.cnt.get(k) || 0;
    if (!c) { const sv = {}; for (const cls in nav.classes) { sv[cls] = nav.classes[cls][k]; nav.classes[cls][k] = Infinity; } B.saved.set(k, sv); }
    B.cnt.set(k, c + 1);
  }
  if (next.length) B.byKey.set(key, next); else B.byKey.delete(key);
}

export function navReassert(w) {
  const B = w.navBlk, nav = w.nav; if (!B || !nav) return;
  for (const k of B.cnt.keys()) for (const cls in nav.classes) nav.classes[cls][k] = Infinity;
}
export const navHeld = (w, k) => !!w.navBlk?.cnt.has(k);

// cells a segment passes through (sampled at half a cell), skipping the keys in `skip` (a gate passage
// keeps its own cell open)
export const cellOf = (w, x, y) => { const c = w.nav.cellM; return Math.round(y / c) * w.nav.n + Math.round(x / c); };
export function segCells(w, x1, y1, x2, y2, skip = null) {
  const nav = w.nav; if (!nav) return [];
  const n = nav.n, c = nav.cellM, L = Math.hypot(x2 - x1, y2 - y1), steps = Math.max(1, Math.ceil(L / (c * 0.5)));
  const out = new Set();
  for (let s = 0; s <= steps; s++) {
    const x = x1 + (x2 - x1) * s / steps, y = y1 + (y2 - y1) * s / steps;
    const i = Math.round(x / c), j = Math.round(y / c), k = j * n + i; if (k < 0 || k >= n * n) continue;
    if (skip && skip.has(k)) continue;
    out.add(k);
  }
  return [...out];
}
