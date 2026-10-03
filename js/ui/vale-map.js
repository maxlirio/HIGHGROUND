// A painted map of the Vale for the battle screens (the setup's field picker, the reckoning's replay): hillshade
// and height tints, woods, marsh, water, roads and 10 m contours — all read from the land itself.
//   valeMap(map, px) → canvas (cached per size);  w2c(map, px) → (x, y) → [cx, cy];  c2w → the reverse
import { sampler } from "../sim/battlefield.js";

const cache = new Map();
export const w2c = (map, px, box = null) => (x, y) => box
  ? [(x - box.x0) / (box.x1 - box.x0) * px, (box.y1 - y) / (box.y1 - box.y0) * px]
  : [x / map.size * px, (map.size - y) / map.size * px];
export const c2w = (map, px, box = null) => (cx, cy) => box
  ? [box.x0 + cx / px * (box.x1 - box.x0), box.y1 - cy / px * (box.y1 - box.y0)]
  : [cx / px * map.size, map.size - cy / px * map.size];

// box: optional { x0, y0, x1, y1 } window of the map (square) — the replay zooms on the battlefield
export function valeMap(map, px = 512, box = null) {
  const key = px + (box ? `|${box.x0 | 0},${box.y0 | 0},${box.x1 | 0}` : "");
  if (cache.has(key)) return cache.get(key);
  const cv = document.createElement("canvas"); cv.width = cv.height = px;
  const g = cv.getContext("2d"), img = g.createImageData(px, px), d = img.data, s = sampler(map);
  const [X0, Y0, X1, Y1] = box ? [box.x0, box.y0, box.x1, box.y1] : [0, 0, map.size, map.size];
  const step = (X1 - X0) / px, hmin = map.meta?.height_min_m ?? 40, hmax = map.meta?.height_max_m ?? 200;
  const lx = -0.6, ly = 0.55, lz = 0.58; // light from the north-west, cartographers' convention
  for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
    const x = X0 + (i + 0.5) * step, y = Y1 - (j + 0.5) * step, k = (j * px + i) * 4;
    if (x < 0 || y < 0 || x > map.size || y > map.size) { d[k] = 22; d[k + 1] = 20; d[k + 2] = 16; d[k + 3] = 255; continue; }
    const h = s.h(x, y), e = Math.max(step, map.cell);
    const gx = (s.h(x + e, y) - s.h(x - e, y)) / (2 * e), gy = (s.h(x, y + e) - s.h(x, y - e)) / (2 * e);
    const nz = 1 / Math.hypot(gx, gy, 1), shade = Math.max(0, (-gx * lx - gy * ly + lz) * nz) * 1.25;
    const t = Math.max(0, Math.min(1, (h - hmin) / (hmax - hmin)));
    // height tint: water-meadow green → pasture → upland ochre → heath brown
    let r = 118 + t * 70, gg = 132 + t * 22 - t * t * 30, b = 78 + t * 20;
    const wd = s.wood(x, y); if (wd > 0.2) { const a = Math.min(1, wd * 1.2); r = r * (1 - a) + 52 * a; gg = gg * (1 - a) + 78 * a; b = b * (1 - a) + 44 * a; }
    const bog = s.bog(x, y); if (bog > 0.45) { const a = Math.min(0.7, bog); r = r * (1 - a) + 92 * a; gg = gg * (1 - a) + 110 * a; b = b * (1 - a) + 96 * a; if (((i * 7 + j * 13) % 5) === 0) { r -= 25; gg -= 20; b -= 10; } }
    if (s.road(x, y) && (map.land?.roadCore?.[map.land.idx(x, y)])) { r = 176; gg = 150; b = 104; }
    r *= 0.55 + shade * 0.5; gg *= 0.55 + shade * 0.5; b *= 0.55 + shade * 0.5;
    const w = s.water(x, y);
    if (w > 0.05) { const a = Math.min(1, 0.55 + w * 0.2); r = r * (1 - a) + 52 * a; gg = gg * (1 - a) + 92 * a; b = b * (1 - a) + 128 * a; }
    // contours every 10 m (index every 50)
    const hc = h / 10, fr = hc - Math.floor(hc), band = Math.hypot(gx, gy) * step / 10 * 1.2;
    if (w < 0.05 && (fr < band || fr > 1 - band)) { const idx = Math.round(hc) % 5 === 0 ? 0.72 : 0.86; r *= idx; gg *= idx; b *= idx; }
    d[k] = r; d[k + 1] = gg; d[k + 2] = b; d[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  cache.set(key, cv);
  return cv;
}
// named places (map features) to label a map with
export function mapLabels(map) {
  const out = [];
  for (const f of map.meta?.features || []) {
    if (!f.xy_m || ["farmland", "reverse_slope", "river"].includes(f.type)) continue;
    out.push({ name: String(f.name).replace(/\s*\(.*?\)\s*/g, "").trim(), x: f.xy_m[0], y: f.xy_m[1], type: f.type });
  }
  return out;
}
