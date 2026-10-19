// GOLD — what a house's gold buys (the owner: "There is nothing to spend gold on."; docs/economy-research.md §8b).
// Gold is counted in shillings (T.store.gold). Besides the old fall-backs (the wages and the silver market take gold at
// 12 d when the silver runs out), the mint (gold struck into pennies), a legend's promotion and a ransom, gold now buys:
//
//   the money-changer   at the market: gold for silver and silver for gold at the market's rate (econ-data.js GOLD: 12 d
//                       the shilling when he buys your gold, 14 d when he sells you his; the rate moves with what the house
//                       has changed lately, like any good). exchange(w, team, s).
//   hired companies     at the market: Genoese crossbowmen, Brabançon pikes, a routier company (econ-data.js MERCS). Real
//                       men with their own arms and harness (none from the store), added as a company at the market; the
//                       prest (20 days' wages) is paid in gold when they sign, and their wages IN GOLD every day after.
//                       Unpaid MERC_GRACE days running, they march off (the men are gone; the census counts them out).
//                       hire(w, team, kind), dismiss(w, team, kind); mercDaily(w, T) from economy.js daily.
//   fine goods          destriers, mail and coats of plates are dealt only in gold (econ-data.js GOLD_GOODS; economy.js trade).
//   great works         the minster's shrine and relic and the palace's gilding (BUILDINGS gold), the Studium's bull from the
//                       Curia (tech.js studium) — paid when staked out or begun, so a site already under way is never stopped.
//
// State (plain data, saved with the world): T.mercs = { list: [{ kind, born, ids, n, unpaid, since }], away: { kind: doy } }.
// A hired man is known by his id AND the tick he was hired (S.born): a slot freed and reused is never taken for one.
// Deterministic, DOM-free.
import { GOLD, MERCS, MERC_GRACE, MERC_AWAY, mercHire, mercDay } from "./econ-data.js";
import { addUnit } from "./world.js";
import * as EC from "./economy.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const marketOf = (w, team) => w.buildings.find((b) => b.team === team && b.kind === "market" && b.progress >= 1 && !b.ruin) || null;
const fmt = (v) => Math.round(v).toLocaleString("en-GB");

// ───────────────────────────────────────────── the money-changer
// pennies for one shilling of gold: buying = what you PAY for his gold; else what he pays you for yours. What the house
// has bought lately dears his gold, what it has sold cheapens yours — never the other way: his rate never falls below
// GOLD.buy nor yours rises above GOLD.sell, so there is no changing back and forth at a profit.
export function goldRate(w, team, buying) {
  const p = (w.teams[team]?.market?.recent?.gold || 0) / GOLD.depth;
  return buying ? GOLD.buy * Math.exp(clamp(p * 0.35, 0, 3)) : GOLD.sell * Math.exp(clamp(p * 0.35, -1.5, 0));
}
// how much more gold the changers will deal in just now (s)
export const goldRoom = (w, team) => Math.max(0, GOLD.depth * 3 - Math.abs(w.teams[team]?.market?.recent?.gold || 0));
// s > 0: buy s shillings of gold with silver; s < 0: sell -s shillings of gold for silver. Whole shillings.
export function exchange(w, team, s) {
  const T = w.teams[team];
  if (!T?.store || !Number.isFinite(s) || !s) return { ok: false, error: "Nothing to change" };
  if (!marketOf(w, team)) return { ok: false, error: "You need a finished market: the money-changers keep their tables there" };
  if (T.besieged || T.fallen) return { ok: false, error: "The market is shut while the town is besieged" };
  s = Math.sign(s) * Math.min(Math.floor(Math.abs(s)), Math.floor(goldRoom(w, team)));
  if (!s) return { ok: false, error: "The changers will deal in no more gold just now: come back in a few days" };
  let d;
  if (s > 0) {
    const rate = goldRate(w, team, true);
    s = Math.min(s, Math.floor((T.store.silver || 0) / rate + 1e-9)); if (s < 1) return { ok: false, error: `Not enough silver: a shilling of gold costs ${rate.toFixed(1)} d` };
    d = s * rate; EC.take(T, "silver", d); EC.give(T, "gold", s);
  } else {
    const rate = goldRate(w, team, false);
    s = -Math.min(-s, Math.floor((T.store.gold || 0) + 1e-9)); if (s > -1) return { ok: false, error: "You have no gold to change" };
    d = -s * rate; EC.take(T, "gold", -s); EC.give(T, "silver", d);
  }
  T.market.recent.gold = (T.market.recent.gold || 0) + s;
  return { ok: true, s, d, msg: s > 0 ? `Bought ${s} s of gold for ${fmt(d)} d of silver` : `Changed ${-s} s of gold for ${fmt(d)} d of silver` };
}

// ───────────────────────────────────────────── hired companies
const mercsOf = (T) => (T.mercs ||= { list: [], away: {} });
const live = (w, T, c) => (c.ids || []).filter((id) => w.S.alive[id] && w.S.team[id] === T.id && w.S.born[id] === c.born);
// the ids of the house's hired men now (a Set), or null when it has none
export function mercIds(w, T) {
  if (!T?.mercs?.list?.length) return null;
  const out = new Set(); for (const c of T.mercs.list) for (const id of live(w, T, c)) out.add(id);
  return out;
}
// may `kind` be hired now? → null, or why not
export function hireWhy(w, team, kind) {
  const T = w.teams[team], M = MERCS[kind];
  if (!M) return "No such company";
  if (!T?.store) return "No town";
  if (!marketOf(w, team)) return "Companies are hired at a finished market";
  if (T.besieged || T.fallen) return "No company will come through the siege lines";
  const L = T.mercs;
  if (L?.list.some((c) => c.kind === kind)) return `${M.name} already serve you`;
  const back = L?.away?.[kind]; if (back !== undefined && w.econ.doy < back) return `${M.name} are with another lord: back in ${Math.ceil(back - w.econ.doy)} days`;
  if ((T.store.gold || 0) < mercHire(kind)) return `Not enough gold: their prest is ${mercHire(kind)} s of gold (you have ${Math.floor(T.store.gold || 0)})`;
  return null;
}
export function hire(w, team, kind) {
  const why = hireWhy(w, team, kind); if (why) return { ok: false, error: why };
  const T = w.teams[team], M = MERCS[kind], mk = marketOf(w, team), fee = mercHire(kind);
  EC.take(T, "gold", fee);
  const at = mk.rally || { x: mk.x + 25, y: mk.y - 25 };
  const u = addUnit(w, { team, arm: M.arm, count: M.men, x: at.x, y: at.y, formation: "line", training: M.training });
  u.merc = kind; u.supply = { food: 0, arrows: 0, carts: 0, packhorses: 0 }; u.musterDay = w.econ.doy;
  mercsOf(T).list.push({ kind, born: w.tick, ids: u.members.slice(), n: u.members.length, unpaid: 0, since: w.econ.doy, unit: u.id });
  T.census.hired = (T.census.hired || 0) + u.members.length;
  w.events.push({ t: w.tick, kind: "recruited", unit: u.id, building: mk.id, team, arm: M.arm, count: u.members.length, merc: kind });
  return { ok: true, unit: u.id, n: u.members.length, gold: fee, msg: `${M.name} take your gold (${fee} s) and fall in at the market: ${u.members.length} men, ${mercDay(kind).toFixed(1)} s of gold a day while they serve` };
}
// the company goes: every hired man of it still on the map leaves (no casualty: the census counts them out)
function release(w, T, c, why) {
  let n = 0;
  for (const id of live(w, T, c)) if (EC.retire(w, id)) n++;
  T.census.paidOff = (T.census.paidOff || 0) + n;
  const L = mercsOf(T); L.list = L.list.filter((x) => x !== c); L.away[c.kind] = w.econ.doy + MERC_AWAY;
  w.events.push({ t: w.tick, kind: "reeve-say", team: T.id, tone: why === "unpaid" ? "bad" : undefined,
    text: why === "unpaid" ? `${MERCS[c.kind].name} have had no gold for ${c.unpaid} days: ${n} men march off to a lord who pays` : `${MERCS[c.kind].name} are paid off: ${n} men march away` });
  return n;
}
export function dismiss(w, team, kind) {
  const T = w.teams[team], c = T?.mercs?.list.find((x) => x.kind === kind);
  if (!c) return { ok: false, error: "No such company serves you" };
  const n = release(w, T, c, "dismissed");
  return { ok: true, n, msg: `${MERCS[kind].name} are paid off and march away (${n} men)` };
}
// once an econ day per house (economy.js daily): each company's wages in gold, or it goes
export function mercDaily(w, T) {
  const L = T.mercs; if (!L?.list?.length) return;
  T.day.mercs = 0;
  for (const c of L.list.slice()) {
    const men = live(w, T, c); c.n = men.length;
    if (!men.length) { L.list = L.list.filter((x) => x !== c); L.away[c.kind] = w.econ.doy + MERC_AWAY; continue; } // (all fallen: the company is no more)
    const due = mercDay(c.kind, men.length), paid = EC.take(T, "gold", due);
    T.day.mercs += paid;
    if (paid >= due - 1e-6) { c.unpaid = 0; continue; }
    c.unpaid++;
    if (c.unpaid >= MERC_GRACE) release(w, T, c, "unpaid");
    else w.events.push({ t: w.tick, kind: "reeve-say", team: T.id, tone: "bad", text: `${MERCS[c.kind].name} want their gold (${due.toFixed(1)} s a day): unpaid ${c.unpaid} day${c.unpaid === 1 ? "" : "s"} — at ${MERC_GRACE} they march off. Change silver for gold at the market` });
  }
}
// the gold the house's companies draw a day (s)
export function mercBill(w, T) { let s = 0; for (const c of T?.mercs?.list || []) s += mercDay(c.kind, c.n); return s; }
// a plain summary (the market panel; the realm sends it: server/views.mjs)
export function mercSummary(w, team) {
  const T = w.teams[team], L = T?.mercs;
  return { list: (L?.list || []).map((c) => ({ kind: c.kind, n: c.n, unpaid: c.unpaid, since: c.since, day: mercDay(c.kind, c.n) })), away: { ...(L?.away || {}) } };
}
