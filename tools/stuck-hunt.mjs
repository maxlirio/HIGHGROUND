// Stuck-unit hunter: runs many headless battles and flags every body that has somewhere to go but is not
// getting there, men who jitter back and forth in place, and the lord crawling under the player's hands.
//   node tools/stuck-hunt.mjs [--only scen,skirm,lord] [--minutes 12] [--seeds 2] [--verbose]
// A unit "wants to move" when it has a path, is not holding in contact, is not broken/routing, is not in a
// cavalry charge/melee/rest (the riders drive themselves), and its destination is > 8 m off. A STALL is a
// ≥5 s stretch of that in which its anchor or its men's centre made < 20 % of the progress its pace and the
// going under it allow. OSCILLATION: men (not fighting, not fleeing) whose 5 s path is > 2.5 m but whose net
// displacement is < 25 % of it; a unit is flagged while > 20 % of its men do it.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadMap } from "../js/sim/map.js";
import { createWorld, step, DT, goingMul, addUnit, issueOrder } from "../js/sim/world.js";
import { combatSystem } from "../js/sim/combat.js";
import { makeVision, updateVision } from "../js/sim/vision.js";
import { TERRAIN } from "../js/sim/terrain-types.js";
import { makeObstacles, loadVegetation, obstacleSystem, addCircle, addRect as addRectO, blocked } from "../js/sim/obstacles.js";
import { featuresFromMapData } from "../js/sim/features.js";
import { SCENARIOS, scenarioConfig } from "../js/sim/scenarios.js";
import { prepareField, setupBattle } from "../js/sim/battle.js";
import { commandBattle } from "../js/sim/commander-ai.js";
import { makePlaces } from "../js/ui/places.js";
import { ARMS } from "../js/sim/arms.js";
import { S_FIGHT, S_FLEE, S_RALLY, S_CAPT, ST_FLEE } from "../js/sim/soldiers.js";
import { takeField, embody, AV } from "../js/sim/avatar.js";
import { buildMap } from "./scenarios.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i < 0 ? d : process.argv[i + 1] ?? d; };
const ONLY = arg("only", "scen,skirm,lord").split(","), MIN = +arg("minutes", 12), SEEDS = +arg("seeds", 2), VERB = process.argv.includes("--verbose");
const fetcher = async (u) => { try { const b = await readFile(ROOT + u); return { ok: true, json: async () => JSON.parse(b), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; } catch { return { ok: false }; } };
const json = async (u) => JSON.parse(await readFile(ROOT + u, "utf8"));
const f1 = (x) => (x === undefined || x === null ? "-" : typeof x === "number" ? x.toFixed(1) : String(x));

// ---------------------------------------------------------------- the watcher
function paceOf(u, A) {
  const run = u.runSpeed || A.run;
  let sp = u.pace === "charge" ? run : u.pace === "quick" ? Math.min(run, A.mounted ? 4.2 : A.speed * 1.5) : A.speed * (u.formation === "column" && !u.enemyNear ? 1.15 : 1);
  if (u.paceCap && u.pace === "march") sp = Math.min(sp, u.paceCap);
  return sp;
}
function wantsMove(w, u) {
  if (!u.members.length || u.job || u.isWorkers || u.engine !== undefined || u.household) return false;
  if (!u.path || !u.path.length || u.hold) return false;
  if (u.c?.broken || u.state === "routing") return false;
  if (u.c && ["charge", "melee", "rest", "pursuit"].includes(u.c.phase)) return false;
  const last = u.path[u.path.length - 1];
  return Math.hypot(last[0] - u.ax, last[1] - u.ay) > 8;
}
function snap(w, u) {
  const S = w.S, A = ARMS[u.arm], p0 = u.path?.[0];
  let fight = 0, flee = 0, busy = 0, idle = 0, lagS = 0, n = 0;
  for (const id of u.members) { if (S.state[id] === S_FIGHT) fight++; if (S.state[id] === S_FLEE) flee++; if (S.busyT[id] > w.time) busy++; if (S.state[id] === 0) idle++; lagS += Math.hypot(S.x[id] - S.slotX[id], S.y[id] - S.slotY[id]); n++; }
  return {
    t: w.time.toFixed(0), unit: u.id, team: u.team, arm: u.arm, men: u.members.length, at: [Math.round(u.ax), Math.round(u.ay)],
    order: u.order?.kind + (u.order?.target !== undefined ? "→" + u.order.target : ""), pace: u.pace, path: u.path?.length, next: p0 && [Math.round(p0[0]), Math.round(p0[1])], dNext: p0 && Math.round(Math.hypot(p0[0] - u.ax, p0[1] - u.ay)),
    hold: !!u.hold, disengage: !!u.disengage, phase: u.c?.phase, eng: u.c?.eng, stallS: f1(u.stallS), speedMul: f1(u.speedMul), formation: u.formation, deployAs: u.deployAs?.formation,
    disordered: !!u.disordered, pending: u.pendingOrder ? u.pendingOrder.kind + "@" + f1(u.pendingOrder.eta - w.time) : null, enemyNear: !!u.enemyNear,
    going: p0 ? goingMul(w, A.id, u.ax, u.ay, p0[0] - u.ax, p0[1] - u.ay).toFixed(3) : "-", ahead: p0 ? (() => { const dx = p0[0] - u.ax, dy = p0[1] - u.ay, d = Math.hypot(dx, dy) || 1; return goingMul(w, A.id, u.ax + dx / d * 3, u.ay + dy / d * 3, dx, dy).toFixed(3); })() : "-", lag: f1(lagS / Math.max(1, n)), fight, flee, busy, idle, state: u.state,
  };
}
export function makeWatcher(label) {
  const W = { label, stalls: [], osc: [], starved: [], unitsSeen: new Set(), stallSecs: 0, oscSecs: 0 };
  let pos = null; // per-man ring of 6 samples (x,y)
  const TR = (process.env.TRACE || "").split(":"); // TRACE=label:unit:t0:t1[:every]
  W.sys = (w) => {
    if (TR[0] === label && w.time >= +TR[2] && w.time <= +TR[3] && w.tick % (+TR[4] || 1) === 0) { const u = w.units.get(+TR[1]); if (u) { const S = w.S, m = u.members[0]; console.log(`TR t${w.time.toFixed(1)} ax ${u.ax.toFixed(2)},${u.ay.toFixed(2)} fac ${u.facing.toFixed(2)} path ${JSON.stringify(u.path?.map((p) => p.map(Math.round)))} ord ${JSON.stringify(u.order)} pend ${JSON.stringify(u.pendingOrder)} m0 ${S.x[m].toFixed(1)},${S.y[m].toFixed(1)} st ${S.state[m]} busy ${(S.busyT[m] - w.time).toFixed(1)} slot ${S.slotX[m].toFixed(1)},${S.slotY[m].toFixed(1)} ${JSON.stringify(snap(w, u))}`); if (process.env.TRMEN) for (const id of u.members) { const q = Math.hypot(S.x[id] - S.slotX[id], S.y[id] - S.slotY[id]); if (q > 3) console.log(`   man ${id} at ${S.x[id].toFixed(1)},${S.y[id].toFixed(1)} slot ${S.slotX[id].toFixed(1)},${S.slotY[id].toFixed(1)} off ${q.toFixed(1)} st ${S.state[id]} v ${Math.hypot(S.vx[id], S.vy[id]).toFixed(2)} g ${S.gMul[id].toFixed(2)} busy ${(S.busyT[id] - w.time).toFixed(1)} posture ${S.posture[id]} status ${S.status[id]} horse ${S.horseOK[id]} av ${S.avoid ? S.avoid[id * 2].toFixed(2) + "," + S.avoid[id * 2 + 1].toFixed(2) : "-"} blk ${w.obstacles ? blocked(w.obstacles, S.x[id], S.y[id], 0.9) : "-"}`); } } }
    if (w.tick % 10) return;
    const S = w.S, t = w.time;
    if (!pos || pos.length < S.cap * 12) pos = new Float32Array(S.cap * 12);
    const slot = (w.tick / 10) % 6;
    for (let i = 0; i < S.n; i++) { pos[i * 12 + slot * 2] = S.x[i]; pos[i * 12 + slot * 2 + 1] = S.y[i]; }
    const full = w.tick >= 60;
    for (const u of w.units.values()) {
      if (!u.members.length || u.isWorkers) continue;
      W.unitsSeen.add(u.id);
      const H = (u._sh ||= { hist: [], ep: null, oep: null });
      let cx = 0, cy = 0; for (const id of u.members) { cx += S.x[id]; cy += S.y[id]; } cx /= u.members.length; cy /= u.members.length;
      const A = ARMS[u.arm], want = wantsMove(w, u);
      let exp = 0;
      if (want) { const p = u.path[0]; exp = paceOf(u, A) * (u.speedMul ?? 1) * Math.max(0.06, Math.min(1, goingMul(w, A.id, u.ax, u.ay, p[0] - u.ax, p[1] - u.ay))); }
      // an order that never arrives (ORDER_MAX_S = 5 s is the promise): superseded again and again while on its way
      if (u.pendingOrder) { H.pendT = (H.pendT || 0) + 1; if (H.pendT === 7) W.starved.push({ label, first: snap(w, u) }); if (H.pendT >= 7) W.starved[W.starved.length - 1].dur = H.pendT; } else H.pendT = 0;
      H.hist.push({ t, ax: u.ax, ay: u.ay, cx, cy, want, exp, men: u.members.length });
      if (H.hist.length > 6) H.hist.shift();
      // stall: 5 s all wanting
      let stalled = false, why = "";
      if (H.hist.length === 6 && H.hist.every((h) => h.want) && Math.abs(H.hist[0].men - u.members.length) <= 2) {
        const h0 = H.hist[0], E = H.hist.slice(1).reduce((s, h) => s + h.exp, 0);
        const da = Math.hypot(u.ax - h0.ax, u.ay - h0.ay), dc = Math.hypot(cx - h0.cx, cy - h0.cy);
        if (E > 1 && da < 0.2 * E) { stalled = true; why = `anchor ${da.toFixed(1)}/${E.toFixed(1)} m`; }
        else if (E > 1 && dc < 0.2 * E) { stalled = true; why = `men ${dc.toFixed(1)}/${E.toFixed(1)} m (anchor ${da.toFixed(1)})`; }
      }
      if (stalled) { W.stallSecs++; if (!H.ep) { H.ep = { label, first: snap(w, u), why, t0: t, dur: 0 }; W.stalls.push(H.ep); } H.ep.dur = t - H.ep.t0 + 5; H.ep.last = snap(w, u); }
      else H.ep = null;
      // oscillation
      if (full) {
        let osc = 0, cnt = 0;
        for (const id of u.members) {
          const st = S.state[id]; if (st === S_FIGHT || st === S_FLEE || st === S_RALLY || st === S_CAPT || S.posture[id] || S.busyT[id] > t) continue;
          cnt++;
          let L = 0; const b = id * 12;
          for (let k = 1; k < 6; k++) { const a = (slot + k) % 6, pr = (slot + k - 1) % 6; L += Math.hypot(pos[b + a * 2] - pos[b + pr * 2], pos[b + a * 2 + 1] - pos[b + pr * 2 + 1]); }
          const o = (slot + 1) % 6, N = Math.hypot(pos[b + slot * 2] - pos[b + o * 2], pos[b + slot * 2 + 1] - pos[b + o * 2 + 1]);
          if (L > 2.5 && N < 0.25 * L) osc++;
        }
        if (cnt >= 6 && osc >= 3 && osc > 0.2 * cnt) { W.oscSecs++; if (!H.oep) { H.oep = { label, first: { ...snap(w, u), oscMen: osc, of: cnt }, t0: t, dur: 0 }; W.osc.push(H.oep); } H.oep.dur = t - H.oep.t0 + 5; }
        else H.oep = null;
      }
    }
  };
  return W;
}
function report(W) {
  const long = W.stalls.filter((e) => e.dur >= 5);
  console.log(`  [${W.label}] units ${W.unitsSeen.size} · stall episodes ${long.length} (${W.stallSecs} unit-s) · oscillation episodes ${W.osc.length} (${W.oscSecs} unit-s) · orders pending > 6 s ${W.starved.length}`);
  for (const e of W.starved.slice(0, VERB ? 999 : 4)) console.log(`     STARVED ${e.dur}s ${JSON.stringify(e.first)}`);
  for (const e of long.slice(0, VERB ? 999 : 8)) console.log(`     STALL ${e.dur.toFixed(0)}s ${e.why}  ${JSON.stringify(e.first)}${VERB && e.last ? "\n        …last " + JSON.stringify(e.last) : ""}`);
  for (const e of W.osc.slice(0, VERB ? 999 : 5)) console.log(`     OSC ${e.dur.toFixed(0)}s ${JSON.stringify(e.first)}`);
}
const TOT = { starved: 0, stalls: 0, stallSecs: 0, osc: 0, oscSecs: 0, lord: 0, lordSecs: 0 };
const tally = (W) => { TOT.stalls += W.stalls.filter((e) => e.dur >= 5).length; TOT.stallSecs += W.stallSecs; TOT.osc += W.osc.length; TOT.oscSecs += W.oscSecs; TOT.starved += W.starved.length; };

// ---------------------------------------------------------------- 1. the historical battles on the Vale (battle mode)
const [veg, objects, settle] = await Promise.all(["maps/vale/vegetation.json", "maps/vale/objects.json", "maps/vale/settlements.json"].map(json));
async function valeBattle(id, seed, side = null) {
  const map = await loadMap("maps/vale", fetcher);
  const places = makePlaces(map, settle);
  const cfg = scenarioConfig(map, id, side);
  prepareField(map, cfg);
  const w = createWorld({ map, terrain: TERRAIN, seed });
  const V = makeVision(map); V.every = 10;
  w.obstacles = makeObstacles(); loadVegetation(w.obstacles, veg); w.features = featuresFromMapData(objects, veg);
  w.systems.push(combatSystem, (w) => updateVision(w, V, map.canopyGrid ? map.canopy : null), obstacleSystem);
  const B = setupBattle(w, cfg, { PLAYER: 0, V, places });
  const ps = cfg.playerSide, mine = { team: 0, units: new Set(B.units[ps].filter((u) => !u.lurking).map((u) => u.id)), disposition: cfg.sides[ps].temper || "inspiring", V };
  w.systems.push((w) => { if (B.phase !== "deploy") { for (const u of B.units[ps]) if (u.sprung && !mine.units.has(u.id)) mine.units.add(u.id); commandBattle(w, mine); } });
  return { w, B, cfg, map };
}
if (ONLY.includes("scen")) {
  console.log("=== Vale battles (battle mode, AI vs AI)");
  for (const id of arg("battles", Object.keys(SCENARIOS).join(",")).split(",")) for (let s = 1; s <= SEEDS; s++) {
    const { w, B } = await valeBattle(id, s);
    const W = makeWatcher(`${id}#${s}`); w.systems.push(W.sys);
    B.advance();
    const t0 = Date.now();
    const tEnd = process.env.TRACE ? +process.env.TRACE.split(":")[3] + 1 : 1e9;
    for (let k = 0; k < MIN * 60 / DT && w.time - B.rec.t0 < tEnd; k++) { step(w); if (B.rec.outcome && w.time - B.rec.t0 > B.rec.outcome.t + 60) break; }
    report(W); tally(W); if (VERB) console.log(`     (${((Date.now() - t0) / 1000).toFixed(0)} s wall)`);
  }
}

// ---------------------------------------------------------------- 2. skirmishes on varied terrain
function skirmMap(kind) {
  const woods = (x, y) => kind === "woods" && Math.hypot(x - 800, y - 800) < 220 ? 14 : kind === "strips" && ((Math.floor(y / 90) % 3) === 1) && x > 450 && x < 1150 ? 12 : 0;
  const h = kind === "hills" ? (x, y) => 50 + 25 * Math.sin(x / 160) * Math.cos(y / 210) : () => 50;
  const water = kind === "marsh" ? (x, y) => (Math.abs(y - 800) < 60 && Math.abs(x - 800) < 250 ? 0.4 : 0) : null;
  return buildMap({ size: 1600, res: 321, h, canopy: woods, water, rain: kind === "marsh" ? 0.8 : 0 });
}
function skirmish(kind, seed) {
  const map = skirmMap(kind);
  const w = createWorld({ map, terrain: TERRAIN, seed });
  w.systems.push(combatSystem, obstacleSystem);
  w.obstacles = makeObstacles();
  // trees in the canopy, a few hedgerows and lone trunks across the middle
  const rnd = w.rng;
  for (let y = 0; y < 1600; y += 6) for (let x = 0; x < 1600; x += 6) if (map.canopyGrid && map.canopy?.(x, y) > 5 && rnd.next() < 0.35) addCircle(w.obstacles, x + rnd.range(-2, 2), y + rnd.range(-2, 2), rnd.range(0.3, 0.8));
  if (kind !== "open") for (let k = 0; k < 6; k++) { const y0 = 600 + k * 70, x0 = 500 + rnd.range(0, 200), L = rnd.range(80, 260); for (let x = x0; x < x0 + L; x += 2.2) if (rnd.next() > 0.04) addCircle(w.obstacles, x, y0 + rnd.range(-0.4, 0.4), 1.25); }
  for (let k = 0; k < 120; k++) addCircle(w.obstacles, rnd.range(500, 1100), rnd.range(550, 1050), rnd.range(0.3, 0.75));
  w.teams[0].hq = { x: 800, y: 300 }; w.teams[1].hq = { x: 800, y: 1300 };
  const mk = (team, y) => {
    const f = team ? Math.PI : 0, ids = [];
    const L = [["spearmen", 80, -140, "line"], ["levy", 90, 0, "line"], ["menatarms", 60, 140, "deep"], ["hobelars", 20, -420, "loose"], ["archers", 50, 0, "loose", -40], ["knights", 24, 320, "wedge"], ["pikemen", 90, -320, "deep"]];
    for (const [arm, n, dx, form, dy = 0] of L) ids.push(addUnit(w, { team, arm, count: n, x: 800 + dx, y: y + (team ? -dy : dy), facing: f, formation: form }));
    return ids;
  };
  const a = mk(0, 420), b = mk(1, 1180);
  const cA = { team: 0, units: new Set(a.map((u) => u.id)), disposition: seed % 2 ? "aggressive" : "inspiring" };
  const cB = { team: 1, units: new Set(b.map((u) => u.id)), disposition: seed % 3 ? "aggressive" : "shock" };
  w.systems.push((w) => { commandBattle(w, cA); commandBattle(w, cB); });
  // plus a few plain player-style moves: bodies sent straight across the obstacles and back
  return { w, a, b };
}
if (ONLY.includes("skirm")) {
  console.log("=== Skirmishes (AI vs AI, varied terrain + scripted cross-country moves)");
  for (const kind of ["open", "woods", "strips", "hills", "marsh"]) for (let s = 1; s <= SEEDS; s++) {
    const { w, a, b } = skirmish(kind, s);
    const W = makeWatcher(`${kind}#${s}`); w.systems.push(W.sys);
    // a player-ordered march through the middle before the AI grabs everything: order one body of each side
    const P = addUnit(w, { team: 0, arm: "spearmen", count: 60, x: 300, y: 500, facing: 0, formation: "line" });
    const Q = addUnit(w, { team: 0, arm: "knights", count: 20, x: 250, y: 400, facing: 0, formation: "wedge" });
    const V2 = addUnit(w, { team: 0, arm: "levy", count: 80, x: 1300, y: 500, facing: 0, formation: "deep" });
    issueOrder(w, [P.id], { kind: "move", x: 1300, y: 900 }); issueOrder(w, [Q.id], { kind: "move", x: 1300, y: 850, pace: "quick" });
    issueOrder(w, [V2.id], { kind: "move", x: 300, y: 900, pace: "quick" });
    for (let k = 0; k < MIN * 60 / DT; k++) {
      step(w);
      // an impatient player re-clicking a body that has not moved yet (each click a little further on)
      if (k >= 2400 && k < 2800 && k % 30 === 0) issueOrder(w, [V2.id], { kind: "move", x: 300 + (k - 2400) / 30 * 30, y: 500 });
      if (k === 1500) { issueOrder(w, [P.id], { kind: "move", x: 300, y: 700 }); issueOrder(w, [Q.id], { kind: "move", x: 800, y: 1000, pace: "quick" }); }
    }
    report(W); tally(W);
  }
}

// ---------------------------------------------------------------- 3. the lord under the player's hands
// A scripted rider: gallop to a point, ride among his own men, into an enemy body and out, dismount and mount,
// ride through woods and hedges. Flags ≥3 s stretches in which he is asked to move, is not down, stunned,
// refused or within 2 m of an enemy on his line, and makes < 20 % of the distance his gait and the going allow.
function lordRun(label, w, script, secs) {
  const A = w.avatar, S = w.S, L = A.lord; embody(w, true);
  const out = { label, stalls: [], secs: 0, dist: 0, asked: 0 };
  const hist = []; let ep = null;
  for (let k = 0; k < secs / DT; k++) {
    if (A.outcome) break;
    const leg = script(w, k * DT);
    step(w);
    if (k % 10) continue;
    const mounted = S.horseOK[L] === 1, gait = A.input.gait;
    const ask = Math.hypot(A.input.mx, A.input.my) > 0.1;
    const tgt = mounted ? (gait === 2 ? 7 : AV.speedMounted[gait]) : (gait === 2 ? 3 : AV.speedFoot[gait]);
    const hx = Math.cos(A.heading), hy = Math.sin(A.heading);
    const g = Math.max(0.05, Math.min(1, goingMul(w, S.arm[L], S.x[L], S.y[L], hx, hy)));
    let enemyAhead = false;
    for (let i = 0; i < S.n; i++) if (S.alive[i] && S.team[i] !== S.team[L] && S.state[i] !== S_CAPT && Math.hypot(S.x[i] - S.x[L], S.y[i] - S.y[L]) < 3) { enemyAhead = true; break; }
    const bogEdge = mounted && goingMul(w, S.arm[L], S.x[L] + hx * 2, S.y[L] + hy * 2, hx, hy) < 0.06; // (the horse refusing ground it cannot bear is intended: the player is told)
    const excused = !ask || S.posture[L] !== 0 || w.time < A.stunUntil || enemyAhead || S.stunT[L] > w.time || bogEdge;
    hist.push({ t: w.time, x: S.x[L], y: S.y[L], exp: excused ? 0 : tgt * g, ok: !excused, leg });
    if (hist.length > 4) hist.shift();
    if (ask) { out.asked++; }
    if (hist.length === 4 && hist.every((h) => h.ok)) {
      const E = hist.slice(1).reduce((s, h) => s + h.exp, 0) * 0.5; // (he has to accelerate: count half)
      const d = Math.hypot(S.x[L] - hist[0].x, S.y[L] - hist[0].y);
      if (d < 0.2 * E) {
        out.secs++;
        if (!ep) { ep = { label, leg, t: w.time.toFixed(0), d: d.toFixed(2), E: E.toFixed(1), speed: A.speed.toFixed(2), mounted, gait, going: g.toFixed(2), busy: (S.busyT[L] - w.time).toFixed(2), stun: (A.stunUntil - w.time).toFixed(1), ride: !!A.ride, at: [Math.round(S.x[L]), Math.round(S.y[L])], dur: 0 }; out.stalls.push(ep); }
        ep.dur++;
      } else ep = null;
    } else ep = null;
  }
  return out;
}
function lordReport(o) {
  console.log(`  [${o.label}] lord stall episodes ${o.stalls.length} (${o.secs} s)`);
  for (const e of o.stalls.slice(0, VERB ? 99 : 8)) console.log(`     LORD ${JSON.stringify(e)}`);
  TOT.lord += o.stalls.length; TOT.lordSecs += o.secs;
}
const steerTo = (w, x, y, gait = 2) => { const A = w.avatar, S = w.S, L = A.lord; const dx = x - S.x[L], dy = y - S.y[L], d = Math.hypot(dx, dy); if (d < 4) { A.input.mx = A.input.my = 0; return true; } A.input.mx = dx / d; A.input.my = dy / d; A.input.gait = gait; A.input.aim = Math.atan2(dy, dx); return false; };
function waypoints(pts) {
  let i = 0, hold = 0;
  return (w, t) => {
    const A = w.avatar; const p = pts[Math.min(i, pts.length - 1)];
    if (p.mount) { if (!p.done) { A.input.mx = A.input.my = 0; A.input.mount = true; p.done = true; hold = t + 1.5; } if (t > hold) i++; return p.name; }
    A.input.charge = !!p.charge;
    if (steerTo(w, p.x, p.y, p.gait ?? 2) || (p.until && t > p.until)) i++;
    return p.name;
  };
}
if (ONLY.includes("lord")) {
  console.log("=== The lord");
  // (0) ridden up against a trunk or a house wall, then asked to ride on in every direction
  for (const kind of ["trunk", "house"]) for (const ang of [0.8, 1.6, 2.4, 3.1, 4.0, 4.7, 5.5]) {
    const { w } = skirmish("open", 1); for (let k = 0; k < 5; k++) step(w);
    takeField(w, 0, 300, 250, { facing: 0 }); const A = w.avatar, S = w.S, L = A.lord;
    if (kind === "trunk") addCircle(w.obstacles, S.x[L] + 1.0, S.y[L], 0.6); else addRectO(w.obstacles, S.x[L] + 3.4, S.y[L], 0, 3, 3);
    lordReport(lordRun(`${kind}@${ang}`, w, (w) => { A.input.mx = Math.cos(ang); A.input.my = Math.sin(ang); A.input.gait = 1; return "ride away"; }, 8));
  }
  for (let s = 1; s <= SEEDS; s++) {
    // (a) the skirmish field: woods, hedges, his own bodies, an enemy body to ride into and out of
    const { w, a, b } = skirmish("strips", 10 + s);
    for (let k = 0; k < 20; k++) step(w);
    const r = takeField(w, 0, 800, 380); if (r.error) { console.log("  lord:", r.error); continue; }
    const sp = a[1]; // the levy in the middle: ride through them
    const pts = [
      { name: "gallop out", x: 400, y: 380 }, { name: "through own levy", x: sp.ax, y: sp.ay + 30, gait: 1 }, { name: "among own spears", x: a[0].ax, y: a[0].ay, gait: 2 },
      { name: "trot the hedges", x: 700, y: 900, gait: 1 }, { name: "gallop the woods", x: 800, y: 700, gait: 2 },
      { name: "at the enemy", x: b[1].ax, y: b[1].ay, gait: 2, charge: true, until: 200 }, { name: "out of melee", x: 800, y: 350, gait: 2 },
      { name: "dismount", mount: 1 }, { name: "walk on foot", x: 700, y: 350, gait: 1 }, { name: "run on foot", x: 750, y: 450, gait: 2 },
      { name: "mount", mount: 1 }, { name: "gallop home", x: 900, y: 300, gait: 2 },
    ];
    lordReport(lordRun(`strips#${s}`, w, waypoints(pts), 360));
    // (b) a Vale battle: he takes the field behind his line, rides along it, into the fight and out
    const { w: w2, B, cfg } = await valeBattle(["crecy", "courtrai", "stirling"][s % 3], s);
    B.advance(); for (let k = 0; k < 600; k++) step(w2);
    const mine = B.units[cfg.playerSide].filter((u) => u.members.length);
    let hx = 0, hy = 0; for (const u of mine) { hx += u.ax; hy += u.ay; } hx /= mine.length; hy /= mine.length;
    const z = B.zones[cfg.playerSide], back = { x: hx - Math.cos(z.face) * 60, y: hy - Math.sin(z.face) * 60 };
    const r2 = takeField(w2, 0, back.x, back.y); if (r2.error) { console.log("  lord (vale):", r2.error); continue; }
    const pts2 = [];
    for (const u of mine.slice(0, 5)) pts2.push({ name: "to " + u.arm, x: u.ax, y: u.ay, gait: (pts2.length % 3), until: 90 * (pts2.length + 1) });
    const foe = B.units[1 - cfg.playerSide].find((u) => u.members.length);
    if (foe) pts2.push({ name: "at the enemy", x: foe.ax, y: foe.ay, gait: 2, charge: true, until: 600 });
    pts2.push({ name: "back out", x: back.x, y: back.y, gait: 2 });
    lordReport(lordRun(`vale-${cfg.id}#${s}`, w2, waypoints(pts2), 600));
  }
}
console.log(`\nTOTAL orders pending > 6 s ${TOT.starved} · stall episodes ${TOT.stalls} (${TOT.stallSecs} unit-s) · oscillation episodes ${TOT.osc} (${TOT.oscSecs} unit-s) · lord stalls ${TOT.lord} (${TOT.lordSecs} s)`);
