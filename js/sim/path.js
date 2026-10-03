import { terrainAt, terrainEntry, goingOf } from "./landread.js";
// Coarse A* over the map. Cost reflects real going: surface, slope, water. Rebuilt per arm class
// (foot / cavalry / cart) because a marsh that foot can wade is a death-trap for horses.
// The costs as the land alone makes them are a pure function of the map: computed once per map (per terrain table and
// cell size) and copied for every world built on it — a 16 km world's nav took ~30 s to cost (docs/big-world.md).
const pristine = new WeakMap();
export function pristineNav(map, terrain, cellM = 25) {
  let byT = pristine.get(map); if (!byT) pristine.set(map, (byT = new Map()));
  const key = cellM + "|" + (terrain ? (tKeys.get(terrain) ?? tKeys.set(terrain, tKeys.size).get(terrain)) : -1);
  let P = byT.get(key); if (!P) byT.set(key, (P = costNav(map, terrain, cellM)));
  return P;
}
const tKeys = new Map();
export function makeNav(map, terrain, cellM = 25) {
  const P = pristineNav(map, terrain, cellM), classes = {}, base = {};
  for (const cls in P.classes) { classes[cls] = Float32Array.from(P.classes[cls]); base[cls] = Float32Array.from(P.classes[cls]); }
  return { n: P.n, cellM, ox: P.ox, oy: P.oy, classes, base, map, detailed: P.detailed };
}
function costNav(map, terrain, cellM) {
  const n = Math.ceil(map.size / cellM) + 1, ox = map.x0 || 0, oy = map.y0 || 0; // (grid node (i, j) stands at (ox + i·cellM, oy + j·cellM))
  const classes = {};
  // A campaign map with a road network is costed in detail — each cell's mean going, roads preferred, the
  // column's concertina off them (pointCost) — and its routes are string-pulled on what the march really
  // costs (lineCost). A battlefield without roads (the calibration fields) keeps the plain per-corner costs
  // and smoothing its combat bands were tuned on.
  const detailed = !!map.land?.roadCore?.some((v) => v === 1);
  for (const cls of ["foot", "cavalry", "cart"]) {
    const cost = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = Math.min(ox + i * cellM, ox + map.size), y = Math.min(oy + j * cellM, oy + map.size);
      const [gx, gy] = map.grad(x, y); const slope = Math.hypot(gx, gy);
      // (the deepest water anywhere in the cell, not just at its corner: a 15 m river can otherwise slip
      // between two samples and the route runs straight through it; fords stay shallow all across)
      const hc = cellM / 2, cx = (a) => Math.max(ox, Math.min(ox + map.size, a)), cy = (a) => Math.max(oy, Math.min(oy + map.size, a));
      const w = Math.max(map.water(x, y), map.water(cx(x + hc), y), map.water(cx(x - hc), y), map.water(x, cy(y + hc)), map.water(x, cy(y - hc)), map.water(cx(x + hc), cy(y + hc)), map.water(cx(x - hc), cy(y - hc)), map.water(cx(x + hc), cy(y - hc)), map.water(cx(x - hc), cy(y + hc)));
      // Beyond ~35° foot can barely climb; horses and carts much earlier.
      const maxSlope = cls === "foot" ? 0.8 : cls === "cavalry" ? 0.55 : 0.25;
      if (w > WADE[cls] || slope > maxSlope) { cost[j * n + i] = Infinity; continue; }
      if (detailed) {
        // the cell's going is the mean over its ground (5 × 5 samples), not one corner: a marsh or a thicket
        // between two corners is otherwise invisible to the route. A road anywhere in the cell: the route is
        // laid along it (pointCost)
        const rk = map.land.road ? roadIn(map.land, x, y, cellM / 2) : -1;
        if (rk >= 0) { cost[j * n + i] = pointCost(map, cls, landX(map.land, rk), landY(map.land, rk)); if (!isFinite(cost[j * n + i])) cost[j * n + i] = 10; continue; }
        let sum = 0, cnt = 0;
        for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) { const c = pointCost(map, cls, cx(x + a * cellM / 5), cy(y + b * cellM / 5)); sum += Math.min(c, 30); cnt++; }
        cost[j * n + i] = sum / cnt;
        continue;
      }
      const t = map.land ? terrainEntry(map.land, map.land.idx(x, y)) : terrain[map.surfaceAt(x, y)];
      const mul = t?.moveMul?.[cls] ?? t?.moveMul?.foot ?? 1;
      cost[j * n + i] = mul <= 0.02 ? Infinity : (1 / mul) * (1 + slope * 4);
    }
    classes[cls] = cost;
  }
  // (the costs as the land alone makes them: features.syncFeatureNav multiplies hedge/ditch/wall cells in
  // `classes`; the ratio to `base` is how much dearer a feature has made a cell — see lineCost)
  return { n, cellM, ox, oy, classes, detailed };
}
// a land cell's world position (landread.js: k = j·res + i over the map's extent)
const landX = (L, k) => (L.x0 || 0) + (k % L.res) * L.cell, landY = (L, k) => (L.y0 || 0) + ((k / L.res) | 0) * L.cell;

export const WADE = { foot: 1.1, cavalry: 1.3, cart: 0.6 };
// a straight walk from (ax,ay) to (bx,by) meets water this class cannot wade (sampled every 3 m)
export function wetBetween(map, cls, ax, ay, bx, by) {
  const lim = WADE[cls] ?? WADE.foot, d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(d / 3));
  for (let s = 0; s <= n; s++) if (map.water(ax + (bx - ax) * s / n, ay + (by - ay) * s / n) > lim) return true;
  return false;
}
// What a metre of march costs at one point of the land: 1/going × the slope penalty. On a road the march
// prefers it (ROAD_PREF: firm, drained, gated through the hedges, crossing at the fords — a column would rather
// go a little further on the road than straight across the fields), and its cross-slope costs little: the
// slope penalty is for climbing straight up a hillside, and a road is graded along it.
function pointCost(map, cls, x, y) {
  const L = map.land, k = L.idx(x, y);
  if (map.water(x, y) > WADE[cls]) return Infinity;
  const mul = goingOf(L, k)[cls] ?? 1; // (terrainEntry's moveMul, without building — and caching — the whole entry)
  if (mul <= 0.02) return Infinity;
  // (the route prefers the carriageway itself, not the verges: a line that drifts off it onto the verge runs
  // into the hedges that line most roads here — the walkers' going still counts the verge, landread.road)
  const road = (L.roadWay || L.road)?.[k] === 1;
  // (off the road a BODY of men loses more than one walker would: each file checks at every root and tussock
  // and the column concertinas behind it — measured on the march, a body makes ~going^1.5 of its pace)
  return (road ? ROAD_PREF : 1) / (road ? mul : mul ** 1.5) * Math.exp(L.slope[k] * (road ? 1.2 : 3.5)); // (Tobler, climbing the fall line)
}

const ROAD_PREF = 0.8;
// the land cell of the nearest road within r of (x,y), or -1
function roadIn(L, x, y, r, mask = L.road) {
  const c = L.cell, i0 = Math.round((x - (L.x0 || 0)) / c), j0 = Math.round((y - (L.y0 || 0)) / c), R = Math.ceil(r / c);
  let best = -1, bd = Infinity;
  for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
    const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= L.res || j >= L.res) continue;
    const k = j * L.res + i; if (!mask[k]) continue;
    const d = di * di + dj * dj; if (d < bd) { bd = d; best = k; }
  }
  return best;
}

export function findPath(nav, cls, x0, y0, x1, y1, opts = null) {
  const { n, cellM, ox, oy } = nav, cost = nav.classes[cls] || nav.classes.foot;
  const idx = (x, y) => Math.round((y - oy) / cellM) * n + Math.round((x - ox) / cellM);
  const s = idx(x0, y0); let g = idx(x1, y1);
  if (!isFinite(cost[g])) g = nearestPassable(nav, cost, g, x1, y1, cls);
  if (g < 0) return null;
  // a body standing on a river bank stands in a closed cell (a cell is closed if deep water lies anywhere in it): it
  // may still leave it — but only onto ground it can walk to without crossing that water. (With no way out of its own
  // cell the search died at once, the order fell back to a straight line, and the men walked at the river.)
  const s0 = isFinite(cost[s]) ? -1 : s, sCost = 10;
  // (the search's scratch is kept per grid size and stamped per search: a 16 km world's grid is 411 k cells, and
  //  allocating and filling three of them for every path cost more than the search)
  const Z = scratch(n * n), gen = ++Z.gen, gs = Z.gs, came = Z.came, closed = Z.closed, st = Z.st;
  const touch = (m) => { if (st[m] !== gen) { st[m] = gen; gs[m] = Infinity; came[m] = -1; closed[m] = 0; } };
  touch(s); touch(g);
  const heap = new Heap(); gs[s] = 0; heap.push(s, 0);
  const gi = g % n, gj = (g / n) | 0;
  const hk = nav.detailed ? ROAD_PREF * 0.95 : 0.9; // (admissible on a map with roads: no cell is cheaper than a flat road)
  const H = (k) => Math.hypot((k % n) - gi, ((k / n) | 0) - gj) * hk;
  while (heap.size) {
    const k = heap.pop();
    if (k === g) break;
    if (closed[k]) continue; closed[k] = 1;
    const ki = k % n, kj = (k / n) | 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = ki + di, nj = kj + dj; if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const m = nj * n + ni, c = cost[m]; if (!isFinite(c)) continue; touch(m);
      if (k === s0 && wetBetween(nav.map, cls, x0, y0, ox + ni * cellM, oy + nj * cellM)) continue;
      const step = (di && dj ? 1.4142 : 1) * (c + (k === s0 ? sCost : cost[k])) / 2;
      const ng = gs[k] + step;
      if (ng < gs[m]) { gs[m] = ng; came[m] = k; heap.push(m, ng + H(m)); }
    }
  }
  if (came[g] < 0 && g !== s) return null;
  const pts = []; for (let k = g; k >= 0 && k !== s; k = came[k]) pts.push([ox + (k % n) * cellM, oy + ((k / n) | 0) * cellM]);
  pts.reverse();
  // a waypoint in a road cell sits on the road itself (the grid corner can lie in the ditch beside it)
  const L = nav.map.land;
  if (nav.detailed) for (const p of pts) { if (roadIn(L, p[0], p[1], cellM / 2) < 0) continue; const k = roadIn(L, p[0], p[1], cellM / 2 + 10, L.roadCore); if (k >= 0) { p[0] = landX(L, k); p[1] = landY(L, k); } }
  if (pts.length) pts[pts.length - 1] = dryEnd(nav.map, cls, pts[pts.length - 1], x1, y1);
  const out = smooth(simplify(pts), nav, cost, x0, y0, cls, !!opts?.byCost);
  return nav.decks?.length ? threadDecks(nav, cls, x0, y0, out) : out;
}
// A bridge or a fill the men made (crossings.js: nav.decks [{ ax, ay, bx, by }]) is a few metres wide in a 25 m cell: a leg of
// the route that would cross water beside it goes by its two ends instead, so the body walks along the deck, not off it.
function threadDecks(nav, cls, x0, y0, pts) {
  const out = []; let a = [x0, y0];
  for (const b of pts) {
    if (wetBetween(nav.map, cls, a[0], a[1], b[0], b[1])) {
      let best = null, bd = 40;
      for (const D of nav.decks) { const d = segDist(D, a, b); if (d < bd) { bd = d; best = D; } }
      if (best) { const aFirst = Math.hypot(best.ax - a[0], best.ay - a[1]) <= Math.hypot(best.bx - a[0], best.by - a[1]); out.push(aFirst ? [best.ax, best.ay] : [best.bx, best.by], aFirst ? [best.bx, best.by] : [best.ax, best.ay]); }
    }
    out.push(b); a = b;
  }
  return out;
}
function segDist(D, a, b) { // how near a route leg passes the deck's middle
  const mx = (D.ax + D.bx) / 2, my = (D.ay + D.by) / 2, dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((mx - a[0]) * dx + (my - a[1]) * dy) / l2));
  return Math.hypot(a[0] + dx * t - mx, a[1] + dy * t - my);
}

// The goal's cell is closed (the click was on a bank, or in the water): the nearest open cell — on the goal's own side
// of the water. (The first open cell found used to do, and on a river bank that was as often the near bank: the route
// ended there, its last leg ran on straight across to the click, and the body walked into the river.)
function nearestPassable(nav, cost, g, x1, y1, cls) {
  const { n, cellM, map, ox, oy } = nav, gi = g % n, gj = (g / n) | 0;
  let any = -1, anyR = -1, best = -1, bd = Infinity;
  for (let r = 1; r < 20; r++) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = gi + di, j = gj + dj; if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const k = j * n + i; if (!isFinite(cost[k])) continue;
      if (any < 0) { any = k; anyR = r; }
      if (x1 === undefined) return k;
      const d = Math.hypot(ox + i * cellM - x1, oy + j * cellM - y1);
      if (d < bd && !wetBetween(map, cls, ox + i * cellM, oy + j * cellM, x1, y1)) { bd = d; best = k; }
    }
    if (best >= 0) return best;
    if (any >= 0 && r >= anyR + 3) return any; // (no open cell on its side near: the nearest there is)
  }
  return any;
}
// the route's last point: the click itself, or — if the click was in water this class cannot wade — the last dry
// point on the way to it (a body sent into a river stands on its bank, not in it)
function dryEnd(map, cls, from, x1, y1) {
  const lim = WADE[cls] ?? WADE.foot; if (map.water(x1, y1) <= lim) return [x1, y1];
  const d = Math.hypot(x1 - from[0], y1 - from[1]), n = Math.max(1, Math.ceil(d / 2)); let last = from;
  for (let s = 1; s <= n; s++) { const p = [from[0] + (x1 - from[0]) * s / n, from[1] + (y1 - from[1]) * s / n]; if (map.water(p[0], p[1]) > lim) break; last = p; }
  return last;
}

// drop collinear waypoints
function simplify(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let k = 1; k < pts.length - 1; k++) {
    const a = out[out.length - 1], b = pts[k], c = pts[k + 1];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 1e-3) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const scratches = new Map();
function scratch(len) {
  let Z = scratches.get(len);
  if (!Z || Z.gen >= 0x7ffffff0) scratches.set(len, (Z = { gen: 0, gs: new Float32Array(len), came: new Int32Array(len), closed: new Uint8Array(len), st: new Int32Array(len) }));
  return Z;
}

class Heap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(k, p) {
    const K = this.k, P = this.p; let i = K.length; K.push(k); P.push(p);
    while (i > 0) { const pa = (i - 1) >> 1; if (P[pa] <= p) break; K[i] = K[pa]; P[i] = P[pa]; i = pa; }
    K[i] = k; P[i] = p;
  }
  pop() {
    const K = this.k, P = this.p, top = K[0], lk = K.pop(), lp = P.pop();
    if (K.length) {
      let i = 0; const n = K.length;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && P[c + 1] < P[c]) c++;
        if (P[c] >= lp) break;
        K[i] = K[c]; P[i] = P[c]; i = c;
      }
      K[i] = lk; P[i] = lp;
    }
    return top;
  }
}

// String-pulling: from each point, jump to the farthest later waypoint reachable in a straight line that
// costs no more to walk than the grid route between them (so paths keep to the ford/bridge/road the A*
// found — a short cut across a wet meadow off the road is not a short cut — but lose the grid's staircase).
// (byCost: a plain map's route string-pulled on what it costs too, not on "no cell much dearer than the ends" — a route
// planned round the enemy's bowshot (crossings.js) would otherwise be pulled straight back through it)
function smooth(pts, nav, cost, x0, y0, cls, byCost = false) {
  if (pts.length < 2) return pts;
  const all = [[x0, y0], ...pts], out = [];
  const pre = [0]; if (nav.detailed || byCost) for (let k = 1; k < all.length; k++) pre.push(pre[k - 1] + lineCost(nav, cost, all[k - 1], all[k], nav.detailed ? cls : undefined, true));
  let i = 0;
  while (i < all.length - 1) {
    let j = all.length - 1;
    while (j > i + 1 && !(byCost && !nav.detailed ? lineCost(nav, cost, all[i], all[j]) <= (pre[j] - pre[i]) * 1.01 + 0.5 : straight(nav, cost, all[i], all[j], pre[j] - pre[i], cls))) j--;
    out.push(all[j]); i = j;
  }
  return out;
}
// integrated cost of walking a straight line (cost × metres), its end points excluded: on a real map read
// from the land every few metres, otherwise from the nav grid
function lineCost(nav, cost, a, b, cls, wade = false) {
  const { n, cellM, map, ox, oy } = nav, fine = nav.detailed && cls;
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.max(1, Math.ceil(d / (fine ? 6 : cellM * 0.5))), ds = d / steps;
  let sum = 0;
  for (let s = 0; s < steps; s++) {
    const t = (s + 0.5) / steps, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
    const k = Math.round((y - oy) / cellM) * n + Math.round((x - ox) / cellM);
    // (on a real map the land is read every few metres, and a hedge, ditch or wall the nav grid knows of in
    // this cell makes it dearer by the same factor — a short cut is not one if it goes through the hedge)
    const c = fine ? pointCost(map, cls, x, y) * (nav.base?.[cls]?.[k] > 0 ? cost[k] / nav.base[cls][k] : 1) : cost[k];
    if (!isFinite(c) && !wade) return Infinity;
    sum += Math.min(c, 30) * ds; // (the route itself may start in, or graze, ground it cannot use: count it dear)
  }
  return sum;
}
function straight(nav, cost, a, b, routeCost, cls) {
  if (nav.detailed) return lineCost(nav, cost, a, b, cls) <= routeCost * 1.01 + 0.5; // (a near-tie goes to the straight line; the road wins anything more)
  // a plain map (the calibration fields): no cell on the line much dearer than the ends
  const { n, cellM, ox, oy } = nav;
  const ca = cellCost(nav, cost, a), cb = cellCost(nav, cost, b), lim = Math.max(ca, cb) * 1.35 + 0.15;
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.ceil(d / (cellM * 0.5));
  for (let s = 1; s < steps; s++) {
    const t = s / steps, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
    const c = cost[Math.round((y - oy) / cellM) * n + Math.round((x - ox) / cellM)];
    if (!isFinite(c) || c > lim) return false;
  }
  return true;
}
// What a route costs to march (the same cost the A* and the string-pulling use: metres × 1/going, roads
// preferred): for comparing whole approaches, where plain length would send a column across the moss.
export function routeCost(nav, cls, from, pts) {
  const cost = nav.classes[cls] || nav.classes.foot; let sum = 0, a = [from.x, from.y];
  for (const b of pts) { sum += lineCost(nav, cost, a, b, cls, true); a = b; }
  return sum;
}
const cellCost = (nav, cost, p) => { const c = cost[Math.round((p[1] - nav.oy) / nav.cellM) * nav.n + Math.round((p[0] - nav.ox) / nav.cellM)]; return isFinite(c) ? c : 10; };

// Buildings and walls on the nav grid: cells under a footprint become very costly (not impassable —
// the coarse grid could otherwise seal a lane), so routes swing round towns instead of through houses.
export function markObstaclesOnNav(nav, rects) {
  const { n, cellM, ox, oy } = nav;
  for (const r of rects) {
    const R = Math.hypot(r.hx, r.hy);
    for (let j = Math.floor((r.y - R - oy) / cellM); j <= Math.ceil((r.y + R - oy) / cellM); j++) for (let i = Math.floor((r.x - R - ox) / cellM); i <= Math.ceil((r.x + R - ox) / cellM); i++) {
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const dx = ox + i * cellM - r.x, dy = oy + j * cellM - r.y, lx = dx * r.c + dy * r.s, ly = -dx * r.s + dy * r.c;
      if (Math.abs(lx) > r.hx + cellM * 0.35 || Math.abs(ly) > r.hy + cellM * 0.35) continue;
      for (const cls of Object.keys(nav.classes)) { const C = nav.classes[cls], k = j * n + i; if (isFinite(C[k])) C[k] = Math.max(C[k], 12); }
    }
  }
}
