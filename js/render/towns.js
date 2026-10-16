// The towns on the ground (render only): a plan read from the land (js/sim/settle.js) has no streets painted into the
// map's surface, so they are painted here as the town comes to be — its LANES trodden into the grass (village street or
// track, by their width), the TOFT of every cottage that stands trodden yard and its CROFT a kitchen garden — in the
// terrain's own surface layers (the same textures the map's old villages are painted with). And a daughter settlement's
// CAMP: the settlers' tents, a cooking fire and the carts by the site of the hall while it is built.
import * as THREE from "three";

// paint(key, poly | null, pts | null, width): the surface painter main.js hands over (it owns the surface id texture)
export function makeTownGround({ scene, map, paintPoly, paintLine, flush }) {
  const done = new Set(); // what has been painted: "lane:<plan>:<i>", "toft:<plan>:<i>"
  const camps = new Map(); // town id → group
  const canvasMat = new THREE.MeshStandardMaterial({ color: "#e7dcc0", roughness: 0.95, side: THREE.DoubleSide });
  const ropeMat = new THREE.MeshStandardMaterial({ color: "#6b5233", roughness: 1 });
  const fireMat = new THREE.MeshBasicMaterial({ color: "#ffb04a" });
  const cartMat = new THREE.MeshStandardMaterial({ color: "#6a4b2a", roughness: 0.9 });
  function tent(s = 1) {
    const g = new THREE.Group();
    const shape = new THREE.Shape([new THREE.Vector2(-1.6 * s, 0), new THREE.Vector2(1.6 * s, 0), new THREE.Vector2(0, 2.1 * s)]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 3.6 * s, bevelEnabled: false }); geo.translate(0, 0, -1.8 * s);
    g.add(new THREE.Mesh(geo, canvasMat));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4 * s, 5), ropeMat); pole.position.set(0, 1.2 * s, 1.85 * s); g.add(pole);
    return g;
  }
  function camp(D) {
    const g = new THREE.Group(), h = (k) => ((Math.sin(k * 12.9898 + D.x * 0.01 + D.y * 0.013) * 43758.5453) % 1 + 1) % 1;
    const n = Math.max(6, Math.min(14, Math.round((D.settlers || 24) / 3)));
    const cx = D.x + Math.cos(D.rot || 0) * 30, cy = D.y + Math.sin(D.rot || 0) * 30; // (beside the hall's ground, not on it)
    for (let k = 0; k < n; k++) {
      const a = k / n * 2 * Math.PI + h(k) * 0.4, r = 12 + h(k + 7) * 10, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r, t = tent(0.9 + h(k + 3) * 0.3);
      t.position.set(x, map.h(x, y) - 0.05, -y); t.rotation.y = -a + Math.PI / 2; g.add(t);
    }
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.9, 6), fireMat); fire.position.set(cx, map.h(cx, cy) + 0.4, -cy); g.add(fire);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.18, 5, 10), ropeMat); ring.rotation.x = Math.PI / 2; ring.position.set(cx, map.h(cx, cy) + 0.1, -cy); g.add(ring);
    for (let k = 0; k < 2; k++) { const x = cx + 22 + k * 5, y = cy - 8 + k * 3, c = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 1.6), cartMat); c.position.set(x, map.h(x, y) + 0.9, -y); c.rotation.y = 0.4 + k * 0.3; g.add(c); for (const s of [-1, 1]) { const wh = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.08, 4, 10), ropeMat); wh.position.set(x + s * 0.9, map.h(x, y) + 0.55, -y + 0.85); g.add(wh); } }
    return g;
  }
  // sync: towns = [{ id, x, y, state, plan (the town spec: lanes, plots), built: Set of plot indexes with a standing house }]
  function sync(towns) {
    let dirty = false;
    for (const T of towns) {
      const P = T.plan; if (!P) continue;
      const pk = T.id || `seat${T.team ?? 0}`;
      (P.lanes || []).forEach((L, i) => { const k = `lane:${pk}:${i}`; if (done.has(k)) return; done.add(k); dirty = true; paintLine(L.pts, L.width >= 5 ? "village_street" : "dirt_track", Math.max(3.2, L.width)); });
      if (P.green?.poly && !done.has(`green:${pk}`)) { done.add(`green:${pk}`); dirty = true; paintPoly(P.green.poly, "short_meadow"); }
      (P.plots || []).forEach((p, i) => {
        if (!T.built?.has(i)) return; const k = `toft:${pk}:${i}`; if (done.has(k)) return; done.add(k); dirty = true;
        paintPoly(p.toft, "trampled_ground"); if (p.croft) paintPoly(p.croft, "kitchen_garden");
      });
    }
    if (dirty) flush();
    // the settlers' camps
    const live = new Set();
    for (const T of towns) if (T.id && T.state === "camp") {
      live.add(T.id);
      if (!camps.has(T.id)) { const g = camp(T); scene.add(g); camps.set(T.id, g); }
    }
    for (const [id, g] of camps) if (!live.has(id)) { scene.remove(g); camps.delete(id); }
  }
  return { sync };
}
