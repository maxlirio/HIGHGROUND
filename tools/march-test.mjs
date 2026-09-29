// Can an army cross the vale? Orders the lord's retinue (and, with --all, every body of men) from Ashby
// toward Rookham and prints how far each unit still has to go every 5 minutes; a unit whose anchor has
// not moved for 2 minutes while it still has a path is reported as STALLED, with what is under its feet
// (going here and 3 m ahead, water depth, the combat going hook). Hedges/fences come from the map
// exactly as in the browser; --no-obstacles drops them (and trunks) to separate the causes.
//   node tools/march-test.mjs [--minutes 40] [--pace march|quick] [--no-obstacles] [--seed 1]
import { setup } from "./playtest.mjs";
import { step, issueOrder, goingMul } from "../js/sim/world.js";
import { ARMS } from "../js/sim/arms.js";
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : process.argv[i + 1] ?? true; };
const MIN = +arg("minutes", 40), PACE = arg("pace", "march");
const { w } = await setup(+arg("seed", 1), { obstacles: !process.argv.includes("--no-obstacles") });
const F = w.teams[1].town, goal = { x: F.x - 300, y: F.y - 300 };
const us = [...w.units.values()].filter((u) => u.team === 0 && !u.isWorkers);
for (let t = 0; t < 30; t++) step(w); // (as in the game: the map's hedges reach the nav grid on the first combat passes)
for (const u of us) issueOrder(w, [u.id], { kind: "move", x: goal.x, y: goal.y, pace: PACE });
const last = new Map(us.map((u) => [u.id, { x: u.ax, y: u.ay, t: 0, stalled: false }]));
for (let t = 1; t <= MIN * 600; t++) {
  step(w);
  if (t % 100) continue;
  for (const u of us) {
    const r = last.get(u.id);
    if (Math.hypot(u.ax - r.x, u.ay - r.y) > 3 || !u.path) { Object.assign(r, { x: u.ax, y: u.ay, t, stalled: false }); continue; }
    if (t - r.t >= 1200 && !r.stalled) {
      r.stalled = true;
      const [px, py] = u.path[0], dx = px - u.ax, dy = py - u.ay, d = Math.hypot(dx, dy) || 1, A = ARMS[u.arm], ax = u.ax + dx / d * 3, ay = u.ay + dy / d * 3;
      const cls = A.mounted ? "cavalry" : A.armour >= 4 ? "heavyFoot" : "foot";
      console.log(`STALLED ${(t / 600).toFixed(1)} min: ${u.arm}×${u.members.length} at (${u.ax.toFixed(0)},${u.ay.toFixed(0)}), next waypoint ${d.toFixed(0)} m; going here ${goingMul(w, A.id, u.ax, u.ay, dx, dy).toFixed(3)}, 3 m ahead ${goingMul(w, A.id, ax, ay, dx, dy).toFixed(4)} (water ${w.map.water(ax, ay).toFixed(2)} m, slope ${Math.hypot(...w.map.grad(ax, ay)).toFixed(2)}, feature hook ${w.goingHook ? w.goingHook(ax, ay, cls).toFixed(4) : "-"})`);
    }
  }
  for (const u of us) { const r = last.get(u.id); r.walked = (r.walked || 0) + Math.hypot(u.ax - (r.lx ?? u.ax), u.ay - (r.ly ?? u.ay)); r.lx = u.ax; r.ly = u.ay; if (!u.path && r.walked > 50 && !r.doneT) r.doneT = t; }
  if (t % 3000 === 0) console.log(`${t / 600} min: ` + us.map((u) => `${u.arm} ${Math.hypot(u.ax - goal.x, u.ay - goal.y) | 0} m (${toGo(u) | 0} m by the road)${u.path ? "" : " (arrived)"}`).join(", "));
}
// the road still to walk (the straight-line figure above understates a route round by the fords)
function toGo(u) { let d = 0, x = u.ax, y = u.ay; for (const [px, py] of u.path || []) { d += Math.hypot(px - x, py - y); x = px; y = py; } return d; }
console.log("mean speed along the route: " + us.map((u) => { const r = last.get(u.id); return `${u.arm} ${(r.walked / ((r.doneT || MIN * 600) * 0.1)).toFixed(2)} m/s over ${r.walked | 0} m${r.doneT ? `, arrived ${(r.doneT / 600).toFixed(1)} min` : ""}`; }).join(", "));
