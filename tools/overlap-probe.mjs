// Bodies inside bodies: every N s of a battle, count pairs of men standing closer than two bodies can (foot–foot
// < 0.4 m centre to centre, anything with a horse < 1.1 m), by what the nearer man is doing, and friend/foe.
//   node tools/overlap-probe.mjs [crecy|courtrai|stirling|line] [--every 20] [--minutes 12]
import { neighbours } from "../js/sim/world.js";
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : process.argv[i + 1]; };
const which = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "crecy", EVERY = +arg("every", 20), MIN = +arg("minutes", 12);
const H = await import("./scenarios-hist.mjs"), L = await import("./scenarios.mjs");
const ST = ["idle", "move", "fight", "flee", "rally", "down", "dead", "capt"];
const tot = {}; let last = -1, samples = 0;
const nb = [];
globalThis.__trace = (w) => {
  if (w.time > MIN * 60) throw new Error("done");
  const m = Math.floor(w.time / EVERY); if (m === last) return; last = m; samples++;
  const S = w.S; const row = {}; let n = 0;
  for (let i = 0; i < S.n; i++) {
    if (!S.alive[i] || S.posture[i]) continue;
    const hi = S.horseOK[i] === 1;
    neighbours(w, S.x[i], S.y[i], 1.1, nb);
    for (const o of nb) {
      if (o <= i || !S.alive[o] || S.posture[o]) continue;
      const ho = S.horseOK[o] === 1, dx = S.x[o] - S.x[i], dy = S.y[o] - S.y[i], d = Math.hypot(dx, dy);
      if (hi || ho) { // a horse is a box 2.4 m long, 0.7 m wide, along its facing: inside it = overlap
        const inBox = (h, ox, oy) => { const f = S.facing[h], a = Math.abs(ox * Math.cos(f) + oy * Math.sin(f)), l = Math.abs(-ox * Math.sin(f) + oy * Math.cos(f)); return a < 1.2 + (hi && ho ? 1.0 : 0.2) && l < 0.35 + (hi && ho ? 0.3 : 0.2); };
        if (!(hi ? inBox(i, dx, dy) : false) && !(ho ? inBox(o, -dx, -dy) : false)) continue;
      } else if (d >= 0.4) continue;
      const k = `${hi || S.horseOK[o] === 1 ? "horse" : "foot"} ${S.team[o] === S.team[i] ? "friend" : "FOE"} ${ST[S.state[i]]}/${ST[S.state[o]]}`;
      row[k] = (row[k] || 0) + 1; n++;
    }
  }
  for (const [k, v] of Object.entries(row)) tot[k] = (tot[k] || 0) + v;
  if (process.argv.includes("--series")) console.log(`t${w.time.toFixed(0)} overlaps ${n}`);
};
try { which === "line" ? L.SCENARIOS.line(1) : H[which](1); } catch (e) { if (e.message !== "done") throw e; }
console.log(`${which}: mean overlapping pairs per sample ${(Object.values(tot).reduce((a, b) => a + b, 0) / samples).toFixed(1)} over ${samples} samples`);
for (const [k, v] of Object.entries(tot).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${(v / samples).toFixed(1).padStart(6)}  ${k}`);
