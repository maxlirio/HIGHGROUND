// Siege WORKS against a castle (docs/castle-plan.md §4; numbers and sources: docs/siege-research.md §9–§16).
// siege.js owns the engines, the escalade, wall modules and gates; this file adds what a real siege of a castle
// also was, all hooked into siegeSystem:
//
//   MINING        { kind: "mine", x, y, bid?, k?, from? }  — a gallery dug from cover (`from`, else 40 m out) to under
//                 a curtain module or a tower, at a researched rate on the ECONOMIC clock; a chamber opened and
//                 propped; the props fired; the section falls into a breach (a tower may fall entire).
//   COUNTERMINE   { kind: "countermine", x, y }            — defenders listen from a post inside the wall; a mine
//                 heard is met by a counter-gallery; breaking in starts an underground fight (an abstracted event
//                 with real casualties): the attackers' gallery is taken and collapsed, or the counter-gallery is.
//   BARRICADE     { kind: "barricade", x, y, bid? }        — defenders close a breach with a timber-and-rubble
//                 retrenchment (work, econ clock, only while no enemy is within 25 m); it is a solid barrier that
//                 the attackers must pull down by hand on the battle clock (man-seconds), under the defenders' blows.
//   REPAIR        { kind: "repair", x, y, bid? }           — defenders rebuild a damaged or breached module between
//                 assaults (30 % of its build labour, econ clock; stone from the store if there is one).
//   BURN THE GATE { kind: "fire-gate", x, y, bid? }        — attackers pile brushwood and pitch against the leaves
//                 and fire them; defenders pour water through the slots above (battle clock, like a burning engine).
//   SALLY         { kind: "sally", x, y }                  — defenders go out by the postern (one man at a time)
//                 or, failing one, the gate (held open while they pass), fire the enemy engine there, and come back.
//   DROPS         automatic: defenders on the wall-walk drop stones and hot sand/quicklime on men at the wall foot
//                 (fast from hoardings/machicolations, slow over a bare parapet); in a gatehouse passage the MURDER
//                 HOLES do the same to men in the passage.
//   STARVATION    setProvisions(w, { team, manDays | days }) — the garrison eats its stock on the econ clock; when it
//                 runs out hunger and sickness set in; the garrison may YIELD on terms (judged daily), or keep a
//                 respite (offerRespite: "yield on day N unless relieved", Stirling 1314).
//
// Everything structural runs on the econ clock and inside siegeSystem, so siege-war.js's passDays (siegeSystem
// alone, thousands of calls, no step()) works: no fresh spatial hash is needed for any structural outcome.
// Levels: men on a wall-walk have S.lvl ≥ 1 (castle.js, CASTLE-SIM). Where no level system exists yet, "on the
// wall" falls back to "just inside the wall line", as the escalade code always did.
import { S_IDLE, S_MOVE, S_FIGHT, S_FLEE, S_DOWN, S_DEAD, S_WORK, S_CAPT, ST_FLEE, ST_SHAKEN, ST_SURR, W_DISABLE, W_INCAP, W_MORTAL, W_INSTANT, clamp } from "./soldiers.js";
import { ARMS } from "./arms.js";
import { neighbours, applyOrder, DT, TICK } from "./world.js";
import { fell, applyWound } from "./melee.js";
import { Z_TORSO, Z_HEAD } from "./kit.js";
import { FEATURES } from "./terrain-types.js";
import { pointSeg, addFeature, removeFeature, gateGeom, GATE_PASSAGE } from "./features.js";
import { BUILDINGS } from "./econ-data.js";
import { ECON_DAYS_PER_REAL_SEC } from "./clock.js";
import * as EC from "./economy.js";
import { STRUCT, nMods, modGeom, breach, isGate, isTowerB, gateHit, modState, engineById, castleCall, partOf, castleOfB, levelOf, wallWalkLevel, place, stepTo } from "./siege.js";

const EDT = TICK * ECON_DAYS_PER_REAL_SEC; // econ days per tick

// ─────────────────────────────────────────────────────────────── the numbers (docs/siege-research.md §9–§16)
export const MINE = {
  // metres of gallery a day at the face for a full face crew in shifts (EST from the recorded pace of hand-dug
  // galleries: 1–3 m/day medieval, ~7 m/day for the expert Petersburg miners of 1864 — research §10)
  rate: { earth: 2.5, chalk: 2, clay: 2.5, rock: 0.2 },
  faceCrew: 12,            // men who can usefully work one gallery in shifts (Vauban-era crews: 18 miners + 36 labourers for three shifts; one face takes ~4 at a time)
  startOut: 40,            // m: the default mouth (a "cat" or trench in cover) out from the wall face
  under: 3,                // m: the gallery runs this far past the outer face, under the wall
  chamberDays: 2.5,        // econ days to open the chamber under the section and set its timber props (EST)
  fireDays: 0.3,           // the props (packed with brushwood and fat — Rochester's forty pigs) burn through
  fullP: 0.8,              // a curtain section comes down entire; else it settles and cracks (Rochester's first attempt failed)
  towerFullP: 0.75,        // a tower falls entire (Dover 1216, Château Gaillard 1204, Rochester keep corner 1215)
  sideDmg: 0.5,            // the modules either side of a mined curtain module lose up to this share
  // listening: a post (bowls of water, a drum with peas on it) hears digging within ~30 m (EST)
  hearR: 30, hearP: 0.7,   // P(hear) per econ day at the post, falling linearly to 0 at hearR
  ambientR: 10, ambientP: 0.06, // unwatched: the spoil and noise give it away this close, per day
  fight: { each: 4, rounds: 3, kill: 0.22 }, // up to 4 a side in a 1 m gallery; per man per round P(kill a foe)
  lostDelayDays: 1,        // the winners of an underground fight need a day to clear and re-prop their gallery
};
export const WORKS = {
  // the breach: a rubble slope, a few men abreast, slow going (FEATURES.breach_rubble)
  // barricade (Dover 1216: "boulders, timber cross-beams and mighty oak posts" behind the fallen tower; Carcassonne
  // 1240: a dry-stone wall raised inside the mined barbican)
  barricadeManHours: 60,   // a 6 m retrenchment of timber and rubble (EST)
  barricadeTimber: 400,    // kg from the store, if there is a store
  barricadeHp: 900,        // man-seconds of pulling and hacking to open it, unopposed (DESIGN)
  barricadeQuiet: 25,      // m: no work while an enemy is this close to the breach
  repairShare: 0.3,        // of the module's build labour (as economy.js repairs)
  rebuildShare: 0.25,      // of the module's build labour to wall up a BREACHED module again (~165 man-days for a 6 m
                           // curtain module: a party of 40 about four days; the stone is the rubble at its foot) (EST)
  rebuildStand: 0.35,      // the strength of a module walled up in haste (rough coursed rubble, green mortar)
  repairQuiet: 60,         // m
  workHours: 10,           // man-hours in a working day
  // drops from the wall-walk (DESIGN on the accounts of hoardings and machicolations, research §12)
  dropS: 14,               // s between drops for a man at a hoarding/machicolation (fetch, aim, drop)
  bareMul: 0.3,            // leaning out through a crenel to hit the wall foot: a third as often, and he is exposed
  dropHit: 0.45,           // a dropped stone finds a man at the foot of the wall
  sandShare: 0.25,         // of drops: hot sand or quicklime (blinds, burns under the mail), the rest stones
  // murder holes in a gatehouse passage
  holeS: 20, holeHit: 0.55, holes: 4,
  // fire at the gate (battle clock, as engines burn)
  gatePrepS: 45, gateFireGrow: 0.004, gateBurnS: 300, gateDouse: 0.006, portFlam: 0.2,
  // sally
  posternS: 1.5,           // s a man to pass a postern (one abreast)
  sallyMaxS: 300,          // s out before the sally turns for home
  sallyFireP: 0.08,        // per s, per sally with 2+ men within 8 m of the engine: its fire-pots catch
  // provisions
  ration: 1,               // man-days of food a man eats per econ day
  hungerCourage: 0.012,    // courage lost per econ day starving
  sickDays: 10, sickDie: 0.01, // after this many days starving, this share of the garrison dies a day
};

const NB = [], NB2 = [];
const SOLIDF = (f) => { const D = FEATURES[f.type]; return D && D.climbS && D.cross?.foot === Infinity; };

// ─────────────────────────────────────────────────────────────── state
export function ensureWorks(w) {
  const Z = w.siege;
  if (!Z.works) Z.works = { mines: [], posts: [], barricades: [], sallies: [], holds: [], rubble: new Map(), rubVer: new Map(), nextId: 1, stats: { mined: 0, mineFights: 0, mineLost: 0, dropped: 0, dropHit: 0, holeHit: 0, barricaded: 0, barricadeBroken: 0, sallies: 0, surrendered: 0 } };
  return Z.works;
}
const bById = (w, id) => w.buildings.find((b) => b.id === id);
function hurt(w, i, sev, cause, by = -1, z = Z_TORSO) {
  const S = w.S; if (!S.alive[i]) return;
  const cs = w.cs;
  if (cs) { if (sev <= W_DISABLE) applyWound(cs.ctx, i, by, sev, z, cause); else fell(cs.ctx, i, by, sev, cause); return; }
  if (sev <= W_DISABLE) return;
  S.alive[i] = 0; S.state[i] = sev >= W_INSTANT ? S_DEAD : S_DOWN; S.downT[i] = w.time; S.posture[i] = 2;
  w.events.push({ t: w.tick, kind: sev >= W_INSTANT ? "kill" : "down", victim: i, by, cause, sev });
}
const able = (S, i) => S.alive[i] && S.status[i] < ST_FLEE && S.state[i] !== S_CAPT && S.state[i] !== S_FLEE;
const liveMembers = (w, u) => u ? u.members.filter((i) => able(w.S, i)) : [];

// inside a castle or walled town: castle.js's insideCastle, else the team's town inside its ring of walls
export function insideWalls(w, team, x, y) {
  const r = castleCall(w, "insideCastle", x, y);
  if (r !== undefined && r !== null) return !!r;
  const T = w.teams[team]?.town; if (!T) return false;
  return Math.hypot(x - T.x, y - T.y) < ringR(w, team) - 1;
}
function ringR(w, team) {
  const Z = ensureWorks(w), key = "r" + team, ver = w.buildings.length;
  if (Z[key] && Z[key].ver === ver) return Z[key].r;
  const T = w.teams[team]?.town; let r = 0;
  if (T) for (const b of w.buildings) if (b.team === team && (b.x1 !== undefined || isGate(b))) r = Math.max(r, b.x1 !== undefined ? Math.min(Math.hypot(b.x1 - T.x, b.y1 - T.y), Math.hypot(b.x2 - T.x, b.y2 - T.y), Math.hypot(b.x - T.x, b.y - T.y) + 3) : Math.hypot(b.x - T.x, b.y - T.y));
  Z[key] = { ver, r: r || 60 };
  return Z[key].r;
}
// a wall-ish building's outward unit normal at (x, y) (away from the town / castle centre)
function outward(w, b, x, y) {
  const g = modGeom(w, b, 0);
  const T = castleCall(w, "castleAt", x, y) || w.teams[b.team]?.town || { x: b.x, y: b.y };
  const cx = T.bailey?.x ?? T.keep?.x ?? T.x, cy = T.bailey?.y ?? T.keep?.y ?? T.y;
  if (!g.line) { const d = Math.hypot(g.x - cx, g.y - cy) || 1; return [(g.x - cx) / d, (g.y - cy) / d]; }
  let nx = -g.uy, ny = g.ux; if ((g.x - cx) * nx + (g.y - cy) * ny < 0) { nx = -nx; ny = -ny; } return [nx, ny];
}

// ─────────────────────────────────────────────────────────────── orders
export const WORK_ORDERS = new Set(["mine", "countermine", "barricade", "repair", "fire-gate", "sally"]);
export function worksOrder(w, u, o) {
  ensureWorks(w);
  const A = ARMS[u.arm];
  if (A.mounted || A.engine || u.isWorkers) return false;
  cancelWorks(w, u);
  if (o.kind === "mine") return startMine(w, u, o), true;
  if (o.kind === "countermine") return startPost(w, u, o), true;
  if (o.kind === "barricade") return startBarricade(w, u, o), true;
  if (o.kind === "repair") return startRepair(w, u, o), true;
  if (o.kind === "fire-gate") return startGateFire(w, u, o), true;
  if (o.kind === "sally") return startSally(w, u, o), true;
  return false;
}
// a new order of any kind takes the unit off its work (the mine stays, half-dug, for others to take up)
export function cancelWorks(w, u) {
  const W = w.siege?.works; if (!W) return;
  for (const m of W.mines) if (m.unit === u.id && m.state !== "done" && m.state !== "lost") { m.unit = null; if (m.state === "digging" || m.state === "chamber") w.events.push({ t: w.tick, kind: "mine-abandoned", team: m.team, mine: m.id }); }
  for (const p of W.posts) if (p.unit === u.id) p.unit = null;
  for (const b of W.barricades) if (b.unit === u.id) b.unit = null;
  if (u.works) u.works = null;
}
function goTo(w, u, x, y, facing, pace = "march") { const keep = u.order; applyOrder(w, u, { kind: "move", x, y, facing, raw: true, pace }); u.works && keep && (u.order = keep); }

// the enemy wall module or tower nearest a point (or the one named)
export function workTarget(w, team, x, y, bid, k, own = false) {
  let best = null, bd = 45;
  const cand = bid !== undefined ? [bById(w, bid)].filter(Boolean) : w.buildings;
  for (const b of cand) {
    if (b.ruin || (own ? b.team !== team : b.team === team)) continue;
    if (b.x1 === undefined && !isTowerB(w, b)) continue;
    const n = nMods(b);
    for (let j = 0; j < n; j++) {
      if (k !== undefined && bid !== undefined && j !== k) continue;
      const g = modGeom(w, b, j), d = Math.hypot(g.x - x, g.y - y);
      if (d < bd || bid !== undefined && !best) { bd = d; best = { b, k: j }; }
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────── MINING
function groundOf(w, b) { return partOf(w, b)?.ground || b.ground || w.siege?.ground || "earth"; }
export function startMine(w, u, o) {
  const W = ensureWorks(w);
  // an existing mine near the point, abandoned or unmanned: take it up
  let m = W.mines.find((q) => q.team === u.team && q.unit === null && (q.state === "digging" || q.state === "chamber") && Math.hypot(q.x0 - o.x, q.y0 - o.y) < 25);
  if (!m) {
    const t = workTarget(w, u.team, o.x, o.y, o.bid, o.k);
    if (!t) { w.events.push({ t: w.tick, kind: "mine-refused", team: u.team, unit: u.id, why: "no wall or tower there" }); return; }
    const g = modGeom(w, t.b, t.k), n = outward(w, t.b, g.x, g.y);
    const ground = groundOf(w, t.b);
    if ((MINE.rate[ground] ?? 1) < 0.5) w.events.push({ t: w.tick, kind: "mine-warning", team: u.team, unit: u.id, why: `the castle stands on ${ground}: the miners will make almost no way` });
    const x0 = o.from?.x ?? g.x + n[0] * MINE.startOut, y0 = o.from?.y ?? g.y + n[1] * MINE.startOut;
    const tx = g.x - n[0] * (g.th / 2 + (g.line ? 0 : g.r || 0) * 0.3), ty = g.y - n[1] * (g.th / 2);
    const len = Math.hypot(tx - x0, ty - y0) + 0.01; // to under the middle of the wall (the chamber is opened there)
    m = { id: W.nextId++, team: u.team, foe: t.b.team, unit: u.id, bid: t.b.id, k: t.k, tower: !g.line, x0, y0, tx, ty, len, dug: 0, prog: 0, state: "digging", ground, heard: false, hx: x0, hy: y0, t0: w.time, resumeAt: 0 };
    W.mines.push(m); W.stats.mined++;
    w.events.push({ t: w.tick, kind: "mine-started", team: u.team, mine: m.id, building: t.b.id, mod: t.k, x: x0, y: y0, len: Math.round(len), tower: m.tower });
  } else m.unit = u.id;
  u.works = { kind: "mine", id: m.id };
  u.order = { kind: "mine", x: m.x0, y: m.y0 };
  goTo(w, u, m.x0, m.y0, Math.atan2(m.ty - m.y0, m.tx - m.x0) - Math.PI / 2);
}
function mineTick(w, m) {
  const S = w.S, W = w.siege.works;
  if (m.state === "done" || m.state === "lost") return;
  const b = bById(w, m.bid);
  if (!b || b.ruin || (b.mods && b.mods[m.k] <= 0 && m.state !== "fired")) { if (m.state !== "fired") { m.state = "lost"; m.why = "the section is already down"; } return; }
  if (m.state === "fired") { // the props burn: nobody needs to be there
    m.prog += EDT / MINE.fireDays;
    if (m.prog >= 1) collapse(w, m, b);
    return;
  }
  const u = m.unit !== null ? w.units.get(m.unit) : null;
  if (!u || !u.members.length) { if (m.unit !== null) m.unit = null; return; }
  // the crew at the mouth (they work in shifts underground; the rest are at the mouth, hauling spoil)
  let crew = 0;
  for (const i of u.members) if (able(S, i) && Math.abs(S.x[i] - m.x0) < 15 && Math.abs(S.y[i] - m.y0) < 15) { crew++; if (S.state[i] !== S_FIGHT) { S.state[i] = S_WORK; S.busyT[i] = w.time + 1; } }
  if (!crew) return;
  if (w.time < m.resumeAt) return;
  const f = Math.min(1, crew / MINE.faceCrew) * (u.miners ? 1.3 : 1);
  if (m.state === "digging") {
    m.dug = Math.min(m.len, m.dug + (MINE.rate[m.ground] ?? 2) * f * EDT);
    const s = m.dug / m.len; m.hx = m.x0 + (m.tx - m.x0) * s; m.hy = m.y0 + (m.ty - m.y0) * s;
    if (m.dug >= m.len) { m.state = "chamber"; m.prog = 0; w.events.push({ t: w.tick, kind: "mine-under", team: m.team, mine: m.id, building: m.bid, mod: m.k }); }
    return;
  }
  if (m.state === "chamber") {
    m.prog = Math.min(1, m.prog + f * EDT / MINE.chamberDays);
    if (m.prog >= 1) {
      m.state = "fired"; m.prog = 0; m.unit = null; u.works = null;
      w.events.push({ t: w.tick, kind: "mine-fired", team: m.team, mine: m.id, building: m.bid, mod: m.k, x: m.tx, y: m.ty });
      for (const i of u.members) if (S.state[i] === S_WORK) { S.state[i] = S_IDLE; S.busyT[i] = 0; }
    }
  }
}
function collapse(w, m, b) {
  const W = w.siege.works, n = nMods(b), per = b.hpMax / n;
  if (!b.mods) b.mods = new Float32Array(n).fill(b.hp / n);
  const full = w.rng.next() < (m.tower ? MINE.towerFullP : MINE.fullP);
  m.state = "done";
  const g = modGeom(w, b, m.k);
  if (m.tower && full) {
    for (let j = 0; j < n; j++) b.mods[j] = 0;
    b.hp = 0;
    w.events.push({ t: w.tick, kind: "mine-collapse", team: b.team, by: m.team, mine: m.id, building: b.id, mod: m.k, x: g.x, y: g.y, tower: true, full: true });
    breach(w, b, m.k, { team: m.team }, "mine");
    return;
  }
  if (!full) { // it settled: the section cracked, it did not fall
    const lose = Math.max(0, b.mods[m.k] - per * 0.2); b.mods[m.k] -= lose; b.hp = Math.max(0, b.hp - lose);
    w.events.push({ t: w.tick, kind: "mine-collapse", team: b.team, by: m.team, mine: m.id, building: b.id, mod: m.k, x: g.x, y: g.y, tower: m.tower, full: false });
    modState(w, b, m.k);
    return;
  }
  b.hp = Math.max(0, b.hp - b.mods[m.k]); b.mods[m.k] = 0;
  for (const j of [m.k - 1, m.k + 1]) if (j >= 0 && j < n && b.mods[j] > 0) { const lose = b.mods[j] * MINE.sideDmg * w.rng.next(); b.mods[j] = Math.max(1, b.mods[j] - lose); b.hp -= lose; modState(w, b, j); }
  w.events.push({ t: w.tick, kind: "mine-collapse", team: b.team, by: m.team, mine: m.id, building: b.id, mod: m.k, x: g.x, y: g.y, tower: false, full: true });
  breach(w, b, m.k, { team: m.team }, "mine");
}

// ── countermining: a listening post, then a counter-gallery toward the mine heard
export function startPost(w, u, o) {
  const W = ensureWorks(w);
  let p = W.posts.find((q) => q.team === u.team && Math.hypot(q.x - o.x, q.y - o.y) < 15);
  if (!p) { p = { id: W.nextId++, team: u.team, x: o.x, y: o.y, unit: u.id, target: null, dug: 0 }; W.posts.push(p); }
  else p.unit = u.id;
  u.works = { kind: "countermine", id: p.id };
  u.order = { kind: "countermine", x: p.x, y: p.y };
  goTo(w, u, p.x, p.y);
  w.events.push({ t: w.tick, kind: "countermine-post", team: u.team, x: p.x, y: p.y });
}
function postCrew(w, p) {
  const u = p.unit !== null ? w.units.get(p.unit) : null; if (!u) return { u: null, n: 0, ids: [] };
  const S = w.S, ids = [];
  for (const i of u.members) if (able(S, i) && Math.abs(S.x[i] - p.x) < 15 && Math.abs(S.y[i] - p.y) < 15) ids.push(i);
  return { u, n: ids.length, ids };
}
// daily (econ) chance that a mine is heard: at a post (bowls of water on the ground, a drum with dried peas), or
// ambiently, when its head is close under the wall (spoil carted out, the noise at night)
function hearTick(w, m, dd) {
  const W = w.siege.works;
  if (m.heard || (m.state !== "digging" && m.state !== "chamber")) return;
  let p = 0;
  for (const q of W.posts) {
    if (q.team !== m.foe || postCrew(w, q).n < 2) continue;
    const d = Math.hypot(m.hx - q.x, m.hy - q.y); p = Math.max(p, MINE.hearP * clamp(1 - d / MINE.hearR, 0, 1));
  }
  const b = bById(w, m.bid);
  if (b) { const g = modGeom(w, b, m.k); if (Math.hypot(m.hx - g.x, m.hy - g.y) < MINE.ambientR + g.th) p = Math.max(p, MINE.ambientP); }
  if (p > 0 && w.rng.next() < 1 - Math.pow(1 - p, dd)) {
    m.heard = true;
    w.events.push({ t: w.tick, kind: "mine-detected", team: m.foe, mine: m.id, building: m.bid, mod: m.k, x: m.hx, y: m.hy });
  }
}
function postTick(w, p) {
  const W = w.siege.works, c = postCrew(w, p);
  if (!c.n) return;
  for (const i of c.ids) if (w.S.state[i] !== S_FIGHT) { w.S.state[i] = S_WORK; w.S.busyT[i] = w.time + 1; }
  // dig toward the nearest mine heard (of those still being dug or being propped)
  let m = p.target !== null ? W.mines.find((q) => q.id === p.target) : null;
  if (!m || m.state === "done" || m.state === "lost" || m.state === "fired") {
    m = null; let bd = 80;
    for (const q of W.mines) { if (q.foe !== p.team || !q.heard || (q.state !== "digging" && q.state !== "chamber")) continue; const d = Math.hypot(q.hx - p.x, q.hy - p.y); if (d < bd) { bd = d; m = q; } }
    if (m && p.target !== m.id) { p.target = m.id; p.dug = 0; w.events.push({ t: w.tick, kind: "countermine-started", team: p.team, mine: m.id, x: p.x, y: p.y }); }
    if (!m) { p.target = null; return; }
  }
  if (w.time < (p.resumeAt || 0)) return;
  const f = Math.min(1, c.n / MINE.faceCrew) * (c.u.miners ? 1.3 : 1);
  const b = bById(w, m.bid); const ground = m.ground;
  p.dug += (MINE.rate[ground] ?? 2) * f * EDT;
  const need = Math.hypot(m.hx - p.x, m.hy - p.y);
  if (p.dug >= need) underground(w, m, p, c);
}
// The two galleries meet. Up to four a side fight in the dark in a gallery a metre wide: three rounds, each man a
// chance to kill one of the other side; the side left stronger holds the ground and collapses (or smokes out, or
// floods) the other's gallery. Real men die: they are drawn from the two crews.
function underground(w, m, p, c) {
  const W = w.siege.works, S = w.S, F = MINE.fight;
  const mu = m.unit !== null ? w.units.get(m.unit) : null;
  const A = (mu ? liveMembers(w, mu) : []).slice(0, F.each), D = c.ids.slice(0, F.each);
  w.events.push({ t: w.tick, kind: "countermine-broke-in", team: p.team, mine: m.id, x: m.hx, y: m.hy });
  const deadA = [], deadD = [];
  let a = A.slice(), d = D.slice();
  const sk = (ids) => ids.length ? ids.reduce((s, i) => s + S.skill[i], 0) / ids.length : 0;
  for (let r = 0; r < F.rounds && a.length && d.length; r++) {
    const ka = a.length * F.kill * (1 + 0.8 * (sk(a) - sk(d))), kd = d.length * F.kill * (1 + 0.8 * (sk(d) - sk(a)));
    let na = 0, nd = 0; for (let j = 0; j < a.length; j++) if (w.rng.next() < ka / a.length) nd++; for (let j = 0; j < d.length; j++) if (w.rng.next() < kd / d.length) na++;
    for (let j = 0; j < nd && d.length; j++) deadD.push(d.splice((w.rng.next() * d.length) | 0, 1)[0]);
    for (let j = 0; j < na && a.length; j++) deadA.push(a.splice((w.rng.next() * a.length) | 0, 1)[0]);
  }
  for (const i of deadA) hurt(w, i, w.rng.next() < 0.6 ? W_INSTANT : W_MORTAL, "mine");
  for (const i of deadD) hurt(w, i, w.rng.next() < 0.6 ? W_INSTANT : W_MORTAL, "mine");
  const defWon = a.length === 0 ? true : d.length === 0 ? false : d.length / D.length >= a.length / Math.max(1, A.length) ? w.rng.next() < 0.6 : w.rng.next() < 0.3;
  W.stats.mineFights++;
  w.events.push({ t: w.tick, kind: "mine-fight", team: p.team, mine: m.id, x: m.hx, y: m.hy, attackersDead: deadA.length, defendersDead: deadD.length, won: defWon ? p.team : m.team });
  if (defWon) { m.state = "lost"; m.why = "countermined"; W.stats.mineLost++; const u = mu; if (u) u.works = null; m.unit = null; p.target = null; p.dug = 0; w.events.push({ t: w.tick, kind: "mine-lost", team: m.team, mine: m.id, why: "countermined: the gallery taken and collapsed" }); }
  else { p.dug = 0; p.resumeAt = w.time + MINE.lostDelayDays / ECON_DAYS_PER_REAL_SEC; m.resumeAt = w.time + MINE.lostDelayDays / ECON_DAYS_PER_REAL_SEC; w.events.push({ t: w.tick, kind: "countermine-lost", team: p.team, mine: m.id }); }
}

// ─────────────────────────────────────────────────────────────── BREACHES: rubble, barricades, repair
// The rubble slope of each breached module: a feature across the gap, slow going (a few men abreast). Kept in step
// with b.mods (a repaired module loses its rubble). Also a castle.js `breach` link per breach (plan §1).
function rubbleSync(w) {
  const W = w.siege.works;
  for (const b of w.buildings) {
    if (!b.mods || (b.x1 === undefined && !isTowerB(w, b))) continue;
    const ver = (b.breachVer || 0) + (b.ruin ? 1e6 : 0);
    if (W.rubVer.get(b.id) === ver) continue;
    W.rubVer.set(b.id, ver);
    const n = b.mods.length;
    for (let k = 0; k < n; k++) {
      const key = b.id + ":" + k, have = W.rubble.get(key), down = b.mods[k] <= 0;
      if (down && !have) {
        const g = modGeom(w, b, k);
        const f = g.line
          ? addFeature(w, { type: "breach_rubble", x0: g.x - g.ux * g.half, y0: g.y - g.uy * g.half, x1: g.x + g.ux * g.half, y1: g.y + g.uy * g.half, width: g.th + g.H * 1.6, src: "siege", building: b.id, mod: k, team: b.team })
          : addFeature(w, { type: "breach_rubble", x0: g.x - (g.r || 4), y0: g.y, x1: g.x + (g.r || 4), y1: g.y, width: (g.r || 4) * 2 + g.H, src: "siege", building: b.id, mod: k, team: b.team, tower: true });
        const link = breachLink(w, b, k, g);
        W.rubble.set(key, { f, link });
      } else if (!down && have) {
        removeFeature(w, have.f); if (have.link) castleCall(w, "removeLink", have.link.castle, have.link);
        W.rubble.delete(key);
        for (const bk of W.barricades) if (bk.bid === b.id && bk.k === k && bk.f) { removeFeature(w, bk.f); bk.f = null; bk.state = "gone"; }
      }
    }
  }
}
// the breach as a castle.js link: the rubble crest joins the wall-walk (either side of the gap) to the ground outside
// and inside (castle-plan §1). Width in men abreast; speed a multiplier on walking pace.
function breachLink(w, b, k, g) {
  const part = partOf(w, b), castle = castleOfB(w, b); if (!part || !castle) return null;
  const n = outward(w, b, g.x, g.y), lvl = wallWalkLevel(w, b, part);
  const link = { kind: "breach", a: { lvl: 0, x: g.x + n[0] * (g.th / 2 + g.H * 0.8), y: g.y + n[1] * (g.th / 2 + g.H * 0.8) }, b: { lvl, x: g.x, y: g.y }, c: { lvl: 0, x: g.x - n[0] * (g.th / 2 + g.H * 0.8), y: g.y - n[1] * (g.th / 2 + g.H * 0.8) }, width: 3, speed: 0.35, bid: b.id, mod: k, src: "siege" };
  const r = castleCall(w, "addLink", castle, link);
  const L = r && typeof r === "object" ? r : link; L.castle = castle;
  return L;
}
// the breach nearest a point, of `team`'s own walls
function breachNear(w, team, x, y, r = 40) {
  let best = null, bd = r;
  for (const b of w.buildings) {
    if (b.team !== team || !b.mods || b.ruin && !isTowerB(w, b)) continue;
    for (let k = 0; k < b.mods.length; k++) { if (b.mods[k] > 0) continue; const g = modGeom(w, b, k), d = Math.hypot(g.x - x, g.y - y); if (d < bd) { bd = d; best = { b, k, g }; } }
  }
  return best;
}
const enemyNear = (w, team, x, y, r) => { neighbours(w, x, y, r, NB2); const S = w.S; for (const o of NB2) if (S.alive[o] && S.team[o] !== team && S.status[o] < ST_FLEE && S.state[o] !== S_CAPT) return true; return false; };

export function startBarricade(w, u, o) {
  const W = ensureWorks(w);
  const br = o.bid !== undefined && o.k !== undefined ? (() => { const b = bById(w, o.bid); return b && b.mods && b.mods[o.k] <= 0 ? { b, k: o.k, g: modGeom(w, b, o.k) } : null; })() : breachNear(w, u.team, o.x, o.y);
  if (!br) { w.events.push({ t: w.tick, kind: "barricade-refused", team: u.team, unit: u.id, why: "no breach there" }); return; }
  let bk = W.barricades.find((q) => q.bid === br.b.id && q.k === br.k && q.state !== "broken" && q.state !== "gone");
  if (!bk) { bk = { id: W.nextId++, team: u.team, bid: br.b.id, k: br.k, prog: 0, hp: 1, state: "building", f: null, unit: u.id, paid: 0 }; W.barricades.push(bk); }
  bk.unit = u.id;
  const n = outward(w, br.b, br.g.x, br.g.y), ix = br.g.x - n[0] * (br.g.th / 2 + 4), iy = br.g.y - n[1] * (br.g.th / 2 + 4);
  u.works = { kind: "barricade", id: bk.id }; u.order = { kind: "barricade", x: ix, y: iy };
  goTo(w, u, ix, iy, Math.atan2(n[1], n[0]) - Math.PI / 2, "quick");
}
function barricadeTick(w, bk) {
  const S = w.S, W = w.siege.works, b = bById(w, bk.bid);
  if (!b || bk.state === "broken" || bk.state === "gone") return;
  if (b.mods && b.mods[bk.k] > 0) { if (bk.f) { removeFeature(w, bk.f); bk.f = null; } bk.state = "gone"; return; }
  const g = modGeom(w, b, bk.k), n = outward(w, b, g.x, g.y);
  if (bk.state === "building") {
    const u = bk.unit !== null ? w.units.get(bk.unit) : null; if (!u) return;
    if (enemyNear(w, bk.team, g.x, g.y, WORKS.barricadeQuiet)) { bk.status = "under attack: no work"; return; }
    let n0 = 0; for (const i of u.members) if (able(S, i) && Math.hypot(S.x[i] - g.x, S.y[i] - g.y) < 20) { n0++; if (S.state[i] !== S_FIGHT) { S.state[i] = S_WORK; S.busyT[i] = w.time + 1; } }
    if (!n0) { bk.status = "waiting for the men"; return; }
    const T = w.teams[bk.team], add = n0 * WORKS.workHours * EDT / WORKS.barricadeManHours;
    if (T?.store && T.store.timber !== undefined) { const need = WORKS.barricadeTimber * add; if ((T.store.timber || 0) < need) { bk.status = "no timber"; return; } EC.take(T, "timber", need); }
    bk.prog = Math.min(1, bk.prog + add); bk.status = "building";
    if (bk.prog >= 1) {
      bk.state = "up"; bk.hp = 1; W.stats.barricaded++;
      // across the gap, a little inside the line of the wall (the retrenchment is built behind the breach)
      const cx = g.x - n[0] * (g.th / 2 + 1.5), cy = g.y - n[1] * (g.th / 2 + 1.5);
      const hx = g.line ? g.ux * (g.half + 0.8) : -n[1] * ((g.r || 4) + 1), hy = g.line ? g.uy * (g.half + 0.8) : n[0] * ((g.r || 4) + 1);
      bk.f = addFeature(w, { type: "breach_barricade", x0: cx - hx, y0: cy - hy, x1: cx + hx, y1: cy + hy, width: 1.2, src: "siege", team: bk.team, barricade: bk.id, building: b.id });
      bk.cx = cx; bk.cy = cy; bk.nx = n[0]; bk.ny = n[1];
      const u2 = w.units.get(bk.unit); if (u2) { u2.works = null; for (const i of u2.members) if (S.state[i] === S_WORK) { S.state[i] = S_IDLE; S.busyT[i] = 0; } }
      w.events.push({ t: w.tick, kind: "breach-barricaded", team: bk.team, barricade: bk.id, building: b.id, mod: bk.k, x: cx, y: cy });
    }
    return;
  }
  // up: attackers at its outer face pull it down (battle clock), the defenders behind it hinder them
  if (w.tick % 5) return;
  neighbours(w, bk.cx, bk.cy, (g.half || 4) + 3, NB);
  let att = 0, def = 0;
  for (const o of NB) {
    if (!able(S, o) || levelOf(w, o) > 0) continue;
    const s = (S.x[o] - bk.cx) * bk.nx + (S.y[o] - bk.cy) * bk.ny;
    if (S.team[o] !== bk.team) { if (s > 0 && s < 2.2) att++; } else if (s < 0 && s > -3) def++;
  }
  if (!att) return;
  const rate = Math.min(att, 8) * (1 / (1 + 0.6 * def / Math.max(1, att)));
  bk.hp -= rate * DT * 5 / WORKS.barricadeHp;
  if (bk.hp <= 0) {
    bk.state = "broken"; W.stats.barricadeBroken++;
    if (bk.f) { removeFeature(w, bk.f); bk.f = null; }
    w.events.push({ t: w.tick, kind: "barricade-broken", team: bk.team, barricade: bk.id, building: bk.bid, mod: bk.k, x: bk.cx, y: bk.cy });
  }
}
export function barricadeInfo(w, id) { const bk = w.siege?.works?.barricades.find((q) => q.id === id); return bk ? { state: bk.state, prog: bk.prog, hp: bk.hp, status: bk.status || bk.state } : null; }

export function startRepair(w, u, o) {
  const t = workTarget(w, u.team, o.x, o.y, o.bid, o.k, true);
  if (!t) { w.events.push({ t: w.tick, kind: "repair-refused", team: u.team, unit: u.id, why: "nothing of ours to repair there" }); return; }
  const g = modGeom(w, t.b, t.k), n = outward(w, t.b, g.x, g.y), ix = g.x - n[0] * (g.th / 2 + 4), iy = g.y - n[1] * (g.th / 2 + 4);
  u.works = { kind: "repair", bid: t.b.id }; u.order = { kind: "repair", x: ix, y: iy };
  goTo(w, u, ix, iy);
}
// A battered module is patched at WORKS.repairShare of its build labour. A BREACHED one is a heap of rubble with a gap
// above it: before it stands again (and closes its line) the gap must be walled up course by course — a real job of
// masonry (WORKS.rebuildShare of the build labour, days for a work party), kept in b.rebuild[k] (0..1). The module stays
// a breach (rubble, link, no wall line) until it is done; work stops while the enemy is near and goes on from where it
// stopped; a party called off leaves its courses standing for the next.
function repairTick(w, u) {
  const S = w.S, b = bById(w, u.works.bid);
  if (!b || b.ruin || !b.mods) { u.works = null; return; }
  const n = b.mods.length, per = b.hpMax / n;
  let k = 0; for (let j = 1; j < n; j++) if (b.mods[j] < b.mods[k]) k = j;
  if (b.mods[k] >= per - 1e-6) { u.works = null; for (const i of u.members) if (S.state[i] === S_WORK) S.state[i] = S_IDLE; w.events.push({ t: w.tick, kind: "repaired", team: b.team, building: b.id }); return; }
  const g = modGeom(w, b, k);
  if (enemyNear(w, u.team, g.x, g.y, WORKS.repairQuiet)) { u.works.status = "the enemy is at the wall"; return; }
  let n0 = 0; for (const i of u.members) if (able(S, i) && Math.hypot(S.x[i] - g.x, S.y[i] - g.y) < 30) { n0++; if (S.state[i] !== S_FIGHT) { S.state[i] = S_WORK; S.busyT[i] = w.time + 1; } }
  if (!n0) { u.works.status = "waiting for the men"; return; }
  const def = BUILDINGS[b.kind], labour = def ? (def.perMetre ? def.labour * (b.length || 6 * n) : def.labour) / n : 600; // man-days per module
  const T = w.teams[b.team], down = b.mods[k] <= 0;
  const share = down ? WORKS.rebuildShare : WORKS.repairShare, frac = n0 * EDT / (share * labour);
  const gain = down ? Math.min(1 - ((b.rebuild ||= new Float32Array(n))[k] || 0), frac) * WORKS.rebuildStand * per : Math.min(per - b.mods[k], frac * per);
  if (T?.store && def?.mat) { for (const [r, q] of Object.entries(def.mat)) { const need = q * (def.perMetre ? (b.length || 6 * n) / n : 1 / n) * WORKS.repairShare * gain / per; if ((T.store[r] || 0) < need) { u.works.status = "no " + r; return; } } for (const [r, q] of Object.entries(def.mat)) EC.take(T, r, q * (def.perMetre ? (b.length || 6 * n) / n : 1 / n) * WORKS.repairShare * gain / per); }
  if (down) {
    b.rebuild[k] = Math.min(1, b.rebuild[k] + gain / (WORKS.rebuildStand * per));
    u.works.status = `walling up the breach (${Math.round(b.rebuild[k] * 100)} %)`; u.works.prog = b.rebuild[k];
    if (b.rebuild[k] < 1 - 1e-6) return;
    // the gap is walled up: the module stands again (rough, WORKS.rebuildStand of its strength) and closes its line
    b.rebuild[k] = 0; b.mods[k] = WORKS.rebuildStand * per; b.hp = Math.min(b.hpMax, b.hp + b.mods[k]);
    modState(w, b, k);
    if (b.x1 !== undefined) EC.blockWall(w, b, true);
    w.featuresVer = (w.featuresVer || 0) + 1; b.breachVer = (b.breachVer || 0) + 1;
    w.events.push({ t: w.tick, kind: "breach-repaired", team: b.team, building: b.id, mod: k, x: g.x, y: g.y });
    return;
  }
  u.works.status = "patching the masonry"; u.works.prog = b.mods[k] / per;
  b.mods[k] += gain; b.hp = Math.min(b.hpMax, b.hp + gain);
  modState(w, b, k);
}
// how far the walling-up of a breached module has got (0..1), for the UI
export const rebuildProg = (b, k) => b?.rebuild?.[k] || 0;

// ─────────────────────────────────────────────────────────────── the GATE: fire, murder holes
export function startGateFire(w, u, o) {
  let best = null, bd = 60;
  for (const b of w.buildings) { if (!isGate(b) || b.team === u.team || b.ruin || b.gateBroken) continue; if (o.bid !== undefined && b.id !== o.bid) continue; const G = gateGeom(b), d = Math.hypot(G.px - o.x, G.py - o.y); if (d < bd || o.bid !== undefined) { bd = d; best = b; } }
  if (!best) { w.events.push({ t: w.tick, kind: "fire-gate-refused", team: u.team, unit: u.id, why: "no enemy gate there" }); return; }
  const G = gateGeom(best), n = outward(w, best, G.px, G.py), depth = gateDepth(best);
  const fx = G.px + n[0] * (depth / 2 + 1.5), fy = G.py + n[1] * (depth / 2 + 1.5);
  u.works = { kind: "fire-gate", bid: best.id, fx, fy, at: null };
  u.order = { kind: "fire-gate", x: fx, y: fy, pace: "quick" };
  const keep = u.order; applyOrder(w, u, { kind: "move", x: fx + n[0] * 20, y: fy + n[1] * 20, raw: true, pace: "quick", facing: Math.atan2(-n[1], -n[0]) - Math.PI / 2 }); u.order = keep;
  u.path = (u.path || []).concat([[fx, fy]]);
}
const gateDepth = (b) => (b.kind === "gatehouse" || b.depth) ? (b.depth || BUILDINGS.gatehouse.footprint[1]) : 2;
function gateFireTick(w, u) {
  const S = w.S, W = u.works, b = bById(w, W.bid);
  if (!b || b.ruin || b.gateBroken) { u.works = null; return; }
  let n = 0; for (const i of u.members) if (able(S, i) && Math.hypot(S.x[i] - W.fx, S.y[i] - W.fy) < 6) n++;
  if (n < 3) return;
  if (W.at === null) { W.at = w.time; w.events.push({ t: w.tick, kind: "gate-fire-laid", team: u.team, building: b.id }); }
  if (b.gfireOutT && b.gfireOutT > W.at) W.at = b.gfireOutT; // put out: the faggots must be piled again
  if (w.time - W.at >= WORKS.gatePrepS && !(b.gfire > 0)) { b.gfire = 0.2; w.events.push({ t: w.tick, kind: "gate-fired", team: b.team, building: b.id, by: u.team }); }
}
// the fire burns on the battle clock whoever is there; defenders above pour water on it
function gateBurnTick(w, b) {
  if (!(b.gfire > 0) || b.ruin || b.gateBroken) { if (b.gfire) b.gfire = 0; return; }
  const S = w.S, G = gateGeom(b);
  const fl = b.gl > 0 ? 1 : WORKS.portFlam;
  let dousers = 0;
  if (w.tick % 10 === 0) {
    neighbours(w, G.px, G.py, 12, NB);
    const n = outward(w, b, G.px, G.py);
    for (const o of NB) if (able(S, o) && S.team[o] === b.team && (levelOf(w, o) > 0 || (S.x[o] - G.px) * n[0] + (S.y[o] - G.py) * n[1] < 0)) dousers++;
    b.gDousers = dousers;
  }
  dousers = b.gDousers || 0;
  b.gfire = clamp(b.gfire + WORKS.gateFireGrow * fl * DT - WORKS.gateDouse * Math.min(1, dousers / 4) * DT, 0, 1);
  if (b.gfire <= 0) { b.gfireOutT = w.time; w.events.push({ t: w.tick, kind: "gate-fire-out", team: b.team, building: b.id }); return; }
  gateHit(w, b, b.gfire * fl * DT / WORKS.gateBurnS, "fire");
}
// Murder holes: the vault of a gatehouse passage is pierced; men in the chamber above drop stones (and water on a
// fire) on whoever is in the passage below. A timber gate has none.
function holesTick(w, b) {
  const holes = b.murderHoles ?? partOf(w, b)?.murderHoles ?? (b.kind === "gatehouse" ? WORKS.holes : 0);
  if (!holes) return;
  const S = w.S, G = gateGeom(b), depth = gateDepth(b), n = outward(w, b, G.px, G.py);
  neighbours(w, G.px, G.py, Math.max(12, depth), NB);
  const tgt = [], droppers = [], lv = !!partOf(w, b); // (a castle's gatehouse: the men up in its chamber; else men just inside)
  for (const o of NB) {
    if (!able(S, o)) continue;
    const s = (S.x[o] - G.px) * n[0] + (S.y[o] - G.py) * n[1], a = (S.x[o] - G.px) * G.ux + (S.y[o] - G.py) * G.uy;
    if (S.team[o] !== b.team) { if (levelOf(w, o) === 0 && Math.abs(a) <= GATE_PASSAGE + 0.3 && Math.abs(s) <= depth / 2) tgt.push(o); }
    else if (lv ? levelOf(w, o) > 0 : (s < -1 && s > -12)) droppers.push(o);
  }
  if (!tgt.length || !droppers.length) return;
  const W = w.siege.works, k = Math.min(holes, droppers.length);
  for (let j = 0; j < k; j++) {
    if (w.rng.next() >= 1 / WORKS.holeS) continue; // one drop per hole every ~20 s (this runs once a second)
    W.stats.dropped++;
    const i = tgt[(w.rng.next() * tgt.length) | 0];
    if (w.rng.next() >= WORKS.holeHit) continue;
    W.stats.holeHit++; dropOn(w, i, droppers[j], "murder-hole", 0.15);
  }
}
// a stone (or hot sand) from above on man i
function dropOn(w, i, by, cause, sand) {
  const S = w.S, r = w.rng.next();
  w.events.push({ t: w.tick, kind: "dropped", who: i, by, cause, what: r < sand ? "sand" : "stone" });
  if (r < sand) { // hot sand / quicklime: it gets under the mail, blinds and burns; a man so struck is out of the fight
    S.stress[i] += 0.35 * (1.3 - S.courage[i]); S.stunT[i] = Math.max(S.stunT[i], w.time + 6);
    if (w.rng.next() < 0.35) hurt(w, i, W_INCAP, cause + "-sand", by); else hurt(w, i, W_DISABLE, cause + "-sand", by, Z_HEAD);
    return;
  }
  const helm = Math.min(0.5, S.armour[i] * 0.08), q = w.rng.next();
  const sev = q < 0.22 * (1 - helm) ? W_INSTANT : q < 0.45 * (1 - helm) ? W_MORTAL : q < 0.75 ? W_INCAP : W_DISABLE;
  hurt(w, i, sev, cause, by, Z_HEAD);
  S.stress[i] += 0.1 * (1.3 - S.courage[i]);
}
// Drops at the wall foot. For each standing wall line: attackers at its foot (outside, within 2.5 m of the face,
// on the ground) and defenders on the walk above it; each defender drops every WORKS.dropS s from a hoarding or
// machicolation, a third as often over a bare parapet; a ram's roof or a tower's sides keep them off.
function dropsTick(w) {
  const S = w.S, W = w.siege.works;
  for (const f of w.features || []) {
    if (f.team === undefined || f.barricade || !SOLIDF(f) || f.gate) continue;
    const b = f.building !== undefined ? bById(w, f.building) : null;
    const hoard = !!(b && (b.hoard || b.machicolated || partOf(w, b)?.hoard || partOf(w, b)?.machicolated)) || (b?.kind === "gatehouse");
    const dx = f.x1 - f.x0, dy = f.y1 - f.y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    const mx = (f.x0 + f.x1) / 2, my = (f.y0 + f.y1) / 2;
    const T = castleCall(w, "castleAt", mx, my) || w.teams[f.team]?.town || null; if (!T) continue;
    let nx = -uy, ny = ux; if (((T.x ?? T.bailey?.x) - mx) * nx + ((T.y ?? T.bailey?.y) - my) * ny > 0) { nx = -nx; ny = -ny; } // outward
    neighbours(w, mx, my, L / 2 + 5, NB);
    const lv = !!(b && partOf(w, b)); // a castle wall: the defenders must be up on its walk (castle.js levels)
    let att = null, defs = null; const th = (f.width || 1) / 2;
    for (const o of NB) {
      if (!S.alive[o] || S.state[o] === S_CAPT) continue;
      const s = (S.x[o] - f.x0) * nx + (S.y[o] - f.y0) * ny, a = (S.x[o] - f.x0) * ux + (S.y[o] - f.y0) * uy;
      if (a < -0.5 || a > L + 0.5) continue;
      if (S.team[o] !== f.team) { if (levelOf(w, o) === 0 && s > th && s < th + 2.5) (att ||= []).push(o); }
      else if (able(S, o) && (lv ? levelOf(w, o) > 0 && Math.abs(s) < th + 1.5 : s < -th + 0.1 && s > -th - 3.5)) (defs ||= []).push(o);
    }
    if (!att || !defs) continue;
    const perS = hoard ? WORKS.dropS : WORKS.dropS / WORKS.bareMul;
    for (const d of defs.slice(0, Math.ceil(L / 2))) {
      if (w.rng.next() >= 1 / perS) continue;
      const ad = (S.x[d] - f.x0) * ux + (S.y[d] - f.y0) * uy;
      let i = -1, bd = 4; for (const o of att) { const q = Math.abs((S.x[o] - f.x0) * ux + (S.y[o] - f.y0) * uy - ad); if (q < bd && S.alive[o]) { bd = q; i = o; } }
      if (i < 0) continue;
      W.stats.dropped++;
      if (w.siege.cover && w.siege.cover(w, i, { ux: 0, uy: 0, ang: 1.5 }) > 0 && w.rng.next() < 0.9) continue; // under the ram's roof
      if (w.rng.next() >= WORKS.dropHit) continue;
      W.stats.dropHit++; dropOn(w, i, d, hoard ? "machicolation" : "parapet", WORKS.sandShare);
    }
  }
}

// ─────────────────────────────────────────────────────────────── SALLY
function posternOf(w, team, x, y) {
  let best = null, bd = 1e9;
  for (const c of w.castles || []) {
    if (c.team !== team) continue;
    for (const p of c.parts || []) if (p.kind === "postern") { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = { x: p.x, y: p.y, nx: p.nx, ny: p.ny, part: p }; } }
  }
  if (best && best.nx === undefined) { const c = castleCall(w, "castleAt", best.x, best.y) || w.teams[team]?.town; const d = Math.hypot(best.x - c.x, best.y - c.y) || 1; best.nx = (best.x - c.x) / d; best.ny = (best.y - c.y) / d; }
  for (const b of w.buildings) if (b.team === team && b.postern && !b.ruin) { const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; const n = outward(w, b, b.x, b.y); best = { x: b.x, y: b.y, nx: n[0], ny: n[1] }; } }
  return best;
}
export function startSally(w, u, o) {
  const W = ensureWorks(w);
  // the target: the enemy engine nearest the point (else the point itself)
  let eng = null, bd = 60;
  for (const e of w.siege.engines) { if (e.team === u.team || e.state === "burnt") continue; const d = Math.hypot(e.x - o.x, e.y - o.y); if (d < bd) { bd = d; eng = e; } }
  const post = posternOf(w, u.team, o.x, o.y);
  let gate = null;
  if (!post) { let gd = 1e9; for (const b of w.buildings) if (b.team === u.team && isGate(b) && !b.ruin) { const G = gateGeom(b), d = Math.hypot(G.px - o.x, G.py - o.y); if (d < gd) { gd = d; gate = b; } } }
  if (!post && !gate) { w.events.push({ t: w.tick, kind: "sally-refused", team: u.team, unit: u.id, why: "no postern or gate to go out by" }); return; }
  let door;
  if (post) door = { x: post.x, y: post.y, nx: post.nx, ny: post.ny, postern: true };
  else { const G = gateGeom(gate), n = outward(w, gate, G.px, G.py); door = { x: G.px, y: G.py, nx: n[0], ny: n[1], gate: gate.id, depth: gateDepth(gate) }; }
  const s = { id: W.nextId++, team: u.team, unit: u.id, eng: eng?.id ?? null, tx: eng ? eng.x : o.x, ty: eng ? eng.y : o.y, door, phase: "to-door", t0: w.time, n0: u.members.length, out: new Set(), passT: 0 };
  W.sallies.push(s); W.stats.sallies++;
  u.works = { kind: "sally", id: s.id }; u.order = { kind: "sally", x: s.tx, y: s.ty };
  const inx = door.x - door.nx * ((door.depth || 2) / 2 + 3), iny = door.y - door.ny * ((door.depth || 2) / 2 + 3);
  s.in = [inx, iny]; s.outP = [door.x + door.nx * ((door.depth || 2) / 2 + 3), door.y + door.ny * ((door.depth || 2) / 2 + 3)];
  goTo(w, u, inx, iny, Math.atan2(door.ny, door.nx) - Math.PI / 2, "quick");
}
function sallyTick(w, s) {
  const S = w.S, u = w.units.get(s.unit), W = w.siege.works;
  if (!u || !u.members.length || s.phase === "done") { s.phase = "done"; if (s.door.gate !== undefined) { const g = bById(w, s.door.gate); if (g) g.sallyOpen = false; } return; }
  const t = w.time, gateB = s.door.gate !== undefined ? bById(w, s.door.gate) : null;
  const outside = (i) => (S.x[i] - s.door.x) * s.door.nx + (S.y[i] - s.door.y) * s.door.ny > 0;
  const live = liveMembers(w, u);
  if (s.phase === "to-door") {
    const at = live.filter((i) => Math.hypot(S.x[i] - s.in[0], S.y[i] - s.in[1]) < 12).length;
    if (at >= Math.max(1, live.length * 0.6) || (!u.path && t - s.t0 > 60)) { s.phase = "out"; if (gateB) gateB.sallyOpen = true; w.events.push({ t: w.tick, kind: "sally-out", team: s.team, unit: u.id, by: s.door.postern ? "postern" : "gate", x: s.door.x, y: s.door.y }); }
    return;
  }
  if (s.phase === "out") {
    // through the door: one man at a time by the postern; by the open gate they simply march (it is held open)
    if (s.door.postern) {
      if (t >= s.passT) { const i = live.find((q) => !outside(q) && Math.hypot(S.x[q] - s.in[0], S.y[q] - s.in[1]) < 14); if (i !== undefined) { place(w, i, s.outP[0] + (w.rng.next() - 0.5) * 2, s.outP[1] + (w.rng.next() - 0.5) * 2); s.passT = t + WORKS.posternS; } }
    }
    const outN = live.filter(outside).length;
    if (outN >= live.length * 0.9 || (s.door.postern ? false : t - s.t0 > 90)) {
      s.phase = "attack"; s.tAtt = t;
      const keep = u.order; applyOrder(w, u, { kind: "assault", x: s.tx, y: s.ty, raw: true, pace: "charge" }); u.order = keep;
      if (gateB) gateB.sallyOpen = true;
    } else if (!s.door.postern && !u.path) { const keep = u.order; applyOrder(w, u, { kind: "move", x: s.outP[0] + s.door.nx * 8, y: s.outP[1] + s.door.ny * 8, raw: true, pace: "quick" }); u.order = keep; }
    return;
  }
  if (s.phase === "attack") {
    const e = s.eng !== null ? engineById(w, s.eng) : null;
    if (e && e.state !== "burnt") {
      let at = 0; for (const i of live) if (Math.hypot(S.x[i] - e.x, S.y[i] - e.y) < 8) at++;
      if (at >= 2) e.harriedT = t + 1.5; // (the crew are fighting for their engine, not beating out the fire)
      if (at >= 2 && w.tick % 10 === 0 && w.rng.next() < WORKS.sallyFireP * 1) { if (!(e.fire > 0)) w.events.push({ t: w.tick, kind: "engine-fired", team: e.team, engine: e.id, what: e.kind, by: "sally" }); e.fire = Math.max(e.fire, 0.2); }
      if (!u.path && Math.hypot(u.ax - e.x, u.ay - e.y) > 8) { const keep = u.order; applyOrder(w, u, { kind: "assault", x: e.x, y: e.y, raw: true, pace: "quick" }); u.order = keep; }
    }
    const crewLeft = e && e.unit !== null && w.units.get(e.unit)?.members.some((i) => able(S, i) && Math.hypot(S.x[i] - e.x, S.y[i] - e.y) < 14);
    const done = !e || e.state === "burnt" || e.hp < e.hpMax * 0.5 || (e.fire > 0.3 && !crewLeft), /* (wrecked, or burning with nobody left to beat it out) */ lost = live.length < s.n0 * 0.6, late = t - s.tAtt > WORKS.sallyMaxS;
    if (done || lost || late || u.c?.broken) {
      s.phase = "back"; s.tBack = t;
      w.events.push({ t: w.tick, kind: "sally-back", team: s.team, unit: u.id, why: done ? "the engine is wrecked or burning" : lost ? "too many lost" : "time to go in", engine: e?.id });
      const keep = u.order; applyOrder(w, u, { kind: "move", x: s.outP[0] + s.door.nx * 4, y: s.outP[1] + s.door.ny * 4, raw: true, pace: "quick" }); u.order = keep;
    }
    return;
  }
  if (s.phase === "back") {
    if (s.door.postern) {
      if (t >= s.passT) { const i = live.find((q) => outside(q) && Math.hypot(S.x[q] - s.outP[0], S.y[q] - s.outP[1]) < 14); if (i !== undefined) { place(w, i, s.in[0] + (w.rng.next() - 0.5) * 2, s.in[1] + (w.rng.next() - 0.5) * 2); s.passT = t + WORKS.posternS; } }
    } else if (!u.path) { const keep = u.order; applyOrder(w, u, { kind: "move", x: s.in[0] - s.door.nx * 6, y: s.in[1] - s.door.ny * 6, raw: true, pace: "quick" }); u.order = keep; }
    const outN = live.filter(outside).length;
    if (outN === 0 || t - s.tBack > 180) {
      s.phase = "done"; if (gateB) gateB.sallyOpen = false; u.works = null;
      const keep = { kind: "hold" }; applyOrder(w, u, { kind: "move", x: s.in[0] - s.door.nx * 6, y: s.in[1] - s.door.ny * 6, raw: true }); u.order = keep;
      w.events.push({ t: w.tick, kind: "sally-in", team: s.team, unit: u.id, left: outN, lost: s.n0 - live.length });
    }
  }
}

// ─────────────────────────────────────────────────────────────── PROVISIONS, STARVATION, SURRENDER
// setProvisions(w, { team, manDays | days, castle?, resolve? }) → the hold. `days` = days for the garrison now inside.
export function setProvisions(w, o) {
  const W = ensureWorks(w);
  let h = W.holds.find((q) => q.team === o.team && (o.castle === undefined || q.castle === o.castle));
  const gar = garrison(w, o.team).length;
  if (!h) { h = { team: o.team, castle: o.castle ?? null, food: 0, g0: gar, starving: 0, day: 0, yielded: false, resolve: o.resolve ?? 0.5, respite: null, auto: o.auto ?? true, acc: 0 }; W.holds.push(h); }
  h.food = o.manDays ?? (o.days ?? 60) * Math.max(1, gar);
  if (o.resolve !== undefined) h.resolve = o.resolve;
  h.g0 = Math.max(h.g0, gar);
  return h;
}
export function garrison(w, team) {
  const S = w.S, out = [];
  for (const u of w.units.values()) { if (u.team !== team || u.isWorkers || ARMS[u.arm].engine) continue; for (const i of u.members) if (able(S, i) && insideWalls(w, team, S.x[i], S.y[i])) out.push(i); }
  return out;
}
export const foodDays = (w, h) => h.food / Math.max(1, garrison(w, h.team).length);
// A respite (a custom of war): the garrison undertakes to yield on a set day unless relieved — Stirling 1314 (by
// Midsummer), and the common 40 days. Relief = an army of theirs within 2 km that is not the garrison.
export function offerRespite(w, team, days = 40) {
  const h = ensureWorks(w).holds.find((q) => q.team === team); if (!h || h.yielded) return null;
  h.respite = { until: h.day + days };
  w.events.push({ t: w.tick, kind: "respite", team, days, until: h.respite.until });
  return h.respite;
}
function relieved(w, h) {
  const T = w.teams[h.team]?.town, S = w.S; if (!T) return false;
  let n = 0;
  for (const u of w.units.values()) { if (u.team !== h.team || u.isWorkers || u.c?.broken || !u.members.length) continue; if (insideWalls(w, h.team, u.ax, u.ay)) continue; if (Math.hypot(u.ax - T.x, u.ay - T.y) < 2000) n += u.members.length; }
  return n >= Math.max(40, h.g0);
}
// daily judgement of the captain of the garrison (econ clock): hazard per day of yielding
export function yieldHazard(w, h, gar, att) {
  const fd = h.food / Math.max(1, gar);
  let p = 0;
  if (h.food <= 0) p += 0.12 + 0.02 * Math.min(10, h.starving);                 // starving: horses eaten, then the end (Rochester, Kenilworth)
  else if (fd < 5) p += 0.03;
  const open = w.buildings.some((b) => b.team === h.team && b.mods && [...b.mods].some((v) => v <= 0)) && !w.siege.works.barricades.some((q) => q.team === h.team && q.state === "up");
  if (open && att > 3 * gar) p += 0.06;                                            // a practicable breach and no retrenchment: yield before the storm (the law of arms — Bedford 1224 was hanged for refusing)
  if (gar < h.g0 * 0.25) p += 0.15;
  return p * (1.3 - h.resolve);
}
function holdTick(w, h, dd) {
  if (h.yielded) return;
  const S = w.S, gar = garrison(w, h.team);
  h.day += dd;
  h.food = Math.max(0, h.food - gar.length * WORKS.ration * dd);
  if (h.food <= 0) {
    h.starving += dd;
    for (const i of gar) S.courage[i] = Math.max(0.02, S.courage[i] - WORKS.hungerCourage * dd);
    if (h.starving > WORKS.sickDays) for (const i of gar) if (w.rng.next() < WORKS.sickDie * dd) hurt(w, i, W_INSTANT, "hunger");
    if (!h.saidStarve) { h.saidStarve = true; w.events.push({ t: w.tick, kind: "garrison-starving", team: h.team }); }
  }
  if (!h.auto) return;
  // once an econ day
  h.acc += dd; if (h.acc < 1) return; h.acc -= 1;
  if (h.respite) { if (relieved(w, h)) { w.events.push({ t: w.tick, kind: "relieved", team: h.team }); h.respite = null; } else if (h.day >= h.respite.until) return surrender(w, h, gar, "respite"); }
  let att = 0; const T = w.teams[h.team]?.town;
  if (T) for (const u of w.units.values()) if (u.team !== h.team && !u.isWorkers && Math.hypot(u.ax - T.x, u.ay - T.y) < 400) att += u.members.length;
  if (!gar.length) return;
  if (w.rng.next() < yieldHazard(w, h, gar.length, att)) surrender(w, h, gar, h.food <= 0 ? "starvation" : "terms");
}
// The garrison yields. Terms, by the custom of the time: a garrison that yields before a storm marches out with its
// arms and goods ("with the honours"), one starved out yields its lives saved (the knights held to ransom), one that
// held out past a practicable breach is at the victor's discretion. They leave the fight either way.
export function surrender(w, h, gar = garrison(w, h.team), why = "terms") {
  const S = w.S, W = w.siege.works;
  h.yielded = true; W.stats.surrendered++;
  const terms = why === "respite" || why === "terms" ? "honours" : why === "starvation" ? "lives" : "discretion";
  for (const i of gar) { S.state[i] = S_CAPT; S.status[i] = ST_SURR; S.alive[i] = 0; }
  for (const b of w.buildings) if (b.team === h.team && isGate(b)) { b.forcedOpen = true; }
  w.events.push({ t: w.tick, kind: "surrender", team: h.team, castle: h.castle, why, terms, garrison: gar.length, day: Math.round(h.day * 10) / 10 });
  return terms;
}

// ─────────────────────────────────────────────────────────────── the tick (from siegeSystem)
export function worksTick(w) {
  const W = ensureWorks(w);
  if (w.tick % 10 === 3) rubbleSync(w);
  for (const m of W.mines) mineTick(w, m);
  if (w.tick % 10 === 5) for (const m of W.mines) hearTick(w, m, 10 * EDT);
  for (const p of W.posts) postTick(w, p);
  for (const bk of W.barricades) barricadeTick(w, bk);
  for (const u of w.units.values()) { const k = u.works?.kind; if (k === "repair") repairTick(w, u); else if (k === "fire-gate") gateFireTick(w, u); }
  for (const s of W.sallies) sallyTick(w, s);
  for (const b of w.buildings) if (isGate(b) && !b.ruin) { gateBurnTick(w, b); if (w.tick % 10 === 1 && !b.gateBroken) holesTick(w, b); }
  if (w.tick % 10 === 1 && w.cs) dropsTick(w);
  if (w.tick % 10 === 9) for (const h of W.holds) holdTick(w, h, 10 * EDT);
  if (W.sallies.length > 20) W.sallies = W.sallies.filter((s) => s.phase !== "done");
}
// what the UI shows about the works of a team
export function worksInfo(w, team) {
  const W = w.siege?.works; if (!W) return null;
  return {
    mines: W.mines.filter((m) => m.team === team || (m.foe === team && m.heard)).map((m) => ({ id: m.id, ours: m.team === team, state: m.state, dug: m.dug, len: m.len, pct: Math.round((m.state === "digging" ? m.dug / m.len * 0.7 : m.state === "chamber" ? 0.7 + 0.3 * m.prog : 1) * 100), building: m.bid, mod: m.k, tower: m.tower, x: m.hx, y: m.hy, heard: m.heard, why: m.why })),
    barricades: W.barricades.filter((b) => b.team === team).map((b) => ({ id: b.id, state: b.state, prog: b.prog, hp: b.hp, status: b.status })),
    hold: (() => { const h = W.holds.find((q) => q.team === team); return h ? { food: h.food, days: foodDays(w, h), starving: h.starving, yielded: h.yielded, respite: h.respite, day: h.day } : null; })(),
  };
}
