// What a spell looks like: low magic, so nothing glows neon. A blessing is a slow drift of pale gold motes
// over the men; mending is a faint breath of white-green mist close to the ground; valley mist is real mist
// (the scene's fog closes in and whitens while the sim's w.mist lasts). Also the aiming ring while a spell
// is being placed. Pure render: economy.castSpell decides what happens.
import * as THREE from "three";

function moteTex() {
  const cv = document.createElement("canvas"); cv.width = cv.height = 64; const g = cv.getContext("2d");
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.3, "rgba(255,255,255,.55)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const LOOK = {
  bless: { color: [0.95, 0.86, 0.6], n: 1100, life: [4, 7], rise: [0.3, 0.8], size: [0.45, 0.9], alpha: 0.85, low: 0.4, high: 4 },
  mend:  { color: [0.82, 0.9, 0.82], n: 380, life: [4, 8], rise: [0.05, 0.25], size: [4, 8], alpha: 0.22, low: 0.2, high: 1.6 },
  mist:  { color: [0.9, 0.92, 0.94], n: 700, life: [8, 14], rise: [0.02, 0.1], size: [16, 30], alpha: 0.16, low: 0.5, high: 6, spread: 420 },
  quench: { color: [0.8, 0.85, 0.9], n: 650, life: [3, 6], rise: [0.6, 1.6], size: [2.5, 5], alpha: 0.32, low: 0.5, high: 9 }, // (the Rite of Quenching: steam off the doused fire)
  // ── the battle powers (js/sim/ranked-rules.js castRanked). Still no neon: fire is fire, frost is breath,
  // an earthshake is the dust it throws up.
  thunder: { color: [0.92, 0.94, 1.0], n: 900, life: [1.2, 2.4], rise: [2.5, 6], size: [1.2, 3], alpha: 0.7, low: 0.2, high: 16 },
  smite:   { color: [1.0, 0.98, 0.85], n: 700, life: [0.8, 1.8], rise: [6, 14], size: [1.6, 3.6], alpha: 0.9, low: 0, high: 24 },
  wind:    { color: [0.85, 0.95, 0.88], n: 700, life: [2.5, 5], rise: [0.8, 2.2], size: [0.8, 1.8], alpha: 0.5, low: 0.2, high: 6 },
  haste:   { color: [0.9, 0.95, 0.6], n: 900, life: [2, 4], rise: [1.6, 3.6], size: [0.7, 1.5], alpha: 0.6, low: 0.2, high: 7 },
  firebolt:{ color: [1.0, 0.55, 0.18], n: 1400, life: [1.4, 3.2], rise: [1.4, 4.5], size: [2, 5], alpha: 0.85, low: 0, high: 12 },
  chain:   { color: [0.75, 0.88, 1.0], n: 800, life: [0.7, 1.6], rise: [3, 8], size: [1, 2.4], alpha: 0.85, low: 0.3, high: 14 },
  frost:   { color: [0.78, 0.89, 0.98], n: 1000, life: [4, 8], rise: [-0.35, 0.15], size: [2.5, 6], alpha: 0.3, low: 0.3, high: 5 },
  quake:   { color: [0.62, 0.55, 0.44], n: 1500, life: [3, 6], rise: [0.3, 1.4], size: [4, 10], alpha: 0.4, low: 0, high: 5 },
};

const RING = { firebolt: "#ff9a4d", chain: "#bcd8ff", frost: "#bcdcf2", quake: "#b09a78", smite: "#fff6cf", thunder: "#e8ecff", haste: "#e8f09a" };

export function makeSpellFx(scene, map) {
  const N = 4000;
  const geo = new THREE.BufferGeometry();
  for (const [k, n] of [["position", 3], ["color", 3], ["size", 1], ["alpha", 1]]) geo.setAttribute(k, new THREE.BufferAttribute(new Float32Array(N * n), n).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    uniforms: { tex: { value: moteTex() }, scale: { value: 1 } }, transparent: true, depthWrite: false,
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; uniform float scale; varying float vA; varying vec3 vC;
      void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv; gl_PointSize = max(1.5, size*scale/-mv.z); }`,
    fragmentShader: `uniform sampler2D tex; varying float vA; varying vec3 vC; void main(){ float a = texture2D(tex, gl_PointCoord).a; gl_FragColor = vec4(vC, a*vA); }`,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 7; scene.add(pts);
  const P = []; const casts = [];
  // aiming ring, draped over the ground
  const SEG = 72, ringPos = new Float32Array((SEG + 1) * 3);
  const ring = new THREE.LineLoop(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(ringPos, 3)), new THREE.LineBasicMaterial({ color: "#efe2b4", transparent: true, opacity: 0.85, depthTest: false }));
  ring.renderOrder = 12; ring.frustumCulled = false; ring.visible = false; scene.add(ring);
  // fading ground ring at a cast
  const castRings = [];
  function drape(arr, x, y, r) { for (let k = 0; k <= SEG; k++) { const a = k / SEG * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; arr[k * 3] = px; arr[k * 3 + 1] = map.h(px, py) + 1.2; arr[k * 3 + 2] = -py; } }
  function aim(x, y, r) {
    if (x === null) { ring.visible = false; return; }
    drape(ringPos, x, y, r); ring.geometry.attributes.position.needsUpdate = true; ring.visible = true;
  }
  function cast(kind, x, y, r) {
    const L = LOOK[kind] || LOOK.bless;
    casts.push({ kind, x, y, r: L.spread || r || 40, t: 0, dur: kind === "mist" ? 10 : 5, L });
    if (kind !== "mist") {
      const arr = new Float32Array((SEG + 1) * 3); drape(arr, x, y, r || 40);
      const m = new THREE.LineLoop(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(arr, 3)), new THREE.LineBasicMaterial({ color: RING[kind] || (kind === "bless" ? "#e9d49a" : "#d7e6d2"), transparent: true, opacity: 0.5, depthTest: true }));
      m.renderOrder = 6; m.frustumCulled = false; scene.add(m); castRings.push({ m, t: 0 });
    }
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  // mist: the fog closes in; restored when it lifts
  let fog0 = null, mistK = 0;
  function update(dt, w, cam, H) {
    mat.uniforms.scale.value = H / (2 * Math.tan(cam.fov * Math.PI / 360));
    for (const c of casts) {
      c.t += dt; if (c.t > c.dur) continue;
      const rate = c.L.n / c.dur * dt;
      for (let k = 0; k < rate && P.length < N; k++) {
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * c.r, x = c.x + Math.cos(a) * rr, y = c.y + Math.sin(a) * rr;
        const g = map.h(x, y);
        P.push({ x, y: g + rnd(c.L.low, c.L.high), z: -y, vx: rnd(-0.15, 0.15), vy: rnd(...c.L.rise), vz: rnd(-0.15, 0.15), life: rnd(...c.L.life), age: 0, size: rnd(...c.L.size), L: c.L });
      }
    }
    for (let i = casts.length - 1; i >= 0; i--) if (casts[i].t > casts[i].dur + 1) casts.splice(i, 1);
    for (let i = castRings.length - 1; i >= 0; i--) { const r = castRings[i]; r.t += dt; r.m.material.opacity = 0.5 * Math.max(0, 1 - r.t / 6); if (r.t > 6) { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); castRings.splice(i, 1); } }
    const pos = geo.attributes.position.array, col = geo.attributes.color.array, sz = geo.attributes.size.array, al = geo.attributes.alpha.array;
    let n = 0;
    for (const q of P) {
      q.age += dt; if (q.age >= q.life) continue;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      const t = q.age / q.life, f = Math.sin(t * Math.PI);
      pos[n * 3] = q.x; pos[n * 3 + 1] = q.y; pos[n * 3 + 2] = q.z; col.set(q.L.color, n * 3); sz[n] = q.size; al[n] = f * q.L.alpha;
      P[n++] = q;
    }
    P.length = n; geo.setDrawRange(0, n);
    for (const k of ["position", "color", "size", "alpha"]) geo.attributes[k].needsUpdate = true;
    // valley mist (the sim's w.mist): fog closes to a few hundred metres and pales, easing in and out
    const on = w.mist && w.tick < w.mist.until;
    mistK += ((on ? 1 : 0) - mistK) * Math.min(1, dt * 0.6);
    if (scene.fog) {
      if (!fog0) fog0 = { near: scene.fog.near, far: scene.fog.far, color: scene.fog.color.clone() };
      if (mistK > 0.002) {
        scene.fog.near = fog0.near + (60 - fog0.near) * mistK; scene.fog.far = fog0.far + (1400 - fog0.far) * mistK;
        scene.fog.color.copy(fog0.color).lerp(new THREE.Color("#dfe4e6"), mistK * 0.8);
      } else if (scene.fog.near !== fog0.near) { scene.fog.near = fog0.near; scene.fog.far = fog0.far; scene.fog.color.copy(fog0.color); }
    }
  }
  return { update, cast, aim, get mist() { return mistK; } };
}
