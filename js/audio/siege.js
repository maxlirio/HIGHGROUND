// Castles and sieges as heard (docs/siege-audio.md). Driven by js/audio/battle.js, which hands every sim event to
// event() first, every new engine shot to shot(), and calls update(dt) once a frame. Reads:
//  * SIEGE-MECH's events (js/sim/siege.js, siege-works.js; castle-plan §4.1): wall-state, wall-breached,
//    tower-collapsed, mine-fired / mine-collapse / mine-fight, portcullis-dropped / -raised / -broken,
//    gate-leaves-broken, gate-fired, dropped (stones and sand from the hoardings), ladder-pushed, stoned, sally, surrender;
//  * the siege state it polls: engines moving (the belfry's timbers and wheels), mines being dug (picks in the ground),
//    w.siegeWar (SIEGE-MODE: the camp while days pass, the assault's trumpets, the fight reaching the bailey / the keep);
//  * castles (w.castles + CASTLE-RENDER's cut-away, js/render/castle.js): men on the wall-walks (steps on stone), blows
//    in the gate passage (its flutter echo), and the ENCLOSURE — the ear inside a tower, the keep or the passage hears
//    the room's reverb, and the battle outside comes muffled through the walls (engine.setEnclosure).
// All sounds are pre-rendered buffers (tools/audio/sfx_castle.py); beds are pooled looping emitters; one-shots go
// through the engine's voice pool and per-sound limits (bank.js), so a siege never costs more voices than a battle.
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const rnd = Math.random;
const ENTER = new Set(["tower", "gatehouse", "watergate", "keep", "hall", "chapel", "stable", "kitchen"]);
const GATE = new Set(["gatehouse", "watergate"]);

export function makeSiegeAudio(eng, w, map, B) {
  const { play, hear, later, once, st, teamName } = B;
  const S = w.S;
  for (const [name, K] of [["bed_belfry", 2], ["bed_mining", 2], ["bed_wallwalk", 3]]) eng.layer(name, K, { smooth: 0.3, release: 0.8 });
  const ss = { lastTime: w.time, engPos: new Map(), camp: null, campLvl: 0, daysBoost: 0, assaultOn: false, phase: null, encK: 0, encRoom: null, encT: 0, gate: [] };
  const lh = (i) => (i >= 0 && w.castleLevelH ? w.castleLevelH(i) || 0 : 0); // a man's height above the ground (wall-walk ~8 m)
  const bld = (id) => (w.buildings || []).find((b) => b.id === id);
  const posOf = (b) => (b ? [b.gx ?? b.x, b.gy ?? b.y] : null);

  // ---------------------------------------------------------------- castle geometry (lenient: raw sim parts or normalised)
  // (castle.js gives d for depth and h for HEIGHT; older layouts gave w × h as the footprint)
  function depthOf(p, W) { return p.d ?? p.len ?? (Array.isArray(p.floors) ? W : p.h ?? W); }
  function inPart(p, x, y, pad = 0) {
    if (p.shape === "round" || (p.kind === "tower" && p.shape !== "rect" && p.r && !p.w)) return Math.hypot(x - p.x, y - p.y) < (p.r || 5) + pad;
    const W = p.w ?? p.width ?? (p.r ? p.r * 2 : 10), D = depthOf(p, W), c = Math.cos(p.rot || 0), s = Math.sin(p.rot || 0);
    const dx = x - p.x, dy = y - p.y, a = dx * c + dy * s, b = -dx * s + dy * c;
    return Math.abs(a) < W / 2 + pad && Math.abs(b) < D / 2 + pad;
  }
  const halfSize = (p) => (p.r && !p.w ? p.r : Math.max(p.w ?? 10, depthOf(p, p.w ?? 10)) / 2);
  const topOf = (p) => { const f = p.floors; const last = Array.isArray(f) && f.length ? f[f.length - 1] : null; return typeof last === "number" ? last : (last?.h ?? (p.kind === "keep" ? 20 : p.kind === "gatehouse" ? 13 : 12)); };
  const walkOf = (p) => p.walkH ?? (Array.isArray(p.floors) && typeof p.floors[1] === "number" ? p.floors[1] : 8);
  function partAt(x, y, pad = 0) { for (const C of w.castles || []) for (const p of C.parts || []) if (ENTER.has(p.kind) && typeof p.x === "number" && inPart(p, x, y, pad)) return p; return null; }
  // is (x, y) in a gate passage (at ground level)? → the passage's flutter echo
  function inPassage(x, y) { for (const C of w.castles || []) for (const p of C.parts || []) if (GATE.has(p.kind) && typeof p.x === "number" && inPart(p, x, y, 0.5)) return true; return false; }

  // ---------------------------------------------------------------- the ear's enclosure (4 Hz)
  function enclosure(dt) {
    if (!w.castles?.length) { if (ss.encK > 0) { ss.encK = Math.max(0, ss.encK - dt * 3); eng.setEnclosure(ss.encK, ss.encRoom); } return; }
    if ((ss.encT -= dt) <= 0) {
      ss.encT = 0.25;
      const [ex, ey, eh] = st.ear, g = map.h(ex, ey), cam = B.camera, A = w.avatar;
      let want = 0, room = null, r = 12;
      // 1. the ear itself inside a part's walls, below its top (a low camera in a tower / the passage / the keep)
      const p = partAt(ex, ey, -0.3);
      if (p && eh - g < topOf(p) - 0.5) { want = 1; room = GATE.has(p.kind) && eh - g < walkOf(p) * 0.8 ? "passage" : "hall"; r = halfSize(p) + 2; }
      // 2. the lord's own view: he walks into it
      if (!want && A && cam?.st?.drive && A.lord >= 0 && S.alive[A.lord]) {
        const L = A.lord, q = partAt(S.x[L], S.y[L], -0.3);
        if (q && lh(L) < topOf(q) - 0.5) { want = 1; room = GATE.has(q.kind) && lh(L) < walkOf(q) * 0.8 ? "passage" : "hall"; r = halfSize(q) + 4; }
      }
      // 3. the cut-away (CASTLE-RENDER): zoomed in close, looking down into a storey — the room, a little less
      if (!want && cam?.st) {
        const cut = B.castles?.stats ? B.castles.stats().cut : null;
        const q = partAt(cam.st.tx, cam.st.ty, 1.5); // (the renderer's own pad for "looking into it")
        if (q && (!cut || cut.length) && cam.st.dist < 60) {
          want = 0.8 * clamp((60 - cam.st.dist) / 40, 0, 1); room = GATE.has(q.kind) && (cut?.[0] || "").endsWith("@0") ? "passage" : "hall";
          r = Math.hypot(q.x - ex, q.y - ey) + halfSize(q) + 2;
        }
      }
      ss.encWant = want; if (room) ss.encRoom = room; ss.encR = r;
    }
    const k0 = ss.encK; ss.encK += clamp((ss.encWant || 0) - ss.encK, -dt * 2.5, dt * 2.5);
    if (Math.abs(ss.encK - k0) > 1e-4 || ss.encK > 0) eng.setEnclosure(ss.encK, ss.encRoom, ss.encR || 12);
  }

  // ---------------------------------------------------------------- events
  function fall(key, x, y, snd, up, gain = 0) { if (once("fall" + key, 3)) play(snd, x, y, { gain }, up); }
  function event(e) {
    switch (e.kind) {
      case "wall-state":
        if (e.state === "cracked" && e.was !== "cracked") play("masonry_crack", e.x, e.y, {}, 4);
        return true;
      case "wall-breached":
        if (e.cause === "mine") later(0.4, () => fall(e.building + ":" + e.mod, e.x, e.y, "wall_collapse", 3, 2));
        else fall(e.building + ":" + e.mod, e.x, e.y, "wall_collapse", 3);
        later(2.5, () => play(`warcry_${teamName(e.by ?? 1 - (e.team ?? 1))}`, e.x, e.y, {}, 2));
        return true;
      case "tower-collapsed":
        fall("t" + e.building, e.x, e.y, "tower_collapse", 6);
        later(4, () => play(`warcry_${teamName(e.by ?? 1 - (e.team ?? 1))}`, e.x, e.y, {}, 2));
        return true;
      case "mine-fired": play("mine_fire", e.x, e.y, {}, -2); return true;
      case "mine-collapse":
        play("mine_collapse", e.x, e.y, {}, -2);
        if (e.full && e.tower) later(0.5, () => fall("t" + e.building, e.x, e.y, "tower_collapse", 6));
        else later(0.5, () => fall(e.building + ":" + e.mod, e.x, e.y, "wall_collapse", 3, 2));
        return true;
      case "countermine-broke-in": play("splinter", e.x, e.y, { muffle: 0.8 }, -2); play("stone_ground", e.x, e.y, { muffle: 0.9, gain: -6 }, -2); return true;
      case "mine-fight": // a fight in the dark under the ground: blows and cries, through the earth
        for (let k = 0; k < 6; k++) later(k * 0.35 + rnd() * 0.3, () => play(k % 3 === 2 ? "cry" : rnd() < 0.5 ? "clash" : "body", e.x + (rnd() - 0.5) * 3, e.y + (rnd() - 0.5) * 3, { muffle: 0.85, gain: 6 }, -2));
        return true;
      case "portcullis-dropped": case "portcullis-raised": {
        const drop = e.kind === "portcullis-dropped", b = bld(e.building), [x, y] = e.x !== undefined ? [e.x, e.y] : posOf(b) || [0, 0];
        play(drop ? "portcullis_drop" : "portcullis_raise", x, y, { room: "passage", roomSend: 0.6 }, 3);
        return true;
      }
      case "portcullis-broken": { const p = posOf(bld(e.building)); if (p && once("gate" + e.building, 1.5)) play("portcullis_break", p[0], p[1], { room: "passage", roomSend: 0.5 }, 2); return true; }
      case "gate-leaves-broken": { const p = posOf(bld(e.building)); if (p && once("gate" + e.building, 1.5)) play("leaves_break", p[0], p[1], { room: "passage", roomSend: 0.4 }, 2); return true; }
      case "gate-broken": { // (after leaves_break / portcullis_break this tick: only the cry)
        const b = bld(e.building); if (!b) return true;
        if (once("gate" + e.building, 1.5)) play("gate_break", b.x, b.y, {}, 3);
        later(1.0, () => play(`warcry_${teamName(e.by ?? 1 - b.team)}`, b.x, b.y, {}, 2));
        return true;
      }
      case "gate-fired": { const b = bld(e.building); if (b) play("ignite", b.x, b.y, { gain: 3 }, 2); return true; }
      case "dropped": { // from the hoardings / a murder hole onto the man below (the stone takes ~1 s to fall 7-9 m)
        const i = e.who; if (!(i >= 0) || !S.alive || hear("drop_stone", S.x[i], S.y[i]) < 0.004) return true;
        const x = S.x[i], y = S.y[i], sand = e.what === "sand", pass = e.cause === "murder-hole" && inPassage(x, y);
        later(0.25, () => play(sand ? "drop_sand" : "drop_stone", x, y, pass ? { room: "passage", roomSend: 0.5 } : {}, 1.6));
        if (rnd() < (sand ? 0.8 : 0.5)) later(sand ? 0.6 : 0.35, () => play("cry", x, y, pass ? { room: "passage", roomSend: 0.4 } : {}, 1.6));
        return true;
      }
      case "ladder-pushed":
        play("ladder_push", e.x, e.y, {}, 3);
        if (rnd() < 0.8) later(0.5, () => play("cry", e.x, e.y, {}, 5)); // the man at its head goes over with it
        return true;
      case "stoned": if (e.first) play("stone_men", e.x, e.y, { gain: e.big ? 2 : 0 }, 1); return true;
      case "escalade": { // the assault's signal when there is no siege mode to give it (trumpets from the side going in)
        const u = w.units.get(e.unit); if (!u) return false;
        if (!w.siegeWar && once("assault" + u.team, 90)) { const at = B.hq(u.team) || [u.ax, u.ay]; play("assault_trumpets", at[0], at[1], {}, 3); }
        return false; // battle.js still throws the ladders up
      }
      case "breach-barricaded": later(0, () => play("hammer", e.x, e.y, {}, 1.2)); return true;
      case "barricade-broken": play("splinter", e.x, e.y, { gain: 3 }, 1.2); later(0.1, () => play("collapse", e.x, e.y, { gain: -4 }, 1.2)); return true;
      case "sally-out": { const u = w.units.get(e.unit); if (u) { play(`horn_charge_${teamName(u.team)}`, u.ax, u.ay, {}, 3); later(1.5, () => play(`warcry_${teamName(u.team)}`, u.ax, u.ay, {}, 1.7)); } return true; }
      case "surrender": { const c = st.cent[e.team]; if (c) play(`horn_retire_${teamName(e.team)}`, c[0], c[1], {}, 3); return true; }
    }
    return false;
  }

  // a blow / fall on a castle: at his height, and in the gate passage with its echo
  function where(i) {
    const h = lh(i); let room = null;
    if (h < 1 && (w.castles?.length) && inPassage(S.x[i], S.y[i])) room = "passage";
    return { h, room };
  }

  // ---------------------------------------------------------------- the stone in the air: its whoosh ends on the impact
  function shot(s) {
    if (s.kind !== "stone") return;
    const eta = s.t1 - w.time; if (!(eta > 0.3)) return;
    // heard where it comes down (the last ~1.4 s of the flight, 85 % of the way there)
    const k = 0.85, x = s.x0 + (s.x1 - s.x0) * k, y = s.y0 + (s.y1 - s.y0) * k;
    if (hear("stone_fly", s.x1, s.y1) < 0.01) return;
    const d = 1.45, up = Math.max(4, (s.h1 - map.h(x, y)) + 4 * s.apex * k * (1 - k) * 0.6);
    later(Math.max(0, eta - d), () => play("stone_fly", x, y, { gain: s.big ? 0 : -4, rate: s.big ? 1 : 1.2 }, up));
  }

  // ---------------------------------------------------------------- beds: belfry, mining, the wall-walks; the camp
  function beds(dt) {
    const Z = w.siege, [ex, ey] = st.ear;
    // siege towers and rams being pushed: timbers and wheels, loud as they move
    const bel = [];
    if (Z) for (const e of Z.engines) {
      if (e.kind !== "siege_tower" && e.kind !== "ram") continue;
      const p = ss.engPos.get(e.id); ss.engPos.set(e.id, [e.x, e.y]);
      if (!p || dt <= 0) continue;
      const v = Math.hypot(e.x - p[0], e.y - p[1]) / dt; if (v > 20) continue; // (a jump: days passed, or it was placed)
      const lv = clamp(v / 0.6, 0, 1.2) * (e.kind === "ram" ? 0.45 : 1);
      if (lv < 0.03) continue;
      const X = e.x, Y = map.h(e.x, e.y) + 3, Zc = -e.y;
      bel.push({ x: X, y: Y, z: Zc, level: lv, r: 4, rate: clamp(0.85 + v * 0.2, 0.85, 1.1), loud: lv / Math.max(4, eng.dist(X, Y, Zc)) });
    }
    eng.drive("bed_belfry", bel.sort((a, b) => b.loud - a.loud), dt);
    // mines being dug: picks at the face, under the ground
    const mine = [];
    for (const m of Z?.works?.mines || []) {
      if ((m.state !== "digging" && m.state !== "chamber") || m.unit === null || m.unit === undefined) continue;
      const x = m.hx ?? m.x0, y = m.hy ?? m.y0; if (Math.hypot(x - ex, y - ey) > 150) continue;
      const X = x, Y = map.h(x, y) - 2, Zc = -y;
      mine.push({ x: X, y: Y, z: Zc, level: m.state === "chamber" ? 0.6 : 1, r: 3, loud: 1 / Math.max(3, eng.dist(X, Y, Zc)) });
    }
    eng.drive("bed_mining", mine.sort((a, b) => b.loud - a.loud), dt);
    // men walking on the wall-walks (battle.js's scan counts them into cells of kind "wall")
    const wall = [];
    for (const c of st.cells.values()) {
      const a = c.wall; if (!a) continue;
      const x = a.x / a.n, y = a.y / a.n, X = x, Y = map.h(x, y) + a.h / a.n + 0.3, Zc = -y, level = Math.min(2, Math.sqrt(a.n / 12));
      wall.push({ x: X, y: Y, z: Zc, level, r: 6, loud: level / Math.max(6, eng.dist(X, Y, Zc)) });
    }
    eng.drive("bed_wallwalk", wall.sort((a, b) => b.loud - a.loud), dt);
  }

  // the besiegers' camp while days pass (SIEGE-MODE: w.siegeWar), the assault's trumpets, the fight moving inward
  function siegeMode(dt) {
    const G = w.siegeWar;
    const jump = w.time - ss.lastTime; ss.lastTime = w.time;
    if (!G) { if (ss.camp) ss.camp.gain.gain.setTargetAtTime(0, eng.now, 1); return; }
    const camp = G.camp || (G.att !== undefined ? st.cent[G.att] && { x: st.cent[G.att][0], y: st.cent[G.att][1] } : null);
    const quiet = G.phase === "invest" || G.phase === "siege";
    if (jump > 20) { // days (or hours) passed at a stroke: the camp's life fills the gap
      ss.daysBoost = 10;
      if (camp) for (let k = 0; k < 6; k++) later(0.4 + k * (0.8 + rnd()), () => {
        const a = rnd() * 6.283, r = 10 + rnd() * 60, x = camp.x + Math.cos(a) * r, y = camp.y + Math.sin(a) * r;
        play(k % 3 === 0 ? "hammer" : k % 3 === 1 ? (rnd() < 0.5 ? "whinny" : "snort") : "axe", x, y, { bus: "amb", send: 0.3 }, 1.5);
      });
    }
    ss.daysBoost = Math.max(0, ss.daysBoost - dt);
    if (!ss.camp) ss.camp = eng.bed("bed_camp", "amb");
    if (ss.camp) {
      const [ex, ey] = st.ear, d = camp ? Math.hypot(camp.x - ex, camp.y - ey) : 400;
      const near = clamp(1.2 - d / 500, 0.15, 1); // at the camp it is all round you; from the walls, a far-off murmur and hammers
      const want = G.phase === "end" ? 0 : (quiet ? near : near * 0.25) * (ss.daysBoost > 0 ? 1.6 : 1) * (1 - 0.7 * ss.encK);
      ss.camp.gain.gain.setTargetAtTime(want * 0.5, eng.now, ss.daysBoost > 0 ? 0.3 : 1.5);
      ss.camp.lp.frequency.setTargetAtTime(clamp(16000 * Math.pow(120 / Math.max(120, d), 0.9), 1500, 16000) * (1 - 0.8 * ss.encK) + 300, eng.now, 1);
    }
    // the assault: "trumpets in the camp", then the host's horns, then the cry as they go in
    const on = !!G.assault?.on;
    if (on && !ss.assaultOn) {
      const at = camp ? [camp.x, camp.y] : st.cent[G.att] || [0, 0], tn = teamName(G.att ?? 0);
      play("assault_trumpets", at[0], at[1], {}, 3);
      later(3.5, () => play("horns_massed", at[0], at[1], {}, 4));
      later(6.5, () => { const c = st.cent[G.att] || at; play(`warcry_${tn}`, c[0], c[1], {}, 1.7); });
      if (G.def !== undefined) later(2.5, () => { const k = G.castle?.keep || G.castle; if (k?.x !== undefined) play("bell", k.x, k.y, { gain: 4 }, 18); }); // the castle's alarm
    }
    ss.assaultOn = on;
    if (G.phase !== ss.phase) {
      const C = G.castle || {};
      if (G.phase === "inside" && ss.phase && C.x !== undefined) play(`warcry_${teamName(G.att ?? 0)}`, C.x, C.y, {}, 2);
      if (G.phase === "keep" && ss.phase && G.def !== undefined) { const k = C.keep || C; if (k.x !== undefined) play(`horn_rally_${teamName(G.def)}`, k.x, k.y, {}, 20); }
      ss.phase = G.phase;
    }
  }

  return {
    event, shot, where,
    update(dt) { enclosure(dt); beds(dt); siegeMode(dt); },
    state: ss,
  };
}
