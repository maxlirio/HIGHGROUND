// Siege engines, stones and quarrels in flight, impacts and scaling ladders (sim: js/sim/siege.js; art contract:
// docs/siege-art-contract.md). Engines are few, so each one is its own Object3D, cloned from the artist's GLB
// (assets/glb/<kind>[_state].glb, with <kind>_parts.json saying how each part moves). Until a model exists, a
// placeholder built from boxes and cylinders, with the same part names, stands in. Rigid parts are animated
// here from the sim's timestamps: the throwing arm (e.lastShot), the ram's swing (e.swingT), wheels (e.roll),
// the tower's bridge (e.bridge), the springald's quarrel.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ARMS } from "../sim/arms.js";
import { ENG } from "../sim/siege.js";

const loader = new GLTFLoader();
const TEAM = [new THREE.Color("#2f5fa8"), new THREE.Color("#a8322f")];
const THROW_S = { trebuchet: 1.1, mangonel: 0.6 };        // s: the swing, from cocked to the release pose
const RELEASE = { trebuchet: 145, mangonel: 110 };          // deg (parts.json pose_release_deg overrides)

// ---------------------------------------------------------------- placeholders (same names as the contract)
const M = (c, r = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
const WOOD = M("#6b5236"), DARK = M("#4a3a28"), IRON = M("#3b3a38", 0.7), HIDE = M("#5c4a3a"), TIMBER = M("#8c7a5a"), STONE = M("#8a857a");
const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };
const cyl = (r, l, m, axis = "x") => { const g = new THREE.CylinderGeometry(r, r, l, 10); if (axis === "x") g.rotateZ(Math.PI / 2); if (axis === "z") g.rotateX(Math.PI / 2); return new THREE.Mesh(g, m); };
function pivot(name, x, y, z) { const p = new THREE.Group(); p.name = name; p.position.set(x, y, z); return p; }
function wheel(g, name, x, y, z, r) { const p = pivot(name, x, y, z); const c = cyl(r, 0.18, DARK); p.add(c); p.add(box(0.1, r * 1.8, 0.12, WOOD)); g.add(p); }
function placeholder(kind) {
  const g = new THREE.Group();
  if (kind === "trebuchet") {
    for (const s of [-1, 1]) { g.add(box(0.4, 0.4, 10, WOOD, s * 2.5, 0.2, 0)); const a = box(0.3, 7, 0.3, WOOD, s * 1.2, 3.4, 1.2); a.rotation.x = 0.35; g.add(a); const b = box(0.3, 7, 0.3, WOOD, s * 1.2, 3.4, -1.2); b.rotation.x = -0.35; g.add(b); }
    g.add(box(5.4, 0.35, 0.35, WOOD, 0, 0.3, 3)); g.add(box(5.4, 0.35, 0.35, WOOD, 0, 0.3, -3));
    const arm = pivot("arm", 0, 6.5, 0); arm.rotation.x = 0; const beam = box(0.35, 0.35, 12, WOOD, 0, 0, 0); beam.position.set(0, -Math.sin(-0.61) * 0, 0);
    const inner = new THREE.Group(); inner.rotation.x = -0.61; inner.add(box(0.35, 0.35, 12, WOOD, 0, 0, 3.6)); arm.add(inner); // cocked: long end down and back (+Z is front: long end at −Z… see below)
    const cw = pivot("counterweight", 0, Math.sin(0.61) * 2.4, -Math.cos(0.61) * 2.4); cw.add(box(2, 2, 2, TIMBER, 0, -1.4, 0)); arm.add(cw);
    const sl = pivot("sling", 0, 0, 0); sl.add(box(0.2, 0.2, 2, HIDE, 0, -6, 5)); arm.add(sl);
    g.add(arm);
  } else if (kind === "mangonel") {
    g.add(box(2.6, 0.3, 3.6, WOOD, 0, 0.15, 0)); for (const s of [-1, 1]) { const p = box(0.25, 3.8, 0.25, WOOD, s * 0.9, 1.9, 0); p.rotation.z = s * 0.15; g.add(p); }
    const arm = pivot("arm", 0, 3.5, 0); const inner = new THREE.Group(); inner.rotation.x = -0.7; inner.add(box(0.25, 0.25, 7, WOOD, 0, 0, 2.2)); arm.add(inner);
    const r = pivot("ropes", 0, Math.sin(0.7) * 1.2, -Math.cos(0.7) * 1.2); r.add(box(0.8, 2.6, 0.1, HIDE, 0, -1.3, 0)); arm.add(r); g.add(arm);
  } else if (kind === "springald") {
    g.add(box(1.6, 0.4, 2.6, WOOD, 0, 0.7, 0)); g.add(box(1.8, 1.0, 0.3, WOOD, 0, 1.2, 0.6));
    for (const [n, x, z] of [["wheel_fl", 0.8, 0.95], ["wheel_fr", -0.8, 0.95], ["wheel_rl", 0.8, -0.95], ["wheel_rr", -0.8, -0.95]]) wheel(g, n, x, 0.3, z, 0.3);
    const bolt = pivot("bolt", 0, 1.15, -0.6); bolt.add(cyl(0.03, 1.2, IRON, "z").translateZ(0.55)); g.add(bolt);
    for (const [n, s] of [["bow_l", 1], ["bow_r", -1]]) { const b = pivot(n, s * 0.46, 1.1, 0.6); b.add(box(0.8, 0.08, 0.1, WOOD, s * 0.4, 0, -0.15)); g.add(b); }
  } else if (kind === "ram") {
    const roof = new THREE.Group(); for (const s of [-1, 1]) { const r = box(2.1, 0.12, 8, HIDE, s * 0.75, 2.6, 0); r.rotation.z = -s * 0.7; roof.add(r); } g.add(roof);
    for (const z of [-3.6, -1.2, 1.2, 3.6]) for (const s of [-1, 1]) g.add(box(0.2, 2.6, 0.2, WOOD, s * 1.3, 1.3, z));
    for (const [n, x, z] of [["wheel_lf", 0.95, 2.6], ["wheel_lm", 0.95, 0], ["wheel_lb", 0.95, -2.6], ["wheel_rf", -0.95, 2.6], ["wheel_rm", -0.95, 0], ["wheel_rb", -0.95, -2.6]]) wheel(g, n, x, 0.45, z, 0.45);
    const ram = pivot("ram", 0, 1.2, 0.75); const log = cyl(0.25, 9, WOOD, "z"); ram.add(log); ram.add(box(0.6, 0.6, 0.6, IRON, 0, 0, 4.6)); g.add(ram);
  } else if (kind === "siege_tower") {
    for (let k = 0; k < 4; k++) g.add(box(4.6 - k * 0.15, 2.7, 4.6 - k * 0.15, k % 2 ? TIMBER : HIDE, 0, 1.5 + k * 2.7, 0));
    for (const [n, x, z] of [["wheel_lf", 2, 1.6], ["wheel_lb", 2, -1.6], ["wheel_rf", -2, 1.6], ["wheel_rb", -2, -1.6]]) wheel(g, n, x, 0.6, z, 0.6);
    const br = pivot("bridge", 0, 7.5, 2.4); br.add(box(3, 3.5, 0.15, WOOD, 0, 1.75, 0)); g.add(br);
  } else if (kind === "mantlet") {
    const s = box(2.4, 2, 0.12, TIMBER, 0, 1.05, 0); s.rotation.x = -0.26; g.add(s); const tm = box(1.2, 0.9, 0.02, M("#888888"), 0, 1.2, 0.12); tm.rotation.x = -0.26; tm.material = tm.material.clone(); tm.material.name = "team"; g.add(tm);
    wheel(g, "wheel_l", 1, 0.25, 0.1, 0.25); wheel(g, "wheel_r", -1, 0.25, 0.1, 0.25);
  } else if (kind === "packed") {
    for (const z of [-3, 3]) { g.add(box(2, 0.5, 4.5, WOOD, 0, 0.9, z)); g.add(box(1.8, 0.8, 4, TIMBER, 0, 1.5, z)); for (const s of [-1, 1]) wheel(g, "wheel_" + z + s, s * 1.1, 0.6, z, 0.6); }
  } else if (kind === "assembling") {
    g.add(box(0.4, 0.4, 10, WOOD, 2.5, 0.2, 0)); g.add(box(0.4, 0.4, 10, WOOD, -2.5, 0.2, 0)); g.add(box(5.4, 0.35, 0.35, WOOD, 0, 0.3, 3)); g.add(box(3, 0.6, 3, TIMBER, 3, 0.3, -3));
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
function ladderMesh() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) g.add(box(0.07, 0.07, 1, WOOD, s * 0.22, 0, 0.5));
  for (let k = 1; k < 20; k++) g.add(box(0.44, 0.04, 0.04, WOOD, 0, 0, k / 20));
  return g;
}

// ---------------------------------------------------------------- models
export function makeEngines(scene, map, fx) {
  const group = new THREE.Group(); scene.add(group);
  const cache = new Map();   // asset name → Promise<{ scene, parts } | null>
  const shown = new Map();   // engine id → { key, obj, parts }
  const load = (name) => {
    if (!cache.has(name)) cache.set(name, Promise.all([
      loader.loadAsync(`assets/glb/${name}.glb`).catch(() => null),
      fetch(`assets/glb/${name.replace(/_(burnt|packed|assembling_\d)$/, "")}_parts.json`).then((r) => r.ok ? r.json() : null).catch(() => null),
    ]).then(([g, parts]) => g ? { scene: g.scene, parts } : null));
    return cache.get(name);
  };
  const pending = new Set();
  function stateName(e) {
    if (e.state === "burnt") return `${e.kind}_burnt`;
    if (e.state === "packed") return `${e.kind}_packed`;
    if (e.state === "assembling") return e.prog < 0.5 ? `${e.kind}_assembling_1` : `${e.kind}_assembling_2`;
    return e.kind;
  }
  async function build(e, key) {
    const tries = [key];
    if (key.endsWith("_assembling_2")) tries.push(`${e.kind}_assembling_1`);
    if (key.endsWith("_burnt")) tries.push(e.kind);
    let src = null, name = null;
    for (const t of tries) { src = await load(t); if (src) { name = t; break; } }
    let obj;
    if (src) { obj = src.scene.clone(true); }
    else obj = placeholder(e.state === "packed" ? "packed" : e.state === "assembling" ? "assembling" : e.kind);
    const burnt = e.state === "burnt" && name !== key;
    obj.traverse((o) => {
      if (!o.isMesh) return;
      if (/_LOD1$/.test(o.name) || /_LOD1$/.test(o.parent?.name || "")) { o.visible = false; return; } // (engines are few: always the LOD0 mesh)
      o.castShadow = true; o.receiveShadow = true;
      if (/team/i.test(o.material?.name || "")) { o.material = o.material.clone(); o.material.color = TEAM[e.team] || TEAM[0]; o.userData.team = true; }
      if (burnt) { o.material = o.material.clone(); o.material.color = new THREE.Color("#2a241e"); }
    });
    const parts = {}; obj.traverse((o) => { if (o.name) { const n = o.name.replace(/_LOD\d$/, ""); if (!parts[n]) parts[n] = o; } });
    const wheels = Object.entries(parts).filter(([n]) => /^wheel/.test(n)).map(([, o]) => o);
    const meta = src?.parts || null;
    return { obj, parts, wheels, meta, rest: new Map(Object.values(parts).map((o) => [o, { r: o.rotation.clone(), p: o.position.clone() }])), team: e.team };
  }
  const ladders = { pool: [], group: new THREE.Group() }; group.add(ladders.group);
  let ladderSrc = null; load("ladder").then((s) => { ladderSrc = s; });
  // stones and quarrels in flight: two instanced meshes; debris chunks: a third
  const stoneGeo = new THREE.IcosahedronGeometry(1, 1), boltGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.1, 5); boltGeo.rotateX(Math.PI / 2);
  const stones = new THREE.InstancedMesh(stoneGeo, STONE, 64), bolts = new THREE.InstancedMesh(boltGeo, IRON, 64), chips = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 0.2, 0.3), STONE, 240);
  for (const m of [stones, bolts, chips]) { m.frustumCulled = false; m.count = 0; group.add(m); }
  const debris = []; const seenImpact = new WeakSet();
  const tmp = new THREE.Object3D();

  function place(obj, e) { const h = map.h(e.x, e.y); obj.position.set(e.x, h - 0.05, -e.y); obj.rotation.set(0, e.facing + Math.PI / 2, 0); }
  function animate(S, e, now, dt, w) {
    const P = S.parts, meta = S.meta, reset = (o) => { const r = S.rest.get(o); if (r) { o.rotation.copy(r.r); o.position.copy(r.p); } };
    // throwing arm: the swing to the release pose, then wound slowly back down (the windlass / the crew re-cock it)
    if (P.arm && (e.kind === "trebuchet" || e.kind === "mangonel")) {
      const rel = (meta?.pose_release_deg ?? RELEASE[e.kind]) * Math.PI / 180, sw = THROW_S[e.kind], cyc = ENG[e.kind].visS;
      const t = now - e.lastShot; let a = 0;
      if (t >= 0 && t < sw) { const q = t / sw; a = rel * q * q; }
      else if (t >= sw && t < sw + 0.5) a = rel * (1 + 0.06 * Math.sin((t - sw) * 20) * (1 - (t - sw) / 0.5)); // over-swing and settle
      else if (t >= sw + 0.5 && t < cyc * 0.8) a = rel * (1 - Math.min(1, (t - sw - 0.5) / Math.max(1, cyc * 0.8 - sw - 0.5)));
      reset(P.arm); P.arm.rotation.x += a;
      for (const n of ["counterweight", "ropes"]) if (P[n] && P[n].parent === P.arm) { reset(P[n]); P[n].rotation.x -= a; }
      if (P.sling) P.sling.visible = !(t >= 0 && t < sw + 1.5);
    }
    if (P.ram) { reset(P.ram); if (e.battering) { const ph = ((now - e.swingT) / (ENG.ram.visS * 0.9)); const s = Math.sin(Math.min(1, ph) * Math.PI * 2); P.ram.position.z += (ph < 1 ? s : 0) * -0.8 + 0.3; P.ram.rotation.x += (ph < 1 ? s : 0) * 0.04; } }
    if (P.bridge) { reset(P.bridge); const cw = e.docked && w?.castleWallAt?.(e.docked.x, e.docked.y), tilt = cw ? Math.atan2(cw[0] + map.h(e.docked.x, e.docked.y) - map.h(e.x, e.y) - 7.5, 3.2) : 0; P.bridge.rotation.x += (e.bridge || 0) * (Math.PI / 2 - tilt); } // (onto a castle's wall-walk: the bridge tilts to meet it)
    if (P.bolt) P.bolt.visible = !(now - e.lastShot >= 0 && now - e.lastShot < 1.5);
    if (P.bow_l || P.bow_r) { const t = now - e.lastShot, f = t >= 0 && t < 0.3 ? Math.sin(t / 0.3 * Math.PI) * 0.3 : 0; if (P.bow_l) { reset(P.bow_l); P.bow_l.rotation.z += f; } if (P.bow_r) { reset(P.bow_r); P.bow_r.rotation.z -= f; } }
    // wheels roll with the ground covered
    if (S.wheels.length) { const d = (e.roll || 0) - (S.rolled || 0); S.rolled = e.roll || 0; for (const wh of S.wheels) wh.rotation.x += d / Math.max(0.2, wh.position.y || 0.45); }
  }

  function update(w, now, dt, cam, visible = () => true) {
    const Z = w.siege; if (!Z) return;
    const live = new Set();
    for (const e of Z.engines) {
      live.add(e.id);
      const key = stateName(e) + "|" + e.team;
      let S = shown.get(e.id);
      if (!S || S.key !== key) {
        if (!pending.has(e.id)) {
          pending.add(e.id);
          build(e, stateName(e)).then((ns) => { pending.delete(e.id); const old = shown.get(e.id); if (old) group.remove(old.obj); ns.key = key; shown.set(e.id, ns); group.add(ns.obj); });
        }
        if (!S) continue;
      }
      S.obj.visible = visible(e);
      if (!S.obj.visible) continue;
      place(S.obj, e); animate(S, e, now, dt, w);
    }
    for (const [id, S] of shown) if (!live.has(id)) { group.remove(S.obj); shown.delete(id); }
    // shots
    let ns = 0, nb = 0;
    for (const s of Z.shots) {
      const u = Math.max(0, Math.min(1, (now - s.t0) / Math.max(0.05, s.t1 - s.t0)));
      const x = s.x0 + (s.x1 - s.x0) * u, y = s.y0 + (s.y1 - s.y0) * u, h = s.h0 + (s.h1 - s.h0) * u + 4 * s.apex * u * (1 - u);
      if (s.kind === "stone" && ns < 64) { const r = s.big ? 0.28 : 0.13; tmp.position.set(x, h, -y); tmp.rotation.set(now * 3, now * 2, 0); tmp.scale.setScalar(r); tmp.updateMatrix(); stones.setMatrixAt(ns++, tmp.matrix); }
      else if (s.kind === "bolt" && nb < 64) {
        const u2 = Math.min(1, u + 0.02), x2 = s.x0 + (s.x1 - s.x0) * u2, y2 = s.y0 + (s.y1 - s.y0) * u2, h2 = s.h0 + (s.h1 - s.h0) * u2 + 4 * s.apex * u2 * (1 - u2);
        tmp.position.set(x, h, -y); tmp.lookAt(x2, h2, -y2); tmp.scale.setScalar(1); tmp.updateMatrix(); bolts.setMatrixAt(nb++, tmp.matrix);
      }
    }
    stones.count = ns; bolts.count = nb; stones.instanceMatrix.needsUpdate = bolts.instanceMatrix.needsUpdate = true;
    // impacts: a burst of dust, and chips of stone or timber thrown up
    for (const im of Z.impacts) {
      if (seenImpact.has(im)) continue; seenImpact.add(im);
      if (now - im.t > 1.5) continue;
      const h = im.h ?? map.h(im.x, im.y);
      if (im.kind !== "bolt") fx?.dust(im.x, h, im.y, im.size || 1);
      const n = im.kind === "debris" ? 10 : im.kind === "splinter" ? 5 : im.kind === "dust" ? 4 : 0;
      for (let k = 0; k < n && debris.length < 240; k++) debris.push({ x: im.x, y: h + 0.3, z: -im.y, vx: (Math.random() - 0.5) * 6, vy: 3 + Math.random() * 6, vz: (Math.random() - 0.5) * 6, age: 0, life: 2.5, g: h, rx: Math.random() * 6, s: 0.5 + Math.random() * (im.kind === "debris" ? 1.4 : 0.6) });
    }
    let nd = 0;
    for (const d of debris) {
      d.age += dt; if (d.age > d.life) continue;
      d.vy -= 9.8 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; if (d.y < d.g) { d.y = d.g; d.vx *= 0.5; d.vz *= 0.5; d.vy = Math.abs(d.vy) * 0.25; }
      tmp.position.set(d.x, d.y, d.z); tmp.rotation.set(d.rx + d.age * 5, d.age * 3, 0); tmp.scale.setScalar(d.s); tmp.updateMatrix(); chips.setMatrixAt(nd, tmp.matrix); debris[nd++] = d;
    }
    debris.length = nd; chips.count = nd; chips.instanceMatrix.needsUpdate = true;
    // ladders against the walls: foot 1.6 m out from the wall's face, head at the wall-walk
    const L = Z.ladders || [];
    while (ladders.pool.length < L.length) { let m = ladderMesh(); if (ladderSrc) { m = new THREE.Group(); const c = ladderSrc.scene.clone(true); c.rotation.x = Math.PI / 2; m.add(c); } ladders.pool.push(m); ladders.group.add(m); } // (ladder.glb stands along glTF +Y: turned to lie along +Z like the placeholder, which lookAt aims)
    ladders.pool.forEach((m, k) => {
      const l = L[k]; m.visible = !!l; if (!l) return;
      const cw = w.castleWallAt?.(l.x, l.y); // a castle curtain (js/render/castle.js): its head rests on the parapet at the wall-walk
      const hx = l.x + l.nx * (cw ? cw[1] : 0), hy = l.y + l.ny * (cw ? cw[1] : 0), out = cw ? 2.6 : 1.6;
      const fx0 = hx + l.nx * out, fy0 = hy + l.ny * out, g = map.h(fx0, fy0), H = cw ? cw[0] + 0.9 : (l.h || 4) + 0.6, len = Math.hypot(H + map.h(hx, hy) - g, out);
      m.position.set(fx0, g, -fy0);
      if (l.up) { m.lookAt(hx, map.h(hx, hy) + H, -hy); m.scale.set(1, 1, ladderSrc ? len / 7 : len); }
      else { m.lookAt(fx0 + l.nx * 5, g, -(fy0 + l.ny * 5)); m.scale.set(1, 1, ladderSrc ? len / 7 : len); }
    });
  }
  const stats = () => ({ engines: shown.size, pending: pending.size, shots: stones.count + bolts.count, debris: debris.length });
  return { group, update, stats };
}
