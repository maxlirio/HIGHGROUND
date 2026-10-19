// Ranked Battle: the rules both the realm's server (server/ranked.mjs) and the game (js/ui/ranked.js) keep.
// An army is a list [[arm, men]…] (js/sim/battlefield.js TROOPS: the arms a pitched battle fields). Its worth is its
// day's wages in pence. Spoils buy men at a penny of spoils per penny of wage, five at a time.
import { powersOf, DEFAULT_ERA } from "./eras.js";
import { rankedPack } from "./eras/ranked-packs.js";
// …and passed on, because the realm's server reaches these rules through this module alone (server/ranked.mjs).
// It was not re-exported at first, so every `RR.DEFAULT_ERA` there read undefined and the whole family's standings
// migrated into a war literally named "undefined".
export { DEFAULT_ERA } from "./eras.js";
import { TROOPS, MIX, MIX_ERA } from "./battlefield.js";
import { ARMS } from "./arms.js";
import { DISPOSITIONS, nameOf } from "./legend.js";
import { namesOf } from "./eras/names.js";
import { ARM_BY_ID } from "./arms.js";
import { isFoe } from "./sides.js";
import { blast as BAL_BLAST } from "./ballistics.js";

export const START_RATING = 1000;
// ── THREE LADDERS (docs/eras-plan.md § A game each, stage 3). A lord keeps a standing in each war he fights, and
// the books are kept apart: his spoils, his unlocks and his army lists in the Vale are not his spoils, unlocks and
// lists in 1944. What a war's ladder HOLDS — the host he starts with, what spoils open, the picked companies, what
// his commander can learn — is its own content, in js/sim/eras/<war>/ranked.js. Everything below that line (points,
// tiers, drill, the handicap, how a bot is built to meet him) is the same machinery in every age.
//
// `era` may be given as a war key or as the lord himself: a standing carries `p.era`, so `unlockOf(p)` is enough
// and no call site has to remember to pass it separately.
const packOf = (era) => rankedPack(typeof era === "string" ? era : era?.era || DEFAULT_ERA);
export const starterOf = (era) => packOf(era).STARTER.map((e) => e.slice());
export const unlockOf = (era) => packOf(era).ARM_UNLOCK;
export const opsOf = (era) => packOf(era).SPECIAL_OPS;
export const skillsOf = (era) => packOf(era).SKILLS;
// the arms a lord of this war may muster at all — the ladder's own keys, in the order it lists them
export const armsFor = (era) => Object.keys(unlockOf(era)).filter((a) => TROOPS[a]);
// what the lords of a war buy, by temper (js/sim/battlefield.js MIX_ERA); a war with no table of its own fields the Vale's
export const mixOf = (era, temper) => { const T = MIX_ERA[typeof era === "string" ? era : era?.era] || MIX; return T[temper] || T.inspiring || MIX.inspiring; };
export const starterArmsOf = (era) => Object.entries(unlockOf(era)).filter(([, c]) => c === 0).map(([a]) => a);
export const stakeArmsOf = (era) => packOf(era).STAKE_ARMS;        // who may plant stakes before them
export const fillMixOf = (era) => packOf(era).FILL_MIX;            // what a brand-new lord's list is filled out of
export const qmAmmoOf = (era) => packOf(era).QM_AMMO;              // what a Quartermaster's companies carry

export const STARTER = starterOf(DEFAULT_ERA); // (the Vale's, for callers that know nothing of wars)
export const BUY_STEP = 5;
export const ARMY_MAX = 900; // men (js/sim/battlefield.js HOST_MAX: more would not fit the field)

export const armyValue = (army) => (army || []).reduce((s, [a, n]) => s + (TROOPS[a]?.wage || 0) * n, 0);
export const armyMen = (army) => (army || []).reduce((s, [, n]) => s + n, 0);
export const buyCost = (arm, n = BUY_STEP) => (TROOPS[arm]?.wage || 0) * n;
export const ARMS_FOR_SALE = armsFor(DEFAULT_ERA);

// a clean army: known arms, whole men, merged, nothing empty, within the field's size
export function tidyArmy(army) {
  const m = new Map();
  for (const e of Array.isArray(army) ? army : []) { const [a, n] = e || []; if (TROOPS[a] && Number.isFinite(n) && n > 0) m.set(a, (m.get(a) || 0) + Math.floor(n)); }
  return [...m].map(([a, n]) => [a, Math.min(n, TROOPS[a].max)]);
}

// a bot's army worth `pence` a day, mixed by its commander's temper (shares of the wage bill, in fives)
export function composeArmy(pence, temper, rng = Math.random, era = DEFAULT_ERA) {
  const mix = mixOf(era, temper), out = [];
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
// The war's own picked companies and its commander's skills (js/sim/eras/<war>/ranked.js). The bare names are the
// Vale's, which is what every caller that knows nothing of wars still gets.
export const SPECIAL_OPS = opsOf(DEFAULT_ERA);
export const OPS_MAX = 2;
export const SKILLS = skillsOf(DEFAULT_ERA);
export const SKILL_SLOTS = 3;
// The powers a commander can call. The table belongs to the era (js/sim/eras.js); RSPELLS stays as the Vale's,
// which is what every caller that knows nothing of eras still gets.
export const spellsFor = (era) => powersOf(era);
export const RSPELLS = powersOf(DEFAULT_ERA);
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
// A lord and his second, named from the war they fight in (js/sim/eras/names.js): "Sir Gilbert of the Ford" in the
// Vale, "Captain Hollis" in 1944. The Vale's seed and pool are untouched, so no name on the family's board moves.
export function defaultNames(key, era = DEFAULT_ERA) {
  const N = namesOf(era);
  return { lord: `${N.lord} ${nameOf(nameSeed(key, "lord"), era)}`, commander: `${N.second} ${nameOf(nameSeed(key, "commander"), era)}` };
}
export const botNamesOf = (era) => namesOf(era).bots;
// the company the commander leads: the largest of the line (not a special company)
export function commanderCompany(cos) { let best = null; for (const c of cos || []) if (!c.op && (!best || c.n > best.n)) best = c; return best || (cos || [])[0] || null; }
export const coMen = (cos) => (cos || []).reduce((s, c) => s + c.n, 0);
export const coValue = (cos) => (cos || []).reduce((s, c) => s + (TROOPS[c.arm]?.wage || 0) * c.n * (1 + 0.35 * (c.drill || 0)), 0);
export const asArmy = (cos) => (cos || []).map((c) => [c.arm, c.n]);

// the companies as the battle draws them up: [arm, n, { role, training, stakes, name, ammo }]
// (cap: the company's captain, the seed of his name; capName: the commander, who leads the main company)
export function hostCompanies(cos, skills = [], commander = null, era = DEFAULT_ERA) {
  const dm = skills.includes("drillmaster") ? 1 : 0, qm = skills.includes("quartermaster"), sm = skills.includes("stakes"), cc = commander ? commanderCompany(cos) : null;
  const stakers = stakeArmsOf(era), ammo = qmAmmoOf(era);
  return (cos || []).map((c) => {
    const d = Math.min(2, (c.drill || 0) + dm), o = {};
    if (c.pos && c.pos !== "auto") o.role = c.pos;
    if (DRILL[d].training !== null) o.training = DRILL[d].training;
    if (c.stakes || (sm && stakers.includes(c.arm))) o.stakes = true;
    if (c.name) o.name = c.name;
    if (Number.isInteger(c.cap)) o.cap = c.cap;
    if (c === cc) o.capName = commander;
    if (qm && ammo[c.arm]) o.ammo = ammo[c.arm];
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
export function castRanked(w, team, kind, x, y, era = DEFAULT_ERA) {
  const Sp = powersOf(era)[kind] || RSPELLS[kind]; if (!Sp) return false; const S = w.S, t = w.time;
  const R = Sp.r || 0;
  const d2 = (i) => (S.x[i] - x) * (S.x[i] - x) + (S.y[i] - y) * (S.y[i] - y);
  const within = (i, r) => S.alive[i] && d2(i) <= r * r;
  // deterministic jitter: a live battle is replayed on both sides, so nothing here may touch w.rng
  const jit = (i, a, b) => { const h = Math.imul(i ^ w.tick, 2246822519) >>> 0; return a + (h % 1000) / 1000 * (b - a); };
  const down = (i, lo, hi) => { S.posture[i] = 1; S.upT[i] = Math.max(S.upT[i], t + jit(i, lo, hi)); S.stunT[i] = Math.max(S.stunT[i], t + jit(i + 7, 0.5, 2)); };

  // The Ardennes' powers are STANDING EFFECTS, not a blow struck once, so they branch out here before the
  // single-application chain below (a barrage walks for twenty seconds; a mine field waits all battle).
  if (ARDENNES_POWERS.has(kind)) { ardennes(w, team, kind, x, y, Sp); w.events.push({ t: w.tick, kind: "spell", spell: kind, team, x, y }); return true; }
  if (kind === "mist") w.mist = { visibility: 0.5, until: w.tick + 1800 };
  else if (kind === "chain") {
    // lightning leaps from man to man: the eight nearest of the foe, each one struck
    const near = [];
    for (let i = 0; i < S.n; i++) if (S.alive[i] && S.team[i] !== team && d2(i) <= R * R) near.push([d2(i), i]);
    near.sort((a, b) => a[0] - b[0]);
    for (let k = 0; k < near.length && k < 8; k++) { const i = near[k][1];
      if (S.wounds) S.wounds[i] = Math.min(1, (S.wounds[i] || 0) + (k < 3 ? 0.9 : 0.55));
      S.stress[i] = Math.min(3, S.stress[i] + 0.3); down(i, 1, 3);
    }
  }
  else for (let i = 0; i < S.n; i++) {
    if (!within(i, R)) continue; const mine = S.team[i] === team, dd = Math.sqrt(d2(i));
    if (kind === "bless" && mine) S.stress[i] = Math.max(0, S.stress[i] - 0.35);
    else if (kind === "mend" && mine && S.wounds) S.wounds[i] = Math.max(0, S.wounds[i] - 0.5);
    else if (kind === "wind" && mine) S.fatigue[i] = 0;
    else if (kind === "haste" && mine) { S.fatigue[i] = 0; S.stress[i] = Math.max(0, S.stress[i] - 0.2); }
    else if (kind === "thunder" && !mine) S.stress[i] = Math.min(3, S.stress[i] + 0.4);
    else if (kind === "smite" && !mine) { if (S.wounds) S.wounds[i] = Math.min(1, (S.wounds[i] || 0) + (dd < 4 ? 1 : 0.5)); S.stress[i] = Math.min(3, S.stress[i] + 0.3); }
    else if (kind === "firebolt" && !mine) { // a gout of flame: it kills at the heart of it and burns at the edge
      const f = 1 - dd / Math.max(1, R);
      if (S.wounds) S.wounds[i] = Math.min(1, (S.wounds[i] || 0) + (dd < R * 0.4 ? 1 : 0.45 * f + 0.2));
      S.heat[i] = (S.heat[i] || 0) + 2.5 * f; S.stress[i] = Math.min(3, S.stress[i] + 0.45 * f + 0.15);
    }
    else if (kind === "frost" && !mine) { S.fatigue[i] = Math.min(1, S.fatigue[i] + 0.45); S.heat[i] = (S.heat[i] || 0) - 1.5; S.stress[i] = Math.min(3, S.stress[i] + 0.25); }
    else if (kind === "quake" && !mine) { down(i, 2, 6); S.stress[i] = Math.min(3, S.stress[i] + 0.35); }
  }
  w.events.push({ t: w.tick, kind: "spell", spell: kind, team, x, y });
  return true;
}

// ════════════════════════════════════════════════════════════════ the Ardennes: what a commander can call down
// These are not spells and they do not behave like them. A blessing lands once; a BARRAGE walks across the ground
// for twenty seconds, a MINE FIELD waits for whoever crosses it, SMOKE sits there blinding both sides. So they are
// kept in `w.pow` — a list of standing effects ticked by `powerSystem` — rather than applied the instant they are
// cast. Everything that bursts goes through the same `blast` the mortars use (js/sim/ballistics.js), so a shell
// called down by a commander kills exactly as a shell fired by a crew does, friend and foe alike.
const ARDENNES_POWERS = new Set(["barrage", "smoke", "airstrike", "mines", "supply", "recon"]);
const HE = { barrage: { blast: 22, blastE: 3600 }, airstrike: { blast: 13, blastE: 2400 }, mines: { blast: 5.5, blastE: 1200 } };
function ardennes(w, team, kind, x, y, Sp) {
  const P = (w.pow ||= []), t = w.time, R = Sp.r || 0;
  if (kind === "barrage") P.push({ kind, team, x, y, r: R, until: t + 20, next: t, every: 0.7 });
  else if (kind === "airstrike") { // one pass down the line the commander drew, from his own side toward the mark
    const hq = w.teams?.[team]?.hq, a = hq ? Math.atan2(y - hq.y, x - hq.x) : 0;
    P.push({ kind, team, x, y, r: R, ux: Math.cos(a), uy: Math.sin(a), until: t + 2.2, next: t, every: 0.1, run: -R });
  } else if (kind === "mines") P.push({ kind, team, x, y, r: R, until: t + 900, next: t, every: 0.25, left: 8 });
  else if (kind === "smoke") P.push({ kind, team, x, y, r: R, until: t + 120 });
  else if (kind === "recon") P.push({ kind, team, until: t + 30 });
  else if (kind === "supply") { // ammunition and water: they re-arm and get their wind back
    const S = w.S;
    for (let i = 0; i < S.n; i++) {
      if (!S.alive[i] || S.team[i] !== team) continue;
      const d2 = (S.x[i] - x) ** 2 + (S.y[i] - y) ** 2; if (d2 > R * R) continue;
      const A = ARM_BY_ID[S.arm[i]]; if (A?.ammo) S.ammo[i] = A.ammo;
      S.fatigue[i] = 0; S.stress[i] = Math.max(0, S.stress[i] - 0.15);
    }
  }
  ensurePowers(w);
}
// smoke a sight-line crosses (js/sim/vision.js asks): the thickest it passes through, 0 when it passes none
export function smokeOn(w, x0, y0, x1, y1) {
  const P = w.pow; if (!P?.length) return 0;
  let worst = 0;
  for (const e of P) {
    if (e.kind !== "smoke" || w.time > e.until) continue;
    // distance from the puff's centre to the segment
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
    const u = L2 > 0 ? Math.max(0, Math.min(1, ((e.x - x0) * dx + (e.y - y0) * dy) / L2)) : 0;
    const d = Math.hypot(e.x - (x0 + dx * u), e.y - (y0 + dy * u));
    if (d < e.r) worst = Math.max(worst, 1 - d / e.r);
  }
  return worst;
}
export const reconOn = (w, team) => !!w.pow?.some((e) => e.kind === "recon" && e.team === team && w.time <= e.until);

function ensurePowers(w) {
  if (w._powSys) return; w._powSys = true;
  w.systems.push(powerSystem);
}
function powerSystem(w) {
  const P = w.pow; if (!P?.length) return;
  const t = w.time, cs = w.cs;
  for (let k = P.length - 1; k >= 0; k--) {
    const e = P[k];
    if (t > e.until || (e.left !== undefined && e.left <= 0)) { P.splice(k, 1); continue; }
    if (e.next === undefined || t < e.next) continue;
    e.next = t + e.every;
    if (e.kind === "barrage") { // called fire WALKS: each salvo falls somewhere inside the mark, not on one spot
      const h = Math.imul(k ^ w.tick, 2246822519) >>> 0, a = (h % 1000) / 1000 * Math.PI * 2, rr = ((h >>> 10) % 1000) / 1000;
      shell(w, cs, e, e.x + Math.cos(a) * e.r * Math.sqrt(rr), e.y + Math.sin(a) * e.r * Math.sqrt(rr), HE.barrage);
    } else if (e.kind === "airstrike") { // the aircraft runs down the line, strafing as it goes
      e.run += e.r * 0.18;
      shell(w, cs, e, e.x + e.ux * e.run, e.y + e.uy * e.run, HE.airstrike);
    } else if (e.kind === "mines") { // it waits. Whoever crosses it pays, and there are only so many of them.
      const S = w.S;
      for (let i = 0; i < S.n && e.left > 0; i++) {
        if (!S.alive[i] || !isFoe(w, team0(e), S.team[i]) || S.posture[i] !== 0) continue;
        const dx = S.x[i] - e.x, dy = S.y[i] - e.y; if (dx * dx + dy * dy > e.r * e.r) continue;
        if (Math.hypot(S.vx[i], S.vy[i]) < 0.4) continue;      // a man standing still does not set one off
        e.left--; shell(w, cs, e, S.x[i], S.y[i], HE.mines);
      }
    }
  }
}
const team0 = (e) => e.team;
function shell(w, cs, e, x, y, M) {
  if (!cs) return;
  BAL_BLAST(w, cs, { x, y, ux: 0, uy: -1, ang: 1.2, key: e.kind, by: -1, team: e.team }, M);
  w.events.push({ t: w.tick, kind: "spell", spell: e.kind, team: e.team, x, y, burst: 1 });
}

// a bot's (or an absent player's) loadout of a given worth: ops, skills and spells bought as a player of that standing would
export function botLoadout(rating, rng = Math.random, era = DEFAULT_ERA) {
  const lvl = Math.max(0, Math.min(1, (rating - 950) / 500)), keys = Object.keys(skillsOf(era)), ops = Object.keys(opsOf(era)), sp = Object.keys(spellsFor(era));
  const pick = (arr, n) => { const a = arr.slice(), out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(rng() * a.length), 1)[0]); return out; };
  const skills = pick(keys, Math.round(lvl * SKILL_SLOTS)), opsN = Math.round(lvl * OPS_MAX), spells = {};
  for (const k of pick(sp, Math.round(1 + lvl * 3))) spells[k] = 1 + Math.floor(rng() * (1 + lvl * 2));
  return { skills, ops: pick(ops, opsN), spells };
}
export function opsCompany(key, rng = Math.random, era = DEFAULT_ERA) { const O = opsOf(era)[key]; return O ? { id: `op-${key}`, arm: O.arm, n: O.n, name: O.name, pos: O.pos, drill: O.drill, stakes: !!O.stakes, op: key, cap: Math.floor(rng() * 2 ** 30) } : null; }

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
// By TRAIT, not by name (js/sim/arms.js): a bot of 1944 must read a half-track and a machine-gun team the way a
// bot of the Vale reads hobelars and archers, without either of them knowing the other's roster.
const isHorse = (a) => !!ARMS[a]?.mounted || ARMS[a]?.role === "vehicle", isBow = (a) => ARMS[a]?.role === "missile";
// the temper that answers a host: horse is met by a stubborn line, bows by a quick close, a mass of foot from the flanks
export function counterTemper(cos) {
  const men = coMen(cos) || 1, horse = (cos || []).filter((c) => isHorse(c.arm)).reduce((s, c) => s + c.n, 0) / men, bow = (cos || []).filter((c) => isBow(c.arm)).reduce((s, c) => s + c.n, 0) / men;
  return horse > 0.2 ? "defensive" : bow > 0.35 ? "aggressive" : "flanker";
}
export const BOT_TEMPERS = ["defensive", "aggressive", "flanker", "skirmish", "ambusher", "shock", "inspiring"];
export function botTemper(me, rating, rng = Math.random) {
  return rng() < witsOf(rating) * 0.6 ? counterTemper(me.companies) : BOT_TEMPERS[Math.floor(rng() * BOT_TEMPERS.length)];
}
export function botHost(me, rating, temper, rng = Math.random, era = me?.era || DEFAULT_ERA) {
  const mine = me.companies || [], line = mine.filter((c) => !c.op), myOps = mine.filter((c) => c.op);
  const pick = (arr, n) => { const a = arr.slice(), out = []; while (out.length < n && a.length) out.push(a.splice(Math.floor(rng() * a.length), 1)[0]); return out; };
  const lead = Math.max(-0.08, Math.min(0.08, (rating - (me.rating ?? rating)) / 1600));
  const target = Math.max(120, coValue(mine) * (0.93 + rng() * 0.24) * (1 + lead));
  const ops = pick(Object.keys(opsOf(era)), myOps.length).map((k) => opsCompany(k, rng, era));
  const lineMen = coMen(line), dbar = lineMen ? line.reduce((s, c) => s + (c.drill || 0) * c.n, 0) / lineMen : 0;
  const lineTarget = Math.max(60, target - coValue(ops)), wageOf = (a) => TROOPS[a].wage;
  // the line's men, by the temper's mix, worth the line's share before drill
  const army = composeArmy(lineTarget / (1 + 0.35 * dbar), temper, rng, era);
  const men = () => army.reduce((s, [, n]) => s + n, 0), pence = () => army.reduce((s, [a, n]) => s + wageOf(a) * n, 0);
  const want = Math.max(BUY_STEP * 4, Math.min(ARMY_MAX - coMen(ops), (coMen(mine) - coMen(ops)) * (0.94 + rng() * 0.12)));
  // …as many men as the player's line (±12%): dear men traded for cheap ones (or the reverse) at the same wage
  const armOf = (a) => army.find((e) => e[0] === a) || (army.push([a, 0]), army[army.length - 1]);
  // …and when the mix has nothing cheap or nothing dear enough to trade with, the war's own cheapest and dearest
  // troops stand in (the Vale's levy and men-at-arms, 1944's riflemen and a tank).
  const ladder = armsFor(era).filter((a) => TROOPS[a]).sort((a, b) => wageOf(a) - wageOf(b));
  const pool = Object.keys(mixOf(era, temper)).concat([ladder[0], ladder[ladder.length - 1]]).filter(Boolean).sort((a, b) => wageOf(a) - wageOf(b));
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
  const useful = Object.keys(skillsOf(era)).filter((k) => (k !== "quartermaster" && k !== "stakes" || bows >= 0.2) && (k !== "eagle" || mine.some((c) => ["ambush", "hidden"].includes(c.pos))) && (k !== "drillmaster" || all.some((c) => (c.drill || 0) < 2)));
  const nSk = Math.min(SKILL_SLOTS, (me.skills || []).length), skills = pick(useful, nSk); skills.push(...pick(Object.keys(skillsOf(era)).filter((k) => !skills.includes(k)), nSk - skills.length));
  const myCharges = Object.values(me.spells || {}).reduce((s, n) => s + (n || 0), 0), wits = witsOf(rating);
  let charges = Math.max(Math.round(wits * 2), myCharges + Math.floor(rng() * 3) - 1 + (lead > 0 && rng() < wits ? 1 : 0));
  const spells = {}, kinds = Object.keys(spellsFor(era));
  for (let k = 0; k < 200 && charges > 0; k++) { const s = kinds[Math.floor(rng() * kinds.length)]; if ((spells[s] || 0) >= SPELL_MAX) continue; spells[s] = (spells[s] || 0) + 1; charges--; }
  return { companies: cos.concat(ops), skills, spells, wits };
}
// how far a host is from another's worth (a recorded host is matched near the player's own)
export const valueGap = (a, b) => Math.abs(coValue(a) - coValue(b)) / Math.max(1, coValue(b));

// a lord who casts his charges on his own (a bot's, or an absent player's host): on the foe's thickest press, on his own
// frightened or blown men. A cleverer lord (wits 0…1, from his rating) looks for his moment twice as often.
//   aiCaster(charges, team, wits, era) → (w) => void   (a system: call it every tick after the trumpets)
export function aiCaster(charges, team, wits = 0, era = DEFAULT_ERA) {
  const fc = { ...(charges || {}) }, every = Math.round(300 - 150 * Math.max(0, Math.min(1, wits)));
  // What each power is FOR, read off the era's own table (js/sim/eras.js `use`), so a lord of 1944 calls a barrage
  // where a lord of the Vale calls the lightning. It used to name the Vale's six powers outright, which meant a bot
  // of any other war stood through the whole battle with its charges in its pocket.
  const POW = spellsFor(era), dear = (a, b) => (POW[b]?.cost || 0) - (POW[a]?.cost || 0);
  const forUse = (u) => Object.keys(fc).filter((k) => POW[k]?.use === u).sort(dear);
  return (w) => {
    if (w.tick % every !== Math.floor(every / 2)) return;
    const us = [...w.units.values()].filter((u) => !u.isWorkers && u.members.length && u.battleHost);
    const mine = us.filter((u) => u.team === team), yours = us.filter((u) => u.team !== team);
    const S = w.S, avg = (u, f) => u.members.reduce((s, i) => s + (S[f][i] || 0), 0) / u.members.length;
    const fight = yours.filter((u) => mine.some((v) => Math.hypot(u.ax - v.ax, u.ay - v.ay) < 60)).sort((a, b) => b.members.length - a.members.length)[0];
    const scared = mine.slice().sort((a, b) => avg(b, "stress") - avg(a, "stress"))[0], blown = mine.slice().sort((a, b) => avg(b, "fatigue") - avg(a, "fatigue"))[0];
    const cast = (k, u) => { if (!k || !(fc[k] > 0) || !u) return false; fc[k]--; castRanked(w, team, k, u.ax, u.ay, era); return true; };
    const any = (u, unit) => forUse(u).some((k) => cast(k, unit));
    // the heaviest thing he has on the press first, then the men nearest to breaking, then the blown, then the hurt
    any("foe", fight)
      || (scared && avg(scared, "stress") > 0.6 && any("scared", scared))
      || (blown && avg(blown, "fatigue") > 0.5 && any("blown", blown))
      || any("wounded", scared);
  };
}

// ════════════════════════════════════════════════════════════════ the muster: a fair field between live lords
// The owner, 2026-10-17: "once you get a big army you are invincible to other live players". Bots are built to the
// player's own host and a ghost is matched within 20% of his worth, but two live lords brought everything they owned,
// so a season's spoils — not the day's generalship — decided the battle.
// Now a live battle is fought at a MUSTER: a budget in pence a day that BOTH hosts are drawn to, the lesser of the two
// stables, so the poorer lord fields everything he has. Each lord brings as much of his own
// host as the muster buys — drill, special companies and all — and the rest waits in camp. Because coValue prices a
// drilled man dearer, an elite host fields fewer men for the same muster: the veteran's edge is quality and knowing
// how to use it, not mass. The commander's skills and his spell charges are levelled to the poorer lord's the same way
// (as a bot's already were).
export const OPS_SHARE = 0.4; // a special company may not eat more than this much of a muster
// pence a day for one man of a company, drill and all
const perMan = (c) => (TROOPS[c.arm]?.wage || 0) * (1 + 0.35 * (c.drill || 0));
// the muster two stables meet at: the lesser of them, so the poorer lord fields his whole host and the richer draws to it
export const musterOf = (aCos, bCos) => Math.max(1, Math.floor(Math.min(coValue(aCos), coValue(bCos))));

// `cos` drawn down to `budget` pence, keeping the host's shape: every company shrinks by the same share, then men are
// taken off the dearest (or added to the cheapest) until it sits just under the muster. Special companies go whole or
// stay home — fifteen foresters are fifteen foresters. → { companies (fielded), home ([{ arm, n }] left in camp) }
export function muster(cos, budget, opsMax = OPS_MAX) {
  const all = (cos || []).filter((c) => c && c.n > 0).map((c) => ({ ...c }));
  if (!all.length) return { companies: [], home: [] };
  const fielded = (out) => { const h = []; for (const c of all) { const f = out.find((q) => q.id === c.id); const n = c.n - (f ? f.n : 0); if (n > 0) h.push({ arm: c.arm, n, name: c.name || null }); } return h; };
  if (coValue(all) <= budget) return { companies: all, home: [] };
  const line = all.filter((c) => !c.op);
  // the special companies: the cheapest kept, and no more of them than the muster (or the poorer lord) allows
  const ops = all.filter((c) => c.op).sort((a, b) => coValue([a]) - coValue([b]));
  const keepOps = ops.slice(0, Math.max(0, opsMax));
  while (keepOps.length && coValue(keepOps) > budget * OPS_SHARE) keepOps.pop();
  const out = line.map((c) => ({ ...c }));
  const lineBudget = Math.max(0, budget - coValue(keepOps)), v0 = coValue(out);
  const f = v0 > 0 ? Math.min(1, lineBudget / v0) : 0;
  for (const c of out) c.n = Math.max(0, Math.round(c.n * f));
  for (let k = 0; k < 20000; k++) {
    const v = coValue(out) + coValue(keepOps);
    if (v > budget) { const c = out.filter((q) => q.n > 0).sort((a, b) => perMan(b) - perMan(a))[0]; if (!c) break; c.n--; }
    else { // room left: the cheapest men fill it, never past the arm's own ceiling or the host's original company
      const c = out.filter((q) => q.n < Math.min(TROOPS[q.arm]?.max ?? 1e9, line.find((o) => o.id === q.id)?.n ?? 1e9)).sort((a, b) => perMan(a) - perMan(b))[0];
      if (!c || v + perMan(c) > budget) break; c.n++;
    }
  }
  const kept = out.filter((c) => c.n > 0).concat(keepOps);
  return { companies: kept, home: fielded(kept) };
}

// a lord's host as he takes the field against `foe`, both drawn to the same muster: his companies, and his commander's
// skills and charges levelled to the poorer lord's (the richer keeps the ones he listed first)
export function musterSide(me, foe, budget) {
  const myOps = (me.companies || []).filter((c) => c.op).length, foeOps = (foe.companies || []).filter((c) => c.op).length;
  const { companies, home } = muster(me.companies, budget, Math.min(myOps, foeOps, OPS_MAX));
  const nSk = Math.min((me.skills || []).length, (foe.skills || []).length);
  const skills = (me.skills || []).slice(0, nSk);
  const charges = (q) => Object.values(q.spells || {}).reduce((s, n) => s + (n || 0), 0);
  let left = Math.min(charges(me), charges(foe)); const spells = {};
  for (const [k, n] of Object.entries(me.spells || {})) { if (left <= 0) break; const take = Math.min(n || 0, left); if (take > 0) { spells[k] = take; left -= take; } }
  return { companies, home, skills, spells, value: coValue(companies) };
}

// Two hosts of unequal worth on one field (a muster both could not meet, or a lord who chose to come heavy): the
// heavier paid for its size on the road. It marched in the longer column and comes up footsore, and the lighter host —
// first on the ground — has had time to cut and drive its stakes.
//   → { heavy: 0|1|-1 (neither), footsore (0…0.35 starting fatigue on the heavy host), stakes: true if the light host cuts them }
export const HANDICAP_FROM = 1.06; // worth this much over the other before the road tells
export function handicap(v0, v1) {
  const lo = Math.min(v0, v1), hi = Math.max(v0, v1);
  if (!(lo > 0) || hi / lo < HANDICAP_FROM) return { heavy: -1, footsore: 0, stakes: false };
  const over = hi / lo - 1;
  return { heavy: v0 > v1 ? 0 : 1, footsore: Math.max(0, Math.min(0.35, over * 1.2)), stakes: over >= 0.12 };
}

// ════════════════════════════════════════════════════════════════ three tiers, points, and what spoils are for
// The owner, 2026-10-18: "Spoils get you access to more units, but not more units. There are three combat tiers,
// Skirmish, Assault, and War. They each have different point values, and all the units have their own point values.
// You can build an army list for each one."
//
// This is the answer to the problem the muster was a clamp for. Ranked priced a host in pence a day and let spoils
// BUY MEN, so a season's spoils — not the day's generalship — decided a battle, and the patch was to drag both lords
// down to the lesser stable. The tiers remove the pull instead of fighting it: both lords build to the SAME budget,
// because the budget is the tier and not the stable. Nothing a lord wins can make his host bigger than his
// opponent's. What he wins is CHOICE.
//
// A unit's point cost is its wage per man — the number the whole balance of the game is already written in, and
// already tested (tools/arm-duel.mjs, tools/battle-mc.mjs). The tiers are the pitched battle's own budgets
// (js/sim/battlefield.js BUDGETS), so every number under them is balanced too.
//
// Everything that goes onto the field is paid for in points: men, their drill (coValue already prices a drilled man
// dearer), stakes, special companies, spell charges. Spoils are spent on ACCESS — which troop types a lord may
// field at all, how well drilled, which special companies, which spells, which skills. docs/ranked-tiers.md.
export const TIERS = {
  skirmish: { key: "skirmish", name: "Skirmish", pts: 720, note: "A raid, a bridge, an outpost — a few score men a side." },
  assault: { key: "assault", name: "Assault", pts: 1440, note: "A lord's retinue and his shire." },
  war: { key: "war", name: "War", pts: 2400, note: "A king's host — as many men as the field will hold." },
};
export const TIER_KEYS = Object.keys(TIERS);
export const DEFAULT_TIER = "assault";
export const tierOf = (k) => TIERS[k] || TIERS[DEFAULT_TIER];
export const tierPts = (k) => tierOf(k).pts;

// points per man (the arm's wage), and what the extras on a company cost in points
export const ptsOf = (arm) => TROOPS[arm]?.wage || 0;
export const armName = (arm) => ARMS[arm]?.name || arm;
export const TROOPS_MAX = (arm) => TROOPS[arm]?.max ?? 0;   // the most of one arm a host may field
export const TROOPS_STEP = (arm) => TROOPS[arm]?.step ?? BUY_STEP;   // a company of them at its natural strength
export const STAKES_PTS = 0.08;   // × the company's points: sharpened stakes planted before them
export const SPELL_PTS = 55;      // a charge of one power carried into the battle
export const OPS_PTS = 1.25;      // × a special company's men: they are picked men, and they are placed where you want

// what one company costs the list (men × their drill, plus its stakes), and the whole list
export const coPts = (c) => {
  if (!c || !TROOPS[c.arm]) return 0;
  const men = ptsOf(c.arm) * (c.n || 0) * (1 + 0.35 * (c.drill || 0)) * (c.op ? OPS_PTS : 1);
  return men * (c.stakes ? 1 + STAKES_PTS : 1);
};
export const chargesOf = (spells) => Object.values(spells || {}).reduce((s, n) => s + (n || 0), 0);
export const listPts = (L) => Math.round((L?.companies || []).reduce((s, c) => s + coPts(c), 0) + chargesOf(L?.spells) * SPELL_PTS);
export const listMen = (L) => coMen(L?.companies);

// ── what spoils unlock. A new lord musters levies, spearmen and longbowmen; everything else is earned. The order is
// the order a lord would learn it: his own shire's foot, then the town's, then men who need gear and training, then
// horse, then the men he must pay a wage worth having.
export const STARTER_ARMS = starterArmsOf(DEFAULT_ERA);
export const ARM_UNLOCK = unlockOf(DEFAULT_ERA);
export const DRILL_UNLOCK = [0, 150, 400];       // spoils to be ALLOWED Raw / Veteran / Elite (the points are per man)
// A lord's own ladder: `p.era` says which war's standing this is, so these answer for the Vale, the Marches or
// 1944 without the caller knowing which.
export const unlockedArms = (p) => new Set([...starterArmsOf(p), ...((p && p.unlocked) || [])]);
export const armIsOpen = (p, arm) => unlockOf(p)[arm] === 0 || unlockedArms(p).has(arm);
// every kind of thing spoils buy, with its price → { kind, key, name, cost, has }
export function unlockables(p) {
  const have = new Set((p && p.unlocked) || []), out = [];
  for (const [arm, cost] of Object.entries(unlockOf(p))) if (cost > 0) out.push({ kind: "arm", key: arm, name: armName(arm), cost, has: have.has(arm), note: TROOPS[arm]?.note || "" });
  DRILL_UNLOCK.forEach((cost, i) => { if (cost > 0) out.push({ kind: "drill", key: String(i), name: `${DRILL[i].name} companies`, cost, has: have.has(`drill:${i}`), note: `Your companies may be mustered as ${DRILL[i].name}. The points are per man.` }); });
  for (const [k, O] of Object.entries(opsOf(p))) out.push({ kind: "ops", key: k, name: O.name, cost: O.cost, has: have.has(`ops:${k}`), note: O.desc });
  for (const [k, S] of Object.entries(skillsOf(p))) out.push({ kind: "skill", key: k, name: S.name, cost: S.cost, has: have.has(`skill:${k}`), note: S.desc });
  for (const [k, S] of Object.entries(spellsFor(p?.era || DEFAULT_ERA))) out.push({ kind: "spell", key: k, name: S.name, cost: 120, has: have.has(`spell:${k}`), note: S.desc });
  return out;
}
export const unlockKey = (kind, key) => (kind === "arm" ? key : `${kind}:${key}`);
export const drillOpen = (p, d) => d <= 0 || unlockedArms(p).has(`drill:${d}`);

// ── a list a lord keeps for a tier: { companies, skills, spells }. `tidyList` is the one gate both the camp and the
// field go through — it drops what he has not unlocked, clamps what he has, and then takes men off the dearest
// company until the list fits the tier. It never ADDS: a list under its tier is his own business.
export function tidyList(L, p, tier) {
  const budget = tierPts(tier), open = unlockedArms(p);
  const cos = (Array.isArray(L?.companies) ? L.companies : [])
    .filter((c) => c && TROOPS[c.arm] && Number.isFinite(c.n) && c.n > 0)
    .filter((c) => (c.op ? open.has(`ops:${c.op}`) : unlockOf(p)[c.arm] === 0 || open.has(c.arm)))
    .map((c) => ({ ...c, n: Math.min(Math.floor(c.n), TROOPS[c.arm].max), drill: drillOpen(p, c.drill || 0) ? (c.drill || 0) : 0, stakes: !!c.stakes && stakeArmsOf(p).includes(c.arm) }));
  const ops = cos.filter((c) => c.op);
  while (ops.length > OPS_MAX) { const c = ops.pop(); cos.splice(cos.indexOf(c), 1); }
  const skills = (Array.isArray(L?.skills) ? L.skills : []).filter((k) => skillsOf(p)[k] && open.has(`skill:${k}`)).slice(0, SKILL_SLOTS);
  const spells = {}, POW = spellsFor(p?.era || DEFAULT_ERA);
  for (const [k, n] of Object.entries(L?.spells || {})) if (POW[k] && open.has(`spell:${k}`) && n > 0) spells[k] = Math.min(Math.floor(n), SPELL_MAX);
  return trimToPts({ companies: cos, skills, spells }, budget);
}

// Just the POINTS clamp, with no question of what anyone has unlocked — for a bot, which has no standing and no
// unlocks but must still meet a lord at his tier exactly.
//
// This exists because `muster` was doing the job and `muster` prices a host with `coValue`, which counts men and
// their drill and nothing else. The tier is measured with `listPts`, which also charges a quarter more for picked
// men and eight per cent for stakes — so a bot that drew a special company came to the field at 1,520 points
// against a budget of 1,440 and nothing noticed. (Found by a check that failed one run in five; the first guess
// was that bots were landing UNDER the budget, and the opposite was true.)
export function trimToPts(L, budget) {
  const out = { companies: (L?.companies || []).map((c) => ({ ...c })), skills: [...(L?.skills || [])], spells: { ...(L?.spells || {}) } };
  // charges go first (they are the cheapest thing to give up), then men off the dearest company
  for (let k = 0; k < 40000 && listPts(out) > budget; k++) {
    const keys = Object.keys(out.spells);
    if (keys.length) { const q = keys[keys.length - 1]; if (--out.spells[q] <= 0) delete out.spells[q]; continue; }
    const c = out.companies.filter((q) => q.n > 0).sort((a, b) => ptsOf(b.arm) * (1 + 0.35 * (b.drill || 0)) - ptsOf(a.arm) * (1 + 0.35 * (a.drill || 0)))[0];
    if (!c) break;
    c.n -= c.op ? c.n : 1;    // a special company goes whole or stays home: fifteen foresters are fifteen foresters
  }
  out.companies = out.companies.filter((c) => c.n > 0);
  return out;
}
// why a list may not take the field (the camp shows it; the server refuses it) → [] when it is good
export function listFaults(L, p, tier) {
  const why = [], budget = tierPts(tier), open = unlockedArms(p);
  const cos = L?.companies || [];
  if (!coMen(cos)) why.push("No men in the list.");
  if (listPts(L) > budget) why.push(`${listPts(L)} points of ${budget}: ${listPts(L) - budget} over.`);
  if (coMen(cos) > ARMY_MAX) why.push(`${coMen(cos)} men — the field holds ${ARMY_MAX}.`);
  for (const c of cos) {
    if (!TROOPS[c.arm]) { why.push(`${c.arm}: no such troop.`); continue; }
    if (!(unlockOf(p)[c.arm] === 0 || open.has(c.arm))) why.push(`${armName(c.arm)} are not yours to muster yet.`);
    if (!drillOpen(p, c.drill || 0)) why.push(`${DRILL[c.drill].name} companies are not yours to muster yet.`);
  }
  if (cos.filter((c) => c.op).length > OPS_MAX) why.push(`At most ${OPS_MAX} special companies.`);
  return why;
}
// ── Filling a tier. THIS IS THE PART THAT DECIDES WHETHER A NEW LORD HAS A CHANCE. Under the old economy a lord
// fielded what his spoils had bought, so a starting host of 160 pence was simply a small host. Under the tiers both
// lords build to the same budget — so a new lord who brings his 90 starting men to a 720-point Skirmish meets four
// hundred, and the fairness the tiers exist for is gone. His starting list is therefore BUILT TO THE TIER out of
// the three arms every lord has: numbers are the one thing he is never short of. What he lacks is choice.
export function fillList(L, p, tier, mix = fillMixOf(p)) {
  const out = { companies: (L?.companies || []).map((c) => ({ ...c })), skills: [...(L?.skills || [])], spells: { ...(L?.spells || {}) } };
  const budget = tierPts(tier), open = unlockedArms(p);
  const arms = Object.keys(mix).filter((a) => TROOPS[a] && (unlockOf(p)[a] === 0 || open.has(a)));
  if (!arms.length) return out;
  const want = Object.fromEntries(arms.map((a) => [a, (mix[a] || 0) * budget]));
  for (const a of arms) {
    const have = out.companies.find((c) => c.arm === a && !c.op);
    // …and never more men than the field holds. The Marches fills a War out of goblins at a penny a head, so the
    // shares alone came to 908 men against a field of 900 and a brand-new lord's list was illegal on sight.
    const room = ARMY_MAX - coMen(out.companies) + (have?.n || 0);
    const n = Math.min(TROOPS[a].max, room, Math.floor(want[a] / ptsOf(a)));
    if (n <= 0) continue;
    if (have) have.n = Math.max(have.n, n); else out.companies.push(companiesFrom([[a, n]])[0]);
  }
  // then up to the budget a man at a time with the cheapest arm, and back down if the rounding overshot
  for (let k = 0; k < 40000; k++) {
    const left = budget - listPts(out);
    const c = out.companies.filter((q) => !q.op && q.n < TROOPS[q.arm].max && coMen(out.companies) < ARMY_MAX).sort((a, b) => ptsOf(a.arm) - ptsOf(b.arm))[0];
    if (!c || left < ptsOf(c.arm)) break;
    c.n++;
  }
  return tidyList(out, p, tier);
}
// a lord's three lists. From the host he already had where there is one (muster draws each tier's share, so his own
// shape survives), and topped up to the tier so he never takes the field short.
export function listsFrom(companies, p) {
  const out = {};
  for (const t of TIER_KEYS) {
    const drawn = tidyList({ companies: muster(companies, tierPts(t)).companies, skills: p?.skills || [], spells: p?.spells || {} }, p, t);
    out[t] = listPts(drawn) >= tierPts(t) * 0.9 ? drawn : fillList(drawn, p, t);
  }
  return out;
}
