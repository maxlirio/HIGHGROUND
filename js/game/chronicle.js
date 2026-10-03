// The chronicle and the toasts, as one team sees the sim's notable events (w.log): the wording main.js's drainLog uses
// for the player, written for any team so the realm server can keep one chronicle per family. DOM-free.
//   const ch = makeChronicle({ w, team, seen: (x, y) => bool, townName: (team) => name, at: (x, y) => phrase })
//   ch.lines(e) → [{ text, tone, x, y, toast }]  for one w.log event (empty: this team is not told of it)
//   ch.watchHome() → a line when enemy troops are first sighted near the team's town (call every ~0.5 s)
import * as EC from "../sim/economy.js";
import { ARMS } from "../sim/arms.js";
import { isFoe } from "../sim/sides.js";
import { nameOf } from "../sim/legend.js";
import { SPELL_INFO } from "../ui/spells.js";
import { TECHS } from "../sim/tech.js"; // research (docs/tech.md)
import { TASK_WORD } from "../sim/broad.js";
import { VEIN } from "../sim/veins.js"; // (veins held and taken)

export function makeChronicle({ w, team, seen, townName, at }) {
  const bldName = (b) => EC.BUILDINGS[b?.kind]?.name || b?.kind || "building";
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  const st = { sightT: -1e9, sightWas: false };
  function lines(e) {
    const out = [], L = (text, o = {}, toast = false) => out.push({ text, tone: o.tone, x: o.x, y: o.y, toast }), T = (text) => out.push({ text, toast: true, only: true });
    const mine = e.team === team, b = e.building !== undefined ? w.buildings.find((x) => x.id === e.building) : null;
    const pos = b ? { x: b.x, y: b.y } : {};
    const k = e.kind;
    if (k === "legend") {
      const who = nameOf(w.S.name[e.who]), p = { x: w.S.x[e.who], y: w.S.y[e.who] };
      if (mine) L(`${who} is spoken of: ${e.feats?.at(-1)?.text?.replace(/\s*\(.*\)$/, "") || "a deed men will remember"}`, { ...p, tone: "legend" }, true);
      else if (seen(p.x, p.y)) L(`A man of ${townName(e.team)} is making a name for himself ${at(p.x, p.y)}`, { ...p, tone: "legend" });
    }
    else if (k === "unit-routing") {
      const u = w.units.get(e.unit);
      if (u && (mine || seen(u.ax, u.ay))) L(`${mine ? "Our" : "The enemy's"} ${ARMS[u.arm].name.toLowerCase()} break and run ${at(u.ax, u.ay)}`, { x: u.ax, y: u.ay, tone: mine ? "bad" : "good" }, true);
    }
    else if (k === "captain-say" && mine) L(e.text, { x: e.x, y: e.y, tone: e.tone }, true); // a captain's report (js/sim/captains.js)
    else if (k === "reeve-say" && mine) L(e.text, { x: e.x, y: e.y, tone: e.tone }, true); // the reeve's food watch (js/sim/ai-general.js: famine, new fields, the slaughter)
    else if (k === "unit-rallied" && mine) { const u = w.units.get(e.unit); if (u) L(`Our ${ARMS[u.arm].name.toLowerCase()} rally to the colours`, { x: u.ax, y: u.ay }); }
    else if (k === "recruited" && mine) L(`${e.count} ${ARMS[e.arm]?.name || e.arm} mustered${b ? " at the " + bldName(b) : ""}`, pos, true);
    else if (k === "built" && mine) L(`${bldName(b || { kind: e.what })} completed`, { ...pos, tone: "good" }, true);
    else if (k === "demolished" && mine) L(e.ruin ? `The ruin of the ${bldName({ kind: e.what })} is cleared` : `The ${bldName({ kind: e.what })} is pulled down`, { x: e.x, y: e.y }, true); // (js/sim/demolish.js)
    else if (k === "rebuilt-stone" && mine) L(`The ${bldName({ kind: e.what })} stands where the timber stood`, { x: e.x, y: e.y, tone: "good" }, true);
    else if (k === "building-lost") {
      if (mine) L(`Our ${bldName(b)} is destroyed${b ? " " + at(b.x, b.y) : ""}`, { ...pos, tone: "bad" }, true);
      else if (b && seen(b.x, b.y)) L(`${townName(e.team)}'s ${bldName(b)} is destroyed`, { ...pos, tone: "good" });
    }
    else if (k === "weather") { // the sky turning (js/sim/weather.js); every house sees the same sky
      const msg = { rain: "Rain sets in over the vale", storm: "A storm breaks over the vale", snow: "Snow falls on the vale", fog: "A mist lies on the vale", fair: e.was === "snow" ? "The snow passes; the sky clears" : e.was === "rain" || e.was === "storm" ? "The rain passes; the sky clears" : "The mist burns off",
        mud: "Days of rain: the roads are mud", dried: "The ground has dried; the roads are firm again" }[e.wx];
      if (msg) L(msg, { tone: e.wx === "mud" || e.wx === "storm" ? "bad" : undefined });
    }
    else if (k === "fire" && mine && b) L(e.dragon !== undefined ? `Dragon-fire takes our ${bldName(b)}` : `Raiders set our ${bldName(b)} alight`, { ...pos, tone: "bad" }, true);
    else if (k === "field-fired" && mine && b && e.dragon === undefined) L(`Raiders fire our fields ${at(b.x, b.y)}`, { ...pos, tone: "bad" }, true); // (a dragon's fires: the dragon-field line below)
    // the dragons (js/sim/dragons.js): their tales are the realm's news — every house hears them
    else if (k === "dragon-field") L(mine ? `A dragon burns our fields ${at(e.x, e.y)}` : `A dragon burned ${townName(e.team)}'s fields`, { x: e.x, y: e.y, tone: mine ? "bad" : undefined }, mine);
    else if (k === "dragon-flock" && mine) L("A dragon stoops on our flocks and carries off sheep", { x: e.x, y: e.y, tone: "bad" }, true);
    else if (k === "dragon-wakes") L(`${cap(e.name || "a dragon")} is on the wing over the vale`, { x: e.x, y: e.y });
    else if (k === "dragon-fight") L(mine ? "We have woken the dragon: it fights" : e.team >= 0 ? `${townName(e.team)}'s men go against a dragon` : "Men go against a dragon", { x: e.x, y: e.y, tone: mine ? "bad" : undefined }, mine);
    else if (k === "dragon-yielded") L(e.by === team ? "The dragon YIELDS, cowed, to our men — stand over it and claim it, or finish it" : `The dragon has yielded${e.by >= 0 ? ` to ${townName(e.by)}` : ""}`, { x: e.x, y: e.y, tone: e.by === team ? "good" : undefined }, e.by === team);
    else if (k === "dragon-slain") L(`${cap(e.name || "the dragon")} is slain${e.by >= 0 ? ` by ${e.by === team ? "our men" : townName(e.by)}` : ""} — for good`, { x: e.x, y: e.y, tone: "legend" }, e.by === team || e.team === team);
    else if (k === "dragon-claimed") L(mine ? `${cap(e.name || "the dragon")} is bound to our house: feed it meat and its trust will grow` : `The dragon has yielded to ${townName(e.team)} and is theirs`, { x: e.x, y: e.y, tone: mine ? "legend" : "bad" }, true);
    else if (k === "dragon-stage") { if (e.stage === 3) L(mine ? `${cap(e.name || "the dragon")} is BONDED: your word can call it to war` : `${townName(e.team)} has bonded its dragon`, { tone: mine ? "legend" : "bad" }, true); else if (mine) L("The dragon is broken-in: it suffers its keeper", { tone: "good" }); }
    else if (k === "dragon-wild") { if (e.team >= 0) L(mine ? `${cap(e.name || "the dragon")} ${e.why === "it went unfed" ? "went unfed too long and" : e.why === "its house fell" ? "has no house left and" : ""} is wild again` : `${townName(e.team)}'s dragon has gone wild again`, { tone: mine ? "bad" : undefined }, mine); }
    else if (k === "dragon-summoned" && mine) L("The dragon answers your call", { x: e.x, y: e.y, tone: "good" }, true);
    else if (k === "dragon-tired" && mine) T("The dragon is spent: it turns for its lair");
    // the wild (js/sim/wild.js, js/sim/jobs/hunting.js): small news, never a threat to a house at peace
    else if (k === "hart-seen") L(`A white hart is seen ${at(e.x, e.y)} — few hunters ever take one`, { x: e.x, y: e.y, tone: "legend" }, true);
    else if (k === "white-hart-taken") L(mine ? "Our hunters have taken the white hart — the hall will tell it for years, and the companies stand a little prouder" : `${townName(e.team)}'s hunters have taken the white hart`, { x: e.x, y: e.y, tone: "legend" }, mine);
    else if (k === "serpent-sighted") L(`Something vast breaks the water ${at(e.x, e.y)} — the fishermen say the serpent`, { x: e.x, y: e.y, tone: "magic" });
    else if (k === "wolves-took-sheep" && mine) L(`Wolves take a sheep from our flocks ${at(e.x, e.y)}`, { x: e.x, y: e.y, tone: "bad" });
    else if (k === "taken-by-wolves" && mine) L(`Wolves take a villager working alone ${at(e.x, e.y)}`, { x: e.x, y: e.y, tone: "bad" }, true);
    else if (k === "mauled" && mine) L(`A ${e.sp === "drake" ? "drake" : "bear"} mauls one of our men in its den ${at(e.x, e.y)}`, { x: e.x, y: e.y, tone: "bad" }, true);
    else if (k === "animal-captured" && mine) T(`A young ${e.sp} is netted alive — they lead it home to the stables`);
    else if (k === "mount-penned" && mine) L(`A young ${e.mount} is penned at the stables`, { tone: "good" });
    else if (k === "young-escaped" && mine) L(`A netted young ${e.sp} slips its halter and is gone back to its kind`, { x: e.x, y: e.y });
    else if (k === "capture-failed" && mine) T("No young left in that herd to take");
    // silver and gold veins (js/sim/veins.js): a flag hoisted, a vein taken — the taker and the holder are both told
    else if (k === "vein-hoist" || k === "vein-hoist-broken" || k === "vein-taken" || k === "vein-guarded" || k === "vein-claimed") {
      const vw = e.vk === "gold_vein" ? "gold vein" : "silver vein", p = { x: e.x, y: e.y }, theirs = e.from === team, foe = (t) => (t === null || t === undefined || t < 0 ? "no house" : townName(t));
      if (k === "vein-hoist") { if (mine) L(`Our men stand at the ${vw}${e.from !== null && e.from !== undefined ? ` ${foe(e.from)} held` : ""}: the flag goes up — ${VEIN.hoistS} s, if none of theirs comes back`, { ...p, tone: "good" }, true); else if (theirs) L(`${foe(e.team)}'s men are hoisting their flag over our ${vw} ${at(e.x, e.y)}! Men of ours at it (${VEIN.r} m) stop them`, { ...p, tone: "bad" }, true); }
      else if (k === "vein-hoist-broken" && mine) L(`Our flag at the ${vw} does not go up: ${e.why}`, p, true);
      else if (k === "vein-taken") { if (mine) L(`Our flag flies over the ${vw} ${at(e.x, e.y)}${e.from !== null && e.from !== undefined ? `, taken from ${foe(e.from)}` : ""}${e.camps ? ": their mining camp is ours, with what was stored in it" : ""}`, { ...p, tone: "good" }, true); else if (theirs) L(`${foe(e.team)} has taken our ${vw} ${at(e.x, e.y)}: their flag flies over it${e.camps ? " and our mining camp there is theirs" : ""}. Kill their men there and hoist ours to win it back`, { ...p, tone: "bad" }, true); else if (seen(e.x, e.y)) L(`${foe(e.team)}'s flag now flies over the ${vw} ${at(e.x, e.y)}`, p); }
      else if (k === "vein-guarded" && mine) T(`${foe(e.from)}'s ${vw} cannot be taken now: ${e.why === "protected" ? "the house is under the realm's protection" : "the Keep's Peace holds while its lord is away"}`);
      else if (k === "vein-claimed" && mine) L(`The ${vw} is ours: the mining camp staked there claims it`, { ...p, tone: "good" });
    }
    else if (k === "villagers-return" && mine) T("Villagers finished your order — back to their usual work.");
    else if (k === "task-ended" && mine) { const word = (TASK_WORD[e.task] || "their task").toLowerCase(); L(e.crew ? `The villagers stop ${word} — ${e.why}; back to the reeve's work` : `Our men stop ${word} — ${e.why}; they wait for orders`, { x: e.x, y: e.y }, true); } // (broad tasks: js/sim/broad.js)
    else if (k === "convoy-out" && mine) T(`A supply cart sets out for the army (${e.kg} kg of bread and grain).`);
    else if (k === "convoy-lost" && mine) { const u = w.units.get(e.unit); L(`A supply convoy is lost${u ? " on the road to the army " + at(u.ax, u.ay) : ""}`, u ? { x: u.ax, y: u.ay, tone: "bad" } : { tone: "bad" }, true); }
    else if (k === "siege-begins" || k === "siege-lifted") {
      const Tm = w.teams[e.team], name = townName(e.team), hp = { x: Tm.town.x, y: Tm.town.y };
      if (!mine && !seen(hp.x, hp.y)) return out;
      if (k === "siege-begins") L(mine ? `${name} is besieged — no gathering outside the walls, no trade` : `${name} is invested`, { ...hp, tone: mine ? "bad" : "good" }, true);
      else L(mine ? `The siege of ${name} is lifted` : `The siege of ${name} is broken`, { ...hp, tone: mine ? "good" : "bad" });
    }
    else if (k === "town-fell") { const Tm = w.teams[e.team]; L(`${townName(e.team)} has fallen${e.by >= 0 && w.teams.length > 2 ? ` to ${townName(e.by)}` : ""} — ${e.why}`, { x: Tm.town.x, y: Tm.town.y, tone: "fall" }, true); }
    // the realm's houses (server/houses.mjs)
    else if (k === "house-founded") L(mine ? `House ${e.name} is founded at ${e.hold}${e.protectH ? `: ${Math.round(e.protectH / 24)} days of protection — nobody can attack you, and you cannot attack anyone, unless you choose to` : ""}` : `A new house, ${e.name}, is founded at ${e.hold}`, { x: e.x, y: e.y, tone: mine ? "good" : undefined }, mine);
    else if (k === "protection-ended" && mine) L("Your protection has ended: your lands can be attacked now — and you may make war", { tone: "bad" }, true);
    else if (k === "house-attacked" && mine) L(`Your house is under attack: ${e.what}`, { x: e.x, y: e.y, tone: "bad" }, true); // (fired while the lord is away: server/houses.mjs attackWatch — it also rings their devices, server/push.mjs)
    else if (k === "warden-command" && mine) L("Your warden takes command: the house will be defended while you are away", {});
    else if (k === "warden-standdown" && mine) L("Your warden stands down: the house is yours to command", { tone: "good" }, true);
    else if (k === "protection-broken" && mine) L(`You drew the sword (${e.why}): your protection has ended`, { tone: "bad" }, true);
    else if (k === "spell") {
      const I = SPELL_INFO[e.spell] || { name: e.spell, word: "An adept works" };
      if (mine || e.spell === "mist" || seen(e.x, e.y)) L(mine ? `${I.word} ${at(e.x, e.y)}` : `${townName(e.team)}'s adepts work ${I.name.toLowerCase()} ${at(e.x, e.y)}`, { x: e.x, y: e.y, tone: "magic" }, mine);
    }
    else if (k === "wall-breached" || k === "gate-broken" || k === "gate-opened") {
      const wh = k === "wall-breached" ? `a breach is made in ${mine ? "our" : townName(e.team) + "'s"} ${bldName(b)}` : k === "gate-broken" ? `${mine ? "our" : townName(e.team) + "'s"} gate is broken in` : `the enemy inside have unbarred ${mine ? "our" : "the"} gate`;
      if (mine || (b && seen(b.x, b.y))) L(cap(wh), { ...(e.x !== undefined ? { x: e.x, y: e.y } : pos), tone: mine ? "bad" : "good" }, true);
    }
    else if (k === "engine-destroyed" || k === "engine-captured" || k === "engine-ready" || k === "engine-abandoned") {
      const en = w.siege?.engines.find((q) => q.id === e.engine), nm = ARMS[e.what || en?.kind]?.name.toLowerCase() || "engine", p2 = en ? { x: en.x, y: en.y } : {};
      if (k === "engine-ready" && mine) L(`Our ${nm} is framed up and ready`, p2);
      else if (k === "engine-destroyed" && (mine || (en && seen(en.x, en.y)))) L(`${mine ? "Our" : "The enemy's"} ${nm} is ${e.how === "burnt" ? "burnt out" : "smashed to kindling"}`, { ...p2, tone: mine ? "bad" : "good" }, true);
      else if (k === "engine-captured" && (mine || en?.team === team)) { const ours = mine; L(ours ? `We take the enemy's ${nm}` : `The enemy takes our ${nm}`, { ...p2, tone: ours ? "good" : "bad" }, true); }
      else if (k === "engine-abandoned" && mine) T(`Our ${nm} has lost its crew`);
    }
    else if (k === "engine-fired" && mine) T(`Our ${ARMS[e.what]?.name.toLowerCase() || "engine"} is on fire!`);
    else if (k === "engine-out-of-range" && mine) T(`Out of range (${e.d} m) — move the engine closer or choose another target`);
    else if (k === "engine-fixed" && mine) T("A framed-up trebuchet cannot be moved");
    else if (k === "escalade-refused" && mine) T(`No escalade: ${e.why}`);
    else if (k === "escalade-lodged") { const u = w.units.get(e.unit), p = u ? { x: u.ax, y: u.ay } : {}; if (mine) L(`Our men are over the wall (${e.over} up the ladders)`, { ...p, tone: "good" }); else if (u && seen(u.ax, u.ay)) L("The enemy are over our wall!", { ...p, tone: "bad" }, true); }
    else if (k === "escalade-failed" && mine) T(`The escalade fails: ${e.why}`);
    else if (k === "tower-docked") { if (mine) T("The siege tower is against the wall"); else if (seen(e.x, e.y)) T("An enemy siege tower is at our wall!"); }
    else if (k === "squire-ready" && mine) L("A squire has won his spurs: a knight can be armed at the stables", {});
    else if (k === "research-done" && mine && TECHS[e.tech]) L(`Learned at the keep: ${TECHS[e.tech].name} — ${TECHS[e.tech].effect}`, { tone: "good" }, true);
    else if (k === "research-start" && mine && TECHS[e.tech]) T(`The clerk sends for masters: ${TECHS[e.tech].name}`);
    else if (k === "migrants" && mine) { const H = w.teams[team].town; L(`${e.n} newcomers settle in ${townName(team)}`, { x: H.x, y: H.y }); }
    else if (k === "tallage" && mine) L("A tallage is levied on the vill", {});
    else if (k === "disbanded" && mine) L(`${e.n} ${ARMS[e.arm]?.name || e.arm} stood down and sent home`, {});
    return out;
  }
  // enemy troops seen near the vill: a raid, or the army coming
  function watchHome() {
    const H = w.teams[team].town; if (!H) return null; let n = 0, sx = 0, sy = 0;
    for (const v of w.units.values()) if (isFoe(w, team, v.team) && !v.isWorkers && v.members.length && Math.hypot(v.ax - H.x, v.ay - H.y) < 1500 && seen(v.ax, v.ay)) { n += v.members.length; sx += v.ax * v.members.length; sy += v.ay * v.members.length; }
    const now = n >= 5; let line = null;
    if (now && !st.sightWas && w.tick - st.sightT > 1200) { st.sightT = w.tick; const x = sx / n, y = sy / n; line = { text: `Enemy troops sighted ${at(x, y)} — about ${Math.round(n / 5) * 5 || n} men`, x, y, tone: "bad", toast: true }; }
    st.sightWas = now;
    return line;
  }
  return { lines, watchHome, st };
}
