// Castle / level-system harness (docs/castle-plan.md §1, js/sim/castle.js). Headless, PASS/FAIL per check:
//   1 a man walks up a tower stair to the wall-walk and along it
//   2 men on different levels never melee; men at a ladder head do
//   3 a unit ordered to man a stretch of wall lines it
//   4 a breach becomes passable (and the walk over it is cut)
//   5 a shut gate blocks; an opened one passes
//   6 men ordered to the keep route there through the gate and up the forebuilding stair
//   7 perf: 600 defenders on the walls, 1,500 attackers storming a breach — ms per tick
//   8 every layout builds (hill, concentric, river): parts, walkways, links, one bailey
//   9 routed men on the walls come down
//  10 archers ordered to a tower top reach it (level 2, no more than it holds; the rest on the stair / walk) and shoot
//  11 attackers up a ladder walk the wall into a tower and fight up its stair to the top
//  12 escalade on a low tower (≤ 12 m) goes up onto its top; on a high one it is refused
//  13 a ladder raised at any stretch of curtain (and beside every gatehouse) of every layout gets men onto the walk,
//     except where there is water at the foot
//  14 the click picks the place: a tower's top, the wall-walk, the gatehouse roof, the keep, the bailey (castlePlace / castleRayPick)
//   node tools/castle-test.mjs [--only 1,2,…] [--v]        (run it through tools/heavy.sh)
import { buildMap } from "./scenarios.mjs";
import { createWorld, addUnit, issueOrder, step, DT } from "../js/sim/world.js";
import { combatSystem } from "../js/sim/combat.js";
import { TERRAIN } from "../js/sim/terrain-types.js";
import * as EC from "../js/sim/economy.js";
import { S_FIGHT } from "../js/sim/soldiers.js";
import * as CS from "../js/sim/castle.js";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : process.argv[i + 1] ?? true; };
const MAIN = /castle-test\.mjs$/.test(process.argv[1] || ""); // (tools/perf.mjs imports perfCastle without running the checks)
const ONLY = MAIN ? String(arg("only", "1,2,3,4,5,6,7,8,9,10,11,12,13,14")).split(",") : [], V = process.argv.includes("--v");
const MAP = buildMap({ size: 1400, res: 141 });
const results = [];
function check(name, ok, detail = "") { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(70)} ${detail}`); }
const log = (...a) => V && console.log("      ", ...a);

function world(layout = "hill", seed = 1, facing = Math.PI / 2) {
  const w = createWorld({ map: MAP, terrain: TERRAIN, seed });
  w.friction = false; w.buildings = [];
  w.systems.push(combatSystem);
  const C = CS.castleFromLayout(w, layout, { x: 700, y: 700, team: 1, facing });
  return { w, C };
}
const run = (w, sec, until) => { const n = Math.round(sec / DT); for (let k = 0; k < n; k++) { step(w); if (until && k % 10 === 0 && until()) return (k + 1) * DT; } return null; };
const gateB = (w, C) => w.buildings.find((b) => b.id === C.gates[0].bid);
const towerOf = (C, k) => C.parts.filter((p) => p.kind === "tower")[k];
const curtains = (C) => C.parts.filter((p) => p.kind === "curtain");
const alive = (w, u) => u.members.filter((i) => w.S.alive[i]);

// ─────────────────────────────── 1: up a tower stair to the walk, and along it
if (ONLY.includes("1")) {
  const { w, C } = world();
  const T = towerOf(C, 2), st = C.links.find((l) => l.part === T.id && l.a.lvl === 0);
  const u = addUnit(w, { team: 1, arm: "spearmen", count: 1, x: C.bailey.x, y: C.bailey.y, facing: 0 });
  // a point on the walk 20 m from the tower, along a curtain that meets it
  const cp = curtains(C).find((p) => Math.hypot(p.x0 - T.x, p.y0 - T.y) < T.r + 2 || Math.hypot(p.x1 - T.x, p.y1 - T.y) < T.r + 2);
  const near0 = Math.hypot(cp.x0 - T.x, cp.y0 - T.y) < Math.hypot(cp.x1 - T.x, cp.y1 - T.y), L = Math.hypot(cp.x1 - cp.x0, cp.y1 - cp.y0);
  const f = near0 ? 16 / L : 1 - 16 / L, gx = cp.x0 + (cp.x1 - cp.x0) * f, gy = cp.y0 + (cp.y1 - cp.y0) * f;
  const path = CS.castlePath(w, u.members[0], gx, gy, 1);
  log("path", path?.map((p) => p.kind + (p.link ? ":" + p.link.kind : "") + "@" + p.lvl).join(" → "));
  issueOrder(w, [u.id], { kind: "castle_move", x: gx, y: gy, lvl: 1, immediate: true });
  const i = u.members[0]; let viaStair = false, maxH = 0, onWalkAt = -1;
  const tt = run(w, 180, () => { const M = w.castleM; if (M.link[i] >= 0 && w.castles[0]._.tl[M.link[i]].kind === "stair") viaStair = true; maxH = Math.max(maxH, CS.levelHeight(w, i)); if (w.S.lvl[i] === 1 && onWalkAt < 0) onWalkAt = w.time; return w.S.lvl[i] === 1 && Math.hypot(w.S.x[i] - gx, w.S.y[i] - gy) < 1.2; });
  check("1  a man climbs a tower stair to the wall-walk and walks along it", tt !== null && viaStair && w.S.lvl[i] === 1, `arrived ${tt?.toFixed(0)} s, via a stair ${viaStair}, on the walk at ${onWalkAt.toFixed(0)} s, height ${CS.levelHeight(w, i).toFixed(1)} m (max ${maxH.toFixed(1)}); stair ${st ? "found" : "?"}`);
}

// ─────────────────────────────── 2: levels and melee; the ladder head
if (ONLY.includes("2")) {
  const { w, C } = world();
  const cp = curtains(C)[0], mx = (cp.x0 + cp.x1) / 2, my = (cp.y0 + cp.y1) / 2;
  const dx = cp.x1 - cp.x0, dy = cp.y1 - cp.y0, L = Math.hypot(dx, dy); let nx = -dy / L, ny = dx / L; if ((mx - C.bailey.x) * nx + (my - C.bailey.y) * ny < 0) { nx = -nx; ny = -ny; }
  const def = addUnit(w, { team: 1, arm: "menatarms", count: 12, x: C.bailey.x, y: C.bailey.y, facing: 0 });
  issueOrder(w, [def.id], { kind: "man_walls", x: mx, y: my, instant: true, immediate: true });
  // attackers pressed against the wall foot just below them (2–3 m away in plan)
  const att = addUnit(w, { team: 0, arm: "menatarms", count: 12, x: mx + nx * 3, y: my + ny * 3, facing: Math.atan2(-ny, -nx) - Math.PI / 2, formation: "line" });
  issueOrder(w, [att.id], { kind: "hold", x: mx + nx * 3, y: my + ny * 3, immediate: true });
  let cross = 0, minD = 1e9; const S = w.S;
  // (deaths by cause: stones and sand dropped from the parapet on men at the wall foot are siege-works.js's, and cross levels by right)
  const DROP = /parapet|machicolation|murder|sand|fall/, melee = { n: 0 }, dropped = { n: 0 };
  const tally = () => { for (const e of w.events) if ((e.kind === "kill" || e.kind === "die" || (e.kind === "down" && e.sev >= 5))) (DROP.test(String(e.cause)) ? dropped : melee).n++; };
  run(w, 25, () => { tally(); for (const i of [...def.members, ...att.members]) { if (S.state[i] === S_FIGHT && S.foe[i] >= 0 && S.lvl[S.foe[i]] !== S.lvl[i]) cross++; } for (const a of att.members) for (const d of def.members) minD = Math.min(minD, Math.hypot(S.x[a] - S.x[d], S.y[a] - S.y[d])); return false; });
  check("2a men on different levels never melee (wall-walk above, wall foot below)", cross === 0 && melee.n === 0, `closest pair ${minD.toFixed(1)} m apart in plan, cross-level fights ${cross}, melee deaths ${melee.n} (dropped on from the parapet: ${dropped.n})`);
  // a ladder at the attackers' stretch: they go up it and fight at the head
  const lad = CS.addLink(w, C, { kind: "ladder", a: { lvl: 0, x: mx + nx * 2.2, y: my + ny * 2.2 }, b: { lvl: 1, x: mx - nx * 0.3, y: my - ny * 0.3 }, width: 1, speed: 10 / 40, head: 4, team: 0 });
  issueOrder(w, [att.id], { kind: "castle_move", x: mx - nx * 0.3, y: my - ny * 0.3, lvl: 1, immediate: true });
  let headFights = 0, climbed = 0; const seen = new Set(); melee.n = 0;
  run(w, 150, () => { tally(); const M = w.castleM; for (const i of att.members) { if (!S.alive[i]) continue; if (M.link[i] >= 0) seen.add(i); if (S.state[i] === S_FIGHT && S.lvl[i] === 1 && S.foe[i] >= 0 && S.lvl[S.foe[i]] === 1) headFights++; } climbed = [...seen].length; return false; });
  check("2b men at a ladder head do fight", headFights > 0 && climbed > 0, `${climbed} went up the ladder, fight-ticks at the head ${headFights}, melee deaths ${melee.n}`);
  void lad;
}

// ─────────────────────────────── 3: man a stretch of wall
if (ONLY.includes("3")) {
  const { w, C } = world();
  const u = addUnit(w, { team: 1, arm: "archers", count: 40, x: C.bailey.x + 5, y: C.bailey.y - 5, facing: 0 });
  const cp = curtains(C)[2], mx = (cp.x0 + cp.x1) / 2, my = (cp.y0 + cp.y1) / 2;
  issueOrder(w, [u.id], { kind: "man_walls", x: mx, y: my, immediate: true });
  const S = w.S, M = w.castleM;
  const at = () => u.members.filter((i) => S.alive[i] && S.lvl[i] === 1 && M.goal[i] && Math.hypot(S.x[i] - M.goal[i].x, S.y[i] - M.goal[i].y) < 1.5).length;
  const tt = run(w, 300, () => at() >= 0.9 * u.members.length);
  let lo = Infinity, hi = -Infinity; const ux = (cp.x1 - cp.x0) / Math.hypot(cp.x1 - cp.x0, cp.y1 - cp.y0), uy = (cp.y1 - cp.y0) / Math.hypot(cp.x1 - cp.x0, cp.y1 - cp.y0);
  for (const i of u.members) { const s = (S.x[i] - mx) * ux + (S.y[i] - my) * uy; lo = Math.min(lo, s); hi = Math.max(hi, s); }
  check("3  a unit ordered to man a stretch of wall lines it", tt !== null && hi - lo > 35, `${at()}/${u.members.length} at their places in ${tt?.toFixed(0) ?? ">300"} s, spread ${(hi - lo).toFixed(0)} m along the walk`);
}

// ─────────────────────────────── 4: a breach
if (ONLY.includes("4")) {
  const { w, C } = world();
  w.teams[1].besieged = true; // the gate is shut
  run(w, 5);
  const cp = curtains(C)[3], b = w.buildings.find((q) => q.id === cp.bid);
  const inR = CS.regionAt(C, C.bailey.x, C.bailey.y), dx = cp.x1 - cp.x0, dy = cp.y1 - cp.y0, L = Math.hypot(dx, dy); let nx = -dy / L, ny = dx / L; const mx = (cp.x0 + cp.x1) / 2, my = (cp.y0 + cp.y1) / 2; if ((mx - C.bailey.x) * nx + (my - C.bailey.y) * ny < 0) { nx = -nx; ny = -ny; }
  const outR = CS.regionAt(C, mx + nx * 12, my + ny * 12);
  const before = inR !== outR;
  const k = b.mods ? b.mods.length >> 1 : 1; b.mods ||= new Float32Array(EC.wallModules(b)).fill(b.hp / EC.wallModules(b));
  b.mods[k] = 0; b.breachVer = (b.breachVer || 0) + 1; w.featuresVer = (w.featuresVer || 0) + 1; EC.blockWall(w, b, true);
  run(w, 5);
  const inR2 = CS.regionAt(C, C.bailey.x, C.bailey.y), outR2 = CS.regionAt(C, mx + nx * 12, my + ny * 12);
  const walkCut = C.walkways.edges.filter((e) => e.bid === b.id && e.mod === k).every((e) => e.gone);
  const u = addUnit(w, { team: 0, arm: "spearmen", count: 30, x: mx + nx * 45, y: my + ny * 45, facing: Math.atan2(-ny, -nx) - Math.PI / 2 });
  issueOrder(w, [u.id], { kind: "castle_move", x: C.bailey.x, y: C.bailey.y, lvl: 0, immediate: true });
  const tt = run(w, 240, () => u.members.filter((i) => CS.insideCastle(w, w.S.x[i], w.S.y[i])).length >= 0.8 * u.members.length);
  const inside = u.members.filter((i) => CS.insideCastle(w, w.S.x[i], w.S.y[i])).length;
  check("4  a breach becomes passable (the walk over it is cut)", before && inR2 === outR2 && walkCut && tt !== null, `sealed before ${before}, one region after ${inR2 === outR2}, walk cut ${walkCut}, ${inside}/30 inside in ${tt?.toFixed(0) ?? ">240"} s`);
}

// ─────────────────────────────── 5: the gate
if (ONLY.includes("5")) {
  const { w, C } = world();
  const g = C.gates[0], out = [g.x + Math.cos(C.facing) * 60, g.y + Math.sin(C.facing) * 60];
  const u = addUnit(w, { team: 0, arm: "spearmen", count: 30, x: out[0], y: out[1], facing: C.facing + Math.PI / 2 });
  issueOrder(w, [u.id], { kind: "castle_move", x: C.bailey.x, y: C.bailey.y, lvl: 0, immediate: true });
  const b = gateB(w, C);
  run(w, 90);
  const in1 = u.members.filter((i) => CS.insideCastle(w, w.S.x[i], w.S.y[i])).length;
  const shut = !!b.shut;
  b.forcedOpen = true; // (treachery, or a sally left it open)
  run(w, 3);
  const tt = run(w, 180, () => u.members.filter((i) => CS.insideCastle(w, w.S.x[i], w.S.y[i])).length >= 0.8 * u.members.length);
  const in2 = u.members.filter((i) => CS.insideCastle(w, w.S.x[i], w.S.y[i])).length;
  check("5  a shut gate blocks; an opened one passes", shut && in1 === 0 && tt !== null, `gate shut ${shut}, inside while shut ${in1}/30; opened: ${in2}/30 inside in ${tt?.toFixed(0) ?? ">180"} s`);
}

// ─────────────────────────────── 6: to the keep
if (ONLY.includes("6")) {
  const { w, C } = world();
  const g = C.gates[0], out = [g.x + Math.cos(C.facing) * 70, g.y + Math.sin(C.facing) * 70];
  const u = addUnit(w, { team: 1, arm: "spearmen", count: 30, x: out[0], y: out[1], facing: C.facing + Math.PI / 2 });
  issueOrder(w, [u.id], { kind: "keep", immediate: true });
  const S = w.S; let gate = 0; const seen = new Set();
  const inKeep = () => u.members.filter((i) => S.lvl[i] >= 3).length;
  const tt = run(w, 420, () => { for (const i of u.members) if (Math.hypot(S.x[i] - g.x, S.y[i] - g.y) < 6 && !seen.has(i)) { seen.add(i); gate++; } return inKeep() >= 0.9 * u.members.length; });
  const lv = [3, 4, 5].map((l) => u.members.filter((i) => S.lvl[i] === l).length);
  check("6  men sent to the keep go in by the gate and up the forebuilding stair", tt !== null && gate >= 0.9 * u.members.length, `${inKeep()}/30 in the keep (hall ${lv[0]}, chamber ${lv[1]}, roof ${lv[2]}) in ${tt?.toFixed(0) ?? ">420"} s; ${gate} passed the gate`);
}

// ─────────────────────────────── 7: perf
// A concentric castle: 600 defenders (12 bodies of 50) on both curtains' walks and two bodies at the breaches; two
// breaches and six scaling ladders in the outer curtain's front; 1,500 attackers (10 bodies of 150) on the berm
// between the ditch and the wall: four storm the breaches, four go up the ladders onto the walk, two (bows) shoot.
export function perfCastle(seed = 3) {
  const { w, C } = world("concentric", seed);
  const cps = curtains(C);
  const front = cps.filter((p) => p.ring === "outer").sort((a, b) => (b.y0 + b.y1) - (a.y0 + a.y1)).slice(0, 2);
  const brk = [];
  for (const cp of front) { const b = w.buildings.find((q) => q.id === cp.bid), n = EC.wallModules(b); b.mods ||= new Float32Array(n).fill(b.hp / n); b.mods[n >> 1] = 0; b.breachVer = 1; w.featuresVer++; EC.blockWall(w, b, true); const f = (n >> 1) / n + 0.5 / n; brk.push([cp.x0 + (cp.x1 - cp.x0) * f, cp.y0 + (cp.y1 - cp.y0) * f]); }
  const defs = [];
  for (let k = 0; k < 12; k++) {
    const cp = cps[(k * 5) % cps.length], mx = (cp.x0 + cp.x1) / 2, my = (cp.y0 + cp.y1) / 2;
    const u = addUnit(w, { team: 1, arm: k % 3 ? "spearmen" : "archers", count: k < 10 ? 50 : 50, x: C.bailey.x, y: C.bailey.y, facing: 0 });
    if (k < 10) issueOrder(w, [u.id], { kind: "man_walls", x: mx, y: my, instant: true, immediate: true });
    else { const [bx, by] = brk[k - 10]; issueOrder(w, [u.id], { kind: "castle_move", x: bx, y: by - 8, lvl: 0, immediate: true }); }
    defs.push(u);
  }
  // ladders on the front curtains, to the walk
  const fy = Math.max(...front.map((p) => (p.y0 + p.y1) / 2));
  for (let q = 0; q < 6; q++) { const x = C.x - 40 + q * 16; CS.addLink(w, C, { kind: "ladder", a: { lvl: 0, x, y: fy + 2.4 }, b: { lvl: 1, x, y: fy - 0.3 }, width: 1, speed: 7.5 / 30, head: 4, team: 0 }); }
  const atk = [];
  for (let k = 0; k < 10; k++) {
    const x = C.x - 45 + k * 10, y = fy + 6;
    const u = addUnit(w, { team: 0, arm: k % 5 === 4 ? "archers" : k % 2 ? "menatarms" : "spearmen", count: 150, x, y, facing: Math.PI, formation: "line" });
    atk.push(u);
    const o = k % 5 === 4 ? { kind: "hold", x, y: y + 14 } : k < 4 ? { kind: "assault", x: brk[k & 1][0], y: brk[k & 1][1] - 10 } : { kind: "castle_move", x: C.x - 40 + (k - 4) * 16, y: fy - 0.3, lvl: 1 };
    issueOrder(w, [u.id], { ...o, immediate: true });
  }
  return { w, C, defs, atk };
}
if (ONLY.includes("7")) {
  const { w } = perfCastle();
  const S = w.S;
  run(w, 45); // (into contact)
  const ticks = 300, t0 = performance.now(), c0 = process.cpuUsage();
  let fightMax = 0;
  for (let j = 0; j < ticks; j++) { step(w); if (j % 30 === 0) { let f = 0; for (let i = 0; i < S.n; i++) if (S.alive[i] && S.state[i] === S_FIGHT) f++; fightMax = Math.max(fightMax, f); } }
  const wall = (performance.now() - t0) / ticks, cu = process.cpuUsage(c0), cpu = (cu.user + cu.system) / 1000 / ticks, ms = Math.min(wall, cpu);
  let up = 0, inside = 0, al = 0, atkUp = 0; for (let i = 0; i < S.n; i++) { if (!S.alive[i]) continue; al++; if (S.lvl[i]) { up++; if (S.team[i] === 0) atkUp++; } if (S.team[i] === 0 && CS.insideCastle(w, S.x[i], S.y[i])) inside++; }
  check("7  perf: 600 defenders on the walls, 1,500 attackers storming (< 4.5 ms/tick)", ms < 4.5 && fightMax > 20, `${ms.toFixed(2)} ms/tick CPU (wall ${wall.toFixed(2)}); alive ${al}, on levels ${up} (attackers ${atkUp}), in melee (peak) ${fightMax}, attackers inside the outer curtain ${inside}`);
}

// ─────────────────────────────── 9: routed men on the walls come down
if (ONLY.includes("9")) {
  const { w, C } = world();
  const u = addUnit(w, { team: 1, arm: "spearmen", count: 30, x: C.bailey.x, y: C.bailey.y, facing: 0 });
  const cp = curtains(C)[4]; issueOrder(w, [u.id], { kind: "man_walls", x: (cp.x0 + cp.x1) / 2, y: (cp.y0 + cp.y1) / 2, instant: true, immediate: true });
  run(w, 2);
  const S = w.S; for (const i of u.members) { S.status[i] = 3; S.state[i] = 3; S.stress[i] = 1.5; } // (they break)
  const down = () => u.members.filter((i) => S.alive[i] && S.lvl[i] === 0).length;
  const tt = run(w, 120, () => down() >= 0.9 * u.members.length);
  check("9  routed men on the walls run for the stairs and come down", tt !== null, `${down()}/30 on the ground in ${tt?.toFixed(0) ?? ">120"} s`);
}

// ─────────────────────────────── 8: every layout
if (ONLY.includes("8")) {
  for (const lay of Object.keys(CS.CASTLE_LAYOUTS)) {
    const { w, C } = world(lay, 2, 0.7);
    const kinds = {}; for (const p of C.parts) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
    const ok = kinds.curtain >= 4 && kinds.tower >= 4 && kinds.gatehouse >= 1 && kinds.keep === 1 && C.links.length > 8 && C.parts.filter((p) => p.bid !== undefined).every((p) => w.buildings.some((b) => b.id === p.bid));
    const E = C.walkways.edges, orphan = E.filter((e) => !e.gone && e.lvl > 0).length;
    check(`8  layout "${lay}" builds`, ok, Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(", ") + `; ${C.walkways.nodes.length} nodes, ${orphan} walkway edges, ${C.links.length} links`);
  }
}

// ─────────────────────────────── 10: archers to a tower top: level 2, its capacity, and they shoot from it
const SGm = await import("../js/sim/siege.js");
if (ONLY.includes("10")) {
  const { w, C } = world();
  const T = towerOf(C, 1), cap = CS.topCap(T), S = w.S, M = () => w.castleM;
  const u = addUnit(w, { team: 1, arm: "archers", count: 14, x: C.bailey.x, y: C.bailey.y, facing: 0 });
  issueOrder(w, [u.id], { kind: "castle_move", x: T.x, y: T.y, lvl: T.topLvl, immediate: true });
  const onTop = () => u.members.filter((i) => S.alive[i] && S.lvl[i] === T.topLvl && Math.hypot(S.x[i] - T.x, S.y[i] - T.y) < T.r).length;
  let peak = 0;
  const tt = run(w, 240, () => { peak = Math.max(peak, onTop()); return onTop() >= cap; });
  run(w, 20, () => { peak = Math.max(peak, onTop()); return false; });
  const rest = u.members.filter((i) => S.alive[i] && S.lvl[i] === 1).length;
  // an enemy company in the open 90 m out from the tower, beyond the ditch
  const ox = T.x - C.bailey.x, oy = T.y - C.bailey.y, ol = Math.hypot(ox, oy), ex = T.x + ox / ol * 90, ey = T.y + oy / ol * 90;
  const en = addUnit(w, { team: 0, arm: "spearmen", count: 40, x: ex, y: ey, facing: Math.atan2(-oy, -ox) - Math.PI / 2, formation: "line" });
  issueOrder(w, [en.id], { kind: "hold", x: ex, y: ey, immediate: true });
  const topMen = u.members.filter((i) => S.lvl[i] === T.topLvl), a0 = topMen.reduce((s, i) => s + S.ammo[i], 0), d0 = en.members.filter((i) => !S.alive[i] || S.status[i] >= 3).length;
  run(w, 45);
  const shot = a0 - topMen.reduce((s, i) => s + S.ammo[i], 0), hurt = en.members.filter((i) => !S.alive[i] || S.wounds?.[i] > 0).length - d0;
  const h = topMen.length ? CS.levelHeight(w, topMen[0]) : 0;
  // flanking fire: stormers at the foot of the curtain beside the tower are chosen over a nearer body out in the field
  { const cp = curtains(C).find((p) => Math.min(Math.hypot(p.x0 - T.x, p.y0 - T.y), Math.hypot(p.x1 - T.x, p.y1 - T.y)) < T.r + 2), L = Math.hypot(cp.x1 - cp.x0, cp.y1 - cp.y0), near0 = Math.hypot(cp.x0 - T.x, cp.y0 - T.y) < Math.hypot(cp.x1 - T.x, cp.y1 - T.y), f = near0 ? 24 / L : 1 - 24 / L;
    let nx = -(cp.y1 - cp.y0) / L, ny = (cp.x1 - cp.x0) / L; const fx = cp.x0 + (cp.x1 - cp.x0) * f, fy = cp.y0 + (cp.y1 - cp.y0) * f; if ((fx - C.bailey.x) * nx + (fy - C.bailey.y) * ny < 0) { nx = -nx; ny = -ny; }
    for (const i of en.members) S.alive[i] = 0; en.members.length = 0; w.units.delete(en.id);
    const foot = addUnit(w, { team: 0, arm: "spearmen", count: 12, x: fx + nx * 4, y: fy + ny * 4, facing: 0, formation: "line" }); issueOrder(w, [foot.id], { kind: "hold", x: fx + nx * 4, y: fy + ny * 4, immediate: true });
    const dF = Math.hypot(fx + nx * 4 - T.x, fy + ny * 4 - T.y), fld = addUnit(w, { team: 0, arm: "spearmen", count: 12, x: T.x + ox / ol * (dF - 6), y: T.y + oy / ol * (dF - 6), facing: 0, formation: "line" }); issueOrder(w, [fld.id], { kind: "hold", x: fld.ax, y: fld.ay, immediate: true });
    u.c.mT = -99; run(w, 3);
    var flank = u.c?.mtgt === foot, flankTxt = `; flanking: aims at ${u.c?.mtgt === foot ? "the stormers under the curtain" : u.c?.mtgt === fld ? "the nearer body in the field" : "nobody"} (${dF.toFixed(0)} m vs ${(dF - 6).toFixed(0)} m)`; }
  check("10 archers ordered to a tower top reach it (≤ its room), shoot from it and flank the curtain", tt !== null && peak <= cap && onTop() === cap && rest > 0 && shot > 10 && flank, `${onTop()}/${cap} on the top (${h.toFixed(1)} m) in ${tt?.toFixed(0) ?? ">240"} s, ${rest} waiting at walk level; ${shot} shafts loosed from the top in 45 s, ${hurt} of the enemy hit${flankTxt}`);
}

// ─────────────────────────────── 11: up a ladder, along the walk, into a tower and up its stair
if (ONLY.includes("11")) {
  const { w, C } = world();
  const S = w.S, T = towerOf(C, 1);
  // the curtain that meets this tower, and a point on it 22 m from the tower
  const cp = curtains(C).find((p) => Math.min(Math.hypot(p.x0 - T.x, p.y0 - T.y), Math.hypot(p.x1 - T.x, p.y1 - T.y)) < T.r + 2);
  const near0 = Math.hypot(cp.x0 - T.x, cp.y0 - T.y) < Math.hypot(cp.x1 - T.x, cp.y1 - T.y), L = Math.hypot(cp.x1 - cp.x0, cp.y1 - cp.y0), f = near0 ? 22 / L : 1 - 22 / L;
  const mx = cp.x0 + (cp.x1 - cp.x0) * f, my = cp.y0 + (cp.y1 - cp.y0) * f;
  let nx = -(cp.y1 - cp.y0) / L, ny = (cp.x1 - cp.x0) / L; if ((mx - C.bailey.x) * nx + (my - C.bailey.y) * ny < 0) { nx = -nx; ny = -ny; }
  // four of the garrison's levy hold the tower top (six hold it for many minutes: one man abreast up a spiral stair)
  const def = addUnit(w, { team: 1, arm: "levy", count: 4, x: C.bailey.x, y: C.bailey.y, facing: 0 });
  issueOrder(w, [def.id], { kind: "castle_move", x: T.x, y: T.y, lvl: T.topLvl, instant: true, immediate: true });
  const att = addUnit(w, { team: 0, arm: "menatarms", count: 24, x: mx + nx * 40, y: my + ny * 40, facing: Math.atan2(-ny, -nx) - Math.PI / 2, formation: "line" });
  issueOrder(w, [att.id], { kind: "escalade", x: mx, y: my, immediate: true });
  const upWalk = () => att.members.filter((i) => S.alive[i] && S.lvl[i] >= 1).length;
  const t1 = run(w, 360, () => upWalk() >= 8);
  // along the walk and up into the tower
  issueOrder(w, [att.id], { kind: "castle_move", x: T.x, y: T.y, lvl: T.topLvl, immediate: true });
  const Mm = w.castleM; let stair = 0, fightTop = 0, maxHead = 0; const seenStair = new Set();
  const topHeld = () => def.members.filter((i) => S.alive[i] && S.status[i] < 3 && S.lvl[i] === T.topLvl).length;
  const onTopA = () => att.members.filter((i) => S.alive[i] && S.lvl[i] === T.topLvl && Math.hypot(S.x[i] - T.x, S.y[i] - T.y) < T.r).length;
  const t2 = run(w, 900, () => {
    for (const i of att.members) { if (!S.alive[i]) continue; const k = Mm.link[i]; if (k >= 0) { const Tl = w.castles[Mm.lcas[i]]._.tl[k]; if (Tl.kind === "stair" && Tl.L.part === T.id) { stair++; seenStair.add(i); } } if (S.state[i] === S_FIGHT && S.lvl[i] === T.topLvl && S.foe[i] >= 0 && def.members.includes(S.foe[i])) fightTop++; }
    if (topHeld()) { let h = 0; for (const i of att.members) if (S.alive[i] && S.lvl[i] === T.topLvl && S.state[i] === S_FIGHT) h++; maxHead = Math.max(maxHead, h); } // (while they hold it, the attackers come up one at a time)
    return topHeld() === 0 && onTopA() >= 3;
  });
  check("11 attackers up a ladder walk the wall into a tower and fight up its stair", t1 !== null && seenStair.size > 0 && fightTop > 0 && t2 !== null, `${upWalk()} over the wall in ${t1?.toFixed(0) ?? ">360"} s; ${seenStair.size} took the tower stair; fight-ticks on the top ${fightTop} (at most ${maxHead} attackers up there fighting at once while it was held); tower top taken in ${t2?.toFixed(0) ?? ">900"} s (defenders left ${topHeld()}, attackers on it ${onTopA()})`);
}

// ─────────────────────────────── 12: ladders to a tower top: a low one (concentric outer, 11 m) yes, a high one (hill, 13.5 m) no
if (ONLY.includes("12")) {
  const ev = (w, kind) => w.events.filter((e) => e.kind === kind);
  { const { w, C } = world("concentric");
    const T = C.parts.filter((p) => p.kind === "tower" && p.ring === "outer").sort((a, b) => b.y - a.y)[1], S = w.S;
    const ox = T.x - C.x, oy = T.y - C.y, ol = Math.hypot(ox, oy);
    const att = addUnit(w, { team: 0, arm: "menatarms", count: 16, x: T.x + ox / ol * 45, y: T.y + oy / ol * 45, facing: Math.atan2(-oy, -ox) - Math.PI / 2, formation: "line" });
    issueOrder(w, [att.id], { kind: "escalade", x: T.x, y: T.y, immediate: true });
    const e0 = ev(w, "escalade")[0], ref = ev(w, "escalade-refused")[0]; // (the order is taken at once: its event is this tick's)
    const onTop = () => att.members.filter((i) => S.alive[i] && S.lvl[i] === T.topLvl && Math.hypot(S.x[i] - T.x, S.y[i] - T.y) < T.r).length;
    const tt = run(w, 420, () => onTop() >= 4);
    check("12a escalade on a low tower (≤ 12 m) goes up onto its top", tt !== null && e0?.towerTop, `tower top ${T.floors[3]} m; ${e0 ? e0.ladders + " long ladders" : "no escalade" + (ref ? ": " + ref.why : "")}; ${onTop()} on its top in ${tt?.toFixed(0) ?? ">420"} s`);
  }
  { const { w, C } = world("hill");
    const T = towerOf(C, 2), ox = T.x - C.x, oy = T.y - C.y, ol = Math.hypot(ox, oy);
    const att = addUnit(w, { team: 0, arm: "menatarms", count: 16, x: T.x + ox / ol * 45, y: T.y + oy / ol * 45, facing: 0, formation: "line" });
    issueOrder(w, [att.id], { kind: "escalade", x: T.x, y: T.y, immediate: true });
    const ref = ev(w, "escalade-refused")[0];
    check("12b escalade on a high tower is refused, with the reason", !!ref && /too high/.test(ref.why) && !att.esc, `tower top ${T.floors[3]} m: ${ref ? "“" + ref.why + "”" : "not refused"}`);
  }
}

// ─────────────────────────────── 13: a ladder at any stretch of curtain, and beside each gatehouse, in every layout
if (ONLY.includes("13")) {
  for (const lay of Object.keys(CS.CASTLE_LAYOUTS)) {
    const { w: w0, C: C0 } = world(lay, 5, 0.9);
    const spots = [];
    for (const cp of curtains(C0)) for (const f of [0.12, 0.5, 0.88]) spots.push({ cp: cp.id, f });
    for (const g of C0.gates) spots.push({ gate: g.id, side: -1 }, { gate: g.id, side: 1 });
    let ok = 0, wet = 0; const bad = [];
    for (const sp of spots) {
      const { w, C } = world(lay, 5, 0.9); const S = w.S;
      let x, y, nx, ny, ring;
      if (sp.cp) { const cp = C.parts[sp.cp - 1]; ring = cp.ring; const L = Math.hypot(cp.x1 - cp.x0, cp.y1 - cp.y0); x = cp.x0 + (cp.x1 - cp.x0) * sp.f; y = cp.y0 + (cp.y1 - cp.y0) * sp.f; nx = -(cp.y1 - cp.y0) / L; ny = (cp.x1 - cp.x0) / L; }
      else { const g = C.parts[sp.gate - 1]; ring = g.ring; const c = Math.cos(g.rot), s = Math.sin(g.rot); x = g.x + c * sp.side * (g.w / 2 - 1); y = g.y + s * sp.side * (g.w / 2 - 1); nx = -s; ny = c; }
      const ringPoly = C.rings.find((r) => r.id === ring)?.poly || C.bailey.poly, cx = ringPoly.reduce((a, p) => a + p[0], 0) / ringPoly.length, cy = ringPoly.reduce((a, p) => a + p[1], 0) / ringPoly.length;
      if ((x - cx) * nx + (y - cy) * ny < 0) { nx = -nx; ny = -ny; }
      const out = ring === "inner" ? 11 : 32;
      const att = addUnit(w, { team: 0, arm: "spearmen", count: 16, x: x + nx * out, y: y + ny * out, facing: Math.atan2(-ny, -nx) - Math.PI / 2, formation: "line" });
      issueOrder(w, [att.id], { kind: "escalade", x, y, immediate: true });
      const ref = w.events.find((e) => e.kind === "escalade-refused");
      const up = () => att.members.filter((i) => S.alive[i] && S.lvl[i] >= 1).length;
      const tt = ref ? null : run(w, 200, () => up() >= 2);
      const where = `${sp.cp ? "curtain " + sp.cp + "@" + sp.f : "gate " + sp.gate + (sp.side > 0 ? "R" : "L")}`;
      if (ref) { const water = /water|moat/.test(ref.why) && (C.parts.some((p) => p.kind === "moat" && p.segs.some((q) => pointSegT(x + nx * 4, y + ny * 4, q) < 22)) || w.map.water(x + nx * 4, y + ny * 4) > 0.3); if (water) wet++; else bad.push(`${where}: refused (${ref.why})`); }
      else if (tt !== null && up() >= 2) ok++;
      else bad.push(`${where}: ${up()} up in 200 s`);
    }
    check(`13 ladders at every stretch of "${lay}" get men onto the walk (not where it is wet)`, bad.length === 0, `${ok} up, ${wet} refused for water, of ${spots.length} spots${bad.length ? "; FAILED " + bad.slice(0, 6).join(" | ") : ""}`);
    void w0; void C0;
  }
}
function pointSegT(x, y, q) { const [x0, y0, x1, y1] = q, dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / l2)); return Math.hypot(x - x0 - dx * t, y - y0 - dy * t); }

// ─────────────────────────────── 14: the click picks the place
if (ONLY.includes("14")) {
  const { w, C } = world();
  const T = towerOf(C, 0), G = C.gates[0], K = C.keep, cp = curtains(C)[3], mx = (cp.x0 + cp.x1) / 2, my = (cp.y0 + cp.y1) / 2;
  const pl = (x, y, h) => { const r = CS.castleRayPick(w, x, y, w.map.h(x, y) + h, 0, 0, -1); return r ? CS.castlePlace(w, r.x, r.y, r.part ? { part: r.part, h: r.h, top: r.top } : null) : null; };
  const got = { tower: pl(T.x, T.y, 60), wall: pl(mx, my, 60), gate: pl(G.x, G.y, 60), keep: pl(K.x, K.y, 60), bailey: pl(C.bailey.x + 2, C.bailey.y + 9, 60), out: pl(C.x + 400, C.y, 60) };
  // an oblique ray from outside the wall at a tower's top: it meets the tower, not the terrain behind it
  const T2 = towerOf(C, 2), ox = T2.x - C.x, oy = T2.y - C.y, ol = Math.hypot(ox, oy), sx = T2.x + ox / ol * 120, sy = T2.y + oy / ol * 120, sz = w.map.h(sx, sy) + 70, tz = w.map.h(T2.x, T2.y) + T2.floors[3] - 0.5, d = Math.hypot(T2.x - sx, T2.y - sy, tz - sz);
  const ob = CS.castleRayPick(w, sx, sy, sz, (T2.x - sx) / d, (T2.y - sy) / d, (tz - sz) / d), obP = ob && CS.castlePlace(w, ob.x, ob.y, ob.part ? { part: ob.part, h: ob.h, top: ob.top } : null);
  const ok = got.tower?.kind === "tower" && got.tower.lvl === 2 && got.wall?.kind === "walk" && got.wall.lvl === 1 && got.gate?.kind === "gatehouse" && got.gate.lvl === 2 && got.keep?.kind === "keep" && got.keep.lvl === 5 && got.bailey?.kind === "bailey" && !got.out && obP?.kind === "tower" && obP.part === T2;
  check("14 a click picks the place and level (tower top, wall-walk, gatehouse roof, keep roof, bailey)", ok, Object.entries(got).map(([k, v]) => `${k}: ${v ? v.label : "-"}`).join(" · ") + ` · oblique: ${obP?.label ?? "-"}`);
}

if (MAIN) { const f = results.filter((r) => !r).length; console.log(`\n${results.length - f} PASS, ${f} FAIL`); process.exitCode = f ? 1 : 0; }
