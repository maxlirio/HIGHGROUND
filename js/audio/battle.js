// The battle as heard: reads the sim (events, soldier states, flights, siege, fire, orders) and the camera,
// and drives the audio engine. Mixing rules follow docs/battle-feel-research.md §7:
//  * density, not samples: men fighting / marching / galloping / fleeing, arrows landing and fires are binned
//    into cells and played as looped beds on a few pooled emitters; single sounds only where the ear is close;
//  * the SURGE (fresh contact, shocks, charges) roars with shouts, the long GRIND goes quiet of voices;
//  * horns and trumpets on the approach (massed bouts, louder as the hosts close), war cries at each charge,
//    horses screaming under arrows, and at the end the noise stopping — groans and crows.
import { ARMS, ARM_BY_ID } from "../sim/arms.js";
import { makeSiegeAudio } from "./siege.js";

const S_MOVE = 1, S_FIGHT = 2, S_FLEE = 3;
const CELL = 32, EAR_K = 0.3, SCAN = 0.25;
const NREF = { fight: 60, march: 60, trot: 20, gallop: 20, flee: 30, arrows: 30, dead: 25 };
const CALL = { move: "advance", assault: "charge", charge: "charge", hold: "hold", fortify: "hold", ambush: "hold", retire: "retire", rally: "rally", escalade: "charge" };
const rnd = Math.random, pickW = (pairs) => { let s = 0; for (const [, w] of pairs) s += w; let r = rnd() * s; for (const [k, w] of pairs) if ((r -= w) <= 0) return k; return pairs[0][0]; };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function makeBattleAudio(eng, w, camera, map, { player = 0, castles = null } = {}) {
  const S = w.S;
  const P = (x, y, up = 1.5) => [x, map.h(x, y) + up, -y];
  const queue = [];
  const tap = (w) => { for (const e of w.events) if (queue.length < 4000) queue.push(e); };
  w.systems.push(tap);
  for (const [name, K] of [["bed_surge", 3], ["bed_grind", 3], ["bed_roar", 3], ["bed_arrows", 3], ["bed_march", 3], ["bed_trot", 2],
    ["bed_gallop", 3], ["bed_rout", 2], ["bed_fire", 3], ["bed_after", 2], ["lord_gallop", 1], ["lord_canter", 1], ["lord_trot", 1], ["lord_steps", 1]]) eng.layer(name, K, { smooth: 0.12, release: 0.25 });

  const st = {
    t: 0, scanT: 0, cells: new Map(), fightStart: new Map(), lastFight: new Map(), surgeAt: new Map(), arrows: new Map(), dead: new Map(),
    near: [], fighters: 0, meleeAcc: 0, throttle: new Map(), seenP: new WeakSet(), seenShot: new WeakSet(), seenImpact: new WeakSet(),
    lastArrows: 0, pace: new Map(), phase: "peace", quietT: 0, peak: [0, 0], counts: [0, 0], cent: [null, null], nextBout: [0, 0],
    cueT: -1e9, loose: new Map(), sig: { blow: -1e9, arrow: -1e9, volley: -1e9 }, sched: [], wind: null, birdT: 3, villageT: 2, bellT: 60 + rnd() * 60, ear: [0, 0, 0], earH: 0,
  };
  const once = (key, gap) => { const t = st.throttle.get(key); if (t !== undefined && st.t - t < gap) return false; st.throttle.set(key, st.t); return true; };
  const play = (name, x, y, opts, up) => { const [a, b, c] = P(x, y, up); return eng.play(name, a, b, c, opts); };
  const hear = (name, x, y) => { const [a, b, c] = P(x, y); return eng.audibility(name, eng.dist(a, b, c)); };
  const cue = (name) => { if (eng.settings.cues > 0 && st.t - st.cueT > 20) { st.cueT = st.t; eng.play2d(name, "cue"); } };
  const later = (dt, fn) => st.sched.push([st.t + dt, fn]);
  const unitPos = (u) => [u.ax, u.ay];
  const hq = (team) => { const T = w.teams[team]; if (T?.hq) return [T.hq.x, T.hq.y]; const c = st.cent[team]; return c ? [c[0], c[1]] : null; };
  const teamName = (team) => (team === 0 ? "blue" : "red");
  const cellKey = (x, y) => ((x / CELL) | 0) * 4096 + ((y / CELL) | 0);
  // castles and sieges (js/audio/siege.js): it sees every event first, every engine shot, and runs once a frame
  const siege = makeSiegeAudio(eng, w, map, { play, hear, later, once, st, teamName, hq, camera, get castles() { return castles || (typeof window !== "undefined" ? window.HG?.castles : null); } });

  // ------------------------------------------------------------ the ear (listener) follows the camera
  function updateEar() {
    const cam = camera.cam, s = camera.st;
    const tx = s.tx, ty = s.ty, th = map.h(tx, ty) + 1.7;
    // the ear sits on the line from what we look at to the camera: 30 % of the way at the ground view, and
    // pulled in further as we zoom out (eagle ≈ 140 m, map ≈ 260 m) so the command views hear a roar, not silence
    const cd = Math.hypot(cam.position.x - tx, cam.position.y - th, cam.position.z + ty) || 1;
    const k = Math.min(EAR_K * cd, EAR_K * 90 + (cd - 90) * 0.2) / cd;
    const ex = tx + (cam.position.x - tx) * k, ey = th + (cam.position.y - th) * k, ez = -ty + (cam.position.z + ty) * k;
    const e = cam.matrixWorld.elements;
    eng.setEar(ex, ey, ez, -e[8], -e[9], -e[10], e[4], e[5], e[6]);
    st.ear = [ex, -ez, ey]; // sim x, sim y, height
    st.earH = ey - map.h(ex, -ez);
  }

  // ------------------------------------------------------------ density scan
  function scan() {
    const cells = st.cells; cells.clear();
    const near = st.near; near.length = 0;
    const [ex, ey] = st.ear, R2 = 90 * 90;
    const counts = [0, 0], cx = [0, 0], cy = [0, 0];
    let fighters = 0;
    const walls = !!(w.castles?.length && w.castleLevelH);
    for (let i = 0; i < S.n; i++) {
      if (!S.alive[i] || S.arm[i] === 0) continue; // villagers are not the army
      const s = S.state[i], x = S.x[i], y = S.y[i], tm = S.team[i];
      if (tm < 2) { counts[tm]++; cx[tm] += x; cy[tm] += y; }
      let kind = null;
      if (s === S_FIGHT) { kind = "fight"; fighters++; const dx = x - ex, dy = y - ey; if (dx * dx + dy * dy < R2 && near.length < 400) near.push(i); }
      else if (s === S_FLEE) kind = "flee";
      else if (s === S_MOVE) {
        const v = Math.hypot(S.vx[i], S.vy[i]);
        if (S.horseOK[i] === 1) kind = v > 5.5 ? "gallop" : v > 1 ? "trot" : null;
        else kind = v > 0.4 ? "march" : null;
      }
      if (!kind) continue;
      let h = 0;
      if (walls && kind === "march") { const dx = x - ex, dy = y - ey; if (dx * dx + dy * dy < 4 * R2 && (h = w.castleLevelH(i)) > 2) kind = "wall"; } // on the wall-walk: steps on stone
      const k = cellKey(x, y); let c = cells.get(k);
      if (!c) cells.set(k, c = {});
      const a = c[kind] || (c[kind] = { n: 0, x: 0, y: 0, h: 0 });
      a.n++; a.x += x; a.y += y; a.h += h;
    }
    st.fighters = fighters; st.counts = counts;
    for (let t = 0; t < 2; t++) { st.cent[t] = counts[t] ? [cx[t] / counts[t], cy[t] / counts[t]] : null; if (st.phase === "battle") st.peak[t] = Math.max(st.peak[t], counts[t]); }
    // contact age per cell (surge → grind): when the fighting there began, forgotten after 10 s without any
    for (const [k, c] of cells) if (c.fight) { if (!st.fightStart.has(k)) st.fightStart.set(k, st.t); st.lastFight.set(k, st.t); }
    for (const [k, t1] of st.lastFight) if (st.t - t1 > 10) { st.lastFight.delete(k); st.fightStart.delete(k); }
  }

  // candidates for one bed: [{x,y,z,level,r}] sorted by how loud they would arrive
  function targets(kind, nref, extra) {
    const out = [];
    for (const [k, c] of st.cells) {
      const a = c[kind]; if (!a) continue;
      const x = a.x / a.n, y = a.y / a.n; const [X, Y, Z] = P(x, y, 1.2);
      let level = Math.min(2.5, Math.sqrt(a.n / nref));
      if (extra) level *= extra(k, a, x, y);
      if (level < 0.01) continue;
      const r = Math.min(40, 6 + 2.5 * Math.sqrt(a.n));
      out.push({ x: X, y: Y, z: Z, level, r, loud: level / Math.max(r, eng.dist(X, Y, Z)), sx: x, sy: y, k });
    }
    return out.sort((a, b) => b.loud - a.loud);
  }
  const surgeOf = (k) => { const t0 = st.fightStart.get(k) ?? st.t, ts = st.surgeAt.get(k) ?? -1e9; return Math.max(Math.exp(-(st.t - t0) / 25), Math.exp(-(st.t - ts) / 8)); };
  const farOf = (x, y) => { const [a, b, c] = P(x, y); return clamp((eng.dist(a, b, c) - 60) / 160, 0, 1); };

  function driveBeds(dt) {
    // mêlée: surge / grind crossfade by contact age; the far roar takes over as the ear rises
    const fights = targets("fight", NREF.fight);
    eng.drive("bed_surge", fights.map((t) => ({ ...t, level: t.level * Math.sqrt(surgeOf(t.k)) * (1 - 0.6 * farOf(t.sx, t.sy)) })).filter((t) => t.level > 0.01), dt);
    eng.drive("bed_grind", fights.map((t) => ({ ...t, level: t.level * Math.sqrt(1 - 0.85 * surgeOf(t.k)) * (1 - 0.6 * farOf(t.sx, t.sy)) })).filter((t) => t.level > 0.01), dt);
    eng.drive("bed_roar", fights.map((t) => ({ ...t, level: t.level * (0.25 + 0.75 * farOf(t.sx, t.sy)) * (0.6 + 0.4 * surgeOf(t.k)) })), dt);
    eng.drive("bed_march", targets("march", NREF.march), dt);
    eng.drive("bed_trot", targets("trot", NREF.trot), dt);
    eng.drive("bed_gallop", targets("gallop", NREF.gallop), dt);
    eng.drive("bed_rout", targets("flee", NREF.flee), dt);
    // arrows landing: decayed count of shafts per cell (τ 1.5 s ⇒ n ≈ 1.5 × rate)
    const arr = [];
    for (const [k, a] of st.arrows) {
      a.n *= Math.exp(-dt / 1.5); if (a.n < 0.05) { st.arrows.delete(k); continue; }
      const [X, Y, Z] = P(a.x, a.y, 1); const level = Math.min(2.2, Math.sqrt(a.n / 1.5 / NREF.arrows));
      arr.push({ x: X, y: Y, z: Z, level, r: 20, loud: level / Math.max(20, eng.dist(X, Y, Z)) });
    }
    eng.drive("bed_arrows", arr.sort((a, b) => b.loud - a.loud), dt);
    // fire: burning buildings and engines
    const fires = [];
    for (const b of w.buildings || []) if (b.gfire > 0 && !(b.fire > 0)) { const [X, Y, Z] = P(b.x, b.y, 2); const lv = Math.min(1.5, b.gfire * 1.5); fires.push({ x: X, y: Y, z: Z, level: lv, r: 4, loud: lv / Math.max(4, eng.dist(X, Y, Z)) }); } // a gate fired
    for (const b of w.buildings || []) if (b.fire > 0) { const [X, Y, Z] = P(b.x, b.y, 2); const lv = Math.min(2, b.fire * Math.sqrt((b.w || 8) * (b.h || 8)) / 8); fires.push({ x: X, y: Y, z: Z, level: lv, r: 6, loud: lv / Math.max(6, eng.dist(X, Y, Z)) }); }
    for (const e of w.siege?.engines || []) if (e.fire > 0) { const [X, Y, Z] = P(e.x, e.y, 2); fires.push({ x: X, y: Y, z: Z, level: Math.min(1.5, e.fire), r: 4, loud: e.fire / Math.max(4, eng.dist(X, Y, Z)) }); }
    eng.drive("bed_fire", fires.sort((a, b) => b.loud - a.loud), dt);
    // aftermath: where many fell and the fighting has stopped
    const aft = [];
    for (const [k, a] of st.dead) {
      a.n *= Math.exp(-dt / 240); if (a.n < 0.3) { st.dead.delete(k); continue; }
      if (st.cells.get(k)?.fight) continue;
      const [X, Y, Z] = P(a.x / a.c, a.y / a.c, 0.5); const level = Math.min(1.5, Math.sqrt(a.n / NREF.dead)) * (st.fighters > 40 ? 0.3 : 1);
      aft.push({ x: X, y: Y, z: Z, level, r: 25, loud: level / Math.max(25, eng.dist(X, Y, Z)) });
    }
    eng.drive("bed_after", aft.sort((a, b) => b.loud - a.loud), dt);
  }

  // ------------------------------------------------------------ single blows near the ear
  function melee(dt) {
    const near = st.near; if (!near.length || st.t - st.sig.blow < 5) return; // real 'blow' events drive it when the sim sends them
    st.meleeAcc += dt * Math.min(14, near.length * 0.12);
    while (st.meleeAcc >= 1) {
      st.meleeAcc -= 1 + (rnd() - 0.5) * 0.6;
      const i = near[(rnd() * near.length) | 0]; if (!S.alive[i]) continue;
      if (hear("clash", S.x[i], S.y[i]) < 0.004) continue;
      const A = ARM_BY_ID[S.arm[i]] || {}, g = A.glyph;
      const k = cellKey(S.x[i], S.y[i]), surge = surgeOf(k);
      const snd = g === "spear" || g === "pike" ? pickW([["shaft", 3], ["shield", 3], ["clash", 1.5], ["bash", 1.5], ["body", 1]])
        : A.mounted ? pickW([["clash", 3], ["shield", 2], ["body", 1.5], ["plate", 1], ["mail", 1]])
          : (A.armour || 0) >= 3 ? pickW([["clash", 4], ["plate", 2], ["shield", 2], ["body", 1], ["mail", 1]])
            : pickW([["clash", 3], ["shield", 3], ["bash", 1], ["body", 1.5], ["mail", 0.5]]);
      const W = siege.where(i), ro = W.room ? { room: W.room, roomSend: 0.45 } : {};
      play(snd, S.x[i] + (rnd() - 0.5) * 1.5, S.y[i] + (rnd() - 0.5) * 1.5, ro, 1.3 + W.h);
      if (rnd() < 0.18 + 0.1 * (1 - surge)) later(0.05 + rnd() * 0.1, () => play("grunt", S.x[i], S.y[i], {}, 1.6)); // the grind: grunts, not cries
      if (rnd() < 0.06 * surge) play("shout", S.x[i], S.y[i], {}, 1.6);
    }
  }

  // ------------------------------------------------------------ missiles and engines (polled)
  function missiles() {
    const cs = w.cs; if (!cs) return;
    const shot = cs.stats.arrows, F = cs.flights, fresh = Math.min(F.length, Math.max(0, shot - st.lastArrows));
    st.lastArrows = shot;
    if (fresh > 0) {
      const byUnit = new Map();
      for (let k = F.length - fresh; k < F.length; k++) {
        const f = F[k]; if (f.key === "springald") continue;
        const u = f.by >= 0 ? S.unit[f.by] : -1; let g = byUnit.get(u); if (!g) byUnit.set(u, g = []); g.push(f);
        // where it will land: feeds the arrow-storm bed, and close to the ear a single impact + the hiss before it
        const kk = cellKey(f.x, f.y); let a = st.arrows.get(kk); if (!a) st.arrows.set(kk, a = { n: 0, x: f.x, y: f.y });
        a.n += 1; a.x += (f.x - a.x) * 0.2; a.y += (f.y - a.y) * 0.2;
        const eta = Math.max(0, f.tI - w.time); // battle clock runs at real time (clock.BATTLE_RATE = 1)
        if (st.t - st.sig.arrow > 5 && hear("arr_ground", f.x, f.y) > 0.02 && (st.arrowBudget = Math.min(5, (st.arrowBudget ?? 5))) >= 1) {
          st.arrowBudget--; // at most ~5 single shafts a second; the storm bed carries the rest // (until the sim reports where each shaft ended)
          const snd = pickW([["arr_ground", 6], ["arr_shield", 2.5], ["arr_armour", 1.5]]);
          later(eta, () => play(snd, f.x, f.y, {}, 0.8));
          if (rnd() < 0.35) later(Math.max(0, eta - 0.28), () => play("whoosh", f.x - f.ux * 6, f.y - f.uy * 6, {}, 2.5));
        }
      }
      // a company's loose: its shots over the last second. Four or more a second from one body = a volley
      // (the massed thrum, throttled); otherwise single strings, and only where the ear is close to the bow.
      for (const [u, list] of byUnit) {
        const f0 = list[0], i = f0.by, sx = i >= 0 ? S.x[i] : f0.x, sy = i >= 0 ? S.y[i] : f0.y, xb = f0.key === "crossbow";
        let r = st.loose.get(u); if (!r) st.loose.set(u, r = { n: 0, t: st.t }); r.n = r.n * Math.exp(-(st.t - r.t) / 1) + list.length; r.t = st.t;
        if (r.n >= 4 && st.t - st.sig.volley > 10) { if (once("volley" + u, 2.5)) play(xb ? "xvolley" : "volley", sx, sy, {}, 1.5); continue; }
        let k = 0;
        for (const f of list) if (f.by >= 0 && k < 2 && hear(xb ? "xbow" : "bow", S.x[f.by], S.y[f.by]) > 0.03) {
          k++; play(xb ? "xbow" : "bow", S.x[f.by], S.y[f.by], {}, 1.4);
          if (xb && rnd() < 0.5) later(0.6 + rnd(), () => play("windlass", S.x[f.by], S.y[f.by], {}, 1.2)); // spanning again
        }
      }
      if (st.loose.size > 200) for (const [u, r] of st.loose) if (st.t - r.t > 5) st.loose.delete(u);
    }
    const Z = w.siege; if (!Z) return;
    for (const s of Z.shots) {
      if (st.seenShot.has(s)) continue; st.seenShot.add(s);
      siege.shot(s);
      if (s.kind === "bolt") { play("springald", s.x0, s.y0, {}, 1.5); continue; }
      const e = Z.engines.find((q) => q.id === s.by);
      play(e?.kind === "mangonel" ? "mangonel" : "trebuchet", s.x0, s.y0, e?.kind === "trebuchet" || s.big ? { delay: 0 } : {}, 2);
    }
    for (const im of Z.impacts) {
      if (st.seenImpact.has(im)) continue; st.seenImpact.add(im);
      if (w.time - im.t > 1) continue;
      const snd = im.kind === "dust" ? "stone_ground" : im.kind === "debris" ? "stone_wall" : im.kind === "splinter" ? "ram" : "splinter";
      play(snd, im.x, im.y, { gain: im.size > 1.5 ? 2 : 0 }, 1);
    }
  }

  // ------------------------------------------------------------ orders: horn calls, shouted orders
  function orders() {
    const C = w.command; if (!C?.pending) return;
    const sent = new Map();
    for (const [id, p] of C.pending) {
      if (st.seenP.has(p)) continue; st.seenP.add(p);
      const u = w.units.get(id); if (!u || u.isWorkers) continue;
      if (!sent.has(u.team)) sent.set(u.team, [p, u]);
    }
    for (const [team, [p, u]] of sent) {
      const at = hq(team) || unitPos(u);
      if (!once("order" + team, 1.2)) continue;
      const call = p.o.pace === "charge" ? "charge" : CALL[p.o.kind] || "advance";
      if (p.channel === "horn") play(`horn_${call}_${teamName(team)}`, at[0], at[1], {}, 3);
      else if (p.channel === "voice") play("shout", at[0], at[1], {}, 1.7);
      else { play("snort", at[0], at[1], {}, 1.5); later(0.4, () => play("shout", at[0], at[1], {}, 1.7)); } // a rider sent off
    }
  }

  // ------------------------------------------------------------ events
  function events() {
    for (const e of queue) {
      if (siege.event(e)) continue;
      switch (e.kind) {
        case "kill": case "down": {
          const d = e.victim, x = S.x[d], y = S.y[d];
          const k = cellKey(x, y); let a = st.dead.get(k); if (!a) st.dead.set(k, a = { n: 0, x: 0, y: 0, c: 0 }); a.n++; a.x += x; a.y += y; a.c++;
          if (hear("body", x, y) < 0.004) break;
          const W = siege.where(d), ro = W.room ? { room: W.room, roomSend: 0.45 } : {};
          if (e.cause === "missile") { play("arr_flesh", x, y, ro, 1.3 + W.h); if (rnd() < 0.45) later(0.08, () => play("cry", x, y, ro, 1.5 + W.h)); }
          else if (e.cause === "fall") { play("body", x, y, { gain: 4 }, 0.3); if (rnd() < 0.7) play("cry", x, y, {}, 2 + W.h); } // off a ladder or the wall
          else if (e.cause !== "stone" && e.cause !== "mine") {
            play("body", x, y, ro, 1.2 + W.h);
            const surge = surgeOf(k);
            if (rnd() < (e.kind === "kill" ? 0.12 + 0.3 * surge : 0.3)) later(0.06, () => play(e.kind === "kill" && rnd() < 0.6 ? "cry" : "groan", x, y, ro, 1.2 + W.h));
          }
          break;
        }
        // --- per-blow / per-shaft signals (docs/anim-sim-signals.md): exact sounds where the sim says what happened
        case "blow": {
          st.sig.blow = st.t; if (w.avatar && e.a === w.avatar.lord) break; // the lord's own come as hg-sound
          const d = e.d, x = S.x[d], y = S.y[d]; if (!(d >= 0) || hear("clash", x, y) < 0.004) break;
          const A = ARM_BY_ID[S.arm[e.a]] || {}, pole = A.glyph === "spear" || A.glyph === "pike";
          const snd = e.res < 0 ? "bash" : e.res === 0 ? (pole ? "shaft" : "clash") : e.res === 1 ? "shield" : e.res === 2 ? (S.armour[d] >= 3 ? "plate" : "mail") : e.res >= 5 ? "crunch" : "body";
          const W = siege.where(d), ro = W.room ? { room: W.room, roomSend: 0.45 } : {}; // on the wall-walk up there; in the gate passage, its echo
          play(snd, x, y, ro, 1.3 + W.h);
          if (e.res >= 3 && rnd() < 0.35) later(0.05, () => play("grunt", x, y, ro, 1.6 + W.h));
          break;
        }
        case "arrow": {
          st.sig.arrow = st.t; if (hear("arr_ground", e.x, e.y) < 0.004) break;
          const snd = { shield: "arr_shield", pavise: "arr_shield", cover: "arr_shield", armour: "arr_armour", body: "arr_flesh", horse: "arr_flesh" }[e.on] || "arr_ground";
          play(snd, e.x, e.y, {}, 0.9);
          if (e.on === "horse" && rnd() < 0.3) later(0.1, () => play("horse_scream", e.x, e.y, {}, 1.8)); // the sound men remembered
          break;
        }
        case "volley": { st.sig.volley = st.t; const u = w.units.get(e.unit); if (u && once("volley" + u.id, 2)) play(ARMS[u.arm]?.missile === "crossbow" ? "xvolley" : "volley", u.ax, u.ay, {}, 1.5); break; }
        case "knock": { const i = e.who; if (hear("body", S.x[i], S.y[i]) > 0.004) { play("body", S.x[i], S.y[i], {}, 0.5); if (rnd() < 0.5) play("grunt", S.x[i], S.y[i], { delay: 0.05 }, 0.8); } break; }
        case "shove": { const i = e.d; if (hear("bash", S.x[i], S.y[i]) > 0.004 && rnd() < 0.5) play("bash", S.x[i], S.y[i], {}, 1.3); break; }
        case "stoned": { if (e.first) play("crunch", e.x, e.y, {}, 1); break; }
        case "lord-takes-field": { play(`horn_advance_${teamName(e.team)}`, e.x, e.y, {}, 3); later(1.8, () => play(`warcry_${teamName(e.team)}`, e.x, e.y, {}, 1.7)); break; }
        case "horse": { const i = e.who; if (e.what === "down") play("horse_scream", S.x[i], S.y[i], {}, 1.8); else if (once("bolt" + S.unit[i], 3)) play("whinny", S.x[i], S.y[i], {}, 1.8); break; }
        case "refuse": { const i = e.who; if (w.avatar && i === w.avatar.lord) break; if (rnd() < 0.3 && once("refuse" + S.unit[i], 2)) play("whinny", S.x[i], S.y[i], {}, 1.8); break; }
        case "impact": {
          if (w.avatar && e.who === w.avatar.lord) break; // his lance: hg-sound "lance-shatter"
          const i = e.who, x = S.x[i], y = S.y[i]; st.surgeAt.set(cellKey(x, y), st.t);
          if (once("imp" + S.unit[i], 1.5)) play("cav_impact", x, y, {}, 1.4);
          break;
        }
        case "shock": {
          const u = w.units.get(e.unit), v = w.units.get(e.on); if (!u) break;
          const x = v ? (u.ax + v.ax) / 2 : u.ax, y = v ? (u.ay + v.ay) / 2 : u.ay; st.surgeAt.set(cellKey(x, y), st.t);
          if (!once("shock" + u.id, 3)) break;
          if (ARMS[u.arm]?.mounted) play("cav_impact", x, y, {}, 1.4);
          else { play("bash", x, y, {}, 1.3); later(0.04, () => play("shield", x + 2, y, {}, 1.3)); later(0.09, () => play("bash", x - 2, y + 1, {}, 1.3)); later(0.15, () => play("body", x, y - 1, {}, 1.2)); }
          if (once("cry" + u.id, 20)) play(`warcry_${teamName(u.team)}`, u.ax, u.ay, {}, 1.7);
          break;
        }
        case "unit-break": {
          const u = w.units.get(e.unit); if (!u) break;
          play("rout_cry", u.ax, u.ay, {}, 1.6);
          if (u.members.length >= 20) { if (u.team === player) cue("cue_rout"); else if (rnd() < 0.5) play(`horn_retire_${teamName(u.team)}`, ...(hq(u.team) || [u.ax, u.ay]), {}, 3); }
          break;
        }
        case "unit-rallied": { const u = w.units.get(e.unit); if (!u) break; const at = hq(u.team) || [u.ax, u.ay]; play(`horn_rally_${teamName(u.team)}`, at[0], at[1], {}, 3); later(1.5, () => play(`warcry_${teamName(u.team)}`, u.ax, u.ay, {}, 1.7)); break; }
        case "order-arrived": { const u = w.units.get(e.unit); if (!u || u.isWorkers) break; if (once("ack" + e.unit, 4)) play("shout", u.ax, u.ay, {}, 1.7); break; } // the captain repeats it
        case "legend": { const i = e.who; if (S.alive[i]) play(`warcry_${teamName(S.team[i])}`, S.x[i], S.y[i], {}, 1.7); break; } // "cries rise … when a banner is raised again"
        case "engine-ready": { const E = w.siege?.engines.find((q) => q.id === e.engine); if (E) { play("creak", E.x, E.y, {}, 2); later(0.4, () => play("shout", E.x, E.y, {}, 1.7)); } break; }
        case "engine-destroyed": { const E = w.siege?.engines.find((q) => q.id === e.engine); if (E) { play("collapse", E.x, E.y, {}, 2); } break; }
        case "engine-fired": { const E = w.siege?.engines.find((q) => q.id === e.engine); if (E) play("ignite", E.x, E.y, {}, 2); break; }
        case "engine-captured": { const E = w.siege?.engines.find((q) => q.id === e.engine); if (E) play(`warcry_${teamName(e.team)}`, E.x, E.y, {}, 1.7); break; }
        case "tower-docked": play("tower_dock", e.x, e.y, {}, 6); later(1.2, () => play(`warcry_${teamName(e.team)}`, e.x, e.y, {}, 5)); break;
        case "gate-broken": case "gate-opened": { const b = (w.buildings || []).find((q) => q.id === e.building); if (b) { play(e.kind === "gate-broken" ? "gate_break" : "creak", b.x, b.y, { gain: e.kind === "gate-opened" ? 6 : 0 }, 3); later(1.0, () => play(`warcry_${teamName(e.by ?? (1 - b.team))}`, b.x, b.y, {}, 2)); } break; }
        case "escalade": { const u = w.units.get(e.unit); if (u) for (let k = 0; k < Math.min(4, e.ladders || 1); k++) later(k * 0.35, () => play("ladder", u.ax + (rnd() - 0.5) * 20, u.ay + (rnd() - 0.5) * 20, {}, 3)); break; }
        case "escalade-lodged": { const u = w.units.get(e.unit); if (u) play(`warcry_${teamName(u.team)}`, u.ax, u.ay, {}, 5); break; }
        case "escalade-failed": { const u = w.units.get(e.unit); if (u) play("rout_cry", u.ax, u.ay, {}, 2); break; }
        case "building-lost": { const b = (w.buildings || []).find((q) => q.id === e.building); if (b) play("collapse", b.x, b.y, {}, 2); break; }
        case "fire": case "field-fired": { const b = (w.buildings || []).find((q) => q.id === e.building); if (b) play("ignite", b.x, b.y, {}, 2); break; }
        case "siege-begins": { const c = st.cent[1 - e.team]; if (c) play("horns_massed", c[0], c[1], {}, 3); break; }
        case "town-fell": cue(e.team === player ? "cue_defeat" : "cue_victory"); break;
        default:
          if (typeof e.kind === "string" && e.kind.startsWith("decisive")) { // the combat engineer's "decisive moment" events
            const team = e.team ?? (e.unit !== undefined ? w.units.get(e.unit)?.team : undefined) ?? player;
            const at = e.x !== undefined ? [e.x, e.y] : hq(team) || st.cent[team];
            if (at) play(`horn_charge_${teamName(team)}`, at[0], at[1], {}, 3);
            cue("cue_charge");
          }
      }
    }
    queue.length = 0;
  }

  // ------------------------------------------------------------ charges, approach, battle arc
  function arc(dt) {
    for (const u of w.units.values()) {
      if (u.isWorkers || u.members.length < 8) continue;
      const prev = st.pace.get(u.id); st.pace.set(u.id, u.pace);
      if (u.pace === "charge" && prev && prev !== "charge" && once("charge" + u.id, 25)) {
        play(`warcry_${teamName(u.team)}`, u.ax, u.ay, {}, 1.7); // the cry goes up as they go in
        if (ARMS[u.arm]?.mounted && u.team === player) cue("cue_charge");
      }
    }
    if (st.pace.size > 4 * w.units.size + 50) for (const id of st.pace.keys()) if (!w.units.has(id)) st.pace.delete(id);
    const [a, b] = st.cent, big = st.counts[0] >= 30 && st.counts[1] >= 30;
    if (st.phase !== "battle") {
      if (st.fighters >= 15 && big) { st.phase = "battle"; st.peak = st.counts.slice(); cue("cue_battle"); }
      else if (big && a && b) { // the approach: massed horns in bouts, silence, again — louder as the range closes
        const D = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (D < 1100) for (let t = 0; t < 2; t++) {
          if (st.t < st.nextBout[t]) continue;
          st.nextBout[t] = st.t + 20 + rnd() * 20;
          if (st.nextBout[1 - t] < st.t + 6) st.nextBout[1 - t] = st.t + 6 + rnd() * 8; // they answer, not in chorus
          const c = st.cent[t]; play("horns_massed", c[0], c[1], { gain: clamp((1100 - D) / 800, 0, 1) * 6 - 6 }, 4);
        }
      }
    } else {
      if (st.fighters < 3) st.quietT += dt; else st.quietT = 0;
      for (let t = 0; t < 2; t++) {
        const lost = st.peak[t] > 0 && st.counts[t] < 0.3 * st.peak[t], held = st.counts[1 - t] >= 0.4 * st.peak[1 - t];
        if (lost && held) { // the field is decided: victors cheer and sound the rally
          st.phase = "over";
          cue(t === player ? "cue_defeat" : "cue_victory");
          const c = st.cent[1 - t]; if (c) { play(`warcry_${teamName(1 - t)}`, c[0], c[1], {}, 2); later(2.5, () => play(`horn_rally_${teamName(1 - t)}`, c[0], c[1], {}, 3)); }
          break;
        }
      }
      if (st.phase === "battle" && st.quietT > 90) st.phase = "peace";
    }
    if (st.phase === "over" && st.fighters > 30) st.phase = "battle";
    if (st.phase === "over" && !big) st.phase = "peace";
  }

  // ------------------------------------------------------------ ambience: wind, birds, the village
  function ambience(dt) {
    if (!st.wind) { st.wind = eng.bed("bed_wind", "amb"); if (!st.wind) return; }
    const hN = clamp((st.earH - 10) / 300, 0, 1), c = eng.ctx, t = c.currentTime;
    const storm = /storm|rain|wind/.test(w.weather || "") ? 1.8 : 1;
    st.wind.gain.gain.setTargetAtTime(0.2 * (0.45 + 0.8 * hN) * storm, t, 0.5); // higher up, windier
    st.wind.lp.frequency.setTargetAtTime(1800 + 9000 * hN, t, 0.5);
    const [ex, ey] = st.ear, battleNear = clamp(st.fighters / 60, 0, 1);
    if ((st.birdT -= dt) <= 0) { // birds fall silent when men fight nearby; crows come after
      st.birdT = 1.5 + rnd() * 5;
      const a = rnd() * 6.283, r = 25 + rnd() * 130, x = ex + Math.cos(a) * r, y = ey + Math.sin(a) * r;
      const crows = clamp([...st.dead.values()].reduce((s, q) => s + q.n, 0) / 60, 0, 0.8);
      if (!w.night && rnd() > battleNear * 0.9) {
        const sp = rnd() < crows ? "crow" : pickW([["skylark", 3], ["blackbird", 3], ["chaffinch", 3], ["cuckoo", 0.6], ["crow", 1]]);
        play(sp, x, y, { bus: "amb", send: 0.25 }, sp === "skylark" ? 30 : 8);
      }
    }
    if ((st.villageT -= dt) <= 0) {
      st.villageT = 0.8 + rnd() * 1.6;
      const B = w.buildings || []; if (!B.length) return;
      const b = B[(rnd() * B.length) | 0];
      if (!b || b.fire > 0 || (b.progress !== undefined && b.progress < 1) || Math.hypot(b.x - ex, b.y - ey) > 380 || battleNear > 0.5) return;
      const snd = { blacksmith: [["anvil", 0.5]], lumber_camp: [["axe", 0.6]], stables: [["snort", 0.15], ["whinny", 0.06]], paddock: [["cow", 0.08], ["sheep", 0.12], ["whinny", 0.04]],
        house: [["dog", 0.03]], mill: [["creak", 0.2]], granary: [["dog", 0.02]], siege_workshop: [["axe", 0.3], ["creak", 0.15]], barracks: [["shout", 0.04]] }[b.kind];
      if (snd) for (const [name, p] of snd) if (rnd() < p) { play(name, b.x + (rnd() - 0.5) * 6, b.y + (rnd() - 0.5) * 6, { bus: "amb", send: 0.3 }, 1.5); break; }
    }
    if ((st.bellT -= dt) <= 0) { // the parish bell tolls the hours (and in the grind of a siege, the alarm)
      st.bellT = 150 + rnd() * 120;
      const tpl = (w.buildings || []).find((b) => b.kind === "temple" && Math.hypot(b.x - ex, b.y - ey) < 900);
      if (tpl) for (let k = 0; k < 3; k++) later(k * 2.6, () => play("bell", tpl.x, tpl.y, { bus: "amb", send: 0.5 }, 18));
    }
  }

  // ------------------------------------------------------------ the lord (commander avatar, js/ui/avatar-ui.js)
  // He is the player: his blows, his voice, his horse are heard close and never lose a voice to the crowd.
  // avatar-ui dispatches window CustomEvent "hg-sound" { kind, x?, y?, ... } for everything he does or suffers.
  const lordQ = [];
  const onLord = (e) => { if (lordQ.length < 64) lordQ.push(e.detail || {}); };
  if (typeof addEventListener === "function") addEventListener("hg-sound", onLord);
  const LORD_CALL = { follow: "advance", charge: "charge", hold: "hold", rally: "rally", line: "hold", wedge: "advance", retire: "retire" };
  function lord(dt) {
    const A = w.avatar, L = A && !A.outcome && S.alive[A.lord] ? A.lord : -1;
    const lp = () => (L >= 0 ? [S.x[L], S.y[L]] : st.ear.slice(0, 2));
    const team = A?.team ?? player, tn = teamName(team);
    for (const d of lordQ) {
      const [x, y] = d.x !== undefined ? [d.x, d.y] : lp();
      const o = { priority: 1, hrtf: true }, P2 = (n, dl = 0, up = 1.6, g = 0) => play(n, x, y, { ...o, delay: dl, gain: g }, up);
      switch (d.kind) {
        case "strike-whiff": P2("swing"); break;
        case "strike-hit": P2("swing"); P2((d.sev ?? 2) >= 3 ? "crunch" : pickW([["body", 2], ["plate", 1], ["mail", 1]]), 0.1, 1.4); if (rnd() < 0.5) P2("lord_grunt", 0.02); break;
        case "strike-kill": P2("swing"); P2("crunch", 0.1, 1.4, 2); P2("lord_grunt", 0.02); later(0.2, () => play("cry", x + 1, y, {}, 1.4)); break;
        case "strike-glance": P2("swing"); P2(rnd() < 0.5 ? "plate" : "mail", 0.1, 1.4); break;
        case "strike-shield": P2("swing"); P2("shield", 0.1, 1.4); break;
        case "strike-parried": P2("swing"); P2("clash", 0.09, 1.5, 2); break;
        case "hurt": P2((d.sev ?? 1) >= 3 ? "lord_cry" : "lord_grunt"); P2("body", 0, 1.3); break;
        case "horse-scream": P2("horse_scream", 0, 1.8, 2); break;
        case "horse-refuse": P2("whinny", 0, 1.8, 2); P2("snort", 0.6, 1.8); P2("lord_shout", 0.3); break;
        case "lance-shatter": P2("splinter", 0, 1.8, 3); P2("cav_impact", 0.02, 1.4, 2); P2("lord_grunt", 0.05); break;
        case "couch": P2("couch", 0, 1.9); break;
        case "order-shout": P2("lord_shout"); break;
        case "warcry": P2("lord_shout"); P2(`warcry_${tn}`, 0.35, 1.7, 2); break; // his cry, and his men taking it up
        case "horn": { const at = d.x !== undefined ? [x, y] : hq(team) || lp(); play(`horn_${LORD_CALL[d.order] || "advance"}_${tn}`, at[0], at[1], { priority: 2 }, 3); break; }
        case "banner-down": case "banner-lost": P2("rout_cry", 0.2, 1.6, -4); if (st.t - st.cueT > 20 && d.kind === "banner-lost") cue("cue_rout"); break;
        case "lord-falls": P2("lord_cry"); P2("crunch", 0, 1.2); P2("body", 0.4, 0.4); cue("cue_defeat"); break;
        default: if (eng.has(d.kind)) P2(d.kind); // anything else the avatar layer names directly
      }
    }
    lordQ.length = 0;
    // his own horse under him (or his steps): one emitter that follows him, pace by speed
    const tg = { lord_gallop: [], lord_canter: [], lord_trot: [], lord_steps: [] };
    if (L >= 0 && A.embodied !== false) {
      const v = A.speed ?? Math.hypot(S.vx[L], S.vy[L]), [X, Y, Z] = P(S.x[L], S.y[L], 0.6);
      const mounted = S.horseOK[L] === 1 && !A.dismounted;
      const k = mounted ? (v > 8 ? "lord_gallop" : v > 4.5 ? "lord_canter" : v > 1.2 ? "lord_trot" : null) : v > 0.5 ? "lord_steps" : null;
      if (k) tg[k].push({ x: X, y: Y, z: Z, level: 1, r: 1, rate: k === "lord_gallop" ? clamp(v / 11, 0.85, 1.15) : k === "lord_steps" ? clamp(v / 1.4, 0.8, 1.6) : 1 });
    }
    for (const k in tg) eng.drive(k, tg[k], dt);
  }

  let wasHidden = false;
  return {
    update(dt) {
      if (!eng.ready || !eng.ctx) { queue.length = 0; lordQ.length = 0; return; }
      if (w.systems[w.systems.length - 1] !== tap) { const k = w.systems.indexOf(tap); if (k >= 0) w.systems.splice(k, 1); w.systems.push(tap); } // read events after every system
      dt = Math.min(dt, 0.25); st.t += dt; st.arrowBudget = Math.min(5, (st.arrowBudget ?? 5) + dt * 5);
      const hidden = typeof document !== "undefined" && document.hidden;
      if (hidden !== wasHidden) { wasHidden = hidden; if (!eng.offline) hidden ? eng.ctx.suspend().catch(() => { }) : !eng.settings.muted && eng.ctx.resume().catch(() => { }); }
      updateEar();
      if ((st.scanT -= dt) <= 0) { st.scanT = SCAN; scan(); }
      events(); missiles(); orders(); melee(dt); arc(dt); lord(dt);
      for (let k = st.sched.length - 1; k >= 0; k--) if (st.sched[k][0] <= st.t) { const f = st.sched[k][1]; st.sched.splice(k, 1); f(); }
      if (st.sched.length > 400) st.sched.splice(0, st.sched.length - 400);
      driveBeds(dt); siege.update(dt); ambience(dt);
    },
    state: st, siege,
    inject: (e) => { if (queue.length < 4000) queue.push(e); }, // (tools/audio-siege.mjs: play a sim event through the real handlers)
  };
}
