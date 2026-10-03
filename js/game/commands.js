// The player's commands, as plain data in and plain results out: the one place where what the player does touches
// the sim. DOM-free, so the same module runs in the browser (the single-player shell, js/main.js, calls it directly) and
// on the realm server (server/, one per team: every `cmd` message from that team's client is `cmds.apply(op, args)`).
// docs/realm-protocol.md lists the ops.
//
//   w.systems.push(...commandSystems(w, { measured }));   // once per world (all teams)
//   const cmds = makeCommands(w, team);                    // one per team
//   cmds.apply("order", { ids, order, append }) → { ok, n, msg } | { ok: false, error }
//
// commandSystems are the per-tick systems the shell used to keep inline for the player's orders (order chains, bowmen
// following a body they were told to shoot, soldiers helping on a building site, torches at an enemy building,
// fortifying, new buildings becoming solid). Order chains live on the world (w.chains, plain data: saved with it).
// Written by REALM-CLIENT to REALM-SERVER's spec (docs/realm-protocol.md), factored out of main.js.
import { tradeHere } from "../ui/market-ui.js"; // (the market: buy and sell)
import { issueOrder, splitUnit, mergeUnits } from "../sim/world.js";
import { ARMS, FORMATIONS } from "../sim/arms.js";
import { MOUNT_ID } from "../sim/mounts.js";
import { groupLayout } from "../ui/groups.js";
import { orderContext } from "../ui/orders.js";
import { setFireMode } from "../sim/ballistics.js";
import { fieldWork } from "../sim/features.js";
import { engineOf } from "../sim/siege.js";
import { loadObjects } from "../sim/obstacles.js";
import { markObstaclesOnNav } from "../sim/path.js";
import { placeOnPlan } from "../sim/townplan.js";
import { mineWhy } from "../sim/veins.js"; // (only the holder's men mine a vein)
import * as EC from "../sim/economy.js";
import * as FL from "../sim/jobs/fields.js";
import * as CS from "../sim/castle.js";
import * as TW from "../sim/townwall.js";            // a town's walls: the fighting step, the wall-walk, the tower tops
import * as TC from "../sim/tech.js";                 // research (docs/tech.md)
import { crossingNear, BURN_S } from "../sim/crossings.js";
import { decide as captainDecide, setInitiative } from "../sim/captains.js";
import { setFootprints } from "../sim/jobs/forestry.js";  // (a building's ground is grubbed by its model's box)
import { herdAt, SPECIES } from "../sim/wild.js";          // lane C: game to hunt (docs/gathering-plan.md)
import { startHunt, startCapture, penOf } from "../sim/jobs/hunting.js";
import * as DG from "../sim/dragons.js";                   // the vale's dragons (js/sim/dragons.js): fight, claim, summon
import * as BRG from "../sim/bridges.js";                  // a house's timber bridges: "Bridge here", sited by reading the river
import * as FD from "../sim/founding.js";                 // founding a new town (a settlers' column, a daughter settlement)
import * as TWN from "../sim/towns.js";                    // a house's towns: a command on a daughter's ground or building runs in its frame
import * as DM from "../sim/demolish.js";                  // pulling down; palisades rebuilt in stone
import * as RL from "../sim/reeve-learn.js";               // the learning reeve: the player's economic commands, with their situations
import { setTask, taskOptions, broadSystem, TASK_IDS } from "../sim/broad.js"; // broad tasks: "Gather wood", "Hunt", "Patrol the town" (right-click a company)

export const ORDER_WORD = { man_walls: "To the walls", come_down: "Coming down", burn: "Burning it", sally: "Sallying out", "fire-gate": "Firing the gate", barricade: "Barricading", mine: "Mining", volley: "Volleys", loose: "Loose at will", holdfire: "Hold fire", move: "Marching", hold: "Holding", hunt: "Hunting", capture: "Capturing", fortify: "Fortifying", ambush: "Setting ambush", assault: "Assaulting", skirmish: "Skirmishing", scout: "Scouting", gather: "Gathering",
  bombard: "Bombarding", batter: "Battering", advance: "Advancing the tower", assemble: "Assembling", escalade: "Escalade", crew: "Manning the engine", build: "Building" };
const SIEGE_ORDERS = new Set(["bombard", "batter", "advance", "assemble", "escalade", "crew"]);
const WORK = new Set(["burn", "build", "gather"]);
const FIRE_ORDERS = { volley: "volley", loose: "will", holdfire: "hold" };
const RANGE = { longbow: 230, crossbow: 190 };
const PACES_OK = new Set(["march", "quick", "charge"]);

const bld = (w, id) => w.buildings.find((b) => b.id === id) || null;
const teamOfChain = (w, c) => w.units.get(c.units[0])?.team ?? c.team;

// ---- command chains: "go here, then here, then here". A plain order replaces everything the group was doing; an
// appended order waits until the previous step is finished. On the world (w.chains: [{ team, units: [unit ids],
// steps: [order], current: order }], plain data; a work order's building is its id, order.bid).
const chainsOf = (w) => (w.chains ||= []);
export function chainOf(w, ids) { for (const c of chainsOf(w)) for (const id of ids) if (c.units.includes(id)) return c; return null; }
export function dropChains(w, ids) { w.chains = chainsOf(w).filter((c) => !ids.some((id) => c.units.includes(id))); } // (a captain's orders replace ours)
export function chainPoints(w, ids) { const c = chainOf(w, ids); if (!c) return null; return [c.current, ...c.steps].map((o) => [o.x, o.y]); }

// work steps (burn / build / gather): validated when issued, then run as ordinary chain steps
function workTarget(w, team, order) {
  if (order.kind === "burn") return w.buildings.filter((b) => b.team !== team && !b.ruin).map((b) => ({ b, d: Math.hypot(b.x - order.x, b.y - order.y) })).filter((o) => o.d < 60).sort((a, c) => a.d - c.d)[0]?.b || null;
  if (order.kind === "build") return w.buildings.filter((b) => b.team === team && (b.progress < 1 || b.hp < (b.hpMax || b.hp)))
    .map((b) => ({ b, d: b.x1 !== undefined ? Math.hypot(b.x - order.x, b.y - order.y) - Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 2 : Math.hypot(b.x - order.x, b.y - order.y) }))
    .filter((o) => o.d < 45).sort((a, c) => a.d - c.d)[0]?.b || null;
  return null;
}
function runWork(w, us, order) {
  const tgt = order.bid !== undefined ? bld(w, order.bid) : null;
  if (order.kind === "burn") { if (!tgt) return; for (const u of us) { if (u.isWorkers) continue; u.burning = tgt.id; issueOrder(w, [u.id], { kind: "move", x: tgt.x, y: tgt.y, pace: "quick" }); } return; }
  for (const u of us) {
    if (u.isWorkers) issueOrder(w, [u.id], { ...order, bid: undefined, nid: undefined, building: order.kind === "build" || order.kind === "gather" ? tgt || undefined : undefined, node: order.nid !== undefined ? (w.resources || []).find((n) => n.id === order.nid && n.amount > 0) : undefined }); // (the place clicked: orders.workAt)
    else if (order.kind === "build" && tgt) { u.helping = tgt.id; issueOrder(w, [u.id], { kind: "move", x: tgt.x, y: tgt.y, pace: "march" }); } // soldiers lend their backs
  }
}
// fire a timber bridge (either side's): the party goes to its nearer end and sets it alight there (crossings.BURN_S)
function burnBridge(w, us, xc, note) {
  let cx = 0, cy = 0; for (const u of us) { cx += u.ax / us.length; cy += u.ay / us.length; }
  const nearA = Math.hypot(xc.ax - cx, xc.ay - cy) <= Math.hypot(xc.bx - cx, xc.by - cy), ex = nearA ? xc.ax : xc.bx, ey = nearA ? xc.ay : xc.by;
  let n = 0; for (const u of us) { if (u.isWorkers) continue; issueOrder(w, [u.id], { kind: "move", x: ex, y: ey, pace: "quick" }); u.burnXing = xc.id; n++; }
  if (n) note?.(`They go to fire the bridge (about ${BURN_S} s at it)`);
  return n ? 1 : 0;
}
// the group moves as one body and forms a single battle line at the destination. → the step number (0: refused; the
// reason goes to note)
function orderGroup(w, team, us, order, append = false, note = null) {
  if (!us.length) return 0;
  if (WORK.has(order.kind)) {
    if (order.kind === "burn" && !workTarget(w, team, order)) { const xc = crossingNear(w, order.x, order.y, 40, true); if (xc) return burnBridge(w, us, xc, note); } // (a bridge the men made: js/sim/crossings.js)
    if (order.kind !== "gather") { const t = (order.kind === "build" && order.bid !== undefined && bld(w, order.bid)) || workTarget(w, team, order); if (!t) { note?.(order.kind === "burn" ? "No enemy building there" : "No building site there"); return 0; } order.bid = t.id; }
    if (order.kind === "burn" && !EC.BUILDINGS[bld(w, order.bid).kind].flammable) note?.("Stone won't burn — they'll try to pull it down, slowly");
  }
  const ids = us.map((u) => u.id), all = chainsOf(w);
  if (append) {
    let c = chainOf(w, ids);
    if (!c) { c = { team, units: ids, steps: [], current: { kind: us[0].order?.kind || "hold", x: us[0].order?.x ?? us[0].ax, y: us[0].order?.y ?? us[0].ay } }; all.push(c); }
    c.steps.push(order);
    return c.steps.length + 1;
  }
  for (const u of us) u.fireAt = null;
  // a new order replaces whatever they were doing (the owner changed his mind: no committed orders);
  // Shift / "Add as next step" still queues a chain
  const hit = all.filter((c) => us.some((u) => c.units.includes(u.id)));
  for (const c of hit) for (const id of c.units) { const v = w.units.get(id); if (v) { v.helping = null; v.burning = null; } }
  w.chains = all.filter((c) => !hit.includes(c));
  w.chains.push({ team, units: ids, steps: [], current: order, t0: w.tick });
  executeStep(w, team, us, order);
  return 1;
}
function executeStep(w, team, us, order) {
  if (WORK.has(order.kind)) return runWork(w, us, order);
  // fire orders change how the bows shoot, not where they stand (volley: at the enemy body clicked, else the ground)
  if (FIRE_ORDERS[order.kind]) {
    const tgt = [...w.units.values()].filter((v) => v.team !== team && v.members.length && !v.isWorkers).map((v) => [v, Math.hypot(v.ax - order.x, v.ay - order.y)]).filter(([, d]) => d < 30).sort((a, b) => a[1] - b[1])[0]?.[0];
    for (const u of us) if (setFireMode(w, u, FIRE_ORDERS[order.kind], order.kind === "volley" ? (tgt ? { unit: tgt.id } : { x: order.x, y: order.y }) : null)) u.fireAt = null;
    return;
  }
  // siege orders go to the very spot clicked (the wall section, the gate, the emplacement), not a formation slot
  if (SIEGE_ORDERS.has(order.kind)) { us.forEach((u) => issueOrder(w, [u.id], { ...order, x: order.x, y: order.y, facing: Math.atan2(order.y - u.ay, order.x - u.ax), pace: order.pace || (order.kind === "escalade" ? "quick" : "march") })); return; }
  let cx = 0, cy = 0, n = 0; for (const u of us) { cx += u.ax * u.members.length; cy += u.ay * u.members.length; n += u.members.length; }
  cx /= n; cy /= n;
  const facing = order.facing ?? (Math.hypot(order.x - cx, order.y - cy) > 5 ? Math.atan2(order.y - cy, order.x - cx) : (us[0].finalFacing ?? 0));
  if (order.formation) for (const u of us) u.formation = order.formation;
  // a frontage dragged out by the player: the line bodies (not horse, not engines) share it, each as deep as that makes it
  if (order.frontage) {
    const line = us.filter((u) => !ARMS[u.arm].mounted && !ARMS[u.arm].engine && !["wedge", "schiltron", "column"].includes(order.formation || u.formation));
    const men = line.reduce((a, u) => a + u.members.length, 0);
    for (const u of line) { const A = ARMS[u.arm], share = order.frontage * u.members.length / Math.max(1, men); const files = Math.max(2, Math.round(share / (A.spacing * (FORMATIONS[order.formation || u.formation]?.dense || 1)))); u._depth = Math.max(1, Math.ceil(u.members.length / files)); }
  }
  const slots = groupLayout(us, order.x, order.y, facing);
  for (const u of us) { const t = slots.get(u.id) || order, dep = u._depth; u._depth = undefined; issueOrder(w, [u.id], { ...order, x: t.x, y: t.y, facing, ...(dep ? { formation: order.formation || (u.formation === "column" ? "line" : u.formation), depth: dep } : {}) }); }
}
// a step is done when every unit has arrived (assaults: when no enemy is left near the objective)
function stepDone(w, team, c, us) {
  const o = c.current, tb = o.bid !== undefined ? bld(w, o.bid) : null;
  if (o.kind === "burn") return !tb || tb.ruin;
  if (o.kind === "build") return !tb || tb.progress >= 1 || us.every((u) => u.isWorkers && !u.job);
  if (o.kind === "gather") return true; // villagers settle into the work; the next step can follow
  if (FIRE_ORDERS[o.kind]) return true; // (a fire order is given, not walked to)
  if (SIEGE_ORDERS.has(o.kind)) return us.every((u) => { const e = engineOf(w, u); if (o.kind === "escalade") return !u.esc && u.order?.kind !== "escalade" && !u.pendingOrder; if (o.kind === "crew") return u.crewFor === undefined && !u.pendingOrder; if (!e) return true; return !u.pendingOrder && (o.kind === "assemble" ? e.state !== "packed" && e.state !== "assembling" : o.kind === "advance" ? !!e.docked || !e.tgt : !e.tgt); });
  if (o.kind === "assault") {
    for (const v of w.units.values()) if (v.team !== team && v.members.length && v.state !== "routing" && Math.hypot(v.ax - o.x, v.ay - o.y) < 150) return false;
    return true;
  }
  return us.every((u) => !u.path && Math.hypot(u.ax - (u.order?.x ?? u.ax), u.ay - (u.order?.y ?? u.ay)) < 20);
}
// every team's chains: the next step once the last is done (main.js: each frame; the server: each tick)
export function advanceChains(w) {
  for (const c of [...chainsOf(w)]) {
    const us = c.units.map((id) => w.units.get(id)).filter((u) => u && u.members.length), team = teamOfChain(w, c);
    const done = us.length && stepDone(w, team, c, us);
    if (!us.length || (!c.steps.length && done)) { if (!c.steps.length) w.chains = w.chains.filter((q) => q !== c); continue; }
    if (c.steps.length && done) { c.current = c.steps.shift(); executeStep(w, team, us, c.current); }
  }
}
// bowmen told to shoot a body keep it in their sights at a good shooting distance and follow it as it moves (all teams)
function followShooters(w, onlyTeam = -1) {
  for (const u of w.units.values()) {
    if (!u.fireAt || (onlyTeam >= 0 && u.team !== onlyTeam)) continue;
    const t = w.units.get(u.fireAt);
    if (!t || !t.members.length || t.c?.broken) { u.fireAt = null; continue; }
    const A = ARMS[u.arm], R = (RANGE[A.missile] || 200) * 0.75, dx = t.ax - u.ax, dy = t.ay - u.ay, d = Math.hypot(dx, dy) || 1;
    if (u.c && d < R / 0.75) { u.c.mtgt = t; u.c.mT = w.time; } // steer the target choice: this body, whenever it is in range and in sight
    if (u.tw) continue; // (up on the walls: they shoot from there — js/sim/townwall.js)
    if (d > R * 1.15 || onlyTeam >= 0) { // keep it at a good shooting distance: close in if it's out of range, stand if it's in
      const sx = t.ax - dx / d * R, sy = t.ay - dy / d * R;
      if (!u.order || Math.hypot((u.order.x ?? 0) - sx, (u.order.y ?? 0) - sy) > 25) { issueOrder(w, [u.id], { kind: "skirmish", x: sx, y: sy, facing: Math.atan2(dy, dx), pace: "quick", ...(u.atkForm ? { formation: u.atkForm } : {}) }); u.atkForm = null; }
    }
  }
}

// ================================================================ one team's commands (plain data in, plain result out)
export function makeCommands(w, team) {
  const PLAYER = team;
  const fin = (v) => Number.isFinite(v) && v >= Math.min(w.map?.x0 ?? 0, w.map?.y0 ?? 0) && v <= Math.max(w.map?.x1 ?? 1e9, w.map?.y1 ?? 1e9); // (the map's extent: the big world reaches below 0 — docs/big-world.md)
  const unitsOf = (ids) => (Array.isArray(ids) ? ids : []).map((id) => w.units.get(id)).filter((u) => u && u.team === PLAYER);
  const endHunt = (us) => { for (const u of us) { if (u.hunt) u.hunt = null; u.broad = null; } DG.endDragonOrders(w, us); return us; }; // (lane C: any other command calls a hunting party — or a dragon fight, or a broad task — off)
  const menOf = (us) => us.reduce((s, u) => s + u.members.length, 0);
  const toasts = [];
  const note = (m) => toasts.push(m);
  // "Attack" means what attacking means at that spot (orders.orderContext): engines bombard / batter / advance; a garrison
  // sallies at an engine; foot fire a gate; men near an enemy building fight what is there and then burn it; else an
  // assault. Returns a result when it issued the orders itself; otherwise it rewrites order.kind for orderGroup.
  function resolveAttack(order, units, c, append) {
    if (c.engines.length) {
      const KIND = { trebuchet: "bombard", mangonel: "bombard", springald: "bombard", ram: "batter", siege_tower: "advance" };
      for (const u of c.engines) if (KIND[u.arm]) issueOrder(w, [u.id], { kind: KIND[u.arm], x: order.x, y: order.y, pace: order.pace || "march" });
      const rest = units.filter((u) => !ARMS[u.arm].engine); if (!rest.length) return { ok: true, msg: "The engines go to work" };
    }
    if (c.side === "defend" && c.enemyEngine) { order.kind = "sally"; return null; }
    if (c.side === "attack" && c.enemyGate && c.foot) { order.kind = "fire-gate"; return null; }
    if (c.enemyBuilding && !c.enemyMen) { order.kind = "burn"; return null; }
    order.kind = "assault";
    if (c.enemyBuilding) { const n = orderGroup(w, PLAYER, units, order, append, note); if (n) orderGroup(w, PLAYER, units, { ...order, kind: "burn" }, true, note); return { ok: !!n, n, msg: `Attack: ${menOf(units)} men, then burn the ${c.enemyBuilding.kind.replace(/_/g, " ")}` }; }
    return null;
  }
  function huntOrder({ ids, order }) {
    const us = unitsOf(ids); if (!us.length) return { ok: false, error: "No one to order" };
    if (!fin(order.x) || !fin(order.y)) return { ok: false, error: "Not on the map" };
    const H = herdAt(w, order.x, order.y, 40); if (!H || H.n <= 0) return { ok: false, error: "No game there" };
    if (SPECIES[H.sp].nohunt) return { ok: false, error: "No hunting that" };
    const hs = us.filter((u) => !ARMS[u.arm].engine); if (!hs.length) return { ok: false, error: "Engines don't hunt" };
    dropChains(w, hs.map((u) => u.id)); for (const u of hs) { u.helping = null; u.burning = null; u.broad = null; }
    const r = startHunt(w, hs, H), nm = SPECIES[H.sp].name;
    return { ok: true, n: 1, msg: r.parties ? `Hunting the ${nm}: ${r.men} men — they bring the kills home` : `${r.men} villagers to hunt the ${nm}` };
  }
  // (wildlife lane) the `capture` order: run down a live juvenile from the herd at (x, y) and pen it at the stables
  // (js/sim/jobs/hunting.js startCapture; docs/mounts-wildlife-spec.md)
  function captureOrder({ ids, order }) {
    const us = unitsOf(ids); if (!us.length) return { ok: false, error: "No one to order" };
    if (!fin(order.x) || !fin(order.y)) return { ok: false, error: "Not on the map" };
    const H = herdAt(w, order.x, order.y, 40); if (!H || H.n <= 0 || !SPECIES[H.sp].capture) return { ok: false, error: "Nothing there to capture" };
    if (!penOf(w, PLAYER)) return { ok: false, error: "A wild catch needs a pen: build stables first" };
    if (!(w.wild?.a || []).some((a) => a.h === H.id && a.young)) return { ok: false, error: "No young among them — wait for one" };
    const hs = us.filter((u) => !ARMS[u.arm].engine); if (!hs.length) return { ok: false, error: "Engines don't catch beasts" };
    dropChains(w, hs.map((u) => u.id)); for (const u of hs) { u.helping = null; u.burning = null; u.broad = null; }
    const r = startCapture(w, hs, H);
    return { ok: true, n: 1, msg: `Capture: ${r.men} men after a young ${SPECIES[H.sp].name} — run it down, then lead it to the stables` };
  }
  // a town's walls (js/sim/townwall.js): cs-tw-walk "Man the wall here" · cs-tw-top "Up the tower" (a watchtower, the gate
  // tower, the gatehouse roof) at the place (x, y) · cs-tw-all "Man the walls" (each company to the nearest free stretch)
  // · cs-tw-down "Come down". Foot only; our own walls only.
  function townWalls({ ids, kind, x, y, pace, facing }) {
    const us = endHunt(unitsOf(ids)).filter((u) => u.members.length && !u.isWorkers && !ARMS[u.arm]?.mounted && !ARMS[u.arm]?.engine);
    if (!us.length) return { ok: false, error: "No foot to go up there" };
    TW.ensureTownWalls(w);
    const n = menOf(us), P = PACES_OK.has(pace) ? pace : "quick";
    if (kind === "cs-tw-down") { dropChains(w, us.map((u) => u.id)); const k = TW.comeDown(w, us); return k ? { ok: true, msg: `Down off the walls: ${n} men` } : { ok: false, error: "They are not up on the walls" }; }
    if (kind === "cs-tw-all") { dropChains(w, us.map((u) => u.id)); const k = TW.manWalls(w, PLAYER, us, null, P); return k ? { ok: true, msg: `To the walls: ${k} ${k === 1 ? "company" : "companies"}, bows first` } : { ok: false, error: TW.capacity(w, PLAYER) ? "Every place on the walls near them is taken" : "Your walls have no walk standing" }; }
    if (!fin(x) || !fin(y)) return { ok: false, error: "Not on the map" };
    const Pl = TW.townPlace(w, x, y);
    if (!Pl || (Pl.kind !== "twalk" && Pl.kind !== "ttop")) return { ok: false, error: Pl?.kind === "tbreach" ? "The walk is down there: a breach" : "No wall-walk there" };
    if (Pl.team !== PLAYER) return { ok: false, error: "Not your wall" };
    const lvl = kind === "cs-tw-top" && Pl.kind === "ttop" ? 2 : 1;
    const o = { kind: "man_wall", x: Pl.x, y: Pl.y, lvl, pace: P, player: true };
    if (Number.isFinite(facing)) { o.facing = facing; o.faceSet = true; } // (a right-drag: which way they face up there; else outward)
    dropChains(w, us.map((u) => u.id));
    for (const u of us) issueOrder(w, [u.id], { ...o });
    return { ok: true, msg: `${lvl === 2 ? `Up the ${Pl.tname || "tower"}` : `Up onto ${Pl.tname || "the wall"}`}: ${n} men${lvl === 2 && n > Pl.cap ? ` (${Pl.cap} fit on top)` : ""}${Number.isFinite(facing) ? ", facing as dragged" : ""}` };
  }
  const ops = {
    // the order popup's choice (or a demo's): order = { kind, x, y, pace, formation, facing, frontage, ... }; side = the
    // siege side ("attack" / "defend") or null
    order({ ids, order, append = false, side = null }) {
      if (order?.kind === "hunt") return huntOrder({ ids, order });
      if (order?.kind === "capture") return captureOrder({ ids, order });
      if (order?.kind === "man_walls" || order?.kind === "come_down") return townWalls({ ids, kind: order.kind === "man_walls" ? "cs-tw-all" : "cs-tw-down", x: order.x, y: order.y, pace: order.pace }); // (the popup's "Man the walls" / "Come down")
      const us = endHunt(unitsOf(ids)); if (!us.length) return { ok: false, error: "No one to order" };
      if (!order || !fin(order.x) || !fin(order.y)) return { ok: false, error: "Not on the map" };
      order = { ...order, player: true }; delete order.target; delete order.bid; delete order.cap; append = !!(append || order.append); delete order.append; // (player: the owner's own order — a captain never undoes it, js/sim/captains.js)
      if (order.kind === "attack" || order.kind === "work") {
        const ctx = orderContext(w, us, { x: order.x, y: order.y }, side);
        if (order.kind === "attack") { const r = resolveAttack(order, us, ctx, append); if (r) return r; }
        if (order.kind === "work") { // THAT place (orders.workAt): the site, the camp's node, the store, the field, the node clicked
          const W = ctx.work;
          if (W?.kind === "camp" && !W.node) return { ok: false, error: `Nothing within reach for this ${EC.BUILDINGS[W.b.kind]?.name || "camp"} to work` };
          { const why = W?.node && us.some((u) => u.isWorkers) ? mineWhy(w, PLAYER, W.node) : null; if (why) return { ok: false, error: why[0].toUpperCase() + why.slice(1) }; } // (another house's vein: js/sim/veins.js)
          order.kind = W ? (W.kind === "site" ? "build" : "gather") : ctx.site ? "build" : "gather";
          if (W?.b && W.kind !== "camp") order.bid = W.b.id;
          if (W?.node) order.nid = W.node.id;
          if (W) order.workLabel = W.label;
        }
      }
      // villagers sent into one of our fields: if it lies idle (stubble or fallow) the plough goes in NOW for whatever crop
      // can still be sown (FL.sowFallow) — set before the men take the job, so they find work there; if nothing can go in
      // this season they are told so, and when, rather than wander home unexplained
      let fieldMsg = null;
      if (order.kind === "gather" && !append && us.some((u) => u.isWorkers)) {
        const fb = w.buildings.find((b) => b.team === PLAYER && b.field && !b.ruin && EC.inFieldRect(b, order.x, order.y)), ff = fb?.field;
        if (ff && (ff.state === "stubble" || ff.state === "fallow")) {
          const D = w.econ?.doy ?? 0, crop = FL.sowFallow(w, fb, D);
          if (crop) FL.tick(w, fb); // (the field takes the plough at once, so the men find ploughing there when they arrive)
          if (crop && ff.state === "growing" && ff.op === "plough" && ff.ripe > D + 30) fieldMsg = `Ploughing now for ${crop}: ${menOf(us)} men (the ground has had no rest: 80% of a full yield)`;
          else { /* (the season said no: the field keeps its own plough day) */ const when = ff.plAt !== undefined ? Math.max(0, Math.round(ff.plAt - D)) : null; fieldMsg = `Nothing can be sown this season — the plough goes into this field${when !== null ? ` in ${when} days` : " next season"}. Your men go back to their work meanwhile`; }
        }
      }
      const workLabel = order.workLabel; delete order.workLabel;
      const n = orderGroup(w, PLAYER, us, order, append, note); if (!n) return { ok: false, error: toasts.at(-1) || "Nothing to do there" };
      if (fieldMsg) return { ok: true, n, msg: fieldMsg };
      if (workLabel && !append) { const v = us.filter((u) => u.isWorkers), k = menOf(v); if (k && v.every((u) => u.job && u.job.kind !== "home")) return { ok: true, n, msg: `${workLabel}: ${k} villagers — they keep at it until it is done or you change it` }; }
      return { ok: true, n, msg: append ? `Step ${n} added to the chain` : toasts.at(-1) || `${ORDER_WORD[order.kind] || order.kind}: ${menOf(us)} men${Number.isFinite(order.facing) ? ", facing as dragged" : ""}` };
    },
    // (lane C) the `hunt` order: after the herd at (x, y) — soldiers as a hunting party, villagers as a hunting crew
    // (js/sim/jobs/hunting.js); ops.order sends it here
    // attack the enemy units `targets` (a group you clicked); how = { pace, formation }
    attack({ ids, targets, how = {} }) {
      const us = endHunt(unitsOf(ids)).filter((u) => !u.isWorkers);
      if (!us.length) return { ok: false, error: "Villagers won't attack soldiers" };
      const tg = (Array.isArray(targets) ? targets : []).map((id) => w.units.get(id)).filter((v) => v && v.team !== PLAYER && v.members.length);
      if (!tg.length) return { ok: false, error: "They are gone from sight" };
      dropChains(w, us.map((u) => u.id));
      for (const u of us) {
        const tgt = tg.reduce((b, v) => (!b || Math.hypot(v.ax - u.ax, v.ay - u.ay) < Math.hypot(b.ax - u.ax, b.ay - u.ay) ? v : b), null);
        u.helping = null; u.burning = null;
        if (ARMS[u.arm].missile) { if (u.fireMode === "hold") setFireMode(w, u, "will"); u.fireAt = tgt.id; u.fireStand = 0; u.atkForm = how?.formation || null; }
        else { u.fireAt = null; issueOrder(w, [u.id], { kind: "assault", player: true, x: tgt.ax, y: tgt.ay, target: tgt.id, pace: how?.pace || (ARMS[u.arm].mounted ? "charge" : "quick"), ...(how?.formation ? { formation: how.formation } : {}) }); }
      }
      followShooters(w, PLAYER);
      const names = [...new Set(tg.map((v) => v.arm))].map((a) => ARMS[a]?.name).filter(Boolean).join(" & ");
      return { ok: true, msg: `Attack the enemy ${names}!` };
    },
    // box-select: exactly these men become one command group. parts = [{ unit, ids: [soldier ids] }]; join = the units
    // already selected (Shift: join their group), or null; alt: keep the villagers caught in a box with soldiers.
    // → ids: the selection now (same-arm pieces merged back into one body)
    split({ parts, join = null, alt = false }) {
      let ps = (Array.isArray(parts) ? parts : []).map((p) => ({ u: w.units.get(p?.unit), ids: Array.isArray(p?.ids) ? p.ids : [] })).filter((p) => p.u && p.u.team === PLAYER);
      if (!alt && ps.some((p) => !p.u.isWorkers)) ps = ps.filter((p) => !p.u.isWorkers); // like any RTS: villagers caught in the box stay at their work
      const sel = new Set(unitsOf(join || []).map((u) => u.id));
      if (!ps.length) return { ok: false, error: "No one there", ids: [...sel] };
      const gid = sel.size && w.units.get([...sel][0])?.group != null ? w.units.get([...sel][0]).group : (w.nextGroup = (w.nextGroup || 0) + 1);
      for (const p of ps) {
        const ids = p.ids.filter((i) => Number.isInteger(i) && i >= 0 && i < w.S.n && w.S.unit[i] === p.u.id && w.S.alive[i]); if (!ids.length) continue;
        const nu = splitUnit(w, p.u, ids); nu.group = gid; sel.add(nu.id);
      }
      const byArm = new Map();
      for (const id of sel) { const u = w.units.get(id); if (!u) continue; if (!byArm.has(u.arm)) byArm.set(u.arm, []); byArm.get(u.arm).push(u); }
      for (const us of byArm.values()) if (us.length > 1) { const k = mergeUnits(w, us); for (const u of us) if (u !== k) sel.delete(u.id); }
      return { ok: true, ids: [...sel].filter((id) => w.units.get(id)) };
    },
    // "go anywhere in the castle" (js/ui/castle-orders.js): kind cs-tower | cs-walk | cs-gate | cs-keeproof | cs-hall |
    // cs-go | cs-ladder at the place (x, y) of castle `castle`, `part` = index into its parts (the part the click hit)
    castle({ ids, kind, x, y, castle, part, pace, facing }) {
      if (!fin(x) || !fin(y)) return { ok: false, error: "Not on the map" };
      if (typeof kind === "string" && kind.startsWith("cs-tw-")) return townWalls({ ids, kind, x, y, pace, facing }); // (a town's walls: js/sim/townwall.js)
      const C = (w.castles || []).find((c) => c.id === castle), hitPart = C && Number.isInteger(part) ? C.parts?.[part] : null;
      const P = CS.castlePlace(w, x, y, hitPart ? { part: hitPart, h: kind === "cs-hall" ? 0 : 1e3, top: kind !== "cs-hall" } : null);
      const foot = endHunt(unitsOf(ids)).filter((u) => u.members.length && !u.isWorkers && !ARMS[u.arm]?.mounted && !ARMS[u.arm]?.engine);
      if (!P || !foot.length) return { ok: false, error: "No one who can go up there" };
      const n = menOf(foot);
      if (kind === "cs-ladder") {
        if (P.h > 12) return { ok: false, error: "Too high for ladders: take the wall beside it and go in by the tower's door" };
        for (const u of foot) issueOrder(w, [u.id], { kind: "escalade", x: P.x, y: P.y, pace: pace && pace !== "march" ? pace : "quick" });
        return { ok: true, msg: `Long ladders to the tower: ${n} men` };
      }
      const lvl = kind === "cs-keeproof" ? CS.L_ROOF : kind === "cs-hall" ? CS.L_HALL : P.lvl;
      const o = { kind: "castle_move", x: P.x, y: P.y, lvl, castle: P.castle.id, pace: pace || "quick" };
      if (Number.isFinite(facing)) { o.facing = facing; o.faceSet = true; }
      dropChains(w, foot.map((u) => u.id));
      for (const u of foot) issueOrder(w, [u.id], { ...o });
      return { ok: true, msg: `${CASTLE_WORD[kind] || "Up"}: ${n} men${P.cap && lvl > 0 && n > P.cap && (kind === "cs-tower" || kind === "cs-gate") ? ` (${P.cap} fit on top)` : ""}` };
    },
    // FOUND A SETTLEMENT (js/sim/founding.js): check → the plan the land gives at (x, y) and whether it may be founded there
    // (the preview: nothing is paid); else the column of n settlers (20–40) sets out from the seat
    settle({ x, y, n = FD.RULES.defaultSettlers, check = false, name = null }) {
      if (!fin(x) || !fin(y)) return { ok: false, error: "Not on the map" };
      if (check) { const c = FD.siteCheck(w, PLAYER, x, y, { settlers: n }); return { ok: c.ok, why: c.why, warn: c.warn || [], cost: c.cost || null, settlers: c.settlers, plan: c.plan && !c.plan.error ? planOutline(c.plan) : null }; }
      const r = FD.orderFounding(w, PLAYER, x, y, { settlers: n, name: typeof name === "string" && name.trim() ? name.trim().slice(0, 24) : null });
      return r.ok ? { ok: true, msg: r.msg, town: r.D.id } : { ok: false, error: r.error };
    },
    // stake out a building where the land allows it (js/sim/siting.js: on a plot of the plan, or good ground near the click;
    // beside the resource a camp works); a wall on the suggested circuit's stretch, or along the line drawn (x2, y2)
    place({ kind, x, y, x2, y2 }) {
      if (!EC.BUILDINGS[kind]) return { ok: false, error: "No such building" };
      if (kind === "bridge") { // "Bridge here": sited by reading the river near the click, a crew sent (js/sim/bridges.js)
        if (!fin(x) || !fin(y)) return { ok: false, error: "Not on the map" };
        const r = BRG.orderBridge(w, PLAYER, x, y);
        return r.ok ? { ok: true, bid: r.b.id, msg: r.msg } : { ok: false, error: r.error };
      }
      if (!fin(x) || !fin(y)) return { ok: false, error: "Not on the map" };
      if ((kind === "stone_wall" || kind === "gatehouse") && !(typeof x2 !== "undefined" && fin(x2) && fin(y2))) { const old = DM.upgradeAt(w, PLAYER, kind, x, y); if (old) return ops.rebuild({ bid: old.id }); } // (stone over a standing palisade: rebuilt in its place, js/sim/demolish.js)
      const line = fin(x2) && fin(y2);
      const r = placeOnPlan(w, PLAYER, kind, x, y, line ? { x2, y2 } : {});
      if (r.error) return { ok: false, error: r.error };
      const b = r.b;
      if (!b.field) { const got = EC.assignWorkers(w, PLAYER, { kind: "build", b }, b.x1 !== undefined ? 20 : 12); return { ok: true, bid: b.id, msg: `${EC.BUILDINGS[b.kind].name} staked out — ${Array.isArray(got) ? got.length : typeof got === "number" ? got : got?.members?.length ?? 12} workers sent` }; }
      return { ok: true, bid: b.id, msg: `Open field laid out: ${b.field.crop}` };
    },
    // a field the player has drawn (js/ui/fielddraw.js): a rectangle the men clear and plough (js/sim/jobs/fields.js layField)
    field({ x, y, w: W, h: H, rot = 0 }) {
      if (![x, y, W, H].every(fin) || !Number.isFinite(rot)) return { ok: false, error: "Not on the map" };
      const r = FL.layField(w, PLAYER, { x, y, w: W, h: H, rot }, { by: "player" });
      if (r.error) return { ok: false, error: `No field there: ${r.error}` };
      const c = r.check, b = r.b;
      const crew = EC.assignWorkers(w, PLAYER, { kind: "field", b }, FL.clearCrew(w, b), ["man", "woman"]);
      if (crew) crew.ordered = true;   // (the player's own work: the reeve leaves this crew to it — ai-general.js free)
      const work = [c.trees ? `${c.trees} tree${c.trees > 1 ? "s" : ""} to fell` : "", c.bushes ? `${c.bushes} bush${c.bushes > 1 ? "es" : ""} to grub` : "", "the brush to cut"].filter(Boolean).join(", ");
      return { ok: true, bid: b.id, msg: `Field staked out: ${c.ha.toFixed(1)} ha — ${work}, then the plough breaks the sod` };
    },
    // "Pull it down" (js/sim/demolish.js): men take it down in stages, part of its materials come back; cancel: before they start
    demolish({ bid, cancel = false }) {
      const b = bld(w, bid); if (!b || b.team !== PLAYER) return { ok: false, error: "Not your building" };
      const name = EC.BUILDINGS[b.kind]?.name || b.kind;
      if (cancel) { const r = DM.cancelDemolish(w, PLAYER, b); return r.ok ? { ok: true, msg: `${name}: left standing` } : r; }
      const r = DM.orderDemolish(w, PLAYER, b, { by: "player" }); if (!r.ok) return r;
      const back = Object.entries(r.refund).concat(Object.entries(r.back)).filter(([, n]) => n >= 1).map(([k, n]) => `${Math.round(n).toLocaleString("en")} kg ${k}`).join(", ");
      return { ok: true, n: r.n, msg: `${b.ruin ? `Clearing the ruin of the ${name}` : b.progress < 1 ? `Giving up the ${name} site` : `Pulling down the ${name}`}: ${r.n ? `${r.n} men at it` : "the reeve sends men as hands come free"}${back ? ` — ${back} back to the store` : ""}` };
    },
    // "Rebuild in stone": a palisade stretch → a stone curtain, a palisade gate → a stone gatehouse, in its place (the palisade
    // stands till the stone does); all: the whole circuit, stretch by stretch; stop: the circuit's queue is dropped
    rebuild({ bid, all = false, stop = false }) {
      if (stop) { const r = DM.cancelCircuit(w, PLAYER); return r.ok ? { ok: true, msg: `The rest of the circuit stays timber (${r.n} stretches)` } : { ok: false, error: "No circuit is being rebuilt" }; }
      const b = bld(w, bid); if (!b || b.team !== PLAYER) return { ok: false, error: "Not your building" };
      if (all) { const r = DM.orderCircuit(w, PLAYER, b, { by: "player" }); return r.ok ? { ok: true, n: r.n, started: r.started, msg: `The circuit in stone: ${r.n} stretches, ${r.started} begun — the builders take the rest as the stone comes` } : r; }
      const r = DM.orderUpgrade(w, PLAYER, b, { by: "player" }); if (!r.ok) return r;
      return { ok: true, bid: r.b.id, msg: `${EC.BUILDINGS[r.b.kind].name} rising in the ${EC.BUILDINGS[b.kind].name}'s place: ${r.n} men (the timber stands till the stone does)` };
    },
    recruit({ bid, arm, n = 1, rushed = false, mount = null }) {
      const b = bld(w, bid); if (!b || b.team !== PLAYER) return { ok: false, error: "Not your building" };
      if (!EC.RECRUITS[arm] || !(EC.BUILDINGS[b.kind]?.recruits || []).includes(arm)) return { ok: false, error: "Not raised here" };
      if (mount && !MOUNT_ID[mount]) mount = null; // "horse" and unknown kinds both mean the arm's own horse
      const got = EC.queueRecruit(w, b, arm, Math.max(1, Math.min(50, n | 0)), { rushed: !!rushed, mount });
      return got ? { ok: true, msg: `Mustering ${got} ${ARMS[arm]?.name || arm}${mount ? ` on ${mount}s` : ""}` } : { ok: false, error: mount ? "Not enough trained mounts or men" : "Not enough men or gear" };
    },
    // a standing cavalry company changes what it rides, at the stables (docs/mounts-wildlife-spec.md)
    retrain({ bid, unit, mount = "horse" }) {
      const b = bld(w, bid); if (!b || b.team !== PLAYER) return { ok: false, error: "Not your building" };
      if (b.kind !== "stables") return { ok: false, error: "Mounts are changed at the stables" };
      const got = EC.queueRetrain(w, b, unit | 0, MOUNT_ID[mount] ? mount : null);
      return got ? { ok: true, msg: `Re-mounting ${got} riders on ${mount}s` } : { ok: false, error: "Not enough trained mounts, or the company cannot change now" };
    },
    // what a workshop makes: the player's choice is his (b.makeBy "player": the reeve never changes it); what = "auto" hands
    // it back to the reeve. → make: what it makes now, makeBy
    // buy (qty > 0) or sell (qty < 0) at the house's market (js/ui/market-ui.js tradeHere)
    trade({ good, qty }) { return tradeHere(w, PLAYER, good, Number(qty)); },
    product({ bid, what }) {
      const b = bld(w, bid); if (!b || b.team !== PLAYER) return { ok: false, error: "Not your building" };
      if (what === "auto") { if (!EC.RECIPES[b.kind]) return { ok: false, error: "Nothing is made here" }; EC.autoProduct(b); return { ok: true, make: b.make, makeBy: null, msg: `${EC.BUILDINGS[b.kind].name}: the reeve chooses what it makes` }; }
      if (!EC.RECIPES[b.kind]?.[what] || typeof EC.RECIPES[b.kind][what] !== "object") return { ok: false, error: "Not made here" };
      if (!TC.productOpen(w, PLAYER, b.kind, what)) return { ok: false, error: `Needs ${TC.TECHS[TC.PRODUCT_TECH[`${b.kind}.${what}`]].name} (research)` };
      EC.setProduct(w, b, what, "player"); return { ok: true, make: b.make, makeBy: b.makeBy };
    },
    // a workshop's (or the butts') crew: n men wanted (0..its places), or n = null: back to the reeve. The men move at once.
    crew({ bid, n = null }) {
      const b = bld(w, bid); if (!b || b.team !== PLAYER) return { ok: false, error: "Not your building" };
      if (!EC.workJob(b)) return { ok: false, error: "Nobody works there" };
      if (!EC.complete(b)) return { ok: false, error: "Not built yet" };
      const r = EC.setCrew(w, b, n === null ? null : Number(n) || 0);
      if (!r.ok) return r;
      const name = EC.BUILDINGS[b.kind].name;
      return { ok: true, n: r.n, want: r.want, msg: r.want === null ? `${name}: the reeve sets the crew` : r.n < r.want ? `${name}: ${r.n} of ${r.want} men — no more free hands at home just now; the reeve sends the rest as they come free` : `${name}: ${r.n} ${r.n === 1 ? "man" : "men"} at work` };
    },
    // "Work here": these villagers go to work at the workshop (or the butts): they become its crew, the crew size the
    // player's (b.crew = the men there now, up to its places)
    staff({ bid, ids }) {
      const b = bld(w, bid); if (!b || b.team !== PLAYER) return { ok: false, error: "Not your building" };
      const job = EC.workJob(b); if (!job) return { ok: false, error: "Nobody works there" };
      if (!EC.complete(b)) return { ok: false, error: "Not built yet" };
      const us = unitsOf(ids).filter((u) => u.isWorkers && u.members.length && !u.convoy);
      if (!us.length) return { ok: false, error: "Select villagers first" };
      dropChains(w, us.map((u) => u.id)); for (const u of us) { u.hunt = null; u.broad = null; u.ordered = false; u.away = false; }
      const max = EC.crewMax(b), men = us.reduce((s, u) => s + u.members.length, 0), take = Math.min(max, men);
      // the men chosen take the places: whoever else works there makes room (back to the reeve)
      let over = EC.crewUnits(w, b).filter((u) => !us.includes(u)).reduce((s, u) => s + u.members.length, 0) - (max - take);
      for (const u of EC.crewUnits(w, b).filter((v) => !us.includes(v))) { if (over <= 0) break; const k = Math.min(over, u.members.length); EC.releaseWorkers(w, u, k); over -= k; }
      const crew = EC.assignWorkers(w, PLAYER, job, take, EC.crewPrefer(b), us);
      if (crew) { crew.ordered = false; crew.broad = null; crew.away = false; }
      const n = EC.crewOf(w, b).n; b.crew = n;
      return { ok: true, n, want: n, msg: `${n} at work in the ${EC.BUILDINGS[b.kind].name}${men > take ? ` (it has ${max} places: the other ${men - take} go back to the reeve's work)` : ""}` };
    },
    // research at the keep (js/sim/tech.js; docs/tech.md): start a study now — a desk must be free and the store able to
    // pay, else it is refused (there is no queue); cancel: true abandons the study (its cost comes back)
    research({ id, cancel = false }) {
      if (!TC.TECHS[id]) return { ok: false, error: "No such study" };
      const name = TC.TECHS[id].name;
      if (cancel) return TC.cancel(w, PLAYER, id) ? { ok: true, msg: `${name}: set aside` } : { ok: false, error: "Not being studied" };
      const r = TC.order(w, PLAYER, id);
      if (!r.ok) return r;
      if (r.started) { const e = w.events.at(-1); if (e?.kind === "research-start") { w.log.push(e); w.events.pop(); } }
      return { ok: true, msg: `The clerk sends for masters: ${name}` };
    },
    // a working of the adepts at (x, y). The spell's event is handed to w.log at once (between ticks the next step would
    // wipe w.events before the chronicle saw it)
    // siege engines take a target, not a menu: a stone-thrower shoots at what was clicked (men, a wall, a gate, a building,
    // the ground); a packed trebuchet is framed up on the spot; a ram batters and a tower goes against the wall or gate
    // clicked (or is pushed to open ground); a mantlet is pushed there
    target({ ids, x, y, enemy = false }) {
      if (!fin(x) || !fin(y)) return { ok: false, error: "Not on the map" };
      const us = unitsOf(ids).filter((u) => ARMS[u.arm].engine); if (!us.length) return { ok: false, error: "No engines selected" };
      const wallNear = (w.buildings || []).some((b) => b.team !== PLAYER && !b.ruin && (b.mods || /gate|wall|palisade/.test(b.kind)) && (b.x1 !== undefined ? Math.hypot((b.x1 + b.x2) / 2 - x, (b.y1 + b.y2) / 2 - y) < Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 2 + 25 : Math.hypot(b.x - x, b.y - y) < 30));
      const said = new Set();
      for (const u of us) {
        const e = engineOf(w, u), k = u.arm; let o;
        if (e?.state === "packed" && k === "trebuchet") { o = { kind: "assemble", x, y }; said.add("The trebuchet goes to be framed up there"); }
        else if (k === "trebuchet" || k === "mangonel" || k === "springald") { o = { kind: "bombard", x, y }; said.add(enemy ? "The engines shoot at them" : "The engines take that as their mark"); }
        else if (k === "ram") { o = { kind: wallNear ? "batter" : "move", x, y }; said.add(wallNear ? "The ram goes against it" : "The ram is pushed there"); }
        else if (k === "siege_tower") { o = { kind: wallNear ? "advance" : "move", x, y }; said.add(wallNear ? "The tower is pushed against the wall" : "The tower is pushed there"); }
        else { o = { kind: "move", x, y }; said.add("Pushed there"); }
        dropChains(w, [u.id]); issueOrder(w, [u.id], { ...o, pace: "march" });
      }
      return { ok: true, msg: [...said].join(" · ") };
    },
    spell({ kind, x, y }) {
      if (!fin(x) || !fin(y)) return { ok: false, error: "Not on the map" };
      if (!EC.castSpell(w, PLAYER, kind, x, y)) return { ok: false, error: "The working fails" };
      const e = w.events.at(-1); if (e?.kind === "spell") { w.log.push(e); w.events.pop(); }
      return { ok: true };
    },
    // "Form up!": re-form the ranks where they stand
    formup({ ids }) {
      const us = endHunt(unitsOf(ids)).filter((u) => u.members.length && !u.isWorkers); dropChains(w, us.map((u) => u.id));
      for (const u of us) { u.helping = null; u.burning = null; issueOrder(w, [u.id], { kind: "hold", player: true, x: u.ax, y: u.ay, facing: u.finalFacing ?? u.order?.facing ?? 0, formation: u.formation }); }
      return { ok: us.length > 0, n: us.length, error: us.length ? undefined : "Select a group first" };
    },
    drop({ ids }) { dropChains(w, endHunt(unitsOf(ids)).map((u) => u.id)); return { ok: true }; },
    // the learning reeve (js/sim/reeve-learn.js; the keep's panel): do = learned (what he has learned, in plain words) | on |
    // off (copy the player or not) | reset (forget everything). Only this house's own book.
    reeve({ do: what = "learned" }) {
      const T = w.teams[PLAYER]; if (!T?.store) return { ok: false, error: "No house" };
      if (what === "on" || what === "off") RL.setOn(T, what === "on");
      else if (what === "reset") RL.reset(T);
      else if (what !== "learned") return { ok: false, error: "No such reeve order" };
      return { ok: true, learned: RL.summary(w, PLAYER), msg: what === "on" ? "Your reeve copies how you run the vill again" : what === "off" ? "Your reeve goes back to his own ways (he keeps what he has seen)" : what === "reset" ? "Your reeve forgets everything he has watched" : undefined };
    },
    // a broad task with no spot picked (js/sim/broad.js): kind = wood | stone | ore | forage | hunt | fish | farm | build |
    // haul | patrol | home. The men find the nearest work themselves and move on when it runs out; any other order ends it.
    task({ ids, kind }) {
      if (!TASK_IDS.has(kind)) return { ok: false, error: "No such task" };
      const us = unitsOf(ids); if (!us.length) return { ok: false, error: "No one to order" };
      dropChains(w, us.map((u) => u.id)); for (const u of us) { if (u.hunt) u.hunt = null; } DG.endDragonOrders(w, us);
      return setTask(w, us, kind);
    },
    // what the task menu offers these units (the realm client asks the server: its mirror holds no herds or fields)
    tasks({ ids }) { return { ok: true, tasks: taskOptions(w, unitsOf(ids)) }; },
    // a captain's proposal card (js/sim/captains.js): "Do it now" (yes) or "No"
    captain({ pid, yes }) { return Number.isInteger(pid) ? captainDecide(w, PLAYER, pid, !!yes) : { ok: false, error: "No such proposal" }; },
    // captains' initiative "on" | "ask" | "off" for these companies (mode null: back to the army's default), or all: the army's default
    initiative({ ids, mode, all = false }) { return setInitiative(w, PLAYER, all ? null : unitsOf(ids).map((u) => u.id), mode ?? null); },
    // the dragons (js/sim/dragons.js): do = attack (these companies go against it) | claim (a yielded dragon, broken by
    // this house, with men standing over it) | summon | move | breathe | recall (the house's bonded dragon)
    dragon({ do: what, id, ids, x, y }) {
      if (!Number.isInteger(id)) { const D = what === "attack" || what === "claim" ? null : DG.dragonOfHouse(w, PLAYER); if (!D) return { ok: false, error: "No such dragon" }; id = D.id; }
      if (what === "attack") {
        const us = unitsOf(ids); if (!us.length) return { ok: false, error: "No one to order" };
        dropChains(w, us.map((u) => u.id)); for (const u of us) { u.helping = null; u.burning = null; if (u.hunt) u.hunt = null; u.broad = null; }
        return DG.orderAttackDragon(w, PLAYER, us, id);
      }
      if (what === "claim") return DG.claimDragon(w, PLAYER, id);
      if (what === "summon") return DG.summonDragon(w, PLAYER, id, x, y);
      if (what === "move") return DG.dragonMove(w, PLAYER, id, x, y);
      if (what === "breathe") return DG.dragonBreathe(w, PLAYER, id, x, y);
      if (what === "recall") return DG.recallDragon(w, PLAYER, id);
      return { ok: false, error: "No such dragon order" };
    },
  };
  // the town a command acts in (js/sim/towns.js): a building staked out where the player clicked belongs to the town whose
  // ground it is; a recruit, a product, a remount to the building's town; a broad task to its villagers' town.
  // undefined: no frame (a house with no daughter towns, or a command that is not a town's)
  function townCtx(op, a) {
    if (!TWN.hasDaughters(w.teams[PLAYER])) return undefined;
    if ((op === "place" || op === "field") && fin(a.x) && fin(a.y)) return TWN.townAt(w, PLAYER, a.x, a.y); // (a field drawn by a daughter town is its own)
    if ((op === "recruit" || op === "retrain" || op === "product" || op === "crew" || op === "staff" || op === "demolish" || op === "rebuild") && Number.isInteger(a.bid)) { const b = bld(w, a.bid); return b && b.team === PLAYER ? TWN.townOfBuilding(w, b) : undefined; }
    if (op === "task" && Array.isArray(a.ids) && a.ids.length) { const us = a.ids.map((id) => w.units.get(id)).filter((u) => u && u.team === PLAYER); const t = us.map((u) => u.town || null); if (us.length && t.every((q) => q === t[0])) return TWN.townOfUnit(w, us[0]); }
    return undefined;
  }
  function apply(op, args = {}) {
    const f = Object.hasOwn(ops, op) ? ops[op] : null; if (!f) return { ok: false, error: `unknown op ${op}` };
    toasts.length = 0;
    const a = args && typeof args === "object" ? args : {};
    try {
      const pre = RL.before(w, PLAYER, op, a); // (the learning reeve: what he had them doing — js/sim/reeve-learn.js)
      const D = townCtx(op, a), r = D === undefined ? f(a) : TWN.within(w, PLAYER, D, () => f(a));
      if (pre && r?.ok) RL.record(w, PLAYER, op, a, r, pre); // every economic choice of the player's goes in the reeve's book, with the situation it was made in
      return r;
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  }
  return { apply, ops, team, chainPoints: (ids) => chainPoints(w, ids), chainOf: (ids) => chainOf(w, ids), dropChains: (ids) => dropChains(w, ids) };
}
const CASTLE_WORD = { "cs-tower": "To the tower top", "cs-walk": "Up onto the wall", "cs-gate": "Into the gatehouse", "cs-keeproof": "To the keep roof", "cs-hall": "Into the hall", "cs-go": "Into the bailey" };

// ================================================================ per-tick systems (world-wide: push them once)
// measured: assets/footprints.json (a building's solid box by its model)
export function commandSystems(w, { measured = {} } = {}) {
  setFootprints(measured);
  return [
    function solidBuildings(w) { // new buildings become physical the moment they're staked out
      if (w.tick % 20) return;
      const solid = (w.solidB ||= new Set()); // (on the world, not in a closure: a saved and restored world must not stake them twice)
      for (const b of w.buildings) {
        if (solid.has(b.id) || b.field) continue; solid.add(b.id);
        if (b.x1 !== undefined || b.kind === "gate" || b.kind === "gatehouse" || b.kind === "archery_range") continue; // (the butts are open ground: the men stand and shoot on it) // walls and gates are barriers with breaches and a passage (siege.js), not solid boxes
        const m = measured[b.kind === "house" ? ["house_a", "house_b", "house_c"][b.id % 3] : b.kind];
        loadObjects(w.obstacles, { objects: [{ asset: b.kind, x: b.x, y: b.y, rot: b.rot || 0 }] }, m ? { [b.kind]: m } : {});
      }
      if (w.obstacles.fresh?.length) { markObstaclesOnNav(w.nav, w.obstacles.fresh); w.obstacles.fresh.length = 0; }
    },
    function helpBuild(w) { // soldiers helping on a building site add their labour (less skilled than the crew)
      if (w.tick % 10) return;
      for (const u of w.units.values()) {
        if (!u.helping) continue;
        const b = bld(w, u.helping);
        if (!b || b.ruin || b.progress >= 1) { u.helping = null; continue; }
        if (Math.hypot(u.ax - b.x, u.ay - b.y) > 40 + (b.x1 !== undefined ? Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 2 : 0)) continue;
        const T = w.teams[u.team], men = u.members.length;
        b.progress = Math.min(1, b.progress + men * 0.6 * EC.DT * 10 * (T.eff || 0.7) * (EC.E.buildSpeed || 1) / (b.labour || 100));
        b.hp = (b.hpMax || 100) * (0.05 + 0.95 * b.progress);
        for (const id of u.members) w.S.state[id] = 6; // S_WORK: they're digging and hauling
        if (b.progress >= 1) { w.events.push({ t: w.tick, kind: "built", building: b.id, team: b.team, what: b.kind }); u.helping = null; }
      }
    },
    function burnBuilding(w) { // soldiers with torches at an enemy building: thatch and timber catch, stone must be pulled down
      if (w.tick % 10) return;
      for (const u of w.units.values()) {
        if (!u.burning) continue;
        const b = bld(w, u.burning);
        if (!b || b.ruin) { u.burning = null; continue; }
        const reach = 14 + (b.x1 !== undefined ? Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 2 : Math.max(...(EC.BUILDINGS[b.kind].footprint || [10])) / 2);
        if (Math.hypot(u.ax - b.x, u.ay - b.y) > reach || u.state === "routing") {
          // still on their way: if they stopped (a skirmish, a blocked path) and no enemy is at hand, press on
          if (!u.path && !u.hold && u.state !== "routing" && w.tick % 50 === 0) issueOrder(w, [u.id], { kind: "move", x: b.x, y: b.y, pace: "quick" });
          continue;
        }
        const def = EC.BUILDINGS[b.kind], men = u.members.length;
        if (def.flammable) { if (w.rng.chance(Math.min(0.9, 0.05 * men))) EC.damageBuilding(w, b, 0, 0.35); }
        else EC.damageBuilding(w, b, men * 0.4, 0); // hacking at masonry: slow
        for (const id of u.members) w.S.state[id] = 6;
      }
    },
    function fortify(w) { // Fortify: once there, archers plant a stake line before them; foot dig a ditch
      if (w.tick % 10) return;
      for (const u of w.units.values()) {
        if (u.order?.kind !== "fortify" || u.path || u.fortified === u.orderT || u.isWorkers) continue;
        const A = ARMS[u.arm]; if (A.mounted) { u.fortified = u.orderT; continue; }
        fieldWork(w, u, A.missile ? "archer_stakes" : "ditch", A.missile ? 3 : 4); u.fortified = u.orderT;
      }
    },
    function shooters(w) { if (w.tick % 20 === 0) followShooters(w); },
    broadSystem, // broad tasks: re-target, patrol, soldiers cutting and carrying (js/sim/broad.js)
  ];
}

// a plan as the founding preview draws it (js/ui/towns-ui.js): rounded, no ids
const r1 = (v) => Math.round(v * 10) / 10, P = (p) => [r1(p[0]), r1(p[1])];
export function planOutline(t) {
  return { form: t.form, why: t.why || [], hall: { x: r1(t.hall.x), y: r1(t.hall.y), rot: t.hall.rot, curia: t.hall.curia.map(P) },
    lanes: (t.lanes || []).map((L) => ({ w: L.width, k: L.kind, pts: L.pts.map(P) })), tofts: (t.plots || []).map((p) => p.toft.map(P)), crofts: (t.plots || []).filter((p) => p.croft).map((p) => p.croft.map(P)),
    houses: (t.plots || []).map((p) => [r1(p.house.x), r1(p.house.y), Math.round(p.house.rot * 100) / 100]), green: t.green ? t.green.poly.map(P) : null,
    church: t.church ? { x: r1(t.church.x), y: r1(t.church.y), rot: t.church.rot, yard: t.church.churchyard.map(P) } : null, mill: t.mill ? { x: r1(t.mill.x), y: r1(t.mill.y), rot: t.mill.rot } : null,
    wall: t.enceinte ? t.enceinte.poly.map(P) : null, gates: t.enceinte ? t.enceinte.gates.map((g) => P(g.xy)) : [], yards: (t.yards || []).map((y) => [r1(y.x), r1(y.y), y.rot, y.w, y.h]) };
}
