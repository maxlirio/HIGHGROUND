// Terrain mesh. World (x east, y north, h up) maps to three.js (x, h, -y).
// Shading: baked horizon shadows + slope/height tint now; splat-texture surfaces plug in via
// `setSurfaceTextures` once the terrain-material pipeline delivers them.
import * as THREE from "three";
import { SEASON } from "./season.js"; // (the flora lane's calendar: the grass goes dun in winter)
import { padGround, padApply, onPads, addPadHost } from "./pads.js"; // (buildings' levelled pads: the ground as drawn round them)

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
export const outside = (map, x, y) => { const X0 = map.x0 || 0, Y0 = map.y0 || 0; return Math.max(0, X0 - x, Y0 - y, x - X0 - map.size, y - Y0 - map.size); };
// Height anywhere, including the endless land beyond the edge: mirrored right at the edge (no seam),
// then increasingly warped + its own rolling hills so no symmetry is ever recognisable.
export { heightGeo, horizonLit, meshSeg };
export function hMirror(map, x, y) {
  const d = outside(map, x, y);
  if (d <= 0) return map.h(x, y);
  const t = Math.min(1, Math.max(0, (d - 60) / 700));
  const wx = x + (vnoise(x * 0.0021, y * 0.0021) - 0.5) * 900 * t, wy = y + (vnoise(x * 0.0021 + 31, y * 0.0021 + 17) - 0.5) * 900 * t;
  const X0 = map.x0 || 0, Y0 = map.y0 || 0, base = map.h(X0 + mirror1(wx - X0, map.size), Y0 + mirror1(wy - Y0, map.size));
  const hills = (vnoise(x * 0.0012, y * 0.0012) * 70 + vnoise(x * 0.004, y * 0.004) * 18) * t;
  return base * (1 - 0.35 * t) + hills + 20 * t;
}

// baked horizon shadow at a ground point: 1 lit … 0 in the shadow of the land toward the sun
const SD = new THREE.Vector2(SUN_DIR.x, -SUN_DIR.z).normalize(), TAN_SUN = SUN_DIR.y / Math.hypot(SUN_DIR.x, SUN_DIR.z);
function horizonLit(map, x, y, h, d0 = map.cell * 2) {
  const h0 = h + 0.5; let lit = 1;
  for (let d = d0; d < 900; d *= 1.18) {
    const over = hMirror(map, x + SD.x * d, y + SD.y * d) - (h0 + d * TAN_SUN);
    if (over > 0) { lit = Math.max(0, 1 - over / 6); if (lit === 0) break; }
  }
  return lit;
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
  for (let k = 0; k < pos.count; k++) shade[k] = horizonLit(map, pos.getX(k), -pos.getZ(k), pos.getY(k));
  geo.setAttribute("shadow", new THREE.BufferAttribute(shade, 1));
  if (sink) { // drop the triangles wholly under the inner mesh: never seen, but they'd still be shaded on GPUs without hidden-surface removal
    const idx = geo.index.array, keep = [];
    for (let t = 0; t < idx.length; t += 3) if (!(sunk[idx[t]] && sunk[idx[t + 1]] && sunk[idx[t + 2]])) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    geo.setIndex(keep);
  }
  return geo;
}

// The ground AS DRAWN under (x, y): the base mesh has a vertex every map.size/seg m (twice map.h's cell on the vale) and
// splits each square along PlaneGeometry's diagonal, so between its vertices it is NOT map.h — on a bump map.h stands
// proud of the drawn turf, in a hollow under it (decimetres). Things set ON the ground (piles, stacks: render/labor.js)
// sample this, so they neither float nor sink. (Inside the map; the castle carve patches are map.h there, not handled.)
// …and where a building stands on a levelled pad (js/render/pads.js) that is what is drawn: men in its yard stand on it.
// Inside a castle's carve patches the ground is the sim's map.h (its levels are measured from it).
const meshSeg = new WeakMap();
export function groundH(map, x, y) { return padGround(x, y, groundBase(map, x, y)); }
export function groundBase(map, x, y) {
  const G = meshSeg.get(map); if (G?.ground) return G.ground(x, y); // (the big world: the chunk under (x, y) — js/render/worldstream.js)
  const seg = G || Math.min(512, map.res - 1), s = map.size / seg, X0 = map.x0 || 0, Y0 = map.y0 || 0;
  const C = map.carves; if (C?.length) for (const K of C) if (x > K.x0 - s && y > K.y0 - s && x < K.x1 + s && y < K.y1 + s) return map.h(x, y); // (setCarves: the patch, out to the mesh's grid lines)
  if (!(x > X0 && y > Y0 && x < X0 + map.size && y < Y0 + map.size)) return hMirror(map, x, y);
  const i = Math.min(seg - 1, Math.floor((x - X0) / s)), j = Math.min(seg - 1, Math.floor((y - Y0) / s)), X = X0 + i * s, Y = Y0 + j * s, u = (x - X) / s, v = (y - Y) / s;
  const hb = map.h(X, Y), hd = map.h(X + s, Y + s);
  // (PlaneGeometry's faces (a, b, d), (b, c, d): the diagonal runs from (X, Y) to (X + s, Y + s) in the sim plane)
  if (v >= u) { const ha = map.h(X, Y + s); return hb + u * (hd - ha) + v * (ha - hb); }
  const hc = map.h(X + s, Y); return hb + u * (hc - hb) + v * (hd - hc);
}
// the lowest drawn ground under a w×d footprint (half extents hx along yaw, hz across) centred at (x, y), sunk a little:
// where a pile's piece rests (its corners and centre sampled; on a slope it sits on its low side, the high side bedded in)
export function restH(map, x, y, yaw, hx, hz, sink = 0.04) {
  const c = Math.cos(yaw), s = Math.sin(yaw); let m = groundH(map, x, y);
  for (const [a, b] of [[hx, hz], [hx, -hz], [-hx, hz], [-hx, -hz], [hx, 0], [-hx, 0]]) m = Math.min(m, groundH(map, x + a * c - b * s, y + a * s + b * c));
  return m - sink;
}
// a LONG piece (a log, a course of boards) lies along the slope instead: → [height at its centre, pitch (rad, + = its +x
// end up)] — each end on the lowest ground across it, the middle never standing proud of a bump, sunk a little
export function restPose(map, x, y, yaw, hx, hz, sink = 0.04) {
  const c = Math.cos(yaw), s = Math.sin(yaw), g = (a, b) => groundH(map, x + a * c - b * s, y + a * s + b * c);
  const e0 = Math.min(g(-hx, hz), g(-hx, -hz), g(-hx, 0)), e1 = Math.min(g(hx, hz), g(hx, -hz), g(hx, 0)), mid = Math.min(g(0, hz), g(0, -hz), g(0, 0));
  const pitch = Math.max(-0.35, Math.min(0.35, Math.atan2(e1 - e0, 2 * hx)));
  return [Math.min((e0 + e1) / 2, mid + 0.05) - sink, pitch];
}

// A pad patch over grid box q ({ i0, j0, i1, j1 } in cells of `step` from (X0, Y0), q.pads): ~0.65 m vertices, the rim on
// the base surface (base(x, y): the mesh's own triangles — linear along its grid lines, so no crack), inside reshaped by
// the pads (js/render/pads.js). Shared by the Vale's mesh (setPads) and the big world's chunks (worldstream.js).
export function padPatchGeometry(map, q, step, X0, Y0, base, PSUB = 12) {
  const nx = (q.i1 - q.i0) * PSUB, ny = (q.j1 - q.j0) * PSUB, d = step / PSUB, x0 = X0 + q.i0 * step, y0 = Y0 + q.j0 * step;
  const P = new Float32Array((nx + 1) * (ny + 1) * 3), sh = new Float32Array((nx + 1) * (ny + 1)), idx = new Uint32Array(nx * ny * 6);
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + i * d, y = y0 + j * d, k = j * (nx + 1) + i;
    let h = base(x, y);
    if (i > 0 && j > 0 && i < nx && j < ny) for (const p of q.pads) h = padApply(p, x, y, h);
    P[k * 3] = x; P[k * 3 + 1] = h; P[k * 3 + 2] = -y;
    sh[k] = horizonLit(map, x, y, h, 1.5);
  }
  let t = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, e = c + 1; idx[t++] = a; idx[t++] = b; idx[t++] = e; idx[t++] = a; idx[t++] = e; idx[t++] = c; }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(P, 3)); g.setAttribute("shadow", new THREE.BufferAttribute(sh, 1)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}
// grid-aligned boxes (cells of `step` from (X0, Y0)) round each pad, merged where they overlap → [{ i0, j0, i1, j1, pads }]
export function padBoxesOf(list, step, X0, Y0) {
  const B = list.map((p) => ({ i0: Math.floor((p.box[0] - X0) / step), j0: Math.floor((p.box[1] - Y0) / step), i1: Math.ceil((p.box[2] - X0) / step), j1: Math.ceil((p.box[3] - Y0) / step), pads: [p] }));
  for (let merged = true; merged;) {
    merged = false;
    for (let a = 0; a < B.length && !merged; a++) for (let b = a + 1; b < B.length; b++) {
      const P = B[a], Q = B[b]; if (P.i0 < Q.i1 && Q.i0 < P.i1 && P.j0 < Q.j1 && Q.j0 < P.j1) {
        B[a] = { i0: Math.min(P.i0, Q.i0), j0: Math.min(P.j0, Q.j0), i1: Math.max(P.i1, Q.i1), j1: Math.max(P.j1, Q.j1), pads: P.pads.concat(Q.pads) }; B.splice(b, 1); merged = true; break;
      }
    }
  }
  for (const q of B) q.sig = `${q.i0},${q.j0},${q.i1},${q.j1}|` + q.pads.map((p) => `${p.id}:${p.P}:${p.x}:${p.y}:${p.rot}:${p.a0}:${p.a1}:${p.b0}:${p.b1}`).sort().join("|");
  return B;
}

// outer: false — the big world (docs/big-world.md) draws the land round this square itself (js/render/worldstream.js), so
// no mirrored ring is built; the mesh covers the map's own square [x0, x0 + size]²
export function buildTerrain(map, { maxSeg = 512, outer: withOuter = true } = {}) {
  const seg = Math.min(maxSeg, map.res - 1); meshSeg.set(map, seg);
  const X0 = map.x0 || 0, Y0 = map.y0 || 0;
  const geo = heightGeo(map, X0, Y0, X0 + map.size, Y0 + map.size, seg);
  const M = map.size * 0.75; // how far the mirrored land extends (always lost in haze before its end)
  const outerGeo = withOuter ? heightGeo(map, X0 - M, Y0 - M, X0 + map.size + M, Y0 + map.size + M, 320, (x, y) => x > X0 + 8 && y > Y0 + 8 && x < X0 + map.size - 8 && y < Y0 + map.size - 8) : new THREE.BufferGeometry();

  const uniforms = {
    sunDir: { value: SUN_DIR }, noiseTex: { value: noiseTexture() }, terrFar: { value: 700 },
    fogTex: { value: null }, fogOn: { value: 0 },
    ovTex: { value: null }, ovOn: { value: 0 },
    mapSize: { value: map.size }, mapRes: { value: map.res },
    // the surface/water data this mesh reads (x0, y0, cell m, res; .. and whether it is node-centred: the big world's tiles) and
    // the WORLD the fog, the clearings and the overlays cover (x0, y0, size): the Vale alone has both at its own square
    dataBox: { value: new THREE.Vector4(map.x0 || 0, map.y0 || 0, map.cell, map.res) }, dataMode: { value: 0 },
    worldBox: { value: new THREE.Vector3(map.x0 || 0, map.y0 || 0, map.size) },
    time: { value: 0 },
    surfId: { value: dummyU8() }, albedoArr: { value: dummyArr() }, normalArr: { value: dummyArr() }, tileM: { value: new Float32Array(64).fill(4) },
    clearTex: { value: null }, clearOn: { value: 0 }, sandLayer: { value: 0 },
    splatOn: { value: 0 }, wildLayers: { value: new Float32Array([0, 0, 0, 0]) },
    waterTex: { value: null }, waterOn: { value: 0 }, camPos: { value: new THREE.Vector3() },
    mist: { value: 0 }, // valley mist (the Mist spell): 0 clear … 1 thick
    wet: { value: 0 },  // ground wetness (rain, js/sim/weather.js w.wx.wet): darkens the ground, grazing sheen, puddle glints
    snow: { value: 0 }, // lying snow 0..1: whitens open ground, thinner on steep faces
    dormant: SEASON.ground, // grass gone dormant 0..1 (js/render/season.js, flora lane): green turf → straw/dun; snow lies over it
    moatTex: { value: dummyF() }, moatOn: { value: 0 }, moatBox: { value: new THREE.Vector4(0, 0, 1, 1) }, // castle ditches and moats (setCarves)
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
      uniform float mapSize; uniform float mapRes; uniform vec4 dataBox; uniform float dataMode; uniform vec3 worldBox;
      uniform usampler2D surfId; uniform sampler2DArray albedoArr; uniform sampler2DArray normalArr; uniform float tileM[64]; uniform float splatOn; uniform sampler2D clearTex; uniform float clearOn; uniform float sandLayer; uniform float wildLayers[4]; uniform sampler2D waterTex; uniform float waterOn; uniform vec3 camPos; uniform float time; uniform float mist; uniform float wet; uniform float snow; uniform float dormant;
      uniform sampler2D moatTex; uniform float moatOn; uniform vec4 moatBox;
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
      // world (x, y) → the data grid's cell coordinates (mirrored past the edges of a square map; clamped on a tile, dataMode 1)
      vec2 dataG(vec2 p){ vec2 q = p - dataBox.xy; return dataMode > .5 ? q / dataBox.z : mirrorXY(q) / mapSize * (mapRes - 1.); }
      void main(){
        vec3 n = normalize(vN); float slope = 1. - n.y;
        vec2 wp = vW.xz;
        nDetail = 1. - smoothstep(terrFar * .75, terrFar, length(camPos - vW));
        float big = fbm(wp*0.004), mid = fbm(wp*0.03), fine = fbm(wp*0.35);
        vec3 col; vec3 pn = n;
        vec4 moatT = vec4(0.); // (setCarves: R water depth, G bare rock, B raw earth)
        if (moatOn > .5) { vec2 mq = (vec2(vW.x, -vW.z) - moatBox.xy) * moatBox.zw; if (mq.x > 0. && mq.y > 0. && mq.x < 1. && mq.y < 1.) moatT = texture(moatTex, mq); }
        if (splatOn > .5) {
          // pick up to 4 surrounding cells; jitter the lookup position so borders are organic
          vec2 g = dataG(vec2(vW.x, -vW.z));
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
          vec2 wxy = vec2(vW.x, -vW.z) - worldBox.xy;
          float dOut = max(max(-wxy.x, -wxy.y), max(wxy.x - worldBox.z, wxy.y - worldBox.z));
          if (dOut > 0.) { // the wild country beyond: pasture, heath, rough grass, woodland floor
            float wt = smoothstep(0., 110., dOut + (fbm(wxy * .012) - .5) * 90.); // ragged, quick hand-over to wild country
            float nA = fbm(wxy * .0016), nB = fbm(wxy * .0045 + 7.);
            int li = nA > .62 ? int(wildLayers[3]) : nA < .36 ? int(wildLayers[1]) : nB > .55 ? int(wildLayers[2]) : int(wildLayers[0]);
            vec3 wa, wn; layer(li, wp, mid, wa, wn);
            col = mix(col, wa, wt); nacc = mix(nacc, wn * wsum, wt);
          }
          col *= .88 + .24*big; // large-scale colour drift
          if (clearOn > .5) { // building sites: sandy, trodden clearings with ragged edges, part of the ground itself
            vec2 cuv = (vec2(vW.x, -vW.z) - worldBox.xy) / worldBox.z;
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
          // a castle's ditch: the bare rock of a rock-cut one, the raw earth of a dug one or of a filled causeway
          if (moatT.g > .01) { // (the faces are near vertical: the rock is projected on them, not smeared down them from above)
            vec2 fa = normalize(vec2(-n.z, n.x) + 1e-5); vec2 fuv = vec2(dot(wp, fa), vW.y * 1.4);
            vec3 ra, rn; layer(${"${ROCK_ID}"}, mix(wp, fuv, smoothstep(.25, .6, slope)) * 1.3, fine, ra, rn); col = mix(col, ra * vec3(.5, .48, .44) * (.75 + .5 * mid), moatT.g); }
          if (moatT.b > .01) col = mix(col, vec3(.052, .04, .028) * (.7 + .6 * fine) * (.8 + .4 * mid), moatT.b);
        } else {
          vec3 grass = mix(vec3(.30,.36,.16), vec3(.42,.44,.22), big);
          grass = mix(grass, vec3(.48,.45,.28), smoothstep(.55,.8,mid)*.5);
          vec3 rock = mix(vec3(.42,.40,.36), vec3(.55,.52,.46), fine);
          col = mix(grass, rock, smoothstep(.25,.45, slope + (mid-.5)*.15));
          col *= .85 + .3*fine; col = pow(mix(vec3(dot(col, vec3(.3,.59,.11))), col, .8), vec3(2.2)) * 1.15; // sRGB-ish palette → linear
        }
        // weather on the ground (js/sim/weather.js): rain-dark earth, snow on the open land
        if (wet > .01) col *= 1. - .32 * wet * (1. - slope);
        if (dormant > .01) { // winter turf: the green drains to straw, dun and grey-brown (bare earth and rock only a little)
          float gl = dot(col, vec3(.3,.59,.11)), gr = clamp((col.g - max(col.r * .9, col.b * 1.1)) / max(gl, 1e-3) * 2.2, 0., 1.);
          vec3 dun = mix(vec3(1.1,.97,.76), vec3(.9,.84,.76), big) * gl * (.95 + .25 * fine);
          col = mix(col, dun, dormant * (.25 + .7 * gr)); }
        if (snow > .01) { float sc = snow * mix(.55, 1., smoothstep(.8, .45, slope)) * (.85 + .15 * fine); col = mix(col, vec3(.78,.81,.88), clamp(sc, 0., 1.)); } // uniform cover, thinner only on true rock faces (no banding on the hillsides)
        float diff = max(dot(pn, sunDir), 0.) * mix(.35, 1., vShadow);
        vec3 lit = col * (vec3(1.,.95,.86)*diff*2.6 + vec3(.55,.62,.72)*.38*(.6+.4*n.y));
        if (wet > .01) { vec3 Vw = normalize(camPos - vW);
          float sheen = pow(max(dot(reflect(-sunDir, pn), Vw), 0.), 24.) * .3;         // the low sun off wet ground
          float pud = smoothstep(.05, .0, slope) * smoothstep(.72, .95, vnoise(wp * .33)); // standing water: small pools in the flattest ground
          lit += vec3(.85,.9,1.) * sheen * wet * (1. - slope) * nDetail;               // (near views only: from the eagle it read as pale blotches)
          lit = mix(lit, lit * vec3(.45,.55,.75) + vec3(.012,.018,.03), pud * wet * .55 * nDetail); } // darker, faintly sky-blue water
        vec2 muv = (vec2(vW.x, -vW.z) - worldBox.xy) / worldBox.z; // world (x,y) over the world's extent; data row j = world y
        if (waterOn > .5 || moatT.r > 0.) {
          vec2 wq = vec2(vW.x, -vW.z) - worldBox.xy; float dO = max(max(-wq.x, -wq.y), max(wq.x - worldBox.z, wq.y - worldBox.z));
          vec2 wuv = dataMode > .5 ? ((vec2(vW.x, -vW.z) - dataBox.xy) / dataBox.z + .5) / dataBox.w : mirrorXY(vec2(vW.x, -vW.z) - dataBox.xy) / mapSize; // (a tile: node-centred)
          float d = waterOn > .5 ? texture(waterTex, wuv).r * (1. - smoothstep(20., 60., dO)) : 0.;
          d = max(d, moatT.r); // a castle's moat: the river's own water
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
          vec2 fo = (vec2(vnoise(wp*.02), vnoise(wp*.02+5.)) - .5) * 30. / worldBox.z; // wobble the edge
          float px = 1.5 / float(textureSize(fogTex, 0).x);
          vec2 fuv = vec2(vW.x, -vW.z) / worldBox.z; // (the fog texture: world/size, wrapping — the big world's grid is stored turned round by its corner: main.js fogUpload)
          float fv = (texture(fogTex, fuv+fo).r*2. + texture(fogTex, fuv+fo+vec2(px,0)).r + texture(fogTex, fuv+fo-vec2(px,0)).r
                    + texture(fogTex, fuv+fo+vec2(0,px)).r + texture(fogTex, fuv+fo-vec2(0,px)).r) / 6.; // 0 unexplored, .5 explored, 1 visible
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
      }`.replaceAll("${ROCK_ID}", String(0)),
  });
  const mesh = new THREE.Mesh(geo, mat);      // vertices are already in world space
  const outer = new THREE.Mesh(outerGeo, mat); outer.visible = withOuter;
  // the terrain shader is the costliest per pixel: draw it after the other opaque things (trees, men, buildings)
  // and the inner mesh before the ring, so early-z skips every ground pixel that is already covered
  mesh.renderOrder = 1; outer.renderOrder = 2;
  const group = new THREE.Group(); group.add(outer, mesh);
  // ---- a castle's ditches and moats (js/sim/earthworks.js: map.carves): the base mesh (one vertex every ~8 m) cannot
  // show a 10 m ditch, so over each castle it gives way to a fine patch (~1 m) cut exactly to its grid lines. The
  // patch's rim vertices lie on the base mesh's edges at the base mesh's own heights, so there is no crack; inside
  // it the ground is map.h (the sim's cut) + the carve's render offset (the channel runs on under a gate's bridge).
  // A moat's water is a sheet over it in the terrain shader's own river water (moatTex R). Rebuilt when map.carveVer changes.
  const fullIndex = geo.index.array.slice(), step = map.size / seg, SUB = 8;
  let patches = [], carveBoxes = [], padBoxes = [];
  // the base mesh loses its triangles under the patches (the boxes lie on its grid lines: a triangle is wholly in or out)
  let holeMask = null;
  function cutHoles() {
    const pos = geo.attributes.position, boxes = carveBoxes.concat(padBoxes), X0 = map.x0 || 0, Y0 = map.y0 || 0;
    if (!boxes.length) { geo.setIndex(new THREE.BufferAttribute(fullIndex.slice(), 1)); return; }
    // (the boxes lie on the grid: mark their cells, then keep each triangle whose cell is unmarked)
    const M = holeMask ||= new Uint8Array(seg * seg); M.fill(0);
    for (const B of boxes) for (let j = Math.max(0, Math.round((B[1] - Y0) / step)); j < Math.min(seg, Math.round((B[3] - Y0) / step)); j++) for (let i = Math.max(0, Math.round((B[0] - X0) / step)); i < Math.min(seg, Math.round((B[2] - X0) / step)); i++) M[j * seg + i] = 1;
    const keep = new Uint32Array(fullIndex.length); let n = 0;
    for (let q = 0; q < fullIndex.length; q += 3) {
      const a = fullIndex[q], b = fullIndex[q + 1], c = fullIndex[q + 2];
      const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, cy = -(pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
      const i = Math.floor((cx - X0) / step), j = Math.floor((cy - Y0) / step);
      if (i >= 0 && j >= 0 && i < seg && j < seg && M[j * seg + i]) continue;
      keep[n++] = a; keep[n++] = b; keep[n++] = c;
    }
    geo.setIndex(new THREE.BufferAttribute(keep.slice(0, n), 1));
  }
  // ---- buildings' levelled pads (js/render/pads.js): like the carves, a fine patch (~0.65 m) over each pad and the banks
  // round it, cut to the base mesh's grid lines with its own heights on the rim (no crack); inside, the base mesh's ground
  // (groundBase) reshaped by every pad there. Pads whose boxes touch are drawn as one patch.
  const X0m = map.x0 || 0, Y0m = map.y0 || 0;
  let padPatches = [], lastPads = [], padCache = new Map(); // (patches kept by what they were built from: a sync that changes one pad rebuilds one patch)
  const padHost = (p) => p.box[0] > X0m + step && p.box[1] > Y0m + step && p.box[2] < X0m + map.size - step && p.box[3] < Y0m + map.size - step
    && !carveBoxes.some((B) => p.box[0] < B[2] + step && B[0] - step < p.box[2] && p.box[1] < B[3] + step && B[1] - step < p.box[3]);
  function setPads(list) {
    lastPads = list;
    const was = padCache; padCache = new Map(); padPatches = [];
    const B = padBoxesOf(list.filter(padHost), step, X0m, Y0m); // (grid-aligned, merged where they overlap)
    padBoxes = B.map((q) => [X0m + q.i0 * step, Y0m + q.j0 * step, X0m + q.i1 * step, Y0m + q.j1 * step]);
    for (const q of B) {
      const sig = q.sig, old = was.get(sig); if (old) { was.delete(sig); padCache.set(sig, old); padPatches.push(old); continue; }
      const g = padPatchGeometry(map, q, step, X0m, Y0m, (x, y) => groundBase(map, x, y));
      const m = new THREE.Mesh(g, mat); m.renderOrder = 1; m.userData.pad = 1; group.add(m); padPatches.push(m); padCache.set(sig, m);
    }
    for (const m of was.values()) { group.remove(m); m.geometry.dispose(); }
    cutHoles();
  }
  addPadHost(padHost); onPads(setPads);
  function setCarves(list) {
    for (const p of patches) { group.remove(p); p.geometry.dispose(); } patches = [];
    const boxes = [];
    for (const K of list || []) {
      const i0 = Math.max(0, Math.floor(K.x0 / step)), i1 = Math.min(seg, Math.ceil(K.x1 / step)), j0 = Math.max(0, Math.floor(K.y0 / step)), j1 = Math.min(seg, Math.ceil(K.y1 / step));
      if (i1 <= i0 || j1 <= j0) continue;
      boxes.push([i0 * step, j0 * step, i1 * step, j1 * step]);
      const nx = (i1 - i0) * SUB, ny = (j1 - j0) * SUB, d = step / SUB, X0 = i0 * step, Y0 = j0 * step;
      const P = new Float32Array((nx + 1) * (ny + 1) * 3), sh = new Float32Array((nx + 1) * (ny + 1)), idx = new Uint32Array(nx * ny * 6);
      const hb = (x, y) => map.h(x, y); // at base-mesh nodes (never inside a carve: its box is aligned outward)
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
        const x = X0 + i * d, y = Y0 + j * d, k = j * (nx + 1) + i; let h;
        if (j === 0 || j === ny) { const a = Math.floor(i / SUB), t = (i % SUB) / SUB; h = t ? hb(X0 + a * step, y) * (1 - t) + hb(X0 + (a + 1) * step, y) * t : hb(x, y); }
        else if (i === 0 || i === nx) { const a = Math.floor(j / SUB), t = (j % SUB) / SUB; h = t ? hb(x, Y0 + a * step) * (1 - t) + hb(x, Y0 + (a + 1) * step) * t : hb(x, y); }
        else h = map.h(x, y) + carveRdh(K, x, y);
        P[k * 3] = x; P[k * 3 + 1] = h; P[k * 3 + 2] = -y;
        sh[k] = horizonLit(map, x, y, h, 1.5);
      }
      let t = 0;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, e = c + 1; idx[t++] = a; idx[t++] = b; idx[t++] = e; idx[t++] = a; idx[t++] = e; idx[t++] = c; }
      const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(P, 3)); g.setAttribute("shadow", new THREE.BufferAttribute(sh, 1)); g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeVertexNormals(); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat); m.renderOrder = 1; group.add(m); patches.push(m);
      // a moat's water: a sheet at its level over each wet run, drawn with this same material (so the same water as
      // the river: moatTex R is the depth under it). The banks rise through it: the shore is where they meet, to the pixel.
      if (K.water?.length) {
        const hb0 = map.hBase || map.h, wp = [], wi = [], ws = [];
        for (const r of K.water) {
          const t0 = r.joinA ? -r.hw : 0, t1 = r.L + (r.joinB ? r.hw : 0), nu = Math.max(1, Math.ceil((t1 - t0) / 2)), nv = 6, base = wp.length / 3;
          for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
            const t = t0 + (t1 - t0) * i / nu, v = (j / nv - 0.5) * 2 * r.hw * 1.02, x = r.x0 + r.ux * t + r.nx * v, y = r.y0 + r.uy * t + r.ny * v;
            wp.push(x, hb0(x, y) - K.waterZ, -y); ws.push(1);
          }
          for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, e = c + 1; wi.push(a, e, b, a, c, e); }
        }
        const wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.Float32BufferAttribute(wp, 3)); wg.setAttribute("shadow", new THREE.Float32BufferAttribute(ws, 1)); wg.setIndex(wi);
        wg.computeVertexNormals(); wg.computeBoundingSphere();
        const wm = new THREE.Mesh(wg, mat); wm.renderOrder = 1; group.add(wm); patches.push(wm);
      }
    }
    carveBoxes = boxes; if (lastPads.length) setPads(lastPads); else cutHoles();
    const K = (list || [])[0]; // (the moat water: one castle's — a siege has one)
    if (K) {
      const tx = new THREE.DataTexture(K.tex, K.nx, K.ny, THREE.RGBAFormat, THREE.FloatType); tx.minFilter = tx.magFilter = THREE.LinearFilter; tx.needsUpdate = true;
      uniforms.moatTex.value?.dispose?.(); uniforms.moatTex.value = tx; uniforms.moatOn.value = 1;
      uniforms.moatBox.value.set(K.x0 - K.cell / 2, K.y0 - K.cell / 2, 1 / (K.nx * K.cell), 1 / (K.ny * K.cell));
    } else uniforms.moatOn.value = 0;
  }
  return { mesh, outer, group, uniforms, material: mat, setCarves, setPads, meshSeg };
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
function dummyF() { const t = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType); t.needsUpdate = true; return t; }
function carveRdh(K, x, y) {
  const fx = (x - K.x0) / K.cell, fy = (y - K.y0) / K.cell;
  if (fx < 0 || fy < 0 || fx > K.nx - 1 || fy > K.ny - 1) return 0;
  const i = Math.min(K.nx - 2, fx | 0), j = Math.min(K.ny - 2, fy | 0), u = fx - i, v = fy - j, k = j * K.nx + i, a = K.rdh;
  return (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + K.nx] * (1 - u) + a[k + K.nx + 1] * u) * v;
}
function dummyArr() { const t = new THREE.DataArrayTexture(new Uint8Array(4).fill(128), 1, 1, 1); t.needsUpdate = true; return t; }

// world (x,y) → three.js position
export const toScene = (map, x, y, lift = 0) => new THREE.Vector3(x, map.h(x, y) + lift, -y);
