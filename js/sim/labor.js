// The LABOUR CORE (docs/gathering-plan.md): people doing visible work in explicit phases, and goods that are real
// things — carried on a shoulder, stacked in a pile, set down in a store. Deterministic, DOM-free; everything here is
// plain data on w.labor, so the realm's save (server/save.mjs) round-trips it with no special code.
//
//   w.labor = {
//     men:   Map(soldier id → Man)   only the people who are on a task or carrying something
//     items: [Item]                   goods lying in the world: site piles, stacks, a dropped load
//     nextItem, ver                   ver bumps whenever an item is added / removed / changes its piece count
//   }
//   Man  = { born, team, task: { name, steps: [Step], k } | null, carry: Carry | null, pose, t0, dur, md }
//          pose: the villager CLIP he is playing while at work ("work_axe", "work_stoop", "work_saw" …; null = walk/idle
//          by speed); t0/dur (battle seconds, w.time): when the current step began and how long it lasts, so a one-shot
//          pose (a stoop, a tree's last blow) can be synced by the renderer; md: man-days worked in this step.
//   Carry = { kind, res, kg, cart?: true, partner?: id }   kind = an ITEMS key (what the renderer shows)
//   Item  = { id, kind, res, kg, x, y, rot, team, key?, loose?, n }   n = pieces drawn (vizCount), key = a site's pile
//
// A TASK is a list of data steps (no closures: saveable). Ops:
//   { op: "go", x, y, near? }                           walk there (commute speed when far, slower under a load)
//   { op: "work", pose, secs, x?, y?, face?: [x, y], hook?, arg? }   stand and work; HOOKS[hook](w, id, M, step) at the end
//   { op: "take", item, kg?, share? }                  stoop and pick up from item id (all of it, or kg — at least 1/share of it)
//   { op: "put", to: "store"|"pile"|"site"|"ground", b?, key?, kind?, x?, y? }   stoop and set the load down:
//        store: into the team's store (the ONLY place a good starts to count); pile: onto the item keyed `key` (made at
//        x, y if missing); site: into building b's b.stock (construction logistics, lane D); ground: a loose item here
//   { op: "hook", name, arg }                           call HOOKS[name](w, id, M, step) at once
//   { op: "wait", secs, pose? }
// A step whose target has gone (item taken, building burnt) ends the task; a man left holding a load then carries it to
// the nearest store that takes it (deliver-first). Lanes add work by registering PLANNERS (who does what next) and HOOKS
// (what a finished step changes in the world), and ITEMS kinds; see docs/gathering-plan.md.
import { S_MOVE, S_WORK, S_IDLE, clamp } from "./soldiers.js";
import { ARMS } from "./arms.js";
import { TICK } from "./clock.js";
import { BATTLE_RATE, ECON_DAYS_PER_REAL_SEC } from "./clock.js";
import { E, BUILDINGS } from "./econ-data.js";
import { blocked } from "./obstacles.js";
import * as WN from "./wallnav.js";
import * as RV from "./rivers.js"; // (water a man cannot wade: by the ford or the bridge)
import * as TC from "./tech.js"; // (research: docs/tech.md)

const BT = TICK * BATTLE_RATE;                       // battle seconds per tick
const ECON_PER_BSEC = ECON_DAYS_PER_REAL_SEC / BATTLE_RATE;
const inFieldRect = (b, x, y, m = 0) => { const r = b.rot || 0, c = Math.cos(r), s = Math.sin(r), dx = x - b.x, dy = y - b.y; return Math.abs(dx * c + dy * s) < b.w / 2 + m && Math.abs(dy * c - dx * s) < b.h / 2 + m; }; // (a field lies at its furlong's angle)
export const STOOP_S = 16 / 9;                       // one work_stoop cycle (the clip: 16 frames at 9 fps)

// What can be carried or lie about. hold: how it is carried (render: shoulder / front / back / sack / drag);
// slow: walking-speed factor under it; kg: one real load (a lot is never smaller); piece: kg a stacked piece stands for
// in a pile's picture (vizCount). Lanes add kinds (keep `hold` to one of the five, or add a clip + part and say so).
export const ITEMS = {
  log:     { res: "timber",   hold: "shoulder", slow: 0.85, kg: 60,  piece: 3000 },
  faggot:  { res: "firewood", hold: "shoulder", slow: 0.9,  kg: 30,  piece: 2000 },
  planks:  { res: "boards",   hold: "shoulder", slow: 0.9,  kg: 40,  piece: 1500 },
  stone:   { res: "stone",    hold: "front",    slow: 0.8,  kg: 50,  piece: 6000 },
  basket:  { res: "ore",      hold: "back",     slow: 0.9,  kg: 30,  piece: 1500 },
  sack:    { res: "grain",    hold: "sack",     slow: 0.9,  kg: 40,  piece: 800 },
  sheaf:   { res: "sheaves",  hold: "front",    slow: 0.95, kg: 15,  piece: 400 },
  barrel:  { res: "fresh",    hold: "front",    slow: 0.85, kg: 40,  piece: 300 },
  carcass: { res: "fresh",    hold: "front",    slow: 0.8,  kg: 45,  piece: 60 },
  fish:    { res: "fresh",    hold: "back",     slow: 0.95, kg: 20,  piece: 100 },
};
// the default thing a resource travels as
export const RES_ITEM = { timber: "log", firewood: "faggot", boards: "planks", stone: "stone", ore: "basket", clay: "basket",
  silver: "sack", gold: "sack", grain: "sack", seed: "sack", flour: "sack", sheaves: "sheaf", hay: "sheaf", fresh: "barrel" };
// goods that walk to the store on someone's back (mana is drawn at the ley and simply is)
export const PHYSICAL = new Set(["timber", "firewood", "boards", "stone", "ore", "clay", "silver", "gold", "fresh", "grain", "seed", "sheaves", "hay"]);

export const HOOKS = {};     // name → (w, id, M, step) : lanes register ("forest.fell", "fields.reap", …)
export const PLANNERS = {};  // "<job kind>" or "<job kind>:<res>" → (w, u, id, k, M, ctx) → [steps] | null (legacy spot)
// a gather crew's output, by resource: (w, u, node, kg, store) → true when the lane put the kg somewhere itself (a felled
// tree, a carcass on the ground …); else it goes onto the site's pile (economy.gather). The kg MUST end up somewhere.
export const OUTPUT = {};
// per-tick lane systems, run once per economic tick from laborPreTick (lane C's herds and hunting parties): name → (w)
export const TICKS = {};

export function laborOf(w) { return (w.labor ||= { men: new Map(), items: [], nextItem: 1, ver: 0 }); }
export function manOf(w, id, make = false) {
  const L = laborOf(w); let M = L.men.get(id);
  if (!M && make) { M = { born: w.S.born[id], team: w.S.team[id], task: null, carry: null, pose: null, t0: 0, dur: 0, md: 0, best: -1, since: 0 }; L.men.set(id, M); }
  return M || null;
}
export const carrying = (w, id) => w.labor?.men.get(id)?.carry || null;

// give a man a task (replaces his current one; his load stays in his arms)
// (M.inB: a workshop's man inside its solid box at his station — js/sim/jobs/workshops.js. Kept while he replans there, so the
// obstacle pass does not throw him out through the nearest wall between two stints; any other task takes him out of it.)
export function assign(w, id, name, steps) { const M = manOf(w, id, true); if (M.inB !== undefined && !(steps?.[0]?.op === "hook" && steps[0].name === "ws.in")) delete M.inB; M.task = steps?.length ? { name, steps, k: 0 } : null; M.best = -1; M.tries = 0; M.pose = null; M.t0 = w.time; M.dur = 0; M.md = 0; return M; }
// A man who reached the bank and found no way over (no ford, no bridge) stands there a while before his crew's planner
// gives him a task again — or until a crossing is made (w.riverSig). Without it his crew handed him the same far field
// every tick, and every tick his walk was searched across the whole map for a way that is not there: six ploughmen of
// one house on a bank were ~half the live realm's tick (Oct 2026), and loading crawled behind it. Plain data on w.labor.
const BALK_S = 60;
function balk(w, id) { (w.labor.balk ||= {})[id] = { t: w.time + BALK_S, sig: w.riverSig | 0, born: w.S.born[id] }; }
export function balked(w, id) {
  const B = w.labor?.balk, b = B?.[id]; if (!b) return false;
  if (w.time < b.t && b.sig === (w.riverSig | 0) && b.born === w.S.born[id]) return true;
  delete B[id]; return false;
}
export function stop(w, id) { const M = w.labor?.men.get(id); if (!M) return; M.task = null; M.pose = null; delete M.inB; if (!M.carry) w.labor.men.delete(id); }

// ---------------------------------------------------------------- items
export function vizCount(kind, kg) { const I = ITEMS[kind]; return kg <= 0 ? 0 : clamp(Math.ceil(kg / (I?.piece || 1000)), 1, 24); }
export function addItem(w, { kind, res, kg, x, y, team, key = null, loose = false, rot = 0 }) {
  const L = laborOf(w);
  const it = { id: L.nextItem++, kind, res: res || ITEMS[kind]?.res, kg, x, y, rot, team, key, loose, n: vizCount(kind, kg) };
  L.items.push(it); L.ver++; if (L._byKey?.items === L.items && L._byKey.len === L.items.length - 1) { L._byKey.len++; if (key != null && !L._byKey.map.has(key)) L._byKey.map.set(key, it); } return it;
}
export function itemById(w, id) { const L = w.labor; if (!L) return null; for (const it of L.items) if (it.id === id) return it; return null; }
// a keyed item (a site's pile, a store's stack) by its key: from an index kept beside the list (never saved: rebuilt from
// it), the first item in the list holding that key — as the plain scan found it. (The scan, ~1000s of items, for every
// stack of every store of every house every second tick, was a tenth of the live realm's tick.) Keys are set when an
// item is made; the few places that change one call rekeyItem.
function keyIndex(L) {
  let X = L._byKey;
  if (!X || X.items !== L.items || X.len !== L.items.length) { X = { items: L.items, len: L.items.length, map: new Map() }; for (const it of L.items) if (it.key != null && !X.map.has(it.key)) X.map.set(it.key, it); Object.defineProperty(L, "_byKey", { value: X, enumerable: false, writable: true, configurable: true }); }
  return X.map;
}
function reindexKey(L, key) { const m = keyIndex(L); m.delete(key); for (const it of L.items) if (it.key === key) { m.set(key, it); break; } }
export function itemByKey(w, key) { const L = w.labor; if (!L || key == null) return null; return keyIndex(L).get(key) || null; }
export function rekeyItem(w, it, key) { const L = w.labor, old = it.key; it.key = key; if (!L) return; if (old != null) reindexKey(L, old); if (key != null) reindexKey(L, key); }
export function addKg(w, it, kg) { it.kg += kg; const n = vizCount(it.kind, it.kg); if (n !== it.n) { it.n = n; w.labor.ver++; } }
export function takeKg(w, it, kg) {
  const got = Math.min(it.kg, Math.max(0, kg)); it.kg -= got;
  if (it.kg <= 1e-6) removeItem(w, it); else { const n = vizCount(it.kind, it.kg); if (n !== it.n) { it.n = n; w.labor.ver++; } }
  return got;
}
export function removeItem(w, it) { const L = w.labor, k = L.items.indexOf(it); if (k >= 0) { L.items.splice(k, 1); L.ver++; const X = L._byKey; if (X?.items === L.items && X.len === L.items.length + 1) { X.len--; if (it.key != null && X.map.get(it.key) === it) reindexKey(L, it.key); } } }
// a site's pile (felled logs at the wood's edge, blocks at the quarry…), made where asked the first time
export function sitePile(w, key, kind, x, y, team, rot = 0) { return itemByKey(w, key) || addItem(w, { kind, kg: 0, x, y, team, key, rot }); }
// where a site's landing goes: from the site toward its store, the first open ground (clear of trunks by `clear` m),
// but no further than `maxR` — logs are stacked at the wood's edge, not under the canopy
export function landingSpot(w, x0, y0, x1, y1, maxR, clear = 6) {
  const d = Math.hypot(x1 - x0, y1 - y0) || 1, ux = (x1 - x0) / d, uy = (y1 - y0) / d, lim = Math.min(maxR, d - 12), O = w.obstacles;
  let r = Math.min(lim, 4);
  const inField = (x, y) => w.buildings.some((b) => b.field && inFieldRect(b, x, y, 4));
  const open = (x, y) => { if (inField(x, y)) return false; for (let dx = -clear; dx <= clear; dx += 3) for (let dy = -clear; dy <= clear; dy += 3) if (blocked(O, x + dx, y + dy, 2.2)) return false; return true; };
  for (; r < lim; r += 4) if (!O || open(x0 + ux * r, y0 + uy * r)) break;
  r = Math.max(0, Math.min(r, lim));
  return [x0 + ux * r, y0 + uy * r];
}
export function nearestLoose(w, team, x, y, r) {
  let best = null, bd = r; for (const it of w.labor?.items || []) { if (!it.loose || it.team !== team || it.claim) continue; const d = Math.hypot(it.x - x, it.y - y); if (d < bd) { bd = d; best = it; } }
  return best;
}

// ---------------------------------------------------------------- stores
const done = (b) => b.progress >= 1 && !b.ruin;
export function takesRes(b, res) { const s = BUILDINGS[b.kind]?.stores; return s === true || (Array.isArray(s) && s.includes(res)); }
export function nearestStore(w, team, res, x, y) {
  let best = null, bd = Infinity;
  for (const b of w.buildings) { if (b.team !== team || !done(b) || !takesRes(b, res)) continue; const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = b; } }
  return best;
}
// the spot at a building's edge facing (x, y): where a carrier sets his load down
export function doorOf(b, x, y) {
  const fp = BUILDINGS[b.kind]?.footprint || [8, 8], r = Math.hypot(fp[0], fp[1]) * 0.35 + 1.5;
  const dx = x - b.x, dy = y - b.y, d = Math.hypot(dx, dy) || 1;
  return [b.x + dx / d * r, b.y + dy / d * r];
}
// kg one carrier's trip should move so that the carriers keep pace with the analytic haul (economy.js, research §4):
// a trip at game speed spans many economic hours, so a "log" on a shoulder stands for the whole lot a real carrier moves
// in that time. Never less than one real load.
export function lotFor(w, T, d, kind, cart = false) {
  const I = ITEMS[kind] || { slow: 0.9, kg: 30 }, C = cart ? E.carriers.cart : E.carriers.man;
  const vw = ARMS.villager.speed * E.commuteMul * (I.slow || 1);
  const tripDays = (2 * d / vw + 2 * STOOP_S) * ECON_PER_BSEC;
  const v = C.v * TC.mul(w, T.id, "haul") * (cart ? TC.mul(w, T.id, "cart") : 1); // (research: causeways & bridges; the horse collar)
  const perManDay = C.kg * 36000 / (2 * d / v + C.load);
  return Math.max(I.kg, 1.25 * tripDays * (T.eff || 1) * perManDay);
}

// ---------------------------------------------------------------- per tick
// dead / departed men drop what they carry where they stand (goods are never lost off the books)
export function laborPreTick(w) {
  for (const k in TICKS) TICKS[k](w);   // (lane systems: wild herds, hunting parties — js/sim/wild.js)
  const L = w.labor; if (!L) return;
  for (const [id, M] of L.men) {
    const S = w.S;
    if (S.alive[id] && S.born[id] === M.born) continue;
    if (M.carry && S.born[id] === M.born) dropHere(w, id, M);
    L.men.delete(id);
  }
}
// economy.retire() calls this before a man leaves the map
export function forget(w, id) { const M = w.labor?.men.get(id); if (!M) return; if (M.carry) dropHere(w, id, M); w.labor.men.delete(id); }
function dropHere(w, id, M) { const c = M.carry; M.carry = null; if (c.kg > 0) addItem(w, { kind: c.kind, res: c.res, kg: c.kg, x: w.S.x[id], y: w.S.y[id], team: M.team, loose: true, rot: w.S.facing[id] }); }

function moveTo(w, id, tx, ty, v) {
  const S = w.S, dx = tx - S.x[id], dy = ty - S.y[id], d = Math.hypot(dx, dy); if (d < 1e-6) return;
  const s = Math.min(v, d), M = w.map;
  S.x[id] = clamp(S.x[id] + dx / d * s, M.x0, M.x1); S.y[id] = clamp(S.y[id] + dy / d * s, M.y0, M.y1);
  S.facing[id] = Math.atan2(dy, dx); S.state[id] = S_MOVE; S.fatigue[id] = clamp(S.fatigue[id] - 1e-4, 0, 1);
}

// Run one tick of man `id`'s task. md = man-days a worker puts in this tick (economy: DT × T.eff).
// → true while he is under a task (the caller leaves him alone), false when he has none.
export function stepMan(w, id, md) {
  const M = w.labor?.men.get(id); if (!M?.task) return false;
  const S = w.S, st = M.task.steps[M.task.k];
  // a field task outlives nothing: once his crew is no longer at that field's work (the job ended, he was split off, sent
  // elsewhere) he unyokes and stops — or he walks his old furrows forever (the owner's "useless guy with a plough")
  if (M.task.name === "field") { const u = w.units.get(S.unit[id]); if (!u || u.job?.kind !== "field") { if (M.carry?.kind === "plough") M.carry = null; else if (M.carry) dropHere(w, id, M); stop(w, id); return false; } }
  // nor does a gathering task: a man sent home or to the bloomery stops walking to his old fishing water or wood (House
  // Maximus's reeve moved three men from the fish to the bloomery; they spent the next days walking 1.7 km to the fishery
  // and fishing a stint first). A load already in his arms he still takes to the store.
  if (M.task.name === "gather" || M.task.name === "carry") { const u = w.units.get(S.unit[id]); if (!u || u.job?.kind !== "gather") { if (M.carry) { planDeliver(w, id, M); return true; } stop(w, id); return false; } }
  if (!st) { endTask(w, id, M); return false; }
  const base = ARMS.villager.speed * BT, slow = M.carry ? ITEMS[M.carry.kind]?.slow || 0.9 : 1;
  const next = () => { M.task.k++; M.best = -1; M.tries = 0; M.via = null; M.pose = null; M.t0 = w.time; M.dur = 0; M.md = 0; if (M.task.k >= M.task.steps.length) endTask(w, id, M); };
  switch (st.op) {
    case "go": {
      const d = Math.hypot(st.x - S.x[id], st.y - S.y[id]);
      if (d <= (st.near ?? 1.2)) { S.state[id] = S_IDLE; M.via = null; next(); break; }
      // a town wall between him and the place: by the gate (js/sim/wallnav.js; the waypoint is kept on him, M.gw), and his
      // headway is reckoned to the waypoint, not to a place that lies behind the palisade
      let gx = st.x, gy = st.y;
      // water he cannot wade between him and the place: by the ford or the bridge (js/sim/rivers.js; the way kept on him, M.rw);
      // no way over, or the place itself in the river: he goes to the bank — there for a place beside it, else he gives it up
      const rv = RV.way(w, M.team, S.x[id], S.y[id], st.x, st.y, (M.rw ||= []));
      if (rv) {
        gx = rv[0]; gy = rv[1];
        if (rv.stop && Math.hypot(gx - S.x[id], gy - S.y[id]) < 1.5) {
          if (d < 30) { S.state[id] = S_IDLE; M.via = null; next(); break; }
          if (M.carry?.kind === "plough") M.carry = null; else if (M.carry) dropHere(w, id, M);
          balk(w, id); stop(w, id); return false;
        }
        if (M.gwx !== gx || M.gwy !== gy) { M.gwx = gx; M.gwy = gy; M.best = -1; }
      }
      if (!M.via && WN.any(w)) { const v = WN.via(w, M.team, S.x[id], S.y[id], gx, gy, (M.gw ||= [])); if (v) { gx = v[0]; gy = v[1]; } if (M.gwx !== gx) { M.gwx = gx; M.best = -1; } }
      const dg = gx === st.x && gy === st.y ? d : Math.hypot(gx - S.x[id], gy - S.y[id]);
      // trunks, walls, buildings and other men are bodies (obstacles.js pushes him back): no headway for 3 s → step
      // round it (a detour to one side, then the other, wider each time); close by and still stuck → he is there
      if (!(M.best >= 0) || dg < M.best - 0.5) { M.best = dg; M.since = w.time; }
      else if (w.time - M.since > 3) {
        if (d < 12) { S.state[id] = S_IDLE; M.via = null; next(); break; }
        if ((M.tries || 0) >= 30) { // ~90 s of detours and no nearer: he cannot get there — give it up (his load on the ground)
          if (M.carry?.kind === "plough") M.carry = null; else if (M.carry) dropHere(w, id, M);
          stop(w, id); return false;
        }
        const t = (M.tries = (M.tries || 0) + 1), v = detour(w, S.x[id], S.y[id], gx, gy, 6 + 4 * Math.min(t, 5), t);
        M.via = [v[0], v[1], w.time]; M.since = w.time; M.best = dg;
      }
      let tx = gx, ty = gy;
      if (M.via) { if (Math.hypot(M.via[0] - S.x[id], M.via[1] - S.y[id]) < 1.5 || w.time - M.via[2] > 8) M.via = null; else { tx = M.via[0]; ty = M.via[1]; } }
      M.pose = null; moveTo(w, id, tx, ty, base * slow * (d > 25 ? E.commuteMul : 1));
      break;
    }
    case "work": case "wait": {
      if (M.dur === 0) { M.t0 = w.time; M.dur = st.secs; M.pose = st.pose || (st.op === "work" ? "work_stoop" : null); }
      if (st.x !== undefined && Math.hypot(st.x - S.x[id], st.y - S.y[id]) > 0.3) moveTo(w, id, st.x, st.y, base * 0.5);
      else if (st.op === "work") S.state[id] = S_WORK; else S.state[id] = S_IDLE;
      if (st.face) S.facing[id] = Math.atan2(st.face[1] - S.y[id], st.face[0] - S.x[id]);
      if (st.op === "work") M.md += md;
      if (w.time - M.t0 >= st.secs) { if (st.hook && HOOKS[st.hook]) HOOKS[st.hook](w, id, M, st); if (M.task) next(); }
      break;
    }
    case "take": {
      const it = itemById(w, st.item);
      if (!M.carry && (!it || it.kg <= 0)) { if (it) it.claim = 0; endTask(w, id, M); return false; }
      if (M.dur === 0 && it) { M.t0 = w.time; M.dur = STOOP_S; M.pose = "work_stoop"; if (Math.hypot(it.x - S.x[id], it.y - S.y[id]) > 0.1) S.facing[id] = Math.atan2(it.y - S.y[id], it.x - S.x[id]); }
      S.state[id] = S_WORK;
      if (w.time - M.t0 >= STOOP_S * 0.45 && !M.carry) {
        it.claim = 0;
        const kg = takeKg(w, it, st.kg === undefined ? it.kg : Math.max(st.kg, st.share ? it.kg / st.share : 0));
        if (kg > 0) M.carry = { kind: it.kind, res: it.res, kg, ...(st.cart ? { cart: true } : {}) };
      }
      if (w.time - M.t0 >= STOOP_S) next();
      break;
    }
    case "put": {
      if (!M.carry) { next(); break; }
      const b = st.b !== undefined ? w.buildings.find((x) => x.id === st.b) : null;
      if ((st.to === "store" || st.to === "site") && (!b || b.ruin || (st.to === "store" && !done(b)))) { endTask(w, id, M); return false; }
      if (M.dur === 0) { M.t0 = w.time; M.dur = STOOP_S; M.pose = "work_stoop"; }
      S.state[id] = S_WORK;
      if (w.time - M.t0 >= STOOP_S * 0.45) {
        const c = M.carry; M.carry = null;
        const T = w.teams[M.team];
        if (st.to === "store" && T?.store) { T.store[c.res] = (T.store[c.res] || 0) + c.kg; (T.stats ||= {}).delivered = (T.stats.delivered || 0) + c.kg; HOOKS["store.in"]?.(w, b, c.res, c.kg); } // (lane D: set down at an outlying camp, it is carted home — haulage.js)
        else if (st.to === "site") { b.stock ||= {}; b.stock[c.res] = (b.stock[c.res] || 0) + c.kg; }
        else if (st.to === "pile") addKg(w, sitePile(w, st.key, st.kind || c.kind, st.x ?? S.x[id], st.y ?? S.y[id], M.team, st.rot || 0), c.kg);
        else addItem(w, { kind: c.kind, res: c.res, kg: c.kg, x: st.x ?? S.x[id], y: st.y ?? S.y[id], team: M.team, loose: true, rot: S.facing[id] });
      }
      if (w.time - M.t0 >= STOOP_S) next();
      break;
    }
    case "hook": { if (HOOKS[st.name]) HOOKS[st.name](w, id, M, st); if (M.task) next(); break; }
    default: next();
  }
  return true;
}
// a way round what stops him: of the points on a ring about him, one he can walk to in a straight line, best one he can
// also see the goal from, nearest the goal (bodies: obstacles.js trunks and footprints)
const clearLine = (O, x0, y0, x1, y1) => { const L = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(L); for (let k = 1; k <= n; k++) { const f = k / n; if (blocked(O, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, 0.35)) return false; } return true; };
function detour(w, x, y, gx, gy, R, t) {
  const O = w.obstacles, a0 = Math.atan2(gy - y, gx - x); let best = null, bs = Infinity;
  for (let k = 0; k < 16; k++) {
    const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 8 + (t % 2) * 0.1, px = x + Math.cos(a) * R, py = y + Math.sin(a) * R;
    if (O && !clearLine(O, x, y, px, py)) continue;
    if (RV.deep(w, px, py)) continue; // (never round a trunk into the river)
    const sc = Math.hypot(gx - px, gy - py) + (O && !clearLine(O, px, py, gx, gy) ? 40 : 0);
    if (sc < bs) { bs = sc; best = [px, py]; }
  }
  return best || [x - Math.sin(a0) * R * (t % 2 ? 1 : -1), y + Math.cos(a0) * R * (t % 2 ? 1 : -1)];
}
function endTask(w, id, M) { M.task = null; M.pose = null; M.dur = 0; if (!M.carry && M.inB === undefined) w.labor.men.delete(id); }

// ---------------------------------------------------------------- built-in plans
// deliver-first: whatever a man holds goes to the nearest store that takes it (or down on the ground if there is none)
export function planDeliver(w, id, M) {
  const S = w.S, b = nearestStore(w, M.team, M.carry.res, S.x[id], S.y[id]);
  if (!b) return assign(w, id, "drop", [{ op: "put", to: "ground" }]);
  const [dx, dy] = doorOf(b, S.x[id], S.y[id]);
  return assign(w, id, "deliver", [{ op: "go", x: dx, y: dy, near: 1.5 }, { op: "put", to: "store", b: b.id }]);
}
// a carrier: from a site's pile to the store, one lot
export function planCarry(w, id, pile, store, lotKg, cart = false, share = 0) {
  const S = w.S, [dx, dy] = doorOf(store, pile.x, pile.y);
  const a = S.x[id] - pile.x, c = S.y[id] - pile.y, off = Math.hypot(a, c) || 1;
  return assign(w, id, "carry", [
    { op: "go", x: pile.x + a / off * 1.4, y: pile.y + c / off * 1.4, near: 1.2 },
    { op: "take", item: pile.id, kg: lotKg, cart, share },     // (share: at least 1/share of the pile, so a few carriers keep it down)
    { op: "go", x: dx, y: dy, near: 1.5 },
    { op: "put", to: "store", b: store.id },
  ]);
}
// a gleaner: fetch a loose load (dropped by the dead or the drafted) home
export function planGlean(w, id, it) {
  it.claim = 1;
  return assign(w, id, "glean", [{ op: "go", x: it.x, y: it.y, near: 1.2 }, { op: "take", item: it.id }]);
}
// the lane planners: "<kind>:<res>" first, then "<kind>"
export function plannerFor(job) { if (!job) return null; const res = job.res || job.node?.res; return (res && PLANNERS[`${job.kind}:${res}`]) || PLANNERS[job.kind] || null; }
