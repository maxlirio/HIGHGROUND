// FOUNDING A NEW TOWN. The owner (2026-10-02): "is there a way to found new towns? or are you stuck at your first one?
// that seems like something that DEFINITELY needs to be done."
//
// The loop:
//   1. THE ORDER — the lord picks a site (the keep's panel: "Found a settlement", then a click on the land). siteCheck()
//      reads the site: its plan is laid from the land there (js/sim/settle.js) and shown as an outline before anything is
//      paid; the site must be dry, workable ground, far enough from the house's own towns and from other houses' holds,
//      not inside another house's lands, not within a protected house's lands, and the house under its cap of towns.
//   2. THE COST, real and taken at once from the seat: SETTLERS (20–40 villagers, the best mix of men, women and a
//      carpenter or two the vill can spare — never the last hands), their FAMILIES (dependants: about 0.7 a settler), and
//      what they carry: GRAIN to feed them to their first harvest from a field laid on arrival, SEED corn, TIMBER for the
//      manor hall and the first cottages, a little STONE for the granary's footings, FIREWOOD, a cart and an ox team, a
//      small flock; and SILVER (the lord's charter and the settlers' first wages).
//   3. THE MARCH — the settlers go as a column across the land (they are people on the map: raiders can catch them; the
//      column cut down is the foundation lost).
//   4. THE CAMP — on arrival their tents stand by the chosen ground; they set to building the MANOR HALL (a timber hall
//      in its court: cheaper than a keep, it stores and musters a daughter settlement's levy).
//   5. THE PLAN LAID — when the hall stands the plan is laid out from the land (re-read then: what has been built nearby
//      since the order is respected): lanes, tofts, crofts, green, church site, yards, the circuit, the mill site.
//   6. A TOWN OF ITS OWN — its own stores, granary, labour pool and plan; its own REEVE runs it (labour, fields, the food
//      watch) and its STEWARD builds cottages and a granary as it grows; the player can build there too (the town switcher,
//      the keep panel per town). The house's PURSE and LEARNING are shared (js/sim/towns.js says why).
// Supply between towns (carting grain or timber from the seat to a daughter, haulage on the roads between them) is NOT
// built yet: a daughter lives on what its settlers brought and what it grows. (Noted for later: convoys.js can carry it.)
//
// THE REALM (server/realm.mjs op "settle"; docs/realm-world.md): the same order, with fairness rules — at most RULES.cap
// towns a house (the seat counts), a minimum distance from any other house's hold or town, never within a protected
// house's lands (newcomer protection), never nearer another house's town than one's own (their lands). New towns are fair
// game in war: the Keep's Peace guards only a house's FIRST keep (economy.js damageBuilding: T.hall is the seat's); while
// the lord is away the warden brings a daughter's villagers in to its hall when an enemy comes near (wardenTowns below).
// An AI lord who prospers founds a second town (lordFounds: food, hands, timber and silver to spare, no threat).
import * as EC from "./economy.js";
import * as TW from "./towns.js";
import { planSettlement, siteContext, validatePlan, SIZES } from "./settle.js";
import { buildPlan, bestSlot, placeOnPlan } from "./townplan.js";
import { issueOrder, splitUnit } from "./world.js";
import { makeGeneral, reeveThink, LORD_HOOKS } from "./ai-general.js";
import { isFoe, shielded } from "./sides.js";
import { E, START, ROLE, ROLES } from "./econ-data.js";
import { firstHarvest } from "./jobs/fields.js";
import { strengthNear } from "./logistics.js";
import { stageStatus } from "./stages.js";

export const RULES = {
  cap: 3,                // towns a house may hold, the seat included
  settlers: [20, 40],    // the column (villagers)
  defaultSettlers: 24,
  depsPer: 0.7,          // dependants who go with each settler (their children and old folk, counted, not drawn)
  keepHome: 30,          // labourers who must stay at the seat (the vill that sends them is not to be emptied)
  minOwn: 600,           // m from the house's own towns (a day's work of fields between them)
  minOther: 950,         // m from any other house's hold or town (the realm's holds lie ~900–1000 m apart)
  protectR: 1400,        // m: a protected house's lands (newcomer protection) — no founding within them
  timber: 21000,         // kg carried: the manor hall (12 t), the first cottages and the granary's frame
  stone: 3000,           // kg: the granary's footings
  firewood: 1500, seedHa: 12, silver: 400,
  hallLabour: 450,       // man-days: a timber manor hall in its court (a stone keep is 250 000)
  hallHp: 2500,
  minPlots: 10,          // a site whose plan holds fewer house plots is no place for a town
  reserveDays: 90,       // the seat keeps food for those who stay for this long after the column's grain is taken
};
const NAMES_A = ["Ash", "Oak", "Thorn", "Brook", "Holly", "Wick", "Cold", "Stan", "Lang", "Hay", "Elm", "Wil", "Brad", "Ald", "Mar", "Kirk", "Fen", "Rye", "Sel", "Ham"];
const NAMES_B = ["ley", "ton", "by", "thorpe", "wick", "field", "worth", "ham", "stead", "cote", "bury", "ford", "hurst", "well"];

// ---------------------------------------------------------------- the site
// → { ok, why: [reasons it may not be founded], plan (the town laid from the land), cost, settlers, warn }
export function siteCheck(w, team, x, y, { settlers = RULES.defaultSettlers, from = null, rules = null } = {}) {
  const R = { ...RULES, ...(w.foundRules || {}), ...(rules || {}) }, T = w.teams[team], why = [], warn = [];
  const n = Math.max(R.settlers[0], Math.min(R.settlers[1], Math.round(settlers) || R.defaultSettlers));
  if (!T?.store || T.fallen) return { ok: false, why: ["your house has no town to send settlers from"] };
  if (!Number.isFinite(x) || !Number.isFinite(y) || !w.map.inBounds(x, y) || x < w.map.x0 + 200 || y < w.map.y0 + 200 || x > w.map.x1 - 200 || y > w.map.y1 - 200) return { ok: false, why: ["not on the map (or too near its edge)"] };
  const marching = (T.towns || []).filter((D) => !D.lost);
  if (1 + marching.length >= R.cap) why.push(`your house already holds ${1 + marching.length} towns (at most ${R.cap})`);
  why.push(...landRules(w, team, x, y, R));
  // the ground: the plan the land gives
  const k = w.map.water(x, y) > 0.02 ? "water" : null;
  if (k) why.push("that is water");
  const plan = k ? null : planAt(w, team, x, y, { kind: "village" });
  if (!k && (!plan || plan.error)) why.push(plan?.error || "no ground there for a hall and its plots");
  else if (plan) {
    if (plan.plots.length < R.minPlots) why.push(`the ground there takes only ${plan.plots.length} house plots (${R.minPlots} at least): too steep, wet or wooded`);
    const bad = validatePlan(w.map, plan); if (bad.length) why.push(`the plan does not sit on the ground: ${bad[0]}`);
    if (Math.hypot(plan.hall.x - x, plan.hall.y - y) > 5) for (const q of landRules(w, team, plan.hall.x, plan.hall.y, R)) if (!why.includes(q)) why.push(`its hall's ground: ${q}`); // (the hall goes on the best ground near the click)
  }
  // what it costs (the seat pays)
  const cost = foundCost(w, team, n);
  const S = TW.townView(w, team, from) || T;
  const lab = TW.within(w, team, from, () => spareHands(w, team).length);
  if (lab < n + R.keepHome) why.push(`not enough hands: ${lab} villagers free to go (the column takes ${n} and ${R.keepHome} must stay)`);
  for (const [r, q] of Object.entries(cost.goods)) if ((S.store[r] || 0) < q) why.push(`not enough ${r}: ${Math.round(S.store[r] || 0)} of ${Math.round(q)}`);
  // the vill that sends them must still eat: what is left feeds those who stay for R.reserveDays (to its own harvest)
  const left = TW.within(w, team, from, () => { const Ts = w.teams[team], need = EC.dailyFoodNeed(w, team) - n * E.rations.labourer - cost.deps * E.rations.dependant; return { food: EC.foodStock(Ts) - cost.goods.grain, need: Math.max(1, need) }; });
  if (left.food < left.need * R.reserveDays) why.push(`the granary cannot spare it: ${Math.round(Math.max(0, left.food) / 1000)} t would be left, ${Math.round(left.need * R.reserveDays / 1000)} t feeds those who stay ${R.reserveDays} days`);
  if ((S.dependants || 0) < cost.deps) warn.push(`only ${S.dependants || 0} families' folk to go with them`);
  return { ok: !why.length, why, warn, plan, cost, settlers: n };
}
// the land rules (no plan needed): the distances from the house's own towns and from every other house's towns and holds,
// another house's lands (nearer their town or hold than any of ours), a protected house's lands → [reasons]
export function landRules(w, team, x, y, R = { ...RULES, ...(w.foundRules || {}) }) {
  const why = [], T = w.teams[team];
  const mine = TW.allTowns(w).filter((t) => t.team === team).concat((T.towns || []).filter((D) => !D.lost && !D.s).map((D) => ({ x: D.x, y: D.y, name: D.name })));
  for (const t of mine) { const d = Math.hypot(t.x - x, t.y - y); if (d < R.minOwn) { why.push(`too near ${t.name || "your own town"} (${Math.round(d)} m; ${R.minOwn} m at least)`); break; } }
  // other houses: their towns, and (the realm) every hold, founded or waiting for its house
  const others = TW.allTowns(w).filter((t) => t.team !== team);
  for (const H of w.holds || []) if (H.team !== team) others.push({ team: H.team, x: H.x, y: H.y, name: H.name, hold: true });
  let nearOther = null, dOther = Infinity;
  for (const t of others) { const d = Math.hypot(t.x - x, t.y - y); if (d < dOther) { dOther = d; nearOther = t; } }
  if (nearOther && dOther < R.minOther) why.push(`too near ${nearOther.name || "another house's town"} (${Math.round(dOther)} m; ${R.minOther} m at least)`);
  for (const t of others) if (t.team >= 0 && t.team < w.teams.length && shielded(w, t.team) && w.teams[t.team]?.town && Math.hypot(t.x - x, t.y - y) < R.protectR) { why.push(`within the lands of a house under protection (${t.name || "a newcomer"})`); break; }
  const dMine = mine.length ? Math.min(...mine.map((t) => Math.hypot(t.x - x, t.y - y))) : Infinity;
  if (nearOther && dOther < dMine) why.push(nearOther.hold ? `that is the land of the hold of ${nearOther.name}: nearer it than any of your towns` : `that is ${nearOther.name ? nearOther.name + "'s" : "another house's"} land: nearer their town than any of yours`);
  return why;
}
export function planAt(w, team, x, y, { kind = "village", D = null } = {}) {
  const ctx = siteContext(w, x, y, { team, except: D });
  const T = w.teams[team];
  return planSettlement(w.map, x, y, { kind, seed: w.seed || 1, roads: ctx.roads, claims: ctx.claims, blocks: ctx.blocks, trees: ctx.trees, toward: T?.town ? { x: T.town.x, y: T.town.y } : null, team, id: D?.id, name: D?.name });
}
// THE SEAT'S PLAN read from the land round its keep (a new game, a new realm world, a house founded at its hold): the keep
// stands where it is, everything else is laid from the ground (js/sim/settle.js). A populated town's saved plan is never
// re-planned (its people have built on it): this is called only when a town is made.
export function seatSpec(w, team, { id = null, name = null } = {}) {
  const T = w.teams[team], hall = w.buildings.find((b) => b.id === T?.hall) || (T?.town ? { x: T.town.x, y: T.town.y, rot: 0 } : null);
  if (!hall) return {};
  const ctx = siteContext(w, hall.x, hall.y, { team, skipTeam: team });
  const t = planSettlement(w.map, hall.x, hall.y, { kind: "town", keep: { x: hall.x, y: hall.y, rot: hall.rot ?? null }, seed: w.seed || 1, roads: ctx.roads, claims: ctx.claims, trees: ctx.trees,
    blocks: ctx.blocks.filter((q) => !(q.r && Math.hypot(q.x - hall.x, q.y - hall.y) < 1)), team, id: id || `seat${team}`, name });
  return t.error ? {} : t;
}
// the bill for a column of n settlers founding a town on day `doy` (grain to the first harvest of a field laid on arrival)
export function foundCost(w, team, n) {
  const R = { ...RULES, ...(w.foundRules || {}) }, deps = Math.round(n * R.depsPer), doy = w.econ?.doy ?? E.startDoy;
  const fh = firstHarvest(doy + 75), days = Math.max(120, fh.ripe - doy) + E.provisionMarginDays + 10; // (the march, then the first ground cleared and broken while the hall goes up: two months or so before the first seed is in)
  const daily = n * E.rations.labourer + deps * E.rations.dependant;
  const grain = Math.round(daily * days * 0.9 / 100) * 100; // (gardens, dairy and the wild give a tenth)
  return { deps, days, goods: { grain: grain + R.seedHa * 170, timber: R.timber, stone: R.stone, firewood: R.firewood, silver: R.silver }, carts: 1, oxen: 2, sheep: 40 };
}

// ---------------------------------------------------------------- the order
// → { ok, D, msg } | { ok: false, error }
export function orderFounding(w, team, x, y, { settlers = RULES.defaultSettlers, name = null, from = null, rules = null } = {}) {
  const chk = siteCheck(w, team, x, y, { settlers, from, rules });
  if (!chk.ok) return { ok: false, error: chk.why[0], check: chk };
  const T = w.teams[team], n = chk.settlers, cost = chk.cost;
  const D = { id: `d${(T.townSeq = (T.townSeq || 0) + 1)}`, name: name || townName(w, team, x, y), x: chk.plan.hall.x, y: chk.plan.hall.y, site: { x, y },
    state: "march", orderedDay: w.econ.doy, orderedTick: w.tick, from: from?.id || null, spec: chk.plan, deps: 0, carry: {}, unit: null, lost: false };
  // the column: the settlers chosen from the home crew (a mix of men and women; a carpenter and a mason if there are any)
  const ok = TW.within(w, team, from, () => {
    // the column is called in from the work (the reeve sets the rest to it again)
    for (const v of EC.workerUnits(w, team)) if (v.job?.kind !== "home" && !v.away && !v.convoy && !v.broad && !v.ordered && (EC.homeUnit(w, team)?.members.length || 0) < n + 8) EC.releaseWorkers(w, v);
    const home = EC.homeUnit(w, team); if (!home) return false;
    const pref = ["man", "woman", "carpenter", "mason", "weaver"], rank = (id) => { const r = ROLES[EC.roleOf(w, id)], i = pref.indexOf(r); return i < 0 ? 9 : i; };
    const ids = home.members.filter((id) => w.S.alive[id]).map((id) => [rank(id), id]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    // alternate men and women down the list, then the trades, so the column is families, not a gang
    const men = ids.filter((q) => q[0] === 0).map((q) => q[1]), women = ids.filter((q) => q[0] === 1).map((q) => q[1]), trades = ids.filter((q) => q[0] >= 2 && q[0] < 9).map((q) => q[1]), rest = ids.filter((q) => q[0] === 9).map((q) => q[1]);
    const pick = []; if (trades.length) pick.push(trades.shift()); if (trades.length && n >= 24) pick.push(trades.shift());
    while (pick.length < n && (men.length || women.length)) { if (men.length) pick.push(men.shift()); if (pick.length < n && women.length) pick.push(women.shift()); }
    while (pick.length < n && (trades.length || rest.length)) pick.push((trades.length ? trades : rest).shift());
    if (pick.length < n) return false;
    const u = splitUnit(w, home, pick);
    u.settling = D.id; u.isWorkers = true; u.job = { kind: "home" }; u.formation = "column";
    // the house pays: what they carry comes out of the store now
    const S = w.teams[team];
    for (const [r, q] of Object.entries(cost.goods)) { const got = EC.take(S, r, q); if (r !== "silver") D.carry[r] = got; }
    const carts = Math.min(cost.carts, S.store.carts || 0), oxen = Math.min(cost.oxen, S.store.oxen || 0);
    EC.take(S, "carts", carts); EC.take(S, "oxen", oxen); D.carry.carts = carts; D.carry.oxen = oxen;
    const sheep = Math.min(cost.sheep, Math.max(0, (S.sheep || 0) - 40)); S.sheep -= sheep; D.sheep = sheep;
    const deps = Math.min(cost.deps, Math.max(0, (S.dependants || 0) - 20)); S.dependants -= deps; D.deps = deps;
    D.unit = u.id;
    return u;
  });
  if (!ok) return { ok: false, error: "not enough hands at home to make up the column", check: chk };
  (T.towns ||= []).push(D);
  issueOrder(w, [D.unit], { kind: "move", x: D.x, y: D.y, pace: "march" });
  const u = w.units.get(D.unit); if (u) { u.away = true; u.awayUntil = 1e12; }
  w.events.push({ t: w.tick, kind: "settlers-set-out", team, town: D.id, name: D.name, n, x: D.x, y: D.y });
  w.log.push({ t: w.tick, kind: "settlers-set-out", team, town: D.id, name: D.name, n, x: D.x, y: D.y });
  return { ok: true, D, msg: `${n} settlers and their families set out to found ${D.name} (${chk.plan.form} village): ${Math.round(Math.hypot(D.x - (T.town?.x ?? D.x), D.y - (T.town?.y ?? D.y)))} m off` };
}
// the villagers who could go: everyone on the reeve's work (not marched off, carting for the army, or on the player's task)
function spareHands(w, team) { const out = []; for (const u of EC.workerUnits(w, team)) if (!u.away && !u.convoy && !u.broad && !u.ordered && !u.settling) for (const id of u.members) if (w.S.alive[id]) out.push(id); return out; }
function townName(w, team, x, y) {
  const used = new Set(TW.allTowns(w).map((t) => t.name).concat((w.teams || []).flatMap((T) => (T.towns || []).map((D) => D.name))));
  const h = (Math.imul(Math.round(x), 2654435761) ^ Math.imul(Math.round(y), 40503) ^ Math.imul(team + 1, 97)) >>> 0;
  for (let k = 0; k < 200; k++) { const nm = NAMES_A[(h + k * 7) % NAMES_A.length] + NAMES_B[((h >>> 8) + k * 3) % NAMES_B.length]; if (!used.has(nm)) return nm; }
  return `New town ${team + 1}`;
}

// ---------------------------------------------------------------- every tick
export function foundingSystem(w) {
  if (!w.teams.some((T) => T.towns?.length)) return;
  for (const T of w.teams) {
    if (!T.towns?.length) continue;
    for (const D of T.towns) {
      if (D.lost) continue;
      if (T.fallen) { loseTown(w, T, D, "the house fell"); continue; }
      if (D.state === "march") { march(w, T, D); continue; }
      if (D.hallLost) { loseTown(w, T, D, "its hall was burnt"); continue; }
      if ((w.tick + T.id * 7) % 50 === 0 && sackCheck(w, T, D)) continue;
      if (D.state === "camp") { const hall = w.buildings.find((b) => b.id === D.s.hall); if (hall && hall.progress >= 1) layOut(w, T, D); }
      if ((w.tick + T.id) % 10 === 0) wardenTowns(w, T, D);
      // nobody moves to a settlement with no corn of its own yet: newcomers come after its first harvest is in
      if (D.s && !(D.s.stats?.harvested > 0) && D.s.acc) D.s.acc.imm = Math.min(D.s.acc.imm, -1);
      const think = D.reeve && (w.tick + 5) % D.reeve.econEvery === 0, build = D.state === "town" && (w.tick + T.id * 13) % 200 === 0;
      if (think || build) TW.within(w, T.id, D, () => { if (think) reeveThink(w, D.reeve); if (build) steward(w, T, D); });
    }
  }
}

function march(w, T, D) {
  const u = w.units.get(D.unit);
  if (!u || !u.members.length) { // cut down or scattered on the road
    T.dependants += D.deps; D.deps = 0; // (their families turn back to the seat)
    loseTown(w, T, D, "the settlers never reached it");
    return;
  }
  u.away = true; u.awayUntil = 1e12;
  const d = Math.hypot(u.ax - D.x, u.ay - D.y);
  if (d < 45) { arrive(w, T, D, u); return; }
  if ((w.tick + u.id) % 50 === 0 && !u.moving && !u.path && !u.pendingOrder && u.order?.kind !== "move") issueOrder(w, [u.id], { kind: "move", x: D.x, y: D.y, pace: "march" }), u.away = true, u.awayUntil = 1e12;
}

// the settlers are there: the plan read again from the land as it is now, the camp, the hall's foundations
function arrive(w, T, D, u) {
  const team = T.id;
  const plan = planAt(w, team, D.site?.x ?? D.x, D.site?.y ?? D.y, { kind: "village", D });
  if (plan && !plan.error && plan.plots.length >= Math.min(RULES.minPlots, D.spec.plots.length)) D.spec = plan;
  D.x = D.spec.hall.x; D.y = D.spec.hall.y;
  const store = Object.fromEntries(Object.keys(START.store).map((k) => [k, 0]));
  for (const [r, q] of Object.entries(D.carry || {})) store[r] = (store[r] || 0) + q;
  const n = u.members.length;
  D.s = { town: { x: D.x, y: D.y }, store, hall: null, homeUnit: u.id, dependants: D.deps, squires: 0, sheep: D.sheep || 0, unrest: 0.05, ration: 1, starveAcc: 0, arrears: 0, arrearsDays: 0,
    acc: { birth: 0, death: 0, starve: 0, imm: 0, emi: 0 }, market: { recent: {} }, day: { buildDays: 0, craftDays: 0, wages: 0, income: 0 }, stats: { harvested: 0, bought: 0, sold: 0, starvedDays: 0 },
    camp0: n + D.deps, camp: 0, freePlots: [], eff: 1, daylight: 12, harvestTime: false, shelter: false, besieged: false, hq: { x: D.x, y: D.y } }; // (camp0: the tents hold the settlers and no more — newcomers come when there are cottages)
  D.deps = 0;
  u.town = D.id; u.settling = null; u.away = false; u.awayUntil = 0; u.path = null; u.order = { kind: "hold" }; u.job = { kind: "home" }; u.haul = new Map(); u.danger = 0; u.isWorkers = true;
  TW.within(w, team, D, () => {
    const h = D.spec.hall, b = EC.placeBuilding(w, team, "town_hall", h.x, h.y, h.rot || 0, true);
    b.manor = true; b.tname = D.name; b.progress = 0.02; b.hpMax = RULES.hallHp; b.hp = b.hpMax * 0.06; b.stage = "build1"; b.labour = RULES.hallLabour * (b.land?.labourMul || 1);
    EC.take(w.teams[team], "timber", 12000); // (the hall's frame and boards: carried, now in the work)
    D.s.hall = b.id; w.teams[team].hall = b.id;
    D.reeve = makeGeneral(w, team, { difficulty: 0.7, disposition: "defensive", research: false });
    D.reeve.town = D.id; D.reeve.econEvery = 60; D.reeve.layFields = true;
  });
  D.plan = { team, town: null, slots: [], camp: true }; // (no plan yet — it is laid when the hall stands — but the reeve breaks ground for the first fields at once)
  D.state = "camp"; D.arrivedDay = w.econ.doy; D.arrivedTick = w.tick;
  const e = { t: w.tick, kind: "settlers-arrived", team, town: D.id, name: D.name, n, x: D.x, y: D.y };
  w.events.push(e); w.log.push(e);
}

// the hall stands: the vill's plan is laid out on the land
function layOut(w, T, D) {
  TW.within(w, T.id, D, () => {
    D.plan = buildPlan(T.id, { ...D.spec, id: D.id }, []);
    w.plans && (w.plans[T.id] = D.plan);
    const hall = w.buildings.find((b) => b.id === D.s.hall); if (hall) hall.stage = "complete";
    // the settlers move out of their tents into the cottages as they are built; the steward stakes the first ones now
    steward(w, T, D, 3);
  });
  D.state = "town"; D.townDay = w.econ.doy;
  const e = { t: w.tick, kind: "town-founded", team: T.id, town: D.id, name: D.name, form: D.spec.form, x: D.x, y: D.y };
  w.events.push(e); w.log.push(e);
}

// THE STEWARD of a daughter town (in its frame): cottages as the families need them, a granary before the harvest, a
// market once it is a village. (The reeve — reeveThink — lays and works the fields and puts the hands to work.)
function steward(w, T, D, burst = 1) {
  const team = T.id, S = w.teams[team], hall = w.buildings.find((b) => b.id === S.hall); if (!hall || !w.plans?.[team]) return;
  const under = w.buildings.filter((b) => b.team === team && b.progress < 1 && !b.ruin && !b.field).length;
  if (under >= burst) return;
  const hc = EC.headcount(w, team), pop = S.dependants + hc.labour + hc.soldiers + S.squires, room = EC.housing(w, team);
  const want = [];
  // a cottage for the families still under canvas, then one as the vill fills (newcomers come to empty cottages: a young
  // settlement grows a house at a time, not a street at once)
  if ((S.camp || 0) > 0 || room - pop < 4) want.push("house");
  if (!w.buildings.some((b) => b.team === team && b.kind === "granary" && !b.ruin) && EC.foodStock(S) > 6000) want.push("granary");
  if (stageStatus(w, team).reached >= 1 && !w.buildings.some((b) => b.team === team && b.kind === "market" && !b.ruin)) want.push("market");
  let placed = 0;
  for (const kind of want) {
    for (let k = 0; k < (kind === "house" ? burst : 1); k++) {
      if (!EC.canAfford(S, EC.costOf(kind))) break;
      const s = bestSlot(w, team, kind, hall); if (!s) break;
      const r = placeOnPlan(w, team, kind, s.x, s.y); if (!r.b) break;
      placed++;
    }
    if (placed >= burst) break;
  }
}

// a daughter whose hall is in enemy hands: enemies about it in strength and none of ours to hold it, for a day
function sackCheck(w, T, D) {
  const hall = w.buildings.find((b) => b.id === D.s?.hall); if (!hall) return false;
  const foes = strengthNear(w, T.id, hall.x, hall.y, 260, true), ours = strengthNear(w, T.id, hall.x, hall.y, 260, false);
  if (foes >= 20 && ours < foes * 0.25) { D.sackT = (D.sackT || 0) + 50; if (!D.besiegedNews) { D.besiegedNews = true; const e = { t: w.tick, kind: "town-threatened", team: T.id, town: D.id, name: D.name, x: hall.x, y: hall.y }; w.events.push(e); w.log.push(e); } }
  else { D.sackT = Math.max(0, (D.sackT || 0) - 100); if (!D.sackT) D.besiegedNews = false; }
  if (D.sackT >= 1 / EC.DT) { // a day in their hands: sacked
    let by = -1, bn = 0; for (const u of w.units.values()) if (!u.isWorkers && u.members.length && isFoe(w, T.id, u.team) && Math.hypot(u.ax - hall.x, u.ay - hall.y) < 300 && u.members.length > bn) { bn = u.members.length; by = u.team; }
    if (by >= 0 && w.teams[by]?.store) for (const [r, q] of Object.entries(D.s.store || {})) if (q > 0 && r !== "silver" && r !== "gold") EC.give(w.teams[by], r, q * 0.6); // (the plunder carried off)
    loseTown(w, T, D, by >= 0 ? `sacked by ${w.teams[by]?.name || "the enemy"}` : "taken by the enemy", by);
    return true;
  }
  return false;
}
// the warden (the realm, the lord away: T.keepsPeace) or the reeve brings the villagers in to the hall when an enemy is near
function wardenTowns(w, T, D) {
  if (!D.s) return;
  const hall = w.buildings.find((b) => b.id === D.s.hall); if (!hall) return;
  const near = strengthNear(w, T.id, hall.x, hall.y, 600, true) >= 8;
  if (near && !D.s.shelter && (T.keepsPeace || T.wardenTowns)) {
    D.s.shelter = true;
    TW.within(w, T.id, D, () => { for (const u of EC.workerUnits(w, T.id)) if (u.job?.kind !== "home" && !u.convoy) EC.releaseWorkers(w, u); });
    const e = { t: w.tick, kind: "town-sheltered", team: T.id, town: D.id, name: D.name, x: hall.x, y: hall.y }; w.events.push(e); w.log.push(e);
  } else if (!near && D.s.shelter) D.s.shelter = false;
}
// the town is lost: its buildings left as ruins, its people scattered (they leave the books as emigrants), its soldiers fall
// back on the seat
export function loseTown(w, T, D, why, by = -1) {
  if (D.lost) return;
  D.lost = true; D.lostWhy = why; D.lostDay = w.econ?.doy;
  const c = T.census;
  for (const b of w.buildings) if (b.team === T.id && b.town === D.id && !b.ruin) { if (b.field) { b.field.state = "fallow"; b.field.left = 0; b.ruin = true; } else EC.ruinBuilding(w, b, true); }
  for (const u of [...w.units.values()]) if (u.team === T.id && (u.town === D.id || u.settling === D.id)) {
    if (u.isWorkers) { for (const id of u.members.slice()) if (EC.retire(w, id) && c) c.emigrated++; }
    else delete u.town; // (its soldiers are the seat's now)
  }
  if (D.s && c) { c.emigrated += (D.s.dependants || 0) + (D.s.squires || 0); D.s.dependants = 0; D.s.squires = 0; }
  if (D.deps && c) { c.emigrated += D.deps; D.deps = 0; }
  D.state = "lost"; D.reeve = null; D.plan = null;
  const e = { t: w.tick, kind: "town-lost", team: T.id, town: D.id, name: D.name, why, by, x: D.x, y: D.y };
  w.events.push(e); w.log.push(e);
}

// ---------------------------------------------------------------- an AI lord's second town
// When he prospers — food for half a year, hands and timber and silver to spare, no enemy in sight — a lord sends out
// settlers to the best site within a day's walk, on the side of his lands away from his foe.
export function lordFounds(w, G, ctx) {
  if (G.town || G.warden) return;
  const T = w.teams[G.team], doy = ctx.doy;
  if ((T.towns || []).some((D) => !D.lost) || (G.foundTried && doy - G.foundTried < 20)) return;
  if (doy < (w.econ.startDoy || 0) + 25 || G.threat || (G.mode !== "home" && G.mode !== "victory") || ctx.foodDays < 150) return; // (at home, or with no foe left to fight)
  const hc = EC.headcount(w, G.team); if (hc.labour < 90) return;
  const cost = foundCost(w, G.team, 24); if ((T.store.timber || 0) < cost.goods.timber * 2 || (T.store.silver || 0) < 3000 || (T.store.grain || 0) < cost.goods.grain * 2) return;
  G.foundTried = doy;
  const hall = ctx.hall; if (!hall) return;
  const foe = G.enemyTown, away = foe ? Math.atan2(hall.y - foe.y, hall.x - foe.x) : 0;
  const cands = [];
  for (const r of [700, 850, 1000]) for (let k = 0; k < 16; k++) {
    const a = k / 16 * 2 * Math.PI, x = hall.x + Math.cos(a) * r, y = hall.y + Math.sin(a) * r;
    if (!w.map.inBounds(x, y) || w.map.water(x, y) > 0.02) continue;
    const g = w.map.grad(x, y); if (Math.hypot(g[0], g[1]) > 0.08) continue;
    if (landRules(w, G.team, x, y).length) continue;
    cands.push({ x, y, s: Math.cos(a - away) * 2 - r / 600 - Math.hypot(g[0], g[1]) * 20 });
  }
  cands.sort((a, b) => b.s - a.s || a.x - b.x);
  for (const c of cands.slice(0, 8)) {
    const r = orderFounding(w, G.team, c.x, c.y, { settlers: 24 });
    if (r.ok) { G.log.push({ tick: w.tick, day: doy, msg: `sends settlers to found ${r.D.name}` }); return; }
  }
}
LORD_HOOKS.push(lordFounds);

// ---------------------------------------------------------------- what the UI shows of a town
export function townSummary(w, team, D) {
  const T = w.teams[team];
  if (D && !D.s) { const u = w.units.get(D.unit); return { id: D.id, name: D.name, state: D.state, x: D.x, y: D.y, settlers: u?.members.length || 0, deps: D.deps, carry: { ...D.carry }, eta: u ? Math.round(Math.hypot(u.ax - D.x, u.ay - D.y)) : null, lost: !!D.lost, why: D.lostWhy || null }; }
  return TW.within(w, team, D, () => {
    const S = w.teams[team], hc = EC.headcount(w, team), need = EC.dailyFoodNeed(w, team), food = EC.foodStock(S);
    const hall = w.buildings.find((b) => b.id === S.hall);
    return { id: D?.id || null, name: D?.name || null, state: D ? D.state : "seat", x: S.town.x, y: S.town.y, hall: S.hall, hallProgress: hall ? Math.round(hall.progress * 100) : 0,
      food: Math.round(food), need: Math.round(need), days: Math.floor(food / Math.max(1, need)), labour: hc.labour, soldiers: hc.soldiers, dependants: S.dependants, housing: EC.housing(w, team), camp: S.camp || 0,
      store: { grain: Math.round(S.store.grain || 0), timber: Math.round(S.store.timber || 0), stone: Math.round(S.store.stone || 0), firewood: Math.round(S.store.firewood || 0), silver: Math.round(S.store.silver || 0) },
      buildings: w.buildings.filter((b) => b.team === team && !b.ruin && !b.field && b.kind !== "town_hall").length, fields: w.buildings.filter((b) => b.team === team && b.field && !b.ruin).length,
      form: D?.spec?.form || null, lost: !!D?.lost };
  });
}
export { SIZES };
