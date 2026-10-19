// THE LATE GAME — a borough, a cathedral city and a ducal seat: the great buildings a long-lived house raises after its
// stone walls (js/sim/stages.js stages 4–6; the buildings in js/sim/econ-data.js BUILDINGS; the studies that open some of
// them in js/sim/tech.js). The owner: "there should be a lot more buildings and castles and stuff in the final level of
// progression." Every one of them DOES something the sim already computes — nothing is for show:
//
//   castle tiers   motte & bailey → shell keep (raised ON the motte, which it replaces) → concentric castle.
//                  sack   the keep holds out longer once the enemy is at its gate (logistics.js siegeState): ×0.5 / ×0.3 /
//                         ×0.12 the rate the sack runs at. Best tier only.
//                  homePay castle-guard: retained men at home cost less of their fee (economy.js daily): ×0.85 / ×0.75 /
//                         ×0.6. Best tier only.
//                  order  a lord's strength in stone quietens the vill (unrest target −0.02 / −0.03 / −0.05).
//   guildhall      rents ×1.15 (tolls, fines and the guild's dues), crafts take ×0.85 the days (guild masters), and the
//                  charter's burgesses: incomers ×1.25.
//   mint           the house's own sterling: the wage bill ×0.9 (seigniorage and the moneyer's fee stay at home); the
//                  moneyers strike gold into pennies at 13 d the shilling (RECIPES.mint).
//   hospital       natural deaths ×0.7, starvation ×0.6, and the house's wounded within 700 m mend 0.1 a day.
//   tithe barn     a great stone barn: 80 t of grain kept as in a granary, and a store for sheaves and hay.
//   minster        rents ×1.1 (offerings, pilgrims), incomers ×1.5, order −0.08; its spire is a lookout (sight).
//   college        a third study desk and studies run ×1.25 as fast.
//   tiltyard       squires ready for knighthood in ×0.7 the days; renown: a squire of good family comes to serve every
//                  40 days while it stands (and he is fed); knights are mustered there.
//   ducal palace   room for the household (pop 40), rents ×1.1, order −0.05; knights and men-at-arms mustered there.
//
// Each kind counts ONCE per house (a second guildhall adds nothing), except the castle keys, where the best tier rules.
// The effects fold into js/sim/tech.js mul()/add()/craftMul(), so every place that already reads research reads these
// too. Deterministic, DOM-free; recomputed at most once a tick from the buildings (no state of its own).
import { BUILDINGS } from "./econ-data.js";

export const ESTATE_FX = {
  motte:             { best: { sack: 0.5, homePay: 0.85 }, add: { order: 0.02 } },
  shell_keep:        { best: { sack: 0.3, homePay: 0.75 }, add: { order: 0.03 } },
  concentric_castle: { best: { sack: 0.12, homePay: 0.6 }, add: { order: 0.05 } },
  guildhall:         { mul: { rents: 1.15, craft: 0.85, immigration: 1.25 } },
  mint:              { mul: { wages: 0.9 } },
  hospital:          { mul: { deaths: 0.7, starve: 0.6 }, add: { order: 0.02, mend: 0.1 } },
  cathedral:         { mul: { rents: 1.1, immigration: 1.5 }, add: { order: 0.08 } },
  university:        { mul: { study: 1.25 }, add: { desks: 1 } },
  lists:             { mul: { squire: 0.7 }, add: { renown: 1 } },
  palace:            { mul: { rents: 1.1 }, add: { order: 0.05 } },
};
// one line per kind for the handbook and the building's panel
export const ESTATE_TEXT = {
  motte: "A refuge: the keep holds out twice as long once the enemy is at its gate; castle-guard cuts the fee of men kept at home by 15 %.",
  shell_keep: "Raised on your motte (it replaces it): the keep holds out 3× as long at its gate; castle-guard cuts home fees by 25 %; a little more order.",
  concentric_castle: "Holds out 8× as long at the gate; castle-guard cuts home fees by 40 %; order; its stores keep 40 t of grain.",
  tithe_barn: "Keeps 80 t of grain as dry as a granary, and takes sheaves and hay nearer the fields.",
  guildhall: "Rents and tolls +15 %; every workshop's batch takes 15 % fewer days; burgesses come 25 % more readily.",
  mint: "Wages paid in your own coin: the whole wage bill −10 %; moneyers strike 2 s of gold into 26 d of pennies.",
  hospital: "Deaths −30 %, starvation −40 %, and wounded soldiers within 700 m mend at home (−0.1 wounds a day).",
  cathedral: "Offerings and pilgrims: rents +10 %; families come 50 % more readily; order; its spire sees far.",
  university: "One more study desk (a third beside the Scriptorium's), and every study runs 25 % faster.",
  lists: "Squires fit for knighthood in 30 % fewer days; a young squire comes to serve every 40 days; knights mustered here.",
  palace: "Room for 40 of the household; rents +10 %; order; knights and men-at-arms mustered here.",
};
// a building raised on (and replacing) another: the shell keep on the motte
export const UPGRADES = { shell_keep: "motte" };
const BEST = new Set(["sack", "homePay"]);
const EMPTY = Object.freeze({ mul: Object.freeze({}), add: Object.freeze({}) });

// the effects for every team, rebuilt when the tick or the building count changes (a building finished mid-tick is read from
// the next tick: the same in every run, so determinism holds)
const CACHE = new WeakMap();
export function estateFx(w, team) {
  const bs = w?.buildings; if (!bs) return EMPTY;
  let c = CACHE.get(w);
  if (!c || c.tick !== w.tick || c.n !== bs.length) {
    const seen = new Map();
    for (const b of bs) {
      if (!ESTATE_FX[b.kind] || b.progress < 1 || b.ruin) continue;
      let s = seen.get(b.team); if (!s) seen.set(b.team, (s = new Set()));
      s.add(b.kind);
    }
    const per = new Map();
    for (const [t, kinds] of seen) {
      const fx = { mul: {}, add: {} };
      for (const k of kinds) {
        const D = ESTATE_FX[k];
        for (const [key, v] of Object.entries(D.mul || {})) fx.mul[key] = (fx.mul[key] ?? 1) * v;
        for (const [key, v] of Object.entries(D.best || {})) fx.mul[key] = Math.min(fx.mul[key] ?? 1, v);
        for (const [key, v] of Object.entries(D.add || {})) fx.add[key] = (fx.add[key] ?? 0) + v;
      }
      per.set(t, fx);
    }
    c = { tick: w.tick, n: bs.length, per }; CACHE.set(w, c);
  }
  return c.per.get(team) || EMPTY;
}
export const estateMul = (w, team, key) => estateFx(w, team).mul[key] ?? 1;
export const estateAdd = (w, team, key) => estateFx(w, team).add[key] ?? 0;
void BEST;

// ─────────────────────────────────────────────── where it may go (js/sim/siting.js siteCheck asks first)
const standing = (b) => b.progress >= 1 && !b.ruin;
// why `team` may not raise `kind` at all (a study not learned, one of a kind already, nothing to raise it on) → string or null
export function estateWhy(w, team, kind) {
  const def = BUILDINGS[kind]; if (!def) return null;
  if (def.tech && !w.teams?.[team]?.tech?.done?.[def.tech]) return `it needs the study ${def.techName || def.tech.replace(/_/g, " ")}`;
  if (def.unique) {
    const same = new Set([kind, ...Object.entries(UPGRADES).filter(([, from]) => from === kind).map(([k]) => k)]);
    const had = w.buildings.find((b) => b.team === team && same.has(b.kind) && !b.ruin);
    if (had) return had.kind === kind ? `your house has its ${def.name.toLowerCase()} already` : `your ${def.name.toLowerCase()} has been rebuilt as the ${BUILDINGS[had.kind].name.toLowerCase()}`;
  }
  if (UPGRADES[kind]) {
    const from = UPGRADES[kind];
    if (!w.buildings.some((b) => b.team === team && b.kind === from && standing(b) && !upgradeOn(w, b))) return `it is raised on your ${BUILDINGS[from].name.toLowerCase()}: build that first`;
  }
  return null;
}
// the site under way that will replace `b` (a shell keep rising on the motte), if any
export const upgradeOn = (w, b) => w.buildings.find((o) => o.upgradeOf === b.id && !o.ruin) || null;
// an upgrade's spot: the house's own standing building it replaces, nearest (x, y) within 40 m → that building or null
export function upgradeBase(w, team, kind, x, y) {
  const from = UPGRADES[kind]; if (!from) return null;
  let best = null, bd = 40;
  for (const b of w.buildings) if (b.team === team && b.kind === from && standing(b) && !upgradeOn(w, b)) { const d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = b; } }
  return best;
}

// ─────────────────────────────────────────────── events
// a site finished (economy.js buildWork): an upgrade takes its base's place — the motte is gone, the shell keep stands on it
export function estateBuilt(w, b) {
  if (b.upgradeOf === undefined) return;
  const i = w.buildings.findIndex((o) => o.id === b.upgradeOf);
  if (i >= 0) { const old = w.buildings[i]; old.replaced = true; w.buildings.splice(i, 1); w.events?.push({ t: w.tick, kind: "upgraded", building: b.id, from: old.kind, what: b.kind, team: b.team }); }
  delete b.upgradeOf;
}

// once an econ day per house (economy.js daily): the hospital mends the wounded; the tiltyard's renown brings squires
const MEND_R = 700, RENOWN_DAYS = 40, SQUIRE_CAP = 12;
export function estateDaily(w, T) {
  const fx = estateFx(w, T.id); if (fx === EMPTY) return;
  const mend = fx.add.mend || 0, S = w.S;
  if (mend > 0 && S?.wounds) {
    const hs = w.buildings.filter((b) => b.team === T.id && (b.kind === "hospital") && standing(b));
    for (const u of w.units.values()) {
      if (u.team !== T.id || u.isWorkers || !u.members.length) continue;
      if (!hs.some((h) => Math.hypot(u.ax - h.x, u.ay - h.y) < MEND_R)) continue;
      for (const id of u.members) if (S.alive[id] && S.wounds[id] > 0) S.wounds[id] = Math.max(0, S.wounds[id] - mend);
    }
  }
  if (fx.add.renown > 0 && !T.besieged && (T.ration ?? 1) > 0.8 && (T.squires || 0) < SQUIRE_CAP) {
    T.renown = (T.renown || 0) + fx.add.renown / RENOWN_DAYS;
    if (T.renown >= 1) { T.renown -= 1; T.squires = (T.squires || 0) + 1; if (T.census) T.census.immigrants = (T.census.immigrants || 0) + 1; w.events?.push({ t: w.tick, kind: "squire-arrives", team: T.id }); }
  }
}
