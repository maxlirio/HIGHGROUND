// EVERY BUILDING ALIVE (the owner: "I asked for each type of building to have animations") — and only REAL people (the
// owner: "the animations should be of REAL serfs, like if no serfs are working there, there aren't any, and the number of
// people working is equal to the number of serfs assigned"). Pure render: read from w.buildings (each building itself: its
// kind, its id, its team, b.wk on a realm mirror — js/sim/jobs/workshops.js activity), the calendar (w.econ.doy: the season
// and the hour), and how many of its own people are about it — so a realm client draws the same. Nothing here is read
// back by the simulation.
//   • NO PEOPLE are drawn here. Every man at a building is a sim man (js/render/figures.js), put there by his real work:
//     the crew at the face and their carriers to the camp, the storemen, the workshop crews at their stations, the home
//     crew at their own doors, a gate's two guards, the men ordered up onto the walls. No crew: nobody there.
//   • the house's real stock: its horses grazing on the paddock (b.wk.h), facing the way they walk
//   • instanced props: washing lines and the washing on them, sack heaps, carts and a barrow left standing (one moves only
//     in a real man's hands), braziers, great banners on the keep and the gatehouse; static ones rewritten twice a second
//   • GPU particles: chimney smoke (the season and the hour: winter and mealtimes smoke most), braziers, the ley stone's
//     glow — their motion all in the shader
import * as THREE from "three";
import { tint, merge } from "../labor.js";
import { FIG_FAR } from "../figures.js";
import { local, activity } from "../../sim/jobs/workshops.js";
import { BUILDINGS } from "../../sim/econ-data.js";
import { glbExists } from "../../build.js";
import { TWD } from "../../sim/townwall.js";
import { groundH } from "../terrain.js";
import { padBase } from "../pads.js";
import { teamFlagMat } from "../buildings.js";

const hs = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };
const fr = (x) => ((x % 1) + 1) % 1;
const NEAR = FIG_FAR + 20;      // the full scene is built this close (m, from the camera over the ground)
const FAR = 470;                // the actors that carry a building at the Oblique view are drawn out to here (3-D m: figures.js E.far)
const PROPS = 620;              // props and particles out to here
const HAS_MODEL = new Map();    // kind → bool (a kind with no model yet draws nothing: no life on an empty pad)

// ---------------------------------------------------------------- props (three.js local: x along, y up, z = -(sim y))
const T_ = (g, c, v = 0.15, s = 1) => tint(g, c, v, s);
const box = (w, h, d, c, x, y, z, ry = 0) => T_(new THREE.BoxGeometry(w, h, d), c).rotateY(ry).translate(x, y, z);
const cyl = (r0, r1, h, c, x, y, z, seg = 8) => T_(new THREE.CylinderGeometry(r0, r1, h, seg), c).translate(x, y, z);
const WOOD = "#6b5138", DARK = "#4a3a2a", ROPE = "#cbb994", SACK = "#c9b48a", IRON = "#2e2a26";
function lineGeo() {   // a washing line: two forked posts 4.2 m apart, the rope between (along x, centred)
  const g = []; for (const s of [-1, 1]) { g.push(cyl(0.045, 0.06, 1.95, WOOD, s * 2.1, 0.97, 0, 5)); g.push(box(0.05, 0.3, 0.05, WOOD, 0, 0, 0).rotateZ(-0.3 * s).translate(s * 2.1 + s * 0.05, 2.0, 0)); }
  g.push(cyl(0.012, 0.012, 4.2, ROPE, 0, 0, 0, 3).rotateZ(Math.PI / 2).translate(0, 1.86, 0));
  return merge(g);
}
function clothGeo() { const g = new THREE.PlaneGeometry(0.85, 0.72, 2, 2).translate(0, -0.36, 0); g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3)); return g.toNonIndexed(); }
function sacksGeo() { const g = []; for (let k = 0; k < 9; k++) { const row = k < 5 ? 0 : k < 8 ? 1 : 2, i = row === 0 ? k : row === 1 ? k - 5 : 0, n = row === 0 ? 5 : row === 1 ? 3 : 1;
  g.push(T_(new THREE.CapsuleGeometry(0.2, 0.42, 3, 7), SACK, 0.18, k).rotateZ(Math.PI / 2).scale(1, 0.75, 1).translate((i - (n - 1) / 2) * 0.62, 0.17 + row * 0.27, (k % 2) * 0.12)); } return merge(g); }
function cartGeo(load) {   // a two-wheeled cart, shafts forward along +x (3.4 m), its load: sacks / logs / ore / nothing
  const g = [box(2.0, 0.08, 1.3, "#7a5c3c", -0.3, 0.85, 0), box(2.0, 0.35, 0.06, "#6a4e34", -0.3, 1.05, 0.64), box(2.0, 0.35, 0.06, "#6a4e34", -0.3, 1.05, -0.64), box(0.06, 0.35, 1.3, "#6a4e34", -1.3, 1.05, 0)];
  for (const s of [-1, 1]) { g.push(T_(new THREE.TorusGeometry(0.55, 0.06, 5, 14), DARK).translate(-0.3, 0.6, s * 0.75)); g.push(box(1.9, 0.07, 0.07, "#7a5c3c", 1.6, 0.75, s * 0.42).rotateZ(-0.0)); }
  g.push(cyl(0.05, 0.05, 1.6, DARK, 0, 0, 0, 6).rotateX(Math.PI / 2).translate(-0.3, 0.6, 0));
  if (load === "sacks") for (let k = 0; k < 6; k++) g.push(T_(new THREE.CapsuleGeometry(0.2, 0.42, 3, 7), SACK, 0.18, k).rotateZ(Math.PI / 2).scale(1, 0.75, 1).translate(-0.8 + (k % 3) * 0.5, 1.1 + Math.floor(k / 3) * 0.26, (k % 2 ? 0.25 : -0.25)));
  if (load === "logs") for (let k = 0; k < 5; k++) g.push(cyl(0.17, 0.17, 2.4, "#5a4630", 0, 0, 0, 7).rotateZ(Math.PI / 2).translate(-0.2, 1.08 + (k > 2 ? 0.3 : 0), (k % 3 - 1) * 0.36 + (k > 2 ? 0.18 : 0)));
  if (load === "ore") g.push(T_(new THREE.IcosahedronGeometry(0.7, 0), "#6f5646", 0.3).scale(1.3, 0.45, 0.85).translate(-0.3, 1.05, 0));
  return merge(g);
}
function barrowGeo() {   // a wheelbarrow, handles back along -x, with a load of ore
  const g = [box(0.9, 0.3, 0.6, "#6a4e34", 0.2, 0.45, 0), T_(new THREE.TorusGeometry(0.2, 0.04, 4, 10), DARK).translate(0.75, 0.22, 0), T_(new THREE.IcosahedronGeometry(0.33, 0), "#6f5646", 0.3).scale(1.2, 0.5, 0.8).translate(0.2, 0.62, 0)];
  for (const s of [-1, 1]) { g.push(box(1.6, 0.05, 0.05, WOOD, 0.0, 0.42, s * 0.26).rotateZ(0.12)); g.push(box(0.05, 0.38, 0.05, DARK, 0.1, 0.19, s * 0.22)); }
  return merge(g);
}
function brazierGeo() { const g = [cyl(0.32, 0.22, 0.3, IRON, 0, 1.0, 0, 8), cyl(0.27, 0.27, 0.06, "#c0581e", 0, 1.14, 0, 8)]; for (let k = 0; k < 3; k++) { const a = k * 2.094; g.push(cyl(0.025, 0.025, 1.0, IRON, Math.cos(a) * 0.2, 0.5, Math.sin(a) * 0.2, 4)); } return merge(g); }
function woodpileGeo() { const g = [cyl(0.28, 0.32, 0.55, "#5a4630", 0, 0.27, 0, 8)]; for (let k = 0; k < 10; k++) g.push(box(0.6, 0.13, 0.13, k % 2 ? "#8a6a48" : "#7a5c3c", 0.95 + (k % 4) * 0.02, 0.07 + Math.floor(k / 4) * 0.13, -0.45 + (k % 4) * 0.3, 0.1 * (k % 3))); return merge(g); }
function poleGeo() { return T_(new THREE.CylinderGeometry(0.07, 0.1, 1, 6), "#5a4631").translate(0, 0.5, 0); }
function bannerGeo() { const g = new THREE.PlaneGeometry(1, 0.7, 12, 4).translate(0.5, -0.35, 0); return g; }

// ---------------------------------------------------------------- GPU particles (as js/render/jobs/quarry.js's, with per-group gains)
const KINDS = {   // n per emitter, life s, rise m/s, spread m, size0, size1 m, rgb, alpha, additive, group (0 hearth smoke, 1 fire, 2 work, 3 always)
  chimney: [16, 12, 0.95, 0.35, 1.1, 7.0, [0.74, 0.75, 0.78], 0.7, 0, 0],
  hall: [18, 12, 1.1, 0.45, 1.4, 7.5, [0.72, 0.73, 0.76], 0.7, 0, 0],
  bsmoke: [8, 6, 1.1, 0.25, 0.6, 3.2, [0.55, 0.53, 0.5], 0.4, 0, 1],
  fire: [6, 0.9, 1.4, 0.12, 0.55, 0.15, [1.0, 0.55, 0.18], 0.95, 1, 1],
  fglow: [2, 1.6, 0.0, 0.0, 2.6, 3.0, [1.0, 0.45, 0.12], 0.55, 1, 1],
  ley: [10, 3.2, 0.5, 0.5, 0.5, 1.4, [0.55, 0.62, 1.0], 0.55, 1, 3],
  lglow: [2, 2.2, 0.0, 0.0, 2.4, 3.2, [0.45, 0.55, 1.0], 0.4, 1, 3],
};
function makeParticles(scene, additive) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, pxPerM: { value: 800 }, dpr: { value: 1 }, wind: { value: new THREE.Vector2(0.45, 0.2) }, gain: { value: new THREE.Vector4(1, 1, 1, 1) } },
    vertexShader: /* glsl */`
      attribute vec4 prm; attribute vec4 prm2; attribute vec3 rgb; attribute float seed;
      uniform float time; uniform float pxPerM; uniform float dpr; uniform vec2 wind; uniform vec4 gain;
      varying vec3 vC; varying float vA;
      float h1(float n){ return fract(sin(n) * 43758.5453); }
      void main(){
        float life = prm.x, age = fract(time / life + seed), rise = prm.y, spread = prm.z;
        int gi = int(prm2.y + 0.5); float g = gi == 0 ? gain.x : gi == 1 ? gain.y : gi == 2 ? gain.z : gain.w;
        vec3 p = position;
        float a = seed * 91.7, r = spread * (0.3 + age) * (0.5 + h1(seed * 13.1));
        p.x += cos(a) * r + wind.x * age * life * (0.3 + rise * 0.4); p.z -= sin(a) * r + wind.y * age * life * (0.3 + rise * 0.4);
        p.y += rise * age * life * (1.0 - 0.35 * age);
        vC = rgb; vA = prm2.z * smoothstep(0.0, 0.12, age) * (1.0 - age) * (1.0 - age * 0.3);
        if (rise == 0.0) vA = prm2.z * (0.65 + 0.35 * sin(time * 11.0 + seed * 40.0) * sin(time * 3.7 + seed * 9.0));   // a glow: flickers
        vA *= min(1.0, g) * step(h1(seed * 7.13 + 0.5), g);   // (the group's gain: fainter, and fewer of them)
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        float s = mix(prm.w, prm2.x, age) * (0.75 + 0.25 * min(1.5, g));
        gl_PointSize = clamp(s * pxPerM / -mv.z, 1.0, 180.0) * dpr;
        if (vA <= 0.001) gl_PointSize = 0.0;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC; varying float vA;
      void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float r = dot(q, q); if (r > 1.0) discard;
        float a = vA * pow(1.0 - r, 1.6); gl_FragColor = vec4(vC, a); }`,
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const geo = new THREE.BufferGeometry(); const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 5; scene.add(pts);
  function set(emitters) {   // [{x, y, h, kind, k, mul?, a?, jx?}] in sim coordinates
    const P = [], PR = [], PR2 = [], C = [], SD = [];
    for (const e of emitters) {
      const K = KINDS[e.kind]; if (!K || (K[8] ? 1 : 0) !== (additive ? 1 : 0)) continue;
      const n = Math.max(1, Math.round(K[0] * (e.mul || 1)));
      for (let j = 0; j < n; j++) {
        P.push(e.x + (hs(e.k, j * 3) - 0.5) * (e.jx || 0), e.h, -(e.y + (hs(e.k, j * 3 + 1) - 0.5) * (e.jx || 0)));
        PR.push(K[1] * (0.8 + 0.4 * hs(e.k, j + 50)), K[2], K[3], K[4]); PR2.push(K[5], K[9], K[7] * (e.a || 1), 0);
        C.push(...K[6]); SD.push(j / n + hs(e.k, j) * 0.07);
      }
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute("prm", new THREE.Float32BufferAttribute(PR, 4));
    geo.setAttribute("prm2", new THREE.Float32BufferAttribute(PR2, 4)); geo.setAttribute("rgb", new THREE.Float32BufferAttribute(C, 3)); geo.setAttribute("seed", new THREE.Float32BufferAttribute(SD, 1));
    geo.setDrawRange(0, SD.length); geo.computeBoundingSphere(); pts.visible = SD.length > 0;
  }
  return { mat, set, pts };
}

// ---------------------------------------------------------------- the season and the hour
// how hard the hearths burn: winter most, midsummer least, a fire made up for the morning and the evening meal
export function hearth(doy) {
  const d = ((doy % 365) + 365) % 365, hr = fr(doy) * 24, cold = 0.5 + 0.5 * Math.cos(2 * Math.PI * (d - 15) / 365);
  const meal = Math.exp(-((hr - 7.5) ** 2) / 3) + Math.exp(-((hr - 18.5) ** 2) / 4);
  return Math.max(0.4, Math.min(1.25, 0.45 + 0.45 * cold + 0.35 * meal));
}
const dark = (doy) => { const hr = fr(doy) * 24; return hr < 5.5 || hr > 20.5 ? 1 : hr < 7 ? (7 - hr) / 1.5 : hr > 19 ? (hr - 19) / 1.5 : 0; };
const harvest = (doy) => { const d = ((doy % 365) + 365) % 365; return d > 205 && d < 290; };

// ---------------------------------------------------------------- where each kind's things stand (building frame: x along, y to its back; the front is -y)
// read off the models (assets/src/<kind>.py; tools/ambient-shots.mjs --survey)
const HOUSE = [   // per model (b.id % 3): the door, the back yard, the side yard, the flue
  { door: [-1.5, -3.6], back: [0.5, 4.6], side: [6.4, -0.6], flue: [-2.0, 0, 6.6] },
  { door: [-1.0, -5.3], back: [0.0, 6.2], side: [7.0, 0.0], flue: [1.24, 0, 7.0] },
  { door: [-1.2, -4.0], back: [0.0, 5.0], side: [7.2, 0.0], flue: [4.1, 0, 6.05] },
];
// a cart left standing by (shafts down: no horse is drawn that is not the house's own stock): kind → [load, x, y, heading, when] (when: "busy" or "on")
const CARTS = { granary: ["cartS", -4.0, -17.2, Math.PI, "busy"], tithe_barn: ["cartS", -5, -24, Math.PI, "busy"], mill: ["cartS", -3.0, -9.2, Math.PI, "on"],
  lumber_camp: ["cartL", -1.0, -8.2, 0.15, "busy"], mining_camp: ["cartO", -5.0, -7.2, 0.5, "busy"], market: ["cart", 1.4, -11.5, 0, "busy"] };
const cartOn = (S) => { const C = CARTS[S.b.kind]; return C && (C[4] === "on" ? !!S.wk?.on : !!S.busy) ? C : null; };
const SMOKE = {   // [x, y, height, kind] chimneys and louvres (houses: HOUSE[].flue)
  town_hall: [[2.3, 1.5, 15.6, "hall"], [8.3, 1.6, 14.4, "hall"]],
  barracks: [[-4.6, 5.1, 11.0, "chimney"]],
  temple: [[-5.8, 3.9, 13.6, "chimney"]],
  hospital: [[0, 6, 16, "chimney"]],
  guildhall: [[0, 3, 18, "chimney"]],
  mint: [[-5.31, 3.05, 12.0, "chimney"], [1.75, 3.05, 11.7, "chimney"]], // (the forge stack on the west gable, the hall flue on the east: assets/src/mint.py)
  palace: [[0, 0, 22, "hall"]],
};

// ---------------------------------------------------------------- the renderer
export function makeRender(scene, map, { figures = null } = {}) {
  if (typeof location !== "undefined" && /[?&]noambient\b/.test(location.search)) return { update() {} };   // (A/B: tools/bench-render.mjs --extra "&noambient")
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const clothMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  const inst = (geo, cap, m = mat, colored = false) => { const o = new THREE.InstancedMesh(geo, m, cap); o.count = 0; o.frustumCulled = false; o.castShadow = false; if (colored) o.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); scene.add(o); return o; };
  const P = {   // instanced props
    line: inst(lineGeo(), 200), cloth: inst(clothGeo(), 700, clothMat, true), sacks: inst(sacksGeo(), 120),
    cart: inst(cartGeo(null), 60), cartS: inst(cartGeo("sacks"), 60), cartL: inst(cartGeo("logs"), 40), cartO: inst(cartGeo("ore"), 40),
    barrow: inst(barrowGeo(), 40), brazier: inst(brazierGeo(), 80), wood: inst(woodpileGeo(), 120), pole: inst(poleGeo(), 80),
  };
  for (const k of ["cart", "cartS", "cartL", "cartO"]) P[k].castShadow = true;   // (the rest too small to cast one worth its pass)
  const banners = new Map();   // team → InstancedMesh with the team's waving banner material (js/render/buildings.js)
  const bannerOf = (team) => { if (banners.has(team)) return banners.get(team); const m = teamFlagMat(team); if (!m) return null; const o = inst(bannerGeo(), 40, m); o.castShadow = false; banners.set(team, o); return o; };
  const smoke = makeParticles(scene, false), glow = makeParticles(scene, true);
  const X = figures?.extras || [];
  const d = new THREE.Object3D(), tmpC = new THREE.Color();
  const life = new Map();   // building id → { b, crowd, busy, near, far }
  let slowT = -1e9, emitKey = "", list = [], statics = [], doy = 172;
  const CLOTH = ["#f2eee2", "#e9e2cc", "#d8cfb2", "#8a9cb4", "#b4553e", "#c9b98e", "#f5f2ea"];

  // ---- the actors: NOBODY. The owner: "the animations should be of REAL serfs, like if no serfs are working there, there
  // aren't any, and the number of people working is equal to the number of serfs assigned." Every person at a building is
  // a sim man drawn by js/render/figures.js where the sim puts him: the crew at the face and their carriers to the camp
  // (js/sim/jobs/quarry.js, forestry.js), the storemen at the granary (haulage.js), the crew at their stations
  // (js/sim/jobs/workshops.js), the home crew at their own doors (economy.js spotFor), a gate's two real guards
  // (js/sim/gateguards.js), the men ordered up onto the walls (townwall.js). The only life drawn here is the house's real
  // stock: its horses on the paddock (b.wk.h — the stud and a share of the horses in store), grazing.
  function actors(S, now) {
    const b = S.b, team = b.team, id = b.id, rot = b.rot || 0;
    if (b.kind !== "paddock") return;
    const push = (key, lx, ly, a, clip, phase, more) => { const [x, y] = local(b, lx, ly); X.push({ key, x, y, face: a + rot, clip, phase, kit: [], team, seed: id * 131 + X.length, far: FAR, ...more }); };
    const n = Math.max(0, Math.min(10, S.wk?.h ?? 0));
    for (let k = 0; k < n; k++) {   // each grazes: a slow walk to a new patch (facing the way it goes), then a long stand
      const leg = 26 + 14 * hs(id, k), T = now / leg + hs(k, id) * 9, j = Math.floor(T), f = T - j;
      const p0 = [(hs(j + k * 31, id) - 0.5) * 22, (hs(j + k * 31, id + 1) - 0.5) * 22], p1 = [(hs(j + 1 + k * 31, id) - 0.5) * 22, (hs(j + 1 + k * 31, id + 1) - 0.5) * 22];
      const D = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), wt = Math.min(0.6, D / 0.9 / leg), mv = f > 1 - wt, u = mv ? (f - (1 - wt)) / wt : 0, x = p0[0] + (p1[0] - p0[0]) * u, y = p0[1] + (p1[1] - p0[1]) * u;
      const face = mv ? Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) : Math.atan2(p0[1] - (hs(j, k) - 0.5) * 40, p0[0]) + hs(j, k + 3) * 2;
      push("horse_light", x, y, face, mv ? "walk" : "idle", mv ? (u * D) / 1.41 : fr(now / 2.667 + hs(id, k + 70)), k >= 6 && k % 3 === 0 ? { scale: 0.62 } : null);
    }
  }
  let w0 = null;
  // ---- props that move: washing in the wind (a barrow or a cart moves only in a real man's hands: js/render/labor.js)
  function moving(now, cx, cy, wind) {
    let nc = 0;
    const wx = wind?.x ?? 0.45, wy = wind?.y ?? 0.2, ws = Math.min(1.4, 0.35 + Math.hypot(wx, wy) * 0.12);
    for (const S of list) {
      const b = S.b, rot = b.rot || 0;
      if (b.kind === "house" && hs(b.id, 2) < 0.5 && S.dist < PROPS * 0.75) {
        const H = HOUSE[b.id % 3]; const n = 3 + Math.floor(hs(b.id, 8) * 3);
        for (let k = 0; k < n && nc < 700; k++) {
          const lx = H.back[0] - 1.7 + k * (3.4 / Math.max(1, n - 1)), [x, y] = local(b, lx, H.back[1]), h = groundH(map, local(b, H.back[0], H.back[1])[0], local(b, H.back[0], H.back[1])[1]) + 1.86;
          const sw = (0.25 + 0.25 * ws) * Math.sin(now * (1.7 + 0.4 * hs(b.id, k)) + k * 1.3) + 0.35 * ws;
          d.position.set(x, h, -y); d.rotation.set(0, rot, 0); d.rotateX(sw * (((wx * -Math.sin(rot) + wy * Math.cos(rot)) >= 0) ? 1 : -1)); d.scale.set(0.8 + 0.4 * hs(k, b.id), 0.8 + 0.5 * hs(b.id, k + 3), 1); d.updateMatrix();
          P.cloth.setMatrixAt(nc, d.matrix); tmpC.set(CLOTH[Math.floor(hs(b.id * 7, k) * CLOTH.length)]); P.cloth.instanceColor.setXYZ(nc, tmpC.r, tmpC.g, tmpC.b); nc++;
        }
      }
    }
    P.cloth.count = nc; P.cloth.instanceMatrix.needsUpdate = true; P.cloth.instanceColor.needsUpdate = true;
  }

  // ---- the slow part (twice a second): which buildings are near, how busy each is, the static props and the smoke
  function slow(w, cx, cy, seen) {
    w0 = w; doy = w.econ?.doy ?? doy;
    // the people about each building: a coarse grid of the living (in range), counted per team round it
    const S0 = w.S, G = new Map(), CELL = 24;
    if (S0) for (let i = 0; i < S0.n; i++) { if (!S0.alive[i]) continue; const x = S0.x[i], y = S0.y[i]; if (Math.abs(x - cx) > PROPS || Math.abs(y - cy) > PROPS) continue;
      const k = (Math.floor(x / CELL) * 73856093) ^ (Math.floor(y / CELL) * 19349663); let a = G.get(k); if (!a) G.set(k, a = []); a.push(i); }
    const about = (b, R) => { let n = 0; const x0 = Math.floor((b.x - R) / CELL), x1 = Math.floor((b.x + R) / CELL), y0 = Math.floor((b.y - R) / CELL), y1 = Math.floor((b.y + R) / CELL);
      for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) { const a = G.get((i * 73856093) ^ (j * 19349663)); if (a) for (const m of a) if (S0.team[m] === b.team && Math.hypot(S0.x[m] - b.x, S0.y[m] - b.y) < R) n++; } return n; };
    list = []; const live = new Set();
    for (const b of w.buildings || []) {
      if (b.field || b.ruin || b.progress < 1 || b.fire > 0 || b.razing) continue;
      const wall = b.x1 !== undefined, mx = wall ? (b.x1 + b.x2) / 2 : b.x, my = wall ? (b.y1 + b.y2) / 2 : b.y;
      const dist = Math.hypot(mx - cx, my - cy); if (dist > PROPS + (wall ? Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 2 : 0) || !seen(mx, my, b.team)) continue;
      if (b.kind === "bridge") continue;
      if (!hasModel(b.kind)) continue;
      let S = life.get(b.id); if (!S) life.set(b.id, S = { b, busy: 0 });
      S.b = b; S.dist = dist; S.near = dist < NEAR; S.wk = b.wk !== undefined ? b.wk : null;
      if (S.wk === null && !globalThis.HG?.realm) S.wk = activity(w, b);
      S.h0 = padBase(b) ?? groundH(map, b.x, b.y);
      const fp = BUILDINGS[b.kind]?.footprint || [10, 10], n = wall ? 0 : about(b, Math.max(fp[0], fp[1]) / 2 + 7);   // (its own folk at it: a carrier at the door, the crew, the buyers)
      S.crowd = n;
      S.busy = b.kind === "granary" || b.kind === "tithe_barn" ? n >= 3 || harvest(doy) : b.kind === "market" ? n >= 2 : b.kind === "lumber_camp" || b.kind === "mining_camp" ? n >= 2 : b.kind === "watchtower" ? n >= 1 : n >= 3;
      live.add(b.id); list.push(S);
    }
    for (const id of life.keys()) if (!live.has(id)) life.delete(id);
    // static props and particle emitters
    const pl = { line: [], sacks: [], barrow: [], cart: [], cartS: [], cartL: [], cartO: [], brazier: [], wood: [], pole: [] }, ban = new Map(), emit = [];
    const put = (kind, b, lx, ly, a = 0, h = null, s = 1) => { const [x, y] = local(b, lx, ly); pl[kind].push([x, h ?? groundH(map, x, y), y, (b.rot || 0) + a, s]); };
    const flag = (b, lx, ly, h, s) => { put("pole", b, lx, ly, 0, h, s); const o = ban.get(b.team) || []; const [x, y] = local(b, lx, ly); o.push([x, h + s * 0.97, y, (b.rot || 0) + 0.5, s * 0.42]); ban.set(b.team, o); };
    const smk = (b, lx, ly, h, kind, k, mul = 1) => { const [x, y] = local(b, lx, ly); emit.push({ kind, x, y, h, k: b.id * 11 + k, mul }); };
    for (const S of list) {
      const b = S.b, h0 = S.h0, k0 = b.kind, C = cartOn(S);
      if (C) put(C[0], b, C[1], C[2], C[3]);
      if (k0 === "house") { const H = HOUSE[b.id % 3]; smk(b, H.flue[0], H.flue[1], h0 - 0.15 + H.flue[2], "chimney", 0, 0.7 + 0.6 * hs(b.id, 1));
        if (hs(b.id, 2) < 0.5) put("line", b, H.back[0], H.back[1]);
        if (hs(b.id, 4) < 0.3) put("wood", b, H.side[0] - 0.4, H.side[1] + 2.4, Math.PI);
      }
      for (const [x, y, h, kind] of SMOKE[k0] || []) smk(b, x, y, h0 + h, kind, 1 + x);
      if (k0 === "granary" || k0 === "tithe_barn") { const g = k0 === "granary" ? { heap: [-3.2, -13.4], cart: [-2.4, -21], floor: [10.5, -7.5] } : { heap: [-4, -20], cart: [-3, -27], floor: [12, -10] };
        put("sacks", b, g.heap[0], g.heap[1], 0.2);
      }
      if (k0 === "mill") put("sacks", b, -2.6, -6.4, 0.1, null, 0.8);
      if (k0 === "mining_camp") put("barrow", b, 2.4, -2.2, 0.6);   // (left standing: a barrow moves only in a real man's hands)
      if (k0 === "town_hall") flag(b, -9.6, 0.4, h0 + 18.4, 5.5);
      if (k0 === "gatehouse") flag(b, 0, 0.6, h0 + TWD.gatehouse.top, 4.2);
      if (k0 === "watchtower") { put("brazier", b, 3.0, -5.6); smk(b, 3.0, -5.6, h0 + 1.15, "fire", 4); smk(b, 3.0, -5.6, h0 + 1.2, "fglow", 5); smk(b, 3.0, -5.6, h0 + 1.5, "bsmoke", 6); }   // (the watch's fire at the foot: the top is roofed)
      if (k0 === "gate" || k0 === "gatehouse") { put("brazier", b, -4.6, -6.6); smk(b, -4.6, -6.6, h0 + 1.15, "fire", 4); smk(b, -4.6, -6.6, h0 + 1.2, "fglow", 5); smk(b, -4.6, -6.6, h0 + 1.5, "bsmoke", 6, 0.7); }
      if (k0 === "mage_tower") { smk(b, 0, -8.6, h0 + 1.0, "ley", 7, S.wk?.a ? 1 : 0.5); smk(b, 0, -8.6, h0 + 1.3, "lglow", 8, 1); }
      if (k0 === "blacksmith" && !(S.wk?.n > 0)) { smk(b, -2.2, 2.35, h0 + 0.9, "fglow", 9); }
      if (k0 === "shell_keep" || k0 === "concentric_castle" || k0 === "palace") { const top = (BUILDINGS[k0].eyeH || 20) + 1, s = 5.5; put("pole", b, 0, 0, 0, h0, top + s); const o = ban.get(b.team) || []; const [x, y] = local(b, 0, 0); o.push([x, h0 + top + s * 0.97, y, (b.rot || 0) + 0.5, s * 0.42]); ban.set(b.team, o); } // (a mast from the ward's ground: over an open courtyard a pole set at the towers' height hung in the air)
      if (k0 === "barracks") { put("brazier", b, 3.0, -6.7); smk(b, 3.0, -6.7, h0 + 1.15, "fire", 4, 0.7); smk(b, 3.0, -6.7, h0 + 1.2, "fglow", 5, 0.7); }
    }
    for (const [kind, arr] of Object.entries(pl)) { const I = P[kind], cap = I.instanceMatrix.count; let n = 0;
      for (const [x, h, y, a, s] of arr) { if (n >= cap) break; d.position.set(x, h, -y); d.rotation.set(0, a, 0); if (kind === "pole") d.scale.set(1, s, 1); else d.scale.setScalar(s); d.updateMatrix(); I.setMatrixAt(n++, d.matrix); }
      I.count = n; I.instanceMatrix.needsUpdate = true; }
    for (const [team, I] of banners) if (!ban.has(team)) I.count = 0;
    for (const [team, arr] of ban) { const I = bannerOf(team); if (!I) continue; let n = 0; for (const [x, h, y, a, s] of arr) { d.position.set(x, h, -y); d.rotation.set(0, a, 0); d.scale.set(s * 4.2, s * 4.2, 1); d.updateMatrix(); if (n < 40) I.setMatrixAt(n++, d.matrix); } I.count = n; I.instanceMatrix.needsUpdate = true; }
    const ek = emit.map((e) => `${e.kind}${e.k}${Math.round(e.x)},${Math.round(e.y)},${e.mul}`).join("|");
    if (ek !== emitKey) { emitKey = ek; smoke.set(emit); glow.set(emit); }
  }
  // a kind with no model yet (render/buildings.js draws nothing for it) has no life: none on an empty pad
  function hasModel(kind) {
    if (kind === "mage_tower" || kind === "charcoal_kiln" || kind === "bloomery" || kind === "palisade" || kind === "stone_wall") return true;   // (drawn by the lanes / the wall kit)
    if (HAS_MODEL.has(kind)) return HAS_MODEL.get(kind);
    const name = kind === "paddock" ? "horse_paddock" : kind === "house" ? "house_a" : kind;
    HAS_MODEL.set(kind, false); glbExists(name).then((ok) => HAS_MODEL.set(kind, ok));
    return false;
  }

  function update(w, cam, { visible = null, now = 0, pxPerM = 800, dpr = 1 } = {}) {
    const cx = cam.position.x, cy = -cam.position.z, seen = (x, y, t) => !visible || visible(x, y, t);
    for (const p of [smoke, glow]) { p.mat.uniforms.time.value = now; p.mat.uniforms.pxPerM.value = pxPerM; p.mat.uniforms.dpr.value = dpr; }
    if (w.wind) { const k = Math.min(1, 5 / (Math.hypot(w.wind.x, w.wind.y) || 1)) * 0.35; smoke.mat.uniforms.wind.value.set(w.wind.x * k, w.wind.y * k); }
    const D = w.econ?.doy ?? doy, hg = hearth(D), nt = dark(D);
    for (const p of [smoke, glow]) p.mat.uniforms.gain.value.set(hg, 0.55 + 0.45 * nt, 1, 1);
    if (now - slowT > 0.5 || now < slowT) { slowT = now; slow(w, cx, cy, seen); }
    for (const S of list) if (S.dist < FAR + 40) actors(S, now);
    moving(now, cx, cy, w.wind);
  }
  return { update, hearth };
}
