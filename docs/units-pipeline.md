# Units pipeline: from Blender to men on the field

Soldiers are built procedurally in Blender. Their animation is baked into **vertex-animation textures (VAT)**, and
`js/render/figures.js` draws them over the sim's dots when they are within 220 m of the camera. The sim is never
touched, so figures are purely a render layer. Horses follow the same format; see `docs/units-horse.md`.

```
assets/src/units/_human.py    skeleton, lofted body + garment builders, kit (weapons, shields, helmets)
assets/src/units/_anims.py    clip library: pose FUNCTIONS of t, grouped in families (tool, spear, rider)
assets/src/units/_paint.py    numpy texture painter: colour, roughness and the team/dye MASK per material
assets/src/units/_arms_kit.py kit + painters for the foot arms (bows, crossbow, pavise, pike, pollaxe, bascinet,
                              coat of plates ...) and the helper-bone rig hooks; registers its painters on import
assets/src/units/_arms_anims.py  families levy / pike / maa / bow / xbow, and the analytic FK + hand placement
assets/src/units/_work_kit.py    the villagers' job kit: felling axe, pick, beetle + post, sickle, sack, pail, rod
assets/src/units/_work_anims.py  the villagers' "tool" family (job work clips), exact two-hand grips, resolve_offhand
assets/src/units/_combat_anims.py the fighting: guard, blows, shield work, reactions, deaths, thrown, riders (docs/units-combat-anims.md)
assets/src/units/<arm>.py     a unit recipe: SPEC + build(lod) -> [Part]
tools/vat_bake.py             builds, paints, bakes AO, samples every clip, exports (+ pose sheets, booth)
tools/figview.html            viewer/bench for figures without the sim
js/render/figures.js          the engine
```

Done so far: `villager`, `spearmen`, `levy`, `pikemen`, `menatarms`, `archers`, `crossbow`, `knights`, `hobelars`,
`scouts` (riders), and horses by the horse artist. Still to do: `militia`. (There is no `mage` arm in `js/sim/arms.js`.)

## 1. Make a unit

```
blender -b -t 5 -P tools/vat_bake.py -- <arm> sheet nobake     # fast: geometry + pose sheets only (~10 s)
blender -b -t 5 -P tools/vat_bake.py -- <arm> sheet nobake only=strike,walk
blender -b -t 5 -P tools/vat_bake.py -- <arm> ikcheck nobake    # prints off-hand IK reach error per frame (m)
blender -b -t 5 -P tools/vat_bake.py -- <arm> sheet nobake only=shoot parts=1,9 frames=2,6,9   # big frames, chosen kit
blender -b -t 5 -P tools/vat_bake.py -- <arm> booth             # full bake + Cycles booth renders (~1-2 min)
blender -b -t 5 -P tools/vat_bake.py -- <arm> nobake close only=work_axe out=/tmp/x   # one big sheet per clip:
                                                                # every frame x 3 views, only that clip's kit
blender -b -t 5 -P tools/vat_bake.py -- <arm> nobake gripcheck  # per clip: worst fist miss (cm), Blender vs FK
```

The `<arm>` name must be the key in `js/sim/arms.js` (the engine matches `index.json` entries to `ARMS`). Run one
Blender at a time with `-t 5`.

Outputs go to `assets/units/` (everything in it ships; the game downloads only the files below for the arms on the
field):

| file | contents |
|---|---|
| `<arm>.glb` | meshes `<arm>_LOD0` and `<arm>_LOD1`, one material (baseColor + roughness, JPEG). `TEXCOORD_0` = atlas, `TEXCOORD_1` = (VAT vertex row, 1 − part id) because glTF flips V. No `NORMAL` (the shader takes position and normal from the VAT; `vat_pack.py` strips it). |
| `<arm>_vat.hgz` | the VAT, packed (below). Unpacks to the texels the raw bake wrote: little-endian uint16 RGBA, texel `k = frame × nVerts + vertex`, row width `texWidth`. RGB is the position quantised into `bounds` (three.js axes: y up, +z = the man's front). A is an octahedral normal, `x << 8 \| y`. LOD1 rows follow LOD0 rows. |
| `<arm>_vat.json` | `clips {name: {start, frames, fps, loop, speed}}`, `verts [lod0, lod1]`, `texWidth/Height`, `frames`, `bounds`, `parts`, `dyes {d1, d2}`, `neutral`, `tris`, `vat {file, enc, shift, errMm, refs}` |
| `<arm>_mask.png` | R = team field, G = team accent, B = dye (1.0 dye 1, 0.5 dye 2). Linear. |
| `index.json` | every arm that has a `_vat.json` (rewritten by each bake) |

The painted atlas `<arm>_col.png` / `_rough.png` (embedded in the GLB, never loaded) is kept in `assets/units-atlas/`.

### Packing the VAT (`tools/vat_pack.py`)

The bake writes `<arm>_vat.bin` (raw uint16, 4–10 MB an arm, 76 MB for the 13 sets); `vat_bake.py` then runs
`vat_pack.py`, which turns it into `<arm>_vat.hgz` (1.0–2.1 MB, 17.7 MB in all), strips the GLB normals, moves the
atlas PNGs out and deletes the `.bin`. **Horse bakes (`assets/src/units/horse.py`) don't call it: run
`python3 tools/vat_pack.py` afterwards** (no arguments = every arm that still has a `.bin`). Until an arm is packed
the game plays its raw `.bin` (the json has no `vat` entry), so a fresh bake always works.

Encoding `hgv1`, one gzip stream of 8 bytes a texel, decoded by `unpackVat` in `js/render/figures.js`
(`DecompressionStream`, then one pass in JS; ~15–30 ms an arm, ~210 ms for all 13 on a laptop):
- **refs**: each frame is predicted from an earlier frame, `vat.refs[f]` (−1 = from zero). Mostly the previous frame,
  but a clip variant (`idle_bare`, `walk_pollaxe`, `press_club`...) repeats most of its base clip's body, so the
  packer takes whichever earlier frame (previous, same frame of an earlier clip, or the nearest poses) costs least.
- **positions**: the change from the reference frame, minus the previous vertex's change (neighbouring vertices ride
  the same bone), zig-zag int16, planes of low bytes then high bytes, x, y, z. The lowest `vat.shift` bits of the
  16-bit position are dropped (rebuilt at their midpoint): shift is the largest that keeps the error under 0.5 mm
  (`tol=` to change; `vat.errMm` records it — 0.27–0.44 mm; a man is ~1,700 mm, a pixel at the closest zoom ~4 mm).
- **normals**: lossless, each byte's change from the reference frame, mod 256.

The packer decodes every file back and checks it before deleting the `.bin`. Figure sets load lazily: `figures.js`
scans the soldiers once a second and loads only the arms (and horse types) present — a man whose set is still
loading stays a dot. `?figures=all` loads every set up front; `HG.figures.stats().vat` has the bytes and unpack time.

Renders go to `assets/booth/unit_<arm>_{model,sheet_side,sheet_front,close,face,lineup,game,game_far}.png`.

**Look at the renders, every time.** Read `unit_<arm>_model.png` (front, ¾, side and back turnaround) and both
sheets before any full bake, then read `close`, `lineup` and `game` afterwards. Passing technical checks is not
enough. Things the sheets caught during this work:
- a shield rotated 60°
- a spear sticking out of a corpse
- an off-hand 40 cm short of the haft
- a hidden mesh left in a render

## 2. The recipe (`assets/src/units/<arm>.py`)

```python
import _human as H
SPEC = {
  "family": "spear",                 # clip set from _anims.FAMILIES: "tool" | "spear" | "rider" (add "bow", "xbow", "pike" ...)
  "parts": {"shield": 1},            # optional kit -> part id (1..15); the engine switches parts per man
  "tex": 1024,
  "dyes": {"d1": [...8 hex], "d2": [...]},   # per-man palettes for mask B=1.0 and B=0.5 (period dyes, see villager.py)
  "booth_parts": [1], "lineup": [(clip, t, parts), ...], "crowd": fn(row, col, rnd) -> (clip, t, parts),
}
def build(lod=0):                    # lod=1 must give ~1.0-1.4k tris; lod=0 ~2.7-3.5k incl. kit
    body = H.Part("body", 0)         # part 0: always drawn
    H.head(body, "skin", lod=lod); ...
    shield = H.Part("shield", 1); H.heater_shield(shield, 1, KIT, lod=lod)
    return [body, shield]
```

Both LODs are built from the same builders, with fewer rings for LOD1, and share one atlas: LOD1's islands are packed
at 0.42× scale. The painter works from 3D rest positions, so both LODs get the same look. Don't decimate.

### Body and conventions
- 1 unit = 1 m, Z up, the man **faces −Y**, stands on z = 0, reference height **1.72 m**. The engine scales each man
  0.94–1.035, which gives 1.62–1.78 m.
- His left is +X (`.L`).
- **Bones** (18 deform): `root pelvis spine chest neck head`, `upperarm/forearm/hand .L/.R`, `thigh/shin/foot .L/.R`.
  There are also non-deforming `ik_grip` (child of hand.R) and `ik_pole`.
- The **rest pose** has the arms hanging and the fists closed. A fist's **grip axis runs front–back**: anything held is
  modelled lying along Y through `H.fist(side)` with its business end toward −Y. Raising the forearm 90° stands a spear
  upright.
- Skin weights are explicit. Every vertex gets a weights dict from the builder (`limb_weights`, `torso_w`, skirts
  weighted `pelvis → thighs` by depth). Rigid kit is weighted 1.0 to one bone.
- Skirts: `torso(..., skirt=(hem_z, rx, ry, rings))`. The hem follows the thighs 78%, and folds are built into the rings.
- A shield is modelled **in the rest frame of the forearm, such that the guard pose holds it upright**. The axes in
  `heater_shield` / `round_shield` are the guard pose's world down/forward pulled back into rest space. If you change
  `_anims.shield_guard`, re-derive them with this snippet (run it with `blender -b -P`):
  ```python
  rig = H.build_armature(); RF = {b.name: b.matrix_local.to_3x3() for b in rig.data.bones}
  P = A.Pose(); A.spear_carry(P)      # apply with vat_bake.apply_pose(rig, RF, P)
  M = rig.pose.bones["forearm.L"].matrix.to_3x3() @ RF["forearm.L"].inverted()
  print(M.inverted() @ Vector((0, 0, -1)), M.inverted() @ Vector((0, -1, 0)))   # -> axis_down, fwd
  ```
- Materials are just names on faces. Each name needs a painter in `_paint.PAINTERS` and a flat colour in `_paint.FLAT`.

### Painting and the mask
The painter functions take `(P, N, pat, patd)`:
- `P`: the rest position of every texel
- `N`: the normal
- `pat`: a per-vertex pattern coordinate set by the builder (shield u/v, distance along a haft)
- `patd`: the same attribute from the texel's dominant vertex

They return sRGB colour, roughness and mask.

Rules:
- Team-coloured and dyed cloth is painted **neutral grey (sRGB 0.70)**, with the weave, folds, dirt and wear in it.
  The shader does `albedo × tint / NEUTRAL_LIN`, so all that detail survives the tint.
- **Keep mask values exact** (1.0 / 0.5 / 0). A B value weakened by mud falls out of the dye band and shows raw grey.
  Put the mud in the albedo instead.
- Paint chips and wear by lowering the mask *and* painting wood/iron there. The same noise drives both, so they stay
  in register. See `paint_shield`.
- AO is baked separately for each LOD, on a subdivided copy (low-poly AO bakes produce black spikes), in a spread pose
  with the optional kit moved away. It is multiplied in at 0.65; skin gets 0.4 so faces inside hoods don't go black.

### Clips (`_anims.py`)
A clip is `name: (frames, fps, loop, fn(t, P), ground_speed_or_None)`. `fn` poses the rig at normalised time t:
- `P.rot(bone, x, y, z)` / `P.arm(side, bone, x, abd, internal)` / `P.leg(side, thigh, knee, foot, abd)` / `P.move(...)`.
  Rotations are in degrees, in armature axes, relative to the parent. x > 0 swings a limb back, x < 0 forward, and
  x < 0 flexes the elbow.
- A hand's x > 0 tips the held thing's point **down**, but only while the tool points forward. Once it points back,
  the sign flips.
- `P.ik = 1; P.grip = metres` puts the **left fist** on the right-hand tool that far along it, which gives
  two-handed grips. Since 2026-09 the baker solves it EXACTLY (`_work_anims.resolve_offhand`, called from
  `vat_bake.run_pose` for every pose of every unit): the fist, not the wrist, lands on the haft, its grip axis along
  it and the wrist rolled toward the shoulder; out of reach, the hand slides along the haft (up to ±0.30 m) to the
  nearest point it can hold. Blender's `offhand` IK constraint (wrist onto a point) left the fist 6–21 cm off the
  haft and is no longer used. `P.ik < 1` blends the arm back toward its FK pose (a hand letting go).
- **Hands on tools, exactly** (`_work_anims.py`): `tool_pose(P, fist, rot)` puts the right fist and the tool
  (rot = (pitch, roll, yaw): pitch > 0 tips the head down, yaw > 0 to his left); `grip(P, fist, rot, along)` adds the
  left fist `along` metres up the haft (negative: toward the butt); `hand_on(P, side, pos, q)` any fist on any axis;
  `fist_at_tip(tip, rot, L, h)` the fist position that puts the working point on a world point, so a hoe, pick or
  beetle strikes the ground or the post exactly. `body(...)` hinges at the hips and drops the root so the lower
  ankle stays at its rest height. Every miss goes in `P.err`; `gripcheck` must read ≤ 1 cm.
- **Key contact moments on frame times** (multiples of 1/frames): the engine only lerps between baked frames, so a
  blow keyed between two frames is never seen landing.

- **Put a hand exactly** (`_arms_anims.place_hand(P, side, fist_pos, rot, pole)`): world rotation of a bone is the
  product of the clip's rotations down its chain, so the fist can be placed at a world point with a world orientation
  (rot = Euler degrees, (0,0,0) = the rest orientation: the held thing along Y, business end -Y; (-28,0,0) raises the
  point 28°). Call it after the torso is posed. Used for the pike, the crossbow aim and spanning, the pollaxe.
  `world(P, bone)`, `set_world_rot`, `blend_hand_world`, `lay_down_kit` (weapon/shield flat at the end of a fall).
- **Helper bones** (`SPEC["rig"](rig)`, e.g. `_arms_kit.bow_rig`): a recipe may add bones and constraints. Constraints
  named `x_*` take their influence from `P.cons` (0 when absent); `P.locs[bone] = (x, y, z)` offsets a helper bone
  (armature axes at its rest). The longbow string's midpoint (`nock`) and the nocked arrow's tail (`arrow`) copy the
  drawing fingers (`x_draw`, `x_arrow`), the drawing arm is an IK onto a target sliding back along the draw
  (`x_drawik`, `draw_tgt`); the crossbow string (`xstring`) is drawn onto the nut by `x_cock` and the bolt's tail rides
  it; the planted pavise is weighted to a parentless `ground` bone so it never bobs with the man.
- `SPEC["clip_meta"] = {"shoot": {"loose": 0.64}}` is merged into the json clip table.

Keep clips simple and short (8–16 frames). Loops must close, because frame N wraps to frame 0.
- **Names the engine knows**: `idle walk run strike fall work shoot reload brace level ride ride_charge
  ride_strike`, the fighting set (`guard strike2 strike_over strike_down parry block bash shove press hit hit_back
  fall_fwd fall_crumple fall_clutch writhe knock getup thrown idle_cover walk_cover ride_gallop ride_lower ride_impact
  ride_ready ride_sword ride_bash ride_hit`, docs/units-combat-anims.md; blows are one-shots with `"hit"` = contact), the villager set (§3 "Villager loadouts": `idle_hand walk_hand idle_talk idle_pail walk_pail
  walk_carry work_hoe work_axe work_pick work_mallet work_sickle work_fish work_adept work_bucket`), and the variants `<clip>_<weapon>` (a js/sim/kit.js weapon key: `strike_pollaxe`,
  `idle_club`, `fall_pollaxe` ...) and `<clip>_bare` (men without a shield) for idle/walk/run/strike/fall.
- `fall` is non-looping; the engine holds its last frame for the dying and the dead. End it lying flat, with the body's
  back on z ≈ 0 (root +0.115 m).
- `walk`/`run` carry their nominal ground `speed`, and the engine scales the playback rate by actual speed / speed.
- **`shoot`**: non-looping, with `"loose": 0..1` in its json entry (0.5 if absent). The engine times the clip so that
  the loose frame lands exactly on the sim's shot (`S.nextShot`), plays the follow-through after it, then **`reload`**
  if the arm has one (the crossbow's spanning, 3.4 s), then idle. Longbow `shoot`: 16 frames, nock–draw–loose at 0.64;
  crossbow `shoot`: 12 frames, loose at 0.55, then `reload` (belt-claw spanning, 24 frames).

## 3. The engine (`js/render/figures.js`)
- One `InstancedMesh` per arm per LOD: LOD0 inside 90 m, LOD1 to 220 m. A dithered cross-fade over 190–220 m hands
  over to the dots (`dots.update(..., figures.fade)`). Men are culled against the frustum by 32 m chunks.
- Enemies follow the fog of war through the same `visibleSoldier(i)` the dots use.
- Per instance there are 20 floats: `iPos (x, h, z, yaw)`, `iAnim (clip, phase, scale, kit bits)`,
  `iLook (team + 2·selected, dye1, dye2, fade)`, `iQuat` (identity on foot, the saddle's rotation for riders, the
  tumble of the thrown) and `iPrev` (previous clip, its phase, cross-fade weight: while a clip change fades in over
  0.2 s the shader samples both clips).
  The vertex shader fetches two VAT frames with `texelFetch` on an RGBA16UI texture and lerps them. Vertices of parts
  whose bit is off collapse to a point.
- **State → clip** (`pickClip`):
  - `S_DOWN`/`S_DEAD` → one of `fall fall_fwd fall_crumple fall_clutch` (by what killed him), then hold the last
    frame (the downed may `writhe`). Corpses stay, with their arrows, while the sim keeps them.
  - `S_FLEE` → `run`
  - `S_FIGHT` → `guard`, with one-shot blows timed so their contact lands on `S.nextAtk`, reactions on the foe,
    `press` for the ranks behind, `shove` chest to chest, `strike_down` over a fallen foe (docs/units-combat-anims.md);
    arms without a `guard` clip fall back to the looping `strike`
  - `S_WORK` → `work_<tool>` / `work` / `idle`
  - otherwise by speed: < 0.25 m/s `idle`, < 2.2 `walk`, else `run`
  - a missile arm standing still, not fighting or fleeing → `shoot` around each `S.nextShot`, then `reload` if any
  - pikemen standing still while enemy horse is moving/charging within 90 m of their unit (or in a schiltron) →
    `brace` for ranks 0–1 (kneeling, butt grounded), `level` for the ranks behind
  - then the man's variant if the arm has one: `<clip>_<weapon>` for `S.weapon`, else `<clip>_bare` without a shield

  Every man's loop phase is offset by his id and his rate jittered ±10%, so a block never moves in lockstep.
- **Kit bits** (`kitBits`):
  - `shield` if `S.shield[i]`
  - villagers: the kit of their job loadout (below)
  - knights: `lance` mounted until it breaks (the sim swaps `S.weapon` to the sidearm at the impact), then `sword`
  - a part named after the man's weapon key (`spear`, `club`, `sword`, `falchion`, `mallet`, `axe`, `pollaxe`): on;
    for missile arms (a `bow` part: longbow / crossbow) only in melee, otherwise the bow. Two keys may share a part id.
  - `pike` always; `buckler` in the fist in melee, `buckler_belt` at the hip otherwise (`S.shield == SH_BUCKLER`)
  - `helm` if kit bit 0 (the head's first layer, an iron hat), else `cap` / `hat`; `visor` if bit 3 (face, first
    layer); `mail` if bit 9 (torso, first layer); `pavise` planted when standing still, `pavise_back` otherwise

  Add a rule here when a new arm has optional kit.
- **Villager loadouts** (`VILLAGER_KIT` + `villagerJob` in figures.js). The economy job picks the kit and the clips:
  `work` while `S_WORK`, `walk`/`idle` otherwise. `walk`/`idle` carry a long tool on the shoulder; the `_hand`
  variants hold a small tool (or nothing) in the hand. Up to 64 clips per arm (`MAX_CLIPS`).

  | job (economy.js `u.job`) | loadout | kit | work clip | walking |
  |---|---|---|---|---|
  | gather `timber` / `firewood` | wood | felling axe | `work_axe` overhead diagonal chop | shouldered |
  | `field`, crop growing | field | hoe | `work_hoe` chop, draw back, lift | shouldered |
  | `field`, `b.field.state === "ripe"` | reap | sickle | `work_sickle` stoop, gather a handful, cut | in hand |
  | gather `stone ore silver gold clay` | mine | pick | `work_pick` overhead, point into the ground | shouldered |
  | `build`, siege-engine crews | build | beetle (+ post while working) | `work_mallet` drive the post | shouldered |
  | `craft` | craft | beetle (+ post) | `work_mallet` | shouldered |
  | gather `fresh` at a fishery | fish | rod | `work_fish` cast, wait | shouldered |
  | gather `fresh` at hunt / forage | forage | sickle | `work_sickle` | in hand |
  | gather `mana` (adepts) | adept | — | `work_adept` kneeling, hands raised | empty-handed |
  | `firefight` | fire | pail | `work_bucket` swing and heave | `walk_pail` |
  | `home`, `practice` | per-man mix | —, pail or hoe | `idle_hand` / `idle_talk` / `idle_pail` / `work_hoe` | |
  | hauler loaded (`u.haul.get(id) === 1`), convoy out | haul | sack on the shoulder | — | `walk_carry` |

  The post (part `stake`) is weighted to the parentless `ground` bone (`_arms_kit.ground_rig`), so it stands still
  in front of him whatever the body does, and is drawn only while he works. Parts: hoe 1, axe 2, pick 3, mallet 4,
  stake 5, sickle 6, sack 7, pail 8, rod 9.
- **Per-man look**: height from `S.name`, dyes from `S.name`, contact shadow stretched away from the sun.
- `?figures=0` turns it all off. `?demo=figures&n=900&arms=spearmen,villager&dist=45&pitch=14` stages a fight in view.
  `HG.bench(sec)` returns fps and render ms with `gl.finish()`.
- `tools/figview.html?arms=a,b` shows a lineup, one row per state. `&crowd=3000&bench` puts the result in the title;
  `&cam=x,y,z&at=x,y,z` sets the camera, `&lod1=0` forces LOD1.

## 4. Riders and horses: the seat convention
- A **horse** is its own VAT unit (`horse_light`, `horse_destrier`, `horse_destrier_barded`; family `horse`: `idle walk
  trot canter gallop rear fall dead`). It faces +z in three.js model space like the men.
  - Its json has `seat[clip][frame] = [x, y, z, qx, qy, qz, qw]`: the lowest point of the saddle seat and the
    saddle's rotation, in horse model space, frame-aligned with the VAT.
  - `pairedDyes: true` means `d1[i]`/`d2[i]` make one coat, and the engine uses one index for both.
- A **rider** is a normal human unit of family `rider`: the `spear` foot clips plus `ride`, `ride_charge` and
  `ride_strike`. **The mounted clips are authored with the saddle seat point at the model origin**
  (`_anims.SEAT_DROP` puts the pelvis joint 0.10 m above it) and the legs astride.
  - The horse's seat track provides all the bounce, pitch and roll, so the rider clips barely move.
  - **Legs and stirrups agree** (2026-09 cavalry pass). `_anims.ride_base` no longer poses the legs by angle: it
    places each ankle by IK (`_arms_anims.place_foot`, knee a true hinge) at `_anims.RIDE_FITS[horse]["ankle"]`,
    the long-leathered 13th–14th c. seat (legs nearly straight down the flanks, knees round the barrel, the ball of
    the foot in the iron). The recipe picks its horse: `A.RIDE_FIT = A.RIDE_FITS["destrier"]` (knights) or
    `"light"` (hobelars, scouts). The horse hangs its irons at `_horse_geo.STIRRUP[...]` (same seat frame), so
    **change both together** and re-bake the horse and its riders. Fitted to the caparison's outer width (knee
    ≥ 0.33 m, ankle 0.41 m off the midline on the destrier; 0.24 / 0.29 on the light horse).
  - The destrier's trapper carries the team **arms** (an accent chevron on each flank, `m_cloth_mask(charges=)`),
    and its skirt **drapes under gravity** when the barrel tilts (rear, fall, dead: `horse.apply_drape`), so a dead
    caparisoned horse lies under its cloth instead of reading as a box on its side.
- The engine, per mounted man (`S.horseOK ≥ 1`):
  - picks the horse by `S.horse` (1 light, 2 destrier) and barding from `kitMask` bit 30
  - picks the gait by speed: walk < 2.5 < trot < 4.5 < canter < 7 < gallop, and a bolting horse (`horseOK 2`)
    gallops
  - scales playback by speed / clip speed
  - plays `rear` when the sim parks him with a fresh `busyT`, which is what a refusal does
- The rider's position is the horse's position plus the yaw-rotated, scaled seat point at the horse's (clip, phase),
  lerped exactly like the VAT. His rotation is the seat quaternion, then the yaw. His own clip: `ride_strike` in
  combat, `ride_charge` above 5 m/s, otherwise `ride`.
- When `horseOK` goes 1 → 0 (the horse is brought down), a dead horse is left where it fell, playing `fall` and then
  held. The man carries on as a foot figure (knights switch lance for sword). A rider who dies in the saddle falls on
  foot clips, and his horse stands riderless beside him.
- For a new mounted arm: set `family: "rider"`, give it the kit, and it works. For a new horse, bake it with a
  `seat` track and add its key to `HORSE_KEY` in figures.js.

## 5. Budgets (measured on this M4, headless Chrome, Metal)

| scene | render ms (incl. `gl.finish`) |
|---|---|
| figview, 3,000 figures, mostly LOD1, DPR 1 | 2.2 ms (~295 fps) |
| same at DPR 2 (MacBook Air panel, 1440×900@2×) | 4.6 ms |
| 3,000 figures with 1,571 at LOD0, DPR 2 | 5.5 ms |
| figview, 3,000 villagers (job loadouts, 19 clips, 9 kit parts), mostly LOD1, DPR 1 | 1.8–2.0 ms (was 2.1–2.4 with 2 tools) |
| same, `cam=0,25,70` (LOD0-heavy), DPR 2 | 6.7–6.9 ms (was 9.0–9.8) |

An M1/M2 Air GPU has roughly half this one's throughput, so expect about 9–11 ms, which is within the 50 fps
budget. In the game, the figure layer adds under 1 ms: the terrain and trees dominate the ground view. Keep new units at
≤ 3.5k tris LOD0 and ≤ 1.4k LOD1, and one 1024 atlas.
