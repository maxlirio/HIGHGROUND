# Castles you go inside — the overnight plan and the shared contract (2026-09-28)

The owner, going to bed: "implement realistic sieges and castles that you actually get to go inside and fight
through, walls you break down, basically a full siege experience that is actually really realistic… I want the
siege to actually have a castle you GO inside, not just a building you burn down."

So: a CASTLE is a place, not a building. Curtain walls with a wall-walk men stand and fight on, towers you climb,
a gatehouse with a passage, portcullis and gates, a bailey (courtyard) with its buildings, and a keep with floors —
the last refuge. Attackers invest it, bombard and mine it, batter the gate, go up ladders and siege towers, pour into
breaches, fight along the walls, through the gate passage, across the bailey and up into the keep. It must be
realistic (docs/siege-research.md; extend it with sources) and run on an ordinary laptop.

Everything already in the game stays and is built on: js/sim/siege.js (engines, escalade, wall modules `b.mods`,
breaches, gates, barriers), js/sim/features.js (wall features, gateGeom), js/sim/navblock.js, the two clocks
(structural work on the economic clock, men on the tactical clock — read the header of siege.js), docs/siege-art-
contract.md. Read those first.

## 1. The world gets LEVELS (owner of this section: CASTLE-SIM)

A soldier has a level `S.lvl` (Uint8, new field in soldiers.js FIELDS_U8): 0 = the ground; ≥1 = a walkable structure
surface above the ground. His height above the terrain is `levelHeight(w, i)` (castle.js), not a constant per
level: a wall-walk is ~7–9 m up, a tower top ~12–15 m, keep floors at their storeys. x,y stay 2-D map coordinates.

- `js/sim/castle.js` (NEW, CASTLE-SIM owns): the castle data model and the level/nav layer.
  - `w.castles = [castle]`; `castle = { id, team, name, parts: [...], walkways: graph, links: [...], keep, bailey }`.
  - parts: `{ id, kind: 'curtain'|'tower'|'gatehouse'|'keep'|'hall'|'chapel'|'stable'|'well'|'postern', ... }`.
    Curtains are segments (x0,y0,x1,y1, thickness ~2–3 m, height, walkH = wall-walk height, parapet with crenels);
    towers are round or square (x, y, r|w,h, floors [{h}], top h); gatehouse = passage (width, length, floors,
    portcullis ×2, gate leaves, murder holes); keep = footprint + storeys (ground floor store, first-floor entrance
    by a forebuilding stair, hall, upper chamber, roof/battlements).
  - every curtain and tower is ALSO the existing siege-system building with `b.mods` (6 m modules) so bombardment,
    breaching and repair keep working; castle.js maps parts ↔ buildings (`part.bid`).
  - WALKWAYS: a graph of polylines per level surface (wall-walks along curtains, through or around towers, tower
    floors, gatehouse chamber, keep floors). Men on level ≥1 move ALONG this graph: their position is snapped to the
    walkway (width ~2 m), their path is found on it (`castlePath(w, i, tx, ty, tlvl)`).
  - LINKS between levels (the only ways up and down): tower stairs (spiral, one man abreast — a real choke point),
    gatehouse stair, keep forebuilding stair and internal stairs, LADDERS (escalade, siege.js), SIEGE-TOWER bridges,
    and BREACHES (a module at 0 → a rubble slope: its top joins the wall-walk to the ground outside and inside).
    `link = { kind, a: {lvl, x, y}, b: {lvl, x, y}, width (men abreast), speed, blocked? }`.
  - `castleSystem(w)`: moves men on levels ≥1 (walkway steering, one man abreast on stairs), handles link traversal
    (queueing at stairs/ladders), gates open/shut, and exposes queries:
    `levelOf(i)`, `levelHeight(w,i)`, `sameLevel(i,o)`, `coverFor(w, i, fromX, fromY)` (crenels/arrow slits: hard
    cover for a man on a wall-walk against missiles from below, none against men on the same walk),
    `insideCastle(w, x, y)` (the bailey), `castleAt(w,x,y)`.
- Everything that looks for neighbours must respect levels: melee (combat.js perceive/meleeTick/contact), the
  separation push (world.bodyPush), cavalry, morale's "friends near". RULE: two men interact bodily only if on the
  SAME level, or one is at the top of a link (ladder head, breach crest, stair head) and the other at its foot.
  Missiles cross levels (ballistics: shooters on walls get height; targets on walls get crenel cover).
  CASTLE-SIM makes these changes in world.js/combat.js with small, surgical guards and keeps the combat calibration
  (`tools/heavy.sh node tools/battle-mc.mjs`) unchanged — none of the calibration scenarios have castles.
- Formation slots of a unit on a wall-walk lie ALONG the walk (a file of men manning a stretch of wall), not in a block.

### 1.1 What CASTLE-SIM built (js/sim/castle.js — the API is documented at the top of the file; tests: tools/castle-test.mjs)

- `castleFromLayout(w, "hill"|"concentric"|"river", { x, y, team, facing })` (also `(w, layout, team, {x, y, facing})`)
  → castle in `w.castles`; `CASTLE_LAYOUTS` (name, note); `castleSite(map, layout)`. It registers the siege.js
  buildings (curtains: `stone_wall` with `featType: "curtain_wall"`, `wallH/walkH/wallTh`; towers: kind `"tower"`
  (econ-data, prebuiltOnly) with `b.r`, one module; gatehouses: `"gatehouse"` with `gx1..gy2`), adds the ditch/moat
  features (`src: "building"`, so the coarse nav ignores them; castle.js's own 1 m grid does not), installs the hooks
  and appends `siegeSystem` (if missing) and `castleSystem` (always LAST) to `w.systems`. Also sets `w.castleApi`.
- Parts carry what §1–§4 asked for (curtain `th, h, walkH, walkLvl, bid, mods, ring`; tower `r, h, floors, walkH,
  topLvl, bid, stairs`; gatehouse `rot, w, d, passage, pw, R, b0, b1, floors, portcullis, portcullises[{x,y,outer}],
  murderHoles[{x,y}], machicolated, bid`; keep `rot, w, d, floors, fore, lvls, rooms, stairs`; bailey buildings
  `rot, w, d`; well `r`; `postern` {x, y, nx, ny, open, link, sub: postern|watergate}; `ditch`/`moat` {segs, width}).
  Every part has `ground` (rock/earth/clay) for mining.
- LEVELS: 0 ground · 1 wall-walks, tower rooms at walk level, gatehouse chamber · 2 tower tops, gatehouse roof ·
  3/4/5 keep hall/chamber/roof. `levelHeight(w, i)` is O(1) and valid for EVERY man (a man low on a stair is still
  level 0 but already metres up): renderers should call it for all men, not only `S.lvl > 0`.
- LINKS: `{ kind, a, b, c?, width, speed (m/s ALONG the link), len?, head?, team?, managed?, blocked? }`. castle.js
  paths and traverses every link except `managed: "siege"` ones (siege.js climbs those; castle.js keeps the men who
  arrive on the walk). A breach's `c` (inner foot) gives it two traversable halves. A walk edge over a breached module
  (b.mods[k] ≤ 0) is cut; a fallen tower's rooms, top and stairs go; a man standing on something that has gone is
  put on the ground. Posterns/water gates are `door` links, blocked unless `part.open` (`setPostern(w, castle, open)`).
- ORDERS (`issueOrder`): `man_walls` {x, y, castle?, instant?} · `keep` {castle?} (no point needed) · `castle_move`
  {x, y, lvl?} · and ordinary `move`/`assault`/`hold`/`charge` into, within or out of a castle are routed through its
  gates, breaches and stairs (an assault retargets the nearest enemy near its point every 5 s, on any level). A body
  far outside marches up by the ordinary road first. Horses never take stairs or ladders.
- siege.js edits (with SIEGE-MECH's blessing implied by §4.1's contract): barrierResolve skips men on levels; a
  castle gate's "inside" is toward `castleAt` (the garrison has no town), which had let attackers standing outside
  the gate "lift the bar".
- Measured (castle-test): stair → walk → along 16 m in 61 s; 40 archers man 47 m of wall in 80 s; a breach passes 24
  of 30 in 79 s (across a 10 m dry ditch); a shut gate holds, an opened one passes 28/30 in 8 s; 28/30 into the keep
  from 70 m outside in 119 s; a storm of 2,100 men (737 up on levels, 137 in melee) at 2.2 ms/tick.

### 1.2 Go anywhere (CASTLE-ANYWHERE, 2026-09-29)

The owner: "Is it made so that you can go anywhere? Like you can put a ladder up the side and then sit in a tower with
archers?" — now yes, on both sides and in any mode with a castle.
- CLICK A PLACE (js/ui/castle-orders.js, hooked into main.js `openOrdersAt` and the pointer hover): the click is a ray
  from the camera (`castleRayPick`: the first tower / curtain / gatehouse / keep surface it meets, else the ground) and
  `castlePlace(w, x, y, hit)` → `{ kind: tower|walk|gatehouse|keep|breach|bailey, part, lvl, x, y, h, cap, label }`.
  The popup gets a section titled by the place ("Tower top · 13.5 m · 8 men fit", also the hover hint) with the fitting
  orders — "Man this tower", "Up onto the wall here", "Into the gatehouse", "Hold the keep roof" / "Hold the hall",
  "Go here" — each a `castle_move { x, y, lvl }` offered only when a selected company has a way there (`castlePath`);
  outside with no way up, "Ladders to this tower". A right-drag's facing is kept (`faceSet`); else they face the parapet.
- CAPACITY: `topCap(part)` — a tower top holds its floor inside the parapet ÷ 3.5 m² (8 on a main tower, 3 on a small
  outer one); a gatehouse roof likewise. `castle_move` to a tower top fills a ring of places at the battlements facing
  out, then the room at walk level (the stair head), then the wall-walk beside it; a keep floor overflows to the next.
- CHOKE POINTS: on a one-man flight (spiral stair, ladder) nobody passes the man ahead going the same way, so a man
  stopped fighting at the stair head holds the file behind him on the stair (they stand and get their wind); a fight
  with a man on a stair or ladder is fought out (combat.js: flurry while both have the wind). Enemy-held walks and
  towers are routed through, not refused: the men walk on and fight whoever is in the way.
- LADDERS (siege.js): escalade at a TOWER (a click on it) goes to its top with long ladders if the top is ≤ 12 m
  (`LAD.maxH`; a concentric castle's outer towers, 11 m) — a slower climb, readier to be thrown down — and a higher one
  is refused: "too high for ladders (13.5 m): take the wall beside it and go in by the tower's door". A click on a
  gatehouse's own flank goes to the curtain beside it. Ladder feet go only where the ground is open (not in a tower's
  or gatehouse's masonry, not in water, not across a wet moat — "fill it first"). Men stepping up to a ladder go round a
  tower that stands out beside it (`groundToward`). A body over the wall by ladders given a new order leaves its ladders
  standing as ordinary ladder links (`releaseEscalade`) that the rest climb. Stormers (assault / escalade) go down into a
  castle's dry ditch and up the other side instead of casting about for a way round (world.js).
- FLANKING FIRE (ballistics.js ← castle.js `aimBias`): bows on a tower or gatehouse prefer stormers under the curtain
  beside them; bows on the walk are less keen on men right under their own stretch.
- AI (siege-ai.js `TOWERS`): the garrison splits a tower-top's worth of bows onto each of the two towers flanking the
  threatened stretch (`towerBows`); a storming party that has gained the wall-walk clears the nearest enemy-held tower
  (`clearTowers`) before it goes on into the bailey.
- Tests: castle-test 10–14 (tower-top archers: level, room, shooting, flanking; ladder → walk → tower stair → top taken;
  low tower escalade yes / high no; a ladder at every stretch and beside every gatehouse of all three layouts, refused
  only for water; the click picks the place). Stair fights are slow: four levy on a tower top against a file of
  men-at-arms coming up one at a time last ~3 minutes; six can hold it far longer.

## 2. The art (owner: CASTLE-ART, Blender, assets/src/castle/*)

A modular castle kit authored as headless Blender Python (the art bible and pipeline: docs/art-bible.md,
assets/src/_lib.py, tools/booth.py; nothing downloaded). Pieces fit a 1 m grid and the dimensions in §1:
curtain straight/corner (with a walkable wall-walk surface, parapet, merlons and crenels, arrow loops), round
and square towers (open top with battlements; floors inside; a door onto each wall-walk), gatehouse (twin towers,
arched passage, portcullis mesh, gate leaves, murder-hole slots), keep (square great tower ~20×20×25 m, forebuilding
stair), bailey buildings (great hall, chapel, stables, well, kitchen), hoardings (timber galleries on the parapet),
and DAMAGE states for curtain modules and towers: pocked, cracked, breached (a gap with a rubble cone either side —
the rubble slope men climb), collapsed tower (mined). INTERIORS must be real where men go: tower floors, the
gatehouse chamber, keep storeys — with roofs/upper floors that the renderer can hide (separate meshes named
`roof`/`upper_N`). LODs as usual; texel density and poly budgets per the art bible. Photo-booth renders reviewed.
Output assets/glb/castle_*.glb + a manifest assets/castle-kit.json (piece name → dims, walk surfaces, door points,
link points) that castle.js and the renderer read.

### 2.1 What the kit provides (CASTLE-ART, as built — details in docs/siege-art-contract.md "Castle kit")

- NUMBERS match `DIMS` in js/sim/castle.js (source: assets/src/castle/_dims.py, copied into the manifest's `dims`):
  curtain classes main (walk 8, 2.6 thick), inner (walk 10, 3.0), outer (walk 5.5, 2.2), parapet top 2.5 m (outer
  2.0) above the walk; round towers r 5.5, floors [0, walk/2, walk, walk+5.5]; gatehouse 17 × 15, passage 3.4,
  floors [0, 8, 13.5]; keep 20 × 20, floors [0, 6, 13.5, 21], walls 3 m.
- MATERIALS: one shared tiling library, assets/tex/castle/<key>_{albedo,normal,rough}.jpg + <key>.json (tile_m) —
  ashlar, rubble, paving, planks, timber, slate, shingle, lead, plaster, iron, debris, earth (the renderer already
  loads these by name). Every GLB material is `castle_<key>` and points at those files by relative URI; UVs are metres
  / tile_m; COLOR_0 = AO × weathering (multiply; GLTFLoader enables vertexColors by itself).
- PIECES (assets/glb/castle_<name>.glb; full list with every number in the manifest `pieces`): curtain, curtain_b,
  curtain_inner, curtain_outer (+ `_pocked`, `_cracked`, `_breach`), curtain_stair (2 modules), postern (moving
  `door`), curtain_corner / _corner_in (+ damage), tower_round, tower_round_inner, tower_round_outer (+ `_pocked`,
  `_cracked`, `_collapsed`), gatehouse (+ `_pocked`, `_cracked`, `_ruin`; moving `portcullis_outer`,
  `portcullis_inner`, `gate_l`, `gate_r`), and the keep, bailey buildings, hoardings and ditch as they land.
- NODES: static parts `<part>_LOD0/_LOD1` with part = `base`, `upper_<n>` (storey n: its floor and its walls),
  `roof` (roofs/top/battlements). To look into storey n hide `roof` and every `upper_m*` with m > n. Moving nodes have
  no LOD suffix and their origin is the pivot (rest pose closed/down).
- FRAMES: curtains run x −3..3 (ports), outer face −y. Towers: origin = centre, +y must point INTO the castle (rotate
  it to the inward bisector); the walk-level wall is 24 sectors `upper_2_wKK` / door variants `upper_2_dKK` — show
  the door sector nearest each curtain's walk (manifest `sockets` has bearings and door points). Mid-curtain towers
  (r 4.95): scale x,y by r/5.5. Gatehouse: x along the curtain, outside −y (sim +b = −y).
- LEVEL DATA per piece: `walks` (strips / polygons / circles with z and a suggested lvl), `doors`, `links` (stairs
  with foot/head points, breach slopes with crest, scrambles), `ladders` (crenel sill + foot), `parapet.crenels`,
  `loops`, `hoarding_sockets`.

## 3. The render (owner: CASTLE-RENDER, js/render/castle.js)

Builds a castle from `w.castles` + the kit manifest (instanced pieces, damage states swapped per module from
`b.mods`), draws men at their level height (figures.js reads `levelHeight` — a small hook), rubble and dust when a
module falls, the portcullis/gates moving, ladders and tower bridges (siege engines already render in engines.js).
GOING INSIDE: when the camera is close and inside/over a tower, the gatehouse or the keep, its roof and the storeys
above the one in view fade out (cut-away), so you watch the fight on the stairs and floors; the Lord's view (the
player's avatar) walks in and the roof lifts. Performance: pieces instanced, cut-away by material opacity/visibility,
no per-frame allocations.

### 3.1 What the renderer reads and provides (CASTLE-RENDER, as built)

- `makeCastles(scene, map, fx)` (main.js makes it after the engines; `castles.update(w, camera, dt)` runs every frame
  BEFORE `figures.update`). `?demo=castle` (js/render/castle-demo.js) puts a castle on the vale with men on the walls,
  in a tower and the keep, an assault at a breach and an escalade; `&look=wide|medium|close|breach|keep|tower|gate|ladders`.
  It uses `CS.castleFromLayout` when js/sim/castle.js has it, else a fallback layout of the same shape (real
  stone_wall / gatehouse buildings, so siege.js works on it).
- READS, per castle: `parts[]` with `kind`, `id`, `bid`; curtains `x0,y0,x1,y1` (or `x1..y2`), `thick|th` (2.8),
  `walkH` (8), `hoarding?`; towers `x,y`, `r` (round) or `w,h` + `rot` (square), `floors` (floor heights above the
  ground, e.g. `[0, 4.2, 8, 12]` — the last one is the open top; `[{h}]` or storey heights also accepted);
  gatehouse `x,y,rot` (along the curtain), `w,d`, `passage`, `floors`; keep `x,y,w,h,rot,floors` (`[0,6,13.5,20]`,
  last = roof walk), `forebuilding` (default on); `hall|chapel|stable|kitchen` `x,y,w,h,rot`; `well` `x,y,r`.
  `castle.bailey.{x,y}` (or the keep) says which way is IN. Numbers default to CASTLE-ART's `_dims.py`.
- DAMAGE: curtains per module from `b.mstate[k]` (siege.js; else from `b.mods`/hpMax): 1 pocked, 2 cracked (parapet
  knocked about), 3 breach (a gap: stump + rubble slope both sides, ragged neighbours). Towers/keep: `b.mstate[0]` or
  hp; `b.ruin` → a stump and a heap. A module/tower that falls throws dust (fx.dust) and stones.
  Gate: `b.shut`, `b.portDown` (outer portcullis), `b.gl` / `b.gpc` (leaves / portcullis left) — the portcullis drops
  fast and is wound up slowly; broken leaves hang askew.
- PROVIDES (installed on `w` by `update`): `w.castleLevelH(i)` = metres above the terrain for man i — figures.js adds it
  (one line). It is `levelHeight(w, i)` from js/sim/castle.js when S.lvl ≠ 0 (CASTLE-SIM: export `levelHeight`, height
  above the terrain under the man); `w.castleDemoH` overrides it for pinned demo men. `w.castleWallAt(x, y)` →
  `[walkH, halfThickness]` of the curtain there, or null — engines.js lands ladder heads on the parapet at the walk and
  tilts a siege tower's bridge to meet it. `w.castleBids` — building ids the castle draws (buildings.js skips them).
  `castles.hides(w, i)` — men above a cut-away storey are not drawn.
- CUT-AWAY: a part is cut when the RTS camera's target is inside its footprint within 170 m, when the lord (third-person
  view) stands in it, or when the camera itself is inside it. The storey in view: the lord's own; else the storey with
  the most men fighting (then the most men); an open top needs no cut; PageUp / PageDown step it by hand. Layers above
  fade out over 0.3 s (opacity, then hidden); an uncut part draws as one merged mesh per material.
- THE KIT (js/render/castle-kit.js, 2026-09-29): every part is drawn from CASTLE-ART's pieces once they have loaded
  (the procedural builders stay as the fallback, and draw ditches/moats — the terrain is not carved). Loaded only when a
  castle exists; the GLBs' texture URIs are stubbed and their `castle_<key>` materials replaced by one shared material
  per key, so the ~21 MB library is fetched and uploaded once. Curtain modules (class by walkH: main / inner / outer;
  `curtain` / `curtain_b` variety; damage state per module; `postern` where castle.js puts one; hoardings when
  `part.hoard`) are INSTANCED castle-wide with per-module LOD (150 m). Towers (+y along the inward bisector, doorway
  sector nearest each curtain end, x/y scaled r/5.5 or w/10), gatehouse (rot + π: kit −y = sim +b; x/y scaled w/17,
  d/15; portcullises lift 5.2 m on the manifest pivots, leaves ±90°), keep (rot + side·90°, forebuilding toward the
  bailey), hall/chapel/kitchen/stable/well (scaled to w, d): merged castle-wide per material per LOD with a per-vertex
  part id; a part's LOD and cut-away are flags the vertex shader reads (no re-merge). Cut-away with the kit: `roof` and
  `upper_m` (m > k) fade, and the storey in view is sectioned by an animated clipping plane 1.6 m over its floor
  (`renderer.localClippingEnabled`). Hill castle ≈ 180k tris / ~36 draws, concentric ≈ 350k / ~31 (+ gate parts).

## 4. The siege (owner: SIEGE-MECH, js/sim/siege.js — extends what is there)

Realistic, researched (append sources to docs/siege-research.md): investment; bombardment of chosen wall modules
(trebuchet/mangonel damage → pocked → cracked → breach, on the economic clock as today); MINING — attackers dig a
gallery from cover to under a tower or curtain (days of econ time), prop it, fire the props → the section collapses
into a breach; defenders COUNTERMINE (listening, a counter-gallery, a fight underground as an abstracted event);
the RAM and fire at the gate; the portcullis; murder holes and machicolations/hoardings (stones and hot sand dropped
on men at the wall foot — real, not boiling-oil theatre); escalade onto the wall-walk via the level links (ladders
pushed off, men fighting at the ladder head); siege towers docking their bridge onto a walkway; breaches as rubble
slopes men climb under fire; defenders plug a breach with a barricade (work) and repair between assaults; sallies
from a postern; surrender terms and starvation (food stock in the castle → days; a garrison may yield — the owner
likes realism). Hook into castle.js links (ladder, tower bridge, breach) — do not duplicate the level system.

### 4.1 What SIEGE-MECH built (siege.js + NEW js/sim/siege-works.js; numbers: siege-research.md §9–§16)

All structural work (bombardment, mining, countermining, barricade building, repair, starvation, surrender) runs on
the econ clock inside `siegeSystem`, so `passDays` (siegeSystem alone) works. Fighting things (gate fire, drops,
murder holes, pulling a barricade down, sallies) run on the battle clock.

ORDERS (`issueOrder(w, ids, order)`; siege.js takes them through `w.siegeOrder`; any other order cancels a unit's work):
| kind | who | fields | what |
|---|---|---|---|
| `bombard` | trebuchet / mangonel / springald | `x, y, bid?, k?` | a wall MODULE (`bid` + `k`, else the standing module nearest x,y), a TOWER (`bid` of a tower part), a gate, building or engine |
| `batter` | ram | `x, y, bid?` | a gate (leaves, then portcullis), wall or tower |
| `advance` | siege tower | `x, y` | to the wall; docked → a `bridge` link |
| `assemble` | packed trebuchet | `x, y, facing` | frame it up there |
| `escalade` | foot | `x, y, then?` | ladders (each raised ladder = a `ladder` link) or up a docked tower |
| `mine` | foot (attackers) | `x, y, bid?, k?, from?:{x,y}` | a gallery from `from` (else 40 m out) to under that module/tower; props fired; falls |
| `countermine` | foot (defenders) | `x, y` | a listening post there; a mine heard is met by a counter-gallery |
| `fire-gate` | foot (attackers) | `x, y, bid?` | pile brushwood against the gate and fire it |
| `barricade` | foot (defenders) | `x, y, bid?, k?` | a retrenchment across the breach there (only while no enemy within 25 m) |
| `repair` | foot (defenders) | `x, y, bid?, k?` | rebuild the worst module of that wall/tower (only while no enemy within 60 m) |
| `sally` | foot (defenders) | `x, y` | out by the postern (a castle part `kind: "postern"` or a building flagged `postern`) or the gate, fire the engine nearest x,y, come back |
| `crew` | foot | `x, y` | man an abandoned engine |
`engineOrders(w, units)` lists them for the popup (castle works carry `side: "attack" | "defend"`).

CALLS: `SG.setProvisions(w, { team, days | manDays, resolve?, auto? })` → hold; `SG.offerRespite(w, team, days)`;
`SG.surrender(w, hold, gar, why)` (siege-war.js may judge terms itself: pass `auto: false` and call it);
`SG.yieldHazard`, `SG.foodDays`, `SG.garrison(w, team)`, `SG.worksInfo(w, team)` (mines with %, barricades, the
hold's food/days); `SG.MINE`, `SG.WORKS` (the numbers); `SG.startMine` etc. are exported for feature tests;
`SG.moduleState` = `b.mstate[k]` (0 intact, 1 pocked, 2 cracked, 3 breach); `SG.useCastle(CSmodule)` — whoever
loads castle.js passes it once (until siege.js can import it statically), or castle.js sets `w.castleApi`.

FROM CASTLE-SIM I use: `w.castles[].parts[]` (`kind`, `bid`, optional `walkLvl` (default 1), `ground`
("earth"|"chalk"|"clay"|"rock", default earth), `hoard`/`machicolated`, `murderHoles`, `portcullis` count, tower `r`
or `w/h`, `h`), `castle.links` and `addLink(w, castle, link)` / `removeLink(w, castle, link)` (fallback: push/splice
`castle.links`), `insideCastle(w, x, y)`, `castleAt(w, x, y)`, and `S.lvl`. Links I add: `ladder` (width 1,
`managed: "siege"` — siege.js moves the climber and resolves the fight at the head; castle.js draws/paths it),
`bridge` (a docked tower, 3 abreast, managed), `breach` (`a` ground outside, `b` crest on the walk level, `c` ground
inside; 3 abreast, speed 0.35; castle.js traverses it normally). A tower part's building falls entire when mined
(event `tower-collapsed`, the building `ruin`) — castle.js should cut its walkway and treat it as a breach.

EVENTS (all in `w.events`, for the renderer/UI/audio): `wall-state` {building, mod, state, was, x, y, tower} ·
`wall-breached` {building, mod, x, y, cause: shot|ram|mine} · `tower-collapsed` {building, x, y, cause} ·
`mine-started` {mine, building, mod, x, y, len, tower} · `mine-under` · `mine-fired` {x, y} · `mine-collapse`
{building, mod, x, y, tower, full} · `mine-detected` (to the defenders) · `countermine-post` · `countermine-started`
· `countermine-broke-in` · `mine-fight` {attackersDead, defendersDead, won} · `mine-lost` · `mine-abandoned` ·
`portcullis-dropped` / `portcullis-raised` {building, x, y} · `gate-leaves-broken` {cause, portcullis} ·
`portcullis-broken` · `gate-broken` · `gate-repaired` · `gate-fire-laid` · `gate-fired` · `gate-fire-out` ·
`dropped` {who, by, cause: murder-hole|machicolation|parapet, what: stone|sand} · `ladder-pushed` {x, y, broken} ·
`breach-barricaded` {barricade, building, mod, x, y} · `barricade-broken` · `breach-repaired` · `repaired` ·
`sally-out` {by: postern|gate} · `sally-back` {why} · `sally-in` {left, lost} · `garrison-starving` · `respite`
{days, until} · `relieved` · `surrender` {team, castle, why: starvation|terms|respite, terms: honours|lives, garrison, day}.
Kills carry `cause`: "mine", "murder-hole", "machicolation", "parapet", "…-sand", "hunger".

## 5. The mode (owner: SIEGE-MODE, js/ui/siege-*.js + js/sim/siege-ai.js + main.js glue)

`?mode=siege`: a siege setup screen like the battle setup (js/ui/battle-setup.js): choose a castle (2–3 designs
generated by castle.js from layouts: a hill castle with a keep and one curtain; a concentric castle with two
curtains; a river castle with a water gate), your side (attack or defend), the forces, the season (food), and go.
The siege runs with the two clocks: the player can let days pass (structural time: bombardment, mining, repair,
starvation) and then fight the assaults in real time. Attacker AI (invest, bombard a chosen section, mine a tower,
prepare ladders/tower, assault in waves at breach + gate + escalade, feint) and defender AI (man the threatened
walls, reserve to the breach, barricade, sally against engines, counter-mine, fall back to the keep, yield on terms).
UI: orders for siege (bombard this section, mine here, build ladders/tower/ram, assault breach/gate/escalade,
man the walls, hold the breach, fall back to the keep, sally), the castle state (sections, food, mines), and an end
screen. The Lord (avatar) can lead an assault up a ladder or into a breach. Also reachable from the campaign later.

### 5.1 What SIEGE-MODE calls (so the other lanes can match it — every call has a fallback, the mode never crashes)

Files: `js/sim/siege-war.js` (NEW, headless: setup, the phases, the two clocks, food, outcome — like battle.js is to
battle-run.js), `js/sim/siege-ai.js` (both sides), `js/ui/siege-setup.js`, `js/ui/siege-run.js`, `css/siege.css`,
`tools/siege-run.mjs` (AI-vs-AI harness), the `?mode=siege` glue in main.js, the "Lay siege ⚔" button in match-ui.js.

From CASTLE-SIM (`js/sim/castle.js`), read through `import * as CS` and feature-tested (`CS.castleFromLayout?.(…)`):
- `castleFromLayout(w, layout, { x, y, team, facing })` → castle (also in `w.castles`). `layout` ∈ `"hill" | "concentric" |
  "river"`; `facing` = the bearing (rad, sim x/y) from the castle toward where the besiegers come from — the gate
  should face roughly that way. Optional `CASTLE_LAYOUTS = { hill: { name, note }, … }` for the setup screen, and
  optional `castleSite(map, layout)` → `{ x, y, facing }` (else SIEGE-MODE picks a site itself: a hilltop / a river
  bank / open ground, ≥ 800 m from the towns).
- I read: `castle.parts[]` (`kind`, `bid` → the siege.js building, `id`), `castle.keep` (`x, y`, `bid`?),
  `castle.bailey` (`x, y, r` or a polygon), `insideCastle(w, x, y)`.
- Orders, if castle.js registers them (`issueOrder` kinds): `{ kind: "man_walls", x, y, castle, part? }` ("man the
  walls" from the nearest stair onto the wall-walk by (x, y)) and `{ kind: "keep", castle }` ("go to the keep").
  Fallback: the garrison stands just inside the curtain (ground level), or in a block at the keep.
- The Lord on levels: I issue him ordinary orders (escalade / assault / keep); whatever castle.js does for levels he gets.

From SIEGE-MECH (`js/sim/siege.js`), read through `import * as SG`:
- DAYS PASS by calling `siegeSystem(w)` alone with `w.tick`/`w.time` advanced (`passDays` in siege-war.js): nobody
  walks, the engines work, stones land, the econ clock runs. So please keep ALL structural work (bombardment,
  mining, repair, barricades, starvation if you model it) inside `siegeSystem` on the econ clock, and make it
  tolerate 10 000+ back-to-back calls without `step()` in between (no reliance on `rebuildHash`-fresh neighbours
  for anything structural).
- Mining / countermining / barricade / sally: I issue `{ kind: "mine", x, y, bid? }`, `{ kind: "countermine", x, y }`,
  `{ kind: "barricade", x, y, bid? }`, `{ kind: "sally", x, y }` if `SG.MINE`/`SG.startMine` (etc.) exist; otherwise
  siege-war.js keeps an ABSTRACT mine (days of digging → the props fired → 1–2 modules down, with the defenders'
  chance to hear and break into it) and an abstract barricade/repair on the econ clock, and says so in the UI.
- Terms: `w.siege.terms` is not assumed; siege-war.js offers and judges terms itself (hope of relief, food, the
  breach, the garrison left).

### 5.2 What SIEGE-MODE built (as built, 2026-09-28 night)

- **Flow** (`G.phase`): invest → siege (days pass) ⇄ assault (real time) → inside (the bailey) → keep → end. The day is
  always `(w.time − G.t0) × 1.5/60`. Ends: `taken` (no defender left fighting / the keep stormed), `terms` (either
  side's herald accepted), `starved` (7 days without bread), `relieved` (the relief day reached), `abandoned`
  (3 assaults failed, the host < 1.3× the garrison, or the season spent). Hooks for the UI: `G.onNote`, `G.onTerms`,
  `G.onEnd`; headless: `G.ui.{wait, run, act, focus, fold, status, reckoning}` (js/ui/siege-run.js).
- **Days pass** = `siegeSystem` + siege-war's day work, tick by tick (400 ticks a day); a company on the move is
  *settled* at its destination at each day boundary (a castle.js body by re-issuing its order with `instant: true`),
  since nobody walks while days pass. Night sallies while days pass are resolved abstractly (siege-ai nightSally);
  sallies in real time are siege-works' `{ kind: "sally" }`.
- **Uses SIEGE-MECH's works** for mines (a 16-man company split off the foot), listening posts (8 men), barricades,
  repairs, sallies and provisions (`setProvisions` with `auto: false` — the outcome is judged once, in siege-war.js;
  on terms/starvation it calls `surrender()`).
- **Fill the moat** (new, siege-war.js `WORKS.fill`, 4 days): a river castle's wet moat before the target stretch is
  split round a 12 m causeway (the `moat` feature removed and re-added in two pieces). CASTLE-RENDER: the moat part's
  `segs` are not touched, so the water is still drawn over the causeway — please draw `G.fills` / the feature gap.
- **The lord** leads an assault (takeField near the camp, dismounted, then assault into the breach or escalade) or holds
  the keep (dismounted, `keep` order). Dismounting sets the household's `S.arm` to men-at-arms (cavalry.js reads
  `S.arm` for charges; with the knights' arm a dismounted household kept "recoiling" out of an assault).
- **Fallback castle** (no castle.js): the economy's own stone_wall/gatehouse buildings + a render description in
  `w.castles` (towers, gatehouse, keep, hall, chapel, well) so render/castle.js draws it; the keep is a walled square
  with a timber door.
- Requests: SIEGE-MECH — a repair party on a *breached* module stands it up again after one tick of work
  (`breach-repaired` at once); siege-ai now calls repairs off while a breach is open, but the rule would be better in
  siege-works (e.g. a module must be rebuilt past ~30 % before its line closes). AVATAR/UI — the lord's "yields" overlay
  draws above `#modal`. (Both done: §5.3.)

### 5.3 SIEGE-POLISH (2026-09-29 night): what changed, and what is still open

- **Repair** (siege-works.js `repairTick`): a breached module stays a breach until its gap is walled up —
  `WORKS.rebuildShare` (25 %) of its build labour, progress in `b.rebuild[k]` (0..1, `rebuildProg`), standing again at
  `WORKS.rebuildStand` (35 %) of its strength; paused (not lost) while an enemy is within 60 m or the party is called
  off. siege-ai walls up a breach once its barricade stands. siege-test band "breach walled up by 40 men" (2.5–8 d).
- **Yielding** (siege-war.js `hopeless`, `answerTerms`): the law of arms (siege-research §23). A strong garrison
  (≥ 35 % of its men free) with its keep whole does not treat once the enemy is inside — it falls back; the keep holds
  out for minutes of battle time (0.07/min) unless its door/wall is forced; `G.temper` (drawn once) varies the constable.
  Terms granted after the walls are stormed are "taken" (prisoners), a keep yielding is "terms" for their lives.
  AI-vs-AI outcomes now mix taken / keep stormed / keep yielded / terms / abandoned.
- **Night sallies** (siege-ai.js `sallyOdds`, `SALLY`): guard size, distance from the postern, moon phase, weather,
  the camp's alert after the last sally; reaching the engine, 35 % the guard beats the fire out (scorched).
- **Engines** (siege.js `engCond`): a damaged engine works at 0.15 + 0.85 × its strength (none while burning); its
  carpenters mend 20 %/day from a day after a fire is out.
- **Ladders**: the climb is to the castle part's `walkH` (8 m), not the feature height; climbers rise on the ladder
  (`w.siege.climbH`, read by render/castle.js `castleLevelH`) along its lean; they queue at the rendered foot; ladders
  are not drawn at the wall while still being carried up. render/castle.js reads `levelHeight` for every man.
- **Storm**: `SW.formUp` — the stormers (and the lord leading them) are drawn up on a start line 95 m before their
  objective when the assault is sounded (was a 6-minute walk from the camp). New orders: "Send in the reserve",
  "Storm the keep" (`siegeCommand` `reserve` / `stormKeep`).
- **Morale in a castle storm** (morale.js, combat.js — surgical, only when `w.castles` exist): a man on the ground reckons
  flank/rear threats only from enemies on the ground on his side of the curtain (`cs.gnd`, `insideCastle`); approach
  shock only from bodies on his level and side. Stormers had been breaking under "flank" stress from the defenders on
  the wall-walk above them (siege-run `--assaults` prints the stress sources per assault).
- UI/render: no "Battle at…" in a siege (the captains' watch is off); lord's card under `#modal` and not shown for a
  garrison marching out on terms; `.lordlab[hidden]` (the lord's name had stuck on screen); filled moat drawn as a
  causeway (`part.fills`); portcullis/leaves cut away with their storey; chronicle clear of the View panel; the vills'
  own siege logic (logistics `siegeState`, "Rookham under siege") off in siege mode; castle.js `castleSite` margin 560
  (the hill castle had been at x 3580 — the camera cannot centre past 3550).
- OPEN / requests:
  - world.js (uncommitted change by another lane: alternating unit move order) makes siege-test C "by a docked tower"
    0.00 (0.33 with HEAD's world.js). Whoever owns it: please re-check that band before committing.
  - castle-test 7 (perf storm) now ~5.4–5.9 ms/tick (> 4.5): the storm no longer breaks at the wall, so ~220 men are
    in melee at the breach and `bodyPush` is 25 % of the tick. CASTLE-SIM: bodyPush in dense castle crowds.
  - "crush" deaths at a breach run 10–28 per storm; plausible for a jammed breach but worth a look.
  - Storming the keep is slow (the forebuilding stair is one man abreast): a keep with 20–30 men can hold minutes.
  - The camera can go inside masonry when zoomed right against a tower (camera.js has only the terrain check).


- Build on the repo as it is; small surgical edits to shared files (world.js, combat.js, figures.js, main.js),
  each owner stays in its lane; coordinate through this document — if an interface must change, edit §1–5 here and
  say so in the commit message.
- Deterministic sim (w.rng only), buildless ES modules, no downloaded assets, laptop performance (tools/perf.mjs
  ≤ 6 ms/tick with 3,000 men; add a castle perf case).
- HEAVY WORK ONLY THROUGH `tools/heavy.sh <cmd>` (Blender with `-t 2`, sims, battle-mc, headless Chrome) — at most
  3 heavy jobs machine-wide. Never background heavy jobs. The owner's machine must stay usable.
- Verify visually (tools/battle-shots.mjs; Read the PNGs); technical checks never count as done.
- Commit your own files with path-limited adds, messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  The lead deploys.
