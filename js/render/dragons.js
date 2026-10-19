// THE DRAGONS, drawn (the sim is js/sim/dragons.js; the model is assets/src/dragon.py → assets/wild/dragon.json,
// wild-game-style rigid parts with a matrix-table of clips — see js/render/wild.js, whose shader this reuses).
//
//   • THE WORMS: one instanced mesh per hue ("ash", "red"), clip straight from the sim's D.st (sleep | stand | walk |
//     fly | glide | land | bite | breathe | yield | dead), position smoothed, FLIGHT HEIGHT from D.z, the body banked
//     a little into its turns. A soft blob of shade on the ground even when it is high (the dread passing over).
//   • THE LAIRS: assets/glb/dragon_lair.glb (assets/src/dragon_lair.py: a scorched crag horseshoe with bones) set
//     down at each dragon's home — a landmark every lord knows, drawn unfogged like the hills themselves.
//   • FIRE BREATH: while D.breath stands (sim state), a cone of additive flame motes pours from the mouth toward it,
//     with smoke after; reads from Eagle height as a tongue of fire.
//   • ARROWS at it (w.dragons.shots) as brief streaks; AT A DISTANCE each dragon is a big dark mark with an ember rim.
// w.dragonSeen (ids in sight this frame) is set for the hover/orders UI (js/ui/click-target.js).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { lairF } from "../sim/dragons.js";

const NEAR = 900, MARK_AT = 320, BLEND = 0.3;
const CLIP_RATE = { walk: 2.0, fly: 15 };   // m/s the clips were made for
const hash = (n) => { n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); n = Math.imul(n ^ (n >>> 16), 0x45d9f3b); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
function b64(s, T) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new T(u.buffer); }

function makeMaterial(sp) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.18, side: THREE.DoubleSide }); // (a scaled hide has a dull sheen)
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.animTex = { value: sp.tex };
    sh.vertexShader = sh.vertexShader.replace("#include <common>", `#include <common>
      attribute float aPart; attribute vec4 iA; attribute vec4 iB; attribute vec4 iMisc;
      uniform sampler2D animTex;
      mat4 animAt(float frame) { int f = int(frame), p = int(aPart) * 3;
        vec4 r0 = texelFetch(animTex, ivec2(p, f), 0), r1 = texelFetch(animTex, ivec2(p + 1, f), 0), r2 = texelFetch(animTex, ivec2(p + 2, f), 0);
        return mat4(r0.x, r1.x, r2.x, 0.0,  r0.y, r1.y, r2.y, 0.0,  r0.z, r1.z, r2.z, 0.0,  r0.w, r1.w, r2.w, 1.0); }
      mat4 animMat() {
        mat4 a = animAt(iA.x) * (1.0 - iA.z) + animAt(iA.y) * iA.z;
        if (iA.w < 0.999) { mat4 b = animAt(iB.x) * (1.0 - iB.z) + animAt(iB.y) * iB.z; a = a * iA.w + b * (1.0 - iA.w); }
        return a; }`)
      .replace("#include <beginnormal_vertex>", "mat4 AM = animMat(); vec3 objectNormal = normalize(mat3(AM) * normal);")
      .replace("#include <begin_vertex>", "vec3 transformed = (AM * vec4(position, 1.0)).xyz;")
      .replace("#include <color_vertex>", "#include <color_vertex>\n  vColor.rgb *= iMisc.y;");
  };
  return mat;
}

export function makeDragonsRender(scene, map, { base = "" } = {}) {
  const S = {}; let ready = false;
  fetch(`${base}assets/wild/dragon.json`).then((r) => r.json()).then((J) => {
    for (const [name, D] of Object.entries(J)) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(b64(D.pos, Float32Array), 3));
      g.setAttribute("normal", new THREE.BufferAttribute(b64(D.nrm, Float32Array), 3));
      g.setAttribute("color", new THREE.BufferAttribute(b64(D.col, Float32Array), 3));
      g.setAttribute("aPart", new THREE.BufferAttribute(Float32Array.from(b64(D.part, Uint8Array)), 1));
      g.setIndex(new THREE.BufferAttribute(b64(D.idx, D.n < 65536 ? Uint16Array : Uint32Array), 1));
      const mats = b64(D.mats, Float32Array), W = D.parts * 3;
      const tex = new THREE.DataTexture(new Float32Array(W * D.frames * 4), W, D.frames, THREE.RGBAFormat, THREE.FloatType);
      tex.image.data.set(mats); tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
      const cap = 4, iA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4), iB = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4), iM = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      for (const a of [iA, iB, iM]) a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute("iA", iA); g.setAttribute("iB", iB); g.setAttribute("iMisc", iM);
      const sp = { name, clips: D.clips, tex, iA, iB, iM, cap };
      const mesh = new THREE.InstancedMesh(g, makeMaterial(sp), cap); mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = true;
      scene.add(mesh); sp.mesh = mesh; S[name] = sp;
    }
    ready = true;
  }).catch((e) => console.warn("dragon models:", e));

  // ---- the lairs (set down once, when the world first tells us where they are)
  const lairG = new THREE.Group(); scene.add(lairG);
  let lairGlb = null, lairsPlaced = "";
  let lairErr = null;
  new GLTFLoader().load(`${base}assets/glb/dragon_lair.glb`, (glb) => { lairGlb = glb.scene; }, undefined, (e) => { lairErr = e; console.warn("dragon lair:", e); });
  // the crag (assets/src/dragon_lair.py, ~12 × 10 m as modelled) is set down at LAIR_S scale so the worm — 10 m nose
  // to tail, curled — lies IN its hollow: the hollow's centre (model (0, 0.6)) on the dragon's home, the back wall behind it,
  // the mouth (model −Y) open in front, turned to lairF(id), the heading it sleeps on (its neck curls toward the wall)
  const LAIR_S = 2.25, HOLLOW_Y = 0.6;
  function placeLairs(list) {
    const key = list.map((l) => `${l.id}:${Math.round(l.x)},${Math.round(l.y)}`).join(";");
    if (!lairGlb || key === lairsPlaced) return;
    lairsPlaced = key;
    lairG.clear();
    for (const l of list) {
      const m = lairGlb.clone(true);
      // keep only LOD0 shells (the GLB carries _LOD1/2 copies too)
      m.traverse((o) => { if (o.isMesh && /_LOD[12]/.test(o.name)) o.visible = false; });
      const th = lairF(l.id), ox = l.x + Math.sin(th) * HOLLOW_Y * LAIR_S, oy = l.y - Math.cos(th) * HOLLOW_Y * LAIR_S;
      m.position.set(ox, map.h(ox, oy) - 0.25, -oy);
      m.rotation.y = th; m.scale.setScalar(LAIR_S);
      lairG.add(m);
    }
  }

  // ---- blob shade (also under a flying dragon: its dread passes over the fields)
  const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const blobMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }",
    fragmentShader: "varying vec2 vUv; void main(){ float r = length((vUv - 0.5) * 2.0); float a = smoothstep(1.0, 0.3, r) * 0.4; if (a < 0.01) discard; gl_FragColor = vec4(0.03, 0.028, 0.02, a); }" });
  const blobs = new THREE.InstancedMesh(blobGeo, blobMat, 4); blobs.count = 0; blobs.frustumCulled = false; blobs.renderOrder = 2; scene.add(blobs);

  // ---- the distant mark: a big dark point with an ember rim (unmistakable among the deer-speckle)
  const MK = 4, mgeo = new THREE.BufferGeometry(), mpos = new Float32Array(MK * 3), mcol = new Float32Array(MK * 3);
  mgeo.setAttribute("position", new THREE.BufferAttribute(mpos, 3).setUsage(THREE.DynamicDrawUsage));
  mgeo.setAttribute("color", new THREE.BufferAttribute(mcol, 3).setUsage(THREE.DynamicDrawUsage));
  const mmat = new THREE.ShaderMaterial({ uniforms: { pxPerM: { value: 1 }, dpr: { value: 1 } },
    vertexShader: `attribute vec3 color; uniform float pxPerM; uniform float dpr; varying vec3 vC;
      void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(9.0 * pxPerM / -mv.z, 11.0, 20.0) * dpr; }`,
    fragmentShader: `varying vec3 vC; void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float r = length(p / vec2(1.0, 0.72)); if (r > 1.0) discard;
      vec3 c = r > 0.7 ? vec3(0.95, 0.5, 0.12) : vC; gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0); }` });
  const marks = new THREE.Points(mgeo, mmat); marks.frustumCulled = false; marks.renderOrder = 5; scene.add(marks);

  // ---- fire breath and arrow streaks: one CPU-integrated additive point system
  const FN = 2600, fgeo = new THREE.BufferGeometry();
  const fp = new Float32Array(FN * 3), fs = new Float32Array(FN), fa = new Float32Array(FN), fc = new Float32Array(FN * 3);
  fgeo.setAttribute("position", new THREE.BufferAttribute(fp, 3).setUsage(THREE.DynamicDrawUsage));
  fgeo.setAttribute("size", new THREE.BufferAttribute(fs, 1).setUsage(THREE.DynamicDrawUsage));
  fgeo.setAttribute("alpha", new THREE.BufferAttribute(fa, 1).setUsage(THREE.DynamicDrawUsage));
  fgeo.setAttribute("color", new THREE.BufferAttribute(fc, 3).setUsage(THREE.DynamicDrawUsage));
  const sprite = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d");
    const r = g.createRadialGradient(32, 32, 2, 32, 32, 30); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.45, "rgba(255,255,255,0.55)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const fmat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { tex: { value: sprite }, scale: { value: 300 } },
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; uniform float scale; varying float vA; varying vec3 vC;
      void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * scale / -mv.z; }`,
    fragmentShader: `uniform sampler2D tex; varying float vA; varying vec3 vC;
      void main(){ vec4 t = texture2D(tex, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA); }` });
  const fpts = new THREE.Points(fgeo, fmat); fpts.frustumCulled = false; fpts.renderOrder = 6; scene.add(fpts);
  const P = []; // live particles: {x,y,z (world up), vx,vy,vz, life,t0, s, c:[r,g,b], smoke}
  function emit(x, z, y, vx, vz, vy, life, s, c, smoke = 0, jet = 0) { if (P.length < FN) P.push({ x, y, z, vx, vy, vz, life, age: 0, s, c, smoke, jet }); }

  const D = new Map();
  const d = new THREE.Object3D(), q = new THREE.Quaternion(), qp = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), tmpC = new THREE.Color();
  let lastNow = 0;
  const seen = new Set();

  function frameOf(sp, clip, ph) {
    const c = sp.clips[clip] || sp.clips.stand, [f0, n, , loop] = c;
    if (!loop) { const f = Math.min(n - 1, Math.max(0, ph * (n - 1))), a = Math.floor(f); return [f0 + a, f0 + Math.min(n - 1, a + 1), f - a]; }
    const f = ((ph % 1) + 1) % 1 * n, a = Math.floor(f) % n; return [f0 + a, f0 + (a + 1) % n, f - Math.floor(f)];
  }

  function update(w, cam, { visible = null, pxPerM = 1, dpr = 1, now = 0, dt = 0.016 } = {}) {
    mmat.uniforms.pxPerM.value = pxPerM; mmat.uniforms.dpr.value = dpr;
    const G = w.dragons, cx = cam.position.x, cy = -cam.position.z;
    const dtr = Math.min(0.1, Math.max(0.001, now - lastNow || dt)); lastNow = now;
    for (const sp of Object.values(S)) sp.mesh.count = 0;
    blobs.count = 0; let nm = 0; seen.clear();
    if (G) {
      placeLairs(G.lairs?.length ? G.lairs : G.list.filter((x) => x.home).map((x) => ({ id: x.id, x: x.home.x, y: x.home.y })));
      for (const a of G.list) {
        if (a.mode === "dead" && a.st !== "dead") continue;
        const own = a.owner >= 0 && a.owner === w.humanTeam;
        if (!own && visible && !visible(a.x, a.y, -1)) continue;
        seen.add(a.id);
        let R = D.get(a.id);
        if (!R) { R = { x: a.x, y: a.y, z: a.z || 0, f: a.f, clip: a.st || "sleep", ph: hash(a.id), prev: null, pph: 0, ft: -9, spd: 0, bank: 0 }; D.set(a.id, R); }
        const k = 1 - Math.exp(-dtr * 6), ox = R.x, oy = R.y, of = R.f;
        R.x += (a.x - R.x) * k; R.y += (a.y - R.y) * k; R.z += ((a.z || 0) - R.z) * k;
        if (Math.hypot(a.x - R.x, a.y - R.y) > 80) { R.x = a.x; R.y = a.y; R.z = a.z || 0; }
        const atHome = (a.st === "sleep" || a.mode === "sleep") && a.home && Math.hypot(a.x - a.home.x, a.y - a.home.y) < 4;
        const wantF = atHome ? lairF(a.id) : a.f; // (asleep it lies in the lair's hollow, along the back wall)
        const df = Math.atan2(Math.sin(wantF - R.f), Math.cos(wantF - R.f)); R.f += df * (1 - Math.exp(-dtr * (atHome ? 1.5 : 4)));
        R.bank += ((R.f - of) / dtr * -0.5 - R.bank) * Math.min(1, dtr * 3); R.bank = Math.max(-0.5, Math.min(0.5, R.bank));
        const v = dtr > 0 ? Math.hypot(R.x - ox, R.y - oy) / dtr : 0; R.spd += (v - R.spd) * Math.min(1, dtr * 5);
        const st = a.st || "sleep";
        if (st !== R.clip) { R.prev = R.clip; R.pph = R.ph; R.clip = st; R.ft = now; R.ph = st === "walk" || st === "fly" ? 0.2 * hash(a.id + 5) : 0; }
        const sp = S[a.hue ? "red" : "ash"] || S.ash; if (!sp) continue;
        const [, n, fps, loop] = sp.clips[st] || sp.clips.stand;
        const rate = st === "walk" ? Math.max(0.4, Math.min(1.6, R.spd / CLIP_RATE.walk)) : st === "fly" ? Math.max(0.6, Math.min(1.4, (R.spd || 10) / CLIP_RATE.fly)) : 1;
        if (loop) R.ph += dtr * fps / n * rate; else R.ph = Math.min(1, R.ph + dtr * fps / Math.max(1, n - 1));
        if (R.prev && sp.clips[R.prev]) R.pph += dtr * sp.clips[R.prev][2] / sp.clips[R.prev][1];
        const h = map.h(R.x, R.y), dist = Math.hypot(R.x - cx, R.y - cy);
        if (dist > MARK_AT && nm < MK) { mpos.set([R.x, h + R.z + 2.5, -R.y], nm * 3); tmpC.set(a.hue ? "#5e2e1c" : "#3c4248"); mcol.set([tmpC.r, tmpC.g, tmpC.b], nm * 3); nm++; }
        // the shade it casts, even from on high
        if (blobs.count < 4) { d.position.set(R.x, h + 0.04, -R.y); d.quaternion.setFromAxisAngle(up, R.f); const bs = 12 + R.z * 0.08; d.scale.set(bs, 1, bs * 0.6); d.updateMatrix(); blobs.setMatrixAt(blobs.count++, d.matrix); }
        if (ready && dist <= NEAR) {
          const fA = frameOf(sp, st, R.ph), fade = Math.min(1, (now - R.ft) / BLEND);
          const A = [fA[0], fA[1], fA[2], R.prev && fade < 1 ? fade : 1], Bf = R.prev && fade < 1 ? frameOf(sp, R.prev, R.pph) : [0, 0, 0];
          const flying = R.z > 0.8;
          const L = 2.4, c2 = Math.cos(R.f), s2 = Math.sin(R.f);
          const lying = st === "sleep" || st === "yield" || st === "dead";
          const pitch = flying ? 0 : Math.atan2(map.h(R.x + c2 * L, R.y + s2 * L) - map.h(R.x - c2 * L, R.y - s2 * L), 2 * L) * (lying ? 0.95 : 0.7);
          // lying down it settles into the slope side to side as well (a hillside lair once left it floating on its downhill flank)
          const roll = flying || !lying ? 0 : -Math.atan2(map.h(R.x - s2 * 1.6, R.y + c2 * 1.6) - map.h(R.x + s2 * 1.6, R.y - c2 * 1.6), 3.2) * 0.95;
          const kI = sp.mesh.count;
          if (kI < sp.cap) {
            q.setFromAxisAngle(up, R.f);
            if (pitch || roll || (flying && R.bank)) { qp.setFromEuler(new THREE.Euler(flying ? R.bank : roll, 0, pitch, "YXZ")); q.multiply(qp); }
            d.position.set(R.x, h + R.z - (lying ? 0.2 : 0), -R.y); d.quaternion.copy(q); d.scale.setScalar(1); d.updateMatrix(); sp.mesh.setMatrixAt(kI, d.matrix); // (lying, its belly pressed into the ground, not resting on a point of it)
            sp.iA.array.set(A, kI * 4); sp.iB.array.set([Bf[0], Bf[1], Bf[2], 0], kI * 4); sp.iM.array.set([1, 0.95 + 0.1 * hash(a.id), 0, 0], kI * 4);
            sp.mesh.count = kI + 1;
          }
        }
        // the breath: flame motes from the mouth toward the mark while it stands (and a beat after)
        const br = a.breath;
        if (br && w.time < (br.until ?? 0) + 0.4) {
          const mx = R.x + Math.cos(R.f) * 5.0, my = R.y + Math.sin(R.f) * 5.0, mz = h + R.z + 4.0; // (the jaws, mid-breath: ~5 m ahead, 4 m up)
          const tx = br.x, ty = br.y, tz = map.h(tx, ty) + 0.4;
          const dd = Math.hypot(tx - mx, ty - my) || 1, ux = (tx - mx) / dd, uy = (ty - my) / dd;
          // a thick tongue of flame that reaches the mark and widens as it goes (it once died out halfway, a wisp)
          const n2 = Math.min(34, Math.ceil(520 * dt));
          for (let i = 0; i < n2; i++) {
            const j = Math.random, spd2 = 26 + j() * 10, a2 = (j() - 0.5) * 0.42;
            const c3 = Math.cos(a2), s3 = Math.sin(a2), vx = (ux * c3 - uy * s3) * spd2, vy = (uy * c3 + ux * s3) * spd2;
            const tt = dd / spd2, vz = (tz - mz) / tt + (j() - 0.5) * 2.5;
            const hot = j();
            emit(mx + (j() - 0.5) * 0.6, mz + (j() - 0.5) * 0.4, my + (j() - 0.5) * 0.6, vx, vz, vy, tt * (0.85 + j() * 0.3), 2.2 + j() * 2.2,
              hot < 0.25 ? [1.0, 0.92, 0.55] : hot < 0.7 ? [1.0, 0.55, 0.12] : [0.95, 0.28, 0.05], 0, 1);
          }
          // where it strikes: the ground itself burns — a low sheet of flame and a column of smoke
          const nG = Math.min(14, Math.ceil(200 * dt));
          for (let i = 0; i < nG; i++) {
            const j = Math.random, r = Math.sqrt(j()) * (4 + dd * 0.18), q2 = j() * 6.283;
            const gx = tx - ux * j() * dd * 0.35 + Math.cos(q2) * r, gy = ty - uy * j() * dd * 0.35 + Math.sin(q2) * r;
            emit(gx, map.h(gx, gy) + 0.3, gy, (j() - 0.5) * 1.5, 2 + j() * 3, (j() - 0.5) * 1.5, 0.5 + j() * 0.5, 2.0 + j() * 2.5, j() < 0.5 ? [1.0, 0.5, 0.1] : [1.0, 0.75, 0.25]);
            if (j() < 0.3) emit(gx, map.h(gx, gy) + 2, gy, (j() - 0.5) * 2, 3 + j() * 2, (j() - 0.5) * 2, 2 + j() * 1.5, 4 + j() * 3, [0.1, 0.09, 0.08], 1);
          }
        }
      }
      for (const id of D.keys()) if (!G.list.some((a) => a.id === id)) D.delete(id);
      // arrow streaks at the worm (w.dragons.shots: [x0,y0,z0,x1,y1,z1,t], ~0.6 s of flight)
      for (const s of G.shots || []) {
        const age = w.time - s[6]; if (age < 0 || age > 0.6) continue;
        const t = age / 0.6, x = s[0] + (s[3] - s[0]) * t, y = s[1] + (s[4] - s[1]) * t;
        const z = map.h(s[0], s[1]) + s[2] + (map.h(s[3], s[4]) + s[5] - map.h(s[0], s[1]) - s[2]) * t + Math.sin(Math.PI * t) * 6;
        if (Math.random() < dt * 60) emit(x, z, y, 0, 0, 0, 0.1, 0.5, [0.85, 0.82, 0.7]);
      }
    }
    // integrate the motes
    let np = 0;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i]; p.age += dt;
      if (p.age >= p.life) { P.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.jet) p.vz += 1.2 * dt; // (the jet holds its line to the mark)
      else if (!p.smoke) { p.vz += 2.5 * dt; p.vx *= 1 - 1.6 * dt; p.vy *= 1 - 1.6 * dt; } else p.vz += 0.8 * dt;
      const u2 = p.age / p.life, k2 = 1 - u2;
      fp.set([p.x, p.z, -p.y], np * 3);
      fs[np] = p.s * (p.smoke ? 1 + p.age : p.jet ? 0.5 + 2.2 * u2 : 0.6 + 0.8 * k2); // (the jet widens toward the mark)
      fa[np] = p.smoke ? 0.3 * k2 : p.jet ? 0.85 * Math.min(1, k2 * 2.5) : 0.75 * k2; fc.set(p.c, np * 3); np++;
    }
    fgeo.setDrawRange(0, np);
    fgeo.attributes.position.needsUpdate = true; fgeo.attributes.size.needsUpdate = true; fgeo.attributes.alpha.needsUpdate = true; fgeo.attributes.color.needsUpdate = true;
    for (const sp of Object.values(S)) { sp.mesh.instanceMatrix.needsUpdate = true; sp.iA.needsUpdate = true; sp.iB.needsUpdate = true; sp.iM.needsUpdate = true; }
    blobs.instanceMatrix.needsUpdate = true;
    mgeo.setDrawRange(0, nm); mgeo.attributes.position.needsUpdate = true; mgeo.attributes.color.needsUpdate = true;
    w.dragonSeen = seen;
  }
  function stats() { return { ready, lairs: lairG.children.length, lairErr: lairErr ? String(lairErr.message || lairErr).slice(0, 80) : null, drawn: Object.values(S).reduce((s, sp) => s + sp.mesh.count, 0), motes: P.length }; }
  return { update, stats, get ready() { return ready; } };
}
