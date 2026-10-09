// Flames and smoke on burning buildings (and fields). Pure render: the economy decides what burns,
// how fast, and whether it spreads; this only shows it. Particles are only simulated for fires that
// are near the camera.
import * as THREE from "three";
import { BUILDINGS } from "../sim/econ-data.js";
import { ARMS } from "../sim/arms.js";

function spriteTex(kind) {
  const cv = document.createElement("canvas"); cv.width = cv.height = 64; const g = cv.getContext("2d");
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (kind === "flame") { gr.addColorStop(0, "rgba(255,240,190,1)"); gr.addColorStop(0.35, "rgba(255,150,40,.9)"); gr.addColorStop(0.7, "rgba(200,50,10,.35)"); gr.addColorStop(1, "rgba(120,20,0,0)"); }
  else { gr.addColorStop(0, "rgba(96,92,86,.32)"); gr.addColorStop(0.6, "rgba(90,88,84,.14)"); gr.addColorStop(1, "rgba(80,80,80,0)"); }
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function makeFire(scene, map) {
  const N = 6000;
  const mk = (kind, blending) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("size", new THREE.BufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(N), 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { tex: { value: spriteTex(kind) }, scale: { value: 1 } }, transparent: true, depthWrite: false, blending,
      vertexShader: `attribute float size; attribute float alpha; uniform float scale; varying float vA;
        void main(){ vA = alpha; vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv; gl_PointSize = size*scale/-mv.z; }`,
      fragmentShader: `uniform sampler2D tex; varying float vA; void main(){ vec4 c = texture2D(tex, gl_PointCoord); gl_FragColor = vec4(c.rgb, c.a*vA); }`,
    });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = kind === "flame" ? 8 : 7; scene.add(pts);
    return { geo, mat, p: [] };
  };
  const flame = mk("flame", THREE.AdditiveBlending), smoke = mk("smoke", THREE.NormalBlending);
  let acc = 0;
  function emit(sys, x, y, z, vx, vy, vz, life, size) { if (sys.p.length < N) sys.p.push({ x, y, z, vx, vy, vz, life, age: 0, size }); }
  function update(dt, w, cam, H) {
    flame.mat.uniforms.scale.value = smoke.mat.uniforms.scale.value = H / (2 * Math.tan(cam.fov * Math.PI / 360));
    acc += dt;
    const cp = cam.position;
    // burning siege engines (js/sim/siege.js) burn like small buildings: footprint from their arm, facing as rot
    const eng = (w.siege?.engines || []).filter((e) => e.fire > 0).map((e) => ({ x: e.x, y: e.y, rot: e.facing, fire: e.fire, fp: ARMS[e.kind]?.eng || [3, 3] }));
    for (const b of eng.length ? [...(w.buildings || []), ...eng] : w.buildings || []) {
      if (!(b.fire > 0)) continue;
      const wall = b.x1 !== undefined, len = wall ? Math.hypot(b.x2 - b.x1, b.y2 - b.y1) : 0; // a wall stretch burns along its LENGTH (the palisade's posts, end to end)
      const bx = wall ? (b.x1 + b.x2) / 2 : b.x, by = wall ? (b.y1 + b.y2) / 2 : b.y; if (Math.hypot(cp.x - bx, -cp.z - by) > 2500 + len / 2) continue; // only fires you could see
      const fp = wall ? [len, 2.2] : b.fp ? [b.fp[1], b.fp[0]] : b.field ? [Math.min(60, b.w || 40), Math.min(60, b.h || 40)] : BUILDINGS[b.kind]?.footprint || [10, 8];
      const rot = wall ? Math.atan2(b.y2 - b.y1, b.x2 - b.x1) : b.rot || 0;
      const g0 = map.h(bx, by), top0 = g0 + (b.field ? 1 : wall ? 4.5 + 2 * b.fire : 6 + fp[1] * 0.25), c = Math.cos(rot), s = Math.sin(rot);
      const rate = (b.field ? 60 : 90) * b.fire * dt * (wall ? Math.min(6, Math.max(1, len / 12)) : 1);
      for (let k = 0; k < rate; k++) {
        const lx = (Math.random() - 0.5) * fp[0], ly = (Math.random() - 0.5) * fp[1], x = bx + lx * c - ly * s, y = by + lx * s + ly * c, g = wall ? map.h(x, y) : g0, top = g + (top0 - g0);
        // the smoke goes downwind (w.wind {x,y} m/s, sim frame → three x,-z; js/sim/weather.js); calm air: the old gentle easterly drift
        const wvx = w.wind ? w.wind.x * 0.55 : 1.2, wvz = w.wind ? -w.wind.y * 0.55 : 0;
        emit(flame, x, g + Math.random() * (top - g), -y, (Math.random() - 0.5) * 0.6 + wvx * 0.15, 2 + Math.random() * 3, (Math.random() - 0.5) * 0.6 + wvz * 0.15, 0.6 + Math.random() * 0.8, 3 + Math.random() * 4 * b.fire);
        if (Math.random() < 0.12) emit(smoke, x, top, -y, wvx + Math.random() * 0.8, 2.2 + Math.random() * 1.5, wvz + (Math.random() - 0.5) * 0.8, 5 + Math.random() * 5, 5);
      }
    }
    // a wood on fire (js/sim/wildfire.js: w.fire.cells, 16 m cells): flames among the trees up into the crowns while the
    // front passes, low flames on the forest floor once they are down, and a tall column of smoke leaning downwind
    const FC = w.fire?.cells;
    if (FC?.length) {
      const near = FC.filter((q) => Math.hypot(cp.x - (q.i + 0.5) * 16, -cp.z - (q.j + 0.5) * 16) < 2500), share = Math.min(1, 140 / Math.max(1, near.length));
      const wvx = w.wind ? w.wind.x * 0.55 : 1.2, wvz = w.wind ? -w.wind.y * 0.55 : 0;
      for (const q of near) {
        const x0 = q.i * 16, y0 = q.j * 16, hh = q.ch ? 1.5 + 2 * q.h : 5 + 12 * q.h;
        let rate = (q.ch ? 22 : 60) * q.h * dt * share; if (Math.random() < rate % 1) rate += 1;
        for (let k = 0; k < (rate | 0); k++) {
          const x = x0 + Math.random() * 16, y = y0 + Math.random() * 16, g = map.h(x, y), z = g + Math.random() ** 1.5 * hh;
          emit(flame, x, z, -y, (Math.random() - 0.5) * 0.8 + wvx * 0.12, 2.5 + Math.random() * 4, (Math.random() - 0.5) * 0.8 + wvz * 0.12, 0.5 + Math.random() * 0.9, (q.ch ? 2.5 : 4) + Math.random() * 5 * q.h);
          if (Math.random() < 0.18) emit(smoke, x, g + hh + 2, -y, wvx + (Math.random() - 0.5), 3 + Math.random() * 2, wvz + (Math.random() - 0.5), 8 + Math.random() * 8, 9 + Math.random() * 6);
        }
      }
    }
    for (const [sys, grow] of [[flame, -1.5], [smoke, 3.2]]) {
      const P = sys.geo.attributes.position.array, S = sys.geo.attributes.size.array, A = sys.geo.attributes.alpha.array;
      let n = 0;
      for (const q of sys.p) {
        q.age += dt; if (q.age >= q.life) continue;
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.size = Math.max(0.5, q.size + grow * dt);
        const t = q.age / q.life;
        P[n * 3] = q.x; P[n * 3 + 1] = q.y; P[n * 3 + 2] = q.z; S[n] = q.size; A[n] = sys === flame ? 1 - t : Math.sin(t * Math.PI) * (1 - t) * 0.9;
        sys.p[n++] = q;
      }
      sys.p.length = n;
      sys.geo.setDrawRange(0, n);
      sys.geo.attributes.position.needsUpdate = sys.geo.attributes.size.needsUpdate = sys.geo.attributes.alpha.needsUpdate = true;
    }
  }
  // a burst of dust where a stone lands (or masonry dust off a struck wall): brown-grey smoke, low and quick
  function dust(x, h, y, size = 1) {
    for (let k = 0; k < 10 * size; k++) emit(smoke, x + (Math.random() - 0.5) * size, h + Math.random() * size * 0.6, -y + (Math.random() - 0.5) * size, (Math.random() - 0.5) * 3 * size, 0.6 + Math.random() * 1.6 * size, (Math.random() - 0.5) * 3 * size, 1.5 + Math.random() * 2.5, 2 + 2 * size);
  }
  return { update, dust };
}
