// "FOUND A SETTLEMENT": the player picks a site on the land and sees, before anything is paid, the village the land gives
// there (js/sim/settle.js read through the "settle" command's check: the same answer in the realm, from the server) —
// its lanes, house plots, green, church, circuit and gates drawn on the ground, white where it may be founded, red where it
// may not, and a card with why, what the ground made of it, and the bill (settlers, their families, grain, timber, stone,
// silver). A click founds it: the column sets out (js/sim/founding.js). X or Esc cancels.
import * as THREE from "three";

const CSS = `
#settlecard{position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:40;width:min(470px,calc(100vw - 32px));background:rgba(28,23,16,.93);color:#efe6cf;
  border:1px solid #7a6440;border-radius:6px;font:13px/1.4 Georgia,"Iowan Old Style",serif;padding:10px 12px;box-shadow:0 6px 24px rgba(0,0,0,.45)}
#settlecard h4{margin:0 0 4px;font:600 15px Georgia,serif;color:#f5e2b2;display:flex;gap:8px;align-items:center}
#settlecard .v{font-weight:600}#settlecard .v.ok{color:#9be29b}#settlecard .v.no{color:#ff8a70}
#settlecard ul{margin:4px 0 6px;padding-left:18px}#settlecard li{margin:1px 0}
#settlecard .cost{display:flex;flex-wrap:wrap;gap:4px 12px;margin:4px 0;color:#e2d5b3}#settlecard .cost b{color:#f5e2b2;font-weight:600}
#settlecard .row{display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap}
#settlecard input[type=range]{flex:1;min-width:120px}#settlecard input[type=text]{width:120px;background:#1b1610;color:#efe6cf;border:1px solid #6b5a3a;border-radius:3px;padding:2px 5px;font:13px Georgia,serif}
#settlecard .x{margin-left:auto;background:none;border:0;color:#cdbb92;font-size:16px;cursor:pointer}
#settlecard small{color:#bfae88}
@media (max-width:560px){#settlecard{bottom:70px;font-size:12px}}
`;
const OK_COL = [0.97, 0.93, 0.78], NO_COL = [1, 0.36, 0.28], WALL_OK = [0.55, 0.42, 0.28], WALL_NO = [0.85, 0.2, 0.15];

export function makeSettling({ scene, map, canvas, groundAt, run, toast, onFounded = () => {} }) {
  const style = document.createElement("style"); style.textContent = CSS; document.head.append(style);
  let st = null; // null | { at, chk, n, name, pending, lastAsk }
  // the outline on the ground: one draped line set (segments every few metres, lifted off the grass)
  const MAXV = 120000, geo = new THREE.BufferGeometry(), pos = new Float32Array(MAXV * 3), col = new Float32Array(MAXV * 3);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.92 }));
  lines.renderOrder = 21; lines.frustumCulled = false; lines.visible = false; scene.add(lines);
  // and the filled plan under the lines: tofts, crofts, the green, the court, the church, the lanes, the circuit
  const MAXT = 240000, tgeo = new THREE.BufferGeometry(), tpos = new Float32Array(MAXT * 3), tcol = new Float32Array(MAXT * 4);
  tgeo.setAttribute("position", new THREE.BufferAttribute(tpos, 3)); tgeo.setAttribute("color", new THREE.BufferAttribute(tcol, 4));
  const fills = new THREE.Mesh(tgeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  fills.renderOrder = 20; fills.frustumCulled = false; fills.visible = false; scene.add(fills);
  let tv = 0;
  const tri = (P, c, a, lift) => { for (const [x, y] of P) { if (tv >= MAXT) return; tpos[tv * 3] = x; tpos[tv * 3 + 1] = map.h(x, y) + lift; tpos[tv * 3 + 2] = -y; tcol[tv * 4] = c[0]; tcol[tv * 4 + 1] = c[1]; tcol[tv * 4 + 2] = c[2]; tcol[tv * 4 + 3] = a; tv++; } };
  const fillQuad = (Q, c, a, lift = 0.5) => { // a convex quad, cut into a draped grid (it follows the ground)
    const [p0, p1, p2, p3] = Q, L = Math.max(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), Math.hypot(p3[0] - p0[0], p3[1] - p0[1])), n = Math.max(1, Math.min(8, Math.ceil(L / 8)));
    const at = (u, q) => { const ax = p0[0] + (p1[0] - p0[0]) * u, ay = p0[1] + (p1[1] - p0[1]) * u, bx = p3[0] + (p2[0] - p3[0]) * u, by = p3[1] + (p2[1] - p3[1]) * u; return [ax + (bx - ax) * q, ay + (by - ay) * q]; };
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const A = at(i / n, j / n), B = at((i + 1) / n, j / n), C = at((i + 1) / n, (j + 1) / n), D = at(i / n, (j + 1) / n); tri([A, B, C, A, C, D], c, a, lift); }
  };
  const fillPoly = (P, c, a, lift = 0.5) => { let cx = 0, cy = 0; for (const p of P) { cx += p[0]; cy += p[1]; } cx /= P.length; cy /= P.length; for (let i = 0; i < P.length; i++) { const q = P[(i + 1) % P.length]; fillQuad([[cx, cy], P[i], q, q], c, a, lift); } };
  const ribbon = (pts, wd, c, a, lift = 0.6) => { for (let i = 0; i + 1 < pts.length; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1], l = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / l * wd / 2, ny = (bx - ax) / l * wd / 2; fillQuad([[ax - nx, ay - ny], [bx - nx, by - ny], [bx + nx, by + ny], [ax + nx, ay + ny]], c, a, lift); } };
  const rbox = (x, y, rot, L, W) => { const cs = Math.cos(rot), sn = Math.sin(rot); return [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]].map(([u, q]) => [x + u * cs - q * sn, y + u * sn + q * cs]); };
  function fill(plan, ok) {
    tv = 0;
    if (plan) {
      const red = [0.9, 0.25, 0.2];
      for (const P of plan.crofts || []) fillQuad(P, ok ? [0.55, 0.62, 0.3] : red, 0.32, 0.4);
      for (const P of plan.tofts || []) fillQuad(P, ok ? [0.86, 0.74, 0.52] : red, 0.42, 0.5);
      if (plan.green) fillPoly(plan.green, [0.55, 0.85, 0.42], 0.45, 0.5);
      if (plan.church) fillQuad(plan.church.yard, ok ? [0.78, 0.78, 0.74] : red, 0.4, 0.5);
      if (plan.hall) fillQuad(plan.hall.curia, ok ? [0.62, 0.3, 0.24] : red, 0.4, 0.6);
      for (const L of plan.lanes || []) ribbon(L.pts, Math.max(3, L.w), ok ? [0.6, 0.45, 0.28] : red, 0.6, 0.7);
      if (plan.wall) ribbon(plan.wall, 3.4, ok ? [0.3, 0.22, 0.15] : red, 0.85, 0.9);
      for (const [x, y, r] of plan.houses || []) fillQuad(rbox(x, y, r, 8, 5), ok ? [0.36, 0.22, 0.14] : red, 0.9, 1);
      if (plan.church) fillQuad(rbox(plan.church.x, plan.church.y, plan.church.rot, 22, 9), [0.92, 0.9, 0.84], 0.9, 1);
      if (plan.hall) fillQuad(rbox(plan.hall.x, plan.hall.y, plan.hall.rot, 20, 12), [0.45, 0.14, 0.1], 0.9, 1.1);
      if (plan.mill) fillQuad(rbox(plan.mill.x, plan.mill.y, plan.mill.rot, 14, 10), [0.3, 0.5, 0.85], 0.9, 1);
    }
    tgeo.setDrawRange(0, tv); tgeo.attributes.position.needsUpdate = true; tgeo.attributes.color.needsUpdate = true; fills.visible = tv > 0;
  }
  const card = document.createElement("div"); card.id = "settlecard"; card.hidden = true; document.body.append(card);
  let v = 0;
  const seg = (a, b, c, lift = 0.8) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 4));
    for (let k = 0; k < n && v + 2 < MAXV; k++) for (const t of [k / n, (k + 1) / n]) {
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      pos[v * 3] = x; pos[v * 3 + 1] = map.h(x, y) + lift; pos[v * 3 + 2] = -y; col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2]; v++;
    }
  };
  const ring = (P, c, lift) => { for (let i = 0; i < P.length; i++) seg(P[i], P[(i + 1) % P.length], c, lift); };
  const path = (P, c, lift) => { for (let i = 0; i + 1 < P.length; i++) seg(P[i], P[i + 1], c, lift); };
  const box = (x, y, rot, L, W, c, lift) => { const cs = Math.cos(rot), sn = Math.sin(rot); ring([[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]].map(([u, q]) => [x + u * cs - q * sn, y + u * sn + q * cs]), c, lift); };
  function draw(plan, ok) {
    v = 0;
    if (plan) {
      const c = ok ? OK_COL : NO_COL, dim = c.map((q) => q * 0.72), wc = ok ? WALL_OK : WALL_NO;
      for (const L of plan.lanes || []) { path(L.pts, [0.85, 0.72, 0.5].map((q, i) => ok ? q : NO_COL[i]), 0.7); if (L.w >= 5) path(L.pts.map((p, i, A) => { const q = A[Math.min(A.length - 1, i + 1)], r = A[Math.max(0, i - 1)], dx = q[0] - r[0], dy = q[1] - r[1], l = Math.hypot(dx, dy) || 1; return [p[0] - dy / l * 1.6, p[1] + dx / l * 1.6]; }), [0.85, 0.72, 0.5], 0.7); }
      for (const P of plan.crofts || []) ring(P, dim, 0.6);
      for (const P of plan.tofts || []) ring(P, c, 0.8);
      for (const [x, y, r] of plan.houses || []) box(x, y, r, 8, 5, c, 1.2);
      if (plan.green) ring(plan.green, [0.6, 0.92, 0.5], 0.8);
      if (plan.church) { ring(plan.church.yard, c, 0.9); box(plan.church.x, plan.church.y, plan.church.rot, 22, 9, c, 1.4); }
      if (plan.hall) { ring(plan.hall.curia, c, 1); box(plan.hall.x, plan.hall.y, plan.hall.rot, 20, 12, c, 1.6); }
      for (const y of plan.yards || []) box(y[0], y[1], y[2], y[3], y[4], dim, 0.7);
      if (plan.mill) box(plan.mill.x, plan.mill.y, plan.mill.rot, 14, 10, [0.5, 0.75, 1], 1.2);
      if (plan.wall) for (const off of [0, 1.2, 2.4]) path(plan.wall, wc, 1.4 + off * 0.4);
      for (const g of plan.gates || []) { box(g[0], g[1], 0, 9, 9, ok ? [1, 0.85, 0.4] : NO_COL, 2); box(g[0], g[1], 0.78, 9, 9, ok ? [1, 0.85, 0.4] : NO_COL, 2); }
    }
    geo.setDrawRange(0, v); geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; lines.visible = v > 0;
    fill(plan, ok);
  }
  const t1 = (kg) => kg >= 1000 ? `${(kg / 1000).toFixed(kg >= 10000 ? 0 : 1)} t` : `${Math.round(kg)} kg`;
  function showCard() {
    if (!st) { card.hidden = true; return; }
    const c = st.chk;
    const head = `<h4>Found a settlement <button class="x" data-x title="Cancel (X)">✕</button></h4>`;
    if (!c) { card.innerHTML = head + `<div><small>Move over the land: the village the ground gives there is drawn on it. Click to found it.</small></div>`; card.hidden = false; return; }
    const plan = c.plan, form = plan ? { street: "a street village", green: "a green village", hill: "a hilltop village", bend: "a village in the river's bend" }[plan.form] || "a village" : null;
    const verdict = c.ok ? `<span class="v ok">It may be founded here</span>` : `<span class="v no">Not here</span>`;
    const why = !c.ok ? `<ul>${c.why.map((q) => `<li>${q}</li>`).join("")}</ul>` : "";
    const land = plan ? `<div><b>${form}</b> of ${plan.tofts.length} house plots${plan.wall ? `, a circuit with ${plan.gates.length} gate${plan.gates.length === 1 ? "" : "s"}` : ""}${plan.church ? ", a church" : ""}${plan.mill ? ", a mill" : ""}.</div><ul>${(plan.why || []).slice(0, 4).map((q) => `<li>${q}</li>`).join("")}</ul>` : "";
    const g = c.cost?.goods || {};
    const cost = c.cost ? `<div class="cost"><span><b>${c.settlers}</b> settlers</span><span><b>${c.cost.deps}</b> of their families</span><span><b>${t1(g.grain || 0)}</b> grain</span><span><b>${t1(g.timber || 0)}</b> timber</span><span><b>${t1(g.stone || 0)}</b> stone</span><span><b>${g.silver || 0} d</b> silver</span><span>a cart, an ox team, a flock</span></div>` : "";
    card.innerHTML = head + verdict + why + land + cost + (c.warn?.length ? `<div><small>${c.warn.join(" · ")}</small></div>` : "")
      + `<div class="row"><label>Settlers</label><input type="range" min="20" max="40" step="1" value="${st.n}" data-n><b>${st.n}</b><label>Name</label><input type="text" maxlength="24" placeholder="(the reeve names it)" value="${st.name || ""}" data-name></div>`
      + `<div><small>${c.ok ? "Click the ground to found it here" : "Move to another site"} · X to cancel</small></div>`;
    card.hidden = false;
  }
  card.addEventListener("input", (e) => {
    if (!st) return;
    if (e.target.matches("[data-n]")) { st.n = +e.target.value; e.target.nextElementSibling.textContent = st.n; ask(st.at, true); }
    if (e.target.matches("[data-name]")) st.name = e.target.value;
  });
  card.addEventListener("click", (e) => { if (e.target.closest("[data-x]")) cancel(); });
  function ask(p, force = false) {
    if (!st || !p) return;
    if (!force && st.lastAsk && Math.hypot(st.lastAsk.x - p.x, st.lastAsk.y - p.y) < 12) return;
    if (st.pending) { st.queued = p; return; }
    st.pending = true; st.lastAsk = p;
    run("settle", { x: p.x, y: p.y, n: st.n, check: true }, (r) => {
      if (!st) return; st.pending = false;
      if (r) { st.chk = r; st.chkAt = p; draw(r.plan, !!r.ok); showCard(); }
      if (st.queued) { const q = st.queued; st.queued = null; ask(q); }
    });
  }
  function cancel() { st = null; lines.visible = false; fills.visible = false; card.hidden = true; document.body.classList.remove("settling"); }
  function start() { st = { n: 24, name: "" }; document.body.classList.add("settling"); showCard(); toast("Found a settlement: move over the land to see the village it gives; click to send the settlers"); }
  const own = (e) => st && e.target === canvas;
  let moveT = 0;
  window.addEventListener("pointermove", (e) => {
    if (!own(e)) return;
    const now = performance.now(); if (now - moveT < 140) return; moveT = now;
    const p = groundAt(e.clientX, e.clientY); if (p) { st.at = p; ask(p); }
  }, true);
  window.addEventListener("pointerdown", (e) => {
    if (!own(e) || e.button !== 0) return;
    e.stopImmediatePropagation(); e.preventDefault();
    const p = groundAt(e.clientX, e.clientY); if (!p) return;
    st.press = { x: e.clientX, y: e.clientY, p };
  }, true);
  window.addEventListener("pointerup", (e) => {
    if (!st || !st.press || e.button !== 0) return;
    e.stopImmediatePropagation();
    const pr = st.press; st.press = null;
    if (Math.hypot(e.clientX - pr.x, e.clientY - pr.y) > 8) return; // (a drag: the camera)
    const p = pr.p;
    if (!st.chk || !st.chkAt || Math.hypot(st.chkAt.x - p.x, st.chkAt.y - p.y) > 25) { ask(p, true); toast("Reading the land there…"); return; }
    if (!st.chk.ok) { toast(`Not there: ${st.chk.why[0]}`); return; }
    const name = (st.name || "").trim() || null;
    run("settle", { x: st.chkAt.x, y: st.chkAt.y, n: st.n, name }, (r) => { if (!r) return; if (r.ok) { toast(r.msg); onFounded(r); cancel(); } else toast(r.error || "They could not set out"); });
  }, true);
  addEventListener("keydown", (e) => { if (st && (e.key === "Escape" || e.key === "x" || e.key === "X") && !e.target.closest?.("input,textarea")) cancel(); });
  return { start, cancel, get active() { return !!st; }, get state() { return st; }, draw, preview: (x, y) => { if (!st) start(); st.at = { x, y }; ask(st.at, true); } };
}
