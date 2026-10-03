// TIMBER BRIDGES — a house's own bridge over a river (docs/crossings.md "A house's timber bridge"). The owner (2026-10-03):
// "Some units just get stuck in rivers when they should build a bridge."
//
// A bridge is a BUILDING (econ-data BUILDINGS.bridge: timber by the metre, man-days by the metre, stages, it burns): staked
// from bank to bank, its timber carried to the near bank, its crew working from there (economy.js spotFor, haulage.js), and
// a crossing (crossings.js bridgeCrossing) that rises with it — trestles, stringers, the deck plank by plank — and is laid as
// ground for EVERY house when the building stands (the water gone under the deck, the nav open, routes along the deck), and
// is gone again when it burns or is pulled down.
//
// Sited by reading the river (readRiver): along the reach near the line of travel, each place's span bank to bank at its
// narrowest angle, its depth, its banks (firm footing, not bog, not a bluff) — the narrowest sound reach near the line wins.
// Two ways one comes to be:
//   · the player: Build → Timber Bridge → "Bridge here" (js/ui/bridge-ui.js): the valid reaches near the pointer light up;
//     the click is sited at the best reach within 60 m (orderBridge).
//   · the reeve (reeveBridges): his men's walks that wanted a crossing — no ford or bridge to go over by, or one so far round
//     the walk is more than DETOUR × longer (rivers.js need) — are a bridge where they meet the water, when the house has
//     the timber and no bridge of its own already going up.
import { BUILDINGS } from "./econ-data.js";
import * as EC from "./economy.js";
import * as RV from "./rivers.js";
import { bridgeCrossing } from "./crossings.js";
import { landAt } from "./land.js";
import { findPath } from "./path.js";

export const BRIDGE = BUILDINGS.bridge;
const DRY = 0.5, MIN_SPAN = 3, ENDS = 2.5; // m: shallower than DRY is bank; each end set this far onto the bank
const FIRM = 0.5, STEEP = 0.45;            // the banks: footing (landread foundation) at least this; slope at most this

// the river read across at (x, y) along angle ang: bank to bank → { len, x0, y0, x1, y1, maxD }
function across(map, x, y, ang, lim = 70) {
  const c = Math.cos(ang), s = Math.sin(ang); let a = 0, b = 0, maxD = map.water(x, y);
  while (a < lim && map.water(x - c * (a + 1), y - s * (a + 1)) > DRY) { a += 1; maxD = Math.max(maxD, map.water(x - c * a, y - s * a)); }
  while (b < lim && map.water(x + c * (b + 1), y + s * (b + 1)) > DRY) { b += 1; maxD = Math.max(maxD, map.water(x + c * b, y + s * b)); }
  return { len: a + b + 1, x0: x - c * (a + 1), y0: y - s * (a + 1), x1: x + c * (b + 1), y1: y + s * (b + 1), maxD, open: a >= lim || b >= lim };
}
// the deep water nearest (x, y) within r, or null
function deepNear(map, x, y, r = 40) {
  if (map.water(x, y) > RV.LIM) return [x, y];
  for (let d = 2; d <= r; d += 2) for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, px = x + Math.cos(a) * d, py = y + Math.sin(a) * d; if (map.water(px, py) > RV.LIM) return [px, py]; }
  return null;
}
const narrowest = (map, x, y) => { let best = 0, bl = Infinity; for (let k = 0; k < 24; k++) { const a = k * Math.PI / 24, q = across(map, x, y, a); if (q.len < bl) { bl = q.len; best = a; } } return best; };
// a bank end: firm and not steep, dry → null, or why not
function bankWhy(w, x, y) {
  const map = w.map; if (map.inBounds && !map.inBounds(x, y)) return "off the map";
  if (map.water(x, y) > DRY) return "the bank is under water";
  const A = landAt(map, x, y);
  if (A.slope > STEEP) return "the bank is a bluff";
  if (A.found < FIRM || (A.phys?.bog ?? 0) > 0.6) return "the bank is soft, boggy ground";
  return null;
}

// Every place to bridge along the reach within R of (x, y), best first: [{ ax, ay, bx, by (A on the `from` side), mx, my,
// span, maxD, ok, why, sc }]. `from`: the side the builders come from (the hall's, the walkers').
export function readRiver(w, x, y, { R = 60, from = null, step = 4 } = {}) {
  const map = w.map, P = deepNear(map, x, y); if (!P) return [];
  const nAng = narrowest(map, P[0], P[1]), tx = -Math.sin(nAng), ty = Math.cos(nAng), out = [];
  for (let s = -R; s <= R; s += step) {
    let qx = P[0] + tx * s, qy = P[1] + ty * s;
    if (map.water(qx, qy) <= RV.LIM) { // (the channel bends: find its deep water again across its line)
      let found = false; for (const o of [3, -3, 6, -6, 10, -10, 15, -15, 22, -22]) { const px = qx + Math.cos(nAng) * o, py = qy + Math.sin(nAng) * o; if (map.water(px, py) > RV.LIM) { qx = px; qy = py; found = true; break; } }
      if (!found) continue;
    }
    let q = null; for (let da = -0.6; da <= 0.61; da += 0.15) { const c = across(map, qx, qy, nAng + da); if (!q || c.len < q.len) q = c; }
    if (!q || q.open) continue;
    const L = Math.hypot(q.x1 - q.x0, q.y1 - q.y0) || 1, ex = (q.x1 - q.x0) / L, ey = (q.y1 - q.y0) / L;
    let ax = q.x0 - ex * ENDS, ay = q.y0 - ey * ENDS, bx = q.x1 + ex * ENDS, by = q.y1 + ey * ENDS;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    if (out.some((o) => Math.hypot(o.mx - mx, o.my - my) < step * 1.5)) continue;
    if (from && (from.x - mx) * ex + (from.y - my) * ey > 0) { [ax, bx] = [bx, ax]; [ay, by] = [by, ay]; }
    const span = Math.hypot(bx - ax, by - ay);
    let why = null;
    if (q.maxD <= RV.LIM) why = "the water is shallow enough to wade here";
    else if (span > BRIDGE.maxSpan) why = `the river is ${Math.round(span)} m wide here (a timber bridge spans ${BRIDGE.maxSpan} m at most)`;
    else if (q.maxD > BRIDGE.maxDepth) why = `the river is ${q.maxD.toFixed(1)} m deep here (trestles stand in ${BRIDGE.maxDepth} m at most)`;
    else if (span < MIN_SPAN) why = "no river here";
    const wa = why ? null : bankWhy(w, ax - ex * 3, ay - ey * 3) || bankWhy(w, ax, ay), wb = why || wa ? null : bankWhy(w, bx + ex * 3, by + ey * 3) || bankWhy(w, bx, by);
    why ||= wa ? `near ${wa}` : wb ? `far ${wb}` : null;
    const A = landAt(map, ax, ay), B = landAt(map, bx, by);
    const sc = span * 2 + Math.abs(s) * 0.2 + q.maxD * 1.5 + (A.slope + B.slope) * 30 + (2 - Math.min(1, A.found) - Math.min(1, B.found)) * 12;
    out.push({ ax, ay, bx, by, mx, my, span, maxD: q.maxD, ok: !why, why, sc });
  }
  return out.sort((a, b) => (a.ok === b.ok ? a.sc - b.sc : a.ok ? -1 : 1));
}

// the best place to bridge near (x, y): a site whose near end the house's men can walk to and whose far end leads on (no
// island in a braid, no bank cut off by another channel) → the site, or { error }
export function siteBridge(w, team, x, y, { R = 60, from = null, to = null } = {}) {
  const T = w.teams[team], hall = from || hallOf(w, team) || T?.town || { x, y };
  const all = readRiver(w, x, y, { R, from: hall });
  if (!all.length) return { error: "no river there to bridge" };
  const ok = all.filter((q) => q.ok);
  if (!ok.length) return { error: `no place to bridge near there: ${all[0].why}` };
  if (taken(w, ok[0])) return { error: "a bridge stands there already" };
  const nav = w.nav, navB = nav?.base?.foot ? { ...nav, classes: { ...nav.classes, foot: nav.base.foot } } : nav;
  for (const q of ok.slice(0, 4)) {
    if (taken(w, q)) continue;
    if (!navB) return q;
    // (each end must lead on: the near one back to the house's side, the far one out to the land beyond — a quick look)
    const pa = findPath(navB, "foot", q.ax, q.ay, hall.x, hall.y), dest = to || { x: q.bx + (q.bx - q.ax) * 8, y: q.by + (q.by - q.ay) * 8 };
    const pb = findPath(navB, "foot", q.bx, q.by, dest.x, dest.y);
    if (pa && pb) return q;
  }
  return { error: "the far bank there leads nowhere (an island, or another channel beyond)" };
}
const hallOf = (w, team) => { const T = w.teams[team]; return T?.hall !== undefined ? w.buildings.find((b) => b.id === T.hall && !b.ruin) : null; };
// a bridge (any house's, standing or going up) or a ford within 40 m of the site
function taken(w, q) {
  for (const b of w.buildings) if (b.kind === "bridge" && !b.ruin && Math.hypot((b.x1 + b.x2) / 2 - q.mx, (b.y1 + b.y2) / 2 - q.my) < 40) return true;
  for (const c of w.crossings || []) if (c.state !== "burnt" && Math.hypot(c.mx - q.mx, c.my - q.my) < 30) return true;
  return false;
}

// stake the bridge out on a site: the building (its timber taken from the store and set aside for the site — haulage.js)
// and the crossing that rises with it → { b } | { error }
export function placeBridge(w, team, site, complete = false) {
  const span = Math.hypot(site.bx - site.ax, site.by - site.ay);
  if (!complete && !EC.canAfford(w.teams[team], EC.costOf("bridge", span))) return { error: `not enough timber: a ${Math.round(span)} m bridge takes ${Math.round(BRIDGE.mat.timber * span / 1000 * 10) / 10} t` };
  const b = EC.placeBuilding(w, team, "bridge", site.ax, site.ay, Math.atan2(site.by - site.ay, site.bx - site.ax), complete, { length: span, x1: site.ax, y1: site.ay, x2: site.bx, y2: site.by });
  if (!b) return { error: "it cannot be built" };
  b.span = Math.round(span * 10) / 10; b.depth = Math.round(site.maxD * 10) / 10;
  bridgeCrossing(w, b);
  return { b };
}
// the player's "Bridge here": sited at the best reach near the click, staked, and a crew sent → { ok, b, msg } | { ok: false, error }
export function orderBridge(w, team, x, y, crew = 20) {
  const site = siteBridge(w, team, x, y, { R: 60 });
  if (site.error) return { ok: false, error: site.error };
  const r = placeBridge(w, team, site);
  if (r.error) return { ok: false, error: r.error };
  const got = EC.assignWorkers(w, team, { kind: "build", b: r.b }, crew, ["carpenter"]);
  const n = got?.members?.length ?? 0;
  return { ok: true, b: r.b, msg: `${BRIDGE.name} staked out: ${Math.round(site.span)} m over water ${site.maxD.toFixed(1)} m deep, the narrowest firm reach — ${n} men sent` };
}

// ---------------------------------------------------------------- the reeve
const REEVE_EVERY = 30, NEED_WALKS = 6, NEED_AGE = 20; // real s between looks; walks that wanted the crossing; real s it has been wanted
export function reeveBridges(w, G) {
  const team = G.team, T = w.teams[team]; if (!T?.store || T.fallen) return null;
  const L = (w.bridgeLook ||= {}); if (w.time - (L[team] ?? -1e9) < REEVE_EVERY) return null; L[team] = w.time;
  const N = w.riverNeed; if (!N?.length) return null;
  if (w.buildings.some((b) => b.team === team && b.kind === "bridge" && !b.ruin && b.progress < 1)) return null; // (one at a time)
  const cands = N.filter((e) => e.team === team && e.n >= NEED_WALKS && w.time - e.t0 >= NEED_AGE && !(e.badT > w.time)).sort((a, b) => b.n - a.n);
  for (const e of cands) {
    const hall = hallOf(w, team);
    const site = siteBridge(w, team, e.x, e.y, { R: 150, from: { x: e.ax, y: e.ay }, to: { x: e.bx, y: e.by } });
    if (site.error) { e.badT = w.time + 600; continue; } // (no place to bridge there: looked at again in 10 minutes)
    // worth it: the walk by the bridge saves a good part of the way round (or there is no way round)
    const by = Math.hypot(site.ax - e.ax, site.ay - e.ay) + site.span + Math.hypot(e.bx - site.bx, e.by - site.by);
    if (e.round > 0 && by > e.round * 0.75) { e.badT = w.time + 600; continue; }
    const r = placeBridge(w, team, site);
    if (r.error) { e.badT = w.time + 120; w.log?.push({ t: w.tick, kind: "reeve-say", team, text: `Your reeve would bridge the river (${Math.round(site.span)} m) where your men cross it — ${r.error}`, tone: "warn", x: site.mx, y: site.my }); return null; }
    EC.assignWorkers(w, team, { kind: "build", b: r.b }, 16, ["carpenter"]);
    N.splice(N.indexOf(e), 1);
    const why = e.round > 0 ? `the men were going ${Math.round(e.round)} m round by the nearest crossing` : "the men had no ford or bridge to go over by";
    w.log?.push({ t: w.tick, kind: "reeve-say", team, text: `Your reeve stakes out a ${Math.round(site.span)} m timber bridge over the river: ${why}`, tone: "good", x: site.mx, y: site.my });
    w.events.push({ t: w.tick, kind: "bridge-staked", team, building: r.b.id, x: site.mx, y: site.my, span: site.span, by: "reeve" });
    void hall;
    return r.b;
  }
  return null;
}

// ---------------------------------------------------------------- the land read for the player (js/ui/bridge-ui.js)
// the reaches within r of (cx, cy) where a bridge could go, and where not: [{ ax, ay, bx, by, span, ok, why, v (0..1: how good) }]
export function bridgeSites(w, team, cx, cy, r = 300) {
  const map = w.map, out = [], seen = [], hall = hallOf(w, team) || w.teams[team]?.town || { x: cx, y: cy };
  for (let y = cy - r; y <= cy + r; y += 24) for (let x = cx - r; x <= cx + r; x += 24) {
    if (map.inBounds && !map.inBounds(x, y)) continue;
    if (map.water(x, y) <= RV.LIM) continue;
    if (seen.some((s) => Math.hypot(s[0] - x, s[1] - y) < 30)) continue;
    const q = readRiver(w, x, y, { R: 0, from: hall })[0]; if (!q) continue;
    seen.push([q.mx, q.my]);
    out.push({ ax: q.ax, ay: q.ay, bx: q.bx, by: q.by, span: q.span, maxD: q.maxD, ok: q.ok && !taken(w, q), why: q.ok && taken(w, q) ? "a bridge stands there already" : q.why, v: q.ok ? Math.max(0, Math.min(1, 1 - (q.span - 6) / (BRIDGE.maxSpan - 6))) : 0 });
  }
  return out;
}
