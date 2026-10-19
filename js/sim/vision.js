// Fog of war: what each team can see, with real line of sight over the heightfield.
// Grid values: 0 = never seen, 1 = explored (remembered), 2 = visible now.
// Observers on high ground see much further (horizon + no terrain masking) — that is the point.
import { ARM_BY_ID } from "./arms.js";
import { WEATHER } from "./terrain-types.js";

export function makeVision(map, cellM = 20) {
  const n = Math.ceil(map.size / cellM);
  return { n, cellM, ox: map.x0 || 0, oy: map.y0 || 0, teams: [new Uint8Array(n * n), new Uint8Array(n * n)], every: 10 };
}
// the fog cell under (x, y) (k = j·n + i; −1 off the grid). The grid covers the map's extent from (ox, oy).
export const visIdx = (V, x, y) => { const i = ((x - (V.ox || 0)) / V.cellM) | 0, j = ((y - (V.oy || 0)) / V.cellM) | 0; return i >= 0 && j >= 0 && i < V.n && j < V.n ? j * V.n + i : -1; };
// cells made visible on the last pass, per team (not saved: a restored world scans its grids once instead)
const lit = new WeakMap();

// blockers(x,y) → extra obstruction height (forest canopy, buildings); optional.
// spread: the pass's observers are cast a share a tick across its `every` ticks (the realm box: the whole pass in one tick
// was ~140 ms of a 100 ms budget, every second — the stutter). What they see is gathered aside and goes up together when
// the pass ends, so the grids always hold a whole pass (a second older than an all-at-once pass's at most).
export function updateVision(w, V, blockers = null, spread = false) {
  if (!spread) {
    if (w.tick % V.every) return;
    sweepKeep(V);
    const L = demote(V, litOf(V));
    for (const e of gatherEyes(w, V)) castEye(w, V, e, blockers, null, L[e.team], 0);
    return;
  }
  let P = passes.get(V);
  if (!P || P.stamp.length !== V.teams.length || P.stamp[0]?.length !== V.n * V.n) passes.set(V, (P = { eyes: [], at: 0, per: 0, gen: 0, got: V.teams.map(() => []), stamp: V.teams.map(() => new Uint32Array(V.n * V.n)) }));
  if (w.tick % V.every === 0) { // a new pass: where everyone stands now
    sweepKeep(V);
    if (P.at < P.eyes.length) { castShare(w, V, P, blockers, P.eyes.length - P.at); commit(V, P); } // (the last one cut short: finish it)
    P.eyes = gatherEyes(w, V); P.at = 0; P.per = Math.ceil(P.eyes.length / V.every); P.gen++;
    for (const g of P.got) g.length = 0;
  }
  P.bl = blockers;
  if (P.at >= P.eyes.length) return;
  castShare(w, V, P, blockers, P.per);
  if (P.at >= P.eyes.length) commit(V, P);
}
const passes = new WeakMap();
// a save is about to be written: the pass in flight is finished now (it is not saved — the restored world starts its next
// pass when this one would have, and both go on alike: server/persist.mjs)
export function settleVision(w, V) {
  const P = passes.get(V); if (!P || P.at >= P.eyes.length) return;
  castShare(w, V, P, P.bl, P.eyes.length - P.at); commit(V, P);
}
function castShare(w, V, P, blockers, m) {
  const end = Math.min(P.eyes.length, P.at + m);
  for (; P.at < end; P.at++) { const e = P.eyes[P.at]; castEye(w, V, e, blockers, P.stamp[e.team], P.got[e.team], P.gen); }
}
function commit(V, P) {
  const L = demote(V, litOf(V));
  for (let t = 0; t < V.teams.length; t++) { const grid = V.teams[t], got = P.got[t], list = L[t]; for (let q = 0; q < got.length; q++) { const k = got[q]; if (grid[k] !== 2) { grid[k] = 2; list.push(k); } } got.length = 0; }
}
// the cells lit last pass, per team (a restored world: its grids scanned once)
function litOf(V) {
  let L = lit.get(V);
  if (!L || L.length !== V.teams.length) { for (const grid of V.teams) for (let k = 0; k < grid.length; k++) if (grid[k] === 2) grid[k] = 1; L = V.teams.map(() => []); lit.set(V, L); }
  return L;
}
// what was in sight is now only remembered (the cells lit last pass: a big world's grids are mostly dark)
function demote(V, L) {
  for (let t = 0; t < V.teams.length; t++) { const grid = V.teams[t], list = L[t]; for (let q = 0; q < list.length; q++) if (grid[list[q]] === 2) grid[list[q]] = 1; list.length = 0; }
  V.dirty = true;
  return L;
}
// the observers, where they stand: { x, y, team, eye, range } — observers standing within the same 30 m cell see the same
// thing: one each
function gatherEyes(w, V) {
  const S = w.S, ox = V.ox || 0, oy = V.oy || 0, ids = [], out = [];
  for (const u of w.units.values()) {
    // observers: one per ~8 soldiers is plenty; spread across the unit so a wide line sees wide
    // (work crews clustered at a job: two lookouts are enough)
    const step = Math.max(1, Math.floor(u.members.length / (u.isWorkers ? 2 : 8)));
    for (let k = 0; k < u.members.length; k += step) ids.push(u.members[k]);
  }
  // weather (w.weather names a WEATHER entry: fog and heavy rain shorten sight), the light (dusk: w.lightMul), mist: economy.castSpell
  const wv = WEATHER[w.weather]?.visibilityM ?? 20000;
  const weatherMul = Math.min(1, wv / 1000) * (w.lightMul ?? 1) * (w.mist && w.tick < w.mist.until ? w.mist.visibility : 1);
  const done = new Set();
  const add = (e) => { const key = e.team * 1e8 + (((e.x - ox) / 30) | 0) * 1e4 + (((e.y - oy) / 30) | 0) + (e.eye > 2 ? 0.5 : 0) + (e.range > 1000 ? 0.25 : 0); if (!done.has(key)) { done.add(key); out.push(e); } };
  for (const id of ids) { const A = ARM_BY_ID[S.arm[id]]; add({ x: S.x[id], y: S.y[id], team: S.team[id], eye: A.mounted ? 2.5 : 1.65, range: (A.glyph === "eye" ? 1400 : 900) * weatherMul }); }
  for (const b of w.buildings || []) if (b.sight && b.progress >= 1 && !b.ruin) add({ x: b.x, y: b.y, team: b.team, eye: b.eyeH || 8, range: b.sight });
  return out;
}
// WHAT A WATCHER SEES, KEPT. Casting 96 rays over the heightfield is the dearest thing in the realm's tick, and most
// watchers are standing still — a tower never moves, and a villager at his work hardly does. The cells a watcher sees
// are therefore kept under his 30 m cell (the same cell the pass already casts only once for), his eye height and his
// range, and a watcher who has not stepped KEEP_M since his view was cast is simply lit again from the list; one who
// has walked on has it cast afresh, so what a moving host sees is never stale. The keep is emptied of
// anything not used for EXPIRE passes, so ground that changes — a wood felled, a bridge laid — comes right within the
// minute; while the woods are alight nothing is kept at all, the smoke being different every pass.
const kept = new WeakMap(); // V → { pass, map: Map(key → { pass, x, y, cells: Int32Array }), last, now }
const EXPIRE = 40; // passes (~40 s at V.every = 10 and a 100 ms tick)
const KEEP_M = 6;  // m: a watcher who has stepped further than this since his view was cast gets it cast again
function keepOf(V) { let K = kept.get(V); if (!K) kept.set(V, (K = { pass: 0, map: new Map(), last: new Set(), now: new Set() })); return K; }
// the keep is dropped when the world is written down, so a realm restored from that save sees exactly what the one that
// never stopped sees — both cast afresh from the same moment (server/persist.mjs calls settleVision)
export function clearKept(V) { const K = kept.get(V); if (K) { K.map.clear(); K.last.clear(); K.now.clear(); K.pass = 0; } } // (pass too: the sweep must fall on the same passes in both)
const scratch = [];
// one watcher's rays, and the cells he sees — from the keep where it can be
function castEye(w, V, e, blockers, stamp, list, gen) {
  const K = keepOf(V), smoky = !!(w.fire?.cells?.length && w.fire.smoke?.size);
  const ox0 = V.ox || 0, oy0 = V.oy || 0;
  const key = smoky ? null : `${e.team}|${((e.x - ox0) / 30) | 0}|${((e.y - oy0) / 30) | 0}|${e.eye > 2 ? 1 : 0}|${Math.round(e.range / 25)}`;
  if (key) K.now.add(key);
  let hit = key && K.map.get(key);
  if (hit && (Math.abs(hit.x - e.x) > KEEP_M || Math.abs(hit.y - e.y) > KEEP_M)) hit = null; // (he has moved: cast it again)
  if (hit) {
    hit.pass = K.pass; const grid = V.teams[e.team], cells = hit.cells;
    for (let q = 0; q < cells.length; q++) { const k = cells[q]; if (stamp) { if (stamp[k] !== gen) { stamp[k] = gen; list.push(k); } } else if (grid[k] !== 2) { grid[k] = 2; list.push(k); } }
    return;
  }
  scratch.length = 0;
  rayCast(w, V, e, blockers, scratch);
  if (key && K.last.has(key)) K.map.set(key, { pass: K.pass, x: e.x, y: e.y, cells: Int32Array.from(scratch) });
  const grid = V.teams[e.team];
  for (let q = 0; q < scratch.length; q++) { const k = scratch[q]; if (stamp) { if (stamp[k] !== gen) { stamp[k] = gen; list.push(k); } } else if (grid[k] !== 2) { grid[k] = 2; list.push(k); } }
}
// the keep swept at the head of each pass
function sweepKeep(V) {
  const K = keepOf(V); K.pass++;
  const t = K.last; K.last = K.now; K.now = t; K.now.clear();
  if (K.pass % 20) return;
  for (const [k, v] of K.map) if (K.pass - v.pass > EXPIRE) K.map.delete(k);
}
// one observer's 96 rays over the heightfield → the cells he sees, pushed onto `out`; the cells about him he has
// walked are explored as he goes
function rayCast(w, V, e, blockers, out) {
  const { n, cellM } = V, map = w.map, ox = V.ox || 0, oy = V.oy || 0, { x, y, team, eye } = e;
  // smoke from a fire in the woods (js/sim/wildfire.js: w.fire.smoke, m of smoke per 16 m cell) stands like the canopy
  const SM = w.fire?.cells?.length && w.fire.smoke?.size ? w.fire.smoke : null, SB = SM?.box || [0, 0, 0, 0];
  const grid = V.teams[team], h0 = map.h(x, y) + eye;
  // high ground extends range (more of the landscape is above the line of sight)
  const range = e.range * (1 + Math.max(0, h0 - 60) / 200);
  const rays = 96;
  for (let r = 0; r < rays; r++) {
    const a = (r / rays) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    let maxTan = -Infinity;
    for (let d = cellM * 0.5; d < range; d += cellM * 0.75) {
      const px = x + dx * d, py = y + dy * d; if (!map.inBounds(px, py)) break;
      const g = map.h(px, py), extra = (blockers ? blockers(px, py) : 0) + (SM && px >= SB[0] && px < SB[2] && py >= SB[1] && py < SB[3] ? SM.get(Math.floor(px / 16) * 65536 + Math.floor(py / 16)) || 0 : 0);
      // target visible if its top (1.7 m man) rises above the horizon so far
      const tanT = (g + 1.7 - h0) / d;
      const ci = ((px - ox) / cellM) | 0, cj = ((py - oy) / cellM) | 0, k = cj * n + ci;
      if (tanT >= maxTan) out.push(k);
      else if (grid[k] === 0 && d < 60) grid[k] = 1;
      const tanG = (g + extra - h0) / d;
      if (tanG > maxTan) maxTan = tanG;
      if (extra > 4 && d > 40) maxTan = Math.max(maxTan, (g + extra * 3 - h0) / d); // woods quickly stop sight
    }
  }
}

export function canSee(V, team, x, y) {
  const i = ((x - (V.ox || 0)) / V.cellM) | 0, j = ((y - (V.oy || 0)) / V.cellM) | 0;
  return V.teams[team][j * V.n + i] === 2;
}
