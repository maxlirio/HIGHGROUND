import { terrainAt } from "./landread.js";
// World: deterministic fixed-tick simulation container. No DOM, no Math.random, no Date.
import { makeRng } from "./rng.js";
import { makeSoldiers, spawnSoldier, S_IDLE, S_MOVE, S_FLEE, S_FIGHT, S_RALLY, clamp } from "./soldiers.js";
import { ARMS, ARM_BY_ID, formationSlots, formationFiles, crewSlots } from "./arms.js";
import { makeNav, findPath } from "./path.js";
import { blocked } from "./obstacles.js";
import { BATTLE_RATE, TICK as TICK_REAL } from "./clock.js";
import { locoPower, speedAtPower, horseStep } from "./physio.js";

export const VILLAGER_OBEY_TICKS = 50; // villagers linger 5 real seconds after finishing the player's order (10 ticks/s)
export const TICK = TICK_REAL; // REAL seconds per sim tick (10 Hz)
export const DT = TICK * BATTLE_RATE; // tactical (battle-clock) seconds per tick: movement, combat, fatigue
export const HASH = 4;   // spatial hash cell (m)
const HBITS = 15, HMASK = (1 << HBITS) - 1;

export function createWorld({ map, terrain = {}, seed = 1 }) {
  const w = {
    tick: 0, map, terrain, rng: makeRng(seed),
    S: makeSoldiers(4096), units: new Map(), nextUnit: 1,
    teams: [makeTeam(0, "Blue"), makeTeam(1, "Red")],
    events: [], // this tick's events (kills, flee, legend …); systems read them
    log: [],    // notable events for the UI to drain
    systems: [], // pluggable per-tick systems (combat, morale, economy …) : fn(world)
  };
  w.nav = makeNav(map, terrain);
  w.hash = { head: new Int32Array(1 << HBITS).fill(-1), next: new Int32Array(4096), key: new Int32Array(4096) };
  w.time = 0;        // battle-clock seconds
  w.features = [];   // placed FEATURES (stakes, ditches, walls, bridges): { type, x0, y0, x1, y1, ... }
  w.weather = "clear";
  return w;
}

function makeTeam(id, name) {
  return { id, name, gold: 200, res: { timber: 0, stone: 0, gold: 0, silver: 0, iron: 0, food: 0, mana: 0 } };
}

export function addUnit(w, { team, arm, count, x, y, facing = 0, formation = "line", training, depth = 0, nerve, kit, weapon, ammo }) {
  const A = ARMS[arm];
  const u = {
    id: w.nextUnit++, team, arm, members: [], formation, facing, depth,
    ax: x, ay: y, path: null, order: { kind: "hold" }, pace: "march",
    morale: 0.8, cohesion: 1, state: "formed", commander: null, legendIds: [],
  };
  u.files = formationFiles(formation, count, depth);
  const slots = unitSlots(u, count, A);
  const c = Math.cos(facing), s = Math.sin(facing);
  for (let k = 0; k < count; k++) {
    const [lx, ly] = slots[k];
    const id = spawnSoldier(w.S, w.rng, {
      x: x + lx * c - ly * s + w.rng.range(-0.3, 0.3), y: y + lx * s + ly * c + w.rng.range(-0.3, 0.3),
      team, unit: u.id, arm: A.id, training, ammo, tick: w.tick, nerve, kit, weapon,
    });
    w.S.facing[id] = facing + Math.PI / 2;
    w.S.rank[id] = slots[k][2];
    u.members.push(id);
  }
  if (formation === "wedge") wedgeOrder(w, u);
  w.units.set(u.id, u);
  return u;
}

// A wedge puts its best men at the point (battle-feel §1.3: a deep column with a narrow, elite head — the men at the
// point cannot stop because of the men behind): members ordered by harness, then skill, then nerve, so slot 0 (the
// point) and the first rows are the best-armoured and boldest. Deterministic (ties by id).
export function wedgeOrder(w, u) {
  const S = w.S, key = (i) => S.armour[i] * 2 + S.skill[i] + S.courage[i];
  u.members.sort((a, b) => key(b) - key(a) || a - b);
}

// ---------------------------------------------------------------- orders
// order = { kind: 'move'|'hold'|'fortify'|'ambush'|'assault'|'skirmish'|'gather'|'build'|'scout',
//           x, y, facing?, formation?, pace?: 'march'|'quick'|'charge' }
export function issueOrder(w, unitIds, order) {
  // Units moving together keep their relative layout around the destination.
  const units = unitIds.map((id) => w.units.get(id)).filter(Boolean);
  if (!units.length) return;
  const cx = avg(units.map((u) => u.ax)), cy = avg(units.map((u) => u.ay));
  const heading = Math.atan2(order.y - cy, order.x - cx);
  if (order.kind === "gather" || order.kind === "build") {
    for (const u of units) {
      if (!u.isWorkers) continue;
      // economy.js decides what the click means (node, field, site, workshop); see economy.jobFor
      if (w.econ?.jobFor) { const job = w.econ.jobFor(w, u, order); if (job) { u.job = job; u.haul = new Map(); u.danger = 0; u.away = false; u.playerJobUntil = 0; } continue; } // an ordered job runs until it is done
      if (order.kind === "build" && order.building) { u.job = { kind: "build", b: order.building }; continue; }
      let node = null, bd = 80;
      for (const r of w.resources || []) { const d = Math.hypot(r.x - order.x, r.y - order.y); if (d < bd && r.amount > 0) { bd = d; node = r; } }
      if (node) { u.job = { kind: "gather", res: node.res, node }; }
    }
    if (units.every((u) => u.job)) return;
  }
  // villagers aren't soldiers: they go where sent, then ~5 s after arriving drift back to their usual duties
  for (const u of units) { if (u.isWorkers) { u.away = true; u.awayUntil = w.tick + VILLAGER_OBEY_TICKS; } u.job = null; }
  for (const u of units) {
    const dx = u.ax - cx, dy = u.ay - cy;
    const o = { ...order, x: order.x + dx, y: order.y + dy, facing: order.facing ?? heading };
    // Command friction (combat-research §13): with a command system installed, orders travel by voice,
    // horn or messenger and the unit reacts late. `immediate` = pre-battle standing orders.
    if (w.command && !order.immediate) w.command.enqueue(w, u, o);
    else applyOrder(w, u, o);
  }
}

// Put an order into effect for one unit (called directly, or by the command system on delivery).
export function applyOrder(w, u, o) {
  if (w.castleOrder && (o.kind === "keep" || Number.isFinite(o.x)) && u.engine === undefined && w.castleOrder(w, u, o)) return; // castles: walls, stairs, the keep (castle.js; "keep" needs no point)
  if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) return; // a garbled or ill-formed order is no order
  if (w.siegeOrder && w.siegeOrder(w, u, o)) return;          // engines, escalades: siege.js takes the order
  const cls = ARMS[u.arm].mounted ? "cavalry" : "foot";
  u.path = findPath(w.nav, cls, u.ax, u.ay, o.x, o.y) || [[o.x, o.y]];
  u.order = o; u.orderT = w.time;
  u.pace = o.pace || "march";
  if (o.formation && (o.formation !== u.formation || (o.depth && o.depth !== u.depth))) { u.formation = o.formation; // (a new depth alone re-forms too: the frontage the player dragged out)
    u.depth = o.depth || 0; u.files = formationFiles(u.formation, u.members.length, u.depth); u.slotCache = null; if (u.formation === "wedge") wedgeOrder(w, u); }
  if (u.deployAs && o.formation) u.deployAs = null;
  // a body sent far at the march pace goes in column of route (four files, the route step) and forms again
  // as it was when it arrives or the enemy comes near: nobody walked a battle line across the country
  let far = 0; for (let k = 0, px = u.ax, py = u.ay; k < u.path.length; k++) { far += Math.hypot(u.path[k][0] - px, u.path[k][1] - py); px = u.path[k][0]; py = u.path[k][1]; }
  if (o.kind === "move" && u.pace === "march" && !o.formation && !u.isWorkers && !u.enemyNear && far > ROUTE_MIN && u.formation !== "column") {
    u.deployAs ||= { formation: u.formation, depth: u.depth };
    setFormation(u, "column", 0);
  }
  u.finalFacing = o.facing;
  if (u.disordered) { if (u.hold) u.reform = true; else clearDisorder(u); } // any order re-forms the ranks (in a fight: when it ends)
  u.hold = false;
  for (const id of u.members) if (w.S.state[id] === S_IDLE) w.S.state[id] = S_MOVE;
}

// ---------------------------------------------------------------- step
// High-frequency combat events stay in w.events only (the UI log gets the notable ones).
const QUIET = new Set(["kill", "down", "flee", "die", "horse", "rally", "captured", "shot", "refuse", "impact", "pursue", "order-arrived", "feat"]);
export function step(w) {
  w.tick++;
  w.time += DT;
  w.events.length = 0; // per-tick events; the UI reads w.log (drains it itself)
  rebuildHash(w);
  for (const u of w.units.values()) moveUnit(w, u);
  for (const sys of w.systems) sys(w);
  for (const e of w.events) if (!QUIET.has(e.kind)) w.log.push(e);
  if (w.log.length > 5000) w.log.splice(0, w.log.length - 2000); // nobody draining (headless): cap it
  for (const u of w.units.values()) compactMembers(w, u);
  for (const [id, u] of w.units) if (!u.members.length) w.units.delete(id);
}

// Remove the fallen and the departed from a unit, filling each hole from the man behind in the same file
// (rear ranks replace the fallen, §5) so the rest of the formation does not reshuffle.
function compactMembers(w, u) {
  const S = w.S, m = u.members, f = u.files || 1;
  let holes = 0;
  for (let k = 0; k < m.length; k++) if (!S.alive[m[k]] || S.unit[m[k]] !== u.id) { m[k] = -1; holes++; }
  if (!holes) return;
  for (let k = 0; k < m.length; k++) {
    if (m[k] !== -1) continue;
    for (let j = k + f; j < m.length; j += f) if (m[j] !== -1) { m[k] = m[j]; m[j] = -1; break; }
  }
  u.members = m.filter((id) => id !== -1);
  u.slotCache = null;
}

function rebuildHash(w) {
  const S = w.S, H = w.hash;
  if (H.next.length < S.cap) { H.next = new Int32Array(S.cap); H.key = new Int32Array(S.cap); }
  H.head.fill(-1);
  const head = H.head, next = H.next, key = H.key;
  for (let i = 0; i < S.n; i++) {
    if (!S.alive[i]) continue;
    const ci = (S.x[i] / HASH) | 0, cj = (S.y[i] / HASH) | 0, slot = ((ci * 73856093) ^ (cj * 19349663)) & HMASK;
    key[i] = ci * 65536 + cj; next[i] = head[slot]; head[slot] = i;
  }
}

export function neighbours(w, x, y, r, out = []) {
  out.length = 0;
  const S = w.S, H = w.hash, head = H.head, next = H.next, key = H.key, r2 = r * r, X = S.x, Y = S.y;
  const c0 = ((x - r) / HASH) | 0, c1 = ((x + r) / HASH) | 0, r0 = ((y - r) / HASH) | 0, r1 = ((y + r) / HASH) | 0;
  for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++) {
    const k = i * 65536 + j;
    for (let id = head[((i * 73856093) ^ (j * 19349663)) & HMASK]; id >= 0; id = next[id]) {
      if (key[id] !== k) continue;
      const dx = X[id] - x, dy = Y[id] - y;
      if (dx * dx + dy * dy <= r2) out.push(id);
    }
  }
  return out;
}

// Terrain speed multiplier for a soldier at (x,y) heading (dx,dy).
const GOING_FLOOR = 0.06, FOOT_CHASE_HORSE = 150;
export function goingMul(w, arm, x, y, dx, dy) {
  const A = ARM_BY_ID[arm], cls = A.mounted ? "cavalry" : A.armour >= 4 ? "heavyFoot" : "foot";
  const t = terrainAt(w, x, y);
  let m = t?.moveMul?.[cls] ?? t?.moveMul?.foot ?? 1;
  const grade = w.map.gradeAlong(x, y, dx, dy);
  // Tobler hiking function, normalised to 1 on flat ground (ELEVATION.footSpeed); armour climbs worse
  m *= Math.exp(-3.5 * Math.abs(grade + 0.05)) / Math.exp(-3.5 * 0.05);
  if (cls === "heavyFoot" && grade > 0) m *= Math.max(0.5, 1 - 0.6 * grade);
  const wd = w.map.water(x, y);
  if (wd > 0.05) m *= wd > (A.mounted ? 1.6 : 1.3) ? 0.03 : clamp(1 - wd * (A.mounted ? 0.4 : 0.7), 0.1, 1); // >1.3 m: swimming, not wading (TERRAIN.deep_water)
  if (w.goingHook) m *= w.goingHook(x, y, cls); // bodies on the ground, stakes, ditches (combat)
  return m;
}

function unitSlots(u, n, A) {
  if (u.slotCache && u.slotCache.n === n && u.slotCache.f === u.formation) return u.slotCache.s;
  if (A.engine) { const s = crewSlots(A, n); u.slotCache = { n, f: u.formation, s }; return s; } // round their engine (siege.js)
  const fixed = u.formation === "line" || u.formation === "deep" || u.formation === "loose" || u.formation === "shallow";
  const s = formationSlots(u.formation, n, A.spacing, fixed && u.files ? -u.files : u.depth, A.rankDepth || 0);
  u.slotCache = { n, f: u.formation, s };
  return s;
}

const tmp = [];
function moveUnit(w, u) {
  const S = w.S, A = ARMS[u.arm], ids = u.members; if (!ids.length || u.job) return;
  if (u.cst && w.castleMove && w.castleMove(w, u)) return; // a body inside a castle: castle.js walks its men (levels, stairs)
  if (u.order.kind === "assault" && w.tick % 5 === u.id % 5) {
    // close with the nearest enemy body near the ordered point (a routing body is chased where its men are)
    let best = null, bd = 400;
    const named = u.order.target !== undefined ? w.units.get(u.order.target) : null; // a named target is chased to the end
    if (named && named.members.length && named.team !== u.team) best = named;
    else for (const v of w.units.values()) { if (v.team === u.team || !v.members.length) continue; const d = Math.hypot((v.fx ?? v.ax) - u.order.x, (v.fy ?? v.ay) - u.order.y); if (d < bd) { bd = d; best = v; } }
    // foot does not chase horse across the country: a body of foot whose quarry is a mounted body that has drawn
    // off out of reach stops and stands where it is (Courtrai's Flemings, Bannockburn's schiltrons, every
    // infantry that ever saw horsemen ride away from it)
    if (best && !ARMS[u.arm].mounted && ARMS[best.arm]?.mounted && !best.c?.broken && Math.hypot((best.fx ?? best.ax) - u.ax, (best.fy ?? best.ay) - u.ay) > FOOT_CHASE_HORSE) {
      u.order = { kind: "hold", x: u.ax, y: u.ay, facing: u.facing + Math.PI / 2 }; u.path = null; u.finalFacing = Math.atan2((best.fy ?? best.ay) - u.ay, (best.fx ?? best.ax) - u.ax); best = null;
    }
    if (best) {
      const bx = best.fx ?? best.ax, by = best.fy ?? best.ay;
      // behind walls (siege.js / navblock.js: some nav cells are closed) a straight line runs into the curtain:
      // a body going for men beyond it follows the nav through a gate or a breach, re-planned every 5 s
      // (and a body that has found itself bogged on the straight line — a marsh horses cannot cross — goes round by the nav)
      if ((w.navBlk?.cnt.size || (u.bogT !== undefined && w.time - u.bogT < 40)) && Math.hypot(bx - u.ax, by - u.ay) > 60) {
        if (!u.aPath || w.tick - u.aPath.t > 50 || Math.hypot(u.aPath.x - bx, u.aPath.y - by) > 40) { u.aPath = { t: w.tick, x: bx, y: by }; u.path = findPath(w.nav, ARMS[u.arm].mounted ? "cavalry" : "foot", u.ax, u.ay, bx, by) || [[bx, by]]; }
      } else u.path = [[bx, by]];
      u.finalFacing = Math.atan2(by - u.ay, bx - u.ax); u.order.x = bx; u.order.y = by;
    }
  }
  // --- advance the anchor along the path at the pace of the formation (not while locked in contact: combat owns it)
  let moving = false;
  if (u.path && u.path.length && !u.hold) {
    const [px, py] = u.path[0]; const dx = px - u.ax, dy = py - u.ay, d = Math.hypot(dx, dy);
    const sp = paceSpeed(u, A);
    // formation moves at the speed of its slowest part: sample going at anchor and 3 m ahead — but a thin line
    // (a hedge, a ditch, a fence: a band ~3 m wide) is crossed once, where the anchor stands in it, not also for
    // the 3 m before it: the ground ahead only counts when it is still as bad 6 m on (a wood, a bog, a ford).
    // (min(anchor, 3 m ahead) had every body crawl at the going floor for the whole approach to each of the
    // Vale's hedges — knights at 0.1 m/s for half a minute before a hedge they then crossed in seconds)
    const ux = dx / (d || 1), uy = dy / (d || 1);
    const gAt = goingMul(w, A.id, u.ax, u.ay, dx, dy);
    let g = gAt;
    const g3 = goingMul(w, A.id, u.ax + ux * 3, u.ay + uy * 3, dx, dy);
    if (g3 < g) g = Math.min(g, Math.max(g3, goingMul(w, A.id, u.ax + ux * 6, u.ay + uy * 6, dx, dy)));
    // sent to a spot in ground this arm cannot bear at all (horses into a marsh, foot into deep water — the AI's
    // hold points and a player's click both land there): the body goes as far as the edge and stands there,
    // its order done. It used to "go on" at the going floor — 0.1 m/s for ever, or not at all with the enemy near.
    const bear = A.mounted ? GOING_FLOOR : 0.03;
    let edge = false;
    const storm = u.order.kind === "assault" || u.order.kind === "escalade"; // (stormers go down into a castle's ditch and up the other side: siege.js)
    if (g < bear && gAt >= bear && !storm && !(u.c && u.c.phase && u.c.phase !== "idle")) {
      const L = u.path[u.path.length - 1];
      edge = goingMul(w, A.id, L[0], L[1], L[0] - u.ax, L[1] - u.ay) < bear;
    }
    // the route itself runs into ground that will not bear it (the 25 m nav cells sample only their corners, and a
    // bog between two corners is invisible to it): the body casts about for firm ground to either side and goes
    // round by it, instead of floundering across at the going floor for half a minute. (Assaults keep their own
    // re-planning, u.bogT; a few detours per order at most, so a body in a real maze still pushes on.)
    if (!edge && g < bear && gAt >= bear && !storm && (u.detour?.o !== u.order || u.detour.n < 6) && !(u.c && u.c.phase && u.c.phase !== "idle")) {
      const base = Math.atan2(dy, dx);
      for (const off of [0.5, -0.5, 0.9, -0.9, 1.3, -1.3, 1.7, -1.7]) {
        const a = base + off, cx = Math.cos(a), cy = Math.sin(a);
        if (goingMul(w, A.id, u.ax + cx * 6, u.ay + cy * 6, cx, cy) < 0.15 || goingMul(w, A.id, u.ax + cx * 12, u.ay + cy * 12, cx, cy) < 0.15) continue;
        if (u.detour?.o !== u.order) u.detour = { o: u.order, n: 0 };
        u.detour.n++; u.path.unshift([u.ax + cx * 12, u.ay + cy * 12]);
        break;
      }
    }
    if (edge) u.path = null;
    else {
      // (bog that will not carry a horse at any pace still lets a troop of horse be led out at a flounder — the land
      // reader's 0 for horses in marsh is for charging and flight, not for walking your horses out of it)
      if (A.mounted && g < GOING_FLOOR && w.map.water(u.ax, u.ay) < 1.1) g = GOING_FLOOR;
      // ground the coarse route called passable but that will not bear this arm (a thicket or rock band the 25 m
      // nav cells missed): the column does not stand before it for ever — its men pick their way round it one by
      // one (steer), and the body's centre goes on at a crawl behind them
      let gA = g;
      if (g < 0.03 && !u.hold) { u.stallS = (u.stallS || 0) + DT; if (u.stallS > 2) { u.bogT = w.time; if (!u.enemyNear && !(u.c && u.c.phase && u.c.phase !== "idle")) gA = 0.12; } }
      else u.stallS = 0;
      const lag = u.c && (u.c.phase === "pursuit" || u.c.phase === "charge" || (u.c.phase === "recoil" && u.c.rodeThrough) || u.c.tgtRouting) ? 0 : unitLag(w, u); // a pursuit or a charge waits for nobody
      // (a loose body's men stand far apart and drift further from their places without being lost — its lag counts
      // in its own spacing; and a body waits for its men, it does not stop for them: never below 30 % of its pace)
      const lagN = lag / (u.formation === "loose" ? 2.4 : 1);
      const v = sp * gA * clamp(1.2 - lagN / 12, 0.3, 1) * (u.speedMul ?? 1) * DT;
      if (d <= v) { u.ax = px; u.ay = py; u.path.shift(); } else { u.ax += dx / d * v; u.ay += dy / d * v; }
      const want = Math.atan2(dy, dx) - Math.PI / 2;
      if (d > 2) u.facing = turnToward(u.facing, want, 0.3);
      moving = true;
      if (!u.path.length) u.path = null;
    }
  } else if (u.finalFacing !== undefined && !u.hold) {
    u.facing = turnToward(u.facing, u.finalFacing - Math.PI / 2, 0.15);
  }
  u.moving = moving;
  if (u.deployAs && (!u.path || u.enemyNear)) { setFormation(u, u.deployAs.formation, u.deployAs.depth); u.deployAs = null; } // arrived, or the enemy is near: form
  // --- soldiers steer to their slots
  const slots = unitSlots(u, ids.length, A);
  const c = Math.cos(u.facing), s = Math.sin(u.facing), t = w.time;
  for (let k = 0; k < ids.length; k++) {
    const id = ids[k];
    const [lx, ly, rank] = slots[k];
    S.rank[id] = rank;
    const sq = u.squeeze ? 1 - u.squeeze : 1; // (flank fire has squeezed the files toward the middle: combat.unitUpdate)
    let tx = u.ax + lx * sq * c - ly * s, ty = u.ay + lx * sq * s + ly * c;
    // area awareness: a slot that falls inside a building, trunk or hedge moves to the nearest open
    // ground (searched outward, preferring the side toward the unit's centre) — the line bends round it
    const wet = (x, y) => !A.mounted && w.map.water(x, y) > 0.9; // (a place in a river is no place: slots move to dry ground as out of a wall)
    if (w.obstacles && !w.noSlotFix && (blocked(w.obstacles, tx, ty, 0.9) || wet(tx, ty))) {
      // cache per (slot, where the formation stands) so this runs once per re-form, not every tick
      const fix = (u.slotFix ||= new Map()), key = `${k}|${Math.round(u.ax)}|${Math.round(u.ay)}|${Math.round(u.facing * 20)}`;
      let f = fix.get(key);
      if (!f) {
        const used = (u.slotUsed ||= new Map()), ukey = `${Math.round(u.ax)}|${Math.round(u.ay)}|${Math.round(u.facing * 20)}`;
        let taken = used.get(ukey); if (!taken) { if (used.size > 20) used.clear(); used.set(ukey, (taken = [])); }
        f = [tx, ty];
        const bx = u.ax - tx, by = u.ay - ty, bl = Math.hypot(bx, by) || 1;
        search: for (let r = 1.0; r <= 20; r += 0.8) for (let a = 0; a < 16; a++) {
          const ang = Math.atan2(by / bl, bx / bl) + (a % 2 ? 1 : -1) * Math.ceil(a / 2) * 0.4;
          const qx = tx + Math.cos(ang) * r, qy = ty + Math.sin(ang) * r;
          if (blocked(w.obstacles, qx, qy, 1.3) || wet(qx, qy)) continue;            // a step clear of the wall (or the water)
          if (taken.some(([ox, oy]) => (ox - qx) ** 2 + (oy - qy) ** 2 < 0.8)) continue; // another man's spot
          f = [qx, qy]; taken.push(f); break search;
        }
        if (fix.size > 4000) fix.clear();
        fix.set(key, f);
      }
      tx = f[0]; ty = f[1];
    }
    if (u.disordered) {
      // out of their ranks: each man keeps the spot he has come to (drifting back toward his fellows if he is far
      // out), and goes for an enemy near him on his own; the body moves as a crowd until it is formed again
      if (!moving && S.state[id] !== S_FIGHT) { S.loX[id] = S.x[id] - u.ax; S.loY[id] = S.y[id] - u.ay; }
      const lr = Math.hypot(S.loX[id], S.loY[id]), R = 6 + Math.sqrt(ids.length) * 1.4;
      if (lr > R) { const k = 1 - Math.min(0.02, (lr - R) * 0.002); S.loX[id] *= k; S.loY[id] *= k; }
      tx = u.ax + S.loX[id]; ty = u.ay + S.loY[id];
      const f = S.foe[id];
      if (f >= 0 && S.state[id] !== S_FIGHT && S.alive[f] && S.team[f] !== u.team) { const dx = S.x[f] - S.x[id], dy = S.y[f] - S.y[id], dl = Math.hypot(dx, dy) || 1, st = Math.max(0, dl - 1.6); tx = S.x[id] + dx / dl * st; ty = S.y[id] + dy / dl * st; }
    }
    S.slotX[id] = tx; S.slotY[id] = ty;
    const st = S.state[id];
    if (st === S_FLEE || st === S_FIGHT || st === S_RALLY || S.posture[id] || S.busyT[id] > t) continue; // combat moves these
    if (!moving && !u.hold) { // standing easy: men shift their feet, step out, lean on a spear, turn to talk
      const dur = (50 + ((id * 2654435761) >>> 0) % 110) * 0.4, e = Math.floor((w.time + id * 5.2) / dur); // (20–64 battle-s between shifts of his feet)
      const h1 = (((id + 1) * 73856093 ^ e * 19349663) >>> 0) / 4294967296, h2 = (((id + 7) * 83492791 ^ e * 2654435761) >>> 0) / 4294967296;
      const amp = u.formation === "loose" ? 1.4 : 0.45;
      steer(w, id, A, tx + (h1 - 0.5) * amp * 2, ty + (h2 - 0.5) * amp * 2, false, u);
      if (h1 > 0.85) S.facing[id] += (h2 - 0.5) * 0.08; // glance aside
      continue;
    }
    steer(w, id, A, tx, ty, moving || (u.disordered && S.foe[id] >= 0), u);
  }
}

// A body out of its ranks (a charge through it, men thrown aside, a melee that has become a brawl): see moveUnit.
export function setDisorder(w, u) {
  if (u.engine !== undefined || u.isWorkers) return;
  u.disT = w.time; u.calmT = 0;
  if (u.disordered) return;
  u.disordered = true; u.reform = false;
  const S = w.S; let x = 0, y = 0, n = 0;
  for (const id of u.members) if (S.alive[id]) { x += S.x[id]; y += S.y[id]; n++; }
  if (n && !u.hold) { u.ax = x / n; u.ay = y / n; }
  for (const id of u.members) { S.loX[id] = S.x[id] - u.ax; S.loY[id] = S.y[id] - u.ay; }
  w.events.push({ t: w.tick, kind: "unit-disordered", unit: u.id, team: u.team });
}
export function clearDisorder(u) { u.disordered = false; u.reform = false; u.calmT = 0; }

// Bodies are bodies (the owner: "units in a clump actually go INTO each other"): a man is a disc ~0.5 m across, a horse
// an oval 2.6 m long and 1.1 m wide along its facing. Every overlap pushes the two apart in proportion to how deep
// it is (m/s), and a body deep inside another is shoved half the way out at once. Returns [vx, vy] in m/s.
const SEP = [0, 0], FOOT_R = 0.26, HORSE_A = 1.3, HORSE_L = 0.55;
export function bodyPush(w, S, id, out) {
  out[0] = 0; out[1] = 0;
  const H = w.hash, head = H.head, next = H.next, key = H.key, X = S.x, Y = S.y, x = X[id], y = Y[id], LV = S.lvl, myL = LV[id];
  const meH = S.horseOK[id] === 1, r = meH ? HORSE_A + FOOT_R + 0.3 : 2 * FOOT_R + 0.05, r2 = r * r; // (a man need not look for horses: they push themselves off him)
  const c0 = ((x - r) / HASH) | 0, c1 = ((x + r) / HASH) | 0, r0 = ((y - r) / HASH) | 0, r1 = ((y + r) / HASH) | 0;
  for (let i = c0; i <= c1; i++) for (let j = r0; j <= r1; j++) {
    const k = i * 65536 + j;
    for (let o = head[((i * 73856093) ^ (j * 19349663)) & HMASK]; o >= 0; o = next[o]) {
      if (key[o] !== k || o === id || !S.alive[o] || S.posture[o] || LV[o] !== myL) continue; // (bodies on another level — a wall-walk above — do not touch)
      const ox = x - X[o], oy = y - Y[o], q = ox * ox + oy * oy;
      if (q > r2) continue;
      const od = Math.sqrt(q) || 0.01, oH = S.horseOK[o] === 1;
      if (!meH && !oH && S.team[o] !== S.team[id]) continue; // (foot against a foot foe: combat keeps them at weapon's length — pushing here too was a side bias, §17.1 mirror)
      let e; // normalised separation: < 1 = overlapping
      if (!meH && !oH) e = od / (2 * FOOT_R);
      else {
        // in the horse's frame (the bigger body's): along its length and across it, against its oval grown by the other body
        const h = meH ? id : o, f = S.facing[h], cf = Math.cos(f), sf = Math.sin(f);
        const along = Math.abs(ox * cf + oy * sf), lat = Math.abs(-ox * sf + oy * cf);
        const ga = (meH && oH ? 2 * HORSE_A : HORSE_A + FOOT_R), gl = (meH && oH ? 2 * HORSE_L : HORSE_L + FOOT_R);
        e = Math.sqrt((along / ga) ** 2 + (lat / gl) ** 2);
      }
      if (e >= 1) continue;
      const push = (1 - e) * (e < 0.5 ? 4 : 2) * (oH && !meH ? 1.5 : 1); // m/s: deeper = harder (a man shoves off a horse)
      out[0] += ox / od * push; out[1] += oy / od * push;
    }
  }
  const m = Math.hypot(out[0], out[1]); if (m > 3) { out[0] *= 3 / m; out[1] *= 3 / m; }
  return out;
}

const ROUTE_MIN = 400; // m: a move longer than this is made in column of route
function setFormation(u, formation, depth) { u.formation = formation; u.depth = depth || 0; u.files = formationFiles(formation, u.members.length, u.depth); u.slotCache = null; }

// The pace a body is ordered to keep (m/s, before the going). A.speed is the pace of a FORMED body — a line
// or block keeping its dressing. A column on the march (pace "march", formation "column") is at the route
// step: files need no dressing, and a medieval host on the road made 4.5–5.5 km/h (1.3–1.5 m/s: A.speed ×
// COLUMN_STEP). `u.paceCap` (set by a general marching several bodies as one column) holds each to the pace
// of the slowest, so the column does not string out and halt, string out and halt.
export const COLUMN_STEP = 1.15;
function paceSpeed(u, A) {
  const run = u.runSpeed || A.run;
  // (the route step is for the road: within sight of the enemy a column closes up and keeps its order —
  // a column crossing a bridge under the enemy's eyes, Stirling, is not on a route march)
  let sp = u.pace === "charge" ? run : u.pace === "quick" ? Math.min(run, A.mounted ? 4.2 : A.speed * 1.5) : A.speed * (u.formation === "column" && !u.enemyNear ? COLUMN_STEP : 1);
  if (u.paceCap && u.pace === "march") sp = Math.min(sp, u.paceCap);
  return sp;
}

// A man's share of the body's lag is capped: a whole body strung out slows right down to wait for its men (mean
// 12 m → 20 % pace), but three riders lost 120 m back behind a hedge no longer hold twenty at a crawl for a minute
// (uncapped, their 125 m each made the mean 19 m and the body crept at the 15 % floor while they paced the hedge).
const LAG_CAP = 12;
function unitLag(w, u) {
  // mean distance of soldiers from their slots: a formation disordered by woods has to slow down
  const S = w.S; let sum = 0, n = 0;
  for (const id of u.members) { if (S.slotX[id] === 0 && S.slotY[id] === 0) continue; if (S.state[id] === S_FIGHT || S.state[id] === S_FLEE) continue; const q = Math.hypot(S.x[id] - S.slotX[id], S.y[id] - S.slotY[id]); if (q > 25 && !u.enemyNear) continue; sum += Math.min(q, LAG_CAP); n++; } // (on the march, a man caught behind a tree far back is not waited for: he finds his own way up; with the enemy near, the body waits for its men)
  return n ? sum / n : 0;
}

export function steer(w, id, A, tx, ty, moving, u) {
  const S = w.S; const dx = tx - S.x[id], dy = ty - S.y[id], d = Math.hypot(dx, dy);
  if (d <= 0.4 && !moving) {
    // in place: no stride; jostle only now and then (every 4th tick, staggered) — standing blocks are cheap
    S.vx[id] = 0; S.vy[id] = 0; S.power[id] = 100; S.state[id] = S_IDLE;
    if (u.formation === "schiltron") S.facing[id] = Math.atan2(S.y[id] - u.ay, S.x[id] - u.ax);
    if (!(A.mounted && S.horseOK[id] === 1)) {} else horseStep(S, id, 0, DT);
    if (((w.tick + id) & 1) === 0) { // (standing men shuffle apart too — every other tick, over two ticks' time)
      const sep = bodyPush(w, S, id, SEP);
      if (sep[0] || sep[1]) { S.x[id] = clamp(S.x[id] + sep[0] * 2 * DT, 0, w.map.size); S.y[id] = clamp(S.y[id] + sep[1] * 2 * DT, 0, w.map.size); }
    }
    return;
  }
  // terrain going and grade are re-read every 4th tick per man (staggered): ground changes slower than feet
  let g = S.gMul[id];
  if (S.lvl[id]) { g = S.gMul[id] = 1; S.gGrade[id] = 0; S.gEta[id] = 1.1; } // (castle.js: a wall-walk or a floor is paved going — the ground's going, and the wall's "impassable", are below him)
  else if (((w.tick + id) & 3) === 0 || !g) { g = S.gMul[id] = Math.max(A.mounted && w.map.water(S.x[id], S.y[id]) < 1.1 ? GOING_FLOOR : 0, goingMul(w, A.id, S.x[id], S.y[id], dx, dy)) || 0.02; S.gGrade[id] = w.map.gradeAlong(S.x[id], S.y[id], dx, dy); S.gEta[id] = terrainAt(w, S.x[id], S.y[id])?.fatigueMul ?? 1.1; }
  // a man (or horse) who finds the ground at his feet will not bear him — a thorn brake, a rock band — steps
  // round it: the nearest heading off his line whose going will take him (he rejoins his file beyond it)
  let ux = d > 0.01 ? dx / d : 0, uy = d > 0.01 ? dy / d : 0;
  if (g < 0.05 && d > 0.4) {
    for (const off of [0.7, -0.7, 1.4, -1.4]) {
      const c = Math.cos(off), sn = Math.sin(off), hx = ux * c - uy * sn, hy = ux * sn + uy * c;
      const gg = goingMul(w, A.id, S.x[id] + hx * 1.5, S.y[id] + hy * 1.5, hx, hy);
      if (gg >= 0.15) { ux = hx; uy = hy; g = gg; break; }
    }
    // standing in ground that will not bear him at all (swept into a river, pushed into a bog): he does not freeze
    // there for ever — he flounders toward the nearest ground that will, at a flounder's pace
    if (g < 0.05 && goingMul(w, A.id, S.x[id], S.y[id], ux, uy) < 0.05) {
      let bx = 0, by = 0, bg = 0;
      for (let a = 0; a < 8; a++) { const cx = Math.cos(a * 0.785), cy = Math.sin(a * 0.785); for (const r of [3, 6, 10]) { const gg = goingMul(w, A.id, S.x[id] + cx * r, S.y[id] + cy * r, cx, cy) / r; if (gg > bg) { bg = gg; bx = cx; by = cy; } } }
      if (bg > 0) { ux = bx; uy = by; g = 0.25; }
    }
  }
  // look ahead: a wall, house or trunk in the way — pick a clear heading round it and KEEP that heading
  // (a world direction, not "left of the target", which flips as he walks) until the way to his slot clears
  if (w.obstacles && d > 1.2 && !blocked(w.obstacles, S.x[id], S.y[id], 0)) { // (a man already inside one walks straight out of it)
    const look = Math.min(2.5, d);
    const av = (S.avoid ||= new Float32Array(S.cap * 2));
    const hasAv = av[id * 2] !== 0 || av[id * 2 + 1] !== 0;
    if (hasAv || ((w.tick + id) & 1) === 0) {
      if (blocked(w.obstacles, S.x[id] + ux * look, S.y[id] + uy * look, 0.35)) {
        let hx = av[id * 2], hy = av[id * 2 + 1];
        if (!hasAv || blocked(w.obstacles, S.x[id] + hx * look, S.y[id] + hy * look, 0)) {
          let best = null;
          for (const off of [0.5, -0.5, 0.9, -0.9, 1.3, -1.3, 1.57, -1.57, 1.9, -1.9]) {
            const o = (id & 1) ? off : -off, c = Math.cos(o), sn = Math.sin(o), qx = ux * c - uy * sn, qy = ux * sn + uy * c;
            if (hasAv && qx * av[id * 2] + qy * av[id * 2 + 1] < -0.2) continue; // never double back on the detour
            if (!blocked(w.obstacles, S.x[id] + qx * look, S.y[id] + qy * look, Math.abs(off) >= 1.3 ? 0 : 0.35)) { best = [qx, qy]; break; }
          }
          if (best) { hx = best[0]; hy = best[1]; av[id * 2] = hx; av[id * 2 + 1] = hy; }
        }
        if (av[id * 2] !== 0 || av[id * 2 + 1] !== 0) { ux = av[id * 2]; uy = av[id * 2 + 1]; }
      } else { av[id * 2] = 0; av[id * 2 + 1] = 0; }
    }
  }
  const run = u.runSpeed || A.run;
  // catch-up is proportional: keep the formation's pace plus a little per metre out of place; quickstep to
  // close gaps, run only on a quick/charge pace or when badly strung out (>25 m). Marching costs little (§6.1).
  const pace = paceSpeed(u, A);
  const base = moving ? pace : 0;
  const cap = u.pace === "charge" ? run : d > 25 ? run * 0.8 : u.pace === "quick" ? Math.min(run, A.mounted ? 5.5 : 2.6) : Math.min(run, A.mounted ? 3.0 : 2.0); // (a horse's trot is a man's run)
  let want = d > 0.4 ? Math.min(cap, base + 0.5 * d, base + d / DT) : 0;
  // physiology: once W′ is spent a man can only move at the speed his critical power sustains (§6)
  if (!A.mounted && want > 1.4 && S.wbal[id] < 0.2 * S.wp[id]) want = Math.min(want, speedAtPower(S, id, S.cp[id], 0, 1.1));
  if (A.mounted && S.horseOK[id] === 1 && S.hwbal[id] < 60) want = Math.min(want, 3.6); // blown horse: a trot at best
  if (A.mounted && S.horseOK[id] !== 1) want = Math.min(want, 1.3);                  // unhorsed
  const v = want * g;
  // separation from neighbours (crowding): bodies do not pass into bodies (bodyPush)
  const sep = bodyPush(w, S, id, SEP); let sx = sep[0], sy = sep[1];
  let vx = ux * v + sx, vy = uy * v + sy;
  S.vx[id] = vx; S.vy[id] = vy;
  S.x[id] = clamp(S.x[id] + vx * DT, 0, w.map.size); S.y[id] = clamp(S.y[id] + vy * DT, 0, w.map.size);
  if (d > 0.4) S.facing[id] = Math.atan2(dy, dx);
  else S.facing[id] = u.formation === "schiltron" ? Math.atan2(S.y[id] - u.ay, S.x[id] - u.ax) : u.facing + Math.PI / 2; // a ring faces out
  // locomotion power (Pandolf) feeds the W′ balance, integrated by the combat system (§6.1); the shuffle
  // of crowding is not locomotion, so only the intended stride counts
  const sp = v;
  if (A.mounted && S.horseOK[id] === 1) { S.power[id] = sp > 5 ? 250 : 130; horseStep(S, id, sp, DT); }
  else S.power[id] = locoPower(S, id, sp, S.gGrade[id] * 100, S.gEta[id] || 1.1);
  S.state[id] = d > 0.8 || moving ? S_MOVE : S_IDLE;
}

function turnToward(a, b, rate) {
  let d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return a + clamp(d, -rate, rate);
}
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// ---------------------------------------------------------------- display grouping
// A unit's soldiers that are together form a GROUP (glyph + count label). Stragglers are bare dots.
export function groupsOf(w, u, radius = 30) {
  const S = w.S; const ids = u.members; if (!ids.length) return { groups: [], loners: [] };
  let cx = 0, cy = 0; for (const id of ids) { cx += S.x[id]; cy += S.y[id]; } cx /= ids.length; cy /= ids.length;
  const main = [], loners = [];
  for (const id of ids) (Math.hypot(S.x[id] - cx, S.y[id] - cy) < radius + Math.sqrt(ids.length) * 1.2 ? main : loners).push(id);
  const groups = [];
  if (main.length >= 2) {
    let gx = 0, gy = 0; for (const id of main) { gx += S.x[id]; gy += S.y[id]; }
    groups.push({ x: gx / main.length, y: gy / main.length, count: main.length, ids: main });
  } else loners.push(...main);
  return { groups, loners };
}

// Box-selecting part of a unit detaches those men as a new unit (same arm, same state).
export function splitUnit(w, u, ids) {
  if (ids.length === u.members.length) return u;
  const set = new Set(ids);
  const S = w.S; let cx = 0, cy = 0; for (const id of ids) { cx += S.x[id]; cy += S.y[id]; }
  const nu = { ...u, id: w.nextUnit++, members: ids.slice(), ax: cx / ids.length, ay: cy / ids.length, path: null, order: { kind: "hold" }, legendIds: [], slotCache: null, c: null, hold: false };
  nu.files = formationFiles(nu.formation, ids.length, nu.depth || 0); u.slotCache = null;
  for (const id of ids) S.unit[id] = nu.id;
  u.members = u.members.filter((id) => !set.has(id));
  w.units.set(nu.id, nu);
  return nu;
}

// Several units given one order can be merged into one body (only same arm).
export function mergeUnits(w, units) {
  const [a, ...rest] = units;
  for (const b of rest) { if (b.arm !== a.arm) continue; for (const id of b.members) w.S.unit[id] = a.id; a.members.push(...b.members); w.units.delete(b.id); }
  a.slotCache = null; a.files = formationFiles(a.formation, a.members.length, a.depth || 0);
  return a;
}
