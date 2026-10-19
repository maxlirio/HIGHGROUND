// The Vale's ranked ladder: what a lord of the 1340s starts with, what his spoils unlock, the picked companies he
// can keep and what his commander can learn. Moved out of js/sim/ranked-rules.js unchanged — these numbers are the
// ones the family's standings were won against, so not one of them moves. docs/eras-plan.md § A game each.
export const STARTER = [["levy", 40], ["spearmen", 30], ["archers", 20]]; // a small shire muster: 160 d a day

// What spoils unlock. A new lord musters levies, spearmen and longbowmen; everything else is earned. The order is
// the order a lord would learn it: his own shire's foot, then the town's, then men who need gear and training,
// then horse, then the men he must pay a wage worth having.
export const ARM_UNLOCK = {
  levy: 0, spearmen: 0, archers: 0,
  pikemen: 40, billmen: 60, militia: 70, crossbow: 90,
  hobelars: 140, handgunners: 150, scouts: 150,
  horsearchers: 220, menatarms: 280, greatswords: 400, knights: 560,
};

export const SPECIAL_OPS = {
  foresters: { name: "Foresters", arm: "archers", n: 15, pos: "ambush", drill: 2, cost: 160, desc: "Fifteen elite bowmen lying in a wood beside the field: they loose into the flank when the foe comes near." },
  reserve: { name: "The Hidden Reserve", arm: "menatarms", n: 20, pos: "hidden", drill: 1, cost: 320, desc: "Twenty men-at-arms out of sight behind your line: they come in when the fighting is well joined." },
  outriders: { name: "Outriders", arm: "hobelars", n: 15, pos: "horse-left", drill: 1, cost: 160, desc: "Fifteen light horse on a flank, for the rear and the fleeing." },
  pavisiers: { name: "Pavisiers", arm: "crossbow", n: 20, pos: "front", drill: 1, stakes: true, cost: 190, desc: "Twenty crossbowmen behind their stakes before the line." },
  household: { name: "Household Knights", arm: "knights", n: 6, pos: "horse-right", drill: 2, cost: 280, desc: "Six of your own knights, the best horse in the field." },
};

// A skill's KEY is what the battle reads (js/sim/ranked-rules.js hostCompanies / applySkills) and what a lord's
// unlocks are written down as, so every war uses the same keys and gives them its own name. A war leaves one out
// when the thing it does makes no sense there, rather than printing a promise the field will not keep.
export const SKILLS = {
  discipline: { name: "Iron Discipline", cost: 220, desc: "Your men steady faster: fear wears off them a third quicker." },
  drillmaster: { name: "Drillmaster", cost: 260, desc: "Every company a step better drilled than its rank." },
  quartermaster: { name: "Quartermaster", cost: 140, desc: "Double sheaves of arrows and bolts for every bow." },
  marchers: { name: "Hard Marchers", cost: 180, desc: "Your men get their wind back twice as fast." },
  eagle: { name: "Eagle Eye", cost: 200, desc: "Your scouts find the foe's ambushes and hidden men before the trumpets." },
  stakes: { name: "Master of Stakes", cost: 150, desc: "Every bow company drives its stakes before the battle." },
};

// Which companies may plant stakes before them, and the mix a brand-new lord's list is filled out of — the three
// arms every lord has, because numbers are the one thing he is never short of. What he lacks is choice.
export const STAKE_ARMS = ["archers", "crossbow"];
export const FILL_MIX = { levy: 0.34, spearmen: 0.4, archers: 0.26 };

// Quartermaster: what a company carries when the commander has learned it. Written out rather than doubled from
// the arm's own load because these are the numbers the family's standings were won against — a longbowman's
// hundred and twenty shafts and a crossbowman's eighty, not his sixty and his thirty doubled.
export const QM_AMMO = { archers: 120, crossbow: 80 };
