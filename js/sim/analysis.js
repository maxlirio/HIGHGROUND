import { terrainAt } from "./landread.js";
// cover against missiles from the terrain table (hard cover stops arrows; soft only hides/deflects some)
export const coverOf = (t) => t ? (typeof t.coverMissile === "number" ? t.coverMissile : Math.max(t.cover?.hard ?? 0, (t.cover?.soft ?? 0) * 0.5)) : 0;

// Tactical terrain analysis. The overlays and the order popup read THESE numbers, and the combat
// system reads the same terrain tables — what the player is shown is what the sim uses.

export function analysePoint(w, x, y) {
  const map = w.map, t = terrainAt(w, x, y), key = t.name;
  const h = map.h(x, y);
  const [gx, gy] = map.grad(x, y); const slope = Math.hypot(gx, gy);
  // local prominence: height above the mean of a 300 m ring
  let ring = 0, n = 0, maxRing = -Infinity;
  for (let a = 0; a < 16; a++) {
    const px = x + Math.cos(a / 16 * 6.283) * 300, py = y + Math.sin(a / 16 * 6.283) * 300;
    if (!map.inBounds(px, py)) continue; const hh = map.h(px, py); ring += hh; n++; maxRing = Math.max(maxRing, hh);
  }
  const prominence = n ? h - ring / n : 0;
  const dominated = maxRing > h + 8; // someone on a nearby height looks down on you
  // viewshed fraction: how much of the 600 m circle can you see from here
  let seen = 0, tot = 0;
  for (let a = 0; a < 24; a++) for (const d of [150, 300, 450, 600]) {
    const px = x + Math.cos(a / 24 * 6.283) * d, py = y + Math.sin(a / 24 * 6.283) * d;
    if (!map.inBounds(px, py)) continue; tot++;
    if (map.los(x, y, 1.7, px, py, 1.7)) seen++;
  }
  const view = tot ? seen / tot : 0;
  const cover = coverOf(t);
  const conceal = t.concealment?.standing ?? t.concealment ?? 0;
  const going = t.moveMul?.foot ?? 1;
  const cav = t.chargeViable ?? 1;
  const water = map.water(x, y);
  // Defensibility: height advantage + view + cover + bad going in front, discounted if dominated.
  const defensible = clamp01(0.35 * clamp01(prominence / 25) + 0.2 * view + 0.25 * cover + 0.15 * (1 - cav) + 0.15 * clamp01(slope / 0.2) - (dominated ? 0.15 : 0));
  return { key, name: t.name || prettify(key), h, slope, prominence, dominated, view, cover, conceal, going, cav, water, defensible, notes: notesFor({ prominence, slope, view, cover, conceal, going, cav, water, dominated, t }) };
}

function notesFor(a) {
  const n = [];
  if (a.prominence > 15) n.push("Commanding height: arrows carry further, enemies arrive winded.");
  else if (a.prominence > 5) n.push("Modest rise: a small but real edge to defenders.");
  else if (a.prominence < -10) n.push("Low ground: overlooked and easily shot into.");
  if (a.dominated) n.push("A nearby height overlooks this spot.");
  if (a.slope > 0.2) n.push("Steep: charges up this slope arrive broken and blown.");
  if (a.cover > 0.4) n.push("Good cover against missiles.");
  if (a.conceal > 0.5) n.push("Troops here are hard to spot — ambush ground.");
  if (a.cav < 0.4) n.push("Cavalry cannot charge effectively here.");
  if (a.going < 0.6) n.push("Slow, tiring going; formations will fray.");
  if (a.water > 0.2) n.push(a.water > 1 ? "Deep water — impassable to foot." : "Shallow water: a ford, slow and exposed.");
  if (a.view > 0.8) n.push("Wide field of view.");
  if (a.t?.note) n.push(a.t.note);
  return n;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const prettify = (k) => (k || "ground").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

// Overlay rasters (RGBA8, res×res over the map) for the toggle buttons.
export function overlayRaster(w, kind, res = 192, from = null) {
  const out = new Uint8Array(res * res * 4), map = w.map, step = map.size / res;
  let hmin = Infinity, hmax = -Infinity;
  if (kind === "elevation") for (let k = 0; k < map.height.length; k++) { hmin = Math.min(hmin, map.height[k]); hmax = Math.max(hmax, map.height[k]); }
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const x = (i + 0.5) * step, y = (j + 0.5) * step, o = (j * res + i) * 4;
    let r = 0, g = 0, b = 0, a = 0;
    if (kind === "elevation") {
      const f = (map.h(x, y) - hmin) / (hmax - hmin || 1);
      [r, g, b] = ramp(f, [[0, [40, 90, 60]], [0.35, [150, 170, 80]], [0.65, [210, 160, 70]], [1, [250, 245, 235]]]);
      const band = Math.abs(((map.h(x, y) / 10) % 1) - 0.5) < 0.06; // 10 m contour lines
      if (band) { r *= 0.5; g *= 0.5; b *= 0.5; }
      a = 150;
    } else if (kind === "defensible") {
      const A = analyseLite(w, x, y); [r, g, b] = ramp(A.defensible, [[0, [180, 40, 30]], [0.5, [220, 200, 60]], [1, [40, 170, 60]]]); a = 150;
    } else if (kind === "cover") {
      const t = terrainAt(w, x, y) || {}; const c = coverOf(t); const cc = t.concealment?.standing ?? 0;
      r = 60 + cc * 120; g = 90 + c * 150; b = 200 - c * 120; a = 40 + Math.max(c, cc) * 170;
    } else if (kind === "going") {
      const t = terrainAt(w, x, y) || {}; const [gx, gy] = map.grad(x, y);
      const m = (t.moveMul?.foot ?? 1) * Math.exp(-3.5 * Math.hypot(gx, gy)); const wd = map.water(x, y);
      [r, g, b] = wd > 1 ? [30, 60, 160] : ramp(m, [[0, [160, 30, 30]], [0.5, [220, 170, 50]], [1, [60, 160, 70]]]); a = 140;
    } else if (kind === "charge") {
      const t = terrainAt(w, x, y) || {}; const [gx, gy] = map.grad(x, y);
      const ok = (t.chargeViable ?? 1) * (Math.hypot(gx, gy) < 0.12 ? 1 : 0.2) * (map.water(x, y) > 0.1 ? 0 : 1);
      [r, g, b] = ok > 0.6 ? [230, 190, 60] : [40, 40, 40]; a = ok > 0.6 ? 110 : 90;
    } else if (kind === "los" && from) {
      const vis = map.los(from.x, from.y, 1.7, x, y, 1.7);
      [r, g, b] = vis ? [80, 200, 255] : [10, 10, 30]; a = vis ? 60 : 150;
    }
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
  }
  return out;
}

// cheaper version for rasters (no viewshed)
function analyseLite(w, x, y) {
  const map = w.map, t = terrainAt(w, x, y) || {};
  const h = map.h(x, y); let ring = 0, mx = -Infinity;
  for (let a = 0; a < 8; a++) { const hh = map.h(x + Math.cos(a * 0.785) * 250, y + Math.sin(a * 0.785) * 250); ring += hh; mx = Math.max(mx, hh); }
  const prominence = h - ring / 8, [gx, gy] = map.grad(x, y), slope = Math.hypot(gx, gy);
  const cover = coverOf(t), cav = t.chargeViable ?? 1;
  return { defensible: clamp01(0.45 * clamp01(prominence / 25) + 0.25 * cover + 0.15 * (1 - cav) + 0.15 * clamp01(slope / 0.2) - (mx > h + 8 ? 0.15 : 0) + 0.1) };
}

function ramp(f, stops) {
  f = clamp01(f);
  for (let k = 1; k < stops.length; k++) if (f <= stops[k][0]) {
    const [f0, c0] = stops[k - 1], [f1, c1] = stops[k], u = (f - f0) / (f1 - f0 || 1);
    return c0.map((c, i) => c + (c1[i] - c) * u);
  }
  return stops[stops.length - 1][1];
}
