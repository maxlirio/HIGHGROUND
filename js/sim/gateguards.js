// GATE GUARDS — a gate costs two real men (the owner: "Making a gate permanently loses you two footmen who guard it.").
// Server-authoritative sim rule; deterministic (w.buildings and w.units in their order, ties by id; no dice).
//
// A finished timber gate or stone gatehouse of a house's town wall takes TWO foot soldiers of that house, one for each
// side of its passage. Each is drawn from the nearest company standing at home (within HOME_R of the gate) by the arm
// that suits the post best: spearmen first, then the levy, then men-at-arms, then any other foot (never horse, never an
// engine's crew, never villagers). He is split off his company into a one-man garrison bound to the gate (u.gate = the
// gate's id, u.gateSide = -1 | 1) and stands guard inside the wall at his side of the passage, facing out.
//   • they are real men: they eat and are paid as before, fight whoever comes at them and can be killed
//   • nobody pulls them away: the reeve and the warden (ai-general milThink), "Back to the keep" and the other broad
//     tasks (broad.js), the captains (captains.js) leave them be; ordered off by hand, a guard walks back to his post
//     when no foe is near the gate
//   • none free: the gate stands UNGUARDED — the chronicle says so once, its panel says so, and it takes a guard as soon
//     as any foot soldier is free at home
//   • a guard who dies (or deserts, or is merged away) is replaced the same way
//   • a gate that is pulled down, ruined, burnt out, taken by another house or replaced frees its guards: they go back
//     to the army (into a company of their arm at home, if there is one)
// API: gateGuardTick(w) (economy.js, every GG_EVERY ticks) · guardsOf(w, b) · isGateGuard(u) · manAllGates(w) (migration)
import { ARMS } from "./arms.js";
import { splitUnit, mergeUnits, applyOrder } from "./world.js";
import { BUILDINGS } from "./econ-data.js";
import { gateGeom, GATE_PASSAGE } from "./features.js";
import { allTowns } from "./towns.js";
import { isFoe } from "./sides.js";
import { S_FIGHT, S_FLEE } from "./soldiers.js";

export const GG_EVERY = 20;        // ticks between looks
export const HOME_R = 650;         // m: a company this near the gate is "at home" for it
const FOE_R = 160;                 // m: a foe this near the gate — the guards fight, nobody is walked back to his post
const PREFER = ["spearmen", "levy", "menatarms"];
const SIDES = [-1, 1];

export const isGateKind = (b) => b && (b.kind === "gate" || b.kind === "gatehouse") && b.x1 === undefined;
export const isGateGuard = (u) => u?.gate !== undefined && u?.gate !== null;
const standing = (b) => isGateKind(b) && b.progress >= 1 && !b.ruin && !b.razing && b.castle === undefined;
const footArm = (arm) => { const A = ARMS[arm]; return !!A && !A.mounted && !A.engine && !A.horse && arm !== "villager"; };
const rankOf = (arm) => { const i = PREFER.indexOf(arm); return i < 0 ? PREFER.length : i; };
const alive = (w, u) => u.members.filter((i) => w.S.alive[i]);

// the guards' posts: inside the wall, flanking the passage, facing out → [{ side, x, y, face }]
export function posts(w, b) {
  const G = gateGeom(b), depth = (BUILDINGS[b.kind]?.footprint?.[1] || 8) / 2 + 1.6, lat = GATE_PASSAGE + 1.3;
  let nx = -G.uy, ny = G.ux;
  let best = null, bd = Infinity; for (const t of allTowns(w)) if (t.team === b.team) { const d = Math.hypot(t.x - G.px, t.y - G.py); if (d < bd) { bd = d; best = t; } }
  if (best && (best.x - G.px) * nx + (best.y - G.py) * ny < 0) { nx = -nx; ny = -ny; } // (n points in, toward the town)
  return SIDES.map((s) => ({ side: s, x: G.px + G.ux * lat * s + nx * depth, y: G.py + G.uy * lat * s + ny * depth, face: Math.atan2(-ny, -nx) }));
}
export function guardsOf(w, b) { const out = []; for (const u of w.units.values()) if (u.gate === b.id && u.members.length) out.push(u); return out; }

function foeNear(w, team, x, y, r = FOE_R) {
  for (const v of w.units.values()) if (v.team !== team && v.members.length && !v.isWorkers && v.state !== "routing" && isFoe(w, team, v.team) && Math.hypot(v.ax - x, v.ay - y) < r) return true;
  return false;
}
const say = (w, b, text, tone) => w.log.push({ t: w.tick, kind: "reeve-say", team: b.team, text, tone, x: b.x, y: b.y });
const gateName = (b) => (b.kind === "gatehouse" ? "stone gatehouse" : "timber gate");
const ONE = { spearmen: "spearman", levy: "levy spearman", menatarms: "man-at-arms", pikemen: "pikeman", archers: "archer", crossbow: "crossbowman", militia: "militiaman" };
const armWord = (arm) => ONE[arm] || (ARMS[arm]?.name || arm).toLowerCase();
const art = (s) => (/^[aeiou]/.test(s) ? "An " : "A ") + s;

// a free foot soldier for the post at (x, y): the best arm, the nearest company at home, the man of it nearest the post
function donor(w, b, x, y) {
  const S = w.S; let best = null, bk = null;
  for (const u of w.units.values()) {
    if (u.team !== b.team || u.isWorkers || isGateGuard(u) || !footArm(u.arm) || u.household || u.noAI || u.tw || u.convoy || u.settling || u.state === "routing" || !u.members.length) continue;
    const d = Math.hypot(u.ax - b.x, u.ay - b.y); if (d > HOME_R) continue;
    const k = [rankOf(u.arm), d, u.id];
    if (!bk || k[0] < bk[0] || (k[0] === bk[0] && (k[1] < bk[1] || (k[1] === bk[1] && k[2] < bk[2])))) {
      let man = -1, md = Infinity;
      for (const i of u.members) { if (!S.alive[i] || S.state[i] === S_FIGHT || S.state[i] === S_FLEE) continue; const dd = Math.hypot(S.x[i] - x, S.y[i] - y); if (dd < md || (dd === md && i < man)) { md = dd; man = i; } }
      if (man >= 0) { best = { u, man }; bk = k; }
    }
  }
  return best;
}
function toPost(w, u, P) { applyOrder(w, u, { kind: "hold", x: P.x, y: P.y, facing: P.face, pace: "march", formation: "line", raw: true }); u.gatePost = { x: P.x, y: P.y }; }
function post(w, b, P) {
  const D = donor(w, b, P.x, P.y); if (!D) return null;
  const nu = splitUnit(w, D.u, [D.man]);
  Object.assign(nu, { gate: b.id, gateSide: P.side, broad: null, hunt: null, group: null, cap: null, initiative: null, commander: null, chain: null, away: false, ordered: false, deployAs: null, enemyNear: false });
  nu.formation = "line"; nu.depth = 0;
  toPost(w, nu, P);
  return nu;
}
// a guard freed (his gate gone): back to the army — into a company of his arm at home, if there is one
function free(w, u) {
  u.gate = null; u.gateSide = null; u.gatePost = null;
  let best = null, bd = HOME_R; for (const v of w.units.values()) if (v !== u && v.team === u.team && v.arm === u.arm && !v.isWorkers && !isGateGuard(v) && !v.tw && v.members.length && !v.household && !v.noAI) { const d = Math.hypot(v.ax - u.ax, v.ay - u.ay); if (d < bd) { bd = d; best = v; } }
  if (best) mergeUnits(w, [best, u]);
}

// one gate: its two posts held, or as many as men can be found for (→ the number held)
function manGate(w, b, quiet = false) {
  const P = posts(w, b), have = new Map(), S = w.S;
  for (const u of guardsOf(w, b)) {
    const live = alive(w, u);
    if (!live.length) { u.gate = null; u.gateSide = null; continue; } // (dead: the empty company is the world's to clear; the post is filled again below)
    if (have.has(u.gateSide) || !SIDES.includes(u.gateSide)) { free(w, u); continue; } // (two on one side: the second back to the army)
    if (live.length > 1) free(w, splitUnit(w, u, live.slice(1))); // (merged into by hand: one man keeps the post, the rest go back to the army)
    have.set(u.gateSide, u);
  }
  const was = b.guardN ?? null, foe = foeNear(w, b.team, b.x, b.y);
  const took = [];
  for (const p of P) {
    const u = have.get(p.side);
    if (u) { // at his post (walked back there when sent off and no foe is near)
      u.gatePost = { x: p.x, y: p.y };
      const i = u.members[0], off = Math.hypot(S.x[i] - p.x, S.y[i] - p.y);
      if (!foe && S.state[i] !== S_FIGHT && (off > 6 && !u.path || Math.hypot((u.order?.x ?? 1e9) - p.x, (u.order?.y ?? 1e9) - p.y) > 2 || u.order?.kind !== "hold")) toPost(w, u, p);
      // (the coarse route stops short of a gate's own nav cells: the last few metres the body's anchor is the post itself,
      // and he steers to it round the gate's timbers like any man to his place)
      if (!foe && u.order?.kind === "hold" && !u.path && Math.hypot(u.ax - p.x, u.ay - p.y) > 0.5 && Math.hypot(u.ax - p.x, u.ay - p.y) < 60) { u.ax = p.x; u.ay = p.y; u.finalFacing = p.face; }
      if (!foe && off < 1.2 && S.state[i] !== S_FIGHT && S.state[i] !== S_FLEE) S.facing[i] = p.face; // (at his post he stands facing out through the gate)
      continue;
    }
    const nu = post(w, b, p); if (nu) { have.set(p.side, nu); took.push(nu); }
  }
  const n = have.size;
  b.guardN = n;
  if (!quiet) {
    const g = gateName(b);
    if (took.length) {
      const who = took.length === 2 ? (took[0].arm === took[1].arm ? `Two ${ARMS[took[0].arm].name.toLowerCase()}` : `${art(armWord(took[0].arm))} and a ${armWord(took[1].arm)}`) : art(armWord(took[0].arm));
      if (was === null) say(w, b, `${who} of your army ${took.length === 2 ? "stand" : "stands"} guard at the new ${g} — for good${n < 2 ? `. One side stands UNGUARDED: no other foot soldier is free at home` : ""}`, n < 2 ? "bad" : "good");
      else say(w, b, `${who} ${took.length === 2 ? "take" : "takes"} the guard at the ${g}${n < 2 ? "; one side is still unguarded" : ""}`, n < 2 ? "bad" : "good");
    } else if (n === 0 && was !== 0) say(w, b, `The ${g} stands UNGUARDED: no foot soldier is free at home to guard it. It takes two as soon as any are`, "bad");
    else if (n === 1 && was === 2) say(w, b, `A guard at the ${g} is lost and no foot soldier is free to take his place: one side stands unguarded`, "bad");
  }
  return n;
}

export function gateGuardTick(w, force = false) {
  if (!force && w.tick % GG_EVERY !== 11) return;
  if (!w.buildings?.length) return;
  const gates = new Set();
  for (const b of w.buildings) if (standing(b) && w.teams[b.team]?.store && !w.teams[b.team].fallen) { gates.add(b.id); manGate(w, b); }
  for (const u of w.units.values()) { // guards whose gate is gone (pulled down, ruined, taken, replaced): back to the army
    if (!isGateGuard(u)) continue;
    const b = w.buildings.find((q) => q.id === u.gate);
    if (!gates.has(u.gate) || !b || b.team !== u.team) free(w, u);
  }
  for (const b of w.buildings) if (isGateKind(b) && b.guardN !== undefined && b.guardN !== null && !gates.has(b.id)) { if (b.guardN > 0) say(w, b, `The guards of the ${b.ruin || b.razing ? "fallen " : ""}${gateName(b)} go back to the army`, "info"); b.guardN = null; }
}
// the live realm (server/migrate.mjs): every gate already standing takes its guards now
export function manAllGates(w) {
  const out = [];
  for (const b of w.buildings) if (standing(b) && w.teams[b.team]?.store && !w.teams[b.team].fallen) { const n = manGate(w, b); out.push({ team: b.team, id: b.id, kind: b.kind, n, arms: guardsOf(w, b).map((u) => u.arm) }); }
  return out;
}
