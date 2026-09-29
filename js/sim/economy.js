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
  b.field = { crop, ha, care: 0.5, left: C ? ha * C.yieldKgHa * (1 - 0.6 * lateness) : 0, yieldKgHa: C?.yieldKgHa || 0, seedFrac: C ? C.seedKgHa / C.yieldKgHa : 0, ripe: C?.ripe || 999, state: C ? "growing" : "fallow", burnt: 0 };
  return b;
}
// Candidate furlongs for a town plan (same siting rules as the prebuilt open fields).
export function fieldSites(w, team, x, y, n = 17) {
  const map = w.map, wdt = 280, hgt = 320, out = [];
  const a0 = team * 1.3 + 0.4;
  for (let tries = 0; tries < 900 && out.length < n; tries++) {
    const r = 260 + (tries % 11) * 95, a = a0 + tries * 0.61;
    const fx = x + Math.cos(a) * r, fy = y + Math.sin(a) * r;
    if (!map.inBounds(fx - wdt / 2, fy - hgt / 2) || !map.inBounds(fx + wdt / 2, fy + hgt / 2)) continue;
    let ok = true;
    for (const [px, py] of [[0, 0], [-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) {
      const sx = fx + px * wdt, sy = fy + py * hgt;
      if (map.water(sx, sy) > 0.02 || Math.hypot(...map.grad(sx, sy)) > 0.18) { ok = false; break; }
    }
    if (!ok || out.some((p) => Math.abs(p.x - fx) < wdt + 10 && Math.abs(p.y - fy) < hgt + 10)) continue;
    if ((w.resources || []).some((q) => Math.hypot(q.x - fx, q.y - fy) < 180 + q.r)) continue;
    out.push({ x: fx, y: fy, w: wdt, h: hgt });
  }
  return out;
}

// Open fields in a ring around the vill: three-field rotation (⅓ fallow grazing).
function layFields(w, team, x, y) {
  const map = w.map, crops = ["wheat", "barley", "wheat", "oats", "peas", "wheat", "barley", "oats", "wheat", "barley", "oats", "peas", "fallow", "fallow", "fallow", "fallow", "fallow"];
  const placed = [];
  const a0 = team * 1.3 + 0.4, wdt = 280, hgt = 320;
  for (let tries = 0, c = 0; tries < 900 && c < crops.length; tries++) {
    const r = 260 + (tries % 11) * 95, a = a0 + tries * 0.61;
    const fx = x + Math.cos(a) * r, fy = y + Math.sin(a) * r;
    if (!map.inBounds(fx - wdt / 2, fy - hgt / 2) || !map.inBounds(fx + wdt / 2, fy + hgt / 2)) continue;
    let ok = true;
    for (const [px, py] of [[0, 0], [-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) {
      const sx = fx + px * wdt, sy = fy + py * hgt;
      if (map.water(sx, sy) > 0.02 || Math.hypot(...map.grad(sx, sy)) > 0.18) { ok = false; break; }
    }
    if (!ok || placed.some((p) => Math.abs(p.x - fx) < wdt + 10 && Math.abs(p.y - fy) < hgt + 10)) continue;
    if (w.buildings.some((b) => b.field && Math.abs(b.x - fx) < wdt + 10 && Math.abs(b.y - fy) < hgt + 10)) continue;
    if ((w.resources || []).some((n) => Math.hypot(n.x - fx, n.y - fy) < 180 + n.r)) continue;
    const crop = crops[c++];
    const b = placeBuilding(w, team, "field", fx, fy, 0, true);
    initField(b, crop, wdt, hgt);
    placed.push(b);
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
  const hpMax = def.hp * len * (fx?.hpMul || 1);
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

const hallOf = (w, team) => w.buildings.find((b) => b.team === team && b.kind === "town_hall" && !b.ruin);
export const complete = (b) => b.progress >= 1 && !b.ruin;
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
  if (b.mods && hp > 0) { const per = hp / b.mods.length; for (let k = 0; k < b.mods.length; k++) b.mods[k] = Math.max(b.mods[k] > 0 ? 1 : 0, b.mods[k] - per); } // (spread damage wears, it does not breach)
  if (fire && BUILDINGS[b.kind].flammable) b.fire = Math.max(b.fire, Math.min(1, fire * BUILDINGS[b.kind].flammable * (b.land?.fireMul || 1)));
  if (b.hp <= 0) ruinBuilding(w, b);
}

function ruinBuilding(w, b) {
  b.hp = 0; b.ruin = true; b.fire = 0; b.stage = "ruin";
  const def = BUILDINGS[b.kind], T = w.teams[b.team];
  if (def.wall) blockWall(w, b, false);
  // a burnt granary takes its share of the grain with it
  if (b.kind === "granary" && b.progress >= 1) { const lost = Math.min(T.store.grain, def.capacity.grain) * 0.8; take(T, "grain", lost); take(T, "sheaves", T.store.sheaves * 0.5); }
  w.events.push({ t: w.tick, kind: "building-lost", building: b.id, team: b.team, what: b.kind });
  if (b.kind === "town_hall") T.fallen = true;
}

// ────────────────────────────────────────────────────────────── stores
export function take(T, r, n) { const have = T.store[r] || 0; const got = Math.min(have, Math.max(0, n)); T.store[r] = have - got; if (T.store[r] < 1e-9) T.store[r] = 0; return got; }
export function give(T, r, n) { if (n > 0) T.store[r] = (T.store[r] || 0) + n; }
export const foodStock = (T) => FOOD.reduce((s, r) => s + (T.store[r] || 0), 0);

// Man-days to haul one kg `d` metres to a store, using the team's best free carrier (§4).
export function haulManDaysPerKg(w, team, d, kgPerDay = 1000, carts = 0) {
  const C = E.carriers;
  const per = (c) => (2 * d / c.v + c.load) / 36000 / c.kg; // a working day ≈ 10 h = 36 000 s
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
  let target = workerUnits(w, team).find((u) => jobKey(u.job) === jobKey(job) && !byUnit.has(u));
  for (const [u, ids] of byUnit) {
    const nu = ids.length === u.members.length ? u : splitUnit(w, u, ids);
    resetJob(nu, job);
    if (target) mergeUnits(w, [target, nu]); else target = nu;
  }
  return target;
}

export function releaseWorkers(w, u, n = Infinity, keepRoles = []) {
  if (!u || !u.isWorkers) return;
  const ids = u.members.slice().sort((a, b) => (keepRoles.includes(ROLES[roleOf(w, a)]) ? 1 : 0) - (keepRoles.includes(ROLES[roleOf(w, b)]) ? 1 : 0) || a - b).slice(0, Math.min(n, u.members.length));
  if (!ids.length) return;
  const part = ids.length === u.members.length ? u : splitUnit(w, u, ids);
  const home = homeUnit(w, u.team);
  resetJob(part, { kind: "home" });
  if (home && home !== part) mergeUnits(w, [home, part]); else w.teams[u.team].homeUnit = part.id;
}

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
    return { kind: "build", b };
  }
  let node = null, bd = 90;
  for (const r of w.resources || []) { const d = Math.hypot(r.x - order.x, r.y - order.y); if (d < bd + r.r && r.amount > 0) { bd = d; node = r; } }
  if (node) return { kind: "gather", node, res: order.res || node.res };
  for (const b of w.buildings) if (b.team === u.team && b.kind === "field" && Math.abs(order.x - b.x) < b.w / 2 && Math.abs(order.y - b.y) < b.h / 2) return { kind: "field", b };
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
  ec.doy = ec.startDoy + w.tick * DT;
  const dayNow = Math.floor(w.tick * DT);
  const newDay = dayNow !== ec.dayIndex; ec.dayIndex = dayNow;
  for (const T of w.teams) if (T.store) teamFactors(w, T);
  // villagers the player has marched off (u.away) are under his orders, not the reeve's, until set to work again
  for (const u of w.units.values()) {
    if (!u.isWorkers || !u.members.length) continue;
    if (u.away && !u.convoy && (u.moving || u.path || u.pendingOrder)) u.awayUntil = Math.max(u.awayUntil || 0, w.tick + VILLAGER_OBEY_TICKS); // still on the way
    if (u.away && w.tick > (u.awayUntil || 0)) { // their patience is up: back to their usual work
      u.away = false; u.path = null; resetJob(u, { kind: "home" });
      w.log.push({ t: w.tick, kind: "villagers-return", unit: u.id, team: u.team });
      const home = homeUnit(w, u.team); if (home && home !== u) mergeUnits(w, [home, u]);
      continue;
    }
    if (u.playerJobUntil && w.tick > u.playerJobUntil) { u.playerJobUntil = 0; if (u.job?.kind !== "home") { releaseWorkers(w, u); continue; } }
    if (!u.away) workUnit(w, u);
  }
  for (const b of w.buildings) if (!b.ruin) buildingTick(w, b);
  for (const T of w.teams) if (T.store && !T.fallen) { consume(w, T); if (newDay) daily(w, T); }
  if (w.tick % 10 === 0) arson(w);
  if (newDay) for (const n of w.resources) if (n.kind === "fishery" || n.kind === "ley") n.amount = Math.min(n.start, n.amount + n.start * 0.01);
}

// Productivity multipliers shared by every worker in the team this tick.
function teamFactors(w, T) {
  const doy = w.econ.doy;
  const daylight = 12 + 4.4 * Math.sin(2 * Math.PI * (doy - 80) / 365); // hours at ~52°N
  T.harvestTime = w.buildings.some((b) => b.team === T.id && b.field?.state === "ripe");
  const workday = T.harvestTime ? 1 : E.workdayFrac;
  const mill = hasBuilding(w, T.id, "mill") ? 1 : 1 - E.handGrindLabour;
  T.eff = workday * clamp(daylight / 14, 0.6, 1.15) * mill * (1 - 0.4 * T.unrest) * (0.55 + 0.45 * clamp(T.ration, 0, 1));
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
      if (v.team === u.team || v.isWorkers || !v.members.length || v.state === "routing") continue;
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
  const nHaul = Math.round(u.members.length * haulShare);
  const store = job.kind === "gather" ? (u.store || null) : null;
  let cx = 0, cy = 0;
  for (let k = 0; k < u.members.length; k++) {
    const id = u.members[k];
    if (!S.alive[id]) continue;
    cx += S.x[id]; cy += S.y[id];
    if (S.state[id] === S_FLEE || S.state[id] === S_FIGHT) continue;
    if (!safe) { moveTo(S, id, home.x + spiral(k, 3)[0], home.y + spiral(k, 3)[1], speed * 2.3, w.map.size); continue; }
    let tx, ty;
    if (k < nHaul && store) {
      // hauler: shuttle node ↔ store
      let dir = u.haul.get(id) || 0;
      tx = dir ? store.x : site.x; ty = dir ? store.y : site.y;
      if (Math.hypot(tx - S.x[id], ty - S.y[id]) < 4) { dir ^= 1; u.haul.set(id, dir); }
      moveTo(S, id, tx, ty, speed * E.commuteMul, w.map.size); S.state[id] = S_MOVE; haulers++;
      continue;
    }
    [tx, ty] = spotFor(w, u, site, k);
    const d = Math.hypot(tx - S.x[id], ty - S.y[id]);
    if (d > 25) moveTo(S, id, tx, ty, speed * E.commuteMul, w.map.size); // on the road to the job
    else { // at the job: stepping to the next part of the work is part of the work (it isn't a commute)
      if (d > 4) moveTo(S, id, tx, ty, speed, w.map.size);
      else { if (d > 0.2) moveTo(S, id, tx, ty, speed * 0.25, w.map.size); S.state[id] = S_WORK; } // slow drift
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
    return [site.x + Math.cos(a) * R + (r1 - 0.5) * 16 + (ph - 0.5) * 3, site.y + Math.sin(a) * R + (r2 - 0.5) * 16];
  }
  // gathering: anywhere across the wood / quarry face / hunting ground, wandering a little
  // (each man keeps to his own part of it — the next tree, the next stretch of face — not the far side)
  const R = Math.sqrt(hsh(id, 17)) * site.r * 0.8, a = hsh(id, 19) * 6.283;
  return [site.x + Math.cos(a) * R + (r1 - 0.5) * 12 + Math.sin(ph * 6.283 + id) * 1.5, site.y + Math.sin(a) * R + (r2 - 0.5) * 12 + Math.cos(ph * 6.283 + id) * 1.5];
}
function moveTo(S, id, tx, ty, v, size) {
  const dx = tx - S.x[id], dy = ty - S.y[id], d = Math.hypot(dx, dy);
  if (d < 1e-6) return;
  const s = Math.min(v, d);
  S.x[id] = clamp(S.x[id] + dx / d * s, 0, size); S.y[id] = clamp(S.y[id] + dy / d * s, 0, size);
  S.facing[id] = Math.atan2(dy, dx); S.state[id] = S_MOVE;
  S.fatigue[id] = clamp(S.fatigue[id] - 1e-4, 0, 1);
}

function gather(w, u, T, crew, md) {
  const job = u.job, node = job.node;
  if (!node || node.amount <= 0) { releaseWorkers(w, u); return; }
  const res = job.res || node.res;
  if (res === "mana") { // only adepts can draw on a ley line
    let adepts = 0; for (const id of u.members) if (roleOf(w, id) === ROLE.adept) adepts++;
    crew = Math.min(crew, adepts);
    const cap = hasBuilding(w, u.team, "mage_tower") ? BUILDINGS.mage_tower.manaCap : 60;
    if (T.store.mana >= cap) return;
  }
  if ((w.tick + u.id) % 40 === 0 || !u.store) u.store = nearestStoreFor(w, u.team, res, node.x, node.y);
  const store = u.store; if (!store) return;
  const d = Math.hypot(store.x - node.x, store.y - node.y);
  const rate = E.yieldPerManDay[res] || 0;
  // carts: each needs a draught animal and takes a carter from the crew
  const carts = Math.min(job.carts || 0, T.store.carts, T.store.oxen + T.store.horses, Math.floor(crew / 2));
  const hm = haulManDaysPerKg(w, u.team, d), hc = haulManDaysPerKg(w, u.team, d, 0, 1);
  const Wp = crew - carts, cartCap = carts / hc; // kg/day the carters can move
  let P = rate * Wp <= cartCap ? rate * Wp : rate * (Wp + cartCap * hm) / (1 + rate * hm); // kg/day
  const cutters = P / rate;
  u.haulShare = crew > 0 ? clamp(1 - cutters / Math.max(crew, 1e-9), 0, 0.9) : 0;
  let got = Math.min(node.amount, P * md);
  if (res === "mana" || res === "fresh") got = Math.min(got, node.amount);
  node.amount -= got; give(T, res, got);
  if (node.amount <= 0) w.events.push({ t: w.tick, kind: "node-exhausted", node: node.id, team: u.team });
}

function fieldWork(w, u, T, working, md) {
  const b = u.job.b, f = b.field; if (!f) return;
  const doy = w.econ.doy;
  if (f.state === "growing" && doy >= f.ripe - 80 && doy < f.ripe) f.care = Math.min(1, f.care + working * md / (f.ha * E.weedManDaysPerHa * 1.0) * 0.5);
  else if (f.state === "ripe" && f.left > 0) {
    const kg = Math.min(f.left, working * md / E.reapManDaysPerHa * f.yieldKgHa * (0.8 + 0.2 * f.care));
    f.left -= kg; give(T, "seed", kg * f.seedFrac); give(T, "sheaves", kg * (1 - f.seedFrac)); T.stats.harvested += kg;
    if (f.left <= 1) { f.left = 0; f.state = "stubble"; releaseWorkers(w, u); }
  } else if (f.state !== "growing" || doy < f.ripe - 80) releaseWorkers(w, u);
}

function buildWork(w, u, T, working, md) {
  const b = u.job.b, def = BUILDINGS[b.kind];
  if (b.ruin) { releaseWorkers(w, u); return; }
  let eff = working;
  let masons = 0, carps = 0; for (const id of u.members) { const r = roleOf(w, id); if (r === ROLE.mason) masons++; else if (r === ROLE.carpenter) carps++; }
  if (def.stone) eff = Math.min(working, masons * 5 + 1); // Harlech ≈ 1 mason : 3–4 others (§5.3)
  else eff = working * (0.8 + 0.2 * Math.min(1, carps * 6 / Math.max(1, working)));
  const labour = eff * md * (E.buildSpeed || 1);
  if (b.progress < 1) {
    b.progress = Math.min(1, b.progress + labour / b.labour);
    b.hp = b.hpMax * (0.05 + 0.95 * b.progress);
    T.day.buildDays += working * DT;
    if (def.wall && b.progress >= 0.5 && !b.navSaved) blockWall(w, b, true);
    if (b.progress >= 1) { w.events.push({ t: w.tick, kind: "built", building: b.id, team: b.team, what: b.kind }); releaseWorkers(w, u); }
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
  let skill = 0, k = 0;
  for (const id of u.members) { if (k++ >= staff) break; if (!atWork.has(id)) continue; skill += R.trade && ROLES[roleOf(w, id)] === R.trade ? 1 : R.unskilled; }
  if (skill <= 0) return;
  T.day.craftDays += Math.min(working, staff) * DT;
  b.work += skill * md * (b.land?.outMul || 1);
  if (b.work < r.days) return;
  const needs = { ...r.needs }; if (r.fuel) needs.charcoal = (needs.charcoal || 0) + r.fuel;
  if (!canAfford(T, needs)) { b.blocked = Object.keys(needs).find((x) => (T.store[x] || 0) < needs[x]); b.work = r.days; return; }
  b.blocked = null; b.work -= r.days;
  for (const [x, n] of Object.entries(needs)) take(T, x, n);
  give(T, b.make, r.batch || 1);
}

function practice(w, u, T, md, atWork) {
  // men shooting at the butts every day slowly become warbow archers (years, compressed)
  for (const id of u.members) {
    const r = roleOf(w, id); if (!atWork.has(id) || (r !== ROLE.man && r !== ROLE.spear)) continue;
    const p = (w.econ.practice.get(id) || 0) + md / E.workdayFrac;
    if (p >= SLOW_TRAINING.archer) { w.econ.role.set(id, ROLE.archer); w.econ.practice.delete(id); w.events.push({ t: w.tick, kind: "trained-archer", team: u.team }); }
    else w.econ.practice.set(id, p);
  }
}

// Labourers at home: thresh the sheaves, else tend gardens, cows and hens.
function homeWork(w, u, T, working, md) {
  const doy = w.econ.doy;
  if (T.store.sheaves > 0) { const kg = Math.min(T.store.sheaves, working * md * E.threshPerManDay); T.store.sheaves -= kg; give(T, "grain", kg); if (T.store.sheaves < 1e-9) T.store.sheaves = 0; }
  else {
    const g = E.garden[0] + (E.garden[1] - E.garden[0]) * clamp((doy - 121) / 70, 0, 1) * (doy > 280 ? 0.3 : 1);
    give(T, "fresh", working * md * g);
  }
  // sheep-shearing in June
  if (doy >= E.shearDoy[0] && doy < E.shearDoy[1] && T.sheep > 0) {
    const need = T.sheep / 100 * E.shearManDaysPer100, done = Math.min(need - (T.shorn || 0), working * md);
    if (done > 0) { T.shorn = (T.shorn || 0) + done; give(T, "wool", done / E.shearManDaysPer100 * 100 * E.woolPerSheep); }
  }
}

// ────────────────────────────────────────────────────────────── buildings per tick
function buildingTick(w, b) {
  const T = w.teams[b.team], def = BUILDINGS[b.kind];
  // fire runs on the battle clock
  if (b.fire > 0) {
    b.hp -= b.hpMax / E.fireSecs * BT * b.fire;
    if (b.fire < 1) b.fire = Math.min(1, b.fire + 0.0005 * BT);
    if (b.field) { const burn = b.field.left * 0.0006 * BT * b.fire; b.field.left -= burn; b.field.burnt += burn; if (b.field.left < 1) { b.field.left = 0; b.field.state = "burnt"; b.fire = 0; } b.hp = 1; }
    if (w.tick % 10 === 0) for (const o of w.buildings) {
      if (o === b || o.ruin || o.fire > 0 || !BUILDINGS[o.kind].flammable || o.field) continue;
      if (Math.hypot(o.x - b.x, o.y - b.y) < 16 && w.rng.chance(0.004 * BUILDINGS[o.kind].flammable * b.fire * (o.land?.fireMul || 1))) o.fire = 0.2;
    }
    if (b.hp <= 0) { ruinBuilding(w, b); return; }
  }
  b.stage = stageOf(b);
  if (b.field) return fieldTick(w, b);
  if (!complete(b)) return;
  // recruitment queue (econ clock)
  const q = b.queue[0];
  if (q) {
    q.t += DT;
    if (q.t >= q.days) {
      b.queue.shift();
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
      const u = addUnit(w, { team: b.team, arm: q.arm, count: q.count, x: b.rally.x, y: b.rally.y, formation: ARMS[q.arm].mounted ? "line" : "line", training: q.training });
      u.supply = { food: 0, arrows: 0, carts: 0, packhorses: 0 }; u.levy = q.arm === "levy"; u.musterDay = w.econ.doy;
      w.events.push({ t: w.tick, kind: "recruited", unit: u.id, building: b.id, team: b.team, arm: q.arm, count: q.count });
    }
  }
  // the tiltyard: a rider becomes a squire fit to be knighted in SLOW_TRAINING.knight days (years, compressed)
  if (b.tilt) { b.tilt.t += DT; if (b.tilt.t >= SLOW_TRAINING.knight) { b.tilt = null; T.census.inTraining--; T.squires++; w.events.push({ t: w.tick, kind: "squire-ready", team: b.team }); } }
}

function fieldTick(w, b) {
  const f = b.field, doy = w.econ.doy;
  if (f.state === "growing" && doy >= f.ripe) f.state = "ripe";
  if (f.state === "ripe" && doy > f.ripe + 21) f.left *= 1 - 0.015 * DT; // over-ripe grain sheds (EST 1.5 %/day)
  b.stage = f.state === "burnt" ? "ruin" : b.fire > 0 ? "burning" : f.state === "growing" ? (doy < f.ripe - 40 ? "build1" : "build2") : f.state === "ripe" ? "complete" : f.state;
}

const LOOT = { house: 60, market: 480, granary: 240, blacksmith: 240, weaver: 180, fletcher: 180, stables: 240, mill: 240 };

// Enemies loitering at a flammable building or a dry field set it alight.
function arson(w) {
  const nb = [];
  for (const b of w.buildings) {
    if (b.ruin || b.fire > 0) continue;
    const def = BUILDINGS[b.kind];
    if (b.field) {
      const f = b.field; if (!(f.state === "ripe" || (f.state === "growing" && w.econ.doy > f.ripe - 20))) continue;
      for (const v of w.units.values()) if (v.team !== b.team && !v.isWorkers && v.state !== "routing" && Math.abs(v.ax - b.x) < b.w / 2 && Math.abs(v.ay - b.y) < b.h / 2) { if (w.rng.chance(0.05)) { b.fire = 0.3; w.events.push({ t: w.tick, kind: "field-fired", building: b.id, team: b.team }); } break; }
      continue;
    }
    if (!def.flammable) continue;
    neighbours(w, b.x, b.y, (def.footprint?.[0] || 10) * 0.6 + 5, nb);
    let foes = 0, foeTeam = -1; for (const o of nb) if (w.S.team[o] !== b.team && w.S.alive[o] && w.S.state[o] !== S_FLEE && w.S.arm[o] !== ARMS.villager.id) { foes++; foeTeam = w.S.team[o]; }
    if (foes >= 2 && w.rng.chance(0.01 * def.flammable * Math.min(foes, 10))) {
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
  const grass = hasBuilding(w, team, "paddock") && w.econ.doy > 120 && w.econ.doy < 280 ? 0.5 : 1;
  return T.dependants * R.dependant + (T.squires + h.soldiersHome) * R.soldier + h.labour * R.labourer + (T.store.destriers + h.knights) * E.horse.grainDestrier * grass + T.census.inTraining * R.soldier;
}

function consume(w, T) {
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
  const gran = w.buildings.filter((b) => b.team === T.id && complete(b) && b.kind === "granary").length * BUILDINGS.granary.capacity.grain;
  const inGran = Math.min(T.store.grain, gran), open = Math.min(T.store.grain - inGran, cap - gran), over = Math.max(0, T.store.grain - inGran - open);
  take(T, "grain", inGran * E.spoil.grainGranary + open * E.spoil.grainOpen + over * E.spoil.overflow);
  take(T, "sheaves", T.store.sheaves * E.spoil.sheaves); take(T, "fresh", T.store.fresh * E.spoil.fresh); take(T, "hay", T.store.hay * E.spoil.hay);
  // money: rents in, wages out
  const rents = T.besieged ? 0 : pop * E.rentsPerPersonDay;
  give(T, "silver", rents); T.day.income = rents;
  let bill = T.day.buildDays * 1.5 + T.day.craftDays * 3;
  for (const u of w.units.values()) if (u.team === T.id && !u.isWorkers) {
    const away = Math.hypot(u.ax - T.town.x, u.ay - T.town.y) > E.homeRadius;
    // (away, the days paid are the unit's field days — logistics.js fieldDays: a march is paid by the hour
    // it takes, a camp or a siege by the day)
    const days = away ? Math.min(1, u.payDays ?? 1) : 1; u.payDays = 0;
    bill += u.members.length * days * (u.arm === "levy" ? (away ? RECRUITS.levy.payAway : 0) : (PAY[u.arm] || 0) * (away ? 1 : E.homePayFrac));
  }
  const today = bill; // (one day's wage bill: arrears are counted in days of THIS, not of what little was paid)
  bill += T.arrears; T.arrears = 0;
  const paidS = take(T, "silver", bill); let owed = bill - paidS;
  if (owed > 0) { const g = take(T, "gold", owed / 12); owed -= g * 12; }
  T.arrears = owed; T.day.wages = bill - owed; T.day.buildDays = 0; T.day.craftDays = 0;
  T.arrearsDays = T.arrears / Math.max(1, today);
  // hunger & unrest
  const hungry = 1 - T.ration;
  const fuel = T.store.firewood <= 0 ? 0.1 : 0;
  const target = clamp(hungry * 0.9 + clamp(T.arrearsDays / 10, 0, 0.3) + (T.besieged ? 0.15 : 0) + fuel + (T.recentLosses || 0) * 0.002, 0, 1);
  T.unrest += (target - T.unrest) * 0.15;
  T.recentLosses = (T.recentLosses || 0) * 0.8;
  // starvation physiology (§9): deficit accumulates; deaths begin after ~3 weeks of half rations
  T.starveAcc = Math.max(0, T.starveAcc + (hungry > 0.2 ? hungry * 1.5 : -0.5));
  if (hungry > 0.2) T.stats.starvedDays++;
  const starveRate = clamp((T.starveAcc - 20) / 35, 0, 1) / 15; // share of the population dying per day (zero food → all dead in ~6–10 weeks)
  T.acc.starve += pop * starveRate;
  while (T.acc.starve >= 1) { T.acc.starve--; if (!killForHunger(w, T)) break; }
  // births and natural deaths (crude rates)
  T.acc.birth += pop * E.birthsPerYear / 365 * (0.5 + 0.5 * T.ration);
  while (T.acc.birth >= 1) { T.acc.birth--; T.dependants++; T.census.births++; }
  T.acc.death += pop * E.deathsPerYear / 365;
  while (T.acc.death >= 1 && T.dependants > 0) { T.acc.death--; T.dependants--; T.census.died++; }
  migration(w, T, h, pop);
  // horse breeding: mares on a paddock foal in spring — stock for years hence (a destrier takes
  // 3–5 years to breed and school, §6), so foals never reach the field inside one match
  if (hasBuilding(w, T.id, "paddock") && ec.doy > 100 && ec.doy < 170) T.foals = (T.foals || 0) + Math.min(T.store.horses, 20) * 0.4 / 70;
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
  const homes = built.reduce((s, b) => s + (BUILDINGS[b.kind].pop || 0), 0);
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
    T.acc.imm += E.immigrationPerDay * clamp(slack / 10, 0.3, 1);
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
export function canRecruit(w, team, arm) {
  const R = RECRUITS[arm], T = w.teams[team]; if (!R) return 0;
  let men = 0;
  if (R.from[0] === "squire") men = T.squires;
  else for (const u of workerUnits(w, team)) for (const id of u.members) if (w.S.alive[id] && R.from.includes(ROLES[roleOf(w, id)])) men++;
  let gear = Infinity; for (const [g, n] of Object.entries(R.gear)) gear = Math.min(gear, Math.floor((T.store[g] || 0) / n));
  if (R.perUnit) return Math.min(Math.floor(men / R.crew), gear); // engines: how many can be crewed and fitted out
  return Math.min(men, gear);
}

export function queueRecruit(w, b, arm, count, { rushed = false } = {}) {
  const R = RECRUITS[arm], T = w.teams[b.team], def = BUILDINGS[b.kind];
  if (!R || !complete(b) || !(def.recruits || []).includes(arm)) return 0;
  count = Math.min(count, canRecruit(w, b.team, arm)); if (count <= 0) return 0;
  const engines = R.perUnit ? count : 0; if (engines) count = engines * R.crew; // (an engine's gear is per engine, its crew per man)
  for (const [g, n] of Object.entries(R.gear)) take(T, g, n * (engines || count));
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
  b.queue.push({ arm, count, t: 0, days: rushed && R.rushedDays ? R.rushedDays : R.days, training: (rushed && R.rushedTraining ? R.rushedTraining : R.training) + 0.05 * armour });
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
export function disband(w, u) {
  if (!u || u.isWorkers || u.retinue || !DISBAND_ROLE[u.arm]) return 0;
  const T = w.teams[u.team], R = RECRUITS[u.arm], S = w.S;
  const ids = u.members.filter((id) => S.alive[id] && S.state[id] !== S_FIGHT && S.state[id] !== S_FLEE);
  if (!ids.length) return 0;
  let cx = 0, cy = 0; for (const id of ids) { cx += S.x[id]; cy += S.y[id]; }
  for (const id of ids) retire(w, id);
  for (const [g, n] of Object.entries(R.gear)) give(T, g, n * ids.length * (g === "arrows" || g === "bolts" ? 0.5 : 1));
  const nu = addUnit(w, { team: u.team, arm: "villager", count: ids.length, x: cx / ids.length, y: cy / ids.length, formation: "loose", training: 0.1 });
  for (const id of nu.members) w.econ.role.set(id, ROLE[DISBAND_ROLE[u.arm]]);
  resetJob(nu, { kind: "home" }); const home = homeUnit(w, u.team); if (home && home !== nu) mergeUnits(w, [home, nu]); else T.homeUnit = nu.id;
  w.events.push({ t: w.tick, kind: "disbanded", team: u.team, arm: u.arm, n: ids.length });
  return ids.length;
}

export function setProduct(w, b, product) { if (RECIPES[b.kind]?.[product]) { if (b.make !== product) b.work = 0; b.make = product; return true; } return false; }

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
export function castSpell(w, team, kind, x, y) {
  const Sp = SPELLS[kind], T = w.teams[team], S = w.S; if (!Sp || T.store.mana < Sp.mana) return false;
  let adept = false; for (const u of workerUnits(w, team)) if (u.members.some((id) => roleOf(w, id) === ROLE.adept)) { adept = true; break; }
  if (!adept) return false;
  take(T, "mana", Sp.mana);
  if (kind === "mist") { w.mist = { visibility: 0.4, until: w.tick + Sp.days / DT }; }
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
  const accounted = T.dependants + T.squires + c.inTraining + alive + casualties + c.deserted + c.emigrated + c.starved + c.died;
  return { inflow, accounted, alive, casualties, ok: inflow === accounted };
}
