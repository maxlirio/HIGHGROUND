// Gathering lane B: FORESTRY & BOARDS (docs/gathering-plan.md). Deterministic (hashes, no dice), DOM-free, plain data.
//
// A timber crew in a wood (job gather:timber) works REAL TREES — the map's own (maps/<map>/vegetation.json, which
// obstacles.loadVegetation keeps as O.veg; tree = its index vi there):
//   FELLERS   walk to a tree, chop at its foot (work_axe) and fell it: its trunk stops being an obstacle, a TREE item
//             (key tree:<vi>, st "falling" → "down" → "logs") lies along the fall line and a STUMP item stays
//             (key stump:<vi>, st "stump" → "heap" once the brushwood is heaped → saplings "s1".."s6" → the tree stands
//             again, trunk and all; "gone" where the ground has been built on or ploughed).
//   LIMBERS   take the crown off a lying tree (work_axe along the trunk): "down" → "logs" (the renderer draws the bucked
//             logs and the brushwood).
//   BRUSHERS  heap the crown's limbs by the stump (work_stoop): "stump" → "heap".
//   SKIDDERS  drag a log from a limbed tree (carry kind "tree", hold "drag") to the landing — the site's pile at the
//             wood's edge (labor.landingSpot, key site:<node>:<team>); from there the core's carriers shoulder or cart the
//             logs to the store.
//   SAWYERS   (two of a big crew, when the crew's store is a lumber camp) fetch logs from the camp's store to the SAW-PIT
//             beside it (item key pit:<b>, kind "sawpit", its kg = the log on the trestles), rip them into boards
//             (work_saw), which pile up on the BOARD STACK by the pit (key boards:<b>, kind "boardstack", res "boards")
//             until one of them carries a bundle into the store (T.store.boards). Slabs go to the camp's firewood.
// The crew's cut (economy.gather, the analytic rate) goes onto the newest limbed tree of the wood (OUTPUT.timber): the
// felling cadence follows the output — a new tree is felled when the last one has given its timber (treeKg). A tree
// "stands for" several tonnes: at game speed an hour of work flies by in a real second (docs/gathering-plan.md).
// State: w.labor.forest = { felled: {vi: doy}, claim: {vi: man id}, next: tick of the next regrowth sweep, cv: felling version }; everything
// else is on the items (it.vi, it.node, it.lp, it.b), so the realm save and the realm clients (st, t0) carry it.
import { PLANNERS, HOOKS, ITEMS, OUTPUT, TICKS, laborOf, addItem, itemByKey, itemById, addKg, removeItem, sitePile, landingSpot,
  nearestStore, doorOf, lotFor, vizCount, stop, STOOP_S } from "../labor.js";
import { BODY_R, addCircle, blocked } from "../obstacles.js";
import { BUILDINGS, SAWING } from "../econ-data.js";
import * as TC from "../tech.js"; // (research: docs/tech.md)

// the trees a woodman fells (the rest of vegetation.json is bushes, hedges, orchards, dead wood): height (m, the models'
// own at scale 1) and how much timber the tree stands for relative to an oak
const inFieldRect = (b, x, y, m = 0) => { const r = b.rot || 0, c = Math.cos(r), s = Math.sin(r), dx = x - b.x, dy = y - b.y; return Math.abs(dx * c + dy * s) < b.w / 2 + m && Math.abs(dy * c - dx * s) < b.h / 2 + m; }; // (a field lies at its furlong's angle)
export const TREES = { oak_a: { h: 19.3, m: 1 }, oak_b: { h: 18.8, m: 1 }, oak_c: { h: 19.2, m: 1 }, pine: { h: 21.7, m: 0.75 }, birch: { h: 16.7, m: 0.45 }, alder: { h: 14.8, m: 0.45 }, willow: { h: 10.2, m: 0.35 } };
export const TREE_KG = 8000;           // kg of the crew's cut an oak of scale 1 stands for (the felling cadence; EST, visual)
export const FALL_S = 3.4;             // seconds a tree takes to come down (render: js/render/jobs/forestry.js)
export const REGROW = { sapling: 30, grown: 160, stages: 6 };  // econ days after the felling: a sapling shows / the tree stands again
const REACH = 2.5;                     // trees within REACH × the wood's radius (≤ 120 m) belong to its crew

ITEMS.tree = { res: "timber", hold: "drag", slow: 0.7, kg: 250, piece: 700 };           // a felled tree / a log dragged on a rope
ITEMS.stump = { res: "stump", hold: "front", slow: 1, kg: 0, piece: 1e9 };              // (kg 0: a marker the realm syncs)
ITEMS.sawpit = { res: "timber", hold: "shoulder", slow: 0.85, kg: 60, piece: 120 };      // the log on the trestles
ITEMS.boardstack = { res: "boards", hold: "shoulder", slow: 0.9, kg: 40, piece: 180 };   // fresh-sawn boards by the pit

const F = (w) => (laborOf(w).forest ||= { felled: {}, claim: {}, next: 0 });
const hsh = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };
const doy = (w) => w.econ?.doy ?? w.time / 86400;
export const treeH = (v) => (TREES[v.asset]?.h || 15) * (v.scale || 1);
export const treeKg = (v) => TREE_KG * (TREES[v.asset]?.m || 0.5) * (v.scale || 1) ** 2;
const trunkR = (v) => (BODY_R[v.asset] ?? 0.4) * (v.scale || 1);

// ---------------------------------------------------------------- the wood's trees (static map data, cached per node)
const cands = new Map();   // `${node.id}|${x}|${y}` → [vi] nearest the wood's working edge first
function treesOf(w, node, store) {
  const veg = w.obstacles?.veg; if (!veg) return null;
  // the crew works in from the wood's edge by its landing (so the clearing opens where the logs go out)
  const [ex, ey] = store ? landing(w, node, -1, store, null) : [node.x, node.y];
  const key = `${veg.length}|${node.id}|${Math.round(ex)}|${Math.round(ey)}`;
  let L = cands.get(key); if (L) return L;
  const R = Math.min(120, node.r * REACH), out = [];
  for (let i = 0; i < veg.length; i++) { const v = veg[i]; if (!TREES[v.asset]) continue; const d = Math.hypot(v.x - node.x, v.y - node.y); if (d < R) out.push([Math.hypot(v.x - ex, v.y - ey), i]); }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  L = out.map((e) => e[1]); cands.set(key, L); return L;
}
// the trunk leaves / comes back to the obstacle grid (obstacles.js: circles bucketed in 8 m cells)
function dropTrunk(O, v) {
  const b = O.circles.get(((v.x / 8) | 0) * 100000 + ((v.y / 8) | 0)); if (!b) return;
  for (let k = 0; k < b.length; k += 3) if (b[k] === v.x && b[k + 1] === v.y) { b.splice(k, 3); O.count--; return; }
}

// ---------------------------------------------------------------- the wood's state for a team
function woodState(w, node, team) {
  const L = w.labor, trees = [], chop = [], work = new Map();   // work: item id → { limb, skid }
  for (const it of L?.items || []) if (it.kind === "tree" && it.node === node.id && it.team === team) trees.push(it);
  for (const [, M] of L?.men || []) {
    const t = M.task, g = tagOf(M); if (!t || M.team !== team || !g) continue;
    if (g === "fell") { const a = t.steps[1]?.arg; if (a?.node === node.id) chop.push(a.vi); continue; }
    if (g === "limb" || g === "skid" || g === "brush") { const tid = t.steps[0].item; const e = work.get(tid) || { limb: 0, skid: 0, brush: 0 }; e[g]++; work.set(tid, e); }
  }
  let cur = null; for (const it of trees) if (it.st === "logs" && !it.loose && (!cur || it.id > cur.id)) cur = it;
  return { trees, chop, work, cur };
}
// a task's role is tagged on its first step (economy.laborMan names every task after the job: "gather")
const tagOf = (M) => M.task?.steps[0]?.tag;
const tag = (name, steps, extra = {}) => { Object.assign(steps[0], { tag: name }, extra); return steps; };
const vegOf = (w, it) => w.obstacles?.veg?.[it.vi];
function landing(w, node, team, store, pile) {
  if (pile) return [pile.x, pile.y, pile.rot];
  const [px, py] = landingSpot(w, node.x, node.y, store.x, store.y, node.r * 2.5);
  return [px, py, Math.atan2(store.y - node.y, store.x - node.x) + Math.PI / 2];   // (economy.gather makes the same pile)
}

// ---------------------------------------------------------------- the crew's planner
PLANNERS["gather:timber"] = function forestPlan(w, u, id, k, M, ctx) {
  const node = ctx.job.node, O = w.obstacles; if (!node || node.amount <= 0 || !O?.veg) return null;
  const T = ctx.T, team = u.team, S = w.S;
  const store = u.store || nearestStore(w, team, "timber", node.x, node.y); if (!store) return null;
  const n = u.members.length, cutters = n - (ctx.nHaul || 0);
  // two of a big crew saw boards at the lumber camp's pit
  if (cutters >= 5 && k >= n - 2) { const s = sawPlan(w, u, id, T, store, k === n - 1 ? 1 : -1); if (s) return s; }
  const st = woodState(w, node, team), Fo = F(w);
  // 1. fell: keep two or three trees in hand (chopping, lying, or limbed and not yet given their timber)
  const fellMax = Math.max(1, Math.min(3, Math.round(cutters / 4)));
  const pending = st.chop.length + st.trees.filter((t) => !t.loose && (t.st !== "logs" || (t.got || 0) < capOf(w, t))).length;
  if (st.chop.length < fellMax && pending < (cutters >= 10 ? 3 : 2)) {
    const vi = pickTree(w, node, store, Fo);
    if (vi >= 0) return fellPlan(w, id, node, store, vi, Fo);
  }
  // 2. limb a tree that is down
  for (const t of st.trees) if (t.st === "down" && (st.work.get(t.id)?.limb || 0) < 2) { const v = vegOf(w, t); if (v) return limbPlan(w, id, t, v, (st.work.get(t.id)?.limb || 0)); }
  // 3. skid a log from a limbed tree to the landing
  let best = null, bd = Infinity;
  for (const t of st.trees) { if (t.st !== "logs" || t.claim || (st.work.get(t.id)?.skid || 0) >= 3 || !(t.kg >= ITEMS.tree.kg || ((t.got || 0) >= capOf(w, t) && t.kg > 0))) continue; const d = Math.hypot(t.x - S.x[id], t.y - S.y[id]) + (t === st.cur ? 30 : 0); if (d < bd) { bd = d; best = t; } }
  if (best) return skidPlan(w, id, T, node, team, store, ctx.pile, best);
  // 4. heap the brushwood the limbers left (two men to a crown), buck the logs of a limbed tree; else stand by the felling
  let lop = null, ld = Infinity;
  for (const it of w.labor.items) {
    if (it.kind !== "stump" || it.st !== "stump" || it.team !== team || it.node !== node.id || (st.work.get(it.id)?.brush || 0) >= 2) continue;
    if (st.trees.some((t) => t.vi === it.vi && t.st !== "logs")) continue;
    const d = Math.hypot(it.x - S.x[id], it.y - S.y[id]); if (d < ld) { ld = d; lop = it; }
  }
  if (lop) { const v = O.veg[lop.vi]; if (v) return brushPlan(w, id, lop, v, st.work.get(lop.id)?.brush || 0); }
  const busy = st.trees.filter((t) => t.st === "logs");
  if (busy.length) { const t = busy[(id + (w.tick >> 6)) % busy.length], v = vegOf(w, t); if (v) return buckPlan(w, id, t, v); }
  const lying = st.trees.filter((t) => t.st === "down" || t.st === "falling");
  if (lying.length) { const t = lying[id % lying.length], v = vegOf(w, t); if (v) return buckPlan(w, id, t, v); }
  if (st.chop.length) { const v = O.veg[st.chop[0]]; if (v) { const a = hsh(id, w.tick >> 7) * 6.283, r = treeH(v) * 1.2; return tag("stand", [{ op: "go", x: v.x + Math.cos(a) * r, y: v.y + Math.sin(a) * r, near: 2 }, { op: "wait", secs: 6 }]); } }
  return null;
};
// the next standing tree of the wood nobody is felling (the crews work in from the edge nearest their store)
function pickTree(w, node, store, Fo) {
  const L = treesOf(w, node, store); if (!L) return -1;
  for (const vi of L) {
    if (Fo.felled[vi] !== undefined) continue;
    const c = Fo.claim[vi];
    if (c !== undefined) { const M = w.labor.men.get(c); if (tagOf(M || {}) === "fell" && M.task.steps[1]?.arg?.vi === vi) continue; delete Fo.claim[vi]; }
    return vi;
  }
  return -1;
}
function fellPlan(w, id, node, store, vi, Fo) {
  const v = w.obstacles.veg[vi], S = w.S;
  // fall away from the thick of the wood, toward the landing side, ± 60°
  const a0 = Math.atan2(v.y - node.y, v.x - node.x), a1 = Math.atan2(store.y - v.y, store.x - v.x);
  const dir = Math.atan2(Math.sin(a0) + 1.5 * Math.sin(a1), Math.cos(a0) + 1.5 * Math.cos(a1)) + (hsh(vi, 5) - 0.5) * 2.1;
  // he stands on the far side of the fall, facing the trunk (the back cut); a little round to his own side
  const side = hsh(vi, 9) < 0.5 ? -0.5 : 0.5, sa = dir + Math.PI + side, r = trunkR(v) + 0.5;
  const sx = v.x + Math.cos(sa) * r, sy = v.y + Math.sin(sa) * r;
  Fo.claim[vi] = id;
  const secs = 24 + 14 * hsh(vi, 3) * (v.scale || 1);
  return tag("fell", [
    { op: "go", x: sx, y: sy, near: 0.5 },
    { op: "work", pose: "work_axe", secs, x: sx, y: sy, face: [v.x, v.y], hook: "forest.fell", arg: { vi, node: node.id, dir } },
    { op: "wait", secs: FALL_S + 0.8, face: [v.x + Math.cos(dir) * 8, v.y + Math.sin(dir) * 8] },
    { op: "hook", name: "forest.landed", arg: { vi } },
    { op: "go", x: v.x + Math.cos(dir + Math.PI) * 3, y: v.y + Math.sin(dir + Math.PI) * 3, near: 1.5 },
  ]);
}
function limbPlan(w, id, t, v, nth) {
  const H = treeH(v), f = nth ? 0.72 : 0.5, side = (nth ? 1 : -1) * 1.3, c = Math.cos(t.rot), s = Math.sin(t.rot);
  const px = t.x + c * H * f, py = t.y + s * H * f, sx = px - s * side, sy = py + c * side;
  return tag("limb", [{ op: "go", x: sx, y: sy, near: 0.8 }, { op: "work", pose: "work_axe", secs: 14 + 4 * hsh(id, t.id), x: sx, y: sy, face: [px, py], hook: "forest.limb", arg: { item: t.id } }], { item: t.id });
}
function buckPlan(w, id, t, v) {
  const H = treeH(v) * 0.55, j = Math.floor(hsh(id, w.tick >> 5) * 3), f = (j + 1) / 4, side = hsh(id, 7) < 0.5 ? -1.1 : 1.1, c = Math.cos(t.rot), s = Math.sin(t.rot);
  const px = t.x + c * (1 + H * f), py = t.y + s * (1 + H * f), sx = px - s * side, sy = py + c * side;
  return tag("buck", [{ op: "go", x: sx, y: sy, near: 0.8 }, { op: "work", pose: "work_axe", secs: 10 + 6 * hsh(id, 11), x: sx, y: sy, face: [px, py] }]);
}
function brushPlan(w, id, it, v, nth) {   // gather the crown's limbs into a heap: stoop, drag, stoop
  const H = treeH(v), c = Math.cos(it.rot), s = Math.sin(it.rot), side = nth ? 1.6 : -1.6;
  const px = it.x + c * H * 0.62, py = it.y + s * H * 0.62, ax = px + c * 3 - s * side * 1.8, ay = py + s * 3 + c * side * 1.8, bx = px - s * side, by = py + c * side;
  return tag("brush", [{ op: "go", x: ax, y: ay, near: 0.8 }, { op: "work", pose: "work_stoop", secs: STOOP_S * 3, face: [px, py] }, { op: "go", x: bx, y: by, near: 0.6 },
    { op: "work", pose: "work_stoop", secs: STOOP_S * 3, face: [px, py], hook: "forest.brush", arg: { item: it.id } }], { item: it.id });
}
function skidPlan(w, id, T, node, team, store, pile, t) {
  const v = vegOf(w, t), H = v ? treeH(v) * 0.55 : 8, c = Math.cos(t.rot), s = Math.sin(t.rot);
  const [lx, ly, lrot] = landing(w, node, team, store, pile);
  const lot = Math.min(lotFor(w, T, Math.hypot(lx - t.x, ly - t.y), "tree"), Math.max(ITEMS.tree.kg, capOf(w, t) / 3));
  return tag("skid", [
    { op: "go", x: t.x + c * (H + 1.2), y: t.y + s * (H + 1.2), near: 1.2 },
    { op: "take", item: t.id, kg: Math.min(lot, t.kg) },
    { op: "go", x: lx, y: ly, near: 2.2 },
    { op: "put", to: "pile", key: `site:${node.id}:${team}`, kind: "log", x: lx, y: ly, rot: lrot },
  ], { item: t.id });
}

// ---------------------------------------------------------------- what the work changes
HOOKS["forest.fell"] = (w, id, M, step) => {
  const { vi, node, dir } = step.arg, Fo = F(w), O = w.obstacles, v = O?.veg?.[vi];
  if (Fo.claim[vi] === id) delete Fo.claim[vi];
  if (!v || Fo.felled[vi] !== undefined) return;
  Fo.felled[vi] = doy(w);
  dropTrunk(O, v);   // (a felled tree no longer stands in anyone's way)
  touched(w);        // (nor gives cover, nor hides anyone: the canopy over it thins)
  const t = addItem(w, { kind: "tree", res: "timber", kg: 0, x: v.x, y: v.y, team: M.team, key: `tree:${vi}`, rot: dir });
  Object.assign(t, { st: "falling", t0: w.time, vi, node });
  const s = addItem(w, { kind: "stump", res: "stump", kg: 0, x: v.x, y: v.y, team: M.team, key: `stump:${vi}`, rot: dir });
  Object.assign(s, { st: "stump", t0: w.time, vi, node });
  w.events?.push({ t: w.tick, kind: "tree-felled", x: v.x, y: v.y, team: M.team });
};
HOOKS["forest.brush"] = (w, id, M, step) => { const it = itemById(w, step.arg.item); if (!it || it.st !== "stump") return; it.bp = (it.bp || 0) + 1; if (it.bp >= 2) { it.st = "heap"; w.labor.ver++; } };
HOOKS["forest.landed"] = (w, id, M, step) => { const t = itemByKey(w, `tree:${step.arg.vi}`); if (t?.st === "falling") { t.st = "down"; w.labor.ver++; } };
HOOKS["forest.limb"] = (w, id, M, step) => {
  const t = itemById(w, step.arg.item); if (!t || t.kind !== "tree") return;
  if (t.st === "falling") t.st = "down";
  t.lp = (t.lp || 0) + 1;
  if (t.lp >= 2 && t.st === "down") { t.st = "logs"; t.t0 = w.time; w.labor.ver++; }
};

// the crew's cut lies on the limbed trees of the wood, each up to what it stands for (treeKg), the oldest first; what the
// fellers have not caught up with is stacked at the landing (as the core would)
const capOf = (w, t) => treeKg(vegOf(w, t) || {});
OUTPUT.timber = (w, u, node, kg, store) => {
  if (!node || !w.obstacles?.veg) return false;
  const st = woodState(w, node, u.team);
  let left = kg;
  for (const t of st.trees) {
    if (t.st !== "logs" || t.loose) continue;
    const a = Math.min(left, capOf(w, t) - (t.got || 0)); if (a <= 0) continue;
    addKg(w, t, a); t.got = (t.got || 0) + a; left -= a; if (left <= 1e-9) break;
  }
  if (node.amount <= 0) for (const t of st.trees) if (t.kg > 0) { t.loose = true; if (t.st !== "logs") t.st = "logs"; }   // (felled out: the reserve fetches the rest home)
  if (left > 1e-9) {
    if (!store) { if (left === kg) return false; addKg(w, st.trees.find((t) => t.st === "logs") || st.trees[0], left); return true; }
    const key = `site:${node.id}:${u.team}`, [lx, ly, lr] = landing(w, node, u.team, store, itemByKey(w, key));
    addKg(w, sitePile(w, key, "log", lx, ly, u.team, lr), left);
  }
  return true;
};

// ---------------------------------------------------------------- the saw-pit
// beside the lumber camp, on open ground, the log along the camp's side (made the first time a sawyer comes)
function pitOf(w, b, team) {
  const key = `pit:${b.id}`; let p = itemByKey(w, key); if (p) return p;
  const O = w.obstacles, fp = BUILDINGS[b.kind]?.footprint || [10, 8], R = Math.hypot(fp[0], fp[1]) / 2 + 5.5;
  const free = (x, y) => (!O || !blocked(O, x, y, 1.6)) && !w.buildings.some((o) => o !== b && !o.ruin && Math.hypot(o.x - x, o.y - y) < (o.field ? Math.hypot(o.w || 0, o.h || 0) / 2 + 4 : Math.hypot(...(BUILDINGS[o.kind]?.footprint || [8, 8])) / 2 + 4));
  let best = null;
  for (let j = 0; j < 16 && !best; j++) {
    const a = (b.rot || 0) + Math.PI / 2 + (j % 2 ? 1 : -1) * Math.ceil(j / 2) * Math.PI / 8, x = b.x + Math.cos(a) * R, y = b.y + Math.sin(a) * R, r = a + Math.PI / 2;
    if ([-3.5, 0, 3.5].every((d) => free(x + Math.cos(r) * d, y + Math.sin(r) * d)) && free(x + Math.cos(a) * 3, y + Math.sin(a) * 3)) best = [x, y, r];
  }
  if (!best) { const a = (b.rot || 0) + Math.PI / 2; best = [b.x + Math.cos(a) * R, b.y + Math.sin(a) * R, a + Math.PI / 2]; }
  p = addItem(w, { kind: "sawpit", res: "timber", kg: 0, x: best[0], y: best[1], team, key, rot: best[2] });
  Object.assign(p, { st: "idle", t0: w.time, b: b.id });
  return p;
}
const stackKey = (b) => `boards:${b.id}`;
function stackSpot(p) { const c = Math.cos(p.rot), s = Math.sin(p.rot); return [p.x - s * 3.4 + c * 0.5, p.y + c * 3.4 + s * 0.5]; }
function sawPlan(w, u, id, T, b, side) {
  if (b.kind !== "lumber_camp" || b.progress < 1 || b.ruin) return null;
  const p = pitOf(w, b, u.team), stack = itemByKey(w, stackKey(b)), have = (T.store.boards || 0) + (stack?.kg || 0);
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  const want = have < SAWING.target, spare = (T.store.timber || 0) > SAWING.minTimber;
  let mate = null; for (const [j, M] of w.labor.men) if (j !== id && M.team === u.team && M.task?.steps[0]?.pit === p.id) mate = tagOf(M);
  // carry a bundle of boards into the store (the stack is by the pit; the store is a few steps away)
  if (stack && stack.kg >= SAWING.stackCarry && mate !== "sawcarry") {
    const [dx, dy] = doorOf(b, stack.x, stack.y);
    return tag("sawcarry", [{ op: "go", x: stack.x + s * 1.2, y: stack.y - c * 1.2, near: 1 }, { op: "take", item: stack.id, kg: Math.min(stack.kg, lotFor(w, T, Math.hypot(dx - stack.x, dy - stack.y), "boardstack")) }, { op: "go", x: dx, y: dy, near: 1.5 }, { op: "put", to: "store", b: b.id }], { pit: p.id });
  }
  if (!want && p.kg <= 0) return null;
  // fetch a log from the camp's store to the trestles
  if (p.kg < SAWING.loadKg * 0.3 && want && spare && mate !== "sawfetch") {
    const [dx, dy] = doorOf(b, p.x, p.y);
    return tag("sawfetch", [{ op: "go", x: dx, y: dy, near: 1.5 }, { op: "wait", secs: STOOP_S, pose: "work_stoop" }, { op: "hook", name: "forest.fromStore", arg: { b: b.id } },
      { op: "go", x: p.x + c * 2.6, y: p.y + s * 2.6, near: 1 }, { op: "put", to: "pile", key: p.key, kind: "sawpit" }], { pit: p.id });
  }
  if (p.kg <= 0) return tag("sawwait", [{ op: "go", x: p.x - s * 1.6 * side, y: p.y + c * 1.6 * side, near: 1 }, { op: "wait", secs: 4 }], { pit: p.id });
  // saw: one each side of the log on the trestles, facing it, a little apart along it
  const ax = p.x + c * 0.8 * side, ay = p.y + s * 0.8 * side, sx = ax - s * 0.95 * side, sy = ay + c * 0.95 * side;
  return tag("saw", [{ op: "go", x: sx, y: sy, near: 0.5 }, { op: "work", pose: "work_saw", secs: 18 + 4 * hsh(id, 3), x: sx, y: sy, face: [ax, ay], hook: "forest.saw", arg: { pit: p.id, b: b.id } }], { pit: p.id });
}
HOOKS["forest.fromStore"] = (w, id, M, step) => {
  const T = w.teams[M.team], kg = Math.min(SAWING.loadKg, Math.max(0, (T.store.timber || 0) - SAWING.minTimber * 0.5));
  if (kg <= 0 || M.carry) { stop(w, id); return; }
  T.store.timber -= kg; M.carry = { kind: "log", res: "timber", kg };
};
HOOKS["forest.saw"] = (w, id, M, step) => {
  const p = itemById(w, step.arg.pit), b = w.buildings.find((x) => x.id === step.arg.b), T = w.teams[M.team];
  if (!p || !b || p.kg <= 0) return;
  const kg = Math.min(p.kg, M.md * SAWING.timberPerManDay * TC.mul(w, M.team, "saw")); // (research: the water-powered saw)
  p.kg -= kg; if (p.kg < 1e-6) p.kg = 0;
  const n = vizCount("sawpit", p.kg); if (n !== p.n) { p.n = n; w.labor.ver++; }
  const [sx, sy] = stackSpot(p);
  addKg(w, sitePile(w, stackKey(b), "boardstack", sx, sy, M.team, p.rot), kg * SAWING.boardYield);
  T.store.firewood = (T.store.firewood || 0) + kg * SAWING.slabYield;   // (the slabs: firewood at the camp)
  (T.stats ||= {}).sawn = (T.stats.sawn || 0) + kg * SAWING.boardYield;
};

// ---------------------------------------------------------------- the canopy follows the trees
// The land's canopy layer (map.canopyGrid, m of canopy per ~4 m cell; map.land.veg/vegD are read from it: cover for
// arrows, concealment, the going and charges in woods, sight lines through vision) is thinned where trees are felled
// and made whole again where they grow back. Each cell keeps its map value scaled by how much of its crown cover still
// stands: cover = 1 − Π(1 − wᵢ) over the crowns reaching it (wᵢ = 1 − d/R, R the crown's radius), standing / all,
// eased so that under ~30 % of the crown left the cell is open ground and over ~75 % it is wood as before. Only
// the cells under a changed tree's crown are touched. The map is shared static data (not saved; one per process, the
// realm server's worlds and tests share it), so the change is kept on the map (map.__clr: the cells' map values, which
// world's felling is applied) and re-applied from w.labor.forest.felled whenever another world — or a restored one —
// steps (syncCanopy). A world with nothing felled sees the map as it is: battles nobody is chopping in are unchanged.
export const CROWN = { oak_a: 10, oak_b: 9.5, oak_c: 9.5, pine: 6, birch: 5.5, alder: 5.5, willow: 5, fruit_tree: 4, dead_tree: 4, bush: 2.5, hedge_shrub: 2.5, log: 0, oak_stump: 0 };
const crownR = (v) => (CROWN[v.asset] ?? 3) * (v.scale || 1);
const treeGrids = new WeakMap();   // tree list → 16 m bucket grid of its indices
function treeGrid(list) {
  let G = treeGrids.get(list); if (G) return G;
  G = new Map(); for (let i = 0; i < list.length; i++) { const v = list[i], k = Math.floor(v.x / 16) * 65536 + Math.floor(v.y / 16); let b = G.get(k); if (!b) G.set(k, (b = [])); b.push(i); }
  treeGrids.set(list, G); return G;
}
function clrOf(map) { if (!map.__clr) Object.defineProperty(map, "__clr", { value: { owner: null, orig: new Map(), applied: new Set(), ver: -1 }, enumerable: false, writable: true }); return map.__clr; }
function setCell(map, k, v) {
  map.canopyGrid[k] = v; const L = map.land;
  if (L) { L.veg[k] = v; L.vegD[k] = Math.min(1, v / 14); if (L.syncCell) L.syncCell(k); else if (L.cache) L.cache[k] = undefined; }
}
// recompute the cells under the crowns of trees `dirty` (indices into `list`), `felled(i)` = is tree i down
export function clearCells(map, list, felled, dirty) {
  const can = map.canopyGrid; if (!can) return 0;
  const C = clrOf(map), G = treeGrid(list), res = map.res, cell = map.cell, X0 = map.x0 || 0, Y0 = map.y0 || 0, done = new Set(); let n = 0;
  for (const t of dirty) {
    const v = list[t]; if (!v) continue; const R = crownR(v);
    const i0 = Math.max(0, Math.floor((v.x - R - X0) / cell)), i1 = Math.min(res - 1, Math.ceil((v.x + R - X0) / cell));
    const j0 = Math.max(0, Math.floor((v.y - R - Y0) / cell)), j1 = Math.min(res - 1, Math.ceil((v.y + R - Y0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * res + i; if (done.has(k)) continue;
      const x = X0 + i * cell, y = Y0 + j * cell; if (Math.hypot(x - v.x, y - v.y) > R) continue;
      done.add(k);
      if (!C.orig.has(k)) C.orig.set(k, can[k]);
      const o = C.orig.get(k); if (!o) continue;
      let all = 1, now = 1;
      for (let gy = Math.floor((y - 12) / 16); gy <= Math.floor((y + 12) / 16); gy++) for (let gx = Math.floor((x - 12) / 16); gx <= Math.floor((x + 12) / 16); gx++) {
        const b = G.get(gx * 65536 + gy); if (!b) continue;
        for (const q of b) { const u = list[q], r = crownR(u); if (r <= 0) continue; const d = Math.hypot(u.x - x, u.y - y); if (d >= r) continue; const wq = 1 - d / r; all *= 1 - wq; if (!felled(q)) now *= 1 - wq; }
      }
      // (the canopy is a height sight lines must clear: a wood thinned past half its crown is gaps, not a lower roof)
      const cov = 1 - all, r = cov > 1e-6 ? (1 - now) / cov : 1, e = Math.min(1, Math.max(0, (r - 0.3) / 0.45)), val = Math.round(o * e * e * (3 - 2 * e));
      if (can[k] !== val) { setCell(map, k, val); n++; }
    }
  }
  return n;
}
// (tests: the map as it was loaded, as a fresh process would have it)
export function resetCanopy(map) { const C = map.__clr; if (C) { revertAll(map, C); C.owner = null; C.ver = -1; } }
function revertAll(map, C) { for (const [k, o] of C.orig) if (map.canopyGrid[k] !== o) setCell(map, k, o); C.applied = new Set(); }
// bring the map's canopy to this world's felling (cheap when nothing changed)
export function syncCanopy(w) {
  const map = w.map, veg = w.obstacles?.veg; if (!map?.canopyGrid || !veg) return;
  const Fo = w.labor?.forest, C = map.__clr;
  if (!C && !Fo) return;
  const K = clrOf(map);
  if (K.owner !== w) { revertAll(map, K); K.owner = w; K.ver = -1; }
  if (!Fo || K.ver === Fo.cv) return;
  const dirty = [];
  for (const k in Fo.felled) { const vi = +k; if (!K.applied.has(vi)) { K.applied.add(vi); dirty.push(vi); } }
  for (const vi of [...K.applied]) if (Fo.felled[vi] === undefined) { K.applied.delete(vi); dirty.push(vi); }
  if (dirty.length) clearCells(map, veg, (q) => Fo.felled[q] !== undefined, dirty);
  K.ver = Fo.cv;
}
const touched = (w) => { const Fo = F(w); Fo.cv = (Fo.cv || 0) + 1; syncCanopy(w); };

// ---------------------------------------------------------------- the woods grow back (econ time), once in a while
TICKS.forestry = (w) => {
  syncCanopy(w);
  const L = w.labor; if (!L?.forest || w.tick < L.forest.next) return;
  L.forest.next = w.tick + 97;
  const Fo = L.forest, now = doy(w), O = w.obstacles, veg = O?.veg; if (!veg) return;
  for (let k = L.items.length - 1; k >= 0; k--) {
    const it = L.items[k]; if (it.kind !== "stump" || it.st === "gone") continue;
    const age = now - (Fo.felled[it.vi] ?? now);
    if (age < REGROW.sapling) continue;
    const v = veg[it.vi]; if (!v) continue;
    // ground built on or ploughed: nothing grows back there (a building's ground, ruin or not, as the grubbing has it: built())
    const covered = w.buildings.some((b) => b.field ? !b.ruin && inFieldRect(b, v.x, v.y, 2) : built(b, v.x, v.y));
    if (covered) { it.st = "gone"; L.ver++; continue; }
    if (age < REGROW.grown) { const s = `s${1 + Math.min(REGROW.stages - 1, Math.floor((age - REGROW.sapling) / ((REGROW.grown - REGROW.sapling) / REGROW.stages)))}`; if (it.st !== s) { it.st = s; L.ver++; } continue; }
    if (itemByKey(w, `tree:${it.vi}`)) continue;             // (the old trunk still lies across the spot)
    if (O && blocked(O, v.x, v.y, 0.2)) { it.st = "gone"; L.ver++; continue; }
    addCircle(O, v.x, v.y, trunkR(v));                        // a grown tree again: it stands in men's way as before
    delete Fo.felled[it.vi]; removeItem(w, it); Fo.cv = (Fo.cv || 0) + 1;
  }
  syncCanopy(w);
};
// ---------------------------------------------------------------- built-on ground is grubbed
// Nobody builds round a bush: the map's trees, bushes and deadwood standing on a building's ground — its model's own
// box (assets/footprints.json, as commands.solidBuildings makes it solid; the economy's footprint where no model was
// measured), GRUB_PAD m round it — are grubbed up the first time the building stands in a world: staked out by a player
// or an AI, laid out prebuilt, or already standing in a saved world when it is restored (b.grub marks it done, and is
// saved). As for a ploughed field (sim/jobs/fields.js clearGround): the trunk leaves the obstacle grid and the tree is
// entered in the felling ledger with no stump, so nobody fells it again, the canopy over it thins, and nothing regrows
// there (a stump already there, from an earlier felling, is "gone" under the regrowth rule above). The renderer hides
// the same instances by the same rects (render/jobs/forestry.js → props.clearArea), and keeps the undergrowth out of
// the building's yard (BUILT_YARD m round it).
export const GRUB_PAD = 3, BUILT_YARD = 5;
let MEASURED = null;   // assets/footprints.json (static data: set once by whoever loaded it — commands.commandSystems, the renderer)
export function setFootprints(m) { if (m && typeof m === "object" && Object.keys(m).length) MEASURED = m; }
export const footprintsSet = () => !!MEASURED;
const MODEL_OF = { paddock: "horse_paddock" };
const modelOf = (b) => b.kind === "house" ? ["house_a", "house_b", "house_c"][b.id % 3] : MODEL_OF[b.kind] || b.kind;
const rect = (x, y, rot, hx, hy) => ({ x, y, c: Math.cos(rot), s: Math.sin(rot), hx, hy });
// the ground a building stands on, `pad` m round it → [{ x, y, c, s, hx, hy }] (sim plane; x along rot)
export function buildingRects(b, pad = 0) {
  const out = [], line = (x1, y1, x2, y2, half) => out.push(rect((x1 + x2) / 2, (y1 + y2) / 2, Math.atan2(y2 - y1, x2 - x1), Math.hypot(x2 - x1, y2 - y1) / 2 + pad, half + pad));
  if (b.x1 !== undefined) { line(b.x1, b.y1, b.x2, b.y2, 2); return out; }   // a wall stretch (palisade and its ditch, a stone curtain)
  const rot = b.rot || 0, m = MEASURED?.[modelOf(b)];
  if (m) {
    const lx = (m[0] + m[1]) / 2, ly = (m[2] + m[3]) / 2, c = Math.cos(rot), s = Math.sin(rot);
    out.push(rect(b.x + lx * c - ly * s, b.y + lx * s + ly * c, rot, (m[1] - m[0]) / 2 + pad, (m[3] - m[2]) / 2 + pad));
  } else { const fp = BUILDINGS[b.kind]?.footprint || [8, 8]; out.push(rect(b.x, b.y, rot, fp[0] / 2 + pad, fp[1] / 2 + pad)); }
  if (b.gx1 !== undefined) line(b.gx1, b.gy1, b.gx2, b.gy2, 2);   // a gate closes its stretch of the circuit (render/buildings.js draws the flanks)
  return out;
}
export const inRects = (R, x, y) => { for (const r of R) { const dx = x - r.x, dy = y - r.y; if (Math.abs(dx * r.c + dy * r.s) < r.hx && Math.abs(-dx * r.s + dy * r.c) < r.hy) return true; } return false; };
export function rectsBox(R) {   // → [x0, y0, x1, y1]
  const B = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of R) { const ex = Math.abs(r.c) * r.hx + Math.abs(r.s) * r.hy, ey = Math.abs(r.s) * r.hx + Math.abs(r.c) * r.hy; B[0] = Math.min(B[0], r.x - ex); B[1] = Math.min(B[1], r.y - ey); B[2] = Math.max(B[2], r.x + ex); B[3] = Math.max(B[3], r.y + ey); }
  return B;
}
const built = (b, x, y) => inRects(buildingRects(b, GRUB_PAD), x, y);
export function grubBuildings(w) {
  const O = w.obstacles, veg = O?.veg; if (!veg || !w.buildings?.length) return 0;
  let n = 0, Fo = null; const G = treeGrid(veg), day = doy(w);
  for (const b of w.buildings) {
    if (b.field || b.grub) continue;   // (a field clears its own ground: sim/jobs/fields.js)
    b.grub = 1;
    const R = buildingRects(b, GRUB_PAD), B = rectsBox(R);
    for (let gx = Math.floor(B[0] / 16); gx <= Math.floor(B[2] / 16); gx++) for (let gy = Math.floor(B[1] / 16); gy <= Math.floor(B[3] / 16); gy++) {
      const bk = G.get(gx * 65536 + gy); if (!bk) continue;
      for (const vi of bk) {
        const v = veg[vi]; if (!inRects(R, v.x, v.y)) continue;
        Fo ||= F(w); if (Fo.felled[vi] !== undefined) continue;
        if (Fo.claim[vi] !== undefined) delete Fo.claim[vi];   // (a feller walking to it finds it gone: forest.fell skips a felled tree)
        dropTrunk(O, v); Fo.felled[vi] = day; n++;
      }
    }
  }
  if (n) touched(w);
  return n;
}
TICKS.grub = (w) => { if (w.tick % 10 === 0) grubBuildings(w); };

// (balance checks: HG_NO_FORESTRY=1 runs the old analytic woods, for a before/after timeline — tools/playtest.mjs)
if (globalThis.HG_NO_FORESTRY || (typeof process !== "undefined" && process.env?.HG_NO_FORESTRY)) { delete PLANNERS["gather:timber"]; delete OUTPUT.timber; delete TICKS.forestry; }
