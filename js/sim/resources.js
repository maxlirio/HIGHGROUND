import { terrainAt } from "./landread.js";
// Map resource nodes: w.resources = [{ id, res, x, y, amount, kind, r }].
// Sources, in order: maps/<name>/objects.json (placed by the map agent: trees, rocks, ore…),
// then the terrain table's forage.wood (if the map has a surface grid), then procedural
// placeholders near each town + on the map's named features, so everything is testable.
// Amounts are finite: nodes DEPLETE (a hectare of mature oak ≈ 250 t of usable timber).
import { makeRng } from "./rng.js";

export const NODE_KINDS = {
  wood:        { res: "timber", alt: "firewood", r: 45, label: "Woodland" },
  coppice:     { res: "firewood", alt: "timber", r: 35, label: "Coppice" },
  quarry:      { res: "stone", r: 25, label: "Quarry face" },
  bog_iron:    { res: "ore", r: 30, label: "Bog-iron bed" },
  fishery:     { res: "fresh", r: 30, label: "Fishing water" },
  ley:         { res: "mana", r: 12, label: "Ley site" },
  silver_vein: { res: "silver", r: 15, label: "Lead-silver working" },
  clay_pit:    { res: "clay", r: 20, label: "Clay pit" },
  gold_vein:   { res: "gold", r: 12, label: "Gold stringer" },
  hunt:        { res: "fresh", r: 60, label: "Game (deer, fowl)" },
  forage:      { res: "fresh", r: 25, label: "Forage (berries, nuts)" },
};
// res → node kind for map objects that declare { category: 'resource', res, amount }
const KIND_BY_RES = { timber: "wood", firewood: "coppice", stone: "quarry", ore: "bog_iron", fresh: "fishery", mana: "ley", silver: "silver_vein", gold: "gold_vein", clay: "clay_pit" };

// kg (or d / mana units) per object when loading individual props from objects.json
const PER_OBJECT = { gold_vein: 1000, hunt: 2000, forage: 500, wood: 1200, coppice: 600, quarry: 25000, bog_iron: 4000, fishery: 3000, ley: 400, silver_vein: 2500, clay_pit: 30000 };

export function classifyObject(o) {
  if (o.category === "structure") return null; // placed models (houses, fences, standing stones…) are not nodes
  const s = `${o.kind || ""} ${o.type || ""} ${o.name || ""} ${o.asset || ""} ${o.model || ""} ${o.res || ""}`.toLowerCase();
  if (/silver|lead/.test(s)) return "silver_vein";
  if (/\bore\b|iron|bog_?iron|ironstone/.test(s)) return "bog_iron";
  if (/ley|standing|menhir|mana|circle|dolmen|shrine/.test(s)) return "ley";
  if (/fish|weir/.test(s)) return "fishery";
  if (/clay/.test(s)) return "clay_pit";
  if (/coppice|hazel|willow|scrub/.test(s)) return "coppice";
  if (/oak|ash|beech|birch|pine|yew|elm|alder|tree|wood|forest|timber/.test(s)) return "wood";
  if (/rock|boulder|stone|crag|quarry|outcrop|scree/.test(s)) return "quarry";
  return null;
}

// objects.json may be an array or { objects|items|props|features|instances: [...] }, and each
// entry may give a position as x,y / xy_m:[x,y] / pos|position:[x,y,(z)] (world metres, +y north).
export function nodesFromObjects(json, cluster = 70) {
  const list = Array.isArray(json) ? json : json.objects || json.items || json.props || json.instances || json.features || [];
  const cells = new Map(), out = [];
  for (const o of list) {
    // declared resource nodes (settle_vale.py): one node each, amounts as given
    if (o.category === "resource" && o.res && isFinite(+o.amount)) {
      const kind = o.kind === "deer_herd" ? "hunt" : o.kind === "forage" ? "forage" : KIND_BY_RES[o.res] || classifyObject(o);
      if (!kind) continue;
      const n = mkNode(kind, +o.x, +o.y, +o.amount, o.id || "objects"); n.res = o.res; n.name = o.id; n.note = o.note; out.push(n);
      continue;
    }
    if (o.category === "structure") continue;
    const kind = classifyObject(o); if (!kind) continue;
    const p = o.xy_m || o.pos || o.position || [o.x, o.y];
    const x = +p[0], y = +p[1]; if (!isFinite(x) || !isFinite(y)) continue;
    const amt = +o.amount || PER_OBJECT[kind] * (+o.scale || 1) * (+o.count || 1);
    const key = `${kind}|${Math.floor(x / cluster)}|${Math.floor(y / cluster)}`;
    let c = cells.get(key); if (!c) cells.set(key, (c = { kind, sx: 0, sy: 0, n: 0, amount: 0 }));
    c.sx += x; c.sy += y; c.n++; c.amount += amt;
  }
  for (const c of cells.values()) out.push(mkNode(c.kind, c.sx / c.n, c.sy / c.n, c.amount, `objects×${c.n}`));
  return out;
}

let nid = 0;
function mkNode(kind, x, y, amount, source = "proc") {
  const K = NODE_KINDS[kind];
  return { id: 0, kind, res: K.res, x, y, amount, start: amount, r: K.r, source };
}

// Load resources for a world. `objectsJson` is the parsed maps/<name>/objects.json or null.
// towns = [{x,y}] (home sites) so placeholders are plausible and fair.
export function setupResources(w, { objectsJson = null, towns = [], seed = 99 } = {}) {
  const nodes = [];
  if (objectsJson) nodes.push(...nodesFromObjects(objectsJson));
  const have = (kind) => nodes.some((n) => n.kind === kind);
  if (!have("wood") && w.map.surface) nodes.push(...woodsFromSurface(w));
  if (!objectsJson || nodes.length < 6) nodes.push(...procedural(w, towns, seed, nodes));
  nodes.forEach((n, i) => (n.id = i + 1));
  w.resources = nodes;
  return nodes;
}

function woodsFromSurface(w) {
  const map = w.map, out = [], step = 100;
  for (let y = step / 2; y < map.size; y += step) for (let x = step / 2; x < map.size; x += step) {
    const t = terrainAt(w, x, y); const tph = t?.forage?.wood || 0;
    if (tph >= 20) out.push(mkNode(tph >= 60 ? "wood" : "coppice", x, y, tph * 1000 * 1.0, "surface")); // t/ha × 1 ha
  }
  return out;
}

function land(map, x, y) { return map.inBounds(x, y) && map.water(x, y) < 0.05 && Math.hypot(...map.grad(x, y)) < 0.35; }

function procedural(w, towns, seed, existing) {
  const map = w.map, rng = makeRng(seed), out = [];
  const near = (x, y, d) => [...existing, ...out].some((n) => Math.hypot(n.x - x, n.y - y) < d);
  const tryPlace = (kind, cx, cy, r0, r1, amount, test = land, tries = 60) => {
    for (let k = 0; k < tries; k++) {
      const a = rng.next() * Math.PI * 2, r = r0 + (r1 - r0) * rng.next();
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (!test(map, x, y) || near(x, y, 120)) continue;
      out.push(mkNode(kind, x, y, amount)); return true;
    }
    return false;
  };
  // nearest qualifying spot along 32 rays (narrow rivers defeat random sampling)
  const rayPlace = (kind, t, rMax, amount, test) => {
    let best = null;
    for (let a = 0; a < 32; a++) for (let r = 120; r < rMax; r += 20) {
      const x = t.x + Math.cos(a / 32 * 6.283) * r, y = t.y + Math.sin(a / 32 * 6.283) * r;
      if (test(map, x, y)) { if (!best || r < best.r) best = { x, y, r }; break; }
    }
    if (best && !near(best.x, best.y, 60)) { out.push(mkNode(kind, best.x, best.y, amount)); return true; }
    return false;
  };
  for (const t of towns) {
    // Every vill had its woods, a stone source, and a pond or stream within a walk.
    for (let k = 0; k < 4; k++) tryPlace("wood", t.x, t.y, 350, 1100, 220000 + rng.next() * 120000);
    tryPlace("coppice", t.x, t.y, 250, 600, 120000);
    tryPlace("quarry", t.x, t.y, 450, 1100, 900000, (m, x, y) => land(m, x, y) && Math.hypot(...m.grad(x, y)) > 0.06);
    if (!tryPlace("bog_iron", t.x, t.y, 500, 1400, 45000, wetEdge)) rayPlace("bog_iron", t, 1800, 45000, wetEdge);
    if (!tryPlace("fishery", t.x, t.y, 150, 1600, 6000, water)) rayPlace("fishery", t, 1600, 6000, water);
    tryPlace("clay_pit", t.x, t.y, 200, 700, 200000);
  }
  // Named features: shared, contested resources in the middle of the map.
  for (const f of map.meta?.features || []) {
    const [x, y] = f.xy_m || []; if (x === undefined) continue;
    if (f.type === "wooded_valley") { out.push(mkNode("wood", x, y, 900000)); tryPlace("wood", x, y, 150, 400, 400000); }
    if (f.type === "rocky_upland") { tryPlace("quarry", x, y, 100, 500, 2e6); tryPlace("silver_vein", x, y, 50, 400, 6000); }
    if (f.type === "marsh") tryPlace("bog_iron", x, y, 60, 400, 80000, wetEdge);
    if (f.type === "lake") tryPlace("fishery", x, y, 50, 600, 20000, water);
    if (f.type === "motte_hill") out.push(mkNode("ley", x, y, 600));
  }
  // Ley sites: a couple of prominent hilltops (rare).
  if (![...existing, ...out].some((n) => n.kind === "ley")) {
    let best = null, bh = -Infinity;
    for (let k = 0; k < 300; k++) { const x = rng.next() * map.size, y = rng.next() * map.size; const h = map.h(x, y); if (h > bh && land(map, x, y)) { bh = h; best = [x, y]; } }
    if (best) out.push(mkNode("ley", best[0], best[1], 600));
  }
  for (const t of towns) tryPlace("ley", t.x, t.y, 600, 1500, 300, (m, x, y) => land(m, x, y) && m.h(x, y) > m.h(t.x, t.y) + 5, 120);
  return out;
}

function water(map, x, y) { return map.inBounds(x, y) && map.water(x, y) > 0.25 && map.water(x, y) < 4; }
function wetEdge(map, x, y) {
  if (!land(map, x, y)) return false;
  for (let a = 0; a < 8; a++) if (map.water(x + Math.cos(a * 0.785) * 60, y + Math.sin(a * 0.785) * 60) > 0.05) return true;
  return false;
}

export function nearestNode(w, x, y, pred, maxD = Infinity) {
  let best = null, bd = maxD;
  for (const n of w.resources || []) { if (n.amount <= 0 || !pred(n)) continue; const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = n; } }
  return best;
}
