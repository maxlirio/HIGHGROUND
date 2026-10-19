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
  // ── the peoples of the Riven Marches (docs/eras-plan.md). The same physiology read off other bodies:
  // critical power in watts, anaerobic capacity in kilojoules, glycogen in hours, blood in litres.
  dwarf:   { mass: [78, 4], str: [0.80, 0.07], cp: [250, 12], wp: [27, 2.0], gly: [3.6, 0.3], skill: [0.65, 0.08], nerve: [0.85, 0.08], disc: [0.90, 0.07], blood: 5.6 },
  elf:     { mass: [62, 3], str: [0.55, 0.06], cp: [215, 10], wp: [18, 1.6], gly: [4.3, 0.3], skill: [0.85, 0.06], nerve: [0.65, 0.10], disc: [0.72, 0.09], blood: 4.7 },
  orcish:  { mass: [92, 7], str: [0.88, 0.09], cp: [250, 14], wp: [30, 2.6], gly: [3.2, 0.3], skill: [0.45, 0.10], nerve: [0.72, 0.12], disc: [0.45, 0.10], blood: 6.4 },
  goblin:  { mass: [40, 4], str: [0.30, 0.05], cp: [120, 9],  wp: [9, 1.2],  gly: [2.6, 0.3], skill: [0.32, 0.09], nerve: [0.26, 0.09], disc: [0.24, 0.08], blood: 3.2 },
  ogreish: { mass: [220, 15], str: [1.55, 0.12], cp: [350, 18], wp: [55, 4.0], gly: [3.0, 0.3], skill: [0.40, 0.10], nerve: [0.78, 0.10], disc: [0.35, 0.10], blood: 11 },
  trollish:{ mass: [300, 20], str: [1.85, 0.14], cp: [400, 22], wp: [68, 5.0], gly: [3.4, 0.3], skill: [0.38, 0.10], nerve: [0.82, 0.10], disc: [0.30, 0.10], blood: 15 },
  // ── The Ardennes, winter 1944. A soldier is a soldier: the same physiology, read off the same bodies.
  conscript: { mass: [68, 5], str: [0.52, 0.07], cp: [195, 11], wp: [18, 1.8], gly: [3.2, 0.3], skill: [0.30, 0.08], nerve: [0.38, 0.10], disc: [0.50, 0.09], blood: 5.0 },
  soldier:   { mass: [72, 5], str: [0.60, 0.07], cp: [215, 11], wp: [21, 1.8], gly: [3.5, 0.3], skill: [0.55, 0.08], nerve: [0.55, 0.10], disc: [0.68, 0.08], blood: 5.1 },
  veteran44: { mass: [74, 5], str: [0.65, 0.07], cp: [225, 12], wp: [23, 2.0], gly: [3.6, 0.3], skill: [0.78, 0.07], nerve: [0.72, 0.09], disc: [0.80, 0.07], blood: 5.1 },
  // A VEHICLE IS ONE SOLDIER: the machine and the men in it. Its mass stays a man's, because mass here is only the
  // metabolic cost of moving a body (physio.js pandolf) and an engine does not walk; what makes it a vehicle is the
  // critical power it never exhausts, and the hull in js/sim/kit.js. Blood is the crew: it takes a great deal to
  // empty, and when the nerve goes they bail out — which is what a rout already is.
  crew:      { mass: [80, 4], str: [0.62, 0.06], cp: [3000, 120], wp: [400, 20], gly: [9, 0.6], skill: [0.62, 0.08], nerve: [0.70, 0.10], disc: [0.82, 0.07], blood: 22 },
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
  // eng: footprint [w, l] m. figure: the VAT set the crew are drawn with — `siegecrew`, their own set: a
  // carpenter's men with sleeves rolled, a leather apron, a coil of rope and a beetle, and a coif on a few
  // because they stand in bowshot all day. (They were villagers, so a ram crew and a man hoeing a field were
  // the same person; the owner, 2026-10-18: every troop type is to look like itself.)
  trebuchet:   { id: 11, name: "Trebuchet", one: "a siege engineer",    glyph: "trebuchet", engine: true, figure: "siegecrew", speed: 0.75, run: 1.4, spacing: 1.4, armour: 0, reach: 0.8, missile: null, mounted: false, drill: 0.3,
                 band: "levy", kit: "cloth", weapons: [W("axe", 0.5), W("club", 0.5)], shields: [[SH_NONE, 1]], eng: [7, 10] },
  mangonel:    { id: 12, name: "Mangonel", one: "a siege engineer",     glyph: "trebuchet", engine: true, figure: "siegecrew", speed: 0.4, run: 1.0, spacing: 1.1, armour: 0, reach: 0.8, missile: null, mounted: false, drill: 0.3,
                 band: "levy", kit: "cloth", weapons: [W("club")], shields: [[SH_NONE, 1]], eng: [3, 4] },
  springald:   { id: 13, name: "Springald", one: "a siege engineer",    glyph: "crossbow", engine: true, figure: "siegecrew", speed: 0.9, run: 1.8, spacing: 1.2, armour: 0, reach: 0.8, missile: null, mounted: false, drill: 0.4,
                 band: "trained", kit: "cloth", weapons: [W("club")], shields: [[SH_NONE, 1]], eng: [2, 3] },
  ram:         { id: 14, name: "Covered Ram", one: "a siege engineer",  glyph: "ram", engine: true, figure: "siegecrew", speed: 0.5, run: 0.9, spacing: 1.0, armour: 0, reach: 0.8, missile: null, mounted: false, drill: 0.3,
                 band: "levy", kit: "cloth", weapons: [W("axe", 0.5), W("club", 0.5)], shields: [[SH_NONE, 1]], eng: [3, 8] },
  siege_tower: { id: 15, name: "Siege Tower", one: "a siege engineer",  glyph: "tower", engine: true, figure: "siegecrew", speed: 0.25, run: 0.5, spacing: 1.0, armour: 0, reach: 0.8, missile: null, mounted: false, drill: 0.3,
                 band: "levy", kit: "cloth", weapons: [W("club")], shields: [[SH_NONE, 1]], eng: [5, 5] },
  mantlet:     { id: 16, name: "Mantlet", one: "a siege engineer",      glyph: "mantlet", engine: true, figure: "siegecrew", speed: 0.9, run: 1.6, spacing: 1.0, armour: 0, reach: 0.8, missile: null, mounted: false, drill: 0.3,
                 band: "levy", kit: "cloth", weapons: [W("club")], shields: [[SH_NONE, 1]], eng: [2.4, 0.8] },
  // ── The Vale's specialists (docs/eras-plan.md). Appended, so every id above keeps its number: an arm's id IS
  // its place in this object, and the realm's saves and its lockstep both hold those numbers.
  billmen:   { id: 17, name: "Billmen",       glyph: "bill",       speed: 1.25, run: 3.1, spacing: 0.9, armour: 2, reach: 2.2, missile: null, mounted: false, drill: 0.6,
               band: "trained", kit: "spear", weapons: [W("bill")], sidearm: "sword", figure: "spearmen", shields: [[SH_NONE, 1]] },
  greatswords:{ id: 18, name: "Doppelsöldner", one: "a Doppelsöldner", glyph: "greatsword", speed: 1.3, run: 3.3, spacing: 1.2, armour: 4, reach: 1.7, missile: null, mounted: false, drill: 0.85,
               band: "elite", kit: "maa", weapons: [W("greatsword")], sidearm: "sword", figure: "menatarms", shields: [[SH_NONE, 1]], ransom: 1 },
  handgunners:{ id: 19, name: "Hand Gunners", glyph: "gun",        speed: 1.3, run: 3.2, spacing: 1.5, armour: 1, reach: 0.8, missile: "handgun", mounted: false, drill: 0.35, ammo: 12,
               band: "trained", kit: "archer", weapons: [W("club", 0.6), W("mace", 0.4)], figure: "crossbow", shields: [[SH_NONE, 1]], skillMissile: 0.35 },
  horsearchers:{ id: 20, name: "Horse Archers", glyph: "bowhorse", speed: 2.1, run: 7.2, spacing: 2.2, armour: 1, reach: 0.9, missile: "horsebow", mounted: true, drill: 0.6, ammo: 40,
               band: "trained", kit: "light", weapons: [W("sword")], figure: "hobelars", shields: [[SH_NONE, 1]], horse: 1, rankDepth: 4, skillMissile: 0.6 },
  // ── The Riven Marches. APPENDED, like everything above: an arm's id is its place in this object, and the
  // realm's saves and its lockstep both hold those numbers. `figure` names a fallback set; each of these now
  // has its own (assets/src/units/), and figures.js prefers an arm's own whenever it is there.
  dwarves:    { id: 21, era: "march", name: "Ironbeards", one: "an Ironbeard",    glyph: "dwarf",  speed: 1.05, run: 2.5, spacing: 0.80, armour: 6, reach: 1.3, missile: null, mounted: false, drill: 0.9,
                band: "dwarf", kit: "ironbeard", weapons: [W("dwarfhammer", 0.55), W("greataxe", 0.45)], sidearm: "axe", figure: "menatarms", figScale: 0.8, shields: [[SH_HEATER, 1]] },
  elfarchers: { id: 22, era: "march", name: "Sylvan Bows", one: "a sylvan bowman",   glyph: "bow",    speed: 1.40, run: 3.9, spacing: 1.50, armour: 1, reach: 0.9, missile: "elfbow", mounted: false, drill: 0.75, ammo: 50,
                band: "elf", kit: "sylvan", weapons: [W("sword")], figure: "archers", figScale: 1.04, shields: [[SH_NONE, 1]], skillMissile: 0.95 },
  orcs:       { id: 23, era: "march", name: "Orc Warband", one: "an orc",   glyph: "orc",    speed: 1.35, run: 3.6, spacing: 1.00, armour: 2, reach: 2.3, missile: null, mounted: false, drill: 0.30,
                band: "orcish", kit: "orcish", weapons: [W("spear", 0.65), W("cleaver", 0.25), W("greataxe", 0.10)], sidearm: "cleaver", figure: "spearmen", figScale: 1.14, shields: [[SH_ROUND, 0.5], [SH_NONE, 0.5]] },
  goblins:    { id: 24, era: "march", name: "Goblin Rabble", one: "a goblin", glyph: "goblin", speed: 1.40, run: 3.8, spacing: 0.80, armour: 0, reach: 2.3, missile: null, mounted: false, drill: 0.15,
                band: "goblin", kit: "goblinrag", weapons: [W("spear", 0.55), W("shortblade", 0.45)], sidearm: "shortblade", figure: "levy", figScale: 0.66, shields: [[SH_NONE, 1]], stones: true },
  ogres:      { id: 25, era: "march", name: "Ogres", one: "an ogre",         glyph: "brute",  speed: 1.20, run: 3.0, spacing: 2.40, armour: 3, reach: 2.6, missile: null, mounted: false, drill: 0.30,
                band: "ogreish", kit: "brute", weapons: [W("warclub")], figure: "menatarms", figScale: 1.75, shields: [[SH_NONE, 1]] },
  trolls:     { id: 26, era: "march", name: "Trolls",        glyph: "brute",  speed: 1.10, run: 2.8, spacing: 3.00, armour: 4, reach: 2.6, missile: null, mounted: false, drill: 0.25,
                band: "trollish", kit: "brute", weapons: [W("warclub")], figure: "menatarms", figScale: 2.15, shields: [[SH_NONE, 1]] },
  warmage:    { id: 27, era: "march", name: "Battle-Mages", one: "a battle-mage",  glyph: "mage",   speed: 1.25, run: 3.0, spacing: 2.00, armour: 1, reach: 1.4, missile: "spellbolt", mounted: false, drill: 0.60, ammo: 20,
                band: "elite", kit: "adept", weapons: [W("staff")], figure: "villager", shields: [[SH_NONE, 1]], skillMissile: 0.8 },
  shamans:    { id: 28, era: "march", name: "Orc Shamans", one: "an orc shaman",   glyph: "mage",   speed: 1.30, run: 3.2, spacing: 2.00, armour: 1, reach: 1.4, missile: "spellbolt", mounted: false, drill: 0.40, ammo: 14,
                band: "orcish", kit: "adept", weapons: [W("staff")], figure: "villager", figScale: 1.08, shields: [[SH_NONE, 1]], skillMissile: 0.55 },
  // ── The Ardennes, winter 1944 (docs/eras-plan.md). APPENDED, like everything above. Nobody stands in a line
  // here: the spacing is tens of metres, not inches, and what decides a fight is who sees whom first and what
  // cover there is between them — which the simulation has always modelled, at a tenth of the range.
  // The vehicles are ONE SOLDIER EACH (band "crew", a hull for a kit). They are not `mounted`: there is no rider
  // and no horse, only a machine that is shot at and whose men get out when they have had enough.
  riflemen:   { id: 29, era: "ardennes", name: "Riflemen",      glyph: "rifle",    speed: 1.30, run: 3.5, spacing: 2.6, armour: 1, reach: 1.5, missile: "rifle", mounted: false, drill: 0.60, ammo: 80,
                band: "soldier", kit: "gi", weapons: [W("bayonet")], figure: "spearmen", shields: [[SH_NONE, 1]], skillMissile: 0.55 },
  smgsquad:   { id: 30, era: "ardennes", name: "Assault Squads", one: "an assault trooper", glyph: "smg",      speed: 1.35, run: 3.8, spacing: 2.2, armour: 1, reach: 0.7, missile: "smg", mounted: false, drill: 0.70, ammo: 200,
                band: "veteran44", kit: "gi", weapons: [W("smgbutt", 0.6), W("etool", 0.4)], figure: "spearmen", shields: [[SH_NONE, 1]], skillMissile: 0.5 },
  mgteam:     { id: 31, era: "ardennes", name: "Machine Guns", one: "a machine-gunner",   glyph: "mg",       speed: 1.05, run: 2.4, spacing: 3.6, armour: 1, reach: 0.7, missile: "lmg", mounted: false, drill: 0.70, ammo: 600,
                band: "soldier", kit: "guncrew", weapons: [W("etool")], figure: "crossbow", shields: [[SH_NONE, 1]], skillMissile: 0.65 },
  sniper:     { id: 32, era: "ardennes", name: "Snipers",       glyph: "scope",    speed: 1.25, run: 3.2, spacing: 9.0, armour: 0, reach: 1.5, missile: "snipergun", mounted: false, drill: 0.85, ammo: 40,
                band: "veteran44", kit: "gi", weapons: [W("bayonet")], figure: "archers", shields: [[SH_NONE, 1]], skillMissile: 0.95 },
  mortar:     { id: 33, era: "ardennes", name: "Mortars", one: "a mortarman",       glyph: "mortar",   speed: 0.95, run: 2.2, spacing: 5.0, armour: 1, reach: 0.7, missile: "mortar81", mounted: false, drill: 0.65, ammo: 60,
                band: "soldier", kit: "guncrew", weapons: [W("etool")], figure: "crossbow", shields: [[SH_NONE, 1]], skillMissile: 0.5 },
  atgun:      { id: 34, era: "ardennes", name: "Anti-tank Guns", one: "a gunner", glyph: "atgun",    speed: 0.55, run: 1.1, spacing: 7.0, armour: 2, reach: 0.7, missile: "atgun", mounted: false, drill: 0.70, ammo: 40,
                band: "soldier", kit: "guncrew", weapons: [W("etool")], figure: "crossbow", shields: [[SH_NONE, 1]], skillMissile: 0.7 },
  engineers:  { id: 35, era: "ardennes", name: "Pioneers",      glyph: "pioneer",  speed: 1.25, run: 3.3, spacing: 2.6, armour: 1, reach: 0.7, missile: "bazooka", mounted: false, drill: 0.75, ammo: 8,
                band: "veteran44", kit: "gi", weapons: [W("etool")], figure: "spearmen", shields: [[SH_NONE, 1]], skillMissile: 0.6 },
  scoutcar:   { id: 36, era: "ardennes", name: "Scout Cars", one: "a scout-car gunner",     glyph: "car",      speed: 3.50, run: 11.0, spacing: 9.0, armour: 3, reach: 2.8, missile: "autocannon", mounted: false, drill: 0.70, ammo: 400,
                band: "crew", kit: "vehOpen", weapons: [W("tracks")], figure: "hobelars", shields: [[SH_NONE, 1]], skillMissile: 0.6, rankDepth: 12 },
  halftrack:  { id: 37, era: "ardennes", name: "Half-tracks", one: "a half-track driver",    glyph: "halftrack", speed: 3.00, run: 8.5, spacing: 10.0, armour: 3, reach: 2.8, missile: "lmg", mounted: false, drill: 0.65, ammo: 600,
                band: "crew", kit: "vehOpen", weapons: [W("tracks")], figure: "hobelars", shields: [[SH_NONE, 1]], skillMissile: 0.55, rankDepth: 13 },
  tank:       { id: 38, era: "ardennes", name: "Medium Tanks", one: "a tank commander",   glyph: "tank",     speed: 2.20, run: 6.0, spacing: 12.0, armour: 5, reach: 2.8, missile: "tankgun", mounted: false, drill: 0.75, ammo: 50,
                band: "crew", kit: "vehMed", weapons: [W("tracks")], figure: "knights", shields: [[SH_NONE, 1]], skillMissile: 0.7, rankDepth: 15 },
  heavytank:  { id: 39, era: "ardennes", name: "Heavy Tanks", one: "a tank commander",    glyph: "tank",     speed: 1.80, run: 5.0, spacing: 14.0, armour: 5, reach: 2.8, missile: "tankgun88", mounted: false, drill: 0.80, ammo: 40,
                band: "crew", kit: "vehHeavy", weapons: [W("tracks")], figure: "knights", shields: [[SH_NONE, 1]], skillMissile: 0.78, rankDepth: 17 },
  fieldgun:   { id: 40, era: "ardennes", name: "Field Batteries", one: "a gunner", glyph: "howitzer", speed: 0.50, run: 1.0, spacing: 9.0, armour: 1, reach: 0.7, missile: "howitzer", mounted: false, drill: 0.70, ammo: 40,
                band: "soldier", kit: "guncrew", weapons: [W("etool")], figure: "crossbow", shields: [[SH_NONE, 1]], skillMissile: 0.6 },
};
// A company's name is PLURAL, because the story says "the Houffroy half-tracks BREAK AND RUN". The arms of 1944
// were written singular — "Heavy Tank", "Machine Gun" — and the chronicle printed "The Houffroy heavy tank break
// and run at Rochefoy", which is neither one tank nor good English.
// `one:` — what ONE of them is called, when the chronicle names a man (js/sim/battle-story.js). Without it the
// story spells the singular out of the company's name, which gives "a orc warband", "a half-track" and, in the
// battle the owner showed me on 2026-10-20, "a mortar… who felled 12 with his own hand".
// Generic traits (docs/eras-plan.md). The battle AI and the UI reason about a troop type through these rather
// than by name, so an era's own arms — riflemen, orcs, walkers — fall into the same places without a special case.
//   role   line = stands and fights in the press · shock = charges home · missile = kills at a distance
//          skirmish = fast, loose, harasses · support = serves the others · engine = a machine with a crew
//   recon  sent out ahead of the host (never counted as a body of fighting men)
//   heavy  armoured enough that light weapons glance off him
export const ERA_DEFAULT = "vale";
const TRAITS = {
  villager:  { role: "support" },
  levy:      { role: "line" },
  spearmen:  { role: "line" },
  pikemen:   { role: "line", braces: true },
  militia:   { role: "line" },
  menatarms: { role: "line", heavy: true },
  archers:   { role: "missile" },
  crossbow:  { role: "missile" },
  hobelars:  { role: "skirmish" },
  scouts:    { role: "skirmish", recon: true },
  knights:   { role: "shock", heavy: true },
  billmen:     { role: "line" },
  greatswords: { role: "line", heavy: true },
  handgunners: { role: "missile" },
  horsearchers:{ role: "skirmish" },
  dwarves:     { role: "line", heavy: true },
  elfarchers:  { role: "missile" },
  orcs:        { role: "line" },
  goblins:     { role: "line" },
  ogres:       { role: "shock", heavy: true },
  trolls:      { role: "shock", heavy: true },
  warmage:     { role: "missile" },
  shamans:     { role: "missile" },
  riflemen:    { role: "line" },
  smgsquad:    { role: "shock" },
  mgteam:      { role: "missile" },
  sniper:      { role: "missile", recon: true },
  mortar:      { role: "support" },
  atgun:       { role: "support" },
  engineers:   { role: "line" },
  scoutcar:    { role: "vehicle", recon: true },
  halftrack:   { role: "vehicle" },
  tank:        { role: "vehicle", heavy: true },
  heavytank:   { role: "vehicle", heavy: true },
  fieldgun:    { role: "support" },
};

export const ARM_BY_ID = Object.values(ARMS);
export const armKey = (id) => Object.keys(ARMS)[id];
for (const [k, A] of Object.entries(ARMS)) {
  A.key = k; Object.assign(A, TRAITS[k] || {});
  A.era ||= ERA_DEFAULT; A.role ||= A.engine ? "engine" : A.missile ? "missile" : "line"; A.kitId = KIT_ID[A.kit]; A.sidearmId = WEAPON_ID[A.sidearm || "dagger"];
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
      // (under a ram's A-frame roof the men stand close in under the ridge, either side of the hanging beam: at 1 m out
      // the roof is already lower than a man; a tower's pushers stand inside its base)
      const sideX = A.key === "ram" ? 0.62 : ew / 2 - 0.5;
      if (k < perSide * 2) { const side = k & 1 ? 1 : -1, r = k >> 1; out[k] = [side * sideX, el / 2 - 0.6 - r * sp, 0]; }
      else { const j = k - perSide * 2, f = Math.max(2, Math.ceil((A.key === "ram" ? 1.4 : ew) / sp)); out[k] = [((j % f) - (f - 1) / 2) * sp, -el / 2 - (A.key === "ram" ? 1.2 : 0.8) - Math.floor(j / f) * sp, 1]; }
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
