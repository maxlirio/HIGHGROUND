// The labour core's picture (docs/gathering-plan.md; the sim side is js/sim/labor.js). Purely a render layer.
//
//   • WORLD ITEMS: w.labor.items — site piles, stacks, dropped loads — as instanced procedural meshes (our own
//     geometry, no downloaded assets), `item.n` pieces laid out in a stack that grows with the pile.
//   • CARRIED LOADS at a distance: a villager's load is baked into his figure (js/render/figures.js laborKit), but
//     figures give way to dots beyond ~200 m; there each loaded man's dot wears a small MARKER (a brown bar for logs,
//     a grey block for stone, a round sack …) drawn just above it, so a column of log-carriers reads at the Eagle view.
//     Piles get a marker too when the camera is far.
//   • CARTS and DRAGGED LOGS: loads that are not on the body (carry.cart, hold "drag") are world props hung on the
//     man's figure (figures.bodyOf) or his dot.
// Lanes add item kinds by adding to PIECE (geometry + stack layout) and MARK (marker shape/colour); unknown kinds
// fall back to a sack.
import * as THREE from "three";
import { ITEMS } from "../sim/labor.js";
import { FIG_NEAR } from "./figures.js";
import { groundH, restH, restPose } from "./terrain.js";

export const COL = { log: "#6b5138", faggot: "#7a6446", planks: "#c9a878", stone: "#a7a296", basket: "#8a6a45", fish: "#8a6a45", sack: "#b3a27f",
  sheaf: "#d8b45a", barrel: "#7d5b3a", carcass: "#8a5a36", cart: "#6e5238" };
// marker shape: 0 bar, 1 block, 2 round, 3 wide oval
export const MARK = { log: 0, faggot: 0, planks: 0, stone: 1, barrel: 1, sheaf: 1, basket: 2, fish: 2, sack: 2, carcass: 3 };

// ---------------------------------------------------------------- geometry helpers (vertex-coloured, merged)
export function tint(g, c, vary = 0.18, seed = 1) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3), cc = new THREE.Color(c);
  for (let k = 0; k < n; k++) { const v = 1 - vary / 2 + vary * Math.abs(Math.sin((k + seed) * 12.9898) * 43758.5453 % 1); a.set([cc.r * v, cc.g * v, cc.b * v], k * 3); }
  g.setAttribute("color", new THREE.BufferAttribute(a, 3)); return g;
}
export function merge(list) {
  const gs = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "color"]) {
    const len = gs.reduce((s, g) => s + g.attributes[name].array.length, 0), arr = new Float32Array(len); let o = 0;
    for (const g of gs) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  return out;
}
// ---------------------------------------------------------------- trailer kinematics for towed things
// A towed cart must not sweep sideways when its puller turns: it keeps its own heading, and each frame it is pulled
// so it sits `L` behind the hitch along its OWN line to the hitch — pull away and it follows straight, turn and it
// cuts the corner, and it never slides sideways. Pure render state recomputed from the positions given each frame
// (no RNG, no dt), so it draws the same on a realm-mirror client fed streamed positions.
const tows = new Map();   // key → [x, y] (the towed thing's last drawn spot)
export function towFrom(key, hx, hy, L, heading) {   // hitch at (hx, hy); → [x, y, yaw] for the towed body
  let p = tows.get(key);
  if (!p || Math.hypot(hx - p[0], hy - p[1]) > L * 4) { p = [hx - Math.cos(heading) * L, hy - Math.sin(heading) * L]; tows.set(key, p); }
  const dx = hx - p[0], dy = hy - p[1], d = Math.hypot(dx, dy);
  const ux = d > 1e-4 ? dx / d : Math.cos(heading), uy = d > 1e-4 ? dy / d : Math.sin(heading);
  p[0] = hx - ux * L; p[1] = hy - uy * L;
  return [p[0], p[1], Math.atan2(uy, ux)];
}

const along = (g) => g.rotateZ(Math.PI / 2);   // a cylinder lying along +X
export function logGeo(L = 4, r = 0.17) {
  const bark = along(tint(new THREE.CylinderGeometry(r, r * 1.08, L, 9, 2), COL.log, 0.3));
  const e0 = along(tint(new THREE.CylinderGeometry(r * 0.96, r * 0.96, 0.02, 9), "#caa877", 0.1)).translate(L / 2, 0, 0);
  const e1 = along(tint(new THREE.CylinderGeometry(r * 1.04, r * 1.04, 0.02, 9), "#caa877", 0.1)).translate(-L / 2, 0, 0);
  return merge([bark, e0, e1]);
}
// the pieces: geometry (lying along +X, resting on y = 0) and where piece k of a stack of n goes: [x along, y up, z across, yawJitter]
export const PIECE = {
  log: { geo: () => logGeo(4, 0.17), at: (k) => pyramid(k, 5, 0.36, 0.31) },
  faggot: { geo: () => { const g = []; for (let j = 0; j < 7; j++) g.push(along(tint(new THREE.CylinderGeometry(0.04, 0.05, 1.6, 5), COL.faggot, 0.3, j)).translate(0, 0.12 + (j % 3) * 0.08, (j - 3) * 0.05)); g.push(along(tint(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 8), "#4a3a2a")).translate(0.3, 0.2, 0)); return merge(g); }, at: (k) => pyramid(k, 4, 0.5, 0.32) },
  planks: { geo: () => { const g = []; for (let j = 0; j < 4; j++) g.push(tint(new THREE.BoxGeometry(3.2, 0.05, 0.24), COL.planks, 0.15, j).translate(0, 0.03 + j * 0.055, 0)); return merge(g); }, at: (k) => [0, 0.23 * k, 0, (k % 2) * 0.03] },
  stone: { geo: () => tint(new THREE.BoxGeometry(0.8, 0.5, 0.55), COL.stone, 0.2).translate(0, 0.25, 0), at: (k) => grid(k, 3, 3, 0.85, 0.6, 0.5) },
  sack: { geo: () => tint(new THREE.SphereGeometry(0.34, 8, 6), COL.sack, 0.15).scale(1.3, 0.75, 0.95).translate(0, 0.24, 0), at: (k) => grid(k, 4, 3, 0.8, 0.62, 0.42) },
  barrel: { geo: () => merge([tint(new THREE.CylinderGeometry(0.28, 0.25, 0.8, 10), COL.barrel, 0.25).translate(0, 0.4, 0), tint(new THREE.CylinderGeometry(0.285, 0.285, 0.05, 10), "#3a3935").translate(0, 0.62, 0), tint(new THREE.CylinderGeometry(0.265, 0.265, 0.05, 10), "#3a3935").translate(0, 0.16, 0)]), at: (k) => grid(k, 4, 3, 0.65, 0.65, 0.82) },
  sheaf: { geo: () => merge([tint(new THREE.CylinderGeometry(0.22, 0.12, 1.0, 7), COL.sheaf, 0.2).translate(0, 0.5, 0), tint(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 7), "#b89a50").translate(0, 0.55, 0)]), at: (k) => ring(k, 0.45) },
  carcass: { geo: () => merge([tint(new THREE.SphereGeometry(0.4, 9, 6), COL.carcass, 0.2).scale(1.7, 0.6, 0.7).translate(0, 0.25, 0), tint(new THREE.SphereGeometry(0.14, 6, 5), COL.carcass).translate(0.75, 0.3, 0.1)]), at: (k) => grid(k, 3, 4, 1.4, 0.9, 0.45) },
  basket: { geo: () => merge([tint(new THREE.CylinderGeometry(0.34, 0.26, 0.45, 10, 1, true), COL.basket, 0.3).translate(0, 0.225, 0), tint(new THREE.SphereGeometry(0.33, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), "#5e4636", 0.35).scale(1, 0.45, 1).translate(0, 0.43, 0)]), at: (k) => grid(k, 4, 3, 0.8, 0.8, 0.55) },
};
PIECE.fish = PIECE.basket;
// a log pile: rows of `base`, each next row one fewer, sitting in the grooves
export function pyramid(k, base, dz, dy) { let row = 0, left = k, w = base; while (left >= w && w > 1) { left -= w; row++; w--; } return [((k * 7) % 3 - 1) * 0.15, row * dy, (left - (w - 1) / 2) * dz, 0]; }
export function grid(k, nx, nz, sx, sz, sy) { const per = nx * nz, l = Math.floor(k / per), r = k % per, i = r % nx, j = Math.floor(r / nx); return [(i - (nx - 1) / 2) * sx + (l % 2) * sx * 0.3, l * sy, (j - (nz - 1) / 2) * sz, ((k * 13) % 7 - 3) * 0.05]; }
export function ring(k, r) { if (k === 0) return [0, 0, 0, 0]; const a = k * 2.399, rr = r * Math.sqrt(k); return [Math.cos(a) * rr, 0, Math.sin(a) * rr, a]; }

function cartGeo(load) {
  const g = [];
  if (load === "logs") for (let j = 0; j < 5; j++) g.push(logGeo(2.6, 0.14).translate(0.1, 1.0 + (j > 2 ? 0.26 : 0), (j > 2 ? j - 3.5 : j - 1) * 0.3));
  if (load === "stone") for (let j = 0; j < 4; j++) g.push(tint(new THREE.BoxGeometry(0.7, 0.45, 0.5), COL.stone, 0.2, j).translate((j % 2 - 0.5) * 0.8, 1.05, (j < 2 ? -0.28 : 0.28)));
  if (load === "sacks") for (let j = 0; j < 5; j++) g.push(tint(new THREE.SphereGeometry(0.3, 8, 6), COL.sack, 0.15, j).scale(1.3, 0.7, 0.95).translate((j % 3 - 1) * 0.6, 1.0 + (j > 2 ? 0.2 : 0), j > 2 ? 0 : (j % 2 - 0.5) * 0.5));
  g.push(tint(new THREE.BoxGeometry(2.2, 0.12, 1.3), COL.cart, 0.2).translate(0, 0.75, 0));                 // bed
  for (const z of [-0.65, 0.65]) g.push(tint(new THREE.BoxGeometry(2.2, 0.35, 0.06), COL.cart, 0.2).translate(0, 0.95, z)); // sides
  for (const z of [-0.72, 0.72]) g.push(tint(new THREE.CylinderGeometry(0.62, 0.62, 0.08, 12), "#4a3a2a", 0.15).rotateX(Math.PI / 2).translate(-0.2, 0.62, z)); // wheels
  for (const z of [-0.45, 0.45]) g.push(tint(new THREE.BoxGeometry(2.0, 0.08, 0.08), COL.cart, 0.2).translate(2.0, 0.78, z)); // shafts forward
  return merge(g).scale(0.78, 0.78, 0.78);   // (a handcart, not a wain)
}

export function makeLaborRender(scene, map, { figures = null, cap = 6000 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const kinds = new Map();   // kind -> { mesh, n }
  function set(kind) {
    let K = kinds.get(kind); if (K) return K;
    const P = PIECE[kind] || PIECE.sack;
    const mesh = new THREE.InstancedMesh(P.geo(), mat, cap); mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false; scene.add(mesh);
    // the piece's own footprint (half extents along / across it, and how far it reaches below its rest line): each piece
    // of a pile is set on the drawn ground under ITS corners (restH), so a stack on a slope or a bump never hangs in air
    mesh.geometry.computeBoundingBox(); const bb = mesh.geometry.boundingBox;
    K = { mesh, P, n: 0, hx: Math.max(0.05, Math.min(Math.abs(bb.min.x), bb.max.x)), hz: Math.max(0.05, Math.min(Math.abs(bb.min.z), bb.max.z)), y0: Math.min(0, bb.min.y) };
    K.long = K.hx >= 0.9 && bb.max.y - bb.min.y < 0.6;   // (logs, boards: they lie along the slope; a trestle stands)
    kinds.set(kind, K); return K;
  }
  const carts = {}; for (const k of ["logs", "stone", "sacks"]) { const m = new THREE.InstancedMesh(cartGeo(k), mat, 300); m.count = 0; m.frustumCulled = false; scene.add(m); carts[k] = { mesh: m, n: 0 }; }
  const dragLog = new THREE.InstancedMesh(logGeo(4.5, 0.2), mat, 400); dragLog.count = 0; dragLog.frustumCulled = false; scene.add(dragLog);

  // ---- markers (points), drawn over the dots
  const MK = 12000, mgeo = new THREE.BufferGeometry();
  const mpos = new Float32Array(MK * 3), mcol = new Float32Array(MK * 3), mshape = new Float32Array(MK), msize = new Float32Array(MK), mlift = new Float32Array(MK);
  mgeo.setAttribute("position", new THREE.BufferAttribute(mpos, 3).setUsage(THREE.DynamicDrawUsage));
  mgeo.setAttribute("color", new THREE.BufferAttribute(mcol, 3).setUsage(THREE.DynamicDrawUsage));
  mgeo.setAttribute("shape", new THREE.BufferAttribute(mshape, 1).setUsage(THREE.DynamicDrawUsage));
  mgeo.setAttribute("size", new THREE.BufferAttribute(msize, 1).setUsage(THREE.DynamicDrawUsage));
  mgeo.setAttribute("lift", new THREE.BufferAttribute(mlift, 1).setUsage(THREE.DynamicDrawUsage));
  const mmat = new THREE.ShaderMaterial({
    uniforms: { pxPerM: { value: 1 }, dpr: { value: 1 }, vpH: { value: 900 } },
    vertexShader: /* glsl */`
      attribute vec3 color; attribute float shape; attribute float size; attribute float lift; uniform float pxPerM; uniform float dpr; uniform float vpH;
      varying vec3 vC; varying float vS;
      void main(){ vC = color; vS = shape; vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv;
        float px = clamp(size * pxPerM / -mv.z, 10.0, 18.0);
        gl_Position.y += lift * px * dpr * 2.0 / (vpH * dpr) * gl_Position.w;   // (sits just above the man's dot)
        gl_PointSize = px * dpr; }`,
    fragmentShader: /* glsl */`
      varying vec3 vC; varying float vS;
      void main(){ vec2 p = gl_PointCoord*2.-1.; float inside, edge;
        if (vS < 0.5)      { vec2 q = abs(p) / vec2(1.0, 0.36); inside = max(q.x, q.y); }           // bar: a log, a plank
        else if (vS < 1.5) { vec2 q = abs(p) / vec2(0.62, 0.52); inside = max(q.x, q.y); }          // block
        else if (vS < 2.5) { inside = length(p / vec2(0.6, 0.66)); }                                 // round: a sack, a basket
        else               { inside = length(p / vec2(0.95, 0.45)); }                                // a carcass
        if (inside > 1.0) discard;
        vec3 c = inside > 0.8 ? vC * 0.25 : vC * 1.15; gl_FragColor = vec4(pow(c, vec3(1./2.2)), 1.); }`,
    depthTest: true,
  });
  const marks = new THREE.Points(mgeo, mmat); marks.frustumCulled = false; marks.renderOrder = 6; scene.add(marks);

  const d = new THREE.Object3D(), tmpC = new THREE.Color(), B = { x: 0, y: 0, yaw: 0, fade: 0 };
  let itemVer = -1, itemCam = null;
  function putMark(nm, x, h, y, kind, size, lift) {
    if (nm >= MK) return nm;
    mpos[nm * 3] = x; mpos[nm * 3 + 1] = h; mpos[nm * 3 + 2] = -y;
    tmpC.set(COL[kind] || COL.sack); mcol[nm * 3] = tmpC.r; mcol[nm * 3 + 1] = tmpC.g; mcol[nm * 3 + 2] = tmpC.b;
    mshape[nm] = MARK[kind] ?? 2; msize[nm] = size; mlift[nm] = lift; return nm + 1;
  }

  // visible(x, y): is that ground in sight (fog of war); visibleMan(i): is that man drawn at all
  function update(w, cam, { visible = null, visibleMan = null, pxPerM = 1, dpr = 1, vpH = 900 } = {}) {
    const L = w.labor; mmat.uniforms.pxPerM.value = pxPerM; mmat.uniforms.dpr.value = dpr; mmat.uniforms.vpH.value = vpH;
    const cx = cam.position.x, cy = -cam.position.z, ch = cam.position.y;
    // ---- world items (rebuilt when they change, or every second for fog)
    const now = performance.now();
    if (L && (L.ver !== itemVer || !itemCam || now - itemCam > 1000)) {
      itemVer = L.ver; itemCam = now;
      for (const K of kinds.values()) K.n = 0;
      for (const it of L.items) {
        if (visible && !visible(it.x, it.y, it.team)) continue;
        const K = set(it.kind), c = Math.cos(it.rot), s = Math.sin(it.rot);
        // the pile's courses rest on its bottom course: a piece's base is the lowest drawn ground under its own corners —
        // the bottom course's (a piece higher up stands over the same spot: ay lifts it by the courses below)
        for (let k = 0; k < it.n && K.n < cap; k++) {
          const [ax, ay, az, jy] = K.P.at(k);
          const x = it.x + ax * c - az * s, y = it.y + ax * s + az * c;   // (sim plane: +x along rot, +z to its left)
          if (ay < -10) continue;   // (kinds drawn elsewhere: forestry's trees, stumps, saw-pits)
          if (K.long) { const [hb, pitch] = restPose(map, x, y, it.rot + jy, K.hx * 0.9, K.hz * 0.85); d.position.set(x, hb - K.y0 + ay, -y); d.rotation.set(0, it.rot + jy, pitch, "YZX"); }
          else { d.position.set(x, restH(map, x, y, it.rot + jy, K.hx * 0.85, K.hz * 0.85) - K.y0 + ay, -y); d.rotation.set(0, it.rot + jy, 0); }
          d.scale.setScalar(1); d.updateMatrix();
          K.mesh.setMatrixAt(K.n++, d.matrix);
        }
      }
      for (const K of kinds.values()) { K.mesh.count = K.n; K.mesh.instanceMatrix.needsUpdate = true; }
    } else if (!L) for (const K of kinds.values()) if (K.mesh.count) { K.mesh.count = 0; }
    // ---- carried loads: markers on dots, carts and dragged logs
    let nm = 0, nd = 0; for (const C of Object.values(carts)) C.n = 0;
    if (L) {
      const S = w.S, fade = figures?.fade;
      for (const [i, M] of L.men) {
        const c = M.carry; if (!c || !S.alive[i] || (visibleMan && !visibleMan(i))) continue;
        const fig = figures && figures.bodyOf(i, B);
        const x = fig ? B.x : S.x[i], y = fig ? B.y : S.y[i], h = groundH(map, x, y);
        const heading = fig ? B.yaw - Math.PI / 2 : S.facing[i];
        const hold = c.cart ? "cart" : ITEMS[c.kind]?.hold;
        const C = hold === "cart" ? carts[{ shoulder: "logs", front: "stone" }[ITEMS[c.kind]?.hold] || "sacks"] : null;
        if (C && C.n < 300) {   // a handcart, pulled between its shafts, the load heaped in it — it trails the man
          const [bx, by, cyaw] = towFrom("c" + i, x, y, 2.5, heading);
          d.position.set(bx, groundH(map, bx, by), -by); d.rotation.set(0, cyaw, 0); d.scale.setScalar(1); d.updateMatrix(); C.mesh.setMatrixAt(C.n++, d.matrix);
        } else if (hold === "drag" && nd < 400) {   // a log hauled on a rope, its end dragging — it trails too
          const [bx, by, cyaw] = towFrom("d" + i, x, y, 3.6, heading);
          d.position.set(bx, groundH(map, bx, by) + 0.12, -by); d.rotation.set(0, cyaw, 0.08); d.scale.setScalar(1); d.updateMatrix(); dragLog.setMatrixAt(nd++, d.matrix);
        }
        const ff = fade && i < fade.length ? fade[i] : 0;
        if (ff < 0.999) nm = putMark(nm, x, h + 1.5, y, c.cart ? "cart" : c.kind, 0.9, 0.95);
      }
      // piles seen from afar
      for (const it of L.items) {
        if (!it.n || (visible && !visible(it.x, it.y, it.team))) continue;   // (n 0: an empty pile, a stump — nothing to mark)
        const dist = Math.hypot(it.x - cx, it.y - cy, map.h(it.x, it.y) - ch); if (dist < FIG_NEAR * 1.4) continue;
        nm = putMark(nm, it.x, map.h(it.x, it.y) + 1.0, it.y, it.kind, 1.2 + 0.1 * it.n, 0);
      }
    }
    for (const C of Object.values(carts)) { C.mesh.count = C.n; C.mesh.instanceMatrix.needsUpdate = true; } dragLog.count = nd; dragLog.instanceMatrix.needsUpdate = true;
    mgeo.setDrawRange(0, nm);
    for (const k of ["position", "color", "shape", "size", "lift"]) mgeo.attributes[k].needsUpdate = true;
  }
  function stats(w) { const L = w?.labor; return { items: L?.items.length || 0, men: L?.men.size || 0, pieces: [...kinds].map(([k, K]) => `${k}:${K.n}`).join(" ") }; }
  return { update, stats, marks };
}
