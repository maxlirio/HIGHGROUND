// Gathering lane A: FIELDS — the render side (docs/gathering-plan.md; the sim is js/sim/jobs/fields.js). Purely a picture
// of b.field (state, op, per-strip progress f.pr, growth) and of the labour men/items the sim keeps:
//   • THE GROUND of every field, draped on the terrain in the terrain's own light: dark turned plough-land, the finer
//     harrowed seed-bed, pale gold stubble on earth, fallow grass and weeds (the pasture round it), burnt ground. Each
//     strip ("land") shows the operation's front exactly where the sim has it, with the open furrow between the lands.
//     Textures: the world's own terrain sets (assets/terrain), recoloured per stage.
//   • RIDGE AND FURROW: the plough's ridges catch the light everywhere (analytic normals on the drape), and near the
//     camera they are real geometry — fine tiles raised by the vertex shader exactly where the ground is turned, the
//     newest furrow coming up just behind the plough; harrowing lowers them, the crop covers them, stubble weathers them.
//   • THE CORN: layered shells (one instanced draw a field) cut from a tiling stalk pattern — single stalks and ears near
//     to, a solid canopy with real height far off — by growth (shoots → tall green → yellowing → gold) and crop, swaying
//     down the weather's wind; short stubble where reaped; and near the camera the old instanced stalk cards besides.
//     Detail follows the View panel's Low / Medium / High (render/quality.js).
//   • STOOKS (labour items "stook": lines of sheaves set up to dry), HARVEST CARTS (a carrier with the wain: an ox in the
//     shafts, the cart heaped with sheaves), PLOUGH TEAMS (a yoked pair of oxen LEADING round the land's loop, the plough
//     towed on its beam behind them, the ploughman at the stilts), SOWERS' seed flung in arcs, ROOKS — their own birds —
//     settling in the fresh furrows behind the plough, the THRESHING FLOOR (straw, sheaves, chaff) where
//     the flails are going. Oxen and carts are our own low-poly geometry.
import * as THREE from "three";
import { PIECE, MARK, COL, tint, merge, towFrom } from "../labor.js";
import { HOLD_CLIPS, CARRY_PART, POSE_KIT } from "../figures.js";
import { loadSurfaceArrays } from "../splat.js";
import { growth, frontY, stripsOf, stripOf, bandX, fieldLocal, fieldWorld, STOOK_SPACING, STOOK_ROWS, insideField } from "../../sim/jobs/fields.js";
import { Q } from "../quality.js";
import { SUN_DIR } from "../terrain.js";
import { S_MOVE } from "../../sim/soldiers.js";

// ---------------------------------------------------------------- figure tables (what the villagers hold and play)
HOLD_CLIPS.plough = ["walk_plough", "idle_hand"];      // at the plough stilts (assets/src/units/_lane_fields.py)
HOLD_CLIPS.sow = ["walk_sow", "idle_hand"];            // broadcasting from the seed sheet
HOLD_CLIPS.wain = ["walk_hand", "idle_hand"];          // leading the ox of a harvest cart
CARRY_PART.stook = "sheaf"; CARRY_PART.seedlip = "sack";
POSE_KIT.work_flail = ["flail"];

// ---------------------------------------------------------------- stooks (labour items: a line down a strip)
const STRAW = "#d2ad58", STRAW_D = "#a9853e";
const along = (g) => g.rotateZ(Math.PI / 2);
function sheafGeo(h = 1.4, r = 0.19) {        // one standing sheaf: butts spread on the ground, the band, the ears flaring
  const g = [];
  g.push(tint(new THREE.CylinderGeometry(r * 0.72, r * 1.05, h * 0.62, 7, 1, true), STRAW, 0.22).translate(0, h * 0.31, 0));
  g.push(tint(new THREE.CylinderGeometry(r * 0.76, r * 0.76, 0.06, 7), "#8f6f35").translate(0, h * 0.5, 0));
  g.push(tint(new THREE.CylinderGeometry(r * 1.25, r * 0.72, h * 0.4, 7), "#c9a14c", 0.3).translate(0, h * 0.8, 0));
  g.push(tint(new THREE.ConeGeometry(r * 1.2, h * 0.14, 7), "#b89140", 0.25).translate(0, h * 1.05, 0));
  return g;
}
function sheafLo(h, r, seed) {   // (a lean sheaf for the stooks: one tapered stalk bundle and its heads — they come in hundreds)
  return [tint(new THREE.CylinderGeometry(r * 1.2, r * 0.95, h, 6, 1, true), STRAW, 0.25, seed).translate(0, h / 2, 0),
    tint(new THREE.ConeGeometry(r * 1.25, h * 0.22, 6), "#b89140", 0.25, seed).translate(0, h * 1.08, 0)];
}
function stookGeo() {   // a stook: ten sheaves, butts out, heads leaned together in two ranks along the row (~1.45 m tall, 1.6 m long)
  const g = [];
  for (let k = 0; k < 10; k++) {
    const row = k % 2 ? 1 : -1, x = (Math.floor(k / 2) - 2) * 0.34;
    for (const p of sheafLo(1.45 + (k % 3) * 0.05, 0.2, k)) g.push(p.rotateX(-row * 0.3).translate(x, 0, row * 0.4));
  }
  for (const p of sheafLo(1.45, 0.19, 11)) g.push(p.rotateZ(0.2).translate(-0.95, 0, 0));   // (the end sheaves close the ridge)
  for (const p of sheafLo(1.45, 0.19, 12)) g.push(p.rotateZ(-0.2).translate(0.95, 0, 0));
  return merge(g);
}
// piece k: the k-th rank of four stooks across the land (rows at STOOK_ROWS × 40 m), STOOK_SPACING apart down it, each a
// little out of line (set up by hand)
function rankGeo() { const g = []; STOOK_ROWS.forEach((o, r) => { const s = stookGeo(); g.push(s.rotateY(((r * 7) % 3 - 1) * 0.08).translate(((r * 5) % 3 - 1) * 0.5, 0, -o * 40 + ((r * 3) % 2 - 0.5) * 0.4)); }); return merge(g); }
PIECE.stook = { geo: rankGeo, at: (k) => [k * STOOK_SPACING + ((k * 5) % 3 - 1) * 0.4, 0, ((k * 7) % 5 - 2) * 0.18, ((k * 13) % 7 - 3) * 0.015] };
function heapGeo() { const g = []; for (let k = 0; k < 9; k++) g.push(along(tint(new THREE.CylinderGeometry(0.2, 0.26, 1.1, 7), STRAW, 0.2, k)).rotateY(k * 0.7).translate(((k * 5) % 3 - 1) * 0.4, 0.22 + (k > 5 ? 0.3 : 0), ((k * 7) % 3 - 1) * 0.35)); return merge(g); }
PIECE.wain = { geo: heapGeo, at: (k) => [(k % 3 - 1) * 1.3, Math.floor(k / 9) * 0.5, (Math.floor(k / 3) % 3 - 1) * 1.3, 0] };   // (a load tipped off a cart)
PIECE.plough = { geo: () => new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3)).setAttribute("normal", new THREE.BufferAttribute(new Float32Array(9), 3)).setAttribute("color", new THREE.BufferAttribute(new Float32Array(9), 3)), at: () => [0, -50, 0, 0] };
PIECE.seedlip = PIECE.plough;
COL.stook = STRAW; COL.wain = STRAW; COL.plough = "#6e4a2e"; COL.seedlip = "#cbb98f";
MARK.stook = 1; MARK.wain = 1; MARK.plough = 3; MARK.seedlip = 2;

// ---------------------------------------------------------------- oxen, plough, cart (vertex-coloured, merged)
const OX_COATS = ["#7a4a2a", "#8c6a44", "#5a3a26", "#a0784c"];
function oxGeo(coat = OX_COATS[0]) {  // an ox 2.5 m long, facing +x, feet at y 0; legs carry a `leg` attribute (1–4) for the gait
  const parts = [], legs = [];
  const E = (rx, ry, rz, c, x, y, z, seg = 10) => tint(new THREE.SphereGeometry(1, seg, 7).scale(rx, ry, rz), c, 0.12).translate(x, y, z);
  parts.push(E(0.95, 0.6, 0.5, coat, 0, 1.08, 0, 12));            // barrel
  parts.push(E(0.5, 0.58, 0.46, coat, 0.62, 1.16, 0));             // shoulders, hump
  parts.push(E(0.45, 0.5, 0.44, coat, -0.62, 1.1, 0));             // haunch
  parts.push(tint(new THREE.CylinderGeometry(0.2, 0.28, 0.55, 8), coat, 0.1).rotateZ(-1.0).translate(1.05, 1.22, 0)); // neck
  parts.push(E(0.3, 0.2, 0.18, coat, 1.34, 1.08, 0, 8));           // head
  parts.push(E(0.14, 0.13, 0.15, "#3c2a20", 1.58, 1.0, 0, 7));     // muzzle
  for (const s of [-1, 1]) parts.push(tint(new THREE.ConeGeometry(0.045, 0.34, 5), "#d8cfb4").rotateX(s * 1.25).rotateZ(-0.35).translate(1.3, 1.3, s * 0.24)); // horns
  parts.push(tint(new THREE.CylinderGeometry(0.03, 0.02, 0.8, 4), coat).rotateZ(0.15).translate(-1.02, 0.85, 0));     // tail
  parts.push(E(0.07, 0.12, 0.07, "#2e2218", -0.98, 0.45, 0, 5));
  const L = [[0.55, 0.26, 1], [0.55, -0.26, 2], [-0.6, 0.24, 3], [-0.6, -0.24, 4]];
  for (const [x, z, id] of L) {
    const leg = merge([tint(new THREE.CylinderGeometry(0.1, 0.075, 0.85, 6), coat, 0.1).translate(0, 0.52, 0), tint(new THREE.CylinderGeometry(0.08, 0.09, 0.12, 6), "#2a211b").translate(0, 0.06, 0)]).translate(x, 0, z);
    legs.push([leg, id]);
  }
  const all = merge([...parts, ...legs.map((l) => l[0])]);
  const n0 = parts.reduce((s, g) => s + (g.index ? g.index.count : g.attributes.position.count), 0);
  const legA = new Float32Array(all.attributes.position.count); let o = n0;
  for (const [g, id] of legs) { const c = g.attributes.position.count; legA.fill(id, o, o + c); o += c; }
  all.setAttribute("leg", new THREE.BufferAttribute(legA, 1));
  return all;
}
function yokeGeo() {   // the yoke across the pair's necks (z ±0.7), the chain/pole back to the plough beam
  const W = "#6b4e33";
  return merge([tint(new THREE.BoxGeometry(0.16, 0.12, 2.0), W).translate(1.0, 1.42, 0), tint(new THREE.CylinderGeometry(0.035, 0.035, 3.0, 5), W).rotateZ(Math.PI / 2 + 0.2).translate(-0.6, 1.05, 0)]);
}
function ploughGeo() { // facing +x: beam from the hitch forward, the body, share and mouldboard at the ground, two stilts back to the man
  const W = "#6b4e33", Wd = "#4f3a27", I = "#5a5a58", g = [];
  g.push(tint(new THREE.BoxGeometry(2.4, 0.11, 0.11), W).rotateZ(0.12).translate(0.9, 0.62, 0));          // beam
  g.push(tint(new THREE.BoxGeometry(0.7, 0.12, 0.14), Wd).translate(-0.05, 0.12, 0));                      // sole
  g.push(tint(new THREE.BoxGeometry(0.1, 0.55, 0.1), W).translate(0.15, 0.38, 0));                         // standard
  g.push(tint(new THREE.BoxGeometry(0.5, 0.26, 0.05), Wd).rotateY(0.45).translate(0.0, 0.2, -0.14));       // mouldboard
  g.push(tint(new THREE.ConeGeometry(0.07, 0.3, 4), I).rotateZ(-Math.PI / 2).translate(0.42, 0.08, 0));    // share
  for (const s of [-1, 1]) g.push(tint(new THREE.BoxGeometry(1.25, 0.06, 0.06), W).rotateZ(-0.5).translate(-0.62, 0.55, s * 0.2)); // stilts
  g.push(tint(new THREE.BoxGeometry(0.05, 0.05, 0.46), W).translate(-1.15, 0.86, 0));                       // handle bar
  g.push(tint(new THREE.CylinderGeometry(0.28, 0.28, 0.07, 10), Wd).rotateX(Math.PI / 2).translate(1.65, 0.28, 0.18)); // (a wheel under the beam's nose)
  return merge(g);
}
function wainGeo() {   // a two-wheeled harvest cart facing +x, heaped high with sheaves; shafts forward
  const W = "#6b4e33", Wd = "#4a3726", g = [];
  g.push(tint(new THREE.BoxGeometry(2.6, 0.12, 1.5), W, 0.15).translate(0, 0.85, 0));
  for (const z of [-0.78, 0.78]) { g.push(tint(new THREE.BoxGeometry(2.6, 0.08, 0.06), W).translate(0, 1.35, z)); for (let k = -2; k <= 2; k++) g.push(tint(new THREE.BoxGeometry(0.05, 0.55, 0.05), W).translate(k * 0.6, 1.1, z)); }
  for (const z of [-0.85, 0.85]) g.push(tint(new THREE.CylinderGeometry(0.72, 0.72, 0.1, 14), Wd, 0.1).rotateX(Math.PI / 2).translate(-0.1, 0.72, z));
  for (const z of [-0.5, 0.5]) g.push(tint(new THREE.BoxGeometry(2.4, 0.08, 0.08), W).translate(2.3, 0.95, z));
  for (let k = 0; k < 16; k++) { const lay = Math.floor(k / 6), r = k % 6; g.push(along(tint(new THREE.CylinderGeometry(0.2, 0.26, 1.2, 7), STRAW, 0.22, k)).rotateY((r % 2) * 0.2 - 0.1).translate((r % 3 - 1) * 0.85, 1.12 + lay * 0.36, (Math.floor(r / 3) - 0.5) * 0.7 * (1 - lay * 0.3))); }
  return merge(g);
}

// ---------------------------------------------------------------- shader bits shared by the ground, the furrows and the crop
const MAXS = 16;
const GLSL_COMMON = /* glsl */`
  uniform vec3 sunDir; uniform vec3 camPos; uniform sampler2D fogTex; uniform float fogOn; uniform float mapSize; uniform float time; uniform vec2 uWind; uniform float uSnow;
  // lying snow (js/sim/weather.js): the terrain's own snow uniform, mirrored each frame, same colour as terrain.js
  const vec3 SNOW = vec3(.78,.81,.88);
  float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
  // the terrain's light, fog of war, haze and tone curve (js/render/terrain.js), so the fields sit in the land
  vec3 finish(vec3 lit, vec3 W){
    vec2 muv = vec2(W.x, -W.z) / mapSize;
    if (fogOn > .5) { vec2 wp = W.xz; vec2 fo = (vec2(vn(wp*.02), vn(wp*.02+5.)) - .5) * 30. / mapSize; float fv = texture(fogTex, muv + fo).r;
      float gy = dot(lit, vec3(.3,.59,.11)); vec3 remembered = mix(vec3(gy), lit, .35) * .45;
      lit = mix(mix(vec3(.0006), remembered, smoothstep(.15,.45,fv)), lit, smoothstep(.55,.95,fv)); }
    float dist = length(camPos - W); float grazing = 1. - abs(normalize(camPos - W).y);
    lit = mix(lit, vec3(.50,.56,.60), (1. - exp(-dist * .00022)) * grazing * grazing);
    lit = lit*(2.51*lit+.03)/(lit*(2.43*lit+.59)+.14);
    return pow(clamp(lit, 0., 1.), vec3(1./2.2));
  }
  // THE CROP's colour (linear) by growth g — shoots, tall green, yellowing, ripe — and crop (0 wheat 1 barley 2 oats 3 peas).
  // ear: the heads (they turn first and ripen to the crop's own gold); stalk: the leaves and straw below
  vec3 cropCol(float g, int crop, float ear){
    vec3 shoot = vec3(.040,.105,.030), green = vec3(.060,.108,.028), turn = vec3(.190,.165,.050);
    vec3 ripe = crop == 0 ? vec3(.40,.26,.075) : crop == 1 ? vec3(.43,.32,.12) : crop == 2 ? vec3(.37,.31,.165) : vec3(.20,.155,.065);
    vec3 straw = crop == 3 ? vec3(.16,.13,.06) : ripe * vec3(.92,.9,.8);
    if (crop == 1) green = vec3(.062,.104,.042);                 // barley: a paler, bluer green
    if (crop == 2) green = vec3(.066,.106,.032);
    if (crop == 3) { shoot = vec3(.06,.12,.035); green = vec3(.040,.095,.028); turn = vec3(.12,.115,.04); }
    vec3 c = mix(shoot, green, smoothstep(.12, .45, g));
    c = mix(c, turn, smoothstep(.62 - ear * .06, .84 - ear * .04, g));
    return mix(c, mix(straw, ripe, ear), smoothstep(.80 - ear * .05, .97, g));
  }`;
// the field's frame, its lands and which side of the work's front a point is on — the same in every field shader
const GLSL_FIELD = /* glsl */`
  uniform vec4 uRect; uniform vec2 uCtr; uniform vec2 uRot; uniform float uS; uniform float uPr[${MAXS}]; uniform int uDone; uniform int uUndone;
  uniform float uG; uniform int uCrop; uniform float uAge; uniform float uFire; uniform float uBand; uniform vec4 uPl[4]; uniform float uRel[${MAXS}]; uniform float uStk[${2 * MAXS}];
  uniform float uStake; uniform float uClear; uniform float uDitch;
  vec2 toLocal(vec3 W){ vec2 Pw = vec2(W.x, -W.z) - uCtr; return vec2(Pw.x * uRot.x + Pw.y * uRot.y, Pw.y * uRot.x - Pw.x * uRot.y); }
  // → the ground's look at P (0 stubble, 1 fallow, 2 ploughed, 3 harrowed/sown, 4 crop, 5 burnt, -1 virgin turf); fx: the
  // land coordinate (its integer part the land, the fraction across it); along: m from the south headland
  int fieldMode(vec2 P, vec2 wp, out float fx, out float along, out bool done){
    float lx = (P.x - uRect.x) / uRect.z, ly = (P.y - uRect.y) / uRect.w;
    fx = clamp(lx, 0., .9999) * uS; int i = int(floor(fx)); float p = uPr[i];
    along = ly * uRect.w;
    if (uBand > .5) {   // ploughing / sowing: the turned band grows out from the land's crown to its furrows
      float hw = abs(fract(fx) - .5) * 2., jag = (vn(wp * .45) - .5) * .035 + (vn(wp * 2.3) - .5) * .015;
      done = p >= .999 || (p > .001 && hw < p + jag);
      // …and the newest furrow is turned only BEHIND the team: ahead of a plough, in its own lane, the ground waits
      for (int k = 0; k < 4; k++) { vec4 q = uPl[k]; if (q.w > .5 && abs(P.x - q.x) < 1.3 && (P.y - q.y) * q.z > 0.) done = false; }
    } else {            // reaping: one line across the field from the south headland
      float front = p * uRect.w + (vn(wp * .45) - .5) * 1.4 + (vn(wp * 2.3) - .5) * .5;
      done = p >= .999 || (p > .001 && along < front);
    }
    return done ? uDone : uUndone;
  }
  // RIDGE AND FURROW: the plough's ridges (FP apart, thrown up by the mouldboard — asymmetric) and each land's crown.
  // How proud the ridges stand by the ground's look: fresh plough-land fully, harrowed a third, sinking under the crop,
  // weathered in the stubble, gone under fallow grass.
  const float FP = 1.15, RA = .14, CA = .16;
  float ridge(float x){ float t = fract(x / FP); t = t < .62 ? t / .62 * .5 : .5 + (t - .62) / .38 * .5; return .5 - .5 * cos(6.28318 * t); }
  float ampOf(int m){ return m == 2 ? 1. : m == 3 ? .32 : m == 4 ? .32 * (1. - smoothstep(.05, .5, uG)) + .06 : m == 0 ? .14 : m == 5 ? .1 : 0.; }
  float crownH(float fx, int m){ return m < 0 ? 0. : CA * sin(3.14159 * fract(fx)); }`;

export function makeRender(scene, map, ctx) {
  const figures = ctx?.figures || null;
  // ---- borrow the terrain's live uniforms (fog of war texture, camera) — read-only; found once in the scene
  let TU = null;
  const findTerrain = () => { scene.traverse((o) => { if (!TU && o.material?.uniforms?.surfId && o.material.uniforms.fogTex) TU = o.material.uniforms; }); return TU; };
  const common = { sunDir: { value: SUN_DIR }, camPos: { value: new THREE.Vector3() }, fogTex: { value: null }, fogOn: { value: 0 }, mapSize: { value: map.size }, time: { value: 0 }, uWind: { value: new THREE.Vector2(1.1, 0.8) }, uSnow: { value: 0 } }; // uWind: the sim's wind in three's xz (set from w.wind each update; the default is the old gentle drift)
  // ---- the field textures — the world's own terrain sets (assets/terrain), so the fields sit in the land's light:
  // 0 ploughed earth, 1 grazed pasture (the fallow's grass, as on the commons round it), 2 standing wheat, 3 barley,
  // 4 stubble (its straw is recoloured: no green), 5 burnt, 6 tall grass (the fallow's weedy patches)
  const TEX = ["ploughed_field", "grazed_pasture", "wheat_field", "barley_field", "stubble_field", "burned_ground", "tall_grass"];
  const texU = { fAlb: { value: null }, fNrm: { value: null }, fTile: { value: new Float32Array(8).fill(6) }, texOn: { value: 0 } };
  if (typeof document !== "undefined") loadSurfaceArrays(TEX, {}).then((a) => { texU.fAlb.value = a.albedo; texU.fNrm.value = a.normal; texU.fTile.value.set(a.tile); texU.texOn.value = a.loaded >= 5 ? 1 : 0; for (const m of allMats) m.needsUpdate = true; }).catch(() => {});
  { // (1-layer placeholders until the arrays arrive: the samplers must be bound)
    const t = new THREE.DataArrayTexture(new Uint8Array([128, 110, 80, 255]), 1, 1, 1); t.needsUpdate = true; texU.fAlb.value = t;
    const n = new THREE.DataArrayTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, 1); n.needsUpdate = true; texU.fNrm.value = n;
  }
  const allMats = new Set();
  // detail by the View panel's quality (js/render/quality.js): how near the ridges are built in 3D, how many layers the
  // standing corn has, how far the corn stands at all
  const LOD = { low: { relief: 0, reliefCap: 0, shells: [0, 0, 0], shellFar: 0 }, medium: { relief: 230, reliefCap: 30, shells: [7, 5, 3], shellFar: 560 }, high: { relief: 380, reliefCap: 70, shells: [11, 7, 4], shellFar: 900 } };   // (beyond shellFar the drape carries the crop: layered corn that far off only speckles)
  const lod = () => LOD[Q.name] || LOD.medium;

  // ================================================================ the ground of each field (the drape)
  const GROUND_FRAG = /* glsl */`
      uniform sampler2DArray fAlb; uniform sampler2DArray fNrm; uniform float fTile[8]; uniform float texOn; uniform float uShell;
      // the ground's normal with the ridges' light on it (analytic: the drape's coarse mesh gets it too); far off, where the
      // ridges would shimmer, they fade into the even darkness of a furrowed field
      vec3 reliefN(vec3 n, vec2 P, float fx, int m, out float fade){
        float fw = fwidth(P.x) + fwidth(P.y) * .25;
        fade = 1. - smoothstep(FP * .22, FP * .55, fw);
        float a = RA * ampOf(m) * fade, e = .06;
        float d = a * (ridge(P.x + e) - ridge(P.x - e)) / (2. * e) + (m < 0 ? 0. : CA * 3.14159 * uS / uRect.z * cos(3.14159 * fract(fx)));
        vec3 ax = vec3(uRot.x, 0., -uRot.y);       // the field's local +x, in three's frame
        return normalize(n - d * ax);
      }
      vec3 T(int L, vec2 uv){
        if (texOn < .5) { vec3 c[7] = vec3[7](vec3(.084,.05,.025), vec3(.10,.13,.04), vec3(.41,.28,.07), vec3(.45,.33,.10), vec3(.21,.17,.07), vec3(.03,.03,.03), vec3(.09,.12,.04)); return c[L] * (.85 + .3 * vn(uv * .7)); }
        float t = fTile[L]; vec2 u1 = uv / t, u2 = mat2(.8,-.6,.6,.8) * uv / (t * 2.3) + .37;
        return mix(texture(fAlb, vec3(u1, float(L))).rgb, texture(fAlb, vec3(u2, float(L))).rgb, smoothstep(.35, .65, vn(uv * .05)));
      }
      // the plough-land texture in the field's own frame (its furrows run down the land: texture V = furrow direction)
      vec3 earthT(vec2 sp, float k){ float t = fTile[0] / k; return texOn > .5 ? texture(fAlb, vec3(sp / t, 0.)).rgb : vec3(.084,.05,.025) * (.85 + .3 * vn(sp * .7)); }
      const vec3 EARTH = vec3(.084, .050, .026);    // turned earth, the texture's mean: a dark rich brown
      // what the ground looks like (linear albedo): 0 stubble, 1 fallow, 2 ploughed, 3 harrowed/sown, 4 under the crop, 5 burnt
      vec3 surf(int m, vec2 wp, vec2 P, float fx){
        if (m == 2) {   // fresh plough-land: dark, rich, turned earth; damper in the furrow bottoms
          vec3 e = earthT(P, 1.) * vec3(.66, .58, .55);
          return e * (.9 + .18 * vn(wp * .04));
        }
        if (m == 3) {   // harrowed and sown: a finer tilth, a shade lighter and duller as it dries
          vec3 e = mix(earthT(P, 2.6), EARTH, .45) * vec3(.98, .93, .9);
          return e * (.94 + .1 * vn(wp * .05));
        }
        if (m == 0) {   // stubble: pale gold stalk stubs on the earth (the stubble set's straw, its green weeds taken out)
          vec3 st = T(4, wp); float l = dot(st, vec3(.3,.59,.11));
          float stub = smoothstep(.06, .30, l + (vn(wp * 3.1) - .5) * .05);
          vec3 straw = vec3(.30, .215, .085) * (.8 + 1.2 * l), soil = mix(earthT(P, 1.6), EARTH, .5) * .95;
          vec3 c = mix(soil, straw, .25 + stub * .65);
          // greening over as it ages (the weeds and the grazing come in), patchily
          float gr = uAge * smoothstep(.25, .75, vn(wp * .07) + uAge * .5);
          return mix(c, T(1, wp) * .95, gr * .85);
        }
        if (m == 1) {   // fallow: grass and weeds — the pasture round it, rougher, with docks and thistles in clumps
          vec3 c = T(1, wp) * vec3(.78, .74, .6);
          float dock = smoothstep(.68, .8, vn(wp * .55 + 3.)) * .5;               // docks and thistles: darker clumps
          c = mix(c, c * vec3(.62, .72, .6), dock);
          c *= .94 + .1 * sin(3.14159 * fract(fx));                                  // (the old lands' crowns, faint under the grass)
          return c;
        }
        if (m == 5) return T(5, wp);
        // m 4: under the crop — the seed-bed, and the crop itself where no layered corn is drawn (far off, Low)
        vec3 soil = mix(earthT(P, 2.6), EARTH, .45) * vec3(1.12, 1.06, 1.);
        float cov = clamp(smoothstep(.02, .3, uG) * .75 * (.8 + .4 * vn(wp * .9)) + smoothstep(.3, .55, uG), 0., 1.);   // (the shoots: a green haze over the tilth)
        vec3 crop = cropCol(uG, uCrop, smoothstep(.5, .9, uG));
        if (uShell > .5) crop *= mix(1., .42, smoothstep(.3, .6, uG));   // (the layered corn stands over this: down among the stalks it is dark)
        vec3 c = mix(soil, crop, cov);
        return c * (.92 + .16 * vn(wp * .018) + .05 * (h21(floor(P.yy / 40.)) - .5));   // uneven stand; each land sown by another hand
      }`;
  function groundShaders(relief) {
    return {
      vertexShader: /* glsl */`
        ${GLSL_COMMON}
        ${GLSL_FIELD}
        out vec3 vW; out vec3 vN;
        void main(){
          vN = normal; vec4 w = modelMatrix * vec4(position, 1.);
          // the land's crown (and, on the near 3D tiles, the plough's ridges) raise the ground
          vec2 P = toLocal(w.xyz); float fx, along; bool done; int m = fieldMode(P, w.xz, fx, along, done);
          w.y += crownH(fx, m)${relief ? " + RA * ampOf(m) * ridge(P.x)" : ""};
          vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`
        precision highp float; precision highp sampler2DArray;
        ${GLSL_COMMON}
        ${GLSL_FIELD}
        ${GROUND_FRAG}
        in vec3 vW; in vec3 vN; out vec4 outColor;
        void main(){
          vec2 wp = vW.xz, P = toLocal(vW);
          float fx, along; bool done; int m = fieldMode(P, wp, fx, along, done);
          float lx = (P.x - uRect.x) / uRect.z, ly = (P.y - uRect.y) / uRect.w;
          float edgeM = min(min(lx, 1. - lx) * uRect.z, min(ly, 1. - ly) * uRect.w);   // m in from the field's edge
          if (m < 0) { // virgin ground: the real turf shows — but a field staked out shows its line (a pace-wide trodden path
            // round it, the men's stakes), and while it is being cleared the brush and undergrowth cut down where they have been
            float line = (1. - smoothstep(.35, .9, abs(edgeM - 1.)) ) * uStake;
            float cut = uClear > 0. ? step(vn(wp * .06) * .8 + vn(wp * .5) * .2, uClear) * smoothstep(1.6, 3., edgeM) : 0.;
            if (line < .04 && cut < .5) discard;
            vec3 c0 = cut > .5 ? mix(T(1, wp) * vec3(.9, .82, .62), EARTH * 1.4, .35) : mix(T(1, wp) * .7, EARTH * 1.3, .6);
            vec3 nn = normalize(vN); float dif = max(dot(nn, sunDir), 0.);
            vec3 l0 = c0 * (vec3(1.,.95,.86) * dif * 2.6 + vec3(.55,.62,.72) * .38 * (.6 + .4 * nn.y));
            outColor = vec4(finish(l0, vW), max(line, cut) * (cut > .5 ? .92 : .75)); return;
          }
          int i = int(floor(fx));
          ${relief ? "" : "if (uRel[i] > 0.) { float r = floor(clamp(along, 0., uRect.w - .01) / 40.); if (mod(floor(uRel[i] / exp2(r)), 2.) > .5) discard; }  // (a 3D tile stands here)"}
          vec3 col = surf(m, wp, P, fx);
          // the open furrow between two lands: a darker, damper line
          float e = fract(fx), dm = min(e, 1. - e) * uRect.z / uS;
          col *= mix(.78, 1., smoothstep(.2, 1.3, dm + (vn(wp * .5) - .5) * .4));
          col = mix(col, vec3(.024), uFire * .7);
          // stooks standing in the reaped lands (labour items): their footprint and shadow, so the rows read from afar
          if (done && (uDone == 0 || uDone == 1)) {
            int hf = along < uRect.w * .5 ? 0 : 1; float sw = uRect.z / uS, xc = uRect.x + (float(i) + .5) * sw;
            float ro[4] = float[4](${STOOK_ROWS.map((v) => v.toFixed(3)).join(", ")});
            int rb = 0; float bd = 1e9; for (int r = 0; r < 4; r++) { float dd = abs(P.x - (xc + ro[r] * 40.)); if (dd < bd) { bd = dd; rb = r; } }
            float n = uStk[i * 2 + hf];
            if (n > .5) {
              float a = along - (float(hf) * .5 * uRect.w + 4.), j = floor(a / ${STOOK_SPACING.toFixed(1)} + .5);
              if (j >= 0. && j < n) {
                vec2 q = vec2(a - j * ${STOOK_SPACING.toFixed(1)}, P.x - (xc + ro[rb] * 40.));
                float r = length(q / vec2(1.3, .8)), sh = length((q - vec2(1.1, .9)) / vec2(1.6, 1.0));
                col = mix(col, col * .4, (1. - smoothstep(.8, 1.5, sh)) * .8);
                col = mix(col, col * .75, 1. - smoothstep(.6, 1.0, r));
              }
            }
          }
          if (uSnow > .01) col = mix(col, SNOW, clamp(uSnow * (.78 + .22 * vn(wp * .35)), 0., 1.));
          // the light: the ridges and the land's crown catch the sun (the plough-land's own clods besides, near to)
          float fade; vec3 n = reliefN(normalize(vN), P, fx, m, fade);
          if (texOn > .5 && (m == 2 || m == 3)) { vec3 tn = texture(fNrm, vec3(P / (fTile[0] / (m == 2 ? 1. : 2.6)), 0.)).xyz * 2. - 1.;
            vec3 ax = vec3(uRot.x, 0., -uRot.y), ay = vec3(uRot.y, 0., uRot.x); n = normalize(n + (tn.x * ax + tn.y * ay) * .55 * fade * (m == 2 ? 1. : .5)); }
          col *= 1. - (1. - fade) * .16 * ampOf(m);          // (far off: the furrows' shadows, evened out)
          col *= 1. + (1. - fade) * .09 * ampOf(m) * sin(6.28318 * P.x / 4.6 + (vn(wp * .05) - .5) * 2.);   // (…and the plough's rounds, a stripe every few ridges)
          float diff = max(dot(n, sunDir), 0.);
          vec3 lit = col * (vec3(1.,.95,.86) * diff * 2.6 + vec3(.55,.62,.72) * .38 * (.6 + .4 * n.y));
          // a crisp edge (the men's work stops at their line), and round a field they have made, the ditch they dug
          float a = smoothstep(0., .45, edgeM + (vn(wp * .4) - .5) * .25);
          if (a < .01) discard;
          if (uDitch > .5) lit = mix(lit, lit * vec3(.42, .45, .38) + vec3(.004, .006, .003), (1. - smoothstep(.45, 1.25, edgeM)) * .85);
          outColor = vec4(finish(lit, vW), a);
        }`,
    };
  }
  const fieldUniforms = () => ({ uRect: { value: new THREE.Vector4() }, uCtr: { value: new THREE.Vector2() }, uRot: { value: new THREE.Vector2(1, 0) }, uS: { value: 1 }, uPr: { value: new Float32Array(MAXS) }, uDone: { value: 0 }, uUndone: { value: 0 },
    uG: { value: 0 }, uCrop: { value: 0 }, uAge: { value: 0 }, uFire: { value: 0 }, uStk: { value: new Float32Array(2 * MAXS) }, uBand: { value: 0 }, uPl: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, uRel: { value: new Float32Array(MAXS) }, uShell: { value: 0 }, uStake: { value: 0 }, uClear: { value: 0 }, uDitch: { value: 0 } });
  const mkGround = (U, relief) => { const m = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, transparent: true, depthWrite: relief, polygonOffset: true, polygonOffsetFactor: relief ? -1 : -2, polygonOffsetUnits: relief ? -2 : -6, uniforms: { ...common, ...texU, ...U }, ...groundShaders(relief) }); allMats.add(m); return m; };

  const fieldsR = new Map(); // b.id → the field's meshes and shared uniforms
  const hmax = (x, y) => Math.max(map.h(x, y), map.h(x - 3, y), map.h(x + 3, y), map.h(x, y - 3), map.h(x, y + 3));
  function fieldMesh(b) {
    const cell = 6, nx = Math.max(2, Math.ceil(b.w / cell)), ny = Math.max(2, Math.ceil(b.h / cell));
    const geo = new THREE.PlaneGeometry(b.w, b.h, nx, ny); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, rc = Math.cos(b.rot || 0), rs = Math.sin(b.rot || 0);
    // each vertex rides the HIGHEST ground nearby, or on rough ground the terrain pokes through between vertices
    for (let k = 0; k < pos.count; k++) { const lx = pos.getX(k), ly = -pos.getZ(k); const x = b.x + lx * rc - ly * rs, y = b.y + lx * rs + ly * rc; pos.setXYZ(k, x, hmax(x, y) + 0.12, -y); }
    geo.computeVertexNormals(); geo.computeBoundingSphere();
    const U = fieldUniforms();
    U.uRect.value.set(-b.w / 2, -b.h / 2, b.w, b.h); U.uCtr.value.set(b.x, b.y); U.uRot.value.set(rc, rs);
    const mat = mkGround(U, false);
    const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = 3; scene.add(mesh);
    return { mesh, mat, U, geo, key: "", x: b.x, y: b.y, w: b.w, h: b.h, rot: b.rot || 0, tiles: new Map(), shell: null, stub: null };
  }
  function dropField(F) {
    scene.remove(F.mesh); F.geo.dispose(); allMats.delete(F.mat); F.mat.dispose();
    for (const T of F.tiles.values()) { scene.remove(T.mesh); T.mesh.geometry.dispose(); } F.tiles.clear(); if (F.reliefMat) { allMats.delete(F.reliefMat); F.reliefMat.dispose(); }
    for (const k of ["shell", "stub"]) if (F[k]) { scene.remove(F[k].mesh); F[k].mesh.geometry.dispose(); allMats.delete(F[k].mat); F[k].mat.dispose(); F[k] = null; }
  }
  const CROP_I = { wheat: 0, barley: 1, oats: 2, peas: 3 };
  // what each side of the front looks like, by state/op
  function look(w, f) {
    if (f.state === "clearing") return [-1, -1];
    if (f.state === "burnt") return [5, 5];
    if (f.state === "growing" && f.op === "plough") return [2, f.virgin ? -1 : 1];
    if (f.state === "growing" && f.op === "sow") return [3, 2];
    if (f.state === "growing") return [4, 4];
    if (f.state === "ripe") return [0, 4];
    if (f.state === "stubble") return [0, 0];
    return [1, 1];
  }
  function syncField(w, b, F, stk, pl) {
    const f = b.field, doy = w.econ.doy, U = F.U;
    U.uStk.value.fill(0); const st = stk.get(b.id); if (st) for (const [k, n] of st) if (k < 2 * MAXS) U.uStk.value[k] = n;
    const S = Math.min(MAXS, f.pr?.length || stripsOf(b));
    const g = f.state === "ripe" ? 1 : growth(f, doy);
    let [dn, un] = look(w, f);
    if (f.virgin && un === 1) un = -1;
    if (f.virgin && dn === 1) dn = -1;   // (made but not yet broken: still turf, inside the line)
    U.uStake.value = f.state === "clearing" || (f.virgin && !f.op) ? 1 : 0;
    U.uClear.value = f.state === "clearing" ? (f.make?.brush || 0) : 0;
    U.uDitch.value = f.state !== "clearing" && !(f.virgin && !f.op) ? 1 : 0;   // (a worked field: its boundary ditch, dug when it was made)
    U.uS.value = S; for (let i = 0; i < MAXS; i++) U.uPr.value[i] = f.pr ? (f.pr[i] ?? 0) : 1;
    U.uBand.value = f.state === "growing" && (f.op === "plough" || f.op === "sow") ? 1 : 0;
    U.uDone.value = dn; U.uUndone.value = un; U.uG.value = g; U.uCrop.value = CROP_I[f.crop] ?? 0;
    U.uAge.value = f.state === "stubble" ? Math.min(1, Math.max(0, (doy - (f.stubAt ?? doy)) / 75)) : 0;
    U.uFire.value = b.fire > 0 ? Math.min(1, b.fire) * 0.6 : 0;
    for (let k = 0; k < 4; k++) { const q = pl?.[k]; if (q && f.op === "plough") U.uPl.value[k].set(q[0], q[1], q[2], 1); else U.uPl.value[k].w = 0; }
    if (F.x !== b.x || F.y !== b.y || F.w !== b.w || F.h !== b.h || F.rot !== (b.rot || 0)) { dropField(F); Object.assign(F, fieldMesh(b)); }
    return g;
  }

  // ================================================================ RIDGE AND FURROW in 3D near the camera
  // The drape is a 6 m mesh: the ridges are drawn on it as light only. Near the camera, where a field is being ploughed or
  // sown or the crop is still short, each 40 m stretch of a land becomes a fine mesh (a vertex every 0.29 m across the
  // land, every 2.5 m along it) that the vertex shader raises into the plough's ridges — exactly where the sim has the
  // ground turned, so they come up behind the team — and the drape lets it through (uRel).
  const TILE = 40;
  function tileGeo(b, i, row) {
    const S = stripsOf(b), sw = b.w / S, x0 = -b.w / 2 + i * sw, y0 = -b.h / 2 + row * TILE, y1 = Math.min(b.h / 2, y0 + TILE);
    const nx = Math.max(2, Math.ceil(sw / 0.29)), ny = Math.max(2, Math.ceil((y1 - y0) / 2.5));
    const rc = Math.cos(b.rot || 0), rs = Math.sin(b.rot || 0), P = new Float32Array((nx + 1) * (ny + 1) * 3), N = new Float32Array(P.length), I = [];
    // heights: the drape's own rule (the highest ground near), sampled on the coarse rows and blended across
    const hrow = []; for (let r = 0; r <= ny; r++) { const ly = y0 + (y1 - y0) * r / ny, row2 = []; for (let c = 0; c <= 8; c++) { const lx = x0 + sw * c / 8; row2.push(hmax(b.x + lx * rc - ly * rs, b.y + lx * rs + ly * rc) + 0.12); } hrow.push(row2); }
    let k = 0;
    for (let r = 0; r <= ny; r++) for (let c = 0; c <= nx; c++, k++) {
      const lx = x0 + sw * c / nx, ly = y0 + (y1 - y0) * r / ny, x = b.x + lx * rc - ly * rs, y = b.y + lx * rs + ly * rc;
      const u = c / nx * 8, c0 = Math.min(7, Math.floor(u)), t = u - c0, h = hrow[r][c0] * (1 - t) + hrow[r][c0 + 1] * t;
      P[k * 3] = x; P[k * 3 + 1] = h; P[k * 3 + 2] = -y; N[k * 3 + 1] = 1;
    }
    for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) { const a = r * (nx + 1) + c, d = a + nx + 1; I.push(a, a + 1, d, a + 1, d + 1, d); }   // (wound to face up)
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(P, 3)); g.setAttribute("normal", new THREE.BufferAttribute(N, 3)); g.setIndex(I); g.computeBoundingSphere();
    return g;
  }
  let reliefBudget = 0;
  function syncRelief(b, F, cx, cy, ch, g) {
    const f = b.field, L = lod(), U = F.U;
    const want = L.relief > 0 && f.state === "growing" && (f.op === "plough" || f.op === "sow" || g < 0.3) && !(b.fire > 0);
    const keep = new Set();
    if (want) {
      const S = Math.min(MAXS, stripsOf(b)), sw = b.w / S, rc = Math.cos(b.rot || 0), rs = Math.sin(b.rot || 0);
      for (let i = 0; i < S; i++) for (let row = 0; row < Math.ceil(b.h / TILE); row++) {
        const lxc = -b.w / 2 + (i + 0.5) * sw, lyc = -b.h / 2 + row * TILE + TILE / 2, xc = b.x + lxc * rc - lyc * rs, yc = b.y + lxc * rs + lyc * rc;
        if (Math.hypot(xc - cx, yc - cy, map.h(xc, yc) - ch) > L.relief) continue;
        const key = i * 64 + row; keep.add(key);
        if (!F.tiles.has(key)) {
          if (reliefBudget <= 0 || F.tiles.size >= L.reliefCap) { keep.delete(key); continue; }
          reliefBudget--;
          F.reliefMat ||= mkGround(U, true);
          const mesh = new THREE.Mesh(tileGeo(b, i, row), F.reliefMat); mesh.renderOrder = 2; scene.add(mesh);
          F.tiles.set(key, { mesh, i, row });
        }
      }
    }
    U.uRel.value.fill(0);
    for (const [key, T] of F.tiles) {
      if (!keep.has(key)) { scene.remove(T.mesh); T.mesh.geometry.dispose(); F.tiles.delete(key); continue; }
      U.uRel.value[T.i] += 2 ** T.row;
    }
  }

  // ================================================================ THE STANDING CORN: layered shells over the field
  // The crop is drawn as K thin layers stacked from the ground to the ears (instanced: one draw a field). Each layer cuts
  // the stalks at its height from a tiling pattern of stalks (R: a stalk here, G: its height, B: its head) — near to, the
  // single stalks and their ears; far off the pattern's mipmaps average into the canopy itself, a solid mass with real
  // height, its top lit, its flanks dark where the crop stands against bare ground. Height and colour by growth and crop
  // (wheat tall and gold, barley shorter and paler with nodding heads, oats loose and buff, peas a low tangled mass), the
  // layers swaying down the wind, the upper ones most. The reaped part shows short stubble (two layers) instead.
  const stalkPat = (() => {
    if (typeof document === "undefined") return null;
    const N = 256, c = document.createElement("canvas"); c.width = c.height = N; const g = c.getContext("2d");
    g.fillStyle = "rgb(0,0,0)"; g.fillRect(0, 0, N, N);
    let s = 11; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    // ~700 stalks on a 1.6 m tile (≈ 270 a square metre, a fair stand of corn), each a dot: R = 1, G = its height, B = its head
    for (let k = 0; k < 700; k++) {
      const x = rnd() * N, y = rnd() * N, h = 0.72 + rnd() * 0.28, hd = 3.4 + rnd() * 2.2;
      for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
        g.fillStyle = `rgb(255,${Math.round(h * 255)},255)`; g.beginPath(); g.ellipse(x + ox, y + oy, hd * 0.55, hd, rnd() * 3.14, 0, 6.283); g.fill();   // the head (wider) …
      }
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4; t.colorSpace = THREE.NoColorSpace;
    return t;
  })();
  const SHELL_V = /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_FIELD}
    uniform float uH; uniform float uK; uniform float uStubble;
    out vec3 vW; out float vL; out vec2 vP; out float vWave;
    void main(){
      vec4 w = modelMatrix * vec4(position, 1.);
      float L = (float(gl_InstanceID) + 1.) / uK;           // this layer's height, of the crop's
      vec2 P = toLocal(w.xyz); float fx, along; bool done; int m = fieldMode(P, w.xz, fx, along, done);
      // down the wind: the upper layers lean and sway most (a gust rolls across the field)
      float wl = length(uWind); vec2 wd = wl > .3 ? normalize(uWind) : vec2(.85, .53);
      float wave = sin(dot(w.xz, wd) * .09 - time * (1.3 + .1 * min(wl, 14.)) + vn(w.xz * .012) * 5.) * .5 + .5;
      float lean = (.05 + .1 * min(wl, 14.) / 14.) * (1. - uStubble) * (.4 + .9 * wave);
      w.xz += wd * lean * uH * L * L;
      w.y += crownH(fx, m) + uH * L - (uStubble > .5 ? 0. : .04);
      vL = L; vW = w.xyz; vP = P; vWave = wave;
      gl_Position = projectionMatrix * viewMatrix * w; }`;
  const SHELL_F = /* glsl */`
    precision highp float; precision highp sampler2DArray;
    ${GLSL_COMMON}
    ${GLSL_FIELD}
    uniform sampler2D pat; uniform float uH; uniform float uK; uniform float uStubble; uniform float uDense; uniform float uScale;
    in vec3 vW; in float vL; in vec2 vP; in float vWave; out vec4 outColor;
    uniform sampler2DArray fAlb; uniform float fTile[8]; uniform float texOn;
    void main(){
      float fx, along; bool done; int m = fieldMode(vP, vW.xz, fx, along, done);
      // where the corn stands: before the reapers (or all of it, growing) — the stubble where they have been
      bool standing = uStubble > .5 ? (uDone == 0 && done) || (uUndone == 0) : (m == 4);
      if (!standing) discard;
      float lx = (vP.x - uRect.x) / uRect.z, ly = (vP.y - uRect.y) / uRect.w;
      if (min(min(lx, 1. - lx) * uRect.z, min(ly, 1. - ly) * uRect.w) < 1.2 + vn(vW.xz * .3) * 1.5) discard;   // (a ragged headland)
      vec2 uv = vP / uScale + vec2(.37, .11) * float(int(fx));
      vec4 t = texture(pat, uv);
      float cover = t.r * uDense, hgt = t.g / max(t.r, .02);         // (far off: how much of the ground the stalks cover, their mean height)
      float a = cover * (1. - smoothstep(hgt - .2, hgt + .02, vL));
      // a patchy stand in the young corn, thinner in the furrows between the lands
      float stand = .78 + .22 * smoothstep(.1, .45, uG) + (vn(vW.xz * .25) - .5) * .3;
      float edge = min(fract(fx), 1. - fract(fx)) * uRect.z / uS;
      a *= clamp(stand, 0., 1.) * smoothstep(.3, 1.6, edge);
      if (a < .15) discard;
      float ear = uStubble > .5 || uCrop == 3 ? 0. : smoothstep(hgt - .3, hgt - .12, vL) * smoothstep(.42, .62, uG);
      vec3 col = uStubble > .5 ? vec3(.30, .225, .095) * (.8 + .5 * vL) : cropCol(uG, uCrop, ear);
      col *= .86 + .28 * vn(vW.xz * .05) + .1 * (vn(vW.xz * .35) - .5);
      // each stalk its own shade (the taller ones catch more light), and the crop stands taller and lighter on the
      // plough's ridges than in the furrows between them — the ridge and furrow shows through the corn
      col *= mix(1., .72 + .56 * clamp((hgt - .72) / .28, 0., 1.), smoothstep(.3, .9, vL)) * (.86 + .22 * ridge(vP.x));
      // a field is never one flat colour: each land sown by another hand, the ground's damp and dry patches, and the
      // streaks the wind has combed into it
      vec2 wd2 = length(uWind) > .3 ? normalize(uWind) : vec2(.85, .53);
      col *= (.93 + .14 * h21(vec2(floor(fx), 3.))) * (.88 + .24 * vn(vW.xz * .018)) * (.92 + .16 * vn(vec2(dot(vW.xz, wd2) * .015, dot(vW.xz, vec2(-wd2.y, wd2.x)) * .12)));
      // the world's own standing-corn sets (wheat, barley) give the ripe heads their grain — poppies, lodged patches
      if (texOn > .5 && uStubble < .5 && uCrop < 2) { vec3 tc = texture(fAlb, vec3(vW.xz / fTile[2 + uCrop], float(2 + uCrop))).rgb; col *= mix(vec3(1.), tc / (uCrop == 0 ? vec3(.41,.28,.07) : vec3(.5,.42,.17)), .55 * ear * smoothstep(.8, 1., uG)); }
      // the wind's sheen rolling over the tops
      col *= mix(1., .8 + .4 * vWave, smoothstep(.4, 1., vL) * (1. - uStubble));
      // down among the stalks it is dark; the tops in the open light
      col *= mix(.28, 1.08, pow(vL, .75));
      if (uSnow > .01) col = mix(col, SNOW, uSnow * .8 * smoothstep(.3, .9, vL));
      float lightv = .5 + .5 * max(sunDir.y, 0.);
      vec3 lit = col * (vec3(1.,.95,.86) * lightv * 2.05 * mix(.5, 1., vL) + vec3(.55,.62,.72) * .36);
      outColor = vec4(finish(lit, vW), clamp(a * 1.6, 0., 1.));
    }`;
  const HH = { wheat: 1.12, barley: 0.85, oats: 1.0, peas: 0.55 };
  const SCALE = { wheat: 1.6, barley: 1.9, oats: 2.4, peas: 4.2 }, DENSE = { wheat: 1.35, barley: 1.15, oats: 0.95, peas: 1.9 };
  function syncShell(b, F, kind, K, g) {
    const f = b.field;
    if (!K) { if (F[kind]) F[kind].mesh.visible = false; return; }
    let S = F[kind];
    if (!S) {
      const sg = new THREE.InstancedBufferGeometry(); sg.index = F.geo.index; sg.setAttribute("position", F.geo.attributes.position); sg.setAttribute("normal", F.geo.attributes.normal);
      sg.boundingSphere = F.geo.boundingSphere.clone(); sg.boundingSphere.radius += 2;
      const mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, side: THREE.DoubleSide, alphaToCoverage: true, uniforms: { ...common, ...texU, ...F.U, pat: { value: stalkPat }, uH: { value: 1 }, uK: { value: 1 }, uStubble: { value: kind === "stub" ? 1 : 0 }, uDense: { value: 1 }, uScale: { value: 1.6 } }, vertexShader: SHELL_V, fragmentShader: SHELL_F });
      allMats.add(mat);
      const mesh = new THREE.Mesh(sg, mat); mesh.renderOrder = 1; scene.add(mesh);
      S = F[kind] = { mesh, mat };
    }
    const u = S.mat.uniforms;
    if (kind === "stub") { u.uH.value = 0.16; u.uDense.value = 0.85; u.uScale.value = 1.3; }
    else { u.uH.value = (HH[f.crop] || 1) * (0.05 + 0.95 * Math.min(1, g * 1.3)); u.uDense.value = (DENSE[f.crop] || 1) * (0.55 + 0.45 * Math.min(1, g * 2.5)); u.uScale.value = SCALE[f.crop] || 1.6; }
    u.uK.value = K; S.mesh.geometry.instanceCount = K; S.mesh.visible = true;
  }

  // ================================================================ the standing crop near the camera (instanced cards)
  const stalkTex = (() => {   // R: stalks (and leaves), G: ears — drawn once on a canvas; alpha-tested
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas"); c.width = 256; c.height = 256; const g = c.getContext("2d");
    g.clearRect(0, 0, 256, 256); let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 26; k++) {
      const x0 = 10 + rnd() * 236, lean = (rnd() - 0.5) * 50, top = 6 + rnd() * 40, x1 = x0 + lean;
      g.strokeStyle = "rgb(255,0,0)"; g.lineWidth = 2.2 + rnd() * 1.5; g.beginPath(); g.moveTo(x0, 256); g.quadraticCurveTo(x0 + lean * 0.3, 140, x1, top + 26); g.stroke();
      if (rnd() < 0.6) { g.lineWidth = 2; g.beginPath(); const ly = 150 + rnd() * 80; g.moveTo(x0 + lean * 0.12, ly); g.quadraticCurveTo(x0 + (rnd() - 0.5) * 60, ly - 30, x0 + (rnd() - 0.5) * 70, ly - 10 + rnd() * 20); g.stroke(); }
      g.fillStyle = "rgb(0,255,0)"; g.save(); g.translate(x1, top + 14); g.rotate(Math.atan2(lean, 230) * 0.8); g.beginPath(); g.ellipse(0, 0, 3.6, 15, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "rgb(0,255,0)"; g.lineWidth = 1; for (let a = 0; a < 5; a++) { g.beginPath(); g.moveTo(0, -8 + a * 4); g.lineTo(-5 + (a % 2) * 10, -18 + a * 4); g.stroke(); } g.restore();
    }
    const t = new THREE.CanvasTexture(c); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; return t;
  })();
  const CAP = 70000;
  const cardGeo = new THREE.InstancedBufferGeometry();
  { // two crossed quads, x in [-.5,.5], y in [0,1]
    const P = [], UV = [], I = [];
    for (let q = 0; q < 2; q++) { const a = q * Math.PI / 2 + 0.3, cx = Math.cos(a), cz = Math.sin(a), o = q * 4;
      P.push(-0.5 * cx, 0, -0.5 * cz, 0.5 * cx, 0, 0.5 * cz, 0.5 * cx, 1, 0.5 * cz, -0.5 * cx, 1, -0.5 * cz); UV.push(0, 0, 1, 0, 1, 1, 0, 1); I.push(o, o + 1, o + 2, o, o + 2, o + 3); }
    cardGeo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); cardGeo.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2)); cardGeo.setIndex(I);
  }
  const iP = new Float32Array(CAP * 4), iQ = new Float32Array(CAP * 4);
  const aP = new THREE.InstancedBufferAttribute(iP, 4).setUsage(THREE.DynamicDrawUsage), aQ = new THREE.InstancedBufferAttribute(iQ, 4).setUsage(THREE.DynamicDrawUsage);
  cardGeo.setAttribute("iP", aP); cardGeo.setAttribute("iQ", aQ); cardGeo.instanceCount = 0;
  const cropMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, side: THREE.DoubleSide,
    uniforms: { ...common, stalks: { value: stalkTex } },
    vertexShader: /* glsl */`
      in vec4 iP; in vec4 iQ; out vec2 vUv; out vec3 vW; out vec4 vQ;
      uniform float time; uniform vec2 uWind;
      void main(){
        vUv = uv; vQ = iQ;
        float c = cos(iP.w), s = sin(iP.w);
        vec3 p = position; p.x *= iQ.y; p.z *= iQ.y; p.y *= iQ.x;
        p = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
        float wl = length(uWind);
        vec2 wd = wl > .3 ? normalize(uWind) : vec2(.85, .53);
        float sway = sin(time * (1.6 + .1 * min(wl, 14.)) + iP.x * .19 + iP.z * .13) * .5 + sin(time * 2.7 + iP.x * .5) * .2;
        p.xz += wd * (sway * (.16 + .1 * min(wl, 14.) / 14.) + .04 * min(wl, 14.) / 14.) * uv.y * uv.y * iQ.x; // sway down the wind, leaning with a blow
        vec4 w = modelMatrix * vec4(iP.xyz + p, 1.); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      precision highp float;
      ${GLSL_COMMON}
      uniform sampler2D stalks;
      in vec2 vUv; in vec3 vW; in vec4 vQ; out vec4 outColor;
      void main(){
        vec4 t = texture(stalks, vUv);
        float g = vQ.z; int kind = int(vQ.w + .5); int crop = kind - 10 * (kind / 10); bool stub = kind >= 10;
        float ear = t.g * (stub || crop == 3 ? 0. : smoothstep(.45, .6, g));
        if (t.r + ear < .5) discard;
        vec3 col = stub ? vec3(.30, .225, .095) * (.7 + .5 * vUv.y) : cropCol(g, crop, ear > .5 ? 1. : 0.);
        col *= mix(.35, 1.05, pow(vUv.y, .8));                          // darker down among the stalks
        if (uSnow > .01) col = mix(col, SNOW, uSnow * .8 * smoothstep(.15, .9, vUv.y)); // snow caps the standing stalks and the stubble
        float lightv = .55 + .45 * max(sunDir.y, 0.);
        vec3 lit = col * (vec3(1.,.95,.86) * lightv * 2.3 + vec3(.55,.62,.72) * .38);
        outColor = vec4(finish(lit, vW), 1.);
      }`,
  });
  const crop = new THREE.Mesh(cardGeo, cropMat); crop.frustumCulled = false; crop.renderOrder = 0; scene.add(crop);
  const tileCache = new Map();   // "bid:strip:row:lod" → { key, data: Float32Array(8 per card), n }
  const hsh = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };
  function buildTile(w, b, f, i, row, lod, g) {
    // strip i (its own local-x span), rows 40 m along local y; cards on a jittered grid, only where the crop stands
    // (or stubble). Generated in the field's own frame, set down in the world by b.rot.
    const S = f.pr?.length || stripsOf(b), sw = b.w / S, x0 = -b.w / 2 + i * sw, y0 = -b.h / 2 + row * 40, y1 = Math.min(b.h / 2, y0 + 40);
    const rc = Math.cos(b.rot || 0), rs = Math.sin(b.rot || 0);
    const sp = [0.72, 1.25, 2.1][lod], wid = [1.0, 1.55, 2.4][lod];
    const out = []; const p = f.pr ? f.pr[i] : 1;
    const H = (HH[f.crop] || 1) * (0.06 + 0.94 * Math.min(1, g * 1.25)), ci = CROP_I[f.crop] ?? 0;
    const standing = f.state === "ripe" || (f.state === "growing" && !f.op && g > 0.04);
    const stubbly = f.state === "ripe" || (f.state === "stubble" && (w.econ.doy - (f.stubAt ?? 0)) < 60);
    const fy = frontY(b, i, p);
    let k = 0;
    for (let y = y0 + sp * 0.5; y < y1; y += sp) for (let x = x0 + sp * 0.5; x < x0 + sw; x += sp, k++) {
      const r1 = hsh(b.id * 131 + i * 17 + row, k), r2 = hsh(k + 7, b.id + lod * 1000 + i), px = x + (r1 - 0.5) * sp * 0.9, py = y + (r2 - 0.5) * sp * 0.9;
      if (Math.abs(px) > b.w / 2 - 1.5 || Math.abs(py) > b.h / 2 - 1.5) continue;
      const cut = f.state === "stubble" || (f.state === "ripe" && (p >= 1 || py < fy));
      const wx = b.x + px * rc - py * rs, wy = b.y + px * rs + py * rc;
      if (cut) { if (!stubbly || r1 > 0.55) continue; out.push(wx, map.h(wx, wy) - 0.02, -wy, r2 * 6.283, 0.26 + r1 * 0.1, wid * 1.1, 1, 10 + ci); continue; }
      if (!standing) continue;
      if (g < 0.3 && r2 < 0.35 * (1 - g / 0.3)) continue;          // young corn: patchy
      const hh = H * (0.82 + 0.3 * r1);
      out.push(wx, map.h(wx, wy) - 0.05, -wy, r2 * 6.283, hh, wid * (0.8 + 0.4 * r2) * (0.55 + 0.45 * Math.min(1, g * 2)), g, ci);
    }
    return new Float32Array(out);
  }

  // ================================================================ oxen / ploughs / carts following their men
  const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  const oxMat = propMat.clone();
  oxMat.onBeforeCompile = (sh) => {   // the gait: legs swing about the hip (y ≈ 0.95) by a per-instance phase
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nattribute float leg; attribute vec2 iGait;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        if (leg > .5) { float ph = iGait.x * 6.2832 + (leg == 1. || leg == 4. ? 0. : 3.1416); float a = sin(ph) * .42 * iGait.y;
          float hy = .95; float dy = transformed.y - hy; float c = cos(a), s = sin(a);
          float lx = transformed.x; float cx = (leg < 2.5 ? .55 : -.6);
          vec2 q = vec2(lx - cx, dy); q = vec2(c * q.x - s * q.y, s * q.x + c * q.y); transformed.x = cx + q.x; transformed.y = hy + q.y; }`);
  };
  const OXCAP = 400;
  const oxGeoA = oxGeo("#ffffff");
  const gaitA = new THREE.InstancedBufferAttribute(new Float32Array(OXCAP * 2), 2).setUsage(THREE.DynamicDrawUsage); oxGeoA.setAttribute("iGait", gaitA);
  const oxen = new THREE.InstancedMesh(oxGeoA, oxMat, OXCAP); oxen.count = 0; oxen.frustumCulled = false; scene.add(oxen);
  const coatC = OX_COATS.map((c) => new THREE.Color(c));
  oxMat.customProgramCacheKey = () => "hg-ox-gait";
  const yokes = new THREE.InstancedMesh(yokeGeo(), propMat, 200); yokes.count = 0; yokes.frustumCulled = false; scene.add(yokes);
  const ploughs = new THREE.InstancedMesh(ploughGeo(), propMat, 200); ploughs.count = 0; ploughs.frustumCulled = false; scene.add(ploughs);
  const wains = new THREE.InstancedMesh(wainGeo(), propMat, 200); wains.count = 0; wains.frustumCulled = false; scene.add(wains);
  const heaps = new THREE.InstancedMesh(merge([tint(new THREE.SphereGeometry(2.1, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2), STRAW, 0.25).scale(1.2, 0.34, 1.0), heapGeo().translate(1.3, 0.2, 0.4), heapGeo().rotateY(1.3).translate(-1.4, 0.2, -0.3)]), propMat, 40);
  heaps.count = 0; heaps.frustumCulled = false; scene.add(heaps);
  // particles: seed flung from the sowers' hands, chaff over the threshing floors
  const PK = 3000, pgeo = new THREE.BufferGeometry(), ppos = new Float32Array(PK * 3), pcol = new Float32Array(PK * 3), psz = new Float32Array(PK);
  pgeo.setAttribute("position", new THREE.BufferAttribute(ppos, 3).setUsage(THREE.DynamicDrawUsage));
  pgeo.setAttribute("color", new THREE.BufferAttribute(pcol, 3).setUsage(THREE.DynamicDrawUsage));
  pgeo.setAttribute("size", new THREE.BufferAttribute(psz, 1).setUsage(THREE.DynamicDrawUsage));
  const pmat = new THREE.ShaderMaterial({
    uniforms: { pxPerM: { value: 800 } }, transparent: true, depthWrite: false,
    vertexShader: `attribute vec3 color; attribute float size; uniform float pxPerM; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size * pxPerM / -mv.z, 1.2, 14.); }`,
    fragmentShader: `varying vec3 vC; void main(){ vec2 p = gl_PointCoord * 2. - 1.; float r = dot(p, p); if (r > 1.) discard; gl_FragColor = vec4(vC, 1. - r * .6); }`,
  });
  const parts = new THREE.Points(pgeo, pmat); parts.frustumCulled = false; parts.renderOrder = 7; scene.add(parts);
  // rooks: a real little bird (plump body, grey-white bill and face, folded wings with a blue-black sheen, feet at y 0,
  // facing +x). Two variants: standing/hopping with wings folded, and wings spread (the flick on a hop, the short flights)
  const RK = 300;
  function rookGeo(open) {
    const BLK = "#17171b", SHN = "#2a2d3d", g = [];
    const E = (rx, ry, rz, c, px, py, pz, seg = 8) => tint(new THREE.SphereGeometry(1, seg, 6).scale(rx, ry, rz), c, 0.08).translate(px, py, pz);
    for (const s of [-1, 1]) g.push(tint(new THREE.CylinderGeometry(0.012, 0.016, 0.11, 4), "#443a34").translate(0.03, 0.055, s * 0.05));   // legs: it STANDS on the ridge
    g.push(E(0.17, 0.115, 0.1, BLK, 0, 0.2, 0, 10));                                                                  // plump body, breast low
    g.push(E(0.11, 0.09, 0.085, SHN, 0.03, 0.235, 0));                                                                // the back's blue-black sheen
    g.push(tint(new THREE.CylinderGeometry(0.045, 0.06, 0.1, 6), BLK, 0.08).rotateZ(-0.7).translate(0.15, 0.28, 0));  // neck
    g.push(E(0.062, 0.058, 0.052, BLK, 0.2, 0.325, 0));                                                               // head
    g.push(E(0.03, 0.028, 0.03, "#9c968a", 0.245, 0.305, 0, 6));                                                      // the bare grey-white face at the bill's base
    g.push(tint(new THREE.ConeGeometry(0.02, 0.1, 5), "#b5af9f").rotateZ(-Math.PI / 2).translate(0.3, 0.305, 0));     // the long pale bill
    g.push(tint(new THREE.BoxGeometry(0.17, 0.016, 0.07), BLK, 0.06).rotateZ(0.3).translate(-0.2, 0.17, 0));          // tail, carried low
    if (open) for (const s of [-1, 1]) g.push(tint(new THREE.BoxGeometry(0.24, 0.012, 0.4), SHN, 0.06).rotateX(s * 0.28).rotateY(-s * 0.3).translate(0.0, 0.27, s * 0.26));  // wings spread
    else for (const s of [-1, 1]) g.push(tint(new THREE.BoxGeometry(0.28, 0.02, 0.055), SHN, 0.06).rotateZ(0.22).rotateX(s * 0.55).translate(-0.04, 0.26, s * 0.08));        // wings folded along the flanks
    return merge(g);
  }
  const rookMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 });   // the sheen
  const rooks = new THREE.InstancedMesh(rookGeo(false), rookMat, RK); rooks.count = 0; rooks.frustumCulled = false; scene.add(rooks);
  const rooksF = new THREE.InstancedMesh(rookGeo(true), rookMat, RK); rooksF.count = 0; rooksF.frustumCulled = false; scene.add(rooksF);

  const d = new THREE.Object3D(), B = { x: 0, y: 0, yaw: 0, fade: 0 };
  const target = new THREE.Vector3();
  function lookTarget(cam) {   // where the camera looks on the ground (a few steps along its ray)
    cam.getWorldDirection(target); const o = cam.position; let t = 0;
    if (target.y > -0.02) return [o.x, -o.z, 400];
    for (let k = 0; k < 6; k++) { const x = o.x + target.x * t, y = -(o.z + target.z * t), h = map.inBounds?.(x, y) === false ? 0 : map.h(Math.max(map.x0 ?? 0, Math.min(map.x1 ?? map.size, x)), Math.max(map.y0 ?? 0, Math.min(map.y1 ?? map.size, y))); t = (o.y - h) / -target.y; }
    return [o.x + target.x * t, -(o.z + target.z * t), t];
  }
  function place(mesh, n, x, y, yaw, dy = 0, s = 1) { d.position.set(x, map.h(x, y) + dy, -y); d.rotation.set(0, yaw, 0); d.scale.setScalar(s); d.updateMatrix(); mesh.setMatrixAt(n, d.matrix); }
  const angLerp = (a, b, t) => { let d0 = b - a; d0 = Math.atan2(Math.sin(d0), Math.cos(d0)); return a + d0 * t; };

  // ---- THE PLOUGH TEAM, walked as it walks: the OXEN LEAD, the plough is towed behind their yoke on its beam (trailer
  // kinematics, render/labor.js towFrom), the ploughman follows at the stilts (where the sim has him). In a field being
  // ploughed the team's way is known from the field alone (sim/jobs/fields.js walkTask): up one edge of the land's turned
  // band, round on the headland, down the other edge — a loop. The oxen stand 5 m ahead of the man ALONG that loop, so at
  // the headland they swing round first and the plough and the man come round after them, then all go straight down the
  // next edge. (Nothing here needs the man's task: a realm client draws it the same from the field's state and positions.)
  const teams = new Map();   // man id → { ox: [x, y], oh, dir, t }
  const OX_AHEAD = 5.0;
  function loopOf(b, i, p, lxMan) {
    const st = stripOf(b, i), xw0 = bandX(b, i, p, -1), xe0 = bandX(b, i, p, 1), mid = st.xc;
    const onW = lxMan < mid, xw = onW ? Math.min(lxMan, mid - 0.5) : xw0, xe = onW ? xe0 : Math.max(lxMan, mid + 0.5);
    const ys = -b.h / 2 + 3, yn = b.h / 2 - 3, a = (xe - xw) / 2, mx = (xw + xe) / 2, bb = Math.max(4, a * 0.8);
    const pts = [[xw, ys], [xw, yn]];
    for (let k = 1; k < 12; k++) { const t = k / 12 * Math.PI; pts.push([mx - a * Math.cos(t), yn + bb * Math.sin(t)]); }
    pts.push([xe, yn], [xe, ys]);
    for (let k = 1; k < 12; k++) { const t = k / 12 * Math.PI; pts.push([mx + a * Math.cos(t), ys - bb * Math.sin(t)]); }
    const cum = [0]; for (let k = 1; k <= pts.length; k++) { const A = pts[k - 1], C = pts[k % pts.length]; cum.push(cum[k - 1] + Math.hypot(C[0] - A[0], C[1] - A[1])); }
    return { pts, cum, len: cum[pts.length] };
  }
  function loopAt(L, s) {   // → [x, y] at arc length s (wrapped)
    s = ((s % L.len) + L.len) % L.len;
    let k = 1; while (k < L.cum.length - 1 && L.cum[k] < s) k++;
    const A = L.pts[k - 1], C = L.pts[k % L.pts.length], t = (s - L.cum[k - 1]) / Math.max(1e-6, L.cum[k] - L.cum[k - 1]);
    return [A[0] + (C[0] - A[0]) * t, A[1] + (C[1] - A[1]) * t];
  }
  function loopProject(L, x, y) {   // → [arc length, distance] of the nearest point on the loop
    let best = Infinity, bs = 0;
    for (let k = 1; k <= L.pts.length; k++) {
      const A = L.pts[k - 1], C = L.pts[k % L.pts.length], dx = C[0] - A[0], dy = C[1] - A[1], l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - A[0]) * dx + (y - A[1]) * dy) / l2)), px = A[0] + dx * t, py = A[1] + dy * t, dd = Math.hypot(x - px, y - py);
      if (dd < best) { best = dd; bs = L.cum[k - 1] + t * Math.sqrt(l2); }
    }
    return [bs, best];
  }
  // (the way he is WALKING, from where he has been — not his figure's facing, which turns on the spot and, on a realm
  // client, lags; smoothed so a stride's sway does not swing the team)
  const walk = new Map();   // man id → { x, y, vx, vy }
  function walkDir(i, x, y, hd, dt) {
    let m = walk.get(i); if (!m) { m = { x, y, vx: Math.cos(hd), vy: Math.sin(hd), seen: 0 }; walk.set(i, m); }
    const dx = x - m.x, dy = y - m.y, d = Math.hypot(dx, dy); m.x = x; m.y = y; m.seen = 1;
    if (d > 0.02 && d < 8) { const k = 1 - Math.exp(-dt * 3), vx = m.vx + (dx / d - m.vx) * k, vy = m.vy + (dy / d - m.vy) * k, l = Math.hypot(vx, vy) || 1; m.vx = vx / l; m.vy = vy / l; }
    return Math.atan2(m.vy, m.vx);
  }
  function ploughTeam(w, i, x, y, hd0, moving, dt) {
    let T = teams.get(i);
    const hd = walkDir(i, x, y, hd0, dt);
    // the field he is ploughing, and the loop of his land
    let want = null;
    for (const b of w.buildings) {
      const f = b.field; if (!f || b.ruin || f.op !== "plough" || !f.pr) continue;
      const [lx, ly] = fieldLocal(b, x, y); if (Math.abs(lx) > b.w / 2 + 2 || Math.abs(ly) > b.h / 2 + 8) continue;
      const S = f.pr.length, si = Math.max(0, Math.min(S - 1, Math.floor((lx + b.w / 2) / (b.w / S))));
      const L = loopOf(b, si, f.pr[si], lx), [s0, dd] = loopProject(L, lx, ly);
      if (dd > 3.5) break;
      // which way round: the way he is walking (kept until he plainly walks the other way)
      const hl = hd - (b.rot || 0), [ax, ay] = loopAt(L, s0 + 0.6), [bx, by] = loopAt(L, s0 - 0.6), tx = ax - bx, ty = ay - by;
      const dot = (Math.cos(hl) * tx + Math.sin(hl) * ty) / Math.max(1e-6, Math.hypot(tx, ty));
      const dir = T && T.b === b.id ? (dot < -0.35 ? -1 : dot > 0.35 ? 1 : T.dir) : (dot < 0 ? -1 : 1);
      const [ox, oy] = loopAt(L, s0 + dir * OX_AHEAD), [fx1, fy1] = loopAt(L, s0 + dir * (OX_AHEAD + 0.9)), [fx0, fy0] = loopAt(L, s0 + dir * (OX_AHEAD - 0.9));
      const [wx, wy] = fieldWorld(b, ox, oy), oh = Math.atan2(fy1 - fy0, fx1 - fx0) + (b.rot || 0);
      // where the ground ahead of him is still unturned (the ground shader keeps the newest furrow for behind him)
      const [pa, pb] = fieldLocal(b, x, y), sy = Math.sin(hl) >= 0 ? 1 : -1;
      want = { x: wx, y: wy, h: oh, dir, b: b.id, pl: [pa, pb, Math.abs(Math.sin(hl)) > 0.7 ? sy : 0], bref: b };
      break;
    }
    if (!want) { // off the land (on his way to it, or home): the oxen walk ahead of him the way he is WALKING (walkDir), and
      // they are led, never swung: they keep their place in front and come round only as he walks a new way
      want = { x: x + Math.cos(hd) * OX_AHEAD, y: y + Math.sin(hd) * OX_AHEAD, h: hd, dir: T?.dir || 1, b: null };
    }
    if (!T || Math.hypot(T.ox[0] - want.x, T.ox[1] - want.y) > 9) { T = { ox: [want.x, want.y], oh: want.h, dir: want.dir, b: want.b }; teams.set(i, T); }
    else { const k = 1 - Math.exp(-dt * 7); T.ox[0] += (want.x - T.ox[0]) * k; T.ox[1] += (want.y - T.ox[1]) * k; T.oh = angLerp(T.oh, want.h, 1 - Math.exp(-dt * 5)); T.dir = want.dir; T.b = want.b; }
    T.t = 0; T.pl = want.pl; T.bref = want.bref;
    return T;
  }
  // ---- ROOKS: their own birds, not the plough's. A little flock to each team: they settle in the fresh furrows some
  // metres behind the plough, peck and hop there, and when the team has drawn away (or a man or an ox comes close) they
  // get up and flutter on to settle again behind it. They go when the ploughing stops.
  const flocks = new Map();   // man id → { birds: [{ x, y, yaw, st, t0, from, to, dur, seed }], n }
  // a spot on the turned ground behind the plough: down the land from it, inside the band it has turned (near its newest
  // furrows, where the worms are), never out on the grass or past the headland
  function rookSpot(px, py, ph, k, n, b) {
    const back = 5 + ((k * 7 + n * 3) % 9) * 1.0 + hsh(k, n) * 1.2, side = hsh(n, k + 9);
    if (b?.field?.pr) {
      const f = b.field, [lx, ly] = fieldLocal(b, px, py), S = f.pr.length, i = Math.max(0, Math.min(S - 1, Math.floor((lx + b.w / 2) / (b.w / S)))), st = stripOf(b, i);
      const hw = Math.max(0.8, f.pr[i] * st.sw / 2), s = lx >= st.xc ? 1 : -1, hl = ph - (b.rot || 0), dy = Math.abs(Math.sin(hl)) > 0.5 ? Math.sign(Math.sin(hl)) : (ly > 0 ? 1 : -1);
      const rx = st.xc + s * hw * (0.45 + 0.5 * side), ry = Math.max(-b.h / 2 + 2, Math.min(b.h / 2 - 2, ly - dy * back));
      return fieldWorld(b, rx, ry);
    }
    return [px - Math.cos(ph) * back - Math.sin(ph) * (side - 0.5) * 2.6, py - Math.sin(ph) * back + Math.cos(ph) * (side - 0.5) * 2.6];
  }
  function tendFlock(i, px, py, ph, near, now, dt, b) {
    let F = flocks.get(i);
    if (!F) { F = { birds: [], n: 0, gone: 0 }; flocks.set(i, F); for (let k = 0; k < 6; k++) { const [sx, sy] = rookSpot(px, py, ph, k, F.n++, b); F.birds.push({ x: sx, y: sy, yaw: ph + Math.PI + (hsh(k, 3) - 0.5) * 2, st: "ground", t0: now, seed: k * 31 + i }); } }
    F.seen = now;
    for (const r of F.birds) {
      if (r.st === "fly") { if (now - r.t0 >= r.dur) { r.st = "ground"; r.x = r.to[0]; r.y = r.to[1]; r.t0 = now; } continue; }
      const far = Math.hypot(r.x - px, r.y - py) > 22, crowd = near.some(([qx, qy]) => Math.hypot(r.x - qx, r.y - qy) < 2.6);
      if ((far || crowd) && now - r.t0 > 0.4) {
        const to = rookSpot(px, py, ph, r.seed, F.n++, b), dist = Math.hypot(to[0] - r.x, to[1] - r.y);
        Object.assign(r, { st: "fly", from: [r.x, r.y], to, t0: now, dur: Math.max(0.7, dist / 7), yaw: Math.atan2(to[1] - r.y, to[0] - r.x) });
      } else if (Math.sin(now * 1.7 + r.seed) > 0.97) { r.x += Math.cos(r.yaw) * dt * 1.2; r.y += Math.sin(r.yaw) * dt * 1.2; }   // a hop on
      else if (Math.sin(now * 0.43 + r.seed * 1.7) > 0.995) r.yaw += 1.2 * dt * 20 * (hsh(r.seed, Math.floor(now)) - 0.5);    // turns about
    }
    return F;
  }
  let nr = 0, nrf = 0;
  function drawFlock(F, now) {
    for (const r of F.birds) {
      if (nr >= RK || nrf >= RK) return;
      if (r.st === "fly") {
        const t = Math.min(1, (now - r.t0) / r.dur), x = r.from[0] + (r.to[0] - r.from[0]) * t, y = r.from[1] + (r.to[1] - r.from[1]) * t, z = Math.sin(t * Math.PI) * Math.min(2.2, 0.5 + r.dur * 0.6);
        d.position.set(x, map.h(x, y) + 0.12 + z, -y); d.rotation.set(0, r.yaw, (0.5 - t) * 0.5); d.scale.setScalar(1.3); d.updateMatrix(); rooksF.setMatrixAt(nrf++, d.matrix);
        continue;
      }
      const hop = Math.max(0, Math.sin(now * 4.2 + r.seed * 1.7)) * 0.16 * (r.seed % 2);
      const peck = hop <= 0.02 && Math.sin(now * 2.6 + r.seed) > 0.4 ? -0.55 : 0;   // head down in the furrow
      d.position.set(r.x, map.h(r.x, r.y) + 0.14 + hop, -r.y); d.rotation.set(0, r.yaw, peck); d.scale.setScalar(1.3); d.updateMatrix();
      if (hop > 0.1) rooksF.setMatrixAt(nrf++, d.matrix); else rooks.setMatrixAt(nr++, d.matrix);
    }
  }

  // ---- the map's trees and bushes inside a field are grubbed up (the sim takes their trunks away: sim/jobs/fields.js
  // clearGround); their standing instances are hidden here by the same rule (props.clearArea: once per field and spot —
  // a field re-homed by tools/realign-fields.mjs clears its new ground — and it holds for props that load later)
  const cleared = new Set();
  function clearProps(w) {
    const props = globalThis.HG?.props; if (!props?.clearArea) return;
    for (const b of w.buildings) {
      if (!b.field || !(b.w > 0) || b.field.made || b.field.state === "clearing" || !b.field.clr) continue;   // (a field the men made: its trees came down one by one — lane B's items)
      const key = `${b.id}:${Math.round(b.x)}:${Math.round(b.y)}`; if (cleared.has(key)) continue; cleared.add(key);
      const R = { x: b.x, y: b.y, w: b.w, h: b.h, rot: b.rot || 0 };   // (fixed: a field keeps its ground)
      props.clearArea((x, y) => insideField(R, x, y));
    }
  }
  let clrT = -1, lastNow = 0;

  function update(w, cam, { visible = null, visibleMan = null, pxPerM = 800, now = 0 } = {}) {
    const dt = Math.max(0, Math.min(0.25, now - lastNow)); lastNow = now;
    if (now - clrT > 1) { clrT = now; clearProps(w); }
    if (!TU) findTerrain();
    if (TU) { common.fogTex.value = TU.fogTex.value; common.fogOn.value = TU.fogOn.value; common.uSnow.value = TU.snow?.value || 0; } // (snow: read from the terrain, never set apart from it)
    common.camPos.value.copy(cam.position); common.time.value = now;
    if (w.wind) common.uWind.value.set(w.wind.x, -w.wind.y); else common.uWind.value.set(1.1, 0.8); // sim (x,y) → three (x,z)
    const doy = w.econ?.doy || 0, L = lod();
    const [tx, ty, camD] = lookTarget(cam), cx = cam.position.x, cy = -cam.position.z, ch = cam.position.y;

    // ---- the plough teams first (where each plough is tells the ground where its newest furrow ends)
    let no = 0, ny = 0, np = 0, nw = 0, nh = 0, npk = 0; nr = 0; nrf = 0;
    const Lb = w.labor, S = w.S, floors = new Map(), ploughAt = new Map(), live = new Set();
    if (Lb) for (const [i, M] of Lb.men) {
      if (!S.alive[i] || (visibleMan && !visibleMan(i))) continue;
      const c = M.carry, flail = M.pose === "work_flail";
      if (!flail && !(c && (c.kind === "plough" || c.kind === "wain" || c.kind === "seedlip"))) continue;
      const fig = figures && figures.bodyOf(i, B);
      const x = fig ? B.x : S.x[i], y = fig ? B.y : S.y[i], hd = fig ? B.yaw - Math.PI / 2 : S.facing[i];
      if (Math.hypot(x - cx, y - cy) > 1500) continue;
      const moving = S.state[i] === S_MOVE ? 1 : 0;
      const phase = ((w.time || 0) * 0.9 + i * 0.37) % 1;
      if (flail) { const k = M.team * 100000 + Math.round(S.x[i] / 30) * 1000 + Math.round(S.y[i] / 30); const F = floors.get(k) || { x: 0, y: 0, n: 0 }; F.x += S.x[i]; F.y += S.y[i]; F.n++; floors.set(k, F); continue; }
      const fx = Math.cos(hd), fy = Math.sin(hd);
      if (c.kind === "plough" && no + 2 <= OXCAP) {
        const T = ploughTeam(w, i, x, y, hd, moving, dt); live.add(i);
        const ox = T.ox[0], oy = T.ox[1], oh = T.oh, ux = Math.cos(oh), uy = Math.sin(oh);
        for (const s of [-1, 1]) { const qx = ox - uy * s * 0.62, qy = oy + ux * s * 0.62; place(oxen, no, qx, qy, oh); oxen.setColorAt(no, coatC[(i + (s > 0 ? 1 : 0)) % 4]); gaitA.setXY(no, phase + (s > 0 ? 0.25 : 0), moving); no++; }
        place(yokes, ny++, ox, oy, oh);
        // the plough on its beam, towed from the hitch behind the pair; the man at its stilts
        const [px, py, pyaw] = towFrom("pl" + i, ox - ux * 1.65, oy - uy * 1.65, 1.9, oh);
        T.pp = [px, py, pyaw];
        place(ploughs, np++, px, py, pyaw);
        if (T.bref && T.pl) { const a = ploughAt.get(T.bref.id) || []; if (a.length < 4) { const [plx, ply] = fieldLocal(T.bref, px, py); a.push([plx, ply, T.pl[2]]); } ploughAt.set(T.bref.id, a); }
        // (the rooks come only to a team at work in its field, not to one on the road there)
        if (T.bref) { const near = [[x, y], [ox, oy], [px, py]]; drawFlock(tendFlock(i, px, py, pyaw, near, now, dt, T.bref), now); live.add("r" + i); }
      } else if (c.kind === "wain" && no < OXCAP) {
        // he leads the ox by its head; the cart trails in the shafts behind it (towFrom: trailer kinematics, no side-sweep)
        const lx = x - fy * 1.0, ly = y + fx * 1.0;
        place(oxen, no, lx + fx * 0.2, ly + fy * 0.2, hd); oxen.setColorAt(no, coatC[(i + 2) % 4]); gaitA.setXY(no, phase, moving); no++;
        const [wx, wy, wyaw] = towFrom("w" + i, lx - fx * 0.9, ly - fy * 0.9, 2.5, hd);
        place(wains, nw++, wx, wy, wyaw);
      } else if (c.kind === "seedlip" && moving && npk < PK - 40) {
        // a handful flung at every other step: an arc of grains across his front, falling
        const t = (now * 1.1 + i * 0.31) % 1, h0 = map.h(x, y);
        for (let q = 0; q < 16; q++) {
          const a = hd - 1.2 + (q / 15) * 2.4 + Math.sin(q * 9.1) * 0.08, r = 0.6 + t * 3.2 + (q % 3) * 0.2, z = Math.max(0, 1.3 + t * 1.2 - 5.5 * t * t);
          const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
          ppos[npk * 3] = px; ppos[npk * 3 + 1] = h0 + z; ppos[npk * 3 + 2] = -py; pcol[npk * 3] = 0.85; pcol[npk * 3 + 1] = 0.75; pcol[npk * 3 + 2] = 0.45; psz[npk] = 0.07; npk++;
        }
      }
    }
    for (const [i, T] of teams) if (!live.has(i)) { teams.delete(i); walk.delete(i); }
    // a flock whose team has gone home lifts and leaves (drawn flying off for a moment, then dropped)
    for (const [i, F] of flocks) if (!live.has("r" + i)) { if (now - F.seen > 2.5) flocks.delete(i); else { for (const r of F.birds) if (r.st !== "fly") Object.assign(r, { st: "fly", from: [r.x, r.y], to: [r.x + Math.cos(r.seed) * 30, r.y + Math.sin(r.seed) * 30], t0: now, dur: 2.5 }); drawFlock(F, now); } }

    // ---- the grounds
    const seen = new Set(), stk = new Map();
    for (const it of w.labor?.items || []) if (it.kind === "stook" && typeof it.st === "string") { const [, bid, i, half] = it.st.split(":"); let m = stk.get(+bid); if (!m) stk.set(+bid, (m = [])); m.push([+i * 2 + +half, it.n]); }
    reliefBudget = 3;   // (new 3D tiles built a frame: a field walked into fills in over a few frames)
    for (const b of w.buildings) {
      if (!b.field || b.ruin || !(b.w > 0)) continue;
      if (visible && !visible(b.x, b.y, b.team)) continue;
      seen.add(b.id);
      let F = fieldsR.get(b.id); if (!F) { F = fieldMesh(b); fieldsR.set(b.id, F); }
      const g = syncField(w, b, F, stk, ploughAt.get(b.id)); F.mesh.visible = true;
      syncRelief(b, F, cx, cy, ch, g);
      // the standing corn's layers, fewer as the field lies further off (none on Low: the drape and the near cards)
      const f = b.field, dist = Math.hypot(b.x - cx, b.y - cy, map.h(b.x, b.y) - ch) - Math.hypot(b.w, b.h) / 2;
      const K = dist > L.shellFar ? 0 : L.shells[dist < L.shellFar * 0.45 ? 0 : dist < L.shellFar * 0.75 ? 1 : 2];
      const standing = (f.state === "growing" && !f.op && g > 0.04) || f.state === "ripe";
      syncShell(b, F, "shell", standing && K ? Math.max(2, Math.round(K * Math.min(1, 0.35 + g))) : 0, g);
      const stubbly = (f.state === "ripe" && f.op === "reap") || (f.state === "stubble" && doy - (f.stubAt ?? doy) < 75);
      syncShell(b, F, "stub", stubbly && K ? 2 : 0, g);
      F.U.uShell.value = standing && K ? 1 : 0;
    }
    for (const [id, F] of fieldsR) if (!seen.has(id)) { dropField(F); fieldsR.delete(id); }

    // ---- the crop near the camera (tiles cached per field state; rebuilt when the camera moves on or the field changes)
    let n = 0;
    if (camD < 900) {
      const R = Math.min(260, 60 + camD * 0.55);
      for (const b of w.buildings) {
        if (!b.field || !seen.has(b.id)) continue; const f = b.field;
        if (Math.hypot(tx - b.x, ty - b.y) > Math.hypot(b.w, b.h) / 2 + R) continue;
        const S = f.pr?.length || stripsOf(b), g = f.state === "ripe" ? 1 : growth(f, doy);
        if (!(f.state === "ripe" || f.state === "stubble" || (f.state === "growing" && !f.op && g > 0.04))) continue;
        const gq = Math.round(g * 60), brc = Math.cos(b.rot || 0), brs = Math.sin(b.rot || 0);
        for (let i = 0; i < S; i++) {
          const sw = b.w / S, lxc = -b.w / 2 + (i + 0.5) * sw;
          for (let row = 0; row < Math.ceil(b.h / 40); row++) {
            const lyc = -b.h / 2 + row * 40 + 20;
            const xc = b.x + lxc * brc - lyc * brs, yc = b.y + lxc * brs + lyc * brc;
            const dtt = Math.hypot(xc - tx, yc - ty); if (dtt > R + 30) continue;
            const dc = Math.hypot(xc - cx, yc - cy, map.h(xc, yc) - ch);
            const lv = dc < 110 ? 0 : dc < 230 ? 1 : dc < 420 ? 2 : 3; if (lv > (L.shells[0] ? 1 : 2)) continue;   // (beyond, the layered corn carries it)
            const key = `${f.state}|${f.op}|${gq}|${f.pr ? Math.round(f.pr[i] * 400) : 0}|${f.crop}|${f.state === "stubble" ? Math.floor((doy - (f.stubAt ?? 0)) / 60) : 0}`;
            const ck = `${b.id}:${i}:${row}:${lv}`; let T = tileCache.get(ck);
            if (!T || T.key !== key) { T = { key, data: buildTile(w, b, f, i, row, lv, g) }; tileCache.set(ck, T); }
            const m = Math.min(T.data.length / 8, CAP - n); if (m <= 0) continue;
            for (let k = 0; k < m; k++) { const s = k * 8, o = (n + k) * 4; iP[o] = T.data[s]; iP[o + 1] = T.data[s + 1]; iP[o + 2] = T.data[s + 2]; iP[o + 3] = T.data[s + 3]; iQ[o] = T.data[s + 4]; iQ[o + 1] = T.data[s + 5]; iQ[o + 2] = T.data[s + 6]; iQ[o + 3] = T.data[s + 7]; }
            n += m;
          }
        }
      }
      if (tileCache.size > 4000) tileCache.clear();
    }
    cardGeo.instanceCount = n; aP.needsUpdate = true; aQ.needsUpdate = true; aP.addUpdateRange?.(0, n * 4); aQ.addUpdateRange?.(0, n * 4);

    // the threshing floors: a heap of sheaves and loose straw among the flailers; chaff in the air
    for (const F of floors.values()) {
      if (nh >= 40) break; const x = F.x / F.n, y = F.y / F.n;
      place(heaps, nh++, x, y, (x * 0.1) % 6.28, -0.05, 0.5 + 0.04 * Math.min(8, F.n));
      for (let q = 0; q < 30 && npk < PK; q++) {
        const t = (now * 0.35 + q * 0.137) % 1, a = q * 2.399, r = 0.5 + t * 2.5, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        ppos[npk * 3] = px; ppos[npk * 3 + 1] = map.h(px, py) + 0.3 + t * 1.8 + Math.sin(q) * 0.2; ppos[npk * 3 + 2] = -py;
        pcol[npk * 3] = 0.8; pcol[npk * 3 + 1] = 0.72; pcol[npk * 3 + 2] = 0.5; psz[npk] = 0.05 + 0.04 * (1 - t); npk++;
      }
    }
    oxen.count = no; ploughs.count = np; yokes.count = ny; wains.count = nw; heaps.count = nh; rooks.count = nr; rooksF.count = nrf;
    for (const m of [oxen, ploughs, yokes, wains, heaps, rooks, rooksF]) m.instanceMatrix.needsUpdate = true;
    if (oxen.instanceColor) oxen.instanceColor.needsUpdate = true; gaitA.needsUpdate = true;
    pmat.uniforms.pxPerM.value = pxPerM;
    pgeo.setDrawRange(0, npk); for (const k of ["position", "color", "size"]) pgeo.attributes[k].needsUpdate = true;
  }
  function stats() { let tiles = 0, shells = 0; for (const F of fieldsR.values()) { tiles += F.tiles.size; for (const k of ["shell", "stub"]) if (F[k]?.mesh.visible) shells += F[k].mesh.geometry.instanceCount; } return { fields: fieldsR.size, cards: cardGeo.instanceCount, oxen: oxen.count, cardTiles: tileCache.size, reliefTiles: tiles, shellLayers: shells, rooks: rooks.count + rooksF.count }; }
  // (for the shot harness: where the plough teams' oxen and ploughs stand — tools/fields-shots.mjs)
  const r2 = (v) => Math.round(v * 100) / 100;
  function teamsNow() { return [...teams.entries()].map(([i, T]) => ({ man: i, ox: T.ox.map(r2), oh: r2(T.oh), plough: T.pp ? T.pp.map(r2) : null, rooks: (flocks.get(i)?.birds || []).map((r) => [r2(r.x), r2(r.y), r.st]) })); }
  if (typeof window !== "undefined") window.HG_FIELDS = { stats, teamsNow };   // (debug handle for headless checks)
  return { update, stats, teamsNow };
}
