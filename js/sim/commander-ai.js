// Battle AI shared by delegated player commanders and the enemy general.
// It reasons with the same terrain analysis the player sees, weighted by the commander's
// disposition (a Stubborn Defender takes the hill and waits; a Hotspur charges).
//
// A medieval army fights as a LINE, not as a stream of companies (docs/combat-research.md §13): the
// commander first draws his "battles" up side by side (foot in the centre, bows on the wings, horse behind
// the wings), then either holds good ground or advances the whole line together — halting at bowshot for
// the archers if he has them — and only when the line is close does every company go in against the
// enemy body opposite it. Horse is kept back for the moment: a counter-charge, a flank already engaged, a
// wavering enemy, or the pursuit. Every order still travels through command friction (world.issueOrder).
import { ARMS, formationFiles } from "./arms.js";
import { MISSILES } from "./kit.js";
import { issueOrder } from "./world.js";
import { analysePoint } from "./analysis.js";
import { DISPOSITIONS } from "./legend.js";
import { canSee } from "./vision.js";
import { isFoe } from "./sides.js";

export const CAI = {
  think: 40,          // ticks between thoughts (4 real s)
  gap: 6,             // m between companies in the line
  wingFwd: 20,        // m the bow wings stand forward of the foot
  cavBack: 70,        // m the horse waits behind the wings
  formTol: 18,        // m: a company this close to its place counts as dressed
  formWait: 240,      // battle-s the line waits for stragglers before moving anyway
  halt: 300,          // m from the enemy line: the attacker's foot halts out of bowshot while its own bows go forward
  bowStand: 170,      // m from the enemy the attacker's archers shoot from
  shootT: 900,        // battle-s from the halt (walking forward included) the archers are given before the foot goes in (× 1.2 − aggression)
  closeIn: 90,        // m: the line goes in when this close to the enemy foot
  replan: 20,         // m the enemy may shift before the line is re-aimed
  reserveFrac: 0.6,   // companies smaller than this × the largest stand in the second line
  reserveBack: 45,    // m behind the first line
  hqBack: 60,         // m the commander keeps behind his line
  hotspur: 0.8,       // aggression from which the commander goes straight in without an archery halt
  hotIn: 220,         // m: a Hotspur's line goes in from this far (within bowshot there is no dressing ranks)
  standoff: 360,      // battle-s a defender waits on his ground with no enemy coming before he goes out to him
  standoffR: 400,     // m: an enemy body this near his line counts as coming
  archeryLost: 0.03,  // share of our strength lost more than the enemy's at the halt: the archery is lost, go in
  shootMax: 480,      // battle-s at most at the halt before the line goes in
  bowSafe: 290,       // m from the enemy's bows the halted line keeps (longbow reach 260 + a margin)
  bowRetire: 0.4,     // mean stress at which a company of bows is pulled back behind the foot
};

export function commandBattle(w, cmd) {
  // cmd = { team, units:Set<unitId>, disposition, V (vision), lastThink, anchor:{x,y} }
  if (w.tick - (cmd.lastThink || -999) < CAI.think) return;
  cmd.lastThink = w.tick;
  const D = DISPOSITIONS[cmd.disposition] || DISPOSITIONS.inspiring;
  const mine = [...cmd.units].map((id) => w.units.get(id)).filter((u) => u && u.members.length);
  if (!mine.length) return;
  // what he knows of the enemy: the bodies he can see, and where he last saw the rest (a line that has
  // stepped back over a rise has not vanished; before, losing sight of it froze the whole army)
  const seen = cmd.seen || (cmd.seen = new Map());
  for (const u of w.units.values()) {
    if (!isFoe(w, cmd.team, u.team) || !u.members.length || u.isWorkers) continue;
    if (!cmd.V || canSee(cmd.V, cmd.team, u.ax, u.ay)) seen.set(u.id, { id: u.id, team: u.team, arm: u.arm, ax: u.ax, ay: u.ay, fx: u.fx, fy: u.fy, members: u.members, state: u.state, c: u.c, hold: u.hold, moving: u.moving, retired: u.retired, live: u });
  }
  const foes = [];
  for (const [id, k] of seen) { const u = w.units.get(id); if (!u || !u.members.length) { seen.delete(id); continue; } foes.push(k.live === u && (!cmd.V || canSee(cmd.V, cmd.team, u.ax, u.ay)) ? u : k); }
  if (!foes.length) return; // nothing seen or remembered: keep last orders
  const c = centroid(mine);
  const inf = mine.filter((u) => !ARMS[u.arm].mounted && !ARMS[u.arm].missile && u.arm !== "villager" && !u.isWorkers);
  const missile = mine.filter((u) => ARMS[u.arm].missile);
  const cav = mine.filter((u) => ARMS[u.arm].mounted);
  const foeFoot = foes.filter((u) => !ARMS[u.arm].mounted && u.state !== "routing");
  const fc = centroid(foeFoot.length ? foeFoot : foes);
  const routing = foes.filter((u) => u.state === "routing");
  const strength = (us) => us.reduce((s, u) => s + u.members.length * (1 + ARMS[u.arm].armour * 0.3) * (u.state === "formed" ? 1 : 0.4), 0);
  const odds = strength(mine) / (strength(foes) || 1);
  const B = cmd.battle || (cmd.battle = { phase: "deploy", t0: w.time });

  // ---- the plan: where the line stands and which way it faces
  // (a line that has gone in stays in: a captain does not march his army back to redeploy in the middle of the
  // fight because the odds tipped — that is how armies are lost, §13. A defender whom nobody comes to fight
  // goes to him in the end: CAI.standoff battle-s with no enemy body within reach of his line.)
  const nearFoe = foes.some((v) => !ARMS[v.arm].mounted && Math.hypot(v.ax - c.x, v.ay - c.y) < CAI.standoffR);
  if (B.phase === "hold" && !nearFoe) { if (B.quietSince === undefined) B.quietSince = w.time; } else B.quietSince = undefined;
  if (B.phase === "hold" && B.quietSince !== undefined && w.time - B.quietSince > CAI.standoff) B.goOut = true;
  const defend = B.phase === "engage" ? false : !B.goOut && (D.aggression < 0.5 && odds < 1.8 || odds < 0.7);
  if (defend !== B.defend) { B.defend = defend; B.centre = null; B.phase = "deploy"; B.t0 = w.time; }
  if (!B.centre) {
    B.centre = defend ? bestGround(w, c, Math.atan2(fc.y - c.y, fc.x - c.x), D) : { x: c.x, y: c.y };
    B.face = Math.atan2(fc.y - B.centre.y, fc.x - B.centre.x); B.aimAt = { ...fc };
  }
  // re-aim the line if the enemy has shifted (not once the companies are going in)
  if (B.phase !== "engage" && Math.hypot(fc.x - B.aimAt.x, fc.y - B.aimAt.y) > CAI.replan) {
    B.face = turn(B.face, Math.atan2(fc.y - B.centre.y, fc.x - B.centre.x), 0.35); B.aimAt = { ...fc };
  }
  const fx = Math.cos(B.face), fy = Math.sin(B.face), lx = -fy, ly = fx;
  // the commander rides with his army, behind the middle of his line: orders go by voice and horn to the
  // companies near him, by rider to the rest (command.js reads team.hq)
  if (w.teams?.[cmd.team]) { const c0 = B.front || c; w.teams[cmd.team].hq = { x: c0.x - fx * CAI.hqBack, y: c0.y - fy * CAI.hqBack }; }
  const layout = lineLayout(inf, missile, cav, B, lx, ly);
  const place = (u) => { const o = layout.get(u.id); return { x: B.centre.x + lx * o.lat + fx * o.fwd, y: B.centre.y + ly * o.lat + fy * o.fwd }; };
  // distance from our line to the nearest enemy foot in front of it (not to his centroid, which sits behind
  // his front — reserves and all)
  let distToFoe = Infinity;
  for (const v of foeFoot) { const dx = v.ax - B.centre.x, dy = v.ay - B.centre.y, fw = dx * fx + dy * fy; if (fw > -20 && Math.abs(dx * lx + dy * ly) < 200 && fw < distToFoe) distToFoe = fw; }
  if (!Number.isFinite(distToFoe)) distToFoe = Math.hypot(fc.x - B.centre.x, fc.y - B.centre.y);
  const foeNear = (u, r) => foeFoot.some((v) => Math.hypot(v.ax - u.ax, v.ay - u.ay) < r);

  // ---- phases
  const dressed = inf.every((u) => layout.get(u.id)?.reserve || u.hold || u.state === "routing" || Math.hypot(u.ax - place(u).x, u.ay - place(u).y) < CAI.formTol);
  const waited = w.time - B.t0;
  if (B.phase === "deploy" && (dressed || waited > CAI.formWait)) {
    if (!defend) { B.phase = "advance"; B.t0 = w.time; B.halted = false; }
    else B.phase = "hold";
  }
  const shootT = CAI.shootT * (1.2 - D.aggression) * (missile.length ? 1 : 0);
  // a Hotspur does not halt at bowshot to let the archery work: the whole line comes on at the double, its
  // bows shooting as they come into range (Crécy's French, Poitiers) — the battle is joined in minutes
  const hot = D.aggression >= CAI.hotspur;
  if (B.phase === "advance") {
    // the foot goes in once the archery has done its work — and not before the enemy's own bows are beaten
    // (shot out, driven off or pulled back), or it walks across the beaten ground into their shafts; a
    // commander who cannot win the archery duel goes in anyway in the end (DESIGN: a Hotspur at once, a cautious
    // captain after up to 2.5 × the shooting time)
    const foeBowsLive = foes.some((v) => ARMS[v.arm].missile && v.state !== "routing" && !v.retired && ammoFrac(w, v) > 0.25);
    // (and if his bows outrange ours — longbows against crossbows — standing at the halt only feeds him men: once
    // we have lost CAI.archeryLost of our strength more than he has since the halt, we go in)
    const men = (us) => us.reduce((n, u) => n + u.members.length, 0);
    if (B.halted && B.haltMen === undefined) B.haltMen = [men(mine), men(foes)];
    const losingArchery = B.halted && B.haltMen && (B.haltMen[0] - men(mine)) / B.haltMen[0] - Math.max(0, B.haltMen[1] - men(foes)) / Math.max(1, B.haltMen[1]) > CAI.archeryLost;
    const shotEnough = !missile.length || losingArchery || (B.halted && w.time - B.haltT > CAI.shootMax) || (B.halted && w.time - B.haltT > shootT && (!foeBowsLive || w.time - B.haltT > shootT * (1 + 1.5 * (1 - D.aggression)))) || missile.every((u) => ammoFrac(w, u) < 0.15);
    // one bound at a time: the whole line to the halt at bowshot (or straight in without bows), and it STAYS
    // there while its bows shoot (it used to take the next bound at once and walk into the enemy's shafts)
    const stop = missile.length && !shotEnough && !hot ? CAI.halt : CAI.closeIn * 0.8;
    let want = Math.max(0, distToFoe - stop);
    // (the halt is out of reach of HIS bows too — they stand forward on his wings, nearer than his foot)
    if (missile.length && !shotEnough && !hot) for (const v of foes) {
      if (!ARMS[v.arm].missile || v.state === "routing" || v.retired) continue;
      const dx = v.ax - B.centre.x, dy = v.ay - B.centre.y, fw = dx * fx + dy * fy, lat = Math.abs(dx * lx + dy * ly);
      const half = layout.size ? Math.max(...[...layout.values()].map((o) => Math.abs(o.lat))) : 0; // our line's half-width
      const reach = CAI.bowSafe - Math.max(0, lat - half) * 0.5; // (a bow off our end reaches our nearest company slantwise)
      if (fw > 0) want = Math.min(want, Math.max(0, fw - reach));
    }
    if (want > 10 && (dressed || waited > (hot ? CAI.formWait / 4 : CAI.formWait))) {
      const step = Math.min(want, 160);
      // (and square up on the enemy's line: shift along our front toward the middle of his foot, so the
      // two lines meet end to end instead of one lapping round the other)
      const side = ((fc.x - B.centre.x) * lx + (fc.y - B.centre.y) * ly) * 0.7;
      B.centre = { x: B.centre.x + fx * step + lx * side, y: B.centre.y + fy * step + ly * side }; B.t0 = w.time;
    } else if (want <= 10 && missile.length && !B.halted) { B.halted = true; B.haltT = w.time; B.haltMen = undefined; }
    if (hot && distToFoe < CAI.hotIn) { B.phase = "engage"; B.t0 = w.time; } // (the last stretch at the double, straight in)
    else if ((B.halted && shotEnough) || inf.some((u) => foeNear(u, CAI.closeIn)) || distToFoe < CAI.closeIn) {
      if (shotEnough || inf.some((u) => foeNear(u, CAI.closeIn * 0.7))) { B.phase = "engage"; B.t0 = w.time; }
      else B.halted = true;
    }
  }


  // ---- the reserve plugs the gap where a company of the first line has broken
  if (B.phase === "engage" || B.phase === "hold") {
    for (const v of mine) {
      if (!v.c?.broken || B.plugged?.has(v.id)) continue;
      const o = layout.get(v.id); if (!o || o.reserve || o.fwd !== 0) continue;
      let best = null, bd = Infinity;
      for (const r of inf) { const ro = layout.get(r.id); if (!ro?.reserve || r.c?.broken) continue; const d = Math.abs(ro.lat - o.lat); if (d < bd) { bd = d; best = r; } }
      (B.plugged ||= new Set()).add(v.id);
      if (best) { (B.committed ||= new Set()).add(best.id); (B.plug ||= new Map()).set(best.id, o.lat); layout.get(best.id).reserve = false; layout.get(best.id).fwd = 0; layout.get(best.id).lat = o.lat; }
    }
  }
  const inReserve = (u) => layout.get(u.id)?.reserve;
  if (B.phase === "engage") {
    // the second line keeps its distance behind where the first line actually is now
    let n = 0, sx = 0, sy = 0; for (const u of inf) if (!inReserve(u) && !u.c?.broken) { sx += u.ax - lx * layout.get(u.id).lat; sy += u.ay - ly * layout.get(u.id).lat; n++; }
    if (n) B.front = { x: sx / n, y: sy / n };
  }
  const placeR = (u) => { const o = layout.get(u.id), c0 = B.phase === "engage" && B.front ? B.front : B.centre; return { x: c0.x + lx * o.lat + fx * o.fwd, y: c0.y + ly * o.lat + fy * o.fwd }; };
  const foeBows = foes.some((v) => ARMS[v.arm].missile && v.state !== "routing");
  // ---- orders: foot
  const pace = (u) => { const sl = Math.min(...inf.map((v) => ARMS[v.arm].speed)); u.speedMul = B.phase === "engage" ? 1 : sl / ARMS[u.arm].speed; };
  for (const u of inf) {
    pace(u);
    if (B.phase === "engage" && inReserve(u)) { const p = placeR(u); if (!u.hold) order(w, u, "move", p.x, p.y, "march", B.face); continue; } // the reserve follows the line up
    if (B.phase === "engage") {
      // the line goes in STRAIGHT: each company marches square to the front on whatever stands before it
      // (a company that finds nobody in front keeps going — and so laps round the enemy's end, which is how
      // flanks are turned). Chasing the nearest enemy anchor instead wheels the companies into a scrum.
      const hw = (u.c?.halfW || 8) + 12;
      let opp = null, od = Infinity;
      for (const v of foeFoot) {
        const dx = v.ax - u.ax, dy = v.ay - u.ay, fw = dx * fx + dy * fy, lat = dx * lx + dy * ly;
        if (fw < -10 || Math.abs(lat) > hw + (v.c?.halfW || 8)) continue;
        if (fw < od) { od = fw; opp = v; }
      }
      // a company that has nobody in front because it has gone PAST the enemy (every foe level with it or behind:
      // it lapped round his end, or the fight has swung off the line's axis — round a keep, in a vill) wheels
      // onto the nearest body in reach: that is the flank being turned. Without this it marched on "square to
      // the front" into empty country while the fight went on behind it.
      // And a company that has found nobody in front of it for a minute goes to the sound of the fighting: it
      // falls on the nearest enemy body locked with one of our companies (foot, or horse caught in the press)
      let flank = null;
      if (opp || u.hold) u.idleSince = undefined; else u.idleSince ??= w.time;
      if (!opp && !u.hold) {
        let fd = 250;
        for (const v of foeFoot) { const dx = v.ax - u.ax, dy = v.ay - u.ay, d = Math.hypot(dx, dy); if (d < fd && dx * fx + dy * fy < 10) { fd = d; flank = v; } }
        if (flank && foeFoot.some((v) => (v.ax - u.ax) * fx + (v.ay - u.ay) * fy >= 10 && Math.hypot(v.ax - u.ax, v.ay - u.ay) < 250)) flank = null; // still enemy ahead: go on
        if (!flank && w.time - u.idleSince > 60) {
          let ld = 300;
          for (const v of foes) {
            if (!v.hold || v.state === "routing") continue;
            const d = Math.hypot(v.ax - u.ax, v.ay - u.ay);
            if (d < ld && mine.some((m) => m !== u && m.hold && Math.hypot(m.ax - v.ax, m.ay - v.ay) < 40)) { ld = d; flank = v; }
          }
        }
      }
      if (opp && opp.state === "routing") order(w, u, "assault", opp.ax, opp.ay, "quick", undefined, undefined, opp.id);
      else if (flank) order(w, u, "assault", flank.ax, flank.ay, "quick", undefined, undefined, flank.id);
      else if (!u.hold) {
        // square to the front; across ground his bows can reach, at the double, then the last 50 m at the walk to
        // meet him in order (DESIGN)
        const go = opp ? Math.max(25, od + 20) : 120, shot = foeBows && od > 50;
        order(w, u, "move", u.ax + fx * go, u.ay + fy * go, shot ? "quick" : "march", B.face);
      }
    } else {
      const p = place(u);
      // a defender's company falls on a broken or shaken enemy body at the foot of its position (a Stubborn
      // Defender only on one already running); the rest of the line keeps its ground
      const prey = B.phase === "hold" ? foeFoot.concat(routing).find((v) => (v.state === "routing" || (v.state === "shaken" && D.aggression > 0.3)) && Math.hypot(v.ax - u.ax, v.ay - u.ay) < 110) : null;
      if (prey) order(w, u, "assault", prey.ax, prey.ay, "quick", undefined, undefined, prey.id);
      else if (B.phase === "hold" && u.order.kind === "assault" && Math.hypot(u.ax - p.x, u.ay - p.y) > 30) order(w, u, "move", p.x, p.y, "march", B.face); // back to the line
      else order(w, u, B.phase === "hold" ? "hold" : "move", p.x, p.y, hot && B.phase === "advance" ? "quick" : "march", B.face);
    }
  }
  // ---- bows on the wings: they shoot whatever comes in range; spent, they fall in with the foot
  for (const u of missile) {
    const p = place(u);
    // bows that are getting the worst of the exchange (shaken by the shafts, or shot out with the enemy foot
    // coming on) are pulled back round the flank of the foot BEFORE they break: skirmishers retiring through
    // the gaps is a drill, a broken company streaming back through the line is a panic (DESIGN)
    const spent = !u.c?.joinedMelee && ammoFrac(w, u) < 0.15 && foeFoot.some((v) => Math.hypot(v.ax - u.ax, v.ay - u.ay) < 120);
    if ((u.retired && !u.c?.joinedMelee) || (u.c && !u.c.broken && (u.c.stressM > CAI.bowRetire || spent))) {
      if (!u.retired) { u.retired = w.time; u.holdFire = true; } // (they cease shooting while they go back)
      const o = layout.get(u.id), c0 = B.front || B.centre, side = o && o.lat >= 0 ? 1 : -1;
      const hw = Math.abs(o?.lat ?? 0);
      if (u.c?.stressM < 0.25 && ammoFrac(w, u) > 0.15 && w.time - u.retired > 240) { u.retired = 0; u.holdFire = false; } // steadied: back to the wing
      else { order(w, u, "move", c0.x + lx * side * hw - fx * CAI.reserveBack * 1.5, c0.y + ly * side * hw - fy * CAI.reserveBack * 1.5, "quick", B.face, "loose"); continue; }
    }
    // (within the reach of their own weapon: a crossbow's effective range is well short of a longbow's)
    const st = Math.min(CAI.bowStand, 0.85 * (MISSILES[ARMS[u.arm].missile]?.maxR || CAI.bowStand));
    if (B.phase === "advance" && (B.halted || hot)) {
      // the attacker's bows go forward of the foot to shooting range of the enemy body facing them
      const t = nearestTo(p.x + fx * 200, p.y + fy * 200, foeFoot.length ? foeFoot : foes), d = Math.hypot(t.ax - p.x, t.ay - p.y) || 1;
      order(w, u, "skirmish", t.ax - (t.ax - p.x) / d * st, t.ay - (t.ay - p.y) / d * st, hot ? "quick" : "march", B.face, "loose");
    } else if (B.phase === "engage") {
      // with the lines going in, the bows keep within their range of the nearest enemy body and shoot
      // (they stop where they stand once in range; the standing orders send them in when shot out)
      const t = nearestTo(u.ax, u.ay, foes), d = t ? Math.hypot(t.ax - u.ax, t.ay - u.ay) : Infinity;
      if (!t || d < st * 1.1) continue;
      order(w, u, "skirmish", t.ax - (t.ax - u.ax) / d * st, t.ay - (t.ay - u.ay) / d * st, "quick", B.face, "loose");
    }
    else order(w, u, B.phase === "hold" ? "hold" : "skirmish", p.x, p.y, "march", B.face, "loose");
  }
  // ---- horse: kept back behind the wings until the moment comes
  const engaged = inf.filter((u) => u.hold);
  if (engaged.length && B.lockedT === undefined) B.lockedT = w.time; else if (!engaged.length) B.lockedT = undefined;
  // (the horse is the reserve: it goes in on a body that is already wavering, or — after the lines have
  // been locked a good while and the enemy is tiring — on the flank of one fighting our foot; DESIGN)
  const lockedFor = B.lockedT === undefined ? 0 : w.time - B.lockedT, waitLocked = D.flank > 0.5 ? 180 : D.aggression > 0.8 ? 300 : 600;
  for (const u of cav) {
    if (routing.length) { const r = nearestTo(u.ax, u.ay, routing); order(w, u, "assault", r.ax, r.ay, "charge", undefined, undefined, r.id); continue; }
    // enemy horse coming at our wing: meet it
    const threat = foes.find((v) => ARMS[v.arm].mounted && v.c?.phase === "charge" && Math.hypot(v.ax - u.ax, v.ay - u.ay) < 250);
    // a wavering enemy body, or one locked with our foot (its flank is open), near our wing
    const prey = foes.filter((v) => !ARMS[v.arm].mounted && (v.state === "wavering" || v.state === "shaken" || (v.hold && lockedFor > waitLocked)) && Math.hypot(v.ax - u.ax, v.ay - u.ay) < 450);
    const bold = D.aggression > 0.8 || D.flank > 0.5;
    if (threat) order(w, u, "assault", threat.ax, threat.ay, "charge", undefined, undefined, threat.id);
    else if (prey.length && (engaged.length || bold && B.phase === "engage" && prey.some((v) => v.state !== "formed"))) {
      const v = nearestTo(u.ax, u.ay, prey);
      if (D.flank > 0.5 && !v.hold) {
        const side = layout.get(u.id).lat >= 0 ? 1 : -1;
        order(w, u, "move", v.ax + lx * side * 120 - fx * 30, v.ay + ly * side * 120 - fy * 30, "quick");
        if (Math.hypot(u.ax - v.ax, u.ay - v.ay) < 160) order(w, u, "assault", v.ax, v.ay, "charge", undefined, undefined, v.id);
      } else order(w, u, "assault", v.ax, v.ay, "charge", undefined, undefined, v.id);
    } else if (!u.hold) { const p = place(u); order(w, u, "hold", p.x, p.y, "march", B.face); }
  }
}

// Lateral/forward offsets of every company in the line: foot side by side in their present left-to-right
// order (so no company crosses another), bows split onto the wings a little forward, horse behind them.
function lineLayout(inf, missile, cav, B, lx, ly) {
  const key = [...inf, ...missile, ...cav].map((u) => u.id + ":" + u.members.length).join(",");
  if (B.layoutKey === key && B.layout) return B.layout;
  // (widths only change as men fall; a layout is kept while nobody's strength changes by a fifth)
  if (B.layout && [...inf, ...missile, ...cav].every((u) => B.layout.has(u.id) && Math.abs(B.layout.get(u.id).n - u.members.length) < 0.2 * B.layout.get(u.id).n)) return B.layout;
  const L = new Map();
  const width = (u) => { const A = ARMS[u.arm]; const n = u.members.length; if (u.formation === "schiltron") return Math.sqrt(n) * A.spacing * 1.2; return Math.min(n, u.files || formationFiles(u.formation, n, u.depth || 0)) * A.spacing; };
  const latOf = (u) => (u.ax - B.centre.x) * lx + (u.ay - B.centre.y) * ly;
  // small companies stand in a second line behind the centre (a reserve that plugs the gap when a company
  // of the first line breaks) — a line is as strong as its weakest company, and a small one crumbles first
  // (so do raw levies: set against trained men in the first line they break at the first shock — they stand
  // behind, to fill a gap against a tired enemy)
  const worth = (u) => u.members.length * (1 + ARMS[u.arm].armour * 0.3) * (ARMS[u.arm].drill < 0.4 ? 0.3 : 1);
  const bigW = Math.max(...inf.map(worth), 1);
  let reserve = inf.length >= 4 ? inf.filter((u) => worth(u) < CAI.reserveFrac * bigW && !B.committed?.has(u.id)) : [];
  if (reserve.length > inf.length / 2) reserve = reserve.sort((a, b) => worth(a) - worth(b)).slice(0, Math.floor(inf.length / 2));
  const foot = inf.filter((u) => !reserve.includes(u)).sort((a, b) => latOf(a) - latOf(b));
  const total = foot.reduce((s, u) => s + width(u), 0) + CAI.gap * Math.max(0, foot.length - 1);
  let x = -total / 2;
  for (const u of foot) { const wd = width(u); L.set(u.id, { lat: B.plug?.get(u.id) ?? x + wd / 2, fwd: 0, n: u.members.length }); x += wd + CAI.gap; }
  const rtot = reserve.reduce((s, u) => s + width(u), 0) + CAI.gap * 2 * Math.max(0, reserve.length - 1);
  let rx = -rtot / 2;
  for (const u of reserve.sort((a, b) => latOf(a) - latOf(b))) { const wd = width(u); L.set(u.id, { lat: rx + wd / 2, fwd: -CAI.reserveBack, n: u.members.length, reserve: true }); rx += wd + CAI.gap * 2; }
  const bows = missile.slice().sort((a, b) => latOf(a) - latOf(b));
  const half = Math.ceil(bows.length / 2);
  let left = -total / 2 - CAI.gap, right = total / 2 + CAI.gap;
  bows.forEach((u, k) => {
    const wd = width(u);
    if (k < half) { L.set(u.id, { lat: left - wd / 2, fwd: CAI.wingFwd, n: u.members.length }); left -= wd + CAI.gap; }
    else { L.set(u.id, { lat: right + wd / 2, fwd: CAI.wingFwd, n: u.members.length }); right += wd + CAI.gap; }
  });
  const horse = cav.slice().sort((a, b) => latOf(a) - latOf(b));
  // (several companies of horse on one wing stand side by side outward, not all on the one spot — stacked, their
  // riders jammed each other solid and the whole wing could not move off)
  const hOut = { [-1]: 0, [1]: 0 };
  horse.forEach((u, k) => {
    const side = horse.length === 1 ? (latOf(u) >= 0 ? 1 : -1) : k < horse.length / 2 ? -1 : 1;
    const wd = width(u);
    L.set(u.id, { lat: side * (total / 2 + 30 + hOut[side] + wd / 2), fwd: -CAI.cavBack, n: u.members.length }); hOut[side] += wd + CAI.gap * 2;
  });
  B.layout = L; B.layoutKey = key;
  return L;
}

function ammoFrac(w, u) {
  const S = w.S, A = ARMS[u.arm]; let a = 0, n = 0;
  for (const i of u.members) if (S.alive[i]) { a += S.ammo[i]; n++; }
  return n ? a / n / (A.ammo || 30) : 0;
}

function bestGround(w, c, toFoe, D) {
  let best = null, bs = -Infinity;
  for (let r = 0; r <= 500; r += 100) for (let a = -2; a <= 2; a++) {
    const ang = toFoe + a * 0.45;
    for (const sgn of [1, -0.6]) {
      const x = c.x + Math.cos(ang) * r * sgn, y = c.y + Math.sin(ang) * r * sgn;
      if (!w.map.inBounds(x, y) || w.map.water(x, y) > 0.3) continue;
      const A = analysePoint(w, x, y);
      const s = A.defensible * (0.6 + D.seeksHighGround) + (D.usesCover ? A.conceal * 0.5 : 0) - r / 3000;
      if (s > bs) { bs = s; best = { x, y }; }
    }
  }
  return best || c;
}

function order(w, u, kind, x, y, pace, facing, formation, target) {
  // a captain does not pull a body out of a fight it is locked in (that is how armies are lost, §13);
  // nor re-order a broken one — it has to rally first
  if ((u.hold && kind !== "assault") || u.state === "routing") return;
  if (u.capAct && w.time < u.capAct.until) return; // his own captain is seizing a moment (js/sim/captains.js): leave him to it
  // don't spam re-orders that would reset the path every think
  const o = u.pendingOrder || u.order;
  if (o && o.kind === kind && Math.hypot(o.x - x, o.y - y) < 25 && (o.pace || u.pace) === pace && (target === undefined || o.target === target)) return;
  if (kind === "assault" && o && o.kind === "assault" && o.target === target && target !== undefined) return; // already going in at it
  issueOrder(w, [u.id], { kind, x, y, pace, facing, formation, target });
}

const turn = (a, b, r) => { const d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a + Math.max(-r, Math.min(r, d)); };
const centroid = (us) => { let x = 0, y = 0, n = 0; for (const u of us) { x += u.ax * u.members.length; y += u.ay * u.members.length; n += u.members.length; } return n ? { x: x / n, y: y / n } : { x: 0, y: 0 }; };
const nearestTo = (x, y, list) => { let b = null, bd = Infinity; for (const v of list) { const d = Math.hypot(v.ax - x, v.ay - y); if (d < bd) { bd = d; b = v; } } return b; };
