// Ranked Battle: the rules both the realm's server (server/ranked.mjs) and the game (js/ui/ranked.js) keep.
// An army is a list [[arm, men]…] (js/sim/battlefield.js TROOPS: the arms a pitched battle fields). Its worth is its
// day's wages in pence. Spoils buy men at a penny of spoils per penny of wage, five at a time.
import { TROOPS, MIX } from "./battlefield.js";
import { DISPOSITIONS } from "./legend.js";

export const START_RATING = 1000;
export const STARTER = [["levy", 40], ["spearmen", 30], ["archers", 20]]; // a small shire muster: 160 d a day
export const BUY_STEP = 5;
export const ARMY_MAX = 900; // men (js/sim/battlefield.js HOST_MAX: more would not fit the field)

export const armyValue = (army) => (army || []).reduce((s, [a, n]) => s + (TROOPS[a]?.wage || 0) * n, 0);
export const armyMen = (army) => (army || []).reduce((s, [, n]) => s + n, 0);
export const buyCost = (arm, n = BUY_STEP) => (TROOPS[arm]?.wage || 0) * n;
export const ARMS_FOR_SALE = Object.keys(TROOPS);

// a clean army: known arms, whole men, merged, nothing empty, within the field's size
export function tidyArmy(army) {
  const m = new Map();
  for (const e of Array.isArray(army) ? army : []) { const [a, n] = e || []; if (TROOPS[a] && Number.isFinite(n) && n > 0) m.set(a, (m.get(a) || 0) + Math.floor(n)); }
  return [...m].map(([a, n]) => [a, Math.min(n, TROOPS[a].max)]);
}

// a bot's army worth `pence` a day, mixed by its commander's temper (shares of the wage bill, in fives)
export function composeArmy(pence, temper, rng = Math.random) {
  const mix = MIX[temper] || MIX.inspiring, out = [];
  for (const [arm, f] of Object.entries(mix)) {
    const T = TROOPS[arm]; const n = Math.round(pence * f * (0.85 + rng() * 0.3) / T.wage / BUY_STEP) * BUY_STEP;
    if (n > 0) out.push([arm, Math.min(n, T.max)]);
  }
  // …too dear (five knights are 120 d a day): shed the dearest arm, five at a time
  for (let k = 0; k < 400 && out.length && out.reduce((s, [a, n]) => s + TROOPS[a].wage * n, 0) > pence * 1.08; k++) {
    out.sort((a, b) => TROOPS[b[0]].wage - TROOPS[a[0]].wage); out[0][1] -= BUY_STEP; if (out[0][1] <= 0) out.shift();
  }
  // rounding leaves a small host short: fill it with the mix's own arms, cheapest first, up to its worth
  const arms = Object.keys(mix).sort((a, b) => TROOPS[a].wage - TROOPS[b].wage);
  for (let k = 0; k < 400; k++) {
    const left = pence - out.reduce((s, [a, n]) => s + TROOPS[a].wage * n, 0);
    const arm = arms[k % arms.length]; if (left < TROOPS[arms[0]].wage * BUY_STEP) break;
    if (TROOPS[arm].wage * BUY_STEP > left) continue;
    const e = out.find((q) => q[0] === arm); if (e) e[1] += BUY_STEP; else out.push([arm, BUY_STEP]);
  }
  if (!out.length) out.push(["levy", Math.max(BUY_STEP, Math.round(pence / BUY_STEP) * BUY_STEP)]);
  return out;
}

// Elo: the chance A beats B, and the new rating after a result (1 win, 0.5 draw, 0 loss)
export const expected = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));
export const rated = (ra, rb, score, k = 32) => Math.round(ra + k * (score - expected(ra, rb)));

// spoils of the day: a win takes a share of what the beaten host was worth; a loss or a draw still pays a little
export function spoilsFor(outcome, myArmy, foeArmy) {
  const foe = armyValue(foeArmy), mine = armyValue(myArmy);
  if (outcome === "win") return Math.round(30 + foe * 0.35 + Math.max(0, foe - mine) * 0.25); // (beating a bigger host pays more)
  if (outcome === "draw") return Math.round(15 + foe * 0.1);
  return Math.round(10 + foe * 0.05);
}

// how a commander fights, learned from his orders in ranked battles (counts), and the temper nearest it
export const NO_STYLE = { attack: 0, hold: 0, flank: 0, missile: 0, ambush: 0, charge: 0, n: 0 };
export function mergeStyle(old, add, keep = 0.8) { // (an exponential memory: recent battles weigh most)
  const o = { ...NO_STYLE, ...(old || {}) }, a = { ...NO_STYLE, ...(add || {}) }, out = {};
  for (const k of Object.keys(NO_STYLE)) out[k] = k === "n" ? o.n + 1 : o[k] * keep + a[k] * (1 - keep) * (o.n ? 1 : 1 / (1 - keep));
  return out;
}
export function temperOf(style) {
  const s = { ...NO_STYLE, ...(style || {}) }, tot = s.attack + s.hold + s.flank + s.missile + s.ambush + s.charge;
  if (!s.n || tot < 1) return "inspiring";
  const f = (k) => s[k] / tot;
  const me = { aggression: f("attack") + f("charge"), flank: f("flank"), hold: f("hold"), missile: f("missile"), ambush: f("ambush"), charge: f("charge") };
  const fit = {
    defensive: me.hold * 2 - me.aggression, aggressive: me.aggression * 1.6 - me.hold, flanker: me.flank * 2.2, skirmish: me.missile * 1.8 - me.charge,
    ambusher: me.ambush * 3, shock: me.charge * 2.4, inspiring: 0.35,
  };
  return Object.entries(fit).sort((a, b) => b[1] - a[1])[0][0];
}
export const temperName = (t) => DISPOSITIONS[t]?.name || t;
