// The land reader. Effects are never tied to what the ground LOOKS like: this module reads the land's
// physical makeup — height, slope, curvature, drainage, water, vegetation — computes what the ground IS
// (wet, stony, deep-soiled, wooded…), and derives every gameplay property from that. A new map seed
// only needs a heightfield, water and vegetation; the rules follow from physics, not from tiles.
//
// Fields (per map cell, Float32 0..1 unless noted):
//   slope (m/m)  curv (+ convex ridge, − hollow)  flow (log upstream area 0..1)  wet  soil (depth 0..1)
//   rock  veg (height m)  vegD (density 0..1)  water (depth m)
// Derived per point: going per arm, footing, fatigue, cover, concealment, fertility, foundation,
// fire risk, provides.

// `rain` (0 dry … 1 after days of rain) raises wetness everywhere, most on ground that drains poorly.
//
// The big world (docs/big-world.md: { world: true } maps) reads its land once, at full resolution, with the Vale's own
// constants (pin: the flow normaliser and the height range — so wet, high and upland mean the same thing everywhere), and
// its core square (the Vale) keeps exactly the land the Vale alone reads (core: that land, pasted over). lean drops the
// fields nothing reads after the reading (curv, flow), the big world's memory.
export function readLand(map, { rain = 0, pin = null, core = null, lean = false } = {}) {
  const { res, cell, height } = map, N = res * res;
  const slope = new Float32Array(N), curv = new Float32Array(N), flow = new Float32Array(N), wet = new Float32Array(N);
  const soil = new Float32Array(N), rock = new Float32Array(N), veg = new Float32Array(N), vegD = new Float32Array(N), high = new Float32Array(N);
  const H = (i, j) => height[Math.min(res - 1, Math.max(0, j)) * res + Math.min(res - 1, Math.max(0, i))];
  // slope & curvature (Laplacian)
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const k = j * res + i;
    const gx = (H(i + 1, j) - H(i - 1, j)) / (2 * cell), gy = (H(i, j + 1) - H(i, j - 1)) / (2 * cell);
    slope[k] = Math.hypot(gx, gy);
    curv[k] = (4 * height[k] - H(i + 1, j) - H(i - 1, j) - H(i, j + 1) - H(i, j - 1)) / (cell * cell);
  }
  // drainage: D8 flow accumulation (process cells from high to low, pass area downhill)
  const order = N > 1 << 21 ? byHeight(height) : new Uint32Array(N); // (a big world: a native sort of packed keys — a comparator sort of 16 M took minutes)
  if (N <= 1 << 21) { for (let k = 0; k < N; k++) order[k] = k; order.sort((a, b) => height[b] - height[a]); }
  const acc = new Float32Array(N).fill(1);
  for (const k of order) {
    const i = k % res, j = (k / res) | 0; let best = -1, drop = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue; const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= res || nj >= res) continue;
      const m = nj * res + ni, d = (height[k] - height[m]) / (di && dj ? 1.414 : 1); if (d > drop) { drop = d; best = m; }
    }
    if (best >= 0) acc[best] += acc[k];
  }
  const lmax = pin?.lmax ?? Math.log(N);
  for (let k = 0; k < N; k++) flow[k] = Math.log(acc[k]) / lmax;
  // water depth & canopy
  const wd = map.waterDepth, can = map.canopyGrid;
  // height above the nearest channel (HAND): seeds = open water + strong drainage lines;
  // chamfer sweeps carry each cell's nearest channel height and distance
  const dist = new Float32Array(N).fill(1e9), chH = new Float32Array(N);
  for (let k = 0; k < N; k++) if ((wd && wd[k] > 0.05) || flow[k] > 0.62) { dist[k] = 0; chH[k] = height[k]; }
  const D1 = cell, D2 = cell * 1.414;
  const relax = (k, m, d) => { if (dist[m] + d < dist[k]) { dist[k] = dist[m] + d; chH[k] = chH[m]; } };
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) { const k = j * res + i;
      if (i > 0) relax(k, k - 1, D1); if (j > 0) { relax(k, k - res, D1); if (i > 0) relax(k, k - res - 1, D2); if (i < res - 1) relax(k, k - res + 1, D2); } }
    for (let j = res - 1; j >= 0; j--) for (let i = res - 1; i >= 0; i--) { const k = j * res + i;
      if (i < res - 1) relax(k, k + 1, D1); if (j < res - 1) { relax(k, k + res, D1); if (i < res - 1) relax(k, k + res + 1, D2); if (i > 0) relax(k, k + res - 1, D2); } }
  }
  // local prominence: height above the ~300 m neighbourhood — what makes a hill a hill
  const around = Float32Array.from(height); blur(around, res, 38); blur(around, res, 38);
  let hmin = Infinity, hmax = -Infinity; for (let k = 0; k < N; k++) { hmin = Math.min(hmin, height[k]); hmax = Math.max(hmax, height[k]); }
  if (pin) ({ hmin, hmax } = pin);
  for (let k = 0; k < N; k++) {
    const s = slope[k], c = curv[k];
    const hand = Math.max(0, height[k] - chH[k]);
    const floodplain = clamp01(1 - hand / 4.5) * Math.exp(-dist[k] / 600); // low, flat ground by the water
    const span = Math.max(1, hmax - hmin); // a flat map must not divide by zero
    const upland = clamp01((height[k] - (hmin + span * 0.55)) / (span * 0.35)); // high, exposed
    high[k] = clamp01(Math.max(upland, (height[k] - around[k]) / 14) + Math.max(0, c) * 2);
    // topographic wetness: lots of water arriving + little slope to shed it + hollows + near open water
    const twi = Math.log((acc[k] * cell) / Math.max(0.02, s)) / 14;
    wet[k] = clamp01(rain * (0.12 + 0.35 * Math.max(0, twi - 0.3) + 0.3 * floodplain) + 0.75 * floodplain + 0.3 * twi * (s < 0.03 ? 1 : 0.5) + (c < 0 ? Math.min(0.15, -c * 3) : 0) - 0.1 + (wd && wd[k] > 0.05 ? 1 : 0));
    // soil: deep in hollows & gentle lowland, thin on steep convex ridges and high exposed ground
    soil[k] = clamp01(1 - s * 1.8 - Math.max(0, c) * 6 + Math.max(0, -c) * 3 - upland * 0.55);
    rock[k] = clamp01((s - 0.32) * 2.4 + Math.max(0, c) * 4 + upland * 0.15 - soil[k] * 0.3);
    veg[k] = can ? can[k] : 0;
    vegD[k] = can ? clamp01(can[k] / 14) : 0;
  }
  // roads: the one thing on the land that physics does not grow — tracks worn and drained by centuries of carts
  // (the map's surface layer marks them). The going is the carriageway plus its verges: a column four files
  // wide keeps its feet on firm ground ~8 m either side of the rut line (the lord's highway was kept clear of
  // brush well beyond that), so the mask is widened by two cells.
  const road = new Uint8Array(N), roadCore = new Uint8Array(N), roadWay = new Uint8Array(N); // corridor, rut line, carriageway (±1 cell)
  if (map.surface && map.surfaceKeys?.length) {
    const ids = new Set(ROAD_KEYS.map((k) => map.surfaceKeys.indexOf(k)).filter((i) => i >= 0));
    const rad = Math.max(1, Math.round(8 / cell));
    if (ids.size) for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      if (!ids.has(map.surface[j * res + i])) continue;
      roadCore[j * res + i] = 1;
      for (let dj = -rad; dj <= rad; dj++) for (let di = -rad; di <= rad; di++) {
        const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < res && b < res) { road[b * res + a] = 1; if (Math.abs(di) <= 1 && Math.abs(dj) <= 1) roadWay[b * res + a] = 1; }
      }
    }
  }
  if (core) { // the core square: the land it reads on its own, cell for cell
    const C = core.L, cr = C.res;
    for (let j = 0; j < cr; j++) for (let i = 0; i < cr; i++) {
      const k = (core.j0 + j) * res + core.i0 + i, q = j * cr + i;
      slope[k] = C.slope[q]; curv[k] = C.curv[q]; flow[k] = C.flow[q]; wet[k] = C.wet[q]; soil[k] = C.soil[q]; rock[k] = C.rock[q]; veg[k] = C.veg[q]; vegD[k] = C.vegD[q]; high[k] = C.high[q];
      road[k] = C.road[q]; roadCore[k] = C.roadCore[q]; roadWay[k] = C.roadWay[q];
    }
  }
  const x0 = map.x0 || 0, y0 = map.y0 || 0; // (the map's extent: k = j·res + i from its SW corner)
  const L = { res, cell, x0, y0, slope, curv: lean ? null : curv, flow: lean ? null : flow, wet, soil, rock, veg, vegD, high, water: wd, rain, road, roadCore, roadWay, lmax, hmin, hmax };
  L.idx = (x, y) => Math.min(res - 1, Math.max(0, Math.round((y - y0) / cell))) * res + Math.min(res - 1, Math.max(0, Math.round((x - x0) / cell)));
  L.ij = (i, j) => j * res + i; // (grid cell → land index; the map grid's own: L.fromMap(k) = k)
  L.fromMap = (k) => k;
  L.kx = (k) => x0 + (k % res) * cell; L.ky = (k) => y0 + ((k / res) | 0) * cell;
  L.syncCell = (k) => { if (L.cache instanceof Map) L.cache.delete(k); else if (L.cache) L.cache[k] = undefined; }; // (the map's height or water — or the canopy — changed under cell k: crossings.js, forestry.js)
  L.at = (x, y) => props(L, L.idx(x, y));
  return L;
}

// What the ground is, and what that means. All from the physical fields.
export function props(L, k) {
  const s = L.slope[k], wet = L.wet[k], soil = L.soil[k], rock = L.rock[k], veg = L.veg[k], vd = L.vegD[k], w = L.water ? L.water[k] : 0, high = L.high[k];
  const bog = w > 0.05 ? 0 : clamp01((wet - 0.6) * 3.5) * (1 - rock); // saturated ground (not open water)           // saturated ground: marsh, bog, fen
  const wood = vd, scrub = veg > 0.8 && veg < 6 ? clamp01(veg / 4) : 0;
  // movement: slope (Tobler handled by callers), mud, rock, undergrowth, water
  // on a road the footing is the road's: drained, cleared, metalled with gravel where it was soft (the wet
  // and the woods it runs through don't slow a column; fords and slope still do)
  const onRoad = L.road ? L.road[k] === 1 : false;
  const soft = onRoad ? 0 : bog * 0.6 + Math.max(0, wet - 0.5) * 0.4;
  const going = goingFrom(onRoad, soft, rock, vd, scrub, w, s);
  return {
    slope: s, wet, soil, rock, veg, water: w, bog, wood, scrub, high, road: onRoad,
    going,
    footing: clamp01(soft * 0.6 + rock * 0.3 + Math.max(0, s - 0.3)),    // slip/fall chance weight in melee
    chargeViable: clamp01(1 - soft * 1.5 - wood * 1.2 - scrub * 0.6 - rock * 0.8 - Math.max(0, s - 0.2) * 3),
    cover: { soft: clamp01(wood * 0.8 + scrub * 0.4), hard: clamp01(rock * 0.5 + (veg > 8 ? 0.15 : 0)) }, // trunks & boulders stop arrows
    concealment: clamp01(wood * 0.9 + scrub * 0.6 + Math.max(0, veg - 0.5) * 0.05),
    fertility: clamp01(soil * (1 - bog) * (1 - rock) * (1 - Math.max(0, wet - 0.75) * 2) * (s > 0.2 ? 0.6 : 1) + 0.05),
    foundation: clamp01(1 - bog * 0.7 - Math.max(0, wet - 0.55) * 0.8) + rock * 0.45,     // >1 bedrock
    fireRisk: clamp01((1 - wet) * (wood * 0.4 + scrub * 0.8)),
    dust: clamp01((1 - wet) * (1 - vd) * 0.6),
    digIn: clamp01(soil * (1 - rock) * (1 - bog * 0.6)),
    provides: provides(soil, wet, rock, bog, wood, scrub, w, s),
  };
}

// the going alone (what the nav grid costs a march by: js/sim/path.js) — props's own numbers, without building the rest
function goingFrom(onRoad, soft, rock, vd, scrub, w, s) {
  const rock_ = onRoad ? 0 : rock, wood_ = onRoad ? 0 : vd, scrub_ = onRoad ? 0 : scrub;
  const foot = clamp01(1 - soft * 0.7 - rock_ * 0.35 - wood_ * 0.35 - scrub_ * 0.25) * (w > 1.1 ? 0 : 1 - Math.min(0.8, w * 0.6));
  return {
    foot,
    heavyFoot: clamp01(1 - soft * 0.9 - rock_ * 0.4 - wood_ * 0.4 - scrub_ * 0.3) * (w > 1.0 ? 0 : 1 - Math.min(0.8, w * 0.7)),
    cavalry: cavGoing(clamp01(1 - soft * 1.3 - rock_ * 0.8 - wood_ * 0.75 - scrub_ * 0.4 - Math.max(0, s - 0.25)) * (w > 1.3 ? 0 : 1 - Math.min(0.8, w * 0.5)), foot),
    cart: clamp01(1 - soft * 1.5 - rock_ * 1.0 - wood_ * 0.9 - scrub_ * 0.5 - s * 2) * (w > 0.6 ? 0 : 1),
  };
}
// Horse goes wherever foot goes (the owner, 2026-10-06: "get rid of ground that knights can't go on … it doesn't add
// much"): where a man on foot can make way at all, a horse can be ridden or led through at CAV_FLOOR of his pace at least
// — a wood, a carr, a bog, a scree are slow and spend horses (fatigue follows the going), they are not walls. Charging
// over them is another matter (chargeViable, ground.js); deep water, walls and buildings stay closed to everyone.
export const CAV_FLOOR = 0.4;
export const cavGoing = (cav, foot) => (foot > 0.02 ? Math.max(cav, CAV_FLOOR * foot, 0.025) : cav);
export function goingOf(L, k) {
  const s = L.slope[k], wet = L.wet[k], rock = L.rock[k], veg = L.veg[k], vd = L.vegD[k], w = L.water ? L.water[k] : 0;
  const bog = w > 0.05 ? 0 : clamp01((wet - 0.6) * 3.5) * (1 - rock);
  const scrub = veg > 0.8 && veg < 6 ? clamp01(veg / 4) : 0;
  const onRoad = L.road ? L.road[k] === 1 : false;
  const soft = onRoad ? 0 : bog * 0.6 + Math.max(0, wet - 0.5) * 0.4;
  return goingFrom(onRoad, soft, rock, vd, scrub, w, s);
}

function provides(soil, wet, rock, bog, wood, scrub, w, s) {
  const out = [];
  if (w > 0.2) return [{ res: "fish", text: "fish & eels" }, { res: "water", text: "water for mills and beasts" }];
  if (wood > 0.25) out.push({ res: "timber", text: `standing timber (~${Math.round(wood * 180)} t/ha)` }, { res: "game", text: "game (deer, boar)" });
  if (scrub > 0.3) out.push({ res: "firewood", text: "brushwood & firewood" }, { res: "fruit", text: "berries & nuts" });
  if (rock > 0.35) out.push({ res: "stone", text: "building stone (exposed rock)" });
  if (bog > 0.5) out.push({ res: "peat", text: "peat (fuel)" }, { res: "reeds", text: "thatching reed" }, { res: "bog_iron", text: "chance of bog-iron ore" });
  else if (wet > 0.6 && wood < 0.3) out.push({ res: "hay", text: "rich wet meadow hay" });
  if (w > 0.2) { out.push({ res: "fish", text: "fish & eels" }); return out; }
  if (soil > 0.55 && wet < 0.7 && rock < 0.2 && s < 0.2) out.push({ res: "grain", text: `good arable soil (fertility ${Math.round(soil * 100)}%)` });
  else if (wood < 0.25 && bog < 0.5 && rock < 0.35 && w < 0.2) out.push({ res: "grazing", text: "rough grazing" });
  if (soil > 0.4 && wet > 0.45 && wet < 0.7 && rock < 0.2) out.push({ res: "clay", text: "clay in the subsoil" });
  return out;
}

const ROAD_KEYS = ["dirt_track", "hollow_way", "village_street", "cobbled_road", "stone_paving"];

// cell indices from the highest to the lowest (ties: the lower index first) — packed keys sorted natively: height in
// 2^-18 m steps above the lowest × 2^25 + index (exact in a double for ~1000 m of relief and 2^25 cells)
function byHeight(height) {
  const N = height.length; let lo = Infinity; for (let k = 0; k < N; k++) if (height[k] < lo) lo = height[k];
  const keys = new Float64Array(N), S = 2 ** 25;
  for (let k = 0; k < N; k++) keys[k] = Math.round((height[k] - lo) * 262144) * S + (S - 1 - k);
  keys.sort();
  const order = new Uint32Array(N);
  for (let q = 0; q < N; q++) order[q] = S - 1 - (keys[N - 1 - q] % S);
  return order;
}

function blur(a, res, r) { // separable box blur in place
  const t = new Float32Array(a.length);
  for (let j = 0; j < res; j++) { let s = 0; for (let i = -r; i <= r; i++) s += a[j * res + Math.max(0, Math.min(res - 1, i))];
    for (let i = 0; i < res; i++) { t[j * res + i] = s / (2 * r + 1); s += a[j * res + Math.min(res - 1, i + r + 1)] - a[j * res + Math.max(0, i - r)]; } }
  for (let i = 0; i < res; i++) { let s = 0; for (let j = -r; j <= r; j++) s += t[Math.max(0, Math.min(res - 1, j)) * res + i];
    for (let j = 0; j < res; j++) { a[j * res + i] = s / (2 * r + 1); s += t[Math.min(res - 1, j + r + 1) * res + i] - t[Math.max(0, j - r) * res + i]; } }
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// The land as the rest of the sim consumes it: same shape as a TERRAIN table entry (moveMul, footing,
// chargeViable, cohesionMul, cover, concealment, dust, digIn, fireRisk, forage), but computed from the
// physical fields. Cached per cell.
export function terrainEntry(L, k) {
  if (L.res * L.res > 1 << 22) return terrainEntryMap(L, k); // (a big world: a sparse cache — an array as long as the land was 134 MB a reset)
  const c = (L.cache ||= new Array(L.res * L.res));
  if (c[k]) return c[k];
  const p = props(L, k);
  const e = entryOf(p);
  // (bounded: every cell of a 1025² land cached was ~850 MB — the nav build samples them all; ~1.5 KB an entry. They are a pure
  // function of the land, so dropping them and computing again later changes nothing but memory)
  if ((L.cacheN = (L.cacheN || 0) + 1) > TERRAIN_CACHE_MAX) { L.cache = new Array(L.res * L.res); L.cacheN = 1; }
  L.cache[k] = e; return e;
}
const TERRAIN_CACHE_MAX = 1 << 15; // (~50 MB)
function entryOf(p) {
  return {
    name: describe(p), moveMul: p.going, fatigueMul: 1 + (1 - p.going.foot) * 0.8,
    footing: { slip: p.footing * 0.08, fall: p.footing * 0.02 }, chargeViable: p.chargeViable,
    cohesionMul: 1 - (p.wood * 0.5 + p.scrub * 0.3 + p.rock * 0.3), cover: p.cover,
    concealment: { standing: p.concealment, prone: Math.min(1, p.concealment + 0.25 * (p.veg > 0.3 ? 1 : 0)) },
    dust: p.dust, digIn: p.digIn, fireRisk: p.fireRisk,
    forage: { graze: Math.round(80 * (1 - p.wood) * (1 - p.rock) * (1 - p.bog * 0.5) * p.soil), food: Math.round(20 * p.wood + 10 * p.scrub), wood: Math.round(180 * p.wood) },
    wetSensitivity: p.wet, land: p,
    };
}
function terrainEntryMap(L, k) {
  const c = (L.cache instanceof Map ? L.cache : (L.cache = new Map())), e0 = c.get(k);
  if (e0) return e0;
  const p = props(L, k);
  const e = entryOf(p);
  if ((L.cacheN = (L.cacheN || 0) + 1) > TERRAIN_CACHE_MAX) { c.clear(); L.cacheN = 1; }
  c.set(k, e); return e;
}
export function describe(p) {
  if (p.water > 1.1) return "Deep water";
  if (p.water > 0.05) return "Shallow water";
  if (p.road) return "Road";
  if (p.bog > 0.6) return p.wood > 0.3 ? "Wet alder wood" : "Marsh";
  if (p.rock > 0.6) return "Bare rock";
  if (p.rock > 0.3) return "Stony ground";
  if (p.wood > 0.6) return "Dense woodland";
  if (p.wood > 0.25) return "Open woodland";
  if (p.scrub > 0.3) return "Scrub";
  if (p.wet > 0.5) return "Damp meadow";
  if (p.high > 0.5) return p.soil < 0.45 ? "Exposed hilltop" : "High ground";
  if (p.soil < 0.4) return "Thin upland soil";
  if (p.slope > 0.15) return "Hillside grassland";
  return p.wet < 0.25 ? "Dry lowland soil" : "Good lowland soil";
}
export function terrainAt(w, x, y) {
  const L = w.map.land; if (!L) return w.terrain?.[w.map.surfaceAt(x, y)] || {};
  return terrainEntry(L, L.idx(x, y));
}
