// The Ardennes' ranked ladder, winter 1944. A company commander begins with what a rifle company IS — riflemen,
// an assault section and a machine gun — and earns everything that supports it: the men with a trade, then the
// guns, then the vehicles, then armour. docs/eras-plan.md § A game each.
//
// A heavy tank is 980 spoils because it is 58 d a day and it kills everything on the field. That is the longest
// climb in any of the three wars, and it is meant to be.
export const STARTER = [["riflemen", 50], ["smgsquad", 15], ["mgteam", 5]]; // a rifle company at strength: 195 d a day

export const ARM_UNLOCK = {
  riflemen: 0, smgsquad: 0, mgteam: 0,
  engineers: 120, sniper: 150, mortar: 190, scoutcar: 230,
  halftrack: 280, atgun: 320, fieldgun: 480, tank: 680, heavytank: 980,
};

export const SPECIAL_OPS = {
  patrol: { name: "Recon Patrol", arm: "scoutcar", n: 4, pos: "horse-left", drill: 1, cost: 180, desc: "Four armoured cars out on a flank: they are there to see, and to catch what runs." },
  pioneers: { name: "Assault Pioneers", arm: "engineers", n: 12, pos: "hidden", drill: 1, cost: 200, desc: "Twelve pioneers held out of sight with charges and launchers, for the moment armour commits." },
  hide: { name: "Sniper Hide", arm: "sniper", n: 4, pos: "ambush", drill: 2, cost: 170, desc: "Four marksmen dug in beside the field before anyone arrives. They take the men who matter." },
  gunline: { name: "The Gun Line", arm: "atgun", n: 4, pos: "front", drill: 1, cost: 240, desc: "Four six-pounders sited forward with a field of fire. Nothing on tracks crosses it cheaply." },
  armour: { name: "Armoured Reserve", arm: "tank", n: 3, pos: "reserve", drill: 2, cost: 420, desc: "Three tanks kept back behind the line and thrown in where it breaks." },
};

// No Master of Stakes here: stakes stop horse, and there is no horse in 1944. A war leaves out what its field
// would not honour rather than printing the promise and ignoring it.
export const SKILLS = {
  discipline: { name: "Steady Under Fire", cost: 220, desc: "Your men steady faster: fear wears off them a third quicker." },
  drillmaster: { name: "Veteran NCOs", cost: 260, desc: "Every section a step better trained than its rank." },
  quartermaster: { name: "Full Ammunition Load", cost: 140, desc: "Double the belts and the clips for every gun in the company." },
  marchers: { name: "Hard Marchers", cost: 180, desc: "Your men get their wind back twice as fast." },
  eagle: { name: "Forward Observer", cost: 200, desc: "Your scouts find the foe's dug-in and hidden men before the first round." },
};

// Nothing plants stakes in 1944: stakes stop horse, and there is no horse here.
export const STAKE_ARMS = [];
export const FILL_MIX = { riflemen: 0.55, smgsquad: 0.27, mgteam: 0.18 };

// Full ammunition load: double the belts, the clips and the bombs. A rifle company's riflemen count too — in 1944
// the man with the rifle is the one who runs out.
export const QM_AMMO = { riflemen: 160, smgsquad: 400, mgteam: 1200, sniper: 80, mortar: 120, atgun: 80, fieldgun: 80, engineers: 16 };
