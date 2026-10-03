// Field supply, desertion, sieges and the fall of towns (docs/economy-research.md §4, §9).
//
// An army inside E.supplyRadius of one of its own food stores eats from the town (economy.js
// counts it). Away from home it eats its BAGGAGE: 4 days on every man's back, 500 kg per cart,
// 90 kg per packhorse, and its horses eat 4.5 kg of grain a day (half that when grazing summer
// grass). The Engels ceiling falls out of these numbers: no army carries more than ~2 weeks.
// Out of supply: no fatigue recovery → stress → desertion. Levies also drift home after their
// 40 days and at harvest. A town whose hall is ringed by a superior enemy is INVESTED (no
// gathering outside, no trade, no migrants); it falls when stormed (sacked) or starved (surrender).
import { S_FLEE, S_FIGHT, clamp } from "./soldiers.js";
import { ARMS } from "./arms.js";
import { E, DT, take, give, retire, foodStock, complete, BUILDINGS, disband } from "./economy.js";
import { BATTLE_RATE, TICK } from "./clock.js";
import { isFoe } from "./sides.js";
import * as TC from "./tech.js"; // (the castle tiers' hold-out: js/sim/estates.js through TC.mul)

// THE FIELD CLOCK (clock.js two-clock model, §10 crossover rule). A town lives on the economic clock: its
// calendar, fields, workshops and larder. A body of men AWAY from its stores lives on whichever clock
// governs what it is doing. Marching and fighting are tactical-map activities and run on the battle clock
// (real time): a 4 km march that takes an hour on screen costs an hour's bread, an hour's wages and an hour
// of a levy's forty days — not the ~80 economic days the calendar turns meanwhile (debiting those made a
// walk across the vale eat two months of rations and pay, and armies starved, went broke and deserted on
// the road). An army that STANDS in the field — camped, investing a town, waiting out a stand-off — is
// on the economic clock like everything else, so a siege really does eat its train.
const TACT_DAYS = TICK * BATTLE_RATE / 86400; // battle-clock days per tick
export function fieldDays(u, econDays) {
  const active = u.moving || u.hold || (u.c && (u.c.phase === "charge" || u.c.phase === "pursuit")); // (on the move, or locked in a fight)
  return active ? econDays / DT * TACT_DAYS : econDays;
}

const EVERY = 10;
const FOOD_STORES = new Set(["town_hall", "granary"]);

export function nearestFoodStore(w, team, x, y) {
  let best = null, bd = Infinity;
  for (const b of w.buildings) { if (b.team !== team || !FOOD_STORES.has(b.kind) || !complete(b)) continue; const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = b; } }
  return best ? { b: best, d: bd } : null;
}

export const horsesOf = (u) => u.members.length * (ARMS[u.arm].horse || (ARMS[u.arm].mounted ? 1 : 0));
export const baggageDays = (u) => { const need = u.members.length * E.rations.soldier + horsesOf(u) * E.horse.grainWork; return need > 0 ? (u.supply?.food || 0) / need : 0; };

// Load an army's baggage from the town before a march: `days` of food, `carts` wagons (each needs a
// draught animal), arrows for the bowmen. Only possible at home.
export function loadBaggage(w, team, unitIds, { days = 8, carts = 0, packhorses = 0 } = {}) {
  const T = w.teams[team]; let loaded = 0;
  const units = unitIds.map((id) => w.units.get(id)).filter((u) => u && !u.isWorkers);
  carts = Math.min(carts, T.store.carts, T.store.oxen + T.store.horses);
  packhorses = Math.min(packhorses, T.store.packhorses);
  units.forEach((u, k) => {
    const near = nearestFoodStore(w, team, u.ax, u.ay); if (!near || near.d > E.supplyRadius) return;
    const s = (u.supply ||= { food: 0, arrows: 0, carts: 0, packhorses: 0 });
    const c = Math.floor(carts / units.length) + (k < carts % units.length ? 1 : 0);
    const p = Math.floor(packhorses / units.length) + (k < packhorses % units.length ? 1 : 0);
    take(T, "carts", c); take(T, "packhorses", p); s.carts += c; s.packhorses += p;
    const capKg = u.members.length * 4 * E.rations.soldier + s.carts * E.carriers.cart.kg + s.packhorses * E.carriers.packhorse.kg;
    const need = u.members.length * E.rations.soldier + horsesOf(u) * E.horse.grainWork;
    const want = Math.min(capKg, need * days) - s.food;
    if (want > 0) { const g = take(T, "grain", want); s.food += g; loaded += g; }
    if (ARMS[u.arm].missile) { const key = ARMS[u.arm].missile === "crossbow" ? "bolts" : "arrows"; const a = take(T, key, Math.max(0, u.members.length * 48 - s.arrows)); s.arrows += a; }
  });
  return loaded;
}

export function logisticsSystem(w) {
  if (!w.econ || w.tick % EVERY) return;
  const dtd = DT * EVERY, S = w.S, doy = w.econ.doy;
  for (const u of w.units.values()) {
    if (u.isWorkers || !u.members.length) continue;
    const T = w.teams[u.team]; if (!T.store) continue;
    const s = (u.supply ||= { food: 0, arrows: 0, carts: 0, packhorses: 0 });
    const near = nearestFoodStore(w, u.team, u.ax, u.ay);
    // depot: camped by a store. line: fed by cart convoys from home — the whole vale is inside one
    // day's cart haul (§4: carts ≤30 km/day), so baggage only matters when the line is CUT (enemy
    // astride the road, the vill invested, the granary empty or no cart or packhorse left to send).
    u.supplyMode = !near || T.fallen ? "baggage" : near.d <= E.supplyRadius ? "depot"
      : !T.besieged && foodStock(T) > 0 && (T.store.carts + T.store.packhorses >= 1 || cartsOnTheRoad(w, u.team)) && !lineCut(w, u, near.b) ? "line" : "baggage";
    u.outOfSupply = u.supplyMode === "baggage";
    // at the stores the town's table and calendar apply; in the field, the field clock (above)
    const dt = u.supplyMode === "depot" ? dtd : fieldDays(u, dtd);
    if (u.supplyMode !== "depot") u.payDays = (u.payDays ?? 0) + dt; // wages accrue on the same clock (economy.js)
    if (u.levy) u.served = (u.served ?? 0) + dt;
    const A = ARMS[u.arm], ammoKey = A.missile === "crossbow" ? "bolts" : "arrows";
    if (u.supplyMode === "line") {
      // on campaign: they eat what the villagers' convoys have carried up (convoys.js); short → hungry
      const graze = (((doy) % 365) + 365) % 365 > 120 && (((doy) % 365) + 365) % 365 < 280 ? 0.5 : 1; // (the calendar's year: the realm runs for years)
      const need = (u.members.length * E.rations.soldier + horsesOf(u) * E.horse.grainWork * graze) * dt;
      // (the battle clock is real time, so a cart's walk out takes weeks of ECONOMY time: the convoys you
      // see are the stream, not every sack of it — while the line holds, the army's bread is drawn from the
      // town's stores as if it had come up the road, grain first, then corn in the sheaf. What the carts
      // have brought, and what the men marched out with, is the BAGGAGE: the reserve for the day the line
      // fails — eating it first, as before, left an army that had been fed all the way with empty wagons)
      let got = take(T, "grain", need);
      if (got < need) got += take(T, "sheaves", need - got);
      if (got < need) { const b = Math.min(s.food, need - got); s.food -= b; got += b; }
      if (got < need) got += forage(w, u, need - got);
      const frac = got / Math.max(1e-9, need);
      u.hunger = frac > 0.95 ? Math.max(0, (u.hunger || 0) - dt * 2) : (u.hunger || 0) + (1 - frac) * dt;
      if (A.missile && T.store[ammoKey] > 0) refillAmmo(w, u, (n) => take(T, ammoKey, n)); // arrows ride the same carts
      if (u.hunger > 0.3) hungerEffects(w, u, u.hunger, dt);
    } else if (!u.outOfSupply) {
      u.hunger = Math.max(0, (u.hunger || 0) - dtd * 2);
      // by the stores: men fill their packs (3 days' bread) so a march out isn't a march into hunger
      if (u.supplyMode === "depot") {
        const want = (u.members.length * E.rations.soldier + horsesOf(u) * E.horse.grainWork) * 8 - s.food; // 8 days: the reserve against a cut line (the walk itself costs little: field clock)
        if (want > 1 && (T.store.grain || 0) > want * 4) { take(T, "grain", want); s.food += want; }
      }
      if (s.carts && near.d < 250) { give(T, "carts", s.carts); s.carts = 0; }
      if (s.packhorses && near.d < 250) { give(T, "packhorses", s.packhorses); s.packhorses = 0; }
      if (s.food > 0 && near.d < 250) { give(T, "grain", s.food); s.food = 0; }
      if (A.missile && T.store[ammoKey] > 0) refillAmmo(w, u, (n) => take(T, ammoKey, n));
      if (T.ration < 0.6) hungerEffects(w, u, (1 - T.ration) * 3, dtd);
    } else {
      // eat from the baggage; foraging in someone's ripening fields (a chevauchée lives off the enemy)
      const graze = (((doy) % 365) + 365) % 365 > 120 && (((doy) % 365) + 365) % 365 < 280 ? 0.5 : 1; // (the calendar's year: the realm runs for years)
      let need = (u.members.length * E.rations.soldier + horsesOf(u) * E.horse.grainWork * graze) * dt;
      let got = Math.min(s.food, need); s.food -= got; need -= got;
      if (need > 0) got += forage(w, u, need);
      const frac = got / Math.max(1e-9, (u.members.length * E.rations.soldier + horsesOf(u) * E.horse.grainWork * graze) * dt);
      u.hunger = frac > 0.95 ? Math.max(0, (u.hunger || 0) - dt * 0.5) : (u.hunger || 0) + (1 - frac) * dt;
      if (A.missile && s.arrows > 0) refillAmmo(w, u, (n) => { const g = Math.min(n, s.arrows); s.arrows -= g; return g; });
      if (u.hunger > 0.3) hungerEffects(w, u, u.hunger, dt);
    }
    desertion(w, u, T, dt, doy);
  }
  if (w.tick % 40 === 0 && !w.siegeWar) for (const T of w.teams) if (T.store && !T.fallen) siegeState(w, T); // (?mode=siege: the castle is the war — siege-war.js — not the vills round it)
}

const cartsOnTheRoad = (w, team) => (w.convoys || []).some((c) => c.team === team && (c.phase === "out" || c.phase === "back"));

// An enemy body within 200 m of the road from the store to the army cuts the convoys.
export function lineCut(w, u, store) {
  const ax = store.x, ay = store.y, bx = u.ax, by = u.ay, L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
  for (const v of w.units.values()) {
    if (!isFoe(w, u.team, v.team) || v.isWorkers || v.members.length < 5 || v.state === "routing") continue;
    const t = clamp(((v.ax - ax) * (bx - ax) + (v.ay - ay) * (by - ay)) / L2, 0, 1);
    if (t > 0.97) continue; // the enemy in front of us is a battle, not a cut line
    if (Math.hypot(ax + (bx - ax) * t - v.ax, ay + (by - ay) * t - v.ay) < 200) return true;
  }
  return false;
}

function refillAmmo(w, u, takeN) {
  const S = w.S, full = ARMS[u.arm].ammo || 0;
  for (const id of u.members) {
    if (S.state[id] === S_FIGHT || S.ammo[id] >= full) continue;
    const g = takeN(Math.floor(full - S.ammo[id])); S.ammo[id] += g; if (g <= 0) break;
  }
}

function forage(w, u, need) {
  let got = 0;
  for (const b of w.buildings) {
    if (!b.field || !isFoe(w, u.team, b.team) || b.field.left <= 0) continue;
    if (Math.abs(u.ax - b.x) > b.w / 2 + 60 || Math.abs(u.ay - b.y) > b.h / 2 + 60) continue;
    const f = b.field; if (w.econ.doy < f.ripe - 30) continue; // green corn will not feed men
    const g = Math.min(f.left, need - got); f.left -= g; got += g; if (got >= need) break;
  }
  return got;
}

// Hungry men don't recover (§9): fatigue floor rises, stress creeps up.
function hungerEffects(w, u, hunger, dtd) {
  const S = w.S, floor = clamp(0.08 * hunger, 0, 0.7);
  for (const id of u.members) { if (S.fatigue[id] < floor) S.fatigue[id] = floor; S.stress[id] += 0.03 * Math.min(hunger, 6) * dtd; }
}

function desertion(w, u, T, dtd, doy) {
  const S = w.S;
  const home = Math.hypot(u.ax - T.town.x, u.ay - T.town.y);
  let p = 0.004 * Math.min(u.hunger || 0, 15) + 0.015 * clamp((T.arrearsDays || 0) / 7, 0, 3) + 0.02 * Math.max(0, T.unrest - 0.5);
  if (u.levy) {
    const served = u.served ?? doy - (u.musterDay ?? w.econ.startDoy); // (days of service, on the field clock)
    if (served > 40) p += 0.01 * Math.min(4, (served - 40) / 10);               // the forty days are up
    if (home > 1500 && w.buildings.some((b) => b.team === u.team && b.field?.state === "ripe")) p += 0.015; // their own corn is ripe
  }
  if (p <= 0) return;
  // unpaid men near home walk off to their families: back in the vill as labourers, their kit in the store — not lost
  const unpaid = (T.arrearsDays || 0) > 0 && (u.hunger || 0) < 1 && home < 1500 && !u.retinue;
  const homeward = [];
  for (const id of u.members.slice()) {
    if (S.state[id] === S_FIGHT || !S.alive[id]) continue;
    if (w.rng.chance(p * dtd)) { if (unpaid) homeward.push(id); else { retire(w, id); T.census.deserted++; } }
  }
  if (homeward.length) { const n = disband(w, u, homeward); if (n) w.events.push({ t: w.tick, kind: "unpaid-home", team: u.team, arm: u.arm, n }); }
}

// ────────────────────────────────────────────────────────────── sieges & the fall of towns
export function strengthNear(w, team, x, y, r, enemy = false) {
  let n = 0;
  for (const u of w.units.values()) {
    if ((enemy ? !isFoe(w, team, u.team) : u.team !== team) || u.isWorkers || !u.members.length || u.state === "routing") continue;
    if (Math.hypot(u.ax - x, u.ay - y) < r) n += u.members.length * (1 + ARMS[u.arm].armour * 0.25);
  }
  return n;
}

function siegeState(w, T) {
  const hall = w.buildings.find((b) => b.id === T.hall);
  if (T.keepsPeace) { T.sackT = 0; if (hall && !hall.ruin) { const was = T.besieged; T.besieged = strengthNear(w, T.id, hall.x, hall.y, E.investRadius, true) >= 25; if (T.besieged !== was) w.events.push({ t: w.tick, kind: T.besieged ? "siege-begins" : "siege-lifted", team: T.id }); } return; } // (the Keep's Peace: an absent lord's keep does not fall — docs/realm-world.md)
  if (!hall || hall.ruin) return fall(w, T, "keep destroyed");
  const foe = strengthNear(w, T.id, hall.x, hall.y, E.investRadius, true);
  const own = strengthNear(w, T.id, hall.x, hall.y, E.investRadius, false);
  const was = T.besieged;
  T.besieged = foe >= 25 && foe > own * 1.2;
  if (T.besieged !== was) w.events.push({ t: w.tick, kind: T.besieged ? "siege-begins" : "siege-lifted", team: T.id });
  if (T.besieged) T.siegeDays = (T.siegeDays || 0) + DT * 40; else T.siegeDays = 0;
  // sack: the enemy holds the keep's gate with no defenders left
  // (only when no organised defence is left anywhere near the vill)
  const foeClose = strengthNear(w, T.id, hall.x, hall.y, 120, true), ownClose = strengthNear(w, T.id, hall.x, hall.y, 450, false);
  T.sackT = foeClose >= 15 && ownClose < Math.max(6, foeClose * 0.25) ? (T.sackT || 0) + DT * 40 * TC.mul(w, T.id, "sack") : Math.max(0, (T.sackT || 0) - DT * 40); // (a castle holds out: js/sim/estates.js)
  if (T.sackT >= 1) return fall(w, T, "stormed and sacked");
  // starved into surrender (Kenilworth, Calais): no food, hungry for weeks, no relief
  if (T.besieged && foodStock(T) < 50 && T.starveAcc > 25 && T.unrest > 0.6) return fall(w, T, "starved into surrender");
}

function fall(w, T, why) {
  if (T.fallen) return;
  T.fallen = true; T.besieged = false; T.fallReason = why;
  // the victor: the other side (two teams); more — the house at war with this one with the most men near its keep
  const by = w.teams.length <= 2 ? 1 - T.id : victorAt(w, T);
  T.fallenTo = by;
  if (w.teams.length <= 2) w.econ.winner = w.econ.winner ?? by;
  // the victor takes the lord's chest
  const V = by >= 0 ? w.teams[by] : null; if (V?.store) { give(V, "silver", T.store.silver); give(V, "gold", T.store.gold); take(T, "silver", T.store.silver); take(T, "gold", T.store.gold); }
  w.events.push({ t: w.tick, kind: "town-fell", team: T.id, why, by });
}
function victorAt(w, T) {
  const hall = w.buildings.find((b) => b.id === T.hall) || T.town; if (!hall) return -1;
  const str = new Map();
  for (const u of w.units.values()) {
    if (u.isWorkers || !u.members.length || !isFoe(w, T.id, u.team)) continue;
    const d = Math.hypot(u.ax - hall.x, u.ay - hall.y); if (d > 600) continue;
    str.set(u.team, (str.get(u.team) || 0) + u.members.length / (1 + d / 150));
  }
  let best = -1, bs = 0; for (const [t, v] of str) if (v > bs) { bs = v; best = t; }
  return best;
}
