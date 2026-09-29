// CASTLES YOU GO INSIDE — the castle data model and the LEVEL system (docs/castle-plan.md §1; the dimensions and
// their sources: docs/siege-research.md §17).
//
// A castle is a PLACE: curtain walls with a wall-walk men stand and fight on, towers with a room at wall-walk level
// and an open battlemented top, a gatehouse with its passage, two portcullises and a chamber over it, a bailey with
// its hall, chapel, stables and well, and a keep of storeys — the last refuge. Men are on LEVELS:
//
//   S.lvl[i]   0 = the ground · 1 = the wall-walks, tower rooms at walk level, the gatehouse chamber ·
//              2 = tower tops and the gatehouse roof · 3, 4, 5 = the keep's hall, upper chamber and roof.
//   Two men interact bodily (melee, the separation push, a charge, "friends near") only on the SAME level. A man
//   going up or down a LINK (stair, ladder, rubble slope, tower bridge) counts as the level he came from until he is
//   ¾ of the way, then as the level he is going to — so the man at the head of a ladder or stair meets the men at
//   the top, and the man at its foot the men at the foot (the link-head rule). Missiles cross levels (ballistics.js:
//   heights from levelHeight; crenels and loops from coverFor).
//
// ─────────────────────────────────────────────────────────────── API (import * as CS from "./castle.js")
//   CASTLE_LAYOUTS                       { hill, concentric, river } → { name, note } (the setup screen)
//   castleFromLayout(w, layout, {x, y, team, facing})   (or (w, layout, team, {x, y, facing})) → castle, also pushed
//                                        to w.castles. `facing` = bearing (rad, sim x/y) from the castle toward the
//                                        besiegers: the gate faces that way. Registers every curtain (stone_wall,
//                                        6 m modules b.mods), tower ("tower", b.mods[1]) and gatehouse as siege.js
//                                        buildings (part.bid), adds the ditch/moat features, installs the hooks
//                                        (w.castleOrder / castleMove / castleCover / levelH / castleApi) and puts
//                                        siegeSystem and castleSystem in w.systems if they are missing.
//   castleSite(map, layout)              → { x, y, facing } a sensible site (a hilltop, a river bank, open ground)
//   castleSystem(w)                      per tick, LAST in w.systems: links (stairs, ladders…) traversed and queued,
//                                        men on levels kept on their walkways, men on the ground kept out of towers
//                                        and walls, breaches / fallen towers / gates re-read from siege.js.
//   levelOf(w, i) · levelHeight(w, i)    his level; his height above the terrain (m) — wall-walk ~8, tower top ~13,
//                                        keep floors 6/13.5/21, and in between while on a stair or ladder.
//   sameLevel(w, i, o)                   the bodily-interaction test (the link-head rule is in the levels themselves)
//   coverFor(w, i, fromX, fromY, fromLvl?) → P(a missile from there is stopped by merlons / loops) for man i
//   insideCastle(w, x, y)                → the castle whose outer curtain encloses (x, y), else null
//   castleAt(w, x, y)                    → the castle whose ground (grid, curtain + ditch + 40 m) holds (x, y), else null
//   addLink(w, castle, link) / removeLink(w, castle, link)   links between levels (SIEGE-MECH: ladders, tower bridges,
//                                        breaches). link = { kind: "stair"|"ladder"|"bridge"|"breach"|"door",
//                                        a: {lvl, x, y}, b: {lvl, x, y}, c?: {lvl, x, y} (a breach's inner foot),
//                                        width (men abreast), speed (m/s along it), len? (m; default the 3-D length),
//                                        head? (s between men on one lane), team? (only that side may use it),
//                                        managed?: "siege" (siege.js moves the climbers; castle.js paths and draws
//                                        it, and does not put men on it), blocked? }.
//   castlePath(w, i, tx, ty, tlvl)       → the way there: [{ kind: "ground"|"link"|"walk", x, y, lvl, link? } …]
//   setLevel(w, i, lvl, x?, y?)          put a man on a level (onto the nearest walkway of that level)
//   walkPointNear(w, castle, x, y, lvl)  → { e, t, x, y, h } the nearest walkway point of a level
//   castleRayPick(w, ox, oy, oz, dx, dy, dz) → { x, y, h, part } the first castle surface (or ground) a ray meets
//   castlePlace(w, x, y, hit?)           → { kind: tower|walk|gatehouse|keep|breach|bailey, part, lvl, x, y, h, cap, label }
//                                        what a click there means (js/ui/castle-orders.js; castle-plan §1.2)
//   topCap(part)                         men a tower top / gatehouse roof holds (the rest wait on the stair and walk)
//   groundOpen(w, x, y) · groundToward(w, x, y, tx, ty)   open ground on the castle's grid; a step toward a point round it
//   aimBias(w, i, tx, ty)                flanking fire: a tower's bows prefer stormers under the curtain (ballistics.js)
//   ORDERS (issueOrder kinds, taken by w.castleOrder):
//     { kind: "man_walls", x, y, castle?, instant? }  the unit's men file along the wall-walk nearest (x, y), one to a
//                                        merlon, from the nearest stairs up (instant: placed there at once — setup)
//     { kind: "keep", castle? }         into the keep: the hall first, then the chamber and the roof
//     { kind: "castle_move", x, y, lvl? } anywhere in the castle, on any level, by the ground, gates and stairs
//     ordinary "move" / "assault" / "hold" to a point inside a castle (or by a body already in one) are routed the
//     same way (an assault goes for the nearest enemy, on whatever level he stands, every 5 s).
//
// DATA (w.castles[k]): { id, team, name, layout, x, y, facing, walkH, parts, walkways: { nodes, edges }, links,
//   keep, bailey: { x, y, r, poly }, rings: [{ id, poly }], gates: [part], posterns: [part] }.
//   parts: curtain { x0, y0, x1, y1, th, h, walkH, walkLvl, bid, ring } · tower { x, y, shape, r, h, walkH, floors,
//   topLvl, bid } · gatehouse { x, y, rot, w, d, passage, floors, walkH, portcullis, murderHoles, portcullises, bid } ·
//   keep { x, y, rot, w, d, floors, fore, lvls } · hall / chapel / stable / kitchen { x, y, rot, w, d } · well { x, y, r }
//   · postern { x, y, nx, ny, link, open } · ditch / moat { pts, width }. Local frame of rect parts: a along `rot`,
//   b across it; a gatehouse's +b points out of the castle (render/castle.js reads the same).
//   walkways: nodes { id, x, y, lvl, h }, edges { id, a, b, lvl, w (width), h, len, kind: walk|room, bid?, mod?,
//   gone }. A curtain's walk is one edge per 6 m module, so a breach cuts exactly the walk above it.
//
// HOW MEN MOVE. A body given a castle order is walked by castle.js (world.moveUnit hands it over: u.cst), each man
// by himself toward his own place: on the ground by a flow field on a 1 m grid of the castle (walls, towers, the keep,
// the bailey's buildings, shut gates and portcullises solid; breaches and ditches slow), up and down by the links —
// each a queue with lanes and a headway (a spiral stair is one man abreast, one man every 1.6 s) — and along the
// walkway graph on the levels. A man chooses the stair or ladder that gets him there soonest, counting the queue at
// its foot. Fighting, fleeing and fallen men are combat's; castle.js only keeps them on their level.
import { S_IDLE, S_MOVE, S_FIGHT, S_FLEE, S_RALLY, S_CAPT, clamp } from "./soldiers.js";
import { ARMS } from "./arms.js";
import { DT, steer, applyOrder } from "./world.js";
import { addFeature, syncBuildingFeatures, eachFeatureNear, pointSeg } from "./features.js";
import { FEATURES } from "./terrain-types.js";
import * as EC from "./economy.js";
import { siegeSystem, ensureSiege, releaseEscalade } from "./siege.js";

// ─────────────────────────────────────────────────────────────── levels and dimensions
export const L_GROUND = 0, L_WALK = 1, L_TOP = 2, L_HALL = 3, L_CHAMBER = 4, L_ROOF = 5;
// siege-research.md §17 (DESIGN where a range is given: the middle of it)
export const DIMS = {
  curtain: { h: 10.5, walkH: 8, th: 2.6, parapet: 0.6 },   // 8–12 m high, 2–3 m thick; wall-walk ~2 m behind a 0.6 m parapet
  inner:   { h: 12.5, walkH: 10, th: 3.0, parapet: 0.7 },  // a concentric castle's inner curtain: higher, thicker
  outer:   { h: 7.5, walkH: 5.5, th: 2.2, parapet: 0.6 },  // …and its outer curtain, low enough to shoot over
  tower:   { r: 5.5, above: 5.5, project: 0.45 },          // round mural towers Ø ~11 m rising ~5 m over the walk, ~½ projecting
  gate:    { w: 17, d: 15, passage: 3.4, portcullis: 2 },  // twin-towered gatehouse, passage ~3 m, two portcullises
  keep:    { w: 20, d: 20, floors: [0, 6, 13.5, 21] },     // great tower ~20 m square, ~23 m to the parapet
  stair:   { spiral: 0.5, spiralHead: 1.6, straight: 0.55, straightHead: 1.0, spiralLen: 1.8 }, // m/s along the flight; s between men on a lane; helix length per metre of rise (8 m of spiral ≈ 29 s, 0.6 men/s)
  walkSpacing: 1.2, // m of wall-walk per man manning it (a merlon and a crenel)
};
const V0 = 1.2; // m/s: the reference walking pace that turns link times into path costs
const CELL = 1; // m: the castle's ground grid

// ─────────────────────────────────────────────────────────────── the layouts (castle-local metres: +y toward the besiegers)
// rings: polygon (curtain line), wall class, towers at every vertex (r), mid-curtain stations (towers, gatehouse),
// posterns/water gates; ditch/moat offset from the curtain line. DESIGN, after real plans (siege-research.md §17).
const LAYOUTS = {
  hill: {
    name: "Hill castle", note: "An enclosure castle on a hilltop, after Goodrich and Kidwelly: one curtain with six round towers, a twin-towered gatehouse, a great square keep, and a bailey with hall, chapel, kitchen, stables and well; a dry rock-cut ditch.",
    ground: "rock",
    rings: [{ id: "main", wall: "curtain", pts: [[-30, 26], [30, 26], [38, -2], [26, -30], [-26, -30], [-38, -2]], towerR: 5.5,
      mids: [{ edge: 0, t: 0.5, kind: "gatehouse" }], posterns: [{ edge: 3, t: 0.28, kind: "postern" }], ditch: { off: 17, width: 9 } }],
    keep: { x: -6, y: -13, w: 20, d: 20 },
    buildings: [{ kind: "hall", x: 18, y: -15, w: 18, d: 9 }, { kind: "kitchen", x: 18, y: -4, w: 9, d: 7 }, { kind: "chapel", x: 20, y: 9, w: 12, d: 7 },
      { kind: "stable", x: -20, y: 12, w: 15, d: 6 }, { kind: "well", x: 5, y: 5, r: 1.2 }],
  },
  concentric: {
    name: "Concentric castle", note: "Two curtains, one within the other, after Beaumaris and Dover: a low outer curtain with small towers and an offset gate, the lists between, and a high inner curtain with great towers, a gatehouse and a keep inside.",
    ground: "earth",
    rings: [
      { id: "outer", wall: "outer", pts: [[-54, 54], [54, 54], [54, -54], [-54, -54]], towerR: 4.2,
        mids: [{ edge: 0, t: 0.67, kind: "gatehouse", w: 14, d: 12 }, { edge: 0, t: 0.25, kind: "tower" }, { edge: 1, t: 0.5, kind: "tower" }, { edge: 2, t: 0.5, kind: "tower" }, { edge: 3, t: 0.5, kind: "tower" }],
        posterns: [{ edge: 2, t: 0.25, kind: "postern" }], ditch: { off: 14, width: 10 } },
      { id: "inner", wall: "inner", pts: [[-32, 32], [32, 32], [32, -32], [-32, -32]], towerR: 6,
        mids: [{ edge: 0, t: 0.5, kind: "gatehouse" }, { edge: 1, t: 0.5, kind: "tower" }, { edge: 2, t: 0.5, kind: "tower" }, { edge: 3, t: 0.5, kind: "tower" }] },
    ],
    keep: { x: 0, y: -4, w: 20, d: 20 },
    buildings: [{ kind: "hall", x: -17, y: -22, w: 16, d: 8 }, { kind: "kitchen", x: 17, y: -21, w: 9, d: 7 }, { kind: "chapel", x: 18, y: 14, w: 11, d: 7 },
      { kind: "stable", x: -18, y: 14, w: 13, d: 6 }, { kind: "well", x: 15, y: -8, r: 1.2 }],
  },
  river: {
    name: "River castle", note: "A castle on a river bank, after Rhuddlan and Conwy: a rectangular curtain with round towers, a gatehouse over a wet moat on the landward side, and a water gate to a quay on the river, where it can be supplied by boat.",
    ground: "clay",
    rings: [{ id: "main", wall: "curtain", pts: [[-40, 24], [40, 24], [40, -24], [-40, -24]], towerR: 5.5,
      mids: [{ edge: 0, t: 0.5, kind: "gatehouse" }, { edge: 2, t: 0.5, kind: "tower" }], posterns: [{ edge: 2, t: 0.25, kind: "watergate" }],
      moat: { off: 15, width: 11, edges: [3, 0, 1] } }],
    keep: { x: -20, y: -6, w: 18, d: 18 },
    buildings: [{ kind: "hall", x: 16, y: -12, w: 18, d: 8 }, { kind: "chapel", x: 18, y: 10, w: 11, d: 7 }, { kind: "kitchen", x: 3, y: -13, w: 8, d: 7 },
      { kind: "stable", x: -18, y: 14, w: 14, d: 6 }, { kind: "well", x: 2, y: 2, r: 1.2 }],
  },
};
export const CASTLE_LAYOUTS = Object.fromEntries(Object.entries(LAYOUTS).map(([k, v]) => [k, { name: v.name, note: v.note }]));

// ─────────────────────────────────────────────────────────────── building a castle
export function castleFromLayout(w, layout, a3, a4) {
  const opt = typeof a3 === "number" ? { ...(a4 || {}), team: a3 } : { ...(a3 || {}) };
  const L = typeof layout === "string" ? LAYOUTS[layout] : layout; if (!L) throw new Error("castle layout? " + layout);
  const team = opt.team ?? 1, fac = opt.facing ?? Math.PI / 2, cx = opt.x ?? w.map.size / 2, cy = opt.y ?? w.map.size / 2;
  w.castles ||= []; w.buildings ||= []; const nB0 = w.buildings.length;
  const F = [Math.cos(fac), Math.sin(fac)], R = [Math.sin(fac), -Math.cos(fac)]; // local +y → F (toward the besiegers), +x → R
  const P = (lx, ly) => [cx + lx * R[0] + ly * F[0], cy + lx * R[1] + ly * F[1]];
  const rotOf = (la) => Math.atan2(Math.cos(la) * R[1] + Math.sin(la) * F[1], Math.cos(la) * R[0] + Math.sin(la) * F[0]); // local angle → world
  const C = { id: (w.nextCastle = (w.nextCastle || 0) + 1), team, name: opt.name || L.name, layout: typeof layout === "string" ? layout : "custom", x: cx, y: cy, facing: fac,
    walkH: DIMS.curtain.walkH, parts: [], walkways: { nodes: [], edges: [] }, links: [], keep: null, bailey: null, rings: [], gates: [], posterns: [] };
  Object.defineProperty(C, "_", { value: { tl: [], fields: new Map(), flows: new Map(), ver: 1, gsig: "", grid: null, ground: [], bRegion: new Map() }, enumerable: false });
  const part = (p) => { p.id = C.parts.length + 1; C.parts.push(p); return p; };
  const N = C.walkways.nodes, E = C.walkways.edges;
  const node = (x, y, lvl, h) => { const n = { id: N.length, x, y, lvl, h, adj: [], links: [] }; N.push(n); return n; };
  const edge = (a, b, lvl, wdt, h, kind, extra) => { const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 0.01; const e = { id: E.length, a: a.id, b: b.id, lvl, w: wdt, h, len, ux: dx / len, uy: dy / len, kind, gone: false, ...extra }; E.push(e); a.adj.push(e.id); b.adj.push(e.id); return e; };
  const ground = L.ground || "earth";

  // ---- the rings: stations (towers, gatehouses) round each polygon, curtains between them
  for (const ring of L.rings) {
    const D = DIMS[ring.wall] || DIMS.curtain, poly = ring.pts.map(([x, y]) => P(x, y)), n = poly.length;
    const cen = poly.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0]);
    C.rings.push({ id: ring.id, poly, wall: ring.wall });
    const outN = (k) => { const a = poly[k], b = poly[(k + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); let nx = dy / l, ny = -dx / l; if ((a[0] - cen[0]) * nx + (a[1] - cen[1]) * ny < 0) { nx = -nx; ny = -ny; } return [nx, ny]; };
    const stations = [];
    for (let k = 0; k < n; k++) {
      const n0 = outN((k + n - 1) % n), n1 = outN(k), bx = n0[0] + n1[0], by = n0[1] + n1[1], bl = Math.hypot(bx, by) || 1, r = ring.towerR || DIMS.tower.r;
      stations.push({ kind: "tower", px: poly[k][0], py: poly[k][1], x: poly[k][0] + bx / bl * r * DIMS.tower.project, y: poly[k][1] + by / bl * r * DIMS.tower.project, r, edge: k, t: 0 });
      const mids = (ring.mids || []).filter((m) => m.edge === k).sort((p, q) => p.t - q.t);
      for (const m of mids) {
        const a = poly[k], b = poly[(k + 1) % n], px = a[0] + (b[0] - a[0]) * m.t, py = a[1] + (b[1] - a[1]) * m.t, on = outN(k), r = m.r || (ring.towerR || DIMS.tower.r) * (m.kind === "tower" ? 0.9 : 1);
        if (m.kind === "gatehouse") stations.push({ kind: "gatehouse", px, py, x: px, y: py, edge: k, t: m.t, w: m.w || DIMS.gate.w, d: m.d || DIMS.gate.d, on });
        else stations.push({ kind: "tower", px, py, x: px + on[0] * r * DIMS.tower.project, y: py + on[1] * r * DIMS.tower.project, r, edge: k, t: m.t });
      }
    }
    // the parts and their buildings
    for (const s of stations) {
      if (s.kind === "tower") {
        const top = D.walkH + DIMS.tower.above;
        const b = EC.placeBuilding(w, team, "tower", s.x, s.y, 0, true); b.r = s.r; b.castle = C.id;
        s.part = part({ kind: "tower", ring: ring.id, x: s.x, y: s.y, shape: "round", r: s.r, h: top + 2, walkH: D.walkH, floors: [0, Math.round(D.walkH / 2 * 10) / 10, D.walkH, top], walkLvl: L_WALK, topLvl: L_TOP, bid: b.id, ground });
        s.b = b;
      } else {
        const a = poly[s.edge], bq = poly[(s.edge + 1) % n], ux = bq[0] - a[0], uy = bq[1] - a[1], ul = Math.hypot(ux, uy), lu = [ux / ul, uy / ul];
        let rot = Math.atan2(lu[1], lu[0]); // local a along the curtain; +b = (−sin rot, cos rot) must point out
        if (-Math.sin(rot) * s.on[0] + Math.cos(rot) * s.on[1] < 0) rot += Math.PI;
        const hw = s.w / 2, pw = DIMS.gate.passage / 2, Rr = (hw - pw) / 2, b0 = -s.d * 0.42, b1 = s.d * 0.58, top = D.walkH + 5.5;
        const G = gframe(s.x, s.y, rot);
        const b = EC.placeBuilding(w, team, "gatehouse", s.x, s.y, rot, true);
        Object.assign(b, { gx1: s.x - lu[0] * hw, gy1: s.y - lu[1] * hw, gx2: s.x + lu[0] * hw, gy2: s.y + lu[1] * hw, castle: C.id });
        const mh = []; for (let k = 0; k < 4; k++) { const bb = b0 + 2 + k * (b1 - Rr - b0 - 3) / 3; mh.push({ x: G(0, bb)[0], y: G(0, bb)[1] }); }
        s.part = part({ kind: "gatehouse", ring: ring.id, x: s.x, y: s.y, rot, w: s.w, d: s.d, passage: DIMS.gate.passage, floors: [0, D.walkH, top], walkH: D.walkH, walkLvl: L_WALK, topLvl: L_TOP, h: top + 2,
          portcullis: DIMS.gate.portcullis, portcullises: [{ ...xy(G(0, b1 - Rr)), outer: true }, { ...xy(G(0, b0 + 0.6)), outer: false }], murderHoles: mh, machicolated: true, bid: b.id, ground, pw, R: Rr, b0, b1 });
        s.b = b; s.rot = rot; s.G = G; s.hw = hw; C.gates.push(s.part);
      }
    }
    // curtains: from the edge of one station to the edge of the next, along the polygon line
    const walkNodesOf = new Map(); // station → [{node, dir}] (walk ends that reach it)
    for (let q = 0; q < stations.length; q++) {
      const s0 = stations[q], s1 = stations[(q + 1) % stations.length];
      const lx = s1.px - s0.px, ly = s1.py - s0.py, ll = Math.hypot(lx, ly), u = [lx / ll, ly / ll];
      const cut = (s, from, dir) => s.kind === "gatehouse" ? s.hw : circleExit(s.x, s.y, s.r, from[0], from[1], dir);
      const t0 = cut(s0, [s0.px, s0.py], u), t1 = ll - cut(s1, [s1.px, s1.py], [-u[0], -u[1]]);
      if (t1 - t0 < 2) continue;
      const x0 = s0.px + u[0] * t0, y0 = s0.py + u[1] * t0, x1 = s0.px + u[0] * t1, y1 = s0.py + u[1] * t1;
      const b = EC.placeWall(w, team, "stone_wall", x0, y0, x1, y1, true);
      Object.assign(b, { featType: "curtain_wall", wallH: D.h, walkH: D.walkH, wallTh: D.th, castle: C.id });
      const nm = EC.wallModules(b);
      const cp = part({ kind: "curtain", ring: ring.id, x0, y0, x1, y1, th: D.th, h: D.h, height: D.h, walkH: D.walkH, walkLvl: L_WALK, bid: b.id, mods: nm, ground, hoard: false });
      // the walk: one edge per module, on top of the wall behind the parapet (inward of the centre line)
      const on = outN(s0.edge === s1.edge || s1.t === 0 ? s0.edge : s0.edge); const inw = [-on[0], -on[1]], off = D.parapet / 2;
      const wn = []; for (let k = 0; k <= nm; k++) { const f = k / nm; wn.push(node(x0 + (x1 - x0) * f + inw[0] * off, y0 + (y1 - y0) * f + inw[1] * off, L_WALK, D.walkH)); }
      for (let k = 0; k < nm; k++) edge(wn[k], wn[k + 1], L_WALK, D.th - D.parapet, D.walkH, "walk", { bid: b.id, mod: k, part: cp.id, nx: on[0], ny: on[1] });
      cp.walkNodes = [wn[0].id, wn[nm].id];
      (walkNodesOf.get(s0) || walkNodesOf.set(s0, []).get(s0)).push(wn[0]);
      (walkNodesOf.get(s1) || walkNodesOf.set(s1, []).get(s1)).push(wn[nm]);
      // a straight stair up the inner face of a long curtain (DESIGN: one per curtain over 36 m, at its middle)
      if (t1 - t0 > 36) {
        const mid = nm >> 1, mx = (wn[mid].x), my = (wn[mid].y), sx = mx + inw[0] * (D.th / 2 + 1.2) - u[0] * 5, sy = my + inw[1] * (D.th / 2 + 1.2) - u[1] * 5;
        addLinkInternal(C, { kind: "stair", a: { lvl: 0, x: sx, y: sy }, b: { lvl: L_WALK, x: mx, y: my, node: wn[mid].id }, width: 1, speed: DIMS.stair.straight, head: DIMS.stair.straightHead, h: [0, D.walkH], src: "castle", part: cp.id });
      }
      // a postern / water gate in this curtain
      for (const pq of ring.posterns || []) {
        if (pq.edge !== s0.edge || s1.edge !== s0.edge && s1.t === 0 && false) continue;
        const a = poly[pq.edge], bq = poly[(pq.edge + 1) % n], px = a[0] + (bq[0] - a[0]) * pq.t, py = a[1] + (bq[1] - a[1]) * pq.t;
        const along = (px - x0) * u[0] + (py - y0) * u[1]; if (along < 2 || along > (t1 - t0) - 2) continue;
        const on2 = outN(pq.edge), d = D.th / 2 + (pq.kind === "watergate" ? 3.5 : 1.2);
        const link = addLinkInternal(C, { kind: "door", a: { lvl: 0, x: px - on2[0] * (D.th / 2 + 1.2), y: py - on2[1] * (D.th / 2 + 1.2) }, b: { lvl: 0, x: px + on2[0] * d, y: py + on2[1] * d }, width: 1, speed: 1.0, head: 1.2, blocked: true, src: "castle" });
        const pp = part({ kind: "postern", sub: pq.kind, ring: ring.id, x: px, y: py, nx: on2[0], ny: on2[1], open: false, link, curtain: cp.id });
        link.part = pp.id; C.posterns.push(pp);
      }
    }
    // the stations' insides: rooms at walk level, tops, stairs
    for (const s of stations) {
      const ends = walkNodesOf.get(s) || [];
      const inwardOf = (x, y) => { const dx = cen[0] - x, dy = cen[1] - y, l = Math.hypot(dx, dy) || 1; return [dx / l, dy / l]; };
      if (s.kind === "tower") {
        const p = s.part, ri = s.r - Math.min(2.2, s.r * 0.38), top = p.floors[3], disc = { cx: s.x, cy: s.y, r: ri - 0.3 };
        const c1 = node(s.x, s.y, L_WALK, D.walkH);
        for (const nd of ends) edge(nd, c1, L_WALK, 2 * ri, D.walkH, "room", { part: p.id, clamp: disc, door: "a" });
        const ct = node(s.x, s.y, L_TOP, top), iw = inwardOf(s.x, s.y), ctb = node(s.x - iw[0] * (ri - 0.9), s.y - iw[1] * (ri - 0.9), L_TOP, top);
        edge(ct, ctb, L_TOP, 2 * ri, top, "room", { part: p.id, clamp: disc, top: true });
        const g = [s.x + iw[0] * (s.r + 1.2), s.y + iw[1] * (s.r + 1.2)];
        p.stairs = [
          addLinkInternal(C, { kind: "stair", a: { lvl: 0, x: g[0], y: g[1] }, b: { lvl: L_WALK, x: s.x, y: s.y, node: c1.id }, width: 1, speed: DIMS.stair.spiral, head: DIMS.stair.spiralHead, len: D.walkH * DIMS.stair.spiralLen, h: [0, D.walkH], spiral: true, src: "castle", part: p.id, bid: p.bid }),
          addLinkInternal(C, { kind: "stair", a: { lvl: L_WALK, x: s.x, y: s.y, node: c1.id }, b: { lvl: L_TOP, x: s.x, y: s.y, node: ct.id }, width: 1, speed: DIMS.stair.spiral, head: DIMS.stair.spiralHead, len: (top - D.walkH) * DIMS.stair.spiralLen, h: [D.walkH, top], spiral: true, src: "castle", part: p.id, bid: p.bid }),
        ];
        p.nodes = { room: c1.id, top: ct.id }; p.topR = disc.r; // (the open top's floor inside the parapet: its capacity, castlePlace)
      } else {
        const p = s.part, G = s.G, pw = p.pw, Rr = p.R, b0 = p.b0, b1 = p.b1, bm = (b0 + b1 - Rr) / 2, top = p.floors[2], hw = s.hw;
        const rect = { cx: G(0, bm)[0], cy: G(0, bm)[1], ca: Math.cos(s.rot), sa: Math.sin(s.rot), hw: hw - 1.8, hd: (b1 - Rr - b0) / 2 - 0.4 };
        const L1 = node(...G(-(pw + Rr), bm), L_WALK, D.walkH), R1 = node(...G(pw + Rr, bm), L_WALK, D.walkH);
        edge(L1, R1, L_WALK, (b1 - Rr - b0) - 1.2, D.walkH, "room", { part: p.id, clamp: rect });
        for (const nd of ends) { const la = (nd.x - s.x) * Math.cos(s.rot) + (nd.y - s.y) * Math.sin(s.rot); edge(nd, la < 0 ? L1 : R1, L_WALK, 2.2, D.walkH, "room", { part: p.id, clamp: rect, door: "a" }); }
        const rect2 = { cx: G(0, (b0 + b1) / 2)[0], cy: G(0, (b0 + b1) / 2)[1], ca: rect.ca, sa: rect.sa, hw: hw - 0.9, hd: (b1 - b0) / 2 - 0.9 };
        const T0 = node(...G(-(hw - 1.6), bm), L_TOP, top), T1 = node(...G(hw - 1.6, bm), L_TOP, top), Tm = node(...G(pw + Rr, bm), L_TOP, top);
        edge(T0, Tm, L_TOP, b1 - b0 - 1.6, top, "room", { part: p.id, clamp: rect2, top: true }); edge(Tm, T1, L_TOP, b1 - b0 - 1.6, top, "room", { part: p.id, clamp: rect2, top: true });
        p.stairs = [];
        for (const [sg, nd] of [[-1, L1], [1, R1]]) {
          const g = G(sg * (pw + Rr), b0 - 1.2);
          p.stairs.push(addLinkInternal(C, { kind: "stair", a: { lvl: 0, x: g[0], y: g[1] }, b: { lvl: L_WALK, x: nd.x, y: nd.y, node: nd.id }, width: 1, speed: DIMS.stair.straight, head: DIMS.stair.straightHead, len: D.walkH * 1.6, h: [0, D.walkH], src: "castle", part: p.id }));
        }
        p.stairs.push(addLinkInternal(C, { kind: "stair", a: { lvl: L_WALK, x: R1.x, y: R1.y, node: R1.id }, b: { lvl: L_TOP, x: Tm.x, y: Tm.y, node: Tm.id }, width: 1, speed: DIMS.stair.spiral, head: DIMS.stair.spiralHead, len: (top - D.walkH) * DIMS.stair.spiralLen, h: [D.walkH, top], spiral: true, src: "castle", part: p.id }));
        p.nodes = { chamber: L1.id, roof: Tm.id }; p.rects = { chamber: rect, roof: rect2 };
      }
    }
    // the ditch or moat round the ring (a causeway left before each gate)
    const dq = ring.ditch || ring.moat;
    if (dq) {
      const op = offsetPoly(poly, dq.off, cen), type = ring.moat ? "moat" : "ditch", segs = [];
      for (let k = 0; k < n; k++) {
        if (ring.moat && dq.edges && !dq.edges.includes(k)) continue;
        const a = op[k], b = op[(k + 1) % n], gates = stations.filter((s) => s.kind === "gatehouse" && s.edge === k);
        let cuts = [[0, 1]];
        const Lk = Math.hypot(b[0] - a[0], b[1] - a[1]);
        for (const g of gates) { const tt = ((g.px - a[0]) * (b[0] - a[0]) + (g.py - a[1]) * (b[1] - a[1])) / (Lk * Lk), hwc = (DIMS.gate.passage / 2 + 1.6) / Lk; cuts = cuts.flatMap(([p, q]) => tt > p && tt < q ? [[p, tt - hwc], [tt + hwc, q]] : [[p, q]]); }
        for (const [p, q] of cuts) if (q - p > 0.01) segs.push([a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p, a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q]);
      }
      const feats = segs.map(([x0, y0, x1, y1]) => addFeature(w, { type, x0, y0, x1, y1, width: dq.width, src: "building", castle: C.id, team }));
      part({ kind: type, ring: ring.id, width: dq.width, segs, wet: type === "moat", features: feats.length });
    }
  }
  // ---- the keep: storeys (store, hall, chamber, roof); the entrance on the first floor by a forebuilding stair
  const ring0 = C.rings[C.rings.length - 1].poly, cen0 = ring0.reduce((s, p) => [s[0] + p[0] / ring0.length, s[1] + p[1] / ring0.length], [0, 0]);
  C.bailey = { x: cen0[0], y: cen0[1], r: Math.max(...ring0.map((p) => Math.hypot(p[0] - cen0[0], p[1] - cen0[1]))), poly: C.rings[0].poly, inner: C.rings.length > 1 ? ring0 : null };
  if (L.keep) {
    const kq = L.keep, [kx, ky] = P(kq.x, kq.y), rot = rotOf(0), Fk = DIMS.keep.floors, K = { ...DIMS.keep, ...kq };
    const kp = part({ kind: "keep", x: kx, y: ky, rot, w: K.w, d: K.d, floors: Fk.slice(), fore: true, h: Fk[3] + 2, lvls: [L_HALL, L_CHAMBER, L_ROOF], ground });
    C.keep = kp;
    const G = gframe(kx, ky, rot), th = 3, ihw = K.w / 2 - th, ihd = K.d / 2 - th, hw = K.w / 2, hd = K.d / 2;
    const rooms = [L_HALL, L_CHAMBER, L_ROOF].map((lvl, k) => {
      const h = Fk[k + 1], pad = lvl === L_ROOF ? 0.6 : 0.3, rect = { cx: kx, cy: ky, ca: Math.cos(rot), sa: Math.sin(rot), hw: ihw - pad + (lvl === L_ROOF ? 0.5 : 0), hd: ihd - pad + (lvl === L_ROOF ? 0.5 : 0) };
      const m0 = node(...G(0, -(ihd - 1.5)), lvl, h), m1 = node(...G(0, ihd - 1.5), lvl, h);
      edge(m0, m1, lvl, 2 * rect.hw + 0.6, h, "room", { part: kp.id, clamp: rect, top: lvl === L_ROOF });
      return { lvl, h, m0, m1, rect };
    });
    const entry = (room, x, y) => { const nd = node(x, y, room.lvl, room.h); edge(nd, room.m0, room.lvl, 2 * room.rect.hw, room.h, "room", { part: kp.id, clamp: room.rect }); edge(nd, room.m1, room.lvl, 2 * room.rect.hw, room.h, "room", { part: kp.id, clamp: room.rect }); return nd; };
    // the forebuilding on the face toward the bailey's centre (render/castle.js picks the same face)
    const c = Math.cos(rot), s = Math.sin(rot), bx = (cen0[0] - kx) * c + (cen0[1] - ky) * s, by = -(cen0[0] - kx) * s + (cen0[1] - ky) * c;
    const side = Math.abs(bx) > Math.abs(by) ? (bx > 0 ? 1 : 3) : (by > 0 ? 2 : 0), along = side % 2 === 0, sg = side === 0 || side === 3 ? -1 : 1, half = along ? hw : hd;
    const LL = (u, v) => along ? G(u, sg * (hd + v)) : G(sg * (hw + v), u);
    const run = Math.max(3, (Fk[1] - 0.2) / 0.2 * 0.3), u0 = -half + 1.2, u1 = u0 + run, doorU = Math.min(half - 2, u1 + 1.6);
    const foot = LL(u0 - 0.8, 1.6), door = LL(doorU, -th - 0.8);
    const hallDoor = entry(rooms[0], door[0], door[1]);
    kp.stairs = [addLinkInternal(C, { kind: "stair", a: { lvl: 0, x: foot[0], y: foot[1] }, b: { lvl: L_HALL, x: door[0], y: door[1], node: hallDoor.id }, width: 2, speed: DIMS.stair.straight, head: DIMS.stair.straightHead, len: run + 4 + Fk[1], h: [0, Fk[1]], src: "castle", part: kp.id, fore: true })];
    // the stairs within: along the a = +ihw wall, alternately (render/castle.js buildKeep)
    const sa = ihw - 0.85, fl0 = -ihd + 0.8, fl1 = ihd - 0.8;
    for (let k = 0; k < 2; k++) {
      const lo = rooms[k], hi = rooms[k + 1], bLo = k === 0 ? fl1 : fl0, bHi = k === 0 ? fl0 : fl1;
      const nLo = entry(lo, ...G(sa, bLo)), nHi = entry(hi, ...G(sa, bHi));
      kp.stairs.push(addLinkInternal(C, { kind: "stair", a: { lvl: lo.lvl, x: nLo.x, y: nLo.y, node: nLo.id }, b: { lvl: hi.lvl, x: nHi.x, y: nHi.y, node: nHi.id }, width: 1, speed: DIMS.stair.straight, head: DIMS.stair.straightHead, len: Math.abs(bHi - bLo) + hi.h - lo.h, h: [lo.h, hi.h], src: "castle", part: kp.id }));
    }
    kp.nodes = { hall: rooms[0].m0.id, chamber: rooms[1].m0.id, roof: rooms[2].m0.id };
    kp.rooms = rooms.map((r) => ({ lvl: r.lvl, h: r.h, rect: r.rect, e: E.length && E.findIndex((e) => e.a === r.m0.id && e.b === r.m1.id) }));
  }
  for (const bq of L.buildings || []) { const [x, y] = P(bq.x, bq.y); part(bq.kind === "well" ? { kind: "well", x, y, r: bq.r || 1.2 } : { kind: bq.kind, x, y, rot: rotOf(bq.rot || 0), w: bq.w, d: bq.d }); }
  // doorways: how far along a door edge a man is still in the doorway, not yet in the room (the room's walls do not hold him)
  for (const e of E) if (e.door === "a" && e.clamp) { const a = N[e.a]; let t = 0; for (; t < e.len; t += 0.25) { const x = a.x + e.ux * t, y = a.y + e.uy * t, [cx, cy] = clampShape(e.clamp, x, y); if (Math.hypot(cx - x, cy - y) < 0.05) break; } e.doorT = t + 0.3; }
  // ---- into the world
  w.castles.push(C);
  const bbx = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of C.rings) for (const [x, y] of r.poly) { bbx[0] = Math.min(bbx[0], x); bbx[1] = Math.min(bbx[1], y); bbx[2] = Math.max(bbx[2], x); bbx[3] = Math.max(bbx[3], y); }
  const pad = 22 + Math.max(0, ...L.rings.map((r) => (r.ditch || r.moat)?.off + (r.ditch || r.moat)?.width / 2 || 0)) + 20;
  C._.bbox = [Math.max(0, bbx[0] - pad), Math.max(0, bbx[1] - pad), Math.min(w.map.size, bbx[2] + pad), Math.min(w.map.size, bbx[3] + pad)];
  installHooks(w);
  syncBuildingFeatures(w);
  for (const Lk of C.links) prepLink(C, Lk);
  refresh(w, C, true);
  for (let k = nB0; k < w.buildings.length; k++) w.buildings[k].castle ??= C.id; // (every part of it — halls and chapel too — belongs to the castle: the order popup's siege orders, not "raze")
  return C;
}
const xy = (p) => ({ x: p[0], y: p[1] });
// a rect part's frame: (a, b) → world, a along rot, +b = (−sin rot, cos rot)
function gframe(x, y, rot) { const c = Math.cos(rot), s = Math.sin(rot); return (a, b) => [x + a * c - b * s, y + a * s + b * c]; }
// where a line from (px, py) along u leaves a circle (distance along u), for a start inside the circle
function circleExit(cx, cy, r, px, py, u) { const dx = px - cx, dy = py - cy, b = dx * u[0] + dy * u[1], c = dx * dx + dy * dy - r * r, disc = b * b - c; return disc < 0 ? 0 : Math.max(0, -b + Math.sqrt(disc)); }
function offsetPoly(poly, off, cen) {
  const n = poly.length, lines = [];
  for (let k = 0; k < n; k++) { const a = poly[k], b = poly[(k + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); let nx = dy / l, ny = -dx / l; if ((a[0] - cen[0]) * nx + (a[1] - cen[1]) * ny < 0) { nx = -nx; ny = -ny; } lines.push([a[0] + nx * off, a[1] + ny * off, dx / l, dy / l]); }
  return lines.map((l1, k) => { const l0 = lines[(k + n - 1) % n], det = l0[2] * l1[3] - l0[3] * l1[2]; if (Math.abs(det) < 1e-6) return [l1[0], l1[1]]; const t = ((l1[0] - l0[0]) * l1[3] - (l1[1] - l0[1]) * l1[2]) / det; return [l0[0] + l0[2] * t, l0[1] + l0[3] * t]; });
}

// a site: SIEGE-MODE may call this, or choose its own
export function castleSite(map, layout = "hill") {
  const S = map.size, m = 560, step = 40; let best = null, bs = -Infinity; // (m: the camera keeps its view centre 450 m from the edge of the world — render/camera.js EDGE — and a castle must be seen whole)
  const slopeAt = (x, y) => Math.hypot(...map.grad(x, y));
  const wetNear = (x, y, r) => { for (let a = 0; a < 12; a++) for (const q of [0.4, 0.8, 1]) if (map.water(x + Math.cos(a * 0.524) * r * q, y + Math.sin(a * 0.524) * r * q) > 0.05) return true; return map.water(x, y) > 0.05; };
  for (let y = m; y <= S - m; y += step) for (let x = m; x <= S - m; x += step) {
    let s;
    if (layout === "river") {
      if (wetNear(x, y, 30)) continue;
      let dir = -1; for (let a = 0; a < 16; a++) { const c = Math.cos(a * 0.3927), sn = Math.sin(a * 0.3927); if (map.water(x + c * 48, y + sn * 48) > 0.8 && map.water(x + c * 34, y + sn * 34) < 0.3) { dir = a; break; } }
      if (dir < 0) continue;
      s = -slopeAt(x, y) * 50 - Math.hypot(x - S / 2, y - S / 2) * 0.02;
      if (s > bs) { bs = s; const a = dir * 0.3927; best = { x: x - Math.cos(a) * 4, y: y - Math.sin(a) * 4, facing: a + Math.PI }; }
      continue;
    }
    if (wetNear(x, y, 90)) continue;
    let rim = 0; for (let a = 0; a < 8; a++) rim += map.h(x + Math.cos(a * 0.785) * 160, y + Math.sin(a * 0.785) * 160) / 8;
    let flat = 0; for (let a = 0; a < 8; a++) flat = Math.max(flat, slopeAt(x + Math.cos(a * 0.785) * 30, y + Math.sin(a * 0.785) * 30));
    if (flat > 0.25) continue;
    s = layout === "hill" ? (map.h(x, y) - rim) * 3 - flat * 40 : -flat * 80 - Math.hypot(x - S / 2, y - S / 2) * 0.05;
    if (s > bs) { bs = s; best = { x, y, facing: Math.atan2(S / 2 - y, S / 2 - x) }; }
  }
  if (!best && layout === "river") return castleSite(map, "hill");
  if (!best) best = { x: S / 2, y: S / 2, facing: -Math.PI / 2 };
  if (Math.hypot(best.x - S / 2, best.y - S / 2) < 1) best.facing = -Math.PI / 2;
  return best;
}

// ─────────────────────────────────────────────────────────────── links
function addLinkInternal(C, L) { C.links.push(L); if (C._.grid) prepLink(C, L); return L; }
export function addLink(w, castle, link) {
  const C = castleOf(w, castle); if (!C || !link) return null;
  if (!C.links.includes(link)) C.links.push(link);
  prepLink(C, link); if (C._.grid) linkEnds(C); dirty(C);
  return link;
}
export function removeLink(w, castle, link) {
  const C = castleOf(w, castle); if (!C || !link) return null;
  const k = C.links.indexOf(link); if (k >= 0) C.links.splice(k, 1);
  for (const T of link._t || []) T.dead = true;
  link._t = null; dirty(C);
  return null;
}
const castleOf = (w, c) => c && typeof c === "object" ? (c._ ? c : null) : (w.castles || []).find((q) => q.id === c) || null;
// a link's traversable pieces (a breach has two: the outer slope and the inner) → C._.tl
function prepLink(C, L) {
  if (L._t) for (const T of L._t) T.dead = true;
  const pairs = L.c ? [[L.a, L.b], [L.c, L.b]] : [[L.a, L.b]];
  L._t = pairs.map(([a, b]) => {
    const ea = endOf(C, a), eb = endOf(C, b);
    const dh = (b.h ?? L.h?.[1] ?? (b.lvl ? levelH0(C, b) : 0)) - (a.h ?? L.h?.[0] ?? (a.lvl ? levelH0(C, a) : 0));
    const len = L.len ?? Math.hypot(b.x - a.x, b.y - a.y, dh);
    const T = { L, idx: C._.tl.length, kind: L.kind, ends: [ea, eb], len: Math.max(0.5, len), speed: L.speed || 0.5, head: L.head ?? (L.kind === "ladder" ? 4 : L.kind === "breach" ? 0.7 : 1.2), lanes: new Float64Array(Math.max(1, Math.round(L.width || 1))), q: 0, qn: 0, dead: false };
    ea.h = ea.lvl ? (a.h ?? L.h?.[0] ?? levelH0(C, a)) : 0; eb.h = eb.lvl ? (b.h ?? L.h?.[1] ?? levelH0(C, b)) : 0;
    T.time = T.len / T.speed;
    C._.tl.push(T);
    return T;
  });
  C._.ver++;
}
function levelH0(C, p) { const n = p.node !== undefined ? C.walkways.nodes[p.node] : nearestNode(C, p.x, p.y, p.lvl); return n ? n.h : C.walkH; }
// an end: on a level it is a walkway node (the one given, else the nearest of that level); on the ground a ground node
function endOf(C, p) {
  const N = C.walkways.nodes;
  if (p.lvl > 0) { const n = p.node !== undefined ? N[p.node] : nearestNode(C, p.x, p.y, p.lvl); return { lvl: p.lvl, x: p.x, y: p.y, node: n ? n.id : -1 }; }
  const n = { id: N.length, x: p.x, y: p.y, lvl: 0, h: 0, adj: [], links: [], ground: true };
  N.push(n);
  return { lvl: 0, x: p.x, y: p.y, node: n.id };
}
function nearestNode(C, x, y, lvl) {
  let best = null, bd = Infinity;
  for (const n of C.walkways.nodes) { if (n.lvl !== lvl || n.ground) continue; const d = (n.x - x) ** 2 + (n.y - y) ** 2; if (d < bd) { bd = d; best = n; } }
  return best;
}
// the pieces a man of `team` (mounted?) may use
const usable = (T, team, mounted) => !T.dead && !T.L.blocked && !T.L.managed && !(T.L.team !== undefined && T.L.team !== team) && !(mounted && T.kind !== "door") && T.ends[0].node >= 0 && T.ends[1].node >= 0;

// ─────────────────────────────────────────────────────────────── the ground grid (1 m): solids, regions, flow fields
function buildGrid(w, C) {
  const [x0, y0, x1, y1] = C._.bbox, nx = Math.ceil((x1 - x0) / CELL), ny = Math.ceil((y1 - y0) / CELL), n = nx * ny;
  const G = C._.grid && C._.grid.nx === nx && C._.grid.ny === ny ? C._.grid : { x0, y0, nx, ny, mul: new Float32Array(n), region: new Int32Array(n), flows: new Map() };
  const mul = G.mul; mul.fill(1);
  const cap = (ax, ay, bx, by, r, v) => { // cells whose centre is within r of the segment get v (Infinity = solid; else the max)
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - x0) / CELL)), i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx) + r - x0) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by) - r - y0) / CELL)), j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by) + r - y0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const cx = x0 + (i + 0.5) * CELL, cy = y0 + (j + 0.5) * CELL; if (pointSeg(cx, cy, ax, ay, bx, by) <= r) { const k = j * nx + i; if (v > mul[k]) mul[k] = v; } }
  };
  const rect = (cx, cy, rot, hw, hd, v) => { const c = Math.cos(rot), s = Math.sin(rot), R = Math.hypot(hw, hd);
    const i0 = Math.max(0, Math.floor((cx - R - x0) / CELL)), i1 = Math.min(nx - 1, Math.floor((cx + R - x0) / CELL)), j0 = Math.max(0, Math.floor((cy - R - y0) / CELL)), j1 = Math.min(ny - 1, Math.floor((cy + R - y0) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const dx = x0 + (i + 0.5) * CELL - cx, dy = y0 + (j + 0.5) * CELL - cy, a = dx * c + dy * s, b = -dx * s + dy * c; if (Math.abs(a) <= hw && Math.abs(b) <= hd) { const k = j * nx + i; if (v > mul[k]) mul[k] = v; } } };
  // features: walls, shut gates, barricades solid; moats solid; ditches and breach rubble slow
  eachFeatureNear(w, x0, y0, x1, y1, 0, (f) => {
    const D = FEATURES[f.type]; if (!D) return false;
    if (f.type === "moat") cap(f.x0, f.y0, f.x1, f.y1, (f.width || 10) / 2, Infinity);
    else if (D.climbS && D.cross?.foot === Infinity) cap(f.x0, f.y0, f.x1, f.y1, (f.width || D.thickness || 1) / 2 + 0.2, Infinity);
    else if (f.type === "ditch") cap(f.x0, f.y0, f.x1, f.y1, (f.width || 2.5) / 2, 3);
    else if (f.type === "breach_rubble") cap(f.x0, f.y0, f.x1, f.y1, (f.width || 6) / 2, 2.5);
    return false;
  });
  const bOf = (id) => id === undefined ? null : w.buildings.find((b) => b.id === id);
  for (const p of C.parts) {
    if (p.kind === "tower") { const b = bOf(p.bid); if (b?.ruin) cap(p.x, p.y, p.x, p.y, p.r + 4, 3); else cap(p.x, p.y, p.x, p.y, p.r + 0.2, Infinity); }
    else if (p.kind === "gatehouse") {
      const G2 = gframe(p.x, p.y, p.rot), b = bOf(p.bid);
      for (const sg of [-1, 1]) { const c = G2(sg * (p.pw + p.R + 0.1), (p.b0 + p.b1) / 2); rect(c[0], c[1], p.rot, p.R + 0.1, (p.b1 - p.b0) / 2, Infinity); }
      if (b && b.portDown && (b.gpc ?? 1) > 0 && !b.gateBroken) { const q = p.portcullises[0]; const ux = Math.cos(p.rot), uy = Math.sin(p.rot); cap(q.x - ux * p.pw, q.y - uy * p.pw, q.x + ux * p.pw, q.y + uy * p.pw, 0.5, Infinity); }
    } else if (p.kind === "keep" || p.kind === "hall" || p.kind === "chapel" || p.kind === "stable" || p.kind === "kitchen") rect(p.x, p.y, p.rot, p.w / 2 + 0.2, p.d / 2 + 0.2, Infinity);
    else if (p.kind === "well") cap(p.x, p.y, p.x, p.y, p.r + 0.2, Infinity);
  }
  // regions: 8-connected open cells (no corner cutting)
  const reg = G.region; reg.fill(-1); let nr = 0; const st = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (reg[s] >= 0 || mul[s] === Infinity) continue;
    let sp = 0; st[sp++] = s; reg[s] = nr;
    while (sp) { const k = st[--sp], i = k % nx, j = (k / nx) | 0;
      for (let d = 0; d < 8; d++) { const di = DI[d], dj = DJ[d], ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue; const m = jj * nx + ii; if (reg[m] >= 0 || mul[m] === Infinity) continue;
        if (di && dj && (mul[j * nx + ii] === Infinity || mul[jj * nx + i] === Infinity)) continue; reg[m] = nr; st[sp++] = m; } }
    nr++;
  }
  G.nreg = nr; G.flows.clear(); G.ver = (G.ver || 0) + 1;
  C._.grid = G;
  return G;
}
const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1], DC = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
const cellOfG = (G, x, y) => { const i = Math.floor((x - G.x0) / CELL), j = Math.floor((y - G.y0) / CELL); return i < 0 || j < 0 || i >= G.nx || j >= G.ny ? -1 : j * G.nx + i; };
const cellX = (G, k) => G.x0 + (k % G.nx + 0.5) * CELL, cellY = (G, k) => G.y0 + (((k / G.nx) | 0) + 0.5) * CELL;
// the nearest open cell to (x, y) (clamped into the grid), or -1
function openCell(G, x, y, maxR = 6) {
  const cx = clamp(x, G.x0 + 0.5, G.x0 + G.nx * CELL - 0.5), cy = clamp(y, G.y0 + 0.5, G.y0 + G.ny * CELL - 0.5);
  const k = cellOfG(G, cx, cy); if (k >= 0 && G.mul[k] !== Infinity) return k;
  const i0 = k % G.nx, j0 = (k / G.nx) | 0; let best = -1, bd = Infinity;
  for (let r = 1; r <= maxR; r++) { for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; const i = i0 + di, j = j0 + dj; if (i < 0 || j < 0 || i >= G.nx || j >= G.ny) continue; const m = j * G.nx + i; if (G.mul[m] === Infinity) continue; const d = di * di + dj * dj; if (d < bd) { bd = d; best = m; } } if (best >= 0) return best; }
  return -1;
}
export function regionAt(C, x, y) { const G = C._.grid; const k = openCell(G, x, y); return k < 0 ? -1 : G.region[k]; }
// cost-distance (m) to a target cell over the grid, 8 neighbours, no corner cutting; cached per grid version
function flowField(C, tk) {
  const G = C._.grid; let D = G.flows.get(tk); if (D) return D;
  if (G.flows.size > 96) G.flows.clear();
  const n = G.nx * G.ny, nx = G.nx, ny = G.ny, mul = G.mul; D = new Float32Array(n).fill(Infinity);
  const H = heapG; H.clear(); D[tk] = 0; H.push(tk, 0);
  while (H.n) {
    const k = H.pop(), dk = H.lastP; if (dk > D[k]) continue;
    const i = k % nx, j = (k / nx) | 0;
    for (let d = 0; d < 8; d++) {
      const ii = i + DI[d], jj = j + DJ[d]; if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const m = jj * nx + ii, cm = mul[m]; if (cm === Infinity) continue;
      if (d >= 4 && (mul[j * nx + ii] === Infinity || mul[jj * nx + i] === Infinity)) continue;
      const nd = Math.fround(dk + DC[d] * (cm + mul[k]) * 0.5 * CELL); // (in float32 like D: else a value stored rounded up is never settled)
      if (nd < D[m]) { D[m] = nd; H.push(m, nd); }
    }
  }
  G.flows.set(tk, D);
  return D;
}
class Heap { constructor() { this.k = new Int32Array(1024); this.p = new Float64Array(1024); this.n = 0; this.lastP = 0; }
  clear() { this.n = 0; }
  push(k, p) { if (this.n >= this.k.length) { const K = new Int32Array(this.k.length * 2); K.set(this.k); this.k = K; const P = new Float64Array(this.p.length * 2); P.set(this.p); this.p = P; } const K = this.k, P = this.p; let i = this.n++; while (i > 0) { const pa = (i - 1) >> 1; if (P[pa] <= p) break; K[i] = K[pa]; P[i] = P[pa]; i = pa; } K[i] = k; P[i] = p; }
  pop() { const K = this.k, P = this.p, top = K[0]; this.lastP = P[0]; const lk = K[--this.n], lp = P[this.n]; let i = 0; const n = this.n; if (n) { for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && P[c + 1] < P[c]) c++; if (P[c] >= lp) break; K[i] = K[c]; P[i] = P[c]; i = c; } K[i] = lk; P[i] = lp; } return top; } }
const heapG = new Heap(), heapN = new Heap();

// ─────────────────────────────────────────────────────────────── state that follows the siege: breaches, fallen towers, gates
function refresh(w, C, force = false) {
  const bOf = (id) => w.buildings.find((b) => b.id === id);
  let sig = (w.featuresVer || 0) + ":" + (w.features?.length || 0);
  for (const p of C.parts) { if (p.bid === undefined) continue; const b = bOf(p.bid); if (!b) continue; sig += `|${b.ruin ? 1 : 0}${b.breachVer || 0}${b.portDown ? 1 : 0}${b.gateBroken ? 1 : 0}${(b.gpc ?? 1) > 0 ? 1 : 0}${b.mods ? b.mods.reduce((s, v) => s + (v <= 0 ? 1 : 0), 0) : 0}`; }
  for (const pp of C.posterns) sig += pp.open ? "o" : "c";
  if (!force && sig === C._.gsig) return false;
  C._.gsig = sig;
  const G = buildGrid(w, C);
  // walkway pieces that are gone: the walk over a breached module; a fallen tower's rooms, top and stairs
  const E = C.walkways.edges;
  for (const e of E) {
    let gone = false;
    if (e.bid !== undefined) { const b = bOf(e.bid); gone = !b || b.ruin || !!(b.mods && e.mod !== undefined && b.mods[e.mod] <= 0); }
    else if (e.part !== undefined) { const p = C.parts[e.part - 1]; if (p?.bid !== undefined) { const b = bOf(p.bid); gone = !b || (p.kind === "tower" && b.ruin); } }
    e.gone = gone;
  }
  for (const T of C._.tl) {
    if (T.dead) continue;
    const p = T.L.part !== undefined ? C.parts[T.L.part - 1] : null;
    if (p?.kind === "tower" && T.L.src === "castle") { const b = bOf(p.bid); T.L.blocked = !!b?.ruin; }
    if (p?.kind === "postern") T.L.blocked = !p.open;
  }
  linkEnds(C); dirty(C);
  return true;
}
// the feet of links on the ground: their grid cell and region, and the ground nodes by region (path costs between them)
function linkEnds(C) {
  const G = C._.grid, byR = new Map();
  for (const T of C._.tl) {
    if (T.dead) continue;
    for (const e of T.ends) {
      if (e.lvl !== 0) continue;
      const k = openCell(G, e.x, e.y, 4); e.cell = k; e.region = k >= 0 ? G.region[k] : -1; const nd = C.walkways.nodes[e.node]; if (nd) nd.region = e.region;
      if (e.region >= 0) { const a = byR.get(e.region) || byR.set(e.region, []).get(e.region); if (!a.includes(e.node)) a.push(e.node); }
    }
  }
  C._.byR = byR;
}
function dirty(C) { C._.ver++; C._.fields.clear(); C._.linkAt = null; }

// ─────────────────────────────────────────────────────────────── the graph cost field toward a goal
// D[node] = cost (m at walking pace) from the node to the goal, over walkway edges, usable links and the ground
// between the feet of links in the same ground region.
function goalField(C, goal, team, mounted) {
  const key = goal.key + "|" + team + (mounted ? "m" : "");
  let F = C._.fields.get(key); if (F) return F;
  if (C._.fields.size > 2000) C._.fields.clear();
  const N = C.walkways.nodes, E = C.walkways.edges, n = N.length, D = new Float64Array(n).fill(Infinity), tl = C._.tl;
  // node → usable link pieces
  const lk = C._.linkAt && C._.linkAtVer === C._.ver + ":" + team + mounted ? C._.linkAt : null;
  const at = lk || (() => { const m = new Map(); for (const T of tl) { if (!usable(T, team, mounted)) continue; for (let s = 0; s < 2; s++) { const nd = T.ends[s].node; (m.get(nd) || m.set(nd, []).get(nd)).push([T, s]); } } C._.linkAt = m; C._.linkAtVer = C._.ver + ":" + team + mounted; return m; })();
  const H = heapN; H.clear();
  const seed = (k, v) => { if (v < D[k]) { D[k] = v; H.push(k, v); } };
  if (goal.down) { for (const a of C._.byR?.values() || []) for (const nd of a) seed(nd, 0); } // (any way down to the ground)
  else if (goal.lvl > 0) { const e = E[goal.e]; if (e && !e.gone) { seed(e.a, goal.t); seed(e.b, e.len - goal.t); } }
  else { for (const nd of C._.byR?.get(goal.region) || []) seed(nd, Math.hypot(N[nd].x - goal.x, N[nd].y - goal.y) * 1.25); }
  while (H.n) {
    const k = H.pop(), dk = H.lastP; if (dk > D[k]) continue;
    const nd = N[k];
    for (const ei of nd.adj) { const e = E[ei]; if (e.gone) continue; const m = e.a === k ? e.b : e.a, v = dk + e.len; if (v < D[m]) { D[m] = v; H.push(m, v); } }
    const ls = at.get(k); if (ls) for (const [T, s] of ls) { const m = T.ends[1 - s].node, v = dk + (T.time + T.head) * V0; if (v < D[m]) { D[m] = v; H.push(m, v); } }
    if (nd.ground) { const g = nd.region ?? regionOfNode(C, nd); for (const m of C._.byR?.get(g) || []) { if (m === k) continue; const v = dk + Math.hypot(N[m].x - nd.x, N[m].y - nd.y) * 1.25; if (v < D[m]) { D[m] = v; H.push(m, v); } } }
  }
  F = { D, at };
  C._.fields.set(key, F);
  return F;
}
function regionOfNode(C, nd) { for (const T of C._.tl) for (const e of T.ends) if (e.node === nd.id) return (nd.region = e.region); return -1; }

// ─────────────────────────────────────────────────────────────── per-man castle state
function M_(w) {
  const S = w.S; let M = w.castleM;
  if (!M || M.cap < S.cap) {
    const old = M; const cap = S.cap;
    M = { cap, edge: new Int32Array(cap).fill(-1), cas: new Int16Array(cap).fill(-1), link: new Int32Array(cap).fill(-1), lcas: new Int16Array(cap).fill(-1), lp: new Float32Array(cap), ldir: new Uint8Array(cap),
      h: new Float32Array(cap), px: new Float32Array(cap).fill(NaN), py: new Float32Array(cap).fill(NaN), goal: new Array(cap).fill(null), via: new Array(cap).fill(null), viaT: new Float32Array(cap) };
    if (old) for (const k of ["edge", "cas", "link", "lcas", "lp", "ldir", "h", "px", "py", "viaT"]) M[k].set(old[k].subarray(0, Math.min(old.cap, cap)));
    if (old) for (let i = 0; i < old.cap; i++) { M.goal[i] = old.goal[i]; M.via[i] = old.via[i]; }
    w.castleM = M;
  }
  return M;
}

// ─────────────────────────────────────────────────────────────── queries
export const levelOf = (w, i) => w.S.lvl[i];
export function levelHeight(w, i) { const M = w.castleM; return M && i < M.cap ? M.h[i] : 0; }
export const sameLevel = (w, i, o) => w.S.lvl[i] === w.S.lvl[o];
export function castleAt(w, x, y) {
  for (const C of w.castles || []) { const b = C._.bbox; if (x >= b[0] && y >= b[1] && x <= b[2] && y <= b[3]) return C; }
  return null;
}
export function insideCastle(w, x, y) { for (const C of w.castles || []) if (inPoly(C.rings[0].poly, x, y)) return C; return null; }
function inPoly(P, x, y) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { if ((P[i][1] > y) !== (P[j][1] > y) && x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; } return c; }
// hard cover for man i against a missile from (fx, fy) (shot by a man on level fl): merlons on a wall-walk against shots
// from outside (none against the inside or the same walk); loops in a room; a parapet all round a tower top
export function coverFor(w, i, fx, fy, fl = 0) {
  const S = w.S, lv = S.lvl[i], M = w.castleM; if (!lv || !M) return 0;
  if (M.link[i] >= 0) { const C = w.castles[M.lcas[i]], T = C?._.tl[M.link[i]]; return T && T.kind === "stair" ? 0.9 : 0; } // (a stair is inside the tower; a ladder is naked)
  const C = w.castles?.[M.cas[i]], e = C?.walkways.edges[M.edge[i]]; if (!e) return 0;
  const x = S.x[i], y = S.y[i], d = Math.hypot(fx - x, fy - y);
  if (fl === lv && d < 25) return 0; // (along the same walk or floor)
  if (e.kind === "walk") {
    const out = (fx - x) * e.nx + (fy - y) * e.ny; if (out <= 0.5) return 0; // from the bailey side: the walk is open behind
    const high = fl > lv ? 0.55 : 1; // (a plunging shot from a siege tower's top clears the merlons more often)
    return (S.missile[i] ? 0.6 : 0.8) * high; // merlons ~⅔ of the parapet; a bowman shooting through a crenel is exposed
  }
  if (e.top) return 0.7;
  return 0.95; // a room: only through the loops
}
// FLANKING FIRE (ballistics.js target choice, for bowmen up on a castle): a tower or gatehouse stands out from the
// curtain so that its loops and battlements see ALONG the wall's face — the men at its foot, on the ladders, in the
// breach — which the men on the wall-walk itself can hardly see over the parapet without leaning out (that is what
// the hoardings and machicolations are for). → a preference (m) added to a target body's score: + for a shooter on a
// tower or gatehouse at stormers close under the curtain, − for a shooter on the walk at men right under his own stretch.
export const FLANK = { tower: 70, under: -45, reach: 16 };
export function aimBias(w, i, tx, ty) {
  const S = w.S, M = w.castleM; if (!S.lvl[i] || !M || M.edge[i] < 0 || M.link[i] >= 0) return 0;
  const C = w.castles?.[M.cas[i]], e = C?.walkways.edges[M.edge[i]]; if (!e) return 0;
  if (inPoly(C.rings[0].poly, tx, ty)) return 0;
  let best = null, bd = Infinity; for (const q of C.parts) if (q.kind === "curtain") { const d = pointSeg(tx, ty, q.x0, q.y0, q.x1, q.y1); if (d < bd) { bd = d; best = q; } }
  if (!best || bd > FLANK.reach) return 0;
  const p = e.part !== undefined ? C.parts[e.part - 1] : null;
  if (p?.kind === "tower" || p?.kind === "gatehouse") return FLANK.tower * (1 - bd / FLANK.reach / 2);
  if (e.kind === "walk" && e.part === best.id && bd < best.th / 2 + 4) return FLANK.under;
  return 0;
}
export function walkPointNear(w, castle, x, y, lvl = L_WALK, kinds = null) {
  const C = castleOf(w, castle) || castleAt(w, x, y); if (!C) return null;
  const e = nearestEdge(C, x, y, lvl, kinds); if (e < 0) return null;
  const E = C.walkways.edges[e], a = C.walkways.nodes[E.a], t = clamp((x - a.x) * E.ux + (y - a.y) * E.uy, 0, E.len);
  return { castle: C, e, t, x: a.x + E.ux * t, y: a.y + E.uy * t, h: E.h, lvl };
}
function nearestEdge(C, x, y, lvl, kinds = null) {
  const N = C.walkways.nodes, E = C.walkways.edges; let best = -1, bd = Infinity;
  for (const e of E) { if (e.lvl !== lvl || e.gone || (kinds && !kinds.includes(e.kind))) continue; const a = N[e.a], b = N[e.b], d = pointSeg(x, y, a.x, a.y, b.x, b.y); if (d < bd) { bd = d; best = e.id; } }
  return best;
}
export function setLevel(w, i, lvl, x = w.S.x[i], y = w.S.y[i]) {
  const S = w.S, M = M_(w); S.lvl[i] = lvl; S.x[i] = x; S.y[i] = y;
  if (!lvl) { M.edge[i] = -1; M.h[i] = 0; return; }
  const C = castleAt(w, x, y) || w.castles?.[0]; if (!C) { S.lvl[i] = 0; return; }
  M.cas[i] = w.castles.indexOf(C); M.edge[i] = nearestEdge(C, x, y, lvl); snapMan(w, C, M, i);
}
// open ground at (x, y) on a castle's 1 m grid (not in a wall, tower, gatehouse, keep or moat); true off every castle
export function groundOpen(w, x, y) { const C = castleAt(w, x, y); if (!C?._.grid) return true; const k = cellOfG(C._.grid, x, y); return k < 0 || C._.grid.mul[k] !== Infinity; }
// a few metres of the way to (tx, ty) over a castle's ground, round its towers and walls (siege.js: a man stepping up to
// a ladder's foot) → [x, y], or null off every castle
export function groundToward(w, x, y, tx, ty) { const C = castleAt(w, tx, ty); if (!C?._.grid) return null; const tk = openCell(C._.grid, tx, ty, 4); if (tk < 0) return null; const o = [0, 0]; groundCarrot(C, x, y, tx, ty, tk, 3, o); return o; }
export function setPostern(w, castle, open) { const C = castleOf(w, castle); if (!C) return; for (const p of C.posterns) p.open = !!open; }

// ─────────────────────────────────────────────────────────────── paths (for the UI and the AI: the same choices the men make)
export function castlePath(w, i, tx, ty, tlvl = 0) {
  const S = w.S, C = castleAt(w, tx, ty) || castleAt(w, S.x[i], S.y[i]); if (!C) return [{ kind: "ground", x: tx, y: ty, lvl: 0 }];
  const u = w.units.get(S.unit[i]), mounted = !!ARMS[u?.arm]?.mounted, M = M_(w);
  const goal = makeGoal(C, tx, ty, tlvl); if (!goal) return null;
  const F = goalField(C, goal, S.team[i], mounted), N = C.walkways.nodes, E = C.walkways.edges, out = [];
  let lvl = S.lvl[i], x = S.x[i], y = S.y[i], at = -1;
  for (let guard = 0; guard < 60; guard++) {
    if (lvl === goal.lvl && (lvl ? at >= 0 && E[goal.e] && (E[goal.e].a === at || E[goal.e].b === at) || (at < 0 && M.edge[i] === goal.e) : regionAt(C, x, y) === goal.region)) { out.push({ kind: lvl ? "walk" : "ground", x: goal.x, y: goal.y, lvl }); return out; }
    if (lvl === 0) {
      const r = regionAt(C, x, y); let best = null, bc = Infinity;
      for (const T of C._.tl) { if (!usable(T, S.team[i], mounted)) continue; for (let s = 0; s < 2; s++) { const e = T.ends[s]; if (e.lvl !== 0 || e.region !== r) continue; const c = Math.hypot(e.x - x, e.y - y) * 1.25 + (T.time + T.head) * V0 + F.D[T.ends[1 - s].node]; if (c < bc) { bc = c; best = [T, s]; } } }
      if (!best) return out.length ? out : null;
      const [T, s] = best, e0 = T.ends[s], e1 = T.ends[1 - s];
      out.push({ kind: "ground", x: e0.x, y: e0.y, lvl: 0 }, { kind: "link", link: T.L, x: e1.x, y: e1.y, lvl: e1.lvl });
      x = e1.x; y = e1.y; lvl = e1.lvl; at = e1.node;
    } else {
      if (at < 0) { const e = E[M.edge[i] >= 0 ? M.edge[i] : nearestEdge(C, x, y, lvl)]; if (!e) return null; at = F.D[e.a] < F.D[e.b] ? e.a : e.b; out.push({ kind: "walk", x: N[at].x, y: N[at].y, lvl }); }
      let best = null, bc = Infinity;
      if (goal.lvl === lvl && E[goal.e] && (E[goal.e].a === at || E[goal.e].b === at)) { out.push({ kind: "walk", x: goal.x, y: goal.y, lvl }); return out; }
      for (const ei of N[at].adj) { const e = E[ei]; if (e.gone || e.lvl !== lvl) continue; const m = e.a === at ? e.b : e.a; if (e.len + F.D[m] < bc) { bc = e.len + F.D[m]; best = ["e", m]; } }
      for (const [T, s] of F.at.get(at) || []) { const m = T.ends[1 - s].node; const c = (T.time + T.head) * V0 + F.D[m]; if (c < bc) { bc = c; best = ["l", T, s]; } }
      if (!isFinite(bc) || !best) { out.push({ kind: "walk", x: goal.x, y: goal.y, lvl }); return out; }
      if (best[0] === "e") { at = best[1]; out.push({ kind: "walk", x: N[at].x, y: N[at].y, lvl }); x = N[at].x; y = N[at].y; }
      else { const T = best[1], e1 = T.ends[1 - best[2]]; out.push({ kind: "link", link: T.L, x: e1.x, y: e1.y, lvl: e1.lvl }); x = e1.x; y = e1.y; lvl = e1.lvl; at = e1.lvl ? e1.node : -1; }
    }
  }
  return out;
}
// a goal: a point on a level (the edge and distance along it), or on the ground (its region and cell)
function makeGoal(C, x, y, lvl, extra) {
  if (lvl > 0) {
    const e = nearestEdge(C, x, y, lvl); if (e < 0) return null;
    const E = C.walkways.edges[e], a = C.walkways.nodes[E.a];
    const t = clamp((x - a.x) * E.ux + (y - a.y) * E.uy, 0, E.len), lat = (x - a.x) * -E.uy + (y - a.y) * E.ux, lw = Math.max(0, E.w / 2 - 0.3);
    let gx = a.x + E.ux * t - E.uy * clamp(lat, -lw, lw), gy = a.y + E.uy * t + E.ux * clamp(lat, -lw, lw);
    if (E.clamp) [gx, gy] = clampShape(E.clamp, gx, gy);
    return { lvl, e, t, x: gx, y: gy, key: `e${e}:${Math.round(t)}`, ...extra };
  }
  const G = C._.grid, k = openCell(G, x, y, 8); if (k < 0) return null;
  const inG = cellOfG(G, x, y) === k;
  return { lvl: 0, e: -1, x: inG ? x : cellX(G, k), y: inG ? y : cellY(G, k), cell: k, region: G.region[k], key: `g${G.region[k]}:${Math.round(x / 4)}:${Math.round(y / 4)}`, ...extra };
}
function clampShape(c, x, y) {
  if (c.r !== undefined) { const dx = x - c.cx, dy = y - c.cy, d = Math.hypot(dx, dy); return d <= c.r ? [x, y] : [c.cx + dx / d * c.r, c.cy + dy / d * c.r]; }
  const dx = x - c.cx, dy = y - c.cy, a = clamp(dx * c.ca + dy * c.sa, -c.hw, c.hw), b = clamp(-dx * c.sa + dy * c.ca, -c.hd, c.hd);
  return [c.cx + a * c.ca - b * c.sa, c.cy + a * c.sa + b * c.ca];
}

// ─────────────────────────────────────────────────────────────── orders
function castleOrder(w, u, o) {
  if (o.raw || !w.castles?.length) return false;
  const A = ARMS[u.arm]; if (!A || A.engine || u.isWorkers) return false;
  const k = o.kind;
  if (k === "man_walls" || k === "keep" || k === "castle_move") {
    const C = castleOf(w, o.castle) || castleAt(w, o.x, o.y) || nearestCastle(w, u.ax, u.ay);
    if (!C) return true;
    if (A.mounted && (k !== "castle_move" || o.lvl > 0)) { w.events.push({ t: w.tick, kind: "castle-refused", team: u.team, unit: u.id, why: "horses do not go up on the walls" }); return true; }
    if (u.esc) releaseEscalade(w, u); // (men over the wall by ladders, sent on along it: the ladders stay up for the rest)
    return startCastleOrder(w, u, C, o);
  }
  if (k !== "move" && k !== "assault" && k !== "hold" && k !== "charge") return false;
  // an ordinary order is ours when the body is in a castle (men up on a level, or inside the curtain) or goes into one
  const S = w.S, Mm = w.castleM, up = u.members.some((i) => S.lvl[i] > 0 || (Mm && Mm.link[i] >= 0));
  const tIn = insideCastle(w, o.x, o.y), uIn = insideCastle(w, u.ax, u.ay);
  if (!up && !uIn && !tIn) { if (u.cst) release(w, u); return false; }
  if (u.esc && !o.raw) releaseEscalade(w, u);
  if (A.mounted && !uIn && !tIn) return false;
  const C = tIn || (up ? castleAt(w, u.ax, u.ay) : null) || uIn || u.cst?.castle; if (!C) return false;
  const b = C._.bbox, outside = o.x < b[0] || o.y < b[1] || o.x > b[2] || o.y > b[3];
  if (!tIn && outside) { startCastleOrder(w, u, C, { ...o, kind: "castle_move", lvl: 0, then: { ...o } }); return true; } // out by the gate, then as ordered
  return startCastleOrder(w, u, C, { ...o, kind: k === "assault" || k === "charge" ? "assault" : k === "hold" ? "hold" : "castle_move", lvl: o.lvl ?? 0, orig: k });
}
function nearestCastle(w, x, y) { let best = null, bd = Infinity; for (const C of w.castles || []) { const d = Math.hypot(C.x - x, C.y - y); if (d < bd) { bd = d; best = C; } } return best; }
function release(w, u) { u.cst = null; u.slotCache = null; }
function startCastleOrder(w, u, C, o) {
  const S = w.S, M = M_(w), mem = u.members.filter((i) => S.alive[i]);
  u.order = { ...o, kind: o.orig || o.kind, x: o.x ?? C.keep?.x ?? C.x, y: o.y ?? C.keep?.y ?? C.y }; u.orderT = w.time; u.path = null; u.hold = false; u.pace = o.pace || u.pace || "march";
  if (u.formation === "column" && u.deployAs) { u.formation = u.deployAs.formation; u.depth = u.deployAs.depth; u.deployAs = null; u.slotCache = null; }
  u.cst = { castle: C, kind: o.kind, o, t0: w.time, retarget: w.time, then: o.then || null };
  let goals;
  if (o.kind === "man_walls") goals = wallSlots(w, C, o.x, o.y, mem.length, o.lvl || L_WALK);
  else if (o.kind === "keep") goals = keepSlots(C, mem.length);
  else if (o.kind === "hold") goals = mem.map((i) => S.lvl[i] > 0 && M.edge[i] >= 0 ? makeGoalOnEdge(C, M.edge[i], S.x[i], S.y[i]) : makeGoal(C, S.x[i], S.y[i], 0));
  else goals = areaSlots(w, C, o.x, o.y, o.lvl || 0, mem.length, o.facing ?? u.facing + Math.PI / 2);
  if (!goals || !goals.length) { u.cst = null; w.events.push({ t: w.tick, kind: "castle-refused", team: u.team, unit: u.id, why: "no way there" }); return true; }
  if (o.faceSet && Number.isFinite(o.facing) && (o.lvl || 0) > 0) for (const g of goals) g.face = o.facing; // (a right-drag set which way they face up there; else the parapet side)
  // the man nearest each place takes it
  assign(w, C, mem, goals, M);
  // a body still far out in the field marches up by the ordinary road first (castle.js walks it from the castle's ground)
  const bb = C._.bbox, far = u.ax < bb[0] - 30 || u.ay < bb[1] - 30 || u.ax > bb[2] + 30 || u.ay > bb[3] + 30;
  if (far && !o.instant) {
    const ex = clamp(u.ax, bb[0] + 4, bb[2] - 4), ey = clamp(u.ay, bb[1] + 4, bb[3] - 4), keep = u.order;
    u.cst = null; applyOrder(w, u, { kind: "move", x: ex, y: ey, raw: true, pace: o.pace || "march" }); u.order = keep;
    u.cst = { castle: C, kind: o.kind, o, t0: w.time, retarget: w.time, then: o.then || null, pending: true };
  }
  if (o.instant) for (const i of mem) { const g = M.goal[i]; if (!g) continue; S.x[i] = g.x; S.y[i] = g.y; S.lvl[i] = g.lvl; M.link[i] = -1; M.px[i] = g.x; M.py[i] = g.y; if (g.lvl) { M.cas[i] = w.castles.indexOf(C); M.edge[i] = g.e; M.h[i] = C.walkways.edges[g.e].h; } else { M.edge[i] = -1; M.h[i] = 0; } if (g.face !== undefined) S.facing[i] = g.face; }
  for (const i of mem) if (S.state[i] === S_IDLE) S.state[i] = S_MOVE;
  if (o.kind === "man_walls" && goals[0]?.face !== undefined) u.facing = goals[0].face - Math.PI / 2;
  w.events.push({ t: w.tick, kind: "castle-order", team: u.team, unit: u.id, what: o.kind, castle: C.id });
  return true;
}
function assign(w, C, mem, goals, M) {
  const S = w.S, n = Math.min(mem.length, goals.length), used = new Uint8Array(goals.length);
  // men sorted by their distance to the goals' centre, farthest first: the far places go to the men who will reach them last
  // is wrong for a walk (they would pass each other); nearest-first greedy is good enough and deterministic
  const gx = goals.reduce((s, g) => s + g.x, 0) / goals.length, gy = goals.reduce((s, g) => s + g.y, 0) / goals.length;
  const order = mem.slice().sort((a, b) => Math.hypot(S.x[a] - gx, S.y[a] - gy) - Math.hypot(S.x[b] - gx, S.y[b] - gy) || a - b);
  for (let q = 0; q < order.length; q++) {
    const i = order[q]; M.via[i] = null; M.viaT[i] = 0;
    if (q >= goals.length) { M.goal[i] = goals[q % goals.length]; continue; }
    let best = -1, bd = Infinity;
    for (let k = 0; k < goals.length; k++) { if (used[k]) continue; const d = Math.hypot(goals[k].x - S.x[i], goals[k].y - S.y[i]) + (goals[k].lvl !== S.lvl[i] ? 0 : 0); if (d < bd) { bd = d; best = k; } }
    used[best] = 1; M.goal[i] = goals[best];
  }
  void n;
}
function makeGoalOnEdge(C, e, x, y) { const E = C.walkways.edges[e], a = C.walkways.nodes[E.a], t = clamp((x - a.x) * E.ux + (y - a.y) * E.uy, 0, E.len); return { lvl: E.lvl, e, t, x, y, key: `e${e}:${Math.round(t)}` }; }
// places along the wall-walk from the point nearest (x, y), both ways, one man a merlon; a second file behind the first
// once the stretch runs past 80 m or round into a tower
function wallSlots(w, C, x, y, n, lvl = L_WALK) {
  const N = C.walkways.nodes, E = C.walkways.edges;
  const e0 = nearestEdge(C, x, y, lvl, ["walk"]); if (e0 < 0) return null;
  const E0 = E[e0], a0 = N[E0.a], t0 = clamp((x - a0.x) * E0.ux + (y - a0.y) * E0.uy, 0, E0.len);
  const sp = DIMS.walkSpacing, want = Math.min(n, Math.round(80 / sp)), rows = n > want ? 2 : 1;
  const out = [];
  // walk the chain of walk edges from (e0, t0) in one direction, dropping a place every `sp` m
  const chain = (dir, count) => {
    const res = []; let e = e0, t = t0 + dir * sp * 0.5, from = dir > 0 ? E0.a : E0.b; const seen = new Set([e0]);
    while (res.length < count) {
      const ed = E[e];
      if (t >= 0 && t <= ed.len) { res.push([e, t]); t += dir * sp; continue; }
      // off the end: go on into the next walk edge at that node (the straightest), through a tower room if need be
      const nd = t > ed.len ? ed.b : ed.a, over = t > ed.len ? t - ed.len : -t;
      let nx = -1, bd = -Infinity;
      for (const ei of N[nd].adj) { if (seen.has(ei)) continue; const q = E[ei]; if (q.gone || q.lvl !== lvl || (q.kind !== "walk" && q.kind !== "room")) continue; const sx = (q.a === nd ? 1 : -1) * q.ux, sy = (q.a === nd ? 1 : -1) * q.uy, c = sx * (ed.ux * (t > ed.len ? 1 : -1)) + sy * (ed.uy * (t > ed.len ? 1 : -1)) + (q.kind === "walk" ? 1 : 0); if (c > bd) { bd = c; nx = ei; } }
      if (nx < 0) break;
      seen.add(nx); const q = E[nx];
      if (q.kind === "room") { // through the tower: out by its other walk door
        const c = q.a === nd ? q.b : q.a; let ex = -1;
        for (const ei of N[c].adj) { if (seen.has(ei) || ei === nx) continue; const r = E[ei]; if (r.kind !== "room" || r.lvl !== lvl || r.gone) continue; const d = r.a === c ? r.b : r.a; if (N[d].adj.some((z) => E[z].kind === "walk" && !E[z].gone && !seen.has(z))) { ex = d; seen.add(ei); break; } }
        if (ex < 0) break;
        const wk = N[ex].adj.find((z) => E[z].kind === "walk" && !E[z].gone && !seen.has(z)); if (wk === undefined) break;
        seen.add(wk); e = wk; t = E[wk].a === ex ? sp * 0.5 : E[wk].len - sp * 0.5; dir = E[wk].a === ex ? 1 : -1; continue;
      }
      e = nx; dir = q.a === nd ? 1 : -1; t = dir > 0 ? over : q.len - over;
    }
    return res;
  };
  const per = Math.ceil(n / rows), half = Math.ceil(per / 2);
  const R = chain(1, half), Lf = chain(-1, per - Math.min(half, R.length));
  const line = []; for (let k = 0; k < Math.max(R.length, Lf.length); k++) { if (k < R.length) line.push(R[k]); if (k < Lf.length) line.push(Lf[k]); }
  for (let r = 0; r < rows; r++) for (const [e, t] of line) {
    if (out.length >= n) break;
    const ed = E[e], a = N[ed.a], lat = ed.kind === "walk" ? (r === 0 ? 0.45 : -0.5) * Math.min(1, ed.w / 2) : 0;
    const on = ed.nx !== undefined ? [ed.nx, ed.ny] : [0, 0], s = (-ed.uy * on[0] + ed.ux * on[1]) >= 0 ? 1 : -1; // lateral + = toward the parapet
    let gx = a.x + ed.ux * t - ed.uy * lat * s, gy = a.y + ed.uy * t + ed.ux * lat * s;
    if (ed.clamp) [gx, gy] = clampShape(ed.clamp, gx, gy);
    out.push({ lvl, e, t, x: gx, y: gy, key: `e${e}:${Math.round(t)}`, face: ed.nx !== undefined ? Math.atan2(ed.ny, ed.nx) : undefined, row: r });
  }
  return out;
}
// places in a room or on a top (keep floors: the hall first, then the chamber, then the roof)
function roomSlots(C, room, n, face) {
  const out = [], c = room.rect; if (!c) return out;
  const sp = 1.1, na = Math.floor(2 * c.hw / sp), nb = Math.floor(2 * c.hd / sp);
  for (let j = 0; j < nb && out.length < n; j++) for (let i = 0; i < na && out.length < n; i++) {
    const a = -c.hw + (i + 0.5) * sp, b = -c.hd + (j + 0.5) * sp, x = c.cx + a * c.ca - b * c.sa, y = c.cy + a * c.sa + b * c.ca;
    out.push({ lvl: room.lvl, e: room.e, t: 0, x, y, key: `e${room.e}:r`, face });
  }
  return out;
}
function keepSlots(C, n) {
  const kp = C.keep; if (!kp) return null;
  const out = [];
  for (const r of kp.rooms) { if (out.length >= n) break; out.push(...roomSlots(C, r, n - out.length, kp.rot)); }
  // each room goal on its main edge: the man goes to that floor, then to his spot on it
  for (const g of out) { const E = C.walkways.edges[g.e], a = C.walkways.nodes[E.a]; g.t = clamp((g.x - a.x) * E.ux + (g.y - a.y) * E.uy, 0, E.len); g.key = `e${g.e}:${Math.round(g.t)}`; }
  return out;
}
// places round a point: on the ground a loose block of rows; on a level, along the walk or in the room there
function areaSlots(w, C, x, y, lvl, n, face) {
  if (lvl > 0) {
    const e = nearestEdge(C, x, y, lvl); if (e < 0) return null;
    const E = C.walkways.edges[e];
    if (E.kind === "walk") return wallSlots(w, C, x, y, n, lvl);
    const pq = E.part !== undefined ? C.parts[E.part - 1] : null;
    if (pq && (pq.kind === "tower" || pq.kind === "gatehouse" || pq.kind === "keep")) return partSlots(w, C, pq, lvl, n);
    const rect = E.clamp?.r !== undefined ? { cx: E.clamp.cx, cy: E.clamp.cy, ca: 1, sa: 0, hw: E.clamp.r * 0.72, hd: E.clamp.r * 0.72 } : E.clamp;
    const out = roomSlots(C, { lvl, e, rect }, n, face);
    for (const g of out) { const a = C.walkways.nodes[E.a]; g.t = clamp((g.x - a.x) * E.ux + (g.y - a.y) * E.uy, 0, E.len); g.key = `e${e}:${Math.round(g.t)}`; }
    while (out.length < n && out.length) out.push({ ...out[out.length % Math.max(1, out.length)] });
    return out;
  }
  const G = C._.grid, gk = openCell(G, x, y, 10); if (gk < 0) return null;
  const reg = G.region[gk], cx = cellOfG(G, x, y) === gk ? x : cellX(G, gk), cy = cellOfG(G, x, y) === gk ? y : cellY(G, gk);
  const out = [], files = Math.max(4, Math.ceil(Math.sqrt(n * 2.5))), sp = 1.2, fx = Math.cos(face), fy = Math.sin(face), lx = -fy, ly = fx;
  for (let q = 0; out.length < n && q < n * 6; q++) {
    const f = q % files, r = Math.floor(q / files), a = (f - (files - 1) / 2) * sp, b = -r * sp;
    const px = cx + lx * a + fx * b, py = cy + ly * a + fy * b, k = cellOfG(G, px, py);
    if (k >= 0 && (G.mul[k] === Infinity || G.region[k] !== reg)) continue;
    const kk = k >= 0 ? k : gk;
    out.push({ lvl: 0, e: -1, x: px, y: py, cell: kk, fcell: gk, region: reg, key: `g${reg}:${Math.round(cx / 4)}:${Math.round(cy / 4)}`, face }); // (one flow field for the body: to the centre of its place)
  }
  return out.length ? out : [makeGoal(C, x, y, 0, { face })].filter(Boolean);
}

// ─────────────────────────────────────────────────────────────── places with room for so many (castle-plan §1.2)
// A tower top holds the men its floor inside the parapet has room for — a bowman wants ~3.5 m² to draw and loose
// through a crenel — standing round the battlements and facing out; the rest wait in the room below at walk level
// (the head of the stair) and then on the wall-walk beside the tower. A gatehouse roof likewise, over its chamber; a
// keep floor overflows to the floors next to it. DESIGN numbers.
export const ROOM = { top: 3.5, room: 2.2, roof: 3.5 };
export function topCap(p) {
  if (p.kind === "tower") return Math.max(3, Math.floor(Math.PI * (p.topR ?? 3) ** 2 / ROOM.top));
  if (p.kind === "gatehouse" && p.rects) return Math.max(4, Math.floor(4 * p.rects.roof.hw * p.rects.roof.hd / ROOM.roof));
  return 0;
}
const outFace = (C, x, y) => Math.atan2(y - C.bailey.y, x - C.bailey.x);
// cap places round a circle of radius R inside part p on level lvl, the first facing out from the castle, then either side
function ringSlots(C, p, lvl, cx, cy, R, cap) {
  const E = C.walkways.edges, N = C.walkways.nodes, es = E.filter((e) => e.part === p.id && e.lvl === lvl && !e.gone), out = [];
  if (!es.length || cap < 1) return out;
  const f0 = outFace(C, cx, cy), st = 2 * Math.PI / cap;
  for (let k = 0; k < cap; k++) {
    const ang = f0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * st, x = cx + Math.cos(ang) * R, y = cy + Math.sin(ang) * R;
    let be = es[0], bd = Infinity; for (const e of es) { const d = pointSeg(x, y, N[e.a].x, N[e.a].y, N[e.b].x, N[e.b].y); if (d < bd) { bd = d; be = e; } }
    const a = N[be.a], t = clamp((x - a.x) * be.ux + (y - a.y) * be.uy, 0, be.len);
    out.push({ lvl, e: be.id, t, x, y, key: `e${be.id}:${Math.round(t)}`, face: ang, part: p.id });
  }
  return out;
}
function rectSlots(C, p, lvl, rect, cap, sp) {
  const E = C.walkways.edges, N = C.walkways.nodes, es = E.filter((e) => e.part === p.id && e.lvl === lvl && !e.gone), out = [];
  if (!es.length || !rect) return out;
  const f0 = outFace(C, rect.cx, rect.cy), na = Math.max(1, Math.floor(2 * rect.hw / sp)), nb = Math.max(1, Math.floor(2 * rect.hd / sp));
  for (let j = 0; j < nb && out.length < cap; j++) for (let i = 0; i < na && out.length < cap; i++) {
    const a0 = -rect.hw + (i + 0.5) * 2 * rect.hw / na, b0 = -rect.hd + (j + 0.5) * 2 * rect.hd / nb, x = rect.cx + a0 * rect.ca - b0 * rect.sa, y = rect.cy + a0 * rect.sa + b0 * rect.ca;
    let be = es[0], bd = Infinity; for (const e of es) { const d = pointSeg(x, y, N[e.a].x, N[e.a].y, N[e.b].x, N[e.b].y); if (d < bd) { bd = d; be = e; } }
    const a = N[be.a], t = clamp((x - a.x) * be.ux + (y - a.y) * be.uy, 0, be.len);
    out.push({ lvl, e: be.id, t, x, y, key: `e${be.id}:${Math.round(t)}`, face: f0, part: p.id });
  }
  // the places nearest the outer face first (the battlements), then inward
  out.sort((q, r) => ((r.x - rect.cx) * Math.cos(f0) + (r.y - rect.cy) * Math.sin(f0)) - ((q.x - rect.cx) * Math.cos(f0) + (q.y - rect.cy) * Math.sin(f0)));
  return out;
}
function partSlots(w, C, p, lvl, n) {
  const tiers = [];
  if (p.kind === "tower") {
    const R = p.topR ?? 3;
    if (lvl >= (p.topLvl ?? L_TOP)) tiers.push(ringSlots(C, p, p.topLvl ?? L_TOP, p.x, p.y, Math.max(0.6, R - 0.6), topCap(p)));
    tiers.push(ringSlots(C, p, p.walkLvl ?? L_WALK, p.x, p.y, Math.max(0.6, R - 1.0), Math.max(2, Math.floor(Math.PI * R * R / ROOM.room))));
    tiers.push(wallSlots(w, C, p.x, p.y, n, p.walkLvl ?? L_WALK) || []);
  } else if (p.kind === "gatehouse") {
    if (lvl >= (p.topLvl ?? L_TOP)) tiers.push(rectSlots(C, p, p.topLvl ?? L_TOP, p.rects?.roof, topCap(p), 1.9));
    tiers.push(rectSlots(C, p, p.walkLvl ?? L_WALK, p.rects?.chamber, 60, 1.1));
    tiers.push(wallSlots(w, C, p.x, p.y, n, p.walkLvl ?? L_WALK) || []);
  } else if (p.kind === "keep") {
    const rooms = (p.rooms || []).slice().sort((a, b) => Math.abs(a.lvl - lvl) - Math.abs(b.lvl - lvl) || a.lvl - b.lvl);
    for (const r of rooms) { const s = roomSlots(C, r, n, p.rot); for (const g of s) { const E = C.walkways.edges[g.e], a = C.walkways.nodes[E.a]; g.t = clamp((g.x - a.x) * E.ux + (g.y - a.y) * E.uy, 0, E.len); g.key = `e${g.e}:${Math.round(g.t)}`; } tiers.push(s); }
  }
  const out = [];
  for (const T of tiers) for (const g of T) { if (out.length >= n) break; out.push(g); }
  if (!out.length) return null;
  for (let k = 0; out.length < n; k++) out.push({ ...out[k % out.length] }); // (more than the whole place holds: they crowd in)
  return out;
}

// ─────────────────────────────────────────────────────────────── where a click lands (the order popup, the hover hint)
// castlePlace(w, x, y, hit?) → { castle, kind: "tower"|"gatehouse"|"keep"|"walk"|"breach"|"bailey", part, lvl, x, y, h,
// cap, label } or null (outside every castle). `hit` = { part, h } from castleRayPick (the surface the ray met, h metres
// above the terrain), else the part is found by its footprint, the highest walkable surface first.
export function castlePlace(w, x, y, hit = null) {
  const C = castleAt(w, x, y); if (!C) return null;
  const bOf = (id) => w.buildings.find((b) => b.id === id);
  const inRect = (p, px, py, pad = 0) => { const c = Math.cos(p.rot || 0), s = Math.sin(p.rot || 0), dx = px - p.x, dy = py - p.y, a = dx * c + dy * s, b = -dx * s + dy * c; return p.kind === "gatehouse" ? Math.abs(a) <= p.w / 2 + pad && b >= p.b0 - pad && b <= p.b1 + pad : Math.abs(a) <= p.w / 2 + pad && Math.abs(b) <= p.d / 2 + pad; };
  let p = hit?.part || null;
  if (!p) p = C.parts.find((q) => q.kind === "tower" && Math.hypot(x - q.x, y - q.y) <= q.r + 0.4 && !bOf(q.bid)?.ruin)
    || C.parts.find((q) => q.kind === "gatehouse" && inRect(q, x, y, 0.3))
    || C.parts.find((q) => q.kind === "keep" && inRect(q, x, y, 0.5))
    || C.parts.find((q) => q.kind === "curtain" && pointSeg(x, y, q.x0, q.y0, q.x1, q.y1) <= q.th / 2 + (hit ? 0.4 : 1.2));
  const r = (v) => Math.round(v * 2) / 2;
  if (p?.kind === "tower") { const top = p.floors[3], cap = topCap(p); return { castle: C, kind: "tower", part: p, lvl: p.topLvl, x: p.x, y: p.y, h: top, cap, label: `Tower top · ${r(top)} m · ${cap} men fit` }; }
  if (p?.kind === "gatehouse") { const rr = p.rects?.roof, top = p.floors[2], cap = topCap(p); return { castle: C, kind: "gatehouse", part: p, lvl: p.topLvl, x: rr ? rr.cx : p.x, y: rr ? rr.cy : p.y, h: top, cap, label: `Gatehouse roof · ${r(top)} m · ${cap} men fit` }; }
  if (p?.kind === "keep") {
    const roof = p.rooms?.find((q) => q.lvl === L_ROOF), hall = p.rooms?.find((q) => q.lvl === L_HALL), capOf = (q) => q ? Math.floor(2 * q.rect.hw / 1.1) * Math.floor(2 * q.rect.hd / 1.1) : 0;
    const lvl = hit && hit.h < p.floors[3] - 3 && !hit.top ? L_HALL : L_ROOF, q = lvl === L_ROOF ? roof : hall;
    return { castle: C, kind: "keep", part: p, lvl, x: p.x, y: p.y, h: q?.h ?? p.floors[3], cap: capOf(q), capHall: capOf(hall), capRoof: capOf(roof), label: `${lvl === L_ROOF ? "Keep roof" : "Keep hall"} · ${r(q?.h ?? 0)} m · ${capOf(q)} men fit` };
  }
  if (p?.kind === "curtain") {
    const b = bOf(p.bid), L = Math.hypot(p.x1 - p.x0, p.y1 - p.y0), t = clamp(((x - p.x0) * (p.x1 - p.x0) + (y - p.y0) * (p.y1 - p.y0)) / (L * L || 1), 0, 1);
    const k = b?.mods ? Math.min(b.mods.length - 1, Math.floor(t * b.mods.length)) : 0;
    if (b?.mods && b.mods[k] <= 0) return { castle: C, kind: "breach", part: p, lvl: 0, x, y, h: 0, cap: 0, label: "The breach · rubble" };
    const es = C.walkways.edges.filter((e) => e.part === p.id && e.kind === "walk" && !e.gone), N = C.walkways.nodes;
    let be = null, bd = Infinity; for (const e of es) { const d = pointSeg(x, y, N[e.a].x, N[e.a].y, N[e.b].x, N[e.b].y); if (d < bd) { bd = d; be = e; } }
    let wx = x, wy = y; if (be) { const a = N[be.a], tt = clamp((x - a.x) * be.ux + (y - a.y) * be.uy, 0, be.len); wx = a.x + be.ux * tt; wy = a.y + be.uy * tt; }
    let run = 0; for (const e of es) run += e.len;
    const cap = Math.floor(run / DIMS.walkSpacing);
    return { castle: C, kind: "walk", part: p, lvl: p.walkLvl ?? L_WALK, x: wx, y: wy, h: p.walkH, cap, label: `Wall-walk · ${r(p.walkH)} m · ${cap} men along this stretch` };
  }
  const inC = insideCastle(w, x, y); if (inC !== C) return null;
  const lists = C.rings.length > 1 && !inPoly(C.rings[C.rings.length - 1].poly, x, y);
  return { castle: C, kind: "bailey", part: null, lvl: 0, x, y, h: 0, cap: 0, label: lists ? "The outer ward · the lists" : "The bailey" };
}
// the first castle surface (or the ground) a ray meets: origin (ox, oy) at height oz (absolute, the terrain's frame),
// direction (dx, dy, dz) → { x, y, h (above the terrain), part } or null when it misses every castle's ground
export function castleRayPick(w, ox, oy, oz, dx, dy, dz) {
  let best = null;
  for (const C of w.castles || []) {
    const [x0, y0, x1, y1] = C._.bbox; let t0 = 0, t1 = 5000;
    for (const [o, d, lo, hi] of [[ox, dx, x0, x1], [oy, dy, y0, y1]]) { if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { t0 = 1; t1 = 0; } continue; } let a = (lo - o) / d, b = (hi - o) / d; if (a > b) [a, b] = [b, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, b); }
    if (t0 > t1) continue;
    const bOf = (id) => w.buildings.find((b) => b.id === id), hmax = Math.max(...C.parts.map((p) => p.h || 0), 12) + 2;
    for (let t = t0; t <= t1; t += 0.35) {
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t, g = w.map.h(x, y), h = z - g;
      if (best && t >= best.t) break;
      if (h > hmax + 1) continue;
      if (h <= 0) { best = { t, x, y, h: 0, part: null, C }; break; }
      const p = solidAt(w, C, x, y, h, bOf);
      if (p) { best = { t, x, y, h, part: p.kind === "curtain" || p.kind === "tower" || p.kind === "gatehouse" || p.kind === "keep" ? p : null, top: h > (p.h || 0) - 2.6, C }; break; }
    }
  }
  return best;
}
function solidAt(w, C, x, y, h, bOf) {
  for (const p of C.parts) {
    if (p.kind === "tower") { if (h <= p.h && (x - p.x) ** 2 + (y - p.y) ** 2 <= p.r * p.r && !bOf(p.bid)?.ruin) return p; continue; }
    if (p.kind === "curtain") { if (h > p.h) continue; const L2 = (p.x1 - p.x0) ** 2 + (p.y1 - p.y0) ** 2, t = ((x - p.x0) * (p.x1 - p.x0) + (y - p.y0) * (p.y1 - p.y0)) / (L2 || 1); if (t < 0 || t > 1 || pointSeg(x, y, p.x0, p.y0, p.x1, p.y1) > p.th / 2) continue; const b = bOf(p.bid); if (b?.mods && b.mods[Math.min(b.mods.length - 1, Math.floor(t * b.mods.length))] <= 0) continue; return p; }
    if (p.w === undefined || p.kind === "well") continue;
    const top = p.kind === "gatehouse" ? p.floors[2] + 2 : p.kind === "keep" ? p.floors[3] + 2 : 8;
    if (h > top) continue;
    const c = Math.cos(p.rot || 0), s = Math.sin(p.rot || 0), a = (x - p.x) * c + (y - p.y) * s, b = -(x - p.x) * s + (y - p.y) * c;
    if (p.kind === "gatehouse" ? Math.abs(a) <= p.w / 2 && b >= p.b0 && b <= p.b1 : Math.abs(a) <= p.w / 2 && Math.abs(b) <= p.d / 2) return p;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────── moving a body in a castle (world.moveUnit hands it over)
function castleMove(w, u) {
  const K = u.cst; if (!K) return false;
  const C = K.castle; if (!C || !w.castles.includes(C)) { u.cst = null; return false; }
  if (K.pending) { const b = C._.bbox; if (u.ax < b[0] || u.ay < b[1] || u.ax > b[2] || u.ay > b[3]) return false; K.pending = false; u.path = null; K.t0 = w.time; }
  const S = w.S, M = M_(w), A = ARMS[u.arm], t = w.time, mounted = !!A.mounted, team = u.team;
  // an assault: every 5 s, the nearest standing enemy near the ordered point, on whatever level he is
  if (K.kind === "assault" && t - K.retarget > 5) { K.retarget = t; retarget(w, u, C, M); }
  let moving = 0, sx = 0, sy = 0, cnt = 0;
  for (const i of u.members) {
    if (!S.alive[i]) continue;
    sx += S.x[i]; sy += S.y[i]; cnt++;
    if (M.link[i] >= 0) { moving++; continue; } // (on a stair or ladder: castleSystem climbs him)
    const st = S.state[i];
    if (st === S_FIGHT || st === S_FLEE || st === S_RALLY || st === S_CAPT || S.posture[i] || S.busyT[i] > t) continue;
    const g = M.goal[i]; if (!g) continue;
    if (navigate(w, u, C, M, A, i, g, team, mounted)) moving++;
  }
  if (cnt && (w.tick + u.id) % 5 === 0) { u.ax = sx / cnt; u.ay = sy / cnt; }
  u.path = null; u.moving = moving > 0; u.hold = false; // (a body in a castle is not a line: the men in contact fight, the rest come on to their places)
  // left the castle for the field: once the body is out of its ground, the rest of the order is an ordinary one
  if (K.then && !moving && cnt) { const b = C._.bbox; const out = u.ax < b[0] + 8 || u.ay < b[1] + 8 || u.ax > b[2] - 8 || u.ay > b[3] - 8; if (out || t - K.t0 > 20) { const o = K.then; release(w, u); applyOrder(w, u, { ...o, raw: false }); } }
  return true;
}
function retarget(w, u, C, M) {
  const S = w.S, o = u.cst.o; let best = -1, bd = 60 * 60;
  const [b0, b1, b2, b3] = C._.bbox;
  for (let i = 0; i < S.n; i++) {
    if (!S.alive[i] || S.team[i] === u.team || S.status[i] >= 3 || S.state[i] === S_CAPT) continue;
    const x = S.x[i], y = S.y[i]; if (x < b0 || y < b1 || x > b2 || y > b3) continue;
    const d = (x - o.x) ** 2 + (y - o.y) ** 2 + S.lvl[i] * 25; if (d < bd) { bd = d; best = i; }
  }
  if (best < 0) return;
  const lvl = S.lvl[best], x = S.x[best], y = S.y[best];
  const goals = lvl ? (() => { const g = M.edge[best] >= 0 && M.cas[best] === w.castles.indexOf(C) ? makeGoalOnEdge(C, M.edge[best], x, y) : makeGoal(C, x, y, lvl); return g ? [g] : null; })() : areaSlots(w, C, x, y, 0, Math.min(40, u.members.length), Math.atan2(y - u.ay, x - u.ax));
  if (!goals?.length) return;
  for (let k = 0; k < u.members.length; k++) { const i = u.members[k]; M.goal[i] = goals[k % goals.length]; }
}
const TMP = [0, 0];
// one man's step toward his goal: returns true while he is still on his way
function navigate(w, u, C, M, A, i, g, team, mounted) {
  const S = w.S, x = S.x[i], y = S.y[i], lv = S.lvl[i], G = C._.grid;
  const carrot = u.pace === "quick" || u.pace === "charge" ? 3 : 2;
  if (lv === 0) {
    const r = regionAt(C, x, y);
    if (g.lvl === 0 && r === g.region) {
      const d = Math.hypot(g.x - x, g.y - y);
      if (d < 0.5) { steer(w, i, A, g.x, g.y, false, u); if (g.face !== undefined) S.facing[i] = g.face; return false; }
      if (d < 6 && g.fcell !== undefined) { go(w, i, A, u, g.x, g.y, d); return true; } // (the last steps to his own place: straight)
      groundCarrot(C, x, y, g.x, g.y, g.fcell ?? g.cell ?? openCell(G, g.x, g.y), carrot, TMP);
      go(w, i, A, u, TMP[0], TMP[1], d);
      return true;
    }
    // choose a way up (or through): the link whose foot is in my region that gets me there soonest, the queue counted
    let via = M.via[i];
    if (!via || via.T.dead || !usable(via.T, team, mounted) || w.time - M.viaT[i] > 4) {
      const F = goalField(C, g, team, mounted); let best = null, bc = Infinity;
      for (const T of C._.tl) { if (!usable(T, team, mounted)) continue; for (let s = 0; s < 2; s++) { const e = T.ends[s]; if (e.lvl !== 0 || e.region !== r) continue; const c = Math.hypot(e.x - x, e.y - y) * 1.25 + (T.time + T.head + T.q * T.head / T.lanes.length) * V0 + F.D[T.ends[1 - s].node]; if (c < bc) { bc = c; best = { T, s }; } } }
      M.via[i] = via = best; M.viaT[i] = w.time;
      if (!best) { steer(w, i, A, x, y, false, u); return false; }
    }
    const e = via.T.ends[via.s], d = Math.hypot(e.x - x, e.y - y);
    if (d < 1.3) { if (!enter(w, C, M, i, via.T, via.s)) steer(w, i, A, e.x, e.y, false, u); return true; }
    groundCarrot(C, x, y, e.x, e.y, e.cell, carrot, TMP);
    go(w, i, A, u, TMP[0], TMP[1], d);
    return true;
  }
  // on a level: along the walkway graph
  let ei = M.edge[i]; const E = C.walkways.edges, N = C.walkways.nodes;
  if (ei < 0 || !E[ei] || E[ei].lvl !== lv || E[ei].gone) { ei = nearestEdge(C, x, y, lv); M.edge[i] = ei; M.cas[i] = w.castles.indexOf(C); if (ei < 0) return false; }
  const e = E[ei], a = N[e.a], tt = (x - a.x) * e.ux + (y - a.y) * e.uy;
  if (g.lvl === lv && g.e === ei) {
    const d = Math.hypot(g.x - x, g.y - y);
    go(w, i, A, u, g.x, g.y, d); if (d < 0.5 && g.face !== undefined) S.facing[i] = g.face;
    return d >= 0.5;
  }
  const F = goalField(C, g, team, mounted), D = F.D;
  const ca = Math.max(0, tt) + D[e.a], cb = Math.max(0, e.len - tt) + D[e.b];
  if (!isFinite(ca) && !isFinite(cb)) { steer(w, i, A, x, y, false, u); return false; }
  const nd = ca <= cb ? e.a : e.b, dn = ca <= cb ? tt : e.len - tt;
  if (dn < 0.7) {
    // at a node: the next edge, or a link up or down, whichever is cheaper
    let best = null, bc = Infinity;
    for (const q of N[nd].adj) { const f = E[q]; if (f.gone || f.lvl !== lv) continue; const m = f.a === nd ? f.b : f.a; const c = g.lvl === lv && g.e === q ? (f.a === nd ? g.t : f.len - g.t) : f.len + D[m]; if (c < bc) { bc = c; best = ["e", q]; } }
    for (const [T, s] of F.at.get(nd) || []) { const c = (T.time + T.head + T.q * T.head / T.lanes.length) * V0 + D[T.ends[1 - s].node]; if (c < bc) { bc = c; best = ["l", T, s]; } }
    if (!best) { steer(w, i, A, x, y, false, u); return false; }
    if (best[0] === "l") { if (!enter(w, C, M, i, best[1], best[2])) steer(w, i, A, N[nd].x, N[nd].y, false, u); return true; }
    { M.edge[i] = best[1]; const f = E[best[1]], far = f.a === nd ? N[f.b] : N[f.a], L = Math.min(f.len, carrot), ux = (far.x - N[nd].x) / (f.len || 1), uy = (far.y - N[nd].y) / (f.len || 1); go(w, i, A, u, N[nd].x + ux * L, N[nd].y + uy * L, 9); return true; }
  }
  const sgn = nd === e.a ? -1 : 1, tgt = clamp(tt + sgn * carrot, 0, e.len);
  go(w, i, A, u, a.x + e.ux * tgt, a.y + e.uy * tgt, 9);
  return true;
}
// walk toward (tx, ty) at the body's pace; `left` = how far he still has to go (he slows only in the last 1.5 m)
function go(w, i, A, u, tx, ty, left) {
  const S = w.S, dx = tx - S.x[i], dy = ty - S.y[i], d = Math.hypot(dx, dy);
  if (left < 1.5 || d < 0.05) { steer(w, i, A, tx, ty, false, u); return; }
  steer(w, i, A, S.x[i] + dx / d * 0.45, S.y[i] + dy / d * 0.45, true, u); // (steer wants a target beyond 0.4 m; the pace is the body's)
}
// down the flow field toward (tx, ty) (grid cell tk) a few cells; straight where the grid does not reach
function groundCarrot(C, x, y, tx, ty, tk, steps, out) {
  const G = C._.grid, k0 = cellOfG(G, x, y);
  if (tk >= 0 && k0 < 0) { // out beyond the castle's ground: make for the edge cell nearby from which the way in is cheapest
    const D = flowField(C, tk), X1 = G.x0 + G.nx * CELL, Y1 = G.y0 + G.ny * CELL, cx = clamp(x, G.x0 + 0.5, X1 - 0.5), cy = clamp(y, G.y0 + 0.5, Y1 - 0.5);
    const alongX = cy <= G.y0 + 0.5 || cy >= Y1 - 0.5; let bx = cx, by = cy, bc = Infinity;
    for (let q = -6; q <= 6; q++) { const px = alongX ? clamp(cx + q * 5, G.x0 + 0.5, X1 - 0.5) : cx, py = alongX ? cy : clamp(cy + q * 5, G.y0 + 0.5, Y1 - 0.5), k = cellOfG(G, px, py); if (k < 0 || !isFinite(D[k])) continue; const c = D[k] + Math.hypot(px - x, py - y); if (c < bc) { bc = c; bx = px; by = py; } }
    const d = Math.hypot(bx - x, by - y) || 1, s = Math.min(d, steps); out[0] = x + (bx - x) / d * s; out[1] = y + (by - y) / d * s; return;
  }
  if (k0 < 0 || tk < 0 || G.mul[k0] === Infinity) { const d = Math.hypot(tx - x, ty - y) || 1, s = Math.min(d, steps); out[0] = x + (tx - x) / d * s; out[1] = y + (ty - y) / d * s; return; }
  const D = flowField(C, tk); if (!isFinite(D[k0])) { out[0] = tx; out[1] = ty; return; }
  if (D[k0] <= steps * 1.5) { out[0] = tx; out[1] = ty; return; }
  let k = k0; const nx = G.nx, mul = G.mul;
  for (let s = 0; s < steps; s++) {
    const i = k % nx, j = (k / nx) | 0; let bm = -1, bv = D[k];
    for (let d = 0; d < 8; d++) { const ii = i + DI[d], jj = j + DJ[d]; if (ii < 0 || jj < 0 || ii >= nx || jj >= G.ny) continue; const m = jj * nx + ii; if (D[m] >= bv) continue; if (d >= 4 && (mul[j * nx + ii] === Infinity || mul[jj * nx + i] === Infinity)) continue; bv = D[m]; bm = m; }
    if (bm < 0) break; k = bm;
  }
  out[0] = cellX(G, k); out[1] = cellY(G, k);
}
// onto a link, if a lane is free (else he waits his turn at the foot)
function enter(w, C, M, i, T, s) {
  T.qn++;
  const t = w.time, lanes = T.lanes;
  for (let q = 0; q < lanes.length; q++) if (lanes[q] <= t) {
    lanes[q] = t + T.head; M.link[i] = T.idx; M.lcas[i] = w.castles.indexOf(C); M.lp[i] = 0; M.ldir[i] = s; M.via[i] = null;
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────── the system
export function castleSystem(w) {
  const Cs = w.castles; if (!Cs || !Cs.length) return;
  const S = w.S, M = M_(w), t = w.time;
  for (const C of Cs) {
    if (w.tick % 5 === 0) refresh(w, C);
    for (const T of C._.tl) { T.q = T.qn; T.qn = 0; T.occP = T.occ; T.occ = null; } // (occ: where the men on a one-man flight stood last tick — none passes the man ahead)
  }
  // a body with men up on a level that nobody is walking (lodged over the wall by an escalade, pushed up a breach):
  // castle.js takes it on with its order, so its men find the stairs down
  if (w.tick % 10 === 4) for (const u of w.units.values()) {
    if (u.cst || u.esc || u.isWorkers || u.engine !== undefined || !u.members.length) continue;
    let up = false; for (const i of u.members) if (S.lvl[i] > 0 && S.alive[i]) { up = true; break; }
    if (!up) continue;
    const C = castleAt(w, u.ax, u.ay) || Cs[0], o = u.order || {};
    startCastleOrder(w, u, C, { ...o, kind: o.kind === "assault" || o.kind === "charge" ? "assault" : o.kind === "move" && Number.isFinite(o.x) ? "castle_move" : "hold", x: Number.isFinite(o.x) ? o.x : u.ax, y: Number.isFinite(o.y) ? o.y : u.ay, lvl: 0, orig: o.kind });
  }
  const nC = Cs.length;
  for (let i = 0; i < S.n; i++) {
    if (!S.alive[i]) { if (M.link[i] >= 0) { M.link[i] = -1; } M.goal[i] = null; continue; }
    // on a link: climb (a fighting man stands where he is on it)
    if (M.link[i] >= 0) { linkStep(w, M, i, t); continue; }
    const lv = S.lvl[i];
    if (lv > 0) {
      const C = Cs[M.cas[i]] || castleAt(w, S.x[i], S.y[i]) || Cs[0];
      // running from the fight: from where he stood (combat's flight is on open ground), to the nearest way down
      if (S.state[i] === S_FLEE && M.px[i] === M.px[i] && Math.abs(M.px[i] - S.x[i]) < 4 && Math.abs(M.py[i] - S.y[i]) < 4) { S.x[i] = M.px[i]; S.y[i] = M.py[i]; fleeDown(w, C, M, i); }
      snapMan(w, C, M, i); M.px[i] = S.x[i]; M.py[i] = S.y[i];
      continue;
    }
    if (M.h[i]) M.h[i] = 0;
    // on the ground: not into a tower, the keep, a wall, a shut gate
    const x = S.x[i], y = S.y[i];
    let C = null; for (let k = 0; k < nC; k++) { const b = Cs[k]._.bbox; if (x >= b[0] && y >= b[1] && x <= b[2] && y <= b[3]) { C = Cs[k]; break; } }
    if (!C) { M.px[i] = x; M.py[i] = y; continue; }
    const G = C._.grid, k = cellOfG(G, x, y);
    if (k >= 0 && G.mul[k] === Infinity) {
      const px = M.px[i], py = M.py[i]; let ok = false;
      if (px === px && Math.abs(px - x) < 5 && Math.abs(py - y) < 5) {
        const kx = cellOfG(G, x, py), ky = cellOfG(G, px, y);
        if (kx >= 0 && G.mul[kx] !== Infinity) { S.y[i] = py; ok = true; }
        else if (ky >= 0 && G.mul[ky] !== Infinity) { S.x[i] = px; ok = true; }
        else { const kp = cellOfG(G, px, py); if (kp < 0 || G.mul[kp] !== Infinity) { S.x[i] = px; S.y[i] = py; ok = true; } }
      }
      if (!ok) { const m = openCell(G, x, y, 8); if (m >= 0) { S.x[i] = cellX(G, m); S.y[i] = cellY(G, m); } }
    }
    M.px[i] = S.x[i]; M.py[i] = S.y[i];
  }
}
// a man running from the fight up on a level makes for the nearest way down (then combat's flight takes him on)
const DOWN = { down: true, lvl: 0, key: "down" };
function fleeDown(w, C, M, i) {
  const S = w.S, E = C.walkways.edges, N = C.walkways.nodes, ei = M.edge[i]; if (ei < 0) return;
  const F = goalField(C, DOWN, S.team[i], false), D = F.D, e = E[ei], a = N[e.a], x = S.x[i], y = S.y[i], tt = clamp((x - a.x) * e.ux + (y - a.y) * e.uy, 0, e.len);
  const ca = tt + D[e.a], cb = e.len - tt + D[e.b]; if (!isFinite(ca) && !isFinite(cb)) return;
  const nd = ca <= cb ? e.a : e.b, dn = ca <= cb ? tt : e.len - tt;
  if (dn < 0.7) {
    let best = null, bc = Infinity;
    for (const q of N[nd].adj) { const f = E[q]; if (f.gone || f.lvl !== S.lvl[i]) continue; const m = f.a === nd ? f.b : f.a; if (f.len + D[m] < bc) { bc = f.len + D[m]; best = ["e", q]; } }
    for (const [T, s] of F.at.get(nd) || []) { const c = (T.time + T.head) * V0 + D[T.ends[1 - s].node]; if (c < bc) { bc = c; best = ["l", T, s]; } }
    if (!best) return;
    if (best[0] === "l") { enter(w, C, M, i, best[1], best[2]); return; }
    M.edge[i] = best[1]; const f = E[best[1]], far = f.a === nd ? N[f.b] : N[f.a];
    return runTo(S, i, far.x, far.y, Math.hypot(far.x - x, far.y - y));
  }
  runTo(S, i, N[nd].x, N[nd].y, dn);
}
function runTo(S, i, tx, ty, left) {
  const x = S.x[i], y = S.y[i], d = Math.hypot(tx - x, ty - y) || 1, v = Math.min(left, 2.6 * DT), ux = (tx - x) / d, uy = (ty - y) / d;
  S.x[i] = x + ux * v; S.y[i] = y + uy * v; S.vx[i] = ux * 2.6; S.vy[i] = uy * 2.6; S.facing[i] = Math.atan2(uy, ux);
}
function linkStep(w, M, i, t) {
  const S = w.S, C = w.castles[M.lcas[i]], T = C?._.tl[M.link[i]];
  if (!T || T.dead) { M.link[i] = -1; if (!S.lvl[i]) M.h[i] = 0; else setLevel(w, i, S.lvl[i]); return; }
  if (S.state[i] === S_FLEE && T.ends[1 - M.ldir[i]].lvl > T.ends[M.ldir[i]].lvl && M.lp[i] < 0.75) { M.ldir[i] = 1 - M.ldir[i]; M.lp[i] = 1 - M.lp[i]; } // (a man who breaks on the way up turns back down)
  const a = T.ends[M.ldir[i]], b = T.ends[1 - M.ldir[i]];
  const fighting = S.state[i] === S_FIGHT || S.posture[i] || S.state[i] === S_CAPT;
  const lpWas = M.lp[i];
  if (!fighting) {
    let cap = 1; const P = T.lanes.length === 1 ? T.occP?.[M.ldir[i]] : null, lp0 = M.lp[i];
    // one man abreast (a spiral stair, a ladder): he cannot pass the man ahead of him going the same way — a man stopped
    // fighting at the head of the stair holds everyone behind him on it (the choke point)
    if (P) { const gap = Math.min(0.45, 0.9 / T.len); for (const q of P) if (q > lp0 + 1e-6 && q - gap < cap) cap = q - gap; }
    M.lp[i] = Math.min(Math.max(lp0, cap), lp0 + DT * T.speed / T.len * (S.status[i] >= 3 ? 1.3 : 1));
  }
  if (T.lanes.length === 1) ((T.occ ||= [[], []])[M.ldir[i]]).push(M.lp[i]);
  const p = M.lp[i], x = a.x + (b.x - a.x) * p, y = a.y + (b.y - a.y) * p;
  const held = !fighting && M.lp[i] === lpWas; // (held on the flight behind the man ahead: he stands and gets his wind)
  if (!fighting) { S.vx[i] = held ? 0 : (b.x - a.x) / T.time; S.vy[i] = held ? 0 : (b.y - a.y) / T.time; S.facing[i] = Math.atan2(b.y - a.y, b.x - a.x); if (S.state[i] !== S_FLEE) S.state[i] = S_MOVE; if (!held) S.power[i] = Math.max(S.power[i], b.h > a.h ? 260 : 140); }
  S.x[i] = x; S.y[i] = y; M.px[i] = x; M.py[i] = y;
  M.h[i] = a.h + (b.h - a.h) * p;
  S.lvl[i] = p < 0.75 ? a.lvl : b.lvl; // (the link-head rule: past ¾ of the way he is among the men at the top)
  if (p >= 1) {
    M.link[i] = -1; S.lvl[i] = b.lvl;
    if (b.lvl > 0) { const nd = C.walkways.nodes[b.node]; const e = nd?.adj.find((q) => !C.walkways.edges[q].gone); M.cas[i] = M.lcas[i]; M.edge[i] = e ?? nearestEdge(C, x, y, b.lvl); M.h[i] = b.h; }
    else { M.edge[i] = -1; M.h[i] = 0; }
  }
}
// keep a man on a level on his walkway (the edge's width, and the room's walls)
function snapMan(w, C, M, i) {
  const S = w.S, lv = S.lvl[i], E = C.walkways.edges, N = C.walkways.nodes;
  let ei = M.edge[i];
  if (ei < 0 || !E[ei] || E[ei].gone || E[ei].lvl !== lv || C !== w.castles[M.cas[i]]) {
    ei = nearestEdge(C, S.x[i], S.y[i], lv);
    if (ei < 0 || pointSeg(S.x[i], S.y[i], N[E[ei].a].x, N[E[ei].a].y, N[E[ei].b].x, N[E[ei].b].y) > 12) { S.lvl[i] = 0; M.edge[i] = -1; M.h[i] = 0; return; } // (the walk under him has gone: he is down in the rubble)
    M.edge[i] = ei; M.cas[i] = w.castles.indexOf(C);
  }
  let e = E[ei], a = N[e.a], x = S.x[i], y = S.y[i], t = (x - a.x) * e.ux + (y - a.y) * e.uy;
  if (t < -0.05 || t > e.len + 0.05) { // past an end: onto the neighbouring edge there that holds him best
    const nd = t < 0 ? e.a : e.b; let bd = Math.abs(t < 0 ? t : t - e.len), be = ei;
    for (const q of N[nd].adj) { if (q === ei) continue; const f = E[q]; if (f.gone || f.lvl !== lv) continue; const fa = N[f.a], d = pointSeg(x, y, fa.x, fa.y, N[f.b].x, N[f.b].y); if (d < bd) { bd = d; be = q; } }
    if (be !== ei) { ei = be; M.edge[i] = ei; e = E[ei]; a = N[e.a]; t = (x - a.x) * e.ux + (y - a.y) * e.uy; }
  }
  t = clamp(t, 0, e.len);
  const lw = Math.max(0.05, e.w / 2 - 0.25), lat = clamp((x - a.x) * -e.uy + (y - a.y) * e.ux, -lw, lw);
  x = a.x + e.ux * t - e.uy * lat; y = a.y + e.uy * t + e.ux * lat;
  if (e.clamp && !(e.door === "a" && t < e.doorT)) [x, y] = clampShape(e.clamp, x, y);
  S.x[i] = x; S.y[i] = y; M.h[i] = e.h;
}

// ─────────────────────────────────────────────────────────────── hooks into the world
function installHooks(w) {
  M_(w);
  w.castleOrder = castleOrder;
  w.castleMove = castleMove;
  w.levelH = (i) => levelHeight(w, i);
  w.castleAim = aimBias;
  w.castleCover = (w2, i, f) => coverFor(w2, i, f.x0 ?? f.x, f.y0 ?? f.y, f.by >= 0 ? w2.S.lvl[f.by] : 0);
  w.castleApi = { addLink, removeLink, insideCastle, castleAt, levelHeight, levelOf, coverFor, sameLevel, walkPointNear, castlePath, setLevel, groundOpen, groundToward, castlePlace, castleRayPick };
  ensureSiege(w);
  if (!w.systems.includes(siegeSystem)) w.systems.push(siegeSystem);
  const k = w.systems.indexOf(castleSystem); if (k >= 0) w.systems.splice(k, 1);
  w.systems.push(castleSystem); // (last: after combat has moved the fighters and siege.js has kept men out of walls)
}
