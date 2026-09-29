// Command & control friction (docs/combat-research.md §13). Every order travels from the commander to
// the unit's leader by voice, horn or mounted messenger, may be misheard, garbled or lost with the messenger,
// and the unit then takes time to act on it. world.issueOrder hands orders here when w.command is set;
// `{ immediate: true }` orders (pre-battle standing orders, scripted scenarios) bypass it.
import { applyOrder, DT } from "./world.js";
import { ARM_BY_ID } from "./arms.js";
import { weather } from "./ground.js";
import { ST_FLEE, S_FIGHT } from "./soldiers.js";

export const ORDER_MAX_S = 5;
export const CMD = {
  voiceR: 30, voiceT: 2,
  hornR: 250, hornT: 5, hornMishear: [0.1, 0.3], hornVocab: new Set(["hold", "assault", "charge", "retire", "move", "rally", "escalade"]),
  riderSpeed: 6.5, findT: [20, 90], garble: [0.05, 0.1], garbleM: 60,
  interceptR: 80, interceptP: 0.15, interceptMax: 0.6,
  react0: 5, reactDisc: 30, reactWaver: 30, reactContact: [60, 180], disengageStress: 0.1,
};

export function makeCommand() {
  return { pending: new Map(), sent: 0, lost: 0, garbled: 0, misheard: 0, enqueue };
}

// The commander of a team stands at team.hq (set by the game/AI) or behind the centre of his army.
function hqOf(w, team) {
  const T = w.teams[team];
  if (T?.hq) return T.hq;
  if (T?.commanderUnit !== undefined) { const u = w.units.get(T.commanderUnit); if (u) return { x: u.ax, y: u.ay }; }
  let x = 0, y = 0, n = 0;
  for (const u of w.units.values()) { if (u.team !== team || !u.members.length || u.isWorkers) continue; x += u.ax * u.members.length; y += u.ay * u.members.length; n += u.members.length; }
  return n ? { x: x / n, y: y / n } : null;
}

function enqueue(w, u, o) {
  const C = w.command, rng = w.rng, t = w.time;
  const prev = C.pending.get(u.id);
  if (prev && prev.o.kind === o.kind && Math.hypot(prev.o.x - o.x, prev.o.y - o.y) < 25 && (prev.o.pace || "") === (o.pace || "")) return; // already on its way
  const hq = hqOf(w, u.team) || { x: u.ax, y: u.ay };
  const L = u.c && u.c.leader >= 0 && w.S.alive[u.c.leader] ? u.c.leader : u.members[0];
  const lx = L !== undefined ? w.S.x[L] : u.ax, ly = L !== undefined ? w.S.y[L] : u.ay;
  const d = Math.hypot(lx - hq.x, ly - hq.y);
  const W = weather(w), night = w.night ? 3 : 1;
  const garbleAdd = (W.orderGarbleAdd || 0) + (w.night ? 0.2 : 0);
  let lat, channel, lost = false, order = o;
  if (d <= CMD.voiceR) { lat = CMD.voiceT; channel = "voice"; }
  else if (d <= CMD.hornR * (W.noiseAudibilityMul ?? 1) && CMD.hornVocab.has(o.kind)) {
    lat = CMD.hornT; channel = "horn";
    const pm = CMD.hornMishear[0] + (CMD.hornMishear[1] - CMD.hornMishear[0]) * d / CMD.hornR + garbleAdd;
    if (rng.next() < pm) { C.misheard++; order = { ...o, kind: "hold", x: u.ax, y: u.ay, misheard: true }; } // misheard: they stand fast (the call is sounded again)
  } else {
    channel = "rider";
    lat = d / CMD.riderSpeed + rng.range(CMD.findT[0], CMD.findT[1]);
    // the messenger is a real man riding across the field: enemy bodies near his line may take him
    let pk = 0;
    for (const v of w.units.values()) {
      if (v.team === u.team || !v.members.length || v.c?.broken) continue;
      if (segDist(hq.x, hq.y, lx, ly, v.ax, v.ay) < CMD.interceptR) pk += CMD.interceptP;
    }
    if (!(prev && prev.at > t) && rng.next() < Math.min(CMD.interceptMax, pk)) { lost = true; C.lost++; } // (an amendment goes after a rider already on his way)
    if (rng.next() < rng.range(CMD.garble[0], CMD.garble[1]) + garbleAdd) {
      C.garbled++; order = { ...o, x: o.x + rng.normal(0, CMD.garbleM), y: o.y + rng.normal(0, CMD.garbleM) };
    }
  }
  if (lost) { // the messenger was taken: the commander sees no one moving and sends another
    C.pending.delete(u.id);
    (C.retry ||= []).push({ at: t + 2, unit: u.id, o, q: t });
    w.events.push({ t: w.tick, kind: "order-lost", unit: u.id, team: u.team });
    u.pendingOrder = { ...o, eta: t + 2 + ORDER_MAX_S, channel: "rider" };
    return;
  }
  // the unit's own reaction (§13): drill, nerves, and the near-impossibility of pulling out of a fight
  const disc = u.c?.disc ?? ARM_BY_ID[w.S.arm[u.members[0]] ?? 0].drill;
  const inContact = !!u.hold;
  let react = CMD.react0 + (1 - disc) * CMD.reactDisc + (u.state === "wavering" || u.state === "shaken" ? CMD.reactWaver : 0);
  if (inContact && o.kind !== "assault" && o.kind !== "hold") react += rng.range(CMD.reactContact[0], CMD.reactContact[1]);
  C.sent++;
  // playability (owner): no order takes longer than ~5 s to arrive and be acted on, however far the rider
  let delay = Math.min(ORDER_MAX_S, (lat + react) * night);
  // an order that amends one already on its way does not start the wait again: the unit is already making ready
  // (a commander re-ordering every few seconds — the AI's 4 s think, a player clicking again because nothing has
  // happened yet — used to push the arrival back each time, and a body could stand for a minute with its order
  // never arriving)
  if (prev && prev.at > t) delay = Math.min(delay, prev.at - t);
  C.pending.set(u.id, { o: order, orig: o, at: t + delay, channel, from: prev?.from ?? t, last: t, inContact });
  u.pendingOrder = { ...order, eta: t + delay, channel };
}

// Deliver what has arrived (run every tick by the combat system).
export function commandTick(w) {
  const C = w.command; if (!C) return;
  const t = w.time, S = w.S;
  if (C.retry?.length) for (let k = C.retry.length - 1; k >= 0; k--) { const r = C.retry[k]; if (r.at > t) continue; C.retry.splice(k, 1); const u = w.units.get(r.unit); if (!u || !u.members.length) continue; if ((C.pending.get(r.unit)?.last ?? -1) > r.q || (u.orderT ?? -1) > r.q) continue; enqueue(w, u, r.o); } // (a newer order has gone since: the old one is not sent again)
  if (!C.pending.size) return;
  for (const [id, p] of C.pending) {
    if (p.at > t) continue;
    C.pending.delete(id);
    const u = w.units.get(id); if (!u || !u.members.length) continue;
    u.pendingOrder = null;
    // withdrawing from contact under pressure risks a break (§13)
    if (u.hold && p.o.kind !== "assault" && p.o.kind !== "hold") {
      u.disengage = true; u.hold = false;
      for (const i of u.members) if (S.alive[i] && S.status[i] !== ST_FLEE) { S.stress[i] += CMD.disengageStress * (1.3 - S.courage[i]); if (S.state[i] === S_FIGHT) { S.state[i] = 0; S.foe[i] = -1; } }
    } else if (p.o.kind === "assault") u.disengage = false;
    applyOrder(w, u, p.o);
    w.events.push({ t: w.tick, kind: "order-arrived", unit: id, channel: p.channel, delay: t - p.from });
    if (p.o.misheard) { // they stood fast; the call is sounded again once the commander sees it
      w.events.push({ t: w.tick, kind: "order-misheard", unit: id, team: u.team });
      (C.retry ||= []).push({ at: t + 3, unit: id, o: p.orig, q: t });
    }
  }
}

function segDist(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const k = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
}
export { DT };
