// Hemi-octahedral impostors: a far tree is ONE camera-facing quad (2 triangles) instead of thousands.
//
// At load time the full-detail (LOD0) tree is rendered once from N×N directions spread over the upper
// hemisphere (hemi-octahedral layout) into two atlases: albedo+coverage and object-space normals.
// At draw time each instance picks the 4 atlas frames nearest to its view direction and blends them
// bilinearly; each frame is re-projected (ray from the camera through the quad onto that frame's plane)
// so neighbouring frames line up instead of ghosting. Lighting is done live from the baked normals with
// the same sun/sky as MeshStandardMaterial, so a far tree matches the near ones and turns correctly with
// its instance rotation. Instances drawn as real meshes nearby are hidden via a per-instance flag.
import * as THREE from "three";

const hemiOctDecode = (a, b) => { // a,b in [-1,1] → unit direction with y ≥ 0
  const x = (a + b) / 2, z = (a - b) / 2, y = 1 - Math.abs(x) - Math.abs(z);
  return new THREE.Vector3(x, y, z).normalize();
};

const BAKE_VS = /* glsl */`
  varying vec2 vUv; varying vec3 vN;
  void main(){ vUv = uv; vN = normal; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }`;
const BAKE_FS = /* glsl */`
  uniform sampler2D map; uniform float hasMap; uniform vec3 color; uniform float alphaTest; uniform float mode;
  varying vec2 vUv; varying vec3 vN;
  void main(){
    vec4 t = hasMap > .5 ? texture2D(map, vUv) : vec4(1.); t.rgb *= color;
    if (t.a < alphaTest) discard;
    if (mode < .5) gl_FragColor = vec4(pow(max(t.rgb, 0.), vec3(1. / 2.2)), 1.); // albedo, sRGB-encoded into 8 bits
    else gl_FragColor = vec4(normalize(vN) * .5 + .5, 1.);                      // object-space normal
  }`;

// parts: [{ geo, mat }] of the full-detail tree (object space). Returns { tex:[albedo, normal], centre, radius, N }.
export function bakeImpostor(renderer, parts, { N = 8, frame = 128 } = {}) {
  const box = new THREE.Box3();
  for (const { geo } of parts) { geo.computeBoundingBox(); box.union(geo.boundingBox); }
  const centre = box.getCenter(new THREE.Vector3()); let r2 = 0;
  for (const { geo } of parts) { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) r2 = Math.max(r2, centre.distanceToSquared(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)))); }
  const R = Math.sqrt(r2) * 1.02;
  const size = N * frame;
  const scene = new THREE.Scene();
  const mats = parts.map(({ geo, mat }) => {
    const m = new THREE.ShaderMaterial({
      vertexShader: BAKE_VS, fragmentShader: BAKE_FS, side: THREE.DoubleSide,
      uniforms: { map: { value: mat.map || null }, hasMap: { value: mat.map ? 1 : 0 }, color: { value: (mat.color || new THREE.Color(1, 1, 1)).clone() }, alphaTest: { value: mat.alphaTest > 0 ? mat.alphaTest : 0.02 }, mode: { value: 0 } },
    });
    scene.add(new THREE.Mesh(geo, m)); return m;
  });
  const cam = new THREE.OrthographicCamera(-R, R, R, -R, 0.01, R * 4);
  const prevRT = renderer.getRenderTarget(), prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha(), prevAuto = renderer.autoClear;
  const out = [];
  for (const mode of [0, 1]) {
    const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    mats.forEach((m) => { m.uniforms.mode.value = mode; });
    renderer.setRenderTarget(rt); renderer.autoClear = false;
    renderer.setClearColor(mode ? new THREE.Color(0.5, 1, 0.5) : new THREE.Color(0.1, 0.12, 0.06), 0); renderer.clear(true, true, true);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const d = hemiOctDecode(((i + 0.5) / N) * 2 - 1, ((j + 0.5) / N) * 2 - 1);
      cam.position.copy(centre).addScaledVector(d, R * 2); cam.up.set(0, 1, 0); cam.lookAt(centre); cam.updateMatrixWorld();
      rt.viewport.set(i * frame, j * frame, frame, frame); rt.scissor.set(i * frame, j * frame, frame, frame); rt.scissorTest = true;
      renderer.setRenderTarget(rt); renderer.clear(false, true, false); renderer.render(scene, cam);
    }
    // copy into a plain mipmapped texture so distant trees minify cleanly (read back once, at load)
    const px = new Uint8Array(size * size * 4); renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
    if (mode === 0) dilate(px, size, frame);
    const t = new THREE.DataTexture(px, size, size, THREE.RGBAFormat);
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4; t.needsUpdate = true;
    out.push(t); rt.dispose();
  }
  renderer.setRenderTarget(prevRT); renderer.setClearColor(prevClear, prevAlpha); renderer.autoClear = prevAuto;
  mats.forEach((m) => m.dispose());
  return { tex: out, centre, radius: R, N };
}
// Bleed colour into transparent texels (within each frame) so mip levels don't pull in the clear colour.
function dilate(px, size, frame) {
  let have = new Uint8Array(size * size); for (let i = 0; i < have.length; i++) have[i] = px[i * 4 + 3] > 0 ? 1 : 0;
  for (let pass = 0; pass < 4; pass++) {
    const next = have.slice();
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x; if (have[i]) continue;
      const fx = x - x % frame, fy = y - y % frame; let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < fx || yy < fy || xx >= fx + frame || yy >= fy + frame) continue;
        const q = yy * size + xx; if (have[q]) { r += px[q * 4]; g += px[q * 4 + 1]; b += px[q * 4 + 2]; n++; }
      }
      if (n) { px[i * 4] = r / n; px[i * 4 + 1] = g / n; px[i * 4 + 2] = b / n; next[i] = 1; }
    }
    have = next;
  }
}

const IMP_VS = /* glsl */`
  #include <common>
  #include <fog_pars_vertex>
  attribute float hidden;
  uniform vec3 centre; uniform float radius; uniform float N;
  varying vec4 vUv01; varying vec4 vUv23; varying vec4 vW; varying vec3 vWorld; varying mat3 vRot;
  vec3 octDir(vec2 ij){ vec2 o = (ij + .5) / N * 2. - 1.; float x = (o.x + o.y) * .5, z = (o.x - o.y) * .5; return normalize(vec3(x, 1. - abs(x) - abs(z), z)); }
  vec2 frameUv(vec2 ij, vec3 camO, vec3 P){
    vec3 d = octDir(ij); vec3 r = normalize(cross(vec3(0., 1., 0.), d)); vec3 u = cross(d, r);
    vec3 D = P - camO; float t = dot(centre - camO, d) / dot(D, d); vec3 L = camO + D * t - centre;
    vec2 uv = clamp(vec2(dot(L, r), dot(L, u)) / (2. * radius) + .5, 0.004, 0.996);
    return (ij + uv) / N;
  }
  void main(){
    if (hidden > .5) { gl_Position = vec4(2., 2., 2., 1.); return; }
    mat3 M = mat3(instanceMatrix); float s2 = dot(M[0], M[0]); vec3 T = instanceMatrix[3].xyz;
    vec3 camO = transpose(M) * (cameraPosition - T) / s2;
    vec3 v = normalize(camO - centre);
    vec3 rgt = cross(vec3(0., 1., 0.), v); rgt = dot(rgt, rgt) < 1e-8 ? vec3(1., 0., 0.) : normalize(rgt);
    vec3 up = cross(v, rgt);
    vec3 P = centre + (rgt * position.x + up * position.y) * radius;
    vec3 vh = normalize(vec3(v.x, max(v.y, 0.), v.z));
    vh /= abs(vh.x) + abs(vh.y) + abs(vh.z);
    vec2 o = vec2(vh.x + vh.z, vh.x - vh.z);
    vec2 g = clamp((o * .5 + .5) * N - .5, 0., N - 1.);
    vec2 i0 = floor(g), f = g - i0, i1 = min(i0 + 1., N - 1.);
    vUv01 = vec4(frameUv(i0, camO, P), frameUv(vec2(i1.x, i0.y), camO, P));
    vUv23 = vec4(frameUv(vec2(i0.x, i1.y), camO, P), frameUv(i1, camO, P));
    vW = vec4((1. - f.x) * (1. - f.y), f.x * (1. - f.y), (1. - f.x) * f.y, f.x * f.y);
    vRot = M / sqrt(s2);
    vec4 wp = instanceMatrix * vec4(P, 1.); vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
const IMP_FS = /* glsl */`
  #include <common>
  #include <fog_pars_fragment>
  uniform sampler2D albedoTex; uniform sampler2D normalTex;
  uniform vec3 sunDir; uniform vec3 sunCol; uniform vec3 skyCol; uniform vec3 groundCol;
  uniform sampler2D fogTex; uniform float fogOn; uniform float mapSize;
  varying vec4 vUv01; varying vec4 vUv23; varying vec4 vW; varying vec3 vWorld; varying mat3 vRot;
  void main(){
    vec4 a0 = texture2D(albedoTex, vUv01.xy), a1 = texture2D(albedoTex, vUv01.zw), a2 = texture2D(albedoTex, vUv23.xy), a3 = texture2D(albedoTex, vUv23.zw);
    float cov = dot(vW, vec4(a0.a, a1.a, a2.a, a3.a));
    // sharpen the (mip-averaged) coverage into a crisp alpha-tested edge
    float alpha = clamp((cov - .42) / max(fwidth(cov), 1e-4) + .5, 0., 1.);
    if (alpha < .5) discard;
    vec3 wa = vec3(vW.x * a0.a, vW.y * a1.a, vW.z * a2.a); float w3 = vW.w * a3.a;
    vec3 alb = (a0.rgb * wa.x + a1.rgb * wa.y + a2.rgb * wa.z + a3.rgb * w3) / max(cov, 1e-4);
    alb = pow(alb, vec3(2.2));
    vec3 n = texture2D(normalTex, vUv01.xy).rgb * wa.x + texture2D(normalTex, vUv01.zw).rgb * wa.y + texture2D(normalTex, vUv23.xy).rgb * wa.z + texture2D(normalTex, vUv23.zw).rgb * w3;
    n = normalize(vRot * (n / max(cov, 1e-4) * 2. - 1.));
    vec3 irr = sunCol * max(dot(n, sunDir), 0.) + mix(groundCol, skyCol, .5 * n.y + .5);
    gl_FragColor = vec4(alb * RECIPROCAL_PI * irr, 1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
    if (fogOn > .5) { float fv = texture2D(fogTex, vec2(vWorld.x, -vWorld.z) / mapSize).r;
      float gy = dot(gl_FragColor.rgb, vec3(.3,.59,.11)); vec3 rem = mix(vec3(gy), gl_FragColor.rgb, .35) * .45;
      gl_FragColor.rgb = mix(mix(vec3(.004), rem, smoothstep(.15,.45,fv)), gl_FragColor.rgb, smoothstep(.55,.95,fv)); }
  }`;

// One material per baked asset; `light` = { sunDir, sun: DirectionalLight-ish {color,intensity}, hemi: {color, groundColor, intensity} }
export function impostorMaterial(bake, light, FOG) {
  const lin = (c, k) => new THREE.Vector3(c.r * k, c.g * k, c.b * k);
  return new THREE.ShaderMaterial({
    vertexShader: IMP_VS, fragmentShader: IMP_FS, fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      centre: { value: bake.centre }, radius: { value: bake.radius }, N: { value: bake.N },
      albedoTex: { value: bake.tex[0] }, normalTex: { value: bake.tex[1] },
      sunDir: { value: light.sunDir }, sunCol: { value: lin(light.sun.color, light.sun.intensity) },
      skyCol: { value: lin(light.hemi.color, light.hemi.intensity) }, groundCol: { value: lin(light.hemi.groundColor, light.hemi.intensity) },
      fogTex: FOG.fogTex, fogOn: FOG.fogOn, mapSize: FOG.mapSize,
    },
  });
}

export function impostorQuad() {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
