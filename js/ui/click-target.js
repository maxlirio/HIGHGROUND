// "What will this click do?" — ONE answer for the hover tag and for the click itself (the owner: "I can never tell
// what I'm clicking … I want them to fortify close to the enemy, and instead I just get ATTACK THEM").
//
// With companies selected, a left-click lands on, in this order:
//   1. a group's LABEL (its DOM box): an enemy label → attack them; one of ours → select that group
//   2. an enemy MAN: within about one body of him on the screen (≈1 m at his distance, 7..20 px), not hidden behind
//      the castle masonry the click ray met first (a man on the far side of a wall, or below the wall-walk you point at)
//   3. the castle part under the cursor (js/ui/castle-orders.js castlePick): a tower, the wall-walk, the gatehouse …
//   4. the ground
// Holding Alt/Option skips 1 and 2: orders HERE, even over the enemy (like Total War).
// An all-engine selection takes the spot (or the enemy) as its mark, no menu (main.js).
//
// makeClickUI(deps) → { pick(sx, sy, alt) → target, describe(target) → { kind, text, cursor }, confirm(x, y, word, lift),
//   frame() (the confirmation words follow the ground), hoverGid() (the enemy group lit under the cursor) }
// The hover runs at ≤ 20 Hz; the highlight is one reused ribbon mesh; nothing is allocated per frame.
import * as THREE from "three";
import { ARMS, ARM_BY_ID } from "../sim/arms.js";
import { castlePick, castleOrders } from "./castle-orders.js";
import { levelHeight, insideCastle } from "../sim/castle.js";
import { herdAt, SPECIES } from "../sim/wild.js";
import { dragonAt, hpFrac, STAGE_NAME } from "../sim/dragons.js";
import { isVein, holderOf, holderName, VEIN } from "../sim/veins.js"; // (silver and gold veins: whose, and taking them)
import { burnTargetAt } from "../sim/wildfire.js"; // (what will burn under the cursor: a wood, a wall by its length, a building, a field)


const NSEG = 64; // ribbon segments (a closed loop of up to 64 points)

export function makeClickUI({ w, map, scene, canvas, camera, PLAYER, selected, groups, visible, delegated = null, busy = () => false }) {
  const S = w.S, hOf = (i) => w.castleLevelH ? w.castleLevelH(i) || 0 : levelHeight(w, i); // (the height he is drawn at: js/render/castle.js)
  // ---- the tag that follows the cursor
  const tag = document.createElement("div"); tag.id = "clicktag"; tag.hidden = true; document.body.append(tag);
  const style = document.createElement("style");
  style.textContent = `#clicktag { position: fixed; left: 0; top: 0; z-index: 9; pointer-events: none; white-space: nowrap; font: 12px/1.3 ui-sans-serif, system-ui, sans-serif;
      background: #1c1a17e8; color: #efe6cf; border: 1px solid #6b5a3a; border-radius: 3px; padding: 3px 7px; box-shadow: 0 1px 4px #0008; }
    #clicktag[hidden] { display: none; }
    #clicktag.attack { border-color: #d0533f; color: #ffd6cc; } #clicktag.orders { border-color: #d8b25a; } #clicktag.engines { border-color: #c98a3a; }
    #clicktag.select { border-color: #9fc3e8; } #clicktag.none { color: #b9ad94; }
    #clicktag small { color: #a8987a; margin-left: 6px; font-size: 11px; }
    .glab.hov .gbadge { box-shadow: 0 0 0 2px #ff6a4d, 0 0 8px #ff6a4d; }
    .cword { position: absolute; left: 0; top: 0; pointer-events: none; font: 700 13px/1 ui-sans-serif, system-ui, sans-serif; color: #fff2c4; text-shadow: 0 1px 2px #000, 0 0 6px #000;
      white-space: nowrap; animation: cword 1.4s ease-out forwards; }
    .cword.atk { color: #ffb4a4; }
    @keyframes cword { 0% { opacity: 0; margin-top: 4px; } 12% { opacity: 1; margin-top: 0; } 70% { opacity: 1; } 100% { opacity: 0; margin-top: -14px; } }`;
  document.head.append(style);

  // ---- the highlight: one flat ribbon loop (an enemy body's ring, a wall section's edge, a ring on the ground)
  const pos = new Float32Array((NSEG + 1) * 2 * 3), idx = [];
  for (let k = 0; k < NSEG; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });
  const ribbon = new THREE.Mesh(geo, mat); ribbon.renderOrder = 13; ribbon.frustumCulled = false; ribbon.visible = false; scene?.add(ribbon);
  const LX = new Float32Array(NSEG), LY = new Float32Array(NSEG), LZ = new Float32Array(NSEG); // the loop's points (x, y map; z absolute height)
  const COL = { attack: "#ff5a3c", orders: "#ffd35a", castle: "#ffe9a8", engines: "#ffa04a", select: "#9fc3e8" };
  function drawLoop(n, width, color) { // LX/LY/LZ[0..n) → a closed flat ribbon `width` metres wide
    for (let k = 0; k <= NSEG; k++) {
      const i = k < n ? k : 0, p = (i + n - 1) % n, q = (i + 1) % n;
      let tx = LX[q] - LX[p], ty = LY[q] - LY[p]; const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
      const nx = -ty * width / 2, ny = tx * width / 2, o = k * 6;
      pos[o] = LX[i] + nx; pos[o + 1] = LZ[i]; pos[o + 2] = -(LY[i] + ny);
      pos[o + 3] = LX[i] - nx; pos[o + 4] = LZ[i]; pos[o + 5] = -(LY[i] - ny);
    }
    geo.setDrawRange(0, n * 6); geo.attributes.position.needsUpdate = true; mat.color.set(color); ribbon.visible = true;
  }
  const pxPerMAt = (dist) => innerHeight / (2 * Math.tan(camera.cam.fov * Math.PI / 360)) / Math.max(1, dist);
  const camDist = (x, y, z) => { const c = camera.cam.position; return Math.hypot(c.x - x, c.y - z, c.z + y); };
  function ringAt(x, y, r, lift, color) {
    const n = 40, z0 = lift === null ? null : lift;
    for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; LX[k] = px; LY[k] = py; LZ[k] = z0 === null ? map.h(px, py) + 0.4 : z0; }
    drawLoop(n, 3.2 / pxPerMAt(camDist(x, y, map.h(x, y))), color);
  }
  function rectAt(cx, cy, rot, hw, hd, z, color) {
    const c = Math.cos(rot), s = Math.sin(rot), P = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]; let n = 0;
    for (let e = 0; e < 4; e++) { const [a0, b0] = P[e], [a1, b1] = P[(e + 1) % 4]; for (let j = 0; j < 4; j++) { const t = j / 4, a = a0 + (a1 - a0) * t, b = b0 + (b1 - b0) * t; LX[n] = cx + a * c - b * s; LY[n] = cy + a * s + b * c; LZ[n] = z; n++; } }
    drawLoop(n, 3.2 / pxPerMAt(camDist(cx, cy, z)), color);
  }

  // ---- screen projection (one reused vector)
  const V = new THREE.Vector3();
  function scr(x, y, z) { V.set(x, z, -y).project(camera.cam); return V.z < 1 && V.z > -1; } // → V.x, V.y in NDC
  const toPx = () => { V.x = (V.x + 1) / 2 * innerWidth; V.y = (1 - V.y) / 2 * innerHeight; };

  // the ground under a screen point, cheaply: march the ray over the heightfield (map.h) and bisect — main.js groundAt
  // raycasts the whole terrain mesh (~28 ms), too dear for a hover at 20 Hz. (The click itself still uses groundAt.)
  const D = new THREE.Vector3();
  function rayGround(sx, sy) {
    const o = camera.cam.position; D.set(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1, 0.5).unproject(camera.cam).sub(o).normalize();
    const ox = o.x, oy = -o.z, oz = o.y, dx = D.x, dy = -D.z, dz = D.y, X0 = map.x0 || 0, Y0 = map.y0 || 0, X1 = X0 + map.size, Y1 = Y0 + map.size;
    const above = (t) => { const x = ox + dx * t, y = oy + dy * t; return oz + dz * t - map.h(Math.max(X0, Math.min(X1, x)), Math.max(Y0, Math.min(Y1, y))); };
    let t0 = 0, t = 0; if (above(0) <= 0) return null;
    while (t < 20000) { t0 = t; t += 1 + t * 0.008; if (above(t) <= 0) break; }
    if (t >= 20000) return null;
    for (let k = 0; k < 14; k++) { const m = (t0 + t) / 2; if (above(m) > 0) t0 = m; else t = m; }
    const x = ox + dx * t, y = oy + dy * t; if (x < X0 || y < Y0 || x > X1 || y > Y1) return null;
    return { x, y, sx, sy };
  }
  const selUnits = () => { const out = []; for (const id of selected) { const u = w.units.get(id); if (u && u.members.length) out.push(u); } return out; };
  const names = (g) => [...g.counts].sort((a, b) => b[1] - a[1]).map(([a, c]) => `${ARM_BY_ID[a % 100]?.name || "men"}${a >= 100 ? ` on ${((a / 100) | 0) === 3 ? "striders" : "drakes"}` : ""} ×${c}`).join(", ");

  // ---- THE pick: what a click at (sx, sy) acts on
  function pick(sx, sy, alt = false) {
    const us = selUnits();
    if (!us.length) return { type: "none" };
    const place = castlePick(w, camera.cam, sx, sy); // (the castle surface the ray meets first, with its distance t)
    if (!alt) {
      // 1. labels (drawn by main.js drawLabels: g._lab = [cx, cy, halfW, halfH] on the screen)
      let best = null, bd = Infinity;
      for (const g of groups()) {
        const L = g._lab; if (!L || !g._shown) continue;
        const dx = Math.abs(sx - L[0]), dy = Math.abs(sy - L[1]);
        if (dx <= L[2] + 3 && dy <= L[3] + 3) { const d = dx + dy; if (d < bd) { bd = d; best = g; } }
      }
      if (best) return best.team === PLAYER ? { type: "own", g: best, place } : { type: "enemy", g: best, via: "label", place };
      // 2. an enemy man right under the cursor
      const occl = place?.part ? place.t : Infinity; // (masonry in front: only what is on or before it)
      let bg = null, bi = -1; bd = Infinity;
      for (const g of groups()) {
        if (g.team === PLAYER || !g._shown) continue;
        for (const u of g.units) for (let k = 0; k < u.members.length; k++) {
          const i = u.members[k]; if (!S.alive[i] || !visible(i)) continue;
          const hh = hOf(i), z = map.h(S.x[i], S.y[i]) + hh + (hh > 0.5 ? 1.45 : 0.9); // (up on a wall: what shows over the parapet — his head and shoulders)
          if (!scr(S.x[i], S.y[i], z)) continue; toPx();
          const dx = V.x - sx, dy = V.y - sy; if (dx > 40 || dx < -40 || dy > 40 || dy < -40) continue;
          const dist = camDist(S.x[i], S.y[i], z), r = Math.min(20, Math.max(7, pxPerMAt(dist) * 1.0)), d = Math.hypot(dx, dy);
          if (d > r || d >= bd) continue;
          if (dist > occl + 0.5) continue; // behind (or below the parapet of) the masonry the cursor is on
          bd = d; bg = g; bi = i;
        }
      }
      if (bg) return { type: "enemy", g: bg, via: "man", man: bi, place };
    }
    const pt = rayGround(sx, sy);
    if (!pt) return { type: "none" };
    if (place && place.kind !== "bailey" || place && insideCastle(w, place.x, place.y)) return { type: "castle", pt, place, alt };
    return { type: "ground", pt, alt };
  }

  // ---- what the tag says (and the kind of click it is)
  let coCache = { key: "", out: null };
  function castleOpts(us, place) {
    const key = `${place.kind}|${place.part?.id ?? ""}|${place.lvl}|${Math.round(place.x / 4)}|${Math.round(place.y / 4)}|${us.map((u) => u.id).join(",")}`;
    if (coCache.key !== key || performance.now() - coCache.t > 1000) coCache = { key, t: performance.now(), out: castleOrders(w, us, place) };
    return coCache.out;
  }
  function nearestEnemy(x, y, R = 200) {
    let bd = R;
    for (let i = 0; i < S.n; i++) { if (!S.alive[i] || S.team[i] === PLAYER || !visible(i)) continue; const u = w.units.get(S.unit[i]); if (!u || u.isWorkers) continue; const d = Math.hypot(S.x[i] - x, S.y[i] - y); if (d < bd) bd = d; }
    return bd < R ? bd : null;
  }
  function nearWall(x, y) { // an enemy wall within reach of ladders here
    for (const b of w.buildings || []) { if (b.team === PLAYER || b.ruin || !b.mods || b.x1 === undefined) continue; const dx = b.x2 - b.x1, dy = b.y2 - b.y1, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - b.x1) * dx + (y - b.y1) * dy) / l2)); if (Math.hypot(b.x1 + dx * t - x, b.y1 + dy * t - y) < 30) return b; }
    return null;
  }
  const partName = (P) => {
    const b = P.part?.bid !== undefined ? w.buildings.find((q) => q.id === P.part.bid) : null, m = (v) => Math.round(v * 2) / 2;
    if (P.town) return P.kind === "twalk" ? `${P.team === PLAYER ? "our" : "their"} ${P.tname === "the palisade" ? "palisade · fighting step" : "town wall · wall-walk"} · ${m(P.h)} m` : P.kind === "ttop" ? `${P.tname} · ${m(P.h)} m` : P.kind === "tbreach" ? "the breach" : P.label.toLowerCase(); // (a town's walls: js/sim/townwall.js)
    if (P.kind === "walk") return b?.label || "the curtain";
    if (P.kind === "tower") return `tower top · ${m(P.h)} m`;
    if (P.kind === "gatehouse") return b?.label && /gatehouse/.test(b.label) ? `${b.label} roof` : "the gatehouse roof";
    if (P.kind === "keep") return P.lvl === 5 ? "the keep roof" : "the keep hall";
    if (P.kind === "breach") return "the breach";
    return P.label ? P.label.toLowerCase() : "the bailey";
  };
  function engineVerb(us) { const eng = us.filter((u) => ARMS[u.arm]?.engine); return eng.some((u) => u.arm === "ram") ? "batter" : eng.some((u) => u.arm === "siege_tower") ? "push the tower to" : "bombard"; }
  const ALT = "<small>⌥ for orders here</small>";
  function describe(T, shift = false) {
    const us = selUnits();
    // a dragon under the cursor: named with or without a selection (js/sim/dragons.js — the hover names a dragon)
    const DG = T && T.pt ? dragonOf(T.pt) : null;
    if (DG) {
      const mine = DG.owner === PLAYER, hp = Math.round(hpFrac(DG) * 100);
      const who = mine ? `${DG.name} — <b>yours</b>, ${STAGE_NAME[DG.stage] || ""}` : DG.owner >= 0 ? `${DG.name} — House ${w.teams[DG.owner]?.name || ""}, ${STAGE_NAME[DG.stage] || ""}` : DG.name;
      const state = DG.mode === "sleep" ? "asleep" : DG.mode === "range" ? "on the wing" : DG.mode === "home" ? "winging home" : DG.mode === "yield" ? "yielded, cowed" : DG.summoned ? "at its lord's call" : "wrathful";
      if (DG.mode === "yield" && DG.brokeBy === PLAYER && !mine) return { kind: "orders", html: `Claim ${DG.name} <small>yielded · ${hp}% · your men must stand over it</small>`, cursor: "cell", dragon: DG.id };
      if (mine) return { kind: "select", html: `${who} <small>${DG.summoned ? "click to recall" : DG.stage >= 3 ? "click to summon" : state} · ${hp}%</small>`, cursor: "pointer", dragon: DG.id };
      const fighters = us.filter((u) => !u.isWorkers && !ARMS[u.arm]?.engine);
      if (fighters.length && DG.mode !== "dead") return { kind: "attack", html: `⚔ Attack · ${who} <small>${state} · ${hp}%</small>`, cursor: "crosshair", dragon: DG.id };
      return { kind: "select", html: `${who} <small>${state}</small>`, cursor: "help", dragon: DG.id };
    }
    if (!T || T.type === "none" || !us.length) return { kind: "none", html: "", cursor: "" };
    const engOnly = us.every((u) => ARMS[u.arm]?.engine), soldiers = us.filter((u) => !u.isWorkers);
    if (T.type === "own") return { kind: "select", html: `${shift ? "Add to selection" : "Select"} · ${names(T.g)}`, cursor: "pointer" };
    if (T.type === "enemy") {
      if (!soldiers.length) return { kind: "none", html: `Villagers won't attack soldiers`, cursor: "not-allowed" };
      if (soldiers.every((u) => ARMS[u.arm]?.engine)) return { kind: "engines", html: `Engines: ${engineVerb(us)} · ${names(T.g)} ${ALT}`, cursor: "crosshair" };
      if (soldiers.every((u) => ARMS[u.arm]?.missile)) return { kind: "attack", html: `🏹 Shoot · ${names(T.g)} ${ALT}`, cursor: "crosshair" };
      return { kind: "attack", html: `⚔ Attack · ${names(T.g)} ${ALT}`, cursor: "crosshair" };
    }
    if (delegated && us.some((u) => delegated(u.id))) return { kind: "none", html: "A captain commands them · take command first", cursor: "not-allowed" };
    const pt = T.pt, P = T.type === "castle" ? T.place : null;
    if (engOnly) {
      const b = !P ? (w.buildings || []).find((q) => q.team !== PLAYER && !q.ruin && !q.field && Math.hypot((q.x ?? 0) - pt.x, (q.y ?? 0) - pt.y) < 25) : null;
      return { kind: "engines", html: `Engines: ${engineVerb(us)} · ${P ? partName(P) : b ? (b.label || "the " + b.kind.replace(/_/g, " ")) : "this spot"}`, cursor: "crosshair" };
    }
    const bits = [];
    if (P) {
      bits.push(partName(P));
      { const B = P.town && soldiers.some((u) => !ARMS[u.arm]?.engine) ? burnTargetAt(w, PLAYER, pt.x, pt.y) : null; if (B?.kind === "building" && !B.stone && !B.why) bits.push(B.own ? "Burn (asks first)" : "Burn possible"); } // (a timber palisade or gate)
      const co = castleOpts(us, P), k = (q) => co.some((o) => o.kind === q);
      if (k("escalade") || k("cs-ladder") && P.h <= 12) bits.push("ladders possible");
      else if (k("cs-ladder")) bits.push("too high for ladders");
      else if (P.kind === "tower" || P.kind === "gatehouse") bits.push(`${P.cap} men fit`);
      else if (P.kind === "keep") bits.push(`${P.lvl === 5 ? P.capRoof : P.capHall} men fit`);
      else if (k("cs-walk")) bits.push("up onto the wall-walk");
      else if (k("cs-tw-walk")) bits.push(`man the wall here · ${P.cap} men along this stretch`);
      else if (k("cs-tw-top")) bits.push(`up the tower · ${P.cap} men fit`);
      else if (P.kind === "walk" && !co.length) bits.push("no way up from here");
    } else if (herdOf(pt)) { // lane C: game under the cursor → the popup offers Hunt first
      const H = herdOf(pt); return { kind: "orders", html: `Hunt · ${SPECIES[H.sp].name} ×${H.n} <small>(orders)</small>`, cursor: "cell", herd: H.id };
    } else if (veinAt(pt)) { // a silver or gold vein (js/sim/veins.js): whose it is, and what these men can do there
      const v = veinAt(pt), h = holderOf(v), soldiers = us.some((u) => !u.isWorkers && !ARMS[u.arm]?.engine), crews = us.some((u) => u.isWorkers);
      const what = h === PLAYER ? (crews ? "your vein · mine it" : "your vein") : h === null ? (crews ? "nobody's · stake a mining camp to claim it" : soldiers ? "nobody's · stand here to hoist your flag" : "nobody's")
        : soldiers ? `${holderName(w, v)}'s · take it: none of theirs left alive here, your flag up in ${VEIN.hoistS} s` : `${holderName(w, v)}'s · only their men mine it`;
      bits.push(`${v.kind === "gold_vein" ? "Gold" : "Silver"} vein · ${what}${v.cap ? " · a flag going up" : ""}`);
    } else {
      // fire (js/sim/wildfire.js): a wood, a wall along its length, a timber building, a field's corn — the popup offers Burn
      const B = soldiers.some((u) => !ARMS[u.arm]?.engine) ? burnTargetAt(w, PLAYER, pt.x, pt.y) : null;
      if (B && !B.stone) bits.push(`${B.kind === "wood" ? B.name.replace(/^the /, "") : (B.own ? "your " : B.b?.team !== PLAYER ? "their " : "") + B.name.toLowerCase()} · ${B.why ? `won't burn: ${B.why}` : B.own ? "Burn (asks first)" : "Burn possible"}`);
      else bits.push(T.alt ? "here" : "open ground");
      const d = nearestEnemy(pt.x, pt.y); if (d !== null) bits.push(`${Math.max(1, Math.round(d))} m from the enemy`);
      if (nearWall(pt.x, pt.y) && us.some((u) => !ARMS[u.arm]?.mounted && !ARMS[u.arm]?.engine && !u.isWorkers)) bits.push("ladders possible");
    }
    return { kind: "orders", html: `Orders · ${bits.join(" · ")}${T.alt ? " <small>(⌥)</small>" : ""}`, cursor: P ? "alias" : "cell" };
  }

  function herdOf(pt) { const H = w.wild ? herdAt(w, pt.x, pt.y, 25) : null; return H && H.n > 0 && (!w.wildSeen || w.wildSeen.has(H.id)) && selUnits().some((u) => !ARMS[u.arm]?.engine) ? H : null; }
  function veinAt(pt) { if (!pt) return null; let best = null, bd = VEIN.r + 10; for (const n of w.resources || []) { if (!isVein(n)) continue; const d = Math.hypot(n.x - pt.x, n.y - pt.y); if (d < bd) { bd = d; best = n; } } return best; }
  function dragonOf(pt) { const D = pt && w.dragons ? dragonAt(w, pt.x, pt.y, 14) : null; return D && D.mode !== "dead" && (D.owner === PLAYER || !w.dragonSeen || w.dragonSeen.has(D.id)) ? D : null; }
  // ---- the highlight for a target
  let hovGid = null;
  function highlight(T, D) {
    hovGid = null;
    if (!T || D.kind === "none" || T.type === "own") { ribbon.visible = false; return; }
    if (T.type === "enemy") {
      const g = T.g; hovGid = g.gid; let r = 3, z = 0, n = 0;
      for (const u of g.units) for (const i of u.members) { if (!S.alive[i]) continue; const d = Math.hypot(S.x[i] - g.x, S.y[i] - g.y); if (d > r) r = d; z += hOf(i); n++; }
      const lift = n ? z / n : 0;
      ringAt(g.x, g.y, r + 2.5, lift > 1 ? map.h(g.x, g.y) + lift + 0.2 : null, COL.attack); return;
    }
    const P = T.type === "castle" ? T.place : null, p = P?.part, col = D.kind === "engines" ? COL.engines : COL.castle;
    const tp = P?.town ? P.tpart : null; // (a town's walls: the stretch, or the tower, under the cursor)
    if (tp?.kind === "run") { rectAt((tp.x1 + tp.x2) / 2, (tp.y1 + tp.y2) / 2, Math.atan2(tp.uy, tp.ux), tp.len / 2, 1.6, tp.z + 1.3, col); return; }
    if (tp) { rectAt(tp.rect.cx, tp.rect.cy, Math.atan2(tp.rect.sa, tp.rect.ca), tp.rect.hw + 0.6, tp.rect.hd + 0.6, (tp.top?.z ?? map.h(tp.cx, tp.cy) + 8) + 1.3, col); return; }
    if (p?.kind === "curtain") { const L = Math.hypot(p.x1 - p.x0, p.y1 - p.y0); rectAt((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, Math.atan2(p.y1 - p.y0, p.x1 - p.x0), L / 2, (p.th || 3) / 2 + 0.6, map.h((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2) + (p.h || p.walkH || 8) + 0.3, col); return; }
    if (p?.kind === "tower") { ringAt(p.x, p.y, p.r + 0.6, map.h(p.x, p.y) + (p.h || P.h) + 0.3, col); return; }
    if (p && p.w !== undefined) { const hd = p.kind === "gatehouse" ? (p.b1 - p.b0) / 2 : (p.d || p.w) / 2, off = p.kind === "gatehouse" ? (p.b0 + p.b1) / 2 : 0, c = Math.cos(p.rot || 0), s = Math.sin(p.rot || 0);
      rectAt(p.x - off * s, p.y + off * c, p.rot || 0, p.w / 2 + 0.6, hd + 0.6, map.h(p.x, p.y) + (P.h || 10) + 0.5, col); return; }
    if (D.herd !== undefined) { const H = w.wild?.herds.find((h) => h.id === D.herd); if (H) { let r = 6; for (const a of w.wild.a) if (a.h === H.id) r = Math.max(r, Math.hypot(a.x - H.cx, a.y - H.cy)); ringAt(H.cx, H.cy, r + 3, null, COL.orders); return; } }
    if (D.dragon !== undefined) { const Dg = w.dragons?.list.find((d) => d.id === D.dragon); if (Dg) { ringAt(Dg.x, Dg.y, 12, (Dg.z || 0) > 1 ? map.h(Dg.x, Dg.y) + Dg.z : null, D.kind === "attack" ? COL.attack : COL.orders); return; } }
    const pt = T.pt, px = pxPerMAt(camDist(pt.x, pt.y, map.h(pt.x, pt.y)));
    ringAt(pt.x, pt.y, Math.max(1.5, 11 / px), null, D.kind === "engines" ? COL.engines : COL.orders);
  }

  // ---- the hover loop (≤ 20 Hz)
  let last = { x: -1, y: -1, alt: false, shift: false, t: 0, on: false }, cur = null;
  function hide() { tag.hidden = true; ribbon.visible = false; hovGid = null; if (canvas.style.cursor) canvas.style.cursor = ""; cur = null; }
  function update(force = false) {
    if (!last.on || !selected.size || busy()) { hide(); return; }
    const now = performance.now(); if (!force && now - last.t < 50) return; last.t = now;
    const T = pick(last.x, last.y, last.alt), D = describe(T, last.shift); cur = { T, D };
    if (!selected.size && D.dragon === undefined) { hide(); return; } // (without a selection only a dragon gets a tag: it is named wherever it is seen)
    if (D.kind === "none" && !D.html) { hide(); return; }
    if (tag._h !== D.html) { tag._h = D.html; tag.innerHTML = D.html; }
    if (tag.className !== D.kind) tag.className = D.kind;
    tag.dataset.kind = D.kind; tag.dataset.type = T.type;
    tag.hidden = false;
    const r = tag.getBoundingClientRect(), x = last.x + 18 + r.width > innerWidth - 6 ? last.x - 14 - r.width : last.x + 18, y = last.y + 20 + r.height > innerHeight - 6 ? last.y - 16 - r.height : last.y + 20;
    tag.style.transform = `translate(${x | 0}px, ${y | 0}px)`;
    if (canvas.style.cursor !== D.cursor) canvas.style.cursor = D.cursor;
    highlight(T, D);
  }
  addEventListener("pointermove", (e) => {
    last.on = e.target === canvas && e.buttons === 0; last.x = e.clientX; last.y = e.clientY; last.alt = e.altKey; last.shift = e.shiftKey;
    if (!last.on) { hide(); return; }
    update();
  });
  const onKey = (e) => { if ((e.key === "Alt" || e.key === "Shift") && last.on) { last.alt = e.altKey; last.shift = e.shiftKey; update(true); } };
  addEventListener("keydown", onKey); addEventListener("keyup", onKey);
  canvas.addEventListener("pointerleave", hide);
  setInterval(() => { if (last.on && selected.size) update(); else if (!tag.hidden) hide(); }, 120); // (the men move under a still cursor)

  // ---- the confirmation word at the spot of an order
  const words = [], wordsEl = document.querySelector("#labels") || document.body;
  function confirm(x, y, word, cls = "", lift = 2) {
    if (!word) return;
    const el = document.createElement("div"); el.className = "cword" + (cls ? " " + cls : ""); el.textContent = word; wordsEl.append(el);
    words.push({ el, x, y, lift, t: performance.now() });
    frame();
  }
  function frame() {
    for (let k = words.length - 1; k >= 0; k--) {
      const q = words[k];
      if (performance.now() - q.t > 1400) { q.el.remove(); words.splice(k, 1); continue; }
      if (!scr(q.x, q.y, map.h(q.x, q.y) + q.lift)) { q.el.style.visibility = "hidden"; continue; } toPx();
      q.el.style.visibility = ""; q.el.style.transform = `translate(${(V.x).toFixed(1)}px, ${(V.y - 14).toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
  return { pick, describe, confirm, frame, hoverGid: () => hovGid, current: () => cur, update: () => update(true), tag };
}
