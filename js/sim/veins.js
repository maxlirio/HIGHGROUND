// VEINS — silver and gold, held and taken (the owner: "each player should have 1 vein, not only four for 8 people. and
// you claim them. You can't mine from someone else's mine. You can take it by killing the people who work there and then
// hoisting your flag.")
//
//   ONE TO A HOUSE   every hold of the realm has its own silver vein 500–1000 m from its keep, sited from the land: the
//                    foot of a crag (a steep rise behind it), on flat, dry working ground, clear of buildings, fields,
//                    plots and roads (holdVeins: the world's build, server/world.mjs; the live save: server/migrate.mjs).
//                    The house at that hold holds it from the start (v.holder; v.home = the hold's team). The map's own
//                    veins stay as the contested prizes.
//   CLAIMS           v.holder: the team that holds it, or null. Only the holder's men mine it (mineWhy: the broad task,
//                    "Mine here", the reeve, and the work itself — economy.js gather — all refuse anyone else, saying why).
//                    A mining camp goes up only at a vein you hold or that nobody holds; building one there claims it
//                    (townplan.js placeOnPlan).
//   CAPTURE          a vein changes hands when an attacker's soldiers stand at it (within VEIN.r) and none of the holder's
//                    men are left alive there: the flag goes up over VEIN.hoistS seconds of game time (v.cap = { by, t0 }),
//                    broken off if the holder's men come back, the attackers leave, or another house's soldiers outnumber
//                    them there. Then the attacker holds it; the holder's mining camp there becomes the attacker's, with
//                    the stock inside (the prize is the working mine — burning it would only make the winner rebuild it,
//                    and leave the vein idle for both). Chronicle lines go to both houses (w.log "vein-hoist",
//                    "vein-taken", "vein-hoist-broken", "vein-guarded"); the realm server rings the loser's devices.
//   FINDS            a vein found by prospecting (js/sim/prospect.js: v.source "prospect", v.finder) is held by nobody until
//                    a flag goes up: its finder's own men standing there — villagers too, and under protection too — hoist
//                    it, as soldiers do; another house's soldiers can hoist theirs first, as at any unheld vein.
//   PROTECTION       a shielded house (the realm's newcomer protection; an unclaimed hold) and a house under the Keep's
//                    Peace keep their veins: nobody can hoist a flag over them. Only foes take veins (sides.js isFoe:
//                    at war, neither shielded).
// Deterministic: no dice, iteration in w.resources / w.units order, time from w.time. Plain data on the nodes (saved).
// DOM-free: the client reads isVein / mineWhy / holderName for its tooltips.
import { isFoe, shielded } from "./sides.js";
import { ARMS } from "./arms.js";
import { rekeyItem } from "./labor.js";

export const VEIN = {
  r: 40,          // m: the ground a flag is hoisted over
  hoistS: 10,     // s of game time to hoist it
  every: 5,       // ticks between looks
  campR: 260,     // m: a mining camp this near works the vein (ai-general.js veinHolder's reach)
  holdMin: 500, holdMax: 1000, // m from the keep: a hold's own vein
  holdAmount: 60000, // d of silver in a hold's own vein (the map's veins hold 60–90 thousand since the ×15)
  warnS: 120,     // s between "it cannot be taken" lines to the same house at the same vein
};
const S_DOWN = 4, S_FLEE = 3;
export const isVein = (n) => !!n && (n.kind === "silver_vein" || n.kind === "gold_vein");
export const holderOf = (v) => (v && Number.isInteger(v.holder) && v.holder >= 0 ? v.holder : null);
export const veinWord = (v) => (v?.kind === "gold_vein" ? "gold vein" : "silver vein");
export const holderName = (w, v) => { const h = holderOf(v); if (h === null) return null; const n = v.holderName || w.teams?.[h]?.name; return n ? `House ${String(n).replace(/^House\s+/i, "")}` : "another house"; };
// a house whose veins cannot be taken now: newcomer protection (or an unclaimed hold), the Keep's Peace
export const guarded = (w, t) => t !== null && t >= 0 && (shielded(w, t) || !!w.teams?.[t]?.keepsPeace);

// why `team` may not mine vein v → null (it may) | the reason, in words
export function mineWhy(w, team, v) {
  if (!isVein(v)) return null;
  const h = holderOf(v);
  if (h === null || h === team) return null;
  return `the ${veinWord(v)} is held by ${holderName(w, v)}: only their men mine it. Take it — kill the men who work it, then stand your soldiers at it (${VEIN.r} m) until your flag is up (${VEIN.hoistS} s)`;
}
export const mayMine = (w, team, v) => !mineWhy(w, team, v);
// why `team` may not put a mining camp by vein v → null | the reason
export function campWhy(w, team, v) {
  if (!isVein(v)) return null;
  const h = holderOf(v);
  return h === null || h === team ? null : `the ${veinWord(v)} is held by ${holderName(w, v)}: you cannot stake a camp at another house's vein — take it first`;
}
// a camp staked at vein v by `team`: an unheld vein becomes theirs
export function claimByCamp(w, team, v) {
  if (!isVein(v) || holderOf(v) !== null) return false;
  v.holder = team; v.cap = null;
  w.log?.push({ t: w.tick, kind: "vein-claimed", team, vein: v.id, vk: v.kind, x: v.x, y: v.y });
  return true;
}
// what a viewer knows of a vein, for tooltips: "yours", "House X's", "nobody's", and a hoisting in progress
export function veinStatus(w, team, v) {
  const h = holderOf(v), cap = v.cap;
  const who = h === null ? "held by no house: stake a mining camp there to claim it" : h === team ? "your house's vein" : `held by ${holderName(w, v)}`;
  const hoist = cap ? ` · ${cap.by === team ? "your" : "a"} flag going up (${Math.max(0, Math.ceil(VEIN.hoistS - ((w.time || 0) - cap.t0)))} s)` : "";
  return who + hoist;
}

// ---------------------------------------------------------------- capture (economy.js economySystem, every VEIN.every ticks)
export function veinSystem(w) {
  if (w.tick % VEIN.every || !w.resources) return;
  const S = w.S, r2 = VEIN.r * VEIN.r;
  let veins = null;
  for (const v of w.resources) if (isVein(v)) (veins ||= []).push(v);
  if (!veins) return;
  // the bodies near each vein: units whose anchor is within reach, then their men one by one
  for (const v of veins) {
    const h = holderOf(v), finder = h === null && Number.isInteger(v.finder) ? v.finder : null;
    const men = new Map(); // team → { soldiers, any }
    for (const u of w.units.values()) {
      if (!u.members.length || Math.abs(u.ax - v.x) > VEIN.r + 250 || Math.abs(u.ay - v.y) > VEIN.r + 250) continue;
      const soldier = (!u.isWorkers && !ARMS[u.arm]?.engine && u.state !== "routing") || (u.isWorkers && finder === u.team); // (a find: its finder's own men — the prospectors — hoist its flag: js/sim/prospect.js)
      for (const id of u.members) {
        if (!S.alive[id] || S.state[id] === S_DOWN) continue;
        const dx = S.x[id] - v.x, dy = S.y[id] - v.y; if (dx * dx + dy * dy > r2) continue;
        let c = men.get(u.team); if (!c) men.set(u.team, (c = { soldiers: 0, any: 0 }));
        c.any++; if (soldier && S.state[id] !== S_FLEE) c.soldiers++;
      }
    }
    // who would hoist: the house with the most soldiers there that may take it from the holder
    let by = null, best = 0, barred = null;
    const prot = h !== null && guarded(w, h);
    for (const [t, c] of men) {
      if (t === h || !c.soldiers || !w.teams[t]?.town || w.teams[t].fallen || (t !== finder && (w.teams[t].keepsPeace || shielded(w, t)))) continue; // (claiming its own find is no aggression: a protected house may)
      if (prot) { if (barred === null) barred = t; continue; } // (a protected house's vein: nobody hoists there)
      if (h !== null && !isFoe(w, t, h)) continue;
      if (c.soldiers > best || (c.soldiers === best && by !== null && t < by)) { best = c.soldiers; by = t; }
    }
    const held = h !== null && (men.get(h)?.any || 0) > 0;
    if (barred !== null) { // (the would-be taker is told so, now and then)
      const W = (v.warned ||= {});
      if (!(W[barred] > (w.time || 0) - VEIN.warnS)) { W[barred] = w.time || 0; w.log.push({ t: w.tick, kind: "vein-guarded", team: barred, from: h, vein: v.id, vk: v.kind, x: v.x, y: v.y, why: shielded(w, h) ? "protected" : "peace" }); }
    }
    const cap = v.cap;
    if (cap) {
      if (by === null || held || by !== cap.by) { // broken off
        w.log.push({ t: w.tick, kind: "vein-hoist-broken", team: cap.by, from: h, vein: v.id, vk: v.kind, x: v.x, y: v.y, why: held ? "their men came back" : by === null ? "our men left it" : "another house holds the ground" });
        v.cap = null;
      } else if ((w.time || 0) - cap.t0 >= VEIN.hoistS) { takeVein(w, v, by); continue; }
    }
    if (!v.cap && by !== null && !held) {
      v.cap = { by, t0: w.time || 0 };
      w.log.push({ t: w.tick, kind: "vein-hoist", team: by, from: h, vein: v.id, vk: v.kind, x: v.x, y: v.y });
    }
  }
}

// the flag is up: `by` holds vein v; the old holder's camp there is theirs, with what is stored in it
export function takeVein(w, v, by) {
  const from = holderOf(v);
  v.holder = by; v.cap = null; v.takenT = w.time || 0;
  let camps = 0;
  if (from !== null) for (const b of w.buildings) {
    if (b.kind !== "mining_camp" || b.ruin || b.team !== from || Math.hypot(b.x - v.x, b.y - v.y) > VEIN.campR) continue;
    const P = w.plans?.[from]; if (P?.slots) for (const s of P.slots) if (s.taken === b.id) { s.taken = null; s.takenKind = null; }
    delete b.slot; b.byReeve = false;
    b.team = by; camps++;
    for (const u of w.units.values()) if (u.team === from && u.job && (u.job.b === b || u.job.node === v)) u.job = { kind: "home" };
  }
  // what the old holder's men had dug and not yet carried off — the heap at the landing (economy.js `site:<node>:<team>`)
  // and the cut lying in the mine — is the taker's now too
  let kg = 0;
  if (from !== null) for (const it of w.labor?.items || []) {
    if (it.team !== from || Math.hypot(it.x - v.x, it.y - v.y) > VEIN.campR) continue;
    if (it.key === `site:${v.id}:${from}`) { rekeyItem(w, it, `site:${v.id}:${by}`); it.team = by; kg += it.kg || 0; if (w.labor) w.labor.ver++; }
    else if (it.key === `works:${v.id}:${from}` && !(w.labor.items.some((q) => q.key === `works:${v.id}:${by}`))) { rekeyItem(w, it, `works:${v.id}:${by}`); it.team = by; kg += it.kg || 0; w.labor.ver++; } // (the mine's workings: the taker's men carry on in them — js/sim/jobs/quarry.js worksKey)
    else if (it.kind === "oreheap") { it.team = by; kg += it.kg || 0; if (w.labor) w.labor.ver++; }
  }
  w.log.push({ t: w.tick, kind: "vein-taken", team: by, from, vein: v.id, vk: v.kind, x: v.x, y: v.y, camps, kg: Math.round(kg) });
  return camps;
}

// ---------------------------------------------------------------- a hold's own vein, read from the land
// The foot of a crag: flat (the working floor), dry (no water within 30 m), with a steep rise close behind it (the face the
// adit is driven into), on rocky ground; not on another hold's ground, not by another vein, clear of buildings, fields,
// plots and roads. → { x, y, face, rise } | null. Deterministic (a fixed ring search, ties to the first found).
export function siteVein(w, hold, { others = [], min = VEIN.holdMin, max = VEIN.holdMax, steepMin = 0.25, riseMin = 5 } = {}) {
  const M = w.map, L = M.land;
  const slope = (x, y) => Math.hypot(M.h(x + 3, y) - M.h(x - 3, y), M.h(x, y + 3) - M.h(x, y - 3)) / 6;
  const wet = (x, y) => M.water(x, y) > 0.02;
  const inB = (x, y) => (M.inBounds ? M.inBounds(x, y) : true);
  const roads = [...(w.mapRoads || []).map((r) => r.pts || []), ...((w.plans || []).flatMap((P) => (P?.town?.lanes || []).map((l) => l.pts || l)))];
  const nearRoad = (x, y, d) => roads.some((pts) => { for (let k = 1; k < pts.length; k++) { const [ax, ay] = pts[k - 1], [bx, by] = pts[k]; const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)); if (Math.hypot(ax + dx * t - x, ay + dy * t - y) < d) return true; } return false; });
  const clear = (x, y) => !w.buildings.some((b) => !b.ruin && (b.field ? Math.hypot(b.x - x, b.y - y) < Math.max(b.w || 0, b.h || 0) / 2 + 40 : b.x1 !== undefined ? Math.hypot((b.x1 + b.x2) / 2 - x, (b.y1 + b.y2) / 2 - y) < 60 : Math.hypot(b.x - x, b.y - y) < 70))
    && !(w.plans || []).some((P) => P?.slots?.some((s) => Math.hypot(s.x - x, s.y - y) < 40));
  let best = null;
  for (let r = min; r <= max; r += 25) for (let k = 0; k < 64; k++) {
    const a = k / 64 * Math.PI * 2, x = hold.x + Math.cos(a) * r, y = hold.y + Math.sin(a) * r;
    if (!inB(x, y) || wet(x, y) || slope(x, y) > 0.1) continue;
    // the face: the steepest rise within 15–45 m, and which way it lies
    let rise = 0, steep = 0, fa = 0; const h0 = M.h(x, y);
    for (let q = 0; q < 16; q++) { const b = q / 16 * Math.PI * 2; for (const d of [15, 25, 35, 45]) { const dh = M.h(x + Math.cos(b) * d, y + Math.sin(b) * d) - h0; if (dh / d > steep) { steep = dh / d; rise = dh; fa = b; } } }
    if (steep < steepMin || rise < riseMin) continue; // (no crag here: open ground or a gentle bank)
    const fx = x - Math.cos(fa) * 12, fy = y - Math.sin(fa) * 12; // the working floor in front of the mouth
    if (slope(fx, fy) > 0.14 || wet(fx, fy)) continue;
    let dryRing = true; for (let q = 0; q < 8 && dryRing; q++) if (M.water(x + Math.cos(q * 0.785) * 30, y + Math.sin(q * 0.785) * 30) > 0.05) dryRing = false;
    if (!dryRing) continue;
    if ((w.holds || []).some((o) => o.team !== hold.team && Math.hypot(o.x - x, o.y - y) < 450)) continue;
    if ([...(w.resources || []), ...others].some((n) => (isVein(n) && Math.hypot(n.x - x, n.y - y) < 300) || ((n.res === "stone" || n.res === "clay" || n.res === "ore") && Math.hypot(n.x - x, n.y - y) < 60))) continue;
    if (!clear(x, y) || nearRoad(x, y, 25)) continue;
    const rock = L?.rock && L.idx ? L.rock[L.idx(x, y)] || 0 : 0;
    const score = Math.min(rise, 30) + Math.min(steep, 1.2) * 10 + rock * 12 - Math.abs(r - 700) / 60;
    if (!best || score > best.score) best = { x, y, face: fa + Math.PI, rise, steep, score };
  }
  return best;
}
// every hold its own silver vein (the world's build and the live save's migration): appended after the map's nodes (their
// ids unchanged), held by the hold's team from the start. A hold that has its own already is left alone. → the new nodes
export function holdVeins(w, holds) {
  const nodes = w.resources || (w.resources = []), add = [];
  for (const hd of holds || []) {
    const team = hd.team;
    if (nodes.some((n) => isVein(n) && n.home === team)) continue;
    // a crag's foot within 500–1000 m; else within 350–1400 m; else the steepest bank; else the best rising ground there is
    // (the adit is driven into a mound of its own — js/render/jobs/quarry.js — wherever the rise is slight)
    const s = siteVein(w, hd, { others: add }) || siteVein(w, hd, { others: add, min: 350, max: 1400 }) || siteVein(w, hd, { others: add, steepMin: 0.1, riseMin: 2.5 })
      || siteVein(w, hd, { others: add, min: 350, max: 1400, steepMin: 0.04, riseMin: 0.5 });
    if (!s) continue;
    add.push({ id: 0, kind: "silver_vein", res: "silver", x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10, amount: VEIN.holdAmount, start: VEIN.holdAmount, r: 10, source: "hold", name: `${hd.name || "the hold"}'s silver`, home: team, holder: team, face: Math.round(s.face * 1000) / 1000, rise: Math.round(s.rise * 10) / 10 });
  }
  let id = nodes.reduce((m, n) => Math.max(m, n.id || 0), 0);
  for (const n of add) { n.id = ++id; nodes.push(n); }
  return add;
}
