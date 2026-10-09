// The deployment phase: the sim holds still while you draw up your host inside your ground. Drag a company to
// move it, pick it and click the ground to send it there, set its order (line, deep, schiltron, wedge, loose),
// turn it, plant archers' stakes. What your scouts can see of the enemy's array shows through the fog of war.
// "Sound the advance" starts the battle.
//   makeDeploy(w, battle, deps) → { done() }
//   deps = { canvas, camera, groundAt(cx, cy), toScreen(x, y, lift), terr, ovTex, V, refreshVision(), selected, refreshSel(), toast, onAdvance() }
//   deps.remote (a live ranked battle, the field on the server): { move(u), form(u, f), stakes(u, on), ready(), foe } —
//   each move is shown at once here and sent; "Sound the advance" says you are ready, and the trumpets sound when
//   both lords are (server/live-battle.mjs). deps.seen(u): what the scouts can see (the server's fog), for canSee.
import { ARMS, FORMATIONS } from "../sim/arms.js";
import { zoneLocal, plantStakes, unplantStakes, deployPlace, deployMove, deployFormation, deployForms } from "../sim/battlefield.js";
import { glyphSVG } from "./glyphs.js";
import { canSee } from "../sim/vision.js";

const FORMS = deployForms;

export function makeDeploy(w, B, deps) {
  const S = w.S, P = B.PLAYER, side = B.sideOf(P), zone = B.zones[side], mine = () => B.units[side].filter((u) => u.members.length);
  const face0 = zone.face, R = deps.remote || null;
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
  // (live: the stakes are the server's — the features come back in its state — so only the men are placed here)
  const place = (u, x, y, face) => deployPlace(w, zone, u, x, y, face);
  const move = (u, x, y, face) => { if (R) { place(u, x, y, face); R.move(u); } else deployMove(w, zone, u, x, y, face); };
  function setFormation(u, f) { if (R) { R.form(u, f); u.formation = f; } else deployFormation(w, zone, u, f); render(); }
  function turn(u, d) { move(u, u.ax, u.ay, (u.finalFacing ?? face0) + d); render(); }
  let sendT = 0; // (a drag on a live field: the server hears where the company is every 150 ms, and where it stops)
  // ---- input: grab a company and drag it; with one picked, click the ground to send it there
  let drag = null, picked = null;
  const unitAt = (gp) => { let best = null, bd = Infinity; for (const u of mine()) { let r = 6; for (const id of u.members) r = Math.max(r, Math.hypot(S.x[id] - u.ax, S.y[id] - u.ay)); const d = Math.hypot(gp.x - u.ax, gp.y - u.ay); if (d < r + 4 && d < bd) { bd = d; best = u; } } return best; };
  const onDown = (e) => {
    if (e.target !== deps.canvas || e.button !== 0 || e.altKey) return;
    e.stopImmediatePropagation(); e.preventDefault();
    const gp = deps.groundAt(e.clientX, e.clientY); if (!gp) return;
    const u = unitAt(gp);
    if (u) { drag = { u, dx: u.ax - gp.x, dy: u.ay - gp.y, moved: false, had: !!u.stakes }; pick(u); }
    else if (picked) { move(picked, gp.x, gp.y); deps.refreshVision(); render(); }
  };
  const onMove = (e) => {
    if (!drag) return; e.stopImmediatePropagation();
    const gp = deps.groundAt(e.clientX, e.clientY); if (!gp) return;
    if (!drag.moved && !R) unplantStakes(w, drag.u);
    drag.moved = true; place(drag.u, gp.x + drag.dx, gp.y + drag.dy);
    if (R && performance.now() - sendT > 150) { sendT = performance.now(); R.move(drag.u); }
  };
  const onUp = (e) => {
    if (e.target === deps.canvas && e.button === 0 && !e.altKey) e.stopImmediatePropagation();
    if (!drag) return; if (drag.moved && R) R.move(drag.u); else if (drag.moved && drag.had) plantStakes(w, drag.u); drag = null; deps.refreshVision(); render();
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
    panel.querySelector("[data-stakes]")?.addEventListener("click", () => { if (R) { R.stakes(picked, !picked.stakes); picked.stakes = !picked.stakes; } else if (picked.stakes) unplantStakes(w, picked); else plantStakes(w, picked); render(); });
    panel.querySelector("[data-allface]").onclick = () => { for (const u of mine()) move(u, u.ax, u.ay, face0); render(); };
    renderScouts();
  }
  function renderScouts() {
    const seen = new Map(); let hidden = 0;
    for (const u of B.units[foeSide]) { if (!u.members.length) continue; if (deps.seen ? deps.seen(u) : canSee(deps.V, P, u.ax, u.ay)) seen.set(u.arm, (seen.get(u.arm) || 0) + u.members.length); else hidden++; }
    scouts.innerHTML = `<h3>What the scouts see</h3>${seen.size ? `<div class="sc-list">${[...seen].map(([a, n]) => `<span class="sc-f"><span class="gbadge t1">${glyphSVG(ARMS[a].glyph)}</span>${n} ${ARMS[a].name}</span>`).join("")}</div>` : `<p>Nothing yet — the enemy is out of sight.</p>`}
      ${hidden ? `<p class="sc-hid">${hidden} more ${hidden === 1 ? "company is" : "companies are"} beyond sight — behind the rise, in the trees, or too far to make out.</p>` : ""}
      <p class="sc-t">${foeD.hidden ? "His temper: unknown. Watch how he stands." : `${cap(foeD.lord || "He")}: ${temperWord(foeD.temper)}.`}</p>`;
  }
  deps.refreshVision(); render();
  const scoutT = setInterval(renderScouts, 1500);
  function advance() {
    if (R) { // a live field: you are ready; the trumpets wait for the other lord (or the deploy's time running out)
      if (R.isReady?.()) return; R.ready();
      const b = bar.querySelector("[data-advance]"); b.disabled = true; b.classList.remove("on"); b.innerHTML = `Ready · waiting for ${esc(R.foe || "your foe")}…`;
      return;
    }
    done();
    deps.onAdvance?.();
  }
  // (live: the server's word on the time left, and whether the foe is ready)
  function liveStatus({ left, foeReady }) {
    const h = bar.querySelector(".db-live") || bar.appendChild(Object.assign(document.createElement("div"), { className: "db-h db-live" }));
    h.innerHTML = `${Number.isFinite(left) ? `The trumpets sound in <b>${Math.ceil(left)} s</b>` : ""}${foeReady ? ` · <b>${esc(R?.foe || "Your foe")}</b> is ready` : ""}`;
  }
  function done() {
    removeEventListener("pointerdown", onDown, true); removeEventListener("pointermove", onMove, true); removeEventListener("pointerup", onUp, true); removeEventListener("keydown", onKey);
    clearInterval(scoutT); bar.remove(); panel.remove(); scouts.remove(); deps.terr.uniforms.ovOn.value = 0; deps.selected.clear(); deps.refreshSel?.();
  }
  return { done, advance, place, setFormation, pick, liveStatus, render };
}

const TEMPER = { defensive: "a stubborn defender, he will wait on his ground", aggressive: "a hotspur, he will come straight at you", flanker: "he will try to ride round a flank", skirmish: "he will shoot before he closes", ambusher: "he likes to hide men in the woods", shock: "he leads with his knights", inspiring: "a steady captain, he keeps his horse back" };
const temperWord = (t) => TEMPER[t] || "a man you have yet to measure";
function el(tag, id) { const d = document.createElement(tag); d.id = id; document.querySelector("#hud").append(d); return d; }
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function hex(h) { const m = /^#?([0-9a-f]{6})$/i.exec(h); if (!m) return [90, 120, 200]; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
