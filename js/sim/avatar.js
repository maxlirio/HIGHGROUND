// The lord in the field: the player's own commander, a REAL soldier record in the sim.
//
// "Take the field" puts the lord — a knight on a barded destrier — down on the map with his banner-bearer and a
// household of knights around him (one wedge-formed unit: he is its apex, slot 0, and its leader; the
// banner-bearer rides at his shoulder). From then on he is simply one of the men the combat model already
// resolves: enemies see him, strike him through melee.resolveBlow, wound, unhorse, knock down, kill or take him.
//
// While the player is EMBODIED in him (third-person view, js/ui/avatar-ui.js), this module drives his body
// from w.avatar.input instead of the formation steering:
//   movement    walk / trot / gallop (Shift) on foot or horse; the horse turns and accelerates like a horse,
//               the going (goingMul), obstacles and enemy bodies stop him; horse wind (horseStep) and his own
//               W′ (locoPower → combat's exert) run down exactly as anyone else's
//   blows       left-click: a tap is a quick probing cut, a held-and-released stroke is a committed blow
//               (MC.commitE) — both resolved by melee.resolveBlow against the enemy in front within reach
//   guard       right-click / Space: shield up, passive stance (MC.stance[2]) and ×AV.guardSkill parry skill
//   charge      F: the lance couched — at ≥ AV.lanceMinV the first enemy met takes the couched-lance impact
//               (CAV.lance energy), the horse may refuse a steady hedge (cavalry.refusalP), braced spears strike it
//   dismount    E: he (and the household beside him) get down and fight on foot; E again to mount
// The mechanism is S.busyT[lord] held just ahead of the clock: world.moveUnit, combat.meleeTick and
// morale.fugitiveMove all leave a busy man alone, so the formation and melee AI never fight the player for him.
// His unit's anchor is set on him every tick, so the household forms up on him wherever he rides.
//
// Command from the saddle (§13): while he is on the field, the team's hq IS him — orders from anywhere go out
// from where he stands (command.js reads team.hq). Orders from his own mouth to companies within the voice
// range (CMD.voiceR, 30 m) are applied at once; beyond, they go by horn (≤ 250 m) or rider as usual.
//
// Presence (§11.2 leader/banner term, §11.5 leader rally): with his banner beside him, companies within
// AV.presenceR have their resting stress lowered (u.moraleMod) and their men's stress decays faster; fugitives
// within AV.rallyR stop running sooner and fall in again; a broken company whose men gather on him re-forms.
// If he falls — killed, struck down, or taken for ransom (§11.6: a lord is worth quarter) — the news runs
// through the army at a runner's pace (§11.4 rumour: ≈3 m/s, −10 % per 100 m): a one-off blow to every man's
// nerve and a lasting rise in every company's resting stress. The enemy near him takes heart. The game goes on.
//
// No DOM, no Math.random (w.rng): deterministic like the rest of the sim. Node test: tools/avatar-test.mjs.
import { addUnit, applyOrder, issueOrder, neighbours, goingMul, DT } from "./world.js";
import { S_IDLE, S_MOVE, S_FIGHT, S_DOWN, S_RALLY, S_CAPT, ST_FORMED, ST_WAVER, ST_SHAKEN, ST_FLEE, ST_RALLY, ST_LOOT, W_INSTANT, clamp } from "./soldiers.js";
import { ARM_BY_ID, ARMS } from "./arms.js";
import { WEAPON_BY_ID, M_THRUST, M_BLUNT, Z_HORSE, KIT_BY_ID, armourClass } from "./kit.js";
import { resolveBlow, knockDown, fell, MC } from "./melee.js";
import { blowFatigueMul, locoPower, horseStep, PH } from "./physio.js";
import { runSpeed, nearestEnemy50, PERC } from "./combat.js";
import { MOR, rejoin } from "./morale.js";
import { refusalP, CAV, rideStrike, rideLookAhead, trampleFallen } from "./cavalry.js";
import { CMD } from "./command.js";
import { blocked } from "./obstacles.js";
import { footing } from "./ground.js";

export const AV = {
  household: 8,              // men riding with him (banner-bearer included): a lord's household knights, a small conroi
  spawnEnemyMin: 120,        // m: no nearer to a standing enemy than this when he takes the field
  spawnFriendMax: 450,       // m: and within this of one of his companies (or his hq)
  presenceR: 60,             // m: his banner and his voice — companies this near feel him (owner brief)
  voiceR: CMD.voiceR,        // m: without the banner beside him only his voice carries
  bannerR: 25,               // m: the banner-bearer must be this near him for the banner to count
  presenceRelief: 0.006,     // stress/s off standing men within presenceR (cf. MOR.leaderNear −0.004 for a company's own captain)
  presenceBaseline: -0.05,   // added to a company's resting stress (u.moraleMod) while he is with it
  rallyR: 50,                // m: §11.5 leader rally — fugitives within this are pulled back to him
  rallyDecay: 0.012,         // stress/s off fugitives near him (MOR.rallyDecay ×3: a lord in person, shouting their names)
  rallyClear: 60,            // m: no enemy nearer the fugitive than this for him to stop (cf. 150 m without the lord)
  bannerFallStress: 0.1,    // one-off × (1.3 − nerve) to men within presenceR who see the banner go down (cf. MOR.leaderKilled 0.15)
  bannerPickup: 6,          // s before one of his household takes it up again
  bannerRaised: 0.05,       // stress off the men near it when it goes up again with the war cry
  retreatV: 3, retreatStress: 0.008, // m/s back toward home with the enemy near: the banner is seen going back (stress/s within 150 m)
  lordFallBanner: 0.6,      // × the news of his fall while his banner still stands and his name is cried (Otterburn)
  reformAfter: 30,           // s after breaking before a company can re-form on him (cf. MOR.reformMin 90 s alone)
  shoutR: 100, shoutRelief: 0.15, shoutCooldown: 45, // "Rally to me!": a one-off to fugitives within 100 m
  rumourV: 3, rumourFade: 0.1, rumourMin: 0.4,       // §11.4: runner speed, −10 %/100 m, never below 40 %
  fallStress: { killed: 0.3, down: 0.22, captured: 0.22 }, // one-off × (1.3 − nerve): the lord is lost (cf. MOR.leaderKilled 0.15 for a captain)
  fallBaseline: 0.06,        // lasting rise in every company's resting stress
  enemyHeart: 0.05,          // enemies within 150 m of his fall (MOR.enemyFlees)
  quarter: [0.9, 0.5],       // P a lord is taken rather than killed (captor discipline ≥ 0.5 / below): §11.6 high ransom
  yieldAfter: 3,             // s on the ground with two enemies over him and no friend beside him before he must yield
  ransom: 300,               // gold, paid from the treasury when there is one; he is back in 5 real minutes
  ransomOut: 300,
  // body
  speedMounted: [1.7, 4.2],  // walk, trot (m/s); gallop = the arm's run while the horse has wind (runSpeed rules)
  speedFoot: [1.3, 2.4],     // walk, jog; run = combat.runSpeed
  accel: [3.0, 4.0], decel: 5.5,
  turnFoot: 8,               // rad/s
  guardSkill: 1.25, guardSpeed: [2.0, 1.0],
  // blows (real = battle seconds: BATTLE_RATE 1)
  swingT: 0.22,              // s from release to the blow landing
  commitHold: 0.35,          // s held for a committed stroke
  fullHold: 0.9,             // s held for the heaviest
  recover: [0.6, 1.05],      // s before the next stroke (quick / committed)
  arc: 0.95,                 // rad either side of where he looks
  quickE: [0.25, 0.5],       // × base energy of a quick cut (a probe, but aimed)
  lanceMinV: 4,              // m/s for a couched-lance strike
  lordRefuse: 0.4,           // × the refusal rule for his own horse (a great lord's destrier, schooled for this)
  chargeV: 5,                // m/s: galloping on horseback is a charge (rideStrike momentum, the household with him)
  impactGap: 0.8,            // s between impacts in one charge
  lanceRearm: 6,             // s out of contact beside his household before a squire hands him a fresh lance
};

export const LORD_ORDERS = [
  { key: "follow", label: "Follow me!" },
  { key: "charge", label: "Charge!" },
  { key: "hold", label: "Hold!" },
  { key: "rally", label: "Rally to me!" },
  { key: "line", label: "Form line" },
  { key: "wedge", label: "Form wedge" },
];

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const nb = [];

// ---------------------------------------------------------------- taking the field
export function canTakeField(w, team, x, y) {
  const A = w.avatar, S = w.S;
  if (A && !A.outcome && S.alive[A.lord]) return "Your lord is already in the field";
  if (A?.outcome && A.backAt > w.time) return A.outcome === "captured" ? `Your lord is held for ransom (back in ${Math.ceil(A.backAt - w.time)} s)` : "Your lord has fallen";
  if (A?.outcome && A.backAt === Infinity) return "Your lord has fallen";
  const M = 40;
  if (!(x > M && y > M && x < w.map.size - M && y < w.map.size - M)) return "Too near the edge of the world";
  if (w.map.water(x, y) > 0.8) return "Not in deep water";
  if (w.obstacles && blocked(w.obstacles, x, y, 2)) return "Something stands there — pick open ground";
  let ed = 1e9;
  for (let i = 0; i < S.n; i++) {
    if (!S.alive[i] || S.team[i] === team || S.team[i] > 1 || S.status[i] === ST_FLEE) continue;
    const u = w.units.get(S.unit[i]); if (!u || u.isWorkers) continue;
    const d = Math.hypot(S.x[i] - x, S.y[i] - y); if (d < ed) ed = d;
  }
  if (ed < AV.spawnEnemyMin) return `Too near the enemy (${Math.round(ed)} m) — take the field behind your own lines`;
  let fd = 1e9;
  for (const u of w.units.values()) if (u.team === team && !u.isWorkers && u.members.length && !u.household) fd = Math.min(fd, Math.hypot(u.ax - x, u.ay - y));
  const hq = w.teams[team]?.hq; if (hq) fd = Math.min(fd, Math.hypot(hq.x - x, hq.y - y));
  const town = w.teams[team]?.town; if (town) fd = Math.min(fd, Math.hypot(town.x - x, town.y - y));
  if (fd > AV.spawnFriendMax) return "Too far from your men — take the field near your troops";
  return null;
}

// Put the lord and his household on the field at (x, y). Returns { lord, unit } or { error }.
export function takeField(w, team, x, y, { facing, household = AV.household } = {}) {
  const why = canTakeField(w, team, x, y); if (why) return { error: why };
  const S = w.S;
  if (facing === undefined) { // face the enemy's mass
    let ex = 0, ey = 0, n = 0;
    for (const u of w.units.values()) if (u.team !== team && !u.isWorkers && u.members.length) { ex += u.ax * u.members.length; ey += u.ay * u.members.length; n += u.members.length; }
    facing = n ? Math.atan2(ey / n - y, ex / n - x) : 0;
  }
  const u = addUnit(w, { team, arm: "knights", count: household + 1, x, y, facing: facing - Math.PI / 2, formation: "wedge", training: 0.8 });
  u.noAI = true; u.household = true; u.supply = { food: 1e7, arrows: 0, carts: 0, packhorses: 0 };
  const lord = u.members[0], banner = u.members[1];
  // the lord himself: a seasoned knight in full harness on a barded destrier
  S.skill[lord] = 0.85; S.courage[lord] = S.nerve0[lord] = 0.95; S.disc[lord] = 0.9; S.strength[lord] = Math.max(S.strength[lord], 0.8);
  S.aggr[lord] = 0; S.legend[lord] = 3;
  { // a lord goes to war in every piece of harness his kit allows (every layer of kit "maa"), his destrier barded
    const K = KIT_BY_ID[S.kit[lord]]; let m = 0;
    for (let z = 0; z < 8; z++) for (let l = 0; l < Math.min(3, K.z[z].length); l++) m |= 1 << (z * 3 + l);
    S.kitMask[lord] = (m | (1 << 30)) >>> 0; S.armour[lord] = armourClass(S.kit[lord], S.kitMask[lord]);
  }
  if (banner !== undefined) { S.courage[banner] = Math.max(S.courage[banner], 0.85); }
  const prev = w.avatar;
  const A = w.avatar = {
    team, lord, banner: banner ?? -1, unit: u.id, embodied: false, outcome: null, backAt: 0,
    heading: facing, aim: facing, speed: 0, mounted: true, guard: false, couched: false, lanceBroken: false,
    input: { mx: 0, my: 0, gait: 1, aim: facing, guard: false, down: false, releases: [], charge: false, mount: false },
    wind: -1, swingAt: -1, swingCommit: 0, swingUntil: -1, nextSwing: 0, lastImpact: -1, stunUntil: -1, boltUntil: -1, rearmT: 0,
    target: -1, fx: [], follow: new Map(), rumour: prev?.rumour || [], shoutT: -1e9, mods: new Map(), hq: { x, y }, hqSaved: w.teams[team]?.hq || null,
    t0: w.time, kills0: S.kills[lord], stats: { blows: 0, hits: 0, wounds: 0, kills: 0, rallied: 0, reformed: 0, impacts: 0, refused: 0, taken: 0 },
    pinnedT: 0, horseType: S.horse[lord], guardMul: 1, bannerState: banner !== undefined ? "up" : "lost", bannerAt: { x, y }, bannerDownT: -1, retreating: false,
  };
  if (w.teams[team]) w.teams[team].hq = A.hq; // from now on his orders go out from where he stands
  if (!w.systems.includes(avatarSystem)) w.systems.push(avatarSystem); // (after combat: reads what it resolved this tick)
  w.events.push({ t: w.tick, kind: "lord-takes-field", team, x, y, who: lord });
  return { lord, unit: u };
}

// Enter / leave the lord's body (Tab). The sim never pauses; out of his body he is an ordinary knight of his
// household, fighting where he stands, and his company can be selected and ordered like any other.
export function embody(w, on) {
  const A = w.avatar; if (!A || A.outcome) return false;
  const S = w.S, L = A.lord;
  if (on && !A.embodied) {
    A.embodied = true; A.heading = A.aim = S.facing[L]; A.speed = Math.hypot(S.vx[L], S.vy[L]); A.input.aim = A.heading;
    A.input.releases.length = 0; A.wind = -1;
  } else if (!on && A.embodied) {
    A.embodied = false; setGuard(w, A, false); A.couched = false; A.wind = -1;
    const u = w.units.get(S.unit[L]); if (u) { u.path = null; u.order = { kind: "hold", x: u.ax, y: u.ay, facing: A.heading }; u.finalFacing = A.heading; }
    if (S.busyT[L] > w.time) S.busyT[L] = w.time;
  }
  return true;
}

// ---------------------------------------------------------------- the system (every tick, after combat)
export function avatarSystem(w) {
  const A = w.avatar; if (!A) return;
  rumourTick(w, A);
  if (A.outcome) { if (A.outcome === "captured" && A.backAt <= w.time && A.backAt > 0) A.outcome = "ransomed"; return; }
  const S = w.S, t = w.time, L = A.lord;
  if (!ensureHooks(w, A)) return;
  // ---- has he fallen?
  if (!S.alive[L] || S.state[L] === S_CAPT) { lordLost(w, A, S.state[L] === S_CAPT ? "captured" : S.state[L] === S_DOWN ? downed(w, A) : "killed"); return; }
  if (S.posture[L] === 1 && yieldCheck(w, A)) return;
  A.unit = S.unit[L]; // (box-select may have split his household)
  const u = w.units.get(A.unit);
  if (u?.c && !A.ledSet) { // he leads his household; the banner rides beside him (combat.unitC picked others)
    for (const id of u.members) if (S.role[id]) S.role[id] = 0;
    u.c.leader = L; S.role[L] = 1; if (A.banner >= 0 && S.alive[A.banner]) S.role[A.banner] = 2; A.ledSet = true;
  }
  A.mounted = S.horseOK[L] === 1 || S.horseOK[L] === 2;
  if (A.embodied) drive(w, A, u);
  if (w.teams[A.team]) { A.hq.x = S.x[L]; A.hq.y = S.y[L]; w.teams[A.team].hq = A.hq; }
  bannerTick(w, A);
  if (w.tick % PERC === 0) presence(w, A);
  if (w.tick % 20 === 7) followTick(w, A);
}

// his blows and wounds, for the HUD's feedback (camera shake, sound hooks): melee's optional onWound
function ensureHooks(w, A) {
  const cs = w.cs; if (!cs?.ctx) return false;
  if (cs.ctx.avatarHooked) return true;
  const prev = cs.ctx.onWound;
  cs.ctx.onWound = (d, a, sev, z, cause) => {
    prev?.(d, a, sev, z, cause);
    const B = w.avatar; if (!B || B.outcome) return;
    if (d === B.lord) { B.fx.push({ kind: z === Z_HORSE ? "horse-hit" : "hurt", sev, by: a, t: w.time }); B.stats.wounds++; }
  };
  cs.ctx.avatarHooked = true;
  return true;
}

// ---------------------------------------------------------------- driving his body
function drive(w, A, u) {
  const S = w.S, t = w.time, L = A.lord, inp = A.input, rng = w.rng;
  const Arm = ARM_BY_ID[S.arm[L]];
  // the player is his nerve: the lord in person does not run unless the player rides away
  if (S.status[L] === ST_FLEE || S.status[L] === ST_RALLY) { S.status[L] = ST_FORMED; if (u?.c) u.c.fled = Math.max(0, u.c.fled - 1); }
  if (S.stress[L] > 0.6) S.stress[L] = 0.6;
  A.aim = inp.aim;
  const down = S.posture[L] !== 0 || S.stunT[L] > t;
  // ---- mount / dismount
  if (inp.mount) { inp.mount = false; if (!down) toggleMount(w, A, u); }
  const mounted = S.horseOK[L] === 1;
  // a pricked horse bolts (melee.horseWound): it carries him off for the seconds melee gave it
  if (S.horseOK[L] === 2) { if (A.boltUntil < 0) { A.boltUntil = Math.min(t + 12, Math.max(t + 4, S.busyT[L])); A.fx.push({ kind: "bolt", t }); } }
  if (A.boltUntil >= 0 && (t >= A.boltUntil || S.horseOK[L] !== 2)) { if (S.horseOK[L] === 2) S.horseOK[L] = 1; A.boltUntil = -1; }
  const bolting = A.boltUntil >= 0;
  // ---- guard
  setGuard(w, A, !!inp.guard && !down && A.swingAt < 0 && !bolting);
  // ---- the stroke: press winds it up, release lets it go (the release queue is filled by the UI)
  if (inp.down && A.wind < 0 && !A.guard && !down) A.wind = t;
  while (inp.releases.length) {
    const held = inp.releases.shift();
    if (A.guard || down || bolting || A.swingAt >= 0 || t < A.nextSwing) { A.wind = -1; continue; }
    const commit = held >= AV.commitHold ? clamp((held - AV.commitHold) / (AV.fullHold - AV.commitHold), 0, 1) : -1;
    A.swingAt = t + AV.swingT; A.swingCommit = commit; A.swingUntil = t + AV.swingT + 0.45;
    A.nextSwing = t + AV.swingT + AV.recover[commit >= 0 ? 1 : 0];
    A.wind = -1; A.stats.blows++;
  }
  if (!inp.down && A.wind >= 0 && !inp.releases.length) A.wind = -1;
  if (A.swingAt >= 0 && t >= A.swingAt) { strike(w, A); A.swingAt = -1; }
  // ---- charge: the lance couched (mounted, lance in hand)
  const hasLance = WEAPON_BY_ID[S.weapon[L]].couched;
  A.couched = !!inp.charge && mounted && hasLance && !A.guard;
  // ---- where he wants to go
  let tgtV = 0, dx = Math.cos(A.heading), dy = Math.sin(A.heading);
  const ml = Math.hypot(inp.mx, inp.my);
  const gait = clamp(inp.gait | 0, 0, 2);
  if (!down && t >= A.stunUntil && (ml > 0.1 || A.couched || bolting)) {
    let want = ml > 0.1 ? Math.atan2(inp.my, inp.mx) : A.heading;
    if (bolting) want = A.heading + (rng.next() - 0.5) * 0.3;
    if (mounted || bolting) {
      const rate = clamp(2.6 - 0.18 * A.speed, 1.0, 2.6) * DT, d = wrap(want - A.heading);
      A.heading += clamp(d, -rate, rate);
      const fast = S.hwbal[L] > 0.4 * S.hwp[L] ? Arm.run : S.hwbal[L] > 60 ? Math.min(Arm.run, 6.5) : 3.6;
      tgtV = bolting ? 7.5 : A.couched ? fast : gait === 2 ? fast : AV.speedMounted[gait];
      if (Math.abs(d) > 2.2 && A.speed > 3) tgtV = Math.min(tgtV, 2); // hauling a galloping horse round
    } else {
      const d = wrap(want - A.heading), rate = AV.turnFoot * DT;
      A.heading += clamp(d, -rate, rate);
      tgtV = gait === 2 ? runSpeed(S, L, u || {}) : AV.speedFoot[gait];
    }
    if (A.guard) tgtV = Math.min(tgtV, AV.guardSpeed[mounted ? 0 : 1]);
    // on foot he walks where he means to (and may step sideways or back); a horse goes where its head points
    if (mounted || bolting) { dx = Math.cos(A.heading); dy = Math.sin(A.heading); }
    else if (ml > 0.1) { dx = inp.mx / ml; dy = inp.my / ml; }
  }
  if (!mounted && !bolting && ml > 0.1 && !down) { // an unhorsed man in full harness is slow; a run is short
    const wf = S.wbal[L] / S.wp[L]; if (wf < 0.15) tgtV = Math.min(tgtV, AV.speedFoot[0]);
  }
  const acc = (mounted ? AV.accel[0] : AV.accel[1]) * DT;
  A.speed += clamp(tgtV - A.speed, -AV.decel * DT, acc);
  if (A.speed < 0.02) A.speed = 0;
  // ---- the charge: once he is galloping on horseback it is a charge — his horse's momentum, not his sword arm,
  // does the work (cavalry.rideStrike: men flung aside, the horse slowed by each; a braced point stops it) and his
  // household ride it with him (householdRide)
  if (mounted && !bolting && A.speed > AV.chargeV && !A.ride && !down) {
    A.ride = { v: A.speed, hx: dx, hy: dy, hit: 0, t0: t, slowT: 0 };
    if (u?.c) u.c.chargeStart = t;
    startHousehold(w, A, u);
  }
  if (A.ride) { A.ride.slowT = A.speed < 1.5 || !mounted ? A.ride.slowT + DT : 0; if (A.ride.slowT > 1 || down) A.ride = null; }
  // ---- move
  const x = S.x[L], y = S.y[L];
  let nx = x, ny = y;
  if (A.speed > 0) {
    let g = (S.lvl[L] ? 1 : goingMul(w, S.arm[L], x, y, dx, dy)) || 0.05; // (castle.js: the Lord up on a wall-walk or a floor)
    // in ground that will not bear him (a bog a horse sinks in, a deep brook) he does not creep on at a crawl for
    // ever: the horse plunges toward the nearest firm ground — his way, if it leads out, else the nearest out
    // ground ahead that will not bear a horse (a bog, a deep brook): the horse will not go into it — he pulls up at
    // the edge, and the player is told why (go round it, or get down and go on foot)
    if (mounted && g >= 0.06 && goingMul(w, S.arm[L], x + dx * 2, y + dy * 2, dx, dy) < 0.06) {
      A.speed = Math.min(A.speed, 0.4); g = 0;
      if (t - (A.bogMsgT ?? -99) > 6) { A.bogMsgT = t; A.fx.push({ kind: "msg", text: "The ground ahead won't bear your horse — go round it, or dismount (E)", t }); }
    }
    else if (g < 0.06) {
      let bx = dx, by = dy, bg = 0;
      for (let a = 0; a < 8; a++) { const cx = Math.cos(A.heading + a * 0.785), cy = Math.sin(A.heading + a * 0.785); for (const r of [3, 6, 10]) { const gg = goingMul(w, S.arm[L], x + cx * r, y + cy * r, cx, cy) / r * (a === 0 ? 1.5 : 1); if (gg > bg) { bg = gg; bx = cx; by = cy; } } }
      if (bg > 0) { dx = bx; dy = by; g = 0.3; if (mounted) A.heading = Math.atan2(by, bx); }
    }
    const step = A.speed * g * DT;
    nx = x + dx * step; ny = y + dy * step;
    // (the pad keeps a horse's shoulders off a trunk or a wall; but obstacleSystem only pushes a body out to the
    // man's own 0.28 m, so a rider standing inside the pad — he rode up to a tree, men shoved him there — found
    // EVERY step "blocked", even straight away from it, and his speed settled at 0.3 m/s with the horse not
    // moving: the lord who "moves a foot every 3 s and sits there". Inside the pad only a step that brings him
    // nearer the obstacle is refused.)
    let pad = mounted ? 0.9 : 0.35;
    if (w.obstacles && blocked(w.obstacles, x, y, pad)) pad = 0.3;
    // (already INSIDE one — shoved into a hedge by the press — every step would read "blocked": he just rides out)
    if (w.obstacles && !blocked(w.obstacles, x, y, 0) && blocked(w.obstacles, nx, ny, pad)) {
      let slide = !blocked(w.obstacles, nx, y, pad) ? (ny = y, 1) : !blocked(w.obstacles, x, ny, pad) ? (nx = x, 1) : 0;
      if (!slide) for (const off of [0.5, -0.5, 1.0, -1.0, 1.57, -1.57]) { // glances off it (or slides along it) at an angle, as a horse does, rather than standing pressed against it
        const c = Math.cos(off), sn = Math.sin(off), qx = x + (dx * c - dy * sn) * step, qy = y + (dx * sn + dy * c) * step;
        if (!blocked(w.obstacles, qx, qy, pad)) { nx = qx; ny = qy; slide = 1; break; }
      }
      if (!slide) { nx = x; ny = y; }
      // stopped dead against it he loses his way; sliding along a hedge or a wall he is slowed to a trot, not a crawl
      A.speed = slide && Math.hypot(nx - x, ny - y) > 0.3 * step ? Math.max(Math.min(A.speed, 2.5), A.speed * 0.85) : A.speed * 0.5;
    }
    // bodies in the way: a friend gives way, an enemy does not — a horse at speed meets him
    const body = mounted ? 1.5 : 0.75, lanceR = A.couched ? 3.2 : body; // (the couched lance meets him at its length)
    neighbours(w, nx, ny, Math.max(body, lanceR), nb);
    for (const o of nb) {
      if (o === L || !S.alive[o] || S.state[o] === S_CAPT) continue;
      const ox = S.x[o] - nx, oy = S.y[o] - ny, od = Math.hypot(ox, oy) || 0.01;
      if ((ox * dx + oy * dy) / od < 0.3) continue; // not in front of him
      if (S.team[o] === S.team[L]) { if (od < body) { const sd = Math.sign(ox * -dy + oy * dx) || 1; S.x[o] += -dy * sd * 0.15; S.y[o] += dx * sd * 0.15; } continue; }
      if (A.ride && mounted && S.posture[o] !== 0 && S.horseOK[o] !== 1 && od < 1.0 && A.speed > 3) { // ridden over where he lies
        const key = L * 65536 + o, TR = (w.cs.trampled ||= new Map()); if (TR.get(key) >= A.ride.t0) continue; TR.set(key, t);
        const R = A.ride; R.v = A.speed; R.hx = dx; R.hy = dy; trampleFallen(w, w.cs, L, o, R); A.speed = R.v; A.stats.impacts++; A.fx.push({ kind: "trample", target: o, t }); continue;
      }
      if (S.status[o] === ST_FLEE || S.posture[o] !== 0) continue;
      if (A.ride && mounted && A.speed >= CAV.stuckV && od < (A.couched && !A.ride.hit ? lanceR : Math.max(body, 1.1 + A.speed * DT))) {
        const key = L * 65536 + o, TR = (w.cs.trampled ||= new Map()); if (TR.get(key) >= A.ride.t0) continue; TR.set(key, t);
        const R = A.ride; R.v = A.speed; R.hx = dx; R.hy = dy;
        if (!R.hit) { if (impact(w, A, o, A.speed) === "refused") { nx = x; ny = y; break; } R.hit = 1; if (S.horseOK[L] !== 1) { nx = x; ny = y; break; } }
        rideStrike(w, w.cs, u || { c: { chargeStart: R.t0 } }, L, o, R, -ox * dy + oy * dx, 1);
        A.speed = R.v; A.stats.impacts++;
        if (A.speed < CAV.stuckV) { nx = x; ny = y; A.fx.push({ kind: "stuck", t }); break; } // stopped in the press: now it is swords
        continue;
      }
      const fast = mounted && A.speed >= AV.lanceMinV && t - A.lastImpact > AV.impactGap;
      if (fast && od < (A.couched ? lanceR : body)) { const r = impact(w, A, o, A.speed); if (r !== "through") { nx = x; ny = y; } break; }
      if (od < body) { nx = x; ny = y; A.speed = Math.min(A.speed, 0.5); break; }
    }
  }
  const M = 3; nx = clamp(nx, M, w.map.size - M); ny = clamp(ny, M, w.map.size - M);
  S.vx[L] = (nx - x) / DT; S.vy[L] = (ny - y) / DT; S.x[L] = nx; S.y[L] = ny;
  S.facing[L] = mounted || bolting ? A.heading : (Math.abs(wrap(A.aim - A.heading)) < 2.2 ? A.aim : A.heading);
  if (!mounted && !bolting) A.heading = A.speed > 0.3 && ml > 0.1 ? A.heading : S.facing[L];
  // ---- exertion (combat.exert integrates S.power into his W′; the horse's wind is its own)
  const v = Math.hypot(S.vx[L], S.vy[L]);
  if (mounted || bolting) { horseStep(S, L, v, DT); S.power[L] = v > 5 ? 250 : 130; }
  else S.power[L] = locoPower(S, L, v, w.map.gradeAlong(nx, ny, dx, dy) * 100, 1.1);
  if (A.wind >= 0) S.power[L] = Math.max(S.power[L], PH.hold);
  if (A.guard) S.power[L] = Math.max(S.power[L], PH.hold);
  if (t < A.swingUntil) S.power[L] = Math.max(S.power[L], PH.flurry[0]);
  // ---- what the figure shows: a stroke while he swings, otherwise his gait
  S.state[L] = t < A.swingUntil || A.wind >= 0 ? S_FIGHT : v > 0.3 ? S_MOVE : S_IDLE;
  if (S.state[L] !== S_FIGHT) S.foe[L] = -1;
  S.busyT[L] = t + 0.25; // (the formation and the melee AI leave him to the player)
  // the enemy in front within reach, for the reticle
  A.target = pickTarget(w, A, 1.5);
  // ---- a fresh lance from his squire: out of contact, slow, beside his household
  if (mounted && !hasLance && A.lanceBroken) {
    const safe = nearestEnemy50(w.cs, S.team[L], nx, ny, 120) > 60 && v < 2.5;
    A.rearmT = safe ? A.rearmT + DT : 0;
    if (A.rearmT > AV.lanceRearm) { S.weapon[L] = WEAPON_BY_ID.findIndex((q) => q.key === "lance"); A.lanceBroken = false; A.rearmT = 0; A.fx.push({ kind: "lance", t }); }
  }
  if (A.hride) householdRide(w, A, u);
  // ---- his household forms on him
  if (u) {
    u.ax = nx; u.ay = ny; u.facing = A.heading - Math.PI / 2; u.finalFacing = A.heading;
    if (v > 0.4) { u.path = [[nx + Math.cos(A.heading) * 25, ny + Math.sin(A.heading) * 25]]; u.pace = v > 5 ? "charge" : v > 2.5 ? "quick" : "march"; }
    else u.path = null;
    const o = u.order?.lordHold ? u.order : (u.order = { kind: "hold", lordHold: true });
    o.kind = "hold"; o.x = nx; o.y = ny; o.facing = A.heading;
  }
}

// "A unit whose lord charges goes with him" (battle-feel §6.3): his household keep their places about him — each
// rider holds his offset in the lord's frame — at the gallop, and every horse strikes what is in front of it as
// cavalry.rideCharge's riders do. When the lord is stopped, those who have not struck ride on through; a rider
// stopped in the press fights where he is. Then they fall back into their wedge on him.
function startHousehold(w, A, u) {
  if (!u) return; const S = w.S, L = A.lord, h = A.heading, hx = Math.cos(h), hy = Math.sin(h);
  A.hride = new Map();
  for (const r of u.members) {
    if (r === L || !S.alive[r] || S.horseOK[r] !== 1 || S.status[r] >= ST_FLEE || S.posture[r]) continue;
    const ox = S.x[r] - S.x[L], oy = S.y[r] - S.y[L]; if (Math.hypot(ox, oy) > 30) continue;
    A.hride.set(r, { along: ox * hx + oy * hy, lat: -ox * hy + oy * hx, v: Math.max(3, Math.hypot(S.vx[r], S.vy[r])), hx, hy, hit: 0, done: 0 });
  }
}
function householdRide(w, A, u) {
  const S = w.S, t = w.time, L = A.lord, cs = w.cs, H = A.hride;
  const h = A.heading, lhx = Math.cos(h), lhy = Math.sin(h), lead = A.ride && S.alive[L];
  const t0 = u?.c?.chargeStart ?? t; let active = 0;
  for (const [r, R] of H) {
    if (R.done) continue;
    if (!S.alive[r] || S.horseOK[r] !== 1 || S.status[r] >= ST_FLEE || S.posture[r]) { R.done = 1; continue; }
    if (S.busyT[r] > t + 0.35) { if (R.hit) { R.done = 1; S.pursueT[r] = t; } else R.v = Math.min(R.v, 1); continue; } // balked / refused
    active++;
    let hx = R.hx, hy = R.hy;
    if (lead && !R.hit) { // keep his place on the lord: steer at it (a few lengths ahead of it), and match his pace
      const px = S.x[L] + lhx * R.along - lhy * R.lat, py = S.y[L] + lhy * R.along + lhx * R.lat;
      const gx = px + lhx * 6 - S.x[r], gy = py + lhy * 6 - S.y[r], gl = Math.hypot(gx, gy) || 1;
      const want = Math.atan2(gy / gl, gx / gl), have = Math.atan2(hy, hx), tr = (R.v > 6 ? CAV.turn[1] * 2 : CAV.turn[0] * 2) * DT;
      const na = have + clamp(wrap(want - have), -tr, tr); hx = R.hx = Math.cos(na); hy = R.hy = Math.sin(na);
      const behind = (px - S.x[r]) * lhx + (py - S.y[r]) * lhy;
      const vw = clamp(A.speed + clamp(behind * 0.6, -2, 2), 0, runSpeed(S, r, u || {}));
      R.v += clamp(vw - R.v, -3 * DT, CAV.accel * DT);
    } else if (!lead && !R.hit) R.v = Math.max(0, R.v - 1.2 * DT); // he has been stopped: they ride on and rein in
    // what is in front of the horse
    const reach = 1.1 + R.v * DT;
    if (R.v > 2) {
      neighbours(w, S.x[r] + hx * reach * 0.5, S.y[r] + hy * reach * 0.5, reach, nb);
      for (const o of nb) {
        if (R.done || S.team[o] === S.team[r] || !S.alive[o] || S.state[o] === S_CAPT) continue;
        const ox = S.x[o] - S.x[r], oy = S.y[o] - S.y[r], along = ox * hx + oy * hy, lat = -ox * hy + oy * hx;
        if (along < -0.3 || Math.abs(lat) > 0.9) continue;
        const key = r * 65536 + o, TR = (cs.trampled ||= new Map()); if (TR.get(key) >= t0) continue; TR.set(key, t);
        if (S.posture[o] && S.horseOK[o] !== 1) { trampleFallen(w, cs, r, o, R); continue; }
        if (u?.c) rideStrike(w, cs, u, r, o, R, lat, 1);
      }
      if (R.done) continue;
      if (((w.tick + r) & 3) === 0 && R.v > 4) rideLookAhead(w, cs, r, hx, hy);
    }
    S.x[r] = clamp(S.x[r] + hx * R.v * DT, 1, w.map.size - 1); S.y[r] = clamp(S.y[r] + hy * R.v * DT, 1, w.map.size - 1);
    S.vx[r] = hx * R.v; S.vy[r] = hy * R.v; S.facing[r] = Math.atan2(hy, hx); S.state[r] = S_MOVE; S.foe[r] = -1;
    S.busyT[r] = t + 0.3; S.power[r] = 250; horseStep(S, r, R.v, DT);
    if ((R.hit && R.v < CAV.stuckV) || (!lead && R.v < 2)) { R.done = 1; S.pursueT[r] = t; S.busyT[r] = t; }
  }
  if (!active && !lead) A.hride = null;
}

function setGuard(w, A, on) {
  const S = w.S, L = A.lord;
  if (on === A.guard) return;
  A.guard = on;
  // shield up and a passive stance: the parry roll's stance term (MC.stance[2]) and ×guardSkill parry skill
  if (on) { A.aggr0 = S.aggr[L]; S.aggr[L] = 2; S.skillMul[L] *= AV.guardSkill; }
  else { S.aggr[L] = A.aggr0 ?? 0; S.skillMul[L] /= AV.guardSkill; }
}

function toggleMount(w, A, u) {
  const S = w.S, L = A.lord, t = w.time;
  const party = (u?.members || [L]).filter((id) => S.alive[id] && S.posture[id] === 0 && Math.hypot(S.x[id] - S.x[L], S.y[id] - S.y[L]) < 25);
  if (!party.includes(L)) party.unshift(L);
  if (S.horseOK[L] === 1) {
    if (A.speed > 2.5) { A.fx.push({ kind: "msg", text: "Rein in before you dismount", t }); return; }
    for (const id of party) {
      if (S.horseOK[id] !== 1) continue;
      // led away by the pages: horse gone from under him, not fallen (S.horse = 0 — js/render/figures.js reads
      // that as "dismounted", docs/anim-sim-signals.md). A knight on foot fights with his sword.
      S.horseOK[id] = 0; S.horse[id] = 0; S.vx[id] = S.vy[id] = 0;
      if (WEAPON_BY_ID[S.weapon[id]].couched) S.weapon[id] = S.side[id];
    }
    A.speed = 0; A.couched = false; A.dismounted = true;
    A.fx.push({ kind: "dismount", t }); w.events.push({ t: w.tick, kind: "lord-dismounts", team: A.team });
  } else if (S.horseOK[L] === 0) {
    if (S.horse[L] !== 0 || !A.dismounted) { A.fx.push({ kind: "msg", text: "Your horse is lost", t }); return; }
    for (const id of party) {
      if (S.horseOK[id] !== 0 || S.horse[id] !== 0) continue; // (a man whose horse was killed stays on foot)
      S.horse[id] = ARMS.knights.horse; S.horseOK[id] = 1;
    }
    if (!A.lanceBroken) S.weapon[L] = WEAPON_BY_ID.findIndex((q) => q.key === "lance");
    A.dismounted = false; A.fx.push({ kind: "mount", t }); w.events.push({ t: w.tick, kind: "lord-mounts", team: A.team });
  }
}

// the enemy in front of him within his weapon's reach (+ slack), best by distance and how square he faces him
function pickTarget(w, A, slack = 0.5) {
  const S = w.S, L = A.lord, mounted = S.horseOK[L] === 1;
  const W = WEAPON_BY_ID[S.weapon[L]], reach = W.reach + 0.5 + (mounted ? 0.8 : 0) + slack;
  neighbours(w, S.x[L], S.y[L], reach, nb);
  let best = -1, bs = 1e9;
  for (const o of nb) {
    if (o === L || S.team[o] === S.team[L] || !S.alive[o] || S.state[o] === S_CAPT) continue;
    const dx = S.x[o] - S.x[L], dy = S.y[o] - S.y[L], d = Math.hypot(dx, dy);
    const off = Math.abs(wrap(Math.atan2(dy, dx) - A.aim)); if (off > AV.arc) continue;
    const s = d + off * 1.5; if (s < bs) { bs = s; best = o; }
  }
  return best;
}

// A blow of his, resolved by the sim's own melee resolution. The energy is set here from how he struck: a
// tap is a quick aimed cut (AV.quickE of the weapon's energy), a held stroke a committed blow (MC.commitE, more
// the longer it was drawn back) — then everything else (parry, shield, zone, armour, wound) is resolveBlow's.
function strike(w, A) {
  const S = w.S, L = A.lord, rng = w.rng, cs = w.cs, t = w.time;
  const e = pickTarget(w, A, 0);
  if (e < 0) { A.fx.push({ kind: "whiff", t }); w.events.push({ t: w.tick, kind: "avatar-blow", res: -2 }); return; }
  const Wp = WEAPON_BY_ID[S.weapon[L]], mounted = S.horseOK[L] === 1;
  let mode = Wp.modes[0], bv = -1;
  for (const k of Wp.modes) { const v = Wp.Eb[k] * (k === M_THRUST ? 1.15 : k === M_BLUNT ? 1.05 : 1); if (v > bv) { bv = v; mode = k; } }
  const dx = S.x[e] - S.x[L], dy = S.y[e] - S.y[L], dist = Math.hypot(dx, dy) || 0.01;
  const commit = A.swingCommit;
  const cm = commit >= 0 ? [MC.commitE[0] + (MC.commitE[1] - MC.commitE[0]) * 0.5 * commit, MC.commitE[1] * (0.9 + 0.1 * commit)] : AV.quickE;
  let E = (Wp.couched ? MC.lanceArmE : Wp.Eb[mode]) * (0.6 + 0.6 * S.strength[L]) * blowFatigueMul(S.wbal[L] / S.wp[L]) * rng.range(cm[0], cm[1]);
  if (dist > 0.8 * Wp.reach) E *= clamp(1 - 0.5 * (dist - 0.8 * Wp.reach) / (0.2 * Wp.reach + 0.5), 0.5, 1); // (as resolveBlow does for its own)
  const bearing = Math.atan2(S.y[L] - S.y[e], S.x[L] - S.x[e]);
  const ha = w.map.h(S.x[L], S.y[L]) + (mounted ? 1 : 0), hd = w.map.h(S.x[e], S.y[e]) + (S.horseOK[e] === 1 ? 1 : 0);
  const g = { off: wrap(S.facing[e] - bearing), nAtk: Math.max(1, cs.nAtk[e]), dist, dh: ha - hd, grade: dist > 0.3 ? (ha - hd) / Math.max(dist, 1) * 100 : 0,
    flurryAge: 10, footD: footing(w, S.x[e], S.y[e], { slip: 0, fall: 0 }), footA: footing(w, S.x[L], S.y[L], { slip: 0, fall: 0 }), defBonus: 0, ag: 0, E, mode };
  S.facing[L] = Math.atan2(dy, dx);
  const was = S.alive[e];
  const res = resolveBlow(cs.ctx, L, e, g);
  cs.nAtkNext[e] = Math.min(255, cs.nAtkNext[e] + 1);
  if (t - S.atkTime[L] > 10) S.atkTime[L] = t;
  const killed = was && !S.alive[e];
  if (res >= 3) A.stats.hits++;
  if (killed) A.stats.kills++;
  A.fx.push({ kind: killed ? "kill" : res >= 3 ? "hit" : res === 2 ? "glance" : res === 1 ? "blocked" : "parried", sev: res - 1, target: e, commit, t });
  w.events.push({ t: w.tick, kind: "avatar-blow", res, target: e, killed, commit });
  w.events.push({ t: w.tick, kind: "blow", a: L, d: e, res, dx: dx / dist, dy: dy / dist }); // (docs/anim-sim-signals.md §1)
}

// A horse at speed meets a man (§10.2, as cavalry.impact): the refusal rule, braced points taking the horse, the
// couched lance, the knock-down. "through" = he rides on; otherwise he is stopped in the press.
function impact(w, A, e, v, L = A.lord) {
  const S = w.S, t = w.time, rng = w.rng, cs = w.cs, ctx = cs.ctx, me = L === A.lord;
  if (me) A.lastImpact = t;
  const tv = w.units.get(S.unit[e]), mountedE = S.horseOK[e] === 1;
  const hx = me ? Math.cos(A.heading) : S.vx[L] / (v || 1), hy = me ? Math.sin(A.heading) : S.vy[L] / (v || 1);
  const pRef = (mountedE ? 0.1 : refusalP(w, cs, L, e, tv || {}, 1.1, 1)) * (me ? AV.lordRefuse : 1); // (the best-schooled destrier on the field, and he rides it at them)
  if (rng.next() < pRef) {
    if (me) { A.speed = 0; A.couched = false; A.input.charge = false; A.stunUntil = t + rng.range(1.2, 2.5); A.stats.refused++; A.fx.push({ kind: "refuse", t }); }
    S.x[L] -= hx * 1.5; S.y[L] -= hy * 1.5; S.vx[L] = S.vy[L] = 0; S.stress[L] += 0.08 * (1.3 - S.courage[L]);
    S.busyT[L] = t + (me ? 1 : rng.range(CAV.millT[0], CAV.millT[1]) * 0.5); // (figures rear the horse on a fresh busyT at a standstill)
    w.events.push({ t: w.tick, kind: "refuse", who: L });
    return "refused";
  }
  const bearing = Math.atan2(S.y[L] - S.y[e], S.x[L] - S.x[e]);
  const off = wrap(S.facing[e] - bearing);
  const We = WEAPON_BY_ID[S.weapon[e]];
  const braced = !mountedE && We.long && Math.abs(off) < Math.PI / 3 && S.status[e] <= ST_WAVER && S.posture[e] === 0;
  if (braced) { const KE = 0.5 * (S.hmass[L] + S.mass[L] + S.load[L]) * v * v; resolveBlow(ctx, e, L, { E: Math.min(300, KE * 0.01), mode: M_THRUST, zone: Z_HORSE, noParry: true, parry: 0.15, off: 0, nAtk: 1, dist: 2, dh: 0, grade: 0, flurryAge: 0 }); }
  const was = S.alive[e];
  if ((!me || A.couched) && WEAPON_BY_ID[S.weapon[L]].couched && S.horseOK[L] === 1) {
    const E = clamp(CAV.lance[0] + 55 * v, CAV.lance[0], CAV.lance[1]);
    resolveBlow(ctx, L, e, { E, mode: M_THRUST, noParry: true, parry: 0.12 + 0.2 * S.skill[e], off, nAtk: 1, dist: 3, dh: 1, grade: 0, flurryAge: 0 });
    S.weapon[L] = S.side[L]; // the lance breaks or is left in him: sword out
    w.events.push({ t: w.tick, kind: "lance", who: L, on: e, broke: true });
    if (me) { A.lanceBroken = true; A.couched = false; A.input.charge = false; }
  }
  if (S.alive[e] && !mountedE && S.horseOK[L] === 1) { const pk = 0.4 + 0.4 * Math.min(1.2, v / 8) - (braced ? 0.3 : 0); if (rng.next() < pk) knockDown(ctx, e, 1); }
  const killed = was && !S.alive[e];
  w.events.push({ t: w.tick, kind: "impact", who: L, on: e });
  if (!me) { if (S.alive[e] && S.posture[e] === 0) { S.vx[L] *= 0.1; S.vy[L] *= 0.1; S.busyT[L] = t + 0.8; } return "rider"; }
  if (killed) A.stats.kills++;
  A.fx.push({ kind: "impact", killed, target: e, t });
  if (A.ride) return "struck"; // (the charge's momentum decides the rest: rideStrike)
  A.stats.impacts++;
  if (!S.alive[e] || S.posture[e] !== 0) { A.speed *= 0.75; return "through"; }
  A.speed *= 0.15; return "stopped";
}

// ---------------------------------------------------------------- his fall
// Struck down (incapacitated): an enemy standing over him takes him for ransom if he will give quarter (§11.6);
// otherwise he lies where he fell — his household bear him off if they are beside him.
function downed(w, A) {
  const S = w.S, L = A.lord, rng = w.rng;
  neighbours(w, S.x[L], S.y[L], 6, nb);
  let captor = -1, cd = 1e9, friend = false;
  for (const o of nb) {
    if (!S.alive[o] || S.posture[o] !== 0) continue;
    const d = Math.hypot(S.x[o] - S.x[L], S.y[o] - S.y[L]);
    if (S.team[o] === S.team[L]) { if (d < 5 && S.status[o] !== ST_FLEE) friend = true; continue; }
    if (S.status[o] === ST_FLEE || S.state[o] === S_CAPT) continue;
    if (d < cd) { cd = d; captor = o; }
  }
  if (captor >= 0 && rng.next() < (S.disc[captor] >= 0.5 ? AV.quarter[0] : AV.quarter[1]) * (w.noPrisoners?.[S.team[captor]] ? 0 : 1)) {
    S.state[L] = S_CAPT; S.status[L] = 5; A.captor = captor; return "captured";
  }
  if (friend) S.lastPass[L] = -2; // borne back behind the line (combat.downedUpdate spares him while his side holds)
  return "down";
}

// Knocked off his feet with two of them over him and none of his own beside him: he yields, or is killed.
function yieldCheck(w, A) {
  const S = w.S, L = A.lord, rng = w.rng;
  neighbours(w, S.x[L], S.y[L], 3, nb);
  let foes = 0, friend = false, captor = -1;
  for (const o of nb) {
    if (o === L || !S.alive[o] || S.posture[o] !== 0) continue;
    const d = Math.hypot(S.x[o] - S.x[L], S.y[o] - S.y[L]);
    if (S.team[o] === S.team[L]) { if (S.status[o] !== ST_FLEE) friend = true; continue; }
    if (d < 2.5 && S.status[o] !== ST_FLEE && S.state[o] !== S_CAPT) { foes++; captor = o; }
  }
  A.pinnedT = foes >= 2 && !friend ? A.pinnedT + DT : 0;
  if (A.pinnedT < AV.yieldAfter || w.tick % 10) return false;
  if (rng.next() < (S.disc[captor] >= 0.5 ? AV.quarter[0] : AV.quarter[1]) * (w.noPrisoners?.[S.team[captor]] ? 0 : 1)) {
    S.alive[L] = 0; S.state[L] = S_CAPT; S.status[L] = 5; A.captor = captor;
    const u = w.units.get(S.unit[L]); if (u?.c) u.c.captured = (u.c.captured || 0) + 1;
    w.events.push({ t: w.tick, kind: "captured", who: L, by: captor });
    lordLost(w, A, "captured");
  } else { fell(w.cs.ctx, L, captor, W_INSTANT, "no-quarter"); lordLost(w, A, "killed"); }
  return true;
}

function lordLost(w, A, how) {
  const S = w.S, L = A.lord, t = w.time, x = S.x[L], y = S.y[L];
  setGuard(w, A, false);
  A.outcome = how; A.embodied = false; A.lostT = t; A.lostAt = { x, y }; A.follow.clear();
  if (w.teams[A.team]) w.teams[A.team].hq = A.hqSaved; // orders go out from the rear again
  for (const [id] of A.mods) setMod(w, A, id, 0);
  const k = (AV.fallStress[how] ?? AV.fallStress.down) * (bannerUp(w, A) ? AV.lordFallBanner : 1);
  for (const v of w.units.values()) {
    if (v.team !== A.team || v.isWorkers || !v.members.length) continue;
    const d = Math.hypot(v.ax - x, v.ay - y);
    A.rumour.push({ unit: v.id, at: t + d / AV.rumourV, k: k * Math.max(AV.rumourMin, 1 - AV.rumourFade * d / 100) });
  }
  neighbours(w, x, y, 150, nb);
  for (const o of nb) if (S.team[o] !== A.team && S.alive[o] && S.status[o] !== ST_FLEE) S.stress[o] = Math.max(0, S.stress[o] - AV.enemyHeart);
  // ransom: paid from the treasury (when there is one); he is back after AV.ransomOut s. Killed: gone for good.
  if (how === "captured") {
    const T = w.teams[A.team], store = T?.store;
    A.ransom = AV.ransom; A.ransomPaid = store ? Math.min(store.gold || 0, AV.ransom) : 0; if (store) store.gold -= A.ransomPaid;
    A.backAt = store ? t + AV.ransomOut : Infinity; A.stats.taken = 1;
    // the ransom scramble (§3.4, Poitiers: "a great press to take the king"): victors near him break ranks to claim him
    neighbours(w, x, y, 12, nb);
    for (const o of nb) if (S.team[o] !== A.team && S.alive[o] && S.status[o] <= ST_WAVER && S.posture[o] === 0 && w.rng.next() < 0.5 * (1 - 0.5 * S.disc[o])) { S.status[o] = ST_LOOT; S.state[o] = S_IDLE; S.foe[o] = -1; S.busyT[o] = t + w.rng.range(20, 60); }
  } else A.backAt = Infinity;
  A.fx.push({ kind: "lost", how, t });
  w.events.push({ t: w.tick, kind: "lord-lost", how, team: A.team, x, y, who: L, ransom: A.ransom || 0 });
}

// the news of his fall reaching each company in turn
function rumourTick(w, A) {
  if (!A.rumour.length) return;
  const S = w.S, t = w.time; let j = 0;
  for (const r of A.rumour) {
    if (r.at > t) { A.rumour[j++] = r; continue; }
    const v = w.units.get(r.unit); if (!v) continue;
    for (const id of v.members) if (S.alive[id] && S.status[id] !== ST_FLEE) S.stress[id] += r.k * (1.3 - S.courage[id]);
    v.moraleMod = (v.moraleMod || 0) + AV.fallBaseline;
    w.events.push({ t: w.tick, kind: "lord-rumour", unit: v.id, team: v.team });
  }
  A.rumour.length = j;
}

// ---------------------------------------------------------------- presence and the leader rally
function setMod(w, A, id, val) {
  const v = w.units.get(id), old = A.mods.get(id) || 0;
  if (v && old !== val) v.moraleMod = (v.moraleMod || 0) + val - old;
  if (val) A.mods.set(id, val); else A.mods.delete(id);
}

// The banner (docs/battle-feel-research.md §6.2–6.3) is a thing on the map, carried by one man: where it stands
// is the household's rally point, whether or not the lord is beside it. It can fall (men near it waver), be
// taken up again by one of his household (the war cry: they steady), or be lost to the enemy.
export function bannerUp(w, A = w.avatar) {
  const S = w.S, B = A?.banner;
  return !!A && A.bannerState === "up" && B >= 0 && S.alive[B] && S.status[B] !== ST_FLEE;
}
export const bannerWithLord = (w, A = w.avatar) => bannerUp(w, A) && Math.hypot(w.S.x[A.banner] - w.S.x[A.lord], w.S.y[A.banner] - w.S.y[A.lord]) < AV.bannerR;

// every tick: has the banner gone down; is someone taking it up; is it taken?
function bannerTick(w, A) {
  const S = w.S, t = w.time, B = A.banner;
  if (A.bannerState === "up") {
    if (B >= 0 && S.alive[B] && S.state[B] !== S_CAPT) { A.bannerAt = { x: S.x[B], y: S.y[B] }; return; }
    // it falls: the men who see it go down waver (§6.3: Bosworth, Poitiers)
    A.bannerState = "down"; A.bannerDownT = t; if (B >= 0) S.role[B] = 0;
    const p = A.bannerAt || { x: S.x[A.lord], y: S.y[A.lord] };
    neighbours(w, p.x, p.y, AV.presenceR, nb);
    for (const o of nb) if (S.team[o] === A.team && S.alive[o] && S.status[o] !== ST_FLEE) S.stress[o] += AV.bannerFallStress * (1.3 - S.courage[o]);
    A.fx.push({ kind: "banner-down", t }); w.events.push({ t: w.tick, kind: "banner-down", team: A.team, x: p.x, y: p.y });
    return;
  }
  if (A.bannerState !== "down" || w.tick % 5) return;
  const p = A.bannerAt;
  neighbours(w, p.x, p.y, 15, nb);
  let pick = -1, pd = 1e9, enemyOn = false, friendNear = false;
  for (const o of nb) {
    if (!S.alive[o] || S.posture[o] !== 0 || S.status[o] === ST_FLEE || S.state[o] === S_CAPT || o === A.lord) continue;
    const d = Math.hypot(S.x[o] - p.x, S.y[o] - p.y);
    if (S.team[o] !== A.team) { if (d < 3) enemyOn = true; continue; }
    if (d < 10) friendNear = true;
    const own = S.unit[o] === S.unit[A.lord] ? 0 : 5; // his household first
    if (d + own < pd) { pd = d + own; pick = o; }
  }
  if (enemyOn && !friendNear) { // taken: a trophy for them, a blow for us
    A.bannerState = "lost"; A.fx.push({ kind: "banner-lost", t }); w.events.push({ t: w.tick, kind: "banner-lost", team: A.team, x: p.x, y: p.y });
    neighbours(w, p.x, p.y, 150, nb);
    for (const o of nb) if (S.alive[o] && S.status[o] !== ST_FLEE) { if (S.team[o] === A.team) S.stress[o] += 0.5 * AV.bannerFallStress * (1.3 - S.courage[o]); else S.stress[o] = Math.max(0, S.stress[o] - AV.enemyHeart); }
    return;
  }
  if (pick >= 0 && t - A.bannerDownT >= AV.bannerPickup) { // "raised up again his banner and cried 'Douglas!'" (Otterburn)
    A.banner = pick; A.bannerState = "up"; S.role[pick] = 2; S.courage[pick] = Math.max(S.courage[pick], 0.8);
    neighbours(w, p.x, p.y, AV.presenceR, nb);
    for (const o of nb) if (S.team[o] === A.team && S.alive[o] && S.status[o] !== ST_FLEE) S.stress[o] = Math.max(0, S.stress[o] - AV.bannerRaised);
    A.fx.push({ kind: "banner-raised", t }); w.events.push({ t: w.tick, kind: "banner-raised", team: A.team, who: pick });
  } else if (t - A.bannerDownT > 40) A.bannerState = "lost"; // trampled in the press, nobody left to lift it
}

// Every perception pass (2 s). Two sources: the lord's own voice (AV.voiceR around him) and his banner (AV.presenceR
// around its bearer, wherever he is). With the banner beside him the two are one: 60 m round the lord.
function presence(w, A) {
  const S = w.S, L = A.lord, t = w.time, team = A.team, dtP = DT * PERC, cs = w.cs;
  const lordUp = S.posture[L] === 0; // (a man on the ground inspires nobody)
  const srcs = [];
  if (lordUp) srcs.push({ x: S.x[L], y: S.y[L], R: AV.voiceR, id: L });
  if (bannerUp(w, A)) srcs.push({ x: S.x[A.banner], y: S.y[A.banner], R: AV.presenceR, id: A.banner });
  A.presenceR = bannerWithLord(w, A) ? AV.presenceR : AV.voiceR;
  const near = (x, y, pad = 0) => srcs.some((q) => Math.hypot(x - q.x, y - q.y) < q.R + pad);
  for (const v of w.units.values()) {
    if (v.team !== team || v.isWorkers || !v.members.length) continue;
    setMod(w, A, v.id, near(v.ax, v.ay, 10) ? AV.presenceBaseline : 0);
  }
  for (const [id] of A.mods) if (!w.units.get(id)) A.mods.delete(id);
  // the banner seen going BACK while the enemy is near: the strongest single signal on the field (§6.3, Bannockburn)
  A.retreating = false;
  if (bannerUp(w, A)) {
    const B = A.banner, home = cs.home?.[team] || [0, -1], back = S.vx[B] * home[0] + S.vy[B] * home[1];
    if (back > AV.retreatV && nearestEnemy50(cs, team, S.x[B], S.y[B], 300) < 250) {
      A.retreating = true;
      neighbours(w, S.x[B], S.y[B], 150, nb);
      for (const o of nb) if (S.team[o] === team && S.alive[o] && S.status[o] !== ST_FLEE && S.unit[o] !== S.unit[L]) S.stress[o] += AV.retreatStress * dtP * (1.3 - S.courage[o]);
    }
  }
  const seen = A.seen || (A.seen = new Set()); seen.clear();
  for (const q of srcs) {
    const still = Math.hypot(S.vx[q.id], S.vy[q.id]) < 2.5;
    neighbours(w, q.x, q.y, q.R, nb);
    for (const o of nb) {
      if (o === L || S.team[o] !== team || !S.alive[o] || seen.has(o)) continue;
      seen.add(o);
      const st = S.status[o];
      if (st === ST_FLEE || st === ST_RALLY) {
        const d = Math.hypot(S.x[o] - q.x, S.y[o] - q.y); if (d > AV.rallyR) continue;
        S.stress[o] = Math.max(0.2, S.stress[o] - AV.rallyDecay * dtP * (still ? 1 : 0.5));
        if (st === ST_FLEE && S.stress[o] < MOR.rallyStress && S.posture[o] === 0 && nearestEnemy50(cs, team, S.x[o], S.y[o], AV.rallyClear + 60) > AV.rallyClear) rallyMan(w, A, o);
        else if (st === ST_RALLY) { const v = w.units.get(S.unit[o]); if (v?.c && !v.c.broken) { rejoin(w, o); A.stats.rallied++; } }
      } else if (st <= ST_SHAKEN) {
        const v = w.units.get(S.unit[o]), base = v?.c?.baseline ?? MOR.baseline, s = S.stress[o];
        if (s > base) S.stress[o] = Math.max(base, s - AV.presenceRelief * dtP);
      }
    }
  }
  // a broken company whose men have gathered on the banner (or on him) forms again there, facing where he faces
  const P = srcs.find((q) => q.id !== L) || srcs[0]; if (!P || Math.hypot(S.vx[P.id], S.vy[P.id]) > 2.5) return;
  const hd = A.embodied ? A.heading : S.facing[L], fx = Math.cos(hd), fy = Math.sin(hd);
  for (const v of w.units.values()) {
    const c = v.c; if (v.team !== team || !c?.broken || v.isWorkers || t - c.breakT < AV.reformAfter || (c.breaks || 0) > MOR.maxReforms + 1 || c.baseline >= 0.85) continue;
    let alive = 0, close = 0, fled = 0;
    for (const id of v.members) { if (!S.alive[id]) continue; alive++; if (S.status[id] === ST_FLEE) fled++; else if (Math.hypot(S.x[id] - P.x, S.y[id] - P.y) < 80) close++; }
    if (close < Math.max(4, 0.25 * alive) || fled > 0.5 * alive) continue;
    if (nearestEnemy50(cs, team, P.x, P.y, 160) < 100) continue;
    reformOn(w, A, v, P.x - fx * 20, P.y - fy * 20, hd);
  }
}

function rallyMan(w, A, o) {
  const S = w.S, v = w.units.get(S.unit[o]);
  if (v?.c && !v.c.broken) { rejoin(w, o); v.c.fled = Math.max(0, v.c.fled - 1); }
  else { S.status[o] = ST_RALLY; S.state[o] = S_RALLY; S.busyT[o] = w.time + w.rng.range(20, 40); if (v?.c) v.c.fled = Math.max(0, v.c.fled - 1); }
  A.stats.rallied++;
  w.events.push({ t: w.tick, kind: "rally", who: o, by: A.lord });
}

// (as morale.reform, which is private to the combat engineer's module: the company forms on him)
function reformOn(w, A, u, x, y, heading) {
  const S = w.S, c = u.c;
  c.broken = false; c.rallied++; c.contactT = -1;
  u.ax = x; u.ay = y; u.path = null; u.hold = false;
  u.facing = heading - Math.PI / 2; u.finalFacing = heading;
  u.order = { kind: "hold", x, y, facing: heading };
  for (const id of u.members) if (S.alive[id] && S.status[id] !== ST_FLEE) rejoin(w, id);
  c.front = u.members.slice(0, u.files || 1); c.fled = 0;
  A.stats.reformed++;
  w.events.push({ t: w.tick, kind: "unit-rallied", unit: u.id, team: u.team, by: "lord" });
}

// ---------------------------------------------------------------- command from the saddle
// deliver one order: by his own voice (≤ CMD.voiceR from him: at once), else horn / rider from him (command.js)
function deliver(w, A, v, o) {
  const S = w.S, L = A.lord;
  const ld = v.c && v.c.leader >= 0 && S.alive[v.c.leader] ? v.c.leader : v.members[0];
  const d = Math.hypot((ld !== undefined ? S.x[ld] : v.ax) - S.x[L], (ld !== undefined ? S.y[ld] : v.ay) - S.y[L]);
  if (d <= AV.voiceR || !w.command) {
    w.command?.pending.delete(v.id); v.pendingOrder = null;
    applyOrder(w, v, o);
    w.events.push({ t: w.tick, kind: "order-arrived", unit: v.id, channel: "voice", delay: 0 });
    return "voice";
  }
  issueOrder(w, [v.id], o);
  return v.pendingOrder?.channel || "horn";
}

// Give one of LORD_ORDERS to companies (ids; default: every company within his presence).
export function lordOrder(w, kind, ids = null) {
  const A = w.avatar, S = w.S; if (!A || A.outcome || !S.alive[A.lord]) return { n: 0, channels: {} };
  const L = A.lord, t = w.time, lx = S.x[L], ly = S.y[L], h = A.embodied ? A.heading : S.facing[L], fx = Math.cos(h), fy = Math.sin(h);
  const house = S.unit[L];
  const list = (ids ? [...ids] : nearbyUnits(w, A.presenceR || AV.presenceR).map((q) => q.id)).map((id) => w.units.get(id)).filter((v) => v && v.team === A.team && !v.isWorkers && v.members.length && v.id !== house);
  const out = { n: 0, channels: { voice: 0, horn: 0, rider: 0 }, target: null };
  if (kind === "rally" && t - A.shoutT > AV.shoutCooldown) { // the cry itself: fugitives within earshot take heart
    A.shoutT = t;
    neighbours(w, lx, ly, AV.shoutR, nb);
    for (const o of nb) if (S.team[o] === A.team && S.alive[o] && S.status[o] === ST_FLEE) S.stress[o] = Math.max(0.2, S.stress[o] - AV.shoutRelief);
  }
  let tgt = null;
  if (kind === "charge") { // the enemy body before him
    let bd = 1e9; const px = lx + fx * 60, py = ly + fy * 60;
    for (const v of w.units.values()) {
      if (v.team === A.team || v.isWorkers || !v.members.length) continue;
      const d = Math.hypot(v.ax - px, v.ay - py) + (v.c?.broken ? 150 : 0); if (d < bd && Math.hypot(v.ax - lx, v.ay - ly) < 500) { bd = d; tgt = v; }
    }
    out.target = tgt?.id ?? null;
    if (!tgt) return out;
  }
  list.forEach((v, k) => {
    let o;
    const mounted = ARMS[v.arm].mounted, side = ((k % 2) ? 1 : -1) * Math.ceil(k / 2) * 30;
    switch (kind) {
      case "follow": {
        // keep station where they stand relative to him (in his frame), pulled in to 20–70 m behind him
        const rx = v.ax - lx, ry = v.ay - ly, lat = clamp(rx * -fy + ry * fx, -80, 80), back = clamp(-(rx * fx + ry * fy), 20, 70);
        A.follow.set(v.id, { lat, back, order: null });
        o = { kind: "move", x: lx - fx * back - fy * lat, y: ly - fy * back + fx * lat, facing: h, pace: "quick" }; break;
      }
      case "charge":
        if (ARMS[v.arm].missile) { v.fireAt = tgt.id; v.fireStand = 0; out.n++; A.follow.delete(v.id); return; } // bows loose at them instead
        o = { kind: "assault", x: tgt.ax, y: tgt.ay, target: tgt.id, pace: mounted ? "charge" : "quick", facing: Math.atan2(tgt.ay - v.ay, tgt.ax - v.ax) }; break;
      case "hold": o = { kind: "hold", x: v.ax, y: v.ay, facing: h }; break;
      case "rally": o = { kind: "move", x: lx - fx * 20 - fy * side, y: ly - fy * 20 + fx * side, facing: h, pace: "quick" }; break;
      case "line": case "wedge": o = { kind: "hold", x: v.ax, y: v.ay, facing: h, formation: kind }; break;
      default: return;
    }
    if (kind !== "follow") A.follow.delete(v.id);
    if (kind !== "charge") v.fireAt = null;
    v.helping = null; v.burning = null;
    out.channels[deliver(w, A, v, o)]++; out.n++;
  });
  w.events.push({ t: w.tick, kind: "lord-order", order: kind, n: out.n, team: A.team });
  return out;
}

// companies told "Follow me!" keep station on him (they follow the banner by sight once the order is in)
function followTick(w, A) {
  const S = w.S, L = A.lord, lx = S.x[L], ly = S.y[L], h = A.embodied ? A.heading : S.facing[L], fx = Math.cos(h), fy = Math.sin(h);
  for (const [id, f] of A.follow) {
    const v = w.units.get(id);
    if (!v || !v.members.length || v.c?.broken) { A.follow.delete(id); continue; }
    if (v.pendingOrder) continue; // the order is still on its way
    if (f.order && v.order !== f.order) { A.follow.delete(id); continue; } // someone else has given them another order
    const tx = lx - fx * f.back - fy * f.lat, ty = ly - fy * f.back + fx * f.lat;
    const cur = f.order || v.order;
    if (!f.order || Math.hypot((cur.x ?? v.ax) - tx, (cur.y ?? v.ay) - ty) > 12) {
      applyOrder(w, v, { kind: "move", x: tx, y: ty, facing: h, pace: Math.hypot(v.ax - tx, v.ay - ty) > 50 ? "quick" : "march", formation: undefined });
      f.order = v.order;
    }
  }
}

// ---------------------------------------------------------------- for the HUD
// our companies near him, nearest first: what they are, how they stand, and how an order would reach them
export function nearbyUnits(w, R = 300, max = 9) {
  const A = w.avatar, S = w.S; if (!A) return [];
  const L = A.lord, lx = S.x[L], ly = S.y[L], house = S.unit[L], out = [];
  for (const v of w.units.values()) {
    if (v.team !== A.team || v.isWorkers || !v.members.length || v.id === house) continue;
    const d = Math.hypot(v.ax - lx, v.ay - ly); if (d > R) continue;
    out.push({ id: v.id, arm: v.arm, men: v.members.length, state: v.state, order: v.pendingOrder ? "…" + v.pendingOrder.kind : v.order?.kind || "hold", d,
      channel: d <= AV.voiceR ? "voice" : d <= CMD.hornR ? "horn" : "rider", following: A.follow.has(v.id), inPresence: A.mods.has(v.id) });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, max);
}

export function lordStatus(w) {
  const A = w.avatar, S = w.S; if (!A) return null;
  const L = A.lord, t = w.time;
  const bleedF = S.blood[L] / S.bloodVol[L];
  const health = clamp(1 - Math.max(S.wounds[L], bleedF / 0.3), 0, 1);
  const W = WEAPON_BY_ID[S.weapon[L]];
  return {
    outcome: A.outcome, embodied: A.embodied, alive: !!S.alive[L], mounted: S.horseOK[L] === 1, bolting: A.boltUntil >= 0,
    health, bleeding: S.bleed[L] > 0.01, stamina: clamp(S.wbal[L] / S.wp[L], 0, 1), horse: S.horseOK[L] >= 1 ? clamp(S.hwbal[L] / S.hwp[L], 0, 1) : null,
    stress: S.stress[L], weapon: W.key, couched: A.couched, guard: A.guard, down: S.posture[L] !== 0, speed: Math.hypot(S.vx[L], S.vy[L]),
    wind: A.wind >= 0 ? clamp((t - A.wind) / AV.fullHold, 0, 1) : -1, ready: t >= A.nextSwing, banner: A.bannerState, bannerWithLord: bannerWithLord(w, A), retreating: A.retreating, presenceR: A.presenceR || AV.presenceR,
    kills: S.kills[L] - A.kills0, stats: A.stats, target: A.target, x: S.x[L], y: S.y[L], heading: A.heading, household: (w.units.get(S.unit[L])?.members.length || 1) - 1,
    ransom: A.ransom || 0, ransomPaid: A.ransomPaid || 0, backIn: A.backAt > t && A.backAt < Infinity ? A.backAt - t : 0,
  };
}
