// Siege harness (docs/siege-research.md §8): a walled town against an army with engines, headless.
// Measures, per seed, against the research bands:
//   A  time to breach: a palisade module (mangonel, trebuchet), a stone-wall module (1 and 2 trebuchets),
//      a timber gate and a stone gatehouse (ram)
//   B  casualties by engine fire: a mangonel into a formed block, a springald at a body of foot
//   C  escalade: palisade undefended / defended, stone wall defended, a docked siege tower (defended)
//   D  assembly: a packed trebuchet framed up on site; fire: archers shooting at a ram
//   E  the AI general's siege (maps/vale, both towns run by their generals): Blue's vill walled with a palisade
//      circuit and gate, Red's army arrives with a siege train. Reports what the general did and how it ended.
//   F  the castle (siege-works.js, castle-plan §4): a curtain module's damage states and breach time; a mine that
//      brings down a curtain module and one that brings down a tower; countermining; the ram against the gate leaves
//      and then the portcullis; murder holes and drops from hoardings; a barricaded breach that holds, then breaks;
//      escalade through castle.js level links; fire at the gate; a sally; starvation and surrender.
//   node tools/siege-test.mjs [--seeds 6] [--only A,B,C,D,E,F] [--v] [--wall stone_wall] [--minutes 45]
import { buildMap } from "./scenarios.mjs";
import { createWorld, addUnit, issueOrder, step, TICK, DT } from "../js/sim/world.js";
import { combatSystem } from "../js/sim/combat.js";
import { TERRAIN } from "../js/sim/terrain-types.js";
import * as EC from "../js/sim/economy.js";
import { siegeSystem, ensureSiege, makeEngine, engineInfo, ENG, breach as breachMod, isTowerB } from "../js/sim/siege.js";
import { MINE, WORKS, setProvisions, garrison } from "../js/sim/siege-works.js";
import { gateGeom } from "../js/sim/features.js";
import { ECON_DAYS_PER_REAL_SEC } from "../js/sim/clock.js";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : process.argv[i + 1] ?? true; };
const SEEDS = +arg("seeds", 6), ONLY = String(arg("only", "A,B,C,D,F")).split(","), V = process.argv.includes("--v");
const MAP = buildMap({ size: 1400, res: 141 });
const TOWN = { x: 700, y: 700 }, R = 80, N = 12;

// a keep-only town (team 1) inside a ring of `kind` (palisade | stone_wall) with a gate (timber | stone)
function world(seed, { wall = "palisade", gate = "gate" } = {}) {
  const w = createWorld({ map: MAP, terrain: TERRAIN, seed });
  w.friction = false;
  EC.initEconomy(w);
  for (const T of w.teams) { T.store = { stone: 1e6, timber: 1e6, ladders: 20, bolts: 400, carts: 4 }; T.eff = 0.8; }
  w.teams[1].town = { ...TOWN }; w.teams[0].town = { x: 100, y: 100 };
  w.teams[1].hall = EC.placeBuilding(w, 1, "town_hall", TOWN.x, TOWN.y, 0, true).id;
  const walls = [];
  for (let k = 0; k < N; k++) {
    const a0 = k * 2 * Math.PI / N, a1 = (k + 1) * 2 * Math.PI / N;
    const p = (a) => [TOWN.x + Math.cos(a) * R, TOWN.y + Math.sin(a) * R];
    if (k === 0) { // the gate's stretch, facing east (+x)
      const [x1, y1] = p(a0), [x2, y2] = p(a1);
      const g = EC.placeBuilding(w, 1, gate, (x1 + x2) / 2, (y1 + y2) / 2, Math.atan2(y2 - y1, x2 - x1), true);
      Object.assign(g, { gx1: x1, gy1: y1, gx2: x2, gy2: y2 }); walls.gate = g; continue;
    }
    walls.push(EC.placeWall(w, 1, wall, ...p(a0), ...p(a1), true));
  }
  w.systems.push(combatSystem, siegeSystem);
  ensureSiege(w);
  return { w, walls };
}
const run = (w, sec, until) => { for (let k = 0; k < sec / TICK; k++) { step(w); if (until && k % 10 === 0 && until()) return (k + 1) * TICK; } return null; };
const engine = (w, team, kind, x, y, facing, state = "ready", crew) => {
  const u = addUnit(w, { team, arm: kind, count: crew || ({ trebuchet: 16, mangonel: 16, springald: 4, ram: 14, siege_tower: 18, mantlet: 2 })[kind], x, y, facing: facing - Math.PI / 2, formation: "line" });
  return { u, e: makeEngine(w, u, kind, { state }) };
};
// the wall stretch facing east-north-east (k = 1, the one after the gate's) and a point outside it
const faceOf = (b, out) => { const mx = (b.x1 + b.x2) / 2, my = (b.y1 + b.y2) / 2, d = Math.hypot(mx - TOWN.x, my - TOWN.y); return { mx, my, ux: (mx - TOWN.x) / d, uy: (my - TOWN.y) / d, at: (r) => [mx + (mx - TOWN.x) / d * r, my + (my - TOWN.y) / d * r] }; };
const days = (sec) => sec * ECON_DAYS_PER_REAL_SEC;
const fmt = (v, d = 1) => v === null || v === undefined ? "—" : typeof v === "number" ? v.toFixed(d) : v;
const med = (a) => { const b = a.filter((x) => x !== null).sort((p, q) => p - q); return b.length ? b[b.length >> 1] : null; };
const results = [];
function band(name, val, lo, hi, unit = "") { const ok = val !== null && val >= lo && val <= hi; results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(64)} ${fmt(val, 2).padStart(8)}${unit}   band [${lo}, ${hi}]`); }

// ─────────────────────────────── A: time to breach
function breachTest(seed, { wall, kind, n = 1, dist, gate = "gate", target = "wall" }) {
  const { w, walls } = world(seed, { wall, gate });
  const b = target === "gate" ? walls.gate : walls[0], F = faceOf(target === "gate" ? { x1: b.gx1, y1: b.gy1, x2: b.gx2, y2: b.gy2 } : b);
  const es = [];
  for (let k = 0; k < n; k++) {
    const [x, y] = F.at(dist); const off = (k - (n - 1) / 2) * 14;
    const { u, e } = engine(w, 0, kind, x - F.uy * off, y + F.ux * off, Math.atan2(-F.uy, -F.ux));
    es.push(e);
    issueOrder(w, [u.id], { kind: kind === "ram" ? "batter" : "bombard", x: F.mx, y: F.my, bid: b.id, immediate: true });
  }
  const t0 = w.time;
  const done = () => target === "gate" ? b.gateBroken : (b.mods && [...b.mods].some((m) => m <= 0)) || b.ruin;
  let t0s = null; // timed from the first stone thrown / first blow struck (not the approach or the set-up)
  const sec0 = run(w, 60 * 40, () => { if (t0s === null && es.some((e) => e.status === "shooting" || e.status === "battering")) t0s = w.time; return done(); });
  const sec = sec0 === null || t0s === null ? null : w.time - t0s;
  if (V) console.log(`   ${kind}×${n} vs ${target === "gate" ? gate : wall} seed ${seed}: ${sec === null ? "no breach in 40 min" : `${(sec / 60).toFixed(1)} min = ${days(sec).toFixed(1)} econ days`} hit ${es.map((e) => Math.round(e.hitF * 100) + "%").join(",")} ${engineInfo(w, es[0]).status}`);
  return sec === null ? null : days(sec);
}

// ─────────────────────────────── B: casualties by engine fire
function fireTest2(seed, kind, dist, sec = 600) {
  const { w } = world(seed);
  const tx = 300, ty = 300;
  const foe = addUnit(w, { team: 1, arm: "spearmen", count: 120, x: tx, y: ty, facing: -Math.PI / 2, formation: "deep", training: 0.6, nerve: 0.95 });
  const ids = foe.members.slice();
  const { u } = engine(w, 0, kind, tx + dist, ty, Math.PI);
  issueOrder(w, [u.id], { kind: "bombard", x: tx, y: ty, immediate: true });
  run(w, sec);
  const cas = ids.filter((id) => !w.S.alive[id]).length;
  if (V) console.log(`   ${kind} at ${dist} m, ${sec / 60} min: ${cas} of ${ids.length} down; visible shots ${w.siege.stats.visible}`);
  return cas / (sec / 3600); // men per hour of fire
}

// ─────────────────────────────── C: escalade
function escTest(seed, { wall = "palisade", defenders = 0, tower = false, attackers = 60 }) {
  const { w, walls } = world(seed, { wall });
  run(w, 3); // (the walls become features at the combat system's next sync)
  const b = walls[1], F = faceOf(b);
  let d = null;
  if (defenders) { const [dx, dy] = F.at(-4); d = addUnit(w, { team: 1, arm: "spearmen", count: defenders, x: dx, y: dy, facing: Math.atan2(F.uy, F.ux) - Math.PI / 2, formation: "line", depth: 2, training: 0.45 }); d.standing = false; }
  let tw = null;
  if (tower) {
    const [x, y] = F.at(30); tw = engine(w, 0, "siege_tower", x, y, Math.atan2(-F.uy, -F.ux));
    issueOrder(w, [tw.u.id], { kind: "advance", x: F.mx, y: F.my, immediate: true });
    run(w, 300, () => tw.e.docked && tw.e.bridge >= 1);
  }
  const [ax, ay] = F.at(40);
  const a = addUnit(w, { team: 0, arm: "spearmen", count: attackers, x: ax, y: ay, facing: Math.atan2(-F.uy, -F.ux) - Math.PI / 2, formation: "line", training: 0.45 });
  issueOrder(w, [a.id], { kind: "escalade", x: F.mx, y: F.my, immediate: true });
  const Z = w.siege; let lodged = false, t = 0;
  let why = "";
  w.systems.push((w) => { for (const e of w.events) { if (e.kind === "escalade-lodged" && e.unit === a.id) lodged = true; if (e.kind === "escalade-failed" && e.unit === a.id) why = e.why; } });
  const sec = run(w, 900, () => lodged || !a.esc);
  const inside = a.members.filter((id) => w.S.alive[id] && (w.S.x[id] - TOWN.x) ** 2 + (w.S.y[id] - TOWN.y) ** 2 < (R - 1) ** 2).length;
  if (V) console.log(`   escalade ${wall}${tower ? " by tower" : ""} vs ${defenders} def, seed ${seed}: ${lodged ? "LODGED" : "failed (" + why + ")"} in ${fmt(sec ?? 900, 0)} s; climbed ${Z.stats.climbed} repulsed ${Z.stats.repulsed} fell ${Z.stats.fell}; inside ${inside}; attackers alive ${a.members.filter((id) => w.S.alive[id]).length}${d ? `; defenders alive ${d.members.filter((id) => w.S.alive[id]).length} fleeing ${d.members.filter((id) => w.S.alive[id] && w.S.status[id] >= 3).length} state ${d.state}` : ""}`);
  return { lodged, sec, climbed: Z.stats.climbed, repulsed: Z.stats.repulsed, fell: Z.stats.fell, lost: attackers - a.members.filter((id) => w.S.alive[id]).length };
}

// ─────────────────────────────── D: assembly and fire
function assemblyTest(seed) {
  const { w } = world(seed);
  const { u, e } = engine(w, 0, "trebuchet", 300, 300, 0, "packed");
  issueOrder(w, [u.id], { kind: "assemble", x: 330, y: 300, immediate: true });
  run(w, 300, () => e.state === "assembling");
  const sec = run(w, 60 * 20, () => e.state === "ready");
  if (V) console.log(`   trebuchet assembly seed ${seed}: ${sec === null ? "not done" : `${(sec / 60).toFixed(1)} min = ${days(sec).toFixed(1)} econ days`} (carts back ${w.teams[0].store.carts})`);
  return sec === null ? null : days(sec);
}
function burnTest(seed) {
  const { w, walls } = world(seed);
  const g = walls.gate, F = faceOf({ x1: g.gx1, y1: g.gy1, x2: g.gx2, y2: g.gy2 });
  const [dx, dy] = F.at(-10);
  addUnit(w, { team: 1, arm: "archers", count: 20, x: dx, y: dy, facing: Math.atan2(F.uy, F.ux) - Math.PI / 2, formation: "line", training: 0.6 });
  const [x, y] = F.at(60), { u, e } = engine(w, 0, "ram", x, y, Math.atan2(-F.uy, -F.ux));
  issueOrder(w, [u.id], { kind: "batter", x: F.mx, y: F.my, bid: g.id, immediate: true });
  run(w, 600, () => g.gateBroken || e.state === "burnt");
  const crewLost = 14 - u.members.filter((id) => w.S.alive[id]).length;
  if (V) console.log(`   ram under 20 archers, seed ${seed}: ${g.gateBroken ? "gate BROKEN" : e.state === "burnt" ? "ram BURNT" : "neither"}; crew lost ${crewLost}; ${engineInfo(w, e).status}`);
  return { broken: g.gateBroken, burnt: e.state === "burnt", crewLost };
}

const seeds = [...Array(SEEDS).keys()].map((k) => k + 1);
if (ONLY.includes("A")) {
  console.log("A · time to breach (econ days; research §6 bands)");
  band("mangonel vs palisade module at 90 m", med(seeds.map((s) => breachTest(s, { wall: "palisade", kind: "mangonel", dist: 90 }))), 0.2, 2, " d");
  band("trebuchet vs palisade module at 180 m", med(seeds.map((s) => breachTest(s, { wall: "palisade", kind: "trebuchet", dist: 180 }))), 0.1, 1.5, " d");
  band("1 trebuchet vs stone-wall module at 180 m", med(seeds.slice(0, 3).map((s) => breachTest(s, { wall: "stone_wall", kind: "trebuchet", dist: 180 }))), 6, 30, " d");
  band("2 trebuchets vs stone-wall module at 180 m", med(seeds.slice(0, 3).map((s) => breachTest(s, { wall: "stone_wall", kind: "trebuchet", n: 2, dist: 180 }))), 3, 15, " d");
  band("mangonel vs stone-wall module (should not breach in 40 min)", breachTest(1, { wall: "stone_wall", kind: "mangonel", dist: 90 }) === null ? 1 : 0, 1, 1);
  band("ram vs timber gate (leaves broken)", med(seeds.map((s) => breachTest(s, { wall: "palisade", kind: "ram", dist: 40, target: "gate" }))), 0.1, 1.5, " d");
  band("ram vs stone gatehouse", med(seeds.slice(0, 3).map((s) => breachTest(s, { wall: "stone_wall", gate: "gatehouse", kind: "ram", dist: 40, target: "gate" }))), 2, 12, " d");
}
if (ONLY.includes("B")) {
  console.log("B · casualties by engine fire (men per hour into a deep block of 120)");
  band("mangonel at 90 m (a block that stands in the beaten zone)", med(seeds.map((s) => fireTest2(s, "mangonel", 90))), 40, 250, "/h");
  band("springald at 200 m", med(seeds.map((s) => fireTest2(s, "springald", 200))), 0.5, 20, "/h");
}
if (ONLY.includes("C")) {
  console.log("C · escalade (60 spearmen; success = lodged on the wall-walk within 15 min)");
  const rate = (cfg) => { const r = seeds.map((s) => escTest(s, cfg)); const ok = r.filter((x) => x.lodged).length / r.length; if (V) console.log(`     lost ${med(r.map((x) => x.lost))} (median), repulsed ${med(r.map((x) => x.repulsed))}, fell ${med(r.map((x) => x.fell))}`); return ok; };
  band("palisade, undefended: success rate", rate({ wall: "palisade" }), 0.99, 1);
  band("palisade, 30 defenders: success rate", rate({ wall: "palisade", defenders: 30 }), 0, 0.5);
  band("stone wall, 30 defenders: success rate", rate({ wall: "stone_wall", defenders: 30 }), 0, 0.35);
  band("stone wall, 30 defenders, by a docked tower: success rate", rate({ wall: "stone_wall", defenders: 30, tower: true }), 0.3, 1);
}
if (ONLY.includes("D")) {
  console.log("D · assembly and fire");
  band("trebuchet framed up on site (econ days)", med(seeds.slice(0, 2).map(assemblyTest)), 3, 12, " d");
  const r = seeds.map(burnTest);
  band("ram under 20 archers: gate broken before the ram burns (share)", r.filter((x) => x.broken).length / r.length, 0.3, 1);
}
if (ONLY.includes("E")) {
  const { setup } = await import("./playtest.mjs");
  const { buildPlan } = await import("../js/sim/townplan.js");
  const WALL = arg("wall", "palisade"), MIN = +arg("minutes", 45);
  console.log(`E · the AI general besieges a ${WALL} circuit (${MIN} min)`);
  let fell = 0, breached = 0, esc = 0;
  for (const seed of seeds.slice(0, Math.min(SEEDS, 3))) {
    const { w, brains, gens } = await setup(seed);
    const B = w.teams[0], H = B.town, plan = w.plans[0], Red = gens[1];
    for (const sl of plan.slots) {
      if (sl.type === "wall") EC.placeWall(w, 0, WALL, sl.x1, sl.y1, sl.x2, sl.y2, true);
      if (sl.type === "gate") { const g = EC.placeBuilding(w, 0, WALL === "stone_wall" ? "gatehouse" : "gate", sl.x, sl.y, Math.atan2(sl.y2 - sl.y1, sl.x2 - sl.x1), true); Object.assign(g, { gx1: sl.x1, gy1: sl.y1, gx2: sl.x2, gy2: sl.y2 }); }
    }
    Red.seenWalls = new Set(w.buildings.filter((b) => b.team === 0 && b.x1 !== undefined).map((b) => b.id));
    // Red's host before Blue's vill: foot, bows, and the train (packed), with ladders in the store
    const dir = Math.atan2(w.teams[1].town.y - H.y, w.teams[1].town.x - H.x), cx = H.x + Math.cos(dir) * 420, cy = H.y + Math.sin(dir) * 420, face = dir + Math.PI - Math.PI / 2;
    const army = [["spearmen", 60], ["levy", 60], ["menatarms", 24], ["archers", 30]].map(([arm, n], k) => addUnit(w, { team: 1, arm, count: n, x: cx + (k - 1.5) * 40 * Math.sin(dir), y: cy - (k - 1.5) * 40 * Math.cos(dir), facing: face, formation: "line", training: 0.5 }));
    const kinds = WALL === "stone_wall" ? ["trebuchet", "trebuchet", "mangonel", "ram", "siege_tower"] : ["mangonel", "ram", "trebuchet"];
    const train = kinds.map((k, j) => engine(w, 1, k, cx + Math.cos(dir) * (40 + j * 12), cy + Math.sin(dir) * (40 + j * 12), dir + Math.PI, "packed"));
    w.teams[1].store.ladders = 16;
    Object.assign(Red, { mode: "siege", army: new Set(army.map((u) => u.id)), train: new Set(train.map((t) => t.u.id)), siegeStart: w.tick, route: { pts: [[cx, cy]], via: "test" }, wp: 1, startStr: 273, campaignPlanned: true });
    const log = []; const t0 = w.tick;
    w.systems.push((w) => { for (const e of w.events) if (/breach|gate-|escalade|engine-(ready|destroyed|captured|out|target|fixed)|town-fell|tower-docked/.test(e.kind)) log.push(`${((w.tick - t0) / 600).toFixed(1)}m ${e.kind}${e.why ? " (" + e.why + ")" : ""}${e.what ? " " + e.what : ""}`); });
    const { foeRing } = await import("../js/sim/ai-general.js");
    for (let k = 0; k < MIN * 600 && !B.fallen; k++) { step(w); brains(); if (V && k % 3000 === 2999) { const ring = foeRing(w, Red); console.log(`      [${(k / 600).toFixed(0)}m] Red ${Red.mode}/${Red.sub} ring ${ring.toFixed(0)} intel ${[...Red.intel.values()].filter((q) => !q.workers && w.tick - q.tick < 40).map((q) => q.arm + "@" + Math.round(Math.hypot(q.x - Red.enemyTown.x, q.y - Red.enemyTown.y))).join(" ")} | train ${[...Red.train].map((id) => { const e = w.siege.engines.find((e) => e.unit === id); return e ? e.kind + ":" + e.state + ":" + (e.status || "") + (e.kind === "trebuchet" ? "{" + JSON.stringify({ o: w.units.get(id)?.order?.kind, p: w.units.get(id)?.pendingOrder?.kind, key: e.aiKey, t: e.tgt?.kind, x: Math.round(e.x), y: Math.round(e.y) }) + "}" : "") : "-"; }).join(" ")} | army ${[...Red.army].map((id) => w.units.get(id)).filter(Boolean).map((u) => u.arm.slice(0, 4) + u.members.length + ":" + u.order?.kind + (u.esc ? "/" + u.esc.phase : "") + "@" + Math.round(Math.hypot(u.ax - Red.enemyTown.x, u.ay - Red.enemyTown.y))).join(" ")}`); } }
    const notes = Red.log.filter((n) => n.tick >= t0).map((n) => `${((n.tick - t0) / 600).toFixed(1)}m ${n.msg}`);
    if (B.fallen) fell++; if (log.some((l) => /breach|gate-broken/.test(l))) breached++; if (log.some((l) => /escalade /.test(l) || /escalade-lodged/.test(l))) esc++;
    console.log(`   seed ${seed}: ${B.fallen ? "Blue FELL (" + B.fallReason + ")" : "Blue holds"} after ${((w.tick - t0) / 600).toFixed(1)} min; stones ${Math.round(w.siege.stats.thrown)} thrown, ${w.siege.stats.breaches} breaches, ${w.siege.stats.climbed} climbed, ${w.siege.stats.repulsed} thrown down, ${w.siege.stats.menHit} crushed`);
    if (V) { for (const l of log.slice(0, 40)) console.log("      " + l); for (const n of notes.slice(0, 30)) console.log("      · " + n); }
  }
  band("AI siege: the train makes a breach / breaks the gate (share of runs)", breached / Math.min(SEEDS, 3), 0.66, 1);
}

// ─────────────────────────────── F: the castle
// a stone circuit with a gatehouse; `tower`: a mural tower at the ring's vertex between walls[0] and walls[1]
function castleW(seed, { gate = "gatehouse", wall = "stone_wall", castle = false } = {}) {
  const r = world(seed, { wall, gate });
  const a = 2 * 2 * Math.PI / N, tx = TOWN.x + Math.cos(a) * R, ty = TOWN.y + Math.sin(a) * R;
  const tw = { id: (r.w.nextBuilding = (r.w.nextBuilding || 0) + 1), kind: "tower", team: 1, x: tx, y: ty, r: 4.5, rot: 0, progress: 1, hp: 20000, hpMax: 20000, queue: [], tower: true };
  r.w.buildings.push(tw); r.tower = tw;
  if (castle) { r.w.castles = [{ id: "c1", team: 1, name: "test", parts: [...r.walls.map((b) => ({ id: "cw" + b.id, kind: "curtain", bid: b.id, walkLvl: 1 })), { id: "t1", kind: "tower", bid: tw.id, walkLvl: 1 }, { id: "g1", kind: "gatehouse", bid: r.walls.gate.id }], links: [] }]; }
  return r;
}
const listen = (w, kinds) => { const got = []; w.systems.push((w) => { for (const e of w.events) if (kinds.test(e.kind)) got.push({ ...e, time: w.time }); }); return got; };
const at = (F, r, side = 0) => { const [x, y] = F.at(r); return [x - F.uy * side, y + F.ux * side]; };
const alive = (w, ids) => ids.filter((i) => w.S.alive[i]).length;

function stateTest(seed) { // a trebuchet on one curtain module: intact → pocked → cracked → breach, in that order
  const { w, walls } = castleW(seed), b = walls[0], F = faceOf(b);
  const ev = listen(w, /^wall-state$/);
  const { u, e } = engine(w, 0, "trebuchet", ...F.at(180), Math.atan2(-F.uy, -F.ux));
  issueOrder(w, [u.id], { kind: "bombard", x: F.mx, y: F.my, bid: b.id, immediate: true });
  let t0 = null; const sec = run(w, 60 * 30, () => { if (t0 === null && e.status === "shooting") t0 = w.time; return ev.some((q) => q.state === "breach"); });
  const mine = ev.filter((q) => q.building === b.id && q.mod === ev[0]?.mod).map((q) => q.state);
  if (V) console.log(`   states seed ${seed}: ${mine.join(" → ")} in ${fmt(days(w.time - (t0 ?? 0)))} d`);
  return { order: mine.join(",") === "pocked,cracked,breach", d: sec === null ? null : days(w.time - t0) };
}
function mineTest(seed, { tower = false, counter = false } = {}) {
  const { w, walls, tower: tw } = castleW(seed), b = tower ? tw : walls[0];
  const ev = listen(w, /^(mine-|countermine|tower-collapsed|wall-breached)/);
  const cx = tower ? tw.x : faceOf(b).mx, cy = tower ? tw.y : faceOf(b).my, d0 = Math.hypot(cx - TOWN.x, cy - TOWN.y), ux = (cx - TOWN.x) / d0, uy = (cy - TOWN.y) / d0;
  const mu = addUnit(w, { team: 0, arm: "levy", count: 16, x: cx + ux * (MINE.startOut + 3), y: cy + uy * (MINE.startOut + 3), facing: Math.atan2(-uy, -ux) - Math.PI / 2, formation: "line", training: 0.4 });
  let du = null;
  if (counter) { du = addUnit(w, { team: 1, arm: "levy", count: 12, x: cx - ux * 8, y: cy - uy * 8, facing: 0, formation: "line", training: 0.4 }); issueOrder(w, [du.id], { kind: "countermine", x: cx - ux * 6, y: cy - uy * 6, immediate: true }); }
  const ids = mu.members.slice(), dids = du ? du.members.slice() : [];
  issueOrder(w, [mu.id], { kind: "mine", x: cx, y: cy, bid: b.id, immediate: true });
  const sec = run(w, 60 * 40, () => ev.some((q) => q.kind === "mine-collapse" || q.kind === "mine-lost"));
  const col = ev.find((q) => q.kind === "mine-collapse"), fights = ev.filter((q) => q.kind === "mine-fight");
  const res = { d: col ? days(col.time) : null, full: !!col?.full, towerDown: !!ev.find((q) => q.kind === "tower-collapsed"), breached: tower ? b.ruin : !!(b.mods && [...b.mods].some((v) => v <= 0)), lost: !!ev.find((q) => q.kind === "mine-lost"), heard: !!ev.find((q) => q.kind === "mine-detected"), fights: fights.length, dead: fights.reduce((s, q) => s + q.attackersDead + q.defendersDead, 0) };
  if (V) console.log(`   mine ${tower ? "tower" : "curtain"}${counter ? " vs countermine" : ""} seed ${seed}: ${col ? `collapse at ${fmt(res.d)} d (${col.full ? "full" : "partial"})` : res.lost ? "LOST" : "nothing"}; heard ${res.heard}, fights ${res.fights}, dead ${res.dead}; attackers ${alive(w, ids)}/${ids.length}${du ? `, counterminers ${alive(w, dids)}/${dids.length}` : ""}`);
  return res;
}
function gateTest(seed) { // the ram: leaves, then the portcullis; the passage stays shut between
  const { w, walls } = castleW(seed), g = walls.gate, F = faceOf({ x1: g.gx1, y1: g.gy1, x2: g.gx2, y2: g.gy2 });
  const ev = listen(w, /^(gate-|portcullis-)/);
  let shutBetween = true;
  w.systems.push(() => { if (g.gl <= 0 && g.gpc > 0 && !g.shut) shutBetween = false; });
  const { u } = engine(w, 0, "ram", ...F.at(40), Math.atan2(-F.uy, -F.ux));
  issueOrder(w, [u.id], { kind: "batter", x: F.mx, y: F.my, bid: g.id, immediate: true });
  run(w, 60 * 20, () => g.gateBroken);
  const seq = ev.map((q) => q.kind).filter((k) => /leaves-broken|portcullis-broken|gate-broken|portcullis-dropped/.test(k));
  const ok = seq.join(",") === "portcullis-dropped,gate-leaves-broken,portcullis-broken,gate-broken" && shutBetween;
  if (V) console.log(`   gate seed ${seed}: ${seq.join(" → ")}; shut between ${shutBetween}; broken at ${fmt(days(w.time))} d`);
  return ok ? 1 : 0;
}
function holesTest(seed) { // men caught in a gatehouse passage (leaves down, portcullis down), 8 men in the chamber
  const { w, walls } = castleW(seed), g = walls.gate, G = gateGeom(g);
  run(w, 2);
  g.gl = 0; g.hp = g.hpMax * (0.2 + 0.8 * (1 - 8 / 28));
  const n = [(G.px - TOWN.x) / Math.hypot(G.px - TOWN.x, G.py - TOWN.y), (G.py - TOWN.y) / Math.hypot(G.px - TOWN.x, G.py - TOWN.y)];
  addUnit(w, { team: 1, arm: "levy", count: 8, x: G.px - n[0] * 6, y: G.py - n[1] * 6, facing: Math.atan2(n[1], n[0]) - Math.PI / 2, formation: "line", training: 0.4 }).hold = true;
  const a = addUnit(w, { team: 0, arm: "spearmen", count: 20, x: G.px + n[0] * 3, y: G.py + n[1] * 3, facing: Math.atan2(-n[1], -n[0]) - Math.PI / 2, formation: "deep", training: 0.5 });
  a.hold = true; const ids = a.members.slice();
  const ev = listen(w, /^(kill|down)$/);
  run(w, 180);
  const hit = ev.filter((q) => q.cause === "murder-hole").length;
  if (V) console.log(`   murder holes seed ${seed}: ${hit} down in 3 min (${alive(w, ids)}/${ids.length} left), portcullis ${g.portDown ? "down" : "up"}`);
  return hit / 3;
}
function dropsTest(seed, hoard) { // 30 men at the foot of a curtain, 10 defenders on the walk above
  const { w, walls } = castleW(seed), b = walls[0], F = faceOf(b);
  b.hoard = hoard;
  run(w, 3);
  addUnit(w, { team: 1, arm: "levy", count: 10, x: F.at(-2.2)[0], y: F.at(-2.2)[1], facing: Math.atan2(F.uy, F.ux) - Math.PI / 2, formation: "line", depth: 1, training: 0.4 }).hold = true;
  const a = addUnit(w, { team: 0, arm: "spearmen", count: 30, x: F.at(2.5)[0], y: F.at(2.5)[1], facing: Math.atan2(-F.uy, -F.ux) - Math.PI / 2, formation: "line", depth: 2, training: 0.5 });
  a.hold = true;
  const ev = listen(w, /^(kill|down|wound)$/), dr = listen(w, /^dropped$/);
  run(w, 300);
  const hit = ev.filter((q) => q.cause === "machicolation" || q.cause === "parapet").length;
  if (V) console.log(`   drops ${hoard ? "hoarding" : "bare parapet"} seed ${seed}: ${dr.length} struck, ${hit} down in 5 min`);
  return dr.length / 5;
}
function barricadeTest(seed) { // a breach, barricaded in quiet; then 60 men come at it with 20 behind it
  const { w, walls } = castleW(seed), b = walls[0], F = faceOf(b);
  run(w, 3);
  const n = EC.wallModules(b), k = n >> 1; b.mods = new Float32Array(n).fill(b.hp / n); b.hp -= b.mods[k]; b.mods[k] = 0; breachMod(w, b, k, null);
  const d = addUnit(w, { team: 1, arm: "spearmen", count: 20, x: F.at(-12)[0], y: F.at(-12)[1], facing: Math.atan2(F.uy, F.ux) - Math.PI / 2, formation: "line", training: 0.5 });
  issueOrder(w, [d.id], { kind: "barricade", x: F.mx, y: F.my, immediate: true });
  const ev = listen(w, /^(breach-barricaded|barricade-broken)$/);
  run(w, 120, () => ev.some((q) => q.kind === "breach-barricaded"));
  const up = ev.find((q) => q.kind === "breach-barricaded"); if (!up) return { held: null };
  issueOrder(w, [d.id], { kind: "move", x: F.at(-4)[0], y: F.at(-4)[1], facing: Math.atan2(F.uy, F.ux) - Math.PI / 2, immediate: true });
  run(w, 20);
  const a = addUnit(w, { team: 0, arm: "spearmen", count: 60, x: F.at(40)[0], y: F.at(40)[1], facing: Math.atan2(-F.uy, -F.ux) - Math.PI / 2, formation: "line", training: 0.5 });
  issueOrder(w, [a.id], { kind: "assault", x: F.at(1.8)[0], y: F.at(1.8)[1], immediate: true, pace: "quick" });
  let t0 = null; const W = w.siege.works;
  run(w, 900, () => { if (t0 === null && W.barricades[0]?.hp < 1) t0 = w.time; return ev.some((q) => q.kind === "barricade-broken"); });
  const br = ev.find((q) => q.kind === "barricade-broken");
  if (V) console.log(`   barricade seed ${seed}: up after ${fmt(days(up.time))} d; ${br ? `broken after ${fmt(br.time - t0, 0)} s of pulling` : `held (hp ${fmt(W.barricades[0].hp)})`}`);
  return { held: t0 === null ? null : (br ? br.time : w.time) - t0, broken: !!br };
}
function linkTest(seed) { // escalade onto a castle's curtain: the ladders are castle.js links while up
  const { w, walls } = castleW(seed, { castle: true });
  run(w, 3);
  const C = w.castles[0], b = walls[1], F = faceOf(b);
  let peak = 0; w.systems.push(() => { peak = Math.max(peak, C.links.filter((l) => l.kind === "ladder").length); });
  const a = addUnit(w, { team: 0, arm: "spearmen", count: 40, x: F.at(40)[0], y: F.at(40)[1], facing: Math.atan2(-F.uy, -F.ux) - Math.PI / 2, formation: "line", training: 0.5 });
  const ev = listen(w, /^escalade-(lodged|failed)$/);
  issueOrder(w, [a.id], { kind: "escalade", x: F.mx, y: F.my, immediate: true });
  run(w, 600, () => ev.length);
  const after = C.links.filter((l) => l.kind === "ladder").length;
  // and a breach becomes a `breach` link
  const k = 2, bb = walls[3]; bb.mods = new Float32Array(EC.wallModules(bb)).fill(bb.hp / EC.wallModules(bb)); bb.mods[k] = 0; breachMod(w, bb, k, null);
  run(w, 2);
  const bl = C.links.filter((l) => l.kind === "breach" && l.bid === bb.id).length;
  if (V) console.log(`   links seed ${seed}: ladders up at once ${peak}, left after ${ev[0]?.kind || "—"} ${after}; breach links ${bl}`);
  return peak >= 1 && bl === 1 && (ev[0]?.kind !== "escalade-failed" || after === 0) ? 1 : 0;
}
function gateFireTest(seed, dousers) {
  const { w, walls } = castleW(seed, { gate: "gate", wall: "palisade" }), g = walls.gate, F = faceOf({ x1: g.gx1, y1: g.gy1, x2: g.gx2, y2: g.gy2 });
  if (dousers) addUnit(w, { team: 1, arm: "levy", count: dousers, x: F.at(-6)[0], y: F.at(-6)[1], facing: Math.atan2(F.uy, F.ux) - Math.PI / 2, formation: "line", training: 0.4 }).hold = true;
  const a = addUnit(w, { team: 0, arm: "levy", count: 20, x: F.at(40)[0], y: F.at(40)[1], facing: Math.atan2(-F.uy, -F.ux) - Math.PI / 2, formation: "line", training: 0.4 });
  issueOrder(w, [a.id], { kind: "fire-gate", x: F.mx, y: F.my, bid: g.id, immediate: true });
  const sec = run(w, 60 * 12, () => g.gateBroken);
  if (V) console.log(`   gate fire vs ${dousers} dousers seed ${seed}: ${g.gateBroken ? `burnt through in ${fmt(sec / 60)} min` : `standing (leaves ${fmt(g.gl)})`}`);
  return g.gateBroken ? 1 : 0;
}
function sallyTest(seed) { // 30 men out by a postern at a mangonel 90 m out with its crew of 16
  const { w, walls } = castleW(seed), b = walls[0], F = faceOf(b);
  b.postern = true;
  const { u, e } = engine(w, 0, "mangonel", ...F.at(90), Math.atan2(-F.uy, -F.ux));
  issueOrder(w, [u.id], { kind: "bombard", x: F.mx, y: F.my, bid: b.id, immediate: true });
  const d = addUnit(w, { team: 1, arm: "spearmen", count: 30, x: F.at(-15)[0], y: F.at(-15)[1], facing: Math.atan2(F.uy, F.ux) - Math.PI / 2, formation: "line", training: 0.6 });
  const ev = listen(w, /^(sally-|engine-fired|engine-destroyed)/);
  run(w, 90);
  issueOrder(w, [d.id], { kind: "sally", x: e.x, y: e.y, immediate: true });
  let low = e.hp; // (the worst it came to: its carpenters mend it a day after the fire is out — siege.js engCond)
  run(w, 600, () => { low = Math.min(low, e.hp); return ev.some((q) => q.kind === "sally-in"); });
  const fired = e.state === "burnt" || low < e.hpMax * 0.5;
  if (V) console.log(`   sally seed ${seed}: ${ev.map((q) => q.kind + (q.why ? "(" + q.why + ")" : "")).join(" ")}; engine ${e.state} fire ${fmt(e.fire)}; back ${ev.some((q) => q.kind === "sally-in")}`);
  return fired && ev.some((q) => q.kind === "sally-in") ? 1 : 0;
}
function repairTest(seed) { // a breached module walled up by 40 men (days pass: siegeSystem alone); an enemy near stops the work
  const { w, walls } = castleW(seed), b = walls[0], F = faceOf(b);
  run(w, 3);
  const n = EC.wallModules(b), k = n >> 1; b.mods = new Float32Array(n).fill(b.hp / n); b.hp -= b.mods[k]; b.mods[k] = 0; breachMod(w, b, k, null);
  const d = addUnit(w, { team: 1, arm: "spearmen", count: 40, x: F.at(-10)[0], y: F.at(-10)[1], facing: Math.atan2(F.uy, F.ux) - Math.PI / 2, formation: "line", training: 0.5 });
  issueOrder(w, [d.id], { kind: "repair", x: F.mx, y: F.my, bid: b.id, immediate: true });
  const ev = listen(w, /^breach-repaired$/);
  run(w, 30);
  const early = b.mods[k] > 0 || ev.length > 0; // (it must not stand again after a few seconds' work)
  const days = (sec) => { let got = null; for (let q = 0; q < sec / TICK && !got; q++) { w.tick++; w.time += DT; w.events.length = 0; siegeSystem(w); for (const e of w.events) if (e.kind === "breach-repaired") got = e; } return got; };
  const d0 = w.time * ECON_DAYS_PER_REAL_SEC;
  days(1 / ECON_DAYS_PER_REAL_SEC); // one day of work, then the enemy comes up: the work stops
  const p1 = b.rebuild?.[k] || 0;
  const foe = addUnit(w, { team: 0, arm: "spearmen", count: 20, x: F.at(30)[0], y: F.at(30)[1], facing: 0, formation: "line", training: 0.5 });
  run(w, 0.2); days(1 / ECON_DAYS_PER_REAL_SEC); const p2 = b.rebuild?.[k] || 0;
  for (const i of foe.members) { w.S.alive[i] = 0; } run(w, 0.2);
  const done = days(20 / ECON_DAYS_PER_REAL_SEC);
  const t = done ? w.time * ECON_DAYS_PER_REAL_SEC - d0 - 1 : null; // (less the day the enemy stood by)
  if (V) console.log(`   repair seed ${seed}: standing after 30 s ${early}; after a day ${(p1 * 100).toFixed(0)} %, a day with the enemy near ${(p2 * 100).toFixed(0)} %; walled up in ${fmt(t)} working days`);
  return { early, paused: Math.abs(p2 - p1) < 1e-6 && p1 > 0, d: t };
}
function starveTest(seed) { // 40 men with 20 days' food, a host of 300 outside; days pass (siegeSystem alone, as siege-war.js does)
  const { w } = castleW(seed);
  addUnit(w, { team: 1, arm: "spearmen", count: 40, x: TOWN.x + 20, y: TOWN.y, facing: 0, formation: "line", training: 0.5 });
  addUnit(w, { team: 0, arm: "levy", count: 300, x: TOWN.x + 200, y: TOWN.y, facing: 0, formation: "line", training: 0.4 });
  step(w);
  const h = setProvisions(w, { team: 1, days: 20 });
  let sur = null;
  for (let k = 0; k < 90 / (TICK * ECON_DAYS_PER_REAL_SEC) && !sur; k++) { w.tick++; w.time += DT; w.events.length = 0; siegeSystem(w); for (const e of w.events) if (e.kind === "surrender") sur = e; }
  if (V) console.log(`   starvation seed ${seed}: ${sur ? `yielded on day ${sur.day} (${sur.why}, terms ${sur.terms}, ${sur.garrison} men)` : "held 90 days"}; food ${fmt(h.food)}`);
  return sur ? sur.day : null;
}

if (ONLY.includes("F")) {
  console.log("F · the castle (siege-works.js; research §9–§16)");
  const FSEL = String(arg("f", "")).split(",").filter(Boolean), FS = (k) => !FSEL.length || FSEL.includes(k);
  if (FS("states")) {
    const st = seeds.slice(0, 3).map(stateTest);
    band("curtain module: intact → pocked → cracked → breach, in order (share)", st.filter((x) => x.order).length / st.length, 1, 1);
    band("1 trebuchet breaches a castle curtain module (econ days)", med(st.map((x) => x.d)), 6, 30, " d");
  }
  if (FS("mine")) {
    const mc = seeds.slice(0, 3).map((s) => mineTest(s));
    band("mine under a curtain module: fired and fallen (econ days)", med(mc.map((x) => x.d)), 12, 35, " d");
    band("mine under a curtain module: a breach (share)", mc.filter((x) => x.breached).length / mc.length, 0.5, 1);
    const mt = seeds.map((s) => mineTest(s, { tower: true }));
    band("mine under a tower: the tower falls entire (share)", mt.filter((x) => x.towerDown).length / mt.length, 0.5, 1);
  }
  if (FS("counter")) {
    const cm = seeds.map((s) => mineTest(s, { counter: true }));
    band("countermined: the mine heard (share)", cm.filter((x) => x.heard).length / cm.length, 0.5, 1);
    band("countermined: the mine lost (share)", cm.filter((x) => x.lost).length / cm.length, 0.3, 1);
    band("underground fights kill men (dead per fight)", cm.reduce((s, x) => s + x.dead, 0) / Math.max(1, cm.reduce((s, x) => s + x.fights, 0)), 0.5, 6);
  }
  if (FS("gate")) band("ram: portcullis dropped, leaves, then portcullis, passage shut between (share)", med(seeds.slice(0, 3).map(gateTest)), 1, 1);
  if (FS("holes")) band("murder holes: men down per minute in a crowded passage", med(seeds.slice(0, 3).map(holesTest)), 0.5, 8, "/min");
  if (FS("drops")) {
    const dh = med(seeds.slice(0, 3).map((s) => dropsTest(s, true))), db = med(seeds.slice(0, 3).map((s) => dropsTest(s, false)));
    band("drops from hoardings on men at the wall foot (struck per minute)", dh, 1, 20, "/min");
    band("hoardings vs a bare parapet (ratio)", db > 0 ? dh / db : dh > 0 ? 10 : null, 1.8, 20);
  }
  if (FS("barricade")) {
    const bk = seeds.slice(0, 3).map(barricadeTest);
    band("barricaded breach (20 behind it) holds against 60 men (s of pulling)", med(bk.map((x) => x.held)), 30, 900, " s");
    band("... and then breaks (share)", bk.filter((x) => x.broken).length / bk.length, 0.66, 1);
  }
  if (FS("links")) band("escalade through castle.js links (ladder links up, breach link made)", med(seeds.slice(0, 3).map(linkTest)), 1, 1);
  if (FS("fire")) {
    band("gate fire, undefended: burnt through within 12 min (share)", seeds.slice(0, 3).map((s) => gateFireTest(s, 0)).reduce((a, b, _, A) => a + b / A.length, 0), 0.66, 1);
    band("gate fire, 8 men pouring water from above: burnt through (share)", seeds.slice(0, 3).map((s) => gateFireTest(s, 8)).reduce((a, b, _, A) => a + b / A.length, 0), 0, 0.34);
  }
  if (FS("sally")) band("sally by a postern burns the mangonel (≥ half) and comes back (share)", seeds.slice(0, 3).map(sallyTest).reduce((a, b, _, A) => a + b / A.length, 0), 0.66, 1);
  if (FS("repair")) {
    const rp = seeds.slice(0, 3).map(repairTest);
    band("breach walled up by 40 men (working days; stands only when done, stops with the enemy near)", rp.every((x) => !x.early && x.paused) ? med(rp.map((x) => x.d)) : null, 2.5, 8, " d");
  }
  if (FS("starve")) band("starvation: 20 days' food, yields on day", med(seeds.slice(0, 3).map(starveTest)), 20, 40, " d");
}
const fails = results.filter((x) => !x).length;
console.log(`\n${results.length - fails} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
