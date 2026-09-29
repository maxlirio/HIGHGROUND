// Physiology (docs/combat-research.md §6): Pandolf locomotion cost, critical power / W′ balance,
// glycogen, heat, bleeding. Fatigue is a consequence of power output, never a stamina bar.
import { clamp } from "./soldiers.js";
import { KIT_ID } from "./kit.js";
const KIT_MAA = KIT_ID.maa;

export const PH = {
  mech: 0.22,          // DESIGN: Pandolf metabolic W → CP-model (mechanical) W. Makes walking ≈ 85 W, a 2.5 m/s jog ≈ CP, a 5.5 m/s sprint ≈ 950 W (W′ gone in ~25 s) — the §12 speeds.
  flurry: [750, 600, 420], // W in a flurry by aggression class (fighter/cautious/passive) (§6.2: 500–800)
  hold: 300,           // guard, shoving, pushing from the rank behind
  lull: 150,           // standing + breathing in the lull (120–180)
  rest: 100,
  shotW: 13.5,         // extra W per arrow/min drawn (DESIGN: 6/min ≈ CP, 10/min lasts ≈6 min → dry in 6–7 min, §9.4)
};

// Pandolf et al. 1977. W body kg, L load kg, V m/s, G grade %, eta terrain factor. Returns metabolic W.
export function pandolf(W, L, V, G, eta) {
  const WL = W + L, r = L / W;
  let M = 1.5 * W + 2.0 * WL * r * r + eta * WL * (1.5 * V * V + 0.35 * V * Math.max(G, 0));
  if (G < 0) {
    // Downhill: cost falls to a minimum near −10 % (≈0.6× level locomotion), then rises again (braking) — ELEVATION.fatigue.
    const lev = eta * WL * 1.5 * V * V;
    const mul = G >= -10 ? 1 - 0.04 * -G : 0.6 + 0.08 * (-G - 10);
    M += lev * (mul - 1);
  }
  return M;
}

// Mechanical-equivalent power of moving at v (m/s) on grade G (%) for soldier id.
export function locoPower(S, id, v, G, eta) {
  if (v < 0.05) return PH.rest;
  return pandolf(S.mass[id], S.load[id] + S.limb[id], v, G, eta) * PH.mech; // §6.1: armour limb mass counted once more
}

// Speed (m/s) at which locomotion power equals P (inverse Pandolf, level-ish).
export function speedAtPower(S, id, P, G, eta) {
  const W = S.mass[id], L = S.load[id] + S.limb[id], WL = W + L, r = L / W;
  const a = 1.5 * W + 2 * WL * r * r, b = eta * WL * 1.5, c = eta * WL * 0.35 * Math.max(G, 0);
  const M = P / PH.mech - a; if (M <= 0) return 0.3;
  return (-c + Math.sqrt(c * c + 4 * b * M)) / (2 * b);
}

export function cpEff(S, id, env) {
  let cp = S.cp[id];
  if (S.gly[id] < 0.2) cp *= 0.75;
  if (env && S.hyd[id] > 0.02 * S.mass[id]) cp *= 0.85; // >2 % body-mass deficit: −10–20 %
  if (env?.hunger) cp *= 0.9;
  if (S.kit[id] === KIT_MAA && (S.kitMask[id] & (1 << 3))) cp *= 0.85; // §6.1: closed helm / tight breastplate caps VO₂ at 0.85
  return cp;
}

// Integrate one soldier's energy systems for dt game-seconds at power P.
export function exert(S, id, P, dt, env) {
  S.power[id] = P;
  const cp = cpEff(S, id, env);
  let wb = S.wbal[id];
  if (P > cp) wb -= (P - cp) * dt;
  else {
    const tau = 546 * Math.exp(-0.01 * (cp - P)) + 316; // Skiba et al.
    wb += (S.wp[id] - wb) * (1 - Math.exp(-dt / tau));
  }
  S.wbal[id] = wb < 0 ? 0 : wb;
  // glycogen: drains at max(0, P − 0.5·CP)/CP hours per hour, capacity 3–4 h at CP
  if (P > 0.5 * cp) S.gly[id] = Math.max(0, S.gly[id] - (P - 0.5 * cp) / cp * dt / (3.5 * 3600));
  // heat: sweat 1–2 L/h in armour > 20 °C under exertion
  if (env?.sweatLph && P > 200) S.hyd[id] += env.sweatLph[S.armour[id] >= 4 ? 2 : S.armour[id] >= 2 ? 1 : 0] * dt / 3600;
  const wf = S.wbal[id] / S.wp[id];
  S.fatigue[id] = clamp(Math.max(1 - wf, (1 - S.gly[id]) * 0.6), 0, 1);
}

export const wFrac = (S, id) => S.wbal[id] / S.wp[id];

// §6.2 effects of low W′ on blow energy and parry.
export function blowFatigueMul(wf) { return wf >= 0.3 ? 1 : wf >= 0.1 ? 0.8 : 0.6; }
export function parryFatigueMul(wf) { return wf >= 0.3 ? 1 : wf >= 0.1 ? 0.85 : 0.6; }

// Bleeding with clotting: returns 1 = unconscious threshold crossed, 2 = dead.
export function bleedStep(S, id, dt) {
  const b = S.bleed[id]; if (b <= 0) return 0;
  S.blood[id] += b * dt / 60;
  S.bleed[id] = b * Math.exp(-dt / S.clotT[id]);
  if (S.bleed[id] < 0.002) S.bleed[id] = 0;
  const f = S.blood[id] / S.bloodVol[id];
  return f > 0.4 ? 2 : f > 0.3 ? 1 : 0; // ATLS: >30 % unconscious, >40 % death
}

// Horse wind (metres of gallop left). §10.1: 1.5–3 km gallop before blown.
// The gallop (> 7 m/s) spends it metre for metre; a canter (4.5–7) costs a quarter as much and can be held
// for kilometres (§12: "pursuing cavalry trot or canter at 4–7 m/s for kilometres"); trot and walk restore it.
export function horseStep(S, id, v, dt) {
  if (v > 7) S.hwbal[id] = Math.max(0, S.hwbal[id] - v * dt * 1.2);
  else if (v > 4.5) S.hwbal[id] = Math.max(0, S.hwbal[id] - v * dt * 0.25);
  else S.hwbal[id] = Math.min(S.hwp[id], S.hwbal[id] + (v < 1.5 ? 4 : 2.5) * dt);
}
