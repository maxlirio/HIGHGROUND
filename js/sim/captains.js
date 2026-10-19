// Captains: every company has one (the owner: "each unit needs to start with one, and while they have one, the
// commander can manage stuff like that, as well as order them on their own if they see an opportunity. Of course they
// notify me first").
//
// WHO. The captain is the company's leader, the man combat.js already made its leader (u.c.leader: middle of the second
// rank, his banner beside him). He gets a name, a temper (bold / steady / cunning / cautious: from his nerve and skill
// and his company's arm, or from his saga if he is a raised legend) and a small skill. A raised legend in the company
// takes it over. If the captain falls the company is LEADERLESS: no initiative, slower to take orders (command.js), the
// leader-killed morale blow (morale.js). The next man up (morale.js replaces the leader after ~45 s) leads it as a
// SERGEANT, with less skill.
//
// INITIATIVE. Every few seconds (staggered, cheap) the captain looks about him and may PROPOSE one thing: charge
// unguarded bowmen, take an exposed flank or rear, pursue a broken body (so far and no further), fall back before he is
// cut off, step back into cover out of the shafts, or go to the help of a company in trouble. Bold captains propose
// more and further; cautious ones propose withdrawals. He never undoes a clear order: a company the player told to
// HOLD (hold / fortify / ambush / form up) or to ASSAULT, or bows told to shoot a body, stays silent.
//
// NOTIFY FIRST. A human team's proposal is a card (w.capt.props, plain data) with a countdown (CAPT.countdown s): the
// player says "Do it now" or "No" (decide()), or it is done when the countdown ends — decided HERE, in the sim, so the
// realm server runs the same clock. Initiative per company u.initiative = "on" | "ask" | "off" (undefined: the team's
// default w.capt.global[team], "ask"): "on" acts and reports, "off" never proposes. AI teams' captains act at once
// (no card) and the battle AI (commander-ai.js) leaves a company alone while its captain's move lasts (u.capAct).
//
// REPORTS. A captain says what he is doing, rate-limited: w.log gets { kind: "captain-say", team, unit, text, x, y }
// (main.js drainLog / js/game/chronicle.js turn it into a toast). PATHING's route events are reported the same way:
// any w.events entry of kind "route" | "crossing" | "route-cover" with `unit` and either `say` (the sentence) or
// { crossing: { kind: "ford"|"bridge"|"build", name?, eta? s }, cover?: true } becomes
// "Sir Hamo: no ford near — we'll bridge the brook, about two minutes".
//
// Plain data only on the world and the units (the realm saves the whole graph). Deterministic: no dice.
import { ARMS, ARM_BY_ID } from "./arms.js";
import { issueOrder } from "./world.js";
import { DISPOSITIONS, dispositionOf, nameOf } from "./legend.js";
import { canSee } from "./vision.js";
import { isFoe } from "./sides.js";
import { terrainAt } from "./landread.js";
import { coverOf } from "./analysis.js";

export const CAPT = {
  think: 30,          // ticks between a captain's looks about him (3 s), staggered by unit
  countdown: 8,       // s a card waits for the player before the captain acts
  maxCards: 3,        // cards on screen per team at once (more are dropped by priority)
  teamGap: 7,         // s between two new proposals of one team (human teams; the AI's captains 3 s)
  unitGap: 45,        // s between two proposals of one company (× the temper's cd)
  noGap: 120,         // s a company keeps quiet about the same thing after "No" (60 s about anything)
  sergeantT: 45,      // s after the captain falls before the next man takes the company (morale.js does it at 45 s too)
  sergeantSkill: 0.6, // his skill × this
  reportGap: 4,       // s between two reports of one team
  unitReportGap: 15,  // s between two reports of one company
  pursueFoot: 150, pursueHorse: 300, // m a pursuit goes before the captain halts it
  actMax: 90,         // s a captain's own move keeps the battle AI's hands off his company
  cooldownHold: 0,
};

// the four tempers: how often he speaks up (cd ×), how far he looks (reach ×), and how he weighs attack and withdrawal
export const TEMPERS = {
  bold:     { name: "bold", word: "a bold captain", cd: 0.7, reach: 1.25, attack: 1.15, withdraw: 0.45, flank: 1, cover: 0.8, help: 1, legend: "aggressive" },
  steady:   { name: "steady", word: "a steady captain", cd: 1, reach: 1, attack: 0.9, withdraw: 0.8, flank: 1, cover: 1, help: 1.15, legend: "inspiring" },
  cunning:  { name: "cunning", word: "a cunning captain", cd: 0.9, reach: 1.1, attack: 0.9, withdraw: 0.85, flank: 1.35, cover: 1.25, help: 0.9, legend: "flanker" },
  cautious: { name: "cautious", word: "a cautious captain", cd: 1.4, reach: 0.8, attack: 0.55, withdraw: 1.25, flank: 0.9, cover: 1.2, help: 0.9, legend: "defensive" },
};
const FROM_LEGEND = { aggressive: "bold", shock: "bold", defensive: "cautious", flanker: "cunning", ambusher: "cunning", skirmish: "cunning", inspiring: "steady" };
const HOLDS = new Set(["hold", "fortify", "ambush"]);
export const MODES = ["on", "ask", "off"];
const hooks = new WeakMap(); // w → { V, placeAt(x, y) → {name, phrase}, delegated(unitId) → bool }  (not saved: set again after a restore)

// the shell (main.js / server) tells the captains what the team can see and what the places are called
export function captainHooks(w, h) { hooks.set(w, { ...(hooks.get(w) || {}), ...h }); }
const H = (w) => hooks.get(w) || {};

const C = (w) => (w.capt ||= { seq: 1, props: [], global: {}, lastProp: {}, lastSay: {}, done: [] });
const humanTeams = (w) => w.humanTeams || (w.humanTeam !== undefined && w.humanTeam >= 0 ? [w.humanTeam] : []);
const isHuman = (w, team) => humanTeams(w).includes(team);

// ---------------------------------------------------------------- who he is
const hash = (n) => { n = (n ^ 0x9e3779b9) >>> 0; n = Math.imul(n ^ (n >>> 16), 0x85ebca6b) >>> 0; n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35) >>> 0; return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
export function captainable(u) {
  if (!u || u.isWorkers || !u.members?.length || u.household || u.noAI || (u.gate !== undefined && u.gate !== null)) return false; // (a gate's guards: js/sim/gateguards.js)
  const A = ARMS[u.arm]; return !!A && !A.engine && u.arm !== "villager";
}
// his temper from the man and his arm (a raised legend's from his saga)
function temperOf(w, u, man) {
  const S = w.S, sg = w.sagas?.get(man);
  if (sg && sg.rank >= 1) { const d = sg.disposition || (Object.keys(sg.tags || {}).length ? dispositionOf(sg) : null); if (d && FROM_LEGEND[d]) return FROM_LEGEND[d]; }
  const A = ARMS[u.arm], r = hash(S.name[man] * 7 + 13);
  const armBias = A.mounted ? (u.arm === "scouts" ? -0.05 : 0.2) : A.missile ? -0.1 : u.arm === "levy" ? -0.15 : u.arm === "menatarms" ? 0.12 : 0;
  const v = (S.courage[man] - 0.5) + armBias + (r - 0.5) * 0.5;
  if (v > 0.22) return "bold";
  if (v < -0.2) return "cautious";
  if (S.skill[man] > 0.55 || A.missile || u.arm === "scouts" || hash(S.name[man] + 99) < 0.3) return "cunning";
  return "steady";
}
function makeCaptain(w, u, man, sergeant = false, prev = null) {
  const S = w.S, sg = w.sagas?.get(man);
  // a ranked host's company brings its own captain (the same man every battle): its first leader takes his name, and the
  // commander his own (js/sim/ranked-rules.js hostCompanies → battlefield.js placeHost)
  let named = null;
  if (!sergeant && !prev && u.capSeed !== undefined && !u.capTaken) { u.capTaken = true; S.name[man] = u.capSeed; named = u.capName || null; }
  const base = Math.min(1, Math.max(0, 0.35 + 0.35 * S.skill[man] + 0.25 * (S.disc[man] || 0.4) + (sg ? 0.08 * sg.rank : 0)));
  return {
    unit: u.id, man, seed: S.name[man], temper: temperOf(w, u, man), legend: sg?.rank || 0, ...(named ? { named } : {}),
    skill: Math.round((sergeant ? Math.min(base, (prev?.skill ?? base) * CAPT.sergeantSkill) : base) * 100) / 100,
    sgt: sergeant, lostT: -1, oT: u.orderT ?? -1, oCap: 0, nextT: w.time + 20 + (u.id % 7), no: {}, mc: [], lastSay: -1e9,
  };
}
export function captainOf(u) { return u?.cap && u.cap.unit === u.id ? u.cap : null; }
export function leaderless(w, u) { const c = captainOf(u); return !!c && c.lostT >= 0; }
export function captainName(w, u, short = false) {
  const c = captainOf(u); if (!c) return "";
  if (c.named) return c.named; // (the commander, by the name his player gave him)
  const full = nameOf(c.seed), first = full.split(" ")[0], A = ARMS[u.arm];
  const title = c.sgt ? "Sergeant" : c.legend >= 1 || A.mounted && u.arm !== "scouts" || u.arm === "menatarms" ? "Sir" : A.missile ? "Master" : "Captain";
  return short ? `${title} ${first}` : `${title} ${full}`;
}
export function captainInfo(w, u) { // for the selection panel and the realm's unit record
  const c = captainOf(u); if (!c) return null;
  return { name: captainName(w, u), short: captainName(w, u, true), temper: c.temper, skill: c.skill, sgt: c.sgt, lost: c.lostT >= 0, legend: c.legend };
}
export function initiativeOf(w, u) { return u.initiative || C(w).global[u.team] || "ask"; }

// keep every company's captain up to date: new companies, the fallen, the sergeant, a raised legend
function tendCaptain(w, u) {
  const S = w.S, c = u.c;
  let cap = captainOf(u);
  if (!cap) { // a new company (raised, spawned, split off): its leader is its captain
    const man = c && c.leader >= 0 && S.alive[c.leader] ? c.leader : -1; if (man < 0) return null;
    cap = u.cap = makeCaptain(w, u, man);
    return cap;
  }
  if (cap.lostT < 0 && !S.alive[cap.man]) { // he has fallen
    cap.lostT = w.time;
    for (const p of C(w).props) if (p.unit === u.id && p.state === "pending") p.state = "void";
    say(w, u, `${captainName(w, u, true)} is down — the ${ARMS[u.arm].name.toLowerCase()} have no captain`, { force: true, tone: "bad" });
    return cap;
  }
  if (cap.lostT >= 0) { // leaderless: the next man takes the company when morale.js puts up his banner, or after a while anyway
    let next = c && c.leader >= 0 && S.alive[c.leader] && c.leader !== cap.man && c.leaderLost < 0 ? c.leader : -1;
    if (next < 0 && w.time - cap.lostT > CAPT.sergeantT + 15 && c) { // (a man who fell outside combat.js's reckoning: nobody raised a banner)
      let bn = -1; for (const id of u.members) if (S.alive[id] && S.status[id] <= 1 && S.courage[id] > bn) { bn = S.courage[id]; next = id; }
      if (next >= 0) { c.leader = next; S.role[next] = 1; c.leaderLost = -1; c.leaderNews = null; }
    }
    if (next >= 0) {
      u.cap = cap = makeCaptain(w, u, next, true, cap);
      say(w, u, `${captainName(w, u, true)} takes the ${ARMS[u.arm].name.toLowerCase()}`, { force: true });
    }
    return cap;
  }
  // a raised legend in the company leads it
  if (w.sagas && w.tick % 50 === u.id % 50) for (const id of u.members) {
    if (S.legend[id] < 1 || id === cap.man || !S.alive[id] || S.legend[id] <= cap.legend) continue;
    if (c) { if (S.alive[c.leader] && c.leader !== id) S.role[c.leader] = 0; c.leader = id; S.role[id] = 1; }
    u.cap = cap = makeCaptain(w, u, id);
    say(w, u, `${captainName(w, u, true)}, raised for his deeds, now leads the ${ARMS[u.arm].name.toLowerCase()} — ${TEMPERS[cap.temper].word}`, { force: true, tone: "legend" });
    break;
  }
  return cap;
}

// ---------------------------------------------------------------- reports
function say(w, u, text, { force = false, tone } = {}) {
  if (!isHuman(w, u.team) || H(w).delegated?.(u.id) && !force) return false;
  const K = C(w), cap = captainOf(u);
  if (!force) {
    if (w.time - (K.lastSay[u.team] ?? -1e9) < CAPT.reportGap) return false;
    if (cap && w.time - cap.lastSay < CAPT.unitReportGap) return false;
  }
  K.lastSay[u.team] = w.time; if (cap) cap.lastSay = w.time;
  w.log.push({ t: w.tick, kind: "captain-say", team: u.team, unit: u.id, text, x: u.ax, y: u.ay, tone });
  return true;
}
const MIN_WORDS = ["", "a minute", "two minutes", "three minutes", "four minutes", "five minutes"];
const etaWords = (s) => !Number.isFinite(s) ? "" : s < 45 ? "less than a minute" : s < 330 ? `about ${MIN_WORDS[Math.max(1, Math.round(s / 60))]}` : `about ${Math.round(s / 60)} minutes`;
// PATHING's route events → a captain's word (see the header for the shape)
export function routeLine(e) {
  if (e.say) return e.say;
  if (e.kind === "route-refused") return `we can't get there — ${e.why || "no way through"}`;
  if (e.kind === "crossing-joined") return `we'll lend a hand with the ${e.crossing?.kind === "fascine" ? "fascines" : "bridge"} there${e.crossing?.secs ? ", " + etaWords(e.crossing.secs) : ""}`;
  if (e.why && (e.kind === "crossing-started" || e.kind === "route-covered")) return e.why;
  const X = e.crossing, eta = X?.eta !== undefined ? etaWords(X.eta) : "";
  if (X?.kind === "build") return `no ford near — we'll bridge the ${X.name || "stream"}${eta ? ", " + eta : ""}`;
  if (X?.kind === "ford") return `we'll cross by the ford${X.name ? " at " + X.name : ""}${eta ? ", " + eta + " out of our way" : ""}`;
  if (X?.kind === "bridge") return `we'll take the bridge${X.name ? " at " + X.name : ""}${eta ? ", " + eta : ""}`;
  if (e.cover) return "we'll keep to the trees as far as we can";
  return null;
}
// (js/sim/crossings.js, PATHING: "crossing-started" / "route-covered" / "route-refused" / "crossing-joined" carry the plan's `why`)
const ROUTE_KINDS = new Set(["route", "crossing", "route-cover", "crossing-started", "crossing-joined", "route-covered", "route-refused"]);

// ---------------------------------------------------------------- the system (after combat and morale)
export function captainSystem(w) {
  const K = C(w), S = w.S;
  // what PATHING planned for our companies
  for (const e of w.events) {
    if (!ROUTE_KINDS.has(e.kind) || e.unit === undefined) continue;
    const u = w.units.get(e.unit); if (!u || !captainOf(u) || leaderless(w, u)) continue;
    if (e.kind === "route-covered") { const c = captainOf(u); if (c.coverO === (u.orderT ?? -1)) continue; c.coverO = u.orderT ?? -1; } // (re-planned on the march: said once an order)
    const t = routeLine(e); if (t && say(w, u, `${captainName(w, u, true)}: ${t}`, { force: e.kind === "route-refused" })) captainOf(u).routeSaid = w.time;
  }
  // the cards: countdowns, and proposals overtaken by events
  if (K.props.length) tendProps(w, K);
  // captains' own moves: end them when done
  for (const u of w.units.values()) if (u.capAct) tendAct(w, u);
  if (w.tick % 5) return;
  let world = null; // (built only when some captain looks about him this tick)
  for (const u of w.units.values()) {
    if (!captainable(u)) continue;
    if ((w.tick / 5 | 0) % 5 === u.id % 5 || !captainOf(u)) { const cap = tendCaptain(w, u); if (!cap) continue; }
    if ((w.tick + u.id * 5) % CAPT.think >= 5) continue;
    const cap = captainOf(u); if (!cap || cap.lostT >= 0) continue;
    if ((u.orderT ?? -1) !== cap.oT) { // a new order: if the way there goes round by a ford or a bridge, he says so (the works are told by their events)
      cap.oT = u.orderT ?? -1;
      const why = u.route?.why;
      if (u.order?.player && why && /^(round by|over )/.test(why) && !(w.time - (cap.routeSaid ?? -1e9) < 3)) { say(w, u, `${captainName(w, u, true)}: ${why}`); cap.routeSaid = w.time; }
    }
    if (w.time < cap.nextT) continue;
    trackFire(w, u, cap);
    if (initiativeOf(w, u) === "off" && isHuman(w, u.team)) continue;
    if (!free(w, u)) continue;
    world ||= survey(w);
    const p = look(w, u, cap, world); if (!p) continue;
    propose(w, u, cap, p);
  }
  // (the record of what became of proposals is kept short)
  if (K.done.length > 40) K.done.splice(0, K.done.length - 40);
}

// the shafts his company has taken lately (for "step back into cover")
function trackFire(w, u, cap) {
  const m = u.c?.mcas || 0; cap.mc.push([Math.round(w.time), m]);
  while (cap.mc.length > 1 && w.time - cap.mc[0][0] > 24) cap.mc.shift();
}
const recentShot = (cap, m) => cap.mc.length ? m - cap.mc[0][1] : 0;

// may this company act on its own at all? (never against a clear order)
function free(w, u) {
  if (u.state === "routing" || u.c?.broken || u.hold || u.pendingOrder || u.capAct || u.cst || u.esc || u.crewFor !== undefined || u.lurking || u.retired) return false;
  const o = u.order || {};
  if (HOLDS.has(o.kind) && o.player) return false;     // told to hold there: he holds
  if (o.kind === "assault" && !o.cap && o.player) return false; // told to go in: he goes in
  if (u.fireAt !== null && u.fireAt !== undefined) return false; // bows told to shoot a body
  for (const K of w.castles || []) if (Math.hypot(u.ax - K.x, u.ay - K.y) < 380) return false; // (under a castle's walls the siege is the commander's business)
  if (o.kind === "escalade" || o.kind === "castle_move" || o.kind === "sally" || o.kind === "burn" || u.burning || u.helping) return false;
  return true;
}
// the field as the captains see it this tick
function survey(w) {
  const all = [];
  for (const v of w.units.values()) if (v.members.length && !v.isWorkers && !ARMS[v.arm]?.engine) all.push(v);
  return { all };
}
const facingOf = (w, v) => { const S = w.S, L = v.c?.leader; if (L >= 0 && S.alive[L]) return S.facing[L]; const m = v.members[0]; return m !== undefined ? S.facing[m] : v.finalFacing ?? 0; };
const offFront = (w, v, x, y) => { const a = Math.atan2(y - v.ay, x - v.ax) - facingOf(w, v); return Math.abs(Math.atan2(Math.sin(a), Math.cos(a))); };
const strength = (v) => v.members.length * (1 + ARMS[v.arm].armour * 0.3) * (ARMS[v.arm].mounted ? 1.6 : 1) * (v.state === "formed" ? 1 : v.state === "routing" ? 0.1 : 0.6);
const nm = (v) => ARMS[v.arm].name.toLowerCase();

// the best thing to do, or nothing (scores ≥ 1 are worth proposing)
function look(w, u, cap, { all }) {
  const T = TEMPERS[cap.temper], A = ARMS[u.arm], S = w.S, V = H(w).V;
  const reach = T.reach * (0.85 + 0.3 * cap.skill);
  const sees = (v) => !V || canSee(V, u.team, v.ax, v.ay);
  const o = u.order || {}, ordered = o.player && !o.cap; // (a player's march: he may still ask)
  const wavering = u.state === "wavering" || u.state === "shaken";
  const foes = [], friends = [];
  for (const v of all) { if (v === u || v.cst || v.esc) continue; const d = Math.hypot(v.ax - u.ax, v.ay - u.ay); if (d > 600) continue; if (v.team === u.team) friends.push([v, d]); else if (isFoe(w, u.team, v.team) && sees(v)) foes.push([v, d]); }
  if (!foes.length) return null;
  const opts = [];
  const add = (p) => { if (p.score >= 1 && !(cap.no[p.kind] > w.time)) opts.push(p); };
  const mounted = A.mounted, missile = !!A.missile, men = u.members.length;
  const assaultP = (v, pace) => ({ kind: "assault", x: v.ax, y: v.ay, target: v.id, pace });
  // 1. unguarded bowmen within charge range
  if (!missile && !wavering) for (const [v, d] of foes) {
    if (!ARMS[v.arm].missile || v.state === "routing" || v.hold) continue;
    const R = (mounted ? 300 : 110) * reach; if (d > R) continue;
    const guard = foes.some(([g]) => g !== v && !ARMS[g.arm].missile && g.state !== "routing" && Math.hypot(g.ax - v.ax, g.ay - v.ay) < 70);
    if (guard) continue;
    const odds = strength(u) / Math.max(1, strength(v) * (mounted ? 0.5 : 1));
    if (odds < 0.6) continue;
    add({ kind: "charge-bows", score: 1.3 * T.attack * (mounted ? 1.2 : 0.95) * Math.min(1.2, 0.7 + odds * 0.3) * (1.1 - 0.2 * d / R), v, d,
      what: `Charge their ${nm(v)}`, why: `${Math.round(d / 10) * 10} m off and no foot within 70 m of them`, order: assaultP(v, mounted ? "charge" : "quick") });
  }
  // 2. an enemy flank or rear turned to us
  if (!missile && !wavering) for (const [v, d] of foes) {
    if (v.state === "routing" || ARMS[v.arm].missile) continue;
    const R = (mounted ? 320 : 130) * reach; if (d > R) continue;
    const off = offFront(w, v, u.ax, u.ay); if (off < 1.75) continue; // (more than 100° off his front)
    const locked = v.hold && friends.some(([f]) => f.hold && Math.hypot(f.ax - v.ax, f.ay - v.ay) < 45);
    if (!locked && (off < 2.2 || v.moving || ARMS[v.arm].mounted && !mounted)) continue; // (a body walking away is not a flank; foot do not chase horse)
    const odds = strength(u) / Math.max(1, strength(v));
    if (!locked && odds < 0.8) continue;
    const rear = off > 2.4;
    add({ kind: "flank", score: (locked ? 1.4 : 1.05) * T.attack * T.flank * (rear ? 1.1 : 1) * (mounted ? 1.1 : 1), v, d,
      what: `Take their ${nm(v)} in the ${rear ? "rear" : "flank"}`, why: locked ? `they are locked with our men and their ${rear ? "backs are" : "flank is"} to us, ${Math.round(d / 10) * 10} m off` : `they have turned their ${rear ? "backs" : "flank"} to us`, order: assaultP(v, mounted && d < 250 ? "charge" : "quick") });
  }
  // 3. a broken body to pursue (a little way)
  if (!missile && !wavering) for (const [v, d] of foes) {
    if (v.state !== "routing") continue;
    const R = (mounted ? 260 : 110) * reach; if (d > R) continue;
    if (foes.some(([g]) => g !== v && g.state === "formed" && !ARMS[g.arm].missile && Math.hypot(g.ax - v.ax, g.ay - v.ay) < 90)) continue; // (not onto his formed line)
    const lim = Math.round((mounted ? CAPT.pursueHorse : CAPT.pursueFoot) * (T.name === "bold" ? 1.3 : T.name === "cautious" ? 0.7 : 1));
    add({ kind: "pursue", score: 1.15 * T.attack * (mounted ? 1.15 : 0.9), v, d, limit: lim,
      what: `Pursue the broken ${nm(v)}`, why: `they are running — we'll chase ${lim} m and no further`, order: assaultP(v, mounted ? "charge" : "quick") });
  }
  // 4. about to be cut off or outflanked: fall back to a named point (never out of an ordered assault; never from contact)
  if (!u.hold && !(o.kind === "assault" && !o.cap)) {
    let front = 0, side = 0, their = 0; const bear = [];
    for (const [v, d] of foes) {
      if (d > 200 * reach || v.state === "routing" || ARMS[v.arm].missile && d > 120) continue;
      their += strength(v); bear.push(Math.atan2(v.ay - u.ay, v.ax - u.ax));
      if (offFront(w, u, v.ax, v.ay) > 1.75) side++; else front++;
    }
    let spread = 0; for (let i = 0; i < bear.length; i++) for (let j = i + 1; j < bear.length; j++) { const a = Math.abs(Math.atan2(Math.sin(bear[i] - bear[j]), Math.cos(bear[i] - bear[j]))); if (a > spread) spread = a; }
    let ours = strength(u); for (const [f, d] of friends) if (d < 150 && f.state !== "routing") ours += strength(f) * 0.7;
    const odds = their / Math.max(1, ours);
    const surrounded = bear.length >= 2 && spread > 2.6 || side >= 1 && front >= 1;
    if ((surrounded && odds > 1.1) || (side >= 1 && odds > 1.6)) {
      const pt = fallbackPoint(w, u, foes, friends);
      if (pt) add({ kind: "fallback", score: 1.15 * T.withdraw * Math.min(1.6, 0.6 + odds * 0.4) * (wavering ? 1.2 : 1) * (ordered ? 0.85 : 1), d: 0, pt,
        what: `Fall back ${pt.name}`, why: surrounded ? `${bear.length} bodies are working round us — we'll be cut off` : `they are round our flank and outnumber us`, order: { kind: "move", x: pt.x, y: pt.y, pace: "quick", facing: Math.atan2(u.ay - pt.y, u.ax - pt.x) + Math.PI } });
    }
  }
  // 5. under heavy fire in the open, with cover close by: step back into it
  const shot = recentShot(cap, u.c?.mcas || 0);
  if (!u.hold && !(o.kind === "assault" && !o.cap) && shot >= Math.max(3, 0.05 * men)) {
    const here = coverOf(terrainAt(w, u.ax, u.ay));
    const bows = foes.filter(([v]) => ARMS[v.arm].missile && v.state !== "routing");
    if (here < 0.3 && bows.length) {
      const pt = coverPoint(w, u, bows.map(([v]) => v), foes);
      if (pt) add({ kind: "cover", score: 1.3 * T.withdraw * T.cover * Math.min(1.5, 0.7 + shot / Math.max(6, 0.1 * men)), d: pt.d, pt,
        what: pt.wood ? "Step back into the woods" : "Step back into cover", why: `we have lost ${shot} men to their shafts in the open; cover ${Math.round(pt.d / 10) * 10} m ${pt.back ? "behind us" : "off"}`,
        order: { kind: "move", x: pt.x, y: pt.y, pace: "quick", facing: Math.atan2(bows[0][0].ay - pt.y, bows[0][0].ax - pt.x) } });
    }
  }
  // 6. a friendly company in trouble nearby: go to its help
  if (!missile && !wavering) for (const [f, d] of friends) {
    if (!f.hold || f.state === "routing" || f.c?.broken) continue;
    const trouble = f.state === "wavering" || f.state === "shaken" || (f.c?.stressM || 0) > 0.3;
    if (!trouble) continue;
    const R = (mounted ? 350 : 220) * reach; if (d > R) continue;
    let foe = null, fd = 45; for (const [v] of foes) { const dd = Math.hypot(v.ax - f.ax, v.ay - f.ay); if (dd < fd && v.state !== "routing") { fd = dd; foe = v; } }
    if (!foe) continue;
    const off = offFront(w, foe, u.ax, u.ay);
    add({ kind: "support", score: 1.2 * T.help * (0.7 + 0.3 * T.attack) * (off > 1.75 ? 1.15 : 1), v: foe, d, f,
      what: `Go to the help of our ${nm(f)}`, why: `they are ${f.state === "formed" ? "hard pressed" : f.state} under their ${nm(foe)}, ${Math.round(d / 10) * 10} m off`, order: assaultP(foe, mounted && d < 250 ? "charge" : "quick") });
  }
  if (!opts.length) return null;
  // the captain's skill: a raw one sees the obvious only (the best must be clearly good)
  opts.sort((a, b) => b.score - a.score);
  const best = opts[0];
  if (best.score < 1 + 0.25 * (1 - cap.skill) * (best.kind === "fallback" || best.kind === "cover" ? 0.5 : 1)) return null;
  return best;
}

// where to fall back to: on a friendly body behind, else back toward the commander, ~150–220 m
function fallbackPoint(w, u, foes, friends) {
  let tx = 0, ty = 0, n = 0; for (const [v] of foes) { tx += v.ax; ty += v.ay; n++; } tx /= n; ty /= n;
  const ax = u.ax - tx, ay = u.ay - ty, al = Math.hypot(ax, ay) || 1, awayX = ax / al, awayY = ay / al;
  let best = null, bs = -Infinity;
  for (const [f, d] of friends) {
    if (d > 450 || d < 40 || f.state === "routing" || f.members.length < 20) continue;
    const dot = ((f.ax - u.ax) * awayX + (f.ay - u.ay) * awayY) / d; if (dot < 0.3) continue;
    const s = dot * 2 + strength(f) / 200 - d / 300; if (s > bs) { bs = s; best = f; }
  }
  const map = w.map, ok = (x, y) => (!map.inBounds || map.inBounds(x, y)) && !(map.water && map.water(x, y) > 0.3);
  if (best) { const dx = best.ax - u.ax, dy = best.ay - u.ay, d = Math.hypot(dx, dy); const x = best.ax - dx / d * 25, y = best.ay - dy / d * 25; if (ok(x, y)) return { x, y, name: `on our ${nm(best)}` }; }
  const hq = w.teams[u.team]?.hq; let dx = awayX, dy = awayY;
  if (hq) { const hx = hq.x - u.ax, hy = hq.y - u.ay, hl = Math.hypot(hx, hy); if (hl > 50 && (hx * awayX + hy * awayY) / hl > 0) { dx = hx / hl; dy = hy / hl; } }
  for (const r of [180, 140, 220, 100]) {
    const x = u.ax + dx * r, y = u.ay + dy * r; if (!ok(x, y)) continue;
    const up = map.h ? map.h(x, y) - map.h(u.ax, u.ay) : 0;
    const P = H(w).placeAt?.(x, y);
    return { x, y, name: up > 4 ? "to the rise behind us" : P && !P.near ? `to ${P.name}` : "toward our lines" };
  }
  return null;
}
// the nearest good cover not nearer the bows (and not onto enemy foot)
function coverPoint(w, u, bows, foes) {
  const map = w.map; let best = null, bd = Infinity;
  const bx = bows.reduce((s, v) => s + v.ax, 0) / bows.length, by = bows.reduce((s, v) => s + v.ay, 0) / bows.length, d0 = Math.hypot(u.ax - bx, u.ay - by);
  for (let r = 30; r <= 150; r += 30) for (let k = 0; k < 12; k++) {
    const a = k / 12 * 6.2832, x = u.ax + Math.cos(a) * r, y = u.ay + Math.sin(a) * r;
    if (map.inBounds && !map.inBounds(x, y)) continue;
    const t = terrainAt(w, x, y); if (coverOf(t) < 0.4 || (map.water && map.water(x, y) > 0.3)) continue;
    const db = Math.hypot(x - bx, y - by); if (db < d0 - 15) continue;
    if (foes.some(([v]) => !ARMS[v.arm].missile && v.state !== "routing" && Math.hypot(v.ax - x, v.ay - y) < 80)) continue;
    const s = r + (db < d0 ? 30 : 0); if (s < bd) { bd = s; best = { x, y, d: r, back: db > d0 + 10, wood: /forest|wood|copse|thicket|scrub/i.test(t.name || "") }; }
    if (best && r > best.d) break;
  }
  return best;
}

// ---------------------------------------------------------------- proposals
function propose(w, u, cap, p) {
  const K = C(w), human = isHuman(w, u.team) && !H(w).delegated?.(u.id), T = TEMPERS[cap.temper];
  if (w.time - (K.lastProp[u.team] ?? -1e9) < (human ? CAPT.teamGap : 3)) return;
  const mode = human ? initiativeOf(w, u) : "on";
  const P = { id: K.seq++, team: u.team, unit: u.id, kind: p.kind, what: p.what, why: p.why, x: Math.round(p.v ? p.v.ax : p.pt.x), y: Math.round(p.v ? p.v.ay : p.pt.y),
    target: p.v ? p.v.id : null, order: { ...p.order, x: Math.round(p.order.x * 10) / 10, y: Math.round(p.order.y * 10) / 10 }, limit: p.limit || 0,
    prio: Math.round(p.score * 100) / 100, t0: w.time, until: w.time + CAPT.countdown, oT: u.orderT ?? -1, state: "pending", name: captainName(w, u, true), arm: u.arm, men: u.members.length };
  cap.nextT = w.time + CAPT.unitGap * T.cd * (0.8 + 0.4 * (1 - cap.skill));
  K.lastProp[u.team] = w.time;
  if (mode === "on") { execute(w, P, human ? "acts" : "ai"); return; }
  const mine = K.props.filter((q) => q.team === u.team && q.state === "pending");
  if (mine.length >= CAPT.maxCards) {
    const low = mine.reduce((a, b) => (b.prio < a.prio ? b : a));
    if (P.prio <= low.prio + 0.15) { K.done.push({ ...P, state: "dropped" }); return; }
    low.state = "dropped";
  }
  K.props.push(P);
  w.events.push({ t: w.tick, kind: "captain-proposal", team: u.team, unit: u.id, prop: P.id });
}
// is the proposal still worth doing, and still his to do?
function stillGood(w, P) {
  const u = w.units.get(P.unit); if (!u || !u.members.length) return "gone";
  const cap = captainOf(u); if (!cap || cap.lostT >= 0) return "captain down";
  if ((u.orderT ?? -1) > P.oT && !u.order?.cap || u.pendingOrder && !u.pendingOrder.cap) return "new orders"; // the player gave him orders since: they stand
  if (u.state === "routing" || u.c?.broken) return "broken";
  if (P.target !== null) {
    const v = w.units.get(P.target); if (!v || !v.members.length) return "target gone";
    if (P.kind !== "pursue" && v.state === "routing") return "target broken";
    if (P.kind === "pursue" && v.state !== "routing") return "they rallied";
  }
  if (!free(w, u) && !u.capAct) return "not free";
  return null;
}
function tendProps(w, K) {
  for (const P of K.props) {
    if (P.state !== "pending") continue;
    const bad = stillGood(w, P);
    if (bad) { P.state = "void"; P.why2 = bad; continue; }
    if (w.time >= P.until) execute(w, P, "countdown");
  }
  for (let i = K.props.length - 1; i >= 0; i--) if (K.props[i].state !== "pending") { K.done.push(K.props[i]); K.props.splice(i, 1); }
}
// carry it out (the countdown ran out, the player said "Do it now", initiative on, or an AI captain)
function execute(w, P, how) {
  const u = w.units.get(P.unit); if (!u) return false;
  const o = { ...P.order, cap: P.id, immediate: true }; // (he is with his men: his word needs no rider)
  if (P.target !== null) { const v = w.units.get(P.target); if (!v || !v.members.length) { P.state = "void"; return false; } o.x = v.ax; o.y = v.ay; }
  if (w.chains) w.chains = w.chains.filter((c) => !c.units.includes(u.id)); // (a captain's orders replace the chain)
  u.fireAt = null;
  issueOrder(w, [u.id], o);
  u.capAct = { pid: P.id, kind: P.kind, t: w.time, sx: u.ax, sy: u.ay, limit: P.limit || 0, until: w.time + CAPT.actMax, target: P.target };
  P.state = "done"; P.how = how;
  const cap = captainOf(u); if (cap) cap.oCap = P.id;
  if (how !== "ai") say(w, u, `${P.name}: ${lower(P.what)} — ${P.why}`, { force: how === "yes" || how === "countdown" });
  w.events.push({ t: w.tick, kind: "captain-acts", team: u.team, unit: u.id, prop: P.id, what: P.kind, how });
  return true;
}
const lower = (s) => s[0].toLowerCase() + s.slice(1);
function tendAct(w, u) {
  const a = u.capAct, o = u.order || {};
  if (o.cap !== a.pid && !u.pendingOrder) { u.capAct = null; return; } // someone else has given him orders
  if (w.time > a.until || u.state === "routing") { u.capAct = null; return; }
  if (a.kind === "pursue") {
    const v = w.units.get(a.target);
    if (Math.hypot(u.ax - a.sx, u.ay - a.sy) > a.limit || !v || !v.members.length || v.state !== "routing") { // far enough: halt and dress ranks
      issueOrder(w, [u.id], { kind: "hold", x: u.ax, y: u.ay, facing: Math.atan2(u.ay - a.sy, u.ax - a.sx), cap: a.pid, immediate: true });
      u.capAct = { ...a, kind: "halt", until: w.time + 15 };
    }
  } else if (a.kind === "fallback" || a.kind === "cover" || a.kind === "halt") {
    if (!u.path && !u.pendingOrder && w.time - a.t > 3) u.capAct = null;
  } else if (o.kind !== "assault" && !u.pendingOrder && w.time - a.t > 5) u.capAct = null; // (the fight is over: world.js stood him down)
}

// ---------------------------------------------------------------- the player's word (commands.js ops "captain" / "initiative")
export function decide(w, team, pid, yes) {
  const K = C(w), P = K.props.find((q) => q.id === pid && q.team === team);
  if (!P || P.state !== "pending") return { ok: false, error: "That moment has passed" };
  if (!yes) {
    P.state = "refused";
    const u = w.units.get(P.unit), cap = captainOf(u);
    if (cap) { cap.no[P.kind] = w.time + CAPT.noGap; cap.nextT = Math.max(cap.nextT, w.time + CAPT.noGap / 2); }
    return { ok: true, msg: `${P.name} stays as he is` };
  }
  const bad = stillGood(w, P); if (bad) { P.state = "void"; return { ok: false, error: `Too late — ${bad}` }; }
  execute(w, P, "yes");
  return { ok: true };
}
export function setInitiative(w, team, ids, mode) {
  if (!MODES.includes(mode) && mode !== null) return { ok: false, error: "on, ask or off" };
  const K = C(w);
  if (!ids) { // the team's default
    K.global[team] = mode || "ask";
    for (const P of K.props) if (P.team === team && P.state === "pending" && mode === "off") { const u = w.units.get(P.unit); if (!u?.initiative) P.state = "void"; }
    return { ok: true, msg: `Captains' initiative: ${WORD[K.global[team]]}` };
  }
  const us = ids.map((id) => w.units.get(id)).filter((u) => u && u.team === team && captainable(u));
  if (!us.length) return { ok: false, error: "No companies selected" };
  for (const u of us) {
    u.initiative = mode || undefined;
    if (mode === "off") for (const P of K.props) if (P.unit === u.id && P.state === "pending") P.state = "void";
  }
  return { ok: true, msg: `Initiative ${WORD[mode] || "as the army"}: ${us.length} ${us.length > 1 ? "companies" : "company"}` };
}
export const WORD = { on: "on — they act and report", ask: "ask me first", off: "off" };
// the team's cards (the UI; the realm's state message)
export function propsFor(w, team) {
  return C(w).props.filter((P) => P.team === team && P.state === "pending").map((P) => ({ id: P.id, unit: P.unit, kind: P.kind, what: P.what, why: P.why, x: P.x, y: P.y, target: P.target,
    left: Math.max(0, Math.round((P.until - w.time) * 10) / 10), cd: CAPT.countdown, prio: P.prio, name: P.name, arm: P.arm, men: P.men }));
}
export function globalInitiative(w, team) { return C(w).global[team] || "ask"; }
