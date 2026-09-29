// Area awareness: a line ordered straight through a building should wrap round it, not press flat against it.
import { makeMap } from "../js/sim/map.js";
import { createWorld, addUnit, issueOrder, step } from "../js/sim/world.js";
import { makeObstacles, addRect, obstacleSystem } from "../js/sim/obstacles.js";
for (const fix of [false, true]) {
  const res = 101, map = makeMap({ size: 1000, res, height: new Float32Array(res * res).map((_, k) => 50 + Math.sin(k) * 0.2) });
  const w = createWorld({ map, seed: 3 }); w.noSlotFix = !fix;
  w.obstacles = makeObstacles(); addRect(w.obstacles, 500, 500, 0, 15, 7); w.systems.push(obstacleSystem);
  const u = addUnit(w, { team: 0, arm: "archers", count: 24, x: 500, y: 430, formation: "line" });
  issueOrder(w, [u.id], { kind: "hold", x: 500, y: 502, facing: Math.PI / 2, formation: "line", immediate: true });
  for (let t = 0; t < 1500; t++) step(w);
  let pinned = 0, inside = 0, sep = 0;
  const S = w.S;
  for (const id of u.members) {
    const dx = Math.abs(S.x[id] - 500) - 15, dy = Math.abs(S.y[id] - 500) - 7, d = Math.max(dx, dy);
    if (d < 0) inside++; else if (d < 0.7) pinned++;
  }
  for (const a of u.members) for (const b of u.members) if (a < b && Math.hypot(S.x[a] - S.x[b], S.y[a] - S.y[b]) < 0.55) sep++;
  console.log(`${fix ? "with fix   " : "without fix"}: pressed against the wall ${pinned}/24, inside ${inside}, overlapping pairs ${sep}`);
}
{
  const res = 101, map = makeMap({ size: 1000, res, height: new Float32Array(res * res).map((_, k) => 50 + Math.sin(k) * 0.2) });
  const w = createWorld({ map, seed: 3 });
  w.obstacles = makeObstacles(); addRect(w.obstacles, 500, 500, 0, 15, 7); w.systems.push(obstacleSystem);
  const u = addUnit(w, { team: 0, arm: "archers", count: 24, x: 500, y: 430, formation: "line" });
  issueOrder(w, [u.id], { kind: "hold", x: 500, y: 502, facing: Math.PI / 2, formation: "line", immediate: true });
  for (let t = 0; t < 1500; t++) step(w);
  const S = w.S;
  console.log("anchor", u.ax.toFixed(1), u.ay.toFixed(1), "facing", u.facing.toFixed(2), "path", JSON.stringify(u.path));
  for (const id of u.members) { const dx = Math.abs(S.x[id] - 500) - 15, dy = Math.abs(S.y[id] - 500) - 7, d = Math.max(dx, dy); if (d < 0.7) console.log(" man", S.x[id].toFixed(1), S.y[id].toFixed(1), "slot", S.slotX[id].toFixed(1), S.slotY[id].toFixed(1), "state", S.state[id]); }
}
