// Ranked Battle in the game (?mode=ranked): the camp (your standing, your host, spoils to spend), the matchmaker's
// opponent fought as a pitched battle on a field drawn at random from the seed, how you fight noted from your orders,
// and the result sent home. The standings live on the realm's server (server/ranked.mjs); your account is the key.
import { customConfig, rollWeather } from "./battle-setup.js";
import { surveyField, smallField, hostReach, TROOPS } from "../sim/battlefield.js";
import { ARMS } from "../sim/arms.js";
import { glyphSVG } from "./glyphs.js";
import * as RR from "../sim/ranked-rules.js";
import { ERAS, DEFAULT_ERA, warHas, eraOf } from "../sim/eras.js";
import * as THREE from "three";
import { battleBar } from "./battle-run.js";

const SESSION_KEY = "hg.realm.session", MATCH_KEY = "hg.ranked.match";
// Which war's ladder this is (docs/eras-plan.md § A game each, stage 3). The menu chose it and the URL carries it
// — ?mode=ranked&era=ardennes — and every call home says which book it means, so a lord's spoils, his unlocks and
// his three lists in 1944 are not the ones he keeps in the Vale.
const askedEra = () => { try { return new URLSearchParams(location.search).get("era") || DEFAULT_ERA; } catch { return DEFAULT_ERA; } };
export const ERA = (() => { const e = askedEra(); return ERAS[e] && warHas(e, "ranked") ? e : DEFAULT_ERA; })();
const warQ = () => (ERA === DEFAULT_ERA ? "" : `&era=${ERA}`); // (the Vale's links stay as they always were)
const session = () => { try { return localStorage.getItem(SESSION_KEY); } catch { return null; } };
const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const armName = (a) => ARMS[a]?.name || a;
export async function api(path, body = {}) {
  try {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ era: ERA, ...body, s: session() }), cache: "no-store" });
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
    if (m.map !== mapId) { try { sessionStorage.setItem(MATCH_KEY, JSON.stringify(m)); } catch { /* ignore */ } location.href = `./?mode=ranked&map=${encodeURIComponent(m.map)}${warQ()}`; return; }
    el.hidden = true; resolve(configOf(map, places, m));
  }));
}

// ---------------------------------------------------------------- the camp
// The camp is the lord's own pavilion, not a ledger: his crest and his standing at the head, his muster beside it, then
// his companies as cards — each with its arm's glyph, its drill and where it draws up. (The owner, 2026-10-17: "make the
// UI for the ranked be really nice, not like an info chart".)
let TAB = "host";
const num = (n) => Math.round(n || 0).toLocaleString("en-GB");
const glyphOf = (arm) => glyphSVG(ARMS[arm]?.glyph || "spear");
// a lord's shield, drawn from his name: two tinctures, a bend, and his initial
const CREST = ["#8a2b24", "#2f5fa8", "#4a6b35", "#6b4a8a", "#9a6b1f", "#2f6b68"];
function crest(name) {
  let h = 2166136261; for (const ch of String(name || "?")) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  const a = CREST[(h >>> 3) % CREST.length], b = CREST[(h >>> 11) % CREST.length], bend = (h >>> 17) % 3;
  const ini = esc((String(name || "?").replace(/^(Sir|Lord|the)\s+/i, "").trim()[0] || "?").toUpperCase());
  const band = bend === 0 ? `<path d="M2 2h36v12H2z" fill="${b}" opacity=".85"/>` : bend === 1 ? `<path d="M2 2 38 2 38 10 2 26z" fill="${b}" opacity=".8"/>` : `<path d="M20 2v44M2 16h36" stroke="${b}" stroke-width="7" opacity=".8"/>`;
  return `<svg class="rk-shield" viewBox="0 0 40 48" aria-hidden="true"><path d="M2 2h36v24c0 11-9 17-18 20C11 43 2 37 2 26z" fill="${a}"/>${band}<path d="M2 2h36v24c0 11-9 17-18 20C11 43 2 37 2 26z" fill="none" stroke="#d8b25a" stroke-width="2.2"/><text x="20" y="27" text-anchor="middle" font-size="17" font-weight="700" fill="#f3e7c8" font-family="Georgia,serif">${ini}</text></svg>`;
}
const pips = (d, max = 2) => Array.from({ length: max }, (_, i) => `<i class="${i < d ? "on" : ""}"></i>`).join("");

// the whole camp as markup (pure: tools/ranked-camp-shot.mjs draws it with a fixture)
export function campView({ me, board = [], tab = "host", msg = "" }) {
  const C = me.cat, opsN = me.companies.filter((c) => c.op).length;
  const coWorth = (c) => RR.coValue([c]);
  const twin = (c) => (c.op ? null : me.companies.find((q) => q !== c && q.arm === c.arm && !q.op && (q.drill || 0) === (c.drill || 0)) || null);

  const open = new Set([...(me.unlocked || []), "levy", "spearmen", "archers"]);
  const coPts = (c) => Math.round((me.armPts?.[c.arm] || 0) * c.n * (1 + 0.35 * (c.drill || 0)) * (c.op ? (me.opsPts || 1) : 1) * (c.stakes ? 1 + (me.stakesPts || 0) : 1));
  const coCard = (c) => {
    const d = c.drill || 0, next = C.drill[d + 1];
    const dOpen = !next || open.has(`drill:${d + 1}`);
    const dPts = next ? Math.round((me.armPts?.[c.arm] || 0) * c.n * 0.35) : 0;   // what the next drill adds to the list
    const bow = ["archers", "crossbow"].includes(c.arm) && !["ambush", "hidden"].includes(c.pos); // (no stakes for men lying in a wood)
    const pos = Object.entries(C.positions).map(([k, v]) => `<option value="${k}" ${c.pos === k ? "selected" : ""}>${esc(v)}</option>`).join("") + (["ambush", "hidden"].includes(c.pos) ? `<option selected>${c.pos === "ambush" ? "In ambush" : "Hidden behind the line"}</option>` : "");
    return `<article class="rk-co${c.op ? " op" : ""}" data-co="${esc(c.id)}">
      <header><span class="rk-badge">${glyphOf(c.arm)}</span>
        <div class="rk-co-id"><input class="rk-name" data-k="name:${esc(c.id)}" value="${esc(c.name || "")}" placeholder="${esc(armName(c.arm))}" maxlength="24" aria-label="Company name">
          <small>${c.op ? `<b>${num(c.n)}</b>` : `<span class="rk-men-set"><button class="rk-step" data-men="-1" title="Fewer">−</button><input class="rk-men" data-k="men:${esc(c.id)}" type="number" inputmode="numeric" min="0" max="${me.armMax?.[c.arm] ?? 400}" value="${c.n}" aria-label="How many men in this company" title="Type how many men, then Enter"><button class="rk-step" data-men="1" title="More">+</button></span>`} ${c.name ? esc(armName(c.arm)) : "men"}${c.op ? " · picked men" : ""}</small></div>
        <span class="rk-worth" title="What they cost your list, drill and all">${num(coPts(c))}<i>pts</i></span></header>
      <div class="rk-co-line">
        <span class="rk-drill" title="${esc(C.drill[d].name)}"><span class="rk-pips">${pips(d)}</span>${esc(C.drill[d].name)}</span>
        ${next ? (dOpen
          ? `<button class="rk-mini" data-drill="${d + 1}" title="${num(dPts)} more points out of your budget">Muster as ${esc(next.name)} · +${num(dPts)} pts</button>`
          : `<span class="rk-mini locked" title="Unlock ${esc(next.name)} companies with spoils, below">${esc(next.name)} — locked</span>`)
        + (d > 0 ? `<button class="rk-ghost" data-drill="${d - 1}" title="Back to ${esc(C.drill[d - 1].name)}: cheaper in points">−</button>` : "")
        : `<span class="rk-mini done">Best drilled</span>`}
      </div>
      <div class="rk-co-line">
        <label class="rk-sel"><select class="rk-pos" ${c.op && ["ambush", "hidden"].includes(c.pos) ? "disabled" : ""} aria-label="Where it draws up">${pos}</select></label>
        ${bow ? (c.stakes ? `<button class="rk-mini done" data-stakes="off" title="Leave the stakes behind">Stakes ✓</button>` : `<button class="rk-mini" data-stakes="on" title="${Math.round((me.stakesPts || 0) * 100)}% more points for this company">Cut stakes · +${Math.round((me.stakesPts || 0) * 100)}%</button>`) : ""}
      </div>
      <footer>${!c.op && c.n >= 2 ? `<button class="rk-ghost" data-split title="Half its men into a new company">Split</button>` : ""}${twin(c) ? `<button class="rk-ghost" data-merge="${esc(twin(c).id)}" title="Join the other company of ${esc(armName(c.arm))}">Merge</button>` : ""}<button class="rk-ghost danger" data-disband title="Send them home (no spoils back)">Send home</button></footer>
    </article>`;
  };

  let body = "";
  if (tab === "host") {
    // men are MUSTERED into this tier's list and cost its points; what a lord may muster at all is bought with spoils
    const left = (me.budget ?? 0) - (me.pts ?? 0);
    // The muster is a CATALOGUE — what this lord may put on the field — and carries no numbers at all: he raises a
    // company here and then says how many men are in it on the company's own card, above. (The owner, 2026-10-19.)
    const muster = Object.entries(me.armPts || me.prices).map(([a, c]) => {
      const locked = !open.has(a), have = me.companies.some((q) => q.arm === a && !q.op);
      return `<article class="rk-buy tight${locked ? " locked" : have ? " have" : ""}"><span class="rk-badge">${glyphOf(a)}</span>
      <div class="rk-buy-id"><b>${esc(armName(a))}</b><small>${esc(TROOPS[a]?.note || "")}</small></div>
      <div class="rk-buy-act"><span class="rk-worth">${c}<i>pts</i>/man</span>
        ${locked ? `<span class="rk-mini locked" title="Unlock them with spoils, under Spoils">Locked</span>`
          : have ? `<span class="rk-mini done">In your list ✓</span>`
          : `<button class="rk-mini" data-raise="${a}" ${c > left ? "disabled" : ""} title="Raise a company of them; set how many men it holds on its card">Muster</button>`}</div></article>`; }).join("");
    body = `<div class="rk-grid">${me.companies.map(coCard).join("") || `<p class="rk-none">No companies — muster some below.</p>`}</div>
      <h3>Muster men <small>${num(left)} of ${num(me.budget)} points left</small></h3>
      <p class="rk-lead">What you may put on the field. Raise a company here; how many men are in it is set on its own card above. Men cost <b>points</b>, out of this tier's budget — never spoils. ${left > 0 ? `<button class="rk-mini" data-fill>Fill the list</button>` : "Your list is full."}</p>
      <div class="rk-grid buy">${muster}</div>`;
  } else if (tab === "ops") {
    body = `<p class="rk-lead">Picked men for one task — at most ${C.opsMax} in a host (you have ${opsN}). In a live battle you bring no more of them than your foe can.</p>
      <div class="rk-grid buy">` + Object.entries(C.ops).map(([k, O]) => { const have = me.companies.some((c) => c.op === k);
        return `<article class="rk-buy${have ? " have" : ""}"><span class="rk-badge">${glyphOf(O.arm)}</span>
          <div class="rk-buy-id"><b>${esc(O.name)}</b><small>${esc(O.desc)}</small></div>
          <div class="rk-buy-act"><span class="rk-worth">${O.cost}</span>${have ? `<span class="rk-mini done">In your host ✓</span>` : `<button class="rk-mini" data-op="${k}" ${me.spoils < O.cost || opsN >= C.opsMax ? "disabled" : ""}>Hire</button>`}</div></article>`; }).join("") + `</div>`;
  } else if (tab === "cmd") {
    body = `<p class="rk-lead">Your commander, <b>${esc(me.commander || "")}</b>, rides at the head of your largest company. He holds ${C.slots} skills at most — ${me.skills.length} now.</p>
      <div class="rk-grid buy">` + Object.entries(C.skills).map(([k, K]) => { const have = me.skills.includes(k);
        return `<article class="rk-buy${have ? " have" : ""}"><span class="rk-badge">${glyphSVG("mage")}</span>
          <div class="rk-buy-id"><b>${esc(K.name)}</b><small>${esc(K.desc)}</small></div>
          <div class="rk-buy-act"><span class="rk-worth">${K.cost}</span>${have ? `<button class="rk-ghost" data-forget="${k}">Forget</button>` : `<button class="rk-mini" data-skill="${k}" ${me.spoils < K.cost || me.skills.length >= C.slots ? "disabled" : ""}>Learn</button>`}</div></article>`; }).join("") + `</div>`;
  } else {
    const carried = Object.values(me.spells || {}).reduce((s, n) => s + (n || 0), 0);
    body = `<p class="rk-lead">Charges carried into battle — ${C.spellMax} of each at most, <b>${carried}</b> in all. Cast them from the bar on the field; a charge cast is spent. A live battle levels your charges to your foe's.</p>
      <div class="rk-grid buy">` + Object.entries(C.spells).map(([k, Sp]) => { const n = me.spells[k] || 0;
        return `<article class="rk-buy${n ? " have" : ""}"><span class="rk-badge">${glyphSVG("mage")}</span>
          <div class="rk-buy-id"><b>${esc(Sp.name)}</b>${n ? ` <span class="rk-carry">${n} carried</span>` : ""}<small>${esc(Sp.desc)}</small></div>
          <div class="rk-buy-act"><span class="rk-worth">${Sp.cost}</span><button class="rk-mini" data-spell="${k}" ${me.spoils < Sp.cost || n >= C.spellMax ? "disabled" : ""}>+1</button></div></article>`; }).join("") + `</div>`;
  }

  if (tab === "shop") {
    const KIND = { arm: "Troops", drill: "Drill", ops: "Picked men", skill: "Your commander", spell: "Powers" };
    const by = {}; for (const u of me.shop || []) (by[u.kind] ||= []).push(u);
    body = `<p class="rk-lead">Spoils buy <b>access</b>, never numbers: what you may muster, how well drilled, which picked men, which powers. Everything you unlock still costs your list its points, out of the same budget your foe has.</p>`
      + Object.entries(by).map(([k, list]) => `<h3>${esc(KIND[k] || k)}</h3><div class="rk-grid buy">` + list.map((u) => `
        <article class="rk-buy${u.has ? " have" : ""}"><span class="rk-badge">${u.kind === "arm" ? glyphOf(u.key) : glyphSVG("mage")}</span>
          <div class="rk-buy-id"><b>${esc(u.name)}</b><small>${esc(u.note || "")}</small></div>
          <div class="rk-buy-act"><span class="rk-worth">${num(u.cost)}</span>${u.has ? `<span class="rk-mini done">Yours ✓</span>`
            : `<button class="rk-mini" data-unlock="${esc(u.kind)}" data-key="${esc(u.key)}" ${me.spoils < u.cost ? "disabled" : ""}>Unlock</button>`}</div></article>`).join("") + `</div>`).join("");
  }

  const tabs = { host: "Your list", ops: "Picked men", cmd: "Your commander", spells: "Powers", shop: "Spoils" };
  const last = me.last.slice().reverse().map((x) => `<li class="${x.outcome}"><span class="rk-dot"></span><span class="rk-vs">${x.outcome === "win" ? "Beat" : x.outcome === "draw" ? "Drew with" : "Lost to"} <b>${esc(x.vs)}</b>${x.kind === "ghost" ? " <i>(his host, led his way)</i>" : x.kind === "live" ? " <i>(live)</i>" : ""}</span><span class="rk-d">${x.d >= 0 ? "+" : ""}${x.d}</span><span class="rk-sp">+${num(x.spoils)}</span></li>`).join("");
  const rows = (board || []).map((q, i) => `<li${q.name === me.name ? ' class="me"' : ""}><span class="rk-rank r${i + 1}">${i + 1}</span><span class="rk-bn">${esc(q.name)}</span><span class="rk-br">${q.rating}</span><span class="rk-bw">${q.w}–${q.l}${q.d ? `–${q.d}` : ""}</span><span class="rk-bt">${esc(q.temper)}</span></li>`).join("");

  return `<div class="rk">
    <header class="rk-top">
      <div class="rk-crest">${crest(me.lord || me.name)}</div>
      <div class="rk-id">
        <h2>${esc(me.lord || me.name)}</h2>
        <p class="rk-war">${esc(me.eraName || eraOf(ERA).name)} · ${esc(eraOf(me.era || ERA).when)}</p>
        <p class="rk-sub">${esc(me.name)}${me.battles ? ` · the heralds say you lead like <b>${esc(me.temperName)}</b>` : " · no battles fought yet"}</p>
        <p class="rk-rec"><span class="w">${me.w} won</span><span class="l">${me.l} lost</span>${me.d ? `<span class="d">${me.d} drawn</span>` : ""}</p>
      </div>
      <div class="rk-stats">
        <div class="rk-stat"><b>${me.rating}</b><small>rating</small></div>
        <div class="rk-stat gold"><b>${num(me.spoils)}</b><small>spoils</small></div>
      </div>
    </header>

    <section class="rk-tiers">${Object.entries(me.tiers || {}).map(([k, T]) => {
      const L = me.lists?.[k] || {}, full = L.budget ? Math.min(1, (L.pts || 0) / L.budget) : 0;
      return `<button class="rk-tier${k === me.tier ? " on" : ""}" data-tier="${k}">
        <b>${esc(T.name)}</b><span class="rk-tpts">${num(L.pts || 0)} / ${num(T.pts)}</span>
        <span class="rk-tbar"><i style="width:${(full * 100).toFixed(0)}%"></i></span>
        <small>${num(L.men || 0)} men${L.faults?.length ? " · " + esc(L.faults[0]) : ""}</small></button>`; }).join("")}</section>

    <section class="rk-muster">
      <div class="rk-m-n"><b>${num(me.pts ?? 0)}</b><small>of ${num(me.budget ?? 0)} pts</small></div>
      <div class="rk-m-t"><b>Your ${esc(me.tiers?.[me.tier]?.name || "list")}</b> — ${num(me.men)} men in ${me.companies.length} ${me.companies.length === 1 ? "company" : "companies"}
        <p>${esc(me.tiers?.[me.tier]?.note || "")} Both lords build to the <b>same points</b>, so no season's spoils can bring a bigger host than your foe's. What spoils buy is <b>what you may field at all</b> — other troops, better drill, picked men, powers.</p></div>
    </section>

    <div class="rk-go"><button class="rk-fight" data-fight><span>Find a battle</span></button><span class="rk-msg" data-msg>${msg}</span></div>

    <nav class="rk-tabs">${Object.entries(tabs).map(([k, v]) => `<button data-tab="${k}" class="${tab === k ? "on" : ""}">${v}</button>`).join("")}</nav>
    <div class="rk-body">${body}</div>

    <div class="rk-cols">
      <section class="rk-panel"><h3>Your last battles</h3>${last ? `<ul class="rk-last">${last}</ul>` : `<p class="rk-none">None yet.</p>`}</section>
      <section class="rk-panel"><h3>The table</h3>${rows ? `<ul class="rk-board">${rows}</ul>` : `<p class="rk-none">Nobody has fought yet.</p>`}</section>
    </div>

    <p class="rk-names"><label>Your lord <input data-name="lord" data-k="lord" value="${esc(me.lord || "")}" maxlength="${me.nameMax || 24}"></label><label>Your commander <input data-name="commander" data-k="commander" value="${esc(me.commander || "")}" maxlength="${me.nameMax || 24}"></label><a class="rk-back" href="./play.html">← the menu</a></p>
  </div>`;
}

async function camp(el, onFight) {
  el.hidden = false; el.innerHTML = `<div class="rk"><h2>Ranked Battle</h2><p class="rk-lead">Mustering…</p></div>`;
  const [r, b] = await Promise.all([api("/ranked/me"), api("/ranked/board")]);
  if (!r.ok) { el.innerHTML = `<div class="rk"><h2>Ranked Battle</h2><p class="rk-lead">${esc(r.error)}</p><button data-home>Back</button></div>`; el.querySelector("[data-home]").onclick = () => { location.href = "./play.html"; }; return; }
  const draw = (me, msg = "") => {
    const C = me.cat;
    // The camp is written out whole again after every change, and that DESTROYS the element that scrolls (.rk), so the
    // browser started the new one at the top: the lord was thrown back up to his own crest every time he clicked
    // anything (the owner, 2026-10-19: "whenever you click something it scrolls you to the top of the screen").
    // Keep where he was looking, and the box he was typing in — data-k names each one across the redraw.
    const was = el.querySelector(".rk"), keepY = was ? was.scrollTop : 0;
    const act = document.activeElement, keepK = act && was && was.contains(act) ? act.dataset?.k || null : null;
    let keepSel = null; if (keepK) try { keepSel = [act.selectionStart, act.selectionEnd]; } catch { /* a number box has no selection */ }
    el.innerHTML = campView({ me, board: b.board || [], tab: TAB, msg });
    const now = el.querySelector(".rk"); if (now && keepY) now.scrollTop = keepY;
    const call = async (path, body2, ok) => { const q = await api(path, body2); draw(q.me || me, q.ok ? ok : esc(q.error || "No")); };
    el.querySelectorAll("[data-name]").forEach((inp) => inp.onchange = (e) => call("/ranked/names", { [inp.dataset.name]: e.target.value }, inp.dataset.name === "lord" ? "Your lord is known by that name now" : "Your commander is known by that name now"));
    el.querySelectorAll("[data-tab]").forEach((bt) => bt.onclick = () => { TAB = bt.dataset.tab; draw(me); });
    el.querySelectorAll("[data-buy]").forEach((bt) => bt.onclick = () => { const n = +bt.dataset.n; bt.disabled = true;
      call("/ranked/buy", { arm: bt.dataset.buy, n }, n > 0 ? `${n} ${esc(armName(bt.dataset.buy))} join your list` : `${-n} ${esc(armName(bt.dataset.buy))} go home`); });
    // the catalogue raises a company; its strength is then the card's business
    el.querySelectorAll("[data-raise]").forEach((bt) => bt.onclick = () => { bt.disabled = true;
      call("/ranked/raise", { arm: bt.dataset.raise }, `A company of ${esc(armName(bt.dataset.raise))} joins your list — set how many men above`); });
    // the three tiers: each keeps its own list (js/sim/ranked-rules.js TIERS)
    el.querySelectorAll("[data-tier]").forEach((bt) => bt.onclick = () => { if (bt.dataset.tier === me.tier) return; bt.disabled = true; call("/ranked/tier", { tier: bt.dataset.tier }, `Your ${esc(me.tiers?.[bt.dataset.tier]?.name || "")} list`); });
    el.querySelector("[data-fill]")?.addEventListener("click", (e) => { e.currentTarget.disabled = true; call("/ranked/fill", {}, "Mustered up to the budget"); });
    // spoils buy ACCESS and nothing else
    el.querySelectorAll("[data-unlock]").forEach((bt) => bt.onclick = () => { bt.disabled = true; call("/ranked/unlock", { kind: bt.dataset.unlock, key: bt.dataset.key }, "Unlocked"); });
    el.querySelectorAll("[data-op]").forEach((bt) => bt.onclick = () => { bt.disabled = true; call("/ranked/op", { key: bt.dataset.op }, `${esc(C.ops[bt.dataset.op].name)} join your host`); });
    el.querySelectorAll("[data-skill]").forEach((bt) => bt.onclick = () => { bt.disabled = true; call("/ranked/skill", { id: bt.dataset.skill }, `Your commander learns ${esc(C.skills[bt.dataset.skill].name)}`); });
    el.querySelectorAll("[data-forget]").forEach((bt) => bt.onclick = () => call("/ranked/skill", { id: bt.dataset.forget, forget: true }, "Forgotten"));
    el.querySelectorAll("[data-spell]").forEach((bt) => bt.onclick = () => { bt.disabled = true; call("/ranked/spell", { id: bt.dataset.spell, n: 1 }, `A charge of ${esc(C.spells[bt.dataset.spell].name)}`); });
    el.querySelectorAll("[data-co]").forEach((card) => {
      const id = card.dataset.co;
      card.querySelector(".rk-name").onchange = (e) => call("/ranked/company", { id, name: e.target.value }, "Named");
      const mn = card.querySelector(".rk-men");
      if (mn) { mn.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); mn.blur(); } };
        mn.onchange = (e) => { const n = Math.floor(+e.target.value); if (!(n >= 0)) { e.target.value = ""; return; }
          call("/ranked/company", { id, n }, n ? `${n} men in the company` : "Sent home"); }; }
      // …or stepped, for anyone who would rather click than type
      card.querySelectorAll("[data-men]").forEach((bt) => bt.onclick = () => {
        const c = me.companies.find((q) => q.id === id); if (!c) return;
        const step = TROOPS[c.arm]?.step || 5, n = Math.max(0, c.n + (+bt.dataset.men) * step);
        bt.disabled = true; call("/ranked/company", { id, n }, n ? `${n} men in the company` : "Sent home"); });
      const ps = card.querySelector(".rk-pos"); if (ps) ps.onchange = (e) => call("/ranked/company", { id, pos: e.target.value }, "They will draw up there");
      card.querySelectorAll("[data-drill]").forEach((bt) => bt.addEventListener("click", (e) => call("/ranked/company", { id, drill: +e.currentTarget.dataset.drill }, "Drilled")));
      card.querySelector("[data-stakes]")?.addEventListener("click", (e) => call("/ranked/company", { id, stakes: e.currentTarget.dataset.stakes === "on" }, e.currentTarget.dataset.stakes === "on" ? "Stakes cut" : "Stakes left behind"));
      card.querySelector("[data-split]")?.addEventListener("click", () => { const c = me.companies.find((q) => q.id === id); const k = Math.floor((c?.n || 0) / 2); if (k >= 1) call("/ranked/company", { id, split: k }, `${k} men split off into a new company`); });
      card.querySelector("[data-merge]")?.addEventListener("click", (e) => call("/ranked/company", { id, merge: e.currentTarget.dataset.merge }, "The companies join"));
      card.querySelector("[data-disband]").onclick = () => { if (confirm("Send this company home? (no spoils back)")) call("/ranked/company", { id, disband: true }, "Sent home"); };
    });
    // back to the box he had his hands on (it is a new element: the markup was written out again)
    if (keepK) { const back = el.querySelector(`[data-k="${keepK.replace(/["\\]/g, "\\$&")}"]`);
      if (back && !back.disabled) { back.focus(); if (keepSel) try { back.setSelectionRange(keepSel[0], keepSel[1]); } catch { /* not a text box */ } } }
    el.querySelector("[data-fight]").onclick = async () => {
      const f = el.querySelector("[data-fight]"); f.disabled = true; f.innerHTML = "<span>The heralds ride out…</span>";
      el.querySelector("[data-msg]").textContent = "Looking for a live lord first — a moment…";
      const q = await api("/ranked/match", { live: true }); if (!q.ok) { draw(me, esc(q.error)); return; }
      const m = q.match, foe = m.foe;
      if (m.live) {
        const mu = m.muster, home = mu?.home?.reduce((s, h) => s + h.n, 0) || 0;
        el.querySelector("[data-msg]").innerHTML = `A live lord! <b>${esc(foe.name)}</b> (rating ${foe.rating}) meets you. Mustered at <b>${num(mu?.budget || 0)} d</b> — you take ${num(mu?.men || 0)} men${home ? `, ${num(home)} stay in camp` : ""}. To horse…`;
        setTimeout(() => { location.href = `./?live=${encodeURIComponent(m.id)}&map=${encodeURIComponent(m.map)}${warQ()}`; }, 2200); return;
      }
      el.querySelector("[data-msg]").innerHTML = `Your foe: <b>${esc(foe.lord || foe.name)}</b> (rating ${foe.rating}${foe.kind === "ghost" ? `, ${esc(foe.name)}'s host led his way` : ""}), a ${esc(foe.temperName)}. To the field…`;
      setTimeout(() => onFight(m), 1400);
    };
  };
  draw(r.me);
}

// ---------------------------------------------------------------- the field, from the match's seed
function configOf(map, places, m) {
  const R = mulberry(m.seed), size = map.size || 4000;
  // How much room the field needs. A medieval field is 260 m across and sits anywhere; a field of 1944 is a
  // kilometre across and has to be kept off the edge of the map, or half the host deploys outside it.
  const reach0 = hostReach(m.army || [], m.foe?.army || []);
  const inset = Math.max(600, Math.round(smallField(0, 0, reach0).arena.r) + 120);
  let best = null;
  for (let k = 0; k < 50; k++) { // a small field anywhere on the map that the hosts can stand on (randomBattle's survey, seeded)
    const site = { x: inset + R() * Math.max(200, size - 2 * inset), y: inset + R() * Math.max(200, size - 2 * inset) }, axis = R() * Math.PI * 2;
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
  // a recorded host is matched within 20% of your worth: the heavier of the two marched the longer column and comes up
  // footsore, and the lighter, first on the ground, has cut its stakes (js/sim/ranked-rules.js handicap)
  const odds = m.foe.odds || RR.handicap(RR.coValue(mine.companies), RR.coValue(foeL.companies));
  const era = m.era || ERA, stakers = RR.stakeArmsOf(era);
  const withStakes = (cos) => cos.map((c) => (stakers.includes(c.arm) ? { ...c, stakes: true } : c));
  const myCos = odds.stakes && odds.heavy === 1 ? withStakes(mine.companies) : mine.companies;
  const foeCos = odds.stakes && odds.heavy === 0 ? withStakes(foeL.companies) : foeL.companies;
  const cfg = customConfig({ era, site, axis, host: RR.hostCompanies(myCos, mine.skills, mine.commander || null, era), foe: RR.hostCompanies(foeCos, foeL.skills, m.foe.commander || null, era), temper: m.foe.temper, hidden: true, weather: rollWeather(R()), tod: ["dawn", "noon", "noon", "dusk"][Math.floor(R() * 4)],
    windDir: ["back", "face", "across"][Math.floor(R() * 3)], names: [places.townName(0), lords[1]], places });
  cfg.sides.forEach((d, k) => { d.name = `the host of ${lords[k]}`; d.adj = undefined; d.lord = d.lordName = lords[k]; });
  cfg.ranked = { id: m.id, foe: m.foe, mine, foeL, odds }; cfg.name = `Ranked: against ${m.foe.name}`;
  Object.assign(cfg, smallField(RR.armyMen(m.army), RR.armyMen(m.foe.army), hostReach(m.army, m.foe.army))); cfg.sides[1].hidden = false; // (a small field, the foe in plain view: no hunting him across the vale)
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
  box.querySelector("[data-camp]").onclick = () => { location.href = `./?mode=ranked${warQ()}`; };
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
  card.querySelector("[data-camp]").onclick = () => { location.href = `./?mode=ranked${warQ()}`; };
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
    const cast = RR.aiCaster({ ...(R.foeL.spells || {}) }, foeT, R.foe.wits ?? 0, o.cfg?.era || ERA); // the foe's lord casts too (js/sim/ranked-rules.js)
    w.systems.push((w) => { if (battle.phase !== "deploy") cast(w); });
    // the longer march: the heavier host comes to the line already blown (once, as the trumpets sound)
    const od = R.odds; if (od?.heavy >= 0 && od.footsore > 0) { const team = od.heavy === 0 ? PLAYER : foeT; let done = false;
      w.systems.push((w) => { if (done || battle.phase === "deploy") return; done = true; const S = w.S; for (let i = 0; i < S.n; i++) if (S.alive[i] && S.team[i] === team) S.fatigue[i] = Math.min(1, (S.fatigue[i] || 0) + od.footsore);
        if (team === PLAYER) toast("Your host outnumbers his: the longer column comes up footsore"); else toast("His host is the heavier, and comes up footsore"); }); }
  }
  // your spell bar
  const charges = o.live ? { ...(o.live.charges || {}) } : { ...(o.cfg?.ranked?.mine?.spells || {}) }, used = {};
  if (o.cfg?.ranked) o.cfg.ranked.used = used;
  const POW = RR.spellsFor(o.cfg?.era || ERA);
  const kinds = Object.keys(POW).filter((k) => charges[k] > 0); if (!kinds.length) return { used };
  const bar = document.createElement("div"); bar.className = "rk-spells"; document.body.appendChild(bar);
  let armed = null;
  const draw = () => { bar.innerHTML = `<b>Spells</b>` + kinds.map((k) => `<button data-sp="${k}" class="${armed === k ? "on" : ""}" ${charges[k] > 0 ? "" : "disabled"} title="${esc(POW[k].desc)}">${esc(POW[k].name)} ×${charges[k] || 0}</button>`).join("") + (armed ? `<span>click the field…</span>` : ""); bar.querySelectorAll("[data-sp]").forEach((b) => b.onclick = () => { armed = armed === b.dataset.sp ? null : b.dataset.sp; draw(); }); };
  draw();
  const onDown = (e) => {
    if (!armed || e.button !== 0) return;
    const g = groundAt(e.clientX, e.clientY); if (!g) return;
    e.stopPropagation(); e.preventDefault();
    const k = armed; armed = null;
    if (o.live) { o.live.send({ t: "rspell", kind: k, x: g.x, y: g.y }); charges[k]--; used[k] = (used[k] || 0) + 1; toast(`${POW[k].name}!`); }
    else if (o.battle?.phase === "deploy") { toast("Spells wait for the trumpets"); }
    else if (RR.castRanked(o.w, o.PLAYER, k, g.x, g.y)) { charges[k]--; used[k] = (used[k] || 0) + 1; toast(`${POW[k].name}!`); }
    draw();
  };
  canvas.addEventListener("pointerdown", onDown, true);
  return { used };
}
