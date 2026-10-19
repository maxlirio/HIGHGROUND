// The Battlefield buttons (View panel): each overlay is drawn over a window of the land round the camera, sharp (≈4–12 m
// a texel, not the whole world in 192), re-drawn as the camera moves; marks only the ground where its answer matters;
// says what its colours mean, and reads the ground under the cursor. Line of sight looks from the selected company's
// own eyes and follows it. The rasters: js/sim/analysis.js overlayWindow; the contours: js/render/terrain.js ovMode.
import * as THREE from "three";
import { overlayWindow, coverOf } from "../sim/analysis.js";
import { terrainAt } from "../sim/landread.js";
import { ARM_BY_ID } from "../sim/arms.js";

const RES = 256;
const LEGEND = {
  elevation: (o) => `<b>Height.</b> Contours every ${o.step} m, bold every ${o.step * 5} m. <span class="sw" style="--c:#eba846"></span>higher than the ground round about · <span class="sw" style="--c:#3c6ebe"></span>lower · <span class="sw" style="--c:#c83c28"></span>too steep to charge up (over 12 %).`,
  defensible: () => `<b>Strong ground.</b> <span class="sw" style="--c:#3cbe50"></span>a line stands well here: above its surroundings, a slope in front, cover. <span class="sw" style="--c:#cd3728"></span>low ground a nearby height looks down on.`,
  cover: () => `<b>Cover.</b> <span class="sw" style="--c:#96c8ff"></span>hard cover: walls and buildings stop arrows. <span class="sw" style="--c:#46c85a"></span>woods and hedges: some shelter, and men in them are hard to see.`,
  going: () => `<b>Going on foot.</b> Clear: a normal pace. <span class="sw" style="--c:#e6b432"></span>slower <span class="sw" style="--c:#c83232"></span>a crawl, and tiring (mud, marsh, woods, steep slopes). <span class="sw" style="--c:#285adc"></span>too deep to wade.`,
  charge: () => `<b>Cavalry.</b> <span class="sw" style="--c:#d23228"></span>a charge breaks here: uphill over 12 %, woods, marsh, broken ground or water. Clear ground: horse can charge.`,
  los: (o) => `<b>Line of sight</b> from ${o.who} (${o.range} m). Clear: seen. <span class="sw" style="--c:#2d1e82"></span>dead ground: men there are hidden from ${o.unit ? "them" : "it"}. ${o.unit ? "" : "Select a company to look from its eyes."}`,
};

export function makeOverlays({ w, terr, camera, selected, groundAt, canvas }) {
  const tex = new THREE.DataTexture(new Uint8Array(RES * RES * 4), RES, RES, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  const U = terr.uniforms, panel = document.querySelector("#overlays");
  const legend = document.createElement("div"); legend.id = "ovlegend"; legend.hidden = true; panel?.append(legend);
  const text = document.createElement("div"), here = document.createElement("div"); here.className = "ovhere"; legend.append(text, here);
  let kind = "none", drawn = null, timer = null;

  // where it looks from (Line of sight): the first selected company, else the middle of the screen
  function eyes() {
    const u = [...selected].map((id) => w.units.get(id)).find((u) => u && u.members?.length);
    if (u) { const A = ARM_BY_ID[w.S.arm[u.members[0]]] || {}; return { x: u.ax, y: u.ay, eye: A.mounted ? 2.5 : 1.7, range: A.glyph === "eye" ? 1400 : 900, unit: u, who: u.name || `your ${(A.name || "men").toLowerCase()}` }; }
    return { x: camera.st.tx, y: camera.st.ty, eye: 1.7, range: 900, unit: null, who: "the middle of the screen" };
  }
  const span = () => Math.max(600, Math.min(3600, camera.st.dist * 2.6));
  const stepFor = (W) => W < 900 ? 2 : W < 1800 ? 5 : 10;

  function draw() {
    const W = span(), from = kind === "los" ? eyes() : null;
    const cx = from ? from.x : camera.st.tx, cy = from ? from.y : camera.st.ty, size = from ? Math.max(W, from.range * 2.1) : W;
    const box = { x0: cx - size / 2, y0: cy - size / 2, size };
    tex.image.data.set(overlayWindow(w, kind, box, RES, from)); tex.needsUpdate = true;
    U.ovTex.value = tex; U.ovBox.value.set(box.x0, box.y0, box.size); U.ovMode.value = kind === "elevation" ? 1 : 2; U.ovStep.value = stepFor(W); U.ovOn.value = 1;
    drawn = { cx, cy, W, size, from: from && { x: from.x, y: from.y, unit: from.unit?.id } };
    text.innerHTML = LEGEND[kind]({ step: stepFor(W), who: from?.who, range: from?.range, unit: !!from?.unit });
  }
  // re-drawn when the camera has gone a fifth of the window, or zoomed well in or out; Line of sight when its company moves
  function check() {
    if (kind === "none" || !drawn) return;
    const W = span(), from = kind === "los" ? eyes() : null;
    if (from) { if ((from.unit?.id ?? null) !== (drawn.from.unit ?? null) || Math.hypot(from.x - drawn.from.x, from.y - drawn.from.y) > 12) draw(); return; }
    if (Math.hypot(camera.st.tx - drawn.cx, camera.st.ty - drawn.cy) > drawn.W * 0.2 || W / drawn.W > 1.4 || drawn.W / W > 1.4) draw();
  }
  function set(k) {
    kind = k;
    document.querySelectorAll("#overlays [data-ov]").forEach((b) => b.classList.toggle("on", b.dataset.ov === k));
    clearInterval(timer); here.textContent = "";
    if (k === "none") { U.ovOn.value = 0; U.ovMode.value = 0; legend.hidden = true; drawn = null; return; }
    legend.hidden = false; draw(); timer = setInterval(check, 400);
  }

  // the ground under the cursor, in the overlay's own terms
  function read(x, y) {
    const map = w.map; if (!map.inBounds(x, y)) return "";
    const t = terrainAt(w, x, y) || {}, [gx, gy] = map.grad(x, y), pct = Math.round(Math.hypot(gx, gy) * 100), h = map.h(x, y);
    const name = (t.name || "ground").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    if (kind === "elevation") { let ring = 0; for (let k = 0; k < 8; k++) ring += map.h(x + Math.cos(k * 0.785) * 150, y + Math.sin(k * 0.785) * 150); const rel = Math.round(h - ring / 8);
      return `${Math.round(h)} m · ${rel >= 0 ? rel + " m above" : -rel + " m below"} the ground round about · slope ${pct} %`; }
    if (kind === "cover") return `${name}: ${Math.round(coverOf(t) * 100)} % cover from arrows · ${Math.round((t.concealment?.standing ?? 0) * 100)} % harder to see`;
    if (kind === "going") { const wd = map.water(x, y); if (wd > 1) return `${name}: ${wd.toFixed(1)} m deep, cannot wade`;
      return `${name}, slope ${pct} %: foot at ${Math.round((t.moveMul?.foot ?? 1) * Math.exp(-3.5 * Math.hypot(gx, gy)) * 100)} % of a normal pace`; }
    if (kind === "charge") { const why = map.water(x, y) > 0.1 ? "water" : (t.chargeViable ?? 1) < 0.75 ? name.toLowerCase() : pct > 12 ? `${pct} % slope` : null;
      return why ? `A charge breaks here: ${why}` : `Horse can charge here (slope ${pct} %)`; }
    if (kind === "los" && drawn?.from) { const f = eyes(), d = Math.round(Math.hypot(x - f.x, y - f.y));
      if (d > f.range) return `${d} m: beyond their sight`;
      return map.los(f.x, f.y, f.eye, x, y, 1.7, map.canopyGrid ? map.canopy : null) ? `${d} m: in plain sight` : `${d} m: hidden from them`; }
    if (kind === "defensible") { let ring = 0, mx = -Infinity; for (let k = 0; k < 8; k++) { const q = map.h(x + Math.cos(k * 0.785) * 250, y + Math.sin(k * 0.785) * 250); ring += q; mx = Math.max(mx, q); }
      const p = Math.round(h - ring / 8), parts = [`${p >= 0 ? p + " m above" : -p + " m below"} the ground round about`];
      if (mx > h + 8) parts.push(`overlooked by a height ${Math.round(mx - h)} m above`); if (coverOf(t) > 0.2) parts.push("cover"); if (pct > 8) parts.push(`slope ${pct} %`);
      return parts.join(" · "); }
    return "";
  }
  let lastRead = 0;
  canvas?.addEventListener("pointermove", (e) => {
    if (kind === "none") return; const now = performance.now(); if (now - lastRead < 120) return; lastRead = now;
    const g = groundAt(e.clientX, e.clientY); here.textContent = g ? read(g.x, g.y) : "";
  });
  document.querySelectorAll("#overlays [data-ov]").forEach((b) => b.onclick = () => set(kind === b.dataset.ov && b.dataset.ov !== "none" ? "none" : b.dataset.ov));
  return { set, get kind() { return kind; }, redraw: () => kind !== "none" && draw() };
}
