// The market's panel: buy and sell at the town's own market (js/sim/economy.js trade/price). Prices move with what the
// house has bought or sold lately (the market's depth for each good: dump a mountain of stone and its price falls).
// Its SELL section (js/sim/income.js): what the house has over its needs and what it would fetch, the reeve's switch and the
// "keep at least" for each good, and what the market, the mill and the reeve's sales brought in yesterday.
// Its GOLD section (js/sim/gold.js): the money-changer, the fine goods sold only for gold, and the companies hired for gold.
import * as EC from "../sim/economy.js";
import * as GD from "../sim/gold.js";
import * as IN from "../sim/income.js"; // (the Sell section: the reeve's surplus sales and the day's dues — js/sim/income.js)
import { PRICES, GOLD, GOLD_GOODS, MERCS, MERC_GRACE, mercHire, mercDay } from "../sim/econ-data.js";
import { ARMS } from "../sim/arms.js";

const MASS = new Set(["grain", "hay", "timber", "firewood", "charcoal", "stone", "ore", "iron", "wool", "hemp"]); // (weighed in kg; the rest are counted)
const GROUPS = [
  ["Food and stuff", ["grain", "hay", "timber", "firewood", "charcoal", "stone", "ore", "iron", "wool", "cloth", "hemp", "rope"]],
  ["Arms", ["staves", "bows", "arrows", "arrowheads", "crossbows", "bolts", "spears", "pikes", "lances", "swords", "helms", "gambeson", "mail", "plates", "ladders"]],
  ["Beasts and carts", ["horses", "destriers", "packhorses", "oxen", "carts"]],
];
const lots = (g) => (MASS.has(g) ? [100, 1000] : (PRICES[g]?.[0] || 0) >= 100 ? [1] : [1, 10]);
const coin = (d) => (d >= 10 ? `${Math.round(d).toLocaleString("en-GB")} d` : `${d.toFixed(d >= 1 ? 1 : 2)} d`); // (pennies, as the top bar counts them)
const amt = (g, n) => (MASS.has(g) ? (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} t` : `${Math.floor(n)} kg`) : `${Math.floor(n)}`);
const name = (g) => g.charAt(0).toUpperCase() + g.slice(1);
const sg = (s) => `${s >= 100 ? Math.round(s).toLocaleString("en-GB") : s.toFixed(s >= 10 ? 0 : 1)} s`; // (shillings of gold)
const goldOf = (T) => Math.floor((T.store.gold || 0) + 1e-9);

export function marketHTML(w, team) {
  const T = w.teams[team]; if (!T?.store) return "";
  const cash = (T.store.silver || 0) + (T.store.gold || 0) * 12;
  let h = `<div class="row small">Buy and sell here. In the chest: <b>${coin(T.store.silver || 0)}</b> of silver and <b>${goldOf(T)} s of gold</b>. You pay a quarter over the going rate and get a fifth under it; a big sale drives the price down for a few days. </div>` + duesHTML(w, team, "market") + sellHTML(w, team, true) + goldHTML(w, team) + `<div class="sub">For silver</div>`; // (gold first: what it buys — the owner: "There is nothing to spend gold on.")
  for (const [title, all] of GROUPS) {
    const goods = all.filter((g) => !GOLD_GOODS.has(g)); // (destriers, mail and plates are dealt in gold: the Gold section)
    h += `<div class="row small"><b>${title}</b></div><table class="mkt"><tr><th></th><th>Have</th><th>Sell</th><th>Buy</th><th></th></tr>`;
    for (const g of goods) {
      if (!PRICES[g]) continue;
      const have = T.store[g] || 0, sp = EC.price(w, team, g, false), bp = EC.price(w, team, g, true), per = MASS.has(g) ? 100 : 1, room = MASS.has(g) ? Infinity : PRICES[g][1] * 3 - Math.abs(T.market?.recent?.[g] || 0);
      const btns = lots(g).map((n) => `<button data-trade="${g}" data-q="${-n}" ${have < n || room < n ? "disabled" : ""} title="sell ${amt(g, n)} for about ${coin(sp * n)}">−${amt(g, n)}</button>`).join("")
        + lots(g).map((n) => `<button data-trade="${g}" data-q="${n}" ${cash < bp * n || room < n ? "disabled" : ""} title="buy ${amt(g, n)} for about ${coin(bp * n)}">+${amt(g, n)}</button>`).join("");
      h += `<tr><td>${name(g)}</td><td>${amt(g, have)}</td><td>${coin(sp * per)}</td><td>${coin(bp * per)}</td><td class="btns">${btns}</td></tr>`;
    }
    h += `</table>`;
  }
  return h + `<div class="row small">Prices for ${[...MASS].slice(0, 3).join(", ")} and the like are per 100 kg; the rest per piece.</div>`;
}

// ---- GOLD (js/sim/gold.js): the money-changer, fine goods for gold, hired companies
export function goldHTML(w, team) {
  const T = w.teams[team]; if (!T?.store) return "";
  const g = goldOf(T), silver = T.store.silver || 0, sell = GD.goldRate(w, team, false), buy = GD.goldRate(w, team, true), room = Math.floor(GD.goldRoom(w, team));
  let h = `<div class="sub" id="mkt-gold">Gold</div><div class="row small">In the chest: <b>${g} s of gold</b>. The money-changer buys your gold at <b>${sell.toFixed(1)} d</b> the shilling and sells his at <b>${buy.toFixed(1)} d</b>${room < GOLD.depth * 3 ? ` (he will deal in ${room} s more just now)` : ""}.</div>`;
  const xs = [10, 100], xb = (s) => `<button data-xchg="${s}" ${s < 0 ? (g < -s || room < -s ? "disabled" : "") : (silver < s * buy || room < s ? "disabled" : "")} title="${s < 0 ? `change ${-s} s of gold for about ${coin(-s * sell)}` : `buy ${s} s of gold for about ${coin(s * buy)}`}">${s < 0 ? "−" : "+"}${Math.abs(s)} s</button>`;
  h += `<table class="mkt"><tr><td>Change gold for silver</td><td class="btns">${xs.map((s) => xb(-s)).join("")}</td></tr><tr><td>Buy gold with silver</td><td class="btns">${xs.map((s) => xb(s)).join("")}</td></tr></table>`;
  // fine goods, priced in gold
  h += `<div class="row small"><b>Fine goods, for gold only</b> (the horse-copers and armourers of Lombardy and Flanders deal in florins)</div><table class="mkt"><tr><th></th><th>Have</th><th>Sell</th><th>Buy</th><th></th></tr>`;
  for (const k of GOLD_GOODS) {
    if (!PRICES[k]) continue;
    const have = Math.floor(T.store[k] || 0), sp = EC.price(w, team, k, false) / GOLD.mid, bp = EC.price(w, team, k, true) / GOLD.mid, rm = PRICES[k][1] * 3 - Math.abs(T.market?.recent?.[k] || 0);
    h += `<tr><td>${name(k)}</td><td>${have}</td><td>${sg(sp)}</td><td>${sg(bp)}</td><td class="btns"><button data-trade="${k}" data-q="-1" ${have < 1 || rm < 1 ? "disabled" : ""} title="sell one for about ${sg(sp)} of gold">−1</button><button data-trade="${k}" data-q="1" ${g < bp || rm < 1 ? "disabled" : ""} title="buy one for about ${sg(bp)} of gold">+1</button></td></tr>`;
  }
  h += `</table>`;
  // hired companies
  const L = T.mercs || { list: [], away: {} };
  h += `<div class="row small"><b>Companies for hire</b> — real soldiers with their own arms, paid in gold every day; unpaid ${MERC_GRACE} days, they march off.</div><table class="mkt"><tr><th>Company</th><th>Prest</th><th>Wages</th><th></th></tr>`;
  for (const [k, M] of Object.entries(MERCS)) {
    const c = L.list?.find((x) => x.kind === k), back = L.away?.[k], gone = back !== undefined && (w.econ?.doy ?? 0) < back;
    const btn = c ? `<button data-merc="${k}" data-do="dismiss" title="pay them off: they march away (no gold back)">Pay off</button>`
      : `<button data-merc="${k}" data-do="hire" ${g < mercHire(k) || gone ? "disabled" : ""} title="${gone ? `with another lord: back in ${Math.ceil(back - w.econ.doy)} days` : `hire them for ${mercHire(k)} s of gold; they fall in at the market`}">Hire</button>`;
    const state = c ? `<br><small class="${c.unpaid ? "warn" : "ok"}">serving: ${c.n} men${c.unpaid ? ` · UNPAID ${c.unpaid} day${c.unpaid === 1 ? "" : "s"}` : ""}</small>` : gone ? `<br><small>with another lord: back in ${Math.ceil(back - w.econ.doy)} days</small>` : "";
    h += `<tr><td><b>${M.name}</b> <small>${M.men} ${(ARMS[M.arm]?.name || M.arm).toLowerCase()}</small>${state}<br><small>${M.blurb}</small></td><td>${mercHire(k)} s</td><td>${mercDay(k, c ? c.n : M.men).toFixed(1)} s/day</td><td class="btns">${btn}</td></tr>`;
  }
  const bill = (L.list || []).reduce((s, c) => s + mercDay(c.kind, c.n), 0);
  return h + `</table>${bill ? `<div class="row small ${g < bill * 5 ? "warn" : ""}">Your companies draw <b>${bill.toFixed(1)} s of gold a day</b>: ${g >= bill ? `${Math.floor(g / bill)} days in the chest` : "the chest cannot pay tomorrow"}.</div>` : ""}`;
}

// run: (op, args, done) — the command runner (the realm's server, or the local game)
export function bindMarket(el, w, team, run, say, again) {
  const answer = (r) => { say?.(r?.ok ? r.msg : r?.error || "The market will not deal"); again?.(); };
  el.querySelectorAll("[data-xchg]").forEach((bt) => bt.onclick = () => { const s = +bt.dataset.xchg; if (run) run("exchange", { s }, answer); else answer(GD.exchange(w, team, s)); });
  el.querySelectorAll("[data-merc]").forEach((bt) => bt.onclick = () => { const a = { do: bt.dataset.do, kind: bt.dataset.merc }; if (run) run("mercs", a, answer); else answer(a.do === "dismiss" ? GD.dismiss(w, team, a.kind) : GD.hire(w, team, a.kind)); });
  bindSell(el, w, team, run, say, again);
  el.querySelectorAll("[data-trade]").forEach((bt) => bt.onclick = () => {
    const good = bt.dataset.trade, qty = +bt.dataset.q;
    const done = (r) => { say?.(r?.ok ? r.msg : r?.error || "The market will not deal"); again?.(); };
    if (run) run("trade", { good, qty }, done);
    else done(tradeHere(w, team, good, qty));
  });
}

// the trade itself, with a plain answer (commands.js ops.trade; the local game without a runner)
export function tradeHere(w, team, good, qty) {
  const T = w.teams[team];
  if (!PRICES[good] || !Number.isFinite(qty) || !qty) return { ok: false, error: "Nothing like that is sold here" };
  if (!EC.hasBuilding(w, team, "market")) return { ok: false, error: "You need a finished market to trade" };
  if (T.besieged) return { ok: false, error: "The market is shut while the town is besieged" };
  if (!MASS.has(good)) { // (a sword or a horse changes hands whole, never a share of one)
    qty = Math.sign(qty) * Math.floor(Math.abs(qty));
    const room = PRICES[good][1] * 3 - Math.abs(T.market?.recent?.[good] || 0);
    if (!qty) return { ok: false, error: "Nothing like that is sold here" };
    if (room < Math.abs(qty)) return { ok: false, error: `The market has ${qty > 0 ? "no more" : "no buyers for"} ${good} just now: come back in a few days` };
  }
  const fine = GOLD_GOODS.has(good), g0 = T.store.gold || 0; // (fine goods are dealt in gold)
  const s0 = (T.store.silver || 0) + (T.store.gold || 0) * 12;
  const got = EC.trade(w, team, good, qty);
  const d = Math.abs((T.store.silver || 0) + (T.store.gold || 0) * 12 - s0), dg = Math.abs((T.store.gold || 0) - g0);
  if (!got) return { ok: false, error: qty > 0 ? `Not enough ${fine ? "gold" : "silver"} for that (or the market has no more ${good} for now)` : `You have no ${good} to sell (or the market will take no more for now)` };
  const paid = fine ? `${sg(dg)} of gold` : coin(d);
  return { ok: true, n: got, msg: got > 0 ? `Bought ${amt(good, got)} ${good} for ${paid}` : `Sold ${amt(good, -got)} ${good} for ${paid}` };
}

// ---- INCOME (js/sim/income.js): what the market, the mill and the reeve's sales brought in on the last full day
export function duesHTML(w, team, kind) {
  const T = w.teams[team], I = T?.inc; if (!I) return "";
  if (kind === "mill") return `<div class="row small income">The mill earned <b>${coin(I.mill || 0)}</b> today: its multure, a sixteenth of the corn it grinds for the vill, sold by the miller.</div>`;
  if (kind === "market") return `<div class="row small income">The market earned <b>${coin((I.tolls || 0) + (I.stallage || 0))}</b> today${I.fair ? ` — <b>fair days</b>, merchants from far off` : ""}: tolls ${coin(I.tolls || 0)}, stallage ${coin(I.stallage || 0)} (${I.roads} road${I.roads === 1 ? "" : "s"} into the town).${I.sales > 0 ? ` Your reeve's sales: ${coin(I.sales)}.` : ""}</div>`;
  const parts = [`rents ${coin(I.rents || 0)}`]; if (I.market) parts.push(`market dues ${coin((I.tolls || 0) + (I.stallage || 0))}`); if (I.mill > 0) parts.push(`the mill ${coin(I.mill)}`); if (I.sales > 0) parts.push(`the reeve's sales ${coin(I.sales)}`);
  return `<div class="row small income">Income today: ${parts.join(", ")}.</div>`;
}
// the Sell section: here = at the house's market (sell buttons); else the keep's panel of a house with no market (the reeve carts it)
export function sellHTML(w, team, here) {
  const T = w.teams[team]; if (!T?.store) return "";
  const on = IN.salesOn(T), V = T.sellView || IN.sellView(w, team), carried = V[0]?.carried;
  const cap = IN.cartCap(T), rows = V.filter((r) => r.have > 0 || r.player);
  let h = `<div class="sub" id="mkt-sell">Sell</div><div class="row small"><label><input type="checkbox" data-sales-on ${on ? "checked" : ""}> <b>Reeve sells surplus</b></label> — ${on ? "each day he sells a little of what is over the house's needs, never below 70 % of the going rate, and never what your next works, rations, seed or workshops need." : "<b>off</b>: he sells nothing."}${carried ? ` You have no market: he carts it to the market town, about 1 d the 100 kg off the price, as much as your carts and packhorses carry (${(cap / 1000).toFixed(1)} t a day). Stone is not worth the carting.` : ""}</div>`;
  if (!rows.length) return h + `<div class="row small">Nothing in store to sell.</div>`;
  h += `<table class="mkt sell"><tr><th></th><th>Have</th><th>Keep at least</th><th>Surplus</th><th>Price</th><th>Worth</th>${here ? "<th></th>" : ""}</tr>`;
  for (const r of rows) {
    const mass = IN.MASS.has(r.g), unit = mass ? "t" : "", all = !Number.isFinite(r.keep), kv = all ? "" : mass ? +(r.keep / 1000).toFixed(r.keep >= 10000 ? 0 : 1) : r.keep; // (all: stone kept whole until the player names a reserve — js/sim/income.js)
    const keep = `<input class="keep" data-keep="${r.g}" type="number" min="0" step="${mass ? 1 : 1}" value="${kv}"${all ? ` placeholder="all"` : ""} title="${r.player ? "your reserve" : `the reeve's reserve: ${r.why}`}" style="width:4.5em">${unit}${r.player ? ` <button data-keep-clear="${r.g}" title="back to the reeve's own reserve (${r.why})">×</button>` : ""}`;
    const pr = r.price === null ? `<small>not worth carting</small>` : `${coin(r.price)}${mass ? "/100 kg" : ""}`;
    const today = Math.min(r.surplus, r.today), sell = here && r.surplus > 0 && today > (mass ? 10 : 0.5) ? `<button data-trade="${r.g}" data-q="${-(mass ? Math.floor(today) : Math.floor(today))}" title="sell ${amt(r.g, today)} now: as much as goes before the price falls to 70 % of the going rate">Sell ${amt(r.g, today)}</button>` : "";
    h += `<tr${r.surplus > 0 ? ` class="surplus"` : ""}><td>${name(r.g)}</td><td>${amt(r.g, r.have)}</td><td>${keep}</td><td>${r.surplus > 0 ? `<b>${amt(r.g, r.surplus)}</b>` : "—"}</td><td>${pr}</td><td>${r.surplus > 0 && r.worth > 0 ? `≈ ${coin(r.worth)}` : ""}</td>${here ? `<td class="btns">${sell}</td>` : ""}</tr>`;
  }
  const total = rows.reduce((s, r) => s + (r.worth || 0), 0);
  return h + `</table><div class="row small">Your surplus is worth about <b>${coin(total)}</b> at today's prices — sold all at once it would fetch much less: every lot sold drives that good's price down for a few days.</div>`;
}
// the switch and the reserves (run: the realm's command runner, or none: the local game)
export function bindSell(el, w, team, run, say, again) {
  const send = (args) => { const done = (r) => { say?.(r?.ok ? r.msg : r?.error || "The reeve did not hear"); again?.(); }; if (run) run("sales", args, done); else done(IN.setSales(w, team, args)); };
  el.querySelector("[data-sales-on]")?.addEventListener("change", (e) => send({ on: !!e.target.checked }));
  el.querySelectorAll("[data-keep]").forEach((inp) => inp.addEventListener("change", () => {
    const g = inp.dataset.keep, v = Number(inp.value); if (!Number.isFinite(v) || v < 0) return;
    send({ keep: { [g]: IN.MASS.has(g) ? Math.round(v * 1000) : Math.round(v) } });
  }));
  el.querySelectorAll("[data-keep-clear]").forEach((bt) => bt.onclick = () => send({ keep: { [bt.dataset.keepClear]: null } }));
}
