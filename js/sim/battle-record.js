// The battle's memory: what happened, when, where, to whom — for the moments shown while it is fought and the
// reckoning after it (docs/battle-feel-research.md §8). A sim system; no DOM.
//
//   makeRecorder(w, ctx) → rec;  w.systems.push(rec.system)
//     ctx = { names, sides, objectives, onMoment(m), frameEvery }
//     names: { side(team) "the English", adj(team) "English"|null, arm(team, arm) "the English archers", place(x,y) "at Hob's Ford", person(id) }
//   rec.moments  [{ t, kind, kicker, text, team, good (the team it favours), x, y, sal }]
//   rec.frames   [{ t, u: [id, team, armId, x, y, men, state] … }]   every ~2 s, for the replay
//   rec.cas      per team: dead, wounded, fled, captured; byCause; byArm
//   rec.outcome  { winner, loser, why, t } once decided (a side broken, an objective met, nightfall)
//
// Moments come from the combat engineer's 'decisive-moment' events and from what this module sees itself:
// first contact, the first arrows home, a charge striking, a flank or rear charge, horses balking at stakes,
// a banner falling or raised, a lord lost, a named man slain, a company breaking, the rout spreading, men
// drowning, the press killing, the bridgehead won or lost, an ambush sprung, and the end.
import { ARMS, ARM_BY_ID } from "./arms.js";
import { S_FLEE, ST_FLEE, S_CAPT } from "./soldiers.js";
import { nameOf } from "./legend.js";

export const CAUSE = {
  arrows: "Arrows and bolts", blades: "Sword, axe and spear", horse: "Ridden down", rout: "Cut down in the rout",
  press: "Crushed in the press", drown: "Drowned", wounds: "Finished where they fell", quarter: "Given no quarter",
  works: "Stakes, pits and falls", stones: "Stones",
};
const STATE_CODE = { formed: 0, wavering: 1, shaken: 1, routing: 2 };

export function makeRecorder(w, ctx) {
  const S = w.S, names = ctx.names;
  const rec = {
    t0: w.time, moments: [], frames: [], outcome: null, ctx,
    start: [0, 0], cas: [0, 1].map(() => ({ dead: 0, wounded: 0, fled: 0, captured: 0, byCause: {}, byArm: {} })),
    units: new Map(), feats: [], firstContact: -1, hostOf: new Int8Array(Math.max(S.cap, 8192)).fill(-1), downCause: new Map(),
    stats: { refuseObstacle: [0, 0], drownT: [], crushT: [], breaks: [[], []], acrossMax: 0, charges: 0, flankCharges: [0, 0], lordLost: [null, null] },
  };
  const T = () => w.time - rec.t0;
  // ---- who is in the battle (the hosts; the vills' people are not counted)
  function enrol() {
    for (const u of w.units.values()) {
      if (!u.battleHost) continue;
      let U = rec.units.get(u.id);
      if (!U) { U = { id: u.id, team: u.team, arm: u.arm, name: u.coName || null, n0: u.members.length, broke: -1, kills: 0, lost: 0, contact: -1, role: u.role }; rec.units.set(u.id, U); }
      for (const id of u.members) if (rec.hostOf[id] < 0) { if (id >= rec.hostOf.length) grow(); rec.hostOf[id] = u.team; rec.start[u.team]++; }
      if (U.contact < 0 && u.c?.contactT >= 0) U.contact = T();
    }
  }
  function grow() { const a = new Int8Array(rec.hostOf.length * 2).fill(-1); a.set(rec.hostOf); rec.hostOf = a; }
  const teamOf = (id) => (id >= 0 && id < rec.hostOf.length ? rec.hostOf[id] : -1);
  const unitOfMan = (id) => w.units.get(S.unit[id]);
  // ---- moments
  const seenKinds = new Set();
  function moment(m) {
    const mm = { t: T(), sal: 0.5, ...m };
    if (mm.once && seenKinds.has(mm.once)) return null;
    // the same thing again within half a minute (a second company of the same arm breaking): one moment, counted
    const prev = rec.moments.findLast?.((q) => q.kind === mm.kind && q.text === mm.text && mm.t - q.t < 30);
    if (prev) { prev.n = (prev.n || 1) + 1; return null; }
    if (mm.once) seenKinds.add(mm.once);
    rec.moments.push(mm); ctx.onMoment?.(mm); return mm;
  }
  rec.moment = moment;
  // ---- casualties
  function causeOf(e, victim) {
    const c = e.cause, by = e.by ?? -1;
    if (c === "missile") return "arrows";
    if (c === "melee") { if (e.fleeing) return "rout"; if (by >= 0 && ARM_BY_ID[S.arm[by]]?.mounted && S.horseOK?.[by]) return "horse"; return "blades"; }
    if (c === "crush") return "press"; if (c === "drown") return "drown"; if (c === "fled") return "rout"; if (c === "no-quarter") return "quarter";
    if (c === "obstacle" || c === "fall") return "works"; if (c === "stone") return "stones";
    if (c === "bleed" || c === "finish") return rec.downCause.get(victim) || "wounds";
    return "blades";
  }
  function dead(victim, cause) {
    const tm = teamOf(victim); if (tm < 0) return;
    const C = rec.cas[tm]; C.dead++; C.byCause[cause] = (C.byCause[cause] || 0) + 1;
    const arm = ARM_BY_ID[S.arm[victim]]?.key || "?"; (C.byArm[arm] ||= { dead: 0, wounded: 0 }).dead++;
    const U = rec.units.get(S.home?.[victim]) || rec.units.get(S.unit[victim]); if (U && !rec.downCause.has(victim)) U.lost++; // (a man already down was counted lost when he fell)
    if (cause === "drown") rec.stats.drownT.push([T(), tm]); if (cause === "press") rec.stats.crushT.push([T(), tm]);
    // a named man falls
    const sg = w.sagas?.get(victim);
    if (sg && sg.rank >= 2) moment({ kind: "hero-slain", kicker: "A champion falls", text: `${nameOf(S.name[victim])}, ${["", "veteran", "champion", "captain"][Math.min(3, sg.rank)]} of ${names.side(tm)}, is slain ${names.place(S.x[victim], S.y[victim])}`, team: tm, good: 1 - tm, x: S.x[victim], y: S.y[victim], sal: 0.55 });
  }
  // ---- charges: impacts gathered per attacking company over 3 s, then judged front / flank / rear
  const charges = new Map();
  function judgeCharge(ch) {
    const a = w.units.get(ch.unit), v = w.units.get(ch.on); if (!a || !v) return;
    const hd = (v.facing ?? 0) + Math.PI / 2; // the way the struck body faces
    const ang = Math.atan2(a.ay - v.ay, a.ax - v.ax), off = Math.abs(((ang - hd + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
    const how = off > 2.1 ? "rear" : off > 1.05 ? "flank" : "front";
    const where = names.place(v.ax, v.ay);
    rec.stats.charges++;
    if (how !== "front") rec.stats.flankCharges[a.team]++;
    if (how === "front" && ch.n < 4) return;
    const aw = names.arm(a.team, a.arm), vw = names.arm(v.team, v.arm);
    moment(how === "front"
      ? { kind: "charge", kicker: "The charge strikes home", text: `${cap(aw)} crash into ${vw} ${where}`, team: a.team, good: a.team, x: v.ax, y: v.ay, sal: 0.45 + Math.min(0.2, ch.n / 60), unit: a.id }
      : { kind: "flank-charge", kicker: how === "rear" ? "Taken from behind" : "Struck in the flank", text: `${cap(aw)} fall on the ${how} of ${vw} ${where}`, team: a.team, good: a.team, x: v.ax, y: v.ay, sal: 0.85, unit: a.id, on: v.id });
  }
  // ---- per tick
  const ob = ctx.objectives || {};
  let lastFrame = -1e9, lastEnrol = -1e9, lastCheck = -1e9, firstShaft = false, ambushDone = new Set();
  rec.system = (w) => {
    const t = T();
    if (w.tick - lastEnrol >= 10) { lastEnrol = w.tick; enrol(); }
    for (const e of w.events) {
      switch (e.kind) {
        case "down": { const tm = teamOf(e.victim); if (tm < 0) break; const c = causeOf(e, e.victim); rec.downCause.set(e.victim, c); rec.cas[tm].wounded++; { const U = rec.units.get(S.home?.[e.victim]) || rec.units.get(S.unit[e.victim]); if (U) U.lost++; /* (owner 2026-10-05: a man down and out of the fight is lost to his company, dead or not) */ } const arm = ARM_BY_ID[S.arm[e.victim]]?.key || "?"; (rec.cas[tm].byArm[arm] ||= { dead: 0, wounded: 0 }).wounded++;
          if (e.by >= 0) { const U = rec.units.get(S.unit[e.by]); if (U) U.kills += 0.3; } break; }
        case "kill": { const c = causeOf(e, e.victim); dead(e.victim, c); if (e.by >= 0) { const U = rec.units.get(S.unit[e.by]); if (U) U.kills++; } break; }
        case "die": { const tm = teamOf(e.victim); if (tm < 0) break; rec.cas[tm].wounded = Math.max(0, rec.cas[tm].wounded - 1); dead(e.victim, causeOf(e, e.victim)); break; }
        case "captured": { const tm = teamOf(e.who); if (tm >= 0) rec.cas[tm].captured++; break; }
        case "feat": if (teamOf(e.who) >= 0) rec.feats.push({ t, who: e.who, team: e.team, text: e.text, tier: e.tier }); break;
        case "impact": case "shock": {
          const au = e.kind === "impact" ? unitOfMan(e.who) : w.units.get(e.unit), vu = e.kind === "impact" ? unitOfMan(e.on) : w.units.get(e.on);
          if (!au || !vu || !au.battleHost || au.team === vu.team) break;
          if (e.kind === "shock" && !ARMS[au.arm].mounted && !e.burst) break;
          let ch = charges.get(au.id);
          if (!ch || t - ch.t0 > 20) { ch = { unit: au.id, on: vu.id, t0: t, n: 0, judged: false }; charges.set(au.id, ch); }
          ch.n += e.kind === "impact" ? 1 : 3; break;
        }
        case "refuse": if (e.at === "obstacle") { const tm = teamOf(e.who); if (tm >= 0) { rec.stats.refuseObstacle[tm]++; if (rec.stats.refuseObstacle[tm] === 6) moment({ kind: "stakes", kicker: "The horse balk", text: `${names.adj(tm) ? "The " + names.adj(tm) : cap(names.side(tm)) + "'s"} horses will not face the stakes and ditches ${names.place(S.x[e.who], S.y[e.who])}`, team: tm, good: 1 - tm, x: S.x[e.who], y: S.y[e.who], sal: 0.6 }); } } break;
        case "unit-break": case "unit-routing": {
          const u = w.units.get(e.unit), U = rec.units.get(e.unit); if (!u || !U || U.broke >= 0) break;
          U.broke = t; rec.stats.breaks[u.team].push(t);
          const arrowBroke = u.c && u.c.contactT < 0 && (u.c.mcas || 0) >= Math.max(3, 0.5 * u.c.cas);
          const n = rec.stats.breaks[u.team].filter((b) => t - b < 120).length;
          const first = rec.stats.breaks[0].length + rec.stats.breaks[1].length === 1;
          moment(arrowBroke
            ? { kind: "arrow-break", kicker: "Broken by the arrows", text: `${cap(names.arm(u.team, u.arm))} break under the shafts before they can close ${names.place(u.ax, u.ay)}`, team: u.team, good: 1 - u.team, x: u.ax, y: u.ay, sal: 0.75, unit: u.id }
            : { kind: "break", kicker: first ? "The first to break" : "A company breaks", text: `${cap(names.arm(u.team, u.arm))} break and run ${names.place(u.ax, u.ay)}`, team: u.team, good: 1 - u.team, x: u.ax, y: u.ay, sal: first ? 0.7 : 0.5, unit: u.id });
          if (n >= 3 && !seenKinds.has("rout-" + u.team)) moment({ kind: "rout", once: "rout-" + u.team, kicker: "The rout spreads", text: `Panic runs through ${names.side(u.team)}: company after company turns to flee`, team: u.team, good: 1 - u.team, x: u.ax, y: u.ay, sal: 0.95 });
          break;
        }
        case "unit-rallied": { const u = w.units.get(e.unit), U = rec.units.get(e.unit); if (u && U && U.broke >= 0 && t - U.broke > 5) moment({ kind: "rally", kicker: "Rallied", text: `${cap(names.arm(u.team, u.arm))} rally to their banner ${names.place(u.ax, u.ay)}`, team: u.team, good: u.team, x: u.ax, y: u.ay, sal: 0.4 }); break; }
        case "banner-down": moment({ kind: "banner-down", kicker: "The banner is down", text: `${cap(names.lord(e.team))}'s great banner falls ${names.place(e.x, e.y)}`, team: e.team, good: 1 - e.team, x: e.x, y: e.y, sal: 0.9 }); break;
        case "banner-lost": moment({ kind: "banner-lost", kicker: "The banner is lost", text: `Nobody lifts ${names.lord(e.team)}'s banner: it is trampled in the press`, team: e.team, good: 1 - e.team, x: e.x, y: e.y, sal: 0.8 }); break;
        case "banner-raised": { const p = e.who >= 0 ? { x: S.x[e.who], y: S.y[e.who] } : {}; moment({ kind: "banner-raised", kicker: "The banner is raised again", text: `${e.who >= 0 ? nameOf(S.name[e.who]) : "A knight"} lifts ${names.lord(e.team)}'s banner again and cries the war cry`, team: e.team, good: e.team, ...p, sal: 0.75 }); break; }
        case "lord-takes-field": moment({ kind: "lord-rides", kicker: "The lord rides out", text: `${cap(names.lord(e.team))} rides out under his banner`, team: e.team, good: e.team, x: e.x, y: e.y, sal: 0.5 }); break;
        case "lord-lost": { rec.stats.lordLost[e.team] = { t, how: e.how }; const how = e.how === "captured" ? "is taken prisoner" : e.how === "fled" || e.how === "led-away" ? "is led from the field" : "is slain"; moment({ kind: "lord-lost", kicker: e.how === "captured" ? "The lord is taken" : "The lord has fallen", text: `${cap(names.lord(e.team))} ${how} ${names.place(e.x, e.y)}`, team: e.team, good: 1 - e.team, x: e.x, y: e.y, sal: 1 }); break; }
        case "decisive-moment": { // from the combat engineer: pass it on, in its own words
          const p = e.x !== undefined ? { x: e.x, y: e.y } : e.unit !== undefined && w.units.get(e.unit) ? { x: w.units.get(e.unit).ax, y: w.units.get(e.unit).ay } : e.who !== undefined ? { x: S.x[e.who], y: S.y[e.who] } : {};
          moment({ kind: "decisive:" + (e.type || e.what || "moment"), kicker: e.title || e.kicker || titleOf(e.type || e.what), text: e.text || e.line || `${titleOf(e.type || e.what)} ${p.x !== undefined ? names.place(p.x, p.y) : ""}`, team: e.team ?? -1, good: e.good ?? (e.team !== undefined ? 1 - e.team : -1), ...p, sal: e.salience ?? e.sal ?? 0.8, engine: true });
          break;
        }
      }
    }
    // charges judged 3 s after the first impact
    for (const [id, ch] of charges) { if (!ch.judged && t - ch.t0 >= 3) { ch.judged = true; judgeCharge(ch); } if (t - ch.t0 > 30) charges.delete(id); }
    if (w.tick % 10 === 0) derive(t);
    if (w.tick - lastFrame >= (ctx.frameEvery || 20)) { lastFrame = w.tick; snapshot(t); }
    if (!rec.outcome && w.tick - lastCheck >= 10) { lastCheck = w.tick; judge(t); }
  };
  function derive(t) {
    // first contact: the first company of either host to close
    if (rec.firstContact < 0) for (const u of w.units.values()) if (u.battleHost && u.c?.contactT >= 0 && !ARMS[u.arm].missile) {
      rec.firstContact = t; moment({ kind: "contact", kicker: "The lines meet", text: `${cap(names.arm(u.team, u.arm))} come to hand-strokes ${names.place(u.ax, u.ay)}`, team: -1, good: -1, x: u.ax, y: u.ay, sal: 0.7 }); break;
    }
    if (!firstShaft) for (const u of w.units.values()) if (u.battleHost && (u.c?.mcas || 0) > 0) {
      firstShaft = true; moment({ kind: "first-shafts", kicker: "The arrows fly", text: `The first shafts fall among ${names.arm(u.team, u.arm)} ${names.place(u.ax, u.ay)}`, team: u.team, good: 1 - u.team, x: u.ax, y: u.ay, sal: 0.35 }); break;
    }
    // drowning and the press: bursts
    for (const [key, list, kick, verb] of [["drown", rec.stats.drownT, "The water takes them", "drown"], ["press", rec.stats.crushT, "The press", "are crushed to death in the press"]]) {
      for (const tm of [0, 1]) {
        const n = list.filter(([tt, k]) => k === tm && t - tt < 60).length;
        if (n >= (key === "drown" ? 5 : 6) && !seenKinds.has(key + tm)) {
          seenKinds.add(key + tm);
          const c = centreOf(tm, (u) => u.state === "routing") || centreOf(tm) || {};
          moment({ kind: key, kicker: kick, text: key === "drown" ? `Fleeing men of ${names.side(tm)} throw themselves into the water ${c.x !== undefined ? names.place(c.x, c.y) : ""} and drown` : `Men of ${names.side(tm)} ${verb}, unwounded, unable to lift their arms`, team: tm, good: 1 - tm, ...c, sal: 0.75 });
        }
      }
    }
    // the ambush: a hidden company shows itself
    for (const u of w.units.values()) if (u.battleHost && u.sprung && !ambushDone.has(u.id)) {
      ambushDone.add(u.id);
      moment({ kind: "ambush", kicker: u.role === "hidden" ? "Fresh men appear" : "The ambush is sprung", text: u.role === "hidden" ? `${cap(names.arm(u.team, u.arm))} come over the hill ${names.place(u.ax, u.ay)} — the other side takes them for a fresh host` : `${cap(names.arm(u.team, u.arm))} burst from cover ${names.place(u.ax, u.ay)}`, team: u.team, good: u.team, x: u.ax, y: u.ay, sal: 0.8 });
    }
    // a river between the hosts: the bridgehead
    const bh = ob.bridgehead; if (bh) {
      const n = acrossCount(bh);
      if (n > rec.stats.acrossMax) rec.stats.acrossMax = n;
      const tm = bh.team, total = rec.start[tm] || 1;
      if (n >= 0.3 * total && !seenKinds.has("across")) { seenKinds.add("across"); const c = centreAcross(bh); moment({ kind: "bridgehead", kicker: "Across the river", text: `${cap(names.side(tm))} have ${n} men over the water ${c ? names.place(c.x, c.y) : ""}`, team: tm, good: tm, ...(c || {}), sal: 0.7 }); }
      if (rec.stats.acrossMax >= 40 && n < rec.stats.acrossMax * 0.25 && !seenKinds.has("bh-lost")) { seenKinds.add("bh-lost"); moment({ kind: "bridgehead-lost", kicker: "The bridgehead is lost", text: `The men of ${names.side(tm)} who crossed are cut off and destroyed at the bridge's end`, team: tm, good: 1 - tm, x: bh.x, y: bh.y, sal: 1 }); }
    }
  }
  const acrossCount = (bh) => { let n = 0; for (let i = 0; i < S.n; i++) { if (!S.alive[i] || teamOf(i) !== bh.team || S.status[i] === ST_FLEE) continue; const f = (S.x[i] - bh.x) * Math.cos(bh.axis) + (S.y[i] - bh.y) * Math.sin(bh.axis); if (f * bh.sign > bh.beyond) n++; } return n; };
  const centreAcross = (bh) => { let x = 0, y = 0, n = 0; for (let i = 0; i < S.n; i++) { if (!S.alive[i] || teamOf(i) !== bh.team) continue; const f = (S.x[i] - bh.x) * Math.cos(bh.axis) + (S.y[i] - bh.y) * Math.sin(bh.axis); if (f * bh.sign > bh.beyond) { x += S.x[i]; y += S.y[i]; n++; } } return n ? { x: x / n, y: y / n } : null; };
  rec.acrossCount = acrossCount;
  function centreOf(team, pred = () => true) { let x = 0, y = 0, n = 0; for (const u of w.units.values()) if (u.battleHost && u.team === team && u.members.length && pred(u)) { x += u.ax * u.members.length; y += u.ay * u.members.length; n += u.members.length; } return n ? { x: x / n, y: y / n } : null; }
  rec.centreOf = centreOf;
  function snapshot(t) {
    const u = [];
    for (const v of w.units.values()) {
      if (!v.battleHost || !v.members.length) continue;
      u.push(v.id, v.team, ARMS[v.arm].id, Math.round(v.ax), Math.round(v.ay), v.members.length, v.hold ? 3 : STATE_CODE[v.state] ?? 0);
    }
    rec.frames.push({ t, u });
  }
  // ---- the state of each host: men still in the fight
  function strength(team) {
    let fight = 0, alive = 0, fled = 0;
    for (let i = 0; i < S.n; i++) {
      if (teamOf(i) !== team || !S.alive[i]) continue;
      alive++;
      if (S.status[i] === ST_FLEE || S.state[i] === S_FLEE) { fled++; continue; }
      if (S.state[i] === S_CAPT) continue;
      const u = w.units.get(S.unit[i]); if (u && u.state === "routing") { fled++; continue; }
      fight++;
    }
    return { fight, alive, fled };
  }
  rec.strength = strength;
  function judge(t) {
    const st = [strength(0), strength(1)];
    rec.now = st;
    if (!rec.start[0] || !rec.start[1]) return;
    let loser = -1, why = "";
    for (const tm of [0, 1]) {
      const us = [...w.units.values()].filter((u) => u.battleHost && u.team === tm && u.members.length && !u.lurking);
      const allBroken = us.length > 0 && us.every((u) => u.state === "routing" || u.c?.broken);
      if (!us.length || allBroken) { loser = tm; why = "every company broken and in flight"; break; }
      if (st[tm].fight < 0.3 * rec.start[tm]) { loser = tm; why = `only ${st[tm].fight} of ${rec.start[tm]} men still standing to fight`; break; }
    }
    // the objectives of the day
    if (loser < 0 && ob.bridgehead) {
      const bh = ob.bridgehead, n = acrossCount(bh);
      if (n >= bh.men) { bh.heldSince ??= t; if (t - bh.heldSince >= bh.secs) { loser = 1 - bh.team; why = `${names.side(bh.team)} held a bridgehead of ${n} men across the river`; } }
      else bh.heldSince = undefined;
    }
    if (loser < 0 && ob.timeLimit && t >= ob.timeLimit.secs) {
      if (ob.timeLimit.winner >= 0) { loser = 1 - ob.timeLimit.winner; why = ob.timeLimit.why || "night fell with the field still held"; }
      else { rec.outcome = { winner: -1, loser: -1, why: ob.timeLimit.why || "night fell and both hosts drew off", t }; moment({ kind: "end", kicker: "Nightfall", text: "Night falls. Neither host will give ground, and both draw off in the dark.", team: -1, good: -1, sal: 1 }); return; }
    }
    if (loser >= 0) {
      rec.outcome = { winner: 1 - loser, loser, why, t };
      const c = centreOf(loser) || {};
      moment({ kind: "end", kicker: "The field is won", text: `${cap(names.side(1 - loser))} hold the field: ${names.side(loser)} are beaten — ${why}`, team: loser, good: 1 - loser, ...c, sal: 1 });
    }
  }
  rec.finalise = () => {
    for (const tm of [0, 1]) { const st = strength(tm); rec.cas[tm].fled = st.fled; rec.cas[tm].standing = st.fight; }
    snapshot(T());
  };
  enrol();
  return rec;
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const titleOf = (k) => cap(String(k || "a turning point").replace(/[-_]/g, " "));
