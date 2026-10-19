// The Vale's siege: who holds a castle in the 1340s, who comes to take it, and what they bring.
// Moved out of js/sim/siege-war.js and js/ui/siege-setup.js unchanged. docs/eras-plan.md § A game each.
export const FORCES = {
  small: { name: "A small garrison", note: "A constable and his serjeants; a baron's host outside",
    garrison: [["menatarms", 12], ["spearmen", 24], ["crossbow", 16], ["archers", 12]],
    besiegers: [["menatarms", 40], ["spearmen", 100], ["levy", 120], ["archers", 60], ["crossbow", 30], ["knights", 15]],
    train: { trebuchet: 1, mangonel: 1, ram: 1, siege_tower: 0, mantlet: 3, ladders: 12 } },
  strong: { name: "A strong garrison", note: "A royal castle held in force; a king's army outside",
    garrison: [["menatarms", 24], ["spearmen", 48], ["crossbow", 30], ["archers", 24], ["levy", 24]],
    besiegers: [["menatarms", 80], ["spearmen", 180], ["levy", 200], ["archers", 120], ["crossbow", 60], ["knights", 30], ["hobelars", 20]],
    train: { trebuchet: 2, mangonel: 2, ram: 1, siege_tower: 1, mantlet: 4, ladders: 20 } },
  great: { name: "A great siege", note: "Kenilworth: a whole party of the realm behind the walls",
    garrison: [["menatarms", 40], ["spearmen", 80], ["crossbow", 50], ["archers", 40], ["levy", 60]],
    besiegers: [["menatarms", 120], ["spearmen", 260], ["levy", 300], ["archers", 160], ["crossbow", 80], ["knights", 40], ["hobelars", 30]],
    train: { trebuchet: 3, mangonel: 2, ram: 1, siege_tower: 1, mantlet: 6, ladders: 30 } },
};
// what the setup screen offers on each side, and how many men a click adds
export const GARRISON_ROSTER = ["menatarms", "spearmen", "levy", "crossbow", "archers"];
export const HOST_ROSTER = ["menatarms", "spearmen", "levy", "archers", "crossbow", "knights", "hobelars"];
export const STEP = { menatarms: 8, spearmen: 12, levy: 20, crossbow: 8, archers: 10, knights: 5, hobelars: 10 };
