// Combat system (docs/combat-research.md). Everything is resolved per SOLDIER; nothing is a unit dice roll.
//
//  perception  (each man every PERC ticks, staggered): nearest foe, contact, local odds, morale inputs
//  sectors     (§8) 10 m contact sectors run the flurry ⇄ lull state machine from their men's surge pressure Π
//  melee       (§7) men in a flurry close to strike distance and exchange blows through melee.resolveBlow
//  cavalry     (§10) charges, refusal, impact, recoil and re-charge            → cavalry.js
//  missiles    (§9) ballistic arrows/bolts with drag and dispersion            → ballistics.js
//  morale      (§11) stress, break trigger, contagion, rally, surrender        → morale.js
//  rout        (§12) flight, pursuit, looting, drowning, massacre of the downed
//  physiology  (§6) W′ balance, glycogen, bleeding                             → physio.js
//  command     (§13) order latency/garbling                                    → command.js
//  feats       (§15) improbable deeds → legend events                          → feats.js
//
// Events kept for js/sim/legend.js: {kind:'kill'|'down', victim, by, fleeing, cause} and {kind:'flee', who}.
// Extra: 'die' (a downed man dies: bleeding, finished off, drowned, crushed), 'captured', 'horse', 'feat',
// 'unit-routing' / 'unit-rallied' / 'unit-wavering' / 'unit-formed', 'refuse', 'impact'.
import { S_IDLE, S_MOVE, S_FIGHT, S_FLEE, S_DOWN, S_DEAD, S_RALLY, S_CAPT, ST_FORMED, ST_WAVER, ST_SHAKEN, ST_FLEE, ST_RALLY, ST_PURSUE, ST_LOOT,
  W_LIGHT, W_MORTAL, W_INSTANT, clamp } from "./soldiers.js";
import { ARM_BY_ID } from "./arms.js";
import { WEAPON_BY_ID } from "./kit.js";
import { neighbours, DT, TICK, goingMul, HASH, applyOrder, setDisorder, clearDisorder, bodyPush } from "./world.js";
const HMASK = (1 << 15) - 1;
import { resolveBlow, fell, knockDown } from "./melee.js";
import { exert, PH, bleedStep, speedAtPower, wFrac, horseStep } from "./physio.js";
import { MOR, moraleThink, fugitiveThink, fugitiveMove, unitMorale, onUnitBreak } from "./morale.js";
import { footing, weather, addBody, removeBody, bodiesAt, goingHook, ground, featureNear, featureDef, ELEVATION } from "./ground.js";
import { syncBuildingFeatures, syncFeatureNav, syncPendingFeatures } from "./features.js";
import { cavalryUnit, cavalryTick } from "./cavalry.js";
import { missileUnit, missileTick, flightTick, recoverArrows } from "./ballistics.js";
import { featsTick } from "./feats.js";
import { makeCommand, commandTick } from "./command.js";

import { PERC } from "./clock.js"; // ticks between a man's perception passes (= 2 battle-s at any clock rate)
export { PERC };
export const C = {
  brawlR: 10, lullGap: 4, brawlAfter: 20, brawlStress: 0.7, calmReform: 20, // DESIGN: m a man out of the ranks sees an enemy to go for; s of contact before a shaken or ill-disciplined body's line fight becomes a brawl; s of quiet before an AI captain re-forms his men
  engage: 3.5,        // m beyond weapon reach at which a man is "in contact" (the lull's 2–10 m safety distance)
  secSize: 10,        // §8 contact sector (m)
  surgeAt: 0.42, surgeK: 0.24, surgeSlope: 0.08, // lull → flurry hazard (per s) when Π exceeds 0.45
  lullMin: 20,        // s: nobody surges again the moment they have stepped apart
  flurryEndW: 0.3, flurryLoss: 2, flurryMax: 60, // §8 flurry end: mean W′ < 35 %, >2 men down in 10 s
  pushback: [1, 3],   // m of ground the loser of a flurry gives
  aggW: [1.5, 1.0, 0.4], // Π aggression weights (fighter, cautious, passive) (DESIGN: Π≈0.45 when W′ is back to ≈½)
  leaderBonus: 0.15, warcry: 0.1, waverBonus: 0.1, lossPen: 0.2, urgeAfter: 90,
  rotateP: 0.15,      // P per 2 s that a blown front-ranker swaps with a fresh man behind (discipline ≥ 0.5)
  miredGoing: 0.4,   // a fugitive on going this bad (a brook, a ditch, a bog) can be run down by men on foot (hunt)
  shockV: 1.6, shockPush: 2.5, shockPushMax: 6, shockDown: 0.25, shockBurst: 1.2, shockStress: 0.12, // DESIGN: footShock
  pressGive: 2,        // DESIGN: × more ground (on the 1–3 m pushback) the loser of a pulse gives when the other side pressed harder
  keepPlace: 3.0,     // m beyond his reach a fighting man's place in the ranks may lie before he stays in it (formation shape in contact)
  bashP: [0.05, 0.12], bashDown: 0.25, bashPush: [0.5, 1.2], // DESIGN: P a close blow is a shield-bash instead (unarmoured / harnessed), P it knocks down, m it drives back
  squeezeK: 4, squeezeMax: 0.55, // DESIGN: files' lateral places × (1 − min(max, K × flank shafts per man, ebbing τ 20 s))
  pursueP: 0.35,      // P per perception that a man whose foe runs breaks ranks after him, × (1 − discipline)
  lootHaz: 0.02,      // §12: P/s × (1 − discipline) that a pursuer stops to loot or take a prisoner
  finishP: 0.5,       // §12: victor passing a downed enemy kills him
  plunder: 0.002,     // P/s × (1 − discipline) an idle man goes to strip the field once the enemy has gone
  crushDensity: 3, crushFall: 0.01, crushAsphyx: 0.02, // §5
  flurryFear: 0.004,  // DESIGN: stress/s for a man in a flurry (fear of death); §8 "each cycle raises stress"
  // the lull is the fight at low intensity, not a gap (DESIGN, the owner's "formations are being prioritized over
  // realism"): the front men stand off at the length of their weapons — points crossed, blades a step apart —
  // each stepping in and back on his own rhythm (period lullPer s), warding and feinting (lullJab × his flurry
  // rate: parried or turned on the shield, no harm done — the lull's casualties stay the calibrated ones), shield
  // men shouldering in; the body behind leans in after them (unitUpdate), so there is no daylight between the lines
  lullStand: [0.15, 0.8], lullPer: [6, 14], lullJab: 0.8, lullShove: 0.35, lullBack: 1.6,
  closeR: 10,         // m: a standing body with a standing enemy this close in front of it steps up to him (no standoffs)
  leanMax: 2.5,       // m the body leans in ahead of its anchor to keep its front on the enemy's (more is carried into the anchor unless ordered to hold)
  lullLong: 600, lullFloor: 0.008, // s, /s: a lull that has gone on this long ends at least at this hazard (a captain, a hothead, a jostle)
  approachFear: 0.065, // DESIGN (re-tuned for the real-time clock and formation-keeping in contact, was 0.08 at 4×): stress/s × max(0, Π_enemy − Π_own) as an enemy body closes (first shock)
};

// ------------------------------------------------------------------ init
function initCombat(w) {
  const size = w.map.size, CG = 10, n = Math.ceil(size / CG) + 2;
  const cs = w.cs = {
    CG, cn: n, sec: new Map(), bodies: new Map(), downed: [], unhorsed: [], flights: [], tick: 0,
    cnt: [new Uint16Array(n * n), new Uint16Array(n * n)], flee: [new Uint16Array(n * n), new Uint16Array(n * n)],
    csx: [new Float32Array(n * n), new Float32Array(n * n)], csy: [new Float32Array(n * n), new Float32Array(n * n)],
    fsx: [new Float32Array(n * n), new Float32Array(n * n)], fsy: [new Float32Array(n * n), new Float32Array(n * n)],
    touched: [], G50: 50, c50n: Math.ceil(size / 50) + 2, touched50: [], nAtk: new Uint8Array(w.S.cap), nAtkNext: new Uint8Array(w.S.cap), jab: new Uint8Array(w.S.cap), edge: new Uint8Array(w.S.cap),
    stats: { flurrySecT: 0, secT: 0, flurries: 0, flurryDur: 0, lulls: 0, lullDur: 0, charges: 0, refusals: 0, contacts: 0, breakthroughs: 0, arrows: 0, arrowHits: 0 },
    ctx: null,
  };
  const m = cs.c50n * cs.c50n;
  cs.cnt50 = [new Uint16Array(m), new Uint16Array(m)]; cs.sx50 = [new Float32Array(m), new Float32Array(m)]; cs.sy50 = [new Float32Array(m), new Float32Array(m)];
  cs.ctx = {
    S: w.S, rng: w.rng, time: 0, tick: 0, events: w.events,
    onFell: (d, a, sev, cause) => onFell(w, d, a, sev, cause),
    crowdAt: (id) => Math.min(6, bodiesAt(cs, w.S.x[id], w.S.y[id]) * 1.5),
    onUnhorse: (id) => { addBody(cs, w.S.x[id], w.S.y[id], 1); cs.unhorsed.push(id); },
  };
  w.goingHook = goingHook(w);
  if (w.friction !== false && !w.command) w.command = makeCommand(); // §13 orders travel (set w.friction = false to disable)
  return cs;
}

function unitC(w, u) {
  if (u.c) return u.c;
  const S = w.S, A = ARM_BY_ID[S.arm[u.members[0]] ?? 0];
  const files = u.files || 1;
  const c = u.c = {
    n0: u.members.length, cas: 0, fled: 0, broken: false, breakT: -1, brokenAt: 0, contactT: -1, firstContactCas: 0,
    front: u.members.slice(0, files), leader: -1, leaderLost: -1, baseline: 0.1, anchorX: u.ax, anchorY: u.ay,
    surge: 0, push: 0, eng: 0, engFl: 0, gap: 0, sg: 0, sgn: 0, stressM: 0, disc: 0, anchored: false, rallied: 0, pursuitCas: 0, lineCas: 0,
    charges: 0, phase: "idle", ranks: Math.max(1, Math.ceil(u.members.length / files)), home: { x: u.ax, y: u.ay },
    flurryT: 0, contactDur: 0, decidedAtShock: false, flurries: 0,
  };
  let dsum = 0; for (const id of u.members) dsum += S.disc[id]; c.disc = dsum / Math.max(1, u.members.length);
  // leader stands in the middle of the second rank, his banner beside him (DESIGN)
  const li = Math.min(u.members.length - 1, files + (files >> 1));
  c.leader = u.members[li] ?? u.members[0];
  S.role[c.leader] = 1; S.courage[c.leader] = Math.max(S.courage[c.leader], 0.6);
  if (u.members[li + 1] !== undefined) S.role[u.members[li + 1]] = 2;
  for (const id of u.members) S.home[id] = u.id;
  return c;
}

// ------------------------------------------------------------------ system
export function combatSystem(w) {
  const cs = w.cs || initCombat(w);
  const S = w.S, t = w.time;
  cs.tick++; cs.ctx.time = t; cs.ctx.tick = w.tick; cs.ctx.events = w.events;
  if (cs.nAtk.length < S.cap) { cs.nAtk = new Uint8Array(S.cap); cs.nAtkNext = new Uint8Array(S.cap); const j = new Uint8Array(S.cap); j.set(cs.jab); cs.jab = j; const e = new Uint8Array(S.cap); e.set(cs.edge); cs.edge = e; }
  const bucket = w.tick % PERC;
  rebuildCoarse(w, cs);
  if (w.tick % 25 === 3) { syncBuildingFeatures(w); syncPendingFeatures(w); syncFeatureNav(w); } // walls built or ruined, stakes planted: combat and pathing both see them
  for (const u of w.units.values()) if (u.members.length) unitC(w, u);
  commandTick(w);
  // ---- perception + morale (staggered)
  // (men standing in the rear ranks of a body that is holding — not fighting, not fleeing — look about them
  // half as often, over twice the time: nothing reaches them that a front-ranker would not see first)
  const odd = (w.tick / PERC | 0) & 1;
  for (let i = 0; i < S.n; i++) {
    if (!S.alive[i] || S.bucket[i] !== bucket) continue;
    if (S.rank[i] >= 2 && S.state[i] !== S_FIGHT && S.status[i] <= ST_WAVER) { if ((i & 1) !== odd) continue; perceive(w, cs, i, 2); }
    else perceive(w, cs, i, 1);
  }
  if (bucket === PERC - 1) { armyFronts(w, cs); sectorsUpdate(w, cs); for (const u of w.units.values()) if (u.members.length) unitUpdate(w, cs, u); downedUpdate(w, cs); }
  // ---- per-tick action
  for (const u of w.units.values()) { if (!u.members.length) continue; if (u.moving && !u.hold) contactProbe(w, cs, u); cavalryUnit(w, cs, u); missileUnit(w, cs, u); }
  meleeTick(w, cs);
  cavalryTick(w, cs);
  missileTick(w, cs);
  flightTick(w, cs);
  for (let i = 0; i < S.n; i++) if (S.alive[i]) { if (S.state[i] === S_FLEE) fugitiveMove(w, cs, i); else if (S.state[i] === S_RALLY && S.status[i] === ST_LOOT) moveLooter(w, cs, i); }
  // ---- physiology for everyone standing
  const env = cs.env || (cs.env = envOf(w));
  // (integrated for half the men each tick over two ticks' time: W′ changes over tens of seconds)
  const par = w.tick & 1;
  for (let i = par; i < S.n; i += 2) {
    if (!S.alive[i]) continue;
    exert(S, i, S.power[i], 2 * DT, env);
    if (S.bleed[i] > 0 && bleedStep(S, i, 2 * DT) >= 1) fell(cs.ctx, i, -1, W_MORTAL, "bleed");
  }
  for (let i = 0; i < S.n; i++) if (S.posture[i] === 1 && S.alive[i] && t > S.upT[i] && S.stunT[i] <= t) S.posture[i] = 0;
  processEvents(w, cs);
  featsTick(w, cs);
}

function envOf(w) {
  const W = weather(w);
  return { sweatLph: W.sweatLPerHourAtWork ? [W.sweatLPerHourAtWork.unarmoured, W.sweatLPerHourAtWork.mail, W.sweatLPerHourAtWork.plate] : null, hunger: w.hunger || false };
}

// each army's "home" direction: away from the enemy's centre of mass (where fugitives run)
function armyFronts(w, cs) {
  const S = w.S, sx = [0, 0], sy = [0, 0], n = [0, 0];
  for (const u of w.units.values()) { if (!u.members.length || u.team > 1 || u.c?.broken) continue; const k = u.members.length; sx[u.team] += u.ax * k; sy[u.team] += u.ay * k; n[u.team] += k; }
  if (!cs.home) cs.home = [[0, -1], [0, 1]];
  if (n[0] && n[1]) for (const tm of [0, 1]) {
    const dx = sx[tm] / n[tm] - sx[1 - tm] / n[1 - tm], dy = sy[tm] / n[tm] - sy[1 - tm] / n[1 - tm], l = Math.hypot(dx, dy) || 1;
    if (!cs.homeFixed) cs.home[tm] = [dx / l, dy / l];
  }
  if (w.homeDir) cs.home = w.homeDir;
}

// ------------------------------------------------------------------ coarse 10 m occupancy grid (per team)
function rebuildCoarse(w, cs) {
  const S = w.S, CG = cs.CG, n = cs.cn;
  if (!cs.fcnt) cs.fcnt = [new Uint16Array(n * n), new Uint16Array(n * n)];
  if (!cs.slc) { cs.slc = [new Uint16Array(n * n), new Uint16Array(n * n)]; cs.slx = [new Float32Array(n * n), new Float32Array(n * n)]; cs.sly = [new Float32Array(n * n), new Float32Array(n * n)]; }
  if (!cs.mark || cs.mark.length !== n * n) cs.mark = new Uint8Array(n * n);
  const cnt0 = cs.cnt[0], cnt1 = cs.cnt[1], fl0 = cs.flee[0], fl1 = cs.flee[1], cx0 = cs.csx[0], cx1 = cs.csx[1], cy0 = cs.csy[0], cy1 = cs.csy[1];
  const fx0 = cs.fsx[0], fx1 = cs.fsx[1], fy0 = cs.fsy[0], fy1 = cs.fsy[1], fc0 = cs.fcnt[0], fc1 = cs.fcnt[1], mark = cs.mark, T = cs.touched;
  const SC = cs.slc, SX = cs.slx, SY = cs.sly;
  // (castles: the standing men on the GROUND per cell as well — a man at the foot of a wall is not outflanked by the
  // men on the wall-walk above him — morale.js flank/rear)
  if (w.castles?.length && S.lvl && !cs.gnd) cs.gnd = { c: [new Uint16Array(n * n), new Uint16Array(n * n)], x: [new Float32Array(n * n), new Float32Array(n * n)], y: [new Float32Array(n * n), new Float32Array(n * n)] };
  const GD = cs.gnd && S.lvl ? cs.gnd : null, LV = S.lvl;
  if (GD) for (let q = 0; q < T.length; q++) { const k = T[q]; GD.c[0][k] = GD.c[1][k] = 0; GD.x[0][k] = GD.x[1][k] = GD.y[0][k] = GD.y[1][k] = 0; }
  for (let q = 0; q < T.length; q++) { const k = T[q]; cnt0[k] = cnt1[k] = fl0[k] = fl1[k] = 0; cx0[k] = cx1[k] = cy0[k] = cy1[k] = 0; fx0[k] = fx1[k] = fy0[k] = fy1[k] = 0; fc0[k] = fc1[k] = 0; mark[k] = 0; SC[0][k] = SC[1][k] = 0; SX[0][k] = SX[1][k] = SY[0][k] = SY[1][k] = 0; }
  T.length = 0;
  const n5 = cs.c50n, c5 = cs.cnt50, c50 = c5[0], c51 = c5[1], s50 = cs.sx50, t50 = cs.sy50, T5 = cs.touched50;
  for (let q = 0; q < T5.length; q++) { const k = T5[q]; c50[k] = c51[k] = 0; s50[0][k] = s50[1][k] = t50[0][k] = t50[1][k] = 0; }
  T5.length = 0;
  const X = S.x, Y = S.y, AL = S.alive, TM = S.team, STU = S.status;
  for (let i = 0; i < S.n; i++) {
    if (!AL[i]) continue;
    const tm = TM[i]; if (tm > 1) continue;
    const x = X[i], y = Y[i], k = ((y / CG) | 0) * n + ((x / CG) | 0), st = STU[i];
    if (!mark[k]) { mark[k] = 1; T.push(k); }
    if (st === ST_FLEE || st === ST_RALLY) {
      if (st === ST_FLEE) (tm ? fl1 : fl0)[k]++; // rallying men: prey, not panic
      (tm ? fx1 : fx0)[k] += x; (tm ? fy1 : fy0)[k] += y; (tm ? fc1 : fc0)[k]++;
      // fugitives who cannot get away: mired in water or mud, or an unhorsed man in full harness
      if (st === ST_FLEE && ((S.gMul[i] > 0 && S.gMul[i] < C.miredGoing) || (S.horseOK[i] === 0 && ARM_BY_ID[S.arm[i]].mounted)) && S.horseOK[i] !== 1) { SC[tm][k]++; SX[tm][k] += x; SY[tm][k] += y; }
    }
    else if (st === ST_LOOT) continue; // off the line: neither threat nor panic
    else {
      (tm ? cnt1 : cnt0)[k]++; (tm ? cx1 : cx0)[k] += x; (tm ? cy1 : cy0)[k] += y;
      if (GD && LV[i] === 0) { GD.c[tm][k]++; GD.x[tm][k] += x; GD.y[tm][k] += y; }
      const k5 = ((y / 50) | 0) * n5 + ((x / 50) | 0);
      if (!c50[k5] && !c51[k5]) T5.push(k5);
      (tm ? c51 : c50)[k5]++; s50[tm][k5] += x; t50[tm][k5] += y;
    }
  }
}
// distance to the nearest standing enemy of `team` (50 m grid, cell centroids), up to maxR
export function nearestEnemy50(cs, team, x, y, maxR) {
  const n = cs.c50n, ci = (x / 50) | 0, cj = (y / 50) | 0, R = Math.ceil(maxR / 50), a = cs.cnt50[1 - team], sx = cs.sx50[1 - team], sy = cs.sy50[1 - team];
  let best = 1e9;
  for (let j = Math.max(0, cj - R); j <= Math.min(n - 1, cj + R); j++) for (let q = Math.max(0, ci - R); q <= Math.min(n - 1, ci + R); q++) {
    const k = j * n + q, m = a[k]; if (!m) continue;
    const d = Math.hypot(sx[k] / m - x, sy[k] / m - y) - 25; if (d < best) best = d;
  }
  return Math.max(0, best);
}
// enemies (not fleeing) of `team` within r cells around (x,y)?
export function coarseAny(cs, team, x, y, r) {
  const n = cs.cn, ci = (x / cs.CG) | 0, cj = (y / cs.CG) | 0, arr = cs.cnt[1 - team];
  for (let j = Math.max(0, cj - r); j <= Math.min(n - 1, cj + r); j++) for (let i = Math.max(0, ci - r); i <= Math.min(n - 1, ci + r); i++) if (arr[j * n + i]) return true;
  return false;
}

// ------------------------------------------------------------------ perception
const nb = [];
const INFO = { fleeFriends: 0, flankNear: 0, enemiesNear: 0, friendsNear: 0, foe: -1, fd: 0, near: false }; // reused: no garbage per man
function perceive(w, cs, i, mul = 1) {
  const S = w.S, t = w.time, dtP = DT * PERC * mul;
  const u = w.units.get(S.unit[i]); if (!u) return;
  const st = S.status[i];
  if (st === ST_FLEE || st === ST_RALLY) { fugitiveThink(w, cs, i, u, dtP); return; }
  if (st === ST_LOOT) { loot(w, cs, i, u); return; }
  const team = S.team[i], x = S.x[i], y = S.y[i];
  const W = WEAPON_BY_ID[S.weapon[i]], reach = W.reach, mounted = S.horseOK[i] === 1;
  let foe = -1, fd = 1e9, fleeFriends = 0, friends3 = 0, enemies5 = 0, friends5 = 0, dens = 0, flankNear = 0, fleeFoe = -1, ffd = 1e9;
  const near = coarseAny(cs, team, x, y, 1) || (st === ST_PURSUE);
  if (S.missile[i] && !near && S.ammo[i] < 90) recoverArrows(w, cs, i);
  // men deep inside a formed body locked in a line fight cannot reach anyone: skip the fine scan
  const deep = u.hold && !u.c.broken && S.rank[i] >= 4 && S.state[i] !== S_FIGHT && u.formation !== "schiltron";
  if ((near || S.state[i] === S_FIGHT) && !deep) {
    const hunting = st === ST_PURSUE || (u.c && (u.c.phase === "pursuit" || (u.order.kind === "assault" && u.c.tgtRouting)));
    const R = hunting ? (mounted ? 30 : 15) : u.disordered ? C.brawlR : reach + C.engage + (mounted ? 2.5 : 0.5);
    const H = w.hash, head = H.head, next = H.next, key = H.key, X = S.x, Y = S.y, TM = S.team, STA = S.state, STU = S.status, NA = cs.nAtk, myFoe = S.foe[i], UN = S.unit, myUnit = S.unit[i], LV = S.lvl, myL = LV[i];
    const R2 = R * R, c0 = ((x - R) / HASH) | 0, c1 = ((x + R) / HASH) | 0, r0 = ((y - R) / HASH) | 0, r1 = ((y + R) / HASH) | 0;
    const fx = Math.cos(S.facing[i]), fy = Math.sin(S.facing[i]);
    for (let ci = c0; ci <= c1; ci++) for (let cj = r0; cj <= r1; cj++) {
      const kk = ci * 65536 + cj;
      for (let o = head[((ci * 73856093) ^ (cj * 19349663)) & HMASK]; o >= 0; o = next[o]) {
        if (key[o] !== kk || o === i || LV[o] !== myL) continue; // (castle.js: men on another level — the wall-walk above, the ground below — are out of reach and not "near")
        const dx = X[o] - x, dy = Y[o] - y, d2 = dx * dx + dy * dy;
        if (d2 > R2) continue;
        if (TM[o] === team) {
          if (d2 < 25) { friends5++; if (STA[o] === S_FLEE && UN[o] === myUnit) fleeFriends++; if (d2 < 9) friends3++; if (d2 < 1) dens++; } // §11.3(a): one of his own company running beside him (DESIGN: strangers running past stress him, but do not start him)
          continue;
        }
        if (STA[o] === S_CAPT) continue;
        if (STU[o] === ST_FLEE || STU[o] === ST_RALLY) { if (d2 < ffd) { ffd = d2; fleeFoe = o; } continue; } // the scattered are prey, running or not
        // §5: at most ~3 men can strike one man in a line — a fourth picks the next-nearest instead
        const crowd = NA[o] >= 3 && o !== myFoe ? 4 : 0;
        if (d2 + crowd < fd) { fd = d2 + crowd; foe = o; }
        if (d2 < 25) { enemies5++; if (dx * fx + dy * fy < 0.5 * Math.sqrt(d2)) flankNear++; }
        if (d2 < 1) dens++;
      }
    }
  }
  if (foe >= 0) fd = Math.hypot(S.x[foe] - x, S.y[foe] - y); else fd = 1e9; ffd = Math.sqrt(ffd);
  // crowd crush (§5): > 3 men/m² for > 10 s
  const density = (dens + 1 + bodiesAt(cs, x, y)) / Math.PI;
  if (density > C.crushDensity) {
    S.crushT[i] += dtP;
    if (S.crushT[i] > 10 && S.posture[i] === 0 && w.rng.next() < C.crushFall * dtP) knockDown(cs.ctx, i, 1, -1, "crush");
    if (S.posture[i] === 1 && bodiesAt(cs, x, y) + dens > 4 && w.rng.next() < C.crushAsphyx * dtP) { fell(cs.ctx, i, -1, W_INSTANT, "crush"); crushMoment(w, cs, i); return; }
  } else S.crushT[i] = 0;
  // ---- pursuit: a man whose enemy runs may break ranks after him (§12, discipline resists)
  const c = u.c;
  if (st === ST_PURSUE && fleeFoe < 0 && hunt(w, cs, i, u, -1, ST_FORMED, mounted)) {
    /* still hunting */
  } else if (st === ST_PURSUE) {
    if (fleeFoe < 0 || ffd > 40 || S.wbal[i] < 0.15 * S.wp[i] || Math.hypot(x - u.ax, y - u.ay) > (mounted ? 1500 : 300) || u.order.kind === "hold" && !mounted && Math.hypot(x - u.ax, y - u.ay) > 60) {
      S.status[i] = ST_FORMED; S.state[i] = S_IDLE; S.foe[i] = -1;
    } else { S.foe[i] = fleeFoe; S.state[i] = S_FIGHT; }
  } else if (hunt(w, cs, i, u, fleeFoe, st, mounted)) {
    /* riding to the nearest knot of fugitives */
  } else if ((foe < 0 || fd > 6) && fleeFoe >= 0 && ffd < (mounted ? 25 : 12) && !c.broken && st <= ST_WAVER) {
    const sent = mounted && (u.c.phase === "pursuit" || u.c.tgtRouting);  // horse sent after a broken enemy
    const pursue = sent ? 0.8 : C.pursueP * (1 - S.disc[i]) * (u.order.kind === "assault" || u.pursue ? 2 : 1);
    if (w.rng.next() < pursue) { S.status[i] = ST_PURSUE; S.foe[i] = fleeFoe; S.state[i] = S_FIGHT; S.sec[i] = -1; w.events.push({ t: w.tick, kind: "pursue", who: i }); }
  }
  // ---- contact
  const engR = reach + C.engage + (mounted ? 2 : 0);
  // a rider in the run-in of a charge is not "in a melee" until his horse has met the line (or refused it)
  const inRunIn = mounted && c.phase === "charge" && S.pursueT[i] < (c.chargeStart ?? 0);
  if (S.status[i] !== ST_PURSUE && !inRunIn) {
    // (in the lull the lines stand at weapon's length, so the fighting distance reaches deep into a formed body: the
    // ranks behind the ones whose weapons reach — W.ranks: two for spears, four for pikes — are pressing up, not in
    // the fight, unless the man in front is at their own weapon's end or their line is surging)
    const support = S.rank[i] >= Math.max(1, W.ranks || 1) && !cs.edge[i] && !u.disordered && !c.broken && u.formation !== "loose" && !mounted && !(c.flFrac > 0.3) && fd > reach + 0.5;
    if (foe >= 0 && fd <= engR && !(u.disengage && fd > 1.5) && !support) {
      S.foe[i] = foe; S.state[i] = S_FIGHT;
      // sector = (pair of units, 10 m bucket along the lower-id unit's front): both sides of a local
      // contact share it, whatever the orientation of the lines
      const mx = (x + S.x[foe]) * 0.5, my = (y + S.y[foe]) * 0.5;
      const ou = S.unit[foe], lo = Math.min(u.id, ou), hi = Math.max(u.id, ou), ua = lo === u.id ? u : w.units.get(ou);
      const lat = ua ? (mx - ua.ax) * Math.cos(ua.facing) + (my - ua.ay) * Math.sin(ua.facing) : 0;
      const key = ((lo & 1023) * 2048 + (hi & 2047)) * 128 + clamp(((lat / C.secSize) | 0) + 64, 0, 127);
      S.sec[i] = key;
      let sec = cs.sec.get(key);
      if (!sec) { sec = newSector(w, cs, key, mx, my); cs.sec.set(key, sec); }
      const tm = team & 1, a = sec.acc[tm];
      const ag = effAg(S, i, friends5, enemies5, cs);
      a.n++; a.pi += C.aggW[ag] * (1 - Math.min(1, S.stress[i])) * wFrac(S, i); a.wf += wFrac(S, i); a.st += S.stress[i];
      if (S.role[i] === 1 || (c.leader >= 0 && S.alive[c.leader] && Math.abs(S.x[c.leader] - x) + Math.abs(S.y[c.leader] - y) < 20)) a.lead = 1;
      a.units.add(u.id);
      c.eng++; c.gap += fd; if (sec.state === 1) c.engFl++;
      // how far the front rank's PLACES stand from the men they face (unitUpdate leans the body in on it)
      // (to his foe's place, when the foe is in the other front rank: the two bodies' fronts, not where men have stepped to)
      // (along the body's facing: how far apart the two fronts stand, not how far to a man standing off to one side)
      if (S.rank[i] === 0 && (S.slotX[i] || S.slotY[i]) && (S.rank[foe] === 0 || cs.edge[foe]) && (S.slotX[foe] || S.slotY[foe])) { c.sg += Math.abs((S.slotX[foe] - S.slotX[i]) * -Math.sin(u.facing) + (S.slotY[foe] - S.slotY[i]) * Math.cos(u.facing)); c.sgn++; }
    } else if (S.state[i] === S_FIGHT) { S.state[i] = S_IDLE; S.foe[i] = -1; S.sec[i] = -1; }
    // out of the ranks, a man with an enemy a few steps off goes to him (world.moveUnit walks him there); a man
    // ordered away, a bowman with arrows left, and the faint-hearted do not
    else if (u.disordered && S.state[i] !== S_FIGHT) S.foe[i] = foe >= 0 && fd < C.brawlR && st <= ST_WAVER && (S.agE[i] === 0 || (S.agE[i] === 1 && (cs.nAtk[foe] > 0 || S.posture[foe]))) && !(S.state[foe] === S_FIGHT && cs.sec.get(S.sec[foe])?.state !== 1) && u.order.kind !== "move" && !(S.missile[i] && S.ammo[i] > 0) && !u.disengage ? foe : -1;
  }
  // effective aggression (stored for the melee tick)
  S.agE[i] = effAg(S, i, friends5, enemies5, cs);
  // ---- morale (§11)
  const I = INFO; I.fleeFriends = fleeFriends; I.flankNear = flankNear; I.enemiesNear = enemies5; I.friendsNear = friends5; I.foe = foe; I.fd = fd; I.near = near;
  moraleThink(w, cs, i, u, dtP, I);
}

// the press becomes a crush (Agincourt, Dupplin Moor): the third man smothered within 20 m and 30 s is a moment
function crushMoment(w, cs, i) {
  const S = w.S, L = cs.crushLog || (cs.crushLog = []), t = w.time;
  L.push([t, S.x[i], S.y[i], S.team[i]]); while (L.length && t - L[0][0] > 30) L.shift();
  const near = L.filter((q) => q[3] === S.team[i] && Math.hypot(q[1] - S.x[i], q[2] - S.y[i]) < 20).length;
  if (near === 3 && t - (cs.crushMomentT ?? -1e9) > 120) { cs.crushMomentT = t; w.events.push({ t: w.tick, kind: "decisive-moment", type: "crush", title: "The press becomes a crush", team: S.team[i], unit: S.unit[i], x: S.x[i], y: S.y[i], salience: 0.85 }); }
}

// §12 looting: a man who has stopped pursuing strips the fallen near him — and the wounded enemy among
// them are killed (the Towton skulls). He goes back to his colours when his time is up.
function loot(w, cs, i, u) {
  const S = w.S, t = w.time;
  if (t > S.busyT[i]) { S.status[i] = ST_FORMED; S.state[i] = S_IDLE; S.foe[i] = -1; return; }
  let best = -1, bd = 40 * 40;
  for (const d of cs.downed) { if (S.state[d] !== S_DOWN || S.team[d] === S.team[i]) continue; const dx = S.x[d] - S.x[i], dy = S.y[d] - S.y[i], d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = d; } }
  if (best < 0) { S.power[i] = PH.rest; return; }
  S.state[i] = S_RALLY; // walks on his own (not in the formation), see moveLooter
  S.foe[i] = best; S.fdx[i] = S.x[best]; S.fdy[i] = S.y[best];
}

// A body sent after a broken enemy hunts: a man with no fugitive within reach of his eyes rides (or runs)
// for the nearest knot of them up to 150 m away (coarse grid) and takes them in turn (§12).
// Foot cannot run men down across the country — but they do go after the ones who cannot run: men mired in
// a brook, a ditch or a bog, and unhorsed riders in full harness (C.miredGoing; within 50 m).
function hunt(w, cs, i, u, fleeFoe, st, mounted) {
  const S = w.S, c = u.c;
  if (fleeFoe >= 0 || c.broken || st > ST_WAVER || !(c.phase === "pursuit" || c.tgtRouting) || !cs.fcnt) return false;
  if (!mounted && (S.missile[i] || u.order.kind !== "assault")) return false;
  const team = S.team[i], n = cs.cn, CG = cs.CG, ci = (S.x[i] / CG) | 0, cj = (S.y[i] / CG) | 0, R = mounted ? 15 : 5;
  const fc = mounted ? cs.fcnt[1 - team] : cs.slc[1 - team], fx = mounted ? cs.fsx[1 - team] : cs.slx[1 - team], fy = mounted ? cs.fsy[1 - team] : cs.sly[1 - team];
  let best = -1, bd = 1e18;
  for (let j = Math.max(0, cj - R); j <= Math.min(n - 1, cj + R); j++) for (let q = Math.max(0, ci - R); q <= Math.min(n - 1, ci + R); q++) {
    const k = j * n + q, m = fc[k]; if (!m) continue;
    const dx = fx[k] / m - S.x[i], dy = fy[k] / m - S.y[i], d2 = dx * dx + dy * dy;
    if (d2 < bd) { bd = d2; best = k; }
  }
  if (best < 0) return false;
  S.status[i] = ST_PURSUE; S.state[i] = S_FIGHT; S.foe[i] = -2; S.sec[i] = -1;
  S.fdx[i] = fx[best] / fc[best]; S.fdy[i] = fy[best] / fc[best];
  return true;
}

// effective aggression class: fatigue and wavering (§6.2, §11.1)
function effAg(S, i, friends, enemies, cs) {
  let ag = S.aggr[i];
  const wf = S.wbal[i] / S.wp[i];
  if (wf < 0.3 && ag === 0) ag = 1;
  if (S.stress[i] > MOR.waver) ag = Math.min(2, ag + 1);
  return ag;
}

// ------------------------------------------------------------------ sectors (§8)
function newSector(w, cs, key, x, y) {
  const mk = () => ({ n: 0, pi: 0, wf: 0, st: 0, lead: 0, units: new Set() });
  cs.stats.contacts++;
  return { key, x, y, state: 1, t0: w.time, age: 0, acc: [mk(), mk()], last: [mk(), mk()], loss: [0, 0], loss10: [0, 0], flLoss: [0, 0], first: true, pi: [0, 0], idle: 0 };
}
function sectorsUpdate(w, cs) {
  const t = w.time, dtP = DT * PERC, rng = w.rng, S = w.S;
  for (const [key, sec] of cs.sec) {
    const [a0, a1] = sec.acc;
    if (a0.n === 0 && a1.n === 0) { if (++sec.idle > 2) cs.sec.delete(key); continue; }
    sec.idle = 0;
    const tmp = sec.last; sec.last = sec.acc; sec.acc = tmp;
    for (const a of sec.acc) { a.n = 0; a.pi = 0; a.wf = 0; a.st = 0; a.lead = 0; a.units.clear(); }
    sec.age += dtP;
    for (let s = 0; s < 2; s++) { sec.loss[s] *= Math.exp(-dtP / 60); sec.loss10[s] *= Math.exp(-dtP / 10); }
    const L = sec.last;
    for (let s = 0; s < 2; s++) {
      const a = L[s]; if (!a.n) { sec.pi[s] = 0; continue; }
      const o = L[1 - s];
      const enemyWaver = o.n && o.st / o.n > MOR.waver ? 1 : 0;
      // war cry / horns: at first contact, and whenever a captain on the spot urges them on after a long lull
      const cry = sec.first || (a.lead && sec.state === 0 && t - sec.t0 > C.urgeAfter) ? C.warcry : 0;
      sec.pi[s] = a.pi / a.n + C.leaderBonus * a.lead + cry + C.waverBonus * enemyWaver - C.lossPen * Math.min(1, sec.loss[s] / 3);
    }
    const both = L[0].n > 0 && L[1].n > 0;
    if (both) { cs.stats.secT += dtP; if (sec.state === 1) cs.stats.flurrySecT += dtP; }
    if (sec.state === 1) {
      const wf0 = L[0].n ? L[0].wf / L[0].n : 1, wf1 = L[1].n ? L[1].wf / L[1].n : 1;
      const dur = t - sec.t0;
      if ((!both && !sec.oneSided) || (!L[0].n && !L[1].n) || dur > C.flurryMax || (dur > 4 && (wf0 < C.flurryEndW || wf1 < C.flurryEndW || sec.loss10[0] > C.flurryLoss || sec.loss10[1] > C.flurryLoss))) {
        // the flurry ends; the side that lost more (per man) gives ground
        const r0 = sec.flLoss[0] / Math.max(1, L[0].n), r1 = sec.flLoss[1] / Math.max(1, L[1].n);
        const loser = r0 > r1 ? 0 : r1 > r0 ? 1 : (wf0 < wf1 ? 0 : 1);
        // the push (DESIGN): the loser gives ground — more the harder the other side pressed (surge pressure ×
        // √depth, plus the impetus of a body that came in at pace) — and the winner follows him up unless it was
        // ordered to hold its ground: over a few pulses the line visibly bows back and gives
        if (both) {
          const P = [0, 0];
          for (let s2 = 0; s2 < 2; s2++) { let rk = 0, pr = 0, m = 0; for (const uid of L[s2].units) { const uu = w.units.get(uid); if (!uu?.c) continue; rk += Math.min(6, uu.c.ranks || 1); pr = Math.max(pr, uu.c.press || 0); m++; } P[s2] = sec.pi[s2] * Math.sqrt(m ? rk / m : 1) + pr; }
          const adv = clamp((P[1 - loser] - P[loser]) / Math.max(0.3, P[1 - loser]), 0, 1);
          const give = rng.range(C.pushback[0], C.pushback[1]) * (1 + C.pressGive * adv);
          for (const uid of L[loser].units) { const u = w.units.get(uid); if (u?.c) u.c.push += give / Math.max(1, L[loser].units.size); }
          for (const uid of L[1 - loser].units) { const u = w.units.get(uid); if (u?.c && u.hold && u.order.kind !== "hold" && !ARM_BY_ID[S.arm[u.members[0]]]?.mounted) { const k = give * 0.8 / Math.max(1, L[1 - loser].units.size); u.c.anchorX += -Math.sin(u.facing) * k; u.c.anchorY += Math.cos(u.facing) * k; } }
        }
        // §8: every cycle leaves both sides more worn; losing it more so (DESIGN: unit baseline stress)
        for (let s2 = 0; s2 < 2; s2++) for (const uid of L[s2].units) { const u = w.units.get(uid); if (u?.c) u.c.flurries += (s2 === loser ? 1 : 0.5) / Math.max(1, L[s2].units.size); }
        if (both || dur > 4) { cs.stats.flurries++; cs.stats.flurryDur += dur; } // (not a pulse: a brush of stragglers)
        sec.state = 0; sec.t0 = t; sec.flLoss[0] = sec.flLoss[1] = 0; sec.first = false; sec.oneSided = false;
      }
    } else if (both || (L[0].n > 0) !== (L[1].n > 0)) {
      // (one side only: the men with the longer weapons are in fighting distance and the others are not — pikes
      // against men with swords and bills. They may surge on their own; the others meet them when they come on.)
      const lull = t - sec.t0;
      const pmax = Math.max(sec.pi[0], sec.pi[1]);
      if (lull > C.lullMin && (pmax > C.surgeAt || (both && lull > C.lullLong))) {
        const h = Math.max(pmax > C.surgeAt ? C.surgeK * Math.min(4, (pmax - C.surgeAt) / C.surgeSlope + 0.25) : 0, lull > C.lullLong ? C.lullFloor : 0);
        if (rng.next() < 1 - Math.exp(-h * dtP)) { if (both) { cs.stats.lulls++; cs.stats.lullDur += lull; } sec.state = 1; sec.t0 = t; sec.oneSided = !both; }
      }
    }
  }
}

// ------------------------------------------------------------------ melee tick (§7)
const nb2 = [];
function meleeTick(w, cs) {
  const S = w.S, t = w.time, rng = w.rng, ctx = cs.ctx;
  const tmp = cs.nAtk; cs.nAtk = cs.nAtkNext; cs.nAtkNext = tmp; cs.nAtkNext.fill(0, 0, S.n);
  const fwd = w.tick & 1; // alternate processing order every tick: no side gets to strike first (mirror bias)
  for (let q = 0; q < S.n; q++) {
    const i = fwd ? q : S.n - 1 - q;
    if (!S.alive[i] || S.state[i] !== S_FIGHT) continue;
    const f = S.foe[i];
    if (f === -2) { // hunting: ride for the fugitives' last known knot
      const u2 = w.units.get(S.unit[i]);
      if (Math.hypot(S.fdx[i] - S.x[i], S.fdy[i] - S.y[i]) < 4 || !u2) { S.state[i] = S_IDLE; S.foe[i] = -1; continue; }
      moveToward(w, S, i, S.fdx[i], S.fdy[i], runSpeed(S, i, u2), true);
      S.power[i] = S.horseOK[i] === 1 ? 250 : PH.flurry[0];
      continue;
    }
    if (f < 0 || !S.alive[f] || S.state[f] === S_CAPT) {
      // a pursuer whose man has gone down takes the next one in sight at once
      const nf = S.status[i] === ST_PURSUE ? nearestFugitive(w, i, 20) : -1;
      if (nf < 0) { S.foe[i] = -1; S.state[i] = S_IDLE; continue; }
      S.foe[i] = nf; q--; continue; // reprocess this man with his new quarry
    }
    if (S.lvl[f] !== S.lvl[i]) { S.foe[i] = -1; S.state[i] = S_IDLE; continue; } // (castle.js: he has gone up or down a stair or ladder out of reach)
    const u = w.units.get(S.unit[i]); if (!u) continue;
    const pursuing = S.status[i] === ST_PURSUE;
    if (pursuing && rng.next() < C.lootHaz * (1 - S.disc[i]) * DT) { S.status[i] = ST_LOOT; S.state[i] = S_IDLE; S.foe[i] = -1; S.busyT[i] = t + rng.range(60, 240); continue; }
    const dx = S.x[f] - S.x[i], dy = S.y[f] - S.y[i], d = Math.hypot(dx, dy) || 0.01;
    const W = WEAPON_BY_ID[S.weapon[i]], mounted = S.horseOK[i] === 1;
    const sec = pursuing ? null : cs.sec.get(S.sec[i]);
    const CM = w.castleM, flurry = pursuing || (sec ? sec.state === 1 : false) || (CM !== undefined && CM.cap > i && CM.cap > f && (CM.link[i] >= 0 || CM.link[f] >= 0) && S.wbal[i] > C.flurryEndW * S.wp[i] && S.agE[i] < 2); // (castle.js: at the head of a stair or ladder there is no standing off at a weapon's length — it is fought out while a man has the wind for it)
    const st = S.status[i];
    const down = S.posture[i] !== 0 || S.stunT[i] > t;
    const ag = S.agE[i];
    const willing = !down && (pursuing || (st <= ST_WAVER && ag < 2 && S.wbal[i] > 0.1 * S.wp[i])) && S.busyT[i] <= t;
    S.facing[i] = Math.atan2(dy, dx);
    // ---- movement
    if (!down && S.busyT[i] <= t) {
      let tx, ty, sp;
      if (flurry && (willing || pursuing)) {
        let want = pursuing ? Math.max(0.6, W.reach * 0.6) : Math.max(0.7, Math.min(W.reach, 2.2) * 0.8);
        // a horse will not walk onto a steady hedge of points: the rider mills just outside it (§10.2)
        if (mounted && !pursuing && S.horseOK[f] !== 1) { const fu = w.units.get(S.unit[f]); if (fu?.c && w.rng.next() < (fu.c.horseproof || 0)) want = Math.max(want, 3.2); }
        const k = (d - want) / d; tx = S.x[i] + dx * k; ty = S.y[i] + dy * k;
        sp = pursuing ? runSpeed(S, i, u) : mounted ? 2.5 : 1.3;
        // (the battle-feel brief §1: a formation fights AS its formation — a wedge stays a wedge, a ring a ring, a
        // deep block keeps its depth: a man whose own place in the ranks is beyond striking distance of his foe does
        // not leave it to go round to him; he presses up behind his file and waits to step into a gap — while the
        // enemy stands formed; once it wavers, men go in at it wherever it gives)
        if (!pursuing && !u.c?.broken && !u.disordered && u.formation !== "loose" && !(u.formation === "schiltron" && u.order.kind === "assault") && (S.slotX[i] || S.slotY[i]) && w.units.get(S.unit[f])?.state === "formed" && Math.hypot(S.x[f] - S.slotX[i], S.y[f] - S.slotY[i]) > W.reach + C.keepPlace) {
          const sx = S.slotX[i], sy = S.slotY[i], ld = Math.hypot(S.x[f] - sx, S.y[f] - sy) || 1;
          tx = sx + (S.x[f] - sx) / ld * 0.6; ty = sy + (S.y[f] - sy) / ld * 0.6; sp = 1.1;
        }
        // a pikeman or spearman does not step out of his rank to meet a horseman: he keeps his place and takes
        // the horse on the point at his weapon's length (§10.2; a hedge that comes forward to a sword's length is no hedge)
        if (!mounted && !pursuing && W.long && S.horseOK[f] === 1 && S.status[i] <= ST_WAVER && !u.disordered) { tx = S.slotX[i]; ty = S.slotY[i]; sp = 1.1; }
      } else if (!flurry && !pursuing && !mounted && !down && S.horseOK[f] !== 1 && st <= ST_WAVER && ag < 2 && (u.disordered || S.rank[i] === 0 || cs.edge[i])) {
        // the lull: the front men stand off at their weapon's length (points crossed, a sword's length and a step),
        // each stepping in and back on his own rhythm (C.lullStand); a blown man stands in the line all the same,
        // getting his wind — he does not strike (lullExchange wants him willing). A man whose place is well back of
        // the man he faces keeps it, pressed up (the body leans in after its front: unitUpdate).
        const base = clamp(W.reach, 0.9, 2.2);
        const per = C.lullPer[0] + (C.lullPer[1] - C.lullPer[0]) * hash01(i * 7919 + 13);
        const wave = 0.5 + 0.5 * Math.sin(6.2832 * (t / per + hash01(i * 104729 + 7)));
        const want = base + C.lullStand[0] + (C.lullStand[1] - C.lullStand[0]) * wave + (u.disordered ? 0.4 : 0);
        const far = (S.slotX[i] || S.slotY[i]) && !u.disordered && !u.c?.broken && u.formation !== "loose" && Math.hypot(S.x[f] - S.slotX[i], S.y[f] - S.slotY[i]) > W.reach + C.keepPlace + 1;
        if (far && d >= want) { const sx = S.slotX[i], sy = S.slotY[i], ld = Math.hypot(S.x[f] - sx, S.y[f] - sy) || 1; tx = sx + (S.x[f] - sx) / ld * 0.6; ty = sy + (S.y[f] - sy) / ld * 0.6; sp = 1.1; }
        else { const k = (d - want) / d; tx = S.x[i] + dx * k; ty = S.y[i] + dy * k; sp = 0.9; }
      } else if (u.disordered && d < C.lullGap) {
        // (a man out of his ranks with no fight left in him backs off a few paces from the man in front, catches his breath, glares)
        const k = (d - C.lullGap) / d; tx = S.x[i] + dx * k; ty = S.y[i] + dy * k; sp = 0.9;
      } else { tx = S.slotX[i]; ty = S.slotY[i]; sp = 1.1; }
      moveToward(w, S, i, tx, ty, sp, pursuing);
    }
    // ---- blows
    const inReach = d <= W.reach + 0.5 + (mounted ? 0.8 : 0);
    if (flurry && inReach) cs.nAtkNext[f] = Math.min(255, cs.nAtkNext[f] + 1);
    S.power[i] = !flurry ? PH.lull : (willing && inReach) ? PH.flurry[ag] : down ? PH.hold : S.power[i] > PH.hold ? S.power[i] : PH.hold;
    if (!flurry) { if (sec && willing && d <= W.reach + 1.3 && !mounted && t >= S.nextAtk[i]) lullExchange(w, cs, i, f, d, dx, dy, W, ag); continue; } // (a feint is a lunge: it reaches a step further than a blow stood still)
    if (cs.jab[i]) { cs.jab[i] = 0; if (S.nextAtk[i] > t) S.nextAtk[i] = t; } // (a feint's timing does not hold back the first real blow of the surge)
    if (!willing || !inReach || t < S.nextAtk[i]) continue;
    const rate = (S.posture[f] || S.stunT[f] > t) && ag < 2 ? 30 : pursuing ? Math.max(W.rate[0], 12) : (ag === 2 ? 0 : W.rate[ag]); // a man on the ground is set upon (daggers, 30/min)
    if (!rate) { S.nextAtk[i] = t + 2; continue; }
    S.nextAtk[i] = t - Math.log(1 - rng.next() * 0.9999) * 60 / rate;
    if (t - S.atkTime[i] > 10) S.atkTime[i] = t; // start of this bout
    // shield-bash and shove (the battle-feel brief #2/§3.1): a man with a shield close in drives the rim or boss into
    // his foe instead of a cut — more often a man in harness, who fears the answer less; it drives him back,
    // sometimes off his feet, and opens a gap (then the next blow finds him down)
    if (!mounted && !pursuing && S.status[f] !== ST_FLEE && d < 1.3 && S.shieldArm[i] && S.shield[i] && S.shield[i] < 5 && S.horseOK[f] !== 1 && !S.posture[f] && ag === 0 && rng.next() < C.bashP[S.armour[i] >= 3 ? 1 : 0]) {
      const push = rng.range(C.bashPush[0], C.bashPush[1]) * (0.6 + 0.4 * S.strength[i]) / (0.6 + 0.4 * S.strength[f]), ux = dx / d, uy = dy / d;
      S.x[f] += ux * push; S.y[f] += uy * push;
      const down = rng.next() < C.bashDown * (1 + S.strength[i] - S.strength[f]) * (S.wbal[f] < 0.3 * S.wp[f] ? 1.5 : 1);
      w.events.push({ t: w.tick, kind: "bash", a: i, d: f, dx: ux, dy: uy, down });
      if (down) knockDown(ctx, f, 1, i, "bash"); else S.slipT[f] = t + 1.5; // (staggered: his guard is off for a moment)
      continue;
    }
    const g = blowGeom(w, cs, i, f, d, sec);
    const res = resolveBlow(ctx, i, f, g);
    w.events.push({ t: w.tick, kind: "blow", a: i, d: f, res, dx: dx / d, dy: dy / d }); // (animation + sound: docs/anim-sim-signals.md §1)
    if (cs.dbgBlow) { const B = cs.dbgBlow; B.n++; B.out[res + 1] = (B.out[res + 1] || 0) + 1; B.off[Math.min(3, (Math.abs(g.off) / (Math.PI / 3)) | 0)]++; B.nAtk[Math.min(6, g.nAtk)]++; B.ag[g.ag]++; B.dist += d; }
    if (S.alive[f] && S.status[f] === ST_FLEE && pursuing) { /* keep chasing */ }
  }
  // the loser of the race to the anchor: units locked in contact move their anchors to the hold line + surge
  for (const u of w.units.values()) {
    if (!u.hold || !u.c) continue;
    const c = u.c, fx = -Math.sin(u.facing), fy = Math.cos(u.facing);
    const tx = c.anchorX + fx * (c.surge - c.push), ty = c.anchorY + fy * (c.surge - c.push);
    const dx = tx - u.ax, dy = ty - u.ay, dd = Math.hypot(dx, dy), v = 0.8 * DT;
    if (dd > v) { u.ax += dx / dd * v; u.ay += dy / dd * v; } else { u.ax = tx; u.ay = ty; }
  }
}

// the lull's exchanges (C.lullJab): a jab at the man across, a feint, a cut at his weapon — warded, parried or
// turned on the shield; a shield man close in shoulders into him instead and he gives a step. Nothing here wounds:
// the lull's bloodshed is what the calibrated model says it is (the flurries); this is what it looks like.
function lullExchange(w, cs, i, f, d, dx, dy, W, ag) {
  const S = w.S, rng = w.rng, t = w.time, rate = W.rate[ag] * C.lullJab;
  if (!(rate > 0) || S.posture[f] || S.state[f] === S_DOWN) { S.nextAtk[i] = t + 2; return; }
  S.nextAtk[i] = t - Math.log(1 - rng.next() * 0.9999) * 60 / rate; cs.jab[i] = 1;
  const ux = dx / d, uy = dy / d;
  if (d < 1.6 && S.shieldArm[i] && S.shield[i] && S.shield[i] < 5 && rng.next() < C.lullShove) {
    S.x[f] += ux * 0.25; S.y[f] += uy * 0.25;
    w.events.push({ t: w.tick, kind: "shove", a: i, d: f, dx: ux, dy: uy });
  } else w.events.push({ t: w.tick, kind: "blow", a: i, d: f, res: S.shield[f] && S.shieldArm[f] && rng.next() < 0.6 ? 1 : 0, dx: ux, dy: uy, feint: true });
}
function hash01(n) { let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; }

const GEOM = { off: 0, nAtk: 1, dist: 1, dh: 0, grade: 0, flurryAge: 10, footD: { slip: 0, fall: 0 }, footA: { slip: 0, fall: 0 }, defBonus: 0, ag: 1 };
function blowGeom(w, cs, a, d, dist, sec) {
  const S = w.S, g = GEOM;
  const bearing = Math.atan2(S.y[a] - S.y[d], S.x[a] - S.x[d]);
  let off = S.facing[d] - bearing; off = Math.atan2(Math.sin(off), Math.cos(off)); // + = attacker on his right
  g.off = off; g.nAtk = Math.max(1, cs.nAtk[d]); g.dist = dist;
  const ha = w.map.h(S.x[a], S.y[a]), hd = w.map.h(S.x[d], S.y[d]);
  g.dh = ha - hd; g.grade = dist > 0.3 ? (ha - hd) / Math.max(dist, 1) * 100 : 0;
  g.flurryAge = sec ? w.time - sec.t0 : 10;
  footing(w, S.x[d], S.y[d], g.footD); footing(w, S.x[a], S.y[a], g.footA);
  g.ag = S.status[a] === ST_PURSUE ? 0 : S.agE[a];
  g.defBonus = 0;
  if (w.features.length) { const f = featureNear(w, S.x[d], S.y[d], 2.5, (f) => featureDef(f).defenderBonus); if (f) g.defBonus = featureDef(f).defenderBonus.skill || 0; }
  return g;
}

function moveLooter(w, cs, i) {
  const S = w.S, d = S.foe[i];
  S.power[i] = 150;
  const lying = d >= 0 && S.alive[d] && S.state[d] !== S_DOWN && S.posture[d] === 1 && S.horseOK[d] !== 1;
  if (d < 0 || (S.state[d] !== S_DOWN && !lying)) { S.state[i] = S_IDLE; return; }
  const dx = S.x[d] - S.x[i], dy = S.y[d] - S.y[i], dist = Math.hypot(dx, dy);
  if (dist > 1) { moveToward(w, S, i, S.x[d], S.y[d], lying ? 3 : 1.3, false); return; }
  if (lying) { // a knifeman at a fallen rider: the dagger, pinned or not (resolveBlow's misericorde)
    if (w.rng.next() < 0.5 * DT) resolveBlow(cs.ctx, i, d, { off: 0, nAtk: 2, dist: 0.8, flurryAge: 99, ag: 0 });
    if (!S.alive[d] || S.posture[d] !== 1) { S.state[i] = S_IDLE; S.foe[i] = -1; }
    return;
  }
  if (S.lastPass[d] !== i) { S.lastPass[d] = i; if (w.rng.next() < C.finishP) die(w, d, i, "finish"); }
  S.state[i] = S_IDLE; S.foe[i] = -1;
}

function nearestFugitive(w, i, r) {
  const S = w.S; neighbours(w, S.x[i], S.y[i], r, nb2);
  let best = -1, bd = 1e9;
  for (const o of nb2) { if (S.team[o] === S.team[i] || (S.status[o] !== ST_FLEE && S.status[o] !== ST_RALLY) || !S.alive[o]) continue; const d = (S.x[o] - S.x[i]) ** 2 + (S.y[o] - S.y[i]) ** 2; if (d < bd) { bd = d; best = o; } }
  return best;
}

export function runSpeed(S, i, u) {
  const A = ARM_BY_ID[S.arm[i]];
  if (S.horseOK[i] === 1) return S.hwbal[i] > 0.4 * S.hwp[i] ? A.run : S.hwbal[i] > 60 ? Math.min(A.run, 6.5) : 3.6; // gallop while the horse has it, then a hard canter
  const wf = S.wbal[i] / S.wp[i];
  return wf > 0.2 ? Math.min(A.run * 1.4, speedAtPower(S, i, 900, 0, 1.1)) : speedAtPower(S, i, S.cp[i], 0, 1.1);
}

const PUSH = [0, 0];
export function moveToward(w, S, i, tx, ty, sp, pushy) {
  const dx = tx - S.x[i], dy = ty - S.y[i], d = Math.hypot(dx, dy);
  if (d < 0.05) { S.vx[i] = S.vy[i] = 0; return; }
  const g = S.lvl[i] ? 1 : goingMul(w, S.arm[i], S.x[i], S.y[i], dx, dy); // (castle.js: on a wall-walk or a floor)
  const step = Math.min(d, sp * g * DT);
  let vx = dx / d * step, vy = dy / d * step;
  // a horse in the press keeps its body's room from its own side's horses and men (world.bodyPush: an oval, not a man's disc)
  if (S.horseOK[i] === 1) { const p = bodyPush(w, S, i, PUSH); vx += p[0] * DT; vy += p[1] * DT; }
  // keep a little space from friends (no stacking on one foe)
  else neighbours(w, S.x[i], S.y[i], 0.6, nb2);
  if (S.horseOK[i] !== 1)
  for (const o of nb2) { if (o === i || S.team[o] !== S.team[i] || S.lvl[o] !== S.lvl[i]) continue; const ox = S.x[i] - S.x[o], oy = S.y[i] - S.y[o], od = Math.hypot(ox, oy) || 0.05; vx += ox / od * 0.3 * DT; vy += oy / od * 0.3 * DT; } // (0.3 m/s apart: calibrated as 0.12 m per 0.4 s tick)
  S.x[i] = clamp(S.x[i] + vx, 0, w.map.size); S.y[i] = clamp(S.y[i] + vy, 0, w.map.size);
  S.vx[i] = vx / DT; S.vy[i] = vy / DT;
  if (S.horseOK[i] === 1) horseStep(S, i, Math.hypot(vx, vy) / DT, DT);
}

// A moving body stops the moment its front rank comes within fighting distance of a standing enemy
// (checked every tick: at a walk two lines close 1 m per tick, far faster than the perception cycle).
function contactProbe(w, cs, u) {
  const S = w.S, c = u.c; if (!c || c.broken || c.phase === "charge" || u.disengage || u.engine !== undefined) return; // (an engine's crew push on: their men fight where they stand)
  const m = u.members, f = Math.min(m.length, u.files || m.length);
  const team = u.team;
  const lead = m[f >> 1]; if (lead === undefined || !coarseAny(cs, team, S.x[lead], S.y[lead], 2)) return;
  const A = ARM_BY_ID[S.arm[lead]], R = A.maxReach + C.engage;
  for (let k = 0; k < f; k += 2) {
    const i = m[k]; if (!S.alive[i]) continue;
    neighbours(w, S.x[i], S.y[i], R, nb2);
    for (const o of nb2) if (S.team[o] !== team && S.status[o] !== ST_FLEE && S.status[o] !== ST_RALLY && S.state[o] !== S_CAPT && S.lvl[o] === S.lvl[i]) {
      u.hold = true; c.anchorX = c.holdX = u.ax; c.anchorY = c.holdY = u.ay; c.push = 0; c.surge = 0; c.eng = Math.max(c.eng, 1);
      if (c.contactT < 0) { c.contactT = w.time; c.firstContactCas = c.cas; }
      footShock(w, cs, u, o);
      return;
    }
  }
}

// No standoffs (DESIGN): a formed foot body standing still (its order done, or ordered to hold) with a standing
// enemy within C.closeR of its front, in front of it, and not yet at fighting distance, steps up to him at a walk
// (1 m per perception) until the men are in contact — then the line fight (hold, lean, flurry ⇄ lull) takes over.
// Bowmen with shafts left shoot instead; horse is cavalry.js's; a body drawing off is left to go.
function closeUp(w, cs, u) {
  const S = w.S, c = u.c;
  if (u.moving || c.broken || u.disengage || u.disordered || u.isWorkers || u.engine !== undefined || c.phase === "charge" || c.phase === "recoil") return;
  const m = u.members, lead = m[0]; if (lead === undefined) return;
  const A = ARM_BY_ID[S.arm[lead]]; if (A.mounted || A.engine) return;
  if (A.missile) { let ammo = 0; for (let k = 0; k < m.length; k += 4) ammo += S.ammo[m[k]]; if (ammo > 0) return; }
  if (!coarseAny(cs, u.team, u.ax, u.ay, 3)) return;
  if (u.fortified || (w.features.length && featureNear(w, u.ax, u.ay, 8, (q) => featureDef(q).defenderBonus))) return; // (men behind a wall, a ditch or stakes let the enemy come to them)
  const f = Math.min(m.length, u.files || m.length), fx = -Math.sin(u.facing), fy = Math.cos(u.facing);
  let best = 1e9, bx = 0, by = 0;
  for (let k = 0; k < f; k += 3) {
    const i = m[k]; if (!S.alive[i] || S.state[i] === S_FIGHT) { if (S.state[i] === S_FIGHT) return; continue; }
    neighbours(w, S.x[i], S.y[i], C.closeR, nb2);
    for (const o of nb2) {
      if (S.team[o] === u.team || !S.alive[o] || S.status[o] >= ST_FLEE || S.state[o] === S_CAPT || S.state[o] === S_DOWN || S.horseOK[o] === 1 || S.lvl[o] !== S.lvl[i]) continue; // (foot do not step out to meet horse: they stand and brace)
      const ou = w.units.get(S.unit[o]); if (!ou || ou.isWorkers) continue;
      const dx = S.x[o] - S.x[i], dy = S.y[o] - S.y[i], d = Math.hypot(dx, dy);
      if (d < best && dx * fx + dy * fy > 0.5 * d) { best = d; bx = dx; by = dy; }
    }
  }
  if (best > C.closeR || best < A.maxReach + 1) return;
  const step = Math.min(1, best - A.maxReach - 0.8) / best;
  u.ax += bx * step; u.ay += by * step;
}

// DESIGN (§8 first shock, the "push of pike"): a body that arrives at pace does not stop dead at fighting
// distance — it HITS. Shock = (speed of its front − a walk) × √(its ranks ÷ theirs) × its weight of armour ÷
// theirs × how little they are braced for it (stress, moving, loose order). The struck front staggers back (the
// defender's anchor is driven back up to C.shockPushMax m, the attacker follows through), men of their front
// rank — both front ranks if it bursts through a thin, loose or shaken line — are knocked off their feet, and
// the shock goes through the whole body as fear. Walking bodies that meet simply stop and set to (no shock).
function footShock(w, cs, u, o) {
  const S = w.S, c = u.c, v = w.units.get(S.unit[o]);
  if (!v?.c || v.team === u.team || v.c.broken || w.time - (c.shockT ?? -1e9) < 60) return;
  const A = ARM_BY_ID[S.arm[u.members[0]]], B = ARM_BY_ID[S.arm[v.members[0]]];
  if (A.mounted || A.engine || B.engine) return; // (horse: cavalry.js; engines' crews)
  let sp = 0, n = 0; const f = Math.min(u.members.length, u.files || 1);
  for (let k = 0; k < f; k++) { const i = u.members[k]; if (S.alive[i]) { sp += Math.hypot(S.vx[i], S.vy[i]); n++; } }
  sp = n ? sp / n : 0;
  if (sp < C.shockV) return;
  c.shockT = w.time;
  const ranksA = Math.min(6, c.ranks || 1), ranksD = Math.max(1, Math.min(6, v.c.ranks || 1));
  const braced = clamp(1 - v.c.stressM, 0, 1) * (v.moving ? 0.6 : 1) * (v.formation === "loose" ? 0.5 : 1) * (B.mounted ? 0.5 : 1);
  const shock = (sp - C.shockV) * Math.sqrt(ranksA / ranksD) * (1 + 0.1 * A.armour) / (1 + 0.1 * B.armour) * (1.25 - braced);
  if (shock <= 0.05) return;
  const burst = shock > C.shockBurst && (ranksD <= 2 || braced < 0.45);
  const push = Math.min(C.shockPushMax, C.shockPush * shock);
  // the defenders' forward direction, and ours
  const dfx = -Math.sin(v.facing), dfy = Math.cos(v.facing), afx = -Math.sin(u.facing), afy = Math.cos(u.facing);
  const vf = Math.max(1, Math.min(v.members.length, v.files || v.members.length)), rows = burst ? 2 : 1;
  const pD = Math.min(0.7, C.shockDown * shock) * (burst ? 1.5 : 1); let shoves = 0;
  for (let k = 0; k < Math.min(v.members.length, vf * rows); k++) {
    const d = v.members[k]; if (!S.alive[d] || S.posture[d] !== 0) continue;
    if (!coarseAny(cs, v.team, S.x[d], S.y[d], 1)) continue; // (only where our line actually strikes theirs)
    if (w.rng.next() < pD * (k < vf ? 1 : 0.6)) { const a = u.members[Math.min(k % vf, f - 1)] ?? -1; knockDown(cs.ctx, d, 1, a, "shock"); }
    else if (k < vf && shoves < 24) { shoves++; w.events.push({ t: w.tick, kind: "shove", a: u.members[Math.min(k, f - 1)] ?? -1, d, dx: -dfx, dy: -dfy }); }
    S.x[d] -= dfx * push * 0.6; S.y[d] -= dfy * push * 0.6; // the whole front staggers back
  }
  for (const d of v.members) if (S.alive[d] && S.status[d] !== ST_FLEE) S.stress[d] += C.shockStress * shock * (1.3 - S.courage[d]);
  v.c.shockedT = w.time;
  if (v.hold) { v.c.anchorX -= dfx * push; v.c.anchorY -= dfy * push; }
  else { v.ax -= dfx * push; v.ay -= dfy * push; }
  c.anchorX += afx * push * 0.8; c.anchorY += afy * push * 0.8; // and we follow through into the gap
  c.press = Math.min(1.5, shock); // the press goes on in the flurry that follows (sectorsUpdate)
  cs.stats.shocks = (cs.stats.shocks || 0) + 1;
  w.events.push({ t: w.tick, kind: "shock", unit: u.id, on: v.id, shock, burst });
  if (burst) setDisorder(w, v);
  if (burst) w.events.push({ t: w.tick, kind: "decisive-moment", type: "line-burst", title: "The line is burst", team: v.team, unit: v.id, by: u.id, x: v.ax, y: v.ay, salience: 0.75 });
}

// ------------------------------------------------------------------ units
function unitUpdate(w, cs, u) {
  const S = w.S, c = u.c, t = w.time, dtP = DT * PERC;
  if (c.press) c.press = c.press > 0.02 ? c.press * Math.exp(-dtP / 40) : 0; // the impetus of the charge spends itself
  // the squeeze (Dupplin Moor): flank fire narrows a formed body toward its middle (world.moveUnit scales its files'
  // lateral places by 1 − squeeze), density rises, and past 3 men/m² the crowd crush of §5 takes over; it opens out
  // again when the shafts stop
  if (c.flankFire) { c.flankFire *= Math.exp(-dtP / 20); if (c.flankFire < 0.05) c.flankFire = 0; }
  { const want = u.formation === "loose" || c.broken ? 0 : Math.min(C.squeezeMax, C.squeezeK * (c.flankFire || 0) / Math.max(20, u.members.length));
    u.squeeze = (u.squeeze || 0) + clamp(want - (u.squeeze || 0), -0.02 * dtP, 0.01 * dtP); if (u.squeeze < 0.005) u.squeeze = 0; }
  u.enemyNear = nearestEnemy50(cs, u.team, u.ax, u.ay, 450) < 400; // (world.unitLag: on the march stragglers are not waited for)
  if (u.disengage && !u.path && c.phase !== "recoil") u.disengage = false; // got clear
  // contact → hold the line (combat owns the anchor); no contact → the order resumes
  const inContact = c.eng > 0 && u.engine === undefined;
  if (inContact && !u.hold && !u.disengage && !(c.phase === "charge")) {
    u.hold = true; c.anchorX = c.holdX = u.ax; c.anchorY = c.holdY = u.ay; c.push = 0; c.surge = 0;
    if (c.contactT < 0) { c.contactT = t; c.firstContactCas = c.cas; }
  } else if (!inContact && u.hold) { u.hold = false; c.surge = 0; c.push = 0; }
  if (u.hold) {
    // push already applied lives in the anchor
    const fx = -Math.sin(u.facing), fy = Math.cos(u.facing);
    const gap = c.gap / Math.max(1, c.eng);
    const flFrac = c.flFrac = c.engFl / Math.max(1, c.eng);
    // the whole body leans in after its front: in a flurry so the second rank's points reach, in the lull so the
    // ranks stay pressed up behind the men standing off at weapon's length
    const A = ARM_BY_ID[S.arm[u.members[0]]];
    if (c.sgn && !A.mounted) {
      // the body leans in (up to C.leanMax) until its front rank's PLACES stand where its front men fight — striking
      // distance in a flurry, the lull's weapon's length otherwise — so the ranks behind stay pressed up on the men
      // in front and no daylight opens between the lines; a body that has been pushed back further than that, and
      // was not ordered to stand where it is, closes up again at a walk
      const base = clamp(A.maxReach, 0.9, 2.2), sgap = c.sg / c.sgn;
      const want = flFrac > 0.5 ? Math.max(1.6, base * 0.8) : Math.max(2.2, base + 0.5 * (C.lullStand[0] + C.lullStand[1]));
      c.surge = clamp(c.surge + clamp(sgap - want, -1.5, 1.5) * 0.5, 0, C.leanMax); // (both bodies lean: each takes half the gap)
      // (ordered to hold: only back up to the ground it was set on — the line it stood on when the fighting began)
      const hx = u.order.x ?? c.holdX ?? c.anchorX, hy = u.order.y ?? c.holdY ?? c.anchorY;
      if (c.surge >= C.leanMax - 0.01 && sgap > want + 1 && (u.order.kind !== "hold" || (c.anchorX - hx) * fx + (c.anchorY - hy) * fy < -0.25)) { c.anchorX += fx * 0.5; c.anchorY += fy * 0.5; }
    } else {
      c.surge = flFrac * Math.max(0, Math.min(3, gap - Math.min(A.maxReach, 2.2) * 0.8));
      // an attacking body that has been pushed back closes again to the lull's safety distance (2–10 m)
      if (u.order.kind === "assault" && flFrac === 0 && gap > A.maxReach + 2.5) { c.anchorX += fx * 0.5; c.anchorY += fy * 0.5; }
    }
    if (c.push) { c.anchorX -= fx * c.push; c.anchorY -= fy * c.push; c.push = 0; }
    c.contactDur += dtP;
  }
  // a line fight that goes on becomes a brawl: men step out of their files to get at the man in front, round him,
  // past him — the body is out of its ranks until it is formed again
  // (steady veterans keep their files however long it lasts — the §17.1 line fights; it is the shaken, the levy and
  // the untrained whose ranks go: cohesion ≈ discipline, worn down by stress)
  if (u.hold && !u.disordered && u.formation !== "schiltron" && c.contactDur > C.brawlAfter && u.state === "wavering" && c.stressM > C.brawlStress) setDisorder(w, u);
  if (u.disordered && !u.hold) {
    if (u.reform || u.formation === "schiltron") clearDisorder(u); // ordered to form while still fighting: now it can (a schiltron closes its ring at once — it is drilled for nothing else)
    else if (nearestEnemy50(cs, u.team, u.ax, u.ay, 60) > 40) { u.calmT = (u.calmT || 0) + dtP; if (u.calmT > C.calmReform / (0.5 + c.disc) && u.team !== w.humanTeam) clearDisorder(u); }
    else u.calmT = 0;
  }
  c.eng = 0; c.engFl = 0; c.gap = 0; c.sg = 0; c.sgn = 0;
  // a wedge's front is its two sloping edges, not its first row (formationSlots: row r holds members r² … r² + 2r)
  if (u.formation === "wedge" || c.wedge) { c.wedge = u.formation === "wedge"; const m = u.members; for (let k = 0; k < m.length; k++) { const r = Math.floor(Math.sqrt(k)); cs.edge[m[k]] = c.wedge && (k === r * r || k === r * r + 2 * r) ? 1 : 0; } }
  if (!u.hold) closeUp(w, cs, u);
  // rotation during the lull (§5): disciplined units swap blown front men for fresh ones
  if (u.hold && c.disc >= 0.5 && u.files) {
    const m = u.members, f = u.files;
    for (let k = 0; k < Math.min(f, m.length - f); k++) {
      const a = m[k], b = m[k + f];
      if (S.state[a] === S_FIGHT) { const sec = w.cs.sec.get(S.sec[a]); if (sec && sec.state === 1) continue; }
      if (S.wbal[a] < 0.4 * S.wp[a] && S.wbal[b] > 0.7 * S.wp[b] && S.posture[a] === 0 && S.status[b] <= ST_WAVER && w.rng.next() < C.rotateP) { m[k] = b; m[k + f] = a; S.state[a] = S_IDLE; S.foe[a] = -1; }
    }
  }
  unitMorale(w, cs, u, dtP);
  approachShock(w, cs, u, dtP);
  standingOrders(w, cs, u);
  knifemen(w, cs, u);
  if ((w.tick / PERC | 0) % 5 === u.id % 5) plunder(w, cs, u);
  c.tgtRouting = false;
  if (u.order.kind === "assault") {
    const named = u.order.target !== undefined ? w.units.get(u.order.target) : null;
    const tgt = named && named.members.length ? named : [...w.units.values()].find((v) => v.team !== u.team && v.members.length && Math.hypot((v.fx ?? v.ax) - u.order.x, (v.fy ?? v.ay) - u.order.y) < 30);
    c.tgtRouting = !!tgt?.c?.broken;
    if (c.tgtRouting && u.pace === "march" && !ARM_BY_ID[S.arm[u.members[0]]].mounted) u.pace = "quick";
  }
}

// When the enemy has gone from the field, men drift off to strip the fallen (§12: "pursuers loot"; the
// Towton skulls): P 0.002/s × (1 − discipline) per idle man once no standing enemy is within 300 m.
function plunder(w, cs, u) {
  const S = w.S, c = u.c; if (c.broken || u.hold || u.isWorkers || !cs.downed.length) return;
  const lead = u.members[0]; if (lead === undefined) return;
  if (nearestEnemy50(cs, u.team, u.ax, u.ay, 350) < 300) { c.quietSince = w.time; return; }
  if (w.time - (c.quietSince ?? w.time) < 120) return;
  const dtP = DT * PERC, t = w.time;
  for (const id of u.members) {
    if (!S.alive[id] || S.status[id] !== ST_FORMED || S.horseOK[id] === 1) continue;
    if (w.rng.next() < C.plunder * (1 - S.disc[id]) * dtP) { S.status[id] = ST_LOOT; S.busyT[id] = t + w.rng.range(60, 240); S.state[id] = S_IDLE; }
  }
}

// §12/DESIGN (Crécy: "the Welsh and Cornish knifemen went out among the fallen"): foot not locked in a fight
// send a man out to each unhorsed rider or wounded enemy lying within 80 m of them with no standing enemy over him.
function knifemen(w, cs, u) {
  const S = w.S, c = u.c, L = cs.unhorsed; if ((!L.length && !cs.downed.length) || c.broken || c.eng > 0 || ARM_BY_ID[S.arm[u.members[0]]].mounted) return;
  let j = 0, sent = 0;
  for (let k = 0; k < L.length; k++) { const d = L[k]; if (S.alive[d] && S.posture[d] === 1 && S.state[d] !== S_DOWN) L[j++] = d; } // (got up, or now among the wounded)
  L.length = j;
  const cand = L.concat(cs.downed);
  for (const d of cand) {
    if (!S.alive[d] || (S.posture[d] !== 1 && S.state[d] !== S_DOWN)) continue;
    if (sent >= 4 || S.team[d] === u.team || Math.hypot(S.x[d] - u.ax, S.y[d] - u.ay) > 80) continue;
    if (cs.knifed?.get(d) > w.time) continue; // someone is already on his way
    neighbours(w, S.x[d], S.y[d], 6, nb2);
    let guarded = false; for (const o of nb2) if (S.team[o] !== S.team[u.members[0]] && o !== d && S.posture[o] === 0 && S.status[o] !== ST_FLEE && S.alive[o]) { guarded = true; break; }
    if (guarded) continue;
    let best = -1, bd = 1e9;
    for (const i of u.members) { if (!S.alive[i] || S.state[i] === S_FIGHT || S.status[i] > ST_WAVER || S.posture[i]) continue; const q = Math.hypot(S.x[i] - S.x[d], S.y[i] - S.y[d]); if (q < bd) { bd = q; best = i; } }
    if (best < 0) continue;
    S.status[best] = ST_LOOT; S.state[best] = S_RALLY; S.foe[best] = d; S.busyT[best] = w.time + 60;
    (cs.knifed ||= new Map()).set(d, w.time + 30); sent++; cs.stats.knifemen = (cs.stats.knifemen || 0) + 1;
  }
}

// Standing orders the unit's own captain follows without waiting for a messenger (§13 "pre-battle plan"):
// missile men whose shafts are spent fall on an enemy already locked with their friends or wavering
// (Agincourt: the archers joined the melee with mallets and hatchets once the French were disordered).
function standingOrders(w, cs, u) {
  const S = w.S, c = u.c; if (c.broken || u.standing === false) return;
  const A = ARM_BY_ID[S.arm[u.members[0]]];
  if (!A.missile || u.order.kind === "assault") return;
  let ammo = 0, n = 0; for (const id of u.members) if (S.alive[id]) { ammo += S.ammo[id]; n++; }
  // shafts spent — or nothing left to shoot at without hitting one's own men for a minute (the enemy is in
  // among our line): the archers take up mallets and hatchets
  if (!c.noTargetSince || c.mtgt) c.noTargetSince = c.mtgt ? 0 : w.time;
  const idle = !c.mtgt && c.noTargetSince && w.time - c.noTargetSince > 60;
  if (!n || (ammo / n > Math.max(1, (A.ammo || 30) * 0.08) && !idle)) return;
  let best = null, bd = 120;
  for (const v of w.units.values()) {
    if (v.team === u.team || !v.members.length || !v.c) continue;
    if (ARM_BY_ID[S.arm[v.members[0]]].mounted) continue; // archers do not go out after horsemen
    const d = Math.hypot(v.ax - u.ax, v.ay - u.ay); if (d > bd) continue;
    if (v.c.broken || v.hold || v.state === "wavering" || v.state === "shaken") { bd = d; best = v; }
  }
  if (best) { applyOrder(w, u, { kind: "assault", x: best.ax, y: best.ay, pace: "quick", target: best.id, facing: Math.atan2(best.ay - u.ay, best.ax - u.ax) }); c.joinedMelee = w.time; }
}

// §8 first shock: a formed body closing on us in good heart shakes men whose own resolve is lower. If the
// defenders' surge pressure is far below the attackers' and they are already frightened, they may break
// before contact (the "bayonet charge" effect). DESIGN rate C.approachFear × (Π_them − Π_us).
function unitPi(w, u) {
  const S = w.S; let s = 0, n = 0;
  for (const id of u.members) { if (!S.alive[id] || S.status[id] === ST_FLEE) continue; s += C.aggW[S.aggr[id]] * (1 - Math.min(1, S.stress[id])) * (S.wbal[id] / S.wp[id]); n++; }
  return n ? s / n + (u.c && u.c.leader >= 0 && S.alive[u.c.leader] ? C.leaderBonus : 0) : 0;
}
function approachShock(w, cs, u, dtP) {
  const S = w.S, c = u.c; if (c.broken || u.hold) return;
  let worst = 0;
  const CA = w.castles?.length && S.lvl ? w.castleApi : null; let uIn; // (castles: a body on the wall-walk, or beyond the curtain, is not bearing down on us)
  for (const v of w.units.values()) {
    if (v.team === u.team || !v.members.length || !v.c || v.c.broken || !v.moving) continue;
    if (ARM_BY_ID[S.arm[v.members[0]]].mounted) continue; // a charge's terror is its own term (§11.2 "cavalry charging at you")
    const d = Math.hypot(v.ax - u.ax, v.ay - u.ay); if (d > 60) continue;
    if (CA?.insideCastle) { if (S.lvl[v.members[0]] !== S.lvl[u.members[0]]) continue; uIn ??= !!CA.insideCastle(w, u.ax, u.ay); if (!!CA.insideCastle(w, v.ax, v.ay) !== uIn) continue; }
    // is it coming at us?
    const hx = -Math.sin(v.facing), hy = Math.cos(v.facing);
    if (((u.ax - v.ax) * hx + (u.ay - v.ay) * hy) / (d || 1) < 0.5) continue;
    // (a column or files coming off a bridge are not a line bearing down — DESIGN)
    const gap = ((v.c.piE ?? (v.c.piE = unitPi(w, v))) - (c.piE ?? (c.piE = unitPi(w, u)))) * (v.formation === "column" || v.formation === "file2" ? 0.3 : 1);
    if (gap > worst) worst = gap * (v.pace === "charge" || v.pace === "quick" ? 1.5 : 1);
  }
  if (worst > 0) for (const id of u.members) if (S.alive[id] && S.status[id] !== ST_FLEE) { S.stress[id] += C.approachFear * worst * dtP * (1.3 - S.courage[id]); if (cs.dbg) { const D = cs.dbg[u.team] || (cs.dbg[u.team] = {}); D.approach = (D.approach || 0) + C.approachFear * worst * dtP * (1.3 - S.courage[id]); } }
  if ((w.tick / PERC | 0) % 3 === 0) c.piE = undefined;
}

// ------------------------------------------------------------------ events: casualties, stress on witnesses, bodies
function onFell(w, d, a, sev, cause) {
  const cs = w.cs, S = w.S;
  addBody(cs, S.x[d], S.y[d]);
  if (S.state[d] === S_DOWN) cs.downed.push(d);
  const u = w.units.get(S.unit[d]);
  if (u?.c) { u.c.cas++; u.c.lastCasT = w.time; if (cause === "missile") u.c.mcas = (u.c.mcas || 0) + 1; if (S.status[d] === ST_FLEE) u.c.pursuitCas++; else u.c.lineCas++; }
  const sec = cs.sec.get(S.sec[d]);
  if (sec) { const tm = S.team[d] & 1; sec.loss[tm]++; sec.loss10[tm]++; sec.flLoss[tm]++; }
}

function processEvents(w, cs) {
  const S = w.S;
  for (const e of w.events) {
    if (e.kind === "kill" || e.kind === "down") {
      const d = e.victim, x = S.x[d], y = S.y[d], tm = S.team[d];
      // friends who see it (§11.2: +0.04 within 3 m, +0.08 if a messmate — same unit)
      neighbours(w, x, y, 3, nb2);
      // (a man shot down beside you, by an arrow from far off, weighs less than one cut down in front of you by a
      // man you can see — the same discount as on the unit's mood, MOR.missileCasW)
      const wk = e.cause === "missile" ? 1 - MOR.missileCasW * 0.7 : 1;
      for (const o of nb2) { if (S.team[o] !== tm || !S.alive[o] || S.status[o] === ST_FLEE) continue; S.stress[o] += wk * (S.unit[o] === S.unit[d] ? MOR.friendDownBond : MOR.friendDown) * 0.75 * (1.3 - S.courage[o]); if (cs.dbg) { const D = cs.dbg[tm] || (cs.dbg[tm] = {}); D.witness = (D.witness || 0) + (S.unit[o] === S.unit[d] ? MOR.friendDownBond : MOR.friendDown) * 0.75 * (1.3 - S.courage[o]); } }
      if (S.role[d] === 1) { const u = w.units.get(S.unit[d]); if (u?.c && u.c.leaderLost < 0 && u.members.length >= 40) w.events.push({ t: w.tick, kind: "decisive-moment", type: "captain-falls", title: "A captain falls", team: tm, unit: u.id, x, y, salience: 0.55 }); if (u?.c) { u.c.leaderLost = w.time; u.c.leaderNews = { t: w.time, x, y, heard: new Set() }; } }
    }
  }
}

// ------------------------------------------------------------------ the downed: bleeding, massacre, recovery
function downedUpdate(w, cs) {
  const S = w.S, dtP = DT * PERC, rng = w.rng, ctx = cs.ctx;
  const D = cs.downed; let j = 0;
  for (let k = 0; k < D.length; k++) {
    const d = D[k];
    if (S.state[d] !== S_DOWN) continue;
    // bleeding (§4.3, ATLS)
    if (S.bleed[d] > 0 && bleedStep(S, d, dtP) === 2) { die(w, d, -1, "bleed"); continue; }
    // victors passing over the field kill downed enemies (§12, P=0.5 per man passed)
    neighbours(w, S.x[d], S.y[d], 3, nb2);
    // §8 in the lull the wounded crawl or are dragged back: a man with comrades beside him and no enemy
    // on top of him is got away behind the line (safe while his side holds the field)
    const du = w.units.get(S.home[d]);
    if (S.lastPass[d] === -2 && du?.c && !du.c.broken) { D[j++] = d; continue; }
    let friend = false, enemyClose = false;
    for (const o of nb2) { if (S.team[o] === S.team[d]) { if (S.status[o] <= ST_WAVER && S.state[o] !== S_FIGHT) friend = true; } else if (Math.hypot(S.x[o] - S.x[d], S.y[o] - S.y[d]) < 2) enemyClose = true; }
    if (friend && !enemyClose && rng.next() < 0.3) { S.lastPass[d] = -2; D[j++] = d; continue; }
    let killed = false;
    for (const o of nb2) {
      if (Math.hypot(S.x[o] - S.x[d], S.y[o] - S.y[d]) > 1.3) continue;
      if (S.team[o] === S.team[d] || S.status[o] === ST_FLEE || S.status[o] === ST_RALLY || S.state[o] === S_CAPT) continue;
      // men still locked in the line fight do not stoop to finish the fallen; the field is swept when the
      // enemy has gone (§12: "the victor's infantry passing over the field")
      if (S.state[o] === S_FIGHT && S.status[o] !== ST_PURSUE) continue;
      // (nor do the ranks pressed up behind them: a body locked in the fight keeps its places — the lull's lean
      // carries its front ranks over the men lying between the lines)
      if (S.status[o] !== ST_PURSUE && S.rank[o] < 4) { const ou = w.units.get(S.unit[o]); if (ou?.hold && !ou.c?.broken && !ou.disordered) continue; }
      if (S.lastPass[d] === o) continue;
      S.lastPass[d] = o;
      if (rng.next() < C.finishP) { die(w, d, o, "finish"); killed = true; break; }
    }
    if (!killed) D[j++] = d;
  }
  D.length = j;
}
function die(w, d, by, cause) {
  const S = w.S;
  S.state[d] = S_DEAD; if (S.sev[d] < W_INSTANT) S.sev[d] = W_INSTANT;
  w.events.push({ t: w.tick, kind: "die", victim: d, by, cause });
}
export { die };
