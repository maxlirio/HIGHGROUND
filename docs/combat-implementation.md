# HIGHGROUND — Combat implementation notes

This is the engineering companion to `docs/combat-research.md` (the spec). It lists what is built, where,
how it maps onto each spec section, what the calibration harness measures, and what is still weak.

Everything in the combat model is resolved **per soldier**. No unit rolls dice for its men; units only group
men, hold orders and formation slots, and aggregate what their men do (stress, losses, contact).

## 1. Architecture

| Module | Role |
|---|---|
| `js/sim/clock.js` | `BATTLE_RATE = 1`: the tactical clock runs in real time (men walk at a believable pace on screen). `TICK` (0.1 real s) and `PERC` (ticks between a man's perception passes = `PERCEIVE_S` 2 battle-s, 20 ticks) live here, so every per-pass rule keeps its battle-time meaning at any clock rate. |
| `js/sim/world.js` | Fixed tick (`TICK` = 0.1 real s, `DT` = 0.1 battle-s). Typed-array spatial hash, formation slots with file-preserving refill (rear ranks step into the fallen's places), proportional formation catch-up, Pandolf locomotion power per man, command-friction hook in `issueOrder`, contact hold (combat owns the anchor of a body locked in a fight). API unchanged. |
| `js/sim/soldiers.js` | Struct-of-arrays: body (mass, strength, CP, W′, glycogen, blood), mind (skill, nerve, discipline, aggression class), kit (per-zone armour mask, weapon, side-arm, shield, horse, ammunition), state (posture, status, wounds, bleeding, timers), legend tallies. Population bands per §1. |
| `js/sim/kit.js` | §2–§4, §9 data: body zones and hit weights, damage modes, armour materials (thresholds per mode, blunt transmission), plate formula, weapons (§3 table), shields, missiles (§9.1), troop kits with optional pieces sampled per man. |
| `js/sim/arms.js` | Troop types → band, kit, weapon mix, shields, missile, horse; formations. |
| `js/sim/wounds.js` | Hit location with all §2 modifiers (shield deflection to head/shins, downed ×3 head, mounted target, plunging arrows), skilled aim at weak zones, layered penetration with gaps, incidence angle and glancing, wound severity by zone/mode/depth (§4.2–4.3), bleeding with clotting. |
| `js/sim/melee.js` | `resolveBlow`: the one exchange resolver used by line fights, flank attacks, pursuit, coups de grâce, lance impacts and the duel fast-path. Defence roll (§7.2 formula + stance, zone, flank/rear, multiple attackers, fatigue, slips), blow energy (§3 × strength × W′ × commitment), shield block, armour, wound, grappling/knock-downs, footing. `applyWound` / `fell` produce the events. |
| `js/sim/physio.js` | §6: Pandolf with the terrain factor and armour limb loading, CP/W′-balance (Skiba τ), glycogen, heat, the closed-helm VO₂ cap, speed-at-power inversion (§12 speeds), bleeding, horse wind (gallop spends, canter can be held). |
| `js/sim/combat.js` | The system: staggered perception (each man every 2 battle-s = `PERC` ticks), 10 m contact sectors per unit pair running the §8 flurry/lull machine from surge pressure Π, melee tick, contact probe for advancing bodies, anchor surge/push-back, front-rank rotation, pursuit and hunting, looting, the downed (bleeding, dragged back, finished off by men sweeping the field), crowd crush, standing orders, physiology integration, events. |
| `js/sim/morale.js` | §11–§12: per-man stress inputs, status ladder, break trigger, contagion, unit break and re-forming, rally, surrender and quarter, flight (sprint/jog, dropped shields and helmets, jams, panic falls, drowning at fords/rivers). |
| `js/sim/cavalry.js` | §10: approach/charge/melee/recoil/rest cycle (repeated charges), refusal rule (solidity² of the body the horse runs at, terrain and obstacles, fallen horses), impact physics (couched lance, braced spear on the horse, knock-down), cavalry-vs-cavalry decided before contact, riders milling outside a steady hedge. |
| `js/sim/ballistics.js` | §9: point-mass flights with quadratic drag tabulated per missile and height difference (lowest trajectory), area vs aimed dispersion, wind drift, flight time, impact resolved against the men actually under the falling shaft (plan footprint + silhouette at the impact angle), shields, pavises, cover, ammunition, burst/sustained rates with W′ cost, arrow recovery, missile stress. |
| `js/sim/command.js` | §13: orders by voice / horn / mounted messenger, mishearing, garbling, messengers taken, unit reaction delay, disengagement stress. |
| `js/sim/feats.js`, `feat-ref.js` | §15: tail-probability feat detection against a measured reference distribution; tiers notable/heroic/legendary/mythic; `legend.js` builds sagas from feats. |
| `js/sim/duel.js` | §17.3 fast path: cloneable duel state machine on the same resolution functions; odds by multilevel splitting. |
| `js/sim/ground.js` | Terrain as the combat model reads it: `terrainAt` (land reader) fields, placed features (queried through the features index), weather, bodies on the ground. |
| `js/sim/features.js` | `w.features` as a system: fences and hedgerows derived from the map files (`featuresFromMapData`), palisade/stone-wall stretches from `w.buildings` (timber_palisade + outer ditch / town_wall once half built, gone when ruined), field works dug or planted by a unit (`fieldWork`: stakes, pits, ditch), a 40 m grid index for queries, and the nav grid (a class that cannot cross a solid barrier finds its cells closed; hedges, ditches and fences are dearer so columns seek gaps). |
| `js/sim/commander-ai.js` | The battle AI: draws the army up as a line (foot side by side in their present order, bows on the wings, horse behind them, small companies and levies in a second line that plugs gaps), advances it in bounds squared up on the enemy, halts out of bowshot while its archers go forward, then every company goes in straight at whatever stands before it; horse kept back for a counter-charge, a wavering enemy or a long-locked flank. |

The tick order inside `combatSystem` is: coarse occupancy grids → command deliveries → perception bucket →
(every `PERC`-th tick, i.e. every 2 battle-s) sectors, units, the downed → per-unit cavalry/missile logic → melee → charges → arrow
impacts → fugitives/looters → physiology (half the men per tick over 2·DT) → witnesses → feats.
Processing order alternates each tick so no side strikes first (mirror tests below).

## 2. Spec mapping

| § | Status | Notes |
|---|---|---|
| 0 Scales | done | Tactical clock real time (1×); DT 0.1 s; perception/sector/unit cadence 2 battle-s; exchanges, flurries 10–60 s (measured ~20–25 s), lulls 1–5 min (measured ~3–4 min). |
| 1 Attributes | done | All of §1.1–1.4 per man. Experience/bond: bond = same unit (messmate stress ×2); experience not yet accumulated across battles. Ransom value by arm. |
| 2 Hit location | done | Table + all modifiers; skill steers blows to weak zones (DESIGN aimBias); face/neck/hands hard to aim at; heads bowed under plunging fire (DESIGN). |
| 3 Weapons | done | All weapons in the table, first-strike for long weapons, inside-1 m bonus for short ones, hooks, pikes present 4 ranks, lance capped by shaft (200–600 J), daggers at the downed. DESIGN: blow *commitment* (fighters commit 45 % of blows, cautious 8 %) — Sabin's "¾ fight to stay alive". |
| 4 Armour | done | Material table, plate formula, layers, gaps (×4 for a dagger on a downed man), incidence cos², glancing 45°–70° (×1.6 spread on round skulls/helms), residual → depth → severity, blunt transmission. |
| 5 Frontage | done | Striking by reach (+0.5 m lunge) so second-rank spears and four ranks of pikes strike; ≤3 strikers per man (the 4th picks another); rear ranks give morale, replace the fallen (file refill), rotate blown front-rankers in lulls (discipline ≥ 0.5); crowd crush and asphyxia in presses. |
| 6 Fatigue | done | Pandolf η from the land reader, armour limb mass, closed-helm cap, W′ balance, glycogen; low-W′ effects on blows/parry/attacking. Heat/hunger hooks (`w.weather`, `w.hunger`). DESIGN: Pandolf metabolic × 0.22 → CP-model power (walking 85 W, jog ≈ CP, sprint ≈ 950 W). |
| 7 Melee | done | Exactly the §7 pipeline; lethality calibrated through the line-fight bands (see §3). |
| 8 Pulse/lull | done | Sectors = (unit pair, 10 m bucket along the front); Π per side from aggression weights × (1−stress) × W′ + leader + war-cry/urging + enemy wavering − recent losses; surge hazard above 0.45; flurry ends at W′ < 30 % or >2 down in 10 s; loser gives 1–3 m; lines lean in during flurries and step back to the safety distance in lulls; wounded dragged back in lulls. |
| 9 Missiles | done | Ballistic tables, dispersion, wind, silhouettes, shields, pavises, cover, ammo (60–72), recovery, burst/sustained, missile stress. |
| 10 Cavalry | done | Charge schedule, refusal rule, obstacles (pits/stakes/ditches), fallen-horse heaps, impact physics, repeated charges, cav-vs-cav. |
| 11 Morale | done | Every input of §11.2 (flank/rear judged in the body's frame; schiltrons have none), break trigger §11.3, unit break, contagion, rally and re-forming around those who stood, surrender and quarter (`w.noPrisoners`). DESIGN additions: unit baseline stress (losses ×3, +0.015 per pulse endured, +0.00006/s in contact, fades out of contact), flurry fear, approach shock (Π gap). |
| 12 Rout | done | §12 speeds, dropped shields/helmets, jams, panic falls, pursuit with loot hazard 0.02/s·(1−disc), horse hunting knots of fugitives, riders knocking men down, massacre of the downed by men sweeping the field (P 0.5), looters finishing the wounded, drowning (FEATURES.ford bands × fleeing ×5 × armour), bottlenecks. |
| 13 Command | done | Channels, latency, garble, messenger interception, reaction delays, disengage stress; standing orders (archers join the melee when out of shafts; knifemen go out to unhorsed riders and wounded enemies lying unguarded within 80 m). The commander AI fights as a line (see §1). |
| 14 Fog of war | partial | Vision grid (`vision.js`) is the renderer/AI's; the combat model uses visibility for contagion radius and weather. Numbers-estimation error not wired into AI. |
| 15 Feats | done | Reference distribution measured from AI battles (`tools/feat-ref.mjs`). |
| 16 Environment | done | Reads the land reader (`terrainAt`): going, fatigue η, footing (slip/fall), chargeViable, cohesion, cover; placed FEATURES from the map, the economy's walls and field works (features.js); rain through `readLand(map, { rain })`; ELEVATION (melee height skill, uphill charge penalty, missile range/energy through the trajectory); WEATHER (visibility, dispersion, bowstrings, stress, garble). |
| 17 Calibration | see §3 | `tools/battle-mc.mjs`. |

## 3. Calibration results

`node tools/battle-mc.mjs --seeds 48` (5-8 min on 10 cores), 2026-09-27 evening, **real-time clock, momentum,
ride-through, formation-keeping, volleys**: **42 PASS, 0 FAIL.** The historical scenarios run 8 seeds each (±30 %
between runs); 'trapped' and 'shock' now run 48 (their medians sit near a band edge). Deterministic.

| Band | Target | Achieved | |
|---|---|---|---|
| Mirror fight: south side loses / team 0 loses | 50 % ± 2σ | 50.0 % / 58.3 % | PASS |
| Victor fatalities; loser (foot pursuit / fresh cavalry / trapped) | 1–5 %; 8–20 / 30–80 / 30–80 % | 2.5 %; 12.7 / 33.8 / 77.5 % | PASS |
| Deaths after the break; losses at the break | 60–90 %; 5–15 % | 64.6 %; 5.4 % | PASS |
| Line-fight duration; contact fraction | 30–180 min; 10–30 % | 41 min; 12.9 % | PASS |
| Flurry / lull | 10–60 s / 60–300 s (mean ≈ 2.5 min) | 23 s / 160 s | PASS |
| First shock: morale gap / equal veterans | 30–50 % / <10 % | 35.4 % / 0 % | PASS |
| Crécy: ratio / charges | ≥10 / ≥10 | 34.5 / 13.5 | PASS |
| Agincourt: ratio / pile-ups / archers join | ≥6 / ≥50 % / ≥50 % | 15.1 / 100 % / 100 % | PASS |
| Courtrai: knights killed / horses stopped | 30–90 % / ≥30 % | 39 % / 100 % | PASS |
| Stirling: bridgehead / far bank reinforces | ≥60 % / ≤10 % | 91.5 % / 2.7 % | PASS |
| Bannockburn: charges fail / English rout losses | ≥80 % / ≥40 % | 100 % / 56.5 % | PASS |
| Pike vs frontal horse; horse vs disordered foot | as spec | 0 % / 0 %; 100 % | PASS |
| P(1 beats N), N = 1, 2, 3, 5, 7, 10, 20 | spec bands | 0.51, 0.20, 0.030, 3.5e-3, 4.6e-4, 1.6e-4, 3.3e-5 | PASS (all) |
| MAA vs 1 levy / vs 3 levies | 85–95 % / 30–50 % | 92.5 % / 36.3 % | PASS |
| All five §17.4 missile benchmarks | spec bands | 7.5 %, 25.6 %, 0.9 %, 10.8 %, 100 % | PASS |

The second shift's additions (each in its own commit, reasons in the messages):
* **Momentum** (`combat.footShock`): a foot body arriving faster than a walk hits — the struck front staggers back up
  to 6 m, front-rankers knocked down (both front ranks when it bursts a thin/shaken line), fear through the body,
  the attacker follows through. The loser of each pulse gives 1–3 m × (1 + 2 × how much harder the other pressed)
  and the winner follows (unless holding). §8 surge threshold 0.45 → 0.42 (lulls 160 s, research mean ≈ 150 s).
* **Cavalry shock** (`cavalry.penetrable / rideThrough`): horses ride into and through loose, shallow, shaken,
  moving or missile bodies and other horse (trampling), re-form 90 m beyond and charge again; riders steer at men,
  not gaps; riders thrown into ditches are hurt (`ditchFall`); fright escalates flinch → balk → bolt, and a bolting
  horse gallops through its own ranks (`cavalry.bolting`).
* **Arrows thin, they do not rout harness**: armoured men walking into the shafts bow their heads (face hits as under
  plunging fire), arrow stress × armour calm × 0.6 when advancing, an arrow casualty weighs 0.3 of a man cut down,
  contagion × (1 − 0.5 discipline). Flank fire squeezes a formation toward its middle (Dupplin).
* **Formations fight as formations**: a man whose place in the ranks is beyond striking distance keeps it (a wedge
  stays a wedge, best men at its point; a ring a ring); shield-bash close in; a blown man's guard sags (head hits).
* **Volleys** (`ballistics.setFireMode`): volley at a body or ground / loose at will / hold fire, from the order popup.
* **Stones** throw men beside their path; a captain's fall spreads as news at 3 m/s and a raised banner steadies;
  foot does not chase formed horse beyond 150 m; horse is led out of bog.
* **Signals** for the figures and the sound (docs/anim-sim-signals.md): blow, arrow, knock, shove, bash, lance, horse
  flinch/balk/bolt, stoned/thrown, volley, shock, decisive-moment (ridden-through, line-burst, captain-falls, crush).
* **Battle AI**: no stand-offs — bows close to their own range, a Hotspur goes straight in, a defender left alone goes
  out after 6 min, the commander rides with his army (`tools/battle-mode.mjs`: Red Hotspur vs a passive Blue meets
  at ~6 min, decided at 12–17). March: hedges crossable, no frozen columns (`tools/march-test.mjs`).

What changed with the real-time clock (second shift): everything keyed to ticks was moved onto battle
seconds (perception cadence `PERC`, melee separation, idle fidgets, Crécy's re-charge orders); the first-shock
approach term was re-tuned (0.08 → 0.064). Then the three historical failures were closed physically:
* **Crécy** (3:1 → 17:1): a lance used in the mêlée is a heavy spear (100 J), not the couched charge (400 J) —
  riders who refused had been stabbing men at 4 m for 400 J; pits are met where they lie (`obstacleAhead`).
* **Bannockburn** (1.7 % → 57 %): pikemen keep their ranks against horse instead of stepping out to a sword's
  length; a side whose weapons reach and whose foe's do not may surge alone (one-sided flurry), so the
  schiltrons press the English foot into the burns; a horse ridden flat out through belly-deep water founders.
* **Courtrai** (28 % → 32 %): ditches are met where they lie (refuse / fall / shoved in by the rank behind,
  `CAV.pressedIn`), fleeing horses founder in the brook, and foot run down the unhorsed and the mired
  (`combat.hunt`, 50 m).

**Performance** (`node tools/perf.mjs`): 3,000 men, ~2,400 in melee at peak: 1.5–1.65 ms/tick CPU (budget 6 ms). At
the real-time clock a man perceives every 20 ticks instead of every 5, so the per-tick cost fell; a battle
second now costs 10 ticks.

**AI battles** (`node tools/ai-duel.mjs`, 2 × 1,020 men, 20 % longbows a side): the attacker halts out of
bowshot of the enemy's foot *and* of his wing archers and stays there; the bows fight the archery duel first
(archers prefer the enemy's bows), beaten or blown bow companies are pulled back round the foot before they
break, and the foot goes in when the enemy's bows are beaten (or after 2.5× the shooting time). The report now
says when the *lines* met and when the first foot company broke: 0.5–6 min after the lines meet (was 0.1–1 min,
at the touch) with 8–54 men down in the mêlée first (was 0–14); without bows (`HG_NOBOWS=1`) 6–10 min. Losers
lose 15–45 % dead, winners 3–25 %.

**March** (`node tools/march-test.mjs`, QA): the whole retinue crosses Ashby → Rookham; foot ~1.25 m/s on open
going; archers and knights arrive in ~65–70 min at the march over woods and marsh, men-at-arms ~80, quick pace
50–60 min. (Hedge joints no longer multiply; hedges are crossed through their gaps; men step round ground the
25 m nav cells missed; on the march stragglers >25 m are not waited for.)

## 4. Tools

* `node tools/battle-mc.mjs [scenario…|17.1|17.2|17.3|17.4] [--seeds N] [--quick] [--json out.json]` — parallel
  harness; prints PASS/FAIL per band. Scenario library: `tools/scenarios.mjs` (line fights, mirror test,
  cavalry pursuit, river trap, first shock, pike vs horse, horse vs disordered foot), `tools/scenarios-hist.mjs`
  (Crécy, Agincourt, Courtrai, Stirling Bridge, Bannockburn at numbers ÷20, lengths ÷√20), `tools/scenarios-extra.mjs`
  (missile volleys at a pinned block, crossbow vs longbow, duels). Bands: `tools/bands.mjs`.
  `HG_TRACE=<ticks>` prints a unit timeline while a scenario runs.
* `node tools/perf.mjs` — 3,000 men, ~1,300 in melee; ms/tick (CPU).
* `node tools/ai-duel.mjs [dispA] [dispB] [seed] [minutes]` — two commander AIs, full report (incl. when the lines met,
  the first foot break and arrows-vs-mêlée losses before it; `HG_ARMS=1` by arm).
* `node tools/feat-ref.mjs [battles]` — regenerates `js/sim/feat-ref.js`.

## 5. Known gaps and weak spots

* **AI battles** (`tools/ai-duel.mjs`, 20 % longbows): with momentum a Hotspur's line arriving at the quick often
  breaks the first enemy company within ~1 min of contact (21 melee casualties to 43 arrow ones in one run); without
  bows the first break comes 2 min after the lines meet (was 6–10). Contact is now decisive — perhaps too decisive
  for AI-vs-AI; the knobs are C.shockV/shockDown and the Hotspur pace.
* **tools/battle-scenarios.mjs** (both sides AI): determined attackers now close (Crécy's knights charge home and are
  beaten; Agincourt's men-at-arms reach the English — and, in the current field, beat them: the English archers break
  in the melee). The scripted §17 scenarios still give the historical results.
* Near-edge bands: Courtrai knights killed (bimodal across seeds), trapped loser fatalities (77.5 % of 80), P(1 beats 3)
  (0.030 of 0.03), losses at the break (5.4 % of 5 %).
* The crowd crush from flank-fire squeeze needs pressure from behind or in front to reach 3 men/m².
* **Duel draws:** equal mail against mail is often a stalemate of bruises; P is over decided duels.
* Experience does not carry over between battles; the fog-of-war estimate of numbers is not fed into the AI.

## 6. For the other lanes

* `landread.js` rain: on near-flat ground even `rain: 0.3` reads everything as Marsh (going 0.44); Agincourt uses 0.3 on
  a 1.2 % valley. A soil/clay input would let ploughland become mud rather than marsh.
* `js/main.js` now sets `w.features = featuresFromMapData(objData, vegData)` after loading the obstacles (one line).
  Fences come from objects.json (`fence`, scale × 4 m), hedgerows from chained `hedge_shrub` instances (≈3,000 runs,
  24 km on the vale).
* Economy walls: `features.syncBuildingFeatures` reads `w.buildings` wall stretches (`x1..y2`, `progress`, `ruin`,
  `team`, `w.teams[t].town`); economy.blockWall keeps closing their nav cells. Gates stay openings.
* `features.fieldWork(w, unit, "archer_stakes" | "pits_pottes" | "ditch")` is ready for a UI order.
* `world.issueOrder` routes through command friction when `w.command` exists; `{ immediate: true }` bypasses it.
