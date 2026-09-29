// Match pacing check: the game as the browser sets it up (keep-only start on the town plans, the
// player's reeve runs the village), the enemy general at a chosen difficulty/disposition, and the
// player either PASSIVE (the retinue stands at home — the worst case for reaching a decision) or
// played by a defensive AI general. Prints when the enemy marches, fights, besieges, and when (if)
// a side loses by the game's rules (keep ruined / town fallen / no soldiers and no villagers).
//   node tools/match-pace.mjs [--minutes 90] [--seed 1] [--diff 0.7] [--disp aggressive] [--player passive|ai]
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadMap, placeholderMap } from "../js/sim/map.js";
import { createWorld, step, TICK } from "../js/sim/world.js";
import { combatSystem } from "../js/sim/combat.js";
import { legendSystem } from "../js/sim/legend.js";
import { makeVision, updateVision } from "../js/sim/vision.js";
import * as EC from "../js/sim/economy.js";
import { logisticsSystem } from "../js/sim/logistics.js";
import { convoySystem } from "../js/sim/convoys.js";
import { setupResources } from "../js/sim/resources.js";
import { makeGeneral, generalThink, reeveThink } from "../js/sim/ai-general.js";
import { buildPlan } from "../js/sim/townplan.js";
import { matchOutcome } from "../js/sim/match.js";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : process.argv[i + 1] ?? true; };
const MINUTES = +arg("minutes", 90), SEED = +arg("seed", 1), DIFF = +arg("diff", 0.7), DISP = arg("disp", "aggressive"), PLAYER = arg("player", "passive");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const fetcher = async (p) => {
  try { const b = await readFile(ROOT + p); return { ok: true, json: async () => JSON.parse(b.toString()), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; }
  catch { return { ok: false, json: async () => { throw new Error("missing " + p); }, arrayBuffer: async () => { throw new Error("missing " + p); } }; }
};
const json = async (p) => { const r = await fetcher(p); return r.ok ? r.json() : null; };
let TERRAIN = {}; try { TERRAIN = (await import("../js/sim/terrain-types.js")).TERRAIN || {}; } catch { /* optional */ }

let map; try { map = await loadMap("maps/vale", fetcher); } catch { map = placeholderMap(); }
const objData = await json("maps/vale/objects.json"), settle = await json("maps/vale/settlements.json");
const w = createWorld({ map, terrain: TERRAIN, seed: SEED });
const V = makeVision(map); V.every = 30;
w.systems.push(combatSystem, legendSystem, EC.economySystem, logisticsSystem, convoySystem, (w) => updateVision(w, V));
EC.initEconomy(w);
let towns = (map.meta?.features || []).filter((f) => f.type === "town_site").map((f) => ({ x: f.xy_m[0], y: f.xy_m[1] }));
if (towns.length < 2) towns = [{ x: 780, y: 820 }, { x: 3300, y: 3300 }];
setupResources(w, { objectsJson: objData, towns, seed: SEED * 7 + 1 });
towns.slice(0, 2).forEach((t, i) => EC.makeTown(w, i, t.x, t.y, objData?.objects || [], { prebuilt: false }));
w.plans = [0, 1].map((i) => { const T = w.teams[i]; return buildPlan(i, settle?.towns?.find((s) => s.team === i) || {}, EC.fieldSites(w, i, T.town.x, T.town.y)); });
w.systems.push((w) => { // soldiers helping on a building site (as main.js)
  if (w.tick % 10) return;
  for (const u of w.units.values()) if (u.helping) { const b = w.buildings.find((x) => x.id === u.helping); if (!b || b.ruin || b.progress >= 1) u.helping = null; }
});
const enemy = makeGeneral(w, 1, { difficulty: DIFF, disposition: DISP, V });
const gens = [enemy];
let reeve = null;
if (PLAYER === "ai") gens.unshift(makeGeneral(w, 0, { difficulty: 0.7, disposition: "defensive", V }));
else { reeve = makeGeneral(w, 0, { difficulty: 0.7, disposition: "defensive", V }); reeve.econEvery = 60; reeveThink(w, reeve, true); }
console.log(`match-pace: seed ${SEED}, enemy ${DISP} @${DIFF}, player ${PLAYER}, ${MINUTES} min`);
const ticks = Math.round(MINUTES * 60 / TICK); let logged = 0, out = null; const t0 = performance.now();
const dead = [0, 0];
for (let t = 1; t <= ticks; t++) {
  step(w); for (const G of gens) generalThink(w, G); if (reeve) reeveThink(w, reeve);
  for (const e of w.events) {
    if (e.kind === "kill") dead[w.S.team[e.victim]]++;
    if (e.kind === "town-fell" || e.kind === "siege-begins" || e.kind === "siege-lifted") console.log(`  ⚑ ${(t * TICK / 60).toFixed(1)} min: ${w.teams[e.team].name} ${e.kind}${e.why ? " — " + e.why : ""}`);
  }
  while (logged < enemy.log.length) { const l = enemy.log[logged++]; if (!/builds|raises|segment|gate/.test(l.msg)) console.log(`  · ${(l.tick * TICK / 60).toFixed(1)} min (day ${l.day.toFixed(0)}) enemy: ${l.msg}`); }
  if (t % 3000 === 0) {
    const s = (tm) => { let n = 0; for (const u of w.units.values()) if (u.team === tm && !u.isWorkers) n += u.members.length; return n; };
    console.log(`t=${(t * TICK / 60).toFixed(0)} min  soldiers ${s(0)} v ${s(1)}  killed ${dead[0]} v ${dead[1]}  enemy mode ${enemy.mode}${enemy.sub ? "/" + enemy.sub : ""}`);
  }
  if (t % 50 === 0 && (out = matchOutcome(w))) break;
}
console.log(out ? `DECIDED at ${(w.tick * TICK / 60).toFixed(1)} min: ${w.teams[out.winner].name} wins — ${out.why}` : `no decision in ${MINUTES} min`);
console.log(`${((performance.now() - t0) / w.tick).toFixed(2)} ms/tick`);
