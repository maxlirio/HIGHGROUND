// Siege engines, escalade, breaches and shut gates (docs/siege-research.md; art contract docs/siege-art-contract.md).
//
// ENGINES are objects in w.siege.engines, each served by a CREW: a unit of real men (arm = the engine kind,
// drafted at the siege workshop, economy.js). The engine sits on its crew's anchor and goes where they
// take it, at the pace of the thing (towed, pushed or carted). If the crew are killed or run, it stops. An
// engine left without a crew is abandoned, and enemy men who reach it capture it. Engines burn: fire arrows,
// torches carried out in a sally, pitch poured from the wall on a ram or a tower. Crews douse the fire.
//
//   trebuchet   counterweight engine. It leaves the yard "packed" (its ironwork and ropes, and 7 t of baulks
//               on carts), is framed up where it is to shoot (assembling, man-days on the economic clock),
//               and never moves again. Heavy stones (90 kg) at 120–230 m.
//   mangonel    traction trebuchet: 8 kg stones at 30–110 m, 16 men on the ropes; towed slowly, and set up
//               for a minute before it shoots.
//   springald   torsion bolt-thrower on a carriage: quarrels at men (and crews) out to 300 m.
//   ram         covered ram ("cat", "sow"), pushed up to a gate, palisade or wall and swung against it.
//   siege_tower belfry, pushed up to the wall. Once its bridge is down, men cross onto the wall-walk.
//   mantlet     wheeled screen: hard cover for the missile men standing behind it.
//
// ESCALADE is an order for foot: "escalade" at a wall. Ladders come from the store, or are knocked together
// from timber. The men raise them and climb one at a time, and each is fought at the top (see climbTop).
// A docked siege tower is a much wider, safer ladder.
//
// TWO CLOCKS (js/sim/clock.js). What happens to MEN is tactical and real-time: a stone crushing a file,
// a quarrel, a climber thrown from a ladder. What happens to STRUCTURES is work, and runs on the economic
// clock, as building and repairing them do. A wall that takes 12 econ days to breach is 8 real minutes of
// bombardment; the defenders repair it on the same clock. If battering ran at 1× while masonry went up and
// was patched at 2160×, a breach could never be made. So each engine throws its real number of stones
// per econ day (throwsPerDay; each has an expected share landing on the target, see hitFraction), and a
// visible stone is launched at the engine's real TACTICAL rate. That stone hurts the men it lands among,
// with the real probability for one stone (ENG.menP).
//
// WALLS take damage per 6 m module (b.mods). A module at 0 is a BREACH: a gap in the wall's features and
// nav cells, rubble in the render. A gate's leaves can be broken in (b.gateBroken) and its flanks still
// stand. Gates are SHUT while the enemy is near and blocked for everyone, and attackers who get inside can
// open one. BARRIERS: men cannot walk through a standing wall, palisade or shut gate (barrierResolve), so
// the ways in are a breach, a broken or opened gate, a ladder or a tower.
import { S_IDLE, S_MOVE, S_FIGHT, S_FLEE, S_DOWN, S_DEAD, S_WORK, S_CAPT, ST_FLEE, ST_SHAKEN, ST_WAVER, W_INCAP, W_MORTAL, W_INSTANT, W_DISABLE, clamp } from "./soldiers.js";
import { ARMS, ARM_BY_ID } from "./arms.js";
import { neighbours, applyOrder, DT, TICK } from "./world.js";
import { findPath } from "./path.js";
import { fell, knockDown, applyWound } from "./melee.js";
import { Z_TORSO, Z_THIGHS } from "./kit.js";
import { fire as fireMissile, solve } from "./ballistics.js";
import { FEATURES } from "./terrain-types.js";
import { eachFeatureNear, pointSeg, gateGeom, GATE_PASSAGE, addFeature } from "./features.js";
import { BUILDINGS, RECRUITS } from "./econ-data.js";
import { ECON_DAYS_PER_REAL_SEC } from "./clock.js";
import { navSetBlock, segCells, cellOf } from "./navblock.js";
import * as EC from "./economy.js";
import { worksTick, worksOrder, WORK_ORDERS, cancelWorks, ensureWorks } from "./siege-works.js";
export { MINE, WORKS, startMine, startPost, startBarricade, startRepair, startGateFire, startSally, setProvisions, offerRespite, surrender, yieldHazard, foodDays, garrison, worksInfo, barricadeInfo, insideWalls } from "./siege-works.js";
export const moduleState = (b, k) => b.mstate?.[k] ?? 0; // 0 intact, 1 pocked, 2 cracked, 3 breach (MOD_STATES)

const EDT = TICK * ECON_DAYS_PER_REAL_SEC;   // econ days per tick (structural work)
const G = 9.81;

// ─────────────────────────────────────────────────────────────── the engines (siege-research.md §1–4)
// stone: kg; R: [min, max] range m; sig: dispersion [long, lat] as (a·R + b) m for a settled crew;
// throwsPerDay: real throws per econ day (a working day of ~10–12 h); visS: seconds between VISIBLE throws
// (the tactical rate); menP: chance a visible stone is the real one that lands among the men (throws per
// real second ÷ visible throws per second, capped at 1); hp: timber structure (kJ-equivalents, see STRUCT);
// flam: how readily it catches (wet hides on the ram and tower); crewMin: below this it cannot work.
export const ENG = {
  // pack: man-days to frame it up on site from the carted parts (packed engines travel at PACKED_V on carts)
  trebuchet:   { pack: 90, stone: 90, R: [120, 230], sig: [[0.018, 1.0], [0.007, 0.5]], throwsPerDay: 30, visS: 24, menP: 24 / 1440, hp: 400, flam: 0.8, crewMin: 6, ammo: 60, H: 6.5, slow: 0.8 },
  mangonel:    { pack: 12, stone: 8, R: [30, 110], sig: [[0.05, 1.0], [0.025, 0.5]], throwsPerDay: 1800, visS: 20, menP: 1, hp: 120, flam: 1, crewMin: 8, setupS: 60, ammo: 500, H: 3.5 },
  springald:   { bolt: true, R: [10, 300], throwsPerDay: 0, visS: 45, menP: 1, hp: 60, flam: 1, crewMin: 2, ammo: 40, H: 1.5 },
  ram:         { pack: 20, swingE: 4, swingsPerDay: 3600, visS: 3, hp: 250, flam: 0.3, crewMin: 6, H: 3 },
  siege_tower: { pack: 60, hp: 500, flam: 0.4, crewMin: 8, bridgeH: 7.5, H: 11 },
  mantlet:     { hp: 40, flam: 0.7, crewMin: 1, cover: 0.85, H: 2 },
};
// Structural resistance (siege-research.md §6). A projectile of energy E (kJ) does max(0, E − E0) of work on
// what it hits; W kJ of it breaches one 6 m module of wall (or breaks a gate's leaves, or wrecks a building
// or an engine). The ram's blows are judged against its own E0/W: a timber gate yields to a ram in hours,
// masonry hardly at all.
export const STRUCT = {
  palisade:   { shot: [1, 350], ram: [0.5, 500], H: 3.5, th: 0.3 },
  stone_wall: { shot: [20, 7000], ram: [3.5, 60000], H: 6, th: 1.5 },
  gate:       { shot: [2, 1500], ram: [1, 6000], H: 4, th: 0.6 },
  gatehouse:  { shot: [20, 20000], ram: [2, 28000], H: 8, th: 0.8 },   // leaves 8/28 of it, the portcullis the rest (GATE_LEAVES)
  tower:      { shot: [20, 20000], ram: [4, 200000], H: 12, th: 3 },  // a mural tower as one piece: 3 m walls, round faces deflect (research §9)
  timber:     { shot: [0.5, 0], ram: [0.5, 0], H: 5 },   // W = 0.4 kJ per hp (a house, 300 hp: two trebuchet stones)
  stone:      { shot: [15, 0], ram: [3, 0], H: 8 },      // W = 3 kJ per hp
  engine:     { shot: [0.5, 0], ram: [0.5, 0], H: 3 },    // W = hp
};
const GATE_LEAVES = { gate: 1, gatehouse: 8 / 28 }; // share of a gate's W in its leaves; the rest is the portcullis
const PACKED_V = 1.0; // m/s: a train of ox- and horse-carts on the road (economy-research §4: 0.8–1.1)
const LAD = { perMen: 8, max: 10, timber: 35, improviseS: 60, raiseS: 15, spacing: 3, repBase: 0.5, pushOff: 0.25, rally: 25, towerRep: 0.4, towerClimbS: 3,
  maxH: 12, towerMax: 3, longS: 1.3, longRep: 1.3 }; // (maxH: the highest top a long ladder reaches; longS/longRep: the long ladder's slower climb and readier fall)
export { LAD };

// ─────────────────────────────────────────────────────────────── state
export function ensureSiege(w) {
  if (w.siege) return w.siege;
  w.siege = { engines: [], shots: [], impacts: [], ladders: [], nextId: 1, prev: null, bar: null, barVer: -1, cover, arrow: onArrow, stats: { thrown: 0, visible: 0, menHit: 0, breaches: 0, climbed: 0, repulsed: 0, fell: 0, burnt: 0, captured: 0 } };
  w.siegeOrder = onOrder;
  ensureWorks(w);
  return w.siege;
}
export const engineOf = (w, u) => (u && u.engine !== undefined && w.siege) ? w.siege.engines.find((e) => e.id === u.engine) || null : null;
export const engineById = (w, id) => w.siege?.engines.find((e) => e.id === id) || null;

// A newly mustered crew (economy.js buildingTick): its engine is built with them
export function engineMustered(w, u, b) { return makeEngine(w, u, u.arm); }
export function makeEngine(w, u, kind, { state } = {}) {
  const Z = ensureSiege(w), D = ENG[kind]; if (!D) return null;
  const e = {
    id: Z.nextId++, kind, team: u.team, unit: u.id, x: u.ax, y: u.ay, facing: u.facing + Math.PI / 2,
    state: state || (D.pack ? "packed" : "ready"), prog: D.pack && !state ? 0 : 1,
    hp: D.hp, hpMax: D.hp, fire: 0, ammo: D.ammo ?? 0, tgt: null, nextVis: 0, lastShot: -99, swingT: -99,
    setupT: 0, still: 0, conv: 0, hitF: 0, work: 0, bridge: 0, docked: null, carts: kind === "trebuchet" ? (RECRUITS.trebuchet.gear.carts || 0) : 0,
  };
  u.engine = e.id; u.formation = "line"; u.slotCache = null;
  Z.engines.push(e);
  return e;
}

// ─────────────────────────────────────────────────────────────── orders
// order kinds: bombard (trebuchet/mangonel: a wall, gate, building, engine or ground), batter (ram), advance
// (tower to the wall), assemble (packed trebuchet: frame it up here), escalade (foot: take ladders to the
// wall), crew (any foot: man the engine there). Engines given an ordinary move go there (if they can move).
function onOrder(w, u, o) {
  if (o.raw) return false;
  ensureSiege(w);
  if (WORK_ORDERS.has(o.kind)) return worksOrder(w, u, o);
  if (u.works) cancelWorks(w, u);
  if (o.kind === "escalade") { if (!engineOf(w, u)) startEscalade(w, u, o); return true; }
  if (o.kind === "crew") { crewOrder(w, u, o); return true; }
  const e = engineOf(w, u);
  if (!e) return o.kind === "bombard" || o.kind === "batter" || o.kind === "advance" || o.kind === "assemble"; // not an engine: nothing to do
  const fixed = (e.kind === "trebuchet" && e.state !== "packed") || e.state === "assembling";
  u.order = { ...o }; u.orderT = w.time;
  if (o.kind === "assemble") {
    if (e.state !== "packed") return true;
    e.assembleAt = { x: o.x, y: o.y, facing: o.facing };
    goTo(w, u, o.x, o.y, o.facing);
    return true;
  }
  if (o.kind === "bombard") {
    if ((e.kind !== "trebuchet" && e.kind !== "mangonel" && e.kind !== "springald") || e.state === "packed") return true;
    const t = pickTarget(w, e, o);
    e.tgt = t; e.conv = 0; e.hitF = 0; e.tgtOrdered = true;
    if (!t) return true;
    const g = tgtGeom(w, t); const d = Math.hypot(g.x - e.x, g.y - e.y), D = ENG[e.kind];
    if ((d > D.R[1] * 0.97 || d < D.R[0]) && !fixed && e.state !== "packed") { // bring it into range
      const want = clamp(d, D.R[0] * 1.1, D.R[1] * 0.85), ux = (e.x - g.x) / (d || 1), uy = (e.y - g.y) / (d || 1);
      goTo(w, u, g.x + ux * want, g.y + uy * want, Math.atan2(-uy, -ux));
    } else if (d > D.R[1] * 0.97 || d < D.R[0]) w.events.push({ t: w.tick, kind: "engine-out-of-range", team: e.team, engine: e.id, d: Math.round(d) });
    return true;
  }
  if (o.kind === "batter") {
    if (e.kind !== "ram" || e.state !== "ready") return true;
    const t = pickTarget(w, e, o, true); e.tgt = t; if (!t) return true;
    const g = tgtGeom(w, t), side = sideNormal(g, e.x, e.y), L = ARMS.ram.eng[1] / 2 + 0.8;
    const fx = g.x + side[0] * L, fy = g.y + side[1] * L;
    directTo(w, u, fx, fy, Math.atan2(-side[1], -side[0]), g.x + side[0] * 25, g.y + side[1] * 25);
    return true;
  }
  if (o.kind === "advance") {
    if (e.kind !== "siege_tower" || e.state !== "ready") return true;
    const f = wallAt(w, o.x, o.y, 40, u.team); if (!f) return true;
    const P = closest(f, o.x, o.y), n = normalToward(f, e.x, e.y), L = ARMS.siege_tower.eng[1] / 2 + 0.6;
    e.tgt = { kind: "wall", f, x: P[0], y: P[1] }; e.docked = null; e.bridge = 0;
    directTo(w, u, P[0] + n[0] * L, P[1] + n[1] * L, Math.atan2(-n[1], -n[0]), P[0] + n[0] * 30, P[1] + n[1] * 30);
    return true;
  }
  // an ordinary order (move, hold, assault …)
  if (fixed) { w.events.push({ t: w.tick, kind: "engine-fixed", team: e.team, engine: e.id }); return true; }
  if (e.state === "burnt") return false;
  e.tgt = null; e.tgtOrdered = false; e.docked = null; e.bridge = 0; e.setupT = 0;
  if (o.kind === "assault" || o.kind === "charge") { goTo(w, u, o.x, o.y, o.facing); return true; } // crews do not charge with their engine
  return false;
}
// pathed move (applyOrder with the hook bypassed), keeping the siege order on the unit
function goTo(w, u, x, y, facing) { const keep = u.order; applyOrder(w, u, { kind: "move", x, y, facing, raw: true, pace: "march" }); if (keep && keep.kind !== "move") u.order = keep; }
// straight at the wall: nav cells at a wall are closed, so the last stretch is walked directly
function directTo(w, u, x, y, facing, sx, sy) {
  const keep = u.order;
  applyOrder(w, u, { kind: "move", x: sx, y: sy, facing, raw: true, pace: "march" });
  u.path = (u.path || []).concat([[x, y]]); u.finalFacing = facing - 0; u.order = keep;
}

function crewOrder(w, u, o) {
  const Z = w.siege; let best = null, bd = 30;
  for (const e of Z.engines) { if (e.state === "burnt" || (e.unit !== null && w.units.get(e.unit)?.members.length) || (e.team !== u.team && !e.abandoned)) continue; const d = Math.hypot(e.x - o.x, e.y - o.y); if (d < bd) { bd = d; best = e; } }
  if (!best || ARMS[u.arm].mounted || ARMS[u.arm].engine || u.isWorkers) return;
  u.crewFor = best.id; goTo(w, u, best.x, best.y);
}

// ─────────────────────────────────────────────────────────────── targets and their geometry
const WALLISH = new Set(["palisade", "stone_wall"]);
export const isGate = (b) => b.kind === "gate" || b.kind === "gatehouse";
function structOf(t) {
  if (t.kind === "eng") return STRUCT.engine;
  const b = t.b;
  if (b.tower) return STRUCT.tower;
  if (STRUCT[b.kind]) return STRUCT[b.kind];
  return BUILDINGS[b.kind]?.stone ? STRUCT.stone : STRUCT.timber;
}
function structW(t, S, ram) {
  const w = (ram ? S.ram : S.shot)[1]; if (w) return t.kind === "mod" && t.b.thickMul ? w * t.b.thickMul : w; // (a castle curtain thicker than a town wall takes proportionally more)
  if (t.kind === "eng") return t.e.hpMax;
  return t.b.hpMax * (S === STRUCT.stone ? 3 : 0.4);
}
// nearest enemy structure to a point: a wall module, a gate, a building, an enemy engine
export function pickTarget(w, e, o, ramOnly = false) {
  const x = o.x, y = o.y; let best = null, bd = ramOnly ? 30 : 45;
  if (o.bid !== undefined) { const b = w.buildings.find((q) => q.id === o.bid); if (b && !b.ruin) return targetFor(w, b, x, y, o.k); }
  for (const b of w.buildings) {
    if (b.team === e.team || b.ruin || b.field || (b.progress ?? 1) < 0.5) continue;
    if (ramOnly && !WALLISH.has(b.kind) && !isGate(b) && !isTowerB(w, b)) continue;
    let d;
    if (isTowerB(w, b)) d = Math.hypot(b.x - x, b.y - y) - towerR(w, b);
    else if (b.x1 !== undefined) d = pointSeg(x, y, b.x1, b.y1, b.x2, b.y2);
    else if (isGate(b)) { const g = gateGeom(b); d = Math.hypot(g.px - x, g.py - y) - 3; }
    else d = Math.hypot(b.x - x, b.y - y) - Math.max(...(BUILDINGS[b.kind]?.footprint || [8])) / 2;
    if (d < bd) { bd = d; best = b; }
  }
  if (!ramOnly) for (const q of w.siege.engines) { if (q.team === e.team || q.state === "burnt") continue; const d = Math.hypot(q.x - x, q.y - y) - 3; if (d < bd) { bd = d; best = { eng: q }; } }
  if (best?.eng) return { kind: "eng", e: best.eng };
  if (best) return targetFor(w, best, x, y);
  return ramOnly ? null : { kind: "pt", x, y };
}
export function targetFor(w, b, x, y, kWanted) {
  if (isTowerB(w, b)) return { kind: "mod", b, k: 0 };
  if (b.thickMul === undefined && b.x1 !== undefined) { const P = partOf(w, b), th = P?.thick ?? P?.thickness ?? P?.th; b.thickMul = th && STRUCT[b.kind]?.th ? Math.max(0.5, th / STRUCT[b.kind].th) : 0; } // a castle curtain's own thickness
  if (b.x1 !== undefined) { // the standing module nearest the point (or the one named)
    if (kWanted !== undefined && kWanted >= 0 && kWanted < EC.wallModules(b) && !(b.mods && b.mods[kWanted] <= 0)) return { kind: "mod", b, k: kWanted };
    const n = EC.wallModules(b), L = Math.hypot(b.x2 - b.x1, b.y2 - b.y1) || 1;
    const t = clamp(((x - b.x1) * (b.x2 - b.x1) + (y - b.y1) * (b.y2 - b.y1)) / (L * L), 0, 0.9999), k0 = Math.floor(t * n);
    let k = k0; for (let d = 0; d < n; d++) { const a = k0 + d, c = k0 - d; if (a < n && !(b.mods && b.mods[a] <= 0)) { k = a; break; } if (c >= 0 && !(b.mods && b.mods[c] <= 0)) { k = c; break; } }
    return { kind: "mod", b, k };
  }
  return { kind: "b", b };
}
// aim point, the line (walls, gates) or box (buildings) that a stone must strike, and its height
export function tgtGeom(w, t) {
  if (t.kind === "mod" && t.b.x1 === undefined) { const r = towerR(w, t.b), S = STRUCT.tower; return { x: t.b.x, y: t.b.y, rot: 0, hw: r, hh: r, r, half: r, th: S.th, H: partOf(w, t.b)?.h || S.H, tower: true }; }
  if (t.kind === "mod") {
    const b = t.b, n = EC.wallModules(b), dx = b.x2 - b.x1, dy = b.y2 - b.y1, L = Math.hypot(dx, dy) || 1, S = STRUCT[b.kind];
    const m = (t.k + 0.5) / n;
    const P = partOf(w, b), th = P?.thick ?? P?.thickness ?? P?.th ?? S.th, H = P?.height ?? P?.walkH ?? S.H;
    return { x: b.x1 + dx * m, y: b.y1 + dy * m, ux: dx / L, uy: dy / L, half: L / n / 2, th, H, line: true };
  }
  if (t.kind === "b" && isGate(t.b)) { const g = gateGeom(t.b), S = STRUCT[t.b.kind]; return { x: g.px, y: g.py, ux: g.ux, uy: g.uy, half: GATE_PASSAGE + 1, th: S.th, H: S.H, line: true }; }
  if (t.kind === "b") { const fp = BUILDINGS[t.b.kind]?.footprint || [10, 8]; return { x: t.b.x, y: t.b.y, rot: t.b.rot || 0, hw: fp[0] / 2, hh: fp[1] / 2, H: structOf(t).H }; }
  if (t.kind === "eng") { const f = ARMS[t.e.kind].eng || [3, 3]; return { x: t.e.x, y: t.e.y, rot: t.e.facing, hw: f[1] / 2, hh: f[0] / 2, H: ENG[t.e.kind].H || 3 }; }
  if (t.kind === "wall") return { x: t.x, y: t.y };
  return { x: t.x, y: t.y, pt: true };
}
const alive = (t) => !(t.kind === "mod" && (t.b.ruin || (t.b.mods && t.b.mods[t.k] <= 0))) && !(t.kind === "b" && (t.b.ruin || (isGate(t.b) && t.b.gateBroken))) && !(t.kind === "eng" && t.e.state === "burnt");
function sideNormal(g, x, y) { // unit normal of a line target pointing toward (x, y)
  if (!g.line) { const d = Math.hypot(x - g.x, y - g.y) || 1; return [(x - g.x) / d, (y - g.y) / d]; }
  let nx = -g.uy, ny = g.ux; if ((x - g.x) * nx + (y - g.y) * ny < 0) { nx = -nx; ny = -ny; } return [nx, ny];
}

// Does a stone landing at (px, py), coming in along (ux, uy) at 45°, strike the target? A stone that would
// land just beyond a wall hits its face on the way down: the window runs H / tan α past the face.
function strikes(g, px, py, ux, uy) {
  if (g.pt) return false;
  if (g.line) {
    const along = (px - g.x) * g.ux + (py - g.y) * g.uy; if (Math.abs(along) > g.half) return false;
    const [nx, ny] = [-g.uy, g.ux]; let s = (px - g.x) * nx + (py - g.y) * ny, dir = ux * nx + uy * ny; // signed depth past the line, in the direction of flight
    if (dir < 0) { s = -s; dir = -dir; }
    return s >= -g.th / 2 && s <= g.th / 2 + g.H / Math.max(0.3, dir);
  }
  const c = Math.cos(g.rot), sn = Math.sin(g.rot);
  for (let k = 0; k <= 3; k++) { // the point and three points back up the last H metres of the fall
    const qx = px - ux * g.H * k / 3, qy = py - uy * g.H * k / 3, dx = qx - g.x, dy = qy - g.y;
    if (Math.abs(dx * c + dy * sn) <= g.hw && Math.abs(-dx * sn + dy * c) <= g.hh) return true;
  }
  return false;
}
function sigmaOf(e, R) {
  const D = ENG[e.kind], k = 1 + 1.5 * Math.exp(-e.conv / 2.5); // a crew "walks its shots in": the first few throws are wild
  return [(D.sig[0][0] * R + D.sig[0][1]) * k, (D.sig[1][0] * R + D.sig[1][1]) * k];
}
// share of throws that strike the target (Monte Carlo, 64 samples, deterministic hash so it costs no rng)
function hitFraction(e, g) {
  const R = Math.hypot(g.x - e.x, g.y - e.y) || 1, ux = (g.x - e.x) / R, uy = (g.y - e.y) / R, [sl, st] = sigmaOf(e, R);
  let hit = 0;
  for (let k = 0; k < 64; k++) {
    const a = gauss(k * 2 + 1, e.id), b = gauss(k * 2 + 2, e.id);
    const px = g.x + ux * a * sl - uy * b * st, py = g.y + uy * a * sl + ux * b * st;
    if (strikes(g, px, py, ux, uy)) hit++;
  }
  return hit / 64;
}
function gauss(i, j) { const h1 = hash(i * 7919 + j * 104729), h2 = hash(i * 3571 + j * 7057 + 1); return Math.sqrt(-2 * Math.log(Math.max(1e-6, h1))) * Math.cos(6.2831853 * h2); }
function hash(n) { let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; }

// structural work on a target (kJ above its threshold)
function workOn(w, e, t, kJ, ram = false) {
  if (kJ <= 0 || !alive(t)) return;
  const S = structOf(t), W = structW(t, S, ram);
  if (t.kind === "eng") { t.e.hp -= kJ / W * t.e.hpMax; if (t.e.hp <= 0) wreck(w, t.e, "smashed"); return; }
  const b = t.b;
  if (t.kind === "mod") {
    const n = nMods(b);
    if (!b.mods) { b.mods = new Float32Array(n).fill(b.hp / n); }
    const per = b.hpMax / n, dmg = kJ / W * per;
    b.mods[t.k] = Math.max(0, b.mods[t.k] - dmg); b.hp = Math.max(0, b.hp - dmg);
    if (b.mods[t.k] <= 0) breach(w, b, t.k, e, ram ? "ram" : "shot");
    else modState(w, b, t.k, e);
    return;
  }
  const dmg = kJ / W * b.hpMax;
  if (isGate(b)) { gateHit(w, b, kJ / W, ram ? "ram" : "shot", false, e?.team); return; } // the leaves, then the portcullis; the flanks stay up
  EC.damageBuilding(w, b, dmg, BUILDINGS[b.kind]?.flammable && ram === false && w.rng.next() < 0.002 ? 0.2 : 0);
}
export function breach(w, b, k, e, cause = "shot") {
  b.breachVer = (b.breachVer || 0) + 1; w.featuresVer = (w.featuresVer || 0) + 1; w.siege.stats.breaches++;
  const g = tgtGeom(w, { kind: "mod", b, k });
  modState(w, b, k, e);
  if (b.x1 === undefined) { // a tower: it falls entire
    b.hp = 0; if (BUILDINGS[b.kind]) EC.damageBuilding(w, b, 1); else { b.ruin = true; b.stage = "ruin"; }
    w.events.push({ t: w.tick, kind: "tower-collapsed", team: b.team, building: b.id, x: g.x, y: g.y, by: e?.team, cause });
    return;
  }
  w.events.push({ t: w.tick, kind: "wall-breached", team: b.team, building: b.id, x: g.x, y: g.y, by: e?.team, mod: k, cause });
  if ([...b.mods].every((v) => v <= 0)) { EC.damageBuilding(w, b, b.hp + 1); return; }
  EC.blockWall(w, b, true); // (re-closes only the intact modules' cells)
}
// DAMAGE STATES of a wall module or tower (castle-plan §2: the art has one piece per state): intact → pocked →
// cracked → breach. b.mstate[k] (0..3) is what the renderer swaps on; each change is a `wall-state` event.
export const MOD_STATES = ["intact", "pocked", "cracked", "breach"];
export const MOD_AT = { pocked: 0.75, cracked: 0.4 }; // share of the module's strength left (DESIGN: the face spalls first, then the core cracks)
export function modState(w, b, k, e) {
  if (!b.mods) return 0;
  const n = b.mods.length, per = b.hpMax / n, f = b.mods[k] / per;
  const st = f <= 0 ? 3 : f <= MOD_AT.cracked ? 2 : f <= MOD_AT.pocked ? 1 : 0;
  if (!b.mstate || b.mstate.length !== n) b.mstate = new Uint8Array(n);
  if (b.mstate[k] !== st) {
    const was = b.mstate[k]; b.mstate[k] = st;
    const g = tgtGeom(w, { kind: "mod", b, k });
    w.events.push({ t: w.tick, kind: "wall-state", team: b.team, building: b.id, mod: k, state: MOD_STATES[st], was: MOD_STATES[was], x: g.x, y: g.y, tower: b.x1 === undefined, by: e?.team });
  }
  return st;
}
export const nMods = (b) => b.x1 !== undefined ? EC.wallModules(b) : (b.mods?.length || 1);
export const modGeom = (w, b, k) => tgtGeom(w, { kind: "mod", b, k });
// a tower: a castle part of kind "tower" (castle.js), a building of kind "tower", or flagged b.tower
export function isTowerB(w, b) {
  if (b.tower) return true;
  if (b.kind === "tower" || partOf(w, b)?.kind === "tower") { b.tower = true; return true; }
  return false;
}
function towerR(w, b) { const p = partOf(w, b); return p?.r || (p?.w ? Math.max(p.w, p.h || p.w) / 2 : 0) || b.r || 4.5; }

// ─────────────────────────────────────────────────────────────── the gate: leaves, then the portcullis
// b.gl (the leaves) and b.gpc (the portcullis; a gatehouse has one, a timber gate none) run 1 → 0. The passage is
// open for good (b.gateBroken) when both are gone. The portcullis is DROPPED whenever the gate is shut against an
// enemy, and raised when the enemy is gone (or for a sally). b.hp follows them, so repairs (economy.js) restore them.
function hasPort(w, b) { const p = partOf(w, b); return p ? (p.portcullis ?? p.portcullises ?? 1) > 0 : b.kind === "gatehouse" || !!b.portcullis; }
function gateInit(w, b) { if (b.gl === undefined) { b.gl = 1; b.gpc = hasPort(w, b) ? 1 : 0; b.portDown = false; b.hpSeen = b.hp; } }
const leavesShare = (w, b) => hasPort(w, b) ? (GATE_LEAVES[b.kind] ?? GATE_LEAVES.gatehouse) : 1;
// frac: of the whole gate's strength (direct = false) or of the layer now being attacked (direct = true: fire)
export function gateHit(w, b, frac, cause, direct = false, by) {
  gateInit(w, b); if (b.gateBroken || frac <= 0) return;
  const fl = leavesShare(w, b);
  if (b.gl > 0) {
    b.gl -= direct ? frac : frac / fl;
    if (b.gl <= 0) { b.gl = 0; w.events.push({ t: w.tick, kind: "gate-leaves-broken", team: b.team, building: b.id, cause, by, portcullis: b.gpc > 0 }); }
  } else if (b.gpc > 0) {
    b.gpc -= direct ? frac * 0.2 : frac / Math.max(0.05, 1 - fl);
    if (b.gpc <= 0) { b.gpc = 0; w.events.push({ t: w.tick, kind: "portcullis-broken", team: b.team, building: b.id, cause, by }); }
  }
  b.hp = b.hpMax * (0.2 + 0.8 * (fl * b.gl + (1 - fl) * b.gpc)); b.hpSeen = b.hp;
  if (b.gl <= 0 && b.gpc <= 0) { b.gateBroken = true; b.shut = false; b.portDown = false; w.siege.stats.breaches++; setGateNav(w, b); w.events.push({ t: w.tick, kind: "gate-broken", team: b.team, building: b.id, by, cause }); }
}
// repairs raise b.hp (economy.js): new leaves are hung first, then the portcullis mended
function gateRepaired(w, b) {
  gateInit(w, b);
  if (!(b.hp > b.hpSeen + 1)) { b.hpSeen = Math.min(b.hpSeen, b.hp); return; }
  const fl = leavesShare(w, b), g = clamp((b.hp / b.hpMax - 0.2) / 0.8, 0, 1);
  b.gl = Math.min(1, g / fl); b.gpc = hasPort(w, b) ? clamp((g - b.gl * fl) / Math.max(0.05, 1 - fl), 0, 1) : 0; b.hpSeen = b.hp;
  if (b.gateBroken && (b.gl > 0.3)) { b.gateBroken = false; w.events.push({ t: w.tick, kind: "gate-repaired", team: b.team, building: b.id }); }
}

// ─────────────────────────────────────────────────────────────── castle.js (CASTLE-SIM) adapter
// The castle data (w.castles, parts with .bid) is read directly; the level/link API is called through castleCall so
// siege.js runs with or without castle.js (plan §1: addLink/removeLink, insideCastle, castleAt). useCastle(module)
// is called by whoever loads castle.js (main.js / siege-war.js / the harness); castle.js may also set w.castleApi.
let CS = null;
export function useCastle(mod) { CS = mod; }
export function castleCall(w, fn, ...a) {
  const f = CS?.[fn] || w.castleApi?.[fn];
  if (f) return f(w, ...a);
  if (fn === "addLink") { const c = castleById(w, a[0]); if (!c) return null; (c.links ||= []).push(a[1]); return a[1]; }
  if (fn === "removeLink") { const c = castleById(w, a[0]); if (!c?.links) return null; const k = c.links.indexOf(a[1]); if (k >= 0) c.links.splice(k, 1); return null; }
  return undefined;
}
const castleById = (w, c) => c && typeof c === "object" ? c : (w.castles || []).find((q) => q.id === c) || null;
export function partOf(w, b) {
  if (!w.castles || !w.castles.length) return null;
  const Z = w.siege || {}; if (!Z.partMap || Z.partVer !== w.castles.length + ":" + w.castles.reduce((s, c) => s + (c.parts?.length || 0), 0)) {
    Z.partMap = new Map(); Z.partVer = w.castles.length + ":" + w.castles.reduce((s, c) => s + (c.parts?.length || 0), 0);
    for (const c of w.castles) for (const p of c.parts || []) if (p.bid !== undefined) Z.partMap.set(p.bid, p);
    for (const c of w.castles) for (const p of c.parts || []) if (p.bid !== undefined) (Z.castleOfBid ||= new Map()).set(p.bid, c);
  }
  return Z.partMap.get(b.id) || null;
}
export const castleOfB = (w, b) => (partOf(w, b), w.siege?.castleOfBid?.get(b.id) || null);
export const levelOf = (w, i) => w.S.lvl ? w.S.lvl[i] : 0;
export const wallWalkLevel = (w, b, part = partOf(w, b)) => part?.walkLvl ?? part?.lvl ?? 1;

// ─────────────────────────────────────────────────────────────── the system
export function siegeSystem(w) {
  const Z = ensureSiege(w);
  if (w.tick % 25 === 7) gatesTick(w);
  for (const e of Z.engines) engineTick(w, e);
  for (const u of w.units.values()) { if (u.esc) escaladeTick(w, u); if (u.crewFor !== undefined) crewTick(w, u); }
  if (Z.climbH?.size && w.tick % 10 === 0) for (const i of Z.climbH.keys()) { const u = w.units.get(w.S.unit[i]); if (!u?.esc || !u.esc.lads.some((L) => L.climber === i)) Z.climbH.delete(i); } // (an escalade ended under him)
  if (w.tick % 5 === 0) Z.ladders = collectLadders(w);
  shotsTick(w);
  worksTick(w);
  barrierResolve(w);
}

// ── crews: who is at the engine and able to work it
function crewOf(w, e) {
  const u = e.unit !== null ? w.units.get(e.unit) : null; if (!u || !u.members.length) return { u: null, n: 0, f: 0 };
  const S = w.S; let n = 0;
  for (const id of u.members) if (S.alive[id] && S.state[id] !== S_FLEE && S.status[id] < ST_FLEE && Math.abs(S.x[id] - e.x) < 14 && Math.abs(S.y[id] - e.y) < 14) n++;
  const full = RECRUITS[e.kind]?.crew || 4;
  return { u, n, f: n < ENG[e.kind].crewMin ? 0 : Math.min(1, n / full) };
}

function engineTick(w, e) {
  const D = ENG[e.kind], S = w.S, t = w.time;
  if (e.state === "burnt") return;
  const c = crewOf(w, e), u = c.u;
  // abandoned / captured
  if (!u) {
    if (!e.abandoned) { e.abandoned = true; e.unit = null; w.events.push({ t: w.tick, kind: "engine-abandoned", team: e.team, engine: e.id, what: e.kind }); }
    if (w.tick % 10 === 0) captureCheck(w, e);
  } else {
    e.abandoned = false;
    // the engine rides on its crew's anchor (a fixed engine holds its crew's anchor on itself)
    const fixed = (e.kind === "trebuchet" && e.state !== "packed") || e.state === "assembling";
    const setUp = e.kind === "mangonel" && e.setupT >= D.setupS;
    u.speedMul = fixed ? 0 : e.state === "packed" ? PACKED_V / ARMS[e.kind].speed : setUp && e.tgt ? 0 : 1;
    if (fixed) { u.ax = e.x; u.ay = e.y; u.path = null; }
    else {
      const moved = Math.hypot(u.ax - e.x, u.ay - e.y);
      e.x = u.ax; e.y = u.ay;
      if (moved > 0.01) { e.facing = u.facing + Math.PI / 2; e.still = 0; e.roll = (e.roll || 0) + moved; if (e.kind === "mangonel") e.setupT = 0; }
      else e.still += DT;
      if (e.kind === "mangonel" && e.still > 1 && e.tgt) e.setupT += DT;
    }
    u.moving && (e.lastMove = t);
  }
  // fire (battle clock)
  fireTick(w, e, c);
  if (e.state === "burnt" || !u) return;
  // packed engine → assembling where ordered, once it has arrived
  if (D.pack) {
    if (e.state === "packed" && e.assembleAt && !u.path && Math.hypot(u.ax - e.assembleAt.x, u.ay - e.assembleAt.y) < 12) {
      e.state = "assembling"; e.prog = 0; e.baseFacing = e.assembleAt.facing ?? e.facing; e.facing = e.baseFacing; u.facing = e.facing - Math.PI / 2;
      w.events.push({ t: w.tick, kind: "engine-assembling", team: e.team, engine: e.id });
    }
    if (e.state === "assembling") {
      // framing up: the crew's man-days on the econ clock (carpenters at full rate, labourers at 0.6)
      const T = w.teams[e.team];
      e.prog = Math.min(1, e.prog + c.n * (T.eff || 0.8) * EDT / D.pack);
      for (const id of u.members) if (S.alive[id] && S.state[id] !== S_FIGHT && S.state[id] !== S_FLEE) S.state[id] = S_WORK;
      if (e.prog >= 1) { e.state = "ready"; if (e.carts && T.store) { EC.give(T, "carts", e.carts); e.carts = 0; } w.events.push({ t: w.tick, kind: "engine-ready", team: e.team, engine: e.id }); }
      return;
    }
    if (e.state === "packed") return;
  }
  // ammunition comes up from the store (carted), or is gathered and dressed on the spot at half the rate
  resupply(w, e);
  if (e.kind === "trebuchet" || e.kind === "mangonel") return thrower(w, e, c);
  if (e.kind === "springald") return springald(w, e, c);
  if (e.kind === "ram") return ram(w, e, c);
  if (e.kind === "siege_tower") return tower(w, e, c);
}

function resupply(w, e) {
  const D = ENG[e.kind], T = w.teams[e.team]; if (!D.ammo || e.ammo >= D.ammo || w.tick % 10) return;
  const per = D.throwsPerDay || 40, add = per * 1.2 * EDT * 10;
  if (e.kind === "springald") { if (T.store && T.store.bolts >= 4) { const n = Math.min(D.ammo - e.ammo, add); EC.take(T, "bolts", n * 4); e.ammo += n; } return; }
  const kg = D.stone * add, fromStore = T.store && !T.besieged && T.store.stone >= kg;
  if (fromStore) EC.take(T, "stone", kg);
  e.ammo = Math.min(D.ammo, e.ammo + add * (fromStore ? 1 : 0.5));
}

// ── trebuchet / mangonel
function thrower(w, e, c) {
  const D = ENG[e.kind], t = w.time, u = c.u;
  if (e.tgt && !alive(e.tgt)) {
    // a module down: the master engineer widens the breach, laying on the next standing module of that stretch
    const next = e.tgt.kind === "mod" && !e.tgt.b.ruin && e.tgt.b.x1 !== undefined ? targetFor(w, e.tgt.b, tgtGeom(w, e.tgt).x, tgtGeom(w, e.tgt).y) : null;
    w.events.push({ t: w.tick, kind: "engine-target-down", team: e.team, engine: e.id });
    e.tgt = next && alive(next) ? next : null; e.hitAt = 0; if (!e.tgt) e.tgtOrdered = false;
  }
  if (!e.tgt && e.kind === "mangonel" && w.tick % 20 === e.id % 20) e.tgt = autoTarget(w, e);
  if (!e.tgt || c.f <= 0) { e.status = !e.tgt ? "no target" : "no crew"; return; }
  if (e.kind === "mangonel" && e.setupT < D.setupS) { e.status = u.moving ? "moving" : "setting up"; return; }
  const g = tgtGeom(w, e.tgt);
  const R = Math.hypot(g.x - e.x, g.y - e.y);
  if (R > D.R[1] || R < D.R[0]) { e.status = "out of range"; return; }
  // lay the engine on the target (a fixed trebuchet turns only within its frame's arc)
  let want = Math.atan2(g.y - e.y, g.x - e.x);
  if (e.kind === "trebuchet") { const off = angDiff(want, e.baseFacing); if (Math.abs(off) > 0.35) { e.status = "outside its arc"; return; } }
  e.facing = turn(e.facing, want, 0.02); u.facing = e.facing - Math.PI / 2; u.finalFacing = e.facing;
  if (Math.abs(angDiff(e.facing, want)) > 0.05) { e.status = "laying"; return; }
  if (e.ammo < 1) { e.status = "no stones"; return; }
  e.status = "shooting";
  // structural work, continuous at the real rate (econ clock): E at this range (45° throw, E ∝ R)
  const v = Math.sqrt(R * G), E = 0.5 * D.stone * v * v / 1000;
  if (e.tgt.kind !== "pt") {
    if (!e.hitAt || w.tick - e.hitAt > 50) { e.hitF = hitFraction(e, g); e.hitAt = w.tick; }
    const S = structOf(e.tgt), thr = D.throwsPerDay * c.f * engCond(e) * EDT;
    workOn(w, e, e.tgt, thr * e.hitF * Math.max(0, E - S.shot[0]));
    e.ammo = Math.max(0, e.ammo - thr); w.siege.stats.thrown += thr;
    e.conv += thr;
  }
  // the visible throw, at the tactical rate
  if (t >= e.nextVis) {
    e.nextVis = t + D.visS / Math.max(0.35, c.f * engCond(e)) * w.rng.range(0.85, 1.15);
    e.lastShot = t;
    launchStone(w, e, g, R, v, E);
    if (e.tgt.kind === "pt") { e.ammo = Math.max(0, e.ammo - 1); e.conv += 1; }
  }
}
function launchStone(w, e, g, R, v, E) {
  const D = ENG[e.kind], rng = w.rng, [sl, st] = sigmaOf(e, R);
  const ux = (g.x - e.x) / (R || 1), uy = (g.y - e.y) / (R || 1);
  const a = rng.normal(0, 1), b = rng.normal(0, 1);
  const px = g.x + ux * a * sl - uy * b * st, py = g.y + uy * a * sl + ux * b * st;
  const hitStruct = strikes(g, px, py, ux, uy);
  // where it comes down: on the wall face, or on the ground
  let lx = px, ly = py, lh = w.map.h(px, py);
  if (hitStruct && g.line) { const n = sideNormal(g, e.x, e.y); const s = (px - g.x) * n[0] + (py - g.y) * n[1]; lx = px - n[0] * (s - g.th / 2); ly = py - n[1] * (s - g.th / 2); lh = w.map.h(lx, ly) + Math.min(g.H, Math.max(0.5, (s - g.th / 2))); }
  const tof = 2 * v * Math.SQRT1_2 / G;
  const h0 = w.map.h(e.x, e.y) + (e.kind === "trebuchet" ? 9 : 5);
  w.siege.shots.push({ kind: "stone", big: e.kind === "trebuchet", x0: e.x + ux * 2, y0: e.y + uy * 2, h0, x1: lx, y1: ly, h1: lh, t0: w.time, t1: w.time + tof, apex: v * v / (4 * G), team: e.team, E, ux, uy, onStruct: hitStruct, tgt: e.tgt, by: e.id, men: rng.next() < D.menP });
  w.siege.stats.visible++;
}

// a mangonel without orders shoots at the enemy's engines, then at bodies of men massed in range
function autoTarget(w, e) {
  const D = ENG[e.kind]; let best = null, bs = -1e9;
  for (const q of w.siege.engines) { if (q.team === e.team || q.state === "burnt") continue; const d = Math.hypot(q.x - e.x, q.y - e.y); if (d < D.R[0] || d > D.R[1] * 0.97) continue; const s = 300 - d; if (s > bs) { bs = s; best = { kind: "eng", e: q }; } }
  if (best) return best;
  for (const v of w.units.values()) {
    if (v.team === e.team || !v.members.length || v.isWorkers || v.c?.broken) continue;
    const d = Math.hypot(v.ax - e.x, v.ay - e.y); if (d < D.R[0] || d > D.R[1] * 0.97) continue;
    const s = v.members.length - d * 0.3; if (s > bs && v.members.length >= 8) { bs = s; best = { kind: "pt", x: v.ax, y: v.ay, unit: v.id }; }
  }
  return best;
}

// ── springald: quarrels at men, the nearest body in range (enemy crews first: counter-battery)
function springald(w, e, c) {
  const D = ENG.springald, t = w.time, u = c.u, S = w.S;
  if (c.f <= 0) { e.status = "no crew"; return; }
  if (u.moving) { e.status = "moving"; return; }
  if (e.ammo < 1) { e.status = "no quarrels"; return; }
  if (!e.aimT || t - e.aimT > 3) {
    e.aimT = t; e.aimU = null; let bs = -1e9;
    const pref = e.tgt?.kind === "pt" ? e.tgt : null;
    for (const v of w.units.values()) {
      if (v.team === e.team || !v.members.length || v.c?.broken || v.isWorkers) continue;
      const vx = v.fx ?? v.ax, vy = v.fy ?? v.ay, d = Math.hypot(vx - e.x, vy - e.y);
      if (d > D.R[1] * 0.95 || d < D.R[0]) continue;
      if (!w.map.los(e.x, e.y, 2, vx, vy, 1.6)) continue;
      const s = -d + (ARMS[v.arm].engine ? 120 : 0) + (pref ? -Math.hypot(vx - pref.x, vy - pref.y) * 2 : 0);
      if (s > bs) { bs = s; e.aimU = v.id; }
    }
  }
  const tu = e.aimU !== null && e.aimU !== undefined ? w.units.get(e.aimU) : null;
  if (!tu || !tu.members.length) { e.status = "no target"; return; }
  const want = Math.atan2(tu.ay - e.y, tu.ax - e.x);
  e.facing = turn(e.facing, want, 0.05); u.facing = e.facing - Math.PI / 2;
  e.status = "shooting";
  if (t < e.nextVis) return;
  const shooter = u.members.find((id) => S.alive[id] && S.state[id] !== S_FLEE); if (shooter === undefined) return;
  const tid = tu.members[(w.rng.next() * tu.members.length) | 0]; if (!S.alive[tid]) return;
  const cs = w.cs; if (!cs) return;
  S.ammo[shooter] = Math.max(S.ammo[shooter], 1);
  const R = Math.hypot(S.x[tid] - e.x, S.y[tid] - e.y), sol = solve("springald", R, w.map.h(e.x, e.y) - w.map.h(S.x[tid], S.y[tid]));
  // the quarrel leaves from the engine, not from the man at the windlass
  const sx = S.x[shooter], sy = S.y[shooter]; S.x[shooter] = e.x; S.y[shooter] = e.y;
  const ok = fireMissile(w, cs, shooter, "springald", S.x[tid], S.y[tid], S.vx[tid], S.vy[tid], tid);
  S.x[shooter] = sx; S.y[shooter] = sy;
  e.nextVis = t + D.visS / Math.max(0.35, c.f * engCond(e)) * w.rng.range(0.85, 1.15);
  if (!ok || !sol) return;
  const f = cs.flights[cs.flights.length - 1];
  e.ammo--; e.lastShot = t;
  w.siege.shots.push({ kind: "bolt", x0: e.x, y0: e.y, h0: w.map.h(e.x, e.y) + 1.4, x1: f.x, y1: f.y, h1: w.map.h(f.x, f.y) + 0.3, t0: t, t1: t + sol.t, apex: Math.tan(Math.max(0.02, sol.ang)) * R / 4, team: e.team });
  w.siege.stats.visible++;
}

// ── ram: pushed up to the face; while it lies against it, the crew swing it (econ-clock work)
function ram(w, e, c) {
  const D = ENG.ram, t = w.time, u = c.u;
  if (e.tgt && !alive(e.tgt)) { w.events.push({ t: w.tick, kind: "engine-target-down", team: e.team, engine: e.id }); e.tgt = null; }
  if (!e.tgt) { e.status = u.moving ? "moving" : "idle"; e.battering = false; return; }
  const g = tgtGeom(w, e.tgt), d = g.line ? pointSegD(e.x, e.y, g) : Math.hypot(g.x - e.x, g.y - e.y) - Math.max(g.hw || 3, g.hh || 3);
  const reach = ARMS.ram.eng[1] / 2 + 2;
  if (d > reach) { e.status = u.moving || u.path ? "advancing" : "short of the target"; e.battering = false; return; }
  if (c.f <= 0) { e.status = "no crew"; e.battering = false; return; }
  e.status = "battering"; e.battering = true;
  const S = structOf(e.tgt);
  workOn(w, e, e.tgt, D.swingsPerDay * c.f * engCond(e) * EDT * Math.max(0, D.swingE - S.ram[0]), true);
  if (t - e.swingT > D.visS / Math.max(0.4, c.f * engCond(e))) { e.swingT = t; if (w.rng.next() < 0.35) w.siege.impacts.push({ x: e.x + Math.cos(e.facing) * reach, y: e.y + Math.sin(e.facing) * reach, t, kind: "splinter", size: 1 }); }
}
const pointSegD = (x, y, g) => { const a = (x - g.x) * g.ux + (y - g.y) * g.uy, c = clamp(a, -g.half, g.half); return Math.hypot(x - (g.x + g.ux * c), y - (g.y + g.uy * c)); };

// ── tower: pushed to the wall; at the ditch its crew fill a causeway with fascines; docked, the bridge drops
function tower(w, e, c) {
  const t = w.time, u = c.u;
  if (!e.tgt || e.tgt.kind !== "wall") { e.status = u.moving ? "moving" : "idle"; return; }
  const f = rebind(w, e.tgt.f, e.tgt.x, e.tgt.y);
  if (!f) { e.status = "the wall is down"; e.tgt = null; e.docked = null; return; }
  e.tgt.f = f; if (e.docked) e.docked.f = f;
  if (e.docked) { e.bridge = Math.min(1, e.bridge + DT / 6); e.status = e.bridge >= 1 ? "bridge down" : "lowering the bridge"; u.speedMul = 0; return; }
  // the ditch before the wall: fill it first (fascines and earth, 2 min of the crew's work)
  if (!e.filled && w.tick % 5 === 0) {
    const hx = Math.cos(e.facing), hy = Math.sin(e.facing);
    let ditch = null; eachFeatureNear(w, e.x, e.y, e.x + hx * 5, e.y + hy * 5, 3, (q) => { if (q.type === "ditch" && pointSeg(e.x + hx * 4, e.y + hy * 4, q.x0, q.y0, q.x1, q.y1) < 2.5) { ditch = q; return true; } return false; });
    if (ditch) { e.filling = (e.filling || 0) + DT * 5 * c.f; e.status = "filling the ditch"; u.speedMul = 0; if (e.filling >= 120) { e.filled = true; u.speedMul = 1; } return; }
  }
  u.speedMul = 1;
  const d = pointSeg(e.x, e.y, f.x0, f.y0, f.x1, f.y1);
  if (d <= ARMS.siege_tower.eng[1] / 2 + 3.8 && c.f > 0) { // (its bridge, 4 m, spans what is left of the gap to the wall-walk)
    const n = normalToward(f, e.x, e.y), P = closest(f, e.x, e.y);
    e.docked = { f, x: P[0], y: P[1], nx: n[0], ny: n[1] }; e.bridge = 0; u.path = null;
    w.events.push({ t: w.tick, kind: "tower-docked", team: e.team, engine: e.id, x: P[0], y: P[1] });
    return;
  }
  e.status = u.moving || u.path ? "advancing" : "short of the wall";
}

// ── fire on an engine (battle clock)
function fireTick(w, e, c) {
  const D = ENG[e.kind], S = w.S;
  if (w.tick % 10 === e.id % 10) {
    // torches: enemy men standing at it (a sally, or the enemy come up to it)
    neighbours(w, e.x, e.y, 4, NB); let foes = 0, own = 0;
    for (const o of NB) { if (!S.alive[o] || S.status[o] >= ST_FLEE) continue; if (S.team[o] !== e.team) foes++; else own++; }
    if (foes && !own) e.fire = Math.max(e.fire, Math.min(1, e.fire + 0.03 * foes * D.flam));
    // pitch and fire-pots from the wall onto a ram or tower at its foot
    if ((e.kind === "ram" || e.kind === "siege_tower") && (e.battering || e.docked)) {
      neighbours(w, e.x, e.y, 9, NB); let def = 0;
      for (const o of NB) if (S.alive[o] && S.team[o] !== e.team && S.status[o] < ST_FLEE) def++;
      if (def && w.rng.next() < 0.03 * Math.min(6, def) * D.flam) e.fire = Math.max(e.fire, 0.15);
    }
  }
  if (e.fire <= 0) { // not burning: the crew's carpenters mend what the fire or the stones did (a day after it is out)
    if (e.hp < e.hpMax && c.f > 0 && w.time - (e.burnT ?? -1e9) > ENG_MEND_WAIT / ECON_DAYS_PER_REAL_SEC) e.hp = Math.min(e.hpMax, e.hp + e.hpMax * ENG_MEND * c.f * EDT);
    return;
  }
  e.burnT = w.time;
  e.fire = Math.min(1, e.fire + 0.004 * DT);
  if (c.f > 0 && !(e.harriedT > w.time)) e.fire = Math.max(0, e.fire - 0.012 * DT * Math.min(1, c.n / 4)); // the crew beat it out, throw water and earth on it (not while a sally is at them)
  e.hp -= e.hpMax / 240 * e.fire * DT;
  if (e.hp <= 0) wreck(w, e, "burnt");
}
const NB = [];
// A damaged engine works slower — a charred arm, a sprung frame, a sling rope replaced with whatever was to hand — and
// not at all while its crew are fighting a fire on it. 1 whole, ~0.58 at half its strength, ~0.28 near wrecked.
const ENG_MEND = 0.2, ENG_MEND_WAIT = 1; // share of hpMax the crew mend per econ day, from a day after the fire is out (DESIGN)
export const engCond = (e) => e.fire > 0.05 ? 0 : clamp(0.15 + 0.85 * e.hp / e.hpMax, 0, 1);
function wreck(w, e, how) {
  e.state = "burnt"; e.hp = 0; e.fire = 0; e.tgt = null; e.docked = null; w.siege.stats.burnt++;
  w.events.push({ t: w.tick, kind: "engine-destroyed", team: e.team, engine: e.id, what: e.kind, how });
  const u = e.unit !== null ? w.units.get(e.unit) : null;
  if (u) releaseCrew(w, u);
  e.unit = null;
}
// the crew of a lost engine fight on as a band of men (villager arm, their own weapons)
function releaseCrew(w, u) {
  const S = w.S; u.engine = undefined; u.speedMul = 1; u.arm = "villager"; u.slotCache = null; u.formation = "loose";
  for (const id of u.members) S.arm[id] = ARMS.villager.id;
}
function captureCheck(w, e) {
  const S = w.S; neighbours(w, e.x, e.y, 12, NB);
  let foe = -1, own = 0;
  for (const o of NB) { if (!S.alive[o] || S.status[o] >= ST_FLEE) continue; const d = Math.hypot(S.x[o] - e.x, S.y[o] - e.y); if (S.team[o] === e.team) own++; else if (d < 6) foe = S.team[o]; }
  if (foe >= 0 && !own) { e.team = foe; e.tgt = null; e.fire = 0; w.siege.stats.captured++; w.events.push({ t: w.tick, kind: "engine-captured", team: foe, engine: e.id, what: e.kind }); }
}
// a body ordered to man an engine: when it arrives, the men the engine needs join it as its crew
function crewTick(w, u) {
  const e = engineById(w, u.crewFor); if (!e || e.state === "burnt" || (e.unit !== null && w.units.get(e.unit)?.members.length)) { u.crewFor = undefined; return; }
  if (Math.hypot(u.ax - e.x, u.ay - e.y) > 10) return;
  const S = w.S, need = RECRUITS[e.kind]?.crew || 4;
  const ids = u.members.filter((id) => S.alive[id]).slice(0, need);
  u.crewFor = undefined; if (!ids.length) return;
  let nu = u;
  if (ids.length < u.members.length) { const set = new Set(ids); nu = { ...u, id: w.nextUnit++, members: ids.slice(), path: null, order: { kind: "hold" }, legendIds: [], slotCache: null, c: null, hold: false, crewFor: undefined }; for (const id of ids) S.unit[id] = nu.id; u.members = u.members.filter((id) => !set.has(id)); u.slotCache = null; w.units.set(nu.id, nu); }
  for (const id of nu.members) S.arm[id] = ARMS[e.kind].id;
  nu.arm = e.kind; nu.engine = e.id; nu.slotCache = null; nu.formation = "line"; nu.ax = e.x; nu.ay = e.y; nu.facing = e.facing - Math.PI / 2;
  e.unit = nu.id; e.team = nu.team; e.abandoned = false;
  w.events.push({ t: w.tick, kind: "engine-crewed", team: nu.team, engine: e.id, what: e.kind });
}

// ─────────────────────────────────────────────────────────────── shots: stones and quarrels in flight
function shotsTick(w) {
  const Z = w.siege, t = w.time;
  let j = 0;
  for (const s of Z.shots) {
    if (s.t1 > t) { Z.shots[j++] = s; continue; }
    if (s.kind === "stone") stoneLands(w, s);
    Z.impacts.push({ x: s.x1, y: s.y1, h: s.h1, t, kind: s.kind === "bolt" ? "bolt" : s.onStruct ? "debris" : "dust", size: s.big ? 2.2 : 1 });
  }
  Z.shots.length = j;
  if (Z.impacts.length > 80) Z.impacts.splice(0, Z.impacts.length - 80);
  for (let k = Z.impacts.length - 1; k >= 0; k--) if (t - Z.impacts[k].t > 12) Z.impacts.splice(k, 1);
}
// A stone among men: it kills or maims whoever it strikes, bounding on along its line (a big stone ~10 m, a
// mangonel's ~4 m) until it has struck two; everyone near it is shaken. On a wall it sweeps the wall-walk.
function stoneLands(w, s) {
  const S = w.S, cs = w.cs; if (!cs) return;
  neighbours(w, s.x1, s.y1, 10, NB);
  for (const o of NB) { if (!S.alive[o] || S.status[o] >= ST_FLEE) continue; S.stress[o] += (s.big ? 0.05 : 0.02) * (1.3 - S.courage[o]); }
  if (!s.men) return;
  const L = s.big ? 10 : 4, hits = [];
  for (const o of NB) {
    if (!S.alive[o] || S.state[o] === S_CAPT) continue;
    const dx = S.x[o] - s.x1, dy = S.y[o] - s.y1;
    if (s.onStruct) { if (dx * dx + dy * dy < 2.2 * 2.2 && w.rng.next() < 0.45) hits.push([0, o]); continue; }
    const along = dx * s.ux + dy * s.uy, lat = Math.abs(-dx * s.uy + dy * s.ux);
    if (along < -0.5 || along > L || lat > (s.big ? 0.75 : 0.5)) continue;
    hits.push([along, o]);
  }
  hits.sort((a, b) => a[0] - b[0]);
  const struck = new Set();
  hits.slice(0, 2).forEach(([, o], k) => {
    const r = w.rng.next(), sev = r < 0.55 ? W_INSTANT : r < 0.85 ? W_MORTAL : W_INCAP;
    w.events.push({ t: w.tick, kind: "stoned", who: o, x: s.x1, y: s.y1, ux: s.ux, uy: s.uy, first: k === 0, big: !!s.big }); // (animation: driven flat / flung)
    fell(cs.ctx, o, -1, sev, "stone"); w.siege.stats.menHit++; struck.add(o);
  });
  // (the battle-feel brief §5, Stirling skeleton 150: a stone that lands among men does not stop at the first two —
  // it skips and rolls, and the men beside its path are THROWN: knocked flying away from it, sometimes broken)
  if (s.onStruct) return;
  const R = s.big ? SIEGE_THROW.bigR : SIEGE_THROW.smallR;
  for (const o of NB) {
    if (struck.has(o) || !S.alive[o] || S.state[o] === S_CAPT || S.horseOK[o] === 1) continue;
    const dx = S.x[o] - s.x1, dy = S.y[o] - s.y1, d = Math.hypot(dx, dy); if (d > R) continue;
    const along = dx * s.ux + dy * s.uy; if (along < -1) continue; // (behind where it struck: spattered, not thrown)
    const k = 1 - d / R, speed = SIEGE_THROW.speed * k * (s.big ? 1 : 0.6), hx = (dx / (d || 1) + s.ux) / 2, hy = (dy / (d || 1) + s.uy) / 2, hl = Math.hypot(hx, hy) || 1;
    if (w.rng.next() > 0.35 + 0.6 * k) continue;
    S.x[o] += hx / hl * speed * 0.35; S.y[o] += hy / hl * speed * 0.35; // (the throw itself: up to ~2 m)
    w.events.push({ t: w.tick, kind: "thrown", who: o, dx: hx / hl, dy: hy / hl, speed });
    knockDown(cs.ctx, o, 1, -1, "stone");
    S.upT[o] = Math.max(S.upT[o], w.time + 3 + 6 * k); S.stunT[o] = Math.max(S.stunT[o], w.time + 2 * k);
    const r = w.rng.next();
    if (r < SIEGE_THROW.hurt * k) applyWound(cs.ctx, o, -1, r < SIEGE_THROW.hurt * k * 0.4 ? W_INCAP : W_DISABLE, r < 0.5 * SIEGE_THROW.hurt * k ? Z_TORSO : Z_THIGHS, "stone");
  }
  // and everyone who saw it: a big stone among men is the most frightening thing on a field
  if (s.big) for (const o of NB) { if (!S.alive[o] || S.status[o] >= ST_FLEE) continue; const d = Math.hypot(S.x[o] - s.x1, S.y[o] - s.y1); S.stress[o] += SIEGE_THROW.fear * Math.max(0, 1 - d / 10) * (1.3 - S.courage[o]); }
}
const SIEGE_THROW = { bigR: 4, smallR: 2, speed: 6, hurt: 0.35, fear: 0.08 }; // DESIGN: m around the impact men are thrown; m/s at the centre; P(broken) at the centre; extra fear for a big stone

// ─────────────────────────────────────────────────────────────── cover and fire arrows (ballistics.land hooks)
// hard cover a man gets from engines standing between him and an arrow: a mantlet before him, a ram's roof
// over him. Returns P(stopped).
function cover(w, i, f) {
  const Z = w.siege, S = w.S; if (!Z.engines.length) return 0;
  const x = S.x[i], y = S.y[i];
  for (const e of Z.engines) {
    if (e.state === "burnt" || e.team !== S.team[i]) continue;
    const dx = x - e.x, dy = y - e.y; if (dx * dx + dy * dy > 64) continue;
    const c = Math.cos(e.facing), sn = Math.sin(e.facing), fwd = dx * c + dy * sn, lat = -dx * sn + dy * c;
    if (e.kind === "mantlet") {
      if (fwd < -4 || fwd > 0.2 || Math.abs(lat) > ARMS.mantlet.eng[0] / 2 + 0.4) continue;
      if (f.ux * c + f.uy * sn < -0.2) return ENG.mantlet.cover * (f.ang < 0.5 ? 1 : 0.6); // shafts coming from before the screen (a plunging one may clear it)
    } else if (e.kind === "ram" || e.kind === "siege_tower") {
      const [ew, el] = ARMS[e.kind].eng;
      if (Math.abs(fwd) <= el / 2 + 0.3 && Math.abs(lat) <= ew / 2 + 0.3) return 0.9; // under the roof / inside the tower
    }
  }
  return 0;
}
// an arrow coming down on an enemy engine: some are fire arrows (tow and pitch), and timber catches
function onArrow(w, f) {
  const Z = w.siege; if (!Z.engines.length) return;
  for (const e of Z.engines) {
    if (e.state === "burnt" || e.team === f.team) continue;
    const ext = ARMS[e.kind].eng || [3, 3], r = Math.max(ext[0], ext[1]) / 2 + 0.5;
    if (Math.abs(f.x - e.x) > r || Math.abs(f.y - e.y) > r) continue;
    if (w.rng.next() < 0.012 * ENG[e.kind].flam) { e.fire = Math.max(e.fire, 0.15); if (!e.fireSaid) { e.fireSaid = true; w.events.push({ t: w.tick, kind: "engine-fired", team: e.team, engine: e.id, what: e.kind }); } }
    return;
  }
}

// ─────────────────────────────────────────────────────────────── gates
// A gate is shut (barred, and closed to the nav for everyone) whenever enemy troops are within 350 m of it
// or the town is invested. Attackers inside the walls with no defenders by the gate unbar it (for their friends).
function gatesTick(w) {
  const S = w.S;
  for (const b of w.buildings) {
    if (!isGate(b)) continue;
    gateInit(w, b);
    const up = !b.ruin && b.progress >= 1;
    if (!up) { if (b.navKey) { navSetBlock(w, "gf" + b.id, null); navSetBlock(w, "gp" + b.id, null); b.navKey = false; } b.shut = false; continue; }
    const G = gateGeom(b);
    if (!b.navKey) { // the flanks close their cells for good; the passage's own cell stays open
      const pc = cellOf(w, G.px, G.py), skip = new Set([pc]);
      navSetBlock(w, "gf" + b.id, [...segCells(w, G.ax, G.ay, G.px - G.ux * (GATE_PASSAGE + 10), G.py - G.uy * (GATE_PASSAGE + 10), skip), ...segCells(w, G.px + G.ux * (GATE_PASSAGE + 10), G.py + G.uy * (GATE_PASSAGE + 10), G.bx, G.by, skip)]);
      b.navKey = true;
    }
    gateRepaired(w, b); // (repairs hang new leaves, then mend the portcullis)
    const T = w.teams[b.team];
    let near = false;
    for (const v of w.units.values()) { if (v.team === b.team || v.isWorkers || !v.members.length || v.state === "routing") continue; if (Math.hypot(v.ax - G.px, v.ay - G.py) < 350) { near = true; break; } }
    let shut = !b.gateBroken && (near || !!T?.besieged);
    if (shut && (b.forcedOpen || b.sallyOpen)) shut = false;
    if (!near) b.forcedOpen = false;
    // attackers inside by the gate, and no defender to stop them: they lift the bar
    if (shut) {
      const town = castleCall(w, "castleAt", G.px, G.py) || T?.town || { x: b.x, y: b.y }, n = sideNormal({ line: true, x: G.px, y: G.py, ux: G.ux, uy: G.uy }, town.x, town.y);
      neighbours(w, G.px + n[0] * 4, G.py + n[1] * 4, 7, NB); let att = 0, def = 0;
      for (const o of NB) { if (!S.alive[o] || S.status[o] >= ST_FLEE) continue; const inside = (S.x[o] - G.px) * n[0] + (S.y[o] - G.py) * n[1] > 0.5; if (!inside) continue; if (S.team[o] === b.team) def++; else att++; }
      if (att >= 3 && !def) { b.forcedOpen = true; shut = false; w.events.push({ t: w.tick, kind: "gate-opened", team: b.team, building: b.id }); }
    }
    if (shut !== !!b.shut) { b.shut = shut; setGateNav(w, b); }
    // the portcullis comes down with the gate shut against an enemy (and stays down behind broken leaves)
    const down = shut && b.gpc > 0;
    if (b.gpc > 0 && down !== !!b.portDown) { b.portDown = down; w.events.push({ t: w.tick, kind: down ? "portcullis-dropped" : "portcullis-raised", team: b.team, building: b.id, x: G.px, y: G.py }); }
  }
}
function setGateNav(w, b) {
  const G = gateGeom(b);
  navSetBlock(w, "gp" + b.id, b.shut && !b.gateBroken ? [cellOf(w, G.px, G.py)] : null);
}

// ─────────────────────────────────────────────────────────────── escalade
const SOLID = (f) => { const D = FEATURES[f.type]; return D && D.climbS && D.cross?.foot === Infinity; };
function wallAt(w, x, y, r, team, keep = null) {
  let best = null, bd = r;
  eachFeatureNear(w, x, y, x, y, r, (f) => { if (!SOLID(f) || f.team === team || f.barricade || (keep && !keep(f))) return false; const d = pointSeg(x, y, f.x0, f.y0, f.x1, f.y1); if (d < bd) { bd = d; best = f; } return false; });
  return best;
}
function closest(f, x, y) {
  const dx = f.x1 - f.x0, dy = f.y1 - f.y0, l2 = dx * dx + dy * dy || 1, t = clamp(((x - f.x0) * dx + (y - f.y0) * dy) / l2, 0, 1);
  return [f.x0 + dx * t, f.y0 + dy * t, t];
}
function normalToward(f, x, y) { const dx = f.x1 - f.x0, dy = f.y1 - f.y0, L = Math.hypot(dx, dy) || 1; let nx = -dy / L, ny = dx / L; if ((x - f.x0) * nx + (y - f.y0) * ny < 0) { nx = -nx; ny = -ny; } return [nx, ny]; }

function startEscalade(w, u, o) {
  const A = ARMS[u.arm];
  if (u.isWorkers || A.mounted || A.engine) return;
  const refuse = (why) => { w.events.push({ t: w.tick, kind: "escalade-refused", team: u.team, unit: u.id, why }); };
  // a castle's TOWER at the click: long ladders to its top if it is low enough (castle-plan §1.2), else refused
  const tp = towerAt(w, o.x, o.y, u.team);
  if (tp) return towerEscalade(w, u, o, tp, refuse);
  let f = wallAt(w, o.x, o.y, 40, u.team);
  if (!f) { refuse("no wall there"); return; }
  // the gatehouse's own masonry (its flanks on the curtain line) is no place for a ladder: the curtain beside it is
  const gb = f.building !== undefined ? w.buildings.find((q) => q.id === f.building) : null;
  if (gb && partOf(w, gb)?.kind === "gatehouse") { const g2 = wallAt(w, o.x, o.y, 40, u.team, (q) => q.building !== gb.id); if (g2) f = g2; }
  const n = normalToward(f, u.ax, u.ay), P = closest(f, o.x, o.y), fx = f.x1 - f.x0, fy = f.y1 - f.y0, FL = Math.hypot(fx, fy) || 1;
  const D = FEATURES[f.type];
  // the climb is to the WALL-WALK of the castle part (castle.js walkH, ~8 m on a main curtain), not the feature's
  // nominal height; a longer ladder is a longer climb
  const wb = f.building !== undefined ? w.buildings.find((q) => q.id === f.building) : null, wp = wb ? partOf(w, wb) : null, walkH = wp?.walkH ?? wb?.walkH ?? null;
  const ladH = walkH ?? D.height ?? 4, ladS = D.climbS * (walkH && D.height ? 0.4 + 0.6 * walkH / D.height : 1);
  const face = wp ? (wp.th ?? wp.thick ?? 2.6) / 2 : (D.thickness || 1) / 2; // (the wall's face, out from its line)
  const footOut = face + (wp ? 2.6 : 1.6) + 0.3;
  // ladders need firm ground at the foot: no wet moat, no water standing in the ditch, not in the masonry of a tower or gatehouse
  const footX = P[0] + n[0] * 3, footY = P[1] + n[1] * 3;
  if (wetAt(w, footX, footY)) { refuse("water at the foot of the wall"); return; }
  if (moatBefore(w, footX, footY, n)) { refuse("a wet moat before the wall: fill it first, or go by the gate"); return; }
  const T = w.teams[u.team];
  // a docked tower of ours within 20 m: the men go up through it
  const tw = (w.siege.engines || []).find((e) => e.kind === "siege_tower" && e.team === u.team && e.docked && e.docked.f === f && Math.hypot(e.docked.x - P[0], e.docked.y - P[1]) < 20);
  let lads = [], prep = 0;
  if (tw) lads = [{ x: tw.docked.x, y: tw.docked.y, up: false, tower: tw.id, next: 0 }];
  else {
    // the places along the stretch where a ladder's foot has firm, open ground; the ladders go to those nearest the click
    const ok = []; for (let s = 0.5; s <= FL - 0.5; s += 0.5) { const x = f.x0 + fx * s / FL, y = f.y0 + fy * s / FL, qx = x + n[0] * footOut, qy = y + n[1] * footOut; if (!wetAt(w, qx, qy) && castleCall(w, "groundOpen", qx, qy) !== false && castleCall(w, "groundOpen", x + n[0] * (footOut + 1.5), y + n[1] * (footOut + 1.5)) !== false) ok.push([Math.abs(s - P[2] * FL), x, y, s]); }
    if (!ok.length) { refuse("no footing for ladders there: the towers and the gatehouse stand out over it"); return; }
    ok.sort((p, q) => p[0] - q[0]);
    let want = clamp(Math.round(u.members.length / LAD.perMen), 1, LAD.max), have = 0;
    const spots = []; for (const c of ok) { if (spots.length >= want) break; if (spots.every((q) => Math.abs(q[3] - c[3]) >= LAD.spacing - 0.01)) spots.push(c); }
    want = spots.length;
    if (T.store) { have = Math.min(want, Math.floor(T.store.ladders || 0)); EC.take(T, "ladders", have); }
    let rough = 0; if (T.store) { rough = Math.min(want - have, Math.floor((T.store.timber || 0) / LAD.timber)); EC.take(T, "timber", rough * LAD.timber); } else rough = want - have; // (no economy: scenario troops bring their own)
    if (have + rough < 1) { refuse("no ladders and no timber to make them"); return; }
    if (rough) prep = LAD.improviseS;
    for (const c of spots.slice(0, have + rough).sort((p, q) => p[3] - q[3])) lads.push({ x: c[1], y: c[2], up: false, next: 0 });
  }
  u.esc = { f, px: P[0], py: P[1], nx: n[0], ny: n[1], lads, tower: tw?.id ?? null, climbS: tw ? LAD.towerClimbS : ladS, rep: tw ? LAD.towerRep : 1, H: tw ? ENG.siege_tower.bridgeH : ladH,
    face, foot: footOut,
    phase: "approach", prepUntil: w.time + prep, inside: new Set(), then: o.then || null, t0: w.time, n0: u.members.length };
  const fac = Math.atan2(-n[1], -n[0]);
  applyOrder(w, u, { kind: "move", x: P[0] + n[0] * 12, y: P[1] + n[1] * 12, facing: fac, raw: true, pace: o.pace || "quick" });
  u.path = (u.path || []).concat([[P[0] + n[0] * 2.2, P[1] + n[1] * 2.2]]);
  u.order = { kind: "escalade", x: P[0], y: P[1], pace: o.pace || "quick" };
  w.events.push({ t: w.tick, kind: "escalade", team: u.team, unit: u.id, ladders: lads.length, tower: !!tw });
}
// a wet moat between the wall's foot and the field (a ladder cannot be carried across it)
function moatBefore(w, x, y, n) {
  let hit = false; const x1 = x + n[0] * 30, y1 = y + n[1] * 30;
  eachFeatureNear(w, Math.min(x, x1), Math.min(y, y1), Math.max(x, x1), Math.max(y, y1), 8, (q) => { if (q.type !== "moat") return false; for (let s = 0; s <= 30; s += 1.5) if (pointSeg(x + n[0] * s, y + n[1] * s, q.x0, q.y0, q.x1, q.y1) < (q.width || 10) / 2) { hit = true; return true; } return false; });
  return hit;
}
function wetAt(w, x, y) {
  let wet = w.map.water ? w.map.water(x, y) > 0.3 : false;
  if (!wet) eachFeatureNear(w, x, y, x, y, 8, (q) => { if (q.type === "moat" && pointSeg(x, y, q.x0, q.y0, q.x1, q.y1) < (q.width || 10) / 2 + 1) { wet = true; return true; } return false; });
  return wet;
}
// a castle tower of the enemy's at (x, y): the part, if the click is on it (within 2.5 m of its face)
// (on its footprint; or just off its face with no curtain nearer — a click on the curtain beside a tower is the curtain's)
function towerAt(w, x, y, team) {
  for (const c of w.castles || []) {
    if (c.team === team) continue;
    for (const p of c.parts || []) {
      if (p.kind !== "tower" || !Number.isFinite(p.x) || !Number.isFinite(p.r)) continue;
      const d = Math.hypot(x - p.x, y - p.y); if (!(d <= p.r + 2.5)) continue;
      if (d > p.r + 0.3 && c.parts.some((q) => q.kind === "curtain" && Number.isFinite(q.x0) && pointSeg(x, y, q.x0, q.y0, q.x1, q.y1) < d - p.r + 1.5)) continue;
      const b = w.buildings.find((q) => q.id === p.bid); if (b && !b.ruin) return { p, c, b };
    }
  }
  return null;
}
// ESCALADE ON A TOWER. Mural towers were built to stand well above the wall-walk so that ladders long enough for the
// curtain would not reach their tops (siege-research.md §17): a top up to LAD.maxH (12 m, a long ladder of ~13 m, as
// the low towers of a concentric castle's outer curtain) can be scaled — a slower climb, a ladder more easily thrown
// down — a higher one is refused: the way in is the wall beside it and the tower's own door off the wall-walk.
function towerEscalade(w, u, o, tp, refuse) {
  const { p, b } = tp, top = p.floors?.[p.floors.length - 1] ?? p.h;
  if (top > LAD.maxH) { refuse(`too high for ladders (${+top.toFixed(1)} m): take the wall beside it and go in by the tower's door`); return; }
  // where round the tower: the face toward the stormers, clear of the curtains that meet it and with firm ground at the foot
  const curt = (w.castles.find((c) => c.parts.includes(p))?.parts || []).filter((q) => q.kind === "curtain" || q.kind === "gatehouse");
  const a0 = Math.atan2(u.ay - p.y, u.ax - p.x), footOut = 1.6 + 0.3, cand = [];
  for (let k = 0; k < 72; k++) {
    const a = k * Math.PI / 36, nx = Math.cos(a), ny = Math.sin(a), hx = p.x + nx * p.r, hy = p.y + ny * p.r, qx = hx + nx * footOut, qy = hy + ny * footOut;
    if (curt.some((q) => q.kind === "curtain" ? pointSeg(hx, hy, q.x0, q.y0, q.x1, q.y1) < q.th / 2 + 1.2 || pointSeg(qx, qy, q.x0, q.y0, q.x1, q.y1) < q.th / 2 + 1 : Math.hypot(qx - q.x, qy - q.y) < q.w / 2 + 1)) continue;
    if (castleCall(w, "insideCastle", qx, qy) || wetAt(w, qx, qy) || moatBefore(w, qx, qy, [nx, ny]) || castleCall(w, "groundOpen", qx, qy) === false) continue;
    let da = Math.abs(a - a0) % (2 * Math.PI); if (da > Math.PI) da = 2 * Math.PI - da;
    cand.push([da, a, hx, hy, nx, ny]);
  }
  if (!cand.length) { refuse(`no footing for ladders round that tower${wetAt(w, p.x + Math.cos(a0) * (p.r + 2), p.y + Math.sin(a0) * (p.r + 2)) ? ": water at its foot" : ""}`); return; }
  cand.sort((q, r) => q[0] - r[0]);
  const T = w.teams[u.team], want = clamp(Math.round(u.members.length / LAD.perMen), 1, LAD.towerMax), spots = [];
  for (const c of cand) { if (spots.length >= want) break; if (spots.every((q) => Math.hypot(q[2] - c[2], q[3] - c[3]) >= LAD.spacing - 0.01)) spots.push(c); }
  let have = 0, rough = 0, prep = 0;
  if (T.store) { have = Math.min(spots.length, Math.floor(T.store.ladders || 0)); EC.take(T, "ladders", have); rough = Math.min(spots.length - have, Math.floor((T.store.timber || 0) / LAD.timber)); EC.take(T, "timber", rough * LAD.timber); } else rough = spots.length;
  if (have + rough < 1) { refuse("no ladders and no timber to make them"); return; }
  if (rough) prep = LAD.improviseS;
  const lads = spots.slice(0, have + rough).map((c) => ({ x: c[2], y: c[3], nx: c[4], ny: c[5], up: false, next: 0 }));
  const m = spots[0], nx = m[4], ny = m[5], tx = -ny, ty = nx, px = m[2], py = m[3];
  const f = { type: "curtain_wall", x0: px - tx * 4, y0: py - ty * 4, x1: px + tx * 4, y1: py + ty * 4, building: b.id, team: b.team, towerLadder: true };
  const D = FEATURES.curtain_wall, ladS = D.climbS * (0.4 + 0.6 * top / (D.height || 10)) * LAD.longS;
  u.esc = { f, px, py, nx, ny, lads, tower: null, climbS: ladS, rep: LAD.longRep, H: top, face: 0, foot: footOut, top: true, lvl: p.topLvl ?? 2, part: p.id,
    phase: "approach", prepUntil: w.time + prep, inside: new Set(), then: o.then || null, t0: w.time, n0: u.members.length };
  applyOrder(w, u, { kind: "move", x: px + nx * 12, y: py + ny * 12, facing: Math.atan2(-ny, -nx), raw: true, pace: o.pace || "quick" });
  u.path = (u.path || []).concat([[px + nx * 2.2, py + ny * 2.2]]);
  u.order = { kind: "escalade", x: px, y: py, pace: o.pace || "quick" };
  w.events.push({ t: w.tick, kind: "escalade", team: u.team, unit: u.id, ladders: lads.length, tower: false, towerTop: true, h: top });
}
// A body over the wall by ladders given a new order (castle.js: along the walk, into a tower, down into the bailey):
// the escalade is over for it, and the ladders it raised stay standing against the wall — ordinary ladder links now,
// that castle.js climbs the rest of the men up (and that anyone of that side may use).
export function releaseEscalade(w, u) {
  const E = u.esc; if (!E) return;
  u.esc = null;
  const S = w.S, Z = w.siege, CH = Z?.climbH;
  for (const i of u.members) { S.busyT[i] = 0; CH?.delete(i); }
  for (const L of E.lads) {
    if (!L.link) continue;
    if (L.tower !== undefined || !L.up || L.broken) { ladderLink(w, u, E, L, false); continue; }
    const b = E.f.building !== undefined ? w.buildings.find((q) => q.id === E.f.building) : null, c = b && castleOfB(w, b);
    const link = L.link; delete link.managed; link.head = 4; link.len = E.H * 1.15;
    if (c) castleCall(w, "addLink", c, link);
    (Z.standing ||= []).push({ x: L.x, y: L.y, nx: L.nx ?? E.nx, ny: L.ny ?? E.ny, h: E.H, team: u.team, top: !!E.top, link, bid: b?.id });
  }
}

function escaladeTick(w, u) {
  const E = u.esc, S = w.S, t = w.time, cs = w.cs;
  if (!u.members.length) { u.esc = null; return; }
  const nf = rebind(w, E.f, E.px, E.py);
  if (!nf) { if (E.phase === "lodged" || E.inside.size) { u.esc = null; return; } endEscalade(w, u, "the wall there is gone — go through the gap"); return; }
  E.f = nf;
  if (u.c?.broken) { endEscalade(w, u, "the attack broke"); return; }
  const dAnch = Math.hypot(u.ax - (E.px + E.nx * 2.2), u.ay - (E.py + E.ny * 2.2));
  if (E.phase === "approach") { if (dAnch < 10 || (!u.path && dAnch < 30)) { E.phase = "raise"; E.raiseAt = Math.max(t, E.prepUntil) + LAD.raiseS; } else return; }
  if (E.phase === "raise") {
    if (E.tower !== null) { const tw = engineById(w, E.tower); if (!tw || tw.state === "burnt" || !tw.docked) { endEscalade(w, u, "the tower is lost"); return; } if (tw.bridge < 1) return; E.lads[0].up = true; ladderLink(w, u, E, E.lads[0], true); E.phase = "climb"; }
    else if (t >= E.raiseAt) { for (const L of E.lads) if (!L.broken) { L.up = true; ladderLink(w, u, E, L, true); } E.phase = "climb"; }
    else return;
  }
  // who is where: inside (over the wall) or out
  const f = E.f, fx = f.x1 - f.x0, fy = f.y1 - f.y0;
  const insideOf = E.top ? (i) => S.lvl[i] > 0 || !!castleCall(w, "insideCastle", S.x[i], S.y[i]) : (i) => (E.walk && S.lvl[i] > 0) || (S.x[i] - f.x0) * E.nx + (S.y[i] - f.y0) * E.ny < 0;
  let outN = 0, inN = 0;
  for (const i of u.members) { if (!S.alive[i]) continue; if (insideOf(i)) inN++; else outN++; }
  // ladders: one man at a time on each, fought at the top
  for (const L of E.lads) {
    if (L.broken) continue;
    if (!L.up) { if (L.downUntil && t >= L.downUntil) { L.up = true; L.downUntil = 0; ladderLink(w, u, E, L, true); } continue; }
    if (L.tower !== undefined) { const tw = engineById(w, L.tower); if (!tw || tw.state === "burnt") { L.broken = true; continue; } }
    // the ladder's foot, where the renderer stands it (engines.js: 2.6 m out from a castle curtain's face, 1.6 m from
    // a town wall's), so the men queue at its foot and not inside the masonry
    const lnx = L.nx ?? E.nx, lny = L.ny ?? E.ny, out = L.tower !== undefined ? 1.0 : E.foot ?? 1.0, fx0 = L.x + lnx * out, fy0 = L.y + lny * out;
    if (L.climber !== undefined && L.climber >= 0) {
      const i = L.climber, CH = (w.siege.climbH ||= new Map());
      if (!S.alive[i] || S.status[i] >= ST_FLEE) { L.climber = -1; CH.delete(i); continue; }
      // up the ladder: he rises with his climb (the renderer draws him at this height — w.castleLevelH), leaning in as
      // the ladder does, from its foot out from the wall to its head at the parapet
      const f = L.tower !== undefined ? 0 : clamp(1 - (L.doneT - t) / Math.max(0.1, L.climbT || E.climbS), 0, 1), lean = L.tower !== undefined ? 0 : (out - (E.face ?? 0.5) - 0.3) * f;
      S.x[i] = fx0 - lnx * lean; S.y[i] = fy0 - lny * lean; S.busyT[i] = t + 0.5; S.state[i] = S_MOVE; S.facing[i] = Math.atan2(-lny, -lnx);
      if (L.tower === undefined) CH.set(i, E.H * f * 0.92);
      if (t >= L.doneT) { CH.delete(i); climbTop(w, u, E, L, i); L.climber = -1; L.next = t + (L.tower !== undefined ? 0.2 : 1); }
      continue;
    }
    if (t < L.next) continue;
    // the next man: the nearest outside, able, within 15 m of the foot; he steps up to it
    let best = -1, bd = 15;
    for (const i of u.members) {
      if (!S.alive[i] || S.status[i] >= ST_SHAKEN || S.posture[i] || insideOf(i) || isOnLadder(E, i)) continue;
      if (S.state[i] === S_FIGHT && L.tower === undefined) continue;
      const d = Math.hypot(S.x[i] - fx0, S.y[i] - fy0); if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) continue;
    if (bd > 1.2) { const c = bd > 2.5 ? castleCall(w, "groundToward", S.x[best], S.y[best], fx0, fy0) : null; stepTo(w, best, c ? c[0] : fx0, c ? c[1] : fy0, 2.2); S.busyT[best] = t + 0.4; continue; } // (round a tower that stands out beside the ladder, not into it)
    L.climber = best; L.climbT = E.climbS * w.rng.range(0.8, 1.2); L.doneT = t + L.climbT;
  }
  // the defenders on the wall-walk run to each raised ladder's head (two men a ladder, from within 25 m)
  if (w.tick % 10 === u.id % 10) for (const L of E.lads) {
    if (!L.up || L.broken) continue;
    const hx = L.x - (L.nx ?? E.nx) * 1.8, hy = L.y - (L.ny ?? E.ny) * 1.8;
    neighbours(w, hx, hy, LAD.rally, NB); let at = 0; const cand = [];
    for (const o of NB) {
      if (!S.alive[o] || S.team[o] === u.team || S.status[o] >= ST_SHAKEN || S.posture[o] || S.state[o] === S_CAPT || S.state[o] === S_FLEE) continue;
      if ((S.x[o] - f.x0) * E.nx + (S.y[o] - f.y0) * E.ny > 0) continue; // (only men inside the wall)
      if (E.top && S.lvl[o] !== E.walk?.lvl) continue; // (a tower's top: only the men up there)
      const ou = w.units.get(S.unit[o]); if (ou?.isWorkers || ARMS[ou?.arm]?.engine) continue;
      const d = Math.hypot(S.x[o] - hx, S.y[o] - hy); if (d < 3.5) at++; else cand.push([d, o]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (let q = 0; q < Math.min(cand.length, 2 - at); q++) { const o = cand[q][1]; if (S.state[o] === S_FIGHT) continue; stepTo(w, o, hx + (q - 0.5) * 1.2, hy, 3); S.busyT[o] = t + 1.2; }
  }
  // men over the wall hold a lodgement a few metres in until the body is across
  const qx = E.px - E.nx * 7, qy = E.py - E.ny * 7;
  if (E.phase === "climb") {
    for (const i of u.members) {
      if (!S.alive[i] || !insideOf(i) || S.state[i] === S_FIGHT || S.state[i] === S_FLEE || S.status[i] >= ST_FLEE) continue;
      const k = i % 9, ox = (k % 3 - 1) * 1.6, oy = (Math.floor(k / 3) - 1) * 1.6;
      const tx = qx + fx / (Math.hypot(fx, fy) || 1) * ox * 2 + ox, ty = qy + fy / (Math.hypot(fx, fy) || 1) * oy * 2 + oy;
      if (Math.hypot(S.x[i] - tx, S.y[i] - ty) > 1) stepTo(w, i, tx, ty, 1.6);
      S.busyT[i] = t + 0.5;
    }
    // most of them are over: the body forms inside and goes on (to the gate, then the keep)
    if (inN >= Math.max(3, (inN + outN) * 0.6)) {
      E.phase = "lodged"; u.ax = qx; u.ay = qy; u.path = null; u.hold = false;
      for (const i of u.members) if (insideOf(i)) S.busyT[i] = 0;
      const Tf = w.teams[f.team], goal = E.then || (Tf?.town ? { x: Tf.town.x, y: Tf.town.y } : { x: qx - E.nx * 60, y: qy - E.ny * 60 });
      u.order = { kind: "assault", x: goal.x, y: goal.y, pace: "quick" }; u.path = [[goal.x, goal.y]]; u.pace = "quick";
      w.events.push({ t: w.tick, kind: "escalade-lodged", team: u.team, unit: u.id, over: inN });
    }
  }
  if (outN === 0 && E.phase === "lodged") { u.esc = null; return; }
  if (E.phase === "climb" && E.lads.every((L) => L.broken) && outN) endEscalade(w, u, "every ladder thrown down or broken");
  if (E.phase === "climb" && t - E.t0 > 900 && inN === 0) endEscalade(w, u, "the escalade failed");
}
// Escalade through castle.js level links (plan §1): a raised ladder is a `ladder` link from the ground at its foot to
// the wall-walk at its head; a docked tower's bridge a `bridge` link three abreast. siege.js still resolves the climb
// and the fight at the head (climbTop) — the link is `managed: "siege"` so castle.js draws/paths it but does not move
// men up it itself. Removed when the ladder is thrown down or broken, or the escalade ends.
function ladderLink(w, u, E, L, on) {
  const f = E.f, b = f.building !== undefined ? w.buildings.find((q) => q.id === f.building) : null, part = b && partOf(w, b), c = b && castleOfB(w, b);
  if (!part || !c) return;
  if (!on) { if (L.link) castleCall(w, "removeLink", c, L.link); L.link = null; return; }
  if (L.link) return;
  const lvl = E.lvl ?? wallWalkLevel(w, b, part), lnx = L.nx ?? E.nx, lny = L.ny ?? E.ny;
  const link = { kind: L.tower !== undefined ? "bridge" : "ladder", a: { lvl: 0, x: L.x + lnx * (L.tower !== undefined ? 4 : 1.2), y: L.y + lny * (L.tower !== undefined ? 4 : 1.2) }, b: { lvl, x: L.x, y: L.y }, width: L.tower !== undefined ? 3 : 1, speed: L.tower !== undefined ? 0.8 : E.H / E.climbS, team: u.team, managed: "siege", src: "siege" };
  const r = castleCall(w, "addLink", c, link);
  L.link = r && typeof r === "object" ? r : link;
  if (S_HAS_LVL(w)) E.walk = { lvl, x: E.px, y: E.py };
}
const S_HAS_LVL = (w) => !!w.S.lvl;
// move a man without the barrier treating it as a step through the wall
export function place(w, i, x, y) { const S = w.S, P = w.siege.prev; S.x[i] = x; S.y[i] = y; if (P && P.length > i * 2 + 1) { P[i * 2] = x; P[i * 2 + 1] = y; } }
// features are rebuilt when a wall is breached or a gate shut: find the wall line again near where it was
function rebind(w, f, x, y) {
  if (w.features.includes(f)) return f;
  if (f.towerLadder) { const b = w.buildings.find((q) => q.id === f.building); return b && !b.ruin ? f : null; } // (a tower has no wall feature: its ladders stand while it does)
  let best = null, bd = 3;
  eachFeatureNear(w, x, y, x, y, 4, (q) => { if (!SOLID(q) || q.type !== f.type) return false; const d = pointSeg(x, y, q.x0, q.y0, q.x1, q.y1); if (d < bd) { bd = d; best = q; } return false; });
  return best;
}
const isOnLadder = (E, i) => E.lads.some((L) => L.climber === i);
export function stepTo(w, i, tx, ty, v) {
  const S = w.S, dx = tx - S.x[i], dy = ty - S.y[i], d = Math.hypot(dx, dy); if (d < 0.05) return;
  const s = Math.min(d, v * DT); S.x[i] += dx / d * s; S.y[i] += dy / d * s; S.vx[i] = dx / d * v; S.vy[i] = dy / d * v; S.facing[i] = Math.atan2(dy, dx); if (S.state[i] !== S_FIGHT) S.state[i] = S_MOVE;
}
// The man at the top of the ladder against the men on the wall-walk there: each defender within 3.5 m of the
// ladder's head is a chance to throw him down (DESIGN 35 % each, worse for an unskilled climber against a
// skilled defender; a tower's bridge, three men abreast, 45 % of that). Thrown down: 55 % fall hurt or dead
// from the top of a 4–6 m climb, else bruised and back at the foot; 15 % the ladder goes over too.
function climbTop(w, u, E, L, i) {
  const S = w.S, Z = w.siege, cs = w.cs;
  const hx = L.x - (L.nx ?? E.nx) * 1.8, hy = L.y - (L.ny ?? E.ny) * 1.8;
  neighbours(w, hx, hy, 3.5, NB);
  let pStay = 1, def = -1, friends = 0; const defs = [];
  for (const o of NB) {
    if (!S.alive[o] || S.status[o] >= ST_FLEE || S.posture[o] || S.state[o] === S_CAPT) continue;
    if ((S.x[o] - E.f.x0) * E.nx + (S.y[o] - E.f.y0) * E.ny > 0 && !(E.walk && S.lvl[o] > 0)) continue; // on the wall's inner side (or up on its walk)
    if (E.walk && S.team[o] !== S.team[i] && S.lvl[o] === 0) continue; // (a castle: only men up on the wall-walk meet him)
    if (E.top && S.lvl[o] !== E.walk.lvl) continue; // (a tower's top: only the men on it)
    if (S.team[o] === S.team[i]) friends++; else defs.push(o);
  }
  // each defender at the head is a chance to throw him down; a higher wall is a longer, more exposed climb;
  // friends already on the wall-walk there take the defenders' attention (a lodgement feeds itself); a
  // tower's bridge is three men wide, so no more than three can meet the man coming across
  const hMul = E.tower !== null ? 1 : 1 + Math.max(0, E.H - 3.5) / 5, fMul = 1 / (1 + 0.7 * friends);
  for (const o of E.tower !== null ? defs.slice(0, 3) : defs) {
    const p = clamp(LAD.repBase * E.rep * hMul * fMul * (1 + 0.6 * (S.skill[o] - S.skill[i])), 0.03, 0.85);
    pStay *= 1 - p; if (def < 0) def = o;
  }
  if (w.rng.next() < 1 - pStay) {
    Z.stats.repulsed++;
    if (w.rng.next() < 0.55 && cs) { const r = w.rng.next(); fell(cs.ctx, i, def, r < 0.25 ? W_INSTANT : r < 0.6 ? W_MORTAL : W_INCAP, "fall"); Z.stats.fell++; }
    else { S.busyT[i] = w.time + 8; S.stress[i] += 0.15 * (1.3 - S.courage[i]); place(w, i, L.x + (L.nx ?? E.nx) * 3, L.y + (L.ny ?? E.ny) * 3); }
    for (const o of u.members) if (S.alive[o] && Math.hypot(S.x[o] - L.x, S.y[o] - L.y) < 10) S.stress[o] += 0.02 * (1.3 - S.courage[o]); // they see him fall
    if (L.tower === undefined && w.rng.next() < LAD.pushOff * (E.top ? LAD.longRep : 1)) { L.up = false; if (w.rng.next() < 0.3) L.broken = true; else L.downUntil = w.time + 20; ladderLink(w, u, E, L, false); w.events.push({ t: w.tick, kind: "ladder-pushed", team: u.team, x: L.x, y: L.y, broken: !!L.broken }); }
    return;
  }
  // over: he stands on the wall-walk (a castle's: its level, and castle.js takes him on from there), else drops inside
  if (E.walk) { place(w, i, E.walk.x + L.x - E.px + (w.rng.next() - 0.5) * 0.8, E.walk.y + L.y - E.py + (w.rng.next() - 0.5) * 0.8); S.lvl[i] = E.walk.lvl; }
  else place(w, i, hx + (w.rng.next() - 0.5) * 1.5, hy + (w.rng.next() - 0.5) * 1.5);
  S.busyT[i] = w.time + 1; S.state[i] = S_IDLE;
  E.inside.add(i); Z.stats.climbed++;
}
function endEscalade(w, u, why) {
  const E = u.esc; u.esc = null;
  if (E) for (const L of E.lads) if (L.link) ladderLink(w, u, E, L, false);
  w.events.push({ t: w.tick, kind: "escalade-failed", team: u.team, unit: u.id, why, over: E?.inside.size || 0 });
  if (E) { const S = w.S; for (const i of u.members) S.busyT[i] = 0; applyOrder(w, u, { kind: "move", x: E.px + E.nx * 60, y: E.py + E.ny * 60, facing: Math.atan2(-E.ny, -E.nx), raw: true, pace: "quick" }); }
}
function collectLadders(w) {
  const out = [];
  for (const u of w.units.values()) { const E = u.esc; if (!E || E.phase === "approach") continue; /* (still being carried up: not lying at the wall yet) */ for (const L of E.lads) if (L.tower === undefined && !L.broken) out.push({ x: L.x, y: L.y, nx: L.nx ?? E.nx, ny: L.ny ?? E.ny, up: L.up, h: E.H, team: u.team, climber: L.climber >= 0, top: !!E.top }); }
  for (const L of w.siege.standing || []) if (!L.gone) out.push({ x: L.x, y: L.y, nx: L.nx, ny: L.ny, up: true, h: L.h, team: L.team, climber: false, top: L.top });
  return out;
}

// ─────────────────────────────────────────────────────────────── barriers: walls are solid
// Standing wall runs, palisades and shut gates (SOLID features) cannot be walked through, whatever the
// steering, fighting or fleeing code wanted. Any man whose step this tick crossed one (or who stands inside
// its thickness) is put back on the side he came from. Worker dots are exempt: their commute is abstract
// (economy.js), and they go by the gate.
const BC = 12;
function barrierGrid(w) {
  const Z = w.siege, ver = (w.featuresVer || 0) + ":" + (w.features?.length || 0);
  if (Z.bar && Z.barVer === ver) return Z.bar;
  const grid = new Map(); let n = 0;
  for (const f of w.features || []) {
    if (!SOLID(f)) continue; n++;
    const hw = (f.width || 1) / 2 + 0.35;
    const i0 = Math.floor((Math.min(f.x0, f.x1) - hw) / BC), i1 = Math.floor((Math.max(f.x0, f.x1) + hw) / BC), j0 = Math.floor((Math.min(f.y0, f.y1) - hw) / BC), j1 = Math.floor((Math.max(f.y0, f.y1) + hw) / BC);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { if (pointSeg((i + 0.5) * BC, (j + 0.5) * BC, f.x0, f.y0, f.x1, f.y1) > BC * 0.75 + hw) continue; const k = i * 65536 + j; let b = grid.get(k); if (!b) grid.set(k, (b = [])); b.push(f); }
  }
  Z.bar = n ? grid : null; Z.barVer = ver;
  return Z.bar;
}
function barrierResolve(w) {
  const Z = w.siege, S = w.S;
  if (!Z.prev || Z.prev.length < S.cap * 2) { const a = new Float32Array(S.cap * 2); if (Z.prev) a.set(Z.prev.subarray(0, Math.min(Z.prev.length, a.length))); else for (let i = 0; i < S.n; i++) { a[i * 2] = S.x[i]; a[i * 2 + 1] = S.y[i]; } Z.prev = a; }
  const P = Z.prev, grid = barrierGrid(w);
  if (grid) for (let i = 0; i < S.n; i++) {
    if (!S.alive[i] || S.lvl[i]) continue; // (castle.js: a man up on a wall-walk stands ON the wall; castle.js keeps him on it)
    const x = S.x[i], y = S.y[i], px = P[i * 2], py = P[i * 2 + 1];
    const b = grid.get(Math.floor(x / BC) * 65536 + Math.floor(y / BC)); if (!b) continue;
    if (Math.abs(x - px) > 20 || Math.abs(y - py) > 20) continue; // placed or teleported (spawn, escalade): no step to undo
    const u = w.units.get(S.unit[i]); if (u?.isWorkers) continue;
    for (const f of b) {
      const hw = (f.width || 1) / 2 + 0.3, dx = f.x1 - f.x0, dy = f.y1 - f.y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
      const sc = (x - f.x0) * nx + (y - f.y0) * ny, sp = (px - f.x0) * nx + (py - f.y0) * ny;
      const along = ((x - f.x0) * dx + (y - f.y0) * dy) / L;
      if (along < -0.2 || along > L + 0.2) continue;
      const crossed = (sc > 0) !== (sp > 0) && Math.abs(sp) > 0.01;
      if (!crossed && Math.abs(sc) >= hw) continue;
      const side = Math.abs(sp) > 0.01 ? Math.sign(sp) : (f.team === S.team[i] ? insideSign(w, f, nx, ny) : -insideSign(w, f, nx, ny));
      const d = side * hw - sc;
      S.x[i] = x + nx * d; S.y[i] = y + ny * d;
    }
  }
  for (let i = 0; i < S.n; i++) { P[i * 2] = S.x[i]; P[i * 2 + 1] = S.y[i]; }
}
function insideSign(w, f, nx, ny) { const T = castleCall(w, "castleAt", f.x0, f.y0) || w.teams[f.team]?.town; if (!T) return 1; return Math.sign((T.x - f.x0) * nx + (T.y - f.y0) * ny) || 1; }

// ─────────────────────────────────────────────────────────────── helpers and UI reads
const angDiff = (a, b) => { let d = (a - b) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
const turn = (a, b, r) => a + clamp(angDiff(b, a), -r, r);

// what the unit panel shows for an engine
export function engineInfo(w, e) {
  const c = crewOf(w, e), D = ENG[e.kind], need = RECRUITS[e.kind]?.crew || 4;
  const tgt = e.tgt ? (e.tgt.kind === "mod" || e.tgt.kind === "b" ? (BUILDINGS[e.tgt.b.kind]?.name || e.tgt.b.kind) + (e.tgt.kind === "mod" ? ` (section ${e.tgt.k + 1})` : "") : e.tgt.kind === "eng" ? "enemy " + ARMS[e.tgt.e.kind].name.toLowerCase() : e.tgt.kind === "wall" ? "the wall" : "the ground there") : null;
  let tgtHp = null;
  if (e.tgt?.kind === "mod" && e.tgt.b.mods) tgtHp = e.tgt.b.mods[e.tgt.k] / (e.tgt.b.hpMax / e.tgt.b.mods.length);
  else if (e.tgt?.kind === "b") tgtHp = isGate(e.tgt.b) ? (e.tgt.b.hp - e.tgt.b.hpMax * 0.2) / (e.tgt.b.hpMax * 0.8) : e.tgt.b.hp / e.tgt.b.hpMax;
  else if (e.tgt?.kind === "eng") tgtHp = e.tgt.e.hp / e.tgt.e.hpMax;
  return {
    kind: e.kind, name: ARMS[e.kind].name, state: e.state, status: e.state === "packed" ? (e.assembleAt ? "on the road to where it will be framed up" : "packed on carts") : e.state === "assembling" ? `framing up · ${Math.round(e.prog * 100)}%` : e.state === "burnt" ? "burnt out" : e.status || "ready",
    crew: c.n, crewNeed: need, crewMin: D.crewMin, ammo: D.ammo ? Math.floor(e.ammo) : null, ammoMax: D.ammo || null, ammoName: e.kind === "springald" ? "quarrels" : "stones",
    hp: e.hp / e.hpMax, fire: e.fire, target: tgt, targetHp: tgtHp, hitPct: e.tgt && e.tgt.kind !== "pt" && e.hitAt ? Math.round(e.hitF * 100) : null,
    range: D.R || null, abandoned: !!e.abandoned,
  };
}
// the orders the popup should offer for a selection with engines in it
export function engineOrders(w, units) {
  const kinds = new Set(units.map((u) => engineOf(w, u)?.kind).filter(Boolean)), out = [];
  if (units.some((u) => engineOf(w, u)?.state === "packed")) out.push({ kind: "assemble", label: "Assemble here", hint: "frame the engine up on this spot (a trebuchet never moves again)" });
  if (kinds.has("trebuchet") || kinds.has("mangonel") || kinds.has("springald")) out.push({ kind: "bombard", label: "Bombard", hint: "shoot at the wall, gate, building or engine there" });
  if (kinds.has("ram")) out.push({ kind: "batter", label: "Batter", hint: "push the ram to that gate or wall and swing" });
  if (kinds.has("siege_tower")) out.push({ kind: "advance", label: "Advance tower", hint: "push it against the wall there" });
  const foot = units.some((u) => !engineOf(w, u) && !ARMS[u.arm].mounted && !u.isWorkers);
  if (foot) {
    out.push({ kind: "escalade", label: "Escalade", hint: "ladders to the wall there (or up a docked tower)" });
    // castle works (siege-works.js): attackers' and defenders' — the UI offers the ones that fit the side
    out.push({ kind: "mine", label: "Mine", hint: "dig a gallery under that wall section or tower, prop it and fire the props", side: "attack" });
    out.push({ kind: "fire-gate", label: "Burn the gate", hint: "pile brushwood and pitch against the gate leaves and fire them", side: "attack" });
    out.push({ kind: "countermine", label: "Countermine", hint: "listen for mines from here, and dig out to meet one heard", side: "defend" });
    out.push({ kind: "barricade", label: "Barricade the breach", hint: "throw a timber-and-rubble retrenchment across the breach", side: "defend" });
    out.push({ kind: "repair", label: "Repair", hint: "rebuild the damaged wall section there between assaults", side: "defend" });
    out.push({ kind: "sally", label: "Sally", hint: "out by the postern (or the gate) to burn the enemy engine there, then back", side: "defend" }); if ((w.siege?.engines || []).some((e) => e.abandoned && e.state !== "burnt")) out.push({ kind: "crew", label: "Man the engine", hint: "crew the abandoned engine there" }); }
  return out;
}
