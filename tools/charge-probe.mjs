// Charge probe: 40 knights charge a body of foot on open ground. Prints a 5-s timeline of what the charge does:
// the conroi's phase, impacts / ridden-through / refusals, the foot knocked down / killed / fled, how far the struck
// men were driven, and how much the foot still looks like a formation (mean metres from their slot).
//   node tools/charge-probe.mjs [archers|spearmen|menatarms|pikemen|levy] [--formation deep|line|schiltron|loose] [--count 200] [--seed 1] [--secs 180]
import { buildMap, newWorld } from "./scenarios.mjs";
import { addUnit, issueOrder, step, DT } from "../js/sim/world.js";
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : process.argv[i + 1]; };
const foot = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "archers";
const SEED = +arg("seed", 1), SECS = +arg("secs", 180);
const map = buildMap({ size: 1200, res: 121 });
const w = newWorld(map, SEED);
const FORM = arg("formation", foot === "archers" ? "line" : "deep");
const F = addUnit(w, { team: 0, arm: foot, count: foot === "archers" ? 120 : +arg("count", 200), formation: FORM, x: 600, y: 500, facing: 0 });
const K = addUnit(w, { team: 1, arm: "knights", count: 40, formation: "line", depth: 2, x: 600, y: 850, facing: Math.PI });
issueOrder(w, [F.id], { immediate: true, kind: "hold", x: 600, y: 500, facing: Math.PI / 2 });
issueOrder(w, [K.id], { immediate: true, kind: "assault", x: 600, y: 500, pace: "charge", target: F.id });
const S = w.S, start = new Map(F.members.map((i) => [i, [S.x[i], S.y[i]]]));
let downs = 0, kills = 0, horseDowns = 0, tramples = 0, maxDrive = 0;
const n0 = F.members.length;
for (let k = 0; k <= SECS / DT; k++) {
  step(w);
  for (const e of w.events) {
    if (e.kind === "down" && S.team[e.victim ?? e.who] === 0) downs++;
    if ((e.kind === "kill" || e.kind === "die") && S.team[e.victim] === 0) kills++;
  }
  if (k % Math.round(5 / DT) === 0) {
    let fled = 0, down = 0, alive = 0, slotOff = 0, drive = 0, riders = 0, ahead = 0, fightK = 0;
    for (const i of F.members) { if (!S.alive[i]) continue; alive++; if (S.status[i] === 3 || S.status[i] === 4) fled++; if (S.posture[i]) down++; slotOff += Math.hypot(S.x[i] - S.slotX[i], S.y[i] - S.slotY[i]); const s0 = start.get(i); drive = Math.max(drive, Math.hypot(S.x[i] - s0[0], S.y[i] - s0[1])); }
    for (const i of K.members) { if (!S.alive[i]) continue; riders++; if (S.y[i] < F.ay) ahead++; if (S.state[i] === 2) fightK++; }
    const c = K.c || {};
    console.log(`t${String(Math.round(w.time)).padStart(4)}s knights ${riders} ${String(c.phase).padEnd(8)} charges ${c.charges ?? 0} impacts ${c.impacts ?? 0} through ${c.rodeThrough ? "Y" : "-"} refused ${c.refused ?? 0} fightingK ${fightK} beyond ${ahead} | ${foot} alive ${alive}/${n0} down ${down} fled ${fled} slotOff ${(slotOff / Math.max(1, alive)).toFixed(1)}m maxDriven ${drive.toFixed(1)}m broken ${F.c?.broken ? "Y" : "-"}`);
  }
}
