// TOWN WALLS YOU STAND ON — the fighting step of a palisade, the wall-walk of a stone curtain, the tops of the gate
// towers, the gatehouse roof and the watchtowers, as LEVELS men climb up to and fight from (the owner: "There is no way
// to make your men go UP onto your walls. The order here button only ever lets you select ground level.").
//
// The castle level system (js/sim/castle.js) in the shape a town needs. A castle is one compact place with its own 1 m
// ground grid; a town's circuit is half a kilometre of wall round a town whose ground is the ordinary world's (the nav,
// the town gates of js/sim/wallnav.js). So the LEVELS are castle.js's — S.lvl (1 = the walk, 2 = a top), a man's height
// above the terrain (castle levelHeight reads w.twM.h for these men), the link-head rule on a ladder, cover against
// missiles from outside (w.castleCover), bodies meeting only on the same level — and the GRAPH is castle.js's (walkway
// nodes and edges, links between levels as queues with lanes and a headway, a goal field over both), but the ground leg
// is the world's: a man walks to the foot of a ladder or stair behind the wall by the ordinary steering.
//
// THE CIRCUIT (derived from the walls, deterministic, rebuilt only when the set of wall buildings changes; kept on the
// world as plain data — w.townWalls — so a restored world carries the ladders' queues on exactly as the saved one):
//   palisade      the plank fighting walk on posts behind the stakes (assets/src/palisade.py: deck 3.72 m, 0.2–1.6 m
//                 inside the stake line; the stakes stand a man's chest above it). One walk edge per 6 m module (the
//                 renderer's modules), so a breached module cuts exactly the walk above it. A ladder up every 18 m.
//   stone_wall    the wall-walk behind the parapet (assets/src/wall_stone.py: Z_WALK 7.0, y −0.6..1.2). A straight stair
//                 up the inner face every 36 m.
//   gate          the timber gate's fighting platform over the passage (gate.py: deck 5.4 m) — reached from the walk on
//                 either flank by the tower's inner stair, and from the ground by a ladder in the tower.
//   gatehouse     the walk runs through its chamber at walk level (a door in each flank, gatehouse.py); the roof-walk
//                 (10.5 m) is up a spiral stair; stairs up from the ground behind each flank.
//   watchtower    its fighting platform (watchtower.py: 10.6 m, hoarded), up a ladder from the ground.
//   (The model heights are relative to where render/buildings.js stands each piece: −0.3 m for a wall module, −0.15 m for
//   a gate, gatehouse or tower; a walk edge carries the absolute height of its deck, so a man is drawn ON the planks.)
//
// MEN ON THE WALL: a company ordered up takes places along the walk, one man to every 1.2 m (a merlon and a crenel, or a
// stake-gap), from the point clicked outward both ways along the circuit, as far as 48 m either side — the stretch's
// FRONTAGE. Places already held by another company are skipped. The rest stand ready on the ground behind the wall and
// step up as men on the wall fall. Up there they shoot from the height (ballistics: range and plunge from levelH), take
// cover behind the stakes or the merlons against shots from outside, and fight whoever comes up a ladder (siege.js: the
// climber meets the men on the walk at the ladder head and, if he lives, steps onto the walk among them — then fights
// there or goes down inside by the ladders). A module breached under them drops them to the ground, hurt as often as
// the height says. Any other order to a company on the wall brings it down first.
//
// API (import * as TW from "./townwall.js"):
//   layer(w) → the circuit (w.townWalls) · capacity(w, team) → men the team's standing walk holds
//   townPick(w, ox, oy, oz, dx, dy, dz) → { t, x, y, h, part } the wall surface a ray meets first (the click)
//   townPlace(w, x, y, part?) → { town: true, kind: "twalk"|"ttop"|"tbreach", team, lvl, x, y, h, cap, label, tpart }
//   manWalls(w, team, units, from?) → spreads companies along the nearest standing stretches (from: a threat point)
//   comeDown(w, units) · onWall(w, u) · townOrder / townMove (world.js hooks) · townWallTick (siege.js, per tick)
//   ORDERS (issueOrder kinds): { kind: "man_wall", x, y, lvl: 1|2, facing?, faceSet? } · { kind: "come_down" }
import { S_IDLE, S_MOVE, S_FIGHT, S_FLEE, S_RALLY, S_CAPT, ST_FLEE, W_INCAP, W_MORTAL, clamp } from "./soldiers.js";
import { ARMS } from "./arms.js";
import { DT, steer, applyOrder, issueOrder } from "./world.js";
import { gateGeom, pointSeg } from "./features.js";
import { fell, knockDown } from "./melee.js";
import * as WN from "./wallnav.js";
import { blocked } from "./obstacles.js";
import { FEATURES } from "./terrain-types.js";

// ─────────────────────────────────────────────────────────────── dimensions (the models' — see the header)
export const TWD = {
  palisade: { deck: 3.72, base: -0.3, off: 0.9, w: 1.3, top: 4.9, across: [-0.4, 1.8], every: 3, name: "the palisade", walkName: "Fighting step",
    link: { kind: "ladder", foot: 3.05, along: 0, len: 4.0, speed: 0.55, head: 1.8 }, cover: [0.7, 0.5], fall: [0.1, 0.02], dropIn: 0.2 },
  stone_wall: { deck: 7.0, base: -0.3, off: 0.3, w: 1.6, top: 9.1, across: [-1.75, 1.25], every: 6, name: "the town wall", walkName: "Wall-walk",
    link: { kind: "stair", foot: 1.75, along: 9, len: 11.5, speed: 0.6, head: 1.0 }, cover: [0.8, 0.6], fall: [0.45, 0.15], dropIn: 2.2 }, // (a straight stair against the inner face, rising along the wall to the walk)
  gate: { top: 5.4, base: -0.15, hw: 5.2, hd: 1.0, inw: 0.15, cover: 0.75, boxH: 7.4, across: [-1.7, 1.9], name: "Gate tower" },
  gatehouse: { walk: 7.0, top: 10.5, base: -0.15, hw: 5.2, hd: 2.2, inw: 1.1, cover: 0.8, boxH: 11.6, across: [-1.9, 4.0], name: "Gatehouse roof" },
  watchtower: { top: 10.6, base: -0.15, half: 2.3, cover: 0.75, boxH: 13, name: "Watchtower top",
    link: { kind: "ladder", foot: 4.6, len: 11.5, speed: 0.4, head: 3.0 } },
};
export const SPACING = 1.2;   // m of walk per man (a merlon and a crenel; a man's room to draw and loose)
export const REACH = 48;      // m either side of the point ordered: the frontage one company spreads over
const TOP_ROOM = 3.5;         // m² a man wants on a tower top to draw and loose (castle.js ROOM.top)
const V0 = 1.2;               // m/s: the walking pace that turns a link's time into a path cost
const JOIN = 4;               // m: walk ends of neighbouring stretches this close are one walk

// ─────────────────────────────────────────────────────────────── the circuit
const isRun = (b) => (b.kind === "palisade" || b.kind === "stone_wall") && b.x1 !== undefined && b.castle === undefined && b.replaces === undefined; // (stone rising in a palisade's place has no walk until it stands — js/sim/demolish.js)
const isGateB = (b) => (b.kind === "gate" || b.kind === "gatehouse") && b.gx1 !== undefined && b.castle === undefined && b.replaces === undefined;
const isTower = (b) => b.kind === "watchtower" && b.castle === undefined;
function wallSig(w) {
  let s = "";
  for (const b of w.buildings || []) if (!b.field && (isRun(b) || isGateB(b) || isTower(b))) s += `${b.id}${b.kind[0]}${b.kind[1]};`;
  return s;
}
// the circuit for the world's walls as they stand (built lazily; plain data on the world)
export function layer(w) {
  let L = w.townWalls;
  const key = (w.buildings?.length || 0) + ":" + (w.nextBuilding || 0);
  if (L && L.key === key) return L;
  const sig = wallSig(w);
  if (L && L.sig === sig) { L.key = key; return L; }
  const old = L;
  L = buildLayer(w, sig); L.key = key; w.townWalls = L;
  if (old && w.twM?.n) rehome(w, L);
  return L;
}
const cacheOf = (L) => { let c = L._; if (!c) { c = { fields: new Map(), ver: "" }; Object.defineProperty(L, "_", { value: c, enumerable: false, writable: true, configurable: true }); } const v = L.sig.length + ":" + L.goneVer + ":" + L.edges.length; if (c.ver !== v) { c.fields.clear(); c.ver = v; } return c; };

function townCentre(w, team, fallback) { const T = w.teams?.[team]?.town; return T && Number.isFinite(T.x) ? T : fallback; }
function buildLayer(w, sig) {
  const L = { sig, key: "", nodes: [], edges: [], links: [], parts: [], goneVer: 0, teams: {} };
  const N = L.nodes, E = L.edges, map = w.map, H = (x, y) => map.h(x, y);
  const node = (x, y, lvl, z, team, extra) => { const n = { id: N.length, x, y, lvl, z, team, adj: [], ...extra }; N.push(n); return n; };
  const edge = (a, b, lvl, wd, z, kind, extra) => { const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 0.01; const e = { id: E.length, a: a.id, b: b.id, lvl, w: wd, z, len, ux: dx / len, uy: dy / len, kind, team: a.team, gone: true, ...extra }; E.push(e); a.adj.push(e.id); b.adj.push(e.id); return e; };
  // a ladder or stair: from the ground at `foot` (or from the walk node `from`) up to the node `head`
  const link = (kind, team, bid, foot, head, D, extra = {}) => {
    const g = foot ? node(foot[0], foot[1], 0, H(foot[0], foot[1]), team, { ground: true }) : N[extra.from];
    const T = { id: L.links.length, kind, team, bid, a: { lvl: g.lvl, node: g.id, x: g.x, y: g.y }, b: { lvl: head.lvl, node: head.id, x: head.x, y: head.y }, width: 1, len: D.len, speed: D.speed, head: D.head, time: D.len / D.speed, lanes: [0], q: 0, qn: 0, gone: true, ...extra };
    delete T.from; L.links.push(T); return T;
  };
  // the centres of each team's walls (where no town is known): the inside is toward them
  const cen = {};
  for (const b of w.buildings || []) { if (b.field || !(isRun(b) || isGateB(b))) continue; const c = (cen[b.team] ||= [0, 0, 0]); c[0] += b.x; c[1] += b.y; c[2]++; }
  const inwardAt = (team, x, y, nx, ny) => { const c = cen[team], T = townCentre(w, team, c ? { x: c[0] / c[2], y: c[1] / c[2] } : { x, y }); return (T.x - x) * nx + (T.y - y) * ny > 0 ? -1 : 1; }; // → sign making (nx, ny) point OUT
  const ends = []; // { n: node, e: edge at that end, part }
  // a run of walk over [x1,y1]→[x2,y2]: one edge per module of `nm` (modules `mod0`.. of building b), access links
  function run(b, D, x1, y1, x2, y2, nm, modOf, links = true) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy); if (len < 1.5) return null;
    const ux = dx / len, uy = dy / len; let nx = uy, ny = -ux; const sg = inwardAt(b.team, (x1 + x2) / 2, (y1 + y2) / 2, nx, ny); nx *= sg; ny *= sg;
    const ix = -nx * D.off, iy = -ny * D.off, zs = [];
    for (let k = 0; k < nm; k++) { const t = (k + 0.5) / nm; zs.push(H(x1 + dx * t, y1 + dy * t) + D.base + D.deck); }
    const part = { id: L.parts.length, kind: "run", wall: b.kind === "gate" ? "palisade" : b.kind === "gatehouse" ? "stone_wall" : b.kind, bid: b.id, team: b.team, x1, y1, x2, y2, ux, uy, nx, ny, len, z: zs.reduce((s, v) => s + v, 0) / nm, edges: [] };
    L.parts.push(part);
    const ns = [];
    for (let k = 0; k <= nm; k++) { const f = k / nm, z = k === 0 ? zs[0] : k === nm ? zs[nm - 1] : (zs[k - 1] + zs[k]) / 2; ns.push(node(x1 + dx * f + ix, y1 + dy * f + iy, 1, z, b.team)); }
    for (let k = 0; k < nm; k++) part.edges.push(edge(ns[k], ns[k + 1], 1, D.w, zs[k], "walk", { bid: b.id, mod: modOf(k), part: part.id, nx, ny, wall: part.wall }).id);
    ends.push({ n: ns[0], e: part.edges[0], part: part.id }, { n: ns[nm], e: part.edges[nm - 1], part: part.id });
    if (links) { // ladders (a palisade) or straight stairs up the inner face (a stone wall), at the joints, one every D.every modules
      const js = []; for (let j = 1; j < nm; j++) if (j % D.every === (D.every >> 1)) js.push(j);
      if (!js.length) js.push(nm >> 1);
      for (const j of js) {
        const hd = ns[j], fx = hd.x - nx * (D.link.foot - D.off) - ux * D.link.along, fy = hd.y - ny * (D.link.foot - D.off) - uy * D.link.along;
        const T = link(D.link.kind, b.team, b.id, [fx, fy], hd, D.link, { part: part.id, mod: modOf(Math.min(nm - 1, j)) });
        if (D.link.along) T.rh = [hd.x - nx * (D.link.foot - D.off), hd.y - ny * (D.link.foot - D.off)]; // (where the stair's top step meets the walk, for the renderer)
      }
    }
    return { part, ns };
  }
  for (const b of w.buildings || []) {
    if (b.field) continue;
    if (isRun(b)) { const nm = Math.max(1, Math.round(Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 6)); run(b, TWD[b.kind], b.x1, b.y1, b.x2, b.y2, nm, (k) => k); continue; }
    if (isGateB(b)) {
      const G = gateGeom(b), D = TWD[b.kind === "gate" ? "palisade" : "stone_wall"], DG = TWD[b.kind];
      let nx = G.uy, ny = -G.ux; const sg = inwardAt(b.team, G.px, G.py, nx, ny); nx *= sg; ny *= sg;
      // the flanks: modules out to the stretch's ends (as render/buildings.js lays them)
      const fl = [];
      for (const [a0, a1] of [[0, G.t - 6], [G.t + 6, G.L]]) {
        const len = a1 - a0; if (len < 2) { fl.push(null); continue; }
        const r = run(b, D, G.ax + G.ux * a0, G.ay + G.uy * a0, G.ax + G.ux * a1, G.ay + G.uy * a1, Math.max(1, Math.round(len / 6)), () => -1, len > 14);
        fl.push(r);
      }
      const z0 = H(b.x, b.y) + DG.base, cx = G.px - nx * DG.inw, cy = G.py - ny * DG.inw;
      const part = { id: L.parts.length, kind: b.kind === "gate" ? "gtop" : "ghouse", bid: b.id, team: b.team, cx: G.px, cy: G.py, ux: G.ux, uy: G.uy, nx, ny, hw: 6, across: DG.across, boxH: DG.boxH, z0, edges: [], rect: { cx, cy, ca: G.ux, sa: G.uy, hw: DG.hw, hd: DG.hd } };
      L.parts.push(part);
      const tz = z0 + DG.top, T0 = node(cx - G.ux * (DG.hw - 0.8), cy - G.uy * (DG.hw - 0.8), 2, tz, b.team), Tm = node(cx, cy, 2, tz, b.team), T1 = node(cx + G.ux * (DG.hw - 0.8), cy + G.uy * (DG.hw - 0.8), 2, tz, b.team);
      for (const [a, c] of [[T0, Tm], [Tm, T1]]) part.edges.push(edge(a, c, 2, 2 * DG.hd, tz, "top", { bid: b.id, mod: -1, part: part.id, nx, ny, clamp: part.rect }).id);
      part.top = { lvl: 2, z: tz, cap: Math.max(4, Math.floor(4 * DG.hw * DG.hd / TOP_ROOM)) };
      const flankEnd = (r, s) => r ? r.ns[s ? 0 : r.ns.length - 1] : null; // (the end at the gate)
      if (b.kind === "gate") {
        // the walk meets a door in each tower's side; a short stair inside up to the platform; a ladder from the ground
        for (const [r, s, Tn] of [[fl[0], 0, T0], [fl[1], 1, T1]]) { const e = flankEnd(r, s); if (e) link("stair", b.team, b.id, null, Tn, { len: 3, speed: 0.5, head: 1.2 }, { from: e.id, part: part.id }); }
        link("ladder", b.team, b.id, [G.px - nx * 3.2 + G.ux * 4.6, G.py - ny * 3.2 + G.uy * 4.6], T1, { len: 6, speed: 0.5, head: 2.0 }, { part: part.id });
      } else {
        // the chamber at walk level from flank door to flank door (along the walk's line), the roof up a spiral stair
        const cz = z0 + DG.walk, wx = -nx * TWD.stone_wall.off, wy = -ny * TWD.stone_wall.off;
        const C0 = node(G.px - G.ux * 6 + wx, G.py - G.uy * 6 + wy, 1, cz, b.team), Cm = node(G.px + wx, G.py + wy, 1, cz, b.team), C1 = node(G.px + G.ux * 6 + wx, G.py + G.uy * 6 + wy, 1, cz, b.team);
        const ch = { cx: G.px - nx * 1.1, cy: G.py - ny * 1.1, ca: G.ux, sa: G.uy, hw: 6.4, hd: 2.4 }; // (from flank door to flank door)
        for (const [a, c] of [[C0, Cm], [Cm, C1]]) part.edges.push(edge(a, c, 1, 3, cz, "room", { bid: b.id, mod: -1, part: part.id, nx, ny, clamp: ch }).id);
        ends.push({ n: C0, e: part.edges[part.edges.length - 2], part: part.id }, { n: C1, e: part.edges[part.edges.length - 1], part: part.id });
        link("stair", b.team, b.id, null, Tm, { len: (DG.top - DG.walk) * 1.8, speed: 0.5, head: 1.6 }, { from: Cm.id, part: part.id, spiral: true });
        const SD = TWD.stone_wall.link; // (stairs up the curtain's inner face beside each flank, to the flank door)
        for (const [s, Cn] of [[-1, C0], [1, C1]]) { const T = link("stair", b.team, b.id, [G.px + G.ux * s * (6 + SD.along) - nx * SD.foot, G.py + G.uy * s * (6 + SD.along) - ny * SD.foot], Cn, SD, { part: part.id }); T.rh = [Cn.x - nx * (SD.foot - TWD.stone_wall.off), Cn.y - ny * (SD.foot - TWD.stone_wall.off)]; }
      }
      continue;
    }
    if (isTower(b)) {
      const D = TWD.watchtower, c = cen[b.team], T = townCentre(w, b.team, c ? { x: c[0] / c[2], y: c[1] / c[2] } : { x: b.x, y: b.y + 1 });
      let ix = T.x - b.x, iy = T.y - b.y; const il = Math.hypot(ix, iy) || 1; ix /= il; iy /= il;
      const z0 = H(b.x, b.y) + D.base, tz = z0 + D.top, ca = Math.cos(b.rot || 0), sa = Math.sin(b.rot || 0);
      const part = { id: L.parts.length, kind: "wtower", bid: b.id, team: b.team, cx: b.x, cy: b.y, ux: ca, uy: sa, nx: -ix, ny: -iy, hw: 3.0, across: [-3.0, 3.0], boxH: D.boxH, z0, edges: [], rect: { cx: b.x, cy: b.y, ca, sa, hw: D.half, hd: D.half }, sq: true };
      L.parts.push(part);
      const A = node(b.x - ix * 1.2, b.y - iy * 1.2, 2, tz, b.team), B2 = node(b.x + ix * 1.2, b.y + iy * 1.2, 2, tz, b.team);
      part.edges.push(edge(A, B2, 2, 2 * D.half, tz, "top", { bid: b.id, mod: -1, part: part.id, nx: -ix, ny: -iy, clamp: part.rect }).id);
      part.top = { lvl: 2, z: tz, cap: Math.max(4, Math.floor(4 * D.half * D.half / TOP_ROOM)) };
      link("ladder", b.team, b.id, [b.x + ix * D.link.foot, b.y + iy * D.link.foot], B2, D.link, { part: part.id });
    }
  }
  // the walk ends of neighbouring stretches (a corner of the circuit, a gate's flank) are one walk: a short joint edge
  for (let k = 0; k < ends.length; k++) {
    const A = ends[k], best = nearestEnd(ends, A);
    if (!best || best.n === A.n || N[A.n.id].adj.some((ei) => (E[ei].a === best.n.id || E[ei].b === best.n.id))) continue; // (each pair once)
    if (Math.hypot(best.n.x - A.n.x, best.n.y - A.n.y) < 0.5) { // (one point: the two ends are one node — a gatehouse's flank door)
      const B2 = best.n; for (const ei of B2.adj) { const e = E[ei]; if (e.a === B2.id) e.a = A.n.id; if (e.b === B2.id) e.b = A.n.id; A.n.adj.push(ei); } B2.adj = [];
      for (const T of L.links) { if (T.a.node === B2.id) T.a.node = A.n.id; if (T.b.node === B2.id) T.b.node = A.n.id; }
      for (const Q of ends) if (Q.n === B2) Q.n = A.n;
      continue;
    }
    const ea = E[A.e], eb = E[best.e];
    edge(A.n, best.n, 1, Math.min(ea.w, eb.w), (A.n.z + best.n.z) / 2, "walk", { joint: [A.e, best.e], part: ea.part, nx: (ea.nx + eb.nx) / 2, ny: (ea.ny + eb.ny) / 2, wall: ea.wall });
  }
  // each team's box (the pick's broad test)
  for (const n of N) { const B = (L.teams[n.team] ||= [Infinity, Infinity, -Infinity, -Infinity]); B[0] = Math.min(B[0], n.x - 12); B[1] = Math.min(B[1], n.y - 12); B[2] = Math.max(B[2], n.x + 12); B[3] = Math.max(B[3], n.y + 12); }
  refreshGone(w, L, true);
  return L;
}
function nearestEnd(ends, A) { let best = null, bd = JOIN; for (const B2 of ends) { if (B2 === A || B2.part === A.part || B2.n.team !== A.n.team) continue; const d = Math.hypot(B2.n.x - A.n.x, B2.n.y - A.n.y); if (d < bd) { bd = d; best = B2; } } return best; }

// (the realm client's renderer: its mirror runs no sim, so the walks it draws men on are brought up to date here)
export function refreshTown(w) { const L = layer(w); refreshGone(w, L); return L; }
// which pieces stand: a module breached (b.mods[k] ≤ 0), a building not finished or a ruin, takes the walk on it
function refreshGone(w, L, force = false) {
  const bOf = new Map(); for (const b of w.buildings || []) if (!b.field) bOf.set(b.id, b);
  const down = (bid, mod) => { const b = bOf.get(bid); return !b || b.ruin || (b.progress ?? 1) < 1 || (mod >= 0 && !!b.mods && !(b.mods[mod] > 0)); };
  let ch = false; const E = L.edges;
  for (const e of E) { if (e.joint) continue; const g = down(e.bid, e.mod); if (g !== e.gone) { e.gone = g; ch = true; } }
  for (const e of E) { if (!e.joint) continue; const g = E[e.joint[0]].gone || E[e.joint[1]].gone; if (g !== e.gone) { e.gone = g; ch = true; } }
  for (const T of L.links) { const hd = L.nodes[T.b.node], g = down(T.bid, -1) || !hd.adj.some((ei) => !E[ei].gone) || (T.a.lvl > 0 && !L.nodes[T.a.node].adj.some((ei) => !E[ei].gone)); if (g !== T.gone) { T.gone = g; ch = true; } }
  if (ch && !force) L.goneVer++;
  return ch;
}

// ─────────────────────────────────────────────────────────────── per-man state (w.twM: typed arrays, saved with the world)
const MK = { on: Uint8Array, edge: Int32Array, link: Int32Array, lp: Float32Array, ldir: Uint8Array, h: Float32Array, gl: Int8Array, ge: Int32Array, gt: Float32Array, gx: Float32Array, gy: Float32Array, gf: Float32Array, gi: Int32Array, via: Int32Array, vs: Uint8Array, viaT: Float32Array };
const MINUS = new Set(["edge", "link", "gl", "ge", "gi", "via"]);
export function men(w) {
  const S = w.S; let M = w.twM;
  if (!M || M.cap < S.cap) {
    const old = M, cap = S.cap; M = { cap, n: old?.n || 0 };
    for (const [k, T] of Object.entries(MK)) { const a = new T(cap); if (MINUS.has(k)) a.fill(-1); if (k === "gf") a.fill(NaN); if (old?.[k]) a.set(old[k].subarray(0, Math.min(old.cap, cap))); M[k] = a; }
    w.twM = M;
  }
  return M;
}
function on(M, i) { if (!M.on[i]) { M.on[i] = 1; M.n++; } }
function off(w, M, i) { if (M.on[i]) { M.on[i] = 0; M.n = Math.max(0, M.n - 1); } M.link[i] = -1; M.edge[i] = -1; M.h[i] = 0; M.gl[i] = -1; M.gi[i] = -1; M.via[i] = -1; if (w.S.lvl[i]) w.S.lvl[i] = 0; }
const setGoal = (M, i, g, gi = -1) => { M.gl[i] = g.lvl; M.ge[i] = g.e ?? -1; M.gt[i] = g.t ?? 0; M.gx[i] = g.x; M.gy[i] = g.y; M.gf[i] = g.face ?? NaN; M.gi[i] = gi; M.via[i] = -1; };
// the walls rebuilt (a stretch raised or pulled down): every man up there onto the nearest walk of his level, and every
// company on the walls takes its places again
function rehome(w, L) {
  const S = w.S, M = w.twM;
  for (let i = 0; i < S.n; i++) {
    if (!M.on[i]) continue;
    M.link[i] = -1; M.via[i] = -1;
    if (S.lvl[i] > 0) { const e = nearestEdge(L, S.team[i], S.x[i], S.y[i], S.lvl[i], null, 15); if (e < 0) dropMan(w, L, M, i, null, false); else M.edge[i] = e; }
  }
  for (const u of w.units.values()) if (u.tw?.kind === "man") startMan(w, u, { ...u.tw.o, kind: "man_wall", again: true });
}

// ─────────────────────────────────────────────────────────────── queries
export const onWall = (w, u) => !!u?.tw || u?.members.some((i) => w.twM?.on[i] && (w.S.lvl[i] > 0 || w.twM.link[i] >= 0));
function nearestEdge(L, team, x, y, lvl, kinds = null, maxD = Infinity) {
  const N = L.nodes; let best = -1, bd = maxD;
  for (const e of L.edges) { if (e.gone || e.lvl !== lvl || (team !== null && e.team !== team) || (kinds && !kinds.includes(e.kind))) continue; const a = N[e.a], b = N[e.b], d = pointSeg(x, y, a.x, a.y, b.x, b.y); if (d < bd) { bd = d; best = e.id; } }
  return best;
}
const along = (L, e, x, y) => { const a = L.nodes[e.a]; return clamp((x - a.x) * e.ux + (y - a.y) * e.uy, 0, e.len); };
const at = (L, e, t) => { const a = L.nodes[e.a]; return [a.x + e.ux * t, a.y + e.uy * t]; };
// men the team's standing walk holds (the AI asks before it sends men up)
export function capacity(w, team) { const L = layer(w); let m = 0; for (const e of L.edges) if (!e.gone && e.team === team && e.kind === "walk") m += e.len; return Math.floor(m / SPACING); }
// a man's height above the terrain where he stands (the renderer; the realm client, whose mirror runs no sim, estimates
// it from his level and the walk nearest him)
export function drawHeight(w, i) {
  const S = w.S, M = w.twM;
  if (M && i < M.cap && M.on[i] && (M.h[i] > 0 || M.link[i] >= 0)) return M.h[i];
  const lv = S.lvl?.[i]; if (!lv || !w.townWalls) return 0;
  const L = w.townWalls, e = nearestEdge(L, null, S.x[i], S.y[i], lv, null, 4);
  return e < 0 ? 0 : Math.max(0, L.edges[e].z - w.map.h(S.x[i], S.y[i]));
}

// ─────────────────────────────────────────────────────────────── the goal field (cost to the goal from every node)
function goalField(L, g) {
  const C = cacheOf(L), key = g.key;
  let D = C.fields.get(key); if (D) return D;
  if (C.fields.size > 400) C.fields.clear();
  const N = L.nodes, E = L.edges; D = new Float64Array(N.length).fill(Infinity);
  const H = []; // a small binary heap of [cost, node]
  const push = (k, v) => { if (v >= D[k]) return; D[k] = v; H.push([v, k]); let i = H.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (H[p][0] <= v) break; [H[p], H[i]] = [H[i], H[p]]; i = p; } };
  const pop = () => { const top = H[0], last = H.pop(); if (H.length) { H[0] = last; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= H.length) break; if (c + 1 < H.length && H[c + 1][0] < H[c][0]) c++; if (H[c][0] >= H[i][0]) break; [H[c], H[i]] = [H[i], H[c]]; i = c; } } return top; };
  const grounds = []; for (const T of L.links) if (!T.gone && T.a.lvl === 0) grounds.push(T.a.node); // (anyone may go down a ladder: a stormer too)
  const linksAt = new Map(); for (const T of L.links) { if (T.gone) continue; for (const [s, nd] of [[0, T.a.node], [1, T.b.node]]) (linksAt.get(nd) || linksAt.set(nd, []).get(nd)).push([T, s]); }
  if (g.down) for (const n of grounds) push(n, 0);
  else if (g.lvl > 0) { const e = E[g.e]; if (e && !e.gone) { push(e.a, g.t); push(e.b, e.len - g.t); } }
  else for (const n of grounds) push(n, Math.hypot(N[n].x - g.x, N[n].y - g.y) * 1.25);
  while (H.length) {
    const [dk, k] = pop(); if (dk > D[k]) continue;
    const nd = N[k];
    for (const ei of nd.adj) { const e = E[ei]; if (e.gone) continue; push(e.a === k ? e.b : e.a, dk + e.len); }
    for (const [T, s] of linksAt.get(k) || []) push(s ? T.a.node : T.b.node, dk + (T.time + T.head) * V0);
    if (nd.ground) for (const m of grounds) if (m !== k && N[m].team === nd.team) push(m, dk + Math.hypot(N[m].x - nd.x, N[m].y - nd.y) * 1.25); // (inside one town)
  }
  C.fields.set(key, D); D.linksAt = linksAt;
  return D;
}
const DOWN = { down: true, lvl: 0, key: "down" };
const goalOf = (M, i) => M.gl[i] > 0 ? { lvl: M.gl[i], e: M.ge[i], t: M.gt[i], key: `e${M.ge[i]}:${Math.round(M.gt[i])}` } : { lvl: 0, x: M.gx[i], y: M.gy[i], key: `g${Math.round(M.gx[i] / 4)}:${Math.round(M.gy[i] / 4)}` };

// ─────────────────────────────────────────────────────────────── places for so many men
// along the walk from (e0, t0) both ways, one man to SPACING m, skipping places another company holds, at most REACH m out
function walkSlots(L, e0, t0, n, held, reach = REACH) {
  const N = L.nodes, E = L.edges;
  const free = (x, y) => !held.some((h) => (h[0] - x) ** 2 + (h[1] - y) ** 2 < 0.8);
  const chain = (dir0) => {
    const res = []; let e = e0, dir = dir0, t = t0 + dir * SPACING * 0.5, gone = SPACING * 0.5, budget = reach; const seen = new Set([e0]);
    while (res.length < n && gone <= budget && gone < 400) {
      const ed = E[e];
      if (t >= 0 && t <= ed.len) { if (ed.kind === "walk" && !ed.joint) { const [x, y] = at(L, ed, t); if (free(x, y)) res.push({ lvl: 1, e, t, x, y, face: Math.atan2(ed.ny, ed.nx) }); else budget += SPACING; } t += dir * SPACING; gone += SPACING; continue; } // (places another company holds do not count against the frontage: the next free ones are taken)
      const nd = t > ed.len ? ed.b : ed.a, over = t > ed.len ? t - ed.len : -t, hx = ed.ux * (t > ed.len ? 1 : -1), hy = ed.uy * (t > ed.len ? 1 : -1);
      let nx = -1, bd = -Infinity;
      for (const ei of N[nd].adj) { if (seen.has(ei)) continue; const q = E[ei]; if (q.gone || q.lvl !== 1) continue; const s = q.a === nd ? 1 : -1, c = s * (q.ux * hx + q.uy * hy); if (c > bd) { bd = c; nx = ei; } }
      if (nx < 0) break;
      seen.add(nx); const q = E[nx]; e = nx; dir = q.a === nd ? 1 : -1; t = dir > 0 ? over : q.len - over;
    }
    return res;
  };
  const R = chain(1), Lf = chain(-1), out = [];
  for (let k = 0; out.length < n && (k < R.length || k < Lf.length); k++) { if (k < R.length) out.push(R[k]); if (out.length < n && k < Lf.length) out.push(Lf[k]); }
  return out;
}
// a tower top, the gatehouse roof, the gate's platform: a grid of places inside its parapet, the outer face first
function topSlots(L, part, n, held) {
  const r = part.rect, out = [], sp = 1.2, na = Math.max(1, Math.floor(2 * r.hw / sp)), nb = Math.max(1, Math.floor(2 * r.hd / sp)), cap = part.top.cap, face = Math.atan2(part.ny, part.nx);
  const cand = [];
  for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) {
    const a = -r.hw + (i + 0.5) * 2 * r.hw / na, b = -r.hd + (j + 0.5) * 2 * r.hd / nb, x = r.cx + a * r.ca - b * r.sa, y = r.cy + a * r.sa + b * r.ca;
    cand.push({ x, y, out: (x - r.cx) * part.nx + (y - r.cy) * part.ny, a });
  }
  cand.sort((p, q) => q.out - p.out || Math.abs(p.a) - Math.abs(q.a));
  for (const c of cand) {
    if (out.length >= Math.min(n, cap)) break;
    if (held.some((h) => (h[0] - c.x) ** 2 + (h[1] - c.y) ** 2 < 0.8)) continue;
    if (out.some((g) => (g.x - c.x) ** 2 + (g.y - c.y) ** 2 < 1.3)) continue;
    let be = -1, bd = Infinity; for (const ei of part.edges) { const e = L.edges[ei]; if (e.lvl !== part.top.lvl) continue; const a = L.nodes[e.a], b = L.nodes[e.b], d = pointSeg(c.x, c.y, a.x, a.y, b.x, b.y); if (d < bd) { bd = d; be = ei; } } // (the top's own edges: not the gatehouse chamber below it)
    out.push({ lvl: 2, e: be, t: along(L, L.edges[be], c.x, c.y), x: c.x, y: c.y, face: part.sq ? Math.atan2(c.y - r.cy, c.x - r.cx) : face });
  }
  return out;
}
// a block standing ready on the ground behind the wall: rows along the wall at (cx, cy), `ix, iy` pointing in
function groundSpots(w, cx, cy, ix, iy, n, back = 5) {
  const out = [], files = Math.max(4, Math.ceil(Math.sqrt(n * 3))), ax = -iy, ay = ix;
  for (let q = 0; out.length < n && q < n * 4; q++) {
    const f = q % files, r = Math.floor(q / files), a = (f - (files - 1) / 2) * 1.2, b = back + r * 1.2;
    const x = cx + ax * a + ix * b, y = cy + ay * a + iy * b;
    if (w.map.water && w.map.water(x, y) > 0.5) continue;
    out.push({ lvl: 0, x, y, face: Math.atan2(-iy, -ix) });
  }
  while (out.length < n) out.push({ lvl: 0, x: cx + ix * back, y: cy + iy * back, face: Math.atan2(-iy, -ix) });
  return out;
}
// places held by other companies' men (alive, on their way or there)
function heldBy(w, M, exceptUnit) { const S = w.S, out = []; for (let i = 0; i < S.n; i++) if (M.on[i] && M.gl[i] > 0 && S.alive[i] && S.unit[i] !== exceptUnit) out.push([M.gx[i], M.gy[i]]); return out; }

// ─────────────────────────────────────────────────────────────── orders
const footOK = (u) => { const A = ARMS[u.arm]; return A && !A.mounted && !A.engine && !u.isWorkers; };
// applyOrder's hook (world.js): man_wall / come_down, and any other order to a company on the walls (down first)
export function townOrder(w, u, o) {
  if (o.raw) return false;
  if (o.kind === "man_wall") { if (!footOK(u)) { w.events.push({ t: w.tick, kind: "townwall-refused", team: u.team, unit: u.id, why: ARMS[u.arm]?.mounted ? "horses do not go up on the walls" : "they cannot go up there" }); return true; } return startMan(w, u, o); }
  if (o.kind === "come_down") { if (onWall(w, u)) startDown(w, u, null); return true; }
  if (!u.tw) return false;
  if (u.tw.kind === "down" && !u.members.some((i) => w.S.lvl[i] > 0 || w.twM?.link[i] >= 0)) { release(w, u); return false; } // (all down already: the order is an ordinary one)
  startDown(w, u, { ...o }); // anything else: down from the wall, then as ordered
  return true;
}
function startMan(w, u, o) {
  const L = layer(w), S = w.S, M = men(w), team = u.team, mem = u.members.filter((i) => S.alive[i]);
  if (!mem.length) return true;
  installHooks(w);
  const held = heldBy(w, M, u.id);
  let lvl = o.lvl === 2 ? 2 : 1, slots = null, part = null;
  if (lvl === 2) { let bd = 25; for (const p of L.parts) { if (!p.top || p.team !== team || p.edges.every((ei) => L.edges[ei].gone)) continue; const d = Math.hypot(p.rect.cx - o.x, p.rect.cy - o.y); if (d < bd) { bd = d; part = p; } } if (!part) lvl = 1; }
  if (lvl === 2) { slots = topSlots(L, part, mem.length, held); if (slots.length < mem.length && part.kind !== "wtower") { const e = nearestEdge(L, team, part.rect.cx, part.rect.cy, 1, ["walk"], 20); if (e >= 0) slots.push(...walkSlots(L, e, along(L, L.edges[e], part.rect.cx, part.rect.cy), mem.length - slots.length, held.concat(slots.map((s) => [s.x, s.y])))); } }
  else { const e = nearestEdge(L, team, o.x, o.y, 1, ["walk"], 60); if (e < 0) { w.events.push({ t: w.tick, kind: "townwall-refused", team, unit: u.id, why: "no standing wall-walk there" }); return true; } slots = walkSlots(L, e, along(L, L.edges[e], o.x, o.y), mem.length, held); }
  if (!slots.length) { w.events.push({ t: w.tick, kind: "townwall-refused", team, unit: u.id, why: "every place on that stretch is taken" }); return true; }
  if (o.faceSet && Number.isFinite(o.facing)) for (const g of slots) g.face = o.facing; // (a right-drag set which way they face up there; else outward)
  // the men nearest each place take it; the rest stand ready behind the wall, by the ladder nearest the middle
  const cx = slots.reduce((s, g) => s + g.x, 0) / slots.length, cy = slots.reduce((s, g) => s + g.y, 0) / slots.length;
  const e0 = L.edges[slots[0].e], ix = -(e0.nx ?? 0), iy = -(e0.ny ?? 1);
  const order = mem.slice().sort((a, b) => Math.hypot(S.x[a] - cx, S.y[a] - cy) - Math.hypot(S.x[b] - cx, S.y[b] - cy) || a - b), used = new Uint8Array(slots.length);
  const res = groundSpots(w, cx, cy, ix, iy, Math.max(0, mem.length - slots.length), lvl === 2 && part?.kind === "wtower" ? 6 : 5);
  let r = 0;
  for (const i of order) {
    let best = -1, bd = Infinity;
    for (let k = 0; k < slots.length; k++) { if (used[k]) continue; const d = Math.hypot(slots[k].x - S.x[i], slots[k].y - S.y[i]); if (d < bd) { bd = d; best = k; } }
    on(M, i);
    if (best >= 0) { used[best] = 1; setGoal(M, i, slots[best], best); }
    else setGoal(M, i, res[r++] || res[0] || { lvl: 0, x: cx + ix * 5, y: cy + iy * 5 }, -1);
    if (S.state[i] === S_IDLE) S.state[i] = S_MOVE;
  }
  const face = slots[0].face;
  u.tw = { kind: "man", lvl, o: { x: o.x, y: o.y, lvl, facing: o.facing, faceSet: !!o.faceSet, pace: o.pace }, slots: slots.map((g) => ({ lvl: g.lvl, e: g.e, t: g.t, x: g.x, y: g.y, face: g.face })), res: res.map((g) => ({ x: g.x, y: g.y, face: g.face })), cx, cy, ix, iy, t0: w.time, then: null, pending: false };
  u.cst = null; u.path = null; u.hold = false; u.pace = o.pace || "quick"; u.orderT = w.time;
  if (u.formation === "column" && u.deployAs) { u.formation = u.deployAs.formation; u.depth = u.deployAs.depth; u.deployAs = null; u.slotCache = null; }
  // a company still far off marches up by the ordinary road first (through the gate, if it is outside)
  const ax = cx + ix * 7, ay = cy + iy * 7;
  if (Math.hypot(u.ax - ax, u.ay - ay) > 60 && !o.again) { applyOrder(w, u, { kind: "move", x: ax, y: ay, raw: true, pace: o.pace || "quick" }); u.tw.pending = true; u.tw.ax = ax; u.tw.ay = ay; }
  u.order = { kind: "man_wall", x: cx, y: cy, lvl, facing: face, player: o.player };
  u.finalFacing = face; u.facing = face - Math.PI / 2;
  if (!o.again) w.events.push({ t: w.tick, kind: "townwall-order", what: lvl === 2 ? "top" : "walk", team, unit: u.id, up: Math.min(slots.length, mem.length), ready: Math.max(0, mem.length - slots.length) });
  return true;
}
// down off the walls by the ladders and stairs, and form behind the wall where the most of them come down
function startDown(w, u, then) {
  const L = layer(w), S = w.S, M = men(w), mem = u.members.filter((i) => S.alive[i]);
  if (!mem.length) { u.tw = null; return; }
  let mx = 0, my = 0; for (const i of mem) { mx += S.x[i] / mem.length; my += S.y[i] / mem.length; }
  let foot = null, bd = Infinity; for (const T of L.links) { if (T.gone || T.team !== u.team || T.a.lvl !== 0) continue; const d = Math.hypot(T.a.x - mx, T.a.y - my); if (d < bd) { bd = d; foot = T; } }
  let ix = 0, iy = 1, fx = mx, fy = my;
  if (foot) { fx = foot.a.x; fy = foot.a.y; ix = foot.a.x - foot.b.x; iy = foot.a.y - foot.b.y; const l = Math.hypot(ix, iy) || 1; ix /= l; iy /= l; }
  const spots = groundSpots(w, fx, fy, ix, iy, mem.length, 3);
  const order = mem.slice().sort((a, b) => Math.hypot(S.x[a] - fx, S.y[a] - fy) - Math.hypot(S.x[b] - fx, S.y[b] - fy) || a - b);
  order.forEach((i, k) => { on(M, i); setGoal(M, i, spots[k], -1); if (S.state[i] === S_IDLE) S.state[i] = S_MOVE; });
  u.tw = { kind: "down", then: then || null, t0: w.time, cx: fx, cy: fy, ix, iy, pending: false };
  u.order = { kind: "hold", x: fx + ix * 4, y: fy + iy * 4, facing: Math.atan2(-iy, -ix) }; u.path = null; u.hold = false;
  w.events.push({ t: w.tick, kind: "townwall-order", what: "down", team: u.team, unit: u.id });
}
function release(w, u) { const M = w.twM; if (M) for (const i of u.members) if (M.on[i] && !(w.S.lvl[i] > 0) && M.link[i] < 0) off(w, M, i); u.tw = null; }
// "Man the walls" for a whole selection (or the AI's garrison): each company to the nearest stretch still free — to
// itself, or to `from` (the threat) — bows first; companies already up stay where they are
export function manWalls(w, team, units, from = null, pace = "quick") {
  const L = layer(w); let n = 0;
  const list = units.filter((u) => u && u.team === team && u.members.length && footOK(u) && u.tw?.kind !== "man").sort((a, b) => (ARMS[b.arm].missile ? 1 : 0) - (ARMS[a.arm].missile ? 1 : 0) || a.id - b.id);
  const hold = []; // (places promised to the companies ordered before this one, their orders still on the way)
  for (const u of list) {
    const M = men(w), held = heldBy(w, M, u.id).concat(hold), px = from ? from.x : u.ax, py = from ? from.y : u.ay;
    let best = null, bd = Infinity; // the nearest free place on a standing walk
    for (const e of L.edges) {
      if (e.gone || e.team !== team || e.kind !== "walk" || e.joint) continue;
      const t = along(L, e, px, py), [x, y] = at(L, e, t), d = Math.hypot(x - px, y - py);
      if (d >= bd) continue;
      if (held.some((h) => (h[0] - x) ** 2 + (h[1] - y) ** 2 < 2)) { // (taken here: the first free place along this edge)
        let ok = false; for (let s = 0; s <= e.len; s += SPACING) { const p = at(L, e, s); if (!held.some((h) => (h[0] - p[0]) ** 2 + (h[1] - p[1]) ** 2 < 0.8)) { const dd = Math.hypot(p[0] - px, p[1] - py); if (dd < bd) { bd = dd; best = { x: p[0], y: p[1] }; } ok = true; break; } }
        if (!ok) continue; continue;
      }
      bd = d; best = { x, y };
    }
    if (!best) break;
    issueOrder(w, [u.id], { kind: "man_wall", x: best.x, y: best.y, lvl: 1, pace }); n++; // (by voice, horn or runner, like any order)
    const be = nearestEdge(L, team, best.x, best.y, 1, ["walk"], 5); // (the places it will take: the next company looks past them)
    if (be >= 0) for (const g of walkSlots(L, be, along(L, L.edges[be], best.x, best.y), u.members.length, held)) hold.push([g.x, g.y]);
  }
  return n;
}
export function comeDown(w, units) { let n = 0; for (const u of units) if (u && onWall(w, u)) { startDown(w, u, null); n++; } return n; }

// ─────────────────────────────────────────────────────────────── moving a company on the walls (world.moveUnit's hook)
export function townMove(w, u) {
  const K = u.tw; if (!K) return false;
  const L = layer(w), S = w.S, M = men(w), A = ARMS[u.arm], t = w.time;
  if (K.pending) { if (u.path && Math.hypot(u.ax - K.ax, u.ay - K.ay) > 20) return false; K.pending = false; u.path = null; }
  let moving = 0, sx = 0, sy = 0, cnt = 0, up = 0, away = 0;
  for (const i of u.members) {
    if (!S.alive[i]) continue;
    on(M, i);
    sx += S.x[i]; sy += S.y[i]; cnt++;
    if (S.lvl[i] > 0 || M.link[i] >= 0) up++;
    if (M.link[i] >= 0) { moving++; continue; } // (on a ladder or stair: the system tick climbs him)
    const st = S.state[i];
    if (st === S_FIGHT || st === S_FLEE || st === S_RALLY || st === S_CAPT || S.posture[i] || S.busyT[i] > t) continue;
    if (M.gl[i] < 0) continue;
    const r = navigate(w, L, M, u, A, i);
    if (r) { moving++; if (Math.hypot(S.x[i] - M.gx[i], S.y[i] - M.gy[i]) > 2.5) away++; }
  }
  if (cnt && (w.tick + u.id) % 5 === 0) { u.ax = sx / cnt; u.ay = sy / cnt; }
  u.path = null; u.moving = moving > 0; u.hold = false;
  if (K.kind === "man" && (w.tick + u.id) % 20 === 0) refill(w, L, M, u);
  if (K.kind === "down" && !up && (away === 0 || t - K.t0 > 60)) {
    const then = K.then; release(w, u);
    if (then) applyOrder(w, u, { ...then });
    else applyOrder(w, u, { kind: "hold", x: u.ax, y: u.ay, facing: Math.atan2(-K.iy, -K.ix), raw: true });
    return true;
  }
  return true;
}
// a place on the wall whose man has fallen is taken by one of those standing ready below; a place whose walk has gone
// (a breach) is given up, and its man stands ready below
function refill(w, L, M, u) {
  const S = w.S, K = u.tw, holder = new Int32Array(K.slots.length).fill(-1), ready = [];
  for (const i of u.members) {
    if (!S.alive[i] || S.status[i] >= ST_FLEE) continue;
    const gi = M.gi[i];
    if (gi >= 0 && gi < K.slots.length) { const g = K.slots[gi]; if (L.edges[g.e]?.gone) { const r = K.res[0] || { x: K.cx + K.ix * 5, y: K.cy + K.iy * 5 }; setGoal(M, i, { lvl: 0, x: r.x + (i % 7) * 0.4, y: r.y, face: r.face }, -1); ready.push(i); } else holder[gi] = i; }
    else ready.push(i);
  }
  for (let k = 0; k < K.slots.length && ready.length; k++) {
    if (holder[k] >= 0 || L.edges[K.slots[k].e]?.gone) continue;
    const g = K.slots[k]; let bi = -1, bd = Infinity;
    for (let q = 0; q < ready.length; q++) { const i = ready[q]; const d = Math.hypot(S.x[i] - g.x, S.y[i] - g.y); if (d < bd) { bd = d; bi = q; } }
    const i = ready.splice(bi, 1)[0]; setGoal(M, i, g, k);
  }
}
// one man's step toward his goal → true while he is still on his way
function navigate(w, L, M, u, A, i) {
  const S = w.S, x = S.x[i], y = S.y[i], lv = S.lvl[i], team = S.team[i], E = L.edges, N = L.nodes;
  const gl = M.gl[i], gx = M.gx[i], gy = M.gy[i];
  if (lv === 0) {
    if (gl === 0) {
      const d = Math.hypot(gx - x, gy - y);
      if (d < 0.5) { steer(w, i, A, gx, gy, false, u); if (M.gf[i] === M.gf[i]) S.facing[i] = M.gf[i]; return false; }
      walkGround(w, u, A, i, gx, gy, d); return true;
    }
    // up: the ladder or stair whose foot gets me there soonest, the queue at it counted
    let T = M.via[i] >= 0 ? L.links[M.via[i]] : null;
    if (!T || T.gone || w.time - M.viaT[i] > 4) {
      const D = goalField(L, goalOf(M, i)); let best = null, bc = Infinity;
      for (const Q of L.links) { if (Q.gone || Q.a.lvl !== 0 || Q.team !== team) continue; const c = Math.hypot(Q.a.x - x, Q.a.y - y) * 1.25 + (Q.time + Q.head + Q.q * Q.head) * V0 + D[Q.b.node]; if (c < bc) { bc = c; best = Q; } }
      M.via[i] = best ? best.id : -1; M.viaT[i] = w.time; T = best;
      if (!T) { steer(w, i, A, x, y, false, u); return false; }
    }
    const d = Math.hypot(T.a.x - x, T.a.y - y);
    if (d < 1.3) { if (!enter(w, M, i, T, 0)) steer(w, i, A, T.a.x, T.a.y, false, u); return true; }
    walkGround(w, u, A, i, T.a.x, T.a.y, d); return true;
  }
  // on a level: along the walk
  let ei = M.edge[i];
  if (ei < 0 || !E[ei] || E[ei].lvl !== lv || E[ei].gone) { ei = nearestEdge(L, null, x, y, lv); M.edge[i] = ei; if (ei < 0) return false; }
  const e = E[ei];
  if (gl === lv && M.ge[i] === ei) { const d = Math.hypot(gx - x, gy - y); go(w, i, A, u, gx, gy, d); if (d < 0.5 && M.gf[i] === M.gf[i]) S.facing[i] = M.gf[i]; return d >= 0.5; }
  const D = goalField(L, gl >= 0 ? goalOf(M, i) : DOWN);
  const tt = along(L, e, x, y), ca = tt + D[e.a], cb = e.len - tt + D[e.b];
  if (!isFinite(ca) && !isFinite(cb)) { steer(w, i, A, x, y, false, u); return false; }
  const nd = ca <= cb ? e.a : e.b, dn = ca <= cb ? tt : e.len - tt;
  if (dn < 0.7) {
    let best = null, bc = Infinity;
    for (const q of N[nd].adj) { const f = E[q]; if (f.gone || f.lvl !== lv) continue; const m = f.a === nd ? f.b : f.a; const c = gl === lv && M.ge[i] === q ? (f.a === nd ? M.gt[i] : f.len - M.gt[i]) : f.len + D[m]; if (c < bc) { bc = c; best = ["e", q]; } }
    for (const [T, s] of D.linksAt.get(nd) || []) { const other = s ? T.a.node : T.b.node, c = (T.time + T.head + T.q * T.head) * V0 + D[other]; if (c < bc) { bc = c; best = ["l", T, s]; } }
    if (!best) { steer(w, i, A, x, y, false, u); return false; }
    if (best[0] === "l") { if (!enter(w, M, i, best[1], best[2])) steer(w, i, A, N[nd].x, N[nd].y, false, u); return true; }
    M.edge[i] = best[1]; const f = E[best[1]], far = f.a === nd ? N[f.b] : N[f.a], Ls = Math.min(f.len, 2), ux = (far.x - N[nd].x) / (f.len || 1), uy = (far.y - N[nd].y) / (f.len || 1);
    go(w, i, A, u, N[nd].x + ux * Ls, N[nd].y + uy * Ls, 9); return true;
  }
  const tgt = clamp(tt + (nd === e.a ? -2 : 2), 0, e.len), [px, py] = at(L, e, tgt);
  go(w, i, A, u, px, py, 9);
  return true;
}
// on the ground: down a flow field over the town's ground round the target (the houses, the hall, the walls in the
// way — a man does not stand pressed against the keep because the ladder lies beyond it); beyond the field, straight,
// or by the gate when a wall is in the way (wallnav.js)
function walkGround(w, u, A, i, tx, ty, d) {
  const S = w.S;
  if (d > 3) { const c = carrot(w, S.x[i], S.y[i], tx, ty); if (c) { go(w, i, A, u, c[0], c[1], d); return; } }
  if (d > 6) { const m = WN.manTarget(w, u.team, S.x[i], S.y[i], tx, ty); if (m) { steer(w, i, A, m[0], m[1], true, u); return; } }
  go(w, i, A, u, tx, ty, d);
}
const GF = { half: 100, cell: 1, steps: 3 };
class MinHeap { constructor() { this.k = new Int32Array(1024); this.p = new Float64Array(1024); this.n = 0; this.lastP = 0; }
  push(k, p) { if (this.n >= this.k.length) { const K = new Int32Array(this.k.length * 2); K.set(this.k); this.k = K; const P = new Float64Array(this.p.length * 2); P.set(this.p); this.p = P; } const K = this.k, P = this.p; let i = this.n++; while (i > 0) { const pa = (i - 1) >> 1; if (P[pa] <= p) break; K[i] = K[pa]; P[i] = P[pa]; i = pa; } K[i] = k; P[i] = p; }
  pop() { const K = this.k, P = this.p, top = K[0]; this.lastP = P[0]; const lk = K[--this.n], lp = P[this.n], n = this.n; if (n) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && P[c + 1] < P[c]) c++; if (P[c] >= lp) break; K[i] = K[c]; P[i] = P[c]; i = c; } K[i] = lk; P[i] = lp; } return top; } }
const SOLIDF = new Set(["timber_palisade", "town_wall", "curtain_wall", "town_gate"]);
const GD = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
// the cost-distance (m) to (tx, ty) over a 1 m grid 200 m across round it: buildings and standing walls solid. A pure
// function of the ground, its buildings and walls and the target: cached (never saved; a restored world builds the same)
function groundFieldAt(w, tx, ty) {
  const L = w.townWalls, C = cacheOf(L), ver = (w.obstacles?.count || 0) + ":" + (w.featuresVer || 0) + ":" + (w.features?.length || 0);
  if (C.gver !== ver) { C.gfields = new Map(); C.gver = ver; }
  const key = Math.round(tx * 2) + "," + Math.round(ty * 2);
  let F = C.gfields.get(key); if (F) return F;
  if (C.gfields.size > 48) C.gfields.delete(C.gfields.keys().next().value);
  const n = 2 * GF.half, x0 = Math.round(tx) - GF.half, y0 = Math.round(ty) - GF.half, solid = new Uint8Array(n * n);
  const O = w.obstacles;
  if (O) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) if (blocked(O, x0 + k + 0.5, y0 + j + 0.5, 0.15)) solid[j * n + k] = 1; // (less than the body the obstacles push a man out by: a man standing against a trunk is never inside the field's solid)
  const slow = new Float32Array(n * n).fill(1); // (a hedge, a fence, a ditch: crossed slowly — a man goes round by its gap when there is one)
  for (const f of w.features || []) {
    const solidF = SOLIDF.has(f.type), secs = solidF ? Infinity : FEATURES[f.type]?.cross?.foot;
    if (!solidF && !(secs > 0)) continue;
    const r = (f.width || 1) / 2 + 0.45, lo = Math.min(f.x0, f.x1) - r, hi = Math.max(f.x0, f.x1) + r, lo2 = Math.min(f.y0, f.y1) - r, hi2 = Math.max(f.y0, f.y1) + r;
    if (hi < x0 || lo > x0 + n || hi2 < y0 || lo2 > y0 + n) continue;
    for (let j = Math.max(0, Math.floor(lo2 - y0)); j < Math.min(n, Math.ceil(hi2 - y0)); j++) for (let k = Math.max(0, Math.floor(lo - x0)); k < Math.min(n, Math.ceil(hi - x0)); k++) if (pointSeg(x0 + k + 0.5, y0 + j + 0.5, f.x0, f.y0, f.x1, f.y1) < r) { if (solidF) solid[j * n + k] = 1; else slow[j * n + k] = Math.max(slow[j * n + k], 1 + Math.min(30, secs)); }
  }
  const D = new Float32Array(n * n).fill(Infinity), H = new MinHeap();
  const push = (k, v) => { v = Math.fround(v); if (v < D[k]) { D[k] = v; H.push(k, v); } }; // (in float32 like D: a value stored rounded down would never be settled)
  const tk = GF.half * n + GF.half; solid[tk] = 0; push(tk, 0);
  while (H.n) {
    const k = H.pop(), v = H.lastP; if (v > D[k]) continue;
    const ci = k % n, cj = (k / n) | 0;
    for (const [di, dj, c] of GD) {
      const ii = ci + di, jj = cj + dj; if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const m = jj * n + ii; if (solid[m]) continue;
      if (di && dj && (solid[cj * n + ii] || solid[jj * n + ci])) continue;
      push(m, v + c * (slow[m] + slow[k]) * 0.5);
    }
  }
  F = { x0, y0, n, D }; C.gfields.set(key, F);
  return F;
}
function carrot(w, x, y, tx, ty) {
  if (!w.townWalls) return null;
  const F = groundFieldAt(w, tx, ty), n = F.n;
  let ci = Math.floor(x - F.x0), cj = Math.floor(y - F.y0);
  if (ci < 0 || cj < 0 || ci >= n || cj >= n) { // (beyond the field: for the open cell on its edge nearest him from which the way on is cheapest)
    ci = clamp(ci, 0, n - 1); cj = clamp(cj, 0, n - 1); let bm = -1, bv = Infinity;
    for (let dj = -8; dj <= 8; dj++) for (let di = -8; di <= 8; di++) { const ii = ci + di, jj = cj + dj; if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue; const v = F.D[jj * n + ii] + Math.hypot(F.x0 + ii + 0.5 - x, F.y0 + jj + 0.5 - y); if (v < bv) { bv = v; bm = jj * n + ii; } }
    return bm < 0 ? null : [F.x0 + (bm % n) + 0.5, F.y0 + ((bm / n) | 0) + 0.5];
  }
  let k = cj * n + ci;
  if (!isFinite(F.D[k])) { // (standing hard against a wall or a house: the open cell beside him that leads on)
    let bm = -1, bv = Infinity;
    for (let r = 1; r <= 3 && bm < 0; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const ii = ci + di, jj = cj + dj; if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue; const v = F.D[jj * n + ii]; if (v < bv) { bv = v; bm = jj * n + ii; } }
    if (bm < 0) return null;
    return [F.x0 + (bm % n) + 0.5, F.y0 + ((bm / n) | 0) + 0.5];
  }
  if (F.D[k] < 2.5) return [tx, ty];
  const O = w.obstacles, clear = (px, py) => { if (!O) return true; for (let q = 1; q <= 4; q++) if (blocked(O, x + (px - x) * q / 4, y + (py - y) * q / 4, 0.3)) return false; return true; };
  let keep = -1;
  for (let s = 0; s < GF.steps; s++) {
    const i = k % n, j = (k / n) | 0; let bm = -1, bv = F.D[k];
    for (const [di, dj] of GD) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue; const m = jj * n + ii; if (F.D[m] < bv) { bv = F.D[m]; bm = m; } }
    if (bm < 0) break; k = bm;
    if (keep < 0 || clear(F.x0 + (k % n) + 0.5, F.y0 + ((k / n) | 0) + 0.5)) keep = k; else break; // (not cutting the corner of a trunk or a house the field goes round)
  }
  if (keep >= 0) k = keep;
  return [F.x0 + (k % n) + 0.5, F.y0 + ((k / n) | 0) + 0.5];
}
function go(w, i, A, u, tx, ty, left) {
  const S = w.S, dx = tx - S.x[i], dy = ty - S.y[i], d = Math.hypot(dx, dy);
  if (left < 1.5 || d < 0.05) { steer(w, i, A, tx, ty, false, u); return; }
  steer(w, i, A, S.x[i] + dx / d * 0.45, S.y[i] + dy / d * 0.45, true, u);
}
// onto a ladder or stair when a lane is free (else he waits his turn at its foot)
function enter(w, M, i, T, s) {
  T.qn++;
  const t = w.time;
  for (let q = 0; q < T.lanes.length; q++) if (T.lanes[q] <= t) { T.lanes[q] = t + T.head; M.link[i] = T.id; M.lp[i] = 0; M.ldir[i] = s; M.via[i] = -1; return true; }
  return false;
}
function linkStep(w, L, M, i) {
  const S = w.S, T = L.links[M.link[i]];
  if (!T || T.gone) { M.link[i] = -1; if (S.lvl[i]) dropMan(w, L, M, i, null, true); else M.h[i] = 0; return; }
  if (S.state[i] === S_FLEE && (M.ldir[i] === 0) && M.lp[i] < 0.75) { M.ldir[i] = 1; M.lp[i] = 1 - M.lp[i]; } // (a man who breaks on the way up turns back down)
  const A0 = M.ldir[i] ? T.b : T.a, B0 = M.ldir[i] ? T.a : T.b, a = L.nodes[A0.node], b = L.nodes[B0.node];
  const fighting = S.state[i] === S_FIGHT || S.posture[i] || S.state[i] === S_CAPT;
  if (!fighting) M.lp[i] = Math.min(1, M.lp[i] + DT * T.speed / T.len * (S.status[i] >= ST_FLEE ? 1.3 : 1));
  const p = M.lp[i], x = a.x + (b.x - a.x) * p, y = a.y + (b.y - a.y) * p;
  if (!fighting) { S.vx[i] = (b.x - a.x) / T.time; S.vy[i] = (b.y - a.y) / T.time; S.facing[i] = Math.atan2(b.y - a.y, b.x - a.x); if (S.state[i] !== S_FLEE) S.state[i] = S_MOVE; S.power[i] = Math.max(S.power[i], b.z > a.z ? 260 : 140); }
  S.x[i] = x; S.y[i] = y;
  const za = a.lvl ? a.z : w.map.h(a.x, a.y), zb = b.lvl ? b.z : w.map.h(b.x, b.y);
  M.h[i] = Math.max(0, za + (zb - za) * p - w.map.h(x, y));
  S.lvl[i] = p < 0.75 ? a.lvl : b.lvl; // (the link-head rule: past ¾ of the way he is among the men at the top)
  if (p >= 1) {
    M.link[i] = -1; S.lvl[i] = b.lvl;
    if (b.lvl > 0) { const e = b.adj.find((q) => !L.edges[q].gone && L.edges[q].lvl === b.lvl); M.edge[i] = e ?? nearestEdge(L, null, x, y, b.lvl); }
    else { M.edge[i] = -1; M.h[i] = 0; }
  }
}
// keep a man on his walk (its width; a top's parapet); his height from the deck under him
function snap(w, L, M, i) {
  const S = w.S, lv = S.lvl[i], E = L.edges, N = L.nodes;
  let ei = M.edge[i];
  if (ei < 0 || !E[ei] || E[ei].lvl !== lv) { ei = nearestEdge(L, null, S.x[i], S.y[i], lv, null, 12); M.edge[i] = ei; }
  if (ei < 0) { dropMan(w, L, M, i, null, true); return; }
  let e = E[ei];
  if (e.gone) { dropMan(w, L, M, i, e, true); return; }
  let a = N[e.a], x = S.x[i], y = S.y[i], t = (x - a.x) * e.ux + (y - a.y) * e.uy;
  if (t < -0.05 || t > e.len + 0.05) { // past an end: onto the neighbouring edge there that holds him best
    const nd = t < 0 ? e.a : e.b; let bd = Math.abs(t < 0 ? t : t - e.len), be = ei;
    for (const q of N[nd].adj) { if (q === ei) continue; const f = E[q]; if (f.gone || f.lvl !== lv) continue; const d = pointSeg(x, y, N[f.a].x, N[f.a].y, N[f.b].x, N[f.b].y); if (d < bd) { bd = d; be = q; } }
    if (be !== ei) { ei = be; M.edge[i] = ei; e = E[ei]; a = N[e.a]; t = (x - a.x) * e.ux + (y - a.y) * e.uy; }
  }
  t = clamp(t, 0, e.len);
  if (e.clamp) { const c = e.clamp, dx = x - c.cx, dy = y - c.cy, p = clamp(dx * c.ca + dy * c.sa, -c.hw, c.hw), q = clamp(-dx * c.sa + dy * c.ca, -c.hd, c.hd); x = c.cx + p * c.ca - q * c.sa; y = c.cy + p * c.sa + q * c.ca; }
  else { const lw = Math.max(0.05, e.w / 2 - 0.25), lat = clamp((x - a.x) * -e.uy + (y - a.y) * e.ux, -lw, lw); x = a.x + e.ux * t - e.uy * lat; y = a.y + e.uy * t + e.ux * lat; }
  S.x[i] = x; S.y[i] = y; M.h[i] = Math.max(0.1, e.z - w.map.h(x, y));
}
// off the wall: the walk under him is gone (a breach, the stretch fired), or there is no way down for a man running —
// he comes down where he stands, hurt as often as the height says
function dropMan(w, L, M, i, e, hurt) {
  const S = w.S, D = TWD[e?.wall] || TWD.palisade, h = M.h[i] || (e ? e.z - w.map.h(S.x[i], S.y[i]) : 3);
  const nx = e?.nx ?? 0, ny = e?.ny ?? 0, din = e?.wall === "stone_wall" ? D.dropIn : 0.3;
  S.x[i] -= nx * din; S.y[i] -= ny * din; S.lvl[i] = 0; M.edge[i] = -1; M.link[i] = -1; M.h[i] = 0;
  const P = w.siege?.prev; if (P && P.length > i * 2 + 1) { P[i * 2] = S.x[i]; P[i * 2 + 1] = S.y[i]; } // (siege.js barrierResolve: a fall, not a step through the wall)
  if (M.gl[i] > 0) { M.gl[i] = 0; M.gi[i] = -1; M.gx[i] = S.x[i] - nx * 3; M.gy[i] = S.y[i] - ny * 3; }
  const cs = w.cs;
  if (hurt && cs?.ctx) {
    const pHurt = clamp(0.03 + (h - 2) * 0.075, 0.02, 0.6), r = w.rng.next();
    if (r < pHurt) fell(cs.ctx, i, -1, r < pHurt * 0.3 ? W_MORTAL : W_INCAP, "fall");
    else knockDown(cs.ctx, i, "fall", -1, "fall");
    S.stress[i] += 0.1;
  }
  w.events.push({ t: w.tick, kind: "wall-fall", team: S.team[i], who: i, x: S.x[i], y: S.y[i], h: +h.toFixed(1) });
}
// a man running from the fight up on the walk makes for the nearest way down (no way down: over the edge)
function fleeDown(w, L, M, i) {
  const S = w.S, E = L.edges, N = L.nodes, ei = M.edge[i]; if (ei < 0) return;
  const D = goalField(L, DOWN), e = E[ei], tt = along(L, e, S.x[i], S.y[i]), ca = tt + D[e.a], cb = e.len - tt + D[e.b];
  if (!isFinite(ca) && !isFinite(cb)) { dropMan(w, L, M, i, e, true); return; }
  const nd = ca <= cb ? e.a : e.b, dn = ca <= cb ? tt : e.len - tt;
  if (dn < 0.7) {
    let best = null, bc = Infinity;
    for (const q of N[nd].adj) { const f = E[q]; if (f.gone || f.lvl !== S.lvl[i]) continue; const m = f.a === nd ? f.b : f.a; if (f.len + D[m] < bc) { bc = f.len + D[m]; best = ["e", q]; } }
    for (const [T, s] of D.linksAt.get(nd) || []) { const c = (T.time + T.head) * V0 + D[s ? T.a.node : T.b.node]; if (c < bc) { bc = c; best = ["l", T, s]; } }
    if (!best) return;
    if (best[0] === "l") { enter(w, M, i, best[1], best[2]); return; }
    M.edge[i] = best[1]; const f = E[best[1]], far = f.a === nd ? N[f.b] : N[f.a]; runTo(S, i, far.x, far.y); return;
  }
  runTo(S, i, N[nd].x, N[nd].y);
}
function runTo(S, i, tx, ty) { const x = S.x[i], y = S.y[i], d = Math.hypot(tx - x, ty - y) || 1, v = Math.min(d, 2.6 * DT), ux = (tx - x) / d, uy = (ty - y) / d; S.x[i] = x + ux * v; S.y[i] = y + uy * v; S.vx[i] = ux * 2.6; S.vy[i] = uy * 2.6; S.facing[i] = Math.atan2(uy, ux); }

// ─────────────────────────────────────────────────────────────── stormers over the wall (siege.js climbTop)
// A man at the head of a ladder against a MANNED stretch steps onto the walk among its defenders (and fights them on
// it). → true if he did. Off a walk with no defenders near, the escalade's old way stands: he drops in behind the wall.
export function landOnWalk(w, i, x, y, bid) {
  const L = w.townWalls; if (!L || !w.S.lvl) return false;
  const S = w.S, M = men(w); let best = -1, bd = 3.5;
  for (const e of L.edges) { if (e.gone || e.lvl !== 1 || e.bid !== bid || e.kind !== "walk") continue; const a = L.nodes[e.a], b = L.nodes[e.b], d = pointSeg(x, y, a.x, a.y, b.x, b.y); if (d < bd) { bd = d; best = e.id; } }
  if (best < 0) return false;
  const e = L.edges[best], [px, py] = at(L, e, along(L, e, x, y));
  let manned = false; for (let o = 0; o < S.n && !manned; o++) if (S.alive[o] && S.lvl[o] === 1 && M.on[o] && S.team[o] !== S.team[i] && (S.x[o] - px) ** 2 + (S.y[o] - py) ** 2 < 25) manned = true;
  if (!manned) return false;
  S.x[i] = px; S.y[i] = py; S.lvl[i] = 1; on(M, i); M.edge[i] = best; M.link[i] = -1; M.gl[i] = -1; M.gi[i] = -1; M.h[i] = Math.max(0.1, e.z - w.map.h(px, py));
  const P = w.siege?.prev; if (P && P.length > i * 2 + 1) { P[i * 2] = px; P[i * 2 + 1] = py; }
  return true;
}

// ─────────────────────────────────────────────────────────────── the system (siege.js calls it each tick, before the barriers)
export function townWallTick(w) {
  if (!w.buildings?.length || !w.S.lvl) return;
  if (!w.townWalls && w.tick % 10 !== 3) return; // (no circuit yet: looked for now and then)
  const L = layer(w); if (!L.edges.length) return;
  installHooks(w);
  const M = w.twM, S = w.S;
  if (w.tick % 5 === 0) refreshGone(w, L);
  if (w.tick % 5 === 0 && M?.n) for (let i = 0; i < S.n; i++) { // a module down under them: they fall
    if (!M.on[i] || !S.alive[i]) continue;
    if (M.link[i] >= 0 && L.links[M.link[i]]?.gone) { M.link[i] = -1; if (S.lvl[i]) dropMan(w, L, M, i, null, true); else M.h[i] = 0; continue; }
    if (S.lvl[i] > 0 && M.edge[i] >= 0 && L.edges[M.edge[i]]?.gone) dropMan(w, L, M, i, L.edges[M.edge[i]], true);
  }
  if (!M || !M.n) return;
  for (const T of L.links) { T.q = T.qn; T.qn = 0; }
  for (let i = 0; i < S.n; i++) {
    if (!M.on[i]) continue;
    if (!S.alive[i]) { off(w, M, i); continue; }
    const u = w.units.get(S.unit[i]);
    if (M.link[i] >= 0) { linkStep(w, L, M, i); continue; }
    if (S.lvl[i] > 0) {
      if (S.state[i] === S_FLEE || S.status[i] >= ST_FLEE) fleeDown(w, L, M, i);
      else if (!u?.tw) stormer(w, L, M, u, i);
      if (S.lvl[i] > 0 && M.link[i] < 0) snap(w, L, M, i);
      continue;
    }
    M.h[i] = 0;
    if (!u?.tw) off(w, M, i); // (down, and no company on the walls: an ordinary man again)
  }
}
// a man on a walk whose company has no order for the walls: a stormer who came over by a ladder fights the defenders
// there, then goes down inside by the nearest ladder; one of our own (a company split, an order lost) holds his place
function stormer(w, L, M, u, i) {
  const S = w.S, E = L.edges, e = E[M.edge[i]];
  if (e && e.team === S.team[i]) { if (u && !u.tw && footOK(u)) { u.tw = { kind: "man", lvl: S.lvl[i], o: { x: S.x[i], y: S.y[i], lvl: S.lvl[i] }, slots: [], res: [], cx: u.ax, cy: u.ay, ix: -(e.nx ?? 0), iy: -(e.ny ?? 1), t0: w.time, then: null, pending: false }; for (const k of u.members) if (S.alive[k]) { on(M, k); if (M.gl[k] < 0) setGoal(M, k, { lvl: S.lvl[k], e: M.edge[k] >= 0 ? M.edge[k] : -1, t: M.edge[k] >= 0 ? along(L, E[M.edge[k]], S.x[k], S.y[k]) : 0, x: S.x[k], y: S.y[k], face: e ? Math.atan2(e.ny, e.nx) : NaN }, -1); } } return; }
  if (S.state[i] === S_FIGHT || S.posture[i]) return;
  for (let o = 0; o < S.n; o++) if (S.alive[o] && S.lvl[o] === S.lvl[i] && S.team[o] !== S.team[i] && S.status[o] < ST_FLEE && (S.x[o] - S.x[i]) ** 2 + (S.y[o] - S.y[i]) ** 2 < 36) { // (a defender within 6 m on the walk: at him)
    const dx = S.x[o] - S.x[i], dy = S.y[o] - S.y[i], d = Math.hypot(dx, dy) || 1; if (d > 1.4) runTo(S, i, S.x[i] + dx / d * 0.5, S.y[i] + dy / d * 0.5); S.facing[i] = Math.atan2(dy, dx); return;
  }
  fleeDown(w, L, M, i); // (nobody near: down inside by the nearest way)
}

// ─────────────────────────────────────────────────────────────── cover, height (castle.js and ballistics hooks)
// hard cover for man i against a missile from (fx, fy), shot by a man on level fl: the stakes or the merlons against
// shots from outside (none from inside, none along the same walk), the parapet or hoarding all round a top, the loops
// of the gatehouse chamber; a man on a ladder is naked, one on a stair in a tower nearly hidden
export function townCover(w, i, fx, fy, fl = 0) {
  const S = w.S, M = w.twM, L = w.townWalls; if (!M || !L || !M.on[i]) return 0;
  if (M.link[i] >= 0) { const T = L.links[M.link[i]]; return T && T.kind === "stair" ? 0.4 : 0; }
  const lv = S.lvl[i], e = L.edges[M.edge[i]]; if (!lv || !e) return 0;
  const x = S.x[i], y = S.y[i];
  if (fl === lv && Math.hypot(fx - x, fy - y) < 25) return 0;
  if (e.kind === "room") return 0.95;
  const P = L.parts[e.part], D = P ? TWD[P.kind === "gtop" ? "gate" : P.kind === "ghouse" ? "gatehouse" : P.kind === "wtower" ? "watchtower" : P.wall] : null;
  if (e.kind === "top") return (D?.cover ?? 0.75) * (S.missile[i] ? 0.8 : 1) * (fl > lv ? 0.6 : 1);
  const out = (fx - x) * e.nx + (fy - y) * e.ny; if (out <= 0.5) return 0;
  const c = TWD[e.wall]?.cover || TWD.palisade.cover;
  return c[S.missile[i] ? 1 : 0] * (fl > lv ? 0.55 : 1);
}
// the hooks a world with town walls needs (named functions: a saved world finds them again by name)
export function townLevelH(i) { const M = this?.twM; return M && i < M.cap && M.on[i] ? M.h[i] : (this?.castleM ? (this.castleM.h[i] || 0) : 0); }
export function townCoverHook(w, i, f) { return townCover(w, i, f.x0 ?? f.x, f.y0 ?? f.y, f.by >= 0 ? w.S.lvl[f.by] : 0); }
function installHooks(w) {
  if (w.townOrder !== townOrder) w.townOrder = townOrder;
  if (w.townMove !== townMove) w.townMove = townMove;
  if (!w.levelH) w.levelH = townLevelH;
  if (!w.castleCover) w.castleCover = townCoverHook;
  men(w);
}
export function ensureTownWalls(w) { const L = layer(w); if (L.edges.length) installHooks(w); return L; }

// ─────────────────────────────────────────────────────────────── the click: which piece of wall, and what it means
// the first town-wall surface a ray meets: origin (ox, oy) at height oz (absolute), direction (dx, dy, dz) →
// { t, x, y, h (above the terrain), part } or null
export function townPick(w, ox, oy, oz, dx, dy, dz) {
  const L = w.townWalls; if (!L || !L.parts.length) return null;
  let best = null;
  for (const p of L.parts) {
    const B = L.teams[p.team]; if (!B) continue;
    // in the part's frame: a along the wall, b out from it, z up
    let x0, y0, ux, uy, a0, a1, b0, b1, ztop, zbot;
    if (p.kind === "run") { const D = TWD[p.wall]; x0 = p.x1; y0 = p.y1; ux = p.ux; uy = p.uy; a0 = 0; a1 = p.len; b0 = -D.across[1]; b1 = -D.across[0]; ztop = p.z - D.deck + D.top; zbot = p.z - D.deck - 3; }
    else { x0 = p.cx; y0 = p.cy; ux = p.ux; uy = p.uy; a0 = -p.hw; a1 = p.hw; b0 = -(p.across[1]); b1 = -(p.across[0]); ztop = p.z0 + p.boxH; zbot = p.z0 - 3; }
    const nx = p.nx, ny = p.ny; // (b positive = out)
    const la = (ox - x0) * ux + (oy - y0) * uy, lb = (ox - x0) * nx + (oy - y0) * ny, da = dx * ux + dy * uy, db = dx * nx + dy * ny;
    let t0 = 0, t1 = 1e5;
    for (const [o, d, lo, hi] of [[la, da, a0, a1], [lb, db, b0, b1], [oz, dz, zbot, ztop]]) {
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { t0 = 1; t1 = 0; } continue; }
      let s0 = (lo - o) / d, s1 = (hi - o) / d; if (s0 > s1) [s0, s1] = [s1, s0]; t0 = Math.max(t0, s0); t1 = Math.min(t1, s1);
    }
    if (t0 > t1 || (best && t0 >= best.t)) continue;
    // the box is a bound: walk into it to the first point above the terrain and below the wall's top
    for (let t = t0; t <= t1; t += 0.25) {
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t, g = w.map.h(x, y);
      if (z < g) break;
      if (z <= ztop) { best = { t, x, y, h: z - g, part: p }; break; }
    }
  }
  if (!best) return null;
  // the ground before it hides it?
  for (let t = 2; t < best.t - 1; t += 3) if (oz + dz * t < w.map.h(ox + dx * t, oy + dy * t)) return null;
  return best;
}
// what a click there means → a place, or null (no town wall there)
export function townPlace(w, x, y, part = null) {
  const L = w.townWalls; if (!L) return null;
  if (!part) { let bd = 3; for (const p of L.parts) { const d = p.kind === "run" ? pointSeg(x, y, p.x1, p.y1, p.x2, p.y2) : Math.hypot(x - p.cx, y - p.cy) - 3; if (d < bd) { bd = d; part = p; } } }
  if (!part) return null;
  const r1 = (v) => Math.round(v * 2) / 2, team = part.team;
  if (part.kind === "run") {
    const es = part.edges.map((ei) => L.edges[ei]); let be = es[0], bd = Infinity;
    for (const e of es) { const a = L.nodes[e.a], b = L.nodes[e.b], d = pointSeg(x, y, a.x, a.y, b.x, b.y); if (d < bd) { bd = d; be = e; } }
    const D = TWD[part.wall], [wx, wy] = at(L, be, along(L, be, x, y)), h = be.z - w.map.h(wx, wy);
    if (be.gone) { const b = w.buildings.find((q) => q.id === part.bid); if (b && !b.ruin && (b.progress ?? 1) < 1) return { town: true, kind: "tsite", team, lvl: 0, x, y, h: 0, cap: 0, label: `${D.walkName} · not built yet`, tpart: part, castle: null, part: null }; return { town: true, kind: "tbreach", team, lvl: 0, x, y, h: 0, cap: 0, label: "The breach", tpart: part, castle: null, part: null }; }
    let run = 0; for (const e of es) if (!e.gone) run += e.len;
    const cap = Math.floor(run / SPACING);
    return { town: true, kind: "twalk", team, lvl: 1, x: wx, y: wy, h, cap, label: `${D.walkName} · ${r1(h)} m · ${cap} men along this stretch`, tname: D.name, tpart: part, castle: null, part: null };
  }
  const gone = part.edges.every((ei) => L.edges[ei].gone), D = TWD[part.kind === "gtop" ? "gate" : part.kind === "ghouse" ? "gatehouse" : "watchtower"];
  if (gone) return { town: true, kind: "tsite", team, lvl: 0, x, y, h: 0, cap: 0, label: `${D.name.split(" ")[0]} · not standing`, tpart: part, castle: null, part: null };
  const h = part.top.z - w.map.h(part.rect.cx, part.rect.cy);
  return { town: true, kind: "ttop", team, lvl: 2, x: part.rect.cx, y: part.rect.cy, h, cap: part.top.cap, label: `${D.name} · ${r1(h)} m · ${part.top.cap} men fit`, tname: D.name.toLowerCase(), tpart: part, castle: null, part: null, tkind: part.kind };
}
