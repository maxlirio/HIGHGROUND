// PLACING A BUILDING READ FROM THE LAND (Build → a building). The owner (2026-10-03): "make a program that reads the land
// and tells you where you can build things. Like it shows where you can have walls BASED on the layout of your village."
//   • a building: the ground shows where that kind may go (js/sim/siting.js siteHeat — green, brighter where it suits the
//     kind best: fronting a lane, near the middle, on a rise for a church, the edge of the village for the big yards; a
//     faint red where the town's ground will not take it), and a GHOST of its footprint follows the pointer, snapped to the
//     nearest good spot (a plot of the plan first) and turned to face the lane — green with what makes the spot good, or red
//     with why not. Click to stake it out (the "place" command: the server snaps exactly as the preview did).
//   • a wall or a gate: the CIRCUIT the village asks for as it stands now (siting.js suggestCircuit) is drawn round it —
//     the stretches open to build bright, the ones standing grey, the ones the land refuses red, the gates gold where the
//     lanes leave. Hover a stretch and click to accept it; or press and DRAG your own line (checked as you draw: water, rock,
//     steep ground, buildings, fields, other walls, roads that want a gate), release to raise it.
// X cancels (main.js deselect).
import * as THREE from "three";
import * as SI from "../sim/siting.js";
import { BUILDINGS } from "../sim/econ-data.js";
import * as FD from "../sim/founding.js";

const SEG = 10;
export function makeSitingUI({ scene, map, w, team, canvas, groundAt, run, toast, ctxOpts, onDone }) {
  let st = null; // { kind, wall, C, heat, circ, sig, drag, ghost }
  const hint = document.createElement("div"); hint.id = "sitehint"; hint.hidden = true;
  Object.assign(hint.style, { position: "fixed", pointerEvents: "none", zIndex: 30, background: "rgba(24,20,14,.9)", color: "#efe6cf", font: "13px/1.35 Georgia, serif", padding: "6px 9px", borderRadius: "4px", maxWidth: "340px", border: "1px solid #6b5a3a" });
  document.body.append(hint);
  // ---- the heat on the ground: a draped grid, a colour (with alpha) per vertex
  const heatMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, depthTest: false }); // (over the trees too: a mill's stream runs in the woods)
  let heatMesh = null;
  function drawHeat(H) {
    if (heatMesh) { scene.remove(heatMesh); heatMesh.geometry.dispose(); heatMesh = null; }
    if (!H) return;
    const { nx, ny, x0, y0, cell, v, st: S } = H, pos = new Float32Array(nx * ny * 3), col = new Float32Array(nx * ny * 4), idx = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = x0 + i * cell, y = y0 + j * cell;
      pos[k * 3] = x; pos[k * 3 + 1] = (map.inBounds(x, y) ? map.h(x, y) : 0) + 0.5; pos[k * 3 + 2] = -y;
      if (S[k] === 2) { const t = v[k]; col.set([0.25 + 0.35 * t, 0.55 + 0.45 * t, 0.2 + 0.25 * t, 0.12 + 0.36 * t], k * 4); }
      else if (S[k] === 1) col.set([0.95, 0.26, 0.18, 0.26], k * 4);
      else col.set([0, 0, 0, 0], k * 4);
    }
    for (let j = 0; j + 1 < ny; j++) for (let i = 0; i + 1 < nx; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      if (!S[a] && !S[b] && !S[c] && !S[d]) continue;
      idx.push(a, b, c, b, d, c); // (counter-clockwise seen from above: the world's y is the scene's −z)
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 4));
    g.setIndex(idx.length > 65000 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    heatMesh = new THREE.Mesh(g, heatMat); heatMesh.renderOrder = 8; heatMesh.frustumCulled = false; scene.add(heatMesh);
  }
  // ---- lines draped on the ground: the ghost, the circuit (LineSegments, coloured per vertex)
  const mkLines = (n, order) => {
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const L = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.97 }));
    L.renderOrder = order; L.frustumCulled = false; L.visible = false; scene.add(L); return L;
  };
  const ghostL = mkLines(4000, 22), circL = mkLines(60000, 21);
  function lineSet(L, segs) { // segs: [[x1, y1, x2, y2, [r, g, b], lift]]
    const P = L.geometry.attributes.position.array, Cc = L.geometry.attributes.color.array, max = P.length / 3; let v = 0;
    for (const [ax, ay, bx, by, c, lift = 1.2] of segs) {
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
      for (let k = 0; k < n && v + 2 <= max; k++) for (const t of [k / n, (k + 1) / n]) { const x = ax + (bx - ax) * t, y = ay + (by - ay) * t; P[v * 3] = x; P[v * 3 + 1] = (map.inBounds(x, y) ? map.h(x, y) : 0) + lift; P[v * 3 + 2] = -y; Cc.set(c, v * 3); v++; }
    }
    L.geometry.setDrawRange(0, v); L.geometry.attributes.position.needsUpdate = L.geometry.attributes.color.needsUpdate = true; L.visible = v > 0;
  }
  const OK = [0.45, 1, 0.45], BAD = [1, 0.32, 0.25], GOLD = [1, 0.84, 0.3], GREY = [0.62, 0.66, 0.72];
  // a rectangle's outline (three nested loops: one pixel reads thin from Eagle) and a tick on its front
  function rectSegs(x, y, rot, W, Hh, c, out = [], halo = false) {
    const co = Math.cos(rot), si = Math.sin(rot);
    if (halo) { const r = Math.max(W, Hh) / 2 + 6; for (const rr of [r, r + 0.6]) for (let k = 0; k < 28; k++) { const a = k / 28 * 6.283, b = (k + 1) / 28 * 6.283; out.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr, x + Math.cos(b) * rr, y + Math.sin(b) * rr, c, 1.4]); } }
    for (const inset of [0, 0.4, 0.8, 1.2]) {
      const hw = Math.max(0.3, W / 2 - inset), hh = Math.max(0.3, Hh / 2 - inset), P = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([a, b]) => [x + a * co - b * si, y + a * si + b * co]);
      for (let k = 0; k < 4; k++) out.push([...P[k], ...P[(k + 1) % 4], c, 1.4]);
    }
    const fx = x + Hh / 2 * si, fy = y - Hh / 2 * co; out.push([fx, fy, fx + 3 * si, fy - 3 * co, c, 1.4]); // (the front: local −y)
    return out;
  }
  function bandSegs(x1, y1, x2, y2, c, half, out = [], lift = 1.3) {
    const L = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / L, ny = (x2 - x1) / L;
    for (const o of half > 0 ? [-half, 0, half] : [0]) out.push([x1 + nx * o, y1 + ny * o, x2 + nx * o, y2 + ny * o, c, lift]);
    return out;
  }
  function drawCircuit(circ, hot = null) {
    const segs = [];
    for (const s of circ?.stretches || []) {
      const c = s.state === "standing" ? GREY : s.state === "blocked" ? BAD : s.gate ? GOLD : OK, half = s === hot ? 2.2 : s.state === "open" ? 1.1 : 0.6;
      if (s.state === "blocked") { const L = s.len, n = Math.max(1, Math.round(L / 6)); for (let k = 0; k < n; k += 2) { const a = k / n, b = Math.min(1, (k + 1) / n); bandSegs(s.x1 + (s.x2 - s.x1) * a, s.y1 + (s.y2 - s.y1) * a, s.x1 + (s.x2 - s.x1) * b, s.y1 + (s.y2 - s.y1) * b, c, 0.6, segs); } }
      else bandSegs(s.x1, s.y1, s.x2, s.y2, c, half, segs);
      if (s.gate) { const m = [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2]; rectSegs(m[0], m[1], Math.atan2(s.y2 - s.y1, s.x2 - s.x1), 12, 8, s.state === "standing" ? GREY : s.state === "blocked" ? BAD : GOLD, segs); }
      // the joints between stretches: a short tick across the line
      const L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) || 1, nx = -(s.y2 - s.y1) / L * 2.5, ny = (s.x2 - s.x1) / L * 2.5;
      segs.push([s.x1 - nx, s.y1 - ny, s.x1 + nx, s.y1 + ny, c, 1.3]);
    }
    lineSet(circL, segs);
  }
  // ---- the town's context (re-read when what stands changes: the realm's mirror updates as the server builds)
  const sigOf = () => { let s = w.buildings.length; for (const b of w.buildings) s = (s * 31 + b.id * 7 + (b.ruin ? 1 : 0) + (b.progress >= 1 ? 2 : 0)) % 1e9; return s; };
  function refresh(force = false) {
    if (!st) return;
    const sig = sigOf(); if (!force && sig === st.sig) return;
    st.sig = sig; st.C = SI.siteContext(w, team, ctxOpts());
    if (st.wall) { st.circ = SI.suggestCircuit(st.C); drawCircuit(st.circ); drawHeat(null); }
    else { st.heat = SI.siteHeat(st.C, st.kind, st.camp ? { center: st.center } : {}); drawHeat(st.heat); }
  }
  let timer = null;
  function start(kind) {
    cancel(true);
    const wall = SI.WALL_KINDS.has(kind) || SI.GATE_KINDS.has(kind);
    st = { kind, wall, gate: SI.GATE_KINDS.has(kind), camp: !!SI.campRule(kind), C: null, sig: -1, drag: null };
    refresh(true);
    timer = setInterval(() => refresh(), 1500);
    const name = BUILDINGS[kind]?.name || kind;
    if (st.wall && st.circ?.error) toast(`${name}: ${st.circ.error}`);
    else if (st.gate) toast(`${name}: click a gold gate on the circuit — where a lane or road leaves the village`);
    else if (st.wall) toast(`${name}: click a bright stretch of the circuit your village asks for, or drag your own line`);
    else if (st.camp) toast(`${name}: the green ground is beside what it will work — click there`);
    else toast(`${name}: the green ground can take it (brighter suits it better) — click to stake it out`);
    return st;
  }
  // FOUNDING (Build → a new Keep & Manor): the ground shows where the house may found a town (siting.js foundHeat); the
  // settlers' card and the click are the founding mode's (js/ui/settling.js) — this only lights the land under it
  function found(isActive) {
    cancel(true);
    st = { found: true, center: null, isActive };
    const redo = (c) => { st.center = c; const H = SI.foundHeat(w, team, c, FD); drawHeat(H); if (H.error) toast(`No new town: ${H.error}`); };
    redo(ctxOpts().hub || { x: map.cx ?? map.size / 2, y: map.cy ?? map.size / 2 });
    timer = setInterval(() => { if (!st?.found) return; if (!st.isActive()) { cancel(); return; } }, 400);
    st.redo = redo;
  }
  function cancel(keepHint = false) {
    st = null; if (timer) { clearInterval(timer); timer = null; }
    drawHeat(null); circL.visible = false; ghostL.visible = false; if (!keepHint) hint.hidden = true;
  }
  function showHint(e, html) { hint.innerHTML = html; hint.style.left = Math.min(innerWidth - 350, e.clientX + 18) + "px"; hint.style.top = Math.min(innerHeight - 90, e.clientY + 18) + "px"; hint.hidden = false; }
  const cost = (kind, len = 1) => { const d = BUILDINGS[kind]; if (!d) return ""; const parts = Object.entries(d.mat || {}).map(([r, n]) => `${n * len >= 1000 ? (n * len / 1000).toFixed(1) + " t" : Math.round(n * len) + " kg"} ${r}`); if (d.money) parts.push(`${d.money} d`); return parts.join(", "); };
  // ---- the pointer: the ghost and its reason
  function hover(e) {
    if (!st || st.drag?.moved) return;
    const p = groundAt(e.clientX, e.clientY); if (!p) { ghostL.visible = false; hint.hidden = true; return; }
    if (st.found) { if (Math.hypot(p.x - st.center.x, p.y - st.center.y) > 600) st.redo({ x: p.x, y: p.y }); return; }
    const name = BUILDINGS[st.kind]?.name || st.kind;
    if (st.camp && (!st.center || Math.hypot(p.x - st.center.x, p.y - st.center.y) > 140)) { st.center = { x: p.x, y: p.y }; refresh(true); }
    if (st.wall) {
      if (st.circ?.error) { showHint(e, `<b style="color:#ff8a70">${name}</b><br>${st.circ.error}`); ghostL.visible = false; return; }
      const s = SI.stretchNear(st.circ, p.x, p.y, { maxD: 30, gate: st.gate });
      drawCircuit(st.circ, s);
      if (!s) { ghostL.visible = false; showHint(e, st.gate ? `<b>${name}</b><br>move to a gold gate on the circuit` : `<b>${name}</b><br>move onto a stretch of the circuit to accept it — or press and drag your own line`); return; }
      const segs = bandSegs(s.x1, s.y1, s.x2, s.y2, s.state === "open" ? OK : s.state === "standing" ? GREY : BAD, 2.4, [], 1.6);
      lineSet(ghostL, segs);
      const what = s.gate ? "gate" : `${Math.round(s.len)} m stretch`;
      if (s.state === "standing") showHint(e, `<b style="color:#c9d2de">${what}: built</b><br>${s.why}${st.kind === "stone_wall" && !s.gate ? " — click to rebuild it in stone" : ""}`);
      else if (s.state === "blocked") showHint(e, `<b style="color:#ff8a70">${what}: not here</b><br>${s.why}<br><i>drag your own line round it</i>`);
      else showHint(e, `<b style="color:#9be29b">${name} — ${what}${s.road ? ` across ${s.road}` : ""}</b><br>${cost(st.kind, s.gate ? 1 : s.len)}<br><i>click to accept it · or drag your own line</i>`);
      st.hot = s; return;
    }
    const r = SI.snapSite(st.C, st.kind, p.x, p.y);
    lineSet(ghostL, rectSegs(r.x, r.y, r.rot, r.w, r.h, r.ok ? OK : BAD, [], true));
    if (r.ok) showHint(e, `<b style="color:#9be29b">${name}</b> — ${r.note || "good ground"}<br>${cost(st.kind)}<br><i>click to stake it out</i>`);
    else showHint(e, `<b style="color:#ff8a70">${name}: not here</b><br>${r.why}`);
    st.last = r;
  }
  addEventListener("pointermove", (e) => {
    if (!st) return;
    if (st.drag) { // a wall line being drawn
      const d = st.drag; if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 8) return;
      d.moved = true; e.stopImmediatePropagation();
      const p = groundAt(e.clientX, e.clientY); if (!p) return;
      const [bx, by] = SI.snapWallEnd(st.C, st.circ, p.x, p.y); d.b = [bx, by];
      d.chk = SI.checkWallLine(st.C, st.kind, d.a[0], d.a[1], bx, by);
      lineSet(ghostL, bandSegs(d.a[0], d.a[1], bx, by, d.chk.ok ? OK : BAD, 1.8, [], 1.6));
      const name = BUILDINGS[st.kind]?.name || st.kind;
      showHint(e, d.chk.ok ? `<b style="color:#9be29b">${name} — ${Math.round(d.chk.len)} m</b><br>${cost(st.kind, d.chk.len)}<br><i>release to raise it</i>` : `<b style="color:#ff8a70">${name} — ${Math.round(d.chk.len)} m: not here</b><br>${d.chk.why}`);
      return;
    }
    if (performance.now() - (st.hoverT || 0) < 90) return; st.hoverT = performance.now();
    hover(e);
  }, true);
  // walls: a press starts a line (a click with no drag accepts the stretch under the pointer: main.js placeAt)
  window.addEventListener("pointerdown", (e) => {
    if (!st || !st.wall || st.gate || e.button !== 0 || e.altKey || e.target !== canvas) return;
    const p = groundAt(e.clientX, e.clientY); if (!p) return;
    e.stopImmediatePropagation();
    st.drag = { sx: e.clientX, sy: e.clientY, a: SI.snapWallEnd(st.C, st.circ, p.x, p.y), moved: false };
  }, true);
  window.addEventListener("pointerup", (e) => {
    if (!st?.drag || e.button !== 0) return;
    const d = st.drag; st.drag = null; e.stopImmediatePropagation();
    if (!d.moved) { const p = groundAt(e.clientX, e.clientY); if (p) place(p.x, p.y); return; }
    if (!d.chk?.ok) { toast(`No wall there: ${d.chk?.why || "draw it along the ground"}`); ghostL.visible = false; return; }
    const kind = st.kind;
    run("place", { kind, x: d.a[0], y: d.a[1], x2: d.b[0], y2: d.b[1] }, (r) => { if (!r) return; if (!r.ok) { toast(r.error || "The wall could not be raised there"); return; } if (r.msg) toast(r.msg); if (st?.kind === kind) refresh(true); });
  }, true);
  // the click (main.js placeAt for a building; a wall's click without a drag here)
  function place(x, y) {
    if (!st) return;
    const kind = st.kind, wall = st.wall;
    run("place", { kind, x, y }, (r) => {
      if (!r) return;
      if (!r.ok) { toast(r.error || "Not there"); return; }
      if (r.msg) toast(r.msg);
      if (wall && st?.kind === kind) { refresh(true); return; } // (a wall: keep going round the circuit)
      if (st?.kind === kind) { cancel(); onDone?.(); }
    });
  }
  return { get heatMesh() { return heatMesh; }, start, found, cancel, place, hover, refresh, get active() { return !!st; }, get state() { return st; } };
}
