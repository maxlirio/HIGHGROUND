// EARTHWORKS — a castle's ditches and moats DUG INTO THE LAND (the sim's height and the rendered terrain alike).
//
// castle.js lays a ditch / moat as segments (part.segs, the causeways before the gates left out; part.rsegs the whole
// runs, bridged at the gates; part.fills where the besiegers have filled it: siege-war.js fillMoat). carveCastle()
// turns them into a 1 m raster over the castle and installs it on the map:
//   map.h(x, y)         the sim height, now lower in a ditch (men really go down into it; escalade, engines and the
//                       figures all read it). The causeway before a gate and a filled crossing stay at bank level.
//   map.carved(x, y)    how deep the sim ground is cut there (m) — world.goingMul caps the grade on a cut face
//   map.carves          [{ x0, y0, x1, y1, cell, nx, ny, cut, rdh, tex }] for the terrain renderer
//                       (js/render/terrain.js setCarves): rdh = what the rendered ground adds to map.h (the
//                       channel runs on under a gate's bridge); tex RGBA per node: R water depth (the river's water
//                       shader), G bare rock, B raw earth; water: the wet runs, whose surface lies waterZ under the lip.
//   map.carveVer        bumped on every change (the renderer rebuilds its patch)
//
// PROFILES (after the castle kit's ditch/moat manifest, assets/castle-kit.json: 9–11 m across, 3.5 m deep, water
// 1.4 m under the lip; and siege-research.md §17): a rock-cut ditch (hill castle, ground "rock") ~5 m deep with
// near-vertical rough sides and a broken floor; an earth ditch ~3.5 m deep at ~45°; a wet moat 3.4 m to its bed with
// a stone revetment on the castle side (render/castle.js draws the masonry) and a sloping earth counterscarp.
export const CARVE_CELL = 1;     // m
export const WATER_Z = 1.4;      // m: a moat's water under its lip (castle kit: water node at −1.4 m)
const WATER_SHADE = 1.3; // m: the depth the water shader is told — a moat reads as the river's own water (its reaches are ~1–2 m)
const DEPTH = { rock: 5.0, earth: 3.5, moat: 3.4 };
const REVET_S = 0.86;            // the revetment face, as a fraction of the half-width on the castle side

function hash2(i, j) { let h = (i * 374761393 + j * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  return (hash2(i, j) * (1 - su) + hash2(i + 1, j) * su) * (1 - sv) + (hash2(i, j + 1) * (1 - su) + hash2(i + 1, j + 1) * su) * sv;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// depth (m, ≥ 0) across a cut at s = |offset| / half-width, on the castle side (inner) or the field side
function profile(kind, s, inner, x, y) {
  if (kind === "rock") { // rock-cut: sheer rough faces, a floor of broken rock
    const face = s + (vnoise(x * 0.45, y * 0.45) - 0.5) * 0.08;
    const d = DEPTH.rock * (1 - sstep(0.4, 0.93, face));
    return d > 0 ? d - (vnoise(x * 0.7 + 11, y * 0.7) - 0.5) * 0.7 * (1 - sstep(0.3, 0.55, s)) : 0;
  }
  if (kind === "moat") {
    if (inner) return DEPTH.moat * (1 - sstep(REVET_S, REVET_S + 0.05, s)); // the revetment: a stone face
    return DEPTH.moat * (1 - sstep(0.45, 1.0, s + (vnoise(x * 0.3, y * 0.3) - 0.5) * 0.06));
  }
  return DEPTH.earth * (1 - sstep(0.24, 1.0, s + (vnoise(x * 0.3, y * 0.3) - 0.5) * 0.05));
}

// the depth of one run at (x, y): { d, s, inner } (d 0 outside it). A run's ends are round where it turns a corner
// (joined) and a steep face where it stops (a causeway before a gate, a fill, the end of a moat in the river)
function runDepth(r, x, y) {
  const dx = x - r.x0, dy = y - r.y0, t = dx * r.ux + dy * r.uy, v = dx * r.nx + dy * r.ny;
  let across = Math.abs(v), endMul = 1;
  if (t < 0) { if (r.joinA) across = Math.hypot(t, v); else endMul = 1 - sstep(0, 1.6, -t); }
  else if (t > r.L) { if (r.joinB) across = Math.hypot(t - r.L, v); else endMul = 1 - sstep(0, 1.6, t - r.L); }
  const s = across / r.hw; if (s >= 1.05 || endMul <= 0) return 0;
  return profile(r.kind, s, v > 0, x, y) * endMul;
}
// a fill (siege-war.js fillMoat): the moat made good to a trodden causeway 12 m wide
function fillAt(fills, r, x, y) {
  let m = 0;
  for (const f of fills) { if (Math.abs((f.x - r.x0) * r.nx + (f.y - r.y0) * r.ny) > r.hw * 1.2) continue; const t = (x - f.x) * r.ux + (y - f.y) * r.uy; m = Math.max(m, 1 - sstep(f.r - 2.2, f.r + 0.4, Math.abs(t))); }
  return m;
}
const FILL_D = 0.25;

function runsOf(C, list) {
  const out = [];
  for (const p of C.parts) {
    if (p.kind !== "ditch" && p.kind !== "moat") continue;
    const kind = p.kind === "moat" ? "moat" : p.rock ? "rock" : "earth", hw = p.width / 2;
    for (const q of (list === "sim" ? p.segs.map((s, k) => ({ x0: s[0], y0: s[1], x1: s[2], y1: s[3], joinA: !p.segEnds?.[k]?.[0], joinB: !p.segEnds?.[k]?.[1] })) : p.rsegs || [])) {
      const L = Math.hypot(q.x1 - q.x0, q.y1 - q.y0); if (L < 0.1) continue;
      const ux = (q.x1 - q.x0) / L, uy = (q.y1 - q.y0) / L; let nx = -uy, ny = ux;
      if (((q.x0 + q.x1) / 2 - C.x) * nx + ((q.y0 + q.y1) / 2 - C.y) * ny > 0) { nx = -nx; ny = -ny; } // +n: toward the castle
      out.push({ x0: q.x0, y0: q.y0, L, ux, uy, nx, ny, hw, kind, joinA: q.joinA, joinB: q.joinB, fills: p.fills || [], wet: kind === "moat" });
    }
  }
  return out;
}

// (re)carve the castle's ditches and moats into the map (castle.js at creation; siege-war.js after a fill)
export function carveCastle(map, C) {
  const simR = runsOf(C, "sim"), renR = runsOf(C, "render");
  if (!simR.length && !renR.length) return null;
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const r of renR.concat(simR)) for (const [x, y] of [[r.x0, r.y0], [r.x0 + r.ux * r.L, r.y0 + r.uy * r.L]]) { const m = r.hw + 3; bx0 = Math.min(bx0, x - m); by0 = Math.min(by0, y - m); bx1 = Math.max(bx1, x + m); by1 = Math.max(by1, y + m); }
  const cell = CARVE_CELL, x0 = Math.max(map.x0 ?? 0, Math.floor(bx0)), y0 = Math.max(map.y0 ?? 0, Math.floor(by0)), nx = Math.ceil((Math.min(map.x1 ?? map.size, bx1) - x0) / cell) + 1, ny = Math.ceil((Math.min(map.y1 ?? map.size, by1) - y0) / cell) + 1;
  const n = nx * ny, cut = new Float32Array(n), rdh = new Float32Array(n), tex = new Float32Array(n * 4);
  const depthOf = (runs, x, y, info) => {
    let d = 0;
    for (const r of runs) {
      let q = runDepth(r, x, y); if (q <= 0) continue;
      const fm = r.fills.length ? fillAt(r.fills, r, x, y) : 0; if (fm > 0) { q = q * (1 - fm) + Math.min(q, FILL_D) * fm; if (info) info.fill = Math.max(info.fill, fm); }
      if (q > d) { d = q; if (info) { info.r = r; } }
    }
    return d;
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * cell, y = y0 + j * cell, k = j * nx + i, info = { r: null, fill: 0 };
    const ds = depthOf(simR, x, y, null), dr = depthOf(renR, x, y, info);
    cut[k] = ds;
    const wet = info.r?.wet && info.fill < 0.5;
    rdh[k] = ds - dr;
    tex[k * 4] = wet ? Math.min(WATER_SHADE, Math.max(0, dr - WATER_Z)) : 0;
    tex[k * 4 + 1] = info.r?.kind === "rock" ? sstep(0.15, 0.6, dr) : 0;
    tex[k * 4 + 2] = Math.max(info.fill > 0 ? sstep(0.1, 0.6, info.fill) : 0, info.r?.kind === "earth" ? sstep(0.2, 1.2, dr) * 0.85 : 0, info.r?.kind === "rock" ? sstep(3.6, 4.6, dr) * 0.55 : 0, wet ? sstep(0.1, 0.9, dr) * (1 - sstep(WATER_Z, WATER_Z + 0.4, dr)) * 0.7 : 0);
  }
  // the water: a surface WATER_Z under the lip along each wet run (the terrain renderer lays it as a sheet over the
  // channel; the banks rise through it, so the shore is where the sheet meets them)
  const water = renR.filter((r) => r.wet).map((r) => ({ x0: r.x0, y0: r.y0, ux: r.ux, uy: r.uy, nx: r.nx, ny: r.ny, L: r.L, hw: r.hw, joinA: r.joinA, joinB: r.joinB }));
  const K = { id: C.id, x0, y0, x1: x0 + (nx - 1) * cell, y1: y0 + (ny - 1) * cell, cell, nx, ny, cut, rdh, tex, water, waterZ: WATER_Z };
  installCarve(map, K);
  return K;
}

// bilinear sample of a node raster
export function carveSample(K, arr, x, y) {
  const fx = (x - K.x0) / K.cell, fy = (y - K.y0) / K.cell;
  if (fx < 0 || fy < 0 || fx > K.nx - 1 || fy > K.ny - 1) return 0;
  const i = Math.min(K.nx - 2, fx | 0), j = Math.min(K.ny - 2, fy | 0), u = fx - i, v = fy - j, k = j * K.nx + i;
  return (arr[k] * (1 - u) + arr[k + 1] * u) * (1 - v) + (arr[k + K.nx] * (1 - u) + arr[k + K.nx + 1] * u) * v;
}

function installCarve(map, K) {
  if (!map.carves) {
    map.carves = []; map.carveVer = 0;
    const base = map.h, list = map.carves; map.hBase = base;
    map.h = (x, y) => {
      const v = base(x, y);
      for (let c = 0; c < list.length; c++) { const q = list[c]; if (x > q.x0 && y > q.y0 && x < q.x1 && y < q.y1) return v - carveSample(q, q.cut, x, y); }
      return v;
    };
    map.carved = (x, y) => { for (let c = 0; c < list.length; c++) { const q = list[c]; if (x > q.x0 && y > q.y0 && x < q.x1 && y < q.y1) return carveSample(q, q.cut, x, y); } return 0; };
  }
  // one castle's earthworks per place: a castle built again on the same ground (a test harness reusing its map,
  // a siege fought again) replaces what was there
  for (let c = map.carves.length - 1; c >= 0; c--) { const q = map.carves[c]; if (q.id === K.id && q.x0 === K.x0 && q.y0 === K.y0 || (q.x0 < K.x1 && K.x0 < q.x1 && q.y0 < K.y1 && K.y0 < q.y1)) map.carves.splice(c, 1); }
  map.carves.push(K); map.carveVer++;
}
