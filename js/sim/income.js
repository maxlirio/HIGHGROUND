// A MANOR'S INCOME besides its rents (the owner: "it seems to me that the ONLY way I ever get silver is mining" — he was
// right: no house, player's or reeve's, had ever sold a thing). docs/economy-research.md §8c has the history and sources.
// A demesne sold its surplus — corn, wool, timber, stone — and its lord took the dues of his market (tolls, stallage), the
// multure of his mill, and the fees of his fair. Here:
//
//   the reeve sells surplus   once a day (ai-general.js reeveThink → reeveSells): what the house holds beyond its reserves
//                             (surplus: a year's bread and the seed, the builders' stone and timber for the next works (a
//                             staked site's were taken from the store when it was staked), the bloomery's ore and charcoal for months, the weavers' wool …, and never under the
//                             player's own "keep at least"), in lots, while the going rate is ≥ INCOME.floor of the market's
//                             base (the price pressure stops him: he never dumps). At the house's market; with none, carted to
//                             the market town (INCOME.carriage a kg off the price, as much as the carts carry, and only goods
//                             worth the carting). The player switches it off or sets the reserves: T.sales = { on, keep }.
//   market dues               economy.js daily → dues: a finished market takes stallage (a stall for every INCOME.perStall
//                             souls) and tolls (a head of the vill × the roads into the town, and a fortieth of what it dealt
//                             with outside merchants that day) — × the guildhall's tolbooth (TC "rents"), less the unrest; and
//                             for three days a year its fair takes INCOME.fair.mul as much.
//   mill multure              economy.js consume: the mill's toll (E.multure, a sixteenth) of the corn it grinds for the vill
//                             was taken and lost; the mill is the lord's, so the toll corn is sold and the pennies come home.
//
// State (plain data, saved with the world): T.sales = { on, keep: { good: kg } } (absent = on, the reeve's reserves);
// T.inc = the last full day's income { day, rents, tolls, stallage, mill, sales, fair, roads, carried }; T.incAcc = today's,
// so far; T.saleWk = the reeve's sales since his last word in the chronicle; T.sellView = the Sell panel's rows (the realm
// ships it: the client's mirror cannot reckon the reserves). Deterministic, DOM-free.
import * as EC from "./economy.js";
import * as TC from "./tech.js";
import * as FL from "./jobs/fields.js";
import { E, PRICES, SPREAD, INCOME } from "./econ-data.js";

// what the reeve may sell, best first by worth a kg (with few carts, the dear goods go first)
export const SELLABLE = ["cloth", "wool", "iron", "grain", "charcoal", "ore", "timber", "firewood", "stone"];
export const MASS = new Set(["grain", "timber", "firewood", "charcoal", "stone", "ore", "iron", "wool"]); // (kg; cloth by the piece)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtKg = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} t` : `${Math.round(n)} kg`);
const fmtD = (d) => `${Math.round(d).toLocaleString("en-GB")} d`;
export const amount = (g, n) => (MASS.has(g) ? fmtKg(n) : `${Math.floor(n)} ${g === "cloth" ? "ells of cloth" : g}`);

export const salesOn = (T) => T?.sales?.on !== false;
const count = (w, team, kind) => { let n = 0; for (const b of w.buildings) if (b.team === team && b.kind === kind && !b.ruin) n++; return n; };

// ───────────────────────────────────────────── reserves: what the house keeps of each good
// → { good: { keep, why, player } } — the reeve's reserve, raised to the player's "keep at least" when that is more
export function reserves(w, team, ctx = {}) {
  const T = w.teams[team], s = T.store, need = EC.dailyFoodNeed(w, team), h = EC.headcount(w, team);
  const pop = (T.dependants || 0) + h.labour + h.soldiers + (T.squires || 0);
  // (a staked site's materials left the store when it was staked — economy.js placeBuilding: they are never for sale. What is
  // kept here is for the NEXT works: the builders' reserve covers a granary, a tithe barn or a mill twice over, and an AI
  // lord's great work names its own stone and timber in ctx)
  const bloom = count(w, team, "bloomery"), kilns = count(w, team, "charcoal_kiln"), smiths = count(w, team, "blacksmith"), weavers = count(w, team, "weaver");
  const seedShort = Math.max(0, FL.seedNeed(w, team) - (s.seed || 0));
  const K = {
    grain: { keep: Math.max(0, need * 365 * 1.1 - (s.sheaves || 0) - (s.fresh || 0)) + seedShort, why: "a year's bread and a tenth over, and the seed for the next sowing" },
    timber: { keep: 100000 + kilns * 720 * 90 + (ctx.wantTimber || 0), why: "100 t for the next works, and the colliers' wood for 3 months" },
    // (stone is a lord's savings for walls and a castle — the owner: "I've been saving up stone": the reeve never sells it
    // unless the player names a "keep at least" for it, and then only what lies above that)
    stone: { keep: Infinity, why: "your stone is kept for your works: set a \"keep at least\" to let him sell what lies above it" },
    ore: { keep: 2000 + bloom * 20 * 120, why: bloom ? "the bloomery's ore for 4 months" : "2 t, should you build a bloomery" },
    charcoal: { keep: 1500 + bloom * 30 * 120 + smiths * 10 * 120, why: "the forges' charcoal for 4 months" },
    iron: { keep: 1000, why: "a tonne for the smiths" },
    wool: { keep: 100 + weavers * 2.4 * 90, why: "the weavers' wool for 3 months" },
    cloth: { keep: 60, why: "cloth for 12 gambesons" },
    firewood: { keep: pop * E.fuelPerPerson * 400, why: "a year's fuel for every hearth" },
  };
  const P = T.sales?.keep || {};
  for (const g of SELLABLE) { const p = P[g]; if (Number.isFinite(p) && p > K[g].keep) { K[g].keep = p; K[g].player = true; } }
  if (Number.isFinite(P.stone)) { K.stone.keep = Math.max(P.stone, ctx.wantStone || 0); K.stone.player = true; K.stone.why = "what you chose to keep"; } // (stone: the player's word, either way)
  return K;
}

// the going rate's floor, and how much more can be sold today before the price falls to it (pressure: economy.js price)
const floorPrice = (g) => PRICES[g][0] * SPREAD.sell * INCOME.floor;
export function roomAtFloor(T, g) {
  const depth = PRICES[g][1], recent = T.market?.recent?.[g] || 0, pmin = Math.log(INCOME.floor) / 0.35;
  return Math.max(0, Math.min(recent - pmin * depth, depth * 3 - Math.abs(recent)));
}

// a house with no market of its own carts its surplus to the market town: what its carts and packhorses carry in a day
export const cartCap = (T) => (T.store.carts || 0) * INCOME.cartKg + (T.store.packhorses || 0) * INCOME.horseKg;
// the net price a unit, here or carted (null: not worth the carting)
export function netPrice(w, team, g, carried) {
  const p = EC.price(w, team, g, false); if (!carried) return p;
  const n = p - (MASS.has(g) ? INCOME.carriage : 0.05); // (a piece of cloth: a few pence of carriage)
  return n >= p * INCOME.carryMin ? n : null;
}

// the Sell panel's rows: [{ g, have, keep, why, player, surplus, per (100 kg, or 1 piece), price (d for `per` now), worth (the surplus at that), today
// (what can go today before the price falls to the floor), carried }]
export function sellView(w, team, ctx) {
  const T = w.teams[team]; if (!T?.store) return [];
  const K = reserves(w, team, ctx), home = EC.hasBuilding(w, team, "market"), out = [];
  for (const g of SELLABLE) {
    const have = T.store[g] || 0, k = K[g], surplus = Math.max(0, have - k.keep), p = netPrice(w, team, g, !home);
    out.push({ g, have: Math.round(have), keep: Math.round(k.keep), why: k.why, player: !!k.player, surplus: Math.round(surplus), per: MASS.has(g) ? 100 : 1, price: p === null ? null : Math.round(p * (MASS.has(g) ? 100 : 1) * 100) / 100, worth: p === null ? 0 : Math.round(surplus * p), today: Math.round(Math.min(surplus, roomAtFloor(T, g))), carried: !home });
  }
  return out;
}
export const refreshView = (w, team, ctx) => { const T = w.teams[team]; if (T?.store) T.sellView = sellView(w, team, ctx); return T?.sellView || []; };

// ───────────────────────────────────────────── the reeve sells
// once an economic day: → { d, goods: { g: qty }, carried } (null: nothing to do today)
export function reeveSells(w, team, ctx = {}) {
  const T = w.teams[team]; if (!T?.store || T.fallen || !T.town) return null;
  const day = w.econ.dayIndex; if (T.saleDay === day) return null; T.saleDay = day;
  refreshView(w, team, ctx);
  if (!salesOn(T) || T.besieged) return null;
  const home = EC.hasBuilding(w, team, "market"); let cart = home ? Infinity : cartCap(T);
  if (!home && cart <= 0) return null;
  const K = reserves(w, team, ctx), hungry = ctx.red || (T.ration ?? 1) < 0.97;
  const got = { d: 0, goods: {}, carried: !home };
  for (const g of SELLABLE) {
    if (g === "grain" && hungry) continue; // (never bread out of a hungry vill)
    let left = Math.min(Math.max(0, (T.store[g] || 0) - K[g].keep), roomAtFloor(T, g), cart);
    if (!MASS.has(g)) left = Math.floor(left);
    if (left < (MASS.has(g) ? 20 : 1)) continue;
    const lot = Math.max(MASS.has(g) ? 20 : 1, Math.round(PRICES[g][1] * INCOME.chunk));
    while (left >= (MASS.has(g) ? 1 : 1)) {
      const p = netPrice(w, team, g, !home); if (p === null || EC.price(w, team, g, false) < floorPrice(g) - 1e-12) break;
      const q = Math.min(lot, left), s0 = T.store.silver || 0;
      const sold = -EC.trade(w, team, g, -q, home ? undefined : { carry: MASS.has(g) ? INCOME.carriage : 0.05 }); if (sold <= 1e-9) break;
      got.d += (T.store.silver || 0) - s0; got.goods[g] = (got.goods[g] || 0) + sold; left -= sold; if (!home) cart -= MASS.has(g) ? sold : 0;
    }
  }
  if (got.d <= 0) return null;
  const A = accOf(w, T); A.sales += got.d; if (!home) A.carried = true;
  T.stats.reeveSold = (T.stats.reeveSold || 0) + got.d;
  // the chronicle: the week's sales in a line (a big day at once)
  const W = (T.saleWk ||= { from: day, d: 0, goods: {}, carried: false });
  W.d += got.d; W.carried ||= !home; for (const [g, q] of Object.entries(got.goods)) W.goods[g] = (W.goods[g] || 0) + q;
  if (W.d >= 500 || (day - W.from >= 7 && W.d >= 50)) { saleNote(w, team, W, day - W.from >= 7 ? "this week" : "lately"); T.saleWk = null; }
  else if (day - W.from >= 7) T.saleWk = null;
  refreshView(w, team, ctx);
  return got;
}
function saleNote(w, team, W, when) {
  const items = Object.entries(W.goods).sort((a, b) => b[1] * (PRICES[b[0]]?.[0] || 0) - a[1] * (PRICES[a[0]]?.[0] || 0)).map(([g, q]) => `${amount(g, q)}${MASS.has(g) ? ` of ${g}` : ""}`);
  const list = items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items[0];
  const T = w.teams[team], at = w.buildings.find((b) => b.team === team && b.kind === "market" && EC.complete(b)) || w.buildings.find((b) => b.id === T.hall);
  w.log?.push({ t: w.tick, kind: "reeve-say", team, tone: "good", x: at?.x, y: at?.y,
    text: `Your reeve sold ${list} ${W.carried ? "(carted to the market town)" : "at the market"} ${when}, for ${fmtD(W.d)}` });
}

// ───────────────────────────────────────────── the day's accounts
// (open until dues() closes it at the turn of the day — daily() runs after the calendar has turned, so it is not keyed by the day)
export function accOf(w, T) {
  if (!T.incAcc) T.incAcc = { day: w.econ.dayIndex, mill: 0, sales: 0, turnover: 0, carried: false };
  return T.incAcc;
}
// economy.js consume: the mill's toll corn (kg) — sold by the miller, the pennies to the lord's chest
export function multure(w, T, kg) {
  if (!(kg > 0)) return;
  const d = kg * PRICES.grain[0] * SPREAD.sell; EC.give(T, "silver", d);
  accOf(w, T).mill += d; T.stats.multure = (T.stats.multure || 0) + d;
}
// economy.js trade: what the house dealt at its own market with outside merchants (their tolls)
export function turnover(w, T, d) { if (d > 0) accOf(w, T).turnover += d; }

// the roads into the town: road crossings on a ring round the market (the map's worn tracks: landread.js). Cached — the
// tracks do not move.
const ROADS = new WeakMap();
export function roadsAt(w, b) {
  if (ROADS.has(b)) return ROADS.get(b);
  const L = w.map?.land; let n = 2;
  if (L?.road && L.idx) {
    const N = 120, r = INCOME.roads.ring, on = []; for (let k = 0; k < N; k++) { const a = (k / N) * Math.PI * 2; on.push(L.road[L.idx(b.x + Math.cos(a) * r, b.y + Math.sin(a) * r)] === 1); }
    n = 0; for (let k = 0; k < N; k++) if (on[k] && !on[(k + N - 1) % N]) n++;
    if (n === 0 && on[0]) n = 1; // (the whole ring a road: a market square — one way in at least)
  }
  ROADS.set(b, n); return n;
}
export const roadMul = (w, team, roads) => clamp(INCOME.roads.base + INCOME.roads.per * roads, INCOME.roads.base, INCOME.roads.max) * (TC.has(w, team, "roads") ? 1.15 : 1);
const fairDay = (doy) => { const d = ((Math.floor(doy) % 365) + 365) % 365; return d >= INCOME.fair.doy && d < INCOME.fair.doy + INCOME.fair.days ? d - INCOME.fair.doy : -1; };

// economy.js daily: the market's dues for the day past, and the day's accounts closed into T.inc. → d paid in
export function dues(w, T, pop, rents) {
  const A = accOf(w, T), m = w.buildings.find((b) => b.team === T.id && b.kind === "market" && EC.complete(b));
  let tolls = 0, stallage = 0, roads = 0, fair = -1;
  if (m && !T.besieged && !T.fallen) {
    roads = roadsAt(w, m); fair = fairDay(w.econ.doy);
    const mul = TC.mul(w, T.id, "rents") * (1 - 0.5 * clamp(T.unrest || 0, 0, 1)) * (fair >= 0 ? INCOME.fair.mul : 1); // (the guildhall's tolbooth; a sullen town buys less)
    stallage = Math.max(2, Math.floor(pop / INCOME.perStall)) * INCOME.stallage * mul;
    tolls = (pop * INCOME.tollHead * roadMul(w, T.id, roads) + A.turnover * INCOME.tollRate) * mul;
    EC.give(T, "silver", tolls + stallage);
    T.stats.dues = (T.stats.dues || 0) + tolls + stallage;
    if (fair >= 0) { T.fairD = (fair === 0 ? 0 : T.fairD || 0) + tolls + stallage; if (fair === INCOME.fair.days - 1) w.log?.push({ t: w.tick, kind: "reeve-say", team: T.id, tone: "good", x: m.x, y: m.y, text: `${INCOME.fair.name} at your market is over: three days of merchants from far off paid ${fmtD(T.fairD)} in tolls and stallage` }); }
  }
  T.inc = { day: A.day, rents: rents || 0, tolls, stallage, mill: A.mill, sales: A.sales, fair: fair >= 0, roads, carried: A.carried, market: !!m };
  T.incAcc = null;
  return tolls + stallage;
}

// the player's settings (commands.js ops.sales; the realm's sanitiser has already shaped them): on (bool), keep { good: kg | null }
export function setSales(w, team, { on, keep } = {}) {
  const T = w.teams[team]; if (!T?.store) return { ok: false, error: "No house" };
  const S = (T.sales ||= { on: true, keep: {} }); S.keep ||= {};
  if (typeof on === "boolean") S.on = on;
  if (keep && typeof keep === "object") for (const [g, v] of Object.entries(keep)) {
    if (!SELLABLE.includes(g)) continue;
    if (v === null) delete S.keep[g]; else if (Number.isFinite(v) && v >= 0) S.keep[g] = Math.min(1e9, Math.round(v));
  }
  refreshView(w, team);
  const bits = [];
  if (typeof on === "boolean") bits.push(on ? "Your reeve will sell what is over the house's needs" : "Your reeve will sell nothing: what you sell, you sell yourself");
  for (const g of Object.keys(keep || {})) if (SELLABLE.includes(g)) bits.push(S.keep[g] != null ? `he keeps at least ${amount(g, S.keep[g])}${MASS.has(g) ? ` of ${g}` : ""}` : `${g}: back to the reeve's own reserve`);
  return { ok: true, sales: { on: S.on !== false, keep: { ...S.keep } }, msg: bits.join("; ") || "No change" };
}
