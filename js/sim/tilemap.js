// The streamed world (docs/big-world.md §5): the Realm's browser never holds — or reads, or draws — the whole 16 km
// world at full resolution. It holds the core square (the Vale) exactly as a single-player game does, the coarse world
// (31.25 m: js/sim/tiles.js world/coarse.gz) everywhere, and the 500 m tiles round the camera and round its own lands,
// fetched as they are wanted and kept in the browser's IndexedDB so a second visit is instant. The map it gives has the
// same API the sim and the renderer use everywhere (h, grad, gradeAlong, surfaceAt, water, canopy, los, inBounds, the
// extent x0/y0/x1/y1/cx/cy); a point whose tile has not arrived reads the coarse world (or the core's own data). The
// whole-map arrays (height, surface, …) are null: code that needs a grid asks for tiles (map.tileAt, map.onTile).
import { TILE_CELLS, TILE_N, loadWorldIndex, loadCoarse, decodeTile, gunzip, tileOrigin } from "./tiles.js";
import { makeMap, grassOver } from "./map.js";
import { readLand } from "./landread.js";

const DB = "hg-tiles", STORE = "t";
function idb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((res) => { try { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore(STORE); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch { res(null); } });
}
const idbGet = (db, k) => new Promise((res) => { if (!db) return res(null); try { const q = db.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch { res(null); } });
const idbPut = (db, k, v) => { if (!db) return; try { db.transaction(STORE, "readwrite").objectStore(STORE).put(v, k); } catch { /* full or private: no cache */ } };

// → the map, or null if `base` has no world/. opts: { fetcher, farmland, maxTiles (kept in memory), parallel }
export async function streamMap(base, { fetcher = fetch, farmland = false, maxTiles = 170, parallel = 4 } = {}) {
  const W = await loadWorldIndex(base, fetcher); if (!W) return null;
  const meta = await (await fetcher(`${base}/meta.json`)).json();
  const coarse = await loadCoarse(base, fetcher);
  const cell = W.cell, NT = W.tiles[0], x0 = W.origin[0], y0 = W.origin[1], size = W.size, res = W.res, NTT = NT * NT;
  const db = await idb(), tag = `${base}|${W.size}|${W.heightRange}|${W.vegCount}`;
  let surfaceKeys = W.surfaceKeys.slice();
  // ---- the core square, exactly as the single-player game reads it (its painted farmland is grass: map.js grassOver)
  const { assembleTiles } = await import("./tiles.js");
  const A = await assembleTiles(base, W, W.core.tiles, fetcher);
  let coreSurf = A.surface;
  if (!farmland && coreSurf) { const g = grassOver(coreSurf, surfaceKeys, A.res); coreSurf = g.surface; surfaceKeys = g.surfaceKeys; }
  const core = makeMap({ size: A.size, res: A.res, height: A.height, surface: coreSurf, surfaceKeys, waterDepth: A.water, canopy: A.canopy, meta, x0: A.x0, y0: A.y0 });
  core.land = readLand(core);
  const C = W.core, inCore = (x, y) => x >= C.x0 && y >= C.y0 && x <= C.x0 + C.size && y <= C.y0 + C.size;
  core.land.covers = inCore;
  // the coarse world under the core shows the core's own grass, not its old paint
  if (coarse && coreSurf) for (let J = 0; J < coarse.n; J++) for (let I = 0; I < coarse.n; I++) {
    const x = coarse.x0 + I * coarse.cell, y = coarse.y0 + J * coarse.cell; if (inCore(x, y)) coarse.surface[J * coarse.n + I] = coreSurf[core.idx(x, y)];
  }
  // ---- tiles: the core's are the core (views into nothing: reads go to `core`); the rest arrive as wanted
  const tiles = new Array(NTT).fill(null), state = new Uint8Array(NTT); // 0 none, 1 coming, 2 here
  const isCoreTile = (ti, tj) => ti >= C.tiles[0] && ti <= C.tiles[2] && tj >= C.tiles[1] && tj <= C.tiles[3];
  for (let tj = 0; tj < NT; tj++) for (let ti = 0; ti < NT; ti++) if (isCoreTile(ti, tj)) state[tj * NT + ti] = 2;
  const used = new Float64Array(NTT); let clock = 0, loaded = 0;
  const listeners = [];
  const map = makeMap({ size, res, height: new Float32Array(4), surface: null, surfaceKeys, waterDepth: null, canopy: null, meta, x0, y0 });
  Object.assign(map, { height: null, streamed: true, world: W, core, coarse, tiles, land: core.land, vegetation: { version: 1, assets: W.vegAssetPaths || {}, instances: A.veg } });
  map.meta = { ...meta, size_m: size, res, world: { x0, y0, size, core: C }, features: [...meta.features || [], ...W.features || []] };

  // ---- reads
  const tileOf = (i, j) => { const ti = Math.min(NT - 1, (i / TILE_CELLS) | 0), tj = Math.min(NT - 1, (j / TILE_CELLS) | 0); return tj * NT + ti; };
  const ch = (x, y) => { // coarse bilinear
    if (!coarse) return 0;
    const n = coarse.n, fx = Math.min(Math.max((x - coarse.x0) / coarse.cell, 0), n - 1.001), fy = Math.min(Math.max((y - coarse.y0) / coarse.cell, 0), n - 1.001);
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, k = j * n + i, H = coarse.height;
    return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + n] * (1 - u) + H[k + n + 1] * u) * v;
  };
  const cNear = (A_, x, y) => { if (!coarse) return 0; const n = coarse.n, i = Math.min(n - 1, Math.max(0, Math.round((x - coarse.x0) / coarse.cell))), j = Math.min(n - 1, Math.max(0, Math.round((y - coarse.y0) / coarse.cell))); return A_[j * n + i]; };
  map.h = (x, y) => {
    if (inCore(x, y)) return core.h(x, y);
    const fx = Math.min(Math.max((x - x0) / cell, 0), res - 1.001), fy = Math.min(Math.max((y - y0) / cell, 0), res - 1.001);
    const i = fx | 0, j = fy | 0, T = tiles[tileOf(i, j)];
    if (!T) return ch(x, y);
    const li = i - T.ti * TILE_CELLS, lj = j - T.tj * TILE_CELLS, u = fx - i, v = fy - j, k = lj * TILE_N + li, H = T.height;
    return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + TILE_N] * (1 - u) + H[k + TILE_N + 1] * u) * v;
  };
  const near = (x, y) => { // → [tile, local index] of the nearest sample, or null (coarse)
    const i = Math.min(res - 1, Math.max(0, Math.round((x - x0) / cell))), j = Math.min(res - 1, Math.max(0, Math.round((y - y0) / cell)));
    const t = tileOf(Math.min(i, res - 2), Math.min(j, res - 2)), T = tiles[t]; if (!T) return null;
    return [T, (j - T.tj * TILE_CELLS) * TILE_N + (i - T.ti * TILE_CELLS)];
  };
  map.surfaceAt = (x, y) => { if (inCore(x, y)) return core.surfaceAt(x, y); const q = near(x, y); return surfaceKeys[q ? q[0].surface[q[1]] : cNear(coarse?.surface, x, y)] || "short_meadow"; };
  map.water = (x, y) => { if (inCore(x, y)) return core.water(x, y); const q = near(x, y); return q ? (q[0].water ? q[0].water[q[1]] : 0) : coarse ? cNear(coarse.water, x, y) : 0; };
  map.canopy = (x, y) => { if (inCore(x, y)) return core.canopy(x, y); const q = near(x, y); return q ? q[0].canopy[q[1]] : coarse ? cNear(coarse.canopy, x, y) : 0; };
  map.idx = null; // (no whole-world grid here)
  map.tileAt = (ti, tj) => (ti < 0 || tj < 0 || ti >= NT || tj >= NT ? null : isCoreTile(ti, tj) ? "core" : tiles[tj * NT + ti]);
  map.tileKeyAt = (x, y) => { const ti = Math.floor((x - x0) / (TILE_CELLS * cell)), tj = Math.floor((y - y0) / (TILE_CELLS * cell)); return ti < 0 || tj < 0 || ti >= NT || tj >= NT ? -1 : tj * NT + ti; };
  map.onTile = (fn) => listeners.push(fn); // fn(tile, { dropped }) when a tile arrives (or is dropped)
  map.isCoreTile = isCoreTile;
  map.stats = () => ({ loaded, coming: state.reduce((a, s) => a + (s === 1), 0), tiles: NTT });

  // ---- streaming: want(x, y, r) asks for the tiles within r of (x, y), nearest first
  const queue = [];
  let active = 0;
  async function fetchOne(k) {
    const ti = k % NT, tj = (k / NT) | 0, key = `${tag}|${ti}_${tj}|${W.bytes?.[k] ?? 0}`;
    let raw = await idbGet(db, key);
    if (!raw) { const r = await fetcher(`${base}/world/t/${ti}_${tj}.gz`); if (!r.ok) throw new Error(`tile ${ti}_${tj}`); raw = new Uint8Array(await r.arrayBuffer()); idbPut(db, key, raw); }
    else raw = new Uint8Array(raw);
    const bytes = raw[0] === 0x1f && raw[1] === 0x8b ? await gunzip(raw) : raw;
    const [ox, oy] = tileOrigin(W, ti, tj), T = decodeTile(bytes, { ox, oy, assets: W.vegAssets });
    T.key = k; T.ox = ox; T.oy = oy; T.vegBase = W.vegBase?.[k] ?? 0; T.veg.forEach((v, q) => { if (v.idx === undefined) v.idx = T.vegBase + q; });
    return T;
  }
  function pump() {
    while (active < parallel && queue.length) {
      const k = queue.shift(); if (state[k] !== 1) continue; active++;
      fetchOne(k).then((T) => {
        tiles[k] = T; state[k] = 2; loaded++; used[k] = ++clock;
        for (const f of listeners) try { f(T, {}); } catch (e) { console.error(e); }
        evict();
      }).catch((e) => { state[k] = 0; console.warn(e.message); }).finally(() => { active--; pump(); });
    }
  }
  const keep = new Set(); // tiles pinned (round the house's own lands): never evicted
  function evict() {
    if (loaded <= maxTiles) return;
    const order = []; for (let k = 0; k < NTT; k++) if (tiles[k] && !keep.has(k)) order.push(k);
    order.sort((a, b) => used[a] - used[b]);
    for (const k of order.slice(0, loaded - maxTiles)) { const T = tiles[k]; tiles[k] = null; state[k] = 0; loaded--; for (const f of listeners) try { f(T, { dropped: true }); } catch (e) { console.error(e); } }
  }
  map.want = (x, y, r, { pin = false } = {}) => {
    const tm = TILE_CELLS * cell, i0 = Math.max(0, Math.floor((x - r - x0) / tm)), i1 = Math.min(NT - 1, Math.floor((x + r - x0) / tm)), j0 = Math.max(0, Math.floor((y - r - y0) / tm)), j1 = Math.min(NT - 1, Math.floor((y + r - y0) / tm));
    const add = [];
    for (let tj = j0; tj <= j1; tj++) for (let ti = i0; ti <= i1; ti++) {
      const k = tj * NT + ti, cx = x0 + (ti + 0.5) * tm, cy = y0 + (tj + 0.5) * tm, d = Math.hypot(cx - x, cy - y);
      if (d > r + tm * 0.71) continue;
      if (pin) keep.add(k);
      used[k] = ++clock;
      if (state[k] === 0) { state[k] = 1; add.push([d, k]); }
    }
    for (const [, k] of add) queue.push(k);
    if (queue.length > 1) { const tm2 = TILE_CELLS * cell, d = (k) => Math.hypot(x0 + ((k % NT) + 0.5) * tm2 - x, y0 + (((k / NT) | 0) + 0.5) * tm2 - y); queue.sort((a, b) => d(a) - d(b)); } // (nearest the latest want first)
    if (add.length) pump();
    return add.length;
  };
  map.ready = () => active === 0 && !queue.some((k) => state[k] === 1);
  return map;
}
