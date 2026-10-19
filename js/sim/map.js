// Map: heightfield + surface grid + queries the whole sim uses (height, slope, surface, LOS).
// World coords are metres, +x east, +y north. The map covers [x0, x0 + size] × [y0, y0 + size]: the Vale alone is
// [0, 4000]² (x0 = y0 = 0); the big world (docs/big-world.md) keeps the Vale's coordinates and reaches out to −6000.
// Grid index (i,j) = ((x − x0), (y − y0)) / cell. Never assume 0 or size: use x0/x1, y0/y1, cx/cy.

export function makeMap({ size, res, height, surface = null, surfaceKeys = [], waterDepth = null, canopy = null, meta = {}, x0 = 0, y0 = 0 }) {
  const cell = size / (res - 1);
  const map = { size, res, cell, height, surface, surfaceKeys, waterDepth, canopyGrid: canopy, meta, x0, y0, x1: x0 + size, y1: y0 + size, cx: x0 + size / 2, cy: y0 + size / 2 };
  // the grid sample nearest (x, y), clamped to the map (k = j·res + i)
  map.idx = (x, y) => Math.min(res - 1, Math.max(0, Math.round((y - y0) / cell))) * res + Math.min(res - 1, Math.max(0, Math.round((x - x0) / cell)));
  // canopy height (m) of woods/hedges at a point — blocks sight lines
  map.canopy = (x, y) => {
    if (!canopy) return 0;
    const i = Math.min(res - 1, Math.max(0, Math.round((x - x0) / cell))), j = Math.min(res - 1, Math.max(0, Math.round((y - y0) / cell)));
    return canopy[j * res + i];
  };

  map.h = (x, y) => {
    const fx = Math.min(Math.max((x - x0) / cell, 0), res - 1.001), fy = Math.min(Math.max((y - y0) / cell, 0), res - 1.001);
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * res + i;
    const a = height[k], b = height[k + 1], c = height[k + res], d = height[k + res + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  // gradient (dh/dx, dh/dy) in m/m
  map.grad = (x, y) => {
    const e = cell;
    return [(map.h(x + e, y) - map.h(x - e, y)) / (2 * e), (map.h(x, y + e) - map.h(x, y - e)) / (2 * e)];
  };
  // grade along a heading (positive = uphill)
  map.gradeAlong = (x, y, dx, dy) => {
    const [gx, gy] = map.grad(x, y); const l = Math.hypot(dx, dy) || 1;
    return (gx * dx + gy * dy) / l;
  };
  map.surfaceAt = (x, y) => {
    if (!surface) return surfaceKeys[0] || "short_meadow";
    const i = Math.min(res - 1, Math.max(0, Math.round((x - x0) / cell))), j = Math.min(res - 1, Math.max(0, Math.round((y - y0) / cell)));
    return surfaceKeys[surface[j * res + i]];
  };
  map.water = (x, y) => {
    if (!waterDepth) return 0;
    const i = Math.min(res - 1, Math.max(0, Math.round((x - x0) / cell))), j = Math.min(res - 1, Math.max(0, Math.round((y - y0) / cell)));
    return waterDepth[j * res + i];
  };
  // Line of sight between two eye points (eye heights in m above ground). Terrain only;
  // vegetation/buildings are added by the caller via `blockers(x,y)` returning extra obstruction height.
  map.los = (x0, y0, e0, x1, y1, e1, blockers = null) => {
    const z0 = map.h(x0, y0) + e0, z1 = map.h(x1, y1) + e1;
    const d = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.ceil(d / cell));
    for (let s = 1; s < n; s++) {
      const t = s / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      const line = z0 + (z1 - z0) * t;
      let g = map.h(x, y);
      if (blockers) g += blockers(x, y);
      if (g > line) return false;
    }
    return true;
  };
  map.inBounds = (x, y) => x >= x0 && y >= y0 && x <= map.x1 && y <= map.y1;
  return map;
}

// Placeholder rolling landscape so everything runs before the real map lands.
export function placeholderMap(size = 4000, res = 257) {
  const height = new Float32Array(res * res);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const x = i / (res - 1), y = j / (res - 1);
    let h = 60 * Math.exp(-((x - 0.5) ** 2 + (y - 0.55) ** 2) / 0.02) // central hill
      + 25 * Math.sin(x * 7.1 + y * 2.3) * Math.cos(y * 5.7 - x)
      + 12 * Math.sin(x * 23 + 1.7) * Math.sin(y * 19);
    height[j * res + i] = 80 + h;
  }
  return makeMap({ size, res, height, meta: { name: "placeholder" } });
}

// THE LAND IS GRASS (the owner, 2026-10-02: "get rid of the 'natural field' … make it, all over the map, JUST grass land,
// and the men … actually make it"). The strategic maps were painted with a late-summer open-field landscape — furlongs of
// standing corn, stubble, fallow and plough-land, hedged closes round them. Nobody in the game planted those, so on load
// that paint becomes the grass it would be (pasture and meadow, in patches), and the hedge LINES painted between the old
// parcels go with it (their real bushes — vegetation.json, obstacles the sim knows — still stand, and are cleared like any
// other where a field is made). Fields are now only what the players and the reeves draw and their men make
// (js/sim/economy.js fieldRect / layField). Orchards, gardens, woods, meadows and roads are untouched. fields.json is not
// read for plots any more. A pitched battle or a siege keeps the painted crops: there they are cover the rules use
// (loadMap(dir, fetcher, { farmland: true }); js/main.js, the battle tools).
export const FARMLAND_PAINT = ["standing_wheat", "standing_barley", "standing_oats_beans", "stubble", "fallow", "ploughed_field", "hedgerow"];
const GRASS_KEYS = ["pasture", "short_meadow", "tall_grass", "flower_meadow", "water_meadow"];
export function grassOver(surface, surfaceKeys, res) {
  if (!surface) return { surface, surfaceKeys };
  const keys = surfaceKeys.slice(), from = new Set(FARMLAND_PAINT.map((k) => keys.indexOf(k)).filter((i) => i >= 0)); if (!from.size) return { surface, surfaceKeys };
  let pasture = keys.indexOf("pasture"); if (pasture < 0) { keys.push("pasture"); pasture = keys.length - 1; }
  const grass = new Set(GRASS_KEYS.map((k) => keys.indexOf(k)).filter((i) => i >= 0));
  // the painted cells take the grass of the land round them: a breadth-first fill inward from the grass that borders them
  // (woods, roads and water give nothing), so no outline of the old parcels is left in the turf; cut off: pasture
  const out = new Uint8Array(surface), N = res * res, seen = new Uint8Array(N), q = new Int32Array(N); let h = 0, t = 0;
  for (let k = 0; k < N; k++) if (grass.has(out[k])) { const i = k % res, j = (k / res) | 0; if ((i > 0 && from.has(out[k - 1])) || (i < res - 1 && from.has(out[k + 1])) || (j > 0 && from.has(out[k - res])) || (j < res - 1 && from.has(out[k + res]))) { q[t++] = k; seen[k] = 1; } }
  const isFrom = new Uint8Array(256); for (const f of from) isFrom[f] = 1;
  const take = (n, v) => { if (!seen[n] && isFrom[out[n]]) { out[n] = v; seen[n] = 1; q[t++] = n; } };
  while (h < t) {
    const k = q[h++], i = k % res, v = out[k];
    if (i > 0) take(k - 1, v); if (i < res - 1) take(k + 1, v); if (k >= res) take(k - res, v); if (k < N - res) take(k + res, v);
  }
  for (let k = 0; k < N; k++) if (from.has(out[k]) && !seen[k]) out[k] = pasture;
  // …and the parcels' own grass (closes and doles painted pasture, meadow, long grass, flowers parcel by parcel, each a
  // straight-edged patch) is laid again as open grassland: the same grasses in their shares, in soft drifts that follow
  // nothing — so no old parcel shows through the turf (wet meadows, heath, bracken and the rest are left as they are)
  const kinds = ["pasture", "short_meadow", "tall_grass", "flower_meadow"].map((k) => keys.indexOf(k)), isG = new Uint8Array(256);
  for (const g of kinds) if (g >= 0) isG[g] = 1;
  const cell = 4000 / res, hash = (i, j) => { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const vnoise = (x, y) => { const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    return (hash(i, j) * (1 - su) + hash(i + 1, j) * su) * (1 - sv) + (hash(i, j + 1) * (1 - su) + hash(i + 1, j + 1) * su) * sv; };
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const k = j * res + i; if (!isG[out[k]]) continue;
    const x = i * cell, y = j * cell, n = vnoise(x / 170, y / 170) * 0.65 + vnoise(x / 45 + 17, y / 45 + 5) * 0.35;
    const g = n < 0.5 ? kinds[0] : n < 0.66 ? kinds[1] : n < 0.76 ? kinds[2] : kinds[3];
    if (g >= 0) out[k] = g;
  }
  return { surface: out, surfaceKeys: keys };
}
// Browser/node loader for maps/<name>/ produced by the map pipeline. A map dir with a world/ (js/sim/tiles.js) is read
// through its tiles: the core square alone (the Vale: every single-player mode), or { world: true } the whole world
// around it (the Realm — docs/big-world.md). map.vegetation is then the trees of what was loaded, in their global
// order (the core's vegetation.json order first), shaped like vegetation.json.
export async function loadMap(base, fetcher = fetch, { farmland = false, world = false } = {}) {
  const meta = await (await fetcher(`${base}/meta.json`)).json();
  const T = await import("./tiles.js");
  const W = globalThis.process?.env?.HG_FLAT_MAP ? null : await T.loadWorldIndex(base, fetcher);
  let height, res, surface = null, surfaceKeys = meta.surfaceKeys || [], waterDepth = null, canopy = null, size = meta.size_m ?? meta.size, x0 = 0, y0 = 0, vegetation = null;
  if (W) {
    const A = await T.assembleTiles(base, W, world ? [0, 0, W.tiles[0] - 1, W.tiles[1] - 1] : W.core.tiles, fetcher);
    ({ height, res, surface, canopy, size, x0, y0 } = A); waterDepth = A.water; surfaceKeys = W.surfaceKeys;
    vegetation = { version: 1, coords: "world metres, x east, y north; rot = radians about +z; scale = uniform multiplier", assets: W.vegAssetPaths || {}, instances: A.veg };
    if (world) Object.assign(meta, { size_m: size, res, origin_m: [x0, y0], world: { x0, y0, size, core: W.core }, features: [...meta.features || [], ...W.features || []] });
  } else {
    height = new Float32Array(await (await fetcher(`${base}/height.f32`)).arrayBuffer());
    res = meta.res ?? Math.round(Math.sqrt(height.length));
    try {
      const sb = await fetcher(`${base}/surface.u8`); if (sb.ok) surface = new Uint8Array(await sb.arrayBuffer());
    } catch { /* optional */ }
    try {
      const wb = await fetcher(`${base}/water.f32`); if (wb.ok) waterDepth = new Float32Array(await wb.arrayBuffer());
    } catch { /* optional */ }
    try { const cb = await fetcher(`${base}/canopy.u8`); if (cb.ok) canopy = new Uint8Array(await cb.arrayBuffer()); } catch { /* optional */ }
  }
  // the core square of a big world (the Vale, at grid (ci, cj)): read exactly as the square alone is — its grass, its land
  const core = W && world ? { i0: Math.round(-x0 / (size / (res - 1))), j0: Math.round(-y0 / (size / (res - 1))), n: Math.round(W.core.size / (size / (res - 1))) + 1 } : null;
  const cut = (A, T) => { const o = new T(core.n * core.n); for (let j = 0; j < core.n; j++) o.set(A.subarray((core.j0 + j) * res + core.i0, (core.j0 + j) * res + core.i0 + core.n), j * core.n); return o; };
  if (!farmland && core && surface) { // (the generated land round it has no painted farmland: only the core's is turned to grass)
    const g = grassOver(cut(surface, Uint8Array), surfaceKeys, core.n); surfaceKeys = g.surfaceKeys;
    for (let j = 0; j < core.n; j++) surface.set(g.surface.subarray(j * core.n, (j + 1) * core.n), (core.j0 + j) * res + core.i0);
  } else if (!farmland) ({ surface, surfaceKeys } = grassOver(surface, surfaceKeys, res));   // (the painted farmland is grass: above)
  const map = makeMap({ size, res, height, surface, surfaceKeys, waterDepth, canopy, meta, x0, y0 });
  map.grass = !farmland; map.dir = base;
  if (vegetation) map.vegetation = vegetation;
  // the map's painted furlongs (fields.json) only where the painted farmland is kept (a battle): plots come from the players
  if (farmland) try { const fb = await fetcher(`${base}/fields.json`); if (fb.ok) map.fields = (await fb.json()).fields || null; } catch { /* optional */ }
  const { readLand } = await import("./landread.js");
  if (core) { // the big world: the core's land as the square alone reads it, the rest read with the core's constants
    const cm = makeMap({ size: W.core.size, res: core.n, height: cut(height, Float32Array), surface: surface && cut(surface, Uint8Array), surfaceKeys, waterDepth: waterDepth && cut(waterDepth, Float32Array), canopy: canopy && cut(canopy, Uint8Array), meta });
    const CL = readLand(cm);
    map.land = readLand(map, { pin: { lmax: CL.lmax, hmin: CL.hmin, hmax: CL.hmax }, core: { L: CL, i0: core.i0, j0: core.j0 }, lean: true });
    map.core = { x0: 0, y0: 0, size: W.core.size, i0: core.i0, j0: core.j0, n: core.n };
  } else map.land = readLand(map); // the rules read the land's physical makeup
  return map;
}
