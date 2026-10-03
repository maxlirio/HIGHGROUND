// Gathering lane B: forestry — its render side (docs/gathering-plan.md; the sim is js/sim/jobs/forestry.js).
//   • a felled tree: its standing instance is hidden (props.setTree), and it COMES DOWN — the same model, tipped about
//     its foot along the fall line (slow at first, then fast, a bounce as the crown hits), a burst of leaves and dust;
//     it lies there with its crown crushed into the ground until the limbers have it
//   • limbed ("logs"): the trunk bucked into logs lying end to end along the fall line, the brushwood heaped where the
//     crown was; the logs go as the skidders drag them off (item.n)
//   • the stump (its cut face pale, a strip of the hinge standing), the brushwood rotting away; saplings (the tree's own
//     model, small, props.setTree) growing up beside it until the tree stands again
//   • the saw-pit by a lumber camp: the pit, its spoil banks, trestles over it, sawdust, the log on the trestles while
//     there is one; the fresh boards stacked on stickers beside it (a labour item: PIECE.boardstack)
// Everything here is read from w.labor.items (kind tree / stump / sawpit / boardstack: st, t0, n, rot), which the realm
// syncs; species, size and height come from the standing trees the props already hold (the map's vegetation).
import * as THREE from "three";
import { PIECE, MARK, COL, logGeo, tint, merge } from "../labor.js";
import { CARRY_PART } from "../figures.js";
import { loadAsset } from "../props.js";
import { groundH, restPose } from "../terrain.js";
import { TREES, FALL_S, clearCells, buildingRects, inRects, rectsBox, GRUB_PAD, BUILT_YARD, setFootprints, footprintsSet, CROWN } from "../../sim/jobs/forestry.js";
import { BODY_R } from "../../sim/obstacles.js";
import { fellInfo, simOf } from "../flora.js"; // a re-skinned tree (beech over an oak_b…) falls as its own model

// ---------------------------------------------------------------- the labour-item tables
const nothing = () => { const g = new THREE.BufferGeometry(); for (const a of ["position", "normal", "color"]) g.setAttribute(a, new THREE.BufferAttribute(new Float32Array(9), 3)); return g; };
PIECE.tree = { geo: nothing, at: () => [0, -50, 0, 0] };      // (drawn here, not as a stack)
PIECE.stump = PIECE.tree; PIECE.sawpit = PIECE.tree;
function boardCourse() {   // one course of fresh boards on two stickers
  const g = [];
  for (let j = 0; j < 5; j++) g.push(tint(new THREE.BoxGeometry(3.4, 0.045, 0.25), "#d6b98a", 0.12, j).translate(0, 0.07, (j - 2) * 0.27));
  for (const x of [-1.25, 1.25]) g.push(tint(new THREE.BoxGeometry(0.06, 0.05, 1.4), "#9a7a55", 0.1).translate(x, 0.025, 0));
  return merge(g);
}
PIECE.boardstack = { geo: boardCourse, at: (k) => [(k % 2) * 0.04, k * 0.095, 0, ((k * 7) % 3 - 1) * 0.01] };
COL.tree = COL.log; COL.sawpit = COL.log; COL.boardstack = COL.planks; COL.stump = COL.log;
MARK.tree = 0; MARK.sawpit = 0; MARK.boardstack = 0;
CARRY_PART.boardstack = "planks";   // (a bundle of boards on the shoulder; a dragged tree is a log on a rope: render/labor.js)

// ---------------------------------------------------------------- procedural pieces
const BARK = "#5a4632", CUT = "#d9bd8c";
function stumpGeo() {   // radius 1, 0.55 high: bark round, the cut face pale with its rings, a sliver of hinge left standing
  const g = [];
  g.push(tint(new THREE.CylinderGeometry(0.97, 1.12, 0.55, 12, 1, true), BARK, 0.35).translate(0, 0.27, 0));
  g.push(tint(new THREE.CircleGeometry(0.97, 14).rotateX(-Math.PI / 2), CUT, 0.08).translate(0, 0.551, 0));
  g.push(tint(new THREE.RingGeometry(0.45, 0.52, 14).rotateX(-Math.PI / 2), "#b99a6a", 0.05).translate(0, 0.553, 0));
  g.push(tint(new THREE.RingGeometry(0.18, 0.22, 10).rotateX(-Math.PI / 2), "#b99a6a", 0.05).translate(0, 0.553, 0));
  g.push(tint(new THREE.BoxGeometry(0.16, 0.22, 1.3), "#c7a676", 0.1).translate(0.72, 0.64, 0));   // the hinge, toward the fall (+X)
  for (let j = 0; j < 4; j++) { const a = j * 1.7 + 0.4; g.push(tint(new THREE.CylinderGeometry(0.1, 0.32, 0.9, 5), BARK, 0.3, j).rotateZ(Math.PI / 2 - 0.35).rotateY(a).translate(Math.cos(a) * 1.05, 0.12, -Math.sin(a) * 1.05)); }   // root flares
  return merge(g);
}
function heapGeo() {    // the brushwood heaped up by the stump's crown end: a mound of crossed limbs and twigs, the leaves withering
  const g = []; let sd = 11;
  const r = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  for (let j = 0; j < 30; j++) {
    const L = 1.6 + r() * 2.4, rad = 0.03 + r() * 0.07, lay = Math.floor(j / 10), a = r() * 3.2;
    const c = new THREE.CylinderGeometry(rad * 0.6, rad, L, 5).rotateZ(Math.PI / 2 + (r() - 0.5) * 0.35).rotateY(a).translate((r() - 0.5) * 1.6 * (1 - lay * 0.3), 0.12 + lay * 0.28 + r() * 0.12, (r() - 0.5) * 1.3 * (1 - lay * 0.3));
    g.push(tint(c, j % 3 ? "#5c4a36" : "#6d5a42", 0.3, j));
  }
  for (let j = 0; j < 9; j++) g.push(tint(new THREE.IcosahedronGeometry(0.42, 0), r() < 0.5 ? "#6a6236" : "#7d6c44", 0.35, j).scale(1.2, 0.6, 1).translate((r() - 0.5) * 2.2, 0.35 + r() * 0.5, (r() - 0.5) * 1.5));
  return merge(g);
}
// the lop and top: the tree's own crown (its sparse model, leaves and all) lying where it fell, the trunk gone, crushed flat
function lopGeo(geo, H) {
  const src = geo.index ? geo.toNonIndexed() : geo.clone(), P = src.attributes.position.array, n = P.length / 9, keep = [];
  for (let t = 0; t < n; t++) if (Math.min(P[t * 9 + 1], P[t * 9 + 4], P[t * 9 + 7]) > H * 0.3) keep.push(t);
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    const k = attr.itemSize, arr = new attr.array.constructor(keep.length * 3 * k);
    keep.forEach((t, j) => arr.set(attr.array.subarray(t * 3 * k, (t + 1) * 3 * k), j * 3 * k));
    out.setAttribute(name, new THREE.BufferAttribute(arr, k, attr.normalized));
  }
  out.applyMatrix4(new THREE.Matrix4().makeRotationZ(-Math.PI / 2)); out.scale(0.8, 0.26, 0.85);
  out.computeBoundingBox(); out.translate(-H * 0.12, -out.boundingBox.min.y - 0.5, 0);
  return out;
}
function pitGeo() {     // a saw-pit 5.5 × 1.1 m along +X: the dark pit, its spoil banks, two trestles over it, sawdust
  const g = [];
  g.push(tint(new THREE.BoxGeometry(5.6, 0.04, 1.15), "#1e1812", 0.1).translate(0, 0.03, 0));
  for (const z of [-1, 1]) for (let j = 0; j < 7; j++) {   // the spoil banks: the pit's earth thrown up along both sides, in lumps
    const x = -2.7 + j * 0.9 + ((j * 37) % 5) * 0.06, sc = 0.55 + ((j * 13 + (z > 0 ? 3 : 0)) % 5) * 0.08;
    g.push(tint(new THREE.IcosahedronGeometry(1, 1), j % 2 ? "#5f4e39" : "#6b5a42", 0.3, j + (z > 0 ? 9 : 0)).scale(0.8 * sc + 0.15, 0.2 * sc, 0.6 * sc).translate(x, 0, z * 1.25 + ((j * 7) % 3 - 1) * 0.08));
  }
  for (const x of [-2.85, 2.85]) g.push(tint(new THREE.BoxGeometry(0.1, 0.1, 1.2), "#4a3a2a", 0.2).translate(x, 0.05, 0));   // the pit's end boards
  for (const x of [-1.9, 1.9]) {   // a trestle: two crossed legs each side, a bearer across the pit
    g.push(tint(new THREE.BoxGeometry(0.2, 0.16, 1.9), "#6b5238", 0.15).translate(x, 0.47, 0));
    for (const z of [-0.78, 0.78]) for (const t of [-0.3, 0.3]) g.push(tint(new THREE.BoxGeometry(0.09, 0.58, 0.09), "#5d4630", 0.2).rotateZ(t).translate(x, 0.24, z));
  }
  g.push(tint(new THREE.CircleGeometry(1.5, 12).rotateX(-Math.PI / 2), "#d8c49a", 0.15).scale(1.9, 1, 0.8).translate(0.5, 0.045, 0.2));   // sawdust
  for (let j = 0; j < 3; j++) g.push(tint(new THREE.BoxGeometry(2.8, 0.06, 0.28), "#b8966a", 0.2, j).rotateX(0.2).translate(-0.2 + j * 0.15, 0.1 + j * 0.06, -1.9 - j * 0.12));   // slabs by the pit
  return merge(g);
}

export function makeRender(scene, map, ctx) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  const mk = (geo, cap, mt = mat) => { const m = new THREE.InstancedMesh(geo, mt, cap); m.count = 0; m.frustumCulled = false; scene.add(m); return m; };
  const stumps = mk(stumpGeo(), 3000), heaps = mk(heapGeo(), 1500), logs = mk(logGeo(3.3, 1), 1500), pits = mk(pitGeo(), 64), pitLog = mk(logGeo(4.4, 0.25), 64);
  // puffs: leaves and dust thrown up where a crown lands (points, fading)
  const PN = 900, pgeo = new THREE.BufferGeometry(), ppos = new Float32Array(PN * 3), pcol = new Float32Array(PN * 3);
  pgeo.setAttribute("position", new THREE.BufferAttribute(ppos, 3).setUsage(THREE.DynamicDrawUsage));
  pgeo.setAttribute("color", new THREE.BufferAttribute(pcol, 3).setUsage(THREE.DynamicDrawUsage));
  const puffs = new THREE.Points(pgeo, new THREE.PointsMaterial({ size: 0.35, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
  puffs.frustumCulled = false; scene.add(puffs);
  const species = new Map();   // asset → { parts: [InstancedMesh], n } (the standing model, reused for the falling tree)
  function speciesOf(asset) {
    let S = species.get(asset); if (S) return S;
    S = { parts: null, lop: null, n: 0, nl: 0 }; species.set(asset, S);
    loadAsset(asset).then((l) => { const H = (fellInfo(asset) || TREES[asset] || { h: 15 }).h; S.parts = l[0].map(({ geo, mat: m }) => mk(geo, 48, m)); S.lop = l[1].map(({ geo, mat: m }) => mk(lopGeo(geo, H), 400, m)); }).catch(() => { S.parts = []; S.lop = []; });
    return S;
  }
  const d = new THREE.Object3D(), q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), m4 = new THREE.Matrix4(), mOwn = new THREE.Matrix4(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
  const treeCache = new Map();   // item id → the standing tree it was ({ asset, s, rot, H, r }) or null
  const applied = new Map();     // "x,y" → scale set on the prop (0 hidden, 1 back)
  const seenFall = new Set(), lyingAt = new Map();
  let props = null, lastScan = -1, lastVer = -1;
  const h = (x, y) => groundH(map, x, y);   // (the ground as drawn: terrain.js)

  function treeOf(it) {
    if (treeCache.has(it.id)) return treeCache.get(it.id);
    if (!props) return null;
    const ck = Math.floor(it.x / 200) * 1000 + Math.floor(it.y / 200);
    for (const [asset, k] of props.kinds) {
      const fi = fellInfo(asset); if (!fi) continue; const c = k.chunks.get(ck); if (!c) continue;
      const o = c.items.find((e) => Math.abs(e.x - it.x) < 0.06 && Math.abs(e.y - it.y) < 0.06);
      if (o) { const s = o.s0 ?? o.scale ?? 1, T = { asset, s, rot: o.rot || 0, H: fi.h * s, r: fi.r * s }; treeCache.set(it.id, T); return T; }
    }
    if (props.kinds.size > 3) treeCache.set(it.id, null);
    return null;
  }
  // the standing instances of felled trees: hidden, or a sapling's size, or back
  function syncProps(L) {
    const want = new Map();
    for (const it of L.items) {
      if (it.kind === "stump") { const s = /^s(\d)/.exec(it.st || ""); want.set(`${it.x},${it.y}`, [it.x, it.y, s ? 0.1 + 0.11 * +s[1] : 0]); }
      else if (it.kind === "tree") want.set(`${it.x},${it.y}`, [it.x, it.y, 0]);
    }
    for (const [key, [x, y, s]] of want) if (applied.get(key) !== s && props.setTree(x, y, s)) applied.set(key, s);
    for (const [key] of applied) if (!want.has(key)) { const [x, y] = key.split(",").map(Number); props.setTree(x, y, 1); applied.delete(key); }
  }

  // a realm client has no sim: its map's canopy (the Cover / Line of sight overlays, the ground's cover under the pointer)
  // is thinned here from the stumps it is sent, the same way the server's sim does it (sim/jobs/forestry.js clearCells)
  let cList = null, cKey = null, cN = -1; const cOn = new Set();
  function syncCanopyClient(w, L) {
    if (w.obstacles?.veg || !w.map?.canopyGrid) return;   // (the sim keeps its own map's canopy)
    let n = 0; for (const k of props.kinds.values()) n += k.all.length;
    if (n !== cN) { cN = n; cList = []; cKey = new Map(); for (const k of props.kinds.values()) for (const o of k.all) { cKey.set(`${Math.round(o.x * 10)},${Math.round(o.y * 10)}`, cList.length); cList.push({ x: o.x, y: o.y, asset: simOf(k.asset), scale: o.s0 ?? o.scale ?? 1 }); } cOn.clear(); }
    const want = new Set();
    for (const it of L.items) if (it.kind === "stump" || it.kind === "tree") { const q = cKey.get(`${Math.round(it.x * 10)},${Math.round(it.y * 10)}`); if (q !== undefined) want.add(q); }
    const dirty = []; for (const q of want) if (!cOn.has(q)) dirty.push(q); for (const q of cOn) if (!want.has(q)) dirty.push(q);
    if (!dirty.length) return;
    clearCells(w.map, cList, (q) => want.has(q), dirty); cOn.clear(); for (const q of want) cOn.add(q);
  }

  // a building's ground: the map's plants standing on it are grubbed (the sim takes their trunks: sim/jobs/forestry.js
  // grubBuildings — the same rects), its yard's undergrowth and forage bushes go (flora.js), once per building; it holds for
  // props that load later. Realm clients (no sim) and the single-player world alike: read off w.buildings.
  const grubbed = new Set(); let fpLoad = null, grubT = -1;
  const isPlant = (a) => simOf(a) in BODY_R || simOf(a) in CROWN || a === "berry_bush";
  function grubProps(w) {
    if (!footprintsSet()) { fpLoad ||= fetch("assets/footprints.json").then((r) => r.ok ? r.json() : null).then(setFootprints).catch(() => {}).finally(() => { fpLoad = true; }); if (fpLoad !== true) return; }
    for (const b of w.buildings || []) {
      if (b.field || grubbed.has(b.id)) continue; grubbed.add(b.id);
      const R = buildingRects(b, GRUB_PAD), Y = buildingRects(b, BUILT_YARD);
      props.clearArea((x, y) => inRects(R, x, y), { only: isPlant, box: rectsBox(R), under: (x, y) => inRects(Y, x, y), ubox: rectsBox(Y) });
    }
  }

  function update(w, cam, { dt = 0.016 } = {}) {
    const L = w.labor; props ||= globalThis.HG?.props || null;
    const now = performance.now();
    if (props && w.buildings && now - grubT > 1000) { grubT = now; grubProps(w); }
    if (!L || !props) return;
    if (L.ver !== lastVer || now - lastScan > 700) { lastVer = L.ver; lastScan = now; syncProps(L); syncCanopyClient(w, L); }
    let ns = 0, nb = 0, nl = 0, np = 0, npl = 0;
    for (const S of species.values()) { S.n = 0; S.nl = 0; }
    lyingAt.clear(); for (const it of L.items) if (it.kind === "tree") lyingAt.set(`${it.x},${it.y}`, it);
    for (const it of L.items) {
      if (it.kind === "sawpit") {
        const [hp, pitch] = restPose(map, it.x, it.y, it.rot, 2.8, 0.9, 0.02);   // (5.6 m long: it lies along a slope, never off it)
        d.position.set(it.x, hp, -it.y); d.rotation.set(0, it.rot, pitch, "YZX"); d.scale.set(1, 1, 1); d.updateMatrix(); pits.setMatrixAt(np++, d.matrix);
        if (it.n > 0) { d.position.set(it.x, hp + 0.8, -it.y); d.updateMatrix(); pitLog.setMatrixAt(npl++, d.matrix); }
        continue;
      }
      if (it.kind !== "tree" && it.kind !== "stump") continue;
      const T = treeOf(it); if (!T) continue;
      const c = Math.cos(it.rot), s = Math.sin(it.rot), hb = h(it.x, it.y);
      if (it.kind === "stump") {
        if (it.st === "gone") continue;
        const age = /^s(\d)/.exec(it.st || ""); if (age && +age[1] > 3) continue;   // (rotted away under the young tree)
        if (ns < 3000) { d.position.set(it.x, hb - 0.12, -it.y); d.rotation.set(0, it.rot, 0); d.scale.set(T.r, age ? 0.8 : 1, T.r); d.updateMatrix(); stumps.setMatrixAt(ns++, d.matrix); }
        // the crown lies where it fell once the limbers have it off (not while the tree still lies there whole), until
        // it is heaped; the heap rots under the saplings
        const f = T.H * 0.62, bx = it.x + c * f, by = it.y + s * f, k = T.H / 19;
        if (it.st === "stump") {
          const lying = lyingAt.get(`${it.x},${it.y}`), S = speciesOf(T.asset);
          if ((!lying || lying.st === "logs") && S.lop && S.nl < 400) {
            q.setFromAxisAngle(Y, it.rot); v3.set(it.x + c * T.r, h(bx, by), -(it.y + s * T.r)); s3.setScalar(T.s); m4.compose(v3, q, s3);
            for (const P of S.lop) P.setMatrixAt(S.nl, m4);
            S.nl++;
          }
        } else if ((it.st === "heap" || (age && +age[1] <= 2)) && nb < 1500) {
          const sh = age ? 0.75 - 0.2 * +age[1] : 1;
          d.position.set(bx, h(bx, by) - 0.1, -by); d.rotation.set(0, it.rot, 0); d.scale.set(k, k * sh, k); d.updateMatrix(); heaps.setMatrixAt(nb++, d.matrix);
        }
        continue;
      }
      // a tree coming down / lying / bucked into logs
      if (it.st === "logs") {
        const n = Math.max(2, it.n || 0), row = Math.min(4, n);
        for (let k = 0; k < n && nl < 1500; k++) {
          const r = T.r * 0.85 * (1 - 0.1 * Math.min(k, 4));
          let along = 0.9 + T.r + (k + 0.5) * 3.45, across = 0;
          if (k >= row) { along = 0.9 + T.r + ((k - row) % 3 + 0.5) * 3.45; across = (1 + Math.floor((k - row) / 3)) * 2 * r * 1.05 * (k % 2 ? 1 : -1); }
          const x = it.x + c * along - s * across, y = it.y + s * along + c * across;
          const hx0 = h(x - c * 1.6, y - s * 1.6), hx1 = h(x + c * 1.6, y + s * 1.6);
          d.position.set(x, (hx0 + hx1) / 2 + r * 0.92, -y); d.rotation.set(0, it.rot + ((k * 5) % 3 - 1) * 0.04, Math.atan2(hx1 - hx0, 3.2), "YZX"); d.scale.set(1, r, r); d.updateMatrix(); logs.setMatrixAt(nl++, d.matrix);
        }
        continue;
      }
      const S = speciesOf(T.asset); if (!S.parts || S.n >= 48) continue;
      // at rest the trunk lies along the ground (the crown props it up a little); falling: slow at first, then fast,
      // a bounce as the crown hits
      const tipX = it.x + c * T.H * 0.6, tipY = it.y + s * T.H * 0.6;
      const rest = Math.PI / 2 + Math.atan2(hb - h(tipX, tipY), T.H * 0.6) - 0.05;
      let th = rest, kick = 0;
      const ft = it.st === "falling" ? (w.time - (it.t0 || 0)) / FALL_S : 9;
      if (ft < 1) th = rest * Math.max(0, ft) ** 2.3;
      else if (ft < 1.4) { const u = (ft - 1) / 0.4; th = rest - 0.07 * Math.sin(Math.PI * u) * (1 - u); kick = 0.5 * Math.min(1, u * 3); }
      else kick = 0.5;
      if (ft >= 0.97 && !seenFall.has(it.id)) { seenFall.add(it.id); if (ft < 3) burst(tipX, tipY, T.H); }
      // the crown crushes as it hits (its branches break under it): squashed toward the ground, sunk a little
      const crush = ft < 1 ? 1 : 1 - 0.42 * Math.min(1, (ft - 1) / 0.3);
      q.setFromAxisAngle(Y, it.rot); q2.setFromAxisAngle(Z, -th); q.multiply(q2);
      v3.set(it.x - c * kick, hb - 0.15 - 0.25 * Math.min(1, th / rest) - (1 - crush) * 1.2, -(it.y - s * kick)); s3.set(T.s * crush, T.s, T.s);
      m4.compose(v3, q, s3); mOwn.makeRotationY(T.rot - it.rot); m4.multiply(mOwn);
      for (const P of S.parts) P.setMatrixAt(S.n, m4);
      S.n++;
    }
    stumps.count = ns; heaps.count = nb; logs.count = nl; pits.count = np; pitLog.count = npl;
    for (const m of [stumps, heaps, logs, pits, pitLog]) m.instanceMatrix.needsUpdate = true;
    for (const S of species.values()) { if (S.parts) for (const P of S.parts) { P.count = S.n; P.instanceMatrix.needsUpdate = true; } if (S.lop) for (const P of S.lop) { P.count = S.nl; P.instanceMatrix.needsUpdate = true; } }
    tickPuffs(Math.min(0.1, dt));
  }
  // ---- the puff when a crown lands: leaves and dust thrown up and drifting down
  const pv = new Float32Array(PN * 3), plife = new Float32Array(PN); let pk = 0, live = 0;
  const leaf = [new THREE.Color("#58682f"), new THREE.Color("#7c7a45"), new THREE.Color("#a89a74")];
  function burst(x, y, H) {
    const hy = h(x, y);
    for (let j = 0; j < 160; j++) {
      const i = pk; pk = (pk + 1) % PN; const a = Math.random() * 6.283, r = Math.random() * H * 0.25;
      ppos[i * 3] = x + Math.cos(a) * r; ppos[i * 3 + 1] = hy + 0.5 + Math.random() * 2; ppos[i * 3 + 2] = -(y + Math.sin(a) * r);
      pv[i * 3] = Math.cos(a) * (1 + Math.random() * 3); pv[i * 3 + 1] = 2 + Math.random() * 4; pv[i * 3 + 2] = -Math.sin(a) * (1 + Math.random() * 3);
      const col = leaf[j % 3]; pcol[i * 3] = col.r; pcol[i * 3 + 1] = col.g; pcol[i * 3 + 2] = col.b; plife[i] = 2.2 + Math.random() * 1.5;
    }
    live = 4;
  }
  function tickPuffs(dt) {
    if (live <= 0) { pgeo.setDrawRange(0, 0); return; }
    live -= dt;
    for (let i = 0; i < PN; i++) {
      if (plife[i] <= 0) { ppos[i * 3 + 1] = -1e4; continue; }
      plife[i] -= dt; pv[i * 3 + 1] -= 3.5 * dt; pv[i * 3] *= 1 - 1.5 * dt; pv[i * 3 + 2] *= 1 - 1.5 * dt; if (pv[i * 3 + 1] < -1.2) pv[i * 3 + 1] = -1.2;
      ppos[i * 3] += pv[i * 3] * dt; ppos[i * 3 + 1] += pv[i * 3 + 1] * dt; ppos[i * 3 + 2] += pv[i * 3 + 2] * dt;
    }
    pgeo.setDrawRange(0, PN); pgeo.attributes.position.needsUpdate = true; pgeo.attributes.color.needsUpdate = true;
  }
  return { update };
}
