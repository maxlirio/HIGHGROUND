// Which texture set (assets/terrain/<name>_*.png) renders each sim surface key (js/sim/terrain-types.js).
// Several sim surfaces can share a texture; the sim still treats them differently.
export const SURFACE_TEX = {
  short_meadow: "short_meadow", tall_grass: "tall_grass", flower_meadow: "flower_meadow", pasture: "grazed_pasture",
  water_meadow: "tall_grass", heath_heather: "heath", moorland: "moorland", gorse_scrub: "gorse_scrub", bracken: "bracken",
  fallow: "fallow_field", ploughed_field: "ploughed_field", standing_wheat: "wheat_field", standing_barley: "barley_field",
  standing_oats_beans: "fallow_field", stubble: "stubble_field", vineyard: "vineyard", orchard: "orchard_grass",
  kitchen_garden: "fallow_field", open_forest: "forest_floor", dense_forest: "forest_floor", pine_forest: "pine_floor",
  coppice: "forest_floor", bramble_thicket: "bramble", hedgerow: "bramble", alder_carr: "marsh", deadfall_clearing: "forest_floor",
  bare_earth: "bare_earth", dirt_track: "dirt_track", hollow_way: "dirt_track", cobbled_road: "cobbled_road",
  stone_paving: "stone_paving", village_street: "churned_ground", trampled_ground: "churned_ground", battlefield_churn: "mud",
  mud: "mud", clay_heavy: "clay_heavy", peat_bog: "peat_bog", marsh: "marsh", reed_bed_fen: "reed_bed_fen", salt_marsh: "marsh",
  tidal_mudflat: "riverbank_mud", shallow_ford: "shallow_ford", stream_bed: "riverbank_shingle", deep_water: "riverbank_mud",
  riverbank_shingle: "riverbank_shingle", gravel: "gravel", sand: "sand", dunes: "dunes", beach_wet: "beach_wet", chalk_downland: "chalk_downland",
  limestone_pavement: "limestone_pavement", scree: "scree", cliff_rock: "cliff_rock", rock_slab: "rock_slab",
  boulder_field: "boulder_field", quarry_floor: "ruins_rubble", snow_light: "snow_light", snow_deep: "snow_light", slush: "snow_trampled",
  frozen_ground: "frozen_ground", ice: "ice", burned_ground: "burned_ground", ruins_rubble: "ruins_rubble", ditch: "ditch",
  earth_rampart: "ditch", camp_ground: "churned_ground",
};
export const ROCK_TEX = "rock_slab"; // steep slopes blend to this regardless of surface
