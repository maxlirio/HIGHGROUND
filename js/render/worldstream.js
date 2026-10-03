// The land round the Vale, drawn as it streams in (docs/big-world.md §5). The Vale itself keeps its own terrain mesh
// (js/render/terrain.js buildTerrain on map.core — the same mesh, textures and cost as a single-player game). Round it:
//   • the FAR LAND: one mesh of the coarse world (js/sim/tiles.js world/coarse.gz, a vertex every 62.5 m) out to the haze
//     and past the world's edge (mirrored there, as the Vale's old ring was) — sunk under the Vale and under every tile
//     drawn in detail, so the detailed ground always lies on top (the part still showing round them is a skirt);
//   • the TILES: each 500 m tile that has arrived (js/sim/tilemap.js) near the camera is a chunk mesh — a vertex every
//     7.8 m (the Vale's own spacing) within ~1.6 km, every 31 m further out — with its own surface and water textures
//     (an 8-cell apron read from its neighbours, so the splat's ragged borders run across tile edges), drawn with the
//     terrain's own shader and uniforms (sun, weather, fog of war, clearings: one look everywhere);
//   • the TREES of each tile near the camera, handed to the props (js/render/props.js, tagged by tile so they leave again).
// update(camera) asks the map for the tiles round the view and builds/rebuilds a few chunks a frame (a time budget).
import * as THREE from "three";
import { horizonLit, meshSeg, groundBase, hMirror, padPatchGeometry, padBoxesOf } from "./terrain.js";
import { addPadHost, onPads } from "./pads.js";
import { TILE_CELLS, TILE_N } from "../sim/tiles.js";

const A = 8;                         // apron cells round a tile's textures
const NEAR = 1600, MID = 3200;       // m from the camera's ground point: 64-segment chunks, 16-segment chunks (the far land beyond)
const WANT_R = 3300, TREE_R = 2200;  // tiles fetched within; trees drawn within
const FAR_STEP = 62.5, FAR_MARGIN = 5000;

export function makeWorldStream({ scene, map, terr, props, layerOfKey, treesOf, onTile = null, budgetMs = 6 }) {
  const W = map.world, core = map.core, NT = W.tiles[0], cell = W.cell, TM = TILE_CELLS * cell, x0 = map.x0, y0 = map.y0;
  const C = W.core, inCoreBox = (x, y, m = 0) => x > C.x0 + m && y > C.y0 + m && x < C.x0 + C.size - m && y < C.y0 + C.size - m;
  const group = terr.group; // (chunks join the terrain group: the click raycast — main.js groundAt — finds them)
  const layerKeyCache = new Map();
  const layer = (key) => { let L = layerKeyCache.get(key); if (L === undefined) { L = Math.max(0, layerOfKey(key)); layerKeyCache.set(key, L); } return L; };
  const keyOf = map.surfaceKeys;
  // a material sharing every terrain uniform but its own data: the surface ids, the water, and where they lie
  function chunkMaterial(sTex, wTex, box, res) {
    const u = { ...terr.uniforms, surfId: { value: sTex }, waterTex: { value: wTex }, waterOn: { value: wTex ? 1 : 0 }, dataBox: { value: box }, dataMode: { value: 1 }, mapRes: { value: res } };
    return new THREE.ShaderMaterial({ uniforms: u, vertexShader: terr.material.vertexShader, fragmentShader: terr.material.fragmentShader, glslVersion: terr.material.glslVersion });
  }
  const sTexOf = (data, n) => { const t = new THREE.DataTexture(data, n, n, THREE.RedIntegerFormat, THREE.UnsignedByteType); t.internalFormat = "R8UI"; t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; };
  const wTexOf = (data, n) => { const t = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.FloatType); t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };

  // ---------------------------------------------------------------- the far land (the coarse world)
  const Cc = map.coarse;
  let far = null;
  if (Cc) {
    const fx0 = x0 - FAR_MARGIN, fy0 = y0 - FAR_MARGIN, span = map.size + 2 * FAR_MARGIN, seg = Math.round(span / FAR_STEP), n1 = seg + 1;
    const P = new Float32Array(n1 * n1 * 3), N = new Float32Array(n1 * n1 * 3), SH = new Float32Array(n1 * n1), base = new Float32Array(n1 * n1);
    const hAt = (x, y) => (x < x0 || y < y0 || x > map.x1 || y > map.y1 ? hMirror(map, x, y) : map.h(x, y));
    for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) {
      const k = j * n1 + i, x = fx0 + i * FAR_STEP, y = fy0 + j * FAR_STEP, h = hAt(x, y);
      P[k * 3] = x; P[k * 3 + 1] = h; P[k * 3 + 2] = -y; base[k] = h;
      const e = FAR_STEP, gx = (hAt(x + e, y) - hAt(x - e, y)) / (2 * e), gy = (hAt(x, y + e) - hAt(x, y - e)) / (2 * e), l = Math.hypot(gx, 1, gy);
      N[k * 3] = -gx / l; N[k * 3 + 1] = 1 / l; N[k * 3 + 2] = gy / l;
      SH[k] = horizonLit(map, x, y, h, FAR_STEP);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(P, 3)); g.setAttribute("normal", new THREE.BufferAttribute(N, 3)); g.setAttribute("shadow", new THREE.BufferAttribute(SH, 1));
    const sid = new Uint8Array(Cc.n * Cc.n); for (let k = 0; k < sid.length; k++) sid[k] = layer(keyOf[Cc.surface[k]]);
    const mat = chunkMaterial(sTexOf(sid, Cc.n), wTexOf(Cc.water, Cc.n), new THREE.Vector4(Cc.x0, Cc.y0, Cc.cell, Cc.n), Cc.n);
    const mesh = new THREE.Mesh(g, mat); mesh.renderOrder = 2; mesh.frustumCulled = false; scene.add(mesh); // (not in the terrain group: clicks never land on it)
    far = { mesh, g, P, base, n1, seg, fx0, fy0, dirty: true };
  }
  const covered = new Uint8Array(NT * NT); // a tile drawn in detail: the far land sinks under it
  function farUpdate() {
    if (!far || !far.dirty) return; far.dirty = false;
    const { P, base, n1, fx0, fy0 } = far, sunk = new Uint8Array(n1 * n1);
    const under = (x, y) => { if (inCoreBox(x, y, 1)) return true; const ti = Math.floor((x - x0) / TM), tj = Math.floor((y - y0) / TM); if (ti < 0 || tj < 0 || ti >= NT || tj >= NT || !covered[tj * NT + ti]) return false; const lx = x - x0 - ti * TM, ly = y - y0 - tj * TM; return lx > 1 && ly > 1 && lx < TM - 1 && ly < TM - 1; };
    for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) { const k = j * n1 + i, s = under(fx0 + i * FAR_STEP, fy0 + j * FAR_STEP); sunk[k] = s ? 1 : 0; P[k * 3 + 1] = base[k] - (s ? 6 : 0); }
    // (a vertex exactly on a tile's edge is not 'under' it: the triangles touching a detailed tile's border dip as a skirt)
    const idx = [];
    for (let j = 0; j < n1 - 1; j++) for (let i = 0; i < n1 - 1; i++) {
      const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1;
      const cx = fx0 + (i + 0.5) * FAR_STEP, cy = fy0 + (j + 0.5) * FAR_STEP;
      if (under(cx, cy) && sunk[a] + sunk[b] + sunk[c] + sunk[d] >= 3) continue;
      idx.push(a, b, d, a, d, c); /* (counter-clockwise from above: world +y is three's −z) */
    }
    far.g.setIndex(idx); far.g.attributes.position.needsUpdate = true; far.g.computeBoundingSphere();
  }

  // ---------------------------------------------------------------- chunks
  const chunks = new Map(); // tile key → { T, seg, mesh, mat, sTex, wTex }
  function texturesFor(T) {
    const n = TILE_N + 2 * A, sd = new Uint8Array(n * n), wd = new Float32Array(n * n); let wet = false;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const li = i - A, lj = j - A, k = j * n + i;
      if (li >= 0 && lj >= 0 && li < TILE_N && lj < TILE_N) { const q = lj * TILE_N + li; sd[k] = layer(keyOf[T.surface[q]]); wd[k] = T.water ? T.water[q] : 0; }
      else { const x = T.ox + li * cell, y = T.oy + lj * cell; sd[k] = layer(map.surfaceAt(x, y)); wd[k] = map.water(x, y); }
      if (wd[k] > 0) wet = true;
    }
    return { sTex: sTexOf(sd, n), wTex: wet ? wTexOf(wd, n) : null, n, box: new THREE.Vector4(T.ox - A * cell, T.oy - A * cell, cell, n) };
  }
  // the drawn ground of a detailed chunk (64 segments: the Vale's 7.8 m lattice from the world's corner): its triangles
  // (a, b, d), (a, d, c) over the height field's nodes — what figures stand on and what a pad's patch meets at its rim
  const S64 = TM / 64;
  function triH(x, y) {
    const i = Math.floor((x - x0) / S64), j = Math.floor((y - y0) / S64), X = x0 + i * S64, Y = y0 + j * S64, u = (x - X) / S64, v = (y - Y) / S64;
    const hb = map.h(X, Y), hd = map.h(X + S64, Y + S64);
    if (v >= u) { const ha = map.h(X, Y + S64); return hb + u * (hd - ha) + v * (ha - hb); }
    const hc = map.h(X + S64, Y); return hb + u * (hc - hb) + v * (hd - hc);
  }
  // ---- buildings' pads out in the marches (js/render/pads.js): a detailed chunk cuts its triangles under a pad's box and
  // draws the pad's patch with its own material (a pad must lie within one tile and outside the Vale, which has its own)
  const tileOfBox = (b) => { const ti = Math.floor((b[0] - x0) / TM), tj = Math.floor((b[1] - y0) / TM); return ti === Math.floor((b[2] - x0) / TM) && tj === Math.floor((b[3] - y0) / TM) && ti >= 0 && tj >= 0 && ti < NT && tj < NT ? tj * NT + ti : -1; };
  const nearCore = (b) => b[0] < C.x0 + C.size + 16 && C.x0 - 16 < b[2] && b[1] < C.y0 + C.size + 16 && C.y0 - 16 < b[3];
  let tilePads = new Map(); // tile key → [pad]
  addPadHost((p) => !nearCore(p.box) && tileOfBox(p.box) >= 0);
  onPads((list) => {
    const was = tilePads; tilePads = new Map();
    for (const p of list) { if (nearCore(p.box)) continue; const k = tileOfBox(p.box); if (k < 0) continue; let a = tilePads.get(k); if (!a) tilePads.set(k, (a = [])); a.push(p); }
    const sig = (a) => (a || []).map((p) => `${p.id}:${p.P}:${p.x}:${p.y}:${p.rot}:${p.a1}:${p.b1}`).sort().join("|");
    for (const k of new Set([...was.keys(), ...tilePads.keys()])) { if (sig(was.get(k)) === sig(tilePads.get(k))) continue; const c = chunks.get(k); if (c && c.seg === 64) build(c.T, 64); }
  });
  function geometryFor(T, seg) {
    const st = TILE_CELLS / seg, s = TM / seg, n1 = seg + 1, nv = n1 * n1 + 4 * seg, P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), SH = new Float32Array(nv);
    const hT = (i, j) => T.height[j * TILE_N + i];
    for (let j = 0; j < n1; j++) for (let i = 0; i < n1; i++) {
      const k = j * n1 + i, x = T.ox + i * s, y = T.oy + j * s, h = hT(i * st, j * st);
      P[k * 3] = x; P[k * 3 + 1] = h; P[k * 3 + 2] = -y;
      const e = s, gx = (map.h(x + e, y) - map.h(x - e, y)) / (2 * e), gy = (map.h(x, y + e) - map.h(x, y - e)) / (2 * e), l = Math.hypot(gx, 1, gy);
      N[k * 3] = -gx / l; N[k * 3 + 1] = 1 / l; N[k * 3 + 2] = gy / l;
      SH[k] = horizonLit(map, x, y, h, Math.max(s, cell * 2));
    }
    // the skirt: the border vertices again, 4 m down (hides the step to a coarser neighbour or the far land)
    const ring = []; for (let i = 0; i < seg; i++) ring.push(i); for (let j = 0; j < seg; j++) ring.push(j * n1 + seg); for (let i = seg; i > 0; i--) ring.push(seg * n1 + i); for (let j = seg; j > 0; j--) ring.push(j * n1);
    const idx = [], PB = seg === 64 && tilePads.has(T.key) ? padBoxesOf(tilePads.get(T.key), s, T.ox, T.oy) : null;
    const hole = PB ? (i, j) => PB.some((q) => i >= q.i0 && i < q.i1 && j >= q.j0 && j < q.j1) : null;
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) { if (hole && hole(i, j)) continue; const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1; idx.push(a, b, d, a, d, c); /* (counter-clockwise from above: world +y is three's −z) */ }
    ring.forEach((v, q) => { const k = n1 * n1 + q; P.set([P[v * 3], P[v * 3 + 1] - 4, P[v * 3 + 2]], k * 3); N.set([N[v * 3], N[v * 3 + 1], N[v * 3 + 2]], k * 3); SH[k] = SH[v]; });
    for (let q = 0; q < ring.length; q++) { const a = ring[q], b = ring[(q + 1) % ring.length], a2 = n1 * n1 + q, b2 = n1 * n1 + (q + 1) % ring.length; idx.push(a, b, b2, a, b2, a2, a, b2, b, a, a2, b2); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(P, 3)); g.setAttribute("normal", new THREE.BufferAttribute(N, 3)); g.setAttribute("shadow", new THREE.BufferAttribute(SH, 1));
    g.setIndex(idx); g.computeBoundingSphere(); g.computeBoundingBox();
    g.userData.pads = PB ? PB.map((q) => padPatchGeometry(map, q, s, T.ox, T.oy, triH)) : null;
    return g;
  }
  function build(T, seg) {
    let c = chunks.get(T.key);
    if (!c) { const tx = texturesFor(T); c = { T, seg: 0, mesh: null, ...tx }; c.mat = chunkMaterial(c.sTex, c.wTex, c.box, c.n); chunks.set(T.key, c); }
    const g = geometryFor(T, seg);
    if (c.mesh) { c.mesh.geometry.dispose(); c.mesh.geometry = g; } else { c.mesh = new THREE.Mesh(g, c.mat); c.mesh.renderOrder = 1; c.mesh.userData.tile = T.key; group.add(c.mesh); }
    for (const m of c.padMeshes || []) { group.remove(m); m.geometry.dispose(); }
    c.padMeshes = (g.userData.pads || []).map((pg) => { const m = new THREE.Mesh(pg, c.mat); m.renderOrder = 1; m.userData.tile = T.key; group.add(m); return m; });
    c.seg = seg; covered[T.key] = 1; if (far) far.dirty = true;
  }
  function dropChunk(key) {
    const c = chunks.get(key); if (!c) return;
    if (c.mesh) { group.remove(c.mesh); c.mesh.geometry.dispose(); }
    for (const m of c.padMeshes || []) { group.remove(m); m.geometry.dispose(); }
    c.mat.dispose(); c.sTex.dispose(); c.wTex?.dispose(); chunks.delete(key); covered[key] = 0; if (far) far.dirty = true;
  }
  function retexture(key) { // a neighbour arrived: the apron reads its real ground now
    const c = chunks.get(key); if (!c) return;
    const tx = texturesFor(c.T); c.sTex.dispose(); c.wTex?.dispose(); Object.assign(c, tx);
    c.mat.uniforms.surfId.value = c.sTex; c.mat.uniforms.waterTex.value = c.wTex; c.mat.uniforms.waterOn.value = c.wTex ? 1 : 0;
  }
  // ---------------------------------------------------------------- trees per tile
  const treesIn = new Set();
  function addTrees(T) { if (treesIn.has(T.key) || !T.veg.length) return; treesIn.add(T.key); for (const [a, items] of treesOf(T)) props.add(a, items, "t" + T.key); }
  function dropTrees(key) { if (!treesIn.has(key)) return; treesIn.delete(key); props.drop("t" + key); }

  map.onTile((T, { dropped }) => {
    if (dropped) { dropChunk(T.key); dropTrees(T.key); return; }
    const ti = T.key % NT, tj = (T.key / NT) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = (tj + dj) * NT + ti + di; if (ti + di >= 0 && tj + dj >= 0 && ti + di < NT && tj + dj < NT) retexture(k); }
    onTile?.(T); pending = true;
  });
  // the drawn ground anywhere (terrain.js groundH: piles, stacks and men stand on what is drawn): the Vale's mesh in the
  // Vale, a near chunk's 7.8 m triangles elsewhere; the buildings' pads are laid over this by terrain.js groundH
  meshSeg.set(map, { ground: (x, y) => (inCoreBox(x, y) ? groundBase(core, x, y) : triH(x, y)) });

  // ---------------------------------------------------------------- the loop
  let pending = true, wantT = 0, last = { x: NaN, y: NaN };
  function update(camera, now = performance.now()) {
    const cp = camera.cam.position, gx = camera.st.tx, gy = camera.st.ty;
    if (now - wantT > 500 || Math.hypot(gx - last.x, gy - last.y) > 150) { wantT = now; last = { x: gx, y: gy }; map.want(gx, gy, WANT_R); pending = true; }
    farUpdate();
    if (!pending) return; pending = false;
    // what each arrived tile should be: its level of detail by distance (the camera's ground point and the eye), its trees
    const t0 = performance.now(), jobs = [];
    for (let k = 0; k < NT * NT; k++) {
      const T = map.tiles[k], c = chunks.get(k);
      if (!T) { if (c) dropChunk(k); continue; }
      const cx = T.ox + TM / 2, cy = T.oy + TM / 2, d = Math.max(0, Math.min(Math.hypot(cx - gx, cy - gy), Math.hypot(cx - cp.x, cy + cp.z)) - TM * 0.5);
      const seg = d < NEAR ? 64 : d < MID ? 16 : 0;
      if (!seg) { if (c) dropChunk(k); } else if (!c || c.seg !== seg) jobs.push([d, T, seg]);
      if (d < TREE_R) addTrees(T); else if (d > TREE_R + 600) dropTrees(k);
    }
    jobs.sort((a, b) => a[0] - b[0]);
    for (const [, T, seg] of jobs) { if (performance.now() - t0 > budgetMs) { pending = true; break; } build(T, seg); }
  }
  return { update, chunks, far: () => far, stats: () => ({ chunks: chunks.size, near: [...chunks.values()].filter((c) => c.seg === 64).length, trees: treesIn.size, ...map.stats() }) };
}
