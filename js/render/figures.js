// Figures: the men themselves, drawn over the sim's dots when the camera is close.
//
// Purely a render layer. Each soldier the sim already has (S.x/S.y/S.facing/S.state/S.arm/S.team) becomes
// an instance of his arm's figure when he is within FAR metres of the camera; beyond that the dot stays.
// The figure mesh is animated on the GPU from a vertex-animation texture (VAT) baked in Blender by
// tools/vat_bake.py: every clip frame stores every vertex's position + normal, and the vertex shader
// fetches two frames of the current clip and lerps them — and, for 0.2 s after a clip change, two frames of
// the previous clip too, cross-fading, so a man never pops from one pose into the next.
// No skeletons, no CPU skinning, one draw call per arm per LOD.
//
//   assets/units/index.json            { arms: [...] }  (only arms that exist in js/sim/arms.js are used)
//   assets/units/<arm>.glb             meshes <arm>_LOD0 / _LOD1; uv = atlas, uv1 = (VAT vertex row, 1 - part id)
//   assets/units/<arm>_vat.json        clip table, bounds, parts, dyes; "vat" names the packed texels:
//   assets/units/<arm>_vat.hgz         uint16 RGBA texels (pos xyz quantised in bounds, oct normal), packed by
//                                      tools/vat_pack.py (unpackVat below); a raw <arm>_vat.bin if not packed yet
//   (sets load only for the arms on the field — scanWanted)
//   assets/units/<arm>_mask.png        R team colour, G team accent, B dye (1 = dye 1, .5 = dye 2)
//
// THE FIGHT (docs/units-combat-anims.md). A man in contact stands in his guard; his blows are one-shot clips
// whose contact frame ("hit" in the clip table) is timed to land on the sim's blow (S.nextAtk), aimed at his
// foe; the foe answers at that instant — shield jolted (block), blade beaten aside (parry), a stagger away from
// the blow (hit / hit_back), or the fall. The dead fall away from what killed them (four variants), the downed
// writhe, the knocked-down struggle up again. Ranks behind the fighters press forward. Riders lower their lances
// in the last stretch of a charge; the lance shatters on impact and the sword comes out. A stone thrown by an
// engine drives its first victim flat and throws the men beside it through the air. Arrows and bolts fly, stick
// in the ground, in shields and pavises, in men and in horses, and stay there (js/render/battlefx.js has the
// ones not stuck in a figure). Sim signals it reads: docs/anim-sim-signals.md.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { S_IDLE, S_MOVE, S_FIGHT, S_FLEE, S_DOWN, S_DEAD, S_WORK } from "../sim/soldiers.js";
import { ROLE, BUILDINGS } from "../sim/econ-data.js";
import { ARM_BY_ID } from "../sim/arms.js";
import { WEAPON_BY_ID, WEAPON_KEYS, SH_BUCKLER } from "../sim/kit.js";
import { neighbours } from "../sim/world.js";
import { ITEMS } from "../sim/labor.js";
import { TEAM } from "./dots.js";
import { SUN_DIR } from "./terrain.js";
import { standH, horsePose, seatThrough } from "./footing.js"; // (feet on the ground as drawn; a horse tilted to the slope)
import { makeBattleFx } from "./battlefx.js";

export const FIG_NEAR = 190, FIG_FAR = 220;   // figures fully in < NEAR, dots fully back > FAR (dithered cross-fade)
const LOD1_AT = 90;                           // metres: LOD0 (~2.8k tris) inside, LOD1 (~1.1k) beyond
const RUN_AT = 2.2;                           // m/s: walk below, run above
const CHUNK = 32;                             // frustum culling granularity (m)
const MAX_CLIPS = 64;                         // clip slots per arm in the shader
const BLEND = 0.2;                            // s: cross-fade between clips
const ARROW_NEAR = 120;                       // m: arrows stuck in figures are drawn inside this
const MAX_STUCK_MAN = 8, MAX_STUCK_HORSE = 14, STUCK_CAP = 6000;
const SEL = new THREE.Color("#ffd35a");

const loader = new GLTFLoader();
const hash = (n) => { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// the VAT as tools/vat_pack.py ships it ("hgv1", one gzip stream): per frame a reference frame (meta.vat.refs), then
// position changes from it (vertex-differenced, zig-zag int16, low bytes / high bytes, per channel, low `shift` bits
// dropped and rebuilt at their midpoint) and normal byte changes (mod 256). Unpacked here to the same uint16 RGBA
// texels the raw <arm>_vat.bin holds. Gunzip (native) ~6-16 ms + unpack ~4-14 ms an arm.
export const VATSTAT = { arms: 0, bytes: 0, unpackMs: 0 };   // (the gunzip is native and off the main thread)
export async function gunzip(buf) {
  const u = new Uint8Array(buf); if (u[0] !== 0x1f || u[1] !== 0x8b) return u;   // (a server already undid the gzip)
  return new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
}
export function unpackVat(meta, b) {
  const V = meta.verts[0] + meta.verts[1], F = meta.frames, T = F * V, s = meta.vat.shift, refs = meta.vat.refs;
  const half = s ? 1 << (s - 1) : 0, out = new Uint16Array(meta.texWidth * meta.texHeight * 4);
  if (b.length !== 8 * T) throw new Error(`vat ${meta.arm}: ${b.length} bytes, expected ${8 * T}`);
  for (let c = 0; c < 3; c++) {
    const lo = 2 * c * T, hi = lo + T;
    for (let f = 0; f < F; f++) {
      const r = refs[f], k0 = f * V, o = k0 * 4 + c, ro = r * V * 4 + c; let run = 0;
      for (let v = 0, k = k0; v < V; v++, k++) {
        const z = b[lo + k] | (b[hi + k] << 8); run = (run + ((z >>> 1) ^ -(z & 1))) & 0xffff;
        out[o + v * 4] = ((((r >= 0 ? out[ro + v * 4] >> s : 0) + run) & 0xffff) << s) + half;
      }
    }
  }
  for (let f = 0; f < F; f++) {
    const r = refs[f], k0 = f * V, o = k0 * 4 + 3, ro = r * V * 4 + 3, bx = 6 * T + k0, by = 7 * T + k0;
    for (let v = 0; v < V; v++) {
      const p = r >= 0 ? out[ro + v * 4] : 0;
      out[o + v * 4] = ((((p >> 8) + b[bx + v]) & 255) << 8) | (((p & 255) + b[by + v]) & 255);
    }
  }
  return out;
}
async function loadVat(meta, base) {
  if (!meta.vat) return new Uint16Array(await (await fetch(`${base}assets/units/${meta.arm}_vat.bin`)).arrayBuffer());   // not packed yet
  const buf = await (await fetch(`${base}assets/units/${meta.vat.file}`)).arrayBuffer();
  const b = await gunzip(buf), t0 = performance.now(), out = unpackVat(meta, b);
  VATSTAT.arms++; VATSTAT.bytes += buf.byteLength; VATSTAT.unpackMs += performance.now() - t0;
  return out;
}

async function loadArm(arm, base) {
  const [meta, gltf, mask] = await Promise.all([
    fetch(`${base}assets/units/${arm}_vat.json`).then((r) => r.json()),
    loader.loadAsync(`${base}assets/units/${arm}.glb`),
    new THREE.TextureLoader().loadAsync(`${base}assets/units/${arm}_mask.png`),
  ]);
  const data = await loadVat(meta, base);
  const vat = new THREE.DataTexture(data, meta.texWidth, meta.texHeight, THREE.RGBAIntegerFormat, THREE.UnsignedShortType);
  vat.internalFormat = "RGBA16UI"; vat.minFilter = vat.magFilter = THREE.NearestFilter; vat.generateMipmaps = false; vat.needsUpdate = true;
  mask.colorSpace = THREE.NoColorSpace; mask.flipY = false;
  const geos = [null, null]; let src = null;
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return; const m = /_LOD(\d)/.exec(o.name) || /_LOD(\d)/.exec(o.parent?.name || ""); const l = m ? +m[1] : 0;
    if (l < 2) geos[l] = o.geometry; src = src || o.material;
  });
  return { meta, vat, data, mask, geos, src };
}

// the VAT sampling shared by the figures and the arrows stuck in them: two frames of the current clip, lerped,
// cross-faded with two frames of the previous clip while iPrev.z > 0
const VAT_GLSL = (n) => `
  uniform highp usampler2D vatTex; uniform float vatW; uniform float vatNV; uniform vec3 bMin; uniform vec3 bSize; uniform vec4 clips[${n}];
  vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
  vec3 octDec(uint w) { vec2 f = vec2(float(w >> 8u), float(w & 255u)) / 255.0 * 2.0 - 1.0; vec3 n = vec3(f, 1.0 - abs(f.x) - abs(f.y));
    float t = max(-n.z, 0.0); n.x += n.x >= 0.0 ? -t : t; n.y += n.y >= 0.0 ? -t : t; return normalize(n); }
  uvec4 vatAt(float frame, float vid) { int k = int(frame * vatNV + vid); int W = int(vatW); return texelFetch(vatTex, ivec2(k % W, k / W), 0); }
  void vatSample(float clip, float phase, float vid, out vec3 p, out vec3 n) {
    vec4 C = clips[int(clip + 0.5)];
    float fr = phase * C.y; float f0 = min(floor(fr), C.y - 1.0); float fa = fr - f0;
    float f1 = f0 + 1.0; if (f1 > C.y - 0.5) f1 = C.z > 0.5 ? 0.0 : C.y - 1.0;
    uvec4 T0 = vatAt(C.x + f0, vid), T1 = vatAt(C.x + f1, vid);
    p = mix(vec3(T0.xyz), vec3(T1.xyz), fa) / 65535.0 * bSize + bMin;
    n = normalize(mix(octDec(T0.w), octDec(T1.w), fa));
  }
  void vatBlend(vec4 anim, vec4 prev, float vid, out vec3 p, out vec3 n) {
    vatSample(anim.x, anim.y, vid, p, n);
    if (prev.z > 0.001) { vec3 p2, n2; vatSample(prev.x, prev.y, vid, p2, n2); p = mix(p, p2, prev.z); n = normalize(mix(n, n2, prev.z)); }
  }`;

function vatUniforms(A) {
  const { meta, vat } = A;
  const clips = []; A.clipIndex = {};
  for (const [name, c] of Object.entries(meta.clips)) { A.clipIndex[name] = clips.length; clips.push(new THREE.Vector4(c.start, c.frames, c.loop ? 1 : 0, 0)); }
  if (clips.length > MAX_CLIPS) console.warn("figures: too many clips", meta.arm, clips.length);
  while (clips.length < MAX_CLIPS) clips.push(new THREE.Vector4(0, 1, 1, 0));
  return {
    vatTex: { value: vat }, vatW: { value: meta.texWidth }, vatNV: { value: meta.verts[0] + meta.verts[1] },
    bMin: { value: new THREE.Vector3(...meta.bounds.min) }, bSize: { value: new THREE.Vector3(...meta.bounds.max).sub(new THREE.Vector3(...meta.bounds.min)) },
    clips: { value: clips.slice(0, MAX_CLIPS) },
  };
}

function makeMaterial(A, teamAcc, VU) {
  const { meta, mask, src } = A;
  const mat = new THREE.MeshStandardMaterial({ map: src.map, roughnessMap: src.roughnessMap || null, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  if (mat.map) mat.map.anisotropy = 4;
  const pal = (list) => { const a = list.map((h) => new THREE.Color("#" + h)); while (a.length < 8) a.push(a[a.length % list.length]); return a; };
  const U = {
    ...VU, maskMap: { value: mask }, neutral: { value: meta.neutral },
    teamCol: { value: TEAM }, teamAcc: { value: teamAcc }, selCol: { value: SEL },
    dye1: { value: pal(meta.dyes.d1) }, dye2: { value: pal(meta.dyes.d2) },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>
        ${VAT_GLSL(MAX_CLIPS)}
        attribute vec2 uv1; attribute vec4 iPos; attribute vec4 iAnim; attribute vec4 iLook; attribute vec4 iQuat; attribute vec4 iPrev;
        varying vec4 vLook;`)
      .replace("#include <beginnormal_vertex>", `
        vLook = iLook;
        vec3 vp, vn; vatBlend(iAnim, iPrev, uv1.x, vp, vn);
        float part = floor(1.5 - uv1.y);
        if (part > 0.5 && part < 23.5 && ((uint(iAnim.w) >> uint(part)) & 1u) == 0u) vp = vec3(0.0, -50.0, 0.0);   // kit this man doesn't carry
        if (part > 23.5 && ((uint(iPrev.w) >> uint(part - 24.0)) & 1u) == 0u) vp = vec3(0.0, -50.0, 0.0);      // (parts 24+: the second kit mask — the workshops' trade kit)
        float cy = cos(iPos.w), sy = sin(iPos.w);
        vp = qrot(iQuat, vp * iAnim.z); vn = qrot(iQuat, vn);   // riders: the saddle's pitch/roll; the thrown: their tumble
        vp = vec3(cy * vp.x + sy * vp.z, vp.y, -sy * vp.x + cy * vp.z) + iPos.xyz;
        vec3 objectNormal = vec3(cy * vn.x + sy * vn.z, vn.y, -sy * vn.x + cy * vn.z);
        #ifdef USE_TANGENT
        vec3 objectTangent = vec3(1.0, 0.0, 0.0);
        #endif`)
      .replace("#include <begin_vertex>", "vec3 transformed = vp;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform sampler2D maskMap; uniform float neutral; uniform vec3 teamCol[8]; uniform vec3 teamAcc[8]; uniform vec3 selCol; uniform vec3 dye1[8]; uniform vec3 dye2[8];
        varying vec4 vLook;`)
      .replace("void main() {", `void main() {
        if (vLook.w < 0.999) { float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); if (ign >= vLook.w) discard; }`)
      .replace("#include <map_fragment>", `#include <map_fragment>
        { vec3 mk = texture2D(maskMap, vMapUv).rgb; vec3 base = diffuseColor.rgb / neutral;
          int tm = int(mod(vLook.x, 8.0) + 0.5); vec3 tc = vLook.x > 7.5 ? selCol : teamCol[tm]; // (look = team + 8 when selected: eight houses)
          float d1 = smoothstep(0.75, 0.95, mk.b), d2 = smoothstep(0.3, 0.45, mk.b) * (1.0 - smoothstep(0.55, 0.7, mk.b));
          vec3 c = diffuseColor.rgb;
          c = mix(c, base * tc, mk.r); c = mix(c, base * teamAcc[tm], mk.g);
          c = mix(c, base * dye1[int(vLook.y + 0.5)], d1); c = mix(c, base * dye2[int(vLook.z + 0.5)], d2);
          diffuseColor.rgb = c; }`);
  };
  mat.customProgramCacheKey = () => "hg-figure-vat4";
  return mat;
}

// Arrows stuck in a figure: each instance copies its host's transform and animation state and rides one of the
// host's VAT vertices (the anchor), sticking out along that vertex's normal. Hidden with the part it is in (a
// shield put down takes its arrows with it).
function stuckGeometry() {
  const P = [], C = [], I = [];
  const quad = (a, b, w, col, rot) => { const o = P.length / 3, cx = Math.cos(rot), sz = Math.sin(rot);
    P.push(-w * cx, a, -w * sz, w * cx, a, w * sz, w * cx, b, w * sz, -w * cx, b, -w * sz); C.push(col, col, col, col); I.push(o, o + 1, o + 2, o, o + 2, o + 3); };
  for (const rot of [0, Math.PI / 2]) quad(0, 0.62, 0.006, 1, rot);
  for (const rot of [0.3, 0.3 + Math.PI / 2]) quad(0.44, 0.61, 0.022, 2, rot);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("c", new THREE.Float32BufferAttribute(C, 1)); g.setIndex(I);
  return g;
}
function makeStuckMaterial(VU) {
  return new THREE.ShaderMaterial({
    uniforms: { ...VU, sunDir: { value: SUN_DIR.clone().normalize() } },
    vertexShader: `${VAT_GLSL(MAX_CLIPS)}
      attribute float c; attribute vec4 iPos; attribute vec4 iAnim; attribute vec4 iQuat; attribute vec4 iPrev; attribute vec4 iStk;
      uniform vec3 sunDir; varying float vC; varying float vL;
      void main(){ vC = c;
        vec3 ap, an; vatBlend(iAnim, iPrev, iStk.x, ap, an);
        uint bits = uint(iAnim.w); float part = iStk.y;
        if (part > 0.5 && ((bits >> uint(part)) & 1u) == 0u) { vL = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        float s1 = fract(iStk.z * 7.13), s2 = fract(iStk.z * 3.71);
        vec3 d = normalize(an + vec3(s1 - 0.5, (s2 - 0.5) * 0.6, s2 - s1) * 0.9 + vec3(0.0, iStk.w, 0.0));
        vec3 a = abs(d.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 x = normalize(cross(a, d)), z = cross(x, d);
        vec3 lp = x * position.x + d * (position.y - 0.10) + z * position.z;       // 10 cm of the shaft is in him
        vec3 vp = qrot(iQuat, (ap + lp) * iAnim.z);
        float cy = cos(iPos.w), sy = sin(iPos.w);
        vp = vec3(cy * vp.x + sy * vp.z, vp.y, -sy * vp.x + cy * vp.z) + iPos.xyz;
        vec3 wx = qrot(iQuat, x); wx = vec3(cy * wx.x + sy * wx.z, wx.y, -sy * wx.x + cy * wx.z);
        vL = 0.55 + 0.45 * abs(dot(wx, sunDir));
        gl_Position = projectionMatrix * viewMatrix * vec4(vp, 1.0); }`,
    fragmentShader: `varying float vC; varying float vL;
      void main(){ if (vL <= 0.0) discard; vec3 col = vC < 1.5 ? vec3(0.50, 0.40, 0.26) : vec3(0.84, 0.82, 0.76);
        gl_FragColor = vec4(col * (0.42 + 0.75 * vL * 0.8), 1.0); }`,
  });
}

// Soft contact shadow under each man, stretched away from the sun: without it figures float.
function makeShadows(cap) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3));
  geo.setIndex([0, 2, 1, 0, 3, 2]);
  const iS = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("iS", iS);
  const sd = new THREE.Vector2(-SUN_DIR.x, -SUN_DIR.z).normalize(); // shadows fall away from the sun
  const len = 1.0 / Math.tan(Math.asin(SUN_DIR.y));                // shadow length per metre of height
  const mat = new THREE.ShaderMaterial({
    uniforms: { sd: { value: sd }, len: { value: len } },
    vertexShader: /* glsl */`attribute vec4 iS; uniform vec2 sd; uniform float len; varying vec2 vQ; varying float vF;
      void main(){ vQ = position.xz; bool lying = iS.w < 0.0; float aw = abs(iS.w), sz = floor(aw); vF = aw - sz; // w = ±(size + fade)
        vec2 ax = lying ? vec2(1.0, 0.0) : sd, ay = vec2(-ax.y, ax.x);
        float L = (lying ? 1.05 : 0.45 + 0.85 * len * 0.5) * sz, Wd = (lying ? 0.55 : 0.34) * (sz > 1.5 ? 1.6 : 1.0);
        vec2 c = lying ? vec2(0.0) : sd * (0.85 * len * 0.5 * sz - 0.1);
        vec2 p = c + ax * position.x * L + ay * position.z * Wd;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(iS.x + p.x, iS.y + 0.06, iS.z + p.y, 1.0); }`,
    fragmentShader: /* glsl */`varying vec2 vQ; varying float vF;
      void main(){ float r = length(vQ); float a = (1.0 - smoothstep(0.25, 1.0, r)) * 0.42 * vF; if (a < 0.01) discard; gl_FragColor = vec4(0.05, 0.05, 0.03, a); }`,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 1;
  return { mesh, iS, geo, cap };
}

// ---- Villager loadouts (docs/units-pipeline.md §3). The economy job a villager is on picks the kit in his hands
// (part names in villager_vat.json) and the clips he plays: `work` while S_WORK, `walk`/`idle` otherwise
// ("walk" / "idle" carry a long tool on the shoulder; the _hand variants hold a small tool, or nothing, in the hand).
const VILLAGER_KIT = {
  wood:   { kit: ["axe"],          work: "work_axe",    walk: "walk",      idle: "idle" },
  field:  { kit: ["hoe"],          work: "work_hoe",    walk: "walk",      idle: "idle" },
  reap:   { kit: ["sickle"],       work: "work_sickle", walk: "walk_hand", idle: "idle_hand" },
  mine:   { kit: ["pick"],         work: "work_pick",   walk: "walk",      idle: "idle" },
  build:  { kit: ["mallet"],       work: "work_mallet", walk: "walk",      idle: "idle", workKit: ["stake"] },
  craft:  { kit: ["mallet"],       work: "work_mallet", walk: "walk",      idle: "idle", workKit: ["stake"] },
  fish:   { kit: ["rod"],          work: "work_fish",   walk: "walk",      idle: "idle" },
  forage: { kit: ["sickle"],       work: "work_sickle", walk: "walk_hand", idle: "idle_hand" },
  adept:  { kit: [],               work: "work_adept",  walk: "walk_hand", idle: "idle_hand" },
  fire:   { kit: ["pail"],         work: "work_bucket", walk: "walk_pail", idle: "idle_pail" },
  idle:   { kit: [],               work: "idle_hand",   walk: "walk_hand", idle: "idle_hand" },
  talk:   { kit: [],               work: "idle_talk",   walk: "walk_hand", idle: "idle_talk" },
  water:  { kit: ["pail"],         work: "idle_pail",   walk: "walk_pail", idle: "idle_pail" },
  haul:   { kit: ["sack"],         work: "walk_carry",  walk: "walk_carry", idle: "idle_hand" },
  dress:  { kit: ["maul"],         work: "work_chisel", walk: "walk_hand", idle: "idle_hand", workKit: ["chisel"] },   // (a mason on a stone building: dressing stone)
};
// ---- the labour core (js/sim/labor.js, docs/gathering-plan.md): a man on a labour task or carrying a load plays the
// task's pose and carries the load as a part of his figure (assets/src/units/_carry_kit.py); these override the job kit.
// The four tables are exported so the lanes register their own holds / parts / poses from js/render/jobs/*.js.
export const HOLD_CLIPS = { shoulder: ["walk_shoulder", "idle_shoulder"], front: ["walk_front", "idle_front"], back: ["walk_hand", "idle_hand"],
  sack: ["walk_carry", "idle_hand"], drag: ["walk_drag", "idle_hand"], cart: ["walk_hand", "idle_hand"] };
export const CARRY_PART = { log: "log", faggot: "log", planks: "planks", stone: "stone", basket: "basket", fish: "basket", sack: "sack", sheaf: "sheaf", barrel: "barrel", carcass: "carcass" };
export const POSE_KIT = { work_axe: ["axe"], work_saw: ["saw"], work_pick: ["pick"], work_hoe: ["hoe"], work_sickle: ["sickle"], work_mallet: ["mallet"], work_fish: ["rod"], work_bucket: ["pail"] };
export const SYNCED = new Set(["work_stoop"]);   // one-shot-like poses whose phase follows the sim's step clock (Man.t0)
const laborLo = new Map();
const holdOf = (kind) => ITEMS[kind]?.hold || "back";
export function laborKit(w, i, holdOf) {
  const M = w.labor?.men.get(i); if (!M || (!M.carry && !M.pose)) return null;
  const c = M.carry, hold = c ? (c.cart ? "cart" : holdOf(c.kind)) : null, part = c && !c.cart ? CARRY_PART[c.kind] : null;
  const key = `${M.pose}|${hold}|${part}`;
  let lo = laborLo.get(key);
  if (!lo) {
    const hc = HOLD_CLIPS[hold] || HOLD_CLIPS.back;
    const posed = M.pose && M.pose !== "walk" ? M.pose : null;
    lo = { kit: posed ? (POSE_KIT[posed] || []) : part ? [part] : [], work: posed || (c ? hc[1] : "idle_hand"), walk: c ? hc[0] : "walk_hand", idle: c ? hc[1] : "idle_hand",
      workKit: posed === "work_mallet" ? ["stake"] : null, sync: SYNCED.has(posed) };
    if (posed && part && posed !== "work_stoop") lo.kit = lo.kit.concat([part]);   // (working with the load on: rare; the stoop sets it down/lifts it)
    laborLo.set(key, lo);
  }
  lo.M = M; return lo;
}
const F_DRESS = { ok: false };   // (the villager set has the mason's kit: set when it loads)
const MINE_RES = new Set(["stone", "ore", "silver", "gold", "clay"]);
const HOME_MIX = ["idle", "talk", "talk", "water", "water", "idle", "water", "talk"];   // hashed per man (no hoeing at nothing: the owner)
function villagerJob(w, i, u, convoyOut) {
  const S = w.S, job = u?.job;
  if (u?.convoy) return convoyOut.has(u.id) ? "haul" : "idle";
  if (!job) return ARM_BY_ID[S.arm[i]]?.engine ? "build" : "idle";     // siege-engine crews (no econ job) frame up / work engines
  switch (job.kind) {
    case "gather": {
      const res = job.res || job.node?.res;
      if (S.state[i] === S_MOVE && u.haul?.get(i) === 1) return "haul";  // a hauler on his way to the store, loaded
      if (res === "timber" || res === "firewood") return "wood";
      if (MINE_RES.has(res)) return "mine";
      if (res === "mana") return w.econ?.role?.get(i) === ROLE.adept ? "adept" : "idle";
      if (res === "fresh") return job.node?.kind === "fishery" ? "fish" : "forage";
      return "idle";
    }
    case "field": return job.b?.field?.state === "ripe" ? "reap" : "field";
    case "build": return w.econ?.role?.get(i) === ROLE.mason && BUILDINGS[job.b?.kind]?.stone && F_DRESS.ok ? "dress" : "build";
    case "craft": return "craft";
    case "firefight": return "fire";
    default: return HOME_MIX[(hash((S.name[i] >>> 0) * 5 + 11) * HOME_MIX.length) | 0];   // home, practice
  }
}

const HORSE_KEY = (S, i) => S.horse[i] === 3 ? "horse_strider" : S.horse[i] === 4 ? "horse_drake" : S.horse[i] === 2 ? ((S.kitMask[i] >>> 30) & 1 ? "horse_destrier_barded" : "horse_destrier") : "horse_light";
const GAIT_V = { horse_strider: 1.28, horse_drake: 0.78 }; // learned mounts run their gaits at their own speeds (js/sim/mounts.js speed)
const GAITS = [["idle", 0.25], ["walk", 2.5], ["trot", 4.5], ["canter", 7.0], ["gallop", 1e9]]; // m/s upper bounds (docs/units-horse.md)
const ID_Q = [0, 0, 0, 1];
// clips that come in weapon variants: <clip>_<weapon> (a kit.js weapon key) and <clip>_bare (no shield)
const ALT_BASE = ["idle", "walk", "run", "strike", "fall", "guard", "strike2", "strike_over", "strike_down", "parry", "hit", "hit_back", "press", "shove", "block", "bash"];
const DEATHS = ["fall", "fall_crumple", "fall_clutch", "fall", "fall_crumple", "fall_fwd"];   // from the front (hashed); from behind: fall_fwd
const MOUNTED_ARMS = new Set(ARM_BY_ID.filter((a) => a.mounted).map((a) => a.key));
const LANCE_ID = WEAPON_KEYS.indexOf("lance");
// one-shot action kinds (M.akind): what may interrupt what
const A_NONE = 0, A_STRIKE = 1, A_REACT = 2, A_KNOCK = 3, A_GETUP = 4, A_RIDE = 5;

export const FIGSTAT = { flips: 0, n: 0, old: 0, rawRev: 0, smRev: 0, blows: 0, blowEv: 0, reacts: 0, deaths: 0, thrown: 0, arrows: 0, stuck: 0 };
export function makeFigures(scene, map, { cap = 4096, base = "", lod1At = LOD1_AT } = {}) {
  const teamAcc = ["#d9a927", "#e9e4d6", "#e9e4d6", "#3a3a3a", "#cc3d39", "#d9a927", "#e9e4d6", "#3a3a3a"].map((c) => new THREE.Color(c));
  const arms = new Map();   // arm id -> figure set (men)
  const horses = new Map(); // "horse_light" | "horse_destrier" | "horse_destrier_barded" -> figure set
  let ready = false;
  const shadows = makeShadows(cap * 2); scene.add(shadows.mesh);
  const fx = makeBattleFx(scene, map, SUN_DIR);

  async function makeSet(key) {
    const A = await loadArm(key, base); const VU = vatUniforms(A); const mat = makeMaterial(A, teamAcc, VU);
    const F = { A, key, meshes: [], attrs: [], n: [0, 0], cap };
    for (let l = 0; l < 2; l++) {
      const geo = A.geos[l] || A.geos[0];
      const mk = () => new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
      const at = { iPos: mk(), iAnim: mk(), iLook: mk(), iQuat: mk(), iPrev: mk() };
      for (const [k, a] of Object.entries(at)) geo.setAttribute(k, a);
      const im = new THREE.InstancedMesh(geo, mat, cap); im.count = 0; im.frustumCulled = false;
      scene.add(im); F.meshes.push(im); F.attrs.push(at);
    }
    F.idx = A.clipIndex; F.clip = A.meta.clips; F.parts = A.meta.parts || {}; F.paired = !!A.meta.pairedDyes; F.seat = A.meta.seat || null;
    // clip variants (docs/units-pipeline.md): <clip>_<weapon> for men carrying that weapon, <clip>_bare for men
    // without a shield. alt[weaponId][baseIndex] / bare[baseIndex] -> variant index; meta[index] -> clip entry
    F.meta = []; F.name = []; for (const [n, c] of Object.entries(F.clip)) { F.meta[F.idx[n]] = c; F.name[F.idx[n]] = n; }
    F.alt = WEAPON_KEYS.map((wk) => { let o = null; for (const b of ALT_BASE) { const v = F.idx[b + "_" + wk]; if (v !== undefined && F.idx[b] !== undefined) (o ||= {})[F.idx[b]] = v; } return o; });
    F.bare = null; for (const b of ALT_BASE) { const v = F.idx[b + "_bare"]; if (v !== undefined && F.idx[b] !== undefined) (F.bare ||= {})[F.idx[b]] = v; }
    F.tools = F.clip.work_hoe !== undefined && F.parts.hoe !== undefined;   // the villager set: job loadouts
    if (F.tools && F.clip.work_chisel !== undefined) F_DRESS.ok = true;
    F.missile = F.parts.bow !== undefined;   // bow / crossbow in hand except in melee (then the sidearm)
    F.combat = F.idx.guard !== undefined;    // the fighting set (_combat_anims.py)
    F.anchors = buildAnchors(A, F, key.startsWith("horse_"));
    // arrows stuck in these figures
    const sg = stuckGeometry(); const sm = { iPos: null, iAnim: null, iQuat: null, iPrev: null, iStk: null };
    for (const k of Object.keys(sm)) { sm[k] = new THREE.InstancedBufferAttribute(new Float32Array(STUCK_CAP * 4), 4).setUsage(THREE.DynamicDrawUsage); sg.setAttribute(k, sm[k]); }
    sg.instanceCount = 0;
    const smesh = new THREE.Mesh(sg, makeStuckMaterial(VU)); smesh.frustumCulled = false; scene.add(smesh);
    F.stuck = { geo: sg, at: sm, n: 0 };
    return F;
  }
  // VAT rows an arrow may stick in, from the rest pose (the first frame of idle): body (front / back halves),
  // shield faces (the side away from the man), a planted pavise's face; horses: back, flanks, neck, rump
  function buildAnchors(A, F, horse) {
    const { meta, data, geos } = A; const nv = meta.verts[0] + meta.verts[1], lo = meta.bounds.min, hi = meta.bounds.max;
    const c0 = meta.clips.idle?.start ?? 0, uv1 = geos[0]?.attributes.uv1; if (!uv1) return null;
    const part = new Int16Array(meta.verts[0]).fill(-1);
    for (let k = 0; k < uv1.count; k++) { const r = Math.round(uv1.getX(k)); if (r < meta.verts[0]) part[r] = Math.round(1 - uv1.getY(k)); }
    const pos = (r) => { const o = (c0 * nv + r) * 4; return [lo[0] + data[o] / 65535 * (hi[0] - lo[0]), lo[1] + data[o + 1] / 65535 * (hi[1] - lo[1]), lo[2] + data[o + 2] / 65535 * (hi[2] - lo[2])]; };
    const nrm = (r) => { const w = data[(c0 * nv + r) * 4 + 3]; let x = (w >> 8) / 255 * 2 - 1, y = (w & 255) / 255 * 2 - 1, z = 1 - Math.abs(x) - Math.abs(y); const t = Math.max(-z, 0); x += x >= 0 ? -t : t; y += y >= 0 ? -t : t; const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
    const out = { front: [], back: [], legs: [], shield: [], pavise: [], buckler: [] };
    const P = F.parts, shieldIds = new Set([P.shield].filter((x) => x !== undefined));
    for (let r = 0; r < meta.verts[0]; r += 1) {
      const p = pos(r), n = nrm(r), pt = part[r];
      if (horse) { if (pt === 0 && p[1] > 1.0 && Math.abs(p[2]) < 1.05) (n[2] > 0.3 ? out.front : out.back).push(r); continue; }
      if (pt === 0) {
        if (p[1] > 0.95 && p[1] < 1.48 && Math.abs(p[0]) < 0.26) (n[2] > 0 ? out.front : out.back).push(r);
        else if (p[1] > 0.5 && p[1] <= 0.95) out.legs.push(r);
      } else if (shieldIds.has(pt)) {
        const hx = p[0], hz = p[2], hl = Math.hypot(hx, hz) || 1;
        if ((n[0] * hx + n[2] * hz) / hl > 0.35) out.shield.push(r);
      } else if (pt === P.pavise && n[2] > 0.5) out.pavise.push(r);
    }
    const thin = (a, k) => a.filter((_, j) => j % k === 0);
    for (const k of Object.keys(out)) out[k] = thin(out[k], Math.max(1, Math.floor(out[k].length / 60)));
    out.shieldPart = P.shield || 0; out.pavisePart = P.pavise || 0;
    return out;
  }
  // sets load lazily: only the arms (and horses) that are actually on the field, found by a scan of the soldiers once
  // a second (want()); a man whose set is still loading stays a dot. ?figures=all loads every set up front.
  let avail = null; const asked = new Set(), setOf = new Map();   // key -> VAT set key that draws it
  function want(key) {
    const src = key && setOf.get(key); if (!src || asked.has(src)) return; asked.add(src);
    makeSet(src).then((F) => {
      if (src.startsWith("horse_")) { horses.set(src, F); return; }
      for (const [k, s] of setOf) if (s === src) { const def = ARM_BY_ID.find((a) => a.key === k); if (def) arms.set(def.id, F); }
    }).catch((e) => console.warn("figure missing", src, e));
  }
  fetch(base + "assets/units/index.json").then((r) => r.json()).then(({ arms: list }) => {
    avail = new Set(list);
    for (const k of list) if (k.startsWith("horse_")) setOf.set(k, k);
    // arms with no VAT set of their own are drawn with another's (siege engine crews: villagers)
    for (const A of ARM_BY_ID) { const s = avail.has(A.key) ? A.key : avail.has(A.figure) ? A.figure : null; if (s) setOf.set(A.key, s); }
    if (/[?&]figures=all\b/.test(location.search)) for (const k of setOf.keys()) want(k);
    ready = true;
  }).catch(() => { ready = true; });
  const keyOfArm = []; for (const A of ARM_BY_ID) keyOfArm[A.id] = A.key;
  const armIdOf = new Map(ARM_BY_ID.map((A) => [A.key, A.id]));   // (render-only actors name their set by arm key)
  const extras = [];   // render-only actors, filled each frame by the lanes (see update)
  let scanAt = -1e9;
  function scanWanted(w, now) {
    if (!avail || now - scanAt < 1) return; scanAt = now;
    const S = w.S, seen = new Set();
    for (let i = 0; i < S.n; i++) {
      const a = S.arm[i]; if (!seen.has(a)) { seen.add(a); want(keyOfArm[a]); }
      if (S.horse[i] || S.horseOK[i] >= 1) want(HORSE_KEY(S, i));
    }
    for (const D of deadHorses) want(D.key);
    for (const L of looseHorses) want(L.key);
  }

  // ---- per-soldier render memory (grows with S)
  let M = null;
  const F32 = ["phase", "t0", "yaw", "nsPrev", "fade", "hphase", "ht0", "rearT", "busyPrev", "sx", "sy", "sv", "gait", "moving", "rg", "rdx", "rdy", "sdx", "sdy", "rx", "ry",
    "pphase", "bT0", "hpphase", "hbT0", "actT0", "naPrev", "planT", "dieT0", "lowerT", "offx", "offy", "offz", "tvx", "tvy", "tvz", "tT0", "twx", "twy", "twz", "tw", "tyaw", "coverT", "shoveT", "lastBlow", "lastPh", "blowEvT", "knockYaw", "knockT", "flinchT", "flinchS"];
  const I16 = ["clip", "hclip", "pclip", "hpclip", "act", "plan", "die"];
  const U8 = ["seen", "okPrev", "stPrev", "akind", "knocked", "thrown", "couched", "postPrev", "wasAlive"];
  function mem(S) {
    if (M && M.cap >= S.cap) return M;
    const n = S.cap, old = M;
    M = { cap: n, loose: new Float32Array(n).fill(-1e9), name: new Int32Array(n) };
    for (const k of F32) M[k] = new Float32Array(n);
    for (const k of I16) M[k] = new Int16Array(n).fill(-1);
    for (const k of U8) M[k] = new Uint8Array(n);
    M.rearT.fill(-1e9); M.knockT.fill(-1e9); M.flinchT.fill(-1e9); M.planT.fill(-1); M.lastBlow.fill(-1e9); M.coverT.fill(-1e9); M.blowEvT.fill(-1e9);
    if (old) { for (const k of ["loose", "name", ...F32, ...I16, ...U8]) M[k].set(old[k]); }
    return M;
  }
  const deadHorses = []; // { key, x, y, yaw, t0, coat, team, arrows } — a horse brought down stays where it fell
  const looseHorses = []; // { key, x, y, yaw, v, t0, coat, team, hphase } — riderless horses running loose, then standing

  // ---- arrows stuck in figures: flat arrays, host = man id (kind 0), his horse (kind 1), a dead horse (kind 2)
  const stuck = { n: 0, host: new Int32Array(STUCK_CAP), kind: new Uint8Array(STUCK_CAP), row: new Int32Array(STUCK_CAP), part: new Uint8Array(STUCK_CAP),
    seed: new Float32Array(STUCK_CAP), tilt: new Float32Array(STUCK_CAP), name: new Int32Array(STUCK_CAP) };
  const perMan = new Map(), perHorse = new Map();
  function addStuck(kind, host, row, part, name, tilt) {
    if (row < 0) return;
    const cnt = kind === 0 ? perMan : perHorse, c = cnt.get(host) || 0;
    if (c >= (kind === 0 ? MAX_STUCK_MAN : MAX_STUCK_HORSE)) return;
    let k = stuck.n; if (k >= STUCK_CAP) k = (Math.random() * STUCK_CAP) | 0; else stuck.n++;
    stuck.host[k] = host; stuck.kind[k] = kind; stuck.row[k] = row; stuck.part[k] = part; stuck.seed[k] = Math.random(); stuck.tilt[k] = tilt; stuck.name[k] = name;
    cnt.set(host, c + 1); FIGSTAT.stuck++;
  }
  const pick = (a, r) => a && a.length ? a[(r * a.length) | 0] : -1;

  // chunk frustum cache
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), box = new THREE.Box3();
  const NC = Math.ceil(map.size / CHUNK) + 1, CX0 = map.x0 || 0, CY0 = map.y0 || 0, chunkStamp = new Int32Array(NC * NC), chunkVis = new Uint8Array(NC * NC); let stamp = 0;
  function chunkVisible(x, y) {
    const ci = Math.max(0, Math.min(NC - 1, ((x - CX0) / CHUNK) | 0)), cj = Math.max(0, Math.min(NC - 1, ((y - CY0) / CHUNK) | 0)), k = cj * NC + ci; // (chunks from the map's corner)
    if (chunkStamp[k] !== stamp) {
      chunkStamp[k] = stamp;
      const x0 = CX0 + ci * CHUNK, y0 = CY0 + cj * CHUNK, h = map.h(x0 + CHUNK / 2, y0 + CHUNK / 2);
      box.min.set(x0 - 4, h - 25, -(y0 + CHUNK + 4)); box.max.set(x0 + CHUNK + 4, h + 25, -(y0 - 4));
      chunkVis[k] = frustum.intersectsBox(box) ? 1 : 0;
    }
    return chunkVis[k] === 1;
  }

  const inCastle = (w, x, y) => { const Cs = w.castles; if (!Cs) return false; for (let k = 0; k < Cs.length; k++) { const b = Cs[k]._?.bbox; if (b && x >= b[0] && y >= b[1] && x <= b[2] && y <= b[3]) return true; } return false; };
  // which optional kit a man carries (part bits, see each arm's <arm>_vat.json "parts"). Parts named after a
  // js/sim/kit.js weapon key are that man's weapon (for missile arms only in melee: the bow is put down).
  let kb2 = 0;   // the second kit mask (parts 24+), set by kitBits beside the bits it returns
  function kitBits(F, w, i, mounted, planted, lo, fighting) {
    const S = w.S, P = F.parts; let bits = 0; kb2 = 0;
    if (P.shield && S.shield[i] && (S.shieldArm[i] || !S.alive[i])) bits |= 1 << P.shield;
    if (P.lance) bits |= 1 << (mounted && S.weapon[i] === LANCE_ID || !P.sword ? P.lance : P.sword); // knights: lance until it breaks, then the sword
    else if (lo) { // villagers carry the kit for the job they are on (VILLAGER_KIT)
      for (const k of lo.kit) if (P[k]) { if (P[k] < 24) bits |= 1 << P[k]; else kb2 |= 1 << (P[k] - 24); }
      if (lo.workKit && S.state[i] === S_WORK) for (const k of lo.workKit) if (P[k]) { if (P[k] < 24) bits |= 1 << P[k]; else kb2 |= 1 << (P[k] - 24); }
    } else {
      const wk = WEAPON_BY_ID[S.weapon[i]]?.key;
      if (P.pike) bits |= 1 << P.pike;
      if (F.missile && !fighting) bits |= 1 << P.bow;
      else if (wk && P[wk]) bits |= 1 << P[wk];
      else if (P.sword && !P.bow) bits |= 1 << P.sword;
      if (P.buckler && S.shield[i] === SH_BUCKLER) bits |= 1 << (fighting ? P.buckler : P.buckler_belt);
    }
    const km = S.kitMask[i] >>> 0;
    if (P.helm) bits |= 1 << ((km & 1) ? P.helm : (P.cap ?? P.hat ?? P.helm));    // iron hat (kit bit 0) or cloth cap
    if (P.visor && (km >> 3) & 1) bits |= 1 << P.visor;                            // face zone, first layer: visor
    if (P.mail && (km >> 9) & 1) bits |= 1 << P.mail;                              // torso zone, first layer: mail
    if (P.pavise && S.pavise[i] && !S.lvl[i] && !(w.castleLevelH && w.castleLevelH(i) > 0.5)) bits |= 1 << (planted ? P.pavise : P.pavise_back); // (no pavise up on a wall, a tower or a stair: it would stand out over the drop — the parapet is his cover there)
    return bits;
  }

  // per unit, once a frame: pikemen standing to receive horse; mounted units: how far to the nearest enemy
  const unitMemo = new Map();
  function unitInfo(w, u) {
    if (!u || !u.members?.length) return null;
    let c = unitMemo.get(u.id); if (c && c.stamp === stamp) return c;
    c = { stamp, brace: u.formation === "schiltron", enemyD: 1e9 };
    const mounted = MOUNTED_ARMS.has(ARM_BY_ID[w.S.arm[u.members[0]]]?.key);
    for (const e of w.units.values()) {
      if (e.team === u.team || !e.members?.length) continue;
      const d = Math.hypot(e.ax - u.ax, e.ay - u.ay);
      if (mounted && d < c.enemyD) c.enemyD = d;
      if (!c.brace && MOUNTED_ARMS.has(ARM_BY_ID[w.S.arm[e.members[0]]]?.key) && (e.moving || e.c?.phase === "charge" || e.c?.phase === "approach") && d < 90) c.brace = true;
    }
    if (mounted && u.c?.target) { const t = w.units.get(u.c.target); if (t?.members?.length) c.enemyD = Math.min(c.enemyD, Math.hypot(t.ax - u.ax, t.ay - u.ay)); }
    unitMemo.set(u.id, c); return c;
  }

  function pickClip(F, w, i, spd, lo) {
    const S = w.S, st = S.state[i], has = (c) => F.idx[c] !== undefined;
    if (st === S_FLEE) return "run";
    if (st === S_FIGHT) return has("guard") ? "guard" : "strike";
    if (lo) {   // villagers: the job's clips (VILLAGER_KIT)
      const c = st === S_WORK ? lo.work : spd < 0.25 ? lo.idle : spd < RUN_AT ? lo.walk : "run";
      return has(c) ? c : spd < 0.25 ? "idle" : spd < RUN_AT ? "walk" : "run";
    }
    if (st === S_WORK) return has("work") ? "work" : "idle";
    if (spd < 0.25) return "idle";
    return spd < RUN_AT ? "walk" : "run";
  }

  // phase of a clip: loops integrate their rate (speed-scaled for gaits), one-shots run from t0
  function advance(C, cur, t0, dt, now, spd, jitter) {
    if (!C.loop) return Math.max(0, Math.min((now - t0) * C.fps, C.frames - 1)) / C.frames;
    if (!(cur >= 0)) cur = 0;
    let rate = C.fps / C.frames;
    rate *= C.speed ? Math.max(0.55, Math.min(1.8, spd / C.speed)) : jitter;
    return (cur + dt * rate) % 1;
  }
  const dur = (C) => C.frames / C.fps;
  // variant of a base clip for this man's weapon / shield, or -1
  function variant(F, S, i, name) {
    let ci = F.idx[name]; if (ci === undefined) return -1;
    const alt = F.alt[S.weapon[i]];
    if (alt && alt[ci] !== undefined) return alt[ci];
    if (F.bare && F.bare[ci] !== undefined && !(F.parts.shield && S.shield[i] && S.shieldArm[i])) return F.bare[ci];
    return ci;
  }

  let sh = null, ns = 0;
  const convoyOut = new Set();   // convoy crews (unit ids) walking out loaded
  const TMPQ = [0, 0, 0, 1];
  function put(F, lod, x, h, z, yaw, ci, phase, scale, bits, look, d1, d2, fade, q = ID_Q, pc = -1, pp = 0, pw = 0, b2 = 0) {
    const at = F.attrs[lod], k = F.n[lod];
    if (k >= F.cap) return -1; F.n[lod]++;
    const P = at.iPos.array, An = at.iAnim.array, Lk = at.iLook.array, Q = at.iQuat.array, Pv = at.iPrev.array, o = k * 4;
    P[o] = x; P[o + 1] = h; P[o + 2] = z; P[o + 3] = yaw;
    An[o] = ci; An[o + 1] = phase; An[o + 2] = scale; An[o + 3] = bits;
    Lk[o] = look; Lk[o + 1] = d1; Lk[o + 2] = F.paired ? d1 : d2; Lk[o + 3] = fade;   // paired palettes (horses): one coat
    Q[o] = q[0]; Q[o + 1] = q[1]; Q[o + 2] = q[2]; Q[o + 3] = q[3];
    Pv[o] = pc < 0 ? ci : pc; Pv[o + 1] = pp; Pv[o + 2] = pc < 0 ? 0 : pw; Pv[o + 3] = b2;   // (w: the second kit mask, parts 24+)
    return o;
  }
  function shadow(x, h, z, fade, size, lying) {
    if (ns >= shadows.cap) return; const q = ns++ * 4;
    sh[q] = x; sh[q + 1] = h; sh[q + 2] = z; sh[q + 3] = (lying ? -1 : 1) * (size + Math.min(0.999, fade));
  }
  // the horse's saddle at (clip, phase): lerp the two bracketing frames exactly as the VAT does
  const seatP = [0, 0, 0], seatQ = [0, 0, 0, 1];
  const HPOSE = { h: 0, q: [0, 0, 0, 1] }, SEATS = [0, 0, 0], SEATT = [0, 0, 0], SEATQ = [0, 0, 0, 1]; // (the horse's tilt and the seat through it: footing.js)
  function seatAt(HF, clip, phase) {
    const tr = HF.seat?.[clip], C = HF.clip[clip];
    if (tr && (!C || tr.length < C.frames)) { seatAt(HF, "idle", 0); return; }
    if (!tr) { const r = HF.A.meta.seatRest || [0, 1.4, 0]; seatP[0] = r[0]; seatP[1] = r[1]; seatP[2] = r[2]; seatQ[0] = seatQ[1] = seatQ[2] = 0; seatQ[3] = 1; return; }
    if (!(phase >= 0)) phase = 0;   // NaN / negative guard
    const fr = Math.min(phase, 0.99999) * C.frames, f0 = Math.min(Math.floor(fr), C.frames - 1), a = fr - f0;
    const f1 = f0 + 1 > C.frames - 1 ? (C.loop ? 0 : C.frames - 1) : f0 + 1;
    const A0 = tr[f0], A1 = tr[f1];
    for (let k = 0; k < 3; k++) seatP[k] = A0[k] + (A1[k] - A0[k]) * a;
    let dot = 0; for (let k = 0; k < 4; k++) dot += A0[k + 3] * A1[k + 3];
    const sgn = dot < 0 ? -1 : 1; let n = 0;
    for (let k = 0; k < 4; k++) { seatQ[k] = A0[k + 3] + (sgn * A1[k + 3] - A0[k + 3]) * a; n += seatQ[k] * seatQ[k]; }
    n = Math.sqrt(n) || 1; for (let k = 0; k < 4; k++) seatQ[k] /= n;
  }

  // ---- the event tap: a read-only system appended to the sim's per-tick systems, so every tick's events are seen
  const evq = [];
  let tapped = null, sawArrowEv = false;
  const TAP = new Set(["blow", "arrow", "knock", "stoned", "impact", "kill", "down", "horse", "shove", "lance", "thrown"]);
  function tap(w) { if (tapped !== w && Array.isArray(w.systems)) { tapped = w; w.systems.push(function figuresTap(W) { for (const e of W.events) if (TAP.has(e.kind)) { e._time = W.time; evq.push(e); } if (evq.length > 4000) evq.splice(0, evq.length - 4000); }); } }
  const deathInfo = new Map();   // victim -> { by, cause, t, stone }

  // ---- one-shot actions
  function startAct(i, F, ci, t0, kind) {
    const m = M; if (ci < 0) return false;
    m.act[i] = ci; m.actT0[i] = t0; m.akind[i] = kind; return true;
  }
  function actPhase(F, i, now) { const C = F.meta[M.act[i]]; return (now - M.actT0[i]) / dur(C); }
  // the blow lands: the defender answers (block / parry / stagger), unless he is down
  function onBlow(w, a, d, res, now, fromEv) {
    const S = w.S; FIGSTAT.blows++; if (fromEv) FIGSTAT.blowEv++;
    M.lastBlow[a] = now;
    const Fa = arms.get(S.arm[a]);
    // the attacker: if no strike was seen winding up for this blow, show its follow-through now
    if (Fa && M.akind[a] !== A_STRIKE && S.horseOK[a] !== 1 && Fa.combat) {
      const ci = chooseStrike(Fa, w, a, d); if (ci >= 0) { const C = Fa.meta[ci]; startAct(a, Fa, ci, now - (C.hit ?? 0.45) * dur(C), A_STRIKE); }
    }
    if (d < 0 || !S.alive[d] || S.posture[d] || S.state[d] === S_DOWN || S.state[d] === S_DEAD) return;
    const Fd = arms.get(S.arm[d]); if (!Fd || !M.seen[d]) return;
    if (M.akind[d] === A_KNOCK || M.akind[d] === A_GETUP) return;
    const mountedD = S.horseOK[d] === 1;
    const bearing = Math.atan2(S.y[a] - S.y[d], S.x[a] - S.x[d]); const off = Math.abs(wrapPi(S.facing[d] - bearing));
    const r = hash((a * 7919 + d * 104729 + ((now * 10) | 0)) >>> 0);
    let clip;
    if (mountedD) clip = res >= 2 || (res < 0 && r < 0.5) ? "ride_hit" : null;
    else if (off > 2.1) clip = "hit_back";
    else {
      const shield = !!(S.shield[d] && S.shieldArm[d] && Fd.idx.block !== undefined && S.shield[d] !== SH_BUCKLER);
      if (res === 1 || (res < 0 && shield && r < 0.5)) clip = shield ? "block" : "parry";
      else if (res === 0 || (res < 0 && r < (shield ? 0.75 : 0.45))) clip = Fd.idx.parry !== undefined || Fd.alt[S.weapon[d]] ? "parry" : "hit";
      else clip = "hit";
    }
    if (!clip) return;
    const ci = mountedD ? (Fd.idx[clip] ?? -1) : variant(Fd, S, d, clip); if (ci < 0) return;
    const C = Fd.meta[ci];
    startAct(d, Fd, ci, now - 0.08 * dur(C), A_REACT); FIGSTAT.reacts++;
    // the blow's weight moves him: the stagger is along the line of the blow (his figure turns toward it anyway)
  }
  function chooseStrike(F, w, i, f) {
    const S = w.S, has = (c) => variant(F, S, i, c);
    const d = f >= 0 ? Math.hypot(S.x[f] - S.x[i], S.y[f] - S.y[i]) : 1;
    const r = hash((S.name[i] >>> 0) * 31 + (S.nextAtk[i] * 10 | 0));
    const shield = S.shield[i] && S.shieldArm[i] && S.shield[i] !== SH_BUCKLER;
    if (shield && r < 0.2 && d < 1.4 && has("bash") >= 0) return has("bash");
    if (S.rank[i] >= 1 && d > 1.9 && has("strike_over") >= 0) return has("strike_over");
    if (r > 0.62 && has("strike2") >= 0) return has("strike2");
    return has("strike");
  }
  // killed or downed: which way he goes, and whether a stone throws him
  function startDeath(w, i, F, now, ev, x, y) {
    const S = w.S, nm = S.name[i] >>> 0, info = deathInfo.get(i);
    FIGSTAT.deaths++;
    let name = DEATHS[(hash(nm * 3 + 17) * DEATHS.length) | 0];
    if (info?.by >= 0 && S.x[info.by] !== undefined) {
      const bearing = Math.atan2(S.y[info.by] - y, S.x[info.by] - x); if (Math.abs(wrapPi(S.facing[i] - bearing)) > 2.0) name = "fall_fwd";
    }
    if (S.state[i] === S_DOWN && hash(nm * 5 + 1) < 0.6) name = "fall";   // the downed mostly on their backs (then writhe)
    if (info?.cause === "missile" && name === "fall_clutch") name = "fall_crumple";
    let ci = F.idx[name] ?? F.idx.fall;
    // a stone: the first man in its path is driven flat where he stood; the men beside it are thrown
    if (info?.stone) {
      const st = info.stone, dx = x - st.x, dy = y - st.y, dd = Math.hypot(dx, dy) || 0.01;
      if (!(st.first || dd < 0.8) && F.idx.thrown !== undefined) {
        const v = (st.big ? 5.5 : 3.5) * (0.6 + 0.6 * hash(nm + 3)) / Math.max(0.8, Math.sqrt(dd));
        M.thrown[i] = 1; M.tT0[i] = now; M.tvx[i] = dx / dd * v + (st.ux || 0) * 1.0; M.tvy[i] = dy / dd * v + (st.uy || 0) * 1.0; M.tvz[i] = 1.8 + v * 0.45;
        M.offx[i] = 0; M.offy[i] = 0; M.offz[i] = 1.0;
        const ax = -dy / dd, ay = dx / dd; M.twx[i] = ax; M.twy[i] = 0; M.twz[i] = -ay; M.tw[i] = (6 + 6 * hash(nm + 9)) * (hash(nm + 1) < 0.5 ? 1 : -1);
        name = hash(nm + 7) < 0.5 ? "fall" : "fall_fwd"; ci = F.idx[name] ?? F.idx.fall;
        // lands along the throw: face-down with the head away from the blast, or on his back with the feet toward it
        M.tyaw[i] = Math.atan2(dy, dx) + (name === "fall_fwd" ? 0.5 : 1.5) * Math.PI; FIGSTAT.thrown++;
        fx.puff(x, map.h(x, y), y, 1.2, 4, 1.2);
      } else { name = "fall_fwd"; ci = F.idx.fall_fwd ?? ci; M.dieT0[i] = now - 0.6 * dur(F.meta[ci]); M.die[i] = ci; fx.patch(x, y, 0.8, true, w.time); return; }
    }
    M.die[i] = ci; M.dieT0[i] = now;
    fx.patch(x + (Math.random() - 0.5) * 0.6, y + (Math.random() - 0.5) * 0.6, 0.45 + Math.random() * 0.3, true, w.time + 0.5);
  }

  // ---- arrows: shafts seen leaving the bow, followed to where they land
  const flightsSeen = new WeakSet(); const inAir = [];
  const nb = [];
  function trackFlights(w, simNow) {
    const F = w.cs?.flights; if (!F) return;
    const S = w.S;
    for (const f of F) {
      if (flightsSeen.has(f)) continue; flightsSeen.add(f);
      const by = f.by, x0 = f.x0 ?? S.x[by], y0 = f.y0 ?? S.y[by], t0 = f.t0 ?? simNow;
      const h0 = map.h(x0, y0) + 1.45, h1 = map.h(f.x, f.y) + 0.05, R = Math.hypot(f.x - x0, f.y - y0);
      const apex = Math.max(0.2, (R * Math.tan(f.ang) + (h1 - h0)) / 4);
      const bolt = f.key === "crossbow";
      fx.flight(x0, h0, y0, t0, f.x, h1, f.y, f.tI, apex, bolt); FIGSTAT.arrows++;
      inAir.push({ f, tI: f.tI, bolt });
    }
    // landed (the sim has resolved it): stick it where it went
    let j = 0;
    for (const a of inAir) { if (a.tI > simNow) { inAir[j++] = a; continue; } if (!sawArrowEv) landFallback(w, a.f, a.bolt); }
    inAir.length = j;
  }
  function stickIn(w, hit, on, f, bolt) {
    const S = w.S, F = arms.get(S.arm[hit]); const ang = f.ang ?? 0.4;
    const dirx = f.ux ?? 0, diry = f.uy ?? 0;
    if (on === "horse" || on === "horsecover") {
      const HF = horses.get(HORSE_KEY(S, hit)); const A = HF?.anchors; if (!A) return;
      const r = Math.random(), yawM = M.yaw[hit], toward = Math.cos(Math.atan2(-diry, -dirx) - (yawM - Math.PI / 2)) > 0;
      addStuck(1, hit, pick(toward ? A.front : A.back, r), 0, S.name[hit], 0.4); return;
    }
    const A = F?.anchors; if (!A) return;
    const r = Math.random(), toward = Math.cos(S.facing[hit] - Math.atan2(-diry, -dirx)) > 0;
    if (on === "shield") addStuck(0, hit, pick(A.shield, r), A.shieldPart, S.name[hit], 0.1);
    else if (on === "pavise") addStuck(0, hit, pick(A.pavise, r), A.pavisePart, S.name[hit], 0.2);
    else addStuck(0, hit, r < 0.2 ? pick(A.legs, r * 5) : pick(toward ? A.front : A.back, r), 0, S.name[hit], ang > 0.6 ? 0.6 : 0.15);
  }
  function landFallback(w, f, bolt) {
    // the sim's strip test (ballistics.js land), repeated to find who stood under the falling shaft
    const S = w.S, tanA = Math.max(0.03, Math.tan(f.ang)), L = Math.min(30, 1.7 / tanA);
    neighbours(w, f.x - f.ux * L / 2, f.y - f.uy * L / 2, L / 2 + 1, nb);
    let hit = -1, best = 1e9;
    for (const o of nb) {
      if (!S.alive[o] && S.state[o] !== S_DEAD && S.state[o] !== S_DOWN) continue;
      const mounted = S.horseOK[o] === 1, dx = S.x[o] - f.x, dy = S.y[o] - f.y;
      const along = -(dx * f.ux + dy * f.uy), lat = Math.abs(-dx * f.uy + dy * f.ux), rr = mounted ? 0.62 : 0.26;
      const len = S.alive[o] && !S.posture[o] ? (mounted ? 2.6 : 1.7) / tanA : 0.3 / tanA;
      if (lat > rr || along < -rr || along > len + rr || along > best) continue;
      best = along; hit = o;
    }
    const hh = map.h(f.x, f.y), cA = Math.cos(f.ang), sA = Math.sin(f.ang);
    if (hit < 0) { fx.stick(f.x, hh, f.y, f.ux * cA, -sA, -f.uy * cA, 0.10 + 0.12 * Math.random(), bolt); return; }
    const toward = Math.cos(S.facing[hit] - Math.atan2(-f.uy, -f.ux)) > 0.5, r = Math.random();
    let on = "body";
    if (S.horseOK[hit] === 1 && r < 0.6) on = "horse";
    else if (S.pavise[hit] && !S.lvl[hit] && toward && S.alive[hit] && r < 0.8 && Math.hypot(S.vx[hit], S.vy[hit]) < 0.3) on = "pavise";
    else if (S.shield[hit] && S.shieldArm[hit] && toward && r < 0.6) on = "shield";
    else if (r > 0.85) { fx.stick(f.x - f.ux * 0.4, hh, f.y - f.uy * 0.4, f.ux * cA, -sA, -f.uy * cA, 0.12, bolt); return; }   // a near miss at his feet
    stickIn(w, hit, on, f, bolt);
  }

  function processEvents(w, now, simNow) {
    const S = w.S;
    for (const e of evq) {
      switch (e.kind) {
        case "blow": if (e.a >= 0 && M && e.a < M.cap) { M.blowEvT[e.a] = now; onBlow(w, e.a, e.d, e.res ?? -1, now - Math.max(0, simNow - e._time), true); } break;
        case "arrow": {
          sawArrowEv = true; const bolt = e.key === "crossbow", ang = e.ang ?? 0.4, cA = Math.cos(ang), sA = Math.sin(ang);
          if (e.hit >= 0 && e.on && e.on !== "ground" && e.on !== "cover") stickIn(w, e.hit, e.on === "armour" ? "body" : e.on, e, bolt);
          else fx.stick(e.x, map.h(e.x, e.y), e.y, e.ux * cA, -sA, -e.uy * cA, 0.10 + 0.12 * Math.random(), bolt);
          break;
        }
        case "kill": case "down": {
          const cur = deathInfo.get(e.victim) || {}; cur.by = e.by; cur.cause = e.cause; cur.t = now; deathInfo.set(e.victim, cur);
          if (e.cause === "stone" && !cur.stone && w.siege) {   // no "stoned" event: the freshest stone impact near him
            let best = null, bd = 144; for (const im of w.siege.impacts) { if (w.time - im.t > 1.5 || im.kind === "bolt") continue; const d2 = (im.x - S.x[e.victim]) ** 2 + (im.y - S.y[e.victim]) ** 2; if (d2 < bd) { bd = d2; best = im; } }
            if (best) cur.stone = { x: best.x, y: best.y, big: (best.size || 1) > 1.5, first: bd < 0.36 };
          }
          break;
        }
        case "stoned": { const cur = deathInfo.get(e.who) || {}; cur.stone = { x: e.x, y: e.y, ux: e.ux, uy: e.uy, first: !!e.first, big: e.big }; deathInfo.set(e.who, cur); break; }
        case "lance": case "impact": {   // a couched lance (or a horse) strikes home
          if (e.kind === "impact" && M.lanceEvT?.[e.who] > now - 0.3) break; if (e.kind === "lance") (M.lanceEvT ||= new Float32Array(M.cap))[e.who] = now;
          const i = e.who; const F = arms.get(S.arm[i]);
          if (F && M.seen[i] && F.idx.ride_impact !== undefined) { startAct(i, F, F.idx.ride_impact, now - 0.1 * dur(F.meta[F.idx.ride_impact]), A_RIDE); }
          const hx = Math.cos(S.facing[i]), hy = Math.sin(S.facing[i]);
          if (M.couched[i] || e.broke) { fx.splinters(S.x[i] + hx * 2.0, map.h(S.x[i], S.y[i]) + 1.35, S.y[i] + hy * 2.0, hx, hy, 5, true); M.couched[i] = 0; }
          fx.puff(S.x[i] + hx * 1.2, map.h(S.x[i], S.y[i]), S.y[i] + hy * 1.2, 1.4, 4, 0.8);
          if (e.on >= 0 && !(M.blowEvT[i] > now - 0.3)) onBlow(w, i, e.on, 3, now, false);
          break;
        }
        case "thrown": {   // ridden down: flung up and aside by the horse's chest. The sim has already put him where he lands
          // (e.disp m along e.dx, e.dy): he flies from where he stood to there, tumbling, and lands on his back
          const i = e.who; if (i < 0 || i >= M.cap || !M.seen[i] || !S.alive[i]) break;
          const F = arms.get(S.arm[i]); if (!F || F.idx.thrown === undefined) break;
          const nm = S.name[i] >>> 0, disp = e.disp || 1, tvz = Math.min(3.2, 0.9 + 0.3 * (e.speed || 4)), T = (tvz + Math.sqrt(tvz * tvz + 14.7)) / 9.8;
          M.thrown[i] = 1; M.tT0[i] = now; M.offx[i] = -e.dx * disp; M.offy[i] = -e.dy * disp; M.offz[i] = 1.0;
          M.tvx[i] = e.dx * disp / T; M.tvy[i] = e.dy * disp / T; M.tvz[i] = tvz;
          M.twx[i] = -e.dy; M.twy[i] = 0; M.twz[i] = -e.dx; M.tw[i] = (5 + 5 * hash(nm + 9)) * (hash(nm + 1) < 0.5 ? 1 : -1);
          M.tyaw[i] = Math.atan2(e.dy, e.dx) + 1.5 * Math.PI; FIGSTAT.thrown++;
          fx.puff(S.x[i] - e.dx * disp, map.h(S.x[i], S.y[i]), S.y[i] - e.dy * disp, 1.0, 3, 0.8);
          break;
        }
        case "knock": {   // over AWAY from what knocked him: turn him to face it, the knock clip falls backward
          const i = e.who; if (i >= 0 && i < M.cap && (e.dx || e.dy)) { M.knockYaw[i] = Math.atan2(-(e.dy), -(e.dx)) + Math.PI / 2; M.knockT[i] = now; }
          break;
        }
        case "shove": {   // one man drives another back: shoulder and shield in, the other staggers a step
          const a = e.a, d = e.d; if (a < 0 || d < 0 || a >= M.cap || d >= M.cap) break;
          const Fa = arms.get(S.arm[a]), Fd = arms.get(S.arm[d]);
          if (Fa?.combat && M.akind[a] === A_NONE && S.horseOK[a] !== 1) { const ci = variant(Fa, S, a, S.shield[a] && S.shieldArm[a] ? "bash" : "shove"); if (ci >= 0) startAct(a, Fa, ci, now - 0.3 * dur(Fa.meta[ci]), Fa.meta[ci].loop ? A_REACT : A_STRIKE); }
          if (Fd?.combat && S.alive[d] && !S.posture[d] && (M.akind[d] === A_NONE || M.akind[d] === A_REACT)) { const ci = variant(Fd, S, d, "hit"); if (ci >= 0) startAct(d, Fd, ci, now - 0.08 * dur(Fd.meta[ci]), A_REACT); }
          break;
        }
        case "horse": if (e.what === "flinch" && e.who >= 0 && e.who < M.cap) { M.flinchT[e.who] = now; M.flinchS[e.who] = (e.dx || 0) * Math.sin(S.facing[e.who]) - (e.dy || 0) * Math.cos(S.facing[e.who]) > 0 ? 1 : -1; } break;
      }
    }
    evq.length = 0;
  }

  function update(w, cam, selected, visibleFn, dt, sinceTick, now) {
    const S = w.S, m = mem(S); stamp++;
    tap(w);
    const simNow = w.time + (sinceTick || 0);
    for (const F of arms.values()) F.n[0] = F.n[1] = 0;
    for (const F of horses.values()) F.n[0] = F.n[1] = 0;
    m.fade.fill(0, 0, S.n);
    ns = 0; sh = shadows.iS.array;
    convoyOut.clear(); for (const c of w.convoys || []) if (c.phase === "out" && c.load > 0) convoyOut.add(c.id);
    scanWanted(w, now);
    if (!ready || !arms.size) { shadows.geo.instanceCount = 0; evq.length = 0; return; }
    processEvents(w, now, simNow);
    trackFlights(w, simNow);
    cam.updateMatrixWorld(); pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); frustum.setFromProjectionMatrix(pm);
    const cx = cam.position.x, cyH = cam.position.y, cz = -cam.position.z; // sim coords: x, y = -z
    const FAR2 = FIG_FAR * FIG_FAR;
    const inRange = (x, y) => { const dx = x - cx, dy = y - cz, d2 = dx * dx + dy * dy; if (d2 > FAR2 * 1.3) return -1; const dz = map.h(x, y) - cyH, d = Math.sqrt(d2 + dz * dz); return d > FIG_FAR ? -1 : d; };
    const recentShot = w.cs?.recentShot;
    for (const F of [...arms.values(), ...horses.values()]) F.drawnAt = F.drawnAt || new Map(), F.drawnAt.clear();
    for (let i = 0; i < S.n; i++) {
      const st = S.state[i], alive = S.alive[i] === 1;
      if (m.name[i] !== S.name[i]) { m.name[i] = S.name[i]; m.seen[i] = 0; m.die[i] = -1; m.act[i] = -1; m.akind[i] = 0; m.thrown[i] = 0; m.knocked[i] = 0; m.offx[i] = m.offy[i] = m.offz[i] = 0; perMan.delete(i); perHorse.delete(i); deathInfo.delete(i); m.wasAlive[i] = 0; m.planT[i] = -1; }
      if (!alive && st !== S_DOWN && st !== S_DEAD) { m.seen[i] = 0; m.okPrev[i] = 0; continue; }
      const F = arms.get(S.arm[i]); if (!F) continue;
      let x = S.x[i] + (alive ? S.vx[i] * sinceTick : 0), y = S.y[i] + (alive ? S.vy[i] * sinceTick : 0);
      // a horse brought down under its rider (horseOK 1 -> 0) stays on the field where it fell; he goes over its neck
      const ok = S.horseOK[i];
      if (m.okPrev[i] >= 1 && ok === 0 && !S.horse[i] && m.seen[i] && looseHorses.length < 300)   // dismounted (the lord and his household): the horse is led away
        looseHorses.push({ key: m.hkey?.[i] || "horse_destrier", x: x - Math.cos(m.yaw[i] - Math.PI / 2) * 1.5, y: y - Math.sin(m.yaw[i] - Math.PI / 2) * 1.5, yaw: m.yaw[i] + Math.PI, v: 1.3, walk: true, t0: now, coat: (hash((S.name[i] >>> 0) * 17 + 2) * 8) | 0, team: S.team[i], hphase: 0 });
      if (ok >= 1 && S.horse[i]) (m.hkey ||= [])[i] = HORSE_KEY(S, i);
      if (m.okPrev[i] >= 1 && ok === 0 && S.horse[i] && m.seen[i] && deadHorses.length < 600) {
        const D = { key: HORSE_KEY(S, i), x, y, yaw: m.yaw[i], t0: now, coat: (hash((S.name[i] >>> 0) * 17 + 2) * 8) | 0, team: S.team[i], hk: deadHorses.length };
        deadHorses.push(D); perHorse.delete(i);
        for (let k = 0; k < stuck.n; k++) if (stuck.kind[k] === 1 && stuck.host[k] === i) { stuck.kind[k] = 2; stuck.host[k] = D.hk; }
        if (alive && F.idx.thrown !== undefined) {   // thrown from the saddle: over the neck, the way the horse was going
          const hd = m.yaw[i] - Math.PI / 2, v = Math.max(2, m.sv[i] * 0.7);
          m.thrown[i] = 1; m.tT0[i] = now; m.tvx[i] = Math.cos(hd) * v; m.tvy[i] = Math.sin(hd) * v; m.tvz[i] = 1.6; m.offx[i] = 0; m.offy[i] = 0;
          m.twx[i] = Math.sin(hd); m.twy[i] = 0; m.twz[i] = Math.cos(hd); m.tw[i] = 5; m.offz[i] = 1.65; m.tyaw[i] = hd + 1.5 * Math.PI; FIGSTAT.thrown++;
        }
        fx.puff(x, map.h(x, y), y, 2, 6, 0.9);
      }
      // his rider killed in the saddle: the horse runs loose
      if (m.okPrev[i] >= 1 && ok >= 1 && !alive && m.wasAlive[i] && m.seen[i] && looseHorses.length < 300)
        looseHorses.push({ key: HORSE_KEY(S, i), x, y, yaw: m.yaw[i] + (hash(S.name[i] >>> 0) - 0.5) * 1.6, v: 5 + 3 * hash((S.name[i] >>> 0) + 5), t0: now, coat: (hash((S.name[i] >>> 0) * 17 + 2) * 8) | 0, team: S.team[i], hphase: 0, hclip: -1, host: i });
      m.okPrev[i] = ok;
      const d = inRange(x, y); if (d < 0) { m.seen[i] = 0; m.wasAlive[i] = alive ? 1 : 0; continue; }
      if (visibleFn && !visibleFn(i)) { m.seen[i] = 0; continue; }
      const fade = Math.min(1, (FIG_FAR - d) / (FIG_FAR - FIG_NEAR));
      m.fade[i] = fade;
      if (!chunkVisible(x, y)) { m.seen[i] = 0; m.wasAlive[i] = alive ? 1 : 0; continue; }
      const seen = m.seen[i];
      // ---- a body, not a dot: the figure keeps its own smoothed position and speed. Standing men ignore the
      // sim's sub-metre jostling (crowding pushes, slot corrections, fidget targets) until it adds up to a
      // real step; then they walk there and stop. Gaits change with hysteresis, never flicker.
      if (!seen) { m.sx[i] = x; m.sy[i] = y; m.sv[i] = 0; m.gait[i] = 0; m.moving[i] = 0; }
      let X = m.sx[i], Y = m.sy[i];
      { const ex = x - X, ey = y - Y, e = Math.hypot(ex, ey), simV = alive ? Math.hypot(S.vx[i], S.vy[i]) : 0;
        if (!alive || st === S_FIGHT) { X = x; Y = y; }                        // fighting men: exact (blows must line up)
        else {
          if (!m.moving[i] && (e > (inCastle(w, x, y) ? 0.15 : 0.45) || simV > 0.9)) m.moving[i] = 1; // drifted a real step: walk it (in a castle, a fraction of one: the stone is a body's width away — a figure left behind would stand in it, or on the parapet)
          if (m.moving[i] && e < 0.06 && simV < 0.35) m.moving[i] = 0;            // arrived: stand
          if (m.moving[i]) { const k = Math.min(1, dt * (e > 6 ? 12 : 6)); X += ex * k; Y += ey * k; }
          if (e > 25) { X = x; Y = y; }                                           // teleport-level gaps: snap
        }
        const mv = dt > 0 ? Math.hypot(X - m.sx[i], Y - m.sy[i]) / dt : 0;
        m.sv[i] += (mv - m.sv[i]) * Math.min(1, dt * 5);
        if (mv > 0.05 && m.moving[i]) m.head = Math.atan2(Y - m.sy[i], X - m.sx[i]); else m.head = null;
        m.sx[i] = X; m.sy[i] = Y;
        const v = m.sv[i], g = m.gait[i];
        const ng = g === 0 ? (v > 0.35 ? 1 : 0) : g === 1 ? (v < 0.15 ? 0 : v > 2.7 ? 2 : 1) : (v < 1.9 ? 1 : 2);
        if (ng !== g && seen) FIGSTAT.flips++; m.gait[i] = ng; FIGSTAT.n++;
      }
      let h = standH(map, X, Y) + (w.castleLevelH ? w.castleLevelH(i) : 0); // (castle levels: wall-walks, tower and keep floors — js/render/castle.js)
      const spd = !alive ? 0 : st === S_FIGHT || st === S_FLEE ? Math.hypot(S.vx[i], S.vy[i]) : [0, Math.max(0.6, m.sv[i]), Math.max(2.8, m.sv[i])][m.gait[i]];
      const lod = d < lod1Dist ? 0 : 1, nm = S.name[i] >>> 0;
      const look = Math.min(7, S.team[i]) + (selected.has(S.unit[i]) ? 8 : 0), d1 = (hash(nm * 7 + 3) * 8) | 0, d2 = (hash(nm * 11 + 9) * 8) | 0;
      const scale = 0.942 + 0.093 * hash(nm * 13 + 5), jitter = 0.9 + 0.2 * hash(i * 31 + 7);
      if (!seen) { m.phase[i] = hash(i * 7919 + 1); m.hphase[i] = hash(i * 104729 + 3); m.yaw[i] = S.facing[i] + Math.PI / 2; m.busyPrev[i] = S.busyT[i]; m.naPrev[i] = S.nextAtk[i]; m.postPrev[i] = S.posture[i]; m.pclip[i] = -1; }
      const HF = F.idx.ride !== undefined && ok >= 1 ? (horses.get(HORSE_KEY(S, i)) || horses.get("horse_light")) : null;
      const mounted = !!HF && alive;
      const fighting = st === S_FIGHT && alive;
      const still = alive && !mounted && !fighting && st !== S_FLEE && spd < 0.3;
      const lo = F.tools ? (laborKit(w, i, holdOf) || VILLAGER_KIT[villagerJob(w, i, w.units.get(S.unit[i]), convoyOut)]) : null;
      const uinfo = (mounted || F.idx.brace !== undefined) ? unitInfo(w, w.units.get(S.unit[i])) : null;
      const foe = fighting ? S.foe[i] : -1, foeOK = foe >= 0 && foe < S.n && (S.alive[foe] || S.state[foe] === S_DOWN);
      const foeD = foeOK ? Math.hypot(S.x[foe] - S.x[i], S.y[foe] - S.y[i]) : 9;

      // ================= choose what he is doing
      let clip = null, ci = -1, phase = 0, dying = false;
      // -- the fallen: fall once (the way the blow sent him), then lie still or writhe
      if (!alive) {
        if (m.die[i] < 0) {
          if (seen && m.wasAlive[i]) startDeath(w, i, F, now, null, x, y);
          else { const nmv = DEATHS[(hash(nm * 3 + 17) * DEATHS.length) | 0]; m.die[i] = F.idx[nmv] ?? F.idx.fall; m.dieT0[i] = now - 100; }
        }
        ci = m.die[i]; const C = F.meta[ci]; phase = advance(C, 0, m.dieT0[i], 0, now, 0, 1); dying = true;
        if (st === S_DOWN && phase >= 0.99 && F.idx.writhe !== undefined && F.name[ci] === "fall" && hash(nm * 5 + 1) < 0.5 && lod === 0) {
          ci = F.idx.writhe; phase = m.phase[i] = (m.phase[i] + dt * F.meta[ci].fps / F.meta[ci].frames * jitter) % 1;
        }
        m.act[i] = -1; m.akind[i] = 0;
      } else {
        if (m.die[i] >= 0) m.die[i] = -1;
        // -- knocked off his feet (alive, lying): over, struggle, then up
        const down = S.posture[i] !== 0 && !mounted;
        if (down && !m.knocked[i] && F.idx.knock !== undefined) { m.knocked[i] = 1; if (now - m.knockT[i] < 0.5) m.yaw[i] = m.knockYaw[i]; if (m.thrown[i] !== 1) startAct(i, F, F.idx.knock, now, A_KNOCK); else m.akind[i] = A_KNOCK, m.act[i] = F.idx.knock, m.actT0[i] = now - 5; }
        if (!down && m.knocked[i]) { m.knocked[i] = 0; if (F.idx.getup !== undefined) startAct(i, F, F.idx.getup, now, A_GETUP); }
        // -- blows: the sim's next blow time (S.nextAtk) is known in advance; wind the strike up so its contact
        // frame lands on it. A change of S.nextAtk means the last one was struck (unless the sim reports it).
        const na = S.nextAtk[i];
        if (na !== m.naPrev[i]) {
          if (!(m.blowEvT[i] > now - 0.4) && fighting && m.naPrev[i] > 0 && na > m.naPrev[i] && simNow - m.naPrev[i] < 0.6 && simNow - m.naPrev[i] > -0.2) onBlow(w, i, foeOK ? foe : -1, -1, now, false);
          m.naPrev[i] = na; m.planT[i] = -1;
          if (fighting && foeOK && !mounted && F.combat && na > simNow && !S.posture[foe] && S.state[foe] !== S_DOWN) {
            const pc = chooseStrike(F, w, i, foe);
            if (pc >= 0) { const C = F.meta[pc]; m.plan[i] = pc; m.planT[i] = now + (na - simNow) - (C.hit ?? 0.45) * dur(C); }
          } else if (fighting && mounted && foeOK && na > simNow) {
            const nmS = F.idx.ride_sword !== undefined && S.weapon[i] !== LANCE_ID ? (S.shield[i] && hash(nm + (na * 10 | 0)) < 0.25 && F.idx.ride_bash !== undefined ? "ride_bash" : "ride_sword") : "ride_strike";
            const pc = F.idx[nmS] ?? -1; if (pc >= 0) { const C = F.meta[pc]; m.plan[i] = pc; m.planT[i] = now + (na - simNow) - (C.hit ?? 0.47) * dur(C); }
          }
        }
        if (m.planT[i] >= 0 && now >= m.planT[i] && fighting && (m.akind[i] === A_NONE || m.akind[i] === A_REACT && actPhase(F, i, now) > 0.6)) {
          startAct(i, F, m.plan[i], m.planT[i], mounted ? A_RIDE : A_STRIKE); m.planT[i] = -1;
        }
        // -- the one-shot playing out
        if (m.act[i] >= 0) {
          const C = F.meta[m.act[i]], p = (now - m.actT0[i]) / dur(C);
          const hold = m.akind[i] === A_KNOCK;
          if (p >= 1 && !hold) { m.act[i] = -1; m.akind[i] = A_NONE; }
          else if (m.akind[i] === A_KNOCK && p >= 1 && F.idx.writhe !== undefined) { ci = F.idx.writhe; phase = m.phase[i] = (m.phase[i] + dt * 0.3) % 1; }
          else { ci = m.act[i]; phase = Math.max(0, Math.min(C.frames - 1, p * C.frames)) / C.frames; }
          if (m.akind[i] !== A_KNOCK && m.akind[i] !== A_GETUP && !fighting && m.akind[i] !== A_RIDE) { if (p > 0.7) { m.act[i] = -1; m.akind[i] = A_NONE; ci = -1; } }
        }
      }
      // -- the base clip (loops): by state and speed
      if (ci < 0) {
        if (mounted) {
          const u = w.units.get(S.unit[i]), charging = spd > 5 || u?.c?.phase === "charge";
          if (fighting) clip = F.idx.ride_ready !== undefined && S.weapon[i] !== LANCE_ID ? "ride_ready" : "ride";
          else if (charging && F.idx.ride_charge !== undefined) {
            // the lance comes down in the last 30-50 m of the charge (docs/battle-feel-research.md §2.1)
            const lower = S.weapon[i] === LANCE_ID && uinfo && uinfo.enemyD < 55;
            if (lower && !m.couched[i]) { m.couched[i] = 1; m.lowerT[i] = now; }
            if (!lower) m.couched[i] = 0;
            clip = m.couched[i] ? (now - m.lowerT[i] < 1.6 && F.idx.ride_lower !== undefined ? "ride_lower" : "ride_charge") : (F.idx.ride_gallop !== undefined ? "ride_gallop" : "ride_charge");
            if (clip === "ride_lower") { ci = F.idx.ride_lower; phase = Math.min(0.999, (now - m.lowerT[i]) / dur(F.meta[ci])); }
          } else clip = spd > 5 ? "ride_charge" : "ride";
        } else if (fighting && F.combat) {
          clip = "guard";
          const fl = foeOK && (S.posture[foe] || S.state[foe] === S_DOWN) && foeD < 1.8;
          if (fl && variant(F, S, i, "strike_down") >= 0) clip = "strike_down";                                  // finishing a fallen man
          else if (S.rank[i] >= 1 && foeD > WEAPON_BY_ID[S.weapon[i]].reach + 0.7 && F.idx.press !== undefined) clip = "press";   // behind the fighters
          else if (foeD < 0.95 && F.idx.shove !== undefined && hash(nm * 13 + ((simNow / 4) | 0)) < 0.35) clip = "shove";          // chest to chest
        } else {
          clip = pickClip(F, w, i, spd, lo);
          // under arrows: heads down, shields up (docs/battle-feel-research.md §4.2)
          if (recentShot && recentShot[i] > w.time - 3 && !lo && (clip === "idle" || clip === "walk") && F.idx[clip + "_cover"] !== undefined && !(F.missile && still)) clip += "_cover";
        }
        // bowmen loosing: time the draw so the loose lands on the sim's shot (S.nextShot); crossbowmen then span
        if (F.idx.shoot !== undefined && still) {
          if (S.nextShot[i] !== m.nsPrev[i]) { if (m.nsPrev[i] > 0 && S.nextShot[i] > m.nsPrev[i]) m.loose[i] = m.nsPrev[i]; m.nsPrev[i] = S.nextShot[i]; }
          const C = F.clip.shoot, dd = C.frames / C.fps, L = (C.loose ?? 0.5) * dd, R = F.clip.reload;
          const toNext = S.nextShot[i] - w.time, since = w.time - m.loose[i];
          if (toNext >= 0 && toNext < L) { clip = "shoot"; ci = F.idx.shoot; phase = Math.min(C.frames - 1, (L - toNext) * C.fps) / C.frames; }
          else if (since >= 0 && since < dd - L) { clip = "shoot"; ci = F.idx.shoot; phase = Math.min(C.frames - 1, (L + since) * C.fps) / C.frames; }
          else if (R && since >= dd - L && since < dd - L + R.frames / R.fps) { clip = "reload"; ci = F.idx.reload; phase = Math.min(R.frames - 1, (since - (dd - L)) * R.fps) / R.frames; }
        }
        // pikemen receiving horse: the front ranks kneel with the butt grounded, the ranks behind level over them
        if (F.idx.brace !== undefined && still && clip === "idle" && uinfo?.brace) clip = S.rank[i] < 2 ? "brace" : "level";
        if (ci < 0) {
          ci = mounted ? (F.idx[clip] ?? F.idx.ride) : variant(F, S, i, clip);
          if (ci < 0) ci = variant(F, S, i, clip.replace("_cover", "")) >= 0 ? variant(F, S, i, clip.replace("_cover", "")) : F.idx.idle;
          const C = F.meta[ci];
          if (C.loop && lo?.sync && st === S_WORK && lo.M) phase = m.phase[i] = (((w.time - lo.M.t0) / dur(C)) % 1 + 1) % 1;   // (a stoop lands on the sim's pick-up)
          else if (C.loop) phase = m.phase[i] = advance(C, m.clip[i] === ci ? m.phase[i] : (m.phase[i] || hash(i * 7919 + 1)), 0, dt, now, clip === "run" && st === S_FLEE ? Math.max(spd, 0.8 * C.speed) : spd, jitter);
          else if (clip !== "shoot" && clip !== "reload" && clip !== "ride_lower") { if (m.clip[i] !== ci) m.t0[i] = now; phase = advance(C, 0, m.t0[i], 0, now, 0, 1); }
        }
      }
      // cross-fade from the previous clip
      if (m.clip[i] !== ci) {
        if (seen && m.clip[i] >= 0) { m.pclip[i] = m.clip[i]; m.pphase[i] = m.lastPh[i]; m.bT0[i] = now; }
        else m.pclip[i] = -1;
        m.clip[i] = ci;
      }
      m.lastPh[i] = phase;
      let pw = m.pclip[i] >= 0 ? 1 - (now - m.bT0[i]) / (dying ? 0.3 : BLEND) : 0;
      if (pw <= 0) { pw = 0; m.pclip[i] = -1; }
      m.seen[i] = 1; m.wasAlive[i] = alive ? 1 : 0;
      // ================= facing
      if ((alive || !dying) && m.akind[i] !== A_KNOCK && !m.thrown[i]) {
        let want = (m.head !== null && !fighting ? m.head : S.facing[i]) + Math.PI / 2;
        if (fighting && mounted && foeOK && foeD < 3.5 && S.horseOK[foe] !== 1) want += 0.9;   // a rider fights a man on foot on his sword side
        const diff = wrapPi(want - m.yaw[i]);
        const deadband = fighting || m.head !== null ? 0 : 0.45; // standing: ignore small facing flickers
        if (Math.abs(diff) > deadband) { const rate = (mounted ? 1.6 : fighting ? 5 : 3.2) * dt; m.yaw[i] += Math.max(-rate, Math.min(rate, diff)); }
      }
      let yaw = m.yaw[i];
      // ================= the thrown: flight, spin, and the landing into a lying pose (the corpse keeps the offset)
      let q = ID_Q;
      if (m.thrown[i] === 1) {
        // the body's middle (1 m up) flies the parabola; the figure spins about it, not about its feet
        const tt = now - m.tT0[i], z = m.offz[i] + m.tvz[i] * tt - 4.9 * tt * tt;
        if (z <= 0.25 && tt > 0.1) { m.thrown[i] = 2; m.offx[i] += m.tvx[i] * tt; m.offy[i] += m.tvy[i] * tt; m.offz[i] = 0; fx.puff(X + m.offx[i], h, Y + m.offy[i], 1.0, 4, 0.7); if (alive) { m.akind[i] = A_KNOCK; m.act[i] = F.idx.knock ?? -1; m.actT0[i] = now - 5; } else { m.dieT0[i] = now - 10; } m.yaw[i] = yaw = m.tyaw[i]; }
        else {
          const ang = m.tw[i] * tt * 0.5, s2 = Math.sin(ang);
          const cy = Math.cos(-yaw), sy = Math.sin(-yaw), ax = cy * m.twx[i] + sy * m.twz[i], az = -sy * m.twx[i] + cy * m.twz[i];
          TMPQ[0] = ax * s2; TMPQ[1] = 0; TMPQ[2] = az * s2; TMPQ[3] = Math.cos(ang); q = TMPQ;
          // where the rotated "up 0.95 m" lands in the world: the root sits that far below the middle
          const ux = 2 * (TMPQ[0] * TMPQ[1] - TMPQ[3] * TMPQ[2]) * 0.95, uy = (1 - 2 * (TMPQ[0] * TMPQ[0] + TMPQ[2] * TMPQ[2])) * 0.95, uz = 2 * (TMPQ[1] * TMPQ[2] + TMPQ[3] * TMPQ[0]) * 0.95;
          const cw = Math.cos(yaw), sw = Math.sin(yaw), wx = cw * ux + sw * uz, wz = -sw * ux + cw * uz;
          X += m.offx[i] + m.tvx[i] * tt - wx; Y += m.offy[i] + m.tvy[i] * tt + wz; h += z - uy;
          if (F.idx.thrown !== undefined) { ci = F.idx.thrown; phase = (tt * 2) % 1; m.pclip[i] = -1; pw = 0; }
        }
      }
      if (m.thrown[i] === 2) { X += m.offx[i]; Y += m.offy[i]; if (alive && !S.posture[i]) { m.offx[i] *= 1 - Math.min(1, dt * 0.8); m.offy[i] *= 1 - Math.min(1, dt * 0.8); if (Math.hypot(m.offx[i], m.offy[i]) < 0.05) m.thrown[i] = 0; } }
      const bits = kitBits(F, w, i, mounted, still || (F.idx.shoot !== undefined && ci === F.idx.shoot) || ci === F.idx.reload, lo, fighting || (m.akind[i] !== A_NONE && alive));
      if (mounted && m.thrown[i] !== 1) {
        // ---- the horse: gait by ground speed; a refusal (the sim parks him with a fresh busyT) rears
        let hclip = "idle";
        if (mounted) {
          if (S.busyT[i] > m.busyPrev[i] + 0.5 && spd < 0.5 && HF.idx.rear !== undefined) m.rearT[i] = now;
          const R = HF.clip.rear;
          if (R && now - m.rearT[i] < R.frames / R.fps) hclip = "rear";
          else { const gm = GAIT_V[HF.key] || 1; const v = (ok === 2 ? Math.max(spd, 7.5) : spd) / gm; for (const [g, lim] of GAITS) if (v < lim && HF.idx[g] !== undefined) { hclip = g; break; } }
        }
        m.busyPrev[i] = S.busyT[i];
        const HC = HF.clip[hclip], hci = HF.idx[hclip];
        if (m.hclip[i] !== hci) { if (m.hclip[i] >= 0 && seen) { m.hpclip[i] = m.hclip[i]; m.hpphase[i] = m.hphase[i]; m.hbT0[i] = now; } m.ht0[i] = now; m.hclip[i] = hci; }
        const hph = m.hphase[i] = advance(HC, m.hphase[i], m.ht0[i], dt, now, ok === 2 ? Math.max(spd, 7.5) : spd, jitter);
        if (m.akind[i] === A_RIDE && m.act[i] >= 0) {   // a blow from the saddle: the horse is driven into the man, shoulder first
          const p = (now - m.actT0[i]) / dur(F.meta[m.act[i]]); if (p > 0 && p < 1) { const k = 0.4 * Math.sin(Math.PI * p); X += Math.cos(yaw - Math.PI / 2) * k; Y += Math.sin(yaw - Math.PI / 2) * k; }
        }
        { const ft = now - m.flinchT[i]; if (ft < 0.7) { const k = Math.sin(ft / 0.7 * Math.PI) * 0.45 * m.flinchS[i]; X += Math.cos(yaw) * k; Y += Math.sin(yaw) * k; } }   // pricked: the horse shies sideways
        let hpw = m.hpclip[i] >= 0 ? 1 - (now - m.hbT0[i]) / 0.3 : 0; if (hpw <= 0) { hpw = 0; m.hpclip[i] = -1; }
        {
          const hs = 0.97 + 0.06 * hash(nm * 5 + 1);
          const HP = horsePose(map, X, Y, yaw, HPOSE); h = HP.h; // (his four hooves on the slope: js/render/footing.js)
          const ho = put(HF, lod, X, h, -Y, yaw, hci, hph, hs, 0, look, (hash(nm * 17 + 2) * 8) | 0, 0, fade, HP.q, m.hpclip[i], m.hpphase[i], hpw);
          if (ho >= 0 && d < ARROW_NEAR && perHorse.has(i)) HF.drawnAt.set(i, lod * 1e7 + ho);
          shadow(X, h, -Y, fade, 2, false);
          // gallop dust
          if (spd > 5.5 && lod === 0 && Math.random() < dt * 3) fx.puff(X - Math.cos(yaw - Math.PI / 2) * 1.2, h, Y - Math.sin(yaw - Math.PI / 2) * 1.2, 1.3, 1, 0.5);
          // ---- the rider, on the saddle's seat point for this frame
          seatAt(HF, hclip, hph);
          SEATS[0] = seatP[0] * hs; SEATS[1] = seatP[1] * hs; SEATS[2] = seatP[2] * hs; const [px, py, pz] = seatThrough(HP.q, SEATS, seatQ, SEATT, SEATQ), c = Math.cos(yaw), s = Math.sin(yaw);
          const o = put(F, lod, X + c * px + s * pz, h + py, -Y - s * px + c * pz, yaw, ci, phase, scale, bits, look, d1, d2, fade, SEATQ, m.pclip[i], m.pphase[i], pw);
          if (o >= 0 && d < ARROW_NEAR && perMan.has(i)) F.drawnAt.set(i, lod * 1e7 + o);
          continue;
        }
      }
      const o = put(F, lod, X, h, -Y, yaw, ci, phase, scale, bits, look, d1, d2, fade, q, m.pclip[i], m.pphase[i], pw, kb2);
      if (o >= 0 && d < ARROW_NEAR && perMan.has(i)) F.drawnAt.set(i, lod * 1e7 + o);
      shadow(X, h, -Y, fade, 1, dying && phase > 0.6 || m.akind[i] === A_KNOCK);
      if (fighting && lod === 0 && Math.random() < dt * 0.012) fx.patch(X + (Math.random() - 0.5) * 1.5, Y + (Math.random() - 0.5) * 1.5, 0.8 + Math.random() * 0.6, false, w.time);   // the press tramples the ground
    }
    // pphase bookkeeping for the next frame's cross-fades
    // horses brought down: fall once, then lie
    for (const D of deadHorses) {
      const HF = horses.get(D.key); if (!HF) continue;
      const d = inRange(D.x, D.y); if (d < 0 || !chunkVisible(D.x, D.y)) continue;
      const fade = Math.min(1, (FIG_FAR - d) / (FIG_FAR - FIG_NEAR)), clip = HF.idx.fall !== undefined ? "fall" : "idle";
      const C = HF.clip[clip], h = map.h(D.x, D.y);
      const o = put(HF, d < lod1Dist ? 0 : 1, D.x, h, -D.y, D.yaw, HF.idx[clip], advance(C, 0, D.t0, 0, now, 0, 1), 1, 0, D.team, D.coat, 0, fade);
      if (o >= 0 && d < ARROW_NEAR) (HF.deadAt ||= new Map()).set(D.hk, (d < lod1Dist ? 0 : 1) * 1e7 + o);
      shadow(D.x, h, -D.y, fade, 2, true);
    }
    // riderless horses: bolt away at a gallop, slow, then stand and graze
    for (const L of looseHorses) {
      const HF = horses.get(L.key); if (!HF) continue;
      const age = now - L.t0, v = L.walk ? (age < 20 ? L.v : 0) : L.v * Math.max(0, 1 - age / 14);
      L.x += Math.cos(L.yaw - Math.PI / 2) * v * dt; L.y += Math.sin(L.yaw - Math.PI / 2) * v * dt;
      const d = inRange(L.x, L.y); if (d < 0 || !chunkVisible(L.x, L.y)) continue;
      let g = "idle"; for (const [gg, lim] of GAITS) if (v < lim && HF.idx[gg] !== undefined) { g = gg; break; }
      const hci = HF.idx[g], C = HF.clip[g];
      L.hphase = advance(C, L.hphase, 0, dt, now, v, 1);
      const fade = Math.min(1, (FIG_FAR - d) / (FIG_FAR - FIG_NEAR)), HP = horsePose(map, L.x, L.y, L.yaw, HPOSE), h = HP.h;
      put(HF, d < lod1Dist ? 0 : 1, L.x, h, -L.y, L.yaw, hci, L.hphase, 1, 0, L.team, L.coat, 0, fade, HP.q);
      shadow(L.x, h, -L.y, fade, 2, false);
      if (v > 5 && Math.random() < dt * 3) fx.puff(L.x, h, L.y, 1.2, 1, 0.5);
    }
    // render-only actors (the workshops lane, js/render/jobs/workshops.js): recruits at drill, clerks, grooms and their
    // horses — people the sim keeps abstract, drawn with the same figure sets. Each: { key (an arm key or "horse_*"), x, y,
    // face (sim radians), clip, phase 0..1, kit [part names], team, seed, horse?, hclip?, hphase? }
    for (const E of extras) {
      const isH = E.key.startsWith("horse_"), F = isH ? horses.get(E.key) : arms.get(armIdOf.get(E.key));
      if (!F) { want(E.key); continue; }
      const d = inRange(E.x, E.y); if (d < 0 || !chunkVisible(E.x, E.y)) continue;
      const fade = Math.min(1, (FIG_FAR - d) / (FIG_FAR - FIG_NEAR)), lod = d < lod1Dist ? 0 : 1, yaw = E.face + Math.PI / 2, HP = E.horse || isH ? horsePose(map, E.x, E.y, yaw, HPOSE) : null, h = HP ? HP.h : standH(map, E.x, E.y);
      const ci = F.idx[E.clip] ?? F.idx.idle; if (ci === undefined) continue;
      const sd = E.seed >>> 0, d1 = (hash(sd * 7 + 3) * 8) | 0, d2 = (hash(sd * 11 + 9) * 8) | 0;
      let bits = 0, b2 = 0; for (const k of E.kit || []) { const p = F.parts[k]; if (p) { if (p < 24) bits |= 1 << p; else b2 |= 1 << (p - 24); } }
      const ph = ((E.phase % 1) + 1) % 1;
      if (E.horse) {
        const HF = horses.get(E.horse); if (!HF) { want(E.horse); continue; }
        const hc = HF.idx[E.hclip] !== undefined ? E.hclip : "idle", hph = ((E.hphase % 1) + 1) % 1;
        put(HF, lod, E.x, h, -E.y, yaw, HF.idx[hc], hph, 1, 0, Math.min(7, E.team), (hash(sd * 17 + 2) * 8) | 0, 0, fade, HP.q);
        shadow(E.x, h, -E.y, fade, 2, false);
        seatAt(HF, hc, hph);
        const c = Math.cos(yaw), sn = Math.sin(yaw), [qx, qy, qz] = seatThrough(HP.q, seatP, seatQ, SEATT, SEATQ);
        put(F, lod, E.x + c * qx + sn * qz, h + qy, -E.y - sn * qx + c * qz, yaw, ci, ph, 1, bits, Math.min(7, E.team), d1, d2, fade, SEATQ, -1, 0, 0, b2);
        continue;
      }
      put(F, lod, E.x, h, -E.y, yaw, ci, ph, isH ? 1 : 0.942 + 0.093 * hash(sd * 13 + 5), bits, Math.min(7, E.team), isH ? (hash(sd * 17 + 2) * 8) | 0 : d1, d2, fade, isH ? HP.q : ID_Q, -1, 0, 0, b2);
      shadow(E.x, h, -E.y, fade, isH ? 2 : 1, false);
    }
    // arrows stuck in the figures drawn this frame: copy the host's instance state
    writeStuck();
    for (const F of [...arms.values(), ...horses.values()]) for (let l = 0; l < 2; l++) {
      const im = F.meshes[l], n = F.n[l]; im.count = n;
      for (const a of Object.values(F.attrs[l])) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
    }
    shadows.geo.instanceCount = ns; shadows.iS.clearUpdateRanges(); shadows.iS.addUpdateRange(0, ns * 4); shadows.iS.needsUpdate = true;
    fx.update(simNow, dt, cam, innerHeight || 900);
    for (const i of deathInfo.keys()) if (S.alive[i] && S.state[i] !== S_DOWN && now - (deathInfo.get(i).t || 0) > 5) deathInfo.delete(i);
  }
  function writeStuck() {
    for (const F of [...arms.values(), ...horses.values()]) F.stuck.n = 0;
    for (let k = 0; k < stuck.n; k++) {
      const kind = stuck.kind[k], host = stuck.host[k];
      let F, code;
      if (kind === 0) { F = arms.get(M ? lastArmOf(host) : -1); code = F?.drawnAt?.get(host); }
      else if (kind === 1) { F = horseSetOf(host); code = F?.drawnAt?.get(host); }
      else { const D = deadHorses[host]; F = D && horses.get(D.key); code = F?.deadAt?.get(host); }
      if (!F || code === undefined) continue;
      const lod = code >= 1e7 ? 1 : 0, o = code - lod * 1e7, src = F.attrs[lod], dst = F.stuck, j = dst.n++ * 4;
      if (dst.n > STUCK_CAP) { dst.n--; continue; }
      for (const nmA of ["iPos", "iAnim", "iQuat", "iPrev"]) { const s = src[nmA].array, t = dst.at[nmA].array; t[j] = s[o]; t[j + 1] = s[o + 1]; t[j + 2] = s[o + 2]; t[j + 3] = s[o + 3]; }
      const T = dst.at.iStk.array; T[j] = stuck.row[k]; T[j + 1] = stuck.part[k]; T[j + 2] = stuck.seed[k]; T[j + 3] = stuck.tilt[k];
    }
    for (const F of [...arms.values(), ...horses.values()]) {
      const g = F.stuck; g.geo.instanceCount = g.n;
      for (const a of Object.values(g.at)) { a.clearUpdateRanges(); a.addUpdateRange(0, g.n * 4); a.needsUpdate = true; }
      if (F.deadAt) F.deadAt.clear();
    }
  }
  let wRef = null;
  const lastArmOf = (i) => wRef ? wRef.S.arm[i] : -1;
  const horseSetOf = (i) => wRef ? (horses.get(HORSE_KEY(wRef.S, i)) || horses.get("horse_light")) : null;
  const update0 = update;
  function updateW(w, ...a) { wRef = w; return update0(w, ...a); }
  const lod1Dist = lod1At;
  function setAccents(cols) { cols.forEach((c, i) => teamAcc[i]?.set(c)); }
  const stats = () => { let n0 = 0, n1 = 0, hn = 0, sa = 0; for (const F of arms.values()) { n0 += F.n[0]; n1 += F.n[1]; sa += F.stuck.n; } for (const F of horses.values()) { hn += F.n[0] + F.n[1]; sa += F.stuck.n; } return { lod0: n0, lod1: n1, horses: hn, arms: arms.size, horseSets: horses.size, setsAsked: asked.size, vat: VATSTAT, deadHorses: deadHorses.length, loose: looseHorses.length, stuckDrawn: sa, ready, ...fx.stats() }; };
  // debug: what man i is showing (clip names), for headless checks
  const debug = (i) => { const F = wRef && arms.get(wRef.S.arm[i]); if (!F || !M) return null; return { clip: F.name[M.clip[i]], prev: M.pclip[i] >= 0 ? F.name[M.pclip[i]] : null, act: M.act[i] >= 0 ? F.name[M.act[i]] : null, akind: M.akind[i], die: M.die[i] >= 0 ? F.name[M.die[i]] : null, thrown: M.thrown[i], yaw: +M.yaw[i].toFixed(2), facing: +wRef.S.facing[i].toFixed(2) }; };
  // where man i's figure stands this frame (the smoothed body, not the dot): js/render/labor.js hangs carts and dragged
  // logs on it. → false when he is not drawn as a figure.
  function bodyOf(i, out) { if (!M || i >= M.cap || !(M.fade[i] > 0)) return false; out.x = M.sx[i]; out.y = M.sy[i]; out.yaw = M.yaw[i]; out.fade = M.fade[i]; return true; }
  return { update: updateW, setAccents, stats, fx, debug, bodyOf, extras, get fade() { return M ? M.fade : null; } };
}
