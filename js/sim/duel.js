// Duel fast-path (docs/combat-research.md §17.3): one man against N, resolved with the SAME
// resolveBlow/applyWound/physiology/morale-trigger rules as the battle engine, but without the map,
// spatial hash or unit machinery. A duel is a cloneable state machine so the 1e-5 tail can be estimated
// by multilevel splitting (each time the lone man puts one more opponent out of the fight, the trajectory
// is copied and its weight shared — unbiased, and thousands of times cheaper than brute force).
//
// Protocol (documented in docs/combat-implementation.md):
//  * The lone man is committed: surrounded, he fights at bay as a "fighter" (§11.6) and does not run.
//    A single opponent is likewise a willing duellist.
//  * Up to `ring` (6) attackers can reach him at once (§5: 6–8 around an isolated man); the rest wait
//    a pace back and step in when a place frees.
//  * The attackers set the rhythm (§8): they press while they have wind and back off when blown or
//    after losses; during the lull the blown men rotate out for fresh ones (§5 rear-rank rotation).
//  * Attackers keep their sampled temperaments and full morale: they can break and run (§11.3).
//    Two or more on one isolated man embolden each other one aggression step (same rule as the battle).
//  * P(win) is counted over decided duels (win or loss); fights still undecided after DUEL.maxT (2 h)
//    are reported as draws.
import { makeSoldiers, spawnSoldier, ST_FLEE, W_LIGHT } from "./soldiers.js";
import { ARMS } from "./arms.js";
import { WEAPON_BY_ID } from "./kit.js";
import { resolveBlow } from "./melee.js";
import { exert, PH } from "./physio.js";
import { MOR } from "./morale.js";
import { makeRng } from "./rng.js";

const FOOT = { slip: 0.010, fall: 0.002 }; // short meadow (TERRAIN.short_meadow.footing)
const RING = [0, -1, 1, -2, 2, 3];         // attacker slots around the hero, ×60°
const RING2 = [0, -2];                     // two men work round him: one in front, one at his back-left (DESIGN)
export const DUEL = { terror: 0.15, terrorRate: 0.002, lullMin: 10, lullPerFall: 15, standoff: 60, reluct: 0.13, terrorFloor: 0.048, gang: false, unitSize: 30, seenT: 20, fallStress: MOR.friendDownBond, flurryEnd: 0.35, pressAgain: 0.5, lullMax: 150, lossEnd: 2, rotateBelow: 0.4, maxT: 7200, dt: 0.4 };

// ---------------------------------------------------------------- state
export function duelInit(rng, heroSpec, foeSpec, N, opts = {}) {
  const S = makeSoldiers(N + 2);
  const hero = spawnSoldier(S, rng, { x: 0, y: 0, team: 0, unit: 1, arm: ARMS[heroSpec.arm].id, training: heroSpec.training, kit: heroSpec.kit, weapon: heroSpec.weapon });
  for (let k = 0; k < N; k++) spawnSoldier(S, rng, { x: 0, y: 0, team: 1, unit: 2, arm: ARMS[foeSpec.arm].id, training: foeSpec.training, kit: foeSpec.kit, weapon: foeSpec.weapon });
  S.aggr[hero] = 0; if (N === 1) S.aggr[1] = 0;
  const R = Math.min(opts.ring || 6, N);
  return {
    S, N, R, rng, t: 0, flurry: true, phaseT: 0, lossWin: 0, fledTotal: 0, broke: false, face: 0, nEngaged: 0,
    slots: new Int32Array(R).fill(-1), engaged: new Uint8Array(N + 1), waitUntil: new Float64Array(R),
    out: 0, felled: 0, fled: 0, level: 0, ctx: null,
  };
}
export function duelClone(st, rng) {
  const S = st.S, C = { n: S.n, cap: S.cap, free: [] };
  for (const k in S) { const v = S[k]; if (ArrayBuffer.isView(v)) C[k] = v.slice(); }
  return { ...st, S: C, rng, ctx: null, slots: st.slots.slice(), engaged: st.engaged.slice(), waitUntil: st.waitUntil.slice() };
}

// Advance one step. Returns 0 while undecided, 1 = the lone man won, −1 = he fell, 2 = draw (time out).
export function duelStep(st) {
  const S = st.S, N = st.N, R = st.R, rng = st.rng, hero = 0, slots = st.slots, engaged = st.engaged;
  const dt = st.flurry ? DUEL.dt : DUEL.dt * 8; // nothing but breathing and shuffling happens in a lull
  const t = st.t;
  if (t >= DUEL.maxT) return 2;
  const ctx = st.ctx || (st.ctx = { S, rng, time: 0, tick: 0, events: [] });
  ctx.time = t; ctx.tick++; ctx.events.length = 0;
  st.phaseT += dt;
  const avail = (f) => S.alive[f] && S.status[f] !== ST_FLEE;
  const agOf = (id) => {
    let ag = S.aggr[id];
    if (DUEL.gang && id !== hero && N >= 2 && st.nEngaged >= 2) ag = Math.max(0, ag - 1);
    if (S.wbal[id] / S.wp[id] < 0.3 && ag === 0) ag = 1;
    if (id !== hero && S.stress[id] > MOR.waver) ag = Math.min(2, ag + 1);
    // a man who has stepped into the ring round the lone fighter is not passive (the passive hang back
    // and are the ones waiting their turn) — DESIGN, part of the duel protocol
    if (id !== hero && st.engaged[id]) ag = Math.min(ag, 1);
    return ag;
  };
  const rate = (id) => {
    if (S.status[id] === ST_FLEE || S.posture[id] || S.stunT[id] > t) return 0;
    if (S.wbal[id] / S.wp[id] <= 0.1) return 0;
    const ag = agOf(id); if (ag === 2) return 0;
    return WEAPON_BY_ID[S.weapon[id]].rate[ag] / 60;
  };
  const takeWaiting = (minW) => {
    let best = -1, bw = minW;
    for (let f = 1; f <= N; f++) { if (engaged[f] || !avail(f) || S.stress[f] > MOR.waver - DUEL.reluct * st.felled + 0.3 * (S.courage[f] - 0.5)) continue; const w = S.wbal[f] / S.wp[f]; if (w > bw) { bw = w; best = f; } } // a wavering man does not step up to be next
    return best;
  };
  // --- keep the ring filled (2–4 s to step into a free place)
  for (let s = 0; s < R; s++) {
    const f = slots[s];
    if (f >= 0 && avail(f)) continue;
    if (f >= 0) { engaged[f] = 0; slots[s] = -1; st.waitUntil[s] = t + rng.range(2, 4); }
    if (t >= st.waitUntil[s]) { const k = takeWaiting(-1); if (k >= 0) { slots[s] = k; engaged[k] = 1; } }
  }
  let nAtk = 0; for (let s = 0; s < R; s++) if (slots[s] >= 0) nAtk++;
  st.nEngaged = nAtk;
  if (!nAtk) {
    let any = false; for (let f = 1; f <= N; f++) if (avail(f)) { any = true; break; } if (!any) return 1;
    // nobody left who will step up to be next: after a minute of standing off they let him go (DESIGN)
    st.standoff = (st.standoff || 0) + dt; if (st.standoff > DUEL.standoff) return 1;
  } else st.standoff = 0;
  if (slots[st.face] < 0) { for (let s = 0; s < R; s++) if (slots[s] >= 0) { st.face = s; break; } }
  // --- pulse/lull, attackers' rhythm (§8)
  let wA = 0; for (let s = 0; s < R; s++) if (slots[s] >= 0) wA += S.wbal[slots[s]] / S.wp[slots[s]];
  wA = nAtk ? wA / nAtk : 1;
  st.lossWin *= Math.exp(-dt / 10);
  if (st.flurry && st.phaseT > 4 && (wA < DUEL.flurryEnd || st.lossWin >= DUEL.lossEnd)) { st.flurry = false; st.phaseT = 0; }
  else if (!st.flurry) {
    for (let s = 0; s < R; s++) {
      const f = slots[s]; if (f < 0 || S.wbal[f] / S.wp[f] > DUEL.rotateBelow) continue;
      const k = takeWaiting(0.7); if (k < 0) break;
      engaged[f] = 0; slots[s] = k; engaged[k] = 1;
    }
    // (DESIGN: nobody is keen to be next — the pause before the ring closes again grows with the toll he has taken)
    if ((wA > DUEL.pressAgain && st.phaseT > DUEL.lullMin + DUEL.lullPerFall * st.felled) || st.phaseT > DUEL.lullMax) { st.flurry = true; st.phaseT = 0; }
  }
  // --- blows
  if (S.posture[hero] === 1 && t > S.upT[hero] && S.stunT[hero] <= t) S.posture[hero] = 0;
  if (st.flurry) {
    for (let s = 0; s < R; s++) {
      const f = slots[s]; if (f < 0) continue;
      if (S.posture[f] === 1 && t > S.upT[f]) S.posture[f] = 0;
      const downH = S.posture[hero] !== 0 || S.stunT[hero] > t;
      if (rng.next() < (downH && rate(f) > 0 ? 0.5 : rate(f)) * dt) { // a man on the ground is set upon with daggers (30/min)
        const RG = R === 2 ? RING2 : RING, off = (RG[s] - RG[st.face]) * Math.PI / 3;
        const o = resolveBlow(ctx, f, hero, { ag: agOf(f), off: Math.atan2(Math.sin(off), Math.cos(off)), nAtk, dist: rng.range(0.7, 1.6), flurryAge: st.phaseT, footD: FOOT, footA: FOOT });
        if (st.dbg) { const k = (downH ? "d" : "f") + o; st.dbg.fb = (st.dbg.fb || 0) + 1; st.dbg[k] = (st.dbg[k] || 0) + 1; if (downH) st.dbg.downT = (st.dbg.downT || 0) + 0; }
        if (!S.alive[hero]) return -1;
      }
    }
    const tf = slots[st.face];
    if (tf >= 0 && rng.next() < rate(hero) * dt) { const o = resolveBlow(ctx, hero, tf, { ag: agOf(hero), off: 0, nAtk: 1, dist: rng.range(0.7, 1.6), flurryAge: st.phaseT, footD: FOOT, footA: FOOT }); if (st.dbg) { st.dbg.hb = (st.dbg.hb || 0) + 1; st.dbg["h" + o] = (st.dbg["h" + o] || 0) + 1; } }
    if (st.dbg) { st.dbg.flT = (st.dbg.flT || 0) + (st.flurry ? dt : 0); st.dbg.hr = (st.dbg.hr || 0) + (st.flurry ? rate(hero) * dt : 0); st.dbg.hw = (st.dbg.hw || 0) + (st.flurry ? S.wbal[hero] / S.wp[hero] * dt : 0); }
  }
  // --- physiology
  const pw = (id) => !st.flurry ? PH.lull : (S.posture[id] || rate(id) === 0) ? PH.hold : PH.flurry[agOf(id)];
  exert(S, hero, pw(hero), dt);
  for (let f = 1; f <= N; f++) if (S.alive[f] && S.status[f] !== ST_FLEE) exert(S, f, engaged[f] ? pw(f) : PH.lull, dt);
  // --- morale (§11.2/11.3), the battle's rules
  let fell = 0; for (const e of ctx.events) if ((e.kind === "kill" || e.kind === "down") && S.team[e.victim] === 1) fell++;
  st.felled += fell; st.lossWin += fell;
  let fleeing = 0, alive = 0, seen = 0;
  for (let f = 1; f <= N; f++) { if (!S.alive[f]) continue; alive++; if (S.status[f] === ST_FLEE) { fleeing++; if (t - S.rallyT[f] < DUEL.seenT) seen++; } } // a runner stays in sight a little while (30 m at a run)
  // the attackers are a knot of men from a larger body (DUEL.unitSize): their unit does not break because
  // a few of them run from one man, but their fleeing friends are seen (contagion)
  const unitN = Math.max(N, DUEL.unitSize), brokenFrac = fleeing / unitN;
  for (let f = 1; f <= N; f++) {
    if (!S.alive[f] || S.status[f] === ST_FLEE) continue;
    const g = 1.3 - S.courage[f];
    // a fall is seen by the men engaged and by the first waiting ring (within ~3 m), not by the whole crowd
    const sees = engaged[f] || f <= R + 6;
    // the champion's terror (DESIGN, §15/§17.3): every man he puts down is worse to watch than the last, and
    // facing a man who has already felled k of your friends wears on you (+terrorRate·k per second)
    S.stress[f] += ((sees ? fell * (DUEL.fallStress + DUEL.terror * Math.max(0, st.felled - 1)) : 0) + (engaged[f] && st.flurry ? DUEL.terrorRate * Math.max(0, st.felled - 1) * dt : 0)
      + (S.wbal[f] < 0.1 * S.wp[f] ? MOR.exhausted * dt : 0) + (seen ? Math.min(MOR.contagionCap, seen * MOR.contagion) * dt : 0)) * g;
    if (!engaged[f] && !seen && !fell) S.stress[f] = Math.max(0.1 + DUEL.terrorFloor * st.felled, S.stress[f] + MOR.perRank * 3 * dt); // friends around: supporting ranks (perRank < 0: relief)
    if (S.stress[f] > MOR.breakAt && (seen > 0 || S.sev[f] >= W_LIGHT || brokenFrac > MOR.brokenTrig)) { S.status[f] = ST_FLEE; S.rallyT[f] = t; st.fled++; st.fledTotal++; }
  }
  if (N > 1 && !st.broke && st.fledTotal / unitN >= MOR.unitBreak) { st.broke = true; for (let f = 1; f <= N; f++) if (S.alive[f]) S.stress[f] += MOR.unitBreakStress; }
  st.out = N - (alive - fleeing);       // opponents out of the fight (down, dead or running)
  st.t = t + dt;
  return 0;
}

// Plain Monte-Carlo duel (tools, small N).
export function duel(rng, heroSpec, foeSpec, N, opts = {}) {
  const st = duelInit(rng, heroSpec, foeSpec, N, opts);
  let r = 0; while (!(r = duelStep(st)));
  return { win: r === 1, loss: r === -1, draw: r === 2, t: st.t, felled: st.felled, fled: st.fled, heroSev: st.S.sev[0] };
}

// ---------------------------------------------------------------- odds by multilevel splitting
// Each root duel runs; whenever the lone man takes his k-th opponent out of the fight, the trajectory is
// split into `split` copies with independent random streams, each carrying weight/split. Unbiased for
// any split schedule. Returns sums for the harness: { w: Σ win weight, n: Σ decided weight, d: draw
// share, w2: Σ (per-root win weight)² } → P = w/n over decided duels.
export function oddsEstimate(rng, heroSpec, foeSpec, N, { budget = 200, split = N >= 5 ? 2 : 1, cap = 3000 } = {}) {
  let W = 0, W2 = 0, D = 0, draws = 0;
  for (let r = 0; r < budget; r++) {
    const stack = [[duelInit(makeRng((rng.next() * 4294967296) >>> 0), heroSpec, foeSpec, N), 1]];
    let rootW = 0, rootD = 0, live = 1;
    while (stack.length) {
      let [st, wgt] = stack.pop();
      let res;
      while (!(res = duelStep(st))) {
        if (st.out > st.level) {
          st.level = st.out;
          const m = live < cap ? split : 1;
          if (m > 1) { for (let k = 1; k < m; k++) stack.push([duelClone(st, makeRng((st.rng.next() * 4294967296) >>> 0)), wgt / m]); live += m - 1; wgt /= m; }
        }
      }
      if (res === 1) { rootW += wgt; rootD += wgt; } else if (res === -1) rootD += wgt; else draws += wgt;
    }
    W += rootW; W2 += rootW * rootW; D += rootD;
  }
  return { w: W, n: D, d: draws / budget, w2: W2 };
}
