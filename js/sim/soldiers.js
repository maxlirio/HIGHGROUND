// Soldiers: one record per fighter (and per villager). Struct-of-arrays for speed + determinism.
// Every on-map dot is exactly one of these. Fields follow docs/combat-research.md §1 (body, mind,
// kit, state). Units: mass kg, power W, energy J, blood L, time game-seconds.
import { ARM_BY_ID, BANDS, pickWeighted } from "./arms.js";
import { PERC } from "./clock.js";
import { KIT_BY_ID, sampleKitMask, armourClass, HORSES, SH_PAVISE, WEAPON_BY_ID, MISSILES } from "./kit.js";

export const S_IDLE = 0, S_MOVE = 1, S_FIGHT = 2, S_FLEE = 3, S_DOWN = 4, S_DEAD = 5, S_WORK = 6, S_RALLY = 7, S_CAPT = 8;
// status (§1.4, §11.1)
export const ST_FORMED = 0, ST_WAVER = 1, ST_SHAKEN = 2, ST_FLEE = 3, ST_RALLY = 4, ST_SURR = 5, ST_PURSUE = 6, ST_LOOT = 7;
// aggression class (§1.2)
export const AG_FIGHTER = 0, AG_CAUTIOUS = 1, AG_PASSIVE = 2;
// wound severity (§4.3)
export const W_NONE = 0, W_BRUISE = 1, W_LIGHT = 2, W_DISABLE = 3, W_INCAP = 4, W_MORTAL = 5, W_INSTANT = 6;

const FIELDS_F32 = ["x", "y", "vx", "vy", "facing", "skill", "courage", "strength", "stamina",
  "fatigue", "wounds", "stress", "xp", "ammo", "slotX", "slotY", "heat",
  // body
  "mass", "cp", "wp", "wbal", "gly", "bloodVol", "blood", "bleed", "clotT", "hyd", "load", "limb",
  // mind
  "disc", "skillMul", "exper",
  // horse
  "hwp", "hwbal", "hmass",
  // state / timers (game seconds)
  "slipT", "upT", "stunT", "nextAtk", "nextShot", "fleeDist", "rallyT", "downT", "busyT", "power", "pursueT",
  // legend stats
  "longShot", "atkTime", "fdx", "fdy", "crushT", "nerve0", "gMul", "gGrade", "gEta", "fleeV", "rideT", "hfright", "loX", "loY"];
const FIELDS_I32 = ["unit", "kills", "name", "born", "foe", "kitMask", "rkills", "lastPass", "sec", "home", "mkills"];
const FIELDS_U8 = ["team", "state", "alive", "rank", "file", "arm", "legend", "armour",
  "kit", "weapon", "side", "shield", "shieldArm", "horse", "horseOK", "aggr", "status", "posture", "sev", "disabled",
  "role", "ransom", "nAtk", "maxAtk", "woundsSurv", "rallies", "stoodBroken", "rallied", "missile", "pavise", "bucket", "sawBreak", "agE",
  // level (castle.js): 0 = the ground, ≥ 1 = a walkable structure surface (wall-walk, tower top, keep floor)
  "lvl"];

export function makeSoldiers(cap = 8192) {
  const S = { n: 0, cap };
  for (const f of FIELDS_F32) S[f] = new Float32Array(cap);
  for (const f of FIELDS_I32) S[f] = new Int32Array(cap);
  for (const f of FIELDS_U8) S[f] = new Uint8Array(cap);
  S.free = [];
  return S;
}

const tn = (rng, [m, sd], lo, hi) => clamp(rng.normal(m, sd), lo ?? m - 2.2 * sd, hi ?? m + 2.2 * sd);

// Human variation: most men are ordinary, a few are exceptional. Normal distributions clipped at the
// §1 ranges; the tails are where legends come from.
// `training` (optional, 0..1) overrides the band's skill mean (and shifts nerve/discipline with it).
export function spawnSoldier(S, rng, { x, y, team, unit, arm, training, armour, ammo, tick = 0, kit, weapon, nerve }) {
  let id;
  if (S.free.length) id = S.free.pop();
  else { if (S.n >= S.cap) grow(S); id = S.n++; }
  const A = ARM_BY_ID[arm] || ARM_BY_ID[0];
  const B = BANDS[A.band] || BANDS.trained;
  S.x[id] = x; S.y[id] = y; S.vx[id] = 0; S.vy[id] = 0; S.facing[id] = 0;
  S.team[id] = team; S.unit[id] = unit; S.arm[id] = arm;
  S.state[id] = S_IDLE; S.alive[id] = 1; S.legend[id] = 0; S.lvl[id] = 0;
  // --- mind
  const dSkill = training === undefined ? 0 : training - B.skill[0];
  S.skill[id] = clamp(rng.normal(B.skill[0] + dSkill, B.skill[1]), 0.02, 0.98);
  S.courage[id] = clamp(nerve ?? rng.normal(B.nerve[0] + dSkill * 0.4, B.nerve[1]), 0.02, 0.98); // = nerve
  S.disc[id] = clamp(rng.normal(Math.max(B.disc[0], A.drill) + dSkill * 0.4, B.disc[1]), 0.02, 0.98);
  const r = rng.next(); S.aggr[id] = r < 0.15 ? 0 : r < 0.85 ? 1 : 2; // fighter 15 %, cautious 70 %, passive 15 %
  S.exper[id] = 0; S.skillMul[id] = 1;
  // --- body
  S.mass[id] = tn(rng, B.mass);
  S.strength[id] = tn(rng, B.str, 0.1, 1);
  S.cp[id] = tn(rng, B.cp);
  S.wp[id] = tn(rng, B.wp) * 1000; S.wbal[id] = S.wp[id];
  S.gly[id] = 1; S.bloodVol[id] = B.blood; S.blood[id] = 0; S.bleed[id] = 0; S.clotT[id] = 0; S.hyd[id] = 0;
  S.stamina[id] = clamp((S.cp[id] - 140) / 120, 0.1, 1);
  // --- kit
  const kid = kit ?? A.kitId; S.kit[id] = kid;
  S.kitMask[id] = sampleKitMask(kid, rng) | 0;
  S.armour[id] = armour ?? armourClass(kid, S.kitMask[id] >>> 0);
  S.weapon[id] = weapon ?? pickWeighted(rng, A.weapons);
  S.side[id] = A.sidearmId;
  const sh = WEAPON_BY_ID[S.weapon[id]].twoHand ? 0 : pickWeighted(rng, A.shields);
  S.shield[id] = sh; S.shieldArm[id] = sh ? 1 : 0;
  S.pavise[id] = A.pavise ? 1 : 0;
  const K = KIT_BY_ID[kid];
  S.load[id] = K.load * (0.85 + 0.3 * rng.next()) + (WEAPON_BY_ID[S.weapon[id]].mass || 1) + (sh ? 3 : 0);
  S.limb[id] = K.limb;
  S.missile[id] = A.missile ? Object.keys(MISSILES).indexOf(A.missile) + 1 : 0;
  S.ammo[id] = ammo ?? (A.ammo || 0);
  // --- horse
  S.horse[id] = A.horse || 0; S.horseOK[id] = A.horse ? 1 : 0;
  if (A.horse) { const H = HORSES[A.horse]; S.hmass[id] = H.mass * (0.9 + 0.2 * rng.next()); S.hwp[id] = H.gallopM * (0.8 + 0.4 * rng.next()); S.hwbal[id] = S.hwp[id]; if (H.barding.length > 1 && rng.next() < H.barding[0][1]) S.kitMask[id] |= 1 << 30; }
  S.ransom[id] = A.ransom || 0;
  // --- state
  S.fatigue[id] = 0; S.wounds[id] = 0; S.stress[id] = 0.1; S.xp[id] = 0; S.kills[id] = 0; S.rkills[id] = 0; S.mkills[id] = 0; S.heat[id] = 0;
  S.status[id] = ST_FORMED; S.posture[id] = 0; S.sev[id] = 0; S.disabled[id] = 0; S.role[id] = 0;
  S.slipT[id] = 0; S.upT[id] = 0; S.stunT[id] = 0; S.nextAtk[id] = 0; S.nextShot[id] = 0; S.fleeDist[id] = 0; S.rallyT[id] = 0; S.downT[id] = 0; S.busyT[id] = 0; S.power[id] = 100; S.pursueT[id] = 0;
  S.foe[id] = -1; S.nAtk[id] = 0; S.maxAtk[id] = 0; S.woundsSurv[id] = 0; S.rallies[id] = 0; S.stoodBroken[id] = 0; S.rallied[id] = 0; S.longShot[id] = 0; S.atkTime[id] = 0; S.lastPass[id] = -1; S.sawBreak[id] = 0;
  S.bucket[id] = id % PERC; S.sec[id] = -1; S.fdx[id] = 0; S.fdy[id] = 0; S.crushT[id] = 0; S.nerve0[id] = S.courage[id]; S.gMul[id] = 0; S.gGrade[id] = 0; S.gEta[id] = 1.1; S.fleeV[id] = 0;
  S.name[id] = rng.int(1 << 30); S.born[id] = tick;
  return id;
}

export function killSoldier(S, id, dead = true) {
  S.alive[id] = 0; S.state[id] = dead ? S_DEAD : S_DOWN;
}

function grow(S) {
  const cap = S.cap * 2;
  for (const f of [...FIELDS_F32, ...FIELDS_I32, ...FIELDS_U8]) {
    const a = new S[f].constructor(cap); a.set(S[f]); S[f] = a;
  }
  S.cap = cap;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export { SH_PAVISE };
