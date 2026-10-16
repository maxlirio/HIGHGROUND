// Hit location (§2), armour penetration (§4.1–4.2) and wound severity (§4.3).
// Shared by melee, missiles, lance impacts and the duel fast-path so every harness exercises the SAME maths.
import { KIT_BY_ID, MAT_BY_ID, ZONE_W, Z_HEAD, Z_FACE, Z_NECK, Z_TORSO, Z_ARMS, Z_HANDS, Z_THIGHS, Z_SHINS, Z_HORSE,
  M_CUT, M_THRUST, M_BODKIN, M_BROAD, M_BLUNT, HORSES } from "./kit.js";
import { M_HIDE } from "./mounts.js";
import { W_NONE, W_BRUISE, W_LIGHT, W_DISABLE, W_INCAP, W_MORTAL, W_INSTANT, clamp } from "./soldiers.js";

export const WC = {
  // DESIGN knobs (calibrated by tools/battle-mc.mjs §17.3 / exchange-rate test)
  aimBias: 0.8,            // how strongly skill steers blows toward weak zones (0 = pure location table)
  thetaSd: 0.55,           // rad, sd of |incidence angle| for melee blows (random surface curvature)
  thetaSdMissile: 0.45,
  headCurve: 1.6,
  flesh: { point: 1.2, cut: 1.5 }, // J per mm (§4.2)
  // horse
  horseFallTorso: 0.5,
};

// ------------------------------------------------------------------ hit location
const AIMABLE = [1, 0.3, 0.3, 1, 1, 0.3, 1, 1]; // small targets (face, neck, hands) are hard to aim at
const zw = new Float64Array(9);
// opts: shield (0/1, frontal), down, mountedTarget, attackerMounted, plunging, skill (aim), E, mode, kit, mask, rear
export function pickZone(rng, S, d, o) {
  for (let z = 0; z < 9; z++) zw[z] = ZONE_W[z];
  if (o.shieldFront) { zw[Z_HEAD] *= 1.5; zw[Z_SHINS] *= 1.6; }                 // Visby: blows go round the shield
  if (o.down) zw[Z_HEAD] *= 3;                                                   // Towton coup de grâce
  if (o.mountedTarget && !o.attackerMounted) { zw[Z_THIGHS] *= 2; zw[Z_HORSE] = 30; zw[Z_HEAD] *= 0.3; zw[Z_NECK] *= 0.3; zw[Z_FACE] *= 0.3; }
  if (o.mountedTarget && o.attackerMounted) { zw[Z_HORSE] = 8; }
  if (o.attackerMounted && !o.mountedTarget) { zw[Z_HEAD] *= 1.5; zw[Z_NECK] *= 1.3; zw[Z_SHINS] *= 0.3; zw[Z_THIGHS] *= 0.6; }
  if (o.plunging) { zw[Z_HEAD] *= 2; zw[Z_ARMS] *= 1.5; zw[Z_SHINS] *= 0.3; zw[Z_FACE] *= 0.3; zw[Z_NECK] *= 0.5; } // heads bowed under the arrow-storm: the brim takes the face
  if (o.rear) { zw[Z_FACE] *= 0.2; zw[Z_HEAD] *= 1.3; }
  if (o.guardDown) { zw[Z_HEAD] *= 1.25; zw[Z_FACE] *= 1.1; }   // (battle-feel #8, Towton: a blown man's guard sags — the blows come to his head)                          // back of the head, the back
  // Skilled men aim at what they can hurt (DESIGN): weight ×(1 + aimBias·skill) on zones this blow can get through.
  if (o.aim > 0 && o.E > 0) {
    for (let z = 0; z < 8; z++) if (outerPen(S, d, z, o.mode) < o.E * 0.85) zw[z] *= 1 + WC.aimBias * o.aim * AIMABLE[z];
  }
  let tot = 0; for (let z = 0; z < 9; z++) tot += zw[z];
  let r = rng.next() * tot;
  for (let z = 0; z < 9; z++) if ((r -= zw[z]) <= 0) return z;
  return Z_TORSO;
}

// Penetration threshold of the outermost worn layer of a zone (J), cheap estimate for aiming.
function outerPen(S, d, z, mode) {
  const K = KIT_BY_ID[S.kit[d]], ls = K.z[z], m = S.kitMask[d];
  let e = z === Z_HEAD ? 30 : 0;
  for (let l = 0; l < ls.length; l++) if (m & (1 << (z * 3 + l))) { const M = MAT_BY_ID[ls[l].mat]; e += mode === M_BLUNT ? 0 : M.pen[mode]; break; }
  return mode === M_BLUNT ? 60 : e;
}

// ------------------------------------------------------------------ penetration
// Returns residual energy that reaches flesh (point/cut) or transmitted energy (blunt).
// gapMul: multiplier on the kit's gap chance (daggers at a downed man ×4).
export function penetrate(rng, S, d, z, mode, E, gapMul = 1) {
  if (z === Z_HORSE) return penetrateHorse(rng, S, d, mode, E);
  const K = KIT_BY_ID[S.kit[d]], ls = K.z[z], m = S.kitMask[d];
  let first = true, e = E;
  if (mode === M_BLUNT) {
    let tx = 1;
    for (let l = 0; l < ls.length; l++) if (m & (1 << (z * 3 + l))) tx *= MAT_BY_ID[ls[l].mat].tx;
    return E * tx;
  }
  const gap = K.gap[z] * gapMul;
  for (let l = 0; l < ls.length; l++) {
    if (!(m & (1 << (z * 3 + l)))) continue;
    if (first && gap > 0 && rng.next() < gap) { first = false; continue; } // found the gap in the plate
    first = false;
    e -= MAT_BY_ID[ls[l].mat].pen[mode];
    if (e <= 0) return 0;
  }
  if (z === Z_HEAD) e -= SKULL.pen[mode];
  return e > 0 ? e : 0;
}
const SKULL = { pen: [30, 25, 25, 30] };
const HIDE = { pen: [15, 8, 6, 5] };
function penetrateHorse(rng, S, d, mode, E) {
  if (mode === M_BLUNT) return E;
  let e = E;
  if (S.kitMask[d] & BARD_BIT) e -= BARD.pen[mode];   // padded caparison (rare in the 13th c.)
  e -= HIDE.pen[mode] * M_HIDE[S.horse[d] * 4 + mode]; // natural hide (×1 on a horse; a drake's scales are worth a bard against the shafts, less against a driven point; a strider's feathers less than a horse's coat)
  return e > 0 ? e : 0;
}
export const BARD_BIT = 1 << 30;
const BARD = { pen: [80, 50, 50, 35] };

// ------------------------------------------------------------------ wound severity (§4.2, §4.3)
// Returns a severity class. `e` is residual (point/cut) or transmitted (blunt) energy in J.
export function woundSeverity(rng, z, mode, e) {
  const u = rng.next();
  if (mode === M_BLUNT) {
    if (e < 25) return W_BRUISE;
    switch (z) {
      case Z_HEAD: case Z_FACE:
        if (e > 150) return u < 0.25 ? W_INSTANT : u < 0.5 ? W_MORTAL : W_INCAP;
        if (e > 100) return u < 0.75 ? W_INCAP : W_DISABLE;        // likely incapacitation
        if (e > 60) return u < 0.5 ? W_INCAP : W_LIGHT;             // fracture / concussion P=0.5
        return u < 0.3 ? W_LIGHT : W_BRUISE;
      case Z_NECK: return e > 80 ? (u < 0.4 ? W_MORTAL : W_INCAP) : W_LIGHT;
      case Z_TORSO: return e > 150 ? (u < 0.4 ? W_INCAP : W_DISABLE) : e > 90 ? (u < 0.3 ? W_DISABLE : W_LIGHT) : W_BRUISE;
      case Z_HORSE: return e > 200 ? W_DISABLE : W_BRUISE;
      default: return e > 80 ? (u < 0.7 ? W_DISABLE : W_LIGHT) : W_BRUISE; // limb fracture >80 J
    }
  }
  if (e <= 0) return W_BRUISE;
  const point = mode !== M_CUT;
  const depth = e / (point ? WC.flesh.point : WC.flesh.cut); // mm
  switch (z) {
    case Z_HEAD:
      if (depth > 20) return u < 0.5 ? W_INSTANT : u < 0.8 ? W_MORTAL : W_INCAP; // brain
      if (depth > 8) return u < 0.6 ? W_INCAP : W_LIGHT;
      return W_LIGHT;
    case Z_FACE:
      if (depth > 30) return u < 0.35 ? W_INSTANT : u < 0.7 ? W_MORTAL : W_INCAP;
      if (depth > 20) return u < 0.5 ? W_INCAP : W_LIGHT;
      return W_LIGHT;
    case Z_NECK:
      if (depth > 25) return u < 0.35 ? W_INSTANT : W_MORTAL;
      if (depth > 15) return u < 0.4 ? W_MORTAL : W_INCAP;
      return W_LIGHT;
    case Z_TORSO:
      if (depth > 40) return u < clamp((depth - 40) / 70, 0, 0.8) ? W_MORTAL : W_INCAP; // ">40 mm potentially lethal"
      if (depth > 20) return u < 0.35 ? W_INCAP : u < 0.7 ? W_DISABLE : W_LIGHT;
      return W_LIGHT;
    case Z_ARMS: case Z_HANDS:
      if (depth > (z === Z_HANDS ? 15 : 25)) return depth > 60 && u < 0.2 ? W_INCAP : W_DISABLE;
      return W_LIGHT;
    case Z_THIGHS:
      if (depth > 45) return u < 0.3 ? W_MORTAL : u < 0.7 ? W_INCAP : W_DISABLE; // femoral
      if (depth > 22) return u < 0.6 ? W_DISABLE : W_LIGHT;
      return W_LIGHT;
    case Z_SHINS:
      if (depth > 50 && !point) return u < 0.4 ? W_INCAP : W_DISABLE; // severed (Visby)
      if (depth > 30) return u < 0.55 ? W_DISABLE : W_LIGHT;
      return W_LIGHT;
    case Z_HORSE: // a 400–500 kg animal: an arrow must go deep to stop it (DESIGN)
      if (depth > 100) return u < 0.3 ? W_INCAP : W_DISABLE;
      if (depth > 50) return u < 0.4 ? W_DISABLE : W_LIGHT;
      return W_LIGHT;
  }
  return W_LIGHT;
}

// Bleed rate (L/min) and clotting time constant (s) per severity (§4.3). Clotting is DESIGN: without it an
// incapacitating wound at 0.3 L/min would kill everyone in 7 min, contradicting P(death in 24 h) 0.3–0.6.
export function bleedFor(rng, sev) {
  switch (sev) {
    case W_LIGHT: return [0.01 + 0.02 * rng.next(), 120 + 360 * rng.next()];
    case W_DISABLE: return [0.03 + 0.1 * rng.next(), 120 + 300 * rng.next()];
    case W_INCAP: return [0.05 + 0.25 * rng.next(), 120 + 300 * rng.next()]; // most bleed slowly: death comes hours later (24 h P 0.3–0.6)
    case W_MORTAL: return [0.5 + 1.5 * rng.next(), 1e9];
  }
  return [0, 1];
}

// Energy of a blow at the surface after a random incidence angle (§4.1). Returns 0 on a glance.
export function incidence(rng, E, mode, sd = WC.thetaSd, z = -1) {
  const th = Math.abs(rng.normal(0, z === Z_HEAD ? sd * WC.headCurve : sd)); // the skull and the helm are round: more glances
  if (mode === M_BLUNT) return E * Math.max(0.3, Math.cos(th));
  if (th > 70 * Math.PI / 180) return 0;
  if (th > 45 * Math.PI / 180 && rng.next() < (th - 45 * Math.PI / 180) / (25 * Math.PI / 180)) return 0; // glance
  const c = Math.cos(th); return E * c * c;
}

export const HORSE_ZONE = Z_HORSE;
export { Z_HEAD, Z_FACE, Z_NECK, Z_TORSO, Z_ARMS, Z_HANDS, Z_THIGHS, Z_SHINS, M_CUT, M_THRUST, M_BODKIN, M_BROAD, M_BLUNT };
