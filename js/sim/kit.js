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
export const M_CUT = 0, M_THRUST = 1, M_BODKIN = 2, M_BROAD = 3, M_BLUNT = 4, M_AP = 5;
// APPENDED, like everything else here: a weapon's Eb is indexed by this list. "ap" is the shaped charge — a jet
// of metal that does not care how fast the round was going, which is why a man can carry something that kills a
// tank. It is priced against a material's `apPen` (below), not its bodkin threshold.
export const MODES = ["cut", "thrust", "bodkin", "broadhead", "blunt", "ap"];

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
  // ── the Riven Marches (docs/eras-plan.md). Same joules, other makers.
  rag:        { pen: [14, 9, 6, 7], tx: 1.0 },                    // goblin sacking and stolen cloth
  scrapMail:  { pen: [190, 120, 55, 80], tx: 0.85 },              // orc mail off a battlefield, half the rings wrong
  hideThick:  { pen: [210, 150, 95, 130], tx: 0.55 },             // a troll's hide: thick, and it closes over
  elfMail:    { pen: [IMM, 205, 135, 175], tx: 0.5 },             // a mail so fine it weighs nothing
  dwarfPlate: { pen: [IMM, 285, 200, 520], tx: 0.30 },             // Ironbeard work: better plate than any man forges — but a pollaxe still finds the joints
  wardedRobe: { pen: [120, 80, 70, 60], tx: 0.75 },               // a robe sewn with wards
  // ── The Ardennes, winter 1944 (docs/eras-plan.md). The infantryman of 1944 is LESS armoured than the man of
  // 1346 — wool and a steel pot — and what shoots at him is twenty times as hard. `apPen` is the threshold against
  // a shaped charge (M_AP); where it is absent a material is judged by its bodkin.
  field44:   { pen: [10, 7, 5, 6], tx: 0.95 },                     // wool blouse and trousers: they stop nothing
  greatcoat: { pen: [26, 16, 12, 14], tx: 0.9 },                   // and a greatcoat stops very little
  webbing:   { pen: [34, 22, 16, 20], tx: 0.85 },                  // pack, entrenching tool and pouches across the chest
  helmSteel: { pen: [IMM, 340, 240, 420], tx: 0.45, apPen: 240 },  // Mn-steel helmet: splinters and a spent round, not a rifle at 300 m
  gunShield: { pen: [IMM, 2600, 1800, 4000], tx: 0.4, apPen: 900 },// 6 mm shield on a field gun: rifle-proof, and that is all it is for
  // Hulls, in the same currency as everything else — joules at the plate, read off the real guns' muzzle energies.
  // A rifle is 2,650 J and an 88's armour-piercing shot is 3.05 MJ, so the numbers are simply large.
  hullOpen:  { pen: [IMM, 9000, 8000, 14000], tx: 0.5, apPen: 1200 },         // 8–15 mm, open-topped: small arms out, a 20 mm through
  hullMed:   { pen: [IMM, 950e3, 680e3, 1.9e6], tx: 0.35, apPen: 5000 },      // 50–80 mm: a 6-pdr cracks it at 900 m, a 37 mm (330 kJ) never does
  hullHeavy: { pen: [IMM, 2.7e6, 2.0e6, 5.0e6], tx: 0.3, apPen: 11000 },      // 100–180 mm: only the big guns, and a bazooka barely
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
  bill:     { reach: 2.2, E: { cut: 150, thrust: 110, blunt: 95 }, rate: [12, 4], ranks: 2, twoHand: true, mass: 2.9, long: true, hook: 0.40 }, // the English bill: a hedging knife on a six-foot haft — cut, point and a hook that pulls a rider down
  greatsword:{ reach: 1.7, E: { cut: 175, thrust: 115 }, rate: [13, 4], ranks: 1, twoHand: true, mass: 2.8 },                                   // Doppelsöldner's Zweihänder: paid double to go in at the pike points
  // ── the Riven Marches. APPENDED: a weapon's id is its place here and every soldier's S.weapon holds that number.
  greataxe: { reach: 1.5, E: { cut: 195, blunt: 125 }, rate: [10, 3], ranks: 1, twoHand: true, mass: 3.2 },
  dwarfhammer:{ reach: 1.3, E: { blunt: 205, thrust: 95 }, rate: [11, 3], ranks: 1, twoHand: true, mass: 3.0 },
  cleaver:  { reach: 1.0, E: { cut: 125 }, rate: [16, 5], ranks: 1, mass: 1.6 },                                   // orc iron, heavy and badly balanced
  shortblade:{ reach: 0.6, E: { cut: 52, thrust: 46 }, rate: [22, 7], ranks: 1, mass: 0.7 },                       // a goblin's knife
  warclub:  { reach: 2.6, E: { blunt: 430 }, rate: [6, 2], ranks: 1, twoHand: true, mass: 12, long: true },        // a trunk with the roots left on: it does not cut, it breaks
  staff:    { reach: 1.4, E: { blunt: 62 }, rate: [12, 4], ranks: 1, twoHand: true, mass: 1.6 },
  // ── The Ardennes. APPENDED: a weapon's id is its place here and every soldier's S.weapon holds that number.
  bayonet:  { reach: 1.5, E: { thrust: 65, cut: 48 }, rate: [16, 5], ranks: 1, twoHand: true, mass: 4.3 },      // a rifle with a knife on the end of it
  etool:    { reach: 0.7, E: { cut: 85, blunt: 75 }, rate: [18, 6], ranks: 1, mass: 1.1 },                      // the entrenching tool: what men actually used in a trench
  smgbutt:  { reach: 0.7, E: { blunt: 58 }, rate: [20, 6], ranks: 1, mass: 4.0 },                               // a submachine gun held by the barrel
  tracks:   { reach: 2.8, E: { blunt: 900 }, rate: [8, 8], ranks: 1, mass: 0, long: true },                      // being driven over
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
// effR = effective range, m (DESIGN from §9.2–9.3, owner's decision 2026-10-05 "40 archers take 3 minutes to kill 2 men"): where a
// company's shafts still fall thick on a 60-man body AND still go through its padding; beyond it (to maxR) they mostly stick in
// the gambesons or miss. A company ordered onto a body closes to it before it looses (js/game/commands.js shotReach), the
// battle AI stands its bows inside it (js/sim/commander-ai.js); tools/lethality-probe.mjs "arrows" holds the band.
export const MISSILES = {
  longbow:   { v0: 53, m: 0.064, k: 0.0010, rate: [6, 10], mode: M_BODKIN, maxR: 260, effR: 150, skillBand: [0.4, 0.9], ammo: 60, drawW: 13.5 },
  heavybow:  { v0: 47, m: 0.096, k: 0.0007, rate: [6, 8], mode: M_BODKIN, maxR: 240, effR: 160, skillBand: [0.5, 0.9], ammo: 48, drawW: 15 },
  levybow:   { v0: 48, m: 0.045, k: 0.0013, rate: [8, 10], mode: M_BROAD, maxR: 190, effR: 110, skillBand: [0.2, 0.5], ammo: 36, drawW: 8 },
  crossbow:  { v0: 44, m: 0.070, k: 0.0012, rate: [2, 3], mode: M_BODKIN, maxR: 170, effR: 150, skillBand: [0.35, 0.6], ammo: 30, drawW: 10 },
  windlass:  { v0: 48, m: 0.094, k: 0.0010, rate: [1, 1], mode: M_BODKIN, maxR: 200, effR: 130, skillBand: [0.35, 0.6], ammo: 24, drawW: 6 },
  javelin:   { v0: 20, m: 0.6, k: 0.0020, rate: [3, 4], mode: M_THRUST, maxR: 40, effR: 30, skillBand: [0.3, 0.7], ammo: 3, drawW: 25 },
  stone:     { v0: 13, m: 0.6, k: 0.0030, rate: [6, 6], mode: M_BLUNT, maxR: 25, effR: 20, skillBand: [0.2, 0.5], ammo: 99, drawW: 20 },
  handgun:   { v0: 320, m: 0.028, k: 0.0025, rate: [0.9, 1.2], mode: M_BODKIN, maxR: 100, effR: 45, skillBand: [0.15, 0.4], ammo: 12, drawW: 0 , fx: "bullet"}, // hand gun, c.1380: a lead ball of an ounce from a wrought-iron tube. 1,400 J goes through any harness made — but one shot a minute, and only near
  horsebow:  { v0: 46, m: 0.040, k: 0.0014, rate: [5, 8], mode: M_BROAD, maxR: 170, effR: 95, skillBand: [0.3, 0.65], ammo: 40, drawW: 9 },      // short composite bow drawn from the saddle
  springald: { v0: 58, m: 0.2, k: 0.0005, rate: [1, 1], mode: M_BODKIN, maxR: 300, effR: 200, skillBand: [0.3, 0.6], ammo: 40, drawW: 0 }, // espringal quarrel (siege-research.md §3): fired by siege.js, not by a man's missile slot
  // ── the Riven Marches. APPENDED: S.missile holds this list's index (soldiers.js), so nothing above may move.
  elfbow:    { v0: 62, m: 0.052, k: 0.0009, rate: [8, 12], mode: M_BODKIN, maxR: 320, effR: 195, skillBand: [0.6, 0.95], ammo: 50, drawW: 14 }, // drawn further than a man can, and they do not miss
  spellbolt: { v0: 70, m: 0.30, k: 0.0004, rate: [3, 4], mode: M_BODKIN, maxR: 170, effR: 115, skillBand: [0.5, 0.9], ammo: 20, drawW: 0 },     // a bolt of force off a staff
  // ── The Ardennes, winter 1944. APPENDED: S.missile holds this list's index (soldiers.js), so nothing above may
  // move. v0, mass and drag are the real rounds'; `blast`/`blastE` is a shell's killing radius and what it throws
  // at the centre of it (js/sim/ballistics.js), because a mortar that killed only the man it landed on would be
  // no mortar at all. The trajectory tables size themselves from maxR (they already reach 2,000 m).
  rifle:     { v0: 740, m: 0.0097, k: 0.0008, rate: [12, 20], mode: M_BODKIN, maxR: 800, effR: 320, skillBand: [0.3, 0.8], ammo: 80, drawW: 0 , fx: "bullet"},   // .30-06 / 7.92: 2,650 J at the muzzle
  smg:       { v0: 365, m: 0.0112, k: 0.0019, rate: [40, 90], mode: M_BODKIN, maxR: 220, effR: 90, skillBand: [0.25, 0.6], ammo: 200, drawW: 0 , fx: "bullet"},  // 9 mm or .45: little of it, and a great deal of little
  lmg:       { v0: 755, m: 0.0123, k: 0.0008, rate: [45, 80], mode: M_BODKIN, maxR: 1000, effR: 500, skillBand: [0.4, 0.85], ammo: 600, drawW: 0 , fx: "bullet"},// on its tripod: 3,500 J a round, and it does not stop
  snipergun: { v0: 760, m: 0.0127, k: 0.0008, rate: [4, 6], mode: M_BODKIN, maxR: 900, effR: 620, skillBand: [0.8, 0.98], ammo: 40, drawW: 0 , fx: "bullet"},
  bazooka:   { v0: 83, m: 3.5, k: 0.0022, rate: [3, 4], mode: M_AP, maxR: 220, effR: 110, skillBand: [0.3, 0.7], ammo: 8, drawW: 0, blast: 4, blastE: 700 , fx: "shell"}, // a shaped charge a man can carry
  autocannon:{ v0: 820, m: 0.148, k: 0.0006, rate: [80, 130], mode: M_BODKIN, maxR: 1200, effR: 600, skillBand: [0.35, 0.75], ammo: 400, drawW: 0 , fx: "bullet"},// 20 mm: through anything thin-skinned
  mortar81:  { v0: 158, m: 3.2, k: 0.0014, rate: [8, 18], mode: M_BROAD, maxR: 1000, effR: 700, skillBand: [0.3, 0.7], ammo: 60, drawW: 0, blast: 16, blastE: 2600 , fx: "shell"},
  atgun:     { v0: 850, m: 2.85, k: 0.00016, rate: [8, 12], mode: M_BODKIN, maxR: 1500, effR: 900, skillBand: [0.45, 0.85], ammo: 40, drawW: 0 , fx: "shell"},  // 6-pdr armour-piercing: 1.03 MJ at the muzzle, 770 kJ at 900 m
  tankgun:   { v0: 618, m: 6.79, k: 0.00014, rate: [6, 9], mode: M_BODKIN, maxR: 1500, effR: 1000, skillBand: [0.45, 0.85], ammo: 50, drawW: 0, blast: 8, blastE: 1400 , fx: "shell"},  // 75 mm
  tankgun88: { v0: 773, m: 10.2, k: 0.00011, rate: [5, 8], mode: M_BODKIN, maxR: 1600, effR: 1200, skillBand: [0.5, 0.9], ammo: 40, drawW: 0, blast: 9, blastE: 1700 , fx: "shell"},    // the eighty-eight: 3.05 MJ
  howitzer:  { v0: 472, m: 14.97, k: 0.0003, rate: [3, 5], mode: M_BROAD, maxR: 1200, effR: 900, skillBand: [0.3, 0.7], ammo: 40, drawW: 0, blast: 26, blastE: 4200 , fx: "shell"},    // 105 mm high explosive
};
// `fx` is for the RENDERER only and never reaches the sim: it says how a round is drawn. Without it every
// shot in the game — a rifle bullet, an 88 mm round — was drawn as a wooden arrow on a parabola and stuck
// into the ground as a shaft where it landed. "bullet" is a tracer streak, "shell" a heavier one that bursts.
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
  // ── the Riven Marches. APPENDED: a kit's id is its place here and every soldier's S.kit holds that number.
  ironbeard: { // dwarf shieldwall: their own plate over mail, and a helm that covers the face
    zones: { head: [L("helmIron"), L("mailGamb")], face: [L("visor", 0.7), L("mail")], neck: [L("mailGamb")], torso: [L("dwarfPlate"), L("mailGamb")],
             arms: [L("armPlate", 0.8), L("mailGamb")], hands: [L("armPlate", 0.85), L("mail")], thighs: [L("legPlate", 0.7), L("mailGamb")], shins: [L("legPlate", 0.8), L("mail")] },
    gap: { head: 0, face: 0.18, neck: 0.09, torso: 0.055, arms: 0.09, hands: 0.14, thighs: 0.09, shins: 0.09 },
    load: 30, limb: 9,
  },
  sylvan: { // elf-mail: little of it, and it weighs nothing
    zones: { head: [L("capIron", 0.3), L("cloth")], face: [], neck: [L("elfMail", 0.4)], torso: [L("elfMail", 0.75), L("cloth")],
             arms: [L("elfMail", 0.4), L("cloth")], hands: [], thighs: [L("cloth")], shins: [L("cloth")] },
    load: 9, limb: 1,
  },
  orcish: { // whatever was taken off the dead, and plenty of it: they are big enough to carry it
    zones: { head: [L("capIron", 0.6), L("scrapMail", 0.4)], face: [], neck: [L("scrapMail", 0.35)], torso: [L("scrapMail", 0.85), L("gambeson")],
             arms: [L("scrapMail", 0.5), L("gambeson", 0.6)], hands: [], thighs: [L("gambeson", 0.5)], shins: [] },
    load: 17, limb: 2,
  },
  goblinrag: {
    zones: { head: [L("capIron", 0.25), L("rag")], face: [], neck: [], torso: [L("rag")], arms: [L("rag", 0.5)], hands: [], thighs: [L("rag")], shins: [] },
    load: 4, limb: 0,
  },
  brute: { // trolls and ogres wear almost nothing: the hide is the harness
    zones: { head: [L("hideThick")], face: [], neck: [L("hideThick")], torso: [L("hideThick")], arms: [L("hideThick")],
             hands: [L("hideThick")], thighs: [L("hideThick")], shins: [L("hideThick")] },
    load: 6, limb: 0,
  },
  adept: {
    zones: { head: [L("wardedRobe", 0.5)], face: [], neck: [], torso: [L("wardedRobe")], arms: [L("wardedRobe")], hands: [], thighs: [L("wardedRobe")], shins: [L("cloth")] },
    load: 6, limb: 0,
  },
  // ── The Ardennes. APPENDED: a kit's id is its place here and every soldier's S.kit holds that number.
  gi: { // 1944 infantry: a steel helmet, wool, and webbing. Less armour than a man of 1346 had, against far worse.
    zones: { head: [L("helmSteel", 0.95), L("field44")], face: [], neck: [L("field44")], torso: [L("webbing", 0.85), L("greatcoat", 0.7), L("field44")],
             arms: [L("greatcoat", 0.7), L("field44")], hands: [], thighs: [L("field44")], shins: [L("field44")] },
    load: 22, limb: 1,
  },
  guncrew: { // serving a gun or a mortar: the same man, less on him, and a shield in front of some of them
    zones: { head: [L("helmSteel", 0.9), L("field44")], face: [], neck: [], torso: [L("gunShield", 0.45), L("field44")],
             arms: [L("field44")], hands: [], thighs: [L("field44")], shins: [L("field44")] },
    load: 14, limb: 1,
  },
  // A VEHICLE IS ONE SOLDIER. The unit on the field is the machine and the men inside it — it is hit, it is
  // penetrated, and when its nerve goes the crew bail out and it is gone, which is exactly what the morale model
  // already does. `gap` is the hatches, the vision slits and the engine deck: the lucky hit a gunner prays for.
  vehOpen: { // scout car, half-track: 8–15 mm and no roof
    zones: { head: [L("hullOpen")], face: [L("hullOpen")], neck: [L("hullOpen")], torso: [L("hullOpen")], arms: [L("hullOpen")], hands: [L("hullOpen")], thighs: [L("hullOpen")], shins: [L("hullOpen")] },
    gap: { head: 0.14, face: 0.16, neck: 0.1, torso: 0.05, arms: 0.08, hands: 0.1, thighs: 0.06, shins: 0.08 },
    load: 0, limb: 0,
  },
  vehMed: {
    zones: { head: [L("hullMed")], face: [L("hullMed")], neck: [L("hullMed")], torso: [L("hullMed")], arms: [L("hullMed")], hands: [L("hullMed")], thighs: [L("hullMed")], shins: [L("hullMed")] },
    gap: { head: 0.05, face: 0.07, neck: 0.04, torso: 0.02, arms: 0.03, hands: 0.04, thighs: 0.02, shins: 0.05 },
    load: 0, limb: 0,
  },
  vehHeavy: {
    zones: { head: [L("hullHeavy")], face: [L("hullHeavy")], neck: [L("hullHeavy")], torso: [L("hullHeavy")], arms: [L("hullHeavy")], hands: [L("hullHeavy")], thighs: [L("hullHeavy")], shins: [L("hullHeavy")] },
    gap: { head: 0.035, face: 0.05, neck: 0.03, torso: 0.012, arms: 0.02, hands: 0.03, thighs: 0.012, shins: 0.035 },
    load: 0, limb: 0,
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

