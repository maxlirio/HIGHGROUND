// Scenario library for the calibration harness (docs/combat-research.md §17).
// Every scenario builds a world from scratch for a seed, runs it headless, and returns plain metrics.
import { makeMap } from "../js/sim/map.js";
import { readLand } from "../js/sim/landread.js";
import { createWorld, addUnit, issueOrder, step, DT } from "../js/sim/world.js";
import { combatSystem } from "../js/sim/combat.js";
import { legendSystem } from "../js/sim/legend.js";
import { TERRAIN } from "../js/sim/terrain-types.js";
import { S_DEAD, S_DOWN, S_CAPT, S_FLEE, W_MORTAL, ST_FLEE } from "../js/sim/soldiers.js";
import { ARMS } from "../js/sim/arms.js";
import { KIT_ID } from "../js/sim/kit.js";

// ---------------------------------------------------------------- maps
// grid helper: size m, res samples; fns give height, surface key, water depth at (x,y)
// The land is read from its physical makeup (js/sim/landread.js): height, water depth and canopy height.
// `surf` only names the surface for the renderer/debugging; gameplay never reads it.
export function buildMap({ size = 1200, res = 241, h = () => 50, surf = () => "short_meadow", water = null, canopy = null, rain = 0 }) {
  const cell = size / (res - 1), height = new Float32Array(res * res), surface = new Uint8Array(res * res);
  const keys = [], idx = new Map();
  const wd = water ? new Float32Array(res * res) : null;
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const x = i * cell, y = j * cell, k = j * res + i;
    height[k] = h(x, y) + 0.3 * Math.sin(x / 37) * Math.cos(y / 53); // no field is a billiard table (and the land reader needs relief)
    const s = surf(x, y); let si = idx.get(s); if (si === undefined) { si = keys.length; keys.push(s); idx.set(s, si); }
    surface[k] = si;
    if (wd) wd[k] = water(x, y);
  }
  const map = makeMap({ size, res, height, surface, surfaceKeys: keys, waterDepth: wd });
  if (canopy) { map.canopyGrid = new Float32Array(res * res); for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) map.canopyGrid[j * res + i] = canopy(i * cell, j * cell); }
  map.land = readLand(map, { rain }); // rain 0..1 raises wetness, most where the ground drains badly
  return map;
}

// ---------------------------------------------------------------- run loop + recorder
export function newWorld(map, seed, opts = {}) {
  const w = createWorld({ map, terrain: TERRAIN, seed });
  w.systems.push(combatSystem);
  if (opts.legends !== false) w.systems.push(legendSystem);
  w.rec = { deaths: [], legends: 0, feats: [], firstBreak: [-1, -1], rallies: 0, captured: [0, 0], flee: [0, 0] };
  w.systems.push(recorder);
  if (opts.features) w.features = opts.features;
  w.friction = opts.friction ?? true; // scripted scenario orders are { immediate: true } (standing orders); AI orders travel
  if (opts.weather) w.weather = opts.weather;
  return w;
}
function recorder(w) {
  const R = w.rec, S = w.S;
  if (R.contact === undefined) R.contact = -1;
  if (R.contact < 0 && (w.tick & 3) === 0) for (const u of w.units.values()) if (u.c && u.c.contactT >= 0) { R.contact = u.c.contactT; break; }
  for (const e of w.events) {
    if (e.kind === "kill" || e.kind === "die" || (e.kind === "down" && e.sev >= W_MORTAL)) R.deaths.push({ t: w.time, team: S.team[e.victim], fleeing: !!e.fleeing, cause: e.cause, id: e.victim });
    else if (e.kind === "unit-break") { const tm = e.team; if (R.firstBreak[tm] < 0) R.firstBreak[tm] = w.time; }
    else if (e.kind === "unit-rallied") R.rallies++;
    else if (e.kind === "legend") R.legends++;
    else if (e.kind === "feat") R.feats.push(e);
    else if (e.kind === "captured") R.captured[S.team[e.who]]++;
  }
}

// casualty census at the end of a battle
export function census(w, team, unitIds = null) {
  const S = w.S; let n = 0, dead = 0, mortal = 0, down = 0, capt = 0, fleeing = 0, alive = 0;
  for (let i = 0; i < S.n; i++) {
    if (S.team[i] !== team) continue;
    if (unitIds && !unitIds.has(S.home[i])) continue;
    n++;
    if (S.state[i] === S_DEAD) dead++;
    else if (S.state[i] === S_DOWN) { if (S.sev[i] >= W_MORTAL) mortal++; else down++; }
    else if (S.state[i] === S_CAPT) capt++;
    else { alive++; if (S.status[i] === ST_FLEE) fleeing++; }
  }
  return { n, dead, mortal, down, capt, alive, fleeing, fatal: (dead + mortal) / Math.max(1, n) };
}

// run until one side is spent (all its units broken and it is no longer in contact), then keep going for
// `after` seconds of pursuit; or until maxT.
export function runUntil(w, { maxT = 4 * 3600, after = 900, teams = [0, 1], done = null, onTick = null } = {}) {
  let endAt = -1;
  const ticks = Math.ceil(maxT / DT);
  for (let k = 0; k < ticks; k++) {
    step(w);
    if (onTick) onTick(w);
    if (globalThis.__trace) globalThis.__trace(w);
    if (process.env.HG_TRACE && k % (+process.env.HG_TRACE || 1500) === 0) trace(w);
    if (process.env.HG_RIDER && w.time > +process.env.HG_RIDER_T0 && w.time < +process.env.HG_RIDER_T0 + 60) { const S = w.S; const i = +process.env.HG_RIDER; let nd = 1e9, ne = -1; for (let o = 0; o < S.n; o++) if (S.alive[o] && S.team[o] !== S.team[i]) { const d = Math.hypot(S.x[o] - S.x[i], S.y[o] - S.y[i]); if (d < nd) { nd = d; ne = o; } } const u = w.units.get(S.unit[i]); console.log(`R t=${w.time.toFixed(1)} st${S.status[i]}/${S.state[i]} v${Math.hypot(S.vx[i], S.vy[i]).toFixed(1)} pos ${S.x[i].toFixed(0)},${S.y[i].toFixed(0)} nearestE ${nd.toFixed(1)} (st${ne >= 0 ? S.status[ne] : -1}) foe ${S.foe[i]} busy ${(S.busyT[i] - w.time).toFixed(1)} pT ${S.pursueT[i].toFixed(0)} phase ${u?.c?.phase} anchor ${u?.ax.toFixed(0)},${u?.ay.toFixed(0)} hold ${u?.hold}`); }
    if ((w.tick & 7) !== 0) continue;
    if (endAt < 0) {
      const spent = done ? done(w) : teams.find((tm) => sideSpent(w, tm));
      if (spent !== undefined && spent !== null && spent !== false) { endAt = w.time + after; w.rec.loser = spent === true ? w.rec.loser : spent; w.rec.endT = w.time; }
    } else if (w.time >= endAt) break;
  }
  return w;
}
function trace(w) {
  const S = w.S;
  if (process.env.HG_TRACE_UNIT) { const u = w.units.get(+process.env.HG_TRACE_UNIT); if (u) { let st = 0, n = 0, fl = 0, sh = 0, wf = 0, hw = 0, mx = 0; for (const i of u.members) { if (!S.alive[i]) continue; n++; st += S.stress[i]; mx = Math.max(mx, S.stress[i]); wf += S.wbal[i] / S.wp[i]; hw += S.hwp[i] ? S.hwbal[i] / S.hwp[i] : 0; if (S.status[i] === 3) fl++; if (S.status[i] === 2) sh++; } const D = w.cs.dbg?.[u.team]; console.log(`  U${u.id} t=${w.time.toFixed(0)} phase ${u.c?.phase} n ${n} stress ${(st / n).toFixed(2)} max ${mx.toFixed(2)} base ${u.c?.baseline.toFixed(2)} shaken ${sh} fled ${fl} wf ${(wf / n).toFixed(2)} horse ${(hw / n).toFixed(2)} refused ${u.c?.refused} impacts ${u.c?.impacts} charges ${u.c?.charges} dbg ${D ? JSON.stringify(Object.fromEntries(Object.entries(D).map(([k, v]) => [k, +(v).toFixed(2)]))) : ""}`); if (w.cs) w.cs.dbg = []; } }
  if (process.env.HG_TRACE_CAV) { for (const u of w.units.values()) if (ARMS[u.arm].mounted) { let pur = 0, fight = 0, near = 0, hunt = 0, inr = 0; for (const i of u.members) { if (S.status[i] === 6) pur++; if (S.state[i] === 2) fight++; if (S.foe[i] === -2) hunt++; else if (S.foe[i] >= 0 && Math.hypot(S.x[S.foe[i]] - S.x[i], S.y[S.foe[i]] - S.y[i]) < 4) inr++; } console.log(`   hunting ${hunt} inReach ${inr}`); console.log(`  cav u${u.id} t${u.team} phase ${u.c?.phase} pace ${u.pace} ord ${u.order.kind}->${u.order.target} pursuing ${pur} fighting ${fight} @${u.ax.toFixed(0)},${u.ay.toFixed(0)} rkills ${u.members.reduce((a, i) => a + S.rkills[i], 0)}`); } }
  const us = [...w.units.values()].map((u) => { let a = 0, f = 0; for (const i of u.members) { if (S.alive[i]) a++; if (S.status[i] === ST_FLEE) f++; } return `u${u.id}t${u.team}:${a}/${u.c?.n0}${u.c?.broken ? "B" : ""} f${f} st${u.c?.stressM.toFixed(2)} base${u.c?.baseline.toFixed(2)} hold${u.hold ? 1 : 0} ord:${u.order.kind} @${u.ax.toFixed(0)},${u.ay.toFixed(0)}`; });
  const secs = [...w.cs.sec.values()]; const fl = secs.filter((s) => s.state).length;
  console.log(`t=${(w.time / 60).toFixed(0)}m ${us.join(" | ")} secs ${secs.length} fl ${fl} pi ${secs.map((s) => s.pi.map((p) => p.toFixed(2)).join("/")).join(" ")}`);
}
export function sideSpent(w, team) {
  let any = false;
  for (const u of w.units.values()) {
    if (u.team !== team || !u.members.length) continue;
    const S = w.S; let standing = 0;
    for (const id of u.members) if (S.alive[id] && S.status[id] !== ST_FLEE && S.status[id] !== 4) standing++;
    if (standing >= 0.2 * u.members.length && !u.c?.broken) return false;
    any = true;
  }
  return true;
}

// generic outcome metrics for a two-army fight
export function outcome(w, loser) {
  const R = w.rec;
  const winner = 1 - loser;
  const cw = census(w, winner), cl = census(w, loser);
  const lb = R.firstBreak[loser];
  const lDeaths = R.deaths.filter((d) => d.team === loser);
  const after = lb >= 0 ? lDeaths.filter((d) => d.t >= lb).length : 0;
  const units = [...w.units.values()];
  const contact = R.contact >= 0 ? R.contact : Infinity;
  return {
    loser, winner, victorFatal: cw.fatal, loserFatal: cl.fatal, afterBreakShare: lDeaths.length ? after / lDeaths.length : null,
    breakT: lb, contactT: Number.isFinite(contact) ? contact : -1, duration: lb >= 0 && Number.isFinite(contact) ? (lb - contact) / 60 : null,
    flurryFrac: w.cs.stats.secT ? w.cs.stats.flurrySecT / w.cs.stats.secT : null,
    meanFlurry: w.cs.stats.flurries ? w.cs.stats.flurryDur / w.cs.stats.flurries : null, meanLull: w.cs.stats.lulls ? w.cs.stats.lullDur / w.cs.stats.lulls : null,
    rallies: R.rallies, legends: R.legends, captured: R.captured[loser],
    victorCauses: causes(R.deaths.filter((d) => d.team === winner)), loserCauses: causes(lDeaths), loserPre: causes(lDeaths.filter((d) => lb < 0 || d.t < lb)),
    victorDown: cw.down / Math.max(1, cw.n), loserDown: cl.down / Math.max(1, cl.n),
  };
}

function causes(ds) { const o = {}; for (const d of ds) { const k = (d.cause || "?") + (d.fleeing ? "-F" : ""); o[k] = (o[k] || 0) + 1; } return o; }

// ---------------------------------------------------------------- scenario helpers
const flatMap = (size = 1200, surf = "short_meadow") => buildMap({ size, res: Math.round(size / 10) + 1, surf: () => surf });

function armyUnits(w, team, list, face) {
  return list.map((s) => addUnit(w, { team, facing: face, ...s }));
}
function order(w, us, o) { issueOrder(w, us.map((u) => u.id), { immediate: true, ...o }); }
function lossAtBreak(w, team) {
  const out = [];
  for (const u of w.units.values()) if (u.team === team && u.c && u.c.brokenAt0 !== undefined) out.push(u.c.brokenAt0);
  return out;
}

// ---------------------------------------------------------------- §17.1 line fights
// Equal steady infantry: 8-deep spear blocks, both sides advance; teams swapped on odd seeds so that a
// mirror bias in the code (team index or map side) shows up as a win-rate away from 50 %.
export function line(seed, o = {}) {
  const map = flatMap(2400);
  const w = newWorld(map, seed);
  const swap = seed & 1;
  const tS = swap ? 1 : 0, tN = 1 - tS;
  const spec = { arm: o.arm || "spearmen", count: o.count || 240, formation: "deep" };
  const S = armyUnits(w, tS, [{ ...spec, x: 1200, y: 1120 }], 0);
  const N = armyUnits(w, tN, [{ ...spec, x: 1200, y: 1280 }], Math.PI);
  if (o.mirror) cloneInto(w, S[0], N[0]);
  // the horse waits on a wing, a bowshot back, to fall on whatever breaks
  const cavS = o.cav ? armyUnits(w, tS, [{ arm: "hobelars", count: 100, x: 1260, y: 1060, formation: "line" }], 0) : [];
  const cavN = o.cav ? armyUnits(w, tN, [{ arm: "hobelars", count: 100, x: 1140, y: 1340, formation: "line" }], Math.PI) : [];
  order(w, S, { kind: "assault", x: 1200, y: 1280 });
  order(w, N, { kind: "assault", x: 1200, y: 1120 });
  // reserve cavalry: pursue when the enemy breaks
  const onTick = o.cav ? (w) => {
    if (w.tick % 25) return;
    for (const [mine, tm] of [[cavS, tS], [cavN, tN]]) {
      const routing = [...w.units.values()].find((u) => u.team !== tm && u.c?.broken && u.members.length);
      const routing2 = [...w.units.values()].find((u) => u.team !== tm && u.c?.broken && u.members.length && !ARMS[u.arm].mounted) || routing;
      if (routing2) for (const c of mine) if (c.members.length && c.order.kind !== "assault") issueOrder(w, [c.id], { immediate: true, kind: "assault", x: routing2.fx ?? routing2.ax, y: routing2.fy ?? routing2.ay, pace: "charge", target: routing2.id });
    }
  } : null;
  runUntil(w, { maxT: 4 * 3600, after: o.cav ? 1200 : 900, teams: [0, 1], onTick, done: (w) => { for (const tm of [0, 1]) if (infantrySpent(w, tm)) return tm === 0 ? 0 : 1; return null; } });
  const loser = w.rec.loser ?? -1;
  if (loser < 0) return { draw: true, swap };
  const r = outcome(w, loser);
  if (o.cav) { const inf = new Set((loser === tS ? S : N).map((u) => u.id)); r.loserFatal = census(w, loser, inf).fatal; }
  r.swap = swap; r.southLost = loser === tS ? 1 : 0; r.team0Lost = loser === 0 ? 1 : 0;
  r.lossAtBreak = lossAtBreak(w, loser)[0] ?? null;
  // first shock: broke within 90 s of first contact
  r.firstShock = r.breakT >= 0 && r.contactT >= 0 && r.breakT - r.contactT < 90 ? 1 : 0;
  return r;
}
// make the second body an exact copy of the first (same men in the same slots) for mirror tests
const CLONE = ["skill", "courage", "strength", "stamina", "mass", "cp", "wp", "wbal", "gly", "bloodVol", "load", "limb", "disc", "skillMul", "kit", "kitMask", "armour", "weapon", "side", "shield", "shieldArm", "aggr", "nerve0", "stress"];
function cloneInto(w, a, b) {
  const S = w.S;
  a.members.forEach((ia, k) => { const ib = b.members[k]; if (ib === undefined) return; for (const f of CLONE) S[f][ib] = S[f][ia]; });
}
function infantrySpent(w, tm) {
  for (const u of w.units.values()) if (u.team === tm && u.members.length && !ARMS[u.arm].mounted && !u.c?.broken) return false;
  return true;
}

// Loser trapped against a river (§17.1 trapped band): the broken side has deep water 60 m behind it.
export function trapped(seed) {
  const map = buildMap({ size: 1200, res: 241, water: (x, y) => (y > 760 && y < 800 ? 2.0 : 0), surf: (x, y) => (y > 760 && y < 800 ? "deep_water" : "short_meadow") });
  const w = newWorld(map, seed);
  w.homeDir = [[0, -1], [0, 1]]; // the northern army's home lies across the river
  const S = armyUnits(w, 0, [{ arm: "spearmen", count: 240, formation: "deep", x: 600, y: 560 }], 0);
  const N = armyUnits(w, 1, [{ arm: "levy", count: 240, formation: "deep", x: 600, y: 700 }], Math.PI);
  order(w, S, { kind: "assault", x: 600, y: 700 });
  order(w, N, { kind: "hold", x: 600, y: 700, facing: -Math.PI / 2 });
  runUntil(w, { maxT: 4 * 3600, after: 1200, done: (w) => infantrySpent(w, 1) ? 1 : infantrySpent(w, 0) ? 0 : null });
  const loser = w.rec.loser ?? -1; if (loser < 0) return { draw: true };
  const r = outcome(w, loser); r.drowned = w.rec.deaths.filter((d) => d.cause === "drown").length; return r;
}

// Large morale gap: veteran men-at-arms against a shaken levy (§17.1 first shock 30–50 %).
export function shock(seed) {
  const map = flatMap(1200);
  const w = newWorld(map, seed);
  const V = armyUnits(w, 0, [{ arm: "menatarms", count: 160, formation: "deep", x: 600, y: 520 }], 0);
  const L = armyUnits(w, 1, [{ arm: "levy", count: 240, formation: "deep", x: 600, y: 680, nerve: undefined }], Math.PI);
  // a levy that has just watched its own knights ridden down (the gap is in the men, not the dice):
  // unit mood raised by 0.12 (u.moraleMod feeds the unit's baseline stress)
  L[0].moraleMod = 0.12;
  for (const id of L[0].members) { w.S.courage[id] = Math.max(0.05, w.S.courage[id] - 0.1); w.S.stress[id] = 0.4 + 0.1 * w.rng.next(); }
  order(w, V, { kind: "assault", x: 600, y: 680, pace: "quick" });
  order(w, L, { kind: "hold", x: 600, y: 680, facing: -Math.PI / 2 });
  runUntil(w, { maxT: 3 * 3600, after: 300, done: (w) => infantrySpent(w, 1) ? 1 : infantrySpent(w, 0) ? 0 : null });
  const loser = w.rec.loser ?? -1; if (loser < 0) return { draw: true };
  const r = outcome(w, loser);
  r.firstShock = r.breakT >= 0 && (r.contactT < 0 || r.breakT - r.contactT < 90) ? 1 : 0;
  r.lossAtBreak = lossAtBreak(w, loser)[0] ?? null;
  return r;
}

// ---------------------------------------------------------------- §17.2 cavalry benchmarks
// Steady pikes vs a frontal charge in the open: horse contact < 10 %, breakthrough < 5 %.
export function pikeVsCav(seed) {
  const map = flatMap(1200);
  const w = newWorld(map, seed);
  const P = armyUnits(w, 0, [{ arm: "pikemen", count: 240, formation: "deep", x: 600, y: 500 }], 0);
  const K = armyUnits(w, 1, [{ arm: "knights", count: 60, formation: "line", depth: 2, x: 600, y: 900 }], Math.PI);
  order(w, P, { kind: "hold", x: 600, y: 500, facing: Math.PI / 2 });
  order(w, K, { kind: "assault", x: 600, y: 500, pace: "charge" });
  const front = new Set(P[0].members.slice(0, P[0].files));
  let firstCharge = null, broke = 0;
  runUntil(w, { maxT: 1200, after: 0, done: () => null, onTick: (w) => { const c = K[0].c; if (c && c.charges >= 1 && !firstCharge && c.phase !== "charge" && c.phase !== "approach") firstCharge = { refused: c.refused, impacts: c.impacts }; if (P[0].c?.broken) broke = 1; } });
  const fc = firstCharge || { refused: K[0].c?.refused || 0, impacts: K[0].c?.impacts || 0 };
  // breakthrough: riders beyond the pike block's rear rank
  const S = w.S; let through = 0, riders = 0;
  const backY = P[0].ay - P[0].c.depthM - 2;
  const halfW = P[0].c.halfW || 12;
  for (const id of K[0].members) { riders++; if (S.alive[id] && S.y[id] < backY && Math.abs(S.x[id] - P[0].ax) < halfW && S.horseOK[id] === 1) through++; }
  return { contact: fc.impacts / Math.max(1, fc.impacts + fc.refused), breakthrough: through / Math.max(1, K[0].c.n0), infBroke: broke, charges: K[0].c.charges };
}

// Cavalry against wavering / disordered infantry: breaks it in > 70 % of runs.
export function cavVsDisordered(seed) {
  const map = flatMap(1200);
  const w = newWorld(map, seed);
  const L = armyUnits(w, 0, [{ arm: "levy", count: 200, formation: "loose", x: 600, y: 500 }], 0);
  for (const id of L[0].members) w.S.stress[id] = 0.5 + 0.1 * w.rng.next();
  const K = armyUnits(w, 1, [{ arm: "knights", count: 60, formation: "line", depth: 2, x: 600, y: 850 }], Math.PI);
  order(w, L, { kind: "move", x: 800, y: 500, pace: "march" }); // caught on the move, strung out
  order(w, K, { kind: "assault", x: 600, y: 500, pace: "charge" });
  runUntil(w, { maxT: 900, after: 0, done: (w) => (L[0].c?.broken ? 0 : null) });
  return { broke: L[0].c?.broken || (L[0].c && L[0].c.breaks) ? 1 : 0 };
}

// ---------------------------------------------------------------- registry
export const SCENARIOS = { line, mirror: (s) => line(s, { mirror: true }), line_cav: (s) => line(s, { cav: true }), trapped, shock, pike_cav: pikeVsCav, cav_disordered: cavVsDisordered };
