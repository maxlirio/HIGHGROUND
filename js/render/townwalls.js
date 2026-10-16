// A town's walls as places men stand on (js/sim/townwall.js). The walks themselves are in the wall models — the
// palisade's plank fighting step on its posts (assets/src/palisade.py), the stone curtain's wall-walk behind its
// merlons (wall_stone.py), the gate tower's platform, the gatehouse's roof-walk, the watchtower's hoarded platform. This
// module adds:
//   · the WAY UP: a ladder against the fighting step every 18 m, a stone stair up the curtain's inner face every 36 m,
//     the ladder in the gate tower and the watchtower, the stairs behind the gatehouse — where the sim's links are, so the
//     men are seen to climb what they climb (a breached or unfinished stretch's way up is taken away with it);
//   · the FIGURE HOOK: w.castleLevelH(i), a man's height above the terrain (figures.js adds it), so the men up there
//     stand on the planks at the deck's height and not in the ground behind the stakes. (A world with a castle has
//     render/castle.js's hook, which reads the same heights through castle.js levelHeight.)
// makeTownWalls(scene, map) → { group, update(w) }
import * as THREE from "three";
import { layer, drawHeight, refreshTown } from "../sim/townwall.js";

export function makeTownWalls(scene, map) {
  const group = new THREE.Group(); group.name = "townwalls"; scene.add(group);
  const wood = new THREE.MeshStandardMaterial({ color: "#6e5537", roughness: 0.92 });
  const stone = new THREE.MeshStandardMaterial({ color: "#8f887b", roughness: 0.96 });
  let sig = null, hooked = null;
  const V = (x, y, z) => new THREE.Vector3(x, z, -y); // sim (x, y, height) → three
  // a box into a flat triangle list: centre c, axes (unit) a, b, n and half sizes
  function box(P, N, c, a, b, n, ha, hb, hn) {
    const corner = (sa, sb, sn) => c.clone().addScaledVector(a, sa * ha).addScaledVector(b, sb * hb).addScaledVector(n, sn * hn);
    const faces = [[a, [1, 0]], [a.clone().negate(), [-1, 0]], [b, [0, 1]], [b.clone().negate(), [0, -1]], [n, [2, 1]], [n.clone().negate(), [2, -1]]];
    for (const [nrm, [ax, s]] of faces) {
      let q;
      if (ax === 1 || ax === -1) q = [corner(ax, -1, -1), corner(ax, 1, -1), corner(ax, 1, 1), corner(ax, -1, 1)];
      else if (ax === 0) q = [corner(-1, s, -1), corner(1, s, -1), corner(1, s, 1), corner(-1, s, 1)];
      else q = [corner(-1, -1, s), corner(1, -1, s), corner(1, 1, s), corner(-1, 1, s)];
      // wind each quad to face its normal
      const e1 = q[1].clone().sub(q[0]), e2 = q[2].clone().sub(q[0]); if (e1.cross(e2).dot(nrm) < 0) q.reverse();
      for (const k of [0, 1, 2, 0, 2, 3]) { P.push(q[k].x, q[k].y, q[k].z); N.push(nrm.x, nrm.y, nrm.z); }
    }
  }
  const mesh = (P, N, mat) => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3)); const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; return m; };
  function rebuild(L) {
    for (const c of [...group.children]) { group.remove(c); c.geometry?.dispose(); }
    const PW = [], NW = [], PS = [], NS = [];
    for (const T of L.links) {
      if (T.gone || T.a.lvl !== 0) continue;
      const hd = L.nodes[T.b.node], fx = T.a.x, fy = T.a.y, F = V(fx, fy, map.h(fx, fy)), H = T.rh ? V(T.rh[0], T.rh[1], hd.z) : V(hd.x, hd.y, hd.z); // (a stair's top step lands beside the walk)
      const d = H.clone().sub(F), len = d.length(), u = d.clone().normalize();
      const side = new THREE.Vector3(0, 1, 0).cross(u).normalize(); // (horizontal, across the ladder)
      if (T.kind === "ladder") {
        const n = u.clone().cross(side).normalize(), top = 0.55; // (the rails stand a little above the deck: a hand-hold to step off by)
        for (const s of [-0.24, 0.24]) box(PW, NW, F.clone().addScaledVector(u, (len + top) / 2).addScaledVector(side, s), u, side, n, (len + top) / 2, 0.035, 0.035);
        for (let r = 0.3; r < len; r += 0.32) box(PW, NW, F.clone().addScaledVector(u, r), side, u, n, 0.24, 0.022, 0.022);
      } else {
        // a straight stone stair: steps of ~0.28 m, each a block down to the ground, against the wall
        const dxy = new THREE.Vector3(u.x, 0, u.z).normalize(), run = Math.hypot(d.x, d.z), rise = d.y, nst = Math.max(3, Math.round(rise / 0.28)), up = new THREE.Vector3(0, 1, 0);
        for (let k = 0; k < nst; k++) {
          const f = (k + 0.5) / nst, cx = F.x + d.x * f, cz = F.z + d.z * f, topY = F.y + rise * (k + 1) / nst, g = map.h(cx, -cz) - 0.2;
          box(PS, NS, new THREE.Vector3(cx, (topY + g) / 2, cz), dxy, side, up, run / nst / 2 + 0.02, 0.55, Math.max(0.1, (topY - g) / 2));
        }
      }
    }
    if (PW.length) group.add(mesh(PW, NW, wood));
    if (PS.length) group.add(mesh(PS, NS, stone));
  }
  // THE CUT-AWAY: the men on a watchtower's platform or a timber gate's fighting platform stand under its roof — seen from
  // above they would be hidden. While anyone is up there and the camera is near, that building's model is cut by a
  // clipping plane a man's height over the platform (its own clone of the material: the other towers keep their roofs)
  const cut = new Map(); // bid → { obj, mats: [[mesh, original material]] }
  function cutAway(w, L, group, camera) {
    if (!group) return;
    const want = new Map(), S = w.S, near = camera?.st ? camera.st.dist < 320 : true;
    if (near) for (const p of L.parts) {
      if ((p.kind !== "wtower" && p.kind !== "gtop") || !p.top) continue;
      const r = p.rect; let up = false;
      for (let i = 0; i < S.n && !up; i++) if (S.alive[i] && S.lvl[i] === 2 && Math.abs(S.x[i] - r.cx) < r.hw + 1.5 && Math.abs(S.y[i] - r.cy) < r.hw + 1.5) up = true;
      if (up) want.set(p.bid, p.top.z + 1.75);
    }
    for (const [bid, C] of cut) if (!want.has(bid) || !C.obj.parent) { for (const [m, mat] of C.mats) { m.material.dispose(); m.material = mat; } cut.delete(bid); }
    if (!want.size) return;
    for (const obj of group.children) {
      const bid = obj.userData.bid; if (bid === undefined || !want.has(bid)) continue;
      if (cut.has(bid) && cut.get(bid).obj === obj) { for (const [m] of cut.get(bid).mats) m.material.clippingPlanes[0].constant = want.get(bid); continue; }
      const mats = []; obj.traverse((m) => { if (!m.isMesh) return; const c = m.material.clone(); c.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), want.get(bid))]; mats.push([m, m.material]); m.material = c; });
      cut.set(bid, { obj, mats });
    }
  }
  let lastR = 0, lastC = 0;
  function update(w, { buildings = null, camera = null } = {}, now = performance.now()) {
    if (!w.buildings?.length || !w.S) return;
    const L = now - lastR > 1000 ? (lastR = now, refreshTown(w)) : layer(w); // (breaches, a stretch fired: the realm client's mirror runs no sim)
    if (!L.edges.length) { if (group.children.length) rebuild({ links: [], nodes: [] }); sig = null; return; }
    // the figure hook (a castle's renderer installs its own, which reads the same heights)
    if (hooked !== w && !w.castleLevelH) { w.castleLevelH = (i) => drawHeight(w, i) || (w.siege?.climbH?.get(i) ?? 0); hooked = w; }
    const s = L.sig + ":" + L.goneVer + ":" + L.edges.length;
    if (s !== sig) { sig = s; rebuild(L); }
    if (buildings && (now - lastC > 150)) { lastC = now; cutAway(w, L, buildings, camera); }
  }
  return { group, update };
}
