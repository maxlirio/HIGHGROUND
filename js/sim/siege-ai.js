// The generals of a siege, both sides (docs/castle-plan.md §5; siege-research.md). Deterministic (w.rng), no DOM.
// Whichever side the player does not play is run by these; tools/siege-run.mjs runs both.
//
// THE BESIEGER (day by day): invests the castle and summons it; lays his trebuchets on the stretch with open level
// ground before it (siege-war.js pickBombardSection) and keeps them on it, widening the breach module by module;
// sets miners on the angle of that stretch where the ground allows (not the rock of a hill castle, never under
// water — siege-works.js digs, props and fires the gallery); has the carpenters make ladders, a ram and — where the ground
// is level enough to push one — a siege tower; offers terms once there is a breach. He STORMS when a breach is open
// (the day it is made or the mine brings the wall down, before the garrison can stop it), or with ram, tower and ladders together
// once the garrison has been thinned or his time is running out; in waves — the men-at-arms first — with the ram at
// the gate and a feint of ladders elsewhere to draw the defenders off, the bows brought up to shoot the wall-walk.
// A wave that is thrown back is followed by the reserve; if that fails too he sounds the recall. Inside, he goes for
// the keep (the ram at its door, ladders at its wall) and offers quarter. He raises the siege when his host is
// melting, his time is long past, or three assaults have failed; a relief army ends it for him.
//
// THE GARRISON (day by day): keeps its bows on the stretch the engines are working on and at the gate, a reserve of
// foot back from the wall; stops every breach with a barricade and patches battered stretches (siege-works.js work parties); keeps a
// listening post inside the stretch under attack and countermines when it hears
// digging; sallies by night against the engines when it is still strong and they are ill-guarded (a torch party:
// resolved on the econ clock while days pass, fought for real when the player is watching); asks for terms when
// the defence is hopeless (siege-war.js hopeless: the curtain breached, the host outside many times its number, the
// food gone with no relief in time). In the ASSAULT (every 4 s): the reserve runs to the breach, the gate or a
// lodgement on the wall; the bows keep shooting from the wall-walk; when the enemy inside the curtain outnumbers
// the defenders left outside the keep, everyone falls back to the keep (its gate held open for them, then shut).
import { issueOrder, applyOrder } from "./world.js";
import { ARMS } from "./arms.js";
import { S_FIGHT, ST_FLEE } from "./soldiers.js";
import * as SG from "./siege.js";
import * as SW from "./siege-war.js";
import { topCap } from "./castle.js";

export const SAI = {
  think: 40,            // ticks between tactical thoughts (4 s)
  stormBreach: 0.4,     // days after a breach opens before the storm (time to bring the men up; before the barricade)
  failCool: 3,          // days after a failed assault before the next
  mainShare: 0.65,      // share of the foot in the first wave
  feint: true,
  secondWave: 0.4,      // the first wave down to this share of its men with nobody over: the reserve goes in
  recall: 0.3,          // the second wave down to this, nobody over: the recall
  maxAssaultS: 900,     // battle-s of storming with nobody over the wall before he gives it up
  sallyEvery: 6,        // days between the garrison's sallies at most
  fallBack: 1.3,        // enemy inside the curtain ÷ defenders left outside the keep past which they fall back
  yield: 0.8,           // hopelessness past which the garrison asks for / accepts terms
};

export const act = (G, team, what) => { const a = (G.ai[team].acts ||= {}); a[what] = (a[what] || 0) + 1; };
export function installSiegeAI(w, G) {
  G.dayThink = dayThink; G.think = think; G.assaultPlan = assaultPlan;
  G.stormKeep = (units) => stormKeep(w, G, units); G.sendReserve = (units) => sendReserve(w, G, units); // (the player's orders too: siege-war.js siegeCommand)
  const A = G.ai[G.att], D = G.ai[G.def];
  A.minesStarted = 0; A.lastFail = -99; D.lastSally = -99;
  w.teams[G.att].hq = { ...G.camp }; w.teams[G.def].hq = { x: G.castle.keep?.x ?? G.castle.x, y: G.castle.keep?.y ?? G.castle.y };
}

// ─────────────────────────────────────────────────────────────── day by day
function dayThink(w, G, day) {
  if (G.terms?.open) answerIfAI(w, G);
  if (G.outcome) return;
  if (G.aiOn[G.att]) besiegerDay(w, G, day);
  if (G.outcome) return;
  if (G.aiOn[G.def]) garrisonDay(w, G, day);
  if (G.terms?.open) answerIfAI(w, G);
}
function answerIfAI(w, G) {
  const T = G.terms; if (!T?.open) return;
  const answerer = T.from === G.att ? G.def : G.att;
  if (!G.aiOn[answerer]) return; // (the player answers: js/ui/siege-run.js)
  if (answerer === G.def) SW.answerTerms(w, G, SW.hopeless(w, G) >= SAI.yield - 0.1);
  else SW.answerTerms(w, G, true); // a castle yielded is a castle won
}

function besiegerDay(w, G, day) {
  const A = G.ai[G.att], C = G.castle;
  if (day === 1 && !A.summoned) { A.summoned = true; SW.offerTerms(w, G, G.att); return; } // the summons: custom required it
  const T = w.teams[G.att], st = SW.siegeStatus(w, G);
  // give up?
  const gN = Math.max(1, st.garrison);
  if (G.stats.failed >= 3) { SW.end(w, G, G.def, "abandoned", `after ${G.stats.failed} assaults thrown back the besiegers burnt their engines and marched away`); return; }
  if (st.besiegers < gN * 1.3) { SW.end(w, G, G.def, "abandoned", "the besiegers, too few now to hold their lines, raised the siege"); return; }
  if (day > G.will + 12 && !SW.breaches(G, "outer").length) { SW.end(w, G, G.def, "abandoned", `the season was spent: on day ${day + 1} the besieging host went home`); return; }
  // the stretch to breach: keep the engines on it (a new one if it is down to rubble along its length)
  let tgt = w.buildings.find((b) => b.id === A.target);
  if (!tgt || tgt.ruin || tgt.mods.every((v) => v <= 0)) { tgt = SW.pickBombardSection(w, G, tgt?.id); A.target = tgt?.id ?? null; }
  if (tgt) { SW.aimEngines(w, G, tgt.id); act(G, G.att, "bombard"); }
  // mines: at the angle of the stretch (one at a time, two at most)
  const digging = SW.minesOf(w, G).some((m) => m.state === "digging" || m.state === "chamber" || m.state === "fired");
  if (tgt && !digging && A.minesStarted < 2 && day >= 2 && day < G.will * 0.7 && tgt.ground !== "rock") { if (SW.startMine(w, G, tgt, A.minesStarted % 2)) { A.minesStarted++; act(G, G.att, "mine"); } else A.minesStarted = 9; }
  // works: ladders enough for the host, a ram if the gate stands, a tower if the ground allows and there is time
  if ((T.store.ladders || 0) < 12 && SW.startWork(w, G, "ladders")) act(G, G.att, "works");
  const wet = tgt && SW.moatBefore(w, G, tgt) && !(G.fills || []).some((f) => f.bid === tgt.id);
  if (wet && SW.startWork(w, G, "fill", tgt.id)) act(G, G.att, "works"); // (a wet moat before the stretch: fill it)
  const eng = (k) => (w.siege?.engines || []).filter((e) => e.team === G.att && e.kind === k && e.state !== "burnt");
  const gate = C.gates.find((g) => g.ring === "outer" && !SW.gateDown(g));
  if (gate && !eng("ram").length) SW.startWork(w, G, "ram");
  if (!eng("siege_tower").length && towerGround(w, G, tgt) && day < G.will * 0.5) SW.startWork(w, G, "siege_tower");
  if (!eng("trebuchet").length && !SW.breaches(G, "outer").length && day < G.will * 0.6 && SW.startWork(w, G, "trebuchet")) act(G, G.att, "works"); // (burnt in a sally: frame another)
  // terms once there is a breach and the garrison is thinned
  const open = SW.breaches(G, "outer").filter((q) => !q.plug?.done);
  if (open.length && !G.terms?.open && day - (A.termsDay ?? -99) >= 5) { A.termsDay = day; SW.offerTerms(w, G, G.att); if (G.outcome) return; }
  // storm?
  if (G.assault?.on || day - A.lastFail < SAI.failCool) return;
  const mineNear = SW.minesOf(w, G).some((m) => m.state === "fired" || m.state === "chamber"); // (the wall is about to come down: wait for it)
  const ready = (k) => eng(k).some((e) => e.state === "ready" && e.unit !== null);
  const hungry = G.hunger > 0 || (st.foodDays < 6 && !G.relief); // (spies in the castle: why storm a starving garrison?)
  if (hungry && !open.length) return;
  if (mineNear && !open.length) return;
  if (wet) return; // (no storming across a wet moat: wait for the fill)
  if (open.length) { A.breachSeen ??= day; if (day - A.breachSeen >= SAI.stormBreach) return storm(w, G, "all"); A.stormAt = A.breachSeen + SAI.stormBreach; return; }
  const any = SW.breaches(G, "outer");
  if (any.length) { A.plugSeen ??= day; if (day - A.plugSeen >= 3) return storm(w, G, "all"); return; } // (a barricade behind the breach: it must be pulled down under their blows — go in all the same)
  A.breachSeen = undefined; A.plugSeen = undefined;
  const thin = st.garrison < st.garrison0 * 0.6, late = day > G.will * 0.55;
  if (ready("siege_tower") && (ready("ram") || !gate) && (thin || late) && (T.store.ladders || 0) >= 6) return storm(w, G, "all");
  if (day > G.will * 0.8 && (T.store.ladders || 0) >= 8) return storm(w, G, "all"); // time is running out: all or nothing
}
function storm(w, G, how) { const r = SW.startAssault(w, G, how, null); if (r) G.ai[G.att].why = r; else act(G, G.att, "storm"); }
// a tower needs level, firm ground to the wall's foot (not a hill castle's slopes, not a ditch of water)
function towerGround(w, G, b) {
  if (!b || (SW.LAYOUTS[G.castle.layout] || {}).tower === "neck" && G.castle.layout === "hill" && slopeTo(w, G, b) > 0.12) return false;
  return slopeTo(w, G, b) < 0.15;
}
function slopeTo(w, G, b) { const g = SW.secGeom(G, b), h0 = w.map.h(g.x + g.nx * 3, g.y + g.ny * 3), h1 = w.map.h(g.x + g.nx * 40, g.y + g.ny * 40); return Math.abs(h1 - h0) / 37; }

function hotSections(w, G) { const hot = new Set(); for (const e of w.siege?.engines || []) if (e.team === G.att && e.tgt?.b && e.state !== "burnt" && e.tgt.b.x1 !== undefined) hot.add(e.tgt.b); return hot; }
function garrisonDay(w, G, day) {
  const D = G.ai[G.def], C = G.castle, S = w.S;
  // stop every open breach (the reserve's men, twenty at least)
  // work parties: a barricade behind every open breach; else the worst-battered stretch patched (a party at its
  // masonry is called off when a breach opens: the breach wants a barricade, not a mason)
  // (a breach still open wants every spare man at its barricade: the masons are called off until it is stopped; walling
  // a breach up again is days of work — siege-works.js repairTick — so it is begun once the barricade stands behind it)
  const openB = SW.breaches(G).filter((q) => !q.plug?.done);
  if (openB.length) for (const u of G.units[G.def]) if (u.works?.kind === "repair" && u.members.length) { issueOrder(w, [u.id], { kind: "move", x: u.ax, y: u.ay, pace: "quick" }); u.role = "reserve"; }
  for (const q of SW.breaches(G)) { if (q.plug || q.b.ring === "keep" && G.phase !== "keep") continue; if (G.units[G.def].some((u) => u.works?.kind === "barricade" && u.members.length)) continue; const u = SW.freeFoot(w, G); if (u && SW.startBarricade(w, G, q.b, q.k, u)) act(G, G.def, "barricade"); }
  if (!openB.length && !G.units[G.def].some((u) => u.works?.kind === "repair" && u.members.length)) {
    const hot = hotSections(w, G); // (no masonry goes up where the stones are still landing)
    let worst = null, wf = 0.85; for (const b of C.sections) { if (b.ruin || !b.mods || b.ring === "keep" || hot.has(b)) continue; const per = b.hpMax / b.mods.length; for (const v of b.mods) if (v / per < wf) { wf = v / per; worst = b; } }
    const u = worst ? SW.freeFoot(w, G) : null; if (u && SW.startRepair(w, G, worst, u)) act(G, G.def, "repair");
  }
  // a listening post inside the stretch the enemy is working on (the miners go for the stretch the engines batter)
  const tgtB = [...hotSections(w, G)][0] || SW.nearestSection(G, G.camp.x, G.camp.y, "outer"); // (where the stones fall, or the side the camp is on)
  if (tgtB && tgtB.ground !== "rock" && !G.units[G.def].some((u) => u.role === "post" && u.postFor === tgtB.id && u.members.length) && SW.startPost(w, G, tgtB)) act(G, G.def, "countermine");
  // the bows on the stretch the engines are working on, and at the gate
  const hot = new Set(); for (const e of w.siege?.engines || []) if (e.team === G.att && e.tgt?.b && e.state !== "burnt") hot.add(e.tgt.b.id);
  const bows = G.units[G.def].filter((u) => u.members.length && ARMS[u.arm].missile && u.role !== "keep" && u.role !== "sally" && !u.towerFor);
  for (const bid of hot) {
    const b = w.buildings.find((q) => q.id === bid); if (!b || b.ring === "keep" || b.x1 === undefined || !C.sections.includes(b)) continue;
    if (bows.some((u) => u.manning === bid)) continue;
    const u = bows.filter((v) => v.manning !== undefined && !hot.has(v.manning)).sort((a, c) => Math.hypot(a.ax - b.x, a.ay - b.y) - Math.hypot(c.ax - b.x, c.ay - b.y))[0];
    if (u) { SW.manSection(w, G, u, b, !!G.fast); act(G, G.def, "man"); }
  }
  // a sally at the engines by night: still strong, the engines within reach, not too often
  if (day - D.lastSally >= SAI.sallyEvery && day >= 3 && G.phase === "siege") {
    const st = SW.siegeStatus(w, G);
    const foot = G.units[G.def].filter((u) => u.members.length && !ARMS[u.arm].missile && !ARMS[u.arm].engine && u.role !== "keep");
    const n = foot.reduce((s, u) => s + u.members.length, 0);
    const tg = (w.siege?.engines || []).filter((e) => e.team === G.att && e.state !== "burnt" && (e.kind === "trebuchet" || e.kind === "siege_tower" || e.kind === "ram") && Math.hypot(e.x - C.x, e.y - C.y) < 280);
    // (a constable waits for a dark night and a careless guard: no sally when it looks hopeless)
    const best = tg.length ? tg.slice().sort((a, b) => (b.kind === "trebuchet") - (a.kind === "trebuchet"))[0] : null;
    if (best && st.garrison >= st.garrison0 * 0.55 && n >= 24 && sallyOdds(w, G, best, Math.min(40, Math.round(n * 0.3))).p >= 0.08 && w.rng.next() < 0.35) {
      D.lastSally = day; act(G, G.def, "sally");
      if (G.fast) nightSally(w, G, tg, foot);
      else { const e = tg[0], out = foot.sort((a, b) => ARMS[b.arm].armour - ARMS[a.arm].armour).slice(0, 2); SW.sally(w, G, out, { x: e.x, y: e.y }); }
    }
  }
  if (SW.hopeless(w, G) >= SAI.yield && !G.terms?.open && day - (D.askedDay ?? -99) >= 3) { D.askedDay = day; SW.offerTerms(w, G, G.def); }
}
// a night sally resolved on the econ clock (nobody walks while days pass): a torch party of the garrison's best
// foot against the engine and the men who guard it. Most sallies against engines were beaten off or did little (the
// engines stood inside the besiegers' lines, watched all night, with wet hides on them): what decided it was the
// guard (its size, and whether a sally had lately put it on the alert), how far the party had to go from the postern
// and so how long it could be seen coming, and how dark the night was (the moon; rain, fog, a winter's night).
// siege-research.md §15.
export const SALLY = { base: 0.55, farM: 320, alertDays: 8, alertMul: 0.45, fullMoon: 0.45, douse: 0.35, lunar: 29.53 };
export function sallyOdds(w, G, e, n) {
  let guard = 0; for (const u of G.units[G.att]) if (u.members.length && Math.hypot(u.ax - e.x, u.ay - e.y) < 90) guard += u.members.length * (u.role === "guard" ? 1.5 : 1); // (a set guard watches; crews and camps nearby wake)
  const A = G.ai[G.att], day = SW.siegeDay(w, G);
  const gF = 1 / (1 + guard / (2.5 * n));                                              // the guard: an unguarded engine is reachable
  const d = Math.hypot(e.x - G.castle.x, e.y - G.castle.y), dF = clamp01(1 - (d - 60) / SALLY.farM) * 0.7 + 0.3; // the way out and back
  const moon = 0.5 - 0.5 * Math.cos(2 * Math.PI * ((day + (G.moon0 ??= w.rng.next() * SALLY.lunar)) / SALLY.lunar)); // 0 new … 1 full
  const wx = { drizzle: 1.15, rain: 1.3, heavy_rain: 1.35, thunderstorm: 1.4, fog_light: 1.3, fog_thick: 1.45, fog_dense: 1.5, snow_light: 1.15, snow_heavy: 1.3 }[w.weather] || 1; // a foul night hides the party (real WEATHER keys)
  const lF = (1 - SALLY.fullMoon * moon) * wx;
  const aF = day - (A.alertDay ?? -99) < SALLY.alertDays ? SALLY.alertMul : 1;          // the camp on the alert after the last one
  return { p: Math.max(0.02, Math.min(0.55, SALLY.base * gF * dF * lF * aF)), guard, moon, d };
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function nightSally(w, G, targets, foot) {
  const e = targets.sort((a, b) => (b.kind === "trebuchet") - (a.kind === "trebuchet"))[0];
  const n = Math.min(40, Math.round(foot.reduce((s, u) => s + u.members.length, 0) * 0.3));
  const { p, moon } = sallyOdds(w, G, e, n);
  const reach = w.rng.next() < p;                       // they reach it and set their fire-pots on it…
  const ok = reach && w.rng.next() >= SALLY.douse;       // …and it catches before the guard can put it out
  const lostD = killFrom(w, G, G.def, Math.round(n * (reach ? 0.12 : 0.25) * (0.6 + w.rng.next() * 0.8))), lostA = killFrom(w, G, G.att, Math.round(n * (reach ? 0.2 : 0.08) * (0.5 + w.rng.next())), e);
  G.stats.sallies++; G.ai[G.att].alertDay = SW.siegeDay(w, G);
  if (ok) { e.fire = 1; e.hp = Math.min(e.hp, e.hpMax * 0.15); }
  else if (reach) { e.hp = Math.max(e.hpMax * 0.2, e.hp - e.hpMax * 0.35); e.burnT = w.time; } // (scorched: its carpenters mend it — siege.js engCond)
  if (reach) { const more = G.units[G.att].filter((u) => u.role === "foot" && u.members.length >= 20 && !ARMS[u.arm].missile).sort((a, c) => c.members.length - a.members.length)[0]; // (the besieger doubles the guard on his engines)
    if (more) { more.role = "guard"; const q = { x: e.x + (G.castle.x - e.x) * 0.15, y: e.y + (G.castle.y - e.y) * 0.15 }; issueOrder(w, [more.id], { kind: "move", x: q.x, y: q.y, pace: "quick" }); } }
  const nm = ARMS[e.kind].name.toLowerCase(), night = moon > 0.75 ? "Under a bright moon" : moon < 0.25 ? "On a moonless night" : "In the dark";
  SW.note(w, G, { kind: "sally", kicker: ok ? "A sally by night" : reach ? "A sally, the fire put out" : "A sally beaten off",
    text: ok ? `${night} ${n} of the garrison slip out of the postern and fire the besiegers' ${nm} (${lostD} of them lost, ${lostA} of the guard killed)`
      : reach ? `${night} a sally reaches the besiegers' ${nm} and sets fire to it, but the guard beat the flames out; it is scorched (${lostD} of the garrison lost, ${lostA} of the guard)`
        : `${night} a sally against the ${nm} is seen coming and driven back by its guard (${lostD} of the garrison lost)`,
    good: ok ? G.def : G.att, x: e.x, y: e.y, sal: ok ? 0.75 : 0.55 });
}
function killFrom(w, G, team, n, near = null) {
  const S = w.S, pool = [];
  for (const u of G.units[team]) { if (!u.members.length || u.household) continue; if (near && Math.hypot(u.ax - near.x, u.ay - near.y) > 120) continue; for (const id of u.members) if (S.alive[id]) pool.push(id); }
  let k = 0; while (k < n && pool.length) { const id = pool.splice(Math.floor(w.rng.next() * pool.length), 1)[0]; S.alive[id] = 0; S.state[id] = 5; k++; }
  return k;
}

// ─────────────────────────────────────────────────────────────── the assault plan
// how: "all" | "breach" | "gate" | "escalade" | "tower". units: the player's chosen companies (or null: the AI's whole host)
function assaultPlan(w, G, how, units) {
  const A = G.ai[G.att], C = G.castle, T = w.teams[G.att];
  const mine = units || G.units[G.att].filter((u) => u.members.length && u.role !== "post");
  const eng = (k) => mine.map((u) => SG.engineOf(w, u)).filter((e) => e && e.kind === k && e.state === "ready");
  const foot = mine.filter((u) => !SG.engineOf(w, u) && !ARMS[u.arm].engine && !ARMS[u.arm].mounted && !ARMS[u.arm].missile && u.state !== "routing").sort((a, b) => ARMS[b.arm].armour - ARMS[a.arm].armour);
  const bows = mine.filter((u) => ARMS[u.arm].missile && u.state !== "routing");
  const open = SW.breaches(G, "outer").filter((q) => !q.plug?.done).sort((a, b) => Math.hypot(SW.modPoint(G, a.b, a.k).x - G.camp.x, SW.modPoint(G, a.b, a.k).y - G.camp.y) - Math.hypot(SW.modPoint(G, b.b, b.k).x - G.camp.x, SW.modPoint(G, b.b, b.k).y - G.camp.y));
  const gate = C.gates.find((g) => g.ring === "outer" && !g.ruin);
  const rams = eng("ram"), towers = eng("siege_tower");
  let tgt = w.buildings.find((b) => b.id === A.target) || SW.pickBombardSection(w, G);
  if (!foot.length && !rams.length && !towers.length) return "no men fit to storm";
  if (how === "breach" && !open.length) return "there is no breach to storm";
  if (how === "gate" && !gate) return "there is no gate";
  if (how === "gate" && !rams.length && !SW.gateDown(gate)) return "you need a ram at the gate";
  if (how === "tower" && !towers.length) return "no siege tower is ready";
  if ((how === "escalade") && (T.store.ladders || 0) < 2) return "no ladders — have the carpenters make some";
  const plan = { waves: [], main: null, t0: w.time };
  // the first wave: the best of the foot (the player's chosen men all go)
  const total = foot.reduce((s, u) => s + u.members.length, 0);
  let first = [], rest = [], acc = 0;
  for (const u of foot) { if (units || acc < total * SAI.mainShare || !first.length) { first.push(u); acc += u.members.length; } else rest.push(u); }
  const send = (u, kind, p, extra = {}) => { u.role = "assault"; u.assaultT = w.time; issueOrder(w, [u.id], { kind, x: p.x, y: p.y, pace: "quick", ...extra }); };
  const breachIn = (q) => SW.modPoint(G, q.b, q.k, -18);
  const escPoint = (b, t) => SW.secGeom(G, b).at(t, 0);
  let feint = null;
  if ((how === "all" || how === "breach") && open.length) {
    first.forEach((u, i) => send(u, "assault", breachIn(open[i % Math.min(2, open.length)])));
    plan.main = { kind: "breach", x: breachIn(open[0]).x, y: breachIn(open[0]).y };
  } else if (how === "gate") {
    first.forEach((u) => { const q = SW.gateGeomOut(G, gate); send(u, "move", { x: q.x + q.nx * 30, y: q.y + q.ny * 30 }); u.role = "gateParty"; });
    plan.main = { kind: "gate", x: gate.x, y: gate.y };
  } else if (tgt) {
    // ladders along the target stretch (and the tower's party at the tower)
    const tw = towers[0];
    if (tw && (how === "all" || how === "tower")) {
      const p = escPoint(tgt, 0.3); applyOrder(w, w.units.get(tw.unit), { kind: "advance", x: p.x, y: p.y });
      const party = first.shift(); if (party) { party.role = "towerParty"; party.towerFor = tw.id; party.towerAt = p; const g = SW.secGeom(G, tgt); issueOrder(w, [party.id], { kind: "move", x: p.x + g.nx * 30, y: p.y + g.ny * 30, pace: "quick" }); }
    }
    if (how !== "tower") first.forEach((u, i) => { const p = escPoint(tgt, 0.55 + (i % 3) * 0.13); send(u, "escalade", p); });
    plan.main = { kind: "escalade", x: tgt.x, y: tgt.y };
  }
  // the ram at the gate, with a company waiting to go in when the leaves give
  if ((how === "all" || how === "gate") && rams.length && gate && !SW.gateDown(gate)) {
    applyOrder(w, w.units.get(rams[0].unit), { kind: "batter", x: gate.x, y: gate.y, bid: gate.id });
    if (how === "all" && rest.length) { const u = rest.shift(), q = SW.gateGeomOut(G, gate); u.role = "gateParty"; issueOrder(w, [u.id], { kind: "move", x: q.x + q.nx * 35, y: q.y + q.ny * 35, pace: "quick" }); }
  }
  // a feint: a company with ladders at the far side, to draw the defenders off
  if (!units && SAI.feint && how === "all" && rest.length >= 2 && (T.store.ladders || 0) >= 3) {
    const far = C.sections.filter((b) => b.ring === "outer" && !b.waterSide && b !== tgt).sort((a, b) => Math.hypot(b.x - (tgt?.x ?? C.x), b.y - (tgt?.y ?? C.y)) - Math.hypot(a.x - (tgt?.x ?? C.x), a.y - (tgt?.y ?? C.y)))[0];
    if (far) { feint = rest.pop(); send(feint, "escalade", escPoint(far, 0.5)); feint.role = "feint"; }
  }
  // the bows up to ~100 m, to shoot the wall-walk clear
  const aim = plan.main || { x: C.x, y: C.y };
  const bearing = Math.atan2(aim.y - C.y, aim.x - C.x);
  bows.forEach((u, i) => { const lat = (i - (bows.length - 1) / 2) * 30, d = Math.hypot(aim.x - C.x, aim.y - C.y) + 95; const p = { x: C.x + Math.cos(bearing) * d - Math.sin(bearing) * lat, y: C.y + Math.sin(bearing) * d + Math.cos(bearing) * lat }; issueOrder(w, [u.id], { kind: "move", x: p.x, y: p.y, pace: "quick", facing: bearing + Math.PI }); u.role = "bows"; });
  plan.waves.push(first.map((u) => u.id)); plan.reserve = rest.map((u) => u.id); plan.n0 = first.reduce((s, u) => s + u.members.length, 0);
  A.plan = plan;
  return null;
}

// ─────────────────────────────────────────────────────────────── the tactical thoughts (real time)
function think(w, G) {
  if (w.tick % SAI.think) return;
  housekeeping(w, G);
  if (G.aiOn[G.att]) besiegerThink(w, G);
  if (G.aiOn[G.def]) garrisonThink(w, G);
}
// gates held open for a sally or a retreat into the keep are shut again; sally parties come home
function housekeeping(w, G) {
  const K = G.castle.keep;
  if (K?.gate?.forcedOpen && w.time > (G.keepOpenUntil || 0)) {
    let out = 0; for (const u of G.units[G.def]) if (u.members.length && u.role === "keep" && !SW.inKeep(G, u.ax, u.ay)) out++;
    if (!out || w.time > (G.keepOpenUntil || 0) + 60) K.gate.forcedOpen = false;
  }
  if (G.sallyGate) {
    const party = G.units[G.def].filter((u) => u.members.length && u.role === "sally");
    for (const u of party) {
      const e = nearestEngine(w, G, u.ax, u.ay);
      const done = w.time > G.sallyUntil || !e || e.fire > 0.3 || Math.hypot(e.x - u.ax, e.y - u.ay) > 200;
      if (done && !u.homeward && Math.hypot(u.ax - G.castle.x, u.ay - G.castle.y) > 50) { u.homeward = true; const h = u.sallyHome; applyOrder(w, u, { kind: "move", x: h.x, y: h.y, pace: "quick" }); u.path = [[h.via.x + h.via.nx * 8, h.via.y + h.via.ny * 8], [h.via.x - h.via.nx * 6, h.via.y - h.via.ny * 6], [h.x, h.y]]; }
      if (u.homeward && SW.insideCastle(w, G, u.ax, u.ay)) { u.role = "reserve"; u.homeward = false; }
    }
    if (!party.length || w.time > G.sallyUntil + 120) { G.sallyGate.forcedOpen = false; G.sallyGate = null; for (const u of party) if (u.role === "sally") u.role = "reserve"; }
  }
}
function nearestEngine(w, G, x, y) { let b = null, bd = Infinity; for (const e of w.siege?.engines || []) { if (e.team !== G.att || e.state === "burnt") continue; const d = Math.hypot(e.x - x, e.y - y); if (d < bd) { bd = d; b = e; } } return b; }

function besiegerThink(w, G) {
  const A = G.ai[G.att], P = A.plan, C = G.castle, now = G.now || {};
  // men who have gained the wall-walk clear the towers either side of them (up the tower's stair, one man abreast)
  clearTowers(w, G);
  if (!G.assault?.on && G.phase !== "inside" && G.phase !== "keep") return;
  const S = w.S, alive = (ids) => ids.map((id) => w.units.get(id)).filter((u) => u && u.members.length);
  // the tower's party goes up when the bridge is down
  for (const u of G.units[G.att]) if (u.role === "towerParty" && u.members.length && !u.esc) { const e = SG.engineById(w, u.towerFor); if (e?.docked && e.bridge >= 1) { issueOrder(w, [u.id], { kind: "escalade", x: e.docked.x, y: e.docked.y, pace: "quick" }); u.role = "assault"; } else if (!e || e.state === "burnt") { u.role = "assault"; issueOrder(w, [u.id], { kind: "escalade", x: u.towerAt.x, y: u.towerAt.y, pace: "quick" }); } }
  // the gate party goes in when the leaves are down
  const gate = C.gates.find((g) => g.ring === "outer");
  if (gate && SW.gateDown(gate)) for (const u of G.units[G.att]) if (u.role === "gateParty" && u.members.length) { const q = SW.gateGeomOut(G, gate); issueOrder(w, [u.id], { kind: "assault", x: q.x - q.nx * 25, y: q.y - q.ny * 25, pace: "quick" }); u.role = "assault"; }
  // inside the curtain: on to the keep
  if (now.attIn >= 12) {
    const K = C.keep;
    for (const u of G.units[G.att]) {
      if (!u.members.length || u.esc || ARMS[u.arm].engine || ARMS[u.arm].mounted || u.clearing) continue;
      const inside = SW.insideCastle(w, G, u.ax, u.ay);
      if (!inside && u.role !== "assault" && u.role !== "foot" && u.role !== "bows") continue;
      if (!inside && u.role === "bows") continue;
      if (!inside) { // the reserve comes up through the breach or the gate
        const q = SW.breaches(G, "outer")[0], g2 = gate && SW.gateDown(gate) ? SW.gateGeomOut(G, gate) : null;
        const p = q ? SW.modPoint(G, q.b, q.k, -18) : g2 ? { x: g2.x - g2.nx * 20, y: g2.y - g2.ny * 20 } : null;
        if (p && u.role === "foot" && G.phase === "inside" && u.order?.kind !== "assault") { u.role = "assault"; issueOrder(w, [u.id], { kind: "assault", x: p.x, y: p.y, pace: "quick" }); }
        continue;
      }
      if (!K) continue;
      if (SW.inKeep(G, u.ax, u.ay)) continue;
      keepAssault(w, G, u);
    }
    const ram = (w.siege?.engines || []).find((e) => e.team === G.att && e.kind === "ram" && e.state === "ready" && e.unit !== null);
    if (ram && K?.gate && !SW.gateDown(K.gate) && G.phase === "keep" && !A.keepRam) { A.keepRam = true; applyOrder(w, w.units.get(ram.unit), { kind: "batter", x: K.gate.x, y: K.gate.y, bid: K.gate.id }); }
    hackDoor(w, G);
    if (G.phase === "keep" && !G.terms?.open && w.time - (A.quarterT ?? -1e9) > 240) { A.quarterT = w.time; SW.offerTerms(w, G, G.att); if (G.terms?.open) answerIfAI(w, G); }
    return;
  }
  if (!P || !G.assault?.on) return;
  // waves
  const first = alive(P.waves[0] || []), n1 = first.reduce((s, u) => s + u.members.length, 0);
  const over = now.attIn || 0, t = w.time - P.t0;
  if (P.waves.length === 1 && n1 < P.n0 * SAI.secondWave && over < 5 && P.reserve.length) {
    const res = alive(P.reserve); P.reserve = [];
    const main = P.main || { x: C.x, y: C.y };
    for (const u of res) { u.role = "assault"; if (P.main?.kind === "escalade") issueOrder(w, [u.id], { kind: "escalade", x: main.x, y: main.y, pace: "quick" }); else issueOrder(w, [u.id], { kind: "assault", x: main.x, y: main.y, pace: "quick" }); }
    act(G, G.att, "wave"); P.waves.push(res.map((u) => u.id)); P.n0b = res.reduce((s, u) => s + u.members.length, 0);
    SW.note(w, G, { kind: "wave", kicker: "A second wave", text: `The first wave is spent at the wall: ${G.names.side(G.att)} send in their reserve`, good: -1, sal: 0.7, x: main.x, y: main.y });
    return;
  }
  const inWave = P.waves.flat().map((id) => w.units.get(id)).filter((u) => u && u.members.length && u.state !== "routing").reduce((s, u) => s + u.members.length, 0);
  const n0 = P.n0 + (P.n0b || 0);
  if ((over < 5 && (inWave < n0 * SAI.recall || t > SAI.maxAssaultS)) || (over < 12 && t > SAI.maxAssaultS * 1.4)) { SW.callOff(w, G, G.att); act(G, G.att, "recall"); A.lastFail = SW.siegeDay(w, G); A.plan = null; }
}
// the orders the player gives by hand once the walls are carried (the AI does the same in besiegerThink): every foot
// company inside the curtain (or the chosen ones) on to the keep; the reserve of a storm into it after the first wave
const footOf = (u) => u.members.length && !u.esc && !ARMS[u.arm].engine && !ARMS[u.arm].mounted && !ARMS[u.arm].missile && u.state !== "routing";
function stormKeep(w, G, units) {
  const K = G.castle.keep; if (!K) return "there is no keep";
  const us = (units?.length ? units : G.units[G.att].filter((u) => footOf(u) && (SW.insideCastle(w, G, u.ax, u.ay) || u.role === "assault"))).filter(footOf);
  if (!us.length) return "none of your foot are inside the walls — storm the breach or the gate first";
  for (const u of us) { u.role = "assault"; u.keepTried = false; keepAssault(w, G, u); }
  const ram = (w.siege?.engines || []).find((e) => e.team === G.att && e.kind === "ram" && e.state === "ready" && e.unit !== null);
  if (ram && K.gate && !SW.gateDown(K.gate)) applyOrder(w, w.units.get(ram.unit), { kind: "batter", x: K.gate.x, y: K.gate.y, bid: K.gate.id });
  SW.note(w, G, { kind: "keeporder", kicker: K.ward ? "At the inner ward" : "At the keep", text: `${us.reduce((n, u) => n + u.members.length, 0)} of ${G.names.side(G.att)} go at ${K.ward ? "the inner ward" : "the keep"}`, good: G.att, x: K.x, y: K.y, sal: 0.6 });
  return null;
}
function sendReserve(w, G, units) {
  const A = G.ai[G.att], P = A.plan, C = G.castle;
  const res = units?.length ? units.filter(footOf) : (P?.reserve || []).map((id) => w.units.get(id)).filter((u) => u && footOf(u));
  const more = res.length ? res : G.units[G.att].filter((u) => footOf(u) && u.role === "foot" && !SW.insideCastle(w, G, u.ax, u.ay));
  if (!more.length) return "there is no reserve left to send";
  const open = SW.breaches(G, "outer")[0], gate = C.gates.find((g) => g.ring === "outer" && SW.gateDown(g));
  const main = open ? SW.modPoint(G, open.b, open.k, -18) : gate ? (() => { const q = SW.gateGeomOut(G, gate); return { x: q.x - q.nx * 20, y: q.y - q.ny * 20 }; })() : P?.main || { x: C.x, y: C.y };
  for (const u of more) { u.role = "assault"; u.assaultT = w.time; if (!open && !gate && P?.main?.kind === "escalade") issueOrder(w, [u.id], { kind: "escalade", x: P.main.x, y: P.main.y, pace: "quick" }); else issueOrder(w, [u.id], { kind: "assault", x: main.x, y: main.y, pace: "quick" }); }
  if (P) { P.waves.push(more.map((u) => u.id)); P.reserve = []; P.n0b = (P.n0b || 0) + more.reduce((s, u) => s + u.members.length, 0); }
  SW.note(w, G, { kind: "wave", kicker: "The reserve goes in", text: `${cap1(G.names.side(G.att))} send in ${more.reduce((n, u) => n + u.members.length, 0)} more`, good: -1, sal: 0.6, x: main.x, y: main.y });
  return null;
}
const cap1 = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
// at the keep: its door (a ram if there is one, axes and fire if not), ladders at its wall; into a real keep
// (castle.js) by its forebuilding stair
function keepAssault(w, G, u) {
  const K = G.castle.keep, o = u.pendingOrder || u.order;
  if (K.real || !K.sections?.length) { if (o?.kind !== "assault" || Math.hypot(o.x - K.x, o.y - K.y) > 8) issueOrder(w, [u.id], { kind: "assault", x: K.x, y: K.y, pace: "quick" }); return; }
  const door = K.gate, down = door && SW.gateDown(door);
  const T = w.teams[G.att];
  if (down) { const q = SW.gateGeomOut(G, door); if (o?.kind !== "assault" || Math.hypot(o.x - K.x, o.y - K.y) > 12) issueOrder(w, [u.id], { kind: "assault", x: K.x, y: K.y, pace: "quick" }); void q; return; }
  if ((T.store.ladders || 0) >= 1 && u.members.length >= 12 && ARMS[u.arm].armour >= 2 && !u.keepTried) {
    u.keepTried = true; const b = SW.nearestSection(G, u.ax, u.ay, "keep") || K.sections[0], p = SW.secGeom(G, b).at(0.5); issueOrder(w, [u.id], { kind: "escalade", x: p.x, y: p.y, pace: "quick", then: { x: K.x, y: K.y } }); return;
  }
  if (door) { const q = SW.gateGeomOut(G, door), p = { x: q.x + q.nx * 3, y: q.y + q.ny * 3 }; if (o?.kind !== "assault" || Math.hypot(o.x - p.x, o.y - p.y) > 6) issueOrder(w, [u.id], { kind: "assault", x: p.x, y: p.y, pace: "quick" }); }
}
// men at a shut keep door with no ram hack at it and pile brushwood against it (a timber door, ~1 % of it a minute
// per man at it: a few minutes for a crowd with axes and fire — Rochester's keep, Dover's gate)
function hackDoor(w, G) {
  const door = G.castle.keep?.gate; if (!door || SW.gateDown(door) || door.ruin) return;
  const q = SW.gateGeomOut(G, door), S = w.S; let n = 0;
  for (const u of G.units[G.att]) for (const id of u.members) if (S.alive[id] && S.status[id] < ST_FLEE && Math.hypot(S.x[id] - q.x - q.nx * 2, S.y[id] - q.y - q.ny * 2) < 7) n++;
  if (!n) return;
  door.hp = Math.max(door.hpMax * 0.19, door.hp - door.hpMax * 0.0007 * n * SAI.think / 10);
  if (door.hp <= door.hpMax * 0.2 && !door.gateBroken) { door.gateBroken = true; door.shut = false; w.events.push({ t: w.tick, kind: "gate-broken", team: door.team, building: door.id, by: G.att }); }
}

// THE TOWERS (castle.js, a real castle only). A mural tower stands out from the curtain so that bows on its top see
// along the wall's face (ballistics: castle.js aimBias): the garrison puts a company of bows — as many as its top holds,
// split off a larger company — on each of the two towers flanking the stretch the enemy is coming at; and a storming
// party that has gained the wall-walk turns along it to clear the towers either side (their stairs are one man abreast),
// before it goes down into the bailey. (siege-research.md §17)
export const TOWERS = { flankR: 80, clearR: 45, every: 30 };
const towersOf = (G) => (G.castle.real?.parts || []).filter((p) => p.kind === "tower");
function towerBows(w, G, threats) {
  const R = G.castle.real, D = G.ai[G.def]; if (!R?.parts) return;
  if (w.time - (D.towerT ?? -1e9) < TOWERS.every) return;
  const th = threats.find((t) => t.kind !== "lodged"); if (!th) return;
  D.towerT = w.time;
  const ring0 = R.rings?.[0]?.id, bOf = (id) => w.buildings.find((b) => b.id === id);
  const near = towersOf(G).filter((p) => (p.ring === ring0 || ring0 === undefined) && !bOf(p.bid)?.ruin).map((p) => [Math.hypot(p.x - th.p.x, p.y - th.p.y), p]).filter((q) => q[0] < TOWERS.flankR).sort((a, b) => a[0] - b[0]).slice(0, 2);
  for (const [, p] of near) {
    if (G.units[G.def].some((u) => u.members.length && u.towerFor === p.id)) continue;
    const donor = G.units[G.def].filter((u) => u.members.length >= 4 && ARMS[u.arm].missile && !u.towerFor && u.role !== "keep" && u.role !== "sally" && u.state !== "routing").sort((a, b) => Math.hypot(a.ax - p.x, a.ay - p.y) - Math.hypot(b.ax - p.x, b.ay - p.y))[0];
    if (!donor) return;
    const cap = topCap(p) || 8;
    let u = donor;
    if (donor.members.length > cap + 4) { u = SW.splitUnit(w, donor, cap); SW.enrolUnit(G, u); u.cst = null; }
    u.towerFor = p.id; u.role = "towerBows"; u.manning = undefined;
    issueOrder(w, [u.id], { kind: "castle_move", x: p.x, y: p.y, lvl: p.topLvl ?? 2, pace: "quick" });
    act(G, G.def, "towerBows");
  }
}
function clearTowers(w, G) {
  const R = G.castle.real, S = w.S; if (!R?.parts || !w.castleM) return;
  const towers = towersOf(G), held = new Map();
  for (const u of G.units[G.def]) for (const i of u.members) {
    if (!S.alive[i] || S.lvl[i] < 1 || S.status[i] >= ST_FLEE) continue;
    for (const p of towers) if ((S.x[i] - p.x) ** 2 + (S.y[i] - p.y) ** 2 < p.r * p.r) { held.set(p.id, (held.get(p.id) || 0) + 1); break; }
  }
  for (const u of G.units[G.att]) {
    if (!u.members.length || u.esc || ARMS[u.arm].engine || ARMS[u.arm].mounted || ARMS[u.arm].missile || u.state === "routing") continue;
    if (u.clearing) {
      if (!held.get(u.clearing)) { u.clearing = null; u.role = "assault"; continue; } // (cleared: on into the castle with the rest)
      const p = towers.find((q) => q.id === u.clearing), o = u.pendingOrder || u.order; // (an order misheard or overtaken: sounded again)
      if (p && (o?.kind !== "castle_move" || Math.hypot((o.x ?? 0) - p.x, (o.y ?? 0) - p.y) > 3)) issueOrder(w, [u.id], { kind: "castle_move", x: p.x, y: p.y, lvl: p.topLvl ?? 2, pace: "quick" });
      continue;
    }
    let up = 0, n = 0; for (const i of u.members) if (S.alive[i]) { n++; if (S.lvl[i] >= 1) up++; }
    if (!n || up < n * 0.5) continue;
    let best = null, bd = TOWERS.clearR;
    for (const p of towers) { if (!held.get(p.id)) continue; const d = Math.hypot(p.x - u.ax, p.y - u.ay); if (d < bd) { bd = d; best = p; } }
    if (!best) continue;
    u.clearing = best.id; u.role = "assault";
    issueOrder(w, [u.id], { kind: "castle_move", x: best.x, y: best.y, lvl: best.topLvl ?? 2, pace: "quick" });
    act(G, G.att, "clearTower");
  }
}
function garrisonThink(w, G) {
  const D = G.ai[G.def], C = G.castle, now = G.now || {}, S = w.S;
  if (G.phase === "siege" && !G.assault?.on && !now.attNear) return;
  // fall back to the keep when the curtain is lost
  if (!G.fellBack && C.keep && now.attIn > 20 && (now.attIn > SAI.fallBack * now.defOut || now.defOut < 12)) { SW.fallBack(w, G, null); act(G, G.def, "fallback"); return; }
  if (G.fellBack) {
    for (const u of G.units[G.def]) if (u.members.length && u.role !== "keep" && !SW.inKeep(G, u.ax, u.ay) && u.state !== "routing" && !u.fightingIn) { SW.fallBack(w, G, [u]); }
    if (SW.hopeless(w, G) >= SAI.yield && !G.terms?.open && w.time - (D.askT ?? -1e9) > 180) { D.askT = w.time; SW.offerTerms(w, G, G.def); answerIfAI(w, G); }
    return;
  }
  // threats: where are the enemy's stormers going?
  const threats = [];
  for (const q of SW.breaches(G, "outer")) { const p = SW.modPoint(G, q.b, q.k); let n = 0; for (const u of G.units[G.att]) if (u.members.length && Math.hypot(u.ax - p.x, u.ay - p.y) < 90) n += u.members.length; if (n) threats.push({ kind: "breach", p, in: SW.modPoint(G, q.b, q.k, -10), face: Math.atan2(SW.secGeom(G, q.b).ny, SW.secGeom(G, q.b).nx), n: n * 1.5 }); }
  const gate = C.gates.find((g) => g.ring === "outer");
  if (gate) { const q = SW.gateGeomOut(G, gate); let n = 0; for (const u of G.units[G.att]) if (u.members.length && Math.hypot(u.ax - q.x, u.ay - q.y) < 60) n += u.members.length; if (n) threats.push({ kind: "gate", p: q, in: { x: q.x - q.nx * 14, y: q.y - q.ny * 14 }, face: Math.atan2(q.ny, q.nx), n: n * (SW.gateDown(gate) ? 1.6 : 0.6) }); }
  for (const u of G.units[G.att]) if (u.members.length && SW.insideCastle(w, G, u.ax, u.ay) && !SW.inKeep(G, u.ax, u.ay)) threats.push({ kind: "lodged", p: { x: u.ax, y: u.ay }, in: { x: u.ax, y: u.ay }, n: u.members.length * 2.5, unit: u.id });
  for (const u of G.units[G.att]) if (u.members.length && u.esc && u.esc.phase !== "approach") { const p = { x: u.esc.px, y: u.esc.py }; threats.push({ kind: "ladders", p, in: { x: p.x - u.esc.nx * 6, y: p.y - u.esc.ny * 6 }, face: Math.atan2(u.esc.ny, u.esc.nx), n: u.members.length }); }
  if (!threats.length) return;
  threats.sort((a, b) => b.n - a.n);
  towerBows(w, G, threats);
  // the reserve (foot not manning a wall) to the worst threats in turn
  const reserve = G.units[G.def].filter((u) => u.members.length && !ARMS[u.arm].missile && !ARMS[u.arm].engine && u.role !== "keep" && u.role !== "sally" && u.state !== "routing" && !u.household);
  reserve.forEach((u, i) => {
    const th = threats[Math.min(threats.length - 1, i % Math.max(1, Math.min(threats.length, 3)))];
    const o = u.pendingOrder || u.order, p = th.in;
    if (th.kind === "lodged") { if (o?.kind !== "assault" || o.target !== th.unit) issueOrder(w, [u.id], { kind: "assault", x: p.x, y: p.y, target: th.unit, pace: "quick" }); }
    else if (!o || Math.hypot(o.x - p.x, o.y - p.y) > 8) issueOrder(w, [u.id], { kind: th.kind === "breach" ? "move" : "move", x: p.x, y: p.y, facing: th.face, formation: "line", pace: "quick" });
    u.role = th.kind === "breach" ? "breach" : u.role === "gate" ? "gate" : "reserve"; u.manning = null; act(G, G.def, "reserve");
  });
}
