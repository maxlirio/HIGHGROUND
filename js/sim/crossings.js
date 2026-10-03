// CROSSINGS AND ROUTES — how a body of men gets where it is sent (docs/crossings.md).
//
// Every order that moves a body (world.applyOrder) is routed here (routeOrder). The route is the nav grid's
// (path.js), with two pieces of sense on top:
//
//  1. WATER, MOATS. When the straight way to the destination runs into water the men cannot wade (a river, a deep
//     stream) or a castle's wet moat, the body weighs the ways over:
//       · round, by a ford or a bridge the land already has (the nav grid finds it), if that is not much longer
//         than going straight over (≤ 2× the direct time, or not slower than making a crossing here and going over);
//       · else it MAKES a crossing where it is: a fill of fascines (brushwood bundles and earth) across a wet moat or
//         ditch up to 12 m; a trestle-and-plank bridge across a stream or moat up to 15 m wide and 3 m deep;
//       · nothing across a real river: the route goes round by a ford, or the order is refused with the reason.
//     The work takes a company ~20–60 s (fascines) or ~1½–3 min (a bridge) of real time, longer with fewer men,
//     without timber in the store (cut on the spot), or under missiles. When it is done the crossing is ground like
//     any other — the water gone under the deck, the nav cells open — for BOTH sides: the enemy may use it, or burn a
//     bridge (burnCrossing; the fascine fill is earth and stays).
//  2. COVER. When enemy missile troops that the body can see could reach its route, the route is planned again with
//     open ground in their bowshot dearer and ground they cannot see into (woods, reverse slopes) a little cheaper —
//     and taken only when it costs at most 25 % more than the fastest (speed first: this is a game). Re-checked every
//     ~10 s on the march, not every tick.
//
// Both are on by default for the players' own companies (w.humanTeam / w.humanTeams) and for any team that asks
// (w.teams[t].smartRoutes, a captain's switch); the AI's calibrated battles keep the plain fastest route. The river
// and start-cell fixes in path.js apply to everyone.
//
// For the captains (js/sim/captains.js): planRoute(w, u, dest) → { route, crossing: { kind, x, y, secs, span } | null,
// covered, why } is pure (it changes nothing); u.route holds the last plan a body is following; w.events carries
// "crossing-started" / "crossing-done" / "crossing-burnt" / "route-covered" / "route-refused" with the plan's `why`.
import { findPath, wetBetween, WADE } from "./path.js";
import { ARMS, formationFiles } from "./arms.js";
import { FEATURES, WEATHER } from "./terrain-types.js";
import { addFeature, removeFeature, eachFeatureNear, pointSeg } from "./features.js";
import { carveCastle } from "./earthworks.js";
import { S_FIGHT } from "./soldiers.js";
import { TICK } from "./clock.js";
import { goingMul } from "./world.js"; // (a cycle: world.js routes its orders here; used only at call time)
import * as WN from "./wallnav.js";
import { changed as riversChanged } from "./rivers.js"; // (a crossing made or burnt: the men's own walks are worked out again)

// ---------------------------------------------------------------- the works (real seconds for a company of 60)
export const CROSS = {
  fascine: { name: "a fascine fill", maxSpan: 12, base: 15, perM: 3.5, timberPerM: 150, halfW: 3 }, // (timberPerM: kg of brushwood and stakes a metre of span),
  trestle: { name: "a trestle bridge", maxSpan: 15, maxDepth: 3, base: 45, perM: 8, timberPerM: 250, halfW: 2.5 }, // (kg: deck planks, stringers, trestles)
};
const REF_MEN = 60, CUT_NEAR = 1.3, CUT_FAR = 1.7, FIRE_MUL = 0.45; // cutting timber on the spot; missiles on the workers
const DETOUR_MAX = 2, COVER_MAX = 1.25, RECHECK_S = 10;
const RANGE = { longbow: 230, crossbow: 190 };
const DRY = 0.5; // m: water shallower than this is bank, not span

const clsOf = (u) => (ARMS[u.arm]?.mounted ? "cavalry" : "foot");
const speedOf = (u) => Math.max(0.5, ARMS[u.arm]?.speed || 1.3);
export const smartTeam = (w, team) => w.humanTeam === team || !!w.humanTeams?.includes?.(team) || !!w.teams?.[team]?.smartRoutes || !!w.smartRoutes;
// the real seconds a body takes to walk a route: its pace over the going under its feet (read every 4 m; a ford
// wades slowly). (The nav's own cost counts ground it only grazes — a bank cell with water in it — as impassable-dear,
// which made every route to or from a river bank look far longer than it is.)
export function travelSecs(w, u, from, pts) {
  const id = ARMS[u.arm]?.id ?? 0, sp = speedOf(u); let a = [from.x, from.y], t = 0;
  for (const b of pts || []) {
    const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy), n = Math.max(1, Math.ceil(d / 4));
    for (let s = 0; s < n; s++) { const x = a[0] + dx * (s + 0.5) / n, y = a[1] + dy * (s + 0.5) / n; t += d / n / (sp * Math.max(0.1, goingMul(w, id, x, y, dx, dy))); }
    a = b;
  }
  return t;
}
// an event: into this tick's w.events when inside one, else held for the next tick (an order given between two steps —
// the player's click — would otherwise be wiped when the next step clears w.events before anyone read it)
function emit(w, e) { (w.xingEv ||= []).push(e); }
const pathLen = (from, pts) => { let s = 0, a = from; for (const b of pts || []) { s += Math.hypot(b[0] - a[0], b[1] - a[1]); a = b; } return s; };

// ---------------------------------------------------------------- the order's route (world.applyOrder)
export function routeOrder(w, u, o, cls) {
  if (u.xing && w.crossings) leaveCrossing(w, u);
  u.burnXing = undefined; // (a new order ends a burning party's work; commands.js sets it again after its own order)
  u.route = null;
  const smart = !o.raw && !u.isWorkers && ARMS[u.arm]?.engine === undefined && !ARMS[u.arm]?.engine && smartTeam(w, u.team) && (o.kind === "move" || o.kind === "hold"); // (not a skirmish: bows following their mark do not bridge rivers after it)
  if (u.gates) u.gates = null;
  if (!smart) {
    const p = findPath(w.nav, cls, u.ax, u.ay, o.x, o.y);
    if (p) return wallRoute(w, u, o, cls, p);
    // no way there on the nav grid: straight on, unless straight on is into the water — then to its bank, and no further
    return wallRoute(w, u, o, cls, wetBetween(w.map, cls, u.ax, u.ay, o.x, o.y) ? [bankBefore(w.map, cls, u.ax, u.ay, o.x, o.y)] : [[o.x, o.y]]);
  }
  const P = planRoute(w, u, { x: o.x, y: o.y });
  u.route = { ...P, o, t: w.time, sig: P.sig };
  if (P.crossing) { startCrossing(w, u, P.crossing, o); return u.path || [[u.ax, u.ay]]; }
  if (!P.route) { emit(w, { t: w.tick, kind: "route-refused", team: u.team, unit: u.id, x: o.x, y: o.y, why: P.why }); return [[u.ax, u.ay]]; }
  if (P.covered) emit(w, { t: w.tick, kind: "route-covered", team: u.team, unit: u.id, why: P.why, extra: P.extra });
  return wallRoute(w, u, o, cls, P.route);
}
// TOWN WALLS (wallnav.js): the nav grid's 25 m cells cannot see a palisade or a 5 m gate passage, so a route that runs
// into a town wall is laid again on the walls' own geometry — out by the nearest sensible gate (or a breach, or a gap
// in an unfinished circuit), round the circuit, in by a gate. Legs far from the walls keep the nav grid's way over the
// land. A body shut out (an enemy's gates are shut to it) goes to the foot of the wall and no further: the siege is
// another order (siege.js: assault, escalade, the ram). Nothing changes where there are no walls.
export function wallRoute(w, u, o, cls, path) {
  if (!path || u.cst || u.works || u.esc || !WN.any(w) || !Number.isFinite(o.x)) return path; // (siege works lead their own men: a sally by its postern, an escalade)
  let a = [u.ax, u.ay], bad = false;
  for (const p of path) { if (!WN.clear(w, u.team, a[0], a[1], p[0], p[1])) { bad = true; break; } a = p; }
  if (!bad) { const g = WN.gatesCrossed(w, u.team, u.ax, u.ay, path); if (g.length) u.gates = g; return path; } // (through a gate of our own on the grid's way: named, for the warden and the column)
  const R = WN.route(w, u.team, u.ax, u.ay, o.x, o.y);
  if (!R) return [[o.x, o.y]]; // (the straight way is clear: it was the grid's route that met the wall)
  if (!R.pts) {
    if (o.kind === "move" || o.kind === "hold") { emit(w, { t: w.tick, kind: "route-refused", team: u.team, unit: u.id, x: o.x, y: o.y, why: "the gates are shut against us: to the foot of the wall" }); return [R.stop]; }
    return path; // (an assault keeps its old way at the wall: siege.js breaks in)
  }
  const out = R.pts.slice();
  // the long legs to and from the walls: over the land by the nav grid, if its way there meets no wall
  const land = (x0, y0, x1, y1) => {
    if (Math.hypot(x1 - x0, y1 - y0) < 150) return null;
    const p = findPath(w.nav, cls, x0, y0, x1, y1); if (!p) return null;
    let q = [x0, y0]; for (const r of p) { if (!WN.clear(w, u.team, q[0], q[1], r[0], r[1])) return null; q = r; }
    return p;
  };
  const last = out.length >= 2 ? land(out[out.length - 2][0], out[out.length - 2][1], o.x, o.y) : null;
  if (last) out.splice(out.length - 1, 1, ...last);
  const first = land(u.ax, u.ay, out[0][0], out[0][1]);
  if (first) out.splice(0, 1, ...first);
  if (R.gates.length) u.gates = R.gates;
  return out;
}
function bankBefore(map, cls, ax, ay, bx, by) {
  const lim = WADE[cls] ?? WADE.foot, d = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(d / 2)); let last = [ax, ay];
  for (let s = 1; s <= n; s++) { const p = [ax + (bx - ax) * s / n, ay + (by - ay) * s / n]; if (map.water(p[0], p[1]) > lim) break; last = p; }
  return last;
}

// ---------------------------------------------------------------- the plan (pure)
export function planRoute(w, u, dest, opts = {}) {
  const cls = clsOf(u), nav = w.nav, sp = speedOf(u), from = { x: u.ax, y: u.ay };
  const fast = findPath(nav, cls, u.ax, u.ay, dest.x, dest.y);
  const fastOk = !!fast && !routeBlocked(w, cls, from, fast);
  const tFast = fastOk ? travelSecs(w, u, from, fast) : Infinity;
  const straight = Math.hypot(dest.x - u.ax, dest.y - u.ay);
  const obs = firstObstacle(w, cls, u.ax, u.ay, dest.x, dest.y);
  let out = { route: fastOk ? fast : null, crossing: null, covered: false, why: fastOk ? "" : "no way there", secs: tFast };
  if (obs) {
    const what = obs.kind === "moat" ? "the moat" : obs.maxD > 1.8 || obs.len > 14 ? "the river" : "the stream";
    // the fast route is hardly longer than the straight line: it has found its own way over (a ford, a bridge beside the line)
    if (fastOk && pathLen([u.ax, u.ay], fast) <= straight * 1.25 + 30) { out.why = `over ${what} by the ${crossName(w, cls, from, fast)}`; }
    else {
      // the places to cross, best first: the first whose near bank the body can reach and whose far bank leads on to
      // the destination (a narrow place across a bend's shallows or into an island is no crossing)
      const cands = obs.kind === "moat" ? [moatSite(w, obs, u)] : waterSites(w, cls, obs, u);
      let site = null, tDirect = Infinity, legA = null, legB = null, build = Infinity, join = null;
      for (const q of cands.slice(0, 6)) {
        const pa = findPath(nav, cls, u.ax, u.ay, q.ax, q.ay), pb = pa && findPath(nav, cls, q.bx, q.by, dest.x, dest.y);
        if (!pa || !pb || routeBlocked(w, cls, from, pa) || routeBlocked(w, cls, { x: q.bx, y: q.by }, pb)) { site ||= q; continue; }
        site = q; legA = pa; legB = pb;
        tDirect = travelSecs(w, u, from, legA) + site.span / sp + travelSecs(w, u, { x: site.bx, y: site.by }, legB);
        break;
      }
      if (site) {
        join = (w.crossings || []).find((c) => c.state === "building" && c.bld === undefined && c.team === u.team && Math.hypot(c.mx - site.mx, c.my - site.my) < 40) || null; // (a house's timber bridge going up is its villagers' work: js/sim/bridges.js)
        if (site.kind) build = (join ? join.secs * (1 - join.prog) : buildSecs(w, u, site.kind, site.span, site, u.members.length).secs);
      }
      const tBuild = tDirect + build;
      out.times = { round: Math.round(tFast), direct: Math.round(tDirect), build: Math.round(build) }; // (real s: going round, straight over as if bridged, the work)
      if (site) out.site = { kind: site.kind, span: site.span, maxD: site.maxD, a: [site.ax, site.ay], b: [site.bx, site.by], legs: [!!legA, !!legB] };
      const roundOK = fastOk && site?.kind && (tFast <= DETOUR_MAX * tDirect || tFast <= tBuild + build * 0.5);
      if (roundOK) out.why = `round by the ${crossName(w, cls, from, fast)} (${Math.round(pathLen([u.ax, u.ay], fast) - straight)} m further${site?.kind ? ` — quicker than making ${CROSS[site.kind].name} here` : ""})`;
      else if (site?.kind && isFinite(tBuild)) {
        const B = join ? { secs: join.secs * (1 - join.prog), timber: join.timber } : buildSecs(w, u, site.kind, site.span, site, u.members.length);
        const cx = join ? { ...pick(join), join: join.id, secs: B.secs } : { kind: site.kind, x: site.mx, y: site.my, secs: Math.round(B.secs), span: Math.round(site.span * 10) / 10, depth: site.maxD, ax: site.ax, ay: site.ay, bx: site.bx, by: site.by, timber: B.timber, obs: obs.kind, f: obs.f || null };
        out = { route: legA, after: legB, crossing: cx, covered: false, secs: tBuild,
          why: `${fastOk ? `the way round is ${Math.round(pathLen([u.ax, u.ay], fast))} m` : `no ford or bridge over ${what} near`}: we ${join ? "help with" : "make"} ${CROSS[cx.kind].name} over ${what} (${Math.round(cx.span || site.span)} m), about ${fmtSecs(B.secs)}${B.timber === "cut" ? ", cutting the timber here" : ""}` };
      } else if (fastOk) out.why = `${what} is ${site ? `${Math.round(site.span)} m wide${site.maxD > CROSS.trestle.maxDepth ? ` and ${site.maxD.toFixed(1)} m deep` : ""}` : "too wide"} — too much to bridge: round by the ${crossName(w, cls, from, fast)} (${Math.round(pathLen([u.ax, u.ay], fast) - straight)} m further)`;
      else { out.route = null; out.why = `${what} is too wide and deep to bridge here, and there is no ford or bridge to go round by`; }
    }
  }
  if (!out.crossing && out.route && opts.cover !== false) {
    const C = coverRoute(w, u, cls, from, dest, out.route);
    out.sig = C.sig; if (C.rejected) out.coverRejected = C.rejected;
    if (C.route) { out.route = C.route; out.covered = true; out.extra = C.extra; out.why = (out.why ? out.why + "; " : "") + C.why; }
  }
  return out;
}
const pick = (c) => ({ kind: c.kind, x: c.mx, y: c.my, span: c.span, ax: c.ax, ay: c.ay, bx: c.bx, by: c.by, timber: c.timber, obs: c.obs });
export const fmtSecs = (s) => (s < 90 ? `${Math.max(10, Math.round(s / 10) * 10)} seconds` : `${Math.round(s / 30) / 2} minutes`.replace(".5 minutes", "½ minutes").replace(/^1 minutes/, "1 minute"));
// what the route crosses the water by: a ford (it wades), a bridge (dry over deep water), or plain going round
function crossName(w, cls, from, pts) {
  let a = [from.x, from.y], wet = 0;
  for (const b of pts) { const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(d / 4)); for (let s = 1; s <= n; s++) wet = Math.max(wet, w.map.water(a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n)); a = b; }
  const near = (w.crossings || []).some((c) => c.state === "done" && pts.some((p) => Math.hypot(p[0] - c.mx, p[1] - c.my) < 60));
  return wet > 0.2 ? "ford" : near ? "bridge we made" : "bridge";
}

// would walking this route put the men into water they cannot wade or a moat? (the nav grid does not know the moats)
function routeBlocked(w, cls, from, pts) {
  let a = [from.x, from.y];
  for (const b of pts) { if (firstObstacle(w, cls, a[0], a[1], b[0], b[1], true)) return true; a = b; }
  return false;
}
// the first water the class cannot wade, or wet moat, on the straight line a → b: { kind: "water"|"moat", t (m from a),
// ex, ey (entry), mx, my (the middle of the wet run), len (m along the line), maxD, f (the moat feature) }
export function firstObstacle(w, cls, ax, ay, bx, by, quick = false) {
  const map = w.map, lim = WADE[cls] ?? WADE.foot, d = Math.hypot(bx - ax, by - ay); if (d < 1) return null;
  const ux = (bx - ax) / d, uy = (by - ay) / d, n = Math.ceil(d / 2);
  let best = null;
  for (let s = 0; s <= n; s++) {
    const t = d * s / n, x = ax + ux * t, y = ay + uy * t;
    if (map.water(x, y) <= lim) continue;
    if (quick) return { kind: "water", t };
    let t1 = t, maxD = 0; while (t1 < d + 40 && map.water(ax + ux * t1, ay + uy * t1) > DRY) { maxD = Math.max(maxD, map.water(ax + ux * t1, ay + uy * t1)); t1 += 1; }
    let t0 = t; while (t0 > 0 && map.water(ax + ux * (t0 - 1), ay + uy * (t0 - 1)) > DRY) t0 -= 1;
    const tm = (t0 + t1) / 2;
    best = { kind: "water", t, ex: x, ey: y, mx: ax + ux * tm, my: ay + uy * tm, len: t1 - t0, maxD };
    break;
  }
  if (w.features?.length) eachFeatureNear(w, ax, ay, bx, by, 8, (f) => {
    if (f.type !== "moat") return false;
    const hw = (f.width || 10) / 2, fx = f.x1 - f.x0, fy = f.y1 - f.y0, fl = Math.hypot(fx, fy) || 1, nx = -fy / fl, ny = fx / fl;
    // where the line crosses the moat's centre line (and within its length)
    const un = ux * nx + uy * ny; if (Math.abs(un) < 1e-3) return false; // (along the moat, not over it)
    const da = (ax - f.x0) * nx + (ay - f.y0) * ny, db = (bx - f.x0) * nx + (by - f.y0) * ny;
    if (da * db > 0 && Math.abs(da) > hw && Math.abs(db) > hw) return false; // (both ends on one side of it)
    const tc = -da / un;
    const cx = ax + ux * tc, cy = ay + uy * tc, along = ((cx - f.x0) * fx + (cy - f.y0) * fy) / fl;
    if (along < -1 || along > fl + 1) return false;
    const tE = Math.max(0, tc - hw / Math.max(0.2, Math.abs(un)));
    if (!best || tE < best.t) best = { kind: "moat", t: tE, ex: ax + ux * tE, ey: ay + uy * tE, mx: cx, my: cy, len: 2 * hw, maxD: 2.5, f };
    return quick;
  });
  return best;
}

// the narrowest place near where the line meets the water: { ax, ay (near bank), bx, by (far bank), mx, my, span, maxD, kind }
function spanAt(map, x, y, ang) {
  const c = Math.cos(ang), s = Math.sin(ang); let a = 0, b = 0, maxD = map.water(x, y);
  while (a < 45 && map.water(x - c * (a + 1), y - s * (a + 1)) > DRY) { a += 1; maxD = Math.max(maxD, map.water(x - c * a, y - s * a)); }
  while (b < 45 && map.water(x + c * (b + 1), y + s * (b + 1)) > DRY) { b += 1; maxD = Math.max(maxD, map.water(x + c * b, y + s * b)); }
  return { len: a + b + 1, x0: x - c * (a + 1), y0: y - s * (a + 1), x1: x + c * (b + 1), y1: y + s * (b + 1), maxD };
}
function waterSites(w, cls, obs, u) {
  const map = w.map, lim = WADE[cls] ?? WADE.foot;
  let nAng = 0, bl = Infinity;
  for (let k = 0; k < 24; k++) { const a = k * Math.PI / 24, q = spanAt(map, obs.mx, obs.my, a); if (q.len < bl) { bl = q.len; nAng = a; } }
  const tx = -Math.sin(nAng), ty = Math.cos(nAng), all = [];
  for (let s = -60; s <= 60; s += 5) {
    let qx = obs.mx + tx * s, qy = obs.my + ty * s;
    if (map.water(qx, qy) <= lim) { // (the channel bends, or this is its shallow margin: find its deep water again across its line)
      let found = false; for (const o of [3, -3, 6, -6, 10, -10, 15, -15]) { const px = qx + Math.cos(nAng) * o, py = qy + Math.sin(nAng) * o; if (map.water(px, py) > lim) { qx = px; qy = py; found = true; break; } }
      if (!found) continue;
    }
    let best = null, bs = Infinity;
    for (let da = -0.6; da <= 0.61; da += 0.15) {
      const q = spanAt(map, qx, qy, nAng + da); if (q.maxD <= lim) continue; // (it must cross the water they cannot wade)
      const sc = q.len + Math.abs(s) * 0.12 + (q.maxD > CROSS.trestle.maxDepth || q.len > CROSS.trestle.maxSpan ? 50 : 0); // (a place that can be bridged first)
      if (sc < bs) { bs = sc; best = q; }
    }
    if (best) all.push({ q: best, sc: bs });
  }
  all.sort((a, b) => a.sc - b.sc);
  const out = [];
  for (const { q } of all) {
    // the ends: a couple of metres onto the bank; A on the body's own side
    let { x0, y0, x1, y1 } = q; const L = Math.hypot(x1 - x0, y1 - y0) || 1, ex = (x1 - x0) / L, ey = (y1 - y0) / L;
    x0 -= ex * 2; y0 -= ey * 2; x1 += ex * 2; y1 += ey * 2;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    if (out.some((o) => Math.hypot(o.mx - mx, o.my - my) < 8)) continue;
    if ((u.ax - mx) * ex + (u.ay - my) * ey > 0) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0]; }
    const kind = q.len <= CROSS.trestle.maxSpan && q.maxD <= CROSS.trestle.maxDepth ? "trestle" : null;
    out.push({ ax: x0, ay: y0, bx: x1, by: y1, mx, my, span: q.len, maxD: q.maxD, kind });
  }
  return out;
}
function moatSite(w, obs, u) {
  const f = obs.f, hw = (f.width || 10) / 2, fx = f.x1 - f.x0, fy = f.y1 - f.y0, fl = Math.hypot(fx, fy) || 1;
  let along = ((obs.mx - f.x0) * fx + (obs.my - f.y0) * fy) / fl; along = Math.max(Math.min(4, fl / 2), Math.min(fl - Math.min(4, fl / 2), along));
  const px = f.x0 + fx / fl * along, py = f.y0 + fy / fl * along;
  let nx = -fy / fl, ny = fx / fl; if ((u.ax - px) * nx + (u.ay - py) * ny < 0) { nx = -nx; ny = -ny; }
  const off = hw + 2.5, span = 2 * hw;
  const kind = span <= CROSS.fascine.maxSpan ? "fascine" : span <= CROSS.trestle.maxSpan ? "trestle" : null;
  return { ax: px + nx * off, ay: py + ny * off, bx: px - nx * off, by: py - ny * off, mx: px, my: py, span, maxD: 2.5, kind, f };
}

// how long the work takes (real s), and where the timber comes from
export function buildSecs(w, u, kind, span, site, men = REF_MEN) {
  const K = CROSS[kind], need = Math.ceil(K.timberPerM * span);
  const have = w.teams?.[u.team]?.store?.timber ?? 0; // (kg in the team's store: economy.js)
  let mul = Math.min(3, Math.max(0.6, (REF_MEN / Math.max(1, men)) ** 0.7)), timber = "store";
  if (have < need) { timber = "cut"; mul *= woodNear(w, site.mx, site.my) ? CUT_NEAR : CUT_FAR; }
  return { secs: (K.base + K.perM * span) * mul, need, timber, base: K.base + K.perM * span };
}
function woodNear(w, x, y) {
  const L = w.map.land; if (!L) return true;
  for (let r = 30; r <= 300; r += 45) for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6, i = Math.round((x + Math.cos(a) * r - (L.x0 || 0)) / L.cell), j = Math.round((y + Math.sin(a) * r - (L.y0 || 0)) / L.cell); if (i < 0 || j < 0 || i >= L.res || j >= L.res) continue; if (L.vegD[j * L.res + i] > 0.3) return true; }
  return false;
}

// ---------------------------------------------------------------- the work
function startCrossing(w, u, P, o) {
  const X = (w.crossings ||= []);
  let c = P.join !== undefined ? X.find((q) => q.id === P.join) : null;
  if (!c) {
    const T = w.teams?.[u.team], B = buildSecs(w, u, P.kind, P.span, { mx: P.x, my: P.y }, REF_MEN);
    if (B.timber === "store" && T?.store) T.store.timber = Math.max(0, T.store.timber - B.need);
    c = { id: (w.nextCrossing = (w.nextCrossing || 0) + 1), kind: P.kind, team: u.team, ax: P.ax, ay: P.ay, bx: P.bx, by: P.by, mx: P.x, my: P.y, span: P.span, depth: P.depth,
      secs: B.base * (B.timber === "cut" ? (woodNear(w, P.x, P.y) ? CUT_NEAR : CUT_FAR) : 1), timber: B.timber, prog: 0, state: "building", t0: w.time, fireT: -1e9, obs: P.obs, f: P.f || null, burn: 0 };
    if (c.kind === "trestle" && c.obs !== "moat") deckOf(w, c);
    X.push(c);
    emit(w, { t: w.tick, kind: "crossing-started", team: u.team, unit: u.id, crossing: { id: c.id, kind: c.kind, x: c.mx, y: c.my, secs: Math.round(P.secs), span: c.span }, why: u.route?.why });
  } else emit(w, { t: w.tick, kind: "crossing-joined", team: u.team, unit: u.id, crossing: { id: c.id, kind: c.kind, x: c.mx, y: c.my, secs: Math.round(c.secs * (1 - c.prog)) } });
  u.xing = { id: c.id, phase: "go", dest: { x: o.x, y: o.y } };
  u.path = findPath(w.nav, clsOf(u), u.ax, u.ay, c.ax, c.ay) || [[c.ax, c.ay]];
  if (u.path.length) u.path[u.path.length - 1] = [c.ax, c.ay];
  u.finalFacing = Math.atan2(c.by - c.ay, c.bx - c.ax);
}
function leaveCrossing(w, u) { u.xing = null; }

// per tick (world.step): the works go on, the men go over, the burners burn, the routes are looked at again
export function crossingTick(w) {
  if (w.xingEv?.length) { for (const e of w.xingEv) w.events.push(e); w.xingEv.length = 0; }
  const X = w.crossings;
  if (X?.length && w.tick % 5 === 0) bridgesTick(w, X); // (a house's timber bridges: the building's work is the crossing's)
  if (X?.length) {
    // missiles falling about a work slow it (the men duck, drop their loads, carry the hurt away)
    for (const e of w.events) if (e.kind === "arrow" && e.x !== undefined) for (const c of X) if (c.state === "building" && Math.hypot(e.x - c.ax, e.y - c.ay) < 25) c.fireT = w.time;
    for (const c of X) {
      if (c.state !== "building" || c.bld !== undefined) continue;
      let men = 0;
      for (const u of w.units.values()) {
        const x = u.xing; if (!x || x.id !== c.id || !u.members.length) continue;
        if (u.c?.broken || u.state === "routing") { u.xing = null; continue; }
        if (x.phase === "go" && (!u.path || Math.hypot(u.ax - c.ax, u.ay - c.ay) < 10)) { x.phase = "work"; u.path = null; u.finalFacing = Math.atan2(c.by - c.ay, c.bx - c.ax); }
        if (x.phase !== "work") continue;
        if (u.path) { x.phase = "go"; continue; } // (pushed off by something: walk back to the work)
        let n = 0; for (const id of u.members) if (w.S.state[id] !== S_FIGHT) n++;
        men += n;
      }
      if (!men) continue;
      c.tWork ??= w.time;
      const rate = Math.min(1.8, (men / REF_MEN) ** 0.7) * (w.time - c.fireT < 4 ? FIRE_MUL : 1);
      c.prog = Math.min(1, c.prog + rate * TICK / c.secs);
      c.underFire = w.time - c.fireT < 4;
      if (c.prog >= 1) finishCrossing(w, c);
    }
  }
  for (const u of w.units.values()) {
    const x = u.xing;
    if (x && X?.length) {
      const c = X.find((q) => q.id === x.id);
      if (!c || c.state === "burnt") { u.xing = null; continue; }
      if (c.state === "done" && x.phase !== "over") {
        x.phase = "over";
        const rest = findPath(w.nav, clsOf(u), c.bx, c.by, x.dest.x, x.dest.y) || [[x.dest.x, x.dest.y]];
        u.path = [[c.ax, c.ay], [c.bx, c.by], ...rest]; u.finalFacing = u.order?.facing ?? u.finalFacing;
        // over a 5 m deck in column (four files), formed again as they were when they get there (world.moveUnit's deployAs)
        if (u.formation !== "column" && !ARMS[u.arm]?.engine) { u.deployAs ||= { formation: u.formation, depth: u.depth }; u.formation = "column"; u.depth = 0; u.files = formationFiles("column", u.members.length, 0); u.slotCache = null; }
      } else if (x.phase === "over" && (!u.path || Math.hypot(u.ax - c.bx, u.ay - c.by) < 6)) u.xing = null;
    }
    if (u.burnXing !== undefined && X?.length) burnTick(w, u);
    // the route looked at again every ~10 s on the march (new archers in sight, or gone)
    if (u.route && u.path && !u.xing && u.route.o === u.order && (w.tick + u.id * 7) % Math.round(RECHECK_S * 10) === 0) recheck(w, u);
  }
}
function recheck(w, u) {
  const cls = clsOf(u), dest = { x: u.order.x, y: u.order.y };
  const sig = threatSig(w, u, dest);
  if (!sigChanged(sig, u.route.sig)) return;
  const P = planRoute(w, u, dest, { cover: true });
  if (P.crossing || !P.route) { u.route.sig = sig; return; }
  u.route = { ...P, o: u.order, t: w.time, sig: P.sig ?? sig };
  u.path = wallRoute(w, u, u.order, cls, P.route); // (by the gates, if the new way meets a town wall)
  if (P.covered) emit(w, { t: w.tick, kind: "route-covered", team: u.team, unit: u.id, why: P.why, extra: P.extra });
}

// the crossing made: ground like any other, for everyone
function finishCrossing(w, c) {
  c.state = "done"; c.prog = 1; c.tDone = w.time; riversChanged(w);
  if (c.obs === "moat" && c.f) fillMoatAt(w, c);
  else layDeck(w, c);
  w.events.push({ t: w.tick, kind: "crossing-done", team: c.team, crossing: { id: c.id, kind: c.kind, x: c.mx, y: c.my, span: c.span }, secs: Math.round(w.time - (c.tWork ?? c.t0)) });
}
// a bridge: the water gone from under a 5 m strip, the ground there raised to the deck, the nav cells open
function layDeck(w, c) {
  if (c.deck === undefined) deckOf(w, c);
  c.saved = deckMap(w.map, c, CROSS[c.kind]?.halfW || 2.5);
  c.navSaved = openNav(w, c.ax, c.ay, c.bx, c.by);
  if (w.nav) (w.nav.decks ||= []).push({ id: c.id, ax: c.ax, ay: c.ay, bx: c.bx, by: c.by }); // (routes over it go along its deck: path.js)
  c.feature = addFeature(w, { type: "bridge_timber_wide", x0: c.ax, y0: c.ay, x1: c.bx, y1: c.by, width: hw2(c) * 2, src: "crossing", crossing: c.id, team: c.team });
}
const hw2 = (c) => CROSS[c.kind]?.halfW || 2.5;
// the map under a deck (a 5 m strip from bank to bank): the water gone, the ground at the deck → [[k, h, d]] as they were.
// Also the realm's browser, for a house's finished bridge (render/crossings.js), so men on it are drawn on its planks.
export function deckMap(map, c, hw = 2.5) {
  const H = map.height, WD = map.waterDepth, res = map.res, cell = map.cell;
  const L = Math.hypot(c.bx - c.ax, c.by - c.ay) || 1, ux = (c.bx - c.ax) / L, uy = (c.by - c.ay) / L;
  const saved = [];
  if (H && WD) {
    const X0 = map.x0 || 0, Y0 = map.y0 || 0, r = hw + cell * 0.5, i0 = Math.max(0, Math.floor((Math.min(c.ax, c.bx) - r - X0) / cell)), i1 = Math.min(res - 1, Math.ceil((Math.max(c.ax, c.bx) + r - X0) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(c.ay, c.by) - r - Y0) / cell)), j1 = Math.min(res - 1, Math.ceil((Math.max(c.ay, c.by) + r - Y0) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * res + i, x = X0 + i * cell, y = Y0 + j * cell, t = (x - c.ax) * ux + (y - c.ay) * uy, lat = Math.abs(-(x - c.ax) * uy + (y - c.ay) * ux);
      if (t < -1 || t > L + 1 || lat > r) continue;
      if (WD[k] <= 0.02 && H[k] >= c.deck - 0.3) continue;
      saved.push([k, H[k], WD[k]]);
      if (WD[k] > 0.02) { H[k] = c.deck; WD[k] = 0; } else H[k] = Math.max(H[k], c.deck - 0.3);
      map.land?.syncCell?.(k);
    }
  }
  return saved;
}
// A restored world (server/persist.mjs) is built on the map as the land made it: the decks the men laid are not in it. Each
// standing bridge's strip is laid again (else the nav says "open" over 2 m of water, and every route over the bridge put
// its men into the river — the live realm's Harrow bridge after every restart). → how many
export function relayDecks(w) {
  let n = 0;
  for (const c of w.crossings || []) {
    if (c.state !== "done" || (c.obs === "moat" && c.f && c.kind === "fascine")) continue;
    if (c.deck === undefined) deckOf(w, c);
    const was = c.saved; c.saved = deckMap(w.map, c, hw2(c));
    if (was?.length && !c.saved.length) c.saved = was; // (already laid: keep what was under it)
    n++;
  }
  return n;
}
// the deck's height: clear of the water, level with the lower bank if that is not too high; the bed the trestles stand in
function deckOf(w, c) {
  const map = w.map, L = Math.hypot(c.bx - c.ax, c.by - c.ay) || 1, ux = (c.bx - c.ax) / L, uy = (c.by - c.ay) / L;
  const bank = Math.min(map.h(c.ax, c.ay), map.h(c.bx, c.by));
  let surf = -Infinity, bed = Infinity;
  for (let t = 0; t <= L; t += 1) { const x = c.ax + ux * t, y = c.ay + uy * t, d = map.water(x, y); if (d > 0.02) { surf = Math.max(surf, map.h(x, y) + d); bed = Math.min(bed, map.h(x, y)); } }
  if (!isFinite(surf)) { surf = bank - 0.5; bed = bank - 1.5; }
  c.deck = Math.max(surf + 0.6, Math.min(bank, surf + 1.5)); c.bed = bed; c.surf = surf;
}
// the nav grid's cells along the crossing (its 25 m cells see the water either side of a 5 m deck): open them
function openNav(w, ax, ay, bx, by) {
  const nav = w.nav, saved = []; if (!nav) return saved;
  const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / (nav.cellM / 3)));
  const seen = new Set();
  for (let s = 0; s <= n; s++) {
    const x = ax + (bx - ax) * s / n, y = ay + (by - ay) * s / n, k = Math.round((y - nav.oy) / nav.cellM) * nav.n + Math.round((x - nav.ox) / nav.cellM);
    if (seen.has(k) || k < 0 || k >= nav.n * nav.n) continue; seen.add(k);
    const sv = { k, c: {}, b: {} };
    for (const cls of ["foot", "cavalry"]) { sv.c[cls] = nav.classes[cls][k]; if (nav.base?.[cls]) sv.b[cls] = nav.base[cls][k]; nav.classes[cls][k] = Math.min(Number.isFinite(nav.classes[cls][k]) ? nav.classes[cls][k] : 9, 2.5); if (nav.base?.[cls]) nav.base[cls][k] = nav.classes[cls][k]; }
    saved.push(sv);
  }
  return saved;
}
// a fill across a castle's wet moat (siege-war.js fillMoat's mechanics, a company's width): the moat feature split round
// it, the fill in the castle's description (render/castle.js draws its fascines) and dug into the land (earthworks.js)
function fillMoatAt(w, c) {
  const f = c.f, h = CROSS.fascine.halfW;
  if (!w.features?.includes(f)) { // (split already by another fill: the piece under this site now)
    let best = null, bd = Infinity; for (const g of w.features || []) { if (g.type !== "moat") continue; const d = pointSeg(c.mx, c.my, g.x0, g.y0, g.x1, g.y1); if (d < bd) { bd = d; best = g; } }
    if (!best || bd > (best.width || 10) / 2 + 1) { layDeck(w, c); return; }
    c.f = best;
  }
  const F = c.f, dx = F.x1 - F.x0, dy = F.y1 - F.y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, t = (c.mx - F.x0) * ux + (c.my - F.y0) * uy;
  removeFeature(w, F);
  if (t - h > 1) addFeature(w, { ...F, x1: F.x0 + ux * (t - h), y1: F.y0 + uy * (t - h), flatB: true });
  if (L - (t + h) > 1) addFeature(w, { ...F, x0: F.x0 + ux * (t + h), y0: F.y0 + uy * (t + h), flatA: true });
  for (const C of w.castles || []) {
    if (F.castle !== undefined && C.id !== F.castle) continue;
    let any = false; for (const q of C.parts || []) if (q.kind === "moat") { (q.fills ||= []).push({ x: c.mx, y: c.my, r: h }); any = true; }
    if (any && C._) try { carveCastle(w.map, C); } catch { /* (a fallback description has no earthworks) */ }
  }
  c.feature = addFeature(w, { type: "causeway", x0: c.ax, y0: c.ay, x1: c.bx, y1: c.by, width: h * 2, src: "crossing", crossing: c.id, team: c.team });
}

// ---------------------------------------------------------------- burning a bridge (the enemy's, or our own behind us)
export function crossingNear(w, x, y, r = 40, burnable = false) {
  let best = null, bd = r;
  for (const c of w.crossings || []) { if (c.state === "burnt" || (burnable && (c.kind !== "trestle" || c.state !== "done"))) continue; const d = pointSeg(x, y, c.ax, c.ay, c.bx, c.by); if (d < bd) { bd = d; best = c; } }
  return best;
}
export const BURN_S = 25; // real s for a party with torches to get a timber bridge well alight
function burnTick(w, u) {
  const c = w.crossings.find((q) => q.id === u.burnXing);
  if (!c || c.state !== "done" || !u.members.length) { u.burnXing = undefined; return; }
  const dA = Math.hypot(u.ax - c.ax, u.ay - c.ay), dB = Math.hypot(u.ax - c.bx, u.ay - c.by);
  if (Math.min(dA, dB) > 14) return;
  c.burn += TICK / BURN_S * Math.max(0.15, WEATHER[w.weather]?.fireSpreadMul ?? 1); // (a rain-wet bridge takes much longer to get alight: docs/weather.md)
  if (c.burn >= 1) { burnCrossing(w, c, u.team); u.burnXing = undefined; }
}
export function burnCrossing(w, c, by = -1) {
  if (!c || c.state === "burnt" || c.kind !== "trestle") return false;
  const map = w.map;
  if (c.saved && map.height && map.waterDepth) for (const [k, h, d] of c.saved) { map.height[k] = h; map.waterDepth[k] = d; map.land?.syncCell?.(k); }
  const nav = w.nav; if (nav && c.navSaved) for (const sv of c.navSaved) for (const cls in sv.c) { nav.classes[cls][sv.k] = sv.c[cls]; if (nav.base?.[cls] && sv.b[cls] !== undefined) nav.base[cls][sv.k] = sv.b[cls]; }
  if (c.feature) removeFeature(w, c.feature);
  if (nav?.decks) nav.decks = nav.decks.filter((D) => D.id !== c.id);
  c.state = "burnt"; c.tBurnt = w.time; riversChanged(w);
  w.events.push({ t: w.tick, kind: "crossing-burnt", team: c.team, by, crossing: { id: c.id, kind: c.kind, x: c.mx, y: c.my } });
  // a house's timber bridge burnt (the Attack → burn order at it): the building is a ruin too
  const b = c.bld !== undefined ? w.buildings?.find((q) => q.id === c.bld) : null;
  if (b && !b.ruin) { b.hp = 0; b.ruin = true; b.fire = 0; b.stage = "ruin"; w.events.push({ t: w.tick, kind: "building-lost", building: b.id, team: b.team, what: b.kind }); }
  return true;
}

// ---------------------------------------------------------------- a house's timber bridge (js/sim/bridges.js: a building)
// The building is the work (its crew, its timber, its stages, its fire); the crossing is the bridge over the water — drawn
// going up as the building rises (render/crossings.js), laid as ground for everyone when the building stands, and gone
// when the building is burnt or pulled down. b.br carries what the realm's browser needs to draw it (it sees buildings, not
// w.crossings).
export function bridgeCrossing(w, b) {
  const X = (w.crossings ||= []);
  const c = { id: (w.nextCrossing = (w.nextCrossing || 0) + 1), kind: "trestle", team: b.team, ax: b.x1, ay: b.y1, bx: b.x2, by: b.y2, mx: (b.x1 + b.x2) / 2, my: (b.y1 + b.y2) / 2,
    span: Math.round(Math.hypot(b.x2 - b.x1, b.y2 - b.y1) * 10) / 10, prog: b.progress || 0, state: "building", t0: w.time, fireT: -1e9, obs: "water", f: null, burn: 0, secs: 1, timber: "store", bld: b.id };
  deckOf(w, c);
  c.depth = Math.round((c.surf - c.bed) * 10) / 10;
  X.push(c);
  b.br = { cid: c.id, ax: c.ax, ay: c.ay, bx: c.bx, by: c.by, deck: c.deck, bed: c.bed };
  if (b.progress >= 1 && !b.ruin) finishCrossing(w, c);
  return c;
}
function bridgesTick(w, X) {
  for (const c of X) {
    if (c.bld === undefined || c.state === "burnt") continue;
    const b = w.buildings?.find((q) => q.id === c.bld);
    if (!b || b.ruin) { if (c.state === "done") burnCrossing(w, c, -1); else { c.state = "burnt"; c.tBurnt = w.time; } continue; }
    if (c.state === "building") { c.prog = Math.min(1, b.progress || 0); if (b.progress >= 1) finishCrossing(w, c); }
  }
}

// ---------------------------------------------------------------- cover from missiles (light)
// enemy missile troops this body knows of (in its sight, terrain and woods between) and who could reach the route
function threats(w, u, dest) {
  const out = [], map = w.map, can = map.canopyGrid ? map.canopy : null;
  for (const v of w.units.values()) {
    if (v.team === u.team || !v.members.length || v.state === "routing" || v.c?.broken) continue;
    const m = ARMS[v.arm]?.missile; if (!m) continue;
    const R = RANGE[m] || 150, vx = v.ax, vy = v.ay;
    const near = Math.min(Math.hypot(vx - u.ax, vy - u.ay), pointSeg(vx, vy, u.ax, u.ay, dest.x, dest.y));
    if (near > R + 60) continue;
    // known: in sight now (terrain and woods between), or seen in the last minute and a half where he was then (a
    // body that has gone behind a wood to be out of his sight still knows he is there)
    const mem = ((w.seenBows ||= {})[u.team] ||= new Map()), d = Math.hypot(vx - u.ax, vy - u.ay);
    if (d <= 900 && map.los(u.ax, u.ay, 1.7, vx, vy, 1.7, can)) mem.set(v.id, { x: vx, y: vy, t: w.time });
    const k = mem.get(v.id); if (!k || w.time - k.t > 90) continue;
    out.push({ x: k.x, y: k.y, R, id: v.id });
  }
  return out;
}
// what the body knows of the bowmen, to compare at the next look: [{ id, x, y }]; "changed" = one more or fewer, or one moved > 40 m
const threatSig = (w, u, dest) => threats(w, u, dest).map((t) => ({ id: t.id, x: t.x, y: t.y }));
const sigChanged = (a = [], b = []) => a.length !== b.length || a.some((t) => { const q = b.find((v) => v.id === t.id); return !q || Math.hypot(q.x - t.x, q.y - t.y) > 40; });
// the exposed metres of a route: within bowshot of a known enemy and in his sight
function exposure(w, T, from, pts) {
  const map = w.map, can = map.canopyGrid ? map.canopy : null; let a = [from.x, from.y], ex = 0;
  for (const b of pts) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(d / 10));
    for (let s = 0; s < n; s++) { const x = a[0] + (b[0] - a[0]) * (s + 0.5) / n, y = a[1] + (b[1] - a[1]) * (s + 0.5) / n; if (T.some((t) => Math.hypot(x - t.x, y - t.y) <= t.R && map.los(t.x, t.y, 1.7, x, y, 1.7, can))) ex += d / n; }
    a = b;
  }
  return ex;
}
function coverRoute(w, u, cls, from, dest, fast) {
  const T = threats(w, u, dest), sig = T.map((t) => ({ id: t.id, x: t.x, y: t.y }));
  if (!T.length) return { route: null, sig };
  const ex0 = exposure(w, T, from, fast); if (ex0 < 30) return { route: null, sig };
  const nav = w.nav, base = nav.classes[cls], cost = Float32Array.from(base), n = nav.n, cm = nav.cellM, map = w.map, can = map.canopyGrid ? map.canopy : null;
  for (const t of T) {
    const r = t.R + cm, i0 = Math.max(0, Math.floor((t.x - r - nav.ox) / cm)), i1 = Math.min(n - 1, Math.ceil((t.x + r - nav.ox) / cm)), j0 = Math.max(0, Math.floor((t.y - r - nav.oy) / cm)), j1 = Math.min(n - 1, Math.ceil((t.y + r - nav.oy) / cm));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * n + i; if (!isFinite(cost[k]) || cost[k] !== base[k]) continue; // (once per cell)
      const x = nav.ox + i * cm, y = nav.oy + j * cm, d = Math.hypot(x - t.x, y - t.y); if (d > t.R + cm * 0.5) continue;
      const hidden = !map.los(t.x, t.y, 1.7, x, y, 1.7, can) || (map.land && map.land.vegD[map.land.idx(x, y)] > 0.35);
      cost[k] = base[k] * (hidden ? 0.9 : 1.8);
    }
  }
  const alt = findPath({ ...nav, classes: { ...nav.classes, [cls]: cost } }, cls, u.ax, u.ay, dest.x, dest.y, { byCost: true });
  if (!alt || routeBlocked(w, cls, from, alt)) return { route: null, sig, rejected: { none: true, ex0 } };
  const c0 = travelSecs(w, u, from, fast), c1 = travelSecs(w, u, from, alt), ex1 = exposure(w, T, from, alt);
  if (c1 > c0 * COVER_MAX || ex1 > ex0 * 0.75) return { route: null, sig, rejected: { extra: c1 / c0 - 1, ex0, ex1, alt } };
  return { route: alt, sig, extra: c1 / c0 - 1, why: `keeping out of the enemy bowmen's sight (${Math.round(ex0 - ex1)} m less in the open, ${Math.round((c1 / c0 - 1) * 100)} % longer)` };
}
