// Headless FULL MATCH as the game now stands: both towns start keep-only and grow on their town
// plans (as js/main.js sets them up), both run by AI generals, on maps/vale (placeholder map if absent).
//
// HARD invariants, every tick (the run aborts): stores ≥ 0 and finite, census ledger balanced, no NaN
// positions (men or unit anchors), node amounts ≥ 0, building progress in [0,1] and hp finite.
// SOFT invariants (collected, printed; --strict makes them fatal):
//   • stuck   — a unit with a path that has made no headway for 2 real minutes
//   • idle    — a village with most of its hands idle (home beyond the reeve's reserve, or on a dead job) > 2 min
//   • offplan — a building not on its plan's slot (camps by their resource and the keep excepted)
//   • overlap — two buildings' footprints overlapping
// Prints a timeline every 5 real minutes and, at the end, whether the match was decided and why not.
//   node tools/playtest.mjs [--minutes 90] [--seeds 1,2,3,4 | --seed 1] [--prebuilt] [--reeve] [--det]
//                           [--strict] [--d0 defensive] [--d1 aggressive] [--diff 0.7] [--no-obstacles]
//   --prebuilt  the old start (whole village standing)    --reeve  team 0 is the player's reeve only (idle player)
//   --det       rerun the first seed and compare state hashes (determinism)
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadMap, placeholderMap } from "../js/sim/map.js";
import { createWorld, step, TICK } from "../js/sim/world.js";
import { combatSystem } from "../js/sim/combat.js";
import { legendSystem } from "../js/sim/legend.js";
import { makeVision, updateVision } from "../js/sim/vision.js";
import * as EC from "../js/sim/economy.js";
import { logisticsSystem } from "../js/sim/logistics.js";
import { convoySystem } from "../js/sim/convoys.js";
import { setupResources } from "../js/sim/resources.js";
import { makeGeneral, generalThink, reeveThink, leanTimes } from "../js/sim/ai-general.js";
import { buildPlan, stageStatus, NEAR_RESOURCE } from "../js/sim/townplan.js";
import { makeObstacles, loadVegetation, loadObjects, obstacleSystem } from "../js/sim/obstacles.js";
import { featuresFromMapData } from "../js/sim/features.js";
import { siegeSystem, ensureSiege } from "../js/sim/siege.js";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : process.argv[i + 1] ?? true; };
const flag = (k) => process.argv.includes("--" + k);
const MINUTES = +arg("minutes", 90), DIFF = +arg("diff", 0.7);
const SEEDS = String(arg("seeds", arg("seed", "1"))).split(",").map(Number);
const DISP = [arg("d0", "defensive"), arg("d1", "aggressive")];
const PREBUILT = flag("prebuilt"), REEVE = flag("reeve"), STRICT = flag("strict"), OBST = !flag("no-obstacles");
const ROOT = fileURLToPath(new URL("..", import.meta.url));

const fetcher = async (p) => {
  try { const b = await readFile(ROOT + p); return { ok: true, json: async () => JSON.parse(b.toString()), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; }
  catch { return { ok: false, json: async () => { throw new Error("missing " + p); }, arrayBuffer: async () => { throw new Error("missing " + p); } }; }
};
const json = async (p) => { try { const r = await fetcher(p); return r.ok ? await r.json() : null; } catch { return null; } };
let TERRAIN = {};
try { TERRAIN = (await import("../js/sim/terrain-types.js")).TERRAIN || {}; } catch { /* optional */ }
let matchOutcome = null;
try { ({ matchOutcome } = await import("../js/sim/match.js")); } catch { /* older tree */ }

export async function setup(seed, { prebuilt = PREBUILT, reeve = REEVE, obstacles = OBST } = {}) {
  let map;
  try { map = await loadMap("maps/vale", fetcher); } catch { map = placeholderMap(); }
  const [objects, veg, settle, footprints] = await Promise.all(["maps/vale/objects.json", "maps/vale/vegetation.json", "maps/vale/settlements.json", "assets/footprints.json"].map(json));
  const w = createWorld({ map, terrain: TERRAIN, seed });
  const V = makeVision(map); V.every = 30; // fog refresh every 3 real s is plenty for the generals
  w.systems.push(combatSystem, legendSystem, EC.economySystem, logisticsSystem, convoySystem, (w) => updateVision(w, V));
  if (obstacles) { // as main.js: trunks and landmarks are physical, and so is every building once staked out
    w.obstacles = makeObstacles();
    if (veg) loadVegetation(w.obstacles, veg);
    if (objects) loadObjects(w.obstacles, { objects: objects.objects.filter((o) => o.team === undefined || o.team === null) }, footprints || {});
    w.systems.push(obstacleSystem);
    w.features = featuresFromMapData(objects, veg);
    const solid = new Set();
    w.systems.push((w) => {
      if (w.tick % 20) return;
      for (const b of w.buildings) {
        if (solid.has(b.id) || b.field) continue; solid.add(b.id);
        if (b.x1 !== undefined || b.kind === "gate" || b.kind === "gatehouse") continue; // walls and gates: siege.js barriers
        const m = (footprints || {})[b.kind === "house" ? ["house_a", "house_b", "house_c"][b.id % 3] : b.kind];
        loadObjects(w.obstacles, { objects: [{ asset: b.kind, x: b.x, y: b.y, rot: b.rot || 0 }] }, m ? { [b.kind]: m } : {});
      }
    });
  }
  ensureSiege(w); w.systems.push(siegeSystem); // as main.js
  EC.initEconomy(w);
  let towns = (map.meta?.features || []).filter((f) => f.type === "town_site").map((f) => ({ x: f.xy_m[0], y: f.xy_m[1] }));
  if (towns.length < 2) towns = [{ x: 780, y: 820 }, { x: 3300, y: 3300 }];
  setupResources(w, { objectsJson: objects, towns, seed: seed * 7 + 1 });
  towns.slice(0, 2).forEach((t, i) => EC.makeTown(w, i, t.x, t.y, objects?.objects || [], { prebuilt }));
  if (!prebuilt) w.plans = [0, 1].map((i) => { const T = w.teams[i]; return buildPlan(i, settle?.towns?.find((s) => s.team === i) || {}, EC.fieldSites(w, i, T.town.x, T.town.y)); });
  const gens = [0, 1].map((t) => makeGeneral(w, t, { difficulty: DIFF, disposition: DISP[t], V }));
  let brains;
  if (reeve) { const R = gens[0]; R.econEvery = 60; reeveThink(w, R, true); brains = () => { generalThink(w, gens[1]); reeveThink(w, R); }; }
  else brains = () => { for (const G of gens) generalThink(w, G); };
  return { w, gens, V, brains, objects: !!objects, mapName: map.meta?.name || "placeholder" };
}

// ────────────────────────────────────────────────────────── hard invariants
function fail(w, msg) { throw new Error(`INVARIANT @tick ${w.tick} (${(w.tick * TICK / 60).toFixed(1)} min, day ${w.econ.doy.toFixed(2)}): ${msg}`); }
function invariants(w) {
  const S = w.S;
  for (const T of w.teams) {
    for (const [k, v] of Object.entries(T.store)) if (!(v >= 0) || !isFinite(v)) fail(w, `team ${T.id} store.${k} = ${v}`);
    for (const k of ["dependants", "squires", "ration", "unrest"]) if (!(T[k] >= 0) || !isFinite(T[k])) fail(w, `team ${T.id} ${k} = ${T[k]}`);
    if (T.census.inTraining < 0) fail(w, `team ${T.id} inTraining < 0`);
    const c = EC.census(w, T.id); if (!c.ok) fail(w, `team ${T.id} census ${c.inflow} in ≠ ${c.accounted} accounted (${JSON.stringify(T.census)}, alive ${c.alive}, casualties ${c.casualties}, dep ${T.dependants}, sq ${T.squires})`);
  }
  for (let i = 0; i < S.n; i++) if (S.alive[i] && !(isFinite(S.x[i]) && isFinite(S.y[i]))) fail(w, `soldier ${i} NaN position`);
  for (const u of w.units.values()) if (u.members.length && !(isFinite(u.ax) && isFinite(u.ay))) fail(w, `unit ${u.id} (${u.arm}) NaN anchor`);
  for (const n of w.resources) if (!(n.amount >= 0)) fail(w, `node ${n.id} amount ${n.amount}`);
  for (const b of w.buildings) if (!(b.progress >= 0 && b.progress <= 1) || !isFinite(b.hp)) fail(w, `building ${b.id} ${b.kind} progress ${b.progress} hp ${b.hp}`);
  for (const u of w.units.values()) if (u.supply && !(u.supply.food >= 0 && isFinite(u.supply.food))) fail(w, `unit ${u.id} supply.food ${u.supply.food}`);
}

// ────────────────────────────────────────────────────────── soft invariants
const CAMP = new Set(Object.keys(NEAR_RESOURCE));
const FIGHT_PHASES = new Set(["approach", "charge", "melee", "pursuit", "recoil"]);
function makeWatch() { return { units: new Map(), idle: [null, null], seenB: new Set(), issues: [], counts: {} }; }
function issue(W, w, kind, msg) {
  W.counts[kind] = (W.counts[kind] || 0) + 1;
  if (W.issues.filter((x) => x.kind === kind).length < 12) W.issues.push({ kind, min: +(w.tick * TICK / 60).toFixed(1), msg });
}
const deadJob = (u) => {
  const j = u.job; if (!j) return false;
  if (j.kind === "build") return !j.b || j.b.ruin || (j.b.progress >= 1 && j.b.hp >= j.b.hpMax);
  if (j.kind === "craft") return !j.b || !EC.complete(j.b) || !j.b.make || !!j.b.blocked;
  if (j.kind === "gather") return !j.node || j.node.amount <= 0;
  if (j.kind === "field") return !j.b?.field || !(j.b.field.state === "ripe" || j.b.field.state === "growing");
  return false;
};
function footRect(b) {
  if (b.x1 !== undefined) return null;
  const fp = b.field ? [b.w, b.h] : EC.BUILDINGS[b.kind]?.footprint || [10, 8], c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0), hw = fp[0] / 2 - 0.5, hh = fp[1] / 2 - 0.5;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([a, q]) => [b.x + a * c - q * s, b.y + a * s + q * c]);
}
function overlap(A, B) {
  for (const P of [A, B]) for (let i = 0; i < 4; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % 4], ax = -(y2 - y1), ay = x2 - x1;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, y] of A) { const d = x * ax + y * ay; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const [x, y] of B) { const d = x * ax + y * ay; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 <= b0 || b1 <= a0) return false;
  }
  return true;
}
function softChecks(W, w) {
  const every = 100; // 10 real s
  // stuck units: a path and no headway for 2 real minutes (combat-locked men are combat's business)
  for (const u of w.units.values()) {
    if (!u.members.length || u.job) { W.units.delete(u.id); continue; }
    const pathLen = u.path?.length || 0;
    let r = W.units.get(u.id);
    if (!r || !pathLen) { W.units.set(u.id, { x: u.ax, y: u.ay, t: w.tick, n: pathLen, reported: r?.reported }); continue; }
    const fighting = (u.c && FIGHT_PHASES.has(u.c.phase)) || u.members.some((id) => w.S.state[id] === 2 /* S_FIGHT */);
    if (Math.hypot(u.ax - r.x, u.ay - r.y) > 4 || pathLen < r.n || fighting || u.hold) { r.x = u.ax; r.y = u.ay; r.t = w.tick; r.n = pathLen; continue; }
    if (w.tick - r.t > 1200 && !r.reported) {
      r.reported = true;
      const [px, py] = u.path[0];
      issue(W, w, "stuck", `team ${u.team} unit ${u.id} ${u.arm}×${u.members.length} at (${u.ax.toFixed(0)},${u.ay.toFixed(0)}) order ${u.order?.kind} → (${(u.order?.x ?? 0).toFixed(0)},${(u.order?.y ?? 0).toFixed(0)}), next wp (${px.toFixed(0)},${py.toFixed(0)}) ${Math.hypot(px - u.ax, py - u.ay).toFixed(0)} m, ${pathLen} wps${u.isWorkers ? (u.convoy ? " [convoy]" : " [villagers]") : ""}`);
    }
  }
  // idle villagers
  for (const T of w.teams) {
    if (T.fallen) continue;
    let L = 0, home = 0, dead = 0, stray = 0;
    for (const u of EC.workerUnits(w, T.id)) {
      L += u.members.length;
      if (u.away && !u.convoy && !u.path) stray += u.members.length; // marched off, arrived, standing about
      else if (u.job?.kind === "home") home += u.members.length;
      else if (deadJob(u)) dead += u.members.length;
    }
    // at home is gardening when the stores won't reach the harvest (the reeve sends them there on purpose)
    const fd = EC.foodStock(T) / Math.max(1, EC.dailyFoodNeed(w, T.id)), lean = leanTimes(w, T.id, T, w.econ.doy, fd);
    const reserve = lean ? home : Math.max(6, Math.round(L * 0.12));
    const idle = Math.max(0, home - reserve) + dead + stray;
    const bad = L >= 20 && idle > L * 0.35;
    const cur = W.idle[T.id];
    if (bad && !cur) W.idle[T.id] = { t0: w.tick, peak: idle, L, home, dead, stray, reported: false };
    else if (bad) { if (idle > cur.peak) Object.assign(cur, { peak: idle, L, home, dead, stray }); if (!cur.reported && w.tick - cur.t0 > 1200) { cur.reported = true; issue(W, w, "idle", `team ${T.id}: ${cur.peak}/${cur.L} hands idle since ${(cur.t0 * TICK / 60).toFixed(1)} min (home ${cur.home}, dead jobs ${cur.dead}, strays ${cur.stray}) food ${Math.round(EC.foodStock(T))} timber ${Math.round(T.store.timber)}`); } }
    else if (cur) { if (cur.reported) issue(W, w, "idle-end", `team ${T.id}: idle spell from ${(cur.t0 * TICK / 60).toFixed(1)} min lasted ${((w.tick - cur.t0) * TICK / 60).toFixed(1)} min`); W.idle[T.id] = null; }
  }
  // buildings: on the plan, not overlapping
  for (const b of w.buildings) {
    if (W.seenB.has(b.id)) continue; W.seenB.add(b.id);
    if (!w.plans || b.kind === "town_hall" || CAMP.has(b.kind) || b.progress >= 1 && w.tick < 5) continue;
    const plan = w.plans[b.team], slot = b.slot && plan.slots.find((s) => s.id === b.slot);
    if (!slot) { issue(W, w, "offplan", `team ${b.team} ${b.kind} #${b.id} at (${b.x.toFixed(0)},${b.y.toFixed(0)}) has no plan slot`); continue; }
    if (!slot.kinds.includes(b.kind)) issue(W, w, "offplan", `team ${b.team} ${b.kind} #${b.id} on a ${slot.type} slot`);
    const d = Math.hypot(slot.x - b.x, slot.y - b.y); if (d > 2) issue(W, w, "offplan", `team ${b.team} ${b.kind} #${b.id} is ${d.toFixed(0)} m off its slot ${slot.id}`);
    const A = footRect(b); if (!A || b.field) continue;
    for (const o of w.buildings) {
      if (o === b || o.ruin || o.replaced || o.x1 !== undefined) continue;
      if (Math.hypot(o.x - b.x, o.y - b.y) > 80) continue;
      const B = footRect(o); if (B && overlap(A, B)) issue(W, w, "overlap", `team ${b.team} ${b.kind} #${b.id} overlaps ${o.kind} #${o.id} (team ${o.team}) at (${b.x.toFixed(0)},${b.y.toFixed(0)})`);
    }
  }
  void every;
}

export function hash(w) {
  let h = 2166136261 >>> 0;
  const mix = (v) => { h ^= v >>> 0; h = Math.imul(h, 16777619) >>> 0; };
  const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  const S = w.S;
  for (let i = 0; i < S.n; i++) { f[0] = S.x[i]; mix(u[0]); f[0] = S.y[i]; mix(u[0]); mix(S.alive[i]); mix(S.state[i]); mix(S.team[i]); }
  for (const T of w.teams) for (const k of Object.keys(T.store).sort()) mix(Math.round(T.store[k] * 1000));
  for (const b of w.buildings) { mix(b.id); mix(Math.round(b.progress * 1e6)); mix(Math.round(b.hp * 100)); }
  return h.toString(16).padStart(8, "0");
}

const pad = (s, n) => String(s).padStart(n);
// where the field army is: km from the enemy keep, its men, their baggage (econ-days) and supply mode
function armyWhere(w, G) {
  if (!["march", "siege", "return", "battle"].includes(G.mode)) return "";
  const us = [...G.army].map((id) => w.units.get(id)).filter((u) => u && u.members.length); if (!us.length) return " (no army)";
  let x = 0, y = 0, n = 0, food = 0, per = 0; for (const u of us) { x += u.ax * u.members.length; y += u.ay * u.members.length; n += u.members.length; food += u.supply?.food || 0; per += u.members.length * 1.2; }
  const foe = w.teams[1 - G.team].town, modes = [...new Set(us.map((u) => u.supplyMode))].join("/");
  return ` (${n} men ${(Math.hypot(x / n - foe.x, y / n - foe.y) / 1000).toFixed(2)} km from the foe, ${(food / Math.max(1, per)).toFixed(0)}d baggage, ${modes}, convoys ${(w.convoys || []).filter((c) => c.team === G.team).length})`;
}
function row(w, gens, t, M) {
  const out = [];
  for (const T of w.teams) {
    const h = EC.headcount(w, T.id), G = gens[T.id];
    const pop = T.dependants + h.labour + h.soldiers + T.squires + T.census.inTraining;
    const need = EC.dailyFoodNeed(w, T.id);
    const blds = w.buildings.filter((b) => b.team === T.id && !b.field && b.progress >= 1 && !b.ruin);
    const walls = blds.filter((b) => b.kind === "palisade" || b.kind === "stone_wall").length;
    const fields = w.buildings.filter((b) => b.team === T.id && b.field && !b.ruin).length;
    const sites = w.buildings.filter((b) => b.team === T.id && b.progress < 1 && !b.ruin).map((b) => `${b.kind}${Math.round(b.progress * 100)}`);
    const st = w.plans ? stageStatus(w, T.id) : null;
    out.push(`${T.name.padEnd(4)} ${st ? `[${st.name}]`.padEnd(20) : ""}pop${pad(pop, 4)} lab${pad(h.labour, 4)} army${pad(h.soldiers, 4)}(+${T.census.inTraining}) food${pad((EC.foodStock(T) / 1000).toFixed(1), 6)}t=${pad(Math.round(EC.foodStock(T) / Math.max(1, need)), 3)}d ration${pad(T.ration.toFixed(2), 5)} timber${pad((T.store.timber / 1000).toFixed(1), 6)}t stone${pad(Math.round(T.store.stone / 1000), 4)}t £${pad((T.store.silver / 240 + T.store.gold / 20).toFixed(0), 4)} bldg${pad(blds.length - blds.filter((b) => b.kind === "house").length - walls, 3)} hs${pad(blds.filter((b) => b.kind === "house").length, 3)} wall${pad(walls, 3)} fld${pad(fields, 3)} unrest${pad(T.unrest.toFixed(2), 5)} ${G.mode}${armyWhere(w, G)}${T.besieged ? " BESIEGED" : ""}${T.fallen ? " FALLEN" : ""}`
      + `\n        sites: ${sites.join(" ") || "-"}${st?.next ? ` | next ${st.next}: ${st.missing.map((m) => `${m.kind} ${m.have}/${m.need}`).join(", ")}` : ""}`);
  }
  return `t=${pad(t, 3)}min day ${w.econ.doy.toFixed(0)}  battles ${gens.map((g) => g.battles).join("/")}  dead ${M.kills.join("/")} down ${M.downs.join("/")} fires ${M.fires} peak melee ${M.peakFight}\n   ${out.join("\n   ")}`;
}

async function run(seed, verbose) {
  const { w, gens, brains, objects, mapName } = await setup(seed);
  if (verbose) console.log(`\n══ HIGHGROUND full match — map ${mapName} (${objects ? "objects.json" : "procedural"}: ${w.resources.length} nodes), seed ${seed}, ${MINUTES} min, ${PREBUILT ? "prebuilt" : "keep-only + plans"}, ${REEVE ? "player's reeve" : `general ${DISP[0]}`} vs general ${DISP[1]} @${DIFF}${OBST ? "" : ", no obstacles"}`);
  const ticks = Math.round(MINUTES * 60 / TICK), every = Math.round(5 * 60 / TICK);
  const t0 = performance.now();
  const M = { kills: [0, 0], downs: [0, 0], fires: 0, peakFight: 0 };
  const W = makeWatch(); const logged = [0, 0];
  let outcome = null;
  for (let t = 1; t <= ticks; t++) {
    step(w); brains();
    for (const e of w.events) {
      if (e.kind === "kill") M.kills[w.S.team[e.victim]]++;
      if (e.kind === "down") M.downs[w.S.team[e.victim]]++;
      if (e.kind === "fire" || e.kind === "field-fired") M.fires++;
      if (verbose && (e.kind === "town-fell" || e.kind === "siege-begins")) console.log(`   ⚑ ${(t * TICK / 60).toFixed(1)} min: ${w.teams[e.team].name} ${e.kind}${e.why ? " — " + e.why : ""}`);
    }
    if (t % 50 === 0) { let fighting = 0; for (let i = 0; i < w.S.n; i++) if (w.S.alive[i] && w.S.state[i] === 2) fighting++; M.peakFight = Math.max(M.peakFight, fighting); }
    invariants(w);
    if (t % 100 === 0) softChecks(W, w);
    if (verbose) for (const G of gens) while (logged[G.team] < G.log.length) { const l = G.log[logged[G.team]++]; if (!/builds|raises|segment|hangs/.test(l.msg)) console.log(`   · ${(l.tick * TICK / 60).toFixed(1)} min ${w.teams[G.team].name}: ${l.msg}`); }
    if (verbose && t % every === 0) console.log(row(w, gens, Math.round(t * TICK / 60), M));
    if (!outcome) { const o = matchOutcome ? matchOutcome(w) : w.econ.winner !== null ? { winner: w.econ.winner, why: w.teams[1 - w.econ.winner].fallReason } : null; if (o) { outcome = { ...o, min: +(t * TICK / 60).toFixed(1) }; if (verbose) console.log(`   ★ DECIDED at ${outcome.min} min: ${w.teams[o.winner].name} wins — ${o.why}`); } }
    if (outcome && t % every === 0) { if (verbose) console.log(row(w, gens, Math.round(t * TICK / 60), M)); break; }
  }
  const ms = performance.now() - t0;
  const res = { seed, hash: hash(w), outcome, issues: W.issues, counts: W.counts, battles: gens.map((g) => g.battles), dead: M.kills, stage: w.plans ? [0, 1].map((i) => stageStatus(w, i).name) : null, ms };
  if (verbose) {
    console.log(`\nresult seed ${seed}: ${outcome ? `${w.teams[outcome.winner].name} wins at ${outcome.min} min (${outcome.why})` : "NO DECISION"}; battles ${res.battles.join("/")}; ${(ms / w.tick).toFixed(2)} ms/tick`);
    if (!outcome) console.log("  why not: " + whyNot(w, gens));
    for (const T of w.teams) console.log(`  ${T.name} census ${JSON.stringify(T.census)} harvested ${(T.stats.harvested / 1000).toFixed(1)}t bought £${(T.stats.bought / 240).toFixed(0)} sold £${(T.stats.sold / 240).toFixed(0)}`);
    console.log(`  hard invariants: OK every tick (${w.tick} ticks)`);
    console.log(`  soft issues: ${Object.keys(W.counts).length ? JSON.stringify(W.counts) : "none"}`);
    for (const x of W.issues) console.log(`    [${x.kind}] ${x.min} min: ${x.msg}`);
  }
  return res;
}

function whyNot(w, gens) {
  const out = [];
  for (const G of gens) {
    const T = w.teams[G.team], camps = G.log.filter((l) => /marches on/.test(l.msg)).length, sieges = G.log.filter((l) => /arrives before|storms|invests/.test(l.msg)).length;
    out.push(`${T.name}: mode ${G.mode}, campaigns ${camps}, sieges ${sieges}, battles ${G.battles}, own str ${Math.round(G.own || 0)} vs est ${Math.round(G.estimate || 0)} (attack ratio ${G.attackRatio.toFixed(2)}), campaign day ${Math.round(G.campaignDay)} (now ${Math.round(w.econ.doy)})`);
  }
  return out.join("\n           ");
}

if (process.argv.includes("--lib") || !process.argv[1] || import.meta.url !== pathToFileURL(process.argv[1]).href) { /* imported as a library */ } else {
  const results = [];
  for (const s of SEEDS) {
    try { results.push(await run(s, true)); }
    catch (e) { console.log(`\n!! seed ${s}: ${e.message}`); results.push({ seed: s, error: e.message }); }
  }
  console.log(`\n══ summary (${MINUTES} min, ${PREBUILT ? "prebuilt" : "keep-only"})`);
  for (const r of results) console.log(r.error ? `  seed ${r.seed}: HARD FAIL — ${r.error}` : `  seed ${r.seed}: ${r.outcome ? `decided at ${r.outcome.min} min — team ${r.outcome.winner} wins (${r.outcome.why})` : "no decision"}; stages ${r.stage?.join(" / ")}; battles ${r.battles.join("/")}; dead ${r.dead.join("/")}; soft ${JSON.stringify(r.counts)}; hash ${r.hash}`);
  let bad = results.some((r) => r.error) || (STRICT && results.some((r) => Object.keys(r.counts).some((k) => k !== "idle-end")));
  if (flag("det") && results[0] && !results[0].error) {
    const again = await run(SEEDS[0], false);
    console.log(again.hash === results[0].hash ? `  determinism: OK (rerun hash ${again.hash})` : `  DETERMINISM FAILED: ${results[0].hash} vs ${again.hash}`);
    if (again.hash !== results[0].hash) bad = true;
  }
  if (bad) process.exit(1);
}
