// PULLING DOWN AND REBUILDING IN STONE (the owner: "you should be able to destroy your own buildings and walls to replace
// them. Actually for walls you can just replace wooden ones with stone ones."). Deterministic, plain data on the world.
//
// DEMOLISH. "Pull it down" (commands.js demolish) marks the building b.razing = { done 0..1, labour (man-days), refund
// {res: kg}, paid (stages paid), by }. Men come and take it down: the job is the building's own build job ({kind: "build",
// b} — economy.buildWork hands a razing building here), so the reeve keeps it staffed (ai-general.js allocateLabour) the way
// it keeps a site staffed. It comes down in three visible STAGES (render/buildings.js: intact with the men at it → the frame
// → the footings → gone; a wall stretch module by module from one end, its nav cells opening as each module goes); each
// stage sends a third of what is saved back to the store. A razing building no longer works (economy.complete is false):
// its crafts, storemen and crew go back to the reeve, its trainees go on at another of its kind or home with their gear.
// When the last stage is done the building is GONE: its footprint is lifted from the obstacles and the nav (obstacles.js
// rects, path.js costs), a wall's or gate's nav closures are opened, every plot of the plan it held is free again, and it
// leaves w.buildings. The keep may not be pulled down while it is the house's only one (nor the seat at all, nor a living
// daughter town's hall). A ruin is cleared the same way, cheaply, for a little salvaged stone; the reeve clears old ruins of
// his own accord when hands are spare.
//
// REBUILD IN STONE. A palisade stretch (or a palisade gate) is rebuilt as a stone curtain (a stone gatehouse) IN ITS PLACE:
// the stone goes up as an ordinary building site (b2.replaces = the old one's id; old.upBy = b2's) while the palisade still
// stands and still keeps the town; the stone is drawn rising module by module and the timber gives way as it does. When the
// stone is complete the old palisade is taken away (its plan plot passes to the stone, a share of its timber is salvaged).
// "The whole circuit in stone" queues every palisade of the town (T.wallUp), nearest first along the circuit; the builders
// take two stretches at a time as the stone in store allows.
import * as EC from "./economy.js";
import { BUILDINGS, RECRUITS, ROLE } from "./econ-data.js";
import { addUnit, mergeUnits } from "./world.js";
import { navSetBlock } from "./navblock.js";
import { unlocked, STAGES as TOWN_STAGES, stageOfKind } from "./stages.js";
import * as TW from "./towns.js";
import * as LB from "./labor.js";

export const UPGRADE = { palisade: "stone_wall", gate: "gatehouse" };
export const STAGES = 3;               // a building comes down in three visible stages
const RAZE = 0.3, RUIN = 0.15;         // the labour to pull it down, a share of what it took to build (a ruin: less)
const REFUND = 0.5, SALVAGE = 0.25;    // what comes back: half the materials of a standing building; a ruin, a quarter of its stone
const OLD_SALVAGE = 0.3;               // a palisade replaced by stone: its sound posts go back to the store
const UP_AT_ONCE = 2;                  // stretches of a circuit rebuilt at the same time
const RUIN_DAYS = 20;                  // the reeve clears a ruin of his own accord once it has lain this many days

const bld = (w, id) => w.buildings.find((b) => b.id === id) || null;
const isCastle = (w, b) => b.castle !== undefined || !!w.castleBids?.has?.(b.id);
const lenOf = (b) => (b.x1 !== undefined ? Math.hypot(b.x2 - b.x1, b.y2 - b.y1) : 1);
const costOf = (b) => EC.scaleCost(BUILDINGS[b.kind], BUILDINGS[b.kind]?.perMetre ? b.length || lenOf(b) : 1);
const scale = (c, f) => { const o = {}; for (const [r, n] of Object.entries(c || {})) if (r !== "silver" && r !== "gold" && n * f > 1e-6) o[r] = n * f; return o; };
export const crewFor = (b) => { const def = BUILDINGS[b.kind] || {}; return b.ruin ? 6 : def.wall ? 16 : def.stone ? 20 : Math.max(4, Math.min(16, Math.round((b.labour || 100) * RAZE / 10))); };
export const preferFor = (b) => (BUILDINGS[b.kind]?.stone ? ["mason", "man"] : ["carpenter", "man", "woman"]);
export const razings = (w, team) => w.buildings.filter((b) => b.team === team && b.razing);

// ──────────────────────────────────────────────────────────── may it come down?
export function canDemolish(w, team, b) {
  if (!b) return { ok: false, error: "No such building" };
  if (b.team !== team) return { ok: false, error: "Not your building" };
  if (b.field) return { ok: false, error: "A field is not pulled down: let it lie fallow" };
  if (isCastle(w, b)) return { ok: false, error: "A castle's works are not pulled down" };
  if (b.razing) return { ok: false, error: "It is being pulled down already" };
  if (b.upBy !== undefined && bld(w, b.upBy)) return { ok: false, error: "It is being rebuilt in stone: it comes down when the stone stands" };
  if (b.kind === "town_hall") {
    const T = w.teams[team];
    if (b.id === T?.hall && !b.ruin) return { ok: false, error: "The seat of your house cannot be pulled down" };
    if (b.ruin && b.id === T?.hall) return { ok: false, error: "The ruin of your seat stays" };
    if (!b.ruin) {
      const halls = w.buildings.filter((o) => o.team === team && o.kind === "town_hall" && !o.ruin && !o.razing);
      if (halls.length <= 1) return { ok: false, error: "Your only keep cannot be pulled down" };
      if ((T?.towns || []).some((D) => !D.lost && D.s?.hall === b.id)) return { ok: false, error: "That town's hall: the town would be lost with it" };
    }
  }
  return { ok: true, ...razePlan(w, b) };
}
// how long and what comes back: { labour (man-days), refund {res: kg}, now {res: kg} (given back at once: an unfinished site's
// materials not yet built in) }
export function razePlan(w, b) {
  const L = Math.max(0, b.labour || (BUILDINGS[b.kind]?.labour || 100) * (BUILDINGS[b.kind]?.perMetre ? lenOf(b) : 1));
  if (b.ruin) return { labour: Math.max(1, L * RUIN), refund: { ...(costOf(b).stone ? { stone: costOf(b).stone * SALVAGE } : {}) }, now: {} };
  const p = Math.max(0, Math.min(1, b.progress ?? 1));
  if (p >= 1) return { labour: Math.max(1, L * RAZE), refund: scale(costOf(b), REFUND), now: {} };
  // a site not finished: what lies there and at the store for it comes back whole, what is built in half
  const now = {}, refund = {};
  if (b.need) {
    for (const [r, n] of Object.entries(b.stock || {})) if (n > 1e-6) now[r] = (now[r] || 0) + n;
    for (const it of w.labor?.items || []) if (it.due === b.id && it.kg > 0) now[it.res] = (now[it.res] || 0) + it.kg;
    for (const [r, n] of Object.entries(b.used || {})) if (n * REFUND > 1e-6) refund[r] = n * REFUND;
  } else { Object.assign(now, scale(costOf(b), 1 - p)); Object.assign(refund, scale(costOf(b), p * REFUND)); }
  return { labour: Math.max(0.5, L * RAZE * p), refund, now };
}

// ──────────────────────────────────────────────────────────── the order
// by: "player" (the command; men are sent at once) | "reeve" | "lord" (the AI: the reeve's allocation staffs it)
export function orderDemolish(w, team, b, { by = "player" } = {}) {
  const chk = canDemolish(w, team, b); if (!chk.ok) return chk;
  const T = w.teams[team];
  // a stone site that was to replace a palisade: the palisade stays as it is
  if (b.replaces !== undefined) { const old = bld(w, b.replaces); if (old && old.upBy === b.id) delete old.upBy; delete b.replaces; }
  if (T.wallUp) T.wallUp.q = T.wallUp.q.filter((id) => id !== b.id);
  // an unfinished site: its materials (on site, and set aside at the store) go back now; nothing more is carried to it
  for (const [r, n] of Object.entries(chk.now)) EC.give(T, r, n);
  if (b.need) {
    for (const it of [...(w.labor?.items || [])]) if (it.due === b.id || (it.show && it.key?.startsWith(`bs:${b.id}:`))) LB.removeItem(w, it);
    delete b.need; delete b.stock; delete b.used; delete b.yard; delete b.join; delete b.sawn; delete b.ground;
  }
  emptyIt(w, b, T);
  b.razing = { done: 0, labour: chk.labour, refund: chk.refund, paid: 0, by, day: Math.floor(w.econ?.doy ?? 0), ruin: !!b.ruin };
  b.crew = null;
  const crew = EC.assignWorkers(w, team, { kind: "build", b }, by === "player" ? crewFor(b) : Math.min(6, crewFor(b)), preferFor(b)); // (the reeve keeps it staffed after: ai-general.js allocateLabour)
  return { ok: true, n: crew?.members?.length || 0, labour: chk.labour, refund: chk.refund, back: chk.now };
}
// cancel a pull-down before a hand has been laid on it (once the men are at it, it comes down)
export function cancelDemolish(w, team, b) {
  if (!b?.razing || b.team !== team) return { ok: false, error: "Not being pulled down" };
  if (b.razing.done > 0 || b.razing.paid > 0) return { ok: false, error: "The men are at it: it is coming down" };
  delete b.razing;
  for (const u of EC.workerUnits(w, team)) if (u.job?.b === b && u.job.kind === "build" && b.progress >= 1 && b.hp >= b.hpMax) EC.releaseWorkers(w, u);
  return { ok: true };
}

// the people and things inside: the crews go back to the reeve, the trainees on at another of its kind (else home, their
// gear to the store), the stables' young beasts to another stables (else let go)
function emptyIt(w, b, T) {
  for (const u of EC.workerUnits(w, b.team)) if (u.job?.b === b && u.job.kind !== "build") EC.releaseWorkers(w, u);
  const other = w.buildings.find((o) => o !== b && o.team === b.team && o.kind === b.kind && o.town === b.town && EC.complete(o));
  if (b.queue?.length) {
    if (other) other.queue.push(...b.queue);
    else for (const q of b.queue) sendHome(w, b, T, q);
    b.queue = [];
  }
  if (b.tilt) { if (other && !other.tilt) other.tilt = b.tilt; else { T.census.inTraining--; homeVillagers(w, b, T, 1, "rider"); } b.tilt = null; }
  if (b.kind === "stables") {
    const pens = b.pens || {}; if (b.train) pens[b.train.kind] = (pens[b.train.kind] || 0) + 1;
    if (other) { other.pens ||= {}; for (const [k, n] of Object.entries(pens)) if (n > 0) other.pens[k] = (other.pens[k] || 0) + n; }
    b.pens = null; b.train = null;
  }
}
function sendHome(w, b, T, q) {
  const R = RECRUITS[q.arm];
  if (q.retrain !== undefined) { if (q.mount) (T.mounts ||= {})[q.mount] = (T.mounts[q.mount] || 0) + q.count; else EC.give(T, q.arm === "knights" ? "destriers" : "horses", q.count); return; } // (the new mounts back to the stock)
  if (!R) return;
  const engines = q.engines || 0;
  for (const [g, n] of Object.entries(R.gear)) { if (q.mount && (g === "horses" || g === "destriers")) { (T.mounts ||= {})[q.mount] = (T.mounts[q.mount] || 0) + n * q.count; continue; } EC.give(T, g, n * (engines || q.count)); }
  if (q.plates) EC.give(T, "plates", q.plates);
  T.census.inTraining -= q.count;
  if (R.from[0] === "squire") { T.squires += q.count; return; }
  homeVillagers(w, b, T, q.count, R.from[0]);
}
function homeVillagers(w, b, T, n, role) {
  if (n <= 0) return;
  const nu = addUnit(w, { team: b.team, arm: "villager", count: n, x: b.rally?.x ?? b.x, y: b.rally?.y ?? b.y, formation: "loose", training: 0.1 });
  for (const id of nu.members) w.econ.role.set(id, ROLE[role] ?? ROLE.man);
  nu.job = { kind: "home" }; nu.isWorkers = true; nu.haul = new Map(); nu.danger = 0; nu.path = null; nu.order = { kind: "hold" };
  if (b.town) nu.town = b.town;
  const home = EC.homeUnit(w, b.team); if (home && home !== nu) mergeUnits(w, [home, nu]); else T.homeUnit = nu.id;
}

// ──────────────────────────────────────────────────────────── the work (economy.buildWork → here while b.razing)
export function razeWork(w, u, T, working, md) {
  const b = u.job.b, R = b.razing;
  if (!R || !w.buildings.includes(b)) { EC.releaseWorkers(w, u); return; }
  if (b.ruin && !R.ruin) { R.ruin = true; R.refund = razePlan(w, b).refund; } // (it burnt while they were at it: only the stone is saved now)
  if (working <= 0) return;
  R.done = Math.min(1, R.done + working * md * (EC.E.buildSpeed || 1) / Math.max(0.1, R.labour));
  T.day.buildDays += working * EC.DT;
  const stage = R.done >= 1 ? STAGES : Math.floor(R.done * STAGES);
  while (R.paid < stage) { R.paid++; for (const [r, n] of Object.entries(R.refund)) EC.give(T, r, n / STAGES); }
  if (b.x1 !== undefined) razeModules(w, b);
  if (R.done >= 1) {
    w.events.push({ t: w.tick, kind: "demolished", building: b.id, team: b.team, what: b.kind, ruin: !!b.ruin, x: b.x, y: b.y });
    removeBuilding(w, b);
  }
}
// a wall stretch comes down module by module from its first end: each module gone opens its cells (economy.blockWall
// closes only the modules still standing; the walk on it goes too — townwall.js)
function razeModules(w, b) {
  const n = EC.wallModules(b), down = Math.min(n, Math.floor(b.razing.done * n + 1e-9));
  if (!b.mods || b.mods.length !== n) { const m = new Float32Array(n).fill(b.ruin ? 0 : Math.max(1, b.hp) / n); if (b.mods) for (let k = 0; k < Math.min(n, b.mods.length); k++) m[k] = b.mods[k]; b.mods = m; }
  let ch = false; for (let k = 0; k < down; k++) if (b.mods[k] > 0) { b.mods[k] = 0; ch = true; }
  if (ch) { if (b.navSaved) EC.blockWall(w, b, true); w.featuresVer = (w.featuresVer || 0) + 1; b.breachVer = (b.breachVer || 0) + 1; }
}

// ──────────────────────────────────────────────────────────── gone
// take building b off the world: nav closures, its solid box, its plots, its crews. keepPlots: they pass to its successor.
export function removeBuilding(w, b, { keepPlots = false } = {}) {
  const def = BUILDINGS[b.kind] || {};
  if (def.wall) EC.blockWall(w, b, false);
  if (b.kind === "gate" || b.kind === "gatehouse") { navSetBlock(w, "gf" + b.id, null); navSetBlock(w, "gp" + b.id, null); b.navKey = false; }
  liftFootprint(w, b);
  if (!keepPlots) freePlots(w, b);
  for (const u of EC.workerUnits(w, b.team)) if (u.job?.b === b) { u.ordered = false; EC.releaseWorkers(w, u); }
  for (const u of w.units.values()) { if (u.helping === b.id) u.helping = null; if (u.burning === b.id) u.burning = null; }
  for (const it of [...(w.labor?.items || [])]) if (it.due === b.id || (it.show && it.key && (it.key.startsWith(`bs:${b.id}:`) || it.key.startsWith(`stk:${b.id}:`) || it.key.startsWith(`in:${b.id}:`)))) {
    if (it.due === b.id && it.kg > 0) EC.give(w.teams[b.team], it.res, it.kg); // (set aside for it at the store: back in)
    LB.removeItem(w, it);
  }
  const T = w.teams[b.team]; if (T?.wallUp) T.wallUp.q = T.wallUp.q.filter((id) => id !== b.id);
  const k = w.buildings.indexOf(b); if (k >= 0) w.buildings.splice(k, 1);
  b.gone = true;
  w.featuresVer = (w.featuresVer || 0) + 1;
}
// every plot of the plan the building held is free again (a plot recorded only for it, "site", goes); the wall sweep is
// re-run (the plots a wall's band took come back unless another wall still crosses them)
function freePlots(w, b) {
  const plan = w.plans?.[b.team]; if (!plan?.slots) return;
  plan.slots = plan.slots.filter((q) => !(q.taken === b.id && (q.type === "site" || q.sited)));
  for (const q of plan.slots) if (q.taken === b.id) { q.taken = null; delete q.takenKind; }
  if (BUILDINGS[b.kind]?.wall) plan.wallSwept = -1;
}
// its solid box (commands.js solidBuildings → obstacles.js addRect, tagged rec.bid; a box laid before the tag existed is
// found by its place and angle) comes out of the obstacle buckets, and the nav cells it made dear are the land's again
const CELL = 8, key = (i, j) => i * 100000 + j;
export function footprintOf(w, b) {
  const O = w.obstacles; if (!O?.rects || !w.solidB?.has?.(b.id)) return null;
  const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
  const i0 = Math.floor((b.x - 60) / CELL), i1 = Math.floor((b.x + 60) / CELL), j0 = Math.floor((b.y - 60) / CELL), j1 = Math.floor((b.y + 60) / CELL);
  let legacy = null, ld = 8;
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const r of O.rects.get(key(i, j)) || []) {
    if (r.bid === b.id) return r;
    if (r.bid === undefined && Math.abs(r.c - c) < 1e-6 && Math.abs(r.s - s) < 1e-6) { const d = Math.hypot(r.x - b.x, r.y - b.y); if (d < ld || (d === ld && legacy && r.x < legacy.x)) { ld = d; legacy = r; } }
  }
  return legacy;
}
export function liftFootprint(w, b) {
  const O = w.obstacles; if (!O?.rects || !w.solidB?.has?.(b.id)) return 0;
  const rec = footprintOf(w, b); if (!rec) { w.solidB.delete(b.id); return 0; }
  const same = (r) => r === rec || (r.x === rec.x && r.y === rec.y && r.hx === rec.hx && r.hy === rec.hy && r.c === rec.c && r.s === rec.s);
  const R = Math.hypot(rec.hx, rec.hy);
  for (let i = Math.floor((rec.x - R) / CELL) - 1; i <= Math.floor((rec.x + R) / CELL) + 1; i++) for (let j = Math.floor((rec.y - R) / CELL) - 1; j <= Math.floor((rec.y + R) / CELL) + 1; j++) {
    const k = key(i, j), bk = O.rects.get(k); if (!bk) continue;
    const kept = bk.filter((r) => !same(r)); if (kept.length === bk.length) continue;
    if (kept.length) O.rects.set(k, kept); else O.rects.delete(k);
  }
  O.count = Math.max(0, (O.count || 1) - 1);
  if (O.fresh?.length) O.fresh = O.fresh.filter((r) => !same(r));
  w.solidB.delete(b.id);
  unmarkNav(w, rec);
  return 1;
}
// path.js markObstaclesOnNav raised the cells under a footprint to 12; those no other box still covers go back to the land's
// own cost (nav.base) — a cell a wall holds shut (navblock.js) has its saved cost put right instead
function unmarkNav(w, rec) {
  const nav = w.nav; if (!nav?.base) return;
  const { n, cellM, ox, oy } = nav, O = w.obstacles, R = Math.hypot(rec.hx, rec.hy), held = w.navBlk?.saved;
  const covered = (x, y) => {
    for (let i = Math.floor((x - 40) / CELL); i <= Math.floor((x + 40) / CELL); i++) for (let j = Math.floor((y - 40) / CELL); j <= Math.floor((y + 40) / CELL); j++) for (const r of O.rects.get(key(i, j)) || []) {
      const dx = x - r.x, dy = y - r.y, lx = dx * r.c + dy * r.s, ly = -dx * r.s + dy * r.c;
      if (Math.abs(lx) <= r.hx + cellM * 0.35 && Math.abs(ly) <= r.hy + cellM * 0.35) return true;
    }
    return false;
  };
  for (let j = Math.floor((rec.y - R - oy) / cellM); j <= Math.ceil((rec.y + R - oy) / cellM); j++) for (let i = Math.floor((rec.x - R - ox) / cellM); i <= Math.ceil((rec.x + R - ox) / cellM); i++) {
    if (i < 0 || j < 0 || i >= n || j >= n) continue;
    const x = ox + i * cellM, y = oy + j * cellM, dx = x - rec.x, dy = y - rec.y, lx = dx * rec.c + dy * rec.s, ly = -dx * rec.s + dy * rec.c;
    if (Math.abs(lx) > rec.hx + cellM * 0.35 || Math.abs(ly) > rec.hy + cellM * 0.35) continue;
    if (covered(x, y)) continue;
    const k = j * n + i, sv = held?.get(k);
    for (const cls of Object.keys(nav.classes)) {
      const C = nav.classes[cls], B = nav.base[cls]; if (!B) continue;
      if (sv && cls in sv) { if (sv[cls] === 12 && B[k] < 12) sv[cls] = B[k]; continue; }
      if (C[k] === 12 && B[k] < 12) C[k] = B[k];
    }
  }
}

// ──────────────────────────────────────────────────────────── rebuild in stone
export function canUpgrade(w, team, old) {
  if (!old) return { ok: false, error: "No such building" };
  if (old.team !== team) return { ok: false, error: "Not your building" };
  const kind = UPGRADE[old.kind]; if (!kind) return { ok: false, error: "Only a palisade or its gate is rebuilt in stone" };
  if (isCastle(w, old)) return { ok: false, error: "A castle's works are not rebuilt here" };
  if (old.razing) return { ok: false, error: "It is being pulled down" };
  if (old.upBy !== undefined && bld(w, old.upBy)) return { ok: false, error: "It is being rebuilt in stone already" };
  if (!old.ruin && (old.progress ?? 1) < 1) return { ok: false, error: "Finish it first" };
  if (kind === "gatehouse" && old.gx1 === undefined) return { ok: false, error: "That gate stands on no stretch of wall" };
  if (!unlocked(w, team, kind)) return { ok: false, error: `${BUILDINGS[kind].name} needs the ${TOWN_STAGES[stageOfKind(kind)].name} stage` };
  const cost = EC.costOf(kind, BUILDINGS[kind].perMetre ? lenOf(old) : 1);
  return { ok: true, kind, cost, afford: EC.canAfford(w.teams[team], cost) };
}
// the stone goes up in the palisade's place while the palisade stands; → { ok, b (the stone site) } | { ok: false, error }
export function orderUpgrade(w, team, old, { by = "player" } = {}) {
  const chk = canUpgrade(w, team, old); if (!chk.ok) return chk;
  if (!chk.afford) return { ok: false, error: `Not enough ${Object.keys(chk.cost).filter((r) => (w.teams[team].store[r] || 0) < chk.cost[r]).join(", ")} for that ${old.x1 !== undefined ? "stretch" : "gate"}`, poor: true };
  let b2 = null;
  if (old.x1 !== undefined) b2 = EC.placeWall(w, team, chk.kind, old.x1, old.y1, old.x2, old.y2, false);
  else { b2 = EC.placeBuilding(w, team, chk.kind, old.x, old.y, old.rot || 0, false); if (b2) Object.assign(b2, { gx1: old.gx1, gy1: old.gy1, gx2: old.gx2, gy2: old.gy2 }); }
  if (!b2) return { ok: false, error: "Not enough materials" };
  b2.replaces = old.id; old.upBy = b2.id;
  if (old.town && b2.town === undefined) b2.town = old.town;
  let n = 0;
  if (by === "player") { const crew = EC.assignWorkers(w, team, { kind: "build", b: b2 }, 20, ["mason", "man"]); n = crew?.members?.length || 0; }
  return { ok: true, b: b2, n };
}
// the standing palisade stretch (gate) a stone wall (gatehouse) placed at (x, y) would replace — commands.js place
const segD = (px, py, b) => { const dx = b.x2 - b.x1, dy = b.y2 - b.y1, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - b.x1) * dx + (py - b.y1) * dy) / l2)); return Math.hypot(px - b.x1 - dx * t, py - b.y1 - dy * t); };
export function upgradeAt(w, team, kind, x, y) {
  const from = kind === "stone_wall" ? "palisade" : kind === "gatehouse" ? "gate" : null; if (!from) return null;
  let best = null, bd = from === "gate" ? 12 : 8;
  for (const b of w.buildings) {
    if (b.team !== team || b.kind !== from || b.razing || isCastle(w, b) || (b.upBy !== undefined && bld(w, b.upBy))) continue;
    const d = b.x1 !== undefined ? segD(x, y, b) : Math.hypot(b.x - x, b.y - y);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}
// economy.buildingTick: the stone stands — the palisade it replaces is taken away and the stone takes its plot
export function replaced(w, b2) {
  const old = bld(w, b2.replaces); delete b2.replaces;
  if (!old || old.upBy !== b2.id) return;
  delete old.upBy;
  const plan = w.plans?.[b2.team];
  if (plan?.slots) for (const q of plan.slots) if (q.taken === old.id) { q.taken = b2.id; if (q.takenKind === old.kind) q.takenKind = b2.kind; }
  if (old.slot !== undefined) b2.slot = old.slot;
  const T = w.teams[b2.team];
  if (!old.ruin) for (const [r, n] of Object.entries(scale(costOf(old), OLD_SALVAGE))) EC.give(T, r, n);
  if (BUILDINGS[b2.kind]?.wall && !b2.navSaved) EC.blockWall(w, b2, true); // (the stone shuts the stretch before the timber goes: never a gap)
  w.events.push({ t: w.tick, kind: "rebuilt-stone", building: b2.id, old: old.id, team: b2.team, what: b2.kind, x: b2.x, y: b2.y });
  removeBuilding(w, old, { keepPlots: true });
}
// "the whole circuit in stone": every palisade stretch (and gate) of the town, nearest along the circuit first from `start`
export function orderCircuit(w, team, start, { by = "player" } = {}) {
  const T = w.teams[team];
  const chk = canUpgrade(w, team, start); if (!chk.ok && !chk.error?.startsWith("It is being rebuilt")) return chk;
  const gatesToo = unlocked(w, team, "gatehouse");
  const pool = w.buildings.filter((b) => b.team === team && b.town === start.town && (b.kind === "palisade" || (gatesToo && b.kind === "gate" && b.gx1 !== undefined)) && !isCastle(w, b) && !b.razing && !(b.upBy !== undefined && bld(w, b.upBy)) && (b.ruin || (b.progress ?? 1) >= 1));
  const order = []; let at = start, left = pool.filter((b) => b !== start);
  if (pool.includes(start)) order.push(start);
  while (left.length) {
    const ex = at.x1 !== undefined ? [[at.x1, at.y1], [at.x2, at.y2]] : [[at.x, at.y]];
    let best = null, bd = Infinity;
    for (const b of left) { const pts = b.x1 !== undefined ? [[b.x1, b.y1], [b.x2, b.y2]] : [[b.x, b.y]]; for (const [ax, ay] of ex) for (const [bx, by2] of pts) { const d = Math.hypot(ax - bx, ay - by2); if (d < bd || (d === bd && b.id < best.id)) { bd = d; best = b; } } }
    order.push(best); left = left.filter((b) => b !== best); at = best;
  }
  if (!order.length) return { ok: false, error: "No palisade left to rebuild" };
  const q = (T.wallUp ||= { q: [], by }); for (const b of order) if (!q.q.includes(b.id)) q.q.push(b.id);
  q.by = by;
  const started = pump(w, team);
  return { ok: true, n: order.length, started };
}
export function cancelCircuit(w, team) { const T = w.teams[team]; const n = T.wallUp?.q.length || 0; delete T.wallUp; return { ok: n > 0, n }; }
// start the next stretches as the builders and the stone allow (at most UP_AT_ONCE under way)
function pump(w, team) {
  const T = w.teams[team], Q = T?.wallUp; if (!Q) return 0;
  let active = w.buildings.filter((b) => b.team === team && b.replaces !== undefined && (b.progress ?? 1) < 1).length, started = 0;
  while (active < UP_AT_ONCE && Q.q.length) {
    const old = bld(w, Q.q[0]);
    if (!old) { Q.q.shift(); continue; }
    const D = TW.townOfBuilding(w, old);
    const r = TW.within(w, team, D, () => orderUpgrade(w, team, old, { by: "reeve" }));
    if (!r.ok && r.poor) break;   // (waiting for the stone)
    Q.q.shift();
    if (r.ok) { active++; started++; }
  }
  if (!Q.q.length) delete T.wallUp;
  return started;
}

// ──────────────────────────────────────────────────────────── per tick (economy.economySystem)
export function demolishTick(w) {
  if (w.tick % 50 !== 17 || !w.teams) return;
  for (const T of w.teams) {
    if (!T?.store || T.fallen) continue;
    if (T.wallUp) pump(w, T.id);
    if (w.tick % 500 === 17) reeveClears(w, T);
  }
}
// the reeve clears an old ruin of his own accord (one at a time; never the keep's, a wall's or a castle's — a burnt
// stretch is the lord's to rebuild): the ground is wanted again
function reeveClears(w, T) {
  const doy = w.econ?.doy ?? 0;
  if (w.buildings.some((b) => b.team === T.id && b.razing && b.razing.by !== "player")) return;
  let pick = null;
  for (const b of w.buildings) {
    if (b.team !== T.id || !b.ruin || b.field || b.kind === "town_hall" || (b.town && TW.townById(T, b.town)?.lost) || BUILDINGS[b.kind]?.wall || b.kind === "gate" || b.kind === "gatehouse" || isCastle(w, b) || b.razing) continue;
    if (b.ruinDay === undefined) { b.ruinDay = doy; continue; }
    if (doy - b.ruinDay < RUIN_DAYS) continue;
    if (!pick || b.ruinDay < pick.ruinDay || (b.ruinDay === pick.ruinDay && b.id < pick.id)) pick = b;
  }
  if (pick) TW.within(w, T.id, TW.townOfBuilding(w, pick), () => orderDemolish(w, T.id, pick, { by: "reeve" }));
}
