// Battle effects that are not men: arrows and bolts in flight, shafts stuck in the ground, dust kicked up by
// horses and falls, lance splinters, and the trampled, bloodied ground where the press stood. Driven by
// js/render/figures.js (which owns the men and the arrows stuck IN them). Everything is instanced and moves on
// the GPU: the CPU only appends a record when something new happens (a shaft loosed or landed, a man down).
//
//   flights      ring buffer: (x0,h0,z0,t0) (x1,h1,z1,t1) (apex, kind, -, -); the vertex shader flies each shaft
//                along its parabola at uniform time and points it down the tangent; outside [t0, t1] it collapses.
//   stuck        ring buffer of shafts in the ground: (x,h,z, depth) + direction; the "stubble field" in front of
//                a line under arrow fire (docs/battle-feel-research.md §4.2) stays for the whole battle.
//   puffs        short-lived dust sprites (points), CPU-integrated (a few hundred at most).
//   chips        splinters / broken lance pieces thrown up, CPU-integrated, then left lying (clutter).
//   patches      ground decals: dark trampled mud where men fought, blood where men fell (ring buffer).
import * as THREE from "three";

const FLIGHT_CAP = 3072, STUCK_CAP = 14000, PATCH_CAP = 2500, PUFF_CAP = 700, CHIP_CAP = 400, CLUTTER_CAP = 600;

function shaftGeometry(len, r, fletch) {
  // a shaft along +Y from 0 (point) to len (nock): two crossed quads, plus two crossed fletching quads at the tail;
  // colour in attribute c (0 = head iron, 1 = wood, 2 = fletching)
  const P = [], C = [], I = [];
  const quad = (a, b, w, col, rot) => {
    const o = P.length / 3, cx = Math.cos(rot), sz = Math.sin(rot);
    P.push(-w * cx, a, -w * sz, w * cx, a, w * sz, w * cx, b, w * sz, -w * cx, b, -w * sz); C.push(col, col, col, col); I.push(o, o + 1, o + 2, o, o + 2, o + 3);
  };
  for (const rot of [0, Math.PI / 2]) { quad(0, 0.07, r * 1.8, 0, rot); quad(0.07, len, r, 1, rot); }
  if (fletch) for (const rot of [0.3, 0.3 + Math.PI / 2]) quad(len - 0.2, len - 0.02, 0.022, 2, rot);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("c", new THREE.Float32BufferAttribute(C, 1)); g.setIndex(I);
  return g;
}

const SHAFT_FRAG = /* glsl */`varying float vC; varying float vL; uniform vec3 sunCol; uniform vec3 amb;
  void main(){ if (vL <= 0.0) discard;
    vec3 col = vC < 0.5 ? vec3(0.22, 0.22, 0.23) : vC < 1.5 ? vec3(0.50, 0.40, 0.26) : vec3(0.84, 0.82, 0.76);
    gl_FragColor = vec4(col * (amb + sunCol * vL), 1.0); }`;
const COMMON = /* glsl */`attribute float c; varying float vC; varying float vL; uniform vec3 sunDir;
  mat3 basisY(vec3 d) { vec3 y = normalize(d); vec3 a = abs(y.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 x = normalize(cross(a, y)); vec3 z = cross(x, y); return mat3(x, y, z); }`;

export function makeBattleFx(scene, map, sunDir) {
  const lightU = { sunDir: { value: sunDir.clone().normalize() }, sunCol: { value: new THREE.Color(0.75, 0.72, 0.64) }, amb: { value: new THREE.Color(0.42, 0.44, 0.46) } };

  // ------------------------------------------------------------ arrows in flight
  const fGeo = new THREE.InstancedBufferGeometry().copy(shaftGeometry(0.8, 0.006, true));
  const fA = new THREE.InstancedBufferAttribute(new Float32Array(FLIGHT_CAP * 4), 4), fB = new THREE.InstancedBufferAttribute(new Float32Array(FLIGHT_CAP * 4), 4),
    fC = new THREE.InstancedBufferAttribute(new Float32Array(FLIGHT_CAP * 4), 4);
  fGeo.setAttribute("fA", fA); fGeo.setAttribute("fB", fB); fGeo.setAttribute("fC", fC); fGeo.instanceCount = 0;
  const fMat = new THREE.ShaderMaterial({
    uniforms: { ...lightU, uTime: { value: 0 } },
    vertexShader: COMMON + /* glsl */`attribute vec4 fA; attribute vec4 fB; attribute vec4 fC; uniform float uTime;
      vec3 at(float u) { vec3 p = mix(fA.xyz, fB.xyz, u); p.y += 4.0 * fC.x * u * (1.0 - u); return p; }
      void main(){ vC = c; float u = (uTime - fA.w) / max(0.05, fB.w - fA.w);
        if (u < 0.0 || u > 1.0) { vL = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        vec3 p = at(u), d = at(min(1.0, u + 0.01)) - at(max(0.0, u - 0.01));
        mat3 B = basisY(-d); float s = fC.y > 0.5 ? 0.55 : 1.0;           // bolts are short and thick
        float far = max(1.0, distance(p, cameraPosition) / 22.0);           // a volley must read as streaks from afar
        vec3 lp = position; lp.y *= s * min(2.5, 0.5 + far * 0.5); lp.xz *= (fC.y > 0.5 ? 1.8 : 1.0) * far;
        vec3 wp = p + B * lp; vL = 0.55 + 0.45 * max(0.0, dot(normalize(B[0]), sunDir));
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); }`,
    fragmentShader: SHAFT_FRAG,
  });
  const fMesh = new THREE.Mesh(fGeo, fMat); fMesh.frustumCulled = false; scene.add(fMesh);
  let fHead = 0, fMax = 0;
  function flight(x0, h0, y0, t0, x1, h1, y1, t1, apex, bolt) {
    const k = fHead++ % FLIGHT_CAP, o = k * 4; fMax = Math.min(FLIGHT_CAP, Math.max(fMax, k + 1));
    fA.array.set([x0, h0, -y0, t0], o); fB.array.set([x1, h1, -y1, t1], o); fC.array.set([apex, bolt ? 1 : 0, 0, 0], o);
    for (const a of [fA, fB, fC]) { a.addUpdateRange(o, 4); a.needsUpdate = true; }
    fGeo.instanceCount = fMax;
  }

  // ------------------------------------------------------------ shafts stuck in the ground
  const sGeo = new THREE.InstancedBufferGeometry().copy(shaftGeometry(0.8, 0.006, true));
  const sA = new THREE.InstancedBufferAttribute(new Float32Array(STUCK_CAP * 4), 4), sB = new THREE.InstancedBufferAttribute(new Float32Array(STUCK_CAP * 4), 4);
  sGeo.setAttribute("sA", sA); sGeo.setAttribute("sB", sB); sGeo.instanceCount = 0;
  const sMat = new THREE.ShaderMaterial({
    uniforms: { ...lightU, camPos: { value: new THREE.Vector3() } },
    vertexShader: COMMON + /* glsl */`attribute vec4 sA; attribute vec4 sB; uniform vec3 camPos;
      void main(){ vC = c; if (distance(sA.xyz, camPos) > 160.0) { vL = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        mat3 B = basisY(-sB.xyz); float s = sB.w > 0.5 ? 0.55 : 1.0; vec3 lp = position; lp.y = lp.y * s - sA.w; lp.xz *= (sB.w > 0.5 ? 1.8 : 1.0);
        vec3 wp = sA.xyz + B * lp; vL = 0.55 + 0.45 * max(0.0, dot(normalize(B[0]), sunDir));
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0); }`,
    fragmentShader: SHAFT_FRAG,
  });
  const sMesh = new THREE.Mesh(sGeo, sMat); sMesh.frustumCulled = false; scene.add(sMesh);
  let sHead = 0, sMax = 0;
  function stick(x, h, y, dx, dy, dz, depth, bolt) {
    // (dx, dy, dz): the direction of flight in three.js axes (dy < 0 = coming down)
    const k = sHead++ % STUCK_CAP, o = k * 4; sMax = Math.min(STUCK_CAP, Math.max(sMax, k + 1));
    sA.array.set([x, h, -y, depth], o); sB.array.set([dx, dy, dz, bolt ? 1 : 0], o);
    for (const a of [sA, sB]) { a.addUpdateRange(o, 4); a.needsUpdate = true; }
    sGeo.instanceCount = sMax;
  }

  // ------------------------------------------------------------ ground patches (trampled mud, blood)
  const pGeo = new THREE.InstancedBufferGeometry();
  pGeo.setAttribute("position", new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3)); pGeo.setIndex([0, 2, 1, 0, 3, 2]);
  const pA = new THREE.InstancedBufferAttribute(new Float32Array(PATCH_CAP * 4), 4), pB = new THREE.InstancedBufferAttribute(new Float32Array(PATCH_CAP * 4), 4);
  pGeo.setAttribute("pA", pA); pGeo.setAttribute("pB", pB); pGeo.instanceCount = 0;
  const pMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */`attribute vec4 pA; attribute vec4 pB; varying vec2 vQ; varying vec4 vB; uniform float uTime;
      void main(){ vQ = position.xz; vB = pB; float cr = cos(pB.z), sr = sin(pB.z);
        vec2 q = vec2(cr * position.x - sr * position.z, sr * position.x + cr * position.z) * pA.w;
        vB.w = clamp((uTime - pB.w) / 3.0, 0.0, 1.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(pA.x + q.x, pA.y + 0.05, pA.z + q.y, 1.0); }`,
    fragmentShader: /* glsl */`varying vec2 vQ; varying vec4 vB;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+1.0), f.x), f.y); }
      void main(){ float r = length(vQ); float e = n(vQ * 3.0 + vB.y * 17.0) * 0.45 + n(vQ * 7.0 - vB.y * 5.0) * 0.2;
        float a = (1.0 - smoothstep(0.35, 1.0, r + e * 0.6 - 0.2)) * vB.w; if (a < 0.02) discard;
        vec3 mud = vec3(0.16, 0.13, 0.09), blood = vec3(0.17, 0.05, 0.035);
        vec3 col = mix(mud, blood, vB.x * smoothstep(0.35, 0.8, n(vQ * 5.0 + vB.y * 3.0) + 0.15));
        gl_FragColor = vec4(col, a * (vB.x > 0.5 ? 0.45 : 0.32)); }`,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
  });
  const pMesh = new THREE.Mesh(pGeo, pMat); pMesh.frustumCulled = false; pMesh.renderOrder = 1; scene.add(pMesh);
  let pHead = 0, pMax = 0;
  function patch(x, y, size, blood, t) {
    const k = pHead++ % PATCH_CAP, o = k * 4; pMax = Math.min(PATCH_CAP, Math.max(pMax, k + 1));
    pA.array.set([x, map.h(x, y), -y, size], o); pB.array.set([blood ? 1 : 0, Math.random() * 10, Math.random() * 6.3, t], o);
    for (const a of [pA, pB]) { a.addUpdateRange(o, 4); a.needsUpdate = true; }
    pGeo.instanceCount = pMax;
  }

  // ------------------------------------------------------------ dust puffs (points)
  const dGeo = new THREE.BufferGeometry();
  const dP = new Float32Array(PUFF_CAP * 3), dS = new Float32Array(PUFF_CAP * 2);
  dGeo.setAttribute("position", new THREE.BufferAttribute(dP, 3).setUsage(THREE.DynamicDrawUsage)); dGeo.setAttribute("sa", new THREE.BufferAttribute(dS, 2).setUsage(THREE.DynamicDrawUsage));
  const dMat = new THREE.ShaderMaterial({
    uniforms: { pxPerM: { value: 600 } },
    vertexShader: /* glsl */`attribute vec2 sa; varying float vA; uniform float pxPerM;
      void main(){ vA = sa.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = min(256.0, sa.x * pxPerM / max(1.0, -mv.z)); }`,
    fragmentShader: /* glsl */`varying float vA; void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float r = dot(q, q); if (r > 1.0) discard;
      gl_FragColor = vec4(0.52, 0.46, 0.36, vA * (1.0 - r) * (1.0 - r) * 0.42); }`,
    transparent: true, depthWrite: false,
  });
  const dMesh = new THREE.Points(dGeo, dMat); dMesh.frustumCulled = false; dMesh.renderOrder = 2; scene.add(dMesh);
  const puffs = [];
  function puff(x, h, y, size = 1, n = 3, up = 0.6) {
    for (let k = 0; k < n && puffs.length < PUFF_CAP; k++)
      puffs.push({ x: x + (Math.random() - 0.5) * size, y: h + 0.2 + Math.random() * 0.3 * size, z: -y + (Math.random() - 0.5) * size,
        vx: (Math.random() - 0.5) * 1.2, vy: up * (0.4 + Math.random()), vz: (Math.random() - 0.5) * 1.2, age: 0, life: 1.2 + Math.random() * 1.6, s: size * (1.2 + Math.random()) });
  }

  // ------------------------------------------------------------ splinters, broken lances (thrown up, then clutter)
  const cGeo = new THREE.BoxGeometry(0.035, 0.035, 1);
  const cMat = new THREE.MeshStandardMaterial({ color: "#8a6a44", roughness: 0.9 });
  const chipsMesh = new THREE.InstancedMesh(cGeo, cMat, CHIP_CAP + CLUTTER_CAP); chipsMesh.count = 0; chipsMesh.frustumCulled = false; scene.add(chipsMesh);
  const chips = [], clutter = []; const tmp = new THREE.Object3D();
  function splinters(x, h, y, dx, dy, n = 6, lance = true) {
    // a shattered lance: the rear part of the shaft falls where it broke (and stays), a few short splinters fly
    for (let k = 0; k < n && chips.length < CHIP_CAP; k++) {
      const big = lance && k === 0, sp = big ? 1 : 1.5 + Math.random() * 2;
      chips.push({ x, y: h, z: -y, vx: dx * sp + (Math.random() - 0.5) * 1.5, vy: big ? 0.5 : 1 + Math.random() * 2.2, vz: -dy * sp + (Math.random() - 0.5) * 1.5,
        rx: Math.random() * 6, ry: Math.random() * 6, wx: (Math.random() - 0.5) * (big ? 4 : 16), wy: (Math.random() - 0.5) * (big ? 3 : 12), len: big ? 1.2 + Math.random() * 0.8 : 0.08 + Math.random() * 0.2, g: map.h(x, y), age: 0, keep: big });
    }
  }

  function update(t, dt, cam, H) {
    fMat.uniforms.uTime.value = t; pMat.uniforms.uTime.value = t; sMat.uniforms.camPos.value.copy(cam.position);
    dMat.uniforms.pxPerM.value = H / (2 * Math.tan(cam.fov * Math.PI / 360));
    // dust
    let n = 0;
    for (const q of puffs) {
      q.age += dt; if (q.age > q.life) continue;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.vy *= 0.97;
      const f = q.age / q.life; dP[n * 3] = q.x; dP[n * 3 + 1] = q.y; dP[n * 3 + 2] = q.z; dS[n * 2] = q.s * (0.6 + f); dS[n * 2 + 1] = Math.sin(f * Math.PI) * (1 - f * 0.5);
      puffs[n++] = q;
    }
    puffs.length = n; dGeo.setDrawRange(0, n); dGeo.attributes.position.needsUpdate = dGeo.attributes.sa.needsUpdate = true;
    // splinters: fly, fall, the big lance pieces stay on the ground
    let m = 0;
    for (const c of chips) {
      c.age += dt; c.vy -= 9.8 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt; c.rx += c.wx * dt; c.ry += c.wy * dt;
      if (c.y < c.g + 0.03) { if (c.keep) { if (clutter.length < CLUTTER_CAP) clutter.push({ x: c.x, y: c.g + 0.03, z: c.z, ry: c.ry, len: c.len }); continue; } if (c.age > 1.5) continue; c.y = c.g + 0.03; c.vx *= 0.4; c.vz *= 0.4; c.vy = Math.abs(c.vy) * 0.2; }
      chips[m++] = c;
    }
    chips.length = m;
    let k = 0;
    for (const c of chips) { tmp.position.set(c.x, c.y, c.z); tmp.rotation.set(c.rx, c.ry, 0); tmp.scale.set(1, 1, c.len); tmp.updateMatrix(); chipsMesh.setMatrixAt(k++, tmp.matrix); }
    for (const c of clutter) { tmp.position.set(c.x, c.y, c.z); tmp.rotation.set(0, c.ry, 0); tmp.scale.set(1.3, 1.3, c.len); tmp.updateMatrix(); chipsMesh.setMatrixAt(k++, tmp.matrix); }
    chipsMesh.count = k; chipsMesh.instanceMatrix.needsUpdate = true;
  }
  const stats = () => ({ flights: fGeo.instanceCount, stuck: sGeo.instanceCount, patches: pGeo.instanceCount, puffs: puffs.length, chips: chips.length, clutter: clutter.length });
  return { flight, stick, patch, puff, splinters, update, stats };
}
