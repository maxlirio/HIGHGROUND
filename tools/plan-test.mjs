// Both towns start with only the keep; both AI generals build on their town plans. Prints what got built.
import fs from "node:fs";
import { loadMap } from "../js/sim/map.js";
import { createWorld, step, TICK } from "../js/sim/world.js";
import * as EC from "../js/sim/economy.js";
import { logisticsSystem } from "../js/sim/logistics.js";
import { setupResources } from "../js/sim/resources.js";
import { makeGeneral, generalThink } from "../js/sim/ai-general.js";
import { buildPlan } from "../js/sim/townplan.js";
import { TERRAIN } from "../js/sim/terrain-types.js";
const R = new URL("..", import.meta.url).pathname;
const fetcher = async (p) => { const b = fs.readFileSync(R + p); return { ok: true, json: async () => JSON.parse(b), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; };
const map = await loadMap("maps/vale", fetcher);
const objects = JSON.parse(fs.readFileSync(R + "maps/vale/objects.json")), settle = JSON.parse(fs.readFileSync(R + "maps/vale/settlements.json"));
const w = createWorld({ map, terrain: TERRAIN, seed: 3 });
EC.initEconomy(w);
const towns = [{ x: 780, y: 820 }, { x: 3300, y: 3300 }];
setupResources(w, { objectsJson: objects, towns, seed: 22 });
towns.forEach((t, i) => EC.makeTown(w, i, t.x, t.y, objects.objects, { prebuilt: false }));
w.plans = [0, 1].map((i) => buildPlan(i, settle.towns.find((s) => s.team === i), EC.fieldSites(w, i, w.teams[i].town.x, w.teams[i].town.y)));
w.systems.push(EC.economySystem, logisticsSystem);
const gens = [0, 1].map((t) => makeGeneral(w, t, { difficulty: 0.7, disposition: t ? "aggressive" : "defensive" }));
const MIN = +(process.argv[2] || 15);
for (let k = 1; k <= MIN * 60 / TICK; k++) {
  step(w); for (const G of gens) generalThink(w, G);
  if (k % (5 * 600) === 0) for (const T of w.teams) {
    const bs = w.buildings.filter((b) => b.team === T.id);
    const cnt = {}; for (const b of bs) { const key = b.kind + (b.progress < 1 ? "*" : ""); cnt[key] = (cnt[key] || 0) + 1; }
    const onPlan = bs.filter((b) => b.slot).length, off = bs.filter((b) => !b.slot && b.kind !== "town_hall" && !["lumber_camp", "mining_camp", "charcoal_kiln", "bloomery"].includes(b.kind));
    const u0 = bs.filter((b) => b.progress < 1).map((b) => `${b.kind}:${(b.progress * 100).toFixed(1)}%`).join(','); const jobs = {}; for (const u of w.units.values()) if (u.team === T.id && u.isWorkers) { const kk = u.job?.kind || '-'; jobs[kk] = (jobs[kk] || 0) + u.members.length; }
    console.log(`   building ${u0} | jobs ${JSON.stringify(jobs)} | soldiers ${EC.headcount(w, T.id).soldiers}`);
    console.log(`min ${k * TICK / 60} team ${T.id} day ${w.econ.doy.toFixed(0)} pop ${EC.headcount(w, T.id).labour} food ${Math.round(EC.foodStock(T))} | ${JSON.stringify(cnt)} | on plan ${onPlan}, off-plan ${off.length}`);
  }
}
