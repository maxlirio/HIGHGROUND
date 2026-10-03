// Morale (docs/combat-research.md §11) and the rout (§12): per-soldier stress, the break trigger, contagion,
// flight, rally, surrender and quarter, unit break and re-forming. Gains are multiplied by (1.3 − nerve).
// Per-second rates unless noted. DESIGN values are tuned against §17 by tools/battle-mc.mjs.
import { S_IDLE, S_FIGHT, S_FLEE, S_RALLY, S_CAPT, S_DEAD, ST_FORMED, ST_WAVER, ST_SHAKEN, ST_FLEE, ST_RALLY, ST_PURSUE, ST_LOOT, W_LIGHT, W_INSTANT, clamp } from "./soldiers.js";
import { mountSpeed } from "./mounts.js";
import { ARM_BY_ID } from "./arms.js";
import { neighbours, DT, goingMul } from "./world.js";
import { fell } from "./melee.js";
import { ditchFall } from "./cavalry.js";
import { locoPower, speedAtPower } from "./physio.js";
import { weather, ground, featureNear, FEATURES, bodiesAt, footing, featureCrossed, featureDef } from "./ground.js";
import { nearestEnemy50 } from "./combat.js";
import { isFoe } from "./sides.js";
import { add as techAdd } from "./tech.js";
// research (docs/tech.md, Banners & Trumpets): a team that has it rallies at a higher stress. Battle worlds have no research → 0.
export const rallyBonus = (w, team) => w.teams?.[team]?.tech ? techAdd(w, team, "rally") : 0;

export const MOR = {
  waver: 0.45, shaken: 0.65, breakAt: 0.85,      // §11.1 thresholds
  friendDown: 0.04, friendDownBond: 0.08,         // one-off, seen within 3 m
  woundLight: 0.05, woundDisable: 0.2,            // one-off (applied in melee.applyWound)
  missileNear: 0.006,                             // per arrow landing within 3 m, ×2 if friends are falling
  flank: 0.01, rear: 0.02,                        // enemy on flank (<20 m, outside ±60°) / to the rear
  cavCharge: 0.004,                               // visible galloping cavalry <150 m; ×0 steady ≥3-rank spear block, ×2 in the open
  leaderKilled: 0.15,                             // one-off, bond-weighted — heard of, not known at once:
  newsNear: 15, newsSpeed: 3, bannerUp: 0.05,    // DESIGN: … ; relief to men within 20 m when a new captain raises the banner                     // DESIGN: m that see it fall; m/s the word spreads through the company
  leaderNear: -0.004,                             // leader or banner within 30 m (decay term)
  contagion: 0.015, contagionCap: 0.06,           // per visible fleeing friend within 30 m
  contagionDisc: 0.5,                             // DESIGN: contagion × (1 − this × discipline)
  contagionQuiet: 0.25, contagionStranger: 0.15,                           // DESIGN: × contagion for a man with no enemy near him and no arrows landing
  unitBreaks: 0.10, unitBreaksFar: 0.05,          // one-off: a friendly unit within 150 m (400 m if large) breaks
  anchored: -0.002,                               // flanks on a wood/river/wall
  perRank: -0.0005, maxRanks: 6,                  // each supporting rank behind
  enemyFlees: 0.05,                               // one-off: enemy flees before you
  night: 0.002,
  exhausted: 0.003,                               // W′ < 10 %
  decay: -0.003,                                  // toward the unit baseline when not threatened
  highGround: -0.0005,                            // ELEVATION.melee.higherStressPerSec
  brokenTrig: 0.2, unitBreak: 0.3, unitBreakStress: 0.25, frontCollapse: 0.4, // §11.3
  surrender: 0.3, surrenderRansom: 0.6, quarter: 0.2, quarterRansom: 0.9,  // §11.6
  rallyDecay: -0.004, rallyStress: 0.6, rallyReform: 0.5, rallyNerve: -0.1, // §11.5
  dropHelm: 0.5,                                  // DESIGN: P a man throws off his helmet when he runs
  rallyDist: [200, 500], turnT: [0.5, 2.5], jam: 0.12, panicFall: 0.004, panicFallBodies: 0.03, rallyClearFoot: 150, rallyClearHorse: 300, reformT: [60, 120], reformMin: 90, maxReforms: 1, reformBaseline: 0.7,
  baseline: 0.1, baselineCas: 3.0, baselineFlurry: 0.015, baselinePull: 0.002, // DESIGN: a unit's resting stress rises with its losses and with every pulse it has endured (§8)
  flurryFear: 0.004,                              // DESIGN: stress/s for a front-ranker in a flurry
  missileCasW: 0.7,                               // DESIGN: the share of a man shot down in the ranks that does NOT weigh on the body's mood (he counts 0.3 of one cut down beside it; the stress of the arrows themselves is counted as they land). The battle-feel brief: arrows thin and disorder formed men, they rarely rout them (Agincourt's French stood hours of it)
  horseFallPerM: 2, horseFallGood: 0.01, horseWaterFall: 0.25,          // DESIGN: a galloping fugitive's horse on bad going (see fugitiveMove)
  baselineContact: 0.00005,                       // DESIGN: per second a unit stands in contact, lull or not (deadlocked lines do end)
};

// ------------------------------------------------------------------ per-soldier stress (standing men)
export function moraleThink(w, cs, i, u, dtP, info) {
  const S = w.S, c = u.c, t = w.time;
  const g = 1.3 - S.courage[i];
  const x = S.x[i], y = S.y[i], team = S.team[i];
  const W = weather(w);
  let gain = 0, relief = 0;
  // enemies on the flank / rear within 20 m (coarse grid, enemy cell centroids). For a man in a formed body
  // the arc is the body's: an enemy line facing ours and overlapping it is in FRONT of him, not on his
  // flank; an enemy beyond our end of the line, or behind our front rank, is on the flank/rear.
  let flank = 0, rear = 0, threatened = info.near;
  const ring = u.formation === "schiltron" && !c.broken; // a schiltron has no flank and no rear: that is the point of it
  // (worked out once per company per 10 m cell per tick — men of a body standing in one cell see the same
  // enemy cell centroids; the cache is what keeps this affordable for 3,000 men)
  // (castles: a man on the ground reckons only enemies on the ground and on HIS side of the curtain — the defenders on the
  // wall-walk above the men at its foot, or behind it in the bailey, are not on their flank or in their rear)
  const GD = cs.gnd && S.lvl[i] === 0 ? cs.gnd : null, CA = GD ? w.castleApi : null;
  const fcKey = ((((y - cs.oy) / cs.CG) | 0) * cs.cn + (((x - cs.ox) / cs.CG) | 0)) * 2 + (S.lvl && S.lvl[i] ? 1 : 0);
  if (c.fcT !== w.tick) { c.fcT = w.tick; (c.fc ||= new Map()).clear(); }
  const fcv = info.near && !ring ? c.fc.get(fcKey) : undefined;
  if (fcv !== undefined) { flank = fcv & 1; rear = fcv >> 1; gain += MOR.flank * flank + MOR.rear * rear; }
  else if (info.near && !ring) {
    const n = cs.cn, CG = cs.CG, ci = ((x - cs.ox) / CG) | 0, cj = ((y - cs.oy) / CG) | 0, ec = GD ? GD.ec[team] : cs.ecnt[team], ex = GD ? GD.ex[team] : cs.ecsx[team], ey = GD ? GD.ey[team] : cs.ecsy[team]; // (the teams at war with his: combat.js)
    const meIn = CA?.insideCastle ? !!CA.insideCastle(w, x, y) : null;
    const formed = !c.broken && u.formation !== "loose" && u.formation !== "schiltron";
    const lx = Math.cos(u.facing), ly = Math.sin(u.facing), fx = -ly, fy = lx; // unit lateral / forward
    const halfW = c.halfW || 5, depth = c.depthM || 4;
    const face = S.facing[i], sfx = Math.cos(face), sfy = Math.sin(face);
    for (let j = Math.max(0, cj - 2); j <= Math.min(n - 1, cj + 2); j++) for (let q = Math.max(0, ci - 2); q <= Math.min(n - 1, ci + 2); q++) {
      const k = j * n + q, m = ec[k]; if (!m) continue;
      const exk = ex[k] / m, eyk = ey[k] / m, dx = exk - x, dy = eyk - y, d = Math.hypot(dx, dy); if (d > 20 || d < 0.1) continue;
      if (meIn !== null) { // (the wall between; which side an enemy cell's men stand on, once per cell per tick)
        const nT = cs.gT, ck = team * n * n + k; if (!cs.inT || cs.inT.length !== nT * n * n) { cs.inT = new Int32Array(nT * n * n); cs.inV = new Uint8Array(nT * n * n); } // (stamps are tick + 1: 0 = never, so a fresh grid needs no fill) // (keyed by the viewer's team: his enemies' cell)
        if (cs.inT[ck] !== w.tick + 1) { cs.inT[ck] = w.tick + 1; cs.inV[ck] = CA.insideCastle(w, exk, eyk) ? 1 : 0; }
        if (!!cs.inV[ck] !== meIn) continue;
      }
      if (formed) {
        const ax = exk - u.ax, ay = eyk - u.ay, lat = ax * lx + ay * ly, fwd = ax * fx + ay * fy;
        if (m < 3) continue; // a straggler or two is not a threat to a formed body's flank
        // (behind is judged from the man himself: a unit's anchor surges ahead of its men in a push, and
        // an enemy pressed against our front must not count as being in the middle of our block)
        const beyond = Math.abs(lat) > halfW + 3, behindMe = dx * fx + dy * fy < -3;
        if (fwd < -depth - 2 && behindMe && !beyond) rear = 1;
        else if ((behindMe && !beyond) || (beyond && fwd < 1)) { // (lapping our end but still before our front rank is not yet turning it)
          // beyond our end of the line — unless another of our bodies stands there, in the line beside us
          // (then that enemy is fighting our neighbour, not turning our flank)
          let covered = false;
          if (beyond) { const px = u.ax + lx * lat - fx * depth * 0.5, py = u.ay + ly * lat - fy * depth * 0.5, pk = (((py - cs.oy) / CG) | 0) * n + (((px - cs.ox) / CG) | 0); covered = pk >= 0 && pk < n * n && cs.cnt[team][pk] >= 3; } // (sampled half a block deep: the front rank straddles cells)
          if (!covered) { if (fwd < -depth - 2) rear = 1; else flank = 1; }
        }
      } else {
        const cos = (dx * sfx + dy * sfy) / d;
        if (cos < -0.5) rear = 1; else if (cos < 0.5) flank = 1;
      }
    }
    gain += MOR.flank * flank + MOR.rear * rear;
    c.fc.set(fcKey, flank | (rear << 1));
  }
  // contagion: visible fleeing friends within 30 m
  const vis = Math.min(30, W.visibilityM ?? 20000);
  let fl = 0;
  { const n = cs.cn, CG = cs.CG, ci = ((x - cs.ox) / CG) | 0, cj = ((y - cs.oy) / CG) | 0, fa = cs.flee[team], r = Math.ceil(vis / CG);
    // counted from the man's cell centre, cached per team and cell for the tick
    const nT = cs.gT, ck = team * n * n + cj * n + ci;
    if (!cs.flC || cs.flC.length !== nT * n * n) { cs.flC = new Uint16Array(nT * n * n); cs.flT = new Int32Array(nT * n * n); }
    if (cs.flT[ck] === w.tick + 1) fl = cs.flC[ck];
    else {
      const x0 = (ci + 0.5) * CG, y0 = (cj + 0.5) * CG;
      for (let j = Math.max(0, cj - r); j <= Math.min(n - 1, cj + r); j++) for (let q = Math.max(0, ci - r); q <= Math.min(n - 1, ci + r); q++) {
        const m = fa[j * n + q]; if (!m) continue;
        const dx = (q + 0.5) * CG - x0, dy = (j + 0.5) * CG - y0; if (dx * dx + dy * dy <= (vis + 5) * (vis + 5)) fl += m;
      }
      cs.flT[ck] = w.tick + 1; cs.flC[ck] = Math.min(65535, fl);
    } }
  // (DESIGN: flight is catching for a man who is himself in danger; one standing formed in a quiet part of
  // the field with no enemy near and nothing landing on him watches the fugitives go by — contagionQuiet)
  const shot = cs.recentShot && cs.recentShot[i] && t - cs.recentShot[i] < 10;
  const cq = info.near || shot || c.broken ? 1 : MOR.contagionQuiet;
  // (DESIGN: his own company's runaways count in full; strangers streaming past — another company's
  // routed archers — count contagionStranger each. His company's fugitives are taken to be the near ones.)
  let cg = 0;
  if (fl) { const own = Math.min(fl, c.fled || 0); cg = Math.min(MOR.contagionCap, Math.min(MOR.contagionCap, own * MOR.contagion) + Math.min(MOR.contagionCap, (fl - own) * MOR.contagion) * MOR.contagionStranger) * cq; }
  cg *= 1 - MOR.contagionDisc * S.disc[i]; // (DESIGN, battle-feel brief: drilled men close up round their runaways; a levy runs with them)
  gain += cg;
  if (S.wbal[i] < 0.1 * S.wp[i]) gain += MOR.exhausted;
  if (S.state[i] === S_FIGHT) { const sec = cs.sec.get(S.sec[i]); if (sec && sec.state === 1) gain += MOR.flurryFear; }
  gain += (W.stressAdd || 0) + (w.night ? MOR.night : 0);
  if (cs.recentShot && cs.recentShot[i] && t - cs.recentShot[i] < 10) threatened = true;
  // the captain has fallen (battle-feel #3; Otterburn, Courtrai): the news goes out from where he fell only as fast
  // as men can see it and shout it — those beside him know at once, the far end of the line a minute later, and
  // once a new man has his banner up (the leader replaced, unitMorale) the ones who had not heard never do
  const N = c.leaderNews;
  if (N && !N.heard.has(i) && Math.hypot(x - N.x, y - N.y) < MOR.newsNear + MOR.newsSpeed * (t - N.t)) {
    N.heard.add(i); S.stress[i] += MOR.leaderKilled * g;
  }
  // relief terms (decay toward the unit baseline, never below it)
  if (c.leader >= 0 && S.alive[c.leader] && S.status[c.leader] !== ST_FLEE && i !== c.leader) {
    const dx = S.x[c.leader] - x, dy = S.y[c.leader] - y; if (dx * dx + dy * dy < 900) relief -= MOR.leaderNear;
  }
  if (!c.broken) { const behind = Math.min(MOR.maxRanks, Math.max(0, c.ranks - 1 - S.rank[i])); relief -= MOR.perRank * behind; }
  if (c.anchored) relief -= MOR.anchored;
  if (S.state[i] === S_FIGHT && info.foe >= 0 && w.map.h(x, y) > w.map.h(S.x[info.foe], S.y[info.foe]) + 0.5) relief -= MOR.highGround;
  if (!threatened) relief -= MOR.decay;
  if (cs.dbg) { const D = cs.dbg[cs.dbgUnit ? u.team + ":" + u.arm.slice(0, 5) + u.id : team] || (cs.dbg[cs.dbgUnit ? u.team + ":" + u.arm.slice(0, 5) + u.id : team] = {}); const add = (k, v) => D[k] = (D[k] || 0) + v * g * dtP;
    add("flank", MOR.flank * flank); add("rear", MOR.rear * rear); add("contag", cg);
    add("exh", S.wbal[i] < 0.1 * S.wp[i] ? MOR.exhausted : 0); add("fear", S.state[i] === S_FIGHT && cs.sec.get(S.sec[i])?.state === 1 ? MOR.flurryFear : 0);
    D.relief = (D.relief || 0) + relief * dtP; D.n = (D.n || 0) + 1; }
  if (cs.ctx.committed?.has(i)) gain = 0; // riding in a charge that has not yet struck home: no second thoughts (cavalry.cavalryTick)
  let s = S.stress[i] + gain * g * dtP;
  const base = c.baseline;
  if (s > base) s = Math.max(base, s - relief * dtP);
  else s = Math.min(base, s + MOR.baselinePull * dtP); // the unit's mood drags its men with it (DESIGN)
  S.stress[i] = s;
  // ---- status (§11.1)
  const prev = S.status[i];
  if (prev === ST_PURSUE) { if (s > MOR.shaken) { S.status[i] = ST_SHAKEN; S.state[i] = S_IDLE; } return; }
  S.status[i] = s < MOR.waver ? ST_FORMED : s < MOR.shaken ? ST_WAVER : ST_SHAKEN;
  if (s > 0.8 && S.load[i] > 20 && !(S.disabled[i] & 16)) { S.load[i] *= 0.8; S.disabled[i] |= 16; } // drops heavy kit
  // ---- break trigger (§11.3)
  if (s > MOR.breakAt && !cs.ctx.committed?.has(i)) {
    const brokenFrac = c.aliveN ? c.fled / c.aliveN : 0;
    if (info.fleeFriends > 0 || (info.flankNear > 0 && !ring) || S.sev[i] >= W_LIGHT || brokenFrac > MOR.brokenTrig) {
      if (cs.dbg) { const D = cs.dbg[team] || (cs.dbg[team] = {}); const k = info.fleeFriends > 0 ? "tA" : info.flankNear > 0 && !ring ? "tB" : S.sev[i] >= W_LIGHT ? "tC" : "tD"; D[k] = (D[k] || 0) + 1; }
      startFlee(w, cs, i, u);
    }
  }
}

export function startFlee(w, cs, i, u) {
  const S = w.S;
  if (S.status[i] === ST_FLEE) return;
  S.status[i] = ST_FLEE; S.state[i] = S_FLEE; S.foe[i] = -1; S.sec[i] = -1; S.posture[i] = S.posture[i] === 1 ? 1 : 0;
  if (S.shieldArm[i] && S.shield[i] && S.shield[i] < 5) { S.shieldArm[i] = 0; S.disabled[i] |= 8; } // drops the shield (+10 % speed)
  // ...and often the helmet: Towton's dead were largely bare-headed (§2) — the pursuers' cuts find skulls
  if ((S.kitMask[i] & 1) && w.rng.next() < MOR.dropHelm) { S.kitMask[i] &= ~1; S.load[i] = Math.max(1, S.load[i] - 2); }
  S.fleeDist[i] = 0; S.rallyT[i] = w.rng.range(MOR.rallyDist[0], MOR.rallyDist[1]); S.fleeV[i] = 0; S.gMul[i] = 0;
  S.busyT[i] = w.time + w.rng.range(MOR.turnT[0], MOR.turnT[1]); // turning his back takes a moment — the moment he is struck
  if (u?.c) u.c.fled++;
  // enemies close by see him turn (§11.2 "enemy flees before you" −0.05)
  neighbours(w, S.x[i], S.y[i], 10, nb);
  for (const o of nb) if (isFoe(w, S.team[i], S.team[o]) && S.alive[o] && S.status[o] !== ST_FLEE && S.lvl[o] === S.lvl[i]) S.stress[o] = Math.max(0, S.stress[o] - MOR.enemyFlees * 0.3);
  w.events.push({ t: w.tick, kind: "flee", who: i });
}
const nb = [];

// ------------------------------------------------------------------ fugitives: think (every perception pass)
export function fugitiveThink(w, cs, i, u, dtP) {
  const S = w.S, t = w.time, x = S.x[i], y = S.y[i], team = S.team[i], rng = w.rng;
  const A = ARM_BY_ID[S.arm[i]], mounted = S.horseOK[i] === 1;
  // threat vector from enemies within 60 m (coarse grid), nearest enemy distance up to 300 m
  const n = cs.cn, CG = cs.CG, ci = ((x - cs.ox) / CG) | 0, cj = ((y - cs.oy) / CG) | 0, ec = cs.ecnt[team], ex = cs.ecsx[team], ey = cs.ecsy[team];
  const oc = cs.cnt[team], ox = cs.csx[team], oy = cs.csy[team];
  let tx = 0, ty = 0, nearest = 1e9, sx = 0, sy = 0;
  const R = 4; // cells (40 m): the threat he is running from
  for (let j = Math.max(0, cj - R); j <= Math.min(n - 1, cj + R); j++) {
    const row = j * n;
    for (let q = Math.max(0, ci - R); q <= Math.min(n - 1, ci + R); q++) {
      const k = row + q, m = ec[k];
      // a formed body of his own side is a wall he runs round, not through: its files do not open for a
      // mob (DESIGN; the fugitives of a broken first line streamed past the second's flanks)
      const f = oc[k]; if (f > 3) { const dx = x - ox[k] / f, dy = y - oy[k] / f, d = Math.hypot(dx, dy) || 1; if (d < 25) { sx += dx / d * f / (d * d + 25); sy += dy / d * f / (d * d + 25); } }
      if (!m) continue;
      const dx = x - ex[k] / m, dy = y - ey[k] / m, d = Math.hypot(dx, dy) || 1;
      if (d < nearest) nearest = d;
      tx += dx / d * m / (d * d + 25); ty += dy / d * m / (d * d + 25);
    }
  }
  // the wider look (for rallying) only once he has run far enough to think of stopping
  if (nearest > 40) nearest = S.fleeDist[i] > S.rallyT[i] || S.status[i] === ST_RALLY ? nearestEnemy50(cs, team, x, y, 320) : 50;
  const home = cs.home?.[team] || [0, -1];
  let dx = tx * 2000 + home[0], dy = ty * 2000 + home[1];
  let l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
  if ((sx || sy) && w.map.water(x + dx * 15, y + dy * 15) < 0.3 && w.map.water(x, y) < 0.3) { // (at a river or a bridge there is no going round)
    // skirt the friendly body: keep the part of the push that is sideways to his line of flight
    const along = sx * dx + sy * dy, px = sx - along * dx, py = sy - along * dy, pl = Math.hypot(px, py);
    const k = Math.min(1.5, 60 * Math.hypot(sx, sy));
    if (pl > 1e-9) { dx += px / pl * k; dy += py / pl * k; } else { dx += -dy * k; dy += dx * k; }
    l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
  }
  S.fdx[i] = dx; S.fdy[i] = dy;
  const pursued = nearest < 30;
  if (S.status[i] === ST_FLEE) {
    // stress decays while not pursued (§11.5), faster near a leader or banner
    if (!pursued) S.stress[i] = Math.max(0.2, S.stress[i] + MOR.rallyDecay * (nearLeader(w, u, i, 50) ? 2 : 1) * dtP);
    const clear = mounted ? MOR.rallyClearHorse : MOR.rallyClearFoot;
    if (nearest > clear && S.fleeDist[i] > S.rallyT[i] && S.stress[i] < MOR.rallyStress + rallyBonus(w, S.team[i])) {
      S.status[i] = ST_RALLY; S.state[i] = S_RALLY; S.busyT[i] = t + rng.range(MOR.reformT[0], MOR.reformT[1]);
      if (u?.c) u.c.fled = Math.max(0, u.c.fled - 1);
      w.events.push({ t: w.tick, kind: "rally", who: i });
      return;
    }
    // cornered? (§11.6) enemies within 5 m and no way out (enemies ahead, deep water, map edge)
    if (nearest < 12) cornered(w, cs, i, u, dx, dy);
  } else if (S.status[i] === ST_RALLY) {
    if (nearest < 100) { S.status[i] = ST_FLEE; S.state[i] = S_FLEE; S.stress[i] += 0.1; if (u?.c) u.c.fled++; return; }
    // a unit that has re-formed takes him back; so does his leader standing firm nearby
    if (u && !u.c?.broken) { rejoin(w, i); return; }
  }
}

function nearLeader(w, u, i, r) {
  if (!u?.c) return false; const S = w.S, L = u.c.leader;
  return L >= 0 && L !== i && S.alive[L] && S.status[L] !== ST_FLEE && Math.hypot(S.x[L] - S.x[i], S.y[L] - S.y[i]) < r;
}

export function rejoin(w, i) {
  const S = w.S;
  S.status[i] = ST_FORMED; S.state[i] = S_IDLE; S.stress[i] = MOR.rallyReform;
  if (!S.rallied[i]) { S.courage[i] = Math.max(0.02, S.courage[i] + MOR.rallyNerve); S.rallied[i] = 1; } // permanent −0.1 nerve (§11.5)
}

function cornered(w, cs, i, u, dx, dy) {
  const S = w.S, x = S.x[i], y = S.y[i], rng = w.rng;
  neighbours(w, x, y, 12, nb);
  let close = -1, cd = 1e9, quad = 0;
  for (const o of nb) {
    if (!isFoe(w, S.team[i], S.team[o]) || S.status[o] === ST_FLEE || S.status[o] === ST_RALLY || S.state[o] === S_CAPT || S.lvl[o] !== S.lvl[i]) continue;
    const ox = S.x[o] - x, oy = S.y[o] - y, d = Math.hypot(ox, oy);
    if (d < cd) { cd = d; close = o; }
    if (d < 3.5) { const a = Math.atan2(oy, ox) - Math.atan2(dy, dx); quad |= 1 << (((Math.round(a / (Math.PI / 2)) % 4) + 4) % 4); }
  }
  if (close < 0 || cd > 5) return;
  const ax = x + dx * 8, ay = y + dy * 8;
  const M = w.map, edge = ax < M.x0 + 2 || ay < M.y0 + 2 || ax > M.x1 - 2 || ay > M.y1 - 2;
  const water = w.map.water(ax, ay) > 1.3;
  const surrounded = ((quad & 1) + ((quad >> 1) & 1) + ((quad >> 2) & 1) + ((quad >> 3) & 1)) >= 3 && (quad & 1); // way ahead blocked too
  if (!(surrounded || water) || S.fleeDist[i] < 15) return; // in the first rush out of the press nobody stops to yield
  if (S.busyT[i] > w.time) return; // already decided recently
  S.busyT[i] = w.time + 6;
  if (rng.next() < (S.ransom[i] ? MOR.surrenderRansom : MOR.surrender)) {
    // quarter (§11.6): a disciplined captor spares a man worth a ransom
    const noQ = w.noPrisoners?.[S.team[close]];
    const pq = noQ ? 0.02 : S.disc[close] >= 0.5 ? (S.ransom[i] ? MOR.quarterRansom : MOR.quarter) : (S.ransom[i] ? 0.5 : 0.1);
    if (rng.next() < pq) {
      S.alive[i] = 0; S.state[i] = S_CAPT; S.status[i] = 5;
      if (u?.c) { u.c.fled = Math.max(0, u.c.fled - 1); u.c.captured = (u.c.captured || 0) + 1; }
      w.events.push({ t: w.tick, kind: "captured", who: i, by: close });
    } else fell(cs.ctx, i, close, W_INSTANT, "no-quarter");
  } else {
    // fights at bay like a cornered animal
    S.status[i] = ST_SHAKEN; S.state[i] = S_FIGHT; S.foe[i] = close; S.aggr[i] = 0; S.sec[i] = -1; S.stress[i] = 0.7;
    if (u?.c) u.c.fled = Math.max(0, u.c.fled - 1);
  }
}

// ------------------------------------------------------------------ fugitives: move (every tick)
const FORD = FEATURES.ford, FT = { slip: 0, fall: 0 };
export function fugitiveMove(w, cs, i) {
  const S = w.S, t = w.time;
  if (S.status[i] === ST_RALLY) { S.power[i] = 120; return; }
  if (S.posture[i] !== 0 || S.stunT[i] > t || S.busyT[i] > t) { S.power[i] = 200; return; }
  const A = ARM_BY_ID[S.arm[i]], mounted = S.horseOK[i] === 1;
  let dx = S.fdx[i], dy = S.fdy[i];
  if (!dx && !dy) { dx = 0; dy = -1; }
  // §12 speeds: sprint while W′ lasts (5–6 m/s light, ~4 m/s in mail), then a jog at critical power
  // (speed re-derived every 4th tick per man: it changes as W′ runs out, not from step to step)
  let v = S.fleeV[i];
  const re = ((w.tick + i) & 3) === 1 || !(v > 0);
  if (re) {
    if (mounted) { const ms = mountSpeed(S, i); v = S.hwbal[i] > 60 ? Math.min(A.run * ms, 7 * ms) : 3.6 * ms; } // (ms = 1 on a horse; a strider rides off from anything)
    else v = S.wbal[i] > 0.2 * S.wp[i] ? speedAtPower(S, i, 900, 0, 1.1) : speedAtPower(S, i, S.cp[i], 0, 1.1);
    if (S.disabled[i] & 8) v *= 1.1;
    if (S.disabled[i] & 4) v *= 0.3; // crippled leg
    S.fleeV[i] = v;
  }
  // a routing crowd jams on itself (DESIGN): more fugitives in the same 10 m cell, slower going
  const n = cs.cn, kc = (((S.y[i] - cs.oy) / cs.CG) | 0) * n + (((S.x[i] - cs.ox) / cs.CG) | 0), crowd = cs.flee[S.team[i]][kc];
  if (crowd > 6) v /= 1 + MOR.jam * (crowd - 6);
  // panic running: men trip, the more so over the fallen (DESIGN)
  if (!mounted && w.rng.next() < (MOR.panicFall + (cs.bodies.size ? MOR.panicFallBodies * Math.min(3, bodiesAt(cs, S.x[i], S.y[i])) : 0)) * DT) { S.posture[i] = 1; S.upT[i] = t + w.rng.range(1.5, 4) + S.load[i] / 20; return; }
  let g = S.gMul[i];
  if (((w.tick + i) & 3) === 0 || !g) g = S.gMul[i] = S.lvl[i] ? 1 : goingMul(w, S.arm[i], S.x[i], S.y[i], dx, dy, S.horse[i]) || 0.02; // (castle.js: on a level the going is the floor's)
  let nx = S.x[i] + dx * v * g * DT, ny = S.y[i] + dy * v * g * DT;
  // river / bridge bottleneck: water ahead that is too deep — try to slide along the bank
  let depth = w.map.water(nx, ny);
  if (depth > 1.1 && w.map.water(S.x[i], S.y[i]) < 0.8) {
    const bx = -dy, by = dx, s = ((S.name[i] & 1) ? 1 : -1);
    const ax = S.x[i] + bx * s * v * DT, ay = S.y[i] + by * s * v * DT;
    if (w.map.water(ax, ay) < 1.1 || w.rng.next() < 0.3) { nx = ax; ny = ay; depth = w.map.water(nx, ny); } // most run along the bank; some plunge in
  }
  const M = w.map; nx = clamp(nx, M.x0, M.x1); ny = clamp(ny, M.y0, M.y1);
  if (nx < M.x0 + 3 || ny < M.y0 + 3 || nx > M.x1 - 3 || ny > M.y1 - 3) { S.fleeDist[i] += 1000; } // off the field: gone (rallies if left alone)
  const moved = Math.hypot(nx - S.x[i], ny - S.y[i]);
  S.x[i] = nx; S.y[i] = ny; S.vx[i] = dx * v * g; S.vy[i] = dy * v * g;
  S.facing[i] = Math.atan2(dy, dx);
  S.fleeDist[i] += Math.max(moved, 0.5 * DT); // pinned against a river he still gets his breath back in time
  if (re) S.power[i] = mounted ? 250 : locoPower(S, i, v * g, 0, 1.2);
  // a horse ridden flat out in flight over bad going — cut banks, a brook, a ditch, heaps of the fallen — goes
  // down (DESIGN: per metre, MOR.horseFallPerM × the ground's footing fall beyond good going × (v/7)²; ditches and
  // pits by their fall chance spread over their width). The rider is then a fugitive on foot, in armour, in the water.
  if (mounted && moved > 0.2 * DT) {
    const spd = v, k = Math.min(1, (spd / 7) * (spd / 7)); // (the pace he came at the bank with, not his scramble through it)
    let hz = (MOR.horseFallPerM * Math.max(0, footing(w, nx, ny, FT).fall - MOR.horseFallGood) + MOR.horseWaterFall * Math.max(0, depth - 0.6)) * k; // (belly-deep water at a gallop: the horse founders)
    if (w.features.length) { const f = featureCrossed(w, S.x[i] - dx * moved, S.y[i] - dy * moved, nx, ny, (f) => featureDef(f).fallChanceAtSpeed || featureDef(f).impaleChanceAtSpeed); if (f) { const D = featureDef(f), P = Math.min(0.95, ((D.fallChanceAtSpeed || 0) + (D.impaleChanceAtSpeed || 0)) * Math.min(1, spd / 6)); hz += -Math.log(1 - P) / Math.max(1, f.width || 1); } }
    if (hz > 0 && w.rng.next() < hz * moved) ditchFall(cs.ctx, i);
  }
  // drowning (§12; FEATURES.ford bands, fleeing ×5, heavier in armour): per metre of water crossed
  if (depth > 0.5 && !mounted) {
    const band = FORD?.bands?.find((b) => depth <= b.maxDepth) || { drownP: 0.1 };
    const P = Math.min(0.95, band.drownP * (FORD?.fleeingDrownMul ?? 5) * (0.6 + 0.25 * S.armour[i]));
    const hz = -Math.log(1 - P) / 15; // a typical 15 m crossing
    if (w.rng.next() < hz * moved) fell(cs.ctx, i, -1, W_INSTANT, "drown");
  }
}

// ------------------------------------------------------------------ unit morale, break, rally (§11.3–11.5)
export function unitMorale(w, cs, u, dtP) {
  const S = w.S, c = u.c, t = w.time;
  let alive = 0, fled = 0, rally = 0, stress = 0, rx = 0, ry = 0, fx = 0, fy = 0, frontUp = 0;
  for (const id of u.members) {
    if (!S.alive[id]) continue; alive++;
    if (S.stress[id] > 1.5) S.stress[id] = 1.5; // past this point more fear changes nothing
    stress += S.stress[id];
    if (S.status[id] === ST_FLEE) { fled++; fx += S.x[id]; fy += S.y[id]; }
    else if (S.status[id] === ST_RALLY) { rally++; rx += S.x[id]; ry += S.y[id]; }
  }
  for (const id of c.front) if (S.alive[id] && S.status[id] !== ST_FLEE && S.status[id] !== ST_RALLY) frontUp++;
  c.aliveN = alive; c.fled = fled; c.stressM = alive ? stress / alive : 0;
  { const A = ARM_BY_ID[S.arm[u.members[0]]]; const files = Math.min(u.files || 1, alive || 1); c.halfW = files * A.spacing / 2;
    let mr = 0; for (const id of u.members) if (S.alive[id] && S.status[id] !== ST_FLEE && S.rank[id] > mr) mr = S.rank[id];
    c.ranks = mr + 1; // ranks of a line, rings of a schiltron
    if (u.formation === "schiltron") c.halfW = Math.sqrt(alive) * A.spacing * 0.6;
    c.depthM = c.ranks * (A.rankDepth || 1.0);
    // how readily a horse refuses this body's front (the §10.2 solidity, frontal): used by riders in melee
    const pts = Math.min(3, A.pointsRanks || 0) / 3, standing = alive ? (alive - fled) / Math.max(1, c.n0) : 0;
    const sol = clamp(1 - c.stressM, 0, 1) * (c.broken ? 0.1 : 1) * (u.moving ? (u.pace === "march" ? 0.85 : 0.6) : 1) * Math.min(1, 0.4 + 0.6 * standing) * Math.min(1, c.ranks / 3) * (1 + 0.3 * pts);
    c.horseproof = A.mounted ? 0 : clamp(0.05 + 0.95 * sol * sol, 0.02, 0.97); }
  // out of contact, the strain of the pulses and of standing face to face fades (τ 10 min); losses do not
  if (!u.hold) { const k = Math.exp(-dtP / 600); c.flurries *= k; c.contactDur *= k; }
  c.baseline = Math.min(0.95, MOR.baseline + MOR.baselineCas * (c.cas - MOR.missileCasW * (c.mcas || 0)) / Math.max(1, c.n0) + MOR.baselineFlurry * c.flurries + MOR.baselineContact * c.contactDur + (c.rallied ? 0.1 : 0) + (u.moraleMod || 0));
  if (fled + rally && c.broken) { u.fx = (fx + rx) / (fled + rally); u.fy = (fy + ry) / (fled + rally); } else if (fled) { u.fx = fx / fled; u.fy = fy / fled; } else { u.fx = undefined; u.fy = undefined; }
  // leader replaced 30–60 s after he falls (next best man in the second rank)
  if (c.leader >= 0 && !S.alive[c.leader] && c.leaderLost >= 0 && t - c.leaderLost > 45) {
    let best = -1, bn = -1;
    for (const id of u.members) if (S.alive[id] && S.status[id] <= ST_WAVER && S.courage[id] > bn) { bn = S.courage[id]; best = id; }
    if (best >= 0) { c.leader = best; S.role[best] = 1; c.leaderLost = -1; c.leaderNews = null; // (his banner goes up again: the men near him take heart)
      for (const id of u.members) if (S.alive[id] && S.status[id] !== ST_FLEE && Math.hypot(S.x[id] - S.x[best], S.y[id] - S.y[best]) < 20) S.stress[id] = Math.max(0, S.stress[id] - MOR.bannerUp); }
  }
  // flanks anchored on a wood, water or wall (every ~10 s)
  if ((w.tick / 5 | 0) % 5 === (u.id % 5)) c.anchored = anchoredFlanks(w, u);
  // ---- break (§11.3)
  const brokenFrac = alive ? fled / alive : 0;
  const collapse = c.front.length >= 4 && frontUp / c.front.length < MOR.frontCollapse && c.contactT >= 0;
  if (!c.broken && alive && (brokenFrac >= MOR.unitBreak || collapse)) { if (cs.dbg) { const D = cs.dbg[u.team] || (cs.dbg[u.team] = {}); D[collapse ? 'uCollapse' : 'uFled'] = (D[collapse ? 'uCollapse' : 'uFled'] || 0) + 1; } onUnitBreak(w, cs, u); }
  // ---- rally: enough of the unit has stopped running (rallied, or never ran), together, with no enemy
  // near (§11.5); the leader standing firm with his banner is the natural rallying point
  // (DESIGN: a body that has already broken twice, or whose losses have left its mood near breaking, does not
  // form again — its men make their own way off the field; otherwise it breaks and re-forms every few minutes)
  if (c.broken && t - c.breakT > MOR.reformMin && (c.breaks || 0) < MOR.maxReforms + 1 && c.baseline < MOR.reformBaseline && fled < 0.25 * alive && alive - fled >= Math.max(4, 0.25 * alive)) {
    let cx = 0, cy = 0, m = 0;
    const L = c.leader >= 0 && S.alive[c.leader] && S.status[c.leader] !== ST_FLEE ? c.leader : -1;
    if (L >= 0) { cx = S.x[L]; cy = S.y[L]; }
    else { for (const id of u.members) if (S.alive[id] && S.status[id] !== ST_FLEE) { cx += S.x[id]; cy += S.y[id]; m++; } cx /= m || 1; cy /= m || 1; }
    let together = 0; for (const id of u.members) if (S.alive[id] && S.status[id] !== ST_FLEE && Math.hypot(S.x[id] - cx, S.y[id] - cy) < 120) together++;
    if (together >= Math.max(4, 0.25 * alive) && !enemyWithin(cs, S.team[u.members[0]], cx, cy, ARM_BY_ID[S.arm[u.members[0]]].mounted ? 250 : 150)) reform(w, cs, u, cx, cy);
  }
  // ---- status label
  const prev = u.state;
  u.morale = clamp(1 - c.stressM, 0, 1);
  u.state = c.broken ? "routing" : c.stressM > MOR.shaken ? "shaken" : c.stressM > MOR.waver ? "wavering" : "formed";
  if (prev !== u.state) w.events.push({ t: w.tick, kind: "unit-" + u.state, unit: u.id, team: u.team });
}

function enemyWithin(cs, team, x, y, r) { return nearestEnemy50(cs, team, x, y, r + 50) < r; }

export function onUnitBreak(w, cs, u) {
  const S = w.S, c = u.c, t = w.time;
  c.broken = true; c.breakT = t; c.brokenAt = c.cas / Math.max(1, c.n0); c.breaks = (c.breaks || 0) + 1;
  if (c.firstBreakT === undefined) { c.firstBreakT = t; c.brokenAt0 = c.brokenAt; }
  u.hold = false; u.path = null; u.order = { kind: "hold", x: u.ax, y: u.ay }; u.pursue = false;
  for (const id of u.members) if (S.alive[id]) S.stress[id] += MOR.unitBreakStress;
  // neighbours see it (§11.4): full within 150 m, half to 400 m for a large body; enemies take heart
  const big = c.n0 >= 200;
  for (const v of w.units.values()) {
    if (v === u || !v.members.length) continue;
    const d = Math.hypot(v.ax - u.ax, v.ay - u.ay);
    if (v.team === u.team) {
      const k = d < 150 ? MOR.unitBreaks : big && d < 400 ? MOR.unitBreaksFar : 0;
      if (k) for (const id of v.members) if (S.alive[id] && S.status[id] !== ST_FLEE) { S.stress[id] += k * (1.3 - S.courage[id]); if (cs.dbg) { const D = cs.dbg[v.team] || (cs.dbg[v.team] = {}); D.unitBreak = (D.unitBreak || 0) + k * (1.3 - S.courage[id]); } }
    } else if (d < 150 && isFoe(w, u.team, v.team)) for (const id of v.members) if (S.alive[id]) S.stress[id] = Math.max(0, S.stress[id] - MOR.enemyFlees);
  }
  w.events.push({ t: w.tick, kind: "unit-break", unit: u.id, team: u.team, cas: c.brokenAt });
}

function reform(w, cs, u, x, y) {
  const S = w.S, c = u.c;
  c.broken = false; c.rallied++; c.contactT = -1; c.front = [];
  u.ax = x; u.ay = y; u.path = null; u.hold = false;
  // face the enemy
  const home = cs.home?.[u.team] || [0, -1];
  u.facing = Math.atan2(-home[1], -home[0]) - Math.PI / 2;
  u.order = { kind: "hold", x, y, facing: u.facing + Math.PI / 2 }; u.finalFacing = u.facing + Math.PI / 2;
  for (const id of u.members) if (S.alive[id] && S.status[id] !== ST_FLEE) rejoin(w, id);
  c.front = u.members.slice(0, u.files || 1);
  c.fled = 0;
  w.events.push({ t: w.tick, kind: "unit-rallied", unit: u.id, team: u.team });
}

function anchoredFlanks(w, u) {
  const S = w.S, n = u.members.length, width = (u.files || 1) * (ARM_BY_ID[S.arm[u.members[0]]].spacing || 1);
  const lx = Math.cos(u.facing), ly = Math.sin(u.facing);
  let k = 0;
  for (const s of [-1, 1]) {
    const px = u.ax + lx * s * (width / 2 + 10), py = u.ay + ly * s * (width / 2 + 10);
    const g = ground(w, px, py);
    if (w.map.water(px, py) > 1 || (g.cohesionMul ?? 1) < 0.5 || (g.moveMul?.cavalry ?? 1) < 0.2 || featureNear(w, px, py, 10)) k++;
  }
  return k === 2;
}
