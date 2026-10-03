// Gathering lane E — STONE, ORE & TOWN LIFE (docs/gathering-plan.md). Registers into the labour core (js/sim/labor.js).
// Deterministic (hash of ids and ticks only; no randomness), DOM-free, plain data only (the realm save round-trips it).
//
// THE WORKINGS. Every stone / ore / silver / gold / clay node a crew works gets one WORKS item (kind "works", kg = the
// cut that lies at the face / in the mine / in the pits and has not been moved yet), fixed at the node's centre:
//   st = "<style>:<cut kg>" — the style (quarry | adit | pit) and how much has been cut there so far (it drives the
//   picture: the quarry face worked back in benches, the adit's spoil heap, the pits dug), rot = the way the workings
//   face (toward the store the first crew hauled to). Being an item, it is saved with w.labor and synced to realm
//   clients like any other, so the renderer (js/render/jobs/quarry.js) draws the workings from it alone.
// A crew's output (labor.OUTPUT) goes onto the works; the workers themselves move it to the site's landing heap (the
// core's `site:<node>:<team>` pile), where the crew's carriers take it to the store as before:
//   QUARRY  quarrymen at the rock face: pick, then wedges and mallet (work_pick, work_mallet); cut blocks pile at the
//           face foot; every so often one of them drags the lot on a SLEDGE (carry "sledge", walk_drag) to the landing
//   ADIT    miners walk into the hill (hidden in the mound), work there, and come out pushing an ore TUB (carry "tub")
//           to tip it on the ore heap at the mouth, then go back in
//   PIT     diggers pick at the pit edges (clay, bog iron) and carry BASKETS up to the heap
// No crew at the face (a one-man crew is all carrier) → the output goes straight onto the heap, as before; a works
// left with kg when its crew is gone is swept onto the heap by the periodic sweep (nothing is ever stranded).
//
// TOWN LIFE. A few of the villagers at home (about one in seven) run errands now and then instead of standing in their
// yards: drawing water at the town's WELL (a kg-0 item "well", placed once on open ground near the keep, so realm
// clients see it too) and walking home with the pail, or going across to another building (the church, the smithy,
// the market) to talk. They count as working for the garden's output (economy.homeWork), so nothing changes in the
// books; errands pause while there are sheaves to thresh (that is lane A's work for the reserve).
import { PLANNERS, HOOKS, ITEMS, OUTPUT, addItem, addKg, itemByKey, laborOf, removeItem } from "../labor.js";
import { BUILDINGS } from "../econ-data.js";
import { blocked } from "../obstacles.js";

// ---------------------------------------------------------------- items
ITEMS.works = { res: "stone", hold: "front", slow: 1, kg: 1, piece: 2500 };        // the cut lying at the face (never carried: a hook loads it)
ITEMS.sledge = { res: "stone", hold: "sledge", slow: 0.62, kg: 250, piece: 2500 }; // blocks dragged on a sledge
ITEMS.tub = { res: "ore", hold: "tub", slow: 0.8, kg: 60, piece: 800 };            // an ore tub pushed out of the adit
ITEMS.oreheap = { res: "ore", hold: "back", slow: 0.9, kg: 30, piece: 900 };       // the heap at the mine mouth (carried off in baskets)
ITEMS.clayheap = { res: "clay", hold: "back", slow: 0.9, kg: 30, piece: 1500 };
ITEMS.pail = { res: "water", hold: "pail", slow: 0.95, kg: 0, piece: 1 };          // (a home errand: no goods, kg 0)
ITEMS.well = { res: "water", hold: "front", slow: 1, kg: 0, piece: 1 };            // the town's well (a place, kg 0)

export const LANE_RES = ["stone", "ore", "silver", "gold", "clay"];
const HEAP = { stone: "stone", ore: "oreheap", silver: "oreheap", gold: "oreheap", clay: "clayheap" };
// how much cut makes the picture "fully worked" (the face 8 m back, the spoil heap full grown, all the pits dug)
export const FULL = { quarry: 400000, adit: 60000, pit: 80000 };

export function styleOf(node) {
  if (node.res === "stone") return "quarry";
  if (node.kind === "silver_vein" || node.kind === "gold_vein") return "adit";
  if (node.res === "ore" && /ironstone|outcrop|seam|_ridge|vein/i.test(node.name || "")) return "adit";   // (bog ore is dug in pits)
  return "pit";
}

// deterministic hash → [0, 1)
export const hsh = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };

// ---------------------------------------------------------------- geometry shared with the renderer
// The quarry: a rock mass of NC columns × NR rows × NL layers of BS-metre blocks behind the face line. The face line
// starts F0 m in front of the node's centre (along the works' facing n) and is worked back as the cut grows: a column's
// floor-level face stands faceOff(cut, i) m behind the original line; the layers above are cut further back (benches).
export const Q = { NC: 13, NR: 9, NL: 6, BS: 1.6, LH: 1.55, F0: 3, MAXD: 8 };
// st = "<style>:<cut kg>:<off m>" — off: how far out in front of the node's centre the workings are laid (a node whose
// centre is taken by a rock prop or trees has its workings in front of them, where men can stand)
export const worksInfo = (it) => { const p = (it.st || "quarry").split(":"); return { style: p[0], cut: +p[1] || 0, off: +p[2] || 0 }; };
export const depthOf = (style, cut) => Math.min(1, cut / FULL[style]);
export const jag = (i) => hsh(i, 91) * 1.2;
// metres behind the original face line where column i's layer l stands (blocks whose front edge is nearer are gone)
export function faceOff(cut, i, l = 0) { const d = depthOf("quarry", cut) * Q.MAXD + jag(i) + l * 0.9 * depthOf("quarry", cut + 30000); return Math.ceil(d / Q.BS - 1e-6) * Q.BS; }
// world point from the works frame: a along the face (tangent), b outwards (toward the working floor), from the node
function frameAt(x, y, rot, off) { const c = Math.cos(rot), s = Math.sin(rot); return (a, b) => [x + c * (b + off) - s * a, y + s * (b + off) + c * a]; }
export function frame(it) { return frameAt(it.x, it.y, it.rot, worksInfo(it).off); }
// adit: a mound (centre, radius) with the portal in its face and a point deep inside; the ore heap in front
export const ADIT = { mound: 9, R: 8.5, mouth: 14.9, inside: 9.5, heap: 22 };
// pits: up to 7, laid round a point in front of the node's centre; pit k is dug once the cut passes its share
export const PIT = { c: 6 };
export function pitSpots(it) { const P = frame(it), out = []; for (let k = 0; k < 7; k++) { const a = k * 2.399 + 0.6, r = 2.5 + 3.4 * Math.sqrt(k); out.push([...P(Math.cos(a) * r, PIT.c + Math.sin(a) * r), 1.6 + hsh(k, 5) * 0.9]); } return out; }
export const pitsOpen = (cut) => Math.max(2, Math.min(7, 2 + Math.floor(depthOf("pit", cut) * 6)));
// where men must be able to stand, per style (a, b in the works frame)
const STAND = {
  quarry: () => { const o = []; for (let a = -8; a <= 8; a += 4) for (const b of [Q.F0 - Q.MAXD, Q.F0 - 4, Q.F0 + 1]) o.push([a, b]); return o; },
  adit: () => [[0, ADIT.inside], [0, ADIT.mouth], [0, ADIT.mouth + 3], [2.5, ADIT.heap]],
  pit: () => { const o = [[0, PIT.c]]; for (let k = 0; k < 8; k++) o.push([Math.cos(k * 0.785) * 11, PIT.c + Math.sin(k * 0.785) * 11]); return o; },
};
function clearOff(w, node, rot, style) {
  const O = w.obstacles; if (!O) return 0;
  for (const off of [0, 6, 10, 14, 18, 24]) { const P = frameAt(node.x, node.y, rot, off); if (STAND[style]().every(([a, b]) => { const [x, y] = P(a, b); return !blocked(O, x, y, 0.4); })) return off; }
  return 10;
}

// ---------------------------------------------------------------- state
function laneOf(w) { return (laborOf(w).quarry ||= { sweep: 0 }); }
const worksKey = (node, team) => `works:${node.id}:${team}`;
const pileKey = (node, team) => `site:${node.id}:${team}`;       // (the core's landing pile: economy.pileKey)
const setCut = (it, style, cut) => { it.cut = cut; it.st = `${style}:${Math.round(cut)}:${it.off || 0}`; };

// the works (and its landing heap) for a node; made the first time a crew of `team` cuts there
function works(w, node, team, store) {
  let it = itemByKey(w, worksKey(node, team));
  if (it) return it;
  const style = styleOf(node);
  // the way the workings face: another house's works on this node (one face), else toward the store
  let rot = null, off = null; for (const o of w.labor?.items || []) if (o.kind === "works" && o.node === node.id) { rot = o.rot; off = o.off; break; }
  if (rot === null) {
    rot = store ? Math.atan2(store.y - node.y, store.x - node.x) : hsh(node.id, 3) * 6.283;
    // a level is driven into the hillside: its mouth faces down the slope, onto open ground
    const g = style === "adit" && w.map?.grad ? w.map.grad(node.x, node.y) : null;
    if (g && Math.hypot(g[0], g[1]) > 0.03) rot = Math.atan2(-g[1], -g[0]);
    off = clearOff(w, node, rot, style);
  }
  it = addItem(w, { kind: "works", res: node.res, kg: 0, x: node.x, y: node.y, team, key: worksKey(node, team), rot });
  it.node = node.id; it.act = -1e9; it.ld = -1e9; it.off = off; setCut(it, style, 0);
  heapOf(w, node, it);
  return it;
}
// the landing heap: in front of the workings, toward the store (made here so it carries the node's own resource; the
// carriers take it to nothing now and then, and it is laid again at the same spot)
function heapOf(w, node, it) {
  const h = itemByKey(w, pileKey(node, it.team)); if (h) return h;
  const style = worksInfo(it).style, P = frame(it), [hx, hy] = style === "quarry" ? P(-5, Q.F0 + 13) : style === "adit" ? P(2.5, ADIT.heap) : P(0, PIT.c + 17);
  return addItem(w, { kind: HEAP[node.res] || "oreheap", res: node.res, kg: 0, x: hx, y: hy, team: it.team, key: pileKey(node, it.team), rot: it.rot + Math.PI / 2 });
}
// move whatever lies at the works onto the landing heap (nobody is left to carry it there)
function flush(w, it) {
  if (!(it.kg > 0)) return;
  const node = w.resources?.find((n) => n.id === it.node), heap = node && heapOf(w, node, it);
  if (!heap) return;
  addKg(w, heap, it.kg); it.kg = 0; if (it.n) { it.n = 0; w.labor.ver++; }
}

// a gather crew's cut: onto the works while workers are at the face, else straight onto the heap
function output(w, u, node, kg, store) {
  const it = works(w, node, u.team, store), style = worksInfo(it).style;
  setCut(it, style, (it.cut || 0) + kg);
  if (w.time - it.act < 90) addKg(w, it, kg);
  else { flush(w, it); addKg(w, heapOf(w, node, it), kg); }
  if (!(node.amount > 0)) flush(w, it);
  return true;
}
for (const r of LANE_RES) OUTPUT[r] = output;

// ---------------------------------------------------------------- hooks
// load what lies at the works: a sledge of blocks, a tub of ore, a basket from the pit (all of it: the time-compressed lot)
HOOKS["quarry.load"] = (w, id, M, st) => {
  const it = w.labor.items.find((x) => x.id === st.arg);
  if (!it || !(it.kg > 0) || M.carry) { M.task = null; M.pose = null; if (!M.carry) w.labor.men.delete(id); return; }   // (nothing there: he goes back to work)
  M.carry = { kind: st.kind, res: it.res, kg: it.kg }; it.kg = 0; if (it.n) { it.n = 0; w.labor.ver++; }
};
HOOKS["quarry.act"] = (w, id, M, st) => { const it = w.labor.items.find((x) => x.id === st.arg); if (it) it.act = w.time; };
HOOKS["town.pour"] = (w, id, M) => { if (M.carry?.kind === "pail") M.carry = null; };

// ---------------------------------------------------------------- planners (crew member k, no task, empty-handed)
const LOADMIN = { quarry: 400, adit: 1, pit: 1 };
function plan(w, u, id, k, M, ctx) {
  const node = ctx.job.node; if (!node || !(node.amount > 0)) return null;
  const T = ctx.T, S = w.S, store = u.store || null;
  const it = works(w, node, u.team, store), { style, cut } = worksInfo(it), P = frame(it);
  const heap = heapOf(w, node, it);
  it.act = w.time;
  const ep = Math.floor(w.time / 40), r1 = hsh(id, ep * 3 + 1), r2 = hsh(id, ep * 3 + 2);
  const act = { op: "hook", name: "quarry.act", arg: it.id };
  const loadNow = heap && it.kg >= LOADMIN[style] && w.time - it.ld > (style === "quarry" ? 10 : 3);
  if (style === "quarry") {
    if (loadNow) {   // drag the blocks at the face foot to the landing on a sledge
      it.ld = w.time; const [fx, fy] = P(0, Q.F0 + 1.5 - faceOff(cut, Q.NC >> 1));
      return [{ op: "go", x: fx, y: fy, near: 1.5 }, { op: "work", pose: "work_stoop", secs: 1.2, face: [it.x, it.y] }, { op: "hook", name: "quarry.load", arg: it.id, kind: "sledge" },
        { op: "go", x: heap.x, y: heap.y, near: 2.2 }, { op: "put", to: "pile", key: heap.key, kind: heap.kind }];
    }
    // a man keeps to his own stretch of the face (the next block along each spell)
    const i = Math.min(Q.NC - 2, 1 + Math.floor((hsh(id, 17) * 0.8 + r1 * 0.2) * (Q.NC - 2))), a = (i - (Q.NC - 1) / 2) * Q.BS + (r2 - 0.5) * 0.6;
    const b = Q.F0 - faceOff(cut, i), [x, y] = P(a, b + 1.05), face = P(a, b - 1);
    return [{ op: "go", x, y, near: 0.8 }, act,
      { op: "work", pose: "work_pick", secs: 6 + r1 * 5, x, y, face },
      { op: "work", pose: "work_mallet", secs: 4 + r2 * 3, x, y, face }, act];
  }
  if (style === "adit") {
    const [mx, my] = P((r1 - 0.5) * 1.2, ADIT.mouth + 0.6), [ix, iy] = P((r2 - 0.5) * 1.5, ADIT.inside);
    const inside = Math.hypot(S.x[id] - ix, S.y[id] - iy) < 3;
    const into = inside ? [] : [{ op: "go", x: mx, y: my, near: 1 }, { op: "go", x: ix, y: iy, near: 1.2 }];
    if (inside && loadNow) {   // out with a full tub, tip it on the heap, back into the hill
      it.ld = w.time; const [ox, oy] = P(0, ADIT.mouth + 2.5);
      return [{ op: "hook", name: "quarry.load", arg: it.id, kind: "tub" }, { op: "go", x: mx, y: my, near: 1 }, { op: "go", x: ox, y: oy, near: 1.2 },
        { op: "go", x: heap.x + (r1 - 0.5) * 2, y: heap.y + (r2 - 0.5) * 2, near: 1.6 }, { op: "put", to: "pile", key: heap.key, kind: heap.kind }];
    }
    return [...into, act, { op: "work", pose: "work_pick", secs: 10 + r1 * 10, face: P(0, 0) }, act];
  }
  // pits
  if (loadNow && hsh(id, ep) < 0.5) {
    it.ld = w.time;
    return [{ op: "work", pose: "work_stoop", secs: 1.2 }, { op: "hook", name: "quarry.load", arg: it.id, kind: "basket" },
      { op: "go", x: heap.x + (r1 - 0.5) * 3, y: heap.y + (r2 - 0.5) * 3, near: 1.5 }, { op: "put", to: "pile", key: heap.key, kind: heap.kind }];
  }
  const pits = pitSpots(it), np = pitsOpen(cut), p = pits[Math.floor(hsh(id, 23) * np)], a = r1 * 6.283;
  const x = p[0] + Math.cos(a) * (p[2] + 0.5), y = p[1] + Math.sin(a) * (p[2] + 0.5);
  return [{ op: "go", x, y, near: 0.8 }, act, { op: "work", pose: "work_pick", secs: 7 + r2 * 6, x, y, face: [p[0], p[1]] }, act];
}
for (const r of LANE_RES) PLANNERS[`gather:${r}`] = plan;

// ---------------------------------------------------------------- town life: errands for a few villagers at home
const ERRAND = 0.1;    // share of the reserve that runs errands
export function wellOf(w, team) {
  const L = laborOf(w); let it = null; for (const x of L.items) if (x.kind === "well" && x.team === team) { it = x; break; }
  if (it) return it;
  const T = w.teams[team]; if (!T?.town) return null;
  const clear = (x, y) => {
    if (!w.map?.inBounds?.(x, y) || (w.map.water && w.map.water(x, y) > 0.05)) return false;
    for (const b of w.buildings) { if (b.ruin) continue; const fp = b.field ? [b.w, b.h] : BUILDINGS[b.kind]?.footprint || [8, 8]; if (b.x1 !== undefined) continue; if (Math.hypot(b.x - x, b.y - y) < Math.hypot(fp[0], fp[1]) / 2 + 5) return false; }
    if (w.obstacles) for (let dx = -3; dx <= 3; dx += 3) for (let dy = -3; dy <= 3; dy += 3) if (blocked(w.obstacles, x + dx, y + dy, 1)) return false;
    return true;
  };
  let at = null;
  for (let r = 22; r <= 80 && !at; r += 6) for (let k = 0; k < 16; k++) { const a = k / 16 * 6.283 + r * 0.37 + team, x = T.town.x + Math.cos(a) * r, y = T.town.y + Math.sin(a) * r; if (clear(x, y)) { at = [x, y]; break; } }
  if (!at) return null;
  it = addItem(w, { kind: "well", res: "water", kg: 0, x: at[0], y: at[1], team, key: `well:${team}`, rot: 0 });
  it.st = "well"; return it;
}
function doorOf(b, x, y) { const fp = BUILDINGS[b.kind]?.footprint || [8, 8], r = Math.hypot(fp[0], fp[1]) * 0.35 + 2, dx = x - b.x, dy = y - b.y, d = Math.hypot(dx, dy) || 1; return [b.x + dx / d * r, b.y + dy / d * r]; }
const prevHome = PLANNERS.home;   // (another lane's home work first, if any)
PLANNERS.home = (w, u, id, k, M, ctx) => {
  sweep(w);
  const prev = prevHome?.(w, u, id, k, M, ctx); if (prev?.length) return prev;
  const T = ctx.T; if (k < 2 || (T.store?.sheaves || 0) > 0 || hsh(id, 41) >= ERRAND) return null;
  if ((w.tick + id * 7) % 260 !== 0) return null;
  const S = w.S, x0 = S.x[id], y0 = S.y[id], ep = Math.floor(w.tick / 260), r = hsh(id, ep);
  if (r < 0.6) {   // water from the well, home with the pail
    const well = wellOf(w, u.team); if (!well || Math.hypot(well.x - x0, well.y - y0) > 260) return null;
    const a = hsh(id, ep + 5) * 6.283, wx = well.x + Math.cos(a) * 1.5, wy = well.y + Math.sin(a) * 1.5;
    return [{ op: "go", x: wx, y: wy, near: 0.6 }, { op: "work", pose: "work_bucket", secs: 5 + r * 4, face: [well.x, well.y] },
      { op: "hook", name: "town.take_pail" }, { op: "go", x: x0, y: y0, near: 1 }, { op: "hook", name: "town.pour" }];
  }
  // across to another building, a talk at its door, home again
  const bs = w.buildings.filter((b) => b.team === u.team && !b.field && b.x1 === undefined && !b.ruin && b.progress >= 1 && Math.hypot(b.x - x0, b.y - y0) < 220);
  if (!bs.length) return null;
  const b = bs[Math.floor(hsh(id, ep + 9) * bs.length)], [dx, dy] = doorOf(b, x0, y0), a = hsh(id, ep + 3) * 6.283;
  return [{ op: "go", x: dx + Math.cos(a) * 1.2, y: dy + Math.sin(a) * 1.2, near: 1 }, { op: "work", pose: "idle_talk", secs: 8 + r * 10, face: [b.x, b.y] }, { op: "go", x: x0, y: y0, near: 1.2 }];
};
HOOKS["town.take_pail"] = (w, id, M) => { if (!M.carry) M.carry = { kind: "pail", res: "water", kg: 0 }; };
// the villagers on errands (they count as working at home: economy.homeWork)
export function errandMen(w, u) { const L = w.labor; if (!L || !L.men.size) return 0; let n = 0; for (const id of u.members) if (L.men.get(id)?.task?.name === "home") n++; return n; }

// every ~minute: works whose crew has gone go onto their heaps; a pail left on the ground (an errand cut short) is gone
function sweep(w) {
  const Z = laneOf(w); if (w.tick < Z.sweep) return; Z.sweep = w.tick + 600;
  const L = w.labor;
  for (let k = L.items.length - 1; k >= 0; k--) { const it = L.items[k]; if (it.kind === "pail" && !(it.kg > 0)) removeItem(w, it); }
  for (const it of L.items) if (it.kind === "works" && it.kg > 0 && w.time - it.act > 120) flush(w, it);
}
