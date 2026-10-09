// Economy calibration tables. DATA ONLY — behaviour lives in economy.js / logistics.js.
// Every number traces to docs/economy-research.md (§ refs) or is marked EST (tune in playtests).
// Units: mass kg, money d (silver pennies; 12 d = 1 s), gold counted in s, time ECONOMIC DAYS,
// labour MAN-DAYS (one worker's 10-hour working day). Clock conversion: js/sim/clock.js.

export const E = {
  // GAME PACING (owner): real man-day costs stay (a cottage 121 md, a granary 503 md — so their RATIOS are
  // honest), but site work runs this many times faster than the calendar, or 12 men need 12 real minutes
  // for a cottage. More hands still finish sooner (progress = men × days × this).
  buildSpeed: 5,
  startDoy: 121,            // 1 May: the "hungry gap" before harvest (§10: sowing→harvest season)
  latitude: 52,             // southern England: day length 7.7–16.6 h
  workdayFrac: 0.72,        // 260–270 working days/yr after Sundays & feasts (§1 [ACOUP-PEASANT]); harvest weeks fully worked
  commuteMul: 1.2,          // worker dots walk to a job at a brisk walking pace (owner: at 8× they outran cavalry)
  rations: { dependant: 0.65, labourer: 1.0, soldier: 1.2 }, // kg grain-eq/day (§2.1; soldier = 1 ration)
  fuelPerPerson: 1.0,       // kg firewood/person/day, summer cooking & baking (EST)
  horse: { grainWork: 4.5, grainDestrier: 4.5, hayWork: 4.5, studMares: 8, foalRate: 0.6, breakDays: 365 }, // (a paddock's stud: mares, foals a mare a year, days to break a foal to the saddle — game pace) // §2.2 [ENGELS]
  // the great horse (economy.js breedHorses): a paddock beside a finished stables, with a herd of good horses to pick from
  // (minHorses riding horses in store), puts the best colts aside each spring — perPaddock a year, up to maxPads paddocks,
  // twice that with a destrier of the house's own at stud — and schools them days (§6: "3–5 years of breeding and
  // training"; 1.5× the riding horse's breaking at game pace). EST: one or two a year against the market's 4,800 d each.
  destrier: { minHorses: 6, perPaddock: 1, maxPads: 2, sireMul: 2, days: 548 },
  // Carriers (§4). v = loaded walking speed m/s, load = min per trip loading/unloading (s).
  carriers: {
    man:       { kg: 30,  v: 1.1, load: 60 },
    packhorse: { kg: 90,  v: 1.2, load: 300 },
    cart:      { kg: 500, v: 1.1, load: 1800 },  // one-horse cart [CARTS]
    oxcart:    { kg: 600, v: 0.8, load: 1800 },
  },
  // Output per man-day at the node (before hauling). §3.2
  yieldPerManDay: {
    timber: 700,    // felled+trimmed logs: 1–2 man-h per 30–40 cm tree (~300 kg green) EST
    firewood: 900,  // 0.5–1 cord coppice
    stone: 1500,    // 0.5–1 m³ rough block @2.6 t/m³ [BEAUMARIS ratio]
    ore: 300,       // bog-iron ore dug & roasted (EST)
    fresh: 3.5,     // fishing / fowling / hunting 2–5 kg/day
    mana: 1,        // a trained adept at a ley site (low-fantasy, rare)
    silver: 15,     // d of silver per miner-day from a lead-silver working (game balance: a worked vein pays a company's wages)
    gold: 2,        // s of gold per miner-day from a quartz stringer (game balance, rarer still)
    clay: 1200,
  },
  garden: [1.2, 2.4],       // fresh kg grain-eq per home-worker day, May → July (peas, beans, dairy, eggs) EST
  dairyPerPerson: 0.08,     // abstract cows/goats milk per head of population/day EST
  threshPerManDay: 113,     // 0.24 man-days/bu, 1 bu ≈ 27 kg [CLARK]
  reapManDaysPerHa: 8.65,   // reap+bind+stook 2.5 + cart 1 man-days/acre (§3.1)
  weedManDaysPerHa: 1.0,    // hoeing/weeding in the growing window (EST)
  // lane A (js/sim/jobs/fields.js): the field's year. One ploughing ≈ 1 acre/day per team (ploughman + driver, §3.1 EST
  // Walter of Henley) ≈ 5 man-days/ha; harrow + broadcast sowing ≈ 1 day/acre; by spade (no oxen) ×4. Like buildSpeed,
  // field preparation runs fieldPrepSpeed× the calendar (game pacing: a new field is in the ground within days).
  ploughManDaysPerHa: 5, sowManDaysPerHa: 2.5, digMul: 4, fieldPrepSpeed: 8,
  spoil: { fresh: 0.06, grainOpen: 0.0006, grainGranary: 0.0001, sheaves: 0.0004, overflow: 0.01, hay: 0.0005 }, // /day EST
  handGrindLabour: 0.06,    // share of labour lost to hand-querns without a mill (≈1 h per kg) EST
  multure: 1 / 16,          // miller's toll on grain ground
  birthsPerYear: 0.035, deathsPerYear: 0.030, // crude rates, England c.1300 EST
  comeOfAgePerYear: 0.045, // of the dependants, a year: ~60 % of them children, one fourteenth of those turning fourteen (economy.js comingOfAge) EST
  familySize: [2, 2.5],     // migrants: labourers, dependants per household (§1: household 4.5–5)
  immigrationPerDay: 0.35,  // max families/day when housing, food and order allow EST
  immigrationMarginDays: 30, // incomers only when the food in hand (their mouths counted) reaches the next harvest + this (economy.js fedForIncomers)
  rentsPerPersonDay: 0.4,   // d: rents, dues, court fines, demesne sales ≈ £90/yr for a 250-soul manor EST
  shearDoy: [160, 180], woolPerSheep: 0.7, shearManDaysPer100: 1.2,
  homeRadius: 1500, homePayFrac: 0.25,
  investRadius: 700,        // enemy strength inside this of the hall = town invested (siege)
  supplyRadius: 550,        // units within this of a food store draw on the town
  fireSecs: 1800,           // battle-seconds for a thatched building to burn out (tactical clock)
  // Keep-only start (a new foundation): provisions brought to bridge the hungry gap to the first harvest.
  // share = what the stores must cover (gardens, dairy, fish and game make up the rest); margin covers
  // reaping and threshing before the new corn is edible. EST — tuned in tools/playtest.mjs so neither
  // town starves before its harvest unless it is raided, besieged or campaigns in May.
  provisionShare: 0.85, provisionMarginDays: 14,
  // THE CROFTS' HEMP (homeWork; §8d): every household grew a patch of hemp in its croft; pulled in August, retted, broken and
  // scutched at home into the autumn. doy: the season; perManDay: kg of dressed fibre a home worker makes a day (EST, generous: game pace);
  // perHouse: kg a croft's patch yields in a year (~0.07 ha at ~600 kg/ha, EST) — the year's crop, then the gardens again.
  hemp: { doy: [213, 289], perManDay: 4, perHouse: 40 },
  // WOODS GROW BACK (economySystem; §8d): a coppice is cut on a 7–15 year round and stands again; high wood regrows slower.
  // Share of the wood's first stand a year (EST: a 7-year coppice, a 30-year timber wood, game pace). A wood cut out rests
  // until it stands at `ready` of its first stand (a coppice ~9 months, a timber wood 3 years), then it is worked again.
  regrow: { coppice: 1 / 7, wood: 1 / 30, ready: 0.1 },
  // GAME PACING for the raw-material works (like buildSpeed; the owner: "my men like take forever getting iron and stuff"):
  // the bloomery's smelts and the colliers' burns run this many times faster than their man-days (economy.js craftWork).
  // A smelt is still 20 kg of ore and 30 kg of charcoal (§3.2 [BLOOMERY]); the clamp still 6 kg of wood to 1 of charcoal.
  worksSpeed: { bloomery: 5, charcoal_kiln: 5 },
  // the colliers burn in the wood (§8d): a clamp within `reach` m of a standing wood or coppice cuts its own cordwood there —
  // nothing hauled — its burns taking cutMul × as long (cutting ~720 kg of cordwood ≈ 0.8 man-days at coppice rates) EST
  colliers: { reach: 160, cutMul: 1.8 },
};

// Starting pools of trained men who LIVE in the town and work as labourers (§7 game proposal).
// Roles are per labourer dot.
export const ROLES = ["woman", "man", "archer", "spear", "rider", "smith", "fletcher", "weaver", "carpenter", "mason", "adept"];
export const ROLE = Object.fromEntries(ROLES.map((r, i) => [r, i]));
export const MALE = new Set([ROLE.man, ROLE.archer, ROLE.spear, ROLE.rider, ROLE.smith, ROLE.fletcher, ROLE.carpenter, ROLE.mason]);

// Crops (§3.1 [YIELDS]): gross kg/ha (≈13 bu/acre wheat), seed kg/ha kept back, ripening doy.
export const CROPS = {
  wheat:  { yieldKgHa: 870, seedKgHa: 170, ripe: 222, sown: 290 - 365 },
  barley: { yieldKgHa: 950, seedKgHa: 270, ripe: 212, sown: 95 },
  oats:   { yieldKgHa: 820, seedKgHa: 200, ripe: 228, sown: 95 },
  peas:   { yieldKgHa: 700, seedKgHa: 200, ripe: 205, sown: 80 },
};

// Market base prices (d per kg or per item), c.1300 (§8), and depth (units/econ-day the
// market can absorb or supply before prices move). Spread: buy ×1.25, sell ×0.8.
export const PRICES = {
  grain: [0.33, 2500], hay: [0.05, 3000], timber: [0.03, 8000], firewood: [0.03, 5000], charcoal: [0.15, 1500],
  stone: [0.02, 6000], ore: [0.1, 1500], iron: [2.5, 60], wool: [7, 200], cloth: [12, 60], staves: [4, 12],
  spears: [8, 20], pikes: [12, 10], swords: [30, 4], mail: [480, 0.7], helms: [36, 3], gambeson: [60, 3],
  lances: [10, 8], plates: [240, 1], bows: [16, 6], crossbows: [60, 1.5], arrows: [0.6, 600], bolts: [0.5, 400], arrowheads: [0.15, 1000],
  hemp: [0.4, 1500], rope: [1.2, 300], ladders: [4, 12], // (rope: hemp line from the ropewalk; siege-research.md)
  horses: [240, 0.6], destriers: [4800, 0.4], packhorses: [120, 1], carts: [60, 1], oxen: [160, 1],
};
export const SPREAD = { buy: 1.25, sell: 0.8 };

// A MANOR'S INCOME besides rents (js/sim/income.js; docs/economy-research.md §8c). All EST, sized to the sources there.
//   floor      the reeve sells surplus only while the going rate is at least this share of the market's base sell price
//              (pressure: price() falls with what the house sold lately), so he never dumps
//   chunk      he sells in lots of this share of the good's depth, each at the price the last lot left
//   carriage   d a kg to cart a load to the nearest market town when the house has no market of its own: ~6⅔ miles
//              (Bracton's market distance) at ~1.5 d the ton-mile by cart [MASSCHAELE] ≈ 10 d the ton
//   carryMin   carted only while it still fetches this share of the price at home (stone is never worth the carting)
//   cartKg     what a cart takes to the market town and back in a day; a packhorse a fifth of it
//   stallage   d a stall a day; a stall for every perStall souls of the vill
//   tollHead   d a head a day: tolls on the vill's own and its neighbours' marketing, × the roads into the town
//   tollRate   the toll on the value of the market's dealings with outside merchants (the house's own trade there)
//   roads      the market's reach: base + per × the roads into the town (within 250 m of the market), capped
//   fair       the town's yearly fair (most market charters granted one): St Bartholomew's, 24 August, three days, dues × mul
export const INCOME = {
  floor: 0.7, chunk: 0.05, carriage: 0.01, carryMin: 0.5, cartKg: 500, horseKg: 100,
  stallage: 0.5, perStall: 16, tollHead: 0.04, tollRate: 1 / 40,
  roads: { base: 0.5, per: 0.25, max: 1.75, ring: 250 },
  fair: { doy: 236, days: 3, mul: 4, name: "St Bartholomew's fair" },
};

// GOLD (docs/economy-research.md §8b). Gold is counted in shillings (T.store.gold): its worth in pennies is set by the
// market's money-changers, not fixed. Base 13 d the shilling of gold (England's gold:silver ≈ 1:10–1:12 by weight, and a
// gold penny of 1257 cried at 20 d, later 24 d: dear coin, worth more than its face in silver); the changer buys your gold at
// 12 d and sells you his at 14 d (his table's spread), and both move with what the house has changed lately (depth: s a day).
// The wages and the silver market still fall back on gold at 12 d (economy.js daily, trade): the changer's buying rate.
export const GOLD = { mid: 13, sell: 12, buy: 14, depth: 300 };
// what the market sells only for gold (the horse-copers and the armourers of Lombardy and Flanders deal in florins): bought and
// sold at PRICES (× SPREAD) ÷ GOLD.mid, in shillings of gold. Everything else keeps its silver price.
export const GOLD_GOODS = new Set(["destriers", "mail", "plates"]);
// MERCENARIES — hired at the market for gold (js/sim/gold.js): real men with their own arms and harness (none from the store),
// paid daily in gold while they serve; a company unpaid MERC_GRACE days marches off. hire = the prest (an advance of 20
// days' wages, the "regard" of the indentures) in s of gold; pay = d a man a day, paid in gold at 12 d the shilling, its face
// (the contract is reckoned in money of account; the captain takes gold, never a cart of pennies) (EST: above the
// Crown's own scale — 4 d a crossbowman, 2 d a foot soldier, 12 d a man-at-arms — as hired foreigners were dearer).
export const MERCS = {
  genoese:    { name: "Genoese crossbowmen", arm: "crossbow", men: 20, training: 0.6, pay: 6, blurb: "Twenty crossbowmen of Genoa with their pavises and bolts: the best shot on hire in Christendom." },
  brabancons: { name: "Brabançon pikes", arm: "pikemen", men: 30, training: 0.55, pay: 4, blurb: "Thirty foot of Brabant and Flanders, pike and helm: hard men who hold a line." },
  routiers:   { name: "A routier company", arm: "menatarms", men: 12, training: 0.7, pay: 18, blurb: "Twelve men-at-arms of a free company, in mail and plate: dear, and deadly." },
};
export const MERC_HIRE_DAYS = 20, MERC_GRACE = 3, MERC_AWAY = 20; // (MERC_AWAY: days before a company that left will take your gold again)
export const mercHire = (k) => Math.round(MERCS[k].men * MERCS[k].pay * MERC_HIRE_DAYS / 12);   // s of gold: 200, 200, 360
export const mercDay = (k, n = MERCS[k].men) => n * MERCS[k].pay / 12;                           // s of gold a day: 10, 10, 18

// Workshops: recipe per product. `days` = craftsman-days per batch; `needs` per batch; `fuel`
// charcoal kg per batch (§6). Unskilled hands work at `unskilled` × speed.
export const RECIPES = {
  blacksmith: {
    trade: "smith", unskilled: 0.3,
    spears:     { days: 0.5, needs: { iron: 0.4, timber: 3 }, fuel: 1 },
    pikes:      { days: 0.7, needs: { iron: 0.5, timber: 6 }, fuel: 1.2 },
    swords:     { days: 5, needs: { iron: 2 }, fuel: 10 },
    mail:       { days: 40, needs: { iron: 10 }, fuel: 25 },   // 300–500 h [MAIL]
    helms:      { days: 1.5, needs: { iron: 1.5 }, fuel: 4 },
    lances:     { days: 0.5, needs: { iron: 0.3, timber: 5 }, fuel: 0.8 },
    arrowheads: { days: 1, needs: { iron: 1.5 }, fuel: 3, batch: 125 }, // 100–150/day, 12 g each
    plates:     { days: 12, needs: { iron: 8, cloth: 2 }, fuel: 15, tech: "coat_of_plates" }, // a coat of plates (research: js/sim/tech.js) EST ~120 h, ~8 kg of plate
  },
  fletcher: {
    trade: "fletcher", unskilled: 0.35,
    arrows:    { days: 1, needs: { timber: 1, arrowheads: 20 }, batch: 20 }, // 16–24/day [FLETCH]
    bolts:     { days: 1, needs: { timber: 1.2, arrowheads: 25 }, batch: 25 },
    bows:      { days: 1, needs: { staves: 1 } },                           // needs a SEASONED stave (1–3 yrs)
    // the bowyer cleaves yew (or elm, wych-elm) billets into staves and roughs them out: four a day, then they are laid by
    // to season a year before a bow can be made of them (§6, §8d; season: econ days in economy.js T.seasoning) EST
    staves:    { days: 1, needs: { timber: 30 }, batch: 4, season: 365 },
    crossbows: { days: 7, needs: { timber: 3, iron: 1 } },
  },
  weaver: {
    trade: "weaver", unskilled: 0.4,
    rope:     { days: 1, needs: { hemp: 22 }, batch: 20 },   // a ropewalk pair lays ~20 kg of hemp line a day (siege-research.md §5)
    cloth:    { days: 1, needs: { wool: 2.4 }, batch: 2 },   // spinning is done by dependants at home
    gambeson: { days: 9, needs: { cloth: 5 } },              // 60–120 h sewing
  },
  // Engines (docs/siege-research.md §5). Carpenter-days per engine; timber kg, iron kg (fittings, axles,
  // hoops, the ram's head), rope kg (slings, pulling ropes, torsion skeins). A counterweight trebuchet is
  // NOT built here: the yard makes its ironwork, axle, sling and ropes ("trebuchet_gear"); its baulks go out
  // as raw timber on carts and it is framed up where it is to shoot (siege.js, assembling).
  siege_workshop: {
    trade: "carpenter", unskilled: 0.35,
    trebuchet_gear: { days: 16, needs: { timber: 600, iron: 80, rope: 150 } },
    mangonels:      { days: 10, needs: { timber: 1800, iron: 25, rope: 110 } },
    springalds:     { days: 9, needs: { timber: 450, iron: 35, rope: 25 } },
    rams:           { days: 8, needs: { timber: 4200, iron: 60, rope: 40 } },
    siege_towers:   { days: 28, needs: { timber: 12000, iron: 140, rope: 90 } },
    mantlets:       { days: 1.2, needs: { timber: 180, iron: 1 } },
    ladders:        { days: 0.4, needs: { timber: 35 } },
    // a two-wheeled cart: the wright's frame and shafts, two spoked wheels shod with iron strakes and nails (§8d) EST
    carts:          { days: 4, needs: { timber: 350, iron: 6 } },
  },
  charcoal_kiln: { trade: null, unskilled: 0.8, charcoal: { days: 1, needs: { timber: 720 }, batch: 120 } }, // 6 kg wood → 1 kg
  bloomery:      { trade: "smith", unskilled: 0.5, iron: { days: 1, needs: { ore: 20, charcoal: 30 }, batch: 6 } }, // [BLOOMERY]: a smelt a day, 20 kg ore + 30 kg charcoal → 6 kg bloom (3–6: a good smelt, from the rich bog ore; was 4). (Was 1 kg/day: below the research, and the owner's house sat on 42 t of ore with 9 kg of iron)
  // the moneyers (js/sim/estates.js): gold struck into pennies at 13 d the shilling (the market's 12, and the mint's profit)
  mint:          { trade: "smith", unskilled: 0.3, silver: { days: 1, needs: { gold: 2 }, fuel: 1, batch: 26 } },
};

// BOARDS (lane B, js/sim/jobs/forestry.js): two sawyers at the saw-pit beside a lumber camp rip logs from the camp's store
// into boards, stacked by the pit and carried into the store. A pair of pit-sawyers cut ~200 ft of plank a day (~0.45 m³,
// ~350 kg green oak) EST; ~60 % of the log comes out as boards, ~30 % as slabs (the camp's firewood), the rest sawdust.
// The pit works only while the stores hold timber to spare and boards are wanted (target).
export const SAWING = { timberPerManDay: 290, boardYield: 0.6, slabYield: 0.3, loadKg: 1000, minTimber: 6000, target: 8000, stackCarry: 500 };

// Buildings. labour = man-days (§5); mat = kg of materials hauled to the site; perMetre walls
// scale by length. stores: resources a building accepts (true = everything). staff = max workers. money = d of silver
// paid when it is staked out; gold = s of gold besides (the minster's shrine and relic, the palace's gilding: §8b).
// Art stages: build1 (progress < 0.4), build2 (< 1), complete; plus damaged / burning / ruin.
export const BUILDINGS = {
  town_hall:   { name: "Keep & Manor", labour: 250000, mat: { stone: 6e6 }, hp: 6000, sight: 800, eyeH: 18, stores: true, capacity: { grain: 25000 }, pop: 45, stone: true, recruits: ["levy", "spearmen", "archers", "hobelars", "scouts"], garrison: 60, footprint: [22, 18], prebuiltOnly: true },
  temple:      { name: "Church & Infirmary", labour: 30000, mat: { stone: 8e5 }, hp: 3000, stone: true, heals: true, footprint: [14, 24], prebuiltOnly: true },
  house:       { name: "Cruck House", labour: 120, mat: { timber: 3000 }, hp: 300, pop: 5, flammable: 1, footprint: [5, 8] },
  granary:     { name: "Granary & Barn", labour: 500, mat: { timber: 9000, stone: 3000 }, hp: 700, stores: ["grain", "sheaves", "seed", "hay"], capacity: { grain: 60000 }, flammable: 0.8, staff: 12, footprint: [10, 22] },
  mill:        { name: "Mill", labour: 900, mat: { timber: 10000, stone: 3000 }, money: 480, hp: 600, flammable: 0.6, staff: 1, footprint: [10, 10] },
  lumber_camp: { name: "Lumber Camp", labour: 40, mat: { timber: 600 }, hp: 200, stores: ["timber", "firewood", "boards"], flammable: 1, footprint: [10, 8] },
  mining_camp: { name: "Mining Camp", labour: 60, mat: { timber: 1000 }, hp: 250, stores: ["stone", "ore", "silver", "gold", "clay"], flammable: 0.7, footprint: [10, 8] },
  charcoal_kiln: { name: "Collier's Clamp", labour: 10, mat: {}, hp: 100, staff: 3, flammable: 0.3, footprint: [8, 8] },
  bloomery:    { name: "Bloomery", labour: 150, mat: { stone: 4000, timber: 1000 }, hp: 400, staff: 6, footprint: [8, 8] },
  blacksmith:  { name: "Smithy", labour: 150, mat: { timber: 2500, stone: 2000 }, hp: 500, staff: 4, flammable: 0.5, footprint: [10, 8] },
  fletcher:    { name: "Fletcher & Bowyer", labour: 100, mat: { timber: 2000 }, hp: 300, staff: 4, flammable: 1, footprint: [8, 8] },
  weaver:      { name: "Weaver & Armourer", labour: 100, mat: { timber: 2000 }, hp: 300, staff: 4, flammable: 1, footprint: [8, 7] },
  barracks:    { name: "Muster Hall & Armoury", labour: 300, mat: { timber: 8000, stone: 2000 }, hp: 1000, flammable: 0.7, staff: 10, recruits: ["levy", "spearmen", "pikemen", "menatarms", "crossbow"], footprint: [16, 10] },
  archery_range: { name: "Archery Butts", labour: 30, mat: { timber: 200 }, hp: 200, recruits: ["archers"], staff: 20, footprint: [40, 12] },
  stables:     { name: "Stables", labour: 400, mat: { timber: 9000 }, hp: 700, flammable: 1, recruits: ["hobelars", "knights", "scouts"], staff: 6, footprint: [18, 12] },
  paddock:     { name: "Horse Paddock", labour: 60, mat: { timber: 1500 }, hp: 150, graze: 20, footprint: [60, 60] },
  market:      { name: "Market", labour: 150, mat: { timber: 2000, stone: 1000 }, hp: 500, flammable: 0.6, footprint: [16, 16] },
  watchtower:  { name: "Watchtower", labour: 350, mat: { timber: 12000 }, hp: 600, sight: 1300, eyeH: 14, garrison: 6, flammable: 0.8, footprint: [6, 6] },
  mage_tower:  { name: "Adepts' Tower", labour: 2500, mat: { stone: 60000, timber: 3000 }, hp: 2500, stone: true, sight: 1000, eyeH: 20, manaCap: 200, footprint: [9, 9] },
  // Fortifications (§5.1/5.3). Palisade = posts + fighting walkway + ditch & bank ≈ 2 man-days/m.
  palisade:    { name: "Palisade & Ditch", perMetre: true, labour: 2, earthwork: 1.2, mat: { timber: 600 }, hp: 250, wall: "wood", cover: 0.8, height: 3.5, flammable: 0.5 },
  stone_wall:  { name: "Stone Curtain", perMetre: true, labour: 110, mat: { stone: 23000 }, hp: 2500, wall: "stone", cover: 0.95, height: 6, stone: true },
  gate:        { name: "Timber Gate", labour: 200, mat: { timber: 15000 }, hp: 1500, sight: 500, eyeH: 8, flammable: 0.5, footprint: [12, 8] },
  gatehouse:   { name: "Stone Gatehouse", labour: 3000, mat: { stone: 150000, timber: 5000 }, hp: 3500, sight: 600, eyeH: 11, stone: true, footprint: [12, 10] },
  tower:       { name: "Mural Tower", labour: 9000, mat: { stone: 900000 }, hp: 30000, sight: 700, eyeH: 15, stone: true, footprint: [11, 11], prebuiltOnly: true }, // a castle's flanking tower (castle.js; siege.js STRUCT.tower)
  siege_workshop: { name: "Siege Workshop", labour: 260, mat: { timber: 7000, stone: 500 }, hp: 700, staff: 8, flammable: 1, recruits: ["trebuchet", "mangonel", "springald", "ram", "siege_tower", "mantlet"], footprint: [22, 14] },
  // THE LATE GAME (js/sim/estates.js: what each one does; js/sim/stages.js stages 4–6). tech: a study that must be learned
  // first (js/sim/tech.js); unique: one to a house; the shell keep is raised ON the motte and replaces it (estates.UPGRADES).
  motte:       { name: "Motte & Bailey", labour: 1800, earthwork: 1500, mat: { timber: 40000 }, hp: 4000, sight: 900, eyeH: 14, garrison: 30, flammable: 0.4, unique: true, footprint: [36, 48] },
  tithe_barn:  { name: "Tithe Barn", labour: 700, mat: { stone: 40000, timber: 14000 }, hp: 1500, stone: true, stores: ["grain", "sheaves", "seed", "hay"], capacity: { grain: 80000 }, staff: 8, flammable: 0.3, footprint: [14, 38] },
  shell_keep:  { name: "Shell Keep", labour: 9000, mat: { stone: 500000, timber: 8000 }, money: 3600, hp: 16000, sight: 1000, eyeH: 20, garrison: 60, stone: true, unique: true, tech: "lime_mortar", techName: "Lime Mortar & Ashlar", footprint: [36, 48] },
  guildhall:   { name: "Guildhall & Tolbooth", labour: 2200, mat: { stone: 50000, timber: 14000 }, money: 1800, hp: 1800, flammable: 0.4, unique: true, footprint: [14, 24] },
  mint:        { name: "Mint", labour: 900, mat: { stone: 30000, timber: 3000, iron: 100 }, money: 2400, hp: 1500, stone: true, staff: 4, unique: true, tech: "royal_mint", techName: "Licence to Coin", footprint: [12, 14] },
  hospital:    { name: "Hospital of St John", labour: 2400, mat: { stone: 70000, timber: 9000 }, money: 1200, hp: 2000, stone: true, footprint: [16, 30] },
  cathedral:   { name: "Minster", labour: 30000, mat: { stone: 1600000, timber: 30000 }, money: 18000, gold: 150, hp: 20000, sight: 1100, eyeH: 40, stone: true, unique: true, tech: "rib_vault", techName: "Rib Vaults & Flying Buttresses", footprint: [32, 66] },
  university:  { name: "College (Studium)", labour: 5000, mat: { stone: 220000, timber: 16000 }, money: 6000, hp: 4000, stone: true, unique: true, tech: "studium", techName: "Studium Generale", footprint: [32, 32] },
  lists:       { name: "Tiltyard & Lists", labour: 500, mat: { timber: 18000 }, money: 2400, hp: 600, flammable: 0.8, unique: true, recruits: ["knights"], tech: "heraldry", techName: "Heralds & the Round Table", footprint: [28, 76] },
  concentric_castle: { name: "Concentric Castle", labour: 45000, mat: { stone: 2400000, timber: 30000 }, money: 24000, hp: 60000, sight: 1300, eyeH: 24, garrison: 200, stone: true, unique: true, stores: ["grain", "seed", "hay"], capacity: { grain: 40000 }, recruits: ["menatarms", "crossbow", "knights"], tech: "concentric", techName: "Concentric Design", footprint: [80, 80] },
  palace:      { name: "Ducal Palace", labour: 16000, mat: { stone: 800000, timber: 24000 }, money: 12000, gold: 100, hp: 10000, pop: 40, stone: true, unique: true, recruits: ["knights", "menatarms"], footprint: [38, 46] },
  field:       { name: "Open Field (plough & sow)", labour: 60, mat: {}, hp: 1 },
  // A timber bridge over a river (js/sim/bridges.js): trestles of squared oak driven into the bed every ~3 m, stringers, a
  // plank deck 5 m wide with a rail — sited where the river is narrowest with firm banks. Per metre of span: ~0.4 m³ of
  // oak (stringers, trestles, deck) ≈ 300 kg, and 6 man-days (driving the piles from a raft, framing, decking) EST — a
  // 20 m bridge is 6 t of timber and ~120 man-days, a crew of 20 a week. It burns (the deck dry, the trestles tarred).
  bridge:      { name: "Timber Bridge", perMetre: true, bridge: true, labour: 6, mat: { timber: 300 }, hp: 60, flammable: 0.6, maxSpan: 40, maxDepth: 4.5, footprint: [6, 6] },
};

// Recruitment (§7, §8). from: which labourer roles can be drafted (in preference order);
// gear: items per man; days: muster/drill time (rushed days for levies); training: mean skill;
// pay: d/day (levy is unpaid at home, 2 d beyond the county — Statute of Winchester).
export const RECRUITS = {
  levy:      { from: ["man", "spear", "archer", "rider"], gear: { spears: 1 }, optGear: { gambeson: 1 }, days: 10, rushedDays: 3, training: 0.22, rushedTraining: 0.12, pay: 0, payAway: 2 },
  spearmen:  { from: ["spear"], gear: { spears: 1, gambeson: 1 }, optGear: { helms: 1 }, days: 3, training: 0.45, pay: 2 },
  pikemen:   { from: ["spear"], gear: { pikes: 1, gambeson: 1 }, optGear: { helms: 1 }, days: 5, training: 0.5, pay: 2 },
  crossbow:  { from: ["man", "spear"], gear: { crossbows: 1, bolts: 20 }, optGear: { gambeson: 1 }, days: 21, rushedDays: 8, training: 0.4, rushedTraining: 0.25, pay: 4 },
  archers:   { from: ["archer"], gear: { bows: 1, arrows: 24 }, days: 2, training: 0.6, pay: 3 },
  menatarms: { from: ["spear"], gear: { swords: 1, mail: 1, helms: 1 }, days: 5, training: 0.6, pay: 12 },
  hobelars:  { from: ["rider"], gear: { horses: 1, spears: 1 }, optGear: { gambeson: 1 }, days: 3, training: 0.45, pay: 6 },
  scouts:    { from: ["rider"], gear: { horses: 1 }, days: 2, training: 0.35, pay: 6 },
  knights:   { from: ["squire"], gear: { destriers: 1, mail: 1, lances: 1, helms: 1 }, days: 3, training: 0.8, pay: 24 },
  // Engines: `perUnit` — gear is per engine and `crew` men are drafted for each (carpenters first: the
  // engineer and his mates; labourers for the pulling ropes, the windlass, the pushing). Days = rigging it and
  // teaching the crew their drill. A trebuchet leaves with its baulks on two carts (returned when it stands).
  trebuchet:   { from: ["carpenter", "man", "spear"], perUnit: true, crew: 16, gear: { trebuchet_gear: 1, timber: 7000, carts: 2 }, days: 1, training: 0.3, pay: 3 },
  mangonel:    { from: ["carpenter", "man", "spear"], perUnit: true, crew: 16, gear: { mangonels: 1 }, days: 1, training: 0.3, pay: 2 },
  springald:   { from: ["carpenter", "man", "spear"], perUnit: true, crew: 4, gear: { springalds: 1, bolts: 40 }, days: 1, training: 0.35, pay: 3 },
  ram:         { from: ["man", "spear", "carpenter"], perUnit: true, crew: 14, gear: { rams: 1 }, days: 1, training: 0.3, pay: 2 },
  siege_tower: { from: ["man", "spear", "carpenter"], perUnit: true, crew: 18, gear: { siege_towers: 1 }, days: 1, training: 0.3, pay: 2 },
  mantlet:     { from: ["man", "spear"], perUnit: true, crew: 2, gear: { mantlets: 1 }, days: 0.5, training: 0.25, pay: 2 },
};
// Wages of war (d/day), paid in full on campaign (> E.homeRadius from the keep). At home, retained
// men draw only their fee and board (EST 25 %): household knights were feed yearly, paid wages of war
// only when arrayed.
export const PAY = { levy: 0, spearmen: 2, pikemen: 2, crossbow: 4, archers: 3, menatarms: 12, hobelars: 6, scouts: 6, knights: 24,
  trebuchet: 3, mangonel: 2, springald: 3, ram: 2, siege_tower: 2, mantlet: 2 }; // engine crews: the master engineer 6–12 d, his carpenters 3–4 d, labourers 2 d (siege-research.md §5)
// Long training, compressed (orchestrator decision: precious, not impossible). A man practising
// full time at the butts becomes a warbow archer after this many econ days (§7: 5–10 years).
// spear: a labourer drilled with the spear in the muster yard until he is one of the vill's trained spearmen ("trained foot",
// §7: months of drill a year over several years — game pace, half the warbow's 40); rider: a labourer who learns to sit, ride
// and handle a horse well enough to fight from it (§7: a hobelar is 6–12 months "if already a rider" — the riding itself is
// years: EST, three-quarters of the warbow's). Both EST, tuned so a house that loses its men can raise them again, slowly.
export const SLOW_TRAINING = { archer: 40, knight: 60, spear: 20, rider: 30 };
// Where each trained role is made (economy.js practice; the crew is set like a workshop's): the building, the role it makes,
// the roles that may train there, and the gear each man needs to hand while he trains (not used up: a spear to drill with,
// a horse to ride — men beyond the store's count wait their turn). The tiltyard (a rider → a squire) is economy.js startSquire.
export const PRACTICE = {
  archery_range: { role: "archer", from: ["man", "spear"], what: "shoot at the butts" },
  barracks: { role: "spear", from: ["man"], gear: "spears", what: "drill with the spear in the muster yard" },
  stables: { role: "rider", from: ["man", "spear"], gear: "horses", what: "learn to ride at the stables" },
};
// apprentices: econ workdays a labourer works beside (or, at half pace, without) a master before he has the trade
export const APPRENTICE_DAYS = { smith: 60, fletcher: 40, weaver: 40, carpenter: 45, mason: 60 };

// Spells (rare low-fantasy mana). Effects are applied by economy.castSpell.
export const SPELLS = {
  bless: { mana: 12, radius: 60, desc: "Steadies men: −0.3 stress in a 60 m circle." },
  mend:  { mana: 20, radius: 30, desc: "Closes wounds: −0.4 wounds on friendly men in 30 m." },
  mist:  { mana: 30, days: 0.5, desc: "Valley mist: all visibility ×0.4 for half a day." },
  quench: { mana: 15, radius: 40, tech: "quench", desc: "Puts out every fire within 40 m (needs the Rite of Quenching)." },
};

// Starting town (1 May). Population ≈ 220 (a manor village: §1 500–600 incl. landless; ours is
// a smaller border vill). Labour ≈ 55 % of population, the rest dependants.
export const START = {
  dependants: 100,
  labour: { woman: 44, man: 26, archer: 14, spear: 16, rider: 6, smith: 3, fletcher: 2, weaver: 4, carpenter: 4, mason: 3, adept: 2 },
  squires: 3,
  retinue: [{ arm: "knights", count: 6 }, { arm: "menatarms", count: 12 }, { arm: "archers", count: 12 }],
  store: {
    grain: 12000, sheaves: 0, seed: 0, fresh: 150, hay: 5000, timber: 45000, boards: 4000, firewood: 8000, charcoal: 1200, stone: 30000, ore: 500,
    iron: 150, wool: 0, cloth: 60, clay: 0, mana: 5, silver: 24000, gold: 200,
    staves: 30, spears: 40, pikes: 0, swords: 12, mail: 2, helms: 10, gambeson: 20, lances: 4, bows: 16, crossbows: 2,
    arrows: 600, bolts: 0, arrowheads: 200, hemp: 0, rope: 60, ladders: 0, horses: 10, destriers: 2, packhorses: 4, carts: 4, oxen: 12,
  },
  sheep: 600,
  houses: 42,
  prebuilt: ["temple", "blacksmith", "weaver", "mill"],
};
