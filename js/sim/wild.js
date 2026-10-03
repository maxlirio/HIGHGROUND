// WILD GAME (lane C, docs/gathering-plan.md): herds of red deer, roe and wild boar that live on the map, graze, wander
// their home range and bolt from people. Not soldiers: they live in their own plain-data list (w.wild), never in w.S,
// so the combat sim, battle-mc and formations never see them. Deterministic and DOM-free; all chance is a hash of
// (tick, id) — it never draws on w.rng, so adding game to a world does not shift the battle dice.
//
//   w.wild = {
//     herds: [Herd], a: [Animal], nextA, nextH, day, ver,
//     credit: { "<node id>:<team>": kg }   the kg a villager hunting crew has earned (economy.gather's analytic rate,
//                                           handed over by OUTPUT.fresh): a hunter only looses when it covers the beast
//     shots:  [[x0, y0, z0, x1, y1, t, flight, hit]]   arrows in the air in the last few seconds (the renderer's)
//   }
//   Herd   = { id, sp, node, hx, hy, R, cx, cy, gx, gy, mode: "graze"|"flee", until, fx, fy, cap, grow, n, nextMove }
//   Animal = { id, h, sp, x, y, f, st, t0, kg, ox, oy, male, young, born, tgt, tgtT }
//            st: 0 graze (head down), 1 alert (head up), 2 walk, 3 run
// A herd IS a hunting ground: every herd has a resource node (kind "hunt") whose amount is the meat on the hoof
// (Σ kg of its beasts), so the reeve and the player find it like any other resource. Kills turn a beast into a
// carcass item (js/sim/labor.js) lying where it fell: meat counts as food only when it is carried home.
// Herds regrow slowly (logistic, per econ day); a herd hunted down to one beast is gone for good.
import { TICK, BATTLE_RATE, ECON_DAYS_PER_REAL_SEC } from "./clock.js";
import { neighbours } from "./world.js";
import { blocked } from "./obstacles.js";
import { ARMS } from "./arms.js";
import { ITEMS, TICKS, addItem, removeItem } from "./labor.js";

const BT = TICK * BATTLE_RATE, EDT = TICK * ECON_DAYS_PER_REAL_SEC;
// kg: meat a beast yields (map herds split their node's amount over the beasts); size: model scale; alarm radii (m) by
// who is coming: a hunter stalking in cover, a man at work, a man walking/marching, a rider.
// kindof: how the herd lives — prey (default: graze the open edge, flee men), fowl (sits on the water, FLIES when
// flushed), pack (wolves: den deep in the wood, prowl the margins), solitary (a bear: deep wood, charges a man who
// comes too close), basker (drakes: sun by the rocks, slow unless provoked, a dangerous bite), serpent (the lake).
// capture: a live juvenile can be netted and penned (docs/mounts-wildlife-spec.md). nonode: no hunting-ground node
// (soldier parties can still hunt the herd). nohunt: never offered as game. grow: logistic rate override.
export const SPECIES = {
  deer:  { name: "red deer", item: "deer", kg: 70, n: [8, 16], walk: 1.25, run: 9.5, spacing: 4.2, size: 1, alarm: { stalk: 15, work: 38, man: 62, rider: 95 }, flee: [6, 10] },
  roe:   { name: "roe deer", item: "roe", kg: 16, n: [5, 10], walk: 1.1, run: 8.5, spacing: 3.2, size: 0.72, alarm: { stalk: 13, work: 32, man: 55, rider: 80 }, flee: [5, 8] },
  boar:  { name: "wild boar", item: "boar", kg: 55, n: [6, 12], walk: 0.9, run: 6.5, spacing: 2.6, size: 1, alarm: { stalk: 9, work: 22, man: 38, rider: 60 }, flee: [4, 7] },
  hare:  { name: "hare", item: "hare", kg: 3.5, n: [4, 9], walk: 0.45, run: 10.5, spacing: 7, size: 0.3, alarm: { stalk: 9, work: 20, man: 34, rider: 48 }, flee: [2.5, 4], grow: 0.06 },
  duck:  { name: "mallard", item: "duck", kg: 1.8, n: [7, 13], walk: 0.5, run: 13, spacing: 2.2, size: 0.22, alarm: { stalk: 12, work: 26, man: 40, rider: 55 }, flee: [6, 9], kindof: "fowl", grow: 0.05 },
  goose: { name: "greylag goose", item: "goose", kg: 3.4, n: [6, 11], walk: 0.6, run: 14, spacing: 2.8, size: 0.3, alarm: { stalk: 14, work: 30, man: 48, rider: 65 }, flee: [7, 10], kindof: "fowl", grow: 0.05 },
  wolf:  { name: "wolf", item: "wolf", kg: 16, n: [4, 7], walk: 1.2, run: 10, spacing: 3.4, size: 0.62, alarm: { stalk: 10, work: 24, man: 40, rider: 58 }, flee: [5, 8], kindof: "pack", nonode: true, grow: 0.012 },
  bear:  { name: "brown bear", item: "bear", kg: 120, n: [1, 1], walk: 0.9, run: 7.5, spacing: 3, size: 1.05, alarm: { stalk: 7, work: 16, man: 26, rider: 40 }, flee: [4, 6], kindof: "solitary", nonode: true, grow: 0.004 },
  fox:   { name: "fox", item: "fox", kg: 5, n: [1, 2], walk: 0.9, run: 9, spacing: 4, size: 0.4, alarm: { stalk: 10, work: 24, man: 40, rider: 55 }, flee: [3, 5], nonode: true, grow: 0.01 },
  strider: { name: "strider", item: "strider", kg: 120, n: [5, 9], walk: 1.6, run: 11.5, spacing: 4.5, size: 1.1, alarm: { stalk: 20, work: 48, man: 80, rider: 120 }, flee: [12, 18], capture: true, grow: 0.015 },
  drake: { name: "drake", item: "drake", kg: 160, n: [2, 4], walk: 0.5, run: 4.5, spacing: 4.5, size: 1.15, alarm: { stalk: 5, work: 10, man: 16, rider: 24 }, flee: [3, 5], kindof: "basker", capture: true, grow: 0.008 },
  hart:  { name: "white hart", item: "hart", kg: 110, n: [1, 1], walk: 1.25, run: 10.5, spacing: 4, size: 1.12, alarm: { stalk: 26, work: 60, man: 95, rider: 140 }, flee: [9, 14], nonode: true, rare: true },
  serpent: { name: "lake serpent", item: null, kg: 900, n: [1, 1], walk: 2.2, run: 5, spacing: 6, size: 1, alarm: { stalk: 40, work: 60, man: 80, rider: 110 }, flee: [8, 12], kindof: "serpent", nonode: true, nohunt: true, rare: true },
};
export const SP_IDS = Object.keys(SPECIES);
// the carcasses: carried in front (the beast itself, slung — js/render/wild.js), one beast = one piece
const CARRY_SLOW = { roe: 0.9, hare: 1, duck: 1, goose: 1, fox: 0.95, wolf: 0.9, bear: 0.6, drake: 0.6 };
for (const sp of SP_IDS) if (SPECIES[sp].item) ITEMS[SPECIES[sp].item] = { res: "fresh", hold: "front", slow: CARRY_SLOW[sp] ?? 0.75, kg: SPECIES[sp].kg, piece: 1e9 };
// live netted juveniles (docs/mounts-wildlife-spec.md): a strider young is LED at the hand, a drake young slung
export const YOUNG_ITEM = { strider: "young_strider", drake: "young_drake" };
ITEMS.young_strider = { res: "live", hold: "led", slow: 0.6, kg: 32, piece: 1e9 };
ITEMS.young_drake = { res: "live", hold: "front", slow: 0.55, kg: 48, piece: 1e9 };
const GROW_PER_DAY = 0.025;    // logistic rate (per beast per econ day, compressed): a half-hunted herd is back in ~ a season
const YOUNG_DAYS = 25;         // a calf / fawn / piglet grows up

export const hsh = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };
const land = (map, x, y) => map.inBounds(x, y) && map.water(x, y) < 0.05;
const okGround = (map, x, y) => land(map, x, y) && Math.hypot(...map.grad(x, y)) < 0.45;
// where a species may set foot: fowl swim and waddle ashore, the serpent never leaves deep water
const groundOK = (map, sp, x, y) => {
  const K = SPECIES[sp].kindof;
  if (K === "serpent") return map.inBounds(x, y) && map.water(x, y) > 0.3;
  if (K === "fowl") return map.inBounds(x, y);
  return land(map, x, y);
};
const yearDay = (w) => { const d = w.econ ? w.econ.doy % 365 : 180; return d < 0 ? d + 365 : d; };
export const isWinter = (w) => { const d = yearDay(w); return d > 320 || d < 60; };   // wolves are bolder in the hungry months
// how thick the trees stand within r of (x, y): the share of a 5 x 5 sample grid on a trunk (obstacles.js)
function cover(w, x, y, r) {   // (the map's canopy grid, or a trunk within a crown's width: the trees drawn — obstacles.js)
  const map = w.map, O = w.obstacles; let n = 0;
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { const px = x + i * r / 2, py = y + j * r / 2; if ((map.canopyGrid && map.canopy(px, py) > 2) || (O?.count && blocked(O, px, py, 4))) n++; }
  return n / 25;
}
// grazing: open grass (no canopy overhead: they are seen and they see) at the edge of the trees (cover to bolt into),
// on land, not steep, not far out of the herd's range
function grazeScore(w, H, x, y, jit) {
  if (!okGround(w.map, x, y)) return -1e9;
  const near = cover(w, x, y, 10), edge = cover(w, x, y, 36), far = Math.max(0, Math.hypot(x - H.hx, y - H.hy) - H.R);
  return -4 * near + (edge > 0.04 ? 0.8 : 0) - 0.02 * far + jit;
}
// where a herd of each kind drifts to: fowl keep to the water, wolves and bears to the thick of the wood (a wolf pack
// ranges further in winter), drakes barely leave their rocks, the serpent cruises the deep
function spotScore(w, H, x, y, jit) {
  const K = SPECIES[H.sp].kindof, map = w.map;
  if (K === "fowl") { if (!map.inBounds(x, y)) return -1e9; const wtr = map.water(x, y), far = Math.max(0, Math.hypot(x - H.hx, y - H.hy) - H.R); return (wtr > 0.15 ? 1.2 : wtr > 0.03 ? 0.1 : -2) - 0.03 * far + jit; }
  if (K === "pack" || K === "solitary") { if (!land(map, x, y)) return -1e9; const R = H.R * (K === "pack" && isWinter(w) ? 1.9 : 1), far = Math.max(0, Math.hypot(x - H.hx, y - H.hy) - R); return 2.5 * cover(w, x, y, 10) - 0.015 * far + jit; }
  if (K === "basker") { if (!okGround(map, x, y)) return -1e9; return -0.08 * Math.hypot(x - H.hx, y - H.hy) + jit; }
  if (K === "serpent") { if (!map.inBounds(x, y) || map.water(x, y) < 0.3) return -1e9; return map.water(x, y) - 0.001 * Math.hypot(x - H.hx, y - H.hy) + jit; }
  return grazeScore(w, H, x, y, jit);
}

// ---------------------------------------------------------------- set-up (lazily, on the first economic tick)
export function wildOf(w) { return w.wild || null; }
export function initWild(w) {
  if (!w.resources || !w.map) return null;
  const W = (w.wild = { herds: [], a: [], nextA: 1, nextH: 1, day: -1, ver: 0, credit: {}, shots: [] });
  const map = w.map, nodes = w.resources;
  // extra herds at the edges of the woods (roe and boar): a hunting ground within reach of most vills
  if (!nodes.some((n) => n.source === "wild")) {
    const woods = nodes.filter((n) => n.kind === "wood" || n.kind === "coppice").sort((a, b) => a.id - b.id);
    let id = nodes.reduce((m, n) => Math.max(m, n.id), 0), made = 0;
    const far = (x, y, d) => !nodes.some((n) => (n.kind === "hunt" || n.kind === "forage") && Math.hypot(n.x - x, n.y - y) < d);
    for (const wd of woods) {
      if (made >= 16) break;
      const a0 = hsh(wd.id, 78) * Math.PI * 2; let spot = null;
      for (let k = 0; k < 16 && !spot; k++) {
        const a = a0 + k * 0.785, r = wd.r * (1.3 + 0.5 * (k % 3));
        const x = wd.x + Math.cos(a) * r, y = wd.y + Math.sin(a) * r;
        if (okGround(map, x, y) && far(x, y, 260)) spot = [x, y];
      }
      if (!spot) continue;
      const sp = hsh(wd.id, 79) < 0.5 ? "boar" : "roe", S = SPECIES[sp], n = S.n[0] + Math.floor(hsh(wd.id, 80) * (S.n[1] - S.n[0] + 1));
      const node = { id: ++id, kind: "hunt", res: "fresh", x: spot[0], y: spot[1], amount: n * S.kg, start: n * S.kg, r: 60, source: "wild", name: `${sp}_${wd.id}`, sp };
      nodes.push(node); made++;
    }
  }
  seedWider(w, W);
  for (const node of nodes) if (node.kind === "hunt" && node.amount > 0) makeHerd(w, W, node);
  seedDens(w, W);
  W.gen2 = 1;
  return W;
}
// the wider fauna (source "wild2"): hares in the meadows, fowl on the waters, striders on the far open grass, drakes
// by the rock workings — hunting grounds like any other. (Guarded, so a restored world never doubles them.)
function seedWider(w, W) {
  const map = w.map, nodes = w.resources;
  if (nodes.some((n) => n.source === "wild2")) return;
  let id = nodes.reduce((m, n) => Math.max(m, n.id), 0);
  const towns = (w.teams || []).map((t) => t && t.town).filter(Boolean);
  const dTown = (x, y) => (towns.length ? Math.min(...towns.map((t) => Math.hypot(t.x - x, t.y - y))) : 1e9);
  const clearOf = (x, y, d) => !nodes.some((n) => (n.kind === "hunt" || n.kind === "forage") && Math.hypot(n.x - x, n.y - y) < d);
  const size = map.size || 4000, X0 = map.x0 || 0, Y0 = map.y0 || 0;
  const pt = (seed, k) => [X0 + (0.06 + 0.88 * hsh(seed, k * 2)) * size, Y0 + (0.06 + 0.88 * hsh(seed, k * 2 + 1)) * size];
  const addNode = (sp, x, y, extra = {}) => {
    const S = SPECIES[sp], n = S.n[0] + Math.floor(hsh(id + 1, 80) * (S.n[1] - S.n[0] + 1));
    nodes.push({ id: ++id, kind: "hunt", res: "fresh", x, y, amount: n * S.kg, start: n * S.kg, r: 40, source: "wild2", name: `${sp}_${id}`, sp, ...extra });
  };
  // hares on the open meadow within reach of the vills
  let made = 0;
  for (let k = 0; k < 180 && made < 4; k++) {
    const [x, y] = pt(301, k);
    if (!okGround(map, x, y) || cover(w, x, y, 12) > 0.03) continue;
    const dt = dTown(x, y); if (dt < 220 || dt > 1000 || !clearOf(x, y, 240)) continue;
    addNode("hare", x, y, { r: 30 }); made++;
  }
  // fowl: open water with a bank to stand on (the node on the shore, the flock out on the water: node.wx/wy)
  made = 0;
  for (let k = 0; k < 400 && made < 4; k++) {
    const [x, y] = pt(302, k);
    if (!map.inBounds(x, y) || map.water(x, y) < 0.3) continue;
    let bank = null;
    for (let j = 0; j < 12 && !bank; j++) { const a = j * 0.524, bx = x + Math.cos(a) * 22, by = y + Math.sin(a) * 22; if (okGround(map, bx, by)) bank = [bx, by]; }
    if (!bank || !clearOf(bank[0], bank[1], 420)) continue;
    addNode(hsh(k, 303) < 0.5 ? "duck" : "goose", bank[0], bank[1], { wx: x, wy: y }); made++;
  }
  // striders: the open dry grass far from the holds (docs/mounts-wildlife-spec.md)
  made = 0;
  for (let k = 0; k < 320 && made < 3; k++) {
    const [x, y] = pt(304, k);
    if (!okGround(map, x, y) || cover(w, x, y, 28) > 0 || dTown(x, y) < 650 || !clearOf(x, y, 500)) continue;
    addNode("strider", x, y, { r: 70 }); made++;
  }
  // drakes: sunning by the rock workings — a den or two on the whole map
  made = 0;
  const rocks = nodes.filter((n) => n.kind === "quarry" || n.kind === "bog_iron").sort((a, b) => a.id - b.id);
  for (const rk of rocks) {
    if (made >= 2) break;
    let spot = null;
    for (let j = 0; j < 14 && !spot; j++) { const a = hsh(rk.id, 305) * 6.283 + j * 0.449, r = (rk.r || 25) + 18 + 10 * (j % 3), x = rk.x + Math.cos(a) * r, y = rk.y + Math.sin(a) * r; if (okGround(map, x, y) && cover(w, x, y, 10) < 0.05) spot = [x, y]; }
    if (!spot || !clearOf(spot[0], spot[1], 600) || dTown(spot[0], spot[1]) < 350) continue;
    addNode("drake", spot[0], spot[1], { r: 30 }); made++;
  }
}
// nodeless dens: wolves and a bear or two deep in the big woods, foxes slinking at the field margins — no hunting
// ground (the reeve never farms them), but a soldier party can still be sent at a pack
function seedDens(w, W) {
  const map = w.map, nodes = w.resources;
  const woods = nodes.filter((n) => n.kind === "wood").sort((a, b) => (b.r || 0) - (a.r || 0) || a.id - b.id);
  let wolves = 0, bears = 0;
  for (const wd of woods) {
    if (wolves >= 2 && bears >= 2) break;
    const a = hsh(wd.id, 306) * 6.283, x = wd.x + Math.cos(a) * (wd.r || 40) * 0.4, y = wd.y + Math.sin(a) * (wd.r || 40) * 0.4;
    if (!land(map, x, y)) continue;
    if (wolves <= bears && wolves < 2) { makeFreeHerd(w, W, "wolf", x, y, 4 + Math.floor(hsh(wd.id, 309) * 4)); wolves++; }
    else if (bears < 2) { makeFreeHerd(w, W, "bear", x, y, 1); bears++; }
  }
  const towns = (w.teams || []).map((t) => t && t.town).filter(Boolean);
  let fx = 0;
  for (const t of towns) {
    if (fx >= 3) break;
    const a = hsh(Math.round(t.x), 307) * 6.283, x = t.x + Math.cos(a) * 260, y = t.y + Math.sin(a) * 260;
    if (land(map, x, y)) { makeFreeHerd(w, W, "fox", x, y, 1 + (hsh(Math.round(t.y), 308) < 0.4 ? 1 : 0)); fx++; }
  }
}
// a herd with no resource node (wolves, bears, foxes, the rare ones)
function makeFreeHerd(w, W, sp, x, y, n) {
  const S = SPECIES[sp];
  const H = { id: W.nextH++, sp, node: -1, hx: x, hy: y, R: S.kindof === "basker" ? 40 : S.kindof === "serpent" ? 400 : 160,
    cx: x, cy: y, gx: x, gy: y, mode: "graze", until: 0, fx: 0, fy: 0, cap: Math.max(n, S.n[1]), grow: 0, n: 0, nextMove: 0 };
  W.herds.push(H);
  for (let k = 0; k < n; k++) addAnimal(w, W, H, S.kg, k, false);
  return H;
}
function spOfNode(node) { if (node.sp) return node.sp; const s = `${node.name || ""} ${node.note || ""}`.toLowerCase(); return /boar|swine|pig/.test(s) ? "boar" : /\broe\b/.test(s) ? "roe" : "deer"; }
function makeHerd(w, W, node) {
  const sp = spOfNode(node), S = SPECIES[sp], K = S.kindof;
  const n = Math.max(Math.min(3, S.n[0]), Math.min(S.n[1] + 4, Math.round(node.amount / S.kg)));
  const H = { id: W.nextH++, sp, node: node.id, hx: node.x, hy: node.y, R: Math.min(260, 120 + node.r * 1.5), cx: node.x, cy: node.y, gx: node.x, gy: node.y,
    mode: "graze", until: 0, fx: 0, fy: 0, cap: n, grow: 0, n: 0, nextMove: 0 };
  if (K === "fowl") {   // the flock sits out on the water the node's bank looks over
    H.hx = H.cx = H.gx = node.wx ?? node.x; H.hy = H.cy = H.gy = node.wy ?? node.y; H.R = 90;
  } else if (K === "basker") { H.R = 40; }
  else {
    // their pasture: the best open ground at the wood's edge within reach of the node (a herd deep in the canopy can't be seen)
    let best = null, bs = -1e9;
    for (let k = 0; k < 48; k++) { const a = k * 2.399, r = 10 + 190 * Math.sqrt(k / 48), x = node.x + Math.cos(a) * r, y = node.y + Math.sin(a) * r, sc = grazeScore(w, H, x, y, -r * 0.002); if (sc > bs) { bs = sc; best = [x, y]; } }
    if (best) { H.hx = H.cx = H.gx = best[0]; H.hy = H.cy = H.gy = best[1]; }
  }
  node.sp = sp; node.herd = H.id;
  W.herds.push(H);
  const kg = node.amount / n;
  for (let k = 0; k < n; k++) addAnimal(w, W, H, kg, k, false);
  return H;
}
function addAnimal(w, W, H, kg, k, young) {
  const S = SPECIES[H.sp], id = W.nextA++, a = k * 2.399 + hsh(id, 3), r = S.spacing * Math.sqrt(k + 0.5) * 0.9;
  const ox = Math.cos(a) * r, oy = Math.sin(a) * r;
  const A = { id, h: H.id, sp: H.sp, x: H.cx + ox, y: H.cy + oy, f: hsh(id, 5) * 6.283, st: 0, t0: w.time - hsh(id, 6) * 10, kg, ox, oy, male: H.sp === "hart" || H.sp === "serpent" ? 1 : hsh(id, 7) < 0.3 ? 1 : 0, young: young ? 1 : 0, born: w.econ ? Math.floor(w.tick * EDT) : 0, tgt: -1, tgtT: 0 };
  W.a.push(A); H.n++; W.ver++;
  return A;
}
export const herdById = (w, id) => w.wild?.herds.find((h) => h.id === id) || null;
export const herdOfNode = (w, node) => (node?.herd !== undefined ? herdById(w, node.herd) : null);
export const nodeOfHerd = (w, H) => (w.resources || []).find((n) => n.id === H.node) || null;
export function animalsOf(w, H) { const out = []; for (const a of w.wild?.a || []) if (a.h === H.id) out.push(a); return out; }
export const animalById = (w, id) => { for (const a of w.wild?.a || []) if (a.id === id) return a; return null; };
// the herd under / near a map point (a click): any beast within r of it
export function herdAt(w, x, y, r = 22) {
  let best = null, bd = r;
  for (const a of w.wild?.a || []) { const d = Math.hypot(a.x - x, a.y - y); if (d < bd) { bd = d; best = a.h; } }
  if (best === null) for (const H of w.wild?.herds || []) if (H.n > 0 && Math.hypot(H.cx - x, H.cy - y) < r + 10) return H;
  return best === null ? null : herdById(w, best);
}
function syncNode(w, H) {
  let kg = 0, n = 0; for (const a of w.wild.a) if (a.h === H.id) { kg += a.kg; n++; }
  H.n = n;
  const node = nodeOfHerd(w, H); if (node) node.amount = kg;   // (a nodeless den has no hunting ground to keep)
}

// ---------------------------------------------------------------- kills
// a beast killed where it stands: a carcass item (team's, loose until someone carries it) lies there, falling (st/t0:
// the renderer plays the fall); the herd bolts from (fromX, fromY). → the item
export function killAnimal(w, A, team, fromX, fromY) {
  const W = w.wild, k = W.a.indexOf(A); if (k < 0) return null;
  W.a.splice(k, 1); W.ver++;
  const H = herdById(w, A.h);
  const it = addItem(w, { kind: SPECIES[A.sp].item, kg: A.kg, x: A.x, y: A.y, team, loose: true, rot: A.f });
  it.st = "fall" + (A.male ? "m" : "") + (A.young ? "y" : ""); it.t0 = w.time;   // (st: the renderer's fall, a stag's antlers, a fawn's size)
  if (H) { syncNode(w, H); alarm(w, H, fromX, fromY, 1); }
  (w.events ||= []).push({ t: w.tick, kind: "game-killed", sp: A.sp, x: A.x, y: A.y, team });
  if (A.sp === "hart") {   // the white hart taken: a chronicle line and a mark on the house, nothing more
    const T = w.teams?.[team]; if (T) (T.stats ||= {}).hart = (T.stats.hart || 0) + 1;
    // the trinket: the house's companies of the day carry the tale — a touch steadier for good (resting stress −0.02,
    // once per company; morale.js reads u.moraleMod). Tiny by design: a wonder, not an edge.
    for (const u of w.units?.values?.() || []) if (u.team === team && !u.hartTale) { u.hartTale = 1; u.moraleMod = (u.moraleMod || 0) - 0.02; }
    (w.events ||= []).push({ t: w.tick, kind: "white-hart-taken", team, x: A.x, y: A.y });
  }
  return it;
}
// a juvenile netted ALIVE (the capture order, js/sim/jobs/hunting.js): off the wild books, into the catcher's hands.
// (W.bornKg keeps the meat ledger honest: a live catch is neither a kill nor a loss.)
export function netAnimal(w, A, team) {
  const W = w.wild, k = W.a.indexOf(A); if (k < 0 || !A.young) return null;
  W.a.splice(k, 1); W.ver++; W.bornKg = (W.bornKg || 0) - A.kg;
  const H = herdById(w, A.h); if (H) { syncNode(w, H); alarm(w, H, A.x, A.y, 1.5); }
  (w.events ||= []).push({ t: w.tick, kind: "animal-captured", sp: A.sp, team, x: A.x, y: A.y });
  return { sp: A.sp, kg: A.kg, h: A.h };
}
// the catch penned at a finished friendly stables: the mounts lane reads b.pens (docs/mounts-wildlife-spec.md)
export function penAnimal(w, team, sp, b) {
  if (!b || b.kind !== "stables") return false;
  (b.pens ||= {})[sp] = (b.pens[sp] || 0) + 1;
  (w.events ||= []).push({ t: w.tick, kind: "mount-penned", team, b: b.id, mount: sp });
  return true;
}
// a beast taken whole (a dragon's stoop: no carcass left to carry home) — the herd bolts hard.
// (W.bornKg keeps the meat ledger honest: what the dragon ate is off the books, not lost.)
export function takeAnimal(w, A, fromX, fromY) {
  const W = w.wild, k = W.a.indexOf(A); if (k < 0) return false;
  W.a.splice(k, 1); W.ver++; W.bornKg = (W.bornKg || 0) - A.kg;
  const H = herdById(w, A.h);
  if (H) { syncNode(w, H); alarm(w, H, fromX ?? A.x, fromY ?? A.y, 2); }
  return true;
}
// a missed shot, a shout: the herd bolts away from (x, y)
export function alarm(w, H, x, y, k = 1) {
  const dx = H.cx - x, dy = H.cy - y, d = Math.hypot(dx, dy) || 1, S = SPECIES[H.sp];
  let fx = dx / d, fy = dy / d;
  if (H.mode === "flee" && w.time < H.until) { fx = H.fx * 0.5 + fx * 0.5; fy = H.fy * 0.5 + fy * 0.5; const l = Math.hypot(fx, fy) || 1; fx /= l; fy /= l; }
  // not away from home for ever: a herd far out bends its flight back toward its range
  const hd = Math.hypot(H.hx - H.cx, H.hy - H.cy);
  if (hd > H.R) { const bx = (H.hx - H.cx) / hd, by = (H.hy - H.cy) / hd; if (fx * bx + fy * by < 0.3) { fx += bx * 0.8; fy += by * 0.8; const l = Math.hypot(fx, fy) || 1; fx /= l; fy /= l; } }
  H.mode = "flee"; H.fx = fx; H.fy = fy;
  H.until = w.time + (S.flee[0] + (S.flee[1] - S.flee[0]) * hsh(H.id, w.tick)) * k;
}

// ---------------------------------------------------------------- per tick
function threat(w, H) {
  const S = SPECIES[H.sp], Wa = S.alarm, R = Wa.rider, near = neighbours(w, H.cx, H.cy, R + 20, tmp), Sx = w.S, L = w.labor;
  let tx = 0, ty = 0, n = 0;
  for (const id of near) {
    const u = w.units.get(Sx.unit[id]); if (!u) continue;
    const M = L?.men.get(id);
    let r;
    if (M?.pose && M.pose.startsWith("hunt_")) r = Wa.stalk;                       // a hunter in cover, creeping, drawing
    else if (u.isWorkers) r = Sx.state[id] === 6 ? Wa.work : Wa.man;
    else if (u.hunt) r = ARMS[u.arm]?.mounted ? Wa.work : Wa.stalk * (ARMS[u.arm]?.missile ? 1.5 : 1);   // a hunting party, spread out, going quietly
    else r = ARMS[u.arm]?.mounted ? Wa.rider : Wa.man;
    const d = Math.hypot(Sx.x[id] - H.cx, Sx.y[id] - H.cy);
    if (d < r) { tx += Sx.x[id]; ty += Sx.y[id]; n++; }
  }
  if (n) alarm(w, H, tx / n, ty / n);
}
const tmp = [];

function herdTick(w, W, H) {
  const map = w.map, S = SPECIES[H.sp], K = S.kindof, t = w.time;
  if ((w.tick + H.id) % 5 === 0 && !(H.rage && t < H.rage)) threat(w, H);   // (a charging bear/drake is past being scared: jobs/hunting.js)
  if (H.mode === "flee") {
    if (t >= H.until) { H.mode = "graze"; H.gx = H.cx; H.gy = H.cy; H.nextMove = t + 8 + hsh(H.id, w.tick) * 12; }
    else {
      // run: the herd's heart moves on at the pace of its slowest; turn from water and the map's edge
      // (a flushed flock of fowl FLIES — over anything — and the serpent dives along the deep)
      const v = S.run * 0.9 * BT, look = 18;
      for (let k = 0; k < 8; k++) {
        if (groundOK(map, H.sp, H.cx + H.fx * look, H.cy + H.fy * look)) break;
        const a = Math.atan2(H.fy, H.fx) + (k % 2 ? 1 : -1) * Math.ceil((k + 1) / 2) * 0.6;
        H.fx = Math.cos(a); H.fy = Math.sin(a);
      }
      if (groundOK(map, H.sp, H.cx + H.fx * v, H.cy + H.fy * v)) { H.cx += H.fx * v; H.cy += H.fy * v; }
      H.gx = H.cx; H.gy = H.cy;
    }
  } else {
    // graze: every half-minute or so the herd drifts on, within its range (pulled home when far out); baskers barely
    // stir, the serpent cruises long legs of the lake
    if (t >= H.nextMove) {   // the best of a few spots about them, scored for how this kind likes to live
      let bs = -1e9, a0 = hsh(H.id, w.tick) * 6.283;
      const rr = K === "serpent" ? [40, 120] : [12, 30];
      for (let k = 0; k < 7; k++) {
        const a = a0 + k * 0.898, r = rr[0] + rr[1] * hsh(H.id * 7 + k, w.tick + 1), gx = H.cx + Math.cos(a) * r, gy = H.cy + Math.sin(a) * r;
        const sc = spotScore(w, H, gx, gy, 0.5 * hsh(H.id + k, w.tick + 3));
        if (sc > bs) { bs = sc; H.gx = gx; H.gy = gy; }
      }
      H.nextMove = t + (K === "basker" ? 90 + hsh(H.id, w.tick + 2) * 150 : 18 + hsh(H.id, w.tick + 2) * 30);
    }
    const dx = H.gx - H.cx, dy = H.gy - H.cy, d = Math.hypot(dx, dy), v = S.walk * 0.45 * BT;
    if (d > 0.05) { const s = Math.min(v, d); H.cx += dx / d * s; H.cy += dy / d * s; }
  }
}

function animalTick(w, W, A, H) {
  const map = w.map, S = SPECIES[A.sp], t = w.time, flee = H.mode === "flee";
  // a young beast ridden down by a catcher (the capture order, js/sim/jobs/hunting.js sets tireT) tires and stands,
  // blown, after a long chase — that is the only way a man on foot ever lays hands on a strider
  if (A.tireT && t - A.tgtT > 5) A.tireT = 0;   // (the chase broke off: it gets its wind back)
  if (A.young && A.tgt >= 0 && A.tireT && t - A.tireT > 18) { if (A.st !== 1) { A.st = 1; A.t0 = t; } return; }
  const k = flee ? 0.65 : 1, tx = H.cx + A.ox * k, ty = H.cy + A.oy * k;
  const dx = tx - A.x, dy = ty - A.y, d = Math.hypot(dx, dy);
  let st = A.st;
  if (flee) st = d > 0.6 || t < H.until - 0.5 ? 3 : 1;
  else if (d > (st === 2 ? 0.4 : 2.5)) st = d > 14 ? 3 : 2;
  else if (st === 2 || st === 3) st = 1;
  else if (t - A.t0 > 4 + hsh(A.id, Math.floor(t / 7)) * 9) st = hsh(A.id, w.tick) < 0.72 ? 0 : 1;   // head down grazing, or up looking round
  if (st !== A.st) { A.st = st; A.t0 = t; }
  if (st >= 2 && d > 1e-3) {
    const run = st === 3, sp = (run ? S.run * (0.92 + 0.12 * hsh(A.id, 9)) * (flee ? 1 : 0.55) : S.walk) * BT * (A.young ? 0.95 : 1);
    const s = Math.min(sp, d), nx = A.x + dx / d * s, ny = A.y + dy / d * s;
    if (groundOK(map, A.sp, nx, ny)) { A.x = nx; A.y = ny; }
    const want = Math.atan2(dy, dx); let da = Math.atan2(Math.sin(want - A.f), Math.cos(want - A.f));
    const turn = (run ? 5 : 2.5) * BT; A.f += Math.max(-turn, Math.min(turn, da));
  } else if (st === 0 && hsh(A.id, Math.floor(t / 5)) < 0.03) A.f += 0.02;   // (shuffling round while grazing)
}

function daily(w, W, day) {
  for (const H of W.herds) {
    const Ssp = SPECIES[H.sp];
    for (const a of W.a) if (a.h === H.id && a.young && day - a.born > YOUNG_DAYS) a.young = 0;
    // capture species drop a young to a FULL herd now and then (docs/mounts-wildlife-spec.md: capture never
    // requires first shooting the herd down) — rarely enough that a catch stays a project
    if (Ssp.capture && H.n >= 2 && H.n >= H.cap && !W.a.some((a) => a.h === H.id && a.young) && hsh(H.id * 13, day) < 1 / 60) {
      const kg = W.a.find((a) => a.h === H.id)?.kg || Ssp.kg;
      addAnimal(w, W, H, kg, H.n + 1, true); W.bornKg = (W.bornKg || 0) + kg; syncNode(w, H);
    }
    if (H.n < 2 || H.n >= H.cap) { H.grow = 0; continue; }
    H.grow += (Ssp.grow ?? GROW_PER_DAY) * H.n * (1 - H.n / H.cap);
    let born = false;
    while (H.grow >= 1 && H.n < H.cap) { H.grow -= 1; const kg = W.a.find((a) => a.h === H.id)?.kg || Ssp.kg; addAnimal(w, W, H, kg, H.n + 1, true); W.bornKg = (W.bornKg || 0) + kg; born = true; }
    if (born) syncNode(w, H);
  }
  // the white hart: a few times a year, at the edge of a far wood, for a week or so — a wonder, not an economy
  const hart = W.herds.find((h) => h.sp === "hart");
  if (hart && (hart.n <= 0 || day >= (hart.gone || 0))) {
    if (hart.n > 0) { const kg = W.a.filter((a) => a.h === hart.id).reduce((s, a) => s + a.kg, 0); W.a = W.a.filter((a) => a.h !== hart.id); W.bornKg = (W.bornKg || 0) - kg; }
    W.herds.splice(W.herds.indexOf(hart), 1); W.ver++;
  } else if (!hart && hsh(9917, day) < 0.012) {
    const woods = (w.resources || []).filter((n) => n.kind === "wood");
    if (woods.length) {
      const wd = woods[Math.floor(hsh(day, 441) * woods.length)];
      const a = hsh(day, 442) * 6.283, x = wd.x + Math.cos(a) * (wd.r || 40) * 1.2, y = wd.y + Math.sin(a) * (wd.r || 40) * 1.2;
      if (okGround(w.map, x, y)) {
        const H = makeFreeHerd(w, W, "hart", x, y, 1); H.gone = day + 6 + Math.floor(hsh(day, 991) * 6);
        W.bornKg = (W.bornKg || 0) + SPECIES.hart.kg;
        (w.events ||= []).push({ t: w.tick, kind: "hart-seen", x, y });
      }
    }
  }
}
// the lake serpent: a rare window holds a sighting — it surfaces out on the big water for a minute or two, cruises,
// and is gone. Nothing hunts it, it hunts nothing: a chronicle line and a shiver. (Deterministic in w.time alone.)
function serpentTick(w, W) {
  if (W.serpXY === undefined) {
    const map = w.map, size = map.size || 4000, X0 = map.x0 || 0, Y0 = map.y0 || 0; let best = null, bw = 0.55;
    for (let k = 0; k < 400; k++) { const x = X0 + (0.05 + 0.9 * hsh(771, k)) * size, y = Y0 + (0.05 + 0.9 * hsh(772, k)) * size; if (!map.inBounds(x, y)) continue; const v = map.water(x, y); if (v > bw) { bw = v; best = [x, y]; } }
    W.serpXY = best;   // (null: no deep lake on this map — no serpent)
  }
  if (!W.serpXY) return;
  const win = Math.floor(w.time / 600), up = hsh(win, 7331) < 0.1 && w.time - win * 600 < 110;
  let H = W.herds.find((h) => h.sp === "serpent");
  if (up && !H) {
    H = makeFreeHerd(w, W, "serpent", W.serpXY[0], W.serpXY[1], 1); W.bornKg = (W.bornKg || 0) + SPECIES.serpent.kg;
    (w.events ||= []).push({ t: w.tick, kind: "serpent-sighted", x: W.serpXY[0], y: W.serpXY[1] });
  } else if (!up && H) {
    const kg = W.a.filter((a) => a.h === H.id).reduce((s, a) => s + a.kg, 0);
    W.a = W.a.filter((a) => a.h !== H.id); W.herds.splice(W.herds.indexOf(H), 1); W.bornKg = (W.bornKg || 0) - kg; W.ver++;
  }
}
// a netted young dropped on the ground (its leader drafted, killed…) escapes back to its kind in about a minute
const YOUNG_SP = { young_strider: "strider", young_drake: "drake" };
function escapeTick(w, W) {
  const L = w.labor; if (!L || w.tick % 25 !== 0) return;
  for (let i = L.items.length - 1; i >= 0; i--) {
    const it = L.items[i], sp = YOUNG_SP[it.kind]; if (!sp || !it.loose) continue;
    if (!it.escT) { it.escT = w.time + 60; continue; }
    if (w.time < it.escT) continue;
    let best = null, bd = Infinity;
    for (const H of W.herds) if (H.sp === sp && H.n > 0) { const d = Math.hypot(H.cx - it.x, H.cy - it.y); if (d < bd) { bd = d; best = H; } }
    removeItem(w, it);
    if (best) { addAnimal(w, W, best, SPECIES[sp].kg, best.n + 1, true); W.bornKg = (W.bornKg || 0) + SPECIES[sp].kg; syncNode(w, best); }
    (w.events ||= []).push({ t: w.tick, kind: "young-escaped", sp, team: it.team, x: it.x, y: it.y });
  }
}

export function wildTick(w) {
  if (!w.econ) return;
  const W = w.wild || initWild(w); if (!W) return;
  if (!W.gen2 && w.resources) { W.gen2 = 1; seedWider(w, W); for (const node of w.resources) if (node.kind === "hunt" && node.amount > 0 && node.herd === undefined) makeHerd(w, W, node); seedDens(w, W); }   // (a world restored from before the wider fauna)
  const day = Math.floor(w.tick * EDT);
  if (W.day < 0) W.day = day;
  if (day !== W.day) { W.day = day; daily(w, W, day); }
  serpentTick(w, W);
  escapeTick(w, W);
  const byId = new Map(); for (const H of W.herds) byId.set(H.id, H);
  for (const H of W.herds) if (H.n > 0) herdTick(w, W, H);
  for (const A of W.a) { const H = byId.get(A.h); if (H) animalTick(w, W, A, H); }
  if (W.shots.length && w.time - W.shots[0][5] > 6) W.shots = W.shots.filter((s) => w.time - s[5] <= 6);
}
TICKS.wild = wildTick;
