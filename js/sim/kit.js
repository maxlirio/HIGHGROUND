// Kit: weapons, armour materials, body zones and the per-troop-type kit tables.
// Every number is from docs/combat-research.md §2–§4 and §9 (sources there) unless tagged DESIGN.
// Pure data + tiny helpers. No sim state lives here.

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ------------------------------------------------------------------ body zones (§2)
export const Z_HEAD = 0, Z_FACE = 1, Z_NECK = 2, Z_TORSO = 3, Z_ARMS = 4, Z_HANDS = 5, Z_THIGHS = 6, Z_SHINS = 7, Z_HORSE = 8;
export const ZONES = ["head", "face", "neck", "torso", "arms", "hands", "thighs", "shins", "horse"];
// Base melee hit-location weights: standing, facing, no shield (§2 table)
export const ZONE_W = [18, 4, 3, 30, 16, 5, 12, 12, 0];

// ------------------------------------------------------------------ damage modes
export const M_CUT = 0, M_THRUST = 1, M_BODKIN = 2, M_BROAD = 3, M_BLUNT = 4;
export const MODES = ["cut", "thrust", "bodkin", "broadhead", "blunt"];

// ------------------------------------------------------------------ armour materials (§4.1)
// pen[mode] = energy (J) at which the weapon starts to go through; blunt = fraction TRANSMITTED.
// "immune" entries are given a large finite number so residual maths stays simple.
const IMM = 900;
export const MAT = {
  none:       { pen: [0, 0, 0, 0], tx: 1.0 },
  cloth:      { pen: [5, 3, 2, 2], tx: 1.0 },
  gambeson:   { pen: [80, 50, 50, 35], tx: 0.7 },                 // 16 layers linen
  jack:       { pen: [200, 90, 80, 60], tx: 0.55 },               // 26-layer quilted jack
  cuir:       { pen: [90, 30, 40, 45], tx: 0.7 },                 // cuir bouilli 5 mm
  mail:       { pen: [250, 170, 80, 110], tx: 0.9 },              // riveted mail alone ("200 J halberd failed")
  mailGamb:   { pen: [IMM, 180, 110, 150], tx: 0.5 },             // mail over gambeson: 100 J penetrates the padding, 120 total failure
  plate1:     { pen: [IMM, 90, 70, 260], tx: 0.4 },               // iron plate 1 mm, Q≈0.7
  plate2:     { pen: [IMM, 250, 175, IMM], tx: 0.3 },             // steel plate 2 mm
  coatPlates: { pen: [IMM, 150, 110, 300], tx: 0.35 },            // coat of plates (1–1.5 mm iron + textile)
  // Skull bone: an inner "layer" under any head covering. DESIGN (bone fracture/penetration energies are
  // of the same order as the §4.2 skull fracture threshold of 60 J blunt).
  skull:      { pen: [30, 25, 25, 30], tx: 1.0 },
  // Horse hide (unbarded): DESIGN, a thick skin that a spent arrow still pierces.
  hide:       { pen: [15, 8, 6, 5], tx: 1.0 },
  bardMail:   { pen: [250, 170, 80, 110], tx: 0.8 },
  bardPad:    { pen: [80, 50, 50, 35], tx: 0.7 },
};
// Plate thresholds from thickness and quality (§4.1): E_pen(bodkin) = 175·(t/2)^1.6·Q.
// thrust scales with the Williams 2 mm point (250 J) and broadheads are ~1.5× harder than bodkins.
export function plate(tmm, Q) {
  const b = 175 * Math.pow(tmm / 2, 1.6) * Q;
  return { pen: [IMM, b * 250 / 175, b, Math.min(IMM, b * 1.5)], tx: clamp(0.25 + 0.2 * (2 - tmm), 0.25, 0.5) };
}
MAT.helmIron = plate(1.5, 0.7);   // helmet crown 1.5 mm bloomery iron
MAT.capIron = plate(1.1, 0.65);   // simple iron cap / kettle hat
MAT.visor = plate(1.3, 0.75);
MAT.legPlate = plate(0.9, 0.7);   // legs 0.7–1 mm in the surviving example [ACOUP]
MAT.armPlate = plate(1.0, 0.7);
const MATS = Object.keys(MAT);
export const MAT_ID = Object.fromEntries(MATS.map((k, i) => [k, i]));
export const MAT_BY_ID = MATS.map((k) => MAT[k]);

// ------------------------------------------------------------------ weapons (§3)
// E: base impact energy per mode (J). rate: blows/min in a flurry [fighter, cautious] (passive = 0).
// ranks: how many ranks can strike. firstStrike: long-weapon bonus for the first 2 s of a flurry.
export const WEAPONS = {
  none:     { reach: 0.6, E: { blunt: 30 }, rate: [20, 6], ranks: 1 },
  sword:    { reach: 0.9, E: { cut: 80, thrust: 60 }, rate: [20, 5], ranks: 1, mass: 1.25 },
  falchion: { reach: 0.8, E: { cut: 100 }, rate: [18, 5], ranks: 1, mass: 1.35 },
  axe:      { reach: 0.7, E: { cut: 100 }, rate: [16, 4], ranks: 1, hook: 0.15, mass: 1.25 },
  pollaxe:  { reach: 1.6, E: { cut: 155, blunt: 150, thrust: 130 }, rate: [10, 3], ranks: 1, twoHand: true, mass: 2.5 },
  mace:     { reach: 0.7, E: { blunt: 100 }, rate: [16, 4], ranks: 1, mass: 1.5 },
  mallet:   { reach: 0.8, E: { blunt: 110 }, rate: [14, 4], ranks: 1, twoHand: true, mass: 2.5 }, // archers' leaden mauls (Agincourt)
  spear:    { reach: 2.3, E: { thrust: 70 }, rate: [20, 6], ranks: 2, mass: 1.75, long: true },
  goedendag:{ reach: 1.6, E: { thrust: 90, blunt: 110 }, rate: [14, 4], ranks: 2, twoHand: true, mass: 2.2, long: true },
  pike:     { reach: 5.0, E: { thrust: 80 }, rate: [10, 4], ranks: 4, twoHand: true, mass: 3.5, long: true },
  lance:    { reach: 3.7, E: { thrust: 400 }, rate: [1, 1], ranks: 1, mass: 3.5, long: true, couched: true },
  dagger:   { reach: 0.3, E: { thrust: 40 }, rate: [30, 30], ranks: 1, mass: 0.3, focus: true },
  club:     { reach: 0.8, E: { blunt: 70 }, rate: [16, 5], ranks: 1, mass: 1.0 },
};
export const WEAPON_KEYS = Object.keys(WEAPONS);
export const WEAPON_ID = Object.fromEntries(WEAPON_KEYS.map((k, i) => [k, i]));
export const WEAPON_BY_ID = WEAPON_KEYS.map((k) => ({ key: k, ...WEAPONS[k], modes: Object.keys(WEAPONS[k].E).map((m) => MODES.indexOf(m)), Eb: MODES.map((m) => WEAPONS[k].E[m] || 0) }));

// ------------------------------------------------------------------ shields (§2)
export const SHIELDS = [
  { key: "none", area: 0 },
  { key: "buckler", area: 0.07, blockMul: 0.5 },
  { key: "heater", area: 0.28, blockMul: 1 },
  { key: "kite", area: 0.4, blockMul: 1.1 },
  { key: "round", area: 0.3, blockMul: 1 },
  { key: "pavise", area: 1.17, blockMul: 1, carried: false }, // 0.9 × 1.3 m; planted, hard cover 0.9 frontal
];
export const SH_NONE = 0, SH_BUCKLER = 1, SH_HEATER = 2, SH_KITE = 3, SH_ROUND = 4, SH_PAVISE = 5;

// ------------------------------------------------------------------ missiles (§9.1, §9.2)
// v0 m/s, mass kg, k drag (m⁻¹), rate [sustained, burst] per min, mode = penetration class
export const MISSILES = {
  longbow:   { v0: 53, m: 0.064, k: 0.0010, rate: [6, 10], mode: M_BODKIN, maxR: 260, skillBand: [0.4, 0.9], ammo: 60, drawW: 13.5 },
  heavybow:  { v0: 47, m: 0.096, k: 0.0007, rate: [6, 8], mode: M_BODKIN, maxR: 240, skillBand: [0.5, 0.9], ammo: 48, drawW: 15 },
  levybow:   { v0: 48, m: 0.045, k: 0.0013, rate: [8, 10], mode: M_BROAD, maxR: 190, skillBand: [0.2, 0.5], ammo: 36, drawW: 8 },
  crossbow:  { v0: 44, m: 0.070, k: 0.0012, rate: [2, 3], mode: M_BODKIN, maxR: 170, skillBand: [0.35, 0.6], ammo: 30, drawW: 10 },
  windlass:  { v0: 48, m: 0.094, k: 0.0010, rate: [1, 1], mode: M_BODKIN, maxR: 200, skillBand: [0.35, 0.6], ammo: 24, drawW: 6 },
  javelin:   { v0: 20, m: 0.6, k: 0.0020, rate: [3, 4], mode: M_THRUST, maxR: 40, skillBand: [0.3, 0.7], ammo: 3, drawW: 25 },
  stone:     { v0: 13, m: 0.6, k: 0.0030, rate: [6, 6], mode: M_BLUNT, maxR: 25, skillBand: [0.2, 0.5], ammo: 99, drawW: 20 },
  springald: { v0: 58, m: 0.2, k: 0.0005, rate: [1, 1], mode: M_BODKIN, maxR: 300, skillBand: [0.3, 0.6], ammo: 40, drawW: 0 }, // espringal quarrel (siege-research.md §3): fired by siege.js, not by a man's missile slot
};
export const MISSILE_KEYS = Object.keys(MISSILES);

// ------------------------------------------------------------------ kits
// Each zone: list of layer options, outermost first: [material, P(present)] (a man either has that piece
// or not; sampled per soldier). gap = chance a blow finds a gap in the OUTERMOST plate layer (armpits,
// eye slits, the joints) and meets only the inner layers. Head always has the skull under it.
const L = (mat, p = 1) => [mat, p];
export const KITS = {
  cloth: { zones: { head: [], face: [], neck: [], torso: [L("cloth")], arms: [L("cloth")], hands: [], thighs: [L("cloth")], shins: [L("cloth")] }, load: 3, limb: 0 },
  levy: {
    zones: { head: [L("capIron", 0.4), L("cloth", 0.6)], face: [], neck: [], torso: [L("gambeson", 0.8), L("cloth")], arms: [L("gambeson", 0.7), L("cloth")],
             hands: [], thighs: [L("gambeson", 0.4), L("cloth")], shins: [L("cloth")] },
    load: 10, limb: 1,
  },
  spear: { // communal / trained spearmen: kettle hat, haubergeon over gambeson for most
    zones: { head: [L("capIron", 0.9), L("gambeson", 0.6)], face: [], neck: [L("mail", 0.4), L("gambeson", 0.5)], torso: [L("mailGamb", 0.55), L("gambeson")],
             arms: [L("mailGamb", 0.45), L("gambeson", 0.8)], hands: [L("cloth", 0.6)], thighs: [L("gambeson", 0.7), L("cloth")], shins: [L("cloth")] },
    load: 18, limb: 3,
  },
  pike: {
    zones: { head: [L("capIron", 0.8), L("cloth")], face: [], neck: [L("jack", 0.4)], torso: [L("jack", 0.9), L("gambeson")], arms: [L("jack", 0.7), L("cloth")],
             hands: [], thighs: [L("gambeson", 0.6), L("cloth")], shins: [L("cloth")] },
    load: 16, limb: 2,
  },
  maa: { // man-at-arms c.1300–1350: great helm/bascinet over coif, coat of plates over mail + gambeson, some limb plate
    zones: { head: [L("helmIron"), L("mailGamb")], face: [L("visor", 0.35), L("mail", 0.5)], neck: [L("mailGamb")], torso: [L("coatPlates"), L("mailGamb")],
             arms: [L("armPlate", 0.6), L("mailGamb")], hands: [L("armPlate", 0.7), L("mail", 0.8)], thighs: [L("legPlate", 0.6), L("mailGamb")], shins: [L("legPlate", 0.6), L("mail")] },
    gap: { head: 0, face: 0.2, neck: 0.1, torso: 0.06, arms: 0.1, hands: 0.15, thighs: 0.1, shins: 0.1 },
    load: 32, limb: 10,
  },
  mail: { // benchmark "mail vs mail" (§7): hauberk + coif over gambeson, iron helm, mail chausses on half
    zones: { head: [L("capIron"), L("mailGamb")], face: [], neck: [L("mailGamb")], torso: [L("mailGamb")], arms: [L("mailGamb")],
             hands: [L("mail", 0.5)], thighs: [L("mailGamb")], shins: [L("mail", 0.5), L("cloth")] },
    load: 24, limb: 6,
  },
  gambFoot: { // §17.4 benchmark: close-order foot in gambesons (padded coifs on most heads), no shields
    zones: { head: [L("gambeson", 0.6), L("cloth")], face: [], neck: [L("gambeson", 0.6)], torso: [L("gambeson")], arms: [L("gambeson")],
             hands: [], thighs: [L("gambeson")], shins: [L("cloth")] },
    load: 10, limb: 2,
  },
  archer: {
    zones: { head: [L("capIron", 0.5), L("cloth")], face: [], neck: [], torso: [L("jack", 0.6), L("gambeson", 0.6), L("cloth")], arms: [L("gambeson", 0.4), L("cloth")],
             hands: [], thighs: [L("cloth")], shins: [L("cloth")] },
    load: 12, limb: 1,
  },
  xbow: {
    zones: { head: [L("capIron", 0.9), L("cloth")], face: [], neck: [L("mail", 0.3)], torso: [L("mailGamb", 0.3), L("gambeson")], arms: [L("gambeson", 0.8), L("cloth")],
             hands: [], thighs: [L("gambeson", 0.5), L("cloth")], shins: [L("cloth")] },
    load: 16, limb: 2,
  },
  light: { // hobelars / scouts
    zones: { head: [L("capIron", 0.7), L("cloth")], face: [], neck: [], torso: [L("jack", 0.8), L("gambeson")], arms: [L("gambeson", 0.6), L("cloth")],
             hands: [], thighs: [L("gambeson", 0.5), L("cloth")], shins: [L("cloth")] },
    load: 14, limb: 2,
  },
};
// Horse kits: zone "horse" only.
export const HORSES = [
  null,
  { key: "rouncey", mass: 350, barding: [L("hide")], vmax: 7.5, gallopM: 2000, wAcc: 1 },
  { key: "destrier", mass: 450, barding: [L("bardPad", 0.15), L("hide")], vmax: 8.3, gallopM: 2500, wAcc: 1 },
  // learned mounts (js/sim/mounts.js: behaviour knobs; docs/mounts-wildlife-spec.md: how a town comes to ride them)
  { key: "strider", mass: 160, barding: [L("hide")], vmax: 10.6, gallopM: 3400, wAcc: 1 }, // a big flightless bird: fast, light, never barded
  { key: "drake", mass: 700, barding: [L("hide")], vmax: 6.5, gallopM: 1600, wAcc: 1 },    // a large lizard: slow, heavy, thick-hided (mounts.hide)
];

export const KIT_KEYS = Object.keys(KITS);
export const KIT_ID = Object.fromEntries(KIT_KEYS.map((k, i) => [k, i]));
// Precompiled: KIT_BY_ID[k].z[zone] = [{mat:id, p}], gap[zone]
export const KIT_BY_ID = KIT_KEYS.map((k) => {
  const K = KITS[k];
  return {
    key: k, load: K.load, limb: K.limb,
    z: ZONES.slice(0, 8).map((zn) => (K.zones[zn] || []).map(([m, p]) => ({ mat: MAT_ID[m], p }))),
    gap: ZONES.slice(0, 8).map((zn) => (K.gap?.[zn] ?? 0)),
  };
});

// Bit layout of a soldier's kit mask: for each of 8 zones, up to 3 optional layers → 24 bits.
// Bit (zone*3 + layer) set = that layer is worn.
export function sampleKitMask(kitId, rng) {
  const K = KIT_BY_ID[kitId]; let mask = 0;
  for (let z = 0; z < 8; z++) {
    const ls = K.z[z];
    for (let l = 0; l < ls.length && l < 3; l++) if (ls[l].p >= 1 || rng.next() < ls[l].p) mask |= 1 << (z * 3 + l);
  }
  return mask >>> 0;
}

// Summary armour class 0..5 (legacy field used by movement class and legend odds).
export function armourClass(kitId, mask) {
  const K = KIT_BY_ID[kitId]; let s = 0;
  const w = [0.15, 0.05, 0.05, 0.45, 0.1, 0.02, 0.1, 0.08];
  for (let z = 0; z < 8; z++) {
    let best = 0;
    for (let l = 0; l < K.z[z].length; l++) if (mask & (1 << (z * 3 + l))) best += MAT_BY_ID[K.z[z][l].mat].pen[M_BODKIN];
    s += w[z] * Math.min(best, 250);
  }
  return s < 15 ? 0 : s < 45 ? 1 : s < 80 ? 2 : s < 130 ? 3 : s < 200 ? 4 : 5;
}

