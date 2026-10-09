// Live buildings: the economy's w.buildings drawn with our Blender models, in the model state that
// matches the building's real stage (staked-out foundation → frame & scaffolding → complete → ruin).
// Few enough to draw individually; each mesh carries userData.bid for picking.
import * as THREE from "three";
import { loadAsset } from "./props.js";
import { hMirror, groundBase, groundH } from "./terrain.js";
import { makePad, padWalls, setPad, flushPads, padHosted, padOf, preloadPadWalls } from "./pads.js";
import { BUILDINGS } from "../sim/econ-data.js";
import { gateGeom } from "../sim/features.js";
import { glbExists, terrainTex } from "../build.js";

const ASSET = { paddock: "horse_paddock" };
const HOUSES = ["house_a", "house_b", "house_c"];
const stageSuffix0 = (b) => b.ruin ? "_ruin" : b.progress >= 1 ? "" : b.progress < 0.34 ? "_build1" : "_build2";
// a building being pulled down (js/sim/demolish.js) goes the way it went up, backwards: intact (the men at it) → the frame →
// the footings → gone; a ruin being cleared: the ruin → the footings → gone
const stageSuffix = (b) => { const r = b.razing; if (!r) return stageSuffix0(b); if (b.ruin) return r.done < 0.5 ? "_ruin" : "_build1"; const s0 = stageSuffix0(b); return r.done < 1 / 3 ? s0 : r.done < 2 / 3 ? (s0 === "_build1" ? s0 : "_build2") : "_build1"; };
// a stone wall rising in a palisade's place (b.replaces): how many of its 6 m modules stand finished — the rest of the work
// (the first 15 %: staking out, footings) shows none; the palisade's modules give way as the stone's stand
const upMods = (b, n) => Math.min(n, Math.floor(Math.max(0, Math.min(1, (b.progress - 0.15) / 0.85)) * n + 1e-9));

// cleared ground under a building site: sandy, trampled earth that fades raggedly into the grass
// around it (alpha from a noisy falloff), sampled in world space so it lines up with the terrain.
let groundMat = null;
function edgeMask() {
  const N = 256, cv = document.createElement("canvas"); cv.width = cv.height = N; const g = cv.getContext("2d");
  const img = g.createImageData(N, N);
  const h = (i, j) => { let x = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return x - Math.floor(x); };
  const noise = (x, y) => { const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    return (h(i, j) * (1 - su) + h(i + 1, j) * su) * (1 - sv) + (h(i, j + 1) * (1 - su) + h(i + 1, j + 1) * su) * sv; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / (N - 1) * 2 - 1, v = y / (N - 1) * 2 - 1;
    const edge = Math.max(Math.abs(u), Math.abs(v)) * 0.75 + Math.hypot(u, v) * 0.25; // rounded rectangle
    const n = noise(x / 18, y / 18) * 0.6 + noise(x / 6, y / 6) * 0.4;
    const a = Math.min(1, Math.max(0, (0.98 - edge + (n - 0.5) * 0.35) / 0.2));
    const o = (y * N + x) * 4; img.data[o] = img.data[o + 1] = img.data[o + 2] = 255 * a; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(cv);
}
function clearedGround(map, b) {
  if (!groundMat) {
    const tl = new THREE.TextureLoader();
    const sand = tl.load(terrainTex("sand_albedo")), trodden = tl.load(terrainTex("churned_ground_albedo"));
    for (const t of [sand, trodden]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; }
    groundMat = new THREE.MeshStandardMaterial({ map: sand, alphaMap: edgeMask(), transparent: true, depthWrite: false, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    groundMat.onBeforeCompile = (sh) => { // world-scaled sand, mottled with trodden earth, so no two sites look alike
      sh.uniforms.trodden = { value: trodden };
      sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vWxy;").replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWxy = (modelMatrix * vec4(transformed,1.)).xz;");
      sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vWxy; uniform sampler2D trodden;")
        .replace("#include <map_fragment>", `vec4 sa = texture2D(map, vWxy / 6.); vec4 tr = texture2D(trodden, vWxy / 9.);
          float m = smoothstep(.35, .75, texture2D(trodden, vWxy / 41.).g);
          diffuseColor.rgb *= mix(sa.rgb, tr.rgb, .35 * m) * vec3(1.12, 1.0, .8);`);
    };
  }
  const isWall = b.x1 !== undefined;
  const fp = BUILDINGS[b.kind]?.footprint || [12, 10];
  const L = isWall ? Math.hypot(b.x2 - b.x1, b.y2 - b.y1) + 10 : fp[0] * 1.35 + 10, D = isWall ? 12 : fp[1] * 1.35 + 10;
  const rot = isWall ? Math.atan2(b.y2 - b.y1, b.x2 - b.x1) : b.rot || 0;
  const g = new THREE.PlaneGeometry(L, D, Math.max(2, Math.round(L / 2)), Math.max(2, Math.round(D / 2))); g.rotateX(-Math.PI / 2);
  const P = g.attributes.position, c = Math.cos(rot), s = Math.sin(rot);
  for (let k = 0; k < P.count; k++) {
    const lx = P.getX(k), ly = -P.getZ(k), x = b.x + lx * c - ly * s, y = b.y + lx * s + ly * c;
    P.setXYZ(k, x, hMirror(map, x, y) + 0.06, -y);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, groundMat); m.userData.bid = b.id; m.renderOrder = 1;
  return m;
}

// team banners: a pole with a waving cloth beside every building (houses get a small pennon)
const FLAG_T = { value: 0 };
const flagMats = [];
export function setTeamBanners(canvases) {
  flagMats.length = 0;
  for (const cv of canvases) {
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const m = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 });
    m.onBeforeCompile = (sh) => { sh.uniforms.flagT = FLAG_T; sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float flagT;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nfloat fly = uv.x; transformed.z += sin(flagT*3.1 + uv.x*6.0 + position.y*0.8) * 0.35 * fly; transformed.y -= fly*fly*0.25;"); };
    flagMats.push(m);
  }
}
export const tickFlags = (t) => { FLAG_T.value = t; };
export const teamFlagMat = (t) => flagMats[t] || null; // (a house's waving banner, for flags elsewhere: js/render/veins.js)
const poleMat = new THREE.MeshStandardMaterial({ color: "#5a4631", roughness: 0.9 });
function flagFor(obj, b) {
  const mat = flagMats[b.team]; if (!mat) return null;
  const bb = new THREE.Box3().setFromObject(obj); if (!isFinite(bb.max.y)) return null;
  const small = b.kind === "house";
  const H = (bb.max.y - bb.min.y) + (small ? 1.5 : 4), W = small ? 1.1 : 2.6, h = small ? 0.8 : 1.9;
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(small ? 0.05 : 0.09, small ? 0.06 : 0.12, H, 6), poleMat); pole.position.y = H / 2; g.add(pole);
  const clothGeo = new THREE.PlaneGeometry(W, h, 12, 4); clothGeo.translate(W / 2, 0, 0);
  const cloth = new THREE.Mesh(clothGeo, mat); cloth.position.y = H - h / 2 - 0.1; g.add(cloth);
  // stand it at a front corner of the footprint, in world space
  const fp = BUILDINGS[b.kind]?.footprint || [10, 8], c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
  const lx = fp[0] / 2 + 0.8, ly = -fp[1] / 2 - 0.8, x = b.x + lx * c - ly * s, y = b.y + lx * s + ly * c;
  g.position.set(x, bb.min.y, -y); g.rotation.y = (b.rot || 0) + 0.6;
  return g;
}

// Every building with a model stands on a levelled pad (js/render/pads.js): its extent is the model's own (the yard, the
// posts and the eaves with it), grown — never shrunk — as its stages' models change, so the pad does not shift under it.
// The paddock's fences and the butts' long lanes follow the ground instead (draped); fields are painted into the ground.
const padExt = new Map(), DRAPE = new Set(["paddock", "archery_range"]);
function padFor(b, L, map) {
  if (DRAPE.has(b.kind)) return null;
  const e = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, at: `${b.x},${b.y},${b.rot || 0}` };
  for (const { geo } of L[0]) { if (!geo.boundingBox) geo.computeBoundingBox(); const q = geo.boundingBox; e.x0 = Math.min(e.x0, q.min.x); e.x1 = Math.max(e.x1, q.max.x); e.z0 = Math.min(e.z0, q.min.z); e.z1 = Math.max(e.z1, q.max.z); }
  const o = padExt.get(b.id); if (o && o.at === e.at) { e.x0 = Math.min(e.x0, o.x0); e.x1 = Math.max(e.x1, o.x1); e.z0 = Math.min(e.z0, o.z0); e.z1 = Math.max(e.z1, o.z1); }
  if (!isFinite(e.x0)) return null; padExt.set(b.id, e);
  const p = makePad(b, e, (x, y) => groundBase(map, x, y), { earth: b.kind === "motte" });
  return p && padHosted(p) ? p : null;
}
// draped: every vertex of the model lifted (or lowered) by the drawn ground under it, so fence posts stay plumb and stand
// on the slope — each mesh gets its own copy of the geometry
function drape(obj, b, map) {
  const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0), base = obj.position.y + 0.15;
  for (const m of obj.children) {
    const g = m.geometry.clone(), P = g.attributes.position;
    for (let k = 0; k < P.count; k++) { const lx = P.getX(k), lz = P.getZ(k); P.setY(k, P.getY(k) + groundBase(map, b.x + lx * c + lz * s, b.y + lx * s - lz * c) - base); }
    g.computeBoundingSphere(); g.computeBoundingBox(); m.geometry = g; m.userData.own = true;
  }
}
// a wall's 6 m module stepped down the ground: its base runs from the ground at one end to the ground at the other (the
// lower of its two faces, sunk 0.3 m), sheared so the posts stay plumb — none buried at the uphill end, none on stilts
const SHEAR = new THREE.Matrix4(), MROT = new THREE.Matrix4();
function wallSeg(seg, map, x, y, ang, len) {
  const c = Math.cos(ang), s = Math.sin(ang), hx = len / 2, ex = -s * 1.2, ey = c * 1.2;
  const g = (px, py) => Math.min(groundBase(map, px + ex, py + ey), groundBase(map, px - ex, py - ey), groundBase(map, px, py));
  const h0 = g(x - c * hx, y - s * hx), h1 = g(x + c * hx, y + s * hx), hm = g(x, y);
  const base = Math.min((h0 + h1) / 2, hm) - 0.3, k = (h1 - h0) / len;
  SHEAR.set(len / 6, 0, 0, 0, k * len / 6, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1); // (local x scaled to the module's length; y += k·x)
  MROT.makeRotationY(ang); seg.matrixAutoUpdate = false;
  seg.matrix.copy(MROT).multiply(SHEAR).setPosition(x, base, -y);
}
export function makeBuildings(scene) {
  preloadPadWalls();
  const group = new THREE.Group(); scene.add(group);
  const cache = new Map();   // asset name → Promise<lods|null>
  const shown = new Map();   // building id → { key, obj }
  const has = glbExists; // (a shipped build lists its models: js/build.js — no HEAD request per model)
  const lods = (a) => { if (!cache.has(a)) cache.set(a, loadAsset(a).catch(() => null)); return cache.get(a); };

  const memo = new Map();
  function modelFor(b) {
    const k = `${b.kind}|${b.kind === "house" ? b.id % 3 : 0}|${stageSuffix(b)}|${!!b.field}|${b.ruin ? 1 : 0}|${b.manor ? 1 : 0}`;
    if (!memo.has(k)) memo.set(k, modelForUncached(b));
    return memo.get(k);
  }
  async function modelForUncached(b) {
    if (b.field) return null; // fields are painted into the ground
    if (b.kind === "palisade" || b.kind === "stone_wall") {
      const suf = b.ruin ? "_breach" : b.progress < 1 ? "_build1" : "";
      const tries = b.kind === "palisade" ? [b.ruin ? "palisade_ruin" : "palisade" + (b.progress < 1 ? "_build1" : ""), "palisade"] : [suf ? "wall_stone" + suf : "wall_stone_straight", "wall_stone_straight"];
      for (const t of tries) if (await has(t)) return t;
      return null;
    }
    const base = b.kind === "house" ? HOUSES[b.id % 3] : ASSET[b.kind] || b.kind;
    const suf = stageSuffix(b);
    if (b.manor && suf === "" && await has("castle_hall")) return "castle_hall"; // (a daughter town's manor hall: a hall in its court, not a keep — js/sim/founding.js)
    const names = [base + suf];
    if (b.kind === "house") names.push("house" + suf);
    if (suf === "" || suf === "_ruin") names.push(base, b.kind === "house" ? "house" : null); // no ruin model yet → intact look
    for (const name of names.filter(Boolean)) if (await has(name)) return name;
    return null; // stage not modelled yet: nothing drawn (the site is still in the sim)
  }
  let busy = false; const failed = new Set();
  async function sync(w, map) {
    if (busy) return; busy = true;
    try {
      const live = new Set();
      const raised = new Set(); for (const b of w.buildings || []) if (b.upgradeOf !== undefined && !b.ruin) raised.add(b.upgradeOf); // (a shell keep rising on the motte: its build models carry the motte — js/sim/estates.js)
      // every model the buildings want, asked for at once (in parallel) before the pass — the pass below awaits each in
      // turn, and one file at a time a big town took minutes to appear (the owner: "the assets are only half loaded")
      await Promise.all((w.buildings || []).map((b) => modelFor(b).then((n) => (n ? lods(n) : null)).catch(() => null)));
      for (const b of w.buildings || []) try { await syncOne(b); } catch (e) { live.add(b.id); if (!failed.has(b.id)) { failed.add(b.id); console.error(`building ${b.id} (${b.kind}) could not be drawn`, e); } }
      // (one building that throws must not stop every building after it from being drawn: on re-entering the realm the
      // mirror's order put one such early in the list and only the first 40 of the owner's 160 ever appeared)
      async function syncOne(b) {
        if (w.castleBids?.has(b.id)) return; // a castle's curtains, towers and gatehouse are drawn by castle.js
        if (raised.has(b.id)) return;
        live.add(b.id);
        const up = b.upBy !== undefined ? w.buildings.find((o) => o.id === b.upBy && o.replaces === b.id) : null, nm = b.x1 !== undefined ? Math.max(1, Math.round(Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 6)) : 1;
        const stoneUp = b.replaces !== undefined && b.x1 !== undefined && b.progress < 1 && !b.ruin; // (js/sim/demolish.js: the stone drawn module by module)
        const hideOld = up ? (b.x1 !== undefined ? upMods(up, nm) : up.progress >= 0.34 ? 1 : 0) : 0; // (the timber giving way to the stone)
        const name = stoneUp ? (await has("wall_stone_straight") ? "wall_stone_straight" : null) : hideOld && b.x1 === undefined ? null : await modelFor(b);
        const key = (name || "") + "|" + (b.breachVer || 0) + "|" + (stoneUp ? "s" + upMods(b, nm) + (b.progress > 0 ? "+" : "") : "") + "|" + hideOld + "|" + (b.razing ? stageSuffix(b) : "");
        const cur = shown.get(b.id);
        if (cur && cur.key === key) return;
        if (cur) { group.remove(cur.obj); for (const k of ["ground", "flag"]) if (cur.obj.userData[k]) group.remove(cur.obj.userData[k]); for (const f of cur.obj.userData.flanks || []) group.remove(f); shown.delete(b.id); }
        if (!name) { setPad(b.id, null); return; } // bare site: the clearing is painted into the terrain (main.js paintClearings)
        const L = await lods(name); if (!L) return;
        const obj = new THREE.Group();
        if (b.x1 !== undefined) {
          // alternate the kit's straight variants so a long wall never visibly repeats
          const variants = [L];
          if (name === "wall_stone_straight" || name === "palisade") for (const v of name === "palisade" ? ["palisade_b"] : ["wall_stone_straight_b", "wall_stone_straight_c"]) if (await has(v)) { const lv = await lods(v); if (lv) variants.push(lv); }
          // walls: 6 m modules laid end to end along the line, each sitting on the ground beneath it
          const len = Math.hypot(b.x2 - b.x1, b.y2 - b.y1), n = Math.max(1, Math.round(len / 6)), ang = Math.atan2(b.y2 - b.y1, b.x2 - b.x1);
          // a breached module (siege.js b.mods) is drawn as the kit's breach / ruin piece
          const brName = b.kind === "palisade" ? "palisade_ruin" : "wall_stone_breach", BR = b.mods && [...b.mods].some((m) => m <= 0) && await has(brName) ? await lods(brName) : null;
          const SB = stoneUp && await has("wall_stone_build1") ? await lods("wall_stone_build1") : null, done = stoneUp ? upMods(b, n) : n;
          for (let k = 0; k < n; k++) {
            if (b.razing && b.mods && b.mods[k] <= 0) continue; // (pulled down: nothing left of that module)
            if (k < hideOld) continue;                          // (the stone stands there now)
            if (stoneUp && (k > done || (k === done && !SB))) continue;
            const t = (k + 0.5) / n, x = b.x1 + (b.x2 - b.x1) * t, y = b.y1 + (b.y2 - b.y1) * t;
            const seg = new THREE.Group(), LV = stoneUp && k === done ? SB : BR && b.mods[k] <= 0 ? BR : variants[(k * 7 + b.id) % variants.length];
            for (const { geo, mat } of LV[0]) { const m = new THREE.Mesh(geo, mat); m.userData.bid = b.id; seg.add(m); }
            wallSeg(seg, map, x, y, ang, len / n);
            obj.add(seg);
          }
          obj.userData.bid = b.id; group.add(obj); shown.set(b.id, { key, obj }); return;
        }
        for (const { geo, mat } of L[0]) { const m = new THREE.Mesh(geo, mat); m.userData.bid = b.id; m.castShadow = m.receiveShadow = true; obj.add(m); }
        const pad = padFor(b, L, map); setPad(b.id, pad);
        obj.position.set(b.x, pad ? pad.P - 0.05 : hMirror(map, b.x, b.y) - 0.15, -b.y); obj.rotation.y = b.rot || 0;
        if (DRAPE.has(b.kind)) drape(obj, b, map);
        // a gate closes its whole stretch of the circuit: wall modules on its flanks, out to the stretch's ends
        if ((b.kind === "gate" || b.kind === "gatehouse") && b.gx1 !== undefined && !b.ruin && (b.progress >= 1 || (b.replaces !== undefined && b.progress >= 0.34))) { // (a gatehouse rising in a gate's place keeps the old timber flanks till it stands)
          const G = gateGeom(b), mod = b.kind === "gate" || b.progress < 1 ? "palisade" : "wall_stone_straight";
          const FL = await has(mod) ? await lods(mod) : null;
          if (FL) for (const [a0, a1] of [[0, G.t - 6], [G.t + 6, G.L]]) {
            const len = a1 - a0; if (len < 2) continue; const n = Math.max(1, Math.round(len / 6)), ang = Math.atan2(G.uy, G.ux);
            for (let k = 0; k < n; k++) {
              const t = a0 + (k + 0.5) * len / n, x = G.ax + G.ux * t, y = G.ay + G.uy * t, seg = new THREE.Group();
              for (const { geo, mat } of FL[0]) { const m = new THREE.Mesh(geo, mat); m.userData.bid = b.id; seg.add(m); }
              wallSeg(seg, map, x, y, ang, len / n);
              group.add(seg); (obj.userData.flanks ||= []).push(seg);
            }
          }
        }
        if (b.progress >= 1 && !b.ruin && !b.razing) { obj.updateMatrixWorld(true); const f = flagFor(obj, b); if (f) { group.add(f); obj.userData.flag = f; } }
        obj.userData.bid = b.id;
        group.add(obj); shown.set(b.id, { key, obj });
      }
      for (const id of padExt.keys()) if (!live.has(id)) { padExt.delete(id); setPad(id, null); }
      { const all = flushPads(); // (the terrain re-cuts its pads: js/render/terrain.js setPads) — and every revetment is laid again against its neighbours (a new model: its own)
        for (const [id, s] of shown) {
          const o = s.obj.userData; if (!all && (o.ground || !padOf(id))) continue;
          if (o.ground) { group.remove(o.ground); o.ground.geometry.dispose(); o.ground = null; }
          const p = live.has(id) && padOf(id), rv = p && padWalls(p, (x, y) => groundH(map, x, y)); if (rv) { rv.userData.bid = id; group.add(rv); o.ground = rv; }
        }
      }
      for (const [id, s] of shown) if (!live.has(id)) { group.remove(s.obj); for (const k of ["ground", "flag"]) if (s.obj.userData[k]) group.remove(s.obj.userData[k]); for (const f of s.obj.userData.flanks || []) group.remove(f); shown.delete(id); }
    } finally { busy = false; }
  }
  const ray = new THREE.Raycaster();
  function pick(ndc, cam) { ray.setFromCamera(ndc, cam); const hit = ray.intersectObject(group, true)[0]; return hit ? hit.object.userData.bid : null; }
  return { group, sync, pick, stats: () => ({ shown: shown.size, keys: [...shown.values()].map((v) => v.key) }) };
}
