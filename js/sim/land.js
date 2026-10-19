// Land: what each ground type PROVIDES, and what it does to what you BUILD on it.
// Built from the terrain table (forage/digIn/fireRisk/footing) plus soil & material knowledge per
// group of surfaces. The land panel shows these numbers; the economy applies them.
import { TERRAIN } from "./terrain-types.js";
import { props, describe } from "./landread.js";

// soil & material traits per surface. fert = arable fertility (1 = good loam), found = foundation
// quality (1 firm; <1 soft: more labour, weaker walls; >1 rock: sound but hard digging), wet = damp.
const G = (fert, found, wet, extra = [], note = "") => ({ fert, found, wet, extra, note });
const LAND = {
  // grassland & farmland
  short_meadow: G(1.0, 1.0, 0.2, [], "Good loam under turf."), tall_grass: G(0.95, 1.0, 0.3, ["hay"], "Uncut hay: a fodder crop in itself."),
  flower_meadow: G(0.95, 1.0, 0.3, ["hay", "honey"], "Hay meadow — bees work it."), pasture: G(0.9, 1.0, 0.2, ["wool"], "Grazed by the village flocks."),
  water_meadow: G(1.15, 0.7, 0.8, ["hay"], "Flooded each winter — the richest hay, but soft to build on."),
  fallow: G(1.0, 1.0, 0.2, [], "Resting field: plough it back in next year."), ploughed_field: G(1.1, 0.95, 0.3, [], "Ready tilth — sow it."),
  standing_wheat: G(1.1, 0.95, 0.2, ["grain"], "Growing crop: trampling it costs bread."), standing_barley: G(1.05, 0.95, 0.2, ["grain"], "Growing barley (ale, fodder)."),
  standing_oats_beans: G(1.0, 0.95, 0.2, ["grain"], "Oats & beans: fodder and pottage."), stubble: G(1.0, 1.0, 0.2, ["straw"], "Gleaned stubble: straw for thatch and bedding."),
  vineyard: G(0.8, 0.95, 0.1, ["wine"], "Warm slope, poor for grain."), orchard: G(0.9, 1.0, 0.2, ["fruit", "timber"], "Apples; fruit wood burns sweet."),
  kitchen_garden: G(1.2, 1.0, 0.2, ["vegetables", "herbs"], "Manured garden soil — the best ground in the vill."),
  // woods & scrub
  open_forest: G(0.6, 0.9, 0.3, ["timber", "game", "pannage"], "Oak wood: timber, deer, pigs on acorns. Clearing it takes labour."),
  dense_forest: G(0.5, 0.85, 0.4, ["timber", "game"], "Heavy timber; building means clearing and grubbing roots."),
  pine_forest: G(0.4, 0.95, 0.2, ["timber", "resin"], "Straight pine: easy building timber and pitch."),
  coppice: G(0.6, 0.9, 0.3, ["poles", "firewood", "charcoal"], "Hazel coppice: wattle, poles and charcoal wood — cut every 7 years."),
  bramble_thicket: G(0.5, 0.9, 0.3, ["fruit"], "Blackberries; a thorny obstacle."), hedgerow: G(0.7, 0.9, 0.3, ["fruit", "firewood"], "Laid hedge: stock-proof and cover."),
  alder_carr: G(0.2, 0.5, 0.9, ["timber", "charcoal"], "Wet alder wood: waterproof timber for piles, best charcoal for powder… and fords."),
  deadfall_clearing: G(0.6, 0.9, 0.3, ["firewood"], "Windthrow: free firewood."),
  heath_heather: G(0.35, 1.0, 0.2, ["fuel", "honey"], "Poor sandy soil; heather thatch and bee grazing."),
  moorland: G(0.25, 0.95, 0.5, ["peat", "wool"], "Thin acid soil: sheep and peat."), gorse_scrub: G(0.4, 1.0, 0.2, ["fuel"], "Gorse burns hot — bakers' fuel. Burns hot when fired, too."),
  bracken: G(0.45, 1.0, 0.2, ["bedding"], "Bracken for bedding and potash."),
  // bare & worked ground
  bare_earth: G(0.8, 1.0, 0.2, [], ""), dirt_track: G(0.3, 1.1, 0.2, [], "Road: carts move fast here."), hollow_way: G(0.3, 1.0, 0.4, [], "Sunken lane worn by centuries of carts."),
  cobbled_road: G(0, 1.2, 0.1, [], "Metalled road."), stone_paving: G(0, 1.2, 0.1, [], "Paved."), village_street: G(0.2, 1.1, 0.3, [], ""),
  trampled_ground: G(0.6, 1.0, 0.3, [], ""), battlefield_churn: G(0.5, 0.8, 0.6, [], "Churned by feet and hooves."), camp_ground: G(0.5, 1.0, 0.3, [], ""),
  // wet ground
  mud: G(0.5, 0.6, 0.9, ["clay"], "Soft: buildings settle and crack."), clay_heavy: G(0.9, 0.85, 0.7, ["clay", "bricks"], "Heavy clay: fertile but hard to plough; daub, tiles and pots."),
  peat_bog: G(0.1, 0.35, 1, ["peat", "bog_iron"], "Peat to burn; bog iron ore in the pools. Terrible foundations."),
  marsh: G(0.15, 0.4, 1, ["reeds", "fowl", "fish"], "Reeds for thatch, wildfowl, eels. Build only on piles."),
  reed_bed_fen: G(0.1, 0.35, 1, ["reeds", "fowl"], "The best thatching reed there is."), salt_marsh: G(0.1, 0.4, 1, ["salt", "wool"], "Salt pans and sheep."),
  tidal_mudflat: G(0, 0.2, 1, ["shellfish"], ""), shallow_ford: G(0, 0.3, 1, ["fish"], "Crossing place."), stream_bed: G(0, 0.4, 1, ["fish", "gravel"], "Water power for a mill."),
  deep_water: G(0, 0, 1, ["fish"], "Fish, and a moat if you want one."), riverbank_shingle: G(0.1, 1.0, 0.5, ["gravel", "sand"], "Gravel for mortar and roads."),
  // stone & sand
  gravel: G(0.3, 1.1, 0.1, ["gravel"], "Free-draining; aggregate for mortar."), sand: G(0.3, 0.8, 0.1, ["sand", "glass"], "Mortar sand; dry but shifting footings."),
  dunes: G(0.1, 0.6, 0.1, ["sand"], ""), beach_wet: G(0, 0.4, 0.8, ["sand", "shellfish"], ""),
  chalk_downland: G(0.55, 1.15, 0.1, ["chalk", "lime", "wool", "flint"], "Chalk: burn it for lime mortar; flint for walls; sheep walk."),
  limestone_pavement: G(0.1, 1.3, 0.1, ["stone", "lime"], "Limestone: building stone and lime for mortar."),
  scree: G(0.05, 0.7, 0.1, ["stone"], "Loose stone: easy quarrying, bad footing."), cliff_rock: G(0, 1.4, 0.1, ["stone"], "Solid rock: unassailable foundations."),
  rock_slab: G(0.05, 1.4, 0.1, ["stone"], "Bedrock: a keep built here can't be mined."), boulder_field: G(0.1, 1.2, 0.1, ["stone"], "Field-stone for walls, free for the carrying."),
  quarry_floor: G(0, 1.3, 0.1, ["stone"], "Worked quarry."),
  // cold & damaged
  snow_light: G(0.5, 1.0, 0.5, [], "Snow over the ground."), snow_deep: G(0.4, 0.9, 0.6, [], ""), slush: G(0.4, 0.8, 0.8, [], ""),
  frozen_ground: G(0.3, 1.1, 0.4, [], "Frozen: digging foundations is slow."), ice: G(0, 0.5, 1, [], ""),
  burned_ground: G(1.05, 1.0, 0.2, ["charcoal"], "Ash-enriched: a good crop next year."), ruins_rubble: G(0.2, 1.0, 0.2, ["stone"], "Old masonry to rob for new walls."),
  ditch: G(0.4, 0.6, 0.7, ["clay"], ""), earth_rampart: G(0.4, 1.0, 0.3, [], "A bank: height for defenders."),
};

const RES_NAME = {
  hay: "hay (fodder)", grain: "grain", wool: "wool", timber: "timber", game: "game (meat)", pannage: "pig pannage", poles: "poles & wattle",
  firewood: "firewood", charcoal: "charcoal wood", fruit: "fruit", vegetables: "vegetables", herbs: "herbs (infirmary)", honey: "honey & wax",
  resin: "resin & pitch", fuel: "fuel", peat: "peat (fuel)", bedding: "bedding", clay: "clay", bricks: "tile & pot clay", bog_iron: "bog iron ore",
  reeds: "thatching reed", fowl: "wildfowl", fish: "fish & eels", salt: "salt", shellfish: "shellfish", gravel: "gravel", sand: "sand",
  glass: "glass sand", chalk: "chalk", lime: "lime (mortar)", flint: "flint", stone: "building stone", straw: "straw", wine: "wine",
};

export function landAt(map, x, y) {
  // read from the land's physical makeup (landread.js); the painted surface is only a fallback
  if (map.land) {
    const k = map.land.idx(x, y), p = props(map.land, k);
    const note = [p.bog > 0.5 ? "Waterlogged: water arrives here faster than it drains." : "", p.rock > 0.35 ? "Rock close under the turf." : "",
      p.wood > 0.25 ? "Tree cover: timber, game and hiding places." : "", p.soil < 0.35 && p.rock < 0.35 ? "Thin, exposed soil." : "",
      p.soil > 0.8 && p.wet < 0.5 && p.slope < 0.1 ? "Deep, well-drained soil." : ""].filter(Boolean).join(" ");
    return { key: describe(p), name: describe(p), slope: p.slope, fert: p.fertility * 1.2, found: p.foundation, wet: p.wet, note, provides: p.provides, fireRisk: p.fireRisk, digIn: p.digIn, phys: p };
  }
  const key = map.surfaceAt(x, y), t = TERRAIN[key] || {}, L = LAND[key] || G(0.7, 1, 0.3);
  const [gx, gy] = map.grad(x, y), slope = Math.hypot(gx, gy);
  const fo = t.forage || {};
  const provides = [];
  if (fo.graze) provides.push({ res: "grazing", amount: fo.graze, text: `grazing for ~${Math.round(fo.graze / 10)} sheep/ha` });
  if (fo.food) provides.push({ res: "forage", amount: fo.food, text: `forage for men (${fo.food} kg/ha)` });
  if (fo.wood) provides.push({ res: "timber", amount: fo.wood, text: `standing timber (~${fo.wood} t/ha)` });
  for (const r of L.extra) if (!provides.some((p) => p.res === r)) provides.push({ res: r, text: RES_NAME[r] || r });
  return { key, name: t.name || key, slope, fert: L.fert, found: L.found, wet: L.wet, note: L.note, provides, fireRisk: t.fireRisk ?? 0.1, digIn: t.digIn ?? 0.5 };
}

// What building `kind` here does differently. Returns { labourMul, yieldMul, hpMul, fireMul, lines[] }.
export function buildEffects(map, kind, x, y) {
  const A = landAt(map, x, y), lines = [];
  let labourMul = 1, yieldMul = 1, hpMul = 1, fireMul = 1, outMul = 1;
  // foundations: soft ground costs piling & draining; rock is sound but slow to cut; slope needs terracing
  if (A.found < 0.8) { labourMul *= 1 + (0.8 - A.found) * 2.5; hpMul *= 0.6 + 0.5 * A.found; lines.push(`soft ground: +${Math.round((labourMul - 1) * 100)}% labour (piles & drains), weaker walls`); }
  if (A.found > 1.15) { hpMul *= 1 + (A.found - 1) * 0.8; if (kind !== "field") { labourMul *= 1.15; lines.push(`bedrock: walls ${Math.round((hpMul - 1) * 100)}% stronger and can't be undermined; +15% labour cutting footings`); } }
  if (A.slope > 0.1) { const m = 1 + (A.slope - 0.1) * 4; labourMul *= m; lines.push(`slope ${Math.round(Math.atan(A.slope) * 57)}°: terracing +${Math.round((m - 1) * 100)}% labour`); }
  if (A.provides.some((p) => p.res === "timber") && kind !== "lumber_camp") { labourMul *= 1.25; lines.push("woodland: clearing & grubbing +25% labour (the timber goes to your stores)"); }
  if (kind === "field") {
    yieldMul = A.fert * (A.wet > 0.8 ? 0.4 : 1) * (A.slope > 0.15 ? 0.7 : 1);
    lines.push(`crop yield ×${yieldMul.toFixed(2)} — ${A.fert >= 1.05 ? "rich soil" : A.fert >= 0.85 ? "fair soil" : A.fert >= 0.5 ? "poor soil" : "hardly worth ploughing"}${A.wet > 0.8 ? ", waterlogged" : ""}`);
  }
  if (kind === "granary" && A.wet > 0.5) { outMul = 0.7; lines.push("damp ground: grain spoils faster (−30% keeping)"); }
  if (kind === "mill") { const water = A.provides.some((p) => p.res === "fish") || (A.phys && A.phys.wet > 0.55); outMul = water ? 1.3 : 0.6; lines.push(water ? "running water: full water power (+30%)" : "no water: horse-mill only (−40%)"); }
  if (kind === "lumber_camp" && A.provides.some((p) => p.res === "timber")) { outMul = 1.3; lines.push("in the wood: +30% felling"); }
  if (kind === "mining_camp" && A.provides.some((p) => ["stone", "lime", "chalk", "flint"].includes(p.res))) { outMul = 1.3; lines.push("on the rock: +30% quarrying"); }
  if (kind === "charcoal_kiln" && A.provides.some((p) => ["charcoal", "poles", "timber"].includes(p.res))) { outMul = 1.25; lines.push("coppice/woodland at hand: +25% charcoal"); }
  if (kind === "bloomery" && A.provides.some((p) => p.res === "bog_iron")) { outMul = 1.3; lines.push("bog iron in the ground: +30% iron"); }
  if (kind === "weaver" && A.provides.some((p) => p.res === "grazing")) { outMul = 1.15; lines.push("sheep country: +15% cloth"); }
  if (kind === "temple" && A.phys && A.phys.soil > 0.8 && A.phys.wet < 0.5) { outMul = 1.2; lines.push("herb garden: infirmary heals 20% faster"); }
  if (kind === "watchtower" || kind === "mage_tower") lines.push(`sees from ${Math.round(map.h(x, y))} m above datum — higher ground sees further`);
  const fr = A.fireRisk; if (fr > 0.3) { fireMul = 1 + fr; lines.push(`dry, burnable ground: fires spread ${Math.round(fr * 100)}% faster`); }
  if (A.wet > 0.8) { fireMul *= 0.6; lines.push("wet ground: hard to set alight"); }
  if (!lines.length) lines.push("good firm ground — no penalties");
  return { land: A, labourMul, yieldMul, hpMul, fireMul, outMul, lines };
}
