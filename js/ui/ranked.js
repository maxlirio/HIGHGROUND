// Ranked Battle in the game (?mode=ranked): the camp (your standing, your host, spoils to spend), the matchmaker's
// opponent fought as a pitched battle on a field drawn at random from the seed, how you fight noted from your orders,
// and the result sent home. The standings live on the realm's server (server/ranked.mjs); your account is the key.
import { customConfig, rollWeather } from "./battle-setup.js";
import { surveyField, smallField } from "../sim/battlefield.js";
import { ARMS } from "../sim/arms.js";
import * as RR from "../sim/ranked-rules.js";
import * as THREE from "three";
import { battleBar } from "./battle-run.js";

const SESSION_KEY = "hg.realm.session", MATCH_KEY = "hg.ranked.match";
const session = () => { try { return localStorage.getItem(SESSION_KEY); } catch { return null; } };
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const armName = (a) => ARMS[a]?.name || a;
export async function api(path, body = {}) {
  try {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, s: session() }), cache: "no-store" });
    const j = await r.json().catch(() => null);
    return j || { ok: false, error: r.status === 404 || r.status === 405 ? "Ranked Battle is played through the realm: open the HIGHGROUND app (or the realm's address)." : "The realm did not answer" };
  } catch { return { ok: false, error: "Can't reach the realm right now. Check your internet, or try again in a minute." } }
}
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// ---------------------------------------------------------------- the camp
// resolves with the match to fight (or navigates to the match's map first: the page reloads there)
export async function rankedConfig(el, { map, mapId, places }) {
  let match = null; try { match = JSON.parse(sessionStorage.getItem(MATCH_KEY) || "null"); } catch { /* none */ }
  if (match && match.map === mapId) { try { sessionStorage.removeItem(MATCH_KEY); } catch { /* ignore */ } return configOf(map, places, match); }
  if (!session()) { el.innerHTML = `<div class="rk"><h2>Ranked Battle</h2><p>Ranked Battle keeps your standing on the realm's server: sign in to the realm first (your account plays ranked).</p><button data-home>Back</button></div>`; el.hidden = false; el.querySelector("[data-home]").onclick = () => { location.href = "./play.html"; }; return new Promise(() => {}); }
  return new Promise((resolve) => camp(el, async (m) => {
    if (m.map !== mapId) { try { sessionStorage.setItem(MATCH_KEY, JSON.stringify(m)); } catch { /* ignore */ } location.href = `./?mode=ranked&map=${encodeURIComponent(m.map)}`; return; }
    el.hidden = true; resolve(configOf(map, places, m));
  }));
}

let TAB = "host";
async function camp(el, onFight) {
  el.hidden = false; el.innerHTML = `<div class="rk"><h2>Ranked Battle</h2><p>Mustering…</p></div>`;
  const [r, b] = await Promise.all([api("/ranked/me"), api("/ranked/board")]);
  if (!r.ok) { el.innerHTML = `<div class="rk"><h2>Ranked Battle</h2><p>${esc(r.error)}</p><button data-home>Back</button></div>`; el.querySelector("[data-home]").onclick = () => { location.href = "./play.html"; }; return; }
  const draw = (me, msg = "") => {
    const C = me.cat, opsN = me.companies.filter((c) => c.op).length;
    const last = me.last.slice().reverse().map((x) => `<li>${x.outcome === "win" ? "Won" : x.outcome === "draw" ? "Drew" : "Lost"} against ${esc(x.vs)}${x.kind === "ghost" ? " (a player's host)" : x.kind === "live" ? " (live)" : ""} · rating ${x.d >= 0 ? "+" : ""}${x.d} · +${x.spoils} spoils</li>`).join("");
    const board = (b.board || []).map((q, i) => `<tr><td>${i + 1}</td><td>${esc(q.name)}</td><td>${q.rating}</td><td>${q.w}–${q.l}${q.d ? `–${q.d}` : ""}</td><td>${esc(q.temper)}</td></tr>`).join("");
    const twin = (c) => (c.op ? null : me.companies.find((q) => q !== c && q.arm === c.arm && !q.op && (q.drill || 0) === (c.drill || 0)) || null);
    const coRow = (c) => {
      const d = c.drill || 0, next = C.drill[d + 1], dc = next ? (next.cost - C.drill[d].cost) * c.n : 0, bow = ["archers", "crossbow"].includes(c.arm);
      const pos = Object.entries(C.positions).map(([k, v]) => `<option value="${k}" ${c.pos === k ? "selected" : ""}>${esc(v)}</option>`).join("") + (["ambush", "hidden"].includes(c.pos) ? `<option selected>${c.pos === "ambush" ? "In ambush" : "Hidden behind the line"}</option>` : "");
      return `<tr data-co="${esc(c.id)}"><td><input class="rk-name" value="${esc(c.name || "")}" placeholder="${esc(armName(c.arm))}" maxlength="24"><small>${c.n} ${esc(armName(c.arm))}${c.op ? " · special" : ""}</small></td>
        <td><select class="rk-pos" ${c.op && ["ambush", "hidden"].includes(c.pos) ? "disabled" : ""}>${pos}</select></td>
        <td>${esc(C.drill[d].name)}${next ? ` <button data-drill="${d + 1}" ${me.spoils < dc ? "disabled" : ""} title="${dc} spoils">→ ${esc(next.name)} (${dc})</button>` : ""}</td>
        <td>${bow ? (c.stakes ? "Stakes ✓" : `<button data-stakes ${me.spoils < C.stakes ? "disabled" : ""}>Stakes (${C.stakes})</button>`) : ""}</td>
        <td class="btns">${!c.op && c.n >= 2 ? `<button data-split title="Split this company in two (half its men to a new company)">Split</button>` : ""}${twin(c) ? `<button data-merge="${esc(twin(c).id)}" title="Join it to the other company of ${esc(armName(c.arm))} with the same drill">Merge</button>` : ""}<button class="ghost" data-disband title="Send them home (no spoils back)">✕</button></td></tr>`;
    };
    const tabs = { host: "Your host", ops: "Special companies", cmd: "Your commander", spells: "Spells" };
    let body = "";
    if (TAB === "host") {
      const shop = Object.entries(me.prices).map(([a, c]) => `<tr><td>${esc(armName(a))}</td><td>${c} / ${me.step}</td><td class="btns"><button data-buy="${a}" data-n="${me.step}" ${me.spoils < c ? "disabled" : ""}>+${me.step}</button><button data-buy="${a}" data-n="${me.step * 4}" ${me.spoils < c * 4 ? "disabled" : ""}>+${me.step * 4}</button></td></tr>`).join("");
      body = `<p class="small">Name your companies, say where each draws up, drill them, give the bowmen stakes.</p><table class="rk-cos"><tr><th>Company</th><th>Draws up</th><th>Drill</th><th></th><th></th></tr>${me.companies.map(coRow).join("")}</table>
        <h3>Raise more men</h3><table class="rk-shop">${shop}</table>`;
    } else if (TAB === "ops") {
      body = `<p class="small">Picked men for a special task — at most ${C.opsMax} in a host (you have ${opsN}).</p><table class="rk-shop">` + Object.entries(C.ops).map(([k, O]) => { const have = me.companies.some((c) => c.op === k);
        return `<tr><td><b>${esc(O.name)}</b><br><small>${esc(O.desc)}</small></td><td>${O.cost}</td><td class="btns">${have ? "In your host ✓" : `<button data-op="${k}" ${me.spoils < O.cost || opsN >= C.opsMax ? "disabled" : ""}>Hire</button>`}</td></tr>`; }).join("") + `</table>`;
    } else if (TAB === "cmd") {
      body = `<p class="small">Your commander, <b>${esc(me.commander || "")}</b>, leads your largest company in the field. He knows ${C.slots} skills at most (${me.skills.length} now). Forget one to learn another.</p><table class="rk-shop">` + Object.entries(C.skills).map(([k, K]) => { const have = me.skills.includes(k);
        return `<tr><td><b>${esc(K.name)}</b><br><small>${esc(K.desc)}</small></td><td>${K.cost}</td><td class="btns">${have ? `<button class="ghost" data-forget="${k}">Forget</button>` : `<button data-skill="${k}" ${me.spoils < K.cost || me.skills.length >= C.slots ? "disabled" : ""}>Learn</button>`}</td></tr>`; }).join("") + `</table>`;
    } else {
      body = `<p class="small">Charges you carry into battle (${C.spellMax} of each at most); cast them from the spell bar on the field. A charge cast is spent.</p><table class="rk-shop">` + Object.entries(C.spells).map(([k, Sp]) => { const n = me.spells[k] || 0;
        return `<tr><td><b>${esc(Sp.name)}</b> ${n ? `· <b>${n}</b> carried` : ""}<br><small>${esc(Sp.desc)}</small></td><td>${Sp.cost}</td><td class="btns"><button data-spell="${k}" ${me.spoils < Sp.cost || n >= C.spellMax ? "disabled" : ""}>+1</button></td></tr>`; }).join("") + `</table>`;
    }
    el.innerHTML = `<div class="rk">
      <h2>Ranked Battle</h2>
      <p class="rk-names"><label>Your lord <input data-name="lord" value="${esc(me.lord || "")}" maxlength="${me.nameMax || 24}"></label><label>Your commander <input data-name="commander" value="${esc(me.commander || "")}" maxlength="${me.nameMax || 24}"></label></p>
      <p class="rk-who"><b>${esc(me.name)}</b> · rating <b>${me.rating}</b> · ${me.w} won, ${me.l} lost${me.d ? `, ${me.d} drawn` : ""} · <b>${me.spoils}</b> spoils · ${me.men} men</p>
      <p class="small">${me.battles ? `The heralds say you fight like a <b>${esc(me.temperName)}</b>. When others meet your host while you are away, it is led your way${me.defW + me.defL ? ` (it has stood ${me.defW} and fallen ${me.defL} times without you)` : ""}.` : "Fight a few battles and the heralds will learn how you lead: others will meet your host, led your way."}</p>
      <div class="rk-fightrow"><button class="rk-fight" data-fight>Find a battle</button><span class="msg" data-msg>${msg}</span></div>
      <div class="rk-tabs">${Object.entries(tabs).map(([k, v]) => `<button data-tab="${k}" class="${TAB === k ? "on" : ""}">${v}</button>`).join("")}</div>
      <div class="rk-body">${body}</div>
      ${last ? `<h3>Your last battles</h3><ul class="rk-last">${last}</ul>` : ""}
      ${board ? `<h3>The table</h3><table class="rk-board"><tr><th></th><th>Lord</th><th>Rating</th><th>W–L</th><th>Leads like</th></tr>${board}</table>` : ""}
      <p class="small"><a href="./play.html">Back to the menu</a></p></div>`;
    const call = async (path, body2, ok) => { const q = await api(path, body2); draw(q.me || me, q.ok ? ok : esc(q.error || "No")); };
    el.querySelectorAll("[data-name]").forEach((inp) => inp.onchange = (e) => call("/ranked/names", { [inp.dataset.name]: e.target.value }, inp.dataset.name === "lord" ? "Your lord is known by that name now" : "Your commander is known by that name now"));
    el.querySelectorAll("[data-tab]").forEach((bt) => bt.onclick = () => { TAB = bt.dataset.tab; draw(me); });
    el.querySelectorAll("[data-buy]").forEach((bt) => bt.onclick = () => { bt.disabled = true; call("/ranked/buy", { arm: bt.dataset.buy, n: +bt.dataset.n }, `${bt.dataset.n} ${esc(armName(bt.dataset.buy))} join your host`); });
    el.querySelectorAll("[data-op]").forEach((bt) => bt.onclick = () => { bt.disabled = true; call("/ranked/op", { key: bt.dataset.op }, `${esc(C.ops[bt.dataset.op].name)} join your host`); });
    el.querySelectorAll("[data-skill]").forEach((bt) => bt.onclick = () => { bt.disabled = true; call("/ranked/skill", { id: bt.dataset.skill }, `Your commander learns ${esc(C.skills[bt.dataset.skill].name)}`); });
    el.querySelectorAll("[data-forget]").forEach((bt) => bt.onclick = () => call("/ranked/skill", { id: bt.dataset.forget, forget: true }, "Forgotten"));
    el.querySelectorAll("[data-spell]").forEach((bt) => bt.onclick = () => { bt.disabled = true; call("/ranked/spell", { id: bt.dataset.spell, n: 1 }, `A charge of ${esc(C.spells[bt.dataset.spell].name)}`); });
    el.querySelectorAll("[data-co]").forEach((row) => {
      const id = row.dataset.co;
      row.querySelector(".rk-name").onchange = (e) => call("/ranked/company", { id, name: e.target.value }, "Named");
      const ps = row.querySelector(".rk-pos"); if (ps) ps.onchange = (e) => call("/ranked/company", { id, pos: e.target.value }, "They will draw up there");
      row.querySelector("[data-drill]")?.addEventListener("click", (e) => call("/ranked/company", { id, drill: +e.target.dataset.drill }, "Drilled"));
      row.querySelector("[data-stakes]")?.addEventListener("click", () => call("/ranked/company", { id, stakes: true }, "Stakes cut"));
      row.querySelector("[data-split]")?.addEventListener("click", () => { const c = me.companies.find((q) => q.id === id); const k = Math.floor((c?.n || 0) / 2); if (k >= 1) call("/ranked/company", { id, split: k }, `${k} men split off into a new company`); });
      row.querySelector("[data-merge]")?.addEventListener("click", (e) => call("/ranked/company", { id, merge: e.target.dataset.merge }, "The companies join"));
      row.querySelector("[data-disband]").onclick = () => { if (confirm("Send this company home? (no spoils back)")) call("/ranked/company", { id, disband: true }, "Sent home"); };
    });
    el.querySelector("[data-fight]").onclick = async () => {
      const f = el.querySelector("[data-fight]"); f.disabled = true; f.textContent = "The heralds ride out…";
      el.querySelector("[data-msg]").textContent = "Looking for a live lord first (another player looking now) — a moment…";
      const q = await api("/ranked/match", { live: true }); if (!q.ok) { draw(me, esc(q.error)); return; }
      const m = q.match, foe = m.foe;
      if (m.live) { el.querySelector("[data-msg]").innerHTML = `A live lord! <b>${esc(foe.name)}</b> (rating ${foe.rating}) meets you on the field. To horse…`; setTimeout(() => { location.href = `./?live=${encodeURIComponent(m.id)}&map=${encodeURIComponent(m.map)}`; }, 1400); return; }
      el.querySelector("[data-msg]").innerHTML = `Your foe: <b>${esc(foe.lord || foe.name)}</b> (rating ${foe.rating}${foe.kind === "ghost" ? `, ${esc(foe.name)}'s host led his way` : ""}), a ${esc(foe.temperName)}. To the field…`;
      setTimeout(() => onFight(m), 1400);
    };
  };
  draw(r.me);
}

// ---------------------------------------------------------------- the field, from the match's seed
function configOf(map, places, m) {
  const R = mulberry(m.seed), size = map.size || 4000;
  let best = null;
  for (let k = 0; k < 50; k++) { // a small field anywhere on the map that the hosts can stand on (randomBattle's survey, seeded)
    const site = { x: 600 + R() * (size - 1200), y: 600 + R() * (size - 1200) }, axis = R() * Math.PI * 2;
    const towns = (map.meta?.features || []).filter((f) => f.type === "town_site");
    if (towns.some((t) => Math.hypot(t.xy_m[0] - site.x, t.xy_m[1] - site.y) < 600)) continue;
    const s = surveyField(map, site, axis, { coarse: true });
    const v = -s.water.deepAcross * 4 - s.woods.mid * 2 - s.offMap * 0.1 - s.inWater[0] * 2 - s.inWater[1] * 2 + R() * 0.8;
    if (!best || v > best.v) best = { v, site, axis };
  }
  const site = best?.site || { x: size / 2, y: size / 2 }, axis = best?.axis || 0;
  const mine = m.mine || { companies: RR.companiesFrom(m.army), skills: [], spells: {} }, foeL = { companies: m.foe.companies || RR.companiesFrom(m.foe.army), skills: m.foe.skills || [], spells: m.foe.spells || {} };
  // both hosts under their own lords, each commander at the head of his main company, each company's captain its own:
  // the same names every battle (server/ranked.mjs keeps them; a recorded host brings its player's)
  const lords = [mine.lord || "your lord", m.foe.lord || m.foe.name];
  const cfg = customConfig({ site, axis, host: RR.hostCompanies(mine.companies, mine.skills, mine.commander || null), foe: RR.hostCompanies(foeL.companies, foeL.skills, m.foe.commander || null), temper: m.foe.temper, hidden: true, weather: rollWeather(R()), tod: ["dawn", "noon", "noon", "dusk"][Math.floor(R() * 4)],
    windDir: ["back", "face", "across"][Math.floor(R() * 3)], names: [places.townName(0), lords[1]], places });
  cfg.sides.forEach((d, k) => { d.name = `the host of ${lords[k]}`; d.adj = undefined; d.lord = d.lordName = lords[k]; });
  cfg.ranked = { id: m.id, foe: m.foe, mine, foeL }; cfg.name = `Ranked: against ${m.foe.name}`;
  Object.assign(cfg, smallField(RR.armyMen(m.army), RR.armyMen(m.foe.army))); cfg.sides[1].hidden = false; // (a small field, the foe in plain view: no hunting him across the vale)
  return cfg;
}

// ---------------------------------------------------------------- how you fight: counted from your orders
export function makeStyleWatch(cfg) {
  const s = { attack: 0, hold: 0, flank: 0, missile: 0, ambush: 0, charge: 0 };
  const ax = Math.cos(cfg.axis), ay = Math.sin(cfg.axis);
  const lateral = (x, y) => Math.abs(-(x - cfg.site.x) * ay + (y - cfg.site.y) * ax); // (distance off the line between the hosts)
  return {
    style: s,
    note(op, a) {
      if (op === "attack") { if (a?.how?.pace === "charge") s.charge++; else s.attack++; return; }
      if (op !== "order" || !a?.order) return;
      const o = a.order, k = o.kind;
      if (o.pace === "charge") s.charge++;
      if (k === "attack" || k === "assault" || k === "advance") s.attack++;
      else if (k === "hold" || k === "fortify") s.hold++;
      else if (k === "skirmish" || k === "volley" || k === "loose") s.missile++;
      else if (k === "ambush") s.ambush++;
      if (Number.isFinite(o.x) && lateral(o.x, o.y) > 160) s.flank++;
    },
  };
}

// ---------------------------------------------------------------- the reckoning: sent home, shown
export async function reportResult(cfg, winnerTeam, playerTeam, style, spellsUsed = cfg.ranked?.used || null) {
  const outcome = winnerTeam === playerTeam ? "win" : winnerTeam < 0 ? "draw" : "loss";
  const r = await api("/ranked/result", { id: cfg.ranked.id, outcome, style, spellsUsed });
  const box = document.createElement("div"); box.className = "rk-result";
  box.innerHTML = r.ok
    ? `<span><b>${outcome === "win" ? "Victory" : outcome === "draw" ? "A drawn field" : "Defeat"}</b> · rating ${r.me.rating} (${r.delta >= 0 ? "+" : ""}${r.delta}) · +${r.spoils} spoils (${r.me.spoils} in all)</span><button data-camp>To the camp</button>`
    : `<span><b>${outcome === "win" ? "Victory" : outcome === "draw" ? "A drawn field" : "Defeat"}</b> · the result could not be sent home: ${esc(r.error)}</span><button data-camp>To the camp</button>`;
  document.body.appendChild(box);
  box.querySelector("[data-camp]").onclick = () => { location.href = "./?mode=ranked"; };
  return r;
}

// ---------------------------------------------------------------- a live battle (?live=id): the same field as a battle in the browser
// The owner: "It should be structured JUST like a normal battle against an AI." The server runs the sim (server/live-battle.mjs);
// this is the battle the frame round it reads (js/ui/battle-run.js's bar, js/ui/battle-deploy.js's deployment): your ground lit,
// your host to draw up, the scouts, "Sound the advance" (the trumpets wait for both lords), then the verdict.
//   liveBattle(hello, { w, realm, toast }) → battle (PLAYER 0 = you on your own screen, as the mirror has it)
export function liveBattle(hello, { w, realm, toast = () => {} }) {
  const L = hello?.live, F = L?.field; if (!F) return null;
  const send = (m) => { try { realm?.ws?.send(JSON.stringify(m)); } catch { /* the socket reconnects and says hello again */ } };
  const side = F.side, sideOf = (t) => (t === 0 ? side : 1 - side), teamOf = (sd) => (sd === side ? 0 : 1);
  const cfg = { name: `Ranked: against ${L.foe.name}`, sides: F.sides, weather: F.weather, tod: F.tod, windFrom: F.windFrom, site: F.site, axis: F.axis, arena: L.arena, live: true };
  const strength = (t) => { const S = w.S; let fight = 0; for (let i = 0; i < S.n; i++) if (S.alive[i] && S.team[i] === t && S.state[i] !== 3) fight++; return { fight }; };
  const B = { live: true, cfg, zones: F.zones, PLAYER: 0, sideOf, teamOf, phase: F.phase || "deploy", frozen: false, ob: { timeLimit: { secs: F.timeLimit, winner: -1 } },
    rec: { t0: w.time, start: [0, 0], now: null, outcome: null, moments: [], strength },
    names: { side: (t) => cfg.sides[sideOf(t)]?.name || "", adj: (t) => cfg.sides[sideOf(t)]?.adj || "", lord: (t) => cfg.sides[sideOf(t)]?.lord || "", place: () => "" },
    get units() { const a = [[], []]; for (const u of w.units.values()) if (u.members.length && !u.isWorkers) a[sideOf(u.team === 0 ? 0 : 1)].push(u); return a; },
    frame() {}, updateBar() { battleBar(w, B); }, advance() {},
    remote: { foe: L.foe.name, set: !!F.set, isReady() { return this.set; }, ready() { this.set = true; send({ t: "dset" }); },
      move: (u) => send({ t: "dmove", unit: u.id, x: u.ax, y: u.ay, face: u.finalFacing }), form: (u, f) => send({ t: "dform", unit: u.id, f }), stakes: (u, on) => send({ t: "dstakes", unit: u.id, on: !!on }) } };
  addEventListener("live-bar", (e) => { const o = e.detail || {}; B.phase = o.phase; B.rec.t0 = w.time - (o.secs || 0); B.rec.start = o.start || [0, 0]; B.rec.now = [{ fight: o.fight?.[0] || 0 }, { fight: o.fight?.[1] || 0 }]; B.onBar?.(o); });
  addEventListener("live-advance", () => { B.phase = "battle"; B.onAdvance?.(); });
  addEventListener("ranked-end", (e) => { const o = e.detail || {}; B.rec.outcome = { winner: o.winner < 0 ? -1 : o.mine === 1 ? 0 : 1, why: o.why }; B.onEnd?.(o); }, { once: true });
  // "Offer a draw": when both lords must leave, or neither can win it — drawn when the other accepts (server/live-battle.mjs)
  const dr = document.createElement("div"); dr.className = "rk-draw"; document.body.appendChild(dr);
  let offer = { mine: false, foe: false };
  const drawBtn = () => { dr.innerHTML = offer.foe && !offer.mine ? `<span><b>${esc(L.foe.name)}</b> offers a draw</span><button data-draw class="on">Accept the draw</button>`
    : offer.mine ? `<span>You offered a draw · waiting for ${esc(L.foe.name)}</span><button data-undraw>Withdraw</button>` : `<button data-draw title="Ask ${esc(L.foe.name)} to call the battle a draw (when you both must go, or neither can win it)">Offer a draw</button>`;
    dr.querySelector("[data-draw]")?.addEventListener("click", () => { offer.mine = true; send({ t: "draw", on: true }); drawBtn(); });
    dr.querySelector("[data-undraw]")?.addEventListener("click", () => { offer.mine = false; send({ t: "draw", on: false }); drawBtn(); }); };
  drawBtn();
  addEventListener("live-draw", (e) => { const o = e.detail || {}; const was = offer.foe; offer = { mine: !!o.mine, foe: !!o.foe }; if (offer.foe && !was) toast(`${L.foe.name} offers a draw`); drawBtn(); });
  addEventListener("ranked-end", () => dr.remove(), { once: true });
  // the server starts the deploy's clock once both lords' models are in (the loading screen gone)
  const ready = () => { if (document.getElementById("loading")) return setTimeout(ready, 500); send({ t: "ready" }); };
  ready();
  toast(`A live battle against ${L.foe.name}: draw up your host`);
  return B;
}
// the verdict card (a battle in the browser has the same: main.js battleUI)
export function liveVerdict(o, B) {
  const y = o.you, won = o.mine === 1, draw = o.mine !== 0 && o.mine !== 1, card = document.createElement("div"); card.id = "battleend"; card.className = draw ? "draw" : won ? "won" : "lost";
  card.innerHTML = `<div class="be-k">${draw ? "Nightfall" : won ? "Victory" : "Defeat"}</div><div class="be-t">${esc(o.why ? o.why[0].toUpperCase() + o.why.slice(1) : draw ? "Both hosts draw off" : `${B.names.side(won ? 0 : 1)} hold the field`)}</div>
    ${y ? `<div class="be-t rk-live">Rating ${y.rating} (${y.delta >= 0 ? "+" : ""}${y.delta}) · +${y.spoils} spoils (${y.total} in all)</div>` : ""}<div class="be-b"><button data-camp class="on">To the camp</button><button data-watch>Watch the field</button></div>`;
  document.querySelector("#hud").append(card);
  card.querySelector("[data-camp]").onclick = () => { location.href = "./?mode=ranked"; };
  card.querySelector("[data-watch]").onclick = () => { card.querySelector("[data-watch]").remove(); };
  return card;
}

// ---------------------------------------------------------------- on the field: skills, the foe's spells, your spell bar, the arena
// kit({ w, cfg, battle, PLAYER, scene, map, camera, canvas, groundAt, toast }) — a battle in this browser (bot or recorded host)
// kit({ live: { send, charges, skills, arena }, scene, map, camera, canvas, groundAt, toast }) — a live battle (the sim on the server)
export function battleKit(o) {
  const { scene, map, camera, canvas, groundAt, toast = () => {} } = o;
  const A = o.live ? o.live.arena : o.cfg?.arena ? { x: o.cfg.site.x, y: o.cfg.site.y, r: o.cfg.arena.r } : null;
  if (A && scene) { // the arena's edge on the ground, and the camera kept over the field
    const pts = []; for (let k = 0; k <= 96; k++) { const a = k / 96 * Math.PI * 2, x = A.x + Math.cos(a) * A.r, y = A.y + Math.sin(a) * A.r; pts.push(new THREE.Vector3(x, (map.h(x, y) || 0) + 1.2, -y)); }
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0xd4a94a, dashSize: 8, gapSize: 6, transparent: true, opacity: 0.85 }));
    ring.computeLineDistances(); ring.renderOrder = 5; scene.add(ring);
    const keep = () => { const st = camera?.st; if (st) { const dx = st.tx - A.x, dy = st.ty - A.y, d = Math.hypot(dx, dy), lim = A.r * 1.1; if (d > lim) { st.tx = A.x + dx * lim / d; st.ty = A.y + dy * lim / d; } const dmax = A.r * 2.2; if (camera.goal && camera.goal.dist > dmax) camera.goal.dist = dmax; if (st.dist > dmax) st.dist = dmax; } /* (the goal too: clamping only st.dist, the camera eased back out to its goal every frame and was pulled in again — the screen shook) */ requestAnimationFrame(keep); };
    requestAnimationFrame(keep);
  }
  if (!o.live && o.w && o.cfg?.ranked) { // the commanders' skills and the foe's spells, in this browser's sim
    const { w, battle, PLAYER } = o, R = o.cfg.ranked, foeT = 1 - PLAYER;
    [[R.mine.skills, PLAYER], [R.foeL.skills, foeT]].forEach(([sk, t]) => { const sys = RR.skillSystem(sk || [], t); if (sys) w.systems.push((w) => { if (battle.phase !== "deploy") sys(w); }); });
    const adv = battle.advance; battle.advance = (...a) => { const r = adv.apply(battle, a); if ((R.mine.skills || []).includes("eagle")) RR.eagleEye(w, PLAYER); if ((R.foeL.skills || []).includes("eagle")) RR.eagleEye(w, foeT); return r; };
    const cast = RR.aiCaster({ ...(R.foeL.spells || {}) }, foeT, R.foe.wits ?? 0); // the foe's lord casts too (js/sim/ranked-rules.js)
    w.systems.push((w) => { if (battle.phase !== "deploy") cast(w); });
  }
  // your spell bar
  const charges = o.live ? { ...(o.live.charges || {}) } : { ...(o.cfg?.ranked?.mine?.spells || {}) }, used = {};
  if (o.cfg?.ranked) o.cfg.ranked.used = used;
  const kinds = Object.keys(RR.RSPELLS).filter((k) => charges[k] > 0); if (!kinds.length) return { used };
  const bar = document.createElement("div"); bar.className = "rk-spells"; document.body.appendChild(bar);
  let armed = null;
  const draw = () => { bar.innerHTML = `<b>Spells</b>` + kinds.map((k) => `<button data-sp="${k}" class="${armed === k ? "on" : ""}" ${charges[k] > 0 ? "" : "disabled"} title="${esc(RR.RSPELLS[k].desc)}">${esc(RR.RSPELLS[k].name)} ×${charges[k] || 0}</button>`).join("") + (armed ? `<span>click the field…</span>` : ""); bar.querySelectorAll("[data-sp]").forEach((b) => b.onclick = () => { armed = armed === b.dataset.sp ? null : b.dataset.sp; draw(); }); };
  draw();
  const onDown = (e) => {
    if (!armed || e.button !== 0) return;
    const g = groundAt(e.clientX, e.clientY); if (!g) return;
    e.stopPropagation(); e.preventDefault();
    const k = armed; armed = null;
    if (o.live) { o.live.send({ t: "rspell", kind: k, x: g.x, y: g.y }); charges[k]--; used[k] = (used[k] || 0) + 1; toast(`${RR.RSPELLS[k].name}!`); }
    else if (o.battle?.phase === "deploy") { toast("Spells wait for the trumpets"); }
    else if (RR.castRanked(o.w, o.PLAYER, k, g.x, g.y)) { charges[k]--; used[k] = (used[k] || 0) + 1; toast(`${RR.RSPELLS[k].name}!`); }
    draw();
  };
  canvas.addEventListener("pointerdown", onDown, true);
  return { used };
}
