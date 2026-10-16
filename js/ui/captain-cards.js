// The captains' proposal cards (js/sim/captains.js): "Sir Kenric · Knights ×30 — Charge their longbowmen: 270 m off and
// no foot within 70 m of them  [Do it now] [No]  ····· 6 s". At most CAPT.maxCards at once, top left, under the battle
// prompt; the target is marked on the field (a gold ring and a dashed line from the company to it) while the card is up.
// Clicking the card (not its buttons) looks at the target. The player's word goes through the command layer (cmds.run
// "captain" / "initiative"), so it is the same locally and in the realm (where the server keeps the countdown).
// Also: the captain and the Initiative on / ask me / off switch in the selection panel (selHTML + the click handler).
import { ARMS } from "../sim/arms.js";
import { propsFor, captainInfo, initiativeOf, globalInitiative, TEMPERS } from "../sim/captains.js";
import { glyphSVG } from "./glyphs.js";

const CSS = `
#capcards { position: absolute; left: 12px; top: 46px; width: 300px; display: flex; flex-direction: column; gap: 6px; z-index: 3; pointer-events: none; }
body:has(#battlepop:not([hidden])) #capcards { top: 250px; }
.capcard { pointer-events: auto; background: var(--panel, #181510e0); border: 1px solid #8a7440; border-left: 3px solid var(--gold, #d8b25a); border-radius: 4px; padding: 7px 9px 6px; box-shadow: 0 4px 18px #0008; cursor: pointer; animation: cc-in .22s ease-out; font-size: 12px; }
.capcard:hover { border-color: var(--gold, #d8b25a); }
.capcard.withdraw { border-left-color: #8fb3d9; }
@keyframes cc-in { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: none; } }
.capcard .cc-h { display: flex; align-items: center; gap: 6px; color: var(--dim, #a79f8a); font-size: 11px; }
.capcard .cc-h svg { width: 15px; height: 15px; background: var(--blue, #2f5fa8); border-radius: 2px; flex: none; }
.capcard .cc-h b { color: var(--ink, #e9e2cf); font-weight: 600; }
.capcard .cc-what { font-size: 14px; color: #ffe39a; margin: 3px 0 1px; }
.capcard .cc-why { color: #d9cfb5; line-height: 1.3; }
.capcard .cc-foot { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.capcard .cc-foot button { padding: 2px 10px; font-size: 12px; }
.capcard .cc-foot button.yes { background: #4a3a1a; border-color: var(--gold, #d8b25a); }
.capcard .cc-bar { flex: 1; height: 3px; background: #0006; border-radius: 2px; overflow: hidden; }
.capcard .cc-bar i { display: block; height: 100%; background: var(--gold, #d8b25a); transform-origin: left; }
.capcard .cc-s { font: 11px ui-monospace, monospace; color: var(--dim, #a79f8a); min-width: 22px; text-align: right; }
#capmarks { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 2; overflow: visible; }
#capmarks .ring { fill: none; stroke: #ffe39a; stroke-width: 2.5; animation: cm-p 1.1s ease-in-out infinite alternate; }
#capmarks .ln { stroke: #ffe39a; stroke-width: 1.6; stroke-dasharray: 6 5; opacity: .75; }
#capmarks .hot .ring { stroke-width: 3.5; } #capmarks .hot .ln { opacity: 1; stroke-width: 2.2; }
#capmarks text { font: 600 11px ui-sans-serif, system-ui, sans-serif; fill: #ffe39a; paint-order: stroke; stroke: #000c; stroke-width: 3px; }
@keyframes cm-p { from { opacity: .55; } to { opacity: 1; } }
#selinfo .capsel { margin-top: 6px; padding-top: 6px; border-top: 1px solid #3a3120; }
#selinfo .capsel .row b { color: var(--ink, #e9e2cf); }
#selinfo .capsel .ct { font-size: 11px; color: var(--dim, #a79f8a); margin: 1px 0 4px; } #selinfo .capsel .ct.lost { color: #e8876b; }
#selinfo .capinit { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--dim, #a79f8a); }
#selinfo .capinit button { padding: 1px 7px; font-size: 11px; }
#selinfo .capinit .army { margin-left: auto; font-size: 10px; background: none; border-color: #3a3120; color: var(--dim, #a79f8a); }
`;
const WITHDRAW = new Set(["fallback", "cover"]);
const MARK = { "charge-bows": "charge?", flank: "flank?", pursue: "pursue?", fallback: "fall back here?", cover: "into cover here?", support: "to their help?" };

// deps: { w, PLAYER, toScreen(x, y) → {x, y, front}, focus(x, y), run(op, args, done), toast, remote: () => realm props | null }
export function makeCaptainCards({ w, PLAYER, toScreen, focus, run, toast, remoteProps = null, remoteGlobal = null }) {
  const st = document.createElement("style"); st.textContent = CSS; document.head.append(st);
  const box = document.createElement("div"); box.id = "capcards"; (document.querySelector("#hud") || document.body).append(box);
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg"); svg.id = "capmarks"; document.body.append(svg);
  const cards = new Map(); // pid → { el, marks, P }
  const decided = new Set(); let hot = null;

  const props = () => {
    if (remoteProps) { const R = remoteProps(); if (!R) return []; const age = (performance.now() - (R.at || 0)) / 1000; return (R.props || []).map((P) => ({ ...P, left: Math.max(0, P.left - age) })); }
    return propsFor(w, PLAYER);
  };
  function decide(P, yes) {
    decided.add(P.id); drop(P.id);
    run("captain", { pid: P.id, yes }, (r) => { if (r && !r.ok && r.error) toast(r.error); else if (r?.msg) toast(r.msg); });
  }
  function card(P) {
    const el = document.createElement("div"); el.className = "capcard" + (WITHDRAW.has(P.kind) ? " withdraw" : "");
    const A = ARMS[P.arm] || ARMS.spearmen;
    el.innerHTML = `<div class="cc-h">${glyphSVG(A.glyph)}<b>${esc(P.name)}</b><span>· ${esc(A.name)} ×${P.men}</span></div>
      <div class="cc-what">${esc(P.what)}</div><div class="cc-why">${esc(cap(P.why))}.</div>
      <div class="cc-foot"><button class="yes">Do it now</button><button class="no">No</button><div class="cc-bar"><i></i></div><span class="cc-s"></span></div>`;
    el.querySelector(".yes").onclick = (e) => { e.stopPropagation(); decide(P, true); };
    el.querySelector(".no").onclick = (e) => { e.stopPropagation(); decide(P, false); };
    el.onclick = () => { const t = w.units.get(P.target); focus(t?.members.length ? t.ax : P.x, t?.members.length ? t.ay : P.y); };
    el.onpointerenter = () => { hot = P.id; }; el.onpointerleave = () => { if (hot === P.id) hot = null; };
    for (const ev of ["pointerdown", "pointerup", "mousedown", "mouseup", "contextmenu", "wheel"]) el.addEventListener(ev, (e) => e.stopPropagation()); // (a click on a card is not an order on the field)
    const g = document.createElementNS(NS, "g");
    g.innerHTML = `<line class="ln"/><circle class="ring" r="22"/><text></text>`;
    svg.append(g);
    box.append(el);
    return { el, g, P, bar: el.querySelector(".cc-bar i"), s: el.querySelector(".cc-s") };
  }
  function drop(pid) { const c = cards.get(pid); if (!c) return; c.el.remove(); c.g.remove(); cards.delete(pid); }

  function frame() {
    const list = props().filter((P) => !decided.has(P.id));
    const ids = new Set(list.map((P) => P.id));
    for (const pid of [...cards.keys()]) if (!ids.has(pid)) drop(pid);
    for (const P of list) {
      let c = cards.get(P.id); if (!c) { c = card(P); cards.set(P.id, c); }
      c.P = P;
      const f = Math.max(0, Math.min(1, P.left / (P.cd || 8)));
      c.bar.style.transform = `scaleX(${f})`; c.s.textContent = `${Math.ceil(P.left)}s`;
      // the mark on the field: the company → its target
      const u = w.units.get(P.unit), t = P.target !== null ? w.units.get(P.target) : null;
      const tx = t?.members.length ? t.ax : P.x, ty = t?.members.length ? t.ay : P.y;
      const a = u?.members.length ? toScreen(u.ax, u.ay, 2) : null, b = toScreen(tx, ty, 2);
      const [ln, ring, tx2] = c.g.children;
      c.g.setAttribute("class", hot === P.id ? "hot" : "");
      if (!b.front) { c.g.style.display = "none"; continue; }
      c.g.style.display = "";
      ring.setAttribute("cx", b.x); ring.setAttribute("cy", b.y);
      if (a?.front) { const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, k = Math.max(0, d - 24) / d; ln.setAttribute("x1", a.x); ln.setAttribute("y1", a.y); ln.setAttribute("x2", a.x + dx * k); ln.setAttribute("y2", a.y + dy * k); ln.style.display = ""; }
      else ln.style.display = "none";
      tx2.setAttribute("x", b.x + 26); tx2.setAttribute("y", b.y + 4); tx2.textContent = `${P.name} · ${MARK[P.kind] || "?"}`;
    }
    for (const pid of decided) if (!ids.has(pid)) decided.delete(pid);
  }

  // ---- the selection panel: who leads them, and his initiative
  function selHTML(us) {
    us = us.filter((u) => !u.isWorkers && !ARMS[u.arm]?.engine && u.arm !== "villager" && !u.household);
    if (!us.length) return "";
    const infos = us.map((u) => [u, remoteProps ? u.cap || null : captainInfo(w, u)]);
    const glob = remoteGlobal ? remoteGlobal() || "ask" : globalInitiative(w, PLAYER);
    const modes = new Set(us.map((u) => (remoteProps ? u.init || glob : initiativeOf(w, u))));
    const mode = modes.size === 1 ? [...modes][0] : null;
    let who;
    if (us.length === 1) {
      const I = infos[0][1];
      who = !I ? `<div class="ct">No captain named yet</div>` : I.lost ? `<div class="row">Led by <b>${esc(I.name)}</b></div><div class="ct lost">Fallen — the company is leaderless until a sergeant takes it</div>`
        : `<div class="row">Led by <b>${esc(I.name)}</b></div><div class="ct">${TEMPERS[I.temper]?.name || I.temper} · skill ${Math.round(I.skill * 100)}${I.legend ? " · a raised legend" : ""}</div>`;
    } else {
      const lost = infos.filter(([, I]) => I?.lost).length;
      who = `<div class="row">Captains <b>${infos.filter(([, I]) => I).length}${lost ? ` (${lost} leaderless)` : ""}</b></div>`;
    }
    const b = (m, t) => `<button data-capinit="${m}" class="${mode === m ? "on" : ""}" title="${TIP[m]}">${t}</button>`;
    return `<div class="capsel">${who}<div class="capinit">Initiative ${b("on", "On")}${b("ask", "Ask me")}${b("off", "Off")}<button class="army" data-capall title="The default for every company you have not set: click to change">Army: ${ARMY[glob]}</button></div></div>`;
  }
  function onSelClick(e, ids, refresh) {
    const m = e.target.closest("[data-capinit]")?.dataset.capinit;
    if (m) { e.stopPropagation(); run("initiative", { ids, mode: m }, (r) => { if (r?.msg) toast(r.msg); else if (r?.error) toast(r.error); refresh(); }); return true; }
    if (e.target.closest("[data-capall]")) {
      e.stopPropagation();
      const g = remoteGlobal ? remoteGlobal() || "ask" : globalInitiative(w, PLAYER), next = g === "ask" ? "on" : g === "on" ? "off" : "ask";
      run("initiative", { all: true, mode: next }, (r) => { if (r?.msg) toast(r.msg); refresh(); });
      return true;
    }
    return false;
  }
  return { frame, selHTML, onSelClick, count: () => cards.size };
}
const TIP = { on: "The captain acts on his own and tells you", ask: "The captain asks first; if you say nothing he acts when the countdown ends", off: "The captain never acts on his own" };
const ARMY = { on: "on", ask: "ask me", off: "off" };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
