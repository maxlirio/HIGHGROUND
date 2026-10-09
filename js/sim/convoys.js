// Supply convoys: villagers carry the army's bread. When an army is away from the stores, a few
// carters leave the village with a cart (or packhorses) of grain, walk to the army, hand it over
// (it goes into the army's baggage) and walk home. They're ordinary dots: they can be seen,
// caught and killed — cutting the convoys starves the army.
//
// Two clocks (clock.js): the carters' walk is drawn on the battle clock, but the army eats on the economic
// clock, so a 2 km haul "takes" ~20 econ days of rations. The drawn convoy stands for the relay of carts that
// would really ply the road over those days (the whole vale is inside one day's cart haul, §4): each
// convoy carries what the army will eat until the NEXT one can reach it — the round trip plus a margin —
// and a new convoy sets out as soon as the last one has delivered (it need not wait for the empty carts).
// Cut the road, catch the carters, or empty the granary, and the army is back on its baggage.
import { issueOrder, splitUnit, mergeUnits, TICK } from "./world.js";
import { E, take, give, homeUnit, foodStock, dailyFoodNeed } from "./economy.js";
import { horsesOf } from "./logistics.js";
import { S_FLEE } from "./soldiers.js";
import { ARMS } from "./arms.js";
import { BATTLE_RATE, ECON_DAYS_PER_REAL_SEC } from "./clock.js";

const CARTERS = 3, EVERY = 50, DAYS_WANTED = 8; // econ-days of margin beyond the round trip
// econ-days for the carters to walk d metres at their quick pace
const tripDays = (d) => d / (ARMS.villager.speed * 1.5 * BATTLE_RATE) * ECON_DAYS_PER_REAL_SEC;

export function convoySystem(w) {
  if (!w.econ || w.battleOnly || w.tick % EVERY) return;
  w.convoys ||= [];
  // dispatch
  for (const u of w.units.values()) {
    if (u.isWorkers || !u.members.length || u.supplyMode !== "line" || u.arm === "scouts") continue; // outriders live off the land and ride home
    if (w.convoys.some((c) => c.to === u.id && c.phase === "out")) continue; // one on the road at a time
    const T = w.teams[u.team], s = (u.supply ||= { food: 0, arrows: 0, carts: 0, packhorses: 0 });
    const perDay = u.members.length * E.rations.soldier + horsesOf(u) * E.horse.grainWork;
    const home = homeUnit(w, u.team); if (!home || home.members.length < CARTERS + 4 || T.besieged) continue;
    const want = perDay * (DAYS_WANTED + 2 * tripDays(Math.hypot(u.ax - home.ax, u.ay - home.ay)));
    if (s.food >= want * 0.6) continue; // baggage still well stocked
    const useCart = (T.store.carts || 0) >= 1, packs = Math.min(3, Math.floor(T.store.packhorses || 0));
    if (!useCart && !packs) continue;
    const grain = (T.store.grain || 0) + (T.store.sheaves || 0);
    // the vill keeps bread for itself: a fortnight's (a month's before the harvest is in) never goes to the army
    const reserve = dailyFoodNeed(w, u.team) * (T.harvestTime || (((w.econ.doy) % 365) + 365) % 365 > 240 ? 14 : 30);
    const load = Math.min(want - s.food, (foodStock(T) - reserve) * 0.5, grain);
    if (load < perDay * 0.5) continue;
    const g = take(T, "grain", load); take(T, "sheaves", load - g); take(T, useCart ? "carts" : "packhorses", useCart ? 1 : packs);
    const crew = splitUnit(w, home, home.members.slice(-CARTERS));
    crew.isWorkers = true; crew.away = true; crew.awayUntil = Infinity; crew.convoy = true; crew.job = null;
    const c = { id: crew.id, to: u.id, team: u.team, load, cart: useCart, packs: useCart ? 0 : packs, phase: "out", home: { x: home.ax, y: home.ay } };
    w.convoys.push(c);
    issueOrder(w, [crew.id], { kind: "move", x: u.ax, y: u.ay, pace: "quick", formation: "column", immediate: true });
    crew.away = true; crew.awayUntil = Infinity; // issueOrder set a player timeout — carters are on duty
    w.log.push({ t: w.tick, kind: "convoy-out", team: u.team, unit: u.id, kg: Math.round(load) });
  }
  // progress
  for (const c of w.convoys) {
    const crew = w.units.get(c.id);
    if (!crew || !crew.members.length) { if (c.phase === "out") w.log.push({ t: w.tick, kind: "convoy-lost", team: c.team, unit: c.to }); c.phase = "gone"; continue; }
    const S = w.S; const fled = crew.members.every((id) => S.state[id] === S_FLEE);
    if (c.phase === "out") {
      const army = w.units.get(c.to);
      if (!army || fled) { c.phase = "back"; issueOrder(w, [crew.id], { kind: "move", x: c.home.x, y: c.home.y, pace: "quick", immediate: true }); crew.awayUntil = Infinity; continue; }
      if (Math.hypot(crew.ax - army.ax, crew.ay - army.ay) < 60) { // (a column on the march is strung out: the tail will do)
        (army.supply ||= { food: 0 }).food += c.load; c.load = 0;
        c.phase = "back"; issueOrder(w, [crew.id], { kind: "move", x: c.home.x, y: c.home.y, pace: "march", immediate: true }); crew.awayUntil = Infinity;
        w.log.push({ t: w.tick, kind: "convoy-delivered", team: c.team, unit: c.to });
      } else if (!crew.path || Math.hypot((crew.order?.x ?? 0) - army.ax, (crew.order?.y ?? 0) - army.ay) > 120) { // got where the army was, or it moved on: follow
        issueOrder(w, [crew.id], { kind: "move", x: army.ax, y: army.ay, pace: "quick", formation: "column", immediate: true }); crew.away = true; crew.awayUntil = Infinity; }
    } else if (c.phase === "back" && !crew.path && Math.hypot(crew.ax - c.home.x, crew.ay - c.home.y) >= 60) {
      issueOrder(w, [crew.id], { kind: "move", x: c.home.x, y: c.home.y, pace: "march", immediate: true }); crew.away = true; crew.awayUntil = Infinity; // stopped short: go on home
    } else if (c.phase === "back" && Math.hypot(crew.ax - c.home.x, crew.ay - c.home.y) < (crew.path ? 30 : 60)) {
      const T = w.teams[c.team]; give(T, c.cart ? "carts" : "packhorses", c.cart ? 1 : c.packs || 1);
      give(T, "grain", c.load); c.load = 0; // an undelivered load (the army was gone) comes back to the store
      crew.convoy = false; crew.away = false; crew.awayUntil = 0;
      const home = homeUnit(w, c.team); if (home && home !== crew) mergeUnits(w, [home, crew]);
      c.phase = "home";
    }
  }
  w.convoys = w.convoys.filter((c) => c.phase !== "home" && c.phase !== "gone");
}
