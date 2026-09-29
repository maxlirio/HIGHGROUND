# QA report — full-match playtest (2026-09-27)

Tested the game as it now stands: keep-only start on the town plans, build stages, town economy, the
villagers' reeve, supply convoys, the enemy general, combat, battle clock at real time (BATTLE_RATE = 1).

## How to reproduce everything here

| Tool | What it does |
|---|---|
| `node tools/playtest.mjs --minutes 90 --seeds 1,2,3,4` | Headless full match set up like `js/main.js` (keep-only, `buildPlan`, map hedges/fences/trees/buildings as obstacles), both towns run by AI generals (`--reeve`: team 0 is the idle player's reeve; `--prebuilt`: old start; `--det`: determinism rerun; `--strict`: soft issues fail). **Hard invariants every tick**: stores ≥ 0 and finite, census ledger balanced, no NaN (men, unit anchors, baggage), building progress in [0,1]. **Soft invariants**: unit with a path and no headway for 2 min (`stuck`), >35 % of a village's hands idle for >2 min (`idle`; gardening in a lean season is not idle), building off its plan slot (`offplan`), overlapping footprints (`overlap`). Timeline every 5 min: stage, pop, labour, army, food (t and days), buildings, walls, fields, sites, the field army's distance to the foe / baggage / supply mode / convoys, battles, dead. Ends with *why not* when undecided. |
| `node tools/march-test.mjs [--no-obstacles]` | Orders the retinue from Ashby toward Rookham and reports every unit that stalls, with the going under its feet. |
| `node tools/browser-playtest.mjs` | Drives the real page (headless Chrome, ANGLE/Metal, CDP, real mouse input): build house / field / granary on the plan, recruit levy at the keep, box-select and march, shift-click chain, fortify, burn an enemy building. Collects page exceptions; screenshots in `status/shots/qa/`. |

## Result

**No match reaches a decision in 90 minutes (seeds 1–4, AI v AI, and AI v idle player via
`tools/match-pace.mjs`).** After the fixes below neither town starves (starved 0 / 0 on all seeds, was
24 / ~100), both harvest ~50 t, Red reaches *Stockaded village* by ~75 min. But **no battle is ever
fought**: the armies cannot cross the vale in the time available (see Open issue 1). Red marches at
13.4 min and after 50 min of marching is still 2.7 km from Ashby; Blue marches at ~65 min.

Typical timeline (seed 1, after fixes): 5 min Hamlet, food 17 t / 79 days · 13 min Red marches (59 men)
· 40 min Red reaches Village · 45–55 min lean season, rations kept at 1.00 · ~56 min harvest · 65 min
Blue marches (45 men) · 67 min Red's army turns home 2.7 km short · 75 min Red Stockaded village ·
90 min no decision, 0 battles, 0 dead; 8–10 `stuck` reports per match (all hedge/terrain stalls).

## Bugs found and fixed (economy / convoys / town plan / AI labour — committed)

1. **Workers produced ~30 % of their labour** (economy.js). Only a man standing on his exact spot counted
   as working; spots jumped every 8–26 s (across a 300 m furlong for fields) and at the real-time clock
   the walk between them took longer than the task. Houses took ~40 real minutes. Fixed: within 25 m of
   the spot is at work; each man keeps his own strip/stretch/yard.
2. **Census ledger broke** (hard invariant, seeds 1 and 3): starvation/emigration retired the same
   not-yet-compacted id twice; `retire()` between ticks left dead ids in moving units whose state the
   movement code then rewrote (counted as casualties). Fixed in `retire()` / `killForHunger` / `migration`.
3. **First field laid out had no crop** (townplan.js): `CROP_ROTATION[(fields - 1) % 6]` with 0 fields →
   `undefined` → zero yield. Browser toast showed "Open field laid out: undefined".
4. **Both towns starved in the hungry gap** (economy.js, econ-data.js, ai-general.js labour): 12 t for
   196 people and ~95 days to the first harvest. Keep-only towns now bring provisions sized to reach the
   first harvest (`E.provisionShare`, `E.provisionMarginDays`; 18.4 t); in a lean season the reeve/general
   send hands to fish/game/forage and gardens instead of timber (Blue had 400 t of timber while starving),
   no stockpiling past 2× wants, no drafting pool men off the land while lean unless threatened.
5. **Gate only after the whole palisade circuit** (ai-general placeRing): Stockaded village (and with it
   barracks, smithy, butts, stables) was never reached. Gate now goes up after 3 stretches.
6. **Convoys** (convoys.js): fixed-size loads the army ate long before the next cart; next convoy waited
   for the empty carts to walk home; carters stood for ever 35–120 m from the army; returning carters that
   stopped short never "arrived"; pack-horse convoys took 3 horses and returned 1; undelivered loads lost;
   scouts got convoys; convoys could strip the vill's last bread.

## Open issues — for the owners of those files

### 1. Armies stall for ever at hedges and on bad going — no battle ever happens (combat/movement: `ground.js` going hook, `world.js` moveUnit) — **BLOCKER for a decided match**
Repro: `node tools/march-test.mjs` → men-at-arms stall at (945, 992) after 6 min, archers at the same
spot after 14 min, knights at (1084, 1663) after 12 min; none ever move again.
- `world.moveUnit` moves the anchor at `min(going here, going 3 m ahead)`. `ground.goingHook`
  multiplies the penalty of **every** feature segment within reach, so at the joint of two segments of
  one hedge (Douglas–Peucker vertices — the vale has 3 079 hedge segments) heavy foot get
  0.0375² ≈ 0.0014 → 0.002 m/s. Cavalry at any hedge (`cross.cavalry = Infinity`) get 0.02.
- Without hedges (`--no-obstacles`) knights still stall at (706, 2436): going 3 m ahead is 0.0000 with no
  water and slope 0.05 — a land cell the nav grid thinks passable (cell-centre sample) but `terrainAt`
  forbids to horses.
- Even when moving, foot average ~0.6 m/s (woods, lag clamp), so Ashby→Rookham (3.5 km) is ~60+ min.
Suggested: take the worst single feature, not the product; let a unit whose look-ahead going is < 0.05
for a few seconds step through (men file through the gateways the nav comment assumes) or re-path with
that cell closed; sample the nav grid from the same `terrainAt` the mover uses.
Note: `tools/match-pace.mjs` builds no `w.features`/obstacles, so it does not see the hedge stalls.

### 2. `process` in browser code crashes the sim on the first blow (combat.js:465, uncommitted)
`if (process.env.HG_MB && …)` — `ReferenceError: process is not defined` in the page the first time a
melee blow resolves (browser-playtest "burn" step, a fight at Rookham). Guard with
`typeof process !== "undefined"` or remove before committing.

### 3. The keep cannot be clicked, so the player cannot recruit (render/buildings.js pick or main.js)
Repro: `?shot&banner=0`, click the keep's walls (tried 6–15 m up the tower): the *land* panel opens
("Open woodland …"), never the keep's panel. `blds.pick()` returns nothing for the town_hall. Also the home
villagers' group label sits over the keep (their centroid is the keep), so clicks near its door select
53 villagers instead (`groupNear` runs before the building pick).

### 4. "[object Object] workers sent" (main.js `placeAt`)
`EC.assignWorkers` returns the crew **unit**; the toast does `got?.length ?? got ?? 12`. Use
`got?.members.length ?? 0`.

### 5. Burn / Build / Gather orders don't join or clear command chains (main.js `orderGroup`)
A group with a chain that is ordered to Burn walks to the building; when it arrives `stepDone` is true
and `advanceChains` fires the chain's next step, marching it away before the thatch catches. The early
returns for `burn`, `build`, `gather` should clear (or append to) the group's chain like other orders.

### 6. Box-selecting soldiers by the keep scoops up the villagers (main.js `boxSelect`) — minor
The retinue camps beside the keep, where 50–60 villagers stand; a box round the soldiers takes all of
them, and they then march with the army (away for 3 min). Consider excluding villagers from a box that
contains soldiers (shift to include), as most RTSs do.

### 7. Pacing
Even with the stalls fixed, a real-time march of ~3.5 km at ≤1.3 m/s is 45 min, i.e. 68 economic days of
rations; campaigns before harvest are unaffordable, so first contact comes after minute ~100. Options:
bring the towns closer / start the armies forward, or start the match later in the season.

## Not a bug
- Red's garrison beat off our 30-man raid on Rookham in the browser test: arson needs you to survive the
  defenders. The test now raids the least-guarded enemy building.
- Command friction delays orders several seconds (levy longer); the tests wait for them.
