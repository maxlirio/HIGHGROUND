// Gathering lane C: hunting — its render side (docs/gathering-plan.md). makeRender(scene, map, ctx) → { update(w, cam, opts) }.
//   • the beasts, their carcasses and the kills on soldiers' shoulders: js/render/wild.js
//   • arrows in flight at game (w.wild.shots), a missed one left stuck in the turf for a few seconds
//   • the larder rack by the store door (item kind "rack": carcasses hung from a pole frame, one per piece)
//   • the villager hunter's poses and bow (assets/src/units/_lane_hunting.py) and the carcass kinds' marks and holds
import * as THREE from "three";
import { PIECE, MARK, COL, tint, merge } from "../labor.js";
import { POSE_KIT, SYNCED, CARRY_PART } from "../figures.js";
import { makeWildRender } from "../wild.js";

// the carcass kinds are drawn by render/wild.js (the fall, the dead pose): the core's stack draws nothing for them
const EMPTY = () => { const g = new THREE.BufferGeometry(); for (const n of ["position", "normal", "color"]) g.setAttribute(n, new THREE.BufferAttribute(new Float32Array(0), 3)); return g; };
// (no baked carcass part on the carrier: render/wild.js slings the beast itself across his shoulders; his hands hold its legs)
for (const k of ["deer", "roe", "boar"]) { PIECE[k] = { geo: EMPTY, at: () => [0, 0, 0, 0] }; MARK[k] = 3; delete CARRY_PART[k]; }
COL.deer = "#9a6440"; COL.roe = "#a8764a"; COL.boar = "#4a3e34"; COL.rack = "#8a4a36"; MARK.rack = 3;
// the rack: two forked posts and a pole, a gutted carcass hanging head-down from it by the hind legs (one per piece)
PIECE.rack = {
  geo: () => {
    const g = [], wood = "#6b5138", meat = "#8a4034", hide = "#8a5a38";
    for (const z of [-0.45, 0.45]) g.push(tint(new THREE.CylinderGeometry(0.06, 0.07, 2.3, 6), wood, 0.25).translate(0, 1.15, z));   // (neighbours share a post)
    g.push(tint(new THREE.CylinderGeometry(0.05, 0.05, 0.95, 6), wood, 0.2).rotateX(Math.PI / 2).translate(0, 2.22, 0));
    g.push(tint(new THREE.SphereGeometry(0.26, 8, 6), hide, 0.2).scale(0.9, 2.3, 0.8).translate(0, 1.35, 0));      // the body
    g.push(tint(new THREE.SphereGeometry(0.2, 7, 5), meat, 0.2).scale(0.5, 1.8, 0.7).translate(0.13, 1.35, 0));    // opened belly
    g.push(tint(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 5), hide).translate(0, 1.98, 0.1).rotateX(0.2));       // hind legs to the pole
    g.push(tint(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 5), hide).translate(0, 1.98, -0.1).rotateX(-0.2));
    g.push(tint(new THREE.SphereGeometry(0.1, 7, 5), hide, 0.2).scale(1, 1.4, 0.9).translate(0, 0.62, 0));          // the head hanging
    return merge(g);
  },
  at: (k) => [0, 0, (k % 4) * 0.9 - 0.9, 0].map((v, i) => (i === 0 ? Math.floor(k / 4) * 1.4 : v)),
};
POSE_KIT.hunt_lurk = ["bow"]; POSE_KIT.hunt_stalk = ["bow"]; POSE_KIT.hunt_draw = ["bow"];
SYNCED.add("hunt_draw");

export function makeRender(scene, map, ctx) {
  const wild = makeWildRender(scene, map, { figures: ctx?.figures });
  if (typeof window !== "undefined") window.__wildR = wild;   // (headless checks: tools/wildlife-shots.mjs reads wild.stats())
  // arrows: a thin shaft with a pale fletch, flying a shallow arc; a miss sticks in the ground
  const g = merge([tint(new THREE.CylinderGeometry(0.008, 0.008, 0.8, 4), "#8a6a44", 0.1).rotateZ(Math.PI / 2),
    tint(new THREE.ConeGeometry(0.02, 0.06, 4), "#555048").rotateZ(-Math.PI / 2).translate(0.42, 0, 0),
    tint(new THREE.BoxGeometry(0.12, 0.05, 0.004), "#ddd6c4").translate(-0.34, 0, 0)]);
  const arrows = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), 256); arrows.count = 0; arrows.frustumCulled = false; scene.add(arrows);
  const d = new THREE.Object3D();
  function update(w, cam, opts = {}) {
    wild.update(w, cam, opts);
    const W = w.wild; let n = 0;
    if (W?.shots?.length) for (const s of W.shots) {
      const [x0, y0, z0, x1, y1, t0, fl, hit] = s, k = (w.time - t0) / fl;
      if (k < 0 || n >= 256) continue;
      if (k >= 1 && (hit || w.time - t0 - fl > 5)) continue;
      const kk = Math.min(1, k), x = x0 + (x1 - x0) * kk, y = y0 + (y1 - y0) * kk, D = Math.hypot(x1 - x0, y1 - y0);
      const arc = D * 0.06, h0 = map.h(x0, y0) + z0, h1 = map.h(x1, y1) + (hit ? 0.8 : -0.15), h = h0 + (h1 - h0) * kk + arc * 4 * kk * (1 - kk);
      const yaw = Math.atan2(y1 - y0, x1 - x0), slope = Math.atan2((h1 - h0) + arc * 4 * (1 - 2 * kk), D || 1);
      d.position.set(x, h, -y); d.rotation.set(0, yaw, k >= 1 ? -0.7 : slope, "YXZ"); d.updateMatrix(); arrows.setMatrixAt(n++, d.matrix);
    }
    arrows.count = n; arrows.instanceMatrix.needsUpdate = true;
  }
  return { update, wild };
}
