// A house's TOWNS: the seat (the house's first keep — everything the game had before) and the DAUGHTER settlements its
// settlers found (js/sim/founding.js). Each town has its OWN plan, stores, granary, people and labour pool, run by its own
// reeve; the house shares one PURSE (silver and gold) and one body of learning (research, js/sim/tech.js) across them.
//
// Why share the purse and the learning: a medieval lord's chamber travelled with him — rents from every manor were paid
// to his steward and spent where he chose (letters of credit, not carts of coin), and what his clerks and masters knew
// they knew for all his lands. Grain, timber, stone, beasts and the men who work them are bulky and stay where they are:
// each manor kept its own barns and its own reeve's account. So: one treasury, one study; many granaries.
//
// HOW (without rewriting the economy): every economy routine reads the town it works on through the TEAM — T.store,
// T.town, T.hall, T.homeUnit, T.dependants … and w.plans[team], and it finds the town's people and buildings by
// `u.team === team` / `b.team === team`. A TOWN FRAME makes that true for one town at a time:
//   • the per-town fields (TOWN_KEYS) of the team are swapped with the daughter's own (D.s), and w.plans[team] with
//     D.plan; the purse is carried in (silver and gold move into the daughter's store and back out after);
//   • w.units and w.buildings are swapped for VIEWS holding every other house's units and buildings (enemies are still
//     seen: raiders near the fields, the danger rule) and only THIS town's own — the team's other towns are left out
//     (their buildings stand in as plain obstacles, team -1, so no plot or field is laid over them);
//   • whatever the town's routines make or unmake while framed (a recruit, newcomers, a crew split off, a building staked
//     out, a palisade replaced) is written back to the real map and array on the way out, tagged as the town's (u.town /
//     b.town = D.id).
// A team with no daughters is never framed: the economy runs exactly as before (seeded runs are byte-identical).
// The seat's own work, when daughters exist, runs in a SEAT frame (views without the daughters' people and buildings).

export const TOWN_KEYS = ["town", "store", "hall", "homeUnit", "dependants", "squires", "sheep", "unrest", "ration", "starveAcc", "arrears", "arrearsDays", "acc", "market", "day",
  "stats", "camp0", "camp", "freePlots", "eff", "daylight", "harvestTime", "shelter", "besieged", "foals", "shorn", "drakeHunger", "lastTallage", "recentLosses", "hq", "slaughterNews"];
export const PURSE = ["silver", "gold"];

let CTX = null; // the frame now open: { w, team, D (null: the seat), ... }
export const frame = () => CTX;
export const inFrame = () => !!CTX;
// a town that runs its own economy: from the settlers' camp on (on the march they are still the seat's)
export const liveTowns = (T) => (T?.towns || []).filter((D) => D.s && !D.lost);
export const hasDaughters = (T) => !!T?.towns?.length && T.towns.some((D) => D.s && !D.lost);
export const anyDaughters = (w) => !!w?.teams?.some((T) => hasDaughters(T));
export const townById = (T, id) => (T?.towns || []).find((D) => D.id === id) || null;
const townOf = (o) => o.town || null;

// Run fn inside the frame of town D (null: the seat) of `team`. Nesting the same frame just runs fn; a team with no
// daughters runs fn bare.
export function within(w, team, D, fn) {
  const T = w.teams[team];
  if (CTX && CTX.team === team && CTX.D === D) return fn();
  if (CTX) { // another frame is open: close it for the call (never expected; kept safe)
    const outer = CTX; leave(); try { return within(w, team, D, fn); } finally { enter(outer.w, outer.team, outer.D); }
  }
  if (!D && !hasDaughters(T)) return fn();
  enter(w, team, D);
  try { return fn(); } finally { leave(); }
}
export const asSeat = (w, team, fn) => within(w, team, null, fn);
// the AI's hooks (ai-general.js generalThink / reeveThink / wardenThink): run as the seat unless a frame is open already
export function seatGuard(w, team, fn) { if (CTX || !hasDaughters(w.teams[team])) return null; return { r: within(w, team, null, fn) }; }

function enter(w, team, D) {
  const T = w.teams[team], realU = w.units, realB = w.buildings, id = D ? D.id : null;
  const C = { w, team, D, realU, realB, saved: null, plan: null, stand: new Set() };
  if (D) {
    C.saved = {}; for (const k of TOWN_KEYS) { C.saved[k] = T[k]; T[k] = D.s[k]; }
    const sv = C.saved.store || {}, ds = T.store || (T.store = D.s.store = {});
    for (const r of PURSE) { ds[r] = (ds[r] || 0) + (sv[r] || 0); if (sv[r]) sv[r] = 0; } // (the purse goes with the steward)
    C.plan = w.plans?.[team]; if (w.plans) w.plans[team] = D.plan || null;
  }
  const U = new Map(); for (const [k, u] of realU) if (u.team !== team || townOf(u) === id) U.set(k, u);
  const B = [];
  for (const b of realB) {
    if (b.team !== team || townOf(b) === id) { B.push(b); continue; }
    // the team's other towns' buildings stand in as plain ground features: no plot or field is laid over them
    const s = { id: b.id, kind: b.kind, team: -1, x: b.x, y: b.y, rot: b.rot, w: b.w, h: b.h, progress: b.progress, ruin: b.ruin, hp: b.hp, hpMax: b.hpMax, fire: 0, queue: [], stand: true };
    if (b.x1 !== undefined) Object.assign(s, { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 });
    if (b.field) s.field = { state: "stand", ha: 0, left: 0 };
    B.push(s); C.stand.add(s);
  }
  C.U = U; C.B = B; C.B0 = new Set(B);
  w.units = U; w.buildings = B;
  CTX = C;
}
function leave() {
  const C = CTX; if (!C) return; CTX = null;
  const { w, team, D, realU, realB, U, B } = C, id = D ? D.id : null, T = w.teams[team];
  // what the town made or unmade while framed goes back to the real world
  for (const [k, u] of U) if (!realU.has(k)) { realU.set(k, u); if (u.team === team) { if (id) u.town = id; else delete u.town; } }
  for (const [k, u] of realU) if ((u.team !== team || townOf(u) === id) && !U.has(k)) realU.delete(k);
  const inView = new Set(B);
  const gone = new Set(); for (const b of C.B0) if (!inView.has(b) && !C.stand.has(b)) gone.add(b);
  const added = B.filter((b) => !C.B0.has(b) && !C.stand.has(b) && !b.stand);
  if (gone.size) for (let i = realB.length - 1; i >= 0; i--) if (gone.has(realB[i])) realB.splice(i, 1);
  for (const b of added) { if (b.team === team) { if (id) b.town = id; else delete b.town; } realB.push(b); }
  w.units = realU; w.buildings = realB;
  if (D) {
    if (w.plans) { D.plan = w.plans[team]; w.plans[team] = C.plan; }
    for (const k of TOWN_KEYS) { D.s[k] = T[k]; T[k] = C.saved[k]; }
    const ds = D.s.store || {}, sv = T.store || {};
    for (const r of PURSE) { sv[r] = (sv[r] || 0) + (ds[r] || 0); ds[r] = 0; }
  }
}

// ---------------------------------------------------------------- where things are
// every town of every house (the seat first): for the world map, the wildlife, the founding rules
export function allTowns(w) {
  const out = [];
  for (const T of w.teams || []) {
    if (!T) continue;
    if (T.town && !T.fallen) out.push({ team: T.id, id: null, x: T.town.x, y: T.town.y, name: T.townName || null, seat: true, hall: T.hall });
    for (const D of T.towns || []) if (!D.lost) out.push({ team: T.id, id: D.id, x: D.x, y: D.y, name: D.name, seat: false, state: D.state, hall: D.s?.hall ?? null });
  }
  return out;
}
// the team's town nearest (x, y): null = the seat, else the daughter D (only towns with their own economy count)
export function townAt(w, team, x, y, maxD = 900) {
  const T = w.teams[team]; if (!hasDaughters(T)) return null;
  let best = null, bd = T.town ? Math.hypot(T.town.x - x, T.town.y - y) : Infinity;
  for (const D of liveTowns(T)) { const d = Math.hypot(D.x - x, D.y - y); if (d < bd && d < maxD) { bd = d; best = D; } }
  return best;
}
export const townOfUnit = (w, u) => (u?.town ? townById(w.teams[u.team], u.town) : null);
export const townOfBuilding = (w, b) => (b?.town ? townById(w.teams[b.team], b.town) : null);
// the people a team's daughters hold that the census counts (economy.js census: the dependants, squires and the settlers'
// families on the road are off the seat's books but still the house's)
export function extraHeads(w, team) {
  const T = w.teams[team]; let n = 0;
  for (const D of T?.towns || []) { if (D.s && !D.lost) n += (D.s.dependants || 0) + (D.s.squires || 0); else if (!D.s && !D.lost) n += D.deps || 0; }
  return n;
}
// a town's state as the UI shows it: the seat is the team itself; a daughter is the team with its own fields over it
export function townView(w, team, D) {
  const T = w.teams[team]; if (!D) return T;
  if (!D.s) return null;
  const v = Object.create(T); for (const k of TOWN_KEYS) v[k] = D.s[k];
  v.store = { ...D.s.store }; for (const r of PURSE) v.store[r] = (T.store?.[r] || 0) + (D.s.store?.[r] || 0);
  v.daughter = D;
  return v;
}
