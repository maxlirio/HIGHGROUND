// THE VEINS, drawn (the sim is js/sim/veins.js): a mine mouth at each silver or gold vein's working, and its holder's flag.
//
//   • WHERE: the realm draws every vein at the SERVER's position (w.veins, sent by server/views.mjs: a vein's working
//     was moved to its crag's foot, and a hold's own vein exists only on the server); the map's static vein rock up
//     on the face is not drawn there (main.js). Single-player draws the flags at the map's veins (w.resources).
//   • THE MOUTH (realm): the labour lane's own adit (js/render/jobs/quarry.js: the mound, the timbered portal, the rails, the
//     spoil heap), drawn from the vein's "works" item — or, for a vein nobody has worked yet, from a stand-in works item the
//     page adds (facing out from the face, v.face), dropped when the real one arrives.
//   • THE FLAG: a pole beside the mouth with the holder's arms (buildings.js teamFlagMat: the house's banner, waving).
//     While a flag is being hoisted (v.cap: { by, t0, s }) the taker's banner climbs the pole as the holder's comes
//     down, over the hoisting's seconds of game time; when it is up the holder changes and the next state shows it.
//   • A FIND (js/sim/prospect.js: v.source "prospect"): the outcrop that gave it away — grey rock broken open with the ore
//     glinting in it (galena-silver or gold) — the prospectors' trial pit and its spoil, by the mouth. A find another house
//     made is not drawn until it has been worked (the realm's server sends it only then; single player: the same rule here).
//   • WORKED OUT (amount gone; the realm's band "spent"): no flag on the pole, the working barred with crossed boards and a
//     heap of dead spoil — at a glance, a mine with nothing left in it.
// Cheap: a few meshes per vein (there are ~20), heights re-read from the land every couple of seconds (streamed tiles).
import * as THREE from "three";
import { teamFlagMat } from "./buildings.js";
import { frame as worksFrame, ADIT } from "../sim/jobs/quarry.js"; // (the worked adit's own frame: the pole stands beside its portal)

const POLE_H = 8, CLOTH_W = 2.6, CLOTH_H = 1.9, LOW = 1.6;
const timberMat = new THREE.MeshStandardMaterial({ color: "#5b4530", roughness: 0.9 }); // (the pole's cap)
const poleMat = new THREE.MeshStandardMaterial({ color: "#5a4631", roughness: 0.9 });
const rockMat = new THREE.MeshStandardMaterial({ color: "#a39d90", roughness: 0.95, flatShading: true }); // (the outcrop)
// the ore, bright where the rock is broken (no environment map to reflect: lit by its own sheen, not by metalness)
const oreMat = { silver_vein: new THREE.MeshStandardMaterial({ color: "#e4e9f0", metalness: 0.2, roughness: 0.25, emissive: "#6c7480", emissiveIntensity: 0.55, flatShading: true }), // (galena)
  gold_vein: new THREE.MeshStandardMaterial({ color: "#f3c640", metalness: 0.2, roughness: 0.25, emissive: "#7a560c", emissiveIntensity: 0.6, flatShading: true }) };
const pitMat = new THREE.MeshStandardMaterial({ color: "#2e2418", roughness: 1 }), spoilMat = new THREE.MeshStandardMaterial({ color: "#6e5a40", roughness: 1, flatShading: true });
const deadMat = new THREE.MeshStandardMaterial({ color: "#9a958a", roughness: 1, flatShading: true }), boardMat = new THREE.MeshStandardMaterial({ color: "#4a3a28", roughness: 0.95 });
const rnd = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };
// a part that sits on the land at (a, b) of the working's frame — a along the face, b out toward the working floor (the
// adit's own frame once there is one: js/sim/jobs/quarry.js frame; till then the vein's facing) — its height following
// the land (placeParts). turn: a board's lean in the plane of the portal.
function onGround(g, list, m, a, b, y0, turn = null) { m.userData.fa = a; m.userData.fb = b; m.userData.gy0 = y0; m.userData.turn = turn; g.add(m); list.push(m); return m; }
// the outcrop that gave the find away, the trial pit and its spoil: on the working floor to either side of the mound the
// adit is driven into (ADIT: the mound ~9 m out, the portal ~15 m, the ore heap ~22 m), where they stay in sight
function findParts(g, list, v) {
  const ore = oreMat[v.kind] || oreMat.silver_vein, oa = -19, ob = 17;
  for (let k = 0; k < 6; k++) { // broken rock, two of the lumps showing the ore
    const a = rnd(v.id, k * 3 + 1) * 6.283, d = 0.6 + rnd(v.id, k * 3 + 2) * 2.4, sc = 0.55 + rnd(v.id, k * 3 + 3) * 0.75;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(sc, 0), k % 3 === 2 ? ore : rockMat);
    m.scale.set(1, 0.7, 1.1); m.rotation.set(rnd(v.id, k + 40) * 3, rnd(v.id, k + 50) * 3, 0);
    onGround(g, list, m, oa + Math.cos(a) * d, ob + Math.sin(a) * d, sc * 0.45);
  }
  for (let k = 0; k < 7; k++) { // the glint: broken pieces of ore lying about it
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.16 + rnd(v.id, k + 60) * 0.14, 0), ore);
    const a = rnd(v.id, k + 70) * 6.283, d = 1 + rnd(v.id, k + 80) * 3.2; m.rotation.set(rnd(v.id, k + 90) * 3, rnd(v.id, k + 95) * 3, 0);
    onGround(g, list, m, oa + Math.cos(a) * d, ob + Math.sin(a) * d, 0.08);
  }
  // the trial pit on the other side, and the spoil thrown up beside it
  const pit = new THREE.Mesh(new THREE.CircleGeometry(1.1, 12), pitMat); pit.rotation.x = -Math.PI / 2; onGround(g, list, pit, 25, 25, 0.06);
  const heap = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 5, 0, 6.283, 0, Math.PI / 2), spoilMat); heap.scale.set(1.2, 0.45, 0.9); onGround(g, list, heap, 27.2, 25.5, -0.05);
}
// worked out: the portal barred with crossed boards, a heap of dead grey spoil beside the working
function spentParts(g, list) {
  for (const t of [0.62, -0.62]) onGround(g, list, new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.9, 0.08), boardMat), 0, ADIT.mouth + 0.6, 1.2, t);
  const heap = new THREE.Mesh(new THREE.SphereGeometry(1.8, 8, 5, 0, 6.283, 0, Math.PI / 2), deadMat); heap.scale.set(1.3, 0.5, 1);
  onGround(g, list, heap, -9, ADIT.mouth + 5, -0.05);
}
// where the parts stand: P(a, b) → world [x, y] (the adit's frame, or the vein's facing); rot: the frame's outward direction
function placeParts(s, P, rot, ground) {
  for (const m of s.ground) {
    const [wx, wy] = P(m.userData.fa, m.userData.fb), lx = wx - s.x, ly = wy - s.y;
    m.position.set(lx, m.userData.gy0 + ground(wx, wy) - ground(s.x, s.y), -ly);
    if (m.userData.turn !== null) m.rotation.set(0, Math.atan2(Math.cos(rot), -Math.sin(rot)), m.userData.turn); // (in the portal's plane)
  }
}
const faceFrame = (x, y, f) => (a, b) => [x + Math.cos(f) * b - Math.sin(f) * a, y + Math.sin(f) * b + Math.cos(f) * a];

function clothMesh(team) {
  const mat = teamFlagMat(team); if (!mat) return null;
  const geo = new THREE.PlaneGeometry(CLOTH_W, CLOTH_H, 12, 4); geo.translate(CLOTH_W / 2, 0, 0);
  return new THREE.Mesh(geo, mat);
}

export function makeVeinsRender(scene, map, { realm = false, team = () => null } = {}) { // (team: the viewer — single player's own finds)
  const group = new THREE.Group(); group.name = "veins"; scene.add(group);
  const shown = new Map(); // id → { g, key, flag, flag2, poleParts, x, y, … }
  let ver = -1, nextH = 0, lastKey = "";
  const ground = (x, y) => map.h(x, y);
  function build(v) {
    const g = new THREE.Group();
    const f = Number.isFinite(v.face) ? v.face : 0; // (the way the mouth faces, sim angle: x east, y north)
    // the pole stands beside the mouth, out on the working floor
    const px = Math.cos(f) * 3 - Math.sin(f) * 3.2, py = Math.sin(f) * 3 + Math.cos(f) * 3.2;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, POLE_H, 6), poleMat); pole.position.set(px, POLE_H / 2, -py); g.add(pole);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 4), timberMat); top.position.set(px, POLE_H + 0.1, -py); g.add(top);
    const holder = Number.isInteger(v.holder) ? v.holder : null, by = v.cap ? v.cap.by : null, spent = isSpent(v);
    const flag = holder !== null && !spent ? clothMesh(holder) : null, flag2 = by !== null && by !== holder ? clothMesh(by) : null;
    const gp = []; // (parts on the land)
    if (v.source === "prospect") findParts(g, gp, v);
    if (spent) spentParts(g, gp);
    for (const c of [flag, flag2]) if (c) { c.position.set(px + 0.1, POLE_H - CLOTH_H / 2 - 0.1, -py); c.userData.dx = 0.1; c.rotation.y = 0.5; g.add(c); }
    g.userData = { vid: v.id };
    return { g, flag, flag2, x: v.x, y: v.y, px0: px, py0: py, poleParts: [pole, top, flag, flag2].filter(Boolean), poleKey: "", ground: gp, f };
  }
  const isSpent = (v) => (v.band ? v.band === "spent" : !(v.amount > 1));
  function list(w) {
    if (realm) return w.veins || [];
    const me = team();
    return (w.resources || []).filter((n) => (n.kind === "silver_vein" || n.kind === "gold_vein") && (n.source === "prospect"
      ? n.finder === me || n.holder === me || n.amount < n.start - 1 // (another house's find: not until a pick has gone into it)
      : Number.isInteger(n.holder) && n.holder >= 0));
  }
  function update(w, cam, lo = {}) {
    const L = list(w), now = lo.now ?? performance.now() / 1000, L_list = L, L_veins = (id) => L.find((v) => v.id === id) || null;
    const key = realm ? w.veinsVer || 0 : L.map((v) => `${v.id}:${v.holder}:${v.cap ? v.cap.by : ""}:${isSpent(v) ? 1 : 0}`).join("|");
    if (key !== (realm ? ver : lastKey)) {
      if (realm) ver = key; else lastKey = key;
      const live = new Set();
      for (const v of L) {
        live.add(v.id);
        const k = `${Math.round(v.x)},${Math.round(v.y)},${v.holder},${v.cap ? v.cap.by : ""},${v.face ?? ""},${isSpent(v) ? 1 : 0},${v.source || ""}`;
        const old = shown.get(v.id);
        if (old && old.key === k) { old.v = v; continue; }
        if (old) group.remove(old.g);
        const s = build(v); s.key = k; s.v = v; group.add(s.g); shown.set(v.id, s); nextH = 0;
      }
      for (const [id, s] of shown) if (!live.has(id)) { group.remove(s.g); shown.delete(id); }
    }
    if (now >= nextH) { // (the ground under each, as the land's tiles arrive)
      nextH = now + 2;
      for (const s of shown.values()) {
        s.g.position.set(s.x, ground(s.x, s.y) - 0.05, -s.y);
        const [px, py] = s.poleAt || [s.px0, s.py0], dz = ground(s.x + px, s.y + py) - ground(s.x, s.y); // (the pole's own foot)
        for (const m of s.poleParts) m.userData.y0 ??= m.position.y, m.userData.dz = dz;
        if (s.ground.length) placeParts(s, s.frameP || ((a, b) => faceFrame(s.x, s.y, s.f)(a * 0.45, b * 0.45)), s.frameRot ?? s.f, ground); // (no adit yet: closer in by the mouth) // (the outcrop, the pit, the boards: on the land)
      }
    }
    // THE MOUTH: the labour lane's adit (js/render/jobs/quarry.js) draws every mine from a "works" item. A vein nobody has
    // worked yet has none, so the realm page lends it a stand-in (an unworked adit, facing out from the face: v.face) until
    // the real one arrives; the pole stands beside that adit's portal (the works frame), not on its mound
    if (realm) {
      const L = (w.labor ||= { men: new Map(), items: [], nextItem: 0, ver: 0 }), real = L.items.filter((it) => it.kind === "works" && !it.standIn);
      let changed = false;
      for (let k = L.items.length - 1; k >= 0; k--) { const it = L.items[k]; if (!it.standIn) continue; const v = L_veins(it.vid); if (!v || real.some((q) => Math.abs(q.x - v.x) < 25 && Math.abs(q.y - v.y) < 25)) { L.items.splice(k, 1); changed = true; } }
      for (const v of L_list) if (!real.some((q) => Math.abs(q.x - v.x) < 25 && Math.abs(q.y - v.y) < 25) && !L.items.some((it) => it.standIn && it.vid === v.id)) {
        L.items.push({ id: -1000 - v.id, kind: "works", res: v.kind === "gold_vein" ? "gold" : "silver", x: v.x, y: v.y, rot: Number.isFinite(v.face) ? v.face : 0, team: 0, n: 0, kg: 0, st: "adit:0:0", standIn: true, vid: v.id }); changed = true; }
      if (changed) L.ver++;
    }
    const works = (w.labor?.items || []).filter((it) => it.kind === "works");
    for (const s of shown.values()) {
      const wk = works.find((it) => !it.standIn && Math.abs(it.x - s.x) < 25 && Math.abs(it.y - s.y) < 25) || works.find((it) => it.standIn && it.vid === s.v?.id) || null;
      const pk = wk ? `${wk.id}:${wk.x}:${wk.y}:${wk.rot}:${wk.st}` : "";
      if (pk !== s.poleKey) { // (the pole, its cap and the cloths, as one: moved together)
        s.poleKey = pk;
        let px = s.px0, py = s.py0;
        if (wk) { const [wx, wy] = worksFrame(wk)(4.2, ADIT.mouth + 1.8); px = wx - s.x; py = wy - s.y; }
        s.frameP = wk ? worksFrame(wk) : null; s.frameRot = wk ? wk.rot : null; // (the find's outcrop and a worked-out portal's boards: in the adit's frame)
        for (const m of s.poleParts) { m.position.x = px + (m.userData.dx || 0); m.position.z = -py; }
        s.poleAt = [px, py]; nextH = 0;
      }
      // a flag going up: the taker's climbs as the holder's comes down
      const dz = s.poleParts[0]?.userData.dz || 0;
      for (const m of s.poleParts) if (m !== s.flag && m !== s.flag2) m.position.y = (m.userData.y0 ?? m.position.y) + dz;
      const cap = s.v?.cap;
      if (cap) {
        const p = Math.max(0, Math.min(1, ((w.time || 0) - cap.t0) / (cap.s || 10)));
        const yTop = POLE_H - CLOTH_H / 2 - 0.1, yLow = LOW + CLOTH_H / 2;
        if (s.flag2) s.flag2.position.y = dz + yLow + (yTop - yLow) * p;
        if (s.flag) s.flag.position.y = dz + yTop - (yTop - yLow) * p;
      } else if (s.flag) s.flag.position.y = dz + POLE_H - CLOTH_H / 2 - 0.1;
    }
  }
  return { group, update, stats: () => ({ veins: shown.size }) };
}
