// The deployment phase: the sim holds still while you draw up your host inside your ground. Drag a company to
// move it, pick it and click the ground to send it there, set its order (line, deep, schiltron, wedge, loose),
// turn it, plant archers' stakes. What your scouts can see of the enemy's array shows through the fog of war.
// "Sound the advance" starts the battle.
//   makeDeploy(w, battle, deps) → { done() }
//   deps = { canvas, camera, groundAt(cx, cy), toScreen(x, y, lift), terr, ovTex, V, refreshVision(), selected, refreshSel(), toast, onAdvance() }
import { ARMS, FORMATIONS, formationSlots, formationFiles } from "../sim/arms.js";
import { clampToZone, zoneLocal, plantStakes, unplantStakes } from "../sim/battlefield.js";
import { glyphSVG } from "./glyphs.js";
import { canSee } from "../sim/vision.js";

const FORMS = (arm) => {
  const A = ARMS[arm];
  if (A.missile) return ["loose", "line"];
  if (arm === "knights") return ["wedge", "line"];
  if (A.mounted) return ["line", "wedge", "loose"];
  if (arm === "menatarms") return ["line", "deep", "wedge"];
  return ["line", "deep", "schiltron"];
};

export function makeDeploy(w, B, deps) {
  const S = w.S, P = B.PLAYER, side = B.sideOf(P), zone = B.zones[side], mine = () => B.units[side].filter((u) => u.members.length);
  const face0 = zone.face;
  // ---- the zones painted on the ground (the battlefield overlay texture)
  const OVR = deps.ovTex.image.width, img = deps.ovTex.image.data, map = w.map, col = [hex(css("--t0") || "#2f5fa8"), hex(css("--t1") || "#a8322f")];
  function paintZones() {
    img.fill(0);
    for (let j = 0; j < OVR; j++) for (let i = 0; i < OVR; i++) {
      const x = (i + 0.5) / OVR * map.size, y = (j + 0.5) / OVR * map.size, k = (j * OVR + i) * 4;
      for (const [zi, z] of B.zones.entries()) {
        const p = zoneLocal(z, x, y), ex = Math.abs(p.front) - z.d / 2, ey = Math.abs(p.lat) - z.w / 2;
        if (ex > 0 || ey > 0) continue;
        const edge = Math.max(ex, ey) > -map.size / OVR * 1.2, c = col[zi === side ? 0 : 1];
        img[k] = c[0]; img[k + 1] = c[1]; img[k + 2] = c[2]; img[k + 3] = edge ? 190 : zi === side ? 38 : 26;
      }
    }
    deps.ovTex.needsUpdate = true; deps.terr.uniforms.ovOn.value = 1;
  }
  paintZones();
  // ---- moving a company: its men stand in their places at once (nobody is fighting yet)
  function place(u, x, y, face = u.finalFacing ?? face0) {
    const pad = u.role === "hidden" || u.role === "ambush" ? 160 : 0;
    const p = clampToZone(zone, x, y, pad ? -pad : 4);
    const A = ARMS[u.arm], n = u.members.length;
    u.ax = p.x; u.ay = p.y; u.facing = face - Math.PI / 2; u.finalFacing = face; u.path = null; u.order = { kind: "hold", x: p.x, y: p.y, facing: face };
    const fixed = u.formation === "line" || u.formation === "deep" || u.formation === "loose" || u.formation === "shallow";
    const slots = formationSlots(u.formation, n, A.spacing, fixed && u.files ? -u.files : u.depth, A.rankDepth || 0);
    const c = Math.cos(u.facing), s = Math.sin(u.facing);
    u.members.forEach((id, k) => { const [lx, ly, rank] = slots[k]; S.x[id] = p.x + lx * c - ly * s; S.y[id] = p.y + lx * s + ly * c; S.vx[id] = S.vy[id] = 0; S.facing[id] = face; S.rank[id] = rank; });
    u.slotCache = null; u.slotFix = null; u.slotUsed = null;
  }
  function setFormation(u, f) { u.formation = f; u.depth = 0; u.files = formationFiles(f, u.members.length, 0); u.slotCache = null; const had = !!u.stakes; unplantStakes(w, u); place(u, u.ax, u.ay); if (had) plantStakes(w, u); render(); }
  function turn(u, d) { const had = !!u.stakes; unplantStakes(w, u); place(u, u.ax, u.ay, (u.finalFacing ?? face0) + d); if (had) plantStakes(w, u); render(); }
  // ---- input: grab a company and drag it; with one picked, click the ground to send it there
  let drag = null, picked = null;
  const unitAt = (gp) => { let best = null, bd = Infinity; for (const u of mine()) { let r = 6; for (const id of u.members) r = Math.max(r, Math.hypot(S.x[id] - u.ax, S.y[id] - u.ay)); const d = Math.hypot(gp.x - u.ax, gp.y - u.ay); if (d < r + 4 && d < bd) { bd = d; best = u; } } return best; };
  const onDown = (e) => {
    if (e.target !== deps.canvas || e.button !== 0 || e.altKey) return;
    e.stopImmediatePropagation(); e.preventDefault();
    const gp = deps.groundAt(e.clientX, e.clientY); if (!gp) return;
    const u = unitAt(gp);
    if (u) { drag = { u, dx: u.ax - gp.x, dy: u.ay - gp.y, moved: false, had: !!u.stakes }; pick(u); }
    else if (picked) { const had = !!picked.stakes; unplantStakes(w, picked); place(picked, gp.x, gp.y); if (had) plantStakes(w, picked); deps.refreshVision(); render(); }
  };
  const onMove = (e) => {
    if (!drag) return; e.stopImmediatePropagation();
    const gp = deps.groundAt(e.clientX, e.clientY); if (!gp) return;
    if (!drag.moved) unplantStakes(w, drag.u);
    drag.moved = true; place(drag.u, gp.x + drag.dx, gp.y + drag.dy);
  };
  const onUp = (e) => {
    if (e.target === deps.canvas && e.button === 0 && !e.altKey) e.stopImmediatePropagation();
    if (!drag) return; if (drag.moved && drag.had) plantStakes(w, drag.u); drag = null; deps.refreshVision(); render();
  };
  const onKey = (e) => {
    if (!picked || e.target.closest?.("input,textarea")) return;
    if (e.key === "[" || e.key === ",") turn(picked, 0.3927); if (e.key === "]" || e.key === ".") turn(picked, -0.3927);
    if (e.key === "Enter") advance();
  };
  addEventListener("pointerdown", onDown, true); addEventListener("pointermove", onMove, true); addEventListener("pointerup", onUp, true); addEventListener("keydown", onKey);
  function pick(u) { picked = u; deps.selected.clear(); if (u) deps.selected.add(u.id); deps.refreshSel?.(); render(); }
  // ---- the panels
  const bar = el("div", "deploybar"), panel = el("div", "deploypanel"), scouts = el("div", "scoutpanel");
  const cfg = B.cfg, foeSide = 1 - side, foeD = cfg.sides[foeSide];
  bar.innerHTML = `<div class="db-k">Deployment</div><div class="db-t">Draw up ${cfg.sides[side].name} on your ground <span class="db-dim">(the lit ground is yours)</span></div>
    <div class="db-h">Drag a company to move it · pick one and click the ground to send it · <kbd>[</kbd> <kbd>]</kbd> turn it · the enemy is drawing up opposite</div>
    <button class="db-go on" data-advance>Sound the advance <kbd>Enter</kbd></button>`;
  bar.querySelector("[data-advance]").onclick = advance;
  function render() {
    const us = mine();
    panel.innerHTML = `<h3>Your host <small>${us.reduce((s, u) => s + u.members.length, 0)} men · ${us.length} companies</small></h3>
      <div class="dp-list">${us.map((u) => `<div class="dp-co${u === picked ? " on" : ""}" data-co="${u.id}">
        <div class="dp-top"><span class="gbadge t0">${glyphSVG(ARMS[u.arm].glyph)}</span><b>${u.coName ? cap(u.coName) : ARMS[u.arm].name}</b><small>${u.coName ? ARMS[u.arm].name + " · " : ""}${u.members.length}</small>${u.role === "hidden" || u.role === "ambush" ? `<em>hidden</em>` : ""}</div>
        ${u === picked ? `<div class="dp-ctl"><span class="dp-forms">${FORMS(u.arm).map((f) => `<button data-form="${f}" class="${u.formation === f ? "on" : ""}">${FORMATIONS[f]?.name || f}</button>`).join("")}</span>
          <span class="dp-turn"><button data-turn="1" title="Turn left">⟲</button><button data-turn="-1" title="Turn right">⟳</button><button data-face title="Face the enemy">⊙</button></span>
          ${ARMS[u.arm].missile ? `<button data-stakes class="${u.stakes ? "on" : ""}" title="Sharpened stakes planted before the line: horse will not face them">${u.stakes ? "Stakes planted" : "Plant stakes"}</button>` : ""}</div>` : ""}</div>`).join("")}</div>
      <div class="dp-foot"><button data-allface>All face the enemy</button></div>`;
    panel.querySelectorAll("[data-co]").forEach((d) => d.onclick = (e) => { if (e.target.closest("button")) return; const u = w.units.get(+d.dataset.co); pick(u === picked ? null : u); if (u) deps.camera.focus(u.ax, u.ay); });
    panel.querySelectorAll("[data-form]").forEach((b) => b.onclick = () => setFormation(picked, b.dataset.form));
    panel.querySelectorAll("[data-turn]").forEach((b) => b.onclick = () => turn(picked, +b.dataset.turn * 0.3927));
    panel.querySelector("[data-face]")?.addEventListener("click", () => { const d = face0 - (picked.finalFacing ?? face0); turn(picked, d); });
    panel.querySelector("[data-stakes]")?.addEventListener("click", () => { if (picked.stakes) unplantStakes(w, picked); else plantStakes(w, picked); render(); });
    panel.querySelector("[data-allface]").onclick = () => { for (const u of mine()) { const had = !!u.stakes; unplantStakes(w, u); place(u, u.ax, u.ay, face0); if (had) plantStakes(w, u); } render(); };
    renderScouts();
  }
  function renderScouts() {
    const seen = new Map(); let hidden = 0;
    for (const u of B.units[foeSide]) { if (!u.members.length) continue; if (canSee(deps.V, P, u.ax, u.ay)) seen.set(u.arm, (seen.get(u.arm) || 0) + u.members.length); else hidden++; }
    scouts.innerHTML = `<h3>What the scouts see</h3>${seen.size ? `<div class="sc-list">${[...seen].map(([a, n]) => `<span class="sc-f"><span class="gbadge t1">${glyphSVG(ARMS[a].glyph)}</span>${n} ${ARMS[a].name}</span>`).join("")}</div>` : `<p>Nothing yet — the enemy is out of sight.</p>`}
      ${hidden ? `<p class="sc-hid">${hidden} more ${hidden === 1 ? "company is" : "companies are"} beyond sight — behind the rise, in the trees, or too far to make out.</p>` : ""}
      <p class="sc-t">${foeD.hidden ? "His temper: unknown. Watch how he stands." : `${cap(foeD.lord || "He")}: ${temperWord(foeD.temper)}.`}</p>`;
  }
  deps.refreshVision(); render();
  const scoutT = setInterval(renderScouts, 1500);
  function advance() {
    done();
    deps.onAdvance?.();
  }
  function done() {
    removeEventListener("pointerdown", onDown, true); removeEventListener("pointermove", onMove, true); removeEventListener("pointerup", onUp, true); removeEventListener("keydown", onKey);
    clearInterval(scoutT); bar.remove(); panel.remove(); scouts.remove(); deps.terr.uniforms.ovOn.value = 0; deps.selected.clear(); deps.refreshSel?.();
  }
  return { done, advance, place, setFormation, pick };
}

const TEMPER = { defensive: "a stubborn defender, he will wait on his ground", aggressive: "a hotspur, he will come straight at you", flanker: "he will try to ride round a flank", skirmish: "he will shoot before he closes", ambusher: "he likes to hide men in the woods", shock: "he leads with his knights", inspiring: "a steady captain, he keeps his horse back" };
const temperWord = (t) => TEMPER[t] || "a man you have yet to measure";
function el(tag, id) { const d = document.createElement(tag); d.id = id; document.querySelector("#hud").append(d); return d; }
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function hex(h) { const m = /^#?([0-9a-f]{6})$/i.exec(h); if (!m) return [90, 120, 200]; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
