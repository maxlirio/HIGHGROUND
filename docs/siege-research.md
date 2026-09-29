# Siege warfare, 13th–14th c.: the numbers the game uses

Model: `js/sim/siege.js`. Economy: `js/sim/econ-data.js` (siege workshop, RECIPES, RECRUITS). AI:
`js/sim/ai-general.js` (siegeEngines, escalade, engineThink). Harness: `node tools/siege-test.mjs`. Art:
`docs/siege-art-contract.md`.

Every number below is either sourced (bracketed tag, list at the end) or marked **DESIGN** / **EST**, which
means a judgement tuned in the harness.

## 0. Clocks: why the stones do two things

The game runs two clocks (`js/sim/clock.js`). Battle is 1:1 real time. Economic work runs 1 real minute = 1.5
econ days. A siege of weeks can only be played if **structural work** (breaching a wall, breaking a gate, the
defenders repairing it) runs on the **economic clock**, the same clock that builds and repairs the wall. If
battering ran at 1× while masonry went up and was patched 2160× faster, no breach could ever be made.

- **Structures** receive each engine's real number of throws per econ day. The model is deterministic and
  uses expected values: throws/day × share striking (Monte-Carlo from the engine's dispersion and the
  target's geometry) × energy above the target's threshold.
- **Men** are hit by the *visible* stone or quarrel, launched at the engine's real tactical rate. A visible
  trebuchet stone is the real one only with probability `menP` = real rate ÷ visible rate (1/60). This keeps
  the counterweight trebuchet what it was: a wall-breaker that rarely killed anyone. A mangonel stone and a
  springald quarrel are fired at the real rate and are all real.

## 1. Counterweight trebuchet

| quantity | value | source / note |
|---|---|---|
| projectile | 90 kg stone (DESIGN, within the range) | 45–160 kg usual, up to 500 kg for the greatest [WIKI-T][CHEV] |
| range | 120–230 m | ~200–300 m for heavy shot [CHEV]; shorter for heavier stones |
| counterweight | ~10× the projectile (model only) | [WIKI-T] |
| energy at the target | E = ½ m v², v = √(R g) (a 45° throw): 65 kJ at 150 m, 95 kJ at 215 m | ballistics |
| throws | 30 / econ day (≈2.5 per hour × 12 h) | 1–2/h for the largest, several/h for mid-sized with a windlass; record reload 4 min 20 s, not sustainable [WIKI-T][TARVER] |
| visible cadence | one per 24 s (menP 1/60) | DESIGN |
| dispersion (a settled crew) | σ_long 0.018 R + 1 m, σ_lat 0.007 R + 0.5 m (4.6 × 1.9 m at 200 m) | repeat hits on one spot are why they breached; DESIGN from reconstruction trials [TARVER] |
| ranging | the first throws are ×2.5 wider, converging over ~5 throws | DESIGN: "walking the shots in" |
| crew | 16 (6 minimum) | EST |
| transport | ironwork, axle, sling and ropes made at the yard (`trebuchet_gear`: 80 kg iron, 150 kg rope, 600 kg timber, 16 carpenter-days); 7 t of baulks on 2 carts | engines were carted in pieces and framed on site [PURTON] |
| framing on site | 90 man-days (≈5–7 econ days with its crew) | EST; Edward I's engines at Stirling (1304) took weeks for the largest [PRESTWICH] |
| arc once built | ±20° from its built facing; it never moves | DESIGN |

## 2. Traction trebuchet ("mangonel")

| quantity | value | source / note |
|---|---|---|
| projectile | 8 kg | 2–15 kg normal, up to ~60 kg for the largest [CHEV-TR][WIKI-M] |
| range | 30–110 m | 85–133 m for beam-sling machines [WIKI-M] |
| rate | 3 per minute (≈1,800 per 10-hour day) | Lisbon 1147: two machines, 5,000 stones in 10 h, crews in shifts [LISBON via WHE] |
| crew | 16 on the ropes (8 minimum) | 15–40 pullers for a mid-sized machine; 250 for the largest Chinese [CHEV-TR] |
| dispersion | σ_long 0.05 R + 1, σ_lat 0.025 R + 0.5 | the pull varies man to man; DESIGN |
| mobility | towed at 0.4 m/s; 60 s set-up before it shoots | EST |
| vs masonry | its 3–5 kJ stones do nothing to a stone wall (threshold 20 kJ) | traction machines harassed defenders and smashed hoardings and palisades [CHEV-TR] |

## 3. Springald (espringal)

Torsion bolt-thrower on a wheeled carriage, spanned by windlass. It uses the ballistics code's own missile
(`kit.js` MISSILES.springald): a 0.2 kg quarrel at 58 m/s (≈340 J), low drag, out to 300 m, one shot per 45 s
with a full crew of 4. It picks its own targets and prefers enemy engine crews (counter-battery). Springalds
were the standard wall and gatehouse artillery of English and French castles c. 1280–1400 [LIEB][PURTON].

## 4. Ram, tower, mantlet, ladders

| engine | numbers | source / note |
|---|---|---|
| covered ram ("cat", "sow") | 9 m log (~2.5 t) under a hide-covered shed; 14 crew; 6 swings per minute at ≈4 kJ a swing; pushed at 0.5 m/s | [PURTON][NICOLLE]; energy EST (2.5 t at ~1.8 m/s) |
| siege tower (belfry) | 5 × 5 m, 11 m high, bridge at 7.5 m, docks within its 4 m bridge of the wall; pushed at 0.25 m/s; 18 crew; the ditch in front must be filled first (120 s of fascine work) | [NICOLLE][BRADBURY] |
| mantlet | 2.4 × 2 m wheeled plank screen; hard cover 0.85 against shafts from the front for men within 4 m behind it | pavise-equivalent (combat-research §9.4 has 0.9 for a planted pavise) |
| ladders | one per 8 men (max 10), 35 kg of timber each (workshop 0.4 carpenter-days, or knocked together on the spot in 60 s from the store's timber); a 7 m ladder | [BRADBURY] |
| escalade climb | palisade 12 s, stone wall 25 s, shut gate 20 s a man (FEATURES.climbS); up a docked tower 3 s | DESIGN |
| fight at the head | each defender within 3.5 m of the ladder head throws the climber down with P 0.5 × (1 + 0.6 Δskill) × (1 + (H − 3.5)/5); a friend already up there divides it by 1 + 0.7·friends; a tower's bridge admits only 3 defenders and its rate is ×0.4 | DESIGN, tuned to the historical record: an escalade of an alert, manned wall usually failed [BRADBURY] |
| thrown down | 55 % fall hurt or killed (INSTANT 25 %, MORTAL 35 %, INCAP 40 % of those), otherwise bruised back to the foot; 25 % of repulses push the ladder over (30 % of those break it) | DESIGN |
| water | no escalade where water stands at the foot (wet moat, flooded ditch) | owner's rule |
| defenders | men on the wall-walk run to each raised ladder's head (2 per ladder, from within 25 m) | DESIGN |

## 5. The workshop and its goods

`siege_workshop` (stage 3, "Stockaded village"; 22 × 14 m; 260 man-days, 7 t timber, 0.5 t stone; staff 8;
carpenters at full rate, others at 0.35).

| product | carpenter-days | timber kg | iron kg | rope kg |
|---|---|---|---|---|
| trebuchet_gear | 16 | 600 | 80 | 150 |
| mangonels | 10 | 1,800 | 25 | 110 |
| springalds | 9 | 450 | 35 | 25 |
| rams | 8 | 4,200 | 60 | 40 |
| siege_towers | 28 | 12,000 | 140 | 90 |
| mantlets | 1.2 | 180 | 1 | — |
| ladders | 0.4 | 35 | — | — |

Rope is made at the weaver from hemp (a ropewalk pair lays about 20 kg a day from 22 kg of hemp, EST), or
bought: hemp 0.4 d/kg, rope 1.2 d/kg (EST, near the price of cord in the Winchester pipe rolls [ROGERS]).
Crews are paid wages: carpenters and engineers 3 d/day and labourers 2 d/day. Master engineers such as
Master Bertram or Master James were paid 6–12 d [PRESTWICH].

## 6. Structures: what it takes to breach them

Work done = max(0, E − E0) kJ per strike. A 6 m module of wall (or a gate's leaves) is breached after W kJ.

| target | stones: E0, W | ram: E0, W | result (siege-test A, one engine) |
|---|---|---|---|
| palisade (30 cm posts) | 1 kJ, 350 kJ | 0.5, 500 | mangonel at 90 m: 0.6 econ days; trebuchet at 180 m: 0.8 d |
| stone curtain (1.5–2 m) | 20 kJ, 7 MJ | 3.5, 60 MJ | 1 trebuchet: 8 d; 2 trebuchets: 4.3 d; mangonel: never; ram: ~a month |
| timber gate | 2, 1,500 | 1, 6,000 | ram: 0.55 d (≈13 h of battering) |
| stone gatehouse | 20, 20,000 | 2, 28,000 (leaves 8,000 then portcullis 20,000; §11) | ram: 3.9 d |
| other buildings | timber 0.5 kJ, 0.4 kJ/hp; stone 15 kJ, 3 kJ/hp | — | a house falls to two trebuchet stones |

Historical anchors: palisades fell to fire, axes and engines within a day or two [BRADBURY]. Stone curtains
took the concentrated fire of several great engines for one to several weeks, and most fortresses were taken
by starvation, mining, treachery or escalade rather than by breach (Château Gaillard 1204, Kenilworth 1266,
Stirling 1304) [PURTON][PRESTWICH]. Timber gates were burnt or battered in within hours. The gate passage,
with its portcullis and vaulting, held much longer.

A breached module leaves a gap in the wall's features and nav cells, and the rubble shows as the kit's
breach piece. The defenders repair on the economic clock: the worst module first, 30 % of the build labour
and materials. A gate's leaves can be broken in while its flanks stand. The gate is shut whenever enemy troops
are within 350 m or the town is besieged. Attackers inside the walls with no defender by the gate lift the bar.

## 7. Fire and capture

Engines burn on the battle clock. Fire arrows: 1.2 % of shafts that fall on an engine × its flammability (ram
0.3 and tower 0.4 for their wet hides, others 0.7–1). Torches: enemy men standing at an engine with none of its
own men there. Pitch and fire-pots: defenders within 9 m of a ram or tower working at the wall (3 % per 10 s per
defender, up to 6). Fire grows 0.4 %/s and burns the whole engine in about 4 minutes. A crew of 4+ beats it
back at 1.2 %/s. An engine with no crew is abandoned; enemy men within 6 m with none of its own side within
12 m capture it, and any foot ordered to "Man the engine" become its crew.

## 8. Harness results (`node tools/siege-test.mjs --seeds 6`)

- A · breach times (econ days): see §6. All within the bands.
- F · the castle: see Part II (34/34 bands PASS on 2026-09-28, 6 seeds: `tools/heavy.sh node tools/siege-test.mjs`).
- B · a mangonel into a deep block of 120 standing in its beaten zone: ≈150 men an hour. Men who stand still
  under stone for an hour are rare; stress from every stone within 10 m drives them off. A springald at 200 m:
  ≈18 an hour.
- C · escalade, 60 spearmen: palisade undefended 100 % lodged in about 100 s; palisade with 30 defenders 17 %;
  stone wall with 30 defenders 33 %; from a docked siege tower against 30 defenders 67 %.
- D · a trebuchet framed up on site by its crew in 7 econ days (4.7 real minutes). A ram sent at a gate under
  20 longbowmen breaks it in half the runs and burns (or loses its crew) in the rest.
- E · the AI general before a palisaded Ashby with a train (mangonel, ram, trebuchet): it frames the engines up,
  bombards the stretch facing its camp, breaches it within 13–15 minutes, breaks the gate, and storms through
  the breach. In one of three 45-minute runs the vill fell.

## Sources
- [WIKI-T] "Trebuchet", Wikipedia (projectile weights, counterweight ratio, rates).
- [CHEV] P. E. Chevedden et al., "The Trebuchet", *Scientific American* 273 (July 1995) 66–71; Chevedden, "The Invention of the Counterweight Trebuchet", *Dumbarton Oaks Papers* 54 (2000).
- [CHEV-TR] P. E. Chevedden, "The Traction Trebuchet: A Triumph of Four Civilizations", *Viator* 31 (2000).
- [WIKI-M] "Mangonel", Wikipedia (beam-sling machines: up to 60 kg over 85–133 m).
- [LISBON via WHE] *De expugnatione Lyxbonensi*, via World History Encyclopedia, "Artillery in Medieval Europe" (5,000 stones in 10 h by two machines).
- [TARVER] W. T. S. Tarver, "The Traction Trebuchet: A Reconstruction of an Early Medieval Siege Engine", *Technology and Culture* 36 (1995).
- [PURTON] P. Purton, *A History of the Late Medieval Siege, 1200–1500* (2010).
- [PRESTWICH] M. Prestwich, *Armies and Warfare in the Middle Ages: The English Experience* (1996); *Edward I* (1988).
- [NICOLLE] D. Nicolle, *Medieval Siege Weapons (1): Western Europe AD 585–1385* (Osprey, 2002).
- [BRADBURY] J. Bradbury, *The Medieval Siege* (1992).
- [LIEB] J. Liebel, *Springalds and Great Crossbows* (1998).
- [ROGERS] J. E. T. Rogers, *A History of Agriculture and Prices in England* vol. 1–2 (1866).

# Part II · Castles: the siege itself (castle-plan §4; model `js/sim/siege-works.js` + `js/sim/siege.js`)

Harness: `node tools/siege-test.mjs --only F` (through `tools/heavy.sh`). Numbers are sourced (tag) or **EST**/**DESIGN**.

## 9. Breaching masonry by bombardment

| quantity | value | source / note |
|---|---|---|
| curtain module (6 m of a 1.5–2.7 m wall) | E0 20 kJ, W 7 MJ (unchanged, §6): one trebuchet ≈ 8 econ days, two ≈ 4.3 | Stirling 1304: Edward I's 13–17 engines (Warwolf the largest) worked from April to July and the garrison of ~30 yielded before a practicable breach [PRESTWICH][WIKI-STIR]; Kenilworth 1266, six months, never breached [PURTON] |
| damage states | intact → **pocked** (≤ 75 % left: the facing spalls) → **cracked** (≤ 40 %: the rubble core opens) → **breach** (0: the module falls into a rubble cone both sides) | DESIGN, matching the art kit's pieces (castle-plan §2) |
| castle curtain | W scales with the part's thickness (`thick`) over the town wall's 1.5 m: a 2.7 m curtain takes ×1.8 (one trebuchet ≈ 14 econ days a module); its height sets the stone's strike window and the breach slope | DESIGN (mass of masonry to bring down ∝ thickness) |
| mural tower | one piece: E0 20 kJ, W 20 MJ (3 m walls, round faces deflect glancing stones) | towers were almost never battered down; they were mined (Rochester, Dover, Château Gaillard, Acre 1291) [PURTON][BRADBURY]. After Rochester (1215) the fallen square corner was rebuilt round, the better to resist mining [EH-ROCH] |
| a breach is a rubble slope | `breach_rubble` feature: foot cross 6 s a span (≈ quarter pace), 3 men abreast, horses cannot | Dover 1216: the fallen gate tower made "a steep ramp of rubble" for the assault [EH-DOVER] |

## 10. Mining

| quantity | value | source / note |
|---|---|---|
| gallery | ~1–1.25 m wide × 1.25–2 m high, timbered as it goes | [SCHNECK] (Vauban-era galleries 1.25 × 1 m); medieval galleries larger, propped [PURTON] |
| crew | a face works ~4 at a time; 12 in shifts is a full face crew (MINE.faceCrew); fewer men dig proportionally slower | Vauban: 18 miners and 36 labourers in three 8-hour shifts for one assault mine [SCHNECK]; Edward I hired Forest of Dean miners as specialists (`u.miners` ×1.3) [PRESTWICH] |
| rate | 2.5 m/econ day in earth or clay, 2 in chalk, 0.2 in rock (**EST**) | hand-dug galleries: the expert Pennsylvania coal miners at Petersburg (1864) drove 156 m in about three weeks, ≈ 7 m/day [PETERSBURG]; medieval crews with picks and baskets, no powder, a third of that. Rock foundations made castles effectively immune to mining — the reason for rock sites [PURTON] |
| mouth | 40 m out, in cover (a "cat" shed, a trench or a house) | DESIGN |
| chamber | 2.5 econ days to open it under the section and set the props | **EST** |
| firing | the props packed with brushwood and fat, fired; they burn through in ~0.3 day | Rochester 1215: writ of 25 Nov for "forty of the fattest pigs, the sort least good for eating" to fire the mine under the keep's corner [EH-ROCH][CST-ROCH] |
| collapse | a curtain module falls entire P 0.8 (its neighbours lose up to half), else it settles and cracks; a tower falls entire P 0.75 | Rochester: John's first mine (SW corner) failed, the second brought the SE corner down — and the garrison held on behind the cross-wall [EH-ROCH]; Dover 1216: the east gate tower brought down [EH-DOVER]; Château Gaillard 1204: the outer bailey's great tower mined and fallen [PURTON] |
| harness | a 41 m gallery under a curtain module: fired and fallen in ≈ 19 econ days (≈ 13 real minutes); a tower: the same, falls entire in most runs | Rochester: 13 Oct – 30 Nov 1215, two mines in seven weeks [EH-ROCH]; Carcassonne 1240: mines begun in seven places within a 24-day siege [DESORMES] |

### Countermining
| quantity | value | source / note |
|---|---|---|
| listening | a post inside the wall hears a gallery within ~30 m: P(heard)/day 0.7 at the post, falling to 0 at 30 m; unwatched, the spoil and noise give one away within 10 m of the wall at 0.06/day | Carcassonne 1240: "when we heard their mining, we countermined" [DESORMES]; bowls of water and drums as listening devices go back to antiquity (Herodotus, Barca: a bronze shield) — **EST** ranges |
| counter-gallery | dug at the same rate toward the mine heard | [DESORMES] |
| the fight underground | up to 4 a side, 3 rounds, P 0.22 a man a round to kill a foe (skill-weighted); the side left the stronger holds; the loser's gallery is taken and collapsed; if the attackers win, both sides lose a day | Carcassonne: at the Rodez gate "we came upon them so that we took their shaft from them" [DESORMES]; Melun 1420: Henry V himself fought Barbazan hand-to-hand in the mine [PURTON]; St Andrews 1546–7: mine and countermine still visible, met in the rock [HES-STA] — DESIGN numbers |
| harness | countermined mines are heard in every run and lost in most; ≈ 3 men die per fight | Carcassonne: the defenders "countermined a very large part" of the seven mines, yet one brought down the barbican's front, and a dry-stone wall behind held [DESORMES] |

## 11. The gate: ram, portcullis, fire

| quantity | value | source / note |
|---|---|---|
| timber gate | the leaves only: ram E0 1 kJ, W 6 MJ ≈ 0.5 econ day (≈ 12 h of battering) | §6 |
| stone gatehouse | leaves (8/28 of W) then the portcullis (20/28): ram E0 2 kJ, W 28 MJ ≈ 4 econ days in all | oak leaves on iron pintles, barred; the portcullis an iron-shod oak grille dropped in grooves from the chamber above [PURTON][NICOLLE]. Gatehouses usually held longer than curtains; most were taken by the leaves being burnt or the defenders' surrender |
| the portcullis | DROPPED whenever the gate is shut against an enemy (event `portcullis-dropped`), raised when the enemy has gone or for a sally; broken leaves behind a dropped portcullis keep the passage shut | [PURTON] |
| fire at the gate | attackers pile brushwood and pitch for 45 s, then fire it; the fire grows 0.4 %/s (the portcullis burns at 0.2×); a full fire burns the leaves through in ~5 min (battle clock, as engines burn); 4+ defenders pouring water from the slots above beat it back at 0.6 %/s | timber gates were more often burnt than battered [BRADBURY]; the slots and holes over a gate passage were as much for water on a fire as for missiles [PURTON] — DESIGN rates |
| murder holes | 4 holes in a gatehouse vault; a man in the chamber above drops a stone through each every ~20 s; 55 % find a man in a crowded passage; the stone kills (22 %), mortally wounds (23 %), incapacitates (30 %) or disables — helmets reduce it | DESIGN on [PURTON][NICOLLE] |

## 12. Machicolations and hoardings: what fell on men at the wall foot

Timber hoardings (brattices) on the parapet, later stone machicolations, let defenders drop things straight down the
face of the wall without leaning out. What was dropped was mostly **stones** (stockpiled on the wall-walk), with
**hot sand** and **quicklime**, which got under mail and blinded; **boiling oil** was costly and rare — the famous
case is Orléans 1428–9, and it is not the model (no boiling oil here) [PURTON][NICOLLE]. Heated sand is attested from
antiquity (Alexander at Tyre, 332 BC: Diodorus 17.44) and quicklime was used at sea against the French at Sandwich
1217 [WIKI-SANDWICH].

| quantity | value | source / note |
|---|---|---|
| drop rate | one drop per defender every 14 s from a hoarding or machicolation; ×0.3 over a bare parapet (he must lean out through a crenel) | DESIGN |
| hit | 45 % on a man at the foot (within 2.5 m of the face) | DESIGN |
| what falls | 75 % stones (sev. as murder holes), 25 % hot sand / quicklime (stunned 6 s, heavy stress, 35 % incapacitated) | DESIGN |
| the ram's roof | keeps 90 % of drops off the crew (hides and planks: the point of a "cat") | [NICOLLE] |
| which walls | a part/building flagged `hoard` or `machicolated`; a gatehouse always (machicolation over the gate arch) | castle.js part flag |

## 13. Escalade and siege towers onto a castle

The escalade numbers are §4's (an alert, manned wall usually threw an escalade back [BRADBURY]). On a castle:
each raised ladder is a castle.js `ladder` link from the ground to the wall-walk (width 1, speed = height / climb
time), a docked tower's bridge a `bridge` link three abreast; siege.js still resolves the climb and the fight at the
head (only men up on the wall-walk meet the climber), and a man who gets over stands on the wall-walk (his level).
Ladders pushed off (event `ladder-pushed`) lose their link. Caerlaverock 1300: a garrison of ~60 held Edward I's
army for two days [WIKI-CAER]; Château Gaillard's middle bailey fell to men who climbed in through the chapel's
latrine window [PURTON].

## 14. Breaches: storm, barricade, repair

| quantity | value | source / note |
|---|---|---|
| a breach | a castle.js `breach` link (rubble crest to the ground both sides, 3 abreast, speed ×0.35), and the rubble feature (§9) | castle-plan §1 |
| barricade | 60 man-hours for a 6 m retrenchment of timber, rubble and posts (400 kg timber from the store); no work while an enemy is within 25 m | Dover 1216: behind the fallen tower the garrison had "erected a barrier of boulders, timber cross-beams and mighty oak posts" and threw the French back out through the breach [EH-DOVER]; Carcassonne 1240: "a large and strong wall inside the barbican of dry stones" [DESORMES] — **EST** labour |
| breaking it | 900 man-seconds of pulling and hacking, at most 8 men at it, slowed by the defenders behind it (÷ (1 + 0.6·def/att)) | DESIGN; harness: 60 men against 30 behind it pull it down in ~3–4 minutes of fighting |
| repair | between assaults, 30 % of the module's build labour (≈ 200 man-days for a 6 m stone module), with its stone; no work while an enemy is within 60 m | as economy.js repairs; the defenders' nightly repair of breaches is a constant of the sources [BRADBURY] |
| walling up a breach | a BREACHED module stays a breach (rubble, link, no wall line) until its gap is walled up course by course: 25 % of its build labour (≈ 165 man-days: 40 men about four days), done in haste to 35 % of its strength; work stops while an enemy is within 60 m and goes on from where it stopped | **EST**; siege-test "breach walled up by 40 men" band 2.5–8 working days |

## 15. Sallies

Out by the POSTERN (a small door, one man at a time, 1.5 s a man) or, lacking one, by the gate held open while
they pass (a real risk). They charge the named engine, fire it with fire-pots (8 %/s while 3+ are at it) and come
back when it burns, when they have lost 40 %, or after 4 minutes. Carcassonne 1240: the besiegers' mangonel before
the barbican was abandoned to the defenders' fire [DESORMES]; sallies against engines are the commonest active
defence of the period [BRADBURY][PURTON].

Night sallies while days pass (siege-ai.js `sallyOdds`): P(the party reaches the engine) = 0.55 × guard factor
1/(1 + guard/(2.5·party)) × distance factor (the way out and back from the postern, 0.3–1 over 60–380 m) × darkness
(1 − 0.45·moon, the moon's phase over a 29.5-day cycle; rain ×1.3, storm ×1.4, fog ×1.45, snow ×1.15) × 0.45 while
the camp is on the alert (8 days after the last sally), clamped 2–55 %; reaching it, 35 % the guard beats the fire out
(the engine scorched, mended by its carpenters from a day later — siege.js `engCond`: a damaged engine throws at
0.15 + 0.85 × its strength). A constable waits for a dark night: no sally when the odds are under 8 %. **DESIGN** on
the pattern of the sources: sallies against engines were the commonest active defence and most were beaten off
[BRADBURY][PURTON].

## 16. Garrisons, food, starvation and surrender

| quantity | value | source / note |
|---|---|---|
| garrison sizes | tens, not hundreds: Harlech 1284 ~30 (10 crossbowmen); Stirling 1304 ~30 against Edward I's army; Caerlaverock 1300 ~60 against ~3,000; Rochester 1215 ~100 knights with serjeants and crossbowmen; Kenilworth 1266 ~1,200 | [TAYLOR][PRESTWICH][WIKI-CAER][EH-ROCH][PURTON] |
| attackers | commonly 5–20× the garrison | same |
| provisions | `setProvisions(w, { team, days })`: man-days; each man eats 1 man-day per econ day | Carcassonne 1240: "an abundance of grain and meat to withstand a long siege" [DESORMES] |
| starving | courage −1.2 %/day; after 10 days, 1 %/day of the garrison dies (hunger, dysentery) | Kenilworth: surrendered in Dec 1266 to hunger and disease [PURTON] — **EST** rates |
| the captain's daily hazard of yielding | starving 0.12 + 0.02·days starving; < 5 days' food 0.03; a practicable breach with no retrenchment and 3× the garrison before it 0.06; garrison < 25 % of its strength 0.15; all × (1.3 − resolve), resolve 0.5 | the law of arms: a garrison that yielded before a storm kept its lives and often its arms; one that held past a practicable breach could be put to the sword — Bedford 1224, ~80 of the garrison hanged [PURTON][BRADBURY] — DESIGN hazards |
| terms | "honours" (march out with arms) when yielding on terms or at a respite's end; "lives" when starved out; the garrison leaves the fight (S_CAPT / ST_SURR) and the gates are opened (event `surrender`) | DESIGN on the customs |
| respite | `offerRespite(w, team, days = 40)`: the garrison will yield on day N unless relieved (an army of theirs within 2 km at least as big as the garrison) | Stirling 1314: Mowbray agreed to yield by Midsummer unless relieved — which brought on Bannockburn [WIKI-STIR] |
| harness | 40 men with 20 days' food, 300 before the walls: they yield a few days after the food runs out ("lives") | Rochester 1215: after the keep's corner fell the garrison held until starved, surrendering ~30 Nov [EH-ROCH] |

### Sources (Part II)
- [DESORMES] Guillaume des Ormes, seneschal of Carcassonne, letter to Blanche of Castile (1240), Epistolae (Columbia): https://epistolae.ctl.columbia.edu/letter/724.html
- [EH-ROCH] English Heritage / Castle Studies Trust, the siege of Rochester 1215: https://castlestudiestrust.org/blog/2020/05/22/kings-barons-miners-and-inedible-pigs-the-great-siege-of-rochester-in-1215-now-on-video/ ; https://www.exploring-castles.com/uk/england/rochester_castle/
- [CST-ROCH] as above (the writ of 25 November 1215 for forty pigs).
- [EH-DOVER] English Heritage, "The Great Siege of Dover Castle 1216": https://www.english-heritage.org.uk/visit/inspire-me/blog/blog-posts/the-great-siege-of-dover-castle-1216/
- [SCHNECK] W. C. Schneck, "The Origins of Military Mines: Part I", *Engineer* (1998): https://man.fas.org/dod-101/sys/land/docs/980700-schneck.htm
- [PETERSBURG] The Petersburg Project, "A Strange Sort of Warfare Underground": https://www.petersburgproject.org/a-strange-sort-of-warfare-underground.html
- [HES-STA] Historic Environment Scotland, St Andrews Castle (the mine and countermine of 1546–7).
- [WIKI-STIR] "Siege of Stirling Castle (1304)"; "Battle of Bannockburn", Wikipedia.
- [WIKI-CAER] "Siege of Caerlaverock Castle", Wikipedia.
- [WIKI-SANDWICH] "Battle of Sandwich (1217)", Wikipedia.
- [TAYLOR] A. J. Taylor, *The Welsh Castles of Edward I* (1986) (garrisons of the Edwardian castles).
- Diodorus Siculus, *Library of History* 17.44 (heated sand at Tyre).
- and Part I's [PURTON], [PRESTWICH], [NICOLLE], [BRADBURY].

# Part III · The castle's fabric and how men move in it (castle-plan §1; model `js/sim/castle.js`)

Numbers for the castle as a place men stand, climb and fight in. Where the sources give a range the game takes the
middle of it (DESIGN); the three layouts are composites after the plans named, not copies of any one castle.

## 17. Curtain walls and the wall-walk
- 13th-century curtains stand 8–12 m to the wall-walk parapet and are 2–3 m thick at the walk; the great Edwardian
  inner curtains are thicker and higher (Harlech's inner curtain ≈ 3.7 m thick and ≈ 12 m high; Beaumaris's inner
  curtain higher still over a low outer one) [TAYLOR][CADW][KENYON]. A concentric castle's outer curtain is kept low
  so the inner one can shoot over it [TOY][BROWN].
- The wall-walk (allure) runs along the top behind a parapet ~0.6–0.9 m thick and ~2 m high, crenellated: merlons
  ~1.5–2 m wide with arrow loops, crenels ~0.6–0.9 m; the walk itself 1.5–2.5 m wide, open (or with a low wall) on
  the inner side [KENYON][TOY]. So a man on the walk is covered by the merlons against shots from outside for about
  two-thirds of the parapet's length, and not at all from inside.
- GAME: curtain 10.5 m high, walk at 8 m, 2.6 m thick, parapet 0.6 m → a 2.0 m walk; the concentric inner curtain
  12.5/10/3.0 m and its outer curtain 7.5/5.5/2.2 m. The walk is one walkway edge per 6 m wall module (so a breach
  cuts the walk above it). Cover (`coverFor`): 0.8 for a man behind the parapet against shots from outside (0.6 for
  a bowman shooting through a crenel; ×0.55 against plunging shots from higher up, a siege tower's top), 0 from the
  bailey side or along the same walk; 0.7 on a tower top or roof (parapet all round); 0.95 in a room (loops only).

## 18. Mural towers
- Towers project beyond the curtain so their loops enfilade its face, and stand within bowshot of each other
  (commonly 25–50 m); Edwardian round towers are ~8–12 m across and rise 3–6 m above the curtain; the wall-walk
  passes through them by doors, so a stretch of walk taken by escalade can be shut off tower by tower [TOY][KENYON]
  [GOODALL]. Their stairs are newel (vice) stairs 1.5–2 m across: one man abreast.
- GAME: round towers Ø 11 m (r 5.5; 4.2 on a concentric outer curtain), centred 0.45 r outward of the curtain's
  angle, a room at walk level through which the walk passes, an open top at walk + 5.5 m; a spiral stair from a
  ground door on the bailey side to the room and on to the top. Hill castle: 6 towers ~30 m apart; concentric: 7
  inner + 8 outer; river: 5.

## 19. The gatehouse
- The twin-towered gatehouse of the later 13th century: a passage 2.5–3.5 m wide and 12–25 m long between two
  D-shaped towers, closed from outside in by drawbridge (over the ditch), outer portcullis, murder holes in the
  vault, the barred gate leaves, and an inner portcullis; a chamber over the passage holds the windlasses; the
  roof is a fighting platform [TOY][KENYON][CADW (Harlech, Beaumaris)].
- GAME: 17 m wide × 15 m deep, passage 3.4 m, two portcullises (siege.js drops them when the gate is shut against an
  enemy), four murder holes along the passage, a chamber at walk level joining the walks either side, a roof at
  walk + 5.5 m, a straight stair up the back of each tower. The ditch leaves a causeway before the gate.

## 20. The keep
- Great towers: Rochester ≈ 21 m square and ≈ 34 m to the parapet; Dover ≈ 30 × 29 m and ≈ 25 m high; the White
  Tower ≈ 36 × 32 m and ≈ 27 m; walls 3–6 m thick at the base. The entrance is at first-floor level up an external
  stair in a forebuilding (Rochester, Dover, Castle Rising); a basement store, a hall, a chamber above, a roof walk
  with corner turrets; stairs within the walls [BROWN][GOODALL][EH].
- GAME: 20 × 20 m (18 on the river castle), 3 m walls, storeys at 0 / 6 / 13.5 m and the roof at 21 m (the
  parapet ~23 m); levels 3 (hall), 4 (chamber), 5 (roof); the forebuilding stair two abreast up the face toward
  the bailey to the hall door; one-abreast stairs within.

## 21. Ditches and moats
- A dry ditch, often rock-cut, 6–12 m wide and 3–6 m deep, a berm of some metres between it and the wall foot; a
  wet moat where water could be led; a causeway or drawbridge at the gate [KENYON][TOY].
- GAME: hill castle a dry ditch 9 m wide, 17 m out from the curtain line; concentric 10 m wide, 14 m out; river
  castle a wet moat 11 m wide on the three landward sides (the river is the fourth). Crossing a dry ditch on foot
  (down the scarp and up the counterscarp) is the FEATURES.ditch going: ~40 s for an armed man across 10 m; a moat
  cannot be crossed, and ladders cannot be set in water (siege.js).

## 22. How men move: stairs, ladders, breaches, and the levels rule
- Stair flow: ~1.1 persons s⁻¹ per metre of effective width on straight stairs, walking 0.5–0.8 m s⁻¹ along the
  flight ascending [FRUIN][SFPE]. A newel stair's effective width is ~0.5–0.6 m: ~0.6 men s⁻¹, one man every
  ~1.6 s; 8 m of rise is ~30 s of climbing. A ladder: one man every ~4 s (climbers keep ~3 m apart), ~0.25 m s⁻¹ up
  in harness. A breach's rubble slope: a few abreast at a scramble (SIEGE-MECH, §14).
- GAME: links with lanes (men abreast) and a headway; a man waits his turn at the foot; he chooses the stair or
  ladder that gets him there soonest, the queue counted. Spiral stair 1 lane, 1.6 s, 0.5 m s⁻¹ along a helix 1.8 m
  long per metre of rise; straight stair 0.55 m s⁻¹, 1.0 s; keep forebuilding 2 lanes.
- THE LEVELS RULE: men interact bodily (melee, crowding, a charge, "friends near") only on the same level; a man on a
  stair or ladder counts as the level he is going to once he is ¾ of the way, so the fight is at the ladder head
  and the stair head, one man at a time, as it was. Missiles cross levels, with heights and the cover above.

## 23. The law of arms: terms, the storm and the keep

A garrison summoned before the storm could yield with honour and march out with its arms; once it had refused and
the walls were carried by assault, it had forfeited any claim to quarter — its men were at the stormers' mercy, and
the town or castle "taken by storm" was the usual phrase [KEEN, Laws of War]. So a strong garrison did not yield
merely because the enemy were in the bailey: it fell back into the keep, which could hold out on its own — Rochester
1215 (the bailey taken, the keep held until mined and starved), Château Gaillard 1204 (the inner ward stormed).
In the game (siege-war.js `hopeless`, `answerTerms`): with its keep whole and its men still ≥ 35 % of the start, the
garrison in the bailey does not treat; in the keep it holds out for some minutes of battle time (its will wears down
by 0.07 a minute, more with fewer than 20 men) unless the keep's door or wall is forced; the constable's temper (drawn
once) makes one garrison stubborn and another quick to treat. Terms asked or granted once the walls are stormed are
for their lives only: the outcome is "taken by storm", the men prisoners; a keep that still held could yield for
their lives ("terms").

### Sources (Part III)

- [KEEN] M. H. Keen, *The Laws of War in the Late Middle Ages* (1965), ch. 7 "Sieges" — terms before the storm, no quarter after it.
- [KENYON] J. R. Kenyon, *Medieval Fortifications* (1990).
- [TOY] S. Toy, *Castles: Their Construction and History* (1939; Dover repr. 1985).
- [BROWN] R. Allen Brown, *English Castles* (3rd ed., 1976).
- [GOODALL] J. Goodall, *The English Castle 1066–1650* (2011).
- [CADW] Cadw guidebooks: *Harlech Castle*, *Beaumaris Castle*, *Conwy Castle and Town Walls*.
- [EH] English Heritage guidebooks: *Rochester Castle*, *Dover Castle*, *Goodrich Castle*.
- [FRUIN] J. J. Fruin, *Pedestrian Planning and Design* (1971).
- [SFPE] S. M. V. Gwynne & E. R. Rosenbaum, "Employing the hydraulic model in assessing emergency movement", *SFPE
  Handbook of Fire Protection Engineering* (5th ed., 2016).
- and Part II's [TAYLOR].
