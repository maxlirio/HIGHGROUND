// SITING: where a building may go, READ FROM THE LAND and from the village as it stands — not from a fixed list of plots.
// The owner (2026-10-03): "Instead of having set town layouts, make a program that reads the land and tells you where you
// can build things. Like it shows where you can have walls BASED on the layout of your village. and in that way you can
// settle different areas."
//
// ONE set of rules, asked by everybody who builds — the player's preview (the heat on the ground, the ghost and its reason),
// the command that stakes the building out (js/sim/townplan.js placeOnPlan), the AI lords and the reeves and stewards
// (townplan.bestSlot → bestSite), a daughter town (the same rules in its own frame: js/sim/towns.js):
//   • THE GROUND under the footprint, sampled on a 2 m lattice: on the map, dry (no open water, marsh, fen, bog, stream
//     bed), not bare rock or scree, not across a road or street, level enough for the kind (a cottage takes a slope a
//     granary does not) and not falling more than a few metres across its length; woodland is allowed (it is cleared:
//     land.js makes the work slower) but scored down;
//   • WHAT STANDS THERE: other buildings (with a 2 m eaves-gap), fields, walls and their ditch, the worked sites (quarries,
//     pits, veins), the lanes and roads (the map's roads and the plan's lanes), the keep's court; the churchyard and the
//     green are kept for the church and the market;
//   • THE TOWN'S REACH: within its claim (300 m of the keep for a seat, 210 m for a daughter village) or within 60 m of one
//     of its own buildings — a village grows outward from what it has built — and never on another town's ground;
//   • THE KIND'S OWN NEEDS: a mill on a stream with fall beside it; camps by the resource they work (townplan NEAR_RESOURCE);
//     the church likes a rise, the watchtower the high ground, the market the middle of things, the big yards (barracks,
//     stables, butts, paddock, engine yard) the edge of the village; a cottage or a workshop likes to front a lane.
// The plan's own plots (a saved realm town's tofts and yards, a planned settlement's) are still offered — they were laid
// along the lanes — and a free plot near the click is taken first; on a plot only what stands there now is checked, so a
// saved town's plots stay good.
//
// WALLS follow the village AS BUILT (suggestCircuit): a ring round the built-up area (the keep and every building in the
// village's cluster) with a margin, pushed out to the brow of the slope or held to the river bank, bent round fields and
// buildings, completing any wall that already stands, with GATES where the lanes and roads leave; cut into stretches the
// player accepts one by one (or the AI lord raises, the side facing the enemy first). It is recomputed from the village
// every time it is asked, so it grows with the village. A custom line is checked by checkWallLine (water, rock, steep
// ground, buildings, fields, other walls, roads — a road wants a gate, too far from the town).
//
// Deterministic: a pure function of the map, the buildings, the resources and the plan (no clock, no randomness, no cache
// that outlives a call), so the server, the AI and the browser's preview agree.
import { BUILDINGS } from "./econ-data.js";
import { rect, pip, polysOverlap } from "./settle.js";
import { allTowns } from "./towns.js";
import { NEAR_RESOURCE } from "./townplan.js";
import { estateWhy, upgradeBase, UPGRADES } from "./estates.js"; // (the late game: a study first, one to a house, the shell keep on the motte)

export const STEP = 2;          // the ground lattice (m)
export const REACH = { town: 300, village: 210 };
export const MILL_REACH = { town: 900, village: 700 }; // (a mill goes where the stream is: settle.js SIZES millR)
export const NEAR_BUILT = 60;   // m from one of the town's own buildings: still its ground
const GAP = 2;                  // m clear round a building (eaves, a path)
const WALL_BAND = 4;            // m each side of a wall line: its ditch and berm
const F_OUT = 1, F_WATER = 2, F_WET = 4, F_ROCK = 8, F_ROAD = 16, F_WOOD = 32;
const WET_S = new Set(["marsh", "peat_bog", "reed_bed_fen", "alder_carr", "mud", "shallow_ford", "stream_bed", "deep_water", "water_meadow"]);
const ROCK_S = new Set(["cliff_rock", "scree", "boulder_field", "rock_slab", "limestone_pavement", "quarry_floor", "ruins_rubble"]);
const ROAD_S = new Set(["dirt_track", "hollow_way", "village_street", "cobbled_road", "stone_paving"]);
const WOOD_S = new Set(["open_forest", "dense_forest", "pine_forest", "coppice", "bramble_thicket"]);
// per kind: slope (the steepest the ground may be under it — a few samples may exceed it), rise (the most the ground may fall
// across it, m), and what it likes (scoring: hub = the middle of the village, outer = its edge, high = the high ground,
// lane = fronting a lane, stream = a mill's water)
const RULES = {
  house: { slope: 0.2, rise: 4, lane: 1.5 },
  blacksmith: { slope: 0.18, rise: 4, lane: 1.2 }, fletcher: { slope: 0.18, rise: 4, lane: 1.2 }, weaver: { slope: 0.18, rise: 4, lane: 1.2 },
  granary: { slope: 0.14, rise: 3.5, hub: 0.5 }, market: { slope: 0.12, rise: 3, hub: 2 }, temple: { slope: 0.14, rise: 4, high: 1 },
  mill: { slope: 0.24, rise: 4, stream: true },
  barracks: { slope: 0.15, rise: 5, outer: 1 }, stables: { slope: 0.15, rise: 5, outer: 1 }, siege_workshop: { slope: 0.15, rise: 5, outer: 1 },
  archery_range: { slope: 0.12, rise: 6, outer: 1 }, paddock: { slope: 0.25, rise: 10, outer: 1.2 },
  watchtower: { slope: 0.3, rise: 3, high: 1.5 }, mage_tower: { slope: 0.25, rise: 3, high: 1 },
  lumber_camp: { slope: 0.3, rise: 5 }, mining_camp: { slope: 0.35, rise: 6 }, charcoal_kiln: { slope: 0.3, rise: 5 }, bloomery: { slope: 0.3, rise: 5 },
  // the late game (js/sim/estates.js): castles on the high ground (a motte is thrown up, so it takes a slope), the minster on a rise
  // near the middle, the guildhall and the mint on the market lanes, the tiltyard out on level ground at the edge
  motte: { slope: 0.25, rise: 8, high: 1.5 }, concentric_castle: { slope: 0.2, rise: 10, high: 1 }, palace: { slope: 0.15, rise: 6, high: 0.6, hub: 0.3 },
  cathedral: { slope: 0.14, rise: 6, high: 1, hub: 0.6 }, university: { slope: 0.15, rise: 5, hub: 0.3 }, hospital: { slope: 0.15, rise: 4, outer: 0.4 },
  guildhall: { slope: 0.12, rise: 3, hub: 1.5, lane: 1.2 }, mint: { slope: 0.15, rise: 3, hub: 1, lane: 1 }, tithe_barn: { slope: 0.14, rise: 4, hub: 0.3 },
  lists: { slope: 0.1, rise: 5, outer: 1 },
};
const DEF = { slope: 0.18, rise: 4 };
// every building is drawn on a levelled pad, cut and filled (js/render/pads.js): past this much fall across its footprint
// the cut and the revetment would stand higher than a man — no pad, no building (the paddock's fences and the butts'
// lanes follow the ground instead; a motte is an earthwork, thrown up on its own rule)
export const PAD_RISE = 3;
const DRAPED = new Set(["paddock", "archery_range", "motte", "concentric_castle"]);
export const WALL_KINDS = new Set(["palisade", "stone_wall"]);
export const GATE_KINDS = new Set(["gate", "gatehouse"]);
export const rulesOf = (kind) => RULES[kind] || DEF;
export const footprintOf = (kind) => BUILDINGS[kind]?.footprint || [10, 8];
const nameOf = (kind) => (BUILDINGS[kind]?.name || kind.replace(/_/g, " ")).toLowerCase();
const isCamp = (kind) => !!NEAR_RESOURCE[kind];

// ---------------------------------------------------------------- the ground, read on the lattice (memo for one call)
function survey(map) {
  const memo = new Map();
  return function at(x, y) {
    const i = Math.round(x / STEP), j = Math.round(y / STEP), key = (i + 1e5) * 4e5 + (j + 1e5);
    let c = memo.get(key); if (c) return c;
    const px = i * STEP, py = j * STEP;
    if (!map.inBounds(px, py)) c = { f: F_OUT, s: 0, z: 0 };
    else {
      let f = 0; const s = map.surfaceAt?.(px, py);
      if (map.water(px, py) > 0.02) f |= F_WATER;
      if (WET_S.has(s)) f |= F_WET;
      if (ROCK_S.has(s)) f |= F_ROCK;
      if (ROAD_S.has(s)) f |= F_ROAD;
      if (WOOD_S.has(s)) f |= F_WOOD;
      const g = map.grad(px, py);
      c = { f, s: Math.hypot(g[0], g[1]), z: map.h(px, py) };
    }
    memo.set(key, c); return c;
  };
}

// ---------------------------------------------------------------- the town a building is sited for
// → C: { w, team, plan, hub {x, y}, R, kind ("town"|"village"), at (the survey), obs (what stands), core (own buildings),
//        claims (other towns' ground), lanes ([{ pts, half }]) }. opts: { plan, hub } (the browser passes its town's).
export function siteContext(w, team, opts = {}) {
  const T = w.teams[team], plan = opts.plan !== undefined ? opts.plan : w.plans?.[team];
  // the town's keep: the team's (in a town's frame, js/sim/towns.js: that town's); a hub given (the browser's chosen town):
  // the keep standing there
  const hallB = opts.hub ? (w.buildings || []).find((b) => b.team === team && !b.ruin && b.kind === "town_hall" && Math.hypot(b.x - opts.hub.x, b.y - opts.hub.y) < 60) || null
    : T?.hall !== undefined ? w.buildings.find((b) => b.id === T.hall && !b.ruin) : null;
  const hub = opts.hub || (hallB ? { x: hallB.x, y: hallB.y } : T?.town ? { x: T.town.x, y: T.town.y } : null);
  const kind = plan?.town?.kind === "village" || opts.village ? "village" : "town";
  const C = { w, team, plan, hub, kind, R: REACH[kind], at: survey(w.map), obs: [], core: [], claims: [], lanes: [], hallB };
  if (!hub) return C;
  const near = (x, y, r) => Math.hypot(x - hub.x, y - hub.y) < r;
  const SPAN = C.R + 500;
  // what stands: every building (any house's), field, wall
  for (const b of w.buildings || []) {
    if (b.ruin && !b.field) continue;
    if (b.x1 !== undefined) { // a wall stretch: its line and ditch
      if (!near((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2, SPAN + 60)) continue;
      C.obs.push({ t: "wall", b, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, poly: band(b.x1, b.y1, b.x2, b.y2, WALL_BAND), why: `the ${nameOf(b.kind)} runs there` });
      continue;
    }
    if (!Number.isFinite(b.x) || !near(b.x, b.y, SPAN + 80)) continue;
    if (b.field) { C.obs.push({ t: "field", b, poly: rect(b.x, b.y, b.rot || 0, b.w, b.h), why: "a field lies there" }); continue; }
    const fp = footprintOf(b.kind);
    C.obs.push({ t: "bld", b, poly: rect(b.x, b.y, b.rot || 0, fp[0] + GAP * 2, fp[1] + GAP * 2), why: `the ${nameOf(b.kind)} stands there` });
    if (b.gx1 !== undefined) C.obs.push({ t: "wall", b, x1: b.gx1, y1: b.gy1, x2: b.gx2, y2: b.gy2, poly: band(b.gx1, b.gy1, b.gx2, b.gy2, WALL_BAND), why: `the ${nameOf(b.kind)}'s stretch of wall runs there` });
    if (b.team === team && b.stand !== true && !isCamp(b.kind) && near(b.x, b.y, C.R + 200)) C.core.push(b);
  }
  // the worked sites: quarries, pits, veins keep their ground (the woods, the game and the fish do not)
  for (const n of w.resources || []) {
    if (n.kind === "hunt" || n.kind === "forage" || n.kind === "fish" || n.kind === "fishery" || n.kind === "ley" || n.res === "timber" || n.res === "wood" || n.res === "firewood") continue;
    if (!near(n.x, n.y, SPAN + 100)) continue;
    C.obs.push({ t: "res", x: n.x, y: n.y, r: Math.min(60, (n.r || 20) * 0.6), why: `the ${(n.name || n.kind || "workings").toString().replace(/_/g, " ")} is worked there` });
  }
  // the lanes and roads: the map's roads, the plan's lanes
  for (const R of w.mapRoads || []) if (R.pts?.length > 1 && R.pts.some((p) => near(p[0], p[1], SPAN + 200))) C.lanes.push({ pts: R.pts, half: Math.max(2, (R.width || 4) / 2), name: R.route || "the road" });
  for (const L of plan?.town?.lanes || []) if (L.pts?.length > 1 && L.kind !== "green") C.lanes.push({ pts: L.pts, half: Math.max(1.5, (L.width || 4) / 2), name: L.kind === "street" ? "the street" : "the lane" });
  // the keep's court, the churchyard (the church's), the green (the market's)
  const t = plan?.town;
  if (t?.hall?.curia?.length >= 3) C.obs.push({ t: "court", poly: t.hall.curia, why: "that is the keep's court" });
  if (t?.church?.churchyard?.length >= 3) C.obs.push({ t: "churchyard", poly: t.church.churchyard, why: "the churchyard is kept for the church" });
  if (t?.green?.poly?.length >= 3) C.obs.push({ t: "green", poly: hullOf(t.green.poly), why: "the green is kept for the market" });
  // other towns' ground: every other town's core and every other house's hold
  for (const o of allTowns(w)) {
    if (!Number.isFinite(o.x) || Math.hypot(o.x - hub.x, o.y - hub.y) < 150) continue;
    if (!near(o.x, o.y, SPAN + 300)) continue;
    C.claims.push({ x: o.x, y: o.y, r: o.seat ? 260 : 200, name: o.name || (o.team === team ? "your other town" : "another house's town") });
  }
  for (const H of w.holds || []) if (H.team !== team && Number.isFinite(H.x) && near(H.x, H.y, SPAN + 300) && Math.hypot(H.x - hub.x, H.y - hub.y) > 150) C.claims.push({ x: H.x, y: H.y, r: 260, name: `the hold of ${H.name || "another house"}` });
  // buckets of the obstacles (32 m), for the bulk asks
  C.bk = new Map();
  C.obs.forEach((o, k) => { o.k = k; });
  for (const o of C.obs) {
    const bb = o.poly ? bboxOf(o.poly) : [o.x - o.r, o.y - o.r, o.x + o.r, o.y + o.r];
    o.bb = bb;
    for (let i = Math.floor(bb[0] / 32); i <= Math.floor(bb[2] / 32); i++) for (let j = Math.floor(bb[1] / 32); j <= Math.floor(bb[3] / 32); j++) { const k = i * 100003 + j; let a = C.bk.get(k); if (!a) C.bk.set(k, (a = [])); a.push(o); }
  }
  C.laneSegs = []; C.lk = new Map();
  for (const L of C.lanes) for (let i = 0; i + 1 < L.pts.length; i++) {
    const [ax, ay] = L.pts[i], [bx, by] = L.pts[i + 1]; if (!near(ax, ay, SPAN + 250) && !near(bx, by, SPAN + 250)) continue;
    const sg = { k: C.laneSegs.length, ax, ay, bx, by, half: L.half, name: L.name }; C.laneSegs.push(sg);
    for (let i2 = Math.floor((Math.min(ax, bx) - sg.half) / 64); i2 <= Math.floor((Math.max(ax, bx) + sg.half) / 64); i2++) for (let j2 = Math.floor((Math.min(ay, by) - sg.half) / 64); j2 <= Math.floor((Math.max(ay, by) + sg.half) / 64); j2++) { const q = i2 * 100003 + j2; let a = C.lk.get(q); if (!a) C.lk.set(q, (a = [])); a.push(sg); }
  }
  return C;
}
const bboxOf = (P) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, y] of P) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; } return [a, b, c, d]; };
function band(x1, y1, x2, y2, half) { const L = Math.hypot(x2 - x1, y2 - y1) || 1; return rect((x1 + x2) / 2, (y1 + y2) / 2, Math.atan2(y2 - y1, x2 - x1), L, half * 2); }
function hullOf(pts) {
  const P = pts.map((p) => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)); return Math.hypot(px - ax - dx * t, py - ay - dy * t); }
function obsNear(C, bb) {
  const out = new Set();
  for (let i = Math.floor(bb[0] / 32); i <= Math.floor(bb[2] / 32); i++) for (let j = Math.floor(bb[1] / 32); j <= Math.floor(bb[3] / 32); j++) { const a = C.bk.get(i * 100003 + j); if (a) for (const o of a) out.add(o); }
  return [...out].sort((a, b) => a.k - b.k); // (the order they were listed in: the same reason every time)
}
function lanesNear(C, bb) {
  const out = new Set();
  for (let i = Math.floor(bb[0] / 64); i <= Math.floor(bb[2] / 64); i++) for (let j = Math.floor(bb[1] / 64); j <= Math.floor(bb[3] / 64); j++) { const a = C.lk?.get(i * 100003 + j); if (a) for (const s of a) out.add(s); }
  return [...out].sort((a, b) => a.k - b.k);
}

// ---------------------------------------------------------------- reach and ground of a point
// whose ground is (x, y)? → null (this town's) or the reason it is not
export function reachWhy(C, x, y, extra = 0, kind = null) {
  if (!C.hub) return "you have no town";
  for (const c of C.claims) if (Math.hypot(x - c.x, y - c.y) < c.r) return `that is ${c.name}'s ground`;
  const d = Math.hypot(x - C.hub.x, y - C.hub.y);
  if (d <= C.R + extra) return null;
  if (kind === "mill") return d <= MILL_REACH[C.kind] ? null : `too far from the village for its mill (${Math.round(d)} m; ${MILL_REACH[C.kind]} m at most)`;
  for (const b of C.core) if (Math.hypot(x - b.x, y - b.y) <= NEAR_BUILT + extra) return null;
  return `too far from the village (${Math.round(d)} m from the keep; build within ${C.R} m of it or ${NEAR_BUILT} m of its buildings)`;
}
// the way a building at (x, y) faces: its front to the nearest lane or road within 45 m, else to the keep (rot such that its
// local −y, the front, points there)
export function autoRot(C, x, y) {
  let bd = 45, tx = null, ty = null;
  for (const s of lanesNear(C, [x - 45, y - 45, x + 45, y + 45])) {
    const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / l2));
    const qx = s.ax + dx * t, qy = s.ay + dy * t, d = Math.hypot(qx - x, qy - y);
    if (d < bd && d > 0.5) { bd = d; tx = qx; ty = qy; }
  }
  if (tx === null) { if (!C.hub || Math.hypot(C.hub.x - x, C.hub.y - y) < 1) return 0; tx = C.hub.x; ty = C.hub.y; }
  return R3(Math.atan2(ty - y, tx - x) + Math.PI / 2);
}
const R3 = (v) => Math.round(v * 1000) / 1000;
function laneDist(C, x, y) { let bd = Infinity; for (const s of lanesNear(C, [x - 20, y - 20, x + 20, y + 20])) { const d = segDist(x, y, s.ax, s.ay, s.bx, s.by) - s.half; if (d < bd) bd = d; } return bd; }

// ---------------------------------------------------------------- the check
// Can `kind` stand at (x, y) turned `rot`? → { ok, why, x, y, rot, w, h, score, note }. opts: { plot: true } — a plot of the
// plan (only what stands there now is checked: the plan read its ground when it was laid).
export function siteCheck(C, kind, x, y, rot = null, { plot = false } = {}) {
  const [fw, fh] = footprintOf(kind), Rk = rulesOf(kind);
  if (rot === null || rot === undefined) rot = autoRot(C, x, y);
  const out = { ok: false, why: "", x, y, rot, w: fw, h: fh, score: 0, note: "" };
  const say = (why) => { out.why = why; return out; };
  if (!C.hub) return say("you have no town");
  if (!BUILDINGS[kind]) return say("no such building");
  if (C.w) { // the great buildings (js/sim/estates.js): a study learned, one to a house; an upgrade stands on what it replaces
    const ew = estateWhy(C.w, C.team, kind); if (ew) return say(ew);
    if (UPGRADES[kind]) { const base = upgradeBase(C.w, C.team, kind, x, y); if (!base) return say(`it is raised on your ${nameOf(UPGRADES[kind])}: point at it`);
      return Object.assign(out, { ok: true, x: base.x, y: base.y, rot: base.rot || 0, score: 10, note: `raised on your ${nameOf(UPGRADES[kind])}, which it replaces` }); }
  }
  if (!isCamp(kind)) { const r = reachWhy(C, x, y, 0, kind); if (r) return say(r); }
  else {
    for (const c of C.claims) if (Math.hypot(x - c.x, y - c.y) < c.r) return say(`that is ${c.name}'s ground`);
    if (!campNode(C, kind, x, y)) { const R = NEAR_RESOURCE[kind]; return say(`no ${R.res[0]} to work within ${R.d} m of here`); }
  }
  const poly = rect(x, y, rot, fw, fh), bb = bboxOf(poly);
  // the ground
  let n = 0, steep = 0, wood = 0, zlo = Infinity, zhi = -Infinity, sl = 0, road = 0;
  { // (a plot of the plan: its ground is read for the score only — it was judged when the plan was laid)
    const c = Math.cos(rot), s = Math.sin(rot), nx = Math.max(1, Math.ceil(fw / STEP)), ny = Math.max(1, Math.ceil(fh / STEP));
    const sx = nx > 24 ? Math.ceil(nx / 24) : 1, sy = ny > 24 ? Math.ceil(ny / 24) : 1; // (a paddock is sampled sparser)
    for (let a = 0; a <= nx; a += sx) for (let b = 0; b <= ny; b += sy) {
      const lx = (a / nx - 0.5) * fw, ly = (b / ny - 0.5) * fh, px = x + lx * c - ly * s, py = y + lx * s + ly * c;
      const g = C.at(px, py); n++;
      if (plot) { if (g.f & F_WOOD) wood++; sl += g.s; if (g.z < zlo) zlo = g.z; if (g.z > zhi) zhi = g.z; continue; }
      if (g.f & F_OUT) return say("off the map");
      if (g.f & F_WATER) return say(kind === "mill" ? "the mill-house stands beside the stream, not in it" : "there is water there");
      if (g.f & F_WET) return say("the ground there is wet: marsh, fen or a stream bed");
      if (g.f & F_ROCK) return say("bare rock and scree: no footings there");
      if (g.f & F_ROAD) road++;
      if (g.f & F_WOOD) wood++;
      if (g.s > Rk.slope) steep++;
      sl += g.s; if (g.z < zlo) zlo = g.z; if (g.z > zhi) zhi = g.z;
    }
  }
  if (!plot) {
    if (road > n * 0.04) return say("it would stand across the road");
    if (steep > n * 0.1) return say(`too steep for a ${nameOf(kind)} (${Math.round(sl / n * 100)}% slope; ${Math.round(Rk.slope * 100)}% at most)`);
    if (zhi - zlo > Rk.rise) return say(`the ground falls ${(zhi - zlo).toFixed(1)} m across it (${Rk.rise} m at most)`);
    if (zhi - zlo > PAD_RISE && !DRAPED.has(kind)) return say(`too steep to level a pad for it: the ground falls ${(zhi - zlo).toFixed(1)} m across it (${PAD_RISE} m at most)`);
    // across a lane or road (the map's or the plan's)
    for (const sg of lanesNear(C, bb)) {
      if (Math.max(sg.ax, sg.bx) + sg.half < bb[0] || Math.min(sg.ax, sg.bx) - sg.half > bb[2] || Math.max(sg.ay, sg.by) + sg.half < bb[1] || Math.min(sg.ay, sg.by) - sg.half > bb[3]) continue;
      if (polysOverlap(poly, band(sg.ax, sg.ay, sg.bx, sg.by, sg.half + 0.5))) return say(`it would stand in ${sg.name}`);
    }
  }
  // what stands there
  const grow = [bb[0] - 2, bb[1] - 2, bb[2] + 2, bb[3] + 2];
  for (const o of obsNear(C, grow)) {
    if (o.bb[2] < grow[0] || o.bb[0] > grow[2] || o.bb[3] < grow[1] || o.bb[1] > grow[3]) continue;
    if (o.t === "churchyard" && kind === "temple") continue;
    if (o.t === "green" && kind === "market") continue;
    if (plot && (o.t === "court" || o.t === "churchyard" || o.t === "green")) continue; // (a plot of the plan was laid clear of them)
    if (o.t === "res") { if (circleHitsPoly(o.x, o.y, o.r, poly)) return say(o.why); continue; }
    if (polysOverlap(poly, o.poly)) return say(o.why);
  }
  // the kind's own needs
  let stream = null;
  if (Rk.stream) { stream = streamBeside(C, x, y, Math.max(fw, fh) / 2); if (!stream) return say("a mill must stand on a stream with fall (none within 25 m of here)"); }
  // the score: what the kind likes
  const d = Math.hypot(x - C.hub.x, y - C.hub.y), zh = C.at(C.hub.x, C.hub.y).z;
  let score = -d / 55 - (n ? sl / n : 0) * 12 - (n ? wood / n : 0) * 1.5;
  const notes = [];
  if (Rk.outer) score += Rk.outer * (-Math.abs(d - Math.min(C.R * 0.6, 160)) / 50 + d / 55);
  if (Rk.hub) score += -Rk.hub * d / 60;
  if (Rk.high) { const rise = (zlo + zhi) / 2 - zh; score += Rk.high * rise / 3; if (rise > 2) notes.push(`${Math.round(rise)} m above the keep`); }
  if (Rk.lane) { const ld = laneDist(C, x, y); if (ld < 16) { score += Rk.lane; notes.push("fronting the lane"); } }
  if (!isCamp(kind)) { let nb = Infinity; for (const b of C.core) { const q = Math.hypot(b.x - x, b.y - y); if (q < nb) nb = q; } if (nb < 40) score += 0.8; }
  if (stream) { score += Math.min(stream.fall, 0.06) * 30; notes.push(`on the stream, ${stream.fall > 0.02 ? "a good fall" : "a little fall"}`); }
  if (wood > n * 0.3) notes.push("woodland to clear first");
  if (!notes.length && !plot) notes.push(sl / Math.max(1, n) < 0.05 ? "level, dry ground" : "dry ground");
  out.ok = true; out.score = score; out.note = notes.join(", ");
  if (plot) out.note = out.note ? `a plot of the plan, ${out.note}` : "a plot of the plan";
  return out;
}
function circleHitsPoly(cx, cy, r, P) { if (pip(cx, cy, P)) return true; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; if (segDist(cx, cy, a[0], a[1], b[0], b[1]) < r) return true; } return false; }
// a mill's water: a stream (open water, not the great river's depth) within 25 m of the footprint, falling
function streamBeside(C, x, y, half) {
  const map = C.w.map; let best = null;
  for (let a = 0; a < 16; a++) for (const r of [half + 3, half + 8, half + 14, half + 21]) {
    const t = a / 16 * 2 * Math.PI, px = x + Math.cos(t) * r, py = y + Math.sin(t) * r;
    if (!map.inBounds(px, py)) continue;
    const dw = map.water(px, py); if (!(dw > 0.05 && dw < 1.2)) continue;
    const g = map.grad(px, py), fall = Math.hypot(g[0], g[1]);
    if (fall < 0.004) continue;
    if (!best || fall > best.fall) best = { x: px, y: py, fall };
    break;
  }
  return best;
}

// ---------------------------------------------------------------- the player's snap and the AI's choice
// the plan's free plots for `kind` (a saved town's tofts and yards, a planned settlement's)
function freePlots(C, kind) { return (C.plan?.slots || []).filter((s) => !s.taken && s.x1 === undefined && s.kinds?.includes(kind) && s.type !== "field" && s.type !== "site"); }
// Where would a click at (x, y) put `kind`? A free plot of the plan within 8 m first, then the nearest good ground within
// 10 m (the footprint turned to face the lane, or across); else the reason it cannot go at the click.
// → { ok, why, x, y, rot, w, h, score, note, slot }
export function snapSite(C, kind, x, y) {
  let bp = null, bd = 8;
  for (const s of freePlots(C, kind)) { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; bp = s; } }
  if (bp) { const r = siteCheck(C, kind, bp.x, bp.y, bp.rot || 0, { plot: true }); if (r.ok) return Object.assign(r, { slot: bp }); }
  const x0 = Math.round(x / STEP) * STEP, y0 = Math.round(y / STEP) * STEP;
  for (const [dx, dy] of RINGS) {
    const px = x0 + dx, py = y0 + dy, rot = autoRot(C, px, py);
    let r = siteCheck(C, kind, px, py, rot); if (r.ok) return r;
    r = siteCheck(C, kind, px, py, R3(rot + Math.PI / 2)); if (r.ok) return r;
  }
  return siteCheck(C, kind, x0, y0);
}
const RINGS = (() => { const o = []; for (let dy = -10; dy <= 10; dy += STEP) for (let dx = -10; dx <= 10; dx += STEP) if (dx * dx + dy * dy <= 100) o.push([dx, dy]); return o.sort((a, b) => a[0] * a[0] + a[1] * a[1] - b[0] * b[0] - b[1] * b[1] || a[1] - b[1] || a[0] - b[0]); })();

// The best spot for `kind` (the AI lords, the reeves, the stewards): every free plot of the plan and good ground on a 6 m
// lattice over the town's reach, scored by what the kind likes (and nearness to `near`, when the lord has a place in mind).
// → { x, y, rot, slot?, score } or null
export function bestSite(C, kind, near = null) {
  if (!C.hub || !BUILDINGS[kind] || isCamp(kind) || WALL_KINDS.has(kind) || GATE_KINDS.has(kind) || kind === "field") return null;
  const pull = near && Math.hypot(near.x - C.hub.x, near.y - C.hub.y) > 5 ? near : null;
  let best = null;
  const take = (r, bonus, slot) => { if (!r.ok) return; const s = r.score + bonus - (pull ? Math.hypot(r.x - pull.x, r.y - pull.y) / 40 : 0); if (!best || s > best.score + 1e-9) best = { x: r.x, y: r.y, rot: r.rot, slot: slot || null, score: s, note: r.note }; };
  for (const s of freePlots(C, kind)) take(siteCheck(C, kind, s.x, s.y, s.rot || 0, { plot: true }), PLOT_BONUS[s.type]?.[kind] ?? PLOT_BONUS[s.type]?.any ?? 1, s);
  const { G, Rx, x0, y0 } = lattice(C, kind, Math.max(10, Math.round(Math.min(...footprintOf(kind)) / 2 / STEP) * STEP));
  const wet = kind === "mill" ? nearWater(C, G, Rx, x0, y0) : null;
  for (let j = 0, y = y0; y <= C.hub.y + Rx; y += G, j++) for (let i = 0, x = x0; x <= C.hub.x + Rx; x += G, i++) {
    if (wet && !wet.has(i * 100003 + j)) continue;
    if (reachWhy(C, x, y, 0, kind)) continue;
    const g = C.at(x, y); if (g.f & (F_OUT | F_WATER | F_WET | F_ROCK)) continue;
    const rot = autoRot(C, x, y), r = siteCheck(C, kind, x, y, rot);
    if (r.ok) take(r, 0); else take(siteCheck(C, kind, x, y, R3(rot + Math.PI / 2)), -0.2);
  }
  return best;
}

// a plan's plot of the type a kind belongs on is worth more to it (a cottage on a toft, a muster hall on a croft)
const PLOT_BONUS = { toft: { any: 1.5 }, croft: { any: 1.5 }, green: { any: 1.5 }, church: { any: 1.5 }, mill: { any: 2 }, tower: { any: 1 }, yard: { house: 0.3, any: 0.6 } };
function lattice(C, kind, G, center = null) {
  const Rx = center ? 260 : kind === "mill" ? MILL_REACH[C.kind] : C.R + NEAR_BUILT, c = center || C.hub;
  return { G, Rx, x0: Math.floor((c.x - Rx) / G) * G, y0: Math.floor((c.y - Rx) / G) * G, nx: Math.ceil(2 * Rx / G) + 2 };
}
// the lattice cells within 30 m of open water (a mill's candidates)
function nearWater(C, G, Rx, x0, y0) {
  const map = C.w.map, set = new Set(), D = Math.ceil(30 / G), n = Math.ceil(2 * Rx / G) + 2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + i * G, y = y0 + j * G; if (!map.inBounds(x, y) || !(map.water(x, y) > 0.05)) continue;
    for (let dj = -D; dj <= D; dj++) for (let di = -D; di <= D; di++) set.add((i + di) * 100003 + j + dj);
  }
  return set;
}
// The heat on the ground for `kind` while the player chooses (cells of `cell` m over the town's reach): each cell's value
// is the score a footprint centred there gets (normalised to 0..1, in v) and st says 2 where it can go, 1 where it cannot
// but the ground is the town's, 0 where it is not the town's. → { x0, y0, cell, nx, ny, v: Float32Array, st: Uint8Array }
export function siteHeat(C, kind, { cell = null, center = null } = {}) { // (center: a camp's heat is read round the pointer, by the resources there)
  if (!C.hub) return null;
  const { G, Rx, x0, y0, nx } = lattice(C, kind, cell || (kind === "mill" ? 8 : Math.max(4, Math.min(8, Math.round(Math.min(...footprintOf(kind)) / 3)))), isCamp(kind) ? center || C.hub : null), ny = nx;
  const wet = kind === "mill" ? nearWater(C, G, Rx, x0, y0) : null;
  void Rx;
  const v = new Float32Array(nx * ny), st = new Uint8Array(nx * ny); let lo = Infinity, hi = -Infinity; // (st: 0 not the town's ground, 1 it cannot go there, 2 it can)
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * G, y = y0 + j * G;
    if (!isCamp(kind) && reachWhy(C, x, y, 0, kind)) continue;
    if (wet && !wet.has(i * 100003 + j)) { st[j * nx + i] = 1; continue; }
    if (isCamp(kind) && !campNode(C, kind, x, y)) continue;
    const rot = autoRot(C, x, y); let r = siteCheck(C, kind, x, y, rot); if (!r.ok) r = siteCheck(C, kind, x, y, R3(rot + Math.PI / 2));
    if (!r.ok) { st[j * nx + i] = 1; continue; }
    st[j * nx + i] = 2; v[j * nx + i] = r.score; if (r.score < lo) lo = r.score; if (r.score > hi) hi = r.score;
  }
  // normalised between the 5th and the 95th percentile (a few odd cells do not wash the rest out)
  const sc = []; for (let k = 0; k < v.length; k++) if (st[k] === 2) sc.push(v[k]);
  sc.sort((a, b) => a - b); if (sc.length) { lo = sc[Math.floor(sc.length * 0.05)]; hi = sc[Math.floor(sc.length * 0.95)]; }
  const span = hi - lo || 1;
  for (let k = 0; k < v.length; k++) if (st[k] === 2) v[k] = Math.max(0, Math.min(1, (v[k] - lo) / span));
  return { x0, y0, cell: G, nx, ny, v, st };
}
export const campRule = (kind) => NEAR_RESOURCE[kind] || null;
// WHERE A NEW TOWN MAY BE FOUNDED (Build → a new Keep & Manor, the owner: "I can found NEW towns by building a new town
// hall somewhere else"): the founding rules that need no plan (js/sim/founding.js landRules: the distance from the house's
// own towns and from every other house's, another house's lands, a protected house's lands) and the ground under a hall
// (dry, not rock, not steep), on a coarse grid round `center`. The settlers' card (js/ui/settling.js) then reads the
// whole plan the land gives at the pointer and the bill. → heat (as siteHeat) + { error } when the house may found none.
// (FD: js/sim/founding.js — its landRules and RULES, passed in: founding imports the AI, which imports this)
export function foundHeat(w, team, center, FD, { radius = 1100, cell = 20 } = {}) {
  const { landRules } = FD, T = w.teams[team], R = { ...FD.RULES, ...(w.foundRules || {}) }, at = survey(w.map);
  const x0 = Math.floor((center.x - radius) / cell) * cell, y0 = Math.floor((center.y - radius) / cell) * cell, nx = Math.ceil(2 * radius / cell) + 2, ny = nx;
  const v = new Float32Array(nx * ny), st = new Uint8Array(nx * ny);
  const towns = 1 + (T?.towns || []).filter((D) => !D.lost).length, full = towns >= R.cap;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * cell, y = y0 + j * cell, k = j * nx + i;
    if (!w.map.inBounds(x, y) || x < w.map.x0 + 200 || y < w.map.y0 + 200 || x > w.map.x1 - 200 || y > w.map.y1 - 200) continue;
    if (full || landRules(w, team, x, y, R).length) { st[k] = 1; continue; }
    let bad = false, sl = 0, n = 0;
    for (let dy = -8; dy <= 8 && !bad; dy += 4) for (let dx = -10; dx <= 10; dx += 5) { const g = at(x + dx, y + dy); n++; sl += g.s; if (g.f & (F_OUT | F_WATER | F_WET | F_ROCK) || g.s > 0.22) { bad = true; break; } }
    if (bad) { st[k] = 1; continue; }
    st[k] = 2; v[k] = Math.max(0, 1 - (sl / n) / 0.12);
  }
  return { x0, y0, cell, nx, ny, v, st, error: full ? `your house already holds ${towns} towns (at most ${R.cap})` : null };
}
// a camp's resource within its reach of (x, y)
export function campNode(C, kind, x, y) {
  const rule = NEAR_RESOURCE[kind]; if (!rule) return null;
  let best = null, bd = rule.d;
  for (const n of C.w.resources || []) { if (!rule.res.includes(n.res) || n.amount <= 0) continue; const d = Math.hypot(n.x - x, n.y - y); if (d <= bd) { bd = d; best = n; } }
  return best;
}

// ================================================================ WALLS that follow the village as built
const RAYS = 72;
// the buildings that make up the village (the cluster grown from the keep: within 150 m of it, or 50 m of another)
function villageCore(C) {
  const pts = [], inn = [];
  if (C.hallB) inn.push(C.hallB);
  const left = C.core.filter((b) => b !== C.hallB && !b.field && b.x1 === undefined && !GATE_KINDS.has(b.kind) && b.kind !== "mill" && b.kind !== "watchtower" || b.kind === "watchtower" && Math.hypot(b.x - C.hub.x, b.y - C.hub.y) < 150);
  let grew = true;
  const cand = left.slice().sort((a, b) => a.id - b.id);
  while (grew) {
    grew = false;
    for (let k = 0; k < cand.length; k++) {
      const b = cand[k]; if (!b) continue;
      const dh = Math.hypot(b.x - C.hub.x, b.y - C.hub.y);
      if (dh > C.R + 120) { cand[k] = null; continue; }
      if (dh < 150 || inn.some((o) => Math.hypot(o.x - b.x, o.y - b.y) < 50)) { inn.push(b); cand[k] = null; grew = true; }
    }
  }
  for (const b of inn) { const fp = footprintOf(b.kind); for (const p of rect(b.x, b.y, b.rot || 0, fp[0], fp[1])) pts.push(p); }
  // the keep's court; the churchyard once its church stands, the green once its market does (as built, not as planned)
  const has = (kind) => inn.some((b) => b.kind === kind);
  for (const o of C.obs) if ((o.t === "court" || (o.t === "churchyard" && has("temple")) || (o.t === "green" && has("market"))) && o.poly.every(([x, y]) => Math.hypot(x - C.hub.x, y - C.hub.y) < 170)) for (const p of o.poly) pts.push(p);
  return { pts, buildings: inn };
}
// The suggested circuit round the town as it stands now. → { ring: closed [[x, y]…], stretches: [{ i, x1, y1, x2, y2, gate,
// road, len, state: "standing"|"open"|"blocked", why, bid }], why: [words], kind } — or { error }
export function suggestCircuit(C) {
  if (!C.hub) return { error: "you have no town" };
  const map = C.w.map, cx = C.hub.x, cy = C.hub.y, n = RAYS, M = 14; // (the margin: a lane inside the wall, then the wall and its ditch)
  const { pts: core, buildings } = villageCore(C);
  if (!core.length) return { error: "nothing built to wall in yet" };
  const U = (k) => [Math.cos(k / n * 2 * Math.PI), Math.sin(k / n * 2 * Math.PI)];
  const rmin = new Array(n).fill(40), raw = new Array(n).fill(20); // (raw: how far the buildings themselves reach along the ray)
  for (const [px, py] of core) {
    const a = Math.atan2(py - cy, px - cx), r = Math.hypot(px - cx, py - cy);
    for (let k = 0; k < n; k++) { const d = Math.abs(((a - k / n * 2 * Math.PI) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI); const wid = Math.atan2(M + 4, Math.max(r, 1)); if (d < wid) { rmin[k] = Math.max(rmin[k], r * Math.cos(d) + M); raw[k] = Math.max(raw[k], r * Math.cos(d)); } }
  }
  // convexify (a re-entrant angle is a weak point)
  { const H = hullOf(rmin.map((r, k) => [U(k)[0] * r, U(k)[1] * r])); for (let k = 0; k < n; k++) rmin[k] = Math.max(rmin[k], rayPoly(U(k), H)); }
  // the walls that stand already: the circuit runs along them (they need not lie on it: those it meets it completes)
  const own = C.obs.filter((o) => o.t === "wall" && o.b.team === C.team && !o.b.ruin);
  const lock = new Array(n).fill(null);
  for (let k = 0; k < n; k++) {
    const u = U(k); let best = null;
    for (const o of own) { const r = rayHit(cx, cy, u, o.x1, o.y1, o.x2, o.y2); if (r !== null && r > rmin[k] - 30 && r < rmin[k] + 90 && (best === null || r < best)) best = r; } // (a wall far out of the village's ring stands on its own: the ring does not jog out to it)
    lock[k] = best;
  }
  const locked = lock.some((v) => v !== null);
  // the land: hold to the river bank where the water comes near; else out to the brow of the slope
  const rs = new Array(n); let brows = 0, banks = 0;
  for (let k = 0; k < n; k++) {
    if (lock[k] !== null) { rs[k] = lock[k]; continue; }
    const u = U(k); let best = rmin[k], bv = -1e9, bank = false;
    for (let r = rmin[k]; r < rmin[k] + 40; r += 3) {
      const p0 = [cx + u[0] * r, cy + u[1] * r], p1 = [cx + u[0] * (r + 8), cy + u[1] * (r + 8)];
      if (!map.inBounds(...p1)) break;
      if (map.water(...p1) > 0.02) { best = r; bank = true; break; }
      const fall = (map.h(...p0) - map.h(...p1)) / 8, v = fall - 0.004 * (r - rmin[k]);
      if (v > bv) { bv = v; best = r; }
    }
    if (bank) banks++; else if (bv > 0.06) brows++;
    rs[k] = best;
  }
  let sm = rs.slice();
  for (let it = 0; it < 6; it++) { sm = sm.map((r, k) => lock[k] !== null ? lock[k] : 0.5 * r + 0.25 * (sm[(k + n - 1) % n] + sm[(k + 1) % n])); for (let k = 0; k < n; k++) if (lock[k] === null) sm[k] = Math.max(sm[k], rmin[k]); }
  // never through a building or a field, never in the water: pushed out past them (a little), else in to the water's edge
  const clear = (k, rr) => { const u = U(k); return !blockedAt(C, cx + u[0] * rr, cy + u[1] * rr, 3); };
  const inward = (k, r) => { for (let rr = r - 2; rr > raw[k] + 6; rr -= 2) if (clear(k, rr)) return rr; return null; }; // (in to the near edge, clear of the houses)
  const pushOut = (k, r) => {
    if (clear(k, r)) return r;
    let out = null; for (let rr = r + 2; rr < r + 60; rr += 2) if (clear(k, rr)) { out = rr; break; }
    const inn = inward(k, r);
    if (inn === null) return out ?? r;
    if (out === null) return inn;
    return out - r < (r - inn) * 0.6 ? out : inn; // (round a building outward if it is near; a field's corner is better left outside)
  };
  // (and off a road it would run along — one it crosses is a gate: the ray runs down that road, so nothing moves)
  const offRoad = (k, r) => {
    const u = U(k), on = (rr) => roadAt(C, cx + u[0] * rr, cy + u[1] * rr);
    if (!on(r)) return r;
    for (let rr = r + 2; rr < r + 24; rr += 2) if (!on(rr) && !blockedAt(C, cx + u[0] * rr, cy + u[1] * rr, 3)) return rr;
    return r;
  };
  for (let k = 0; k < n; k++) if (lock[k] === null) {
    sm[k] = offRoad(k, pushOut(k, sm[k]));
    const u = U(k); for (let q = 0; q < 20 && map.water(cx + u[0] * sm[k], cy + u[1] * sm[k]) > 0.02; q++) sm[k] *= 0.96;
  }
  // every run between two rays clear too: one that still crosses a building or a field has its ends pulled in
  for (let it = 0; it < 3; it++) for (let k = 0; k < n; k++) {
    const k2 = (k + 1) % n, a = [cx + U(k)[0] * sm[k], cy + U(k)[1] * sm[k]], b = [cx + U(k2)[0] * sm[k2], cy + U(k2)[1] * sm[k2]], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let hit = false; for (let t = 1; t < L && !hit; t += 2) hit = blockedAt(C, a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L, 1);
    if (!hit) continue;
    for (const q of [k, k2]) if (lock[q] === null) { const inn = inward(q, sm[q]); if (inn !== null) sm[q] = inn; }
  }
  let ring = sm.map((r, k) => [R2(cx + U(k)[0] * r), R2(cy + U(k)[1] * r)]);
  // simplified into straight runs (a wall stretch is straight); every run checked against the land again
  { const h = n >> 1; ring = rdp(ring.slice(0, h + 1), 2).concat(rdp(ring.slice(h).concat([ring[0]]), 2).slice(1)); }
  if (ring.length < 4) return { error: "the village is too small to wall yet" };
  // gates: where the lanes and roads leave
  const gates = [];
  // (hw: half the gate's gap along the wall — a road that crosses at a slant takes a wider one, up to 22 m either side)
  const addGate = (x, y, road, hw = 7) => { const g = gates.find((q) => Math.hypot(q.x - x, q.y - y) <= 34); if (g) { g.hw = Math.min(22, Math.max(g.hw, hw, Math.hypot(g.x - x, g.y - y) + 5)); return; } gates.push({ x, y, road, hw: Math.min(22, Math.max(7, hw)) }); }; // (a second crossing near a gate: the gate's gap widens over it)
  for (const o of own) if (GATE_KINDS.has(o.b.kind) && segDistRing(ring, o.b.x, o.b.y) < 6) addGate(o.b.x, o.b.y, "the gate", Math.max(7, Math.hypot(o.x2 - o.x1, o.y2 - o.y1) / 2)); // (the gates that stand keep their places)
  for (const s of C.laneSegs) for (let i = 0; i + 1 < ring.length; i++) {
    const q = segX(ring[i], ring[i + 1], [s.ax, s.ay], [s.bx, s.by]); if (!q) continue;
    const a1 = Math.atan2(ring[i + 1][1] - ring[i][1], ring[i + 1][0] - ring[i][0]), a2 = Math.atan2(s.by - s.ay, s.bx - s.ax), sn = Math.abs(Math.sin(a1 - a2));
    addGate(q[0], q[1], s.name, (s.half + 1.5) / Math.max(0.3, sn) + 3);
  }
  for (let i = 0; i + 1 < ring.length; i++) { // (a road on the ground the lists do not hold)
    const [ax, ay] = ring[i], [bx, by] = ring[i + 1], L = Math.hypot(bx - ax, by - ay); let run = null;
    for (let s = 0; s <= L; s += 3) { const x = ax + (bx - ax) * s / L, y = ay + (by - ay) * s / L, rd = !!(C.at(x, y).f & F_ROAD); if (rd && !run) run = [s, s]; else if (rd) run[1] = s; else if (run) { const m = (run[0] + run[1]) / 2; addGate(ax + (bx - ax) * m / L, ay + (by - ay) * m / L, "the track", (run[1] - run[0]) / 2 + 5); run = null; } }
    if (run) { const m = (run[0] + run[1]) / 2; addGate(ax + (bx - ax) * m / L, ay + (by - ay) * m / L, "the track", (run[1] - run[0]) / 2 + 5); }
  }
  if (!gates.length) { // no lane leaves: one gate on the side towards the lowest ground (the way to the water and the fields)
    let b = null, bz = Infinity; for (const p of ring) { const z = map.h(p[0], p[1]); if (z < bz) { bz = z; b = p; } } addGate(b[0], b[1], "the lane");
  }
  // cut the ring at each gate (a 14 m gap: the gate and its flanks) and into stretches of at most 45 m
  const S = [0]; for (let i = 1; i < ring.length; i++) S.push(S[i - 1] + Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]));
  const total = S[S.length - 1];
  const along = (x, y) => { let bs = 0, bd = Infinity; for (let i = 0; i + 1 < ring.length; i++) { const [ax, ay] = ring[i], [bx, by] = ring[i + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)), d = Math.hypot(x - ax - dx * t, y - ay - dy * t); if (d < bd) { bd = d; bs = S[i] + t * Math.sqrt(l2); } } return bs; };
  const pointAt = (s) => { s = ((s % total) + total) % total; let i = 1; while (i < S.length - 1 && S[i] < s) i++; const t = (s - S[i - 1]) / ((S[i] - S[i - 1]) || 1); return [ring[i - 1][0] + (ring[i][0] - ring[i - 1][0]) * t, ring[i - 1][1] + (ring[i][1] - ring[i - 1][1]) * t]; };
  // the ends of the walls that stand on the ring cut it too: a stretch built is a stretch of the suggestion, and what is left
  // of a run beside it is its own stretch (never one that overlaps it)
  const wallMarks = []; for (const o of own) if (o.b.x1 !== undefined) for (const [x, y] of [[o.x1, o.y1], [o.x2, o.y2]]) if (segDistRing(ring, x, y) < 4) wallMarks.push(along(x, y));
  let gs, stretches;
  const cutRing = () => {
  gs = gates.map((g) => ({ ...g, s: along(g.x, g.y) })).sort((a, b) => a.s - b.s);
  const cuts = []; // [s0, s1, gate?, from a gate, to a gate]
  const start = gs[0].s + gs[0].hw; let s = start;
  for (let gi = 0; gi < gs.length; gi++) {
    const g = gs[gi], ng0 = gs[(gi + 1) % gs.length], gEnd = gi + 1 < gs.length ? ng0.s - ng0.hw : gs[0].s + total - gs[0].hw;
    // the wall from here to the next gate, cut at the ring's corners and every 45 m
    const marks = [s];
    for (const wm of wallMarks) for (const off of [0, total]) { const q = wm + off; if (q > s + 1 && q < gEnd - 1) marks.push(q); }
    for (let i = 0; i < S.length; i++) for (const off of [0, total]) { const q = S[i] + off; if (q > s + 6 && q < gEnd - 6 && !wallMarks.some((wm) => Math.abs(wm + off - q) < 6 || Math.abs(wm + off - total - q) < 6)) marks.push(q); }
    marks.sort((a, b) => a - b); marks.push(gEnd);
    for (let m = 0; m + 1 < marks.length; m++) { const a = marks[m], b = marks[m + 1], parts = Math.max(1, Math.ceil((b - a) / 45)); for (let p = 0; p < parts; p++) cuts.push([a + (b - a) * p / parts, a + (b - a) * (p + 1) / parts, null, m === 0 && p === 0, m + 2 === marks.length && p === parts - 1]); }
    const ng = gs[(gi + 1) % gs.length]; cuts.push([gEnd, gEnd + 2 * ng.hw, ng]); s = gEnd + 2 * ng.hw;
    void g;
  }
  stretches = [];
  for (const [a, b, g, fromGate, toGate] of cuts) {
    if (b - a < 2) continue;
    const [x1, y1] = pointAt(a), [x2, y2] = pointAt(b), len = Math.hypot(x2 - x1, y2 - y1);
    const st = { i: stretches.length, x1: R2(x1), y1: R2(y1), x2: R2(x2), y2: R2(y2), len: R2(len), gate: !!g, road: g?.road || null, state: "open", why: "", bid: null };
    const have = standingOn(C, own, st);
    if (have) { st.state = "standing"; st.bid = have.id; st.why = `the ${nameOf(have.kind)} stands here`; }
    else { const chk = checkWallLine(C, g ? "gate" : "palisade", x1, y1, x2, y2, { suggested: true, gateEnds: [!!fromGate, !!toGate] }); if (!chk.ok) { st.state = "blocked"; st.why = chk.why; } }
    stretches.push(st);
  }
  };
  cutRing();
  // a stretch refused only because a lane or road crosses it: that crossing gets a gate of its own, and the ring is cut again
  for (let it = 0; it < 2; it++) {
    let added = false;
    for (const st of stretches) {
      if (st.gate || st.state !== "blocked" || !/crosses the line/.test(st.why)) continue;
      let p = null;
      for (const L of lanesNear(C, [Math.min(st.x1, st.x2) - 2, Math.min(st.y1, st.y2) - 2, Math.max(st.x1, st.x2) + 2, Math.max(st.y1, st.y2) + 2])) { const q = segX([st.x1, st.y1], [st.x2, st.y2], [L.ax, L.ay], [L.bx, L.by]); if (q) { p = q; break; } }
      if (!p) { let a = null, b = null; for (let t = 0; t <= st.len; t += 2) { const x = st.x1 + (st.x2 - st.x1) * t / st.len, y = st.y1 + (st.y2 - st.y1) * t / st.len; if (C.at(x, y).f & F_ROAD) { if (a === null) a = t; b = t; } } if (a !== null) { const m = (a + b) / 2; p = [st.x1 + (st.x2 - st.x1) * m / st.len, st.y1 + (st.y2 - st.y1) * m / st.len]; } }
      if (p && gates.every((g) => Math.hypot(g.x - p[0], g.y - p[1]) > 18)) { gates.push({ x: p[0], y: p[1], road: "the lane", hw: 8 }); added = true; }
    }
    if (!added) break;
    cutRing();
  }
  const why = [];
  why.push(`round ${buildings.length} building${buildings.length === 1 ? "" : "s"} as they stand, ${Math.round(total)} m of circuit`);
  if (banks > n * 0.12) why.push(`it keeps to the water's edge on ${Math.round(banks / n * 100)}% of its length`);
  else if (brows > n * 0.2) why.push(`it follows the brow of the slope on ${Math.round(brows / n * 100)}% of its length`);
  if (locked) why.push("it carries on the walls that stand");
  why.push(`${gates.length} gate${gates.length === 1 ? "" : "s"} where ${gates.length === 1 ? "the way leaves" : "the ways leave"}`);
  return { ring, stretches, gates: gs.map((g) => ({ x: R2(g.x), y: R2(g.y), road: g.road })), why, length: R2(total) };
}
const R2 = (v) => Math.round(v * 100) / 100;
function segDistRing(ring, x, y) { let d = Infinity; for (let i = 0; i + 1 < ring.length; i++) d = Math.min(d, segDist(x, y, ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1])); return d; }
function rayHit(cx, cy, u, x1, y1, x2, y2) { const ex = x2 - x1, ey = y2 - y1, den = u[0] * ey - u[1] * ex; if (Math.abs(den) < 1e-9) return null; const ax = x1 - cx, ay = y1 - cy, t = (ax * ey - ay * ex) / den, s = (ax * u[1] - ay * u[0]) / den; return t > 0 && s >= 0 && s <= 1 ? t : null; }
function rayPoly(u, poly) { let best = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], ex = b[0] - a[0], ey = b[1] - a[1], den = u[0] * ey - u[1] * ex; if (Math.abs(den) < 1e-9) continue; const t = (a[0] * ey - a[1] * ex) / den, s = (a[0] * u[1] - a[1] * u[0]) / den; if (t > 0 && s >= -1e-6 && s <= 1 + 1e-6) best = Math.max(best, t); } return best; }
function segX(a, b, c, d) { const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1], den = rx * sy - ry * sx; if (Math.abs(den) < 1e-9) return null; const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den; return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * rx, a[1] + t * ry] : null; }
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
  let k = -1, dm = 0; for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > dm) { dm = d; k = i; } }
  if (dm <= eps) return [pts[0], pts[pts.length - 1]];
  return rdp(pts.slice(0, k + 1), eps).slice(0, -1).concat(rdp(pts.slice(k), eps));
}
// a road or lane under (x, y) (its width and a metre)
function roadAt(C, x, y) {
  if (C.at(x, y).f & F_ROAD) return true;
  for (const s of lanesNear(C, [x - 8, y - 8, x + 8, y + 8])) if (segDist(x, y, s.ax, s.ay, s.bx, s.by) < s.half + 1) return true;
  return false;
}
// a point inside a building (grown by m) or a field
function blockedAt(C, x, y, m) {
  for (const o of obsNear(C, [x - m - 3, y - m - 3, x + m + 3, y + m + 3])) {
    if (o.t === "court") { if (pip(x, y, o.poly)) return true; continue; } // (the ring goes round the keep's court)
    if (o.t !== "bld" && o.t !== "field") continue;
    if (o.t === "bld" && (GATE_KINDS.has(o.b.kind) || o.b.kind === "watchtower")) continue;
    if (pip(x, y, o.poly)) return true;
    for (let i = 0; i < o.poly.length; i++) { const a = o.poly[i], b = o.poly[(i + 1) % o.poly.length]; if (segDist(x, y, a[0], a[1], b[0], b[1]) < (o.t === "field" ? m + 3 : m)) return true; } // (a field kept 6 m off: the ring's straight runs between its corners stay out of it)
  }
  return false;
}
// a standing wall (or gate) of the team's that already covers this stretch of the suggestion
function standingOn(C, own, st) {
  const mx = (st.x1 + st.x2) / 2, my = (st.y1 + st.y2) / 2;
  for (const o of own) {
    if (GATE_KINDS.has(o.b.kind) && st.gate && Math.hypot(o.b.x - mx, o.b.y - my) < 10) return o.b;
    if (o.b.x1 === undefined) continue;
    if (segDist(mx, my, o.x1, o.y1, o.x2, o.y2) < 4 && segDist(st.x1, st.y1, o.x1, o.y1, o.x2, o.y2) < 8 && segDist(st.x2, st.y2, o.x1, o.y1, o.x2, o.y2) < 8) return o.b;
  }
  return null;
}

// Can a wall (or a gate's stretch) run from (x1, y1) to (x2, y2)? → { ok, why, len }. The custom line the player drags and
// every stretch of the suggestion are checked alike.
export const WALL_LEN = { min: 4, max: 80 };
export function checkWallLine(C, kind, x1, y1, x2, y2, { suggested = false, gateEnds = null } = {}) { // (gateEnds: [from, to] — a suggested stretch's end that meets a gate: the road there runs through the gate)
  const len = Math.hypot(x2 - x1, y2 - y1), out = { ok: false, why: "", len };
  const say = (why) => { out.why = why; return out; };
  if (!C.hub) return say("you have no town");
  const gate = GATE_KINDS.has(kind);
  if (len < WALL_LEN.min) return say("draw the wall: press, drag along the line, release");
  if (!suggested && len > WALL_LEN.max) return say(`too long for one stretch (${Math.round(len)} m; ${WALL_LEN.max} m at most): draw it in pieces`);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, r = reachWhy(C, mx, my, 160); if (r) return say(r);
  // the ground along it
  let steep = 0, n = 0, road = 0;
  for (let s = 0; s <= len; s += STEP) {
    const x = x1 + (x2 - x1) * s / len, y = y1 + (y2 - y1) * s / len, g = C.at(x, y); n++;
    if (g.f & F_OUT) return say("off the map");
    if (g.f & F_WATER) return say("it would stand in the water");
    if (g.f & F_WET && !gate) return say("the ground is too wet to hold a wall: marsh or a stream bed");
    if (g.f & F_ROCK && kind === "palisade") return say("stakes can't be driven into bare rock (a stone wall can stand there)");
    if (g.s > 0.45) steep++;
    if (g.f & F_ROAD && !(gateEnds && ((gateEnds[0] && s < 9) || (gateEnds[1] && s > len - 9)))) road++;
  }
  if (steep > n * 0.2) return say("too steep a slope to raise a wall on");
  // what stands there: buildings, fields, other walls (ends may meet a wall, a gate or a tower)
  const line = band(x1, y1, x2, y2, 1.2), bb = bboxOf(line);
  for (const o of obsNear(C, [bb[0] - 4, bb[1] - 4, bb[2] + 4, bb[3] + 4])) {
    if (o.t === "court" || o.t === "churchyard" || o.t === "green") { // (the plan's churchyard and green are kept once their church or market stands: until then they are only a plan)
      if (o.t !== "court" && !C.core.some((b) => b.kind === (o.t === "green" ? "market" : "temple") && pip(b.x, b.y, o.poly))) continue;
      if (polysOverlap(line, o.poly)) return say(o.t === "court" ? "it runs through the keep's court" : o.t === "green" ? "it runs across the green" : "it runs through the churchyard"); continue; }
    if (o.t === "res") { if (segDist(o.x, o.y, x1, y1, x2, y2) < o.r) return say(o.why); continue; }
    if (o.t === "field") { // (a gate, and the few metres of wall beside one, may brush a field's corner where the lane leaves between fields)
      const ux = (x2 - x1) / len, uy = (y2 - y1) / len, c0 = gate ? 0 : gateEnds?.[0] ? 9 : 0, c1 = gate ? 0 : gateEnds?.[1] ? 9 : 0;
      if (len - c0 - c1 > 1 && polysOverlap(band(x1 + ux * c0, y1 + uy * c0, x2 - ux * c1, y2 - uy * c1, 0.5), shrinkRect(o.b, gate ? 6 : 1))) return say("it cuts through a field"); continue; }
    if (o.t === "bld") {
      const b = o.b, joins = GATE_KINDS.has(b.kind) || b.kind === "watchtower" || b.kind === "tower";
      const fp = footprintOf(b.kind), P = rect(b.x, b.y, b.rot || 0, fp[0] + (joins ? 0 : 2), fp[1] + (joins ? 0 : 2));
      if (!polysOverlap(line, P)) continue;
      if (joins && (pip(x1, y1, P) || pip(x2, y2, P) || segDist(b.x, b.y, x1, y1, x2, y2) > 2)) continue; // (a wall may end at a gate or a tower)
      if (gate && b.x1 === undefined && GATE_KINDS.has(b.kind)) return say("a gate stands there already");
      return say(`it runs through the ${nameOf(b.kind)}`);
    }
    if (o.t === "wall") {
      if (o.b.team !== C.team) { if (segX([x1, y1], [x2, y2], [o.x1, o.y1], [o.x2, o.y2])) return say("another house's wall stands there"); continue; }
      const q = segX([x1, y1], [x2, y2], [o.x1, o.y1], [o.x2, o.y2]);
      const atEnd = (p) => Math.hypot(p[0] - x1, p[1] - y1) < 3 || Math.hypot(p[0] - x2, p[1] - y2) < 3 || Math.hypot(p[0] - o.x1, p[1] - o.y1) < 3 || Math.hypot(p[0] - o.x2, p[1] - o.y2) < 3;
      if (q && !atEnd(q)) return say("it crosses a standing wall");
      // lying along a standing wall (doubling it) for more than a few metres
      if (!gate) { let along = 0; for (let t = 1; t < len; t += 2) if (segDist(x1 + (x2 - x1) * t / len, y1 + (y2 - y1) * t / len, o.x1, o.y1, o.x2, o.y2) < 1.5) along += 2; if (along > 5) return say("a wall stands there already"); }
    }
  }
  // a road or lane across it wants a gate
  if (!gate && road) return say("a road crosses the line: put a gate on it");
  if (!gate) for (const s of lanesNear(C, [Math.min(x1, x2) - 2, Math.min(y1, y2) - 2, Math.max(x1, x2) + 2, Math.max(y1, y2) + 2])) {
    const q = segX([x1, y1], [x2, y2], [s.ax, s.ay], [s.bx, s.by]); if (!q) continue;
    const t = Math.hypot(q[0] - x1, q[1] - y1); if (gateEnds && ((gateEnds[0] && t < 9) || (gateEnds[1] && t > len - 9))) continue;
    return say(`${s.name} crosses the line: put a gate on it`);
  }
  out.ok = true; return out;
}
function shrinkRect(b, m) { return rect(b.x, b.y, b.rot || 0, Math.max(1, b.w - 2 * m), Math.max(1, b.h - 2 * m)); }
// the suggested stretch nearest (x, y) within maxD that is not standing → stretch or null
export function stretchNear(circ, x, y, { maxD = 30, gate = null } = {}) {
  let best = null, bd = maxD;
  for (const s of circ?.stretches || []) {
    if (gate !== null && s.gate !== gate) continue;
    const d = segDist(x, y, s.x1, s.y1, s.x2, s.y2); if (d < bd) { bd = d; best = s; }
  }
  return best;
}
// a custom line's ends, snapped to the ends of standing walls and the suggestion's corners within 6 m
export function snapWallEnd(C, circ, x, y) {
  let best = null, bd = 6;
  const tryP = (px, py) => { const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = [px, py]; } };
  for (const o of C.obs) if (o.t === "wall" && o.b.team === C.team) { tryP(o.x1, o.y1); tryP(o.x2, o.y2); }
  for (const s of circ?.stretches || []) { tryP(s.x1, s.y1); tryP(s.x2, s.y2); }
  return best || [x, y];
}
