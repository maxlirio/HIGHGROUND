// Terrain mesh. World (x east, y north, h up) maps to three.js (x, h, -y).
// Shading: baked horizon shadows + slope/height tint now; splat-texture surfaces plug in via
// `setSurfaceTextures` once the terrain-material pipeline delivers them.
import * as THREE from "three";

export const SUN_DIR = new THREE.Vector3(-0.55, 0.67, 0.5).normalize(); // SW sun, ~42° elev (three coords)

// Beyond the playable square the land keeps going: heights and surfaces are MIRRORED across the
// edge (so rivers, fields and woods carry on without a seam), under distance haze. Nobody can walk
// there — the sim clamps to the map — but you never see a hard edge.
const mirror1 = (v, S) => { v = Math.abs(v); const p = v % (2 * S); return p > S ? 2 * S - p : p; };
function hash2(i, j) { let h = (i * 374761393 + j * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  return (hash2(i, j) * (1 - su) + hash2(i + 1, j) * su) * (1 - sv) + (hash2(i, j + 1) * (1 - su) + hash2(i + 1, j + 1) * su) * sv;
}
export const outside = (map, x, y) => Math.max(0, -x, -y, x - map.size, y - map.size);
// Height anywhere, including the endless land beyond the edge: mirrored right at the edge (no seam),
// then increasingly warped + its own rolling hills so no symmetry is ever recognisable.
export function hMirror(map, x, y) {
  const d = outside(map, x, y);
  if (d <= 0) return map.h(x, y);
  const t = Math.min(1, Math.max(0, (d - 60) / 700));
  const wx = x + (vnoise(x * 0.0021, y * 0.0021) - 0.5) * 900 * t, wy = y + (vnoise(x * 0.0021 + 31, y * 0.0021 + 17) - 0.5) * 900 * t;
  const base = map.h(mirror1(wx, map.size), mirror1(wy, map.size));
  const hills = (vnoise(x * 0.0012, y * 0.0012) * 70 + vnoise(x * 0.004, y * 0.004) * 18) * t;
  return base * (1 - 0.35 * t) + hills + 20 * t;
}

function heightGeo(map, x0, y0, x1, y1, seg, sink = null) {
  const geo = new THREE.PlaneGeometry(x1 - x0, y1 - y0, seg, seg);
  geo.rotateX(-Math.PI / 2); // plane in XZ, +z = south
  const pos = geo.attributes.position, shade = new Float32Array(pos.count), sunk = new Uint8Array(pos.count);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k) + cx, y = cy - pos.getZ(k);
    let h = hMirror(map, x, y);
    if (sink && sink(x, y)) { h -= 6; sunk[k] = 1; } // hidden under the detailed inner mesh
    pos.setX(k, x); pos.setZ(k, -y); pos.setY(k, h);
  }
  geo.computeVertexNormals();
  const sd = new THREE.Vector2(SUN_DIR.x, -SUN_DIR.z).normalize(), tanSun = SUN_DIR.y / Math.hypot(SUN_DIR.x, SUN_DIR.z);
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), y = -pos.getZ(k), h0 = pos.getY(k) + 0.5; let lit = 1;
    for (let d = map.cell * 2; d < 900; d *= 1.18) {
      const over = hMirror(map, x + sd.x * d, y + sd.y * d) - (h0 + d * tanSun);
      if (over > 0) { lit = Math.max(0, 1 - over / 6); if (lit === 0) break; }
    }
    shade[k] = lit;
  }
  geo.setAttribute("shadow", new THREE.BufferAttribute(shade, 1));
  if (sink) { // drop the triangles wholly under the inner mesh: never seen, but they'd still be shaded on GPUs without hidden-surface removal
    const idx = geo.index.array, keep = [];
    for (let t = 0; t < idx.length; t += 3) if (!(sunk[idx[t]] && sunk[idx[t + 1]] && sunk[idx[t + 2]])) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    geo.setIndex(keep);
  }
  return geo;
}

export function buildTerrain(map, { maxSeg = 512 } = {}) {
  const seg = Math.min(maxSeg, map.res - 1);
  const geo = heightGeo(map, 0, 0, map.size, map.size, seg);
  const M = map.size * 0.75; // how far the mirrored land extends (always lost in haze before its end)
  const outerGeo = heightGeo(map, -M, -M, map.size + M, map.size + M, 320, (x, y) => x > 8 && y > 8 && x < map.size - 8 && y < map.size - 8);

  const uniforms = {
    sunDir: { value: SUN_DIR }, noiseTex: { value: noiseTexture() }, terrFar: { value: 700 },
    fogTex: { value: null }, fogOn: { value: 0 },
    ovTex: { value: null }, ovOn: { value: 0 },
    mapSize: { value: map.size }, mapRes: { value: map.res },
    time: { value: 0 },
    surfId: { value: dummyU8() }, albedoArr: { value: dummyArr() }, normalArr: { value: dummyArr() }, tileM: { value: new Float32Array(64).fill(4) },
    clearTex: { value: null }, clearOn: { value: 0 }, sandLayer: { value: 0 },
    splatOn: { value: 0 }, wildLayers: { value: new Float32Array([0, 0, 0, 0]) },
    waterTex: { value: null }, waterOn: { value: 0 }, camPos: { value: new THREE.Vector3() },
    mist: { value: 0 }, // valley mist (the Mist spell): 0 clear … 1 thick
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, glslVersion: THREE.GLSL3,
    vertexShader: /* glsl */`
      in float shadow;
      out vec3 vN; out vec3 vW; out float vShadow;
      void main(){ vN = normal; vShadow = shadow; vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */`
      precision highp float; precision highp int; precision highp usampler2D; precision highp sampler2DArray;
      uniform vec3 sunDir; uniform sampler2D fogTex; uniform float fogOn; uniform sampler2D ovTex; uniform float ovOn;
      uniform float mapSize; uniform float mapRes;
      uniform usampler2D surfId; uniform sampler2DArray albedoArr; uniform sampler2DArray normalArr; uniform float tileM[64]; uniform float splatOn; uniform sampler2D clearTex; uniform float clearOn; uniform float sandLayer; uniform float wildLayers[4]; uniform sampler2D waterTex; uniform float waterOn; uniform vec3 camPos; uniform float time; uniform float mist;
      in vec3 vN; in vec3 vW; in float vShadow;
      out vec4 outColor;
      uniform sampler2D noiseTex; uniform float terrFar;
      // value noise / 5-octave fbm, pre-baked into a tileable texture (was ~400 sin-hashes per pixel)
      float vnoise(vec2 p){ return texture(noiseTex, p / 64.).r; }
      float fbm(vec2 p){ return texture(noiseTex, mat2(.8,-.6,.6,.8) * p / 16. + .31).g; }
      // one layer, sampled twice (scale + rotation) and blended by noise → no visible tiling
      float nDetail; // 1 near → 0 beyond terrFar: normal maps fade out where they're sub-pixel anyway
      void layer(int id, vec2 wp, float nz, out vec3 alb, out vec3 nrm){
        float t = tileM[id];
        vec2 uv1 = wp / t;
        vec2 uv2 = mat2(.8,-.6,.6,.8) * wp / (t*2.3) + .37;
        vec3 a1 = texture(albedoArr, vec3(uv1, float(id))).rgb, a2 = texture(albedoArr, vec3(uv2, float(id))).rgb;
        float m = smoothstep(.35,.65,nz);
        alb = mix(a1, a2, m); nrm = vec3(0., 0., 1.);
        if (nDetail > 0.) {
          vec3 n1 = texture(normalArr, vec3(uv1, float(id))).rgb, n2 = texture(normalArr, vec3(uv2, float(id))).rgb;
          nrm = normalize(mix(vec3(0., 0., 1.), normalize(mix(n1, n2, m)*2.-1.), nDetail));
        }
      }
      vec2 mirrorXY(vec2 p){ p = abs(p); vec2 q = mod(p, 2.*mapSize); return mix(q, 2.*mapSize - q, step(mapSize, q)); }
      void main(){
        vec3 n = normalize(vN); float slope = 1. - n.y;
        vec2 wp = vW.xz;
        nDetail = 1. - smoothstep(terrFar * .75, terrFar, length(camPos - vW));
        float big = fbm(wp*0.004), mid = fbm(wp*0.03), fine = fbm(wp*0.35);
        vec3 col; vec3 pn = n;
        if (splatOn > .5) {
          // pick up to 4 surrounding cells; jitter the lookup position so borders are organic
          vec2 g = mirrorXY(vec2(vW.x, -vW.z)) / mapSize * (mapRes-1.);
          g += (vec2(fbm(wp*.012), fbm(wp*.012+17.)) - .5) * 7. + (vec2(fbm(wp*.05), fbm(wp*.05+5.)) - .5) * 3. + (vec2(vnoise(wp*.6), vnoise(wp*.6+9.)) - .5)*.6; // wide, ragged transitions
          vec2 f = fract(g), c0 = floor(g);
          vec3 acc = vec3(0.); vec3 nacc = vec3(0.); float wsum = 0.;
          int ids[4]; float ws[4];
          for (int k = 0; k < 4; k++) {
            vec2 o = vec2(k & 1, k >> 1);
            ivec2 ci = clamp(ivec2(c0 + o), ivec2(0), ivec2(int(mapRes)-1));
            ids[k] = int(texelFetch(surfId, ci, 0).r);
            ws[k] = pow((o.x > .5 ? f.x : 1.-f.x) * (o.y > .5 ? f.y : 1.-f.y), 1.4);
          }
          // cells of the same surface share one lookup (most pixels lie inside a single surface)
          for (int k = 1; k < 4; k++) for (int j = 0; j < k; j++) if (ws[k] > 0. && ids[k] == ids[j] && ws[j] > 0.) { ws[j] += ws[k]; ws[k] = 0.; }
          for (int k = 0; k < 4; k++) {
            if (ws[k] <= 0.) continue;
            vec3 a, nn; layer(ids[k], wp, mid, a, nn);
            acc += a*ws[k]; nacc += nn*ws[k]; wsum += ws[k];
          }
          wsum = max(wsum, 1e-5);
          col = acc / wsum; // albedo array is sampled as sRGB → already linear here
          // broad blend: what the ground is like 10–25 m around bleeds in, so land types melt into each other
          vec3 wide = vec3(0.); float wn = 0.; float wideRot = fbm(wp * .01) * 3.;
          int wid[6]; float wc[6];
          for (int k = 0; k < 6; k++) {
            float a = float(k) * 1.0472 + wideRot;
            vec2 o = vec2(cos(a), sin(a)) * (4. + 3. * vnoise(wp * .02 + float(k)));
            ivec2 ci = clamp(ivec2(floor(g + o)), ivec2(0), ivec2(int(mapRes) - 1));
            wid[k] = int(texelFetch(surfId, ci, 0).r); wc[k] = 1.;
          }
          for (int k = 1; k < 6; k++) for (int j = 0; j < k; j++) if (wc[k] > 0. && wid[k] == wid[j] && wc[j] > 0.) { wc[j] += 1.; wc[k] = 0.; }
          for (int k = 0; k < 6; k++) if (wc[k] > 0.) { wide += texture(albedoArr, vec3(wp / (tileM[wid[k]] * 2.7), float(wid[k]))).rgb * wc[k]; wn += wc[k]; }
          wide /= wn;
          col = mix(col, wide, .38);
          // even out the extremes (pale stubble, dark plough): a real landscape seen from above is low-contrast
          float lum = dot(col, vec3(.3, .59, .11)), tl = mix(lum, .13, .35);
          col *= tl / max(lum, 1e-4);
          col = mix(vec3(dot(col, vec3(.3, .59, .11))), col, .88);
          vec2 wxy = vec2(vW.x, -vW.z);
          float dOut = max(max(-wxy.x, -wxy.y), max(wxy.x - mapSize, wxy.y - mapSize));
          if (dOut > 0.) { // the wild country beyond: pasture, heath, rough grass, woodland floor
            float wt = smoothstep(0., 110., dOut + (fbm(wxy * .012) - .5) * 90.); // ragged, quick hand-over to wild country
            float nA = fbm(wxy * .0016), nB = fbm(wxy * .0045 + 7.);
            int li = nA > .62 ? int(wildLayers[3]) : nA < .36 ? int(wildLayers[1]) : nB > .55 ? int(wildLayers[2]) : int(wildLayers[0]);
            vec3 wa, wn; layer(li, wp, mid, wa, wn);
            col = mix(col, wa, wt); nacc = mix(nacc, wn * wsum, wt);
          }
          col *= .88 + .24*big; // large-scale colour drift
          if (clearOn > .5) { // building sites: sandy, trodden clearings with ragged edges, part of the ground itself
            vec2 cuv = vec2(vW.x, -vW.z) / mapSize;
            float cm = texture(clearTex, cuv).r;
            if (cm > .01) {
              float edge = smoothstep(.25, .75, cm + (fbm(wp * .35) - .5) * .5 + (vnoise(wp * 1.7) - .5) * .15);
              vec3 sa, sn; layer(int(sandLayer), wp, mid, sa, sn);
              vec3 sandy = sa * vec3(1.05, .98, .88) * (.9 + .2 * fine);
              col = mix(col, sandy, edge); nacc = mix(nacc, sn * wsum, edge);
            }
          }
          vec3 tn = normalize(nacc / wsum);
          // tangent space: world x → east, world -z → north (up = y)
          pn = normalize(vec3(n.x + tn.x*.9, n.y, n.z - tn.y*.9) );
          pn = normalize(mix(n, pn, tn.z > 0. ? 1. : 0.));
          // steep ground shows rock regardless of the surface map
          float rockMix = smoothstep(.32,.5, slope + (mid-.5)*.12);
          if (rockMix > 0.) { vec3 ra, rn; layer(${"${ROCK_ID}"}, wp, mid, ra, rn); col = mix(col, ra, rockMix); }
        } else {
          vec3 grass = mix(vec3(.30,.36,.16), vec3(.42,.44,.22), big);
          grass = mix(grass, vec3(.48,.45,.28), smoothstep(.55,.8,mid)*.5);
          vec3 rock = mix(vec3(.42,.40,.36), vec3(.55,.52,.46), fine);
          col = mix(grass, rock, smoothstep(.25,.45, slope + (mid-.5)*.15));
          col *= .85 + .3*fine; col = pow(mix(vec3(dot(col, vec3(.3,.59,.11))), col, .8), vec3(2.2)) * 1.15; // sRGB-ish palette → linear
        }
        float diff = max(dot(pn, sunDir), 0.) * mix(.35, 1., vShadow);
        vec3 lit = col * (vec3(1.,.95,.86)*diff*2.6 + vec3(.55,.62,.72)*.38*(.6+.4*n.y));
        vec2 muv = vec2(vW.x, -vW.z) / mapSize; // world (x,y)/size; data row j = world y
        if (waterOn > .5) {
          vec2 wq = vec2(vW.x, -vW.z); float dO = max(max(-wq.x, -wq.y), max(wq.x - mapSize, wq.y - mapSize));
          float d = texture(waterTex, mirrorXY(wq) / mapSize).r * (1. - smoothstep(20., 60., dO));
          if (d > .02) {
            // murky northern river: brown-green shallows to dark peaty depths, sky reflection at grazing angles
            vec3 V = normalize(camPos - vW);
            vec2 q = wp * .08 + vec2(time*.03, time*.02);
            vec3 wn = normalize(vec3((vnoise(q)-.5)*.25 + (vnoise(q*3.1)-.5)*.1, 1., (vnoise(q+7.)-.5)*.25 + (vnoise(q*3.1+3.)-.5)*.1));
            float fres = .04 + .96*pow(1. - max(dot(V, wn), 0.), 5.);
            vec3 deep = mix(vec3(.030,.045,.040), vec3(.010,.020,.025), smoothstep(.3, 2.5, d));
            vec3 shallow = mix(lit, deep, smoothstep(.02, .6, d));
            vec3 sky = vec3(.30,.38,.46);
            float spec = pow(max(dot(reflect(-sunDir, wn), V), 0.), 120.) * 4.;
            lit = mix(shallow, sky, fres*.5) + vec3(1.,.95,.85)*spec;
            
          }
        }
        bool inside = muv.x >= 0. && muv.y >= 0. && muv.x <= 1. && muv.y <= 1.;
        if (ovOn > .5 && inside) { vec4 o = texture(ovTex, muv); lit = mix(lit, pow(o.rgb, vec3(2.2)), o.a); }
        // valley mist (the Mist spell): pale, thickest in the low ground and with distance, drifting in banks;
        // under the fog of war, so it never uncovers what you haven't seen
        if (mist > .001) { float md = length(camPos - vW); float low = 1. - smoothstep(60., 170., vW.y) * .6;
          float bank = .6 + .8 * vnoise(wp * .006 + vec2(time * .015, 0.));
          float m = (1. - exp(-md * .003)) * low * bank;
          lit = mix(lit, vec3(.52,.56,.58), clamp(m, 0., .85) * mist); }
        if (fogOn > .5) {
          vec2 fo = (vec2(vnoise(wp*.02), vnoise(wp*.02+5.)) - .5) * 30. / mapSize; // wobble the edge
          float px = 1.5 / float(textureSize(fogTex, 0).x);
          float fv = (texture(fogTex, muv+fo).r*2. + texture(fogTex, muv+fo+vec2(px,0)).r + texture(fogTex, muv+fo-vec2(px,0)).r
                    + texture(fogTex, muv+fo+vec2(0,px)).r + texture(fogTex, muv+fo-vec2(0,px)).r) / 6.; // 0 unexplored, .5 explored, 1 visible
          float gy = dot(lit, vec3(.3,.59,.11));
          vec3 remembered = mix(vec3(gy), lit, .35) * .45;
          lit = mix(mix(vec3(.0006), remembered, smoothstep(.15,.45,fv)), lit, smoothstep(.55,.95,fv));
        }
        // aerial perspective: distant land fades into the horizon haze (matters in low views)
        float dist = length(camPos - vW);
        float grazing = 1. - abs(normalize(camPos - vW).y); // looking across the land, not down at it
        lit = mix(lit, vec3(.50,.56,.60), (1. - exp(-dist * .00022)) * grazing * grazing);
        // ACES-ish tonemap then sRGB
        lit = lit*(2.51*lit+.03)/(lit*(2.43*lit+.59)+.14);
        outColor = vec4(pow(clamp(lit,0.,1.), vec3(1./2.2)), 1.);
      }`.replace("${ROCK_ID}", String(0)),
  });
  const mesh = new THREE.Mesh(geo, mat);      // vertices are already in world space
  const outer = new THREE.Mesh(outerGeo, mat);
  // the terrain shader is the costliest per pixel: draw it after the other opaque things (trees, men, buildings)
  // and the inner mesh before the ring, so early-z skips every ground pixel that is already covered
  mesh.renderOrder = 1; outer.renderOrder = 2;
  const group = new THREE.Group(); group.add(outer, mesh);
  return { mesh, outer, group, uniforms, material: mat };
}

// Tileable noise for the terrain shader: R = value noise, lattice period 64 (8 texels a cell);
// G = 5-octave fbm (weights .5 … .03, like the old procedural one), base lattice period 16.
function noiseTexture() {
  const S = 512, data = new Uint8Array(S * S * 4);
  const lattice = (n, seed) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = hash2(i + seed * 7919, seed * 104729 + 17); return a; };
  const sample = (L, n, u, v) => { // u,v in lattice units, periodic in n
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
    const at = (x, y) => L[((y % n + n) % n) * n + ((x % n + n) % n)];
    return (at(i, j) * (1 - su) + at(i + 1, j) * su) * (1 - sv) + (at(i, j + 1) * (1 - su) + at(i + 1, j + 1) * su) * sv;
  };
  const R = lattice(64, 1), O = [0, 1, 2, 3, 4].map((k) => lattice(16 << k, 10 + k));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const k = (y * S + x) * 4;
    data[k] = sample(R, 64, x / S * 64, y / S * 64) * 255;
    let f = 0, a = 0.5; for (let o = 0; o < 5; o++) { const n = 16 << o; f += a * sample(O[o], n, x / S * n, y / S * n); a *= 0.5; }
    data[k + 1] = f * 255; data[k + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}
function dummyU8() {
  const t = new THREE.DataTexture(new Uint8Array(1), 1, 1, THREE.RedIntegerFormat, THREE.UnsignedByteType);
  t.internalFormat = "R8UI"; t.needsUpdate = true; return t;
}
function dummyArr() { const t = new THREE.DataArrayTexture(new Uint8Array(4).fill(128), 1, 1, 1); t.needsUpdate = true; return t; }

// world (x,y) → three.js position
export const toScene = (map, x, y, lift = 0) => new THREE.Vector3(x, map.h(x, y) + lift, -y);
