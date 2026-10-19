// The four eras (docs/eras-plan.md).
//
// HIGHGROUND's simulation is men on ground: formation, frontage, morale, fatigue, line of sight over the
// heightfield, cover, footing, weather. None of that is medieval, so the same battle engine fights four
// different wars. An era is DATA — which troops you may field, what powers your commander can call, what
// your men may be given, what the field looks like — and nothing in the simulation knows which one it is.
//
// The Realm (the 1340s manor that sows, reaps and besieges) is not an era: it is the medieval campaign, and
// it stays as it is. Eras are the pitched-battle game: ?mode=battle and ranked.
//
// Arms are APPENDED to the one registry in arms.js, never swapped, so an arm's id — and every save and every
// lockstep realm — is untouched. An era names the keys it may field; `rosterOf` returns the ones that exist
// yet, so an era can be played while its last units are still being built.
import { ARMS } from "./arms.js";
// A war's name, its age, its prose and WHICH OF THE FIVE GAMES it has built live in js/sim/wars.js, which imports
// nothing — the menu (play.html) reads them without dragging the simulation into a page that must come up at once.
// They are spread back into ERAS below so there is one copy of each, and `warHas` decides what the menu offers.
import { WARS, DEFAULT_WAR, warHas, playableWars } from "./wars.js";
export { WARS, warHas, playableWars, warOf, warsWith } from "./wars.js";

// ──────────────────────────────────────────────────────────────────────────── powers
// What a commander can call down, per era. cost is in the battle's power purse (ranked: charges bought in camp).
// r = radius in metres; fx names the animation js/render/powerfx.js plays.
//
// `use` is what a lord who is not a player does with it (js/sim/ranked-rules.js aiCaster), and it is the only thing
// that lets a bot of 1944 call its own fire instead of a blessing it does not have:
//   foe      on the thickest press of the enemy        scared   on his own men nearest to breaking
//   blown    on his own men with no wind left          wounded  on his own hurt men
// A power with no `use` is one only a player can judge the moment for — a smokescreen, a minefield, a recon flight.
const VALE_POWERS = {
  bless:   { name: "Blessing",    cost: 30, r: 60, fx: "bless",   use: "scared", desc: "Your men in 60 m stand steadier (fear −0.35)." },
  mend:    { name: "Mending",     cost: 35, r: 35, fx: "mend",    use: "wounded", desc: "Wounds close on your men within 35 m." },
  thunder: { name: "Thunderclap", cost: 55, r: 45, fx: "thunder", use: "foe", desc: "A crack of thunder over the foe: fear +0.4 — a wavering line may break." },
  smite:   { name: "Smite",       cost: 70, r: 9,  fx: "smite",   use: "foe", desc: "Lightning into the foe; the near ones go down." },
  wind:    { name: "Second Wind", cost: 30, r: 60, fx: "wind",    use: "blown", desc: "Your men in 60 m get their breath back." },
  mist:    { name: "Valley Mist", cost: 45,        fx: "mist",    desc: "A mist on the field: everyone sees half as far for three minutes." },
};

const MARCH_POWERS = {
  firebolt:  { name: "Firebolt",      cost: 40, r: 14, fx: "firebolt",  use: "foe", desc: "A gout of flame bursts among them and sets the ground alight." },
  chain:     { name: "Chain Lightning", cost: 65, r: 40, fx: "chain",   use: "foe", desc: "Lightning leaps from man to man down a line — up to eight." },
  haste:     { name: "Haste",         cost: 45, r: 50, fx: "haste",     use: "blown", desc: "Your men in 50 m move half again as fast for a minute." },
  frost:     { name: "Rime",          cost: 55, r: 45, fx: "frost",     use: "foe", desc: "Frost takes them: the cold saps what wind they had left and they shake." },
  quake:     { name: "Earthshake",    cost: 85, r: 55, fx: "quake",     use: "foe", desc: "The ground heaves — men go sprawling, and a company on its back is no company." },
  mend:      { name: "Mending Light", cost: 35, r: 35, fx: "mend",      use: "wounded", desc: "Wounds close on your men within 35 m." },
  bless:     { name: "Warding",       cost: 30, r: 60, fx: "bless",     use: "scared", desc: "Your men in 60 m stand steadier (fear −0.35)." },
};

const ARDENNES_POWERS = {
  barrage:  { name: "Artillery Barrage", cost: 70, r: 60, fx: "barrage",  use: "foe", desc: "Called fire walks across 60 m: shells for twenty seconds." },
  smoke:    { name: "Smoke Screen",      cost: 30, r: 70, fx: "smoke",    desc: "A wall of smoke: nobody sees through it for two minutes." },
  airstrike:{ name: "Air Strike",        cost: 90, r: 35, fx: "airstrike",use: "foe", desc: "A fighter-bomber comes in low and strafes the length of your mark." },
  mines:    { name: "Mine Field",        cost: 40, r: 25, fx: "mines",    desc: "Mines sown on an approach; anyone who crosses pays." },
  supply:   { name: "Supply Drop",       cost: 35, r: 45, fx: "supply",   use: "blown", desc: "Ammunition and water: your men in 45 m re-arm and get their wind back." },
  recon:    { name: "Recon Flight",      cost: 25,        fx: "recon",    desc: "A spotter overflies the field: you see everything for thirty seconds." },
};

const KEPLER_POWERS = {
  orbital:  { name: "Orbital Strike",  cost: 95, r: 30, fx: "orbital",  use: "foe", desc: "A lance from orbit. Everything inside 30 m is gone; the ground glasses over." },
  dome:     { name: "Shield Dome",     cost: 55, r: 40, fx: "dome",      use: "scared", desc: "A hard-light dome over 40 m: nothing shot from outside gets in for ninety seconds." },
  drop:     { name: "Drop Pods",       cost: 80, r: 20, fx: "drop",      desc: "A reserve company falls out of the sky where you point." },
  emp:      { name: "EMP Burst",       cost: 50, r: 50, fx: "emp",       use: "foe", desc: "Shields collapse, walkers stall and energy weapons go dead for a minute." },
  cloak:    { name: "Cloaking Field",  cost: 45, r: 45, fx: "cloak",     desc: "Your men in 45 m cannot be seen until they open fire." },
  nanites:  { name: "Nanite Swarm",    cost: 40, r: 35, fx: "nanites",   use: "wounded", desc: "Wounds knit and armour reknits on your men within 35 m." },
};

// ──────────────────────────────────────────────────────────────────────────── perks
// What a company may be given. Costed as a share of the company's worth, so a perk is never free: in a muster
// the men you give it to are fewer. `on` limits it to the roles it makes sense for.
const VALE_PERKS = {
  stakes:    { name: "Stakes",        cost: 0.06, on: ["missile"],            desc: "Sharpened stakes planted before them; horse will not come on." },
  pavise:    { name: "Pavises",       cost: 0.08, on: ["missile"],            desc: "Big shields propped in the ground: cover against shot." },
  fire:      { name: "Fire arrows",   cost: 0.10, on: ["missile"],            desc: "Pitch-headed shafts that set thatch and engines alight." },
  veteran:   { name: "Old campaigners", cost: 0.15, on: ["line", "shock", "missile", "skirmish"], desc: "They have seen this before: nerve and skill up, and they rally." },
  oathsworn: { name: "Oath-sworn",    cost: 0.18, on: ["line", "shock"],      desc: "Sworn not to run: they will break before they rout." },
  hillbred:  { name: "Hill-bred",     cost: 0.07, on: ["line", "missile", "skirmish"], desc: "Born to slopes and bad ground: no fatigue penalty uphill." },
  light:     { name: "Stripped down", cost: 0.05, on: ["line", "skirmish"],   desc: "Armour left with the baggage: faster, and easier to kill." },
};

const MARCH_PERKS = {
  frenzy:    { name: "Blood-frenzy",  cost: 0.14, on: ["line", "shock"],      desc: "They fight on past what should stop them, and they do not hear the horn." },
  runes:     { name: "Rune-shields",  cost: 0.12, on: ["line", "shock"],      desc: "Shields cut with wards: magic breaks on them." },
  poison:    { name: "Poisoned blades", cost: 0.11, on: ["line", "skirmish"], desc: "Wounds fester: a man cut keeps weakening." },
  farsight:  { name: "Farsight",      cost: 0.08, on: ["missile"],            desc: "Elf-sighted: they shoot further and truer." },
  stoneskin: { name: "Stoneskin",     cost: 0.16, on: ["line"],               desc: "Dwarf-wrought plate and a smith's blessing: little gets through." },
};

const ARDENNES_PERKS = {
  dug:       { name: "Dug in",        cost: 0.10, on: ["line", "missile", "support"], desc: "Scrapes and sandbags where they stand: hard cover from the front." },
  camo:      { name: "Camouflaged",   cost: 0.08, on: ["line", "missile", "skirmish"], desc: "Netting and branches: not seen until they fire." },
  ap:        { name: "AP ammunition", cost: 0.12, on: ["missile", "vehicle"], desc: "Armour-piercing rounds: they can hurt armour." },
  grenades:  { name: "Smoke grenades", cost: 0.06, on: ["line", "skirmish"],  desc: "They can screen themselves once, wherever they are." },
  nco:       { name: "Veteran NCOs",  cost: 0.15, on: ["line", "missile", "skirmish", "vehicle"], desc: "They hold under fire, and they get moving again after." },
  assault:   { name: "Assault pioneers", cost: 0.13, on: ["line"],            desc: "Charges and wire-cutters: they clear obstacles and bunkers." },
};

const KEPLER_PERKS = {
  hardened:  { name: "Hardened shields", cost: 0.14, on: ["line", "shock", "vehicle"], desc: "Shield emitters that hold twice as long and come back faster." },
  overcharge:{ name: "Overcharged cells", cost: 0.12, on: ["missile", "vehicle"], desc: "More power through the coils: harder hits, and they run hot." },
  jump:      { name: "Jump packs",    cost: 0.16, on: ["line", "shock", "skirmish"], desc: "They cross ground — and walls, and water — in bounds." },
  stealth:   { name: "Stealth coating", cost: 0.10, on: ["skirmish", "missile"], desc: "Cold and radar-dark: not seen until they are close." },
  linked:    { name: "Linked fire",   cost: 0.11, on: ["missile"],            desc: "One targeting solution shared: the whole company shoots as one." },
  reactive:  { name: "Reactive armour", cost: 0.13, on: ["vehicle"],          desc: "Plates that fire outward: the first hit on each facing is shrugged off." },
};

// ──────────────────────────────────────────────────────────────────────────── the eras
// roster  the arm keys this era may field, in the order the roster lists them
// charges the heraldry charges offered by its forge (js/ui/heraldry.js)
// look    the UI's colours and the field's dressing
export const ERAS = {
  vale: {
    ...WARS.vale,
    // (scouts were missing from this list while ranked sold them for 150 spoils: a lord could muster the men who
    //  find the foe and then never field them in a pitched battle. Found by tools/ranked-eras-test.mjs, 2026-10-20.)
    roster: ["levy", "spearmen", "pikemen", "militia", "billmen", "greatswords", "archers", "crossbow", "handgunners", "scouts", "hobelars", "horsearchers", "menatarms", "knights"],
    powers: VALE_POWERS, perks: VALE_PERKS, purse: 180,
    lord: "knights", // who rides with the lord when he takes the field (js/sim/avatar.js takeField): a knight and his household
    charges: ["mullet", "tower", "roundel", "saltire", "crescent", "cross", "chevron", "key", "sword", "boar", "lion", "eagle"],
    look: { ink: "#e8dcc0", card: "#221c14", line: "#4b3d28", gold: "#c9a227" },
    weather: ["clear", "overcast", "rain", "fog", "wind", "storm", "snow"],
  },
  march: {
    ...WARS.march,
    roster: ["goblins", "orcs", "spearmen", "dwarves", "ogres", "trolls", "elfarchers", "archers", "shamans", "warmage", "horsearchers", "knights"],
    powers: MARCH_POWERS, perks: MARCH_PERKS, purse: 260,
    lord: "knights",
    charges: ["wyvern", "rune", "hammer", "oak", "flame", "moon", "mullet", "sword", "boar", "eye", "crown", "serpent"],
    look: { ink: "#e4dcf0", card: "#1b1826", line: "#453a63", gold: "#b58cf0" },
    weather: ["clear", "overcast", "rain", "fog", "storm", "snow"],
  },
  ardennes: {
    ...WARS.ardennes,
    roster: ["riflemen", "smgsquad", "mgteam", "sniper", "mortar", "atgun", "engineers", "scoutcar", "halftrack", "tank", "heavytank", "fieldgun"],
    powers: ARDENNES_POWERS, perks: ARDENNES_PERKS, purse: 220,
    lord: "smgsquad", // (an officer and his headquarters section, on foot: there are no destriers in 1944)
    charges: ["star", "chevron", "wing", "bolt", "skull", "oak", "cross", "roundel", "spearhead", "anchor", "lion", "eagle"],
    look: { ink: "#dfe3d8", card: "#1d2118", line: "#3e4636", gold: "#b9a24a" },
    weather: ["overcast", "fog", "snow", "rain", "clear"],
  },
  kepler: {
    ...WARS.kepler,
    wip: true,   // nothing of it is built yet
    roster: ["troopers", "heavytroopers", "shieldline", "railsniper", "droptroops", "scoutdrone", "warbots", "walker", "hovertank", "plasmagun", "artillerypod", "commandnode"],
    powers: KEPLER_POWERS, perks: KEPLER_PERKS, purse: 300,
    charges: ["sigil", "bolt", "star", "wing", "ring", "spearhead", "eye", "triangle", "hex", "crown", "serpent", "flame"],
    look: { ink: "#d8e8f0", card: "#121a22", line: "#2d4656", gold: "#4fd3e0" },
    weather: ["clear", "overcast", "fog", "storm", "snow"],
  },
};

export const ERA_KEYS = Object.keys(ERAS);
export const DEFAULT_ERA = DEFAULT_WAR;   // the Vale: the game as it was first built
export const eraOf = (key) => ERAS[key] || ERAS[DEFAULT_ERA];

// The roster as it can be played TODAY: an era may name arms whose models are still being built.
export const rosterOf = (key) => eraOf(key).roster.filter((a) => ARMS[a]);
// what it is still waiting for
export const pendingOf = (key) => eraOf(key).roster.filter((a) => !ARMS[a]);
export const eraReady = (key) => pendingOf(key).length === 0;
// Every era that can be fielded at all (the Vale always can).
//
// `wip` keeps an era OUT OF THE PICKER while its troops exist in the simulation but have no models of their own.
// This is not bookkeeping: the moment an era's arms are in arms.js, `rosterOf` counts them and the era would
// appear — and figures.js falls back to whatever `figure:` names, so the Ardennes would take the field in 1944
// with riflemen drawn as medieval spearmen and Tiger tanks drawn as knights on horseback. The owner,
// 2026-10-18: "don't like make new parts for a spear man or make a horse look like a tank, I want them to be
// new models." The flag comes off when the models are baked, and not before.
export const playableEras = () => ERA_KEYS.filter((k) => !ERAS[k].wip && rosterOf(k).length >= 4 && warHas(k, "battle"));
// which era an arm belongs to (arms.js carries it; eras own the roster order)
export const eraOfArm = (arm) => ARMS[arm]?.era || DEFAULT_ERA;
export const powersOf = (key) => eraOf(key).powers;
export const perksOf = (key) => eraOf(key).perks;
// the perks a given arm may take (a perk names the roles it suits)
export function perksFor(era, arm) {
  const A = ARMS[arm]; if (!A) return [];
  return Object.entries(perksOf(era)).filter(([, P]) => !P.on || P.on.includes(A.role)).map(([k, P]) => ({ key: k, ...P }));
}
