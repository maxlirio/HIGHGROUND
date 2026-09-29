// The ?mode=battle pitched battle, headless: the vale as main.js loads it, the two hosts main.js draws up
// ~600 m apart, Red fought by commandBattle every tick. Blue is either left alone (a PASSIVE player: nobody
// touches it) or fought by a second commandBattle. Prints a line a minute and a verdict: when the lines
// met, when the battle was decided, the dead.
//   node tools/battle-mode.mjs [--blue passive|<disposition>] [--red aggressive] [--seed 1] [--minutes 30]
import { setup } from "./playtest.mjs";
import { step, addUnit, DT } from "../js/sim/world.js";
import { commandBattle } from "../js/sim/commander-ai.js";
import * as EC from "../js/sim/economy.js";
import { ARMS } from "../js/sim/arms.js";
import { ST_FLEE } from "../js/sim/soldiers.js";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : process.argv[i + 1] ?? d; };
const BLUE = arg("blue", "passive"), RED = arg("red", "aggressive"), MIN = +arg("minutes", 30), SEED = +arg("seed", 1);
const { w, V } = await setup(SEED, { obstacles: true });
for (const [id, u] of [...w.units.entries()]) { if (u.isWorkers) continue; for (const m of u.members) { w.S.alive[m] = 0; w.S.state[m] = EC.S_GONE; } w.units.delete(id); }
const P = { x: 800, y: 1300 }, E = { x: 800, y: 1900 }, ang = Math.atan2(E.y - P.y, E.x - P.x);
const host = (team, c, face, list) => {
  const rx = -Math.sin(face), ry = Math.cos(face), fx = Math.cos(face), fy = Math.sin(face), ids = new Set();
  for (const [arm, count, side, fwd, formation] of list) {
    const u = addUnit(w, { team, arm, count, x: c.x + rx * side + fx * fwd, y: c.y + ry * side + fy * fwd, facing: face - Math.PI / 2, formation, training: arm === "levy" ? 0.25 : undefined });
    u.supply = { food: 1e7, arrows: 1e5, carts: 0, packhorses: 0 }; u.battleHost = true; ids.add(u.id);
  }
  return ids;
};
const blue = host(0, P, ang, [["spearmen", 80, 0, 0, "line"], ["menatarms", 30, 55, 0, "deep"], ["levy", 60, -60, 0, "line"],
  ["archers", 40, 95, 8, "loose"], ["archers", 40, -100, 8, "loose"], ["knights", 14, 0, -45, "wedge"], ["hobelars", 20, 120, -40, "line"]]);
const red = host(1, E, ang + Math.PI, [["spearmen", 80, 0, 0, "line"], ["pikemen", 40, 55, 0, "deep"], ["menatarms", 30, -55, 0, "deep"],
  ["crossbow", 35, 100, 8, "loose"], ["levy", 60, -110, 0, "line"], ["knights", 16, 30, -45, "wedge"], ["hobelars", 25, -130, -40, "line"]]);
w.teams[0].hq = { x: P.x - Math.cos(ang) * 60, y: P.y - Math.sin(ang) * 60 };
w.teams[1].hq = { x: E.x + Math.cos(ang) * 60, y: E.y + Math.sin(ang) * 60 };
const cmds = [{ team: 1, units: red, disposition: RED, V }];
if (BLUE !== "passive") cmds.push({ team: 0, units: blue, disposition: BLUE, V });
w.systems.push((w) => { for (const c of cmds) commandBattle(w, c); });

const isFoot = (u) => u && !ARMS[u.arm].missile && !ARMS[u.arm].mounted && !u.isWorkers;
let met = -1, decided = -1, loser = -1;
const count = () => { const n = [0, 0], f = [0, 0]; for (let i = 0; i < w.S.n; i++) { if (!w.S.alive[i]) continue; const u = w.units.get(w.S.unit[i]); if (!u || u.isWorkers) continue; n[w.S.team[i]]++; if (w.S.status[i] === ST_FLEE) f[w.S.team[i]]++; } return { n, f }; };
const n0 = count().n;
for (let k = 1; k <= MIN * 60 / DT; k++) {
  step(w);
  if (met < 0 && [...w.units.values()].some((u) => u.hold && isFoot(u) && u.battleHost)) met = w.time;
  if (k % Math.round(10 / DT)) continue;
  if (decided < 0) for (const tm of [0, 1]) {
    const us = [...w.units.values()].filter((u) => u.team === tm && u.battleHost && isFoot(u) && u.members.length);
    if (!us.length || us.every((u) => u.c?.broken)) { decided = w.time; loser = tm; }
  }
  if (k % Math.round(60 / DT) === 0) {
    const { n, f } = count();
    const us = [...w.units.values()].filter((u) => u.battleHost && u.members.length).map((u) => `${u.team ? "R" : "B"}${u.arm.slice(0, 4)}${u.members.length}${u.c?.broken ? "!" : ""}:${u.order.kind[0]}${u.hold ? "H" : ""}`).join(" ");
    const cen = (t) => { let y = 0, m = 0; for (const u of w.units.values()) if (u.team === t && u.battleHost && isFoot(u) && u.members.length) { y += u.ay * u.members.length; m += u.members.length; } return m ? Math.round(y / m) : 0; };
    if (process.env.DBGB) console.log("   B", JSON.stringify({ ...cmds[0].battle, layout: undefined, plug: undefined, plugged: undefined, committed: undefined }));
    if (process.env.DBG) for (const u of w.units.values()) if (u.team === 1 && u.battleHost) console.log(`   ${u.arm} ord ${JSON.stringify(u.order).slice(0, 120)} path ${JSON.stringify(u.path)?.slice(0, 80)} hold ${u.hold} sm ${u.speedMul} pending ${!!u.pendingOrder} @${u.ax.toFixed(0)},${u.ay.toFixed(0)} mtgt ${u.c?.mtgt?.arm}`);
    console.log(`${(w.time / 60).toFixed(0).padStart(3)} min  gap ${cen(1) - cen(0)} m  blue ${n[0]} (${f[0]} fl)  red ${n[1]} (${f[1]} fl)  red:${cmds[0].battle?.phase} | ${us}`);
  }
  if (decided >= 0 && w.time > decided + 180) break;
}
const { n } = count();
console.log(`\nRed ${RED} vs Blue ${BLUE}, seed ${SEED}: lines met ${met < 0 ? "never" : (met / 60).toFixed(1) + " min"}; decided ${decided < 0 ? "no" : (decided / 60).toFixed(1) + " min (" + (loser ? "Red" : "Blue") + " broke)"}; down: blue ${n0[0] - n[0]}/${n0[0]}, red ${n0[1] - n[1]}/${n0[1]}`);
