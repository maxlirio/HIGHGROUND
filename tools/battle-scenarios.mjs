// Headless pitched battles as ?mode=battle sets them up (js/sim/battle.js): each historical scenario (or a custom
// field) on the Vale, both sides fought by the battle AI with their commanders' tempers. Prints where the land
// reading put the field, the moments as they happen, the outcome, the decisive factor, the casualties by cause
// and the chronicle.
//   node tools/battle-scenarios.mjs [--only crecy,stirling] [--side 0|1] [--minutes 30] [--seed 1] [--quiet] [--passive (the player's side takes no orders)]
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadMap } from "../js/sim/map.js";
import { createWorld, step, DT, goingMul } from "../js/sim/world.js";
import { combatSystem } from "../js/sim/combat.js";
import { legendSystem } from "../js/sim/legend.js";
import { makeVision, updateVision } from "../js/sim/vision.js";
import { TERRAIN } from "../js/sim/terrain-types.js";
import { makeObstacles, loadVegetation, obstacleSystem } from "../js/sim/obstacles.js";
import { featuresFromMapData } from "../js/sim/features.js";
import { SCENARIOS, scenarioConfig } from "../js/sim/scenarios.js";
import { prepareField, setupBattle } from "../js/sim/battle.js";
import { commandBattle } from "../js/sim/commander-ai.js";
import { tellBattle } from "../js/sim/battle-story.js";
import { surveyField, describeField } from "../js/sim/battlefield.js";
import { makePlaces } from "../js/ui/places.js";
import { CAUSE } from "../js/sim/battle-record.js";
import { ARMS as ARMS_ } from "../js/sim/arms.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : process.argv[i + 1] ?? d; };
const ONLY = arg("only", Object.keys(SCENARIOS).join(",")).split(","), MIN = +arg("minutes", 30), SEED = +arg("seed", 1), QUIET = process.argv.includes("--quiet"), PASSIVE = process.argv.includes("--passive"), SIDE = arg("side", null);
const fetcher = async (u) => { try { const b = await readFile(ROOT + u); return { ok: true, json: async () => JSON.parse(b), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; } catch { return { ok: false }; } };
const json = async (u) => JSON.parse(await readFile(ROOT + u, "utf8"));
const [veg, objects, settle] = await Promise.all(["maps/vale/vegetation.json", "maps/vale/objects.json", "maps/vale/settlements.json"].map(json));
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

for (const id of ONLY) {
  const map = await loadMap("maps/vale", fetcher); // (fresh: the field's tweaks change the map)
  const places = makePlaces(map, settle);
  const cfg = scenarioConfig(map, id, SIDE === null ? null : +SIDE); // (--side: which side is the "player" — the other is the enemy AI)
  prepareField(map, cfg);
  const w = createWorld({ map, terrain: TERRAIN, seed: SEED });
  const V = makeVision(map); V.every = 10;
  w.obstacles = makeObstacles(); loadVegetation(w.obstacles, veg); w.features = featuresFromMapData(objects, veg);
  w.systems.push(combatSystem, legendSystem, (w) => updateVision(w, V, map.canopyGrid ? map.canopy : null), obstacleSystem);
  w.teams.forEach((T) => { T.store ||= null; });
  const B = setupBattle(w, cfg, { PLAYER: 0, V, places });
  // the player's side fought by the AI too, with its own commander's temper
  const ps = cfg.playerSide, mine = { team: 0, units: new Set(B.units[ps].filter((u) => !u.lurking).map((u) => u.id)), disposition: cfg.sides[ps].temper || "inspiring", V };
  if (["defensive", "inspiring"].includes(mine.disposition)) { let x = 0, y = 0, n = 0; for (const u of B.units[ps]) if (!u.lurking) { x += u.ax * u.members.length; y += u.ay * u.members.length; n += u.members.length; } mine.battle = { phase: "hold", defend: true, centre: { x: x / n, y: y / n }, face: B.zones[ps].face, aimAt: { x: B.zones[1 - ps].cx, y: B.zones[1 - ps].cy }, t0: 0 }; }
  w.systems.push((w) => { if (B.phase !== "deploy" && !PASSIVE) { for (const u of B.units[ps]) if (u.sprung && !mine.units.has(u.id)) mine.units.add(u.id); commandBattle(w, mine); } });
  const R = surveyField(map, cfg.site, cfg.axis);
  console.log(`\n=== ${cfg.name} (${cfg.year}) — ${places.at(cfg.site.x, cfg.site.y).phrase}, axis ${Math.round(cfg.axis * 180 / Math.PI)}° ${cfg._tweaks.bridge ? "· bridge built" : ""}${cfg._tweaks.brooks.length ? " · " + cfg._tweaks.brooks.map((b) => b.name).join(", ") + " cut" : ""}`);
  for (const l of describeField(R, 0, [cfg.sides[0].name, cfg.sides[1].name])) console.log(`   ${l.tone === "good" ? "+" : l.tone === "bad" ? "-" : "·"} ${l.text}`);
  console.log(`   ${cfg.sides[0].name}: ${B.rec.start[B.teamOf(0)]} men (${cfg.sides[0].temper}) vs ${cfg.sides[1].name}: ${B.rec.start[B.teamOf(1)]} men (${cfg.sides[1].temper})`);
  B.onMoment = (m) => { if (!QUIET || m.sal >= 0.7) console.log(`   ${mmss(m.t).padStart(6)}  [${m.kicker}] ${m.text}`); };
  B.advance();
  const t0 = Date.now();
  if (process.env.PROBE) { const K = B.units[B.aiSide].find((u) => u.arm === "knights"); const sys0 = w.systems.slice(); w.systems.length = 0;
    for (const [i, f] of sys0.entries()) w.systems.push((w) => { const a = [K.ax, K.ay]; f(w); if (w.tick > 1500 && w.tick < 1504 && (K.ax !== a[0] || K.ay !== a[1])) console.log("  sys", i, f.name || "anon", "moved K", a.map(Math.round), "→", Math.round(K.ax), Math.round(K.ay)); });
    const pre = w.systems.unshift((w) => { if (w.tick > 1500 && w.tick < 1504) console.log("  tick", w.tick, "K after moveUnit", K.ax.toFixed(2), K.ay.toFixed(2), "path", JSON.stringify(K.path)); }); }
  for (let k = 0; k < MIN * 60 / DT; k++) { step(w);
    if (process.env.TRACE && k % 600 === 0) { const c = B.rec.centreOf(B.cmd.team), b = B.cmd.battle; console.log(`     t${(k * DT / 60).toFixed(0)} ai@${c ? Math.round(c.x) + "," + Math.round(c.y) : "-"} phase ${b?.phase} centre ${b?.centre ? Math.round(b.centre.x) + "," + Math.round(b.centre.y) : "-"} halted ${b?.halted} defend ${b?.defend} foes seen ${b ? B.cmd.seen?.size : 0}`); if (process.env.TRACE === '2') for (const u of B.units[B.aiSide]) if (u.members.length) console.log(`        ${u.arm} ${u.members.length} @${Math.round(u.ax)},${Math.round(u.ay)} ${u.state} ord ${u.order?.kind}${u.order?.target ?? ''} pace ${u.pace} path ${u.path?.length} pend ${!!u.pendingOrder} hold ${u.hold} c.phase ${u.c?.phase} sm ${u.speedMul} run ${u.runSpeed} moving ${u.moving} stall ${u.stallS?.toFixed(1)} tgt@${u.path?.[0]?.map(Math.round)} vx ${w.S.vx[u.members[0]].toFixed(2)} st ${w.S.state[u.members[0]]} disp ${u.disengage} g ${u.path?.[0] ? goingMul(w, ARMS_[u.arm].id, u.ax, u.ay, u.path[0][0] - u.ax, u.path[0][1] - u.ay).toFixed(3) : '-'}`); } if (B.rec.outcome && w.time - B.rec.t0 > B.rec.outcome.t + 120) break; }
  const O = B.rec.outcome; B.rec.finalise();
  const story = tellBattle(w, B.rec, { names: B.names, weather: cfg.weather, tod: cfg.tod, where: B.names.place(cfg.site.x, cfg.site.y), rise: [R.rise[B.sideOf(0)], R.rise[B.sideOf(1)]], objective: true });
  console.log(`   → ${O ? (O.winner < 0 ? "DRAW" : B.names.side(O.winner) + " WIN") + " at " + mmss(O.t) + ": " + O.why : "undecided after " + MIN + " min"}  (${((Date.now() - t0) / 1000).toFixed(0)} s wall)`);
  for (const tm of [0, 1]) { const C = B.rec.cas[tm]; console.log(`   ${B.names.side(tm)}: ${C.dead} killed, ${C.wounded} wounded, ${C.captured} taken, ${C.fled} fled · ${Object.entries(C.byCause).map(([k, v]) => `${CAUSE[k]} ${v}`).join(", ")}`); }
  console.log(`   FACTOR: ${story.factor.text}`);
  console.log(`   CHRONICLE: ${story.chronicle}`);
  if (story.legends[0]) console.log(`   LEGEND: ${story.legends[0].name} (${story.legends[0].arm}) ${story.legends[0].deed || ""} — ${story.legends[0].kills} felled`);
}
