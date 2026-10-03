// Missiles (docs/combat-research.md §9): point-mass ballistics with quadratic drag, lowest-trajectory
// solutions tabulated per missile and height difference, area vs aimed dispersion, arrows resolved at
// impact against the men actually standing under the falling shaft (plan footprint + silhouette at the
// impact angle), shields, pavises, cover, wind, ammunition and recovery, and missile stress.
import { S_FIGHT, S_FLEE, S_RALLY, S_CAPT, ST_FLEE, ST_RALLY, ST_FORMED, ST_WAVER, ST_SHAKEN, W_LIGHT, W_INCAP, clamp } from "./soldiers.js";
import { ARM_BY_ID } from "./arms.js";
import { MISSILES, MISSILE_KEYS, SHIELDS, SH_PAVISE, Z_HORSE } from "./kit.js";
import { neighbours, DT } from "./world.js";
import { pickZone, penetrate, woundSeverity, incidence, WC } from "./wounds.js";
import { applyWound } from "./melee.js";
import { PH } from "./physio.js";
import { MOR } from "./morale.js";
import { isFoe } from "./sides.js";
import { weather, coverAt, featureCrossed, featureDef } from "./ground.js";
import { M_BODY } from "./mounts.js"; // share of shafts that take the mount (0.6 on a horse, exactly)

export const BAL = {
  g: 9.81, launchH: 1.5, stressR: 1.8,
  sigLong: 0.035, sigLat: 0.02,           // §9.3 area fire σ as a fraction of range (σ_long 0.04 → 0.035, DESIGN, strike share)
  aimedMax: 80, aimedSig: [2.0, 0.8],     // §9.3 aimed fire σ (deg) at skill 0.2 → 0.9
  footR: 0.26, horseR: 0.62,              // plan radius (0.25 m² man, 1.2 m² horse)
  standH: 1.7, horseH: 2.6,
  shieldSil: 0.77,                        // silhouette m² that a 0.3 m² shield fraction is judged against
  pickup: 0.4,                            // §9.4 30–50 % recoverable
  burstRange: 160,
  armourCalm: 0.15, advanceCalm: 0.6,     // DESIGN: arrow-stress × per armour class (plate MAA ×0.4, knights ×0.25), × going forward at the enemy
  volleyPeriod: 1.0, volleyDraw: 2.5, volleyArea: 8, // × the missile's mean reload; s from the order to the first loose; σ m of a ground volley's fall
};

// ---------------------------------------------------------------- trajectory tables
const TABLES = new Map();
function table(key) {
  let T = TABLES.get(key); if (T) return T;
  const M = MISSILES[key];
  const DH = [], R = 320, dR = 2;
  for (let dh = -40; dh <= 40; dh += 5) {
    // shoot a fan of angles and record where (range), how fast and how steeply each lands at z = −dh
    const shots = [];
    for (let a = -8; a <= 50; a += 0.25) shots.push(fly(M, a * Math.PI / 180, dh));
    const rows = new Float32Array((R / dR + 1) * 4).fill(-1);
    for (let r = 0; r <= R; r += dR) {
      // lowest trajectory that reaches r
      let best = null;
      for (let k = 0; k < shots.length; k++) { const s = shots[k]; if (s && s.x >= r) { best = s; const p = shots[k - 1]; if (p && p.x < r) { const f = (r - p.x) / (s.x - p.x); best = { t: p.t + f * (s.t - p.t), v: p.v + f * (s.v - p.v), ang: p.ang + f * (s.ang - p.ang) }; } break; } }
      if (!best) break;
      const o = (r / dR) * 4; rows[o] = best.t; rows[o + 1] = best.v; rows[o + 2] = best.ang; rows[o + 3] = 1;
    }
    DH.push(rows);
  }
  T = { key, M, DH, dR, R };
  TABLES.set(key, T);
  return T;
}
function fly(M, th, dh) {
  let x = 0, z = BAL.launchH, vx = M.v0 * Math.cos(th), vz = M.v0 * Math.sin(th), t = 0; const dt = 0.01, k = M.k, zt = -dh + 1.0;
  for (let n = 0; n < 2000; n++) {
    const v = Math.hypot(vx, vz);
    vx -= k * v * vx * dt; vz -= (BAL.g + k * v * vz) * dt;
    const px = x, pz = z; x += vx * dt; z += vz * dt; t += dt;
    if (vz < 0 && z <= zt) { const f = (pz - zt) / (pz - z || 1); return { x: px + f * (x - px), t: t - dt + f * dt, v: Math.hypot(vx, vz), ang: Math.atan2(-vz, vx) }; }
  }
  return null;
}
// → { t, v, ang } or null if out of range. dh = shooter ground − target ground (m).
export function solve(key, range, dh) {
  const T = table(key); if (!Number.isFinite(dh) || !Number.isFinite(range)) return null;
  const di = clamp((dh + 40) / 5, 0, T.DH.length - 1.001), i0 = di | 0, f = di - i0;
  const r = range / T.dR, r0 = r | 0, fr = r - r0;
  const g = (rows, rr) => { const o = rr * 4; return rows[o + 3] > 0 ? [rows[o], rows[o + 1], rows[o + 2]] : null; };
  const a = g(T.DH[i0], r0), b = g(T.DH[i0], r0 + 1), c = g(T.DH[i0 + 1], r0), d = g(T.DH[i0 + 1], r0 + 1);
  if (!a || !b || !c || !d) return null;
  const L = (p, q, s) => p + (q - p) * s;
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) out[k] = L(L(a[k], b[k], fr), L(c[k], d[k], fr), f);
  return { t: out[0], v: out[1], ang: out[2], E: 0.5 * T.M.m * out[1] * out[1] };
}
export function maxRange(key, dh) {
  const T = table(key); if (!Number.isFinite(dh)) dh = 0; const di = Math.round(clamp((dh + 40) / 5, 0, T.DH.length - 1)); const rows = T.DH[di];
  let r = 0; for (let k = 0; k * 4 < rows.length; k++) if (rows[k * 4 + 3] > 0) r = k * T.dR; return r;
}
// A tail wind stretches the reach, a head wind cuts it (WEATHER.wind, derived: ±~0.7 % per m/s
// along the shot — Towton: the Yorkists shot with the wind at their backs and outranged the reply).
export function windReach(w, ux, uy) {
  if (!w.wind) return 1;
  return clamp(1 + 0.007 * (w.wind.x * ux + w.wind.y * uy), 0.86, 1.12);
}

// ---------------------------------------------------------------- firing (unit level, every tick)
export function missileUnit(w, cs, u) {
  const S = w.S, c = u.c; if (!c) return;
  const A = ARM_BY_ID[S.arm[u.members[0]]]; if (!A.missile || c.broken) return;
  const key = A.missile, M = MISSILES[key], t = w.time, rng = w.rng;
  if (u.holdFire || u.fireMode === "hold") return;
  if (u.fireMode === "volley" && u.volleyAt) return volleyUnit(w, cs, u, A, key, M);
  // target choice every 2 s: nearest visible enemy body in range, cavalry coming at us first; never
  // into a melee where our own men stand (§9 — the archers stop when the lines meet)
  if (!c.mT || t - c.mT > 2) {
    c.mT = t; c.mtgt = null;
    let best = null, bs = -1e9;
    // (castle.js: bowmen up on a wall-walk or a tower shoot from its height, over the heads of their own men at the wall foot)
    const up = w.levelH && S.lvl[u.members[0]] ? w.levelH(u.members[0]) : 0;
    for (const v of w.units.values()) {
      if (!isFoe(w, u.team, v.team) || !v.members.length || (v.c?.broken && !u.shootRouters)) continue;
      const vx = v.fx ?? v.ax, vy = v.fy ?? v.ay, d = Math.hypot(vx - u.ax, vy - u.ay);
      if (!Number.isFinite(d)) continue;
      const dh = w.map.h(u.ax, u.ay) + up - w.map.h(vx, vy);
      if (d > maxRange(key, dh) * 0.97 * windReach(w, (vx - u.ax) / (d || 1), (vy - u.ay) / (d || 1)) || d < 3) continue;
      if (!w.map.los(u.ax, u.ay, 2.2 + up, vx, vy, 1.6)) continue;
      if (!up && friendsNear(cs, u.team, vx, vy)) continue;
      const cav = ARM_BY_ID[S.arm[v.members[0]]].mounted && v.c?.phase === "charge";
      // the enemy's own bows, shooting at us, come before his foot standing out of the fight (the archery duel
      // is fought first: Towton, and every battle where both sides had bows; DESIGN +100 m of preference)
      const duel = ARM_BY_ID[S.arm[v.members[0]]].missile && !v.c?.broken ? 100 : 0;
      const s = -d + (cav ? 150 : 0) + duel + (v.c?.broken ? -80 : 0) + (up && w.castleAim ? w.castleAim(w, u.members[0], vx, vy) : 0); // (castle.js: a tower's flanking fire along the curtain's face)
      if (s > bs) { bs = s; best = v; }
    }
    c.mtgt = best;
  }
  const tgt = c.mtgt; if (!tgt || !tgt.members.length) return;
  if (t < (c.nextVolley || 0)) return; // nobody's shaft is ready yet
  const W = weather(w);
  const tx = tgt.fx ?? tgt.ax, ty = tgt.fy ?? tgt.ay, dUnit = Math.hypot(tx - u.ax, ty - u.ay);
  const burst = dUnit < BAL.burstRange && (tgt.moving || tgt.c?.phase === "charge");
  const rofMul = (W.bowstring?.rofMul ?? 1);
  let soonest = t + 30;
  for (const i of u.members) {
    if (!S.alive[i] || S.ammo[i] <= 0 || S.state[i] === S_FIGHT || S.state[i] === S_FLEE || S.state[i] === S_RALLY || S.status[i] >= ST_SHAKEN || S.posture[i]) continue;
    if (t < S.nextShot[i]) { S.power[i] = Math.max(S.power[i], PH.rest + (c.shotRate || 0) * BAL_SHOTW(M)); if (S.nextShot[i] < soonest) soonest = S.nextShot[i]; continue; }
    const wf = S.wbal[i] / S.wp[i];
    const rate = (burst && wf > 0.25 ? M.rate[1] : M.rate[0]) * rofMul * (wf < 0.15 ? 0.5 : 1);
    c.shotRate = rate;
    S.nextShot[i] = t + 60 / rate * rng.range(0.8, 1.2);
    S.power[i] = PH.rest + rate * BAL_SHOTW(M);
    // aim: a man in the target body (aimed within 80 m, area beyond)
    const tid = tgt.members[(rng.next() * tgt.members.length) | 0];
    if (!S.alive[tid]) continue;
    fire(w, cs, i, key, S.x[tid], S.y[tid], S.vx[tid], S.vy[tid], tid);
    if (S.nextShot[i] < soonest) soonest = S.nextShot[i];
  }
  c.nextVolley = Math.min(soonest, t + 2);
}
const BAL_SHOTW = (M) => M.drawW;

// ---------------------------------------------------------------- volleys (a commanded company fire)
// Fire modes of a missile company (the player's order; the AI may use them too):
//   "will"   (default) every man shoots at his own pace at the body the company is aiming at;
//   "hold"   nobody shoots;
//   "volley" the whole company looses together on the word — nock, draw, loose — at a body or a patch of
//            ground (u.volleyAt = { unit } | { x, y }), every BAL.volleyPeriod × the missile's own reload (a
//            longbow company every ~7 s, crossbows every ~20 s), the shafts spread over the target's footprint.
// setFireMode(w, u, mode, at) is the one entry point (at = { x, y } or { unit: id }).
export function setFireMode(w, u, mode, at = null) {
  if (!u || !ARM_BY_ID[w.S.arm[u.members[0]]]?.missile) return false;
  u.fireMode = mode; u.holdFire = mode === "hold";
  u.volleyAt = mode === "volley" ? at : null;
  if (u.c) u.c.nextVolley = 0;
  return true;
}
function volleyUnit(w, cs, u, A, key, M) {
  const S = w.S, c = u.c, t = w.time, rng = w.rng, V = u.volleyAt;
  const tv = V.unit !== undefined ? w.units.get(V.unit) : null;
  if (V.unit !== undefined && (!tv || !tv.members.length)) { u.fireMode = "will"; u.volleyAt = null; return; } // (target gone: back to loosing at will)
  const tx = tv ? (tv.fx ?? tv.ax) : V.x, ty = tv ? (tv.fy ?? tv.ay) : V.y;
  const W = weather(w), rofMul = W.bowstring?.rofMul ?? 1;
  const period = BAL.volleyPeriod * 60 / ((M.rate[0] + M.rate[1]) / 2) / rofMul;
  if (!c.nextVolley) c.nextVolley = t + BAL.volleyDraw; // the first: "nock! draw!"
  let ready = 0;
  for (const i of u.members) if (S.alive[i] && S.ammo[i] > 0 && S.state[i] !== S_FIGHT && S.state[i] !== S_FLEE && S.state[i] !== S_RALLY && S.status[i] < ST_SHAKEN && !S.posture[i]) { ready++; S.power[i] = Math.max(S.power[i], PH.rest + (60 / period) * BAL_SHOTW(M)); }
  if (t < c.nextVolley || !ready) return;
  // "loose!" — every man who has a shaft on the string and the target within his reach
  const dh = w.map.h(u.ax, u.ay) - w.map.h(tx, ty);
  const dV = Math.hypot(tx - u.ax, ty - u.ay) || 1;
  const reach = maxRange(key, dh) * 0.97 * windReach(w, (tx - u.ax) / dV, (ty - u.ay) / dV);
  let n = 0;
  for (const i of u.members) {
    if (!S.alive[i] || S.ammo[i] <= 0 || S.state[i] === S_FIGHT || S.state[i] === S_FLEE || S.state[i] === S_RALLY || S.status[i] >= ST_SHAKEN || S.posture[i]) continue;
    let ax, ay;
    if (tv) { const m = tv.members[(rng.next() * tv.members.length) | 0]; ax = S.x[m]; ay = S.y[m]; }
    else { ax = tx + rng.normal(0, BAL.volleyArea); ay = ty + rng.normal(0, BAL.volleyArea); }
    if (Math.hypot(ax - S.x[i], ay - S.y[i]) > reach) continue;
    if (fire(w, cs, i, key, ax, ay, 0, 0, -1)) { n++; S.nextShot[i] = t + period; }
  }
  c.nextVolley = t + period * rng.range(0.95, 1.05);
  if (n) w.events.push({ t: w.tick, kind: "volley", unit: u.id, x: tx, y: ty, n, next: c.nextVolley }); // (animation + sound: the block draws and looses together)
}

function friendsNear(cs, team, x, y) {
  const n = cs.cn, CG = cs.CG, ci = ((x - cs.ox) / CG) | 0, cj = ((y - cs.oy) / CG) | 0, a = cs.cnt[team];
  for (let j = Math.max(0, cj - 1); j <= Math.min(n - 1, cj + 1); j++) for (let q = Math.max(0, ci - 1); q <= Math.min(n - 1, ci + 1); q++) if (a[j * n + q]) return true;
  return false;
}

export function fire(w, cs, i, key, ax, ay, avx, avy, tid = -1) {
  const S = w.S, rng = w.rng, t = w.time, M = MISSILES[key], W = weather(w);
  const sx = S.x[i], sy = S.y[i];
  let R = Math.hypot(ax - sx, ay - sy);
  const dh = w.map.h(sx, sy) - w.map.h(ax, ay) + (w.levelH ? (S.lvl[i] ? w.levelH(i) : 0) - (tid >= 0 && S.lvl[tid] ? w.levelH(tid) : 0) : 0); // (castle.js: from a wall-walk, at a man on one)
  // the wind along the shot carries it (the ballistic problem is solved as if the field were shorter or longer)
  const wr = windReach(w, (ax - sx) / (R || 1), (ay - sy) / (R || 1));
  let sol = solve(key, R / wr, dh); if (!sol) return false;
  // lead a moving target by its velocity over the flight time
  ax += (avx || 0) * sol.t; ay += (avy || 0) * sol.t;
  R = Math.hypot(ax - sx, ay - sy); sol = solve(key, R / wr, dh); if (!sol) return false;
  S.ammo[i]--; cs.stats.arrows++;
  const ux = (ax - sx) / (R || 1), uy = (ay - sy) / (R || 1);
  S.facing[i] = Math.atan2(uy, ux);
  const skill = S.skill[i] * S.skillMul[i];
  const disp = (W.missileDispersionMul ?? 1) * (w.night ? 2.5 : 1);
  let eLong, eLat;
  if (R <= Math.min(BAL.aimedMax, W.aimedFireMaxM ?? 1e9) && tid >= 0) {
    const sd = (BAL.aimedSig[0] + (BAL.aimedSig[1] - BAL.aimedSig[0]) * clamp((skill - 0.2) / 0.7, 0, 1)) * Math.PI / 180 * disp;
    eLat = rng.normal(0, R * sd);
    eLong = rng.normal(0, R * sd) / Math.max(0.08, Math.tan(sol.ang)) * 0.5; // vertical error spread along the shallow path
    eLong += 0.5 * BAL.standH / Math.max(0.05, Math.tan(sol.ang)); // aimed at the chest: the shaft would land beyond the feet
  } else {
    const sk = 1.35 - 0.5 * clamp(skill, 0, 1); // DESIGN: σ 0.04·R is for experienced archers (skill ~0.7)
    eLong = rng.normal(0, BAL.sigLong * R * sk * disp); eLat = rng.normal(0, BAL.sigLat * R * sk * disp);
  }
  // wind drift (WEATHER.wind: ≈0.45 m per m/s of crosswind at 200 m, ∝ R²)
  if (w.wind) { const cross = -w.wind.x * uy + w.wind.y * ux, along = w.wind.x * ux + w.wind.y * uy; eLat += cross * 0.45 * (R / 200) ** 2; eLong += along * 0.35 * (R / 200) ** 2; }
  const lx = ax + ux * eLong - uy * eLat, ly = ay + uy * eLong + ux * eLat;
  const E = sol.E * (W.bowstring?.energyMul ?? 1) + (dh > 0 ? 0 : 0);
  cs.flights.push({ tI: t + sol.t, x: lx, y: ly, ux, uy, ang: sol.ang, E, mode: M.mode, by: i, team: S.team[i], R, key, x0: sx, y0: sy, t0: t }); // (x0, y0, t0: launch point and time, for the renderer's arc)
  return true;
}

// ---------------------------------------------------------------- impact (every tick)
const nb = [];
export function flightTick(w, cs) {
  const F = cs.flights; if (!F.length) return;
  const t = w.time; let j = 0;
  for (let k = 0; k < F.length; k++) { const f = F[k]; if (f.tI <= t) land(w, cs, f); else F[j++] = f; }
  F.length = j;
}

function land(w, cs, f) {
  const S = w.S, rng = w.rng, ctx = cs.ctx;
  if (w.siege) w.siege.arrow(w, f); // a shaft coming down on an enemy engine may be a fire arrow (siege.js)
  const tanA = Math.max(0.03, Math.tan(f.ang));
  const Lsh = Math.min(30, BAL.standH / tanA), LshH = Math.min(40, BAL.horseH / tanA);
  // search the strip the falling shaft sweeps through the last 1.7 m (2.6 m for riders) of its fall
  const L = Math.max(Lsh, LshH);
  const mx = f.x - f.ux * L / 2, my = f.y - f.uy * L / 2;
  neighbours(w, mx, my, L / 2 + 1, nb);
  let hit = -1, best = 1e9;
  for (const o of nb) {
    if (S.state[o] === S_CAPT) continue;
    const mounted = S.horseOK[o] === 1;
    const dx = S.x[o] - f.x, dy = S.y[o] - f.y;
    const along = -(dx * f.ux + dy * f.uy);            // metres back up the flight path from the landing point
    const lat = Math.abs(-dx * f.uy + dy * f.ux);
    const r = mounted ? BAL.horseR : BAL.footR;
    const len = (mounted ? LshH : (S.posture[o] ? 0.3 / tanA : Lsh));
    if (lat > r || along < -r || along > len + r) continue;
    if (along > best) continue; // earlier along the path = struck first
    best = along; hit = o;
  }
  // stress on the men it lands among (§11.2): +0.006 per arrow "within 3 m", ×2 if friends are falling.
  // DESIGN: counted within BAL.stressR = 1.8 m — in a close-packed block every arrow is within 3 m of ~30
  // men, and the literal 3 m broke formed foot in under a minute of fire (Agincourt's French, Hastings'
  // shield wall and Falkirk's schiltrons stood hours of it)
  // Horsemen keep the literal 3 m: a horse feels every shaft that drops round it and its rider feels the horse.
  neighbours(w, f.x, f.y, 3, nb);
  const aid = cs.arrowSeq = (cs.arrowSeq || 0) + 1;
  if (!cs.recentShot || cs.recentShot.length < S.cap) { const a = new Float32Array(S.cap); if (cs.recentShot) a.set(cs.recentShot); cs.recentShot = a; }
  for (const o of nb) {
    if (S.team[o] === f.team || !S.alive[o] || S.status[o] === ST_FLEE) continue;
    if (S.horseOK[o] !== 1) { const dx = S.x[o] - f.x, dy = S.y[o] - f.y; if (dx * dx + dy * dy > BAL.stressR * BAL.stressR) continue; }
    const u = w.units.get(S.unit[o]);
    const falling = u?.c && u.c.lastCasT && w.time - u.c.lastCasT < 30 ? 2 : 1;
    const reply = u && ARM_BY_ID[S.arm[o]].missile && S.ammo[o] > 0 ? 0.5 : 1; // being shot at without being able to reply is the worst
    // (DESIGN, the battle-feel brief: arrows disorder and thin formed men-at-arms, they do not rout them — a man
    // in mail and plate hears most shafts glance off him and his neighbours; and a body going forward to close
    // with the enemy has its eyes on him, not on the sky: × (1 − BAL.armourCalm × armour class, ≥ 0.25), × BAL.advanceCalm)
    const calm = Math.max(0.25, 1 - BAL.armourCalm * S.armour[o]) * (u && u.moving && (u.order.kind === "assault" || u.order.kind === "charge" || u.c?.phase === "charge" || (u.order.kind === "move" && u.enemyNear)) ? BAL.advanceCalm : 1);
    S.stress[o] += MOR.missileNear * falling * reply * calm * (1.3 - S.courage[o]);
    if (cs.dbg) { const D = cs.dbg[S.team[o]] || (cs.dbg[S.team[o]] = {}); D.missile = (D.missile || 0) + MOR.missileNear * falling * reply * calm * (1.3 - S.courage[o]); }
    cs.recentShot[o] = w.time;
    // (Dupplin Moor, the battle-feel brief §1.2: shafts coming in from a flank make the men on that side edge
    // away toward the middle — the body narrows; counted once per arrow per company, see combat.unitUpdate)
    if (u?.c && u.formation !== "loose" && !u.c.broken && u.c.flankShotK !== aid) { u.c.flankShotK = aid; const lat = Math.abs(f.ux * Math.cos(u.facing) + f.uy * Math.sin(u.facing)); if (lat > 0.6) u.c.flankFire = (u.c.flankFire || 0) + lat; }
  }
  const ev = (on, z) => w.events.push({ t: w.tick, kind: "arrow", x: hit >= 0 ? S.x[hit] : f.x, y: hit >= 0 ? S.y[hit] : f.y, ux: f.ux, uy: f.uy, ang: f.ang, key: f.key, hit, on, z, shooter: f.by }); // (animation + sound: docs/anim-sim-signals.md §2)
  if (hit < 0) { spent(cs, f.x, f.y); ev("ground"); return; }
  cs.stats.arrowHits++;
  // cover the man stands in (hedge, wall, pavise, shield)
  const cov = coverAt(w, S.x[hit], S.y[hit]);
  if (rng.next() < cov.hard || rng.next() < cov.soft * 0.5) { spent(cs, f.x, f.y); ev("cover"); return; }
  if (w.siege && rng.next() < w.siege.cover(w, hit, f)) { spent(cs, f.x, f.y); ev("cover"); return; } // a mantlet before him, a ram's roof over him
  if (w.castleCover && S.lvl[hit] && rng.next() < w.castleCover(w, hit, f)) { spent(cs, f.x, f.y); ev("cover"); return; } // merlons, arrow loops (castle.js coverFor)
  if (w.features.length && !(S.lvl[hit] && w.twM?.on[hit])) { // (a man up on a town's walk: his cover is the stakes or the merlons in front of him — townwall.js, through castleCover — not the wall he stands on)
    const fe = featureCrossed(w, S.x[hit] - f.ux * 3, S.y[hit] - f.uy * 3, S.x[hit], S.y[hit], (q) => featureDef(q).cover);
    if (fe && rng.next() < (featureDef(fe).cover.hard || 0) * (f.ang < 0.35 ? 1 : 0.3)) { ev("cover"); return; }
  }
  // facing the arrow?
  const toward = Math.cos(S.facing[hit] - Math.atan2(-f.uy, -f.ux)) > 0.5;
  if (S.pavise[hit] && !S.lvl[hit] && !(w.levelH && w.levelH(hit) > 0.5) && S.state[hit] !== S_FLEE && toward && !S.horse[hit] && S.status[hit] <= ST_WAVER && S.ammo[hit] >= 0 && Math.hypot(S.vx[hit], S.vy[hit]) < 0.3) {
    if (rng.next() < 0.9) { ev("pavise"); return; } // pavise, hard cover 0.9 frontal (§9.4) — planted in the ground: not up on a wall or a stair, where the crenels are his cover (castle.js coverFor)
  }
  if (S.shieldArm[hit] && S.shield[hit] && toward && f.ang < 0.7 && rng.next() < SHIELDS[S.shield[hit]].area / BAL.shieldSil) { ev("shield"); return; }
  // location, then armour
  const mounted = S.horseOK[hit] === 1;
  let z;
  // (a man in harness walking into the shafts goes head down, visor and brim to the storm — Agincourt: the French
  // bowed their heads so the arrows should not pierce their visors — as under plunging fire)
  const hu = w.units.get(S.unit[hit]), bowed = toward && S.armour[hit] >= 3 && !!hu?.moving;
  if (mounted) z = rng.next() < M_BODY[S.horse[hit]] ? Z_HORSE : pickZone(rng, S, hit, { plunging: f.ang > 0.35, E: 0, aim: 0 }); // (a strider is a small mark and never barded — more shafts find its rider; a drake is a big one)
  else z = pickZone(rng, S, hit, { plunging: f.ang > 0.35 || bowed, down: S.posture[hit] !== 0, E: 0, aim: 0, rear: !toward });
  const Es = incidence(rng, f.E, f.mode, WC.thetaSdMissile, z);
  cs.stats.mStruck = (cs.stats.mStruck || 0) + 1;
  if (Es <= 0) { ev("armour", z); return; }
  const eRes = penetrate(rng, S, hit, z, f.mode, Es);
  const sev = woundSeverity(rng, z, f.mode, eRes);
  const was = S.alive[hit], hadHorse = S.horseOK[hit];
  ev(z === Z_HORSE ? "horse" : sev <= 1 ? "armour" : "body", z); // (sev ≤ bruise: it stuck in the padding or glanced off)
  applyWound(ctx, hit, f.by, sev, z, "missile");
  if (was && !S.alive[hit]) { cs.stats.mIncap = (cs.stats.mIncap || 0) + 1; if (f.by >= 0 && f.R > S.longShot[f.by]) S.longShot[f.by] = f.R; }
  if (hadHorse === 1 && S.horseOK[hit] !== 1) cs.stats.mHorse = (cs.stats.mHorse || 0) + 1;
}

function spent(cs, x, y) {
  if (!cs.spent) cs.spent = new Map();
  const k = (((x / 20) | 0) << 12) ^ ((y / 20) | 0); cs.spent.set(k, (cs.spent.get(k) || 0) + 1);
}
// §9.4: archers not in contact pick up the shafts lying around them (30–50 % recoverable)
export function recoverArrows(w, cs, i) {
  const S = w.S; if (!cs.spent || !S.missile[i]) return;
  const k = (((S.x[i] / 20) | 0) << 12) ^ ((S.y[i] / 20) | 0), n = cs.spent.get(k) || 0;
  if (n > 0 && w.rng.next() < BAL.pickup) { S.ammo[i]++; if (n > 1) cs.spent.set(k, n - 1); else cs.spent.delete(k); }
}

export function missileTick(w, cs) { /* firing is done per unit in missileUnit; impacts in flightTick */ }
