// The Riven Marches' siege: a hold of the Free Hosts, and what comes down out of the Riven lands to take it.
//
// The castle itself needs nothing new — stone is stone, a gate is a gate, and a troll on a ladder is the same
// problem as a man on a ladder, which is why this war could be given its sieges for the price of a table while
// the Ardennes cannot (an assault on a fortified line is not a castle). docs/eras-plan.md § A game each.
//
// The engines are the Vale's. A counterweight trebuchet is not a medieval idea so much as a true one, and the
// peoples who cut the Deep Roads can certainly frame one up.
//
// Both sides are sized by WORTH — the horde about 5:1 against a small hold and 4:1 against a great one, as the
// Vale's hosts are. Two drafts were thrown away getting here:
//   · The first counted BODIES. A horde five times the garrison in men but only three times its worth threw
//     goblins at dwarves on a wall and burnt its engines; of eight headless sieges the besiegers took three.
//   · The second bought the worth back in ogres and trolls alone and did WORSE, and one siege never resolved.
//     Thirty monsters cannot carry a wall that two hundred men hold, however much they cost: an escalade is
//     decided man by man on a ladder.
// Two things were actually wrong, and neither was the worth.
//   · The GARRISON. A hold of dwarves at 28 d a day is not the Vale's 12 d men-at-arms with another name — it is
//     better troops for the same money. The hold now keeps a small Deep Guard and a mass of ordinary spearmen,
//     bowmen and goblin levy, which is the shape the Vale's garrisons have.
//   · The horde HAD NO BOWMEN. A besieger's archers are what keep the wall's heads down while men are on the
//     ladders; the Vale's host brings 180 of them to a strong siege and the horde was bringing 54. Counted that
//     way the answer was obvious, and it was not obvious at all until the two hosts were laid out side by side
//     BY ROLE rather than by headcount or by worth.
export const FORCES = {
  small: { name: "A border hold", note: "A thane and his hearth-guard; a warband at the gate",
    garrison: [["dwarves", 4], ["spearmen", 24], ["elfarchers", 12], ["archers", 12], ["goblins", 20]],
    besiegers: [["orcs", 220], ["goblins", 160], ["archers", 70], ["shamans", 16], ["ogres", 10], ["trolls", 5], ["horsearchers", 20]],
    train: { trebuchet: 1, mangonel: 1, ram: 1, siege_tower: 0, mantlet: 3, ladders: 12 } },
  strong: { name: "A hold in force", note: "The Deep Guard on the walls; a horde come down out of the Riven lands",
    garrison: [["dwarves", 8], ["spearmen", 48], ["elfarchers", 24], ["archers", 24], ["goblins", 48]],
    besiegers: [["orcs", 340], ["goblins", 240], ["archers", 140], ["shamans", 24], ["ogres", 30], ["trolls", 11], ["horsearchers", 30]],
    train: { trebuchet: 2, mangonel: 2, ram: 1, siege_tower: 1, mantlet: 4, ladders: 20 } },
  great: { name: "The last hold", note: "Everything the Free Hosts have left behind the walls — and everything that wants it",
    garrison: [["dwarves", 14], ["spearmen", 80], ["elfarchers", 40], ["archers", 40], ["goblins", 80]],
    besiegers: [["orcs", 380], ["goblins", 260], ["archers", 200], ["shamans", 32], ["ogres", 56], ["trolls", 24], ["horsearchers", 40]],
    train: { trebuchet: 3, mangonel: 2, ram: 1, siege_tower: 1, mantlet: 6, ladders: 30 } },
};
export const GARRISON_ROSTER = ["dwarves", "spearmen", "goblins", "elfarchers", "archers"];
export const HOST_ROSTER = ["orcs", "goblins", "ogres", "trolls", "shamans", "horsearchers", "archers"];
export const STEP = { dwarves: 6, spearmen: 12, goblins: 30, elfarchers: 10, archers: 10, orcs: 20, ogres: 4, trolls: 2, shamans: 6, horsearchers: 10 };
