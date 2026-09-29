// Instanced placement of our Blender-made GLB assets (trees, rocks, buildings, walls …).
// Each GLB carries <name>_LOD0.._LODn meshes (+ optional _extra* foliage cards that belong to LOD0).
// Instances are re-bucketed into LOD levels by camera distance a few times per second.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { hMirror } from "./terrain.js";
import { bakeImpostor, impostorMaterial, impostorQuad } from "./impostor.js";
import { Q } from "./quality.js";

// WebKit (Safari and our Mac app's WKWebView) mangles alpha when GLB textures are decoded through
// createImageBitmap — leaf cards come out fully transparent and every tree looks dead. The loader only
// avoids that path when it sees "Safari" in the user agent, which WKWebView doesn't send; so on any
// Apple WebKit, hide createImageBitmap and textures load through plain <img> (correct alpha).
if (typeof navigator !== "undefined" && /Apple/.test(navigator.vendor) && !/Chrome|CriOS/.test(navigator.userAgent)) {
  try { window.createImageBitmap = undefined; } catch { /* read-only: ignore */ }
}
const loader = new GLTFLoader();

// Foliage LODs are built here from the artist's leaf cards: LOD1 keeps every 4th card, enlarged to
// hold the silhouette; beyond that a tree is a baked impostor quad (impostor.js).
function sparseCards(geo, keepEvery = 4, grow = 1.55) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const pos = g.attributes.position, triCount = pos.count / 3, quadTris = 2;
  const keep = [];
  for (let t = 0; t < triCount; t += quadTris) if (((t / quadTris) | 0) % keepEvery === 0) for (let q = 0; q < quadTris && t + q < triCount; q++) keep.push(t + q);
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const arr = new attr.array.constructor(keep.length * 3 * attr.itemSize);
    keep.forEach((t, k) => arr.set(attr.array.subarray(t * 3 * attr.itemSize, (t + 1) * 3 * attr.itemSize), k * 3 * attr.itemSize));
    out.setAttribute(name, new THREE.BufferAttribute(arr, attr.itemSize));
  }
  // grow each card about its own centre so the sparse crown still reads full
  const P = out.attributes.position.array;
  for (let k = 0; k < keep.length; k += 2) {
    const base = k * 9, n = Math.min(18, P.length - base); let cx = 0, cy = 0, cz = 0;
    for (let v = 0; v < n; v += 3) { cx += P[base + v]; cy += P[base + v + 1]; cz += P[base + v + 2]; }
    cx /= n / 3; cy /= n / 3; cz /= n / 3;
    for (let v = 0; v < n; v += 3) { P[base + v] = cx + (P[base + v] - cx) * grow; P[base + v + 1] = cy + (P[base + v + 1] - cy) * grow; P[base + v + 2] = cz + (P[base + v + 2] - cz) * grow; }
  }
  out.computeVertexNormals();
  return out;
}
export async function loadAsset(name) {
  const gltf = await loader.loadAsync(`assets/glb/${name}.glb`);
  const lods = [[], [], []];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = /_LOD(\d)/.exec(o.name) || /_LOD(\d)/.exec(o.parent?.name || "");
    const lvl = m ? +m[1] : 0;
    const geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld);
    const mat = o.material;
    if (mat.map) mat.map.anisotropy = 8;
    const cards = mat.alphaTest > 0 || mat.transparent || mat.alphaMap || (mat.map && !m);
    if (mat.alphaTest > 0 || mat.transparent) { mat.transparent = false; mat.alphaTest = Math.max(mat.alphaTest, 0.45); mat.side = THREE.DoubleSide; }
    fogPatch(mat);
    if (cards && lvl === 0) lods.foliage = true; // a tree/bush: its far LOD becomes a baked impostor (makeProps)
    if (!m && cards) {
      lods[0].push({ geo, mat });
      lods[1].push({ geo: sparseCards(geo), mat });
    } else if (!m) { lods[0].push({ geo, mat }); lods[1].push({ geo, mat }); }
    else lods[Math.min(lvl, 2)].push({ geo, mat });
  });
  for (let i = 1; i < 3; i++) if (!lods[i].length) lods[i] = lods[i - 1];
  if (lods.foliage) lods[2] = lods[1];
  return lods;
}

// Fog of war on props: same texture/semantics as the terrain (0 unexplored, .5 explored, 1 visible).
export const FOG = { fogTex: { value: null }, fogOn: { value: 0 }, mapSize: { value: 4000 } };
function fogPatch(mat) {
  if (mat.userData.fogPatched) return; mat.userData.fogPatched = true;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, FOG);
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vFogW;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n#ifdef USE_INSTANCING\nvFogW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\nvFogW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 vFogW; uniform sampler2D fogTex; uniform float fogOn; uniform float mapSize;")
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>
        if (fogOn > .5) { float fv = texture2D(fogTex, vec2(vFogW.x, -vFogW.z) / mapSize).r;
          float g = dot(gl_FragColor.rgb, vec3(.3,.59,.11)); vec3 rem = mix(vec3(g), gl_FragColor.rgb, .35) * .45;
          gl_FragColor.rgb = mix(mix(vec3(.004), rem, smoothstep(.15,.45,fv)), gl_FragColor.rgb, smoothstep(.55,.95,fv)); }`);
  };
}


// Chunked, lazy, culled placement. The world is cut into CHUNK-metre squares; for each (asset, chunk)
// the instance list is just data (where things are). GPU meshes for a chunk are only BUILT the
// first time that chunk is near and on screen, and only DRAWN while it is in the camera frustum.
//
// Trees (assets with leaf cards) get per-INSTANCE detail: inside Q.lod0 m of the camera the full
// tree, inside Q.lod1 the sparse-card tree, beyond that a baked impostor quad. All of a species'
// impostors are one instanced draw (cheap: 4 vertices a tree), and each tree currently drawn as a
// real mesh is flagged hidden there. Distances are camera → tree, and the per-frame count of full /
// sparse trees is capped (nearest first), so a dense wood can't blow the budget.
// Everything else (buildings, stones …) switches LOD per chunk by camera → chunk-box distance.
const CHUNK = 200;
const STATIC_LOD = [220, 800]; // metres (camera → chunk box) for non-tree props
export function makeProps(scene, map, { renderer = null, light = null } = {}) {
  FOG.mapSize.value = map.size;
  const kinds = new Map();   // asset → { lods (async), chunks: Map(key → chunk), all: [items], imp }
  const allChunks = [];
  const dummy = new THREE.Object3D();
  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), v3 = new THREE.Vector3();
  const quad = impostorQuad();

  // cleared ground (a castle and its field of fire, js/render/castle.js): trees and objects there are not drawn
  const clearTests = [];
  function gone(it) { for (const t of clearTests) if (t(it.x, it.y)) return true; return false; }
  function clearArea(test) {
    clearTests.push(test);
    for (const k of kinds.values()) {
      let any = false; for (const it of k.all) if (!it.gone && test(it.x, it.y)) { it.gone = true; it.scale = 1e-4; any = true; }
      if (!any) continue;
      for (const c of k.chunks.values()) { c.mats = null; if (c.meshes.some(Boolean)) dispose(c); }
      if (k.imp) { k.all.forEach((it, i) => { if (it.gone) k.imp.setMatrixAt(i, matrixOf(it)); }); k.imp.instanceMatrix.needsUpdate = true; }
    }
  }
  function add(asset, items) {
    if (clearTests.length) items = items.map((it) => gone(it) ? { ...it, gone: true, scale: 1e-4 } : it);
    let k = kinds.get(asset);
    if (!k) { k = { asset, lods: null, loading: null, chunks: new Map(), failed: false, all: [], imp: null, bake: null }; kinds.set(asset, k); }
    for (const it of items) {
      const ci = Math.floor(it.x / CHUNK), cj = Math.floor(it.y / CHUNK), key = ci * 1000 + cj;
      let c = k.chunks.get(key);
      if (!c) {
        c = { kind: k, asset, items: [], cx: (ci + 0.5) * CHUNK, cy: (cj + 0.5) * CHUNK, meshes: [null, null, null], lvl: -1, zmin: Infinity, zmax: -Infinity, near: false };
        k.chunks.set(key, c); allChunks.push(c);
      }
      const z = hMirror(map, it.x, it.y) + (it.dz || 0);
      const o = { ...it, z, gi: k.all.length }; c.items.push(o); k.all.push(o); c.zmin = Math.min(c.zmin, z); c.zmax = Math.max(c.zmax, z);
    }
    for (const c of k.chunks.values()) c.box = new THREE.Box3(new THREE.Vector3(c.cx - CHUNK / 2 - 30, c.zmin - 5, -(c.cy + CHUNK / 2 + 30)), new THREE.Vector3(c.cx + CHUNK / 2 + 30, c.zmax + 40, -(c.cy - CHUNK / 2 - 30)));
    for (const c of k.chunks.values()) { c.mats = null; if (c.meshes.some(Boolean)) dispose(c); }
    if (k.imp) { scene.remove(k.imp); k.imp.dispose(); k.imp = null; if (k.lods) buildImpostors(k); }
    ensureLods(k); // trees need their impostor bake up front; everything is loaded at first sight anyway
  }
  function ensureLods(k) {
    if (k.lods || k.loading || k.failed) return;
    k.loading = loadAsset(k.asset).then((l) => {
      if (l.foliage && renderer && light) { try { k.bake = bakeImpostor(renderer, l[0]); k.impMat = impostorMaterial(k.bake, light, FOG); } catch (e) { console.warn("impostor bake failed", k.asset, e); } }
      k.lods = l; if (k.bake) buildImpostors(k);
    }).catch((e) => { k.failed = true; console.warn("asset missing", k.asset, e); });
  }
  const isTree = (k) => !!k.bake;
  function matrixOf(it) {
    dummy.position.set(it.x, it.z, -it.y); dummy.rotation.set(0, it.rot || 0, 0); dummy.scale.setScalar(it.scale || 1);
    dummy.updateMatrix(); return dummy.matrix;
  }
  function buildImpostors(k) {
    const n = k.all.length, im = new THREE.InstancedMesh(quad, k.impMat, n);
    k.all.forEach((it, i) => im.setMatrixAt(i, matrixOf(it)));
    k.hidden = new Float32Array(n); k.hiddenAttr = new THREE.InstancedBufferAttribute(k.hidden, 1); k.hiddenAttr.setUsage(THREE.DynamicDrawUsage);
    im.geometry = quad.clone(); im.geometry.setAttribute("hidden", k.hiddenAttr);
    im.frustumCulled = false; k.imp = im; scene.add(im);
  }
  function build(c, lvl) {
    const parts = c.kind.lods[lvl];
    c.meshes[lvl] = parts.map(({ geo, mat }) => {
      const im = new THREE.InstancedMesh(geo, mat, c.items.length);
      c.items.forEach((it, n) => im.setMatrixAt(n, matrixOf(it)));
      im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; im.visible = false;
      scene.add(im); return im;
    });
  }
  function dispose(c) { for (const lv of c.meshes) if (lv) for (const im of lv) { scene.remove(im); im.dispose(); } c.meshes = [null, null, null]; c.lvl = -1; c.near = false; }
  function show(c, lvl) {
    if (c.lvl === lvl) return;
    if (c.lvl >= 0 && c.meshes[c.lvl]) for (const im of c.meshes[c.lvl]) im.visible = false;
    c.lvl = lvl;
    if (lvl < 0) return;
    if (!c.meshes[lvl]) build(c, lvl);
    for (const im of c.meshes[lvl]) im.visible = true;
  }
  // tree chunk near the camera: fill its LOD0/LOD1 meshes with the chosen instances
  function fillNear(c, lists) {
    for (let lvl = 0; lvl < 2; lvl++) {
      const list = lists[lvl];
      if (!list.length) { if (c.meshes[lvl]) for (const im of c.meshes[lvl]) { im.visible = false; im.count = 0; } continue; }
      if (!c.meshes[lvl]) c.meshes[lvl] = c.kind.lods[lvl].map(({ geo, mat }) => { const im = new THREE.InstancedMesh(geo, mat, c.items.length); im.frustumCulled = false; scene.add(im); return im; });
      if (!c.mats) { c.mats = new Float32Array(c.items.length * 16); c.items.forEach((it, n) => matrixOf(it).toArray(c.mats, n * 16)); }
      for (const im of c.meshes[lvl]) {
        const a = im.instanceMatrix.array;
        for (let n = 0; n < list.length; n++) a.set(c.mats.subarray(list[n] * 16, list[n] * 16 + 16), n * 16);
        im.count = list.length; im.instanceMatrix.needsUpdate = true; im.visible = true;
      }
    }
  }
  function hideNear(c) {
    if (!c.near) return; c.near = false;
    for (const lv of c.meshes) if (lv) for (const im of lv) { im.visible = false; im.count = 0; }
    const k = c.kind; if (k.hidden) { for (const it of c.items) k.hidden[it.gi] = 0; k.dirty = true; }
  }
  let t = 1, lastQ = -1;
  const cand = [];
  function update(camera, dt) {
    if ((t += dt) < 0.15 && lastQ === Q.version) return; t = 0; lastQ = Q.version;
    camera.updateMatrixWorld(); pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pm);
    const cp = camera.position, L0 = Q.lod0, L1 = Q.lod1;
    cand.length = 0;
    const nearChunks = [];
    for (const c of allChunks) {
      const k = c.kind;
      if (!k.lods) { if (frustum.intersectsBox(c.box)) ensureLods(k); continue; }
      if (isTree(k)) {
        if (c.box.distanceToPoint(cp) > L1 || !frustum.intersectsBox(c.box)) { hideNear(c); continue; }
        nearChunks.push(c);
        for (let n = 0; n < c.items.length; n++) {
          const it = c.items[n], d = Math.hypot(it.x - cp.x, it.z + 6 - cp.y, -it.y - cp.z);
          if (d < L1) cand.push({ c, n, d });
        }
        continue;
      }
      if (!frustum.intersectsBox(c.box)) { show(c, -1); continue; }
      const d = c.box.distanceToPoint(cp);
      show(c, d < STATIC_LOD[0] ? 0 : d < STATIC_LOD[1] ? 1 : 2);
    }
    // nearest first: full detail up to cap0 (within lod0), then sparse up to cap1; the rest stay impostors
    cand.sort((a, b) => a.d - b.d);
    let n0 = 0, n1 = 0;
    for (const c of nearChunks) { c.lists = [[], []]; c.near = true; }
    for (const e of cand) {
      if (e.d < L0 && n0 < Q.cap0) { e.c.lists[0].push(e.n); n0++; }
      else if (n1 < Q.cap1) { e.c.lists[1].push(e.n); n1++; }
    }
    for (const c of nearChunks) {
      fillNear(c, c.lists);
      const k = c.kind; if (!k.hidden) continue;
      for (const it of c.items) k.hidden[it.gi] = 0;
      for (const lst of c.lists) for (const n of lst) k.hidden[c.items[n].gi] = 1;
      k.dirty = true; c.lists = null;
    }
    for (const k of kinds.values()) if (k.dirty && k.hiddenAttr) { k.hiddenAttr.needsUpdate = true; k.dirty = false; }
    stat = { near0: n0, near1: n1 };
  }
  let stat = {};
  const busy = () => [...kinds.values()].some((k) => k.loading && !k.lods && !k.failed);
  return { add, clearArea, update, kinds, busy, stats: () => ({ chunks: allChunks.length, built: allChunks.filter((c) => c.meshes.some(Boolean)).length, visible: allChunks.filter((c) => c.lvl >= 0 || c.near).length, ...stat }) };
}
