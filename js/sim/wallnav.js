// WALL NAVIGATION — how men find the gates of a walled town (the owner: "the units seem to not know where the gates
// are to my city and just walk at a wall repeatedly").
//
// The 25 m nav grid (path.js) cannot see a town wall properly: a palisade is a 0.3 m line, a gate passage 5 m. A
// diagonal stretch closes a staircase of cells the A* slips through at the corners, and the stretch beside a gate
// closes the gate's own cell (a 45 m gate stretch puts the neighbouring wall's end ~22 m from the passage — the same
// 25 m cell). Routes ran straight at the stakes and the men ground against them (goingHook: 2 % pace, for ever).
//
// This layer is exact geometry on top of the grid, derived from the wall FEATURES the men physically meet
// (features.syncBuildingFeatures: the standing runs of each palisade / town-wall stretch, a gate's two flanks):
//   · BARRIERS: those runs as segments with a clearance (half the wall's thickness + a man). A breach or a stretch not
//     yet half built is simply not there: a gap, used like any other way through.
//   · GATES: each town gate's passage. Open to its own team and to anyone not at war with it, and to everyone once its
//     leaves are broken or forced; SHUT to its enemies (they go round, assault, or break in — siege.js).
//   · NODES: a few points round every joint and free end of the barriers (the corners a route bends round, the ends of
//     a gap) and a pair of points either side of each gate passage. Visibility between nodes is tested lazily and
//     remembered until the walls change; a route is Dijkstra over the nodes visible from its two ends.
// Walls are clustered (a town's circuit is one cluster) so a query only looks at the walls it actually meets.
//
// The layer is DERIVED: kept on a non-enumerable property of the world (the realm save never holds it), rebuilt
// whenever the feature set changes (w.featuresVer), so a restored world rebuilds it from the saved walls. Everything
// here is a pure function of the walls and the query: deterministic and lockstep-safe.
//
// Users:
//   route(w, team, ax, ay, bx, by) → null (the straight way is clear) | { pts, gates } | { pts: null, stop: [x, y] }
//   clear(w, team, ax, ay, bx, by) → is the straight way free of barriers for this team?
//   via(w, team, x, y, tx, ty, memo) → the point to walk toward now (villagers: labor.js, economy.js)
//   manTarget(w, team, x, y, tx, ty) → a man of a moving body heads for the passage his body is going through
//   pullSlot(w, team, ax, ay, tx, ty) → a formation slot across a wall from its body is brought back to the body's side
//   near(w, x, y, r) → any barrier within r (cheap bbox test: whether the rest need run at all)
import { gateGeom, GATE_PASSAGE } from "./features.js";
import { isFoe } from "./sides.js";

const WALLS = new Set(["timber_palisade", "town_wall"]);
const BODY = 0.6;      // m: a man's clearance from a wall's face (goingHook stops him within width/2 + 0.5)
const NODE_R = 9;      // m: route nodes stand this far out from a joint or a free end: a column's files (±2.5 m) walking the leg between two keep clear of a palisade's ditch, 1.75–4.25 m out (at 6.5 m its inner file walked IN the ditch, at a crawl, along a land-read circuit's whole side)
const PORTAL_D = 5;    // m: a gate's two nodes, this far either side of its passage
const MOUTH = 3;       // m: a man going through a gate lines up this far before it, square to the passage
const GRID = 32;       // m: the barrier index
const LINK = 70;       // m: walls whose ends are this close belong to one circuit (a cluster)

// ---------------------------------------------------------------- the layer
function layerOf(w) {
  const F = w.features || [], L = w._wallNav, v = w.featuresVer || 0;
  if (L && L.ver === v && L.len === F.length && L.arr === F) return L;
  const nl = build(w, F, `${v}:${F.length}`); nl.ver = v; nl.len = F.length;
  Object.defineProperty(w, "_wallNav", { value: nl, writable: true, enumerable: false, configurable: true });
  return nl;
}
export const layerSig = (w) => layerOf(w).sig;
export function any(w) { return !!(w.features?.length && layerOf(w).segs.length); }

function build(w, F, sig) {
  const byId = new Map();
  for (const f of F) if (f.src === "building" && f.building !== undefined && !byId.has(f.building)) byId.set(f.building, null);
  if (byId.size) for (const b of w.buildings || []) if (byId.has(b.id)) byId.set(b.id, b);
  const segs = [], soft = [], gateB = new Map();
  for (const f of F) {
    const ditch = f.type === "ditch";
    if (f.src !== "building" || !(WALLS.has(f.type) || ditch) || f.gate) continue;
    const b = byId.get(f.building); if (!b || b.castle !== undefined) continue; // (a castle's walls are castle.js's: levels, stairs, its own gates)
    const len = Math.hypot(f.x1 - f.x0, f.y1 - f.y0); if (len < 0.3) continue;
    // (a palisade's ditch is SOFT: crossable, slowly — a route keeps out of it, but it never shuts anyone out)
    if (ditch) { soft.push({ x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1, r: (f.width || 2.5) / 2 + 0.4, team: f.team ?? b.team, bid: b.id, c: -1, soft: true }); continue; }
    segs.push({ x0: f.x0, y0: f.y0, x1: f.x1, y1: f.y1, r: (f.width || 1) / 2 + BODY, team: f.team ?? b.team, bid: b.id, c: -1 });
    if (f.flank && !gateB.has(b.id)) gateB.set(b.id, b);
  }
  const L = { sig, arr: F, segs, gates: [], clusters: [], grid: new Map(), stamp: 0, seen: null };
  if (!segs.length) return L;
  // gates: the passage between the flanks, its normal, its two nodes; a passage shut to a team is a barrier to it
  for (const b of gateB.values()) {
    const G = gateGeom(b), nx = -G.uy, ny = G.ux;
    L.gates.push({ b, id: b.id, team: b.team, px: G.px, py: G.py, ux: G.ux, uy: G.uy, nx, ny, half: GATE_PASSAGE, r: 0.3 + BODY, c: -1, seg: -1 });
  }
  // clusters: union of walls whose ends lie within LINK of each other
  const par = segs.map((_, i) => i), find = (i) => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
  const ends = []; segs.forEach((s, i) => { ends.push([s.x0, s.y0, i], [s.x1, s.y1, i]); });
  const eg = new Map(), ek = (x, y) => Math.floor(x / LINK) * 65536 + Math.floor(y / LINK);
  for (const e of ends) { const k = ek(e[0], e[1]); (eg.get(k) || eg.set(k, []).get(k)).push(e); }
  for (const e of ends) {
    const i0 = Math.floor(e[0] / LINK), j0 = Math.floor(e[1] / LINK);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const o of eg.get((i0 + di) * 65536 + j0 + dj) || []) {
      if (o[2] !== e[2] && Math.hypot(o[0] - e[0], o[1] - e[1]) < LINK) { const a = find(o[2]), b = find(e[2]); if (a !== b) par[Math.max(a, b)] = Math.min(a, b); }
    }
  }
  const cidOf = new Map();
  segs.forEach((s, i) => { const root = find(i); if (!cidOf.has(root)) { cidOf.set(root, L.clusters.length); L.clusters.push({ id: L.clusters.length, segs: [], soft: [], gates: [], nodes: [], vis: null, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }); } s.c = cidOf.get(root); L.clusters[s.c].segs.push(i); });
  for (const g of L.gates) {
    const s = segs.find((q) => q.bid === g.id); if (!s) continue;
    g.c = s.c; L.clusters[g.c].gates.push(g);
    // the passage as a segment (a barrier only to those it is shut against)
    g.seg = segs.length;
    segs.push({ x0: g.px - g.ux * g.half, y0: g.py - g.uy * g.half, x1: g.px + g.ux * g.half, y1: g.py + g.uy * g.half, r: g.r, team: g.team, bid: g.id, c: g.c, gate: g });
  }
  // the ditches join the circuit they lie along (the nearest wall's)
  for (const d of soft) {
    let bc = -1, bd = 12; for (const s2 of segs) { if (s2.gate || s2.c < 0) continue; const q = pointSeg((d.x0 + d.x1) / 2, (d.y0 + d.y1) / 2, s2.x0, s2.y0, s2.x1, s2.y1); if (q < bd) { bd = q; bc = s2.c; } }
    if (bc < 0) continue;
    d.c = bc; L.clusters[bc].soft.push(segs.length); segs.push(d);
  }
  for (const C of L.clusters) {
    for (const i of C.segs) { const s = segs[i]; C.x0 = Math.min(C.x0, s.x0, s.x1); C.y0 = Math.min(C.y0, s.y0, s.y1); C.x1 = Math.max(C.x1, s.x0, s.x1); C.y1 = Math.max(C.y1, s.y0, s.y1); }
    C.nodes = clusterNodes(L, C);
  }
  // the barrier index
  segs.forEach((s, i) => {
    const pad = s.r + 1;
    for (let gi = Math.floor((Math.min(s.x0, s.x1) - pad) / GRID); gi <= Math.floor((Math.max(s.x0, s.x1) + pad) / GRID); gi++)
      for (let gj = Math.floor((Math.min(s.y0, s.y1) - pad) / GRID); gj <= Math.floor((Math.max(s.y0, s.y1) + pad) / GRID); gj++) {
        const cx = (gi + 0.5) * GRID, cy = (gj + 0.5) * GRID;
        if (pointSeg(cx, cy, s.x0, s.y0, s.x1, s.y1) > GRID * 0.75 + pad) continue;
        const k = gi * 65536 + gj; (L.grid.get(k) || L.grid.set(k, []).get(k)).push(i);
      }
  });
  L.seen = new Uint32Array(segs.length);
  return L;
}

// Route nodes of a cluster: round every joint (in each angular gap between the walls meeting there) and every free end
// (beyond it and to either side), dropped where they stand inside any wall's clearance; plus the gates' pairs.
function clusterNodes(L, C) {
  const segs = L.segs, J = []; // joints: { x, y, dirs: [angle] }
  const add = (x, y, a) => { let j = J.find((q) => Math.hypot(q.x - x, q.y - y) < 1.2); if (!j) J.push((j = { x, y, dirs: [] })); j.dirs.push(a); };
  for (const i of C.segs) { const s = segs[i]; add(s.x0, s.y0, Math.atan2(s.y1 - s.y0, s.x1 - s.x0)); add(s.x1, s.y1, Math.atan2(s.y0 - s.y1, s.x0 - s.x1)); }
  const nodes = [];
  const free = (x, y) => { for (const i of C.segs.concat(C.soft)) { const s = segs[i]; if (pointSeg(x, y, s.x0, s.y0, s.x1, s.y1) < s.r + 0.25) return false; } return true; };
  const put = (x, y, gate = null, side = 0) => { if (!gate && nodes.some((n) => Math.hypot(n.x - x, n.y - y) < 1.0)) return; nodes.push({ x, y, gate, side }); };
  for (const j of J) {
    const d = j.dirs.slice().sort((a, b) => a - b), cand = [];
    if (d.length === 1) { for (const off of [Math.PI, Math.PI - 1.2, Math.PI + 1.2]) cand.push([d[0] + off, NODE_R]); }
    else for (let k = 0; k < d.length; k++) {
      const a = d[k], b = k + 1 < d.length ? d[k + 1] : d[0] + 2 * Math.PI, g = b - a;
      if (g < 0.3) continue;
      cand.push([a + g / 2, Math.min(14, NODE_R / Math.max(0.35, Math.sin(Math.min(g, Math.PI) / 2)))]);
    }
    for (const [a, R] of cand) for (const m of [1, 1.6, 2.4]) { const x = j.x + Math.cos(a) * R * m, y = j.y + Math.sin(a) * R * m; if (free(x, y)) { put(x, y); break; } }
  }
  // (a node in a gate's passage — round the inner end of a flank — is only there for those the gate is open to)
  for (const nd of nodes) for (const g of C.gates) if (Math.abs((nd.x - g.px) * g.nx + (nd.y - g.py) * g.ny) < 2 && Math.abs((nd.x - g.px) * g.ux + (nd.y - g.py) * g.uy) < g.half + 1) nd.ing = g;
  for (const g of C.gates) for (const sd of [1, -1]) put(g.px + g.nx * PORTAL_D * sd, g.py + g.ny * PORTAL_D * sd, g, sd);
  const n = nodes.length; C.vis = new Uint8Array(n * n); // 0 unknown; else 1 | 2 (walls block it) | 4 (walls or a ditch do) — shut gates are per team
  return nodes;
}

// ---------------------------------------------------------------- geometry
export function pointSeg(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}
const cross = (x0, y0, x1, y1, px, py) => (x1 - x0) * (py - y0) - (y1 - y0) * (px - x0);
function segSeg(ax, ay, bx, by, s) {
  const d1 = cross(s.x0, s.y0, s.x1, s.y1, ax, ay), d2 = cross(s.x0, s.y0, s.x1, s.y1, bx, by), d3 = cross(ax, ay, bx, by, s.x0, s.y0), d4 = cross(ax, ay, bx, by, s.x1, s.y1);
  if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return 0;
  return Math.min(pointSeg(ax, ay, s.x0, s.y0, s.x1, s.y1), pointSeg(bx, by, s.x0, s.y0, s.x1, s.y1), pointSeg(s.x0, s.y0, ax, ay, bx, by), pointSeg(s.x1, s.y1, ax, ay, bx, by));
}
// does the walk a → b meet barrier s? (a man already inside a wall's clearance may walk on as long as he comes no nearer)
function hits(ax, ay, bx, by, s) {
  const lim = Math.min(s.r, pointSeg(ax, ay, s.x0, s.y0, s.x1, s.y1) - 0.05, pointSeg(bx, by, s.x0, s.y0, s.x1, s.y1) - 0.05);
  return lim > 0 && segSeg(ax, ay, bx, by, s) < lim;
}
// is gate g open to `team`?
export function gateOpen(w, g, team) {
  const b = g.b;
  if (b.gateBroken || b.forcedOpen) return true;
  return team === b.team || !isFoe(w, team, b.team);
}

// the first barrier (for `team`; team < 0: walls only, every passage open) the walk a → b meets, or -1
function firstHit(w, L, team, ax, ay, bx, by, only = -1, soft = false) {
  const st = ++L.stamp; if (st >= 0xffffffff) { L.seen.fill(0); L.stamp = 1; }
  const d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(d / (GRID * 0.5)));
  let best = -1, bt = Infinity;
  for (let k = 0; k <= n; k++) {
    const x = ax + (bx - ax) * k / n, y = ay + (by - ay) * k / n, gi = Math.floor(x / GRID), gj = Math.floor(y / GRID);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const b = L.grid.get((gi + di) * 65536 + gj + dj); if (!b) continue;
      for (const i of b) {
        if (L.seen[i] === st) continue; L.seen[i] = st;
        const s = L.segs[i];
        if (only >= 0 && s.c !== only) continue;
        if (s.soft && !soft) continue;
        if (s.gate && (team < 0 || gateOpen(w, s.gate, team))) continue;
        if (!hits(ax, ay, bx, by, s)) continue;
        const t = ((s.x0 + s.x1) / 2 - ax) * (bx - ax) + ((s.y0 + s.y1) / 2 - ay) * (by - ay); // (the nearest of several)
        if (t < bt) { bt = t; best = i; }
      }
    }
  }
  return best;
}
export function clear(w, team, ax, ay, bx, by) { if (!any(w)) return true; return firstHit(w, layerOf(w), team, ax, ay, bx, by) < 0; }
// a cheap test: is there any barrier within r of (x, y)?
export function near(w, x, y, r) {
  if (!w.features?.length) return false;
  const L = layerOf(w);
  for (const C of L.clusters) if (x > C.x0 - r && x < C.x1 + r && y > C.y0 - r && y < C.y1 + r) return true;
  return false;
}

// ---------------------------------------------------------------- routes
// A point a man can stand on: one inside a wall's clearance is moved out of it, onto the side `toward` is on.
function standOff(L, x, y, tx, ty) {
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    const gi = Math.floor(x / GRID), gj = Math.floor(y / GRID);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const i of L.grid.get((gi + di) * 65536 + gj + dj) || []) {
      const s = L.segs[i]; if (s.gate) continue;
      const d = pointSeg(x, y, s.x0, s.y0, s.x1, s.y1); if (d >= s.r) continue;
      const dx = s.x1 - s.x0, dy = s.y1 - s.y0, l = Math.hypot(dx, dy) || 1; let nx = -dy / l, ny = dx / l;
      if ((tx - s.x0) * nx + (ty - s.y0) * ny < 0) { nx = -nx; ny = -ny; }
      const side = (x - s.x0) * nx + (y - s.y0) * ny, push = s.r + 0.3 - side;
      x += nx * push; y += ny * push; moved = true;
    }
    if (!moved) break;
  }
  return [x, y];
}
// → null if the straight way is clear for `team`; else { pts: [[x, y] …] ending at (bx, by), gates: [gate building ids] }
// by the gates, gaps and corners; or { pts: null, stop: [x, y] } when walls shut the team out (the foot of the first one).
export function route(w, team, ax, ay, bx, by) {
  if (!any(w)) return null;
  const L = layerOf(w);
  let h = firstHit(w, L, team, ax, ay, bx, by);
  if (h < 0) { const g = crossed(L, team, ax, ay, [[bx, by]]); return g.length ? { pts: [[bx, by]], gates: g } : null; } // (straight through a gate of our own: the gate is named, so the warden opens it to us)
  const [Bx, By] = standOff(L, bx, by, ax, ay);
  const cl = new Set([L.segs[h].c]);
  for (let it = 0; it < 4; it++) {
    const cs = [...cl].sort((p, q) => p - q), R = search(w, L, team, cs, ax, ay, Bx, By) || search(w, L, team, cs, ax, ay, Bx, By, false);
    if (!R) break;
    // a leg that meets a wall of another circuit: take that circuit in too, and look again
    let a = [ax, ay], more = -1;
    for (const p of R.pts) { const k = firstHit(w, L, team, a[0], a[1], p[0], p[1]); if (k >= 0 && !cl.has(L.segs[k].c)) { more = L.segs[k].c; break; } a = p; }
    if (more < 0) { if (Bx !== bx || By !== by) R.pts.push([bx, by]); return R; }
    cl.add(more);
  }
  // shut out: as far as the foot of the first wall on the straight way
  const s = L.segs[h], d = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / d, uy = (by - ay) / d;
  let t = d; for (let q = 0; q <= d; q += 1) if (pointSeg(ax + ux * q, ay + uy * q, s.x0, s.y0, s.x1, s.y1) < s.r + 1.5) { t = q; break; }
  return { pts: null, gates: [], stop: [ax + ux * Math.max(0, t), ay + uy * Math.max(0, t)] };
}
// a leg's cost over its length: wading is slow work (the share of it in water > 0.25, sampled every 4 m, costs 7×)
function wetMul(w, a, b) {
  const M = w.map; if (!M?.water) return 1;
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(d / 4)); let wet = 0;
  for (let k = 0; k <= n; k++) if (M.water(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) > 0.25) wet++;
  return 1 + 6 * wet / (n + 1);
}
function search(w, L, team, cls, ax, ay, bx, by, soft = true) {
  const N = []; // [cluster, node index]
  for (const c of cls) { const C = L.clusters[c]; C.nodes.forEach((nd, i) => { if ((nd.gate && !gateOpen(w, nd.gate, team)) || (nd.ing && !gateOpen(w, nd.ing, team))) return; N.push([c, i]); }); }
  const n = N.length, S = n, T = n + 1, P = (k) => k === S ? [ax, ay] : k === T ? [bx, by] : (({ x, y }) => [x, y])(L.clusters[N[k][0]].nodes[N[k][1]]);
  const dist = new Float64Array(n + 2).fill(Infinity), prev = new Int32Array(n + 2).fill(-1), done = new Uint8Array(n + 2);
  const vis = (i, j) => {
    if (i === S || j === T || i === T || j === S) { const a = P(i), b = P(j); return firstHit(w, L, team, a[0], a[1], b[0], b[1], -1, soft) < 0; }
    const [ci, ni] = N[i], [cj, nj] = N[j];
    const A = L.clusters[ci].nodes[ni], B = L.clusters[cj].nodes[nj];
    if (A.gate && A.gate === B.gate) return true; // (through the passage itself: it is open to us, or neither node is here)
    if (ci === cj) {
      const C = L.clusters[ci], m = C.nodes.length, key = ni * m + nj;
      if (!C.vis[key]) { const wall = firstHit(w, L, -1, A.x, A.y, B.x, B.y, ci) < 0, dry = wall && firstHit(w, L, -1, A.x, A.y, B.x, B.y, ci, true) < 0; C.vis[key] = C.vis[nj * m + ni] = 1 | (wall ? 0 : 2) | (dry ? 0 : 4); }
      if (C.vis[key] & (soft ? 4 : 2)) return false;
      for (const g of C.gates) if (!gateOpen(w, g, team) && hits(A.x, A.y, B.x, B.y, L.segs[g.seg])) return false;
      return true;
    }
    return firstHit(w, L, team, A.x, A.y, B.x, B.y, -1, soft) < 0;
  };
  dist[S] = 0;
  for (;;) {
    let k = -1, bd = Infinity; for (let q = 0; q < n + 2; q++) if (!done[q] && dist[q] < bd) { bd = dist[q]; k = q; }
    if (k < 0 || k === T) break;
    done[k] = 1;
    const a = P(k);
    for (let q = 0; q < n + 2; q++) {
      if (done[q] || q === S) continue;
      const b = P(q), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (bd + len >= dist[q]) continue;
      const d = bd + len * wetMul(w, a, b); // (round a town by the dry side, not through the river that is its moat)
      if (d >= dist[q]) continue;
      if (!vis(k, q)) continue;
      dist[q] = d; prev[q] = k;
    }
  }
  if (!isFinite(dist[T])) return null;
  const pts = [], gates = [];
  for (let k = T; k !== S && k >= 0; k = prev[k]) {
    pts.push(P(k));
    if (k < n) { const nd = L.clusters[N[k][0]].nodes[N[k][1]], g = nd.gate || nd.ing; if (g && !gates.includes(g.id)) gates.push(g.id); }
  }
  pts.reverse(); gates.reverse();
  for (const id of crossed(L, team, ax, ay, pts)) if (!gates.includes(id)) gates.push(id); // (a leg straight through a passage, not by its nodes)
  return { pts, gates, len: dist[T] };
}
// the gates (open to `team`) whose passages the walk a → pts… goes through, in the order met. A route's gates are what the
// warden opens to the men coming (markPass: a gate shut while the enemy is near is a wall to its own men too — the leaves
// are barred), and what puts a body into column for the passage: a gate walked through but not named is neither.
function crossed(L, team, ax, ay, pts) {
  const out = []; if (!L.gates.length) return out;
  let a = [ax, ay];
  for (const p of pts) {
    const hit = [];
    for (const g of L.gates) {
      if (g.seg < 0) continue;
      const s = L.segs[g.seg];
      if (segSeg(a[0], a[1], p[0], p[1], s) > 0.01) continue;
      hit.push([(g.px - a[0]) * (p[0] - a[0]) + (g.py - a[1]) * (p[1] - a[1]), g.id]);
    }
    hit.sort((q, r) => q[0] - r[0] || q[1] - r[1]); for (const [, id] of hit) if (!out.includes(id)) out.push(id);
    a = p;
  }
  void team; return out;
}
export function gatesCrossed(w, team, ax, ay, pts) { if (!any(w)) return []; return crossed(layerOf(w), team, ax, ay, pts); }

// ---------------------------------------------------------------- walkers
// The point a walker heads for now on his way to (tx, ty): the target itself when the way is clear, else the next node of
// the route round the walls. `memo` (an array the caller keeps with the man: [wx, wy, tx, ty, sig]) holds the waypoint
// until he reaches it, the target moves, or the walls change, so the route is worked out once per leg, not every tick.
export function via(w, team, x, y, tx, ty, memo) {
  if (!any(w)) return null;
  const sig = layerOf(w).sig;
  if (memo.length === 5 && memo[4] === sig && Math.hypot(memo[2] - tx, memo[3] - ty) < 4 && Math.hypot(memo[0] - x, memo[1] - y) > 1.5) return memo[0] === tx && memo[1] === ty ? null : [memo[0], memo[1]];
  const R = route(w, team, x, y, tx, ty);
  let p = null;
  if (R?.pts) { p = R.pts[0]; if (Math.hypot(p[0] - x, p[1] - y) < 1.5 && R.pts.length > 1) p = R.pts[1]; if (R.gates.length) markPass(w, R.gates[0], x, y); }
  memo.length = 5; memo[0] = p ? p[0] : tx; memo[1] = p ? p[1] : ty; memo[2] = tx; memo[3] = ty; memo[4] = sig;
  return p;
}
// the warden opens a shut gate to his own people coming through it (siege.js gatesTick reads b.passT)
export function markPass(w, gid, x, y) {
  if (!any(w)) return;
  const g = layerOf(w).gates.find((q) => q.id === gid);
  if (g && Math.hypot(g.px - x, g.py - y) < 40) g.b.passT = w.tick;
}
// A man of a body whose way to his place in the ranks runs into a wall: he makes for the nearest gate open to him from
// which his place is in sight — its mouth on his side first, then square through it; a man farther astray (his place
// beyond more walls than one gate's) follows the full route. Stateless: worked out from where he stands each time.
export function manTarget(w, team, x, y, tx, ty) {
  const L = layerOf(w);
  const h = firstHit(w, L, team, x, y, tx, ty); if (h < 0) return ditchWay(w, L, team, x, y, tx, ty);
  const C = L.clusters[L.segs[h].c];
  let best = null, bc = Infinity, bg = null;
  for (const g of C.gates) {
    if (!gateOpen(w, g, team)) continue;
    // in the gate's own frame: a along the wall line from the passage's middle, b out through it
    const a = (x - g.px) * g.ux + (y - g.py) * g.uy, b = (x - g.px) * g.nx + (y - g.py) * g.ny, bt = (tx - g.px) * g.nx + (ty - g.py) * g.ny;
    const sm = Math.sign(b) || 1, st = Math.sign(bt) || 1;
    if (sm === st) continue;
    const mx = g.px + g.nx * MOUTH * sm, my = g.py + g.ny * MOUTH * sm, fx = g.px - g.nx * PORTAL_D * sm, fy = g.py - g.ny * PORTAL_D * sm;
    const c = Math.hypot(mx - x, my - y) + Math.hypot(tx - fx, ty - fy);
    if (c >= bc) continue;
    if (firstHit(w, L, team, fx, fy, tx, ty) >= 0) continue; // (his place is not in sight beyond this gate: the full route, below)
    let p;
    // in the throat (clear of the flanks' ends): straight through, square to the wall — the walls' solid ends
    // (siege.js barrierResolve) put back a man who cuts across a flank's end on the slant
    if (Math.abs(a) < g.half - 1 && Math.abs(b) < MOUTH + 0.6) { const ka = a * 0.5; p = [g.px + g.ux * ka - g.nx * PORTAL_D * sm, g.py + g.uy * ka - g.ny * PORTAL_D * sm]; }
    else if (Math.hypot(mx - x, my - y) < 40 && (Math.abs(b) < MOUTH + 0.6 || firstHit(w, L, team, x, y, mx, my) < 0)) p = [mx, my]; // (to the mouth, on his own side)
    else continue;
    bc = c; best = p; bg = g;
  }
  if (best) { if (Math.hypot(bg.px - x, bg.py - y) < 12) bg.b.passT = w.tick; return best; }
  // no gate: the full route (gaps, breaches, round the end of an unfinished circuit) — for a man far astray, worked out
  // from the middle of the 2 m square he stands in to his place rounded to 4 m, and remembered: a pure function of that
  // key (so a restored world, its cache empty, finds the same), taken when he can walk straight to its first point
  const qx = Math.round(x / 2), qy = Math.round(y / 2), qtx = Math.round(tx / 4), qty = Math.round(ty / 4), key = `${team}|${qx}|${qy}|${qtx}|${qty}`;
  const M = (L.astray ||= new Map());
  let p = M.get(key);
  if (p === undefined) { if (M.size > 4000) M.clear(); const R = route(w, team, qx * 2, qy * 2, qtx * 4, qty * 4); p = R?.pts ? R.pts[0] : null; M.set(key, p); }
  if (p && firstHit(w, L, team, x, y, p[0], p[1]) < 0) return p;
  const R = route(w, team, x, y, tx, ty);
  return R?.pts ? R.pts[0] : null;
}
// No wall between a man and his place, but a palisade's ditch along the way: a man fallen behind his body as it goes round
// the outside of a circuit cut the corners to his place along the ditch (crossable: at a crawl, 10–20 % pace) and fell
// further behind, a fifth of a company arriving minutes late. He keeps out of it by the route's nodes (they stand clear of
// it) — worked out like an astray man's: from his 2 m square to his place rounded to 4 m, remembered, taken when he can
// walk to it without the ditch. null: straight on (no ditch, or no way round it).
function ditchWay(w, L, team, x, y, tx, ty) {
  if (!L.clusters.some((C) => C.soft.length)) return null;
  const k = firstHit(w, L, team, x, y, tx, ty, -1, true); if (k < 0 || !L.segs[k].soft) return null;
  const qx = Math.round(x / 2), qy = Math.round(y / 2), qtx = Math.round(tx / 4), qty = Math.round(ty / 4), key = `d${team}|${qx}|${qy}|${qtx}|${qty}`;
  const M = (L.astray ||= new Map());
  let p = M.get(key);
  if (p === undefined) { if (M.size > 4000) M.clear(); const R = search(w, L, team, [L.segs[k].c], qx * 2, qy * 2, qtx * 4, qty * 4, true); p = R?.pts && R.pts.length > 1 ? R.pts[0] : null; M.set(key, p); }
  return p && firstHit(w, L, team, x, y, p[0], p[1], -1, true) < 0 ? p : null;
}
// a formation slot across a wall from its body's centre: brought back to the body's side, just short of the wall
export function pullSlot(w, team, ax, ay, tx, ty) {
  const L = layerOf(w);
  const h = firstHit(w, L, team, ax, ay, tx, ty); if (h < 0) return null;
  const s = L.segs[h], d = Math.hypot(tx - ax, ty - ay) || 1, ux = (tx - ax) / d, uy = (ty - ay) / d;
  let t = 0; for (let q = 0; q <= d; q += 0.5) { if (pointSeg(ax + ux * q, ay + uy * q, s.x0, s.y0, s.x1, s.y1) < s.r + 0.6) break; t = q; }
  return [ax + ux * t, ay + uy * t];
}
// the gates a list of route points passes (for the gate's warden, and the body's column through it)
export function gatesNear(w, x, y, r) {
  if (!any(w)) return [];
  return layerOf(w).gates.filter((g) => Math.hypot(g.px - x, g.py - y) < r);
}
export function stats(w) { const L = layerOf(w); return { segs: L.segs.length, gates: L.gates.length, clusters: L.clusters.length, nodes: L.clusters.reduce((s, C) => s + C.nodes.length, 0) }; }
