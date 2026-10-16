// Ranked Battle: the rules both the realm's server (server/ranked.mjs) and the game (js/ui/ranked.js) keep.
// An army is a list [[arm, men]…] (js/sim/battlefield.js TROOPS: the arms a pitched battle fields). Its worth is its
// day's wages in pence. Spoils buy men at a penny of spoils per penny of wage, five at a time.
import { TROOPS, MIX } from "./battlefield.js";
import { DISPOSITIONS, nameOf } from "./legend.js";

export const START_RATING = 1000;
export const STARTER = [["levy", 40], ["spearmen", 30], ["archers", 20]]; // a small shire muster: 160 d a day
export const BUY_STEP = 5;
export const ARMY_MAX = 900; // men (js/sim/battlefield.js HOST_MAX: more would not fit the field)

export const armyValue = (army) => (army || []).reduce((s, [a, n]) => s + (TROOPS[a]?.wage || 0) * n, 0);
export const armyMen = (army) => (army || []).reduce((s, [, n]) => s + n, 0);
export const buyCost = (arm, n = BUY_STEP) => (TROOPS[arm]?.wage || 0) * n;
export const ARMS_FOR_SALE = Object.keys(TROOPS);

// a clean army: known arms, whole men, merged, nothing empty, within the field's size
export function tidyArmy(army) {
  const m = new Map();
  for (const e of Array.isArray(army) ? army : []) { const [a, n] = e || []; if (TROOPS[a] && Number.isFinite(n) && n > 0) m.set(a, (m.get(a) || 0) + Math.floor(n)); }
  return [...m].map(([a, n]) => [a, Math.min(n, TROOPS[a].max)]);
}

// a bot's army worth `pence` a day, mixed by its commander's temper (shares of the wage bill, in fives)
export function composeArmy(pence, temper, rng = Math.random) {
  const mix = MIX[temper] || MIX.inspiring, out = [];
  for (const [arm, f] of Object.entries(mix)) {
    const T = TROOPS[arm]; const n = Math.round(pence * f * (0.85 + rng() * 0.3) / T.wage / BUY_STEP) * BUY_STEP;
    if (n > 0) out.push([arm, Math.min(n, T.max)]);
  }
  // …too dear (five knights are 120 d a day): shed the dearest arm, five at a time
  for (let k = 0; k < 400 && out.length && out.reduce((s, [a, n]) => s + TROOPS[a].wage * n, 0) > pence * 1.08; k++) {
    out.sort((a, b) => TROOPS[b[0]].wage - TROOPS[a[0]].wage); out[0][1] -= BUY_STEP; if (out[0][1] <= 0) out.shift();
  }
  // rounding leaves a small host short: fill it with the mix's own arms, cheapest first, up to its worth
  const arms = Object.keys(mix).sort((a, b) => TROOPS[a].wage - TROOPS[b].wage);
  for (let k = 0; k < 400; k++) {
    const left = pence - out.reduce((s, [a, n]) => s + TROOPS[a].wage * n, 0);
    const arm = arms[k % arms.length]; if (left < TROOPS[arms[0]].wage * BUY_STEP) break;
    if (TROOPS[arm].wage * BUY_STEP > left) continue;
    const e = out.find((q) => q[0] === arm); if (e) e[1] += BUY_STEP; else out.push([arm, BUY_STEP]);
  }
  if (!out.length) out.push(["levy", Math.max(BUY_STEP, Math.round(pence / BUY_STEP) * BUY_STEP)]);
  return out;
}

// Elo: the chance A beats B, and the new rating after a result (1 win, 0.5 draw, 0 loss)
export const expected = (ra, rb) => 1 / (1 + 10 ** ((rb - ra) / 400));
export const rated = (ra, rb, score, k = 32) => Math.round(ra + k * (score - expected(ra, rb)));

// spoils of the day: a win takes a share of what the beaten host was worth; a loss or a draw still pays a little
export function spoilsFor(outcome, myArmy, foeArmy) {
  const foe = armyValue(foeArmy), mine = armyValue(myArmy);
  if (outcome === "win") return Math.round(30 + foe * 0.35 + Math.max(0, foe - mine) * 0.25); // (beating a bigger host pays more)
  if (outcome === "draw") return Math.round(15 + foe * 0.1);
  return Math.round(10 + foe * 0.05);
}

// how a commander fights, learned from his orders in ranked battles (counts), and the temper nearest it
export const NO_STYLE = { attack: 0, hold: 0, flank: 0, missile: 0, ambush: 0, charge: 0, n: 0 };
export function mergeStyle(old, add, keep = 0.8) { // (an exponential memory: recent battles weigh most)
  const o = { ...NO_STYLE, ...(old || {}) }, a = { ...NO_STYLE, ...(add || {}) }, out = {};
  for (const k of Object.keys(NO_STYLE)) out[k] = k === "n" ? o.n + 1 : o[k] * keep + a[k] * (1 - keep) * (o.n ? 1 : 1 / (1 - keep));
  return out;
}
export function temperOf(style) {
  const s = { ...NO_STYLE, ...(style || {}) }, tot = s.attack + s.hold + s.flank + s.missile + s.ambush + s.charge;
  if (!s.n || tot < 1) return "inspiring";
  const f = (k) => s[k] / tot;
  const me = { aggression: f("attack") + f("charge"), flank: f("flank"), hold: f("hold"), missile: f("missile"), ambush: f("ambush"), charge: f("charge") };
  const fit = {
    defensive: me.hold * 2 - me.aggression, aggressive: me.aggression * 1.6 - me.hold, flanker: me.flank * 2.2, skirmish: me.missile * 1.8 - me.charge,
    ambusher: me.ambush * 3, shock: me.charge * 2.4, inspiring: 0.35,
  };
  return Object.entries(fit).sort((a, b) => b[1] - a[1])[0][0];
}
export const temperName = (t) => DISPOSITIONS[t]?.name || t;

// ════════════════════════════════════════════════════════════════ the loadout: companies, special ops, skills, spells
// A host is a list of COMPANIES: { arm, n, name, pos, drill, stakes, op } — where it draws up (pos: js/sim/battlefield.js
// placeHost roles), how well drilled, an ops company's kind. Spoils buy men, drill, stakes, special ops, the commander's
// skills and spell charges. Everything here is plain data; the battle reads it through hostCompanies / applySkills.
export const POSITIONS = { auto: "Where it fits best", centre: "The centre", "wing-left": "Left wing", "wing-right": "Right wing", front: "Before the line", reserve: "In reserve", "horse-left": "Horse, left flank", "horse-right": "Horse, right flank" };
export const DRILL = [{ name: "Raw", training: null, cost: 0 }, { name: "Veteran", training: 0.7, cost: 3 }, { name: "Elite", training: 0.92, cost: 7 }]; // (cost: spoils per man)
export const STAKES_COST = 25;
export const SPECIAL_OPS = {
  foresters: { name: "Foresters", arm: "archers", n: 15, pos: "ambush", drill: 2, cost: 160, desc: "Fifteen elite bowmen lying in a wood beside the field: they loose into the flank when the foe comes near." },
  reserve: { name: "The Hidden Reserve", arm: "menatarms", n: 20, pos: "hidden", drill: 1, cost: 320, desc: "Twenty men-at-arms out of sight behind your line: they come in when the fighting is well joined." },
  outriders: { name: "Outriders", arm: "hobelars", n: 15, pos: "horse-left", drill: 1, cost: 160, desc: "Fifteen light horse on a flank, for the rear and the fleeing." },
  pavisiers: { name: "Pavisiers", arm: "crossbow", n: 20, pos: "front", drill: 1, stakes: true, cost: 190, desc: "Twenty crossbowmen behind their stakes before the line." },
  household: { name: "Household Knights", arm: "knights", n: 6, pos: "horse-right", drill: 2, cost: 280, desc: "Six of your own knights, the best horse in the field." },
};
export const OPS_MAX = 2;
export const SKILLS = {
  discipline: { name: "Iron Discipline", cost: 220, desc: "Your men steady faster: fear wears off them a third quicker." },
  drillmaster: { name: "Drillmaster", cost: 260, desc: "Every company a step better drilled than its rank." },
  quartermaster: { name: "Quartermaster", cost: 140, desc: "Double sheaves of arrows and bolts for every bow." },
  marchers: { name: "Hard Marchers", cost: 180, desc: "Your men get their wind back twice as fast." },
  eagle: { name: "Eagle Eye", cost: 200, desc: "Your scouts find the foe's ambushes and hidden men before the trumpets." },
  stakes: { name: "Master of Stakes", cost: 150, desc: "Every bow company drives its stakes before the battle." },
};
export const SKILL_SLOTS = 3;
export const RSPELLS = {
  bless: { name: "Bless", cost: 30, r: 60, desc: "Steadies your men in 60 m (fear −0.35)." },
  mend: { name: "Mend", cost: 35, r: 35, desc: "Closes wounds on your men in 35 m." },
  thunder: { name: "Thunderclap", cost: 55, r: 45, desc: "A crack of thunder over the foe in 45 m: fear +0.4 — a wavering line may break." },
  smite: { name: "Smite", cost: 70, r: 9, desc: "Lightning into the foe: those within 9 m struck (the near ones down)." },
  wind: { name: "Second Wind", cost: 30, r: 60, desc: "Your men in 60 m get their wind back." },
  mist: { name: "Mist", cost: 45, desc: "A mist on the field: everyone sees half as far for three minutes." },
};
export const SPELL_MAX = 5; // charges of one spell carried into a battle

let coSeq = 0;
// an old host ([[arm, n]…]) as companies; a company list kept as it is. Each company's captain is a man drawn once (cap:
// the seed of his name, js/sim/legend.js nameOf) and kept with the company from battle to battle
export function companiesFrom(army, rng = Math.random) {
  if (!Array.isArray(army)) return [];
  return army.map((e) => Array.isArray(e) ? { id: `c${++coSeq}${Math.floor(rng() * 1e6).toString(36)}`, arm: e[0], n: e[1], name: null, pos: "auto", drill: 0, stakes: false, cap: Math.floor(rng() * 2 ** 30) } : e).filter((c) => c && TROOPS[c.arm] && c.n > 0);
}

// ════════════════════════════════════════════════════════════════ the names that stand for a player
// The owner: "your lord and your commander's names should stay the same between ranked battles". A player's LORD (his
// side's lord, the knight who takes the field) and his COMMANDER (who knows the skills; he leads the host's main company)
// are named once, from the account (the same account → the same men), kept in his standing, and renamed in the camp.
export const NAME_MAX = 24;
export const cleanName = (t) => String(t ?? "").replace(/[<>&"]/g, "").replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
const hashStr = (t) => { let h = 2166136261; for (const ch of String(t)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return h >>> 0; };
export const nameSeed = (key, what) => hashStr(`${what}:${key}`) & 0x3fffffff;
export function defaultNames(key) { return { lord: `Sir ${nameOf(nameSeed(key, "lord"))}`, commander: `Sir ${nameOf(nameSeed(key, "commander"))}` }; }
// the company the commander leads: the largest of the line (not a special company)
export function commanderCompany(cos) { let best = null; for (const c of cos || []) if (!c.op && (!best || c.n > best.n)) best = c; return best || (cos || [])[0] || null; }
export const coMen = (cos) => (cos || []).reduce((s, c) => s + c.n, 0);
export const coValue = (cos) => (cos || []).reduce((s, c) => s + (TROOPS[c.arm]?.wage || 0) * c.n * (1 + 0.35 * (c.drill || 0)), 0);
export const asArmy = (cos) => (cos || []).map((c) => [c.arm, c.n]);

// the companies as the battle draws them up: [arm, n, { role, training, stakes, name, ammo }]
// (cap: the company's captain, the seed of his name; capName: the commander, who leads the main company)
export function hostCompanies(cos, skills = [], commander = null) {
  const dm = skills.includes("drillmaster") ? 1 : 0, qm = skills.includes("quartermaster"), sm = skills.includes("stakes"), cc = commander ? commanderCompany(cos) : null;
  return (cos || []).map((c) => {
    const d = Math.min(2, (c.drill || 0) + dm), o = {};
    if (c.pos && c.pos !== "auto") o.role = c.pos;
    if (DRILL[d].training !== null) o.training = DRILL[d].training;
    if (c.stakes || (sm && ["archers", "crossbow"].includes(c.arm))) o.stakes = true;
    if (c.name) o.name = c.name;
    if (Number.isInteger(c.cap)) o.cap = c.cap;
    if (c === cc) o.capName = commander;
    if (qm && ["archers", "crossbow"].includes(c.arm)) o.ammo = c.arm === "crossbow" ? 80 : 120;
    return [c.arm, c.n, o];
  });
}
// the commander's skills that act through the battle (the others act in hostCompanies): per tick, team `team`
export function skillSystem(skills, team) {
  const disc = skills.includes("discipline"), wind = skills.includes("marchers");
  if (!disc && !wind) return null;
  return (w) => {
    if (w.tick % 10) return; const S = w.S;
    for (let i = 0; i < S.n; i++) { if (!S.alive[i] || S.team[i] !== team) continue; if (disc && S.stress[i] > 0) S.stress[i] = Math.max(0, S.stress[i] - 0.004); if (wind && S.fatigue[i] > 0) S.fatigue[i] = Math.max(0, S.fatigue[i] - 0.003); }
  };
}
// Eagle Eye: the foe's hidden men and ambushes are known before the trumpets (they no longer lurk unseen)
export function eagleEye(w, team) { for (const u of w.units.values()) if (u.team !== team && u.lurking) { u.lurking = false; u.spotted = true; } }

// a battle spell cast by `team` at (x, y): → true if it took
export function castRanked(w, team, kind, x, y) {
  const Sp = RSPELLS[kind]; if (!Sp) return false; const S = w.S;
  const within = (i, r) => S.alive[i] && Math.hypot(S.x[i] - x, S.y[i] - y) <= r;
  if (kind === "mist") w.mist = { visibility: 0.5, until: w.tick + 1800 };
  else for (let i = 0; i < S.n; i++) {
    if (!within(i, Sp.r)) continue; const mine = S.team[i] === team;
    if (kind === "bless" && mine) S.stress[i] = Math.max(0, S.stress[i] - 0.35);
    else if (kind === "mend" && mine && S.wounds) S.wounds[i] = Math.max(0, S.wounds[i] - 0.5);
    else if (kind === "wind" && mine) S.fatigue[i] = 0;
    else if (kind === "thunder" && !mine) S.stress[i] = Math.min(3, S.stress[i] + 0.4);
    else if (kind === "smite" && !mine) { const d = Math.hypot(S.x[i] - x, S.y[i] - y); if (S.wounds) S.wounds[i] = Math.min(1, (S.wounds[i] || 0) + (d < 4 ? 1 : 0.5)); S.stress[i] = Math.min(3, S.stress[i] + 0.3); }
  }
  w.events.push({ t: w.tick, kind: "spell", spell: kind, team, x, y });
  return true;
}
// a bot's (or an absent player's) loadout of a given worth: ops, skills and spells bought as a player of that standing would
export function botLoadout(rating, rng = Math.random) {
  const lvl = Math.max(0, Math.min(1, (rating - 950) / 500)), keys = Object.keys(SKILLS), ops = Object.keys(SPECIAL_OPS), sp = Object.keys(RSPELLS);
  const pick = (arr, n) => { const a = arr.slice(), out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(rng() * a.length), 1)[0]); return out; };
  const skills = pick(keys, Math.round(lvl * SKILL_SLOTS)), opsN = Math.round(lvl * OPS_MAX), spells = {};
  for (const k of pick(sp, Math.round(1 + lvl * 3))) spells[k] = 1 + Math.floor(rng() * (1 + lvl * 2));
  return { skills, ops: pick(ops, opsN), spells };
}
export function opsCompany(key, rng = Math.random) { const O = SPECIAL_OPS[key]; return O ? { id: `op-${key}`, arm: O.arm, n: O.n, name: O.name, pos: O.pos, drill: O.drill, stakes: !!O.stakes, op: key, cap: Math.floor(rng() * 2 ** 30) } : null; }

// ════════════════════════════════════════════════════════════════ a bot fitted to the player who meets it
// The owner: "bots should be your current level: once you get enough spoils everything goes haywire and you just crimp
// everyone". A bot was a host worth the player's WAGE BILL (raw men) with a loadout by rating alone, so drill, special
// companies, skills and spells bought with spoils were all clear gain. Now the bot is built from the player's own host:
//   worth  = coValue(player's companies) × (0.93…1.17 at random) × (1 + (bot rating − player rating) / 1600)
//            (a little over par on the mean: the player chose his host and his skills, the bot's are drawn — at par the
//            player won 71% of headless battles, tools/ranked-sim.mjs)
//   men    ≈ the player's (±12%), mixed by the bot's temper; drill = the player's men-weighted drill; as many special
//            companies, skills and spell charges as the player carries (the kinds drawn at random)
//   wits   = how well the bot leads, from its rating (0 at 900 … 1 at 1500): its temper answers the player's host more
//            often, and it casts its spells sooner and more often (js/ui/ranked.js aiCaster)
export const witsOf = (rating) => Math.max(0, Math.min(1, (rating - 900) / 600));
const isHorse = (a) => a === "knights" || a === "hobelars", isBow = (a) => a === "archers" || a === "crossbow";
// the temper that answers a host: horse is met by a stubborn line, bows by a quick close, a mass of foot from the flanks
export function counterTemper(cos) {
  const men = coMen(cos) || 1, horse = (cos || []).filter((c) => isHorse(c.arm)).reduce((s, c) => s + c.n, 0) / men, bow = (cos || []).filter((c) => isBow(c.arm)).reduce((s, c) => s + c.n, 0) / men;
  return horse > 0.2 ? "defensive" : bow > 0.35 ? "aggressive" : "flanker";
}
export const BOT_TEMPERS = ["defensive", "aggressive", "flanker", "skirmish", "ambusher", "shock", "inspiring"];
export function botTemper(me, rating, rng = Math.random) {
  return rng() < witsOf(rating) * 0.6 ? counterTemper(me.companies) : BOT_TEMPERS[Math.floor(rng() * BOT_TEMPERS.length)];
}
export function botHost(me, rating, temper, rng = Math.random) {
  const mine = me.companies || [], line = mine.filter((c) => !c.op), myOps = mine.filter((c) => c.op);
  const pick = (arr, n) => { const a = arr.slice(), out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(rng() * a.length), 1)[0]); return out; };
  const lead = Math.max(-0.08, Math.min(0.08, (rating - (me.rating ?? rating)) / 1600));
  const target = Math.max(120, coValue(mine) * (0.93 + rng() * 0.24) * (1 + lead));
  const ops = pick(Object.keys(SPECIAL_OPS), myOps.length).map((k) => opsCompany(k, rng));
  const lineMen = coMen(line), dbar = lineMen ? line.reduce((s, c) => s + (c.drill || 0) * c.n, 0) / lineMen : 0;
  const lineTarget = Math.max(60, target - coValue(ops)), wageOf = (a) => TROOPS[a].wage;
  // the line's men, by the temper's mix, worth the line's share before drill
  const army = composeArmy(lineTarget / (1 + 0.35 * dbar), temper, rng);
  const men = () => army.reduce((s, [, n]) => s + n, 0), pence = () => army.reduce((s, [a, n]) => s + wageOf(a) * n, 0);
  const want = Math.max(BUY_STEP * 4, Math.min(ARMY_MAX - coMen(ops), (coMen(mine) - coMen(ops)) * (0.94 + rng() * 0.12)));
  // …as many men as the player's line (±12%): dear men traded for cheap ones (or the reverse) at the same wage
  const armOf = (a) => army.find((e) => e[0] === a) || (army.push([a, 0]), army[army.length - 1]);
  const pool = Object.keys(MIX[temper] || MIX.inspiring).concat(["levy", "menatarms"]).sort((a, b) => wageOf(a) - wageOf(b));
  for (let k = 0; k < 400; k++) {
    const m = men(); if (m >= want * 0.9 && m <= want * 1.1) break;
    const have = army.filter((e) => e[1] > 0).sort((a, b) => wageOf(a[0]) - wageOf(b[0]));
    if (m < want * 0.9) { // too few: five of the dearest go, cheap men in their place
      const dear = have[have.length - 1], cheap = armOf(pool[0]); if (!dear || wageOf(dear[0]) <= wageOf(cheap[0])) break;
      dear[1] -= BUY_STEP; cheap[1] += Math.max(BUY_STEP, Math.round(wageOf(dear[0]) / wageOf(cheap[0])) * BUY_STEP);
    } else { // too many: cheap men go, five dear ones in their place
      const dearA = have.length && wageOf(have[have.length - 1][0]) > wageOf(have[0][0]) ? have[have.length - 1][0] : pool[pool.length - 1], dear = armOf(dearA);
      const cheap = have.find((e) => wageOf(e[0]) < wageOf(dearA) && e[1] >= Math.max(BUY_STEP, Math.round(wageOf(dearA) / wageOf(e[0])) * BUY_STEP)); if (!cheap) break;
      cheap[1] -= Math.max(BUY_STEP, Math.round(wageOf(dearA) / wageOf(cheap[0])) * BUY_STEP); dear[1] += BUY_STEP;
    }
  }
  for (let i = army.length - 1; i >= 0; i--) if (army[i][1] <= 0) army.splice(i, 1);
  const cos = companiesFrom(army.filter(([, n]) => n > 0), rng);
  // drilled as the player's line is: each company Raw/Veteran/Elite so the men-weighted mean is his
  const lo = Math.floor(dbar), frac = dbar - lo;
  for (const c of cos) c.drill = Math.min(DRILL.length - 1, lo + (rng() < frac ? 1 : 0));
  // the worth made good (±3%), five men at a time: from the dear companies when the host has men enough, else the cheap
  const per = (c) => wageOf(c.arm) * (1 + 0.35 * (c.drill || 0)), byWorth = () => cos.filter((c) => c.n > 0).sort((a, b) => per(a) - per(b));
  for (let k = 0; k < 400; k++) {
    const v = coValue(cos) + coValue(ops), lm = coMen(cos), by = byWorth(); if (!by.length) break;
    if (v > target * 1.03) { const c = lm < want ? by.slice().reverse().find((q) => q.n > BUY_STEP) : by.find((q) => q.n > BUY_STEP); if (!c) break; c.n -= BUY_STEP; }
    else if (v < target * 0.97 && lm + coMen(ops) + BUY_STEP <= ARMY_MAX) { const c = lm >= want ? by[by.length - 1] : by[0]; c.n += BUY_STEP; }
    else break;
  }
  // the commander's skills and the spell charges: as many as the player's (a stronger bot one more charge, sometimes)
  // (the skills that serve this host first: no Quartermaster without bows, no Eagle Eye when nothing of his lies hidden)
  const all = cos.concat(ops), bows = all.filter((c) => isBow(c.arm)).reduce((s, c) => s + c.n, 0) / Math.max(1, coMen(all));
  const useful = Object.keys(SKILLS).filter((k) => (k !== "quartermaster" && k !== "stakes" || bows >= 0.2) && (k !== "eagle" || mine.some((c) => ["ambush", "hidden"].includes(c.pos))) && (k !== "drillmaster" || all.some((c) => (c.drill || 0) < 2)));
  const nSk = Math.min(SKILL_SLOTS, (me.skills || []).length), skills = pick(useful, nSk); skills.push(...pick(Object.keys(SKILLS).filter((k) => !skills.includes(k)), nSk - skills.length));
  const myCharges = Object.values(me.spells || {}).reduce((s, n) => s + (n || 0), 0), wits = witsOf(rating);
  let charges = Math.max(Math.round(wits * 2), myCharges + Math.floor(rng() * 3) - 1 + (lead > 0 && rng() < wits ? 1 : 0));
  const spells = {}, kinds = Object.keys(RSPELLS);
  for (let k = 0; k < 200 && charges > 0; k++) { const s = kinds[Math.floor(rng() * kinds.length)]; if ((spells[s] || 0) >= SPELL_MAX) continue; spells[s] = (spells[s] || 0) + 1; charges--; }
  return { companies: cos.concat(ops), skills, spells, wits };
}
// how far a host is from another's worth (a recorded host is matched near the player's own)
export const valueGap = (a, b) => Math.abs(coValue(a) - coValue(b)) / Math.max(1, coValue(b));

// a lord who casts his charges on his own (a bot's, or an absent player's host): on the foe's thickest press, on his own
// frightened or blown men. A cleverer lord (wits 0…1, from his rating) looks for his moment twice as often.
//   aiCaster(charges, team, wits) → (w) => void   (a system: call it every tick after the trumpets)
export function aiCaster(charges, team, wits = 0) {
  const fc = { ...(charges || {}) }, every = Math.round(300 - 150 * Math.max(0, Math.min(1, wits)));
  return (w) => {
    if (w.tick % every !== Math.floor(every / 2)) return;
    const us = [...w.units.values()].filter((u) => !u.isWorkers && u.members.length && u.battleHost);
    const mine = us.filter((u) => u.team === team), yours = us.filter((u) => u.team !== team);
    const S = w.S, avg = (u, f) => u.members.reduce((s, i) => s + (S[f][i] || 0), 0) / u.members.length;
    const fight = yours.filter((u) => mine.some((v) => Math.hypot(u.ax - v.ax, u.ay - v.ay) < 60)).sort((a, b) => b.members.length - a.members.length)[0];
    const scared = mine.slice().sort((a, b) => avg(b, "stress") - avg(a, "stress"))[0], blown = mine.slice().sort((a, b) => avg(b, "fatigue") - avg(a, "fatigue"))[0];
    const cast = (k, u) => { if (!(fc[k] > 0) || !u) return false; fc[k]--; castRanked(w, team, k, u.ax, u.ay); return true; };
    cast("smite", fight) || cast("thunder", fight) || (scared && avg(scared, "stress") > 0.6 && cast("bless", scared)) || (blown && avg(blown, "fatigue") > 0.5 && cast("wind", blown)) || cast("mend", scared);
  };
}
