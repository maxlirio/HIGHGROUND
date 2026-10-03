import { terrainAt } from "./landread.js";
// Town economy: real people doing real work (docs/economy-research.md; tables in econ-data.js).
//
// PEOPLE. Every labourer is one dot (arm "villager") with a ROLE (woman, man, pool archer,
// pool spearman, rider, smith, fletcher, weaver, carpenter, mason, adept). Dependants (children,
// the old) and squires are counted, not drawn. Soldiers are drafted FROM the labourers — every man
// you take stops working, and at harvest that costs grain. A census ledger proves no one is ever
// created or lost off the books (tools/playtest.mjs asserts it every tick).
//
// TWO CLOCKS (js/sim/clock.js). Labour, growth, rations and training run on the economic clock
// (1 real min = 1.5 econ days); fire and movement run on the battle clock. A worker's commute and
// his loads cannot both be drawn at battle speed (a 500 m haul would eat 2 econ days), so:
//   • worker dots physically go to their job (at E.commuteMul × walking speed when safe) and stand
//     there — raiders can catch them;
//   • hauling is ANALYTIC: every kg carried to the nearest store costs man-days by carrier type
//     (man 30 kg, packhorse 90 kg, cart 500 kg, ox-cart 600 kg, research §4) and distance; that
//     share of the crew is drawn walking the road between node and store (hauler dots).
// Output per worker = yield/man-day × workday share × daylight × hunger × unrest × mill.
import { buildEffects } from "./land.js";
import { S_IDLE, S_MOVE, S_WORK, S_FLEE, S_FIGHT, S_DEAD, S_DOWN, clamp } from "./soldiers.js";
import { ARMS } from "./arms.js";
import { TICK, addUnit, splitUnit, mergeUnits, neighbours, VILLAGER_OBEY_TICKS } from "./world.js";
import { BATTLE_RATE, ECON_DAYS_PER_REAL_SEC } from "./clock.js";
import { E, BUILDINGS, RECIPES, RECRUITS, PAY, PRICES, SPREAD, CROPS, ROLE, ROLES, MALE, START, SLOW_TRAINING, SPELLS } from "./econ-data.js";
import { NODE_KINDS } from "./resources.js";
import { navSetBlock, segCells } from "./navblock.js";
import { engineMustered } from "./siege.js";
import { MOUNTS, MOUNT_ID, M_SPDA, M_SPD, mountIdxFor, mountFits, remount } from "./mounts.js"; // learned mounts (docs/mounts-wildlife-spec.md)
import { HORSES } from "./kit.js";
import { isFoe } from "./sides.js";
import * as LB from "./labor.js";
import * as WN from "./wallnav.js"; // (town walls: villagers go out to their work and home again by the gates)
import * as RV from "./rivers.js"; // (rivers: villagers go over by the fords and bridges, never through the deep water)
import * as BRG from "./bridges.js"; // (a house's timber bridges: where their builders stand)
import "./jobs/index.js"; // (the gathering lanes register their jobs into labor.js: docs/gathering-plan.md)
import * as FL from "./jobs/fields.js"; // (lane A: the fields' year, js/sim/jobs/fields.js)
import * as HL from "./jobs/haulage.js"; // (lane D: a site's materials are carried to it, js/sim/jobs/haulage.js)
import { errandMen } from "./jobs/quarry.js"; // (lane E: villagers on errands at home still count as working)
import { weather as weatherOf } from "./ground.js";
import * as TC from "./tech.js"; // the research track (docs/tech.md): every hook below reads TC.mul/add/craftMul/recruitMods (identity without research)
import * as LE from "./estates.js"; // the late game's great buildings (their effects come through TC.mul/add; here: the upgrade and the daily doings)
import { LABOR_WX } from "./weather.js";
import * as TW from "./towns.js"; // (a house's daughter towns: each runs in its own frame — js/sim/towns.js, js/sim/founding.js)
import * as DM from "./demolish.js"; // (pulling down, and palisades rebuilt in stone: js/sim/demolish.js)
import * as VN from "./veins.js"; // (silver and gold veins: only the holder's men mine one — js/sim/veins.js)

// How readily anything takes and keeps fire under this sky (WEATHER.fireSpreadMul: clear 1, drizzle 0.3,
// rain 0.05, heavy rain / storm / snow 0 — fires neither start nor spread in a downpour).
const fireWx = (w) => weatherOf(w).fireSpreadMul ?? 1;

export const inFieldRect = (b, x, y, m = 0) => { const r = b.rot || 0, c = Math.cos(r), s = Math.sin(r), dx = x - b.x, dy = y - b.y; return Math.abs(dx * c + dy * s) < b.w / 2 + m && Math.abs(dy * c - dx * s) < b.h / 2 + m; }; // (a field lies at its furlong's angle)
export { E, BUILDINGS, RECIPES, RECRUITS, PRICES, ROLE, ROLES };
export const S_GONE = 31;                          // dot left the map (drafted, emigrated, deserted): not a casualty
export const DT = TICK * ECON_DAYS_PER_REAL_SEC;  // econ days per tick
const BT = TICK * BATTLE_RATE;                    // battle seconds per tick
const FOOD = ["fresh", "grain", "sheaves", "seed"];

// ────────────────────────────────────────────────────────────── setup
export function initEconomy(w, { startDoy = E.startDoy } = {}) {
  w.econ = { startDoy, doy: startDoy, dayIndex: 0, role: new Map(), practice: new Map(), winner: null, log: [], jobFor };
  w.buildings = w.buildings || [];
  w.resources = w.resources || [];
  return w.econ;
}

// `structures`: placed start buildings from maps/<name>/objects.json ({kind,x,y,rot,team,start}); used
// instead of the procedural layout where given, so the sim and the rendered models agree.
const STRUCT_KIND = { watermill: "mill" };
export function makeTown(w, team, x, y, structures = [], { plots = [], prebuilt = true } = {}) {
  if (!w.econ) initEconomy(w);
  const T = w.teams[team];
  T.town = { x, y };
  T.store = { ...START.store };
  T.sheep = START.sheep; T.squires = START.squires; T.dependants = START.dependants;
  T.unrest = 0.05; T.ration = 1; T.starveAcc = 0; T.arrears = 0; T.besieged = false; T.fallen = false;
  T.acc = { birth: 0, death: 0, starve: 0, imm: 0, emi: 0 };
  T.market = { recent: {} };
  T.day = { buildDays: 0, craftDays: 0, wages: 0, income: 0 };
  T.stats = { harvested: 0, bought: 0, sold: 0, starvedDays: 0 };
  delete T.tech; // (a new foundation knows nothing yet: research starts over — js/sim/tech.js)
  const mine = !prebuilt ? [] : structures.filter((o) => o.team === team && o.start && BUILDINGS[STRUCT_KIND[o.kind] || o.kind] && !BUILDINGS[STRUCT_KIND[o.kind] || o.kind].perMetre);
  const hs = (prebuilt ? mine : structures.filter((o) => o.team === team)).find((o) => o.kind === "town_hall");
  if (hs) { x = hs.x; y = hs.y; T.town = { x, y }; }
  const hall = placeBuilding(w, team, "town_hall", x, y, hs?.rot || 0, true);
  T.hall = hall.id;
  const placed = { house: 0 };
  for (const o of mine) {
    const kind = STRUCT_KIND[o.kind] || o.kind; if (kind === "town_hall") continue;
    const b = placeBuilding(w, team, kind, o.x, o.y, o.rot || 0, true); b.objectId = o.id;
    placed[kind] = (placed[kind] || 0) + 1;
  }
  // the rest of the prebuilt village: church, smithy, weaver, mill, cottages; then open fields
  const ring = (k, n, r0) => { const a = k * 2.399 + team * 0.7, r = r0 + 8 * Math.sqrt(k); return [x + Math.cos(a) * r, y + Math.sin(a) * r]; };
  if (prebuilt) START.prebuilt.forEach((kind, k) => { if (placed[kind]) return; const [bx, by] = ring(k, 4, 38); placeBuilding(w, team, kind, bx, by, 0, true); });
  // remaining cottages go on the village's own house plots (tofts along the lanes), nearest the hall first
  const free = plots.filter((p) => p.house && !mine.some((o) => Math.hypot(o.x - p.house.x, o.y - p.house.y) < 4))
    .sort((a, b) => Math.hypot(a.house.x - x, a.house.y - y) - Math.hypot(b.house.x - x, b.house.y - y));
  for (let k = placed.house; prebuilt && k < START.houses; k++) {
    const p = free.shift();
    if (p) { const b = placeBuilding(w, team, "house", p.house.x, p.house.y, p.house.rot || 0, true); b.plot = p.id; }
    else { const [bx, by] = ring(k + 6, START.houses, 55); placeBuilding(w, team, "house", bx, by, (k * 0.9) % 3.14, true); }
  }
  T.freePlots = free; // where new houses should go when the player builds them
  if (prebuilt) layFields(w, team, x, y);
  // people
  const cen = (T.census = { start: 0, births: 0, immigrants: 0, inTraining: 0, deserted: 0, emigrated: 0, starved: 0, died: 0 });
  // a keep-only start is the lord's household and servants, sized to what the keep can shelter
  // a new foundation: the lord's household in the keep + settler families under canvas in a camp that
  // empties as cottages are built (T.camp shelters people until then)
  const scale = prebuilt ? 1 : 0.9;
  if (!prebuilt) T.camp0 = 90;
  const labour = Object.fromEntries(Object.entries(START.labour).map(([r, n]) => [r, Math.max(r === "adept" || r === "smith" || r === "mason" || r === "carpenter" ? 1 : 0, Math.round(n * scale))]));
  if (!prebuilt) T.dependants = Math.round(START.dependants * 0.5);
  let total = 0; for (const n of Object.values(labour)) total += n;
  const home = addUnit(w, { team, arm: "villager", count: total, x: x + 20, y: y - 20, formation: "loose", training: 0.1 });
  home.isWorkers = true; home.job = { kind: "home" }; T.homeUnit = home.id;
  let k = 0;
  for (const [role, n] of Object.entries(labour)) for (let i = 0; i < n; i++) w.econ.role.set(home.members[k++], ROLE[role]);
  let retinue = 0;
  for (const r of START.retinue) {
    const u = addUnit(w, { team, arm: r.arm, count: r.count, x: x + (retinue % 3) * 30 - 30, y: y + 40, formation: "line", training: r.arm === "knights" ? 0.8 : r.arm === "menatarms" ? 0.65 : 0.6 });
    u.retinue = true; u.supply = { food: 0, arrows: 0, carts: 0, packhorses: 0 };
    retinue += r.count;
  }
  cen.start = total + retinue + T.dependants + T.squires;
  // a new foundation brings its provisions: grain enough to carry the settlers (and the lord's household
  // and retinue) to their first harvest — their fields are not yet sown on 1 May — less what the gardens,
  // dairy and the wild will give. Without it the hamlet starves in the hungry gap whatever the player does.
  if (!prebuilt) {
    const firstRipe = Math.min(...Object.values(CROPS).map((c) => c.ripe));
    const days = firstRipe - w.econ.startDoy + E.provisionMarginDays;
    const want = dailyFoodNeed(w, team) * days * E.provisionShare;
    if (want > foodStock(T)) give(T, "grain", want - foodStock(T));
  }
  return T;
}

// A field on the ground: crop state machine. Fields laid out mid-season are sown late → reduced yield.
export function initField(b, crop, wdt, hgt, lateness = 0) {
  const C = CROPS[crop], ha = wdt * hgt / 1e4;
  b.w = wdt; b.h = hgt;
  b.field = { crop, ha, care: 0.5, left: C ? ha * C.yieldKgHa * (1 - 0.6 * lateness) : 0, yieldKgHa: C?.yieldKgHa || 0, seedFrac: C ? C.seedKgHa / C.yieldKgHa : 0, ripe: C?.ripe || 999, state: C ? "growing" : "fallow", burnt: 0,
    fresh: true }; // (lane A: a new field is ploughed and sown before it grows — js/sim/jobs/fields.js initCycle)
  return b;
}
// What the ground under a plot is: painted arable (the map's old open fields) or fresh grass. A plot on fresh
// grass is VIRGIN: nothing shows on the ground until the plough has actually turned it (render/jobs/fields.js).
const ARABLE_SURF = { fallow: 1, ploughed_field: 1, standing_wheat: 1, standing_barley: 1, standing_oats_beans: 1, stubble: 1, pasture: 1 };   // (pasture: the furlongs' headlands)
const CROPPED_SURF = { fallow: 1, ploughed_field: 1, standing_wheat: 1, standing_barley: 1, standing_oats_beans: 1, stubble: 1 };             // ground a plough has demonstrably been over
export function arableFrac(map, fx, fy, wdt, hgt, rot = 0, SET = ARABLE_SURF) {
  if (!map?.surfaceAt) return 0;
  const c = Math.cos(rot), s = Math.sin(rot); let hit = 0, tot = 0;
  for (let py = -0.42; py <= 0.43; py += 0.21) for (let px = -0.42; px <= 0.43; px += 0.21) {
    const lx = px * wdt, ly = py * hgt, sx = fx + lx * c - ly * s, sy = fy + lx * s + ly * c;
    if (!map.inBounds(sx, sy)) continue;
    tot++; if (SET[map.surfaceAt(sx, sy)]) hit++;
  }
  return tot ? hit / tot : 0;
}
// mark a laid-out field VIRGIN when its ground is not the map's painted farmland: nothing shows on it until the
// plough has actually turned it (js/render/jobs/fields.js). Old farmland instead reads as last season's ground.
export function setFieldGround(w, b) {
  if (!b?.field) return;
  if (arableFrac(w.map, b.x, b.y, b.w, b.h, b.rot || 0, CROPPED_SURF) < 0.45) b.field.virgin = 1;
}
// dry, flat, in bounds, away from the resource nodes — at the rect's rotated centre and corners — and not over
// anything already standing (the village's tofts run close to its old furlongs)
function fieldSiteOk(w, map, fx, fy, wdt, hgt, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  for (const [px, py] of [[0, 0], [-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) {
    const lx = px * wdt, ly = py * hgt, sx = fx + lx * c - ly * s, sy = fy + lx * s + ly * c;
    if (!map.inBounds(sx, sy)) return false;
    if (map.water(sx, sy) > 0.02 || Math.hypot(...map.grad(sx, sy)) > 0.18) return false;
  }
  // a worked site (wood, quarry, pit, mine…) keeps its own ground clear; game, foraging and fishing grounds don't stop the
  // plough — beasts graze and folk forage beside the furlongs. Measured from the field's own rectangle, not its centre
  // (a 180 m ring round the centre threw out most of a vill's painted furlongs)
  for (const q of w.resources || []) {
    if (q.kind === "hunt" || q.kind === "forage" || q.kind === "fish") continue;
    const dx = q.x - fx, dy = q.y - fy, lx = Math.abs(dx * c + dy * s) - wdt / 2, ly = Math.abs(dy * c - dx * s) - hgt / 2;
    if (Math.hypot(Math.max(0, lx), Math.max(0, ly)) < (q.r || 0) + 25) return false;
  }
  for (const b of w.buildings) {   // no plot over a standing building (the field's frame; a clearance of 3 m)
    if (b.field || b.ruin || b.x1 !== undefined) continue;
    const fp = BUILDINGS[b.kind]?.footprint || [10, 8], R = Math.hypot(fp[0], fp[1]) / 2 + 3;
    if (Math.hypot(b.x - fx, b.y - fy) > Math.hypot(wdt, hgt) / 2 + R) continue;
    const dx = b.x - fx, dy = b.y - fy, lx = dx * c + dy * s, ly = dy * c - dx * s;
    if (Math.abs(lx) < wdt / 2 + R && Math.abs(ly) < hgt / 2 + R) return false;
  }
  return true;
}
// A town plan's FIELD plots: none any more. The land is grass (js/sim/map.js grassOver) and a field is a rectangle the
// player draws, or the reeve picks, and the men make (js/sim/jobs/fields.js fieldRect / layField / pickFieldRect). Kept so
// the plan builders (main.js, server/world.mjs) need no change: they lay no field plots.
export function fieldSites() { return []; }

// The prebuilt village's open fields (?prebuilt: worked before the game began): rectangles the reeve's survey picks round
// the vill, already made, cleared and in the ground (three-field rotation, ⅓ fallow) — until it holds ~152 ha.
function layFields(w, team, x, y) {
  const crops = ["wheat", "barley", "wheat", "oats", "peas", "fallow", "wheat", "barley", "oats", "fallow", "wheat", "barley", "oats", "peas", "fallow", "fallow", "fallow"];
  let c = 0, area = 0;
  for (let k = 0; k < 40 && area < 1520000; k++) {
    const r = FL.pickFieldRect(w, team, { ha: 4, near: { x, y } }); if (!r) break;
    const L = FL.layField(w, team, r, { by: "prebuilt" }); if (!L.b) break;
    const b = L.b, crop = crops[c++ % crops.length];
    delete b.field.make; delete b.field.soil; b.field.clr = 0;   // (cleared long ago: its trees are not there — fields.js clearGround)
    initField(b, crop, b.w, b.h); delete b.field.fresh;
    if (CROPS[crop]) b.field.sown = CROPS[crop].sown; else b.field.virgin = 1;   // (the prebuilt open fields are already in the ground)
    area += b.w * b.h;
  }
}

// ────────────────────────────────────────────────────────────── buildings
export function placeBuilding(w, team, kind, x, y, rot = 0, complete = false, opts = {}) {
  const def = BUILDINGS[kind]; if (!def) return null;
  const T = w.teams[team]; const len = def.perMetre ? opts.length || 10 : 1;
  if (!complete) {
    if (def.prebuiltOnly) return null;
    const need = scaleCost(def, len);
    if (!canAfford(T, need)) return null;
    for (const [r, n] of Object.entries(need)) take(T, r, n);
  }
  // the ground decides: soft ground needs piles, rock is strong, woodland must be cleared, etc. (land.js)
  const fx = kind === "field" || !w.map?.surfaceAt ? null : buildEffects(w.map, kind, x, y);
  const hpMax = def.hp * len * (fx?.hpMul || 1) * (def.stone && (def.wall || kind === "gatehouse") ? TC.mul(w, team, "wallHp") : 1); // (research: concentric design)
  const b = {
    id: (w.nextBuilding = (w.nextBuilding || 0) + 1), kind, team, x, y, rot, progress: complete ? 1 : 0,
    hp: complete ? hpMax : hpMax * 0.05, hpMax, length: def.perMetre ? len : 0, queue: [], make: null, work: 0,
    sight: def.sight, eyeH: def.eyeH, rally: { x: x + 25, y: y - 25 }, fire: 0, ruin: false, stage: complete ? "complete" : "build1",
    land: fx ? { key: fx.land.key, labourMul: fx.labourMul, outMul: fx.outMul, fireMul: fx.fireMul, lines: fx.lines } : null,
  };
  // labour = man-days on site + hauling the materials from the store (analytic, §4)
  const matKg = Object.values(def.mat || {}).reduce((s, v) => s + v, 0) * len;
  const hallB = hallOf(w, team);
  const haul = hallB ? haulManDaysPerKg(w, team, Math.hypot(hallB.x - x, hallB.y - y), matKg) * matKg : 0;
  let labour = def.labour * len;
  if (def.earthwork) { const dig = terrainAt(w, x, y)?.digIn ?? 1; labour += def.earthwork * len * (1 / Math.max(0.2, dig) - 1); } // hard ground digs slowly
  b.labour = labour + haul;
  if (b.land) b.labour *= b.land.labourMul;
  if (opts.x1 !== undefined) Object.assign(b, { x1: opts.x1, y1: opts.y1, x2: opts.x2, y2: opts.y2 });
  w.buildings.push(b);
  if (!complete) HL.orderMaterials(w, b, T, scaleCost(def, len)); // (lane D: set aside at the store, carried to the site)
  if (complete && def.wall) blockWall(w, b, true);
  return b;
}

export function placeWall(w, team, kind, x1, y1, x2, y2, complete = false) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  return placeBuilding(w, team, kind, (x1 + x2) / 2, (y1 + y2) / 2, Math.atan2(y2 - y1, x2 - x1), complete, { length, x1, y1, x2, y2 });
}

export const scaleCost = (def, len = 1) => { const c = {}; for (const [r, n] of Object.entries(def.mat || {})) c[r] = n * len; if (def.money) c.silver = def.money; return c; };
export const canAfford = (T, need) => Object.entries(need).every(([r, n]) => (T.store[r] || 0) >= n);
export function costOf(kind, len = 1) { return scaleCost(BUILDINGS[kind], len); }

export function stageOf(b) {
  if (b.ruin) return "ruin";
  if (b.fire > 0) return "burning";
  if (b.progress < 0.4) return "build1";
  if (b.progress < 1) return "build2";
  if (b.hp < b.hpMax * 0.6) return "damaged";
  return "complete";
}

const hallOf = (w, team) => { const T = w.teams[team], h = T?.hall !== undefined ? w.buildings.find((b) => b.id === T.hall && !b.ruin) : null; return h || w.buildings.find((b) => b.team === team && b.kind === "town_hall" && !b.ruin); }; // (the town's own hall: a daughter town's, in its frame)
export const complete = (b) => b.progress >= 1 && !b.ruin && !b.razing; // (a building being pulled down no longer works: js/sim/demolish.js)
export const hasBuilding = (w, team, kind) => w.buildings.some((b) => b.team === team && b.kind === kind && complete(b));

// Walls block the nav grid (all move classes) while standing; gates are gaps. Only the stretch's intact
// 6 m modules close their cells: a breach (siege.js) opens the cells of the broken modules
// (navblock.js reference-counts cells shared with a neighbouring stretch or a gate's flank).
export function blockWall(w, b, on) {
  if (!w.nav || b.x1 === undefined) return;
  if (!on) { navSetBlock(w, "w" + b.id, null); b.navSaved = null; return; }
  const n = wallModules(b), cells = [];
  for (let k = 0; k < n; k++) {
    if (b.mods && b.mods[k] <= 0) continue;
    const t0 = k / n, t1 = (k + 1) / n;
    cells.push(...segCells(w, b.x1 + (b.x2 - b.x1) * t0, b.y1 + (b.y2 - b.y1) * t0, b.x1 + (b.x2 - b.x1) * t1, b.y1 + (b.y2 - b.y1) * t1));
  }
  navSetBlock(w, "w" + b.id, cells);
  b.navSaved = true;
}
// a wall stretch is laid (and drawn, render/buildings.js) as 6 m modules
// repairs go first to the worst module (a breach is stopped with timber, then rebuilt); a module that
// stands again closes its nav cells and features again
function repairModules(w, b, gain) {
  const per = b.hpMax / b.mods.length; let reblock = false;
  while (gain > 1e-6) {
    let k = 0; for (let j = 1; j < b.mods.length; j++) if (b.mods[j] < b.mods[k]) k = j;
    if (b.mods[k] >= per) break;
    const add = Math.min(gain, per - b.mods[k]); if (b.mods[k] <= 0 && add > 0) reblock = true;
    b.mods[k] += add; gain -= add;
  }
  if (reblock) { blockWall(w, b, true); w.featuresVer = (w.featuresVer || 0) + 1; b.breachVer = (b.breachVer || 0) + 1; }
}
export const wallModules = (b) => Math.max(1, Math.round(Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 6));

export function damageBuilding(w, b, hp, fire = 0) {
  if (b.ruin) return;
  b.hp -= hp;
  // the Keep's Peace (the realm, docs/realm-world.md): a keep whose lord is away is battered but does not come down
  const TP = w.teams[b.team]; if (TP?.keepsPeace && b.id === TP.hall && b.hp < b.hpMax * KEEP_FLOOR) b.hp = b.hpMax * KEEP_FLOOR;
  if (b.mods && hp > 0) { const per = hp / b.mods.length; for (let k = 0; k < b.mods.length; k++) b.mods[k] = Math.max(b.mods[k] > 0 ? 1 : 0, b.mods[k] - per); } // (spread damage wears, it does not breach)
  if (fire && BUILDINGS[b.kind].flammable) b.fire = Math.max(b.fire, Math.min(1, fire * BUILDINGS[b.kind].flammable * (b.land?.fireMul || 1) * fireWx(w) * TC.mul(w, b.team, "fire"))); // (rain-soaked thatch takes light badly: WEATHER.fireSpreadMul)
  if (b.hp <= 0) ruinBuilding(w, b);
}

const KEEP_FLOOR = 0.25;
export function ruinBuilding(w, b, quiet = false) {
  b.hp = 0; b.ruin = true; b.fire = 0; b.stage = "ruin";
  const def = BUILDINGS[b.kind], T = w.teams[b.team];
  if (def.wall) blockWall(w, b, false);
  // a burnt granary takes its share of the grain with it
  if (b.kind === "granary" && b.progress >= 1) { const lost = Math.min(T.store.grain, def.capacity.grain) * 0.8; take(T, "grain", lost); take(T, "sheaves", T.store.sheaves * 0.5); }
  if (!quiet) w.events.push({ t: w.tick, kind: "building-lost", building: b.id, team: b.team, what: b.kind });
  if (b.kind === "town_hall") { if (b.town) TW.townById(T, b.town) && (TW.townById(T, b.town).hallLost = true); else T.fallen = true; } // (a daughter's manor hall burnt: that town is lost — js/sim/founding.js — not the house)
}

// ────────────────────────────────────────────────────────────── stores
export function take(T, r, n) { const have = T.store[r] || 0; const got = Math.min(have, Math.max(0, n)); T.store[r] = have - got; if (T.store[r] < 1e-9) T.store[r] = 0; return got; }
export function give(T, r, n) { if (n > 0) T.store[r] = (T.store[r] || 0) + n; }
export const foodStock = (T) => FOOD.reduce((s, r) => s + (T.store[r] || 0), 0);

// Man-days to haul one kg `d` metres to a store, using the team's best free carrier (§4).
export function haulManDaysPerKg(w, team, d, kgPerDay = 1000, carts = 0) {
  const C = E.carriers;
  const hv = TC.mul(w, team, "haul"), cv = TC.mul(w, team, "cart"); // (research: causeways & bridges; the horse collar)
  const per = (c) => (2 * d / (c.v * hv * (c === C.cart ? cv : 1)) + c.load) / 36000 / c.kg; // a working day ≈ 10 h = 36 000 s
  return carts > 0 ? per(C.cart) : per(C.man);
}

function nearestStoreFor(w, team, res, x, y) {
  let best = null, bd = Infinity;
  for (const b of w.buildings) {
    if (b.team !== team || !complete(b)) continue; const s = BUILDINGS[b.kind].stores;
    if (!(s === true || (Array.isArray(s) && s.includes(res)))) continue;
    const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = b; }
  }
  return best;
}

// ────────────────────────────────────────────────────────────── people & jobs
export const roleOf = (w, id) => w.econ.role.get(id) ?? ROLE.man;
export const isMale = (w, id) => MALE.has(roleOf(w, id));

export function workerUnits(w, team) { const out = []; for (const u of w.units.values()) if (u.team === team && u.isWorkers) out.push(u); return out; }
export function homeUnit(w, team) {
  const T = w.teams[team]; let u = w.units.get(T.homeUnit);
  if (u && u.members.length && u.job?.kind === "home") return u;
  u = workerUnits(w, team).find((v) => v.job?.kind === "home" && v.members.length);
  if (u) T.homeUnit = u.id;
  return u || null;
}

export const jobKey = (j) => j ? `${j.kind}:${j.node?.id ?? ""}:${j.b?.id ?? ""}:${j.res ?? ""}` : "none";

// Move `n` labourers (preferring the listed roles) from home — or from `fromUnits` — onto `job`.
export function assignWorkers(w, team, job, n, prefer = [], fromUnits = null) {
  if (n <= 0) return null;
  const src = fromUnits || [homeUnit(w, team)].filter(Boolean);
  const rank = (id) => { const i = prefer.indexOf(ROLES[roleOf(w, id)]); return i < 0 ? prefer.length + (roleOf(w, id) === ROLE.adept ? 50 : 0) : i; };
  const cands = [];
  for (const u of src) for (const id of u.members) if (w.S.alive[id] && w.S.state[id] !== S_FLEE) cands.push([rank(id), id, u]);
  cands.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const pick = cands.slice(0, n);
  if (!pick.length) return null;
  const byUnit = new Map(); for (const [, id, u] of pick) { if (!byUnit.has(u)) byUnit.set(u, []); byUnit.get(u).push(id); }
  let target = workerUnits(w, team).find((u) => jobKey(u.job) === jobKey(job) && !byUnit.has(u) && !u.broad && !u.ordered); // (never into a crew on a broad task or under the player's orders: the reeve's hands are the reeve's, the player's crew stays the size he made it)
  for (const [u, ids] of byUnit) {
    const nu = ids.length === u.members.length ? u : splitUnit(w, u, ids);
    resetJob(nu, job);
    if (target) mergeUnits(w, [target, nu]); else target = nu;
  }
  return target;
}

// broad tasks (js/sim/broad.js sets BROAD.retarget): a crew with a task that runs out of work is put on the next
// nearest job instead of going home; only when there is none does the task end
export const BROAD = { retarget: null };
export function releaseWorkers(w, u, n = Infinity, keepRoles = []) {
  if (!u || !u.isWorkers) return;
  if (u.broad && n >= u.members.length && BROAD.retarget?.(w, u)) return;
  const ids = u.members.slice().sort((a, b) => (keepRoles.includes(ROLES[roleOf(w, a)]) ? 1 : 0) - (keepRoles.includes(ROLES[roleOf(w, b)]) ? 1 : 0) || a - b).slice(0, Math.min(n, u.members.length));
  if (!ids.length) return;
  const part = ids.length === u.members.length ? u : splitUnit(w, u, ids);
  if (part === u && u.ordered) { const why = orderDone(u.job); if (why) w.log.push({ t: w.tick, kind: "reeve-say", team: u.team, text: `Your ${u.members.length} villagers have finished the work you set them — ${why}; they go back to the reeve`, tone: "good", x: u.ax, y: u.ay }); } // (a player's job holds until it is done: say so when it is)
  part.broad = null; part.ordered = false; // (going home: no task — js/sim/broad.js — and no longer under the player's order)
  const home = homeUnit(w, u.team);
  resetJob(part, { kind: "home" });
  if (home && home !== part) mergeUnits(w, [home, part]); else w.teams[u.team].homeUnit = part.id;
}

// why a player's job is over (releaseWorkers' chronicle line), or null when it is not (he moved them, the warden sheltered them)
const NODE_NAME = { wood: "the woodland", coppice: "the coppice", quarry: "the quarry face", bog_iron: "the bog-iron bed", silver_vein: "the silver vein", gold_vein: "the gold vein", fishery: "the fishing water", forage: "the thicket", hunt: "the hunting ground", ley: "the ley line" };
function orderDone(j) {
  if (!j) return null;
  const nm = (b) => (BUILDINGS[b.kind]?.name || b.kind).toLowerCase();
  if (j.kind === "gather") return !j.node || !(j.node.amount > 0) ? `${NODE_NAME[j.node?.kind] || "the ground"} is worked out` : null;
  if (j.kind === "field") return "the field needs no more hands until its next work";
  if (!j.b) return null;
  if (j.b.ruin) return `the ${nm(j.b)} is gone`;
  if (j.kind === "build") return j.b.progress >= 1 && j.b.hp >= j.b.hpMax ? `the ${nm(j.b)} stands finished` : null;
  if (j.kind === "firefight") return j.b.fire > 0 ? null : `the fire at the ${nm(j.b)} is out`;
  return null;
}
const T0 = (w, team) => w.teams[team]?.homeUnit; // (the household itself)
function resetJob(u, job) { u.job = job; u.isWorkers = true; u.haul = new Map(); u.danger = 0; u.path = null; u.order = { kind: "hold" }; }

// issueOrder hook (world.js gather/build branch): turn a player's click into a job.
function jobFor(w, u, order) {
  if (order.building) {
    const b = order.building;
    if (b.kind === "field") return { kind: "field", b };
    if (b.progress < 1 || b.hp < b.hpMax) return { kind: "build", b };
    if (b.fire > 0) return { kind: "firefight", b };
    if (RECIPES[b.kind]) return { kind: "craft", b };
    if (b.kind === "archery_range") return { kind: "practice", b };
    if (BUILDINGS[b.kind]?.stores) return { kind: "store", b }; // ("Haul here": the storemen's work — js/sim/jobs/haulage.js)
    return { kind: "build", b };
  }
  if (order.node && order.node.amount > 0) return { kind: "gather", node: order.node, res: order.node.res, ...(order.node.res === "timber" || order.node.res === "stone" ? { carts: 2 } : {}) }; // (the node clicked or the one a camp serves: js/ui/orders.js workAt)
  // a click inside one of our fields is the field's work — before any wild ground nearby (game and forage lie beside the furlongs)
  for (const b of w.buildings) if (b.team === u.team && b.kind === "field" && inFieldRect(b, order.x, order.y)) return { kind: "field", b };
  let node = null, bd = 90;
  for (const r of w.resources || []) { const d = Math.hypot(r.x - order.x, r.y - order.y); if (d < bd + r.r && r.amount > 0) { bd = d; node = r; } }
  if (node) return { kind: "gather", node, res: order.res || node.res };
  return null;
}

export function jobSite(w, u) {
  const j = u.job; if (!j) return null;
  if (j.node) return { x: j.node.x, y: j.node.y, r: j.node.r };
  if (j.b) return { x: j.b.x, y: j.b.y, r: j.b.kind === "field" ? 150 : 8 + (j.b.length || 0) / 2 };
  const T = w.teams[u.team]; return { x: T.town.x, y: T.town.y, r: 30 };
}

// ────────────────────────────────────────────────────────────── per-tick system
export function economySystem(w) {
  if (!w.econ) return;
  const ec = w.econ;
  LB.laborPreTick(w); // (the dead and the departed drop their loads: js/sim/labor.js)
  ec.doy = ec.startDoy + w.tick * DT;
  const dayNow = Math.floor(w.tick * DT);
  const newDay = dayNow !== ec.dayIndex; ec.dayIndex = dayNow;
  if (!TW.anyDaughters(w)) econPass(w, null, newDay, true);
  else { // a house with daughter towns runs each in its own frame (js/sim/towns.js): the seat, then every daughter
    const plain = new Set(w.teams.filter((T) => !TW.hasDaughters(T)).map((T) => T.id));
    if (plain.size) econPass(w, plain, newDay, true);
    for (const T of w.teams) if (TW.hasDaughters(T)) {
      const only = new Set([T.id]);
      TW.within(w, T.id, null, () => econPass(w, only, newDay, true));
      for (const D of TW.liveTowns(T)) TW.within(w, T.id, D, () => econPass(w, only, newDay, false)); // (research is the house's: studied once, at the seat)
    }
  }
  if (w.tick % 10 === 0) arson(w);
  DM.demolishTick(w); // (a circuit rebuilt in stone stretch by stretch; the reeve clears old ruins)
  if (newDay) for (const n of w.resources) if (n.kind === "fishery" || n.kind === "ley") n.amount = Math.min(n.start, n.amount + n.start * 0.01);
  VN.veinSystem(w); // (veins held and taken: a flag hoisted over a vein its holder's men no longer stand at — js/sim/veins.js)
}

// one pass of the town economy over `teams` (null: every team) — economySystem above
function econPass(w, teams, newDay, study) {
  const on = (t) => !teams || teams.has(t);
  for (const T of w.teams) if (T.store && on(T.id)) teamFactors(w, T);
  // villagers the player has marched off (u.away) are under his orders, not the reeve's, until set to work again
  for (const u of w.units.values()) {
    if (!u.isWorkers || !u.members.length || !on(u.team)) continue;
    // a field task outlives nothing: a man whose crew is not at a field's work (the job ended, he was split off or sent
    // elsewhere) unyokes and stops — or he walks his old furrows for ever, and his "moving" keeps an away crew away for ever
    if (u.ordered && (!u.job || u.job.kind === "home")) u.ordered = false; // (at home is nobody's order: the reeve may set them to work again)
    if (w.labor?.men.size && u.job?.kind !== "field") for (const id of u.members) { const M = w.labor.men.get(id); if (M?.task?.name === "field") { if (M.carry?.kind === "plough") M.carry = null; LB.stop(w, id); } }
    // sent somewhere they cannot get to (a wall, a river): no headway for 60 s and they give it up and go back to their work —
    // "still on the way" must mean getting nearer, or a crew pacing at a gate stays away for ever
    if (u.away && !u.convoy && Number.isFinite(u.order?.x)) {
      const d = Math.hypot(u.order.x - u.ax, u.order.y - u.ay);
      if (!(u.awayBest >= 0) || d < u.awayBest - 2) { u.awayBest = d; u.awayBestT = w.time; }
      else if (w.time - (u.awayBestT ?? w.time) > 60 && d > 15) { u.awayUntil = 0; u.moving = false; u.path = null; u.pendingOrder = null; u.awayBest = -1; w.log.push({ t: w.tick, kind: "villagers-gave-up", unit: u.id, team: u.team }); }
    } else u.awayBest = -1;
    if (u.away && !u.convoy && (u.moving || u.path || u.pendingOrder)) u.awayUntil = Math.max(u.awayUntil || 0, w.tick + VILLAGER_OBEY_TICKS); // still on the way
    if (u.away && w.tick > (u.awayUntil || 0)) { // their patience is up: back to their usual work
      u.away = false; u.path = null; resetJob(u, { kind: "home" });
      w.log.push({ t: w.tick, kind: "villagers-return", unit: u.id, team: u.team });
      const home = homeUnit(w, u.team); if (home && home !== u) mergeUnits(w, [home, u]);
      continue;
    }
    if (u.playerJobUntil && w.tick > u.playerJobUntil) { u.playerJobUntil = 0; if (u.job?.kind !== "home") { releaseWorkers(w, u); continue; } }
    // a crew with no job and no orders of the player's (split off, its job ended) goes back to the household's work
    if (!u.job && !u.away && !u.broad && !u.convoy && !u.ordered && u.id !== T0(w, u.team)) { resetJob(u, { kind: "home" }); const home = homeUnit(w, u.team); if (home && home !== u) mergeUnits(w, [home, u]); else w.teams[u.team].homeUnit = u.id; continue; }
    if (!u.away) workUnit(w, u);
  }
  for (const b of w.buildings) if (!b.ruin && on(b.team)) buildingTick(w, b);
  for (const T of w.teams) if (T.store && !T.fallen && on(T.id)) { consume(w, T); if (newDay) daily(w, T); if (T.tech && study) TC.researchTick(w, T, DT); } // (research at the keep: js/sim/tech.js)
}

// Productivity multipliers shared by every worker in the team this tick.
function teamFactors(w, T) {
  const doy = w.econ.doy;
  const daylight = 12 + 4.4 * Math.sin(2 * Math.PI * (doy - 80) / 365); // hours at ~52°N
  T.harvestTime = w.buildings.some((b) => b.team === T.id && b.field?.state === "ripe");
  const workday = T.harvestTime ? 1 : E.workdayFrac;
  const mill = hasBuilding(w, T.id, "mill") ? 1 : 1 - E.handGrindLabour;
  T.eff = workday * clamp(daylight / 14, 0.6, 1.15) * mill * (1 - 0.4 * T.unrest) * (0.55 + 0.45 * clamp(T.ration, 0, 1)) * (LABOR_WX[w.weather] || 1); // (rain slows outdoor labour a touch: docs/weather.md)
  T.daylight = daylight;
}

function workUnit(w, u) {
  const S = w.S, T = w.teams[u.team], job = u.job || (u.job = { kind: "home" });
  if (T.fallen) return;
  const site = jobSite(w, u);
  // danger: enemies near the work site or the crew → drop tools, run for the walls
  if ((w.tick + u.id) % 10 === 0) {
    u.danger = Math.max(0, (u.danger || 0) - 1);
    for (const v of w.units.values()) {
      if (v.team === u.team || v.isWorkers || !v.members.length || v.state === "routing" || !isFoe(w, u.team, v.team)) continue; // (a house at peace — or a newcomer's shielded men — passing by is no danger: Junior's crews ran for the keep for ever and the vill starved)
      const d = Math.min(Math.hypot(v.ax - site.x, v.ay - site.y), Math.hypot(v.ax - u.ax, v.ay - u.ay));
      if (d < 160 + site.r) { u.danger = 30; break; }
    }
    if (T.besieged && job.kind !== "home" && job.kind !== "build" && job.kind !== "craft" && job.kind !== "firefight") {
      const hall = w.buildings.find((b) => b.id === T.hall);
      if (hall && Math.hypot(site.x - hall.x, site.y - hall.y) > 250) u.danger = Math.max(u.danger, 30);
    }
  }
  const safe = !u.danger;
  const home = T.town;
  const speed = ARMS.villager.speed * BT;
  let working = 0, haulers = 0;
  const atWork = (u.atWork ||= new Set()); atWork.clear();
  const haulShare = job.kind === "gather" ? (u.haulShare || 0) : 0;
  let nHaul = Math.round(u.members.length * haulShare);
  const store = job.kind === "gather" ? (u.store || null) : null;
  // the labour core (js/sim/labor.js): goods are carried by real people from the site's pile to the store
  const res = job.res || job.node?.res, phys = job.kind === "gather" && LB.PHYSICAL.has(res);
  const pile = phys ? LB.itemByKey(w, pileKey(job.node, u.team)) : null;
  if (pile && pile.kg > 0 && nHaul < 1 && (u.members.length > 1 || !(job.node?.amount > 0))) nHaul = 1;
  const planner = LB.plannerFor(job), md0 = DT * T.eff;
  let cartsLeft = phys ? Math.min(job.carts || 0, T.store.carts || 0, (T.store.oxen || 0) + (T.store.horses || 0)) : 0;
  let cx = 0, cy = 0;
  for (let k = 0; k < u.members.length; k++) {
    const id = u.members[k];
    if (!S.alive[id]) continue;
    cx += S.x[id]; cy += S.y[id];
    if (S.state[id] === S_FLEE || S.state[id] === S_FIGHT) continue;
    if (!safe) { LB.stop(w, id); const hx = home.x + spiral(k, 3)[0], hy = home.y + spiral(k, 3)[1], v = wallWay(w, u, id, hx, hy); moveTo(S, id, v ? v[0] : hx, v ? v[1] : hy, speed * 2.3, w.map); continue; }
    if (laborMan(w, u, id, k, T, job, nHaul, pile, planner, md0, cartsLeft > 0 && k < nHaul)) { if (k < nHaul) cartsLeft--; haulers++; continue; }
    let tx, ty;
    if (k < nHaul && store) {
      // hauler: shuttle node ↔ store
      let dir = u.haul.get(id) || 0;
      tx = dir ? store.x : site.x; ty = dir ? store.y : site.y;
      if (Math.hypot(tx - S.x[id], ty - S.y[id]) < 4) { dir ^= 1; u.haul.set(id, dir); }
      const v = wallWay(w, u, id, tx, ty); if (v) { tx = v[0]; ty = v[1]; }
      moveTo(S, id, tx, ty, speed * E.commuteMul, w.map); S.state[id] = S_MOVE; haulers++;
      continue;
    }
    [tx, ty] = spotFor(w, u, site, k);
    const d = Math.hypot(tx - S.x[id], ty - S.y[id]);
    if (d > 4 || RV.deep(w, tx, ty) || RV.deep(w, S.x[id], S.y[id])) { const v = wallWay(w, u, id, tx, ty); if (v) { tx = v[0]; ty = v[1]; } } // (by the gate, if a town wall stands between; by the ford, if a river)
    if (d > 25) moveTo(S, id, tx, ty, speed * E.commuteMul, w.map); // on the road to the job
    else { // at the job: stepping to the next part of the work is part of the work (it isn't a commute)
      if (d > 4) moveTo(S, id, tx, ty, speed, w.map);
      else { if (d > 0.2) moveTo(S, id, tx, ty, speed * 0.25, w.map); S.state[id] = S_WORK; } // slow drift
      working++; atWork.add(id);
    }
  }
  const n = u.members.length; u.ax = cx / n; u.ay = cy / n;
  if (!safe) return;
  const md = DT * T.eff; // man-days per working man this tick
  switch (job.kind) {
    case "gather": return gather(w, u, T, working + haulers, md);
    case "field": return fieldWork(w, u, T, working, md);
    case "build": return buildWork(w, u, T, working, md);
    case "craft": return craftWork(w, u, T, working, md, atWork);
    case "practice": return practice(w, u, T, md, atWork);
    case "firefight": { const b = job.b; if (b.fire > 0) b.fire = Math.max(0, b.fire - working * 0.004 * BT / 10); else { releaseWorkers(w, u); } return; }
    case "home": return homeWork(w, u, T, working, md);
  }
}

// the labour core's say over man k of crew u (docs/gathering-plan.md): a task in hand runs; a load in his arms goes to
// the store first; the crew's carriers fetch lots from the site's pile; a couple of the villagers at home glean loose
// loads; then the lanes' planners. → true when he is the labour core's this tick (else the old spot-work below).
function laborMan(w, u, id, k, T, job, nHaul, pile, planner, md, cart) {
  if (LB.stepMan(w, id, md)) return true;
  const M = LB.manOf(w, id);
  if (M?.carry) { LB.planDeliver(w, id, M); return LB.stepMan(w, id, md); }
  if (pile && k < nHaul) {
    const store = LB.nearestStore(w, u.team, pile.res, pile.x, pile.y);
    if (!store) return false;
    const d = Math.hypot(store.x - pile.x, store.y - pile.y);
    if (pile.kg <= 0) { LB.assign(w, id, "wait", [{ op: "go", x: pile.x + spiral(k, 2)[0], y: pile.y + spiral(k, 2)[1], near: 1.5 }, { op: "wait", secs: 4 }]); return LB.stepMan(w, id, md); }
    LB.planCarry(w, id, pile, store, LB.lotFor(w, T, d, pile.kind, cart), cart, Math.max(1, nHaul));
    return LB.stepMan(w, id, md);
  }
  if (job.kind === "home" && k < 2 && (w.tick + id) % 20 === 0 && w.labor?.items.length) {
    const it = LB.nearestLoose(w, u.team, T.town.x, T.town.y, E.homeRadius);
    if (it && LB.nearestStore(w, u.team, it.res, it.x, it.y)) { LB.planGlean(w, id, it); return LB.stepMan(w, id, md); }
  }
  if (planner) { const steps = planner(w, u, id, k, M, { T, job, pile, nHaul }); if (steps?.length) { LB.assign(w, id, job.kind, steps); return LB.stepMan(w, id, md); } }
  return false;
}
const pileKey = (node, team) => `site:${node?.id}:${team}`;

// A villager whose way runs into a town wall goes by a gate (or a gap): the waypoint is kept per man on his crew (u.gw),
// so the route round the walls is worked out once per leg (js/sim/wallnav.js). null: straight there.
function wallWay(w, u, id, tx, ty) {
  // (and first: water a man cannot wade between — by the ford or the bridge, js/sim/rivers.js; the way kept per man, u.rw)
  const rm = (u.rw ||= new Map()); let ra = rm.get(id);
  if (!ra) { if (rm.size > 2 * u.members.length + 8) rm.clear(); rm.set(id, (ra = [])); }
  const r = RV.way(w, u.team, w.S.x[id], w.S.y[id], tx, ty, ra);
  if (r) { tx = r[0]; ty = r[1]; }
  if (!WN.any(w)) return r;
  const m = (u.gw ||= new Map()); let a = m.get(id);
  if (!a) { if (m.size > 2 * u.members.length + 8) m.clear(); m.set(id, (a = [])); }
  return WN.via(w, u.team, w.S.x[id], w.S.y[id], tx, ty, a) || r;
}
function spiral(k, sp) { const a = k * 2.399, r = sp * Math.sqrt(k + 1); return [Math.cos(a) * r, Math.sin(a) * r]; }
// Where worker k is working right now. Nobody stands still on a job: every 8–26 s each worker moves
// on to another part of the work (another stretch of the row, another tree, another side of the
// frame), and while at it drifts slowly — hoeing along a furrow, working round a log. Deterministic
// (tick + id hashing), so it stays lockstep-safe.
const hsh = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };
function spotFor(w, u, site, k) {
  const j = u.job, id = u.members[k], dur = 80 + Math.floor(hsh(id, 7) * 180);
  const t = w.tick + Math.floor(hsh(id, 3) * dur), ep = Math.floor(t / dur), ph = (t % dur) / dur; // which task, how far through it
  const r1 = hsh(id, ep * 2 + 1), r2 = hsh(id, ep * 2 + 2);
  if (j.b?.kind === "field") { // each man has his own strip; he works along it, a few metres each task
    const b = j.b, sx = hsh(id, 11), sy = hsh(id, 13);
    return [b.x + (sx - 0.5) * b.w * 0.9 + (r1 - 0.5) * 14 + (ph - 0.5) * 8, b.y + (sy - 0.5) * b.h * 0.9 + (r2 - 0.5) * 6];
  }
  if (j.b?.br) return RV.bridgeSpot(j.b, r1, r2, ph); // (a timber bridge: at its near bank — the trestles go in from there: js/sim/bridges.js)
  if (j.b?.x1 !== undefined) { const q = (r1 + ph * 0.04) % 1, side = r2 < 0.5 ? -2.5 : 2.5; const L = Math.hypot(j.b.x2 - j.b.x1, j.b.y2 - j.b.y1) || 1;
    return [j.b.x1 + (j.b.x2 - j.b.x1) * q - (j.b.y2 - j.b.y1) / L * side, j.b.y1 + (j.b.y2 - j.b.y1) * q + (j.b.x2 - j.b.x1) / L * side]; }
  if (j.kind === "build" && j.b) { // round the frame: somewhere on the building's edge, or at the material piles
    const fp = BUILDINGS[j.b.kind]?.footprint || [10, 8], a = r1 * 6.283, rr = r2 < 0.8 ? 1 : 1.6;
    const c = Math.cos(j.b.rot || 0), sn = Math.sin(j.b.rot || 0);
    const lx = Math.cos(a) * (fp[0] / 2 + 1.5) * rr + Math.sin(ph * 6.283) * 0.6, ly = Math.sin(a) * (fp[1] / 2 + 1.5) * rr;
    return [j.b.x + lx * c - ly * sn, j.b.y + lx * sn + ly * c];
  }
  if (j.kind === "home") { // about the village: yards, gardens, wells, the keep
    const R = 12 + hsh(id, 23) * 55, a = hsh(id, 29) * 6.283; // his own yard and garden, and about it
    const [fx, fy] = footing(w.map, site.x + Math.cos(a) * R + (r1 - 0.5) * 16, site.y + Math.sin(a) * R + (r2 - 0.5) * 16, site.x, site.y);
    return [fx + (ph - 0.5) * 3, fy];
  }
  // gathering: anywhere across the wood / quarry face / hunting ground, wandering a little
  // (each man keeps to his own part of it — the next tree, the next stretch of face — not the far side)
  const R = Math.sqrt(hsh(id, 17)) * site.r * 0.8, a = hsh(id, 19) * 6.283;
  const [fx, fy] = footing(w.map, site.x + Math.cos(a) * R + (r1 - 0.5) * 12, site.y + Math.sin(a) * R + (r2 - 0.5) * 12, site.x, site.y);
  return [fx + Math.sin(ph * 6.283 + id) * 1.5, fy + Math.cos(ph * 6.283 + id) * 1.5];
}
// Where a man can stand to work: not up a crag's face. A spot on ground steeper than FOOT_SLOPE (a fall of 0.7, 35°) moves
// to the first footing found — in toward the site's middle, then round the spot — else stays (deterministic: the map only)
const FOOT_SLOPE2 = 0.49;
function footing(map, x, y, cx, cy) {
  if (!map?.grad) return [x, y];
  const ok = (px, py) => { const g = map.grad(px, py); return g[0] * g[0] + g[1] * g[1] <= FOOT_SLOPE2; };
  if (ok(x, y)) return [x, y];
  for (let k = 1; k <= 4; k++) { const t = k / 4, px = x + (cx - x) * t, py = y + (cy - y) * t; if (ok(px, py)) return [px, py]; }
  for (const r of [4, 8, 14]) for (let k = 0; k < 8; k++) { const px = x + SPOKES[k][0] * r, py = y + SPOKES[k][1] * r; if (ok(px, py)) return [px, py]; }
  return [x, y];
}
const SPOKES = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];
function moveTo(S, id, tx, ty, v, M) { // (M: the map — clamped to its extent)
  const dx = tx - S.x[id], dy = ty - S.y[id], d = Math.hypot(dx, dy);
  if (d < 1e-6) return;
  const s = Math.min(v, d);
  S.x[id] = clamp(S.x[id] + dx / d * s, M.x0, M.x1); S.y[id] = clamp(S.y[id] + dy / d * s, M.y0, M.y1);
  S.facing[id] = Math.atan2(dy, dx); S.state[id] = S_MOVE;
  S.fatigue[id] = clamp(S.fatigue[id] - 1e-4, 0, 1);
}

function gather(w, u, T, crew, md) {
  const job = u.job, node = job.node;
  const res = job.res || node?.res, phys = LB.PHYSICAL.has(res);
  if (!node || node.amount <= 0) {
    // the wood is felled out: the crew carries what is still lying at the landing, then goes home
    const pile = phys && node ? LB.itemByKey(w, pileKey(node, u.team)) : null;
    if (pile && pile.kg > 0) { u.haulShare = 1; return; }
    releaseWorkers(w, u); return;
  }
  if (VN.isVein(node) && !VN.mayMine(w, u.team, node)) { // another house holds this vein (taken from us, or never ours): the miners leave it
    w.log.push({ t: w.tick, kind: "reeve-say", team: u.team, text: `Our miners leave the ${VN.veinWord(node)}: ${VN.mineWhy(w, u.team, node)}`, tone: "bad", x: node.x, y: node.y });
    releaseWorkers(w, u); return;
  }
  if (res === "mana") { // only adepts can draw on a ley line
    let adepts = 0; for (const id of u.members) if (roleOf(w, id) === ROLE.adept) adepts++;
    crew = Math.min(crew, adepts);
    const cap = manaCapOf(w, u.team);
    if (T.store.mana >= cap) return;
  }
  if ((w.tick + u.id) % 40 === 0 || !u.store) u.store = nearestStoreFor(w, u.team, res, node.x, node.y);
  const store = u.store; if (!store) return;
  const d = Math.hypot(store.x - node.x, store.y - node.y);
  const rate = (E.yieldPerManDay[res] || 0) * (res === "mana" ? TC.mul(w, u.team, "mana") : 1); // (research: ley lore)
  // carts: each needs a draught animal and takes a carter from the crew
  const carts = Math.min(job.carts || 0, T.store.carts, T.store.oxen + T.store.horses, Math.floor(crew / 2));
  const hm = haulManDaysPerKg(w, u.team, d), hc = haulManDaysPerKg(w, u.team, d, 0, 1);
  const Wp = crew - carts, cartCap = carts / hc; // kg/day the carters can move
  let P = rate * Wp <= cartCap ? rate * Wp : rate * (Wp + cartCap * hm) / (1 + rate * hm); // kg/day
  const cutters = P / rate;
  u.haulShare = crew > 0 ? clamp(1 - cutters / Math.max(crew, 1e-9), 0, 0.9) : 0;
  let got = Math.min(node.amount, P * md);
  if (res === "mana" || res === "fresh") got = Math.min(got, node.amount);
  node.amount -= got;
  if (phys && LB.OUTPUT[res]?.(w, u, node, got, store)) { /* a lane placed it (labor.OUTPUT) */ }
  else if (phys) { // cut and stacked at the landing: it counts in the store only when a carrier sets it down there (labor.js)
    const kind = res === "fresh" ? (node.kind === "hunt" ? "carcass" : node.kind === "fishery" ? "fish" : "barrel") : LB.RES_ITEM[res] || "sack";
    let pile = LB.itemByKey(w, pileKey(node, u.team));
    if (!pile && got > 0) { const [px, py] = LB.landingSpot(w, node.x, node.y, store.x, store.y, node.r * 2.5); pile = LB.sitePile(w, pileKey(node, u.team), kind, px, py, u.team, Math.atan2(store.y - node.y, store.x - node.x) + Math.PI / 2); }
    if (got > 0) LB.addKg(w, pile, got); // (the landing: the wood's edge toward the store — labor.landingSpot)
  } else give(T, res, got);
  if (node.amount <= 0) w.events.push({ t: w.tick, kind: "node-exhausted", node: node.id, team: u.team });
}

// lane A (js/sim/jobs/fields.js): plough, sow, weed, reap into stooks, cart the stooks to the granary
function fieldWork(w, u, T, working, md) { return FL.work(w, u, T, working, md); }

function buildWork(w, u, T, working, md) {
  const b = u.job.b, def = BUILDINGS[b.kind];
  if (b.razing) return DM.razeWork(w, u, T, working, md); // (being pulled down: js/sim/demolish.js)
  if (b.ruin) { releaseWorkers(w, u); return; }
  let eff = working;
  let masons = 0, carps = 0; for (const id of u.members) { const r = roleOf(w, id); if (r === ROLE.mason) masons++; else if (r === ROLE.carpenter) carps++; }
  const gang = 5 + TC.add(w, b.team, "masonGang"); // (research: lime mortar & ashlar)
  if (def.stone && !b.manor) eff = Math.min(working, masons * gang + 1); // Harlech ≈ 1 mason : 3–4 others (§5.3) (a daughter's manor hall is timber-framed: js/sim/founding.js)
  else eff = working * (0.8 + 0.2 * Math.min(1, carps * 6 / Math.max(1, working)));
  const labour = eff * md * (E.buildSpeed || 1);
  if (b.progress < 1) {
    // (lane D: the crew's carriers and fetchers are at the work too; it rises only as its materials arrive — haulage.js)
    if (b.need) { let busy = 0; for (const id of u.members) if (w.labor?.men.get(id)?.task?.name === "build") busy++; const e2 = def.stone ? Math.min(working + busy, masons * gang + 1) : (working + busy) * (0.8 + 0.2 * Math.min(1, carps * 6 / Math.max(1, working + busy))); b.progress = HL.buildGate(w, b, e2 * md * (E.buildSpeed || 1) / b.labour); }
    else b.progress = Math.min(1, b.progress + labour / b.labour);
    b.hp = b.hpMax * (0.05 + 0.95 * b.progress);
    T.day.buildDays += working * DT;
    if (def.wall && b.progress >= 0.5 && !b.navSaved) blockWall(w, b, true);
    if (b.progress >= 1) { w.events.push({ t: w.tick, kind: "built", building: b.id, team: b.team, what: b.kind }); releaseWorkers(w, u); LE.estateBuilt(w, b); } // (a shell keep finished: the motte it stands on goes — js/sim/estates.js)
  } else if (b.hp < b.hpMax) {
    // repairs: 30 % of the build labour and materials restores full hp
    const frac = Math.min((b.hpMax - b.hp) / b.hpMax, labour / (0.3 * b.labour));
    const mat = scaleCost(def, b.length || 1);
    for (const [r, n] of Object.entries(mat)) if (r !== "silver" && (T.store[r] || 0) < n * 0.3 * frac) return;
    for (const [r, n] of Object.entries(mat)) if (r !== "silver") take(T, r, n * 0.3 * frac);
    const gain = Math.min(b.hpMax - b.hp, frac * b.hpMax);
    b.hp += gain; T.day.buildDays += working * DT;
    if (b.mods) repairModules(w, b, gain);
    if (b.hp >= b.hpMax) releaseWorkers(w, u);
  } else releaseWorkers(w, u);
}

function craftWork(w, u, T, working, md, atWork) {
  const b = u.job.b, R = RECIPES[b.kind];
  if (!R || !complete(b) || !b.make || !R[b.make]) return;
  const r = R[b.make]; const staff = BUILDINGS[b.kind].staff || 4;
  const cm = TC.craftMul(w, b.team, b.kind, b.make), rDays = r.days * cm.days; // (research: the recipe's days / materials / batch)
  let skill = 0, k = 0;
  for (const id of u.members) { if (k++ >= staff) break; if (!atWork.has(id)) continue; skill += R.trade && ROLES[roleOf(w, id)] === R.trade ? 1 : R.unskilled; }
  if (skill <= 0) return;
  T.day.craftDays += Math.min(working, staff) * DT;
  b.work += skill * md * (b.land?.outMul || 1);
  if (b.work < rDays) return;
  const needs = { ...r.needs }; if (r.fuel) needs.charcoal = (needs.charcoal || 0) + r.fuel;
  if (cm.needs !== 1) for (const x of Object.keys(needs)) needs[x] *= cm.needs;
  if (!canAfford(T, needs)) { b.blocked = Object.keys(needs).find((x) => (T.store[x] || 0) < needs[x]); b.work = rDays; return; }
  b.blocked = null; b.work -= rDays;
  for (const [x, n] of Object.entries(needs)) take(T, x, n);
  give(T, b.make, (r.batch || 1) * cm.batch);
}

function practice(w, u, T, md, atWork) {
  // men shooting at the butts every day slowly become warbow archers (years, compressed)
  for (const id of u.members) {
    const r = roleOf(w, id); if (!atWork.has(id) || (r !== ROLE.man && r !== ROLE.spear)) continue;
    const p = (w.econ.practice.get(id) || 0) + md / E.workdayFrac;
    if (p >= SLOW_TRAINING.archer * TC.mul(w, u.team, "archer")) { w.econ.role.set(id, ROLE.archer); w.econ.practice.delete(id); w.events.push({ t: w.tick, kind: "trained-archer", team: u.team }); }
    else w.econ.practice.set(id, p);
  }
}

// Labourers at home: thresh the sheaves, else tend gardens, cows and hens.
function homeWork(w, u, T, working, md) {
  const doy = w.econ.doy;
  if (T.store.sheaves > 0) FL.thresh(w, u, T, working, md); // (lane A: flails on the barn's threshing floor; seed corn kept back)
  else {
    const d = ((doy % 365) + 365) % 365; // (the garden's year turns with the calendar's: in the realm's second year it bears in summer again)
    const g = E.garden[0] + (E.garden[1] - E.garden[0]) * clamp((d - 121) / 70, 0, 1) * (d > 280 ? 0.3 : 1);
    give(T, "fresh", (working + errandMen(w, u)) * md * g); // (lane E: the reserve on errands — the well, a neighbour — is at work too)
  }
  // sheep-shearing in June
  const ydS = (((doy) % 365) + 365) % 365, yrS = Math.floor(doy / 365); if (T.shornYr !== yrS) { T.shornYr = yrS; T.shorn = 0; } // (a new year's flock to shear)
  if (ydS >= E.shearDoy[0] && ydS < E.shearDoy[1] && T.sheep > 0) {
    const need = T.sheep / 100 * E.shearManDaysPer100, done = Math.min(need - (T.shorn || 0), working * md);
    if (done > 0) { T.shorn = (T.shorn || 0) + done; give(T, "wool", done / E.shearManDaysPer100 * 100 * E.woolPerSheep * TC.mul(w, T.id, "wool")); }
  }
}


// horse breeding: each finished paddock keeps a stud of mares (E.horse.studMares) beside the house's own horses; foals drop
// in spring and are broken to the saddle after E.horse.breakDays, then join the store as riding horses (the realm runs for
// years: in a single match they never grew up, and a paddock with no horses of the house's own bred nothing at all)
export function paddockStud(w, team) { return w.buildings.filter((b) => b.team === team && b.kind === "paddock" && complete(b)).length; }
export function breedHorses(w, T, ec) {
  const pads = paddockStud(w, T.id), yd = ((ec.doy % 365) + 365) % 365, F = (T.foalsBy ||= []);
  if (T.foals > 0) { F.push({ yr: Math.floor(ec.doy / 365) - 1, born: ec.doy - E.horse.breakDays + 30, n: T.foals }); T.foals = 0; } // (an old save's foals: broken within the month)
  if (pads && yd > 100 && yd < 170) {
    const yr = Math.floor(ec.doy / 365); let c = F.find((q) => q.yr === yr);
    if (!c) F.push(c = { yr, born: ec.doy, n: 0 });
    c.n += (pads * E.horse.studMares + Math.min(T.store.horses || 0, 20 * pads) * 0.3) * E.horse.foalRate / 70;
  }
  for (const c of F.slice()) if (ec.doy - c.born >= E.horse.breakDays) {
    const k = Math.round(c.n); if (k > 0) { give(T, "horses", k); w.events.push({ t: w.tick, kind: "horses-broken", team: T.id, n: k }); }
    F.splice(F.indexOf(c), 1);
  }
}

// ────────────────────────────────────────────────────────────── buildings per tick
function buildingTick(w, b) {
  const T = w.teams[b.team], def = BUILDINGS[b.kind];
  // fire runs on the battle clock (weather: rain slows and finally drowns a fire, docs/weather.md)
  if (b.fire > 0) {
    const fwx = fireWx(w);
    b.hp -= b.hpMax / E.fireSecs * BT * b.fire * Math.max(0.3, fwx); // (even in rain a fire caught burns, slower)
    if (fwx < 0.25) b.fire = Math.max(0, b.fire - 0.002 * BT);       // rain beating on it: the fire dies in minutes
    else if (b.fire < 1) b.fire = Math.min(1, b.fire + 0.0005 * BT * fwx);
    if (b.fire <= 0) { b.fire = 0; return; }
    if (b.field) { const burn = b.field.left * 0.0006 * BT * b.fire; b.field.left -= burn; b.field.burnt += burn; if (b.field.left < 1) { b.field.left = 0; b.field.state = "burnt"; b.fire = 0; } b.hp = 1; }
    if (w.tick % 10 === 0) for (const o of w.buildings) {
      if (o === b || o.ruin || o.fire > 0 || !BUILDINGS[o.kind].flammable || o.field) continue;
      const dx = o.x - b.x, dy = o.y - b.y;
      if (dx * dx + dy * dy >= 16 * 16) continue;
      // the wind carries the sparks: spread runs downwind (WEATHER.wind.fireSpreadDownwindMul ~3) and barely upwind
      let wmul = 1;
      if (w.wind) { const ws = Math.hypot(w.wind.x, w.wind.y); if (ws > 3) { const d = Math.hypot(dx, dy) || 1; wmul = clamp(1 + 2 * ((dx / d) * (w.wind.x / ws) + (dy / d) * (w.wind.y / ws)) * Math.min(1, ws / 10), 0.2, 3); } }
      if (w.rng.chance(0.004 * BUILDINGS[o.kind].flammable * b.fire * (o.land?.fireMul || 1) * fwx * wmul * TC.mul(w, o.team, "fire"))) o.fire = 0.2;
    }
    if (b.hp <= 0) { ruinBuilding(w, b); return; }
  }
  b.stage = stageOf(b);
  if (b.replaces !== undefined && b.progress >= 1) DM.replaced(w, b); // (the stone stands: the palisade it replaces goes — js/sim/demolish.js)
  if (b.field) return fieldTick(w, b);
  if (!complete(b)) return;
  // recruitment queue (econ clock)
  const q = b.queue[0];
  if (q) {
    q.t += DT;
    if (q.t >= q.days) {
      b.queue.shift();
      if (q.retrain !== undefined) { finishRetrain(w, b, T, q); return; } // (a standing company changes its mounts: no men were drafted)
      T.census.inTraining -= q.count;
      if (q.engines) { // each engine and its crew muster as their own body (siege.js)
        for (let e = 0; e < q.engines; e++) {
          const u = addUnit(w, { team: b.team, arm: q.arm, count: q.count / q.engines, x: b.rally.x + e * 12, y: b.rally.y, formation: "line", training: q.training });
          u.supply = { food: 0, arrows: 0, carts: 0, packhorses: 0 }; u.musterDay = w.econ.doy;
          engineMustered(w, u, b);
          w.events.push({ t: w.tick, kind: "recruited", unit: u.id, building: b.id, team: b.team, arm: q.arm, count: u.members.length });
        }
        return;
      }
      const u = addUnit(w, { team: b.team, arm: q.arm, count: q.count, x: b.rally.x, y: b.rally.y, formation: ARMS[q.arm].mounted ? "line" : "line", training: q.training, mount: q.mount });
      u.supply = { food: 0, arrows: 0, carts: 0, packhorses: 0 }; u.levy = q.arm === "levy"; u.musterDay = w.econ.doy;
      if (q.plates) { let k = 0; for (const id of u.members) if (k++ < q.plates) w.S.armour[id] += 1; u.plates = Math.min(q.plates, u.members.length); } // (research: a coat of plates over the mail — one armour class heavier)
      w.events.push({ t: w.tick, kind: "recruited", unit: u.id, building: b.id, team: b.team, arm: q.arm, count: q.count });
    }
  }
  // the tiltyard: a rider becomes a squire fit to be knighted in SLOW_TRAINING.knight days (years, compressed)
  if (b.tilt) { b.tilt.t += DT; if (b.tilt.t >= SLOW_TRAINING.knight * TC.mul(w, b.team, "squire")) { b.tilt = null; T.census.inTraining--; T.squires++; w.events.push({ t: w.tick, kind: "squire-ready", team: b.team }); } }
  if (b.kind === "stables") stableTrack(w, b, T); // captured juveniles → broken mounts → a riding tradition (docs/mounts-wildlife-spec.md)
}

// lane A (js/sim/jobs/fields.js): the field's year — growing, ripe, stubble, fallow and the next season's ploughing
function fieldTick(w, b) { return FL.tick(w, b); }

const LOOT = { house: 60, market: 480, granary: 240, blacksmith: 240, weaver: 180, fletcher: 180, stables: 240, mill: 240 };

// Enemies loitering at a flammable building or a dry field set it alight.
function arson(w) {
  const nb = [];
  for (const b of w.buildings) {
    if (b.ruin || b.fire > 0) continue;
    const def = BUILDINGS[b.kind];
    if (b.field) {
      const f = b.field; if (!(f.state === "ripe" || (f.state === "growing" && w.econ.doy > f.ripe - 20))) continue;
      for (const v of w.units.values()) if (isFoe(w, b.team, v.team) && !v.isWorkers && v.state !== "routing" && inFieldRect(b, v.ax, v.ay)) { if (w.rng.chance(0.05 * fireWx(w))) { b.fire = 0.3; w.events.push({ t: w.tick, kind: "field-fired", building: b.id, team: b.team }); } break; }
      continue;
    }
    if (!def.flammable || (w.teams[b.team]?.keepsPeace && !b.town)) continue; // (the Keep's Peace: raiders do not fire an absent lord's buildings — at his seat: a daughter town is fair game, js/sim/founding.js)
    neighbours(w, b.x, b.y, (def.footprint?.[0] || 10) * 0.6 + 5, nb);
    let foes = 0, foeTeam = -1; for (const o of nb) if (isFoe(w, b.team, w.S.team[o]) && w.S.alive[o] && w.S.state[o] !== S_FLEE && w.S.arm[o] !== ARMS.villager.id) { foes++; foeTeam = w.S.team[o]; }
    if (foes >= 2 && w.rng.chance(0.01 * def.flammable * Math.min(foes, 10) * fireWx(w) * TC.mul(w, b.team, "fire"))) {
      b.fire = 0.25; w.events.push({ t: w.tick, kind: "fire", building: b.id, team: b.team });
      // plunder before the torch: a chevauchée paid for itself in movables (EST: a cottage's goods ≈ 5 s)
      const loot = LOOT[b.kind] ?? 60, R = w.teams[foeTeam];
      if (R?.store) { give(R, "silver", loot); R.stats.plunder = (R.stats.plunder || 0) + loot; }
    }
  }
}

// ────────────────────────────────────────────────────────────── eating
// Rations are debited on the economic clock whatever else is happening (§10 crossover rule).
// Soldiers in the field on the supply LINE eat through logistics.js (convoy bread, then the town's grain),
// so only those camped by a store ("depot") are fed by the town's own table here — counting both fed the
// army twice and emptied the granary behind every campaign.
export function headcount(w, team) {
  const S = w.S; let labour = 0, soldiers = 0, soldiersHome = 0, mounted = 0, knights = 0;
  for (const u of w.units.values()) {
    if (u.team !== team) continue;
    if (u.isWorkers) labour += u.members.length;
    else { soldiers += u.members.length; if (!u.outOfSupply && u.supplyMode !== "line") { soldiersHome += u.members.length; if (u.arm === "knights") knights += u.members.length; } if (ARMS[u.arm].mounted) mounted += u.members.length; }
  }
  return { labour, soldiers, soldiersHome, mounted, knights };
}

export function dailyFoodNeed(w, team) {
  const T = w.teams[team], h = headcount(w, team), R = E.rations;
  // destriers get oats; on a paddock's summer grass they need about half (§2.2: grazing ~16 h/day)
  const grass = hasBuilding(w, team, "paddock") && (((w.econ.doy) % 365) + 365) % 365 > 120 && (((w.econ.doy) % 365) + 365) % 365 < 280 ? 0.5 : 1;
  const striders = countMounts(w, team, "strider"); // (cheap keep: grain, no fodder — half a destrier's oats)
  return T.dependants * R.dependant + (T.squires + h.soldiersHome) * R.soldier + h.labour * R.labourer + (T.store.destriers + h.knights) * E.horse.grainDestrier * grass + striders * (MOUNTS[MOUNT_ID.strider].feed.grain || 2) + T.census.inTraining * R.soldier;
}

function consume(w, T) {
  feedMounts(w, T); // (drakes eat meat, not bread)
  const need = dailyFoodNeed(w, T.id) * DT;
  const milled = hasBuilding(w, T.id, "mill");
  let got = 0, left = need;
  for (const r of FOOD) {
    if (left <= 0) break;
    if (r === "seed" && T.ration > 0.5) break; // seed corn is eaten only in desperation
    const mul = r === "grain" && milled ? 1 + E.multure : 1;
    const g = take(T, r, left * mul) / mul; got += g; left -= g;
  }
  // dairy, eggs: the cows don't care about sieges
  got += Math.min(left, (T.dependants + headcount(w, T.id).labour) * E.dairyPerPerson * DT);
  const frac = need > 0 ? clamp(got / need, 0, 1) : 1;
  T.ration += (frac - T.ration) * Math.min(1, DT / 3); // ~3-day memory
  take(T, "firewood", (T.dependants + headcount(w, T.id).labour) * E.fuelPerPerson * DT);
}

// ────────────────────────────────────────────────────────────── daily
function daily(w, T) {
  const ec = w.econ, S = w.S, h = headcount(w, T.id), pop = T.dependants + h.labour + h.soldiers + T.squires;
  // spoilage (§ EST): open stacks, a proper granary, and overflow beyond capacity
  const cap = w.buildings.filter((b) => b.team === T.id && complete(b) && BUILDINGS[b.kind].capacity?.grain).reduce((s, b) => s + BUILDINGS[b.kind].capacity.grain, 0);
  const gran = w.buildings.filter((b) => b.team === T.id && complete(b) && (b.kind === "granary" || b.kind === "tithe_barn")).reduce((s, b) => s + BUILDINGS[b.kind].capacity.grain, 0); // (a tithe barn keeps grain as a granary does)
  const inGran = Math.min(T.store.grain, gran), open = Math.min(T.store.grain - inGran, cap - gran), over = Math.max(0, T.store.grain - inGran - open);
  const sm = TC.mul(w, T.id, "spoil"); // (research: staddle barns — the granary and the barn, not the open stacks)
  take(T, "grain", inGran * E.spoil.grainGranary * sm + open * E.spoil.grainOpen + over * E.spoil.overflow);
  take(T, "sheaves", T.store.sheaves * E.spoil.sheaves * sm); take(T, "fresh", T.store.fresh * E.spoil.fresh); take(T, "hay", T.store.hay * E.spoil.hay);
  // money: rents in, wages out
  const rents = T.besieged ? 0 : pop * E.rentsPerPersonDay * TC.mul(w, T.id, "rents"); // (research: clerks & tally-sticks)
  give(T, "silver", rents); T.day.income = rents;
  let bill = T.day.buildDays * 1.5 + T.day.craftDays * 3;
  for (const u of w.units.values()) if (u.team === T.id && !u.isWorkers) {
    const away = Math.hypot(u.ax - T.town.x, u.ay - T.town.y) > E.homeRadius;
    // (away, the days paid are the unit's field days — logistics.js fieldDays: a march is paid by the hour
    // it takes, a camp or a siege by the day)
    const days = away ? Math.min(1, u.payDays ?? 1) : 1; u.payDays = 0;
    bill += u.members.length * days * (u.arm === "levy" ? (away ? RECRUITS.levy.payAway : 0) : (PAY[u.arm] || 0) * (away ? 1 : E.homePayFrac * TC.mul(w, T.id, "homePay"))); // (castle-guard: js/sim/estates.js)
  }
  bill *= TC.mul(w, T.id, "wages"); // (the house's own mint: js/sim/estates.js)
  const today = bill; // (one day's wage bill: arrears are counted in days of THIS, not of what little was paid)
  bill += T.arrears; T.arrears = 0;
  const paidS = take(T, "silver", bill); let owed = bill - paidS;
  if (owed > 0) { const g = take(T, "gold", owed / 12); owed -= g * 12; }
  T.arrears = owed; T.day.wages = bill - owed; T.day.buildDays = 0; T.day.craftDays = 0;
  T.arrearsDays = T.arrears / Math.max(1, today);
  // hunger & unrest
  const hungry = 1 - T.ration;
  const fuel = T.store.firewood <= 0 ? 0.1 : 0;
  const target = clamp(hungry * 0.9 + clamp(T.arrearsDays / 10, 0, 0.3) + (T.besieged ? 0.15 : 0) + fuel + (T.recentLosses || 0) * 0.002 - TC.add(w, T.id, "order"), 0, 1); // (order: castles, the minster, the palace — js/sim/estates.js)
  T.unrest += (target - T.unrest) * 0.15;
  T.recentLosses = (T.recentLosses || 0) * 0.8;
  // starvation physiology (§9): deficit accumulates; deaths begin after ~3 weeks of half rations
  T.starveAcc = Math.max(0, T.starveAcc + (hungry > 0.2 ? hungry * 1.5 : -0.5));
  if (hungry > 0.2) T.stats.starvedDays++;
  const starveRate = clamp((T.starveAcc - 20) / 35, 0, 1) / 15 * TC.mul(w, T.id, "starve"); // share of the population dying per day (zero food → all dead in ~6–10 weeks; the hospital: js/sim/estates.js)
  T.acc.starve += pop * starveRate;
  while (T.acc.starve >= 1) { T.acc.starve--; if (!killForHunger(w, T)) break; }
  // births and natural deaths (crude rates)
  T.acc.birth += pop * E.birthsPerYear / 365 * (0.5 + 0.5 * T.ration);
  while (T.acc.birth >= 1) { T.acc.birth--; T.dependants++; T.census.births++; }
  T.acc.death += pop * E.deathsPerYear / 365 * TC.mul(w, T.id, "deaths"); // (the hospital: js/sim/estates.js)
  while (T.acc.death >= 1 && T.dependants > 0) { T.acc.death--; T.dependants--; T.census.died++; }
  migration(w, T, h, pop);
  LE.estateDaily(w, T); // (the hospital mends the wounded; the tiltyard's renown brings squires — js/sim/estates.js)
  breedHorses(w, T, ec);
  // market memory decays
  for (const k of Object.keys(T.market.recent)) T.market.recent[k] *= 0.85;
  // horses graze the fallow in summer; working horses away from home are fed in logistics.js
}

// the last member of a unit still on the map (retired men stay in u.members until the end of the tick)
function lastAlive(w, u) { if (!u) return undefined; for (let k = u.members.length - 1; k >= 0; k--) if (w.S.alive[u.members[k]]) return u.members[k]; return undefined; }
function killForHunger(w, T) {
  // the old and the very young die first (§9); then labourers
  if (T.dependants > 0) { T.dependants--; T.census.starved++; return true; }
  const id = lastAlive(w, homeUnit(w, T.id)) ?? workerUnits(w, T.id).map((u) => lastAlive(w, u)).find((x) => x !== undefined);
  if (id === undefined || !retire(w, id)) return false;
  T.census.starved++;
  return true;
}

export function housing(w, team) {
  const built = w.buildings.filter((b) => b.team === team && complete(b));
  const hp = TC.add(w, team, "housePop"); // (research: jettied timber framing — a loft in every cottage)
  const homes = built.reduce((s, b) => s + (BUILDINGS[b.kind].pop || 0) + (b.kind === "house" ? hp : 0), 0);
  // settlers' camp: shrinks as families move into new cottages (never adds room for newcomers)
  const T = w.teams[team], houses = built.filter((b) => b.kind === "house").length;
  const camp = Math.max(0, (T.camp0 || 0) - houses * (BUILDINGS.house.pop || 5));
  T.camp = camp;
  return homes + camp;
}

function migration(w, T, h, pop) {
  const cap = housing(w, T.id), foodDays = foodStock(T) / Math.max(1, dailyFoodNeed(w, T.id));
  const slack = cap - pop;
  // landless families come to a vill with empty cottages, bread and order (towns grew by migration)
  if (slack >= 5 && !T.besieged && T.unrest < 0.35 && foodDays > 20) {
    T.acc.imm += E.immigrationPerDay * clamp(slack / 10, 0.3, 1) * TC.mul(w, T.id, "immigration"); // (the guildhall's charter, the minster: js/sim/estates.js)
    while (T.acc.imm >= 1 && housing(w, T.id) - (T.dependants + headcount(w, T.id).labour + h.soldiers + T.squires) >= 5) {
      T.acc.imm--;
      const [nl, nd] = E.familySize; const extraDep = (T.census.immigrants / 4) % 2 < 1 ? 2 : 3; // 2.5 dependants on average
      const u = addUnit(w, { team: T.id, arm: "villager", count: nl, x: T.town.x + 30, y: T.town.y - 40, formation: "loose", training: 0.1 });
      w.econ.role.set(u.members[0], ROLE.man); w.econ.role.set(u.members[1], ROLE.woman);
      resetJob(u, { kind: "home" }); const home = homeUnit(w, T.id); if (home && home !== u) mergeUnits(w, [home, u]); else T.homeUnit = u.id;
      T.dependants += extraDep; T.census.immigrants += nl + extraDep;
      w.events.push({ t: w.tick, kind: "migrants", team: T.id, n: nl + extraDep });
    }
  } else T.acc.imm = Math.min(T.acc.imm, 0.5);
  // hunger and disorder drive people away
  if (T.unrest > 0.5 && !T.besieged) {
    T.acc.emi += (T.unrest - 0.5) * 0.02 * pop;
    while (T.acc.emi >= 1) {
      T.acc.emi--;
      const home = homeUnit(w, T.id), id = home && home.members.length > 1 ? lastAlive(w, home) : undefined;
      if (T.dependants > 1 && T.acc.emi % 2 < 1) { T.dependants--; T.census.emigrated++; }
      else if (id !== undefined && retire(w, id)) T.census.emigrated++;
      else if (T.dependants > 0) { T.dependants--; T.census.emigrated++; }
      else break;
    }
  }
}

// Take a dot off the map without it being a casualty (drafted, emigrated, deserted, starved).
export function retire(w, id) {
  const S = w.S; if (!S.alive[id]) return false;
  LB.forget(w, id); // (his load is set down where he stands: labor.js)
  // out of his unit at once: retire() is also called between ticks (recruiting, disbanding), and a dead id
  // left in a moving unit until the end-of-tick compaction gets its state rewritten by the movement code
  // (then it counts as a casualty and the census no longer balances)
  const u = w.units.get(S.unit[id]); if (u) { const k = u.members.indexOf(id); if (k >= 0) { u.members.splice(k, 1); u.slotCache = null; } }
  S.alive[id] = 0; S.state[id] = S_GONE; S.unit[id] = -1;
  w.econ.role.delete(id); w.econ.practice.delete(id); w.sagas?.delete(id);
  S.free.push(id);
  return true;
}

// ────────────────────────────────────────────────────────────── recruitment
// Draft men NOW (they stop working) and pay the gear NOW; they muster after `days`.
export function canRecruit(w, team, arm, mount) {
  const R = RECRUITS[arm], T = w.teams[team]; if (!R) return 0;
  const mnt = mountIdxFor(mount); if (mnt && (!T.tradition?.[mount] || !mountFits(arm, mount))) return 0; // (the town has not learned to ride them; or not for these men)
  let men = 0;
  if (R.from[0] === "squire") men = T.squires;
  else for (const u of workerUnits(w, team)) for (const id of u.members) if (w.S.alive[id] && R.from.includes(ROLES[roleOf(w, id)])) men++;
  let gear = Infinity; for (const [g, n] of Object.entries(R.gear)) gear = Math.min(gear, Math.floor(((mnt && (g === "horses" || g === "destriers") ? T.mounts?.[mount] : T.store[g]) || 0) / n));
  if (R.perUnit) return Math.min(Math.floor(men / R.crew), gear); // engines: how many can be crewed and fitted out
  return Math.min(men, gear);
}

export function queueRecruit(w, b, arm, count, { rushed = false, mount = null } = {}) {
  const R = RECRUITS[arm], T = w.teams[b.team], def = BUILDINGS[b.kind];
  if (!R || !complete(b) || !(def.recruits || []).includes(arm)) return 0;
  const mnt = mountIdxFor(mount); if (mnt && !ARMS[arm].horse) mount = null; // a mount is for cavalry
  count = Math.min(count, canRecruit(w, b.team, arm, mount)); if (count <= 0) return 0;
  const engines = R.perUnit ? count : 0; if (engines) count = engines * R.crew; // (an engine's gear is per engine, its crew per man)
  for (const [g, n] of Object.entries(R.gear)) { if (mnt && (g === "horses" || g === "destriers")) { T.mounts[mount] -= n * count; continue; } take(T, g, n * (engines || count)); } // (a chosen mount replaces the horse, from the trained stock)
  let opt = count; for (const [g, n] of Object.entries(R.optGear || {})) opt = Math.min(opt, Math.floor((T.store[g] || 0) / n));
  for (const [g, n] of Object.entries(R.optGear || {})) take(T, g, n * opt);
  if (R.from[0] === "squire") T.squires -= count;
  else {
    let got = 0;
    for (const role of R.from) for (const u of workerUnits(w, b.team).sort((a, c) => (a.job?.kind === "home" ? 0 : 1) - (c.job?.kind === "home" ? 0 : 1) || a.id - c.id)) {
      for (const id of u.members.slice()) { if (got >= count) break; if (ROLES[roleOf(w, id)] === role && retire(w, id)) got++; }
    }
  }
  T.census.inTraining += count;
  const armour = opt / count; // share with the optional gear (gambeson/helm) → slightly better men
  if (engines) { b.queue.push({ arm, count, engines, t: 0, days: R.days, training: R.training }); return engines; }
  const rm = TC.recruitMods(w, b.team, arm); // (research: drill, the tiltyard, the crossbow workshop — js/sim/tech.js)
  // (research: a coat of plates for each man-at-arms or knight, from the smithy's stock, while it lasts)
  const plates = TC.add(w, b.team, "plates") && (arm === "menatarms" || arm === "knights") ? Math.min(count, Math.floor(T.store.plates || 0)) : 0;
  if (plates) take(T, "plates", plates);
  b.queue.push({ arm, count, t: 0, days: (rushed && R.rushedDays ? R.rushedDays : R.days) * rm.days, training: (rushed && R.rushedTraining ? R.rushedTraining : R.training) + 0.05 * armour + rm.training, mount: mountIdxFor(mount) ? mount : undefined, ...(plates ? { plates } : {}) });
  return count;
}

// Put one rider through years of the tiltyard (compressed): he leaves the labour force now.
export function startSquire(w, b) {
  if (b.kind !== "stables" || !complete(b) || b.tilt) return false;
  for (const u of workerUnits(w, b.team)) for (const id of u.members) if (roleOf(w, id) === ROLE.rider && retire(w, id)) { w.teams[b.team].census.inTraining++; b.tilt = { t: 0 }; return true; }
  return false;
}

// Stand a unit down: its men go home to the fields with their skills (and their kit to the store).
// Retained troops (the lord's retinue) cannot be disbanded. Headcount is conserved one for one.
const DISBAND_ROLE = { levy: "man", spearmen: "spear", pikemen: "spear", menatarms: "spear", archers: "archer", crossbow: "man", hobelars: "rider", scouts: "rider" };
export function disband(w, u, only = null) {
  if (!u || u.isWorkers || u.retinue || !DISBAND_ROLE[u.arm]) return 0;
  const T = w.teams[u.team], R = RECRUITS[u.arm], S = w.S;
  const ids = (only || u.members).filter((id) => S.alive[id] && S.state[id] !== S_FIGHT && S.state[id] !== S_FLEE);
  if (!ids.length) return 0;
  let cx = 0, cy = 0; for (const id of ids) { cx += S.x[id]; cy += S.y[id]; }
  for (const id of ids) retire(w, id);
  for (const [g, n] of Object.entries(R.gear)) { if (u.mount && (g === "horses" || g === "destriers")) { (T.mounts ||= {})[u.mount] = (T.mounts[u.mount] || 0) + n * ids.length; continue; } give(T, g, n * ids.length * (g === "arrows" || g === "bolts" ? 0.5 : 1)); }
  const nu = addUnit(w, { team: u.team, arm: "villager", count: ids.length, x: cx / ids.length, y: cy / ids.length, formation: "loose", training: 0.1 });
  for (const id of nu.members) w.econ.role.set(id, ROLE[DISBAND_ROLE[u.arm]]);
  resetJob(nu, { kind: "home" }); const home = homeUnit(w, u.team); if (home && home !== nu) mergeUnits(w, [home, nu]); else T.homeUnit = nu.id;
  w.events.push({ t: w.tick, kind: "disbanded", team: u.team, arm: u.arm, n: ids.length });
  return ids.length;
}

// ── learned mounts (js/sim/mounts.js; docs/mounts-wildlife-spec.md) ──────────────────────────────
// The training track: a handler (a rider-role labourer somewhere in the town) breaks one penned juvenile at a
// time over MOUNTS[].trainDays; the first one finished founds the tradition and the stables offer the mount.
function stableTrack(w, b, T) {
  const tr = b.train;
  if (tr) {
    tr.t += DT;
    if (tr.t >= tr.days) {
      b.train = null;
      (T.mounts ||= {})[tr.kind] = (T.mounts[tr.kind] || 0) + 1;
      if (!T.tradition?.[tr.kind]) { (T.tradition ||= {})[tr.kind] = true; w.events.push({ t: w.tick, kind: "mount-tradition", team: b.team, mount: tr.kind, building: b.id }); }
      w.events.push({ t: w.tick, kind: "mount-trained", team: b.team, mount: tr.kind, building: b.id });
    }
    return;
  }
  if (!b.pens) return;
  for (const kind of ["strider", "drake"]) {
    if (!(b.pens[kind] > 0)) continue;
    if (!hasHandler(w, b.team)) return; // no one to break it: the juvenile waits in the pen
    b.pens[kind]--;
    b.train = { kind, t: 0, days: MOUNTS[MOUNT_ID[kind]].trainDays };
    w.events.push({ t: w.tick, kind: "mount-training", team: b.team, mount: kind, building: b.id });
    return;
  }
}
function hasHandler(w, team) {
  for (const u of workerUnits(w, team)) for (const id of u.members) if (w.S.alive[id] && roleOf(w, id) === ROLE.rider) return true;
  return false;
}
// Change what a standing cavalry company rides (at the stables, 2 days): the new mounts are drawn now, the
// old ones come back to the stock when the change is done.
export function queueRetrain(w, b, unitId, mount) {
  const u = w.units.get(unitId), T = w.teams[b.team], A = u && ARMS[u.arm];
  if (!u || u.team !== b.team || !A?.horse || u.isWorkers || b.kind !== "stables" || !complete(b)) return 0;
  if ((u.mount || "horse") === (mount || "horse")) return 0;
  if (b.queue.some((q) => q.retrain === unitId)) return 0;
  const S = w.S, n = u.members.filter((id) => S.alive[id]).length; if (!n) return 0;
  const mnt = mountIdxFor(mount);
  if (mnt) { if (!T.tradition?.[mount] || !mountFits(u.arm, mount) || (T.mounts?.[mount] || 0) < n) return 0; T.mounts[mount] -= n; }
  else { const g = A.horse === 2 ? "destriers" : "horses"; if ((T.store[g] || 0) < n) return 0; take(T, g, n); }
  b.queue.push({ retrain: unitId, mount: mnt ? mount : undefined, count: n, t: 0, days: 2, arm: u.arm });
  return n;
}
function finishRetrain(w, b, T, q) {
  const u = w.units.get(q.retrain), S = w.S, mnt = mountIdxFor(q.mount);
  const refund = (kind, n) => { if (n <= 0) return; if (kind) (T.mounts ||= {})[kind] = (T.mounts[kind] || 0) + n; };
  if (!u || !u.members.length || u.team !== b.team) { if (mnt) refund(q.mount, q.count); else give(T, ARMS[q.arm].horse === 2 ? "destriers" : "horses", q.count); return; } // the company is gone: the mounts go back
  const A = ARMS[u.arm], old = u.mount, alive = u.members.filter((id) => S.alive[id]);
  // the old mounts home to the stock; losses since the queue are refunded from the new draw
  if (old) refund(old, alive.length); else give(T, A.horse === 2 ? "destriers" : "horses", alive.length);
  if (q.count > alive.length) { if (mnt) refund(q.mount, q.count - alive.length); else give(T, A.horse === 2 ? "destriers" : "horses", q.count - alive.length); }
  for (const id of alive) remount(S, w.rng, id, mnt || A.horse, HORSES);
  if (mnt) { u.mount = q.mount; u.mnt = mnt; u.runSpeed = A.run * (A.armour >= 4 ? M_SPDA : M_SPD)[mnt]; }
  else { delete u.mount; delete u.mnt; delete u.runSpeed; }
  w.events.push({ t: w.tick, kind: "retrained", unit: u.id, team: b.team, mount: q.mount || "horse", count: alive.length });
}
// how many of a mount kind the team keeps (companies + trained stock) — the feeding bill reads it
export function countMounts(w, team, kind) {
  let n = w.teams[team].mounts?.[kind] || 0;
  for (const u of w.units.values()) if (u.team === team && u.mount === kind) for (const id of u.members) if (w.S.alive[id] && w.S.horseOK[id] === 1) n++;
  return n;
}
// Drakes eat MEAT: the larder first, then the flocks (a sheep ≈ 25 kg dressed); a starved stock drake wastes
// away. Striders eat grain — charged in dailyFoodNeed like the destriers, at less than half the oats.
function feedMounts(w, T) {
  const drakes = countMounts(w, T.id, "drake"); if (!drakes) { T.drakeHunger = 0; return; }
  let need = drakes * MOUNTS[MOUNT_ID.drake].feed.meat * DT;
  need -= take(T, "fresh", need);
  if (need > 1e-9) {
    // the larder is bare: the hunger ledger grows until a sheep is worth driving in (~25 kg dressed),
    // and with the flocks gone too a stock drake wastes away after ~15 kg-days short
    T.drakeHunger = (T.drakeHunger || 0) + need;
    while (T.drakeHunger >= 25 && T.sheep > 0) { T.sheep--; T.drakeHunger -= 25; T.stats.sheepToDrakes = (T.stats.sheepToDrakes || 0) + 1; }
    if (T.drakeHunger > 15 && T.sheep <= 0 && (T.mounts?.drake || 0) > 0) { T.mounts.drake--; T.drakeHunger -= 15; w.events.push({ t: w.tick, kind: "mount-starved", team: T.id, mount: "drake" }); }
  } else T.drakeHunger = Math.max(0, (T.drakeHunger || 0) - DT);
}

// by "player": the owner chose it (b.makeBy) — the reeve (ai-general.js setProduction) never changes it until he hands it
// back with "Auto" (autoProduct)
export function setProduct(w, b, product, by = null) { if (RECIPES[b.kind]?.[product] && TC.productOpen(w, b.team, b.kind, product)) { if (b.make !== product) b.work = 0; b.make = product; if (by) b.makeBy = by; return true; } return false; }
export function autoProduct(b) { b.makeBy = null; }

// ────────────────────────────────────────────────────────────── a workshop's crew (the owner: "I can't figure out how to assign workers")
// b.crew: the men the player wants there (0..crewMax), or null/undefined = the reeve decides (ai-general.js allocateLabour
// staffs a player-set crew before anything else and never changes its size). The work: a workshop's craft, the butts' practice.
export const workJob = (b) => RECIPES[b.kind] ? { kind: "craft", b } : b.kind === "archery_range" ? { kind: "practice", b } : null;
export const crewMax = (b) => BUILDINGS[b.kind]?.staff || 4; // (craftWork counts the first `staff` men)
export const crewTrade = (b) => RECIPES[b.kind]?.trade || null;
export const crewPrefer = (b) => b.kind === "archery_range" ? ["man", "spear"] : crewTrade(b) ? [crewTrade(b), "man"] : ["man"];
export function crewUnits(w, b) { const out = []; for (const u of w.units.values()) if (u.team === b.team && u.isWorkers && u.members.length && u.job?.b === b && (u.job.kind === "craft" || u.job.kind === "practice")) out.push(u); return out; }
// who works it now: { n, max, trade, skilled (men of the trade among them), roles {role: n}, want (b.crew or null), tradesmen (of the trade, in the whole vill) }
export function crewOf(w, b) {
  const roles = {}, trade = crewTrade(b); let n = 0, skilled = 0;
  for (const u of crewUnits(w, b)) for (const id of u.members) { if (!w.S.alive[id]) continue; n++; const r = ROLES[roleOf(w, id)]; roles[r] = (roles[r] || 0) + 1; if (r === trade) skilled++; }
  return { n, max: crewMax(b), trade, skilled, roles, want: Number.isInteger(b.crew) ? b.crew : null, tradesmen: trade ? tradesmen(w, b.team, trade) : 0, unskilled: RECIPES[b.kind]?.unskilled ?? null };
}
export function tradesmen(w, team, trade) { const r = ROLE[trade]; let n = 0; for (const u of workerUnits(w, team)) for (const id of u.members) if (w.S.alive[id] && roleOf(w, id) === r) n++; return n; }
// set the crew the player wants (n = null: back to the reeve). The men move at once: the surplus home (the tradesmen kept),
// the shortfall from the free hands — the vill's men of the trade first, wherever the reeve has them, then home.
// → { ok, n (there now), want }
export function setCrew(w, b, n) {
  const job = workJob(b); if (!job) return { ok: false, error: "Nobody works there" };
  if (n === null || n === undefined) { b.crew = null; return { ok: true, n: crewOf(w, b).n, want: null }; }
  const want = Math.max(0, Math.min(crewMax(b), Math.round(n))); b.crew = want;
  let us = crewUnits(w, b), crew = us.length > 1 ? mergeUnits(w, us) : us[0] || null;
  if (crew) { crew.ordered = false; crew.broad = null; crew.away = false; } // (now the workshop's crew: the reeve keeps it at b.crew)
  const have = crew ? crew.members.length : 0, trade = crewTrade(b);
  if (have > want) releaseWorkers(w, crew, have - want, trade ? [trade] : []);
  else if (have < want) {
    let need = want - have;
    if (trade) { // the vill's men of the trade, from the reeve's other crews and from home
      const from = workerUnits(w, b.team).filter((u) => u !== crew && u.members.length && !u.away && !u.convoy && !u.broad && !u.ordered && u.job?.b !== b);
      let free = 0; for (const u of from) for (const id of u.members) if (w.S.alive[id] && ROLES[roleOf(w, id)] === trade) free++;
      const k = Math.min(need, free);
      if (k > 0) { const got = assignWorkers(w, b.team, job, k, [trade], from); if (got) { got.ordered = false; got.broad = null; got.away = false; } need -= k; }
    }
    if (need > 0) assignWorkers(w, b.team, job, need, crewPrefer(b));
  }
  return { ok: true, n: crewOf(w, b).n, want };
}

// ────────────────────────────────────────────────────────────── where the people come from (the keep panel, the top bar)
// The numbers daily() and migration() use, read out: births and deaths a year, the families the empty cottages draw (or
// why none come), the next family's ETA in days. Nothing here changes the balance.
export function growthInfo(w, team) {
  const T = w.teams[team]; if (!T?.store) return null;
  const h = headcount(w, team), pop = T.dependants + h.labour + h.soldiers + T.squires, cap = housing(w, team), empty = cap - pop;
  const need = dailyFoodNeed(w, team), foodDays = foodStock(T) / Math.max(1, need);
  const ration = T.ration ?? 1, unrest = T.unrest || 0;
  // the Cruck Houses it takes before a family can come: each adds its places, and the settlers' camp folds by 5 as each goes up
  const perHouse = (BUILDINGS.house.pop || 5) + TC.add(w, team, "housePop"), houses = w.buildings.filter((b) => b.team === team && b.kind === "house" && complete(b)).length;
  const camp = T.camp || 0, homes = cap - camp; let housesNeeded = 0;
  while (housesNeeded < 999 && homes + housesNeeded * perHouse + Math.max(0, (T.camp0 || 0) - (houses + housesNeeded) * (BUILDINGS.house.pop || 5)) - pop < 5) housesNeeded++;
  const why = [];
  if (empty < 5) why.push({ k: "room", text: `no empty cottages (${empty < 0 ? `your people already overfill the housing by ${-empty}` : `${empty} free place${empty === 1 ? "" : "s"}`}; a family needs 5): build about ${housesNeeded} more Cruck House${housesNeeded === 1 ? "" : "s"}${camp > 0 ? " — the settlers' camp folds as the cottages go up" : ""}` });
  if (foodDays <= 20) why.push({ k: "food", text: `food below 20 days (${Math.floor(foodDays)} in store)` });
  if (unrest >= 0.35) why.push({ k: "unrest", text: `unrest at ${Math.round(unrest * 100)}% (families come only below 35%)` });
  if (T.besieged) why.push({ k: "siege", text: "besieged: nobody comes through the enemy's lines" });
  const rate = why.length ? 0 : E.immigrationPerDay * clamp(empty / 10, 0.3, 1); // families a day
  const imm = Math.max(0, T.acc?.imm || 0);
  return { pop, cap, empty, camp, houses, housesNeeded, perHouse, keepPop: BUILDINGS.town_hall.pop || 0,
    birthsYear: pop * E.birthsPerYear * (0.5 + 0.5 * ration), deathsYear: pop * E.deathsPerYear, rate, eta: rate > 0 ? Math.max(0, 1 - imm) / rate : null,
    family: E.familySize[0] + E.familySize[1], why, foodDays, unrest, leavingDay: unrest > 0.5 && !T.besieged ? (unrest - 0.5) * 0.02 * pop : 0,
    immigrants: T.census?.immigrants || 0, births: T.census?.births || 0 };
}

// ────────────────────────────────────────────────────────────── market (§8, trade at spread)
export function price(w, team, good, buying) {
  const [base, depth] = PRICES[good] || [0, 1]; const T = w.teams[team];
  const pressure = (T.market.recent[good] || 0) / depth;
  return base * (buying ? SPREAD.buy : SPREAD.sell) * Math.exp(clamp(pressure * 0.35, -1.5, 3));
}
// qty > 0 buys, < 0 sells. Returns the quantity actually traded.
export function trade(w, team, good, qty) {
  const T = w.teams[team]; if (!PRICES[good] || !hasBuilding(w, team, "market") || T.besieged || T.fallen) return 0;
  const [, depth] = PRICES[good];
  const room = depth * 3 - Math.abs(T.market.recent[good] || 0);
  qty = Math.sign(qty) * Math.min(Math.abs(qty), Math.max(0, room));
  if (qty > 0) {
    const p = price(w, team, good, true), cash = T.store.silver + T.store.gold * 12;
    qty = Math.min(qty, cash / p); if (qty < 1e-6) return 0;
    let cost = qty * p; const s = take(T, "silver", cost); cost -= s; if (cost > 0) take(T, "gold", cost / 12);
    give(T, good, qty); T.stats.bought += qty * p;
  } else if (qty < 0) {
    qty = -Math.min(-qty, T.store[good] || 0); if (qty > -1e-6) return 0;
    const p = price(w, team, good, false); take(T, good, -qty); give(T, "silver", -qty * p); T.stats.sold += -qty * p;
  }
  T.market.recent[good] = (T.market.recent[good] || 0) + qty;
  return qty;
}

// Tallage: an extraordinary levy on the vill (≈1 s a head, less what unrest hides). Resented.
export function levyTallage(w, team) {
  const T = w.teams[team]; if (T.besieged || T.fallen || w.econ.doy - (T.lastTallage ?? -99) < 30) return 0;
  const h = headcount(w, team), pop = T.dependants + h.labour;
  const d = pop * 12 * (1 - T.unrest);
  give(T, "silver", d); T.unrest = clamp(T.unrest + 0.12, 0, 1); T.lastTallage = w.econ.doy;
  w.events.push({ t: w.tick, kind: "tallage", team, d });
  return d;
}

// ────────────────────────────────────────────────────────────── mana
// the most mana the store holds: 60, an Adepts' Tower 200; ley lore adds to either (js/sim/tech.js)
export const manaCapOf = (w, team) => (hasBuilding(w, team, "mage_tower") ? BUILDINGS.mage_tower.manaCap : 60) + TC.add(w, team, "manaCap");

export function castSpell(w, team, kind, x, y) {
  const Sp = SPELLS[kind], T = w.teams[team], S = w.S; if (!Sp || T.store.mana < Sp.mana || !TC.spellOpen(w, team, kind)) return false; // (a spell may need its study: the Rite of Quenching)
  let adept = false; for (const u of workerUnits(w, team)) if (u.members.some((id) => roleOf(w, id) === ROLE.adept)) { adept = true; break; }
  if (!adept) return false;
  take(T, "mana", Sp.mana);
  if (kind === "mist") { w.mist = { visibility: 0.4, until: w.tick + Sp.days / DT }; }
  else if (kind === "quench") { for (const b of w.buildings) if (b.fire > 0 && !b.ruin && Math.hypot(b.x - x, b.y - y) < Sp.radius + (b.length || 0) / 2) b.fire = 0; } // every fire in reach dies, friend's or foe's
  else {
    const nb = neighbours(w, x, y, Sp.radius, []);
    for (const id of nb) if (S.team[id] === team && S.alive[id]) { if (kind === "bless") S.stress[id] = Math.max(0, S.stress[id] - 0.3); if (kind === "mend") S.wounds[id] = Math.max(0, S.wounds[id] - 0.4); }
  }
  w.events.push({ t: w.tick, kind: "spell", spell: kind, team, x, y });
  return true;
}

// ────────────────────────────────────────────────────────────── census (ledger)
// start + births + immigrants == dependants + squires + inTraining + alive dots + casualties
//                               + deserted + emigrated + starved + died
export function census(w, team) {
  const S = w.S, T = w.teams[team], c = T.census;
  let alive = 0, casualties = 0;
  for (let i = 0; i < S.n; i++) {
    if (S.team[i] !== team) continue;
    if (S.alive[i]) alive++; else if (S.state[i] !== S_GONE) casualties++; // dead, down, captured …
  }
  const inflow = c.start + c.births + c.immigrants;
  const accounted = T.dependants + T.squires + TW.extraHeads(w, team) + c.inTraining + alive + casualties + c.deserted + c.emigrated + c.starved + c.died; // (+ the daughter towns' families: js/sim/towns.js)
  return { inflow, accounted, alive, casualties, ok: inflow === accounted };
}
