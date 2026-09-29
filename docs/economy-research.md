# HIGHGROUND — Economy, Recruitment & Logistics (research basis)

Setting: 13th–14th c. England, the Low Countries, the Rhineland and the Scandinavian borderlands. Money is £ s d (12 d = 1 s, 20 s = £1).

**Pre-1348 prices are the default.** After the Black Death (1348–50), wages rise about 50–100 %. A scenario toggle could model this.

Each number carries a citation key `[KEY]` (listed at the end) or is marked **DERIVED** (computed from cited inputs, with the working shown) or **EST** (informed estimate; tune in playtests).

---

## 1. Population & labour

| Quantity | Value | Source |
|---|---|---|
| England population c.1300 | ~4.5–6 M, i.e. 35–45 people/km² | [POP] |
| Household size | 4.5–5 | [POP] |
| Typical manor-village | ~113 tenants, i.e. **500–600 people** including dependants and the landless | [VILLAGE] |
| Standard holding | virgate = 24–32 acres (nominally 30) feeds **5–7 people**. A family needs ≥10 acres to live from its land. 45 % of tenants held <3 acres and worked for others | [VILLAGE] |
| Hide | land for one plough team: 40–120 acres depending on soil | [VILLAGE] |
| Men aged 15/16–60, sworn to arms (Statute of Winchester 1285) | ≈28–30 % of the population (DERIVED from a pyramid with high child mortality) | [WINCHESTER] |
| Working adults (both sexes) | ≈55 % of the population | EST |
| Working days per year | ≈250–270 after Sundays and feasts. Harvest weeks are fully worked | [ACOUP-PEASANT] |

**Recruitment ceilings (DERIVED):**
- Sustained field army: **0.3–1 %** of the population. Edward I raised ~25–30k foot for Falkirk (1298) from ~5 M, and the Crécy army was ~14k [CRECY].
- Local emergency levy (≤2 weeks, defending home ground): **10–20 %** of adult men, i.e. ≈3–6 % of the population.
- Every man taken during ploughing or harvest costs food output (§3). Harvest-time levies should cut the village's yield by roughly that man's share of harvest labour.

---

## 2. Food & water

### 2.1 People
| Consumer | kcal/day | Grain-equivalent | Water | Source |
|---|---|---|---|---|
| Resting or light work (women, children, elderly, avg.) | 2,000–2,400 | 0.6–0.7 kg | 2–3 L | EST |
| Labourer / peasant at work | 3,000–3,500 | 0.9–1.0 kg | 3–4 L | EST |
| **Soldier on campaign** | 3,600 (Engels' basis) to **~5,000** (Edward I garrison ration) | **1.0–1.5 kg** grain + ale | 3–5 L, +1–2 L/h in armour when hot | [ENGELS]; [EDWARD-RATION] |
| Edward I Scottish garrisons | **1 quarter of wheat + 2 quarters of malt per 20 men per week** + meat/fish, i.e. ≈1.45 kg wheat/man/day, ≈5,000 kcal | | | [EDWARD-RATION] |
| Minimum survival water (siege) | Château Gaillard rationed its garrison to **1 pint (0.57 L)** per person/day, a severe level | | | [GAILLARD] |

Energy densities (DERIVED from standard nutrition tables): wheat ≈3,300 kcal/kg; barley ≈3,400; oats (hulled) ≈3,900 (≈2,700 as fed with husk); dried peas/beans ≈3,400; bread ≈2,400 kcal/kg; salt meat ≈2,500; cheese ≈3,500; small ale ≈200–400 kcal/L (≈1 gallon/day per labourer was usual).

**Game ration unit:** `1 ration = 1.2 kg grain-equivalent ≈ 4,000 kcal` = one soldier-day.

### 2.2 Horses and draught animals
| Animal | Grain | Hay/straw or grazing | Water | Source |
|---|---|---|---|---|
| Horse or mule in work, "in good condition" | **4.5 kg (10 lb)** | **4.5 kg (10 lb)** | **30 L (8 gal)** | [ENGELS] |
| On grass alone | 0 | needs **~16 h/day grazing**, and can bear loads only **5–7 days** before rest | 30 L | [ENGELS] |
| Destrier (≥400 kg, 15–16 hands) | 5–6 kg | 6 kg | 35–40 L | [NISKANEN]; EST |
| Ox (draught) | 0–2 kg | 10–12 kg DM | 40 L | EST |

Pasture capacity (EST): a summer sward holds 1–2 t dry matter per hectare, and a horse eats ~10–12 kg DM/day, giving **≈100–150 horse-days per hectare** of good pasture. This sets `forage.graze` in `terrain-types.js`.

---

## 3. Yields and productivity per worker-day

### 3.1 Arable
| Quantity | Value | Source |
|---|---|---|
| Wheat yield | **8–13 bu/acre** (avg 1304–44 on Winchester estates ≈13 bu; poor 6, good 10+). 1 bu wheat ≈27 kg, so ≈540–880 kg/ha | [YIELDS] |
| Seed | wheat/rye 2–3 bu/acre; barley 4; oats, peas, beans 3. Yield/seed ≈3.3–4× | [YIELDS] |
| Rotation | three-field: ⅓ fallow each year | [OPENFIELD] |
| Ploughings | wheat needs **3 ploughings** per crop | [YIELDS] |
| Ploughing rate | ≈1 acre/day per team (1 ploughman + 1 driver + 6–8 oxen) | EST (Walter of Henley tradition) |
| Threshing | **0.24 man-days per bushel**, i.e. ≈4 bu (≈110 kg) threshed per man-day | [CLARK] |
| Reaping + binding + stooking | ≈2–3 man-days per acre | EST from [CLARK] relative inputs |

**DERIVED: labour per acre of wheat** = 3 team-days of ploughing (≈6 man-days + 24 ox-days) + 1 day harrow/sow + 2.5 reaping + 0.24 × 10 bu threshing (2.4) + 1 carting ≈ **13 man-days per acre** (≈32 per ha). The net return is ≈7–10 bu, or 190–270 kg.

That is **≈15–20 kg of grain per man-day of arable labour, averaged over the year**, i.e. one farm worker-day feeds ~15 soldier-days. It is heavily seasonal: nothing arrives before harvest (late July–September).

### 3.2 Other resources (per worker-day of 10 h)
| Activity | Output | Source / basis |
|---|---|---|
| Earth digging (simple tools) | **0.42 m³/h ≈ 4.2 m³/day**; halve it in wet clay | [MOTTE] |
| Felling + trimming a 30–40 cm tree (axe) | 1–2 man-h → one 5–6 m log | EST |
| Hewing a square beam (axe + broadaxe) | 1.5–3 m of 25 × 25 cm beam per hour | EST |
| Pit-sawing (2 sawyers) | 30–60 m of cut per pair-day (planks) | EST |
| Firewood (coppice) | 0.5–1 cord (1.8–3.6 m³ stacked) | EST |
| Charcoal | 5–7 kg wood → 1 kg charcoal; a kiln of ~10 t of wood takes ~1 week and 2 colliers | EST |
| Stone quarrying (building stone) | ≈0.5–1 m³ rough block per quarrier-day | DERIVED from Beaumaris ratio of 375 quarriers to 450 masons [BEAUMARIS] and the laying rates in §5 |
| Lime burning | ~1 t quicklime per 2–3 man-days + ~1 t of wood | EST |
| Bloomery iron | one smelt: **20 kg roasted ore + 30 kg charcoal over 10–12 h** gives ≈3–6 kg of bloom (2–3 workers) | [BLOOMERY]; yield EST |
| Bloom → wrought bar (smith + striker) | ≈5–10 kg bar/day | EST |
| Hay mowing | ≈1 acre/day per mower (≈1–1.5 t hay) | EST |
| Fishing / fowling (fen, river) | 2–5 kg/day | EST |

---

## 4. Transport

| Carrier | Load | Range per day | Notes / source |
|---|---|---|---|
| Soldier (personal kit + 3–4 days of food) | 25–35 kg sustained | 15–25 km | Porters ≈36 kg (80 lb) [ENGELS] |
| Packhorse / mule | **90 kg (200 lb)** | 25–35 km | Needs rest after 5–7 days; eats 9 kg/day, i.e. ~10 % of its load per day if carrying its own feed [ENGELS] |
| One-horse cart | **0.5 t** | **≤30 km** | [CARTS] |
| Two-horse cart | 0.75 t | ≤30 km | [CARTS] |
| One-horse wagon | 0.75 t | ≤30 km | [CARTS] |
| Two-horse wagon | 1.5 t | ≤30 km | [CARTS] |
| Ox cart / wagon (2–4 oxen) | 0.5–0.65 t | **15–20 km** | [CARTS] |
| River barge | 10–30 t | 20–40 km downstream | EST |

**Army march rates:** 15–20 km/day on roads with a baggage train, 8–12 km/day across country, and 30–40 km/day forced for a few days only. A rest day every 4–7 days. Lancaster's 1346 raid averaged only 5–6 km/day overall, including sieges and plundering [CHEVAUCHEE].

**The Engels ceiling (DERIVED):** an army cannot carry much more than **~2 weeks** of its own food, whatever the animal count, because animals eat their own loads [ENGELS]. A column must forage, buy, or be resupplied by water.

---

## 5. Construction

### 5.1 Earthworks and timber (DERIVED unless cited)
| Structure | Labour | Working |
|---|---|---|
| **Motte** 40 m base × 5 m high | **2,100 man-days** (50 men × 42 days × 10 h) | [MOTTE] |
| Medium motte, 10 m high | **12,500 man-days** | [MOTTE] |
| Largest mottes (Thetford) | **≈24,000 man-days**; the smallest ≈1,000 | [MOTTE] |
| Ditch 3 m wide × 2 m deep (V) + bank | ≈3 m³/m of earth at ~3 m³ per man-day with the throw-up ⇒ **≈1 man-day per metre** | [MOTTE] rate |
| **Timber palisade**, 25 cm posts, 4 per m, 4.5 m long, 1 m buried | fell/trim/point 4 × 0.8 h + trench 0.6 m³ (1.5 h) + set/ram 1 h ≈ **0.6 man-days/m** (plus hauling beyond ~200 m: +0.05 man-days/m per extra km) | EST from felling and digging rates |
| Palisade + fighting walkway + ditch & bank | **≈2 man-days/m** | sum |
| Timber tower on a motte (6 × 6 m, 3 storeys) | 300–600 man-days | EST |
| Gatehouse (timber) | 150–300 man-days | EST |
| Archers' stakes (1.8 m, sharpened) | 5–10 min each, i.e. ~60–100 per man-day. Archers carry their own and re-plant them in minutes (Agincourt) | [AGIN]; EST |

### 5.2 Buildings (EST, cross-checked with cost)
| Building | Man-days | Notes |
|---|---|---|
| Peasant cruck house 5 × 8 m (timber, wattle & daub, thatch) | **100–150** (timber 20–30, carpentry 30–50, walls ~70 m² at 2–3 m²/day ≈30, thatch ~70 m² ≈20) | Crucks "built in days or weeks" [CRUCK]. Chosen to be consistent with typical 14th-c. peasant house costs of a few pounds at 1½–3 d/day |
| Longhouse / hall 6 × 15 m | 250–400 | |
| Barn (aisled, 10 × 25 m) | 600–1,000 | |
| Watermill (timber, with wheel and gearing) | 800–1,500 + millstones | |
| Parish church (stone, small) | 20,000–50,000 | |

### 5.3 Stone
- **Harlech (1283–89, ≈£8,190):** at the 1286 peak, **546 labourers, 115 quarriers, 30 smiths, 22 carpenters, 227 masons** ≈ 940 workers costing **≈£240/month** [HARLECH]. £240 = 57,600 d a month, which at 26 working days ≈ 2.4 d per worker-day on average.
- **Beaumaris (from 1295):** **1,800 workers** on average in the first summer (450 masons, 375 quarriers), peaking at **3,500**. Wages cost **≈£270/week**. £15,000 had been spent by c.1330 and it was never finished [BEAUMARIS].

**DERIVED: labour per m³ of finished royal-standard masonry.** Harlech's cost converts to ~0.6–0.9 M worker-days (after allowing for bought materials and carriage). The estimated masonry volume is ~20,000 m³ (inner curtain ~200 m × 12 m × 2.7 m, four towers and a massive gatehouse, plus outer walls). That gives **≈30–40 worker-days per m³ all-in** (quarrying, lime, sand, carriage, scaffolds, smithing, laying).

| Stone work | Labour |
|---|---|
| Direct laying (mason + 2 labourers) | 0.5–1 m³ per mason-day |
| Plain rubble town wall, 6 m high × 1.5 m thick (9 m³/m), local stone | 10–15 worker-days/m³, i.e. **≈90–140 worker-days per metre** |
| Royal curtain wall, 8–12 m × 2.5–3 m (20–35 m³/m) | 30–40 worker-days/m³, i.e. **≈600–1,400 worker-days per metre** |
| Stone keep, 20 × 20 × 25 m (walls 3–4 m) | ~6,000–8,000 m³, i.e. **≈200,000–300,000 worker-days** |
| Time limit | Mortar must cure, so masonry courses rose only ~3–4 m per season. **A stone castle takes ≥3–7 seasons regardless of manpower** (Harlech 6 years, Beaumaris never finished) |

---

## 6. Equipment production

Times are working hours of the named craftsman (EST unless cited). Division of labour, with specialised wire-drawers, shaft-makers and grinders, is assumed for army-scale production.

| Item | Labour | Material | Notes |
|---|---|---|---|
| **War arrow** (shaft + 3 goose feathers + nock + head) | shaft ~15–20 min + fletching ~10 min, i.e. **≈16–24 arrows per fletcher-day** | ~50 g aspen/ash/poplar | Estimates range 12–100/day [FLETCH]. The Crown bought **1.23 M arrows (51,350 sheaves) in 1341–59** [LONGBOW] |
| Arrowhead (bodkin) | 3–6 min smith + striker ⇒ **≈100–150/day** | 10–15 g iron | EST |
| Crossbow bolt | ~20 min + head | | EST |
| Longbow from a *seasoned* stave | ≈6–10 h, i.e. **~1 bow per bowyer-day** | yew stave; **staves season 1–3 years** | EST |
| Crossbow, composite (13th c.) | 5–10 working days + weeks of glue curing | horn, sinew, wood | EST |
| Crossbow, steel prod + windlass (late 14th c.) | 3–5 days + lock | | EST |
| Spear | head 2–4 h + shaft 2 h ⇒ **~0.5 day** | 0.3–0.5 kg iron, ash shaft | EST |
| Arming sword | forge 20–40 h + grind/harden 10–20 h + hilt 5–10 h ⇒ **4–7 days** | 1.5–2 kg steel/iron | EST |
| Axe / mace / falchion | 1–3 days | | EST |
| **Mail hauberk** (long sleeves, 25,000–30,000 rings) | modern hobbyist ≈2 min/ring ≈ **1,000 h**. Medieval half-riveted, half-punched-solid with drawn wire: **≈300–500 h** (game default 400 h = 40 days) | 8–10 kg iron | [MAIL] |
| Gambeson / aketon (16–26 layers) | 60–120 h sewing + cloth (linen weaving is itself days per ell) | | EST |
| Kettle hat / cervellière | 1–2 days | | EST |
| Great helm / bascinet | 3–5 days | | EST |
| Coat of plates | 8–15 days | | EST |
| Full plate harness (late 14th c.) | 60–120 workshop days | 15–25 kg steel | EST |
| Heater shield | 1–2 days | planks, rawhide, gesso | EST |
| Pavise | 1–2 days | | EST |
| Destrier | **3–5 years of breeding and training** | | EST |

Iron budget example (DERIVED): a mail shirt needs ~8–10 kg finished iron, i.e. ~15–25 kg of bloom, i.e. ~5 smelts and ~150 kg charcoal (≈1 t of wood).

---

## 7. Training

| Tier | Time to field-ready | Game effect | Basis |
|---|---|---|---|
| **Levy** (spear, club, bow at home) | 1–2 weeks of drill to march and hold a line | skill 0.1–0.3, discipline 0.2–0.35, nerve 0.3 | Statute of Winchester obligation, arms by wealth class [WINCHESTER] |
| **Crossbowman** | 3–6 weeks | aimed shooter immediately, skill 0.4 | EST |
| **Trained foot** (retained, paid companies) | 3–6 months | skill 0.35–0.6, discipline 0.5–0.7 | EST |
| **Warbow archer** | **5–10 years from youth**. The draw weight requires bone and muscle development; the Mary Rose archers show skeletal asymmetry. Edward III's 1363 proclamation ordered every able man to practise on feast days | skill 0.5–0.9 at 130–160 lbf | [LONGBOW]; [WINCHESTER] |
| **Man-at-arms / knight** | 10–14 years (page at ~7, squire at ~14, dubbed ~21) + a horse | skill 0.6–0.9, nerve 0.6–0.8 | EST |
| **Hobelar / light horse** | 6–12 months if already a rider | | EST |

**Game proposal:** a trained or elite *pool* is a demographic stock the player inherits and must preserve. The only thing a match can create from scratch is levies. Archers need an "archery tradition" building (butts) that raises the future pool slowly.

---

## 8. Wages & values

| Rank | Pay per day | Source |
|---|---|---|
| Earl | 6 s 8 d | [PAY] |
| Banneret | 4 s | [PAY] |
| Knight | 2 s | [PAY] |
| Man-at-arms / esquire | 12 d | [PAY] |
| Mounted archer (1340s) | 6 d | [PAY] |
| Foot archer (Edward I, Welsh wars) | 3 d | [PAY] |
| Crossbowman (Edward I) | 4 d | [PAY] |
| Foot soldier / spearman | 2 d | [PAY] |
| Master James of St George (master mason) | 3 s | [BEAUMARIS] |
| Harlech workforce average | ≈2.4 d/worker-day | DERIVED §5.3 |
| Unskilled labourer (pre-1348) | 1–2 d | EST |
| Skilled carpenter / mason | 3–4 d | EST |

Approximate prices c.1300, for relative balance:

| Item | Price |
|---|---|
| Wheat | 5–7 s per quarter (8 bu) normally; 3–4× in the 1315–17 famine |
| Ox | ~12–15 s |
| Sheep | ~1–1.5 s |
| Cart horse | ~10–20 s |
| **Warhorse** | £10–£60+ (destriers valued in the Crown's restauro records often £20–£60) |
| Longbow | ~1–1.5 s |
| Sheaf of arrows | ~1–1.5 s |
| Mail hauberk | ~£1–£5 by quality |

These are EST from the standard price series. Only their ratios should matter in-game.

**Army cost check (DERIVED):** 1,000 foot archers at 3 d/day = 3,000 d = **£12.5 per day**. Beaumaris' £270/week ≈ £38.6/day was the cost of ~3 such companies.

---

## 9. Sieges & starvation

| Case | Duration | End | Source |
|---|---|---|---|
| Château Gaillard 1203–04 | ~6 months | Water rationed to 1 pint/day; stormed | [GAILLARD] |
| Rochester 1215 | ~7 weeks | Mined with pig fat, starved | [SIEGES] |
| Kenilworth 1266 | **172 days** | Surrendered when food ran out | [KENILWORTH] |
| Calais 1346–47 | **11 months** | Starved into surrender | [CALAIS] |

Physiology of starvation (EST from standard clinical data):

| Condition | Effect |
|---|---|
| ≈50 % ration | ~1 kg/week weight loss. After 3 weeks, CP −15 % and nerve −0.05. After 6–8 weeks, CP −30 % and disease risk ×2 |
| Zero food | death in ~6–10 weeks |
| Zero water | death in 3–5 days |
| <1 L water/day under exertion | incapacity within days |

**Besiegers starve and sicken too.** Their camp must be fed over a ~15–30 km foraging radius (DERIVED from §4 cart ranges). Camp dysentery risk rises with duration and density: e.g. P(daily case) = 0.002 per man after 3 weeks, doubling in summer heat. It killed a large part of Henry V's army at Harfleur in 1415.

**Siege arithmetic (DERIVED):** a 60-man garrison needs 3 quarters of wheat and 6 of malt per week (Edward I ratio). A 6-month hold therefore needs ~80 quarters of wheat (~16 t) plus ~160 quarters of malt, plus water: a well or a cistern of ≥60 × 3 L × 180 days ≈ 32 m³.

---

## 10. Game-time compression proposal

The problem: a real campaign season (~120 days) must fit into a 60–90 min match, while a battle has minute-scale structure (25 s flurries, 2–3 min lulls, 6 arrows/min) that must stay readable. No single factor preserves both. So we use **two clocks** and keep every ratio *within* each domain exact.

### Tactical clock (combat, movement, fatigue, missiles, morale): **k_T = 4** (1 real s = 4 game s)
| Real-world value | On screen |
|---|---|
| Flurry 25 s | 6 real s |
| Lull 2.5 min | 37 real s |
| Warbow 6/min | 1 arrow every 2.5 real s |
| Walking pace 1.4 m/s | 5.6 m/s |
| A 1-hour line fight | 15 real min. Most match fights will be smaller detachment actions (5–30 game-min, i.e. 1–8 real min) |

Everything physiological (W′, glycogen, heat, bleeding, drinking) runs on this clock, so fatigue-to-flurry and bleed-to-death ratios stay real.

### Economic clock (labour, construction, production, growth, rations, starvation, training): **1 real minute = 1.5 economic days**
A 75-min match ≈ **112 economic days ≈ one campaign season**, spring sowing to harvest. Relative to the tactical clock this is a ×540 compression (1 real s = 36 econ-min, against 4 tactical s).

Labour quantities stay in man-days. A task of D man-days done by W workers takes `D / W` econ-days = `D / (1.5·W)` real minutes. With **one worker dot = one labourer (no abstraction)**:

| Task | Crew | Real time |
|---|---|---|
| Cruck house, 120 man-days | 10 workers | 8 real min |
| Palisade, 100 m × 2 man-days/m | 50 workers | 2.7 real min |
| Small motte, 2,100 man-days | 100 workers | 14 real min |
| Stone town wall, 100 m × 110 worker-days/m = 11,000 | 200 workers | 37 real min (and mortar seasons, below) |
| Stone keep, 250,000 worker-days | any crew | impossible in one match. **Correct**: keeps are inherited map features or multi-match campaign builds |

Masonry's seasonal limit of ~3–4 m of height per season maps to **max 3 m of wall height per match**.

Other derived timings:

| Process | Real time |
|---|---|
| Soldier eats 1 ration per econ-day | 1 ration per 40 real s |
| A 10-day wagon convoy | 6.7 real min |
| A starving garrison with 30 days' food | falls in ~20 real min, so sieges of *small* stores resolve in-match. Kenilworth-scale stores (180 days) cannot, and siege play then favours assault, mining and treachery (historically accurate choices) |
| Levy drill (1–2 weeks) | 5–9 real min |
| Crossbowman (3–6 weeks) | 14–28 real min |
| Trained foot (3–6 months) | longer than a match, so a starting pool |
| Warbow and knight | only from the starting pool, in any match |

**Crossover rule:** units in combat use tactical time for everything they do. Rations are debited on the economic clock regardless, so an army standing around for "days" (40 real s each) really does eat its train. Wounds heal on the economic clock: light 3–7 econ-days, serious 3–6 weeks, mortal never.

---

## 11. Sources

- **[POP]** England c.1300 population/density (Campbell; Broadberry et al.): https://epc2022.eaps.nl/uploads/210550
- **[VILLAGE]** 13th-century peasant holdings (virgate, Elton): https://thehistoryofengland.co.uk/blog/2012/08/05/67-13th-century-life-the-peasantry/ and https://en.wikipedia.org/wiki/Virgate
- **[WINCHESTER]** Statute of Winchester 1285; Edward III 1363 archery proclamation: https://en.wikipedia.org/wiki/Statute_of_Winchester and https://warhistory.org/article/what-drove-the-rise-of-the-english-longbowman
- **[ACOUP-PEASANT]** Devereaux, "Life, Work, Death and the Peasant IVb: Working Days": https://acoup.blog/2025/09/05/collections-life-work-death-and-the-peasant-part-ivb-working-days/
- **[ENGELS]** D. Engels, *Alexander the Great and the Logistics of the Macedonian Army* (1978): https://archive.org/details/alexander-the-great-and-the-logistics-of-the-macedonian-army and https://legioilynx.com/2012/02/09/horses-camels-elephants-oh-my/
- **[EDWARD-RATION]** Edward I garrison victualling: https://bluebellstrilogy.blogspot.com/2016/05/eating-medieval-armies-on-march.html and http://neutralhistory.com/the-diet-of-medieval-soldiers-what-did-soldiers-eat-in-the-middle-ages/
- **[YIELDS]** Medieval yields and seed rates: https://ibiblio.org/london/agriculture/general/1/msg00070.html and the BAHS crop-yields database: https://www.bahs.org.uk/crop-yields-database/the-data/
- **[CLARK]** G. Clark, "Yields per acre in English agriculture 1250–1860: evidence from labour inputs": https://www.researchgate.net/publication/228043115
- **[OPENFIELD]** https://en.wikipedia.org/wiki/Open-field_system
- **[MOTTE]** Motte labour estimates: https://en.wikipedia.org/wiki/Motte-and-bailey_castle and https://htt.herefordshire.gov.uk/herefordshires-past/the-medieval-period/castles/building-a-castle/how-long-did-it-take/
- **[HARLECH]** https://en.wikipedia.org/wiki/Harlech_Castle
- **[BEAUMARIS]** https://en.wikipedia.org/wiki/Beaumaris_Castle and https://www.worldhistory.org/Beaumaris_Castle/
- **[CRUCK]** https://www.buildinghistory.org/style/vernacular.shtml and https://wccmedievalhistory.wordpress.com/2014/05/31/cruck-houses/
- **[BLOOMERY]** EXARC bloomery smelting experiments: https://exarc.net/issue-2014-2/at/soil-iron-product-technology-medieval-iron-smelting and https://en.wikipedia.org/wiki/Bloomery
- **[CARTS]** Medieval cart/wagon capacities and speeds: http://neutralhistory.com/the-logistics-of-medieval-warfare/
- **[CHEVAUCHEE]** https://en.wikipedia.org/wiki/Lancaster%27s_chevauch%C3%A9e_of_1346
- **[CRECY]** https://en.wikipedia.org/wiki/Cr%C3%A9cy_campaign
- **[AGIN]** https://en.wikipedia.org/wiki/Battle_of_Agincourt
- **[FLETCH]** https://www.medievalchronicles.com/medieval-people/medieval-tradesmen-and-merchants/medieval-fletcher-arrow-maker/
- **[LONGBOW]** https://en.wikipedia.org/wiki/English_longbow
- **[MAIL]** https://www.ironskin.com/faq-chainmail-weight-and-cost/
- **[PAY]** Edward I/III wage scales: http://neutralhistory.com/the-pay-of-medieval-soldiers/ and https://www.themcs.org/money.htm
- **[NISKANEN]** Medieval horse size: https://www.researchgate.net/publication/370765331
- **[GAILLARD]** https://en.wikipedia.org/wiki/Siege_of_Ch%C3%A2teau_Gaillard
- **[KENILWORTH]** https://en.wikipedia.org/wiki/Siege_of_Kenilworth
- **[CALAIS]** https://en.wikipedia.org/wiki/Siege_of_Calais_(1346%E2%80%931347)
- **[SIEGES]** https://www.english-heritage.org.uk/learn/story-of-england/medieval/siege-warfare/
