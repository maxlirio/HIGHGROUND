// The lord in the field (js/sim/avatar.js), headless: taking the field, his blows and the enemy's on him, his
// fall (killed / taken for ransom) and the news of it running through the army, his presence and banner,
// command from the saddle (voice at once, horn delayed), the couched-lance charge. Prints PASS/FAIL per check.
//   node tools/avatar-test.mjs [--seed 3]
import { buildMap, newWorld } from "./scenarios.mjs";
import { addUnit, step, DT } from "../js/sim/world.js";
import { fell, knockDown } from "../js/sim/melee.js";
import { S_CAPT, ST_FLEE, S_FLEE, W_INSTANT } from "../js/sim/soldiers.js";
import { takeField, embody, lordOrder, lordStatus, AV } from "../js/sim/avatar.js";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : +process.argv[i + 1]; };
const SEED = arg("seed", 3);
const map = buildMap({ size: 1600, res: 321, h: () => 50 });
let pass = 0, failN = 0;
const check = (name, ok, info = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  — " + info : ""}`); ok ? pass++ : failN++; };
const run = (w, sec, each) => { for (let k = 0, n = Math.round(sec / DT); k < n; k++) { step(w); if (each && each(w) === false) return; } };
const world = (seed = SEED) => { const w = newWorld(map, seed, { legends: false }); w.teams[0].hq = { x: 800, y: 500 }; w.teams[1].hq = { x: 800, y: 1300 }; return w; };
const face = (u, x, y) => Math.atan2(y - u.ay, x - u.ax) - Math.PI / 2;
const meanStress = (w, u) => { let s = 0, n = 0; for (const id of u.members) if (w.S.alive[id]) { s += w.S.stress[id]; n++; } return s / Math.max(1, n); };

// ---------------------------------------------------------------- 1. taking the field
{
  const w = world();
  const foe = addUnit(w, { team: 1, arm: "spearmen", count: 40, x: 800, y: 900, facing: Math.PI, formation: "line" });
  const ours = addUnit(w, { team: 0, arm: "spearmen", count: 40, x: 800, y: 700, facing: 0, formation: "line" });
  step(w);
  const bad = takeField(w, 0, 800, 850);
  check("refused inside the enemy's reach", !!bad.error, bad.error);
  const far = takeField(w, 0, 1400, 150);
  check("refused far from his men", !!far.error, far.error);
  const r = takeField(w, 0, 800, 680);
  check("takes the field near his men", !r.error && r.unit?.members.length === AV.household + 1, `${r.unit?.members.length} riders`);
  run(w, 1);
  const A = w.avatar, S = w.S;
  check("he leads, his banner rides beside him", S.role[A.lord] === 1 && S.role[A.banner] === 2 && S.horseOK[A.lord] === 1);
  check("orders now go out from where he stands", w.teams[0].hq === A.hq && Math.hypot(A.hq.x - S.x[A.lord], A.hq.y - S.y[A.lord]) < 0.01);
  void foe; void ours;
}

// ---------------------------------------------------------------- 2. in the mêlée: his blows, and theirs on him
{
  let blows = 0, landed = 0, hurt = 0, kills = 0, fallen = 0, secs = 0;
  for (let s = 0; s < 5; s++) {
    const w = world(SEED + 7 * s);
    addUnit(w, { team: 0, arm: "spearmen", count: 30, x: 780, y: 690, facing: 0, formation: "line" });
    takeField(w, 0, 800, 700, { facing: Math.PI / 2 }); const A = w.avatar, S = w.S, L = A.lord;
    embody(w, true); A.input.mount = true; run(w, 0.5); // down off his horse: a knight on foot with his sword
    const foe = addUnit(w, { team: 1, arm: "levy", count: 8, x: 800, y: 704, facing: Math.PI, formation: "line", training: 0.2 });
    let k = 0; const t0 = w.time;
    run(w, 60, (w) => {
      if (A.outcome) return false;
      // close on the nearest of them and strike: hold the stroke 0.6 s, let it go, again
      let e = -1, ed = 1e9; for (const id of foe.members) if (S.alive[id] && S.status[id] !== ST_FLEE) { const d = Math.hypot(S.x[id] - S.x[L], S.y[id] - S.y[L]); if (d < ed) { ed = d; e = id; } }
      if (e < 0 || ed > 40) return false;
      const ang = Math.atan2(S.y[e] - S.y[L], S.x[e] - S.x[L]); A.input.aim = ang;
      A.input.mx = ed > 1.2 ? Math.cos(ang) : 0; A.input.my = ed > 1.2 ? Math.sin(ang) : 0; A.input.gait = ed > 4 ? 1 : 0;
      k++; if (k % 12 === 0) A.input.down = true; if (k % 12 === 6) { A.input.down = false; A.input.releases.push(0.6); }
      for (const f of A.fx.splice(0)) { if (["hit", "kill", "glance", "blocked", "parried"].includes(f.kind)) { blows++; if (f.kind === "hit" || f.kind === "kill") landed++; } if (f.kind === "hurt") hurt++; }
    });
    kills += A.stats.kills; fallen += A.outcome ? 1 : 0; secs += w.time - t0;
  }
  check("his blows are resolved by the melee model", blows >= 15, `${blows} blows reached a man in 5 fights (${secs.toFixed(0)} s), ${landed} wounded, ${kills} killed`);
  check("his blows can wound and kill", landed > 0 && kills > 0);
  check("the enemy strikes him too", hurt > 0, `${hurt} wounds taken; fell in ${fallen} of 5 fights`);
}

// ---------------------------------------------------------------- 3. killed: the news runs through the army
{
  const w = world();
  const near = addUnit(w, { team: 0, arm: "spearmen", count: 40, x: 800, y: 640, facing: 0, formation: "line" });
  const far = addUnit(w, { team: 0, arm: "spearmen", count: 40, x: 800, y: 60, facing: 0, formation: "line" });
  addUnit(w, { team: 1, arm: "menatarms", count: 10, x: 800, y: 1300, facing: Math.PI, formation: "line" });
  takeField(w, 0, 800, 690); const A = w.avatar, S = w.S;
  run(w, 4);
  const s0n = meanStress(w, near), s0f = meanStress(w, far), m0 = near.moraleMod || 0;
  fell(w.cs.ctx, A.lord, -1, W_INSTANT, "melee");
  run(w, 20);
  const s1n = meanStress(w, near), s1f = meanStress(w, far);
  check("his death is known", A.outcome === "killed");
  check("the men who saw it are shaken at once", s1n - s0n > 0.08, `near company +${(s1n - s0n).toFixed(3)}`);
  check("the news has not reached the far company yet (runner speed)", Math.abs(s1f - s0f) < 0.02, `far company +${(s1f - s0f).toFixed(3)} after 20 s at ${Math.round(Math.hypot(far.ax - 800, far.ay - 690))} m`);
  run(w, 220);
  const s2f = meanStress(w, far);
  check("…and then it has, weaker for the distance", s2f - s0f > 0.02 && (near.moraleMod || 0) > m0, `far +${(s2f - s0f).toFixed(3)}, near baseline +${((near.moraleMod || 0) - m0 + AV.presenceBaseline * 0).toFixed(3)}`);
  check("the team's orders go out from the rear again", w.teams[0].hq && w.teams[0].hq !== A.hq);
  check("the game goes on (no second lord while this one is dead)", !!takeField(w, 0, 800, 600).error);
}

// ---------------------------------------------------------------- 4. taken for ransom
{
  const w = world();
  addUnit(w, { team: 0, arm: "spearmen", count: 20, x: 800, y: 560, facing: 0, formation: "line" });
  const r = takeField(w, 0, 800, 600, { household: 0 }); const A = w.avatar, S = w.S, L = A.lord;
  embody(w, true); A.input.mount = true; run(w, 0.5);
  const foe = addUnit(w, { team: 1, arm: "menatarms", count: 3, x: 800, y: 602, facing: Math.PI, formation: "line", training: 0.9 });
  for (const id of foe.members) S.disc[id] = 0.9;
  let t0 = w.time;
  run(w, 30, () => { if (A.outcome) return false; if (S.posture[L] === 0 && w.time - t0 > 0.3) knockDown(w.cs.ctx, L, 1); for (const id of foe.members) { S.x[id] = S.x[L] + (id % 3 - 1) * 1.2; S.y[id] = S.y[L] + 1.2; } });
  check("knocked down with two over him and nobody beside him, he yields", A.outcome === "captured" && S.state[L] === S_CAPT, `outcome ${A.outcome} after ${(w.time - t0).toFixed(1)} s`);
  check("the ransom is recorded", (A.ransom || 0) > 0, `${A.ransom} gold`);
  void r;
}

// ---------------------------------------------------------------- 5. presence: the banner steadies the men near him
{
  const w = world();
  const near = addUnit(w, { team: 0, arm: "spearmen", count: 40, x: 800, y: 660, facing: 0, formation: "line" });
  const far = addUnit(w, { team: 0, arm: "spearmen", count: 40, x: 400, y: 660, facing: 0, formation: "line" });
  addUnit(w, { team: 1, arm: "spearmen", count: 10, x: 800, y: 1400, facing: Math.PI, formation: "line" });
  takeField(w, 0, 800, 700);
  run(w, 2);
  for (const u of [near, far]) for (const id of u.members) w.S.stress[id] = 0.5;
  run(w, 30);
  const sn = meanStress(w, near), sf = meanStress(w, far);
  check("men within his presence settle faster", sn < sf - 0.05, `near ${sn.toFixed(3)} vs far ${sf.toFixed(3)}`);
  check("their resting stress is lowered while he is with them", (near.moraleMod || 0) < 0 && !(far.moraleMod < 0));
}

// ---------------------------------------------------------------- 6. rally to me
{
  const w = world();
  const run1 = addUnit(w, { team: 0, arm: "levy", count: 20, x: 800, y: 720, facing: 0, formation: "line" });
  const run2 = addUnit(w, { team: 0, arm: "levy", count: 20, x: 1200, y: 720, facing: 0, formation: "line" });
  addUnit(w, { team: 1, arm: "spearmen", count: 10, x: 800, y: 1500, facing: Math.PI, formation: "line" });
  takeField(w, 0, 800, 700); const A = w.avatar, S = w.S;
  run(w, 2);
  for (const u of [run1, run2]) for (const id of u.members) { S.status[id] = ST_FLEE; S.state[id] = S_FLEE; S.stress[id] = 0.7; S.rallyT[id] = 400; S.busyT[id] = 0; }
  run(w, 2.1); // (the companies break on it: +0.25 stress each, morale.onUnitBreak)
  lordOrder(w, "rally", []);
  run(w, 12);
  const back = (u) => u.members.filter((id) => S.alive[id] && S.status[id] !== ST_FLEE).length;
  check("\"Rally to me!\": fugitives near him stop and fall in", back(run1) >= 10 && back(run2) <= 2, `near ${back(run1)}/20 back, far ${back(run2)}/20`);
}

// ---------------------------------------------------------------- 7. command from the saddle: voice at once, horn late
{
  const w = world();
  const a = addUnit(w, { team: 0, arm: "spearmen", count: 30, x: 815, y: 700, facing: 0, formation: "line" });
  const b = addUnit(w, { team: 0, arm: "archers", count: 30, x: 800, y: 540, facing: 0, formation: "line" });
  addUnit(w, { team: 1, arm: "spearmen", count: 10, x: 800, y: 1400, facing: Math.PI, formation: "line" });
  takeField(w, 0, 800, 700); run(w, 1);
  const r = lordOrder(w, "wedge", [a.id, b.id]);
  check("within 30 m his voice is obeyed at once", a.formation === "wedge" && !a.pendingOrder, `channels ${JSON.stringify(r.channels)}`);
  check("beyond it the order goes by horn and takes time", !!b.pendingOrder && b.pendingOrder.channel === "horn" && b.formation !== "wedge", `eta ${(b.pendingOrder?.eta - w.time).toFixed(1)} s`);
  run(w, 60);
  check("…and arrives", b.formation === "wedge");
  const f = lordOrder(w, "follow", [a.id]); run(w, 1);
  const A = w.avatar; embody(w, true); A.input.mx = 1; A.input.my = 0; A.input.gait = 1;
  run(w, 40);
  const d = Math.hypot(a.ax - w.S.x[A.lord], a.ay - w.S.y[A.lord]);
  check("\"Follow me!\": they keep station on him as he rides", d < 90 && f.n === 1, `${Math.round(d)} m from him after 40 s at the trot (${Math.round(w.S.x[A.lord] - 800)} m ridden)`);
}

// ---------------------------------------------------------------- 8. the couched lance
{
  let hits = 0, refused = 0, house = 0, trials = 0;
  for (let s = 0; s < 6; s++) {
    const w = world(SEED + s * 11);
    addUnit(w, { team: 0, arm: "spearmen", count: 20, x: 800, y: 560, facing: 0, formation: "line" });
    takeField(w, 0, 800, 600, { facing: Math.PI / 2 }); const A = w.avatar, S = w.S;
    const foe = addUnit(w, { team: 1, arm: "levy", count: 40, x: 800, y: 760, facing: Math.PI, formation: "shallow", training: 0.2 });
    foe.moraleMod = 0; embody(w, true); A.input.charge = true; A.input.mx = 0; A.input.my = 1; A.input.gait = 2; A.input.aim = Math.PI / 2;
    trials++;
    run(w, 40, (w) => { for (const e of w.events) if ((e.kind === "impact" || e.kind === "refuse") && e.who !== A.lord) house++; if (A.stats.impacts + A.stats.refused > 0) { A.metT ??= w.time; if (w.time - A.metT > 3) return false; } });
    hits += A.stats.impacts; refused += A.stats.refused;
  }
  check("charging with the lance couched he meets their line (impact or refusal)", hits + refused >= 4, `${hits} impacts, ${refused} refusals in ${trials} charges; household riders met them ${house} times behind him (impact or refusal)`);
  check("his household charge with him", house > 0);
}

// ---------------------------------------------------------------- 9. the banner falls, and is raised again
{
  const w = world();
  const near = addUnit(w, { team: 0, arm: "spearmen", count: 40, x: 800, y: 670, facing: 0, formation: "line" });
  addUnit(w, { team: 1, arm: "spearmen", count: 10, x: 800, y: 1500, facing: Math.PI, formation: "line" });
  takeField(w, 0, 800, 700); const A = w.avatar, S = w.S;
  run(w, 4);
  const b0 = A.banner, s0 = meanStress(w, near);
  fell(w.cs.ctx, b0, -1, W_INSTANT, "melee"); run(w, 0.2);
  const s1 = meanStress(w, near);
  check("the banner goes down: the men who see it waver", A.bannerState === "down" && s1 - s0 > 0.05, `+${(s1 - s0).toFixed(3)}`);
  run(w, AV.bannerPickup + 2);
  check("one of his household takes it up again", A.bannerState === "up" && A.banner !== b0 && S.alive[A.banner] && S.role[A.banner] === 2);
}

// ---------------------------------------------------------------- 10. cost per tick
{
  const time = (withLord) => {
    const w = world(SEED);
    addUnit(w, { team: 0, arm: "spearmen", count: 300, x: 800, y: 700, facing: 0, formation: "line" });
    addUnit(w, { team: 1, arm: "spearmen", count: 300, x: 800, y: 740, facing: Math.PI, formation: "line" });
    if (withLord) { takeField(w, 0, 800, 600); embody(w, true); w.avatar && Object.assign(w.avatar.input, { mx: 0, my: 1 }); }
    run(w, 5); const t0 = performance.now(); run(w, 60); return (performance.now() - t0) / (60 / DT);
  };
  const a = time(false), b = time(true);
  check("the lord costs next to nothing per tick", b - a < 0.25 + 0.1 * a, `${a.toFixed(2)} ms/tick without, ${b.toFixed(2)} with (600 men in contact)`);
}

console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
