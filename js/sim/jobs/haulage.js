// Gathering lane D: STOREHOUSE & BUILD LOGISTICS (docs/gathering-plan.md). Deterministic, DOM-free, plain data only.
//
// THE STORES. Goods a carrier sets down at a store count in T.store at once (labor.js `put to:"store"`, the core's rule);
// what this lane adds is the picture of what happens next: STOREMEN (a small crew per store, job {kind:"store", b},
// assigned by the reeve) take the loads in at the intake heap by the door, pack them (grain into sacks, meat and fish into
// barrels, logs racked, boards stacked) and carry them to the YARD STACKS, which grow and shrink with the team's real
// stock. Goods drawn out — the builders' materials, the rations — leave the stacks the same way.
//   b.pack  {res: kg}   delivered but not yet packed (the intake heap). A PICTURE of T.store, never part of the books:
//                        the stack/intake items are kg-0 display items (`stk:` / `in:` keys) sized from T.store.
//   b.slots [res]       which yard slot each good's stacks stand in (kept, so stacks do not jump about)
//   w.labor.haul.last   {team: {res: kg}}  T.store at the last look (what came in since → the intake)
//
// THE SITES. placeBuilding still reserves a site's materials out of T.store (costs and the AI unchanged), but they no
// longer vanish: they are set aside as a real pile in the yard of the store nearest the site (item key `due:<bid>:<res>`,
// it.due = bid, counted kg), CARRIERS from the build crew take them there — boards (planks) where the store has boards,
// logs, stone blocks — and set them down at the site (`put to:"site"` → b.stock). The builders draw b.stock down as the
// frame rises: progress is capped by what has arrived (a little groundwork needs none), so a building can never
// complete without its materials. Where no boards were in store, a pair of the builders saws the joinery share of the
// logs into planks at the site (work_saw) — the planks you see there are their work (the books still say timber).
//   b.need {res: kg}   what the site takes in all (the substituted mix)     b.stock {res: kg}  arrived, not yet built in
//   b.used {res: kg}   built in                                             b.yard [x, y]      where it is set down
//   b.join kg of the timber to be sawn on site; b.sawn kg sawn so far (picture)
// Books: T.store + due piles + loads on shoulders + b.stock + b.used = what there was (tools/haulage-test.mjs).
// A site that burns or is pulled down: its pile goes loose (the gleaners bring it home); the reserved pile is set loose at
// the store's door (the gleaners carry it back in, 3 m).
import { PLANNERS, HOOKS, TICKS, ITEMS, RES_ITEM, addItem, itemByKey, removeItem, laborOf, lotFor, STOOP_S } from "../labor.js";
import { BUILDINGS } from "../econ-data.js";
import { blocked } from "../obstacles.js";
import * as RV from "../rivers.js"; // (a timber bridge's builders stand on its near bank)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const done = (b) => b.progress >= 1 && !b.ruin;
const takes = (b, res) => { const s = BUILDINGS[b.kind]?.stores; return s === true || (Array.isArray(s) && s.includes(res)); };
export const GROUND = 0.15;    // share of the work done before any material is needed: staking out, levelling, digging the footings

// ─────────────────────────────────────────────────────────── the stores' yards
// what each good is stacked as in a yard, and how many kg one piece of the stack stands for
export const STACK = {
  grain: ["yard_sack", 700], seed: ["yard_sack", 700], flour: ["yard_sack", 500], fresh: ["yard_barrel", 120],
  sheaves: ["yard_sheaf", 700], hay: ["yard_sheaf", 800], timber: ["yard_logs", 2500], firewood: ["yard_faggot", 700],
  boards: ["yard_planks", 500], stone: ["yard_stone", 2500], ore: ["yard_basket", 120], clay: ["yard_basket", 250], charcoal: ["yard_sack", 150],
};
const STACK_RES = Object.keys(STACK);
const PER_STACK = 24;
// the carried kind when a storeman packs a good (what he shoulders from the intake heap to the stack)
const PACKED = { grain: "sack", seed: "sack", flour: "sack", fresh: "barrel", sheaves: "sheaf", hay: "sheaf", timber: "log", firewood: "faggot", boards: "planks", stone: "stone", ore: "basket", clay: "basket", charcoal: "sack" };

const H = (w) => (laborOf(w).haul ||= { last: {} });

// the store that shows good `res` for a team: the stores that take it by name (a granary, a lumber camp), else the keep
function showStores(w, team, res) {
  const named = [], all = [];
  for (const b of w.buildings) {
    if (b.team !== team || !done(b)) continue; const s = BUILDINGS[b.kind]?.stores; if (!s) continue;
    if (s === true) all.push(b); else if (s.includes(res)) named.push(b);
  }
  return named.length ? named : all;
}
// local (along, across) → world, in the building's frame
const local = (b, fx, fy) => { const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0); return [b.x + fx * c - fy * s, b.y + fx * s + fy * c]; };
// open ground at (x, y), else pushed on along (ux, uy) until it is (a keep's curtain, a church, trunks are bodies:
// obstacles.js) — so the men can reach what lies there
const isOpen = (O, x, y, pad = 1.6) => { for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) if (blocked(O, x + a * 1.4, y + c * 1.4, pad)) return false; return true; };
function openAt(w, x, y, ux, uy, pad = 1.6, max = 30) {
  const O = w.obstacles; if (!O) return [x, y];
  for (let r = 0; r <= max; r += 1.5) if (isOpen(O, x + ux * r, y + uy * r, pad)) return [x + ux * r, y + uy * r];
  return [x, y];
}
// A store's YARD lies before one of its long sides (its front): the intake heaps by the wall, where the carriers set their
// loads down, and the stacks in rows beyond them. Positions are found once on open ground and kept (b.yardAt), so a
// stack never wanders.
function front(b) {   // → [long, short, along unit, out unit, rot]
  const [fw, fh] = BUILDINGS[b.kind]?.footprint || [10, 8], c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
  return fw >= fh ? [fw, fh, [c, s], [s, -c], b.rot || 0] : [fh, fw, [-s, c], [-c, -s], (b.rot || 0) + Math.PI / 2];
}
function slotAt(w, b, j) {
  const Y = (b.yardAt ||= {}); if (Y[j]) return Y[j];
  const [L, sh, al, out, rot] = front(b), cols = Math.max(3, Math.floor((L + 6) / 4.6)), col = j % cols, row = Math.floor(j / cols);
  const a = (col - (cols - 1) / 2) * 4.6, o = sh / 2 + 10 + row * 4.4;
  return (Y[j] = [...openAt(w, b.x + al[0] * a + out[0] * o, b.y + al[1] * a + out[1] * o, out[0], out[1]), rot]);
}
function intakeAt(w, b, ri) {
  const Y = (b.yardAt ||= {}), key = "in" + ri; if (Y[key]) return Y[key];
  const [, sh, al, out] = front(b), a = ((ri % 5) - 2) * 2.6, o = sh / 2 + 4 + Math.floor(ri / 5) * 2.2;
  return (Y[key] = openAt(w, b.x + al[0] * a + out[0] * o, b.y + al[1] * a + out[1] * o, out[0], out[1]));
}
// the way to (tx, ty) for a man at (x, y) near building b: straight if nothing stands between, else round the building by
// waypoints on a ring about it (the core's detours cannot get round a keep)
const lineClear = (O, x0, y0, x1, y1) => { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)); for (let k = 1; k < n; k++) if (blocked(O, x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, 0.4)) return false; return true; };
function wayTo(w, b, x, y, tx, ty, near = 1) {
  const O = w.obstacles, last = { op: "go", x: tx, y: ty, near };
  if (!O || lineClear(O, x, y, tx, ty)) return [last];
  const fp = BUILDINGS[b.kind]?.footprint || [10, 8], R = Math.hypot(fp[0], fp[1]) / 2 + 7;
  let a0 = Math.atan2(y - b.y, x - b.x); const a1 = Math.atan2(ty - b.y, tx - b.x);
  let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(da) / (Math.PI / 4))), out = [];
  for (let k = 0; k <= n; k++) { const a = a0 + da * k / n, [px, py] = openAt(w, b.x + Math.cos(a) * R, b.y + Math.sin(a) * R, Math.cos(a), Math.sin(a), 1, 20); out.push({ op: "go", x: px, y: py, near: 2.5 }); }
  out.push(last); return out;
}
function slotOf(b, res) { b.slots ||= []; let k = b.slots.indexOf(res); if (k < 0) { b.slots.push(res); k = b.slots.length - 1; } return k; }
const stacksFor = (b) => BUILDINGS[b.kind]?.stores === true ? 2 : 3;

function setShow(w, key, kind, res, n, x, y, rot, team) {
  let it = itemByKey(w, key);
  if (n <= 0) { if (it) removeItem(w, it); return; }
  if (!it) { it = addItem(w, { kind, res, kg: 0, x, y, team, key, rot }); it.show = 1; }
  if (it.n !== n) { it.n = n; w.labor.ver++; }
}
// the stacks and intake heaps of one team, from its books
function refreshTeam(w, T) {
  const hl = H(w), last = (hl.last[T.id] ||= {});
  const seen = new Set();
  for (const res of STACK_RES) {
    const cur = T.store[res] || 0, was = last[res]; last[res] = cur;
    const S = showStores(w, T.id, res); if (!S.length) continue;
    const [kind, per] = STACK[res];
    // came in → onto the intake of the first store showing it; went out → out of the intake first, then the stacks
    const b0 = S[0]; b0.pack ||= {};
    if (was !== undefined && cur > was + 1e-6) b0.pack[res] = (b0.pack[res] || 0) + (cur - was);
    let back = 0; for (const b of S) { if (b.pack?.[res] > cur) b.pack[res] = cur; back += b.pack?.[res] || 0; }
    if (back > cur) back = cur;
    const packed = Math.max(0, cur - back) / S.length;
    for (const b of S) {
      const ns = stacksFor(b), pieces = Math.min(ns * PER_STACK, Math.ceil(packed / per - 1e-9));
      if (pieces <= 0 && !((b.pack?.[res] || 0) > 1) && !b.slots?.includes(res)) continue;   // (no yard room for goods it never had)
      const ri = slotOf(b, res);
      for (let j = 0; j < ns; j++) {
        const [x, y, rot] = slotAt(w, b, ri * ns + j), key = `stk:${b.id}:${res}:${j}`;
        setShow(w, key, kind, res, clamp(pieces - j * PER_STACK, 0, PER_STACK), x, y, rot, T.id); seen.add(key);
      }
      const inKg = b.pack?.[res] || 0, [ix, iy] = intakeAt(w, b, ri), ik = `in:${b.id}:${res}`;
      setShow(w, ik, kind, res, inKg > 1 ? clamp(Math.ceil(inKg / per), 1, 8) : 0, ix, iy, (b.rot || 0) + 0.4 * ri, T.id); seen.add(ik);
    }
  }
  // stacks of a store that no longer shows that good (burnt, or a granary built since)
  for (const it of [...w.labor.items]) if (it.show && it.team === T.id && !seen.has(it.key)) removeItem(w, it);
}

// ─────────────────────────────────────────────────────────── the sites
// the joinery share of a building's timber: what goes in as boards (floors, doors, shutters, weatherboarding); the rest is
// framing timber and goes in as logs (hewn on site)
export const JOIN = { house: 0.4, granary: 0.3, mill: 0.35, lumber_camp: 0.2, mining_camp: 0.2, blacksmith: 0.3, fletcher: 0.4, weaver: 0.4,
  barracks: 0.3, stables: 0.35, market: 0.4, watchtower: 0.3, siege_workshop: 0.3, gate: 0.5, gatehouse: 0.3, mage_tower: 0.3, bloomery: 0.2,
  archery_range: 0.3, paddock: 0, palisade: 0 };
// the store nearest the site that takes the good (else the keep: it takes everything)
function storeFor(w, team, res, x, y) {
  let best = null, bd = Infinity;
  for (const b of w.buildings) { if (b.team !== team || !done(b) || !takes(b, res)) continue; const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = b; } }
  return best;
}
// where a site's goods are set down: its edge toward the store (a wall: 6 m off its middle, the store's side)
function siteYard(w, b, sx, sy) {
  const dx = sx - b.x, dy = sy - b.y, d = Math.hypot(dx, dy) || 1;
  if (b.x1 !== undefined) { const L = Math.hypot(b.x2 - b.x1, b.y2 - b.y1) || 1, nx = -(b.y2 - b.y1) / L, ny = (b.x2 - b.x1) / L, sgn = nx * dx + ny * dy >= 0 ? 1 : -1; return openAt(w, b.x + nx * sgn * 6, b.y + ny * sgn * 6, nx * sgn, ny * sgn, 1.2, 12); }
  const fp = BUILDINGS[b.kind]?.footprint || [8, 8], r = Math.hypot(fp[0], fp[1]) / 2 + 3;
  return openAt(w, b.x + dx / d * r, b.y + dy / d * r, dx / d, dy / d, 1.2, 12);
}
// economy.placeBuilding: the materials it just took out of T.store (`need`, scaled) are set aside at the store for the site
export function orderMaterials(w, b, T, need) {
  const want = {};
  for (const [r, n] of Object.entries(need)) if (r !== "silver" && n > 0) want[r] = n;
  if (!Object.keys(want).length) return;
  // boards in store go in for the joinery share of the timber (the timber that share would have cost stays in store)
  const jn = (want.timber || 0) * (JOIN[b.kind] ?? 0.3);
  if (jn > 0 && (T.store.boards || 0) > 0) { const bk = Math.min(jn, T.store.boards); T.store.boards -= bk; T.store.timber = (T.store.timber || 0) + bk; want.timber -= bk; want.boards = bk; if (want.timber <= 1e-9) delete want.timber; }
  // groundwork needs no materials: staking out and footings, and a palisade's whole ditch and bank (its earthwork share)
  const def = BUILDINGS[b.kind]; b.ground = GROUND + (1 - GROUND) * (def?.earthwork ? def.earthwork / (def.labour + def.earthwork) : 0);
  b.need = { ...want }; b.stock = {}; b.used = {}; b.join = Math.max(0, jn - (want.boards || 0)); b.sawn = 0;
  const hall = w.buildings.find((x) => x.id === T.hall && !x.ruin);
  const st0 = storeFor(w, b.team, Object.keys(want)[0], b.x, b.y) || hall;
  b.yard = siteYard(w, b, st0 ? st0.x : b.x + 10, st0 ? st0.y : b.y);
  for (const [res, kg] of Object.entries(want)) toDue(w, b, res, kg);   // (no store at all: the goods are at hand)
}
// is the site waiting on its materials (the frame as high as what has come allows)?
function starved(b) {
  let cap = 1; for (const [res, n] of Object.entries(b.need)) cap = Math.min(cap, ((b.used[res] || 0) + (b.stock[res] || 0)) / n);
  const G = b.ground ?? GROUND; return cap < 1 - 1e-9 && b.progress >= G + (1 - G) * cap - 0.02;
}
const stockKg = (b) => { let s = 0; for (const v of Object.values(b.stock || {})) s += v; return s; };
// economy.buildWork: the site's progress after `gain` more work, as far as the materials on site allow (they are built in)
export function buildGate(w, b, gain) {
  const p0 = b.progress; if (!b.need || gain <= 0) return Math.min(1, p0 + Math.max(0, gain));
  let cap = 1;
  for (const [res, n] of Object.entries(b.need)) cap = Math.min(cap, ((b.used[res] || 0) + (b.stock[res] || 0)) / n);
  const G = b.ground ?? GROUND, pMax = cap >= 1 - 1e-9 ? 1 : G + (1 - G) * cap;
  let p1 = Math.min(p0 + gain, Math.max(p0, pMax)); if (pMax === 1 && p1 > 1 - 1e-9) p1 = 1;
  const f = Math.max(0, (p1 - G) / (1 - G));
  for (const [res, n] of Object.entries(b.need)) {
    const want = p1 >= 1 ? n : n * f, add = Math.min(b.stock[res] || 0, Math.max(0, want - (b.used[res] || 0)));
    b.stock[res] = (b.stock[res] || 0) - add; b.used[res] = (b.used[res] || 0) + add;
    if (b.stock[res] < 1e-9) b.stock[res] = 0;
  }
  syncSite(w, b);
  return p1;
}
// the site's piles (display items `bs:`): logs still to saw or hew, the planks sawn/brought, the stone
function syncSite(w, b) {
  if (!b.yard) return;
  const [x, y] = b.yard, rot = Math.atan2(y - b.y, x - b.x) + Math.PI / 2, st = b.stock || {};
  const sawnLeft = Math.min(st.timber || 0, Math.max(0, (b.sawn || 0) - (b.used.timber || 0) * (b.join / Math.max(1, b.need.timber || 1))));
  const logs = (st.timber || 0) - sawnLeft, ux = Math.cos(rot), uy = Math.sin(rot);
  setShow(w, `bs:${b.id}:timber`, "yard_logs", "timber", logs > 1 ? clamp(Math.ceil(logs / 250), 1, 15) : 0, x - ux * 2.6, y - uy * 2.6, rot, b.team);
  const pl = sawnLeft + (st.boards || 0);
  setShow(w, `bs:${b.id}:planks`, "yard_planks", "boards", pl > 1 ? clamp(Math.ceil(pl / 120), 1, 16) : 0, x + ux * 1.4, y + uy * 1.4, rot, b.team);
  const [tx, ty, tr] = sawSpot(b);   // (a log on the trestle while there is sawing to do)
  setShow(w, `bs:${b.id}:saw`, "yard_trestle", "timber", (b.join || 0) - (b.sawn || 0) > 1 && (st.timber || 0) > 1 ? 1 : 0, tx, ty, tr + Math.PI / 2, b.team);
  setShow(w, `bs:${b.id}:stone`, "yard_stone", "stone", (st.stone || 0) > 1 ? clamp(Math.ceil(st.stone / 600), 1, 24) : 0, x + ux * 5, y + uy * 5, rot, b.team);
}
// the sawyers' trestle: beside the log pile, on the side away from the frame; [x, y, the line the two stand on]
function sawSpot(b) {
  const [yx, yy] = b.yard, rot = Math.atan2(yy - b.y, yx - b.x) + Math.PI / 2, ux = Math.cos(rot), uy = Math.sin(rot);
  return [yx - ux * 2.6 - Math.cos(rot + Math.PI / 2) * 3.2, yy - uy * 2.6 - Math.sin(rot + Math.PI / 2) * 3.2, rot];
}
function clearSite(w, b) { for (const k of ["timber", "planks", "stone", "saw"]) { const it = itemByKey(w, `bs:${b.id}:${k}`); if (it) removeItem(w, it); } }

// loads on their way to a site: bid → {res: kg}
function inTransit(w) {
  const out = new Map(), S = w.S;
  for (const [id, M] of w.labor.men) {
    if (!M.carry || M.carry.token || !M.task) continue;
    // a man taken off the village's work mid-trip (marched off, sent with the army's carts) sets his load down where he
    // stands — it is gleaned home and the site sets its share aside again
    for (let j = M.task.k; j < M.task.steps.length; j++) {
      const st = M.task.steps[j]; if (st.op !== "put" || st.to !== "site") continue;
      const u = w.units.get(S.unit[id]);
      if (!u || !u.isWorkers || u.away || u.convoy) { const c = M.carry; M.carry = null; M.task = null; M.pose = null; w.labor.men.delete(id); addItem(w, { kind: c.kind, res: c.res, kg: c.kg, x: S.x[id], y: S.y[id], team: M.team, loose: true, rot: S.facing[id] }); break; }
      const o = out.get(st.b) || {}; o[M.carry.res] = (o[M.carry.res] || 0) + M.carry.kg; out.set(st.b, o); break;
    }
  }
  return out;
}
// a site's goods that went astray — a carrier called off mid-trip takes his load back to the store (deliver-first) — are
// set aside again from the store; what the store lacks now it waits for (boards short: timber instead, sawn on site)
function reorder(w, b, transit) {
  const T = w.teams[b.team]; if (!T?.store) return;
  const tr = transit.get(b.id) || {}, due = {};
  for (const it of w.labor.items) if (it.due === b.id) due[it.res] = (due[it.res] || 0) + it.kg;
  for (const [res, n] of Object.entries(b.need)) {
    let miss = n - (b.used[res] || 0) - (b.stock[res] || 0) - (due[res] || 0) - (tr[res] || 0);
    if (miss <= 1e-6) continue;
    let got = Math.min(miss, T.store[res] || 0);
    if (res === "boards" && got < miss && (T.store.timber || 0) > 0) {   // (no boards left: the joinery comes as logs, sawn here)
      const sw = Math.min(miss - got, T.store.timber); b.need.boards -= sw; b.need.timber = (b.need.timber || 0) + sw; b.join = (b.join || 0) + sw;
      T.store.timber -= sw; toDue(w, b, "timber", sw); miss -= sw;
    }
    if (got <= 1e-6) continue;
    T.store[res] -= got; if (T.store[res] < 1e-9) T.store[res] = 0;
    toDue(w, b, res, got);
  }
}
function toDue(w, b, res, kg) {
  const key = `due:${b.id}:${res}`, it = itemByKey(w, key);
  if (it) { it.kg += kg; it.kg0 = Math.max(it.kg0 || 0, it.kg); w.labor.ver++; return; }
  const T = w.teams[b.team], st = storeFor(w, b.team, res, b.x, b.y) || w.buildings.find((x) => x.id === T.hall && !x.ruin);
  if (!st) { b.stock[res] = (b.stock[res] || 0) + kg; return; }
  const [x, y, rot] = dueSpot(w, st, b, Object.keys(b.need).indexOf(res));
  const n = addItem(w, { kind: RES_ITEM[res] || "sack", res, kg, x, y, team: b.team, key, rot }); n.due = b.id; n.kg0 = kg;
}
// where a site's reserve is set out: in the store's yard, on the side toward the site
function dueSpot(w, st, b, ri) {
  const dx = b.x - st.x, dy = b.y - st.y, d = Math.hypot(dx, dy) || 1;
  const fp = BUILDINGS[st.kind]?.footprint || [8, 8], r0 = Math.hypot(fp[0], fp[1]) / 2 + 4, side = (ri - 0.5) * 3.2, rot = Math.atan2(dy, dx) + Math.PI / 2;
  const O = w.obstacles, [yx, yy] = b.yard || [b.x, b.y];
  // on open ground with a straight way to the site (a keep in a walled bailey: out past the curtain, toward the site)
  if (O) for (let r = r0; r < Math.min(d - 6, r0 + 120); r += 2) {
    const x = st.x + dx / d * r - dy / d * side, y = st.y + dy / d * r + dx / d * side;
    if (!isOpen(O, x, y)) continue;
    const L = Math.hypot(yx - x, yy - y), n = Math.ceil(L); let ok = true;
    for (let k = 1; k < n && ok; k++) if (blocked(O, x + (yx - x) * k / n, y + (yy - y) * k / n, 0.4)) ok = false;
    if (ok) return [x, y, rot];
  }
  return [...openAt(w, st.x + dx / d * r0 - dy / d * side, st.y + dy / d * r0 + dx / d * side, dx / d, dy / d), rot];
}
// the sweep: sites finished, burnt or pulled down; goods gone astray; tokens left in a man's arms
function sweep(w) {
  const L = w.labor, live = new Map(); for (const b of w.buildings) live.set(b.id, b);
  for (const it of [...L.items]) {
    if (it.due !== undefined) {
      const b = live.get(it.due);
      if (!b || b.ruin || b.progress >= 1) { it.due = undefined; it.key = null; it.loose = true; L.ver++; }  // (set down loose by the store: gleaned back in)
    } else if (it.show && it.key?.startsWith("bs:")) {
      const b = live.get(+it.key.split(":")[1]); if (!b || b.ruin || b.progress >= 1) removeItem(w, it);
    }
  }
  let transit = null;
  for (const b of w.buildings) {
    if (!b.need) continue;
    if (!b.ruin && b.progress < 1) { reorder(w, b, transit ||= inTransit(w)); continue; }
    // what lay on a lost site is left there loose; a finished one has nothing left (builds in exactly b.need)
    if (b.stock && b.yard) for (const [res, kg] of Object.entries(b.stock)) if (kg > 1e-6) addItem(w, { kind: RES_ITEM[res] || "sack", res, kg, x: b.yard[0], y: b.yard[1], team: b.team, loose: true });
    clearSite(w, b);
    delete b.need; delete b.stock; delete b.used; delete b.yard; delete b.join; delete b.sawn; delete b.ground;
  }
  for (const [id, M] of L.men) if (M.carry?.token && (!M.task || M.task.name === "deliver" || M.task.name === "drop")) { M.carry = null; M.task = null; M.pose = null; L.men.delete(id); }
}

TICKS.haulage = (w) => {
  if (!w.labor || !w.teams) return;
  if (w.tick % 10 !== 3) return;
  sweep(w);
  for (const T of w.teams) if (T.store && !T.fallen) refreshTeam(w, T);
};

// ─────────────────────────────────────────────────────────── the people
const token = (M, kind) => { M.carry = { kind, res: ITEMS[kind]?.res || "grain", kg: 0, token: 1 }; };
HOOKS["haul.lift"] = (w, id, M, st) => { if (!M.carry) token(M, st.arg); };
HOOKS["haul.set"] = (w, id, M) => { if (M.carry?.token) M.carry = null; };
// a storeman has filled a sack / coopered a barrel at the intake: that much of it is packed
HOOKS["haul.pack"] = (w, id, M, st) => {
  const [bid, res] = st.arg, b = w.buildings.find((x) => x.id === bid); if (!b?.pack) return;
  const per = STACK[res]?.[1] || 500, lot = Math.max(per * 2, (b.pack[res] || 0) / 3);
  b.pack[res] = Math.max(0, (b.pack[res] || 0) - lot);
  if (!M.carry) token(M, PACKED[res] || "sack");
};
// a sawyer's cut: the joinery share of the logs on site turns into planks (the picture; the books say timber)
HOOKS["haul.saw"] = (w, id, M, st) => { const b = w.buildings.find((x) => x.id === st.arg); if (!b?.need) return; b.sawn = Math.min(b.join || 0, (b.sawn || 0) + Math.max(60, (b.join || 0) / 6)); syncSite(w, b); };

const around = (b, k, w) => {   // a builder's place at the frame
  if (b.br) return RV.bridgeSpot(b, (k * 0.618) % 1, (k * 0.382 + 0.5) % 1, (w.tick / 3000 | 0) * 0.31 % 1); // (a timber bridge: on its near bank — js/sim/bridges.js)
  if (b.x1 !== undefined) { const q = ((k * 0.618 + (w.tick / 3000 | 0) * 0.31) % 1), L = Math.hypot(b.x2 - b.x1, b.y2 - b.y1) || 1, side = k % 2 ? 2.2 : -2.2;
    return [b.x1 + (b.x2 - b.x1) * q - (b.y2 - b.y1) / L * side, b.y1 + (b.y2 - b.y1) * q + (b.x2 - b.x1) / L * side]; }
  const fp = BUILDINGS[b.kind]?.footprint || [10, 8], a = k * 2.399 + (w.tick / 2400 | 0);
  return local(b, Math.cos(a) * (fp[0] / 2 + 1.2), Math.sin(a) * (fp[1] / 2 + 1.2));
};
function duePiles(w, b) { const out = []; for (const it of w.labor?.items || []) if (it.due === b.id && it.kg > 1e-6) out.push(it); return out; }

// who is at what, per site, this tick (by what they are doing, not by their place in a crew: a man sent over from another
// job may still be finishing his last errand there): bid → { crew, home, saw }   (a cache, rebuilt each tick: not state)
let busyW = null, busyT = -1, busy = null;
function busyAt(w) {
  if (busyW === w && busyT === w.tick) return busy;
  busyW = w; busyT = w.tick; busy = new Map();
  for (const M of w.labor.men.values()) {
    const t = M.task; if (!t || (t.name !== "build" && t.name !== "home" && t.name !== "store")) continue;
    for (const st of t.steps) {
      const bid = st.op === "put" && st.to === "site" ? st.b : st.hook === "haul.saw" ? st.arg : undefined; if (bid === undefined) continue;
      const o = busy.get(bid) || busy.set(bid, { crew: 0, home: 0, saw: 0 }).get(bid);
      if (st.hook === "haul.saw") o.saw++; else if (t.name !== "build") o.home++; else o.crew++;
      break;
    }
  }
  return busy;
}
// a carrier's round: the reserve at the store → the site (each takes his share of the pile, so one wave brings it all when
// the lot allows — lotFor, time-compressed)
function carryPlan(w, T, id, b, it, share) {
  const [yx, yy] = b.yard, d = Math.hypot(it.x - yx, it.y - yy);
  const kg = Math.min(lotFor(w, T, d, it.kind), Math.max(ITEMS[it.kind]?.kg || 40, (it.kg0 || it.kg) / Math.max(1, share)));
  const S = w.S, a = S.x[id] - it.x, c = S.y[id] - it.y, off = Math.hypot(a, c) || 1;
  return [{ op: "go", x: it.x + a / off * 1.4, y: it.y + c / off * 1.4, near: 1.2 }, { op: "take", item: it.id, kg },
    { op: "go", x: yx, y: yy, near: 2 }, { op: "put", to: "site", b: b.id }, { op: "hook", name: "haul.sync", arg: b.id }];
}
// the villagers at home near the store carry for a site as soon as it is staked out (the builders may still be finishing
// the last one); a few per site, never more than half the hands at home
const HOME_CARRY = 4;
PLANNERS.home = (w, u, id, k, M, { T }) => {
  if (k < 2 || !w.labor.items.length || (w.tick + id) % 5) return null;
  let sites = null;
  for (const it of w.labor.items) if (it.due !== undefined && it.team === u.team && it.kg > 1e-6) (sites ||= []).push(it);
  if (!sites) return null;
  const B = busyAt(w); let home = 0; for (const o of B.values()) home += o.home;
  if (home >= Math.floor((u.members.length - 2) / 2)) return null;
  for (const it of sites) {
    const b = w.buildings.find((x) => x.id === it.due); if (!b?.yard || b.ruin || b.progress >= 1) continue;
    const o = B.get(b.id); if ((o?.home || 0) >= HOME_CARRY) continue;
    if (Math.hypot(it.x - w.S.x[id], it.y - w.S.y[id]) > 400) continue;
    const plan = carryPlan(w, T, id, b, it, HOME_CARRY + 2);
    (B.get(b.id) || B.set(b.id, { crew: 0, home: 0, saw: 0 }).get(b.id)).home++;
    return plan;
  }
  return null;
};

// the build crew: carriers fetch the site's materials from the store; a pair saws planks; builders fetch from the pile
PLANNERS.build = (w, u, id, k, M, { T, job }) => {
  const b = job.b; if (!b?.need || b.ruin || b.progress >= 1 || !b.yard) return null;
  const n = u.members.length, dues = duePiles(w, b);
  // a third of the crew carries; a site held up for want of its materials sends all but a few to fetch them
  const nC = dues.length ? (starved(b) ? Math.max(2, n - 3) : clamp(Math.round(n * 0.34), 2, 6)) : 0;
  const [yx, yy] = b.yard;
  const o = busyAt(w).get(b.id) || { crew: 0, home: 0, saw: 0 }, carrying = o.crew, sawing = o.saw;
  // the carriers are the men nearest the reserve (a man still over at his last job does not walk back for it)
  let nearer = 0;
  if (carrying < nC && n > 1) { const S = w.S, p = dues[0], d0 = Math.hypot(S.x[id] - p.x, S.y[id] - p.y); for (const m of u.members) if (m !== id && S.alive[m] && !w.labor.men.get(m)?.task && Math.hypot(S.x[m] - p.x, S.y[m] - p.y) < d0) nearer++; }
  if (carrying < nC && n > 1 && nearer < nC - carrying) {
    o.crew++; if (!busy.has(b.id)) busy.set(b.id, o);
    return carryPlan(w, T, id, b, dues[carrying % dues.length], Math.ceil(nC / dues.length) + o.home);
  }
  const st = b.stock || {}, sawnLeft = (b.join || 0) - (b.sawn || 0);
  // two sawyers at the trestle while there are logs to saw (only where no boards came from the store)
  if (sawing < 2 && sawnLeft > 1 && (st.timber || 0) > 1) {
    o.saw++; if (!busy.has(b.id)) busy.set(b.id, o);
    const [tx, ty, rot] = sawSpot(b), s = sawing ? -1 : 1, px = tx + Math.cos(rot) * 0.75 * s, py = ty + Math.sin(rot) * 0.75 * s;
    return [{ op: "go", x: px, y: py, near: 0.6 }, { op: "work", pose: "work_saw", secs: 14, x: px, y: py, face: [tx, ty], hook: "haul.saw", arg: b.id }];
  }
  // every third builder fetches from the pile: a plank bundle / a block to the frame, then works it in
  if (k % 3 === 1 && stockKg(b) > 1) {
    const kind = (st.stone || 0) > 1 && (!(st.timber || st.boards) || k % 2) ? "stone" : ((st.boards || 0) > 1 || (b.sawn || 0) > 1) ? "planks" : "log";
    const [fx, fy] = around(b, k, w);
    return [{ op: "go", x: yx, y: yy, near: 2.2 }, { op: "work", pose: "work_stoop", secs: STOOP_S, hook: "haul.lift", arg: kind, face: [yx, yy] },
      { op: "go", x: fx, y: fy, near: 1 }, { op: "work", pose: "work_stoop", secs: STOOP_S, hook: "haul.set", face: [b.x, b.y] },
      { op: "work", pose: "work_mallet", secs: 10 + (k % 4) * 2, face: [b.x, b.y] }];
  }
  return null;
};
HOOKS["haul.sync"] = (w, id, M, st) => { const b = w.buildings.find((x) => x.id === st.arg); if (b?.need) syncSite(w, b); };

// the storemen: pack what came in; else carry rations out to the houses; else tidy the stacks
PLANNERS.store = (w, u, id, k, M, { T, job }) => {
  const b = job.b; if (!b || !done(b)) return null;
  const pk = b.pack || {};
  let res = null, best = 0;
  const order = Object.keys(pk).sort();
  for (let j = 0; j < order.length; j++) { const r = order[(j + k) % order.length]; if ((pk[r] || 0) > best + 1) { best = pk[r]; res = r; if (j === 0 && best > (STACK[r]?.[1] || 500)) break; } }
  if (res) {
    const ri = slotOf(b, res), [ix, iy] = intakeAt(w, b, ri), ns = stacksFor(b), [sx, sy] = slotAt(w, b, ri * ns + (k % ns));
    const ex = ix + (k % 2 ? 1.2 : -1.2), ey = iy;
    return [...wayTo(w, b, w.S.x[id], w.S.y[id], ex, ey, 0.8), { op: "work", pose: "work_stoop", secs: STOOP_S * 2, face: [ix, iy], hook: "haul.pack", arg: [b.id, res] },
      { op: "go", x: sx, y: sy, near: 1.6 }, { op: "work", pose: "work_stoop", secs: STOOP_S, face: [sx, sy], hook: "haul.set" }];
  }
  // a site's reserve set out in this yard: the storemen start it on its way
  for (const it of w.labor.items) {
    if (it.due === undefined || it.team !== b.team || !(it.kg > 1e-6) || Math.hypot(it.x - b.x, it.y - b.y) > 140) continue;
    const s = w.buildings.find((x) => x.id === it.due); if (!s?.yard || s.ruin || s.progress >= 1) continue;
    const B = busyAt(w), o = B.get(s.id) || B.set(s.id, { crew: 0, home: 0, saw: 0 }).get(s.id); if (o.home >= HOME_CARRY) continue;
    o.home++; return carryPlan(w, T, id, s, it, HOME_CARRY + 2);
  }
  // rations out: a sack of grain or a barrel from the store to a cottage door
  const food = takes(b, "grain") && (T.store.grain || 0) > 200 ? "grain" : takes(b, "fresh") && (T.store.fresh || 0) > 100 ? "fresh" : null;
  if (food && (w.tick / 600 + id) % 3 < 1) {
    const houses = w.buildings.filter((h) => h.team === b.team && h.kind === "house" && done(h) && Math.hypot(h.x - b.x, h.y - b.y) < 260);
    if (houses.length) {
      const h = houses[(id + (w.tick / 900 | 0)) % houses.length], [sx, sy] = slotAt(w, b, slotOf(b, food) * stacksFor(b));
      const fp = BUILDINGS.house.footprint, [dx, dy] = local(h, 0, -(fp[1] / 2 + 1));
      return [...wayTo(w, b, w.S.x[id], w.S.y[id], sx, sy, 1.6), { op: "work", pose: "work_stoop", secs: STOOP_S, hook: "haul.lift", arg: PACKED[food], face: [sx, sy] },
        ...wayTo(w, b, sx, sy, dx, dy, 1), { op: "work", pose: "work_stoop", secs: STOOP_S, hook: "haul.set", face: [h.x, h.y] }];
    }
  }
  const [sx, sy] = slotAt(w, b, (id + (w.tick / 700 | 0)) % Math.max(1, (b.slots?.length || 1) * stacksFor(b)));
  return [...wayTo(w, b, w.S.x[id], w.S.y[id], sx + 1.5, sy, 1), { op: "wait", secs: 6 + (k % 3) * 2 }];
};

// the reeve (ai-general.allocateLabour): storemen per store — the keep 2, a granary 2, a camp 1 (only in a vill with the
// hands to spare)
export function storeCrews(w, team, L) {
  if (L < 24) return [];
  const out = [];
  for (const b of w.buildings) {
    if (b.team !== team || !done(b)) continue; const s = BUILDINGS[b.kind]?.stores; if (!s) continue;
    out.push([b, s === true || b.kind === "granary" ? 2 : 1]);
  }
  return out.slice(0, 5);
}
