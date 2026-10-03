// Per-exchange melee resolution (docs/combat-research.md §7) and wound application (§4.3).
// One function resolves every blow in the game — line fights, flank attacks, pursuit, grappling,
// coups de grâce, lance impacts — and the calibration harness's duel fast-path calls the SAME code.
//
// ctx = { S, rng, time, events, footAt(x,y)->{slip,fall}, onFell?(d,a,sev,cause) }
import { WEAPON_BY_ID, WEAPON_ID, SHIELDS, M_CUT, M_THRUST, M_BLUNT, Z_TORSO, Z_ARMS, Z_HANDS, Z_THIGHS, Z_SHINS, Z_HORSE, Z_HEAD, Z_FACE, Z_NECK } from "./kit.js";
import { M_FRT } from "./mounts.js";
import { pickZone, penetrate, woundSeverity, bleedFor, incidence } from "./wounds.js";
import { blowFatigueMul, parryFatigueMul } from "./physio.js";
import { W_NONE, W_BRUISE, W_LIGHT, W_DISABLE, W_INCAP, W_MORTAL, W_INSTANT, S_DOWN, S_DEAD, S_FLEE, ST_FLEE, clamp } from "./soldiers.js";

export const MC = {
  parry0: 0.25, parrySkB: 0.45, parrySkA: 0.25,          // §7.2
  flank: -0.2, rear: -0.45,                                 // DESIGN: guard is only good to the front
  multi: -0.04,                                             // per extra simultaneous attacker (divided attention)
  slip: -0.3, firstStrike: 0.15, insideShort: 0.15,         // §7.2, §3
  block0: 0.35, blockSk: 0.4,                               // §2 shield
  blowQ: [0.75, 1.15],                                      // DESIGN: spread of blow quality
  // DESIGN: commitment. "About ¾ of front-rankers fought more with the aim of staying alive" [SABIN]:
  // a cautious man's blows are mostly probing, safe, off-balance; only fighters commit their weight.
  // Each blow is either committed (full weight, 0.7–1.1 of E) or probing (0.1–0.4): P(committed) by class.
  commitP: [0.45, 0.08, 0.03], commitE: [0.7, 1.1], probeE: [0.1, 0.4],
  stance: [0, 0.12, 0.25],
  zoneParry: [0.05, 0.3, 0.25, 0, 0, 0.1, -0.05, -0.1, 0],   // by zone: head face neck torso arms hands thighs shins horse                              // defensive bias on parry by aggression class (passive men only parry)
  grappleP: 0.05, grappleFront: 0.03,                                            // P a close attacker on a flank/in a crowd grapples instead of striking
  grapple0: 0.08, grappleStr: 0.3, grappleMulti: 0.07, grappleRear: 0.12, grappleSk: 0.12, closeR: 1.2,
  pinT: 3, pinFree: 0.2, pinnedP: 0.3, pinnedT: [30, 150], miseriE: 2.5, miseriGap: 4.5,                                   // DESIGN: s a blow keeps a downed man pinned; P/blow he heaves free ×(0.5+str)/(helpers)
  grappleChoose: 5.0, grappleGap: 0.2, grapplePile: 0.0,     // DESIGN: × choice, + P per armour class of difference, + P per class per helper
  upTime: [2, 5],                                           // s to regain one's feet (+load)
  stressBruise: 0.02, stressLight: 0.05, stressDisable: 0.2, // §4.3, §11.2
  downedGap: 4,                                             // daggers find the gaps on a man who is down
  lanceArmE: 100,                                          // DESIGN: J — a lance thrust by the arm in the mêlée, without the horse's momentum behind it (a heavy spear); 400 J is the couched charge (§10.2)
  horseBalk: 0.9, horseBolt: 2.1,                        // DESIGN: horse fright (≈ 1 per light wound) at which it balks / bolts
  rideDown: 0.5,                                           // P a horseman's blow on a back-turned fugitive knocks him down
};

const PI3 = Math.PI / 3, PI23 = 2 * Math.PI / 3;
const DAGGER = WEAPON_ID.dagger;

// Choose the damage mode an attacker uses: the one that best beats the defender's torso armour,
// with poor fighters choosing at random (DESIGN).
function chooseMode(rng, Wp, skill) {
  const m = Wp.modes; if (m.length === 1) return m[0];
  if (rng.next() > skill) return m[(rng.next() * m.length) | 0];
  let best = m[0], bv = -1e9;
  for (const k of m) { const v = Wp.Eb[k] * (k === M_THRUST ? 1.15 : k === M_BLUNT ? 1.05 : 1); if (v > bv) { bv = v; best = k; } }
  return best;
}

// Geometry of a blow: g = { off (rad, bearing of attacker from defender's facing, 0 = straight ahead),
//   nAtk (enemies currently on the defender), dist, dh (attacker height − defender height, m),
//   grade (%, attacker's slope toward defender), flurryAge (s since this flurry began),
//   footD, footA ({slip, fall}), defBonus (feature skill bonus for defender), noParry }
// Returns the outcome: -1 grapple failed, 0 parried/missed, 1 blocked, 2 glance/bruise, 3.. = W_ severity + 1
export function resolveBlow(ctx, a, d, g) {
  const S = ctx.S, rng = ctx.rng, t = ctx.time;
  const downD = S.posture[d] === 1 || S.stunT[d] > t;
  const fleeD = S.status[d] === ST_FLEE;
  const mountedA = S.horseOK[a] === 1, mountedD = S.horseOK[d] === 1;
  const offAbs = Math.abs(g.off);
  // ---- weapon
  let wid = S.weapon[a];
  const close = g.dist < MC.closeR;
  if ((downD && close && !mountedA) || (WEAPON_BY_ID[wid].reach > 2.5 && g.dist < 1.2 && !mountedA)) wid = downD ? DAGGER : S.side[a]; // coup de grâce / pike in the press
  const Wp = WEAPON_BY_ID[wid];
  // a man down with two or more on him is held down (DESIGN, Towton/Agincourt): each of their blows keeps him
  // pinned a little longer unless he heaves free (strength against their numbers)
  if (downD && !mountedA && g.nAtk >= 2 && close && S.posture[d] === 1 && rng.next() > MC.pinFree * (0.5 + S.strength[d]) / (g.nAtk - 1))
    S.upT[d] = Math.max(S.upT[d], t + MC.pinT);
  // ---- grapple (pulled down by the legs, §17.3): only on foot, close, from a flank or with friends helping
  // DESIGN (Agincourt, Towton): a man whose blows cannot hurt the one before him — cloth against plate —
  // goes for his legs instead, and several together pull him down. The armour gap (classes 0–5) makes the
  // grab likelier and every helper's weight counts; between equals grapples stay the rare thing they were.
  const armGap = Math.max(0, S.armour[d] - S.armour[a] - 2); // (only a real mismatch: cloth against plate, not gambeson against mail)
  if (!g.E && !mountedA && !mountedD && !downD && (close || g.nAtk >= 3) && rng.next() < (offAbs > PI3 || g.nAtk >= 2 ? MC.grappleP : MC.grappleFront) * ((g.ag ?? S.aggr[a]) === 0 ? 1.3 : 1) * (1 + MC.grappleChoose * armGap)) {
    const p = clamp(MC.grapple0 + MC.grappleStr * (S.strength[a] - S.strength[d]) + MC.grappleMulti * (g.nAtk - 1) + MC.grappleGap * armGap + MC.grapplePile * armGap * (g.nAtk - 1)
      + (offAbs > PI23 ? MC.grappleRear : 0) - MC.grappleSk * S.skill[d] * S.skillMul[d] + (g.footD ? g.footD.slip * 3 : 0), 0.01, 0.6);
    if (rng.next() < p) { knockDown(ctx, d, 1, a, "grapple"); return 0; }
    return -1;
  }
  // ---- defence roll (§7.2)
  const hA = heightSkill(g), skA = S.skill[a] * S.skillMul[a] + hA, skB = S.skill[d] * S.skillMul[d] - hA + (g.defBonus || 0);
  let parry;
  if (downD || fleeD || g.noParry) parry = g.parry ?? 0.05;
  else {
    parry = MC.parry0 + MC.parrySkB * skB - MC.parrySkA * skA + MC.stance[S.aggr[d]];
    if (offAbs > PI23) parry += MC.rear; else if (offAbs > PI3) parry += MC.flank;
    if (g.nAtk > 1) parry += MC.multi * (g.nAtk - 1);
    if (S.slipT[d] > t) parry += MC.slip;
    if (Wp.long && g.flurryAge < 2 && WEAPON_BY_ID[S.weapon[d]].reach < Wp.reach - 0.5) parry -= MC.firstStrike;
    if (close && Wp.reach < 1 && WEAPON_BY_ID[S.weapon[d]].reach > 2) parry -= MC.insideShort;
    if (mountedD && !mountedA) parry += 0.05; else if (mountedA && !mountedD) parry -= 0.05;
    parry *= parryFatigueMul(S.wbal[d] / S.wp[d]);
    parry = clamp(parry, 0.05, 0.9);
  }
  // footing (§7.2): both men roll their ground
  if (g.footD && !downD) {
    const u = rng.next();
    if (u < g.footD.fall) { knockDown(ctx, d, 1, -1, "slip"); }
    else if (u < g.footD.slip) { S.slipT[d] = t + 2; parry = Math.max(0.05, parry + MC.slip); }
  }
  if (g.footA && rng.next() < g.footA.slip) { S.slipT[a] = t + 2; if (rng.next() < g.footA.fall / g.footA.slip) { knockDown(ctx, a, 1, -1, "slip"); return 0; } }
  // ---- energy (§3)
  const mode = g.mode ?? chooseMode(rng, Wp, S.skill[a]);
  let E;
  if (g.E) E = g.E; // lance impact / braced spear: energy set by the charge physics (§10.2)
  else {
    const cm = fleeD || downD || rng.next() < MC.commitP[g.ag ?? S.aggr[a]] ? MC.commitE : MC.probeE; // a back-turned or fallen man gets the full blow (§12)
    E = (Wp.couched ? MC.lanceArmE : Wp.Eb[mode]) * (0.6 + 0.6 * S.strength[a]) * blowFatigueMul(S.wbal[a] / S.wp[a]) * rng.range(cm[0], cm[1]);
  }
  if (mountedA && !mountedD) E *= 1.1;
  // DESIGN: a thrust or cut at the very end of one's reach (the lunge, or a second-rank spear over a
  // friend's shoulder) carries less of the body's weight: ×1 up to 80 % of reach, ×0.5 at reach + 0.5 m
  if (!g.E && g.dist > 0.8 * Wp.reach) E *= clamp(1 - 0.5 * (g.dist - 0.8 * Wp.reach) / (0.2 * Wp.reach + 0.5), 0.5, 1);
  if (g.dh) E *= clamp(1 + g.dh * 0.02, 0.85, 1.15);
  // ---- location (§2)
  const shieldOK = S.shieldArm[d] === 1 && S.shield[d] > 0 && S.shield[d] < 5 && !downD && !fleeD;
  const shieldFront = shieldOK && offAbs < Math.PI / 2 && g.off <= 0.35; // guarded (left-front) side
  // the misericorde (DESIGN): a man held down by two or more gets the dagger two-handed, with the kneeling
  // man's weight behind it, into the face or throat — visor forced up, aventail dragged aside
  const pinned = downD && close && wid === DAGGER && !mountedA && S.posture[d] === 1; // (one man alone can try it too; holding him down takes two)
  if (pinned) E *= MC.miseriE;
  const z = g.zone ?? (pinned ? (rng.next() < 0.6 ? Z_FACE : Z_NECK) : undefined) ?? pickZone(rng, S, d, { shieldFront, guardDown: !downD && !fleeD && S.wbal[d] < 0.1 * S.wp[d], down: downD, mountedTarget: mountedD, attackerMounted: mountedA, rear: offAbs > PI23 || fleeD, aim: downD ? 1 : S.skill[a] * 0.8, E, mode });
  if (z === Z_HORSE && !mountedD) return 0;
  // defence roll, zone-aware (DESIGN): a man guards his face and neck first and his legs last (Visby, Towton)
  if (rng.next() < clamp(parry + (parry > 0.05 ? MC.zoneParry[z] : 0), 0.03, 0.95)) return 0;
  // ---- a horseman riding down a running man knocks him flat (DESIGN, §12: P(incap) 0.35–0.6 per attack is
  // reached through this: the man goes down under the horse or the blow and is finished on the ground)
  if (mountedA && fleeD && !downD && rng.next() < MC.rideDown) knockDown(ctx, d, 1, a, "horse");
  // ---- shield block
  if (shieldFront && (z === Z_TORSO || z === Z_ARMS || z === Z_THIGHS)) {
    const Sh = SHIELDS[S.shield[d]];
    const pb = (MC.block0 + MC.blockSk * skB) * Sh.blockMul - (Wp.hook || 0);
    if (rng.next() < pb) return 1;
  }
  // ---- armour (§4)
  const Es = incidence(rng, E, mode, undefined, z);
  if (Es <= 0) return 2;
  const eRes = penetrate(rng, S, d, z, mode, Es, pinned ? MC.miseriGap : downD && Wp.focus ? MC.downedGap : Wp.focus ? 1.5 : 1);
  const sev = woundSeverity(rng, z, mode, eRes);
  applyWound(ctx, d, a, sev, z, "melee", Es);
  return sev + 1;
}

// Height advantage in skill units (ELEVATION.melee: +0.05 per 10 % grade, capped 30 %).
function heightSkill(g) {
  if (!g.grade) return 0;
  return clamp(g.grade, -30, 30) / 10 * 0.05;
}

export function knockDown(ctx, id, kind, by = -1, cause = "blow") {
  const S = ctx.S; if (S.horseOK[id] === 1) return; // a rider is unhorsed only through his horse
  // (animation signal, docs/anim-sim-signals.md §3: he goes over away from what hit him)
  if (ctx.events && S.posture[id] === 0) { let dx = 0, dy = 0; if (by >= 0) { dx = S.x[id] - S.x[by]; dy = S.y[id] - S.y[by]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; } ctx.events.push({ t: ctx.tick, kind: "knock", who: id, by, dx, dy, cause }); }
  S.posture[id] = 1;
  S.upT[id] = Math.max(S.upT[id], ctx.time + ctx.rng.range(MC.upTime[0], MC.upTime[1]) + (S.load[id] + S.limb[id]) / 15 + (ctx.crowdAt ? ctx.crowdAt(id) : 0));
}

// Apply a wound of severity sev to d, inflicted by a (−1 = nobody). zone matters for limbs/horse.
export function applyWound(ctx, d, a, sev, z, cause, E = 80) {
  const S = ctx.S, rng = ctx.rng;
  if (sev <= W_NONE) return;
  ctx.onWound?.(d, a, sev, z, cause);
  const gain = 1.3 - S.courage[d];
  if (z === Z_HORSE) return horseWound(ctx, d, a, sev);
  // §4.3 bruise: stress +0.02, W′ −1 kJ — for a full blow; a probing tap on the mail costs in proportion (DESIGN)
  if (sev === W_BRUISE) { const k = clamp(E / 80, 0.1, 1); S.stress[d] += MC.stressBruise * gain * k; S.wbal[d] = Math.max(0, S.wbal[d] - 1000 * k); return; }
  const [b, clot] = bleedFor(rng, sev);
  S.bleed[d] += b; S.clotT[d] = Math.max(S.clotT[d], clot);
  if (sev > S.sev[d]) S.sev[d] = sev;
  if (sev === W_LIGHT) {
    S.skillMul[d] *= 0.9; S.stress[d] += MC.stressLight * gain; S.wounds[d] = Math.min(1, S.wounds[d] + 0.1); S.woundsSurv[d]++;
    return;
  }
  if (sev === W_DISABLE) {
    S.wounds[d] = Math.min(1, S.wounds[d] + 0.35); S.stress[d] += MC.stressDisable * gain; S.woundsSurv[d]++;
    if (z === Z_ARMS || z === Z_HANDS) {
      if (S.shieldArm[d] === 1 && S.shield[d] && rng.next() < 0.5) { S.shieldArm[d] = 0; S.disabled[d] |= 2; } // drops the shield
      else { S.skillMul[d] *= 0.5; S.disabled[d] |= 1; }
      return;
    }
    if (z === Z_THIGHS || z === Z_SHINS) { S.disabled[d] |= 4; return fell(ctx, d, a, sev, cause); } // leg ⇒ down
    // torso/head disabling: he is badly hurt but on his feet
    S.skillMul[d] *= 0.6;
    return;
  }
  // incapacitating, mortal, instant
  fell(ctx, d, a, sev, cause);
}

function horseWound(ctx, d, a, sev) {
  const S = ctx.S, rng = ctx.rng;
  if (S.horseOK[d] !== 1) return;
  S.stress[d] += 0.03 * (1.3 - S.courage[d]);
  let falls = false;
  if (sev >= W_INCAP) falls = true;
  else if (sev === W_DISABLE) falls = rng.next() < 0.5;          // §10.2: torso wound P(fall) 0.5
  else if (sev === W_LIGHT) {
    // (battle-feel #4, Poitiers / Agincourt: a horse's fright escalates — it flinches at the first shaft, balks at
    // the next, and bolts at the third, back the way it came, through whatever is behind it)
    S.hfright[d] += rng.range(0.6, 1.4) * M_FRT[S.horse[d]]; // (×1 on a horse; a strider is flighty, a drake barely minds)
    let dx = 0, dy = 0; if (a >= 0) { dx = S.x[d] - S.x[a]; dy = S.y[d] - S.y[a]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; }
    // (a horse in a charge that has not yet struck home never bolts — owner: cavalry must not turn and run before
    // contact; it may still check at a shaft, a second or two, and come on: cavalry.rideCharge picks it up again)
    if (S.hfright[d] >= MC.horseBolt && !ctx.committed?.has(d)) {
      S.busyT[d] = ctx.time + rng.range(8, 25); S.horseOK[d] = 2; S.hfright[d] = 0;
      if (!dx && !dy) { const h = S.facing[d] + Math.PI; dx = Math.cos(h); dy = Math.sin(h); }
      S.fdx[d] = dx; S.fdy[d] = dy; // (it bolts away from what hurt it)
      ctx.events.push({ t: ctx.tick, kind: "horse", who: d, what: "bolt", by: a, dx, dy });
      return;
    }
    if (S.hfright[d] >= MC.horseBalk) {
      S.busyT[d] = Math.max(S.busyT[d], ctx.time + rng.range(2, 4)); S.vx[d] *= 0.1; S.vy[d] *= 0.1;
      ctx.events.push({ t: ctx.tick, kind: "horse", who: d, what: "balk", by: a, dx, dy });
      return;
    }
  }
  if (!falls) { // (it flinches: head-toss, sidestep — animation signal)
    let dx = 0, dy = 0; if (a >= 0) { dx = S.x[d] - S.x[a]; dy = S.y[d] - S.y[a]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; }
    ctx.events.push({ t: ctx.tick, kind: "horse", who: d, what: "flinch", by: a, dx, dy });
  }
  if (!falls) return;
  S.horseOK[d] = 0;
  ctx.events.push({ t: ctx.tick, kind: "horse", who: d, what: "down", by: a });
  // rider falls: down and stunned 2–10 s, sometimes hurt (§10.2)
  S.posture[d] = 1; S.stunT[d] = ctx.time + rng.range(2, 10); S.upT[d] = S.stunT[d] + 2;
  // a horse brought down at speed often falls on its rider: trapped under it until he is dragged out, or
  // killed where he lies (Crécy's and Agincourt's heaps — DESIGN, MC.pinnedP)
  if (Math.hypot(S.vx[d], S.vy[d]) > 4 && rng.next() < MC.pinnedP) S.upT[d] = ctx.time + rng.range(MC.pinnedT[0], MC.pinnedT[1]);
  const u = rng.next();
  if (u < 0.08) applyWound(ctx, d, -1, W_DISABLE, Z_THIGHS, "fall");
  else if (u < 0.3) applyWound(ctx, d, -1, W_LIGHT, Z_ARMS, "fall");
  ctx.onUnhorse?.(d);
}

// d goes down (incapacitated or worse) or dies outright.
export function fell(ctx, d, a, sev, cause) {
  const S = ctx.S;
  if (!S.alive[d]) return;
  const dead = sev >= W_INSTANT;
  const wasFleeing = S.status[d] === ST_FLEE;
  S.alive[d] = 0; S.state[d] = dead ? S_DEAD : S_DOWN; S.downT[d] = ctx.time; S.posture[d] = 2;
  if (sev > S.sev[d]) S.sev[d] = sev;
  if (a >= 0) { if (wasFleeing) S.rkills[a]++; else { S.kills[a]++; S.xp[a] += 1; if (cause === "melee") S.mkills[a]++; } }
  ctx.events.push({ t: ctx.tick, kind: dead ? "kill" : "down", victim: d, by: a, fleeing: wasFleeing, cause, sev });
  ctx.onFell?.(d, a, sev, cause);
}
