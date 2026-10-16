// RIVERS — a man on his own errand (a villager going to his work, a carrier, a ploughman, a crew's builder) and the water
// he cannot wade (docs/crossings.md "Men on their own errands"). The owner (2026-10-03): "Some units just get stuck in
// rivers when they should build a bridge."
//
// Why: a company's orders go by the nav grid (path.js, crossings.js), but the villagers' own walks — economy.js's spot
// work and hauling, labor.js's task steps — went STRAIGHT at the place, through whatever lay between. On the live realm
// Thornby's men waded the River Harrow (1.8–2.5 m) to their fields on the far bank every day, the fishers stood in it to
// their chins, and any man who met the water stood in it until his task gave up.
//
// Now, per man, a waypoint (way): a straight walk that meets water deeper than a man can wade (WADE.foot, 1.1 m) goes by
// the nav grid's route instead — over a ford, a bridge on the map, a bridge the men made; a place IN the water (a fishing
// spot, a work spot on a bridge's line) is its bank on his side; a man standing in deep water makes for the nearest bank
// first. With no way over at all he walks to the bank and stands there (the caller gives the task up), and the reeve hears
// of it: a crossing his men want, or one they must go far round for, is a bridge he builds (bridges.js).
//
// Pure in its inputs: the memo kept on the man ([tx, ty, sig, mode, i, x0, y0, …]) is saved with him; w.riverSig changes
// whenever a crossing is made or burnt, and every memo is planned again.
import { findPath, wetBetween, WADE } from "./path.js";

export const LIM = WADE.foot; // m: deeper than this a man on foot swims (world.goingMul: > 1.3 m he is swimming)
const DRY = 0.5;              // m: shallower than this is the bank, not the river
const MEMO_TOL = 8;           // m: a place moved less than this keeps the way worked out
export const DETOUR = 1.6;    // a way round more than this × the straight walk (+ 150 m) is a crossing the reeve hears of
const DETOUR_ADD = 150;

export const deep = (w, x, y) => w.map.water(x, y) > LIM;

// Does the straight walk a → b meet water a man cannot wade? (sampled every 3 m: path.wetBetween — a deck the men laid is
// dry ground, the water under it gone. The land's coarse nav cells were tried as a shortcut and missed the narrow becks.)
export const wetLine = (w, ax, ay, bx, by) => wetBetween(w.map, "foot", ax, ay, bx, by);

// the nearest dry ground to (x, y) — the bank a man in the water makes for (ties: the one toward where he is going)
export function bankNear(w, x, y, tx = x, ty = y) {
  const map = w.map, a0 = Math.atan2(ty - y, tx - x);
  let first = -1, best = null, bs = Infinity;
  for (let r = 1.5; r <= 80; r += 1.5) {
    if (first >= 0 && r > first + 6) break; // (the nearest bank, or one a few metres further that lies his way)
    const n = Math.max(12, Math.round(r * 1.2));
    for (let k = 0; k < n; k++) {
      const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2 * Math.PI / n, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (map.inBounds && !map.inBounds(px, py)) continue;
      if (map.water(px, py) > DRY) continue;
      if (first < 0) first = r;
      const sc = r + 0.25 * Math.hypot(tx - px, ty - py);
      if (sc < bs) { bs = sc; best = [px, py]; }
    }
  }
  return best;
}
// a place in the water: its bank on the side of (fx, fy) — the last dry ground on the way from him to it
export function bankToward(w, tx, ty, fx, fy) {
  const map = w.map, d = Math.hypot(tx - fx, ty - fy), n = Math.max(1, Math.ceil(d));
  for (let s = 1; s <= n; s++) { const x = tx + (fx - tx) * s / n, y = ty + (fy - ty) * s / n; if (map.water(x, y) <= DRY) return [x, y]; }
  return bankNear(w, tx, ty, fx, fy) || [fx, fy];
}
// the last ground he can stand on, walking straight from a toward b
export function bankBefore(w, ax, ay, bx, by) {
  const map = w.map, d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(d / 1.5)); let last = [ax, ay];
  for (let s = 1; s <= n; s++) { const p = [ax + (bx - ax) * s / n, ay + (by - ay) * s / n]; if (map.water(p[0], p[1]) > DRY) break; last = p; }
  return last;
}
// where the straight walk a → b first meets deep water (the crossing it wants), or null
export function wetPoint(w, ax, ay, bx, by) {
  const map = w.map, d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(d / 3));
  for (let s = 0; s <= n; s++) { const x = ax + (bx - ax) * s / n, y = ay + (by - ay) * s / n; if (map.water(x, y) > LIM) return [x, y]; }
  return null;
}
const pathLen = (x, y, pts) => { let s = 0, a = [x, y]; for (const b of pts) { s += Math.hypot(b[0] - a[0], b[1] - a[1]); a = b; } return s; };

// The waypoint a man at (x, y) walks to on his way to (tx, ty): [x, y] (with .stop when he can get no nearer than it), or
// null — straight on. memo: an array kept on the man (labor.js M.rw, economy.js u.rw per man).
export function way(w, team, x, y, tx, ty, memo) {
  if (!w.map?.water) return null;
  if (w.map.water(x, y) > LIM) { memo.length = 0; return bankNear(w, x, y, tx, ty); } // (in the river: out, the nearest bank first)
  const sig = w.riverSig | 0;
  if (!(memo.length >= 5 && memo[2] === sig && Math.abs(memo[0] - tx) + Math.abs(memo[1] - ty) < MEMO_TOL) && !retarget(w, x, y, tx, ty, memo, sig)) plan(w, team, x, y, tx, ty, memo, sig);
  const mode = memo[3]; if (!mode) return null;
  const n = (memo.length - 5) / 2; let i = memo[4];
  while (i < n - 1 && Math.hypot(memo[5 + 2 * i] - x, memo[6 + 2 * i] - y) < 3) i++;
  memo[4] = i;
  const px = memo[5 + 2 * i], py = memo[6 + 2 * i], last = i === n - 1;
  if (last && mode === 1 && Math.hypot(px - x, py - y) < 3) return null; // (the route's end is the place: straight on)
  const out = [px, py]; if (last && mode === 2) out.stop = true;
  return out;
}
// the place moved a little (a man's next stretch of the furrow, the next tree): the way stands if the new place lies in a
// dry line from where the old way ended (or, going straight, from him) — no new route for every step of the work
function retarget(w, x, y, tx, ty, memo, sig) {
  if (memo.length < 5 || memo[2] !== sig || Math.hypot(memo[0] - tx, memo[1] - ty) > 40 || w.map.water(tx, ty) > LIM) return false;
  const mode = memo[3];
  if (mode === 0) { if (wetLine(w, x, y, tx, ty)) return false; memo[0] = tx; memo[1] = ty; return true; }
  if (mode !== 1) return false;
  const n = (memo.length - 5) / 2, k = n >= 2 ? n - 2 : -1, ax = k >= memo[4] && k >= 0 ? memo[5 + 2 * k] : x, ay = k >= memo[4] && k >= 0 ? memo[6 + 2 * k] : y;
  if (wetLine(w, ax, ay, tx, ty)) return false;
  memo[0] = tx; memo[1] = ty; memo[memo.length - 2] = tx; memo[memo.length - 1] = ty; return true;
}
// the nav grid's route between two grid nodes, kept on the world (never saved: w._rvPaths) — the men of a crew going from
// the vill to the same far field share it. Pure in its key (the nodes, the crossings, the walls), so a restored world finds
// the same routes. → [[x, y], …] | null
const navKey = (nav, x, y) => { const i = Math.round((x - nav.ox) / nav.cellM), j = Math.round((y - nav.oy) / nav.cellM); return i < 0 || j < 0 || i >= nav.n || j >= nav.n ? -1 : j * nav.n + i; };
// the grid the men's walks are planned on: the land and the crossings made over it (nav.base: no walls — the walls are
// wallnav.js's, which lays the walk by the gates — and no houses: a man steps round a house, obstacles.js)
function landNav(w) {
  const nav = w.nav; if (!nav.base?.foot) return nav;
  if (!w._rvNav || w._rvNav.src !== nav || w._rvNav.base !== nav.base.foot) Object.defineProperty(w, "_rvNav", { value: { src: nav, base: nav.base.foot, nav: { ...nav, classes: { ...nav.classes, foot: nav.base.foot } } }, enumerable: false, writable: true, configurable: true });
  return w._rvNav.nav;
}
function sharedPath(w, x, y, gx, gy) {
  const nav = landNav(w), C = nav.classes.foot, s = navKey(nav, x, y), g = navKey(nav, gx, gy);
  if (s < 0 || g < 0 || !isFinite(C[s]) || !isFinite(C[g])) return null;
  const sx = nav.ox + (s % nav.n) * nav.cellM, sy = nav.oy + ((s / nav.n) | 0) * nav.cellM, ex = nav.ox + (g % nav.n) * nav.cellM, ey = nav.oy + ((g / nav.n) | 0) * nav.cellM;
  if (wetLine(w, x, y, sx, sy) || wetLine(w, ex, ey, gx, gy)) return null; // (his own cell's corner across the water from him)
  if (!w._rvPaths) Object.defineProperty(w, "_rvPaths", { value: new Map(), enumerable: false, writable: true });
  const key = `${s}:${g}:${w.riverSig | 0}`, M = w._rvPaths;
  if (M.has(key)) return M.get(key);
  if (M.size > 600) M.clear();
  const p = findPath(nav, "foot", sx, sy, ex, ey); STATS.paths++;
  const out = p && p.length && Math.hypot(p[p.length - 1][0] - ex, p[p.length - 1][1] - ey) < 30 ? p.map((q) => [q[0], q[1]]) : false;
  M.set(key, out); return out;
}
export const STATS = { plans: 0, paths: 0 };
function plan(w, team, x, y, tx, ty, memo, sig) {
  STATS.plans++;
  memo.length = 0; memo.push(tx, ty, sig, 0, 0);
  let gx = tx, gy = ty, inWater = false;
  if (w.map.water(tx, ty) > LIM) { [gx, gy] = bankToward(w, tx, ty, x, y); inWater = true; } // (a fishing spot, a stake on a bridge's line)
  if (!wetLine(w, x, y, gx, gy)) { if (inWater) memo.push(gx, gy), memo[3] = 2; return; }
  let p = null;
  if (w.nav) {
    const sh = sharedPath(w, x, y, gx, gy);
    if (sh === false) p = null; // (no way between those nodes: known)
    else if (sh) { p = sh.slice(); if (Math.hypot(p[p.length - 1][0] - gx, p[p.length - 1][1] - gy) > 1) p.push([gx, gy]); }
    else { p = findPath(landNav(w), "foot", x, y, gx, gy); STATS.paths++; }
  }
  const end = p?.length ? p[p.length - 1] : null;
  if (end && Math.hypot(end[0] - gx, end[1] - gy) < 30 && dryRoute(w, x, y, p)) {
    memo[3] = inWater ? 2 : 1;
    for (const q of p) memo.push(q[0], q[1]);
    if (inWater && Math.hypot(end[0] - gx, end[1] - gy) > 1) memo.push(gx, gy);
    const L = pathLen(x, y, p), s = Math.hypot(gx - x, gy - y);
    if (L > s * DETOUR + DETOUR_ADD) need(w, team, x, y, gx, gy, L);
    return;
  }
  // no way over: he goes to the bank and stands there (his task is given up); the reeve hears of the crossing wanted
  const b = bankBefore(w, x, y, gx, gy); memo[3] = 2; memo.push(b[0], b[1]);
  need(w, team, x, y, gx, gy, -1);
}
// every leg of the route clear of deep water (a leg that cuts a bank's corner is let pass: < 6 m of it)
function dryRoute(w, x, y, pts) {
  let a = [x, y];
  for (const b of pts) {
    if (wetLine(w, a[0], a[1], b[0], b[1])) {
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(d / 2)); let wet = 0;
      for (let s = 0; s <= n; s++) if (w.map.water(a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n) > LIM) wet += d / n;
      if (wet > 6) return false;
    }
    a = b;
  }
  return true;
}

// ---------------------------------------------------------------- the crossings the men want (read by the reeve: bridges.js)
// w.riverNeed: [{ team, x, y (where the straight way meets the water), ax, ay, bx, by (the last walk that wanted it), n (walks),
// t (last), round (m of the way round, -1 none) }] — near ones are one entry; old ones are forgotten
const NEED_R = 150, NEED_FORGET = 1800; // m; real s
export function need(w, team, ax, ay, bx, by, round) {
  if (team === undefined || team < 0) return;
  const P = wetPoint(w, ax, ay, bx, by) || [(ax + bx) / 2, (ay + by) / 2];
  const N = (w.riverNeed ||= []);
  for (let k = N.length - 1; k >= 0; k--) if (w.time - N[k].t > NEED_FORGET) N.splice(k, 1);
  const e = N.find((q) => q.team === team && Math.hypot(q.x - P[0], q.y - P[1]) < NEED_R);
  if (e) { e.n++; e.t = w.time; e.ax = ax; e.ay = ay; e.bx = bx; e.by = by; e.round = round; return e; }
  if (N.length >= 64) N.shift();
  const q = { team, x: P[0], y: P[1], ax, ay, bx, by, n: 1, t: w.time, t0: w.time, round };
  N.push(q); return q;
}
// a crossing made or burnt: every man's way is worked out again
export function changed(w) { w.riverSig = ((w.riverSig | 0) + 1) | 0; }

// the men standing in water they cannot wade (a man on a horse: 1.3 m) → [{ id, unit, x, y, d }]
export function wetMen(w) {
  const out = [], S = w.S, map = w.map;
  for (const u of w.units.values()) for (const id of u.members) {
    if (!S.alive[id]) continue;
    const d = map.water(S.x[id], S.y[id]); if (d > (u.mounted || S.horse?.[id] ? WADE.cavalry : LIM)) out.push({ id, unit: u.id, team: u.team, x: S.x[id], y: S.y[id], d });
  }
  return out;
}
// one-time repair (server/migrate.mjs): every man standing in deep water put on the nearest bank → how many
export function landWetMen(w) {
  let n = 0; const S = w.S;
  for (const m of wetMen(w)) {
    const b = bankNear(w, m.x, m.y); if (!b) continue;
    S.x[m.id] = b[0]; S.y[m.id] = b[1]; if (S.slotX) { S.slotX[m.id] = b[0]; S.slotY[m.id] = b[1]; } n++;
    const M = w.labor?.men.get(m.id); if (M) { M.rw = []; M.via = null; }
  }
  return n;
}

// where a man building a timber bridge (bridges.js) stands: on its near bank about the end the trestles go in from, never in
// the river (r1, r2, ph: his own hashes, as economy.spotFor makes them) → [x, y]
export function bridgeSpot(b, r1, r2, ph) {
  const L = Math.hypot(b.x2 - b.x1, b.y2 - b.y1) || 1, ux = (b.x2 - b.x1) / L, uy = (b.y2 - b.y1) / L;
  const back = 1 + r1 * 7 + Math.sin(ph * 6.283) * 0.6, side = (r2 - 0.5) * 12;
  return [b.x1 - ux * back - uy * side, b.y1 - uy * back + ux * side];
}
