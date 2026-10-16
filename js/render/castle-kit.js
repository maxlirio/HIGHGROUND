// CASTLE-ART's modular kit for js/render/castle.js (docs/siege-art-contract.md "Castle kit"; castle-plan §2.1).
// assets/castle-kit.json (the manifest) + assets/glb/castle_<piece>.glb, loaded lazily — only when a castle exists —
// and each piece once. The GLBs reference the shared texture library (assets/tex/castle/) by URI; those URIs are
// swapped for a 1-pixel stand-in here, and every material is replaced by castle.js's shared one of the same key
// (`castle_<key>` → "k:<key>"), so the ~21 MB library is fetched and uploaded ONCE whatever the number of pieces.
//
// A piece becomes a TEMPLATE: its meshes, node transforms baked in, sorted by what the renderer needs —
//   lod        0 / 1 (the _LOD0 / _LOD1 twins), -1 for moving parts (no LOD twin: drawn at both distances)
//   storey     0 for `base`, n for `upper_n…`, "top" for `roof` (castle.js turns it into the part's last floor)
//   sector     tower walk-level wall sectors {kind: "w"|"d", k}: plain wall or a doorway onto a curtain's walk
//   moving     portcullis_*, gate_l/r: kept apart, geometry relative to the node's pivot, for animation
// Other doors (tower, keep, postern, stable) are baked into their storey at rest (shut).
// Geometry is normalised to position / normal / uv / color(RGB float) and indexed, so pieces merge freely.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const TINY = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const mgr = new THREE.LoadingManager();
mgr.setURLModifier((u) => (/\.(jpe?g|png|webp)(\?|$)/i.test(u) && !u.startsWith("data:")) ? TINY : u);
const loader = new GLTFLoader(mgr);

let manifest = null, manifestP = null;
const cache = new Map(); // piece name → { tpl, failed }
export const kitState = { ver: 0 };
export function kitManifest() {
  if (!manifestP) manifestP = fetch("assets/castle-kit.json").then((r) => (r.ok ? r.json() : null)).then((m) => { manifest = m; kitState.ver++; return m; }).catch(() => null);
  return manifest;
}
// the template of a piece: null while it loads (it starts loading), false if the kit has no such piece
export function kitPiece(name) {
  if (!manifest) { kitManifest(); return null; }
  const P = manifest.pieces?.[name]; if (!P) return false;
  let e = cache.get(name);
  if (!e) {
    e = { tpl: null, failed: false }; cache.set(name, e);
    loader.loadAsync(`assets/glb/${P.file || "castle_" + name + ".glb"}`).then((g) => { e.tpl = template(g.scene, P, name); kitState.ver++; })
      .catch((err) => { console.warn("castle kit piece missing", name, err); e.failed = true; kitState.ver++; });
  }
  return e.failed ? false : e.tpl;
}
export const kitMeta = (name) => manifest?.pieces?.[name] || null;
export const kitReady = () => !!manifest;

const MOVING = /^(portcullis_outer|portcullis_inner|gate_l|gate_r)$/;
function normGeo(src, m) {
  const g = new THREE.BufferGeometry(), n = src.attributes.position.count;
  const P = src.attributes.position.clone(); g.setAttribute("position", P);
  g.setAttribute("normal", src.attributes.normal ? src.attributes.normal.clone() : new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  if (src.attributes.uv) { const u = src.attributes.uv, a = new Float32Array(n * 2); for (let i = 0; i < n; i++) { a[i * 2] = u.getX(i); a[i * 2 + 1] = u.getY(i); } g.setAttribute("uv", new THREE.BufferAttribute(a, 2)); }
  else g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  const c = new Float32Array(n * 3).fill(1), C = src.attributes.color;
  if (C) for (let i = 0; i < n; i++) { c[i * 3] = C.getX(i); c[i * 3 + 1] = C.getY(i); c[i * 3 + 2] = C.getZ(i); }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  if (src.index) g.setIndex(src.index.clone()); else { const ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new THREE.BufferAttribute(ix, 1)); }
  if (m) g.applyMatrix4(m);
  return g;
}
function template(scene, P, name) {
  scene.updateMatrixWorld(true);
  const items = [], moving = new Map(), inv = new THREE.Matrix4(), pv = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    // a multi-primitive node is a Group of meshes: the node's name is the group's
    const node = o.parent && o.parent !== scene && o.parent.name && !o.name.match(/_LOD\d$/) && !MOVING.test(o.name) ? o.parent : o;
    const nm = node.name || o.name;
    const key = (o.material?.name || "castle_ashlar").replace(/^castle_/, "");
    if (MOVING.test(nm)) { // geometry relative to its pivot (the node's origin)
      pv.setFromMatrixPosition(node.matrixWorld); inv.makeTranslation(-pv.x, -pv.y, -pv.z).multiply(o.matrixWorld);
      if (!moving.has(nm)) moving.set(nm, { name: nm, pivot: pv.clone(), parts: [] });
      moving.get(nm).parts.push({ mat: "k:" + key, geo: normGeo(o.geometry, inv) });
      return;
    }
    const lm = /_LOD(\d)$/.exec(nm), lod = lm ? +lm[1] : -1, base = nm.replace(/_LOD\d$/, "");
    let storey = 0, sector = null;
    const um = /^upper_(\d+)/.exec(base); if (um) storey = +um[1];
    if (/^roof/.test(base)) storey = "top";
    if (base === "hall_door") storey = 1;
    const sm = /^upper_\d+_([wd])(\d+)$/.exec(base); if (sm) sector = { kind: sm[1], k: +sm[2] };
    if (lod > 1) return;
    items.push({ node: base, lod, storey, sector, mat: "k:" + key, geo: normGeo(o.geometry, o.matrixWorld) });
  });
  return { name, meta: P, items, moving: [...moving.values()], merged: new Map() };
}
// the static geometry of a piece in its own frame, per material, for one LOD (instanced pieces: curtains, hoardings)
export function pieceGeos(tpl, lod) {
  if (tpl.merged.has(lod)) return tpl.merged.get(lod);
  const by = new Map();
  for (const it of tpl.items) { if (it.lod !== -1 && it.lod !== lod) continue; if (!by.has(it.mat)) by.set(it.mat, []); by.get(it.mat).push(it.geo); }
  const out = new Map(); for (const [m, gs] of by) { const g = mergeGeometries(gs, false); g.computeBoundingSphere(); out.set(m, g); }
  tpl.merged.set(lod, out); return out;
}
// a placed piece → { layerKeys, layersFn() → Map(layer → Map(mat → geo)) (LOD0), whole0, whole1: Map(mat → geo), tris }
// place: Matrix4 piece → world; top: the storey index of `roof`; doors: Set of sector k shown as doorways
export function placePiece(tpl, place, { top = 1, doors = null } = {}) {
  const L = new Map(), W0 = new Map(), W1 = new Map(), push = (M, m, g) => { if (!M.has(m)) M.set(m, []); M.get(m).push(g); };
  for (const it of tpl.items) {
    if (it.sector) { const isDoor = it.sector.kind === "d", want = !!doors?.has(it.sector.k); if (isDoor !== want) continue; }
    const g = it.geo.clone(); g.applyMatrix4(place);
    const st = it.storey === "top" ? top : Math.min(it.storey, top), layer = 2 * st;
    if (it.lod !== 1) { if (!L.has(layer)) L.set(layer, new Map()); push(L.get(layer), it.mat, g); push(W0, it.mat, g); }
    if (it.lod !== 0) push(W1, it.mat, g);
  }
  const merge = (M) => { const out = new Map(); for (const [m, gs] of M) { const g = gs.length === 1 ? gs[0] : mergeGeometries(gs, false); g.computeBoundingSphere(); out.set(m, g); } return out; };
  const whole0 = merge(W0), whole1 = merge(W1);
  let tris = 0; for (const g of whole0.values()) tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  // the storey layers are merged only when the part is first cut away (castle.js ensureLayers)
  let layers = null; const layersFn = () => { if (!layers) { layers = new Map(); for (const [k, M] of L) layers.set(k, merge(M)); } return layers; };
  return { layerKeys: [...L.keys()], layersFn, whole0, whole1, tris };
}
