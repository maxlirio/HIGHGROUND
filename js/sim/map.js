// Map: heightfield + surface grid + queries the whole sim uses (height, slope, surface, LOS).
// World coords are metres. Origin = map SW corner, +x east, +y north. Grid index (i,j) = (x,y)/cell.

export function makeMap({ size, res, height, surface = null, surfaceKeys = [], waterDepth = null, canopy = null, meta = {} }) {
  const cell = size / (res - 1);
  const map = { size, res, cell, height, surface, surfaceKeys, waterDepth, canopyGrid: canopy, meta };
  // canopy height (m) of woods/hedges at a point — blocks sight lines
  map.canopy = (x, y) => {
    if (!canopy) return 0;
    const i = Math.min(res - 1, Math.max(0, Math.round(x / cell))), j = Math.min(res - 1, Math.max(0, Math.round(y / cell)));
    return canopy[j * res + i];
  };

  map.h = (x, y) => {
    const fx = Math.min(Math.max(x / cell, 0), res - 1.001), fy = Math.min(Math.max(y / cell, 0), res - 1.001);
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
    const i = Math.min(res - 1, Math.max(0, Math.round(x / cell))), j = Math.min(res - 1, Math.max(0, Math.round(y / cell)));
    return surfaceKeys[surface[j * res + i]];
  };
  map.water = (x, y) => {
    if (!waterDepth) return 0;
    const i = Math.min(res - 1, Math.max(0, Math.round(x / cell))), j = Math.min(res - 1, Math.max(0, Math.round(y / cell)));
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
  map.inBounds = (x, y) => x >= 0 && y >= 0 && x <= size && y <= size;
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

// Browser/node loader for maps/<name>/ produced by the map pipeline.
export async function loadMap(base, fetcher = fetch) {
  const meta = await (await fetcher(`${base}/meta.json`)).json();
  const buf = await (await fetcher(`${base}/height.f32`)).arrayBuffer();
  const height = new Float32Array(buf);
  const res = meta.res ?? Math.round(Math.sqrt(height.length));
  let surface = null, surfaceKeys = meta.surfaceKeys || [], waterDepth = null;
  try {
    const sb = await fetcher(`${base}/surface.u8`); if (sb.ok) surface = new Uint8Array(await sb.arrayBuffer());
  } catch { /* optional */ }
  try {
    const wb = await fetcher(`${base}/water.f32`); if (wb.ok) waterDepth = new Float32Array(await wb.arrayBuffer());
  } catch { /* optional */ }
  let canopy = null;
  try { const cb = await fetcher(`${base}/canopy.u8`); if (cb.ok) canopy = new Uint8Array(await cb.arrayBuffer()); } catch { /* optional */ }
  const map = makeMap({ size: meta.size_m ?? meta.size, res, height, surface, surfaceKeys, waterDepth, canopy, meta });
  map.land = (await import("./landread.js")).readLand(map); // the rules read the land's physical makeup
  return map;
}
