// The enemy general: a strategic AI that runs a town and an army with no more knowledge than a
// real lord would have. It knows the geography (map features, where the other vill lies) but it
// only knows the ENEMY'S ARMY from what its own men have seen (fog-of-war grid from vision.js);
// sightings are remembered and age. Battles are handed to commandBattle (commander-ai.js).
//
// Town priorities follow the research's realities: May is the hungry gap (gardens, fish, buy
// grain), a granary before harvest, every hand in the fields when the corn is ripe, levies only
// out of harvest unless the enemy is at the gate, timber stockpiled before a palisade, arms made
// from what the smithy and fletcher can actually produce, and an army that marches with baggage.
import { placeOnPlan, bestSlot, stageStatus, unlocked } from "./townplan.js";
import * as LE from "./estates.js"; // the late game's great buildings (js/sim/estates.js)
import * as SI from "./siting.js";
import * as DM from "./demolish.js"; // (pulling down; palisades rebuilt in stone in their place)
import { ARMS } from "./arms.js";
import * as PR from "./prospect.js"; // (prospecting for a new vein when the house's own are worked out: js/sim/prospect.js)
import { issueOrder, mergeUnits, COLUMN_STEP } from "./world.js";
import { findPath, routeCost } from "./path.js";
import { reeveBridges } from "./bridges.js";
import { analysePoint } from "./analysis.js";
import { canSee } from "./vision.js";
import { commandBattle } from "./commander-ai.js";
import { DISPOSITIONS } from "./legend.js";
import * as EC from "./economy.js";
import * as LB from "./labor.js"; // (the stores the carriers take loads to)
import * as TC from "./tech.js"; // research (docs/tech.md)
import { seatGuard } from "./towns.js"; // (a house with daughter towns: its lord and reeve work the seat — js/sim/towns.js)
import { E, BUILDINGS, RECIPES, ROLE, ROLES } from "./economy.js";
import { storeCrews } from "./jobs/haulage.js"; // (lane D: storemen)
import { crews as fieldCrews, firstHarvest, prospect, sowFallow, pickFieldRect, layField, fieldRect } from "./jobs/fields.js"; // (lane A: ploughing, sowing, carting the stooks; the food watch)
import { loadBaggage, baggageDays, strengthNear, nearestFoodStore } from "./logistics.js";
import { nearestNode } from "./resources.js";
import { engineOf, ENG } from "./siege.js";
import { gateGeom } from "./features.js";
import * as TW from "./townwall.js"; // a walled vill mans its walls when the enemy comes (bows first)
import { isFoe, sides } from "./sides.js";
import * as GD from "./gold.js"; // gold: the money-changer and the hired companies (js/sim/gold.js)
import * as IN from "./income.js"; // a manor's income: the reeve sells the surplus at the market (js/sim/income.js)
import { MERCS, mercHire, mercDay } from "./econ-data.js";
import * as RL from "./reeve-learn.js"; // the learning reeve: he copies how the player runs his vill (js/sim/reeve-learn.js)

const TPD = Math.round(1 / EC.DT); // ticks per econ day (400)

export function makeGeneral(w, team, { difficulty = 0.7, disposition = "inspiring", V = null, research = true } = {}) {
  const T = w.teams[team], foeId = pickFoe(w, team), foe = w.teams[foeId]; // (two teams: the other; more — the realm: the nearest house at war with us)
  const D = DISPOSITIONS[disposition] || DISPOSITIONS.inspiring;
  const G = {
    team, foe: foeId, difficulty, disposition, D, V,
    mode: "home", intel: new Map(), army: new Set(), scouts: new Set(), log: [],
    enemyTown: foe?.town ? { ...foe.town } : { x: w.map.cx ?? w.map.size / 2, y: w.map.cy ?? w.map.size / 2 }, // common knowledge: everyone knows where Rookham lies
    econEvery: Math.round(100 + (1 - difficulty) * 200), milEvery: Math.round(20 + (1 - difficulty) * 40),
    attackRatio: 1.9 - 0.7 * D.aggression - 0.2 * difficulty,
    campaignDay: E.startDoy + 30 + (1 - D.aggression) * 20,
    fortifyDay: E.startDoy + (D.aggression > 0.7 ? 45 : 18),
    prior: 0, sites: [], lastBattleTick: -1e9, battles: 0,
    research, // (the lord studies at his keep: js/sim/tech.js — tools/playtest.mjs turns it off unless --research)
  };
  G.prior = militaryStrength(w, team, [...w.units.values()].filter((u) => u.team === team && !u.isWorkers)); // rumour: "they are about as strong as we are"
  return G;
}

// The house this lord makes war on. Two teams: the other one (as it always was). More (the realm): the nearest vill of a
// house at war with ours (js/sim/sides.js) that still stands — a shielded (protected) house is nobody's foe.
export function pickFoe(w, team) {
  if (w.teams.length <= 2) return 1 - team;
  const me = w.teams[team]?.town; let best = -1, bd = Infinity;
  for (const T of w.teams) {
    if (T.id === team || T.fallen || !T.town || !T.store || !isFoe(w, team, T.id)) continue;
    const d = me ? Math.hypot(T.town.x - me.x, T.town.y - me.y) : T.id; if (d < bd) { bd = d; best = T.id; }
  }
  return best;
}
const foeStands = (w, G) => { const T = w.teams[G.foe]; return !!T && !T.fallen && (w.teams.length <= 2 || isFoe(w, G.team, G.foe)); };
// the foe fell, or made peace: another house at war with us, if there is one (what we knew of the old one is dropped)
function retarget(w, G) {
  if (w.teams.length <= 2) return false;
  const f = pickFoe(w, G.team); if (f < 0) return false;
  G.foe = f; G.enemyTown = { ...w.teams[f].town }; G.seenWalls = new Set(); G.sawTown = undefined; G.siegeCamp = null;
  if (G.mode === "march" || G.mode === "siege" || G.mode === "battle") { G.mode = "return"; G.retreating = true; }
  note(w, G, `turns against ${w.teams[f].name || "house " + f}`);
  return true;
}

export function generalThink(w, G) {
  const sg = !G.town && seatGuard(w, G.team, () => generalThink(w, G)); if (sg) return sg.r;
  const T = w.teams[G.team];
  if (T.fallen || !T.store) return;
  if ((w.tick + G.team * 37) % G.econEvery === 0) econThink(w, G);
  if ((w.tick + G.team * 11) % G.milEvery === 0) milThink(w, G);
  if (G.mode === "battle" && w.tick < (G.assaultUntil || 0) && w.tick % 20 === 0 && armyUnits(w, G).some((u) => u.hold)) G.assaultUntil = w.tick; // closed: the battle commander has it again
  if ((G.mode === "battle" || G.mode === "defend") && !(w.tick < (G.assaultUntil || 0))) { commandBattle(w, G.cmd); if ((w.tick + G.team) % 200 === 0) magic(w, G); }
}

// The realm's WARDEN (server/houses.mjs): a player's house while its lord is away. His captains and this steward
// defend: the companies hold at home and meet a threat before the keep, or man the walls when outnumbered (milThink's
// defend / garrison); the villagers come in to the keep while an enemy is near (T.shelter stops the reeve sending them
// out). He never marches on anyone, never stands men down, and runs no economy (the reeve does).
export function wardenThink(w, G) {
  const sg = !G.town && seatGuard(w, G.team, () => wardenThink(w, G)); if (sg) return sg.r;
  const T = w.teams[G.team];
  if (T.fallen || !T.store) return;
  if ((w.tick + G.team * 11) % G.milEvery === 0) {
    milThink(w, G);
    const hall = hallOf(w, G.team), near = !!(G.threat && hall && Math.hypot(G.threat.x - hall.x, G.threat.y - hall.y) < 1000);
    if (near && !T.shelter) { // mortal danger: everyone in — the crews on the player's own work too, said so, and sent back to it after
      T.shelter = true; const held = [];
      for (const u of EC.workerUnits(w, G.team)) if (u.job?.kind !== "home" && !u.convoy) { if ((u.ordered || u.broad) && u.job) held.push({ job: u.job, n: u.members.length, broad: u.broad ? { ...u.broad } : null }); u.broad = null; EC.releaseWorkers(w, u); }
      T.shelterHeld = held; note(w, G, "the villagers are brought in to the keep");
      if (held.length) say(w, G, `Your warden brings the villagers in to the keep — raiders are near. The ${held.reduce((s, h) => s + h.n, 0)} at the work you set them come in too; they go back to it when the danger passes`, "bad", hall);
    }
    else if (!near && T.shelter) { T.shelter = false; note(w, G, "the villagers go back out to work"); const k = backToWork(w, G, T); if (k) say(w, G, `The danger has passed: ${k} villagers go back to the work you set them`, "good", hall); }
  }
  if ((G.mode === "battle" || G.mode === "defend") && G.cmd) commandBattle(w, G.cmd);
}

// after the warden's shelter: the crews that were on the player's own work go back to it (the same work, the same number of hands)
function backToWork(w, G, T) {
  let k = 0;
  for (const h of T.shelterHeld || []) {
    const j = h.job, ok = j.node ? j.node.amount > 0 && (w.resources || []).includes(j.node) : j.b ? !j.b.ruin && w.buildings.includes(j.b) : false;
    if (!ok) continue;
    const crew = EC.assignWorkers(w, G.team, j, h.n); if (!crew) break;
    if (h.broad) crew.broad = h.broad; else crew.ordered = true;
    k += crew.members.length;
  }
  T.shelterHeld = null;
  return k;
}

// Rare mana: steady a wavering unit, or close wounds once the fighting slackens.
function magic(w, G) {
  const T = w.teams[G.team]; if (T.store.mana < 12) return;
  for (const id of G.cmd.units) {
    const u = w.units.get(id); if (!u || !u.members.length) continue;
    if (u.state === "wavering" && EC.castSpell(w, G.team, "bless", u.ax, u.ay)) { note(w, G, "an adept's blessing steadies the line"); return; }
  }
}

const note = (w, G, msg) => { G.log.push({ tick: w.tick, day: w.econ.doy, msg }); };
const str = (u) => u.members.length * (1 + ARMS[u.arm].armour * 0.3) * (ARMS[u.arm].mounted ? 1.6 : 1) * (ARMS[u.arm].missile ? 1.2 : 1);
const militaryStrength = (w, team, units) => units.reduce((s, u) => s + str(u), 0);
const hallOf = (w, team) => w.buildings.find((b) => b.id === w.teams[team].hall);

// ═════════════════════════════════════════════════════════════════ ECONOMY
export const LORD_HOOKS = []; // extra thoughts of an AI lord's at his econ think: f(w, G, ctx)
function econThink(w, G) {
  const team = G.team, T = w.teams[team], doy = w.econ.doy;
  const need = EC.dailyFoodNeed(w, team), foodDays = EC.foodStock(T) / Math.max(1, need);
  const ctx = { T, doy, need, foodDays, hall: hallOf(w, team), watch: foodWatch(w, team, T, need, true) };
  for (const h of LORD_HOOKS) h(w, G, ctx); // (js/sim/founding.js: a prosperous lord sends settlers out to found a second town)
  larder(w, G, ctx);
  planBuilding(w, G, ctx);
  allocateLabour(w, G, ctx);
  setProduction(w, G, ctx);
  tradeGoods(w, G, ctx);
  lordGold(w, G, ctx);
  recruit(w, G, ctx);
  research(w, G, ctx);
}

// ═════════════════════════════════════════════════════════════════ RESEARCH (js/sim/tech.js, docs/tech.md)
// One study at a time (two with the scriptorium), in the order of interest his disposition gives, and only when the vill
// can spare it: a month's food in store, not invested, silver left over beyond a reserve of a month's wages (≥ 4000 d),
// and twice the study's materials in store, with 15 t of timber and stone left for the builders after paying.
const BUILD_STOCK = { timber: 15000, stone: 15000 };
const STUDY_FIRST = ["clerks", "heavy_plough", "staddles", "collier"];
const STUDY = {
  defend: ["tile_roofs", "jettied", "marling", "pike_drill", "lime_mortar", "banners", "assize", "roads", "machicolations", "water_saw", "fleece", "horse_collar", "scriptorium", "concentric", "crossbow_shop", "water_bellows", "drawn_wire"],
  attack: ["pike_drill", "marling", "tiltyard", "assize", "banners", "crossbow_shop", "counterweight", "water_bellows", "drawn_wire", "sapping", "jettied", "horse_collar", "scriptorium", "roads", "coat_of_plates"],
  steady: ["marling", "jettied", "pike_drill", "assize", "water_saw", "horse_collar", "fleece", "tile_roofs", "scriptorium", "banners", "roads", "lime_mortar", "crossbow_shop", "water_bellows", "drawn_wire"],
};
export function studyOrder(G) {
  const key = G.D.aggression >= 0.7 ? "attack" : G.D.seeksHighGround >= 0.9 ? "defend" : "steady";
  const seen = new Set(), out = [];
  for (const id of [...STUDY_FIRST, ...STUDY[key], ...TC.TECH_IDS]) if (!seen.has(id) && TC.TECHS[id]) { seen.add(id); out.push(id); }
  return out;
}
function research(w, G, { T, foodDays }) {
  if (G.research === false || T.besieged || T.fallen || foodDays < 30) return;
  const S = TC.techState(T);
  if (S.active.length >= TC.desks(w, G.team)) return;
  const reserve = Math.max(4000, (T.day.wages || 0) * 30);
  for (const id of studyOrder(G)) {
    if (S.done[id] || S.active.some((a) => a.id === id) || TC.whyNot(w, G.team, id)) continue;
    const c = TC.TECHS[id].cost;
    if ((T.store.silver || 0) - (c.silver || 0) < reserve) return; // (saving up for it: he does not skip to a cheaper one)
    if (Object.entries(c).some(([r, n]) => r !== "silver" && (T.store[r] || 0) - n < Math.max(n, BUILD_STOCK[r] || 0))) continue; // (the builders' timber and stone come first)
    if (TC.start(w, G.team, id)) { note(w, G, `studies ${TC.TECHS[id].name}`); return; }
  }
}

function sitesUnderWay(w, team) { return w.buildings.filter((b) => b.team === team && b.progress < 1 && !b.ruin); }
const count = (w, team, kind, done = false) => w.buildings.filter((b) => b.team === team && b.kind === kind && !b.ruin && (!done || b.progress >= 1)).length;

function planBuilding(w, G, { T, doy, hall, foodDays }) {
  const team = G.team, under = sitesUnderWay(w, team);
  const labour = EC.headcount(w, team).labour;
  if (under.length >= (labour > 110 ? 4 : labour > 70 ? 3 : 2)) return;
  const pop = T.dependants + EC.headcount(w, team).labour + EC.headcount(w, team).soldiers + T.squires;
  const threat = G.threat || doy > G.fortifyDay;
  const wood = nearestNode(w, hall.x, hall.y, (n) => n.kind === "wood" || n.kind === "coppice");
  const quarry = nearestNode(w, hall.x, hall.y, (n) => n.kind === "quarry", 2500);
  const ore = nearestNode(w, hall.x, hall.y, (n) => n.kind === "bog_iron", 2500);
  const want = [];
  if (!count(w, team, "granary") && (((doy) % 365) + 365) % 365 < 205) want.push(["granary"]);
  if (!count(w, team, "market")) want.push(["market"]);
  if (EC.housing(w, team) - pop < 6 && !T.harvestTime) want.push(["house"]);
  if (wood && Math.hypot(wood.x - hall.x, wood.y - hall.y) > 300 && !w.buildings.some((b) => b.team === team && b.kind === "lumber_camp" && !b.ruin && Math.hypot(b.x - wood.x, b.y - wood.y) < 200)) want.push(["lumber_camp", towards(wood, hall, 40)]);
  if (!count(w, team, "fletcher")) want.push(["fletcher"]);
  if (!count(w, team, "stables")) want.push(["stables"]);
  if (!count(w, team, "archery_range")) want.push(["archery_range"]);
  if (threat && G.difficulty > 0.2) want.push(["palisade"]);
  if (wood && !count(w, team, "charcoal_kiln")) want.push(["charcoal_kiln", towards(wood, hall, 30)]);
  if (!count(w, team, "barracks")) want.push(["barracks"]);
  if (!count(w, team, "paddock") && T.store.horses + T.store.destriers > 4) want.push(["paddock"]);
  // an engine yard once the muster hall stands: a lord who means to take a walled vill needs rams, ladders and
  // stone-throwers, and a vill that may be besieged wants springalds on its own walls
  if (count(w, team, "barracks", true) && !count(w, team, "siege_workshop") && (G.D.aggression >= 0.4 || foeWalls(w, G) || G.threat)) want.push(["siege_workshop"]);
  if (!count(w, team, "watchtower")) want.push(["watchtower", lookout(w, G, hall)]);
  if (ore && !count(w, team, "bloomery")) want.push(["bloomery", towards(ore, hall, 60)]);
  if (quarry && Math.hypot(quarry.x - hall.x, quarry.y - hall.y) > 400 && !count(w, team, "mining_camp")) want.push(["mining_camp", towards(quarry, hall, 40)]);
  if (G.D.seeksHighGround >= 0.6 && count(w, team, "palisade", true) >= 10 && !count(w, team, "stone_wall")) want.push(["stone_wall"]);
  if (w.plans) {
    // a vill built from nothing: fields to eat, then cottages so families settle (migration fills empty houses)
    const cap = EC.housing(w, team), pop = T.dependants + EC.headcount(w, team).labour + EC.headcount(w, team).soldiers;
    if (cap - pop < 12) want.unshift(["house"]);
    // enough ARABLE to eat (the map's furlongs vary in size: ~72 ha, what 8 of the old square plots held)
    if (w.buildings.reduce((s, b) => s + (b.team === team && b.field && !b.ruin ? b.field.ha : 0), 0) < 72) want.unshift(["field"]);
  }
  greatWorks(w, G, T, want, foodDays, under); // (the late game: js/sim/estates.js)
  for (const [kind, at] of want) {
    if (under.filter((b) => b.kind === kind).length >= (kind === "house" ? (labour > 110 ? 2 : 1) : 1)) continue;
    if (kind === "palisade" || kind === "stone_wall") { if (placeRing(w, G, kind, hall)) return; continue; }
    const need = EC.costOf(kind);
    if (!EC.canAfford(T, need)) { G.wantTimber = Math.max(G.wantTimber || 0, need.timber || 0); G.wantStone = Math.max(G.wantStone || 0, need.stone || 0); continue; }
    if (w.plans) { // the vill grows on its plan: pick the nearest free plot (or the resource it serves)
      const near = at || hall, s = bestSlot(w, team, kind, near);
      const r = placeOnPlan(w, team, kind, s ? s.x : near.x, s ? s.y : near.y);
      if (r.b) { note(w, G, `builds ${BUILDINGS[kind].name}`); return; }
      continue;
    }
    const p = at ? freeSpot(w, at.x, at.y, kind, 0, 60) : freeSpot(w, hall.x, hall.y, kind, 60, 190);
    if (!p) continue;
    const b = EC.placeBuilding(w, team, kind, p.x, p.y, 0, false);
    if (b) { note(w, G, `builds ${BUILDINGS[kind].name}`); return; }
  }
}

// THE LATE GAME (js/sim/estates.js; stages 4–6 in js/sim/stages.js): a lord whose vill is a Town raises the great buildings, ONE at a
// time, in the order that opens the next stage — the barn and the motte, stone on the circuit, the guildhall and
// the hospital, the shell keep on the motte, the mint, the tiltyard, the college and the minster, then the palace and the
// concentric castle. Only with a season's food in store and, after the building's silver, a reserve of two months' wages; a
// great work is wanted LAST (after the cottages, the fields and the yards), and its stone is saved for it (tradeGoods).
const GREAT_WORKS = ["tithe_barn", "motte", "stone_wall", "guildhall", "hospital", "shell_keep", "mint", "lists", "university", "cathedral", "palace", "concentric_castle"];
const LATE = new Set(GREAT_WORKS.filter((k) => k !== "stone_wall"));
export function greatWorks(w, G, T, want, foodDays, under) { // (exported for tools/estates-test.mjs)
  const team = G.team, st = stageStatus(w, team).reached;
  if (G.wantGold) G.wantGold = 0;
  if (st < 3 || G.greatWorks === false || foodDays < 60 || T.besieged || under.some((b) => LATE.has(b.kind))) return;
  const reserve = Math.max(4000, (T.day?.wages || 0) * 60);
  for (const kind of GREAT_WORKS) {
    if (!unlocked(w, team, kind) || LE.estateWhy(w, team, kind)) continue;
    if (kind === "stone_wall") { if (count(w, team, "stone_wall") < 2 && !under.some((b) => b.kind === "stone_wall")) { want.push(["stone_wall"]); return; } continue; }
    if (count(w, team, kind)) continue;
    if (kind === "tithe_barn" && count(w, team, "granary", true) && EC.foodStock(T) < 50000) continue; // (a barn when the granary is full)
    const need = EC.costOf(kind);
    if (need.gold) G.wantGold = need.gold; // (the minster's shrine, the palace's gilding: the changer sells him the gold — lordGold)
    if ((T.store.silver || 0) - (need.silver || 0) < reserve) return; // (saving for it: not skipping to a lesser work)
    G.wantStone = Math.max(G.wantStone || 0, need.stone || 0); G.wantTimber = Math.max(G.wantTimber || 0, need.timber || 0);
    const base = LE.UPGRADES[kind] ? w.buildings.find((b) => b.team === team && b.kind === LE.UPGRADES[kind] && b.progress >= 1 && !b.ruin) : null;
    want.push([kind, base ? { x: base.x, y: base.y } : null]);
    return;
  }
}

const towards = (a, b, d) => { const l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return { x: a.x + (b.x - a.x) / l * d, y: a.y + (b.y - a.y) / l * d }; };

function lookout(w, G, hall) {
  // the highest ground within 500 m on the enemy's side of the vill
  const dir = Math.atan2(G.enemyTown.y - hall.y, G.enemyTown.x - hall.x);
  let best = null, bh = -Infinity;
  for (let r = 150; r <= 500; r += 70) for (let a = -0.8; a <= 0.8; a += 0.2) {
    const x = hall.x + Math.cos(dir + a) * r, y = hall.y + Math.sin(dir + a) * r;
    if (!w.map.inBounds(x, y) || w.map.water(x, y) > 0.02) continue;
    const h = w.map.h(x, y) - r * 0.01; if (h > bh) { bh = h; best = { x, y }; }
  }
  return best;
}

function freeSpot(w, cx, cy, kind, r0, r1) {
  const def = BUILDINGS[kind], fp = def.footprint || [10, 10], rad = Math.hypot(...fp) / 2;
  for (let k = 0; k < 160; k++) {
    const a = k * 2.399 + cx * 0.001, r = r0 + (r1 - r0) * ((k * 0.618) % 1);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (!w.map.inBounds(x, y) || w.map.water(x, y) > 0.01 || Math.hypot(...w.map.grad(x, y)) > 0.18) continue;
    let ok = true;
    for (const b of w.buildings) {
      if (b.ruin) continue;
      if (b.field) { const fr = b.rot || 0, c = Math.cos(fr), s = Math.sin(fr), dx = x - b.x, dy = y - b.y, lx = dx * c + dy * s, ly = dy * c - dx * s; if (Math.abs(lx) < b.w / 2 + rad && Math.abs(ly) < b.h / 2 + rad) { ok = false; break; } continue; }   // (the field's own frame: furlongs lie at their survey axis)
      if (b.x1 !== undefined) continue;
      const br = Math.hypot(...(BUILDINGS[b.kind].footprint || [8, 8])) / 2;
      if (Math.hypot(b.x - x, b.y - y) < rad + br + 4) { ok = false; break; }
    }
    if (ok && !(w.resources || []).some((n) => Math.hypot(n.x - x, n.y - y) < n.r + rad)) return { x, y };
  }
  return null;
}

// Palisade ring round the keep, church and workshops (≈75 m radius, a bailey not the whole vill);
// one gap facing away from the enemy takes the gate. Segments are placed as timber allows.
function placeRing(w, G, kind, hall) {
  const T = w.teams[G.team];
  if (w.plans?.[G.team]) { // wall the village as it stands (js/sim/siting.js suggestCircuit), the stretches facing the enemy first
    const E = G.enemyTown, circ = SI.suggestCircuit(SI.siteContext(w, G.team));
    if (circ.error) return false;
    const mid = (s) => ({ x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 });
    const walls = (kind === "stone_wall"
      ? w.buildings.filter((b) => b.team === G.team && b.kind === "palisade" && !b.ruin && b.x1 !== undefined).map((b) => ({ x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, id: b.id }))
      : circ.stretches.filter((s) => !s.gate && s.state === "open"))
      .map((s) => ({ ...mid(s), s })).sort((a, b) => Math.hypot(a.x - E.x, a.y - E.y) - Math.hypot(b.x - E.x, b.y - E.y) || a.x - b.x || a.y - b.y);
    // the gate goes up with the first stretches, not after the whole circuit: it is what the next stage
    // (the stockaded village: muster hall, smithy, butts, stables) waits for
    const g0 = circ.stretches.find((s) => s.gate && s.state === "open"), gate = g0 ? mid(g0) : null;
    if (gate && kind === "palisade" && count(w, G.team, "palisade") >= 3 && !count(w, G.team, "gate")) { const r = placeOnPlan(w, G.team, "gate", gate.x, gate.y); if (r.b) { note(w, G, "hangs a gate"); return true; } }
    const pick = walls[0];
    if (pick) { const r = placeOnPlan(w, G.team, kind, pick.x, pick.y); if (r.b) { note(w, G, `raises ${BUILDINGS[kind].name}`); return true; } return false; }
    if (gate && kind === "palisade") { const r = placeOnPlan(w, G.team, "gate", gate.x, gate.y); if (r.b) { note(w, G, "hangs a gate"); return true; } }
    return false;
  }
  const R = kind === "stone_wall" ? 88 : 75, N = 12;
  const away = Math.atan2(hall.y - G.enemyTown.y, hall.x - G.enemyTown.x);
  G.ring ||= {};
  const done = (G.ring[kind] ||= new Set());
  const order = [...Array(N).keys()].map((k) => ({ k, a: away + (k + 0.5) * 2 * Math.PI / N })).sort((p, q) => Math.abs(Math.cos(q.a - away)) - Math.abs(Math.cos(p.a - away)));
  // stone: only the three segments facing the enemy
  const segs = kind === "stone_wall" ? order.filter((s) => Math.cos(s.a - away) < -0.7) : order;
  for (const s of segs.reverse()) {
    if (s.k === N - 1 && kind === "palisade") continue; // the gap
    if (done.has(s.k)) continue;
    const a0 = away + s.k * 2 * Math.PI / N, a1 = away + (s.k + 1) * 2 * Math.PI / N;
    const x1 = hall.x + Math.cos(a0) * R, y1 = hall.y + Math.sin(a0) * R, x2 = hall.x + Math.cos(a1) * R, y2 = hall.y + Math.sin(a1) * R;
    const len = Math.hypot(x2 - x1, y2 - y1), need = EC.costOf(kind, len);
    if (!EC.canAfford(T, need)) { G.wantTimber = Math.max(G.wantTimber || 0, (need.timber || 0) * 2); G.wantStone = Math.max(G.wantStone || 0, need.stone || 0); return false; }
    const b = EC.placeWall(w, G.team, kind, x1, y1, x2, y2);
    if (b) { done.add(s.k); note(w, G, `raises ${BUILDINGS[kind].name} segment ${done.size}`); return true; }
  }
  if (kind === "palisade" && done.size >= N - 1 && !G.gatePlaced) {
    const a = away + (N - 0.5) * 2 * Math.PI / N;
    const a0 = away + (N - 1) * 2 * Math.PI / N, a1 = away + N * 2 * Math.PI / N;
    const gb = EC.canAfford(T, EC.costOf("gate")) && EC.placeBuilding(w, G.team, "gate", hall.x + Math.cos(a) * R, hall.y + Math.sin(a) * R, a + Math.PI / 2);
    if (gb) { Object.assign(gb, { gx1: hall.x + Math.cos(a0) * R, gy1: hall.y + Math.sin(a0) * R, gx2: hall.x + Math.cos(a1) * R, gy2: hall.y + Math.sin(a1) * R }); G.gatePlaced = true; note(w, G, "hangs the gate"); return true; }
  }
  return false;
}

// ───────────────────────────────────────────────────────── labour allocation
// The reeve for the player's village: runs only the daily-work allocation, never building or war.
export function reeveThink(w, G, force = false) {
  const sg = !G.town && seatGuard(w, G.team, () => reeveThink(w, G, force)); if (sg) return sg.r;
  const team = G.team, T = w.teams[team]; if (T.fallen || !T.store) return;
  if (!force && (w.tick + 5) % G.econEvery !== 0) return;
  if (T.shelter) return; // (the realm's warden has the villagers in the keep: nobody goes out to work until the danger passes)
  const need = EC.dailyFoodNeed(w, team), foodDays = EC.edibleStock(T) / Math.max(1, need);
  const ctx = { T, doy: w.econ.doy, need, foodDays, hall: hallOf(w, team), watch: foodWatch(w, team, T, need) };
  famineNews(w, G, ctx);
  reeveFields(w, G, ctx);
  larder(w, G, ctx);
  reeveMine(w, G, ctx);
  reeveCamps(w, G, ctx);
  reeveGranary(w, G, ctx);
  learnedBuild(w, G, ctx); // (the learning reeve: what the player builds at this point, he builds — js/sim/reeve-learn.js)
  reeveBridges(w, G); // (a river his men cannot get over near where they work: a timber bridge — js/sim/bridges.js)
  reeveCoin(w, G, ctx);
  IN.reeveSells(w, team, { red: !!ctx.watch?.red }); // (once a day: what is over the house's needs, at the market or carted to the market town)
  allocateLabour(w, G, ctx);
  setProduction(w, G, ctx);
}
// THE LEARNING REEVE BUILDS AS THE PLAYER DOES: when the book says that at a point like this the player builds a kind of
// building (buildWant: twice at least, in situations near this one, with no more of it than now), the reeve stakes one out
// where the player puts them — but never in a famine or a siege, never while the player is building himself (a build of
// his in the last 2 days), never more than one every 4 days, never with less than half as much again as it costs in store,
// and never walls, the keep or the church (those are where the player draws them).
function learnedBuild(w, G, { T, hall, watch }) {
  if (!hall || watch?.red || T.besieged || !RL.learning(T) || !T.reeveBook?.rows.length) return;
  const doy = w.econ.doy;
  if (doy - (G.learnBuildDay ?? -99) < 4 || doy - (G.learnTryDay ?? -99) < 1) return;
  G.learnTryDay = doy;
  const last = T.reeveBook.rows.findLast((r) => r.a.what === "build");
  if (last && (w.tick - last.t) * EC.DT < 2) return;
  if (w.buildings.filter((b) => b.team === G.team && b.progress < 1 && !b.ruin && !b.field).length >= 2) return;
  const want = RL.buildWant(w, G.team); if (!want) return;
  const cost = EC.costOf(want.kind);
  if (!Object.entries(cost).every(([r, n]) => (T.store[r] || 0) >= n * 1.5)) return;
  const r = placeOnPlan(w, G.team, want.kind, hall.x + want.dx, hall.y + want.dy);
  if (!r?.b) return;
  G.learnBuildDay = doy; r.b.byReeve = true;
  say(w, G, `Your reeve stakes out a ${BUILDINGS[want.kind].name.toLowerCase()}, as you do at this point in the year — pull it down if you would rather not`, "good", { x: r.b.x, y: r.b.y });
}
// THE BARN: grain beyond what the vill's stores hold lies in the open and rots at E.spoil.overflow (1 % a day — economy.js
// daily). When the corn in hand and coming in (the stores, the stooks, the standing harvest) outruns the stores' room, the
// reeve stakes a granary on the plan, one at a time. (Antiquis, an absentee's house, never had one: every harvest above
// the keep's 25 t lay rotting through the winter, and the vill went into the hungry gap with a month's bread.)
function reeveGranary(w, G, { T, hall, watch }) {
  if (!hall || T.besieged || (w.tick + G.team * 53) % 1200 > G.econEvery) return;
  const team = G.team; let cap = 0;
  for (const b of w.buildings) if (b.team === team && !b.ruin) { if ((b.kind === "granary" || b.kind === "tithe_barn") && b.progress < 1) return; if (EC.complete(b)) cap += BUILDINGS[b.kind].capacity?.grain || 0; }
  const coming = (T.store.grain || 0) + (T.store.sheaves || 0) + watch.stooks + watch.harvest;
  if (coming <= cap) return;
  if (!EC.canAfford(T, EC.costOf("granary"))) return;
  const s = bestSlot(w, team, "granary", hall), r = placeOnPlan(w, team, "granary", s ? s.x : hall.x, s ? s.y : hall.y);
  if (r?.b) { r.b.byReeve = true; say(w, G, `Your reeve stakes out a granary: the corn coming in (${Math.round(coming / 1000)} t) will not go in the stores we have (${Math.round(cap / 1000)} t), and grain in the open rots`, "good", { x: r.b.x, y: r.b.y }); }
}
// CAMPS BY THE WORK (the owner: "my men like take forever getting iron and stuff"): a crew of the house working a wood, a
// coppice, a quarry or an ore-bed whose nearest store is far off carries every load all that way — a 3-t lot of logs over a
// kilometre took a carrier ~7 econ days there and back. The reeve stakes a lumber camp (wood, coppice) or a mining camp
// (quarry, ore) beside the work, one at a time, when the house has twice its timber to spare; once it stands, the loads go
// into it (a store like any other). Never in a famine or a siege.
const CAMP_FAR = 300; // m from the work to its nearest store before a camp is worth it
const CAMP_OF = { wood: "lumber_camp", coppice: "lumber_camp", quarry: "mining_camp", bog_iron: "mining_camp" };
export function reeveCamps(w, G, { T, hall, watch }) { // (exported for tools/home-works-test.mjs)
  if (!hall || watch?.red || T.besieged || (w.tick + G.team * 71) % 600 > G.econEvery) return;
  const team = G.team;
  if (w.buildings.some((b) => b.team === team && (b.kind === "lumber_camp" || b.kind === "mining_camp") && b.progress < 1 && !b.ruin)) return; // (one at a time)
  for (const u of EC.workerUnits(w, team)) {
    const n = u.job?.kind === "gather" ? u.job.node : null, kind = n && CAMP_OF[n.kind]; if (!kind || u.members.length < 2 || !(n.amount > 0)) continue;
    const st = LB.nearestStore(w, team, u.job.res || n.res, n.x, n.y); if (st && Math.hypot(st.x - n.x, st.y - n.y) < CAMP_FAR) continue;
    if (!Object.entries(EC.costOf(kind)).every(([r, q]) => (T.store[r] || 0) >= q * 2)) continue;
    const d = Math.hypot(hall.x - n.x, hall.y - n.y) || 1, k = Math.min(50, d) / d;
    const r = placeOnPlan(w, team, kind, n.x + (hall.x - n.x) * k, n.y + (hall.y - n.y) * k);
    if (r?.b) { r.b.byReeve = true; say(w, G, `Your reeve stakes a ${BUILDINGS[kind].name.toLowerCase()} beside the ${NODE_WORD[n.kind]} ${Math.round(d)} m out: the loads go into it, not all the way home`, "good", { x: r.b.x, y: r.b.y }); return; }
  }
}
const NODE_WORD = { wood: "wood", coppice: "coppice", quarry: "quarry", bog_iron: "ore-bed" };
// the reeve stakes a mining camp at the nearest silver (then gold) vein within reach when there is none: the house's coin
const PRECIOUS_REACH = 3500;
// a vein's holder (js/sim/veins.js: v.holder — a hold's own vein from the start, claimed by a camp, taken by a flag);
// a vein no one has claimed yet is held by the house whose camp was staked there first
export function veinHolder(w, v) {
  if (Number.isInteger(v.holder) && v.holder >= 0) return v.holder;
  const camps = w.buildings.filter((b) => b.kind === "mining_camp" && !b.ruin && Math.hypot(b.x - v.x, b.y - v.y) < 260);
  if (v.holder != null && camps.some((b) => b.team === v.holder)) return v.holder;
  let h = null; for (const b of camps) if (!h || b.id < h.id) h = b; return h ? h.team : null;
}
function reeveMine(w, G, { T, hall, watch }) {
  if (!hall || watch?.red || (w.tick + G.team * 97) % 600 > G.econEvery) return;
  const team = G.team, cash = (T.store.silver || 0) + (T.store.gold || 0) * 12;
  if (!((T.arrears || 0) > 0 || cash < Math.max(2000, (T.day?.wages || 0) * 40))) return; // (only when the chest runs short)
  for (const vk of ["silver_vein", "gold_vein"]) {
    const v = nearestNode(w, hall.x, hall.y, (n) => n.kind === vk && n.amount > 1 && (veinHolder(w, n) ?? team) === team, PRECIOUS_REACH); if (!v) continue;
    if (veinHolder(w, v) === team && w.buildings.some((b) => b.team === team && b.kind === "mining_camp" && !b.ruin && Math.hypot(b.x - v.x, b.y - v.y) < 260)) continue; // (ours, with its camp: worked in allocateLabour; ours with none — the house's own vein — gets one)
    if (!EC.canAfford(T, EC.costOf("mining_camp"))) return;
    const d = Math.hypot(hall.x - v.x, hall.y - v.y) || 1, k = Math.min(40, d) / d;
    const r = placeOnPlan(w, team, "mining_camp", v.x + (hall.x - v.x) * k, v.y + (hall.y - v.y) * k);
    if (r?.b) v.holder = team;
    if (r?.b) note(w, G, `Your reeve stakes a mining camp at the ${vk === "gold_vein" ? "gold" : "silver"} vein, ${Math.round(d)} m out: coin for the wages`);
    return;
  }
}

// ═════════════════════════════════════════════════════════════════ THE FOOD WATCH
// The reeve never lets a house that is free to feed itself starve through neglect. Every think he reckons the food in
// hand — grain, sheaves, seed, the larder, and the stooks still standing in the fields — in days of the vill's need, and
// adds the coming harvest when the stores will carry the vill to it. Below FOOD_HORIZON days (or the moment rations run
// short) the watch is RED: food work outranks walls and crafts (allocateLabour), the flocks are slaughtered for the larder,
// grain is bought if the vill has a market, and the chronicle says so. Starvation itself is untouched (economy.js daily):
// a house cut off from its food — besieged, encircled, its fields burnt — starves exactly as it always did.
const FOOD_HORIZON = 60;        // econ days of food the reeve wants in sight
const FIELD_NET_KG_HA = 420;    // kg a hectare of the vill's open fields feeds it a year, net of seed, over the three-field rotation (≈ ⅔ × (870 − 170)) EST
const FIELD_MIN_HA = 72;        // what the AI lords lay (planBuilding): the reeve never aims lower
const FLOCK_CORE = 40;          // ewes kept back from the famine slaughter while the rations hold above half
const SHEEP_KG = 25;            // a sheep dressed (as dragons.js and economy.js feedMounts reckon it)
const CLEAR_BACKLOG = 2;         // fields still being cleared before the reeve lays another (reeveFields)
const WOOD_HA = 10;             // trees a hectare beyond which the reeve's survey counts ground as woodland, not a field to lay
const CROP_PER_HAND = 2;         // ha in crop a labourer can reap in the three weeks before the corn sheds (~0.1 ha a day) EST
const HA_PER_HAND = 3;          // arable (cropped and fallow, ~2 ha in crop) a labourer can bring in: a reaper cuts ~0.1 ha a day, and the corn sheds three weeks after it ripens EST
export function foodWatch(w, team, T, need, lord = false) {
  const doy = w.econ.doy; need = Math.max(1, need);
  let stooks = 0, harvest = 0, ripe = Infinity, ha = 0, year = 0;
  for (const it of w.labor?.items || []) if (it.kind === "stook" && it.team === team && it.kg > 0) stooks += it.kg; // (the stooks standing in its fields, one pass)
  for (const b of w.buildings) {
    if (b.team !== team || !b.field || b.ruin) continue;
    const f = b.field; ha += f.ha || 0;
    if (!lord) { const p = prospect(b, doy); if (p && p.ripe <= doy + 365) year += p.kg; } // (what the fields will give in the coming twelvemonth)
    if ((f.state === "growing" || f.state === "ripe") && f.left > 0) { harvest += f.left * (1 - (f.seedFrac || 0)); ripe = Math.min(ripe, f.ripe); }
  }
  const stock = EC.edibleStock(T) + stooks, days = stock / need; // (not the seed corn: economy.js edibleStock)
  const toHarvest = ripe === Infinity ? Infinity : Math.max(0, ripe - doy) + 10; // (+ reaping, carting and threshing)
  const reach = days + (toHarvest <= days ? harvest / need : 0); // (the corn counts only if the stores reach it: counted a fortnight short — as it was — the watch stayed quiet while House Maximus ran down to its last fortnight's bread before a harvest a month off)
  // an AI lord runs his own fields and markets (planBuilding, tradeGoods): his watch turns red only on real hunger
  const red = !T.fallen && (lord ? T.ration < 0.9 : (T.ration < 0.97 || reach < FOOD_HORIZON));
  return { stock, stooks, days, harvest, toHarvest, reach, ha, red, need, lord, year, wantKg: need * 365 * 1.1, wantHa: Math.max(FIELD_MIN_HA, need * 365 * 1.1 / FIELD_NET_KG_HA) };
}
const FEASTS = [[33, "Candlemas"], [84, "Lady Day"], [121, "May Day"], [175, "Midsummer"], [213, "Lammas"], [272, "Michaelmas"], [314, "Martinmas"], [359, "Christmas"]];
const dayOf = (doy) => ((Math.floor(doy) % 365) + 365) % 365;
const feastPast = (doy) => { const d = dayOf(doy); let best = FEASTS[FEASTS.length - 1]; for (const f of FEASTS) if (f[0] <= d + 7) best = f; return best[1]; }; // ("will not feed us past Michaelmas")
const feastBy = (doy) => { const d = dayOf(doy); return (FEASTS.find((f) => f[0] >= d - 3) || FEASTS[0])[1]; };                                  // ("first harvest by Lammas")
const compass = (dx, dy) => { const a = Math.atan2(-dy, dx), k = Math.round(a / (Math.PI / 4)); return ["east", "north-east", "north", "north-west", "west", "south-west", "south", "south-east"][((k % 8) + 8) % 8]; }; // (map y runs south)
function say(w, G, text, tone = "bad", at = null) {
  note(w, G, text);
  w.log.push({ t: w.tick, kind: "reeve-say", team: G.team, text, tone, x: at?.x, y: at?.y });
}
// the watch turning red / clearing: told once each way (a hysteresis of a week of food, so it does not flicker)
function famineNews(w, G, { T, watch }) {
  const was = !!G.famine;
  if (watch.red && !was) {
    G.famine = true;
    const why = watch.harvest > 0 && watch.toHarvest < Infinity ? `the stores will not carry us to the harvest (${Math.round(watch.days)} days of food in hand)` : `${Math.round(watch.days)} days of food in hand and no harvest coming`;
    say(w, G, `Your reeve warns of hunger: ${why}. He puts food before walls and crafts${T.sheep > FLOCK_CORE && !T.besieged ? ", and the flocks will go to the larder" : ""}`);
  } else if (!watch.red && was && watch.reach >= FOOD_HORIZON + 7 && T.ration >= 0.99) {
    G.famine = false; G.slaughterNews = false;
    say(w, G, "Your reeve reports the vill fed again: the hands go back to their usual work", "good");
  }
}
// LAY FIELDS: farmland enough for the vill's mouths, as a steward would — for a player's house as for an AI's. The same way
// the player makes a field (fields.js layField): a rectangle of open ground the men clear and plough. Nothing is
// demolished; the crop goes in when the season allows (fields.js firstHarvest).
function reeveFields(w, G, { T, doy, hall, watch }) {
  const team = G.team; if (G.layFields === false || !w.plans?.[team] || !hall || T.besieged || T.fallen) return; // (layFields false: a reeve told to leave the fields to his lord)
  // short: the food in hand and the coming twelvemonth's harvest (fields.js prospect: the crops in the ground and those the
  // rotation will put in) will not feed the vill a year — and a tenth for seed, spoilage and the hungry gap. (A vill with a
  // year's corn in its barns is left to its lord: the reeve breaks new ground only when the year ahead is short.)
  // (…and never below the arable the vill's mouths want over the three-field rotation, watch.wantHa: the year's prospect
  // counts crops not yet in the ground, and a vill that stopped at ~180 ha ran its barns dry in its second summer)
  if (watch.stock + watch.year >= watch.wantKg && watch.ha >= watch.wantHa) return;
  const want = Math.max(watch.wantHa, watch.ha + Math.max(0, watch.wantKg - watch.year) / 600 + 10); // (m² of plots to survey for: ~600 kg a cropped hectare)
  // THE SHORTAGE IS HANDS, NOT LAND: nothing more is put in while the arable already outruns the labourers (HA_PER_HAND),
  // or while ripe corn stands shedding in the fields for want of reapers; and no new ground is broken while CLEAR_BACKLOG
  // fields still lie half-cleared (any age, anyone's — they are finished first: allocateLabour), only the fallow sown.
  // (The clearing fields count for no harvest in watch.year, so each one left half-grubbed made the year look shorter and
  // the reeve laid another: House Maximus had nineteen, 75 ha, the oldest 559 days; a house with no labourers left at all
  // went on laying them.)
  // (the fallow sown out of turn counts against the hands too, but by the ground in CROP — CROP_PER_HAND a labourer: a
  // vill with half its arable lying fallow is not short of hands for one more field of wheat, and House Maximus, barred
  // from it by the arable it had, went into the winter with ten of its sixty fields in the ground)
  const L = EC.headcount(w, team).labour;
  if (L < 1) return;
  let clearing = 0, shedding = false, crop = 0;
  for (const b of w.buildings) if (b.team === team && b.field && !b.ruin) { const f = b.field; if (f.state === "clearing") clearing++; else if (f.state === "ripe" && f.left > f.ha * 100 && doy > f.ripe + 21) shedding = true; if ((f.state === "growing" || f.state === "ripe") && f.left > 0) crop += f.ha; }
  if (shedding) return;
  const noLand = watch.ha >= L * HA_PER_HAND; // (no NEW ground past this: the fallow is sown instead)
  if (noLand && crop >= L * CROP_PER_HAND) return;
  // six new fields still waiting for the plough are enough in hand (the next go in as those are sown)
  const pending = w.buildings.filter((b) => b.team === team && b.field && !b.ruin && b.field.laidBy === "reeve" && doy - (b.field.laidDay ?? -999) < 150 && b.field.sown === undefined && b.field.op !== "sow").length;
  if (pending >= 6) return;
  // a rectangle of good ground near the vill (fields.js pickFieldRect: the reeve's survey — open, flat, dry, few trees,
  // beside the fields he has); the men clear it and break the sod (fields.js layField). A survey that finds nothing is not
  // walked again for a month.
  let s = null;
  if (!noLand && clearing < CLEAR_BACKLOG && doy - (G.surveyDay ?? -999) >= 30) { s = pickFieldRect(w, team, { ha: RL.fieldHa(w, team) ?? Math.max(2, Math.min(4.5, (want - watch.ha) / 2)) }); /* (the size of field the player draws, once he has drawn two: js/sim/reeve-learn.js) */
    if (s) { const c = fieldRect(w, team, s); if (!c.ok || c.trees > c.ha * WOOD_HA) s = null; } // (only woodland left near the vill — 150–250 trees to a field, months of grubbing for a dozen hands: no ground to break, the fallow is sown instead)
    if (!s) G.surveyDay = doy; }
  if (!s) { // no ground left to break: the fallow is sown (fields.js sowFallow), the biggest field first, one a think
    if (crop >= L * CROP_PER_HAND) return; // (as much in the ground as the hands can reap)
    const idle = w.buildings.filter((b) => b.team === team && b.field && !b.ruin && (b.field.state === "fallow" || b.field.state === "stubble")).sort((a, b) => b.field.ha - a.field.ha || a.id - b.id);
    for (const b of idle) {
      const crop = sowFallow(w, b, doy); if (!crop) continue;
      if (doy - (G.fallowNewsDay ?? -99) >= 30) { G.fallowNewsDay = doy; say(w, G, `Your reeve has the fallow ploughed for ${crop}: ${noLand ? "we have more ground than hands to break more" : clearing >= CLEAR_BACKLOG ? "the new ground is still being cleared" : "there is no more ground to break"} and the fields will not feed us another year (the tired ground gives less)`, watch.red ? "bad" : undefined, { x: b.x, y: b.y }); }
      return;
    }
    return;
  }
  const r = layField(w, team, s, { by: "reeve" });
  if (!r.b) return;
  const fh = firstHarvest(doy, r.b.id);
  r.b.field.laidBy = "reeve"; r.b.field.laidDay = doy;
  G.fieldsLaid = (G.fieldsLaid || 0) + 1;
  // one chronicle line per batch (a fortnight apart at most): where, and why
  if (doy - (G.fieldNewsDay ?? -99) >= 14) {
    G.fieldNewsDay = doy;
    const where = compass(s.x - hall.x, s.y - hall.y);
    const short = watch.reach < 7 ? "the granary is bare" : watch.reach < 365 ? `the granary will not feed us past ${feastPast(doy + watch.reach)}` : `the fields we have will not feed us another year`;
    say(w, G, `Your reeve lays out a new field to the ${where} — the men are clearing the ground: ${short} (${fh.crop}, first harvest by ${feastBy(fh.ripe)})`, watch.red ? "bad" : undefined, { x: s.x, y: s.y });
  }
}
// THE LARDER (red watch, free to work): the flocks are driven in and slaughtered for the larder, a few days' meat at a time
// (fresh meat spoils), a breeding core of ewes kept back until the rations fall below half; grain is bought at the vill's
// own market if it has one. Not while besieged: the flocks graze outside the walls and the market is shut.
function larder(w, G, { T, watch }) {
  if (!watch.red || T.besieged || T.fallen) return;
  const core = T.ration < 0.5 ? 0 : FLOCK_CORE;
  if (T.sheep > core && (T.store.fresh || 0) < watch.need * 2.5) { // (a few days' meat at a time: the larder loses 6 % a day)
    const n = Math.min(T.sheep - core, Math.ceil((watch.need * 2.5 - (T.store.fresh || 0)) / SHEEP_KG));
    if (n > 0) {
      T.sheep -= n; EC.give(T, "fresh", n * SHEEP_KG); T.stats.slaughtered = (T.stats.slaughtered || 0) + n;
      if (!G.slaughterNews) { G.slaughterNews = true; say(w, G, `Your reeve has the flocks driven in for slaughter, a few at a time as the larder needs them (${T.sheep + n} sheep)`); }
    }
  }
  if (!watch.lord && EC.hasBuilding(w, G.team, "market")) {
    const cash = (T.store.silver || 0) + (T.store.gold || 0) * 12, want = watch.need * Math.max(0, FOOD_HORIZON - watch.reach);
    if (want > 0 && cash > 1500) EC.trade(w, G.team, "grain", Math.min(want, (cash - 1500) / 0.5));
  }
}

const free = (u) => !u.away && !u.convoy && !u.broad && !u.ordered; // villagers under the player's orders (a march, a broad task: js/sim/broad.js, or a job the player set them to — u.ordered, until it is done) or carting for the army are left alone
function allocateLabour(w, G, { T, doy, foodDays, hall, watch }) {
  const team = G.team, units = EC.workerUnits(w, team).filter(free);
  const L = units.reduce((s, u) => s + u.members.length, 0);
  const sit = G.warden === undefined && RL.learning(T) && T.reeveBook?.rows.length ? RL.situation(w, team) : null; // (the learning reeve: the player's own book, if he has one)
  const desired = []; // {job, n, prefer}
  let left = L;
  const add = (job, n, prefer = []) => { n = Math.max(0, Math.min(Math.round(n), left)); if (n > 0) { desired.push({ job, n, prefer }); left -= n; } };
  // 00. the crews the player set at a workshop or the butts (b.crew: economy.js setCrew) are his: staffed first, at the size he
  // chose, famine or not; the reeve neither grows nor shrinks them (only a workshop the player never touched is the reeve's)
  const setByPlayer = (b) => b.team === team && Number.isInteger(b.crew) && EC.complete(b);
  for (const b of w.buildings) if (setByPlayer(b)) { const job = EC.workJob(b); if (job) add(job, b.crew, EC.crewPrefer(b)); }
  // 0. a famine (the food watch is red: foodWatch): the stooks already cut are carted in before more corn is reaped — the
  // sheaves feed nobody until they are set down at the store (fields.js)
  const famine = !!watch?.red && !T.besieged;
  if (famine) for (const [b, n, prefer] of fieldCrews(w, team, "cart")) add({ kind: "field", b }, Math.min(24, n * 2), prefer);
  // 1. the harvest comes first: ~75 % of hands into ripe fields
  // (while the year's bread is not yet in — the stores and stooks short of a twelvemonth's need, watch.wantKg — the corn
  // standing ripe outranks the crafts, the butts and the stockpiles: nine hands in ten to the reaping, the rest carting
  // and at the store. House Maximus's reeve kept a quarter at the workshop and the woods with 34 t shedding in the fields.)
  // (the fields in a STEADY order — those already begun, then the nearest the keep: sorted by the corn left in them, as it
  // was, the field being reaped fell down the list as it was cut, and every think its crew was sent off to another one
  // across the parish; with fewer reapers than fields the men spent the harvest walking and the corn shed where it stood)
  const reaping = new Set(); for (const u of units) if (u.job?.kind === "field" && u.job.b?.field?.state === "ripe") reaping.add(u.job.b);
  const begun = (b) => (reaping.has(b) || (b.field.reaped || 0) > 0 ? 0 : 1), dHall = (b) => (hall ? Math.hypot(b.x - hall.x, b.y - hall.y) : 0);
  const ripe = w.buildings.filter((b) => b.team === team && b.field?.state === "ripe" && b.field.left > 0).sort((a, b) => begun(a) - begun(b) || dHall(a) - dHall(b) || a.id - b.id);
  const harvestShort = ripe.length > 0 && !!watch && watch.stock < watch.wantKg && !T.besieged;
  let reapers = Math.round(L * (G.threat ? 0.45 : harvestShort ? 0.9 : 0.75));
  for (const f of ripe) { const n = Math.min(reapers, Math.ceil(f.field.ha * 1.6)); add({ kind: "field", b: f }, n, ["woman", "man"]); reapers -= n; if (reapers <= 0) break; }
  // 1b. the stooks left standing in a reaped field are carted in (lane A: js/sim/jobs/fields.js)
  if (!famine) for (const [b, n, prefer] of fieldCrews(w, team, "cart")) add({ kind: "field", b }, n, prefer);
  // 2. fires
  for (const b of w.buildings) if (b.team === team && b.fire > 0 && !b.field && !b.ruin) add({ kind: "firefight", b }, 8);
  // 2a. FAMINE LABOUR (the food watch is red: foodWatch): the fields are ploughed and sown before anything else, then up
  // to half the hands go to the wild food — game, forage, fish — the richest within reach first; walls, crafts, the
  // quarry, the mine and the butts wait (below) until the vill is fed again
  const short = !!watch && !watch.lord && watch.stock + watch.year < watch.wantKg; // (the year ahead will not feed the vill)
  const prepAt = short ? 5 : 2; // (a reeve breaking new ground ploughs five fields at once)
  const clearAt = Math.max(prepAt, Math.min(6, Math.floor(L / 15))); // (the clearing backlog: as many at once as the hands allow)
  const prepCrews = () => { for (const [b, n, prefer] of fieldCrews(w, team, "prep", prepAt, clearAt)) add({ kind: "field", b }, n, prefer); };
  if (famine) {
    prepCrews();
    let n = L * (T.ration < 0.9 || watch.days < 20 ? 0.5 : 0.35);
    for (const f of freshNodes(w, hall, 2200, 6)) { const k = Math.min(n, Math.max(2, f.amount / (E.yieldPerManDay.fresh * 12))); add({ kind: "gather", node: f, res: "fresh" }, k, ["man", "woman"]); n -= k; if (n < 2) break; }
  }
  // 2b. the hungry gap: if the stores won't carry the vill to its harvest, food comes before building —
  // hands to the fish, game and forage near the vill, and the spare hands home to the gardens (step 9)
  const lean = famine || leanTimes(w, team, T, doy, foodDays);
  const fresh = lean ? freshNodes(w, hall, famine ? 2200 : 1600, famine ? 6 : 4) : [];
  if (lean && !famine) {
    let n = Math.min(L * 0.3, EC.dailyFoodNeed(w, team) * (foodDays < 15 ? 0.45 : 0.3) / E.yieldPerManDay.fresh);
    for (const f of fresh) { const k = Math.min(n, Math.max(2, f.amount / (E.yieldPerManDay.fresh * 12))); add({ kind: "gather", node: f, res: "fresh" }, k, ["woman", "man"]); n -= k; if (n < 2) break; }
  }
  // 3. building sites
  for (const b of sitesUnderWay(w, team)) {
    const def = BUILDINGS[b.kind]; if (famine && (def.wall || b.kind === "gate" || b.kind === "gatehouse")) continue; // (the walls wait for full bellies)
    const n = def.stone ? 24 : def.wall ? 26 : clamp(b.labour / 12, 6, 25);
    add({ kind: "build", b }, n, def.stone ? ["mason", "man"] : ["carpenter", "man", "woman"]);
  }
  for (const b of w.buildings) if (b.team === team && b.progress >= 1 && !b.ruin && !b.field && b.hp < b.hpMax * 0.7 && b.fire <= 0 && !b.razing) add({ kind: "build", b }, 4, ["carpenter", "mason"]);
  // 3a. buildings being pulled down (js/sim/demolish.js): the lord's order is kept staffed; a ruin the reeve clears waits for full bellies
  for (const b of DM.razings(w, team)) if (b.progress >= 1 || b.ruin) { if (famine && b.razing.by !== "player") continue; add({ kind: "build", b }, b.razing.by === "player" ? DM.crewFor(b) : Math.min(6, DM.crewFor(b)), DM.preferFor(b)); }
  // 3b. storemen: take the loads in, pack and stack them, carry the rations out (lane D: js/sim/jobs/haulage.js)
  for (const [b, n] of storeCrews(w, team, L)) add({ kind: "store", b }, n, ["woman", "man"]);
  // 3c. the year ahead short (short): the ploughing, sowing and the clearing of new ground come before the crafts and the
  // stockpiles of timber and stone (else step 8b, after them: the hands were gone before the reeve's new fields were made)
  const prepEarly = !famine && short;
  if (prepEarly) prepCrews();
  // 4. workshops, staffed by their trades
  for (const b of w.buildings) {
    if (famine) break; // (the crafts wait while the vill goes hungry)
    if (harvestShort && !IRON_WORKS.has(b.kind)) continue; // (and while its corn stands in the fields — all but the iron works: the bloomery and the colliers keep their crews, far out by the ore and the wood, or they walk home for the harvest and back for days)
    if (b.team !== team || !EC.complete(b) || !RECIPES[b.kind] || !b.make || setByPlayer(b)) continue;
    const R = RECIPES[b.kind]; const staff = BUILDINGS[b.kind].staff || 4;
    if (b.blocked && b.work >= R[b.make].days && EC.stillShort(w, b)) continue; // (stopped, and the store still short of it)
    if (b.kind === "charcoal_kiln" && (T.store.charcoal >= 1500 || (T.store.timber < 5000 && !EC.kilnWood(w, b, 720)))) continue; // (a clamp in a standing wood cuts its own cordwood) // (a working bloomery burns 30 kg a day: a stock of about seven weeks)
    add({ kind: "craft", b }, b.kind === "charcoal_kiln" ? 2 : Math.min(staff, b.kind === "bloomery" ? 3 : staff), R.trade ? [R.trade, "man"] : ["man"]);
  }
  // 5. adepts to the ley line
  const ley = nearestNode(w, hall.x, hall.y, (n) => n.kind === "ley", 1800);
  if (ley && T.store.mana < 60) add({ kind: "gather", node: ley, res: "mana" }, 2, ["adept"]);
  // 5b. silver and gold: the wages are paid in coin — a camp at a vein is worked, harder when the chest runs low
  if (!famine) for (const vk of ["silver_vein", "gold_vein"]) {
    const v = nearestNode(w, hall.x, hall.y, (n) => n.kind === vk && n.amount > 1 && veinHolder(w, n) === team, PRECIOUS_REACH); if (!v) continue;
    if (!w.buildings.some((b) => b.team === team && b.kind === "mining_camp" && EC.complete(b) && Math.hypot(b.x - v.x, b.y - v.y) < 260)) continue;
    const cash = (T.store.silver || 0) + (T.store.gold || 0) * 12, bill = Math.max(50, T.day.wages || 0);
    add({ kind: "gather", node: v, res: v.res }, (T.arrears || 0) > 0 || cash < bill * 30 ? 12 : 5, ["man"]);
  }
  // 5c. no live vein of the house's own within reach (or its last near spent) and the chest short: a few men go prospecting
  // the likeliest ground — rock, crag, near old workings — until they find one (js/sim/prospect.js)
  if (!famine) {
    const cash = (T.store.silver || 0) + (T.store.gold || 0) * 12, short = (T.arrears || 0) > 0 || cash < Math.max(2000, (T.day?.wages || 0) * 40);
    const pj = PR.reeveProspect(w, team, hall, { short, reach: PRECIOUS_REACH });
    if (pj) {
      const said = ((w.prospect ||= { found: 0, tried: {} }).said ||= {}); // (told once for each ground he sends them to)
      if (said[team] !== `${pj.x},${pj.y}`) { said[team] = `${pj.x},${pj.y}`; say(w, G, `Your reeve sends men prospecting ${Math.round(Math.hypot(pj.x - hall.x, pj.y - hall.y) / 10) * 10} m out (${PR.groundWord(pj.geo)}): the house has no vein left to work and the chest runs short`, "good", { x: pj.x, y: pj.y }); }
      add(pj, 4, ["man"]);
    }
  }
  // 6. food: fish if there is water within reach; weeding in season
  const fish = nearestNode(w, hall.x, hall.y, (n) => n.kind === "fishery", 1600);
  if (fish && foodDays < 120 && !fresh.includes(fish)) add({ kind: "gather", node: fish, res: "fresh" }, foodDays < 30 ? 8 : 4, ["man"]);
  const weeding = w.buildings.filter((b) => b.team === team && b.field?.state === "growing" && !b.field.op && doy >= b.field.ripe - 80 && b.field.care < 0.95); // (lane A: not while it is still being ploughed/sown)
  for (const f of weeding.slice(0, 3)) add({ kind: "field", b: f }, 2, ["woman"]);
  // 7. raw materials to target stocks
  const timberWant = leanTo(40000 + (G.wantTimber || 0) + (G.threat || doy > G.fortifyDay - 8 ? 120000 : 0), sit && !famine && RL.stockTarget(w, team, "timber", sit));
  const wood = nearestNode(w, hall.x, hall.y, (n) => n.kind === "wood", 2500);
  const noStockpile = famine || harvestShort; // (no stockpiling of timber, stone or ore in a famine, nor while the corn stands ripe and the year's bread is not in)
  if (wood && !noStockpile) add({ kind: "gather", node: wood, res: "timber", carts: 2 }, clamp((timberWant - T.store.timber) / 1500, 2, 22), ["man", "carpenter"]);
  const fwNeed = (T.dependants + L) * E.fuelPerPerson;
  const cop = nearestNode(w, hall.x, hall.y, (n) => n.kind === "coppice" || n.kind === "wood", 2500);
  if (cop && T.store.firewood < fwNeed * 25) add({ kind: "gather", node: cop, res: "firewood" }, clamp(fwNeed / 400, 1, 6), ["woman", "man"]);
  const stoneWant = leanTo(20000 + (G.wantStone || 0), sit && !famine && RL.stockTarget(w, team, "stone", sit));
  const quarry = nearestNode(w, hall.x, hall.y, (n) => n.kind === "quarry", 2500);
  if (quarry && !noStockpile && T.store.stone < stoneWant) add({ kind: "gather", node: quarry, res: "stone", carts: 2 }, clamp((stoneWant - T.store.stone) / 3000, 2, 12), ["mason", "man"]);
  const ore = nearestNode(w, hall.x, hall.y, (n) => n.kind === "bog_iron", 2500);
  if (ore && !noStockpile && T.store.ore < 400 && count(w, team, "bloomery", true)) add({ kind: "gather", node: ore, res: "ore" }, 3, ["man"]);
  // 8. men at the butts (future archers) when the fields can spare them
  const butts = w.buildings.find((b) => b.team === team && b.kind === "archery_range" && EC.complete(b));
  if (butts && !setByPlayer(butts) && !famine && !T.harvestTime && foodDays > 25) add({ kind: "practice", b: butts }, Math.min(8, L * 0.06), ["man", "spear"]);
  // 8a. and a few at drill in the muster yard (future spearmen: a spear each to hand) and riding at the stables (future riders —
  // hobelars, scouts, squires: a horse each), while the house is short of them (economy.js practice; econ-data PRACTICE)
  if (!famine && !T.harvestTime && foodDays > 25) {
    let pools = null; const pool = (r) => (pools ||= poolCounts(w, team))[r];
    const yard = w.buildings.find((b) => b.team === team && b.kind === "barracks" && EC.complete(b));
    if (yard && !setByPlayer(yard) && (T.store.spears || 0) >= 1 && pool("spear") < 12) add({ kind: "practice", b: yard }, Math.min(6, L * 0.04, Math.floor(T.store.spears), pool("man")), ["man"]); // (only men train: never a crew of women standing about)
    const stab = w.buildings.find((b) => b.team === team && b.kind === "stables" && EC.complete(b));
    if (stab && !setByPlayer(stab) && (T.store.horses || 0) >= 2 && pool("rider") < 6) add({ kind: "practice", b: stab }, Math.min(4, L * 0.03, Math.floor(T.store.horses) - 1, pool("man") + pool("spear")), ["man", "spear"]);
  }
  // 8b. ploughing and sowing in season — after the timber and stone the vill wants, before the spare hands (lane A)
  if (!famine && !prepEarly) prepCrews(); // (in a famine: step 2a; the year ahead short: step 3c)
  // 9. spare hands never stand about: timber for building, food from the land, stone
  // (in a lean season they stay home: a man in his garden feeds more mouths than a man felling oaks;
  // and nobody fells timber or cuts stone for a stockpile already twice what the vill wants)
  if (left > 6 && !lean) {
    const spare = left - Math.max(4, Math.round(L * 0.08)); // a few stay at home: children, cooking, beasts
    const game = nearestNode(w, hall.x, hall.y, (n) => ["hunt", "forage", "fishery"].includes(n.kind) && n.amount > 0, 1800);
    if (wood && T.store.timber < timberWant * 2) add({ kind: "gather", node: wood, res: "timber", carts: 2 }, spare * 0.45, ["man", "carpenter", "woman"]);
    if (game) add({ kind: "gather", node: game, res: game.res || "fresh" }, spare * 0.3, ["woman", "man"]);
    if (quarry && T.store.stone < stoneWant * 2) add({ kind: "gather", node: quarry, res: "stone", carts: 2 }, spare * 0.25, ["man", "mason"]);
  }
  // the learning reeve: the crews on the work the player does himself pulled toward the share he keeps on it in seasons
  // like this one (never in a famine or a siege; never the harvest, the carting, a fire, a site, the stores or his crews)
  if (sit && !famine && !T.besieged) learnAllocation(w, G, desired, L, hall, sit, lean);
  // everyone else at home: gardens, threshing, shearing
  applyAllocation(w, team, units, desired);
}
const IRON_WORKS = new Set(["bloomery", "charcoal_kiln"]);
const leanTo = (base, t) => (t ? Math.round(base + (t.kg - base) * 0.8 * t.conf) : base); // (a stock target pulled toward the player's)
const PRECIOUS = new Set(["silver", "gold", "mana"]);
function learnAllocation(w, G, desired, L, hall, sit, lean) {
  const tg = RL.allocationTargets(w, G.team, sit); if (!tg) { G.learnt = null; return; }
  const cat = (d) => (d.job.kind === "gather" ? RL.catOf(d.job) : null);
  let budget = L - desired.reduce((s, d) => s + d.n, 0);
  const seen = {};
  for (const c of Object.keys(tg).sort()) {
    const t = tg[c], ds = desired.filter((d) => cat(d) === c), have = ds.reduce((s, d) => s + d.n, 0);
    const want = Math.max(0, t.men - (sit.mine[c] || 0)); // (the player's own crews on it count: he only fills the rest)
    let goal = Math.round(have + (want - have) * 0.85 * t.conf);
    if (c === "food" && lean) goal = Math.max(goal, have); // (the hungry gap is the food watch's: never fewer at the food)
    seen[c] = { player: t.men, reeve: goal + (sit.mine[c] || 0), conf: Math.round(t.conf * 100) / 100 };
    for (const d of ds) d.net = true; // (already net of the player's crews: applyAllocation does not count them again)
    if (goal < have) { let cut = have - goal; for (const d of ds.slice().reverse()) { const k = Math.min(cut, d.n); d.n -= k; cut -= k; budget += k; if (!cut) break; } continue; }
    let add = goal - have; if (add < 1) continue;
    if (budget < add) for (const d of desired.slice().reverse()) { // (short of hands: from the reeve's other gathering the player has no say on — never the coin, the ley)
      const dc = cat(d); if (!dc || dc === c || tg[dc] || PRECIOUS.has(dc) || (dc === "food" && lean)) continue;
      const k = Math.min(d.n, add - budget); d.n -= k; budget += k; if (budget >= add) break;
    }
    add = Math.min(add, budget); if (add < 1) continue;
    if (ds.length) ds[0].n += add;
    else {
      const kinds = RL.nodeKindsOf(c), node = kinds && nearestNode(w, hall.x, hall.y, (n) => kinds.includes(n.kind) && n.amount > 1 && ((n.kind !== "silver_vein" && n.kind !== "gold_vein") || veinHolder(w, n) === G.team), PRECIOUS.has(c) ? PRECIOUS_REACH : 2500); if (!node) continue; // (a vein: only one the house holds — js/sim/veins.js)
      desired.push({ job: { kind: "gather", node, res: c === "food" ? node.res || "fresh" : c === "firewood" ? "firewood" : node.res, ...(c === "timber" || c === "stone" ? { carts: 2 } : {}) }, n: add, prefer: ["man", "woman"], net: true });
    }
    budget -= add;
  }
  for (let i = desired.length - 1; i >= 0; i--) if (desired[i].n <= 0) desired.splice(i, 1);
  G.learnt = seen; // (what he did with it this think: tools/reeve-learn-test.mjs reads it)
}

// Will the stores last until the vill's own corn is cut? (before harvest; a margin of a fortnight)
export function leanTimes(w, team, T, doy, foodDays) {
  if (T.harvestTime) return false;
  let ripe = Infinity;
  for (const b of w.buildings) if (b.team === team && b.field?.state === "growing" && b.field.left > 0) ripe = Math.min(ripe, b.field.ripe);
  const toHarvest = ripe === Infinity ? 60 : Math.max(0, ripe - doy);
  return foodDays < Math.min(toHarvest + 14, 90);
}
// the wild food within reach, the richest (per metre of walk) first
function freshNodes(w, hall, maxD, max = 4) {
  return (w.resources || []).filter((n) => ["fishery", "hunt", "forage"].includes(n.kind) && n.amount > 50 && Math.hypot(n.x - hall.x, n.y - hall.y) < maxD)
    .sort((a, b) => b.amount / (300 + Math.hypot(b.x - hall.x, b.y - hall.y)) - a.amount / (300 + Math.hypot(a.x - hall.x, a.y - hall.y)) || a.id - b.id).slice(0, max);
}

function applyAllocation(w, team, units, desired) {
  const want = new Map(desired.map((d) => [EC.jobKey(d.job), d]));
  // the player's own crews (his orders, his broad tasks) on a job the reeve also wants are counted toward it: the reeve fills
  // the rest rather than sending a second crew of the full size beside his (and never merges into his: economy.assignWorkers)
  const held = new Map(); for (const v of EC.workerUnits(w, team)) if (v.members.length && !free(v) && v.job && v.job.kind !== "home") { const k = EC.jobKey(v.job); held.set(k, (held.get(k) || 0) + v.members.length); }
  // release surplus first
  for (const u of units) {
    if (!u.members.length || u.job?.kind === "home" || !free(u)) continue;
    const d = want.get(EC.jobKey(u.job));
    if (!d) EC.releaseWorkers(w, u);
    else { const h = d.net ? 0 : held.get(EC.jobKey(u.job)) || 0; if (u.members.length + h > d.n + 1) EC.releaseWorkers(w, u, Math.min(u.members.length, u.members.length + h - d.n), d.prefer); }
  }
  for (const d of desired) {
    const u = EC.workerUnits(w, team).filter(free).find((v) => EC.jobKey(v.job) === EC.jobKey(d.job));
    const have = (u ? u.members.length : 0) + (d.net ? 0 : held.get(EC.jobKey(d.job)) || 0);
    if (have < d.n - (d.n > 6 ? 1 : 0)) EC.assignWorkers(w, team, d.job, d.n - have, d.prefer);
    const v = u || EC.workerUnits(w, team).find((x) => EC.jobKey(x.job) === EC.jobKey(d.job));
    if (v && d.job.carts) v.job.carts = d.job.carts;
  }
}

// ───────────────────────────────────────────────────────── workshops
function setProduction(w, G, { T }) {
  const team = G.team, pools = poolCounts(w, team);
  const levyWant = G.levyWant || 20;
  const sit = RL.learning(T) && T.reeveBook?.rows.some((r) => r.a.what === "product") ? RL.situation(w, team) : null;
  for (const b of w.buildings) {
    if (b.team !== team || !EC.complete(b) || !RECIPES[b.kind]) continue;
    if (b.makeBy === "player") continue; // the owner chose what it makes (economy.js setProduct): his until he hands it back ("Auto")
    let p = null;
    if (b.kind === "blacksmith") {
      const arrowsWant = (pools.archer + armyCount(w, team, "archers")) * 60;
      if (T.store.arrowheads < 150 && T.store.arrows < arrowsWant) p = "arrowheads";
      else if (T.store.spears < levyWant + pools.spear) p = "spears";
      else if (T.store.helms < 20) p = "helms";
      else if (T.store.lances < T.squires + 4) p = "lances";
      else if (T.store.iron >= 12 && T.store.mail < 4) p = "mail";
      else if (TC.has(w, team, "coat_of_plates") && T.store.iron >= 16 && T.store.cloth >= 4 && (T.store.plates || 0) < 6) p = "plates"; // (research: coats of plates for the men-at-arms)
      else if (T.store.swords < 8) p = "swords";
      else p = "arrowheads";
    } else if (b.kind === "fletcher") {
      if (T.store.bows < pools.archer && T.store.staves >= 1) p = "bows";
      else if (T.store.arrows < (pools.archer + armyCount(w, team, "archers")) * 72) p = "arrows";
      else if ((T.store.staves || 0) + EC.seasoning(T, "staves") < pools.archer + 8 && T.store.timber >= 2000) p = "staves"; // (staves laid by to season, a year ahead of the bows: econ-data.js RECIPES.fletcher.staves)
      else if (G.D.seeksHighGround >= 0.6 && T.store.iron > 10 && T.store.crossbows < 6) p = "crossbows";
      else p = "arrows";
    } else if (b.kind === "weaver") p = T.store.rope < 150 && T.store.hemp >= 22 && count(w, team, "siege_workshop") ? "rope" : T.store.cloth >= 5 ? "gambeson" : T.store.wool >= 2.4 ? "cloth" : null;
    else if (b.kind === "siege_workshop") p = engineWant(w, G, T);
    else if (b.kind === "charcoal_kiln") p = "charcoal";
    else if (b.kind === "bloomery") p = "iron";
    else if (b.kind === "mint") p = (T.store.gold || 0) >= 4 && (T.store.silver || 0) < 30000 ? "silver" : null; // (the moneyers strike gold into pennies while the chest wants them: js/sim/estates.js)
    if (sit) { const lp = RL.productFor(w, team, b.kind, sit), R = lp && RECIPES[b.kind][lp]; if (R && lp !== p && TC.productOpen(w, team, b.kind, lp) && Object.entries(R.needs || {}).every(([r, n]) => (T.store[r] || 0) >= n * 3)) p = lp; } // (the learning reeve: what the player has it make in times like these, while the stuff for it is in store)
    if (p) EC.setProduct(w, b, p); else b.make = null;
  }
}

// What the engine yard should make next (its goods in the store + engines already mustered count as had).
// Ladders first (cheap, and every storm needs them), a springald for our own walls, then the siege train the
// enemy's walls call for: a mangonel and a ram against timber, a trebuchet and a belfry against stone.
const ENGINE_GOOD = { mangonel: "mangonels", springald: "springalds", ram: "rams", siege_tower: "siege_towers", mantlet: "mantlets", trebuchet: "trebuchet_gear" };
function engineWant(w, G, T) {
  const team = G.team, have = (kind) => (T.store[ENGINE_GOOD[kind]] || 0) + [...w.units.values()].filter((u) => u.team === team && u.arm === kind && u.members.length).length + inQueue(w, team, kind) / (EC.RECRUITS[kind]?.crew || 1);
  const walls = foeWalls(w, G), stone = [...(G.seenWalls || [])].some((id) => w.buildings.find((b) => b.id === id)?.kind === "stone_wall");
  const list = [["ladders", (T.store.ladders || 0) < 10], ["carts", (T.store.carts || 0) < 2], ["springalds", have("springald") < 1]]; // (carts: the haulage, the market town, a trebuchet's baulks)
  if (walls || G.D.aggression >= 0.6) list.push(["mangonels", have("mangonel") < 1 + (G.D.aggression > 0.7 ? 1 : 0)], ["rams", have("ram") < 1], ["mantlets", have("mantlet") < 2]);
  if (stone) list.push(["trebuchet_gear", have("trebuchet") < 1], ["siege_towers", have("siege_tower") < 1]);
  const R = RECIPES.siege_workshop;
  for (const [good, need] of list) if (need && Object.entries(R[good].needs).every(([r, n]) => (T.store[r] || 0) >= n)) return good;
  return (T.store.ladders || 0) < 20 ? "ladders" : null;
}

// ───────────────────────────────────────────────────────── market
function tradeGoods(w, G, { T, foodDays, need }) {
  const team = G.team;
  if (!EC.hasBuilding(w, team, "market")) return;
  const cash = T.store.silver + T.store.gold * 12;
  if (T.store.wool > 30) EC.trade(w, team, "wool", -(T.store.wool - 20));
  if (T.store.timber > 200000) EC.trade(w, team, "timber", -(T.store.timber - 180000));
  if (T.store.stone > Math.max(150000, (G.wantStone || 0) * 1.05)) EC.trade(w, team, "stone", -(T.store.stone - Math.max(120000, G.wantStone || 0))); // (a great work's stone is kept for it: greatWorks)
  if (foodDays < 25 && cash > 2000) EC.trade(w, team, "grain", Math.min(need * (30 - foodDays), (cash - 1500) / 0.5));
  const pools = poolCounts(w, team);
  if (T.store.staves < 3 && T.store.bows < pools.archer && cash > 3000) EC.trade(w, team, "staves", pools.archer - T.store.bows);
  if (T.store.iron < 15 && cash > 4000) EC.trade(w, team, "iron", 25);
  if (T.store.horses < 3 && cash > 5000) EC.trade(w, team, "horses", 1);
  if (T.store.charcoal < 100 && cash > 3000) EC.trade(w, team, "charcoal", 200);
  if (count(w, team, "siege_workshop") && T.store.rope + T.store.hemp / 1.1 < 200 && cash > 3000) EC.trade(w, team, T.store.hemp < 60 && count(w, team, "weaver", true) ? "hemp" : "rope", 80); // engines are rope
  // money for the war: wages of war are paid in silver or the men go home
  const bill = Math.max(50, T.day.wages || 0);
  if (cash < bill * 12 && EC.levyTallage(w, team)) note(w, G, "levies a tallage on the vill");
  if (cash < bill * 20) {
    if (T.store.timber > 120000) EC.trade(w, team, "timber", -(T.store.timber - 100000));
    if (T.store.stone > 60000 && !(G.ring?.stone_wall?.size)) EC.trade(w, team, "stone", -(T.store.stone - 40000));
    if (T.store.charcoal > 2000) EC.trade(w, team, "charcoal", -(T.store.charcoal - 1500));
    if (foodDays > 120) EC.trade(w, team, "grain", -Math.min(T.store.grain - need * 100, 5000));
  }
  if (T.arrears > 0 && T.store.iron > 100) EC.trade(w, team, "iron", -(T.store.iron - 60));
}

// ───────────────────────────────────────────────────────── gold (js/sim/gold.js)
// The money-changer, both ways: gold to silver when the chest of pennies runs short of a few days' wages (before he must
// levy a tallage), keeping what his companies and the great work he is saving for will want; silver to gold for that
// great work's gold and to keep his hired companies paid. → s changed (+ bought, − sold), 0 if nothing
function changeFor(w, team, T, { bill, keepGold, wantGold, reserve }) {
  const gold = T.store.gold || 0, silver = T.store.silver || 0;
  if (silver < bill * 10 && gold > keepGold + 1) { const s = Math.min(Math.floor(gold - keepGold), Math.ceil((bill * 20 - silver) / GD.goldRate(w, team, false))); if (s >= 1) { const r = GD.exchange(w, team, -s); if (r.ok) return r.s; } }
  if (wantGold > gold + 1) { const s = Math.ceil(wantGold - gold), cost = s * GD.goldRate(w, team, true); if (silver - cost >= reserve) { const r = GD.exchange(w, team, s); if (r.ok) return r.s; } }
  return 0;
}
// An AI lord: changes coin as above; hires a company when the enemy is near his keep and his chest is deep in gold (the
// prest and a fortnight's wages to spare), and pays it off ten days after the danger has passed.
const MERC_CALM_DAYS = 10;
export function lordGold(w, G, { T }) { // (exported for tools/gold-test.mjs)
  const team = G.team; if (!EC.hasBuilding(w, team, "market") || T.besieged) return;
  const bill = Math.max(50, T.day.wages || 0), mb = GD.mercBill(w, T);
  const s = changeFor(w, team, T, { bill, keepGold: mb * 15 + (G.wantGold || 0), wantGold: Math.max(G.wantGold || 0, mb * 10), reserve: Math.max(4000, bill * 30) });
  if (s) note(w, G, s > 0 ? `buys ${s} s of gold from the changers` : `changes ${-s} s of gold for silver`);
  const serving = T.mercs?.list?.length || 0, doy = w.econ.doy;
  if (serving) { if (G.threat) G.calmSince = null; else if (G.calmSince == null) G.calmSince = doy; } // (only while a company serves: the danger past, he counts the days)
  if (G.threat && !serving) {
    const gold = T.store.gold || 0, afford = (k) => gold >= mercHire(k) + mercDay(k) * 15 && !GD.hireWhy(w, team, k);
    const bows = [...w.units.values()].reduce((n, u) => n + (u.team === team && ARMS[u.arm]?.missile ? u.members.length : 0), 0);
    const pick = ["routiers", bows < 20 ? "genoese" : "brabancons", bows < 20 ? "brabancons" : "genoese"].find(afford);
    if (pick) { const r = GD.hire(w, team, pick); if (r.ok) { G.calmSince = null; note(w, G, `hires ${MERCS[pick].name} for ${r.gold} s of gold`); } }
  } else if (serving && !G.threat && doy - G.calmSince >= MERC_CALM_DAYS) {
    for (const c of T.mercs.list.slice()) { const r = GD.dismiss(w, team, c.kind); if (r.ok) note(w, G, `pays off ${MERCS[c.kind].name}`); }
  }
}
// The player's reeve changes coin only to keep the house paying: gold for silver when the pennies will not last three
// days of wages (keeping a fortnight of the companies' gold), and silver for gold when the companies' gold will not last
// two days. He hires and pays off no company: that is the lord's choice.
export function reeveCoin(w, G, { T }) { // (exported for tools/gold-test.mjs)
  const team = G.team; if (!EC.hasBuilding(w, team, "market") || T.besieged) return;
  const bill = Math.max(50, T.day?.wages || 0), mb = GD.mercBill(w, T), gold = T.store.gold || 0, silver = T.store.silver || 0;
  if (silver < bill * 3 && gold > mb * 14 + 1) {
    const r = GD.exchange(w, team, -Math.min(Math.floor(gold - mb * 14), Math.ceil((bill * 10 - silver) / GD.goldRate(w, team, false))));
    if (r.ok) say(w, G, `Your reeve changes ${-r.s} s of gold for ${Math.round(r.d)} d of silver at the market: the wages are due`, "good");
  } else if (mb > 0 && gold < mb * 2 && silver > bill * 20) {
    const r = GD.exchange(w, team, Math.ceil(mb * 5 - gold));
    if (r.ok) say(w, G, `Your reeve buys ${r.s} s of gold with ${Math.round(r.d)} d of silver: your hired companies are paid in gold`, "good");
  }
}

// ───────────────────────────────────────────────────────── recruitment
function poolCounts(w, team) {
  const c = Object.fromEntries(ROLES.map((r) => [r, 0]));
  for (const u of EC.workerUnits(w, team)) for (const id of u.members) c[ROLES[EC.roleOf(w, id)]]++;
  return c;
}
const armyCount = (w, team, arm) => { let n = 0; for (const u of w.units.values()) if (u.team === team && u.arm === arm) n += u.members.length; return n; };

function recruit(w, G, { T, doy, foodDays }) {
  const team = G.team;
  const at = (kind) => w.buildings.find((b) => b.team === team && b.kind === kind && EC.complete(b) && b.queue.length < 2);
  const hall = hallOf(w, team), keep = hall.queue.length < 3 ? hall : null;
  // the lord arrays his tenants at the manor; butts, muster hall and stables add what the keep can't
  const stables = at("stables") || keep, butts = at("archery_range") || keep, barracks = at("barracks") || keep, knightYard = at("stables");
  const early = doy < E.startDoy + 8 * (1 - G.D.aggression) && !G.threat; // (a Hotspur calls out his tenants the day he rides in)
  if (early) return;
  if ((T.arrearsDays || 0) > 1 && !G.threat) return; // no silver, no soldiers
  const pools = poolCounts(w, team), L = EC.headcount(w, team).labour;
  // a hungry vill keeps its men in the gardens: a soldier eats more and grows nothing (scouts excepted)
  const hungry = !G.threat && foodDays < 45 && leanTimes(w, team, T, doy, foodDays);
  if (hungry) { pools.archer = 0; pools.spear = 0; pools.rider = Math.min(pools.rider, 1); }
  // scouts first: eyes are cheap
  if (stables && armyCount(w, team, "scouts") + inQueue(w, team, "scouts") < 3 && G.difficulty > 0.25) EC.queueRecruit(w, stables, "scouts", 3 - armyCount(w, team, "scouts") - inQueue(w, team, "scouts"));
  if (butts && pools.archer > 0) EC.queueRecruit(w, butts, "archers", pools.archer);
  const heavyNeed = G.D.aggression > 0.6 || G.D.flank > 0.6;
  if (barracks && pools.spear > 0) {
    if (T.store.mail > 0 && T.store.swords > 0 && T.store.helms > 0 && heavyNeed) EC.queueRecruit(w, barracks, "menatarms", Math.min(4, pools.spear));
    EC.queueRecruit(w, barracks, T.store.pikes >= pools.spear && G.D.seeksHighGround >= 0.8 ? "pikemen" : "spearmen", pools.spear);
  }
  // a reeve whose town has LEARNED a mount rides what its stables broke (captures happen in the field; never forced):
  // striders under the light horse, drakes under the knights — only when the trained stock covers the whole muster
  const ride = (arm, kind, n) => (T.tradition?.[kind] && (T.mounts?.[kind] || 0) >= n ? kind : null);
  if (stables && pools.rider > 1) { const n = pools.rider - 1; EC.queueRecruit(w, stables, "hobelars", n, { mount: stables.kind === "stables" ? ride("hobelars", "strider", n) : null }); }
  if (knightYard && T.squires > 0 && (T.store.destriers > 0 || (T.tradition?.drake && (T.mounts?.drake || 0) >= T.squires))) EC.queueRecruit(w, knightYard, "knights", T.squires, { mount: ride("knights", "drake", T.squires) });
  if (knightYard && T.squires < 1 && pools.rider > 0 && T.store.destriers > 0 && !knightYard.tilt) EC.startSquire(w, knightYard);
  if (barracks && T.store.crossbows > 0) EC.queueRecruit(w, barracks, "crossbow", T.store.crossbows, { rushed: G.threat });
  // levies: only out of harvest (or with the enemy at the gate); never more than a third of the men
  const men = pools.man;
  G.levyWant = Math.round(Math.min(men * 0.5, L * 0.22));
  const levyNow = armyCount(w, team, "levy") + inQueue(w, team, "levy");
  // engines: crew every engine the yard has made
  const yard = at("siege_workshop");
  if (yard && !hungry) for (const [kind, good] of Object.entries(ENGINE_GOOD)) if ((T.store[good] || 0) >= 1 && EC.canRecruit(w, team, kind) > 0) { if (EC.queueRecruit(w, yard, kind, 1)) note(w, G, `crews a ${ARMS[kind].name.toLowerCase()}`); break; }
  const wantLevy = G.threat || (G.campaignPlanned && !T.harvestTime && foodDays > 15);
  if (wantLevy && levyNow < G.levyWant) {
    const where = barracks || (hall.queue.length < 2 ? hall : null);
    if (where) EC.queueRecruit(w, where, "levy", G.levyWant - levyNow, { rushed: !!G.threat });
  }
}
const inQueue = (w, team, arm) => w.buildings.reduce((s, b) => s + (b.team === team ? b.queue.filter((q) => q.arm === arm).reduce((a, q) => a + q.count, 0) : 0), 0);

// ═════════════════════════════════════════════════════════════════ WAR
function milThink(w, G) {
  const team = G.team, T = w.teams[team], hall = hallOf(w, team);
  observe(w, G);
  const mine = [...w.units.values()].filter((u) => u.team === team && !u.isWorkers && u.members.length && !u.noAI && (u.gate === undefined || u.gate === null)); // (noAI: scripted demo bodies; u.gate: a gate's own guards stay at it — js/sim/gateguards.js)
  // merge fresh musters of the same arm standing at home
  const home = mine.filter((u) => Math.hypot(u.ax - hall.x, u.ay - hall.y) < 250 && !G.army.has(u.id) && u.arm !== "scouts" && !ARMS[u.arm].engine);
  if (!G.warden) for (const u of home) { const twin = home.find((v) => v !== u && v.arm === u.arm && w.units.has(v.id) && v.id < u.id); if (twin && w.units.has(u.id)) mergeUnits(w, [twin, u]); } // (the warden never merges the player's companies: he split them as he wanted them)
  G.scouts = new Set(mine.filter((u) => u.arm === "scouts" && w.units.has(u.id)).map((u) => u.id));
  const field = mine.filter((u) => u.arm !== "scouts" && w.units.has(u.id) && !ARMS[u.arm].engine);
  G.engineUnits = mine.filter((u) => ARMS[u.arm].engine && engineOf(w, u) && w.units.has(u.id));
  for (const id of [...G.army]) if (!w.units.has(id)) G.army.delete(id);
  const own = militaryStrength(w, team, field);
  const est = enemyEstimate(w, G);
  G.estimate = est; G.own = own;
  // threat: enemy troops seen near our hall
  // (men standing at their own keep are its garrison, not a threat: with neighbours a kilometre off — the realm — a lord
  // would otherwise stand to arms for ever. Two teams: the other town is far beyond the 1,400 m, nothing changes.)
  const atHome = (s) => { const t = w.teams[s.team]?.town; return !!t && Math.hypot(s.x - t.x, s.y - t.y) < 450; };
  const near = [...G.intel.values()].filter((s) => !s.workers && w.tick - s.tick < TPD * 0.75 && Math.hypot(s.x - hall.x, s.y - hall.y) < 1400 && !atHome(s));
  const wasThreat = G.threat;
  G.threat = near.length ? near.reduce((a, s) => (Math.hypot(s.x - hall.x, s.y - hall.y) < Math.hypot(a.x - hall.x, a.y - hall.y) ? s : a)) : null;
  if (G.threat && !wasThreat) note(w, G, `enemy sighted ${Math.round(Math.hypot(G.threat.x - hall.x, G.threat.y - hall.y))} m from the keep`);
  scout(w, G, hall);
  const doy = w.econ.doy;
  if (!foeStands(w, G) && !retarget(w, G)) { G.mode = "victory"; return; }

  if (G.threat && G.mode !== "battle" && G.mode !== "siege" && G.mode !== "march") {
    if (G.mode !== "defend" && G.mode !== "garrison") note(w, G, "musters to defend the vill");
    G.mode = "defend";
    G.army = new Set(field.map((u) => u.id));
    // behind our own palisade when outnumbered; otherwise meet them in front of the vill
    const walled = count(w, team, "palisade", true) >= 8 && est > own * 1.1;
    // a walled vill MANS ITS WALLS (js/sim/townwall.js): the bows go up first, facing the threat, whenever there is a walk
    // to stand on; the foot follow when we are outnumbered (they throw the ladders down); the horse stay below
    const walk = TW.capacity(w, team) >= 20;
    const upW = walk ? field.filter((u) => !ARMS[u.arm].mounted && (ARMS[u.arm].missile || walled)) : [];
    if (upW.length) { const k = TW.manWalls(w, team, upW, G.threat); if (k) note(w, G, `mans the walls: ${k} ${k === 1 ? "company" : "companies"}${upW.some((u) => ARMS[u.arm].missile) ? ", the bows first" : ""}`); }
    const rest = field.filter((u) => !u.tw);
    G.cmd = { team, units: new Set(rest.map((u) => u.id)), disposition: G.D.aggression > 0.7 ? G.disposition : "defensive", V: G.V, anchor: { x: hall.x, y: hall.y } }; // (the men on the walls fight from there: not the battle's to move)
    // no foe in sight yet: form on the best ground between the threat and the keep
    if (walled) G.cmd.anchor = { x: hall.x, y: hall.y };
    if (walled || !rest.some((u) => G.V && seesFoe(w, G, u.ax, u.ay, 700))) {
      const p = walled ? { x: hall.x + (G.threat.x - hall.x) * 0.05, y: hall.y + (G.threat.y - hall.y) * 0.05 } : { x: hall.x + (G.threat.x - hall.x) * 0.25, y: hall.y + (G.threat.y - hall.y) * 0.25 };
      if (walled) { G.mode = "garrison"; }
      // behind walls with no walk to stand on, the garrison stands behind the wall facing the threat
      const ww = walled ? wallFacing(w, team, G.threat) : null;
      if (ww) rest.forEach((u, k) => { const off = (k - (rest.length - 1) / 2) * 30; orderOnce(w, u, "hold", ww.x - ww.nx * 6 - ww.ny * off, ww.y - ww.ny * 6 + ww.nx * off, "quick", Math.atan2(ww.ny, ww.nx), "line"); });
      else rest.forEach((u, k) => orderOnce(w, u, "hold", p.x + (k - rest.length / 2) * 45, p.y, "quick", Math.atan2(G.threat.y - hall.y, G.threat.x - hall.x), "line"));
    }
    return;
  }
  if ((G.mode === "defend" || G.mode === "garrison") && !G.threat) { G.mode = "home"; note(w, G, "the danger passes"); const k = TW.comeDown(w, field); if (k) note(w, G, "the men come down off the walls"); }
  engineThink(w, G, hall);

  if (G.mode === "home") {
    // an empty chest or ripe corn sends the levies (then the paid companies) home to the fields
    const broke = (T.arrearsDays || 0) > 2, harvest = T.harvestTime && G.D.aggression < 0.9;
    if ((broke || harvest) && !G.warden) {
      const order = ["levy", "crossbow", "spearmen", "pikemen", "hobelars", "archers"];
      for (const arm of order) {
        const u = field.find((v) => v.arm === arm && w.units.has(v.id));
        if (u && (arm === "levy" || broke)) { const n = EC.disband(w, u); if (n) { note(w, G, `stands down ${n} ${arm} (${broke ? "no pay" : "harvest"})`); break; } }
      }
    }
    campAtHome(w, G, G.warden ? field.filter((u) => !u.broad && !u.hunt && !u.order?.player) : field, hall); // (no danger: the warden leaves companies on the player's own orders where he sent them)
    // arraying the county takes weeks: no campaign before the musters are in (~3 weeks; a Hotspur marches
    // with what has come in after ten days — the rest can follow)
    const ready = own > 80 && field.reduce((s, u) => s + u.members.length, 0) >= 50 && doy > E.startDoy + 20 - 10 * G.D.aggression;
    const ratio = own / Math.max(1, est * (foeWalls(w, G) ? 1.4 : 1));
    G.campaignPlanned = doy > G.campaignDay - 6;
    const harvestHold = T.harvestTime && G.D.aggression < 0.8;
    // a Hotspur rides out when the season says so; a Stubborn Defender waits to be attacked
    const forced = G.D.aggression >= 0.4 ? (doy > G.campaignDay && ratio > 0.75) || doy > G.campaignDay + 25 : doy > G.campaignDay + 45 && ratio > 1;
    if (ready && !harvestHold && !broke && !G.warden && (ratio > G.attackRatio || forced)) launchCampaign(w, G, field, hall, ratio);
    return;
  }
  if (G.mode === "march") return march(w, G, field, hall);
  if (G.mode === "battle") return battle(w, G, hall);
  if (G.mode === "siege") return siege(w, G, hall);
  if (G.mode === "return") return goHome(w, G, hall);
}

function seesFoe(w, G, x, y, r) {
  for (const s of G.intel.values()) if (!s.workers && w.tick - s.tick < 60 && Math.hypot(s.x - x, s.y - y) < r) return true;
  return false;
}

function observe(w, G) {
  for (const u of w.units.values()) {
    if (!isFoe(w, G.team, u.team) || !u.members.length) continue;
    if (G.V && !canSee(G.V, G.team, u.ax, u.ay)) continue;
    G.intel.set(u.id, { id: u.id, team: u.team, x: u.ax, y: u.ay, n: u.members.length, arm: u.arm, str: str(u), tick: w.tick, workers: !!u.isWorkers, state: u.state });
  }
  // forget sightings whose spot we can see now and which are no longer there, or that are old
  for (const [id, s] of G.intel) {
    const stale = w.tick - s.tick > TPD * 10;
    const gone = G.V && w.tick - s.tick > 30 && canSee(G.V, G.team, s.x, s.y);
    if (stale || gone) G.intel.delete(id);
  }
  if (G.V && canSee(G.V, G.team, G.enemyTown.x, G.enemyTown.y)) G.sawTown = w.tick;
}

function enemyEstimate(w, G) {
  const seen = [...G.intel.values()].filter((s) => !s.workers && s.arm !== "scouts" && w.tick - s.tick < TPD * 8 && (s.team ?? G.foe) === G.foe).reduce((a, s) => a + s.str, 0);
  // until our eyes have been over their vill, trust the rumour; afterwards what we saw, plus a margin
  const recent = G.sawTown && w.tick - G.sawTown < TPD * 6;
  return recent ? seen * 1.15 + 10 : Math.max(seen * 1.15, G.prior * (1 + 0.004 * (w.econ.doy - E.startDoy)));
}

// Walls are remembered once seen (a lord's scouts report the palisade; it doesn't vanish).
function foeWalls(w, G) {
  G.seenWalls ||= new Set();
  for (const b of w.buildings) if (b.team === G.foe && (b.kind === "palisade" || b.kind === "stone_wall") && b.progress >= 0.5 && (!G.V || canSee(G.V, G.team, b.x, b.y))) G.seenWalls.add(b.id);
  for (const id of G.seenWalls) { const b = w.buildings.find((x) => x.id === id); if (!b || b.ruin) G.seenWalls.delete(id); }
  return G.seenWalls.size >= 6;
}

function campAtHome(w, G, field, hall) {
  const dir = Math.atan2(G.enemyTown.y - hall.y, G.enemyTown.x - hall.x);
  field.forEach((u, k) => {
    const x = hall.x + Math.cos(dir) * 110 + Math.cos(dir + Math.PI / 2) * (k - field.length / 2) * 40, y = hall.y + Math.sin(dir) * 110 + Math.sin(dir + Math.PI / 2) * (k - field.length / 2) * 40;
    orderOnce(w, u, "hold", x, y, "march", dir, "line");
  });
}

// ───────────────────────────────────────────────────────── scouting
function scout(w, G, hall) {
  if (!G.scouts.size) return;
  const feats = (w.map.meta?.features || []).filter((f) => ["ford", "bridge_site", "defile", "motte_hill", "ridge", "hill"].includes(f.type)).map((f) => ({ x: f.xy_m[0], y: f.xy_m[1] }));
  const route = [...feats.sort((a, b) => Math.hypot(a.x - hall.x, a.y - hall.y) - Math.hypot(b.x - hall.x, b.y - hall.y)), towards(G.enemyTown, hall, 700)];
  let k = 0;
  for (const id of G.scouts) {
    const u = w.units.get(id); if (!u) continue;
    u.scoutWp ??= (k * 3) % route.length; k++;
    const danger = [...G.intel.values()].some((s) => !s.workers && s.arm !== "scouts" && w.tick - s.tick < 40 && Math.hypot(s.x - u.ax, s.y - u.ay) < 350);
    if (danger || u.state !== "formed") { orderOnce(w, u, "move", hall.x, hall.y, "quick"); u.scoutWp = (u.scoutWp + 1) % route.length; continue; }
    const wp = route[u.scoutWp % route.length];
    if (Math.hypot(wp.x - u.ax, wp.y - u.ay) < 60) u.scoutWp = (u.scoutWp + 1) % route.length;
    const t = route[u.scoutWp % route.length];
    orderOnce(w, u, "move", t.x, t.y, "march", undefined, "loose");
  }
}

// ───────────────────────────────────────────────────────── campaign
function launchCampaign(w, G, field, hall, ratio) {
  const team = G.team;
  // keep a garrison of the weakest foot at home
  // garrison: levies first, then spearmen; the men-at-arms, horse and bows go with the lord
  const rank = { levy: 0, crossbow: 1, pikemen: 2, spearmen: 3 };
  const byStr = field.filter((u) => u.arm in rank).sort((a, b) => rank[a.arm] - rank[b.arm] || a.id - b.id);
  const garrisonWant = militaryStrength(w, team, field) * (0.25 - 0.2 * G.D.aggression);
  const garrison = new Set(); let g = 0;
  for (const u of byStr) { if (g >= garrisonWant) break; if (g + str(u) > garrisonWant * 1.6) continue; garrison.add(u.id); g += str(u); }
  const army = field.filter((u) => !garrison.has(u.id));
  if (!army.length) return;
  G.army = new Set(army.map((u) => u.id)); G.garrison = garrison;
  // the siege train follows the column (all but one springald, left on our own walls)
  let keptSpr = false; G.train = new Set();
  for (const u of G.engineUnits || []) { if (u.arm === "springald" && !keptSpr) { keptSpr = true; continue; } G.train.add(u.id); }
  loadBaggage(w, team, [...G.army], { days: 12, carts: Math.min(3, w.teams[team].store.carts), packhorses: w.teams[team].store.packhorses });
  G.route = planRoute(w, G, centroid(army), G.enemyTown);
  G.wp = 0; G.mode = "march"; G.startStr = militaryStrength(w, team, army); G.marchStart = w.tick;
  note(w, G, `marches on the enemy with ${army.reduce((s, u) => s + u.members.length, 0)} men (odds est. ${ratio.toFixed(2)}, via ${G.route.via})`);
}

// Candidate approaches through the map's crossings; costed by path length, exposure to
// overlooking ground and defiles, and fords under fire (analysis.js — the same numbers the player sees).
export function planRoute(w, G, from, to) {
  const feats = (w.map.meta?.features || []).filter((f) => ["ford", "bridge_site", "defile"].includes(f.type));
  const cands = [{ name: "direct", via: null }, ...feats.map((f) => ({ name: f.name, via: { x: f.xy_m[0], y: f.xy_m[1] } }))];
  const stop = towards(to, from, 450);
  let best = null;
  for (const c of cands) {
    const legs = c.via ? [[from, c.via], [c.via, stop]] : [[from, stop]];
    const pts = []; let ok = true;
    for (const [a, b] of legs) { const p = findPath(w.nav, "foot", a.x, a.y, b.x, b.y); if (!p || !p.length) { ok = false; break; } pts.push(...p); }
    if (!ok) continue;
    // path must actually arrive
    const last = pts[pts.length - 1]; if (Math.hypot(last[0] - stop.x, last[1] - stop.y) > 120) continue;
    // (the march's cost, not its length: a road round by the ford beats a straight line across the moss)
    const len = routeCost(w.nav, "foot", from, pts);
    let risk = 0; const samples = densify(pts, from, 450);
    for (const [x, y] of samples.slice(1, 12)) {
      const A = analysePoint(w, x, y);
      if (A.dominated) risk += 250; if (A.view < 0.25) risk += 150 * (1 - G.D.flank); if (A.water > 0.2) risk += 200; if (A.going < 0.6) risk += 100;
    }
    const cost = len + risk;
    if (!best || cost < best.cost) best = { cost, via: c.name, pts: samples };
  }
  if (!best) return { via: "straight", pts: [[stop.x, stop.y]] };
  best.pts.push([stop.x, stop.y]);
  return best;
}

function densify(pts, from, step) {
  const out = [[from.x, from.y]]; let acc = 0, prev = [from.x, from.y];
  for (const p of pts) { acc += Math.hypot(p[0] - prev[0], p[1] - prev[1]); prev = p; if (acc >= step) { out.push(p); acc = 0; } }
  return out;
}

function armyUnits(w, G) { return [...G.army].map((id) => w.units.get(id)).filter((u) => u && u.members.length); }
const centroid = (us) => { let x = 0, y = 0, n = 0; for (const u of us) { x += u.ax * u.members.length; y += u.ay * u.members.length; n += u.members.length; } return { x: x / n, y: y / n }; };

function march(w, G, field, hall) {
  const us = armyUnits(w, G); if (!us.length) { G.mode = "home"; return; }
  const c = centroid(us);
  if (enemyNear(w, G, c, w.tick < (G.pushOnUntil || 0) ? 220 : 800)) return startBattle(w, G, c);
  if (supplyCheck(w, G, us)) return;
  const pts = G.route.pts; if (G.wp >= pts.length) { columnPace(us, false); G.mode = "siege"; G.siegeStart = w.tick; note(w, G, "arrives before the enemy vill"); return; }
  const [tx, ty] = pts[G.wp];
  if (Math.hypot(tx - c.x, ty - c.y) < 90) { G.wp++; return; }
  columnPace(us);
  // keep the column together: every body marches at the pace of the slowest (columnPace), so the head only
  // halts for stragglers when the ground has really strung it out — and waits until the tail has closed up
  // (hysteresis: halting and starting every think is what made the old column crawl)
  const spread = Math.max(...us.map((u) => Math.hypot(u.ax - c.x, u.ay - c.y)));
  us.forEach((u, k) => {
    const lag = Math.hypot(u.ax - c.x, u.ay - c.y);
    const ahead = (u.ax - c.x) * (tx - c.x) + (u.ay - c.y) * (ty - c.y) > 0;
    const waiting = u.order?.kind === "hold";
    if (ahead && (waiting ? spread > 180 && lag > 60 : spread > 320 && lag > 150)) orderOnce(w, u, "hold", u.ax, u.ay, "march");
    else orderOnce(w, u, "move", tx + (k % 3 - 1) * 35, ty + (Math.floor(k / 3) - 1) * 35, "march", undefined, "column");
  });
}

// One column, one pace: each body's march is capped at the route step of the slowest foot in the army
// (horse walks with the foot on the road; it has no business a mile ahead of them).
function columnPace(us, on = true) {
  let cap = Infinity;
  for (const u of us) if (!ARMS[u.arm].mounted) cap = Math.min(cap, ARMS[u.arm].speed * COLUMN_STEP);
  for (const u of us) u.paceCap = on && Number.isFinite(cap) ? cap : undefined;
}

// A body worth deploying for: scouts and a handful of stragglers don't make a battle.
function enemyNear(w, G, c, r, walled = false) {
  let n = 0; const ring = walled ? foeRing(w, G) : 0;
  for (const s of G.intel.values()) if (!s.workers && s.arm !== "scouts" && w.tick - s.tick < 40 && Math.hypot(s.x - c.x, s.y - c.y) < r && !(ring && Math.hypot(s.x - G.enemyTown.x, s.y - G.enemyTown.y) < ring)) n += s.str;
  return n >= Math.max(10, 0.12 * (G.own || 0));
}

function supplyCheck(w, G, us) {
  // (battle clock is real time: a march across the vale takes ~45 real minutes = weeks of economy time,
  // so no army can carry its bread there. It lives on the convoys — a unit with a cart on its way to it is
  // fed, even while every cart is out of the store — and, close to the objective, off the enemy's land;
  // it turns back when the men are actually going hungry, not when the packs run light)
  const fedByCart = (u) => (w.convoys || []).some((c) => c.phase === "out" && c.to === u.id);
  const days = Math.min(...us.map((u) => (u.outOfSupply && !fedByCart(u) ? baggageDays(u) : 99)));
  const c = centroid(us), toGo = Math.hypot(G.enemyTown.x - c.x, G.enemyTown.y - c.y);
  const bold = 1 + G.D.aggression + G.difficulty; // 1.35 … 2.95 days of hunger before the men won't go on
  const hungry = us.filter((u) => (u.hunger || 0) > bold).length > us.length / 2;
  if (days < 2.5 && toGo < 1500 && !hungry) return false; // near the objective: live off his fields
  const own = militaryStrength(w, G.team, us);
  if ((w.teams[G.team].arrearsDays || 0) > 4 && !G.announcedBroke) { G.announcedBroke = true; note(w, G, "the war chest is empty — the men go unpaid"); }
  // (unpaid men before the enemy's gate stay for the sack — it is what they came for; on the road they go home)
  const unpaid = (w.teams[G.team].arrearsDays || 0) > (G.mode === "siege" ? 40 : 8);
  if (days < 2.5 || hungry || own < G.startStr * 0.35 || unpaid) { G.mode = "return"; G.retreating = true; note(w, G, days < 2.5 || hungry ? "baggage spent — turns for home" : "too weak to go on — falls back"); return true; }
  return false;
}

function startBattle(w, G, c) {
  columnPace(armyUnits(w, G), false);
  G.mode = "battle"; G.battleStart = w.tick; G.battles++;
  G.cmd = { team: G.team, units: G.army, disposition: G.disposition, V: G.V, anchor: c };
  if (w.tick - G.lastBattleTick > TPD) note(w, G, `gives battle near (${Math.round(c.x)}, ${Math.round(c.y)})`);
  G.lastBattleTick = w.tick;
}

function battle(w, G, hall) {
  const us = armyUnits(w, G); if (!us.length) { G.mode = "home"; note(w, G, "the army is destroyed"); return; }
  const c = centroid(us);
  // before his walls, men standing inside them are a garrison, not a field army: no pitched battle to be had,
  // the siege goes on (unless a way in is open and the storm is on)
  if (G.route && G.wp >= G.route.pts.length && foeWalls(w, G) && !enemyNear(w, G, c, 1200, true) && !(G.sub === "storm" && openWay(w, G, G.enemyTown))) { G.mode = "siege"; return; }
  // a stand-off (river between, both on good ground) is not a battle: after two quiet days the
  // attacker pushes on toward its objective and makes the defender come to it
  // storming a vill whose defenders are beaten (scattered, running, a handful left in the field): the fight in
  // the lanes goes on by itself — the lord's business is the keep, and the army goes back to the storm
  if (G.sub === "storm" && Math.hypot(c.x - G.enemyTown.x, c.y - G.enemyTown.y) < 700) {
    const foeStr = [...G.intel.values()].filter((x) => !x.workers && x.arm !== "scouts" && x.state !== "routing" && w.tick - x.tick < 60 && Math.hypot(x.x - c.x, x.y - c.y) < 600).reduce((a, x) => a + x.str, 0);
    if (militaryStrength(w, G.team, us) > foeStr * 2) { G.mode = "siege"; return; }
  }
  const blood = casualtiesNear(w, c, 900);
  if (blood !== G.lastBlood) { G.lastBlood = blood; G.lastBloodTick = w.tick; }
  // a stand-off (river between, both on good ground) is resolved: the stronger or bolder side
  // closes and fights it out; the weaker one on campaign goes home
  const quiet = w.tick - Math.max(G.lastBloodTick || 0, G.battleStart, G.assaultUntil || 0) > TPD * 1.5;
  if (quiet && enemyNear(w, G, c, 1200)) {
    const foes = [...G.intel.values()].filter((x) => !x.workers && x.arm !== "scouts" && w.tick - x.tick < 60 && Math.hypot(x.x - c.x, x.y - c.y) < 1200);
    const foeStr = foes.reduce((a, x) => a + x.str, 0), odds = militaryStrength(w, G.team, us) / Math.max(1, foeStr);
    if (odds >= 1.1 || (G.D.aggression >= 0.7 && odds >= 0.6) || !G.route) {
      const f = foes.reduce((a, x) => (x.str > a.str ? x : a), foes[0]);
      // (long enough to cross the ground between — 40 s used to carry them 70 m before the battle commander,
      // still dressing his line, called them back to it; and when they meet, the line is going IN)
      G.assaultUntil = w.tick + TPD * 4;
      if (G.cmd?.battle) { G.cmd.battle.phase = "engage"; G.cmd.battle.t0 = w.time; }
      us.forEach((u) => orderOnce(w, u, ARMS[u.arm].missile ? "skirmish" : "assault", f.x, f.y, ARMS[u.arm].mounted ? "charge" : "quick"));
      note(w, G, `ends the stand-off: closes with the enemy (odds ${odds.toFixed(2)})`);
    } else { G.mode = "return"; G.retreating = true; G.breakOffUntil = w.tick + TPD; note(w, G, `declines battle at odds ${odds.toFixed(2)} and withdraws`); }
    return;
  }
  if ((w.teams[G.team].arrearsDays || 0) > (G.wp >= (G.route?.pts.length ?? 0) ? 40 : 8) && G.route && !G.retreating) { G.mode = "return"; G.retreating = true; note(w, G, "unpaid men will not stay in the field — withdraws"); return; }
  if (enemyNear(w, G, c, 1200)) { G.lastContact = w.tick; return; }
  if (w.tick - (G.lastContact || G.battleStart) < TPD * 0.3) return;
  const own = militaryStrength(w, G.team, us);
  note(w, G, `the field is clear (strength ${Math.round(own)} of ${Math.round(G.startStr)})`);
  const home = Math.hypot(c.x - hall.x, c.y - hall.y) < 700;
  if (home || !G.route) { G.mode = "home"; return; }
  if (own < G.startStr * 0.45 || G.retreating) { G.mode = "return"; G.retreating = true; return; }
  G.mode = G.wp >= G.route.pts.length ? "siege" : "march";
}

function casualtiesNear(w, c, r) {
  const S = w.S; let n = 0;
  for (let i = 0; i < S.n; i++) if (!S.alive[i] && (S.state[i] === 4 || S.state[i] === 5) && Math.abs(S.x[i] - c.x) < r && Math.abs(S.y[i] - c.y) < r) n++;
  return n;
}

function siege(w, G, hall) {
  const us = armyUnits(w, G); if (!us.length) { G.mode = "home"; return; }
  const c = centroid(us), foeHall = G.enemyTown;
  // (once the storm is on, only a real force — half our strength or more — turns the army from the keep;
  // stragglers and broken companies are fought where they are met)
  const relief = G.sub === "storm" ? [...G.intel.values()].filter((x) => !x.workers && x.arm !== "scouts" && x.state !== "routing" && w.tick - x.tick < 60 && Math.hypot(x.x - c.x, x.y - c.y) < 500).reduce((a, x) => a + x.str, 0) >= militaryStrength(w, G.team, us) * 0.5 : true;
  const walls = foeWalls(w, G);
  if (relief && enemyNear(w, G, c, w.tick < (G.pushOnUntil || 0) ? 150 : 500, walls && !openWay(w, G, foeHall))) return startBattle(w, G, c);
  if (supplyCheck(w, G, us)) return;
  const garrison = [...G.intel.values()].filter((s) => !s.workers && s.state !== "routing" && w.tick - s.tick < TPD && Math.hypot(s.x - foeHall.x, s.y - foeHall.y) < 400).reduce((a, s) => a + s.str, 0); // (men running from the field are no garrison)
  const own = militaryStrength(w, G.team, us);
  // walls: the vill can only be stormed through an opening (a breach, a broken or opened gate, a gap in an
  // unfinished circuit) — the army waits for one, or goes up ladders / a docked tower (siegeWorks)
  if (!G.siegeCamp) G.siegeCamp = campGround(w, foeHall, hall);
  const open = !walls || openWay(w, G, foeHall);
  siegeEngines(w, G, foeHall);
  if (walls && !open && escalade(w, G, us, foeHall, own, garrison)) return;
  if (open && (!walls ? own > garrison * 1.5 + 20 : own > garrison * 2 + 40)) { // through a breach it is a fight in the gap, not an escalade
    // storm the keep's gate: take the place
    us.forEach((u) => orderOnce(w, u, "assault", foeHall.x, foeHall.y, "quick"));
    if (G.sub !== "storm") { G.sub = "storm"; note(w, G, "storms the enemy vill"); }
  } else {
    // invest it: sit on good ground outside bowshot, burn their corn, let hunger work
    if (G.sub !== "invest") { G.sub = "invest"; note(w, G, "invests the enemy vill and fires the fields"); G.siegeCamp = campGround(w, foeHall, hall); }
    const fields = w.buildings.filter((b) => b.field && b.team === G.foe && (b.field.state === "ripe" || b.field.state === "growing") && b.field.left > 0 && !b.fire).sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
    us.forEach((u, k) => {
      if (ARMS[u.arm].mounted && fields[k % Math.max(1, fields.length)]) { const f = fields[k % fields.length]; orderOnce(w, u, "move", f.x, f.y, "quick"); }
      else orderOnce(w, u, "hold", G.siegeCamp.x + (k - us.length / 2) * 40, G.siegeCamp.y, "march", Math.atan2(foeHall.y - G.siegeCamp.y, foeHall.x - G.siegeCamp.x), "line");
    });
  }
}

// ─────────────────────────────────────────────────────── siege works (js/sim/siege.js)
// Is there a way in for foot from our camp to their keep (a breach, a broken or opened gate, an unfinished
// circuit)? The nav grid knows: walls and shut gates close their cells (navblock.js).
function openWay(w, G, foeHall) {
  if (G.openT && w.tick - G.openT.t < 100) return G.openT.v;
  const from = G.siegeCamp || foeHall, p = findPath(w.nav, "foot", from.x, from.y, foeHall.x, foeHall.y);
  const v = !!p && p.length > 0 && Math.hypot(p[p.length - 1][0] - foeHall.x, p[p.length - 1][1] - foeHall.y) < 40;
  G.openT = { t: w.tick, v };
  return v;
}
// radius of the enemy's circuit round his keep (men inside it are his garrison)
export function foeRing(w, G) {
  let r = 0; for (const id of G.seenWalls || []) { const b = w.buildings.find((x) => x.id === id); if (b && b.x1 !== undefined) r = Math.max(r, Math.hypot(b.x1 - G.enemyTown.x, b.y1 - G.enemyTown.y), Math.hypot(b.x2 - G.enemyTown.x, b.y2 - G.enemyTown.y)); }
  return r ? r + 5 : 0;
}
// our own wall nearest a point: { x, y, nx, ny } with n pointing out toward the point
function wallFacing(w, team, from) {
  let best = null, bd = Infinity;
  for (const f of w.features || []) {
    if (f.team !== team || (f.type !== "timber_palisade" && f.type !== "town_wall")) continue;
    const dx = f.x1 - f.x0, dy = f.y1 - f.y0, l2 = dx * dx + dy * dy || 1, t = clamp(((from.x - f.x0) * dx + (from.y - f.y0) * dy) / l2, 0, 1);
    const x = f.x0 + dx * t, y = f.y0 + dy * t, d = Math.hypot(from.x - x, from.y - y);
    if (d < bd) { const L = Math.sqrt(l2); let nx = -dy / L, ny = dx / L; if ((from.x - x) * nx + (from.y - y) * ny < 0) { nx = -nx; ny = -ny; } bd = d; best = { x, y, nx, ny }; }
  }
  return best;
}
// the enemy's wall stretch facing our camp, the module on it nearest the camp, and his gate
function siegeTargets(w, G, foeHall) {
  const camp = G.siegeCamp || foeHall; let wall = null, bd = Infinity, gate = null, gd = Infinity;
  for (const b of w.buildings) {
    if (b.team !== G.foe || b.ruin || (b.progress ?? 1) < 0.5) continue;
    if ((b.kind === "palisade" || b.kind === "stone_wall") && b.x1 !== undefined) { const d = Math.hypot(b.x - camp.x, b.y - camp.y); if (d < bd) { bd = d; wall = b; } }
    if ((b.kind === "gate" || b.kind === "gatehouse") && b.progress >= 1 && !b.gateBroken) { const d = Math.hypot(b.x - camp.x, b.y - camp.y); if (d < gd) { gd = d; gate = b; } }
  }
  const aim = wall ? { x: wall.x, y: wall.y, b: wall } : null;
  const gp = gate ? (() => { const g = gateGeom(gate); return { x: g.px, y: g.py, b: gate }; })() : null;
  return { aim, gate: gp };
}
const standoff = (tgt, camp, d, lat = 0) => { const dx = camp.x - tgt.x, dy = camp.y - tgt.y, L = Math.hypot(dx, dy) || 1; return { x: tgt.x + dx / L * d - dy / L * lat, y: tgt.y + dy / L * d + dx / L * lat, facing: Math.atan2(-dy, -dx) }; };
function engineOrder(w, u, e, key, o) { if (e.aiKey === key) return; e.aiKey = key; issueOrder(w, [u.id], o); }
// The train comes up, is framed up out of bowshot of the wall it will work on, and goes to work: the
// trebuchet on the wall facing the camp, the mangonel and the ram on the gate, the tower against the wall.
function siegeEngines(w, G, foeHall) {
  const camp = G.siegeCamp || foeHall, T = siegeTargets(w, G, foeHall);
  const train = [...(G.train || [])].map((id) => w.units.get(id)).filter((u) => u && u.members.length);
  train.forEach((u, k) => {
    const e = engineOf(w, u); if (!e || e.state === "burnt") return;
    const main = e.kind === "ram" || e.kind === "mangonel" ? T.gate || T.aim : T.aim; if (!main) return;
    if (e.state === "packed") {
      const d = { trebuchet: 185, mangonel: 90, ram: 150, siege_tower: 140 }[e.kind] || 120, lat = e.kind === "siege_tower" ? 20 : e.kind === "trebuchet" ? -12 * (k % 3) : 0;
      const p = standoff(main, camp, d, lat);
      engineOrder(w, u, e, "pack" + main.b.id, { kind: "assemble", x: p.x, y: p.y, facing: p.facing, immediate: false });
      return;
    }
    if (e.state !== "ready") return;
    if (e.kind === "trebuchet" || e.kind === "mangonel") { if (!e.tgt) { e.aiKey = null; engineOrder(w, u, e, "bomb" + main.b.id + ":" + w.tick, { kind: "bombard", x: main.x, y: main.y, bid: main.b.id }); } return; }
    if (e.kind === "ram") { if (T.gate && !e.tgt) engineOrder(w, u, e, "ram" + T.gate.b.id, { kind: "batter", x: T.gate.x, y: T.gate.y, bid: T.gate.b.id }); return; }
    if (e.kind === "siege_tower") { if (!e.tgt && T.aim) { const p = standoff(T.aim, camp, 0, 20); engineOrder(w, u, e, "tw" + T.aim.b.id, { kind: "advance", x: p.x, y: p.y }); } return; }
    if (e.kind === "mantlet") { const p = standoff(T.aim || main, camp, 70, (k % 4 - 1.5) * 4); engineOrder(w, u, e, "mt" + main.b.id, { kind: "move", x: p.x, y: p.y, facing: p.facing }); return; }
    if (e.kind === "springald") { const p = standoff(T.aim || main, camp, 160, 30); engineOrder(w, u, e, "sp" + main.b.id, { kind: "move", x: p.x, y: p.y, facing: p.facing }); }
  });
}
// No way in yet: a docked tower is used at once; ladders when we are strong (3:1 and more), or when the
// engines have been at it for a week without an opening. Returns true while an escalade is on.
function escalade(w, G, us, foeHall, own, garrison) {
  const foot = us.filter((u) => !ARMS[u.arm].mounted && !ARMS[u.arm].missile && !ARMS[u.arm].engine).sort((a, b) => b.members.length - a.members.length);
  const on = foot.filter((u) => u.esc || u.order?.kind === "escalade" || u.pendingOrder?.kind === "escalade");
  if (on.length) return true;
  const tw = [...(G.train || [])].map((id) => w.units.get(id)).map((u) => u && engineOf(w, u)).find((e) => e && e.kind === "siege_tower" && e.docked && e.bridge >= 1);
  const T = w.teams[G.team], ladders = (T.store.ladders || 0) + Math.floor((T.store.timber || 0) / 35);
  const long = G.siegeStart && w.tick - G.siegeStart > TPD * 7;
  const strong = own > garrison * 3 + 60;
  const scouted = G.siegeStart && w.tick - G.siegeStart > TPD * 0.5; // (the walls are looked over before the ladders go up)
  if (!tw && !(scouted && ladders >= 4 && (strong || (long && own > garrison * 1.6 + 30)))) return false;
  if (w.tick < (G.escAgain || 0)) return false;
  const T0 = siegeTargets(w, G, foeHall), camp = G.siegeCamp || foeHall;
  const at = tw ? { x: tw.docked.x, y: tw.docked.y } : T0.aim ? standoff(T0.aim, camp, 0, 0) : null; if (!at) return false;
  foot.slice(0, tw ? 2 : 3).forEach((u, k) => issueOrder(w, [u.id], { kind: "escalade", x: at.x + (tw ? 0 : (k - 1) * 22), y: at.y, pace: "quick", then: { x: foeHall.x, y: foeHall.y } }));
  G.escAgain = w.tick + TPD * 2;
  note(w, G, tw ? "sends men across from the siege tower" : "orders an escalade: ladders to the walls");
  return true;
}
// Engines at home stand on our walls facing the threat (springald, mangonel); the rest of the park waits by
// the keep. On campaign the train follows the column; after a battle it goes on; going home, it goes home.
function engineThink(w, G, hall) {
  const us = G.engineUnits || []; if (!us.length) return;
  const away = G.mode === "march" || G.mode === "battle" || G.mode === "siege" || G.mode === "return";
  const army = armyUnits(w, G), c = army.length ? centroid(army) : hall;
  const threat = G.threat || G.enemyTown;
  us.forEach((u, k) => {
    const e = engineOf(w, u); if (!e || e.state === "burnt") return;
    const inTrain = away && G.train?.has(u.id);
    if (inTrain) {
      if (G.mode === "siege") return; // siegeEngines has them
      if (G.mode === "battle" && G.route && G.wp >= G.route.pts.length) { if (k === 0) siegeEngines(w, G, G.enemyTown); return; } // a fight before his walls: the engines keep at their work
      const dir = Math.atan2(G.enemyTown.y - c.y, G.enemyTown.x - c.x);
      if (G.mode === "march") engineOrder(w, u, e, "m" + Math.round(c.x / 150) + ":" + Math.round(c.y / 150), { kind: "move", x: c.x - Math.cos(dir) * (70 + k * 15), y: c.y - Math.sin(dir) * (70 + k * 15), pace: "march" });
      else if (G.mode === "return") engineOrder(w, u, e, "home", { kind: "move", x: hall.x + (k % 3) * 15, y: hall.y + 40 + Math.floor(k / 3) * 15, pace: "march" });
      return;
    }
    if ((e.kind === "springald" || e.kind === "mangonel") && e.state === "ready") {
      const ww = wallFacing(w, G.team, threat);
      if (ww) { const off = (k - (us.length - 1) / 2) * 16; engineOrder(w, u, e, "wall" + Math.round(ww.x) + ":" + Math.round(ww.y), { kind: "move", x: ww.x - ww.nx * (e.kind === "mangonel" ? 22 : 10) - ww.ny * off, y: ww.y - ww.ny * (e.kind === "mangonel" ? 22 : 10) + ww.nx * off, facing: Math.atan2(ww.ny, ww.nx), pace: "march" }); return; }
    }
    if (e.state === "packed" || e.state === "ready") engineOrder(w, u, e, "park", { kind: "move", x: hall.x + 30 + (k % 3) * 14, y: hall.y - 30 - Math.floor(k / 3) * 14, pace: "march" });
  });
}

function campGround(w, target, from) {
  const dir = Math.atan2(from.y - target.y, from.x - target.x);
  let best = null, bs = -Infinity;
  for (let a = -0.9; a <= 0.9; a += 0.3) {
    const x = target.x + Math.cos(dir + a) * 380, y = target.y + Math.sin(dir + a) * 380;
    if (!w.map.inBounds(x, y) || w.map.water(x, y) > 0.1) continue;
    const s = analysePoint(w, x, y).defensible - Math.abs(a) * 0.1; if (s > bs) { bs = s; best = { x, y }; }
  }
  return best || towards(target, from, 380);
}

function goHome(w, G, hall) {
  const us = armyUnits(w, G); if (!us.length) { G.mode = "home"; return; }
  const c = centroid(us);
  // a withdrawing army only turns to fight if caught — its men actually locked with the enemy, and not in
  // the first day of breaking off, while it is still within a bowshot of the host it has just declined (it
  // used to turn and re-offer battle every minute whenever any enemy stood within 120 m, and never got away)
  const caught = G.retreating ? us.some((u) => u.hold) && !(w.tick < (G.breakOffUntil || 0)) : enemyNear(w, G, c, 500);
  if (caught) return startBattle(w, G, c);
  // the camp is outside the palisade (the ring blocks the nav grid except at the gate)
  if (Math.hypot(c.x - hall.x, c.y - hall.y) < 330) { columnPace(us, false); G.mode = "home"; G.route = null; G.retreating = false; note(w, G, "the army is home"); G.campaignDay = w.econ.doy + 12; return; }
  const dir = Math.atan2(G.enemyTown.y - hall.y, G.enemyTown.x - hall.x);
  columnPace(us);
  us.forEach((u, k) => orderOnce(w, u, "move", hall.x + Math.cos(dir) * 140 + (k % 3 - 1) * 40, hall.y + Math.sin(dir) * 140 + Math.floor(k / 3) * 30, "march", undefined, "column"));
}

// Avoid re-issuing the same order every think (issueOrder resets the path).
function orderOnce(w, u, kind, x, y, pace = "march", facing, formation) {
  const o = u.order;
  if (o && o.kind === kind && Math.hypot((o.x ?? 1e9) - x, (o.y ?? 1e9) - y) < 30 && u.pace === pace) return;
  if (!w.map.inBounds(x, y)) { x = clamp(x, w.map.x0 + 5, w.map.x1 - 5); y = clamp(y, w.map.y0 + 5, w.map.y1 - 5); }
  issueOrder(w, [u.id], { kind, x, y, pace, facing, formation });
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
