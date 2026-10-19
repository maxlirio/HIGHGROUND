// FIRE IN THE WOODS (the owner: "you should be able to burn wood. Like trees, walls, etc."). DOM-free, deterministic
// (w.rng only), plain data on the world (w.fire: saved with it, sent to realm clients by server/views.mjs).
//
// The land is read on a coarse lattice of CELL m squares (the forestry tree grid's own 16 m buckets: js/sim/jobs/
// forestry.js treeGrid). A cell's FUEL is what stands in it — the map's trees, bushes, hedges and dead wood
// (vegetation.json, O.veg), each by its kind and size; felled or burnt trees are not fuel. A cell with less than
// FIRE.fuelMin does not carry fire: a ride, a road, a river, a field of stubble, a felled clearing is a GAP.
//
//   w.fire = { cells: [{ i, j, h, f, f0, t0, ch, by }], burnt: { [k]: { i, j, d, t, v: [vi], ch } }, ver }
//     a burning cell: h heat 0..1, f fuel left of f0, ch = its trees are down (charred), by = the team that lit it
//     (−1: nobody's — sparks from a burning building, a dragon); burnt = the ground the fire has been over (d: the
//     econ day, t: w.time) with the trees it took (v), so they can grow back
//
// Each step (FIRE.every ticks, on the battle clock):
//   • a cell's heat rises while it has fuel and the sky is dry; its fuel burns away (FIRE.burnS at full heat); past
//     FIRE.charAt of its fuel the trees in it are DOWN — trunks off the obstacle grid, canopy opened (cover, concealment,
//     sight: the forestry canopy sync), the felling ledger has them (nobody fells a burnt tree), timber nodes in reach
//     lose that wood, hedges there are gone; a burnt-out cell is BURNT GROUND
//   • it spreads to its 8 neighbours by chance: heat × the neighbour's fuel × DRYNESS (the season, the ground's wetness,
//     frost) × the sky (WEATHER.fireSpreadMul: clear 1 … a downpour 0) × the WIND (downwind ×3, upwind ×0.2, as the
//     economy's building fires); rain beating on it cools it and puts it out
//   • it catches flammable buildings and ripe crops at its edge, and a burning building or palisade sets the wood it
//     stands against alight; a burning palisade catches the stretch it joins
//   • men standing in it are SCORCHED (wounds by chance) and terrified (stress — the morale hooks: a scorched man past
//     his nerve breaks and runs), and a company caught in it makes for open ground
//   • its SMOKE stands over it and drifts downwind: vision.js reads smokeAt as an obstruction like the canopy
// Budget: a step costs O(burning cells × 8) plus one pass over the men while anything is hot; a forest fire is capped at
// FIRE.maxCells burning at once (past that the spread chance is scaled down), so a burning forest cannot stall a tick.
import { BATTLE_RATE } from "./clock.js";
import { TICK } from "./clock.js";
import { WEATHER } from "./terrain-types.js";
import { seasonOf } from "./weather.js";
import { BUILDINGS } from "./econ-data.js";
import { treeGrid, burnTrees, regrowBurnt, treeKg, TREES, forestTouched } from "./jobs/forestry.js";
import { issueOrder } from "./world.js";
import { applyWound } from "./melee.js";
import { W_LIGHT, W_DISABLE, W_INCAP } from "./soldiers.js";
import { Z_TORSO, Z_ARMS, Z_THIGHS } from "./kit.js";
import { shielded } from "./sides.js";
import { removeFeature } from "./features.js";

export const FIRE = {
  cell: 16,             // m (= forestry's tree buckets)
  every: 5,             // ticks between steps
  fuelMin: 0.35,        // a cell with less than this does not carry fire (two bushes don't; a single oak does)
  burnS: 150,           // battle seconds a cell takes to burn out at full heat
  charAt: 0.5,          // the trees are down once this share of the fuel is gone
  spread: 0.002,        // chance per second per neighbour at full heat, fuel 2, dry, calm: in still air a broadleaf wood's fire
                        // mostly dies of itself (each neighbour ≈ 1 in 5 over a cell's burning); a dry wind drives it (×5 downwind)
  smoulder: 0.4,        // a cell whose trees are down spreads at this share (the flaming front has passed)
  diag: 0.6,            // a corner neighbour, × this
  heatUp: 0.03,         // heat per second while it has fuel (× the sky × dryness)
  rainCool: 0.06,       // heat lost per second under rain (× (0.25 − fireSpreadMul) / 0.25)
  maxCells: 1200,       // burning at once; past this the spread is scaled down (the budget)
  hurtHeat: 0.25,       // men in a cell this hot are scorched
  woundP: 0.03,         // wound chance per second at full heat
  fearPerS: 0.12,       // stress per second at full heat (× 1.3 − courage)
  smokeH: 22,           // m of smoke over a cell at full heat (an obstruction to sight, like the canopy)
  regrowDays: 200,      // econ days before burnt ground stands in wood again
  bldCatch: 0.02,       // chance per second a flammable building at a hot cell's edge catches (× heat × sky × dryness)
  woodCatch: 0.004,     // chance per second a burning building lights the wood it stands against
  wallCatch: 0.03,      // chance per second a burning palisade lights the stretch it joins
};
// how much fire each kind of plant carries (an oak at scale 1 = 1)
export const FUEL = { oak_a: 1, oak_b: 1, oak_c: 1, pine: 1.1, birch: 0.6, alder: 0.5, willow: 0.4, dead_tree: 0.7, fruit_tree: 0.35, bush: 0.18, hedge_shrub: 0.3, log: 0.25, oak_stump: 0 };

const C = FIRE.cell, BT = TICK * BATTLE_RATE;
export const cellKey = (i, j) => i * 65536 + j;        // (forestry's bucket key)
export const cellOf = (x, y) => [Math.floor(x / C), Math.floor(y / C)];
const centre = (i) => (i + 0.5) * C;
const doyOf = (w) => w.econ?.doy ?? w.time / 86400;
const fireWx = (w) => WEATHER[w.weather]?.fireSpreadMul ?? 1;
export const fireOf = (w) => (w.fire ||= { cells: [], burnt: {}, ver: 0 });

// ---------------------------------------------------------------- how dry the woods are
// the season (a summer wood burns; a winter one smoulders), the ground's wetness after rain (js/sim/weather.js wet), frost
const SEASON_DRY = { summer: 1.25, autumn: 1, spring: 0.75, winter: 0.45 };
export function dryness(w) {
  const wx = w.wx, s = w.econ ? SEASON_DRY[seasonOf(w.econ.doy)] ?? 1 : 1;
  return Math.max(0.05, s * (1 - 0.75 * (wx?.wet || 0)) * ((wx?.temp ?? 10) < 0 ? 0.6 : 1));
}

// ---------------------------------------------------------------- fuel (cached per world until the trees change)
const caches = new WeakMap();
function cacheOf(w) {
  const cv = w.labor?.forest?.cv || 0; let K = caches.get(w);
  if (!K || K.cv !== cv) { K = { cv, fuel: new Map() }; caches.set(w, K); }
  return K;
}
// the plants standing in cell (i, j): indices into O.veg
export function standingIn(w, i, j) {
  const veg = w.obstacles?.veg; if (!veg) return [];
  const b = treeGrid(veg).get(cellKey(i, j)); if (!b) return [];
  const felled = w.labor?.forest?.felled;
  return felled ? b.filter((vi) => felled[vi] === undefined) : b;
}
export function fuelOf(w, i, j) {
  const K = cacheOf(w), k = cellKey(i, j); let f = K.fuel.get(k);
  if (f !== undefined) return f;
  f = 0; const veg = w.obstacles?.veg;
  if (veg) for (const vi of standingIn(w, i, j)) { const v = veg[vi]; f += (FUEL[v.asset] ?? 0.3) * (v.scale || 1) ** 2; }
  K.fuel.set(k, f); return f;
}

// ---------------------------------------------------------------- the index (not saved: rebuilt from w.fire.cells)
const idx = new WeakMap();
function indexOf(F) {
  let I = idx.get(F);
  if (!I || I.ver !== F.ver || I.n !== F.cells.length) { I = { ver: F.ver, n: F.cells.length, m: new Map() }; for (const c of F.cells) I.m.set(cellKey(c.i, c.j), c); idx.set(F, I); }
  return I.m;
}
export const burningAt = (w, x, y) => { const F = w.fire; if (!F?.cells.length) return null; const [i, j] = cellOf(x, y); return indexOf(F).get(cellKey(i, j)) || null; };
export const burntAt = (w, x, y) => { const F = w.fire; if (!F) return null; const [i, j] = cellOf(x, y); return F.burnt[cellKey(i, j)] || null; };

// ---------------------------------------------------------------- what will burn at a spot (the UI and the server alike)
// a wood: the cell under (x, y), else the nearest of its neighbours that carries fire. The sim reads its trees; a realm
// client (no tree list: js/realm/client.js) reads the canopy it was sent. → { i, j, x, y, fuel } | null
export function woodAt(w, x, y) {
  const [i0, j0] = cellOf(x, y); let best = null, bd = Infinity;
  const veg = w.obstacles?.veg;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const i = i0 + di, j = j0 + dj, k = cellKey(i, j), F = w.fire;
    if (F?.burnt[k]?.ch || (F?.cells.length && indexOf(F).get(k))) continue;
    let fuel;
    if (veg) fuel = fuelOf(w, i, j);
    else { const cx = centre(i), cy = centre(j), can = w.map?.canopyGrid ? w.map.canopy(cx, cy) : 0; fuel = can > 5 ? can / 7 : 0; }
    if (fuel < FIRE.fuelMin) continue;
    const d = Math.hypot(centre(i) - x, centre(j) - y) + (di || dj ? 6 : 0);
    if (d < bd) { bd = d; best = { i, j, x: centre(i), y: centre(j), fuel }; }
  }
  return best;
}
const segT = (b, x, y) => { const dx = b.x2 - b.x1, dy = b.y2 - b.y1, l2 = dx * dx + dy * dy || 1; return Math.max(0, Math.min(1, ((x - b.x1) * dx + (y - b.y1) * dy) / l2)); };
// the nearest point of a building to (x, y): a wall stretch along its LENGTH, anything else its centre
export function nearPoint(b, x, y) {
  if (b.x1 === undefined) return [b.x, b.y];
  const t = segT(b, x, y); return [b.x1 + (b.x2 - b.x1) * t, b.y1 + (b.y2 - b.y1) * t];
}
export function distTo(b, x, y) {
  if (b.x1 !== undefined) { const [px, py] = nearPoint(b, x, y); return Math.hypot(px - x, py - y); }
  const fp = BUILDINGS[b.kind]?.footprint; return Math.max(0, Math.hypot(b.x - x, b.y - y) - (fp ? Math.min(fp[0], fp[1]) / 2 : 4));
}
const inField = (b, x, y, m = 0) => { const r = b.rot || 0, c = Math.cos(r), s = Math.sin(r), dx = x - b.x, dy = y - b.y; return Math.abs(dx * c + dy * s) < (b.w || 0) / 2 + m && Math.abs(dy * c - dx * s) < (b.h || 0) / 2 + m; };
// a field's standing crop: what burns (green corn barely; ripe corn like tinder)
export function cropStanding(w, b) { const f = b.field; return !!f && (f.state === "growing" || f.state === "ripe") && (f.left ?? 1) > 1; }
const NAME = (b) => (BUILDINGS[b.kind]?.name || b.kind.replace(/_/g, " ")).replace(/ & Ditch$/, "");
// THE BURN TARGET at (x, y) for team: the timber building or wall stretch clicked (a wall by its length), else the field
// the spot lies in, else the wood. → { kind: "building" | "field" | "wood", b?, x, y (where the torches go), own, name,
//   stone?, why? (it cannot be burnt: why) } | null
export function burnTargetAt(w, team, x, y) {
  let hit = null, hd = Infinity;
  for (const b of w.buildings || []) {
    if (b.ruin || b.field || b.castle !== undefined || b.x === undefined) continue;
    const d = distTo(b, x, y); if (d < (b.x1 !== undefined ? 12 : 10) && d < hd) { hd = d; hit = b; }
  }
  if (hit) {
    const [px, py] = nearPoint(hit, x, y), def = BUILDINGS[hit.kind] || {};
    return { kind: "building", b: hit, x: px, y: py, own: hit.team === team, name: NAME(hit), stone: !def.flammable, why: hit.team !== team && shielded(w, hit.team) ? "they are under protection" : hit.fire > 0 ? "it is already burning" : null };
  }
  const fb = (w.buildings || []).find((b) => b.field && !b.ruin && inField(b, x, y));
  if (fb) return { kind: "field", b: fb, x, y, own: fb.team === team, name: fb.field?.crop ? `${fb.field.crop} field` : "field", why: fb.team !== team && shielded(w, fb.team) ? "they are under protection" : fb.fire > 0 ? "it is already burning" : !cropStanding(w, fb) ? "nothing standing in it to burn" : null };
  const c = woodAt(w, x, y);
  if (c) return { kind: "wood", x: c.x, y: c.y, own: false, name: c.fuel > 2.5 ? "the wood" : c.fuel > 1 ? "the trees" : "the brush", i: c.i, j: c.j, why: dryness(w) * fireWx(w) < 0.12 ? "too wet to take fire" : null };
  return null;
}

// ---------------------------------------------------------------- setting a cell alight
export function ignite(w, i, j, h = 0.2, by = -1) {
  const F = fireOf(w), k = cellKey(i, j), I = indexOf(F);
  const old = I.get(k); if (old) { old.h = Math.max(old.h, h); return old; }
  if (F.burnt[k]?.ch) return null;                         // (burnt ground: nothing left to burn)
  const f0 = fuelOf(w, i, j); if (f0 < FIRE.fuelMin) return null;
  const c = { i, j, h, f: f0, f0, t0: w.time, ch: 0, by };
  F.cells.push(c); F.ver++; I.set(k, c); const J = idx.get(F); if (J) { J.ver = F.ver; J.n = F.cells.length; }
  return c;
}
// torches put to the wood at (x, y) (the burn order: js/game/commands.js): the cell, and the brush either side of it along
// the edge (a party fires a front, not a tree) → the cell, or null (nothing there takes)
export function lightWood(w, x, y, team) {
  const c = woodAt(w, x, y); if (!c) return null;
  const cell = ignite(w, c.i, c.j, 0.4, team);
  if (cell) for (const [di, dj] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) if (fuelOf(w, c.i + di, c.j + dj) >= FIRE.fuelMin && w.rng.next() < 0.5) ignite(w, c.i + di, c.j + dj, 0.25, team);
  if (cell) w.events.push({ t: w.tick, kind: "wood-fired", team, x: c.x, y: c.y });
  return cell;
}

// ---------------------------------------------------------------- the trees in a cell come down
function charCell(w, F, c) {
  c.ch = 1;
  const k = cellKey(c.i, c.j), veg = w.obstacles?.veg, vis = burnTrees(w, standingIn(w, c.i, c.j), false);
  cacheOf(w).fuel.delete(k);   // (only this cell's fuel changed: the cache is kept — wildfireSystem re-stamps it)
  const B = F.burnt[k] || (F.burnt[k] = { i: c.i, j: c.j, d: doyOf(w), t: w.time, v: [], ch: 1 });
  B.ch = 1; B.d = doyOf(w); B.t = w.time; for (const vi of vis) B.v.push(vi);
  // the wood a timber crew works there is gone with it (resources.js wood / coppice: the node's share of its trees)
  if (vis.length && veg) {
    let kg = 0; for (const vi of vis) kg += treeKg(veg[vi]);
    for (const n of w.resources || []) {
      if ((n.kind !== "wood" && n.kind !== "coppice") || !(n.amount > 0)) continue;
      const R = Math.min(120, (n.r || 40) * 2.5); if (Math.hypot(centre(c.i) - n.x, centre(c.j) - n.y) > R + C) continue;
      n.amount = Math.max(0, n.amount - (n.start || n.amount) * kg / nodeKg(w, n));
    }
  }
  scorchFeatures(w, c.i, c.j);
  F.bver = (F.bver || 0) + 1;
  return vis.length;   // (the canopy and the fuel are brought up to date once, after the step: forestTouched)
}
// a hedge or wattle fence that ran through cell (i, j) is ash (features.js: the map's own; the nav follows featuresVer).
// The realm client does the same to its map features when it hears of the burnt ground (js/realm/client.js)
export function scorchFeatures(w, i, j) {
  for (const f of [...(w.features || [])]) {
    if (f.type !== "hedge" && f.type !== "wattle_fence") continue;
    const mx = (f.x0 + f.x1) / 2, my = (f.y0 + f.y1) / 2; if (Math.floor(mx / C) === i && Math.floor(my / C) === j) removeFeature(w, f);
  }
}
const nodeKgs = new WeakMap();
function nodeKg(w, n) {
  let v = nodeKgs.get(n); if (v) return v;
  const veg = w.obstacles?.veg || [], R = Math.min(120, (n.r || 40) * 2.5); v = 0;
  for (const t of veg) if (TREES[t.asset] && Math.hypot(t.x - n.x, t.y - n.y) < R) v += treeKg(t);
  v = Math.max(v, 1); nodeKgs.set(n, v); return v;
}

// ---------------------------------------------------------------- smoke (vision.js)
// m of smoke standing at (x, y) (0: clear air). The map is kept on w.fire, unsaved (F.smoke: vision.js reads it directly
// by the same 16 m key, so the vision module needs nothing from this one)
export function smokeAt(w, x, y) { const M = w.fire?.cells.length ? w.fire.smoke : null; return M ? M.get(cellKey(Math.floor(x / C), Math.floor(y / C))) || 0 : 0; }
const setSmoke = (F, M) => Object.defineProperty(F, "smoke", { value: M, enumerable: false, writable: true, configurable: true });
function buildSmoke(w, F) {
  const M = new Map(), wd = w.wind, ws = wd ? Math.hypot(wd.x, wd.y) : 0, ux = ws > 1 ? wd.x / ws : 0, uy = ws > 1 ? wd.y / ws : 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const put = (i, j, h) => { const k = cellKey(i, j); if ((M.get(k) || 0) < h) M.set(k, h); x0 = Math.min(x0, i * C); y0 = Math.min(y0, j * C); x1 = Math.max(x1, (i + 1) * C); y1 = Math.max(y1, (j + 1) * C); };
  for (const c of F.cells) {
    if (c.h < 0.15) continue;
    const H = FIRE.smokeH * c.h; put(c.i, c.j, H);
    if (ws > 1) for (let s = 1; s <= Math.min(4, 1 + Math.floor(ws / 3)); s++) put(Math.floor((centre(c.i) + ux * s * C) / C), Math.floor((centre(c.j) + uy * s * C) / C), H * (1 - s * 0.18)); // (the plume leans downwind)
  }
  M.box = [x0, y0, x1, y1];   // (vision.js looks the smoke up only inside this box)
  setSmoke(F, M);
}

// ---------------------------------------------------------------- one step
const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0]];
export function wildfireSystem(w) {
  if (w.tick % FIRE.every) return;
  const F = w.fire;
  if (w.tick % 600 === 0 && F) regrow(w, F);
  const burningB = buildingFires(w);
  if (!F?.cells.length && !burningB.length) { if (F?.smoke?.size) setSmoke(F, new Map()); return; }
  const Fs = fireOf(w), dt = FIRE.every * BT, fwx = fireWx(w), dry = dryness(w), I = indexOf(Fs);
  const wd = w.wind, ws = wd ? Math.hypot(wd.x, wd.y) : 0;
  const budget = Math.min(1, FIRE.maxCells / Math.max(1, Fs.cells.length));
  const lit = []; let touch = false;
  for (const c of Fs.cells) {
    // the sky: rain cools it and puts it out; a dry sky lets it grow
    if (fwx < 0.25) c.h -= dt * FIRE.rainCool * (0.25 - fwx) / 0.25 * (1.2 - Math.min(1, dry));
    else if (c.h < 1) c.h = Math.min(1, c.h + dt * FIRE.heatUp * fwx * Math.min(1.3, dry));
    c.f -= c.f0 * dt / FIRE.burnS * Math.max(0.15, c.h);
    if (!c.ch && c.f < c.f0 * (1 - FIRE.charAt) && c.h > 0 && charCell(w, Fs, c)) touch = true;
    if (c.h <= 0.2) continue;
    // the spread: each neighbour by chance (heat, its fuel, how dry, the sky, the wind)
    for (const [di, dj, side] of N8) {
      const i = c.i + di, j = c.j + dj, k = cellKey(i, j);
      if (I.has(k) || Fs.burnt[k]?.ch) continue;
      const fu = fuelOf(w, i, j); if (fu < FIRE.fuelMin) continue;
      let wm = 1;
      if (ws > 1) { const d = side ? 1 : Math.SQRT2, cs = ((di / d) * (wd.x / ws) + (dj / d) * (wd.y / ws)) * Math.min(1, ws / 8); wm = cs >= 0 ? 1 + 4 * cs : (1 + 0.9 * cs) ** 2; } // (a fire runs before the wind and backs into it slowly: ×5 downwind, ×0.01…0.1 against a fresh breeze)
      const p = FIRE.spread * dt * c.h * Math.min(1.3, fu / 2) * dry * fwx * wm * (side ? 1 : FIRE.diag) * (c.ch ? FIRE.smoulder : 1) * budget;
      if (p > 0 && w.rng.next() < p) lit.push([i, j, c.by]);
    }
  }
  if (touch) { const K = cacheOf(w); forestTouched(w); K.cv = w.labor?.forest?.cv || 0; caches.set(w, K); } // (our own felling: the rest of the fuel cache stands)
  for (const [i, j, by] of lit) ignite(w, i, j, 0.15, by);
  // the fire meets the town: flammable buildings and ripe corn at a hot cell's edge; a burning building lights the wood
  if (Fs.cells.length || burningB.length) meetTown(w, Fs, burningB, dt, fwx, dry);
  // burnt out (or drowned): off the list; a cell the rain put out before its trees came down keeps them
  let out = false;
  for (const c of Fs.cells) if (c.f <= c.f0 * 0.04 || c.h <= 0) { out = true; if (c.ch) { const B = Fs.burnt[cellKey(c.i, c.j)]; if (B) B.t = w.time; } }
  if (out) { Fs.cells = Fs.cells.filter((c) => c.f > c.f0 * 0.04 && c.h > 0); Fs.ver++; }
  buildSmoke(w, Fs);
  scorchMen(w, Fs, dt);
}
function buildingFires(w) { const out = []; for (const b of w.buildings || []) if (b.fire > 0 && !b.ruin) out.push(b); return out; }
function meetTown(w, F, burningB, dt, fwx, dry) {
  const I = indexOf(F);
  let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
  for (const c of F.cells) { if (c.h < 0.3) continue; X0 = Math.min(X0, c.i * C); Y0 = Math.min(Y0, c.j * C); X1 = Math.max(X1, (c.i + 1) * C); Y1 = Math.max(Y1, (c.j + 1) * C); }
  // hot cells → buildings and fields beside them (raiders' rules: a protected house, or an absent lord's seat, is spared)
  if (X1 > X0) for (const b of w.buildings || []) {
    if (b.ruin || b.fire > 0 || b.castle !== undefined || b.x === undefined) continue;
    { const R = b.x1 !== undefined ? Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 2 + C : b.field ? Math.hypot(b.w || 0, b.h || 0) / 2 + C : 30; if (b.x + R < X0 || b.x - R > X1 || b.y + R < Y0 || b.y - R > Y1) continue; }
    if (shielded(w, b.team) || (w.teams?.[b.team]?.keepsPeace && !b.town)) continue;
    const def = BUILDINGS[b.kind]; if (!b.field && !def?.flammable) continue;
    if (b.field && !(b.field.state === "ripe" || (b.field.state === "growing" && w.econ && w.econ.doy > b.field.ripe - 20))) continue;
    let heat = 0;
    if (b.field) { // (a field: the cells along its edge)
      const R = Math.hypot(b.w || 0, b.h || 0) / 2 + C; if (!near(F, b.x, b.y, R)) continue;
      for (const c of F.cells) if (c.h > heat && inField(b, centre(c.i), centre(c.j), C)) heat = c.h;
    } else if (b.x1 !== undefined) {
      const L = Math.hypot(b.x2 - b.x1, b.y2 - b.y1), n = Math.max(1, Math.ceil(L / C));
      for (let s = 0; s <= n; s++) { const x = b.x1 + (b.x2 - b.x1) * s / n, y = b.y1 + (b.y2 - b.y1) * s / n, c = I.get(cellKey(Math.floor(x / C), Math.floor(y / C))); if (c && c.h > heat) heat = c.h; }
    } else {
      const fp = def.footprint || [8, 8], r = Math.max(fp[0], fp[1]) / 2 + 4;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const x = b.x + di * r, y = b.y + dj * r, c = I.get(cellKey(Math.floor(x / C), Math.floor(y / C))); if (c && c.h > heat) heat = c.h; }
    }
    if (heat < 0.3) continue;
    if (w.rng.next() < FIRE.bldCatch * dt * heat * fwx * dry * (b.field ? 2 : def.flammable)) { b.fire = b.field ? 0.3 : Math.max(b.fire, 0.2); w.events.push({ t: w.tick, kind: b.field ? "field-fired" : "fire", building: b.id, team: b.team, wood: true }); }
  }
  // burning buildings → the wood they stand against; a burning palisade → the stretch it joins
  for (const b of burningB) {
    if (b.field || b.fire < 0.3) continue;
    const pts = [];
    if (b.x1 !== undefined) { const L = Math.hypot(b.x2 - b.x1, b.y2 - b.y1), n = Math.max(1, Math.ceil(L / C)); for (let s = 0; s <= n; s++) pts.push([b.x1 + (b.x2 - b.x1) * s / n, b.y1 + (b.y2 - b.y1) * s / n]); }
    else { const fp = BUILDINGS[b.kind]?.footprint || [8, 8], r = Math.max(fp[0], fp[1]) / 2 + 3; for (let a = 0; a < 8; a++) pts.push([b.x + Math.cos(a * Math.PI / 4) * r, b.y + Math.sin(a * Math.PI / 4) * r]); }
    const seen = new Set();
    for (const [x, y] of pts) {
      const i = Math.floor(x / C), j = Math.floor(y / C), k = cellKey(i, j); if (seen.has(k) || I.has(k) || F.burnt[k]?.ch) continue; seen.add(k);
      if (fuelOf(w, i, j) < FIRE.fuelMin) continue;
      if (w.rng.next() < FIRE.woodCatch * dt * b.fire * fwx * dry) ignite(w, i, j, 0.15, -1);
    }
    if (b.x1 !== undefined && BUILDINGS[b.kind]?.flammable) for (const o of w.buildings) {
      if (o === b || o.ruin || o.fire > 0 || o.x1 === undefined || !BUILDINGS[o.kind]?.flammable) continue;
      const j = Math.min(Math.hypot(o.x1 - b.x1, o.y1 - b.y1), Math.hypot(o.x1 - b.x2, o.y1 - b.y2), Math.hypot(o.x2 - b.x1, o.y2 - b.y1), Math.hypot(o.x2 - b.x2, o.y2 - b.y2));
      if (j > 4) continue;
      if (w.rng.next() < FIRE.wallCatch * dt * b.fire * fwx * BUILDINGS[o.kind].flammable) { o.fire = 0.2; w.events.push({ t: w.tick, kind: "fire", building: o.id, team: o.team }); }
    }
  }
}
const near = (F, x, y, R) => { for (const c of F.cells) if (Math.abs(centre(c.i) - x) < R && Math.abs(centre(c.j) - y) < R) return true; return false; };

// ---------------------------------------------------------------- men in the fire
function scorchMen(w, F, dt) {
  let hot = false; for (const c of F.cells) if (c.h >= FIRE.hurtHeat) { hot = true; break; }
  if (!hot) return;
  const S = w.S, I = indexOf(F), ctx = w.cs?.ctx || { S, rng: w.rng, time: w.time, tick: w.tick, events: w.events };
  const caught = new Map();   // unit id → [men in it, x, y of the heat]
  for (let i = 0; i < S.n; i++) {
    if (!S.alive[i] || S.lvl[i]) continue;
    const c = I.get(cellKey(Math.floor(S.x[i] / C), Math.floor(S.y[i] / C))); if (!c || c.h < FIRE.hurtHeat) continue;
    S.stress[i] += FIRE.fearPerS * c.h * dt * (1.3 - S.courage[i]);
    if (w.cs?.recentShot && i < w.cs.recentShot.length) w.cs.recentShot[i] = w.time;   // (in danger: morale.js counts him threatened)
    if (w.rng.next() < FIRE.woundP * c.h * dt) {
      const r = w.rng.next(), sev = r < 0.72 ? W_LIGHT : r < 0.95 ? W_DISABLE : W_INCAP;
      applyWound(ctx, i, -1, sev, r < 0.4 ? Z_ARMS : r < 0.8 ? Z_TORSO : Z_THIGHS, "fire");
    }
    const u = S.unit[i]; let e = caught.get(u); if (!e) caught.set(u, (e = [0, 0, 0])); e[0]++; e[1] += centre(c.i); e[2] += centre(c.j);
  }
  // a company caught in it makes for open ground (once in a while: not an order every step)
  for (const [uid, [n, sx, sy]] of caught) {
    const u = w.units.get(uid); if (!u || !u.members.length || u.state === "routing" || n < Math.max(2, u.members.length * 0.25)) continue;
    if ((u.fireFledT || -1e9) > w.time - 12 || u.tw || u.esc) continue;
    u.fireFledT = w.time;
    const fx = sx / n, fy = sy / n, [ox, oy] = escape(w, F, u.ax, u.ay, fx, fy);
    u.burning = null; u.burnWood = null;
    issueOrder(w, [u.id], { kind: "move", x: ox, y: oy, pace: "quick" });
    w.events.push({ t: w.tick, kind: "fire-flee", unit: u.id, team: u.team, x: u.ax, y: u.ay });
  }
}
// the nearest open ground out of the fire from (x, y): the direction with the fewest burning cells, up to 80 m
function escape(w, F, x, y, fx, fy) {
  const I = indexOf(F); let best = null, bs = Infinity;
  for (let a = 0; a < 12; a++) {
    const dx = Math.cos(a * Math.PI / 6), dy = Math.sin(a * Math.PI / 6); let s = 0, end = 80;
    for (let d = C; d <= 80; d += C / 2) { const c = I.get(cellKey(Math.floor((x + dx * d) / C), Math.floor((y + dy * d) / C))); if (c) s += c.h; else if (d >= 2 * C) { end = d + C; break; } }
    const toward = (dx * (fx - x) + dy * (fy - y)) > 0 ? 0.5 : 0, mx = x + dx * end, my = y + dy * end;
    if (!w.map.inBounds(mx, my) || w.map.water(mx, my) > 0.3) s += 50;
    if (s + toward < bs) { bs = s + toward; best = [mx, my]; }
  }
  return best || [x, y];
}

// ---------------------------------------------------------------- the burnt ground greens over
function regrow(w, F) {
  const D = doyOf(w);
  for (const k of Object.keys(F.burnt)) {
    const B = F.burnt[k]; if (D - B.d < FIRE.regrowDays) continue;
    if (F.cells.length && indexOf(F).get(+k)) continue;
    regrowBurnt(w, B.v); delete F.burnt[k]; F.ver++; F.bver = (F.bver || 0) + 1;
  }
}

// the fire's picture as the realm sends it (server/views.mjs → js/realm/client.js: the same w.fire shape the renderer reads)
export function fireWire(w) {
  const F = w.fire; if (!F) return null;
  return { c: F.cells.map((c) => [c.i, c.j, Math.round(c.h * 20) / 20, c.ch]) };
}
export const fireStats = (w) => ({ burning: w.fire?.cells.length || 0, burnt: w.fire ? Object.keys(w.fire.burnt).length : 0 });
