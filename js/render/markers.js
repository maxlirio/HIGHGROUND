// Ground markers: where you clicked (pulsing ring while choosing an order), a ping when an order is
// given, and for selected troops the route they will take and a flag where they are going.
import * as THREE from "three";

export function makeMarkers(scene, map) {
  const ringGeo = new THREE.RingGeometry(0.82, 1, 48); ringGeo.rotateX(-Math.PI / 2);
  const mk = (color) => new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false }));
  const pend = mk("#ffd35a"); pend.visible = false; pend.renderOrder = 10; scene.add(pend);
  const pendDot = new THREE.Mesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#ffd35a", transparent: true, opacity: 0.9, depthTest: false }));
  pendDot.visible = false; pendDot.renderOrder = 10; scene.add(pendDot);
  const pings = [];
  // route lines for selected units (one LineSegments, rebuilt each frame)
  const MAXV = 4096;
  const lineGeo = new THREE.BufferGeometry(); const lp = new Float32Array(MAXV * 3);
  lineGeo.setAttribute("position", new THREE.BufferAttribute(lp, 3).setUsage(THREE.DynamicDrawUsage));
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineDashedMaterial({ color: "#ffe39a", dashSize: 6, gapSize: 4, transparent: true, opacity: 0.6, depthTest: false }));
  lines.renderOrder = 9; lines.frustumCulled = false; scene.add(lines);
  const flags = [];
  let pendAt = null, t = 0;
  // town-plan overlay: outlines of the plots where the chosen building may go (green free, grey taken)
  const planGeo = new THREE.BufferGeometry(); const pp = new Float32Array(20000 * 3), pc = new Float32Array(20000 * 3);
  planGeo.setAttribute("position", new THREE.BufferAttribute(pp, 3)); planGeo.setAttribute("color", new THREE.BufferAttribute(pc, 3));
  const planLines = new THREE.LineSegments(planGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthTest: false }));
  planLines.renderOrder = 11; planLines.frustumCulled = false; planLines.visible = false; scene.add(planLines);
  const ghostMat = new THREE.LineBasicMaterial({ color: "#fff2a8", transparent: true, depthTest: false });
  const ghost = new THREE.LineLoop(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(33 * 3), 3)), ghostMat);
  ghost.renderOrder = 12; ghost.frustumCulled = false; ghost.visible = false; scene.add(ghost);
  function setGhost(g) { // g = {x,y,rot,w,h} | {x1,y1,x2,y2} | null — the building's real footprint where it would go
    if (!g) { ghost.visible = false; return; }
    const P = ghost.geometry.attributes.position.array; let pts;
    if (g.x1 !== undefined) { const L = Math.hypot(g.x2 - g.x1, g.y2 - g.y1) || 1, nx = -(g.y2 - g.y1) / L * 1.6, ny = (g.x2 - g.x1) / L * 1.6; pts = [[g.x1 + nx, g.y1 + ny], [g.x2 + nx, g.y2 + ny], [g.x2 - nx, g.y2 - ny], [g.x1 - nx, g.y1 - ny]]; }
    else { const c = Math.cos(g.rot || 0), s = Math.sin(g.rot || 0), hw = g.w / 2, hh = g.h / 2; pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([a, b]) => [g.x + a * c - b * s, g.y + a * s + b * c]); }
    let v = 0; for (let k = 0; k < 4; k++) { const [ax, ay] = pts[k], [bx, by] = pts[(k + 1) % 4]; for (let j = 0; j < 8; j++) { const t = j / 8, x = ax + (bx - ax) * t, y = ay + (by - ay) * t; P.set([x, map.h(x, y) + 1.5, -y], v * 3); v++; } }
    P.set(P.slice(0, 3), v * 3); ghost.geometry.setDrawRange(0, 33); ghost.geometry.attributes.position.needsUpdate = true; ghost.visible = true;
  }
  function setPlan(slots) {
    if (!slots) { planLines.visible = false; return; }
    let v = 0; const push = (x, y, c) => { if (v >= 20000) return; pp.set([x, map.h(x, y) + 1.2, -y], v * 3); pc.set(c, v * 3); v++; };
    for (const s of slots) {
      if (s.taken && (s.type === "yard" || s.type === "tower")) continue; // used spots just disappear
      const c = s.taken ? [0.45, 0.45, 0.45] : [0.45, 1, 0.45];
      if (s.x1 !== undefined) {
        const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) || 1, nx = -(s.y2 - s.y1) / L, ny = (s.x2 - s.x1) / L, n = 8;
        for (const off of [-1.6, 0, 1.6]) for (let k = 0; k < n; k++) { const a = k / n, b = (k + 1) / n; push(s.x1 + (s.x2 - s.x1) * a + nx * off, s.y1 + (s.y2 - s.y1) * a + ny * off, c); push(s.x1 + (s.x2 - s.x1) * b + nx * off, s.y1 + (s.y2 - s.y1) * b + ny * off, c); }
        continue;
      }
      if (s.type === "yard" || s.type === "tower") { // free spots: a small ring, not a box
        const r = 2.2, n = 10; for (let k = 0; k < n; k++) { const a = k / n * 6.283, b2 = (k + 1) / n * 6.283; push(s.x + Math.cos(a) * r, s.y + Math.sin(a) * r, c); push(s.x + Math.cos(b2) * r, s.y + Math.sin(b2) * r, c); }
        continue;
      }
      const co = Math.cos(s.rot || 0), si = Math.sin(s.rot || 0), hw = Math.max(1, s.w / 2 - 1.2), hh = Math.max(1, s.h / 2 - 1.2); // drawn inset: neat gaps between plots
      const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([a, b]) => [s.x + a * co - b * si, s.y + a * si + b * co]);
      for (let k = 0; k < 4; k++) { const [ax, ay] = corners[k], [bx, by] = corners[(k + 1) % 4]; const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 12)); for (let j = 0; j < n; j++) { push(ax + (bx - ax) * j / n, ay + (by - ay) * j / n, c); push(ax + (bx - ax) * (j + 1) / n, ay + (by - ay) * (j + 1) / n, c); } }
    }
    planGeo.setDrawRange(0, v); planGeo.attributes.position.needsUpdate = planGeo.attributes.color.needsUpdate = true; planLines.visible = true;
  }

  const put = (m, x, y, lift = 1) => m.position.set(x, map.h(x, y) + lift, -y);

  return {
    setPlan, setGhost,
    pending(x, y) { pendAt = { x, y }; },
    clearPending() { pendAt = null; },
    ping(x, y) { const m = mk("#fff2c4"); m.renderOrder = 10; scene.add(m); pings.push({ m, x, y, age: 0 }); },
    update(dt, w, selected, camDist, chainPts = null) {
      t += dt; const s = camDist / 70; // marker size tracks zoom so it's always visible
      pend.visible = pendDot.visible = !!pendAt;
      if (pendAt) {
        put(pend, pendAt.x, pendAt.y); pend.scale.setScalar(s * (1.6 + 0.35 * Math.sin(t * 6)));
        put(pendDot, pendAt.x, pendAt.y); pendDot.scale.setScalar(s * 0.35);
      }
      for (let i = pings.length - 1; i >= 0; i--) {
        const p = pings[i]; p.age += dt; put(p.m, p.x, p.y); p.m.scale.setScalar(s * (1 + p.age * 4)); p.m.material.opacity = Math.max(0, 1 - p.age / 0.8);
        if (p.age > 0.8) { scene.remove(p.m); p.m.material.dispose(); pings.splice(i, 1); }
      }
      // routes + destination flags for the selected units
      let v = 0, f = 0;
      for (const id of selected) {
        const u = w.units.get(id); if (!u || !u.path || !u.path.length) continue;
        let px = u.ax, py = u.ay;
        for (const [qx, qy] of u.path) {
          if (v + 2 > MAXV) break;
          lp.set([px, map.h(px, py) + 2, -py, qx, map.h(qx, qy) + 2, -qy], v * 3); v += 2; px = qx; py = qy;
        }
        let fl = flags[f]; if (!fl) { fl = mk("#ffe39a"); fl.renderOrder = 10; scene.add(fl); flags.push(fl); }
        fl.visible = true; put(fl, px, py); fl.scale.setScalar(s * 0.9); f++;
      }
      // command chain: line through every queued step, a ring at each
      if (chainPts && chainPts.length > 1) {
        for (let k = 0; k + 1 < chainPts.length && v + 2 <= MAXV; k++) {
          const [ax, ay] = chainPts[k], [bx, by] = chainPts[k + 1];
          lp.set([ax, map.h(ax, ay) + 2, -ay, bx, map.h(bx, by) + 2, -by], v * 3); v += 2;
        }
        for (let k = 1; k < chainPts.length; k++) {
          let fl = flags[f]; if (!fl) { fl = mk("#ffe39a"); fl.renderOrder = 10; scene.add(fl); flags.push(fl); }
          fl.visible = true; put(fl, chainPts[k][0], chainPts[k][1]); fl.scale.setScalar(s * 1.1); f++;
        }
      }
      for (let k = f; k < flags.length; k++) flags[k].visible = false;
      lineGeo.setDrawRange(0, v); lineGeo.attributes.position.needsUpdate = true;
      if (v) lines.computeLineDistances();
      lines.material.dashSize = s * 2; lines.material.gapSize = s * 1.4;
    },
  };
}
