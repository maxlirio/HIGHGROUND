// The WORKSHOPS lane, render side (docs/gathering-plan.md, "Workshops"): every workshop and training ground at work, its trade's own
// scene. Pure render; it reads only w.buildings (and b.wk on a realm mirror: js/sim/jobs/workshops.js activity), the
// labour core's men (their station poses, synced to the sim's step clock) and the camera — so a realm client draws
// the same. Everything here is near the camera only (figures range); nothing at the Eagle view.
//   • the crew at their stations are real villagers (the sim puts them there; figures.js draws them in the trade's clip
//     with its kit) — this file adds their furniture and what their work throws off: sparks off the anvil at each blow,
//     the forge's glow, quench steam, chips off the mason's chisel, arrows flying to the butts and standing in them,
//     the loom's beater, a stool under every man who sits, the bow rack, the engine growing in the siege shed, the
//     mill's wheel turning
//   • only people the sim really has, drawn as render-only actors (figures.extras): the recruits in a training queue
//     (their real number, b.wk.c) at the butts, in the muster yard, before the keep and riding round the stables' yard,
//     and the squire at the tilt (b.tilt / knights in training). Nobody else (the owner: "the animations should be of
//     REAL serfs ... the number of people working is equal to the number of serfs assigned"): no clerks at the keep's
//     desks, no adepts at the ley stone, no miller, no grooms — a study, the ley stone and the mill show their lamps,
//     glow and wheel; a mount being broken stands in the yard, the house's real stock
import * as THREE from "three";
import { tint, merge } from "../labor.js";
import { POSE_KIT, SYNCED, FIG_FAR } from "../figures.js";
import { STATIONS, BUTTS, ENGINE_OF, local, activity } from "../../sim/jobs/workshops.js";
import { BUILDINGS, ROLE } from "../../sim/econ-data.js";
import { S_WORK as S_WORK_ } from "../../sim/soldiers.js";
const MASON = ROLE.mason;
import { loadAsset } from "../props.js";
import { hMirror, groundH } from "../terrain.js";
import { padBase } from "../pads.js";
const bldBase = (map, b) => padBase(b) ?? hMirror(map, b.x, b.y) - 0.15; // (the building's floor: its levelled pad — js/render/pads.js)

// ---------------------------------------------------------------- the trade clips (assets/src/units/_lane_workshops.py)
Object.assign(POSE_KIT, { work_anvil: ["hammer", "tongs"], work_sledge: ["sledge"], work_bellows: [], work_shovel: ["shovel"], work_rake: ["rake"],
  work_fletch: [], work_string: ["stave"], work_loom: [], work_spin: ["distaff"], work_chisel: ["chisel", "maul"], work_write: ["quill"],
  work_lectern: [], walk_lead: [], idle_lead: [], work_loose: ["bow"] });
// clip lengths (s) of the poses whose beats this file follows; they play on the sim's step clock (figures SYNCED)
const DUR = { work_anvil: 12 / 9, work_sledge: 12 / 9, work_bellows: 12 / 8, work_loom: 16 / 6, work_loose: 2.4, work_chisel: 12 / 9 };
for (const k of Object.keys(DUR)) SYNCED.add(k);
const HITS = { work_anvil: [6 / 12, 10 / 12], work_sledge: [6 / 12], work_chisel: [5 / 12, 10 / 12], work_loose: [0.70] };

const hs = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };
const fr = (x) => ((x % 1) + 1) % 1;
const NEAR = FIG_FAR + 20;   // scenes are built and actors drawn only this close (figures range)
const CUT = { blacksmith: 1, bloomery: 1, charcoal_kiln: 1, fletcher: 1, weaver: 1, siege_workshop: 1, archery_range: 1, barracks: 1, stables: 1, town_hall: 1, mage_tower: 1, mill: 1, mint: 1 };

// ---------------------------------------------------------------- furniture (three.js local: x along the building, y up, z = -(its y))
const T_ = (g, c, v = 0.15, s = 1) => tint(g, c, v, s);
const box = (w, h, d, c, x, y, z, ry = 0) => T_(new THREE.BoxGeometry(w, h, d), c).rotateY(ry).translate(x, y, z);
const cyl = (r0, r1, h, c, x, y, z, seg = 8) => T_(new THREE.CylinderGeometry(r0, r1, h, seg), c).translate(x, y, z);
const WOOD = "#6b5138", DARK = "#4a3a2a", PALE = "#a88a62";
function stool(x, z) { const g = [cyl(0.17, 0.17, 0.05, PALE, x, 0.45, z)]; for (let k = 0; k < 3; k++) { const a = k * 2.094; g.push(cyl(0.025, 0.03, 0.45, DARK, x + Math.cos(a) * 0.11, 0.22, z + Math.sin(a) * 0.11, 5)); } return g; }
function bench(x, z, L, ry = 0) { const g = [box(L, 0.06, 0.5, PALE, 0, 0.78, 0)]; for (const s of [-1, 1]) g.push(box(0.08, 0.76, 0.42, DARK, s * (L / 2 - 0.12), 0.38, 0)); return merge(g).rotateY(ry).translate(x, 0, z); }
// a treadle loom: posts, breast and back beams, the warp running back, the cloth on the breast beam; the weaver sits at +z
function loomFrame() {
  const g = [];
  for (const x of [-0.62, 0.62]) for (const z of [-0.45, 0.45]) g.push(box(0.09, 1.55, 0.09, WOOD, x, 0.78, z));
  g.push(box(1.36, 0.08, 0.1, WOOD, 0, 0.84, 0.42)); g.push(box(1.36, 0.08, 0.1, WOOD, 0, 0.84, -0.42)); g.push(box(1.36, 0.08, 0.08, WOOD, 0, 1.55, 0));
  g.push(box(1.1, 0.012, 0.86, "#d8cfb8", 0, 0.86, 0)); g.push(cyl(0.07, 0.07, 1.12, "#7a4a3a", 0, 0.83, 0.47).rotateZ(Math.PI / 2).translate(0, 0, 0));
  for (const x of [-0.25, 0.25]) g.push(box(0.08, 0.04, 0.6, DARK, x, 0.1, 0.2));   // treadles
  return merge(g);
}
function loomBeater() { return merge([box(1.16, 0.06, 0.06, DARK, 0, -0.62, 0), box(0.05, 0.66, 0.05, DARK, -0.56, -0.31, 0), box(0.05, 0.66, 0.05, DARK, 0.56, -0.31, 0)]); }
function bowRack() {
  const g = [box(1.6, 0.08, 0.08, WOOD, 0, 1.55, 0), box(1.6, 0.08, 0.12, WOOD, 0, 0.12, 0.15)];
  for (const s of [-1, 1]) { g.push(box(0.08, 1.6, 0.08, WOOD, s * 0.78, 0.8, -0.1).rotateX(0.12)); g.push(box(0.08, 1.6, 0.08, WOOD, s * 0.78, 0.8, 0.35).rotateX(-0.12)); }
  for (let k = 0; k < 6; k++) { const x = -0.6 + k * 0.24, pts = []; for (let j = 0; j <= 6; j++) { const u = j / 6; pts.push(new THREE.Vector3(x, 0.2 + u * 1.6, 0.18 + 0.1 * Math.sin(u * Math.PI))); }
    g.push(T_(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 6, 0.018, 4), k % 2 ? "#a26a3a" : "#8a5a32").translate(0, 0, 0)); }
  return merge(g);
}
function sheaf(x, z) { const g = []; for (let k = 0; k < 9; k++) { const a = k * 2.399, r = 0.04 * Math.sqrt(k); g.push(cyl(0.006, 0.006, 0.8, "#b89a6a", x + Math.cos(a) * r, 0.4, z + Math.sin(a) * r, 3)); g.push(box(0.03, 0.08, 0.002, "#e8e2d2", x + Math.cos(a) * r, 0.78, z + Math.sin(a) * r, a)); } return g; }
function desk(x, z) { return [box(0.75, 0.05, 0.5, PALE, x, 0.76, z).rotateX(-0.18), box(0.06, 0.74, 0.06, DARK, x - 0.32, 0.37, z - 0.2), box(0.06, 0.74, 0.06, DARK, x + 0.32, 0.37, z - 0.2),
  box(0.06, 0.74, 0.06, DARK, x - 0.32, 0.37, z + 0.2), box(0.06, 0.74, 0.06, DARK, x + 0.32, 0.37, z + 0.2), box(0.3, 0.012, 0.22, "#efe6cf", x - 0.05, 0.795, z - 0.01).rotateX(-0.18),
  cyl(0.03, 0.03, 0.06, "#2a2018", x + 0.28, 0.82, z - 0.15, 6)]; }
function lectern(x, z) { return [cyl(0.05, 0.08, 1.05, DARK, x, 0.53, z), box(0.55, 0.04, 0.42, PALE, x, 1.1, z).rotateX(-0.5).translate(0, 0, 0), box(0.46, 0.06, 0.32, "#6a2a22", x, 1.14, z - 0.01).rotateX(-0.5), cyl(0.25, 0.3, 0.06, DARK, x, 0.03, z)]; }
function booth() {   // the clerks' writing booth before the hall: posts, a canvas awning, two desks and stools, a lectern, books, candles
  const g = [];
  for (const [x, z] of [[-1.9, -0.9], [1.9, -0.9], [-1.9, 1.2], [1.9, 1.2]]) g.push(box(0.1, 2.5, 0.1, WOOD, x, 1.25, z));
  g.push(box(4.1, 0.04, 2.5, "#d9cfb2", 0, 2.45, 0.15).rotateX(0.12)); g.push(box(4.1, 0.6, 0.02, "#b33a2a", 0, 2.15, 1.42));
  g.push(...desk(-1.1, 0), ...stool(-1.1, 0.45), ...desk(0.1, 0), ...stool(0.1, 0.45), ...lectern(1.3, 0.1));
  for (let k = 0; k < 4; k++) g.push(box(0.26, 0.06, 0.2, ["#6a2a22", "#3a4a2a", "#4a3a6a", "#7a5a2a"][k], 1.75, 0.03 + k * 0.065, -0.5, k * 0.3));
  return merge(g);
}
function stump() { return merge([cyl(0.3, 0.34, 0.8, "#5a4630", 0, 0.4, 0, 9), T_(new THREE.DodecahedronGeometry(0.16, 0), "#3a2a24").scale(1.3, 0.6, 1).translate(0, 0.86, 0)]); }
function quintain() { return merge([cyl(0.09, 0.12, 2.3, WOOD, 0, 1.15, 0)]); }
function quintainArm() { return merge([box(1.6, 0.08, 0.08, WOOD, 0.3, 0, 0), box(0.06, 0.6, 0.45, "#b33a2a", 1.05, -0.05, 0), cyl(0.12, 0.16, 0.35, "#9a8a6a", -0.55, -0.35, 0, 6)]); }
function arrowGeo() { return merge([cyl(0.006, 0.006, 0.8, "#b89a6a", 0, 0, 0, 3).rotateZ(Math.PI / 2), box(0.12, 0.05, 0.002, "#e8e2d2", -0.33, 0, 0), box(0.12, 0.002, 0.05, "#e8e2d2", -0.33, 0, 0)]); }
// the adepts' tower, where no model of it exists: coursed ashlar (the castle kit's own texture), a parapet, a slate cone
const texL = new THREE.TextureLoader(), texC = new Map();
function ctex(name, rx, ry, srgb) { const k = `${name}|${rx}|${ry}`; if (!texC.has(k)) { const t = texL.load(`assets/tex/castle/${name}.jpg`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; texC.set(k, t); } return texC.get(k); }
const stoneMat = (name, rx, ry) => new THREE.MeshStandardMaterial({ map: ctex(`${name}_albedo`, rx, ry, true), normalMap: ctex(`${name}_normal`, rx, ry, false), roughness: 0.9, metalness: 0 });
function tower() {
  const g = new THREE.Group(), add = (geo, m) => { const o = new THREE.Mesh(geo, m); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
  add(new THREE.CylinderGeometry(3.75, 3.95, 15, 28, 1, true).translate(0, 7.5, 0), stoneMat("ashlar", 4, 2.5));
  add(new THREE.CylinderGeometry(4.0, 4.0, 0.4, 28).translate(0, 15.2, 0), stoneMat("ashlar", 4, 0.1));
  const mer = []; for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8; mer.push(new THREE.BoxGeometry(0.95, 0.95, 0.5).rotateY(a).translate(Math.sin(a) * 3.75, 15.85, Math.cos(a) * 3.75)); }
  add(merge(mer.map((m, k) => T_(m, "#a39a86", 0.15, k))), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  add(new THREE.ConeGeometry(3.55, 6.2, 28, 1, true).translate(0, 18.5, 0), stoneMat("slate", 3, 1.5));
  add(merge([box(1.3, 2.4, 0.4, "#3a2a1e", 0, 1.2, 3.78), cyl(0.05, 0.05, 1.4, "#3a3a3a", 0, 22.2, 0, 4),
    ...[0, 1, 2, 3, 4, 5].map((k) => { const a = k * 1.047 + 0.4; return box(0.4, 1.1, 0.3, "#1e1a16", Math.sin(a) * 3.82, 6 + (k % 3) * 3, Math.cos(a) * 3.82, a); })]), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  return g;
}
function leyStone() { const g = T_(new THREE.CylinderGeometry(0.32, 0.55, 2.4, 7, 4), "#7e7a70", 0.35).translate(0, 1.2, 0); const P = g.attributes.position; for (let k = 0; k < P.count; k++) { const y = P.getY(k); P.setX(k, P.getX(k) * (1 + 0.12 * Math.sin(y * 3 + k))); P.setZ(k, P.getZ(k) * (1 + 0.1 * Math.cos(y * 2.3 + k))); } g.computeVertexNormals(); return merge([g.rotateZ(0.05)]); }

// where each building's furniture goes and what it is (building frame, sim local x/y)
function furniture(kind) {
  const g = [];
  const at = (geo, lx, ly, ry = 0) => g.push(geo.rotateY(ry).translate(lx, 0, -ly));
  const D = STATIONS[kind];
  if (D) for (const s of D.st) if (s.prop === "stool") g.push(...stool(s.x, -s.y));
  if (kind === "fletcher") { at(bowRack(), -2.1, -3.45); g.push(...sheaf(-0.9, 2.95 - 0.154)); }
  if (kind === "weaver") at(loomFrame(), 3.0, -3.3, Math.PI);
  if (kind === "bloomery") at(stump(), 2.4, -1.32);
  if (kind === "town_hall") at(booth(), 7.0, -5.7, Math.PI);
  if (kind === "stables") at(quintain(), 5.0, -9.4);
  if (kind === "mage_tower") at(leyStone(), 0, -8.6);
  return g.length ? merge(g) : null;
}

// ---------------------------------------------------------------- particles: sparks and glows (additive), steam and dust
function makeParts(scene, additive, cap, size) {
  const P = new Float32Array(cap * 3), C = new Float32Array(cap * 4), V = new Float32Array(cap * 3), L = new Float32Array(cap * 2);
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(P, 3)); geo.setAttribute("color", new THREE.BufferAttribute(C, 4));
  const cv = document.createElement("canvas"); cv.width = cv.height = 32; const x = cv.getContext("2d"), gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.4, "rgba(255,255,255,0.6)"); gr.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
  const mat = new THREE.PointsMaterial({ size, map: new THREE.CanvasTexture(cv), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
  const col = []; let n = 0;
  return {
    add(x, h, y, vx, vy, vz, life, r, g, b, a = 1) { if (n >= cap) return; const o = n++; P.set([x, h, -y], o * 3); V.set([vx, vz, -vy], o * 3); L[o * 2] = 0; L[o * 2 + 1] = life; col[o] = [r, g, b, a]; },
    update(dt, grav) {
      for (let k = 0; k < n; k++) {
        L[k * 2] += dt; const t = L[k * 2] / L[k * 2 + 1];
        if (t >= 1) { n--; if (k < n) { P.copyWithin(k * 3, n * 3, n * 3 + 3); V.copyWithin(k * 3, n * 3, n * 3 + 3); L[k * 2] = L[n * 2]; L[k * 2 + 1] = L[n * 2 + 1]; col[k] = col[n]; } k--; continue; }
        V[k * 3 + 1] -= grav * dt; P[k * 3] += V[k * 3] * dt; P[k * 3 + 1] += V[k * 3 + 1] * dt; P[k * 3 + 2] += V[k * 3 + 2] * dt;
        const c = col[k], f = additive ? 1 - t : (1 - t) * Math.min(1, t * 6); C[k * 4] = c[0] * (additive ? f : 1); C[k * 4 + 1] = c[1] * (additive ? f : 1); C[k * 4 + 2] = c[2] * (additive ? f : 1); C[k * 4 + 3] = c[3] * f;
      }
      pts.visible = n > 0; if (!n) return;
      geo.setDrawRange(0, n); geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    },
    get n() { return n; },
  };
}

// ---------------------------------------------------------------- the renderer
export function makeRender(scene, map, { figures = null } = {}) {
  if (typeof location !== "undefined" && /[?&]noworkshops\b/.test(location.search)) return { update() {} };   // (A/B: tools/bench-render.mjs --extra "&noworkshops")
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  const group = new THREE.Group(); scene.add(group);
  const sparks = makeParts(scene, true, 600, 0.09), glows = makeParts(scene, true, 300, 0.9), smoke = makeParts(scene, false, 400, 0.7);
  const arrowsI = new THREE.InstancedMesh(arrowGeo(), mat, 400); arrowsI.count = 0; arrowsI.frustumCulled = false; scene.add(arrowsI);
  const beaters = new THREE.InstancedMesh(loomBeater(), mat, 40); beaters.count = 0; beaters.frustumCulled = false; scene.add(beaters);
  const qarms = new THREE.InstancedMesh(quintainArm(), mat, 20); qarms.count = 0; qarms.frustumCulled = false; scene.add(qarms);
  // the masons' bankers: a block on a low trestle before each mason dressing stone at a stone building's site (figures: the "dress" kit)
  const bankers = new THREE.InstancedMesh(merge([box(0.62, 0.38, 0.42, "#b9b1a0", 0, 0.66, 0), box(0.7, 0.08, 0.5, WOOD, 0, 0.43, 0), box(0.08, 0.42, 0.42, DARK, -0.28, 0.2, 0), box(0.08, 0.42, 0.42, DARK, 0.28, 0.2, 0)]), mat, 80); bankers.count = 0; bankers.frustumCulled = false; scene.add(bankers);
  const sites = new Map();   // building id → { sig, obj, eng?, … }
  const prevPh = new Map(), flights = [], tilt = new Map();
  const d = new THREE.Object3D(), B = { x: 0, y: 0, yaw: 0, fade: 0 };
  let slowT = -1e9, near = [];
  const engines = new Map();   // engine GLB name → Promise<lods>
  const engineLods = (name) => { if (!engines.has(name)) engines.set(name, loadAsset(name).catch(() => null)); return engines.get(name); };

  // the engine on the siege shed's floor, cut off at the batch's progress (a world clipping plane: renderer.localClippingEnabled)
  function engineSite(S, b, h0, name) {
    if (S.engName === name) return; S.engName = name;
    if (S.eng) { S.obj.remove(S.eng); S.eng = null; }
    engineLods(name).then((L) => {
      if (!L || S.engName !== name || !sites.has(b.id)) return;
      const g = new THREE.Group(), plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
      for (const { geo, mat: m } of L[0]) { const mm = m.clone(); mm.clippingPlanes = [plane]; mm.clipShadows = true; const me = new THREE.Mesh(geo, mm); me.userData.shared = true; me.castShadow = true; g.add(me); }
      const bb = new THREE.Box3().setFromObject(g), sz = bb.getSize(new THREE.Vector3());
      const long = sz.x >= sz.z ? sz.x : sz.z, wide = sz.x >= sz.z ? sz.z : sz.x, sc = Math.max(0.45, Math.min(1, 7.5 / long, 3.4 / wide, 6.3 / sz.y));
      const holder = new THREE.Group(); holder.add(g); g.scale.setScalar(sc); if (sz.z > sz.x) g.rotation.y = Math.PI / 2;
      const c = bb.getCenter(new THREE.Vector3()); g.position.set(-c.x * sc, -bb.min.y * sc, -c.z * sc); if (sz.z > sz.x) g.position.set(-c.z * sc, -bb.min.y * sc, c.x * sc);
      holder.position.set(-6.0, 0, -2.3); S.obj.add(holder); S.eng = holder; S.plane = plane; S.engH = sz.y * sc; S.cutH = 0;
    });
  }
  // the mill's undershot wheel turns: its vertices (assets/src/mill.py: centre (2.63, 0.30, 2.55), axle along x, r 2.28) rotate in the
  // vertex shader about the axle, on this mill's own copy of the model's material
  const WHEEL = { c: new THREE.Vector3(2.63, 2.55, -0.30), x0: 1.98, x1: 3.28, r: 2.34 };
  function patchMill(b, S) {
    if (S.millObj?.parent) return;
    const objs = []; scene.traverse((o) => { if (o.isMesh && o.userData.bid === b.id && o.parent?.userData?.bid === b.id) objs.push(o); });
    if (!objs.length) return; S.millObj = objs[0];
    S.millU = { value: 0 };
    for (const o of objs) {
      const m = o.material.clone(), U = S.millU;
      m.onBeforeCompile = (sh) => { sh.uniforms.wheelA = U;
        sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float wheelA;").replace("#include <begin_vertex>", `#include <begin_vertex>
          { vec3 q = transformed - vec3(${WHEEL.c.x.toFixed(2)}, ${WHEEL.c.y.toFixed(2)}, ${WHEEL.c.z.toFixed(2)}); float rr = length(q.yz);
            if (transformed.x > ${WHEEL.x0.toFixed(2)} && transformed.x < ${WHEEL.x1.toFixed(2)} && rr < ${WHEEL.r.toFixed(2)} && transformed.y > 0.2) { float c = cos(wheelA), s = sin(wheelA);
              transformed.yz = vec2(${WHEEL.c.y.toFixed(2)}, ${WHEEL.c.z.toFixed(2)}) + vec2(c * q.y - s * q.z, s * q.y + c * q.z); } }`); };
      m.customProgramCacheKey = () => "hg-millwheel"; o.material = m;
    }
  }

  // ---- render-only actors (figures.extras)
  const X = figures?.extras || [];
  const actor = (key, x, y, face, clip, phase, kit, team, seed, more) => { X.push({ key, x, y, face, clip, phase, kit, team, seed, ...more }); };
  function scenes(w, b, wk, now, cam) {
    const team = b.team, rot = b.rot || 0, P = (lx, ly) => local(b, lx, ly), A = (a) => a + rot, id = b.id;
    const q = wk?.q, c = Math.min(wk?.c || 0, 16);
    // -- the archery range: recruits on the line (after the practising villagers), loosing at the butts
    if (b.kind === "archery_range" && q === "archers") {
      const st = STATIONS.archery_range.st, from = Math.min(st.length, wk.n || 0);
      for (let k = 0; k < Math.min(c, st.length - from); k++) {
        const s = st[from + k], [x, y] = P(s.x, s.y), cyc = 3.0 + hs(id, k) * 0.8, t = fr(now / cyc + hs(k, id)) * cyc, ph = Math.min(0.999, t / 1.78);
        actor("archers", x, y, A(0), "shoot", ph, ["bow", "hat"], team, id * 97 + k);
        shoot(`a${id}:${k}`, ph, 0.64, x, y, b, s);
      }
    }
    // -- the muster hall: by the arm in training
    if (b.kind === "barracks" && q) {
      const L = (bx, by) => P(bx - 0.153, by - 0.367);
      if (q === "menatarms") {
        const pells = [[0.2, -2.3], [1.5, -3.0], [-0.85, -2.75]];
        for (let k = 0; k < Math.min(c, 3); k++) { const [x, y] = L(pells[k][0], pells[k][1] - 0.95), cyc = 1.5 + 0.2 * hs(id, k), t = fr(now / cyc + hs(k, 3)) * cyc;
          actor("menatarms", x, y, A(Math.PI / 2), hs(k, Math.floor(now / cyc + hs(k, 3))) < 0.5 ? "strike" : "strike2", Math.min(0.999, t / 0.91), ["sword", "shield"], team, id * 89 + k); }
        for (let k = 3; k < Math.min(c, 9); k++) { const j = k - 3, pair = j >> 1, side = j & 1, [x, y] = L(-5.6 + side * 1.6, -1.9 - pair * 1.0), cyc = 1.8, t = fr(now / cyc + pair * 0.37 + side * 0.5) * cyc;
          actor("menatarms", x, y, A(side ? Math.PI : 0), t < 0.91 ? "strike" : "guard", t < 0.91 ? t / 0.91 : fr(now / 2), ["sword", "shield"], team, id * 89 + k); }
      } else if (q === "crossbow") {
        for (let k = 0; k < Math.min(c, 4); k++) { const [x, y] = L(-1.6 - (k >> 1) * 1.2, k & 1 ? -3.35 : -2.0), cyc = 1.2 + 3.43 + 0.6, t = fr(now / cyc + hs(id, k)) * cyc;
          actor("crossbow", x, y, A(Math.PI), t < 1.2 ? "shoot" : t < 4.63 ? "reload" : "idle", t < 1.2 ? t / 1.2 : t < 4.63 ? (t - 1.2) / 3.43 : fr(now / 3), ["bow", "helm"], team, id * 83 + k); }
      } else drill(b, wk, now, (bx, by) => L(bx, by), A, -7.0, 2.5, team, false);
    }
    // -- before the keep: the levy's rough drill (and whatever else the keep is training)
    if (b.kind === "town_hall" && q) drill(b, wk, now, (bx, by) => P(bx - 2.59, by + 0.25), A, 2.0, 13.0, team, true, -10.2);   // (beyond the clerks' booth)
    // (no clerks at the keep's desks, no adepts at the ley stone: nobody the sim has is there — their lamps and the glow show the work)
    // -- the stables: the riders in training (their real number, up to 3) walking their horses round the yard; a mount
    //    being broken (b.train: the house's own) standing in the yard; the squire at the tilt
    // -- the stables: the men learning to ride (economy.js practice), each at the head of one of the house's own horses
    //    (the sim lets a man train only with a horse in store for him: STATIONS.stables, wk.n of them at their places)
    if (b.kind === "stables" && wk?.n) for (let k = 0; k < Math.min(wk.n, STATIONS.stables.st.length); k++) {
      const s = STATIONS.stables.st[k], [hx, hy] = P(s.x + 0.9, s.y - 0.9); actor("horse_light", hx, hy, A(Math.PI), "idle", fr(now / 2.667 + k * 0.37), [], team, id * 61 + k);
    }
    if (b.kind === "stables" && (q || wk?.tr || wk?.t)) {
      const hk = wk.mt === "strider" || wk.mt === "drake" ? `horse_${wk.mt}` : q === "knights" ? "horse_destrier" : "horse_light";
      const n = q && q !== "knights" ? Math.min(c, 3) : 0;
      for (let k = 0; k < n; k++) {   // an oval in the open yard (stables.py: x -5..4, y -6..-2), each rider facing the way he rides
        const v = 1.3, per = 2 * Math.PI * 3.0 / v, a = (now / per + k / n) * 2 * Math.PI, cx = -0.5 + 0.087, cy = -4.1 + 0.091;
        const lx = cx + Math.cos(a) * 3.6, ly = cy + Math.sin(a) * 1.5, hd = Math.atan2(Math.cos(a) * 1.5, -Math.sin(a) * 3.6);   // heading along the oval
        const [hx, hy] = P(lx, ly);
        actor(["hobelars", "scouts", "knights"].includes(q) ? q : "hobelars", hx, hy, A(hd), "ride", fr(now / 2.6 + k * 0.2), ["shield"], team, id * 53 + k, { horse: hk, hclip: "walk", hphase: fr(now * v / 1.483 / 1.05 + k * 0.3) });
      }
      if (wk.tr) { const [hx, hy] = P(-3.2, -3.0); actor(`horse_${wk.tr}`, hx, hy, A(0.3), "idle", fr(now / 2.667), [], team, id * 53 + 9); }
      if (wk.t || q === "knights") {   // the tilt: a run at the quintain down the lane before the stables, a walk back
        const RUN = 2.6, BACK = 9, cyc = RUN + BACK, t = fr(now / cyc) * cyc, x0 = -10, x1 = 9.5;
        let lx, ly, face, clip, hc, hp;
        if (t < RUN) { lx = x0 + (x1 - x0) * t / RUN; ly = -8.2; face = 0; clip = "ride_charge"; hc = "gallop"; hp = fr(now * 7.3 / 10.0 / 0.46); }
        else { const u = (t - RUN) / BACK; lx = x1 - (x1 - x0) * u; ly = -10.4; face = Math.PI; clip = "ride"; hc = "walk"; hp = fr(now * 2.2 / 1.483 / 1.05); }
        const [x, y] = P(lx, ly); actor("knights", x, y, A(face), clip, fr(now * 1.2), ["lance", "shield"], team, id * 47, { horse: "horse_destrier", hclip: hc, hphase: hp });
        const T0 = tilt.get(id) || { a: 0, v: 0, hit: false }; if (t < RUN && lx > 5 && !T0.hit) { T0.v = 9; T0.hit = true; } if (t >= RUN) T0.hit = false; tilt.set(id, T0);
      }
    }
    // (no miller: the wheel turns while it grinds; nobody the sim has works it)
  }
  // spearmen, pikemen, levy (and the rest) at drill: a file two deep, thrust — recover — step; the levy raggedly
  function drill(b, wk, now, L, A, xA, xB, team, rough, y0 = -7.0) {
    const q = wk.q, set = ["spearmen", "pikemen", "levy", "archers", "crossbow", "menatarms", "hobelars", "scouts"].includes(q) ? q : "levy";
    const n = Math.min(wk.c || 0, 14), per = Math.ceil(n / 2), sp = Math.min(1.2, (xB - xA) / Math.max(1, per));
    for (let k = 0; k < n; k++) {
      const rank = k % 2, file = k >> 1, jit = rough ? (hs(b.id, k) - 0.5) * 0.5 : 0, cyc = 2.4, off = rough ? hs(k, b.id) * 0.35 : 0, t = fr(now / cyc + off) * cyc;
      const step = 0.35 * Math.sin(Math.min(1, t / 0.9) * Math.PI);
      const [x, y] = L(xA + file * sp + jit, y0 - rank * 1.3 - step + (rough ? (hs(k, 9) - 0.5) * 0.4 : 0));
      const mounted = set === "hobelars" || set === "scouts";
      if (mounted) { actor(set, x, y, A(-Math.PI / 2), "ride", fr(now / 2.6 + k * 0.2), ["shield"], team, b.id * 37 + k, { horse: "horse_light", hclip: "idle", hphase: fr(now / 2.6 + k * 0.3) }); continue; }
      const clip = set === "archers" || set === "crossbow" ? (t < 1.8 ? "shoot" : "idle") : t < 0.91 ? "strike" : set === "pikemen" ? "level" : "guard";
      const ph = clip === "shoot" ? Math.min(0.999, t / 1.8) : clip === "strike" ? t / 0.91 : fr(now / 2);
      actor(set, x, y, A(-Math.PI / 2), clip, ph, set === "levy" ? ["spear", "cap"] : set === "pikemen" ? ["pike", "helm"] : set === "archers" ? ["bow", "hat"] : set === "crossbow" ? ["bow", "helm"] : ["shield"], team, b.id * 37 + k);
    }
  }
  // an arrow loosed at the butts (phase crossing the loose): it flies to the target in the shooter's lane
  function shoot(key, ph, at, x, y, b, s) {
    const p0 = prevPh.get(key); prevPh.set(key, ph);
    if (p0 === undefined || !(p0 < at && ph >= at) || flights.length > 120) return;
    const lane = BUTTS.reduce((best, t) => Math.abs(t[1] - s.y) < Math.abs(best[1] - s.y) ? t : best, BUTTS[0]);
    const [tx, ty] = local(b, lane[0], lane[1] + (hs(flights.length, 3) - 0.5) * 0.8);
    flights.push({ x0: x, y0: y, h0: groundH(map, x, y) + 1.45, x1: tx, y1: ty, h1: bldBase(map, b) + lane[2] + (hs(flights.length, 5) - 0.5) * 0.6, t0: performance.now() / 1000, bid: b.id });
  }

  function update(w, cam, { visible = null, now = 0, dt = 0.016 } = {}) {
    X.length = 0;
    const cx = cam.position.x, cy = -cam.position.z, seen = (x, y, t) => !visible || visible(x, y, t);
    if (now - slowT > 0.5 || now < slowT) { slowT = now; slow(w, cx, cy, seen); }
    let nb = 0, nq = 0, na = 0;
    for (const N of near) {
      const { b, wk, S } = N; if (!seen(b.x, b.y, b.team)) continue;
      scenes(w, b, wk, now, cam);
      const h0 = bldBase(map, b), on = !!wk?.on;
      // the forge's glow and the bloomery's, the quench's steam
      if (on && (b.kind === "blacksmith" || b.kind === "bloomery") && Math.random() < dt * 14) {
        const [gx, gy] = b.kind === "blacksmith" ? local(b, -2.2, 2.35) : local(b, 0.95, 0); glows.add(gx + (Math.random() - 0.5) * 0.5, h0 + (b.kind === "blacksmith" ? 1.0 : 0.35), gy + (Math.random() - 0.5) * 0.5, 0, 0, 0.15, 0.5, 1.0, 0.45, 0.12);
        if (b.kind === "bloomery" && Math.random() < 0.3) { const [tx, ty] = local(b, 0, 0); glows.add(tx, h0 + 2.2, ty, 0, 0, 0.6, 0.7, 1, 0.55, 0.15); sparks.add(tx, h0 + 2.2, ty, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, 2.5 + Math.random() * 2, 0.8, 1, 0.7, 0.3); }
      }
      if (on && b.kind === "mint" && Math.random() < dt * 8) { const [gx, gy] = local(b, -3.46, -0.65); glows.add(gx + (Math.random() - 0.5) * 0.6, h0 + 0.9 + Math.random() * 0.6, gy, 0, 0, 0.12, 0.5, 1.0, 0.5, 0.15); }   // (the melting hearth through the forge door: mint.py FORGE_DOOR_X)
      if (on && b.kind === "blacksmith" && (wk.n || 0) >= 4 && fr(now / 2.5 + b.id * 0.13) < dt / 2.5 * 3) { const [sx, sy] = local(b, -2.5, -2.23); for (let k = 0; k < 6; k++) smoke.add(sx + (Math.random() - 0.5) * 0.4, h0 + 0.7, sy + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 0.9 + Math.random() * 0.6, 1.6 + Math.random(), 0.92, 0.92, 0.94, 0.55); }
      if (on && b.kind === "mage_tower" && wk.a && Math.random() < dt * 8) { const [lx, ly] = local(b, 0, -8.6); glows.add(lx + (Math.random() - 0.5) * 0.6, h0 + 0.5 + Math.random() * 2.2, ly + (Math.random() - 0.5) * 0.6, 0, 0, 0.3, 1.4, 0.45, 0.65, 1.0); }
      if (b.kind === "town_hall" && wk?.s && Math.random() < dt * 6) for (const lx of [5.9, 7.1]) { const [x, y] = local(b, lx + 0.28, -5.7 - 0.15); glows.add(x, h0 + 0.92, y, 0, 0, 0.05, 0.4, 1, 0.75, 0.35); }
      // the loom's beater, swung in time with the weaver (her clip's beat: 6/16 .. 11/16)
      if (b.kind === "weaver" && S?.loomMen && nb < 40) {
        const k = S.loomMen(w), ph = k < 0 ? 0 : k; const sw = ph > 6 / 16 && ph < 11 / 16 ? Math.sin((ph - 6 / 16) / (5 / 16) * Math.PI) : 0;
        const [lx, ly] = local(b, 3.0, -3.3); d.position.set(lx, h0 + 1.55, -ly); d.rotation.set(0, (b.rot || 0) + Math.PI, 0); d.rotateX(-0.25 * sw); d.scale.setScalar(1); d.updateMatrix(); beaters.setMatrixAt(nb++, d.matrix);
      }
      // the siege shed's engine, cut at the batch's progress; the mill's wheel
      if (S?.eng && S.plane) { const want = on ? 0.06 + 0.94 * (wk.f || 0) : 0; S.cutH += (want - S.cutH) * Math.min(1, dt * 2); S.plane.constant = h0 + S.cutH * S.engH; S.eng.visible = S.cutH > 0.02; }
      if (b.kind === "mill" && S?.millU) S.millU.value -= dt * (on ? 0.9 : 0.55);   // (the wheel turns while the water flows: faster when the stones are grinding)
      // the quintain spins when struck
      if (b.kind === "stables" && nq < 20) { const T0 = tilt.get(b.id) || { a: 0, v: 0 }; T0.a += T0.v * dt; T0.v *= Math.exp(-dt * 1.2); tilt.set(b.id, T0);
        const [qx, qy] = local(b, 5.0, -9.4); d.position.set(qx, h0 + 2.05, -qy); d.rotation.set(0, (b.rot || 0) + T0.a + Math.PI / 2, 0); d.scale.setScalar(1); d.updateMatrix(); qarms.setMatrixAt(nq++, d.matrix); }
      // arrows standing in the butts: more as the shooting goes on, drawn out every few minutes
      if (b.kind === "archery_range" && on) for (let j = 0; j < 3; j++) {
        const m = Math.floor(fr(now / 150 + b.id * 0.1 + j * 0.3) * 14); for (let k = 0; k < m && na < 400; k++) {
          const t = BUTTS[j], [x, y] = local(b, t[0] - 0.1, t[1] + (hs(k, j) - 0.5) * 0.9); d.position.set(x, h0 + t[2] + (hs(j, k) - 0.5) * 0.8, -y);
          d.rotation.set(0, (b.rot || 0) + Math.PI + (hs(k, 7) - 0.5) * 0.15, (hs(k, 8) - 0.5) * 0.2 - 0.1); d.scale.setScalar(1); d.updateMatrix(); arrowsI.setMatrixAt(na++, d.matrix);
        }
      }
    }
    // the men at their stations: the blows' sparks and chips, their arrows (synced to the sim's step clock, as figures plays them)
    const L = w.labor;
    if (L && near.length) for (const [i, M] of L.men) {
      const pose = M.pose, hits = HITS[pose]; if (!hits) continue;
      if (!w.S.alive[i] || !figures?.bodyOf(i, B) || Math.hypot(B.x - cx, B.y - cy) > NEAR) continue;
      const ph = fr((w.time - M.t0) / DUR[pose]), p0 = prevPh.get(i); prevPh.set(i, ph);
      if (p0 === undefined) continue;
      const crossed = hits.some((h) => (p0 < h && ph >= h) || (p0 > ph && (h > p0 || ph >= h)));
      if (!crossed) continue;
      const f = B.yaw - Math.PI / 2, fx = Math.cos(f), fy = Math.sin(f), h = groundH(map, B.x, B.y);
      if (pose === "work_anvil" || pose === "work_sledge") { const ax = B.x + fx * 0.74, ay = B.y + fy * 0.74; for (let k = 0; k < 10; k++) sparks.add(ax, h + 0.9, ay, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, 1 + Math.random() * 2.5, 0.35 + Math.random() * 0.4, 1, 0.75, 0.3); }
      else if (pose === "work_chisel") { const ax = B.x + fx * 0.5, ay = B.y + fy * 0.5; for (let k = 0; k < 4; k++) smoke.add(ax, h + 0.9, ay, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 0.3, 0.9, 0.85, 0.82, 0.76, 0.5); }
      else if (pose === "work_loose") {
        const b = near.find((N) => N.b.kind === "archery_range" && Math.hypot(N.b.x - B.x, N.b.y - B.y) < 40)?.b;
        if (b && flights.length < 120) { const c0 = Math.cos(-(b.rot || 0)), s0 = Math.sin(-(b.rot || 0)), lyL = (B.x - b.x) * s0 + (B.y - b.y) * c0;
          const t = BUTTS.reduce((bb, T) => Math.abs(T[1] - lyL) < Math.abs(bb[1] - lyL) ? T : bb, BUTTS[0]), [tx, ty] = local(b, t[0], t[1] + (Math.random() - 0.5) * 0.8);
          flights.push({ x0: B.x, y0: B.y, h0: h + 1.45, x1: tx, y1: ty, h1: bldBase(map, b) + t[2] + (Math.random() - 0.5) * 0.6, t0: performance.now() / 1000 }); }
      }
    }
    // the masons at a stone site, each at his banker (single player: the roles are the sim's)
    let nk = 0;
    if (w.econ?.role && figures?.debug) for (const u of w.units.values()) {
      if (u.job?.kind !== "build" || !BUILDINGS[u.job.b?.kind]?.stone || Math.hypot(u.ax - cx, u.ay - cy) > NEAR) continue;
      for (const i of u.members) { if (nk >= 80 || w.S.state[i] !== S_WORK_ || w.econ.role.get(i) !== MASON || !figures.bodyOf(i, B)) continue;
        const f = B.yaw - Math.PI / 2, x = B.x + Math.cos(f) * 0.5, y = B.y + Math.sin(f) * 0.5; d.position.set(x, groundH(map, x, y), -y); d.rotation.set(0, B.yaw, 0); d.scale.setScalar(1); d.updateMatrix(); bankers.setMatrixAt(nk++, d.matrix); }
    }
    bankers.count = nk; bankers.visible = nk > 0; if (nk) bankers.instanceMatrix.needsUpdate = true;
    // arrows in the air
    const tn = performance.now() / 1000;
    for (let k = flights.length - 1; k >= 0; k--) {
      const F = flights[k], D = Math.hypot(F.x1 - F.x0, F.y1 - F.y0), T = D / 45, u = (tn - F.t0) / T;
      if (u >= 1 || na >= 400) { flights.splice(k, 1); continue; }
      const x = F.x0 + (F.x1 - F.x0) * u, y = F.y0 + (F.y1 - F.y0) * u, arc = 4 * u * (1 - u) * D * 0.05, hh = F.h0 + (F.h1 - F.h0) * u + arc, slope = (F.h1 - F.h0) / D + (1 - 2 * u) * 4 * 0.05;
      d.position.set(x, hh, -y); d.rotation.set(0, Math.atan2(F.y1 - F.y0, F.x1 - F.x0), Math.atan(slope)); d.scale.setScalar(1); d.updateMatrix(); arrowsI.setMatrixAt(na++, d.matrix);
    }
    beaters.count = nb; qarms.count = nq; arrowsI.count = na; for (const m of [beaters, qarms, arrowsI]) { m.visible = m.count > 0; if (m.visible) m.instanceMatrix.needsUpdate = true; }
    sparks.update(dt, 9.8); glows.update(dt, -0.2); smoke.update(dt, -0.05);
  }

  // the slow part (twice a second): which buildings are near, their furniture, the engine model, the mill's wheel
  function slow(w, cx, cy, seen) {
    near = [];
    const live = new Set();
    for (const b of w.buildings || []) {
      if (!CUT[b.kind] || b.ruin || b.progress < 1 || b.x1 !== undefined) continue;
      if (Math.hypot(b.x - cx, b.y - cy) > (b.kind === "mill" ? 560 : NEAR + 30) || !seen(b.x, b.y, b.team)) continue;   // (the mill's wheel is seen turning from the Oblique view)
      const wk = b.wk !== undefined ? b.wk : globalThis.HG?.realm ? null : activity(w, b);   // (a realm mirror: only what the server says — own buildings, and others' while in sight)
      let S = sites.get(b.id);
      const tw = b.kind === "mage_tower";   // (no Blender model of the tower yet: render/buildings.js draws nothing for it)
      if (!S) {
        const fg = furniture(b.kind), obj = new THREE.Group();
        if (fg) { const m = new THREE.Mesh(fg, mat); m.castShadow = m.receiveShadow = true; obj.add(m); }
        if (tw) obj.add(tower());
        obj.position.set(b.x, bldBase(map, b), -b.y); obj.rotation.y = b.rot || 0; obj.updateMatrixWorld(true);
        group.add(obj); S = { obj }; sites.set(b.id, S);
        if (b.kind === "weaver") S.loomMen = (W) => { const [lx, ly] = local(b, 3.0, -2.55); for (const [i, M] of W.labor?.men || []) if (M.pose === "work_loom" && Math.hypot(W.S.x[i] - lx, W.S.y[i] - ly) < 0.6) return fr((W.time - M.t0) / DUR.work_loom); return -1; };
      }
      live.add(b.id);
      if (b.kind === "siege_workshop") { const name = wk?.m && ENGINE_OF[wk.m]; if (name) engineSite(S, b, 0, name); }
      if (b.kind === "mill") patchMill(b, S);
      near.push({ b, wk, S });
    }
    for (const [id, S] of sites) if (!live.has(id)) { group.remove(S.obj); S.obj.traverse((o) => { if (o.geometry && o.geometry !== undefined && !o.userData.shared) o.geometry.dispose?.(); }); sites.delete(id); }
    if (prevPh.size > 4000) prevPh.clear();
  }
  return { update };
}
