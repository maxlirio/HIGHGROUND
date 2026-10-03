// Cavalry (docs/combat-research.md §10): the charge schedule, the refusal rule, impact physics,
// recoil-and-reform for repeated charges (Crécy's 15–16), and cavalry-vs-cavalry decided before contact.
import { isFoe } from "./sides.js";
import { S_FIGHT, S_FLEE, S_IDLE, S_MOVE, S_CAPT, ST_FLEE, ST_RALLY, ST_FORMED, ST_WAVER, W_INSTANT, W_INCAP, W_DISABLE, clamp } from "./soldiers.js";
import { ARM_BY_ID, FORMATIONS } from "./arms.js";
import { WEAPON_BY_ID, M_THRUST, M_BLUNT, Z_HORSE, Z_TORSO, Z_THIGHS } from "./kit.js";
import { neighbours, DT, applyOrder, goingMul, setDisorder } from "./world.js";
import { resolveBlow, knockDown, applyWound } from "./melee.js";
import { woundSeverity, penetrate } from "./wounds.js";
import { MOR } from "./morale.js";
import { horseStep } from "./physio.js";
import { runSpeed } from "./combat.js";
import { chargeViable, featureCrossed, featureDef, ELEVATION, bodiesAt } from "./ground.js";
import { MOUNTS, M_ACC, M_SHK, M_REF, M_HDG, M_SPR, M_DRD, M_SOFT, mountWeatherMul } from "./mounts.js"; // learned mounts: every horse value is exactly neutral (x*1 === x)

export const CAV = {
  gallopFrom: 220,          // m: walk → trot → gallop only for the last ~200 m [CAVCHARGE/Verbruggen]
  recoilDist: 300, restW: 0.55, restHorse: 0.5, maxCharges: 16, // recoil out of bowshot to re-form
  meleeHold: [25, 50],
  meleeSteady: [8, 15],     // DESIGN: s a conroi stopped by a line that stands fights before it recoils to re-form      // s a charge that stuck fights before the conroi recoils if it has not broken them
  lance: [200, 600],        // J delivered by a couched lance, capped by the shaft breaking
  refuseStop: [3, 10],      // m short of the line where a refusing horse pulls up
  millT: [6, 15],           // s milling in front of the line
  vsCavLoseStress: 0.35,
  rideS: [2.5, 5], rideTrample: 0.55, trampleWound: 0.3, burstStress: 0.12, // DESIGN: riding through a body that cannot stop them
  throughDist: 90,          // m beyond the body ridden through where the conroi re-forms
  swerveR: 9, swerve: 2.5,  // m a charging rider looks ahead for a man to ride at; m/s he can bear sideways onto him
  ditchHurt: [0.15, 0.2],   // DESIGN: P incapacitated, P a broken leg, for a rider whose horse falls in an obstacle at speed
  pressedIn: 0.3,           // DESIGN: P a rider close behind, still at the gallop, drives a refusing horse into the obstacle
  // ---- the charge as momentum (each rider drives himself: horse + man + harness ≈ 650–750 kg at 7–9 m/s)
  accel: 2.2,               // m/s² a destrier gathers speed (0 → gallop in ~4 s)
  canterTo: 90,             // m: beyond this from the enemy the conroi canters (6 m/s), keeping its line; the gallop is the last stretch
  canter: 6,
  turn: [1.1, 0.45],        // rad/s a rider can bend his line at a canter / at the gallop
  stuckV: 2.2,              // m/s: slower than this a horse is stopped in the press and its rider fights from the saddle
  bleed: 1.5,               // DESIGN: × m/M of the speed a horse loses on each man it strikes (he is not a feather; it scrambles)
  hedge: 0.25,              // share of its speed a horse keeps when it runs onto a braced point
  throwV: [0.45, 0.8],      // × horse speed a man struck is flung at (glancing blows: aside, not straight ahead)
  chainP: 0.3,              // P a man is knocked over by a man thrown into him
  dodge: { missile: 0.55, loose: 0.5, levy: 0.35, close: 0.12, look: 12 }, // P per look a man in a horse's line throws himself aside
  trampleP: 0.5,            // DESIGN: P a galloping horse's hooves land on a man lying in its path
  absorbMax: 0.85, absorbV: 0.4, // DESIGN: a deep steady line holds the man struck (P ≤ absorbMax) and the horse keeps absorbV of its speed
  balkSlow: 0.6,            // DESIGN: × the speed a horse can reach again after each balk at a shaft (it comes on, but hurt and ragged)
  spearCheck: 0.6,          // DESIGN: share of its speed a horse keeps after running onto a braced spear (not a pike hedge)
  hedgeStab: 0.3,           // DESIGN: P a horse refusing a pike hedge is struck by a point as it turns away
  strikeFear: 0.012,        // DESIGN: stress to each man within 5 m of a man ridden down (× nerve, × indiscipline)
  outBeyond: 25,            // m a rider carries on past the last man before he is "through"
  rallyBeyond: 70,          // m beyond the body where a conroi that went through wheels and re-forms
};

function steadiness(w, v, e) {
  const S = w.S, c = v.c; if (!c) return 0.5;
  let st = (1 - clamp(c.stressM, 0, 1)) * (0.5 + 0.5 * (c.disc ?? 0.5)); // (a levy stands less firm in a horse's eye than a drilled block)
  if (c.broken) st *= 0.1;
  if (v.moving) st *= v.pace === "march" ? 0.85 : 0.6; // caught on the move: a walking block can halt and brace, a running one cannot
  if (v.state === "wavering") st *= 0.8;
  if (S.status[e] === ST_FLEE) st = 0.05;
  return st;
}

// solidity of the infantry at the point of impact (§10.2)
export function refusalP(w, cs, rider, e, v, localDens, viable) {
  const S = w.S;
  const A = ARM_BY_ID[S.arm[e]];
  const steady = steadiness(w, v, e);
  const ranks = v.c ? Math.max(1, v.c.ranks || 1) : 1;
  const pts = Math.min(3, A.pointsRanks || 0) / 3;
  // struck in the flank or rear, a formation cannot present its points
  const bearing = Math.atan2(S.y[rider] - S.y[e], S.x[rider] - S.x[e]);
  const fwd = v.facing + Math.PI / 2; let off = Math.abs(Math.atan2(Math.sin(bearing - fwd), Math.cos(bearing - fwd)));
  const faced = v.formation === "schiltron" ? 1 : off < Math.PI / 3 ? 1 : off < 2 * Math.PI / 3 ? 0.55 : 0.3;
  // what the horse sees: a hedge of points it would have to run onto (pikes), a line of spears, or men with swords
  // and shields — a horse will run at a man; it will not run onto a point it can see (the refusal rule's real object)
  // (and a close wall of steady men in harness — Crécy's and Poitiers' dismounted men-at-arms — is as bad in a horse's
  // eye as spears: it will not run into what does not give)
  const wall = 0.5 + 0.45 * clamp((S.armour[e] - 2) / 2, 0, 1) * clamp(v.c?.disc ?? 0.5, 0, 1);
  const hedge = (A.reach || 1) >= 4 || v.formation === "schiltron" ? 1 : WEAPON_BY_ID[S.weapon[e]].long ? Math.max(0.72, wall) : wall;
  const sol = steady * faced * hedge * Math.min(1, localDens / 1.1) * Math.min(1, ranks / 3) * (1 + 0.3 * pts * faced) * viable;
  return clamp(0.05 + 0.95 * sol * sol, 0.02, 0.97);
}

// ---------------------------------------------------------------- unit level (every tick, cheap)
export function cavalryUnit(w, cs, u) {
  const S = w.S, c = u.c; if (!c) return;
  const A = ARM_BY_ID[S.arm[u.members[0]]]; if (!A.mounted) return;
  const t = w.time;
  if (c.broken) { c.phase = "idle"; return; }
  const assault = u.order.kind === "assault" || u.order.kind === "charge";
  if (!assault && c.phase !== "recoil" && c.phase !== "rest") { c.phase = "idle"; u.speedMul = 1; return; }
  // target: the enemy body the assault is steering at
  const tId = u.order.target ?? u.order.keep?.target;
  const named = tId !== undefined ? w.units.get(tId) : null;
  let tgt = named && named.members.length && !(named.c?.broken && (c.phase === "rest" || c.phase === "recoil")) ? named : nearestEnemyUnit(w, u, u.order.x, u.order.y);
  if (!tgt || (tgt.c?.broken && (c.phase === "rest" || c.phase === "recoil"))) tgt = nearestEnemyUnit(w, u, u.ax, u.ay, 1500, true) || tgt;
  if (!tgt) return;
  const tx = tgt.fx ?? tgt.ax, ty = tgt.fy ?? tgt.ay;
  const d = Math.hypot(tx - u.ax, ty - u.ay);
  const routing = tgt.state === "routing";
  switch (c.phase) {
    case "idle": case "approach":
      c.phase = "approach";
      if (routing) { c.phase = "pursuit"; u.pace = "charge"; break; } // after broken men: canter straight at them
      u.pace = d > CAV.gallopFrom ? "quick" : "charge";
      if (d <= CAV.gallopFrom) { c.phase = "charge"; c.chargeStart = t; c.charges++; cs.stats.charges++; c.refused = 0; c.impacts = 0; c.through = 0; c.stuck = 0; c.target = tgt.id; c.contactAt = -1; startRide(w, u, tx, ty); faceTheHorse(w, tgt, u); }
      break;
    case "charge": {
      u.pace = "charge";
      // uphill charges lose their shock; soft ground forbids the gallop (ELEVATION.cavalry, chargeViable)
      const gr = w.map.gradeAlong(u.ax, u.ay, tx - u.ax, ty - u.ay) * 100;
      const via = chargeViable(w, u.ax, u.ay);
      u.speedMul = clamp(1 + (gr > 0 ? (ELEVATION.cavalry?.uphillChargeSpeedMulPerPct ?? -0.03) * gr : 0), 0.4, 1) * (c.ride ? 1 : via < 0.3 * (u.mnt ? M_SOFT[u.mnt] : 1) ? 0.45 : 1); // (riding: each horse finds its own going, rideCharge)
      if (u.mnt) u.speedMul *= mountWeatherMul(w, u.mnt); // (a drake sulks in snow and the dead of the year)
      // the infantry watch it come (§11.2): +0.004/s, ×0 in a steady ≥3-rank spear block, ×2 in the open
      if ((w.tick % 5) === 0 && !routing) {
        const ranks = tgt.c ? tgt.c.ranks || 1 : 1;
        const TA = ARM_BY_ID[S.arm[tgt.members[0]]];
        // (a steady block of points — or of veterans in harness, Crécy's and Poitiers' dismounted men-at-arms — watches it come unmoved)
        const block = (TA?.pointsRanks >= 2 || (TA?.armour >= 4 && (tgt.c?.disc ?? 0) >= 0.7)) && ranks >= 3 && tgt.state === "formed";
        const k = block ? 0 : (tgt.formation === "loose" || tgt.moving) ? 2 : 1;
        const drd = M_DRD[S.horse[u.members[0]]] || 1; // what is coming matters: a drake is worse to watch than a horse (mounts.dread; 1 on a horse)
        if (k && d < 150) for (const id of tgt.members) if (S.alive[id] && S.status[id] !== ST_FLEE) S.stress[id] += MOR.cavCharge * drd * k * DT * 5 * (1.3 - S.courage[id]);
      }
      // cavalry against cavalry is decided before contact (du Picq)
      if (d < 45 && ARM_BY_ID[S.arm[tgt.members[0]]]?.mounted && tgt.c && !tgt.c.broken && !c.vsCavDone) {
        c.vsCavDone = true; if (tgt.c) tgt.c.vsCavDone = true;
        const r = (x) => (1 - x.c.stressM) * (0.7 + 0.6 * w.rng.next()) * (x.c.phase === "charge" ? 1 : 0.6);
        const loser = r(u) < r(tgt) ? u : tgt;
        for (const id of loser.members) if (S.alive[id]) S.stress[id] += CAV.vsCavLoseStress * (1.3 - S.courage[id]);
      }
      if (c.contactAt < 0 && c.impacts + c.refused > 0) c.contactAt = t;
      // the conroi's centre is where its riders are (they drive themselves: rideCharge), not a point running ahead of them
      let n = 0, sx = 0, sy = 0, active = 0;
      if (c.ride) for (const [i, R] of c.ride) { if (!S.alive[i]) continue; sx += S.x[i]; sy += S.y[i]; n++; if (!R.done) active++; }
      if (n) { u.ax = sx / n; u.ay = sy / n; }
      u.path = null;
      if (!c.ride || active === 0 || (c.contactAt >= 0 && t - c.contactAt > 15) || t - c.chargeStart > 100) {
        endRide(w, u);
        u.speedMul = 1;
        if (routing) { c.phase = "pursuit"; break; }
        const [ax, ay] = c.axis || [0, 1];
        if (c.through >= Math.max(2, 0.4 * c.ride0, c.stuck)) {
          // most of the conroi went through: it carries on past, wheels and re-forms beyond for another charge
          const bx = u.ax + ax * CAV.rallyBeyond, by = u.ay + ay * CAV.rallyBeyond;
          applyOrder(w, u, { kind: "move", x: bx, y: by, pace: "quick", facing: Math.atan2(-ay, -ax), keep: u.order });
          u.disengage = true; c.phase = "recoil"; c.recoilT = t; c.rodeThrough = true;
          w.events.push({ t: w.tick, kind: "cav-through", unit: u.id });
          break;
        }
        if (c.stuck < 0.25 * c.ride0) { // hardly anyone got in (refused, missed, brought down short): ride back out of reach and try again
          const bx = u.ax - ax * CAV.recoilDist * 0.5, by = u.ay - ay * CAV.recoilDist * 0.5;
          // (back over a ditch or a brook the horses pick their way at a walk, bunched and floundering — Courtrai)
          const barred = w.features.length && featureCrossed(w, u.ax, u.ay, u.ax - ax * 60, u.ay - ay * 60, (f) => featureDef(f).chargeStop >= 0.6);
          applyOrder(w, u, { kind: "move", x: bx, y: by, pace: barred ? "march" : "quick", facing: Math.atan2(ay, ax), keep: u.order });
          u.disengage = true; c.phase = "recoil"; c.recoilT = t; c.rodeThrough = false;
          break;
        }
        // stopped in the press: the conroi reins in where it stands and fights from the saddle
        // (stopped by a line that stands — not broken, not shaken — they do not stay to be pulled from the saddle: a
        // few blows and the trumpet calls them back to re-form; a line that is giving way they stay to finish)
        // (…unless the way back is barred: a ditch or brook behind them, as at Courtrai — then there is no drawing off)
        const [bx0, by0] = c.axis || [0, 1];
        const trapped = w.features.length && featureCrossed(w, u.ax, u.ay, u.ax - bx0 * 40, u.ay - by0 * 40, (f) => featureDef(f).chargeStop >= 0.6); // (a ditch, a brook, stakes — not scattered pits)
        c.trapped = !!trapped;
        const steadyT = tgt.c && !tgt.c.broken && tgt.c.stressM < 0.4 && !tgt.disordered && !trapped;
        c.phase = "melee"; c.meleeUntil = t + (steadyT ? w.rng.range(CAV.meleeSteady[0], CAV.meleeSteady[1]) : w.rng.range(CAV.meleeHold[0], CAV.meleeHold[1]));
        u.hold = true; u.c.anchorX = u.ax; u.c.anchorY = u.ay; u.c.push = 0; u.c.surge = 0;
      }
      break;
    }
    case "melee": {
      u.pace = "quick";
      const refusedShare = c.refused / Math.max(1, c.refused + c.impacts);
      const blown = meanHorseWind(w, u) < 0.3;
      if (routing) { c.phase = "pursuit"; break; }
      const holds = tgt.c && !tgt.c.broken && tgt.c.stressM < 0.4 && !tgt.disordered && !c.trapped; // (the line in front stands: no good staying — if they can get out)
      if (t > c.meleeUntil && (refusedShare > 0.35 || blown || c.stressM > 0.45 || u.c.eng === 0 || holds)) {
        // recoil to re-form (the conroi rides back, turns and charges again)
        // the foot that saw them off gain confidence (§11.2 "enemy flees before you"); a repulsed charge does
        // not wear on them like a lost exchange (DESIGN: it takes back the pulse it added to their baseline)
        if (tgt.c && !tgt.c.broken) { for (const id of tgt.members) if (S.alive[id]) S.stress[id] = Math.max(0, S.stress[id] - (refusedShare > 0.5 ? 0.05 : 0.03)); tgt.c.flurries = Math.max(0, tgt.c.flurries - 1); }
        const bx = u.ax - (tx - u.ax) / (d || 1) * CAV.recoilDist, by = u.ay - (ty - u.ay) / (d || 1) * CAV.recoilDist;
        applyOrder(w, u, { kind: "move", x: bx, y: by, pace: c.trapped ? "march" : "quick", facing: Math.atan2(ty - by, tx - bx), keep: u.order });
        u.disengage = true; c.phase = "recoil"; c.recoilT = t; c.rodeThrough = false;
        for (const id of u.members) if (S.state[id] === S_FIGHT && S.status[id] !== ST_FLEE) { S.state[id] = S_IDLE; S.foe[id] = -1; }
      }
      break;
    }
    case "recoil":
      if (!u.path || t - c.recoilT > 90) { c.phase = "rest"; u.disengage = false; }
      break;
    case "rest": {
      const ready = meanHorseWind(w, u) > CAV.restHorse && meanW(w, u) > CAV.restW && c.stressM < 0.6;
      if ((ready || t - c.recoilT > 400) && c.charges < CAV.maxCharges) {
        const o = u.order.keep || { kind: "assault", x: tx, y: ty, pace: "charge" };
        applyOrder(w, u, { ...o, kind: "assault", x: tx, y: ty, target: tgt.id }); c.phase = "approach";
      }
      break;
    }
    case "pursuit":
      u.pace = "charge";
      if (!routing) c.phase = "melee";
      break;
  }
}

function nearestEnemyUnit(w, u, x, y, r = 600, formedOnly = false) {
  let best = null, bd = r;
  for (const v of w.units.values()) { if (!isFoe(w, u.team, v.team) || !v.members.length || (formedOnly && v.c?.broken)) continue; const d = Math.hypot((v.fx ?? v.ax) - x, (v.fy ?? v.ay) - y); if (d < bd) { bd = d; best = v; } }
  return best;
}
function meanHorseWind(w, u) { const S = w.S; let s = 0, n = 0; for (const id of u.members) if (S.alive[id] && S.horseOK[id] === 1) { s += S.hwbal[id] / S.hwp[id]; n++; } return n ? s / n : 0; }
function meanW(w, u) { const S = w.S; let s = 0, n = 0; for (const id of u.members) if (S.alive[id]) { s += S.wbal[id] / S.wp[id]; n++; } return n ? s / n : 0; }

// ---------------------------------------------------------------- per rider (every tick)
const nb = [];
export function cavalryTick(w, cs) {
  const S = w.S, t = w.time;
  if (cs.riding?.length) rideThrough(w, cs);
  bolting(w, cs);
  if (cs.dodge?.size) dodgeTick(w, cs);
  for (const u of w.units.values()) { const c = u.c; if (c && c.phase === "charge" && c.ride) rideCharge(w, cs, u); }
  // who is committed to a charge and has not yet struck (owner: no fear, no running, no balking horse until they HIT):
  // morale.moraleThink and melee.horseWound read cs.ctx.committed
  const K = (cs.ctx.committed ||= new Set()); K.clear();
  for (const u of w.units.values()) {
    const c = u.c; if (!c || c.broken || !(c.phase === "approach" || c.phase === "charge")) continue;
    if (!ARM_BY_ID[S.arm[u.members[0]]]?.mounted) continue;
    for (const i of u.members) if (S.alive[i] && S.horseOK[i] >= 1 && (c.phase === "approach" || !(c.ride?.get(i)?.hit) && S.pursueT[i] < (c.chargeStart ?? 0))) K.add(i);
  }
  const A = w.avatar; if (A?.ride && !A.ride.hit && S.alive[A.lord]) K.add(A.lord);
  if (A?.hride) for (const [r, R] of A.hride) if (!R.hit && !R.done) K.add(r);
}

// ---------------------------------------------------------------- the charge as momentum
// At the word each rider takes his line: his place across the conroi's front, laid on the enemy body. From then
// on he drives himself — canter, then the gallop over the last stretch — bending his line only as fast as a horse
// at speed can (CAV.turn), and what is in front of the horse is struck. Every man struck is flung aside and down
// and costs the horse speed (CAV.bleed × m/M); a braced point stops it (CAV.hedge); a body deep enough stops it in
// the press (< CAV.stuckV: the rider fights from the saddle); a thin one it goes through, and out beyond.
function startRide(w, u, tx, ty) {
  const S = w.S, c = u.c;
  const ax = tx - u.ax, ay = ty - u.ay, al = Math.hypot(ax, ay) || 1, hx = ax / al, hy = ay / al;
  c.axis = [hx, hy]; c.ride = new Map(); c.ride0 = 0;
  for (const i of u.members) {
    if (!S.alive[i] || S.horseOK[i] !== 1 || S.status[i] === ST_FLEE || S.posture[i]) continue;
    const lat = -(S.x[i] - u.ax) * hy + (S.y[i] - u.ay) * hx;
    c.ride0++; c.ride.set(i, { lat, v: Math.max(3, Math.hypot(S.vx[i], S.vy[i])), hx, hy, hit: 0, done: 0, pastX: 0, pastY: 0, past: 0 });
  }
}
// A formed body of points standing (not fighting, not on the move) that sees horse coming at its flank or rear turns
// to meet it — sergeants' work, quicker in a drilled body (the finalFacing turn is paced by world.moveUnit)
function faceTheHorse(w, v, u) {
  const S = w.S; if (!v?.c || v.c.broken || v.hold || v.moving || v.disordered || ARM_BY_ID[S.arm[v.members[0]]]?.mounted) return;
  if (!WEAPON_BY_ID[S.weapon[v.members[0]]]?.long || (v.c.ranks || 1) < 3 || w.rng.next() > 0.4 + 0.6 * v.c.disc) return;
  const want = Math.atan2(u.ay - v.ay, u.ax - v.ax), have = v.facing + Math.PI / 2;
  if (Math.abs(Math.atan2(Math.sin(want - have), Math.cos(want - have))) < Math.PI / 4) return;
  v.finalFacing = want; if (v.order) v.order.facing = want;
}
function endRide(w, u) {
  const S = w.S, c = u.c, t = w.time;
  if (c.ride) for (const [i] of c.ride) { if (S.pursueT[i] < c.chargeStart) S.pursueT[i] = t; if (S.busyT[i] > t && S.busyT[i] < t + 0.5) S.busyT[i] = t; }
  c.ride = null;
}
const nb3 = [], nbM = [];
function rideCharge(w, cs, u) {
  const S = w.S, t = w.time, rng = w.rng, c = u.c;
  const tgt = w.units.get(c.target), live = tgt && tgt.members.length;
  const tcx = live ? (tgt.fx ?? tgt.ax) : 0, tcy = live ? (tgt.fy ?? tgt.ay) : 0;
  const [cax, cay] = c.axis;
  for (const [i, R] of c.ride) {
    if (R.done) continue;
    if (!S.alive[i] || S.horseOK[i] !== 1 || S.status[i] === ST_FLEE) { R.done = 1; continue; }
    if (S.busyT[i] > t + 0.35) { // balked at a shaft (melee.horseWound): he checks, gathers his horse and comes on again
      if (S.posture[i] || R.hit) { R.done = 1; S.pursueT[i] = t; } else { if (!R.balkT || t - R.balkT > 1) { R.balkT = t; R.maxV = (R.maxV ?? 1) * CAV.balkSlow; } R.v = Math.min(R.v, 1); S.vx[i] = S.vy[i] = 0; }
      continue;
    }
    let hx = R.hx, hy = R.hy;
    const dT = live ? Math.hypot(tcx - S.x[i], tcy - S.y[i]) : 1e9;
    // his line: his place across the front, laid on the enemy body (until he is among them: then straight on)
    if (!R.hit && live && dT > 12) {
      const halfW = Math.max(8, (tgt.c?.halfW || 15) + 4), lat = clamp(R.lat, -halfW, halfW);
      const gx = tcx - cay * lat, gy = tcy + cax * lat;
      const dx = gx - S.x[i], dy = gy - S.y[i], dl = Math.hypot(dx, dy) || 1;
      const want = Math.atan2(dy / dl, dx / dl), have = Math.atan2(hy, hx);
      let da = Math.atan2(Math.sin(want - have), Math.cos(want - have));
      const tr = (R.v > 6 ? CAV.turn[1] : CAV.turn[0]) * DT; da = clamp(da, -tr, tr);
      hx = Math.cos(have + da); hy = Math.sin(have + da); R.hx = hx; R.hy = hy;
    }
    // speed: canter while far, the gallop over the last stretch; the going and the slope take their share
    const g = goingMul(w, S.arm[i], S.x[i], S.y[i], hx, hy, S.horse[i]);
    if (((w.tick + i) & 7) === 0 || R.via === undefined) R.via = chargeViable(w, S.x[i], S.y[i]); // soft ground under him forbids the gallop
    let vmax = runSpeed(S, i) * (u.speedMul || 1) * Math.max(0.25, g) * (R.via < 0.3 * M_SOFT[S.horse[i]] ? 0.45 : 1) * (R.maxV ?? 1); // (a horse pricked into balking does not find its gallop again; a strider's gallop barely minds soft ground)
    if (!R.hit && dT > CAV.canterTo) vmax = Math.min(vmax, CAV.canter);
    R.v = R.v < vmax ? Math.min(vmax, R.v + CAV.accel * M_ACC[S.horse[i]] * DT) : Math.max(vmax, R.v - 3 * DT);
    S.vx[i] = hx * R.v; S.vy[i] = hy * R.v;
    // an obstacle across his line (ditch, stakes, pits) is met where it lies
    if (w.features.length && obstacleAhead(w, cs, u, i, R.v)) { R.done = 1; continue; }
    // what is in front of the horse
    const reach = 1.1 + R.v * DT;
    neighbours(w, S.x[i] + hx * reach * 0.5, S.y[i] + hy * reach * 0.5, reach, nb3);
    let dens = 0;
    for (const o of nb3) if (isFoe(w, S.team[i], S.team[o]) && S.alive[o] && S.lvl[o] === S.lvl[i]) dens++;
    for (const o of nb3) {
      if (R.done || !isFoe(w, S.team[i], S.team[o]) || !S.alive[o] || S.state[o] === S_CAPT || S.lvl[o] !== S.lvl[i]) continue; // (castle.js: not the men up on a wall-walk)
      if (S.posture[o] && S.horseOK[o] !== 1) continue; // (the fallen are ridden over: bodiesAt slows the charge in impact)
      const dx = S.x[o] - S.x[i], dy = S.y[o] - S.y[i], along = dx * hx + dy * hy, lat = -dx * hy + dy * hx;
      if (along < -0.3 || Math.abs(lat) > 0.9) continue;
      const k = i * 65536 + o; if ((cs.trampled ||= new Map()).get(k) >= c.chargeStart) continue; cs.trampled.set(k, t);
      strike(w, cs, u, i, o, R, lat, dens);
    }
    if (R.done) continue;
    // riders ride at men, not at gaps: close to the enemy he bends his horse at the nearest man ahead of him
    if ((R.hit || dT < 25) && ((w.tick + i) & 1) === 0) {
      neighbours(w, S.x[i] + hx * 3.5, S.y[i] + hy * 3.5, 3.5, nb3);
      let best = -1, bl = 1e9;
      for (const o of nb3) {
        if (!isFoe(w, S.team[i], S.team[o]) || !S.alive[o] || S.posture[o] || S.status[o] === ST_FLEE || S.state[o] === S_CAPT || S.lvl[o] !== S.lvl[i]) continue;
        const dx = S.x[o] - S.x[i], dy = S.y[o] - S.y[i], along = dx * hx + dy * hy; if (along < 1) continue;
        const lat = -dx * hy + dy * hx; if (Math.abs(lat) > along * 0.7 || Math.abs(lat) >= bl) continue;
        bl = Math.abs(lat); best = lat;
      }
      if (best !== -1 && bl > 0.3) { const da = clamp(best * 0.15, -CAV.turn[0] * DT * 2, CAV.turn[0] * DT * 2), have = Math.atan2(hy, hx) + da; hx = R.hx = Math.cos(have); hy = R.hy = Math.sin(have); }
    }
    // men in his line see him coming and throw themselves aside (the loose, the light and the shaken most)
    if (((w.tick + i) & 3) === 0 && R.v > 4) lookAhead(w, cs, i, hx, hy);
    // move
    const nx = clamp(S.x[i] + hx * R.v * DT, w.map.x0 + 1, w.map.x1 - 1), ny = clamp(S.y[i] + hy * R.v * DT, w.map.y0 + 1, w.map.y1 - 1);
    S.x[i] = nx; S.y[i] = ny; S.facing[i] = Math.atan2(hy, hx); S.state[i] = S_MOVE; S.foe[i] = -1;
    S.busyT[i] = t + 0.3; S.power[i] = 250; horseStep(S, i, R.v, DT);
    // stopped in the press: he fights where he is
    if (R.hit && R.v < CAV.stuckV) { R.done = 1; c.stuck = (c.stuck || 0) + 1; S.pursueT[i] = t; S.busyT[i] = t; S.vx[i] *= 0.2; S.vy[i] *= 0.2; continue; }
    // out the far side: carry on a few lengths beyond the last man, then he is through
    if (R.hit && ((w.tick + i) & 3) === 0) {
      if (!R.past) { if (!enemyAhead(w, i, hx, hy)) { R.past = 1; R.pastX = S.x[i]; R.pastY = S.y[i]; } }
      else if (enemyAhead(w, i, hx, hy)) R.past = 0;
    }
    if (R.past && Math.hypot(S.x[i] - R.pastX, S.y[i] - R.pastY) > CAV.outBeyond) { R.done = 1; c.through = (c.through || 0) + 1; S.pursueT[i] = t; S.busyT[i] = t; continue; }
    // missed the body altogether (it moved, or he was carried wide): pull up beyond it
    if (!R.hit && live && (S.x[i] - tcx) * cax + (S.y[i] - tcy) * cay > 45) { R.done = 1; S.pursueT[i] = t; S.busyT[i] = t; }
  }
}
function enemyAhead(w, i, hx, hy) {
  const S = w.S; neighbours(w, S.x[i] + hx * 4, S.y[i] + hy * 4, 5, nb);
  for (const o of nb) if (isFoe(w, S.team[i], S.team[o]) && S.alive[o] && S.status[o] !== ST_FLEE && S.state[o] !== S_CAPT && S.posture[o] === 0 && S.lvl[o] === S.lvl[i]) return true;
  return false;
}

// Rider i's horse strikes man o. The first man of the charge is the moment of the refusal rule, the lance and the
// braced point (impact); after that it is momentum.
export { strike as rideStrike, lookAhead as rideLookAhead };
// A horse at the gallop over a man already down: hooves on him (P CAV.trampleP a blow worth the name), and the horse
// stumbles a little on the body
export function trampleFallen(w, cs, i, o, R) {
  const S = w.S, rng = w.rng; R.v = Math.max(0, R.v - 0.4);
  if (rng.next() < CAV.trampleP) w.events.push({ t: w.tick, kind: "blow", a: i, d: o, mode: M_BLUNT, dx: R.hx, dy: R.hy, res: resolveBlow(cs.ctx, i, o, { E: 60 + 10 * R.v, mode: M_BLUNT, noParry: true, parry: 0, off: Math.PI, nAtk: 1, dist: 0.5, dh: 0, grade: 0, flurryAge: 0 }) });
  S.upT[o] = Math.max(S.upT[o], w.time + 2);
}
function strike(w, cs, u, i, o, R, lat, dens) {
  const S = w.S, t = w.time, rng = w.rng, c = u.c, ctx = cs.ctx;
  if (!R.hit) {
    const r = impact(w, cs, u, i, o, R.v, dens);
    if (r !== "struck") { R.done = 1; return; }
    R.hit = 1;
    if (S.horseOK[i] !== 1) { R.done = 1; return; } // the horse went down on the point
  }
  const tv = w.units.get(S.unit[o]);
  if (S.horseOK[o] === 1) { // horse into horse: both checked, the lighter shoved aside
    R.v *= 0.45; S.x[o] += R.hx * 0.8; S.y[o] += R.hy * 0.8;
    w.events.push({ t: w.tick, kind: "shove", a: i, d: o, dx: R.hx, dy: R.hy });
    return;
  }
  const W = WEAPON_BY_ID[S.weapon[o]];
  let off = S.facing[o] - Math.atan2(S.y[i] - S.y[o], S.x[i] - S.x[o]); off = Math.atan2(Math.sin(off), Math.cos(off));
  // a pike hedge (or a schiltron's ring of points) stops a horse; a spearman who stands and braces his spear checks it
  // and wounds it, but the horse comes on — and a raw levy spearman as often throws himself aside as braces at all
  const hedge = ARM_BY_ID[S.arm[o]].reach >= 4 || tv?.formation === "schiltron";
  if (W.long && Math.abs(off) < Math.PI / 3 && S.status[o] <= ST_WAVER && S.posture[o] === 0 && (!tv?.disordered || tv.formation === "schiltron" || localDensity(w, o) > 0.8)
      && (hedge || w.rng.next() < 0.3 + 0.6 * S.disc[o])) {
    // a braced point: the horse is stopped on it (and hurt: a fresh pike takes it in the chest)
    if (R.hit > 1) resolveBlow(ctx, o, i, { E: Math.min(300, 0.005 * (S.hmass[i] + S.mass[i]) * R.v * R.v), mode: M_THRUST, zone: Z_HORSE, noParry: true, parry: 0.15, off: 0, nAtk: 1, dist: 2, dh: 0, grade: 0, flurryAge: 0 });
    R.v *= hedge ? M_HDG[S.horse[i]] : M_SPR[S.horse[i]]; R.hit++; // (horse: CAV.hedge / CAV.spearCheck exactly; a drake keeps more of its drive, a strider less)
    if (hedge || R.v < CAV.stuckV) return;
    // (checked, not stopped: he goes on over the man who braced — who is ridden down with the rest)
  }
  R.hit++;
  // a packed, deep, steady line absorbs the horse: the man it strikes is driven back into the rank behind him — which
  // holds him up — and the horse is brought up short; loose, shallow, raw or shaken bodies are the ones ridden down
  const vc = tv?.c;
  if (vc && !vc.broken && !tv.disordered && tv.formation !== "loose" && (vc.ranks || 1) >= 3) {
    const pAbs = clamp((1 - clamp(vc.stressM, 0, 1)) * (0.3 + 0.7 * (vc.disc ?? 0.5)) * Math.min(1, vc.ranks / 5) * (0.6 + 0.1 * S.armour[o]), 0, CAV.absorbMax);
    if (w.rng.next() < pAbs) {
      R.v *= CAV.absorbV; S.x[o] += R.hx * 0.5; S.y[o] += R.hy * 0.5;
      w.events.push({ t: w.tick, kind: "shove", a: i, d: o, dx: R.hx, dy: R.hy });
      if (w.rng.next() < 0.3) knockDown(ctx, o, 1, i, "horse");
      return;
    }
  }
  // a few men flung out of a formed body is a dent; a dozen is a body in disorder (the braced points around them stand)
  if (tv?.c && !tv.c.broken && !tv.disordered && tv.formation !== "schiltron") { if ((tv.c.thrownT ?? -1e9) < c.chargeStart) { tv.c.thrownT = t; tv.c.thrownN = 0; } if (++tv.c.thrownN >= Math.max(4, 0.06 * tv.members.length) || !ARM_BY_ID[S.arm[o]].pointsRanks) setDisorder(w, tv); }
  // momentum: he is flung aside and down; the horse pays for it in speed
  const M = S.hmass[i] + S.mass[i] + S.load[i], m = S.mass[o] + S.load[o];
  const side = lat >= 0 ? 1 : -1, ang = side * (0.35 + 0.55 * rng.next());
  const ca = Math.cos(ang), sa = Math.sin(ang), dx = R.hx * ca - R.hy * sa, dy = R.hx * sa + R.hy * ca;
  const sp = R.v * rng.range(CAV.throwV[0], CAV.throwV[1]), disp = clamp(sp * 0.3, 0.6, 3.2);
  S.x[o] = clamp(S.x[o] + dx * disp, w.map.x0 + 1, w.map.x1 - 1); S.y[o] = clamp(S.y[o] + dy * disp, w.map.y0 + 1, w.map.y1 - 1);
  w.events.push({ t: w.tick, kind: "thrown", who: o, by: i, dx, dy, speed: sp, disp });
  if (S.posture[o] === 0) knockDown(ctx, o, 1, i, "horse");
  S.upT[o] = Math.max(S.upT[o], t + rng.range(2, 6)); S.stunT[o] = Math.max(S.stunT[o], t + rng.range(0.5, 2));
  if (rng.next() < clamp((R.v - 3) / 12 * M_SHK[S.horse[i]], 0, 0.5)) w.events.push({ t: w.tick, kind: "blow", a: i, d: o, mode: M_BLUNT, dx, dy, res: resolveBlow(ctx, i, o, { E: (80 + 14 * R.v) * M_SHK[S.horse[i]], mode: M_BLUNT, noParry: true, parry: 0.05, off: Math.PI, nAtk: 1, dist: 0.5, dh: 0, grade: 0, flurryAge: 0 }) });
  R.v = Math.max(0, R.v - R.v * (m / M) * CAV.bleed - 0.25);
  cs.stats.trampled = (cs.stats.trampled || 0) + 1;
  // he is thrown into the men beside him
  neighbours(w, S.x[o], S.y[o], 0.9, nb);
  for (const q of nb) if (q !== o && S.team[q] === S.team[o] && S.alive[q] && S.posture[q] === 0 && S.horseOK[q] !== 1 && rng.next() < CAV.chainP) knockDown(ctx, q, 1, o, "shove");
  // and every man near who saw it
  neighbours(w, S.x[o], S.y[o], 5, nb);
  const steadyBody = tv && !tv.disordered && tv.formation !== "loose" && !tv.c?.broken; // (in ranks that hold round them, men see one comrade go down, not the line)
  for (const q of nb) if (S.team[q] === S.team[o] && S.alive[q] && S.status[q] < ST_FLEE) S.stress[q] += CAV.strikeFear * (1.3 - S.courage[q]) * (1.2 - 0.6 * S.disc[q]) * (steadyBody ? 0.4 : 1);
}

// A man who sees a horse coming straight at him throws himself out of its line if he can (the formed and braced
// stand: a spear block's men hold their places; the loose, the archers and the shaken scatter). He runs aside for
// a second or two — and his company is in disorder.
const nbD = [];
function lookAhead(w, cs, i, hx, hy) {
  const S = w.S, t = w.time, rng = w.rng, L = CAV.dodge.look;
  neighbours(w, S.x[i] + hx * L * 0.55, S.y[i] + hy * L * 0.55, L * 0.55, nb);
  const D = (cs.dodge ||= new Map());
  for (const o of nb) {
    if (!isFoe(w, S.team[i], S.team[o]) || !S.alive[o] || S.posture[o] || S.horseOK[o] === 1 || S.status[o] >= ST_FLEE || S.state[o] === S_CAPT || D.has(o) || S.lvl[o] !== S.lvl[i]) continue;
    const dx = S.x[o] - S.x[i], dy = S.y[o] - S.y[i], along = dx * hx + dy * hy, lat = -dx * hy + dy * hx;
    if (along < 1.5 || along > L || Math.abs(lat) > 1.8) continue;
    const v = w.units.get(S.unit[o]), A = ARM_BY_ID[S.arm[o]];
    const braced = WEAPON_BY_ID[S.weapon[o]].long && v && v.formation !== "loose" && (v.formation === "schiltron" || (!v.disordered && (v.c?.ranks || 1) >= 3) || localDensity(w, o) > 0.8);
    let p = braced ? 0.03 : A.missile ? CAV.dodge.missile : v?.formation === "loose" || v?.disordered ? CAV.dodge.loose : A.band === "levy" ? CAV.dodge.levy : CAV.dodge.close;
    // one decision per man per horse bearing down on him (he stands, or he goes), and a man in a packed rank
    // cannot get out of the way: each file-mate at his elbow halves his chance
    const DD = (cs.dodgeTried ||= new Map()); if (t - (DD.get(o) ?? -1e9) < 4) continue; DD.set(o, t);
    if (DD.size > 4000) for (const [k, tt] of DD) if (t - tt > 4) DD.delete(k);
    let elbow = 0; neighbours(w, S.x[o], S.y[o], 1.1, nbD); for (const q of nbD) if (q !== o && S.team[q] === S.team[o] && S.alive[q] && !S.posture[q]) elbow++;
    p *= (0.5 + S.stress[o] + (1 - S.disc[o]) * 0.5) / (1 + elbow);
    if (rng.next() > p) continue;
    const side = lat >= 0 ? 1 : -1;
    D.set(o, { dx: -hy * side * 0.85 + hx * 0.15, dy: hx * side * 0.85 + hy * 0.15, until: t + rng.range(1.2, 2.4) });
    S.busyT[o] = t + 2.5; S.state[o] = S_MOVE; S.foe[o] = -1;
    S.stress[o] += 0.03 * (1.3 - S.courage[o]);
    // (one man's flinch is not a body's disorder: it takes a few going aside at once — and a schiltron closes its ring)
    if (v?.c && !v.c.broken && v.formation !== "schiltron") { if ((v.c.dodgeT ?? -1e9) < t - 6) { v.c.dodgeT = t; v.c.dodgeN = 0; } if (++v.c.dodgeN >= Math.max(3, 0.04 * v.members.length)) setDisorder(w, v); }
  }
}
function dodgeTick(w, cs) {
  const S = w.S, t = w.time;
  for (const [o, d] of cs.dodge) {
    if (!S.alive[o] || S.posture[o] || t > d.until || S.status[o] >= ST_FLEE) { cs.dodge.delete(o); if (S.alive[o] && S.busyT[o] > t) S.busyT[o] = t; continue; }
    const sp = Math.min(3.5, ARM_BY_ID[S.arm[o]].run) * goingMul(w, S.arm[o], S.x[o], S.y[o], d.dx, d.dy);
    S.x[o] = clamp(S.x[o] + d.dx * sp * DT, w.map.x0 + 1, w.map.x1 - 1); S.y[o] = clamp(S.y[o] + d.dy * sp * DT, w.map.y0 + 1, w.map.y1 - 1);
    S.vx[o] = d.dx * sp; S.vy[o] = d.dy * sp; S.facing[o] = Math.atan2(d.dy, d.dx); S.busyT[o] = t + 0.3; S.power[o] = 700;
  }
}

// has this rider already faced feature f in this charge?
const faced = (cs, i, f, t0) => (cs.obstFaced?.get(i * 65536 + (f.idx ?? 0)) ?? -1) >= t0;
function obstacleAhead(w, cs, u, i, v) {
  const S = w.S, c = u.c, t = w.time, rng = w.rng;
  const hx = S.vx[i] / v, hy = S.vy[i] / v, look = 2 + v * DT * 2;
  const f = featureCrossed(w, S.x[i], S.y[i], S.x[i] + hx * look, S.y[i] + hy * look, (f) => featureDef(f).chargeStop && !faced(cs, i, f, c.chargeStart));
  if (!f) return false;
  if (f.idx === undefined) w.features.forEach((g, k) => { g.idx = k; });
  (cs.obstFaced ||= new Map()).set(i * 65536 + f.idx, t);
  const D = featureDef(f);
  if (D.hiddenUntilM && rng.next() < 0.5) { /* a hidden pit is seen too late to refuse */ }
  else if (rng.next() < D.chargeStop * Math.min(1, v / 6)) {
    // the horse refuses — but a rank galloping on close behind shoves him in anyway (Courtrai: the rear ranks
    // drove the front into the ditches; DESIGN: P CAV.pressedIn per rider closing on him within 4 m at > 4 m/s)
    if (D.fallChanceAtSpeed || D.impaleChanceAtSpeed) {
      neighbours(w, S.x[i] - hx * 2.5, S.y[i] - hy * 2.5, 2.5, nb);
      for (const o of nb) if (o !== i && S.team[o] === S.team[i] && S.horseOK[o] === 1 && S.vx[o] * hx + S.vy[o] * hy > 4 && rng.next() < CAV.pressedIn) {
        S.pursueT[i] = t; ditchFall(cs.ctx, i); S.busyT[i] = t + 3; return true;
      }
    }
    c.refused++; cs.stats.refusals++; S.pursueT[i] = t;
    S.vx[i] = S.vy[i] = 0; S.x[i] -= hx * 1.5; S.y[i] -= hy * 1.5; S.busyT[i] = t + rng.range(CAV.millT[0], CAV.millT[1]);
    S.stress[i] += 0.08 * (1.3 - S.courage[i]);
    w.events.push({ t: w.tick, kind: "refuse", who: i, at: "obstacle" });
    return true;
  }
  const pf = ((D.fallChanceAtSpeed ?? 0) + (D.impaleChanceAtSpeed ?? 0)) * Math.min(1, v / 6);
  if (rng.next() < pf) { S.pursueT[i] = t; ditchFall(cs.ctx, i); S.busyT[i] = t + 3; return true; }
  return false; // taken at the gallop: the going slows him (landread), the charge goes on
}

function impact(w, cs, u, i, e, v, dens) {
  const S = w.S, t = w.time, rng = w.rng, c = u.c, ctx = cs.ctx;
  S.pursueT[i] = t;
  const tv = w.units.get(S.unit[e]);
  const mountedE = S.horseOK[e] === 1;
  const hx = S.vx[i] / (v || 1), hy = S.vy[i] / (v || 1);
  // ground and obstacles over the last 30 m of the run-in (§10.2 terrainChargeViable; stakes/ditches/pits)
  let viable = 1;
  for (const k of [0, 10, 20, 30]) viable = Math.min(viable, chargeViable(w, S.x[i] - hx * k, S.y[i] - hy * k));
  // a heap of fallen men and horses in front of the line is itself an obstacle a horse will not take at speed
  let heap = 0; for (const k of [1, 3, 5]) heap += bodiesAt(cs, S.x[i] + hx * k, S.y[i] + hy * k);
  if (heap) viable /= 1 + 0.5 * heap;
  const obst = featureCrossed(w, S.x[i] - hx * 30, S.y[i] - hy * 30, S.x[e], S.y[e], (f) => featureDef(f).chargeStop && !faced(cs, i, f, c.chargeStart)); // (one already faced on the way in is behind him)
  let pRef = mountedE ? 0.1 : refusalP(w, cs, i, e, tv || {}, unitDensity(w, tv, e), viable) * M_REF[S.horse[i]]; // (mounts.refuse: a drake presses home where a horse shies — 1 on a horse)
  if (obst) pRef = Math.max(pRef, featureDef(obst).chargeStop);
  if (rng.next() < pRef) {
    // the horse refuses: it shies, pulls up short, mills and turns — the rider is now a target
    c.refused++; cs.stats.refusals++;
    const back = rng.range(CAV.refuseStop[0], CAV.refuseStop[1]);
    S.x[i] -= hx * Math.min(back, 6); S.y[i] -= hy * Math.min(back, 6);
    S.vx[i] = S.vy[i] = 0; S.busyT[i] = t + rng.range(CAV.millT[0], CAV.millT[1]);
    S.stress[i] += 0.08 * (1.3 - S.courage[i]);
    // a horse that pulls up at a hedge of pikes pulls up on its points' reach: some are struck as they turn
    if ((ARM_BY_ID[S.arm[e]].reach || 1) >= 4 && WEAPON_BY_ID[S.weapon[e]].long && S.status[e] <= ST_WAVER && S.posture[e] === 0 && rng.next() < CAV.hedgeStab)
      resolveBlow(ctx, e, i, { E: rng.range(120, 260), mode: M_THRUST, zone: Z_HORSE, noParry: true, parry: 0.1, off: 0, nAtk: 1, dist: 4, dh: 0, grade: 0, flurryAge: 0 });
    w.events.push({ t: w.tick, kind: "refuse", who: i });
    return "refused";
  }
  // forced over an obstacle at speed: falls, impalement (§10.2 ditches/stakes/pits)
  if (obst) {
    const D = featureDef(obst);
    const pf = (D.fallChanceAtSpeed ?? 0) + (D.impaleChanceAtSpeed ?? 0);
    if (rng.next() < pf) { ditchFall(ctx, i); S.busyT[i] = t + 3; return "fell"; }
  }
  c.impacts++; cs.stats.impacts = (cs.stats.impacts || 0) + 1;
  // a drake landing in the line is a terror in itself: men near the man struck waver (mounts.fearHit; 0 on a horse, so no horse ever enters here)
  const MF = MOUNTS[S.horse[i]];
  if (MF && MF.fearHit) {
    // terror works on the loose and the shaken; a steady body in ranks holds its face to it (as CAV.strikeFear)
    const steadyT = tv && !tv.disordered && tv.formation !== "loose" && !tv.c?.broken ? 0.3 : 1;
    neighbours(w, S.x[e], S.y[e], MF.fearR, nbM);
    // bounded: the terror sets men wavering (stress up to fearCap, past MOR.waver, short of shaken) — it never routs a line
    // by itself; what breaks them after is the fight, so a drake charge is a shove, not a win button
    for (const q of nbM) if (S.team[q] === S.team[e] && S.alive[q] && S.status[q] < ST_FLEE && S.stress[q] < MF.fearCap) S.stress[q] = Math.min(MF.fearCap, S.stress[q] + MF.fearHit * (1.3 - S.courage[q]) * (1.2 - 0.6 * S.disc[q]) * steadyT);
    w.events.push({ t: w.tick, kind: "mount-fear", who: i, on: e, x: S.x[e], y: S.y[e] });
  }
  const A = ARM_BY_ID[S.arm[e]];
  const We = WEAPON_BY_ID[S.weapon[e]];
  const bearing = Math.atan2(S.y[i] - S.y[e], S.x[i] - S.x[e]);
  let off = S.facing[e] - bearing; off = Math.atan2(Math.sin(off), Math.cos(off));
  const braced = !mountedE && We.long && Math.abs(off) < Math.PI / 3 && S.status[e] <= ST_WAVER && S.posture[e] === 0;
  // the braced spear takes the horse (E ≈ closing KE × 0.01, capped by the shaft at ~300 J)
  if (braced) {
    const KE = 0.5 * (S.hmass[i] + S.mass[i] + S.load[i]) * v * v;
    resolveBlow(ctx, e, i, { E: Math.min(300, KE * 0.01), mode: M_THRUST, zone: Z_HORSE, noParry: true, parry: 0.15, off: 0, nAtk: 1, dist: 2, dh: 0, grade: 0, flurryAge: 0 });
  }
  // the couched lance (first contact only), then the knock-down of the man struck
  const Wr = WEAPON_BY_ID[S.weapon[i]];
  if (S.horseOK[i] === 1) {
    if (Wr.couched) {
      const E = clamp(CAV.lance[0] + 55 * v, CAV.lance[0], CAV.lance[1]);
      const res = resolveBlow(ctx, i, e, { E, mode: M_THRUST, noParry: true, parry: 0.12 + 0.2 * S.skill[e], off, nAtk: 1, dist: 3, dh: 1, grade: 0, flurryAge: 0 });
      w.events.push({ t: w.tick, kind: "lance", who: i, on: e, broke: true }, { t: w.tick, kind: "blow", a: i, d: e, res, mode: M_THRUST, dx: hx, dy: hy });
      S.weapon[i] = S.side[i]; // the lance breaks or is dropped; sword out
    }
    if (S.alive[e] && !mountedE) {
      const pk = (0.4 + 0.4 * Math.min(1.2, v / 8) - (braced ? 0.3 : 0)) * M_SHK[S.horse[i]];
      if (rng.next() < pk) knockDown(ctx, e, 1, i, "horse");
    }
  }
  w.events.push({ t: w.tick, kind: "impact", who: i, on: e });
  if (tv?.c && (tv.c.burstT ?? -1e9) < c.chargeStart && penetrable(w, tv, e)) { tv.c.burstT = t; w.events.push({ t: w.tick, kind: "decisive-moment", type: "ridden-through", title: "Ridden through", team: tv.team, unit: tv.id, by: u.id, x: S.x[e], y: S.y[e], salience: 0.8 }); for (const id of tv.members) if (S.alive[id] && S.status[id] !== ST_FLEE) S.stress[id] += CAV.burstStress * (1.3 - S.courage[id]); }
  return "struck";
}

// A horse going down at the gallop in a ditch, a stream bank, pits or stakes throws a man in 25 kg of harness
// head first into it (DESIGN, CAV.ditchHurt: P incapacitated / P a broken leg, on top of the ordinary fall);
// such men are the ones the Flemings killed at Courtrai where they lay.
export function ditchFall(ctx, i) {
  const S = ctx.S, rng = ctx.rng; if (S.horseOK[i] !== 1) return;
  applyWound(ctx, i, -1, 4, Z_HORSE, "obstacle");
  if (!S.alive[i]) return;
  const u = rng.next();
  if (u < CAV.ditchHurt[0]) applyWound(ctx, i, -1, W_INCAP, Z_TORSO, "fall");
  else if (u < CAV.ditchHurt[0] + CAV.ditchHurt[1]) applyWound(ctx, i, -1, W_DISABLE, Z_THIGHS, "fall");
}

// Can this body stop a charge, or does the horse go through it? Light, loose, shallow (≤ 2 ranks), shaken and not deep,
// moving or running men, archers without stakes, and other horse are ridden into and through; a steady deep
// block of points is not (the refusal rule has already turned most horses away from one).
function penetrable(w, v, e) {
  const S = w.S; if (!v?.c) return true;
  const B = ARM_BY_ID[S.arm[e]];
  if (S.status[e] === ST_FLEE || v.c.broken || B.mounted || B.missile) return true;
  if (v.formation === "loose" || (v.c.ranks || 1) <= 2 || (v.state === "shaken" && (v.c.ranks || 1) <= 4)) return true;
  return v.moving && (B.pointsRanks || 0) < 2;
}

// A bolting horse (horseOK 2) runs away from what hurt it at a flat gallop, through its own side as readily as
// the enemy's — men in its way knocked over, its own ranks disordered (battle-feel #4; Monstrelet at Agincourt:
// the horses "galloped on the van division and threw it into the utmost confusion") — until its rider masters it
// (busyT) or it falls. Fright ebbs meanwhile in every horse that is not bolting.
function bolting(w, cs) {
  const S = w.S, t = w.time, rng = w.rng;
  const B = cs.bolters || (cs.bolters = new Set());
  if ((w.tick & 15) === 0) for (let i = 0; i < S.n; i++) { if (S.horseOK[i] === 2 && S.alive[i]) B.add(i); if (S.hfright[i] > 0) S.hfright[i] = Math.max(0, S.hfright[i] - 0.02 * 16 * DT); }
  for (const i of B) {
    if (!S.alive[i] || S.horseOK[i] !== 2) { B.delete(i); continue; }
    if (S.busyT[i] <= t) { S.horseOK[i] = 1; B.delete(i); S.stress[i] += 0.05 * (1.3 - S.courage[i]); continue; } // mastered
    const v = 7, hx = S.fdx[i] || Math.cos(S.facing[i]), hy = S.fdy[i] || Math.sin(S.facing[i]);
    const nx = S.x[i] + hx * v * DT, ny = S.y[i] + hy * v * DT;
    if (w.map.water(nx, ny) > 1.2 || nx < w.map.x0 + 2 || ny < w.map.y0 + 2 || nx > w.map.x1 - 2 || ny > w.map.y1 - 2) { S.fdx[i] = -hy; S.fdy[i] = hx; continue; } // (swerves along a bank or the edge)
    S.x[i] = nx; S.y[i] = ny; S.vx[i] = hx * v; S.vy[i] = hy * v; S.facing[i] = Math.atan2(hy, hx); S.state[i] = S_IDLE; S.foe[i] = -1;
    neighbours(w, S.x[i], S.y[i], 1.1, nb);
    for (const o of nb) {
      if (o === i || !S.alive[o] || S.posture[o] !== 0 || S.horseOK[o] === 1 || S.lvl[o] !== S.lvl[i]) continue;
      const k = i * 65536 + o; if ((cs.trampled ||= new Map()).get(k) > t - 10) continue; cs.trampled.set(k, t);
      if (rng.next() < 0.45) knockDown(cs.ctx, o, 1, i, "horse");
      if (S.team[o] === S.team[i]) S.stress[o] += 0.04 * (1.3 - S.courage[o]); // your own side's horse through your ranks
    }
  }
}

// Riders who have burst in carry on through at the gallop: they ride down whoever is in their way (knocked
// over, trampled, sometimes hurt) and come out beyond, where the conroi re-forms (cavalryUnit "through").
function rideThrough(w, cs) {
  const S = w.S, t = w.time, rng = w.rng, R = cs.riding; let j = 0;
  for (const i of R) {
    if (!S.alive[i] || S.horseOK[i] !== 1 || S.rideT[i] <= t || S.status[i] === ST_FLEE) { S.rideT[i] = 0; if (S.alive[i] && S.busyT[i] > t) S.busyT[i] = t; continue; }
    R[j++] = i;
    const v = Math.max(4, Math.hypot(S.vx[i], S.vy[i])), hx = S.fdx[i], hy = S.fdy[i];
    S.x[i] += hx * v * DT; S.y[i] += hy * v * DT; S.facing[i] = Math.atan2(hy, hx); S.vx[i] = hx * v; S.vy[i] = hy * v;
    S.power[i] = 250;
    neighbours(w, S.x[i], S.y[i], 1.2, nb);
    for (const o of nb) {
      if (!isFoe(w, S.team[i], S.team[o]) || !S.alive[o] || S.posture[o] !== 0 || S.horseOK[o] === 1 || S.state[o] === S_CAPT || S.lvl[o] !== S.lvl[i]) continue;
      const k = i * 65536 + o; if ((cs.trampled ||= new Map()).get(k) > t - 10) continue; cs.trampled.set(k, t);
      if (rng.next() < CAV.rideTrample) {
        knockDown(cs.ctx, o, 1, i, "horse");
        if (rng.next() < CAV.trampleWound) w.events.push({ t: w.tick, kind: "blow", a: i, d: o, mode: M_BLUNT, dx: hx, dy: hy, res: resolveBlow(cs.ctx, i, o, { E: 90 + 10 * v, mode: M_BLUNT, noParry: true, parry: 0.05, off: Math.PI, nAtk: 1, dist: 0.5, dh: 0, grade: 0, flurryAge: 0 }) });
      }
    }
  }
  R.length = j;
  if (cs.trampled?.size > 5000) for (const [k, tt] of cs.trampled) if (tt < t - 10) cs.trampled.delete(k);
}

// men per m² of the formation the horse is running at (nominal close order × the share still standing in it)
function unitDensity(w, v, e) {
  if (!v?.c) return localDensity(w, e) * 2;
  const A = ARM_BY_ID[w.S.arm[e]], F = FORMATIONS[v.formation] || FORMATIONS.line;
  const sp = A.spacing * F.dense, nominal = 1 / (sp * Math.max(1, sp * 1.15));
  const standing = Math.max(0, (v.c.aliveN || 0) - (v.c.fled || 0)) / Math.max(1, v.c.n0);
  return nominal * Math.min(1, 0.4 + 0.6 * standing) * (v.moving ? 0.8 : 1);
}
function localDensity(w, e) {
  const S = w.S; neighbours(w, S.x[e], S.y[e], 2, nb);
  let n = 0; for (const o of nb) if (S.team[o] === S.team[e] && S.status[o] !== ST_FLEE) n++;
  return n / (Math.PI * 4);
}
