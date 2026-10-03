// The market's panel: buy and sell at the town's own market (js/sim/economy.js trade/price). Prices move with what the
// house has bought or sold lately (the market's depth for each good: dump a mountain of stone and its price falls).
import * as EC from "../sim/economy.js";
import { PRICES } from "../sim/econ-data.js";

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

export function marketHTML(w, team) {
  const T = w.teams[team]; if (!T?.store) return "";
  const cash = (T.store.silver || 0) + (T.store.gold || 0) * 12;
  let h = `<div class="row small">Buy and sell here. In the chest: <b>${coin(T.store.silver || 0)}</b>${T.store.gold ? ` and ${Math.floor(T.store.gold)} gold (12 d each)` : ""}. You pay a quarter over the going rate and get a fifth under it; a big sale drives the price down for a few days.</div>`;
  for (const [title, goods] of GROUPS) {
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

// run: (op, args, done) — the command runner (the realm's server, or the local game)
export function bindMarket(el, w, team, run, say, again) {
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
  const s0 = (T.store.silver || 0) + (T.store.gold || 0) * 12;
  const got = EC.trade(w, team, good, qty);
  const d = Math.abs((T.store.silver || 0) + (T.store.gold || 0) * 12 - s0);
  if (!got) return { ok: false, error: qty > 0 ? `Not enough silver for that (or the market has no more ${good} for now)` : `You have no ${good} to sell (or the market will take no more for now)` };
  return { ok: true, n: got, msg: got > 0 ? `Bought ${amt(good, got)} ${good} for ${coin(d)}` : `Sold ${amt(good, -got)} ${good} for ${coin(d)}` };
}
