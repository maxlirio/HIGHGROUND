// A pitched battle in the sim (?mode=battle; headless: tools/battle-scenarios.mjs): the field made ready (the
// ground soaked by rain, generated brooks and bridges), both hosts drawn up in their zones, the enemy's AI with
// his temper, ambushes that wait for their moment, the weather and the wind, the objectives and the recorder.
// No DOM, no three.js — the frame round it is js/ui/battle-run.js.
//   prepareField(map, cfg)                 before createWorld (the nav and the going must see the changes)
//   setupBattle(w, cfg, { PLAYER, V, places }) → battle { zones, units, teamOf, sideOf, cmd, names, rec, advance() }
import { readLand } from "./landread.js";
import { zonesOf, frameOf, placeHost, applyTweaks, openBridgeNav, zonePoint } from "./battlefield.js";
import { addFeature } from "./features.js";
import { makeRecorder } from "./battle-record.js";
import { commandBattle } from "./commander-ai.js";
import { issueOrder } from "./world.js";
import { ARMS } from "./arms.js";
import { S_GONE } from "./economy.js";

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
  for (const [id, u] of [...w.units.entries()]) { if (u.isWorkers) continue; for (const m of u.members) { w.S.alive[m] = 0; w.S.state[m] = S_GONE; } w.units.delete(id); }
  if (cfg._tweaks?.bridge) openBridgeNav(w.nav, cfg._tweaks.bridge);
  const ps = cfg.playerSide ?? 0, teamOf = (side) => (side === ps ? PLAYER : 1 - PLAYER), sideOf = (team) => (team === PLAYER ? ps : 1 - ps);
  const zones = zonesOf(cfg.site, cfg.axis), F = frameOf(cfg.site, cfg.axis);
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
  // Crécy's pits before the archers on the English wings
  if (cfg.pits) for (const u of units[0]) if (ARMS[u.arm].missile) {
    const fx = Math.cos(u.facing + Math.PI / 2), fy = Math.sin(u.facing + Math.PI / 2), lx = Math.cos(u.facing), ly = Math.sin(u.facing), c = { x: u.ax + fx * 28, y: u.ay + fy * 28 };
    addFeature(w, { type: "pits_pottes", x0: c.x - lx * 30, y0: c.y - ly * 30, x1: c.x + lx * 30, y1: c.y + ly * 30, width: 6, src: "scenario", team: u.team });
  }
  // the enemy's general: his temper, his line where it stands (a defender holds the ground he drew up on)
  const aiSide = cfg.sides.findIndex((d) => d.ai), aiTeam = teamOf(aiSide), aiD = cfg.sides[aiSide];
  const cmd = { team: aiTeam, units: new Set(units[aiSide].filter((u) => !u.lurking).map((u) => u.id)), disposition: aiD.temper || "aggressive", V };
  if (["defensive", "inspiring", "skirmish", "ambusher"].includes(cmd.disposition) || aiD.hold) {
    let x = 0, y = 0, n = 0; for (const u of units[aiSide]) if (!u.lurking) { x += u.ax * u.members.length; y += u.ay * u.members.length; n += u.members.length; }
    const face = zones[aiSide].face;
    cmd.battle = { phase: "hold", defend: true, centre: { x: x / n, y: y / n }, face, aimAt: { x: zones[1 - aiSide].cx, y: zones[1 - aiSide].cy }, t0: 0 };
  } else { // an attacker is already drawn up: he goes forward at once (no second dressing of ranks on his own ground)
    let x = 0, y = 0, n = 0; for (const u of units[aiSide]) if (!u.lurking && !ARMS[u.arm].mounted && !ARMS[u.arm].missile) { x += u.ax * u.members.length; y += u.ay * u.members.length; n += u.members.length; }
    if (n) cmd.battle = { phase: "advance", defend: false, centre: { x: x / n, y: y / n }, face: zones[aiSide].face, aimAt: { x: zones[1 - aiSide].cx, y: zones[1 - aiSide].cy }, t0: -999, halted: false };
  }
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
  // the systems: the AI (after the advance), the lurkers, the recorder
  w.systems.push((w) => {
    if (battle.phase === "deploy") return;
    springLurkers(w, battle);
    // a defender behind a river strikes when as many are over as he reckons he can beat (Stirling: Moray and Wallace)
    if (ob.bridgehead && ob.bridgehead.team !== cmd.team && !cmd.struck && w.tick % 20 === 0 && battle.rec.acrossCount(ob.bridgehead) >= 0.3 * battle.rec.start[ob.bridgehead.team]) {
      cmd.struck = true; cmd.disposition = "aggressive"; if (cmd.battle) { cmd.battle.goOut = true; cmd.battle.defend = false; cmd.battle.centre = null; cmd.battle.phase = "deploy"; }
      battle.rec.moment({ kind: "strike", kicker: "They come down", text: `${cap(names.side(cmd.team))} come down on the men who have crossed`, team: cmd.team, good: cmd.team, x: ob.bridgehead.x, y: ob.bridgehead.y, sal: 0.75 });
    }
    commandBattle(w, cmd);
    chivalry(w, battle);
  });
  w.systems.push((w) => { if (battle.phase !== "deploy") battle.rec.system(w); });
  battle.advance = () => {
    battle.phase = "battle"; battle.frozen = false; battle.rec.t0 = w.time; battle.rec.moments.length = 0;
    // the enemy general's scouts have seen your array drawn up (in a pitched battle both hosts knew where the other
    // stood): he starts from that, and his own eyes take over as he closes (commander-ai remembers what it saw)
    cmd.seen ||= new Map();
    for (const u of units[ps]) if (u.members.length && !u.lurking) cmd.seen.set(u.id, { id: u.id, team: u.team, arm: u.arm, ax: u.ax, ay: u.ay, fx: u.fx, fy: u.fy, members: u.members, state: u.state, c: u.c, hold: u.hold, moving: false, retired: u.retired, live: null });
    for (const u of units[ps]) u.lurking = u.role === "hidden" ? true : false; // the player's own hidden men still count as unseen until they close
    battle.rec.moment({ kind: "advance", kicker: "The trumpets sound", text: `${cap(names.side(PLAYER))} advance their banners${cfg.name ? " — " + cfg.name + " begins" : ""}`, team: PLAYER, good: -1, sal: 0.3 });
  };
  return battle;
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
