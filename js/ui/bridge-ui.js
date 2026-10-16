// "BRIDGE HERE" (Build → Timber Bridge — bridge here). The river is read about the pointer (js/sim/bridges.js bridgeSites):
// every reach a bridge could span is drawn across the water from bank to bank — green, brighter the narrower and firmer;
// faint red where it cannot (too wide, too deep, a soft or steep bank) — and the place the click would take (siteBridge: the
// narrowest sound reach within 60 m) is drawn bold in gold, with its span, depth and timber, or red with why not. A click
// stakes it out (the "place" command, kind "bridge": the server sites it exactly as the preview did). X cancels.
import * as THREE from "three";
import * as BRG from "../sim/bridges.js";
import { BUILDINGS } from "../sim/econ-data.js";

export function makeBridgeUI({ scene, map, w, team, canvas, groundAt, run, toast, onDone }) {
  let on = false, last = null, sites = [], ghost = null, tMove = 0;
  const hint = document.createElement("div"); hint.id = "bridgehint"; hint.hidden = true;
  Object.assign(hint.style, { position: "fixed", pointerEvents: "none", zIndex: 30, background: "rgba(24,20,14,.9)", color: "#efe6cf", font: "13px/1.35 Georgia, serif", padding: "6px 9px", borderRadius: "4px", maxWidth: "340px", border: "1px solid #6b5a3a" });
  document.body.append(hint);
  const mk = (n, order) => {
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const L = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.95 }));
    L.renderOrder = order; L.frustumCulled = false; L.visible = false; scene.add(L); return L;
  };
  const siteL = mk(30000, 21), ghostL = mk(2000, 22);
  // segs: [ax, ay, bx, by, [r, g, b], half-width] — drawn as three parallel strokes a little above the water or the bank
  function draw(L, segs) {
    const P = L.geometry.attributes.position.array, C = L.geometry.attributes.color.array, max = P.length / 3; let v = 0;
    for (const [ax, ay, bx, by, col, half] of segs) {
      const len = Math.hypot(bx - ax, by - ay) || 1, nx = -(by - ay) / len, ny = (bx - ax) / len, n = Math.max(1, Math.ceil(len / 3));
      for (const o of half > 0 ? [-half, 0, half] : [0]) for (let k = 0; k < n && v + 2 <= max; k++) for (const t of [k / n, (k + 1) / n]) {
        const x = ax + (bx - ax) * t + nx * o, y = ay + (by - ay) * t + ny * o, z = (map.inBounds(x, y) ? map.h(x, y) + Math.max(0, map.water(x, y)) : 0) + 0.8;
        P[v * 3] = x; P[v * 3 + 1] = z; P[v * 3 + 2] = -y; C.set(col, v * 3); v++;
      }
    }
    L.geometry.setDrawRange(0, v); L.geometry.attributes.position.needsUpdate = L.geometry.attributes.color.needsUpdate = true; L.visible = v > 0;
  }
  const GOLD = [1, 0.84, 0.3], BAD = [1, 0.32, 0.25];
  function refresh(x, y, cx, cy) {
    if (!last || Math.hypot(last.x - x, last.y - y) > 80) { sites = BRG.bridgeSites(w, team, x, y, 280); last = { x, y }; }
    draw(siteL, sites.map((s) => [s.ax, s.ay, s.bx, s.by, s.ok ? [0.3 + 0.2 * s.v, 0.6 + 0.4 * s.v, 0.25] : [0.75, 0.3, 0.25], s.ok ? 1.2 : 0]));
    const q = BRG.siteBridge(w, team, x, y, { R: 60 });
    ghost = q.error ? null : q;
    if (q.error) { draw(ghostL, []); hint.innerHTML = `<b style="color:#f08070">No bridge here</b><br>${q.error}`; }
    else {
      const t = BUILDINGS.bridge.mat.timber * q.span, md = BUILDINGS.bridge.labour * q.span, have = w.teams[team]?.store?.timber ?? 0;
      draw(ghostL, [[q.ax, q.ay, q.bx, q.by, have >= t ? GOLD : BAD, 2.5]]);
      hint.innerHTML = `<b>Timber Bridge</b> — ${Math.round(q.span)} m over water ${q.maxD.toFixed(1)} m deep<br>the narrowest firm reach near here · ${(t / 1000).toFixed(1)} t timber${have < t ? ` <span style="color:#f08070">(you have ${(have / 1000).toFixed(1)} t)</span>` : ""} · ~${Math.round(md)} man-days<br><i>click to stake it out</i>`;
    }
    hint.style.left = `${cx + 16}px`; hint.style.top = `${cy + 14}px`; hint.hidden = false;
  }
  canvas.addEventListener("pointermove", (e) => {
    if (!on) return;
    const now = performance.now(); if (now - tMove < 90) return; tMove = now;
    const pt = groundAt(e.clientX, e.clientY); if (!pt) return;
    refresh(pt.x, pt.y, e.clientX, e.clientY);
  });
  function start() { on = true; last = null; toast("Bridge here: the river lights up where it can be bridged — click a reach to stake out a timber bridge (X cancels)"); }
  function cancel() { on = false; ghost = null; draw(siteL, []); draw(ghostL, []); hint.hidden = true; }
  function place(x, y) {
    run("place", { kind: "bridge", x, y }, (r) => {
      toast(r?.ok ? r.msg : `No bridge: ${r?.error || "it cannot be built there"}`);
      if (r?.ok) { cancel(); onDone?.(r); }
    });
  }
  // (tools: the preview at a point without a pointer — the shots stage it)
  function preview(x, y, cx = 400, cy = 300) { refresh(x, y, cx, cy); return { sites: sites.length, ok: sites.filter((s) => s.ok).length, ghost }; }
  return { start, cancel, place, preview, active: () => on };
}
