// The frame round a siege (?mode=siege): the siege bar (the day, the phase, both forces, the food), the phase tracker,
// the clock ("let days pass": a day, five, until the breach / the mine / the engines / the works / they come — the
// camp is busy on screen while the days run), the siege orders for your side, the castle's state (every stretch and
// its modules, the gates, the mines, the engines, the stores), your lord (lead the assault up a ladder or into the
// breach; hold the keep), the terms a herald brings, the moments as they happen, and the end and its reckoning.
// The sim is js/sim/siege-war.js (+ the generals in js/sim/siege-ai.js). main.js calls, in this order:
//   setupSiegeRun(w, cfg, { PLAYER, places, castleApi }) → G      after the world is built (the castle, both hosts)
//   siegeUI(w, G, deps)                                          after the camera exists (deps below)
//   G.frame(dt)                                                  every rendered frame (days passing, the moments)
//   G.updateBar()                                                twice a second
// deps = { camera, canvas, groundAt, toScreen, selected, refreshSel, toast, log, ping, lordUI, seen, onNew, onAgain }
import * as SW from "../sim/siege-war.js";
import { installSiegeAI } from "../sim/siege-ai.js";
import { ARMS } from "../sim/arms.js";
import { issueOrder, applyOrder, step } from "../sim/world.js";
import * as SG from "../sim/siege.js";
import { glyphSVG } from "./glyphs.js";
import { lastPlace } from "./castle-orders.js";

export function setupSiegeRun(w, cfg, { PLAYER = 0, places, castleApi = null } = {}) {
  const G = SW.setupSiege(w, cfg, { PLAYER, places, castleApi });
  installSiegeAI(w, G);
  return G;
}

const PHASES = [["invest", "Investment"], ["siege", "Bombardment & mining"], ["assault", "The assault"], ["inside", "The bailey"], ["keep", "The keep"], ["end", "The end"]];
const HOW = { taken: "Taken by storm", terms: "Yielded on terms", starved: "Starved out", relieved: "Relieved", abandoned: "The siege raised" };

export function siegeUI(w, G, deps) {
  const P = G.PLAYER, me = P === G.att ? "attack" : "defend", C = G.castle, S = w.S, cam = deps.camera;
  const hud = document.querySelector("#hud");
  const el = (tag, id, cls = "") => { const d = document.createElement(tag); d.id = id; if (cls) d.className = cls; hud.append(d); return d; };
  const bar = el("div", "battlebar", "sgbar"), panel = el("div", "siegepanel"), card = el("div", "momentcard"), veil = el("div", "sgwait"), terms = el("div", "sgterms");
  card.hidden = true; veil.hidden = true; terms.hidden = true;
  document.body.classList.add("battle-mode", "siege-mode");
  for (const sel of ["#res", "#buildbtn"]) { const e = document.querySelector(sel); if (e) e.style.display = "none"; }
  document.querySelectorAll("#topbar button").forEach((b) => { if (/Build|Spells/.test(b.textContent)) b.style.display = "none"; });
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const dayStr = (d) => `Day ${Math.floor(d) + 1}`;
  let waiting = null, pick = null, showing = null, hideT = 0, open = { status: true, orders: true }, lastHtml = "";

  // ---------------------------------------------------------------- the camera at the start: from the camp (or the walls)
  { const F = C.facing, d = me === "attack" ? 250 : 40, at = { x: C.x + Math.cos(F) * d, y: C.y + Math.sin(F) * d };
    cam.focus(at.x, at.y); cam.setView(2); cam.st.yaw = me === "attack" ? F + Math.PI / 2 : F - Math.PI / 2; cam.goal.dist = cam.st.dist = me === "attack" ? 520 : 300; }

  // ---------------------------------------------------------------- the chronicle and the moments
  const shown = new Set();
  G.onNote = (e) => {
    if (e.secret && me === "defend") return; // (the garrison does not know of a mine till it hears it)
    deps.log?.(e.text, { ...(e.x !== undefined ? { x: e.x, y: e.y } : {}), tone: e.good === P ? "good" : e.good === 1 - P ? "bad" : undefined });
    try { dispatchEvent(new CustomEvent("hg-moment", { detail: { kind: e.kind, good: e.good, mine: e.good === P, x: e.x, y: e.y, sal: e.sal, horn: e.kind === "end" ? (e.good === P ? "victory" : "defeat") : e.kind === "assault" ? "advance" : e.good === P ? "rally" : e.good === 1 - P ? "alarm" : "contact", text: e.text } })); } catch { /* old browsers */ }
    if (e.sal < 0.6 || waiting && e.sal < 0.9) return;
    if (e.x !== undefined) deps.ping?.(e.x, e.y);
    show(e);
  };
  function show(e) {
    showing = e; hideT = performance.now() + (e.sal >= 0.9 ? 8000 : 5500);
    card.className = "mc-" + (e.good === P ? "good" : e.good === 1 - P ? "bad" : "even") + (e.sal >= 0.9 ? " big" : "");
    card.innerHTML = `<div class="mc-k">${e.kicker}<span>${dayStr(e.day)}</span></div><div class="mc-t">${e.text}</div>${e.x !== undefined ? `<button data-look>◉ Look <kbd>G</kbd></button>` : ""}`;
    card.querySelector("[data-look]")?.addEventListener("click", () => look(e.x, e.y));
    card.hidden = false; card.classList.remove("in"); void card.offsetWidth; card.classList.add("in");
  }
  const look = (x, y, dist = 220) => { if (x === undefined) return; cam.focus(x, y); cam.goal.dist = Math.min(cam.goal.dist, dist); };
  addEventListener("keydown", (e) => { if ((e.key === "g" || e.key === "G") && showing && !e.target.closest?.("input,textarea")) look(showing.x, showing.y); });

  // ---------------------------------------------------------------- terms
  G.onTerms = (T) => {
    const answerer = T.from === G.att ? G.def : G.att;
    if (answerer !== P) { if (T.from === P) deps.toast?.("A herald rides out with your terms…"); return; }
    if (waiting) { G.stopDays = true; stopWait("A herald comes!"); }
    terms.innerHTML = `<div class="lg-kicker">A herald</div><p>${T.text}.</p><p class="sg-dim">${answerer === G.def ? `Your stores: ${foodLine()}. ${G.relief?.known ? `Relief is expected about day ${G.relief.day + 1}.` : G.relief ? "You hope for relief." : "No relief is coming."}` : "Take the castle without another assault?"}</p>
      <div class="be-b"><button data-yes class="on">${answerer === G.def ? "Yield the castle" : "Accept"}</button><button data-no>${answerer === G.def ? "Send him back" : "Refuse"}</button></div>`;
    terms.hidden = false;
    terms.querySelector("[data-yes]").onclick = () => { terms.hidden = true; SW.answerTerms(w, G, true); };
    terms.querySelector("[data-no]").onclick = () => { terms.hidden = true; SW.answerTerms(w, G, false); };
  };

  // ---------------------------------------------------------------- the end
  G.onEnd = (O) => {
    const won = O.winner === P; waiting = null; veil.hidden = true; terms.hidden = true;
    document.querySelector("#battleend")?.remove();
    const endc = document.createElement("div"); endc.id = "battleend"; endc.className = won ? "won" : "lost";
    endc.innerHTML = `<div class="be-k">${won ? "Victory" : "Defeat"}</div><div class="be-t">${HOW[O.how] || O.how} — ${O.why}</div><div class="be-b"><button data-reckon class="on">The reckoning</button><button data-watch>Watch</button></div>`;
    hud.append(endc);
    endc.querySelector("[data-reckon]").onclick = () => { endc.remove(); reckoning(O); };
    endc.querySelector("[data-watch]").onclick = () => endc.remove();
  };
  function reckoning(O) {
    const m = document.querySelector("#modal"), won = O.winner === P, rec = G.rec; rec.finalise?.();
    const hc = SW.headcount(w, G), side = [P, 1 - P], nm = (tm) => cap(G.names.side(tm));
    const row = (l, f) => `<tr><th>${l}</th>${side.map((tm) => `<td>${f(tm)}</td>`).join("")}</tr>`;
    const notes = G.log.filter((e) => e.sal >= 0.45 && !(e.secret && me === "defend"));
    m.innerHTML = `<div class="am-card sg-reck ${won ? "won" : "lost"}"><div class="am-head"><div><div class="lg-kicker">${won ? "Victory" : "Defeat"} · ${HOW[O.how] || O.how} · ${Math.max(1, Math.round(O.day)) === 1 ? "1 day" : Math.max(1, Math.round(O.day)) + " days"}</div><h2>The siege of ${G.name}</h2>
      <div class="lg-sub">${cap(O.why)}.</div></div><div class="am-btns"><button data-close>Return to the castle</button><button data-again>Besiege it again</button><button data-new class="on">A new siege</button></div></div>
      <div class="am-grid"><div><div class="am-sub">The count</div><table class="am-t"><tr><th></th>${side.map((tm) => `<th class="t${tm === P ? 0 : 1}">${nm(tm)}</th>`).join("")}</tr>
        ${row("At the start", (tm) => hc.start[tm] + hc.added[tm])}${row("Killed", (tm) => rec.cas[tm].dead)}${row("Wounded", (tm) => rec.cas[tm].wounded)}
        ${row("Died of sickness", (tm) => G.stats.sick[tm])}${row("Deserted", (tm) => G.stats.deserted[tm])}${row(G.outcome?.how === "taken" ? "Taken prisoner" : "Yielded", (tm) => G.yielded?.[tm] || 0)}
        ${row("Lost to stones, mines, hunger, the night", (tm) => Math.max(0, hc.start[tm] + hc.added[tm] - (tm === G.def && G.yielded?.[tm] ? 0 : hc.alive[tm]) - rec.cas[tm].dead - G.stats.sick[tm] - G.stats.deserted[tm] - (G.yielded?.[tm] || 0)))}${row("Standing at the end", (tm) => G.yielded?.[tm] ? 0 : hc.alive[tm])}</table>
        <div class="am-sub">The siege</div><ul class="sg-facts"><li>${G.stats.assaults} assault${G.stats.assaults === 1 ? "" : "s"}, ${G.stats.failed} thrown back</li><li>${G.stats.breaches} breach${G.stats.breaches === 1 ? "" : "es"} made</li>
        <li>${SW.minesOf(w, G).length} mine${SW.minesOf(w, G).length === 1 ? "" : "s"} dug (${SW.minesOf(w, G).filter((q) => q.state === "done").length} sprung, ${SW.minesOf(w, G).filter((q) => q.state === "lost").length} lost)</li><li>${G.stats.sallies} sall${G.stats.sallies === 1 ? "y" : "ies"}; ${G.stats.burnt} engine${G.stats.burnt === 1 ? "" : "s"} burnt or smashed</li>
        <li>${w.siege?.stats?.thrown ? Math.round(w.siege.stats.thrown) + " stones thrown" : ""}</li></ul></div>
      <div><div class="am-sub">The course of the siege</div><ol class="am-tl sg-tl">${notes.map((e) => `<li class="${e.good === P ? "good" : e.good === 1 - P ? "bad" : ""}"><span class="t">${dayStr(e.day)}</span><b>${e.kicker}</b> ${e.text}</li>`).join("")}</ol></div></div></div>`;
    m.hidden = false; m.classList.add("am-modal");
    m.querySelector("[data-close]").onclick = () => { m.hidden = true; m.classList.remove("am-modal"); };
    m.querySelector("[data-again]").onclick = () => deps.onAgain?.();
    m.querySelector("[data-new]").onclick = () => deps.onNew?.();
  }
  G.reckoning = () => G.outcome && reckoning(G.outcome);

  // ---------------------------------------------------------------- letting days pass
  function wait(days, until = null, why = "") {
    if (G.outcome) return;
    const block = fightingNow(); if (block) { deps.toast?.(block); return; }
    waiting = { left: days, until, why, d0: SW.siegeDay(w, G) };
    veil.hidden = false; drawVeil();
  }
  function fightingNow() {
    if (G.assault?.on) return "An assault is under way — the days cannot pass now (call it off, or fight it out)";
    if (G.phase === "inside") return "The enemy is inside the walls — fight it out";
    if ((w.siege?.works?.sallies || []).some((q) => q.phase !== "done" && q.team === P)) return "A sally is out — wait for it to come home";
    for (const u of w.units.values()) if (u.team !== P && u.siegeHost && u.members.length && u.c?.contactT >= 0 && u.state !== "routing" && w.time - (u.c.lastContact ?? u.c.contactT) < 5) return "There is fighting — the days cannot pass now";
    return null;
  }
  function drawVeil() {
    if (!waiting) return;
    veil.innerHTML = `<div class="sw-k">The days pass</div><div class="sw-d">${dayStr(SW.siegeDay(w, G))}</div><div class="sw-t">${waiting.why || ""}</div><button data-stop>Stop</button>`;
    veil.querySelector("[data-stop]").onclick = () => stopWait("You call a halt");
  }
  function stopWait(msg) { if (!waiting) return; waiting = null; veil.hidden = true; if (msg) deps.toast?.(msg); render(); }
  const STOPS = { herald: "A herald comes!", breach: "A breach is made", mine: "The mine is ready to be fired — or lost", engines: "The engines are framed up", works: "The carpenters are done", assault: "They are coming! The assault", end: "", days: "" };

  // ---------------------------------------------------------------- picking a wall section / an engine on the ground
  function startPick(what, cb) {
    pick = { what, cb }; deps.toast?.(`Click ${what} on the ground (X to cancel)`); document.body.classList.add("sgpick");
  }
  const onDown = (e) => {
    if (!pick || e.target !== deps.canvas || e.button !== 0) return;
    e.stopImmediatePropagation(); e.preventDefault();
    const gp = deps.groundAt(e.clientX, e.clientY); if (!gp) return;
    const p = pick; pick = null; document.body.classList.remove("sgpick"); p.cb(gp);
  };
  const onUp = (e) => { if (e.target === deps.canvas && document.body.classList.contains("sgpicked")) { e.stopImmediatePropagation(); document.body.classList.remove("sgpicked"); } };
  addEventListener("pointerdown", onDown, true); addEventListener("pointerup", onUp, true);
  addEventListener("keydown", (e) => { if ((e.key === "x" || e.key === "X") && pick) { pick = null; document.body.classList.remove("sgpick"); } });

  // ---------------------------------------------------------------- orders
  const sel = () => [...deps.selected].map((id) => w.units.get(id)).filter((u) => u && u.members.length && u.team === P);
  const ids = (us) => us.map((u) => u.id);
  function say(r, ok) { if (r) deps.toast?.(cap(r)); else if (ok) deps.toast?.(ok); render(); }
  function act(kind, extra = {}) {
    const us = sel();
    switch (kind) {
      case "assault": case "breach": case "gate": case "escalade": case "tower": {
        const how = kind === "assault" ? "all" : kind;
        return say(SW.siegeCommand(w, G, P, "assault", { how, ids: ids(us) }), us.length ? `${us.length} ${us.length === 1 ? "company goes" : "companies go"} in` : "The trumpets sound the assault");
      }
      case "callOff": return say(SW.siegeCommand(w, G, P, "callOff"));
      case "stormKeep": return say(SW.siegeCommand(w, G, P, "stormKeep", { ids: ids(us) }));
      case "reserve": return say(SW.siegeCommand(w, G, P, "reserve", { ids: ids(us) }));
      case "terms": return say(SW.siegeCommand(w, G, P, "terms"));
      case "build": return say(SW.siegeCommand(w, G, P, "build", { what: extra.what }), `The carpenters begin ${SW.WORKS[extra.what].name.toLowerCase()}`);
      case "bombard": return say(SW.siegeCommand(w, G, P, "bombard", { bid: extra.bid }));
      case "mine": return say(SW.siegeCommand(w, G, P, "mine", { bid: extra.bid, ids: ids(us) }), "The miners go to work");
      case "man": if (!us.length) return say("Select the companies to man it first"); return say(SW.siegeCommand(w, G, P, "manWalls", { bid: extra.bid, ids: ids(us) }), "To the walls!");
      case "manPick": if (!us.length) return say("Select the companies first"); return startPick("the stretch of wall to man", (gp) => say(SW.siegeCommand(w, G, P, "manWalls", { x: gp.x, y: gp.y, ids: ids(sel()) }), "To the walls!"));
      case "holdBreach": if (!us.length) return say("Select the companies to hold it first"); return say(SW.siegeCommand(w, G, P, "holdBreach", { ids: ids(us), x: extra.x ?? C.x, y: extra.y ?? C.y }), "They go to hold the breach");
      case "barricade": return say(SW.siegeCommand(w, G, P, "barricade", { ids: ids(us.slice(0, 1)), x: C.x, y: C.y }), "A work party goes to stop the breach");
      case "repair": return say(SW.siegeCommand(w, G, P, "repair", { bid: extra.bid, ids: ids(us.slice(0, 1)) }), "Masons to the wall");
      case "listen": return say(SW.siegeCommand(w, G, P, "countermine", { bid: extra.bid, ids: ids(us.slice(0, 1)) }), "A listening post is set");
      case "keep": return say(SW.siegeCommand(w, G, P, "keep", { ids: ids(us) }));
      case "sally": if (!us.length) return say("Select the companies who will go out first"); return startPick("the enemy engine to burn", (gp) => say(SW.siegeCommand(w, G, P, "sally", { ids: ids(sel()), x: gp.x, y: gp.y })));
      case "lordAssault": return lordAssault();
      case "lordKeep": return lordKeep();
    }
  }
  // popup hooks (main.js): the siege orders offered when you click the ground with companies selected
  G.popupOrders = (units, pt, base) => {
    const out = (base || []).filter((o) => (!o.side || o.side === me) && !(me === "defend" && (o.kind === "escalade" || o.kind === "assemble")));
    const foot = units.some((u) => !ARMS[u.arm].mounted && !ARMS[u.arm].engine);
    const near = SW.nearestSection(G, pt.x, pt.y), dNear = near ? Math.hypot(near.x - pt.x, near.y - pt.y) : Infinity;
    const onCastle = ["walk", "tower", "gatehouse", "keep"].includes(lastPlace()?.kind); // (the click is on the masonry itself: the castle orders offer the place — js/ui/castle-orders.js)
    if (me === "defend" && foot && dNear < 60 && !onCastle) out.unshift({ kind: "sg-man", label: "Man this wall", hint: `up onto ${near.label}` });
    if (me === "defend" && foot && SW.breaches(G).length) out.push({ kind: "sg-breach", label: "Hold the breach", hint: "stand behind the gap and meet them there" });
    if (me === "defend" && foot && C.keep) out.push({ kind: "sg-keep", label: "To the keep", hint: C.keep.ward ? "fall back into the inner ward" : "fall back into the keep" });
    if (me === "attack" && foot && SW.breaches(G, "outer").length) out.unshift({ kind: "sg-storm", label: "Storm the breach", hint: "up the rubble and in" });
    return out;
  };
  G.popupChoose = (order, units) => {
    const o = { ids: units.map((u) => u.id), x: order.x, y: order.y };
    if (order.kind === "sg-man") { say(SW.siegeCommand(w, G, P, "manWalls", o), "To the walls!"); return true; }
    if (order.kind === "sg-breach") { say(SW.siegeCommand(w, G, P, "holdBreach", o), "They go to hold the breach"); return true; }
    if (order.kind === "sg-keep") { say(SW.siegeCommand(w, G, P, "keep", o)); return true; }
    if (order.kind === "sg-storm") { say(SW.siegeCommand(w, G, P, "assault", { how: "breach", ids: o.ids }), "Into the breach!"); return true; }
    if (order.kind === "sally" && me === "defend") { say(SW.siegeCommand(w, G, P, "sally", o)); return true; }
    if (order.kind === "mine" && me === "attack") { say(SW.siegeCommand(w, G, P, "mine", o), "The miners go to work"); return true; }
    return false;
  };

  // ---------------------------------------------------------------- the lord
  function lordUnit() { const A = w.avatar; if (!A || A.outcome || !S.alive[A.lord]) return null; return w.units.get(S.unit[A.lord]) || null; }
  function takeLordAt(x, y) {
    if (lordUnit()) return lordUnit();
    const L = deps.lordUI; if (!L) { deps.toast?.("Your lord is not with this host"); return null; }
    if (!L.placeAt({ x, y })) return null;
    L.setActive?.(false);
    const u = lordUnit(); if (u) SW.enrolUnit(G, u);
    return u;
  }
  // down from the saddle: the household fight on foot as men-at-arms (they climb ladders, go up stairs)
  function dismount(u) {
    const A = w.avatar; if (!u || !A) return;
    for (const i of u.members) if (S.alive[i]) { if (S.horseOK[i] === 1) { S.horseOK[i] = 0; S.horse[i] = 0; S.vx[i] = S.vy[i] = 0; } S.arm[i] = ARMS.menatarms.id; } // (dismounted knights fight as men-at-arms: cavalry.js reads S.arm)
    if (u.c) { u.c.phase = null; u.c.ride = null; } u.disengage = false;
    A.dismounted = true; A.speed = 0; A.couched = false; u.arm = "menatarms"; u.slotCache = null; u.formation = "line";
  }
  function lordAssault() {
    if (G.outcome) return;
    let u = lordUnit();
    if (!u) { const c = G.camp, F = C.facing; u = takeLordAt(C.x + Math.cos(F) * 260, C.y + Math.sin(F) * 260) || takeLordAt(c.x, c.y); if (!u) return; }
    dismount(u);
    if (SW.formUp) SW.formUp(w, G, SW.breaches(G, "outer").length ? "breach" : "escalade", [u]); // (he joins the stormers on their start line, not a walk from the camp)
    const br = SW.breaches(G, "outer").sort((a, b) => Math.hypot(SW.modPoint(G, a.b, a.k).x - u.ax, SW.modPoint(G, a.b, a.k).y - u.ay) - Math.hypot(SW.modPoint(G, b.b, b.k).x - u.ax, SW.modPoint(G, b.b, b.k).y - u.ay))[0];
    const T = w.teams[P];
    if (br) { const p = SW.modPoint(G, br.b, br.k, -16); issueOrder(w, [u.id], { kind: "assault", x: p.x, y: p.y, pace: "quick" }); say(null, "Your lord leads his household into the breach!"); }
    else { const b = w.buildings.find((q) => q.id === G.ai[G.att].target) || SW.pickBombardSection(w, G); if ((T.store.ladders || 0) < 1) T.store.ladders = 1; const p = SW.secGeom(G, b).at(0.4); issueOrder(w, [u.id], { kind: "escalade", x: p.x, y: p.y, pace: "quick" }); say(null, "Your lord goes up the ladders with his household!"); }
    u.role = "assault";
    if (!G.assault?.on) SW.siegeCommand(w, G, P, "assault", { how: br ? "breach" : "escalade", ids: ids(G.units[P].filter((q) => q.role === "foot" && q.members.length).slice(0, 4)) });
    look(u.ax, u.ay, 120);
  }
  function lordKeep() {
    if (G.outcome) return;
    const K = C.keep; if (!K) return say("There is no keep");
    let u = lordUnit();
    if (!u) { u = takeLordAt(C.x, C.y) || takeLordAt(K.x + 18, K.y); if (!u) return; }
    dismount(u);
    SW.fallBack(w, G, [u]); G.fellBack = false; // (only he goes: the rest hold where they are)
    say(null, `Your lord takes his stand in ${K.ward ? "the inner ward" : "the keep"}`);
    look(K.x, K.y, 90);
  }
  if (G.cfg.lord && deps.lordUI) setTimeout(() => { // he is with his men from the start (in the camp, or in the bailey)
    const K = C.keep, spot = me === "attack" ? { x: G.camp.x, y: G.camp.y } : { x: (C.x + (K?.x ?? C.x)) / 2 + 6, y: (C.y + (K?.y ?? C.y)) / 2 + 6 };
    const u = takeLordAt(spot.x, spot.y); if (u && me === "defend") dismount(u);
  }, 50);

  // ---------------------------------------------------------------- the panel
  function foodLine() { const st = SW.siegeStatus(w, G); return st.hunger > 0 ? `<b class="warn">starving (${Math.round(st.hunger)} days)</b>` : `${Math.floor(st.foodDays)} days of food for ${st.garrison} men`; }
  function render() {
    const st = SW.siegeStatus(w, G), day = st.day, T = w.teams[G.att];
    const phaseI = PHASES.findIndex(([k]) => k === st.phase);
    const fight = G.outcome ? "over" : fightingNow();
    const breaches = SW.breaches(G, "outer"), openB = breaches.filter((q) => !q.plug?.done);
    const engs = st.engines.filter((e) => e.team === G.att);
    const cnt = (k) => engs.filter((e) => e.kind === k), rdy = (k) => cnt(k).filter((e) => e.state === "ready").length;
    const mines = st.mines.filter((m) => m.known);
    const btn = (k, label, hint = "", dis = false, x = "") => `<button data-act="${k}" ${x} title="${hint}" ${dis ? "disabled" : ""}>${label}</button>`;
    const clock = `<div class="sgp-sec"><div class="sgp-h">The clock <small>${dayStr(day)} · 1 real minute = 1½ days</small></div>
      <div class="sgp-row">${btn("w1", "Wait a day", "let a day pass: the engines work, the miners dig, the garrison eats", !!fight)}${btn("w5", "Wait 5 days", "", !!fight)}
      ${me === "attack" ? btn("wB", "Until a breach", "let the days pass until the wall comes down", !!fight) + btn("wM", "Until the mine", "until the mine is sprung (or lost)", !!fight || !st.mines.some((m) => m.state === "digging" || m.state === "chamber")) + btn("wE", "Until the engines", "until every engine is framed up", !!fight || !engs.some((e) => (e.state === "packed" || e.state === "assembling") && !e.info?.abandoned)) + btn("wW", "Until the works", "until the carpenters are done", !!fight || !G.works.some((q) => !q.done))
        : btn("wA", "Until they come", "let the days pass until they storm the walls", !!fight) + btn("wB", "Until a breach", "", !!fight)}</div>
      ${G.outcome ? `<div class="sgp-warn">The siege is over: ${HOW[G.outcome.how] || G.outcome.how}. <button data-act="reckon">The reckoning</button></div>` : fight ? `<div class="sgp-warn">${fight}</div>` : ""}</div>`;
    let orders;
    if (me === "attack") orders = `<div class="sgp-sec"><div class="sgp-h">The assault <small>${sel().length ? `with the ${sel().length} selected ${sel().length === 1 ? "company" : "companies"}` : "the whole host, by your plan"}</small></div>
      <div class="sgp-row">${btn("assault", "Sound the assault", "breach, gate and ladders together, with a feint elsewhere", !!st.assault?.on || G.phase === "end")}${btn("breach", "Storm the breach", "up the rubble slope and in", !openB.length && !breaches.length)}
      ${btn("gate", "Batter the gate", "the ram to the gate, a company to follow it in", !rdy("ram"))}${btn("escalade", "Escalade", `ladders to the wall (${st.ladders} ladders)`, st.ladders < 2)}${btn("tower", "Tower assault", "push the siege tower to the wall and cross its bridge", !rdy("siege_tower"))}
      ${btn("callOff", "Call off the assault", "sound the recall", !st.assault?.on)}${btn("reserve", "Send in the reserve", "the companies still in the lines (or the selected) follow the first wave in", !st.assault?.on && G.phase !== "inside" && G.phase !== "keep")}${btn("stormKeep", C.keep?.ward ? "Storm the inner ward" : "Storm the keep", "every company inside the walls (or the selected) goes at the last refuge", G.phase !== "inside" && G.phase !== "keep")}</div>
      <div class="sgp-row">${btn("lordAssault", "⚑ Lead it yourself", "your lord and his household go up the ladders or into the breach with the stormers (Tab: his view)")}${btn("terms", "Offer terms", "send a herald: yield, and march out free", !!G.terms?.open)}</div></div>
      <div class="sgp-sec"><div class="sgp-h">The works <small>${st.ladders} ladders</small></div>
      <div class="sgp-row">${Object.entries(SW.WORKS).filter(([k]) => k !== "fill" || C.sections.some((b) => SW.moatBefore(w, G, b))).map(([k, W]) => { const q = G.works.find((x) => x.kind === k && !x.done); return btn("build", q ? `${W.name} ${Math.round(q.prog * 100)}%` : `${W.name} <small>${W.days} d</small>`, W.note, !!q, `data-what="${k}"`); }).join("")}</div></div>`;
    else orders = `<div class="sgp-sec"><div class="sgp-h">The garrison <small>${sel().length ? `the ${sel().length} selected ${sel().length === 1 ? "company" : "companies"}` : "select companies for most of these"}</small></div>
      <div class="sgp-row">${btn("manPick", "Man the walls…", "the selected companies up onto the stretch you click")}${btn("holdBreach", "Hold the breach", "the selected companies behind the breach", !SW.breaches(G).length)}
      ${btn("barricade", "Barricade the breach", "a work party throws timber and rubble across the gap", !SW.breaches(G).some((q) => !q.plug))}${btn("sally", "Sally…", "the selected companies out to burn the engine you click, and back")}
      ${btn("keep", C.keep?.ward ? "To the inner ward" : "To the keep", "give up the curtain: everyone (or the selected) into the last refuge", G.fellBack && !sel().length)}</div>
      <div class="sgp-row">${btn("lordKeep", C.keep?.ward ? "⚑ Hold the inner ward yourself" : "⚑ Hold the keep yourself", "your lord and his household take their stand in the last refuge")}${btn("terms", "Ask for terms", "send out to ask for terms", !!G.terms?.open)}</div></div>`;
    const secRow = (s) => { const b = w.buildings.find((q) => q.id === s.id); const cells = s.mods.map((v, k) => `<i class="${v <= 0 ? (b && SW.barricadeAt(w, b, k)?.state === "up" ? "bk" : "br") : v < 0.4 ? "cr" : v < 0.75 ? "pk" : ""}" title="section ${k + 1}: ${v <= 0 ? "breached" : Math.round(v * 100) + "%"}"></i>`).join("");
      return `<div class="sgs-r${s.target ? " tgt" : ""}" data-sec="${s.id}"><span class="nm" data-look-sec="${s.id}">${cap(s.label)}${s.target ? " ◎" : ""}</span><span class="md">${cells}</span>
        ${me === "attack" ? (s.ring !== "keep" ? `<button data-act="bombard" data-bid="${s.id}" title="lay the trebuchets on it">Bombard</button><button data-act="mine" data-bid="${s.id}" title="dig a mine under it">Mine</button>` : "") : `<button data-act="man" data-bid="${s.id}" title="the selected companies onto it">Man</button><button data-act="repair" data-bid="${s.id}" title="masons to it">Repair</button><button data-act="listen" data-bid="${s.id}" title="a listening post under it">Listen</button>`}</div>`; };
    const gateRow = (g) => { const b = w.buildings.find((q) => q.id === g.id); return `<div class="sgs-r gate"><span class="nm" data-look-sec="${g.id}">${cap(g.label)}</span><span class="st">${g.broken ? "<b class='warn'>broken in</b>" : b?.gl !== undefined ? `leaves ${Math.round(b.gl * 100)}%${b.gpc > 0 || b.kind === "gatehouse" ? ` · portcullis ${Math.round((b.gpc ?? 1) * 100)}%` : ""}${b.portDown ? " (down)" : ""}` : Math.round(g.hp * 100) + "%"}${g.open ? " · open" : ""}</span></div>`; };
    const engLine = me === "attack" || true ? ["trebuchet", "mangonel", "ram", "siege_tower", "mantlet"].filter((k) => cnt(k).length).map((k) => { const es = cnt(k), asm = es.filter((e) => e.state === "assembling" || e.state === "packed"); return `${es.length} ${ARMS[k].name.toLowerCase()}${es.length > 1 ? "s" : ""}${asm.length ? ` (${asm.map((e) => e.info?.status || e.state).join(", ")})` : ""}`; }).join(" · ") : "";
    const enemyFood = me === "attack" ? (st.hunger > 0 ? "<b>they are starving</b>" : `unknown — spies say ${Math.max(1, Math.round(st.foodDays * (0.8 + 0.4 * ((G.id ?? 7) % 5) / 5)))}ish days`) : foodLine();
    const status = `<div class="sgp-sec"><div class="sgp-h">${cap(G.name)} <small>${C.real ? "" : "(laid out by the siege: castle.js absent)"}</small></div>
      <div class="sgs-meta"><span>Garrison <b>${st.garrison}</b>/${st.garrison0}</span><span>Besiegers <b>${st.besiegers}</b>/${st.besiegers0}</span><span>Stores: ${enemyFood}</span>
      ${st.relief && (me === "defend" || st.relief.known) ? `<span>Relief ${st.relief.known ? "<b>within days</b>" : `expected about day ${st.relief.day + 1}`}</span>` : ""}${me === "attack" ? `<span>The host will stay about ${Math.max(0, Math.round(st.will - day))} more days</span>` : ""}</div>
      <div class="sgs-list">${st.secs.filter((s) => s.ring !== "keep").map(secRow).join("")}${st.gates.filter((g) => g.ring !== "keep").map(gateRow).join("")}</div>
      ${st.secs.some((s) => s.ring === "keep") ? `<details class="sgs-keep"><summary>The keep</summary>${st.secs.filter((s) => s.ring === "keep").map(secRow).join("")}${st.gates.filter((g) => g.ring === "keep").map(gateRow).join("")}</details>` : ""}
      ${mines.length ? `<div class="sgs-sub">Mines</div>${mines.map((m) => `<div class="sgs-r mine"><span class="nm">Under ${m.label}</span><span class="bar"><i style="width:${Math.round(m.prog * 100)}%"></i></span><span class="st">${m.state === "lost" ? "lost" : m.state === "done" ? "sprung" : m.state === "fired" ? "props burning" : m.state === "chamber" ? "opening the chamber" : "digging"}${m.heard && me === "attack" ? " · heard!" : ""}</span></div>`).join("")}` : ""}
      ${st.barricades.length && me === "defend" ? `<div class="sgs-sub">Barricades</div>${st.barricades.filter((q) => q.state !== "gone").map((q) => `<div class="sgs-r"><span class="nm">${cap(q.label || "a breach")}</span><span class="st">${q.state === "up" ? `standing ${Math.round(q.hp * 100)}%` : q.state === "broken" ? "torn down" : `building ${Math.round(q.prog * 100)}% · ${q.status || ""}`}</span></div>`).join("")}` : ""}
      <div class="sgs-sub">The besiegers' train</div><div class="sgs-eng">${engLine || "none left"}</div></div>`;
    const tracker = `<div class="sg-track">${PHASES.map(([k, n], i) => `<span class="${i === phaseI ? "on" : i < phaseI ? "past" : ""}">${n}</span>`).join("")}</div>`;
    const html = `<div class="sgp-top"><button class="sgp-fold" data-fold title="Fold the panel away">${open.fold ? "▸" : "▾"}</button><div class="lg-kicker">${me === "attack" ? "You besiege" : "You hold"} · ${dayStr(day)}</div>${tracker}</div>${clock}
      <details class="sgp-d" ${open.orders ? "open" : ""} data-open="orders"><summary>Orders</summary>${orders}</details>
      <details class="sgp-d" ${open.status ? "open" : ""} data-open="status"><summary>The castle</summary>${status}</details>`;
    if (html === lastHtml) return; lastHtml = html;
    const sc = panel.scrollTop; panel.innerHTML = html; panel.scrollTop = sc;
    panel.classList.toggle("folded", !!open.fold);
    panel.querySelector("[data-fold]").onclick = () => { open.fold = !open.fold; lastHtml = ""; render(); };
    panel.querySelectorAll("details[data-open]").forEach((d) => d.addEventListener("toggle", () => { open[d.dataset.open] = d.open; }));
    panel.querySelectorAll("[data-act]").forEach((b) => b.onclick = () => {
      const k = b.dataset.act;
      if (k === "reckon") return G.reckoning();
      if (k === "w1") return wait(1, null, "A day of work in the lines");
      if (k === "w5") return wait(5, null, "Five days");
      if (k === "wB") return wait(60, "breach", "Until the wall comes down");
      if (k === "wM") return wait(60, "mine", "Until the mine is sprung");
      if (k === "wE") return wait(30, "engines", "Until the engines are framed up");
      if (k === "wW") return wait(30, "works", "Until the carpenters are done");
      if (k === "wA") return wait(90, "assault", "Until they come");
      act(k, { bid: b.dataset.bid ? +b.dataset.bid : undefined, what: b.dataset.what });
    });
    panel.querySelectorAll("[data-look-sec]").forEach((s) => s.onclick = () => { const b = w.buildings.find((q) => q.id === +s.dataset.lookSec); if (b) look(b.x, b.y, 160); });
  }

  // ---------------------------------------------------------------- the bar
  G.updateBar = () => {
    const st = SW.siegeStatus(w, G), now = G.fight || [st.garrison, st.besiegers];
    const mine = P === G.def ? st.garrison : st.besiegers, mine0 = P === G.def ? st.garrison0 : st.besiegers0, theirs = P === G.def ? st.besiegers : st.garrison, theirs0 = P === G.def ? st.besiegers0 : st.garrison0;
    const pct = (a, b) => Math.max(0, Math.min(100, Math.round(a / Math.max(1, b) * 100)));
    const ph = PHASES.find(([k]) => k === st.phase)?.[1] || "";
    const html = `<span class="bb-name">The siege of ${G.name}</span><span class="bb-t">${dayStr(st.day)}</span><span class="bb-wx">${ph}${me === "defend" ? ` · ${st.hunger > 0 ? "starving" : Math.floor(st.foodDays) + " days of food"}` : ""}</span>
      <span class="bb-str"><i class="t0" style="width:${pct(mine, mine0)}%"></i></span><span class="bb-n">${mine}<small>/${mine0}</small></span><span class="bb-vs">·</span><span class="bb-n">${theirs}<small>/${theirs0}</small></span><span class="bb-str"><i class="t1" style="width:${pct(theirs, theirs0)}%"></i></span>`;
    void now;
    if (bar._h !== html) { bar._h = html; bar.innerHTML = html; }
    render();
  };

  // ---------------------------------------------------------------- every frame
  G.frozen = false;
  G.frame = (dt) => {
    if (showing && performance.now() > hideT) { card.hidden = true; showing = null; }
    if (!waiting) { G.frozen = false; return; }
    G.frozen = true; // (real time holds while the days run)
    const chunk = Math.min(waiting.left, 0.06);
    const r = SW.passDays(w, G, chunk, { until: waiting.until });
    if (!waiting) { G.frozen = false; return; } // (the end came, or a herald, while the days ran)
    waiting.left -= r.days; drawVeil();
    if (r.stop !== "days" || waiting.left <= 1e-6 || G.outcome) {
      const why = r.stop !== "days" ? STOPS[r.stop] ?? "" : "";
      stopWait(why || (G.outcome ? "" : `${dayStr(SW.siegeDay(w, G))}: the days have passed`));
      G.frozen = false;
      if (r.stop === "assault") { const c = G.ai[G.att].plan?.main; if (c) look(c.x, c.y, 380); }
    }
  };
  render(); G.updateBar();
  // ---------------------------------------------------------------- headless hooks (tools/battle-shots.mjs)
  // run(n): n sim ticks at once (a headless check fast-forwards a real-time assault; the camera and the moments follow)
  const run = (n = 600, until = null) => { for (let k = 0; k < n && !G.outcome; k++) { step(w); if (until && k % 20 === 0 && until(w, G)) break; } G.updateBar(); return { day: SW.siegeDay(w, G), phase: G.phase, now: G.now, outcome: G.outcome }; };
  // focus(what, dist, view): the camera on the breach / the gate / the keep / the camp / the engines / the castle / the fighting
  const focus = (what = "castle", dist = 160, view = 2) => {
    let p = { x: C.x, y: C.y };
    if (what === "breach") { const q = SW.breaches(G)[0]; if (q) p = SW.modPoint(G, q.b, q.k); }
    else if (what === "gate") { const g = C.gates[0]; if (g) p = { x: g.x, y: g.y }; }
    else if (what === "keep" && C.keep) p = { x: C.keep.x, y: C.keep.y };
    else if (what === "camp") p = { ...G.camp };
    else if (what === "engines") { const e = (w.siege?.engines || []).find((q) => q.team === G.att && q.kind === "trebuchet") || (w.siege?.engines || [])[0]; if (e) p = { x: e.x, y: e.y }; }
    else if (what === "fight") { let x = 0, y = 0, n = 0; for (const u of G.units[G.att]) if (u.members.length && u.c?.contactT >= 0 && Math.hypot(u.ax - C.x, u.ay - C.y) < 150) { x += u.ax; y += u.ay; n++; } if (n) p = { x: x / n, y: y / n }; }
    cam.focus(p.x, p.y); cam.setView(view); cam.st.dist = cam.goal.dist = dist; return p;
  };
  const fold = (on = true) => { open.fold = on; lastHtml = ""; render(); };
  G.ui = { wait, act, render, reckoning, stopWait, look, run, focus, fold, get waiting() { return waiting; }, lordAssault, lordKeep, status: () => SW.siegeStatus(w, G) };
  return G;
}
