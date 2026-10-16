// After the battle: why it was won (the decisive factor, in plain words), who distinguished themselves, and the
// chronicle — a period-style paragraph written from what the recorder saw (js/sim/battle-record.js). No DOM.
//
//   tellBattle(w, rec, ctx) → { factor: { key, text }, chronicle, honours: [{ title, text }], legends: [{ name, what, team }], placeName }
//   ctx = { names, weather, tod, windFrom, survey (describeField lines of the winner), battleName, sideOf(team) }
import { ARMS, ARM_BY_ID } from "./arms.js";
import { nameOf } from "./legend.js";

export const singular = (arm) => ({ "Men-at-Arms": "a man-at-arms", "Communal Militia": "a militiaman" }[arm] || "a " + arm.toLowerCase().replace(/men$/, "man").replace(/s$/, ""));
const poss = (s) => (s.endsWith("s") ? s + "'" : s + "'s");
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

// present tense of the live moments → the chronicle's past tense
const PAST = [
  [/\bcrash into\b/g, "crashed into"], [/\bfall on\b/g, "fell on"], [/\bbreak and run\b/g, "broke and ran"], [/\bbreak under\b/g, "broke under"],
  [/\bcan close\b/g, "could close"], [/\bcome to hand-strokes\b/g, "came to hand-strokes"], [/\brally to\b/g, "rallied to"], [/\bfalls\b/g, "fell"],
  [/\bis slain\b/g, "was slain"], [/\brides out\b/g, "rode out"], [/\blifts\b/g, "lifted"], [/\bcries\b/g, "cried"], [/\bwill not face\b/g, "would not face"],
  [/\bhave (\d+) men\b/g, "had $1 men"], [/\bare cut off\b/g, "were cut off"], [/\bthrow themselves\b/g, "threw themselves"], [/\band drown\b/g, "and drowned"],
  [/\bare crushed\b/g, "were crushed"], [/\bcome over\b/g, "came over"], [/\btakes them\b/g, "took them"], [/\bruns through\b/g, "ran through"],
  [/\bturns to flee\b/g, "turned to flee"], [/\bhold the field\b/g, "held the field"], [/\bis taken prisoner\b/g, "was taken prisoner"], [/\bis led\b/g, "was led"],
  [/\bNobody lifts\b/g, "Nobody lifted"], [/\bit is trampled\b/g, "it was trampled"], [/\bfall among\b/g, "fell among"], [/\bburst from\b/g, "burst from"],
  [/\bare beaten\b/g, "were beaten"], [/\bcome down\b/g, "came down"], [/\bspur forward\b/g, "spurred forward"], [/\bhave crossed\b/g, "had crossed"], [/\bappear\b/g, "appeared"], [/\bNight falls\b/g, "Night fell"], [/\bwill give\b/g, "would give"], [/\bdraw off\b/g, "drew off"], [/\bstand to\b/g, "stood to"],
];
export const toPast = (s) => PAST.reduce((a, [re, r]) => a.replace(re, r), s);

// ---------------------------------------------------------------- the decisive factor
export function decisiveFactor(w, rec, ctx) {
  const N = ctx.names, O = rec.outcome;
  if (!O || O.winner < 0) return { key: "draw", text: "Neither host would give ground. Night fell on a field that belonged to nobody, and both sides drew off to count their dead." };
  const win = O.winner, lose = O.loser, L = rec.cas[lose], Wn = rec.cas[win], dead = Math.max(1, L.dead);
  const firstBreak = rec.moments.find((m) => (m.kind === "break" || m.kind === "arrow-break") && m.team === lose);
  const cand = [];
  const arrows = (L.byCause.arrows || 0) / dead;
  if (arrows > 0.35 && L.byCause.arrows >= 8) cand.push({ key: "arrows", v: arrows * 2 + (firstBreak?.kind === "arrow-break" ? 0.6 : 0), text: `The bows of ${N.side(win)} won the day: ${L.byCause.arrows} of ${N.side(lose)} fell to arrows${firstBreak?.kind === "arrow-break" ? ", and their first companies broke under the shafts before they ever reached the line" : " while they were still coming on"}.` });
  const flank = rec.moments.filter((m) => m.kind === "flank-charge" && m.good === win && (!firstBreak || m.t <= firstBreak.t + 20) && (!firstBreak || firstBreak.t - m.t < 180));
  if (flank.length) { const m = flank[0], u = rec.units.get(m.unit); cand.push({ key: "flank", v: 1.4, text: `The charge of ${u ? N.arm(win, u.arm) : N.side(win)} into the ${/rear/.test(m.text) ? "rear" : "flank"} of ${N.side(lose)} ${m.x !== undefined ? N.place(m.x, m.y) : ""} decided it: the line gave way ${firstBreak ? (firstBreak.t - m.t < 90 ? "within the minute" : "within " + Math.round((firstBreak.t - m.t) / 60) + " minutes") : "soon after"}.` }); }
  if (rec.stats.lordLost[lose]) cand.push({ key: "lord", v: 1.6, text: `When ${N.lord(lose)} ${rec.stats.lordLost[lose].how === "captured" ? "was taken" : "fell"}, the heart went out of ${N.side(lose)}: the word ran down the line faster than any horn.` });
  const drown = (L.byCause.drown || 0) / dead;
  if (drown > 0.12 && L.byCause.drown >= 5) cand.push({ key: "water", v: drown * 4, text: `The water finished what the fighting began: ${L.byCause.drown} of ${N.side(lose)} drowned trying to get away across it.` });
  const press = (L.byCause.press || 0) / dead;
  if (press > 0.1 && L.byCause.press >= 5) cand.push({ key: "press", v: press * 4, text: `The press killed more than the sword: ${N.side(lose)} were crowded so tight that ${L.byCause.press} men died without a wound.` });
  const loseKn = L.byArm.knights?.dead || 0, knStart = [...rec.units.values()].filter((u) => u.team === lose && ARMS[u.arm].mounted).reduce((s, u) => s + u.n0, 0);
  const winPike = [...rec.units.values()].filter((u) => u.team === win && (u.arm === "pikemen" || u.arm === "spearmen" || u.arm === "militia")).reduce((s, u) => s + u.n0, 0);
  if (knStart > 20 && winPike > 60 && loseKn / knStart > 0.35) cand.push({ key: "hedge", v: 1.3 + loseKn / knStart, text: `The spears of ${N.side(win)} broke ${poss(N.side(lose))} horse: ${loseKn} of ${knStart} riders came down against a hedge of points that no horse would face.` });
  if (rec.stats.refuseObstacle[lose] > 10) cand.push({ key: "stakes", v: 1.1, text: `The stakes and ditches turned ${poss(N.side(lose))} horse: their charges broke up on the works before they touched the line.` });
  const rout = (L.byCause.rout || 0) / dead;
  if (rout > 0.35 && L.byCause.rout >= 10) cand.push({ key: "rout", v: rout * 1.8, text: `Most of ${poss(N.side(lose))} dead fell in the rout, cut down from behind as they ran — the fighting itself had been closer than the count suggests.` });
  const rise = ctx.rise ? ctx.rise[win] - ctx.rise[lose] : 0;
  if (rise > 6) cand.push({ key: "height", v: 0.9 + rise / 30, text: `The ground chose the winner: ${N.side(lose)} came up a ${Math.round(rise)} m slope, blown and ragged, against a line that had only to stand.` });
  if (ctx.objective && O.why && /bridgehead|night/.test(O.why)) cand.push({ key: "objective", v: 1.5, text: `${cap(N.side(win))} did what the day required of them: ${O.why}.` });
  const ratio = (rec.start[win] || 1) / (rec.start[lose] || 1);
  if (ratio > 1.35) cand.push({ key: "numbers", v: 0.7 + (ratio - 1), text: `Weight of numbers told: ${N.side(win)} brought ${rec.start[win]} men to the field against ${rec.start[lose]}, and could feed fresh companies into the line when the others tired.` });
  const firstUnit = firstBreak ? rec.units.get(firstBreak.unit) : null;
  cand.push({ key: "line", v: 0.5, text: `It was decided in the line: ${firstUnit ? N.arm(lose, firstUnit.arm) + " were the first to give way" + (firstBreak.x !== undefined ? " " + N.place(firstBreak.x, firstBreak.y) : "") : N.side(lose) + " gave way first"}, and the rest would not stand once the gap opened.` });
  cand.sort((a, b) => b.v - a.v);
  return { key: cand[0].key, text: cand[0].text, also: cand[1]?.v > 0.9 ? cand[1] : null };
}

// ---------------------------------------------------------------- honours: men and companies
export function honours(w, rec, ctx) {
  const S = w.S, N = ctx.names, out = [], legends = [];
  const ids = [];
  for (let i = 0; i < S.n; i++) if (rec.hostOf[i] >= 0 && (S.kills[i] > 0 || w.sagas?.get(i))) ids.push(i);
  const featsOf = new Map(); for (const f of rec.feats) { if (!featsOf.has(f.who)) featsOf.set(f.who, []); featsOf.get(f.who).push(f); }
  const score = (i) => S.kills[i] * 1 + (w.sagas?.get(i)?.score || 0) * 0.4 + (featsOf.get(i)?.length || 0) * 2;
  ids.sort((a, b) => score(b) - score(a));
  for (const i of ids.slice(0, 6)) {
    const sg = w.sagas?.get(i), f = featsOf.get(i)?.at(-1) || null, arm = ARM_BY_ID[S.arm[i]];
    if (score(i) < 2) break;
    legends.push({ id: i, team: rec.hostOf[i], name: nameOf(S.name[i]), arm: arm.name, kills: S.kills[i], alive: !!S.alive[i],
      rank: sg?.rank || 0, deed: f ? f.text.replace(/\s*\(.*\)$/, "") : sg?.feats?.at(-1)?.text?.replace(/\s*\(.*\)$/, "") || null });
  }
  const us = [...rec.units.values()];
  const firstBroke = us.filter((u) => u.broke >= 0).sort((a, b) => a.broke - b.broke)[0];
  if (firstBroke) out.push({ title: "First to break", team: firstBroke.team, text: `${cap(N.arm(firstBroke.team, firstBroke.arm))} (${firstBroke.n0} men) broke at ${mmss(firstBroke.broke)}${firstBroke.contact >= 0 ? `, ${Math.max(0, Math.round((firstBroke.broke - firstBroke.contact) / 60))} min after they closed` : " without ever closing"}.` });
  const steady = us.filter((u) => u.broke < 0 && u.contact >= 0).sort((a, b) => b.kills - a.kills)[0];
  if (steady) out.push({ title: "Stood firm", team: steady.team, text: `${cap(N.arm(steady.team, steady.arm))} were in the fight from ${mmss(steady.contact)} to the end and never broke; they felled ${Math.round(steady.kills)}.` });
  const killers = us.slice().sort((a, b) => b.kills - a.kills)[0];
  if (killers && killers !== steady && killers.kills >= 5) out.push({ title: "Most slain", team: killers.team, text: `${cap(N.arm(killers.team, killers.arm))} felled ${Math.round(killers.kills)} of the enemy${killers.broke >= 0 ? ", though they broke in the end" : ""}.` });
  const bled = us.filter((u) => u.n0 >= 20).sort((a, b) => b.lost / b.n0 - a.lost / a.n0)[0];
  if (bled && bled.lost / bled.n0 > 0.3) out.push({ title: "Bled white", team: bled.team, text: `${cap(N.arm(bled.team, bled.arm))} lost ${bled.lost} of ${bled.n0} men.` });
  return { honours: out, legends };
}

// ---------------------------------------------------------------- the chronicle
export function writeChronicle(w, rec, ctx, factor, hon) {
  const N = ctx.names, O = rec.outcome || { winner: -1, loser: -1 };
  let seed = (rec.start[0] * 31 + rec.start[1] * 17 + rec.cas[0].dead * 7 + rec.cas[1].dead) >>> 0;
  const pick = (a) => { seed = (seed * 1103515245 + 12345) >>> 0; return a[seed % a.length]; };
  const when = { dawn: pick(["At first light", "In the grey of the morning", "Soon after sunrise"]), noon: pick(["About the hour of noon", "When the sun stood high", "At midday"]), dusk: pick(["With the sun already low", "Toward evening", "In the last hours of the day"]) }[ctx.tod] || "That day";
  const sky = { clear: pick(["under a clear sky", "in fair weather"]), overcast: "under a sky of low cloud", rain: pick(["in a driving rain that soaked the bowstrings and turned the field to mire", "in a cold, steady rain"]), fog: "in a mist so thick a man could not see his own banner at a bowshot", wind: `with a hard wind blowing out of the ${ctx.windFrom || "west"}`, storm: `in a breaking storm, thunder over the field and the rain driving out of the ${ctx.windFrom || "west"}`, snow: "in falling snow that whitened the dead where they lay" }[ctx.weather] || "";
  const P = [];
  P.push(`${when}${sky ? ", " + sky : ""}, ${N.side(0)} and ${N.side(1)} met ${ctx.where}.`);
  if (ctx.ground) P.push(ctx.ground);
  // the four biggest moments, no two of a kind unless nothing else happened
  const cands = rec.moments.filter((m) => m.kind !== "end" && m.kind !== "first-shafts" && m.kind !== "advance" && m.sal >= 0.5).sort((a, b) => b.sal - a.sal), key = [], kinds = new Set();
  for (const m of cands) { if (key.length >= 4) break; if (!kinds.has(m.kind)) { key.push(m); kinds.add(m.kind); } }
  for (const m of cands) { if (key.length >= 3) break; if (!key.includes(m)) key.push(m); }
  key.sort((a, b) => a.t - b.t);
  const joins = ["First", "Then", "After that", "And at the last"];
  key.forEach((m, i) => { const s = toPast(m.n > 1 ? m.text.replace(/^The /, `${m.n > 2 ? "Company after company of the" : "Two companies of the"} `) : m.text); P.push(`${i === 0 ? joins[0] : i === key.length - 1 && key.length > 2 ? joins[3] : joins[Math.min(i, 2)]} ${s[0].toLowerCase() + s.slice(1)}.`); });
  if (O.winner >= 0) {
    const C = rec.cas;
    const few = (n) => (n === 0 ? "not a man" : n === 1 ? "but one man" : n < C[O.loser].dead / 3 ? `but ${n}` : String(n));
    P.push(`So ${N.side(O.loser)} were beaten, and ${N.side(O.winner)} kept the field. Of ${N.side(O.winner)} there fell ${few(C[O.winner].dead)}; of ${N.side(O.loser)}, ${C[O.loser].dead}${C[O.loser].captured ? `, and ${C[O.loser].captured} were taken for ransom` : ""}${C[O.loser].fled ? `; ${C[O.loser].fled} got away by running` : ""}.`);
  } else P.push(`Night fell with nothing decided. ${cap(N.side(0))} lost ${rec.cas[0].dead + rec.cas[0].wounded} men and ${N.side(1)} ${rec.cas[1].dead + rec.cas[1].wounded}, killed or wounded, and both claimed the day.`);
  const hero = hon.legends.find((l) => l.team === O.winner) || hon.legends[0];
  if (hero) P.push(`Men spoke afterward of ${hero.name}, ${singular(hero.arm)} of ${N.side(hero.team)}, ${hero.deed ? "who " + hero.deed.replace(/^[A-Z]/, (c) => c.toLowerCase()) : `who felled ${hero.kills} with his own hand`}${hero.alive ? "" : ", and did not live to hear it told"}.`);
  const placeName = nameThePlace(rec, ctx);
  if (placeName) P.push(`${placeName.where} has been called ${placeName.name} ever since.`);
  return { text: P.join(" "), placeName };
}
function nameThePlace(rec, ctx) {
  const lose = rec.outcome?.loser ?? 0, L = rec.cas[lose] || rec.cas[0];
  const m = (k) => rec.moments.find((x) => x.kind === k);
  if ((L.byCause.drown || 0) >= 8 && m("drown")) return { name: "Dead Men's Water", where: `The water ${ctx.names.place(m("drown").x, m("drown").y)}` };
  if ((L.byCause.press || 0) >= 8) return { name: "the Mound", where: "The place where the dead lay heaped" };
  if (m("stakes")) return { name: "the Stakes", where: "The ground before the archers' stakes" };
  if (m("bridgehead-lost")) return { name: "the Bloody Bridge-end", where: "The bridge's end" };
  if (m("flank-charge")) { const f = m("flank-charge"); return { name: "the Riding", where: `The slope the horse came down ${ctx.names.place(f.x, f.y)}` }; }
  if (sum(L.byCause) > 120) return { name: "the Red Field", where: "The field" };
  return null;
}

// the lie of the land, in the chronicle's voice: what the winner had (and the loser had to face)
export function groundSentence(R, winSide, win, lose, N) {
  if (!R || winSide < 0) return "";
  const ls = 1 - winSide, bits = [], up = R.rise[winSide] - R.rise[ls];
  if (up > 4) bits.push(`${N.side(win)} stood ${Math.round(up)} m above the ground ${N.side(lose)} had to cross`);
  const wz = winSide === 0 ? R.woods.z0 : R.woods.z1;
  if (wz[0] > 0.3 && wz[1] > 0.3) bits.push("woods covered both their flanks"); else if (wz[0] > 0.3 || wz[1] > 0.3) bits.push("a wood covered one flank");
  if ((ls === 0 ? R.marsh.z0 : R.marsh.z1) > 0.1) bits.push(`${N.side(lose)} had soft, wet ground under their feet`);
  else if (R.marsh.mid > 0.1) bits.push("the ground between the hosts was soft and wet");
  if ((ls === 0 ? R.rear[0] : R.rear[1]) > 0.12) bits.push(`${N.side(lose)} had deep water at their backs`);
  if (!bits.length) return "";
  const s = bits.length === 1 ? bits[0] : bits.slice(0, -1).join(", ") + " and " + bits.at(-1);
  return s[0].toUpperCase() + s.slice(1) + ".";
}

export function tellBattle(w, rec, ctx) {
  const factor = decisiveFactor(w, rec, ctx), hon = honours(w, rec, ctx);
  const chron = writeChronicle(w, rec, ctx, factor, hon);
  return { factor, chronicle: chron.text, placeName: chron.placeName, honours: hon.honours, legends: hon.legends };
}
