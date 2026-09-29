// Two commander AIs fight a full battle on the placeholder landscape (read physically), with command
// friction on. Prints a timeline and a battle report: how long the lines held, the pulses, the breaks,
// the pursuit, rallies and legends — the things a believable medieval battle is made of.
//   node tools/ai-duel.mjs [dispositionA=defensive] [dispositionB=aggressive] [seed=1] [minutes=180]
//   HG_ARMS=1 also lists the men down before the first foot company broke by cause, side and arm
import { placeholderMap } from "../js/sim/map.js";
import { readLand } from "../js/sim/landread.js";
import { createWorld, addUnit, step, DT } from "../js/sim/world.js";
import { combatSystem } from "../js/sim/combat.js";
import { legendSystem } from "../js/sim/legend.js";
import { commandBattle } from "../js/sim/commander-ai.js";
import { TERRAIN } from "../js/sim/terrain-types.js";
import { ARMS } from "../js/sim/arms.js";
import { S_DEAD, S_DOWN, S_CAPT, W_MORTAL, ST_FLEE } from "../js/sim/soldiers.js";

const dispA = process.argv[2] || "defensive", dispB = process.argv[3] || "aggressive", seed = +(process.argv[4] || 1), minutes = +(process.argv[5] || 180);
const map = placeholderMap(); map.land = readLand(map);
const w = createWorld({ map, terrain: TERRAIN, seed });
w.systems.push(combatSystem, legendSystem);
const army = (team, x, y, face) => {
  const nobows = process.env.HG_NOBOWS; // test variant: bows replaced by spearmen
  const U = (arm, count, dx, dy, formation = "line", extra = {}) => { if (nobows && (arm === "archers" || arm === "crossbow")) { arm = "spearmen"; formation = "deep"; } return addUnit(w, { team, arm, count, x: x + dx, y: y + dy, facing: face, formation, ...extra }).id; };
  return new Set([
    U("spearmen", 200, -70, 0, "deep"), U("spearmen", 200, 70, 0, "deep"), U("levy", 160, 0, -50, "line"),
    U("menatarms", 100, 0, 30, "deep"), U("archers", 120, -170, 20, "line"), U("archers", 80, 170, 20, "line"),
    U(team ? "hobelars" : "knights", 70, -260, -40, "line", { depth: 2 }), U(team ? "crossbow" : "pikemen", 90, 260, 0, "line"),
  ]);
};
const A = { team: 0, units: army(0, 1300, 1400, 0), disposition: dispA }, B = { team: 1, units: army(1, 2500, 2300, Math.PI), disposition: dispB };
const S = w.S, R = { breaks: [], rallies: [], legends: [], firstContact: -1, deaths: [0, 0], routDeaths: [0, 0], flee: [0, 0], orders: 0 };
const brokenTeam = [-1, -1], counted = new Set(); // a man is counted dead once (a mortal wound, then death)
// the LINES: foot that is neither bows nor horse — when it first meets the enemy, when its first company breaks,
// and what had killed men (arrows or the melee) by then
const isFoot = (u) => u && !ARMS[u.arm].missile && !ARMS[u.arm].mounted && !u.isWorkers;
R.footContact = -1; R.footBreak = [-1, -1]; R.preCause = { missile: 0, melee: 0 };
for (let k = 0; k < minutes * 60 / DT; k++) {
  step(w); commandBattle(w, A); commandBattle(w, B);
  for (const e of w.events) {
    if (process.env.HG_DBG && (e.kind === 'kill' || e.kind === 'down')) { const k = S.team[e.victim] + ':' + (e.cause || '?') + (e.fleeing ? '/fl' : ''); (R.cause ||= {})[k] = (R.cause[k] || 0) + 1; }
    if ((e.kind === "kill" || e.kind === "down") && R.footBreak[0] < 0 && R.footBreak[1] < 0 && S.status[e.victim] !== ST_FLEE && !e.fleeing) { const k = e.cause === "missile" ? "missile" : "melee"; R.preCause[k]++; if (process.env.HG_ARMS) { const q = (e.cause === "missile" ? "m:" : "x:") + S.team[e.victim] + ":" + (w.units.get(S.unit[e.victim])?.arm || "?"); R.preArm = R.preArm || {}; R.preArm[q] = (R.preArm[q] || 0) + 1; } }
    if (e.kind === "unit-break" && isFoot(w.units.get(e.unit)) && R.footBreak[e.team] < 0) R.footBreak[e.team] = w.time;
    if (e.kind === "unit-break") { R.breaks.push({ t: w.time, team: e.team, unit: e.unit, cas: e.cas }); if (brokenTeam[e.team] < 0) brokenTeam[e.team] = w.time; }
    else if (e.kind === "unit-rallied") R.rallies.push({ t: w.time, unit: e.unit });
    else if (e.kind === "legend") R.legends.push({ t: w.time, who: e.who, rank: e.rank });
    else if ((e.kind === "kill" || e.kind === "die" || (e.kind === "down" && e.sev >= W_MORTAL)) && !counted.has(e.victim ?? e.who)) { counted.add(e.victim ?? e.who); const tm = S.team[e.victim]; R.deaths[tm]++; if (e.fleeing || (brokenTeam[tm] >= 0 && e.kind !== "kill") || (e.kind === "die" && e.cause === "finish")) R.routDeaths[tm]++; }
    else if (e.kind === "order-arrived") R.orders++;
  }
  if (R.firstContact < 0 && [...w.units.values()].some((u) => u.hold)) R.firstContact = w.time;
  if (R.footContact < 0 && [...w.units.values()].some((u) => u.hold && isFoot(u))) R.footContact = w.time;
  if (k % Math.round((+process.env.HG_EVERY || 300) / DT) === 0) {
    const n = [0, 0], f = [0, 0]; for (let i = 0; i < S.n; i++) if (S.alive[i]) { n[S.team[i]]++; if (S.status[i] === ST_FLEE) f[S.team[i]]++; if (!Number.isFinite(S.x[i])) throw new Error("NaN position"); }
    const st = w.cs?.stats || {};
    const us = [...w.units.values()].filter((u) => !u.isWorkers).map((u) => `${u.team ? "B" : "A"}:${u.arm.slice(0, 5)} ${u.members.length}${u.state === "formed" ? "" : " " + u.state}${process.env.HG_EVERY ? ` st${u.c?.stressM.toFixed(2)} b${u.c?.baseline.toFixed(2)} ${u.order.kind[0]}${u.hold ? "H" : ""} f${u.c?.fled}` : ""}`).join(", ");
    if (process.env.HG_DBG && R.cause) { console.log('  casualties:', JSON.stringify(R.cause)); R.cause = {}; }
    if (process.env.HG_DBG && w.cs) { if (w.cs.dbg) console.log('  stress in:', JSON.stringify(w.cs.dbg, (k, v) => typeof v === 'number' ? +v.toFixed(1) : v)); w.cs.dbg = {}; w.cs.dbgUnit = process.env.HG_DBG === 'unit'; }
    console.log(`t=${(w.time / 60).toFixed(0).padStart(3)} min  A ${n[0]} (${f[0]} fleeing)  B ${n[1]} (${f[1]} fleeing)  flurries ${st.flurries || 0}  legends ${R.legends.length}  | ${us}`);
  }
  // both armies spent? stop a while after
  if (w.time > 1800 && [0, 1].some((tm) => [...w.units.values()].filter((u) => u.team === tm && u.members.length).every((u) => u.state === "routing" || u.members.every((i) => S.status[i] === ST_FLEE)))) {
    if (!R.endAt) R.endAt = w.time + 1200; else if (w.time > R.endAt) break;
  }
}
const census = (tm) => { let n = 0, dead = 0, down = 0, capt = 0; for (let i = 0; i < S.n; i++) if (S.team[i] === tm) { n++; if (S.state[i] === S_DEAD || (S.state[i] === S_DOWN && S.sev[i] >= W_MORTAL)) dead++; else if (S.state[i] === S_DOWN) down++; else if (S.state[i] === S_CAPT) capt++; } return { n, dead, down, capt }; };
const cA = census(0), cB = census(1), st = w.cs.stats;
const loser = brokenTeam[0] >= 0 && (brokenTeam[1] < 0 || brokenTeam[0] < brokenTeam[1]) ? 0 : brokenTeam[1] >= 0 ? 1 : -1;
console.log(`\n=== Battle report (${dispA} vs ${dispB}, seed ${seed}) ===`);
console.log(`first contact ${(R.firstContact / 60).toFixed(0)} min; first army break ${loser >= 0 ? ((brokenTeam[loser] - R.firstContact) / 60).toFixed(0) + " min later (" + (loser ? "B" : "A") + ")" : "none"}`);
{ const fb = Math.min(...R.footBreak.filter((x) => x >= 0)); console.log(`the lines: foot met at ${R.footContact < 0 ? "never" : (R.footContact / 60).toFixed(0) + " min"}; first foot company broke ${Number.isFinite(fb) ? ((fb - R.footContact) / 60).toFixed(1) + " min after the lines met (" + (R.footBreak[0] === fb ? "A" : "B") + ")" : "never"}; men down before it: ${R.preCause.missile} to arrows, ${R.preCause.melee} in the melee`); }
console.log(`pulses: ${st.flurries} flurries, mean ${(st.flurryDur / Math.max(1, st.flurries)).toFixed(0)} s; mean lull ${(st.lullDur / Math.max(1, st.lulls)).toFixed(0)} s; contact fraction ${(st.flurrySecT / Math.max(1, st.secT) * 100).toFixed(0)}%`);
console.log(`charges ${st.charges}, horse refusals ${st.refusals}; arrows ${st.arrows} (${(st.arrowHits / Math.max(1, st.arrows) * 100).toFixed(0)}% struck a man)`);
console.log(`unit breaks ${R.breaks.length}, rallies ${R.rallies.length}, orders delivered ${R.orders} (lost ${w.command?.lost || 0}, garbled ${w.command?.garbled || 0}, misheard ${w.command?.misheard || 0})`);
for (const [nm, c, tm] of [["A", cA, 0], ["B", cB, 1]]) console.log(`${nm}: ${c.n} men — dead ${c.dead} (${(c.dead / c.n * 100).toFixed(1)}%), of which in rout/after break ${R.routDeaths[tm]}; wounded on the field ${c.down}; captured ${c.capt}`);
console.log(`legends: ${R.legends.length} (${R.legends.map((l) => `rank ${l.rank} at ${(l.t / 60).toFixed(0)} min`).join(", ")})`);
if (process.env.HG_ARMS) console.log(JSON.stringify(R.preArm));
