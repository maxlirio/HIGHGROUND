// DRAWING A FIELD (Build → Open Field). The owner (2026-10-02): "when you try to make a field, you draw your OWN rectangle
// that is orientated toward the direction your camera is facing … the men … actually make it."
//   press on the ground at one corner, drag to size it, release: the rectangle lies SQUARE TO THE VIEW (its sides along and
//   across the camera's look) — turn the camera (Q/E, Option-drag) to angle the field. Its long side is the way the strips
//   and furrows will run. A live outline shows it, green where the men can make it, red where not (and why: water, too
//   steep, a building, a road, another field, too far from the town, too small or too big), with its hectares, the trees to
//   fell, the work it takes and what it would yield. Then CLICK inside it to lay it out (the "field" command:
//   js/game/commands.js → js/sim/jobs/fields.js layField); drag again to redraw; X or Esc to give it up.
// The check is the sim's own (fields.js fieldRect), so the preview and the server agree.
import * as THREE from "three";
import { fieldRect, normRect } from "../sim/jobs/fields.js";

const SEG = 24;   // line segments a side (the outline follows the ground)
export function makeFieldDraw({ scene, map, w, team, camera, canvas, groundAt, run, toast, crew = 6 }) {
  let st = null;   // null | { phase: "aim" | "drag" | "set", a, b, rect, chk }
  // the outline: three nested loops (a line one pixel wide reads thin from the Eagle view), coloured by validity
  const N = 4 * SEG + 1, geo = new THREE.BufferGeometry(), pos = new Float32Array(3 * N * 3), col = new Float32Array(3 * N * 3);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.95 }));
  line.renderOrder = 20; line.frustumCulled = false; line.visible = false; scene.add(line);
  const hint = document.createElement("div"); hint.id = "fieldhint"; hint.hidden = true;
  Object.assign(hint.style, { position: "fixed", pointerEvents: "none", zIndex: 30, background: "rgba(24,20,14,.88)", color: "#efe6cf", font: "13px/1.35 Georgia, serif", padding: "6px 9px", borderRadius: "4px", maxWidth: "330px", border: "1px solid #6b5a3a" });
  document.body.append(hint);

  // the rectangle from two corners, square to the view: its x axis across the screen, its y axis into it
  function rectOf(a, b) {
    const yaw = camera.st.yaw, fx = -Math.sin(yaw), fy = Math.cos(yaw), rx = Math.cos(yaw), ry = Math.sin(yaw);
    const dx = b.x - a.x, dy = b.y - a.y, across = dx * rx + dy * ry, along = dx * fx + dy * fy;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: Math.abs(across), h: Math.abs(along), rot: Math.atan2(ry, rx) };
  }
  function draw(r, ok) {
    const c = Math.cos(r.rot), s = Math.sin(r.rot), [cr, cg, cb] = ok ? [0.45, 1, 0.45] : [1, 0.32, 0.25];
    let v = 0;
    for (const inset of [0, 0.7, 1.4]) {
      const hw = Math.max(0.5, r.w / 2 - inset), hh = Math.max(0.5, r.h / 2 - inset), P = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
      for (let k = 0; k < 4; k++) for (let j = 0; j < SEG; j++) for (const t of [j / SEG, (j + 1) / SEG]) {
        const [ax, ay] = P[k], [bx, by] = P[(k + 1) % 4], lx = ax + (bx - ax) * t, ly = ay + (by - ay) * t, x = r.x + lx * c - ly * s, y = r.y + lx * s + ly * c;
        if (v * 3 + 2 >= pos.length) break;
        pos[v * 3] = x; pos[v * 3 + 1] = map.h(x, y) + 0.9; pos[v * 3 + 2] = -y; col[v * 3] = cr; col[v * 3 + 1] = cg; col[v * 3 + 2] = cb; v++;
      }
    }
    geo.setDrawRange(0, v); geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; line.visible = true;
  }
  const days = (md) => md / Math.max(1, crew);
  function describe(chk) {
    const r = chk.rect, dims = `${Math.round(r.w)} × ${Math.round(r.h)} m · ${chk.ha.toFixed(1)} ha`;
    if (!chk.ok) return `<b style="color:#ff8a70">${dims}</b><br>${chk.why}`;
    const veg = w.obstacles?.veg ? `${chk.trees} tree${chk.trees === 1 ? "" : "s"} to fell, ${chk.bushes} bush${chk.bushes === 1 ? "" : "es"} to grub` : "the trees in it to fell";
    return `<b style="color:#9be29b">${dims}</b><br>${veg}; ~${Math.round(chk.labour)} man-days to clear and break (≈${Math.max(1, Math.round(days(chk.labour)))} days for ${crew} hands)<br>a full crop ≈ ${(chk.yieldKg / 1000).toFixed(1)} t of grain a year in three · <i>${st?.phase === "set" ? "click inside to lay it out · drag to redraw · X to cancel" : "release to set it"}</i>`;
  }
  function show(e, chk) { hint.innerHTML = describe(chk); hint.style.left = Math.min(innerWidth - 340, e.clientX + 18) + "px"; hint.style.top = Math.min(innerHeight - 110, e.clientY + 18) + "px"; hint.hidden = false; }
  function inside(r, p) { const c = Math.cos(r.rot), s = Math.sin(r.rot), dx = p.x - r.x, dy = p.y - r.y; return Math.abs(dx * c + dy * s) < r.w / 2 && Math.abs(dy * c - dx * s) < r.h / 2; }
  function cancel() { st = null; line.visible = false; hint.hidden = true; document.body.classList.remove("fielddraw"); }
  function start() { st = { phase: "aim" }; document.body.classList.add("fielddraw"); toast("Draw the field: press at one corner and drag. It lies square to your view — turn the camera to angle it"); }

  const own = (e) => st && e.target === canvas;
  window.addEventListener("pointerdown", (e) => {
    if (!own(e) || e.button !== 0) return;
    const p = groundAt(e.clientX, e.clientY); if (!p) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (st.phase === "set" && st.rect && inside(st.rect, p)) { st.confirm = { x: e.clientX, y: e.clientY }; return; }
    st = { phase: "drag", a: p, b: p };
  }, true);
  window.addEventListener("pointermove", (e) => {
    if (!st) return;
    if (st.phase === "drag") {
      const p = groundAt(e.clientX, e.clientY); if (!p) return;
      st.b = p; st.rect = rectOf(st.a, st.b); st.chk = fieldRect(w, team, st.rect); draw(normRect(st.rect), st.chk.ok); show(e, st.chk);
      e.stopImmediatePropagation();
    } else if (st.phase === "set" && st.chk) show(e, st.chk);
  }, true);
  window.addEventListener("pointerup", (e) => {
    if (!st || e.button !== 0) return;
    if (st.phase === "drag") {
      e.stopImmediatePropagation();
      if (!st.rect || st.rect.w < 3 || st.rect.h < 3) { st = { phase: "aim" }; line.visible = false; hint.hidden = true; return; }
      st.phase = "set"; show(e, st.chk);
      if (!st.chk.ok) toast(`Not there: ${st.chk.why}`);
      return;
    }
    if (st.phase === "set" && st.confirm) {
      e.stopImmediatePropagation(); st.confirm = null;
      if (!st.chk.ok) { toast(`Not there: ${st.chk.why}`); return; }
      const r = normRect(st.rect);
      run("field", { x: r.x, y: r.y, w: r.w, h: r.h, rot: r.rot }, (a) => { if (!a) return; if (a.ok) { if (a.msg) toast(a.msg); cancel(); } else toast(a.error || "The field could not be laid out"); });
    }
  }, true);
  addEventListener("keydown", (e) => { if (st && (e.key === "Escape" || e.key === "x" || e.key === "X") && !e.target.closest?.("input,textarea")) cancel(); });
  // (the camera turned while a field is set: it keeps its own orientation — only a new drag takes the new view's)
  return { start, cancel, get active() { return !!st; }, get state() { return st; }, rectOf };
}
