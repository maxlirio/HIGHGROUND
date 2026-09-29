# Horses (units pipeline)

`blender -b -t 5 -P assets/src/units/horse.py -- light|destrier|barded [sheet] [booth]`

| arm | what | withers | LOD0 / LOD1 tris |
|---|---|---|---|
| `horse_light` | hobby/courser for hobelars & scouts: lean, rough coat, shaggy mane, fetlock feather, saddle + bridle + breast strap | 1.42 m (14 hh) | ~5.9k / 2.5k |
| `horse_destrier` | knight's warhorse: deep chest, heavy crest, team caparison with accent hem (dagged), war saddle (high cantle), crupper | 1.57 m (15.2 hh) | ~6.0k / 2.5k |
| `horse_destrier_barded` | same horse in padded quilted barding (team field, accent hem) | 1.57 m | ~6.0k / 2.5k |

Output follows `tools/vat_bake.py` exactly: `assets/units/<arm>.glb` (`_LOD0`, `_LOD1`, uv = atlas,
uv1 = VAT vertex row), `<arm>_vat.bin` + `<arm>_vat.json`, `<arm>_col/_rough/_mask.png`. The horse has
its own baker (numpy rig + leg IK, no Blender armature), because the human armature doesn't fit.
Mane and tail are opaque tapered locks, so no alpha test is needed. There is no normal map, same as the
men.

## Build
- **Body**: an anatomical signed-distance model (`_horse_anat.py`) built from ~50 round cones and
  ellipsoids (barrel, withers, quarters, hamstrings, gaskin, point of hock, knee, fetlock, hoof, jowl,
  ears, nostrils), smooth-unioned, meshed with OpenVDB, then decimated with the head and lower legs
  protected.
- **Tack**: ray-marched onto the same SDF (`_horse_geo.py`), so it sits on the horse, or on the trapper
  when there is one.
- **Skin weights**: from the same primitives, so they follow the anatomy at the joints.

## Clips (`family: "horse"`)
`idle` (weight shift, head lowers and tosses, tail swish, resting hind toe), `walk` (4-beat lateral),
`trot` (diagonal pairs), `canter` (3-beat, left lead), `gallop` (transverse 4-beat with suspension),
`rear` (refuse: rears off the forehand, paws, comes down; non-looping), `fall` (buckles, rolls onto its
right side; non-looping), `dead` (1 frame, lying).

Each gait's `speed` is the ground speed that matches the stance sweep. Scale the playback rate by
`actual speed / speed` and the hooves won't skate. Hooves stay flat and planted in stance (IK). Pick
the gait by speed: walk < ~2.5 m/s < trot < ~4.5 < canter < ~7 < gallop.

## Coat palette (per instance)
The mask channel B carries the coat:
- **1.0 = dye 1 = body coat**
- **0.5 = dye 2 = points**: mane, tail, lower legs, ear rims

Masked texels are painted around NEUTRAL 0.70. The standard figure shader tints them (`albedo * dye /
NEUTRAL_LIN`), so no new shader code is needed. Hooves, eyes, muzzle skin and the small white star are
fixed colours (mask B = 0).

`dyes.d1` / `dyes.d2` are 8-entry lists that are meant as **pairs**: index i of each makes one coat.

| i | coat |
|---|---|
| 0 | bay |
| 1 | dark bay |
| 2 | chestnut |
| 3 | light chestnut |
| 4 | dapple grey |
| 5 | light grey |
| 6 | black |
| 7 | dun |

The json flags this as `"pairedDyes": true` and names each entry in `coats`. **Engine ask:** when
`meta.pairedDyes` is set, `figures.js` should use the same index for `iLook.y` and `iLook.z`. With
today's independent hashes you still get plausible horses, because every d2 entry is a dark or
chestnut point colour. The difference is that you get some mixed coats: roughly 6% of horses come out
as greys with red-brown legs.

Team colours:
- **R (team field)**: caparison and barding field
- **G (team accent)**: trapper hem band and breast-strap pendants

## Rider seat
`meta.seat[clip][frame] = [x, y, z, qx, qy, qz, qw]`, in the horse's model space (three.js axes,
metres, horse faces +z) and in the same frame order as the VAT.
- **xyz** is the lowest point of the saddle seat on the midline, between pommel and cantle. This is
  where the rider's crotch and seat bones rest.
- **q** is the saddle's rotation for that frame: pitch while cantering or galloping, the big pitch-up
  in `rear`, the roll in `fall`.
- `meta.seatRest` is the rest seat.

To place a rider, apply the instance's transform (position, yaw, scale) to the seat, then draw the man
in a riding pose with his `pelvis` joint 0.10 m above the seat point along the seat's up axis. That is
the hip-joint height above a saddle for a 1.72 m man. Use `q` for his rotation. For the frame, use the
same clip and phase as the horse, and lerp between the two bracketing frames exactly as the VAT does.
When the horse falls, drop the rider off at `fall` phase ~0.3.
