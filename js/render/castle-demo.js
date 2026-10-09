// ?demo=castle — a castle on the vale with men on its walls, in its towers and keep, and an assault at a breach.
// Headless screenshots of js/render/castle.js (tools/battle-shots.mjs). The castle comes from CASTLE-SIM's
// castleFromLayout (js/sim/castle.js) when it exists; until then a fallback layout of the same shape (§1 of
// docs/castle-plan.md) is built here, with real stone_wall / gatehouse buildings so the siege sim (b.mods,
// breaches, the gate) works on it. Before the sim has levels (S.lvl), men placed on the walls are PINNED to their
// spots and their height is given through w.castleDemoH — a demo crutch that goes away with castle.js levels.
//   &look=wide|medium|close|keep|tower|gate|breach   &dist= &pitch=(deg) &yaw=(rad)   &cut=<storey> (manual cut)
//   &site=x,y (else the flattest open ground 350–650 m from our town)   &steps= sim ticks before the shots
export async function castleDemo({ w, map, camera, addUnit, issueOrder, demoRun, EC, SG, PLAYER, params, castles, takeField, lordUI }) {
  const CS = await import("../sim/castle.js").catch(() => null);
  const team = PLAYER, foe = 1 - PLAYER, T = w.teams[team].town, E = w.teams[foe].town;
  // ---- a site: flat, open, dry, away from buildings, off the map's edge
  let site = params.get("site")?.split(",").map(Number);
  const facing0 = Math.atan2(E.y - T.y, E.x - T.x);
  let siteFacing; if (!site && CS?.castleSite) { const s = CS.castleSite(map, params.get("layout") || "hill"); if (s && Math.min(s.x, s.y, map.size - s.x, map.size - s.y) > 540) { site = [s.x, s.y]; siteFacing = s.facing; } } // (the camera keeps 450 m off the edge)
  if (!site) {
    let best = null, bs = Infinity;
    for (let r = 350; r <= 650; r += 50) for (let a = -1.4; a <= 1.4; a += 0.2) {
      const x = T.x + Math.cos(facing0 + a) * r, y = T.y + Math.sin(facing0 + a) * r;
      if (x < 520 || y < 520 || x > map.size - 520 || y > map.size - 520) continue;
      let hs = [], bad = 0;
      for (let dx = -70; dx <= 70; dx += 14) for (let dy = -70; dy <= 70; dy += 14) { const h = map.h(x + dx, y + dy); hs.push(h); bad += (map.canopy?.(x + dx, y + dy) > 1 ? 1 : 0) + (map.water?.(x + dx, y + dy) > 0.05 ? 3 : 0); }
      const m = hs.reduce((a, b) => a + b, 0) / hs.length, v = Math.sqrt(hs.reduce((a, b) => a + (b - m) ** 2, 0) / hs.length);
      const nearB = (w.buildings || []).some((b) => Math.hypot(b.x - x, b.y - y) < 140) ? 100 : 0;
      const sc = v + bad * 0.6 + nearB; if (sc < bs) { bs = sc; best = [x, y]; }
    }
    site = best || [T.x + 400, T.y];
  }
  const [cx, cy] = site, facing = siteFacing ?? Math.atan2(E.y - cy, E.x - cx); // toward the besiegers
  // ---- the castle
  let C = CS?.castleFromLayout ? CS.castleFromLayout(w, params.get("layout") || "hill", { x: cx, y: cy, team, facing }) : null;
  if (!C) C = fallbackCastle(w, EC, cx, cy, team, facing);
  (w.castles ||= []).includes(C) || w.castles.push(C);
  SG?.ensureSiege?.(w);
  castles.sync(w);
  // ---- a breach in the front-left curtain, its neighbours cracked and pocked
  const curt = C.parts.filter((p) => p.kind === "curtain" && p.bid !== undefined).map((p) => [p, w.buildings.find((b) => b.id === p.bid)]).filter(([, b]) => b);
  const fwd = ([p]) => ((p.x0 + p.x1) / 2 - cx) * Math.cos(facing) + ((p.y0 + p.y1) / 2 - cy) * Math.sin(facing);
  const [bp, bb] = curt.find(([p]) => p.tag === "front-left") || curt.slice().sort((a, b) => fwd(b) - fwd(a))[0];
  const n = SG?.nMods ? SG.nMods(bb) : Math.max(1, Math.round(Math.hypot(bb.x2 - bb.x1, bb.y2 - bb.y1) / 6)), per = bb.hpMax / n;
  bb.mods ||= new Float32Array(n).fill(per); const k = Math.max(1, Math.floor(n / 2) - 1);
  bb.mods[k] = 0; if (k - 1 >= 0) bb.mods[k - 1] = per * 0.3; if (k + 1 < n) bb.mods[k + 1] = per * 0.6; if (k + 2 < n) bb.mods[k + 2] = per * 0.7;
  bb.hp = [...bb.mods].reduce((a, b) => a + b, 0);
  if (SG?.breach) SG.breach(w, bb, k, null); else { bb.breachVer = (bb.breachVer || 0) + 1; w.featuresVer = (w.featuresVer || 0) + 1; }
  if (SG?.modState) for (let q = 0; q < n; q++) SG.modState(w, bb, q, null);
  const L = Math.hypot(bb.x2 - bb.x1, bb.y2 - bb.y1), ux = (bb.x2 - bb.x1) / L, uy = (bb.y2 - bb.y1) / L;
  let nx = -uy, ny = ux; if ((bb.x - cx) * nx + (bb.y - cy) * ny < 0) { nx = -nx; ny = -ny; }
  const tB = (k + 0.5) * L / n, brX = bb.x1 + ux * tB, brY = bb.y1 + uy * tB;
  // ---- men: on the walks, in a tower, in the keep's hall, at the breach. With castle.js they are put on their levels
  // by the sim (man_walls, setLevel) and it keeps them there; before it existed they were pinned (w.castleDemoH).
  const S = w.S, pins = [], demoH = (w.castleDemoH ||= new Map()), real = !!(CS?.setLevel && S.lvl);
  const pin = (i, x, y, h, face, lvl) => { S.x[i] = x; S.y[i] = y; if (face !== undefined) S.facing[i] = face; SG?.place?.(w, i, x, y); if (real && lvl) { CS.setLevel(w, i, lvl, x, y); return; } pins.push([i, x, y]); demoH.set(i, h); };
  const walkers = (p, arm, count, from = 0.15, to = 0.85, tm = team) => {
    const u = addUnit(w, { team: tm, arm, count, x: (p.x0 + p.x1) / 2, y: (p.y0 + p.y1) / 2, facing: 0, formation: "line" }); u.noAI = true;
    const len = Math.hypot(p.x1 - p.x0, p.y1 - p.y0), ax = (p.x1 - p.x0) / len, ay = (p.y1 - p.y0) / len; let ox = -ay, oy = ax; if (((p.x0 + p.x1) / 2 - cx) * ox + ((p.y0 + p.y1) / 2 - cy) * oy < 0) { ox = -ox; oy = -oy; }
    u.members.forEach((i, m) => { const t = len * (from + (to - from) * (m + 0.5) / u.members.length); pin(i, p.x0 + ax * t - ox * 0.2, p.y0 + ay * t - oy * 0.2, p.walkH ?? 8, Math.atan2(oy, ox), CS?.L_WALK ?? 1); });
    return u;
  };
  const tagOf = (p) => p.tag || p.id;
  // (castle.js curtains carry no tags: the breach goes in the curtain nearest the besiegers, beside the gatehouse)
  const toward = (p) => ((p.x0 + p.x1) / 2 - cx) * Math.cos(facing) + ((p.y0 + p.y1) / 2 - cy) * Math.sin(facing);
  for (const [p] of curt) if (p !== bp) walkers(p, toward(p) > 10 ? "crossbow" : "archers", Math.max(3, Math.min(12, Math.round(Math.hypot(p.x1 - p.x0, p.y1 - p.y0) / (toward(p) > 10 ? 3 : 6)))));
  walkers(bp, "crossbow", 4, 0.02, 0.2); walkers(bp, "spearmen", 3, 0.75, 0.95);
  // in a tower (the room at the walk, and its top)
  const towers = C.parts.filter((p) => p.kind === "tower").sort((a, b) => Math.hypot(a.x - bb.x, a.y - bb.y) - Math.hypot(b.x - bb.x, b.y - bb.y));
  const tower = C.parts.find((p) => p.kind === "tower" && p.tag === "front-left") || towers[0];
  if (tower) { const F = floorsOf(tower), wl = F.indexOf(tower.walkH ?? 8) > 0 ? F.indexOf(tower.walkH ?? 8) : 1, u = addUnit(w, { team, arm: "spearmen", count: 6, x: tower.x, y: tower.y, facing: 0, formation: "line" }); u.noAI = true;
    u.members.forEach((i, m) => { const a = m * 1.1, r = m < 3 ? 1.4 : 2.0, top = m >= 3; pin(i, tower.x + Math.cos(a) * r, tower.y + Math.sin(a) * r, top ? F.at(-1) : F[wl], a, top ? CS?.L_TOP ?? 2 : CS?.L_WALK ?? 1); });
    const v = addUnit(w, { team: foe, arm: "menatarms", count: 3, x: tower.x, y: tower.y, facing: 0, formation: "line" }); v.noAI = true;
    v.members.forEach((i, m) => { const a = m * 1.1 + 0.5, r = 0.8; pin(i, tower.x + Math.cos(a) * r, tower.y + Math.sin(a) * r, F[wl], a + Math.PI, CS?.L_WALK ?? 1); }); }
  const keep = C.parts.find((p) => p.kind === "keep");
  if (keep) { const F = floorsOf(keep), c = Math.cos(keep.rot || 0), s = Math.sin(keep.rot || 0), at = (a, b) => [keep.x + a * c - b * s, keep.y + a * s + b * c];
    const d = addUnit(w, { team, arm: "menatarms", count: 8, x: keep.x, y: keep.y, facing: 0, formation: "line" }); d.noAI = true;
    const o = addUnit(w, { team: foe, arm: "menatarms", count: 7, x: keep.x, y: keep.y, facing: 0, formation: "line" }); o.noAI = true;
    d.members.forEach((i, m) => { const [x, y] = at(-4 + (m % 4) * 1.6, -2.5 + Math.floor(m / 4) * 1.2); pin(i, x, y, F[1], (keep.rot || 0) + Math.PI / 2, CS?.L_HALL ?? 3); });
    o.members.forEach((i, m) => { const [x, y] = at(-4 + (m % 4) * 1.6 + 0.4, 1.4 + Math.floor(m / 4) * 1.2); pin(i, x, y, F[1], (keep.rot || 0) - Math.PI / 2, CS?.L_HALL ?? 3); });
    const r = addUnit(w, { team, arm: "crossbow", count: 6, x: keep.x, y: keep.y, facing: 0, formation: "line" }); r.noAI = true;
    r.members.forEach((i, m) => { const [x, y] = at(-6 + m * 2.4, -((keep.d ?? keep.w) / 2) + 1.6); pin(i, x, y, F.at(-1), facing, CS?.L_ROOF ?? 5); }); }
  demoRun(30); // (the walls become features, the siege sim sees them; then the assault goes in)
  const hold = addUnit(w, { team, arm: "spearmen", count: 24, x: brX - nx * 9, y: brY - ny * 9, facing: Math.atan2(ny, nx) - Math.PI / 2, formation: "line", depth: 3 }); hold.noAI = true;
  const storm = addUnit(w, { team: foe, arm: "menatarms", count: 40, x: brX + nx * 22, y: brY + ny * 22, facing: Math.atan2(-ny, -nx) - Math.PI / 2, formation: "deep" }); storm.noAI = true;
  issueOrder(w, [storm.id], { kind: "assault", x: brX - nx * 6, y: brY - ny * 6, pace: "quick", immediate: true });
  // an escalade at the front-right curtain (siege.js raises ladders to the wall-walk)
  const fr = curt.find(([p]) => p.tag === "front-right") || curt.filter((q) => q[0] !== bp).sort((a, b) => fwd(b) - fwd(a))[0];
  if (fr) { const [p] = fr, mx = (p.x0 + p.x1) / 2, my = (p.y0 + p.y1) / 2, ox = mx - cx, oy = my - cy, ol = Math.hypot(ox, oy); w.teams[foe].store.ladders = 10;
    const esc = addUnit(w, { team: foe, arm: "spearmen", count: 30, x: mx + ox / ol * 30, y: my + oy / ol * 30, facing: Math.atan2(-oy, -ox) - Math.PI / 2, formation: "line" }); esc.noAI = true;
    issueOrder(w, [esc.id], { kind: "escalade", x: mx, y: my, pace: "quick", immediate: true }); }
  castles.clearGround?.(w); // (the trees on the castle's ground and its field of fire are gone)
  const tick = () => { for (const [i, x, y] of pins) { if (!S.alive[i]) continue; S.x[i] = x; S.y[i] = y; S.vx[i] = 0; S.vy[i] = 0; SG?.place?.(w, i, x, y); } };
  if (pins.length) setInterval(tick, 8);
  demoRun(+(params.get("steps") || 160)); tick();
  // ---- the camera
  const look = params.get("look") || "medium", gate = C.parts.find((p) => p.kind === "gatehouse");
  const spots = { wide: [cx, cy, 2, 420], medium: [cx, cy, 2, 200], close: [brX - nx * 4, brY - ny * 4, 2, 70], breach: [brX, brY, 3, 45],
    keep: keep ? [keep.x, keep.y, 2, 60] : [cx, cy, 2, 60], ladders: fr ? [(fr[0].x0 + fr[0].x1) / 2, (fr[0].y0 + fr[0].y1) / 2, 2, 55] : [cx, cy, 2, 55], tower: tower ? [tower.x, tower.y, 2, 42] : [cx, cy, 2, 42], gate: gate ? [gate.x, gate.y, 2, 60] : [cx, cy, 2, 60] };
  const [fx, fy, view, dist] = spots[look] || spots.medium;
  camera.focus(fx, fy); camera.setView(view); camera.st.dist = camera.goal.dist = +(params.get("dist") || dist);
  camera.st.yaw = params.has("yaw") ? +params.get("yaw") : facing + Math.PI / 2 + 0.5;
  if (params.has("pitch")) camera.st.pitch = camera.goal.pitch = +params.get("pitch") * Math.PI / 180; else camera.st.pitch = camera.goal.pitch;
  if (params.has("cut")) castles.setManualCut(+params.get("cut"));
  // &lord=keep|tower: the player's lord walks in (his third-person view); the roof and the storeys above him lift
  const lordAt = params.get("lord"); let lordMsg = "";
  if (lordAt && takeField && lordUI) {
    const P = lordAt === "tower" ? tower : keep;
    const F = floorsOf(P), lvl = lordAt === "tower" ? CS?.L_WALK ?? 1 : CS?.L_HALL ?? 3, h = lordAt === "tower" ? F[F.indexOf(P.walkH ?? 8) > 0 ? F.indexOf(P.walkH ?? 8) : 1] : F[1];
    const c = Math.cos(P.rot || 0), s2 = Math.sin(P.rot || 0), lx = P.x + (lordAt === "tower" ? 1.2 : 3 * c + 3 * s2), ly = P.y + (lordAt === "tower" ? 0.8 : 3 * s2 - 3 * c);
    const r = takeField(w, team, cx - Math.cos(facing) * 170, cy - Math.sin(facing) * 170, { facing }); const A = w.avatar; // (he takes the field behind the castle, then is walked in)
    if (A && !r?.error) {
      A.input.mount = true; demoRun(3); A.input.mount = false;
      w.S.x[A.lord] = lx; w.S.y[A.lord] = ly; SG?.place?.(w, A.lord, lx, ly);
      if (real) CS.setLevel(w, A.lord, lvl, lx, ly); else { pins.push([A.lord, lx, ly]); demoH.set(A.lord, h); }
      lordUI.setActive(true); lordUI.setLook(+(params.get("lyaw") || facing + Math.PI * 0.75), +(params.get("lpitch") || 0.5), +(params.get("ldist") || 7));
      for (let k = 0; k < 10; k++) { demoRun(1); lordUI.frame(0.1, 0); }
    } else lordMsg = " LORD-ERROR " + (r?.error || "?");
  }
  document.title = `CASTLE ${C.name || C.id} parts=${C.parts.length} at ${Math.round(cx)},${Math.round(cy)} breach=${Math.round(brX)},${Math.round(brY)} sim=${CS?.castleFromLayout ? "castle.js" : "fallback"}${lordMsg}`;
  return { C, brX, brY };
}
function floorsOf(p) { if (Array.isArray(p.floors) && p.floors.length) return p.floors.map((f) => typeof f === "number" ? f : f.h); return p.kind === "keep" ? [0, 6, 13.5, 21] : [0, 4.2, 8, 12]; }

// the fallback castle (used only while js/sim/castle.js has no castleFromLayout): a hill castle with a keep, four
// round towers and a square one, a twin-towered gatehouse facing the enemy, a hall, a chapel and a well
function fallbackCastle(w, EC, x, y, team, facing) {
  const f = [Math.cos(facing), Math.sin(facing)], l = [-f[1], f[0]], P = (u, v) => [x + f[0] * u + l[0] * v, y + f[1] * u + l[1] * v];
  const rotAlong = Math.atan2(l[1], l[0]); // a curtain across the front runs along l
  const parts = [], wh = 8;
  const add = (p) => { p.id = parts.length + 1; parts.push(p); return p; };
  const T = { FL: P(42, 46), FR: P(42, -46), BL: P(-42, 46), BR: P(-42, -46), ML: P(0, 50) };
  for (const [tag, [tx, ty]] of Object.entries(T)) add(tag === "ML" ? { kind: "tower", tag: "mid-left", shape: "rect", x: tx, y: ty, w: 10, h: 10, rot: rotAlong, floors: [0, 4.2, wh, wh + 4], walkH: wh } : { kind: "tower", tag: { FL: "front-left", FR: "front-right", BL: "back-left", BR: "back-right" }[tag], shape: "round", x: tx, y: ty, r: 5, floors: [0, 4.2, wh, wh + 4], walkH: wh });
  const G = P(42, 0), gb = EC.placeBuilding(w, team, "gatehouse", G[0], G[1], rotAlong, true);
  add({ kind: "gatehouse", x: G[0], y: G[1], rot: rotAlong, w: 16, d: 12, passage: 3.6, floors: [0, wh, wh + 5.5], walkH: wh, bid: gb?.id });
  const curtain = (a, b, tag) => { const wb = EC.placeWall(w, team, "stone_wall", a[0], a[1], b[0], b[1], true); return add({ kind: "curtain", tag, x0: a[0], y0: a[1], x1: b[0], y1: b[1], thick: 2.8, walkH: wh, height: wh + 2.2, bid: wb?.id }); };
  curtain(T.FL, G, "front-left"); curtain(G, T.FR, "front-right"); curtain(T.FR, T.BR, "right"); curtain(T.BR, T.BL, "back"); curtain(T.BL, T.ML, "left-back"); curtain(T.ML, T.FL, "left-front");
  const K = P(-18, 4); add({ kind: "keep", x: K[0], y: K[1], w: 20, h: 20, rot: rotAlong, floors: [0, 6, 13.5, 20] });
  const H = P(8, -34); add({ kind: "hall", x: H[0], y: H[1], w: 20, h: 9, rot: Math.atan2(f[1], f[0]) });
  const Ch = P(14, 34); add({ kind: "chapel", x: Ch[0], y: Ch[1], w: 13, h: 7, rot: Math.atan2(f[1], f[0]) });
  const Wl = P(16, 12); add({ kind: "well", x: Wl[0], y: Wl[1], r: 1.2 });
  const C = { id: 1, team, name: "Castle", parts, keep: parts.find((p) => p.kind === "keep"), bailey: { x, y, r: 45 }, walkH: wh };
  return C;
}
