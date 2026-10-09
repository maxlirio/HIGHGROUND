// BROAD TASKS — "go and get wood", "go hunting", "patrol the town": a job given with no spot picked. The men find the
// nearest sensible work themselves and move on to the next when it runs out (the owner: "a broad command, rather than a
// do it here command"). The player gives them by right-clicking one of his companies (js/ui/task-menu.js); the command
// is the `task` op (js/game/commands.js → here), so realm players have them too.
//
//   VILLAGER CREWS  wood · stone · ore · forage · hunt · fish · farm · build · haul · prospect · home ("back to the reeve")
//     prospect: the likeliest ground within reach (or the spot clicked: "Prospect here"), searched for days until a vein
//     is found (then they hoist the flag and mine it) or the ground is searched out (then the next ground) — js/sim/prospect.js
//     The crew gets an ordinary economy job (economy.js: gather / field / build / store) on the nearest node, field or
//     site, and keeps u.broad. The reeve leaves a crew with a task alone (ai-general.js `free`); when the job ends
//     (node felled out, building finished, field done) economy.releaseWorkers asks BROAD.retarget first, which puts the
//     crew on the next nearest one — or, when there is none within reach, sends them back to the reeve and says why.
//   SOLDIER COMPANIES  hunt · wood · stone · patrol · home ("back to the keep")
//     hunt: the nearest herd of game (js/sim/jobs/hunting.js startHunt), the next one when the kills are home.
//     wood / stone: they lend their backs, as on a building site (commands.js helpBuild): cut at the node at 0.6 of a
//     villager's rate, carry it home themselves (a carrier's time-compressed lot each, labor.lotFor) and set it down in
//     the nearest store, then go back for more. patrol: round the town on a ring of waypoints, for as long as you like.
//   Any other order ends the task (commands.js clears u.broad; an order from a captain or the lord does too: the
//   company's order is no longer the task's own).
// Plain data on the unit (u.broad = { kind, tag, t, … }, node and building ids, never refs): saved with the world.
// Deterministic (no dice; iteration in w.units order), DOM-free.
import { ARMS } from "./arms.js";
import { issueOrder } from "./world.js";
import { SPECIES, nodeOfHerd } from "./wild.js";
import * as EC from "./economy.js";
import { phase as fieldPhase } from "./jobs/fields.js";
import { startHunt } from "./jobs/hunting.js";
import { nearestStore } from "./labor.js";
import { isVein, mineWhy } from "./veins.js"; // (a vein another house holds is theirs: js/sim/veins.js)
import * as PR from "./prospect.js"; // (prospecting the hills for a new vein: js/sim/prospect.js)

// what each node task works, and how far the men will go for it (the reeve's own reach: ai-general allocateLabour)
export const NODE_TASK = {
  wood:   { kinds: ["wood"], res: "timber", carts: 2, reach: 2500, what: "woodland" },
  stone:  { kinds: ["quarry"], res: "stone", carts: 2, reach: 2500, what: "quarry face" },
  ore:    { kinds: ["bog_iron"], res: "ore", reach: 2500, what: "bog-iron bed" },
  silver: { kinds: ["silver_vein"], res: "silver", reach: 3500, what: "silver vein" },
  gold:   { kinds: ["gold_vein"], res: "gold", reach: 3500, what: "gold vein" },
  forage: { kinds: ["forage"], res: "fresh", reach: 1800, what: "forage" },
  fish:   { kinds: ["fishery"], res: "fresh", reach: 1800, what: "fishing water" },
};
export const HUNT_REACH = 1800;
export const PATROL = { r: 190, n: 6, legS: 120 }; // m round the town, waypoints, s before a leg is given up
export const SOLDIER_RATE = 0.6;                   // a soldier's cut against a villager's (helpBuild's 0.6)
export const CUT_S = [60, 240];                    // s at the axes before they carry it home (the walk there and back, within these)
// the menu: id, the button, what it does; who = workers | soldiers | both
export const TASKS = [
  { id: "wood", name: "Gather wood", hint: "fell timber at the nearest woodland", who: "both" },
  { id: "stone", name: "Quarry stone", hint: "cut stone at the nearest quarry", who: "both" },
  { id: "ore", name: "Mine ore", hint: "dig the nearest bog-iron", who: "workers" },
  { id: "silver", name: "Mine silver", hint: "dig the nearest silver vein your house holds (coin for the wages; another house's vein is theirs until you take it)", who: "workers" },
  { id: "gold", name: "Mine gold", hint: "dig the nearest gold vein your house holds", who: "workers" },
  { id: "forage", name: "Forage", hint: "berries and nuts from the nearest thicket", who: "workers" },
  { id: "hunt", name: "Hunt", hint: "the nearest herd of game", who: "both" },
  { id: "fish", name: "Fish", hint: "the nearest fishing water", who: "workers" },
  { id: "prospect", name: "Prospect", hint: "search the hills and crags for a new silver or gold vein — for days; rocky ground and old workings pay best", who: "workers" },
  { id: "farm", name: "Farm", hint: "the fields that need hands", who: "workers" },
  { id: "build", name: "Build", hint: "help the nearest building site", who: "workers" },
  { id: "haul", name: "Haul", hint: "carry loads in at the nearest store", who: "workers" },
  { id: "patrol", name: "Patrol the town", hint: "march round the town until told otherwise", who: "soldiers" },
  { id: "home", name: "Back to the reeve", soldierName: "Back to the keep", hint: "their usual work", soldierHint: "march home and stand at the keep", who: "both" },
];
export const TASK_IDS = new Set(TASKS.map((t) => t.id));
export const TASK_WORD = { wood: "Gathering wood", stone: "Quarrying stone", ore: "Mining ore", silver: "Mining silver", gold: "Mining gold", forage: "Foraging", hunt: "Hunting", fish: "Fishing", prospect: "Prospecting", farm: "Farming", build: "Building", haul: "Hauling", patrol: "Patrolling" };

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const isSoldier = (u) => !u.isWorkers && !ARMS[u.arm]?.engine && (u.gate === undefined || u.gate === null); // (a gate's guards keep their post: js/sim/gateguards.js)
const posOf = (b) => (b.x !== undefined ? [b.x, b.y] : [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2]);

// ---------------------------------------------------------------- finding the work
export function nearestNode(w, kind, x, y, team = null) { // (team: only what that house may work — not another house's vein)
  const T = NODE_TASK[kind]; if (!T) return null;
  let best = null, bd = T.reach;
  for (const n of w.resources || []) { if (!T.kinds.includes(n.kind) || !(n.amount > 1) || (team !== null && isVein(n) && mineWhy(w, team, n))) continue; const d = dist(n.x, n.y, x, y); if (d < bd || (d === bd && best && n.id < best.id)) { bd = d; best = n; } }
  return best;
}
// game, not quarry: no wolves, bears or drakes in their dens, no beasts kept for the stables (capture is a deliberate
// click), not the white hart, never the lake serpent. needNode: villagers hunt a hunting ground (a herd with a node).
export function nearestHerd(w, x, y, needNode = false, reach = HUNT_REACH) {
  let best = null, bd = reach;
  for (const H of w.wild?.herds || []) {
    const S = SPECIES[H.sp]; if (!S || !(H.n > 0) || S.nohunt || S.capture || S.rare || S.nonode || S.kindof === "pack" || S.kindof === "solitary" || S.kindof === "basker") continue;
    if (needNode) { const nd = nodeOfHerd(w, H); if (!nd || !(nd.amount > 1)) continue; }
    const d = dist(H.cx, H.cy, x, y); if (d < bd) { bd = d; best = H; }
  }
  return best;
}
// a villager crew's hunting ground: the nearest "hunt" node with game on it (a herd's ground, js/sim/wild.js — not one
// kept for the stables — or, on a world without the wild herds, the node itself)
export function huntingGround(w, x, y, reach = HUNT_REACH) {
  let best = null, bd = reach;
  for (const n of w.resources || []) {
    if (n.kind !== "hunt" || !(n.amount > 1)) continue;
    if (n.herd !== undefined) { const H = w.wild?.herds.find((h) => h.id === n.herd), S = H && SPECIES[H.sp]; if (!H || !(H.n > 0) || !S || S.nohunt || S.capture || S.rare) continue; }
    const d = dist(n.x, n.y, x, y); if (d < bd) { bd = d; best = n; }
  }
  return best;
}
const FIELD_PRI = { reap: 0, cart: 1, clear: 2, plough: 2, sow: 2, weed: 3 }; // (clear: a new field's ground — js/sim/jobs/fields.js)
export function bestField(w, team, x, y) {
  let best = null, bk = Infinity;
  for (const b of w.buildings) {
    if (b.team !== team || !b.field || b.ruin) continue;
    const ph = fieldPhase(w, b), p = FIELD_PRI[ph]; if (p === undefined) continue;
    if (ph === "weed" && !(b.field.care < 0.95)) continue;
    const k = p * 1e6 + dist(b.x, b.y, x, y); if (k < bk) { bk = k; best = b; }
  }
  return best;
}
export function nearestSite(w, team, x, y) {
  let best = null, bd = Infinity;
  for (const b of w.buildings) {
    if (b.team !== team || b.ruin || b.field) continue;
    if (!(b.progress < 1) && !(b.hp < (b.hpMax || b.hp) * 0.99 && !(b.fire > 0))) continue;
    const [bx, by] = posOf(b), d = dist(bx, by, x, y); if (d < bd) { bd = d; best = b; }
  }
  return best;
}
export function nearestStoreB(w, team, x, y) {
  let best = null, bd = Infinity;
  for (const b of w.buildings) { if (b.team !== team || !EC.complete(b) || !EC.BUILDINGS[b.kind]?.stores) continue; const d = dist(b.x, b.y, x, y); if (d < bd) { bd = d; best = b; } }
  return best;
}
const hallOf = (w, team) => w.buildings.find((b) => b.id === w.teams[team]?.hall && !b.ruin) || null;

// the job a villager crew at (x, y) would take for task `kind` → { job } | { why }. spot: prospecting there ("Prospect here")
export function crewJob(w, team, kind, x, y, spot = null) {
  if (kind === "prospect") {
    const cap = PR.capWhy(w, team); if (cap) return { why: cap };
    if (spot) { const g = PR.geology(w, spot.x, spot.y); return g < PR.PROSPECT.minGeo ? { why: `${PR.groundWord(g)} — try the hills and crags` } : { job: PR.jobAt(w, spot.x, spot.y), at: { x: spot.x, y: spot.y, what: PR.groundWord(g) } }; }
    const g = PR.groundFor(w, team, x, y); return g ? { job: PR.jobAt(w, g.x, g.y), at: g } : { why: "no likely ground within reach: no hills, crags or rock showing" };
  }
  if (NODE_TASK[kind]) {
    const T = NODE_TASK[kind], n = nearestNode(w, kind, x, y, team);
    if (n) return { job: { kind: "gather", node: n, res: T.res, ...(T.carts ? { carts: T.carts } : {}) }, at: n };
    const theirs = nearestNode(w, kind, x, y); // (one within reach, but held by another house: say so)
    return { why: theirs ? `the nearest ${T.what} is held by another house — take it (kill the men who work it, then hoist your flag there) or work your own` : `no ${T.what} within reach` };
  }
  if (kind === "hunt") { const n = huntingGround(w, x, y); return n ? { job: { kind: "gather", node: n, res: "fresh" }, at: n, herd: n.herd !== undefined ? w.wild?.herds.find((h) => h.id === n.herd) : null } : { why: "no hunting grounds within reach" }; }
  if (kind === "farm") { const b = bestField(w, team, x, y); return b ? { job: { kind: "field", b }, at: b } : { why: w.buildings.some((q) => q.team === team && q.field && !q.ruin) ? "no field needs hands now" : "you have no fields" }; }
  if (kind === "build") { const b = nearestSite(w, team, x, y); return b ? { job: { kind: "build", b }, at: b } : { why: "no building site or repair to work on" }; }
  if (kind === "haul") { const b = nearestStoreB(w, team, x, y); return b ? { job: { kind: "store", b }, at: b } : { why: "no store standing" }; }
  return { why: "not work for villagers" };
}
// what a soldier company at (x, y) would go for → { at, herd? } | { why }
export function soldierTarget(w, u, kind) {
  const x = u.ax, y = u.ay;
  if (kind === "hunt") { const H = nearestHerd(w, x, y, false); return H ? { herd: H, at: { x: H.cx, y: H.cy } } : { why: "no hunting grounds within reach" }; }
  if (kind === "wood" || kind === "stone") {
    if (ARMS[u.arm]?.mounted) return { why: "horsemen won't fell timber or cut stone" };
    const n = nearestNode(w, kind, x, y); return n ? { at: n } : { why: `no ${NODE_TASK[kind].what} within reach` };
  }
  if (kind === "patrol") return w.teams[u.team]?.town ? { at: w.teams[u.team].town } : { why: "no town to patrol" };
  if (kind === "home") { const h = hallOf(w, u.team); return h ? { at: h } : { why: "the keep is gone" }; }
  return { why: "not work for soldiers" };
}

// ---------------------------------------------------------------- the menu: what fits these units, and what is there
// → [{ id, name, hint, ok, why, who }] in TASKS order (only the tasks some unit here could ever do)
export function taskOptions(w, units) {
  const us = units.filter((u) => u && u.members?.length), team = us[0]?.team;
  const crews = us.filter((u) => u.isWorkers), sold = us.filter(isSoldier);
  if (!crews.length && !sold.length) return [];
  const c = (list) => { let x = 0, y = 0, n = 0; for (const u of list) { x += u.ax * u.members.length; y += u.ay * u.members.length; n += u.members.length; } return n ? [x / n, y / n] : [0, 0]; };
  const [cx, cy] = c(crews);
  const out = [];
  for (const t of TASKS) {
    const forC = crews.length && t.who !== "soldiers", forS = sold.length && t.who !== "workers";
    if (!forC && !forS) continue;
    const soldierOnly = !forC;
    const name = soldierOnly && t.soldierName ? t.soldierName : t.name;
    let ok = false, why = "", hint = soldierOnly && t.soldierHint ? t.soldierHint : t.hint;
    if (t.id === "home") ok = true;
    else {
      if (forC) { const r = crewJob(w, team, t.id, cx, cy); if (r.job) { ok = true; hint = describe(w, t.id, r, cx, cy); } else why = r.why; }
      if (forS && !ok) { for (const u of sold) { const r = soldierTarget(w, u, t.id); if (!r.why) { ok = true; hint = describe(w, t.id, r, u.ax, u.ay); break; } why = r.why; } }
    }
    out.push({ id: t.id, name, hint, ok, why: ok ? "" : why, who: t.who });
  }
  return out;
}
function describe(w, kind, r, x, y) {
  const at = r.at, d = at ? Math.round(dist(at.x ?? posOf(at)[0], at.y ?? posOf(at)[1], x, y) / 10) * 10 : 0;
  if (kind === "hunt") return r.herd ? `${SPECIES[r.herd.sp].name} ×${r.herd.n}, ${d} m off` : `the nearest hunting ground, ${d} m off`;
  if (kind === "farm") { const ph = fieldPhase(w, at); return `${{ reap: "reap the ripe corn", cart: "cart the stooks in", clear: "clear the new field", plough: "plough", sow: "sow", weed: "weed" }[ph] || "work"} · ${d} m`; }
  if (kind === "build") return `the ${(EC.BUILDINGS[at.kind]?.name || at.kind).toLowerCase()}${at.progress < 1 ? "" : " (repairs)"} · ${d} m`;
  if (kind === "haul") return `at the ${(EC.BUILDINGS[at.kind]?.name || at.kind).toLowerCase()}`;
  if (kind === "patrol") return `round the town, ${PATROL.r} m out`;
  if (NODE_TASK[kind]) return `the nearest ${NODE_TASK[kind].what}, ${d} m off`;
  if (kind === "prospect") return `${at.what}, ${d} m off — days of searching`;
  return "";
}

// ---------------------------------------------------------------- giving the task
const nextTag = (w) => (w.broadTag = (w.broadTag || 0) + 1);
function setCrewJob(u, job) { u.job = job; u.haul = new Map(); u.danger = 0; u.away = false; u.awayUntil = 0; u.playerJobUntil = 0; u.path = null; u.order = { kind: "hold" }; }
const ended = (w, u, why, kind) => w.log.push({ t: w.tick, kind: "task-ended", unit: u.id, team: u.team, task: kind, why, crew: !!u.isWorkers, x: u.ax, y: u.ay });

// these units (one team's, checked by the caller) take task `kind`. → { ok, msg } | { ok: false, error }
export function setTask(w, units, kind, spot = null) { // (spot: { x, y } — "Prospect here")
  if (!TASK_IDS.has(kind)) return { ok: false, error: "No such task" };
  const us = units.filter((u) => u && u.members?.length);
  const crews = us.filter((u) => u.isWorkers), sold = us.filter(isSoldier);
  const t = TASKS.find((q) => q.id === kind);
  const doC = t.who !== "soldiers" ? crews : [], doS = t.who !== "workers" ? sold : [];
  if (!doC.length && !doS.length) return { ok: false, error: crews.length ? "Villagers don't do that" : sold.length ? "Soldiers don't do that" : us.some((u) => u.gate !== undefined && u.gate !== null) ? "The gate's guards keep their post" : "Engines take a mark, not a task" };
  let men = 0, why = "";
  for (const u of doC) {
    if (kind === "home") { u.broad = null; u.away = false; EC.releaseWorkers(w, u); men += u.members.length; continue; }
    const r = crewJob(w, u.team, kind, u.ax, u.ay, spot); if (!r.job) { why = r.why; continue; }
    setCrewJob(u, r.job); u.broad = { kind, tag: nextTag(w), t: w.time, n: 0 }; men += u.members.length;
  }
  for (const u of doS) {
    const r = soldierTarget(w, u, kind); if (r.why) { why = r.why; continue; }
    u.hunt = null; u.helping = null; u.burning = null; u.fireAt = null;
    if (kind === "home") { u.broad = null; const h = r.at, T = w.teams[u.team], a = Math.atan2(T.town.y - h.y, T.town.x - h.x) || 0; issueOrder(w, [u.id], { kind: "move", x: h.x + Math.cos(a) * 28, y: h.y + Math.sin(a) * 28, pace: "march", player: true }); men += u.members.length; continue; }
    const B = u.broad = { kind, tag: nextTag(w), t: w.time };
    if (kind === "hunt") startPartyHunt(w, u, B, r.herd);
    else if (kind === "patrol") { const T = w.teams[u.team].town; B.k = Math.round(((Math.atan2(u.ay - T.y, u.ax - T.x) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * PATROL.n) % PATROL.n; patrolLeg(w, u, B, true); }
    else { B.node = r.at.id; B.ph = "go"; B.kg = 0; goTo(w, u, B, r.at.x, r.at.y, true); }
    men += u.members.length;
  }
  if (!men) return { ok: false, error: why ? why[0].toUpperCase() + why.slice(1) : "Nothing to do" };
  const name = kind === "home" ? (doS.length && !doC.length ? t.soldierName : t.name) : t.name;
  return { ok: true, msg: `${name}: ${men} ${doC.length && !doS.length ? "villagers" : "men"}${kind === "home" ? "" : kind === "patrol" ? " — round the town until told otherwise" : kind === "hunt" ? " — they find the game themselves" : kind === "prospect" ? " — they search the ground for days" : " — they find the work themselves"}${why ? ` (some could not: ${why})` : ""}` };
}
// the task is over for these units (any other order: commands.js)
export function clearTask(units) { for (const u of units) if (u) u.broad = null; }

function goTo(w, u, B, x, y, player = false) {
  B.t = w.time; // (orders after this are someone else's)
  issueOrder(w, [u.id], { kind: "move", x, y, pace: "march", broad: B.tag, ...(player ? { player: true } : { immediate: true }) });
}
function startPartyHunt(w, u, B, H) {
  startHunt(w, [u], H); B.htag = u.hunt?.tag; B.t = w.time; B.wait = 0;
}
function patrolLeg(w, u, B, player = false) {
  const T = w.teams[u.team].town, M = w.map || { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 }, a = B.k / PATROL.n * 2 * Math.PI;
  const x = Math.max(M.x0 + 20, Math.min(M.x1 - 20, T.x + Math.cos(a) * PATROL.r)), y = Math.max(M.y0 + 20, Math.min(M.y1 - 20, T.y + Math.sin(a) * PATROL.r));
  B.px = x; B.py = y; B.legT = w.time; goTo(w, u, B, x, y, player);
}

// ---------------------------------------------------------------- re-targeting: economy.releaseWorkers asks first
// → true when the crew has been put on the next job (it keeps its task); false: the task is over, they go home
export function retargetCrew(w, u) {
  const B = u.broad; if (!B) return false;
  const old = u.job;
  const r = crewJob(w, u.team, B.kind, u.ax, u.ay);
  if (r.job && !(old && EC.jobKey(old) === EC.jobKey(r.job) && B.kind !== "farm")) { setCrewJob(u, r.job); B.n = (B.n || 0) + 1; return true; }
  u.broad = null; ended(w, u, r.why || "nothing more to do", B.kind);
  return false;
}
EC.BROAD.retarget = retargetCrew;

// ---------------------------------------------------------------- per tick (commands.js commandSystems)
export function broadSystem(w) {
  if (w.tick % 10 !== 3) return;
  const seen = new Set();
  for (const u of w.units.values()) {
    if (!u.broad) continue;
    if (!u.members.length) { u.broad = null; continue; }
    if (seen.has(u.broad)) u.broad = { ...u.broad, kg: 0 }; // (a company split in two: each half keeps the task, with its own load)
    seen.add(u.broad);
    if (u.isWorkers) crewTick(w, u); else soldierTick(w, u);
  }
}
function crewTick(w, u) {
  const B = u.broad;
  if (u.away || u.convoy) { u.broad = null; return; } // (marched off, or carting for the army: the player's other order)
  const j = u.job;
  if (!j || j.kind === "home" || (j.b && j.b.ruin) || (j.node && !(w.resources || []).includes(j.node))) retargetCrew(w, u);
  else if (B.kind === "farm" && j.kind === "field" && FIELD_PRI[fieldPhase(w, j.b)] === undefined) retargetCrew(w, u);
}
function soldierTick(w, u) {
  const B = u.broad;
  if (ARMS[u.arm]?.engine) { u.broad = null; return; }
  if (u.state === "routing" || u.c?.broken) return; // (they come back to it when they rally, unless ordered otherwise)
  if (u.pendingOrder) return;                        // (an order on its way: wait for it)
  const T = w.teams[u.team];
  if (B.kind === "hunt") {
    if (u.hunt) return;
    if (u.order && u.order.hunt !== B.htag && u.order.broad !== B.tag && u.orderT > B.t + 0.01) { u.broad = null; return; } // someone else's order
    if (!B.wait) { B.wait = w.time + 6; return; }    // the kills are home: a breath, then out again
    if (w.time < B.wait) return;
    const H = nearestHerd(w, u.ax, u.ay, false);
    if (!H) { u.broad = null; ended(w, u, "no hunting grounds within reach", "hunt"); return; }
    startPartyHunt(w, u, B, H); return;
  }
  if (u.order && u.order.broad !== B.tag && u.orderT > B.t + 0.01) { u.broad = null; return; } // someone else's order
  if (B.kind === "patrol") {
    if (!u.path && (dist(u.ax, u.ay, B.px, B.py) < 30 || w.time - B.legT > PATROL.legS)) { B.k = (B.k + 1) % PATROL.n; patrolLeg(w, u, B); }
    else if (!u.path && !u.moving && w.time - B.legT > 8 && dist(u.ax, u.ay, B.px, B.py) >= 30 && u.order?.kind !== "move") patrolLeg(w, u, B);
    return;
  }
  // wood / stone: cut, carry home, back again
  let node = (w.resources || []).find((n) => n.id === B.node);
  const NT = NODE_TASK[B.kind];
  if (B.ph !== "carry" && (!node || !(node.amount > 1))) {
    if (B.kg > 0) return startCarry(w, u, B, NT.res, node);
    node = nearestNode(w, B.kind, u.ax, u.ay);
    if (!node) { u.broad = null; ended(w, u, `no ${NT.what} within reach`, B.kind); return; }
    B.node = node.id; B.ph = "go"; goTo(w, u, B, node.x, node.y); return;
  }
  if (B.ph === "go") {
    if (dist(u.ax, u.ay, node.x, node.y) < (node.r || 20) + 15) { B.ph = "cut"; return; }
    if (!u.path && !u.moving) goTo(w, u, B, node.x, node.y);
    return;
  }
  if (B.ph === "cut") {
    if (u.enemyNear) return; // (axes down while the enemy is about)
    if (dist(u.ax, u.ay, node.x, node.y) > (node.r || 20) + 40) { B.ph = "go"; return; }
    const men = u.members.length, md = 10 * EC.DT * (T.eff || 0.7);
    const got = Math.min(node.amount, men * (EC.E.yieldPerManDay[NT.res] || 0) * SOLDIER_RATE * md);
    node.amount -= got; B.kg += got;
    for (const id of u.members) w.S.state[id] = 6; // S_WORK: felling and hauling (as helpBuild)
    if (node.amount <= 0) w.events.push({ t: w.tick, kind: "node-exhausted", node: node.id, team: u.team });
    // as long at the axes as the walk home and back takes (the time-compressed lot: they cut a carrier's round trip's
    // worth, then all carry it home together — half a villager crew's throughput, at 0.6 of its skill)
    B.cutT ??= w.time;
    const st = nearestStore(w, u.team, NT.res, node.x, node.y), d = st ? dist(st.x, st.y, node.x, node.y) : 500;
    if (w.time - B.cutT >= Math.max(CUT_S[0], Math.min(CUT_S[1], 2 * d / (ARMS[u.arm]?.speed || 1.3)))) startCarry(w, u, B, NT.res, node);
    return;
  }
  if (B.ph === "carry") {
    const st = w.buildings.find((b) => b.id === B.store && !b.ruin) || nearestStore(w, u.team, NT.res, u.ax, u.ay);
    if (!st) { u.broad = null; ended(w, u, "no store to take it to", B.kind); return; }
    B.store = st.id;
    if (dist(u.ax, u.ay, st.x, st.y) < 35) {
      EC.give(T, NT.res, B.kg); (T.stats ||= {}).delivered = (T.stats.delivered || 0) + B.kg;
      w.events.push({ t: w.tick, kind: "task-delivered", unit: u.id, team: u.team, res: NT.res, kg: Math.round(B.kg) });
      B.kg = 0; B.ph = "go"; B.store = undefined;
      const n = node && node.amount > 1 ? node : nearestNode(w, B.kind, u.ax, u.ay);
      if (!n) { u.broad = null; ended(w, u, `no ${NT.what} within reach`, B.kind); return; }
      B.node = n.id; goTo(w, u, B, n.x, n.y); return;
    }
    if (!u.path && !u.moving) goTo(w, u, B, st.x, st.y);
  }
}
function startCarry(w, u, B, res, node) {
  const st = nearestStore(w, u.team, res, node?.x ?? u.ax, node?.y ?? u.ay);
  if (!st) { u.broad = null; ended(w, u, "no store to take it to", B.kind); return; }
  B.ph = "carry"; B.store = st.id; B.cutT = undefined; goTo(w, u, B, st.x, st.y);
}
