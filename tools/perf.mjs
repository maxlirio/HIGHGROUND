// Performance check: a 3,000-soldier battle, fully engaged, must step in < 6 ms per tick (node, M4).
//   node tools/perf.mjs [soldiersPerSide=1500] [ticks=600]
//   node tools/perf.mjs castle [ticks=300]   a castle storm: 600 defenders on the walls and at two breaches, 1,500
//                                            attackers at the breaches and up six ladders (tools/castle-test.mjs perfCastle)
import { buildMap, newWorld } from "./scenarios.mjs";
if (process.argv[2] === "castle") {
  const { perfCastle } = await import("./castle-test.mjs"), { step: st, DT: dt } = await import("../js/sim/world.js");
  const { w } = perfCastle(), S = w.S, ticks = +(process.argv[3] || 300);
  for (let k = 0; k < Math.round(45 / dt); k++) st(w);
  const t0 = performance.now(), c0 = process.cpuUsage(); let f = 0;
  for (let j = 0; j < ticks; j++) { st(w); if (j % 30 === 0) { let n = 0; for (let i = 0; i < S.n; i++) if (S.alive[i] && S.state[i] === 2) n++; f = Math.max(f, n); } }
  const wall = (performance.now() - t0) / ticks, cu = process.cpuUsage(c0), ms = Math.min(wall, (cu.user + cu.system) / 1000 / ticks);
  let up = 0; for (let i = 0; i < S.n; i++) if (S.alive[i] && S.lvl[i]) up++;
  console.log(`castle storm: soldiers ${S.n}, on levels ${up}, in melee (peak) ${f}`);
  console.log(`step: ${ms.toFixed(2)} ms/tick CPU (wall ${wall.toFixed(2)} ms)   budget 6 ms → ${ms < 6 ? "PASS" : "FAIL"}`);
  process.exit(ms < 6 ? 0 : 1);
}
import { addUnit, issueOrder, step, DT } from "../js/sim/world.js";
import { combatSystem } from "../js/sim/combat.js";

const perSide = +(process.argv[2] || 1500), ticks = +(process.argv[3] || 600);
const map = buildMap({ size: 2400, res: 241 });
const w = newWorld(map, 7, { legends: true });
// wrap the combat system to time it separately
const ci = w.systems.indexOf(combatSystem);
let tCombat = 0;
w.systems[ci] = (w) => { const t0 = performance.now(); combatSystem(w); tCombat += performance.now() - t0; };
const kinds = [["spearmen", 0.55], ["menatarms", 0.2], ["pikemen", 0.1], ["archers", 0.15]];
const mk = (team, y, face) => {
  const us = []; let x = 1200 - perSide / 4 * 0.9 * 0.5;
  for (const [arm, f] of kinds) {
    const n = Math.round(perSide * f), parts = Math.max(1, Math.round(n / 250));
    for (let p = 0; p < parts; p++) { const c = Math.round(n / parts); us.push(addUnit(w, { team, arm, count: c, x, y: arm === "archers" ? y - (face ? -30 : 30) : y, facing: face, formation: "line" })); x += c / 4 * 0.95 + 6; }
  }
  return us;
};
const A = mk(0, 1150, 0), B = mk(1, 1260, Math.PI);
issueOrder(w, A.filter((u) => u.arm !== "archers").map((u) => u.id), { immediate: true, kind: "assault", x: 1200, y: 1260 });
issueOrder(w, B.filter((u) => u.arm !== "archers").map((u) => u.id), { immediate: true, kind: "assault", x: 1200, y: 1150 });
// advance until most of the fronts are in contact
let k = 0;
for (; k < 3000; k++) { step(w); if (w.cs && [...w.units.values()].filter((u) => u.hold).length >= w.units.size * 0.6) break; }
let alive = 0; for (let i = 0; i < w.S.n; i++) if (w.S.alive[i]) alive++;
tCombat = 0; const t0 = performance.now(), c0 = process.cpuUsage();
let engagedMax = 0;
for (let j = 0; j < ticks; j++) { step(w); if (j % 50 === 0) { let e = 0; for (let i = 0; i < w.S.n; i++) if (w.S.alive[i] && w.S.state[i] === 2) e++; engagedMax = Math.max(engagedMax, e); } }
const wall = (performance.now() - t0) / ticks, cu = process.cpuUsage(c0), cpu = (cu.user + cu.system) / 1000 / ticks;
// On a busy machine wall time includes waiting for a core; CPU time is what the tick costs.
const ms = Math.min(wall, cpu);
alive = 0; for (let i = 0; i < w.S.n; i++) if (w.S.alive[i]) alive++;
console.log(`soldiers ${w.S.n} (alive ${alive}), contact after ${(k * DT / 60).toFixed(1)} battle-min, in melee (peak) ${engagedMax}`);
console.log(`step: ${ms.toFixed(2)} ms/tick CPU (wall ${wall.toFixed(2)} ms; combat ${(tCombat / ticks).toFixed(2)} ms wall)   budget 6 ms → ${ms < 6 ? "PASS" : "FAIL"}`);
process.exitCode = ms < 6 ? 0 : 1;
