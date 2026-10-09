// Legends: individual soldiers who do something statistically extreme get noticed.
// Each feat adds its improbability (−ln p) to the man's "saga"; past a threshold the player is
// offered a paid promotion. Promoted men pick abilities; at rank 3 they can become COMMANDERS,
// whose tactical disposition grows out of what they actually did to become famous.
import { S_FIGHT, S_FLEE, clamp } from "./soldiers.js";
import { ARM_BY_ID } from "./arms.js";
import { neighbours } from "./world.js";

export const SAGA_THRESHOLD = [6, 13, 22]; // rank 1, 2, 3 (commander)
export const PROMO_COST = [40, 120, 300];  // gold

export const ABILITIES = {
  iron_will:    { name: "Iron Will", desc: "Never panics first; men beside him steady (stress decay ×2 within 8 m).", tag: "defensive" },
  shieldwall:   { name: "Shield Brother", desc: "Covers his neighbours: blows against men beside him −20%.", tag: "defensive" },
  berserker:    { name: "Red Mist", desc: "+40% blows landed while wounded; ignores fatigue for 60 s once per battle.", tag: "aggressive" },
  duelist:      { name: "Duelist", desc: "+25% skill in single combat; seeks out enemy champions.", tag: "aggressive" },
  hawkeye:      { name: "Hawk's Eye", desc: "+30% missile accuracy; sees 30% further.", tag: "skirmish" },
  pathfinder:   { name: "Pathfinder", desc: "Unit ignores 50% of rough-going penalties; finds fords.", tag: "ambusher" },
  rally:        { name: "Rallying Cry", desc: "Once per battle, pulls fleeing men within 40 m back to the colours.", tag: "inspiring" },
  horsemaster:  { name: "Horsemaster", desc: "Charges from this unit keep cohesion; +20% charge impact.", tag: "shock" },
  hunter:       { name: "Hunter's Patience", desc: "Unit stays unseen in cover until it strikes (+50% concealment).", tag: "ambusher" },
  quartermaster:{ name: "Quartermaster", desc: "Unit fatigue recovers 40% faster; supply lasts longer.", tag: "defensive" },
  eye_for_ground:{ name: "Eye for Ground", desc: "Reads terrain: +20% to all height/cover bonuses for his unit.", tag: "defensive" },
  flanker:      { name: "Flanker's Instinct", desc: "Flank/rear attacks by his unit +30%.", tag: "flanker" },
};

export const DISPOSITIONS = {
  defensive: { name: "Stubborn Defender", prefers: ["hold", "fortify"], seeksHighGround: 1.0, aggression: 0.2, flank: 0.2 },
  aggressive:{ name: "Hotspur", prefers: ["assault"], seeksHighGround: 0.3, aggression: 0.95, flank: 0.3 },
  flanker:   { name: "Flanker", prefers: ["assault"], seeksHighGround: 0.4, aggression: 0.6, flank: 0.95 },
  skirmish:  { name: "Skirmisher", prefers: ["skirmish"], seeksHighGround: 0.7, aggression: 0.35, flank: 0.6 },
  ambusher:  { name: "Ambusher", prefers: ["ambush"], seeksHighGround: 0.5, aggression: 0.5, flank: 0.7, usesCover: 1 },
  shock:     { name: "Cavalry Captain", prefers: ["assault"], seeksHighGround: 0.2, aggression: 0.85, flank: 0.8 },
  inspiring: { name: "Beloved Captain", prefers: ["hold", "assault"], seeksHighGround: 0.6, aggression: 0.5, flank: 0.4 },
};

// Sagas grow from FEATS: deeds the combat system has judged improbable against a measured reference
// distribution (js/sim/feats.js, docs/combat-research.md §15). A feat adds its improbability −ln p to the
// man's saga; a heroic deed (p ≈ 1e-3, −ln p ≈ 6.9) or two notable ones earn the first promotion offer, so a
// large battle produces a few legends, not dozens. Cutting down runners is never a feat.
export function legendSystem(w) {
  const S = w.S;
  if (!w.sagas) w.sagas = new Map(); // id → { score, feats:[], tags:{}, rank, offered }
  for (const e of w.events) {
    if (e.kind !== "feat" || !S.alive[e.who]) continue;
    feat(w, e.who, -Math.log(Math.max(1e-12, e.p)), `${e.text} (${e.tier}, p≈${e.p.toExponential(0)})`, e.tag);
  }
  for (const [id, sg] of w.sagas) {
    if (!S.alive[id]) { w.sagas.delete(id); continue; }
    const r = sg.rank; const need = SAGA_THRESHOLD[r];
    if (need !== undefined && sg.score >= need && !sg.offered) {
      sg.offered = true;
      w.events.push({ t: w.tick, kind: "legend", who: id, rank: r + 1, team: S.team[id], cost: PROMO_COST[r], feats: sg.feats.slice(-5) });
    }
  }
}

function feat(w, id, score, text, tag) {
  let sg = w.sagas.get(id);
  if (!sg) { sg = { score: 0, feats: [], tags: {}, rank: 0, offered: false }; w.sagas.set(id, sg); }
  sg.score += score;
  if (sg.feats.length < 40) sg.feats.push({ t: w.tick, text });
  if (tag) sg.tags[tag] = (sg.tags[tag] || 0) + score;
}

export function promote(w, id, abilityKeys) {
  const S = w.S, sg = w.sagas.get(id); if (!sg) return false;
  const T = w.teams[S.team[id]]; const cost = PROMO_COST[sg.rank];
  if ((T.store?.gold ?? T.gold) < cost) return false;
  if (T.store) T.store.gold -= cost; else T.gold -= cost;
  sg.rank++; sg.offered = false; S.legend[id] = sg.rank;
  sg.abilities = [...(sg.abilities || []), ...abilityKeys];
  S.skill[id] = clamp(S.skill[id] + 0.08, 0, 1); S.courage[id] = clamp(S.courage[id] + 0.1, 0, 1);
  for (const k of abilityKeys) { const tag = ABILITIES[k]?.tag; if (tag) sg.tags[tag] = (sg.tags[tag] || 0) + 3; }
  if (sg.rank >= 3) sg.disposition = dispositionOf(sg);
  return true;
}

// three choices offered, weighted toward what he actually did
export function abilityChoices(w, id, rng = w.rng) {
  const sg = w.sagas.get(id); const have = new Set(sg?.abilities || []);
  const keys = Object.keys(ABILITIES).filter((k) => !have.has(k));
  const weight = (k) => 1 + (sg?.tags[ABILITIES[k].tag] || 0);
  const out = [];
  while (out.length < 3 && keys.length) {
    const tot = keys.reduce((s, k) => s + weight(k), 0); let r = rng.next() * tot;
    const i = keys.findIndex((k) => (r -= weight(k)) <= 0); out.push(keys.splice(Math.max(0, i), 1)[0]);
  }
  return out;
}

export function dispositionOf(sg) {
  let best = "inspiring", bv = -1;
  for (const [k, v] of Object.entries(sg.tags)) if (DISPOSITIONS[k] && v > bv) { bv = v; best = k; }
  return best;
}

function offAngle(S, a, v) {
  const ang = Math.atan2(S.y[a] - S.y[v], S.x[a] - S.x[v]);
  return Math.abs(((ang - S.facing[v] + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
}

// A name for a man, deterministic from his seed.
const FIRST = ["Aldric", "Bertram", "Cuthbert", "Drogo", "Edric", "Fulk", "Godwin", "Hamo", "Ivo", "Jocelin", "Kenric", "Leofric", "Martin", "Nigel", "Osbert", "Piers", "Ralf", "Simon", "Thurstan", "Walter", "Wystan", "Hugh", "Roger", "Alan", "Geoffrey", "Odo", "Baldwin", "Gilbert"];
const BY = ["of the Marsh", "Ironhand", "the Tall", "Oakheart", "of Harrow", "Longshanks", "the Quiet", "Redbeard", "the Stubborn", "Halfhand", "of the Ford", "Greycloak", "the Younger", "Wolfsbane", "Blackthorn", "the Lucky"];
export const nameOf = (seed) => `${FIRST[seed % FIRST.length]} ${BY[(seed >>> 8) % BY.length]}`;
