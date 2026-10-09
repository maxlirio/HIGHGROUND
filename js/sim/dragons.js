// DRAGONS — the vale's two great worms (the crown jewel, not a unit type). Each has a LAIR at a wild crag far from
// the holds. Mostly they SLEEP. Now and then one RANGES: it takes wild game or a flock's sheep, or burns a ripe field
// at the margins of a hold, and goes home — a looming presence, not a town-destroyer. PROVOKED (shot at, or its lair
// approached in force) it FIGHTS: it flies between perch points but fights low and landed; fire breath is a cone that
// sets men, buildings and crops burning (the existing fire systems); its presence is terror (morale stress). It should
// take a prepared company with losses. Below ~25% health it YIELDS (lands, cowed) rather than dies — it dies only if
// men keep attacking a yielded dragon.
//
// TRAINING: a yielded dragon can be CLAIMED by the house that broke it (most of the damage): it returns to its lair
// bound to that house, and the house's keeper feeds it MEAT over real time (fresh from the stores, then live sheep —
// a big upkeep that ties to hunting and livestock). Its trust grows through stages: sullen → broken-in → BONDED.
// A bonded dragon can be summoned by its lord: it flies where sent, lands, breathes fire on a cooldown, and terrifies —
// but it TIRES (must go home), will not touch a shielded or Keep's-Peace house (the same gates raiders obey), and can
// be killed for good. A house that falls, or stops feeding it, loses it: the dragon goes wild again. ONE dragon per
// house at most; two exist in the world.
//
// Like the wild (js/sim/wild.js) the dragons are NOT soldiers: plain data in w.dragons, never in w.S, so battles,
// battle-mc and the formations never see them. Deterministic and DOM-free; all chance is hsh(tick, id) — never w.rng.
// Dragons exist only where the world asks for them (w.dragonsOn: the realm server and the single-player campaign set
// it; battle and siege worlds never do). Everything here is plain data: it round-trips server/persist.mjs whole.
//
//   w.dragons = { list: [D], ver, shots: [[x0,y0,z0,x1,y1,z1,t]] }
//   D = { id, name, hue, home: {x, y}, x, y, z, f, st, t0, hp, hpMax,
//         mode: "sleep"|"range"|"home"|"fight"|"yield"|"dead", tx, ty, act, nextRangeT, biteT, breathT, breath,
//         foesM (bitmask: the teams that provoked it), dmg: [kg per team], hurtT, disT,
//         owner, stage (0 wild, 1 sullen, 2 broken-in, 3 bonded), trust, hunger, lastDay,
//         brokeBy, yieldT, summoned, stam, deeds: { men, burnt, game } }
//   st (what the renderer plays): sleep | stand | walk | fly | glide | land | bite | breathe | yield | dead
import { TICK, BATTLE_RATE, ECON_DAYS_PER_REAL_SEC } from "./clock.js";
import { neighbours, issueOrder } from "./world.js";
import { ARMS } from "./arms.js";
import { hsh, herdById, takeAnimal } from "./wild.js";
import { fell } from "./melee.js";
import { W_INCAP, W_MORTAL, W_INSTANT } from "./soldiers.js";
import { isFoe, shielded } from "./sides.js";
import { TICKS } from "./labor.js";
import { loadObjects } from "./obstacles.js";
import { markObstaclesOnNav } from "./path.js";
import * as EC from "./economy.js";

const BT = TICK * BATTLE_RATE, EDT = TICK * ECON_DAYS_PER_REAL_SEC;
export const STAGE_NAME = ["wild", "sullen", "broken-in", "bonded"];
// Two clocks, deliberately: the ECONOMY (meat eaten per economic day — the upkeep that ties the dragon to hunting and
// livestock, on the same compressed days as fields and larders) and the REALM's real time, w.time seconds (trust,
// hunger, healing, stamina — the same clock as newcomer protection: taming a dragon is a project of real days, and a
// beaten dragon is not back at full strength before its beaters are home).
export const DR = {
  hpMax: 1100,
  radius: 4.6,          // the body (~10 m nose to tail, ~3.9 m at the withers: a company stands at its knees)
  biteR: 9, biteEveryS: 3.6, biteMen: 2,
  flyV: 15, walkV: 2.0, flyH: 42,       // m/s on the battle clock; cruising height
  breathLen: 32, breathCos: 0.92, breathEveryS: 26, breathHoldS: 2.4, breathFell: 5, // (a cone of fire fells at most breathFell men: the rest are scattered, scorched and shaken)
  terrorR: 42, terrorPerS: 0.055,
  yieldAt: 0.25,        // yields (cowed) below this share of hpMax
  provokeMen: 8, lairR: 140,            // an armed force this big, this near the lair, is a provocation
  rangeMinS: 700, rangeVarS: 1600,      // realm seconds between rangings (mean ~25 min)
  arrowP: 0.24, arrowFly: 0.35,         // a company's arrow damage per man per volley; ×arrowFly while it is on the wing
  meleePerManS: 0.12,                   // hp a man at its flank hacks off per second
  meatDayKg: 60, sheepKg: 25,           // the keeper's upkeep per ECON day: fresh meat, then live sheep
  starveS: 8 * 3600,                    // unfed this long (realm time) it breaks its bond and goes wild
  brokenS: 12 * 3600, bondedS: 36 * 3600, // realm seconds of well-fed keeping: sullen → broken-in → bonded
  staminaS: 1500,                       // a summoned dragon's wind, realm seconds (flying drains it faster; the flight home is free)
  healS: 12 * 3600,                     // full heal over this long asleep at its lair (realm time)
  yieldWaitS: 7200, disengageS: 25,
};
const cfgOf = (w) => (w.dragonCfg ? { ...DR, ...w.dragonCfg } : DR); // (tests tighten the clocks through w.dragonCfg)

export const dragonsOf = (w) => w.dragons || null;
// the way its lair faces (and it lies at home): the renderer sets the crag's hollow round the sleeper on this heading
export const lairF = (id) => hsh(id, 11) * 6.283;
export const dragonById = (w, id) => w.dragons?.list.find((d) => d.id === id) || null;
export function dragonAt(w, x, y, r = 14) {
  let best = null, bd = r;
  for (const D of w.dragons?.list || []) { if (D.mode === "dead") continue; const d = Math.hypot(D.x - x, D.y - y); if (d < bd + DR.radius) { bd = d; best = D; } }
  return best;
}
export const dragonOfHouse = (w, team) => w.dragons?.list.find((d) => d.owner === team && d.mode !== "dead") || null;
// health as a fraction, on the sim's record (hp/hpMax) or the realm mirror's (hp01 — server/views.mjs)
export const hpFrac = (D) => (D.hpMax ? Math.max(0, D.hp) / D.hpMax : (D.hp01 ?? 1));

// may the dragon harm this team's men and buildings? The same gates raiders obey: never a shielded (protected /
// unfounded) house, never one under the Keep's Peace (its lord away or just back). Fields stay fair game (nuisance).
const fair = (w, t) => t >= 0 && t < w.teams.length && !shielded(w, t) && !w.teams[t]?.keepsPeace && !w.teams[t]?.fallen;
const ev = (w, e) => w.events.push({ t: w.tick, ...e });
// every harmful act against a house also signals the realm's attack watch (server/houses.mjs → web push)
const raid = (w, D, team, x, y, what) => { if (team >= 0) ev(w, { kind: "dragon-raid", d: D.id, team, x, y, what }); };

// ---------------------------------------------------------------- set-up (lazily, on the first economic tick)
const CRAG_TYPES = ["rocky_upland", "hill", "ridge", "wooded_knoll", "motte_hill"];
function townsOf(w) {
  const out = [];
  for (const f of w.map?.meta?.features || []) if (f.type === "town_site" || f.type === "farmland") out.push({ x: f.xy_m[0], y: f.xy_m[1] });
  for (const T of w.teams) if (T.town) out.push({ x: T.town.x, y: T.town.y });
  return out;
}
const dryish = (map, x, y) => map.inBounds(x, y) && map.water(x, y) < 0.05 && Math.hypot(...map.grad(x, y)) < 0.35;
const CAM_EDGE = 520; // the camera's view centre never gets nearer than 450 m to the world's edge (js/render/camera.js):
// a lair deeper into that band could never be looked at, let alone fought over — so the lair sits on the feature's apron
function lairSpot(w, fx, fy) { // the crag's foot: the nearest dry, standable, lookable ground to the feature
  const M = w.map; fx = Math.max(M.x0 + CAM_EDGE, Math.min(M.x1 - CAM_EDGE, fx)); fy = Math.max(M.y0 + CAM_EDGE, Math.min(M.y1 - CAM_EDGE, fy));
  if (dryish(w.map, fx, fy)) return [fx, fy];
  for (let r = 15; r <= 90; r += 15) for (let k = 0; k < 12; k++) { const a = k * 0.524, x = fx + Math.cos(a) * r, y = fy + Math.sin(a) * r; if (dryish(w.map, x, y)) return [x, y]; }
  return [fx, fy];
}
export function initDragons(w) {
  if (!w.map || !w.resources) return null;
  const G = (w.dragons = { list: [], ver: 0, shots: [] });
  const towns = townsOf(w), minTown = (x, y) => towns.reduce((m, t) => Math.min(m, Math.hypot(t.x - x, t.y - y)), 1e9);
  let cands = (w.map.meta?.features || []).filter((f) => CRAG_TYPES.includes(f.type))
    .map((f) => { const [x, y] = lairSpot(w, f.xy_m[0], f.xy_m[1]); return { name: f.name || f.type, x, y, score: minTown(x, y) }; })
    .filter((c) => c.score > 350).sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : 1));
  // no named crags (another map): the wildest dry ground on a coarse deterministic grid
  if (cands.length < 2) {
    const S = w.map.size, X0 = w.map.x0 || 0, Y0 = w.map.y0 || 0;
    for (let i = 2; i < 9; i++) for (let j = 2; j < 9; j++) { const x = X0 + S * i / 10, y = Y0 + S * j / 10; if (dryish(w.map, x, y)) cands.push({ name: null, x, y, score: minTown(x, y) }); }
    cands.sort((a, b) => b.score - a.score);
  }
  const picked = [];
  for (const c of cands) { if (picked.length >= 2) break; if (picked.every((p) => Math.hypot(p.x - c.x, p.y - c.y) > 1000)) picked.push(c); }
  picked.forEach((c, i) => {
    const [x, y] = [c.x, c.y];
    const D = { id: i + 1, name: c.name ? `the Dragon of ${c.name}` : i ? "the Red Dragon" : "the Ash Dragon", hue: i,
      home: { x, y }, x, y, z: 0, f: lairF(i + 1), st: "sleep", t0: w.time,
      hp: DR.hpMax, hpMax: DR.hpMax, mode: "sleep", tx: x, ty: y, act: null,
      nextRangeT: w.time + DR.rangeMinS * (0.4 + 0.8 * hsh(i + 1, 13)), biteT: 0, breathT: 0, breath: null,
      foesM: 0, dmg: [0, 0, 0, 0, 0, 0, 0, 0], hurtT: -1e9, disT: 0,
      owner: -1, stage: 0, trust: 0, hunger: 0, fedT: 0, lastDay: -1,
      brokeBy: -1, yieldT: 0, summoned: 0, stam: 1, deeds: { men: 0, burnt: 0, game: 0 } };
    G.list.push(D);
    // the lair crag is solid ground (men and paths go round it; the renderer sets the crag model here)
    if (w.obstacles) {
      loadObjects(w.obstacles, { objects: [{ asset: "dragon_lair", x, y, rot: hsh(i + 1, 17) * 6.283 }] }, { dragon_lair: [9, 7] });
      if (w.nav && w.obstacles.fresh?.length) { markObstaclesOnNav(w.nav, w.obstacles.fresh); w.obstacles.fresh.length = 0; }
    }
  });
  G.ver++;
  return G;
}

// ---------------------------------------------------------------- movement (a dragon ignores ground obstacles: it flies)
const landable = (map, x, y) => map.inBounds(x, y) && map.water(x, y) < 0.3;
function moveD(w, D, v) { // toward (D.tx, D.ty); → true when arrived (down, on the spot)
  const dx = D.tx - D.x, dy = D.ty - D.y, d = Math.hypot(dx, dy);
  const want = Math.atan2(dy, dx);
  let da = Math.atan2(Math.sin(want - D.f), Math.cos(want - D.f));
  const fly = d > 30 || D.z > 1;
  D.f += Math.max(-2.2 * BT, Math.min(2.2 * BT, da));
  if (fly) {
    // climb out, cruise, and sink onto the mark
    const wantZ = d > 60 ? DR.flyH : Math.min(DR.flyH, Math.max(0, d * 0.6 - 4));
    D.z += Math.max(-10 * BT, Math.min(9 * BT, wantZ - D.z));
    const sp = Math.min(v * BT, d);
    if (d > 0.5 && Math.abs(da) < 1.2) { D.x += Math.cos(D.f) * sp; D.y += Math.sin(D.f) * sp; }
    setSt(w, D, D.z > 4 && d < 70 && wantZ < D.z ? "land" : D.z > 4 && hsh(D.id, Math.floor(w.time / 3)) < 0.35 ? "glide" : "fly");
  } else {
    D.z = Math.max(0, D.z - 10 * BT);
    const sp = Math.min(DR.walkV * BT, d);
    if (d > 0.4) { D.x += Math.cos(want) * sp; D.y += Math.sin(want) * sp; setSt(w, D, "walk"); }
  }
  D.x = Math.max(w.map.x0 + 4, Math.min(w.map.x1 - 4, D.x)); D.y = Math.max(w.map.y0 + 4, Math.min(w.map.y1 - 4, D.y));
  return d < 2.5 && D.z < 0.6;
}
function setSt(w, D, st) { if (D.st !== st) { D.st = st; D.t0 = w.time; w.dragons.ver++; } }
function sendHome(w, D) { D.mode = "home"; D.tx = D.home.x; D.ty = D.home.y; D.act = null; }

// ---------------------------------------------------------------- the breath and the bite
// the cone of fire from the mouth toward (bx, by): men burn or break, flammable buildings and ripe crops catch.
// forTeam: -1 = a wild dragon (it burns only the teams that provoked it); else the bound dragon's house (it burns that
// house's foes). Either way the raider gates hold: never a shielded or Keep's-Peace house's men or buildings.
export function applyBreath(w, D, bx, by, forTeam = -1) {
  const C = cfgOf(w);
  const dx = bx - D.x, dy = by - D.y, dd = Math.hypot(dx, dy) || 1, ux = dx / dd, uy = dy / dd;
  const mayBurn = (t) => t !== forTeam && t !== D.owner && fair(w, t) && (forTeam >= 0 ? isFoe(w, forTeam, t) : (D.foesM >> t) & 1);
  const S = w.S, nb = neighbours(w, D.x + ux * C.breathLen * 0.5, D.y + uy * C.breathLen * 0.5, C.breathLen * 0.7, tmpN);
  const ctx = w.cs?.ctx; let slain = 0, felled = 0;
  const hurtTeams = new Map();
  for (const i of nb) {
    if (!S.alive[i]) continue;
    const ox = S.x[i] - D.x, oy = S.y[i] - D.y, od = Math.hypot(ox, oy);
    if (od > C.breathLen || od < 1 || (ox * ux + oy * uy) / od < C.breathCos) continue;
    const t = S.team[i];
    if (!mayBurn(t)) continue;
    const h = hsh(i + 7919, w.tick);
    // at most breathFell men fall to one cone (the fire sweeps a line, men dive aside): the rest burn, break and run
    if (ctx && felled < C.breathFell && h < 0.42) { fell(ctx, i, -1, W_INSTANT, "dragonfire"); slain++; felled++; }
    else if (ctx && felled < C.breathFell && h < 0.7) { fell(ctx, i, -1, W_INCAP, "dragonfire"); felled++; }
    else { S.stress[i] += 0.9 * (1.3 - S.courage[i]); if (w.cs?.recentShot) w.cs.recentShot[i] = w.time; }
    hurtTeams.set(t, (hurtTeams.get(t) || 0) + 1);
  }
  for (const b of w.buildings) {
    if (b.ruin) continue;
    const ox = b.x - D.x, oy = b.y - D.y, od = Math.hypot(ox, oy);
    if (od > C.breathLen + 6 || (od > 1 && (ox * ux + oy * uy) / od < C.breathCos - 0.04)) continue;
    if (b.field) { // crops: only a ripe or near-ripe field carries fire (as raiders' arson), and fields are fair nuisance
      const f = b.field;
      if (b.fire > 0 || !(f.state === "ripe" || (f.state === "growing" && w.econ && w.econ.doy > f.ripe - 20))) continue;
      if (b.team === forTeam || b.team === D.owner) continue;
      b.fire = 0.3; ev(w, { kind: "field-fired", building: b.id, team: b.team, dragon: D.id });
      ev(w, { kind: "dragon-field", d: D.id, team: b.team, building: b.id, x: b.x, y: b.y }); raid(w, D, b.team, b.x, b.y, "a dragon is burning the fields");
      D.deeds.burnt++;
      continue;
    }
    if (!mayBurn(b.team)) continue;
    const def = EC.BUILDINGS[b.kind];
    if (def?.flammable) { EC.damageBuilding(w, b, 10, 1); if (b.fire > 0) { ev(w, { kind: "fire", building: b.id, team: b.team, dragon: D.id }); D.deeds.burnt++; } }
    else EC.damageBuilding(w, b, 30, 0); // stone scorches and cracks, slowly
    hurtTeams.set(b.team, (hurtTeams.get(b.team) || 0) + 1);
  }
  for (const [t] of hurtTeams) raid(w, D, t, bx, by, "a dragon is upon us");
  D.deeds.men += slain;
  D.f = Math.atan2(dy, dx); // (it swings its head and fore-body onto the cone it pours)
  D.breath = { x: bx, y: by, t0: w.time, until: w.time + C.breathHoldS };
  D.breathT = w.time + C.breathEveryS; D.biteT = Math.max(D.biteT, w.time + 1.2);
  setSt(w, D, "breathe");
  return slain;
}
const tmpN = [];

function bite(w, D, foes) {
  const C = cfgOf(w), S = w.S, ctx = w.cs?.ctx; if (!ctx) return;
  let n = 0;
  const men = 1 + (hsh(D.id * 53, w.tick) < 0.4 ? 1 : 0); // one man seized, sometimes a second swept down
  for (const i of foes) {
    if (n >= Math.min(men, C.biteMen)) break;
    if (!S.alive[i] || S.team[i] === D.owner || Math.hypot(S.x[i] - D.x, S.y[i] - D.y) > C.biteR) continue;
    fell(ctx, i, -1, hsh(i + 131, w.tick) < 0.6 ? W_MORTAL : W_INCAP, "dragon"); n++; D.deeds.men++;
  }
  if (n) { D.biteT = w.time + C.biteEveryS; setSt(w, D, "bite"); }
}

function terror(w, D, every) {
  const S = w.S, nb = neighbours(w, D.x, D.y, DR.terrorR, tmpN);
  for (const i of nb) {
    if (!S.alive[i] || S.team[i] === D.owner) continue;
    S.stress[i] += DR.terrorPerS * every * BT * (1.3 - S.courage[i]);
    if (w.cs?.recentShot) w.cs.recentShot[i] = w.time;
  }
}

// the hostile men it fights: teams in its quarrel (foesM), or its house's foes when summoned — never an unfair team
function hostilesNear(w, D, r) {
  const S = w.S, out = [], nb = neighbours(w, D.x, D.y, r, tmpN);
  for (const i of nb) {
    if (!S.alive[i]) continue;
    const t = S.team[i];
    if (D.summoned ? (t !== D.owner && isFoe(w, D.owner, t) && fair(w, t)) : ((D.foesM >> t) & 1 && fair2(w, D, t))) {
      const u = w.units.get(S.unit[i]); if (!u || u.isWorkers) continue;
      out.push(i);
    }
  }
  out.sort((a, b) => (Math.hypot(S.x[a] - D.x, S.y[a] - D.y) - Math.hypot(S.x[b] - D.x, S.y[b] - D.y)) || a - b);
  return out;
}
// a wild dragon answers whoever attacks it, shielded or not (self-defence); but never a Keep's-Peace house's men
const fair2 = (w, D, t) => t >= 0 && !w.teams[t]?.keepsPeace && !w.teams[t]?.fallen;

// ---------------------------------------------------------------- being fought (men ordered against it: u.dragonTgt)
export function orderAttackDragon(w, team, units, id) {
  const D = dragonById(w, id);
  if (!D || D.mode === "dead") return { ok: false, error: "It is gone" };
  if (D.owner === team) return { ok: false, error: "It is your own dragon" };
  let n = 0;
  for (const u of units) { if (u.isWorkers || ARMS[u.arm].engine) continue; u.dragonTgt = id; u.dragonPress = D.mode === "yield" ? 1 : 0; u.fireAt = null; n++; }
  if (!n) return { ok: false, error: "No company that can fight it" };
  D.foesM |= 1 << team;
  if (D.mode === "sleep" || D.mode === "home" || D.mode === "range") { D.mode = "fight"; ev(w, { kind: "dragon-fight", d: D.id, team, x: D.x, y: D.y }); }
  return { ok: true, n, msg: D.mode === "yield" ? `They set upon the cowed beast` : `They go against ${D.name}` };
}
export function endDragonOrders(w, units) { for (const u of units) if (u.dragonTgt !== undefined && u.dragonTgt !== null) { u.dragonTgt = null; u.dragonPress = 0; } }
function clearAllAttackers(w, id) { for (const u of w.units.values()) if (u.dragonTgt === id) { u.dragonTgt = null; u.dragonPress = 0; } }

function fightersTick(w, G) {
  const C = cfgOf(w), S = w.S;
  for (const u of w.units.values()) {
    if (u.dragonTgt == null) continue;
    const D = dragonById(w, u.dragonTgt);
    if (!D || D.mode === "dead" || !u.members.length || (D.mode === "yield" && !u.dragonPress)) { if (u.dragonTgt != null) { u.dragonTgt = null; u.dragonPress = 0; } continue; }
    D.foesM |= 1 << u.team;
    const d = Math.hypot(u.ax - D.x, u.ay - D.y);
    const A = ARMS[u.arm];
    if (A.missile) {
      // bowmen stand off and loose — and give ground when it comes for them (they know better than to meet its teeth)
      if ((d > 165 || d < 55) && w.tick % 40 === u.id % 40) {
        const sx = D.x + (u.ax - D.x) / (d || 1) * 110, sy = D.y + (u.ay - D.y) / (d || 1) * 110;
        issueOrderSafe(w, u, { kind: "skirmish", x: sx, y: sy, pace: "quick", facing: Math.atan2(D.y - u.ay, D.x - u.ax) });
      }
      if (d <= 175 && (w.tick + u.id) % 30 === 0) {
        const men = Math.min(u.members.length, 90);
        const vol = men * C.arrowP * (D.z > 3 ? C.arrowFly : 1) * (0.75 + 0.5 * hsh(u.id, w.tick));
        hurtDragon(w, D, vol, u.team);
        for (let k = 0; k < Math.min(4, Math.ceil(men / 15)); k++) {
          const i = u.members[(k * 7) % u.members.length];
          G.shots.push([S.x[i], S.y[i], 1.6, D.x + (hsh(i, w.tick) - 0.5) * 4, D.y + (hsh(i + 3, w.tick) - 0.5) * 4, D.z + 1.5, w.time]);
        }
      }
    } else {
      if (d > C.biteR + 2 && w.tick % 20 === u.id % 20) issueOrderSafe(w, u, { kind: "move", x: D.x, y: D.y, pace: "quick" });
      let m = 0; for (const i of u.members) if (S.alive[i] && Math.hypot(S.x[i] - D.x, S.y[i] - D.y) < DR.radius + 3) m++;
      if (m && D.z < 2) hurtDragon(w, D, m * C.meleePerManS * BT * (0.8 + 0.4 * hsh(u.id, w.tick)), u.team);
    }
  }
  if (G.shots.length && w.time - G.shots[0][6] > 4) G.shots = G.shots.filter((s) => w.time - s[6] <= 4);
}
// orders from the dragon's own driver never queue through command friction, and never pull a body locked in a melee
function issueOrderSafe(w, u, o) { if (u.c && u.c.phase && u.c.phase !== "idle") return; issueOrder(w, [u.id], { ...o, immediate: true }); }

export function hurtDragon(w, D, hp, team) {
  if (D.mode === "dead" || hp <= 0) return;
  D.hp -= hp; D.hurtT = w.time;
  if (team >= 0 && team < 8) { D.dmg[team] += hp; D.foesM |= 1 << team; }
  if (D.mode !== "fight" && D.mode !== "yield") { D.mode = "fight"; ev(w, { kind: "dragon-fight", d: D.id, team, x: D.x, y: D.y }); }
  if (D.hp <= 0) return dieDragon(w, D, team);
  if (D.mode !== "yield" && D.hp < D.hpMax * cfgOf(w).yieldAt) yieldDragon(w, D);
}
function argmaxDmg(D) { let b = -1, bv = 0; for (let t = 0; t < 8; t++) if (D.dmg[t] > bv) { bv = D.dmg[t]; b = t; } return b; }
function yieldDragon(w, D) {
  D.mode = "yield"; D.z = 0; D.summoned = 0; D.yieldT = w.time; D.brokeBy = argmaxDmg(D); D.breath = null;
  const hadOwner = D.owner; D.owner = -1; D.stage = 0; D.trust = 0;
  setSt(w, D, "yield");
  clearAllAttackers(w, D.id);
  ev(w, { kind: "dragon-yielded", d: D.id, by: D.brokeBy, team: hadOwner, x: D.x, y: D.y });
  w.dragons.ver++;
}
function dieDragon(w, D, team) {
  D.mode = "dead"; D.z = 0; D.summoned = 0; D.breath = null;
  const hadOwner = D.owner; D.owner = -1;
  setSt(w, D, "dead");
  clearAllAttackers(w, D.id);
  ev(w, { kind: "dragon-slain", d: D.id, by: team >= 0 ? team : argmaxDmg(D), team: hadOwner, x: D.x, y: D.y, name: D.name });
  w.dragons.ver++;
}
function goWild(w, D, why) {
  const team = D.owner;
  D.owner = -1; D.stage = 0; D.trust = 0; D.hunger = 0; D.summoned = 0; D.foesM = 0; D.dmg.fill(0);
  sendHome(w, D);
  ev(w, { kind: "dragon-wild", d: D.id, team, why, x: D.x, y: D.y });
  w.dragons.ver++;
}

// ---------------------------------------------------------------- the lord's commands (js/game/commands.js op "dragon")
export function claimDragon(w, team, id) {
  const D = dragonById(w, id);
  if (!D || D.mode !== "yield") return { ok: false, error: "No yielded dragon there" };
  if (D.brokeBy !== team) return { ok: false, error: "It was not your house that broke it" };
  if (dragonOfHouse(w, team)) return { ok: false, error: "Your house already keeps a dragon" };
  const S = w.S; let near = 0;
  for (const u of w.units.values()) if (u.team === team && !u.isWorkers) for (const i of u.members) if (S.alive[i] && Math.hypot(S.x[i] - D.x, S.y[i] - D.y) < 80) { near = 1; break; }
  if (!near) return { ok: false, error: "Your men must stand over it to bind it" };
  D.owner = team; D.stage = 1; D.trust = 0; D.hunger = 0; D.fedT = w.time; D.foesM = 0; D.dmg.fill(0); D.brokeBy = -1;
  sendHome(w, D);
  ev(w, { kind: "dragon-claimed", d: D.id, team, x: D.x, y: D.y, name: D.name });
  w.dragons.ver++;
  return { ok: true, msg: `${D.name} is bound to your house — your keeper will need meat (${DR.meatDayKg} kg a day)` };
}
export function summonDragon(w, team, id, x, y) {
  const D = dragonById(w, id);
  if (!D || D.owner !== team || D.mode === "dead") return { ok: false, error: "You keep no such dragon" };
  if (D.stage < 3) return { ok: false, error: `It is ${STAGE_NAME[D.stage]} — it will not come until it is bonded` };
  if (D.summoned) return { ok: false, error: "It is already called" };
  if (D.stam < 0.35) return { ok: false, error: "It is spent: let it rest at its lair" };
  if (D.mode === "fight" || D.mode === "yield") return { ok: false, error: "It cannot hear you now" };
  D.summoned = 1; D.mode = "fight"; D.act = null; D._foes = null; D.breathT = Math.max(D.breathT, w.time + 4);
  const T = w.teams[team];
  D.tx = D.mx = Number.isFinite(x) ? x : T?.town?.x ?? D.home.x; D.ty = D.my = Number.isFinite(y) ? y : T?.town?.y ?? D.home.y;
  ev(w, { kind: "dragon-summoned", d: D.id, team, x: D.tx, y: D.ty });
  return { ok: true, msg: `${D.name} takes wing for your banner` };
}
export function dragonMove(w, team, id, x, y) {
  const D = dragonById(w, id);
  if (!D || D.owner !== team || !D.summoned) return { ok: false, error: "No dragon answers you" };
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, error: "Not on the map" };
  D.tx = D.mx = Math.max(w.map.x0 + 4, Math.min(w.map.x1 - 4, x)); D.ty = D.my = Math.max(w.map.y0 + 4, Math.min(w.map.y1 - 4, y));
  if (!landable(w.map, D.tx, D.ty)) return { ok: false, error: "It will not light on water" };
  return { ok: true, msg: "The dragon flies where you point" };
}
export function dragonBreathe(w, team, id, x, y) {
  const D = dragonById(w, id);
  if (!D || D.owner !== team || !D.summoned) return { ok: false, error: "No dragon answers you" };
  if (w.time < D.breathT) return { ok: false, error: `Its fire is not yet gathered (${Math.ceil(D.breathT - w.time)} s)` };
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x - D.x, y - D.y) > DR.breathLen * 1.15) return { ok: false, error: "Too far — fly it closer first" };
  const slain = applyBreath(w, D, x, y, team);
  return { ok: true, msg: slain ? `Fire — ${slain} men burn` : "Fire sweeps the ground" };
}
export function recallDragon(w, team, id) {
  const D = dragonById(w, id);
  if (!D || D.owner !== team || !D.summoned) return { ok: false, error: "No dragon is abroad" };
  D.summoned = 0; sendHome(w, D);
  return { ok: true, msg: "It turns for its lair" };
}

// ---------------------------------------------------------------- ranging: the looming presence
function pickRaid(w, D) {
  const h = hsh(D.id * 31, w.tick);
  // a ripe field at the margins of the nearest standing hold (nuisance: allowed against anyone)
  if (h < 0.3) {
    let best = null, bs = -1;
    for (const b of w.buildings) {
      if (!b.field || b.ruin || b.fire > 0 || b.field.state !== "ripe") continue;
      const T = w.teams[b.team]; if (!T?.town || T.fallen) continue;
      const margin = Math.hypot(b.x - T.town.x, b.y - T.town.y); if (margin < 120) continue; // the margins, not the town
      const score = 4000 - Math.hypot(b.x - D.home.x, b.y - D.home.y) + margin;
      if (score > bs) { bs = score; best = b; }
    }
    if (best) return { kind: "field", building: best.id, team: best.team, x: best.x, y: best.y };
  }
  // a flock (live sheep at the nearest hold that keeps any)
  if (h < 0.55) {
    let best = -1, bd = 1e9;
    for (const T of w.teams) { if (!T.town || !(T.sheep > 1) || !fair(w, T.id)) continue; const d = Math.hypot(T.town.x - D.home.x, T.town.y - D.home.y); if (d < bd) { bd = d; best = T.id; } } // (a protected or away house loses fields at most: never its flocks)
    if (best >= 0) { const T = w.teams[best]; return { kind: "flock", team: best, x: T.town.x + 90, y: T.town.y + 60 }; }
  }
  // wild game: the nearest living herd
  let best = null, bd = 1e9;
  for (const H of w.wild?.herds || []) { if (H.n <= 0) continue; const d = Math.hypot(H.cx - D.home.x, H.cy - D.home.y); if (d < bd) { bd = d; best = H; } }
  if (best) return { kind: "game", herd: best.id, x: best.cx, y: best.cy };
  return null;
}
function doRaid(w, D) {
  const a = D.act; if (!a) return;
  if (a.kind === "game") {
    const H = herdById(w, a.herd);
    const A = H && w.wild?.a.find((q) => q.h === H.id);
    if (A) { takeAnimal(w, A, D.x, D.y); ev(w, { kind: "dragon-game", d: D.id, x: D.x, y: D.y, sp: A.sp }); D.deeds.game++; }
  } else if (a.kind === "flock") {
    const T = w.teams[a.team];
    if (T && T.sheep > 1 && fair(w, a.team)) { T.sheep = Math.max(0, T.sheep - 2); ev(w, { kind: "dragon-flock", d: D.id, team: a.team, x: D.x, y: D.y }); raid(w, D, a.team, D.x, D.y, "a dragon is taking the flocks"); D.deeds.game++; }
  } else if (a.kind === "field") {
    const b = w.buildings.find((q) => q.id === a.building);
    if (b && !b.ruin && b.fire <= 0 && b.field?.state === "ripe") {
      b.fire = 0.3; ev(w, { kind: "field-fired", building: b.id, team: b.team, dragon: D.id });
      ev(w, { kind: "dragon-field", d: D.id, team: b.team, building: b.id, x: b.x, y: b.y }); raid(w, D, b.team, b.x, b.y, "a dragon is burning the fields");
      D.deeds.burnt++;
      D.breath = { x: b.x, y: b.y, t0: w.time, until: w.time + 1.6 }; setSt(w, D, "breathe");
    }
  }
}

// ---------------------------------------------------------------- the keeper's day (the MEAT, on the economy's clock)
function dailyD(w, D) {
  const C = cfgOf(w);
  if (D.owner < 0) return;
  const T = w.teams[D.owner];
  if (!T || T.fallen) return goWild(w, D, "its house fell");
  // the keeper feeds it: fresh meat from the stores, then live sheep off the hoof
  const need = C.meatDayKg; let got = EC.take(T, "fresh", need);
  if (got < need && T.sheep > 0) { const sheep = Math.min(T.sheep, Math.ceil((need - got) / C.sheepKg)); T.sheep -= sheep; got += sheep * C.sheepKg; }
  const fed = Math.min(1, got / need);
  ev(w, { kind: "dragon-fed", d: D.id, team: D.owner, kg: Math.round(got), fed });
  if (fed >= 0.75) D.fedT = w.time; // a good meal: the keeper's clock (realm time) starts afresh
}
// the slow realm-time lane (every 10 ticks): healing asleep, trust toward the bond, starvation, wind
function keptTick(w, D, C) {
  const t = w.time, dt = 10 * BT;
  if (D.mode === "sleep" && D.hp < D.hpMax) D.hp = Math.min(D.hpMax, D.hp + D.hpMax * dt / C.healS * (D.owner >= 0 ? 1.3 : 1));
  if (D.owner < 0) return;
  D.hunger = Math.min(1, Math.max(0, (t - D.fedT) / C.starveS));
  if (D.hunger >= 1) return goWild(w, D, "it went unfed");
  if (D.hunger < 0.5) { // a well-fed dragon slowly gives its trust; a hungry one gives nothing
    D.trust += dt;
    const stage = D.trust >= C.bondedS ? 3 : D.trust >= C.brokenS ? 2 : 1;
    if (stage !== D.stage) { D.stage = stage; ev(w, { kind: "dragon-stage", d: D.id, team: D.owner, stage, name: D.name }); w.dragons.ver++; }
  }
  if (!D.summoned && D.mode === "sleep" && D.stam < 1) D.stam = Math.min(1, D.stam + dt / (C.staminaS * 12));
}

// ---------------------------------------------------------------- per tick
function dragonTick1(w, G, D) {
  const C = cfgOf(w), t = w.time;
  if (D.breath && t > D.breath.until) D.breath = null;
  if (D.mode === "dead") return;
  // a lord's fall frees its dragon at once
  if (D.owner >= 0 && (w.tick + D.id) % 50 === 0 && (!w.teams[D.owner] || w.teams[D.owner].fallen)) return goWild(w, D, "its house fell");

  if (D.mode === "yield") {
    setSt(w, D, "yield");
    if (t - D.yieldT > C.yieldWaitS) { D.hp = Math.max(D.hp, D.hpMax * 0.2); D.foesM = 0; D.dmg.fill(0); D.brokeBy = -1; sendHome(w, D); }
    return;
  }

  // provocation while it sleeps: an armed force at its lair
  if ((D.mode === "sleep" || D.mode === "home") && (w.tick + D.id) % 10 === 0) {
    const S = w.S, nb = neighbours(w, D.home.x, D.home.y, C.lairR, tmpN);
    let armed = 0, team = -1;
    for (const i of nb) { if (!S.alive[i]) continue; const u = w.units.get(S.unit[i]); if (u && !u.isWorkers && u.team !== D.owner && fair2(w, D, u.team)) { armed++; team = u.team; } }
    if (armed >= C.provokeMen) { D.foesM |= 1 << team; D.mode = "fight"; ev(w, { kind: "dragon-fight", d: D.id, team, x: D.x, y: D.y }); }
  }

  if (D.mode === "sleep") {
    setSt(w, D, "sleep");
    if (D.owner < 0 && t >= D.nextRangeT) {
      const a = pickRaid(w, D);
      D.nextRangeT = t + C.rangeMinS + C.rangeVarS * hsh(D.id, w.tick);
      if (a) { D.mode = "range"; D.act = a; D.tx = a.x; D.ty = a.y; ev(w, { kind: "dragon-wakes", d: D.id, x: D.home.x, y: D.home.y, name: D.name }); }
    }
    return;
  }
  if (D.mode === "range") {
    if (moveD(w, D, C.flyV)) { doRaid(w, D); sendHome(w, D); }
    return;
  }
  if (D.mode === "home") {
    if (moveD(w, D, C.flyV)) { D.mode = "sleep"; setSt(w, D, "sleep"); D.foesM = 0; D.dmg.fill(0); }
    return;
  }
  if (D.mode === "fight") {
    if ((w.tick + D.id) % 3 === 0) terror(w, D, 3);
    const S = w.S;
    // _foes: a cheap scan cache, refreshed every 5 ticks and never trusted across a gap (a stale list from the last
    // fight once had a freshly-summoned dragon perch over its own house's men). Plain data: it round-trips harmlessly.
    let foes = D._foes;
    if (!foes || w.tick - (D._foesT ?? -9) >= 5) { foes = D._foes = hostilesNear(w, D, D.summoned ? 130 : 260); D._foesT = w.tick; }
    if (D.summoned) {
      const T = w.teams[D.owner];
      D.stam -= BT / C.staminaS * (D.z > 2 ? 1.4 : 1);
      if (D.stam <= 0 || !T || T.fallen) { D.summoned = 0; ev(w, { kind: "dragon-tired", d: D.id, team: D.owner, x: D.x, y: D.y }); sendHome(w, D); return; }
      if (!foes.length) { D.tx = D.mx ?? D.tx; D.ty = D.my ?? D.ty; if (moveD(w, D, C.flyV)) setSt(w, D, "stand"); return; } // back to its lord's mark; stands there, head up
    } else if (!foes.length) {
      if (t - Math.max(D.hurtT, D.disT) > C.disengageS) { sendHome(w, D); return; }
      if (moveD(w, D, C.flyV * 0.6)) setSt(w, D, "stand");
      return;
    }
    if (foes.length) {
      D.disT = t;
      const i = foes[0], fx = S.x[i], fy = S.y[i], d = Math.hypot(fx - D.x, fy - D.y);
      // fire first where men stand thick, on its cooldown
      if (t >= D.breathT && D.z < 2 && d < C.breathLen * 0.9) {
        let cx = 0, cy = 0, n = 0;
        for (const q of foes) { if (Math.hypot(S.x[q] - D.x, S.y[q] - D.y) < C.breathLen) { cx += S.x[q]; cy += S.y[q]; n++; } }
        if (n >= (D.summoned ? 3 : 4)) { applyBreath(w, D, cx / n, cy / n, D.summoned ? D.owner : -1); return; }
      }
      if (d > C.biteR) {
        // fly between perch points, fight low: a short hop to a spot beside them, then land
        if (d > 46 || D.z > 1) { D.tx = fx + (D.x - fx) / (d || 1) * 14; D.ty = fy + (D.y - fy) / (d || 1) * 14; moveD(w, D, C.flyV); }
        else { D.tx = fx; D.ty = fy; moveD(w, D, C.flyV); }
      } else if (t >= D.biteT && D.z < 1.5) bite(w, D, foes);
      else if ((D.st === "bite" || D.st === "breathe") ? t - D.t0 > 1.6 : D.st !== "stand") setSt(w, D, "stand"); // between blows it rears over them
    }
  }
}

export function dragonsTick(w) {
  if (!w.dragonsOn || !w.econ) return;
  const G = w.dragons || initDragons(w); if (!G) return;
  const day = Math.floor(w.tick * EDT), C = cfgOf(w);
  for (const D of G.list) {
    if (D.lastDay < 0) D.lastDay = day;
    if (day !== D.lastDay) { D.lastDay = day; dailyD(w, D); }
    if (D.mode !== "dead" && (w.tick + D.id) % 10 === 0) keptTick(w, D, C);
    dragonTick1(w, G, D);
  }
  fightersTick(w, G);
}
TICKS.dragons = dragonsTick;
