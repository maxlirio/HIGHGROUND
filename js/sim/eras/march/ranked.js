// The Riven Marches' ranked ladder. A captain of the Free Hosts begins with what the passes always had — goblin
// rabble, orc fighters and bowmen — and earns the rest: the steady peoples, then the sighted ones, then the
// riders, then what magic and what monsters he can pay for. docs/eras-plan.md § A game each.
//
// The costs run at about 23 spoils per penny of a man's daily wage, as the Vale's do, so a ladder that is dearer
// here is dearer because the troops are: a troll is 34 d a day where a knight is 24.
export const STARTER = [["goblins", 50], ["orcs", 30], ["archers", 20]]; // a warband come down from the hills: 170 d a day

export const ARM_UNLOCK = {
  goblins: 0, orcs: 0, archers: 0,
  spearmen: 40, elfarchers: 90, horsearchers: 140,
  shamans: 210, warmage: 380, ogres: 500, knights: 560, dwarves: 600, trolls: 700,
};

export const SPECIAL_OPS = {
  skulkers: { name: "Goblin Skulkers", arm: "goblins", n: 30, pos: "ambush", drill: 1, cost: 140, desc: "Thirty goblins in the scrub beside the field. They are nothing in a line and murder in a flank." },
  deepguard: { name: "The Deep Guard", arm: "dwarves", n: 10, pos: "hidden", drill: 2, cost: 340, desc: "Ten dwarves of the hold's own guard, kept out of sight until the line needs them." },
  wolfriders: { name: "Wolf-riders", arm: "horsearchers", n: 12, pos: "horse-left", drill: 1, cost: 160, desc: "Twelve riders on a flank, loosing as they go, for the rear and the fleeing." },
  wardens: { name: "Elf Wardens", arm: "elfarchers", n: 15, pos: "front", drill: 2, stakes: true, cost: 200, desc: "Fifteen elf-sighted bowmen behind sharpened stakes before the line." },
  ogreguard: { name: "The Ogre Guard", arm: "ogres", n: 4, pos: "reserve", drill: 2, cost: 300, desc: "Four ogres held back until the fighting is joined, and then put where it is thickest." },
};

export const SKILLS = {
  discipline: { name: "Oathbound", cost: 220, desc: "Your host steadies faster: fear wears off a third quicker." },
  drillmaster: { name: "Warmaster", cost: 260, desc: "Every company a step better drilled than its rank." },
  quartermaster: { name: "Fletcher's Hall", cost: 140, desc: "Double sheaves of arrows for every bow in the host." },
  marchers: { name: "Hill-bred", cost: 180, desc: "Your men get their wind back twice as fast." },
  eagle: { name: "Far-sighted", cost: 200, desc: "Your scouts find the foe's ambushes and hidden men before the horns." },
  stakes: { name: "Stakes and Pits", cost: 150, desc: "Every bow company plants its stakes before the battle." },
};

export const STAKE_ARMS = ["archers", "elfarchers"];
export const FILL_MIX = { goblins: 0.34, orcs: 0.4, archers: 0.26 };

// Fletcher's Hall: double sheaves for every bow in the host, elf-fletched and otherwise.
export const QM_AMMO = { archers: 120, crossbow: 80, elfarchers: 100, horsearchers: 80, shamans: 28, warmage: 40 };
