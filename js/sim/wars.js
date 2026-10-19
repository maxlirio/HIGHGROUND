// The wars, as the menu sees them.
//
// HIGHGROUND is three games sharing one engine. The owner, 2026-10-19, shown the eras laid out as a row of tabs
// inside one Pitched Battle screen: "The different eras of warfare are for 3 separate game modes, not all combined
// into one!" — and, asked how far to pull them apart, chose a FULL GAME EACH: every war with its own campaign, its
// own sieges, its own ranked ladder. docs/eras-plan.md § A game each.
//
// So a war is chosen FIRST, at the menu (play.html), and carried in the URL from there: ?era=march&mode=battle.
// Nothing inside a battle offers you another age any more.
//
// This module is a LEAF — it imports nothing. play.html is a plain page that must come up instantly and has no
// business loading the simulation to draw a menu, while js/sim/eras.js (which does know about troops, powers and
// perks) spreads these fields back in so there is one copy of each war's name and prose.
//
//   fields  which of the five games this war actually has built. The menu offers these and nothing else, so a war
//           with no campaign does not show a Campaign button that leads somewhere broken.
//             realm     the family's always-on world — the Vale's alone, and there is only one of it
//             campaign  a lordship to run: an economy, a town, a recruitment chain
//             battle    two hosts drawn up on a field
//             siege     a fortress to take or to hold
//             ranked    a ladder of its own: standings, spoils, an army list kept between matches
//   note    what is still missing, in the owner's words rather than a status flag. Shown under the war's name.
export const WARS = {
  vale: {
    key: "vale", name: "The Vale", when: "1340s", kicker: "Men, horses and the longbow",
    blurb: "A border vale in the 1340s. Lines of men a few ranks deep, a bowshot of killing ground, and horse "
      + "looking for an open flank. Ground is everything: a slope, a hedge, a ford, a wood to anchor on.",
    fields: ["realm", "campaign", "battle", "siege", "ranked"],
  },
  march: {
    key: "march", name: "The Riven Marches", when: "an age of legend", kicker: "Steel, monsters and real magic",
    blurb: "The old border where the Free Hosts hold the passes against what comes down out of the Riven lands. "
      + "Dwarf shieldwalls and elf-sighted bowmen against orc warbands, wolf-riders and worse — and here the "
      + "magic is not a blessing muttered over a wavering line. It is fire down a hillside.",
    fields: ["battle", "siege", "ranked"],
    note: "Its hosts take the field, its holds can be stormed and its ladder is open. No campaign behind them yet.",
  },
  ardennes: {
    key: "ardennes", name: "The Ardennes", when: "winter 1944", kicker: "Cover, armour and the eighty-eight",
    blurb: "Fir woods, fog and frozen mud. Nobody stands in a line here: men move in rushes from cover to cover, "
      + "a single machine gun shuts a field, and the ground decides which tank sees the other first. Everything "
      + "the Vale taught about slopes and dead ground still holds — at ten times the range.",
    fields: ["battle", "ranked"],
    note: "Twelve kinds of troops with a ladder of their own. No campaign behind them yet.",
  },
  kepler: {
    key: "kepler", name: "Kepler Reach", when: "the far colonies", kicker: "Shields, walkers and fire from orbit",
    blurb: "A contested world at the end of the Reach. Power-armoured line companies behind hard-light shields, "
      + "walkers stepping over the ground that stops armour, drop pods coming down behind your flank — and a ship "
      + "overhead that can put a lance through a hilltop if someone gives it the coordinates.",
    fields: [],
    note: "Written, not built: its twelve troop types have neither numbers nor models.",
  },
};

export const WAR_KEYS = Object.keys(WARS);
export const DEFAULT_WAR = "vale";
export const warOf = (key) => WARS[key] || WARS[DEFAULT_WAR];
// Does this war have that game built? Everything the menu shows is decided here and nowhere else.
export const warHas = (key, mode) => !!WARS[key]?.fields.includes(mode);
// the wars you can play at all, in the order they are listed
export const playableWars = () => WAR_KEYS.filter((k) => WARS[k].fields.length);
// which war a given mode belongs to, for the modes only one war has
export const warsWith = (mode) => WAR_KEYS.filter((k) => warHas(k, mode));
