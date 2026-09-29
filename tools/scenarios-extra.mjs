// More calibration scenarios: §17.4 missile benchmarks and §17.3 duels (fast path).
import { buildMap, newWorld, runUntil, census } from "./scenarios.mjs";
import { addUnit, issueOrder, step, DT } from "../js/sim/world.js";
import { ST_FLEE, S_DOWN, S_DEAD } from "../js/sim/soldiers.js";
import { KIT_ID, SH_NONE, SH_HEATER } from "../js/sim/kit.js";
import { makeRng } from "../js/sim/rng.js";
import { oddsEstimate } from "../js/sim/duel.js";
import { HISTORICAL } from "./scenarios-hist.mjs";

const flat = (size = 1200) => buildMap({ size, res: Math.round(size / 10) + 1, surf: () => "short_meadow" });

// ---------------------------------------------------------------- §17.4 missiles against a standing block
// A 100 m front of close-order men stands (their morale pinned so they neither flee nor charge) while
// archers loose exactly 1,000 arrows at `range`. Returns the share of the block incapacitated.
function volleys(seed, { target, kit, shield = null, range = 175, n = 444, arrows = 1000, horses = false }) {
  const w = newWorld(flat(), seed, { legends: false });
  const T = addUnit(w, { team: 1, arm: target, count: n, x: 600, y: 600 + range, facing: Math.PI, formation: horses ? "line" : "line", depth: horses ? 2 : 4, kit });
  if (shield !== null) for (const id of T.members) { w.S.shield[id] = shield; w.S.shieldArm[id] = shield ? 1 : 0; }
  const A = addUnit(w, { team: 0, arm: "archers", count: 100, x: 600, y: 600, facing: 0, formation: "line", depth: 2, training: 0.7, ammo: 200 });
  issueOrder(w, [T.id], { immediate: true, kind: "hold", x: 600, y: 600 + range, facing: -Math.PI / 2 });
  issueOrder(w, [A.id], { immediate: true, kind: "hold", x: 600, y: 600, facing: Math.PI / 2 });
  const S = w.S; let horseEvents = 0;
  for (let k = 0; k < 3600 / DT; k++) {
    for (const id of T.members) { S.stress[id] = 0; }   // the target body is pinned in place (a measurement, not a battle)
    step(w);
    for (const e of w.events) if (e.kind === "horse" && (e.what === "down" || e.what === "bolt") && S.team[e.who] === 1) horseEvents++; // (down or bolting; a flinch is not a horse lost)
    if (w.cs.stats.arrows >= arrows) { A.holdFire = true; if (!w.cs.flights.length) break; }
  }
  const c = census(w, 1);
  const hits = w.cs.stats.arrowHits, fired = w.cs.stats.arrows;
  return { incapPer1000: (c.dead + c.mortal + c.down) / c.n * (1000 / fired), strikeShare: hits / fired, horsePer1000: horseEvents / c.n * (1000 / fired), fired };
}

// Crossbowmen without pavises against longbowmen at 150 m: who breaks first (§17.4, Crécy).
function xbowLongbow(seed) {
  const w = newWorld(flat(), seed, { legends: false });
  const X = addUnit(w, { team: 1, arm: "crossbow", count: 60, x: 600, y: 750, facing: Math.PI, formation: "line", depth: 2 });
  for (const id of X.members) w.S.pavise[id] = 0; // the pavises are with the baggage [CRECY]
  const L = addUnit(w, { team: 0, arm: "archers", count: 60, x: 600, y: 600, facing: 0, formation: "line", depth: 2 });
  issueOrder(w, [X.id], { immediate: true, kind: "hold", x: 600, y: 750, facing: -Math.PI / 2 });
  issueOrder(w, [L.id], { immediate: true, kind: "hold", x: 600, y: 600, facing: Math.PI / 2 });
  let first = -1;
  for (let k = 0; k < 1800 / DT && first < 0; k++) { step(w); if (X.c?.broken) first = 1; else if (L.c?.broken) first = 0; }
  if (first < 0) { // nobody ran: the side that suffered more is judged to have lost the exchange
    const cx = census(w, 1), cl = census(w, 0); first = (cx.dead + cx.down) / cx.n >= (cl.dead + cl.down) / cl.n ? 1 : 0;
  }
  return { xbowBrokeFirst: first === 1 ? 1 : 0 };
}

// ---------------------------------------------------------------- §17.3 duels (splitting estimator)
function odds(seed) {
  const rng = makeRng(seed * 7919 + 13);
  const mail = { arm: "spearmen", kit: KIT_ID.mail };
  const out = {};
  for (const N of [1, 2, 3, 5, 7, 10, 20]) out[N] = oddsEstimate(rng, mail, mail, N, { budget: N <= 3 ? 400 : 250, split: N >= 10 ? 3 : N >= 5 ? 2 : 1 }); // (more splitting deep in the tail: fewer zero-count estimates)
  return out;
}
function maaLevy(seed) {
  const rng = makeRng(seed * 104729 + 7);
  const maa = { arm: "menatarms", training: 0.8 }, levy = { arm: "levy", training: 0.2 };
  return { maa1: oddsEstimate(rng, maa, levy, 1, { budget: 300 }), maa3: oddsEstimate(rng, maa, levy, 3, { budget: 300 }) };
}

export const SCENARIOS = {
  // 1.2 men/m²: 0.85 m files × 1.0 m ranks (spearmen spacing), 118 files = 100 m of front, 4 deep
  missile_foot: (s) => volleys(s, { target: "spearmen", kit: KIT_ID.gambFoot, shield: SH_NONE, range: 150 + (s % 3) * 25, n: 472 }),
  missile_strike200: (s) => volleys(s, { target: "spearmen", kit: KIT_ID.gambFoot, shield: SH_NONE, range: 200, n: 472 }),
  missile_maa: (s) => volleys(s, { target: "menatarms", kit: KIT_ID.mail, shield: SH_HEATER, range: 150 + (s % 3) * 25 }),
  missile_horse: (s) => volleys(s, { target: "knights", range: 150 + (s % 3) * 25, n: 180, horses: true }),
  xbow_longbow: xbowLongbow,
  odds, maa_levy: maaLevy,
  ...HISTORICAL,
};
