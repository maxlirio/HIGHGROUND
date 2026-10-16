// THE SETTLEMENT PLANNER: a vill's layout READ FROM THE LAND it stands on, at runtime — not baked into the map.
// The owner (2026-10-02): "you need a function that again READS the land isn't BUILT into the land that allows you to
// format your settlement." Given a site and the map, planSettlement() surveys the ground round it (height, slope, water,
// marsh, woods, rock, the roads, what already stands there and the other towns' claims) and lays a medieval vill on THAT
// ground, the way a lord's surveyor or a village's first settlers would have:
//   • the KEEP / manor hall on good ground: a dry rise near (not on) water, its court (curia) on the flat;
//   • the FORM the ground asks for — a STREET village along the contour on a hillside or along a road that passes, a GREEN
//     village on open level ground (lanes leave the green's corners towards the roads, the water and the fields), a
//     HILL town (a ring lane round the crest, a street down the spine), a river-BEND town (the street runs to the neck of
//     the bend, the river is the moat on the other sides);
//   • the LANES traced over the ground (a least-effort path: they go round the steep and the wet, as tracks do);
//   • TOFTS (house plots) along the lanes, both sides, frontage to the lane, with their CROFTS (long back gardens) behind,
//     wherever the ground is dry and level enough, spaced as real holdings were (a vacant holding here and there);
//   • the GREEN (or a market widening of the street), the CHURCH on a rise by it, east–west, in its churchyard;
//   • YARDS for workshops near the green;
//   • the WALL circuit pushed out to the brow of the defensible ground — the fall of a ridge, the bank of a river — with
//     GATES where the lanes leave;
//   • the MILL on a stream with a little fall, if one is within reach.
// The result is a `town` in the same shape maps/<map>/settlements.json towns have (townplan.js buildPlan consumes it), plus
// the lanes (for the ground to be trodden: js/render/towns.js) and a few words on why (the founding preview says them).
// Deterministic: a pure function of the map, the site and the seed (the same site always gives the same plan).
// validatePlan() checks a plan against the ground (water, cliffs, overlaps, the circuit) — tools/found-test.mjs.

// ---------------------------------------------------------------- dice
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const siteSeed = (x, y, seed = 1) => (Math.imul(Math.round(x) | 0, 73856093) ^ Math.imul(Math.round(y) | 0, 19349663) ^ Math.imul(seed | 0, 83492791)) >>> 0;

// ---------------------------------------------------------------- the ground (surface keys: maps/<map>/meta.json)
const WET = new Set(["marsh", "peat_bog", "reed_bed_fen", "alder_carr", "mud", "shallow_ford", "stream_bed", "deep_water", "water_meadow"]);
const ROCK = new Set(["cliff_rock", "scree", "boulder_field", "rock_slab", "limestone_pavement", "quarry_floor"]);
const WOOD = new Set(["open_forest", "dense_forest", "pine_forest", "coppice", "bramble_thicket", "alder_carr"]);
const ROADS = new Set(["dirt_track", "hollow_way", "village_street"]);
export const SIZES = {
  // the seat of a house (a town in the making) and a daughter settlement (a village round a manor hall)
  town: { R: 380, curia: [56, 42], street: 230, plots: 42, front: [15, 24], depth: [26, 40], croft: [45, 80], yard: 8, green: 48, churchyard: [46, 34], ringCore: 28, millR: 900, reach: 300 },
  village: { R: 300, curia: [44, 32], street: 160, plots: 26, front: [14, 22], depth: [24, 34], croft: [38, 64], yard: 4, green: 36, churchyard: [38, 28], ringCore: 16, millR: 700, reach: 210 },
};
const STEP = 4;                 // survey grid (m)
const TOFT_SLOPE = 0.16, CROFT_SLOPE = 0.22, CURIA_SLOPE = 0.11, CHURCH_SLOPE = 0.12;

// ---------------------------------------------------------------- geometry
export function rect(cx, cy, ang, L, W) {
  const c = Math.cos(ang), s = Math.sin(ang), a = L / 2, b = W / 2;
  return [[cx - c * a + s * b, cy - s * a - c * b], [cx + c * a + s * b, cy + s * a - c * b], [cx + c * a - s * b, cy + s * a + c * b], [cx - c * a - s * b, cy - s * a + c * b]];
}
export function pip(x, y, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
export function polysOverlap(A, B) { // convex polygons, separating axes
  for (const P of [A, B]) for (let i = 0; i < P.length; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length], ax = -(y2 - y1), ay = x2 - x1;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, y] of A) { const d = x * ax + y * ay; if (d < a0) a0 = d; if (d > a1) a1 = d; }
    for (const [x, y] of B) { const d = x * ax + y * ay; if (d < b0) b0 = d; if (d > b1) b1 = d; }
    if (a1 <= b0 + 1e-6 || b1 <= a0 + 1e-6) return false;
  }
  return true;
}
const shrink = (P, m) => { let cx = 0, cy = 0; for (const [x, y] of P) { cx += x; cy += y; } cx /= P.length; cy /= P.length; return P.map(([x, y]) => { const d = Math.hypot(x - cx, y - cy) || 1, k = Math.max(0.05, (d - m) / d); return [cx + (x - cx) * k, cy + (y - cy) * k]; }); };
const centroid = (P) => { let x = 0, y = 0; for (const p of P) { x += p[0]; y += p[1]; } return [x / P.length, y / P.length]; };
function arclen(pts) { const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return s; }
function atS(pts, S, s) { // point and unit tangent at arc length s
  let i = 1; while (i < pts.length - 1 && S[i] < s) i++;
  const a = pts[i - 1], b = pts[i], L = S[i] - S[i - 1] || 1, t = Math.max(0, Math.min(1, (s - S[i - 1]) / L));
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  return [[a[0] + dx * t, a[1] + dy * t], [dx / l, dy / l]];
}
function chaikin(pts, it = 2, closed = false) {
  let p = pts;
  for (let k = 0; k < it; k++) {
    const out = closed ? [] : [p[0]], n = p.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) { const a = p[i], b = p[(i + 1) % n]; out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); }
    if (!closed) out.push(p[n - 1]);
    p = out;
  }
  return p;
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
  let k = -1, dm = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > dm) { dm = d; k = i; } }
  if (dm <= eps) return [pts[0], pts[pts.length - 1]];
  return rdp(pts.slice(0, k + 1), eps).slice(0, -1).concat(rdp(pts.slice(k), eps));
}
function resample(pts, step) {
  const S = arclen(pts), out = []; if (pts.length < 2) return pts.slice();
  for (let s = 0; s <= S[S.length - 1] + 1e-6; s += step) out.push(atS(pts, S, s)[0]);
  if (Math.hypot(out[out.length - 1][0] - pts[pts.length - 1][0], out[out.length - 1][1] - pts[pts.length - 1][1]) > step * 0.4) out.push(pts[pts.length - 1].slice());
  return out;
}
function hull(pts) {
  const P = pts.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function segX(a, b, c, d) { // intersection point of segments ab and cd, or null
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1], den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * rx, a[1] + t * ry, Math.atan2(sy, sx)] : null;
}
const R2 = (v) => Math.round(v * 100) / 100;
const P2 = (p) => [R2(p[0]), R2(p[1])];
const ccw = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length]; a += x1 * y2 - x2 * y1; } return a >= 0 ? P : P.slice().reverse(); };

// ---------------------------------------------------------------- the survey: the ground round the site, cell by cell
function survey(map, cx, cy, R, { claims = [], blocks = [], trees = null } = {}) {
  const N = Math.ceil((2 * R) / STEP) + 1, x0 = cx - R, y0 = cy - R, n = N * N;
  const z = new Float32Array(n), slope = new Float32Array(n), wet = new Uint8Array(n), wood = new Uint8Array(n), rock = new Uint8Array(n), road = new Uint8Array(n), out = new Uint8Array(n), occ = new Uint8Array(n), water = new Float32Array(n);
  const size = map.size;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, x = x0 + i * STEP, y = y0 + j * STEP;
    if (x < (map.x0 || 0) + 20 || y < (map.y0 || 0) + 20 || x > (map.x0 || 0) + size - 20 || y > (map.y0 || 0) + size - 20) { out[k] = 1; continue; }
    z[k] = map.h(x, y);
    const d = map.water(x, y); water[k] = d;
    const s = map.surfaceAt(x, y);
    if (d > 0.02 || WET.has(s)) wet[k] = d > 0.02 ? 2 : 1;
    if (ROCK.has(s)) rock[k] = 1;
    if (WOOD.has(s) || map.canopy(x, y) > 6) wood[k] = map.canopy(x, y) > 9 || s === "dense_forest" || s === "pine_forest" ? 2 : 1;
    if (ROADS.has(s)) road[k] = 1;
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i; if (out[k]) continue;
    const xm = i > 0 && !out[k - 1] ? z[k - 1] : z[k], xp = i < N - 1 && !out[k + 1] ? z[k + 1] : z[k];
    const ym = j > 0 && !out[k - N] ? z[k - N] : z[k], yp = j < N - 1 && !out[k + N] ? z[k + N] : z[k];
    slope[k] = Math.hypot((xp - xm) / (2 * STEP), (yp - ym) / (2 * STEP));
  }
  // the trees standing on the land (the map's vegetation, less what has been felled): where they stand thick it is woodland
  if (trees?.length) {
    const cnt = new Uint8Array(n);
    for (const [tx, ty] of trees) { const i = Math.round((tx - x0) / STEP), j = Math.round((ty - y0) / STEP); if (i >= 0 && j >= 0 && i < N && j < N && cnt[j * N + i] < 250) cnt[j * N + i]++; }
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      let c = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) c += cnt[(j + dj) * N + i + di];
      const k = j * N + i; if (c >= 4) wood[k] = 2; else if (c >= 2 && !wood[k]) wood[k] = 1;
    }
  }
  // other towns' claims: nobody lays a plot inside another vill's core
  for (const c of claims) markDisc(c.x, c.y, c.r, out);
  // distance to open water (a chamfer transform over the water cells)
  const dW = new Float32Array(n).fill(1e9);
  for (let k = 0; k < n; k++) if (water[k] > 0.05) dW[k] = 0;
  const D1 = STEP, D2 = STEP * Math.SQRT2;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = j * N + i; let v = dW[k]; if (i > 0) v = Math.min(v, dW[k - 1] + D1); if (j > 0) { v = Math.min(v, dW[k - N] + D1); if (i > 0) v = Math.min(v, dW[k - N - 1] + D2); if (i < N - 1) v = Math.min(v, dW[k - N + 1] + D2); } dW[k] = v; }
  for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) { const k = j * N + i; let v = dW[k]; if (i < N - 1) v = Math.min(v, dW[k + 1] + D1); if (j < N - 1) { v = Math.min(v, dW[k + N] + D1); if (i < N - 1) v = Math.min(v, dW[k + N + 1] + D2); if (i > 0) v = Math.min(v, dW[k + N - 1] + D2); } dW[k] = v; }
  const G = { N, x0, y0, z, slope, wet, wood, rock, road, out, occ, water, dW, map, cx, cy, R, polys: [] };
  G.idx = (x, y) => { const i = Math.round((x - x0) / STEP), j = Math.round((y - y0) / STEP); return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i; };
  G.at = (arr, x, y, dflt = 0) => { const k = G.idx(x, y); return k < 0 ? dflt : arr[k]; };
  G.free = (x, y) => { const k = G.idx(x, y); return k >= 0 && !out[k] && !occ[k]; };
  // what stands there already (buildings, fields, worked sites): occupied ground
  for (const b of blocks) { if (b.poly) markPoly(b.poly, occ, 1, G); else markDisc(b.x, b.y, b.r, occ); }
  return G;
  function markDisc(x, y, r, arr) {
    const i0 = Math.max(0, Math.floor((x - r - x0) / STEP)), i1 = Math.min(N - 1, Math.ceil((x + r - x0) / STEP));
    const j0 = Math.max(0, Math.floor((y - r - y0) / STEP)), j1 = Math.min(N - 1, Math.ceil((y + r - y0) / STEP));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (Math.hypot(x0 + i * STEP - x, y0 + j * STEP - y) <= r) arr[j * N + i] = 1;
  }
}
function markPoly(poly, arr, v, G) {
  const { N, x0, y0 } = G;
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (const [x, y] of poly) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, y); d = Math.max(d, y); }
  const i0 = Math.max(0, Math.floor((a - x0) / STEP)), i1 = Math.min(N - 1, Math.ceil((b - x0) / STEP)), j0 = Math.max(0, Math.floor((c - y0) / STEP)), j1 = Math.min(N - 1, Math.ceil((d - y0) / STEP));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (pip(x0 + i * STEP, y0 + j * STEP, poly)) arr[j * N + i] = v;
}
// every survey cell under a polygon: { n, bad (out/occupied/wet/rock), steep (over maxSlope), slope (mean), wood }
function underPoly(G, poly, maxSlope) {
  const { N, x0, y0 } = G;
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (const [x, y] of poly) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, y); d = Math.max(d, y); }
  const i0 = Math.floor((a - x0) / STEP), i1 = Math.ceil((b - x0) / STEP), j0 = Math.floor((c - y0) / STEP), j1 = Math.ceil((d - y0) / STEP);
  let n = 0, bad = 0, steep = 0, sl = 0, wood = 0, zlo = Infinity, zhi = -Infinity;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = x0 + i * STEP, y = y0 + j * STEP; if (!pip(x, y, poly)) continue;
    n++;
    if (i < 0 || j < 0 || i >= N || j >= N) { bad++; continue; }
    const k = j * N + i;
    if (G.out[k] || G.occ[k] || G.wet[k] || G.rock[k]) { bad++; continue; }
    if (G.slope[k] > maxSlope) steep++;
    sl += G.slope[k]; if (G.wood[k] > 1) wood++;
    zlo = Math.min(zlo, G.z[k]); zhi = Math.max(zhi, G.z[k]);
  }
  return { n, bad, steep, slope: n ? sl / n : 0, wood, rise: zhi - zlo };
}
const fits = (G, poly, maxSlope, woodOk = 0.5) => { const u = underPoly(G, poly, maxSlope); if (!(u.n > 0 && u.bad === 0 && u.steep <= u.n * 0.08 && u.wood <= u.n * woodOk)) return false; const sp = shrink(poly, 0.4), [cx, cy] = centroid(poly); return !G.polys.some((q) => Math.abs(q.c[0] - cx) < q.r + 60 && Math.abs(q.c[1] - cy) < q.r + 60 && polysOverlap(sp, q.p)); };
const claim = (G, poly) => { markPoly(poly, G.occ, 1, G); const c = centroid(poly); G.polys.push({ p: poly, c, r: Math.max(...poly.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]))) }); };

// ---------------------------------------------------------------- least-effort paths over the survey (how tracks run)
function costField(G, sx, sy, { avoidOcc = true } = {}) {
  const { N } = G, n = N * N, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  const s = G.idx(sx, sy); if (s < 0) return null;
  dist[s] = 0;
  const heap = [[0, s]]; // (a binary heap of [d, k])
  const push = (d, k) => { heap.push([d, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.length) {
    const [d, k] = pop(); if (d > dist[k]) continue;
    const i = k % N, j = (k / N) | 0;
    for (const [di, dj, l] of NB) {
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const q = jj * N + ii; if (G.out[q]) continue;
      const sl = G.slope[q], w = G.wet[q];
      let c = 1 + 40 * sl * sl + (sl > 0.25 ? 30 : 0) + (w === 2 ? 60 : w ? 4 : 0) + (G.rock[q] ? 20 : 0) + (G.wood[q] === 2 ? 2.5 : G.wood[q] ? 0.8 : 0) + (avoidOcc && G.occ[q] && !G.road[q] ? 6 : 0);
      if (G.road[q]) c *= 0.55; // an old track is the easy way
      const nd = d + c * l * STEP; if (nd < dist[q]) { dist[q] = nd; prev[q] = k; push(nd, q); }
    }
  }
  return { dist, prev };
}
function pathTo(G, F, tx, ty) {
  let k = G.idx(tx, ty); if (k < 0 || !Number.isFinite(F.dist[k])) return null;
  const pts = [];
  while (k >= 0) { pts.push([G.x0 + (k % G.N) * STEP, G.y0 + ((k / G.N) | 0) * STEP]); k = F.prev[k]; }
  return pts.reverse();
}
const smooth = (pts) => rdp(chaikin(pts, 3), 1.2);
function clipLen(pts, L) { const S = arclen(pts); if (S[S.length - 1] <= L) return pts; const out = []; for (let i = 0; i < pts.length && S[i] < L; i++) out.push(pts[i]); out.push(atS(pts, S, L)[0]); return out; }

// ---------------------------------------------------------------- the plan
// opts: { keep: {x, y, rot} (an existing keep: the plan is laid round it), kind: "town" | "village", seed, id, name, team,
//         roads: [{ pts, width, type, name }] (the map's roads), claims: [{ x, y, r }] (other vills' cores),
//         blocks: [{ x, y, r } | { poly }] (what stands there), toward: { x, y } (the mother town: a lane leads to it) }
// → town (settlements.json shape + lanes, form, why, score) or { error }
export function planSettlement(map, x, y, opts = {}) {
  const K = SIZES[opts.kind || "town"] || SIZES.town;
  const rnd = mulberry(siteSeed(x, y, opts.seed || 1));
  const G = survey(map, x, y, K.R, opts);
  const why = [];
  // ---- 1. the keep (or the keep that stands)
  const keep = opts.keep ? { x: opts.keep.x, y: opts.keep.y, rot: opts.keep.rot ?? null } : pickKeep(G, x, y, K, rnd);
  if (!keep) return { error: "no dry, level ground for a hall here" };
  const gk = map.grad(keep.x, keep.y), gl = Math.hypot(gk[0], gk[1]);
  const downhill = gl > 0.012 ? [-gk[0] / gl, -gk[1] / gl] : null;
  if (keep.rot === null || keep.rot === undefined) keep.rot = downhill ? Math.atan2(downhill[1], downhill[0]) + Math.PI / 2 : towardsRot(G, keep, opts);
  const curia = rect(keep.x, keep.y, keep.rot, K.curia[0], K.curia[1]);
  claim(G, curia);
  const prom = prominence(G, keep.x, keep.y), dWk = G.at(G.dW, keep.x, keep.y, 1e9);
  why.push(`${opts.keep ? "The keep stands" : "The hall goes"} ${prom > 4 ? `on a rise ${Math.round(prom)} m above the land round it` : prom > 1.5 ? "on a low swell of dry ground" : "on level dry ground"}${dWk < 400 ? `, ${Math.round(dWk / 10) * 10} m from water` : ""}`);
  // ---- 2. the form the ground asks for
  const form = classify(G, keep, prom, opts, K);
  // the front of the keep: the side its gate opens on (downhill, or towards the road / the neck of the bend)
  const front = form.front;
  const fx = Math.cos(front), fy = Math.sin(front);
  // ---- 3. the lanes (and the green / market place, the junction everything meets at)
  const lanes = []; let green = null, hub = null;
  const lane = (pts, width, kind, plots = true) => { if (!pts || pts.length < 2) return null; const L = { pts: pts.map(P2), width, kind, plots }; lanes.push(L); return L; };
  const gateAt = [keep.x + fx * (K.curia[1] / 2 + 6), keep.y + fy * (K.curia[1] / 2 + 6)];
  if (form.kind === "street") {
    let pts = form.road ? roadStretch(form.road, keep, K.street * 1.15) : contourStreet(G, gateAt[0] + fx * 10, gateAt[1] + fy * 10, K.street, rnd);
    if (!pts || pts.length < 3) { form.kind = "green"; why.push("too broken for a street: the houses gather round a green"); }
    else {
      pts = smooth(pts); lane(pts, form.road ? Math.max(5, form.road.width || 5) : 6, "street");
      const S = arclen(pts); let best = 0, bd = Infinity; for (let i = 0; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - gateAt[0], pts[i][1] - gateAt[1]); if (d < bd) { bd = d; best = i; } }
      const [p, t] = atS(pts, S, S[best]); hub = p;
      // a short lane from the keep's gate out to the street
      if (bd > 14) lane([gateAt, p], 4, "lane", false);
      // the market widening on the downhill side of the street by the hub
      const nx = -t[1], ny = t[0], down = G.at(G.z, p[0] + nx * 18, p[1] + ny * 18) > G.at(G.z, p[0] - nx * 18, p[1] - ny * 18) ? -1 : 1;
      for (const side of [down, -down]) {
        for (const along of [0, 30, -30, 55, -55]) {
          const [q] = atS(pts, S, Math.max(0, Math.min(S[S.length - 1], S[best] + along)));
          const mc = [q[0] + side * nx * (K.green * 0.28 + 5), q[1] + side * ny * (K.green * 0.28 + 5)];
          const poly = rect(mc[0], mc[1], Math.atan2(t[1], t[0]), K.green * 1.25, K.green * 0.5);
          if (fits(G, poly, 0.12, 0.2)) { green = { poly: poly.map(P2), kind: "market_place" }; break; }
        }
        if (green) break;
      }
      why.push(form.road ? `the street follows ${form.road.name || "the road"} that passes the keep` : "the street runs along the contour of the hillside, the houses stepped up and down it");
    }
  }
  if (form.kind === "hill") {
    const ring = crestRing(G, keep, K);
    if (!ring) { form.kind = "green"; }
    else {
      lane(ring, 5, "ring");
      hub = ring.reduce((b, p) => (!b || (p[0] - keep.x) * fx + (p[1] - keep.y) * fy > (b[0] - keep.x) * fx + (b[1] - keep.y) * fy ? p : b), null);
      // the street down the spine: the gentlest way off the hill
      const F = costField(G, hub[0], hub[1]); const tgt = descentTarget(G, keep, K, opts);
      const down = F && tgt ? pathTo(G, F, tgt[0], tgt[1]) : null;
      if (down) lane(smooth(clipLen(down, K.street)), 5, "street");
      const [mx, my] = [hub[0] * 0.5 + keep.x * 0.5, hub[1] * 0.5 + keep.y * 0.5];
      const poly = rect(mx + fx * 6, my + fy * 6, front + Math.PI / 2, K.green, K.green * 0.55);
      if (fits(G, poly, 0.13, 0.3)) green = { poly: poly.map(P2), kind: "market_place" };
      why.push("on the hilltop: a ring lane round the crest and a street down the gentlest way off it");
    }
  }
  if (form.kind === "bend") {
    const F = costField(G, gateAt[0], gateAt[1]);
    const neck = [keep.x + Math.cos(form.neck) * K.street, keep.y + Math.sin(form.neck) * K.street];
    const p = F && pathTo(G, F, ...dryNear(G, neck));
    if (p) { const s = smooth(p); lane(s, 6, "street"); hub = s[Math.min(s.length - 1, 2)]; }
    else form.kind = "green";
    if (p) why.push("in the bend of the river: the water guards it on " + Math.round(form.waterShare * 100) + "% of its sides; the street runs to the neck of the bend");
  }
  if (form.kind === "green") {
    // a GREEN before the keep: its corners send lanes to the roads, the water, the mother town and the open fields
    const gc = freeSpotNear(G, keep.x + fx * (K.curia[1] / 2 + K.green * 0.85), keep.y + fy * (K.curia[1] / 2 + K.green * 0.85), 40) || [keep.x + fx * (K.curia[1] / 2 + K.green * 0.85), keep.y + fy * (K.curia[1] / 2 + K.green * 0.85)];
    const targets = laneTargets(G, gc, keep, K, opts);
    const corners = greenCorners(gc, targets.map((t) => Math.atan2(t[1] - gc[1], t[0] - gc[0])), K.green * 0.62, rnd);
    for (let i = targets.length; i < corners.length; i++) { const a = Math.atan2(corners[i][1] - gc[1], corners[i][0] - gc[0]); targets.push(dryNear(G, clampToGrid(G, gc[0] + Math.cos(a) * K.street, gc[1] + Math.sin(a) * K.street))); }
    let gp = [];
    const ord = corners.map((c, i) => [Math.atan2(c[1] - gc[1], c[0] - gc[0]), i]).sort((a, b) => a[0] - b[0]).map((q) => q[1]);
    for (let k = 0; k < ord.length; k++) { const a = corners[ord[k]], b = corners[ord[(k + 1) % ord.length]]; gp.push(a); for (const tt of [0.33, 0.66]) { const m = [a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt], f = 0.9 + rnd() * 0.22; gp.push([gc[0] + (m[0] - gc[0]) * f, gc[1] + (m[1] - gc[1]) * f]); } }
    gp = chaikin(gp, 2, true);
    const area = Math.abs(gp.reduce((a, p, i) => { const q = gp[(i + 1) % gp.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
    if (area < K.green * K.green * 0.45) { const o = []; for (let k = 0; k < 14; k++) { const t = k / 14 * 2 * Math.PI, rr = K.green * (0.5 + 0.08 * rnd()); o.push([gc[0] + Math.cos(t) * rr * 1.25, gc[1] + Math.sin(t) * rr * 0.8]); } const c = Math.cos(front + Math.PI / 2), sn = Math.sin(front + Math.PI / 2); gp = o.map(([px, py]) => { const dx = px - gc[0], dy = py - gc[1]; return [gc[0] + dx * c - dy * sn, gc[1] + dx * sn + dy * c]; }); } // (the lanes all leave one way: a long green, not a sliver)
    const greenOk = (P) => !P.some(([px, py]) => !G.free(px, py) || G.at(G.wet, px, py) || G.at(G.slope, px, py) > 0.14) && fits(G, P, 0.14, 0.3);
    if (!greenOk(gp)) gp = rect(gc[0], gc[1], front + Math.PI / 2, K.green, K.green * 0.7);
    if (!greenOk(gp)) gp = rect(gc[0], gc[1], front + Math.PI / 2, K.green * 0.6, K.green * 0.45);
    if (greenOk(gp)) { green = { poly: gp.map(P2), kind: "green" }; lane(chaikin(gp.concat([gp[0]]), 0).map(P2), 4, "green", false); }
    else gp = rect(gc[0], gc[1], 0, 6, 6); // (no level dry ground for a green: the lanes simply meet)
    hub = gc;
    for (let i = 0; i < corners.length; i++) {
      const F = costField(G, corners[i][0], corners[i][1]); const p = F && pathTo(G, F, targets[i][0], targets[i][1]);
      if (p) lane(smooth(clipLen(p, K.street)), 5, "lane");
    }
    lane([gateAt, nearestOn(gp, gateAt)], 4, "lane", false);
    why.push(green ? `on open level ground: a green before the hall, ${corners.length} lanes leaving its corners` : `${corners.length} lanes meet before the hall (no dry level ground for a green)`);
  }
  if (!hub) hub = gateAt;
  // the roads that pass through: a vill grows along its roads (each one's stretch through the vill is a lane)
  for (const R of opts.roads || []) {
    if (form.road === R || !R.pts?.length) continue;
    let bd = Infinity; for (const p of R.pts) bd = Math.min(bd, Math.hypot(p[0] - hub[0], p[1] - hub[1]));
    if (bd > 150) continue;
    const st = roadStretch(R, { x: hub[0], y: hub[1] }, K.street);
    if (st.length > 3) lane(smooth(st), Math.max(3.5, Math.min(7, R.width || 4)), "road");
  }
  // a lane towards the mother town (a daughter's road home), and the roads near by that the vill has not taken up yet
  if (form.kind !== "green") for (const t of laneTargets(G, hub, keep, K, opts, 2)) {
    if (lanes.some((L) => L.pts.some((p) => Math.hypot(p[0] - t[0], p[1] - t[1]) < 60))) continue;
    const F = costField(G, hub[0], hub[1]); const p = F && pathTo(G, F, t[0], t[1]);
    if (p && arclen(p).at(-1) > 60) lane(smooth(clipLen(p, K.street * 0.8)), 4, "lane");
  }
  // every lane's corridor is kept clear of plots
  for (const L of lanes) markLane(G, L.pts, L.width / 2 + 1);
  if (green) claim(G, green.poly);
  // ---- 4. the church on a rise by the green, east–west, in its churchyard
  const church = pickChurch(G, green ? centroid(green.poly) : hub, K, rnd);
  if (church) { claim(G, church.churchyard); why.push(church.rise > 2 ? "the church on the rise above the green" : "the church beside the green"); }
  // ---- 5. the mill on a stream with fall
  const mill = pickMill(map, G, keep, K, opts);
  if (mill) {
    const F = costField(G, hub[0], hub[1]); const p = F && pathTo(G, F, ...clampToGrid(G, mill.x, mill.y));
    if (p) lane(smooth(p), 3.5, "mill", false);
    why.push(`a mill on the stream ${Math.round(Math.hypot(mill.x - keep.x, mill.y - keep.y) / 10) * 10} m off`);
  } else why.push("no stream with fall near: the corn is ground by hand (or carted to a mill)");
  // ---- 6. tofts and crofts along the lanes
  let plots = [];
  for (const L of lanes) {
    if (!L.plots) continue;
    const pts = resample(L.pts, 3); const S = arclen(pts);
    // a lane's plots begin where it leaves the green / the hub, and end where the vill gives way to the fields
    let s0 = 6; while (s0 < S[S.length - 1] && green && pip(...atS(pts, S, s0)[0], green.poly)) s0 += 4;
    plots = plots.concat(plantPlots(G, pts, S, s0, S[S.length - 1], L.width, K, rnd, hub));
  }
  if (form.kind === "green" && green) { // houses round the green, facing it
    const gp = resample(green.poly.concat([green.poly[0]]), 3); const S = arclen(gp);
    const side = (() => { const [p, t] = atS(gp, S, S[S.length - 1] / 4); const q = [p[0] - t[1] * 10, p[1] + t[0] * 10]; return pip(q[0], q[1], green.poly) ? -1 : 1; })();
    plots = plots.concat(plantPlots(G, gp, S, 0, S[S.length - 1], 5, K, rnd, hub, [side]));
  }
  plots.sort((a, b) => a.dist - b.dist || a.house.x - b.house.x);
  plots = plots.slice(0, K.plots);
  // ---- 7. yards for workshops by the green
  const yards = pickYards(G, hub, lanes, K, rnd);
  // ---- 8. the wall circuit on the defensible ground, gates where the lanes leave
  const core = [...curia, ...(church?.churchyard || []), ...(green?.poly || [])];
  for (const p of plots.slice(0, K.ringCore)) core.push(...p.toft, ...(p.croft || []));
  const ring = circuit(G, keep, core, K);
  // a plot the circuit runs through is no plot: the croft is cut back to the wall (dropped), a toft astride it is given up
  if (ring) {
    const crosses = (poly) => { for (let i = 0; i + 1 < ring.length; i++) for (let k = 0; k < poly.length; k++) if (segX(ring[i], ring[i + 1], poly[k], poly[(k + 1) % poly.length])) return true; return false; };
    plots = plots.filter((p) => !crosses(p.toft));
    for (const p of plots) if (p.croft && crosses(p.croft)) p.croft = null;
  }
  const gates = [];
  if (ring) {
    for (const L of lanes) {
      if (L.kind === "green" || L.kind === "ring") continue;
      for (let i = 0; i + 1 < L.pts.length; i++) for (let j = 0; j + 1 < ring.length; j++) {
        const q = segX(L.pts[i], L.pts[i + 1], ring[j], ring[j + 1]);
        if (q && gates.every((g) => Math.hypot(g.xy[0] - q[0], g.xy[1] - q[1]) > 30)) gates.push({ xy: P2(q), rot: R2(q[2]), road: L.kind });
      }
    }
    if (!gates.length) { let b = null, bd = Infinity; for (const p of ring) { const d = Math.hypot(p[0] - hub[0], p[1] - hub[1]); if (d < bd) { bd = d; b = p; } } const k = ring.indexOf(b), n2 = ring[(k + 1) % ring.length]; gates.push({ xy: P2(b), rot: R2(Math.atan2(n2[1] - b[1], n2[0] - b[0])), road: "lane" }); }
    why.push(ring.why);
  }
  // ---- the town, in settlements.json's shape
  const id = opts.id || `site_${Math.round(x)}_${Math.round(y)}`;
  const town = {
    id, name: opts.name || null, team: opts.team ?? null, style: form.kind, form: form.kind, generated: true, kind: opts.kind || "town",
    site: P2(hub), hall: { x: R2(keep.x), y: R2(keep.y), rot: R2(keep.rot), curia: ccw(curia).map(P2) },
    green: green ? { poly: ccw(green.poly).map(P2), kind: green.kind } : null,
    well: green ? P2(centroid(green.poly)) : P2(hub),
    church: church ? { x: R2(church.x), y: R2(church.y), rot: R2(church.rot), churchyard: ccw(church.churchyard).map(P2) } : null,
    plots: plots.map((p, i) => ({ id: `${id}_plot${String(i).padStart(2, "0")}`, toft: ccw(p.toft).map(P2), croft: p.croft ? ccw(p.croft).map(P2) : null, house: { x: R2(p.house.x), y: R2(p.house.y), rot: R2(p.house.rot), footprint: [8, 5] } })),
    mill: mill ? { x: R2(mill.x), y: R2(mill.y), rot: R2(mill.rot) } : null,
    enceinte: ring ? { poly: ring.map(P2), gates, kind: ring.kind } : null,
    lanes, yards,
    why,
  };
  if (!town.mill) delete town.mill;
  if (!town.church) delete town.church;
  if (!town.green) delete town.green;
  return town;
}

// The keep's site: the best-drained, most commanding level ground within reach of the chosen spot, near water but out of
// its flood, on as little woodland as can be had.
function pickKeep(G, x, y, K, rnd) {
  let best = null;
  const tryAt = (cx, cy) => {
    const gk = G.map.grad(cx, cy), gl = Math.hypot(gk[0], gk[1]), rot = gl > 0.012 ? Math.atan2(-gk[1], -gk[0]) + Math.PI / 2 : 0;
    const poly = rect(cx, cy, rot, K.curia[0], K.curia[1]), u = underPoly(G, poly, CURIA_SLOPE);
    if (!u.n || u.bad || u.steep > u.n * 0.05) return;
    const prom = prominence(G, cx, cy), dw = G.at(G.dW, cx, cy, 1e9);
    const water = dw < 35 ? -12 : dw < 80 ? 2 : dw < 300 ? 5 - (dw - 80) / 100 : -1 - Math.min(3, (dw - 300) / 200);
    const s = 1.2 * Math.max(-10, Math.min(14, prom)) - 60 * u.slope - 4 * u.rise / 10 + water - 0.025 * Math.hypot(cx - x, cy - y) - 8 * u.wood / u.n;
    if (!best || s > best.s) best = { x: cx, y: cy, rot, s };
  };
  tryAt(x, y);
  for (let r = 8; r <= 150; r += 8) for (let a = 0; a < 24; a++) { const t = a / 24 * 2 * Math.PI + r * 0.013; tryAt(x + Math.cos(t) * r, y + Math.sin(t) * r); }
  if (!best) return null;
  return { x: best.x, y: best.y, rot: best.rot };
}
function towardsRot(G, keep, opts) {
  const t = opts.toward || null;
  if (t) return Math.atan2(t.y - keep.y, t.x - keep.x) + Math.PI / 2;
  return 0;
}
// how far the spot stands above the land round it (m)
function prominence(G, x, y) {
  const z0 = G.map.h(x, y); let s = 0, n = 0;
  for (const r of [90, 130, 170]) for (let a = 0; a < 12; a++) { const t = a / 12 * 2 * Math.PI; const px = x + Math.cos(t) * r, py = y + Math.sin(t) * r; if (!G.map.inBounds(px, py)) continue; s += G.map.h(px, py); n++; }
  return n ? z0 - s / n : 0;
}
// The ground's say in the vill's form
function classify(G, keep, prom, opts, K) {
  const map = G.map;
  // water round about: rays out to 260 m
  let wet = 0, sx = 0, sy = 0, dry = [];
  for (let a = 0; a < 24; a++) {
    const t = a / 24 * 2 * Math.PI; let hit = false, run = 0;
    for (let r = 20; r <= 260; r += 10) { const px = keep.x + Math.cos(t) * r, py = keep.y + Math.sin(t) * r; if (map.water(px, py) > 0.05) { hit = true; break; } run = r; }
    if (hit) { wet++; sx += Math.cos(t); sy += Math.sin(t); } else dry.push(t);
  }
  const spread = wet ? 1 - Math.hypot(sx, sy) / wet : 0; // 0: water all on one side; → 1 it wraps round
  // the slope round the keep and on the shoulders below it
  let sl = 0, n = 0; for (let r = 30; r <= 90; r += 20) for (let a = 0; a < 12; a++) { const t = a / 12 * 2 * Math.PI, g = map.grad(keep.x + Math.cos(t) * r, keep.y + Math.sin(t) * r); sl += Math.hypot(g[0], g[1]); n++; }
  sl /= n;
  let sh = 0, m = 0; for (let r = 100; r <= 170; r += 35) for (let a = 0; a < 12; a++) { const t = a / 12 * 2 * Math.PI, g = map.grad(keep.x + Math.cos(t) * r, keep.y + Math.sin(t) * r); sh += Math.hypot(g[0], g[1]); m++; }
  sh /= m;
  const g = map.grad(keep.x, keep.y), down = Math.atan2(-g[1], -g[0]), gl = Math.hypot(g[0], g[1]);
  // a road within reach of the keep: the street follows it
  let road = null, rd = 90;
  for (const R of opts.roads || []) { if (!R.pts?.length) continue; for (const p of R.pts) { const d = Math.hypot(p[0] - keep.x, p[1] - keep.y); if (d < rd) { rd = d; road = R; } } }
  if (wet >= 9 && spread > 0.45) {
    // the neck: the middle of the longest run of dry rays
    let best = 0, bestA = down;
    for (let a = 0; a < 24; a++) { let k = 0; while (k < 24 && dry.some((t) => Math.abs(((t - (a + k) / 24 * 2 * Math.PI) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) < 1e-6)) k++; if (k > best) { best = k; bestA = (a + k / 2) / 24 * 2 * Math.PI; } }
    return { kind: "bend", front: bestA, neck: bestA, waterShare: wet / 24 };
  }
  if (prom > 5 && sh > 0.05 && sl < 0.09) return { kind: "hill", front: gl > 0.01 ? down : opts.toward ? Math.atan2(opts.toward.y - keep.y, opts.toward.x - keep.x) : 0 };
  if (road) { const p = road.pts.reduce((b, q) => (!b || Math.hypot(q[0] - keep.x, q[1] - keep.y) < Math.hypot(b[0] - keep.x, b[1] - keep.y) ? q : b), null); return { kind: "street", road, front: Math.atan2(p[1] - keep.y, p[0] - keep.x) }; }
  if (sl > 0.035) return { kind: "street", front: down };
  const tow = opts.toward ? Math.atan2(opts.toward.y - keep.y, opts.toward.x - keep.x) : gl > 0.005 ? down : -Math.PI / 2;
  return { kind: "green", front: tow };
}
// the stretch of a road through the vill (both ways from the point nearest the keep)
function roadStretch(R, keep, L) {
  const pts = resample(R.pts, 4); let k = 0, bd = Infinity;
  for (let i = 0; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - keep.x, pts[i][1] - keep.y); if (d < bd) { bd = d; k = i; } }
  const n = Math.round(L / 4); return pts.slice(Math.max(0, k - n), Math.min(pts.length, k + n + 1));
}
// a street along the contour from (x, y), both ways: it keeps its height, and stops where the ground does not carry it
function contourStreet(G, x, y, L, rnd) {
  const map = G.map, z0 = map.h(x, y), half = (sgn) => {
    let p = [x, y]; const out = [];
    let dir = null;
    for (let s = 0; s < L; s += 6) {
      const g = map.grad(p[0], p[1]); let gl = Math.hypot(g[0], g[1]);
      let t = gl > 0.004 ? [-g[1] / gl * sgn, g[0] / gl * sgn] : dir || [Math.cos(rnd() * 6.283), Math.sin(rnd() * 6.283)];
      if (dir) { t = [dir[0] * 0.6 + t[0] * 0.4, dir[1] * 0.6 + t[1] * 0.4]; const l = Math.hypot(t[0], t[1]) || 1; t = [t[0] / l, t[1] / l]; }
      dir = t;
      let q = [p[0] + t[0] * 6, p[1] + t[1] * 6];
      const g2 = map.grad(q[0], q[1]), g2l = g2[0] * g2[0] + g2[1] * g2[1];
      if (g2l > 1e-5) { const dz = map.h(q[0], q[1]) - z0; q = [q[0] - g2[0] * dz / g2l * 0.4, q[1] - g2[1] * dz / g2l * 0.4]; }
      const k = G.idx(q[0], q[1]); if (k < 0 || G.out[k] || G.wet[k] || G.rock[k] || G.slope[k] > 0.24 || (G.occ[k] && s > 10)) break;
      out.push(q); p = q;
    }
    return out;
  };
  const a = half(1), b = half(-1);
  const pts = b.reverse().concat([[x, y]], a);
  return pts.length >= 6 ? pts : null;
}
// the crest ring: the line round the hilltop a few metres below the keep's ground (the brow is kept for the wall)
function crestRing(G, keep, K) {
  const map = G.map, z0 = map.h(keep.x, keep.y), drop = K === SIZES.town ? 3.5 : 2.5, n = 36, rs = [];
  for (let a = 0; a < n; a++) {
    const t = a / n * 2 * Math.PI; let r = Math.max(K.curia[0], K.curia[1]) * 0.75;
    for (; r < 130; r += 4) { const px = keep.x + Math.cos(t) * r, py = keep.y + Math.sin(t) * r; if (map.water(px, py) > 0.02 || map.h(px, py) < z0 - drop) break; }
    rs.push(Math.min(r, 120));
  }
  let sm = rs; for (let it = 0; it < 3; it++) sm = sm.map((r, i) => 0.5 * r + 0.25 * (sm[(i + n - 1) % n] + sm[(i + 1) % n]));
  if (Math.min(...sm) < Math.max(K.curia[0], K.curia[1]) * 0.7) return null;
  const pts = sm.map((r, a) => [keep.x + Math.cos(a / n * 2 * Math.PI) * r, keep.y + Math.sin(a / n * 2 * Math.PI) * r]);
  return chaikin(pts.concat([pts[0]]), 1).concat([]);
}
function descentTarget(G, keep, K, opts) {
  const t = laneTargets(G, [keep.x, keep.y], keep, K, opts, 1)[0];
  if (t) return t;
  let best = null, bs = Infinity;
  for (let a = 0; a < 16; a++) { const th = a / 16 * 2 * Math.PI, px = keep.x + Math.cos(th) * K.street, py = keep.y + Math.sin(th) * K.street; const k = G.idx(px, py); if (k < 0 || G.out[k] || G.wet[k]) continue; let s = 0; for (let r = 20; r < K.street; r += 20) s += G.at(G.slope, keep.x + Math.cos(th) * r, keep.y + Math.sin(th) * r, 1); if (s < bs) { bs = s; best = [px, py]; } }
  return best;
}
// where a vill's lanes lead: the roads near by, the mother town, the water (the mill, the meadows), the open fields
function laneTargets(G, from, keep, K, opts, max = 4) {
  const out = [], angs = [];
  const add = (p, why) => { if (!p) return; const a = Math.atan2(p[1] - from[1], p[0] - from[0]); if (angs.some((b) => Math.abs(((a - b) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) < 0.9)) return; const q = clampToGrid(G, p[0], p[1]); if (!q) return; const k = G.idx(q[0], q[1]); if (k < 0 || G.out[k] || G.wet[k] === 2) return; angs.push(a); out.push(q); };
  if (opts.toward) add(towardPt(from, [opts.toward.x, opts.toward.y], K.street * 1.2));
  for (const R of opts.roads || []) { let b = null, bd = Infinity; for (const p of R.pts || []) { const d = Math.hypot(p[0] - from[0], p[1] - from[1]); if (d > 60 && d < bd) { bd = d; b = p; } } if (b && bd < 600) add(towardPt(from, b, K.street * 1.2)); if (out.length >= max) return out; }
  // the water
  let wb = null, wd = Infinity; const { N, x0, y0 } = G;
  for (let k = 0; k < N * N; k += 7) if (G.water[k] > 0.05) { const px = x0 + (k % N) * STEP, py = y0 + ((k / N) | 0) * STEP, d = Math.hypot(px - from[0], py - from[1]); if (d > 70 && d < wd) { wd = d; wb = [px, py]; } }
  if (wb && out.length < max) { const a = Math.atan2(wb[1] - from[1], wb[0] - from[0]), r = Math.max(40, wd - 25); add([from[0] + Math.cos(a) * r, from[1] + Math.sin(a) * r]); }
  // the open fields: the directions with the longest run of dry, workable ground
  const runs = [];
  for (let a = 0; a < 16; a++) { const t = a / 16 * 2 * Math.PI; let r = 30; for (; r < K.street * 1.2; r += 8) { const k = G.idx(from[0] + Math.cos(t) * r, from[1] + Math.sin(t) * r); if (k < 0 || G.out[k] || G.wet[k] || G.rock[k] || G.slope[k] > 0.2 || G.wood[k] === 2) break; } runs.push([r, t]); }
  runs.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [r, t] of runs) { if (out.length >= Math.max(3, Math.min(max, 3))) break; if (r < 70) break; add([from[0] + Math.cos(t) * r, from[1] + Math.sin(t) * r]); }
  return out.slice(0, max);
}
const towardPt = (a, b, L) => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]); if (d <= L) return b; return [a[0] + (b[0] - a[0]) / d * L, a[1] + (b[1] - a[1]) / d * L]; };
function clampToGrid(G, x, y) { const m = G.R - 6, dx = x - G.cx, dy = y - G.cy, d = Math.hypot(dx, dy); if (d <= m) return [x, y]; return [G.cx + dx / d * m, G.cy + dy / d * m]; }
function dryNear(G, p) { for (let r = 0; r < 80; r += 6) for (let a = 0; a < 12; a++) { const q = clampToGrid(G, p[0] + Math.cos(a / 12 * 6.283) * r, p[1] + Math.sin(a / 12 * 6.283) * r); const k = G.idx(q[0], q[1]); if (k >= 0 && !G.out[k] && !G.wet[k]) return q; } return clampToGrid(G, p[0], p[1]); }
function freeSpotNear(G, x, y, R) { for (let r = 0; r <= R; r += 4) for (let a = 0; a < 12; a++) { const px = x + Math.cos(a / 12 * 6.283) * r, py = y + Math.sin(a / 12 * 6.283) * r; const k = G.idx(px, py); if (k >= 0 && !G.out[k] && !G.occ[k] && !G.wet[k] && G.slope[k] < 0.1) return [px, py]; } return null; }
function nearestOn(poly, p) { let b = poly[0], bd = Infinity; for (const q of poly) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; b = q; } } return b; }
// the green's corners, one per lane leaving it, never closer than 62° (the lanes would merge)
function greenCorners(c, angles, r, rnd) {
  if (angles.length < 3) { const base = angles[0] ?? 0; angles = [base, base + 2.2, base - 2.1].slice(0, Math.max(3, angles.length)); }
  const ang = angles.map((a, i) => [a, i]).sort((p, q) => p[0] - q[0]); const min = 62 * Math.PI / 180;
  for (let it = 0; it < 200; it++) for (let i = 0; i + 1 < ang.length; i++) if (ang[i + 1][0] - ang[i][0] < min) { const m = (ang[i][0] + ang[i + 1][0]) / 2; ang[i][0] = m - min / 2; ang[i + 1][0] = m + min / 2; }
  const out = new Array(angles.length);
  ang.forEach(([a, i], k) => { const rr = r * (0.85 + 0.3 * rnd()); out[i] = [c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr]; void k; });
  return out;
}
function markLane(G, pts, half) {
  const { N, x0, y0 } = G;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay);
    for (let s = 0; s <= L; s += STEP / 2) {
      const px = ax + (bx - ax) * s / (L || 1), py = ay + (by - ay) * s / (L || 1);
      const i0 = Math.floor((px - half - x0) / STEP), i1 = Math.ceil((px + half - x0) / STEP), j0 = Math.floor((py - half - y0) / STEP), j1 = Math.ceil((py + half - y0) / STEP);
      for (let j = Math.max(0, j0); j <= Math.min(N - 1, j1); j++) for (let ii = Math.max(0, i0); ii <= Math.min(N - 1, i1); ii++) if (Math.hypot(x0 + ii * STEP - px, y0 + j * STEP - py) <= half) G.occ[j * N + ii] = 1;
    }
  }
}
// Tofts along a lane, both sides: frontage to the lane, the house on the street front (long side to the street, or gable
// on), the croft behind as long as the ground allows; a holding left vacant here and there. → [{ toft, croft, house, dist }]
function plantPlots(G, pts, S, s0, s1, laneW, K, rnd, hub, sides = [-1, 1]) {
  const out = []; let s = s0;
  while (s < s1 - 8) {
    const f = K.front[0] + rnd() * (K.front[1] - K.front[0]);
    if (rnd() < 0.1) { s += 10 + rnd() * 15; continue; } // a vacant holding
    const [p, t] = atS(pts, S, s + f / 2), ang = Math.atan2(t[1], t[0]), nx = -t[1], ny = t[0];
    if (Math.hypot(p[0] - hub[0], p[1] - hub[1]) > K.reach) { s += f; continue; } // (beyond the vill: the lane runs on between the fields)
    for (const side of sides) {
      const off = laneW / 2 + 2.5, dep = K.depth[0] + rnd() * (K.depth[1] - K.depth[0]);
      const mid = [p[0] + side * nx * (off + dep / 2), p[1] + side * ny * (off + dep / 2)];
      const toft = rect(mid[0], mid[1], ang, f - 1, dep);
      if (!fits(G, toft, TOFT_SLOPE, 0.08)) continue; // (a house plot is open ground: a settlement assarts the woods later, it does not begin in them)
      // the toft must not step more than a storey down its length (a house plot is levelled by hand)
      if (underPoly(G, toft, 1).rise > 4.5) continue;
      claim(G, toft);
      let croft = null;
      for (const cd of [K.croft[0] + rnd() * (K.croft[1] - K.croft[0]), K.croft[0] * 0.75, 22]) {
        const cm = [p[0] + side * nx * (off + dep + cd / 2 + 0.5), p[1] + side * ny * (off + dep + cd / 2 + 0.5)];
        const cr = rect(cm[0], cm[1], ang, f - 1, cd);
        if (fits(G, cr, CROFT_SLOPE, 0.35)) { croft = cr; claim(G, cr); break; }
      }
      const along = (rnd() * 2 - 1) * (f / 2 - 5.5);
      const gable = rnd() >= 0.7, hrot = gable ? ang + Math.PI / 2 : ang, dn = off + (gable ? 6 : 4.5);
      const house = { x: p[0] + t[0] * along + side * nx * dn, y: p[1] + t[1] * along + side * ny * dn, rot: hrot };
      out.push({ toft, croft, house, dist: Math.hypot(p[0] - hub[0], p[1] - hub[1]) });
    }
    s += f;
  }
  return out;
}
function pickChurch(G, c, K, rnd, relax = 1) {
  let best = null; const [L, W] = K.churchyard;
  for (let r = 26; r <= 90 * relax; r += 6) for (let a = 0; a < 24; a++) {
    const t = a / 24 * 2 * Math.PI + r * 0.05, x = c[0] + Math.cos(t) * r, y = c[1] + Math.sin(t) * r;
    const rot = (rnd() - 0.5) * 0.24; // chancel to the east (the liturgical orientation), give or take
    const yard = rect(x, y, rot, L, W); if (!fits(G, yard, CHURCH_SLOPE * relax, 0.15 * relax)) continue;
    const s = G.map.h(x, y) - 0.06 * r;
    if (!best || s > best.s) best = { x, y, rot, churchyard: yard, s, rise: G.map.h(x, y) - G.map.h(c[0], c[1]) };
  }
  if (!best && relax === 1) return pickChurch(G, c, K, rnd, 1.45); // (broken ground: a little further out, a little steeper)
  return best;
}
// a watermill wants a stream (not the great river: a leat off a beck with some fall), dry ground for the mill-house beside
// it, as near the vill as can be had
function pickMill(map, G, keep, K, opts) {
  const step = 8, R = K.millR; let best = null;
  const claimed = (x, y) => (opts.claims || []).some((c) => Math.hypot(c.x - x, c.y - y) < c.r);
  for (let y = keep.y - R; y <= keep.y + R; y += step) for (let x = keep.x - R; x <= keep.x + R; x += step) {
    const d = Math.hypot(x - keep.x, y - keep.y); if (d > R || d < 70) continue;
    const wd = map.water(x, y); if (!(wd > 0.05 && wd < 0.9)) continue;
    // the stream's fall along its course here
    let fall = 0; { const g = map.grad(x, y); fall = Math.hypot(g[0], g[1]); }
    // a dry bank 14–20 m off the water, square to the flow
    for (let a = 0; a < 8; a++) {
      const t = a / 8 * 2 * Math.PI, bx = x + Math.cos(t) * 16, by = y + Math.sin(t) * 16;
      if (!map.inBounds(bx, by) || map.water(bx, by) > 0.01 || claimed(bx, by)) continue;
      const g = map.grad(bx, by), sl = Math.hypot(g[0], g[1]); if (sl > 0.15) continue;
      const s = -d / 60 - sl * 30 + Math.min(fall, 0.06) * 60;
      if (!best || s > best.s) best = { x: bx, y: by, s, wx: x, wy: y };
    }
  }
  if (!best) return null;
  // the mill's long axis along the stream
  let ba = 0, bv = -1;
  for (let a = 0; a < 18; a++) { const t = a / 18 * Math.PI, u = [Math.cos(t), Math.sin(t)]; let v = 0; for (const r of [10, 20, 30]) v += map.water(best.wx + u[0] * r, best.wy + u[1] * r) + map.water(best.wx - u[0] * r, best.wy - u[1] * r); if (v > bv) { bv = v; ba = t; } }
  const k = G.idx(best.x, best.y); if (k >= 0) claim(G, rect(best.x, best.y, ba, 16, 14));
  return { x: best.x, y: best.y, rot: ba };
}
function pickYards(G, hub, lanes, K, rnd) {
  const out = [];
  for (const L of lanes) {
    if (L.kind === "mill" || out.length >= K.yard) continue;
    const pts = resample(L.pts, 4), S = arclen(pts);
    for (let s = 10; s < Math.min(S[S.length - 1], 160) && out.length < K.yard; s += 22) {
      const [p, t] = atS(pts, S, s), ang = Math.atan2(t[1], t[0]);
      for (const side of [1, -1]) {
        const off = L.width / 2 + 2 + 7, c = [p[0] - t[1] * side * off, p[1] + t[0] * side * off];
        if (Math.hypot(c[0] - hub[0], c[1] - hub[1]) > 170) continue;
        const poly = rect(c[0], c[1], ang, 18, 14); if (!fits(G, poly, 0.12, 0.2)) continue;
        claim(G, poly); out.push({ x: R2(c[0]), y: R2(c[1]), rot: R2(ang), w: 18, h: 14 }); break;
      }
    }
  }
  void rnd;
  return out;
}
// The circuit: just outside the vill's core, pushed out to the brow of the defensible ground (the steepest fall: a ridge,
// a scarp, a river bank — the water itself is the moat where it comes close), smoothed into an oval (a re-entrant angle is
// a weak point). → closed polyline (+ .why, .kind)
function circuit(G, keep, core, K) {
  const map = G.map, n = 72, cx = keep.x, cy = keep.y;
  const rmin = new Array(n).fill(K === SIZES.town ? 70 : 52);
  for (const [px, py] of core) {
    const a = Math.atan2(py - cy, px - cx), r = Math.hypot(px - cx, py - cy);
    for (let k = 0; k < n; k++) { const d = Math.abs(((a - k / n * 2 * Math.PI) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI); if (d < 9 * Math.PI / 180) rmin[k] = Math.max(rmin[k], r + 12); }
  }
  // convexify
  const U = rmin.map((r, k) => [Math.cos(k / n * 2 * Math.PI) * r, Math.sin(k / n * 2 * Math.PI) * r]), H = hull(U);
  for (let k = 0; k < n; k++) { const u = [Math.cos(k / n * 2 * Math.PI), Math.sin(k / n * 2 * Math.PI)]; rmin[k] = Math.max(rmin[k], rayPoly(u, H)); }
  const rs = new Array(n); let brows = 0, banks = 0;
  for (let k = 0; k < n; k++) {
    const u = [Math.cos(k / n * 2 * Math.PI), Math.sin(k / n * 2 * Math.PI)];
    let best = rmin[k], bv = -1e9, bank = false;
    // water inside the core's reach: the wall stands on the bank
    for (let r = 20; r <= rmin[k]; r += 4) if (map.water(cx + u[0] * r, cy + u[1] * r) > 0.02) { best = Math.max(14, r - 6); bank = true; break; }
    if (!bank) for (let r = rmin[k]; r < rmin[k] + (K === SIZES.town ? 55 : 36); r += 4) {
      const p0 = [cx + u[0] * r, cy + u[1] * r], p1 = [cx + u[0] * (r + 8), cy + u[1] * (r + 8)];
      if (map.water(...p1) > 0.02) { best = r; bank = true; break; }
      if (!map.inBounds(...p1)) break;
      const fall = (map.h(...p0) - map.h(...p1)) / 8, v = fall - 0.004 * (r - rmin[k]);
      if (v > bv) { bv = v; best = r; }
    }
    if (bank) banks++; else if (bv > 0.08) brows++;
    rs[k] = best;
  }
  let sm = rs.slice();
  for (let it = 0; it < 8; it++) { sm = sm.map((r, k) => 0.5 * r + 0.25 * (sm[(k + n - 1) % n] + sm[(k + 1) % n])); for (let k = 0; k < n; k++) sm[k] = Math.max(sm[k], Math.min(rmin[k], rs[k])); }
  let pts = sm.map((r, k) => [cx + Math.cos(k / n * 2 * Math.PI) * r, cy + Math.sin(k / n * 2 * Math.PI) * r]);
  // no stretch stands in the water: pulled in to the bank
  pts = pts.map(([x, y]) => { let q = [x, y]; for (let k = 0; k < 20 && map.water(q[0], q[1]) > 0.02; k++) q = [cx + (q[0] - cx) * 0.95, cy + (q[1] - cy) * 0.95]; return q; });
  { const h = n >> 1; pts = rdp(pts.slice(0, h + 1), 1.5).concat(rdp(pts.slice(h).concat([pts[0]]), 1.5).slice(1)); } // (a closed loop is simplified in two halves)
  if (pts.length < 5) return null;
  const share = (v) => Math.round(v / n * 100);
  pts.kind = banks > n * 0.25 ? "river" : brows > n * 0.4 ? "brow" : "ring";
  pts.why = banks > n * 0.15 ? `the circuit keeps to the river bank on ${share(banks)}% of its length, the water for a moat` : brows > n * 0.25 ? `the circuit follows the brow of the slope on ${share(brows)}% of its length` : "the circuit rings the vill on open ground: ditch and bank do the work the land will not";
  return pts;
}
function rayPoly(u, poly) {
  let best = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ey = b[1] - a[1], den = u[0] * ey - u[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = (a[0] * ey - a[1] * ex) / den, s = (a[0] * u[1] - a[1] * u[0]) / den;
    if (t > 0 && s >= -1e-6 && s <= 1 + 1e-6) best = Math.max(best, t);
  }
  return best;
}

// ---------------------------------------------------------------- checks
// → [] when the plan sits properly on its ground, else the problems found (water, cliffs, overlaps, the circuit)
export function validatePlan(map, town, { tol = 0.08 } = {}) {
  const bad = [];
  const sample = (poly, maxSlope, what, stol = tol) => {
    let n = 0, wet = 0, steep = 0, rock = 0, out = 0;
    const [x0, y0] = poly.reduce((m, p) => [Math.min(m[0], p[0]), Math.min(m[1], p[1])], [Infinity, Infinity]), [x1, y1] = poly.reduce((m, p) => [Math.max(m[0], p[0]), Math.max(m[1], p[1])], [-Infinity, -Infinity]);
    for (let y = y0; y <= y1; y += 3) for (let x = x0; x <= x1; x += 3) {
      if (!pip(x, y, poly)) continue; n++;
      if (!map.inBounds(x, y)) { out++; continue; }
      if (map.water(x, y) > 0.02) wet++;
      const g = map.grad(x, y); if (Math.hypot(g[0], g[1]) > maxSlope) steep++;
      if (ROCK.has(map.surfaceAt(x, y))) rock++;
    }
    if (!n) return;
    if (out) bad.push(`${what}: off the map`);
    if (wet > n * 0.02) bad.push(`${what}: in water (${Math.round(wet / n * 100)}%)`);
    if (steep > n * stol) bad.push(`${what}: too steep (${Math.round(steep / n * 100)}%)`);
    if (rock > n * 0.05) bad.push(`${what}: on rock (${Math.round(rock / n * 100)}%)`);
  };
  if (town.hall?.curia) sample(town.hall.curia, CURIA_SLOPE * 1.25, "the keep's court");
  if (town.church?.churchyard) sample(town.church.churchyard, CHURCH_SLOPE * 1.6, "the churchyard");
  if (town.green?.poly) sample(town.green.poly, 0.16, "the green");
  const polys = [];
  if (town.hall?.curia) polys.push(["court", town.hall.curia]);
  if (town.church?.churchyard) polys.push(["churchyard", town.church.churchyard]);
  for (const p of town.plots || []) {
    sample(p.toft, TOFT_SLOPE * 1.3, `toft ${p.id}`, 0.15);
    if (p.croft) sample(p.croft, CROFT_SLOPE * 1.3, `croft ${p.id}`);
    polys.push([p.id, p.toft]); if (p.croft) polys.push([p.id + " croft", p.croft]);
  }
  for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) if (polysOverlap(shrink(polys[i][1], 0.6), shrink(polys[j][1], 0.6))) bad.push(`${polys[i][0]} overlaps ${polys[j][0]}`);
  const E = town.enceinte;
  if (E?.poly) {
    const R = E.poly, closed = Math.hypot(R[0][0] - R[R.length - 1][0], R[0][1] - R[R.length - 1][1]) < 0.5;
    if (!closed) bad.push("the circuit is not closed");
    if (!pip(town.hall.x, town.hall.y, R)) bad.push("the keep is outside its circuit");
    for (const p of R) if (map.water(p[0], p[1]) > 0.05) { bad.push("the circuit stands in water"); break; }
    for (const g of E.gates || []) { let d = Infinity; for (let i = 0; i + 1 < R.length; i++) { const a = R[i], b = R[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((g.xy[0] - a[0]) * dx + (g.xy[1] - a[1]) * dy) / l2)); d = Math.min(d, Math.hypot(g.xy[0] - a[0] - dx * t, g.xy[1] - a[1] - dy * t)); } if (d > 3) bad.push("a gate off the circuit"); }
    if (!(E.gates || []).length) bad.push("a circuit with no gate");
  }
  if (town.mill) { let near = false; for (let a = 0; a < 16 && !near; a++) for (const r of [6, 12, 18, 24, 30]) if (map.water(town.mill.x + Math.cos(a / 16 * 6.283) * r, town.mill.y + Math.sin(a / 16 * 6.283) * r) > 0.05) { near = true; break; } if (!near) bad.push("the mill is nowhere near water"); if (map.water(town.mill.x, town.mill.y) > 0.05) bad.push("the mill stands in the stream"); }
  return bad;
}

// ---------------------------------------------------------------- world glue
// The context a plan at (x, y) is laid in: the map's roads (settlements.json, kept on w.mapRoads), the other vills' cores
// (claims), what stands there (buildings, worked sites).
export function siteContext(w, x, y, { team = null, R = 450, except = null, skipTeam = null } = {}) {
  const claims = [], blocks = [];
  for (const T of w.teams || []) {
    if (T && T.id === skipTeam) continue;
    for (const t of townsOfTeam(T)) { if (t === except || !t.x && t.x !== 0) continue; const d = Math.hypot(t.x - x, t.y - y); if (d < R + 400) claims.push({ x: t.x, y: t.y, r: t.core || 220 }); }
  }
  for (const b of w.buildings || []) {
    if (b.ruin && !b.field) continue;
    if (Math.hypot(b.x - x, b.y - y) > R + 150) continue;
    if (b.field) { blocks.push({ poly: rect(b.x, b.y, b.rot || 0, b.w, b.h) }); continue; }
    if (b.x1 !== undefined) continue;
    blocks.push({ x: b.x, y: b.y, r: 9 });
  }
  for (const n of w.resources || []) { if (n.kind === "hunt" || n.kind === "forage" || n.kind === "fish" || n.kind === "fishery" || n.kind === "ley") continue; if (Math.hypot(n.x - x, n.y - y) < R + 100) blocks.push({ x: n.x, y: n.y, r: Math.min(60, (n.r || 20) * 0.6) }); }
  const veg = w.obstacles?.veg, felled = w.labor?.forest?.felled || {}, trees = [];
  if (veg) for (let i = 0; i < veg.length; i++) { const v = veg[i]; if (Math.abs(v.x - x) < R + 10 && Math.abs(v.y - y) < R + 10 && felled[i] === undefined && !/bush|shrub|log|stump/.test(v.asset)) trees.push([v.x, v.y]); }
  return { roads: (w.mapRoads || []).filter((r) => r.pts?.some((p) => Math.hypot(p[0] - x, p[1] - y) < R + 300)), claims, blocks, trees };
}
// a team's vills, the seat first: { x, y, core } (js/sim/towns.js keeps the daughters on T.towns)
export function townsOfTeam(T) {
  const out = [];
  if (T?.town) out.push({ x: T.town.x, y: T.town.y, core: 260, seat: true });
  for (const D of T?.towns || []) if (!D.lost) out.push({ x: D.site?.x ?? D.x, y: D.site?.y ?? D.y, core: 200, D });
  return out;
}
