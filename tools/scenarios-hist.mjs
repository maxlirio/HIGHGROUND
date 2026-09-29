// Historical benchmark battles (docs/combat-research.md §17.2), at reduced but proportional scale:
// numbers ÷20, lengths ÷√20 ≈ ÷4.5 so that densities (men per metre of front, per m²) stay historical.
// Each returns the metrics its bands need; the orders are the standing orders of the day, nothing clever.
import { buildMap, newWorld, runUntil, census } from "./scenarios.mjs";
import { addUnit, issueOrder, step, DT } from "../js/sim/world.js";
import { makeNav } from "../js/sim/path.js";
import { TERRAIN } from "../js/sim/terrain-types.js";
import { ARMS } from "../js/sim/arms.js";
import { S_DEAD, S_DOWN, W_MORTAL, ST_FLEE } from "../js/sim/soldiers.js";

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const add = (w, team, spec, face) => addUnit(w, { team, facing: face, ...spec });
const order = (w, us, o) => issueOrder(w, (Array.isArray(us) ? us : [us]).map((u) => u.id), { immediate: true, ...o });
const NORTH = Math.PI / 2, SOUTH = -Math.PI / 2;
function deaths(w, units) {
  const S = w.S, ids = new Set(units.map((u) => u.id)); let n = 0, d = 0;
  for (let i = 0; i < S.n; i++) { if (!ids.has(S.home[i])) continue; n++; if (S.state[i] === S_DEAD || (S.state[i] === S_DOWN && S.sev[i] >= W_MORTAL)) d++; }
  return { n, d, frac: d / Math.max(1, n) };
}
function pileup(w) { // ≥5 fallen within a 3×3 m patch ("walls of dead", Agincourt)
  let best = 0; const B = w.cs.bodies;
  for (const k of B.keys()) { const x = k >> 13, y = k & 8191; let s = 0; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) s += B.get(((x + i) << 13) ^ (y + j)) || 0; if (s > best) best = s; }
  return best;
}

// ---------------------------------------------------------------- Crécy (1346)
// English on a terraced slope (≈20 m above the French approach), men-at-arms dismounted in the centre, archers on
// the wings, pits in front; Genoese crossbowmen without pavises go in first, then the French horse charges uphill
// again and again.
export function crecy(seed) {
  const map = buildMap({ size: 1600, res: 321, h: (x, y) => 40 + 22 * smooth(700, 1000, y), surf: () => "short_meadow" });
  const w = newWorld(map, seed);
  w.features = [{ type: "pits_pottes", x0: 700, y0: 975, x1: 900, y1: 975, width: 6 }];
  const E = [
    add(w, 0, { arm: "menatarms", count: 125, x: 800, y: 1000, formation: "line", depth: 5 }, Math.PI),
    add(w, 0, { arm: "archers", count: 125, x: 720, y: 985, formation: "line", depth: 4, ammo: 72 }, Math.PI),
    add(w, 0, { arm: "archers", count: 125, x: 880, y: 985, formation: "line", depth: 4, ammo: 72 }, Math.PI),
  ];
  for (const u of E) order(w, u, { kind: "hold", x: u.ax, y: u.ay, facing: SOUTH });
  // veterans of the Scottish and Breton wars on ground of their choosing, the King on the windmill behind them:
  // the "elite, hold to 25–40 %" of §11.3 (unit mood −0.2 for the men-at-arms, −0.15 for the archers)
  E[0].moraleMod = -0.2; E[1].moraleMod = E[2].moraleMod = -0.15;
  const X = add(w, 1, { arm: "crossbow", count: 150, x: 800, y: 700, formation: "line", depth: 3 }, 0);
  for (const id of X.members) w.S.pavise[id] = 0; // the pavises were with the baggage
  // the French horse came up in successive "battles" as they arrived (15–16 charges): 6 conrois of 60 (7,200 ÷ 20)
  const K = [0, 1, 2, 3, 4, 5].map((k) => add(w, 1, { arm: "knights", count: 60, x: 620 + (k % 3) * 160, y: 520 - (k >> 1) * 40, formation: "line", depth: 2 }, 0));
  order(w, X, { kind: "move", x: 800, y: 830, facing: NORTH });
  for (const u of K) order(w, u, { kind: "hold", x: u.ax, y: u.ay, facing: NORTH });
  // the conrois go in one after another at the Prince's battle in the centre (the archers on the wings shoot
  // them in the flank); every one that re-forms is sent back up the slope (15–16 charges [CRECY])
  const aim = () => E[0];
  const sent = K.map(() => false);
  runUntil(w, {
    maxT: 2.5 * 3600, after: 0,
    onTick: (w) => {
      K.forEach((u, k) => { if (!sent[k] && w.time > 600 + 200 * k) { sent[k] = true; order(w, u, { kind: "assault", x: aim().ax, y: aim().ay, pace: "charge", target: aim().id }); } });
      if (w.tick % Math.round(60 / DT) === 0) K.forEach((u, k) => { if (sent[k] && u.members.length && u.c && !u.c.broken && u.order.kind === "hold" && (u.c.charges || 0) < 16) order(w, u, { kind: "assault", x: aim().ax, y: aim().ay, pace: "charge", target: aim().id }); });
    },
    done: (w) => (K.every((u) => !u.members.length || (u.c && u.c.charges >= 16) || (u.c?.broken && w.time - u.c.breakT > 900)) && w.time > 900 ? 1 : null),
  });
  const fr = deaths(w, [X, ...K]), en = deaths(w, E);
  const charges = K.reduce((s, u) => s + (u.c?.charges || 0), 0);
  return { ratio: fr.d / Math.max(1, en.d), frDead: fr.d, enDead: en.d, charges, knightsDead: deaths(w, K).frac };
}

// ---------------------------------------------------------------- Agincourt (1415)
// A 155 m defile between woods (690 m ÷ 4.5), English men-at-arms in the centre and archers behind stakes on the
// wings; the French men-at-arms, dismounted, cross ~250 m of rain-soaked ploughland in three deep columns.
export function agincourt(seed) {
  const W0 = 722, W1 = 878; // defile edges (x)
  // the land, physically: Agincourt and Tramecourt woods (canopy) close the flanks; the ploughland between
  // them falls gently from both armies to a shallow bottom, and a night of rain (the land reader's rain
  // input, 0.3) turns the badly drained ground to mud — worst in the bottom, least on the English rise
  const map = buildMap({ size: 1600, res: 321, h: (x, y) => 40 + 0.012 * Math.abs(y - 830) + (y > 830 ? 0.004 * (y - 830) : 0),
    canopy: (x, y) => (x < W0 || x > W1 ? 18 : 0), rain: 0.3,
    surf: (x, y) => (x < W0 || x > W1 ? "dense_forest" : y > 700 && y < 960 ? "mud" : "ploughed_field") });
  const w = newWorld(map, seed, { weather: "rain" });
  w.nav = makeNav(map, TERRAIN, 10);
  w.features = [
    { type: "archer_stakes", x0: W0 + 2, y0: 975, x1: 770, y1: 975, width: 3 },
    { type: "archer_stakes", x0: 830, y0: 975, x1: W1 - 2, y1: 975, width: 3 },
  ];
  const E = [
    add(w, 0, { arm: "menatarms", count: 75, x: 800, y: 990, formation: "line", depth: 4 }, Math.PI),
    add(w, 0, { arm: "archers", count: 175, x: 746, y: 988, formation: "line", depth: 4, ammo: 60 }, Math.PI),
    add(w, 0, { arm: "archers", count: 175, x: 854, y: 988, formation: "line", depth: 4, ammo: 60 }, Math.PI),
  ];
  for (const u of E) order(w, u, { kind: "hold", x: u.ax, y: u.ay, facing: SOUTH });
  const F = [0, 1, 2].map((k) => add(w, 1, { arm: "menatarms", count: 167, x: 760 + k * 40, y: 620 - k * 30, formation: "deep", depth: 10 }, 0));
  for (const u of F) order(w, u, { kind: "assault", x: 800, y: 990, pace: "march", target: E[0].id });
  runUntil(w, { maxT: 3 * 3600, after: 900, done: (w) => (F.every((u) => !u.members.length || u.c?.broken) ? 1 : E.every((u) => !u.members.length || u.c?.broken) ? 0 : null) });
  const fr = deaths(w, F), en = deaths(w, E);
  const archersMelee = E.slice(1).some((u) => u.c?.joinedMelee) ? 1 : 0;
  return { ratio: fr.d / Math.max(1, en.d), frDead: fr.d, enDead: en.d, pileup: pileup(w) >= 5 ? 1 : 0, maxPile: pileup(w), archersMelee };
}

// ---------------------------------------------------------------- Courtrai (1302)
// Flemish communal foot (goedendag and pike) drawn up behind a stream and dug ditches; the French knights
// charge across; the Flemings take no prisoners.
export function courtrai(seed) {
  // the Groeninge brook (1 m deep, 5 m wide) across a wet meadow; the Flemings on the slightly higher ground behind it
  const map = buildMap({ size: 1600, res: 321, h: (x, y) => 40 + 0.015 * Math.max(0, y - 880) - (Math.abs(y - 908) < 3 ? 1.2 : 0),
    water: (x, y) => (Math.abs(y - 908) < 2.5 ? 1.0 : 0), surf: (x, y) => (y > 905 && y < 912 ? "stream_bed" : "water_meadow") });
  const w = newWorld(map, seed);
  w.features = [
    { type: "ditch", x0: 640, y0: 930, x1: 960, y1: 930, width: 3 },
    { type: "ditch", x0: 640, y0: 950, x1: 960, y1: 950, width: 3 },
  ];
  w.noPrisoners = { 0: true };
  const Fl = [0, 1].map((k) => add(w, 0, { arm: "militia", count: 275, x: 740 + k * 120, y: 985, formation: "deep", depth: 8 }, Math.PI));
  for (const u of Fl) order(w, u, { kind: "hold", x: u.ax, y: u.ay, facing: SOUTH });
  const K = [0, 1].map((k) => add(w, 1, { arm: "knights", count: 75, x: 740 + k * 120, y: 700, formation: "line", depth: 2 }, 0));
  for (const [k, u] of K.entries()) order(w, u, { kind: "assault", x: Fl[k].ax, y: Fl[k].ay, pace: "charge", target: Fl[k].id });
  // (counted per rider: of the riders who reached the obstacles or the line, the share whose horse refused or fell)
  const stopped = new Set(), reached = new Set(); let counter = false;
  runUntil(w, {
    maxT: 1.5 * 3600, after: 600,
    onTick: (w) => {
      for (const e of w.events) { if (e.kind === "refuse" || (e.kind === "horse" && e.what === "down" && e.by < 0)) { stopped.add(e.who); reached.add(e.who); } else if (e.kind === "impact") reached.add(e.who); }
      // when the charge has broken on the ditches, the Flemish line goes forward over them and falls on the
      // knights floundering between the obstacles and the brook
      if (!counter && K.every((u) => !u.members.length || u.c?.broken || (u.c && (u.c.phase === "melee" || u.c.phase === "recoil" || u.c.phase === "rest")))) { // (the whole charge, not its first conroi: going out while horse is still coming on is how foot are ridden down)
        counter = true;
        Fl.forEach((u, k) => order(w, u, { kind: "assault", x: K[k].ax, y: K[k].ay, pace: "quick", target: K[k].id }));
      }
    },
    done: (w) => (K.every((u) => !u.members.length || u.c?.broken || (u.c && u.c.charges >= 8)) && w.time > 600 ? 1 : null),
  });
  const kd = deaths(w, K);
  return { knightsDead: kd.frac, refuseOrFall: stopped.size / Math.max(1, reached.size), flemDead: deaths(w, Fl).frac };
}

// ---------------------------------------------------------------- Stirling Bridge (1297)
// A 3 m bridge (two abreast) over a 30 m river; ~450 English (9,000 ÷ 20), ~100 of them across and forming
// when the Scots come down on the bridgehead; the rest are ordered over the bridge to support it.
export function stirling(seed) {
  const RIVER0 = 1000, RIVER1 = 1030, BX = 800;
  const onBridge = (x, y) => Math.abs(x - BX) < 1.6 && y > RIVER0 - 2 && y < RIVER1 + 2;
  const map = buildMap({ size: 1600, res: 801, water: (x, y) => (y > RIVER0 && y < RIVER1 && !onBridge(x, y) ? 2.2 : 0),
    surf: (x, y) => (y > RIVER0 && y < RIVER1 && !onBridge(x, y) ? "deep_water" : "short_meadow") });
  const w = newWorld(map, seed);
  w.nav = makeNav(map, TERRAIN, 2);
  w.homeDir = [[0, -1], [0, 1]]; // the English home is back across the bridge (south); the Scots north
  const head = add(w, 0, { arm: "spearmen", count: 100, x: BX, y: 1060, formation: "line", depth: 4 }, 0);
  const far = [0, 1, 2].map((k) => add(w, 0, { arm: "spearmen", count: 117, x: BX - 60 + k * 60, y: 930, formation: "line", depth: 4 }, 0));
  order(w, head, { kind: "hold", x: BX, y: 1060, facing: NORTH });
  const Sc = [0, 1].map((k) => add(w, 1, { arm: "spearmen", count: 150, x: BX - 60 + k * 120, y: 1190, formation: "deep", depth: 6 }, Math.PI));
  // a third body of spearmen runs down the causeway to seize the bridge-end (Wallace's plan)
  const Bridge = add(w, 1, { arm: "spearmen", count: 80, x: BX + 60, y: 1085, formation: "column" }, Math.PI);
  for (const u of [...Sc, Bridge]) order(w, u, { kind: "hold", x: u.ax, y: u.ay, facing: SOUTH });
  let attacked = false, crossed = 0; const counted = new Set();
  runUntil(w, {
    maxT: 1.2 * 3600, after: 600,
    onTick: (w) => {
      if (!attacked && w.time > 120) {
        attacked = true;
        for (const u of Sc) order(w, u, { kind: "assault", x: BX, y: 1060, pace: "quick", target: head.id });
        order(w, Bridge, { kind: "move", x: BX + 4, y: 1036, pace: "quick", formation: "deep", facing: SOUTH });
      }
      // the English commander on the far bank sends his men over when word reaches him (§13: ~90 s)
      if (attacked && !w.sentOver && w.time > 210) { w.sentOver = true; for (const u of far) order(w, u, { kind: "move", x: BX, y: 1070, formation: "file2", pace: "quick" }); }
      if (attacked && (w.tick & 7) === 0) for (const u of far) for (const id of u.members) if (!counted.has(id) && w.S.alive[id] && w.S.y[id] > RIVER1 + 3) { counted.add(id); crossed++; }
    },
    done: (w) => (!head.members.length || head.c?.broken ? 0 : null),
  });
  const S = w.S; let lost = 0, n = 0;
  for (let i = 0; i < S.n; i++) if (S.home[i] === head.id) { n++; if (S.state[i] === S_DEAD || (S.state[i] === S_DOWN && S.sev[i] >= W_MORTAL) || S.state[i] === 8) lost++; }
  const drowned = w.rec.deaths.filter((d) => d.cause === "drown").length;
  return { bridgeheadLost: lost / Math.max(1, n), reinforced: crossed / far.reduce((s, u) => s + u.c.n0, 0), drowned };
}

// ---------------------------------------------------------------- Bannockburn (1314)
// Scottish schiltrons on firm ground between woods; the English heavy horse charges them, fails, the English
// foot behind is pushed back into the carse with the Bannock burn at its back.
export function bannockburn(seed) {
  const BURN0 = 640, BURN1 = 660;
  // the ground rises gently from the burn (the carse) to the New Park where the Scots stand; woods on both flanks
  // the carse is a pocket: the Bannock burn behind the English and the Pelstream and the Forth's pows closing
  // its sides — steep-banked water on three sides (the ground itself is the trap; nothing is scripted)
  const burn = (x, y) => (y > BURN0 && y < BURN1 && x > 590 && x < 1010) || (y > BURN0 && y < 780 && ((x > 600 && x < 620) || (x > 980 && x < 1000)));
  const map = buildMap({ size: 1600, res: 321, h: (x, y) => 40 + 0.025 * Math.max(0, y - 600), water: (x, y) => (burn(x, y) ? 1.6 : 0),
    canopy: (x, y) => (x < 600 || x > 1000 ? 16 : 0),
    surf: (x, y) => (burn(x, y) ? "deep_water" : x < 600 || x > 1000 ? "dense_forest" : y < 760 ? "water_meadow" : "short_meadow") });
  const w = newWorld(map, seed);
  w.homeDir = [[0, -1], [0, 1]]; // the English flee south, across the burn
  const Sc = [0, 1, 2].map((k) => add(w, 1, { arm: "pikemen", count: 150, x: 680 + k * 120, y: 1000, formation: "schiltron" }, Math.PI));
  for (const u of Sc) order(w, u, { kind: "hold", x: u.ax, y: u.ay, facing: SOUTH });
  const K = [0, 1].map((k) => add(w, 0, { arm: "knights", count: 75, x: 720 + k * 160, y: 820, formation: "line", depth: 2 }, 0));
  // the English foot, crowded onto the carse between the burns (their archers were never properly deployed)
  const Inf = [0, 1].map((k) => add(w, 0, { arm: k ? "spearmen" : "levy", count: 150, x: 740 + k * 120, y: 720, formation: "line", depth: 4 }, 0));
  for (const u of Inf) order(w, u, { kind: "hold", x: u.ax, y: u.ay, facing: NORTH });
  for (const [k, u] of K.entries()) order(w, u, { kind: "assault", x: Sc[k + (k ? 1 : 0)].ax, y: Sc[k + (k ? 1 : 0)].ay, pace: "charge", target: Sc[k + (k ? 1 : 0)].id });
  let advanced = false, schiltronBroke = 0;
  runUntil(w, {
    maxT: 2 * 3600, after: 1200,
    onTick: (w) => {
      if (!advanced && Sc.some((u) => u.c?.broken)) schiltronBroke = 1;
      // once the horse is spent or recoiled twice, the schiltrons advance with levelled pikes
      if (!advanced && w.time > 300 && (w.time > 900 || K.every((u) => !u.members.length || u.c?.broken || u.c?.breaks || (u.c?.charges || 0) >= 3))) {
        advanced = true;
        for (const u of Sc) if (u.members.length && !u.c?.broken) order(w, u, { kind: "assault", x: 800, y: 720, pace: "march" }); // advancing in their schiltrons
      }
      // when the English foot breaks, the Scots come on down to the water after it
      if (advanced && !w.pressed && Inf.every((u) => !u.members.length || u.c?.broken)) { w.pressed = true; for (const u of Sc) if (u.members.length && !u.c?.broken) order(w, u, { kind: "assault", x: 800, y: 670, pace: "quick", formation: "deep" }); }
    },
    done: (w) => (Inf.every((u) => !u.members.length || u.c?.broken) ? 0 : Sc.every((u) => !u.members.length || u.c?.broken) ? 1 : null),
  });
  return { chargesFailed: schiltronBroke ? 0 : 1, infLoss: deaths(w, Inf).frac, drowned: w.rec.deaths.filter((d) => d.cause === "drown").length };
}

export const HISTORICAL = { crecy, agincourt, courtrai, stirling, bannockburn };
