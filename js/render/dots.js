// Soldier dots: one GPU point per fighter, sized in pixels so they stay readable at any zoom.
import * as THREE from "three";
import { S_FLEE, S_DOWN } from "../sim/soldiers.js";

// up to eight houses (the Realm): the first two are the single-player sides; main.js paints each from its banner
export const TEAM = ["#3d74cc", "#cc3d39", "#3d9a4a", "#d9a927", "#e9e4d6", "#3a3a3a", "#8a4ab0", "#d9772a"].map((c) => new THREE.Color(c));
const SEL = new THREE.Color("#ffd35a");

export function makeDots(cap = 8192) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 3), sz = new Float32Array(cap), fd = new Float32Array(cap);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("size", new THREE.BufferAttribute(sz, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("fade", new THREE.BufferAttribute(fd, 1).setUsage(THREE.DynamicDrawUsage)); // 1 = drawn as a figure instead
  const mat = new THREE.ShaderMaterial({
    uniforms: { pxPerM: { value: 1 }, dpr: { value: 1 } },
    vertexShader: /* glsl */`
      attribute float size; attribute vec3 color; attribute float fade; uniform float pxPerM; uniform float dpr; varying vec3 vC; varying float vF;
      void main(){ vC = color; vF = fade; vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv;
        float px = size * pxPerM / -mv.z; gl_PointSize = clamp(px, 6.0, 18.0) * dpr; }`,
    fragmentShader: /* glsl */`
      varying vec3 vC; varying float vF;
      void main(){ vec2 p = gl_PointCoord*2.-1.; float r = dot(p,p); if (r > 1.) discard;
        if (vF > 0.001 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) < vF) discard; // cross-fade to the figure
        vec3 c = r > .6 ? vC*.25 : vC; /* dark rim so each man reads against any ground */ gl_FragColor = vec4(pow(c, vec3(1./2.2)), 1.); }`,
    depthTest: true, // men are ON the battlefield: under a canopy you only glimpse them through gaps
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;

  // figFade (optional, per soldier 0..1): how far that man is drawn as a figure (js/render/figures.js)
  function update(w, map, selected, visibleFn, figFade) {
    const S = w.S; let n = 0;
    for (let i = 0; i < S.n; i++) {
      if (!S.alive[i] && S.state[i] !== S_DOWN) continue;
      if (visibleFn && !visibleFn(i)) continue;
      const ff = figFade ? figFade[i] : 0; if (ff >= 0.999) continue;
      pos[n * 3] = S.x[i]; pos[n * 3 + 1] = map.h(S.x[i], S.y[i]) + 1.5; pos[n * 3 + 2] = -S.y[i];
      let c = TEAM[S.team[i]];
      if (selected.has(S.unit[i])) c = SEL;
      let k = S.state[i] === S_DOWN ? 0.35 : S.state[i] === S_FLEE ? 0.7 : 1;
      col[n * 3] = c.r * k; col[n * 3 + 1] = c.g * k; col[n * 3 + 2] = c.b * k;
      sz[n] = S.legend[i] ? 1.0 : 0.65; // a man's real width; the shader keeps a minimum on-screen size
      fd[n] = ff;
      n++;
    }
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = geo.attributes.color.needsUpdate = geo.attributes.size.needsUpdate = geo.attributes.fade.needsUpdate = true;
  }
  return { points, update, material: mat };
}
