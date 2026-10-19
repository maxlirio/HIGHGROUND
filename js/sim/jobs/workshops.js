// The WORKSHOPS lane (docs/gathering-plan.md, "Workshops"): the men a workshop's crew are take their trade's STATIONS at the building —
// the smith at the anvil, the striker across it, the boy at the bellows; the weaver at the loom; the bowyer with his
// stave; the archers on the shooting line — in their trade's pose, while the building is actually producing (a product
// set, its stuff in the store, the building standing). When it is not, they stand about by the door. Plain data, no
// randomness: a station is a work step at a fixed spot of the building (rotated with it).
//
// The only sim effects: where the crew stands (the station instead of a wander round the building), and a man on his
// station is at work (economy.js counts him, as it counts a man at his spot). Output per man-day is unchanged.
// Also here: activity(w, b) — what a building is doing, for the renderer and the realm's state message (b.wk).
import { PLANNERS, HOOKS } from "../labor.js";
import { BUILDINGS, RECIPES, PRACTICE } from "../econ-data.js";
import { TECHS } from "../tech.js";

const PI = Math.PI;
// Stations, in the building's own frame (metres; x along its length, y toward its back; the model's front faces -y).
// f: the point he faces (else a: an angle in that frame). Coordinates read off the Blender models (assets/src/<kind>.py;
// for the re-centred models less the export's centring offset).
const fl = (x, y) => [x, y - 0.154];                         // fletcher.py: centred by (0, 0.154)
const ar = (x, y) => [x + 0.607, y - 0.287];                 // archery_range.py: centred by (-0.607, 0.287)
const MINT_C = [-0.04, 0.05];                                // mint.py: the complete model's x/y centre, which the export moves to the origin
const mi = (x, y) => [x - MINT_C[0], y - MINT_C[1]];
const S = (pose, [x, y], face, extra = {}) => ({ pose, x, y, ...(Array.isArray(face) ? { f: face } : { a: face }), ...extra });
export const STATIONS = {
  blacksmith: { idle: [2.1, -2.6], st: [
    S("work_anvil", [-1.55, -2.69], [-1.55, -1.95]),          // the smith at the anvil (assets/src/blacksmith.py: anvil at (-1.55, -1.95), face 0.87 m)
    S("work_sledge", [-1.55, -1.25], [-1.55, -1.95]),         // the striker across it, in the open bay
    S("work_bellows", [-3.75, 1.42], [-3.75, 2.4]),           // the boy at the bellows beside the hearth
    S("work_stoop", [-2.5, -2.95], [-2.5, -2.23]),            // quenching at the trough
  ] },
  bloomery: { idle: [-1.2, -3.0], st: [                      // js/render/jobs/quarry.js bloomeryGeo: shaft at 0, arch +x, bellows -x
    S("work_bellows", [-2.3, -0.5], 0), S("work_shovel", [0.0, 1.3], [0, 0]), S("work_rake", [2.75, 0.0], PI),
    S("work_bellows", [-2.3, 0.5], 0), S("work_sledge", [2.4, -0.62], [2.4, -1.32], { prop: "stump" }), S("work_shovel", [1.0, 1.0], [0, 0]),
  ] },
  charcoal_kiln: { idle: [5.6, 0.8], st: [                   // the clamp (radius 3.3) at 0
    S("work_shovel", [0.0, -4.15], [0, 0]), S("work_bucket", [3.7, -1.7], [0, 0]), S("work_rake", [-4.0, 1.3], [0, 0]),
  ] },
  fletcher: { idle: [1.0, -1.4], st: [
    S("work_fletch", fl(-1.6, 2.0), fl(-1.6, 2.7)),           // at the bench along the back wall (fletcher.py: stool at (-1.6, 2.05))
    S("work_fletch", fl(0.4, 2.0), fl(0.4, 2.7), { prop: "stool" }),
    S("work_string", fl(-0.3, -2.75), -PI / 2),               // the bowyer out in the yard
    S("work_fletch", fl(-0.1, -1.55), 0.25),                  // astride the shaving horse
  ], make: {
    bows: ["work_fletch", "work_string", "work_string", "work_fletch"],
    crossbows: ["work_chisel", "work_fletch", "work_string", "work_chisel"],
  } },
  weaver: { idle: [3.7, -1.9], st: [
    S("work_loom", [2.4, -1.85], [2.4, -1.0]),               // at the great loom in the lean-to (weaver.py: stool at (2.4, -1.85))
    S("work_loom", [3.0, -2.55], [3.0, -3.3], { prop: "loom" }),   // a treadle loom in the yard
    S("work_spin", [-0.6, -1.62], -PI / 2),                  // spinning before the cottage
    S("work_stoop", [-1.25, -3.15], [-1.85, -2.75]),         // at the blue vat
  ], make: {
    gambeson: ["work_loom", "work_fletch", "work_spin", "work_fletch"],
  } },
  siege_workshop: { idle: [0.0, -5.6], st: [                 // siege_workshop.py: the shed floor (the engine grows there), the sawpit, the hewing trestles, the benches
    S("work_mallet", [-7.4, -0.15], [-7.4, 2.3]), S("work_mallet", [-4.6, -0.15], [-4.6, 2.3]),
    S("work_saw", [-7.0, -2.85], [-7.0, -3.6]), S("work_saw", [-5.0, -2.85], [-5.0, -3.6]),
    S("work_axe", [-3.0, -2.3], [-3.0, -1.6]), S("work_axe", [-0.6, -2.3], [-0.6, -1.6]),
    S("work_chisel", [4.2, 5.12], [4.2, 5.8]), S("work_chisel", [8.0, 5.12], [8.0, 5.8]),
  ] },
  archery_range: { idle: ar(-13.0, -2.0), st: [] },
  mint: { idle: mi(0.5, -5.2), st: [                          // mint.py: the striking bench under the pentice on the west yard wall, the anvil block, the balance
    S("work_chisel", mi(-3.35, -4.85), mi(-4.0, -4.85)),      // a moneyer at each pile die, the trussel held and struck (dies at (-4.0, -4.85) and (-4.0, -3.15))
    S("work_chisel", mi(-3.35, -3.15), mi(-4.0, -3.15)),
    S("work_anvil", mi(-1.91, -3.29), mi(-2.2, -2.6)),        // the smith beating out the fillets for blanks (anvil block at (-2.2, -2.6), yaw 0.4)
    S("work_stoop", mi(-3.35, -2.15), mi(-4.0, -2.15)),       // weighing the pennies at the balance (at (-4.0, -2.15))
  ] },
};
// the shooting line: eight places, two deep (archery_range.py: the rail at x -9.5, places at these y), facing the butts
for (const x of [-9.1, -10.3]) for (const y of [-4.7, -3.36, -2.01, -0.67, 0.67, 2.01, 3.36, 4.7]) STATIONS.archery_range.st.push(S("work_loose", ar(x, y), 0));
// the muster yard (barracks.py, centred by (0.153, 0.367)): three men hacking at the pells, the rest two ranks deep in the yard
// thrusting at the drill (the recruits in a training queue drill before the gate, js/render/jobs/workshops.js); a spear each
const bk = (x, y) => [x - 0.153, y - 0.367];
STATIONS.barracks = { idle: bk(4.0, -3.6), st: [
  S("strike", bk(0.2, -3.25), bk(0.2, -2.3)), S("strike", bk(1.5, -3.95), bk(1.5, -3.0)), S("strike", bk(-0.85, -3.7), bk(-0.85, -2.75)),
] };
for (const y of [-1.9, -3.2]) for (const x of [-6.4, -5.2, -4.0, -2.8]) STATIONS.barracks.st.push(S("strike", bk(x, y), bk(x, y - 1)));
// the stables' yard (stables.py: the open yard x -5..4, y -6..-2, where the recruits ride their oval; the tilt lane at y -8..-10
// beyond): along the front, each man at the neck of a horse (head toward -x) facing it — the house's own horse, drawn beside him (js/render/jobs/workshops.js)
STATIONS.stables = { idle: [7.5, -3.0], st: [-6.5, -3.9, -1.3, 1.3, 3.9, 6.5].map((x) => S("idle_lead", [x, -6.9], [x, -7.9])) };
export const BUTTS = [-3.9, 0, 3.9].map((y) => [...ar(17.07, y), 1.25]);   // target centres (x, y, height) in the range's frame
// what each building turns out per batch: the siege workshop's engine in its frame
export const ENGINE_OF = { trebuchet_gear: "trebuchet_packed", mangonels: "mangonel", springalds: "springald", rams: "ram", siege_towers: "siege_tower", mantlets: "mantlet", ladders: "ladder" };

const done = (b) => b.progress >= 1 && !b.ruin;
export const local = (b, lx, ly) => { const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0); return [b.x + lx * c - ly * s, b.y + lx * s + ly * c]; };
const angle = (b, a) => a + (b.rot || 0);
// is the workshop at work: a product set, its stuff to hand, standing and not burning; a training ground (practice) with its gear
export function producing(w, b) {
  if (!done(b) || b.fire > 0) return false;
  const P = PRACTICE[b.kind]; if (P) { const T = w.teams[b.team]; return !P.gear || (T?.store?.[P.gear] || 0) >= 1; } // (a training ground: the butts always; the muster yard with a spear, the stables with a horse, to hand)
  const R = RECIPES[b.kind]; return !!(R && b.make && R[b.make] && !b.blocked);
}
// the pose a station plays for this product
export function poseAt(b, k) { const D = STATIONS[b.kind], m = D?.make?.[b.make]; return (m && m[k]) || D?.st[k]?.pose || "idle_hand"; }
// station k of building b in the world: [x, y, facing x, facing y]
export function stationAt(b, k) {
  const st = STATIONS[b.kind].st[k], [x, y] = local(b, st.x, st.y);
  if (st.f) { const [fx, fy] = local(b, st.f[0], st.f[1]); return [x, y, fx, fy]; }
  const a = angle(b, st.a); return [x, y, x + Math.cos(a), y + Math.sin(a)];
}

// the crew's planner (labor.js PLANNERS, job kinds "craft" and "practice"): man k of the crew takes station k while the
// building produces (the first `staff` men are the ones craftWork counts); the rest — or all of them when it is idle —
// wait about the door. A task "craft" at a station counts as at work (economy.js workUnit).
function plan(w, u, id, k, M, { job }) {
  const b = job.b; if (!b || !STATIONS[b.kind] || !done(b)) return null;
  const D = STATIONS[b.kind], staff = BUILDINGS[b.kind]?.staff || 4;
  // the stations go to the men at hand, in crew order: one still carrying his last job's load home takes none (and
  // keeps no one from the anvil); only the first `staff` men work (craftWork counts those)
  let j = 0; if (k < staff) for (let m = 0; m < k; m++) { const o = w.labor?.men.get(u.members[m]); if (!o?.task || o.inB !== undefined) j++; }
  if (producing(w, b) && k < staff && j < D.st.length) {
    const [x, y, fx, fy] = stationAt(b, j);
    return [{ op: "hook", name: "ws.in", arg: b.id }, { op: "go", x, y, near: 0.06 }, { op: "work", pose: poseAt(b, j), secs: 24 + (j % 3) * 4, x, y, face: [fx, fy] }];
  }
  const [ix, iy] = local(b, D.idle[0] + (k % 3) * 0.9 - 0.9, D.idle[1] - Math.floor(k / 3) * 0.9);
  return [{ op: "hook", name: "ws.out" }, { op: "go", x: ix, y: iy, near: 1.2 }, { op: "wait", secs: 8, pose: k % 2 ? "idle_talk" : null }];
}
PLANNERS.craft = plan;
PLANNERS.practice = plan;
// a man at his station may stand inside the building's solid box (obstacles.js: the rect of building M.inB lets him be)
HOOKS["ws.in"] = (w, id, M, st) => { M.inB = st.arg; };
HOOKS["ws.out"] = (w, id, M) => { delete M.inB; };
// a man on his way to / working at his station (the task's first step set M.inB): at work, for economy.js
export const atStation = (w, id) => { const M = w.labor?.men.get(id); return !!(M?.task && M.inB !== undefined); };

// ---------------------------------------------------------------- what a building is doing (render, realm state)
// → null, or { on, n (men at stations), m (product), f (the batch's progress 0..1), q (arm in training), c (how many),
//   mt (mount), t (a squire at the tilt), tr (a mount being broken), s (studies at the keep's desks), a (arcane study), h (horses on a paddock) }
export function activity(w, b) {
  if (!done(b) || b.x1 !== undefined || b.field) return null;
  const o = {};
  if (STATIONS[b.kind]) {
    o.on = producing(w, b) ? 1 : 0; o.m = b.make || null;
    const R = RECIPES[b.kind], r = R && b.make && R[b.make];
    if (r) o.f = Math.max(0, Math.min(1, (b.work || 0) / r.days));
    let n = 0; const L = w.labor;
    if (L) for (const u of w.units.values()) if (u.team === b.team && u.job?.b === b) for (const id of u.members) if (atStation(w, id)) n++;
    o.n = n;
    if (PRACTICE[b.kind]?.gear && !n) o.on = 0; // (the muster yard, the stables: at work only with men training there)
  }
  const q = b.queue?.[0];
  if (q && q.retrain === undefined) { o.q = q.arm; o.c = q.count; if (q.mount) o.mt = q.mount; o.on = 1; }
  if (b.tilt) { o.t = 1; o.on = 1; }
  if (b.train) { o.tr = b.train.kind; o.on = 1; }
  const T = w.teams[b.team];
  if (b.kind === "town_hall" && T?.tech?.active?.length) { o.s = T.tech.active.length; o.on = 1; }
  if (b.kind === "mage_tower" && T?.tech?.active?.some((a) => TECHS[a.id]?.building === "mage_tower" || TECHS[a.id]?.branch === "lore")) { o.a = 1; o.on = 1; }
  if (b.kind === "mill" && (T?.store?.grain || 0) > 0 && !(b.fire > 0)) o.on = 1;
  if (b.kind === "paddock" && T) { const n = w.buildings.filter((p) => p.team === b.team && p.kind === "paddock" && done(p)).length || 1;   // (the horses on it, for js/render/jobs/ambient.js: the stud and a share of the house's own)
    o.h = Math.min(10, Math.round(2 + ((T.store?.horses || 0) + (T.store?.destriers || 0)) / n / 3)); }
  return Object.keys(o).length ? o : null;
}
