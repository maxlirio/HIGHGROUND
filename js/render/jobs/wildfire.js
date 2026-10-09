// FIRE IN THE WOODS, its render side (the sim: js/sim/wildfire.js; flames and smoke: js/render/fire.js).
//   • the BURNT GROUND: each burnt cell blackened — ash and char draped on the ground, soft at the burnt edge, grey ash
//     in patches; glowing embers under a cell still alight whose trees are down
//   • the TREES that burnt: their standing instances gone (props.clearArea, the undergrowth with them: flora.js), in their
//     place black snags (the trunk stood dead, its crown gone), charred stumps, a fallen burnt log here and there
// Read from w.fire (cells: i, j, h, ch; burnt: { k: { i, j, t } }), the same in single-player and on a realm client
// (js/realm/client.js mirrors it). Which tree stood where comes from the props (the map's vegetation as drawn).
// (A burnt wood that greens over again — the sim's regrowth, months later — shows its trees on the next page load.)
import * as THREE from "three";
import { groundH } from "../terrain.js";
import { fellInfo, simOf, hash01 } from "../flora.js";
import { BODY_R } from "../../sim/obstacles.js";
import { CROWN } from "../../sim/jobs/forestry.js";

const C = 16, SUB = 4;   // the fire's cell (m); the ground mesh's quads per cell side
const ASH = new THREE.Color("#1a1714"), GREY = new THREE.Color("#57524c"), BROWN = new THREE.Color("#3a2a1c");
function tint(geo, col, jit = 0.1, seed = 1) {
  const n = geo.attributes.position.count, a = new Float32Array(n * 3), c = new THREE.Color(col);
  for (let k = 0; k < n; k++) { const f = 1 + (hash01(k, seed) - 0.5) * jit; a[k * 3] = c.r * f; a[k * 3 + 1] = c.g * f; a[k * 3 + 2] = c.b * f; }
  geo.setAttribute("color", new THREE.BufferAttribute(a, 3)); return geo;
}
function mergeGeos(list) {
  const geos = list.map((g) => g.index ? g.toNonIndexed() : g); let n = 0; for (const g of geos) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), Cc = new Float32Array(n * 3); let o = 0;
  for (const g of geos) { g.computeVertexNormals(); P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); Cc.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry(); out.setAttribute("position", new THREE.BufferAttribute(P, 3)); out.setAttribute("normal", new THREE.BufferAttribute(N, 3)); out.setAttribute("color", new THREE.BufferAttribute(Cc, 3)); return out;
}
// a snag: the burnt trunk standing (unit radius 1 at the foot, 1 m tall — scaled per tree), split and charred, a stub of a limb
function snagGeo() {
  const g = [], t = new THREE.CylinderGeometry(0.72, 1, 1, 8, 4), P = t.attributes.position;
  // the top broken off ragged: each top vertex at its own height (a split, slanted stub, not a cut)
  for (let k = 0; k < P.count; k++) { const y = P.getY(k); if (y > 0.49) { const a = Math.atan2(P.getZ(k), P.getX(k)); P.setY(k, 0.5 - 0.28 * (0.5 + 0.5 * Math.sin(a * 3 + 1)) - 0.12 * Math.cos(a)); } else if (y > -0.5) P.setX(k, P.getX(k) * (1 + 0.08 * Math.sin(y * 9))); }
  g.push(tint(t, "#17120f", 0.45, 3).translate(0, 0.5, 0));
  g.push(tint(new THREE.CylinderGeometry(0.07, 0.13, 0.3, 5), "#1a1410", 0.3, 5).rotateZ(1.1).translate(0.72, 0.6, 0)); // limb stubs
  g.push(tint(new THREE.CylinderGeometry(0.05, 0.1, 0.22, 5), "#1a1410", 0.3, 6).rotateZ(-1.2).translate(-0.68, 0.42, 0.1));
  for (let j = 0; j < 4; j++) { const a = j * 1.6 + 0.3; g.push(tint(new THREE.CylinderGeometry(0.12, 0.34, 0.8, 5), "#16110d", 0.3, j + 9).rotateZ(Math.PI / 2 - 0.35).rotateY(a).translate(Math.cos(a) * 0.95, 0.1, -Math.sin(a) * 0.95)); } // root flares
  return mergeGeos(g);
}
function stumpGeo() {   // a charred stump: radius 1, 0.5 high, the top burnt hollow
  const g = [];
  g.push(tint(new THREE.CylinderGeometry(0.92, 1.1, 0.5, 9, 1, true), "#16110e", 0.35, 6).translate(0, 0.25, 0));
  g.push(tint(new THREE.CircleGeometry(0.92, 10).rotateX(-Math.PI / 2), "#0b0807", 0.2, 7).translate(0, 0.42, 0));
  g.push(tint(new THREE.RingGeometry(0.3, 0.6, 10).rotateX(-Math.PI / 2), "#3a2c22", 0.3, 8).translate(0, 0.44, 0)); // grey-brown char rings
  return mergeGeos(g);
}
function logGeo() {     // a fallen burnt trunk along +X (unit radius, 1 m long)
  return mergeGeos([tint(new THREE.CylinderGeometry(1, 1, 1, 7).rotateZ(Math.PI / 2).translate(0.5, 0, 0), "#14100d", 0.4, 11)]);
}

export function makeRender(scene, map) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mk = (geo, cap) => { const m = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.frustumCulled = false; scene.add(m); return m; };
  const snags = mk(snagGeo(), 12000), stumps = mk(stumpGeo(), 12000), logs = mk(logGeo(), 4000);
  // the burnt ground: one draped mesh, rebuilt when the burnt cells change
  const gmat = new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); // (opaque char, unlit: it reads black under any sun)
  const ground = new THREE.Mesh(new THREE.BufferGeometry(), gmat); ground.frustumCulled = false; ground.renderOrder = 2; scene.add(ground);
  // embers: the cells still alight whose trees are down, glowing
  const emat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
  const embers = new THREE.Mesh(new THREE.BufferGeometry(), emat); embers.frustumCulled = false; embers.renderOrder = 3; scene.add(embers);
  const h = (x, y) => groundH(map, x, y);
  const d = new THREE.Object3D();
  let props = null, seen = -1, nKeys = -1, pending = [], lastClear = 0, emberT = 0;
  const treesAt = new Map();   // cell key → [{ x, y, r, H, s, asset }] (the props that stood there)
  const isPlant = (a) => simOf(a) in BODY_R || simOf(a) in CROWN || a === "berry_bush";

  // the props standing in cell (i, j) (looked up through the props' 200 m chunks)
  function propsIn(i, j) {
    const out = [], x0 = i * C, y0 = j * C, cks = new Set();
    for (const x of [x0, x0 + C - 0.01]) for (const y of [y0, y0 + C - 0.01]) cks.add(Math.floor(x / 200) * 1000 + Math.floor(y / 200)); // (a cell may straddle the props' 200 m chunks)
    for (const [asset, k] of props.kinds) {
      const fi = fellInfo(asset); if (!fi && !isPlant(asset)) continue;
      for (const ck of cks) {
        const c = k.chunks.get(ck); if (!c) continue;
        for (const o of c.items) {
          if (o.x < x0 || o.x >= x0 + C || o.y < y0 || o.y >= y0 + C || o.gone || (o.scale ?? 1) < 0.01) continue; // (already gone: grubbed for a building, felled)
          const s = o.s0 ?? o.scale ?? 1; out.push({ x: o.x, y: o.y, s, asset, r: (fi?.r ?? 0.3) * s, H: (fi?.h ?? 3) * s, tree: !!fi });
        }
      }
    }
    return out;
  }
  function rebuild(w) {
    const F = w.fire, B = F?.burnt || {}, keys = Object.keys(B);
    // newly burnt cells: what stood there (read before it is cleared), then cleared in one batch
    for (const k of keys) if (!treesAt.has(+k)) { const q = B[k]; treesAt.set(+k, propsIn(q.i, q.j)); pending.push(q); }
    for (const k of [...treesAt.keys()]) if (!B[k]) treesAt.delete(k);
    // the snags, stumps and logs
    let ns = 0, nt = 0, nl = 0;
    for (const [k, list] of treesAt) for (const t of list) {
      if (!t.tree) continue;
      const r = hash01(t.x, t.y, 5), hb = h(t.x, t.y), R = Math.max(0.25, t.r * 1.05);
      if (r < 0.55 && ns < snags.instanceMatrix.count) { const H = Math.max(1.6, t.H * (0.08 + 0.2 * hash01(t.x, t.y, 6)) ** 1.2 * 1.6); d.position.set(t.x, hb - 0.15, -t.y); d.rotation.set((hash01(t.x, t.y, 7) - 0.5) * 0.12, r * 40, (hash01(t.x, t.y, 8) - 0.5) * 0.12); d.scale.set(R, H, R); d.updateMatrix(); snags.setMatrixAt(ns++, d.matrix); }
      else if (r < 0.85 && nt < stumps.instanceMatrix.count) { d.position.set(t.x, hb - 0.08, -t.y); d.rotation.set(0, r * 40, 0); d.scale.set(R * 1.1, 0.8 + hash01(t.x, t.y, 9) * 0.6, R * 1.1); d.updateMatrix(); stumps.setMatrixAt(nt++, d.matrix); }
      else if (nl < logs.instanceMatrix.count) { const a = hash01(t.x, t.y, 10) * 6.283, L = t.H * (0.35 + 0.3 * hash01(t.x, t.y, 11)), ex = t.x + Math.cos(a) * L, ey = t.y + Math.sin(a) * L; d.position.set(t.x, hb + R * 0.6, -t.y); d.rotation.set(0, a, Math.atan2(h(ex, ey) - hb, L), "YZX"); d.scale.set(L, R * 0.75, R * 0.75); d.updateMatrix(); logs.setMatrixAt(nl++, d.matrix); }
    }
    snags.count = ns; stumps.count = nt; logs.count = nl;
    for (const m of [snags, stumps, logs]) m.instanceMatrix.needsUpdate = true;
    ground.geometry.dispose(); ground.geometry = drape(keys.map((k) => B[k]), (i, j) => !!B[i * 65536 + j], (x, y, edge) => {
      const n = hash01(Math.round(x * 3), Math.round(y * 3), 2), g = hash01(Math.floor(x / 5), Math.floor(y / 5), 3);
      const c = g > 0.72 ? GREY.clone().lerp(ASH, n * 0.5) : g < 0.15 ? BROWN.clone().lerp(ASH, n) : ASH.clone().lerp(GREY, n * 0.25);
      if (edge) c.lerp(BROWN, 0.7);   // (a scorched brown rim where the fire stopped)
      return [c.r, c.g, c.b, 1];
    });
  }
  // a draped mesh over cells, SUB × SUB quads each; colour(x, y, edge) → [r, g, b, a] (edge: on the cell's border with
  // a cell not in the set — faded to nothing so the burnt ground has no hard square edge)
  function drape(cells, inSet, colour) {
    const per = (SUB + 1) * (SUB + 1), P = new Float32Array(cells.length * per * 3), Co = new Float32Array(cells.length * per * 4), idx = [];
    let v = 0;
    for (const q of cells) {
      const x0 = q.i * C, y0 = q.j * C, base = v;
      const open = [!inSet(q.i - 1, q.j), !inSet(q.i + 1, q.j), !inSet(q.i, q.j - 1), !inSet(q.i, q.j + 1)];
      for (let b = 0; b <= SUB; b++) for (let a = 0; a <= SUB; a++) {
        let x = x0 + a * C / SUB, y = y0 + b * C / SUB;
        const edge = (a === 0 && open[0]) || (a === SUB && open[1]) || (b === 0 && open[2]) || (b === SUB && open[3]);
        if (edge) { x += (hash01(Math.round(x), Math.round(y), 1) - 0.5) * 3; y += (hash01(Math.round(y), Math.round(x), 1) - 0.5) * 3; } // (a ragged edge)
        P[v * 3] = x; P[v * 3 + 1] = h(x, y) + 0.1; P[v * 3 + 2] = -y;
        const c = colour(x, y, edge); Co.set(c, v * 4); v++;
      }
      for (let b = 0; b < SUB; b++) for (let a = 0; a < SUB; a++) { const p = base + b * (SUB + 1) + a; idx.push(p, p + 1, p + SUB + 1, p + 1, p + SUB + 2, p + SUB + 1); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(P, 3)); g.setAttribute("color", new THREE.BufferAttribute(Co, 4)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  function update(w, cam, { dt = 0.016 } = {}) {
    props ||= globalThis.HG?.props || null;
    const F = w.fire; if (!F || !props) return;
    const now = performance.now(), keys = Object.keys(F.burnt).length;
    if ((F.bver ?? 0) !== seen || keys !== nKeys) { seen = F.bver ?? 0; nKeys = keys; rebuild(w); }
    // the burnt cells' plants go, in batches (props.clearArea is a test kept for later loads: one per batch, not per cell)
    if (pending.length && now - lastClear > 600) {
      lastClear = now; const S = new Set(pending.map((q) => q.i * 65536 + q.j)), box = [Infinity, Infinity, -Infinity, -Infinity];
      for (const q of pending) { box[0] = Math.min(box[0], q.i * C); box[1] = Math.min(box[1], q.j * C); box[2] = Math.max(box[2], (q.i + 1) * C); box[3] = Math.max(box[3], (q.j + 1) * C); }
      pending = [];
      props.clearArea((x, y) => S.has(Math.floor(x / C) * 65536 + Math.floor(y / C)), { only: isPlant, box });
    }
    // embers: the cells alight whose trees are down glow and flicker
    emberT += dt;
    if (emberT > 0.25) {
      emberT = 0;
      const hot = F.cells.filter((c) => c.ch && c.h > 0.15), on = new Set(hot.map((c) => c.i * 65536 + c.j)), heat = new Map(hot.map((c) => [c.i * 65536 + c.j, c.h]));
      embers.geometry.dispose();
      embers.geometry = drape(hot, (i, j) => on.has(i * 65536 + j), (x, y, edge) => {
        const k = Math.floor(x / C) * 65536 + Math.floor(y / C), q = heat.get(k) ?? 0.5, n = hash01(Math.round(x * 2), Math.round(y * 2), Math.floor(now / 250));
        const g = n > 0.8 ? 1 : n > 0.6 ? 0.25 : 0;   // (glowing patches among the ash, not a sheet)
        return [0.42 * g * q, 0.1 * g * q, 0.015 * g * q, 1];
      });
    }
  }
  globalThis.HG_WILDFIRE = { ground, embers, snags };   // (headless checks: tools/burn-shots.mjs)
  return { update };
}
