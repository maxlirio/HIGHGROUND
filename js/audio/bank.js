// The mix: every file in assets/audio is mastered to the same loudness (tools/audio/render.py), so the balance
// between kinds of sound lives here. GAIN in dB; CLASS = how a sound carries (reference distance in metres,
// roll-off exponent: 1 = inverse-distance, lower = carries further — a horn "cuts through at up to ~800 m",
// docs/battle-feel-research.md §7); PRIORITY scales how hard a sound fights for one of the pooled voices;
// LIMIT caps how many of one sound may play at once and how close together they may start.

export const GAIN = {
  clash: -4, shield: -3, bash: -3, plate: -5, mail: -9, body: -4, shaft: -5,
  grunt: -8, cry: -7, groan: -10, shout: -5, warcry_blue: -1, warcry_red: -1, rout_cry: -3,
  bow: -2, xbow: -3, windlass: -12, whoosh: -10, arr_ground: -6, arr_shield: -5, arr_armour: -9, arr_flesh: -7,
  volley: -3, xvolley: -3,
  whinny: -6, snort: -10, horse_scream: -4, cav_impact: 0,
  trebuchet: 0, mangonel: 0, springald: -2, stone_ground: 2, stone_wall: 2, wall_collapse: 3, splinter: -2,
  ram: 1, gate_break: 2, tower_dock: 0, ladder: -4, collapse: 1, ignite: -3, creak: -8,
  horns_massed: -7, skylark: -24, blackbird: -20, chaffinch: -21, cuckoo: -22, crow: -18,
  anvil: -14, axe: -12, dog: -16, bell: -10, cow: -18, sheep: -20,
  bed_surge: 3, bed_grind: 2, bed_roar: 4, bed_arrows: -3, bed_march: -4, bed_trot: -4, bed_gallop: -1,
  bed_rout: -2, bed_fire: -3, bed_wind: -8, bed_after: -6,
  cue_battle: -3, cue_charge: -3, cue_rout: -3, cue_victory: -3, cue_defeat: -3,
};
for (const c of ["advance", "charge", "hold", "retire", "rally"]) for (const t of ["blue", "red"]) GAIN[`horn_${c}_${t}`] = -1;
// castles and sieges (docs/siege-audio.md, tools/audio/sfx_castle.py)
Object.assign(GAIN, { stone_fly: -3, stone_men: 1, masonry_crack: 1, tower_collapse: 5, leaves_break: 2, portcullis_drop: 1, portcullis_raise: -5,
  portcullis_break: 2, ladder_push: -2, mine_fire: -3, mine_collapse: 4, drop_stone: -2, drop_sand: -4, hammer: -12, assault_trumpets: 0,
  bed_belfry: 0, bed_mining: -7, bed_wallwalk: -6, bed_camp: -4 });
// the lord (the player's avatar): his own sounds sit forward in the mix
Object.assign(GAIN, { lord_grunt: -3, lord_cry: -2, lord_shout: 0, swing: -6, couch: -4, crunch: -1, lord_gallop: -2, lord_trot: -4, lord_canter: -3, lord_steps: -8 });

const near = { ref: 4, roll: 1.0 }, mid = { ref: 8, roll: 1.0 }, far = { ref: 20, roll: 0.9 },
  carry = { ref: 40, roll: 0.75, wet: 1.3, detune: 0.01 }, boom = { ref: 30, roll: 0.85, wet: 1.2 },
  bed = { ref: 25, roll: 0.9 }, voice = { ref: 6, roll: 1.0, detune: 0.1 };
export const CLASS = {
  _: mid,
  clash: near, shield: near, bash: near, plate: near, mail: { ref: 3, roll: 1.1 }, body: near, shaft: near,
  grunt: voice, cry: voice, groan: { ref: 4, roll: 1.1, detune: 0.1 }, shout: { ref: 10, roll: 1.0, detune: 0.1 },
  warcry_blue: { ref: 30, roll: 0.9, wet: 1.2, detune: 0.04 }, warcry_red: { ref: 30, roll: 0.9, wet: 1.2, detune: 0.04 },
  rout_cry: { ref: 25, roll: 0.9, detune: 0.05 },
  bow: near, xbow: mid, windlass: { ref: 3, roll: 1.1 }, whoosh: { ref: 3, roll: 1.2 },
  arr_ground: near, arr_shield: near, arr_armour: near, arr_flesh: { ref: 3, roll: 1.1 },
  volley: { ref: 25, roll: 0.9 }, xvolley: { ref: 25, roll: 0.9 },
  whinny: { ref: 12, roll: 1.0, detune: 0.08 }, snort: mid, horse_scream: { ref: 14, roll: 0.95 }, cav_impact: { ref: 25, roll: 0.9 },
  trebuchet: boom, mangonel: boom, springald: far, stone_ground: boom, stone_wall: boom, wall_collapse: { ref: 50, roll: 0.8, wet: 1.3 },
  splinter: mid, ram: boom, gate_break: boom, tower_dock: far, ladder: mid, collapse: boom, ignite: far, creak: mid,
  horns_massed: { ref: 80, roll: 0.75, wet: 1.4, detune: 0.02 },
  skylark: { ref: 20, roll: 1 }, blackbird: { ref: 15, roll: 1 }, chaffinch: { ref: 12, roll: 1 }, cuckoo: { ref: 40, roll: 0.9 },
  crow: { ref: 25, roll: 1 }, anvil: { ref: 30, roll: 0.9 }, axe: { ref: 20, roll: 0.95 }, dog: { ref: 25, roll: 0.95 },
  bell: { ref: 150, roll: 0.8, detune: 0 }, cow: { ref: 30, roll: 0.95 }, sheep: { ref: 20, roll: 1 },
  bed_surge: bed, bed_grind: bed, bed_roar: { ref: 100, roll: 0.75 }, bed_arrows: bed, bed_march: bed, bed_trot: bed,
  bed_gallop: { ref: 35, roll: 0.85 }, bed_rout: bed, bed_fire: { ref: 12, roll: 1 }, bed_after: bed,
};
for (const k of Object.keys(GAIN)) if (k.startsWith("horn_")) CLASS[k] = carry;
Object.assign(CLASS, { stone_fly: { ref: 10, roll: 1.1, wet: 0.6, detune: 0.08 }, stone_men: { ref: 15, roll: 0.95 }, masonry_crack: { ref: 30, roll: 0.85, wet: 1.2 },
  tower_collapse: { ref: 60, roll: 0.75, wet: 1.4, detune: 0.04 }, leaves_break: boom, portcullis_drop: { ref: 25, roll: 0.9, wet: 1.2, detune: 0.03 },
  portcullis_raise: { ref: 12, roll: 1.0, detune: 0.03 }, portcullis_break: boom, ladder_push: { ref: 12, roll: 1.0 },
  mine_fire: { ref: 25, roll: 0.9, wet: 0.4 }, mine_collapse: { ref: 50, roll: 0.8, wet: 0.8, detune: 0.03 }, drop_stone: { ref: 8, roll: 1.0 }, drop_sand: { ref: 8, roll: 1.0 },
  hammer: { ref: 20, roll: 0.95 }, assault_trumpets: { ref: 100, roll: 0.7, wet: 1.4, detune: 0.01 },
  bed_belfry: { ref: 20, roll: 0.9 }, bed_mining: { ref: 10, roll: 1.1 }, bed_wallwalk: { ref: 10, roll: 1.0 } });
Object.assign(CLASS, { lord_grunt: { ref: 6, roll: 1, detune: 0.03 }, lord_cry: { ref: 6, roll: 1, detune: 0.03 }, lord_shout: { ref: 15, roll: 0.95, detune: 0.02 },
  swing: { ref: 4, roll: 1.1 }, couch: { ref: 4, roll: 1 }, crunch: near, lord_gallop: { ref: 8, roll: 1 }, lord_trot: { ref: 8, roll: 1 }, lord_canter: { ref: 8, roll: 1 }, lord_steps: { ref: 5, roll: 1 } });

export const PRIORITY = {
  cav_impact: 6, wall_collapse: 8, gate_break: 6, stone_wall: 4, stone_ground: 4, trebuchet: 4, mangonel: 4, ram: 3,
  volley: 4, xvolley: 4, warcry_blue: 5, warcry_red: 5, rout_cry: 4, horns_massed: 6, collapse: 5, horse_scream: 2.5,
  cry: 1.5, whinny: 1.5, ignite: 2,
  whoosh: 0.5, arr_ground: 0.4, mail: 0.4, grunt: 0.7, creak: 0.5, windlass: 0.5,
  skylark: 0.3, blackbird: 0.3, chaffinch: 0.3, cuckoo: 0.3, crow: 0.4, anvil: 0.5, axe: 0.5, dog: 0.5, cow: 0.4, sheep: 0.4, bell: 1,
};
for (const k of Object.keys(GAIN)) if (k.startsWith("horn_")) PRIORITY[k] = 10;
Object.assign(PRIORITY, { tower_collapse: 9, mine_collapse: 8, assault_trumpets: 10, leaves_break: 6, portcullis_break: 6, portcullis_drop: 5, masonry_crack: 4,
  stone_men: 4, stone_fly: 3, ladder_push: 3, mine_fire: 4, drop_stone: 2, drop_sand: 2, portcullis_raise: 2, hammer: 0.5 });
for (const k of ["lord_grunt", "lord_cry", "lord_shout", "swing", "couch", "crunch"]) PRIORITY[k] = 20; // his blows never lose a voice

export const LIMIT = {
  _: { max: 4, gap: 0.03 },
  clash: { max: 8, gap: 0.02 }, shield: { max: 6, gap: 0.02 }, body: { max: 4, gap: 0.04 }, grunt: { max: 4, gap: 0.05 },
  cry: { max: 3, gap: 0.15 }, groan: { max: 2, gap: 0.5 }, shout: { max: 2, gap: 0.3 },
  bow: { max: 6, gap: 0.02 }, whoosh: { max: 4, gap: 0.05 }, arr_ground: { max: 6, gap: 0.02 }, arr_shield: { max: 4, gap: 0.03 },
  volley: { max: 3, gap: 0.4 }, xvolley: { max: 3, gap: 0.4 }, cav_impact: { max: 3, gap: 0.3 },
  warcry_blue: { max: 2, gap: 1.0 }, warcry_red: { max: 2, gap: 1.0 }, rout_cry: { max: 2, gap: 1.5 }, horns_massed: { max: 1, gap: 3 },
  wall_collapse: { max: 2, gap: 0.5 }, bell: { max: 1, gap: 4 }, dog: { max: 1, gap: 2 },
};
for (const k of Object.keys(GAIN)) if (k.startsWith("horn_")) LIMIT[k] = { max: 2, gap: 0.8 };
Object.assign(LIMIT, { tower_collapse: { max: 1, gap: 2 }, mine_collapse: { max: 1, gap: 1.5 }, assault_trumpets: { max: 1, gap: 5 }, masonry_crack: { max: 2, gap: 0.5 },
  stone_fly: { max: 3, gap: 0.2 }, stone_men: { max: 2, gap: 0.3 }, ladder_push: { max: 3, gap: 0.3 }, drop_stone: { max: 4, gap: 0.08 }, drop_sand: { max: 3, gap: 0.2 },
  portcullis_drop: { max: 2, gap: 0.5 }, portcullis_raise: { max: 2, gap: 1 }, leaves_break: { max: 1, gap: 1 }, portcullis_break: { max: 1, gap: 1 }, hammer: { max: 3, gap: 0.3 } });
