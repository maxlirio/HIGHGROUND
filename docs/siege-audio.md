# Siege and castle sound (SIEGE-AUDIO)

Everything is synthesized by us (no samples) in `tools/audio/sfx_castle.py`, rendered to AAC buffers in
`assets/audio/` by `tools/audio/render.py` like the rest of the bank, and played by `js/audio/siege.js`, which
`js/audio/battle.js` drives. The mix numbers (gain, how far each sound carries, voice priority, voice limits) are in
`js/audio/bank.js`.

## The sounds

| name | what it is | how it is made |
|---|---|---|
| `trebuchet` (3) | the whole throw, timed to the renderer's 1.1 s arm swing | trigger knocked out, counterweight falling (frame groan, axle squeal), beam and sling sweeping (a rising low whoosh), the sling whip (a fast zip down and a snap at 1.1 s), the counterweight box bottoming out (a 40-50 Hz thud through timber modes), the arm swinging back and forth creaking |
| `stone_fly` (4) | the stone coming in: a deep tumbling whoosh growing to the impact, pitch sagging (Doppler) | scheduled so that it ends where the stone lands |
| `stone_wall` (4) | stone on masonry | the face spalling (a short crack), the wall's mass booming (35-55 Hz, falling pitch), fragments scattering and bouncing (each chip a small modal body with restitution), grit and dust |
| `stone_ground` (4) | stone into earth | a dead thud with no ring, turf tearing, clods falling back |
| `stone_men` (3) | a stone through a file of men | a shield staved, dull body blows, bone, mail/helmets thrown, the stone ploughing on |
| `masonry_crack` (3) | a module going to "cracked" | stone grinding (stick-slip into heavy low modes), a split through the core, fractures running along it, grit |
| `wall_collapse` (existing, 2) | a module falling to a breach | |
| `tower_collapse` (2) | a tower (or mined section) coming down, ~11 s | groans and cracks, the fall's rolling rumble, a ground-shaking thud, masonry breaking up for seconds, rubble sliding, dust |
| `ram` (4) | the ram on an iron-bound oak gate | the head on the straps, the leaves booming on their bar (40-260 Hz modes), hinges and bar groaning, grit from the arch |
| `leaves_break` (2) | the gate leaves giving way | long oak cracks, a strap tearing, a leaf crashing in, planks clattering |
| `portcullis_drop` (2) | the pawl knocked free | chain racing out over the drum, the grid scraping in its grooves, iron-shod oak slamming the sill (clang + boom), slack chain |
| `portcullis_raise` (1) | wound up | ratchet pawl, drum and timbers creaking, links climbing onto the drum |
| `portcullis_break` (2) | the grid battered through | iron bending, bars snapping, the wreck falling |
| `ladder` (existing), `ladder_push` (3) | a ladder thrown up / forked off | head grinding on stone, a creak as it stands upright, the rush of it going over, the crash, sometimes a pole snapping |
| `tower_dock` (existing), `bed_belfry` (loop) | the belfry's bridge; the belfry being pushed | frame racking and groaning, solid wheels grinding and rumbling over ruts, hides flapping |
| `bed_mining` (loop) | miners at the face | pick blows (three men out of time), shovel scrapes, props knocked home — all through earth (48 dB/oct above ~400 Hz) |
| `mine_fire` (2), `mine_collapse` (2) | the props fired; the gallery giving | a muffled whump and a fire roaring in the ground; timbers snapping underground and a deep, felt thud and rumble |
| `drop_stone` (4), `drop_sand` (3) | from the hoardings / murder holes | a heavy dull blow (helmet, shield or shoulders) and the stone rolling off; heated sand pouring, grains rattling off mail, a hiss |
| `bed_wallwalk` (loop) | men moving along a wall-walk | boots on stone flags (hard heel click, gritty scuff) with the parapet's close slap, mail, spear butts |
| `ir_hall`, `ir_passage` | impulse responses | the keep's storeys (RT60 1.4 s, dense early reflections, stone keeps its mids); the vaulted gate passage (a ~24 ms flutter echo between the side walls, RT60 1.1 s) |
| `bed_camp` (loop, 24 s) | the besiegers' camp in the days between assaults | carpenters hammering and a pit saw at the engines, a smith far off, horses at the lines, men talking and laughing (our formant voice, not shouting), a dog, cook-fires |
| `hammer` (3) | a mallet on timber and pegs (the camp; a barricade going up) | |
| `assault_trumpets` (2) | "trumpets in the camp" | 3-4 buisines in ragged unison on a rising call, nakers rolling, the war drum |

## When they play (the hooks)

`js/audio/siege.js` sees every sim event before battle.js does (`event(e)` → handled or not):

| sim | sound |
|---|---|
| `wall-state` state = cracked | `masonry_crack` at the module |
| `wall-breached` | `wall_collapse` (delayed after a mine), then the attackers' cry |
| `tower-collapsed` | `tower_collapse`, then the cry |
| `mine-fired` / `mine-collapse` | `mine_fire` / `mine_collapse` 2 m under the ground, then the wall or tower falling on top |
| `mine-fight`, `countermine-broke-in` | blows, cries, a crack — through the earth (`muffle`) |
| `portcullis-dropped` / `-raised` / `-broken` | `portcullis_drop` / `_raise` / `_break`, sent into the passage's reverb |
| `gate-leaves-broken`, `gate-broken` | `leaves_break` (one gate crash per 1.5 s), the cry |
| `gate-fired`, `b.gfire` | `ignite`; the fire bed while the gate burns |
| `dropped` {what: stone / sand} | `drop_stone` / `drop_sand` on the man, often a cry; in the gate passage (murder holes) with its echo |
| `ladder-pushed` | `ladder_push` and the man at its head crying out |
| `stoned` (first man) | `stone_men` |
| `breach-barricaded` / `barricade-broken` | hammering / splintering |
| `sally-out`, `surrender` | the garrison's charge horn and cry / the retire call |
| engine shots (`w.siege.shots`) | `trebuchet`/`mangonel` at the engine, `stone_fly` timed to end at the landing, then `stone_wall`/`stone_ground` at `w.siege.impacts` |
| siege towers / rams moving (polled) | `bed_belfry` emitters, level from their speed |
| mines being dug (`w.siege.works.mines`, digging/chamber) | `bed_mining` at the gallery's head |
| men on the wall-walks moving (`w.castleLevelH(i) > 2`) | `bed_wallwalk` instead of the turf march bed |
| blows, falls and kills on a castle | played at the man's level height; in a gate passage with the passage's echo; a `fall` kill is a body hitting the ground from height |
| `w.siegeWar` (SIEGE-MODE) phase invest/siege | `bed_camp` (non-positional, louder near `G.camp`, faint from the walls); a jump of `w.time` (days passed) swells it and scatters hammers, horses and axes round the camp |
| `G.assault.on` rising | `assault_trumpets` at the camp, the host's horns, the castle's bell, the war cry; `inside` → the cry in the bailey; `keep` → the garrison's rally horn |
| no siege mode, `escalade` | `assault_trumpets` once per 90 s from the side going in |

### Inside the walls (the enclosure)

Four times a second siege.js asks: is the ear inside a tower, the gatehouse, the keep or a bailey building (its
footprint, below its top)? Is the lord (third-person view) standing in one? Or is the RTS camera zoomed in (< 60 m)
looking into one that CASTLE-RENDER has cut away (`castles.stats().cut`)? Then `engine.setEnclosure(k, room, r)`:
sounds within r of the ear excite that room's reverb (`hall`, or `passage` below the gatehouse's wall-walk), sounds
outside the walls are low-passed toward 700 Hz and 9 dB down, the beds likewise, and the open vale's reverb drops to
20 %. k glides (0.4 s), so walking in and out is a smooth change. Room convolvers are made on first use: a battle
with no castle never creates one.

## Cost

All pre-rendered; no per-frame synthesis. Three new looped-emitter layers (belfry ×2, mining ×2, wall-walk ×3) that
start lazily and stop when unused; one camp bed; at most two extra ConvolverNodes, created only once a castle is in
play. One-shots go through the engine's 32-voice pool with per-sound limits (a tower collapse: 1 at a time; drops:
4; the trumpets: 1 per 5 s). The wall-walk test runs in the density scan (4 Hz) only for moving men within 180 m of
the ear and only when `w.castles` exists. The bank grew ~1.6 MB (camp bed 24 s stereo is the largest).

## Verification

- `python3 tools/audio/render.py --wav <names>` renders; `python3 tools/audio/check_siege.py` measures every siege
  WAV — length, sample/true peak, clipping, DC, loudness, spectral centroid, octave bands — and runs design checks
  (the fragments' band is audible after a masonry crack; earth has no ring; mines have nothing above 700 Hz; the
  sling snap and the counterweight thud are where the renderer's arm puts them; the stone's whoosh crescendos; the
  tower collapse is long with a sub rumble; the IRs' RT60) and draws a spectrogram sheet
  (`status/audio/siege_sheet.png`). All 59 files: no clipping, true peak ≤ -1.1 dBTP, all checks pass.
- `tools/heavy.sh node tools/audio-siege.mjs` plays the real game headless:
  A. `?demo=siege-engines&wall=stone_wall`: the sim's own trebuchet, mangonel, ram, belfry and escalade — trebuchet,
     mangonel, stone flights and impacts, drops from the wall and the belfry bed all heard; 30 s recorded, no clipping.
  B. `?demo=castle` (castle.js): each SIEGE-MECH event injected through the real handlers (`battle.inject`) plays its
     sound (15/15 and a stone flight); the camera in the keep → enclosure 1, the hall's reverb, vale reverb at 20 %;
     back out → 0; a SIEGE-MODE stand-in lets days pass (the camp bed, hammers, horses) and sounds the assault
     (trumpets, horns, bell, cry). No page exceptions. Recordings in `status/audio/siege_*.wav` with analyze.py
     reports.
- `tools/audio-render.mjs` (the battle mix) unchanged: no clipping.

  The camera in the keep → enclosure 1, `hall` (cut `keep@1`); at the gatehouse, low → enclosure 1, `passage` (cut
  `gatehouse@0`).

Not done / for later: a listening-post perspective for mines (the defenders hearing the picks through the wall
foot) uses the same positional bed; per-material footsteps inside towers (timber floors) use the stone steps.
