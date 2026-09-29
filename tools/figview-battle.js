// figview staging for the fight animations (docs/units-combat-anims.md), no sim: a tiny driver that sets the same
// soldier state and pushes the same w.events the real sim does, so js/render/figures.js is exercised exactly as in
// a battle. Used by tools/figview.html:
//   &duel=menatarms:spearmen      pairs of men in contact (arm A, team 0, facing arm B, team 1), blows on S.nextAtk,
//                                 blow events (res: parry / block / glance / wound), now and then a kill or a knockdown
//   &ranks=3                      ranks per side (the rear ones press)
//   &volley=archers               a company of that arm 70 m off shooting into the duel every few seconds
//   &stone=1                      a trebuchet stone lands among them every 7 s (kills + "stoned" events)
//   &charge=knights               a line of that arm charging the duel from 140 m (lance lowered, impact, melee)
//   &freeze=T                     stop the driver's clock at T seconds (poses held for screenshots)
import { S_IDLE, S_MOVE, S_FIGHT, S_DEAD, S_DOWN } from "../js/sim/soldiers.js";
import { ARMS } from "../js/sim/arms.js";
import { WEAPON_BY_ID, WEAPON_ID } from "../js/sim/kit.js";

export function stageBattle(P, w, man, ORIGIN) {
  const S = w.S; w.events = []; w.systems = []; w.cs = { flights: [], recentShot: new Float32Array(S.cap) }; w.siege = { impacts: [] }; w.tick = 0;
  const rnd = mulberry(+(P.get("seed") || 7));
  const [aA, aB] = (P.get("duel") || "menatarms:spearmen").split(":"); const ranks = +(P.get("ranks") || 2), files = +(P.get("files") || 8);
  const reachOf = (i) => Math.max(0.72, Math.min(WEAPON_BY_ID[S.weapon[i]].reach, 2.2) * 0.8);
  const fighters = [];
  for (let f = 0; f < files; f++) for (let r = 0; r < ranks; r++) {
    const x = (f - (files - 1) / 2) * 1.0;
    const a = man(x, -r * 0.95, 0, aA, S_FIGHT, 0, Math.PI / 2, { rank: r, unit: 11 });
    const gap = reachOf(a);
    const b = man(x, gap + r * 0.95, 1, aB, S_FIGHT, 0, -Math.PI / 2, { rank: r, unit: 12 });
    // the front pair at the distance the sim holds them (combat.js: 0.8 × reach), the rear ranks close behind
    if (r === 0) { const g = Math.max(reachOf(a), reachOf(b)); S.y[b] = ORIGIN + g; }
    fighters.push(a, b);
  }
  // foes: each man the enemy in his file's front
  const byFile = new Map(); fighters.forEach((i) => { const key = Math.round(S.x[i] * 10) + ":" + S.team[i]; if (S.rank[i] === 0) byFile.set(key, i); });
  const foeOf = (i) => byFile.get(Math.round(S.x[i] * 10) + ":" + (1 - S.team[i])) ?? -1;
  for (const i of fighters) { S.foe[i] = foeOf(i); S.nextAtk[i] = 1 + rnd() * 3; }
  const shooters = [];
  if (P.get("volley")) for (let n = 0; n < 24; n++) { const i = man((n % 12 - 5.5) * 1.4, -70 - Math.floor(n / 12) * 1.5, 0, P.get("volley"), S_IDLE, 0, Math.PI / 2, { unit: 13 }); shooters.push(i); S.nextShot[i] = 2 + rnd() * 3; }
  const riders = [];
  if (P.get("charge")) for (let n = 0; n < 6; n++) { const i = man((n - 2.5) * 1.6, 140, 1, P.get("charge"), S_MOVE, 8.5, -Math.PI / 2, { unit: 14 }); riders.push(i); }
  w.units.set(14, { id: 14, team: 1, members: riders, ax: ORIGIN, ay: ORIGIN + 140, c: { phase: "charge", target: 11 } });
  w.units.set(11, { id: 11, team: 0, members: fighters.filter((i) => S.team[i] === 0), ax: ORIGIN, ay: ORIGIN });
  w.units.set(12, { id: 12, team: 1, members: fighters.filter((i) => S.team[i] === 1), ax: ORIGIN, ay: ORIGIN + 1 });
  let nextStone = 3, freeze = +(P.get("freeze") || 1e9);
  const push = (e) => { e.t = w.tick; w.events.push(e); };
  function kill(i, by, cause) { S.alive[i] = 0; S.state[i] = rnd() < 0.3 ? S_DOWN : S_DEAD; push({ kind: S.state[i] === S_DEAD ? "kill" : "down", victim: i, by, cause }); }
  return function drive(dt) {
    if (w.time > freeze) return;
    w.tick++; w.events.length = 0;
    const t = w.time;
    for (const i of riders) if (S.alive[i] && S.posture[i] && t > S.upT[i]) S.posture[i] = 0;
    for (const i of fighters) {
      if (!S.alive[i]) continue;
      if (S.posture[i] && t > S.upT[i]) S.posture[i] = 0;
      let f = S.foe[i]; if (f < 0 || !S.alive[f]) { f = S.foe[i] = foeOf(i); }
      if (f >= 0) S.facing[i] = Math.atan2(S.y[f] - S.y[i], S.x[f] - S.x[i]);
      if (t < S.nextAtk[i] || S.posture[i]) continue;
      const d = f >= 0 ? Math.hypot(S.x[f] - S.x[i], S.y[f] - S.y[i]) : 99;
      S.nextAtk[i] = t + 1.2 + rnd() * 3.5;
      if (f < 0 || d > WEAPON_BY_ID[S.weapon[i]].reach + 0.6) continue;
      const u = rnd(), shield = S.shield[f] && S.shieldArm[f];
      const res = u < 0.3 ? 0 : u < 0.62 && shield ? 1 : u < 0.82 ? 2 : u < 0.93 ? 4 : 7;
      push({ kind: "blow", a: i, d: f, res, dx: S.x[f] - S.x[i], dy: S.y[f] - S.y[i] });
      if (res === 7) kill(f, i, "melee");
      else if (res === 4 && rnd() < 0.3) { S.posture[f] = 1; S.upT[f] = t + 4; push({ kind: "knock", who: f, by: i }); }
    }
    // the dead are replaced from the rank behind after a while (a new man: new name)
    for (const i of fighters) if (!S.alive[i] && t - (S.downT[i] || (S.downT[i] = t)) > 9) { S.alive[i] = 1; S.state[i] = S_FIGHT; S.name[i] = (rnd() * 2 ** 30) | 0; S.downT[i] = 0; S.nextAtk[i] = t + 2; }
    // arrows: loosed at the duel, landing a few seconds later; the arrow event says where each one went
    for (const i of shooters) if (t >= S.nextShot[i]) {
      S.nextShot[i] = t + 4 + rnd() * 3;
      const tgt = fighters[(rnd() * fighters.length) | 0];
      const x = S.x[tgt] + (rnd() - 0.5) * 3, y = S.y[tgt] + (rnd() - 0.5) * 3, R = Math.hypot(x - S.x[i], y - S.y[i]);
      const ux = (x - S.x[i]) / R, uy = (y - S.y[i]) / R;
      w.cs.flights.push({ tI: t + 2.2, x, y, ux, uy, ang: 0.55, by: i, key: ARMS[P.get("volley")].missile === "crossbow" ? "crossbow" : "longbow", x0: S.x[i], y0: S.y[i], t0: t });
    }
    for (let k = w.cs.flights.length - 1; k >= 0; k--) { const f = w.cs.flights[k]; if (f.tI > t) continue; w.cs.flights.splice(k, 1);
      let hit = -1, bd = 0.5; for (const o of fighters) { const dd = Math.hypot(S.x[o] - f.x, S.y[o] - f.y); if (dd < bd) { bd = dd; hit = o; } }
      for (const o of fighters) if (Math.hypot(S.x[o] - f.x, S.y[o] - f.y) < 3) w.cs.recentShot[o] = t;
      const toward = hit >= 0 && Math.cos(S.facing[hit] - Math.atan2(-f.uy, -f.ux)) > 0.3;
      const on = hit < 0 ? "ground" : S.shield[hit] && S.shieldArm[hit] && toward && rnd() < 0.6 ? "shield" : "body";
      push({ kind: "arrow", x: f.x, y: f.y, ux: f.ux, uy: f.uy, ang: f.ang, key: f.key, hit, on });
      if (hit >= 0 && on === "body" && rnd() < 0.15 && S.alive[hit]) kill(hit, f.by, "missile");
    }
    // a stone
    if (P.get("stone") && t >= nextStone) {
      nextStone = t + 7;
      const c = fighters[(rnd() * fighters.length) | 0], x = S.x[c] + (rnd() - 0.5), y = S.y[c] + (rnd() - 0.5);
      w.siege.impacts.push({ x, y, t, kind: "dust", size: 2.2 });
      const near = fighters.filter((o) => S.alive[o] && Math.hypot(S.x[o] - x, S.y[o] - y) < 2.4).sort((a, b) => Math.hypot(S.x[a] - x, S.y[a] - y) - Math.hypot(S.x[b] - x, S.y[b] - y));
      near.slice(0, 3).forEach((o, k) => { push({ kind: "stoned", who: o, x, y, ux: 0, uy: -1, first: k === 0, big: true }); kill(o, -1, "stone"); S.state[o] = S_DEAD; });
    }
    // the charge: ride in at the gallop, strike the line, then fight from the saddle
    for (const i of riders) {
      if (!S.alive[i] || S.state[i] === S_FIGHT) continue;
      let best = -1, bd = 1e9; for (const o of fighters) if (S.team[o] === 0 && S.alive[o] && S.rank[o] === 0) { const dd = Math.hypot(S.x[o] - S.x[i], S.y[o] - S.y[i]); if (dd < bd) { bd = dd; best = o; } }
      if (best < 0) continue;
      const dx = S.x[best] - S.x[i], dy = S.y[best] - S.y[i];
      S.facing[i] = Math.atan2(dy, dx);
      if (bd < 2.4) { S.state[i] = S_FIGHT; S.foe[i] = best; S.vx[i] = S.vy[i] = 0; if (ARMS[P.get("charge")].sidearm) S.weapon[i] = WEAPON_ID[ARMS[P.get("charge")].sidearm]; push({ kind: "impact", who: i, on: best }); push({ kind: "lance", who: i, on: best, broke: true }); S.nextAtk[i] = t + 1.5; if (rnd() < 0.6) { S.posture[best] = 1; S.upT[best] = t + 4; }
        const r = riders.indexOf(i) % 3;   // one in three brought down with his horse, one in three killed in the saddle
        if (r === 0) { S.horseOK[i] = 0; S.posture[i] = 1; S.upT[i] = t + 6; S.state[i] = S_FIGHT; push({ kind: "horse", who: i, what: "down", by: best }); }
        else if (r === 1) setTimeout(() => kill(i, best, "melee"), 1200);
        continue; }
      S.vx[i] = dx / bd * 8.5; S.vy[i] = dy / bd * 8.5; S.x[i] += S.vx[i] * dt; S.y[i] += S.vy[i] * dt;
      w.units.get(14).ay = S.y[i];
    }
    for (const sys of w.systems) sys(w);
  };
}
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
