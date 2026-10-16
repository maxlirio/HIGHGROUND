// A pitched battle in the sim (?mode=battle; headless: tools/battle-scenarios.mjs): the field made ready (the
// ground soaked by rain, generated brooks and bridges), both hosts drawn up in their zones, the enemy's AI with
// his temper, ambushes that wait for their moment, the weather and the wind, the objectives and the recorder.
// No DOM, no three.js — the frame round it is js/ui/battle-run.js.
//   prepareField(map, cfg)                 before createWorld (the nav and the going must see the changes)
//   setupBattle(w, cfg, { PLAYER, V, places }) → battle { zones, units, teamOf, sideOf, cmd, names, rec, advance() }
import { readLand } from "./landread.js";
import { zonesOf, frameOf, placeHost, applyTweaks, openBridgeNav, zonePoint } from "./battlefield.js";
import { addFeature } from "./features.js";
import { addRect } from "./obstacles.js";
import { makeRecorder } from "./battle-record.js";
import { commandBattle } from "./commander-ai.js";
import { issueOrder } from "./world.js";
import { ARMS } from "./arms.js";
import { S_GONE } from "./economy.js";
import { S_DEAD } from "./soldiers.js";

// the sim's weather for each choice on the setup screen
export const SIM_WEATHER = { clear: "clear", overcast: "overcast", rain: "rain", fog: "fog_light", wind: "clear", storm: "thunderstorm", snow: "snow_light" };

export function prepareField(map, cfg) {
  if (cfg.afterRain > 0 && map.land) map.land = readLand(map, { rain: cfg.afterRain }); // the ground as days of rain have left it
  cfg._tweaks = applyTweaks(map, cfg);
  return cfg._tweaks;
}

// ---------------------------------------------------------------- the battle
// deps = { PLAYER, V, places, scene, map, camera, log(text, o), toast, glyph }
export function setupBattle(w, cfg, deps) {
  const { V, places } = deps, PLAYER = deps.PLAYER ?? 0;
  // the owner: "Make it JUST a battle, nothing more" — no keep, no serfs, no stores, no veins or wells, no beasts, no
  // dragons: two hosts on a field. w.battleOnly stops the town economy (and the wild and the dragons it ticks) and
  // the supply lines (js/sim/economy.js, logistics.js, convoys.js)
  for (const [id, u] of [...w.units.entries()]) { for (const m of u.members) { w.S.alive[m] = 0; w.S.state[m] = S_GONE; } w.units.delete(id); }
  w.battleOnly = true; w.dragonsOn = false; w.wild = null;
  if (w.buildings) w.buildings.length = 0;
  if (w.resources) w.resources.length = 0;
  if (w.fields) w.fields.length = 0;
  for (const T of w.teams) { T.dependants = 0; T.squires = 0; T.sheep = 0; T.camp0 = 0; T.homeUnit = null; }
  if (cfg._tweaks?.bridge) openBridgeNav(w.nav, cfg._tweaks.bridge);
  if (cfg._tweaks?.bridge && w.obstacles) railBridge(w.obstacles, cfg._tweaks.bridge, frameOf(cfg.site, cfg.axis), cfg.axis);
  const ps = cfg.playerSide ?? 0, teamOf = (side) => (side === ps ? PLAYER : 1 - PLAYER), sideOf = (team) => (team === PLAYER ? ps : 1 - ps);
  const zones = zonesOf(cfg.site, cfg.axis, cfg.field || {}), F = frameOf(cfg.site, cfg.axis);
  // a small arena (ranked battles): the hosts close at once, and nobody's orders lead off the field
  w.arena = cfg.arena ? { x: cfg.site.x, y: cfg.site.y, r: cfg.arena.r } : null;
  // weather in the sim: the WEATHER entry (sight, bowstrings, footing, order garbling), the wind as a vector
  w.weather = SIM_WEATHER[cfg.weather] || "clear";
  // rain's mud is baked into the land itself (prepareField afterRain); lying snow has no baked form,
  // so a snow battle carries it on w.wx and goingMul reads it there (js/sim/weather.js, world.goingMul)
  if (cfg.weather === "snow") w.wx = { wet: 0, snowCover: 0.85 };
  if (cfg.wind) { const face = zones[ps].face, a = cfg.wind.dir === "back" ? face : cfg.wind.dir === "face" ? face + Math.PI : face + Math.PI / 2; w.wind = { x: Math.cos(a) * cfg.wind.speed, y: Math.sin(a) * cfg.wind.speed }; cfg.windFrom = compass(a + Math.PI); }
  w.lightMul = (cfg.tod === "dusk" ? 0.8 : cfg.tod === "dawn" ? 0.9 : 1) * (cfg.weather === "fog" ? 0.3 : cfg.weather === "storm" ? 0.6 : 1); // (fog: a man sees about a bowshot; a storm: a dark sky and driving rain)
  // the hosts
  const units = [[], []];
  cfg.sides.forEach((d, side) => {
    const team = teamOf(side), z = zones[side];
    units[side] = placeHost(w, { team, zone: z, companies: d.companies, temper: d.temper || "inspiring", stakes: d.ai ? null : (d.companies.some((c) => c.stakes) ? null : false), tag: side });
    w.teams[team].hq = zonePoint(z, -z.d / 2 + 30, 0);
  });
  // a lord known by his own name (a ranked player's: server/ranked.mjs) is that man when he takes the field (js/ui/avatar-ui.js)
  w.lordNames = []; cfg.sides.forEach((d, side) => { if (d.lordName) w.lordNames[teamOf(side)] = d.lordName; });
  // a host ordered to take no prisoners (Courtrai's Flemings): quarter is never given (avatar.js, morale.js read w.noPrisoners)
  cfg.sides.forEach((d, side) => { if (d.noQuarter) (w.noPrisoners ||= {})[teamOf(side)] = true; });
  // a brook with steep, soft banks is a ditch to a horse (Courtrai's Groeninge: "many horses refused; men and horses
  // fell into the ditches"): the water alone only slowed a charge, which then went on at the gallop up the far bank —
  // its banks are a ditch feature along its line, so riders refuse or fall at it as at any ditch (cavalry.obstacleAhead)
  for (const bk of cfg._tweaks?.brooks || []) if (bk.banks && bk.line.length > 1) {
    for (let k = 0; k + 1 < bk.line.length; k += 5) { const a = bk.line[k], b = bk.line[Math.min(bk.line.length - 1, k + 5)]; addFeature(w, { type: bk.banks, x0: a.x, y0: a.y, x1: b.x, y1: b.y, width: bk.width, src: "scenario", team: -1 }); }
  }
  // Crécy's pits before the archers on the English wings
  if (cfg.pits) for (const u of units[0]) if (ARMS[u.arm].missile) {
    const fx = Math.cos(u.facing + Math.PI / 2), fy = Math.sin(u.facing + Math.PI / 2), lx = Math.cos(u.facing), ly = Math.sin(u.facing), c = { x: u.ax + fx * 28, y: u.ay + fy * 28 };
    addFeature(w, { type: "pits_pottes", x0: c.x - lx * 30, y0: c.y - ly * 30, x1: c.x + lx * 30, y1: c.y + ly * 30, width: 6, src: "scenario", team: u.team });
  }
  // the enemy's general: his temper, his line where it stands (a defender holds the ground he drew up on)
  // (a live ranked battle has no AI side: two players, each his own host — js/sim/live-battle on the server)
  const aiSide = cfg.sides.findIndex((d) => d.ai), aiTeam = aiSide < 0 ? -1 : teamOf(aiSide);
  const cmd = aiSide < 0 ? { team: -1, units: new Set(), disposition: "aggressive", V } : generalOf(cfg, aiSide, units[aiSide], zones, aiTeam, V, "aggressive");
  // objectives
  const ob = {};
  if (cfg.objectives?.timeLimit) ob.timeLimit = { secs: cfg.objectives.timeLimit.secs, winner: cfg.objectives.timeLimit.side >= 0 ? teamOf(cfg.objectives.timeLimit.side) : -1, why: cfg.objectives.timeLimit.why };
  if (cfg.objectives?.bridgehead) { const b = cfg.objectives.bridgehead; ob.bridgehead = { team: teamOf(b.side), x: cfg.site.x, y: cfg.site.y, axis: cfg.axis, sign: b.side === 0 ? 1 : -1, beyond: b.beyond, men: b.men, secs: b.secs }; }
  // how the chronicle names things
  const S = (team) => cfg.sides[sideOf(team)];
  const names = {
    side: (team) => (team >= 0 ? S(team).name : "both hosts"), adj: (team) => S(team).adj,
    arm: (team, arm) => { const A = ARMS[arm]?.name.toLowerCase() || arm, d = S(team); return d.adj ? `the ${d.adj} ${A}` : `${d.name}'s ${A}`; },
    lord: (team) => S(team).lord || `the lord of ${S(team).name}`,
    place: (x, y) => (x === undefined ? "" : places.at(x, y).phrase.replace(/ site$/, "")),
  };
  const battle = { cfg, zones, field: F, units, teamOf, sideOf, cmd, names, phase: "deploy", frozen: true, t0: w.time, PLAYER, aiSide, ob };
  battle.rec = makeRecorder(w, { names, objectives: ob, onMoment: (m) => battle.onMoment?.(m) });
  // the generals who may strike at a bridgehead (the enemy's; a headless run adds the one it fights the player's side with)
  battle.generals = [cmd];
  // the systems: the AI (after the advance), the lurkers, the recorder
  w.systems.push((w) => {
    if (battle.phase === "deploy") return;
    springLurkers(w, battle);
    for (const g of battle.generals) strikeBridgehead(w, battle, g);
    if (cmd.team >= 0) { commandBattle(w, cmd); chivalry(w, battle); }
  });
  // a small arena (ranked; before the recorder, which reads the tick's deaths): a man who runs off the field is gone for good — he dies there, and counts as dead
  if (w.arena) w.systems.push((w) => {
    if (battle.phase === "deploy" || w.tick % 10) return;
    const A = w.arena, R2 = (A.r + 30) ** 2, S = w.S;
    for (const u of w.units.values()) for (const i of u.members) {
      if (!S.alive[i] || (S.x[i] - A.x) ** 2 + (S.y[i] - A.y) ** 2 <= R2) continue;
      S.alive[i] = 0; S.state[i] = S_DEAD; S.downT[i] = w.time; S.posture[i] = 2;
      w.events.push({ t: w.tick, kind: "kill", victim: i, by: -1, cause: "fled" });
    }
  });
  w.systems.push((w) => { if (battle.phase !== "deploy") battle.rec.system(w); });
  battle.advance = () => {
    battle.phase = "battle"; battle.frozen = false; battle.rec.t0 = w.time; battle.rec.moments.length = 0;
    // the enemy general's scouts have seen your array drawn up (in a pitched battle both hosts knew where the other
    // stood): he starts from that, and his own eyes take over as he closes (commander-ai remembers what it saw)
    // (so has every general on the field: a headless run's one for the player's side too — before, he started blind, and
    // an attacker whose array stood in a wood saw nothing and never moved: Bannockburn's Scots stood in the New Park
    // for seven minutes while the English bows shot them to pieces)
    for (const g of battle.generals) {
      if (g.team < 0) continue; g.seen ||= new Map();
      for (const u of w.units.values()) if (u.battleHost && u.team !== g.team && u.members.length && !u.lurking) g.seen.set(u.id, { id: u.id, team: u.team, arm: u.arm, ax: u.ax, ay: u.ay, fx: u.fx, fy: u.fy, members: u.members, state: u.state, c: u.c, hold: u.hold, moving: false, retired: u.retired, live: null });
    }
    for (const u of units[ps]) u.lurking = u.role === "hidden" ? true : false; // the player's own hidden men still count as unseen until they close
    battle.rec.moment({ kind: "advance", kicker: "The trumpets sound", text: `${cap(names.side(PLAYER))} advance their banners${cfg.name ? " — " + cfg.name + " begins" : ""}`, team: PLAYER, good: -1, sal: 0.3 });
  };
  return battle;
}

// The general of one side (the enemy AI's, or the one a headless run fights the player's side with): his temper and
// the plan of the day. A defender holds the ground he drew up on; an attacker is already drawn up and goes forward at
// once (no second dressing of ranks on his own ground). A side whose day was to ATTACK (plan "attack": Bruce coming
// out of the New Park at Bannockburn) goes forward and keeps going whatever his temper and whatever the count —
// otherwise a cautious captain outnumbered (the Scots at about 0.6) would stand on his hill and wait to be shot at.
export function generalOf(cfg, side, units, zones, team, V, temper = "inspiring") {
  const d = cfg.sides[side], g = { team, units: new Set(units.filter((u) => !u.lurking).map((u) => u.id)), disposition: d.temper || temper, V };
  const aimAt = { x: zones[1 - side].cx, y: zones[1 - side].cy }, face = zones[side].face;
  const centre = (pred) => { let x = 0, y = 0, n = 0; for (const u of units) if (!u.lurking && pred(u)) { x += u.ax * u.members.length; y += u.ay * u.members.length; n += u.members.length; } return n ? { x: x / n, y: y / n } : null; };
  const foot = (u) => !ARMS[u.arm].mounted && !ARMS[u.arm].missile;
  if (d.plan === "attack") { const c = centre(foot); if (c) g.battle = { phase: "advance", defend: false, goOut: true, centre: c, face, aimAt, t0: -999, halted: false }; }
  else if (["defensive", "inspiring", "skirmish", "ambusher"].includes(g.disposition) || d.hold) g.battle = { phase: "hold", defend: true, centre: centre(() => true), face, aimAt, t0: 0 };
  else { const c = centre(foot); if (c) g.battle = { phase: "advance", defend: false, centre: c, face, aimAt, t0: -999, halted: false }; }
  return g;
}

// A host whose strength is its horse (Crécy's and Courtrai's French, a Cavalry Captain's knights) does not keep
// it back for the moment: once its foot has gone in — or has run, or it never had any worth the name — the
// knights charge, rally on their banners when they recoil, and charge again (the fifteen charges at Crécy).
function chivalry(w, B) {
  const cmd = B.cmd; if (w.tick % 50 !== 7) return;
  const riders = (B.riders ||= new Set());
  if (!riders.size) {
    if (!["aggressive", "shock"].includes(cmd.disposition) || cmd.battle?.phase !== "engage") return;
    const mine = [...cmd.units].map((id) => w.units.get(id)).filter((u) => u && u.members.length);
    const n = (f) => mine.filter(f).reduce((s, u) => s + u.members.length, 0);
    const foot = n((u) => !ARMS[u.arm].mounted && !ARMS[u.arm].missile && u.state !== "routing"), horse = n((u) => ARMS[u.arm].mounted && u.state !== "routing");
    if (!horse || foot > horse * 1.5) return;
    // the horse is taken out of the general's line (he would call it back to wait behind the wings) and let go
    for (const u of mine) if (ARMS[u.arm].mounted) { riders.add(u.id); cmd.units.delete(u.id); }
    const c = B.rec.centreOf(cmd.team, (u) => riders.has(u.id)) || {};
    B.rec.moment({ kind: "chivalry", kicker: "The knights will not wait", text: `${cap(B.names.arm(cmd.team, "knights"))} spur forward without waiting for orders`, team: cmd.team, good: -1, ...c, sal: 0.6 });
  }
  const foes = [...w.units.values()].filter((v) => v.team !== cmd.team && v.battleHost && v.members.length && v.state !== "routing");
  for (const id of riders) { const u = w.units.get(id); if (!u || !u.members.length) riders.delete(id); }
  // each conroi at the enemy body facing it, left to right (all at the nearest one, they jam each other solid)
  const F = B.field, lat = (u) => (u.ax - F.x) * F.lx + (u.ay - F.y) * F.ly;
  const rs = [...riders].map((id) => w.units.get(id)).sort((a, b) => lat(a) - lat(b)), fs = foes.slice().sort((a, b) => lat(a) - lat(b));
  rs.forEach((u, i) => {
    if (!fs.length || !ARMS[u.arm].mounted || u.state !== "formed" || u.hold || u.pendingOrder) return;
    if (u.order?.kind === "assault" && w.units.get(u.order.target)?.members.length) return;
    const t = fs[Math.min(fs.length - 1, Math.floor((i + 0.5) * fs.length / rs.length))], d = Math.hypot(t.ax - u.ax, t.ay - u.ay);
    issueOrder(w, [u.id], { kind: "assault", x: t.ax, y: t.ay, target: t.id, pace: d < 250 ? "charge" : "quick" });
  });
}

// The narrow bridge's rails (battlefield.applyTweaks): solid from the edge of its lane out past the raised strip,
// the whole length of the deck and its ramps, so the men file over it at the lane's width. (Not on the nav grid:
// its 25 m cells see the bridge as one open way — openBridgeNav — and the obstacle pass keeps the men to it.)
function railBridge(O, br, F, axis) {
  const lane = br.lane || br.width; if (lane >= br.width) return;
  const out = br.width / 2 + 1.5, hy = (out - lane / 2) / 2, hx = (br.b - br.a) / 2, n0 = O.fresh?.length || 0;
  for (const sg of [-1, 1]) { const p = F.at((br.a + br.b) / 2, sg * (lane / 2 + hy)); addRect(O, p.x, p.y, axis, hx, hy); }
  O.fresh.length = n0; // (nothing for the nav grid to mark: see above)
}

// A defender behind a river strikes when as many are over as he reckons he can beat (Stirling: Moray and Wallace —
// "as many of the enemy had come over as they believed they could overcome"). He reckons with the men who will be
// over by the time his own get there (the rate they are crossing at × his march), not only the men over now — from the
// back of his ground the whole host would be over before he reached them; and a body of his foot makes for the
// bridge's end, to cut the men over off from the rest. Every general who holds the far bank strikes so: the enemy's,
// and in a headless run the one fighting the player's side (B.generals).
export const STRIKE = {
  frac: 0.3,     // of the crossing host, over (or about to be) when he strikes
  rateT: 10,     // battle-s over which the crossing rate is read
  speed: 2,      // m/s his foot come down at (the quick step)
  word: 20,      // battle-s for the word to reach his companies
  first: 5,      // men over before anyone reckons a rate (a few scouts across is not a crossing)
  predict: true, party: true,
};
export function strikeBridgehead(w, B, g) {
  const bh = B.ob.bridgehead;
  if (!bh || g.team < 0 || bh.team === g.team || g.struck || w.tick % 20) return;
  const n = B.rec.acrossCount(bh), H = (g.bhSeen ||= []); H.push([w.time, n]); while (H.length > 2 && w.time - H[1][0] >= STRIKE.rateT) H.shift();
  const mine = [...g.units].map((id) => w.units.get(id)).filter((u) => u && u.members.length);
  const br = B.cfg._tweaks?.bridge, end = br ? (bh.sign > 0 ? { x: br.x1, y: br.y1 } : { x: br.x0, y: br.y0 }) : { x: bh.x, y: bh.y };
  let soon = n;
  if (STRIKE.predict) {
    if (n < STRIKE.first) return;
    const rate = w.time > H[0][0] ? Math.max(0, (n - H[0][1]) / (w.time - H[0][0])) : 0;
    let d = 0, k = 0; for (const u of mine) if (!ARMS[u.arm].mounted && !ARMS[u.arm].missile) { d += Math.hypot(u.ax - end.x, u.ay - end.y); k++; }
    if (k) soon += rate * (d / k / STRIKE.speed + STRIKE.word);
  }
  if (soon < STRIKE.frac * B.rec.start[bh.team]) return;
  g.struck = true; g.disposition = "aggressive";
  // the bridge's end on our bank: the company of foot nearest it goes to hold it
  if (STRIKE.party && br) {
    const ax = Math.cos(bh.axis) * bh.sign, ay = Math.sin(bh.axis) * bh.sign;
    const p = mine.filter((u) => !ARMS[u.arm].mounted && !ARMS[u.arm].missile && ARMS[u.arm].drill >= 0.4).sort((a, b) => Math.hypot(a.ax - end.x, a.ay - end.y) - Math.hypot(b.ax - end.x, b.ay - end.y))[0];
    if (p) { g.units.delete(p.id); issueOrder(w, [p.id], { kind: "move", x: end.x + ax * 6, y: end.y + ay * 6, pace: "quick", facing: Math.atan2(-ay, -ax), formation: "deep" }); }
  }
  if (g.battle) Object.assign(g.battle, { goOut: true, defend: false, centre: null, phase: "deploy" }); // (he redraws his line on the crossers and goes in)
  B.rec.moment({ kind: "strike", kicker: "They come down", text: `${cap(B.names.side(g.team))} come down on the men who have crossed`, team: g.team, good: g.team, x: bh.x, y: bh.y, sal: 0.75 });
}

// ambushes and hidden men: they wait until the enemy comes within reach (or the fight is well under way), then go in
function springLurkers(w, B) {
  if (w.tick % 20) return;
  const t = w.time - B.rec.t0;
  for (const u of w.units.values()) {
    if (!u.battleHost || !u.lurking || !u.members.length) continue;
    let near = Infinity; for (const v of w.units.values()) if (v.team !== u.team && v.battleHost && v.members.length) near = Math.min(near, Math.hypot(v.ax - u.ax, v.ay - u.ay));
    const ai = u.team === B.cmd.team;
    const late = ai && (u.role === "hidden" ? B.rec.firstContact >= 0 && t - B.rec.firstContact > 240 : (B.rec.firstContact >= 0 && t - B.rec.firstContact > 90) || t > 600);
    if (near < (u.role === "hidden" ? 320 : 260) || late) {
      u.lurking = false; u.sprung = true;
      if (ai) B.cmd.units.add(u.id);
    }
  }
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
function compass(a) { const k = Math.round((((a * 180 / Math.PI) % 360 + 360) % 360) / 45) % 8; return ["east", "north-east", "north", "north-west", "west", "south-west", "south", "south-east"][k]; }
