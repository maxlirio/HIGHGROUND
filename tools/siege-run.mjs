// Headless AI-vs-AI sieges as ?mode=siege sets them up (js/sim/siege-war.js, js/sim/siege-ai.js): a castle on the
// Vale, the garrison and the besieging host, both run by the siege generals. Days pass on the econ clock while the
// sides are in their lines (passDays); assaults are fought tick by tick. Asserts, per siege:
//   · no NaN in any living man's position
//   · headcount conserved (the men in the hosts = the roster; start + drafted = alive + lost; nobody conjured)
//   · the siege ends with a legitimate outcome (taken | terms | starved | relieved | abandoned) within the cap
//   · both generals act (besieger: bombard/mine/works/storm…, garrison: man/barricade/sally/reserve/fallback…)
//   node tools/siege-run.mjs [--layouts hill,concentric,river] [--seeds 1,2] [--force strong] [--season summer]
//                            [--provision 45] [--relief] [--days 150] [--v]
// Run it through tools/heavy.sh.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadMap } from "../js/sim/map.js";
import { createWorld, step } from "../js/sim/world.js";
import { combatSystem } from "../js/sim/combat.js";
import { legendSystem } from "../js/sim/legend.js";
import { TERRAIN } from "../js/sim/terrain-types.js";
import { makeObstacles, loadVegetation, obstacleSystem } from "../js/sim/obstacles.js";
import { featuresFromMapData } from "../js/sim/features.js";
import * as EC from "../js/sim/economy.js";
import { ensureSiege, siegeSystem } from "../js/sim/siege.js";
import * as SW from "../js/sim/siege-war.js";
import { installSiegeAI } from "../js/sim/siege-ai.js";
import { makePlaces } from "../js/ui/places.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : process.argv[i + 1] ?? d; };
const LAYOUTS = arg("layouts", "hill,concentric,river").split(","), SEEDS = arg("seeds", "1").split(",").map(Number);
const FORCE = arg("force", "strong"), SEASON = arg("season", "summer"), PROV = +arg("provision", 45), RELIEF = process.argv.includes("--relief"), CAP = +arg("days", 150), V = process.argv.includes("--v");
const fetcher = async (u) => { try { const b = await readFile(ROOT + u); return { ok: true, json: async () => JSON.parse(b), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; } catch { return { ok: false }; } };
const json = async (u) => JSON.parse(await readFile(ROOT + u, "utf8"));
const [veg, objects, settle] = await Promise.all(["maps/vale/vegetation.json", "maps/vale/objects.json", "maps/vale/settlements.json"].map(json));
let castleApi = null; try { castleApi = await import("../js/sim/castle.js"); } catch { castleApi = null; }
console.log(`castle.js: ${castleApi?.castleFromLayout ? "castleFromLayout present" : "absent — fallback castles"}`);
const OUTCOMES = new Set(["taken", "terms", "starved", "relieved", "abandoned"]);
const fails = []; const results = [];
const map0 = await loadMap("maps/vale", fetcher);
const places = makePlaces(map0, settle);

for (const layout of LAYOUTS) for (const seed of SEEDS) {
  const t0 = Date.now(), tag = `${layout}#${seed}`;
  const map = map0;
  const w = createWorld({ map, terrain: TERRAIN, seed });
  w.obstacles = makeObstacles(); loadVegetation(w.obstacles, veg); w.features = featuresFromMapData(objects, veg);
  w.systems.push(combatSystem, legendSystem, obstacleSystem);
  ensureSiege(w); w.systems.push(siegeSystem);
  EC.initEconomy(w);
  let site = castleApi?.castleSite?.(map, layout) || null; site = site ? { ...site, facing: SW.approachOf(map, site.x, site.y, layout) } : SW.castleSite(map, layout);
  const F = SW.FORCES[FORCE];
  const cfg = { castle: layout, site, playerSide: "attack", garrison: F.garrison, besiegers: F.besiegers, train: F.train, season: SEASON, provision: PROV, relief: RELIEF, names: ["Ashby", "Rookham"], autoPlayer: true };
  const G = SW.setupSiege(w, cfg, { PLAYER: 0, places, castleApi });
  installSiegeAI(w, G);
  if (V) G.onNote = (e) => console.log(`   d${e.day.toFixed(1).padStart(5)}  [${e.kicker}] ${e.text}`);
  const hc0 = SW.headcount(w, G);
  console.log(`\n=== ${tag}: ${G.name} (${SW.LAYOUTS[layout].name}) at ${Math.round(site.x)},${Math.round(site.y)} facing ${Math.round(site.facing * 57.3)}° — ${hc0.start[G.def]} garrison vs ${hc0.start[G.att]} besiegers, ${G.castle.sections.length} stretches, ${G.castle.gates.length} gates, ${G.castle.real ? "castle.js" : "fallback"}`);
  let nanAt = null, hcBad = null, realTicks = 0, ffDays = 0, assaultsSeen = 0, maxInside = 0;
  const check = () => {
    const S = w.S;
    for (let i = 0; i < S.n; i++) if (S.alive[i] && !(Number.isFinite(S.x[i]) && Number.isFinite(S.y[i]))) { nanAt ??= { i, day: SW.siegeDay(w, G) }; break; }
    const hc = SW.headcount(w, G);
    for (const tm of [0, 1]) if (hc.alive[tm] !== hc.inUnits[tm] || hc.start[tm] + hc.added[tm] !== hc.alive[tm] + hc.lost[tm]) hcBad ??= { tm, ...hc, day: SW.siegeDay(w, G) };
  };
  const nearWalls = () => { const C = G.castle; for (const u of G.units[G.att]) if (u.members.length && Math.hypot(u.ax - C.x, u.ay - C.y) < 170 && u.role !== "miners" && u.role !== "guard" && !(u.engine !== undefined && u.arm !== "ram" && u.arm !== "siege_tower")) return true; return false; };
  // --assaults: per assault, what became of the stormers (fallen by cause, broken, over the wall) — a balance check
  const AS = process.argv.includes("--assaults"), aRep = []; let aCur = null;
  if (AS) w.systems.push((w) => {
    const S = w.S;
    if (G.assault?.on && !aCur) { if (w.cs) w.cs.dbg = {}; aCur = { day: SW.siegeDay(w, G), t0: w.time, n: 0, how: G.assault.how, fell: {}, over: 0, broke: 0 }; for (const u of G.units[G.att]) if (u.role === "assault" || u.role === "gateParty" || u.role === "towerParty" || u.role === "feint") aCur.n += u.members.length; }
    if (!aCur) return;
    for (const e of w.events) if ((e.kind === "kill" || e.kind === "down") && S.team[e.victim] === G.att) { const c = e.cause || "?"; aCur.fell[c] = (aCur.fell[c] || 0) + 1; }
    aCur.over = Math.max(aCur.over, G.now?.attIn || 0);
    if (w.tick % 20 === 0) { let b = 0; for (const u of G.units[G.att]) if (u.members.length && u.state === "routing") b += u.members.length; aCur.broke = Math.max(aCur.broke, b); }
    if (!G.assault?.on || G.outcome) { aCur.s = Math.round(w.time - aCur.t0); const D = w.cs?.dbg?.[G.att]; if (D) { aCur.stress = {}; for (const [k, v] of Object.entries(D)) aCur.stress[k] = Math.round(v * 10) / 10; } if (w.cs) w.cs.dbg = null; aRep.push(aCur); aCur = null; }
  });
  let guard = 0;
  while (!G.outcome && SW.siegeDay(w, G) < CAP && guard++ < 100000) {
    const sallying = (w.siege.works?.sallies || []).some((q) => q.phase !== "done");
    const fighting = G.assault?.on || G.phase === "inside" || G.phase === "keep" || G.phase === "assault" || sallying || nearWalls();
    const tt = Date.now();
    if (!fighting) { const r = SW.passDays(w, G, 1); ffDays += r.days; }
    else { for (let k = 0; k < 50 && !G.outcome; k++) step(w); realTicks += 50; if (G.assault?.on) assaultsSeen = G.stats.assaults; }
    if (process.env.TRACE && (Date.now() - tt > 1500 || guard % (fighting ? 60 : 10) === 0)) console.log(`     [trace] day ${SW.siegeDay(w, G).toFixed(1)} ${G.phase} ${fighting ? "FIGHT" : "ff"} ${Date.now() - tt} ms · men ${w.S.n} · inside ${G.now?.attIn} near ${G.now?.attNear} keep ${G.now?.defKeep}/${G.now?.attKeep}`);
    if (G.now) maxInside = Math.max(maxInside, G.now.attIn || 0);
    check();
    if (realTicks > 45 * 60 * 10) { // (45 minutes of storming in one siege: something is stuck)
      if (!G.outcome) SW.end(w, G, G.def, "abandoned", "harness cap: 45 minutes of real-time fighting");
    }
  }
  const day = SW.siegeDay(w, G), O = G.outcome, hc = SW.headcount(w, G);
  const acts = [G.ai[G.att].acts || {}, G.ai[G.def].acts || {}];
  const actsN = acts.map((a) => Object.values(a).reduce((s, v) => s + v, 0));
  const r = { tag, outcome: O?.how || "none", winner: O ? (O.winner === G.att ? "besiegers" : "garrison") : "-", day: Math.round(day * 10) / 10, why: O?.why, wall: ((Date.now() - t0) / 1000).toFixed(1), real: Math.round(realTicks / 600), ff: Math.round(ffDays), hc, acts, stats: G.stats };
  results.push(r);
  console.log(`   → ${O ? `${r.winner.toUpperCase()} (${O.how}) on day ${r.day}: ${O.why}` : `NO OUTCOME by day ${r.day}`}`);
  console.log(`   ${r.ff} days passed · ${r.real} min fought · ${G.stats.assaults} assaults (${G.stats.failed} failed) · breaches ${G.stats.breaches} · mines ${SW.minesOf(w, G).map((m) => m.state === "digging" ? Math.round(m.dug / m.len * 100) + "%" : m.state).join(",") || "none"} · barricades ${(w.siege.works?.barricades || []).filter((q) => q.team === G.def).map((q) => q.state).join(",") || "none"} · sallies ${G.stats.sallies} · engines burnt ${G.stats.burnt} · most inside ${maxInside} · sick ${G.stats.sick[G.att]} · deserted ${G.stats.deserted.join("/")} · food ${Math.round(G.food / Math.max(1, hc.alive[G.def]))} d left · wall ${r.wall}s`);
  console.log(`   besieger acts ${JSON.stringify(acts[0])} · garrison acts ${JSON.stringify(acts[1])}`);
  console.log(`   men: garrison ${hc.start[G.def]}→${hc.alive[G.def]} (lost ${hc.lost[G.def]}), besiegers ${hc.start[G.att]}+${hc.added[G.att]}→${hc.alive[G.att]} (lost ${hc.lost[G.att]})`);
  if (AS) for (const a of aRep) console.log(`   assault d${a.day.toFixed(1)} (${a.how}): ${a.n} stormers, ${a.s} s · fell ${JSON.stringify(a.fell)} · most broken at once ${a.broke} · most inside ${a.over}${a.stress ? " · stress " + JSON.stringify(a.stress) : ""}`);
  const bad = (m) => { fails.push(`${tag}: ${m}`); console.log(`   FAIL ${m}`); };
  if (nanAt) bad(`NaN position (man ${nanAt.i}, day ${nanAt.day.toFixed(1)})`);
  if (hcBad) bad(`headcount not conserved: ${JSON.stringify(hcBad)}`);
  if (!O) bad(`no outcome within ${CAP} days`); else if (!OUTCOMES.has(O.how)) bad(`illegitimate outcome ${O.how}`);
  if (O && O.why?.startsWith("harness cap")) bad("stuck in real-time fighting");
  if (actsN[0] < 3) bad(`the besieger hardly acted (${actsN[0]})`);
  if (actsN[1] < 1) bad(`the garrison never acted (${actsN[1]})`);
  if (!nanAt && !hcBad && O && OUTCOMES.has(O.how) && actsN[0] >= 3 && actsN[1] >= 1) console.log("   PASS");
}
console.log(`\n${results.length - new Set(fails.map((f) => f.split(":")[0])).size}/${results.length} sieges passed`);
for (const f of fails) console.log("  " + f);
const tally = {}; for (const r of results) tally[r.outcome] = (tally[r.outcome] || 0) + 1; console.log("outcomes:", JSON.stringify(tally));
process.exit(fails.length ? 1 : 0);
