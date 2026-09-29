// Town plans: players don't drop buildings anywhere — a medieval vill grows on a PLAN.
// From maps/<map>/settlements.json each town gets slots:
//   toft   – the house plot on the lane: cottages and small crafts
//   croft  – the long back plot behind it: big yards (barracks, stables, butts, granary…)
//   green  – the village green: market (and a well)
//   church – the churchyard: church & infirmary
//   mill   – the mill site on the stream
//   wall   – a stretch of the planned wall circuit (palisade → stone); gate slots where roads cross
//   tower  – a corner of the circuit: watchtower / mage tower
// Camps (lumber, mining, charcoal, bloomery) are the exception: they must go beside what they work.
// Deterministic, shared by the player UI and the AI general.

export const SLOT_KINDS = {
  toft: ["house", "blacksmith", "fletcher", "weaver"],
  croft: ["barracks", "stables", "archery_range", "granary", "paddock", "siege_workshop"],
  green: ["market"],
  church: ["temple"],
  mill: ["mill"],
  wall: ["palisade", "stone_wall"],
  gate: ["gate", "gatehouse"],
  tower: ["watchtower", "mage_tower"],
  field: ["field"],
  yard: ["barracks", "stables", "archery_range", "granary", "paddock", "siege_workshop", "market", "temple", "mage_tower", "blacksmith", "fletcher", "weaver", "watchtower", "house"],
};
// The order a vill grows in. Each stage opens when the one before it has what it `needs` (completed).
export const STAGES = [
  { name: "Hamlet", kinds: ["house", "field", "lumber_camp", "mining_camp", "charcoal_kiln", "granary"], needs: {} },
  { name: "Village", kinds: ["palisade", "gate", "mill", "market", "temple", "weaver"], needs: { house: 4, granary: 1 } },
  { name: "Stockaded village", kinds: ["barracks", "archery_range", "stables", "paddock", "blacksmith", "fletcher", "bloomery", "siege_workshop"], needs: { palisade: 6, gate: 1 } },
  { name: "Town", kinds: ["stone_wall", "watchtower", "gatehouse", "mage_tower"], needs: { barracks: 1, blacksmith: 1, house: 10 } },
];
export const stageOfKind = (kind) => Math.max(0, STAGES.findIndex((st) => st.kinds.includes(kind)));
export function stageStatus(w, team) {
  const have = {};
  for (const b of w.buildings) if (b.team === team && b.progress >= 1 && !b.ruin) have[b.kind] = (have[b.kind] || 0) + 1;
  let reached = 0;
  for (let i = 1; i < STAGES.length; i++) { if (Object.entries(STAGES[i].needs).every(([k, n]) => (have[k] || 0) >= n)) reached = i; else break; }
  const next = STAGES[reached + 1];
  const missing = next ? Object.entries(next.needs).map(([k, n]) => ({ kind: k, have: have[k] || 0, need: n })) : [];
  return { reached, name: STAGES[reached].name, next: next?.name, missing, have };
}
export const unlocked = (w, team, kind) => stageOfKind(kind) <= stageStatus(w, team).reached;

// kinds placed next to a resource instead of on a slot: kind → node resource types it serves, max distance
export const NEAR_RESOURCE = {
  lumber_camp: { res: ["timber", "wood"], d: 90 },
  charcoal_kiln: { res: ["timber", "wood"], d: 120 },
  mining_camp: { res: ["stone", "ore", "silver", "gold", "iron"], d: 90 },
  bloomery: { res: ["ore", "iron"], d: 140 },
};

const centroid = (poly) => { let x = 0, y = 0; for (const [a, b] of poly) { x += a; y += b; } return [x / poly.length, y / poly.length]; };
const dims = (poly) => { const e = (i, j) => Math.hypot(poly[j][0] - poly[i][0], poly[j][1] - poly[i][1]); return [(e(0, 1) + e(2, 3)) / 2, (e(1, 2) + e(3, 0)) / 2]; };

export function buildPlan(team, town, fields = []) {
  const slots = []; let n = 0;
  const add = (type, x, y, rot, w, h, extra = {}) => slots.push({ id: `${town.id || "t" + team}_${type}_${n++}`, team, type, x, y, rot, w, h, kinds: SLOT_KINDS[type], taken: null, ...extra });
  for (const p of town.plots || []) {
    if (p.toft) { const [cx, cy] = centroid(p.toft); const [a, b] = dims(p.toft); add("toft", p.house?.x ?? cx, p.house?.y ?? cy, p.house?.rot ?? 0, a, b); }
    if (p.croft) {
      const [cx, cy] = centroid(p.croft); const [a, b] = dims(p.croft);
      const ang = Math.atan2(p.croft[1][1] - p.croft[0][1], p.croft[1][0] - p.croft[0][0]); // long axis orientation
      add("croft", cx, cy, b > a ? ang + Math.PI / 2 : ang, a, b);
    }
  }
  if (town.green?.poly) { const [cx, cy] = centroid(town.green.poly); add("green", cx, cy, 0, 30, 30); }
  if (town.church?.churchyard) { const [cx, cy] = centroid(town.church.churchyard); add("church", town.church.x ?? cx, town.church.y ?? cy, town.church.rot || 0, 30, 30); }
  if (town.mill) add("mill", town.mill.x, town.mill.y, town.mill.rot || 0, 14, 14);
  const E = town.enceinte;
  if (E?.poly?.length > 2) {
    const pts = E.poly, gates = E.gates || [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1], L = Math.hypot(x2 - x1, y2 - y1);
      const parts = Math.max(1, Math.round(L / 45)); // circuit in ~45 m stretches (one work gang's job)
      for (let k = 0; k < parts; k++) {
        const t0 = k / parts, t1 = (k + 1) / parts;
        const ax = x1 + (x2 - x1) * t0, ay = y1 + (y2 - y1) * t0, bx = x1 + (x2 - x1) * t1, by = y1 + (y2 - y1) * t1;
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        const gate = gates.find((g) => Math.hypot(g.xy[0] - mx, g.xy[1] - my) < L / parts / 2 + 6);
        if (gate) add("gate", gate.xy[0], gate.xy[1], gate.rot || Math.atan2(by - ay, bx - ax), 12, 10, { road: gate.road, x1: ax, y1: ay, x2: bx, y2: by });
        else add("wall", mx, my, Math.atan2(by - ay, bx - ax), L / parts, 3, { x1: ax, y1: ay, x2: bx, y2: by });
      }
      if (i % 3 === 0) add("tower", x1, y1, 0, 8, 8);
    }
  }
  for (const f of fields) add("field", f.x, f.y, 0, f.w, f.h);
  const kept = tidy(slots, town);
  // plus many free building spots inside the circuit (or around the keep), facing the keep — any
  // may be used; placing a building blocks every spot it covers
  const ring = E?.poly?.length > 2 ? E.poly : null, [cx, cy] = town.site || [town.hall?.x || 0, town.hall?.y || 0];
  const inside = (x, y) => { if (!ring) return Math.hypot(x - cx, y - cy) < 260; let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const busy = kept.filter((q) => q.x1 === undefined && q.type !== "field").map((q) => corners(q, -1));
  const blocks = [town.hall?.curia, town.church?.churchyard].filter((p) => p?.length >= 4).map((p) => p.slice(0, 4));
  for (let y = cy - 320; y <= cy + 320; y += 20) for (let x = cx - 320; x <= cx + 320; x += 20) {
    const jx = x + ((Math.sin(x * 12.9 + y * 78.2) * 43758.5) % 1) * 6, jy = y + ((Math.sin(x * 39.3 + y * 11.1) * 24634.6) % 1) * 6;
    if (!inside(jx, jy)) continue;
    const rot = Math.atan2(cy - jy, cx - jx) + Math.PI / 2; // long side faces the keep
    const q = { type: "yard", x: jx, y: jy, rot, w: 18, h: 14 };
    const C = corners(q, 0);
    if (busy.some((B) => overlap(C, B)) || blocks.some((B) => overlap(C, B))) continue;
    add("yard", jx, jy, rot, 18, 14);
  }
  return { team, town, slots: kept.concat(slots.filter((q) => q.type === "yard")) };
}

// A clean plan: no plot may overlap another (tofts first, then crofts, then the rest), nor the keep's
// court or the churchyard. Rectangles are compared with the separating-axis test.
function corners(s, inset = 0) {
  const c = Math.cos(s.rot || 0), n = Math.sin(s.rot || 0), hw = Math.max(0.5, s.w / 2 - inset), hh = Math.max(0.5, s.h / 2 - inset);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([a, b]) => [s.x + a * c - b * n, s.y + a * n + b * c]);
}
function overlap(A, B) {
  for (const P of [A, B]) for (let i = 0; i < 4; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % 4], ax = -(y2 - y1), ay = x2 - x1;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, y] of A) { const d = x * ax + y * ay; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const [x, y] of B) { const d = x * ax + y * ay; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 <= b0 || b1 <= a0) return false;
  }
  return true;
}
function tidy(slots, town) {
  const blocks = [];
  const poly4 = (p) => p && p.length >= 4 ? p.slice(0, 4) : null;
  if (town.hall?.curia) blocks.push(poly4(town.hall.curia));
  if (town.church?.churchyard) blocks.push(poly4(town.church.churchyard));
  const order = ["church", "green", "mill", "toft", "croft", "tower", "gate", "wall", "field"];
  const kept = [];
  for (const type of order) for (const s of slots.filter((q) => q.type === type)) {
    if (s.x1 !== undefined || type === "field" || type === "tower") { kept.push(s); continue; } // lines & fields handled by their own siting
    const C = corners(s, 0.6);
    if (type !== "church" && blocks.some((B) => B && overlap(C, B))) continue;
    if (kept.some((k) => k.x1 === undefined && k.type !== "field" && k.type !== "tower" && overlap(C, corners(k, 0.6)))) continue;
    kept.push(s);
  }
  return kept;
}

// slots a kind may use (for the UI highlight and the AI)
export const slotsFor = (plan, kind) => plan.slots.filter((s) => s.kinds.includes(kind));

// nearest free slot for `kind` near (x,y) within maxD; null if none
export function snapSlot(plan, kind, x, y, maxD = 45) {
  let best = null, bd = maxD;
  for (const s of slotsFor(plan, kind)) {
    if (s.taken && !(kind === "stone_wall" && s.takenKind === "palisade")) continue; // stone may replace a palisade stretch
    const d = s.x1 !== undefined ? segDist(x, y, s) : Math.hypot(s.x - x, s.y - y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
function segDist(px, py, s) {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / l2));
  return Math.hypot(px - (s.x1 + dx * t), py - (s.y1 + dy * t));
}

// resource-bound kinds: a spot by the nearest suitable node
export function nearResourceSpot(w, team, kind, x, y) {
  const rule = NEAR_RESOURCE[kind]; if (!rule) return null;
  let best = null, bd = Infinity;
  for (const n of w.resources || []) {
    if (!rule.res.includes(n.res) || n.amount <= 0) continue;
    const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = n; }
  }
  if (!best) return null;
  const d = Math.hypot(x - best.x, y - best.y);
  if (d <= rule.d) return { x, y, node: best };
  const k = rule.d * 0.8 / (d || 1); // pull the spot to within reach of the node
  return { x: best.x + (x - best.x) * k, y: best.y + (y - best.y) * k, node: best };
}

export function markTaken(plan, slot, b) { slot.taken = b.id; slot.takenKind = b.kind; b.slot = slot.id; }

// ---------------------------------------------------------------- placement (player UI and AI general)
import * as EC from "./economy.js";
import { buildEffects } from "./land.js";
const CROP_ROTATION = ["wheat", "barley", "oats", "peas", "wheat", "fallow"];

// Place `kind` on the team's plan near (x,y). Returns { b } or { error }.
export function placeOnPlan(w, team, kind, x, y, { crop = null } = {}) {
  const plan = w.plans?.[team]; const T = w.teams[team];
  if (!unlocked(w, team, kind)) { const st = stageStatus(w, team); return { error: `not yet — ${STAGES[stageOfKind(kind)].name} stage needs ${st.missing.map((m) => `${m.need} ${m.kind}`).join(", ")}` }; }
  if (NEAR_RESOURCE[kind]) {
    const spot = nearResourceSpot(w, team, kind, x, y);
    if (!spot) return { error: `no ${NEAR_RESOURCE[kind].res[0]} to work nearby` };
    if (!EC.canAfford(T, EC.costOf(kind))) return { error: "not enough materials" };
    const b = EC.placeBuilding(w, team, kind, spot.x, spot.y, 0, false);
    return b ? { b } : { error: "can't build there" };
  }
  if (!plan) return { error: "no town plan" };
  const slot = snapSlot(plan, kind, x, y, kind === "field" ? 200 : 45);
  if (!slot) return { error: "no free plot for that here — build on the highlighted plots" };
  let b = null;
  if (kind === "palisade" || kind === "stone_wall") {
    if (!EC.canAfford(T, EC.costOf(kind, Math.hypot(slot.x2 - slot.x1, slot.y2 - slot.y1)))) return { error: "not enough materials for that stretch" };
    if (slot.taken) { const old = w.buildings.find((o) => o.id === slot.taken); if (old) old.replaced = true, w.buildings.splice(w.buildings.indexOf(old), 1); }
    b = EC.placeWall(w, team, kind, slot.x1, slot.y1, slot.x2, slot.y2, false);
  } else if (kind === "field") {
    const fields = w.buildings.filter((o) => o.team === team && o.field).length; // (counted before this one is laid out)
    b = EC.placeBuilding(w, team, "field", slot.x, slot.y, 0, true);
    if (b) {
      const late = Math.max(0, Math.min(1, (w.econ.doy - 100) / 80)); // sown after mid-April → thinner crop
      EC.initField(b, crop || CROP_ROTATION[fields % CROP_ROTATION.length], slot.w, slot.h, late);
      const fx = buildEffects(w.map, "field", slot.x, slot.y); // the soil decides the harvest
      b.field.left *= fx.yieldMul; b.field.yieldKgHa *= fx.yieldMul; b.land = { key: fx.land.key, lines: fx.lines };
    }
  } else {
    if (!EC.canAfford(T, EC.costOf(kind))) return { error: "not enough materials" };
    b = EC.placeBuilding(w, team, kind, slot.x, slot.y, slot.rot || 0, false);
    if (b && (kind === "gate" || kind === "gatehouse") && slot.x1 !== undefined) Object.assign(b, { gx1: slot.x1, gy1: slot.y1, gx2: slot.x2, gy2: slot.y2 }); // the gate closes its whole stretch of the circuit
  }
  if (!b) return { error: "can't build there" };
  markTaken(plan, slot, b);
  // every other spot this building's footprint covers is gone
  if (b.x1 === undefined && !b.field) {
    const fp = EC.BUILDINGS[kind]?.footprint || [10, 8], C = corners({ x: b.x, y: b.y, rot: b.rot || 0, w: fp[0], h: fp[1] }, -1);
    for (const q of plan.slots) if (!q.taken && q.x1 === undefined && q.type !== "field" && overlap(C, corners(q, 0.6))) { q.taken = b.id; q.takenKind = kind; }
  }
  return { b, slot };
}

// The AI's choice: nearest free slot to a point (the hall, a resource, the enemy side for walls)
export function bestSlot(w, team, kind, near) {
  const plan = w.plans?.[team]; if (!plan) return null;
  let best = null, bd = Infinity;
  for (const s of slotsFor(plan, kind)) {
    if (s.taken && !(kind === "stone_wall" && s.takenKind === "palisade")) continue;
    const d = Math.hypot(s.x - near.x, s.y - near.y); if (d < bd) { bd = d; best = s; }
  }
  return best;
}
