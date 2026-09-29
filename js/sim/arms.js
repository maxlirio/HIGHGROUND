// Unit arms (troop types). Each arm names its kit (armour table), weapons, shield, missile and horse
// from js/sim/kit.js, plus the population band its men are drawn from (docs/combat-research.md §1).
// Legacy fields (speed, run, spacing, armour, reach, missile, mounted, drill) are kept for the renderer,
// pathing, UI and AI.
import { KIT_ID, WEAPON_ID, WEAPON_BY_ID, SH_NONE, SH_BUCKLER, SH_HEATER, SH_ROUND } from "./kit.js";

// Population bands (§1.1–1.2). skill/nerve/discipline are means; ranges come from the band sd.
export const BANDS = {
  levy:    { mass: [62.5, 4], str: [0.475, 0.07], cp: [170, 11], wp: [15, 1.7], gly: [3.0, 0.3], skill: [0.2, 0.06], nerve: [0.3, 0.1], disc: [0.25, 0.08], blood: 5.0 },
  trained: { mass: [67.5, 4], str: [0.575, 0.07], cp: [200, 11], wp: [19, 1.7], gly: [3.5, 0.3], skill: [0.475, 0.07], nerve: [0.5, 0.1], disc: [0.55, 0.1], blood: 5.0 },
  elite:   { mass: [75, 5], str: [0.75, 0.08], cp: [225, 13], wp: [24, 2.2], gly: [4.0, 0.3], skill: [0.75, 0.08], nerve: [0.7, 0.1], disc: [0.75, 0.1], blood: 5.2 },
};

const W = (k, p = 1) => [WEAPON_ID[k], p];
export const ARMS = {
  villager:  { id: 0, name: "Villagers",     glyph: "villager", speed: 1.3, run: 3.0, spacing: 1.6, armour: 0, reach: 0.8, missile: null, mounted: false, drill: 0.1,
               band: "levy", kit: "cloth", weapons: [W("club")], shields: [[SH_NONE, 1]] },
  levy:      { id: 1, name: "Levy Spearmen", glyph: "spear",    speed: 1.3, run: 3.2, spacing: 0.9, armour: 1, reach: 2.3, missile: null, mounted: false, drill: 0.3,
               band: "levy", kit: "levy", weapons: [W("spear", 0.75), W("club", 0.25)], shields: [[SH_HEATER, 0.3], [SH_NONE, 0.7]], stones: true },
  spearmen:  { id: 2, name: "Spearmen",      glyph: "spear",    speed: 1.3, run: 3.4, spacing: 0.85, armour: 2, reach: 2.3, missile: null, mounted: false, drill: 0.55,
               band: "trained", kit: "spear", weapons: [W("spear")], shields: [[SH_HEATER, 0.8], [SH_NONE, 0.2]], stones: true },
  pikemen:   { id: 3, name: "Pikemen",       glyph: "pike",     speed: 1.2, run: 2.8, spacing: 0.9, armour: 2, reach: 5.0, missile: null, mounted: false, drill: 0.7,
               band: "trained", kit: "pike", weapons: [W("pike")], sidearm: "sword", shields: [[SH_NONE, 1]] },
  menatarms: { id: 4, name: "Men-at-Arms",   glyph: "sword",    speed: 1.25, run: 3.0, spacing: 0.9, armour: 4, reach: 1.2, missile: null, mounted: false, drill: 0.8,
               band: "elite", kit: "maa", weapons: [W("sword", 0.55), W("pollaxe", 0.45)], shields: [[SH_HEATER, 1]], ransom: 2 },
  archers:   { id: 5, name: "Longbowmen",    glyph: "bow",      speed: 1.35, run: 3.6, spacing: 1.5, armour: 1, reach: 0.9, missile: "longbow", mounted: false, drill: 0.6, ammo: 60,
               band: "trained", kit: "archer", weapons: [W("falchion", 0.3), W("sword", 0.3), W("mallet", 0.3), W("axe", 0.1)], shields: [[SH_BUCKLER, 0.4], [SH_NONE, 0.6]], skillMissile: 0.7 },
  crossbow:  { id: 6, name: "Crossbowmen",   glyph: "crossbow", speed: 1.3, run: 3.2, spacing: 1.3, armour: 2, reach: 0.9, missile: "crossbow", mounted: false, drill: 0.55, ammo: 30,
               band: "trained", kit: "xbow", weapons: [W("sword")], shields: [[SH_NONE, 1]], pavise: true, skillMissile: 0.5 },
  hobelars:  { id: 7, name: "Hobelars",      glyph: "lighthorse", speed: 2.0, run: 7.0, spacing: 2.0, armour: 1, reach: 2.3, missile: null, mounted: true, drill: 0.5,
               band: "trained", kit: "light", weapons: [W("spear")], shields: [[SH_ROUND, 0.6], [SH_NONE, 0.4]], horse: 1, rankDepth: 4 },
  knights:   { id: 8, name: "Knights",       glyph: "horse",    speed: 2.0, run: 8.3, spacing: 1.1, armour: 5, reach: 3.7, missile: null, mounted: true, drill: 0.8,
               band: "elite", kit: "maa", weapons: [W("lance")], sidearm: "sword", shields: [[SH_HEATER, 1]], horse: 2, ransom: 3, rankDepth: 3 },
  scouts:    { id: 9, name: "Scouts",        glyph: "eye",      speed: 2.4, run: 7.5, spacing: 3.0, armour: 0, reach: 0.9, missile: null, mounted: true, drill: 0.4,
               band: "trained", kit: "light", weapons: [W("sword")], shields: [[SH_NONE, 1]], horse: 1, rankDepth: 5 },
  militia:   { id: 10, name: "Communal Militia", glyph: "spear",  speed: 1.3, run: 3.3, spacing: 0.85, armour: 2, reach: 1.6, missile: null, mounted: false, drill: 0.55,
               band: "trained", kit: "spear", weapons: [W("goedendag", 0.6), W("pike", 0.4)], shields: [[SH_NONE, 1]], stones: true },
  // Siege engines (js/sim/siege.js, docs/siege-research.md). The unit IS the crew (real men: carpenters and
  // labourers drafted at the siege workshop); the engine is an object in w.siege.engines that moves with the
  // crew's anchor. speed = the engine's pace (pushed, towed or carted); the crew stand round it (crewSlots).
  // eng: footprint [w, l] m. figure: the VAT set the crew are drawn with.
  trebuchet:   { id: 11, name: "Trebuchet",    glyph: "trebuchet", engine: true, figure: "villager", speed: 0.75, run: 1.4, spacing: 1.4, armour: 0, reach: 0.8, missile: null, mounted: false, drill: 0.3,
                 band: "levy", kit: "cloth", weapons: [W("axe", 0.5), W("club", 0.5)], shields: [[SH_NONE, 1]], eng: [7, 10] },
  mangonel:    { id: 12, name: "Mangonel",     glyph: "trebuchet", engine: true, figure: "villager", speed: 0.4, run: 1.0, spacing: 1.1, armour: 0, reach: 0.8, missile: null, mounted: false, drill: 0.3,
                 band: "levy", kit: "cloth", weapons: [W("club")], shields: [[SH_NONE, 1]], eng: [3, 4] },
  springald:   { id: 13, name: "Springald",    glyph: "crossbow", engine: true, figure: "villager", speed: 0.9, run: 1.8, spacing: 1.2, armour: 0, reach: 0.8, missile: null, mounted: false, drill: 0.4,
                 band: "trained", kit: "cloth", weapons: [W("club")], shields: [[SH_NONE, 1]], eng: [2, 3] },
  ram:         { id: 14, name: "Covered Ram",  glyph: "ram", engine: true, figure: "villager", speed: 0.5, run: 0.9, spacing: 1.0, armour: 0, reach: 0.8, missile: null, mounted: false, drill: 0.3,
                 band: "levy", kit: "cloth", weapons: [W("axe", 0.5), W("club", 0.5)], shields: [[SH_NONE, 1]], eng: [3, 8] },
  siege_tower: { id: 15, name: "Siege Tower",  glyph: "tower", engine: true, figure: "villager", speed: 0.25, run: 0.5, spacing: 1.0, armour: 0, reach: 0.8, missile: null, mounted: false, drill: 0.3,
                 band: "levy", kit: "cloth", weapons: [W("club")], shields: [[SH_NONE, 1]], eng: [5, 5] },
  mantlet:     { id: 16, name: "Mantlet",      glyph: "mantlet", engine: true, figure: "villager", speed: 0.9, run: 1.6, spacing: 1.0, armour: 0, reach: 0.8, missile: null, mounted: false, drill: 0.3,
                 band: "levy", kit: "cloth", weapons: [W("club")], shields: [[SH_NONE, 1]], eng: [2.4, 0.8] },
};
export const ARM_BY_ID = Object.values(ARMS);
export const armKey = (id) => Object.keys(ARMS)[id];
for (const [k, A] of Object.entries(ARMS)) {
  A.key = k; A.kitId = KIT_ID[A.kit]; A.sidearmId = WEAPON_ID[A.sidearm || "dagger"];
  A.maxReach = Math.max(...A.weapons.map(([w]) => WEAPON_BY_ID[w].reach));
  A.pointsRanks = Math.max(...A.weapons.map(([w]) => (WEAPON_BY_ID[w].long ? WEAPON_BY_ID[w].ranks : 0)));
}
export const pickWeighted = (rng, list) => { let r = rng.next(); for (const [v, p] of list) { if ((r -= p) <= 0) return v; } return list[list.length - 1][0]; };

// Formations. files = how wide; dense = spacing multiplier. `open` formations lose cohesion slowly
// in broken ground but are weak against shock.
export const FORMATIONS = {
  line:      { name: "Line",       depth: 4, dense: 1.0 },
  deep:      { name: "Deep block", depth: 8, dense: 0.95 },
  column:    { name: "Column",     depth: -4, dense: 1.1 }, // negative depth = fixed width (files)
  file2:     { name: "Files of two", depth: -2, dense: 1.1 },
  wedge:     { name: "Wedge",      depth: 0, dense: 1.0 },
  schiltron: { name: "Schiltron",  depth: 0, dense: 0.95 }, // ring
  loose:     { name: "Loose",      depth: 3, dense: 2.4 },
  shallow:   { name: "Shallow line", depth: 2, dense: 1.0 },
};

// Slot offsets in unit-local frame (x right, y forward), index = soldier order in unit.
// opts.depth overrides the formation depth (ranks) for line-type formations.
export function formationSlots(kind, count, spacing, depthOverride = 0, rankDepth = 0) {
  const f = FORMATIONS[kind] || FORMATIONS.line, sp = spacing * f.dense, out = new Array(count);
  if (kind === "schiltron") {
    // concentric rings, outer ring first so the first men in the list stand on the perimeter
    const rings = []; let left = count;
    const R0 = Math.max(sp * 2, Math.sqrt(count * sp * sp * 1.15 / Math.PI));
    for (let r = R0; left > 0 && r > sp * 0.5; r -= sp * 1.1) { const n = Math.min(left, Math.max(1, Math.floor(2 * Math.PI * r / sp))); rings.push([r, n]); left -= n; }
    if (left > 0) rings.push([0, left]);
    let placed = 0;
    rings.forEach(([r, n], ring) => { for (let k = 0; k < n; k++, placed++) { const a = (k / n) * Math.PI * 2; out[placed] = [Math.cos(a) * r, Math.sin(a) * r, ring]; } });
    return out;
  }
  if (kind === "wedge") {
    let placed = 0, row = 0;
    while (placed < count) {
      const n = row * 2 + 1;
      for (let k = 0; k < n && placed < count; k++, placed++) out[placed] = [(k - row) * sp, -row * (rankDepth ? rankDepth * 0.85 : sp * 1.1), row]; // (a horse is 2.4 m long: a wedge of horse keeps its rank depth, staggered)
      row++;
    }
    return out;
  }
  const depth = depthOverride || f.depth;
  const files = depth < 0 ? -depth : Math.max(1, Math.ceil(count / depth));
  const rankGap = rankDepth || Math.max(1.0, sp * 1.15); // §5: rank depth ≈1 m foot, 3 m horse
  for (let k = 0; k < count; k++) {
    const rank = Math.floor(k / files), file = k % files;
    const rowN = Math.min(files, count - rank * files);
    out[k] = [(file - (rowN - 1) / 2) * sp, -rank * rankGap, rank];
  }
  return out;
}
// An engine's crew stand round it: on the pulling ropes / at the windlass behind a thrower, inside and
// behind a ram or tower (pushing), behind a mantlet. Unit-local frame: x right, y forward; the engine is
// centred on the anchor.
export function crewSlots(A, count) {
  const [ew, el] = A.eng || [2, 2], out = new Array(count), sp = A.spacing;
  const pushed = A.key === "ram" || A.key === "siege_tower" || A.key === "mantlet";
  for (let k = 0; k < count; k++) {
    if (pushed) { // two files along the engine's sides (under the ram's roof) and a rank at the back
      const back = A.key === "mantlet", perSide = back ? 0 : Math.max(1, Math.floor(el / sp));
      if (k < perSide * 2) { const side = k & 1 ? 1 : -1, r = k >> 1; out[k] = [side * (ew / 2 - 0.5), el / 2 - 0.6 - r * sp, 0]; }
      else { const j = k - perSide * 2, f = Math.max(2, Math.ceil(ew / sp)); out[k] = [((j % f) - (f - 1) / 2) * sp, -el / 2 - 0.8 - Math.floor(j / f) * sp, 1]; }
    } else { // throwers: the crew behind and beside the engine (the pull ropes run back)
      const f = Math.max(3, Math.round(ew / sp) + 1), j = k;
      out[k] = [((j % f) - (f - 1) / 2) * sp, -el / 2 - 1.2 - Math.floor(j / f) * sp, 1 + Math.floor(j / f)];
    }
  }
  return out;
}
export function formationFiles(kind, count, depthOverride = 0) {
  const f = FORMATIONS[kind] || FORMATIONS.line; const depth = depthOverride || f.depth;
  return depth < 0 ? -depth : Math.max(1, Math.ceil(count / Math.max(1, depth)));
}
