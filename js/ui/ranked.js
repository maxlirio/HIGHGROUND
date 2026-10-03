// Ranked Battle in the game (?mode=ranked): the camp (your standing, your host, spoils to spend), the matchmaker's
// opponent fought as a pitched battle on a field drawn at random from the seed, how you fight noted from your orders,
// and the result sent home. The standings live on the realm's server (server/ranked.mjs); your account is the key.
import { customConfig, rollWeather } from "./battle-setup.js";
import { surveyField } from "../sim/battlefield.js";
import { ARMS } from "../sim/arms.js";
import * as RR from "../sim/ranked-rules.js";

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

async function camp(el, onFight) {
  el.hidden = false; el.innerHTML = `<div class="rk"><h2>Ranked Battle</h2><p>Mustering…</p></div>`;
  const [r, b] = await Promise.all([api("/ranked/me"), api("/ranked/board")]);
  if (!r.ok) { el.innerHTML = `<div class="rk"><h2>Ranked Battle</h2><p>${esc(r.error)}</p><button data-home>Back</button></div>`; el.querySelector("[data-home]").onclick = () => { location.href = "./play.html"; }; return; }
  const draw = (me, msg = "") => {
    const army = me.army.map(([a, n]) => `<li><b>${n}</b> ${esc(armName(a))}</li>`).join("");
    const shop = Object.entries(me.prices).map(([a, c]) => `<tr><td>${esc(armName(a))}</td><td>${c} spoils / ${me.step}</td><td class="btns"><button data-buy="${a}" data-n="${me.step}" ${me.spoils < c ? "disabled" : ""}>+${me.step}</button><button data-buy="${a}" data-n="${me.step * 4}" ${me.spoils < c * 4 ? "disabled" : ""}>+${me.step * 4}</button></td></tr>`).join("");
    const last = me.last.slice().reverse().map((x) => `<li>${x.outcome === "win" ? "Won" : x.outcome === "draw" ? "Drew" : "Lost"} against ${esc(x.vs)}${x.kind === "ghost" ? " (a player's host)" : ""} · rating ${x.d >= 0 ? "+" : ""}${x.d} · +${x.spoils} spoils</li>`).join("");
    const board = (b.board || []).map((q, i) => `<tr><td>${i + 1}</td><td>${esc(q.name)}</td><td>${q.rating}</td><td>${q.w}–${q.l}${q.d ? `–${q.d}` : ""}</td><td>${esc(q.temper)}</td></tr>`).join("");
    el.innerHTML = `<div class="rk">
      <h2>Ranked Battle</h2>
      <p class="rk-who"><b>${esc(me.name)}</b> · rating <b>${me.rating}</b> · ${me.w} won, ${me.l} lost${me.d ? `, ${me.d} drawn` : ""} · <b>${me.spoils}</b> spoils</p>
      <p class="small">${me.battles ? `The heralds say you fight like a <b>${esc(me.temperName)}</b>. When others meet your host while you are away, it is led your way${me.defW + me.defL ? ` (it has stood ${me.defW} and fallen ${me.defL} times without you)` : ""}.` : "Fight a few battles and the heralds will learn how you lead: others will meet your host, led your way."}</p>
      <div class="rk-cols">
        <div><h3>Your host · ${me.men} men · ${me.value} d a day</h3><ul class="rk-army">${army}</ul>
          <button class="rk-fight" data-fight>Find a battle</button><p class="msg" data-msg>${esc(msg)}</p></div>
        <div><h3>Spend the spoils</h3><table class="rk-shop">${shop}</table></div>
      </div>
      ${last ? `<h3>Your last battles</h3><ul class="rk-last">${last}</ul>` : ""}
      ${board ? `<h3>The table</h3><table class="rk-board"><tr><th></th><th>Lord</th><th>Rating</th><th>W–L</th><th>Leads like</th></tr>${board}</table>` : ""}
      <p class="small"><a href="./play.html">Back to the menu</a></p></div>`;
    el.querySelectorAll("[data-buy]").forEach((bt) => bt.onclick = async () => { bt.disabled = true; const q = await api("/ranked/buy", { arm: bt.dataset.buy, n: +bt.dataset.n }); draw(q.me || me, q.ok ? `${bt.dataset.n} ${armName(bt.dataset.buy)} join your host` : q.error); });
    el.querySelector("[data-fight]").onclick = async () => {
      const f = el.querySelector("[data-fight]"); f.disabled = true; f.textContent = "The heralds ride out…";
      const q = await api("/ranked/match"); if (!q.ok) { draw(me, q.error); return; }
      const m = q.match, foe = m.foe;
      el.querySelector("[data-msg]").innerHTML = `Your foe: <b>${esc(foe.name)}</b> (rating ${foe.rating}${foe.kind === "ghost" ? ", a player's host led his way" : ""}), a ${esc(foe.temperName)}. To the field…`;
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
  const cfg = customConfig({ site, axis, host: m.army, foe: m.foe.army, temper: m.foe.temper, hidden: true, weather: rollWeather(R()), tod: ["dawn", "noon", "noon", "dusk"][Math.floor(R() * 4)],
    windDir: ["back", "face", "across"][Math.floor(R() * 3)], names: [places.townName(0), m.foe.name], places });
  cfg.sides[1].name = `the host of ${m.foe.name}`; cfg.sides[1].lord = m.foe.name;
  cfg.ranked = { id: m.id, foe: m.foe }; cfg.name = `Ranked: against ${m.foe.name}`;
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
export async function reportResult(cfg, winnerTeam, playerTeam, style) {
  const outcome = winnerTeam === playerTeam ? "win" : winnerTeam < 0 ? "draw" : "loss";
  const r = await api("/ranked/result", { id: cfg.ranked.id, outcome, style });
  const box = document.createElement("div"); box.className = "rk-result";
  box.innerHTML = r.ok
    ? `<b>${outcome === "win" ? "Victory" : outcome === "draw" ? "A drawn field" : "Defeat"}</b> · rating ${r.me.rating} (${r.delta >= 0 ? "+" : ""}${r.delta}) · +${r.spoils} spoils (${r.me.spoils} in all)<button data-camp>To the camp</button>`
    : `<b>${outcome === "win" ? "Victory" : outcome === "draw" ? "A drawn field" : "Defeat"}</b> · the result could not be sent home: ${esc(r.error)}<button data-camp>To the camp</button>`;
  document.body.appendChild(box);
  box.querySelector("[data-camp]").onclick = () => { location.href = "./?mode=ranked"; };
  return r;
}
