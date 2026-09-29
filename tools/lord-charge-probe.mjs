// The lord's charge, headless: he takes the field with his household, the player gallops him (Shift+W) at a body of
// foot. Prints what the charge did: men flung / down, the lord's speed through the body, how many of his household
// struck and how many went through, and whether anybody stood fencing.
//   node tools/lord-charge-probe.mjs [levy|archers|spearmen|pikemen] [--formation line] [--seed 3]
import { buildMap, newWorld } from "./scenarios.mjs";
import { addUnit, issueOrder, step, DT } from "../js/sim/world.js";
import { takeField, embody } from "../js/sim/avatar.js";
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : process.argv[i + 1]; };
const foot = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "levy";
const map = buildMap({ size: 1600, res: 321, h: () => 50 });
const w = newWorld(map, +arg("seed", 3), { legends: false });
w.teams[0].hq = { x: 800, y: 400 }; w.teams[1].hq = { x: 800, y: 1300 };
addUnit(w, { team: 0, arm: "spearmen", count: 40, x: 800, y: 440, facing: 0, formation: "line" });
const F = addUnit(w, { team: 1, arm: foot, count: 120, x: 800, y: 700, facing: Math.PI, formation: arg("formation", "line") });
issueOrder(w, [F.id], { immediate: true, kind: "hold", x: 800, y: 700, facing: -Math.PI / 2 });
step(w);
const r = takeField(w, 0, 800, 480, { facing: Math.PI / 2 }); if (r.error) { console.log(r.error); process.exit(1); }
const A = w.avatar, S = w.S, L = A.lord, U = r.unit; embody(w, true);
let thrown = 0, lordThrown = 0, minV = 99, maxV = 0, tHit = -1;
for (let k = 0; k < +arg("ticks", 700); k++) {
  A.input.mx = 0; A.input.my = 1; A.input.gait = 2; A.input.aim = Math.PI / 2; A.input.charge = true;
  step(w);
  for (const e of w.events) if (e.kind === "thrown") { thrown++; if (e.by === L) lordThrown++; }
  if (process.env.FX) for (const f of A.fx.splice(0)) console.log("   fx", w.time.toFixed(1), f.kind, "speed", A.speed.toFixed(1), "ride", !!A.ride);
  const v = Math.hypot(S.vx[L], S.vy[L]); maxV = Math.max(maxV, v); if (tHit < 0 && lordThrown) tHit = w.time; if (tHit >= 0) minV = Math.min(minV, v);
  if (k % 20 === 0) { let fight = 0, beyond = 0; for (const i of U.members) { if (S.state[i] === 2) fight++; if (S.y[i] > 715) beyond++; } let dn = 0; for (const i of F.members) if (S.posture[i]) dn++;
    console.log(`t${w.time.toFixed(1)} lord y ${S.y[L].toFixed(0)} v ${v.toFixed(1)} ride ${!!A.ride} | household riding ${A.hride ? [...A.hride.values()].filter((R) => !R.done).length : 0} fighting ${fight} beyond the line ${beyond}/${U.members.length} | foot down ${dn} thrown ${thrown} (by lord ${lordThrown}) disordered ${!!F.disordered} broken ${!!F.c?.broken}`); }
}
