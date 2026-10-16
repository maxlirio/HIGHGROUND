import { terrainAt, cavGoing } from "./landread.js";
// World: deterministic fixed-tick simulation container. No DOM, no Math.random, no Date.
import { makeRng } from "./rng.js";
import { isFoe } from "./sides.js";
import { makeSoldiers, spawnSoldier, S_IDLE, S_MOVE, S_FLEE, S_FIGHT, S_RALLY, clamp } from "./soldiers.js";
import { ARMS, ARM_BY_ID, formationSlots, formationFiles, crewSlots } from "./arms.js";
import { makeNav, findPath, wetBetween } from "./path.js";
import { routeOrder, crossingTick } from "./crossings.js";
import * as WN from "./wallnav.js";
import { blocked } from "./obstacles.js";
import { BATTLE_RATE, TICK as TICK_REAL } from "./clock.js";
import { locoPower, speedAtPower, horseStep } from "./physio.js";
import { MOUNTS, MOUNT_ID, M_SPDA, M_SPD, MNT_DRAKE } from "./mounts.js";

export const VILLAGER_OBEY_TICKS = 50; // villagers linger 5 real seconds after finishing the player's order (10 ticks/s)
export const TICK = TICK_REAL; // REAL seconds per sim tick (10 Hz)
export const DT = TICK * BATTLE_RATE; // tactical (battle-clock) seconds per tick: movement, combat, fatigue
export const HASH = 4;   // spatial hash cell (m)
const HBITS = 15, HMASK = (1 << HBITS) - 1;

export function createWorld({ map, terrain = {}, seed = 1, nav = true }) {
  const w = {
    tick: 0, map, terrain, seed, rng: makeRng(seed),
    S: makeSoldiers(4096), units: new Map(), nextUnit: 1,
    teams: [makeTeam(0, "Blue"), makeTeam(1, "Red")],
    events: [], // this tick's events (kills, flee, legend …); systems read them
    log: [],    // notable events for the UI to drain
    systems: [], // pluggable per-tick systems (combat, morale, economy …) : fn(world)
  };
  w.nav = nav ? makeNav(map, terrain) : null; // (nav: false — the realm's browser, a window on the server's world, plans no routes)
  w.hash = { head: new Int32Array(1 << HBITS).fill(-1), next: new Int32Array(4096), key: new Int32Array(4096) };
  w.time = 0;        // battle-clock seconds
  w.features = [];   // placed FEATURES (stakes, ditches, walls, bridges): { type, x0, y0, x1, y1, ... }
  w.weather = "clear";
  return w;
}

function makeTeam(id, name) {
  return { id, name, gold: 200, res: { timber: 0, stone: 0, gold: 0, silver: 0, iron: 0, food: 0, mana: 0 } };
}

const FREE = [0, 0];
export function addUnit(w, { team, arm, count, x, y, facing = 0, formation = "line", training, depth = 0, nerve, kit, weapon, ammo, mount }) {
  const A = ARMS[arm];
  const u = {
    id: w.nextUnit++, team, arm, members: [], formation, facing, depth,
    ax: x, ay: y, path: null, order: { kind: "hold" }, pace: "march",
    morale: 0.8, cohesion: 1, state: "formed", commander: null, legendIds: [],
  };
  const mnt = A.horse ? MOUNT_ID[mount] || 0 : 0; // a company raised on striders/drakes (js/sim/mounts.js); 0 = the arm's own horse
  if (mnt) { u.mount = mount; u.mnt = mnt; u.runSpeed = A.run * (A.armour >= 4 ? M_SPDA : M_SPD)[mnt]; }
  u.files = formationFiles(formation, count, depth);
  const slots = unitSlots(u, count, A);
  const c = Math.cos(facing), s = Math.sin(facing);
  for (let k = 0; k < count; k++) {
    const [lx, ly] = slots[k];
    let sx = x + lx * c - ly * s + w.rng.range(-0.3, 0.3), sy = y + lx * s + ly * c + w.rng.range(-0.3, 0.3);
    if (w.castleFree && w.castleFree(sx, sy, x, y, FREE)) { sx = FREE[0]; sy = FREE[1]; } // (not put down inside a castle's masonry: out on the body's side)
    const id = spawnSoldier(w.S, w.rng, {
      x: sx, y: sy,
      team, unit: u.id, arm: A.id, training, ammo, tick: w.tick, nerve, kit, weapon, mount: mnt || undefined,
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
      if (w.econ?.jobFor) { const job = w.econ.jobFor(w, u, order); if (job) { u.job = job; u.haul = new Map(); u.danger = 0; u.away = false; u.playerJobUntil = 0; u.ordered = !!order.player; u.picked = false; } continue; } // an ordered job runs until it is done
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
  if (w.townOrder && (u.tw || o.kind === "man_wall" || o.kind === "come_down") && w.townOrder(w, u, o)) return; // town walls: up onto the walk, down again (townwall.js)
  if (w.castleOrder && (o.kind === "keep" || Number.isFinite(o.x)) && u.engine === undefined && w.castleOrder(w, u, o)) return; // castles: walls, stairs, the keep (castle.js; "keep" needs no point)
  if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) return; // a garbled or ill-formed order is no order
  if (w.siegeOrder && w.siegeOrder(w, u, o)) return;          // engines, escalades: siege.js takes the order
  const cls = ARMS[u.arm].mounted ? "cavalry" : "foot";
  { const po = u.order, turn = Number.isFinite(o.facing) && Number.isFinite(po?.facing) ? Math.abs(Math.atan2(Math.sin(o.facing - po.facing), Math.cos(o.facing - po.facing))) : 0;
    if (!u.isWorkers && !u.hold && !ARMS[u.arm].engine && !u.works && !u.esc && ((!u.moving && Math.hypot(o.x - u.ax, o.y - u.ay) > 3) || turn > 0.5)) u.rippleT = w.time; }
  u.path = routeOrder(w, u, o, cls); // (the nav route; over water or a moat by a ford, or a crossing the men make; round the bowmen: crossings.js)
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
  // through a town gate the body goes in column (a 5 m passage takes four files, not a battle line) and forms again
  // as it was when it arrives (crossings.wallRoute sets u.gates)
  if (u.gates && !u.isWorkers && !A0(u).engine && u.formation !== "column" && u.formation !== "loose") {
    u.deployAs ||= { formation: u.formation, depth: u.depth };
    setFormation(u, "column", 0);
  }
  u.finalFacing = o.facing;
  if (u.disordered) { if (u.hold) u.reform = true; else clearDisorder(u); } // any order re-forms the ranks (in a fight: when it ends)
  u.hold = false;
  for (const id of u.members) if (w.S.state[id] === S_IDLE) w.S.state[id] = S_MOVE;
}

const A0 = (u) => ARMS[u.arm] || {};

// ---------------------------------------------------------------- step
// High-frequency combat events stay in w.events only (the UI log gets the notable ones).
const QUIET = new Set(["kill", "down", "flee", "die", "horse", "rally", "captured", "shot", "refuse", "impact", "pursue", "order-arrived", "feat"]);
export function step(w) {
  momArrays(w.S); // (a world saved before men carried momentum: their arrays, made now)
  w.tick++;
  w.time += DT;
  w.events.length = 0; // per-tick events; the UI reads w.log (drains it itself)
  rebuildHash(w);
  for (const u of w.units.values()) moveUnit(w, u);
  crossingTick(w); // crossings being made, bridges burnt, routes looked at again (crossings.js)
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
export function goingMul(w, arm, x, y, dx, dy, mnt = 0) {
  const A = ARM_BY_ID[arm], cls = A.mounted ? "cavalry" : A.armour >= 4 ? "heavyFoot" : "foot";
  const t = terrainAt(w, x, y);
  let m = t?.moveMul?.[cls] ?? t?.moveMul?.foot ?? 1;
  if (cls === "cavalry") m = cavGoing(m, t?.moveMul?.foot ?? 1); // (horse goes wherever foot goes, slower: landread.CAV_FLOOR)
  // a learned mount's terrain manners (js/sim/mounts.js; gated: a horse, mnt ≤ 2, never enters here)
  if (mnt >= 3 && A.mounted && m < 1) m = Math.max(0.03, 1 - (1 - m) * MOUNTS[mnt].mire); // (strider 0.35: marsh/scrub barely slow it)
  let grade = w.map.gradeAlong(x, y, dx, dy);
  if (w.map.carved && (grade > 0.45 || grade < -0.45) && w.map.carved(x, y) > 0.2) grade = grade > 0 ? 0.45 : -0.45; // (the face of a castle ditch is scrambled down and up: its crossing time is the ditch's own, castle.js)
  // Tobler hiking function, normalised to 1 on flat ground (ELEVATION.footSpeed); armour climbs worse
  m *= Math.exp(-3.5 * Math.abs(grade + 0.05)) / Math.exp(-3.5 * 0.05);
  if (cls === "heavyFoot" && grade > 0) m *= Math.max(0.5, 1 - 0.6 * grade);
  const wd = w.map.water(x, y);
  if (wd > 0.05) {
    if (mnt === MNT_DRAKE) m *= wd > 1.6 ? MOUNTS[MNT_DRAKE].swim : clamp(1 - wd * 0.3, 0.1, 1); // a drake takes to the water: it swims rivers, slowly
    else m *= wd > (A.mounted ? 1.6 : 1.3) ? 0.03 : clamp(1 - wd * (A.mounted ? 0.4 : 0.7), 0.1, 1); // >1.3 m: swimming, not wading (TERRAIN.deep_water)
  }
  if (w.goingHook) m *= w.goingHook(x, y, cls); // bodies on the ground, stakes, ditches (combat)
  // the live sky's ground (js/sim/weather.js, w.wx): sustained rain = mud underfoot, lying snow = a wade
  const wx = w.wx;
  if (wx) {
    if (wx.wet > 0.45 && wd < 0.05) m *= 1 - (cls === "cavalry" ? 0.45 : cls === "heavyFoot" ? 0.4 : 0.3) * (wx.wet - 0.45) / 0.55;
    if (wx.snowCover > 0.3) m *= 1 - 0.25 * (wx.snowCover - 0.3) / 0.7;
  }
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
  if (u.tw && w.townMove && w.townMove(w, u)) return; // a company on (or going up onto, or down off) its town's walls: townwall.js walks its men
  if (u.order.kind === "assault" && w.tick % 5 === u.id % 5) {
    // close with the nearest enemy body near the ordered point (a routing body is chased where its men are)
    let best = null, bd = 400;
    const named = u.order.target !== undefined ? w.units.get(u.order.target) : null; // a named target is chased to the end
    if (named && named.members.length && isFoe(w, u.team, named.team)) best = named;
    else {
      // (foot sent against a place passes over horse that has drawn off out of its reach to the foot there: it does not
      // make the horse its quarry — and then stand down, as below — while the enemy's foot stands where it was sent)
      const farHorse = (v) => !ARMS[u.arm].mounted && ARMS[v.arm]?.mounted && !v.c?.broken && Math.hypot((v.fx ?? v.ax) - u.ax, (v.fy ?? v.ay) - u.ay) > FOOT_CHASE_HORSE;
      for (const pass of [0, 1]) {
        for (const v of w.units.values()) { if (!isFoe(w, u.team, v.team) || !v.members.length || (!pass && farHorse(v))) continue; const d = Math.hypot((v.fx ?? v.ax) - u.order.x, (v.fy ?? v.ay) - u.order.y); if (d < bd) { bd = d; best = v; } }
        if (best) break;
      }
      // foot sent against a place, whose quarry has broken, turns on the enemy still standing near it before it goes after
      // fugitives (§12: foot cannot run men down; the order point follows the quarry, and a formed block was led off across
      // the country after a broken body while a formed one stood beside it — Bannockburn's schiltrons after the levy, the
      // English spearmen left untouched)
      if (best?.c?.broken && !ARMS[u.arm].mounted) { // (foot standing: foot does not go after horse)
        let alt = null, ad = 300;
        for (const v of w.units.values()) { if (!isFoe(w, u.team, v.team) || !v.members.length || v.c?.broken || v.isWorkers || ARMS[v.arm]?.engine || ARMS[v.arm]?.mounted) continue; const d = Math.min(Math.hypot((v.fx ?? v.ax) - u.order.x, (v.fy ?? v.ay) - u.order.y), Math.hypot((v.fx ?? v.ax) - u.ax, (v.fy ?? v.ay) - u.ay)); if (d < ad) { ad = d; alt = v; } }
        if (alt) best = alt;
      }
    }
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
      // (a town's walls between: by its gates — wallnav.js; shut out of an enemy's town, the old way at the wall stands)
      const wr = WN.any(w) && !u.cst && !u.works && !u.esc && !WN.clear(w, u.team, u.ax, u.ay, bx, by);
      if (wr) {
        if (!u.aPath || w.tick - u.aPath.t > 50 || Math.hypot(u.aPath.x - bx, u.aPath.y - by) > 40) { u.aPath = { t: w.tick, x: bx, y: by }; u.path = WN.route(w, u.team, u.ax, u.ay, bx, by)?.pts || findPath(w.nav, ARMS[u.arm].mounted ? "cavalry" : "foot", u.ax, u.ay, bx, by) || [[bx, by]]; }
      } else if ((w.navBlk?.cnt.size || (u.bogT !== undefined && w.time - u.bogT < 40) || (w.map.water(bx, by) < 0.5 && wetBetween(w.map, ARMS[u.arm].mounted ? "cavalry" : "foot", u.ax, u.ay, bx, by))) && Math.hypot(bx - u.ax, by - u.ay) > 60) { // (… or deep water on the straight line to a quarry on the far bank: round by the ford — a quarry IN the water is pressed at its edge)
        if (!u.aPath || w.tick - u.aPath.t > 50 || Math.hypot(u.aPath.x - bx, u.aPath.y - by) > 40) { u.aPath = { t: w.tick, x: bx, y: by }; u.path = findPath(w.nav, ARMS[u.arm].mounted ? "cavalry" : "foot", u.ax, u.ay, bx, by) || [[bx, by]]; }
      } else u.path = [[bx, by]];
      u.finalFacing = Math.atan2(by - u.ay, bx - u.ax); u.order.x = bx; u.order.y = by;
    }
  }
  // --- advance the anchor along the path at the pace of the formation (not while locked in contact: combat owns it)
  let moving = false;
  // NO GRINDING (wallnav.js; not a body under the siege works' own orders — a sally by its postern, an escalade): every 2 s
  // a body on the move near a town wall checks that the leg it is walking does not
  // run into the wall (a route laid before the wall stood, a gate shut since, a leg the grid laid through it); if it
  // does, it plans again by the gates — or, shut out, stops at the wall's foot instead of pushing at it for ever
  const nearWall = WN.any(w) && !u.cst && !u.works && !u.esc && WN.near(w, u.ax, u.ay, 30 + Math.sqrt(ids.length) * 2);
  u.atWall = nearWall; // (steer: men at a town wall step as they always did — no momentum against the masonry)
  if (nearWall && u.path && u.path.length && !u.hold && (w.tick + u.id) % 20 === 0 && u.order.kind !== "assault" && u.order.kind !== "escalade" && !WN.clear(w, u.team, u.ax, u.ay, u.path[0][0], u.path[0][1])) {
    const end = u.path[u.path.length - 1], R = WN.route(w, u.team, u.ax, u.ay, end[0], end[1]);
    if (R?.pts) { u.path = R.pts; if (R.gates.length) u.gates = R.gates; }
    else if (R?.stop && Math.hypot(R.stop[0] - u.ax, R.stop[1] - u.ay) > 3) u.path = [R.stop];
    else { u.path = null; w.events.push({ t: w.tick, kind: "route-blocked", team: u.team, unit: u.id }); }
  }
  if (u.gates && nearWall && (w.tick + u.id) % 10 === 0) for (const g of u.gates) WN.markPass(w, g, u.ax, u.ay); // (the warden opens to his own)
  const ax0 = u.ax, ay0 = u.ay;
  if (u.path && u.path.length && !u.hold) {
    const [px, py] = u.path[0]; const dx = px - u.ax, dy = py - u.ay, d = Math.hypot(dx, dy);
    const sp = paceSpeed(u, A);
    // formation moves at the speed of its slowest part: sample going at anchor and 3 m ahead — but a thin line
    // (a hedge, a ditch, a fence: a band ~3 m wide) is crossed once, where the anchor stands in it, not also for
    // the 3 m before it: the ground ahead only counts when it is still as bad 6 m on (a wood, a bog, a ford).
    // (min(anchor, 3 m ahead) had every body crawl at the going floor for the whole approach to each of the
    // Vale's hedges — knights at 0.1 m/s for half a minute before a hedge they then crossed in seconds)
    const ux = dx / (d || 1), uy = dy / (d || 1);
    const gAt = goingMul(w, A.id, u.ax, u.ay, dx, dy, u.mnt || 0);
    let g = gAt;
    const g3 = goingMul(w, A.id, u.ax + ux * 3, u.ay + uy * 3, dx, dy, u.mnt || 0);
    if (g3 < g) g = Math.min(g, Math.max(g3, goingMul(w, A.id, u.ax + ux * 6, u.ay + uy * 6, dx, dy, u.mnt || 0)));
    // sent to a spot in ground this arm cannot bear at all (horses into a marsh, foot into deep water — the AI's
    // hold points and a player's click both land there): the body goes as far as the edge and stands there,
    // its order done. It used to "go on" at the going floor — 0.1 m/s for ever, or not at all with the enemy near.
    const bear = A.mounted ? 0.02 : 0.03; // (horse: landread.cavGoing floors it at 0.025 wherever foot can go)
    let edge = false;
    const storm = u.order.kind === "assault" || u.order.kind === "escalade"; // (stormers go down into a castle's ditch and up the other side: siege.js)
    if (g < bear && gAt >= bear && !storm && !(u.c && u.c.phase && u.c.phase !== "idle")) {
      const L = u.path[u.path.length - 1];
      edge = goingMul(w, A.id, L[0], L[1], L[0] - u.ax, L[1] - u.ay, u.mnt || 0) < bear;
    }
    // the route itself runs into ground that will not bear it (the 25 m nav cells sample only their corners, and a
    // bog between two corners is invisible to it): the body casts about for firm ground to either side and goes
    // round by it, instead of floundering across at the going floor for half a minute. (Assaults keep their own
    // re-planning, u.bogT; a few detours per order at most, so a body in a real maze still pushes on.)
    if (!edge && g < bear && gAt >= bear && !storm && (u.detour?.o !== u.order || u.detour.n < 6) && !(u.c && u.c.phase && u.c.phase !== "idle")) {
      const base = Math.atan2(dy, dx);
      for (const off of [0.5, -0.5, 0.9, -0.9, 1.3, -1.3, 1.7, -1.7]) {
        const a = base + off, cx = Math.cos(a), cy = Math.sin(a);
        if (goingMul(w, A.id, u.ax + cx * 6, u.ay + cy * 6, cx, cy, u.mnt || 0) < 0.15 || goingMul(w, A.id, u.ax + cx * 12, u.ay + cy * 12, cx, cy, u.mnt || 0) < 0.15) continue;
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
      let vT = sp * gA * clamp(1.2 - lagN / 12, 0.3, 1) * (u.speedMul ?? 1);
      // the body gathers pace and checks it (ANCHOR): it steps off over a second or two, and a body sent to a place
      // slows as it comes to it and halts there — not at full pace onto the spot. (Not a body that a charge or a pursuit
      // is carrying — they ride it.)
      // (horse sent at the enemy goes at once at the pace it was sent at — the horses themselves gather it (steer, MOM);
      // an engine and the siege's own parties keep siege.js's pace)
      const ride = (u.c && (u.c.phase === "charge" || u.c.phase === "pursuit")) || (A.mounted && u.order.kind === "assault") || u.order.kind === "escalade" || A.engine || u.works || u.esc;
      const brake = !ride && u.order.kind !== "assault"; // (a body sent at the enemy does not check as it closes: contact stops it)
      const aA = A.mounted ? ANCHOR.horse : ANCHOR.foot;
      if (brake) {
        let rem = d; for (let k = 1; k < u.path.length && rem < 60; k++) rem += Math.hypot(u.path[k][0] - u.path[k - 1][0], u.path[k][1] - u.path[k - 1][1]);
        vT = Math.min(vT, Math.sqrt(2 * aA[1] * rem) + ANCHOR.arrive);
      }
      const cur = ride ? vT : u.av ?? 0;
      u.av = vT > cur ? Math.min(vT, cur + aA[0] * DT) : Math.max(vT, cur - aA[1] * 2 * DT);
      const v = u.av * DT; u.gA = gA;
      if (d <= v) { u.ax = px; u.ay = py; u.path.shift(); } else { u.ax += dx / d * v; u.ay += dy / d * v; }
      const want = Math.atan2(dy, dx) - Math.PI / 2;
      if (d > 2) u.facing = turnToward(u.facing, want, wheelRate(u, A, true) * DT);
      moving = true;
      if (!u.path.length) u.path = null;
    }
  } else if (u.finalFacing !== undefined && !u.hold) {
    u.facing = turnToward(u.facing, u.finalFacing - Math.PI / 2, wheelRate(u, A, false) * DT);
  }
  if (!moving) u.av = 0;
  u.vax = moving ? (u.ax - ax0) / DT : 0; u.vay = moving ? (u.ay - ay0) / DT : 0; // (the body's own velocity: its men keep pace with it — steer, FOLLOW)
  u.moving = moving;
  if (u.deployAs && (!u.path || u.enemyNear)) { setFormation(u, u.deployAs.formation, u.deployAs.depth); u.deployAs = null; } // arrived, or the enemy is near: form
  // --- soldiers steer to their slots
  const slots = unitSlots(u, ids.length, A);
  const c = Math.cos(u.facing), s = Math.sin(u.facing), t = w.time, twOn = w.twM?.n ? w.twM.on : null;
  for (let k = 0; k < ids.length; k++) {
    const id = ids[k];
    const [lx, ly, rank] = slots[k];
    S.rank[id] = rank;
    const sq = u.squeeze ? 1 - u.squeeze : 1; // (flank fire has squeezed the files toward the middle: combat.unitUpdate)
    let tx = u.ax + lx * sq * c - ly * s, ty = u.ay + lx * sq * s + ly * c;
    // in the press the ranks loosen (the owner: "after the initial formation impact, the men mingle a bit … the formation
    // would be kept, but it wouldn't be robotic and solid"): a body locked in a fight keeps its frontage and depth, but each
    // man's place wanders from its exact slot — a step up into a gap, a step back, a lean along the file — on his own slow
    // rhythm, and the files nearest the enemy bend and press forward into one another. Drilled men hold tight; levies and
    // blown men mingle more (MINGLE; deterministic: hashed per man, no draw)
    if (u.hold && !u.disordered && !A.mounted && u.formation !== "schiltron" && S.state[id] !== S_FLEE) {
      const wf = S.wp[id] > 0 ? S.wbal[id] / S.wp[id] : 1;
      const amp = clamp(MINGLE.loose * Math.pow(Math.max(0, 1 - S.disc[id]), 1.5) * (1 + MINGLE.tired * (1 - wf)), MINGLE.min, MINGLE.max);
      const h1 = ((id * 2654435761) >>> 0) / 4294967296, h2 = ((id * 40503 + 7919) >>> 0) % 1000 / 1000, per = MINGLE.per[0] + (MINGLE.per[1] - MINGLE.per[0]) * h1;
      const lat = amp * Math.sin(6.2832 * (t / per + h2)), lon = amp * (0.8 * Math.sin(6.2832 * (t / (per * 1.37) + h1)) + (rank <= 1 ? MINGLE.press : 0));
      const qx = tx + c * lat - s * lon, qy = ty + s * lat + c * lon;
      if (w.map.water(qx, qy) < 0.05 && w.map.water(u.ax, u.ay) < 0.05) { tx = qx; ty = qy; } // (not at a ford, on a bridge's deck or by the water: there the files keep to the dry way)
    }
    // on the march the ranks are not ruled lines (MARCH): each man walks a little ahead of or behind his exact place
    // and a little to one side, on his own slow rhythm — the drilled close, the levy loose — so a body comes on as men,
    // and its front reaches the enemy a man here and a man there, not as one edge (deterministic: hashed per man)
    if (moving && !u.hold && !u.disordered && !A.engine && !u.isWorkers && u.formation !== "column" && !nearWall && !u.cst && !u.esc && !u.works) {
      const amp = MARCH.amp * clamp(1.2 - S.disc[id], 0.2, 1), h1 = ((id * 2654435761) >>> 0) / 4294967296, h2 = ((id * 40503 + 7919) >>> 0) % 1000 / 1000;
      const per = MARCH.per[0] + (MARCH.per[1] - MARCH.per[0]) * h2, lon = amp * Math.sin(6.2832 * (t / per + h1)), lat = amp * 0.5 * Math.sin(6.2832 * (t / (per * 1.31) + h2));
      const qx = tx + c * lat - s * lon, qy = ty + s * lat + c * lon;
      if (w.map.water(qx, qy) < 0.05 && w.map.water(u.ax, u.ay) < 0.05) { tx = qx; ty = qy; } // (not at a ford, on a bridge's deck or by the water: there the files keep to the dry way)
    }
    // area awareness: a slot that falls inside a building, trunk or hedge moves to the nearest open
    // ground (searched outward, preferring the side toward the unit's centre) — the line bends round it
    const wet = (x, y) => !A.mounted && w.map.water(x, y) > 0.9; // (a place in a river is no place: slots move to dry ground as out of a wall)
    // (a castle's masonry — a curtain and its plinth, a tower's foot, the keep, a hall: castle.js / masonry.js — is no place
    // either, and a slot moved out of it stays on the body's own side of the curtain: the bailey for a garrison, the field for stormers)
    const cs = w.castleSolid, solid = (x, y, pad) => (w.obstacles && blocked(w.obstacles, x, y, pad)) || (cs && cs(x, y, pad < 1 ? 0.3 : 0.6));
    if ((w.obstacles || cs) && !w.noSlotFix && (solid(tx, ty, 0.9) || wet(tx, ty))) {
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
          if (solid(qx, qy, 1.3) || wet(qx, qy)) continue;            // a step clear of the wall (or the water)
          if (cs && w.castleWallBetween(u.ax, u.ay, qx, qy)) continue; // (not over the curtain from his body)
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
      if (f >= 0 && S.state[id] !== S_FIGHT && S.alive[f] && S.team[f] !== u.team && isFoe(w, u.team, S.team[f])) { const dx = S.x[f] - S.x[id], dy = S.y[f] - S.y[id], dl = Math.hypot(dx, dy) || 1, st = Math.max(0, dl - 1.6); tx = S.x[id] + dx / dl * st; ty = S.y[id] + dy / dl * st; }
    }
    // a town wall between the body and a man's place: the place comes back to the body's side; a man on the wrong side
    // of the wall from his place goes round by the passage his body is using (wallnav.js)
    if (nearWall && !u.disordered) { const p = wallSlot(w, u, tx, ty); tx = p[0]; ty = p[1]; }
    // the word goes down the ranks (RIPPLE): after an order that sets a standing body going, or turns it, each man moves
    // when it reaches him — the front rank first, the files nearest the officer and the drums before the flanks, the
    // drilled quick and the levy slow — so a body steps off, halts and turns as a wave, not as one piece. Until it
    // reaches him he stays where his place was (deterministic: hashed per man, no draw).
    let wait = false;
    if (u.rippleT !== undefined && w.time - u.rippleT < RIPPLE.max && !u.hold && !u.disordered && (S.slotX[id] || S.slotY[id])) {
      const fl = u.files || 1, file = k % fl, h = ((id * 2654435761) >>> 0) / 4294967296;
      const late = (RIPPLE.base + RIPPLE.rank * Math.min(rank, 4) + RIPPLE.file * Math.abs(file - (fl - 1) / 2) + RIPPLE.jit * h) * (1.4 - S.disc[id]);
      if (w.time - u.rippleT < late) { tx = S.slotX[id]; ty = S.slotY[id]; wait = true; }
    }
    S.slotX[id] = tx; S.slotY[id] = ty;
    const st = S.state[id];
    if (st === S_FLEE || st === S_FIGHT || st === S_RALLY || S.posture[id] || S.busyT[id] > t) continue; // combat moves these
    if (twOn && twOn[id] && !u.tw) continue; // (a stormer up on a town's wall-walk: townwall.js walks him)
    if (nearWall && (tx - S.x[id]) ** 2 + (ty - S.y[id]) ** 2 > 6) { const m = WN.manTarget(w, u.team, S.x[id], S.y[id], tx, ty); if (m) { steer(w, id, A, m[0], m[1], true, u); continue; } }
    if (!moving && !u.hold && !(u.c?.mtgt && !u.holdFire && S.ammo[id] > 0)) { // standing easy: men shift their feet, step out, lean on a spear, turn to talk (not bowmen at their marks: ballistics.faceMark)
      const dur = (50 + ((id * 2654435761) >>> 0) % 110) * 0.4, e = Math.floor((w.time + id * 5.2) / dur); // (20–64 battle-s between shifts of his feet)
      const h1 = (((id + 1) * 73856093 ^ e * 19349663) >>> 0) / 4294967296, h2 = (((id + 7) * 83492791 ^ e * 2654435761) >>> 0) / 4294967296;
      const amp = u.arm === "ram" ? 0 : u.formation === "loose" ? 1.4 : 0.45; // (an engine's crew stand at their places on it: no wandering off through its roof)
      steer(w, id, A, tx + (h1 - 0.5) * amp * 2, ty + (h2 - 0.5) * amp * 2, false, u);
      if (h1 > 0.85) S.facing[id] += (h2 - 0.5) * 0.08; // glance aside
      continue;
    }
    steer(w, id, A, tx, ty, (moving && !wait) || (u.disordered && S.foe[id] >= 0), u);
  }
}

// a slot across a town wall from its body's centre, brought back to the body's side. Cached per slot and stance (a
// WeakMap: derived, never saved) — and worked out from the cache key's own rounded values, so a restored world, which
// starts with an empty cache, pulls every slot exactly as the world that was saved would have.
const WALL_SLOTS = new WeakMap();
function wallSlot(w, u, tx, ty) {
  let m = WALL_SLOTS.get(u); if (!m || m.sig !== WN.layerSig(w)) WALL_SLOTS.set(u, (m = new Map())), m.sig = WN.layerSig(w);
  const qx = Math.round(tx * 2), qy = Math.round(ty * 2), ax = Math.round(u.ax), ay = Math.round(u.ay), key = `${qx}|${qy}|${ax}|${ay}`;
  let p = m.get(key);
  if (p === undefined) { if (m.size > 4000) m.clear(); p = WN.pullSlot(w, u.team, ax, ay, qx / 2, qy / 2); m.set(key, p); }
  return p || [tx, ty];
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
      if (!meH && !oH && S.team[o] !== S.team[id] && isFoe(w, S.team[id], S.team[o])) continue; // (foot against a foot foe: combat keeps them at weapon's length — pushing here too was a side bias, §17.1 mirror)
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
// a body's centre gathers pace and checks it (moveUnit): [gather, shed] m/s²; arrive: m/s it still has as it reaches the
// spot (it halts on it); marchTurn: × the wheel rate a body on the move may bend its line at
export const ANCHOR = { foot: [1.0, 0.9], horse: [1.2, 0.8], arrive: 0.3, marchTurn: 1.5 };
// marching raggedness (moveUnit): m a man drifts ahead/behind his place × (1.2 − discipline), and half that sideways; s per sway
export const MARCH = { amp: 0.7, per: [6, 13] };
// how soon each man takes up an order (moveUnit, s × (1.4 − his discipline)): base + per rank behind the front + per
// file out from the centre + a man's own slowness (0..jit); max: s after which everyone has it
export const RIPPLE = { base: 0.1, rank: 0.3, file: 0.025, jit: 0.6, max: 3 };
// A body wheels no faster than its flank men can walk round (rad/s = flank pace ÷ half its frontage): a 40-file line
// takes ~5 s to face about a quarter turn, a column of four comes round at once. WHEEL: [flank pace m/s foot, horse,
// slowest rad/s, fastest rad/s]
export const WHEEL = [2.0, 4.5, 0.3, 1.5];
function wheelRate(u, A, moving) {
  if (A.engine || u.works || u.esc || u.isWorkers) return moving ? 3 : 1.5; // (an engine and its crew, a storming party, villagers: as they always turned)
  const half = Math.max(1, (u.files || 1) * (A.spacing || 1) / 2);
  return clamp((A.mounted ? WHEEL[1] : WHEEL[0]) / half, WHEEL[2], WHEEL[3]) * (moving ? ANCHOR.marchTurn : 1);
}
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
// how loose a body in the press stands (world.moveUnit): metres of wander = loose × (1 − discipline)^1.5 × (1 + tired × spent
// W′), clamped (men-at-arms ≈0.3 m, spearmen ≈0.8, a levy ≈1.7 fresh); per: s of each man's rhythm; press: m the first two ranks lean in where the lines meet
export const MINGLE = { loose: 2.6, tired: 0.8, min: 0.3, max: 2.2, per: [7, 18], press: 0.35 };
function unitLag(w, u) {
  // mean distance of soldiers from their slots: a formation disordered by woods has to slow down
  const S = w.S, K = S.stk; let sum = 0, n = 0;
  for (const id of u.members) { if (S.slotX[id] === 0 && S.slotY[id] === 0) continue; if (S.state[id] === S_FIGHT || S.state[id] === S_FLEE) continue; if (K && K[id * 7 + 3] >= 2) continue; /* (a man who has given up his place among the trees is not waited for: steer, STUCK) */ const q = Math.hypot(S.x[id] - S.slotX[id], S.y[id] - S.slotY[id]); if (q > 25 && !u.enemyNear) continue; sum += Math.min(q, LAG_CAP); n++; } // (on the march, a man caught behind a tree far back is not waited for: he finds his own way up; with the enemy near, the body waits for its men)
  return n ? sum / n : 0;
}

export function steer(w, id, A, tx, ty, moving, u) {
  const S = w.S;
  // NO RUNNING IN PLACE (the owner, 2026-10-06: "men just infinitely running at a tree"): every STUCK.win s a man more
  // than 1.5 m from his place who has not closed STUCK.min m on it is stuck. The first time he
  // side-steps (a detour heading square to his line); stuck again, he gives the place up and stands where he is until
  // his body's place for him has moved on, or a few seconds have passed and he tries again (a body halted in a wood
  // stands a little ragged among the trees, and no man pushes at the bark for ever). (Where there are trunks, houses or a castle's masonry; not up on a level.)
  if ((w.obstacles || w.castleSolid) && !S.lvl[id] && w.map.water(S.x[id], S.y[id]) < 0.05) { // (a man in the water never gives up getting out of it)
    if (!S.stk || S.stk.length < S.cap * 7) { const a = new Float32Array(S.cap * 7); if (S.stk) a.set(S.stk.subarray(0, Math.min(S.stk.length, a.length))); S.stk = a; }
    const K = S.stk, k6 = id * 7, d0 = Math.hypot(tx - S.x[id], ty - S.y[id]);
    if (K[k6 + 3] >= 2) {
      const movedOn = Math.hypot(tx - K[k6 + 4], ty - K[k6 + 5]) >= STUCK.park;
      if (!movedOn && (K[k6 + 6] >= STUCK.tries || (w.time - K[k6 + 1] < STUCK.retry && K[k6 + 1] <= w.time))) { tx = S.x[id]; ty = S.y[id]; moving = false; } // (parked: he stands)
      else { K[k6 + 3] = 0; if (movedOn) K[k6 + 6] = 0; K[k6] = Math.hypot(tx - S.x[id], ty - S.y[id]); K[k6 + 2] = w.time; } // (his place has moved on, or he has waited: he tries again — a few times, then he stays put)
    } else if (w.time - K[k6 + 2] >= STUCK.win || K[k6 + 2] > w.time) {
      const gained = K[k6] - d0; // (what he has closed on his place in the window: a man jostled about in a jam moves, but gets no nearer)
      // (only among trunks, houses or stone — against the bark itself or jammed behind the men who are: a man wading a bog
      // is slow, not stuck; and not in a body locked in a fight, whose men lean on the press by design)
      const hemmed = !u.hold && ((w.obstacles && blocked(w.obstacles, S.x[id], S.y[id], STUCK.near)) || (w.castleSolid && w.castleSolid(S.x[id], S.y[id], STUCK.near)));
      if (d0 > 1.5 && gained < STUCK.min && K[k6 + 2] > 0 && hemmed) {
        if (++K[k6 + 3] >= 2) { K[k6 + 4] = tx; K[k6 + 5] = ty; K[k6 + 1] = w.time; K[k6 + 6]++; tx = S.x[id]; ty = S.y[id]; moving = false; }
        else if (S.avoid && S.avoid.length >= S.cap * 2) { const sd = (id & 1) ? 1 : -1, ex = (tx - S.x[id]) / d0, ey = (ty - S.y[id]) / d0; S.avoid[id * 2] = -ey * sd; S.avoid[id * 2 + 1] = ex * sd; }
      } else if (gained >= STUCK.min || d0 <= 1.5) K[k6 + 3] = 0;
      K[k6] = d0; K[k6 + 2] = w.time;
    }
  }
  const dx = tx - S.x[id], dy = ty - S.y[id], d = Math.hypot(dx, dy);
  // MOMENTUM (the owner, 2026-10-06: "there is no momentum … action and commands feel super robotic"): a man has the
  // velocity he had a tick ago — his own, carried; or, if something else moved him last tick (a charge's ride, a flight,
  // the press of a fight), the velocity it gave him. He changes it only as fast as legs or a horse can (MOM).
  // (not in the stone: a man on a wall-walk, a stair or a tower floor, a body inside a castle or up on a town's walls, a
  // storming party at its ladders or tower, an engine's crew — those ways are a body's width and calibrated step by step
  // in tools/siege-test.mjs: there he still steps as he did, where he means to; nor in the water or stepping onto a deck)
  const tight = S.lvl[id] || u.cst || u.tw || u.esc || u.works || u.atWall || A.engine || (w.castles?.length && nearCastle(w, S.x[id], S.y[id]))
    || nearWater(w.map, S.x[id], S.y[id]) || w.map.water(tx, ty) > 0.05; // (nor at the water's edge, at a ford or on a bridge's deck: a man there puts his feet where he means to)
  let mx, my;
  if (tight) { mx = 0; my = 0; }
  else if (S.mvK[id] === w.tick - 1) { mx = S.mvx[id]; my = S.mvy[id]; }
  else { mx = S.vx[id]; my = S.vy[id]; const m2 = mx * mx + my * my; if (!(m2 < 1e4)) mx = my = 0; else if (m2 > MOM.vmax * MOM.vmax) { const k = MOM.vmax / Math.sqrt(m2); mx *= k; my *= k; } }
  S.mvK[id] = w.tick;
  if (d <= 0.4 && !moving && mx * mx + my * my < MOM.still * MOM.still) {
    // in place: no stride; jostle only now and then (every 4th tick, staggered) — standing blocks are cheap
    S.vx[id] = 0; S.vy[id] = 0; S.mvx[id] = 0; S.mvy[id] = 0; S.power[id] = 100; S.state[id] = S_IDLE;
    if (u.formation === "schiltron") S.facing[id] = Math.atan2(S.y[id] - u.ay, S.x[id] - u.ax);
    if (!(A.mounted && S.horseOK[id] === 1)) {} else horseStep(S, id, 0, DT);
    if (((w.tick + id) & 1) === 0) { // (standing men shuffle apart too — every other tick, over two ticks' time)
      const sep = bodyPush(w, S, id, SEP);
      if (sep[0] || sep[1]) { S.x[id] = clamp(S.x[id] + sep[0] * 2 * DT, w.map.x0, w.map.x1); S.y[id] = clamp(S.y[id] + sep[1] * 2 * DT, w.map.y0, w.map.y1); }
    }
    return;
  }
  // terrain going and grade are re-read every 4th tick per man (staggered): ground changes slower than feet
  let g = S.gMul[id];
  if (S.lvl[id]) { g = S.gMul[id] = 1; S.gGrade[id] = 0; S.gEta[id] = 1.1; } // (castle.js: a wall-walk or a floor is paved going — the ground's going, and the wall's "impassable", are below him)
  else if (((w.tick + id) & 3) === 0 || !g) { g = S.gMul[id] = Math.max(A.mounted && w.map.water(S.x[id], S.y[id]) < 1.1 ? GOING_FLOOR : 0, goingMul(w, A.id, S.x[id], S.y[id], dx, dy, u.mnt || 0)) || 0.02; S.gGrade[id] = w.map.gradeAlong(S.x[id], S.y[id], dx, dy); S.gEta[id] = terrainAt(w, S.x[id], S.y[id])?.fatigueMul ?? 1.1; }
  // a man (or horse) who finds the ground at his feet will not bear him — a thorn brake, a rock band — steps
  // round it: the nearest heading off his line whose going will take him (he rejoins his file beyond it)
  let ux = d > 0.01 ? dx / d : 0, uy = d > 0.01 ? dy / d : 0;
  if (g < 0.05 && d > 0.4) {
    // (never a heading through a town wall: the good going beyond it drew a man caught between the stakes and the
    // ditch into the stakes for ever — barrierResolve puts him back — crawling the wall's length, stuck at its corners)
    const thru = WN.any(w) ? (r, hx, hy) => !WN.clear(w, S.team[id], S.x[id], S.y[id], S.x[id] + hx * r, S.y[id] + hy * r) : null;
    for (const off of [0.7, -0.7, 1.4, -1.4]) {
      const c = Math.cos(off), sn = Math.sin(off), hx = ux * c - uy * sn, hy = ux * sn + uy * c;
      if (thru?.(1.5, hx, hy)) continue;
      const gg = goingMul(w, A.id, S.x[id] + hx * 1.5, S.y[id] + hy * 1.5, hx, hy, u.mnt || 0);
      if (gg >= 0.15) { ux = hx; uy = hy; g = gg; break; }
    }
    // standing in ground that will not bear him at all (swept into a river, pushed into a bog): he does not freeze
    // there for ever — he flounders toward the nearest ground that will, at a flounder's pace
    if (g < 0.05 && goingMul(w, A.id, S.x[id], S.y[id], ux, uy, u.mnt || 0) < 0.05) {
      let bx = 0, by = 0, bg = 0;
      for (let a = 0; a < 8; a++) { const cx = Math.cos(a * 0.785), cy = Math.sin(a * 0.785); for (const r of [3, 6, 10]) { if (thru?.(r, cx, cy)) continue; const gg = goingMul(w, A.id, S.x[id] + cx * r, S.y[id] + cy * r, cx, cy, u.mnt || 0) / r; if (gg > bg) { bg = gg; bx = cx; by = cy; } } }
      if (bg > 0) { ux = bx; uy = by; g = 0.25; }
    }
  }
  // look ahead: a wall, house or trunk in the way — pick a clear heading round it and KEEP that heading
  // (a world direction, not "left of the target", which flips as he walks) until the way to his slot clears
  const cs = !S.lvl[id] && w.castleSolid, blk = (x, y, pad) => (!S.lvl[id] && w.obstacles && blocked(w.obstacles, x, y, pad)) || (cs && cs(x, y, pad + 0.15)); // (on the ground: a castle's masonry too; up on a wall-walk or a tower top, neither — nor the buildings below him)
  // (the whole stretch ahead is looked along, not just its far end: a trunk between a man and a place just beyond it
  // had him walk into the bark and be pushed back by obstacles.obstacleSystem tick after tick — "running at a tree")
  const sweep = (hx, hy, look, pad) => blk(S.x[id] + hx * look * 0.35, S.y[id] + hy * look * 0.35, pad) || blk(S.x[id] + hx * look * 0.7, S.y[id] + hy * look * 0.7, pad) || blk(S.x[id] + hx * look, S.y[id] + hy * look, pad);
  if ((w.obstacles || cs) && d > 0.6 && !blk(S.x[id], S.y[id], 0)) { // (a man already inside one walks straight out of it)
    const look = Math.min(2.5, d);
    if (!S.avoid || S.avoid.length < S.cap * 2) { const a = new Float32Array(S.cap * 2); if (S.avoid) a.set(S.avoid.subarray(0, Math.min(S.avoid.length, a.length))); S.avoid = a; }
    const av = S.avoid;
    const hasAv = av[id * 2] !== 0 || av[id * 2 + 1] !== 0;
    if (hasAv || ((w.tick + id) & 1) === 0) {
      if (sweep(ux, uy, look, 0.3)) {
        let hx = av[id * 2], hy = av[id * 2 + 1];
        if (!hasAv || sweep(hx, hy, look, 0)) {
          let best = null;
          for (const off of [0.5, -0.5, 0.9, -0.9, 1.3, -1.3, 1.57, -1.57, 1.9, -1.9]) {
            const o = (id & 1) ? off : -off, c = Math.cos(o), sn = Math.sin(o), qx = ux * c - uy * sn, qy = ux * sn + uy * c;
            if (hasAv && qx * av[id * 2] + qy * av[id * 2 + 1] < -0.2) continue; // never double back on the detour
            if (!sweep(qx, qy, look, Math.abs(off) >= 1.3 ? 0 : 0.3)) { best = [qx, qy]; break; }
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
  let v = want * g;
  // FOLLOW: a man keeping his place in a body on the move walks at the body's own pace, and closes on his place in
  // proportion to how far out of it he is — he does not stop dead each time he reaches it and dash after it again
  // (the old 0.4 m dead band made every man of a marching body stop-go at the tick, 0 ↔ 2 m/s). (Not round an
  // obstacle he is detouring, nor in going that will not bear him: there he heads where those rules point him.)
  if (moving && !tight && g >= 0.05 && u.vax !== undefined && d < 25 && !(S.avoid && (S.avoid[id * 2] !== 0 || S.avoid[id * 2 + 1] !== 0))) {
    let lim = cap;
    if (!A.mounted && S.wbal[id] < 0.2 * S.wp[id]) lim = Math.min(lim, Math.max(1.4, speedAtPower(S, id, S.cp[id], 0, 1.1)));
    if (A.mounted && S.horseOK[id] === 1 && S.hwbal[id] < 60) lim = Math.min(lim, 3.6);
    if (A.mounted && S.horseOK[id] !== 1) lim = Math.min(lim, 1.3);
    const ffk = Math.min(1, g / Math.max(0.05, u.gA || 1)), fx = u.vax * ffk + MOM.follow * dx * g, fy = u.vay * ffk + MOM.follow * dy * g, fm = Math.hypot(fx, fy);
    if (fm > 1e-4) { ux = fx / fm; uy = fy / fm; v = Math.min(fm, lim * g); } else v = 0;
  }
  // momentum: the stride he wants (ux, uy at v) is reached at his legs' or his horse's rate. A man on foot gathers
  // and sheds pace in a second or so and can step any way; a horse carries its weight — it gathers speed over seconds,
  // pulls up over metres, and comes round only as tight as its speed lets it (a halted charge overshoots, wheels, and
  // walks back into its place; a horse that must turn far slows to a trot to do it)
  const horse = A.mounted && S.horseOK[id] === 1, acc = horse ? MOM.horse[0] : MOM.foot[0], dec = horse ? MOM.horse[1] : MOM.foot[1];
  if (tight) { mx = ux * v; my = uy * v; }
  else if (horse) {
    let spd = Math.hypot(mx, my), hd = spd > 0.05 ? Math.atan2(my, mx) : Math.atan2(uy, ux), vt = v;
    if (d > 0.4 || v > 0.05) {
      const dh = Math.atan2(Math.sin(Math.atan2(uy, ux) - hd), Math.cos(Math.atan2(uy, ux) - hd));
      if (Math.abs(dh) > MOM.slowTurn) vt = Math.min(vt, MOM.turnV);
      const tr = Math.min(MOM.turnMax, MOM.lat / Math.max(0.5, spd)) * DT; hd += clamp(dh, -tr, tr);
    }
    spd = vt > spd ? Math.min(vt, spd + acc * DT) : Math.max(vt, spd - dec * DT);
    mx = Math.cos(hd) * spd; my = Math.sin(hd) * spd;
  } else if (u.hold) {
    // (a body locked in a fight: its men's places are the fight's — the lean, the lull's give and take, the gaps filled
    // (combat.unitUpdate, MINGLE) — and they step to them as they always did; what a man brings into the press at a run
    // he sheds at his legs' rate, as he does what he brings into his own fight (combat.moveToward): the charge drives in,
    // then the press settles)
    const tvx = ux * v, tvy = uy * v, cx = mx - tvx, cy = my - tvy, c = Math.hypot(cx, cy), lim = dec * DT;
    if (c > lim) { mx = tvx + cx / c * (c - lim); my = tvy + cy / c * (c - lim); } else { mx = tvx; my = tvy; }
  } else {
    const tvx = ux * v, tvy = uy * v, ex = tvx - mx, ey = tvy - my, e = Math.hypot(ex, ey), lim = (v * v >= mx * mx + my * my ? acc : dec) * DT;
    if (e > lim) { mx += ex / e * lim; my += ey / e * lim; } else { mx = tvx; my = tvy; }
  }
  S.mvx[id] = mx; S.mvy[id] = my;
  // separation from neighbours (crowding): bodies do not pass into bodies (bodyPush)
  const sep = bodyPush(w, S, id, SEP); let sx = sep[0], sy = sep[1];
  let vx = mx + sx, vy = my + sy;
  S.vx[id] = vx; S.vy[id] = vy;
  S.x[id] = clamp(S.x[id] + vx * DT, w.map.x0, w.map.x1); S.y[id] = clamp(S.y[id] + vy * DT, w.map.y0, w.map.y1);
  // (a body locked in a fight keeps its face to the enemy: a man stepping back to his place — the front rank given
  // ground after a pulse, a blown man rotated to the rear, the ranks behind closing up — backs into it facing the
  // front, he does not turn his back on them; the owner: "they all turn around if they aren't in the front row")
  const backing = u.hold && !u.c?.broken && u.formation !== "schiltron" && d < 12 && dx * -Math.sin(u.facing) + dy * Math.cos(u.facing) < 0.3 * d;
  const sp = Math.hypot(mx, my);
  if ((horse || (moving && !backing)) && sp > 0.6) S.facing[id] = Math.atan2(my, mx); // (a horse faces the way it is going: it does not slide sideways or back; nor does a man marching in his place)
  else if (d > 0.4 && !backing) S.facing[id] = Math.atan2(dy, dx);
  else S.facing[id] = u.formation === "schiltron" ? Math.atan2(S.y[id] - u.ay, S.x[id] - u.ax) : u.facing + Math.PI / 2; // a ring faces out
  // locomotion power (Pandolf) feeds the W′ balance, integrated by the combat system (§6.1); the shuffle
  // of crowding is not locomotion, so only the stride he actually makes counts
  if (A.mounted && S.horseOK[id] === 1) { S.power[id] = sp > 5 ? 250 : 130; horseStep(S, id, sp, DT); }
  else S.power[id] = locoPower(S, id, sp, S.gGrade[id] * 100, S.gEta[id] || 1.1);
  S.state[id] = d > 0.8 || moving || sp > MOM.still ? S_MOVE : S_IDLE;
}

// how fast a man's (or a horse's) velocity can change (steer, combat.moveToward), m/s²: [gather, shed]. A man reaches a
// walk in under half a second and stops from a run in two strides; a destrier takes ~4 s to the gallop (cavalry.CAV.accel
// 2.2) and pulls up from it over ~10 m. lat: m/s² of sideways grip a horse turns on (the tightest turn at speed v is
// lat/v rad/s), turnMax: rad/s at a walk; past slowTurn rad off its line it slows to turnV m/s to come round.
// follow: /s a man on the march closes on his place at (FOLLOW). still: m/s below which a man standing at his place is
// simply standing. vmax: the most momentum carried over from a charge or a flight.
// a man is stuck (steer) when in STUCK.win s he has closed less than STUCK.min m on a place more than 1.5 m off;
// a man who has given his place up stands until it has moved STUCK.park m from where it was, or STUCK.retry s, then
// tries again (STUCK.tries times at most, then he stays put until his place moves on); near: m from bark or stone that make a man stuck rather than slow
export const STUCK = { win: 1.5, min: 0.35, park: 3, retry: 5, tries: 3, near: 3 };
export const MOM = { foot: [3.5, 5], horse: [2, 3], follow: 0.8, lat: 4, turnMax: 2.5, slowTurn: 1.2, turnV: 3, still: 0.5, vmax: 10 };
// (water under him or within 2.5 m: a bank, a ford, a deck's edge)
function nearWater(M, x, y) { return M.water(x, y) > 0.05 || M.water(x + 2.5, y) > 0.05 || M.water(x - 2.5, y) > 0.05 || M.water(x, y + 2.5) > 0.05 || M.water(x, y - 2.5) > 0.05; }
// (within a castle's bounds, its ditch and the ground at its walls' foot: castle.js keeps C._.bbox)
function nearCastle(w, x, y) { for (const C of w.castles) { const b = C._?.bbox; if (b && x > b[0] - 15 && y > b[1] - 15 && x < b[2] + 15 && y < b[3] + 15) return true; } return false; }
export function momArrays(S) {
  if (S.mvK && S.mvK.length === S.cap) return;
  for (const [k, C] of [["mvx", Float32Array], ["mvy", Float32Array], ["mvK", Int32Array]]) { const a = new C(S.cap); if (S[k]) a.set(S[k].subarray(0, Math.min(S[k].length, S.cap))); else if (k === "mvK") a.fill(-1); S[k] = a; }
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
