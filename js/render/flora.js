// FLORA lane: richer plant life, all of it render-only — the sim never reads anything in this file.
//
//  1. SKINS — a deterministic re-skin of the map's vegetation instances (same x/y/rot/scale, so the
//     sim's trees, obstacles, canopy, felling and cover are untouched): beech in the high wood,
//     rowan on the upland edges, hawthorn in the scrub, field-maple standards in the hedgerows, a
//     handful of lightning-struck oaks. skinOf() is pure in (instance, map); simOf()/fellInfo() give
//     the render lanes the sim species behind a skin (render/jobs/forestry.js fells through them).
//  2. UNDERGROWTH — chunked, camera-local instanceless card flora read off the map's own surface
//     grid: wildflower drifts in the flower meadows (bloom and fade with the calendar, season.js),
//     reed beds along shallow water, ferns and mushrooms in the wood shade, brambles at the wood
//     edges, ivy and moss on the old trees. Density follows the Low/Medium/High quality preset.
//  3. FORAGE THICKETS — the forage nodes' bramble/hazel bushes (lane C works them but had no
//     models), which look picked-over as a node's amount runs down.
import * as THREE from "three";
import { loadAsset, FOG } from "./props.js";
import { hMirror } from "./terrain.js";
import { Q, onQuality } from "./quality.js";
import { SEASON, SEASON_GLSL, setDoy } from "./season.js";
import { TREES } from "../sim/jobs/forestry.js";
import { BODY_R } from "../sim/obstacles.js";

// ---------------------------------------------------------------- 1 · the skins
// render asset → the sim species whose vegetation.json instance it stands on
const SKIN_SIM = { beech: "oak_b", rowan: "birch", field_maple: "hedge_shrub", hawthorn: "bush", struck_oak: "oak_a", "willow~alder": "alder" };
const SKIN_H = { beech: 20.5, rowan: 9.3, field_maple: 10.5, hawthorn: 5.8, struck_oak: 14.8, "willow~alder": 10.2 }; // authored heights (m)
export const simOf = (a) => SKIN_SIM[a] || a;
// is this prop kind a fellable tree, and how does its model fall? (render/jobs/forestry.js)
export function fellInfo(asset) {
  const sim = simOf(asset), t = TREES[sim];
  return t ? { h: SKIN_H[asset] || t.h, r: BODY_R[sim] ?? 0.4 } : null;
}

export function hash01(x, y, s = 0) { const v = Math.sin(x * 12.9898 + y * 78.233 + s * 37.719) * 43758.5453; return v - Math.floor(v); }

// which skin (if any) this vegetation instance wears — deterministic in its position + the map
export function skinOf(it, map) {
  const a = it.asset, s = map.surfaceAt ? map.surfaceAt(it.x, it.y) : "", r = hash01(it.x, it.y);
  switch (a) {
    case "alder": {   // the bank alders: most of those standing over the water are drawn as pollard willows
      if (r >= 0.6 || !map.water) return a;
      for (let k = 0; k < 8; k++) for (const d of [4, 9]) if (map.water(it.x + Math.cos(k * 0.785) * d, it.y + Math.sin(k * 0.785) * d) > 0.05) return "willow~alder";
      return a;
    }
    case "oak_a": return r < 0.006 ? "struck_oak" : a;                              // the rare landmark hulk
    case "oak_b": case "oak_c":                                                     // beech hangers in the high wood
      return s === "dense_forest" && map.h(it.x, it.y) >= 95 && r < 0.45 ? "beech" : a;
    case "birch":
      if (/heath|moor|gorse|bracken/.test(s) && r < 0.45) return "rowan";           // the upland thorn-and-rowan edge
      if (/forest/.test(s) && map.h(it.x, it.y) >= 108 && r < 0.3) return "rowan";
      return a;
    case "hedge_shrub":
      if (s === "hedgerow") return r < 0.065 ? "field_maple" : a;                   // hedgerow standards
      if (/pasture|fallow|meadow/.test(s) && r < 0.3) return "hawthorn";            // stray thorns off the line
      return a;
    case "bush":
      if (/gorse|heath|moor|bramble|pasture|fallow/.test(s) && r < 0.5) return "hawthorn";
      if (s === "open_forest" && r < 0.12) return "hawthorn";
      return a;
  }
  return a;
}

// ---------------------------------------------------------------- 2 · the undergrowth atlas
// A small painted card atlas, made at run time (8 cells of 128 px in a 1024×128 strip):
// 0-2 flowers (white ox-eye, red campion/poppy, yellow buttercup), 3 reeds, 4 fern, 5 mushrooms,
// 6 bramble, 7 ivy. Painterly blobs — these cards are 0.3-1.2 m and read at 10-200 m.
function paintAtlas() {
  const C = 128, cv = document.createElement("canvas"); cv.width = C * 8; cv.height = C;
  const g = cv.getContext("2d"); g.clearRect(0, 0, cv.width, cv.height);
  const R = (seed) => { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; };
  const cell = (i, fn) => { g.save(); g.translate(i * C, 0); g.beginPath(); g.rect(0, 0, C, C); g.clip(); fn(); g.restore(); };
  const flowers = (i, petal, heart, nf) => cell(i, () => {
    const r = R(7 + i * 13);
    for (let k = 0; k < 4; k++) { const x = 16 + k * 30 + r() * 10; g.strokeStyle = "#8aa852"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, C); g.lineTo(x + (r() - 0.5) * 12, C * 0.5); g.stroke(); }
    for (let k = 0; k < nf; k++) {     // BIG bright heads — these cards are 0.5 m and read from across a field
      const x = 16 + (k * (C - 30)) / (nf - 1) + (r() - 0.5) * 10, y = C * (0.12 + r() * 0.28);
      g.strokeStyle = "#8aa852"; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x - (r() - 0.5) * 10, C); g.quadraticCurveTo(x, C * 0.6, x, y); g.stroke();
      const pr = 16 + r() * 6;
      for (let p = 0; p < 7; p++) { const a = (p / 7) * 6.283 + r();
        g.fillStyle = petal; g.beginPath(); g.ellipse(x + Math.cos(a) * pr * 0.6, y + Math.sin(a) * pr * 0.5, pr * 0.52, pr * 0.32, a, 0, 6.3); g.fill(); }
      g.fillStyle = heart; g.beginPath(); g.arc(x, y, pr * 0.3, 0, 6.3); g.fill();
    }
  });
  flowers(0, "#fbf8ec", "#ecc748", 5);           // ox-eye daisy
  flowers(1, "#e0556a", "#8a2c38", 5);           // campion / poppy drift
  flowers(2, "#f6dc2e", "#c89a30", 6);           // buttercup
  cell(3, () => {                                 // reeds: stiff stems, brown seed heads
    const r = R(41);
    for (let k = 0; k < 20; k++) { const x = 4 + k * 6 + r() * 5, lean = (r() - 0.5) * 16, top = C * (0.02 + r() * 0.22);   // a dense stand
      g.strokeStyle = ["#6a7a3a", "#7d8a44", "#8a9050", "#5e6e34"][k % 4]; g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(x, C); g.quadraticCurveTo(x + lean * 0.4, C * 0.5, x + lean, top + 18); g.stroke();
      if (r() < 0.7) { g.fillStyle = "#6b5234"; g.beginPath(); g.ellipse(x + lean, top + 10, 2.8, 10, lean * 0.01, 0, 6.3); g.fill(); }
      g.strokeStyle = "#5c7034"; g.lineWidth = 1.6;                           // a blade off each stem
      g.beginPath(); g.moveTo(x, C * 0.72); g.quadraticCurveTo(x + 14, C * 0.6, x + 20 + r() * 8, C * (0.34 + r() * 0.1)); g.stroke(); }
  });
  cell(4, () => {                                 // fern: arching fronds of leaflet strokes
    const r = R(23);
    for (let f = 0; f < 5; f++) {
      const x0 = 24 + f * 20, a0 = -1.57 + (f - 2) * 0.38, L = C * (0.62 + r() * 0.25);
      g.strokeStyle = "#3f6024"; g.lineWidth = 2;
      const tip = [x0 + Math.cos(a0) * L * 0.9, C + Math.sin(a0 + 0.12) * L];
      g.beginPath(); g.moveTo(x0, C); g.quadraticCurveTo(x0 + Math.cos(a0) * L * 0.5, C + Math.sin(a0) * L * 0.62, tip[0], tip[1]); g.stroke();
      for (let t = 0.12; t < 0.95; t += 0.09) {
        const px = x0 + (tip[0] - x0) * t, py = C + (tip[1] - C) * t * (2 - t) * 0.72, ln = 13 * (1 - t * 0.8) + 3;
        g.strokeStyle = t % 0.18 < 0.09 ? "#4c7029" : "#55792e"; g.lineWidth = 3.2 * (1 - t * 0.6);
        g.beginPath(); g.moveTo(px - ln, py - ln * 0.24); g.lineTo(px + ln, py - ln * 0.4); g.stroke();
      }
    }
  });
  cell(5, () => {                                 // mushrooms: a troop of caps in the litter
    const r = R(61);
    for (let k = 0; k < 5; k++) {
      const x = 20 + k * 22 + r() * 8, h = 18 + r() * 26, w = 10 + r() * 12, y = C - h;
      g.fillStyle = "#cfc5ad"; g.fillRect(x - 2.4, y, 4.8, h);
      g.fillStyle = ["#8a4a2c", "#a05a30", "#7a6a4a"][k % 3];
      g.beginPath(); g.ellipse(x, y, w, w * 0.55, 0, Math.PI, 0); g.fill();
      g.fillStyle = "rgba(255,245,220,.5)";
      for (let d = 0; d < 3; d++) { g.beginPath(); g.arc(x - w * 0.5 + d * w * 0.5, y - w * 0.22, 1.6, 0, 6.3); g.fill(); }
    }
    g.fillStyle = "#4a3c2a"; g.beginPath(); g.ellipse(C / 2, C - 3, C * 0.44, 5, 0, 0, 6.3); g.fill();
  });
  cell(6, () => {                                 // bramble: arching canes, dark trifoliate leaves, berries
    const r = R(83);
    for (let c2 = 0; c2 < 4; c2++) { const x0 = 10 + c2 * 32;
      g.strokeStyle = "#5a3232"; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(x0, C); g.quadraticCurveTo(x0 + 28, C * 0.22 + c2 * 6, x0 + 58, C * (0.5 + r() * 0.3)); g.stroke(); }
    for (let k = 0; k < 26; k++) { const x = 8 + r() * (C - 16), y = C * 0.14 + r() * C * 0.64;
      g.fillStyle = ["#4a6428", "#55722c", "#3f5a22", "#6a4a28"][k % 4];
      for (let p = 0; p < 3; p++) { const a = (p - 1) * 0.9 + (r() - 0.5); g.beginPath(); g.ellipse(x + Math.cos(a) * 5, y + Math.sin(a) * 4, 6.5, 3.4, a, 0, 6.3); g.fill(); } }
    for (let k = 0; k < 7; k++) { g.fillStyle = k % 3 ? "#241c26" : "#6a2432";
      g.beginPath(); g.arc(10 + r() * (C - 20), C * 0.2 + r() * C * 0.5, 3.1, 0, 6.3); g.fill(); }
  });
  cell(7, () => {                                 // ivy: a climbing sheet of dark lobed leaves
    const r = R(97);
    g.strokeStyle = "#4a3a2a"; g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(C * 0.5, C); g.quadraticCurveTo(C * 0.42, C * 0.5, C * 0.52, 6); g.stroke();
    for (let k = 0; k < 34; k++) { const t = r(), x = C * 0.5 + (r() - 0.5) * C * (0.9 - t * 0.5), y = C - t * (C - 10);
      g.fillStyle = ["#2e4a20", "#35541f", "#3f6024", "#2a421c"][k % 4];
      g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 5.5, y - 1); g.lineTo(x + 3, y + 5); g.lineTo(x - 3, y + 5); g.lineTo(x - 5.5, y - 1); g.closePath(); g.fill(); }
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

// groups: how each kind of ground flora follows the year (scale is applied toward the card's base)
const GRP = { flower: 0, reed: 1, fern: 2, shroom: 3, bramble: 4, ivy: 5 };
// what each group turns toward when it turns: straw reeds, rusty ferns, wine-dark bramble
const GTINT = [[1, 1, 1], [0.78, 0.68, 0.4], [0.66, 0.5, 0.3], [1, 1, 1], [0.7, 0.44, 0.32], [1, 1, 1], [1, 1, 1], [1, 1, 1]];
function grpSeason() {
  const A = SEASON.autumn.value, B = SEASON.bare.value, F = SEASON.bloom.value, M = SEASON.shroom.value;
  return {
    scale: [F, 1, 0.35 + 0.65 * (1 - B) * (1 - 0.25 * A), M, 1, 1, 1, 1],
    tintAmt: [0, Math.max(A * 0.45, B * 0.9), Math.max(A * 0.55, B * 0.85), 0, A * 0.5 + B * 0.35, 0, 0, 0],
  };
}

// what grows on which of the map's painted surfaces: [group, per-cell density, size lo, size hi]
const RULES = {
  flower_meadow: [["flower", 1.9, 0.42, 0.62]],
  water_meadow: [["flower", 0.7, 0.4, 0.58]],
  tall_grass: [["flower", 0.28, 0.4, 0.55]],
  chalk_downland: [["flower", 0.55, 0.36, 0.5]],
  bracken: [["fern", 1.7, 0.55, 0.95]],
  dense_forest: [["fern", 0.5, 0.5, 0.85], ["shroom", 0.1, 0.22, 0.34]],
  open_forest: [["fern", 0.18, 0.45, 0.75], ["shroom", 0.045, 0.2, 0.3]],
  pine_forest: [["fern", 0.33, 0.5, 0.8], ["shroom", 0.08, 0.22, 0.34]],
  coppice: [["fern", 0.14, 0.4, 0.7], ["shroom", 0.035, 0.2, 0.3]],
  bramble_thicket: [["bramble", 1.4, 0.5, 0.9]],
  gorse_scrub: [["bramble", 0.4, 0.45, 0.8]],
  deadfall_clearing: [["shroom", 0.25, 0.22, 0.36], ["bramble", 0.35, 0.45, 0.8]],
};
const FLOWER_CELLS = [0, 1, 2], CELL_OF = { reed: 3, fern: 4, shroom: 5, bramble: 6, ivy: 7 };
const DENS = { low: 0.45, medium: 1, high: 1.5 }, RADIUS = { low: 130, medium: 190, high: 290 };

// ---------------------------------------------------------------- the renderer
export function makeFlora(scene, map, props) {
  // the map's extent (the big world's runs from −6 km: docs/big-world.md) and its grid, read through the arrays where the map
  // has them, else (a streamed world: js/sim/tilemap.js) through its lookups at each grid node
  const X0 = map.x0 || 0, Y0 = map.y0 || 0, X1 = X0 + map.size, Y1 = Y0 + map.size;
  const gridAt = map.surface ? null : { s: (i, j) => map.surfaceAt(X0 + i * map.cell, Y0 + j * map.cell), w: (i, j) => map.water(X0 + i * map.cell, Y0 + j * map.cell) };
  // castle ground (props.clearArea) also strips the undergrowth and the forage thickets; wrap the shared hook. A building's
  // ground hands its own undergrowth test (opts.under, its yard; opts.ubox bounds it — render/jobs/forestry.js)
  const clears = [];   // [{ t: test(x, y), box: [x0, y0, x1, y1] | null }]
  const inBox = (B, x, y) => !B || (x >= B[0] && x <= B[2] && y >= B[1] && y <= B[3]);
  if (props) {
    const orig = props.clearArea;
    props.clearArea = (test, opts = {}) => {
      orig(test, opts);
      const C = { t: opts.under || test, box: opts.under ? opts.ubox || null : opts.box || null }; clears.push(C);
      for (const [key, c] of chunks) {   // (only the chunks under it are rebuilt)
        if (C.box) { const ci = Math.floor(key / 4096), cj = key - ci * 4096; if (X0 + ci * CH > C.box[2] || X0 + (ci + 1) * CH < C.box[0] || Y0 + cj * CH > C.box[3] || Y0 + (cj + 1) * CH < C.box[1]) continue; }
        c.stale = true;
      }
      for (const n of thicket.nodes) for (const it of n.items) if (!it.gone && inBox(C.box, it.x, it.y) && C.t(it.x, it.y)) it.gone = true;
    };
  }
  const cleared = (x, y) => { for (const C of clears) if (inBox(C.box, x, y) && C.t(x, y)) return true; return false; };

  // --- undergrowth material (one for every chunk): fog of war + per-group seasonal scale/tint
  const uGScale = { value: new Array(8).fill(1) }, uGTint = { value: new Float32Array(GTINT.flat()) }, uGAmt = { value: new Array(8).fill(0) };
  const atlas = paintAtlas();
  const mat = new THREE.MeshLambertMaterial({ map: atlas, alphaTest: 0.4, side: THREE.DoubleSide, vertexColors: true,
    emissive: new THREE.Color(0.22, 0.22, 0.2), emissiveMap: atlas }); // a small lift so low cards don't sit in dead shade
  mat.customProgramCacheKey = () => "hg-undergrowth";
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, FOG, { uGScale, uGTint, uGAmt });
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 off; attribute float grp;\nuniform float uGScale[8]; uniform vec3 uGTint[8]; uniform float uGAmt[8];\nvarying vec3 vFogW; varying vec4 vTint;")
      .replace("#include <begin_vertex>", "int gi = int(grp + .5);\nvec3 transformed = position + off * uGScale[gi];\nvTint = vec4(uGTint[gi], uGAmt[gi]);")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvFogW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFogW; varying vec4 vTint; uniform sampler2D fogTex; uniform float fogOn; uniform float mapSize;")
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vTint.rgb, vTint.a);
        if (fogOn > .5) { float fv = texture2D(fogTex, vec2(vFogW.x, -vFogW.z) / mapSize).r;
          float g = dot(gl_FragColor.rgb, vec3(.3,.59,.11)); vec3 rem = mix(vec3(g), gl_FragColor.rgb, .35) * .45;
          gl_FragColor.rgb = mix(mix(vec3(.004), rem, smoothstep(.15,.45,fv)), gl_FragColor.rgb, smoothstep(.55,.95,fv)); }`);
  };

  // --- old trees (for ivy/moss): a chunk-keyed index, set once the vegetation instances are known
  const CH = 100;
  const oldTrees = new Map();
  function setVeg(list) {
    oldTrees.clear();
    for (const it of list) {
      if (!/^(oak_|beech|struck_oak|dead_tree)/.test(it.asset) || (it.scale || 1) < 1.02) continue;
      if (hash01(it.x, it.y, 5) > 0.45) continue;
      const s = map.surfaceAt ? map.surfaceAt(it.x, it.y) : "";
      if (s !== "dense_forest" && s !== "open_forest" && s !== "alder_carr") continue;
      const k = Math.floor((it.x - X0) / CH) * 4096 + Math.floor((it.y - Y0) / CH);
      let b = oldTrees.get(k); if (!b) oldTrees.set(k, (b = []));
      b.push(it);
    }
    for (const c of chunks.values()) c.stale = true;
  }

  // --- chunk building
  const chunks = new Map();   // key → { mesh, cx, cy, stale }
  const FOREST = /forest|coppice/;
  // reeds per ~15 m² map cell, from the water layer itself (water.f32): in the shallows, then by how many
  // cells (~3.9 m each) up the bank the nearest water is; a fen or marsh far from open water keeps a sparse stand
  const WD = map.waterDepth, RES = map.res;
  const wet = (i, j) => i >= 0 && j >= 0 && i < RES && j < RES && (gridAt ? gridAt.w(i, j) : WD[j * RES + i]) > 0.05;
  function reedDensity(i, j, key, wd) {
    if (!WD && !gridAt) return 0;
    if (wd > 0.05) return wd < 0.5 ? 5 : wd < 0.9 ? 2.2 : 0;
    let r = 9;
    for (let dj = -3; dj <= 3 && r > 1; dj++) for (let di = -3; di <= 3; di++) if ((di || dj) && wet(i + di, j + dj)) r = Math.min(r, Math.max(Math.abs(di), Math.abs(dj)));
    const marshy = /reed_bed_fen|marsh/.test(key);
    if (r === 1) return 3.4;
    if (r === 2) return 1.1;
    if (r === 3) return marshy || /mud|water_meadow/.test(key) ? 0.35 : 0;
    return marshy ? 0.15 : 0;
  }
  function buildChunk(ci, cj) {
    const cell = map.cell, i0 = Math.max(0, Math.floor((ci * CH) / cell)), i1 = Math.min(map.res - 1, Math.ceil(((ci + 1) * CH) / cell));
    const j0 = Math.max(0, Math.floor((cj * CH) / cell)), j1 = Math.min(map.res - 1, Math.ceil(((cj + 1) * CH) / cell)); // (grid indices from the map's corner)
    const dens = DENS[Q.name] ?? 1;
    const pos = [], uv = [], col = [], off = [], grp = [], idx = [];
    const sKey = gridAt ? gridAt.s : (i, j) => map.surfaceKeys[map.surface[j * map.res + i]];
    // one card = two crossed quads leaning a little apart; all growth is in `off` so the season can furl it
    function card(x, y, g, cellIx, size, tintJ, wide = 1, lift = 0) {
      const z = hMirror(map, x, y), rot = hash01(x, y, 2) * Math.PI, n0 = pos.length / 3;
      const w = size * wide * (0.85 + hash01(x, y, 3) * 0.5), h = size + lift;
      const u0 = cellIx / 8, u1 = (cellIx + 1) / 8;
      const tj = 0.92 + tintJ * 0.33;
      for (let q = 0; q < 2; q++) {
        const a = rot + q * 1.57 + (hash01(x, y, q) - 0.5) * 0.5, dx = Math.cos(a) * w * 0.5, dy = Math.sin(a) * w * 0.5;
        const b = pos.length / 3;
        pos.push(x, z, -y, x, z, -y, x, z, -y, x, z, -y);
        off.push(-dx, 0, dy, dx, 0, -dy, dx, h, -dy, -dx, h, dy);
        uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
        for (let v = 0; v < 4; v++) { col.push(tj, tj, tj); grp.push(g); }
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      return n0;
    }
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const key = sKey(i, j), x0 = X0 + i * cell, y0 = Y0 + j * cell;
      const rules = RULES[key] || [];
      const wd = map.water(x0, y0);
      // the reed band hugs the waterline: thickest in the shallows, a fringe a few metres up the bank, then nothing
      const rd = reedDensity(i, j, key, wd) * dens;
      if (rd > 0) {
        const n = Math.floor(rd) + (hash01(i, j, 21) < rd % 1 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          const x = x0 + hash01(i * 5 + k, j, 22) * cell, y = y0 + hash01(i, j * 5 + k, 23) * cell;
          if (x < X0 + 2 || y < Y0 + 2 || x > X1 - 2 || y > Y1 - 2 || cleared(x, y)) continue;
          const dx = map.water(x, y); if (dx > 0.9) continue;                                   // never out in open water
          card(x, y, GRP.reed, CELL_OF.reed, 1.1 + hash01(x, y, 24) * 0.7, hash01(x, y, 25), 1.5, Math.min(0.8, dx));
        }
      }
      for (const [kind, d0, s0, s1] of rules) {
        if (wd > 0.05) continue;
        let d = d0 * dens;
        if (kind === "bramble" && FOREST.test(key)) d = 0;
        const n = Math.floor(d) + (hash01(i, j, 7) < d % 1 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          const x = x0 + hash01(i * 3 + k, j, 8) * cell, y = y0 + hash01(i, j * 3 + k, 9) * cell;
          if (x < X0 + 2 || y < Y0 + 2 || x > X1 - 2 || y > Y1 - 2 || cleared(x, y)) continue;
          if (map.water(x, y) > 0.05) continue;
          if (kind === "flower" && hash01(Math.floor(x / 9), Math.floor(y / 9), 11) < 0.45) continue; // drifts, not a carpet
          const cellIx = kind === "flower" ? FLOWER_CELLS[Math.floor(hash01(x, y, 12) * 3) % 3] : CELL_OF[kind];
          card(x, y, GRP[kind], cellIx, s0 + hash01(x, y, 13) * (s1 - s0), hash01(x, y, 14));
        }
      }
      // brambles fringe the woods: a forest cell with open ground beside it
      if (FOREST.test(key) && dens > 0.5) {
        const open = (di, dj) => { const q = sKey(Math.max(0, Math.min(map.res - 1, i + di)), Math.max(0, Math.min(map.res - 1, j + dj))); return !FOREST.test(q) && !/water|marsh|reed/.test(q); };
        if ((open(1, 0) || open(-1, 0) || open(0, 1) || open(0, -1)) && hash01(i, j, 15) < 0.55 * dens) {
          const x = x0 + hash01(i, j, 16) * cell, y = y0 + hash01(j, i, 17) * cell;
          if (!(x < X0 + 2 || y < Y0 + 2 || x > X1 - 2 || y > Y1 - 2 || cleared(x, y) || map.water(x, y) > 0.05))
            card(x, y, GRP.bramble, CELL_OF.bramble, 0.5 + hash01(x, y, 18) * 0.45, hash01(x, y, 19));
        }
      }
    }
    // ivy up and moss round the old trunks of this chunk
    const olds = oldTrees.get(ci * 4096 + cj) || []; // (chunk (ci, cj) from the map's corner)
    for (const t of olds) {
      if (cleared(t.x, t.y)) continue;
      const sc = t.scale || 1, z = hMirror(map, t.x, t.y);
      for (let q = 0; q < 2; q++) {       // ivy: two crossed sheets hugging the trunk
        const a = hash01(t.x, t.y, 20) * Math.PI + q * 1.57, w = 0.55 * sc, h = (1.8 + hash01(t.x, t.y, 21) * 1.4) * sc;
        const dx = Math.cos(a) * w, dy = Math.sin(a) * w, b = pos.length / 3;
        pos.push(t.x, z, -t.y, t.x, z, -t.y, t.x, z, -t.y, t.x, z, -t.y);
        off.push(-dx, 0, dy, dx, 0, -dy, dx, h, -dy, -dx, h, dy);
        uv.push(7 / 8, 0, 1, 0, 1, 1, 7 / 8, 1);
        for (let v = 0; v < 4; v++) { col.push(0.9, 0.9, 0.9); grp.push(GRP.ivy); }
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    }
    if (!idx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("off", new THREE.Float32BufferAttribute(off, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute("grp", new THREE.Float32BufferAttribute(grp, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere(); geo.boundingSphere.radius += 4; // positions are card BASES; `off` can reach ~3 m up (ivy)
    const normal = new Float32Array(pos.length); for (let v = 0; v < normal.length; v += 3) normal[v + 1] = 1;
    geo.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = true;
    scene.add(mesh); return mesh;
  }

  onQuality(() => { for (const c of chunks.values()) c.stale = true; });

  // --- forage thickets
  const thicket = { nodes: [], sets: null, loading: false };
  function addForage(list) {
    for (const o of list) {
      const items = [{ asset: "berry_bush", x: o.x, y: o.y, rot: o.rot || 0, s: o.scale || 2 }];
      const n1 = 4 + Math.floor(hash01(o.x, o.y) * 3);
      for (let k = 0; k < n1; k++) {
        const a = (k / n1) * 6.283 + hash01(o.x, o.y, k) * 1.1, r = 2.8 + hash01(o.y, o.x, k) * 2.6;
        items.push({ asset: "berry_bush", x: o.x + Math.cos(a) * r, y: o.y + Math.sin(a) * r, rot: hash01(k, o.x) * 6.28, s: 0.85 + hash01(k, o.y) * 0.45 });
      }
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * 6.283 + 0.9 + hash01(o.x, o.y, 9 + k), r = 4.2 + hash01(o.y, o.x, 9 + k) * 2.4;
        items.push({ asset: "bush", x: o.x + Math.cos(a) * r, y: o.y + Math.sin(a) * r, rot: hash01(k, o.y, 3) * 6.28, s: 0.5 + hash01(k, o.x, 3) * 0.3 });
      }
      for (const it of items) if (cleared(it.x, it.y)) it.gone = true;   // (a building's yard, a field, a castle's ground)
      thicket.nodes.push({ x: o.x, y: o.y, items, pick: 1, lod: -1 });
    }
    if (!thicket.loading && thicket.nodes.length) {
      thicket.loading = true;
      const total = thicket.nodes.reduce((m, n) => m + n.items.length, 0);
      Promise.all([loadAsset("berry_bush"), loadAsset("bush")]).then(([bb, bu]) => {
        const sets = { berry_bush: [], bush: [] };
        for (const [name, lods] of [["berry_bush", bb], ["bush", bu]]) {
          for (const lod of [0, 1]) {
            sets[name].push(lods[lod].map(({ geo, mat: m }) => {
              const im = new THREE.InstancedMesh(geo, m, total);
              im.count = 0; im.frustumCulled = false; im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(total * 3).fill(1), 3);
              scene.add(im); return im;
            }));
          }
        }
        thicket.sets = sets;
      }).catch((e) => console.warn("forage thicket models missing", e));
    }
  }
  const dummy = new THREE.Object3D(), tCol = new THREE.Color();
  function thicketFrame(w, cam) {
    if (!thicket.sets) return;
    // a node's picked state: its forage amount against where it started (local sim worlds only)
    if (w?.resources) for (const n of thicket.nodes) {
      const node = w.resources.find((q) => q.kind === "forage" && Math.abs(q.x - n.x) < 1 && Math.abs(q.y - n.y) < 1);
      if (node) n.pick = Math.max(0, Math.min(1, node.amount / (node.start || 1)));
    }
    for (const n of thicket.nodes) {
      const d = Math.hypot(n.x - cam.position.x, hMirror(map, n.x, n.y) - cam.position.y, -n.y - cam.position.z);
      n.lod = d < 150 ? 0 : d < 650 ? 1 : -1;
    }
    for (const name of ["berry_bush", "bush"]) {
      for (let lod = 0; lod < 2; lod++) {
        const ims = thicket.sets[name][lod]; let n = 0;
        for (const node of thicket.nodes) {
          if (node.lod !== lod) continue;
          const worn = 1 - node.pick;   // picked-over: squashed a little and browned
          tCol.setRGB(1 - worn * 0.3, 1 - worn * 0.38, 1 - worn * 0.45);
          for (const it of node.items) {
            if (it.asset !== name || it.gone) continue;
            dummy.position.set(it.x, hMirror(map, it.x, it.y), -it.y);
            dummy.rotation.set(0, it.rot, 0);
            dummy.scale.set(it.s * (1 - worn * 0.06), it.s * (1 - worn * 0.16), it.s * (1 - worn * 0.06));
            dummy.updateMatrix();
            for (const im of ims) { im.setMatrixAt(n, dummy.matrix); im.setColorAt(n, tCol); }
            n++;
          }
        }
        for (const im of ims) { im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
      }
    }
  }

  // --- the frame hook
  let t = 1, tk = 0;
  const seen = new Set();
  function update(w, cam, dt = 0.016) {
    setDoy(w?.econ?.doy);
    if ((t += dt) < 0.3) return; t = 0;
    const S = grpSeason();
    for (let g = 0; g < 8; g++) { uGScale.value[g] = S.scale[g]; uGAmt.value[g] = S.tintAmt[g]; }
    thicketFrame(w, cam);
    // undergrowth chunks round the camera's ground point
    const cx = cam.position.x, cy = -cam.position.z;
    const ground = hMirror(map, cx, cy);
    // nothing from the Map view, and nothing on maps without a painted surface grid
    const R = !(map.surface || gridAt) || !map.surfaceKeys?.length ? 0 : (RADIUS[Q.name] ?? 190) * (cam.position.y - ground > 420 ? 0 : 1);
    seen.clear();
    if (R > 0) {
      const i0 = Math.floor((cx - R - X0) / CH), i1 = Math.floor((cx + R - X0) / CH), j0 = Math.floor((cy - R - Y0) / CH), j1 = Math.floor((cy + R - Y0) / CH);
      let built = 0;
      for (let cj = j0; cj <= j1; cj++) for (let ci = i0; ci <= i1; ci++) {
        if (ci < 0 || cj < 0 || (ci + 0.5) * CH > map.size || (cj + 0.5) * CH > map.size) continue;
        if (Math.hypot(X0 + (ci + 0.5) * CH - cx, Y0 + (cj + 0.5) * CH - cy) > R + CH * 0.7) continue;
        const key = ci * 4096 + cj; seen.add(key);
        let c = chunks.get(key);
        if (c && c.stale && built < 1) { if (c.mesh) { scene.remove(c.mesh); c.mesh.geometry.dispose(); } chunks.delete(key); c = null; built++; }
        if (!c && built < 2) { chunks.set(key, { mesh: buildChunk(ci, cj), stale: false }); built++; }
      }
    }
    if (++tk % 8 === 0) for (const [key, c] of chunks) if (!seen.has(key)) { if (c.mesh) { scene.remove(c.mesh); c.mesh.geometry.dispose(); } chunks.delete(key); }
  }

  // (checks: undergrowth cards in the built chunks whose base stands inside test(x, y) → [[x, y]] — tools/browser-playtest.mjs)
  function cardsIn(test) {
    const out = [];
    for (const c of chunks.values()) { const P = c.mesh?.geometry.attributes.position; if (!P) continue; for (let v = 0; v < P.count; v += 4) { const x = P.getX(v), y = -P.getZ(v); if (test(x, y)) out.push([x, y]); } }
    for (const n of thicket.nodes) for (const it of n.items) if (!it.gone && test(it.x, it.y)) out.push([it.x, it.y]);
    return out;
  }
  // the ground under [x0, y0, x1, y1] changed what it reads (a big world's tile arrived): its chunks are built again
  function restale(B) { for (const [key, c] of chunks) { const ci = Math.floor(key / 4096), cj = key - ci * 4096; if (X0 + ci * CH > B[2] || X0 + (ci + 1) * CH < B[0] || Y0 + cj * CH > B[3] || Y0 + (cj + 1) * CH < B[1]) continue; c.stale = true; } }
  return { update, setVeg, addForage, cardsIn, restale, stats: () => ({ chunks: chunks.size, thickets: thicket.nodes.length }) };
}
