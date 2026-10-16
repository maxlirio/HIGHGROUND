// Crossings the men make (js/sim/crossings.js): a trestle-and-plank bridge over a stream or moat, going up as the work
// goes on (the trestles first, then the stringers, then the deck laid plank by plank from the near bank, a stack of
// timber beside it), and a fill of fascines — brushwood bundles — rising in a moat until it is a causeway (render/castle.js
// then draws the finished fill with the castle). A burnt bridge is gone, leaving its charred trestle stumps.
// One small group per crossing, rebuilt only when its work has moved on a step.
import * as THREE from "three";
import { deckMap } from "../sim/crossings.js";

const STEPS = 24; // (the work drawn in 1/24 steps)
export function makeCrossings(scene, map) {
  const root = new THREE.Group(); root.name = "crossings"; scene.add(root);
  const unit = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 7); cyl.rotateZ(Math.PI / 2);
  const mats = new Map();
  const mat = (hex) => { let m = mats.get(hex); if (!m) mats.set(hex, (m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.92, metalness: 0 }))); return m; };
  const FRESH = [0xa8875c, 0x9c7b52, 0xb39468, 0x8f7049], OLD = 0x6e5a42, BRUSH = [0x6b5a36, 0x5d5230, 0x74633c], CHAR = 0x2a2420;
  const have = new Map(); // crossing id → { key, g }
  let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // a box in the crossing's frame: t along A→B, v across, z up (world heights); size along, up, across
  function frame(c) {
    const L = Math.hypot(c.bx - c.ax, c.by - c.ay) || 1, ux = (c.bx - c.ax) / L, uy = (c.by - c.ay) / L;
    const at = (t, v) => [c.ax + ux * t - uy * v, c.ay + uy * t + ux * v];
    return { L, ux, uy, at, rot: Math.atan2(uy, ux) };
  }
  function box(g, F, t, v, z, sl, sh, sw, color, yaw = 0, tilt = 0) {
    const [x, y] = F.at(t, v), m = new THREE.Mesh(unit, mat(color));
    m.position.set(x, z, -y); m.rotation.set(0, F.rot + yaw, tilt); m.scale.set(sl, sh, sw);
    m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  }
  function bundle(g, F, t, v, z, len, dia, color, yaw) {
    const [x, y] = F.at(t, v), m = new THREE.Mesh(cyl, mat(color));
    m.position.set(x, z, -y); m.rotation.set(0, F.rot + yaw, 0); m.scale.set(len, dia, dia); m.castShadow = true; g.add(m); return m;
  }

  function trestle(c, g) {
    const F = frame(c), hw = 2.5, deck = c.deck ?? map.h(c.ax, c.ay), bed = Math.min(c.bed ?? deck - 2, deck - 0.8), p = c.state === "done" ? 1 : c.prog, burnt = c.state === "burnt";
    seed = c.id * 977 + 13;
    // wet span: where the trestles stand (the banks carry the ends)
    const t0 = Math.min(F.L / 2, 2.4), t1 = Math.max(F.L / 2, F.L - 2.4), n = Math.max(1, Math.round((t1 - t0) / 3));
    const trestles = burnt ? n + 1 : Math.min(n + 1, Math.floor((p / 0.45) * (n + 1) + 0.001));
    for (let k = 0; k < trestles; k++) {
      const t = t0 + (t1 - t0) * k / n;
      if (burnt) { for (const sd of [-1, 1]) box(g, F, t, sd * (hw - 0.35), bed + 0.5, 0.22, 1.0 + rnd() * 0.5, 0.22, CHAR); continue; }
      const top = deck - 0.32, hgt = top - bed;
      for (const sd of [-1, 1]) box(g, F, t, sd * (hw - 0.35), bed + hgt / 2, 0.2, hgt, 0.2, FRESH[k % 4], 0, sd * 0.06);
      box(g, F, t, 0, top - 0.12, 0.26, 0.24, hw * 2 + 0.2, FRESH[(k + 1) % 4]);                // the cap
      const bh = bed + hgt * 0.45; const brace = box(g, F, t, 0, bh, 0.12, 0.12, hw * 2.1, OLD); brace.rotation.z = 0; brace.rotateX(Math.atan2(hgt * 0.5, hw * 2) * (k % 2 ? 1 : -1));
    }
    if (burnt) return;
    // stringers once the trestles stand
    if (p > 0.35) for (const v of [-hw + 0.45, 0, hw - 0.45]) { const len = F.L * Math.min(1, (p - 0.35) / 0.25); box(g, F, len / 2, v, deck - 0.14, len, 0.22, 0.22, OLD); }
    // the deck, plank by plank from the near bank
    if (p > 0.5) {
      const planks = Math.floor(F.L / 0.42), laid = Math.floor(planks * Math.min(1, (p - 0.5) / 0.45));
      for (let k = 0; k < laid; k++) box(g, F, 0.21 + k * 0.42, (rnd() - 0.5) * 0.12, deck, 0.36, 0.07, hw * 2 + (rnd() - 0.5) * 0.25, FRESH[Math.floor(rnd() * 4)], (rnd() - 0.5) * 0.03);
    }
    // a hand-rail on the downstream side when it is done
    if (p >= 1) {
      for (let t = 0.3; t <= F.L - 0.2; t += 2.4) box(g, F, t, hw - 0.1, deck + 0.5, 0.12, 1.0, 0.12, OLD);
      box(g, F, F.L / 2, hw - 0.1, deck + 0.98, F.L - 0.4, 0.1, 0.1, OLD);
    } else { // the timber stacked by the near bank, going down as it goes in
      const logs = Math.ceil((1 - p) * 9);
      for (let k = 0; k < logs; k++) { const row = k < 4 ? 0 : k < 7 ? 1 : 2, i = row === 0 ? k : row === 1 ? k - 4 : k - 7; const [x, y] = F.at(-3.2, -hw - 2.2 + i * 0.36 + row * 0.18);
        const m = bundle(g, F, -3.2, -hw - 2.2 + i * 0.36 + row * 0.18, map.h(x, y) + 0.18 + row * 0.3, 4.2, 0.32, FRESH[k % 4], Math.PI / 2 + 0.05 * (i - 1)); m.rotation.y = F.rot; }
    }
  }
  function fascines(c, g) {
    const F = frame(c), hw = 3, p = c.state === "done" ? 1 : c.prog;
    if (c.state === "done" && c.obs === "moat" && c.filledDrawn !== false) return; // (the castle draws the finished fill)
    seed = c.id * 577 + 7;
    const mid = F.L / 2, lip = Math.max(map.h(c.ax, c.ay), map.h(c.bx, c.by)) - 0.2, bottom = Math.min(lip - 1, map.h(c.mx, c.my));
    const top = bottom + (lip - bottom) * Math.min(1, p * 1.05), rows = Math.max(1, Math.ceil((top - bottom) / 0.42));
    const span = (F.L - 4) / 2 + 0.6;
    for (let r = 0; r < rows; r++) {
      const z = bottom + 0.22 + r * 0.42; if (z > top + 0.1) break;
      for (let v = -hw + 0.3; v < hw; v += 0.46) bundle(g, F, mid + (rnd() - 0.5) * 0.8, v, z, span * 2 * (0.85 + rnd() * 0.2), 0.42, BRUSH[Math.floor(rnd() * 3)], (rnd() - 0.5) * 0.12);
    }
    if (p < 1) for (let k = 0; k < Math.ceil((1 - p) * 8); k++) bundle(g, F, -2.5 - (k % 3) * 0.5, -hw - 1.5 - Math.floor(k / 3) * 0.5, map.h(...F.at(-2.5, -hw - 1.5)) + 0.22 + (k % 2) * 0.4, 2.6, 0.42, BRUSH[k % 3], 0);
  }

  // a house's timber bridge (js/sim/bridges.js) is a building: the realm's browser sees buildings, not w.crossings — it is
  // drawn from the building's own record (b.br), rising with b.progress; once it stands its deck is laid on this map too, so
  // the men walking over it are drawn on its planks
  const decked = new Map(); // building id → the map cells under its deck as they were
  function withBridges(w) {
    const X = w.crossings || [], out = X.slice();
    for (const b of w.buildings || []) {
      if (!b.br || X.some((c) => c.bld === b.id)) continue;
      const c = { ...b.br, id: 1e6 + b.id, kind: "trestle", team: b.team, mx: (b.br.ax + b.br.bx) / 2, my: (b.br.ay + b.br.by) / 2, prog: Math.min(1, b.progress || 0), state: b.ruin ? "burnt" : b.progress >= 1 ? "done" : "building" };
      if (c.state === "done" && !decked.has(b.id)) decked.set(b.id, deckMap(map, c));
      if (c.state === "burnt" && decked.get(b.id)) { for (const [k, h, d] of decked.get(b.id)) { map.height[k] = h; map.waterDepth[k] = d; } decked.set(b.id, null); }
      out.push(c);
    }
    return out;
  }
  function sync(w) {
    const live = new Set();
    for (const c of withBridges(w)) {
      live.add(c.id);
      const key = `${c.state}|${Math.floor((c.state === "done" ? 1 : c.prog) * STEPS)}`;
      const cur = have.get(c.id);
      if (cur && cur.key === key) continue;
      if (cur) { root.remove(cur.g); }
      const g = new THREE.Group(); g.name = `crossing-${c.id}`;
      if (c.kind === "trestle") trestle(c, g); else fascines(c, g);
      root.add(g); have.set(c.id, { key, g });
    }
    for (const [id, cur] of have) if (!live.has(id)) { root.remove(cur.g); have.delete(id); }
  }
  return { sync, root };
}
