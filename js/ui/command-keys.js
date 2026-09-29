// Quick commands, the always-on controls hint, the one-time tips, and the courier lines — the same for the
// eagle view and for the lord in the field (js/ui/avatar-ui.js). Selecting and ordering groups is the ordinary
// RTS interface (js/main.js: click a label / drag a box, then click the ground or an enemy); with the lord in the
// field his orders simply travel from where he stands (voice ≤30 m, horn ≤250 m, rider beyond: js/sim/command.js),
// and a line runs from him to every company an order is still riding to, with its icon and seconds to arrival.
//
//   1–9          select control group (tap twice: look at it)       Ctrl/⌘+1–9  make the selection group n
//   Shift+1–9    add group n to the selection                        B           select the whole army
//   U            "Form up!" — the selection re-forms its ranks where it stands
//   T            "Follow me!" — the selection keeps station on the lord          (lord in the field)
//   Y            "Rally to me!" — heard only within horn range of him (250 m)   (lord in the field)
//   H            camera to the lord                                            (lord in the field)
//   (Tab: ride as the lord ↔ eagle view; C in the saddle frees the cursor for commanding — js/ui/avatar-ui.js)
import { issueOrder } from "../sim/world.js";
import { lordOrder, AV } from "../sim/avatar.js";
import { CMD } from "../sim/command.js";

const CSS = `
#cmdhint { position:fixed; left:50%; bottom:12px; transform:translateX(-50%); z-index:6; pointer-events:none; max-width:min(800px, calc(100% - 24px));
  background:var(--panel); border:1px solid var(--edge); border-radius:4px; padding:4px 10px; font-size:12px; line-height:1.55; color:var(--dim); text-align:center; }
#cmdhint[hidden] { display:none; }
#cmdhint b { color:var(--gold); font-weight:400; letter-spacing:.06em; margin-right:3px; }
#cmdhint kbd { font:11px ui-monospace, monospace; border:1px solid var(--edge); border-radius:3px; padding:0 4px; color:var(--ink); }
#cmdhint .sep { color:var(--edge); margin:0 4px; }
body:has(#selbar:not([hidden])) #cmdhint { bottom:54px; }
body.lordview:not(.lordcursor) #cmdhint { bottom:12px; }
body.battle-mode:has(#deploybar) #cmdhint, body:has(#lordcard.show) #cmdhint { display:none; }
#cmdtip { position:fixed; left:50%; top:88px; transform:translateX(-50%); z-index:7; width:min(460px, calc(100% - 32px)); background:var(--panel); border:1px solid var(--gold);
  border-radius:4px; padding:10px 14px 10px; font-size:13px; line-height:1.45; color:var(--ink); box-shadow:0 6px 30px #000a; opacity:0; transition:opacity .5s; pointer-events:none; }
#cmdtip.show { opacity:1; } #cmdtip[hidden] { display:none; }
#cmdtip h4 { margin:0 0 4px; font-size:12px; letter-spacing:.2em; text-transform:uppercase; color:var(--gold); font-weight:400; }
#cmdtip ul { margin:0; padding-left:18px; } #cmdtip li { margin:2px 0; } #cmdtip .d { color:var(--dim); font-size:12px; margin-top:6px; }
#cmdtip kbd { font:11px ui-monospace, monospace; border:1px solid var(--edge); border-radius:3px; padding:0 4px; }
#cmdtip button { pointer-events:auto; position:absolute; right:6px; top:6px; padding:0 7px; font-size:12px; }
#cmdlines { position:fixed; inset:0; width:100%; height:100%; pointer-events:none; z-index:1; overflow:visible; }
#cmdlines line { stroke:#f1d48a; stroke-width:2.2; stroke-dasharray:7 5; stroke-linecap:round; filter:drop-shadow(0 0 1.5px #000); }
#cmdlines line.voice { stroke-dasharray:1 5; }
#cmdlines text { font:14px/1 system-ui, sans-serif; text-anchor:middle; dominant-baseline:central; filter:drop-shadow(0 1px 2px #000); }
#cmdlines .call { font-size:18px; }
#cmdlines .eta { font:600 11px/1 ui-sans-serif, system-ui, sans-serif; fill:#fff; }
`;

const K = (k) => `<kbd>${k}</kbd>`;
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

export function makeCommandKeys({ w, PLAYER, selected, refreshSel, camera, toast, dropChains, toScreen, lordUI, params }) {
  const S = w.S;
  const style = document.createElement("style"); style.textContent = CSS; document.head.append(style);
  const hint = document.createElement("div"); hint.id = "cmdhint"; document.body.append(hint);
  const tip = document.createElement("div"); tip.id = "cmdtip"; tip.hidden = true; document.body.append(tip);
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg"); svg.id = "cmdlines"; document.body.append(svg);
  const groups = new Map(); // n → Set of soldier ids (soldiers, not units: box-select splits and merges units)
  let lastNum = { n: -1, t: 0 };

  const lordUp = () => !!(w.avatar && !w.avatar.outcome && S.alive[w.avatar.lord]);
  const house = () => (lordUp() ? S.unit[w.avatar.lord] : -1);
  const army = () => [...w.units.values()].filter((u) => u.team === PLAYER && !u.isWorkers && u.members.length && !u.household && u.id !== house());
  const selUnits = () => [...selected].map((id) => w.units.get(id)).filter((u) => u && u.members.length && u.team === PLAYER && !u.isWorkers && u.id !== house() && !u.household);
  const men = (us) => us.reduce((s, u) => s + u.members.length, 0);
  const needSel = () => toast("Select a group first: click its label, drag a box round it, or press 1–9 / B");

  // ---- control groups
  function assign(n) {
    const us = [...selected].map((id) => w.units.get(id)).filter((u) => u && u.members.length);
    if (!us.length) { if (groups.delete(n)) toast(`Group ${n} cleared`); else toast(`Select men first, then ${MOD}+${n} makes them group ${n}`); return; }
    groups.set(n, new Set(us.flatMap((u) => u.members)));
    toast(`Group ${n}: ${men(us)} men — press ${n} to select them`);
  }
  function unitsOf(n) {
    const ids = groups.get(n); if (!ids) return [];
    const out = new Set();
    for (const i of ids) { if (!S.alive[i]) { ids.delete(i); continue; } const u = w.units.get(S.unit[i]); if (u && u.team === PLAYER) out.add(u); }
    return [...out];
  }
  function recall(n, add) {
    const us = unitsOf(n);
    if (!us.length) { toast(groups.has(n) ? `Group ${n} is no more` : `No group ${n} yet — select men and press ${MOD}+${n}`); return; }
    if (!add) selected.clear();
    for (const u of us) selected.add(u.id);
    refreshSel();
    const now = performance.now();
    if (lastNum.n === n && now - lastNum.t < 400 && !lordUI.active) { const c = centroid(us); camera.focus(c.x, c.y); }
    lastNum = { n, t: now };
  }
  const groupOf = (unitId) => { const u = w.units.get(unitId); if (!u) return 0; for (const [n, ids] of groups) for (const i of u.members) if (ids.has(i)) return n; return 0; };
  function selectAll() {
    const us = army(); if (!us.length) { toast("You have no companies left in the field"); return; }
    selected.clear(); for (const u of us) selected.add(u.id); refreshSel();
    toast(`The whole army: ${men(us)} men in ${us.length} companies`);
  }
  const centroid = (us) => { let x = 0, y = 0, n = 0; for (const u of us) { x += u.ax * u.members.length; y += u.ay * u.members.length; n += u.members.length; } return { x: x / n, y: y / n }; };

  // ---- quick orders
  function formUp() {
    const us = selUnits(); if (!us.length) return needSel();
    dropChains([...selected]);
    for (const u of us) { u.helping = null; u.burning = null; issueOrder(w, [u.id], { kind: "hold", x: u.ax, y: u.ay, facing: u.finalFacing ?? u.order?.facing ?? 0, formation: u.formation }); }
    toast(`"Form up!" — ${us.length > 1 ? `${us.length} companies re-form` : "they re-form"} their ranks where they stand`);
  }
  const noLord = () => toast("Your lord is not in the field — press “Take the field” to lead in person");
  function followMe() {
    if (!lordUp()) return noLord();
    const us = selUnits(); if (!us.length) return needSel();
    dropChains(us.map((u) => u.id));
    const r = lordOrder(w, "follow", us.map((u) => u.id));
    toast(`"Follow me!" — ${r.n} ${r.n === 1 ? "company keeps" : "companies keep"} station behind your banner${chan(r)}`);
  }
  function rally() {
    if (!lordUp()) return noLord();
    const A = w.avatar, lx = S.x[A.lord], ly = S.y[A.lord];
    const pool = selUnits().length ? selUnits() : army();
    const heard = pool.filter((u) => Math.hypot(u.ax - lx, u.ay - ly) <= CMD.hornR), deaf = pool.length - heard.length;
    const r = heard.length ? lordOrder(w, "rally", heard.map((u) => u.id)) : { n: 0, channels: {} };
    if (heard.length) dropChains(heard.map((u) => u.id));
    dispatchEvent(new CustomEvent("hg-sound", { detail: { kind: "warcry", x: lx, y: ly } }));
    toast(r.n ? `"Rally to me!" — ${r.n} ${r.n === 1 ? "company comes" : "companies come"}${chan(r)}${deaf ? ` · ${deaf} too far to hear (over ${CMD.hornR} m)` : ""}`
      : `"Rally to me!" — nobody within ${CMD.hornR} m hears the horn`);
  }
  const chan = (r) => { const c = Object.entries(r.channels || {}).filter(([, n]) => n).map(([k, n]) => `${n} by ${k}`).join(", "); return c ? ` (${c})` : ""; };
  function findLord() {
    if (!lordUp()) return noLord();
    if (lordUI.active) return;
    camera.focus(S.x[w.avatar.lord], S.y[w.avatar.lord]);
  }

  addEventListener("keydown", (e) => {
    if (e.target.closest?.("input,textarea,select") || e.altKey) return;
    if (document.body.querySelector("#deploybar")) return; // (deployment has its own controls)
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const num = /^Digit[1-9]$/.test(e.code) ? +e.code.slice(5) : /^[1-9]$/.test(k) ? +k : 0;
    if (num) {
      if (lordUI.radialOpen) return; // (1–6 pick from the lord's radial while it is open)
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) assign(num); else recall(num, e.shiftKey);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.repeat) return;
    if (k === "b") selectAll();
    else if (k === "u") formUp();
    else if (k === "t") followMe();
    else if (k === "y") rally();
    else if (k === "h") findLord();
  });

  // ---- the hint: what you can do right now, in one or two short lines
  function hintHTML() {
    const L = lordUp();
    const select = `<b>Select</b>click a label or drag a box · ${K("1–9")} group (${K(MOD + "+1–9")} set) · ${K("⇧")} add · ${K("B")} whole army`;
    const order = `<b>Order</b>click ground or an enemy · right-drag to face · ${K("⇧")} chain · ${K("U")} form up${L ? ` · ${K("T")} follow me · ${K("Y")} rally` : ""} · ${K("X")} deselect`;
    if (lordUI.active && lordUI.cursor) return `${select}<br>${order}<br><b>Ride</b>${K("WASD")} still rides · wheel zooms · ${K("C")} back to the sword · ${K("Tab")} eagle view`;
    if (lordUI.active) return `<b>Ride</b>${K("WASD")} · ${K("⇧")} gallop · ${K("Z")} walk · mouse look · ${K("click")} strike · ${K("RMB")}/${K("Space")} guard · ${K("F")} lance · ${K("E")} dismount`
      + `<br><b>Command</b>${K("C")} free the cursor to select and order · ${K("1–9")} groups · ${K("T")} follow me · ${K("Y")} rally · ${K("U")} form up · ${K("Tab")} eagle view`;
    return `${select}<br>${order}${L ? `<br><b>Your lord</b>${K("Tab")} ride and fight as him · ${K("H")} find him · orders go from him by voice, horn or rider` : ""}`;
  }
  let hintK = "", hintT = 0, tipShown = false, tipT = 0;
  const tipQ = [];
  function showTip(key, title, items, foot) {
    if (params.has("shot") && !params.has("tips")) return;
    try { if (localStorage.getItem("hg-tip-" + key)) return; } catch { /* private window: show it anyway */ }
    if (!tip.hidden) { tipQ.push([key, title, items, foot]); return; } // (one at a time)
    try { localStorage.setItem("hg-tip-" + key, "1"); } catch { /* (as above) */ }
    tip.innerHTML = `<button title="Close">✕</button><h4>${title}</h4><ul>${items.map((s) => `<li>${s}</li>`).join("")}</ul>${foot ? `<div class="d">${foot}</div>` : ""}`;
    tip.querySelector("button").onclick = () => hideTip();
    tip.hidden = false; void tip.offsetWidth; tip.classList.add("show");
    clearTimeout(tipT); tipT = setTimeout(hideTip, 16000);
  }
  function hideTip() { clearTimeout(tipT); tip.classList.remove("show"); setTimeout(() => { tip.hidden = true; if (tipQ.length) showTip(...tipQ.shift()); }, 500); }
  const tipRTS = () => showTip("rts", "Commanding your army", [
    `<b>Select a group:</b> click its label, or drag a box round the men. ${K("1–9")} recalls a group, ${K(MOD + "+1–9")} makes one, ${K("B")} takes the whole army.`,
    `<b>Give an order:</b> click the ground (a menu asks what to do there) or click an enemy to attack. Right-drag on the ground sets where they stand and which way they face (the longer the drag, the wider the line). ${K("⇧")}-click adds a next step. ${K("X")} deselects.`,
    `<b>Lead in person:</b> “Take the field” puts your lord on the field. ${K("Tab")} switches between riding as him and this view.`,
  ], "The controls stay in the bar at the bottom.");
  const tipLord = () => showTip("lord", "You are in the saddle", [
    `${K("WASD")} ride, the mouse looks, ${K("click")} strikes. You can still command:`,
    `${K("C")} frees the cursor — select and order exactly as from above (click a label or drag a box, then click the ground). ${K("C")} again to fight.`,
    `${K("T")} “Follow me!”, ${K("Y")} “Rally to me!”, ${K("U")} “Form up!” go to the selected groups. ${K("Tab")} is the eagle view.`,
  ], "Your orders travel from where you stand: at once by voice within 30 m, by horn within 250 m, by rider beyond — watch the line and the seconds.");

  // ---- courier lines: lord → each company an order is on its way to
  const pool = [], callEl = document.createElementNS(NS, "text"); callEl.setAttribute("class", "call"); svg.append(callEl);
  function lines() {
    let n = 0;
    const A = w.avatar;
    if (lordUp()) {
      const lx = S.x[A.lord], ly = S.y[A.lord], a = toScreen(lx, ly, 2.5), t = w.time, P = w.command?.pending; let call = null;
      for (const u of w.units.values()) {
        const po = u.pendingOrder; if (u.team !== PLAYER || !po || !po.eta || !u.members.length) continue;
        const b = toScreen(u.ax, u.ay, 4); if (!b.front || !a.front) continue;
        const from = P?.get(u.id)?.from ?? po.eta - 5, k = Math.max(0, Math.min(1, (t - from) / Math.max(0.1, po.eta - from)));
        let g = pool[n]; if (!g) { g = document.createElementNS(NS, "g"); g.innerHTML = `<line/><text class="ic"/><text class="eta"/>`; svg.append(g); pool.push(g); }
        const [ln, ic, eta] = g.children, ch = po.channel || "rider";
        ln.setAttribute("x1", a.x.toFixed(1)); ln.setAttribute("y1", a.y.toFixed(1)); ln.setAttribute("x2", b.x.toFixed(1)); ln.setAttribute("y2", (b.y - 20).toFixed(1));
        ln.setAttribute("class", ch);
        // a rider rides the line (his icon and the seconds left travel with him); a horn call or a shout is heard from
        // the lord — one icon beside him — and each company's label carries its own seconds
        const rid = ch === "rider", mx = a.x + (b.x - a.x) * k, my = a.y + (b.y - 20 - a.y) * k;
        ic.style.display = eta.style.display = rid ? "" : "none";
        if (rid) { ic.textContent = "🐎"; ic.setAttribute("x", mx.toFixed(1)); ic.setAttribute("y", (my - 10).toFixed(1)); eta.textContent = `${Math.max(0, Math.ceil(po.eta - t))}s`; eta.setAttribute("x", mx.toFixed(1)); eta.setAttribute("y", (my + 6).toFixed(1)); }
        else call = call === "horn" || ch === "horn" ? "horn" : "voice";
        g.style.display = ""; n++;
      }
      if (call && a.front) { callEl.textContent = call === "horn" ? "📯" : "🗣"; callEl.setAttribute("x", (a.x + 16).toFixed(1)); callEl.setAttribute("y", (a.y - 4).toFixed(1)); }
      callEl.style.display = call && a.front ? "" : "none";
    } else callEl.style.display = "none";
    for (let k = n; k < pool.length; k++) pool[k].style.display = "none";
  }

  function frame(dt) {
    lines();
    if ((hintT += dt) < 0.25) return; hintT = 0;
    const key = `${lordUp()}|${lordUI.active}|${lordUI.cursor}`;
    if (key !== hintK) { hintK = key; hint.innerHTML = hintHTML(); }
    if (!tipShown && w.time > 1.5 && !document.querySelector("#deploybar")) { tipShown = true; tipRTS(); }
  }
  lordUI.onEnter = () => tipLord();
  lordUI.groupOf = groupOf;
  return { frame, assign, recall, selectAll, formUp, followMe, rally, findLord, groups, groupOf, showTip, tipRTS, tipLord };
}
