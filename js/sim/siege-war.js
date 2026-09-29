// A siege in the sim (?mode=siege; headless: tools/siege-run.mjs): a castle on the Vale, its garrison and its
// stores, the besieging host with its siege train, the two clocks, and how it ends. No DOM, no three.js — the frame
// round it is js/ui/siege-run.js, the generals on both sides js/sim/siege-ai.js. Plan: docs/castle-plan.md §5.
//
// THE TWO CLOCKS (js/sim/clock.js, siege.js header). Men live on the tactical clock (real time, 1 s = 1 s); walls,
// engines, mines, repairs, food and sickness on the economic clock (1 real minute = 1.5 days). Most of a siege is
// structural time, so the player lets DAYS PASS (passDays): the sim then runs `siegeSystem` alone — nobody walks,
// the engines throw their real number of stones, the crews frame up the trebuchets, stones land among the men —
// plus this module's own day work (food, sickness, repair and barricades, the mines, relief, terms) and each
// general's day-thoughts. When a general decides to storm, or something the player asked to wait for happens, the
// days stop and the assault is fought in real time with the full sim (step()).
//
// THE FLOW (G.phase): "invest" (the host arrives, the camp and the lines, the summons) → "siege" (bombardment,
// mining, works, sallies; days pass) ⇄ "assault" (men at the walls, real time) → "inside" (the curtain is lost, the
// fight in the bailey) → "keep" (the last refuge) → "end" (G.outcome: taken | terms | starved | relieved | abandoned).
//
//   castleSite(map, layout, { avoid }) → { x, y, facing }          (facing: bearing from the castle to the besiegers)
//   setupSiege(w, cfg, { places, castleApi }) → G                   (cfg: js/ui/siege-setup.js siegeConfig)
//   passDays(w, G, days, { until }) → { days, stop }               (until: "breach" | "mine" | "works" | "assault" | fn)
//   siegeStatus(w, G)                                               (for the UI: sections, gates, mines, food, men)
//   siegeCommand(w, G, team, kind, o)                               (the siege orders, for the player and the AI)
//
// castle.js (CASTLE-SIM) is optional: `castleApi.castleFromLayout` builds the real castle with levels and walkways;
// without it this module lays a castle out of the economy's own wall stretches and gates (every siege mechanic in
// siege.js works on those), a walled inner refuge standing for the keep.
import { addUnit, issueOrder, applyOrder, DT, TICK } from "./world.js";
import { S_DEAD, S_FLEE, S_FIGHT, S_CAPT, ST_FLEE, clamp } from "./soldiers.js";
import { ARMS } from "./arms.js";
import * as EC from "./economy.js";
import * as SG from "./siege.js";
import * as SWK from "./siege-works.js";
import { ECON_DAYS_PER_REAL_SEC } from "./clock.js";
import { makeRecorder } from "./battle-record.js";
import { gateGeom, addFeature, removeFeature, pointSeg } from "./features.js";

export const DAY_TICKS = Math.round(1 / (ECON_DAYS_PER_REAL_SEC * TICK)); // 400 ticks = one econ day
const dayOf = (w, G) => (w.time - G.t0) * ECON_DAYS_PER_REAL_SEC;

// ─────────────────────────────────────────────────────────────── the castles
export const LAYOUTS = {
  hill: { name: "The hill castle", note: "A keep on a rock and one curtain round the hilltop. Steep all round but the neck: engines and towers must come up the one gentle slope, and the rock is slow to mine.", rings: 1, ground: "rock", tower: "neck" },
  concentric: { name: "The concentric castle", note: "Two curtains, the inner higher, gates not in line: take the outer ward and you stand in a killing ground under the inner wall. Built on open ground; mines are possible.", rings: 2, ground: "earth", tower: "any" },
  river: { name: "The river castle", note: "Its back to deep water with a water gate: no engines, mines or ladders on that side, and a way in for supplies by boat. One curtain and a walled inner ward.", rings: 1, ground: "clay", tower: "front", water: true },
};
// seasons (docs/siege-research.md): sickness in the camp per day, how long the host will stay (feudal service,
// money, the weather), foraging, and when a relief could come
export const SEASONS = {
  spring: { name: "Spring", note: "The roads are drying; the granaries are low before the harvest.", sick: 0.0015, will: 70, relief: [28, 50], food: 0.85 },
  summer: { name: "Summer", note: "The campaigning season. Dysentery in the camp; the host is at its fullest.", sick: 0.003, will: 90, relief: [25, 45], food: 1 },
  autumn: { name: "Autumn", note: "After the harvest the castle is full of grain; the host thinks of home.", sick: 0.002, will: 55, relief: [22, 40], food: 1.25 },
  winter: { name: "Winter", note: "Cold and wet in the lines: men die and desert. Few hold a siege through it.", sick: 0.004, will: 35, relief: [30, 60], food: 1 },
};
export const PROVISION = [ // days of food for the garrison as it stands at the start
  { key: 20, name: "Three weeks", note: "Caught unprepared" },
  { key: 45, name: "Six weeks", note: "Ordinary stores" },
  { key: 90, name: "Three months", note: "Provisioned against a siege" },
  { key: 180, name: "Half a year", note: "Stocked for a long defence" },
];
export const ENGINES = ["trebuchet", "mangonel", "ram", "siege_tower", "mantlet"];
// the forces: garrisons were small — tens to a few hundred (Château Gaillard 1204 ~140, Rochester 1215 ~100 knights
// and serjeants, Kenilworth 1266 ~1,200); besiegers five to ten times as many (siege-research.md §8)
export const FORCES = {
  small: { name: "A small garrison", note: "A constable and his serjeants; a baron's host outside",
    garrison: [["menatarms", 12], ["spearmen", 24], ["crossbow", 16], ["archers", 12]],
    besiegers: [["menatarms", 40], ["spearmen", 100], ["levy", 120], ["archers", 60], ["crossbow", 30], ["knights", 15]],
    train: { trebuchet: 1, mangonel: 1, ram: 1, siege_tower: 0, mantlet: 3, ladders: 12 } },
  strong: { name: "A strong garrison", note: "A royal castle held in force; a king's army outside",
    garrison: [["menatarms", 24], ["spearmen", 48], ["crossbow", 30], ["archers", 24], ["levy", 24]],
    besiegers: [["menatarms", 80], ["spearmen", 180], ["levy", 200], ["archers", 120], ["crossbow", 60], ["knights", 30], ["hobelars", 20]],
    train: { trebuchet: 2, mangonel: 2, ram: 1, siege_tower: 1, mantlet: 4, ladders: 20 } },
  great: { name: "A great siege", note: "Kenilworth: a whole party of the realm behind the walls",
    garrison: [["menatarms", 40], ["spearmen", 80], ["crossbow", 50], ["archers", 40], ["levy", 60]],
    besiegers: [["menatarms", 120], ["spearmen", 260], ["levy", 300], ["archers", 160], ["crossbow", 80], ["knights", 40], ["hobelars", 30]],
    train: { trebuchet: 3, mangonel: 2, ram: 1, siege_tower: 1, mantlet: 6, ladders: 30 } },
};
const CREW = { trebuchet: 16, mangonel: 16, springald: 4, ram: 14, siege_tower: 18, mantlet: 2 };
export const WORKS = { // what the besiegers' carpenters can make in the camp (econ days with the timber of the country)
  fill: { name: "Fill the moat", days: 4, note: "fascines, earth and rubble tipped into the moat before the breach, under mantlets (Château Gaillard, 1204)" },
  trebuchet: { name: "A trebuchet", days: 12, note: "framed from the woods round about, the ironwork from the smiths" },
  ladders: { name: "Scaling ladders", days: 1, n: 10, note: "ten ladders a day from the woods" },
  ram: { name: "A covered ram", days: 4, note: "a pent-house on wheels, hides against fire" },
  siege_tower: { name: "A siege tower", days: 10, note: "a belfry three storeys high" },
  mantlet: { name: "Mantlets", days: 1, n: 2, note: "wheeled screens for the bows" },
};
const TOWNS = (map) => (map.meta?.features || []).filter((f) => f.type === "town_site").map((f) => ({ x: f.xy_m[0], y: f.xy_m[1] }));

// A site on the Vale for the layout: a hilltop (hill), a dry bank above deep water (river), open level ground
// (concentric) — away from the towns and the map's edge. facing: the bearing the approach (and the camp) lies on.
export function castleSite(map, layout, { avoid = TOWNS(map), step = 70 } = {}) {
  const N = map.size, E = 650, h = map.h, wat = map.water, can = map.canopy || (() => 0);
  const ring = (x, y, r, f) => { let s = 0; for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; s += f(x + Math.cos(a) * r, y + Math.sin(a) * r); } return s / 12; };
  const slopeAt = (x, y, r) => { let m = 0; const h0 = h(x, y); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; m = Math.max(m, Math.abs(h(x + Math.cos(a) * r, y + Math.sin(a) * r) - h0) / r); } return m; };
  let best = null;
  for (let y = E; y <= N - E; y += step) for (let x = E; x <= N - E; x += step) {
    if (avoid.some((t) => Math.hypot(t.x - x, t.y - y) < 900)) continue;
    if (wat(x, y) > 0.02 || ring(x, y, 45, wat) > 0.02) continue;
    let s;
    if (layout === "hill") {
      const prom = h(x, y) - ring(x, y, 160, h), top = slopeAt(x, y, 30);
      s = prom - top * 60 - ring(x, y, 60, can) * 0.5;
    } else if (layout === "river") {
      let wb = -1, wv = 0; for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, v = Math.min(wat(x + Math.cos(a) * 70, y + Math.sin(a) * 70), wat(x + Math.cos(a) * 85, y + Math.sin(a) * 85)); if (v > wv) { wv = v; wb = a; } }
      if (wv < 0.6) continue;
      s = wv * 4 - slopeAt(x, y, 50) * 40 - ring(x, y, 60, can) * 0.3; if (s < 0) continue;
      s += 10;
    } else {
      s = -slopeAt(x, y, 90) * 80 - ring(x, y, 120, wat) * 40 - ring(x, y, 90, can) * 0.4 - ring(x, y, 250, wat) * 5;
    }
    if (!best || s > best.s) best = { s, x, y };
  }
  if (!best) best = { x: N / 2, y: N / 2 };
  return { x: best.x, y: best.y, facing: approachOf(map, best.x, best.y, layout) };
}
// the side the besiegers come from: the gentlest, driest, most open ground out to 350 m (for a river castle: away
// from the water)
export function approachOf(map, x, y, layout) {
  let best = 0, bc = Infinity;
  for (let k = 0; k < 16; k++) {
    const a = k * Math.PI / 8; let c = 0;
    for (let d = 60; d <= 360; d += 30) { const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d; c += (map.water(px, py) > 0.1 ? 8 : 0) + Math.min(3, (map.canopy?.(px, py) || 0) / 5) + Math.abs(map.h(px, py) - map.h(x, y)) * 0.04; if (px < 300 || py < 300 || px > map.size - 300 || py > map.size - 300) c += 20; }
    if (layout === "river") { let wv = 0; for (const d of [70, 90]) wv = Math.max(wv, map.water(x - Math.cos(a) * d, y - Math.sin(a) * d)); c -= wv * 6; }
    if (c < bc) { bc = c; best = a; }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────── building the castle
// → the normalised castle the rest of this module reads: { x, y, facing, team, layout, rings: [[section …] …],
// sections, gates, keep: { x, y, r, poly, gate, sections }, poly (outer ring), towers: [{ x, y, a, b }], real }
export function buildCastle(w, layout, site, team, castleApi = null) {
  let real = null;
  if (castleApi?.castleFromLayout) {
    try { real = castleApi.castleFromLayout(w, layout, { x: site.x, y: site.y, team, facing: site.facing }); } catch (e) { real = null; console.warn("castleFromLayout failed, laying a fallback castle", e); }
  }
  if (real) return normaliseCastle(w, real, layout, site, team);
  return fallbackCastle(w, layout, site, team);
}
const poly = (cx, cy, R, n, a0) => Array.from({ length: n }, (_, k) => { const a = a0 + (2 * k - 1) * Math.PI / n; return [cx + Math.cos(a) * R, cy + Math.sin(a) * R]; });
// one ring of curtain: stone_wall stretches from angle to angle (a tower at each angle, drawn by the renderer), the
// gate stretch split round a gatehouse 16 m wide (its flanks the gate building's own; siege.js gateGeom)
function ringOf(w, team, pts, { gate = null, gateAt = 0, gateW = 16, parts = null, ring = "outer", walkH = 8 }) {
  const secs = [], gates = [];
  const wall = (x1, y1, x2, y2) => {
    const b = EC.placeWall(w, team, "stone_wall", x1, y1, x2, y2, true); if (!b) return null;
    const n = EC.wallModules(b); b.mods = new Float32Array(n).fill(b.hpMax / n); b.ring = ring; secs.push(b);
    parts?.push({ kind: "curtain", x0: x1, y0: y1, x1: x2, y1: y2, thick: ring === "keep" ? 3 : 2.8, walkH: ring === "keep" ? 6 : walkH, height: (ring === "keep" ? 6 : walkH) + 2.2, bid: b.id, ring, ground: null });
    return b;
  };
  for (let k = 0; k < pts.length; k++) {
    const [x1, y1] = pts[k], [x2, y2] = pts[(k + 1) % pts.length];
    if (gate && k === gateAt) {
      const L = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / L, uy = (y2 - y1) / L, mx = (x1 + x2) / 2, my = (y1 + y2) / 2, h = Math.min(gateW / 2, L / 2 - 2);
      const ax = mx - ux * h, ay = my - uy * h, bx = mx + ux * h, by = my + uy * h;
      wall(x1, y1, ax, ay);
      const g = EC.placeBuilding(w, team, gate, mx, my, Math.atan2(uy, ux), true);
      if (g) { Object.assign(g, { gx1: ax, gy1: ay, gx2: bx, gy2: by }); g.ring = ring; gates.push(g); if (gate === "gatehouse") parts?.push({ kind: "gatehouse", x: mx, y: my, rot: Math.atan2(uy, ux), w: 2 * h, d: 12, passage: 3.6, walkH, bid: g.id, ring }); else parts?.push({ kind: "keepdoor", x: mx, y: my, bid: g.id, ring }); }
      wall(bx, by, x2, y2);
      continue;
    }
    wall(x1, y1, x2, y2);
  }
  return { secs, gates };
}
// A castle laid out of the economy's own buildings (every siege.js / siege-works.js mechanic works on them), with a
// description in w.castles for the renderer (js/render/castle.js): towers at the angles, the gatehouse, a keep of
// storeys, the bailey's hall, chapel and well. The keep is also a walled square in the sim — its walls are its
// walls, its door a timber gate at the forebuilding — so the last fight is at (and through) the keep's door.
// Used until js/sim/castle.js (CASTLE-SIM) has castleFromLayout.
function fallbackCastle(w, layout, site, team) {
  const { x, y, facing: F } = site, L = LAYOUTS[layout] || LAYOUTS.hill, parts = [];
  const C = { x, y, facing: F, team, layout, rings: [], sections: [], gates: [], towers: [], keep: null, real: null, poly: null, name: L.name };
  const add = (pts, opt, ring) => { const r = ringOf(w, team, pts, { ...opt, parts, ring }); r.secs.forEach((b) => C.sections.push(b)); r.gates.forEach((g) => C.gates.push(g)); C.rings.push(r.secs); return r; };
  const towersAt = (pts, rr, walkH, ring) => pts.forEach(([tx, ty], k) => { parts.push({ kind: "tower", shape: k % 3 === 2 ? "rect" : "round", x: tx, y: ty, r: rr, w: rr * 2, h: rr * 2, rot: Math.atan2(ty - y, tx - x), floors: [0, 4.2, walkH, walkH + 4], walkH, ring }); C.towers.push({ x: tx, y: ty, name: compass(Math.atan2(ty - y, tx - x)) + " tower" }); });
  const fx = Math.cos(F), fy = Math.sin(F), at = (u, v) => [x + fx * u - fy * v, y + fy * u + fx * v];
  let outer;
  if (layout === "concentric") {
    outer = poly(x, y, 66, 8, F); add(outer, { gate: "gatehouse", gateAt: 0, walkH: 7 }, "outer"); towersAt(outer, 4.5, 7, "outer");
    const inner = poly(x, y, 38, 6, F + Math.PI / 3); // (the inner gate one side round: no straight run from gate to gate)
    const ri = add(inner, { gate: "gatehouse", gateAt: 0, walkH: 10 }, "inner"); towersAt(inner, 5.5, 10, "inner");
    C.keep = { x, y, r: 38, poly: inner, gate: ri.gates[0] || null, sections: ri.secs, ward: true };
    const Hl = at(-14, 8); parts.push({ kind: "hall", x: Hl[0], y: Hl[1], w: 20, h: 9, rot: F + Math.PI / 2 });
    const Ch = at(10, -14); parts.push({ kind: "chapel", x: Ch[0], y: Ch[1], w: 13, h: 7, rot: F });
    const Wl = at(8, 12); parts.push({ kind: "well", x: Wl[0], y: Wl[1], r: 1.2 });
  } else {
    const R = layout === "hill" ? 52 : 54;
    outer = poly(x, y, R, 7, F);
    add(outer, { gate: "gatehouse", gateAt: 0, walkH: 8 }, "outer"); towersAt(outer, 5, 8, "outer");
    if (layout === "river") { const b = C.sections.find((s) => Math.abs(angDiff(Math.atan2(s.y - y, s.x - x), F + Math.PI)) < Math.PI / 7); if (b) b.waterSide = true; }
    // the keep: a great tower 20 m square behind the middle of the bailey; in the sim a walled square with its door
    const kx = x - fx * 12, ky = y - fy * 12, kr = F + Math.PI / 4 * 0, hk = 11;
    const kp = [[kx + (-hk) * fx - (-hk) * fy, ky + (-hk) * fy + (-hk) * fx], [kx + hk * fx - (-hk) * fy, ky + hk * fy + (-hk) * fx], [kx + hk * fx - hk * fy, ky + hk * fy + hk * fx], [kx + (-hk) * fx - hk * fy, ky + (-hk) * fy + hk * fx]];
    const rk = ringOf(w, team, kp, { gate: "gate", gateAt: 1, gateW: 6, parts, ring: "keep" }); // (the door on the side toward the gate)
    rk.secs.forEach((b) => C.sections.push(b)); rk.gates.forEach((g) => C.gates.push(g));
    parts.push({ kind: "keep", x: kx, y: ky, w: 20, h: 20, rot: kr, floors: [0, 6, 13.5, 20], forebuilding: true });
    C.keep = { x: kx, y: ky, r: hk, poly: kp, gate: rk.gates[0] || null, sections: rk.secs };
    const Hl = at(14, 26); parts.push({ kind: "hall", x: Hl[0], y: Hl[1], w: 18, h: 9, rot: F });
    const Ch = at(10, -28); parts.push({ kind: "chapel", x: Ch[0], y: Ch[1], w: 12, h: 7, rot: F });
    const Wl = at(22, 6); parts.push({ kind: "well", x: Wl[0], y: Wl[1], r: 1.2 });
  }
  C.poly = outer;
  parts.forEach((p, i) => { p.id = i + 1; });
  const R = { id: "siege-" + (w.castles?.length || 0), team, name: L.name, parts, keep: parts.find((p) => p.kind === "keep") || { x: C.keep.x, y: C.keep.y }, bailey: { x, y, r: layout === "concentric" ? 60 : 48 }, walkH: 8, fallback: true };
  (w.castles ||= []).push(R); C.render = R;
  name(C);
  return C;
}
function normaliseCastle(w, real, layout, site, team) {
  const x = real.x ?? site.x, y = real.y ?? site.y;
  const C = { x, y, facing: real.facing ?? site.facing, team, layout, rings: [], sections: [], gates: [], towers: [], keep: null, real, poly: null, name: LAYOUTS[layout]?.name || real.name };
  const B = (id) => w.buildings.find((b) => b.id === id);
  // ring names: the first ring castle.js lists is the outermost; with two, the other is the inner curtain
  const ringIds = (real.rings || []).map((r) => r.id), many = ringIds.length > 1;
  const ringOfP = (p, b) => { if (p.ring !== undefined && ringIds.length) return !many || p.ring === ringIds[0] ? "outer" : "inner"; if (!many) return "outer"; const P = real.rings[1]?.poly; return P && inPoly(P, (b?.x ?? p.x) + (x - (b?.x ?? p.x)) * 0.02, (b?.y ?? p.y) + (y - (b?.y ?? p.y)) * 0.02) ? "inner" : "outer"; };
  for (const p of real.parts || []) {
    const b = p.bid !== undefined ? B(p.bid) : null;
    if (p.kind === "curtain" && b) { b.ring = ringOfP(p, b); b.part = p; if (!b.mods) { const n = EC.wallModules(b); b.mods = new Float32Array(n).fill(b.hpMax / n); } C.sections.push(b); }
    else if ((p.kind === "gatehouse" || p.kind === "gate") && b) { b.ring = ringOfP(p, b); b.part = p; C.gates.push(b); }
    else if (p.kind === "tower") C.towers.push({ x: p.x ?? b?.x, y: p.y ?? b?.y, bid: p.bid, name: compass(Math.atan2((p.y ?? b?.y) - y, (p.x ?? b?.x) - x)) + " tower", part: p });
    else if (p.kind === "keep") { const c = Math.cos(p.rot || 0), s = Math.sin(p.rot || 0), hw = (p.w || 20) / 2 + 1, hd = (p.d || p.w || 20) / 2 + 1; C.keep = { x: p.x, y: p.y, r: Math.max(hw, hd), part: p, sections: [], real: true, poly: [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([a, q]) => [p.x + a * c - q * s, p.y + a * s + q * c]) }; }
  }
  if (!C.keep) C.keep = { x, y, r: 14, sections: [], real: true };
  C.poly = real.rings?.[0]?.poly || null;
  if (!C.poly) { const pts = []; for (const b of C.sections.filter((q) => q.ring === "outer")) pts.push([b.x1, b.y1], [b.x2, b.y2]); pts.sort((p, q) => Math.atan2(p[1] - y, p[0] - x) - Math.atan2(q[1] - y, q[0] - x)); C.poly = pts.length >= 3 ? pts : poly(x, y, 50, 8, site.facing); }
  C.rings = [C.sections.filter((b) => b.ring === "outer"), C.sections.filter((b) => b.ring === "inner")].filter((r) => r.length);
  // the water side of a river castle (no engines, mines or ladders there)
  if (layout === "river") for (const b of C.sections) { const g = secGeom({ castle: C }, b); if (w.map.water(g.x + g.nx * 12, g.y + g.ny * 12) > 0.3) b.waterSide = true; }
  name(C);
  return C;
}
function name(C) {
  const used = new Map();
  for (const b of [...C.sections, ...C.gates]) {
    const dir = compass(Math.atan2((b.y) - C.y, (b.x) - C.x));
    const ring = b.ring === "inner" ? "inner " : b.ring === "keep" ? (C.keep?.ward ? "inner " : "keep's ") : C.rings.length > 1 && b.ring === "outer" ? "outer " : "";
    let nm = b.x1 !== undefined ? `the ${ring}${dir} curtain` : `the ${ring}${b.kind === "gatehouse" ? "gatehouse" : b.ring === "keep" ? "keep door" : b.waterSide ? "water gate" : "gate"}`;
    const k = used.get(nm) || 0; used.set(nm, k + 1); if (k) nm += ` (${k + 1})`;
    b.label = nm;
  }
}
export function insideCastle(w, G, x, y, api = G.api) {
  if (api?.insideCastle && G.castle.real) { try { const v = api.insideCastle(w, x, y); if (v !== undefined) return !!v; } catch { /* fall through */ } }
  return inPoly(G.castle.poly, x, y);
}
export function inKeep(G, x, y) { const K = G.castle.keep; if (!K) return false; return K.poly ? inPoly(K.poly, x, y) : Math.hypot(x - K.x, y - K.y) < K.r; }
function inPoly(P, x, y) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }

// ─────────────────────────────────────────────────────────────── geometry of a section
export function secGeom(G, b) {
  const dx = b.x2 - b.x1, dy = b.y2 - b.y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
  let nx = -uy, ny = ux; const c = b.ring === "keep" || (G.castle.keep?.ward && b.ring === "inner") ? G.castle.keep : G.castle;
  if ((b.x - c.x) * nx + (b.y - c.y) * ny < 0) { nx = -nx; ny = -ny; } // outward
  return { x: b.x, y: b.y, ux, uy, nx, ny, L, at: (t, out = 0) => ({ x: b.x1 + dx * t + nx * out, y: b.y1 + dy * t + ny * out }) };
}
export function gateGeomOut(G, g) {
  const Q = gateGeom(g), c = g.ring === "keep" || (G.castle.keep?.ward && g.ring === "inner") ? G.castle.keep : G.castle;
  let nx = -Q.uy, ny = Q.ux; if ((Q.px - c.x) * nx + (Q.py - c.y) * ny < 0) { nx = -nx; ny = -ny; }
  return { x: Q.px, y: Q.py, nx, ny, ux: Q.ux, uy: Q.uy };
}
export const modPoint = (G, b, k, out = 0) => secGeom(G, b).at((k + 0.5) / b.mods.length, out);
export const breachesOf = (b) => { const o = []; if (b.mods && !b.ruin) b.mods.forEach((v, k) => { if (v <= 0) o.push(k); }); return b.ruin ? [...Array(b.mods?.length || 1).keys()] : o; };
export function breaches(G, ring = null) { const o = []; for (const b of G.castle.sections) { if (ring && b.ring !== ring) continue; for (const k of breachesOf(b)) { const bk = G.w ? barricadeAt(G.w, b, k) : null; o.push({ b, k, plug: bk ? { done: bk.state === "up", prog: bk.prog, id: bk.id } : null }); } } return o; }
export const gateDown = (g) => !!(g.gateBroken || g.ruin || g.forcedOpen);
export function modHp(b, k) { return b.mods ? b.mods[k] / (b.hpMax / b.mods.length) : 1; }

// ─────────────────────────────────────────────────────────────── setting up the siege
// cfg = { castle: layout, site: {x, y, facing}, playerSide: "attack"|"defend", garrison: [[arm, n]], besiegers: [[arm, n]],
//         train: { trebuchet, mangonel, ram, siege_tower, mantlet, ladders }, season, provision (days), relief: bool,
//         names: [ours, theirs], lord: bool }
export function setupSiege(w, cfg, deps = {}) {
  const PLAYER = deps.PLAYER ?? 0, places = deps.places;
  // the field is cleared of everyone but the vills' people; the economy's working day stops (the siege keeps its own)
  for (const [id, u] of [...w.units.entries()]) { if (u.isWorkers) continue; for (const m of u.members) { w.S.alive[m] = 0; w.S.state[m] = EC.S_GONE; } w.units.delete(id); }
  const ecoAt = w.systems.indexOf(EC.economySystem); if (ecoAt >= 0) w.systems.splice(ecoAt, 1);
  const att = cfg.playerSide === "defend" ? 1 - PLAYER : PLAYER, def = 1 - att;
  const site = cfg.site;
  const castle = buildCastle(w, cfg.castle, site, def, deps.castleApi);
  const Td = w.teams[def], Ta = w.teams[att];
  Td.town = { x: castle.keep?.x ?? castle.x, y: castle.keep?.y ?? castle.y }; // (siege.js: which side of a wall is "in")
  for (const T of [Td, Ta]) { T.store ||= {}; T.store.stone = 1e6; T.store.timber = 2e5; T.store.bolts = 400; T.store.ladders = 0; T.eff = 0.8; T.besieged = false; }
  Ta.store.ladders = cfg.train?.ladders ?? 12;
  w.weather = cfg.weather || "clear";
  const Sn = SEASONS[cfg.season] || SEASONS.summer;
  const G = {
    cfg, castle, att, def, PLAYER, api: deps.castleApi || null, phase: "invest", t0: w.time, lastDay: -1, outcome: null,
    season: Sn, will: Math.round(Sn.will * (cfg.will || 1)), relief: cfg.relief ? { day: Math.round(Sn.relief[0] + (Sn.relief[1] - Sn.relief[0]) * w.rng.next()), known: false } : null,
    food: 0, food0: 0, hunger: 0, works: [], log: [], units: { [att]: [], [def]: [] },
    stats: { assaults: 0, failed: 0, sallies: 0, sick: [0, 0], deserted: [0, 0], mine: [0, 0], breaches: 0, stones: 0, burnt: 0, terms: [] },
    assault: null, terms: null, roster: null, ai: { [att]: {}, [def]: {} }, aiOn: { [att]: att !== PLAYER || !!cfg.autoPlayer, [def]: def !== PLAYER || !!cfg.autoPlayer },
  };
  w.siegeWar = G; G.w = w;
  G.temper = w.rng.next(); // the constable: 0 quick to treat … 1 stubborn (siege-war.js hopeless)
  SG.useCastle?.(deps.castleApi || null);
  for (const b of castle.sections) b.ground ||= b.part?.ground || castle.real?.ground || (LAYOUTS[cfg.castle] || LAYOUTS.hill).ground;
  // names for the chronicle (battle-record's shape)
  const nm = cfg.names || ["Ashby", "Rookham"];
  const castleName = cfg.castleName || (places ? `${places.at(castle.x, castle.y).name.replace(/ site$/i, "")} Castle` : "the castle");
  G.name = castleName;
  const sideName = (team) => (team === def ? `the garrison of ${castleName}` : `the men of ${nm[team === PLAYER ? 0 : 1]}`);
  G.names = {
    side: (team) => (team >= 0 ? sideName(team) : "both sides"), adj: (team) => (team === def ? "garrison" : "besieging"),
    arm: (team, arm) => `${team === def ? "the garrison's" : "the besiegers'"} ${ARMS[arm]?.name.toLowerCase() || arm}`,
    lord: (team) => (team === def ? `the constable of ${castleName}` : `the lord of ${nm[team === PLAYER ? 0 : 1]}`),
    place: (x, y) => (x === undefined ? "" : placeIn(G, x, y)),
  };
  placeGarrison(w, G, cfg.garrison || FORCES.strong.garrison);
  placeHost(w, G, cfg.besiegers || FORCES.strong.besiegers, cfg.train || FORCES.strong.train);
  // the stores: man-days of food for the garrison as it stands (the season's harvest counts)
  const gN = menOf(w, G, def);
  G.hold = SWK.setProvisions ? SWK.setProvisions(w, { team: def, days: (cfg.provision || 45) * Sn.food, auto: false, resolve: 0.6 }) : null;
  if (G.hold) { G.hold.auto = false; G.food = G.food0 = G.hold.food; } else G.food = G.food0 = Math.round(gN * (cfg.provision || 45) * Sn.food);
  G.roster = makeRoster(w, G);
  G.rec = makeRecorder(w, { names: G.names, objectives: {}, onMoment: (m) => { if (m.kind === "end" && !G.outcome) return; G.onMoment?.(m); } });
  w.systems.push((w) => siegeWarSystem(w, G));
  note(w, G, { kind: "invest", kicker: "The host arrives", text: `${cap(G.names.side(att))} come before ${castleName} and draw their lines about it: ${menOf(w, G, att)} men against ${gN} in the garrison`, good: -1, sal: 0.8, x: castle.x, y: castle.y });
  return G;
}
function placeIn(G, x, y) {
  const C = G.castle; if (inKeep(G, x, y)) return C.keep.ward ? "in the inner ward" : "at the keep";
  if (inPoly(C.poly, x, y)) return "in the bailey";
  const d = Math.hypot(x - C.x, y - C.y); if (d < 90) return `under the ${compass(Math.atan2(y - C.y, x - C.x))} wall`;
  if (d < 400) return `before the castle, to the ${compass(Math.atan2(y - C.y, x - C.x))}`;
  return "in the country round";
}
const menOf = (w, G, team) => { let n = 0; for (const u of w.units.values()) if (u.team === team && u.siegeHost && u.members.length) n += u.members.length; return n; };
export const armMen = (list) => list.reduce((s, [, n]) => s + n, 0);

// the garrison: bows and crossbows on the curtain facing the approach, foot at the gate and in reserve, the rest by
// the keep (manning a wall is a single rank along its inner face; castle.js puts them ON the wall-walk)
function placeGarrison(w, G, list) {
  const C = G.castle, def = G.def, outer = C.sections.filter((b) => b.ring === "outer");
  const front = outer.slice().sort((a, b) => angAbs(a, C) - angAbs(b, C));
  const gate = C.gates.find((g) => g.ring === "outer");
  let si = 0;
  for (const [arm, n0] of list) {
    let n = n0; if (!n) continue;
    const A = ARMS[arm];
    while (n > 0) {
      const take = Math.min(n, A.missile ? 12 : 24); n -= take;
      let u;
      if (A.missile) { const b = front[si++ % front.length]; u = addUnit(w, { team: def, arm, count: take, x: b.x, y: b.y, facing: 0, formation: "line", depth: 1 }); manSection(w, G, u, b, true); }
      else if (gate && !G.units[def].some((v) => v.role === "gate")) { const q = gateGeomOut(G, gate); u = addUnit(w, { team: def, arm, count: take, x: q.x - q.nx * 12, y: q.y - q.ny * 12, facing: Math.atan2(q.ny, q.nx) - Math.PI / 2, formation: "line" }); u.role = "gate"; }
      else { const k = C.keep, a = C.facing + (G.units[def].length % 3 - 1) * 0.6, r = k.ward ? 22 : Math.max(k.r + 8, 22); u = addUnit(w, { team: def, arm, count: take, x: C.x + Math.cos(a) * r, y: C.y + Math.sin(a) * r, facing: C.facing - Math.PI / 2, formation: "line" }); u.role = "reserve"; }
      hostUnit(G, u, def); u.role ||= A.missile ? "wall" : "reserve";
      u.order = { kind: "hold", x: u.ax, y: u.ay, facing: u.finalFacing ?? u.facing + Math.PI / 2 };
    }
  }
}
const angAbs = (b, C) => Math.abs(angDiff(Math.atan2(b.y - C.y, b.x - C.x), C.facing));
// put a unit along a section's inner face (at once when `now`, else by order); castle.js's "man the walls" when present
export function manSection(w, G, u, b, now = false) {
  if (!b || b.x1 === undefined) return; // (a stretch of curtain, not a gate)
  const g = secGeom(G, b), face = Math.atan2(g.ny, g.nx), n = u.members.length;
  if (G.castle.real) { // castle.js: up the nearest stair onto the wall-walk, a man to each merlon (at once, at the setup)
    const o = { kind: "man_walls", x: b.x, y: b.y, castle: G.castle.real, facing: face, pace: "quick", instant: now, immediate: now };
    if (now) applyOrder(w, u, o); else issueOrder(w, [u.id], o);
    u.manning = b.id; return;
  }
  const p = g.at(0.5, -3.2);
  u.formation = "line"; u.depth = n > g.L * 0.8 ? 2 : 1; u.files = Math.ceil(n / u.depth); u.slotCache = null; u.manning = b.id;
  if (now) {
    const S = w.S, sp = Math.min(1.6, (g.L - 3) / Math.max(1, u.files));
    u.members.forEach((id, k) => { const f = k % u.files, r = Math.floor(k / u.files), s = (f - (u.files - 1) / 2) * sp; S.x[id] = p.x + g.ux * s - g.nx * r * 1.3; S.y[id] = p.y + g.uy * s - g.ny * r * 1.3; S.facing[id] = face; });
    u.ax = p.x; u.ay = p.y; u.facing = face - Math.PI / 2; u.finalFacing = face; u.path = null; u.order = { kind: "hold", x: p.x, y: p.y, facing: face };
  } else issueOrder(w, [u.id], { kind: "move", x: p.x, y: p.y, facing: face, pace: "quick" });
}
// the besiegers: the main camp on the approach (out of bowshot), posts round the other sides (the investment), the
// train at its stations — trebuchets packed on their carts at the spot where they will be framed up, mangonels
// behind mantlets, the ram and the tower in the camp
function placeHost(w, G, list, train) {
  const C = G.castle, att = G.att, F = C.facing, camp = { x: C.x + Math.cos(F) * 360, y: C.y + Math.sin(F) * 360 };
  G.camp = camp;
  const at = (d, lat, a = F) => ({ x: C.x + Math.cos(a) * d - Math.sin(a) * lat, y: C.y + Math.sin(a) * d + Math.cos(a) * lat });
  const face = F + Math.PI; let slot = 0;
  const posts = [F + Math.PI / 2, F + Math.PI, F - Math.PI / 2];
  const units = [];
  for (const [arm, n0] of list) {
    let n = n0; const A = ARMS[arm];
    while (n > 0) {
      const take = Math.min(n, A.mounted ? 20 : A.missile ? 30 : 40); n -= take;
      units.push({ arm, n: take });
    }
  }
  // a post of foot (a sixth of the host) on each other side: nobody gets in or out
  const foot = units.filter((c) => !ARMS[c.arm].mounted && !ARMS[c.arm].missile);
  const postN = Math.max(0, Math.min(posts.length, Math.floor(foot.length / 3)));
  for (let k = 0; k < postN; k++) { const c = foot[foot.length - 1 - k]; c.post = posts[k]; }
  for (const c of units) {
    let p, fc;
    if (c.post !== undefined) { p = at(330, 0, c.post); fc = c.post + Math.PI; }
    else { const row = Math.floor(slot / 6), col = slot % 6 - 2.5; p = at(360 + row * 30, col * 34); fc = face; slot++; }
    const u = addUnit(w, { team: att, arm: c.arm, count: c.n, x: p.x, y: p.y, facing: fc - Math.PI / 2, formation: ARMS[c.arm].mounted ? "line" : "line" });
    hostUnit(G, u, att); u.role = c.post !== undefined ? "post" : ARMS[c.arm].mounted ? "horse" : ARMS[c.arm].missile ? "bows" : "foot";
    u.finalFacing = fc; u.order = { kind: "hold", x: u.ax, y: u.ay, facing: fc };
  }
  // the train
  const tgt = pickBombardSection(w, G);
  G.ai[att].target = tgt?.id ?? null;
  const tg = tgt ? secGeom(G, tgt) : null;
  const tpos = (d, lat) => tg ? { x: tg.x + tg.nx * d - tg.ny * lat, y: tg.y + tg.ny * d + tg.nx * lat } : at(d + 50, lat);
  const eface = tg ? Math.atan2(-tg.ny, -tg.nx) : face;
  const eng = (kind, p, state) => {
    const u = addUnit(w, { team: att, arm: kind, count: CREW[kind], x: p.x, y: p.y, facing: eface - Math.PI / 2, formation: "line" });
    hostUnit(G, u, att); u.role = "engine";
    const e = SG.makeEngine(w, u, kind, { state }); if (!e) return null;
    e.facing = eface; e.baseFacing = eface;
    if (state === "packed") e.assembleAt = { x: p.x, y: p.y, facing: eface };
    return e;
  };
  for (let k = 0; k < (train.trebuchet || 0); k++) eng("trebuchet", tpos(180 + (k % 2) * 12, (k - (train.trebuchet - 1) / 2) * 26), "packed");
  for (let k = 0; k < (train.mangonel || 0); k++) eng("mangonel", tpos(100, (k % 2 ? 1 : -1) * (40 + 16 * Math.floor(k / 2))), "ready");
  for (let k = 0; k < (train.mantlet || 0); k++) eng("mantlet", tpos(92, (k - (train.mantlet - 1) / 2) * 5 + ((k % 2) ? 40 : -40) * 0), "ready");
  for (let k = 0; k < (train.ram || 0); k++) eng("ram", at(300, 30 + k * 12), "packed");
  for (let k = 0; k < (train.siege_tower || 0); k++) eng("siege_tower", at(300, -40 - k * 14), "packed");
  // the ram and the tower are framed up in the camp; the mangonels lay on the wall-walk (the men on it)
  for (const e of w.siege?.engines || []) {
    if (e.team !== att) continue;
    if ((e.kind === "ram" || e.kind === "siege_tower") && e.state === "packed") e.assembleAt = { x: e.x, y: e.y, facing: e.facing };
  }
  // a guard for the engines: a company of foot between the trebuchets and the castle, against sallies
  const tre = (w.siege?.engines || []).filter((e) => e.team === att && e.kind === "trebuchet");
  const gd = G.units[att].filter((u) => u.role === "foot" && !ARMS[u.arm].missile).sort((a, b) => b.members.length - a.members.length)[0];
  if (tre.length && gd) { const p = tpos(150, 0); for (const id of gd.members) { w.S.x[id] += p.x - gd.ax; w.S.y[id] += p.y - gd.ay; } gd.ax = p.x; gd.ay = p.y; gd.role = "guard"; gd.order = { kind: "hold", x: p.x, y: p.y, facing: eface }; gd.finalFacing = eface; }
  aimEngines(w, G);
}
function hostUnit(G, u, team) { u.siegeHost = true; u.battleHost = true; u.supply = { food: 1e7, arrows: 1e5, carts: 0, packhorses: 0 }; G.units[team].push(u); }
// the besieger's choice of where to breach: an outer stretch on the approach side, not the gate, with dry, level,
// open ground before it for the engines (and no water at its foot) — nearest the camp
export function pickBombardSection(w, G, avoid = null) {
  const C = G.castle, map = w.map; let best = null, bs = -Infinity;
  for (const b of C.sections) {
    if (b.ring !== "outer" || b.ruin || b.waterSide || b.id === avoid) continue;
    const g = secGeom(G, b); let s = -angAbs(b, C) * 6;
    for (let d = 20; d <= 200; d += 30) { const px = g.x + g.nx * d, py = g.y + g.ny * d; s -= (map.water(px, py) > 0.1 ? 4 : 0) + Math.min(2, (map.canopy?.(px, py) || 0) / 6); }
    s -= Math.abs(map.h(g.x + g.nx * 180, g.y + g.ny * 180) - map.h(g.x, g.y)) * 0.05;
    const foot = map.water(g.x + g.nx * 3, g.y + g.ny * 3); if (foot > 0.3) s -= 20;
    s += (1 - b.hp / b.hpMax) * 4; // (a stretch already battered)
    if (s > bs) { bs = s; best = b; }
  }
  return best;
}
// every stone-thrower of the besiegers laid on the chosen stretch (the trebuchets at its middle module; a
// mangonel cannot hurt masonry, so it shoots at the men on the wall and at the defenders' engines)
export function aimEngines(w, G, bid = G.ai[G.att].target) {
  const b = w.buildings.find((q) => q.id === bid); if (!b) return;
  for (const e of w.siege?.engines || []) {
    if (e.team !== G.att || (e.kind !== "trebuchet") || e.state === "burnt" || e.unit === null) continue;
    const k = firstStanding(b, Math.floor(b.mods.length / 2)); if (k < 0) continue;
    const p = modPoint(G, b, k);
    const u = w.units.get(e.unit); if (!u) continue;
    if (e.state === "packed" || e.state === "assembling") { e.pendingTgt = { x: p.x, y: p.y, bid: b.id }; continue; }
    if (e.tgt?.b?.id === b.id && e.tgt.kind === "mod" && b.mods[e.tgt.k] > 0) continue;
    applyOrder(w, u, { kind: "bombard", x: p.x, y: p.y, bid: b.id, raw: false });
  }
}
function firstStanding(b, k0) { const n = b.mods.length; for (let d = 0; d < n; d++) for (const k of [k0 + d, k0 - d]) if (k >= 0 && k < n && b.mods[k] > 0) return k; return -1; }

// ─────────────────────────────────────────────────────────────── the roster: nobody appears or vanishes
function makeRoster(w, G) {
  const R = { ids: new Map(), start: [0, 0], alive: [0, 0], lost: [0, 0], added: [0, 0] };
  for (const u of w.units.values()) if (u.siegeHost) for (const id of u.members) { R.ids.set(id, u.team); R.start[u.team]++; }
  return R;
}
export function enrolUnit(G, u) { if (!G.roster) return; u.siegeHost = true; u.battleHost = true; for (const id of u.members) if (!G.roster.ids.has(id)) { G.roster.ids.set(id, u.team); G.roster.added[u.team]++; } if (!G.units[u.team].includes(u)) G.units[u.team].push(u); }
function rosterTick(w, G) {
  const S = w.S, R = G.roster; R.alive = [0, 0];
  for (const [id, tm] of R.ids) { if (S.alive[id] && S.team[id] === tm) R.alive[tm]++; else { R.ids.delete(id); R.lost[tm]++; } }
}
// headcount check for the harness: men in the hosts now = the roster alive; start + added = alive + lost
export function headcount(w, G) {
  rosterTick(w, G);
  const S = w.S, now = [0, 0];
  for (const u of w.units.values()) if (u.siegeHost) for (const id of u.members) if (S.alive[id]) now[u.team]++;
  return { start: G.roster.start.slice(), added: G.roster.added.slice(), alive: G.roster.alive.slice(), lost: G.roster.lost.slice(), inUnits: now };
}

// ─────────────────────────────────────────────────────────────── the chronicle
export function note(w, G, m) {
  const e = { day: Math.max(0, dayOf(w, G)), t: w.time - G.t0, sal: 0.5, good: -1, ...m };
  if (m.once) { if (G.log.some((q) => q.once === m.once)) return null; }
  G.log.push(e); G.onNote?.(e);
  return e;
}

// ─────────────────────────────────────────────────────────────── the system (every tick, real time and days alike)
function siegeWarSystem(w, G) {
  if (G.outcome) return;
  const day = dayOf(w, G), fast = !!G.fast;
  if (!fast) { G.rec.system(w); if (G.rec.outcome && !G.outcome) { G.rec.outcome = null; if (G.rec.moments.at(-1)?.kind === "end") G.rec.moments.pop(); } }
  for (const e of w.events) watchEvent(w, G, e);
  if (w.tick % 10 === 0) eat(w, G);
  const di = Math.floor(day);
  if (di > G.lastDay) { G.lastDay = di; dayTick(w, G, di); if (G.outcome) return; }
  if (w.tick % 10 === 3) worksTick(w, G, day);
  if (w.tick % 20 === 5) phaseTick(w, G);
  if (!fast && G.think) G.think(w, G);  // (the generals' tactical thoughts: siege-ai.js)
  if (w.tick % 20 === 11) judge(w, G);
}
function watchEvent(w, G, e) {
  const C = G.castle;
  if (e.kind === "wall-breached") {
    const b = w.buildings.find((q) => q.id === e.building); if (!b || !C.sections.includes(b)) return;
    const key = b.id + ":" + e.mod, seen = (G.breachSeen ||= new Map()); // (a module patched and knocked down again is the same breach)
    if (seen.has(key) && w.time - seen.get(key) < 1 / ECON_DAYS_PER_REAL_SEC) { seen.set(key, w.time); return; }
    seen.set(key, w.time);
    G.stats.breaches++;
    note(w, G, { kind: "breach", kicker: "A breach!", text: `${cap(b.label)} comes down in a roar of dust: there is a breach ${b.mods.length > 1 ? "a few yards wide" : ""} in ${b.ring === "keep" ? "the keep's wall" : "the walls"}`, good: G.att, x: e.x, y: e.y, sal: 0.95 });
  } else if (e.kind === "gate-broken") {
    const g = w.buildings.find((q) => q.id === e.building); if (!g || !C.gates.includes(g)) return;
    note(w, G, { kind: "gate", kicker: "The gate gives way", text: `${cap(g.label)} is broken in`, good: G.att, x: g.x, y: g.y, sal: 0.9 });
  } else if (e.kind === "engine-destroyed" || e.kind === "engine-captured") {
    const q = SG.engineById(w, e.engine); if (e.kind === "engine-destroyed") G.stats.burnt++;
    note(w, G, { kind: "engine", kicker: e.kind === "engine-captured" ? "An engine taken" : "An engine lost", text: `${cap(e.team === G.att ? "the besiegers'" : "the garrison's")} ${ARMS[e.what]?.name.toLowerCase() || e.what} ${e.kind === "engine-captured" ? "is taken" : e.how === "burnt" ? "burns" : "is smashed"}`, good: e.kind === "engine-captured" ? e.team : 1 - e.team, x: q?.x, y: q?.y, sal: 0.65 });
  } else if (e.kind === "engine-ready") {
    const q = SG.engineById(w, e.engine); if (!q || q.team !== G.att) return;
    note(w, G, { kind: "ready", kicker: "An engine framed up", text: `The besiegers' ${ARMS[q.kind].name.toLowerCase()} stands ready`, good: G.att, x: q.x, y: q.y, sal: 0.45 });
    if (q.pendingTgt) { const u = w.units.get(q.unit); if (u) applyOrder(w, u, { kind: "bombard", ...q.pendingTgt }); q.pendingTgt = null; }
  } else if (WORKS_NOTE[e.kind]) {
    const m = WORKS_NOTE[e.kind](w, G, e); if (m) note(w, G, m);
  } else if (e.kind === "escalade-lodged") {
    const u = w.units.get(e.unit); note(w, G, { kind: "lodged", kicker: "Over the wall", text: `${cap(G.names.arm(e.team, u?.arm))} are over the wall and hold a footing on it`, good: e.team, x: u?.ax, y: u?.ay, sal: 0.85 });
  } else if (e.kind === "escalade-failed") {
    const u = w.units.get(e.unit); note(w, G, { kind: "repulse", kicker: "Thrown back", text: `The ladders are thrown down: ${cap(G.names.arm(e.team, u?.arm))} fall back — ${e.why}`, good: 1 - e.team, x: u?.ax, y: u?.ay, sal: 0.7 });
  }
}

// what the works (siege-works.js) did, in the chronicle
const bl = (w, id) => w.buildings.find((b) => b.id === id)?.label || "the wall";
const WORKS_NOTE = {
  "mine-detected": (w, G, e) => ({ kind: "heard", kicker: "Digging heard", text: `The water in a bowl on the floor by ${bl(w, e.building)} trembles: the garrison hear the miners`, good: G.def, x: e.x, y: e.y, sal: 0.65 }),
  "countermine-started": (w, G, e) => ({ kind: "countermine", kicker: "A countermine", text: "The garrison's miners dig toward the besiegers' gallery", good: G.def, x: e.x, y: e.y, sal: 0.45 }),
  "mine-fight": (w, G, e) => ({ kind: "minefight", kicker: "A fight underground", text: `The galleries meet: a fight by lamplight in the dark (${e.attackersDead} besiegers and ${e.defendersDead} of the garrison killed)`, good: e.won, x: e.x, y: e.y, sal: 0.7 }),
  "mine-lost": (w, G, e) => ({ kind: "minelost", kicker: "The mine is lost", text: "The besiegers' gallery is taken and brought down on itself", good: G.def, sal: 0.7 }),
  "mine-fired": (w, G, e) => ({ kind: "minefired", kicker: "The props are fired", text: `Smoke from the ground before ${bl(w, e.building)}: the miners have fired the props of their gallery`, good: G.att, x: e.x, y: e.y, sal: 0.8 }),
  "mine-collapse": (w, G, e) => ({ kind: "minecollapse", kicker: e.full ? "The mine is sprung" : "The mine settles", text: e.full ? `${cap(bl(w, e.building))} ${e.tower ? "comes down entire" : "drops into the gallery"}` : `${cap(bl(w, e.building))} cracks and settles, but stands`, good: e.full ? G.att : G.def, x: e.x, y: e.y, sal: e.full ? 1 : 0.6 }),
  "tower-collapsed": (w, G, e) => ({ kind: "tower", kicker: "A tower falls", text: `${cap(bl(w, e.building))} falls in a roar of dust`, good: G.att, x: e.x, y: e.y, sal: 0.95 }),
  "breach-barricaded": (w, G, e) => ({ kind: "plug", kicker: "The breach is stopped", text: `The garrison have raised a barricade of timber and rubble behind the breach in ${bl(w, e.building)}`, good: G.def, x: e.x, y: e.y, sal: 0.7 }),
  "barricade-broken": (w, G, e) => ({ kind: "plugbroken", kicker: "The barricade is down", text: `The besiegers tear the barricade in ${bl(w, e.building)} apart`, good: G.att, x: e.x, y: e.y, sal: 0.8 }),
  "gate-leaves-broken": (w, G, e) => ({ kind: "leaves", kicker: "The leaves give", text: `The leaves of ${bl(w, e.building)} are broken${e.portcullis ? " — the portcullis still bars the passage" : ""}`, good: G.att, sal: 0.7 }),
  "portcullis-broken": (w, G, e) => ({ kind: "portcullis", kicker: "The portcullis", text: `The portcullis of ${bl(w, e.building)} is wrenched and broken`, good: G.att, sal: 0.8 }),
  "sally-out": (w, G, e) => ({ kind: "sally", kicker: "A sally!", text: `${cap(G.names.side(G.def))} sally out by the ${e.by}`, good: G.def, x: e.x, y: e.y, sal: 0.75 }),
  "sally-in": (w, G, e) => ({ kind: "sallyin", kicker: "Back inside", text: `The sally party are back inside (${e.lost} lost)`, good: -1, sal: 0.4 }),
  "engine-fired": (w, G, e) => ({ kind: "fire", kicker: "Fire!", text: `The besiegers' ${ARMS[e.what]?.name.toLowerCase() || "engine"} is alight`, good: G.def, sal: 0.6 }),
  "breach-repaired": (w, G, e) => ({ kind: "repaired", kicker: "Rebuilt", text: `The garrison's masons have closed the breach in ${bl(w, e.building)}`, good: G.def, x: e.x, y: e.y, sal: 0.55 }),
};
// FOOD: siege-works.js (SIEGE-MECH) keeps the garrison's store — man-days eaten on the econ clock, hunger and its
// sickness when it is gone — with its own yielding turned off (h.auto = false): how it ends is judged here, once.
function eat(w, G) {
  const h = G.hold; if (!h) return;
  G.food = h.food; const was = G.hunger; G.hunger = h.starving || 0;
  if (G.hunger > 0 && !(was > 0)) note(w, G, { kind: "hunger", kicker: "The stores are empty", text: `The last of the grain is gone in ${G.name}: the garrison eats its horses`, good: G.att, sal: 0.8, x: G.castle.x, y: G.castle.y, once: "hunger" });
}
// once a day (whatever the clock): sickness in the camp, the hungry garrison, relief, the general's day-thoughts
function dayTick(w, G, day) {
  if (day === 0) { G.phase = "siege"; return; }
  // sickness in the camp (dysentery, the cold): each besieger has the season's chance a day
  G.stats.sick[G.att] += cull(w, G, G.att, G.season.sick, "sick");
  if (G.hunger > 0) { // hungry men desert by night and the rest lose heart
    G.stats.deserted[G.def] += cull(w, G, G.def, 0.02 + G.hunger * 0.004, "desert");
    for (const u of G.units[G.def]) if (u.members.length) u.moraleMod = Math.min(0.25, (u.moraleMod || 0) + 0.03);
  }
  // the besiegers' will: past it, the host melts away a little every day (unpaid, the season turning)
  if (day > G.will) G.stats.deserted[G.att] += cull(w, G, G.att, 0.01 * Math.min(4, (day - G.will) / 5), "desert");
  if (G.relief && !G.relief.known && day >= G.relief.day - 5) { G.relief.known = true; note(w, G, { kind: "relief-news", kicker: "News of relief", text: `Scouts ride in: a relieving army is on the march and will be before ${G.name} within five days`, good: G.def, sal: 0.8 }); }
  if (G.relief && day >= G.relief.day && G.phase !== "end") { end(w, G, G.def, "relieved", `the relieving army came up on day ${Math.floor(day) + 1} and the besiegers drew off before it`); return; }
  G.dayThink?.(w, G, day);
}
// take a share of a side's men out of the siege (sickness, desertion): the ones in the camp, not those fighting
function cull(w, G, team, p, how) {
  const S = w.S; let n = 0;
  for (const u of G.units[team]) {
    if (!u.members.length || u.household) continue;
    for (const id of u.members) {
      if (!S.alive[id] || S.state[id] === S_FIGHT) continue;
      if (w.rng.next() < p) { S.alive[id] = 0; S.state[id] = how === "sick" ? S_DEAD : EC.S_GONE; n++; }
    }
  }
  return n;
}

// ── THE WORKS (siege-works.js): mines, countermine posts, barricades, repairs, sallies are unit orders there; these
// are the siege's views of them and the helpers the generals and the UI call.
const W_ = (w) => w.siege?.works || null;
export function minesOf(w, G) { return (W_(w)?.mines || []).filter((m) => m.team === G.att).map((m) => ({ ...m, b: w.buildings.find((q) => q.id === m.bid) })); }
export function barricadeAt(w, b, k) { return (W_(w)?.barricades || []).find((q) => q.bid === b.id && q.k === k && q.state !== "broken" && q.state !== "gone") || null; }
// a company of foot (or `u`) sent to dig a mine at section b's angle: the miners (16 of the host's foot, split off)
export function startMine(w, G, b, end = 0, u = null) {
  if (!b) return null;
  if ((b.ground || "earth") === "rock" && !u) return null; // (the generals do not mine rock: MINE.rate.rock, 0.2 m a day)
  const k = end ? b.mods.length - 1 : 0, p = modPoint(G, b, k);
  if (b.waterSide || w.map.water(p.x + secGeom(G, b).nx * 6, p.y + secGeom(G, b).ny * 6) > 0.2) return null;
  let crew = u;
  if (!crew) { const donor = G.units[G.att].filter((v) => v.members.length > 24 && !ARMS[v.arm].mounted && !ARMS[v.arm].missile && !ARMS[v.arm].engine && !v.esc && v.role !== "assault" && v.role !== "post").sort((a, c) => c.members.length - a.members.length)[0]; if (!donor) return null; crew = splitUnit(w, donor, 16); enrolUnit(G, crew); }
  crew.role = "miners"; crew.miners = true;
  applyOrder(w, crew, { kind: "mine", x: p.x, y: p.y, bid: b.id, k });
  const m = (W_(w)?.mines || []).find((q) => q.unit === crew.id);
  if (m) note(w, G, { kind: "mine", kicker: "Miners at work", text: `The besiegers' miners open a gallery toward ${b.label}${m.ground === "rock" ? " — hopeless work in the rock" : ""}`, good: G.att, x: m.x0, y: m.y0, sal: 0.45, secret: true });
  return m || null;
}
// a listening post (countermine) inside section b, manned by `u` or eight men split off a company of the garrison
export function startPost(w, G, b, u = null) {
  const p = modPoint(G, b, Math.floor(b.mods.length / 2), -6);
  let crew = u;
  if (!crew) { const donor = G.units[G.def].filter((v) => v.members.length >= 16 && !ARMS[v.arm].missile && !ARMS[v.arm].engine && v.role !== "keep" && v.role !== "sally").sort((a, c) => c.members.length - a.members.length)[0]; if (!donor) return null; crew = splitUnit(w, donor, 8); enrolUnit(G, crew); }
  crew.role = "post"; crew.postFor = b.id;
  applyOrder(w, crew, { kind: "countermine", x: p.x, y: p.y });
  return crew;
}
export function startBarricade(w, G, b, k, u) { if (!u) return false; u.role = "works"; applyOrder(w, u, { kind: "barricade", x: modPoint(G, b, k).x, y: modPoint(G, b, k).y, bid: b.id, k }); return true; }
export function startRepair(w, G, b, u) { if (!u) return false; u.role = "works"; applyOrder(w, u, { kind: "repair", x: b.x, y: b.y, bid: b.id }); return true; }
function killN(w, G, team, n) {
  const S = w.S, pool = []; for (const u of G.units[team]) if (u.members.length && !u.household && !ARMS[u.arm].engine) for (const id of u.members) if (S.alive[id] && S.state[id] !== S_FIGHT) pool.push(id);
  let k = 0; while (k < n && pool.length) { const j = Math.floor(w.rng.next() * pool.length), id = pool.splice(j, 1)[0]; S.alive[id] = 0; S.state[id] = S_DEAD; k++; }
  return k;
}

// ── works in the camp: ladders, a ram, a tower, mantlets — made by the host's own carpenters (days), the engine's crew
// drafted out of a company of foot (nobody is conjured: the men are taken from the foot)
export function startWork(w, G, kind, bid) {
  const W = WORKS[kind]; if (!W) return null;
  if (G.works.some((q) => q.kind === kind && !q.done)) return null;
  if (kind === "fill") { const b = w.buildings.find((x) => x.id === (bid ?? G.ai[G.att].target)); if (!b || !moatBefore(w, G, b)) return null; bid = b.id; }
  const q = { kind, days: W.days, t0: dayOf(w, G), prog: 0, last: dayOf(w, G), done: false, bid };
  G.works.push(q); return q;
}
function worksTick(w, G, day) {
  for (const q of G.works) {
    if (q.done) continue;
    const d = day - q.last; q.last = day; q.prog = Math.min(1, q.prog + d / q.days);
    if (q.prog < 1) continue;
    q.done = true;
    const T = w.teams[G.att];
    if (q.kind === "fill") { const b = w.buildings.find((x) => x.id === q.bid); if (b) fillMoat(w, G, b); continue; }
    if (q.kind === "ladders") { T.store.ladders = (T.store.ladders || 0) + WORKS.ladders.n; note(w, G, { kind: "work", kicker: "Ladders made", text: `The carpenters have made ${WORKS.ladders.n} more scaling ladders`, good: G.att, sal: 0.35 }); continue; }
    const n = q.kind === "mantlet" ? WORKS.mantlet.n : 1;
    for (let j = 0; j < n; j++) {
      const donor = G.units[G.att].filter((u) => u.members.length > CREW[q.kind] + 4 && !ARMS[u.arm].mounted && !ARMS[u.arm].missile && !ARMS[u.arm].engine && !u.esc && u.role !== "assault").sort((a, b) => b.members.length - a.members.length)[0];
      if (!donor) { note(w, G, { kind: "work", kicker: "No crew", text: `The ${ARMS[q.kind].name.toLowerCase()} is built but there are no men to spare to work it`, good: G.def, sal: 0.3 }); break; }
      const crew = splitUnit(w, donor, CREW[q.kind], q.kind);
      const e = SG.makeEngine(w, crew, q.kind, { state: "ready" }); crew.role = "engine"; enrolUnit(G, crew);
      if (e) { e.facing = G.castle.facing + Math.PI; e.baseFacing = e.facing; }
    }
    note(w, G, { kind: "work", kicker: "A new engine", text: `The carpenters have finished ${WORKS[q.kind].name.toLowerCase()}`, good: G.att, x: G.camp.x, y: G.camp.y, sal: 0.5 });
  }
}
// the wet moat before a stretch of curtain (castle.js lays one on a river castle's landward sides): the feature(s)
// within 30 m out along its normal
export function moatBefore(w, G, b) {
  if (b.x1 === undefined) return null; const g = secGeom(G, b), out = [];
  for (const f of w.features || []) { if (f.type !== "moat") continue; for (let d = 6; d <= 34; d += 4) { const px = g.x + g.nx * d, py = g.y + g.ny * d; if (pointSeg(px, py, f.x0, f.y0, f.x1, f.y1) < (f.width || 10) / 2) { out.push({ f, px, py }); break; } } }
  return out.length ? out : null;
}
// the moat filled before the stretch: a causeway of fascines 12 m wide across it (the moat feature split round it)
export function fillMoat(w, G, b) {
  const M = moatBefore(w, G, b); if (!M) return false;
  for (const { f, px, py } of M) {
    const dx = f.x1 - f.x0, dy = f.y1 - f.y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, t = (px - f.x0) * ux + (py - f.y0) * uy, h = 6;
    removeFeature(w, f);
    if (t - h > 1) addFeature(w, { ...f, x1: f.x0 + ux * (t - h), y1: f.y0 + uy * (t - h) });
    if (L - (t + h) > 1) addFeature(w, { ...f, x0: f.x0 + ux * (t + h), y0: f.y0 + uy * (t + h) });
    (G.fills ||= []).push({ x: px, y: py, bid: b.id });
    // the render description gets the gap too (js/render/castle.js draws the causeway, not water, there)
    for (const q of (G.castle.real || G.castle.render)?.parts || []) if (q.kind === "moat") (q.fills ||= []).push({ x: px, y: py, r: h });
  }
  note(w, G, { kind: "fill", kicker: "The moat is filled", text: `The besiegers have filled the moat before ${b.label} with fascines and earth: a causeway to the foot of the wall`, good: G.att, x: M[0].px, y: M[0].py, sal: 0.7 });
  return true;
}
// n men out of a unit into a new one (as siege.js crewTick does): the same men, a new company
export function splitUnit(w, u, n, arm = u.arm) {
  const S = w.S, ids = u.members.filter((id) => S.alive[id]).slice(-n), set = new Set(ids);
  const nu = { ...u, id: w.nextUnit++, members: ids.slice(), path: null, order: { kind: "hold", x: u.ax, y: u.ay }, legendIds: [], slotCache: null, c: null, hold: false, esc: null, engine: undefined, crewFor: undefined, arm, pendingOrder: null, coName: null };
  for (const id of ids) { S.unit[id] = nu.id; if (arm !== u.arm) S.arm[id] = ARMS[arm].id; }
  u.members = u.members.filter((id) => !set.has(id)); u.slotCache = null;
  w.units.set(nu.id, nu);
  return nu;
}

// ─────────────────────────────────────────────────────────────── the phases
function phaseTick(w, G) {
  if (G.phase === "end" || G.phase === "invest") return;
  const C = G.castle, S = w.S;
  let attIn = 0, attNear = 0, defOut = 0, defKeep = 0, attKeep = 0;
  for (const u of G.units[G.att]) { if (!u.members.length || u.state === "routing" || (ARMS[u.arm].engine && u.arm !== "ram" && u.arm !== "siege_tower") || u.role === "miners" || u.role === "guard") continue; const d = Math.hypot(u.ax - C.x, u.ay - C.y); if (insideCastle(w, G, u.ax, u.ay)) { attIn += u.members.length; if (inKeep(G, u.ax, u.ay)) attKeep += u.members.length; } else if (d < 170) attNear += u.members.length; }
  for (const u of G.units[G.def]) { if (!u.members.length) continue; if (inKeep(G, u.ax, u.ay)) defKeep += u.members.length; else defOut += u.members.length; }
  G.now = { attIn, attNear, defOut, defKeep, attKeep };
  const prev = G.phase;
  if (attIn >= 12) G.phase = (defOut < 8 && defKeep > 0) || G.fellBack ? "keep" : "inside";
  else if (attNear >= 20 || G.assault?.on) G.phase = "assault";
  else if (G.phase === "assault" || G.phase === "inside") G.phase = "siege";
  if (G.phase === "keep" && prev !== "keep") G.keepT ??= w.time;
  if (G.phase === "keep" && prev !== "keep") note(w, G, { kind: "keep", kicker: C.keep?.ward ? "The inner ward" : "The keep", text: `${cap(G.names.side(G.def))} hold out in ${C.keep?.ward ? "the inner ward" : "the keep"}: the last refuge`, good: G.def, x: C.keep?.x, y: C.keep?.y, sal: 0.8, once: "keep" });
  if (G.phase === "inside" && prev !== "inside" && prev !== "keep") note(w, G, { kind: "inside", kicker: "In the bailey", text: `${cap(G.names.side(G.att))} are inside the curtain: the fight is in the bailey`, good: G.att, x: C.x, y: C.y, sal: 0.9, once: "inside" });
}
// how it ends
function judge(w, G) {
  if (G.outcome) return;
  const S = w.S; let defFight = 0, defAll = 0, attFight = 0;
  for (const u of G.units[G.def]) for (const id of u.members) { if (!S.alive[id]) continue; defAll++; if (S.status[id] < ST_FLEE && S.state[id] !== S_CAPT && S.state[id] !== S_FLEE) defFight++; }
  for (const u of G.units[G.att]) for (const id of u.members) if (S.alive[id] && S.status[id] < ST_FLEE && S.state[id] !== S_CAPT && S.state[id] !== S_FLEE) attFight++;
  G.fight = [0, 0]; G.fight[G.def] = defFight; G.fight[G.att] = attFight;
  const C = G.castle;
  if (defFight === 0) { end(w, G, G.att, "taken", defAll ? "the last of the garrison threw down their arms" : "the last of the garrison fell"); return; }
  // the keep entered and hardly a man left standing in it
  if (G.phase === "keep" && G.now && G.now.attKeep > 10 && G.now.defKeep < Math.max(4, G.now.attKeep * 0.15)) { end(w, G, G.att, "taken", `${C.keep?.ward ? "the inner ward" : "the keep"} was stormed`); return; }
  if (G.hunger >= 7) { end(w, G, G.att, "starved", `after ${Math.round(G.hunger)} days without bread the garrison opened the gate`); return; }
  if (attFight < 10) end(w, G, G.def, "abandoned", "the besieging host was all but destroyed");
}
export function end(w, G, winner, how, why, { yielded = how === "terms" || how === "starved" } = {}) {
  if (G.outcome) return;
  G.yielded = [0, 0]; if (yielded) { const S = w.S; for (const u of G.units[G.def]) for (const id of u.members) if (S.alive[id]) G.yielded[G.def]++; }
  if (yielded && G.hold && SWK.surrender) { try { SWK.surrender(w, G.hold, undefined, how === "starved" ? "starvation" : "terms"); } catch { /* the garrison marches out all the same */ } }
  G.outcome = { winner, loser: 1 - winner, how, why, day: Math.round(dayOf(w, G) * 10) / 10, t: w.time - G.t0 };
  G.phase = "end";
  G.rec.outcome = { winner, loser: 1 - winner, why, t: w.time - G.rec.t0 };
  const K = { taken: "Taken by storm", terms: "Yielded on terms", starved: "Starved out", relieved: "Relieved", abandoned: "The siege is raised" }[how] || "The end";
  note(w, G, { kind: "end", kicker: K, text: `${cap(how === "relieved" || how === "abandoned" ? G.name + " holds" : G.name + " falls")}: ${why}`, good: winner, sal: 1, x: G.castle.x, y: G.castle.y });
  G.onEnd?.(G.outcome);
}

// ─────────────────────────────────────────────────────────────── letting days pass (structural time)
// Nobody walks: siegeSystem alone runs tick by tick (the engines, the stones, the framing-up, fire), and this
// module's day work with it. Stops at the first day-boundary where `until` holds, or when a general decides to storm,
// or at the end. Returns { days, stop }.
export function passDays(w, G, days, { until = null, maxTicks = Infinity } = {}) {
  if (G.outcome) return { days: 0, stop: "end" };
  const d0 = dayOf(w, G), n = Math.min(maxTicks, Math.ceil(days * DAY_TICKS));
  const U = typeof until === "function" ? until : UNTIL[until] || null;
  const wasA = G.assault?.on;
  G.fast = true; let stop = "days", k = 0;
  settle(w, G);
  const sys = w.siegeSystem || SG.siegeSystem;
  try {
    for (; k < n; k++) {
      w.tick++; w.time += DT; w.events.length = 0;
      sys(w);
      siegeWarSystem(w, G);
      if (w.log && w.log.length > 4000) w.log.splice(0, w.log.length - 1000);
      if (G.outcome) { stop = "end"; break; }
      if (G.assault?.on && !wasA) { stop = "assault"; break; }
      if (G.stopDays) { G.stopDays = false; stop = "herald"; break; } // (a herald for the player: the days stop)
      if (U && w.tick % 20 === 0 && U(w, G)) { stop = until; break; }
      if (k % DAY_TICKS === DAY_TICKS - 1) settle(w, G);
    }
  } finally { G.fast = false; }
  return { days: dayOf(w, G) - d0, stop };
}
// While days pass nobody walks — but a day is long enough to walk anywhere in the siege: every company on the move
// (a work party to a breach, miners to the mouth of their gallery, a company to its post) is put where it was going.
function settle(w, G) {
  const S = w.S;
  for (const u of w.units.values()) {
    if (u.cst && u.members.length && !u.esc && u.state !== "routing" && u.cst.o && u.cst.kind !== "assault") { try { applyOrder(w, u, { ...u.cst.o, kind: u.cst.kind, instant: true, immediate: true }); u.path = null; } catch { /* leave them */ } continue; }
    if (!u.members.length || !u.path?.length || u.isWorkers || u.esc || u.state === "routing") continue;
    const e = u.engine !== undefined ? SG.engineOf(w, u) : null; if (e && e.kind !== "ram" && e.kind !== "siege_tower" && e.state !== "packed") continue;
    const [tx, ty] = u.path[u.path.length - 1], dx = tx - u.ax, dy = ty - u.ay;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 2) continue;
    for (const id of u.members) if (S.alive[id]) { S.x[id] += dx; S.y[id] += dy; S.vx[id] = S.vy[id] = 0; if (u.finalFacing !== undefined) S.facing[id] = u.finalFacing; }
    u.ax = tx; u.ay = ty; u.path = null; if (u.finalFacing !== undefined) u.facing = u.finalFacing - Math.PI / 2;
    if (e) { e.x = tx; e.y = ty; }
  }
  if (w.siege) w.siege.prev = null; // (siege.js barrierResolve: these were not steps through a wall)
}
const UNTIL = {
  breach: (w, G) => breaches(G, "outer").some((q) => !q.plug?.done),
  mine: (w, G) => { const ms = minesOf(w, G); return ms.some((m) => m.state === "fired" || m.state === "chamber" && m.prog > 0.9) || !ms.some((m) => m.state === "digging" || m.state === "chamber"); },
  works: (w, G) => !G.works.some((q) => !q.done),
  engines: (w, G) => !(w.siege?.engines || []).some((e) => e.team === G.att && !e.abandoned && e.unit !== null && (e.state === "packed" || e.state === "assembling")),
  assault: (w, G) => !!G.assault?.on,
};
export const siegeDay = (w, G) => dayOf(w, G);

// ─────────────────────────────────────────────────────────────── terms (both sides; AI or player answers)
// An offer from the besiegers: the garrison may march out with their arms and horses and go free (the usual terms
// after a respectable defence); refused — and taken by storm — they could be put to the sword.
export function offerTerms(w, G, from) {
  if (G.outcome || G.terms?.open) return null;
  const late = G.phase === "inside" || G.phase === "keep"; // (the walls stormed: no more honours of war — lives only)
  G.terms = { open: true, from, day: dayOf(w, G), late, text: from === G.att
    ? late ? `${cap(G.names.side(G.att))} call on the garrison to throw down their arms: their lives will be spared` : `${cap(G.names.side(G.att))} send a herald: yield ${G.name}, and the garrison may march out with their arms and horses`
    : late ? `${cap(G.names.side(G.def))} cry for quarter: they will lay down their arms for their lives` : `${cap(G.names.side(G.def))} ask for terms: they will yield ${G.name} if they may march out free` };
  note(w, G, { kind: "terms", kicker: "A herald", text: G.terms.text, good: -1, sal: 0.7 });
  G.onTerms?.(G.terms);
  return G.terms;
}
export function answerTerms(w, G, yes) {
  const T = G.terms; if (!T?.open) return;
  T.open = false; G.stats.terms.push({ day: Math.round(T.day), from: T.from, yes });
  if (yes) {
    // the law of arms: terms (to march out free) were for a garrison that yielded BEFORE the storm. Once the walls were
    // stormed a garrison broken in the bailey could only throw down its arms and beg for its life — the castle taken by
    // storm, its men prisoners. A keep that still held out could treat again, for their lives.
    const d = Math.floor(dayOf(w, G)) + 1, K = G.castle.keep, now = G.now || {}; // (day numbers as the UI shows them: day 1 is the first)
    const stormed = G.phase === "inside" || (G.phase === "keep" && !(now.defKeep >= 6 && !(now.attKeep > 0)));
    if (stormed) { end(w, G, G.att, "taken", `the walls stormed, the garrison threw down their arms in ${K?.ward ? "the outer ward" : "the bailey"} and were taken prisoner`, { yielded: true }); return; }
    if (G.phase === "keep") { end(w, G, G.att, "terms", `on day ${d} the last of the garrison yielded ${K?.ward ? "the inner ward" : "the keep"} for their lives`); return; }
    end(w, G, G.att, "terms", T.from === G.att ? `the garrison accepted terms on day ${d} and marched out with their arms` : `the garrison asked for terms and were let go`); return;
  }
  note(w, G, { kind: "terms", kicker: "Refused", text: T.from === G.att ? `The constable sends the herald back: ${G.name} will be held` : `The besiegers will give no terms`, good: T.from === G.att ? G.def : G.att, sal: 0.5 });
}
// how hopeless the defence looks to the garrison, 0..1 (the defender AI yields past ~0.75)
export function hopeless(w, G) {
  const C = G.castle, now = G.now || {}, st = G.roster?.start?.[G.def] || 1;
  const men = (G.fight?.[G.def] ?? menOf(w, G, G.def)) / st, foe = (G.fight?.[G.att] ?? menOf(w, G, G.att)) / Math.max(1, G.fight?.[G.def] ?? menOf(w, G, G.def));
  const foodDays = G.food / Math.max(1, menOf(w, G, G.def)), relief = G.relief ? Math.max(0, G.relief.day - dayOf(w, G)) : Infinity;
  let h = 0;
  if (breaches(G, "outer").some((q) => !q.plug?.done)) h += 0.25;
  if (G.phase === "inside") h += 0.25; if (G.phase === "keep") h += 0.4;
  if (C.keep && breaches(G, "keep").length) h += 0.2;
  h += clamp((foe - 4) / 12, 0, 0.3) + clamp((0.5 - men) * 0.8, 0, 0.4);
  if (foodDays < 7 && relief > foodDays) h += 0.25 * (1 - foodDays / 7);
  if (G.hunger > 0) h += 0.3;
  if (relief < 10) h -= 0.3;
  // THE LAW OF ARMS (siege-research.md §23): a garrison summoned before the storm could yield with honour; once it had
  // refused and the walls were stormed it had no claim to quarter — so the stormers' being inside did not of itself make
  // men yield: a strong garrison with its keep still whole fell back into it and fought on, and the keep held out until
  // its door or wall was forced, its men were too few, or time and hunger wore them down (Rochester 1215: the bailey
  // taken, the keep held for weeks more; Château Gaillard 1204: the inner ward stormed). The constable's own temper
  // (G.temper, drawn once) makes one garrison stubborn and another quick to treat.
  // (strength counts every man still free — broken men who run for the keep rally there — not only those fighting now)
  const K = C.keep, attKeep = now.attKeep || 0, defKeep = now.defKeep || 0, defN = G.fight?.[G.def] ?? menOf(w, G, G.def), free = menOf(w, G, G.def);
  const keepBroken = !K || attKeep > 0 || breaches(G, "keep").some((q) => !q.plug?.done) || !!(K.gate && (K.gate.gateBroken || K.gate.ruin)); // (not forcedOpen: that is the door held for their own men)
  const strong = free >= st * 0.35 && defN >= 15;
  if (!keepBroken && G.hunger <= 0) {
    if ((G.phase === "inside" || G.phase === "assault") && strong) h = Math.min(h, 0.5);        // fall back and fight on
    if (G.phase === "keep" && (defKeep >= 8 || w.time - (G.keepT ?? w.time) < 120) && defN >= 6) { // the keep holds out…
      const held = Math.max(0, w.time - (G.keepT ?? w.time)) / 60;                                // …minutes of battle time in it
      h = Math.min(h, 0.45) + Math.min(0.45, held * 0.07) + (defKeep < 20 ? 0.1 : 0);
    }
  }
  h -= ((G.temper ?? 0.5) - 0.5) * 0.3;
  return clamp(h, 0, 1);
}

// ─────────────────────────────────────────────────────────────── the siege orders (player and AI alike)
// kind: bombard {bid} | mine {bid, end} | fireMine | build {what} | assault { breach | gate | escalade | tower | all } |
//       manWalls {ids, bid} | holdBreach {ids} | barricade {bid, k} | keep {ids} | sally {ids, x, y} | terms | callOff
export function siegeCommand(w, G, team, kind, o = {}) {
  const C = G.castle;
  const units = (o.ids || []).map((id) => w.units.get(id)).filter((u) => u && u.members.length && u.team === team);
  switch (kind) {
    case "bombard": { if (team !== G.att) return "only the besiegers bombard"; const b = w.buildings.find((q) => q.id === o.bid); if (!b || !C.sections.includes(b)) return "no wall there"; G.ai[G.att].target = b.id; aimEngines(w, G, b.id); note(w, G, { kind: "order", kicker: "The engines are laid", text: `The trebuchets are laid on ${b.label}`, good: -1, sal: 0.3, x: b.x, y: b.y }); return null; }
    case "mine": { if (team !== G.att) return "the besiegers mine; the garrison countermines"; const b = w.buildings.find((q) => q.id === o.bid) || nearestSection(G, o.x, o.y, "outer"); if (!b) return "no wall there"; const m = startMine(w, G, b, o.end || 0, units.find((u) => !ARMS[u.arm].mounted && !ARMS[u.arm].engine) || null); return m ? null : "no mine can be dug there (water at the foot, or no men to spare)"; }
    case "countermine": { if (team !== G.def) return "the garrison countermines"; const b = w.buildings.find((q) => q.id === o.bid) || nearestSection(G, o.x, o.y); if (!b) return "no wall there"; return startPost(w, G, b, units[0] || null) ? null : "no men to spare for a listening post"; }
    case "repair": { if (team !== G.def) return "only the garrison repairs its walls"; const b = w.buildings.find((q) => q.id === o.bid) || nearestSection(G, o.x, o.y); if (!b) return "no wall there"; const u = units[0] || freeFoot(w, G); return startRepair(w, G, b, u) ? null : "no men to spare"; }
    case "build": { if (team !== G.att) return "the besiegers build engines"; return startWork(w, G, o.what, o.bid) ? null : o.what === "fill" ? "no moat before the stretch the engines are laid on (or it is being filled)" : "that is already being built"; }
    case "assault": return startAssault(w, G, o.how || "all", units.length ? units : null);
    case "callOff": return callOff(w, G, team);
    case "stormKeep": return team !== G.att ? "only the besiegers storm the keep" : G.stormKeep ? G.stormKeep(units) : "no one to lead it";
    case "reserve": return team !== G.att ? "only the besiegers have a reserve to send" : !G.assault?.on && G.phase !== "inside" && G.phase !== "keep" ? "there is no assault under way" : G.sendReserve ? G.sendReserve(units) : "no one to lead it";
    case "manWalls": { const b = w.buildings.find((q) => q.id === o.bid) || nearestSection(G, o.x, o.y); if (!b) return "no wall there"; for (const u of units) manSection(w, G, u, b); return null; }
    case "holdBreach": { const q = breaches(G).sort((a, b) => dist(modPoint(G, a.b, a.k), o) - dist(modPoint(G, b.b, b.k), o))[0]; if (!q) return "there is no breach"; const p = modPoint(G, q.b, q.k, -10), g = secGeom(G, q.b); issueOrder(w, units.map((u) => u.id), { kind: "move", x: p.x, y: p.y, facing: Math.atan2(g.ny, g.nx), formation: "line", pace: "quick" }); for (const u of units) u.role = "breach"; return null; }
    case "barricade": { const q = (o.bid !== undefined ? breaches(G).filter((r) => r.b.id === o.bid) : breaches(G).sort((a, b) => dist(modPoint(G, a.b, a.k), o) - dist(modPoint(G, b.b, b.k), o))).find((r) => !r.plug); if (!q) return "no open breach to stop"; const u = units[0] || freeFoot(w, G); if (!startBarricade(w, G, q.b, q.k, u)) return "no men to spare"; note(w, G, { kind: "order", kicker: "Barricade", text: `The garrison set to stopping the breach in ${q.b.label}`, good: -1, sal: 0.35 }); return null; }
    case "keep": return fallBack(w, G, units.length ? units : null);
    case "sally": return sally(w, G, units, o);
    case "terms": return offerTerms(w, G, team) ? null : "a herald is already out";
    default: return "unknown order";
  }
}
// a company of the garrison's foot not busy elsewhere (for a work party)
export function freeFoot(w, G) { return G.units[G.def].filter((u) => u.members.length >= 10 && !ARMS[u.arm].missile && !ARMS[u.arm].engine && !u.works && !["keep", "sally", "post", "works"].includes(u.role) && !u.household).sort((a, b) => b.members.length - a.members.length)[0] || null; }
const dist = (p, o) => Math.hypot(p.x - (o.x ?? p.x), p.y - (o.y ?? p.y));
export function nearestSection(G, x, y, ring = null) { let best = null, bd = Infinity; for (const b of G.castle.sections) { if (ring && b.ring !== ring) continue; const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = b; } } return best; }
// the assault: the stormers to the breach, the ram to the gate, the ladders to the wall, the tower docked — with
// a feint elsewhere to draw the defenders off; the bows come up to shoot the wall-walk clear. (units: the
// player's own choice; null = the AI's plan, siege-ai.js assaultPlan)
export function startAssault(w, G, how, units) {
  if (G.outcome) return "it is over";
  const drawn = formUp(w, G, how, units);
  const plan = G.assaultPlan ? G.assaultPlan(w, G, how, units) : null;
  if (drawn) note(w, G, { kind: "formup", kicker: "Before dawn", text: `In the dark ${drawn.n} of ${G.names.side(G.att)} file forward and lie down ${drawn.where}, a long bowshot from the wall`, good: G.att, x: drawn.x, y: drawn.y, sal: 0.5 });
  if (plan && typeof plan === "string") return plan;
  G.assault = { on: true, t0: w.time, day: dayOf(w, G), how, n0: menOf(w, G, G.att), wave: 1, def0: menOf(w, G, G.def) };
  G.stats.assaults++;
  note(w, G, { kind: "assault", kicker: "The assault!", text: `Trumpets in the camp: ${G.names.side(G.att)} come on against ${G.name}${how === "breach" ? " at the breach" : how === "gate" ? " at the gate" : how === "escalade" ? " with ladders" : ""}`, good: G.att, x: C_(G).x, y: C_(G).y, sal: 0.95 });
  return null;
}
const C_ = (G) => G.castle;
// A storm was not begun from the camp, a quarter of a mile off: the stormers were drawn up in the night in the trenches
// and behind the mantlets opposite their objective, and went in at first light. So when the assault is sounded, the
// companies that will go in (and the bows) are put on a start line ~95 m before the stretch they will storm — the
// walk there is done in the dark, off the clock, as a day's walking is when days pass (settle). Nobody in contact moves.
const FORM_M = 95;
export function formUp(w, G, how, units) {
  const C = G.castle, A = G.ai[G.att], open = breaches(G, "outer").filter((q) => !q.plug?.done);
  const gate = C.gates.find((g) => g.ring === "outer" && !g.ruin && !g.waterSide);
  let p, n;
  if ((how === "all" || how === "breach") && open.length) { const q = open[0], g = secGeom(G, q.b); p = modPoint(G, q.b, q.k); n = [g.nx, g.ny]; }
  else if (how === "gate" && gate) { const q = gateGeomOut(G, gate); p = q; n = [q.nx, q.ny]; }
  else { const b = w.buildings.find((q) => q.id === A.target) || pickBombardSection(w, G); if (!b) return null; const g = secGeom(G, b); p = { x: g.x, y: g.y }; n = [g.nx, g.ny]; }
  const S = w.S, list = (units || G.units[G.att]).filter((u) => u.members.length && !u.esc && u.state !== "routing" && !["post", "guard", "miners", "works", "engine", "horse"].includes(u.role) && !ARMS[u.arm].engine && !ARMS[u.arm].mounted && !(u.c?.contactT >= 0 && w.time - (u.c.lastContact ?? u.c.contactT) < 10));
  const far = list.filter((u) => Math.hypot(u.ax - p.x, u.ay - p.y) > FORM_M + 40);
  if (!far.length) return null;
  const lx = -n[1], ly = n[0]; let moved = 0, k = 0;
  const foot = far.filter((u) => !ARMS[u.arm].missile), bows = far.filter((u) => ARMS[u.arm].missile);
  const place = (u, d, lat) => {
    let tx = p.x + n[0] * d + lx * lat, ty = p.y + n[1] * d + ly * lat;
    if (w.map.water && w.map.water(tx, ty) > 0.3) return; // (not into the river)
    if (insideCastle(w, G, tx, ty)) return;
    const dx = tx - u.ax, dy = ty - u.ay;
    for (const id of u.members) if (S.alive[id]) { S.x[id] += dx; S.y[id] += dy; S.vx[id] = S.vy[id] = 0; S.facing[id] = Math.atan2(-n[1], -n[0]); }
    u.ax = tx; u.ay = ty; u.path = null; u.facing = Math.atan2(-n[1], -n[0]) - Math.PI / 2; u.finalFacing = Math.atan2(-n[1], -n[0]);
    u.order = { kind: "hold", x: tx, y: ty, facing: u.finalFacing }; moved += u.members.length;
  };
  foot.forEach((u) => { const lat = ((k % 5) - 2) * 36, row = Math.floor(k / 5); place(u, FORM_M + row * 28, lat); k++; });
  bows.forEach((u, i) => place(u, FORM_M + 35 + Math.floor(i / 5) * 25, ((i % 5) - 2) * 40));
  if (w.siege) w.siege.prev = null; // (siege.js barrierResolve: not steps through a wall)
  if (!moved) return null;
  const sec = open.length && (how === "all" || how === "breach") ? `before the breach in ${open[0].b.label}` : how === "gate" && gate ? `before ${gate.label}` : `before ${nearestSection(G, p.x, p.y)?.label || "the walls"}`;
  return { n: moved, where: sec, x: p.x + n[0] * FORM_M, y: p.y + n[1] * FORM_M };
}
export function callOff(w, G, team) {
  if (!G.assault?.on) return "there is no assault to call off";
  G.assault.on = false; G.assault.failed = true;
  const back = G.camp;
  for (const u of G.units[G.att]) { if (!u.members.length || u.role === "post" || ARMS[u.arm].engine && u.engine !== undefined && SG.engineOf(w, u)?.kind !== "ram" && SG.engineOf(w, u)?.kind !== "siege_tower") continue; if (Math.hypot(u.ax - G.castle.x, u.ay - G.castle.y) < 300 || u.esc) { u.esc = null; issueOrder(w, [u.id], { kind: "move", x: back.x + (w.rng.next() - 0.5) * 120, y: back.y + (w.rng.next() - 0.5) * 120, pace: "quick", facing: G.castle.facing + Math.PI }); if (u.role === "assault") u.role = "foot"; } }
  G.stats.failed++;
  note(w, G, { kind: "recall", kicker: "The assault fails", text: `The trumpets sound the recall: ${G.names.side(G.att)} fall back to their lines`, good: G.def, sal: 0.85, x: G.castle.x, y: G.castle.y });
  return null;
}
// fall back to the keep: the gate of the refuge is opened for them (siege.js shuts every gate with the enemy near;
// b.forcedOpen holds it open) and shut again once they are in
export function fallBack(w, G, units) {
  const K = G.castle.keep; if (!K) return "there is no keep";
  const us = units || G.units[G.def].filter((u) => u.members.length && !inKeep(G, u.ax, u.ay));
  if (K.gate) { K.gate.forcedOpen = true; G.keepOpenUntil = w.time + 60; }
  if (G.api?.toKeep && G.castle.real) { try { G.api.toKeep(w, us.map((u) => u.id), G.castle.real); } catch { /* fallback */ } }
  const into = K.gate ? gateGeomOut(G, K.gate) : null;
  us.forEach((u, i) => {
    if (G.castle.real) issueOrder(w, [u.id], { kind: "keep", x: K.x, y: K.y, castle: G.castle.real, pace: "quick" });
    if (!G.castle.real || !u.pendingOrder && u.order?.kind !== "keep") {
      const a = i * 2.4, r = K.ward ? 14 : Math.max(2, K.r * 0.45);
      const p = { x: K.x + Math.cos(a) * r, y: K.y + Math.sin(a) * r };
      applyOrder(w, u, { kind: "move", x: p.x, y: p.y, pace: "quick", facing: G.castle.facing });
      if (into) u.path = [[into.x + into.nx * 6, into.y + into.ny * 6], [into.x - into.nx * 4, into.y - into.ny * 4], [p.x, p.y]];
    }
    u.role = "keep"; u.manning = null;
  });
  if (units && units.length && !G.fellBack) { // (a few companies — or the lord — sent in by hand: the curtain is still held)
    note(w, G, { kind: "order", kicker: K.ward ? "To the inner ward" : "To the keep", text: `${us.reduce((n, u) => n + u.members.length, 0)} of ${G.names.side(G.def)} go into ${K.ward ? "the inner ward" : "the keep"}`, good: -1, x: K.x, y: K.y, sal: 0.3 });
    return null;
  }
  G.fellBack = true;
  note(w, G, { kind: "fallback", kicker: "To the keep!", text: `${cap(G.names.side(G.def))} give up the curtain and fall back to ${K.ward ? "the inner ward" : "the keep"}`, good: G.att, x: K.x, y: K.y, sal: 0.85, once: "fallback" });
  return null;
}
// a sally: out by the gate (opened for them) at the enemy's engines — torches to the timber — and back
export function sally(w, G, units, o) {
  if (!units.length) return "choose the men who will go out";
  if (SWK.startSally) { // siege-works.js: out by the postern (or the gate, held open), torches to the engine, and back
    let tgt = null, bd = Infinity; for (const e of w.siege?.engines || []) { if (e.team !== G.att || e.state === "burnt") continue; const d = Math.hypot(e.x - (o.x ?? G.camp.x), e.y - (o.y ?? G.camp.y)); if (d < bd) { bd = d; tgt = e; } }
    const p = tgt ? { x: tgt.x, y: tgt.y } : { x: o.x, y: o.y }; if (!Number.isFinite(p.x)) return "no target";
    for (const u of units) { applyOrder(w, u, { kind: "sally", x: p.x, y: p.y }); u.role = "sally"; u.manning = null; }
    G.stats.sallies++;
    note(w, G, { kind: "sallyorder", kicker: "A sally", text: `${units.reduce((s, u) => s + u.members.length, 0)} of the garrison make ready to go out with torches at ${tgt ? "the " + ARMS[tgt.kind].name.toLowerCase() : "the lines"}`, good: G.def, sal: 0.5 });
    return null;
  }
  const gate = G.castle.gates.find((g) => g.ring === "outer" && !g.ruin); if (!gate) return "no gate to go out by";
  let tgt = null, bd = Infinity;
  for (const e of w.siege?.engines || []) { if (e.team !== G.att || e.state === "burnt") continue; const d = Math.hypot(e.x - (o.x ?? G.camp.x), e.y - (o.y ?? G.camp.y)); if (d < bd) { bd = d; tgt = e; } }
  const p = tgt ? { x: tgt.x, y: tgt.y } : { x: o.x, y: o.y };
  if (!Number.isFinite(p.x)) return "no target";
  gate.forcedOpen = true; G.sallyUntil = w.time + 150; G.sallyGate = gate;
  const q = gateGeomOut(G, gate);
  for (const u of units) { applyOrder(w, u, { kind: "assault", x: p.x, y: p.y, pace: "quick" }); u.path = [[q.x - q.nx * 6, q.y - q.ny * 6], [q.x + q.nx * 8, q.y + q.ny * 8], [p.x, p.y]]; u.role = "sally"; u.sallyHome = { x: q.x - q.nx * 14, y: q.y - q.ny * 14, via: q }; u.manning = null; }
  G.stats.sallies++;
  note(w, G, { kind: "sally", kicker: "A sally!", text: `The gate swings open and ${units.reduce((s, u) => s + u.members.length, 0)} of the garrison run out with torches at ${tgt ? "the " + ARMS[tgt.kind].name.toLowerCase() : "the lines"}`, good: G.def, x: q.x, y: q.y, sal: 0.8 });
  return null;
}

// ─────────────────────────────────────────────────────────────── the state for the UI
export function siegeStatus(w, G) {
  const C = G.castle, day = dayOf(w, G), gN = menOf(w, G, G.def), aN = menOf(w, G, G.att);
  const secs = C.sections.map((b) => ({ id: b.id, label: b.label, ring: b.ring, mods: b.mods ? [...b.mods].map((v) => v / (b.hpMax / b.mods.length)) : [b.hp / b.hpMax], ruin: b.ruin, breaches: breachesOf(b).length, plugged: breachesOf(b).filter((k) => barricadeAt(w, b, k)?.state === "up").length, target: G.ai[G.att].target === b.id, x: b.x, y: b.y }));
  const gates = C.gates.map((g) => ({ id: g.id, label: g.label, ring: g.ring, hp: g.hp / g.hpMax, broken: !!g.gateBroken, open: !!g.forcedOpen, shut: !!g.shut, x: g.x, y: g.y }));
  const mines = minesOf(w, G).map((m) => ({ id: m.id, label: m.b?.label || "the wall", state: m.state, prog: m.state === "digging" ? m.dug / m.len * 0.7 : m.state === "chamber" ? 0.7 + 0.3 * m.prog : 1, heard: m.heard, known: m.heard || G.att === G.PLAYER || m.state === "done", why: m.why, x: m.hx, y: m.hy }));
  const barricades = (w.siege?.works?.barricades || []).filter((q) => q.team === G.def).map((q) => ({ id: q.id, state: q.state, prog: q.prog, hp: q.hp, status: q.status, label: w.buildings.find((b) => b.id === q.bid)?.label }));
  const engines = (w.siege?.engines || []).filter((e) => e.state !== "burnt").map((e) => ({ id: e.id, kind: e.kind, team: e.team, state: e.state, info: SG.engineInfo ? SG.engineInfo(w, e) : null, x: e.x, y: e.y }));
  return {
    day, phase: G.phase, name: G.name, layout: C.layout, garrison: gN, garrison0: G.roster.start[G.def] + G.roster.added[G.def], besiegers: aN, besiegers0: G.roster.start[G.att] + G.roster.added[G.att],
    food: G.food, foodDays: gN ? G.food / gN : Infinity, hunger: G.hunger, secs, gates, mines, barricades, engines, works: G.works.map((q) => ({ ...q })), ladders: w.teams[G.att].store?.ladders || 0,
    relief: G.relief ? { day: G.relief.day, known: G.relief.known } : null, will: G.will, assault: G.assault, outcome: G.outcome, terms: G.terms, stats: G.stats, now: G.now || {},
  };
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const angDiff = (a, b) => { let d = (a - b) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
export function compass(a) { const k = Math.round((((a * 180 / Math.PI) % 360 + 360) % 360) / 45) % 8; return ["east", "north-east", "north", "north-west", "west", "south-west", "south", "south-east"][k]; } // (sim +y is north)
