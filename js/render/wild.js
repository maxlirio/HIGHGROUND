// WILD GAME, drawn (lane C, docs/gathering-plan.md; the sim is js/sim/wild.js). Purely a render layer.
//
//   • BEASTS: red deer, roe and boar from assets/wild/game.json (assets/src/wild_game.py: rigid-part models, clips as a
//     3x4-matrix-per-part-per-frame table). One instanced mesh per species; the vertex shader picks each vertex's part
//     matrix for the two frames around the beast's phase and lerps them, cross-fading from the previous clip over
//     0.25 s. Clip from the sim's state (graze / alert / walk / run), gait speed-matched, the body pitched to the slope.
//     Stags and boars show their antlers / tusks (part 3), the young are drawn small.
//   • CARCASSES: the kill items (kinds deer/roe/boar, js/sim/labor.js) fall (the fall clip from item.t0, the arrow's
//     landing) and then lie as the carcass; a soldier carrying one wears it across his shoulders.
//   • AT A DISTANCE: every beast is a small brown mark (a herd reads as a speckle of dots at the Eagle view); a herd in
//     flight trails its marks. Beyond ~450 m only the marks.
//   • A soft blob of shade under each one, so they stand on the ground.
// w.wildSeen (the herds in sight this frame) is set for the order popup (js/ui/orders.js): no hunting what you can't see.
import * as THREE from "three";

const AMB = 450;           // m: ambient life and carcasses drawn inside this
const NEAR = 1100;         // m: meshes never beyond this (perf cap; at Oblique the far edge of the view)
const MARK_H = 300;        // m of camera height above the ground: above it (Eagle, Map) every beast is a MARK; below it
                           // (Oblique, Ground) beasts are MODELS, and a mark stands in only where the model would be
const MARK_PX = 2.2;       // smaller on screen than this many pixels (projected body height) — a speck, not a beast
const SIZE = { serpent: 2.6 };   // drawn scale (the lake serpent: ~18 m of coils — a legend, not an eel)
const BLEND = 0.25;        // s: clip cross-fade
const SHOULDER_TILT = 0.85; // rad: a carried carcass rolled forward on the shoulders (legs down in front)
const X_AX = new THREE.Vector3(1, 0, 0), M4 = new THREE.Matrix4();
const CLIP_OF_ST = ["graze", "alert", "walk", "run"];
const WALK_REF = { deer: 1.25, roe: 1.1, boar: 0.9, hare: 0.45, duck: 0.5, goose: 0.6, wolf: 1.2, bear: 0.9, fox: 0.9, strider: 1.6, drake: 0.5, hart: 1.25, serpent: 2.2 };
const RUN_REF = { deer: 9.5, roe: 8.5, boar: 6.5, hare: 10.5, duck: 13, goose: 14, wolf: 10, bear: 7.5, fox: 9, strider: 11.5, drake: 4.5, hart: 10.5, serpent: 5 };   // m/s the clips were made for
const MARK_COL = { deer: "#a0673e", roe: "#b27a4a", boar: "#3e342c", hare: "#8a6b46", duck: "#2e4e34", goose: "#8a8276", wolf: "#5e5a52", bear: "#4e3a26", fox: "#b0552e", strider: "#6e5a44", drake: "#5e5e44", hart: "#e8e2d4", serpent: "#36473c" };
const SP_OF_ITEM = { deer: "deer", roe: "roe", boar: "boar", hare: "hare", duck: "duck", goose: "goose", wolf: "wolf", bear: "bear", fox: "fox", strider: "strider", drake: "drake", hart: "hart" };
const SP_OF_YOUNG = { young_strider: "strider", young_drake: "drake" };   // live catches: led / slung (docs/mounts-wildlife-spec.md)
const FOWL = new Set(["duck", "goose"]);   // they sit the water and FLY when flushed (st 3): the renderer lifts them
const BLOB_SC = { boar: 1.5, roe: 1.4, hare: 0.5, duck: 0.45, goose: 0.6, fox: 0.9, wolf: 1.2, bear: 2.2, strider: 1.4, drake: 2.6, serpent: 0, heron: 0.6, pheasant: 0.5, squirrel: 0.3, frog: 0.15 };
const hash = (n) => { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };

function b64(s, T) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new T(u.buffer); }

function makeMaterial(sp) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.animTex = { value: sp.tex }; sh.uniforms.animParts = { value: sp.parts };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>
      attribute float aPart; attribute vec4 iA; attribute vec4 iB; attribute vec4 iMisc;
      uniform sampler2D animTex; uniform float animParts;
      mat4 animAt(float frame) { int f = int(frame), p = int(aPart) * 3;
        vec4 r0 = texelFetch(animTex, ivec2(p, f), 0), r1 = texelFetch(animTex, ivec2(p + 1, f), 0), r2 = texelFetch(animTex, ivec2(p + 2, f), 0);
        return mat4(r0.x, r1.x, r2.x, 0.0,  r0.y, r1.y, r2.y, 0.0,  r0.z, r1.z, r2.z, 0.0,  r0.w, r1.w, r2.w, 1.0); }
      mat4 animMat() {
        mat4 a = animAt(iA.x) * (1.0 - iA.z) + animAt(iA.y) * iA.z;
        if (iA.w < 0.999) { mat4 b = animAt(iB.x) * (1.0 - iB.z) + animAt(iB.y) * iB.z; a = a * iA.w + b * (1.0 - iA.w); }
        return a; }`)
      .replace("#include <beginnormal_vertex>", `mat4 AM = animMat(); vec3 objectNormal = normalize(mat3(AM) * normal);
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3( tangent.xyz );
        #endif`)
      .replace("#include <begin_vertex>", `vec3 transformed = (AM * vec4(position, 1.0)).xyz;
        if (aPart > 2.5 && aPart < 3.5 && iMisc.x < 0.5) transformed = (AM * vec4(0.0, 1.0, 0.0, 1.0)).xyz;   // (antlers / tusks: males only)`)
      .replace("#include <color_vertex>", "#include <color_vertex>\n  vColor.rgb *= iMisc.y;");
  };
  return mat;
}

export function makeWildRender(scene, map, { figures = null, base = "" } = {}) {
  const S = {};         // species → { geo, mesh, tex, clips, frames, parts }
  let ready = false;
  fetch(`${base}assets/wild/game.json`).then((r) => r.json()).then((J) => {
    for (const [name, D] of Object.entries(J)) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(b64(D.pos, Float32Array), 3));
      g.setAttribute("normal", new THREE.BufferAttribute(b64(D.nrm, Float32Array), 3));
      g.setAttribute("color", new THREE.BufferAttribute(b64(D.col, Float32Array), 3));
      g.setAttribute("aPart", new THREE.BufferAttribute(Float32Array.from(b64(D.part, Uint8Array)), 1));
      g.setIndex(new THREE.BufferAttribute(b64(D.idx, Uint16Array), 1));
      const mats = b64(D.mats, Float32Array), W = D.parts * 3, tex = new THREE.DataTexture(new Float32Array(W * D.frames * 4), W, D.frames, THREE.RGBAFormat, THREE.FloatType);
      tex.image.data.set(mats); tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
      const cap = 1024, iA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4), iB = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4), iM = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      for (const a of [iA, iB, iM]) a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute("iA", iA); g.setAttribute("iB", iB); g.setAttribute("iMisc", iM);
      const sp = { name, clips: D.clips, frames: D.frames, parts: D.parts, tex, iA, iB, iM, cap, lie: D.lie, bodyH: D.bodyH ?? 0.9 };
      const mesh = new THREE.InstancedMesh(g, makeMaterial(sp), cap); mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
      scene.add(mesh); sp.mesh = mesh; S[name] = sp;
    }
    ready = true;
  }).catch((e) => console.warn("wild game models:", e));

  // ---- blob shade under each beast
  const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const blobMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv; void main(){ float r = length((vUv - 0.5) * 2.0); float a = smoothstep(1.0, 0.25, r) * 0.38; if (a < 0.01) discard; gl_FragColor = vec4(0.04, 0.035, 0.02, a); }` });
  const blobs = new THREE.InstancedMesh(blobGeo, blobMat, 2048); blobs.count = 0; blobs.frustumCulled = false; blobs.renderOrder = 2; scene.add(blobs);

  // ---- ripples round a surfaced serpent: rings spreading from the head and from each hump as it breaks the water
  const rgGeo = new THREE.RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2), RG = 48;
  const rgPh = new THREE.InstancedBufferAttribute(new Float32Array(RG), 1).setUsage(THREE.DynamicDrawUsage); rgGeo.setAttribute("iPh", rgPh);
  const rgMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3,
    vertexShader: `attribute float iPh; varying float vA; void main(){ vA = (1.0 - iPh) * smoothstep(0.0, 0.12, iPh); gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.78, 0.84, 0.88, vA * 0.32); }` });
  rgMat.depthTest = false;   // (the terrain's LOD mesh wanders a metre round map.h out on the lake: the rings lie on top)
  const rings = new THREE.InstancedMesh(rgGeo, rgMat, RG); rings.count = 0; rings.frustumCulled = false; rings.renderOrder = 3; scene.add(rings);
  const serp = [];
  function ripples(list, now) {
    let n = 0;
    for (let i = 0; i < list.length; i += 4) {
      const [x, y, f, sc] = list.slice(i, i + 4), c = Math.cos(f), s2 = Math.sin(f);
      // the head (a little ahead of the model origin) and four humps strung out behind along its heading
      for (let j = 0; j < 6 && n < RG; j++) {
        const back = j === 0 ? -1.2 : j * 1.5, px2 = x - c * back * sc, py2 = y - s2 * back * sc;
        for (let k = 0; k < 2 && n < RG; k++) {
          const ph = ((now * 0.32 + j * 0.37 + k * 0.5) % 1 + 1) % 1, r = (0.8 + ph * (j === 0 ? 4 : 2.6)) * sc;
          d.position.set(px2, map.h(px2, py2) + 0.05, -py2); d.quaternion.identity(); d.scale.set(r, 1, r * (j === 0 ? 1 : 0.7)); d.updateMatrix();
          rings.setMatrixAt(n, d.matrix); rgPh.array[n] = ph; n++;
        }
      }
    }
    rings.count = n; rings.instanceMatrix.needsUpdate = true; rgPh.needsUpdate = true;
  }

  // ---- marks at a distance (points, a small oval with a dark rim)
  const MK = 4096, mgeo = new THREE.BufferGeometry(), mpos = new Float32Array(MK * 3), mcol = new Float32Array(MK * 3);
  mgeo.setAttribute("position", new THREE.BufferAttribute(mpos, 3).setUsage(THREE.DynamicDrawUsage));
  mgeo.setAttribute("color", new THREE.BufferAttribute(mcol, 3).setUsage(THREE.DynamicDrawUsage));
  const mmat = new THREE.ShaderMaterial({ uniforms: { pxPerM: { value: 1 }, dpr: { value: 1 } },
    vertexShader: `attribute vec3 color; uniform float pxPerM; uniform float dpr; varying vec3 vC;
      void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(2.6 * pxPerM / -mv.z, 7.0, 12.0) * dpr; }`,
    fragmentShader: `varying vec3 vC; void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float r = length(p / vec2(1.0, 0.62)); if (r > 1.0) discard;
      vec3 c = r > 0.66 ? vec3(0.93, 0.86, 0.7) : vC; gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0); }` });   // (a pale rim: reads on grass and on the dark of the woods)
  const marks = new THREE.Points(mgeo, mmat); marks.frustumCulled = false; marks.renderOrder = 5; scene.add(marks);

  // ---- AMBIENT LIFE (render-only, never sim state; a player should stumble on it and grin, not plan around it):
  // red kites circling high over the holds and buzzards lower over the woods, herons stalking the shallows, pheasants
  // bursting from the wood edge, owls out on the edge perches at dusk, songbirds flitting tree to tree near the camera,
  // red squirrels about the trees, frogs on the wet margins, butterflies and bees over the summer grass, and faint
  // marsh-lights over the bog shallows. Placement is deterministic from the map; the little state machines live in this client only.
  const MOTES = 96, mtGeo = new THREE.BufferGeometry(), mtPos = new Float32Array(MOTES * 3), mtCol = new Float32Array(MOTES * 3);
  mtGeo.setAttribute("position", new THREE.BufferAttribute(mtPos, 3).setUsage(THREE.DynamicDrawUsage));
  mtGeo.setAttribute("color", new THREE.BufferAttribute(mtCol, 3).setUsage(THREE.DynamicDrawUsage));
  const mtMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { pxPerM: { value: 1 }, dpr: { value: 1 } },
    vertexShader: `attribute vec3 color; uniform float pxPerM; uniform float dpr; varying vec3 vC;
      void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(1.2 * pxPerM / -mv.z, 2.0, 5.0) * dpr; }`,
    fragmentShader: `varying vec3 vC; void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float r = length(p); if (r > 1.0) discard; gl_FragColor = vec4(vC, (1.0 - r) * 0.85); }` });
  const motes = new THREE.Points(mtGeo, mtMat); motes.frustumCulled = false; motes.renderOrder = 6; scene.add(motes);
  // the owls' stumps: a weathered post of old oak, 1 m tall (scaled to the perch height), a broken top
  const stGeo = new THREE.CylinderGeometry(0.13, 0.2, 1, 7, 1).translate(0, 0.5, 0), stp = stGeo.attributes.position;
  for (let i = 0; i < stp.count; i++) if (stp.getY(i) > 0.9) stp.setY(i, 1 - 0.12 * (0.5 + 0.5 * Math.sin(i * 2.3)));
  stGeo.computeVertexNormals();
  const stumps = new THREE.InstancedMesh(stGeo, new THREE.MeshStandardMaterial({ color: "#5a4c3c", roughness: 0.95 }), 8); stumps.count = 0; stumps.frustumCulled = false; stumps.castShadow = true; stumps.receiveShadow = true; scene.add(stumps);
  let amb = null, nmt = 0;
  function makeAmb(w) {
    const size = map.size || 4000, banks = [], edges = [], shallows = [];
    for (let k = 0; k < 6000 && (banks.length < 40 || edges.length < 60 || shallows.length < 24); k++) {
      const x = (map.x0 || 0) + hash(k * 2 + 1) * size, y = (map.y0 || 0) + hash(k * 2 + 2) * size, wd = map.water(x, y);
      if (wd > 0.25 && banks.length < 40) { for (let j = 0; j < 8; j++) { const a = j * 0.785, bx = x + Math.cos(a) * 14, by = y + Math.sin(a) * 14; if (map.inBounds(bx, by) && map.water(bx, by) < 0.03) { banks.push([bx, by]); break; } } }
      else if (wd > 0.04 && wd < 0.22 && shallows.length < 24) shallows.push([x, y]);
      else if (!wd && map.canopy(x, y) < 1 && edges.length < 60 && (map.canopy(x + 16, y) > 2 || map.canopy(x - 16, y) > 2 || map.canopy(x, y + 16) > 2 || map.canopy(x, y - 16) > 2)) edges.push([x, y]);
    }
    const spaced = (list, d, n) => { const out = []; for (const p of list) { if (out.length >= n) break; if (!out.some((q2) => Math.hypot(q2[0] - p[0], q2[1] - p[1]) < d)) out.push(p); } return out; };
    const towns = (w.teams || []).map((tm) => tm && tm.town).filter(Boolean);
    return {
      banks: spaced(banks, 180, 12),
      herons: spaced(banks, 420, 3).map(([x, y], i) => ({ x, y, fx: x, fy: y, tx: x, ty: y, t0: -9, dur: 1, fly: 0, ck: hash(i + 41) * 0.5, ph: hash(i + 40) })),
      pheas: spaced(edges, 480, 4).map(([x, y], i) => ({ hx: x, hy: y, x, y, fx: x, fy: y, tx: x, ty: y, t0: -9, dur: 1, fly: 0, cool: 0, ph: hash(i + 60) })),
      wisps: spaced(shallows, 420, 3),
      kites: (towns.length ? towns : [{ x: size / 2, y: size / 2 }]).slice(0, 3).map((tn, i) => ({ x: tn.x, y: tn.y, r: 55 + 35 * hash(i + 7), h: 32 + 18 * hash(i + 9), w: (hash(i + 13) > 0.5 ? 1 : -1) * (0.045 + 0.03 * hash(i + 15)), a0: hash(i + 17) * 6.28 })),
      // buzzards: the kite's broad-winged cousin (the same model, drawn browner), lower circles over the big woods
      buzz: spaced(edges, 700, 4).map(([x, y], i) => ({ x, y, r: 30 + 25 * hash(i + 71), h: 22 + 12 * hash(i + 73), w: (hash(i + 75) > 0.5 ? 1 : -1) * (0.07 + 0.03 * hash(i + 77)), a0: hash(i + 79) * 6.28 })),
      // owls: a perch at the wood's edge each, the owl out on it in the dusk hour of the day (and in a fog)
      owls: spaced(edges, 360, 5).map(([x, y], i) => ({ x, y, h: 1.25 + 0.3 * hash(i + 93), ph: hash(i + 91), out: 0, t0: -9 })),   // (each on an old stump at the wood's edge)
      birds: [], squir: [], frogs: [], townXY: towns.length ? [towns[0].x, towns[0].y] : [size / 2, size / 2],
    };
  }
  const arc = (p, now) => {   // a flight from (fx,fy) to (tx,ty): position + a shallow climb
    const k = Math.min(1, (now - p.t0) / p.dur), s = k * k * (3 - 2 * k);
    return [p.fx + (p.tx - p.fx) * s, p.fy + (p.ty - p.fy) * s, Math.sin(Math.PI * k) * 5 + 0.4, Math.atan2(p.ty - p.fy, p.tx - p.fx), k];
  };
  // just outside a wood, under its outer crowns: open ground (no canopy cell) with a wood within 6 m (canopy: m high)
  const edgeSpot = (x, y) => map.inBounds(x, y) && !map.canopy(x, y) && !map.water(x, y) && (map.canopy(x + 6, y) >= 4 || map.canopy(x - 6, y) >= 4 || map.canopy(x, y + 6) >= 4 || map.canopy(x, y - 6) >= 4);
  function nearestManD(w, x, y, r) {
    const Sx = w.S; let bd = r * r;
    for (let i = 0; i < Sx.n; i++) { if (!Sx.alive[i]) continue; const dx = Sx.x[i] - x, dy = Sx.y[i] - y, d2 = dx * dx + dy * dy; if (d2 < bd) bd = d2; }
    return Math.sqrt(bd);
  }
  function mote(x, y, h, r, g, b) {
    if (nmt >= MOTES) return;
    mtPos.set([x, map.h(x, y) + h, -y], nmt * 3); mtCol.set([r, g, b], nmt * 3); nmt++;
  }
  function ambience(w, cam, visible, now, dtr) {
    if (!amb) amb = makeAmb(w);
    nmt = 0;
    const cx = cam.position.x, cy = -cam.position.z, doy = ((w.econ?.doy ?? 180) % 365 + 365) % 365;
    // red kites: wide slow circles high over the holds — up where the fog of war means nothing
    const kite = S.kite;
    if (kite) for (const K of amb.kites) {
      const a = K.a0 + now * K.w, x = K.x + Math.cos(a) * K.r, y = K.y + Math.sin(a) * K.r; K.px = x; K.py = y;
      if (Math.hypot(x - cx, y - cy) > AMB * 1.4) continue;
      const fa = frameOf(kite, "graze", (now * 0.25 + K.a0) % 1);
      put(kite, x, y, a + (K.w > 0 ? Math.PI / 2 : -Math.PI / 2), 0, K.w > 0 ? 0.2 : -0.2, 1.3, [fa[0], fa[1], fa[2], 1], [0, 0, 0, 0], [1, 1, 0, 0], K.h);   // (×1.3: a red kite spans ~1.75 m)
    }
    // herons: stock-still in the shallows; men too near put one up and it beats off to another bank
    const heron = S.heron;
    if (heron) for (const H of amb.herons) {
      if (Math.hypot(H.x - cx, H.y - cy) > AMB) continue;
      if (visible && !visible(H.x, H.y, -1)) continue;
      if (!H.fly && now > H.t0 + 1 && (H.ck -= dtr) < 0) {
        H.ck = 0.5;
        if (nearestManD(w, H.x, H.y, 24) < 24 && amb.banks.length > 1) {
          const to = amb.banks[Math.floor(hash(Math.floor(now * 7) + 3) * amb.banks.length)];
          if (Math.hypot(to[0] - H.x, to[1] - H.y) > 30) { H.fly = 1; H.fx = H.x; H.fy = H.y; H.tx = to[0]; H.ty = to[1]; H.t0 = now; H.dur = Math.hypot(to[0] - H.x, to[1] - H.y) / 9; }
        }
      }
      if (H.fly) {
        const [x, y, h, yaw, k] = arc(H, now); H.x = x; H.y = y;
        const fa = frameOf(heron, "run", (now * 1.6 + H.ph) % 1);
        put(heron, x, y, yaw, 0, 0, 1, [fa[0], fa[1], fa[2], 1], [0, 0, 0, 0], [1, 1, 0, 0], h);
        if (k >= 1) { H.fly = 0; H.t0 = now; }
      } else {
        const fa = frameOf(heron, "graze", (now * 0.12 + H.ph) % 1);
        put(heron, H.x, H.y, H.ph * 6.28, 0, 0, 1, [fa[0], fa[1], fa[2], 1], [0, 0, 0, 0], [1, 1, 0, 0]);
      }
    }
    // pheasants: strutting in the hedge bottom at the wood edge — and the BURST when a man walks almost onto one
    const ph = S.pheasant;
    if (ph) for (const P of amb.pheas) {
      if (Math.hypot(P.x - cx, P.y - cy) > 300) continue;
      if (visible && !visible(P.x, P.y, -1)) continue;
      if (!P.fly && now > P.cool && nearestManD(w, P.x, P.y, 13) < 13) {
        const a = hash(Math.floor(now * 9) + 5) * 6.28, r2 = 30 + 20 * hash(Math.floor(now * 9) + 6);
        P.fly = 1; P.fx = P.x; P.fy = P.y; P.tx = P.hx + Math.cos(a) * r2; P.ty = P.hy + Math.sin(a) * r2; P.t0 = now; P.dur = 2.2; P.cool = now + 40;
      }
      if (P.fly) {
        const [x, y, h, yaw, k] = arc(P, now); P.x = x; P.y = y;
        const fa = frameOf(ph, "run", (now * 4 + P.ph) % 1);
        put(ph, x, y, yaw, -0.3 * Math.sin(Math.PI * k), 0, 1, [fa[0], fa[1], fa[2], 1], [0, 0, 0, 0], [1, 1, 0, 0], h * 0.7);
        if (k >= 1) P.fly = 0;
      } else {
        const fa = frameOf(ph, hash(Math.floor(now / 6) + P.ph * 97) < 0.6 ? "graze" : "walk", (now * 0.5 + P.ph) % 1);
        put(ph, P.x + Math.sin(now * 0.07 + P.ph * 9) * 2, P.y + Math.cos(now * 0.05 + P.ph * 7) * 2, P.ph * 6.28 + now * 0.05, 0, 0, 1, [fa[0], fa[1], fa[2], 1], [0, 0, 0, 0], [1, 1, 0, 0]);
      }
    }
    // songbirds: a dozen little lives flitting between the trees around the camera
    const sb = S.songbird;
    if (sb) {
      while (amb.birds.length < 10) amb.birds.push({ x: cx, y: cy, tx: cx, ty: cy, fx: cx, fy: cy, t0: -9, dur: 1, fly: 0, next: 0, ph: hash(amb.birds.length + 83), dead: 1 });
      for (const B2 of amb.birds) {
        if (B2.dead || Math.hypot(B2.x - cx, B2.y - cy) > 170) {   // find it a tree near the camera
          let spot = null;
          for (let j = 0; j < 10 && !spot; j++) { const a = hash(Math.floor(now * 13) + j * 7) * 6.28, r2 = 25 + 100 * hash(Math.floor(now * 11) + j * 3), x = cx + Math.cos(a) * r2, y = cy + Math.sin(a) * r2; if (map.inBounds(x, y) && map.canopy(x, y) > 2) spot = [x, y]; }
          if (!spot) { B2.dead = 1; continue; }
          B2.dead = 0; B2.x = B2.tx = B2.fx = spot[0]; B2.y = B2.ty = B2.fy = spot[1]; B2.fly = 0; B2.next = now + 2 + 6 * hash(Math.floor(now * 17) + 1);
        }
        if (!B2.fly && now > B2.next) {   // off to the next tree
          let spot = null;
          for (let j = 0; j < 8 && !spot; j++) { const a = hash(Math.floor(now * 19) + j * 5) * 6.28, r2 = 12 + 40 * hash(Math.floor(now * 23) + j * 9), x = B2.x + Math.cos(a) * r2, y = B2.y + Math.sin(a) * r2; if (map.inBounds(x, y) && map.canopy(x, y) > 2) spot = [x, y]; }
          if (spot) { B2.fly = 1; B2.fx = B2.x; B2.fy = B2.y; B2.tx = spot[0]; B2.ty = spot[1]; B2.t0 = now; B2.dur = Math.hypot(spot[0] - B2.x, spot[1] - B2.y) / 11; }
          else B2.next = now + 4;
        }
        const perchH = Math.max(2, map.canopy(B2.x, B2.y) * 0.55);
        if (B2.fly) {
          const [x, y, h, yaw, k] = arc(B2, now); B2.x = x; B2.y = y;
          const fa = frameOf(sb, "run", (now * 6 + B2.ph) % 1);
          put(sb, x, y, yaw, 0, 0, 1, [fa[0], fa[1], fa[2], 1], [0, 0, 0, 0], [1, 0.75 + 0.5 * B2.ph, 0, 0], perchH + h * 0.4);
          if (k >= 1) { B2.fly = 0; B2.next = now + 2 + 6 * hash(Math.floor(now * 29) + 2); }
        } else if (Math.hypot(B2.x - cx, B2.y - cy) < 140) {
          const fa = frameOf(sb, "graze", (now * 0.8 + B2.ph) % 1);
          put(sb, B2.x, B2.y, B2.ph * 6.28 + Math.round(now * 0.2 + B2.ph) * 1.7, 0, 0, 1, [fa[0], fa[1], fa[2], 1], [0, 0, 0, 0], [1, 0.75 + 0.5 * B2.ph, 0, 0], perchH);
        }
      }
    }
    // buzzards: lower, tighter circles over the woods, mewing (drawn: the kite model, browner)
    if (kite) for (const K of amb.buzz) {
      const a = K.a0 + now * K.w, x = K.x + Math.cos(a) * K.r, y = K.y + Math.sin(a) * K.r;
      if (Math.hypot(x - cx, y - cy) > AMB * 1.2) continue;
      const fa = frameOf(kite, "alert", (now * 0.2 + K.a0) % 1);
      put(kite, x, y, a + (K.w > 0 ? Math.PI / 2 : -Math.PI / 2), 0, K.w > 0 ? 0.3 : -0.3, 1.15, [fa[0], fa[1], fa[2], 1], [0, 0, 0, 0], [1, 0.62, 0, 0], K.h);
    }
    // owls: out on the edge perch in the dusk hour of each day (the last fifth of it), or whenever a fog lies on the vale;
    // the head turns and holds; it glides in from the wood and back
    let nst = 0;
    const owl = S.owl, dayFr = (((w.econ?.doy ?? 0) % 1) + 1) % 1, gloom = /fog|mist/.test(w.weather || "");
    if (owl) for (const O of amb.owls) {
      if (Math.hypot(O.x - cx, O.y - cy) < 260 && nst < 8) { d.position.set(O.x, map.h(O.x, O.y), -O.y); d.quaternion.setFromAxisAngle(up, O.ph * 6.28); d.scale.set(1, O.h, 1); d.updateMatrix(); stumps.setMatrixAt(nst++, d.matrix); }
      const want = gloom || (dayFr > 0.78 && dayFr < 0.98 && hash(Math.floor(w.econ?.doy ?? 0) * 7 + Math.round(O.ph * 999)) < 0.7);
      if (want !== !!O.out) { O.out = want ? 1 : 0; O.t0 = now; }
      if (!O.out && now - O.t0 > 2.5) continue;
      if (Math.hypot(O.x - cx, O.y - cy) > 260 || (visible && !visible(O.x, O.y, -1))) continue;
      const k = Math.min(1, (now - O.t0) / 2.5), inn = O.out ? k : 1 - k;   // 0: in the wood, 1: on the perch
      if (inn < 1) {   // gliding in (or off): from a point 18 m back in the wood
        const a = O.ph * 6.28, fx = O.x + Math.cos(a) * 18, fy = O.y + Math.sin(a) * 18;
        const x = fx + (O.x - fx) * inn, y = fy + (O.y - fy) * inn, fa = frameOf(owl, "run", (now * 0.9 + O.ph) % 1);
        put(owl, x, y, Math.atan2(O.y - fy, O.x - fx) + (O.out ? 0 : Math.PI), 0, 0, 1.1, [fa[0], fa[1], fa[2], 1], [0, 0, 0, 0], [1, 1, 0, 0], O.h + 2 * Math.sin(Math.PI * inn));
      } else {
        const fa = frameOf(owl, "graze", (now * 0.11 + O.ph) % 1);
        put(owl, O.x, O.y, O.ph * 6.28 + Math.PI, 0, 0, 1.1, [fa[0], fa[1], fa[2], 1], [0, 0, 0, 0], [1, 1, 0, 0], O.h);
      }
    }
    stumps.count = nst; stumps.instanceMatrix.needsUpdate = true;
    // red squirrels: about the trees near the camera — sat up nibbling on the ground at a wood's edge, scampering tree to
    // tree, and off up the trunk (gone) when a man comes near
    const sq = S.squirrel;
    if (sq && doy > 60 && doy < 330) {
      while (amb.squir.length < 6) amb.squir.push({ x: cx, y: cy, fx: cx, fy: cy, tx: cx, ty: cy, t0: -9, dur: 1, fly: 0, next: 0, ph: hash(amb.squir.length + 113), dead: 1, hide: 0 });
      for (const Q of amb.squir) {
        if (Q.dead || Math.hypot(Q.x - cx, Q.y - cy) > 140) {
          let spot = null;
          for (let j = 0; j < 12 && !spot; j++) { const a = hash(Math.floor(now * 7) + j * 11 + Q.ph * 977) * 6.28, r2 = 15 + 90 * hash(Math.floor(now * 5) + j * 13), x = cx + Math.cos(a) * r2, y = cy + Math.sin(a) * r2; if (edgeSpot(x, y)) spot = [x, y]; }
          if (!spot) { Q.dead = 1; continue; }
          Q.dead = 0; Q.x = Q.tx = Q.fx = spot[0]; Q.y = Q.ty = Q.fy = spot[1]; Q.fly = 0; Q.hide = 0; Q.next = now + 3 + 5 * hash(Math.floor(now * 3) + 9);
        }
        if (now < Q.hide) continue;
        if (!Q.fly && nearestManD(w, Q.x, Q.y, 12) < 12) { Q.hide = now + 25; Q.dead = 1; continue; }   // up the trunk and gone
        if (!Q.fly && now > Q.next) {
          let spot = null;
          for (let j = 0; j < 8 && !spot; j++) { const a = hash(Math.floor(now * 17) + j * 5 + Q.ph * 331) * 6.28, r2 = 5 + 14 * hash(Math.floor(now * 19) + j), x = Q.x + Math.cos(a) * r2, y = Q.y + Math.sin(a) * r2; if (edgeSpot(x, y)) spot = [x, y]; }
          if (spot) { Q.fly = 1; Q.fx = Q.x; Q.fy = Q.y; Q.tx = spot[0]; Q.ty = spot[1]; Q.t0 = now; Q.dur = Math.hypot(spot[0] - Q.x, spot[1] - Q.y) / 4.5; }
          else Q.next = now + 3;
        }
        if (Q.fly) {
          const k = Math.min(1, (now - Q.t0) / Q.dur), x = Q.fx + (Q.tx - Q.fx) * k, y = Q.fy + (Q.ty - Q.fy) * k; Q.x = x; Q.y = y;
          const fa = frameOf(sq, "run", (now * 3 + Q.ph) % 1);
          put(sq, x, y, Math.atan2(Q.ty - Q.fy, Q.tx - Q.fx), 0, 0, 1.6, [fa[0], fa[1], fa[2], 1], [0, 0, 0, 0], [1, 1, 0, 0]);
          if (k >= 1) { Q.fly = 0; Q.next = now + 2 + 6 * hash(Math.floor(now * 23) + 4); }
        } else {
          const fa = frameOf(sq, hash(Math.floor(now / 3) + Q.ph * 51) < 0.65 ? "graze" : "alert", (now * 0.6 + Q.ph) % 1);
          put(sq, Q.x, Q.y, Q.ph * 6.28 + Math.floor(now / 4 + Q.ph) * 1.3, 0, 0, 1.6, [fa[0], fa[1], fa[2], 1], [0, 0, 0, 0], [1, 1, 0, 0]);
        }
      }
    }
    // frogs: on the wet margins near the camera from spring to autumn — sat still, and a plop into the water when a man
    // comes close
    const fr = S.frog;
    if (fr && doy > 80 && doy < 290) {
      while (amb.frogs.length < 8) amb.frogs.push({ x: cx, y: cy, hx: cx, hy: cy, wx: cx, wy: cy, t0: -9, hop: 0, ph: hash(amb.frogs.length + 151), dead: 1, gone: 0 });
      for (const F of amb.frogs) {
        if (F.dead || Math.hypot(F.hx - cx, F.hy - cy) > 90) {
          let spot = null;
          for (let j = 0; j < 16 && !spot; j++) { const a = hash(Math.floor(now * 3) + j * 7 + F.ph * 733) * 6.28, r2 = 6 + 60 * hash(Math.floor(now * 2) + j * 17 + 1), x = cx + Math.cos(a) * r2, y = cy + Math.sin(a) * r2; if (!map.inBounds(x, y) || map.water(x, y) > 0.005) continue;
            for (let k = 0; k < 6; k++) { const b = k * 1.047, ex = x + Math.cos(b) * 2.5, ey = y + Math.sin(b) * 2.5; if (map.inBounds(ex, ey) && map.water(ex, ey) > 0.04) { spot = [x, y, ex, ey]; break; } } }
          if (!spot) { F.dead = 1; continue; }
          F.dead = 0; F.x = F.hx = spot[0]; F.y = F.hy = spot[1]; F.wx = spot[2]; F.wy = spot[3]; F.hop = 0; F.gone = 0;
        }
        if (F.gone) { if (now > F.gone) F.dead = 1; continue; }
        if (!F.hop && nearestManD(w, F.x, F.y, 7) < 7) { F.hop = 1; F.t0 = now; }
        const yaw = Math.atan2(F.wy - F.hy, F.wx - F.hx);
        if (F.hop) {
          const k = Math.min(1, (now - F.t0) / 0.45), x = F.hx + (F.wx - F.hx) * k, y = F.hy + (F.wy - F.hy) * k;
          const fa = frameOf(fr, "run", k * 0.999);
          put(fr, x, y, yaw, 0, 0, 2, [fa[0], fa[1], fa[2], 1], [0, 0, 0, 0], [1, 1, 0, 0], 0.05 + 0.25 * Math.sin(Math.PI * k));
          if (k >= 1) { F.gone = now + 40; mote(F.wx, F.wy, 0.05, 0.4, 0.45, 0.5); }   // (the plop)
        } else {
          const fa = frameOf(fr, "graze", (now * 0.4 + F.ph) % 1);
          put(fr, F.x, F.y, yaw + 0.4 * (F.ph - 0.5), 0, 0, 2, [fa[0], fa[1], fa[2], 1], [0, 0, 0, 0], [1, 1, 0, 0], 0.05);   // (×2: a big old frog; lifted clear of the ground mesh's shimmer)
        }
      }
    }
    // butterflies over the summer grass near the camera, bees working the flowers, and the pale marsh-lights out on the bog
    if (doy > 110 && doy < 270) for (let g = 0; g < 4; g++) {   // bees: tight busy knots over a flowery patch each
      const a = hash(g * 5 + 201) * 6.28, r2 = 10 + 45 * hash(g * 5 + 202), bx = cx + Math.cos(a) * r2, by = cy + Math.sin(a) * r2;
      if (!map.inBounds(bx, by) || map.water(bx, by) > 0.02 || map.canopy(bx, by) > 1) continue;
      for (let k = 0; k < 5; k++) {
        const x = bx + Math.sin(now * (3.1 + k) + k * 1.9) * 1.1 + Math.sin(now * 7.3 + k) * 0.2, y = by + Math.cos(now * (2.7 + k * 0.6) + k) * 1.1;
        mote(x, y, 0.35 + 0.25 * Math.abs(Math.sin(now * 5 + k * 2)), 0.95, 0.7, 0.1);
      }
    }
    if (doy > 135 && doy < 280) for (let k = 0; k < 24; k++) {
      const a = hash(k * 3 + 1) * 6.28, r2 = 8 + 70 * hash(k * 3 + 2);
      const x = cx + Math.cos(a) * r2 + Math.sin(now * (0.5 + hash(k) * 0.7) + k) * 3, y = cy + Math.sin(a) * r2 + Math.cos(now * (0.4 + hash(k + 9) * 0.6) + k * 2) * 3;
      if (!map.inBounds(x, y) || map.water(x, y) > 0.02 || map.canopy(x, y) > 1) continue;
      const h = 0.4 + 0.5 * Math.abs(Math.sin(now * 1.3 + k * 2.1));
      const warm = hash(k + 31);
      mote(x, y, h, 0.9, warm > 0.5 ? 0.8 : 0.5, 0.25);
    }
    for (const [wx, wy] of amb.wisps) {
      if (Math.hypot(wx - cx, wy - cy) > 420) continue;
      for (let k = 0; k < 6; k++) {
        const x = wx + Math.sin(now * 0.11 + k * 2.3) * 9 + hash(k + 51) * 10 - 5, y = wy + Math.cos(now * 0.09 + k * 1.7) * 9 + hash(k + 57) * 10 - 5;
        const pulse = 0.5 + 0.5 * Math.sin(now * 0.4 + k * 2.6);
        mote(x, y, 0.8 + 0.5 * Math.sin(now * 0.23 + k), 0.25 * pulse, 0.65 * pulse, 0.45 * pulse);
      }
    }
    mtGeo.setDrawRange(0, nmt); mtGeo.attributes.position.needsUpdate = true; mtGeo.attributes.color.needsUpdate = true;
    mtMat.uniforms.pxPerM.value = mmat.uniforms.pxPerM.value; mtMat.uniforms.dpr.value = mmat.uniforms.dpr.value;
  }

  // per beast: the drawn state (smoothed position, facing, clip, phase, the clip it is fading from)
  const D = new Map();
  const d = new THREE.Object3D(), q = new THREE.Quaternion(), qp = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), zAx = new THREE.Vector3(0, 0, 1), tmpC = new THREE.Color(), B = { x: 0, y: 0, yaw: 0, fade: 0 };
  let lastNow = 0;
  const seen = new Set();

  function frameOf(sp, clip, ph) {   // → [frameA, frameB, t]
    const c = sp.clips[clip] || sp.clips.alert, [f0, n, , loop] = c;
    if (!loop) { const f = Math.min(n - 1, Math.max(0, ph * (n - 1))), a = Math.floor(f); return [f0 + a, f0 + Math.min(n - 1, a + 1), f - a]; }
    const f = ((ph % 1) + 1) % 1 * n, a = Math.floor(f) % n; return [f0 + a, f0 + (a + 1) % n, f - Math.floor(f)];
  }
  function put(sp, x, y, yaw, pitch, roll, scale, A, Bc, misc, hOff = 0) {
    const k = sp.mesh.count; if (k >= sp.cap) return;
    const h = map.h(x, y);
    q.setFromAxisAngle(up, yaw); if (pitch || roll) { qp.setFromEuler(new THREE.Euler(roll, 0, pitch, "YXZ")); q.multiply(qp); }
    d.position.set(x, h + hOff, -y); d.quaternion.copy(q); d.scale.setScalar(scale); d.updateMatrix(); sp.mesh.setMatrixAt(k, d.matrix);
    sp.iA.array.set(A, k * 4); sp.iB.array.set(Bc, k * 4); sp.iM.array.set(misc, k * 4);
    sp.mesh.count = k + 1;
    const bsc = BLOB_SC[sp.name] ?? 2.0;
    if (blobs.count < 2048 && hOff < 1.5 && bsc > 0) { d.position.set(x, h + 0.03, -y); d.quaternion.setFromAxisAngle(up, yaw); d.scale.set(bsc, 1, bsc * 0.55).multiplyScalar(scale); d.updateMatrix(); blobs.setMatrixAt(blobs.count++, d.matrix); }
  }

  function update(w, cam, { visible = null, pxPerM = 1, dpr = 1, now = 0, dt = 0.016 } = {}) {
    mmat.uniforms.pxPerM.value = pxPerM; mmat.uniforms.dpr.value = dpr;
    const W = w.wild, t = w.time, cx = cam.position.x, cy = -cam.position.z, ch = cam.position.y;
    const dtr = Math.min(0.1, Math.max(0, now - lastNow || dt)); lastNow = now;
    for (const sp of Object.values(S)) sp.mesh.count = 0;
    blobs.count = 0; let nm = 0; seen.clear(); serp.length = 0;
    const high = ch - map.h(cx, cy) > MARK_H;
    if (W) {
      const live = new Set();
      for (const a of W.a) {
        if (visible && !visible(a.x, a.y, -1)) continue;
        seen.add(a.h); live.add(a.id);
        let R = D.get(a.id);
        if (!R) { R = { x: a.x, y: a.y, f: a.f, clip: CLIP_OF_ST[a.st] || "alert", ph: hash(a.id), prev: null, pph: 0, ft: -9, spd: 0 }; D.set(a.id, R); }
        // smooth toward the sim (10 Hz ticks, 2 Hz in the realm)
        const k = 1 - Math.exp(-dtr * 9), ox = R.x, oy = R.y;
        R.x += (a.x - R.x) * k; R.y += (a.y - R.y) * k;
        if (Math.hypot(a.x - R.x, a.y - R.y) > 25) { R.x = a.x; R.y = a.y; }
        let df = Math.atan2(Math.sin(a.f - R.f), Math.cos(a.f - R.f)); R.f += df * (1 - Math.exp(-dtr * 7));
        const v = dtr > 0 ? Math.hypot(R.x - ox, R.y - oy) / dtr : 0; R.spd += (v - R.spd) * Math.min(1, dtr * 5);
        let clip = CLIP_OF_ST[a.st] || "alert";
        if (a.sp === "serpent" && clip === "graze") clip = "alert";   // (surfaced: the head and neck up out of the water)
        if (clip !== R.clip) { R.prev = R.clip; R.pph = R.ph; R.clip = clip; R.ft = now; if (clip === "walk" || clip === "run") R.ph = hash(a.id + 7) * 0.3; }
        const sp = S[a.sp]; if (!sp) continue;
        const [f0, n, fps] = sp.clips[clip];
        const rate = clip === "walk" ? Math.max(0.35, Math.min(1.8, R.spd / WALK_REF[a.sp])) : clip === "run" ? Math.max(0.5, Math.min(1.5, R.spd / RUN_REF[a.sp])) : 0.85 + 0.3 * hash(a.id);
        R.ph += dtr * fps / n * rate;
        if (R.prev) R.pph += dtr * sp.clips[R.prev][2] / sp.clips[R.prev][1];
        // a flushed flock takes WING: the run clip is flight, and the bird lifts off the water
        const flyTo = FOWL.has(a.sp) && a.st === 3 ? 6 + 2.5 * hash(a.id + 11) : 0;
        R.alt = (R.alt || 0) + (flyTo - (R.alt || 0)) * Math.min(1, dtr * 1.1);
        const dist = Math.hypot(R.x - cx, R.y - cy, map.h(R.x, R.y) - ch), scl = (a.young ? 0.62 : 1) * (SIZE[a.sp] || 1);
        const px = pxPerM * Math.max(0.3, (sp.bodyH || 0.9) * 1.6 * scl) / Math.max(1, dist), asMark = high || px < MARK_PX || dist > NEAR;
        if (asMark && nm < MK) { mpos.set([R.x, map.h(R.x, R.y) + 0.9 + R.alt, -R.y], nm * 3); tmpC.set(MARK_COL[a.sp] || "#8a7a5e"); mcol.set([tmpC.r, tmpC.g, tmpC.b], nm * 3); nm++; }
        if (!ready || asMark) continue;
        if (a.sp === "serpent") serp.push(R.x, R.y, R.f, scl);
        const fa = frameOf(sp, clip, R.ph), fade = Math.min(1, (now - R.ft) / BLEND);
        const A = [fa[0], fa[1], fa[2], R.prev && fade < 1 ? fade : 1], Bf = R.prev && fade < 1 ? frameOf(sp, R.prev, R.pph) : [0, 0, 0];
        // pitched to the slope under it (nose up a rise) — not when it is on the wing
        const L = 0.7, c = Math.cos(R.f), s = Math.sin(R.f), pitch = Math.atan2(map.h(R.x + c * L, R.y + s * L) - map.h(R.x - c * L, R.y - s * L), 2 * L) * 0.8 * Math.max(0, 1 - R.alt);
        put(sp, R.x, R.y, R.f, a.sp === "serpent" ? 0 : pitch, 0, scl, A, [Bf[0], Bf[1], Bf[2], 0], [a.male ? 1 : 0, (a.sp === "serpent" ? 0.55 : 0.9) + 0.2 * hash(a.id * 3), 0, 0], a.sp === "serpent" ? -0.32 * scl : R.alt);   // (the serpent rides low: only the humps and the head break the water)
      }
      for (const id of D.keys()) if (!live.has(id)) D.delete(id);
    }
    ripples(serp, now);
    // carcasses: lying where they fell (the fall from the arrow's landing), or across a soldier's shoulders
    const L = w.labor;
    if (L && ready) {
      for (const it of L.items) {
        const yspn = SP_OF_YOUNG[it.kind];
        if (yspn) {   // a dropped live catch: the young sits tethered where it was left (until it escapes — js/sim/wild.js)
          const spy = S[yspn]; if (!spy || (visible && !visible(it.x, it.y, it.team))) continue;
          if (Math.hypot(it.x - cx, it.y - cy) > AMB) continue;
          const fa = frameOf(spy, "alert", (t * 0.2 + hash(it.id)) % 1);
          put(spy, it.x, it.y, it.rot || 0, 0, 0, 0.62, [fa[0], fa[1], fa[2], 1], [0, 0, 0, 0], [0, 0.85, 0, 0]);
          continue;
        }
        const spn = SP_OF_ITEM[it.kind]; if (!spn) continue;
        const sp = S[spn]; if (!sp || (visible && !visible(it.x, it.y, it.team))) continue;
        const dist = Math.hypot(it.x - cx, it.y - cy); if (dist > AMB) continue;
        const st = it.st || "fall", male = st.includes("m"), young = st.includes("y"), since = t - (it.t0 ?? -99);
        const [f0, n, fps] = sp.clips.fall, dur = (n - 1) / fps;
        const fa = since < 0 ? frameOf(sp, "alert", 0.1) : frameOf(sp, "fall", Math.min(1, since / dur));
        put(sp, it.x, it.y, it.rot || 0, 0, 0, young ? 0.62 : 1, [fa[0], fa[1], fa[2], 1], [0, 0, 0, 0], [male ? 1 : 0, 0.82, 0, 0]);
      }
      const Sx = w.S;
      for (const [i, M] of L.men) {
        const ck = M.carry?.kind; if (!ck || !Sx.alive[i]) continue;
        const ysp = SP_OF_YOUNG[ck];
        if (ysp) {   // a LIVE catch (docs/mounts-wildlife-spec.md): a young strider led at the hand, a young drake slung
          const sp = S[ysp]; if (!sp) continue;
          const fig = figures && figures.bodyOf(i, B), x = fig ? B.x : Sx.x[i], y = fig ? B.y : Sx.y[i];
          if (Math.hypot(x - cx, y - cy) > 220) continue;
          const hd = fig ? B.yaw - Math.PI / 2 : Sx.facing[i];
          if (ysp === "strider") {   // walking at his side on the halter, half a step behind
            const sx = x + Math.cos(hd + Math.PI / 2) * 0.9 - Math.cos(hd) * 0.45, sy2 = y + Math.sin(hd + Math.PI / 2) * 0.9 - Math.sin(hd) * 0.45;
            const cc = sp.clips.carry || sp.clips.walk, ph = (now * cc[2] / cc[1] + hash(i)) % 1;
            const fa = frameOf(sp, sp.clips.carry ? "carry" : "walk", ph);
            put(sp, sx, sy2, hd, 0, 0, 0.62, [fa[0], fa[1], fa[2], 1], [0, 0, 0, 0], [0, 0.85, 0, 0]);
          } else {   // the young drake trussed over his shoulders
            const k = sp.mesh.count; if (k >= sp.cap) continue;
            const bx = x - Math.cos(hd) * 0.1, by = y - Math.sin(hd) * 0.1;
            q.setFromAxisAngle(up, hd + Math.PI / 2); qp.setFromAxisAngle(X_AX, -SHOULDER_TILT * 0.7); q.multiply(qp);
            d.position.set(bx, map.h(x, y) + 1.5, -by); d.quaternion.copy(q); d.scale.setScalar(0.55); d.updateMatrix();
            d.matrix.multiply(M4.makeTranslation(0, -sp.bodyH, 0));
            sp.mesh.setMatrixAt(k, d.matrix);
            const cc = sp.clips.carry || sp.clips.fall; sp.iA.array.set([cc[0], cc[0], 0, 1], k * 4); sp.iB.array.set([0, 0, 0, 0], k * 4); sp.iM.array.set([0, 0.85, 0, 0], k * 4); sp.mesh.count = k + 1;
          }
          continue;
        }
        const c = M.carry, spn = SP_OF_ITEM[ck]; if (!spn) continue;   // (villagers and soldiers alike: the beast itself, slung)
        const sp = S[spn]; if (!sp) continue;
        const fig = figures && figures.bodyOf(i, B), x = fig ? B.x : Sx.x[i], y = fig ? B.y : Sx.y[i];
        if (Math.hypot(x - cx, y - cy) > 220) continue;
        const yaw = (fig ? B.yaw - Math.PI / 2 : Sx.facing[i]) + Math.PI / 2, fl = sp.clips.fall;
        // the carcass across his shoulders: the dead pose, rolled back upright, lifted to shoulder height
        const k = sp.mesh.count; if (k >= sp.cap) continue;
        // slung across his shoulders (the carry pose): its spine along his shoulders, back up and behind, belly and the
        // gathered legs forward and down in front of his chest
        const sc = spn === "deer" ? 0.78 : 0.9, hd = (fig ? B.yaw - Math.PI / 2 : Sx.facing[i]), bx = x - Math.cos(hd) * 0.12, by = y - Math.sin(hd) * 0.12;
        q.setFromAxisAngle(up, yaw); qp.setFromAxisAngle(X_AX, -SHOULDER_TILT); q.multiply(qp);
        d.position.set(bx, map.h(x, y) + 1.52, -by); d.quaternion.copy(q); d.scale.setScalar(sc); d.updateMatrix();
        d.matrix.multiply(M4.makeTranslation(0, -sp.bodyH, 0));
        sp.mesh.setMatrixAt(k, d.matrix);
        const cc = sp.clips.carry || fl; sp.iA.array.set([cc[0] + cc[1] - 1, cc[0] + cc[1] - 1, 0, 1], k * 4); sp.iB.array.set([0, 0, 0, 0], k * 4); sp.iM.array.set([0, 0.8, 0, 0], k * 4); sp.mesh.count = k + 1;
      }
    }
    if (ready) ambience(w, cam, visible, now, dtr);
    for (const sp of Object.values(S)) { sp.mesh.instanceMatrix.needsUpdate = true; sp.iA.needsUpdate = true; sp.iB.needsUpdate = true; sp.iM.needsUpdate = true; }
    blobs.instanceMatrix.needsUpdate = true;
    mgeo.setDrawRange(0, nm); mgeo.attributes.position.needsUpdate = true; mgeo.attributes.color.needsUpdate = true;
    w.wildSeen = seen;
  }
  function stats() { return { ...Object.fromEntries(Object.entries(S).map(([k, sp]) => [k, sp.mesh.count])), ripples: rings.count }; }
  // (shot hooks, tools/wildlife-shots.mjs: where the k-th owl perch / heron nearest the first town is)
  const nearTown = (list, k) => { const t = amb?.townXY || [0, 0]; return [...list].sort((a, b) => Math.hypot(a.x - t[0], a.y - t[1]) - Math.hypot(b.x - t[0], b.y - t[1]))[k] || list[0]; };
  const owlAt = (k = 0) => { const O = amb && nearTown(amb.owls, k); return O ? [O.x, O.y] : null; };
  const heronAt = (k = 0) => { const H = amb && nearTown(amb.herons, k); return H ? [H.x, H.y] : null; };
  const kiteAt = (k = 0) => { const K = amb?.kites[k]; return K ? [K.px ?? K.x, K.py ?? K.y] : null; };
  const smallAt = (list) => { const o = (list || []).find((q2) => !q2.dead && !q2.gone && !(q2.hide > lastNow)); return o ? [o.x, o.y] : null; };
  const squirrelAt = () => smallAt(amb?.squir), frogAt = () => smallAt(amb?.frogs);
  return { update, stats, owlAt, heronAt, kiteAt, squirrelAt, frogAt, get ready() { return ready; } };
}
