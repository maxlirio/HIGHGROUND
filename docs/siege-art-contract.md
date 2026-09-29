# Siege engines: art contract (systems → art)

What `js/render/engines.js` needs from the art side so the engines drawn match the sim (`js/sim/siege.js`).
Until a model exists the renderer draws a placeholder built from boxes and cylinders with the SAME part names,
so any model that follows this contract drops in with no code change. Keep this file the single source of truth;
if you need to deviate, write the deviation here.

## Files

Plain GLBs in `assets/glb/` (no VAT, no skinning). One file per engine per state:

| sim kind | complete | extra states |
|---|---|---|
| `trebuchet` (counterweight) | `trebuchet.glb` | `trebuchet_assembling_1.glb`, `trebuchet_assembling_2.glb`, `trebuchet_packed.glb`, `trebuchet_burnt.glb` |
| `mangonel` (traction trebuchet) | `mangonel.glb` | `mangonel_burnt.glb` |
| `springald` (bolt thrower) | `springald.glb` | `springald_burnt.glb` |
| `ram` (covered ram, "cat"/"sow") | `ram.glb` | `ram_burnt.glb` |
| `siege_tower` (belfry) | `siege_tower.glb` | `siege_tower_burnt.glb` |
| `mantlet` (wheeled screen) | `mantlet.glb` | `mantlet_burnt.glb` |
| scaling ladder (escalade) | `ladder.glb` | — |
| `siege_workshop` building | `siege_workshop.glb` | `_build1`, `_build2`, `_ruin` (the usual building states, art-bible §Building states) |

A missing state falls back: `_burnt` → complete model darkened; `_assembling_2` → `_assembling_1` → placeholder;
`_packed` → placeholder carts. A missing complete model → placeholder.

## Axes, scale, origin
- Blender: 1 unit = 1 m, Z up, **front faces −Y** (the art-bible convention). "Front" = the direction the engine
  throws / shoots / is pushed. The renderer rotates it to the sim's facing.
- Origin on the ground (z = 0) at the centre of the base / wheelbase. Don't let `finish()` recentre it on the
  bounding box if the arm swings far behind; the origin must be the base centre.
- Real sizes (the sim uses these for footprints, collision with walls and the tower's reach):

| kind | footprint (w × l) | height | notes |
|---|---|---|---|
| trebuchet | 7 × 10 m | axle 6.5 m, arm 12 m (4:1 split) | box counterweight ≈ 2 × 2 × 2 m, hinged |
| mangonel | 3 × 4 m | axle 3.5 m, arm 7 m (5:1) | on a trestle with a pulling-rope hub, 15–40 ropes |
| springald | 2 × 3 m | 1.6 m | two arms in a frame, windlass at the back, 4-wheeled carriage |
| ram | 3 × 8 m | 3.2 m | gabled shed roof (hides/planks), log 9 m hung on chains, 6 wheels inside |
| siege_tower | 5 × 5 m | 11 m | bridge hinge at **7.5 m** (tops a 6 m stone wall), 4–6 solid wheels |
| mantlet | 2.4 × 0.8 m | 2.0 m | planks leaning back ~15°, small wheels or a prop |
| ladder | 0.5 × 7 m | — | modelled lying along +Z (foot at origin, top at z = 7) |

- Poly budget: ≤ 6k tris LOD0 (tower/trebuchet ≤ 9k), optional `_LOD1` ≤ 1.5k. One material/atlas per file (1024).

## Named moving parts (the renderer animates these; everything else is static)
Each moving part is a **separate mesh object** named exactly as below (a `_LOD1` twin may exist), with its
**object origin at its pivot** and its rest orientation as described. Don't join it into the frame, and don't
apply its transform so that the origin goes back to the world origin: keep the pivot. The renderer finds nodes by
name (a prefix match, so `wheel_fl`, `wheel_fr` … are all wheels).

| kind | part | pivot | the renderer does | rest pose |
|---|---|---|---|---|
| trebuchet | `arm` | the axle | rotates about the axle axis (Blender X, lateral) | **cocked**: long (sling) end down and back toward +Y, arm ~35° from horizontal |
| trebuchet | `counterweight` | hinge on the short end of the arm | counter-rotates so it always hangs plumb | hanging plumb in the rest pose |
| trebuchet | `sling` (optional) | the tip of the long end | hidden during the throw, then shown again | lying in the trough under the frame |
| mangonel | `arm` | the axle | rotates about Blender X | cocked: long end down at the back (+Y), resting on the frame |
| springald | `bolt` | its tail | hidden for 1.5 s after a shot | nocked in the groove, point −Y |
| springald | `bow_l`, `bow_r` (optional) | the arm root | small flick about Blender Z at the loose | drawn back |
| ram | `ram` | its centre of mass | **translates** along −Y/+Y (the swing, ±0.8 m), with a slight rotation | hanging level, head at the front (−Y) |
| ram, siege_tower, springald, mantlet | `wheel*` | the wheel's axle centre | rotates about Blender X (rolls) | any |
| siege_tower | `bridge` | the hinge (top front edge, z = 7.5) | rotates about Blender X from **up** (closed, vertical) to **down** (0°, lying level forward over the wall) | closed: standing vertical against the front face |

Please do not bake animation clips: rigid parts are animated in code. If you do add clips (glTF animations), name
them `throw`, `reload`, `swing`, `lower_bridge`, and the renderer will ignore them unless told otherwise.

## Team colour
Pennants, shield-covered mantlet faces and the like: give those faces a material whose name contains `team`.
The renderer tints it blue `#2f5fa8` or red `#a8322f`. Everything else uses the art-bible palette. Wet hides on the
ram's roof (against fire) are a nice touch.

## States the sim reports (engine.state)
`packed` (trebuchet only, moving as timber on carts) → `assembling` (progress 0..1: < 0.5 → `_assembling_1`,
< 1 → `_assembling_2`) → `ready` / `shooting` / `moving` (all the complete model) → `burning` (complete model + fire
from `js/render/fire.js`) → `burnt` (`_burnt` model, stays as a wreck). An abandoned or captured engine
uses the same models; only the team tint changes.

## What the sim draws itself (no art needed)
Stones and bolts in flight, dust and debris at impact, the crews (existing VAT figures: the crews use the
`villager` figure), and ladders leaning on walls (from `ladder.glb`, else a placeholder).

## Art delivery notes (siege artist → systems)

Delivered and conforming to the tables above. Where the art had to pin something down, it is written here.
Sources: `assets/src/{trebuchet,mangonel,springald,ram,siege_tower,mantlet,siege_workshop}.py` (shared kit
`assets/src/_siege_kit.py`); per-engine sidecar `assets/glb/<name>_parts.json` lists every pivot in Blender
and glTF coordinates. Pose previews: `blender -b -P tools/siege_booth.py -- assets/glb/<name>.glb <tag> arm=145 ...`.

**Node names inside each engine GLB**
- Static frame: `body_LOD0` (+ `body_LOD1`, ≤ 1.5k tris). It is deliberately *not* `<name>_LOD0`, because a
  prefix match on `ram` would otherwise also catch `ram_LOD0`.
- Every moving part is one mesh object named exactly as in the table (`arm`, `counterweight`, `sling`, `bolt`,
  `bow_l`, `bow_r`, `ram`, `bridge`, `wheel_*`), origin at its pivot, with no LOD twin (they are small).
- Hierarchy: `counterweight` and `sling` (and the mangonel's `ropes`/`sling`) are **children of `arm`**, so
  they ride the arm for free. To keep the box plumb, set `counterweight.rotation.x = -arm.rotation.x`.
  Everything else is parented to the scene root.
- Team material: faces to tint use the material `<name>_team` (same atlas as the rest; baked as a light,
  dirty neutral so a multiply tint reads). They are on the trebuchet pennant (complete + packed), the ram's
  ridge pennant, the siege tower's two parapet pavises, and the mantlet's painted top band.

**Rotation signs** (Blender axes; a Blender +X rotation is a three.js +X rotation after export)
- trebuchet `arm`: 0 = cocked (long end down to +Y, 35°), **+145°** = release. mangonel `arm`: 0 = cocked
  (long end down behind, sling on the ground), **+110°** = release. Positive always throws toward −Y.
- mangonel `ropes` (extra, optional): hangs from the rope hub; keep plumb with `-arm.rotation.x` like the
  counterweight. If the renderer ignores it, it simply swings with the arm.
- springald `bow_l` is the +X arm (the engine's left when facing −Y): flick **+deg** about Z; `bow_r` **−deg**.
  `bolt` pivot at its tail (nock); its point is 0.9 m ahead along −Y.
- ram `ram`: translate along Y (−Y = strike), the chains are part of the node (their tops slide along the
  stringers under the collar ties, so ±0.8 m reads correctly).
- siege_tower `bridge`: 0 = closed (vertical), **+90°** about X lowers it forward to lie level at z = 7.5;
  it is 3.2 m long with iron hooks at the far end.
- wheels: **positive X rotation = rolling forward (−Y)**; angle = distance / radius. Radii: springald 0.30,
  ram 0.45, siege_tower 0.62, mantlet 0.24. Names: springald/tower `wheel_fl/fr/rl/rr`, ram
  `wheel_{l,r}{f,m,b}` (six), mantlet `wheel_l/wheel_r`; `l` = +X side, `f` = −Y end.

**Sizes that step outside the footprint table** (all by physics, not by accident)
- trebuchet: the base is exactly 7 × 10 m, but with a 9.6 m long arm at 35° the cocked tip and the sling hang
  ~3 m behind the base (tip at y ≈ +7.9, z ≈ 1.0). mangonel: the sling end rests on the ground behind, at
  y ≈ +4.9. ram: the iron head sits ~1.4 m ahead of the shed (y = −4.9). siege_tower: merlons top out at
  ≈ 11.4 m.

**States and budgets**: trebuchet `_assembling_1`, `_assembling_2`, `_packed` (two timber wains in tandem),
`_burnt`; every other engine `_burnt`; ladder has none. Non-complete states are one static `body_LOD0/1`.
LOD0 tris: trebuchet 6.6k, mangonel 4.7k, springald 4.4k, ram 6.0k, siege_tower 8.5k, mantlet 1.2k, ladder
1.3k; all engines on one 1024 atlas (ladder 512). `siege_workshop` is a normal building (`siege_workshop_LOD0..2`,
2048 atlas, four building states).

## Castle kit (CASTLE-ART → castle.js / render/castle.js)

The castle you go inside is a modular kit: `assets/glb/castle_<piece>.glb` plus the manifest
`assets/castle-kit.json`, all generated by `assets/src/castle/*.py` (headless Blender; nothing downloaded).
castle-plan.md §2.1 is the short version; this is the contract.

**Numbers.** `assets/src/castle/_dims.py` is the single source; the manifest copies it into `dims`. They match
`DIMS` in js/sim/castle.js: curtain classes `main` (walk 8 m, 2.6 m thick, parapet 0.6), `inner` (10 m, 3.0,
0.7), `outer` (5.5 m, 2.2, 0.6); crenel sill 1.2 m above the walk (outer 1.1), parapet top 2.5 m above it (outer
2.0); merlons 2.1 m, crenels 0.9 m, pitch 3 m, so two crenels per 6 m module and every module joint falls inside
a merlon. Round towers r 5.5 (room radius 3.41 = the sim's `ri`), floors `[0, walk/2, walk, walk+5.5]`. Gatehouse
17 × 15 m, passage 3.4 m, floors `[0, 8, 13.5]`. Keep 20 × 20 m, walls 3 m, floors `[0, 6, 13.5, 21]`.

**Materials.** One shared, tileable library in `assets/tex/castle/`: `<key>_albedo.jpg` (sRGB),
`<key>_normal.jpg` (OpenGL +Y, as glTF/three.js), `<key>_rough.jpg` (grey; glTF reads G), `<key>.json`
(`tile_m`, `avg_srgb`). Keys: ashlar (6 m tile, 2048), rubble (6 m, 2048), paving, planks, timber, slate, shingle,
lead, plaster, iron, debris, earth. Generator: `castle_tex.py` (numpy, periodic by construction). Every GLB material
is named `castle_<key>` and references those files by relative URI (`../tex/castle/…`), so each texture is fetched
once however many pieces use it; `water` and `dark` are untextured. UVs are metres / `tile_m` with repeat
wrapping; walls use box/cylinder projection with V up the wall, roofs V up the slope. `COLOR_0` (per corner)
carries ambient occlusion × weathering (grime and damp at the foot, rain streaks, lichen on sills, soot above
hearths and burnt openings, pale fresh stone around impacts) and multiplies the base colour — GLTFLoader turns
`vertexColors` on by itself. `doubleSided` is false everywhere (closed solids).

**Nodes.** Static parts are `<part>_LOD0` and `<part>_LOD1` (decimated to 40–50 %). Parts: `base` (ground storey,
foundations, plinth, outside stairs, debris), `upper_<n>` (storey n: its floor with joists, its walls, its stair
flight), `roof` (roofs, roof walks, parapets, turrets). Cut-away: to look into storey n hide `roof` and every node
whose name starts with `upper_<m>` for m > n (towers also have `upper_2_wKK` / `upper_2_dKK` sector nodes — they
hide with `upper_2`). Moving nodes carry no LOD suffix; their origin is the pivot and the rest pose is closed:

| piece | node | pivot | motion |
|---|---|---|---|
| gatehouse | `portcullis_outer`, `portcullis_inner` | foot centre in its groove | translate +z to raise; `gate.portcullis_*.lift` (5.2 m) = fully up into the chamber slot |
| gatehouse | `gate_l`, `gate_r` | hinge at x = ∓1.7 | rotate about z: `gate_l` +90°, `gate_r` −90° to open inward |
| tower_* | `door` | west jamb of the bailey door | rotate about z (≈ −100° opens inward) |
| keep | `hall_door`, `store_door` | west jambs | rotate about z |
| postern | `door` | jamb | rotate about z |
| stable | `door_{1,2,3}{l,r}` | outer jambs | `l` −100°, `r` +100° |

**Frames.** Piece-local x, y are the sim's local plane (world = rotate by the part's `rot`, translate); z up from
the piece's ground. glTF export is Y-up: glTF (x, y, z) = (x, z, −y), the same map as the renderer's sim → three.
- Curtains: x −3…3 (ports, 6 m module; `curtain_stair` is 2 modules, −6…6), outer face −y at y = −th/2, the walk
  strip on top from the parapet's inner face to the bailey edge, centre y = +0.3. Stretch x by `len / n / 6` to fit a
  run exactly (as buildings.js does); never stretch z. Corners: arm A from port (−3, 0) to the corner at the origin,
  arm B to port (0, 3); `curtain_corner` has the outside on the right of travel A→B, `_corner_in` on the left.
- Towers: origin = tower centre; rotate so +y points into the castle (the inward bisector of its two curtains; the
  sim projects the centre 0.45 r outward from the ring vertex). The ground door faces +y. The walk-level wall is
  24 sectors of 15° (centre bearing 7.5 + 15k° CCW from +x): show `upper_2_dKK` (a doorway) for the sector nearest
  where each curtain's wall-walk meets the tower circle and `upper_2_wKK` elsewhere; the manifest `sockets` lists
  bearings and door points. The square tower has 12 panels (3 per face, doors possible on e, n, w). Mid-curtain
  towers (sim r = 4.95): scale x, y by r / 5.5. Let each curtain run ~1 m into the tower wall to close the gap
  between its flat end and the curved face.
- Gatehouse: x along the curtain, OUTSIDE −y (sim: +b = −y), ports at x = ±8.5, walk doors into the chamber at
  (±8.5, +0.3, 8). The outer portcullis sits at y = −4.4 (sim b = +5.3 — close enough for the men to stop at),
  the inner at y = +4.6, the leaves at y = −3.75; four murder-hole slots over the passage; a box machicolation
  over the portal; rear stair turrets at (±6.3, 6.8) from the ground to the roof.
- Keep: the sim's keep frame (x = a, y = b). The forebuilding and its stair are on the −y face (side 0): rotate by
  90° × side so it faces the bailey (side 1 = +90°, …). The internal flights run along the x = +ihw wall through an
  open well (`stair_well`), as the sim's stair links.
- Bailey buildings: the sim's rect frame; nominal hall 18 × 9, chapel 12 × 7 (altar at +x), kitchen 9 × 7,
  stable 15 × 6, well r 1.2 — scale x, y to the part's w, d (z untouched).
- Hoardings: the curtain frame of the same wall class; their beams sit in the curtain's `hoarding_sockets`.
- Ditch/moat: x along (−3…3), the ditch centreline at y = 0, castle side +y, lip at z = 0 (the terrain must be
  carved to `profile`); `moat` has a flat `water` node at −1.4 m.

**Manifest.** `pieces.<name>`: `file`, `kind`, `state`, `wall_class`, `mods` (6 m siege modules it spans), `size`
/ `bbox`, `ports`, `walks` (`strip` = centre `line` + `width`; `poly`; `circle` = `c` + `r`; each with `z` and a
suggested `lvl` — the sim's own level ids win), `doors` (`p_out`, `p_in`, width, `leaf` node), `links` (stairs with
foot/head points and `spiral`, `breach` slopes via a `crest`, `scramble` up rubble to a broken walk end), `ladders`
(crenel sill top + foot at 75°), `parapet` (`sill_z`, `top_z`, `crenels`), `loops`, `sockets` (towers),
`gate` (gatehouse), `hoarding_sockets`, `states` (on the intact piece: name of each damage state), `nodes`,
`moving` (pivots), `tris_lod0`.

**States.** Curtains `_pocked` (shattered facing, a chipped merlon, stones at the foot), `_cracked` (a shear crack
with the outer leaf bulging, parapet stones on the walk), `_breach` (a stepped V gap through the whole wall with a
rubble cone either side: the crest ~2.6 m (× walk/8) above ground, 31–33° slopes; the broken walk ends are
`scramble` links). Towers `_pocked`, `_cracked`, `_collapsed` (mined: the field half fell outward — a stump on the
gorge side and a heap 18 m out; the walks that ran into it end in the air). Gatehouse `_pocked`, `_cracked`,
`_ruin` (cracked + the gate passage scorched). Keep `_pocked`, `_cracked`, `_ruin` (slighted and burnt).
Hoarding `_burnt`. Moving parts are the same in every state.

**Budgets (LOD0 triangles).** Curtain modules 1.0–1.6k intact, 3–4.5k pocked/cracked, 6–7.5k breach; towers
~20–25k with every sector variant (a placed tower shows ~16k); collapsed towers ~19–21k; gatehouse ~22k; keep
~32k; hall 8k, chapel 5k, kitchen 3k, stable 4k, well 1.2k; hoarding 1.5k. Texture library ~21 MB on disk for
all pieces together; each GLB is geometry only (60 KB–1.5 MB).

**Review.** `castle_booth.py` (one piece, any views, `hide=`/`show=` nodes), `booth_all.py` (every piece: 3/4,
close, game camera), `compose.py` (a whole castle laid out by the sim's rules: wide, game, breach, gate, wall-walk,
keep cut-away). Renders in `assets/booth/castle/`.
