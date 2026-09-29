// HIGHGROUND — terrain, feature, elevation and weather data for the simulation.
// Research basis and citations: docs/combat-research.md, docs/economy-research.md.
// DATA ONLY. No behaviour lives here; the sim reads these tables.
//
// ───────────────────────────── FIELD REFERENCE ─────────────────────────────
// moveMul        {foot, heavyFoot, cavalry, cart}: speed multiplier relative to the SAME
//                arm on a dry, firm dirt track (= 1.0). 0 = impassable for that arm.
//                heavyFoot = armoured men-at-arms on foot (≥25 kg kit). Askew et al. 2012:
//                locomotion in armour costs ×2.1–2.3, and soft ground punishes the extra
//                mass and limb loading much more.
// fatigueMul     Pandolf terrain factor η (blacktop 1.0, dirt road 1.1, light brush 1.2,
//                heavy brush 1.5, swampy bog 1.8, loose sand 2.1, snow 15/25/35 cm =
//                2.5/3.3/4.1). It multiplies the locomotion term of the Pandolf metabolic
//                equation.
// footing        {slip, fall}: per-melee-exchange probability of a stumble (next defence
//                −0.3) and of going DOWN. Baseline, dry firm turf: 0.010 / 0.002.
// chargeViable   0..1 multiplier on achievable cavalry charge speed and cohesion
//                (1 = ideal: firm, open, level). <0.3: horses won't gallop. 0: no charge.
// cohesionMul    0..1 multiplier on the formation-keeping of any unit moving or fighting
//                here (du Picq: order is everything). Woods break formations.
// cover          {soft, hard}: probability that the terrain itself intercepts a missile
//                aimed at a STANDING man inside it. soft = vegetation (deflects, may not
//                stop), hard = solid (stops). Prone/kneeling: ×1.5, capped at 0.95.
// concealment    {standing, prone}: 0..1 reduction of the observer's detection probability.
// dust           0..1 dust raised when dry (multiplied by movers' mass and speed). It is
//                visible at km range and obscures banner signals and aimed fire.
// digIn          0..1 ease of entrenching, a multiplier on 4.2 m³ per man-day
//                (Motte-and-bailey labour estimates). 0 = cannot dig.
// wetSensitivity −1..1 (negative = rain IMPROVES it, e.g. sand firms up) how strongly rain degrades this ground toward `wetTo` per hour of
//                rain (see WEATHER.*.groundWetRate). 0 = unaffected.
// wetTo          terrain id it becomes when saturated (null = stays, but slicker).
// fireRisk       0..1 relative spread/ignition hazard per minute in dry summer weather.
// forage         {graze: horse-days/ha, food: person-days/ha, wood: t/ha usable}.
//                Horse ≈ 10–12 kg DM/day (Engels: 4.5 kg grain + 4.5 kg hay, or ~16 h
//                grazing). A ration is 1.2 kg grain-equivalent (economy doc §2).
// color / visual Hints for the terrain-texture artists (sRGB; see docs/art-bible.md palette).
//
// All numbers are DESIGN values grounded in the cited research and must be calibrated
// by the Monte-Carlo harness (docs/combat-research.md §17). Comments give the reasoning.

const T = (o) => Object.freeze(o);

export const TERRAIN = Object.freeze({
  // ─────────────── GRASSLAND & OPEN COUNTRY ───────────────
  short_meadow: T({
    // Mown or grazed turf on firm soil: the reference "ideal" field. Perfect cavalry ground.
    name: 'Short meadow', color: '#5d6b35', visual: 'close-cropped green turf, clover, a few molehills, faint cattle paths',
    moveMul: { foot: 0.95, heavyFoot: 0.92, cavalry: 1.0, cart: 0.65 }, fatigueMul: 1.1,
    footing: { slip: 0.010, fall: 0.002 }, chargeViable: 1.0, cohesionMul: 1.0,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0.1 }, dust: 0.1,
    digIn: 1.0, wetSensitivity: 0.3, wetTo: 'mud', fireRisk: 0.05,
    forage: { graze: 120, food: 0, wood: 0 },
  }),
  tall_grass: T({
    // Uncut hay meadow at 0.6–1 m before mowing. Tangles legs and hides prone men.
    name: 'Tall grass (hay meadow)', color: '#7a8040', visual: 'waist-high seeding grasses, tawny tips, bending in wind',
    moveMul: { foot: 0.85, heavyFoot: 0.8, cavalry: 0.9, cart: 0.55 }, fatigueMul: 1.2,
    footing: { slip: 0.015, fall: 0.003 }, chargeViable: 0.85, cohesionMul: 0.9,
    cover: { soft: 0.05, hard: 0 }, concealment: { standing: 0.15, prone: 0.8 }, dust: 0.05,
    digIn: 1.0, wetSensitivity: 0.3, wetTo: 'mud', fireRisk: 0.5,
    forage: { graze: 150, food: 0, wood: 0 },
  }),
  flower_meadow: T({
    // Unimproved wildflower grassland, knee-high. Between short and tall meadow.
    name: 'Flower meadow', color: '#6f7a3c', visual: 'knee-high grass speckled with buttercup yellow, knapweed purple, ox-eye white',
    moveMul: { foot: 0.9, heavyFoot: 0.87, cavalry: 0.95, cart: 0.6 }, fatigueMul: 1.15,
    footing: { slip: 0.012, fall: 0.002 }, chargeViable: 0.95, cohesionMul: 0.95,
    cover: { soft: 0.02, hard: 0 }, concealment: { standing: 0.05, prone: 0.5 }, dust: 0.05,
    digIn: 1.0, wetSensitivity: 0.3, wetTo: 'mud', fireRisk: 0.3,
    forage: { graze: 130, food: 0, wood: 0 },
  }),
  pasture: T({
    // Grazed common with tussocks, dung and poached gateways. Lumpier than a mown meadow.
    name: 'Pasture', color: '#627038', visual: 'uneven grazed sward, rush tussocks, dung pats, hoof-poached muddy patches',
    moveMul: { foot: 0.93, heavyFoot: 0.9, cavalry: 0.97, cart: 0.6 }, fatigueMul: 1.12,
    footing: { slip: 0.013, fall: 0.003 }, chargeViable: 0.95, cohesionMul: 0.97,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0.15 }, dust: 0.1,
    digIn: 1.0, wetSensitivity: 0.4, wetTo: 'mud', fireRisk: 0.05,
    forage: { graze: 100, food: 0, wood: 0 },
  }),
  water_meadow: T({
    // Riverside meadow on a high water table, spongy even in summer. Floods and becomes marsh.
    name: 'Water meadow', color: '#58703f', visual: 'lush bright grass, standing water in hoof prints, marsh marigold, drainage channels',
    moveMul: { foot: 0.8, heavyFoot: 0.7, cavalry: 0.75, cart: 0.35 }, fatigueMul: 1.35,
    footing: { slip: 0.025, fall: 0.006 }, chargeViable: 0.6, cohesionMul: 0.9,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0.2 }, dust: 0,
    digIn: 0.5, wetSensitivity: 0.8, wetTo: 'marsh', fireRisk: 0.0,
    forage: { graze: 180, food: 0, wood: 0 },
  }),
  heath_heather: T({
    // Ling and bell heather, knee-high and woody-stemmed. Tiring to wade through (light brush η≈1.2+).
    name: 'Heath (heather)', color: '#6b4f5a', visual: 'knee-high purple-brown heather clumps, sandy paths between, dark in winter',
    moveMul: { foot: 0.75, heavyFoot: 0.7, cavalry: 0.75, cart: 0.35 }, fatigueMul: 1.3,
    footing: { slip: 0.02, fall: 0.005 }, chargeViable: 0.6, cohesionMul: 0.85,
    cover: { soft: 0.03, hard: 0 }, concealment: { standing: 0.05, prone: 0.6 }, dust: 0.2,
    digIn: 0.7, wetSensitivity: 0.2, wetTo: null, fireRisk: 0.8,
    forage: { graze: 20, food: 0, wood: 0.5 },
  }),
  moorland: T({
    // Upland grass moor: tussocky, boggy flushes, peat underneath. Hard going.
    name: 'Moorland', color: '#7a7150', visual: 'tussocky purple moor-grass and cotton-grass, dark peat hags, bleached tufts',
    moveMul: { foot: 0.7, heavyFoot: 0.6, cavalry: 0.65, cart: 0.2 }, fatigueMul: 1.45,
    footing: { slip: 0.025, fall: 0.007 }, chargeViable: 0.45, cohesionMul: 0.8,
    cover: { soft: 0.02, hard: 0 }, concealment: { standing: 0.05, prone: 0.5 }, dust: 0.05,
    digIn: 0.6, wetSensitivity: 0.6, wetTo: 'peat_bog', fireRisk: 0.5,
    forage: { graze: 30, food: 0, wood: 0 },
  }),
  gorse_scrub: T({
    // Dense spiny gorse at 1–2 m: nearly impenetrable, tears horses. Heavy brush η≈1.5+.
    name: 'Gorse scrub', color: '#5b5e2a', visual: 'dense dark-green spiny bushes 1–2 m, bright yellow flowers, narrow sheep runs',
    moveMul: { foot: 0.35, heavyFoot: 0.35, cavalry: 0.15, cart: 0 }, fatigueMul: 1.7,
    footing: { slip: 0.03, fall: 0.008 }, chargeViable: 0.0, cohesionMul: 0.35,
    cover: { soft: 0.3, hard: 0 }, concealment: { standing: 0.6, prone: 0.95 }, dust: 0,
    digIn: 0.4, wetSensitivity: 0.1, wetTo: null, fireRisk: 1.0,
    forage: { graze: 5, food: 0, wood: 5 },
  }),
  bracken: T({
    // Summer bracken at 1–1.5 m: easy to push through but hides a standing man's legs and a prone man completely.
    name: 'Bracken', color: '#6e7a33', visual: 'waist-to-chest-high fronds, green in summer, rust-brown dead stems in autumn',
    moveMul: { foot: 0.75, heavyFoot: 0.72, cavalry: 0.75, cart: 0.3 }, fatigueMul: 1.3,
    footing: { slip: 0.02, fall: 0.005 }, chargeViable: 0.55, cohesionMul: 0.75,
    cover: { soft: 0.1, hard: 0 }, concealment: { standing: 0.35, prone: 0.95 }, dust: 0,
    digIn: 0.8, wetSensitivity: 0.2, wetTo: null, fireRisk: 0.7,
    forage: { graze: 0, food: 0, wood: 0 },
  }),

  // ─────────────── FARMLAND ───────────────
  fallow: T({
    // Third-year fallow of the open field: weeds and stubble remnants, grazed.
    name: 'Fallow field', color: '#7a7446', visual: 'patchy weeds, thistles, old stubble, sheep droppings, faint ridge-and-furrow',
    moveMul: { foot: 0.9, heavyFoot: 0.85, cavalry: 0.9, cart: 0.55 }, fatigueMul: 1.15,
    footing: { slip: 0.013, fall: 0.003 }, chargeViable: 0.9, cohesionMul: 0.95,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0.25 }, dust: 0.35,
    digIn: 1.0, wetSensitivity: 0.5, wetTo: 'mud', fireRisk: 0.2,
    forage: { graze: 50, food: 0, wood: 0 },
  }),
  ploughed_field: T({
    // Freshly ploughed ridge-and-furrow. Agincourt's "recently ploughed land" became knee-deep mud in rain.
    name: 'Ploughed field', color: '#5a4632', visual: 'dark turned clods in parallel ridges (ridge-and-furrow ~6 m pitch), plough-share glint of wet soil',
    moveMul: { foot: 0.75, heavyFoot: 0.65, cavalry: 0.6, cart: 0.25 }, fatigueMul: 1.4,
    footing: { slip: 0.03, fall: 0.008 }, chargeViable: 0.5, cohesionMul: 0.85,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0.2 }, dust: 0.6,
    digIn: 1.0, wetSensitivity: 1.0, wetTo: 'mud', fireRisk: 0,
    forage: { graze: 0, food: 0, wood: 0 },
  }),
  standing_wheat: T({
    // Medieval wheat stood 1.2–1.5 m (long straw). It hides kneeling men and is very flammable in August.
    name: 'Standing wheat', color: '#b59a55', visual: 'chest-high golden bearded ears, poppies and cornflowers, trampled lanes',
    moveMul: { foot: 0.75, heavyFoot: 0.7, cavalry: 0.8, cart: 0.35 }, fatigueMul: 1.3,
    footing: { slip: 0.015, fall: 0.003 }, chargeViable: 0.7, cohesionMul: 0.8,
    cover: { soft: 0.1, hard: 0 }, concealment: { standing: 0.3, prone: 0.95 }, dust: 0.1,
    digIn: 1.0, wetSensitivity: 0.4, wetTo: 'mud', fireRisk: 0.9,
    forage: { graze: 80, food: 600, wood: 0 }, // ≈700 kg/ha grain ÷ 1.2 kg ration; green corn is fodder only
  }),
  standing_barley: T({
    // Barley is shorter (0.8–1 m) and nodding. Brewing grain, so food value is similar.
    name: 'Standing barley', color: '#a89a5c', visual: 'waist-high pale-gold nodding awned heads, silvery sheen in wind',
    moveMul: { foot: 0.8, heavyFoot: 0.75, cavalry: 0.85, cart: 0.4 }, fatigueMul: 1.25,
    footing: { slip: 0.014, fall: 0.003 }, chargeViable: 0.75, cohesionMul: 0.85,
    cover: { soft: 0.07, hard: 0 }, concealment: { standing: 0.15, prone: 0.9 }, dust: 0.1,
    digIn: 1.0, wetSensitivity: 0.4, wetTo: 'mud', fireRisk: 0.85,
    forage: { graze: 80, food: 650, wood: 0 },
  }),
  standing_oats_beans: T({
    // Spring crops (oats, peas, beans): tangled legumes grab feet, and they are horse-fodder rich.
    name: 'Oats & beans', color: '#7f8a4a', visual: 'grey-green oats with tangled pea/bean haulm beneath, black-and-white bean flowers',
    moveMul: { foot: 0.75, heavyFoot: 0.7, cavalry: 0.8, cart: 0.35 }, fatigueMul: 1.3,
    footing: { slip: 0.018, fall: 0.004 }, chargeViable: 0.7, cohesionMul: 0.8,
    cover: { soft: 0.08, hard: 0 }, concealment: { standing: 0.15, prone: 0.9 }, dust: 0.1,
    digIn: 1.0, wetSensitivity: 0.4, wetTo: 'mud', fireRisk: 0.6,
    forage: { graze: 150, food: 500, wood: 0 },
  }),
  stubble: T({
    // Post-harvest stubble cut high with a sickle (~30 cm). Firm, open and dusty.
    name: 'Stubble', color: '#b3a06a', visual: 'shin-high pale straw stubble rows, gleaners\' paths, scattered dropped ears',
    moveMul: { foot: 0.93, heavyFoot: 0.9, cavalry: 0.95, cart: 0.6 }, fatigueMul: 1.12,
    footing: { slip: 0.012, fall: 0.002 }, chargeViable: 0.95, cohesionMul: 0.97,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0.3 }, dust: 0.5,
    digIn: 1.0, wetSensitivity: 0.4, wetTo: 'mud', fireRisk: 0.6,
    forage: { graze: 60, food: 10, wood: 0 },
  }),
  vineyard: T({
    // Rhineland terraces: rows of staked vines at ~1.2 m spacing, often on slopes with low walls.
    name: 'Vineyard', color: '#6a6b35', visual: 'regular rows of gnarled vines on stakes, stony soil, dry-stone terrace lips',
    moveMul: { foot: 0.7, heavyFoot: 0.65, cavalry: 0.35, cart: 0.2 }, fatigueMul: 1.3,
    footing: { slip: 0.02, fall: 0.005 }, chargeViable: 0.1, cohesionMul: 0.55,
    cover: { soft: 0.12, hard: 0.03 }, concealment: { standing: 0.25, prone: 0.7 }, dust: 0.4,
    digIn: 0.5, wetSensitivity: 0.3, wetTo: null, fireRisk: 0.2,
    forage: { graze: 10, food: 200, wood: 1 },
  }),
  orchard: T({
    // Standard fruit trees at 8–10 m spacing on grass: a gappy canopy that breaks lances and lines of sight.
    name: 'Orchard', color: '#56683a', visual: 'grassy floor under spaced gnarled apple/pear trees, windfalls, beehive skeps',
    moveMul: { foot: 0.9, heavyFoot: 0.85, cavalry: 0.6, cart: 0.45 }, fatigueMul: 1.15,
    footing: { slip: 0.013, fall: 0.003 }, chargeViable: 0.35, cohesionMul: 0.7,
    cover: { soft: 0.12, hard: 0.08 }, concealment: { standing: 0.3, prone: 0.5 }, dust: 0.05,
    digIn: 0.8, wetSensitivity: 0.3, wetTo: 'mud', fireRisk: 0.15,
    forage: { graze: 80, food: 150, wood: 10 },
  }),
  kitchen_garden: T({
    // Village tofts and crofts: wattle-fenced plots, beds, and pigs.
    name: 'Crofts & gardens', color: '#5c5a33', visual: 'small dug beds of leeks/cabbages, wattle hurdles, pig-rooted patches, compost heaps',
    moveMul: { foot: 0.8, heavyFoot: 0.75, cavalry: 0.45, cart: 0.3 }, fatigueMul: 1.2,
    footing: { slip: 0.018, fall: 0.004 }, chargeViable: 0.2, cohesionMul: 0.6,
    cover: { soft: 0.05, hard: 0.02 }, concealment: { standing: 0.1, prone: 0.4 }, dust: 0.3,
    digIn: 1.0, wetSensitivity: 0.6, wetTo: 'mud', fireRisk: 0.1,
    forage: { graze: 20, food: 400, wood: 0 },
  }),

  // ─────────────── WOODLAND ───────────────
  open_forest: T({
    // Mature oak/beech high forest, grazed floor, trunks 5–15 m apart. Lances and banners snag. Light brush η≈1.2.
    name: 'Open forest floor', color: '#4a4a2c', visual: 'leaf litter over moss, beech mast, big grey/brown trunks, dappled light, few saplings',
    moveMul: { foot: 0.8, heavyFoot: 0.75, cavalry: 0.5, cart: 0.35 }, fatigueMul: 1.2,
    footing: { slip: 0.02, fall: 0.005 }, chargeViable: 0.15, cohesionMul: 0.55,
    cover: { soft: 0.15, hard: 0.25 }, concealment: { standing: 0.45, prone: 0.7 }, dust: 0,
    digIn: 0.4, wetSensitivity: 0.2, wetTo: null, fireRisk: 0.2,
    forage: { graze: 15, food: 20, wood: 150 },
  }),
  dense_forest: T({
    // Wildwood with holly/hazel understorey and deadfall. Formations dissolve; men fight as individuals. Heavy brush η≈1.5.
    name: 'Dense forest', color: '#343a22', visual: 'crowded trunks, holly and hazel understorey, fallen moss-covered logs, deep shade',
    moveMul: { foot: 0.5, heavyFoot: 0.45, cavalry: 0.2, cart: 0 }, fatigueMul: 1.5,
    footing: { slip: 0.03, fall: 0.008 }, chargeViable: 0.0, cohesionMul: 0.25,
    cover: { soft: 0.35, hard: 0.35 }, concealment: { standing: 0.75, prone: 0.9 }, dust: 0,
    digIn: 0.2, wetSensitivity: 0.2, wetTo: null, fireRisk: 0.3,
    forage: { graze: 5, food: 15, wood: 250 },
  }),
  pine_forest: T({
    // Scots-pine forest (Scandinavian borderlands): straight trunks, clear needle floor. Slippery on slopes, fire-prone.
    name: 'Pine forest (needle floor)', color: '#5a4a32', visual: 'rust-brown needle carpet, tall straight red-barked trunks, sparse bilberry, resin smell',
    moveMul: { foot: 0.85, heavyFoot: 0.8, cavalry: 0.55, cart: 0.4 }, fatigueMul: 1.15,
    footing: { slip: 0.025, fall: 0.005 }, chargeViable: 0.2, cohesionMul: 0.6,
    cover: { soft: 0.05, hard: 0.25 }, concealment: { standing: 0.4, prone: 0.6 }, dust: 0.05,
    digIn: 0.6, wetSensitivity: 0.1, wetTo: null, fireRisk: 0.7,
    forage: { graze: 5, food: 10, wood: 200 },
  }),
  coppice: T({
    // Hazel/ash coppice on a 7–15 yr cycle: dense multi-stem regrowth 2–6 m. Good ambush ground.
    name: 'Coppice', color: '#4f5a2e', visual: 'clumps of straight hazel poles from stools, standards oaks above, bluebells in spring',
    moveMul: { foot: 0.6, heavyFoot: 0.55, cavalry: 0.25, cart: 0.1 }, fatigueMul: 1.4,
    footing: { slip: 0.025, fall: 0.006 }, chargeViable: 0.0, cohesionMul: 0.35,
    cover: { soft: 0.35, hard: 0.1 }, concealment: { standing: 0.7, prone: 0.9 }, dust: 0,
    digIn: 0.4, wetSensitivity: 0.2, wetTo: null, fireRisk: 0.3,
    forage: { graze: 10, food: 10, wood: 80 },
  }),
  bramble_thicket: T({
    // Bramble and blackthorn: armour protects the wearer, but the thorns hold every man and horse.
    name: 'Bramble thicket', color: '#46502c', visual: 'arching thorny bramble canes, blackthorn, tangled at 1–2 m, blackberries in autumn',
    moveMul: { foot: 0.25, heavyFoot: 0.3, cavalry: 0.1, cart: 0 }, fatigueMul: 1.8,
    footing: { slip: 0.04, fall: 0.01 }, chargeViable: 0.0, cohesionMul: 0.2,
    cover: { soft: 0.3, hard: 0 }, concealment: { standing: 0.6, prone: 0.95 }, dust: 0,
    digIn: 0.3, wetSensitivity: 0.1, wetTo: null, fireRisk: 0.5,
    forage: { graze: 5, food: 30, wood: 5 },
  }),
  hedgerow: T({
    // A hedge as a ground STRIP (for splat painting). Use FEATURES.hedge for the barrier behaviour.
    name: 'Hedgerow strip', color: '#3f4a26', visual: 'thick laid hawthorn and hazel 2–3 m wide, bank at the foot, ivy, occasional oak standard',
    moveMul: { foot: 0.2, heavyFoot: 0.15, cavalry: 0.05, cart: 0 }, fatigueMul: 1.8,
    footing: { slip: 0.04, fall: 0.01 }, chargeViable: 0.0, cohesionMul: 0.15,
    cover: { soft: 0.5, hard: 0.1 }, concealment: { standing: 0.85, prone: 0.95 }, dust: 0,
    digIn: 0.5, wetSensitivity: 0.1, wetTo: null, fireRisk: 0.3,
    forage: { graze: 10, food: 20, wood: 30 },
  }),
  alder_carr: T({
    // Wet woodland on waterlogged peat: alder and willow on tussocks between pools. Worse than both forest and marsh.
    name: 'Alder carr (wet wood)', color: '#3b4a33', visual: 'alder and willow on sedge tussocks, black water pools, fallen rotting trunks',
    moveMul: { foot: 0.35, heavyFoot: 0.25, cavalry: 0.1, cart: 0 }, fatigueMul: 1.9,
    footing: { slip: 0.06, fall: 0.015 }, chargeViable: 0.0, cohesionMul: 0.2,
    cover: { soft: 0.3, hard: 0.2 }, concealment: { standing: 0.7, prone: 0.9 }, dust: 0,
    digIn: 0.05, wetSensitivity: 0.2, wetTo: null, fireRisk: 0.02,
    forage: { graze: 10, food: 10, wood: 80 },
  }),
  deadfall_clearing: T({
    // Storm-throw or a felling area: logs at knee-to-waist height in every direction. Formations cannot cross it intact.
    name: 'Deadfall / felling area', color: '#6a5a44', visual: 'crossed fallen trunks and brash piles, stumps, fresh chips, fireweed',
    moveMul: { foot: 0.45, heavyFoot: 0.35, cavalry: 0.15, cart: 0 }, fatigueMul: 1.6,
    footing: { slip: 0.05, fall: 0.015 }, chargeViable: 0.0, cohesionMul: 0.3,
    cover: { soft: 0.1, hard: 0.25 }, concealment: { standing: 0.25, prone: 0.7 }, dust: 0.05,
    digIn: 0.3, wetSensitivity: 0.2, wetTo: null, fireRisk: 0.6,
    forage: { graze: 20, food: 0, wood: 300 },
  }),

  // ─────────────── BARE GROUND, TRACKS & SETTLEMENT ───────────────
  bare_earth: T({
    // Exposed loam, e.g. a building site or eroded ground. Firm when dry, mud when wet.
    name: 'Bare earth', color: '#6b5238', visual: 'brown compacted soil, footprints, small stones, cracks when dry',
    moveMul: { foot: 0.97, heavyFoot: 0.95, cavalry: 0.95, cart: 0.8 }, fatigueMul: 1.1,
    footing: { slip: 0.012, fall: 0.003 }, chargeViable: 0.95, cohesionMul: 1.0,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0 }, dust: 0.8,
    digIn: 1.0, wetSensitivity: 0.9, wetTo: 'mud', fireRisk: 0,
    forage: { graze: 0, food: 0, wood: 0 },
  }),
  dirt_track: T({
    // THE REFERENCE SURFACE (moveMul = 1 for all arms). Pandolf "dirt road" η = 1.1. Ruts become mud in rain.
    name: 'Dirt track', color: '#7d6446', visual: 'two cart ruts with a grassy crown, hoof prints, puddles in hollows',
    moveMul: { foot: 1.0, heavyFoot: 1.0, cavalry: 1.0, cart: 1.0 }, fatigueMul: 1.1,
    footing: { slip: 0.01, fall: 0.002 }, chargeViable: 0.9, cohesionMul: 1.0,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0 }, dust: 0.9,
    digIn: 0.8, wetSensitivity: 0.8, wetTo: 'mud', fireRisk: 0,
    forage: { graze: 0, food: 0, wood: 0 },
  }),
  hollow_way: T({
    // A track worn below the fields (1–3 m deep). Constrains formations; walls sometimes lined with hedges. See FEATURES.sunken_lane for the edges.
    name: 'Hollow way (floor)', color: '#6a5540', visual: 'deep rutted lane bed between steep earthen banks, exposed roots, overhanging hedge',
    moveMul: { foot: 0.95, heavyFoot: 0.95, cavalry: 0.9, cart: 0.9 }, fatigueMul: 1.1,
    footing: { slip: 0.015, fall: 0.003 }, chargeViable: 0.6, cohesionMul: 0.8,
    cover: { soft: 0, hard: 0.2 }, concealment: { standing: 0.5, prone: 0.8 }, dust: 0.5,
    digIn: 0.6, wetSensitivity: 1.0, wetTo: 'mud', fireRisk: 0,
    forage: { graze: 0, food: 0, wood: 0 },
  }),
  cobbled_road: T({
    // Rare, mostly in towns and Roman remnants. Best for carts, clattery for horses, slick when wet.
    name: 'Cobbled road', color: '#7f7d78', visual: 'rounded river cobbles set in sand, cambered, moss between stones, gutter edges',
    moveMul: { foot: 1.05, heavyFoot: 1.05, cavalry: 0.95, cart: 1.2 }, fatigueMul: 1.0,
    footing: { slip: 0.015, fall: 0.003 }, chargeViable: 0.7, cohesionMul: 1.0,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0 }, dust: 0.2,
    digIn: 0.1, wetSensitivity: 0.3, wetTo: null, fireRisk: 0,
    forage: { graze: 0, food: 0, wood: 0 },
  }),
  stone_paving: T({
    // Flagged courtyards and market places. Iron-shod hooves slip badly when wet.
    name: 'Stone paving', color: '#8f887a', visual: 'large worn limestone flags, cracked, lichen, drain channel, polished by feet',
    moveMul: { foot: 1.05, heavyFoot: 1.05, cavalry: 0.9, cart: 1.2 }, fatigueMul: 1.0,
    footing: { slip: 0.015, fall: 0.004 }, chargeViable: 0.6, cohesionMul: 1.0,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0 }, dust: 0.1,
    digIn: 0.0, wetSensitivity: 0.3, wetTo: null, fireRisk: 0,
    forage: { graze: 0, food: 0, wood: 0 },
  }),
  village_street: T({
    // Packed earth with dung, straw and puddles, between tofts. Narrow: formations are compressed.
    name: 'Village street', color: '#6e5a42', visual: 'packed brown earth with straw, dung, puddles, cart ruts, chickens, a midden edge',
    moveMul: { foot: 0.97, heavyFoot: 0.95, cavalry: 0.9, cart: 0.95 }, fatigueMul: 1.1,
    footing: { slip: 0.018, fall: 0.004 }, chargeViable: 0.4, cohesionMul: 0.7,
    cover: { soft: 0, hard: 0.05 }, concealment: { standing: 0.1, prone: 0.2 }, dust: 0.6,
    digIn: 0.8, wetSensitivity: 0.9, wetTo: 'mud', fireRisk: 0.05,
    forage: { graze: 0, food: 0, wood: 0 },
  }),
  trampled_ground: T({
    // What a meadow becomes under thousands of feet and hooves: torn turf, dust or mire, dropped kit.
    name: 'Trampled ground', color: '#655238', visual: 'churned torn turf, boot and hoof holes, broken arrows, dropped gear',
    moveMul: { foot: 0.9, heavyFoot: 0.85, cavalry: 0.85, cart: 0.55 }, fatigueMul: 1.2,
    footing: { slip: 0.02, fall: 0.005 }, chargeViable: 0.75, cohesionMul: 0.9,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0.05 }, dust: 0.9,
    digIn: 1.0, wetSensitivity: 1.0, wetTo: 'mud', fireRisk: 0,
    forage: { graze: 5, food: 0, wood: 0 },
  }),
  battlefield_churn: T({
    // Where a melee has raged: mud, blood, bodies and dropped weapons. Bodies are separate obstacles in the sim; this is the ground.
    name: 'Churned battle ground', color: '#4f3f2e', visual: 'deep churned mud with dark stains, broken shafts, dented helms, torn cloth',
    moveMul: { foot: 0.7, heavyFoot: 0.6, cavalry: 0.55, cart: 0.2 }, fatigueMul: 1.5,
    footing: { slip: 0.05, fall: 0.015 }, chargeViable: 0.35, cohesionMul: 0.7,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0.1 }, dust: 0.2,
    digIn: 0.8, wetSensitivity: 0.5, wetTo: 'mud', fireRisk: 0,
    forage: { graze: 0, food: 0, wood: 0 },
  }),

  // ─────────────── WET GROUND & WATER ───────────────
  mud: T({
    // Agincourt: armoured men sank "up to their knees" and exhausted themselves crossing ~300 yd. Swampy η≈1.8.
    name: 'Mud', color: '#4a3b2b', visual: 'glistening brown mire, water-filled footprints, suction holes, puddles reflecting sky',
    moveMul: { foot: 0.5, heavyFoot: 0.35, cavalry: 0.3, cart: 0.15 }, fatigueMul: 1.8,
    footing: { slip: 0.08, fall: 0.02 }, chargeViable: 0.2, cohesionMul: 0.7,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0 }, dust: 0,
    digIn: 0.4, wetSensitivity: 0.3, wetTo: null, fireRisk: 0,
    forage: { graze: 0, food: 0, wood: 0 },
  }),
  clay_heavy: T({
    // Heavy clay: rock-hard and cracked when dry, then a boot-sucking glue after rain (wetSensitivity 1).
    name: 'Heavy clay', color: '#8a6a48', visual: 'ochre-grey clay, polygon cracks when dry, slick sticky sheen when wet',
    moveMul: { foot: 0.93, heavyFoot: 0.9, cavalry: 0.9, cart: 0.7 }, fatigueMul: 1.15,
    footing: { slip: 0.015, fall: 0.003 }, chargeViable: 0.85, cohesionMul: 0.95,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0 }, dust: 0.5,
    digIn: 0.5, wetSensitivity: 1.0, wetTo: 'mud', fireRisk: 0,
    forage: { graze: 20, food: 0, wood: 0 },
  }),
  peat_bog: T({
    // Raised bog: sphagnum over deep peat. Horses founder; men go in thigh-deep. Flanders Moss protected Stirling's flank.
    name: 'Peat bog', color: '#6b5a3c', visual: 'spongy red-green sphagnum hummocks, black pools, cotton-grass tufts, bog-oak stumps',
    moveMul: { foot: 0.35, heavyFoot: 0.2, cavalry: 0.05, cart: 0 }, fatigueMul: 2.0,
    footing: { slip: 0.07, fall: 0.03 }, chargeViable: 0.0, cohesionMul: 0.4,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0.05, prone: 0.4 }, dust: 0,
    digIn: 0.3, wetSensitivity: 0.2, wetTo: null, fireRisk: 0.1, // dry peat smoulders
    forage: { graze: 5, food: 0, wood: 0 },
  }),
  marsh: T({
    // Sedge marsh with standing water 0–30 cm. Courtrai's streams and marsh broke the French charge.
    name: 'Marsh', color: '#4f5e3e', visual: 'sedge and rush clumps in shallow brown water, open pools, lily pads, heron',
    moveMul: { foot: 0.4, heavyFoot: 0.25, cavalry: 0.15, cart: 0 }, fatigueMul: 1.8,
    footing: { slip: 0.07, fall: 0.025 }, chargeViable: 0.05, cohesionMul: 0.45,
    cover: { soft: 0.05, hard: 0 }, concealment: { standing: 0.1, prone: 0.5 }, dust: 0,
    digIn: 0.05, wetSensitivity: 0.2, wetTo: null, fireRisk: 0.05,
    forage: { graze: 40, food: 5, wood: 0 },
  }),
  reed_bed_fen: T({
    // Common reed at 2–3 m over water: hides whole companies, and the reed is a thatch resource.
    name: 'Reed bed (fen)', color: '#8c8455', visual: 'dense 2–3 m straw-coloured reeds with feathery heads, water beneath, cut channels',
    moveMul: { foot: 0.3, heavyFoot: 0.2, cavalry: 0.1, cart: 0 }, fatigueMul: 1.9,
    footing: { slip: 0.06, fall: 0.02 }, chargeViable: 0.0, cohesionMul: 0.25,
    cover: { soft: 0.2, hard: 0 }, concealment: { standing: 0.9, prone: 0.98 }, dust: 0,
    digIn: 0.0, wetSensitivity: 0.1, wetTo: null, fireRisk: 0.6, // winter-dry reed burns fiercely
    forage: { graze: 20, food: 20, wood: 0 },
  }),
  salt_marsh: T({
    // Tidal saltings cut by deep creeks. Firm between the creeks at low tide, a death-trap at high tide.
    name: 'Salt marsh', color: '#6e7a5a', visual: 'grey-green sea-lavender and samphire, meandering muddy creeks, tide wrack',
    moveMul: { foot: 0.6, heavyFoot: 0.45, cavalry: 0.4, cart: 0.1 }, fatigueMul: 1.6,
    footing: { slip: 0.05, fall: 0.015 }, chargeViable: 0.2, cohesionMul: 0.55,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0.05, prone: 0.3 }, dust: 0,
    digIn: 0.2, wetSensitivity: 0.3, wetTo: 'tidal_mudflat', fireRisk: 0,
    forage: { graze: 60, food: 5, wood: 0 },
  }),
  tidal_mudflat: T({
    // Soft estuarine silt: men sink to the shin; horses flounder.
    name: 'Tidal mudflat', color: '#5e5646', visual: 'grey-brown glossy silt, rippled, worm casts, shallow runnels, gulls',
    moveMul: { foot: 0.35, heavyFoot: 0.2, cavalry: 0.15, cart: 0 }, fatigueMul: 2.0,
    footing: { slip: 0.08, fall: 0.03 }, chargeViable: 0.05, cohesionMul: 0.5,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0 }, dust: 0,
    digIn: 0.1, wetSensitivity: 0, wetTo: null, fireRisk: 0,
    forage: { graze: 0, food: 10, wood: 0 },
  }),
  shallow_ford: T({
    // Knee-deep (≤0.5 m) gravel-bottomed water. Crossing is slow and disordering. Depth lives on FEATURES.ford.
    name: 'Shallow ford', color: '#6d7a70', visual: 'clear knee-deep water over pale gravel, riffles, cart tracks entering both banks',
    moveMul: { foot: 0.5, heavyFoot: 0.4, cavalry: 0.6, cart: 0.4 }, fatigueMul: 1.6,
    footing: { slip: 0.06, fall: 0.02 }, chargeViable: 0.15, cohesionMul: 0.5,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0 }, dust: 0,
    digIn: 0.0, wetSensitivity: 0.5, wetTo: 'deep_water', fireRisk: 0, // rain raises rivers
    forage: { graze: 0, food: 0, wood: 0 },
  }),
  stream_bed: T({
    // Small brook 1–3 m wide with cut banks (Courtrai's Groeninge-type obstacle). Horses refuse or fall at the banks.
    name: 'Stream bed', color: '#5f6a5a', visual: 'narrow brook in a cut channel, undercut muddy banks 0.5–1 m, alder roots, watercress',
    moveMul: { foot: 0.45, heavyFoot: 0.35, cavalry: 0.3, cart: 0.2 }, fatigueMul: 1.6,
    footing: { slip: 0.07, fall: 0.03 }, chargeViable: 0.05, cohesionMul: 0.4,
    cover: { soft: 0, hard: 0.1 }, concealment: { standing: 0.2, prone: 0.6 }, dust: 0,
    digIn: 0.0, wetSensitivity: 0.6, wetTo: 'deep_water', fireRisk: 0,
    forage: { graze: 0, food: 5, wood: 0 },
  }),
  deep_water: T({
    // >1.3 m: impassable to armed men (drowning, see WEATHER-independent rules in docs §12). Horses swim slowly.
    name: 'Deep water', color: '#3e4f55', visual: 'dark river or pool, current lines, reflections, reeds at the margin',
    moveMul: { foot: 0.0, heavyFoot: 0.0, cavalry: 0.15, cart: 0.0 }, fatigueMul: 4.0,
    footing: { slip: 1, fall: 1 }, chargeViable: 0.0, cohesionMul: 0.0,
    cover: { soft: 0, hard: 0.5 }, concealment: { standing: 0, prone: 0 }, dust: 0,
    digIn: 0.0, wetSensitivity: 0, wetTo: null, fireRisk: 0,
    forage: { graze: 0, food: 30, wood: 0 }, // fish
  }),
  riverbank_shingle: T({
    // Loose water-worn pebbles on inside bends: rolling footing and a noisy crossing.
    name: 'Riverbank shingle', color: '#9a9284', visual: 'rounded grey/tan pebbles and cobbles, driftwood, dried weed tidelines',
    moveMul: { foot: 0.75, heavyFoot: 0.65, cavalry: 0.6, cart: 0.35 }, fatigueMul: 1.5,
    footing: { slip: 0.04, fall: 0.01 }, chargeViable: 0.35, cohesionMul: 0.8,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0 }, dust: 0.05,
    digIn: 0.3, wetSensitivity: 0.2, wetTo: null, fireRisk: 0,
    forage: { graze: 0, food: 0, wood: 2 },
  }),

  // ─────────────── MINERAL GROUND ───────────────
  gravel: T({
    // Gravel terrace or pit floor: firm, well drained, crunchy underfoot.
    name: 'Gravel', color: '#8e8676', visual: 'angular to rounded small stones, sparse weeds, compacted wheel tracks',
    moveMul: { foot: 0.92, heavyFoot: 0.88, cavalry: 0.85, cart: 0.75 }, fatigueMul: 1.2,
    footing: { slip: 0.02, fall: 0.004 }, chargeViable: 0.8, cohesionMul: 0.95,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0 }, dust: 0.4,
    digIn: 0.5, wetSensitivity: 0.05, wetTo: null, fireRisk: 0,
    forage: { graze: 0, food: 0, wood: 0 },
  }),
  sand: T({
    // Loose dry sand. Pandolf η = 2.1, so a walk is twice as tiring. Firmer when damp.
    name: 'Loose sand', color: '#c2ab7e', visual: 'pale loose sand, wind ripples, deep shapeless footprints',
    moveMul: { foot: 0.65, heavyFoot: 0.5, cavalry: 0.55, cart: 0.25 }, fatigueMul: 2.1,
    footing: { slip: 0.04, fall: 0.008 }, chargeViable: 0.4, cohesionMul: 0.85,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0 }, dust: 1.0,
    digIn: 0.9, wetSensitivity: -0.5, wetTo: 'beach_wet', fireRisk: 0, // negative: rain IMPROVES it
    forage: { graze: 0, food: 0, wood: 0 },
  }),
  dunes: T({
    // Coastal dunes with marram: steep soft faces, hiding hollows.
    name: 'Dunes', color: '#bba77a', visual: 'rolling sand ridges 2–10 m, spiky marram grass tufts, blowouts',
    moveMul: { foot: 0.5, heavyFoot: 0.35, cavalry: 0.35, cart: 0.05 }, fatigueMul: 2.3,
    footing: { slip: 0.05, fall: 0.012 }, chargeViable: 0.15, cohesionMul: 0.55,
    cover: { soft: 0.05, hard: 0 }, concealment: { standing: 0.3, prone: 0.7 }, dust: 0.9,
    digIn: 0.9, wetSensitivity: -0.3, wetTo: null, fireRisk: 0.1,
    forage: { graze: 5, food: 0, wood: 0 },
  }),
  beach_wet: T({
    // Firm wet sand below the tide line: the best going on a coast.
    name: 'Beach (wet sand)', color: '#a8997a', visual: 'firm dark damp sand, sheen of water, shells and weed at the strand line',
    moveMul: { foot: 0.95, heavyFoot: 0.9, cavalry: 1.0, cart: 0.7 }, fatigueMul: 1.2,
    footing: { slip: 0.015, fall: 0.003 }, chargeViable: 0.9, cohesionMul: 1.0,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0 }, dust: 0,
    digIn: 0.8, wetSensitivity: 0, wetTo: null, fireRisk: 0,
    forage: { graze: 0, food: 15, wood: 1 },
  }),
  chalk_downland: T({
    // Thin turf on chalk: springy, fast, superb horse country. Slick white chalk shows through on slopes when wet.
    name: 'Chalk downland', color: '#8a9057', visual: 'fine short springy turf with white chalk scars, thyme, sheep tracks contouring slopes',
    moveMul: { foot: 1.0, heavyFoot: 0.97, cavalry: 1.05, cart: 0.7 }, fatigueMul: 1.1,
    footing: { slip: 0.012, fall: 0.002 }, chargeViable: 1.0, cohesionMul: 1.0,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0.05 }, dust: 0.3,
    digIn: 0.45, wetSensitivity: 0.3, wetTo: null, fireRisk: 0.1,
    forage: { graze: 60, food: 0, wood: 0 },
  }),
  limestone_pavement: T({
    // Clints and grikes: flat blocks split by knee-deep fissures. Leg-breaking for horses.
    name: 'Limestone pavement', color: '#a19c90', visual: 'grey fissured flat rock blocks, deep grikes with ferns, weathered runnels',
    moveMul: { foot: 0.55, heavyFoot: 0.45, cavalry: 0.15, cart: 0 }, fatigueMul: 1.5,
    footing: { slip: 0.05, fall: 0.02 }, chargeViable: 0.0, cohesionMul: 0.5,
    cover: { soft: 0, hard: 0.05 }, concealment: { standing: 0, prone: 0.3 }, dust: 0.05,
    digIn: 0.0, wetSensitivity: 0.2, wetTo: null, fireRisk: 0,
    forage: { graze: 5, food: 0, wood: 0 },
  }),
  scree: T({
    // Loose angular rock debris on a steep slope: slides underfoot, horses can't hold a line.
    name: 'Scree', color: '#8b867d', visual: 'sheet of loose angular grey stones on a steep slope, fans at the base',
    moveMul: { foot: 0.4, heavyFoot: 0.3, cavalry: 0.1, cart: 0 }, fatigueMul: 2.0,
    footing: { slip: 0.08, fall: 0.03 }, chargeViable: 0.0, cohesionMul: 0.4,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0.1 }, dust: 0.4,
    digIn: 0.1, wetSensitivity: 0.1, wetTo: null, fireRisk: 0,
    forage: { graze: 0, food: 0, wood: 0 },
  }),
  cliff_rock: T({
    // Near-vertical rock. Impassable except where FEATURES (paths, ladders) exist. Blocks LOS by geometry.
    name: 'Cliff / bare rock face', color: '#76726b', visual: 'jointed grey rock face, ledges with grass tufts, lichen, bird streaks',
    moveMul: { foot: 0.0, heavyFoot: 0.0, cavalry: 0.0, cart: 0.0 }, fatigueMul: 4.0,
    footing: { slip: 1, fall: 1 }, chargeViable: 0.0, cohesionMul: 0.0,
    cover: { soft: 0, hard: 0.9 }, concealment: { standing: 0, prone: 0 }, dust: 0,
    digIn: 0.0, wetSensitivity: 0, wetTo: null, fireRisk: 0,
    forage: { graze: 0, food: 0, wood: 0 },
  }),
  rock_slab: T({
    // Walkable bare bedrock outcrop. Firm but polished; wet slabs are treacherous.
    name: 'Rock slab / outcrop', color: '#85807a', visual: 'smooth grey bedrock humps, glacial striations, thin soil pockets with heather',
    moveMul: { foot: 0.85, heavyFoot: 0.8, cavalry: 0.5, cart: 0.3 }, fatigueMul: 1.2,
    footing: { slip: 0.025, fall: 0.006 }, chargeViable: 0.3, cohesionMul: 0.8,
    cover: { soft: 0, hard: 0.05 }, concealment: { standing: 0, prone: 0.1 }, dust: 0,
    digIn: 0.0, wetSensitivity: 0.3, wetTo: null, fireRisk: 0,
    forage: { graze: 0, food: 0, wood: 0 },
  }),
  boulder_field: T({
    // Glacial erratics 0.5–3 m: cover for skirmishers, ruin for formations and horses.
    name: 'Boulder field', color: '#7b776e', visual: 'scattered lichen-crusted granite boulders in coarse grass and bracken',
    moveMul: { foot: 0.6, heavyFoot: 0.5, cavalry: 0.25, cart: 0 }, fatigueMul: 1.5,
    footing: { slip: 0.04, fall: 0.012 }, chargeViable: 0.05, cohesionMul: 0.35,
    cover: { soft: 0, hard: 0.35 }, concealment: { standing: 0.35, prone: 0.7 }, dust: 0.05,
    digIn: 0.2, wetSensitivity: 0.1, wetTo: null, fireRisk: 0,
    forage: { graze: 10, food: 0, wood: 0 },
  }),
  quarry_floor: T({
    // A worked quarry: spoil, loose blocks, chippings. Stone yield per economy doc §3.2.
    name: 'Quarry floor', color: '#a09887', visual: 'pale cut rock faces with wedge marks, spoil heaps, squared blocks, chippings',
    moveMul: { foot: 0.8, heavyFoot: 0.75, cavalry: 0.5, cart: 0.6 }, fatigueMul: 1.3,
    footing: { slip: 0.03, fall: 0.008 }, chargeViable: 0.2, cohesionMul: 0.6,
    cover: { soft: 0, hard: 0.2 }, concealment: { standing: 0.2, prone: 0.5 }, dust: 0.8,
    digIn: 0.1, wetSensitivity: 0.2, wetTo: null, fireRisk: 0,
    forage: { graze: 0, food: 0, wood: 0 },
  }),

  // ─────────────── WINTER ───────────────
  snow_light: T({
    // ≤15 cm snow over firm ground. Pandolf: soft snow 15 cm η = 2.5. Towton was fought in snow.
    name: 'Light snow', color: '#dcdcd6', visual: 'thin white cover with grass tips poking through, crisp bootprints',
    moveMul: { foot: 0.8, heavyFoot: 0.75, cavalry: 0.8, cart: 0.55 }, fatigueMul: 2.5,
    footing: { slip: 0.03, fall: 0.008 }, chargeViable: 0.7, cohesionMul: 0.95,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0.1 }, dust: 0,
    digIn: 0.6, wetSensitivity: 0.5, wetTo: 'slush', fireRisk: 0,
    forage: { graze: 20, food: 0, wood: 0 },
  }),
  snow_deep: T({
    // ~35 cm+ soft snow (Pandolf η = 4.1): brutal for foot, and horses flounder.
    name: 'Deep snow', color: '#e2e3df', visual: 'smooth deep drifts, blue shadows, wading troughs where men have passed',
    moveMul: { foot: 0.4, heavyFoot: 0.3, cavalry: 0.35, cart: 0.05 }, fatigueMul: 4.1,
    footing: { slip: 0.04, fall: 0.012 }, chargeViable: 0.1, cohesionMul: 0.7,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0.4 }, dust: 0,
    digIn: 0.3, wetSensitivity: 0.3, wetTo: 'slush', fireRisk: 0,
    forage: { graze: 0, food: 0, wood: 0 },
  }),
  slush: T({
    // Thawing snow over mud: the worst of both.
    name: 'Slush', color: '#b7b4a8', visual: 'grey wet half-melted snow over brown mud, meltwater pools',
    moveMul: { foot: 0.55, heavyFoot: 0.4, cavalry: 0.4, cart: 0.2 }, fatigueMul: 2.0,
    footing: { slip: 0.08, fall: 0.025 }, chargeViable: 0.15, cohesionMul: 0.75,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0 }, dust: 0,
    digIn: 0.4, wetSensitivity: 0.3, wetTo: 'mud', fireRisk: 0,
    forage: { graze: 0, food: 0, wood: 0 },
  }),
  frozen_ground: T({
    // Hard frost: iron-hard, fast, cannot be dug. Rutted frozen mud trips horses.
    name: 'Frozen ground', color: '#8d8a80', visual: 'white hoar-frosted grass, rock-hard frozen ruts, rime on clods',
    moveMul: { foot: 0.97, heavyFoot: 0.95, cavalry: 0.9, cart: 0.9 }, fatigueMul: 1.1,
    footing: { slip: 0.03, fall: 0.008 }, chargeViable: 0.75, cohesionMul: 1.0,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0 }, dust: 0.05,
    digIn: 0.05, wetSensitivity: 0, wetTo: null, fireRisk: 0,
    forage: { graze: 10, food: 0, wood: 0 },
  }),
  ice: T({
    // Frozen river or pond. Frozen marsh becomes passable in hard winters. Very slippery; it may break under mass (FEATURES.ice_sheet).
    name: 'Ice', color: '#b9c6c8', visual: 'grey-blue translucent ice, white cracks, trapped bubbles, snow dusting',
    moveMul: { foot: 0.6, heavyFoot: 0.5, cavalry: 0.35, cart: 0.4 }, fatigueMul: 1.3,
    footing: { slip: 0.15, fall: 0.05 }, chargeViable: 0.05, cohesionMul: 0.6,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0 }, dust: 0,
    digIn: 0.0, wetSensitivity: 0.5, wetTo: 'deep_water', fireRisk: 0, // thaw
    forage: { graze: 0, food: 0, wood: 0 },
  }),

  // ─────────────── DAMAGED & MAN-MADE GROUND ───────────────
  burned_ground: T({
    // After a field or heath fire: ash and char, dust clouds when trampled, no forage.
    name: 'Burned ground', color: '#3d3833', visual: 'black ash and charred stubble/heather stems, grey powder, smoking patches',
    moveMul: { foot: 0.95, heavyFoot: 0.92, cavalry: 0.95, cart: 0.65 }, fatigueMul: 1.15,
    footing: { slip: 0.012, fall: 0.002 }, chargeViable: 0.9, cohesionMul: 1.0,
    cover: { soft: 0, hard: 0 }, concealment: { standing: 0, prone: 0 }, dust: 1.0,
    digIn: 1.0, wetSensitivity: 0.7, wetTo: 'mud', fireRisk: 0,
    forage: { graze: 0, food: 0, wood: 0 },
  }),
  ruins_rubble: T({
    // Collapsed masonry and timber. Good defensive cover, but no formation survives it.
    name: 'Ruins / rubble', color: '#8a8275', visual: 'tumbled stone blocks, broken wall stubs, charred beams, nettles and elder',
    moveMul: { foot: 0.5, heavyFoot: 0.4, cavalry: 0.15, cart: 0 }, fatigueMul: 1.6,
    footing: { slip: 0.05, fall: 0.015 }, chargeViable: 0.0, cohesionMul: 0.3,
    cover: { soft: 0.05, hard: 0.45 }, concealment: { standing: 0.4, prone: 0.8 }, dust: 0.5,
    digIn: 0.2, wetSensitivity: 0.1, wetTo: null, fireRisk: 0.05,
    forage: { graze: 5, food: 0, wood: 5 },
  }),
  ditch: T({
    // A dug ditch as ground (2–3 m wide, 1–2 m deep). FEATURES.ditch holds the crossing rules.
    name: 'Ditch (floor)', color: '#5b4a36', visual: 'V/U-cut channel, raw earth sides, standing water and weeds at the bottom',
    moveMul: { foot: 0.4, heavyFoot: 0.3, cavalry: 0.1, cart: 0 }, fatigueMul: 1.7,
    footing: { slip: 0.06, fall: 0.02 }, chargeViable: 0.0, cohesionMul: 0.3,
    cover: { soft: 0, hard: 0.4 }, concealment: { standing: 0.5, prone: 0.9 }, dust: 0.1,
    digIn: 1.0, wetSensitivity: 0.8, wetTo: 'mud', fireRisk: 0,
    forage: { graze: 0, food: 0, wood: 0 },
  }),
  earth_rampart: T({
    // A bank of thrown-up earth (the bailey bank). The top is a fighting platform; the slopes are 30–45°.
    name: 'Earth rampart (bank)', color: '#65563d', visual: 'steep turfed or raw earthen bank, erosion gullies, trodden path along the crest',
    moveMul: { foot: 0.5, heavyFoot: 0.4, cavalry: 0.1, cart: 0 }, fatigueMul: 1.8,
    footing: { slip: 0.04, fall: 0.012 }, chargeViable: 0.0, cohesionMul: 0.5,
    cover: { soft: 0, hard: 0.3 }, concealment: { standing: 0.2, prone: 0.7 }, dust: 0.3,
    digIn: 1.0, wetSensitivity: 0.6, wetTo: 'mud', fireRisk: 0,
    forage: { graze: 20, food: 0, wood: 0 },
  }),
  camp_ground: T({
    // A trodden army camp: latrines, fire pits and tent pegs. The disease source in long sieges (economy doc §9).
    name: 'Camp ground', color: '#6c5a44', visual: 'trodden bare patches, fire-rings, tent peg holes, straw bedding, refuse',
    moveMul: { foot: 0.9, heavyFoot: 0.88, cavalry: 0.7, cart: 0.7 }, fatigueMul: 1.15,
    footing: { slip: 0.02, fall: 0.004 }, chargeViable: 0.3, cohesionMul: 0.6,
    cover: { soft: 0.02, hard: 0.02 }, concealment: { standing: 0.1, prone: 0.2 }, dust: 0.7,
    digIn: 1.0, wetSensitivity: 0.9, wetTo: 'mud', fireRisk: 0.2,
    forage: { graze: 0, food: 0, wood: 0 },
  }),
});

// ═══════════════════════════ FEATURES (linear & point objects) ═══════════════════════════
// Placed on top of TERRAIN. Common fields:
//  height m, thickness m, blocksLOS bool, cover {hard, soft} (for a man directly behind it,
//  facing the missile), cross {foot, heavyFoot, cavalry, cart} seconds to cross one span
//  (Infinity = impossible without breaching), menAbreast (for gaps/bridges/gates),
//  chargeStop P(horse refuses/falls at it), defenderBonus {skill, stress}, breach
//  man-hours per metre with tools, climbS seconds per man to climb with a ladder, flammable 0..1.
export const FEATURES = Object.freeze({
  // Barriers
  dry_stone_wall: T({
    name: 'Field wall (dry stone)', height: 1.2, thickness: 0.6, blocksLOS: false,
    cover: { hard: 0.7, soft: 0 }, cross: { foot: 4, heavyFoot: 7, cavalry: 2, cart: Infinity },
    chargeStop: 0.6, defenderBonus: { skill: 0.1, stress: -0.08 }, breach: 1.5, flammable: 0,
    note: 'Chest-high: men fight over it. Hunters jump it, but a warhorse in a formed charge usually will not.',
  }),
  town_wall: T({
    name: 'Town wall (stone)', height: 6, thickness: 1.5, blocksLOS: true,
    cover: { hard: 0.95, soft: 0 }, cross: { foot: Infinity, heavyFoot: Infinity, cavalry: Infinity, cart: Infinity },
    climbS: 25, defenderBonus: { skill: 0.3, stress: -0.2 }, breach: 120, flammable: 0,
    note: 'Economy doc: 90–140 worker-days per metre. A mine or siege engine breach is needed; a ladder escalade is slow, and defenders on top strike downward.',
  }),
  curtain_wall: T({
    name: 'Castle curtain wall', height: 10, thickness: 2.7, blocksLOS: true,
    cover: { hard: 0.97, soft: 0 }, cross: { foot: Infinity, heavyFoot: Infinity, cavalry: Infinity, cart: Infinity },
    climbS: 45, defenderBonus: { skill: 0.35, stress: -0.25 }, breach: 600, flammable: 0,
    note: 'Harlech-class. Machicolation/hoarding lets defenders drop missiles at the wall foot.',
  }),
  timber_palisade: T({
    name: 'Timber palisade', height: 3.5, thickness: 0.3, blocksLOS: true,
    cover: { hard: 0.9, soft: 0 }, cross: { foot: Infinity, heavyFoot: Infinity, cavalry: Infinity, cart: Infinity },
    climbS: 12, defenderBonus: { skill: 0.25, stress: -0.15 }, breach: 6, flammable: 0.6,
    note: '≈0.6 man-days/m to build (economy doc §5.1). Axes breach it; fire is the classic attack.',
  }),
  town_gate: T({
    name: 'Shut gate (leaves barred)', height: 4, thickness: 0.6, blocksLOS: true,
    cover: { hard: 0.9, soft: 0 }, cross: { foot: Infinity, heavyFoot: Infinity, cavalry: Infinity, cart: Infinity },
    climbS: 20, defenderBonus: { skill: 0.25, stress: -0.15 }, breach: 40, flammable: 0.5,
    note: 'Oak leaves on iron pintles, barred from inside. A ram (hours), fire, or the defenders opening it (treachery, or attackers already inside) are the ways through.',
  }),
  // (siege.js / siege-works.js: the rubble slope of a breached wall module, and the retrenchment thrown across it)
  breach_rubble: T({
    name: 'Breach (rubble slope)', height: 3, thickness: 8, blocksLOS: false,
    cover: { hard: 0.3, soft: 0 }, cross: { foot: 6, heavyFoot: 9, cavalry: Infinity, cart: Infinity },
    menAbreast: 3, chargeStop: 1, defenderBonus: { skill: 0.15, stress: -0.1 }, flammable: 0,
    note: 'A fallen module: loose masonry heaped both sides of the gap. Men scramble up it a few abreast; horses cannot. Dover 1216.',
  }),
  breach_barricade: T({
    name: 'Barricade across a breach', height: 2.2, thickness: 1.2, blocksLOS: true,
    cover: { hard: 0.8, soft: 0 }, cross: { foot: Infinity, heavyFoot: Infinity, cavalry: Infinity, cart: Infinity },
    climbS: 15, defenderBonus: { skill: 0.25, stress: -0.15 }, flammable: 0.5,
    note: 'Timber baulks, oak posts, rubble and barrels thrown across a breach (Dover 1216; Carcassonne 1240 a dry-stone wall). Pulled down by hand.',
  }),
  wattle_fence: T({
    name: 'Wattle hurdle fence', height: 1.2, thickness: 0.1, blocksLOS: false,
    cover: { hard: 0, soft: 0.3 }, cross: { foot: 3, heavyFoot: 5, cavalry: 2, cart: Infinity },
    chargeStop: 0.3, defenderBonus: { skill: 0.03, stress: -0.02 }, breach: 0.1, flammable: 0.7,
    note: 'Pushed over by a few men. It disorders a charge more than it stops one.',
  }),
  post_rail_fence: T({
    name: 'Post-and-rail fence', height: 1.3, thickness: 0.15, blocksLOS: false,
    cover: { hard: 0.1, soft: 0 }, cross: { foot: 3, heavyFoot: 6, cavalry: 2, cart: Infinity },
    chargeStop: 0.45, defenderBonus: { skill: 0.05, stress: -0.03 }, breach: 0.3, flammable: 0.4,
  }),
  hedge: T({
    name: 'Laid hedge on bank', height: 2.2, thickness: 2.0, blocksLOS: true,
    // (crossing a hedge LINE: every field has its gateway and the hedge its thin places — a body files through
    // them or breaks through the laid stems in seconds a span, horses take the gates or jump the low stretches;
    // a formed charge still cannot go through one: chargeStop)
    cover: { hard: 0.2, soft: 0.6 }, cross: { foot: 6, heavyFoot: 9, cavalry: 15, cart: Infinity },
    menAbreastAtGap: 2, chargeStop: 0.95, defenderBonus: { skill: 0.15, stress: -0.1 }, breach: 3, flammable: 0.3,
    note: 'Hedges channel everything into gateways. Archers lining a hedge are nearly immune to cavalry.',
  }),
  ditch: T({
    name: 'Ditch', width: 2.5, depth: 1.5, blocksLOS: false,
    cover: { hard: 0.4, soft: 0 }, cross: { foot: 8, heavyFoot: 15, cavalry: 12, cart: Infinity },
    chargeStop: 0.7, fallChanceAtSpeed: 0.4, defenderBonus: { skill: 0.12, stress: -0.08 }, flammable: 0,
    note: 'Courtrai: "many horses refused; men and horses fell into the ditches". Wet ditch: cross times ×2, chargeStop 0.85.',
  }),
  moat: T({
    name: 'Wet moat', width: 10, depth: 2.5, blocksLOS: false,
    cover: { hard: 0, soft: 0 }, cross: { foot: Infinity, heavyFoot: Infinity, cavalry: Infinity, cart: Infinity },
    fillManDaysPerMetre: 30, flammable: 0,
    note: 'Must be filled (fascines, earth) or bridged.',
  }),
  earth_bank: T({
    name: 'Earth bank / rampart', height: 2.5, thickness: 5, blocksLOS: true,
    cover: { hard: 0.8, soft: 0 }, cross: { foot: 10, heavyFoot: 18, cavalry: 30, cart: Infinity },
    chargeStop: 0.9, defenderBonus: { skill: 0.2, stress: -0.12 }, flammable: 0,
  }),
  archer_stakes: T({
    name: "Archers' stakes (palings)", height: 1.2, spacingM: 1.0, depthRows: 2, blocksLOS: false,
    cover: { hard: 0.05, soft: 0 }, cross: { foot: 4, heavyFoot: 8, cavalry: Infinity, cart: Infinity },
    chargeStop: 0.97, impaleChanceAtSpeed: 0.3, plantS: 60, flammable: 0.1,
    note: 'Agincourt: ~1.8 m stakes angled at horse-chest height. Archers pull them up, carry them and replant them. Foot pass slowly through the gaps; horses at speed cannot.',
  }),
  pits_pottes: T({
    name: 'Concealed pits (pottes)', diameter: 0.4, depth: 0.6, densityPerM2: 0.5, blocksLOS: false,
    cover: { hard: 0, soft: 0 }, cross: { foot: 6, heavyFoot: 9, cavalry: 8, cart: Infinity },
    chargeStop: 0.4, fallChanceAtSpeed: 0.35, hiddenUntilM: 15, digManHoursPerPit: 0.5,
    note: 'Bannockburn and Crécy. Invisible until close, they break legs and charges.',
  }),
  caltrops: T({
    name: 'Caltrops field', densityPerM2: 2, blocksLOS: false,
    cover: { hard: 0, soft: 0 }, cross: { foot: 10, heavyFoot: 12, cavalry: 15, cart: 20 },
    chargeStop: 0.2, laminessChance: 0.15, hiddenUntilM: 5,
  }),
  abatis: T({
    name: 'Abatis (felled trees, points out)', height: 1.5, thickness: 4, blocksLOS: false,
    cover: { hard: 0.3, soft: 0.3 }, cross: { foot: 40, heavyFoot: 60, cavalry: Infinity, cart: Infinity },
    chargeStop: 1.0, defenderBonus: { skill: 0.15, stress: -0.1 }, breach: 4, flammable: 0.5,
  }),
  wagon_laager: T({
    name: 'Wagon laager', height: 2.0, thickness: 2.0, blocksLOS: true,
    cover: { hard: 0.8, soft: 0 }, cross: { foot: 12, heavyFoot: 20, cavalry: Infinity, cart: Infinity },
    chargeStop: 0.98, defenderBonus: { skill: 0.2, stress: -0.15 }, flammable: 0.5,
    note: 'Baggage as a fortress, as at Crécy (wagon park).',
  }),
  // Buildings
  timber_house: T({
    name: 'Timber / wattle house', height: 5, footprint: [5, 8], blocksLOS: true,
    cover: { hard: 0.6, soft: 0.2 }, garrison: 12, loopholes: 2, flammable: 0.9, burnMin: 15,
    buildManDays: 120, note: 'Thatch burns fast. Wattle and daub walls stop spent arrows but not axes.',
  }),
  stone_house: T({
    name: 'Stone house / hall', height: 7, footprint: [8, 14], blocksLOS: true,
    cover: { hard: 0.95, soft: 0 }, garrison: 30, loopholes: 6, flammable: 0.3, burnMin: 60,
  }),
  church: T({
    name: 'Parish church', height: 12, towerHeight: 18, footprint: [8, 22], blocksLOS: true,
    cover: { hard: 0.97, soft: 0 }, garrison: 60, flammable: 0.2,
    observationHeight: 16, note: 'The best lookout in most villages; a tower is a keep in miniature.',
  }),
  timber_tower: T({ name: 'Timber tower', height: 10, blocksLOS: true, cover: { hard: 0.85, soft: 0 }, garrison: 15, flammable: 0.7, observationHeight: 9 }),
  stone_tower: T({ name: 'Stone tower', height: 15, blocksLOS: true, cover: { hard: 0.98, soft: 0 }, garrison: 25, flammable: 0.1, observationHeight: 14 }),
  gatehouse: T({ name: 'Gatehouse', height: 12, menAbreast: 3, blocksLOS: true, cover: { hard: 0.98, soft: 0 }, garrison: 30, gateBreachManHours: 40, flammable: 0.3 }),
  // Crossings
  bridge_timber_narrow: T({
    name: 'Narrow timber bridge', width: 2.5, menAbreast: 3, horsesAbreast: 2, loadT: 3,
    cross: { foot: 1, heavyFoot: 1, cavalry: 1, cart: 1 }, flammable: 0.6, demolishManHours: 20,
    throughputPerMinPerFile: 50,
    note: 'Stirling Bridge: "only two horsemen abreast". Flow = files × ~50 men/min at 1.3 m/s with 1.5 m spacing; the far bank is isolated.',
  }),
  bridge_timber_wide: T({ name: 'Timber road bridge', width: 4.5, menAbreast: 5, horsesAbreast: 3, loadT: 8, flammable: 0.6, demolishManHours: 40, throughputPerMinPerFile: 50 }),
  bridge_stone: T({ name: 'Stone bridge', width: 4, menAbreast: 5, horsesAbreast: 3, loadT: 30, flammable: 0, demolishManHours: 400, throughputPerMinPerFile: 50 }),
  ford: T({
    name: 'Ford', // depth-dependent rules (m). The sim picks the band from the current water depth.
    bands: [
      { maxDepth: 0.5, moveMul: { foot: 0.5, heavyFoot: 0.4, cavalry: 0.6, cart: 0.4 }, drownP: 0 },
      { maxDepth: 1.0, moveMul: { foot: 0.25, heavyFoot: 0.15, cavalry: 0.4, cart: 0.1 }, drownP: 0.002, bowstringsWetIfNotCarriedHigh: true },
      { maxDepth: 1.3, moveMul: { foot: 0.1, heavyFoot: 0, cavalry: 0.25, cart: 0 }, drownP: 0.02 },
      { maxDepth: Infinity, moveMul: { foot: 0, heavyFoot: 0, cavalry: 0.15, cart: 0 }, drownP: 0.1 },
    ],
    riseWithRainMPerHour: 0.03, fleeingDrownMul: 5,
    note: 'Fleeing men crowd, fall and drown (Bannockburn "killed or drowned"). drownP is per man per crossing.',
  }),
  causeway: T({
    name: 'Causeway (raised track across wet ground)', width: 4, menAbreast: 4, horsesAbreast: 2,
    offTrackTerrain: 'marsh', note: 'Stirling Bridge was fought along a causeway on the carse.',
  }),
  ice_sheet: T({ name: 'River ice', supportKgPerM2: { thin: 80, medium: 250, thick: 1000 }, breakDrownP: 0.5 }),
  // Landform markers (sim uses the heightmap; these tag tactical meaning)
  ridge_crest: T({
    name: 'Ridge crest', note: 'See ELEVATION.crest. Topographic crest vs military crest (the highest line with a clear view down the forward slope).',
  }),
  sunken_lane: T({
    name: 'Sunken lane edge', height: 2, blocksLOS: true, cover: { hard: 0.8, soft: 0.1 },
    cross: { foot: 8, heavyFoot: 14, cavalry: Infinity, cart: Infinity }, chargeStop: 1.0,
    note: 'Invisible from a distance. Charging cavalry can plunge into it (fallChance 0.6 if unseen).', fallChanceAtSpeed: 0.6, hiddenUntilM: 30,
  }),
});

// ═══════════════════════════ ELEVATION ═══════════════════════════
// G = grade in percent (rise/run·100), positive = uphill in the direction of travel or attack.
export const ELEVATION = Object.freeze({
  // Tobler's hiking function W = 6·exp(−3.5·|S+0.05|) km/h, normalised to flat = 1.
  // The peak is at S = −5 % (×1.19). +10 % → ×0.70; +20 % → ×0.49; −20 % → ×0.70.
  footSpeed: { tobler: { a: 6, b: 3.5, c: 0.05 }, normaliseAtFlat: true },
  heavyFootExtraPerPctUp: 0.006, // armour: an additional −0.6 % speed per +1 % grade (Askew limb-loading)
  // Pandolf grade term: at 1.33 m/s each +1 % grade adds ≈17.5 % of the level locomotion cost.
  // Downhill: cost falls to a minimum around −10 % (≈0.6× level), then RISES again (braking).
  fatigue: { perPctUp: 0.175, downhillMinAt: -10, downhillMinMul: 0.6, downhillRisePerPctBeyond: 0.08 },
  cavalry: {
    maxGradeWalk: 45, maxGradeTrot: 25, maxGradeGallopUp: 12, maxGradeChargeDown: 15,
    // Charging DOWN steeper than 15 %: P(fall per horse per 10 m) = 0.01·(G−15)
    downhillFallPer10m: 0.01,
    uphillChargeSpeedMulPerPct: -0.03, // at +10 %: ×0.7 speed, so shock is lost
  },
  cart: { maxGradeLoaded: 10, maxGradeEmpty: 15, extraTeamRaisesBy: 5 },
  melee: {
    // The fighter standing higher: better reach down, gravity-assisted blows, attacker climbing.
    // Applied per 10 % of grade between the two combatants, capped at 30 %.
    higherSkillPer10Pct: 0.05, lowerSlipAddPer10Pct: 0.01, capPct: 30,
    higherStressPerSec: -0.0005, // holding the high ground steadies (Hastings shield wall held for hours)
    // Foot charge downhill: speed +10 % per 10 % grade (max +25 %), cohesion −0.1 per 10 % beyond 10 %.
    downhillChargeSpeedPer10Pct: 0.10, downhillChargeSpeedMax: 0.25, downhillCohesionLossPer10PctBeyond10: 0.10,
  },
  missile: {
    // DERIVED from the ballistic model in combat-research §9.2 (livery arrow 64 g at 53 m/s):
    // +5 m → +1.7 %, +10 → +3.8 %, +20 → +7.2 %, +40 → +14 %; −10 → −3.8 %, −20 → −8 %.
    rangeMulPerMetreUp: 0.0036, rangeMulPerMetreDown: 0.004, rangeMulMax: 1.2, rangeMulMin: 0.7,
    // Plunging from height adds ≈ m·g·Δh minus drag: livery arrow +20 m ≈ +10 J.
    energyAddJPerMetre: 0.5,
    // Shooting upward at defenders behind a crest: only targets whose head is visible can be aimed at.
    // Otherwise it is area fire without observation (dispersion ×2).
    unobservedDispersionMul: 2.0,
  },
  crest: {
    eyeHeight: { foot: 1.6, mounted: 2.5, towerExtra: 'feature.observationHeight' },
    // Reverse-slope rule: a unit whose tallest member is below the LOS ray from the observer,
    // grazing the crest, is invisible. A unit stationary 20+ m behind the crest on the reverse
    // slope is invisible to ground observers beyond ~150 m on the far side.
    reverseSlopeHideDepthM: 20,
    // Troops lying down behind a crest take ×0.2 from lofted area fire (no observation) and ×0 from direct fire.
    reverseSlopeProneAreaFireMul: 0.2,
    // Dead ground: any cell not visible from the observer's eye point is unknown, not "empty" (fog of war).
    deadGroundIsUnknown: true,
    // Skyline: men on a topographic crest are silhouetted, so detection range ×1.5 against them.
    skylineDetectionMul: 1.5,
  },
});

// ═══════════════════════════ WEATHER ═══════════════════════════
// Each state is a set of multipliers the sim composes (multiply *Mul; add *Add).
// visibilityM = the max distance at which a formed body can be seen (see the combat doc §14 table for detail levels).
// groundWetRate: wetness units per hour driving TERRAIN.wetSensitivity (1.0 = fully saturated → wetTo).
// bowstring: bow/crossbow draw-energy loss for UNPROTECTED strings after 30 min of exposure. Archers
//   who unstring and keep strings under caps or helms (reputedly the English at Crécy) lose nothing
//   until they string up again. Wet feathers widen dispersion.
export const WEATHER = Object.freeze({
  clear: T({ visibilityM: 20000, groundWetRate: -0.05, missileDispersionMul: 1.0, noiseAudibilityMul: 1.0, stressAdd: 0, dustMul: 1.0, fireSpreadMul: 1.0 }),
  overcast: T({ visibilityM: 12000, groundWetRate: -0.02, missileDispersionMul: 1.0, noiseAudibilityMul: 1.0, stressAdd: 0, dustMul: 0.9, fireSpreadMul: 0.8 }),
  drizzle: T({ visibilityM: 5000, groundWetRate: 0.1, bowstring: { energyMul: 0.95 }, missileDispersionMul: 1.1, noiseAudibilityMul: 0.9, dustMul: 0.1, fireSpreadMul: 0.3, sodden: { gambesonKgPerHour: 0.5 } }),
  rain: T({
    visibilityM: 2500, groundWetRate: 0.3, bowstring: { energyMul: 0.85, rofMul: 0.9 }, crossbowString: { energyMul: 0.9 },
    missileDispersionMul: 1.3, noiseAudibilityMul: 0.7, dustMul: 0, fireSpreadMul: 0.05,
    sodden: { gambesonKgPerHour: 1.5, gambesonKgMax: 5 }, // quilted linen soaks up several kg; this feeds Pandolf load L
    note: 'Agincourt: rain turned the ploughed field to knee-deep mud. Crécy: the storm before battle; the Genoese strings are disputed.',
  }),
  heavy_rain: T({ visibilityM: 800, groundWetRate: 0.8, bowstring: { energyMul: 0.75, rofMul: 0.8 }, crossbowString: { energyMul: 0.85 }, missileDispersionMul: 1.6, noiseAudibilityMul: 0.4, stressAdd: 0.0005, dustMul: 0, fireSpreadMul: 0, sodden: { gambesonKgPerHour: 3, gambesonKgMax: 5 }, orderGarbleAdd: 0.05 }),
  thunderstorm: T({ visibilityM: 600, groundWetRate: 1.0, bowstring: { energyMul: 0.75, rofMul: 0.8 }, missileDispersionMul: 1.8, noiseAudibilityMul: 0.3, stressAdd: 0.001, horseBoltChancePerStrikeNearby: 0.1, orderGarbleAdd: 0.1, fireSpreadMul: 0 }),
  fog_light: T({ visibilityM: 800, recognitionMul: 0.5, groundWetRate: 0.02, missileDispersionMul: 1.2, aimedFireMaxM: 400, noiseAudibilityMul: 1.1, stressAdd: 0.0003, orderGarbleAdd: 0.05 }),
  fog_thick: T({ visibilityM: 150, recognitionMul: 0.25, groundWetRate: 0.03, aimedFireMaxM: 100, missileDispersionMul: 1.5, noiseAudibilityMul: 1.1, stressAdd: 0.001, orderGarbleAdd: 0.15, misidentifyFriendP: 0.1, note: 'Barnet 1471: the star badge mistaken for the sun in splendour. Friendly fire and cries of treason.' }),
  fog_dense: T({ visibilityM: 40, recognitionMul: 0.1, groundWetRate: 0.03, aimedFireMaxM: 30, missileDispersionMul: 2.0, stressAdd: 0.002, orderGarbleAdd: 0.25, misidentifyFriendP: 0.25, bannerSignalsUsable: false }),
  snow_light: T({ visibilityM: 2000, groundSnowCmPerHour: 1, missileDispersionMul: 1.2, noiseAudibilityMul: 0.8, fireSpreadMul: 0 }),
  snow_heavy: T({
    visibilityM: 300, groundSnowCmPerHour: 4, missileDispersionMul: 1.5,
    // Shooting INTO wind-driven snow: range judgement error σ ×2 (Towton: Lancastrian arrows fell short).
    intoWindRangeJudgeErrMul: 2.0, faceIntoWindDetectMul: 0.5, stressAdd: 0.0005, fireSpreadMul: 0,
  }),
  heat: T({ // >25 °C, sun
    visibilityM: 15000, groundWetRate: -0.1, sweatLPerHourAtWork: { unarmoured: 0.8, mail: 1.3, plate: 1.8 },
    heatCollapsePerHourPerPctDeficitAbove3: 0.01, dustMul: 1.3, fireSpreadMul: 1.5, horseWaterMul: 1.5,
    note: 'Dehydration >2 % of body mass costs 10–20 % capacity. The enclosed great helm is a heat trap.',
  }),
  cold: T({ // < −5 °C
    handNumbnessSkillAdd: -0.05, bowRofMul: 0.9, glycogenBurnMul: 1.15, frostbitePerHourUnsheltered: 0.002, groundFreeze: 'frozen_ground',
  }),
  // Wind is a VECTOR applied to the ballistic model (v_rel = v − wind); the numbers below are what it produces.
  wind: T({
    levels: { calm: 0, breeze: 5, strong: 10, gale: 17 }, // m/s
    // DERIVED (livery arrow): tail +5 m/s → +3.4 % max range, +10 → +6.4 %; head −5 → −3.8 %, −10 → −7.6 %.
    // Crosswind drift at 200 m ≈ w·(t − R/(v0·cosθ)) ≈ 0.45 m per m/s (≈4.5 m at 10 m/s).
    crossDriftMPerMsAt200m: 0.45,
    dustDriftsDownwind: true, smokeDriftsDownwind: true,
    soundCarryDownwindMul: 1.5, soundCarryUpwindMul: 0.5, // trumpets are heard downwind
    fireSpreadDownwindMul: 3.0,
    note: 'Towton: the Yorkists shot with a strong wind and snow at their backs and outranged the Lancastrians.',
  }),
  night: T({
    moon: { full: 250, half: 100, crescent: 40, new_or_overcast: 15 }, // visibilityM to see a formed body
    recognitionMul: 0.1, aimedFireMaxM: 30, missileDispersionMul: 2.5, orderLatencyMul: 3, orderGarbleAdd: 0.2,
    stressAdd: 0.0015, misidentifyFriendP: 0.2, cohesionMul: 0.7, torchVisibleM: 2000,
    note: 'Battles almost never started at night. Pursuit stops at dark; night attacks on camps are panic engines.',
  }),
  low_sun: T({
    // Sun elevation < 15°: observers facing within ±20° of the sun's azimuth are dazzled.
    sunElevMax: 15, glareHalfAngle: 20, dazzledAimedDispersionMul: 1.5, dazzledDetectMul: 0.5,
    note: 'Crécy: after the storm the evening sun was reportedly in the Genoese faces (Froissart).',
  }),
});

// Reference surface used as moveMul = 1 (for tooling and tests).
export const REFERENCE_TERRAIN = 'dirt_track';
