// WHY a workshop is (or isn't) making anything: the owner, "There needs to be something that tells you WHY building stuff
// has stopped." Its stuff comes straight out of the house's store (economy.js craftWork takes the batch's needs from
// T.store when a batch is done): no one carries it to the door. So the reasons are: not built, burning, nothing chosen, no
// crew, the crew not at their posts yet, or the store short of something — with where that something comes from.
import * as EC from "../sim/economy.js";
import { PRICES } from "../sim/econ-data.js";

const KG = new Set(["timber", "stone", "iron", "ore", "charcoal", "grain", "wool", "hemp", "firewood", "hay", "flour"]);
const amt = (r, n) => (KG.has(r) ? (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} t` : `${Math.round(n)} kg`) : `${Math.floor(n * 10) / 10}`);
const name = (k) => EC.BUILDINGS[k]?.name || k;
const GATHERED = { timber: "felled by the woodcutters (Gather wood)", stone: "cut at a quarry", ore: "dug at a bog-iron bed (Mine ore)",
  wool: "shorn from the flock in June", grain: "from the fields", firewood: "gathered from the coppice", silver: "mined at a silver vein", gold: "mined at a gold vein" };

// where a good comes from: the workshops that make it, gathering, the market
export function sourceOf(w, team, res) {
  const makers = Object.entries(EC.RECIPES).filter(([, R]) => R && typeof R[res] === "object").map(([k]) => k);
  const have = makers.filter((k) => w.buildings.some((b) => b.team === team && b.kind === k && !b.ruin));
  const out = [];
  if (makers.length) out.push(have.length ? `made at your ${name(have[0])} (set it to make ${res.replace(/_/g, " ")})` : `made at a ${name(makers[0])} (you have none)`);
  if (GATHERED[res]) out.push(GATHERED[res]);
  if (PRICES[res]) out.push(EC.hasBuilding(w, team, "market") ? "or buy it at your market" : "or buy it at a market (build one)");
  return out.join("; ") || "not to be had here";
}

// → { ok, line, needs: [{ res, need, have, short }] }
export function whyOf(w, b, team, crewN) {
  const R = EC.RECIPES[b.kind], T = w.teams[team], st = T?.store || {};
  if (!R) return null;
  if (b.progress < 1) return { ok: false, line: "Not finished: the builders are still at it." };
  if (b.ruin) return { ok: false, line: "In ruins." };
  if (b.fire > 0) return { ok: false, line: "Burning: nobody works in a fire." };
  if (!b.make || !R[b.make]) return { ok: false, line: b.makeBy === "player" ? "Your order is done: nothing more is made until you pick a product (or Auto) below." : "Nothing chosen to make: pick a product (or Auto) below." };
  // an order of so many (economy.js setProduct n): how far along, said on every line
  const ord = b.makeBy === "player" && b.makeOrd ? ` Your order: <b>${b.makeOrd - (b.makeLeft ?? b.makeOrd)} of ${b.makeOrd}</b> ${b.make.replace(/_/g, " ")} made, ${b.makeLeft ?? b.makeOrd} more to go, then it stops.` : "";
  const r = R[b.make], needs = { ...r.needs }; if (r.fuel) needs.charcoal = (needs.charcoal || 0) + r.fuel;
  const rows = Object.entries(needs).map(([res, need]) => ({ res, need, have: st[res] || 0, short: (st[res] || 0) < need }));
  const short = rows.filter((x) => x.short);
  if (!crewN) return { ok: false, line: "Nobody works here: give it a crew with + below (or select villagers and click it: Work here). The reeve may have sent the hands to the fields or to food." + ord, needs: rows };
  if (short.length) return { ok: false, line: `Stopped: the store is short of ${short.map((x) => `<b>${x.res.replace(/_/g, " ")}</b> (needs ${amt(x.res, x.need)} a batch, you have ${amt(x.res, x.have)})`).join(" and ")}. ${short.map((x) => `${x.res.replace(/_/g, " ")}: ${sourceOf(w, team, x.res)}`).join(". ")}.${ord ? ord.replace(/, then it stops\.$/, ": it carries on the moment the store has it.") : ""}`, needs: rows };
  return { ok: true, line: `Working: ${crewN} at it, this batch ${Math.round(Math.min(1, (b.work || 0) / (r.days || 1)) * 100)}% done.` + ord, needs: rows };
}

export function whyHTML(w, b, team, crewN) {
  const y = whyOf(w, b, team, crewN); if (!y) return "";
  const rows = (y.needs || []).map((x) => `<span class="${x.short ? "warn" : "okc"}">${x.res.replace(/_/g, " ")} ${amt(x.res, x.need)} (have ${amt(x.res, x.have)}) ${x.short ? "✗" : "✓"}</span>`).join(" · ");
  return `<div class="sub">Status</div><div class="row small ${y.ok ? "" : "warn"} why">${y.line}</div>${rows ? `<div class="row small needs">Each batch takes, straight from your store: ${rows}</div>` : ""}`;
}
