// The land in TILES (docs/big-world.md §3). A map dir with a `world/` holds its land as 500 m tiles (128 cells of
// 3.90625 m, stored as 129 × 129 samples: the edge rows are shared, so a bilinear lookup never needs a neighbour tile),
// one gzip'd binary per tile, plus world/world.json (the extent, the core rectangle — the Vale — and per-tile sizes and
// tree counts). The sim (Node, the realm server) assembles the tiles it is asked for into the flat arrays map.js has
// always used; the browser's realm client streams them (js/render/terrain-world.js) — the same decoder everywhere.
//
// Tile file (little endian, gzip'd as a whole):
//   0  'HGT1'   4 u16 n (samples a side)   6 u8 hEnc   7 u8 wEnc   8 u8 surface?   9 u8 canopy?   10 u8 vegEnc   11 u8 0
//   12 i32 ti   16 i32 tj   20 f64 (reserved)   then the sections, in this order:
//   height   hEnc 0: f32 × n²  (exact — the Vale's own numbers)
//            hEnc 1: i32 base, then u16 × n² of row deltas of q = round(h × 64) − base (wrapping): 1/64 m steps
//   water    wEnc 0: none   1: f32 × n²   2: u16 × n² depth × 256 (row deltas)
//   surface  u8 × n² (ids into world.json surfaceKeys)        canopy  u8 × n² (m of canopy)
//   veg      u32 count, then vegEnc 1: per tree u32 global index, u8 asset, f64 x, y, rot, scale (exact)
//                                  vegEnc 2: per tree u8 asset, u16 x × 128, u16 y × 128 (tile-local), u8 rot × 256/2π,
//                                            u8 (scale − 0.3) × 100   (global index = the tile's vegBase + order)
// Rows are south-first (row 0 = the tile's south edge), as height.f32: sample (i, j) of tile (ti, tj) sits at world
// x = x0 + (ti·128 + i)·cell, y = y0 + (tj·128 + j)·cell.

export const TILE_CELLS = 128, TILE_N = TILE_CELLS + 1;
const MAGIC = 0x31544748; // "HGT1"
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- gzip (browser and Node ≥ 18 both have the streams)
async function pipe(bytes, Stream, fmt) {
  const s = new Blob([bytes]).stream().pipeThrough(new Stream(fmt));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export const gunzip = (bytes) => pipe(bytes, DecompressionStream, "gzip");
export const gzip = (bytes) => pipe(bytes, CompressionStream, "gzip");

// ---------------------------------------------------------------- encode (tools/map/pack_world.mjs)
// t = { ti, tj, n, height: Float32Array(n²), hEnc, water?: Float32Array, wEnc, surface?, canopy?, veg?: [...], vegEnc,
//       ox, oy (the tile's SW corner in world metres, for packed trees), assetId: (name) → u8 }
export function encodeTile(t) {
  const n = t.n, nn = n * n, parts = [];
  const head = new DataView(new ArrayBuffer(28));
  head.setUint32(0, MAGIC, true); head.setUint16(4, n, true); head.setUint8(6, t.hEnc); head.setUint8(7, t.water ? t.wEnc : 0);
  head.setUint8(8, t.surface ? 1 : 0); head.setUint8(9, t.canopy ? 1 : 0); head.setUint8(10, t.veg?.length ? t.vegEnc : 0);
  head.setInt32(12, t.ti, true); head.setInt32(16, t.tj, true);
  parts.push(new Uint8Array(head.buffer));
  if (t.hEnc === 0) parts.push(new Uint8Array(Float32Array.from(t.height).buffer));
  else {
    let base = Infinity; const q = new Int32Array(nn);
    for (let k = 0; k < nn; k++) { q[k] = Math.round(t.height[k] * 64); if (q[k] < base) base = q[k]; }
    const b = new DataView(new ArrayBuffer(4)); b.setInt32(0, base, true); parts.push(new Uint8Array(b.buffer));
    parts.push(deltas(q, n, base));
  }
  if (t.water && t.wEnc === 1) parts.push(new Uint8Array(Float32Array.from(t.water).buffer));
  else if (t.water && t.wEnc === 2) { const q = new Int32Array(nn); for (let k = 0; k < nn; k++) q[k] = Math.round(t.water[k] * 256); parts.push(deltas(q, n, 0)); }
  if (t.surface) parts.push(Uint8Array.from(t.surface));
  if (t.canopy) parts.push(Uint8Array.from(t.canopy));
  if (t.veg?.length) {
    const V = t.veg, exact = t.vegEnc === 1, dv = new DataView(new ArrayBuffer(4 + V.length * (exact ? 37 : 7)));
    dv.setUint32(0, V.length, true); let o = 4;
    for (const v of V) {
      if (exact) { dv.setUint32(o, v.idx, true); dv.setUint8(o + 4, t.assetId(v.asset)); dv.setFloat64(o + 5, v.x, true); dv.setFloat64(o + 13, v.y, true); dv.setFloat64(o + 21, v.rot, true); dv.setFloat64(o + 29, v.scale, true); o += 37; }
      else {
        dv.setUint8(o, t.assetId(v.asset));
        dv.setUint16(o + 1, Math.max(0, Math.min(65535, Math.round((v.x - t.ox) * 128))), true); dv.setUint16(o + 3, Math.max(0, Math.min(65535, Math.round((v.y - t.oy) * 128))), true);
        dv.setUint8(o + 5, Math.round((((v.rot % TAU) + TAU) % TAU) / TAU * 256) & 255); dv.setUint8(o + 6, Math.max(0, Math.min(255, Math.round((v.scale - 0.3) * 100)))); o += 7;
      }
    }
    parts.push(new Uint8Array(dv.buffer));
  }
  let len = 0; for (const p of parts) len += p.length;
  const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function deltas(q, n, base) { // row-delta coded u16 (wrapping): smooth ground is mostly small numbers, which gzip loves
  const u = new Uint16Array(n * n);
  for (let j = 0; j < n; j++) { let prev = base; for (let i = 0; i < n; i++) { const k = j * n + i; u[k] = (q[k] - prev) & 0xffff; prev = q[k]; } }
  return new Uint8Array(u.buffer);
}
function undeltas(bytes, off, n, base, scale) { // (q − base is in [0, 2^16): rebuilt modulo 2^16, exactly)
  const out = new Float32Array(n * n), dv = new DataView(bytes.buffer, bytes.byteOffset + off, n * n * 2);
  for (let j = 0; j < n; j++) { let r = 0; for (let i = 0; i < n; i++) { const k = j * n + i; r = (r + dv.getUint16(k * 2, true)) & 0xffff; out[k] = (base + r) / scale; } }
  return out;
}

// ---------------------------------------------------------------- decode
// → { ti, tj, n, height, water, surface, canopy, veg: [{ idx?, asset, x, y, rot, scale }] }
export function decodeTile(bytes, { ox = 0, oy = 0, assets = [] } = {}) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error("not a HIGHGROUND tile");
  const n = dv.getUint16(4, true), nn = n * n, hEnc = dv.getUint8(6), wEnc = dv.getUint8(7), hasS = dv.getUint8(8), hasC = dv.getUint8(9), vegEnc = dv.getUint8(10);
  const t = { ti: dv.getInt32(12, true), tj: dv.getInt32(16, true), n, hEnc, height: null, water: null, surface: null, canopy: null, veg: [] };
  let o = 28;
  if (hEnc === 0) { t.height = new Float32Array(bytes.slice(o, o + nn * 4).buffer); o += nn * 4; }
  else { const base = dv.getInt32(o, true); o += 4; t.height = undeltas(bytes, o, n, base, 64); o += nn * 2; }
  if (wEnc === 1) { t.water = new Float32Array(bytes.slice(o, o + nn * 4).buffer); o += nn * 4; }
  else if (wEnc === 2) { t.water = undeltas(bytes, o, n, 0, 256); o += nn * 2; }
  if (hasS) { t.surface = bytes.slice(o, o + nn); o += nn; }
  if (hasC) { t.canopy = bytes.slice(o, o + nn); o += nn; }
  if (vegEnc) {
    const cnt = dv.getUint32(o, true); o += 4;
    for (let q = 0; q < cnt; q++) {
      if (vegEnc === 1) { t.veg.push({ idx: dv.getUint32(o, true), asset: assets[dv.getUint8(o + 4)], x: dv.getFloat64(o + 5, true), y: dv.getFloat64(o + 13, true), rot: dv.getFloat64(o + 21, true), scale: dv.getFloat64(o + 29, true) }); o += 37; }
      else { t.veg.push({ asset: assets[dv.getUint8(o)], x: ox + dv.getUint16(o + 1, true) / 128, y: oy + dv.getUint16(o + 3, true) / 128, rot: dv.getUint8(o + 5) / 256 * TAU, scale: 0.3 + dv.getUint8(o + 6) / 100 }); o += 7; }
    }
  }
  return t;
}

// ---------------------------------------------------------------- the world index and loading tiles
export async function loadWorldIndex(base, fetcher = fetch) {
  try { const r = await fetcher(`${base}/world/world.json`); if (!r.ok) return null; const W = await r.json(); return W?.version ? W : null; }
  catch { return null; }
}
export const tileKey = (W, ti, tj) => tj * W.tiles[0] + ti;
export const tileOrigin = (W, ti, tj) => [W.origin[0] + ti * TILE_CELLS * W.cell, W.origin[1] + tj * TILE_CELLS * W.cell];
export async function fetchTile(base, W, ti, tj, fetcher = fetch) {
  const r = await fetcher(`${base}/world/t/${ti}_${tj}.gz`); if (!r.ok) return null;
  const raw = new Uint8Array(await r.arrayBuffer());
  const bytes = raw[0] === 0x1f && raw[1] === 0x8b ? await gunzip(raw) : raw; // (a server may have taken the gzip off already)
  const [ox, oy] = tileOrigin(W, ti, tj);
  const t = decodeTile(bytes, { ox, oy, assets: W.vegAssets });
  const k = tileKey(W, ti, tj); t.vegBase = W.vegBase?.[k] ?? 0;
  if (t.veg.length && t.veg[0].idx === undefined) t.veg.forEach((v, q) => { v.idx = t.vegBase + q; });
  return t;
}
// Assemble tiles [ti0..ti1] × [tj0..tj1] into flat south-first arrays (res = tiles·128 + 1), as loadMap has always had.
// Exact tiles are written last, so where a packed tile and an exact one share an edge the exact numbers stand.
// → { x0, y0, size, res, height, water, surface, canopy, veg (global-index order) }
export async function assembleTiles(base, W, [ti0, tj0, ti1, tj1], fetcher = fetch, { veg = true, parallel = 16 } = {}) {
  const nx = ti1 - ti0 + 1, ny = tj1 - tj0 + 1, res = nx * TILE_CELLS + 1;
  if (ny !== nx) throw new Error("assembleTiles: square extents only");
  const height = new Float32Array(res * res), water = new Float32Array(res * res), surface = new Uint8Array(res * res), canopy = new Uint8Array(res * res);
  const jobs = []; for (let tj = tj0; tj <= tj1; tj++) for (let ti = ti0; ti <= ti1; ti++) jobs.push([ti, tj]);
  const tiles = [];
  for (let q = 0; q < jobs.length; q += parallel) tiles.push(...await Promise.all(jobs.slice(q, q + parallel).map(([ti, tj]) => fetchTile(base, W, ti, tj, fetcher))));
  let hasW = false, hasS = false, hasC = false; const trees = [];
  const order = tiles.map((t, q) => [t, q]).filter(([t]) => t).sort((a, b) => (a[0].hEnc === 0 ? 1 : 0) - (b[0].hEnc === 0 ? 1 : 0) || a[1] - b[1]);
  for (const [t] of order) {
    const n = t.n, I0 = (t.ti - ti0) * TILE_CELLS, J0 = (t.tj - tj0) * TILE_CELLS;
    for (let j = 0; j < n; j++) {
      const row = (J0 + j) * res + I0, src = j * n;
      height.set(t.height.subarray(src, src + n), row);
      if (t.water) { water.set(t.water.subarray(src, src + n), row); hasW = true; }
      if (t.surface) { surface.set(t.surface.subarray(src, src + n), row); hasS = true; }
      if (t.canopy) { canopy.set(t.canopy.subarray(src, src + n), row); hasC = true; }
    }
    if (veg) for (const v of t.veg) trees.push(v);
  }
  trees.sort((a, b) => a.idx - b.idx);
  const [x0, y0] = tileOrigin(W, ti0, tj0);
  return { x0, y0, size: nx * TILE_CELLS * W.cell, res, height, water: hasW ? water : null, surface: hasS ? surface : null, canopy: hasC ? canopy : null,
    veg: trees.map((v) => ({ asset: v.asset, x: v.x, y: v.y, rot: v.rot, scale: v.scale })) };
}

// ---------------------------------------------------------------- the coarse world (world/coarse.gz)
// The whole world every 8 cells (31.25 m): heights at the grid's own nodes (so a coarse mesh meets the fine tiles on
// their shared nodes), the commonest surface of each 8×8 block, the deepest water in it (a river stays a river from
// afar) and its mean canopy. The distant land, the world map and the minimap; the first frame before any tile arrives.
//   0 'HGC1'  4 u16 n  6 u16 step (cells)  8 f32 x0  12 f32 y0  16 f32 cell (m)  20 i32 height base
//   24: height u16 × n² (row deltas of round(h × 64) − base), surface u8 × n², water u16 × n² (depth × 256, row deltas),
//   canopy u8 × n²
const CMAGIC = 0x31434748; // "HGC1"
export function encodeCoarse({ n, step, x0, y0, cell, height, surface, water, canopy }) {
  const nn = n * n, head = new DataView(new ArrayBuffer(24)), q = new Int32Array(nn); let base = Infinity;
  for (let k = 0; k < nn; k++) { q[k] = Math.round(height[k] * 64); if (q[k] < base) base = q[k]; }
  head.setUint32(0, CMAGIC, true); head.setUint16(4, n, true); head.setUint16(6, step, true); head.setFloat32(8, x0, true); head.setFloat32(12, y0, true); head.setFloat32(16, cell, true); head.setInt32(20, base, true);
  const wq = new Int32Array(nn); for (let k = 0; k < nn; k++) wq[k] = Math.round(water[k] * 256);
  const parts = [new Uint8Array(head.buffer), deltas(q, n, base), Uint8Array.from(surface), deltas(wq, n, 0), Uint8Array.from(canopy)];
  let len = 0; for (const p of parts) len += p.length; const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function decodeCoarse(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== CMAGIC) throw new Error("not a coarse world");
  const n = dv.getUint16(4, true), nn = n * n, base = dv.getInt32(20, true); let o = 24;
  const C = { n, step: dv.getUint16(6, true), x0: dv.getFloat32(8, true), y0: dv.getFloat32(12, true), cell: dv.getFloat32(16, true) };
  C.height = undeltas(bytes, o, n, base, 64); o += nn * 2;
  C.surface = bytes.slice(o, o + nn); o += nn;
  C.water = undeltas(bytes, o, n, 0, 256); o += nn * 2;
  C.canopy = bytes.slice(o, o + nn);
  return C;
}
export async function loadCoarse(base, fetcher = fetch) {
  try { const r = await fetcher(`${base}/world/coarse.gz`); if (!r.ok) return null; const raw = new Uint8Array(await r.arrayBuffer()); return decodeCoarse(raw[0] === 0x1f && raw[1] === 0x8b ? await gunzip(raw) : raw); }
  catch { return null; }
}
