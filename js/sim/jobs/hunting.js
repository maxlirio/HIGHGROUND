// Gathering lane C: HUNTING (docs/gathering-plan.md). The herds themselves are js/sim/wild.js; this is the people.
//
//   • HUNTERS (a villager crew on a "hunt" node): each man either LURKS in cover at the herd's edge, or — when the crew
//     has earned a beast (the analytic rate, economy.gather → OUTPUT.fresh → w.wild.credit) — STALKS one: walks up to
//     just outside its alarm distance, creeps in crouched (hunt_stalk), draws and looses (hunt_draw). A hit drops the
//     beast where it stands (a carcass item); he shoulders it, carries it home to his store, hangs it on the larder
//     rack by the door and butchers it there (work_axe): only then is it meat in the store. A miss scatters the herd.
//   • HUNTING PARTIES (soldiers, the `hunt` command, js/game/commands.js): a company sent after a herd closes to bow
//     shot (spears: to spear's length — boar, not deer), shoots what the day's hunting earns, fetches the kills,
//     carries them home on their backs and sets them down in the store. Any other order ends the hunt.
// Deterministic (hashes of tick/id; never w.rng), DOM-free, plain data (w.wild, u.hunt, steps, items).
import { PLANNERS, HOOKS, OUTPUT, TICKS, ITEMS, manOf, itemById, itemByKey, addItem, addKg, removeItem, takeKg, nearestStore, doorOf, landingSpot } from "../labor.js";
import { SPECIES, herdOfNode, herdById, nodeOfHerd, animalsOf, animalById, killAnimal, netAnimal, penAnimal, YOUNG_ITEM, isWinter, alarm, hsh } from "../wild.js";
import { TICK, BATTLE_RATE, ECON_DAYS_PER_REAL_SEC } from "../clock.js";
import { ARMS } from "../arms.js";
import { E } from "../econ-data.js";
import { issueOrder, neighbours } from "../world.js";
import { retire } from "../economy.js";       // (import cycle: called at run time only — jobs/index.js)
import { shielded } from "../sides.js";

const BT = TICK * BATTLE_RATE, EDT = TICK * ECON_DAYS_PER_REAL_SEC;
const CREEP = 0.8;            // m/s stalking in
const BOW = { hunter: 28, longbow: 60, crossbow: 50 };   // m: a sure shot at game
const ARROW_V = 45;           // m/s (the picture's flight time)
const RACK_KG = 60;
ITEMS.rack = { res: "fresh", hold: "front", slow: 0.8, kg: RACK_KG, piece: RACK_KG };   // carcasses hung by the store door
export const DRAW_S = 1.7;    // the hunt_draw clip: nock, draw, aim, loose at its end

const credKey = (node, team) => `${node.id}:${team}`;
const W_ = (w) => w.wild;
const claimOK = (w, a, id) => a.tgt < 0 || a.tgt === id || w.time - a.tgtT > 45;

// ---------------------------------------------------------------- the analytic rate → the right to a beast
// economy.gather took `kg` off the node: for a hunting ground it stays on the hoof (the herd IS the node's amount) and
// becomes the crew's credit; a kill spends it. (The kg is back in node.amount: nothing is lost or made.)
const prevFresh = OUTPUT.fresh;
OUTPUT.fresh = (w, u, node, kg, store) => {
  if (node?.kind !== "hunt" || !W_(w) || !herdOfNode(w, node)) return prevFresh ? prevFresh(w, u, node, kg, store) : false;
  node.amount += kg;
  const H = herdOfNode(w, node), S = SPECIES[H.sp], k = credKey(node, u.team), C = W_(w).credit;
  C[k] = Math.min((C[k] || 0) + kg, S.kg * 2.5 * Math.max(1, (animalsOf(w, H)[0]?.kg || S.kg) / S.kg));   // (a crew can't bank a massacre)
  return true;
};

// ---------------------------------------------------------------- villager hunters
const prevPlanner = PLANNERS["gather:fresh"];
PLANNERS["gather:fresh"] = (w, u, id, k, M, ctx) => {
  const node = ctx.job?.node;
  if (node?.kind === "hunt") return planHunter(w, u, id, k, M, ctx, node);
  if (node?.kind === "forage") return planForager(w, u, id, k, M, ctx, node);
  if (node?.kind === "fishery") return planFisher(w, u, id, k, M, ctx, node);
  return prevPlanner ? prevPlanner(w, u, id, k, M, ctx) : null;
};

// ---------------------------------------------------------------- wild food: berries and nuts, fish
// FORAGERS work round the thicket, stooping to the low bushes, reaching into the hazel, moving on along it; what they
// pick goes into baskets at the thicket's edge (the site pile, kind "basket") and the carriers take them home on their
// backs. FISHERS take the bank of the pool or stream by the fishing water, each his own stretch, rod out over the water;
// the catch goes into the fish baskets at the landing. (The rates are the analytic ones: economy.gather.)
function planForager(w, u, id, k, M, ctx, node) {
  const ep = Math.floor(w.time / 25), a = hsh(id, 11) * 6.283 + (hsh(id, ep) - 0.5) * 1.4, r = 3.5 + 4 * hsh(id * 3, ep);
  const x = node.x + Math.cos(a) * r, y = node.y + Math.sin(a) * r;
  return [{ op: "go", x, y, near: 0.8 }, { op: "work", pose: "work_stoop", secs: 6 + 6 * hsh(id, ep + 3), face: [node.x, node.y] },
    { op: "work", pose: "work_stoop", secs: 4 + 3 * hsh(id, ep + 5), face: [node.x + Math.cos(a + 0.6) * 2, node.y + Math.sin(a + 0.6) * 2] }];
}
// a fisher's stretch of bank: a dry spot with water within a rod's length, on the ray from the fishing water's centre
function bankSpot(w, node, k) {
  const map = w.map, n = 24;
  for (let j = 0; j < n; j++) {
    const a = ((k * 7 + j) % n) / n * 6.283;
    let wet = null;
    for (let r = 0; r <= node.r * 2.5; r += 2) {
      const x = node.x + Math.cos(a) * r, y = node.y + Math.sin(a) * r, dry = map.water(x, y) < 0.05;
      if (!dry) wet = [x, y];
      else if (wet) return [x, y, wet[0], wet[1]];   // (the first dry ground outward from the water, and the water it faces)
    }
  }
  return null;
}
function planFisher(w, u, id, k, M, ctx, node) {
  const b = bankSpot(w, node, k + Math.floor(hsh(id, 13) * 5)); if (!b) return null;
  return [{ op: "go", x: b[0], y: b[1], near: 1.2 }, { op: "work", pose: "work_fish", secs: 20 + 20 * hsh(id, Math.floor(w.time / 40)), face: [b[2], b[3]] }];
}
// the forage lands in baskets, not casks
const prevFresh2 = OUTPUT.fresh;
OUTPUT.fresh = (w, u, node, kg, store) => {
  if (node?.kind !== "forage") return prevFresh2 ? prevFresh2(w, u, node, kg, store) : false;
  const key = `site:${node.id}:${u.team}`;
  let pile = itemByKey(w, key);
  if (!pile) { const [px, py] = landingSpot(w, node.x, node.y, store.x, store.y, node.r * 1.5); pile = addItem(w, { kind: "basket", res: "fresh", kg: 0, x: px, y: py, team: u.team, key, rot: Math.atan2(store.y - node.y, store.x - node.x) }); }
  addKg(w, pile, kg);
  return true;
};
function planHunter(w, u, id, k, M, ctx, node) {
  const H = herdOfNode(w, node); if (!H || H.n <= 0) return null;
  const S = w.S, sp = SPECIES[H.sp], x = S.x[id], y = S.y[id], T = ctx.T;
  const credit = W_(w).credit[credKey(node, u.team)] || 0;
  // the beast to go for: the nearest free one, if the crew has earned it and nobody else is stalking one just now
  let tgt = null, bd = Infinity, stalking = 0;
  for (const a of W_(w).a) { if (a.h !== H.id) continue; if (a.tgt >= 0 && a.tgt !== id && w.time - a.tgtT <= 45) { stalking++; continue; } const d = Math.hypot(a.x - x, a.y - y); if (d < bd) { bd = d; tgt = a; } }
  if (tgt && credit >= tgt.kg * 0.6 && stalking < 1 + Math.floor(u.members.length / 8)) return planStalk(w, id, tgt, sp);
  // lurk in cover on the herd's home side, spread out, watching (never out on the water: fowling is done from the bank)
  const town = T.town, ah = Math.atan2(town.y - H.cy, town.x - H.cx) + ((k % 7) - 3) * 0.33 + (hsh(id, 3) - 0.5) * 0.2;
  const R = sp.alarm.man + 6 + (k % 3) * 5;
  let lx = H.cx + Math.cos(ah) * R, ly = H.cy + Math.sin(ah) * R;
  if (w.map.water(lx, ly) >= 0.05) { lx = node.x + Math.cos(ah) * 4; ly = node.y + Math.sin(ah) * 4; }
  return [{ op: "go", x: lx, y: ly, near: 3 }, { op: "work", pose: "hunt_lurk", secs: 5 + 5 * hsh(id, w.tick), face: [H.cx, H.cy] }];
}
function planStalk(w, id, a, sp) {
  const S = w.S, dx = S.x[id] - a.x, dy = S.y[id] - a.y, d = Math.hypot(dx, dy) || 1, R = sp.alarm.man + 5;
  a.tgt = id; a.tgtT = w.time;
  const steps = [];
  if (d > R) steps.push({ op: "go", x: a.x + dx / d * R, y: a.y + dy / d * R, near: 4 });
  steps.push({ op: "work", pose: "hunt_stalk", secs: 120, creep: { a: a.id, to: BOW.hunter * 0.85 }, hook: "hunt.crept" });
  steps.push({ op: "work", pose: "hunt_draw", secs: DRAW_S, face: [a.x, a.y], hook: "hunt.loose", arg: { a: a.id } });
  return steps;
}
// creeping in on the beast, crouched (hunt_stalk): moved here each tick (huntTick, before the labour core runs his step),
// so the pose holds for the whole approach; within bow shot the step ends (secs → 0); the beast gone or bolted far: off
function creep(w, id, M, st) {
  const a = animalById(w, st.creep.a), S = w.S;
  if (!a || Math.hypot(a.x - S.x[id], a.y - S.y[id]) > 140) { st.secs = 0; st.fail = 1; if (a && a.tgt === id) a.tgt = -1; return; }
  a.tgtT = w.time;
  const dx = a.x - S.x[id], dy = a.y - S.y[id], d = Math.hypot(dx, dy) || 1;
  S.facing[id] = Math.atan2(dy, dx);
  const nxt = M.task.steps[M.task.k + 1]; if (nxt) nxt.face = [a.x, a.y];
  if (d <= st.creep.to) { st.secs = 0; return; }
  const s = Math.min(CREEP * BT, d - st.creep.to);
  const nx = S.x[id] + dx / d * s, ny = S.y[id] + dy / d * s;
  if (w.map.water(nx, ny) < 0.05) { S.x[id] = nx; S.y[id] = ny; }
  else st.secs = 0;   // (fowl out on the water: he looses from the bank, a longer shot)
}
HOOKS["hunt.crept"] = (w, id, M, st) => { if (st.fail) { M.task = null; M.pose = null; } };
// the arrow: resolved at once (hash dice), the picture flies it (w.wild.shots) and the fall starts when it lands
HOOKS["hunt.loose"] = (w, id, M, st) => {
  const a = animalById(w, st.arg.a), S = w.S; if (!a) { M.task = null; return; }
  if (a.tgt === id) a.tgt = -1;
  const H = herdById(w, a.h), d = Math.hypot(a.x - S.x[id], a.y - S.y[id]);
  const it = shoot(w, S.x[id], S.y[id], a, H, M.team, d, BOW.hunter, id);
  const node = H && nodeOfHerd(w, H);
  if (!it) return;   // missed: the task ends (he will lurk and try again)
  if (node) W_(w).credit[credKey(node, M.team)] = (W_(w).credit[credKey(node, M.team)] || 0) - it.kg;
  // after it: walk up, shoulder it, carry it home to the larder rack by the store door, butcher it there
  M.task.steps.push({ op: "wait", secs: Math.max(0.5, d / ARROW_V + 1.2) }, { op: "go", x: it.x, y: it.y, near: 1.3 }, { op: "take", item: it.id }, { op: "hook", name: "hunt.home" });
};
// a shot at beast a from (x0, y0): hit → the carcass item (falling from when the arrow lands), else the herd bolts
function shoot(w, x0, y0, a, H, team, d, sure, seed) {
  const W = W_(w), p = d <= sure ? 0.8 : Math.max(0.15, 0.8 - (d - sure) / sure * 0.9), hit = hsh(seed * 131 + a.id, w.tick) < p;
  const flight = d / ARROW_V;
  W.shots.push([x0, y0, 1.45, hit ? a.x : a.x + (hsh(a.id, w.tick + 1) - 0.5) * 6, hit ? a.y : a.y + (hsh(a.id, w.tick + 2) - 0.5) * 6, w.time, flight, hit ? 1 : 0]);
  if (W.shots.length > 60) W.shots.splice(0, W.shots.length - 60);
  if (!hit) { if (H) alarm(w, H, x0, y0); return null; }
  const it = killAnimal(w, a, team, x0, y0); if (it) it.t0 = w.time + flight;
  return it;
}
// with the carcass on his back: home to the nearest store that takes meat, hang it on the rack, butcher it
HOOKS["hunt.home"] = (w, id, M) => {
  if (!M.carry) return;
  const S = w.S, b = nearestStore(w, M.team, "fresh", S.x[id], S.y[id]); if (!b) return;   // (deliver-first puts it down)
  const rack = rackSpot(w, b, M.team), [rx, ry, rr] = rack;
  const bx = rx + Math.cos(rr + Math.PI / 2) * 1.6, by = ry + Math.sin(rr + Math.PI / 2) * 1.6;
  M.task.steps.push(
    { op: "go", x: bx, y: by, near: 1.2 },
    { op: "put", to: "pile", key: `rack:${b.id}:${M.team}`, kind: "rack", x: rx, y: ry, rot: rr },
    { op: "work", pose: "work_axe", secs: 7, face: [rx, ry], hook: "hunt.butcher", arg: { key: `rack:${b.id}:${M.team}`, kg: M.carry.kg, b: b.id } });
};
// the rack by the store: at the store's edge toward the hunting grounds' side of the town, kept once made
function rackSpot(w, b, team) {
  const it = itemByKey(w, `rack:${b.id}:${team}`); if (it) return [it.x, it.y, it.rot];
  const T = w.teams[team], [dx, dy] = doorOf(b, b.x + 30 * Math.cos((b.rot || 0) - 0.9), b.y + 30 * Math.sin((b.rot || 0) - 0.9));
  const ox = dx - b.x, oy = dy - b.y, d = Math.hypot(ox, oy) || 1;
  return [dx + ox / d * 3.5, dy + oy / d * 3.5, Math.atan2(oy, ox) + Math.PI / 2];
}
// butchered: the carcass comes down off the rack as meat into the store (the lane's own `put to: store`)
HOOKS["hunt.butcher"] = (w, id, M, st) => {
  const it = itemByKey(w, st.arg.key), T = w.teams[M.team]; if (!it || !T?.store) return;
  const b = w.buildings.find((q) => q.id === st.arg.b);
  const got = takeKg(w, it, st.arg.kg);
  if (b && !b.ruin) { T.store.fresh = (T.store.fresh || 0) + got; (T.stats ||= {}).delivered = (T.stats.delivered || 0) + got; (T.stats.game ||= 0); T.stats.game += got; }
  else addItem(w, { kind: "rack", kg: got, x: it.x, y: it.y, team: M.team, loose: true });
};

// ---------------------------------------------------------------- hunting parties (soldiers)
let tagSeq = 0;
// the player's `hunt`: these units go after herd H. Villagers become a hunting crew on the herd's ground; soldiers a party.
export function startHunt(w, units, H) {
  const node = nodeOfHerd(w, H); let men = 0, parties = 0, crews = 0;
  for (const u of units) {
    if (!u.members.length) continue; men += u.members.length;
    if (u.isWorkers) { if (!node) continue; u.job = { kind: "gather", node, res: "fresh" }; u.haul = new Map(); u.danger = 0; u.away = false; u.playerJobUntil = 0; u.path = null; crews++; continue; }
    if (ARMS[u.arm]?.engine) continue;
    const bag = u.hunt?.bag || [];
    u.hunt = { herd: H.id, tag: (w.huntTag = (w.huntTag || tagSeq) + 1), t0: w.time, credit: 0, kills: 0, want: Math.max(2, Math.min(8, Math.ceil(u.members.length / 6))), phase: "chase", bag, aimX: -1, aimY: -1, shot: null, next: 0 };
    u.fireAt = null; u.helping = null; u.burning = null;
    approach(w, u, H, true); parties++;
  }
  return { men, parties, crews };
}
// the player's `capture` (docs/mounts-wildlife-spec.md): these units go to run down a live juvenile from herd H and
// lead it home to the stables pen. Soldiers or villagers alike — a capture party, not a crew.
export function startCapture(w, units, H) {
  let men = 0, parties = 0;
  for (const u of units) {
    if (!u.members.length || ARMS[u.arm]?.engine) continue;
    men += u.members.length;
    if (u.isWorkers) { u.job = null; u.haul = new Map(); u.danger = 0; u.away = false; u.playerJobUntil = 0; u.path = null; }
    u.hunt = { herd: H.id, tag: (w.huntTag = (w.huntTag || tagSeq) + 1), t0: w.time, credit: 0, kills: 0, want: 0, phase: "close", capture: 1, young: -1, netT: 0, bag: [], aimX: -1, aimY: -1, shot: null, next: 0 };
    u.fireAt = null; u.helping = null; u.burning = null;
    approach(w, u, H, true); parties++;
  }
  return { men, parties };
}
const YOUNG_SP = { young_strider: "strider", young_drake: "drake" };
// the team's pen: a finished, standing stables (the mounts lane reads its b.pens — docs/mounts-wildlife-spec.md)
export const penOf = (w, team) => w.buildings.find((b) => b.team === team && b.kind === "stables" && (b.progress ?? 1) >= 1 && !b.ruin) || null;
const clearTire = (w, h) => { if (h?.young >= 0) { const a = animalById(w, h.young); if (a) { a.tgt = -1; a.tireT = 0; } } };
function captureTick(w, u, h, t) {
  const S = w.S, W = w.wild;
  if (h.phase === "close") {
    // the young to run down (it tires over the chase — js/sim/wild.js — and stands, blown; only then is it caught)
    const yg = W.a.find((a) => a.h === h.herd && a.young && a.id === h.young) || W.a.find((a) => a.h === h.herd && a.young);
    if (!yg) { w.events.push({ t: w.tick, kind: "capture-failed", unit: u.id, team: u.team }); u.hunt = null; return; }
    if (h.young !== yg.id) { clearTire(w, h); h.young = yg.id; }
    let bi = -1, bd = Infinity;
    for (const i of u.members) { if (!S.alive[i] || w.labor?.men.get(i)?.carry) continue; const d = Math.hypot(yg.x - S.x[i], yg.y - S.y[i]); if (d < bd) { bd = d; bi = i; } }
    if (bi < 0) { clearTire(w, h); u.hunt = null; return; }
    yg.tgt = bi; yg.tgtT = t; yg.tireT ||= t;
    if (bd < 6.5 && t - yg.tireT > 18) {
      if (!h.netT) h.netT = t + 2.5;                 // the scuffle: nets and ropes over it
      else if (t >= h.netT) {
        const got = netAnimal(w, yg, u.team); h.netT = 0;
        if (got) {
          const kind = YOUNG_ITEM[got.sp], M = manOf(w, bi, true);
          M.carry = { kind, res: "live", kg: ITEMS[kind].kg };
          h.phase = "lead"; h.aimX = -1; h.aimY = -1;
        }
      }
    } else h.netT = 0;
    if (Math.hypot(yg.x - h.aimX, yg.y - h.aimY) > 4 || !u.path) { h.aimX = yg.x; h.aimY = yg.y; order(w, u, yg.x, yg.y); }
  } else {   // lead: walk the catch home and pen it
    const haulers = u.members.filter((i) => YOUNG_SP[w.labor?.men.get(i)?.carry?.kind]);
    const b = penOf(w, u.team);
    if (!haulers.length || !b) { u.hunt = null; return; }   // (the pen burned on the way home: a dropped young escapes — wild.js)
    const [dx, dy] = doorOf(b, u.ax, u.ay);
    if (Math.hypot(u.ax - dx, u.ay - dy) < 14) {
      for (const i of haulers) { const M = w.labor.men.get(i), sp = YOUNG_SP[M.carry.kind]; penAnimal(w, u.team, sp, b); M.carry = null; if (!M.task) w.labor.men.delete(i); w.events.push({ t: w.tick, kind: "capture-home", unit: u.id, team: u.team, sp }); }
      u.hunt = null; return;
    }
    if (Math.hypot(dx - h.aimX, dy - h.aimY) > 3) { h.aimX = dx; h.aimY = dy; order(w, u, dx, dy); }
  }
}
const reach = (u) => { const A = ARMS[u.arm]; return A?.missile ? BOW[A.missile] || 50 : 5; };
function order(w, u, x, y, extra = {}) {
  const H = u.hunt; issueOrder(w, [u.id], { kind: "move", x, y, pace: "quick", formation: "loose", player: true, hunt: H.tag, ...extra });
  H.ordT = w.time;
}
function approach(w, u, H, force = false) {
  const h = u.hunt, R = reach(u) * 0.8, dx = u.ax - H.cx, dy = u.ay - H.cy, d = Math.hypot(dx, dy) || 1;
  const x = H.cx + dx / d * Math.min(R, d), y = H.cy + dy / d * Math.min(R, d);
  if (!force && Math.hypot(x - h.aimX, y - h.aimY) < 18) return;
  h.aimX = x; h.aimY = y;
  order(w, u, x, y, { facing: Math.atan2(H.cy - y, H.cx - x) });
}
const HUNT_FLOOR_KG = 0.27; // kg of quarry each hunter is worth per half second of the chase, whatever the economic clock
function huntTick(w) {
  if (!w.wild) return;
  const S = w.S, t = w.time;
  if (w.labor) for (const [id, M] of w.labor.men) { const st = M.task?.steps[M.task.k]; if (st?.creep && S.alive[id]) creep(w, id, M, st); }
  for (const u of w.units.values()) {
    const h = u.hunt; if (!h) continue;
    if (!u.members.length) { dropBag(w, u); u.hunt = null; continue; }
    // any other order (the player's, a captain's, the command system's garble) ends the hunt; the kills stay where they lie
    if (u.order && u.order.hunt !== h.tag && u.orderT > (h.ordT ?? -1) + 0.01) { u.hunt = null; continue; }
    if (u.state === "routing" || u.c?.broken) { u.hunt = null; continue; }
    if (t < h.next) continue; h.next = t + 0.5;
    if (h.capture) { captureTick(w, u, h, t); continue; }
    const H = herdById(w, h.herd), T = w.teams[u.team];
    if (h.phase === "chase") {
      if (!H || H.n <= 0 || h.kills >= h.want) { h.phase = "fetch"; h.next = t; continue; }
      const d = Math.hypot(u.ax - H.cx, u.ay - H.cy), R = reach(u);
      if (d < R + 40) h.credit = Math.min(h.credit + Math.max(u.members.length * (E.yieldPerManDay.fresh || 3.5) * EDT * 5 * (T?.eff || 0.7), u.members.length * HUNT_FLOOR_KG), 400);   // (0.5 s of hunting; HUNT_FLOOR_KG: at the realm's slow economic clock a party still takes its beast in half a minute, not most of an hour)
      approach(w, u, H);
      if (h.shot) { resolvePartyShot(w, u, h); continue; }
      // who can reach a beast: the nearest man to the nearest beast
      let best = null, bi = -1, bd = Infinity;
      for (const a of w.wild.a) { if (a.h !== H.id) continue; for (const i of u.members) { if (!S.alive[i]) continue; const e = Math.hypot(a.x - S.x[i], a.y - S.y[i]); if (e < bd) { bd = e; best = a; bi = i; } } }
      const missile = !!ARMS[u.arm]?.missile;
      // spears and lances: with a beast earned, the party rides in on the nearest one (it held off at the herd's edge for ever)
      if (best && !missile && bd > 12 && h.credit >= best.kg * 0.6 && Math.hypot(best.x - h.aimX, best.y - h.aimY) > 4) { h.aimX = best.x; h.aimY = best.y; order(w, u, best.x, best.y, { facing: Math.atan2(best.y - u.ay, best.x - u.ax) }); }
      if (!best || bd > (missile ? R * 1.25 : 12) || h.credit < best.kg * 0.6) continue;
      // bows: the man draws (the archers' own shoot clip, timed by S.nextShot) and looses 0.9 s on; spears are thrown at once
      h.shot = { man: bi, a: best.id, tl: t + (missile ? 0.9 : 0) }; S.facing[bi] = Math.atan2(best.y - S.y[bi], best.x - S.x[bi]);
      if (missile) S.nextShot[bi] = t + 0.9; else resolvePartyShot(w, u, h);
    } else if (h.phase === "fetch") {
      h.bag = h.bag.filter((iid) => itemById(w, iid));
      const it = h.bag.length ? itemById(w, h.bag[0]) : null;
      if (!it) { h.phase = "home"; h.next = t; continue; }
      if (t < (it.t0 || 0) + 1) continue;
      // the man nearest the kill who has his hands free shoulders it
      let bi = -1, bd = Infinity;
      for (const i of u.members) { if (!S.alive[i] || w.labor?.men.get(i)?.carry) continue; const e = Math.hypot(it.x - S.x[i], it.y - S.y[i]); if (e < bd) { bd = e; bi = i; } }
      if (bi < 0) { h.phase = "home"; continue; }
      if (bd < 10) { const M = manOf(w, bi, true); M.carry = { kind: it.kind, res: it.res, kg: it.kg }; removeItem(w, it); h.bag.shift(); h.next = t + 1.2; continue; }
      if (Math.hypot(it.x - h.aimX, it.y - h.aimY) > 3 || !u.path) { h.aimX = it.x; h.aimY = it.y; order(w, u, it.x, it.y); }
    } else if (h.phase === "home") {
      const b = nearestStore(w, u.team, "fresh", u.ax, u.ay);
      if (!b || !carriers(w, u).length) { u.hunt = null; continue; }
      const [dx, dy] = doorOf(b, u.ax, u.ay);
      if (Math.hypot(u.ax - dx, u.ay - dy) < 30) { const kg = deliver(w, u, b); w.events.push({ t: w.tick, kind: "hunt-home", unit: u.id, team: u.team, kg: Math.round(kg) }); u.hunt = null; continue; }
      if (Math.hypot(dx - h.aimX, dy - h.aimY) > 3) { h.aimX = dx; h.aimY = dy; order(w, u, dx, dy); }
    }
  }
  // a soldier with meat on his back and no party (the hunt was called off): he sets it down in the store when he passes it
  if (w.tick % 10 === 0 && w.labor) for (const [id, M] of w.labor.men) {
    if (!M.carry || M.carry.res === "live" || M.task || !S.alive[id]) continue;
    const u = w.units.get(S.unit[id]); if (!u || u.isWorkers || u.hunt) continue;
    const b = nearestStore(w, M.team, M.carry.res, S.x[id], S.y[id]); if (!b) continue;
    const [dx, dy] = doorOf(b, S.x[id], S.y[id]);
    if (Math.hypot(S.x[id] - dx, S.y[id] - dy) < 30) putStore(w, M, b, id);
  }
}
function resolvePartyShot(w, u, h) {
  const sh = h.shot, S = w.S; if (w.time < sh.tl) return;
  h.shot = null;
  const a = animalById(w, sh.a); if (!a || !S.alive[sh.man]) return;
  const H = herdById(w, a.h), d = Math.hypot(a.x - S.x[sh.man], a.y - S.y[sh.man]);
  const it = shoot(w, S.x[sh.man], S.y[sh.man], a, H, u.team, d, ARMS[u.arm]?.missile ? reach(u) : 6, sh.man);
  if (it) { h.credit -= it.kg; h.kills++; h.bag.push(it.id); it.claim = 1; }
}
// ---------------------------------------------------------------- teeth (nuisance scale, never a siege)
// Wolves prowl the margins and take a sheep now and then — bolder in winter, when very rarely they take a lone
// villager far from home. NEVER from a house that is shielded (a newcomer's protection) or under the Keep's Peace
// (server/houses.mjs: the lord away/offline): the dark stays outside the light of the hall. A bear or a drake turns
// on a man who comes right into its ground: one mauling a day per den at most, and it answers for it — the pack or
// den is an ordinary huntable herd, so the hunters the losses pay for can root it out.
const tmpN = [], tmpN2 = [];
function predatorTick(w) {
  const W = w.wild; if (!W || w.tick % 10 !== 0) return;
  for (const H of W.herds) {
    if (H.n <= 0) continue;
    const K = SPECIES[H.sp].kindof;
    if (K === "solitary" || K === "basker") charge(w, H, K);
    else if (K === "pack") prowl(w, H);
  }
}
function charge(w, H, K) {
  const S = w.S, t = w.time, day = Math.floor(w.tick * EDT), trig = K === "basker" ? 5.5 : 14;
  let ax = H.cx, ay = H.cy;
  for (const A of w.wild.a) if (A.h === H.id) { ax = A.x; ay = A.y; break; }   // the beast itself (a den of one or few)
  let bi = -1, bd = Infinity;
  for (const id of neighbours(w, ax, ay, 42, tmpN)) {
    if (!S.alive[id]) continue;
    const d = Math.hypot(S.x[id] - ax, S.y[id] - ay);
    if (d < bd) { bd = d; bi = id; }
  }
  if (bi < 0) { if (H.rage) H.rage = 0; return; }
  // (the same light of the hall as the wolves': a shielded house's man, or one under the Keep's Peace, is only warned off)
  const bt = S.team[bi]; if (shielded(w, bt) || w.teams[bt]?.keepsPeace) { if (bd < trig && !H.rage) alarm(w, H, S.x[bi], S.y[bi], 0.8); return; }
  if (!H.rage && bd < trig && (H.lastMaul || -9) < day && hsh(H.id * 31, w.tick) < 0.5) H.rage = t + 9;
  if (!H.rage) return;
  if (t > H.rage) { H.rage = 0; alarm(w, H, S.x[bi], S.y[bi], 1.2); return; }   // gives it up, backs off into cover
  // the charge: straight at him (no herd blending, no bend-home — a charging bear is past being scared)
  const dx = S.x[bi] - H.cx, dy = S.y[bi] - H.cy, dd = Math.hypot(dx, dy) || 1;
  H.mode = "flee"; H.fx = dx / dd; H.fy = dy / dd; H.until = t + 1.3;
  if (bd < 2.6) {   // caught: mauled — off the map by the same bookkeeping as any quiet loss (ledger: census.died)
    const team = S.team[bi], u = w.units.get(S.unit[bi]), mx = S.x[bi], my = S.y[bi];
    H.rage = 0; H.lastMaul = day;
    if (retire(w, bi)) { const T = w.teams[team]; if (T?.census) T.census.died++; w.events.push({ t: w.tick, kind: "mauled", sp: H.sp, team, x: mx, y: my, unit: u?.id }); }
    alarm(w, H, mx, my, 1.5);
  }
}
function prowl(w, H) {
  const day = Math.floor(w.tick * EDT);
  if ((H.lastTake || -9) >= day) return;
  const winter = isWinter(w);
  let T = null, ti = -1, bd = Infinity;
  for (let k = 0; k < w.teams.length; k++) { const t = w.teams[k]; if (!t?.town || t.fallen) continue; const d = Math.hypot(t.town.x - H.cx, t.town.y - H.cy); if (d < bd) { bd = d; T = t; ti = k; } }
  if (!T || bd > (winter ? 900 : 500)) return;
  if (shielded(w, ti) || T.keepsPeace) { H.lastTake = day; return; }
  if (hsh(H.id * 97, day) >= (winter ? 0.1 : 0.03)) { H.lastTake = day; return; }
  if ((T.sheep || 0) > 30) { T.sheep -= 1; H.lastTake = day; w.events.push({ t: w.tick, kind: "wolves-took-sheep", team: ti, x: H.cx, y: H.cy }); return; }
  H.lastTake = day;
  if (!winter || hsh(H.id * 131, day) > 0.15) return;
  // the hungriest turn of the year: a lone villager far out, nobody within earshot
  const S = w.S;
  for (const id of neighbours(w, H.cx, H.cy, 160, tmpN)) {
    if (!S.alive[id] || S.team[id] !== ti) continue;
    const u = w.units.get(S.unit[id]); if (!u?.isWorkers) continue;
    if (Math.hypot(S.x[id] - T.town.x, S.y[id] - T.town.y) < 220) continue;
    let alone = true;
    for (const j of neighbours(w, S.x[id], S.y[id], 25, tmpN2)) if (j !== id && S.alive[j]) { alone = false; break; }
    if (!alone) continue;
    const mx = S.x[id], my = S.y[id];
    if (retire(w, id)) { if (T.census) T.census.died++; w.events.push({ t: w.tick, kind: "taken-by-wolves", team: ti, x: mx, y: my }); alarm(w, H, 2 * H.cx - mx, 2 * H.cy - my, 0.6); }
    return;
  }
}
TICKS.pred = predatorTick;
const carriers = (w, u) => u.members.filter((i) => w.labor?.men.get(i)?.carry);
function putStore(w, M, b, id) {
  const T = w.teams[M.team], c = M.carry; if (!c || !T?.store) return 0;
  T.store[c.res] = (T.store[c.res] || 0) + c.kg; (T.stats ||= {}).delivered = (T.stats.delivered || 0) + c.kg; T.stats.game = (T.stats.game || 0) + c.kg;
  M.carry = null; if (!M.task) w.labor.men.delete(id);
  return c.kg;
}
function deliver(w, u, b) { let kg = 0; for (const i of carriers(w, u)) kg += putStore(w, w.labor.men.get(i), b, i); return kg; }
function dropBag(w, u) { for (const iid of u.hunt?.bag || []) { const it = itemById(w, iid); if (it) it.claim = 0; } }
TICKS.hunt = huntTick;
