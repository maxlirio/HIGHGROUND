// The WORLD MAP (M, the map button, Esc closes). The owner: "There should be a world map that lets you see everything
// you have explored." A 2D cartographer's sheet of the whole map drawn from the map's own data (height shading, water,
// woods, marsh, roads, hamlets; the fields the houses have made) — but only where your house has been: the fog grid's known cells.
//   · never seen (0): blank parchment
//   · remembered (1): the land, and the LAST-KNOWN buildings of other houses, washed in sepia
//   · in sight now (2): bright, with live companies, game and dragons
// Fog is honoured as the 3D view honours it: single-player reads js/sim/vision.js's grid for PLAYER (and keeps its own
// memory of other houses' buildings, updated only while they are in sight — tick()); the Realm's client only ever
// holds what server/views.mjs sent (its fog frames, its seen units, its remembered buildings), and this draws no more.
// Battles and sieges: the land is known (the terrain shows no fog there either); enemy men only where seen.
//
// Performance: the land is painted ONCE per map into an offscreen canvas (built lazily on first open); the fog mask is
// rebuilt only when the grid changes; markers are composited on a ~1.4 Hz refresh while open and on pan/zoom. Closed:
// only tick() (a building-memory pass once a second, single-player).
//
//   const wm = makeWorldMap({ map, w, V, PLAYER, settle, places, banners, teamName, townName, focus, camera, landKnown, realm })
//   wm.tick(now[, force])   wm.open()   wm.close()   wm.toggle()   wm.isOpen()
import { sampler } from "../sim/battlefield.js";
import { ARMS } from "../sim/arms.js";
import { BUILDINGS } from "../sim/econ-data.js";
import { SPECIES } from "../sim/wild.js";
import { GLYPHS } from "./glyphs.js";
import { bannerColor, bannerAccent, drawBanner } from "./heraldry.js";

const BASE_PX = 2048, RASTER_PX = 1024;            // the painted sheet; the per-pixel pass runs at half and is upscaled
const PAPER = [233, 218, 180], INK = "#3b2a18", SEPIA = "#6b4a28", WATER_INK = "#2f5566";
const REFRESH_MS = 700;

const CSS = `
#wmapbtn { position:fixed; left:12px; bottom:58px; z-index:35; width:38px; height:38px; padding:0; border-radius:50%; display:grid; place-items:center;
  background:var(--panel); border:1px solid var(--edge); color:var(--gold); box-shadow:0 2px 8px #0008; }
#wmapbtn:hover, #wmapbtn.on { border-color:var(--gold); background:#3a3224; }
#wmapbtn svg { width:20px; height:20px; display:block; }
#worldmap { position:fixed; inset:0; z-index:60; background:rgba(10,8,5,.72); display:flex; align-items:center; justify-content:center; }
#worldmap[hidden] { display:none; }
#worldmap .wmsheet { position:relative; display:flex; flex-direction:column; width:min(1180px, calc(100vw - 24px)); height:calc(100vh - 24px); max-height:980px;
  background:#2a2117; border:1px solid var(--gold); border-radius:6px; box-shadow:0 10px 40px #000c; overflow:hidden; }
#worldmap .wmhead { display:flex; align-items:center; gap:12px; padding:7px 10px 7px 14px; border-bottom:1px solid var(--edge); background:linear-gradient(#2f2619, #241c13); }
#worldmap .wmhead h2 { margin:0; font-size:17px; color:var(--gold); letter-spacing:.06em; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#worldmap .wmhead .wmsub { color:var(--dim); font-size:12px; white-space:nowrap; }
#worldmap .wmhead .sp { flex:1; }
#worldmap .wmhead button { padding:3px 9px; }
#worldmap .wmbody { position:relative; flex:1; display:flex; min-height:0; }
#worldmap .wmcv { position:relative; flex:1; min-width:0; touch-action:none; cursor:crosshair; }
#worldmap .wmcv.drag { cursor:grabbing; }
#worldmap canvas.wmc { position:absolute; inset:0; width:100%; height:100%; display:block; }
#worldmap .wmtip { position:absolute; pointer-events:none; max-width:260px; background:rgba(28,22,14,.93); color:var(--ink); border:1px solid var(--edge); border-radius:3px;
  padding:5px 8px; font-size:12px; line-height:1.35; box-shadow:0 2px 10px #0009; }
#worldmap .wmtip b { color:var(--gold); font-weight:600; } #worldmap .wmtip i { color:var(--dim); }
#worldmap .wmlegend { width:206px; flex:none; overflow:auto; border-left:1px solid var(--edge); background:#231b12; padding:10px 12px; font-size:12px; color:var(--ink); }
#worldmap .wmlegend h3 { margin:10px 0 5px; font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--dim); font-weight:400; }
#worldmap .wmlegend h3:first-child { margin-top:0; }
#worldmap .wmlegend .li { display:flex; align-items:center; gap:8px; margin:3px 0; }
#worldmap .wmlegend canvas { flex:none; border-radius:2px; }
#worldmap .wmlegend p { color:var(--dim); margin:8px 0 0; line-height:1.4; }
#worldmap .wmlegbtn { display:none; }
#worldmap .wmloading[hidden], #worldmap .wmtip[hidden] { display:none; }
#worldmap .wmloading { position:absolute; inset:0; display:grid; place-items:center; color:#5a4426; font-style:italic; font-size:16px; pointer-events:none; }
@media (max-width: 760px) {
  #worldmap .wmsheet { width:100vw; height:100vh; max-height:none; border-radius:0; border:0; }
  #worldmap .wmlegend { position:absolute; right:0; top:0; bottom:0; z-index:2; box-shadow:-4px 0 16px #000a; }
  #worldmap .wmlegend:not(.show) { display:none; }
  #worldmap .wmlegbtn { display:inline-block; }
  #worldmap .wmhead .wmsub { display:none; }
}
`;
const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M3 6.5 8.5 4l7 2.5L21 4v13.5L15.5 20l-7-2.5L3 20z"/><path d="M8.5 4v13.5M15.5 6.5V20"/><path d="M5.5 10.5c1.2-.6 2-.2 3 .6M11 13c1.3.7 2.6.6 3.6-.3M17.4 9.4l1.6 1.6M19 9.4l-1.6 1.6"/></svg>`;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const cleanName = (s) => String(s).replace(/\s*\(.*?\)\s*/g, "").trim();
const NATURAL = { hill: 1, ridge: 1, rocky_upland: 1, motte_hill: 1, defile: 1, gully: 1, wooded_valley: 1, wooded_knoll: 1, stream_valley: 0, open_plain: 1, sunken_lane: 1 };
const WATERY = { lake: 1, marsh: 1, river: 1, ford: 1, stream_valley: 1, bridge_site: 1 };

// ---------------------------------------------------------------- the painted sheet (once per map)
function paintBase(map, settle) {
  const s = sampler(map), R = RASTER_PX, size = map.size, step = size / R, X0 = map.x0 || 0, Y0 = map.y0 || 0; // (the sheet covers the world's extent: docs/big-world.md)
  const hmin = map.meta?.height_min_m ?? 40, hmax = map.meta?.height_max_m ?? 200;
  // heights on the raster grid once (one map.h a pixel), then gradients from neighbours
  const HG = new Float32Array((R + 2) * (R + 2));
  for (let j = -1; j <= R; j++) for (let i = -1; i <= R; i++) {
    const x = clamp(X0 + (i + 0.5) * step, X0, X0 + size - 0.01), y = clamp(Y0 + size - (j + 0.5) * step, Y0, Y0 + size - 0.01);
    HG[(j + 1) * (R + 2) + (i + 1)] = map.h(x, y);
  }
  const cv = document.createElement("canvas"); cv.width = cv.height = R;
  const g = cv.getContext("2d"), img = g.createImageData(R, R), d = img.data;
  const lx = -0.6, ly = 0.55, lz = 0.58; // light from the north-west, the cartographers' convention
  const isWater = new Uint8Array(R * R);
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const x = X0 + (i + 0.5) * step, y = Y0 + size - (j + 0.5) * step, k = j * R + i, o = k * 4, q = (j + 1) * (R + 2) + (i + 1);
    const h = HG[q], gx = (HG[q + 1] - HG[q - 1]) / (2 * step), gy = (HG[q - (R + 2)] - HG[q + (R + 2)]) / (2 * step);
    const nz = 1 / Math.hypot(gx, gy, 1), shade = Math.max(0, (-gx * lx - gy * ly + lz) * nz);
    const t = clamp((h - hmin) / Math.max(1, hmax - hmin), 0, 1);
    // paper, tinted by height: water-meadow green → pasture → upland ochre → fell brown
    let r = PAPER[0] - 22 + t * 10, gg = PAPER[1] - 6 - t * 18, b = PAPER[2] - 34 + t * 2;
    if (t > 0.6) { const a = (t - 0.6) / 0.4; r -= a * 14; gg -= a * 22; b -= a * 18; }
    const wd = s.wood(x, y); if (wd > 0.18) { const a = Math.min(0.85, (wd - 0.18) * 1.3); r += (150 - r) * a; gg += (166 - gg) * a; b += (112 - b) * a; }
    const bog = s.bog(x, y); if (bog > 0.4) { const a = Math.min(0.55, bog * 0.6); r += (178 - r) * a; gg += (192 - gg) * a; b += (160 - b) * a; }
    const rk = s.rock(x, y); if (rk > 0.35) { const a = Math.min(0.6, (rk - 0.35) * 1.4); r += (186 - r) * a; gg += (178 - gg) * a; b += (164 - b) * a; }
    const lit = 0.86 + shade * 0.22; r *= lit; gg *= lit; b *= lit;
    const wv = s.water(x, y);
    if (wv > 0.05) { isWater[k] = 1; const a = Math.min(1, 0.6 + wv * 0.15), deep = Math.min(1, wv / 4); r = r * (1 - a) + (150 - deep * 30) * a; gg = gg * (1 - a) + (184 - deep * 22) * a; b = b * (1 - a) + (190 - deep * 10) * a; }
    else { // contours: 10 m, an index line every 50 m (sepia, faint)
      const hc = h / 10, fr = hc - Math.floor(hc), band = Math.hypot(gx, gy) * step / 10 * 1.1;
      if (fr < band || fr > 1 - band) { const m = Math.round(hc) % 5 === 0 ? 0.8 : 0.9; r *= m; gg *= m * 0.98; b *= m * 0.94; }
    }
    d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
  }
  // the shoreline: an inked edge where water meets land
  for (let j = 1; j < R - 1; j++) for (let i = 1; i < R - 1; i++) {
    const k = j * R + i; if (!isWater[k]) continue;
    if (!isWater[k - 1] || !isWater[k + 1] || !isWater[k - R] || !isWater[k + R]) { const o = k * 4; d[o] = 70; d[o + 1] = 100; d[o + 2] = 112; }
  }
  g.putImageData(img, 0, 0);

  const B = BASE_PX, out = document.createElement("canvas"); out.width = out.height = B;
  const c = out.getContext("2d"); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high"; c.drawImage(cv, 0, 0, B, B);
  const k = B / size, P = (x, y) => [(x - X0) * k, (Y0 + size - y) * k];
  // trees: a stamp of little round crowns where the wood is thick (jittered, so it reads as woodland, not a grid)
  const tree = document.createElement("canvas"); tree.width = tree.height = 12;
  { const t = tree.getContext("2d"); t.fillStyle = "#6f7d45"; t.strokeStyle = "#3d4a22"; t.lineWidth = 1; t.beginPath(); t.arc(6, 5, 3.6, 0, 7); t.fill(); t.stroke(); t.fillStyle = "#3d4a22"; t.fillRect(5.5, 8.4, 1, 2.6); }
  let seed = 9; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const TS = 9; // px between crowns on the sheet (~18 m)
  for (let py = 4; py < B; py += TS) for (let px = 4 + ((py / TS) & 1) * TS / 2; px < B; px += TS) {
    const jx = px + (rnd() - 0.5) * 5, jy = py + (rnd() - 0.5) * 5, x = X0 + jx / k, y = Y0 + size - jy / k;
    if (x < X0 || y < Y0 || x >= X0 + size || y >= Y0 + size || s.water(x, y) > 0.02) continue;
    const wd = s.wood(x, y); if (wd < 0.45 || rnd() > Math.min(1, (wd - 0.35) * 1.6)) continue;
    const sc = 0.75 + rnd() * 0.35; c.drawImage(tree, jx - 6 * sc, jy - 6 * sc, 12 * sc, 12 * sc);
  }
  // marsh: tufts
  c.strokeStyle = "rgba(60,90,80,.75)"; c.lineWidth = 0.9;
  for (let py = 6; py < B; py += 11) for (let px = 6 + ((py / 11) & 1) * 5; px < B; px += 13) {
    const x = X0 + px / k, y = Y0 + size - py / k; if (s.bog(x, y) < 0.55 || s.water(x, y) > 0.05) continue;
    c.beginPath(); c.moveTo(px - 3, py); c.lineTo(px + 3, py); c.moveTo(px, py); c.lineTo(px, py - 3); c.moveTo(px - 1.6, py); c.lineTo(px - 2.6, py - 2.4); c.moveTo(px + 1.6, py); c.lineTo(px + 2.6, py - 2.4); c.stroke();
  }
  // rock: stipple
  c.fillStyle = "rgba(80,66,50,.55)";
  for (let py = 3; py < B; py += 6) for (let px = 3 + ((py / 6) & 1) * 3; px < B; px += 6) {
    const x = X0 + px / k, y = Y0 + size - py / k; if (s.rock(x, y) < 0.55 || s.water(x, y) > 0.05) continue;
    if (rnd() < 0.55) c.fillRect(px + (rnd() - 0.5) * 3, py + (rnd() - 0.5) * 3, 1.2, 1.2);
  }
  // (no furlongs: the land is grass, and the only fields are the ones the houses have made — drawn with their buildings)
  // roads and tracks (settlements.json): highways bold, tracks dashed, paths dotted
  const RS = { highway: [2.6, "#7a4e2a", null], causeway: [2.4, "#7a4e2a", null], village_street: [2.0, "#7a4e2a", null], hollow_way: [1.7, "#7a4e2a", [5, 2]], track: [1.5, "#86603a", [6, 3]], path: [1.1, "#86603a", [2, 3]] };
  c.lineCap = "round"; c.lineJoin = "round";
  for (const pass of [0, 1]) for (const r of settle?.roads || []) {
    const st = RS[r.type] || RS.track; if (!r.pts?.length) continue;
    c.beginPath(); r.pts.forEach(([x, y], q) => { const [px, py] = P(x, y); if (q) c.lineTo(px, py); else c.moveTo(px, py); });
    if (pass === 0) { if (st[0] < 2) continue; c.setLineDash([]); c.strokeStyle = "rgba(240,228,196,.85)"; c.lineWidth = st[0] + 2; c.stroke(); }
    else { c.setLineDash(st[2] || []); c.strokeStyle = st[1]; c.lineWidth = st[0]; c.stroke(); }
  }
  c.setLineDash([]);
  // bridges: a little span
  for (const br of settle?.bridges || []) {
    if (!br.end_south || !br.end_north) continue; const [ax, ay] = P(...br.end_south), [bx, by] = P(...br.end_north), dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = -dy / L * 3, ny = dx / L * 3;
    c.strokeStyle = INK; c.lineWidth = 1.3; c.beginPath(); c.moveTo(ax + nx - dx * 0.4, ay + ny - dy * 0.4); c.lineTo(bx + nx + dx * 0.4, by + ny + dy * 0.4); c.moveTo(ax - nx - dx * 0.4, ay - ny - dy * 0.4); c.lineTo(bx - nx + dx * 0.4, by - ny + dy * 0.4); c.stroke();
  }
  // the hamlets: their crofts and barns, inked small
  c.fillStyle = "#8a3f2a"; c.strokeStyle = "#4a2414"; c.lineWidth = 0.6;
  for (const hm of settle?.hamlets || []) for (const b of hm.buildings || []) {
    const [px, py] = P(b.x, b.y), sz = b.kind === "farm" || b.kind === "granary" ? 3.2 : 2.4;
    c.save(); c.translate(px, py); c.rotate(-(b.rot || 0)); c.fillRect(-sz, -sz * 0.7, sz * 2, sz * 1.4); c.strokeRect(-sz, -sz * 0.7, sz * 2, sz * 1.4); c.restore();
  }
  return out;
}

// the blank sheet beyond what you know: parchment with a little grain and foxing
function paperTile() {
  const N = 256, cv = document.createElement("canvas"); cv.width = cv.height = N;
  const g = cv.getContext("2d"), img = g.createImageData(N, N), d = img.data;
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const blot = []; for (let q = 0; q < 7; q++) blot.push([rnd() * N, rnd() * N, 20 + rnd() * 50]);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    let v = (rnd() - 0.5) * 10;
    for (const [bx, by, br] of blot) { const dx = Math.min(Math.abs(i - bx), N - Math.abs(i - bx)), dy = Math.min(Math.abs(j - by), N - Math.abs(j - by)), dd = Math.hypot(dx, dy) / br; if (dd < 1) v -= (1 - dd) * (1 - dd) * 9; }
    const o = (j * N + i) * 4; d[o] = PAPER[0] + v; d[o + 1] = PAPER[1] + v * 0.95; d[o + 2] = PAPER[2] + v * 0.8; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); return cv;
}

// a glyph (js/ui/glyphs.js) as an image to stamp on the canvas
const glyphImg = new Map();
function glyph(key, color = "#fff") {
  const id = key + color; if (glyphImg.has(id)) return glyphImg.get(id);
  const im = new Image(); im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48">${(GLYPHS[key] || GLYPHS.spear).replace(/#fff/g, color)}</svg>`);
  glyphImg.set(id, im); return im;
}

// ---------------------------------------------------------------- the panel
export function makeWorldMap({ map, w, V, PLAYER = 0, settle = null, places = null, banners = [], teamName = (t) => `House ${t + 1}`, townName = null, holds = null,
  focus = () => {}, camera = null, landKnown = false, realm = false, mapName = "" }) {
  const style = document.createElement("style"); style.textContent = CSS; document.head.append(style);
  const button = document.createElement("button");
  button.id = "wmapbtn"; button.type = "button"; button.title = "World map (M)"; button.setAttribute("aria-label", "World map (M)"); button.setAttribute("aria-haspopup", "dialog");
  button.innerHTML = ICON;
  const el = document.createElement("div"); el.id = "worldmap"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "World map");
  el.innerHTML = `<div class="wmsheet"><div class="wmhead"><h2>${esc(mapName || map.meta?.name || "The World")}</h2><span class="wmsub"></span><span class="sp"></span>
      <button type="button" class="wmlegbtn">Legend</button><button type="button" class="wmhome" title="Back to your keep">Home</button><button type="button" class="wmx" title="Close (Esc or M)" aria-label="Close">✕</button></div>
    <div class="wmbody"><div class="wmcv"><canvas class="wmc"></canvas><div class="wmloading" hidden>The clerk is drawing the map…</div><div class="wmtip" hidden></div></div><aside class="wmlegend"></aside></div></div>`;
  document.body.append(button, el);
  const box = el.querySelector(".wmcv"), cv = el.querySelector("canvas.wmc"), ctx = cv.getContext("2d"), tip = el.querySelector(".wmtip"), sub = el.querySelector(".wmsub"), legend = el.querySelector(".wmlegend");
  const size = map.size, X0 = map.x0 || 0, Y0 = map.y0 || 0, CX = X0 + size / 2, CY = Y0 + size / 2; // (world coordinates: the sheet is [X0, X0 + size]²)

  // ------------------------------------------------ what we know
  const grid = () => V.teams[PLAYER];
  const cellAt = (x, y) => { const i = Math.floor((x - (V.ox || 0)) / V.cellM), j = Math.floor((y - (V.oy || 0)) / V.cellM); if (i < 0 || j < 0 || i >= V.n || j >= V.n) return 0; return landKnown ? Math.max(1, grid()[j * V.n + i]) : grid()[j * V.n + i]; };
  const seenNow = (x, y) => { const i = Math.floor((x - (V.ox || 0)) / V.cellM), j = Math.floor((y - (V.oy || 0)) / V.cellM); return i >= 0 && j >= 0 && i < V.n && j < V.n && grid()[j * V.n + i] === 2; };
  const known = (x, y) => cellAt(x, y) >= 1;
  const bSeen = (b) => { // in sight if any part of it is: its ends (a wall), or its middle and the corners of its footprint
    if (b.x1 !== undefined) return seenNow(b.x1, b.y1) || seenNow(b.x2, b.y2) || seenNow(b.x, b.y);
    if (seenNow(b.x, b.y)) return true;
    const fp = b.w && b.h ? [b.w, b.h] : BUILDINGS[b.kind]?.footprint; if (!fp) return false; const r = Math.min(40, Math.max(fp[0], fp[1]) / 2);
    return seenNow(b.x + r, b.y + r) || seenNow(b.x - r, b.y + r) || seenNow(b.x + r, b.y - r) || seenNow(b.x - r, b.y - r);
  };
  // other houses' buildings as last seen. Single-player: our own memory, updated only while they are in sight. The Realm:
  // the server already sends only what this house has seen (server/views.mjs memoryB) — the mirror's w.buildings IS it.
  const mem = new Map(); let memT = 0;
  const snap = (b) => ({ id: b.id, kind: b.kind, team: b.team, x: b.x, y: b.y, rot: b.rot || 0, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, w: b.w, h: b.h, progress: b.progress, ruin: !!b.ruin, stage: b.stage });
  function tick(now = performance.now(), force = false) {
    if (realm || (!force && now - memT < 1000)) return; if (!force) memT = now;
    const live = new Set();
    for (const b of w.buildings || []) { if (b.team === PLAYER) continue; live.add(b.id); if (bSeen(b)) mem.set(b.id, snap(b)); }
    for (const [id, b] of mem) if (!live.has(id) && bSeen(b)) mem.delete(id); // (gone, and we can see that it is)
  }
  // (a siege or a pitched battle: the land is known, and so is the castle on it — its walls are the thing everyone knows)
  const foreignBuildings = () => realm ? (w.buildings || []).filter((b) => b.team !== PLAYER)
    : landKnown ? [...mem.values(), ...(w.buildings || []).filter((b) => b.team !== PLAYER && b.castle !== undefined && !mem.has(b.id))] : [...mem.values()];

  // ------------------------------------------------ the sheet and the fog
  let base = null, paper = null, fogged = null, fogKey = -1, maskCv = null, remCv = null, edgeCv = null;
  function ensureBase() { if (!base) { const t0 = performance.now(); base = paintBase(map, settle); paper = ctx.createPattern(paperTile(), "repeat"); stats.baseMs = Math.round(performance.now() - t0); } }
  function gridKey() { const G = grid(); let h = landKnown ? 7 : 0; for (let k = 0; k < G.length; k += 1) h = (h * 31 + G[k]) | 0; return h; }
  function rebuildFog() {
    const key = gridKey(); if (key === fogKey && fogged) return; fogKey = key;
    const n = V.n, G = grid();
    maskCv ||= Object.assign(document.createElement("canvas"), { width: n, height: n }); remCv ||= Object.assign(document.createElement("canvas"), { width: n, height: n });
    const mi = maskCv.getContext("2d").createImageData(n, n), ri = remCv.getContext("2d").createImageData(n, n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const v = landKnown ? Math.max(1, G[j * n + i]) : G[j * n + i], o = ((n - 1 - j) * n + i) * 4; // (row 0 of the canvas is the north edge)
      if (v >= 1) { mi.data[o] = 60; mi.data[o + 1] = 40; mi.data[o + 2] = 20; mi.data[o + 3] = 255; }
      if (v === 1) { ri.data[o] = 222; ri.data[o + 1] = 204; ri.data[o + 2] = 160; ri.data[o + 3] = 150; } // (remembered: faded toward the paper, like old ink)
    }
    maskCv.getContext("2d").putImageData(mi, 0, 0); remCv.getContext("2d").putImageData(ri, 0, 0);
    const B = BASE_PX, cell = B / n;
    fogged ||= Object.assign(document.createElement("canvas"), { width: B, height: B });
    const f = fogged.getContext("2d"); f.save(); f.clearRect(0, 0, B, B); f.globalCompositeOperation = "source-over"; f.imageSmoothingEnabled = true;
    f.filter = `blur(${(cell * 0.45).toFixed(1)}px)`; f.drawImage(maskCv, 0, 0, B, B); f.filter = "none";
    f.globalCompositeOperation = "source-in"; f.drawImage(base, 0, 0);
    f.globalCompositeOperation = "source-atop"; f.filter = `blur(${(cell * 0.6).toFixed(1)}px)`; f.drawImage(remCv, 0, 0, B, B); f.filter = "none"; f.restore();
    // the frontier: a soft brown shadow on the paper round what we know (the edge of the known world)
    edgeCv ||= Object.assign(document.createElement("canvas"), { width: 512, height: 512 });
    const e = edgeCv.getContext("2d"); e.clearRect(0, 0, 512, 512); e.filter = "blur(5px)"; e.globalAlpha = 0.45; e.drawImage(maskCv, 0, 0, 512, 512); e.filter = "none"; e.globalAlpha = 1;
    let nk = 0, ns = 0; for (let k = 0; k < G.length; k++) { if (G[k] >= 1) nk++; if (G[k] === 2) ns++; }
    stats.known = landKnown ? 1 : nk / G.length; stats.seen = ns / G.length;
  }
  const stats = { known: 0, seen: 0, draws: 0, fogBuilds: 0 };

  // ------------------------------------------------ the view: px per metre and the world point at the centre
  const view = { s: 0.2, cx: CX, cy: CY, W: 0, H: 0, fit: 0.2 };
  const w2s = (x, y) => [view.W / 2 + (x - view.cx) * view.s, view.H / 2 - (y - view.cy) * view.s];
  const s2w = (px, py) => [view.cx + (px - view.W / 2) / view.s, view.cy - (py - view.H / 2) / view.s];
  function resize() {
    const r = box.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    view.W = Math.max(50, r.width); view.H = Math.max(50, r.height);
    cv.width = Math.round(view.W * dpr); cv.height = Math.round(view.H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fit = Math.min(view.W, view.H) * 0.94 / size; const was = view.fit; view.fit = fit;
    if (!was || view.s < fit) view.s = fit; else view.s *= fit / was;
    clampView();
  }
  function clampView() {
    view.s = clamp(view.s, view.fit, view.fit * 14);
    const hx = view.W / 2 / view.s, hy = view.H / 2 / view.s;
    view.cx = hx * 2 >= size ? CX : clamp(view.cx, X0 + hx - size * 0.03, X0 + size + size * 0.03 - hx);
    view.cy = hy * 2 >= size ? CY : clamp(view.cy, Y0 + hy - size * 0.03, Y0 + size + size * 0.03 - hy);
  }

  // ------------------------------------------------ markers
  const tcol = (t) => banners[t] ? bannerColor(banners[t]) : "#777"; const tacc = (t) => banners[t] ? bannerAccent(banners[t]) : "#eee";
  const lum = (hex) => { const v = parseInt(String(hex).slice(1), 16); return (0.299 * (v >> 16 & 255) + 0.587 * (v >> 8 & 255) + 0.114 * (v & 255)) / 255; };
  const rim = (t) => lum(tcol(t)) > 0.62 ? "#3b2a18" : "#f6edd6"; // (a light field — argent, or — is outlined in ink, a dark one in cream)
  const tink = (t) => { const a = tcol(t), b = tacc(t), d = lum(a) <= lum(b) ? a : b; return lum(d) > 0.55 ? INK : d; }; // (the house's darker tincture, for writing on parchment)
  const flagCache = new Map(); const flagOf = (t) => { if (!banners[t]) return null; if (!flagCache.has(t)) flagCache.set(t, drawBanner(banners[t], 40, 30)); return flagCache.get(t); };
  const houseLabel = (t) => t === PLAYER ? "Your" : (teamName(t) || "Another house") + "'s";
  const BNAME = (k) => BUILDINGS[k]?.name || k;
  let hits = []; // what's under the cursor: { x, y, r, html } in screen px
  let drawnLabels = [], foeDrawn = []; // (for headless checks: the names and the other houses' men on the last frame)

  function companies() {
    const own = [], crews = [], foe = [];
    for (const u of w.units?.values() || []) {
      const n = u.members?.length || u.n || 0; if (!n) continue;
      const x = u.ax, y = u.ay; if (!Number.isFinite(x)) continue;
      if (u.team === PLAYER) (u.isWorkers ? crews : own).push({ u, x, y, n });
      else if (seenNow(x, y)) { foe.push({ u, x, y, n }); foeDrawn.push([x, y]); } // other houses' men: only where we can see them NOW
    }
    return { own, crews, foe };
  }
  function cluster(list, rad) { // merge badges that would overlap on screen
    const out = [];
    for (const it of list) { const [sx, sy] = w2s(it.x, it.y); let c = out.find((q) => Math.hypot(q.sx - sx, q.sy - sy) < rad && q.team === it.u.team); if (!c) out.push(c = { sx, sy, team: it.u.team, n: 0, items: [] }); c.items.push(it); c.n += it.n; }
    for (const c of out) { let sx = 0, sy = 0, m = 0; for (const it of c.items) { const [a, b] = w2s(it.x, it.y); sx += a * it.n; sy += b * it.n; m += it.n; } c.sx = sx / m; c.sy = sy / m; }
    return out;
  }
  function badge(c, small) {
    const top = c.items.reduce((a, b) => b.n > a.n ? b : a), A = ARMS[top.u.arm] || ARMS.villager, sz = small ? 15 : 20;
    const x = c.sx, y = c.sy;
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
    ctx.fillStyle = tcol(c.team); ctx.strokeStyle = rim(c.team); ctx.lineWidth = 1.4;
    ctx.beginPath(); if (small) ctx.arc(x, y, sz / 2, 0, 7); else ctx.roundRect(x - sz / 2, y - sz / 2, sz, sz, 3); ctx.fill(); ctx.shadowColor = "transparent"; ctx.stroke();
    const gi = glyph(A.glyph || "spear", tacc(c.team) || "#fff"); if (gi.complete && gi.naturalWidth) ctx.drawImage(gi, x - sz * 0.38, y - sz * 0.38, sz * 0.76, sz * 0.76);
    const txt = String(c.n); ctx.font = `600 ${small ? 10 : 11}px ui-sans-serif, system-ui, sans-serif`; const tw = ctx.measureText(txt).width;
    const bx = x + sz / 2 - 3, by = y - sz / 2 - 5; ctx.fillStyle = "#f6edd6"; ctx.strokeStyle = "rgba(50,35,20,.8)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(bx, by, tw + 7, 13, 6); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#2a1d10"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(txt, bx + 3.5, by + 7);
    ctx.restore();
    const names = c.items.map((it) => `${(ARMS[it.u.arm] || {}).name || "Company"} ×${it.n}`);
    hits.push({ x, y, r: sz * 0.7, pri: 3, html: `<b>${c.team === PLAYER ? (small ? "Your villagers" : "Your companies") : `${esc(teamName(c.team) || "Enemy")}'s men`}</b> — ${c.n} men<br>${esc(names.slice(0, 6).join(", "))}${names.length > 6 ? "…" : ""}${c.team !== PLAYER ? "<br><i>in sight now</i>" : ""}` });
  }

  function drawBuildings() {
    const k = view.s;
    const draw = (b, dim, own) => {
      const [x, y] = w2s(b.x, b.y), col = tcol(b.team);
      if (b.ruin) return;
      ctx.globalAlpha = dim ? 0.55 : 1;
      if (b.kind === "field") { // a field a house has made: its strips run along its long side; being cleared, only its stakes (dashed)
        if (!b.w || !b.h) return;
        const fw = b.w * k / 2, fh = b.h * k / 2, clearing = b.field?.state === "clearing";
        ctx.save(); ctx.translate(x, y); ctx.rotate(-(b.rot || 0));
        if (!clearing) { ctx.fillStyle = "rgba(204,178,92,.55)"; ctx.fillRect(-fw, -fh, fw * 2, fh * 2); ctx.strokeStyle = "rgba(150,124,64,.45)"; ctx.lineWidth = 0.6; ctx.beginPath(); const n = Math.max(2, Math.floor(fw * 2 / 3.4)); for (let q = 1; q < n; q++) { const v = -fw + q * fw * 2 / n; ctx.moveTo(v, -fh); ctx.lineTo(v, fh); } ctx.stroke(); }
        ctx.strokeStyle = col; ctx.lineWidth = 1; if (clearing) ctx.setLineDash([3, 2]); ctx.strokeRect(-fw, -fh, fw * 2, fh * 2); ctx.setLineDash([]); ctx.restore();
      } else if (b.x1 !== undefined) {
        const [ax, ay] = w2s(b.x1, b.y1), [bx2, by2] = w2s(b.x2, b.y2);
        ctx.strokeStyle = b.kind === "stone_wall" ? "#4b4035" : "#6a4a28"; ctx.lineWidth = Math.max(2, (b.kind === "stone_wall" ? 3.5 : 2) * k); ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx2, by2); ctx.stroke();
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(0.8, ctx.lineWidth * 0.35); ctx.stroke();
      } else if (b.kind === "tower" && b.r) {
        ctx.fillStyle = "#8a7d68"; ctx.strokeStyle = "#2a1d10"; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(x, y, Math.max(2.4, b.r * k), 0, 7); ctx.fill(); ctx.stroke();
      } else if (b.kind === "town_hall") {
        keep(x, y, b.team, dim);
      } else {
        const fp = BUILDINGS[b.kind]?.footprint || [8, 8], sw = Math.max(3.2, fp[0] * k), sh = Math.max(3.2, fp[1] * k);
        ctx.save(); ctx.translate(x, y); ctx.rotate(-(b.rot || 0)); ctx.fillStyle = b.progress < 1 ? "rgba(240,230,205,.9)" : col; ctx.strokeStyle = "#2a1d10"; ctx.lineWidth = 0.8;
        ctx.fillRect(-sw / 2, -sh / 2, sw, sh); ctx.strokeRect(-sw / 2, -sh / 2, sw, sh); ctx.restore();
        if (b.kind === "watchtower" || b.kind === "tower" || b.kind === "mage_tower") { ctx.fillStyle = "#2a1d10"; ctx.beginPath(); ctx.arc(x, y, 2, 0, 7); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      hits.push({ x, y, r: b.kind === "town_hall" ? 13 : 6, pri: b.kind === "town_hall" ? 2 : 1, html: `<b>${own ? "Your" : esc(houseLabel(b.team))} ${esc(BNAME(b.kind))}</b>${b.progress < 1 ? " (building)" : ""}${dim ? "<br><i>as last seen — not in sight now</i>" : ""}` });
    };
    const order = (a, b) => (a.kind === "field" ? 0 : a.x1 !== undefined ? 1 : a.kind === "town_hall" ? 3 : 2) - (b.kind === "field" ? 0 : b.x1 !== undefined ? 1 : b.kind === "town_hall" ? 3 : 2);
    const mine = (w.buildings || []).filter((b) => b.team === PLAYER).sort(order);
    const theirs = foreignBuildings().sort(order);
    for (const b of theirs) draw(b, !bSeen(b), false);
    for (const b of mine) draw(b, false, true);
  }
  function keep(x, y, team, dim) { // a little keep with its house's flag
    ctx.save(); ctx.globalAlpha = dim ? 0.6 : 1; ctx.shadowColor = "rgba(0,0,0,.4)"; ctx.shadowBlur = 3;
    ctx.fillStyle = "#e9dcb8"; ctx.strokeStyle = INK; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(x - 7, y + 6); ctx.lineTo(x - 7, y - 4); ctx.lineTo(x - 5, y - 4); ctx.lineTo(x - 5, y - 2); ctx.lineTo(x - 2.5, y - 2); ctx.lineTo(x - 2.5, y - 4); ctx.lineTo(x + 2.5, y - 4); ctx.lineTo(x + 2.5, y - 2); ctx.lineTo(x + 5, y - 2); ctx.lineTo(x + 5, y - 4); ctx.lineTo(x + 7, y - 4); ctx.lineTo(x + 7, y + 6); ctx.closePath();
    ctx.fill(); ctx.shadowColor = "transparent"; ctx.stroke(); ctx.fillStyle = INK; ctx.fillRect(x - 1.3, y + 1.5, 2.6, 4.5);
    ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y - 15); ctx.stroke();
    const fl = flagOf(team); if (fl) { ctx.drawImage(fl, x, y - 15, 11, 8); ctx.strokeRect(x, y - 15, 11, 8); } else { ctx.fillStyle = tcol(team); ctx.fillRect(x, y - 15, 11, 8); }
    ctx.restore();
  }

  // ------------------------------------------------ names on the land
  const labelsAll = (() => {
    const L = [], seenName = new Set();
    const add = (o) => { const key = o.name + "|" + Math.round(o.x / 200) + "|" + Math.round(o.y / 200); if (!o.name || seenName.has(key)) return; seenName.add(key); L.push(o); };
    for (const f of map.meta?.features || []) {
      if (!f.xy_m || f.type === "farmland" || f.type === "reverse_slope" || f.type === "town_site") continue;
      add({ name: cleanName(f.name), x: f.xy_m[0], y: f.xy_m[1], kind: WATERY[f.type] ? "water" : f.type === "open_plain" ? "plain" : NATURAL[f.type] !== undefined ? "land" : "land", type: f.type, pri: f.type === "river" || f.type === "lake" ? 5 : f.type === "hill" || f.type === "rocky_upland" || f.type === "ridge" ? 4 : 3 });
    }
    for (const h of settle?.hamlets || []) if (h.center) add({ name: h.name, x: h.center[0], y: h.center[1], kind: "hamlet", pri: 4 });
    for (const s of settle?.sites || []) if (Number.isFinite(s.x)) add({ name: cleanName(s.name), x: s.x, y: s.y, kind: "site", site: s.kind, pri: 6, ruin: /ruin/i.test(s.name) });
    for (const H of holds || []) if (Number.isFinite(H.x)) add({ name: H.name, x: H.x, y: H.y, kind: "hold", pri: 4 });
    return L;
  })();
  function placeLabel(text, x, y, font, color, halo, boxes, dy = 0, later = null) {
    ctx.font = font; const tw = ctx.measureText(text).width, th = parseFloat(font.match(/(\d+(?:\.\d+)?)px/)?.[1] || 12);
    const r = { x0: x - tw / 2 - 2, y0: y + dy - th / 2 - 1, x1: x + tw / 2 + 2, y1: y + dy + th / 2 + 1 };
    if (r.x0 < 2 || r.x1 > view.W - 2 || r.y0 < 2 || r.y1 > view.H - 2) return false;
    for (const b of boxes) if (r.x0 < b.x1 && r.x1 > b.x0 && r.y0 < b.y1 && r.y1 > b.y0) return false;
    boxes.push(r); drawnLabels.push(text);
    const ink = () => { ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
      if (halo) { ctx.strokeStyle = halo; ctx.lineWidth = 3.2; ctx.strokeText(text, x, y + dy); }
      ctx.fillStyle = color; ctx.fillText(text, x, y + dy); };
    if (later) later.push(ink); else ink(); return true;
  }
  function drawLabels(boxes, townLabels, later) { // (the towns' names are inked last, over the men gathered at the keep)
    const SERIF = `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`, z = view.s / view.fit, tb = []; // (a town is always named: its name gives way only to another town's)
    for (const T of townLabels) {
      placeLabel(T.name.toUpperCase(), T.x, T.y, `700 ${z > 2 ? 15 : 13}px ${SERIF}`, T.team === PLAYER ? "#1f1408" : "#2a1408", "rgba(244,234,208,.92)", tb, 22, later);
      if (T.house) placeLabel(T.house, T.x, T.y, `italic 600 11px ${SERIF}`, tink(T.team), "rgba(244,234,208,.9)", tb, 37, later);
    }
    boxes.push(...tb);
    const sorted = [...labelsAll].sort((a, b) => b.pri - a.pri);
    for (const L of sorted) {
      if (!known(L.x, L.y)) continue; // (a name is learnt by going there)
      if (townLabels.some((T) => Math.hypot(T.x - L.x, T.y - L.y) < 260)) continue;
      const [x, y] = w2s(L.x, L.y);
      if (L.kind === "water") placeLabel(L.name, x, y, `italic ${L.type === "river" || L.type === "lake" ? 14 : 12}px ${SERIF}`, WATER_INK, "rgba(225,235,230,.7)", boxes);
      else if (L.kind === "hamlet" || L.kind === "hold") placeLabel(L.name, x, y, `600 12px ${SERIF}`, "#3a2412", "rgba(244,234,208,.8)", boxes, 12);
      else if (L.kind === "plain") placeLabel(L.name.toUpperCase().split("").join(" "), x, y, `11px ${SERIF}`, "#6b5230", null, boxes);
      else if (L.kind === "site") {
        if (z < 1.6 && L.site === "gallows") continue;
        ctx.fillStyle = INK; ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
        if (L.site === "chapel") { ctx.fillRect(x - 0.8, y - 5, 1.6, 9); ctx.fillRect(x - 3, y - 2.5, 6, 1.6); }
        else if (L.site === "ruin_keep") { ctx.strokeRect(x - 3.5, y - 3.5, 7, 7); ctx.beginPath(); ctx.moveTo(x - 3.5, y + 3.5); ctx.lineTo(x + 3.5, y - 3.5); ctx.stroke(); }
        else if (L.site === "watermill") { ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 3.5, y); ctx.lineTo(x + 3.5, y); ctx.moveTo(x, y - 3.5); ctx.lineTo(x, y + 3.5); ctx.stroke(); }
        else { ctx.beginPath(); ctx.moveTo(x - 3, y + 4); ctx.lineTo(x - 3, y - 4); ctx.lineTo(x + 3, y - 4); ctx.stroke(); }
        boxes.push({ x0: x - 5, y0: y - 6, x1: x + 5, y1: y + 5 });
        placeLabel(L.name, x, y, `italic 11px ${SERIF}`, "#4a3218", "rgba(244,234,208,.75)", boxes, 12);
        hits.push({ x, y, r: 7, pri: 1, html: `<b>${esc(L.name)}</b>` });
      } else placeLabel(L.name, x, y, `italic ${L.pri >= 4 ? 13 : 12}px ${SERIF}`, SEPIA, "rgba(244,234,208,.7)", boxes);
    }
  }

  // ------------------------------------------------ the frame
  let raf = 0; const redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  function draw() {
    if (el.hidden || !base) return;
    stats.draws++; hits = []; drawnLabels = []; foeDrawn = [];
    const W = view.W, H = view.H, k = view.s;
    ctx.save(); ctx.fillStyle = paper; ctx.fillRect(0, 0, W, H);
    const [ox, oy] = w2s(X0, Y0 + size), S = size * k;
    // beyond the map's edge: darker board
    ctx.fillStyle = "rgba(60,44,26,.55)"; ctx.fillRect(0, 0, W, Math.max(0, oy)); ctx.fillRect(0, oy + S, W, Math.max(0, H - oy - S)); ctx.fillRect(0, oy, Math.max(0, ox), S); ctx.fillRect(ox + S, oy, Math.max(0, W - ox - S), S);
    // a faint kilometre grid on the sheet, the edge of the known world, then what we know
    ctx.strokeStyle = "rgba(110,80,40,.12)"; ctx.lineWidth = 1; ctx.beginPath();
    for (let m = 1000; m < size; m += 1000) { const [gx] = w2s(X0 + m, 0), [, gy] = w2s(0, Y0 + m); ctx.moveTo(gx, oy); ctx.lineTo(gx, oy + S); ctx.moveTo(ox, gy); ctx.lineTo(ox + S, gy); } ctx.stroke();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    if (edgeCv) ctx.drawImage(edgeCv, ox - S * 0.006, oy - S * 0.004, S * 1.012, S * 1.012);
    if (fogged) ctx.drawImage(fogged, ox, oy, S, S);
    ctx.strokeStyle = "#5a4024"; ctx.lineWidth = 1.5; ctx.strokeRect(ox, oy, S, S); ctx.lineWidth = 0.6; ctx.strokeRect(ox - 4, oy - 4, S + 8, S + 8);
    // buildings, then the towns' names
    drawBuildings();
    // where the main camera looks (under the names and the men)
    if (camera?.st) {
      const [x, y] = w2s(camera.st.tx, camera.st.ty), hw = Math.max(10, camera.st.dist * 0.75 * k), hh = Math.max(7, camera.st.dist * 0.45 * k), a = camera.st.yaw || 0;
      ctx.save(); ctx.translate(x, y); ctx.rotate(-a); ctx.strokeStyle = "rgba(255,248,225,.95)"; ctx.lineWidth = 3; ctx.strokeRect(-hw, -hh, hw * 2, hh * 2); ctx.strokeStyle = "#7a1e12"; ctx.lineWidth = 1.4; ctx.setLineDash([5, 3]); ctx.strokeRect(-hw, -hh, hw * 2, hh * 2); ctx.restore();
    }
    const boxes = [], townLabels = [];
    // the companies first placed (not yet drawn), so the names on the land keep clear of them
    const { own, crews, foe } = companies(), cs = [...cluster(crews, 18).map((c) => [c, true]), ...cluster(foe, 24).map((c) => [c, false]), ...cluster(own, 24).map((c) => [c, false])];
    for (const [c, small] of cs) { const r = small ? 9 : 12; boxes.push({ x0: c.sx - r, y0: c.sy - r - 7, x1: c.sx + r + 16, y1: c.sy + r }); }
    const DG = w.dragons; // (and the dragons' lairs: every lord knows them — server/views.mjs sends them to all)
    const lairs = DG ? (DG.lairs?.length ? DG.lairs : (DG.list || []).map((D) => ({ id: D.id, name: D.name, x: D.home.x, y: D.home.y }))) : [];
    for (const L of lairs) { const [x, y] = w2s(L.x, L.y); boxes.push({ x0: x - 9, y0: y - 8, x1: x + 9, y1: y + 6 }); }
    const halls = [...(w.buildings || []).filter((b) => b.team === PLAYER && b.kind === "town_hall"), ...foreignBuildings().filter((b) => b.kind === "town_hall" && !b.ruin)];
    if (landKnown && !realm) for (const C of w.castles || []) { const [x, y] = w2s(C.x, C.y); keep(x, y, C.team, false); townLabels.push({ x, y, team: C.team, name: C.name || "The castle", house: null }); hits.push({ x, y, r: 13, pri: 2, html: `<b>${esc(C.name || "The castle")}</b>${C.team === PLAYER ? " — yours" : ""}` }); }
    for (const b of halls) { const [x, y] = w2s(b.x, b.y); townLabels.push({ x, y, wx: b.x, wy: b.y, team: b.team, name: (townName ? townName(b.team, b) : null) || "Keep", house: realm ? teamName(b.team) : null }); }
    const later = []; drawLabels(boxes, townLabels, later);
    // the lairs, the dragons themselves where seen
    for (const L of lairs) {
      const [x, y] = w2s(L.x, L.y);
      ctx.save(); ctx.fillStyle = "#5a1c14"; ctx.strokeStyle = "#f2e6c8"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x - 8, y + 5); ctx.lineTo(x - 3, y - 5); ctx.lineTo(x, y - 1); ctx.lineTo(x + 3, y - 7); ctx.lineTo(x + 8, y + 5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#e0b040"; ctx.beginPath(); ctx.arc(x + 0.5, y + 2, 1.6, 0, 7); ctx.fill(); ctx.restore();
      placeLabel("Dragon's Lair", x, y, `italic 600 11px "Iowan Old Style", Palatino, Georgia, serif`, "#7a1e12", "rgba(244,234,208,.85)", boxes, 13);
      hits.push({ x, y, r: 10, pri: 2, html: `<b>Lair of ${esc(L.name || "a dragon")}</b><br><i>every lord in the land knows where it lies</i>` });
    }
    // the silver and gold veins (js/sim/veins.js): every lord knows where they lie and whose flag flies over each
    // (a find another house made — js/sim/prospect.js — is not known until it has been worked; a worked-out vein is drawn grey, flagless)
    for (const v of (realm ? w.veins : (w.resources || []).filter((n) => (n.kind === "silver_vein" || n.kind === "gold_vein") && (n.source !== "prospect" || n.finder === PLAYER || n.holder === PLAYER || n.amount < n.start - 1))) || []) {
      const [x, y] = w2s(v.x, v.y), gold = v.kind === "gold_vein", spent = v.band ? v.band === "spent" : !(v.amount > 1), h = Number.isInteger(v.holder) && !spent ? v.holder : null;
      ctx.save(); ctx.fillStyle = spent ? "#6f6a62" : gold ? "#c9a23a" : "#aeb4bb"; ctx.strokeStyle = "#3b2a18"; ctx.lineWidth = 1.1; // (a pick-mark: the mine)
      ctx.beginPath(); ctx.moveTo(x - 5, y + 4); ctx.lineTo(x, y - 3); ctx.lineTo(x + 5, y + 4); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 1, y - 1); ctx.lineTo(x + 1, y - 13); ctx.stroke(); // (its flagpole)
      const fl = h !== null ? flagOf(h) : null;
      if (fl) ctx.drawImage(fl, x + 1.5, y - 13, 10, 7.5); else if (spent) { ctx.beginPath(); ctx.moveTo(x - 4, y - 1); ctx.lineTo(x + 4, y + 5); ctx.moveTo(x + 4, y - 1); ctx.lineTo(x - 4, y + 5); ctx.stroke(); } else if (h === null) { ctx.strokeStyle = "#8a7050"; ctx.setLineDash([2, 2]); ctx.strokeRect(x + 1.5, y - 13, 9, 6.5); ctx.setLineDash([]); }
      if (v.cap) { ctx.fillStyle = "#7a1e12"; ctx.beginPath(); ctx.arc(x + 13, y - 11, 2.4, 0, 7); ctx.fill(); }
      ctx.restore();
      boxes.push({ x0: x - 6, y0: y - 14, x1: x + 13, y1: y + 5 });
      const who = spent ? "worked out — nothing left in it; prospect the hills for a new one" : v.source === "prospect" && h === null ? `a new find${v.finder === PLAYER ? " of your prospectors'" : ""} — held by no house yet: men standing at it hoist a flag` : h === null ? "held by no house — stake a mining camp there to claim it" : h === PLAYER ? "your house's vein" : `held by ${esc(teamName(h) || v.hn || "another house")}`;
      hits.push({ x, y: y - 4, r: 10, pri: 3, html: `<b>${gold ? "Gold" : "Silver"} vein</b>${v.name ? ` · ${esc(v.name)}` : ""}<br>${who}${v.band ? ` · ${v.band === "spent" ? "worked out" : v.band}` : ""}${v.cap ? `<br><i>${v.cap.by === PLAYER ? "your" : esc(teamName(v.cap.by) || "a") + "'s"} flag is going up</i>` : ""}${h !== null && h !== PLAYER ? "<br><i>take it: kill the men who work it, stand your soldiers at it until your flag is up</i>" : ""}` });
    }
    for (const D of DG?.list || []) {
      if (D.mode === "dead" || !Number.isFinite(D.x)) continue;
      if (!(D.owner === PLAYER || seenNow(D.x, D.y))) continue;
      const [x, y] = w2s(D.x, D.y), hue = [20, 0, 270, 140][D.hue % 4] ?? 0;
      ctx.save(); ctx.fillStyle = `hsl(${hue} 60% 32%)`; ctx.strokeStyle = "#f2e6c8"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x, y - 2); ctx.quadraticCurveTo(x - 6, y - 9, x - 12, y - 4); ctx.lineTo(x - 7, y - 2); ctx.lineTo(x - 9, y + 1); ctx.lineTo(x, y + 4); ctx.lineTo(x + 9, y + 1); ctx.lineTo(x + 7, y - 2); ctx.lineTo(x + 12, y - 4); ctx.quadraticCurveTo(x + 6, y - 9, x, y - 2); ctx.fill(); ctx.stroke(); ctx.restore();
      hits.push({ x, y, r: 12, pri: 4, html: `<b>${esc(D.name)}</b>${D.owner === PLAYER ? " — your dragon" : ""}<br><i>${seenNow(D.x, D.y) ? "in sight now" : "where your dragon is"}</i>` });
    }
    // game in sight now
    for (const Hd of w.wild?.herds || []) {
      if (!(Hd.n > 0) || !Number.isFinite(Hd.cx) || !seenNow(Hd.cx, Hd.cy)) continue;
      const [x, y] = w2s(Hd.cx, Hd.cy), sp = SPECIES[Hd.sp], fowl = Hd.sp === "duck" || Hd.sp === "goose", foe = Hd.sp === "wolf" || Hd.sp === "bear";
      ctx.fillStyle = foe ? "#5a2a1a" : fowl ? "#2f4f5a" : "#6b4a24";
      for (const [dx, dy] of [[-3, 1], [0, -2], [3, 1]]) { ctx.beginPath(); ctx.arc(x + dx, y + dy, 1.8, 0, 7); ctx.fill(); }
      hits.push({ x, y, r: 7, pri: 2, html: `<b>${esc(sp ? sp.name[0].toUpperCase() + sp.name.slice(1) : "Game")}</b> — ${Hd.n} head<br><i>in sight now</i>` });
    }
    // companies: other houses' only where seen now; ours always
    for (const [c, small] of cs) badge(c, small);
    for (const f of later) f();
    // the compass rose, the scale bar
    compass(W - 46, 62, 28);
    scaleBar(16, H - 22);
    ctx.restore();
    sub.textContent = landKnown ? "The whole field is known to you" : `${Math.round(stats.known * 100)}% of the land explored · ${Math.max(stats.seen > 0 ? 1 : 0, Math.round(stats.seen * 100))}% in sight now`;
  }
  function compass(x, y, r) {
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = "rgba(244,234,208,.75)"; ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, 7); ctx.fill();
    ctx.strokeStyle = SEPIA; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, 7); ctx.stroke();
    for (let q = 0; q < 8; q++) {
      const a = q * Math.PI / 4, L = q % 2 ? r * 0.55 : r; ctx.save(); ctx.rotate(a);
      ctx.fillStyle = q === 0 ? "#7a1e12" : q % 2 ? "#8a7050" : "#3b2a18"; ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(r * 0.13, 0); ctx.lineTo(-r * 0.13, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#f2e6c8"; ctx.beginPath(); ctx.moveTo(0, -L); ctx.lineTo(r * 0.13, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.globalAlpha = 0.45; ctx.fill(); ctx.globalAlpha = 1; ctx.restore();
    }
    ctx.font = `700 11px "Iowan Old Style", Palatino, Georgia, serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#7a1e12"; ctx.fillText("N", 0, -r - 13);
    ctx.restore();
  }
  function scaleBar(x, y) {
    const want = 140 / view.s; const steps = [50, 100, 200, 250, 500, 1000, 2000]; const m = steps.reduce((a, b) => Math.abs(b - want) < Math.abs(a - want) ? b : a);
    const L = m * view.s;
    ctx.save(); ctx.fillStyle = "rgba(244,234,208,.8)"; ctx.fillRect(x - 6, y - 18, L + 64, 28);
    for (let q = 0; q < 4; q++) { ctx.fillStyle = q % 2 ? "#f2e6c8" : "#3b2a18"; ctx.fillRect(x + q * L / 4, y - 3, L / 4, 5); }
    ctx.strokeStyle = "#3b2a18"; ctx.lineWidth = 1; ctx.strokeRect(x, y - 3, L, 5);
    ctx.font = `11px "Iowan Old Style", Palatino, Georgia, serif`; ctx.fillStyle = "#3b2a18"; ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left"; ctx.fillText("0", x - 2, y - 6); ctx.textAlign = "center"; ctx.fillText(m >= 1000 ? `${m / 1000} km` : `${m} m`, x + L, y - 6);
    ctx.textAlign = "left"; ctx.fillText("metres", x + L + 10, y + 3);
    ctx.restore();
  }

  // ------------------------------------------------ the legend
  function swatch(fn, w0 = 26, h0 = 16) { const c = document.createElement("canvas"); const dpr = 2; c.width = w0 * dpr; c.height = h0 * dpr; c.style.width = w0 + "px"; c.style.height = h0 + "px"; const g = c.getContext("2d"); g.scale(dpr, dpr); fn(g, w0, h0); return c; }
  function buildLegend() {
    legend.innerHTML = "";
    const sec = (t) => { const h = document.createElement("h3"); h.textContent = t; legend.append(h); };
    const item = (fn, text) => { const d = document.createElement("div"); d.className = "li"; d.append(swatch(fn)); const s = document.createElement("span"); s.textContent = text; d.append(s); legend.append(d); };
    const P = `rgb(${PAPER})`;
    sec("What you know");
    item((g, W, H) => { g.fillStyle = "#cfd2a0"; g.fillRect(0, 0, W, H); }, "In sight now");
    item((g, W, H) => { g.fillStyle = "#cfd2a0"; g.fillRect(0, 0, W, H); g.fillStyle = "rgba(222,204,160,.59)"; g.fillRect(0, 0, W, H); }, "Explored, remembered (faded)");
    item((g, W, H) => { g.fillStyle = P; g.fillRect(0, 0, W, H); g.strokeStyle = "rgba(90,64,36,.4)"; g.strokeRect(0.5, 0.5, W - 1, H - 1); }, "Never seen");
    sec("The land");
    item((g, W, H) => { g.fillStyle = "#96b8be"; g.fillRect(0, 0, W, H); g.fillStyle = "#466470"; g.fillRect(0, H - 3, W, 2); }, "Water");
    item((g, W, H) => { g.fillStyle = "#b8bf8a"; g.fillRect(0, 0, W, H); for (const [x, y] of [[6, 6], [14, 9], [21, 5]]) { g.fillStyle = "#6f7d45"; g.strokeStyle = "#3d4a22"; g.beginPath(); g.arc(x, y, 3.4, 0, 7); g.fill(); g.stroke(); } }, "Woods");
    item((g, W, H) => { g.fillStyle = "#c8cfb0"; g.fillRect(0, 0, W, H); g.strokeStyle = "#3c5a50"; for (const x of [7, 18]) { g.beginPath(); g.moveTo(x - 3, 11); g.lineTo(x + 3, 11); g.moveTo(x, 11); g.lineTo(x, 7); g.stroke(); } }, "Marsh");
    item((g, W, H) => { g.strokeStyle = "#7a4e2a"; g.lineWidth = 2.4; g.beginPath(); g.moveTo(1, H / 2); g.lineTo(W - 1, H / 2); g.stroke(); }, "Highway");
    item((g, W, H) => { g.strokeStyle = "#86603a"; g.lineWidth = 1.5; g.setLineDash([5, 3]); g.beginPath(); g.moveTo(1, H / 2); g.lineTo(W - 1, H / 2); g.stroke(); }, "Track or path");
    item((g, W, H) => { g.strokeStyle = "rgba(110,76,40,.7)"; for (const y of [4, 8, 12]) { g.beginPath(); g.moveTo(1, y + Math.sin(y) * 2); g.bezierCurveTo(8, y - 3, 16, y + 3, W - 1, y); g.stroke(); } }, "Contours, 10 m");
    item((g, W, H) => { g.fillStyle = "#8a3f2a"; g.fillRect(6, 6, 5, 4); g.fillRect(14, 8, 5, 4); }, "Hamlet");
    sec("Houses");
    item((g, W, H) => { g.save(); g.translate(13, 9); g.fillStyle = "#e9dcb8"; g.strokeStyle = INK; g.fillRect(-6, -3, 12, 9); g.strokeRect(-6, -3, 12, 9); g.fillStyle = tcol(PLAYER); g.fillRect(0, -9, 8, 5); g.restore(); }, "A keep, with its arms");
    item((g, W, H) => { g.fillStyle = tcol(PLAYER); g.fillRect(9, 4, 8, 8); g.strokeStyle = "#2a1d10"; g.strokeRect(9, 4, 8, 8); }, "Your buildings");
    item((g, W, H) => { g.fillStyle = "rgba(204,178,92,.75)"; g.fillRect(3, 3, W - 6, H - 6); g.strokeStyle = "rgba(150,124,64,.8)"; for (let y = 6; y < H - 3; y += 3) { g.beginPath(); g.moveTo(3, y); g.lineTo(W - 3, y); g.stroke(); } g.strokeStyle = tcol(PLAYER); g.strokeRect(3, 3, W - 6, H - 6); }, "Fields your men have made (dashed: being cleared)");
    item((g, W, H) => { g.globalAlpha = 0.55; g.fillStyle = tcol(1) || "#a8322f"; g.fillRect(9, 4, 8, 8); g.strokeStyle = "#2a1d10"; g.strokeRect(9, 4, 8, 8); }, "Theirs, as last seen");
    item((g, W, H) => { g.fillStyle = tcol(PLAYER); g.strokeStyle = rim(PLAYER); g.beginPath(); g.roundRect(6, 1, 14, 14, 2); g.fill(); g.stroke(); }, "A company (men in it)");
    item((g, W, H) => { g.fillStyle = tcol(PLAYER); g.strokeStyle = rim(PLAYER); g.beginPath(); g.arc(13, 8, 6, 0, 7); g.fill(); g.stroke(); }, "Villagers at work");
    item((g, W, H) => { g.fillStyle = tcol(1) || "#a8322f"; g.strokeStyle = "#f6edd6"; g.beginPath(); g.roundRect(6, 1, 14, 14, 2); g.fill(); g.stroke(); }, "Others' men — in sight only");
    sec("Wonders and the wild");
    item((g) => { g.fillStyle = "#5a1c14"; g.beginPath(); g.moveTo(5, 14); g.lineTo(10, 4); g.lineTo(13, 8); g.lineTo(16, 2); g.lineTo(21, 14); g.closePath(); g.fill(); }, "Dragon's lair");
    item((g) => { g.fillStyle = "#aeb4bb"; g.strokeStyle = "#3b2a18"; g.beginPath(); g.moveTo(5, 14); g.lineTo(10, 7); g.lineTo(15, 14); g.closePath(); g.fill(); g.stroke(); g.beginPath(); g.moveTo(11, 9); g.lineTo(11, 1); g.stroke(); g.fillStyle = "#9b2a1e"; g.fillRect(11.5, 1, 8, 5); }, "Silver / gold vein, its holder's flag");
    item((g) => { g.fillStyle = "#6b4a24"; for (const [x, y] of [[9, 9], [13, 6], [17, 9]]) { g.beginPath(); g.arc(x, y, 1.8, 0, 7); g.fill(); } }, "Game in sight");
    item((g) => { g.strokeStyle = "#7a1e12"; g.setLineDash([4, 2]); g.strokeRect(3, 3, 20, 10); }, "Where you are looking");
    const p = document.createElement("p"); p.innerHTML = "Click to go there · drag to pan · wheel or pinch to zoom · <b>M</b> or <b>Esc</b> to close.";
    legend.append(p);
  }

  // ------------------------------------------------ interaction
  let down = null; const ptrs = new Map(); let pinch = null;
  box.addEventListener("pointerdown", (e) => {
    box.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: view.s }; down = null; return; }
    down = { x: e.offsetX, y: e.offsetY, cx: view.cx, cy: view.cy, moved: false, btn: e.button };
  });
  box.addEventListener("pointermove", (e) => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, pinch.s * d / Math.max(10, pinch.d) / view.s); return; }
    if (down) {
      const dx = e.offsetX - down.x, dy = e.offsetY - down.y;
      if (!down.moved && Math.hypot(dx, dy) > 5) { down.moved = true; box.classList.add("drag"); tip.hidden = true; }
      if (down.moved) { view.cx = down.cx - dx / view.s; view.cy = down.cy + dy / view.s; clampView(); redraw(); return; }
    }
    hover(e.offsetX, e.offsetY);
  });
  const up = (e) => {
    ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
    const d = down; down = null; box.classList.remove("drag");
    if (!d || d.moved || e.type === "pointercancel" || d.btn !== 0) return;
    const [x, y] = s2w(e.offsetX, e.offsetY);
    if (x < X0 || y < Y0 || x > X0 + size || y > Y0 + size) return;
    jump(x, y);
  };
  box.addEventListener("pointerup", up); box.addEventListener("pointercancel", up);
  box.addEventListener("pointerleave", () => { tip.hidden = true; });
  box.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  function zoomAt(px, py, f) {
    const [wx, wy] = s2w(px, py); view.s = clamp(view.s * f, view.fit, view.fit * 14);
    view.cx = wx - (px - view.W / 2) / view.s; view.cy = wy + (py - view.H / 2) / view.s; clampView(); redraw();
  }
  function jump(x, y) { focus(x, y); api.lastJump = { x, y }; close(); }
  function hover(px, py) {
    const [x, y] = s2w(px, py);
    if (x < X0 || y < Y0 || x > X0 + size || y > Y0 + size) { tip.hidden = true; return; }
    const c = cellAt(x, y); let html;
    const near = hits.filter((h) => Math.hypot(h.x - px, h.y - py) < h.r + 3).sort((a, b) => b.pri - a.pri || Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py))[0];
    if (c === 0) html = near ? near.html : `<b>Unexplored</b><br><i>no one of your house has been here</i>`;
    else {
      const pl = places?.at(x, y);
      const where = pl ? (pl.near ? pl.phrase[0].toUpperCase() + pl.phrase.slice(1) : pl.name) : `${Math.round(x)}, ${Math.round(y)}`;
      const h = map.h(x, y), wv = map.water ? map.water(x, y) : 0;
      html = (near ? near.html + "<br>" : "") + `${near ? "" : "<b>"}${esc(where)}${near ? "" : "</b>"}<br><i>${wv > 0.05 ? "water" : `${Math.round(h)} m above the sea`} · ${landKnown ? "known ground" : c === 2 ? "in sight now" : "explored — not in sight now"}</i><br><i>click to go there</i>`;
    }
    tip.innerHTML = html; tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(view.W - tw - 6, px + 14) + "px"; tip.style.top = Math.max(6, Math.min(view.H - th - 6, py + 14)) + "px";
  }

  // ------------------------------------------------ open / close
  let timer = 0, legendBuilt = false;
  function open() {
    if (!el.hidden) return;
    el.hidden = false; button.classList.add("on");
    if (!legendBuilt) { buildLegend(); legendBuilt = true; }
    resize();
    const fresh = !base;
    if (fresh) { el.querySelector(".wmloading").hidden = false; }
    const go = () => {
      ensureBase(); el.querySelector(".wmloading").hidden = true; tick(performance.now(), true); rebuildFog(); stats.fogBuilds++;
      if (fresh) centreOn();
      draw();
      clearInterval(timer); timer = setInterval(() => { if (el.hidden) return; tick(); const t0 = performance.now(), k0 = fogKey; rebuildFog(); if (fogKey !== k0) stats.fogBuilds++; draw(); stats.refreshMs = +(performance.now() - t0).toFixed(1); }, REFRESH_MS);
    };
    if (fresh) setTimeout(go, 30); else go();
  }
  function centreOn() { // open at the whole map, unless we know only a little of it: then a closer look at what we know
    view.s = view.fit; view.cx = CX; view.cy = CY;
    if (landKnown || stats.known > 0.35) { clampView(); return; }
    const G = grid(); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let j = 0; j < V.n; j++) for (let i = 0; i < V.n; i++) if (G[j * V.n + i]) { x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, j); y1 = Math.max(y1, j); }
    if (!Number.isFinite(x0)) { clampView(); return; }
    const pad = 3, wx0 = (V.ox || 0) + (x0 - pad) * V.cellM, wx1 = (V.ox || 0) + (x1 + 1 + pad) * V.cellM, wy0 = (V.oy || 0) + (y0 - pad) * V.cellM, wy1 = (V.oy || 0) + (y1 + 1 + pad) * V.cellM;
    view.s = clamp(Math.min(view.W / (wx1 - wx0), view.H / (wy1 - wy0)) * 0.85, view.fit, view.fit * 3.2);
    view.cx = (wx0 + wx1) / 2; view.cy = (wy0 + wy1) / 2; clampView();
  }
  function close() { if (el.hidden) return; el.hidden = true; tip.hidden = true; button.classList.remove("on"); clearInterval(timer); timer = 0; }
  const toggle = () => el.hidden ? open() : close();
  button.onclick = () => toggle();
  el.querySelector(".wmx").onclick = () => close();
  el.querySelector(".wmhome").onclick = () => { const b = (w.buildings || []).find((q) => q.team === PLAYER && q.kind === "town_hall"); const T = w.teams?.[PLAYER]?.town; const p = b || T; if (p) { view.cx = p.x; view.cy = p.y; view.s = Math.max(view.s, view.fit * 3); clampView(); redraw(); } };
  el.querySelector(".wmlegbtn").onclick = () => legend.classList.toggle("show");
  el.addEventListener("pointerdown", (e) => { if (e.target === el) close(); }); // (a click on the dark margin round the sheet)
  addEventListener("resize", () => { if (!el.hidden) { resize(); draw(); } });
  // keys: M toggles; Esc closes; while it is open, the game's own keys rest (it is a sheet over the game)
  addEventListener("keydown", (e) => {
    if (e.target.closest?.("input,textarea,select,[contenteditable]")) return;
    const plainM = (e.key === "m" || e.key === "M") && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (plainM && !e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); toggle(); return; }
    if (el.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if (e.key === "F1" || e.metaKey || e.ctrlKey) return;
    e.stopImmediatePropagation();
  }, true);

  const api = { tick, open, close, toggle, isOpen: () => !el.hidden, el, button, stats, view, lastJump: null,
    // for headless checks: the world→canvas transform, the state of a cell, a sample of the drawn sheet
    w2s, s2w, cellAt, foreignBuildings, redraw: () => draw(),
    labels: () => drawnLabels.slice(), foe: () => foeDrawn.slice(),
    fogAlpha(x, y) { if (!fogged) return -1; const B = BASE_PX; return fogged.getContext("2d").getImageData(clamp(Math.floor((x - X0) / size * B), 0, B - 1), clamp(Math.floor((Y0 + size - y) / size * B), 0, B - 1), 1, 1).data[3]; },
    pixel(px, py) { const dpr = cv.width / view.W; const d = ctx.getImageData(Math.round(px * dpr), Math.round(py * dpr), 1, 1).data; return [d[0], d[1], d[2]]; },
    canvasRect: () => cv.getBoundingClientRect() };
  return api;
}
