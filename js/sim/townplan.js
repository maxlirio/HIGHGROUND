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
// (2026-10-03) The plan is no longer the only place a building may go: WHERE a building may stand is read from the land and
// the village as it stands (js/sim/siting.js) — placeOnPlan and bestSlot ask it. The plan's free plots are still offered
// (a click near one takes it), and every building placed is recorded on the plan as a "site" plot (b.slot) so the plan
// keeps its books; the walls follow the village's suggested circuit (or a line the player draws), not a fixed one.


export const SLOT_KINDS = {
  toft: ["house", "blacksmith", "fletcher", "weaver"],
  croft: ["barracks", "stables", "archery_range", "granary", "paddock", "siege_workshop"],
  green: ["market"],
  church: ["temple"],
  mill: ["mill"],
  wall: ["palisade", "stone_wall"],
  site: [],  // (a building sited from the land, not on a plot: js/sim/siting.js — the plot is recorded when it is placed)
  gate: ["gate", "gatehouse"],
  tower: ["watchtower", "mage_tower"],
  field: ["field"],
  yard: ["barracks", "stables", "archery_range", "granary", "paddock", "siege_workshop", "market", "temple", "mage_tower", "blacksmith", "fletcher", "weaver", "watchtower", "house"],
};
// The order a vill grows in: js/sim/stages.js (no imports — js/sim/tech.js reads it from low in the import graph)
export { STAGES, stageOfKind, stageStatus, unlocked } from "./stages.js";
import { STAGES, stageOfKind, stageStatus, unlocked } from "./stages.js";

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
    if (p.toft) { const [cx, cy] = centroid(p.toft); const [a, b] = dims(p.toft); add("toft", p.house?.x ?? cx, p.house?.y ?? cy, p.house?.rot ?? 0, town.generated ? Math.min(a - 2, 14) : a, town.generated ? Math.min(b - 4, 12) : b); } // (a plan read from the land, js/sim/settle.js: the plot is the house's own ground on the street front, so its neighbours' plots are not lost to tidy())
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
    // each gate on the ONE edge of the circuit it stands on (the nearest), at its distance along it. (Matching gates to
    // stretches by their midpoints gave a gate near a corner a second, phantom gate on the next edge — its passage
    // clamped into the corner — and a gate on a short edge none at all: 77 of 117 land-read plans, settle.js.)
    const onEdge = pts.map(() => []);
    for (const g of gates) {
      let bi = -1, bd = Infinity, bt = 0;
      for (let i = 0; i + 1 < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[i + 1], dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((g.xy[0] - x1) * dx + (g.xy[1] - y1) * dy) / l2));
        const d = Math.hypot(g.xy[0] - x1 - dx * t, g.xy[1] - y1 - dy * t); if (d < bd - 1e-6) { bd = d; bi = i; bt = t; }
      }
      if (bi < 0 || bd >= 8) continue;
      // (a lane crossing the circuit at a corner: the gate is set along its edge, its passage and flanks clear of the corner)
      const L = Math.hypot(pts[bi + 1][0] - pts[bi][0], pts[bi + 1][1] - pts[bi][1]), t = L >= 14 ? Math.max(7 / L, Math.min(1 - 7 / L, bt)) : 0.5;
      onEdge[bi].push({ g, t, x: pts[bi][0] + (pts[bi + 1][0] - pts[bi][0]) * t, y: pts[bi][1] + (pts[bi + 1][1] - pts[bi][1]) * t });
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1], L = Math.hypot(x2 - x1, y2 - y1);
      const parts = Math.max(1, Math.round(L / 45)); // circuit in ~45 m stretches (one work gang's job)
      // the cuts: equal stretches, but no stretch holds two gates (cut between them) and a gate stands clear of its
      // stretch's ends (its passage and flanks: a cut within 8 m of a gate moves to 8 m off it)
      let cuts = []; for (let k = 0; k <= parts; k++) cuts.push(k / parts);
      const G = onEdge[i].slice().sort((a, b) => a.t - b.t), m = 8 / (L || 1);
      for (let q = 0; q + 1 < G.length; q++) { const tc = (G[q].t + G[q + 1].t) / 2; if (!cuts.some((c) => c > G[q].t && c < G[q + 1].t)) cuts.push(tc); }
      cuts = cuts.map((c) => { if (c <= 0 || c >= 1) return c; for (const { t } of G) if (Math.abs(c - t) < m) { const lo = G.filter((o) => o.t < c).map((o) => o.t).pop() ?? -1, hi = G.find((o) => o.t > c)?.t ?? 2; return c < t ? Math.max(t - m, (lo + t) / 2) : Math.min(t + m, (t + hi) / 2); } return c; });
      cuts = [...new Set(cuts)].filter((c) => c === 0 || c === 1 || (c > 0.5 / (L || 1) && c < 1 - 0.5 / (L || 1))).sort((a, b) => a - b).filter((c, k, A) => k === 0 || c - A[k - 1] > 1e-6);
      for (let k = 0; k + 1 < cuts.length; k++) {
        const t0 = cuts[k], t1 = cuts[k + 1];
        const ax = x1 + (x2 - x1) * t0, ay = y1 + (y2 - y1) * t0, bx = x1 + (x2 - x1) * t1, by = y1 + (y2 - y1) * t1;
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        const o = G.find((q) => q.t >= t0 - 1e-9 && q.t <= t1 + 1e-9 && !q.used), gate = o?.g; if (o) o.used = true;
        if (gate) add("gate", Math.round(o.x * 100) / 100, Math.round(o.y * 100) / 100, gate.rot || Math.atan2(by - ay, bx - ax), 12, 10, { road: gate.road, x1: ax, y1: ay, x2: bx, y2: by });
        else add("wall", mx, my, Math.atan2(by - ay, bx - ax), G.length ? L * (t1 - t0) : L / parts, 3, { x1: ax, y1: ay, x2: bx, y2: by });
      }
      if (i % 3 === 0) add("tower", x1, y1, 0, 8, 8);
    }
  }
  for (const f of fields) add("field", f.x, f.y, f.rot || 0, f.w, f.h);
  const kept = tidy(slots, town);
  // plus many free building spots inside the circuit (or around the keep), facing the keep — any
  // may be used; placing a building blocks every spot it covers
  const ring = E?.poly?.length > 2 ? E.poly : null, [cx, cy] = town.site || [town.hall?.x || 0, town.hall?.y || 0];
  const inside = (x, y) => { if (!ring) return Math.hypot(x - cx, y - cy) < 260; let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const busy = kept.filter((q) => q.x1 === undefined && q.type !== "field").map((q) => corners(q, -1));
  const farm = kept.filter((q) => q.type === "field").map((q) => corners(q, -2));   // nobody builds a cottage on the furlongs
  const blocks = [town.hall?.curia, town.church?.churchyard].filter((p) => p?.length >= 4).map((p) => p.slice(0, 4));
  for (let y = cy - 320; y <= cy + 320; y += 20) for (let x = cx - 320; x <= cx + 320; x += 20) {
    const jx = x + ((Math.sin(x * 12.9 + y * 78.2) * 43758.5) % 1) * 6, jy = y + ((Math.sin(x * 39.3 + y * 11.1) * 24634.6) % 1) * 6;
    if (!inside(jx, jy)) continue;
    const rot = Math.atan2(cy - jy, cx - jx) + Math.PI / 2; // long side faces the keep
    const q = { type: "yard", x: jx, y: jy, rot, w: 18, h: 14 };
    const C = corners(q, 0);
    if (busy.some((B) => overlap(C, B)) || blocks.some((B) => overlap(C, B)) || farm.some((B) => overlap(C, B))) continue;
    add("yard", jx, jy, rot, 18, 14);
  }
  return { team, town, fieldsV: FIELD_PLAN_V, slots: kept.concat(slots.filter((q) => q.type === "yard")) }; // (laid from the furlongs already)
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

// A wall (palisade or stone, built from the plan's circuit or not) runs through any plot it crosses: those plots are
// gone — a house, a yard or a field can't stand astride a wall. Swept whenever the count of standing wall stretches
// changes, so walls raised before this existed (a live realm) are caught on the next placement or AI choice.
const WALL_BAND = 7; // the wall itself plus the ditch and berm before it (m)
function sweepWallSlots(w, team) {
  const plan = w.plans?.[team]; if (!plan) return;
  const walls = w.buildings.filter((b) => b.team === team && b.x1 !== undefined && !b.ruin && (b.kind === "palisade" || b.kind === "stone_wall"));
  if (plan.wallSwept === walls.length) return;
  plan.wallSwept = walls.length;
  for (const b of walls) {
    const len = Math.hypot(b.x2 - b.x1, b.y2 - b.y1);
    const band = corners({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2, rot: Math.atan2(b.y2 - b.y1, b.x2 - b.x1), w: len, h: WALL_BAND });
    for (const q of plan.slots) {
      if (q.taken || q.x1 !== undefined) continue; // (the wall circuit's own stretches and gates keep their slots)
      if (overlap(band, corners(q, 0))) { q.taken = b.id; q.takenKind = "wall"; }
    }
  }
}

// Plans laid before the map's painted furlongs were the source of field plots (a realm house founded before that) still
// carry the old ring of square plots, at angle 0, nowhere near the painted fields. Re-lay them once: every field plot
// not yet used is replaced by the furlong plots economy.fieldSites gives now; a field already laid stays where it is,
// and yard plots the new furlongs cover are retired (nobody builds on the furlongs).
// (v3: fields are drawn, not plotted — js/sim/jobs/fields.js layField: a plan keeps only the field plots a field stands
// on; the free ones go.)
const FIELD_PLAN_V = 3;
export function refreshFieldSlots(w, team) {
  const plan = w.plans?.[team], T = w.teams[team];
  if (!plan || plan.fieldsV === FIELD_PLAN_V || !T?.town) { if (plan) plan.fieldsV = FIELD_PLAN_V; return 0; }
  plan.fieldsV = FIELD_PLAN_V;
  const fieldIds = new Set(w.buildings.filter((b) => b.team === team && b.field).map((b) => b.id));
  const keep = plan.slots.filter((q) => q.type !== "field" || fieldIds.has(q.taken)); // (only plots a field still stands on)
  const used = keep.filter((q) => q.type === "field").map((q) => corners(q, 2));
  const built = w.buildings.filter((b) => b.team === team && !b.field && b.x1 === undefined).map((b) => { const fp = EC.BUILDINGS[b.kind]?.footprint || [10, 8]; return corners({ x: b.x, y: b.y, rot: b.rot || 0, w: fp[0], h: fp[1] }, 0); });
  let n = 0, id = 0;
  for (const f of EC.fieldSites(w, team, T.town.x, T.town.y)) {
    const q = { id: `${plan.town?.id || "t" + team}_field_r${id++}`, team, type: "field", x: f.x, y: f.y, rot: f.rot || 0, w: f.w, h: f.h, kinds: SLOT_KINDS.field, taken: null };
    const C = corners(q, 2);
    if (used.some((B) => overlap(C, B)) || built.some((B) => overlap(C, B))) continue;
    keep.push(q); used.push(C); n++;
    for (const y of keep) if (y.type === "yard" && !y.taken && overlap(C, corners(y, 0))) { y.taken = -1; y.takenKind = "field"; }
  }
  plan.slots = keep;
  return n;
}

// The reeve surveys more furlongs (ai-general.js reeveFields): a vill whose plan holds too little farmland to feed its
// mouths gets new FIELD plots added to its plan, from economy.fieldSites asked for `wantM2` in all — dry, flat open ground
// clear of every standing building, every worked resource, every plot already on the plan and the wall circuit. Nothing
// is demolished and no other plot is touched: the plan only grows. → the number of plots added.
export function surveyFieldSlots(w, team, wantM2) {
  const plan = w.plans?.[team], T = w.teams[team]; if (!plan || !T?.town) return 0;
  refreshFieldSlots(w, team); sweepWallSlots(w, team);
  let have = 0; for (const q of plan.slots) if (q.type === "field") have += q.w * q.h;
  if (have >= wantM2) return 0;
  const used = [];
  for (const q of plan.slots) {
    if (q.x1 === undefined) { used.push(corners(q.w > 0 && q.h > 0 ? q : { x: q.x, y: q.y, rot: q.rot || 0, w: 14, h: 14 }, q.type === "field" ? 2 : 0)); continue; }
    const len = Math.hypot(q.x2 - q.x1, q.y2 - q.y1); // (a wall or gate stretch of the circuit, with its ditch and berm)
    used.push(corners({ x: (q.x1 + q.x2) / 2, y: (q.y1 + q.y2) / 2, rot: Math.atan2(q.y2 - q.y1, q.x2 - q.x1), w: len, h: WALL_BAND * 2 }, 0));
  }
  for (const b of w.buildings) {
    if (b.ruin) continue;
    if (b.field) { used.push(corners({ x: b.x, y: b.y, rot: b.rot || 0, w: b.w, h: b.h }, 2)); continue; }
    if (b.x1 !== undefined) { const len = Math.hypot(b.x2 - b.x1, b.y2 - b.y1); used.push(corners({ x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2, rot: Math.atan2(b.y2 - b.y1, b.x2 - b.x1), w: len, h: WALL_BAND * 2 }, 0)); continue; }
    const fp = EC.BUILDINGS[b.kind]?.footprint || [10, 8]; used.push(corners({ x: b.x, y: b.y, rot: b.rot || 0, w: fp[0] + 6, h: fp[1] + 6 }, 0));
  }
  let n = 0;
  plan.surveyed = plan.surveyed || 0;
  for (const f of EC.fieldSites(w, team, T.town.x, T.town.y, 96, { area: wantM2 })) {
    if (have >= wantM2) break;
    const q = { id: `${plan.town?.id || "t" + team}_field_s${plan.surveyed}`, team, type: "field", x: f.x, y: f.y, rot: f.rot || 0, w: f.w, h: f.h, kinds: SLOT_KINDS.field, taken: null, surveyed: true };
    const C = corners(q, 2);
    if (used.some((B) => overlap(C, B))) continue;
    plan.slots.push(q); used.push(C); have += q.w * q.h; n++; plan.surveyed++;
  }
  return n;
}

// ---------------------------------------------------------------- placement (player UI and AI general)
import * as EC from "./economy.js";
import * as FL from "./jobs/fields.js";
import { buildEffects } from "./land.js";
import * as SI from "./siting.js";
import * as VN from "./veins.js"; // (silver and gold veins: a camp only at one you hold or nobody holds)
import { UPGRADES, upgradeBase, estateBuilt } from "./estates.js";
const CROP_ROTATION = ["wheat", "barley", "oats", "peas", "wheat", "fallow"];

// Place `kind` near (x,y): sited from the land (js/sim/siting.js), on a free plot of the plan when the click is near one.
// Walls: x2/y2 given → the line the player drew (checked against the land); else the suggested circuit's stretch nearest the
// click (a stone wall over a standing palisade near it replaces that palisade). Gates: the suggested circuit's gate stretch
// nearest the click. Returns { b, slot } or { error }.
export function placeOnPlan(w, team, kind, x, y, { crop = null, complete = false, x2 = undefined, y2 = undefined } = {}) { // (complete: standing already, nothing paid — a new foundation's grant: server/world.mjs settleHold)
  refreshFieldSlots(w, team); sweepWallSlots(w, team);
  const plan = w.plans?.[team]; const T = w.teams[team];
  if (!unlocked(w, team, kind)) { const st = stageStatus(w, team), sk = stageOfKind(kind); return { error: sk === st.reached + 1 ? `not yet — ${STAGES[sk].name} stage needs ${st.missing.filter((m) => m.have < m.need).map((m) => `${m.need} ${m.kind}`).join(", ")}` : `not yet — that is a ${STAGES[sk].name} building; your ${st.name} must first become a ${st.next} (it needs ${st.missing.filter((m) => m.have < m.need).map((m) => `${m.need} ${m.kind}`).join(", ")})` }; }
  if (NEAR_RESOURCE[kind]) {
    const spot = nearResourceSpot(w, team, kind, x, y);
    if (!spot) return { error: `no ${NEAR_RESOURCE[kind].res[0]} to work nearby` };
    { const why = VN.campWhy(w, team, spot.node); if (why) return { error: why }; } // (another house's vein: js/sim/veins.js)
    if (w.buildings.some((o) => o.team === team && o.kind === kind && !o.ruin && Math.hypot(o.x - spot.x, o.y - spot.y) < 30)) return { error: `there is a ${kind.replace("_", " ")} here already` };
    if (!EC.canAfford(T, EC.costOf(kind))) return { error: "not enough materials" };
    const r = SI.snapSite(SI.siteContext(w, team), kind, spot.x, spot.y);
    if (!r.ok) return { error: `not there: ${r.why}` };
    const b = EC.placeBuilding(w, team, kind, r.x, r.y, r.rot, false);
    if (b && VN.isVein(spot.node)) VN.claimByCamp(w, team, spot.node); // (a camp staked at a vein nobody holds claims it)
    return b ? { b } : { error: "can't build there" };
  }
  if (kind === "field") { // fields are not plotted: the survey picks a rectangle of good ground near (x, y) and the men make it
    const r = FL.pickFieldRect(w, team, { near: { x, y } }); if (!r) return { error: "no open ground fit to make a field near there" };
    const L = FL.layField(w, team, r, { by: complete ? "grant" : "lord" }); return L.b ? { b: L.b } : { error: L.error };
  }
  if (!plan) return { error: "no town plan" };
  if (SI.WALL_KINDS.has(kind) || SI.GATE_KINDS.has(kind)) return placeWallPiece(w, team, kind, x, y, x2, y2, complete);
  const C = SI.siteContext(w, team), r = SI.snapSite(C, kind, x, y);
  if (!r.ok) return { error: `Not there: ${r.why}` };
  if (!complete && !EC.canAfford(T, EC.costOf(kind))) return { error: "not enough materials" };
  const b = EC.placeBuilding(w, team, kind, r.x, r.y, r.rot, complete);
  if (!b) return { error: "can't build there" };
  if (UPGRADES[kind]) { const base = upgradeBase(w, team, kind, b.x, b.y); if (base) { b.upgradeOf = base.id; if (complete) estateBuilt(w, b); } } // (the shell keep rises on the motte and takes its place when it stands: js/sim/estates.js)
  const slot = r.slot || sitePlot(plan, "site", { x: r.x, y: r.y, rot: r.rot, w: r.w, h: r.h, kinds: [kind] });
  markTaken(plan, slot, b);
  // every free plot this building's footprint covers is gone
  const fp = EC.BUILDINGS[kind]?.footprint || [10, 8], Cn = corners({ x: b.x, y: b.y, rot: b.rot || 0, w: fp[0], h: fp[1] }, -1);
  for (const q of plan.slots) if (!q.taken && q.x1 === undefined && q.type !== "field" && overlap(Cn, corners(q, 0.6))) { q.taken = b.id; q.takenKind = kind; }
  return { b, slot, note: r.note };
}
// a plot recorded on the plan for a building sited from the land (or a wall the circuit or the player laid)
function sitePlot(plan, type, o) {
  plan.sited = (plan.sited || 0) + 1;
  const q = { id: `${plan.town?.id || "t" + plan.team}_${type}_s${plan.sited}`, team: plan.team, type, rot: 0, taken: null, kinds: o.kinds || SLOT_KINDS[type], ...o };
  if (!q.kinds) q.kinds = SLOT_KINDS[type];
  plan.slots.push(q); return q;
}
// has the house begun its plan's own circuit? (a saved town walled on the old fixed circuit may finish it)
const circuitBegun = (plan) => plan.slots.some((q) => (q.type === "wall" || q.type === "gate") && q.taken && !q.sited);
function placeWallPiece(w, team, kind, x, y, x2, y2, complete) {
  const plan = w.plans[team], T = w.teams[team], C = SI.siteContext(w, team), gate = SI.GATE_KINDS.has(kind);
  let line = null, old = null, slot = null;
  if (!gate && Number.isFinite(x2) && Number.isFinite(y2)) { // the player's own line
    const chk = SI.checkWallLine(C, kind, x, y, x2, y2);
    if (!chk.ok) return { error: `No wall there: ${chk.why}` };
    line = [x, y, x2, y2];
  }
  if (!line && kind === "stone_wall") { // stone over the standing palisade nearest the click
    let bd = 8;
    for (const o of w.buildings) if (o.team === team && o.kind === "palisade" && !o.ruin && o.x1 !== undefined) { const d = segD(x, y, o.x1, o.y1, o.x2, o.y2); if (d < bd) { bd = d; old = o; } }
    if (old) line = [old.x1, old.y1, old.x2, old.y2];
  }
  let st = null;
  if (!line) {
    const circ = SI.suggestCircuit(C);
    st = circ.error ? null : SI.stretchNear(circ, x, y, { maxD: 30, gate });
    if (st && st.state === "standing") st = null;
    if (st && st.state === "blocked") return { error: `Not that stretch: ${st.why}` };
    if (st) line = [st.x1, st.y1, st.x2, st.y2];
  }
  if (!line && circuitBegun(plan)) { // (a saved town's old circuit, begun: it may be finished)
    const s = snapSlot(plan, kind, x, y, 20);
    if (s && s.x1 !== undefined) { line = [s.x1, s.y1, s.x2, s.y2]; slot = s; if (s.taken) old = w.buildings.find((o) => o.id === s.taken) || null; }
  }
  if (!line) return { error: gate ? "No gate there: put it on a gate of the circuit (where a lane or road leaves the village)" : "No wall there: click a stretch of the suggested circuit, or drag your own line" };
  const len = Math.hypot(line[2] - line[0], line[3] - line[1]);
  let b = null;
  if (gate) {
    if (!complete && !EC.canAfford(T, EC.costOf(kind))) return { error: "not enough materials" };
    b = EC.placeBuilding(w, team, kind, (line[0] + line[2]) / 2, (line[1] + line[3]) / 2, Math.atan2(line[3] - line[1], line[2] - line[0]), complete);
    if (b) Object.assign(b, { gx1: line[0], gy1: line[1], gx2: line[2], gy2: line[3] }); // the gate closes its whole stretch of the circuit
  } else {
    if (!complete && !EC.canAfford(T, EC.costOf(kind, len))) return { error: "not enough materials for that stretch" };
    if (old) { old.replaced = true; const i = w.buildings.indexOf(old); if (i >= 0) w.buildings.splice(i, 1); }
    b = EC.placeWall(w, team, kind, line[0], line[1], line[2], line[3], complete);
  }
  if (!b) return { error: "can't build there" };
  if (old && !slot) slot = plan.slots.find((q) => q.taken === old.id) || null;
  if (!slot) slot = sitePlot(plan, gate ? "gate" : "wall", { x: b.x, y: b.y, rot: b.rot || 0, w: gate ? 12 : len, h: gate ? 10 : 3, x1: line[0], y1: line[1], x2: line[2], y2: line[3], sited: true });
  markTaken(plan, slot, b);
  sweepWallSlots(w, team);
  return { b, slot };
}
const segD = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)); return Math.hypot(px - ax - dx * t, py - ay - dy * t); };

// The AI's choice (the lords, the reeves, the stewards): the best ground for `kind` read from the land (js/sim/siting.js
// bestSite — the plan's free plots among it), nearest `near` when the lord has a place in mind; a wall: the circuit's open
// stretch nearest `near`; a gate: its open gate. → { x, y, rot?, slot? } or null
export function bestSlot(w, team, kind, near) {
  refreshFieldSlots(w, team); sweepWallSlots(w, team);
  const plan = w.plans?.[team]; if (!plan) return null;
  if (kind !== "field" && !NEAR_RESOURCE[kind]) {
    const C = SI.siteContext(w, team);
    if (SI.WALL_KINDS.has(kind) || SI.GATE_KINDS.has(kind)) {
      const circ = SI.suggestCircuit(C); if (circ.error) return null;
      let b = null, bd = Infinity;
      for (const s of circ.stretches) { if (s.state !== "open" || s.gate !== SI.GATE_KINDS.has(kind)) continue; const d = Math.hypot((s.x1 + s.x2) / 2 - near.x, (s.y1 + s.y2) / 2 - near.y); if (d < bd) { bd = d; b = s; } }
      return b ? { ...b, x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 } : null;
    }
    return SI.bestSite(C, kind, near);
  }
  let best = null, bd = Infinity;
  for (const s of slotsFor(plan, kind)) {
    if (s.taken && !(kind === "stone_wall" && s.takenKind === "palisade")) continue;
    const d = Math.hypot(s.x - near.x, s.y - near.y); if (d < bd) { bd = d; best = s; }
  }
  return best;
}
