// Placed battlefield features (docs/combat-research.md §16; FEATURES in terrain-types.js): stakes, pits,
// ditches, hedges, fences, walls — as line segments { type, x0, y0, x1, y1, width? } in w.features.
//
// Where they come from:
//  * the map: wattle fences (objects.json "fence", length = scale × 4 m) and hedgerows (vegetation.json
//    hedge_shrub instances chained into lines) — featuresFromMapData(), called once when a map loads;
//  * the economy: every palisade / stone-wall stretch in w.buildings becomes a timber_palisade (with its
//    ditch dug on the side away from the town) or a town_wall the moment it is half built, and goes again
//    when it is ruined — syncBuildingFeatures(), run by the combat system;
//  * orders and scenarios: addFeature() (archers planting stakes, men digging pits or a ditch).
//
// Who reads them:
//  * combat (ground.js): charge refusals at stakes/ditches/hedges, cover against arrows, the defender's
//    bonus behind a wall, slow going across them (world.goingMul via the combat going hook);
//  * pathing (path.js nav grid): a barrier nobody of a class can cross closes its nav cells to that class;
//    a slow one (hedge, ditch, fence) makes them dearer, so columns look for gates and gaps. Walls built by
//    the economy close their cells through economy.blockWall already and are not touched here.
//
// Queries go through a 40 m grid index (rebuilt when the feature set changes), so a map with thousands of
// hedge segments costs the same per query as a battlefield with three.
import { FEATURES } from "./terrain-types.js";
import { navHeld, navReassert } from "./navblock.js";

const CELL = 40;
const HEDGE_LINK = 9;      // m: hedge shrubs closer than this belong to the same hedge
const HEDGE_TOL = 2.5;     // m: a hedge line is simplified to straight runs within this tolerance

// ---------------------------------------------------------------- the set and its index
export function addFeature(w, f) { (w.features ||= []).push(f); w.featuresVer = (w.featuresVer || 0) + 1; return f; }
export function removeFeature(w, f) { const k = w.features ? w.features.indexOf(f) : -1; if (k >= 0) { w.features.splice(k, 1); w.featuresVer = (w.featuresVer || 0) + 1; } }

// The index is keyed on (array identity, length, version) so scenarios that assign w.features directly
// still get a fresh index.
export function featureIndex(w) {
  const F = w.features || [];
  const I = w.fIndex;
  if (I && I.arr === F && I.len === F.length && I.ver === (w.featuresVer || 0)) return I;
  const map = new Map();
  for (const f of F) {
    const pad = (f.width || 1) / 2 + 1;
    const i0 = Math.floor((Math.min(f.x0, f.x1) - pad) / CELL), i1 = Math.floor((Math.max(f.x0, f.x1) + pad) / CELL);
    const j0 = Math.floor((Math.min(f.y0, f.y1) - pad) / CELL), j1 = Math.floor((Math.max(f.y0, f.y1) + pad) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      // only the cells the segment actually passes near (a long diagonal hedge is not a rectangle)
      const cx = (i + 0.5) * CELL, cy = (j + 0.5) * CELL;
      if (pointSeg(cx, cy, f.x0, f.y0, f.x1, f.y1) > CELL * 0.75 + pad) continue;
      const k = i * 65536 + j; let b = map.get(k); if (!b) map.set(k, (b = [])); b.push(f);
    }
  }
  // (a cache, rebuilt from w.features whenever they change: not part of the saved state — a big world's was 3.7 MB a save)
  Object.defineProperty(w, "fIndex", { value: { arr: F, len: F.length, ver: w.featuresVer || 0, map, stamp: 0, seen: new Map() }, enumerable: false, writable: true, configurable: true });
  return w.fIndex;
}

// Calls fn(f) once for every feature whose index cells touch the box around (x0,y0)–(x1,y1) grown by r.
// fn returning true stops the walk.
export function eachFeatureNear(w, x0, y0, x1, y1, r, fn) {
  const F = w.features; if (!F || !F.length) return;
  const I = featureIndex(w), st = ++I.stamp, seen = I.seen;
  const i0 = Math.floor((Math.min(x0, x1) - r) / CELL), i1 = Math.floor((Math.max(x0, x1) + r) / CELL);
  const j0 = Math.floor((Math.min(y0, y1) - r) / CELL), j1 = Math.floor((Math.max(y0, y1) + r) / CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const b = I.map.get(i * 65536 + j); if (!b) continue;
    for (const f of b) { if (seen.get(f) === st) continue; seen.set(f, st); if (fn(f)) return; }
  }
}

export function pointSeg(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

// ---------------------------------------------------------------- from the map files
// objData = maps/<map>/objects.json, vegData = maps/<map>/vegetation.json (either may be null)
export function featuresFromMapData(objData, vegData) {
  const out = [];
  for (const o of objData?.objects || []) {
    if (o.asset !== "fence" && o.kind !== "fence") continue;
    const L = (o.scale || 1) * 4, c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0);
    out.push({ type: "wattle_fence", x0: o.x - c * L / 2, y0: o.y - s * L / 2, x1: o.x + c * L / 2, y1: o.y + s * L / 2, width: 0.5, src: "map" });
  }
  const shrubs = (vegData?.instances || []).filter((v) => v.asset === "hedge_shrub");
  for (const line of chainHedges(shrubs)) {
    for (let k = 0; k + 1 < line.length; k++) out.push({ type: "hedge", x0: line[k][0], y0: line[k][1], x1: line[k + 1][0], y1: line[k + 1][1], width: 2, src: "map" });
  }
  return out;
}

// Hedge shrubs stand every ~6 m along their hedge: link each to its neighbours within HEDGE_LINK, walk the
// chains, and simplify each to straight runs (Douglas–Peucker).
function chainHedges(sh) {
  const n = sh.length; if (!n) return [];
  const G = new Map(), key = (x, y) => Math.floor(x / 10) * 65536 + Math.floor(y / 10);
  sh.forEach((s, i) => { const k = key(s.x, s.y); let b = G.get(k); if (!b) G.set(k, (b = [])); b.push(i); });
  const nb = sh.map((s, i) => {
    const out = [];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const b = G.get((Math.floor(s.x / 10) + di) * 65536 + Math.floor(s.y / 10) + dj); if (!b) continue;
      for (const j of b) if (j !== i && Math.hypot(sh[j].x - s.x, sh[j].y - s.y) <= HEDGE_LINK) out.push(j);
    }
    // keep the two nearest (a hedge is a line, not a web)
    out.sort((a, b) => Math.hypot(sh[a].x - s.x, sh[a].y - s.y) - Math.hypot(sh[b].x - s.x, sh[b].y - s.y));
    return out.slice(0, 2);
  });
  const used = new Uint8Array(n), lines = [];
  const walk = (start, from) => {
    const pts = []; let cur = start, prev = from;
    while (cur >= 0 && !used[cur]) {
      used[cur] = 1; pts.push([sh[cur].x, sh[cur].y]);
      const nx = nb[cur].find((j) => j !== prev && !used[j]);
      prev = cur; cur = nx ?? -1;
    }
    return pts;
  };
  for (let i = 0; i < n; i++) {
    if (used[i] || nb[i].length !== 1) continue; // start at chain ends
    const pts = walk(i, -1); if (pts.length >= 2) lines.push(simplify(pts, HEDGE_TOL));
  }
  for (let i = 0; i < n; i++) { if (used[i]) continue; const pts = walk(i, -1); if (pts.length >= 2) lines.push(simplify(pts, HEDGE_TOL)); } // loops
  return lines;
}
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  let best = -1, bd = 0; const a = pts[0], b = pts[pts.length - 1];
  for (let k = 1; k < pts.length - 1; k++) { const d = pointSeg(pts[k][0], pts[k][1], a[0], a[1], b[0], b[1]); if (d > bd) { bd = d; best = k; } }
  if (bd <= tol) return [a, b];
  const l = simplify(pts.slice(0, best + 1), tol), r = simplify(pts.slice(best), tol);
  return l.slice(0, -1).concat(r);
}

// ---------------------------------------------------------------- from the economy's walls
const WALL_TYPE = { palisade: "timber_palisade", stone_wall: "town_wall" };
const GATE_WALL = { gate: "timber_palisade", gatehouse: "town_wall" };
export const GATE_PASSAGE = 2.5; // m: half the width of the gate passage (the leaves)
// A gate stands in the middle of its stretch of the circuit (townplan gate slot, or the gap left in the
// AI's ring). Its flanks are walled to the stretch's ends; the passage (5 m) is open unless the gate is shut.
export function gateGeom(b) {
  let ax, ay, bx, by;
  if (b.gx1 !== undefined) { ax = b.gx1; ay = b.gy1; bx = b.gx2; by = b.gy2; }
  else { const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0); ax = b.x - c * 6; ay = b.y - s * 6; bx = b.x + c * 6; by = b.y + s * 6; }
  const L = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L, uy = (by - ay) / L;
  const t = Math.max(GATE_PASSAGE, Math.min(L - GATE_PASSAGE, (b.x - ax) * ux + (b.y - ay) * uy)); // the passage, on the line
  return { ax, ay, bx, by, ux, uy, L, t, px: ax + ux * t, py: ay + uy * t };
}
// runs of standing modules of a wall stretch → [[t0, t1] …] as fractions of its length
export function standingRuns(b) {
  const n = b.mods ? b.mods.length : 1, out = []; let s = -1;
  for (let k = 0; k <= n; k++) {
    const up = k < n && (!b.mods || b.mods[k] > 0);
    if (up && s < 0) s = k; else if (!up && s >= 0) { out.push([s / n, k / n]); s = -1; }
  }
  return out;
}
// Run every few seconds by the combat system. A stretch counts once it is half built (as economy.blockWall
// closes the nav); a palisade has its ditch dug a few metres out, on the side away from the town. Breached
// modules (siege.js) leave gaps in the line; a gate's flanks are walls, its passage a shut gate or nothing.
export function syncBuildingFeatures(w) {
  if (!w.buildings) return;
  const have = w.bFeatures || (w.bFeatures = new Map()); // building id → [features]
  let changed = false;
  const live = new Set();
  for (const b of w.buildings) {
    const gateType = GATE_WALL[b.kind];
    const type = b.featType || WALL_TYPE[b.kind] || (gateType ? "gate" : null); if (!type) continue; // (castle.js curtains: featType "curtain_wall")
    if (!gateType && b.x1 === undefined) continue;
    const stands = !b.ruin && (gateType ? b.progress >= 1 : (b.progress ?? 1) >= 0.5);
    if (!stands) continue;
    live.add(b.id);
    const sig = `${type}|${b.breachVer || 0}|${b.shut ? 1 : 0}`;
    const cur = have.get(b.id);
    if (cur && cur.sig === sig) continue; // already there (and not upgraded palisade → stone, breached or shut)
    if (cur) for (const f of cur) removeFeature(w, f);
    const fs = [];
    const T = w.teams?.[b.team]?.town;
    if (gateType) {
      const G = gateGeom(b), P = GATE_PASSAGE, W = FEATURES[gateType]?.thickness || 1;
      if (G.t - P > 0.5) fs.push(addFeature(w, { type: gateType, x0: G.ax, y0: G.ay, x1: G.px - G.ux * P, y1: G.py - G.uy * P, width: W, src: "building", building: b.id, team: b.team, flank: true }));
      if (G.L - G.t - P > 0.5) fs.push(addFeature(w, { type: gateType, x0: G.px + G.ux * P, y0: G.py + G.uy * P, x1: G.bx, y1: G.by, width: W, src: "building", building: b.id, team: b.team, flank: true }));
      if (b.shut) fs.push(addFeature(w, { type: "town_gate", x0: G.px - G.ux * P, y0: G.py - G.uy * P, x1: G.px + G.ux * P, y1: G.py + G.uy * P, width: FEATURES.town_gate?.thickness || 1, src: "building", building: b.id, team: b.team, gate: true }));
    } else {
      const dx = b.x2 - b.x1, dy = b.y2 - b.y1, L = Math.hypot(dx, dy) || 1;
      for (const [t0, t1] of standingRuns(b)) fs.push(addFeature(w, { type, x0: b.x1 + dx * t0, y0: b.y1 + dy * t0, x1: b.x1 + dx * t1, y1: b.y1 + dy * t1, width: FEATURES[type]?.thickness || 1, src: "building", building: b.id, team: b.team }));
      if (b.kind === "palisade") {
        let nx = -dy / L, ny = dx / L;
        if (T && (b.x - T.x) * nx + (b.y - T.y) * ny < 0) { nx = -nx; ny = -ny; } // outward
        fs.push(addFeature(w, { type: "ditch", x0: b.x1 + nx * 3, y0: b.y1 + ny * 3, x1: b.x2 + nx * 3, y1: b.y2 + ny * 3, width: 2.5, src: "building", building: b.id, team: b.team }));
      }
    }
    fs.sig = sig;
    have.set(b.id, fs); changed = true;
  }
  for (const [id, fs] of have) if (!live.has(id)) { for (const f of fs) removeFeature(w, f); have.delete(id); changed = true; }
  return changed;
}

// ---------------------------------------------------------------- pathing
// Close or dear-en the nav cells a feature runs through, per class. Economy-built walls are skipped (the
// economy closes their cells itself). Idempotent: re-applies from saved costs when the set changes.
export function syncFeatureNav(w) {
  const nav = w.nav; if (!nav) return;
  const ver = (w.featuresVer || 0) + ":" + (w.features?.length || 0);
  if (w.fNavVer === ver && w.fNavArr === w.features) return;
  // restore what we changed last time
  if (w.fNavSaved) for (const [k, saved] of w.fNavSaved) for (const cls in saved) nav.classes[cls][k] = saved[cls];
  const savedMap = new Map(), n = nav.n, c = nav.cellM;
  for (const f of w.features || []) {
    if (f.src === "building") continue;
    const D = FEATURES[f.type]; if (!D?.cross) continue;
    const L = Math.hypot(f.x1 - f.x0, f.y1 - f.y0), steps = Math.max(1, Math.ceil(L / (c * 0.5)));
    const cells = new Set();
    for (let s = 0; s <= steps; s++) { const x = f.x0 + (f.x1 - f.x0) * s / steps, y = f.y0 + (f.y1 - f.y0) * s / steps; const k = Math.round((y - nav.oy) / c) * n + Math.round((x - nav.ox) / c); if (k >= 0 && k < n * n) cells.add(k); }
    for (const k of cells) {
      if (navHeld(w, k)) continue; // closed by a wall or a shut gate (navblock.js): not ours to save or restore
      if (!savedMap.has(k)) { const sv = {}; for (const cls in nav.classes) sv[cls] = nav.classes[cls][k]; savedMap.set(k, sv); }
      for (const cls in nav.classes) {
        const secs = D.cross[cls] ?? D.cross.foot;
        const cost = nav.classes[cls];
        if (!isFinite(cost[k])) continue;
        // a solid line barrier a class cannot cross closes the cell; anything with gaps (hedges have gateways,
        // stakes have lanes for foot) or a slow crossing only makes it dearer (≈ extra seconds per 1.5 m span)
        if (secs === Infinity && (D.climbS || f.type === "moat" || f.type === "wagon_laager")) cost[k] = Infinity;
        else cost[k] *= secs === Infinity ? 4 : 1 + Math.min(2, secs / 16);
      }
    }
  }
  w.fNavSaved = savedMap; w.fNavVer = ver; w.fNavArr = w.features;
  navReassert(w);
}

// ---------------------------------------------------------------- field works dug or planted by a unit
// A body plants a line of FEATURES[type] a few metres before its front, as wide as its front. The work
// takes FEATURES[type].plantS (stakes: 60 s) or digManHoursPerPit-derived time; until then nothing stands.
// Returns the feature (pending) or null. Archers' stakes are what the English carried at Agincourt.
export function fieldWork(w, u, type = "archer_stakes", ahead = 3) {
  const D = FEATURES[type]; if (!D || !u?.members?.length) return null;
  const S = w.S; let minX = Infinity, maxX = -Infinity;
  const lx = Math.cos(u.facing), ly = Math.sin(u.facing), fx = -ly, fy = lx; // unit lateral / forward (world.js convention)
  for (const id of u.members) { const l = (S.x[id] - u.ax) * lx + (S.y[id] - u.ay) * ly; if (l < minX) minX = l; if (l > maxX) maxX = l; }
  const half = Math.max(3, (maxX - minX) / 2 + 1), cx = u.ax + fx * ahead, cy = u.ay + fy * ahead;
  const secs = D.plantS ?? (D.digManHoursPerPit ? D.digManHoursPerPit * 3600 * D.densityPerM2 * 2 * half * 2 / Math.max(1, u.members.length) : 120);
  const f = { type, x0: cx - lx * half, y0: cy - ly * half, x1: cx + lx * half, y1: cy + ly * half, width: type === "pits_pottes" ? 6 : type === "ditch" ? 2.5 : 2, src: "work", team: u.team };
  (w.pendingFeatures ||= []).push({ f, at: w.time + secs, unit: u.id });
  return f;
}
// called by the combat system with the other syncs: works finish, or are abandoned if their unit is gone
export function syncPendingFeatures(w) {
  const P = w.pendingFeatures; if (!P || !P.length) return;
  for (let k = P.length - 1; k >= 0; k--) {
    const p = P[k], u = w.units.get(p.unit);
    if (!u || !u.members.length || u.c?.broken || u.hold) { P.splice(k, 1); continue; } // the diggers ran or were attacked
    if (w.time >= p.at) { addFeature(w, p.f); P.splice(k, 1); }
  }
}
