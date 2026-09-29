# Fighting figures: blows that land, shields that stay outside the man, arrows that stick

How the men fight on screen. The sim decides everything (who strikes whom, when, with what result); the figure layer
(`js/render/figures.js`, `js/render/battlefx.js`) shows it, timed to the sim's own clocks. Nothing here changes the
sim. Sources for what it should look like: `docs/battle-feel-research.md` (Froissart, Barbour, Towton, Visby,
Stirling Skeleton 150, the couched-lance experiments). Sim signals it reads: `docs/anim-sim-signals.md`.

## 1. Shields (assets/src/units/_human.py, _arms_anims.py)

A heater or round shield is strapped on the forearm (enarmes): it lies **flat along the forearm**, the arm across the
back of its upper third, the elbow near the outer edge, the fist gripping the strap near the inner edge, the face
`SHIELD_OFF` (10 cm) out from the forearm's axis on the back-of-the-hand side. `H.shield_frame(side)` gives that frame
in the forearm's rest space; the builders and the pose solver share it.

Posing the shield = posing the forearm. `place_shield(P, side, face, up, elbow)` sets the forearm's world rotation so
the shield faces `face` with its top toward `up`, puts the elbow as near `elbow` as the upper arm reaches, and twists
the upper arm so the elbow stays a hinge. Carriages are written for a standing man and turned with his chest
(`shield_pose`), so a rider 0.84 m lower, a lunge or a stagger carries them:

| carriage | where | used by |
|---|---|---|
| `SH_CARRY` | at the left side, face out and forward | idle, walk (shield_guard 0) |
| `SH_GUARD` | before him, front-left, point forward off the thigh | guard, blows (shield_guard 1) |
| `SH_HIGH` | raised and tilted over the head | block, cover (under arrows) |
| `SH_BASH` | punched forward with the shoulder behind it | bash, shove |
| `SH_RIDE` | on the left side over the thigh, clear of the horse's neck | ride, charge |
| `SH_STOOP` | out at the side and up off the thigh | finishing a fallen man, kneeling, getting up |
| settled | flat on the ground beside the body (behind his back if he lies on his side) | every fall |

**Check it numerically** — `blender -b -t 5 -P tools/vat_bake.py -- <arm> nobake clash [horse=horse_destrier]`
prints, per clip, the worst frame's triangle-pair overlaps (BVH) between every shield-like part shown in that clip
(the engine's kit rules: no shield in `_bare`/`_pollaxe` clips, buckler in hand only in fights, pavise planted only
standing) and the body (named by bone), the weapon carried in that clip, and the horse (riding clips, rest pose);
plus `FLOOR(bone)` for anything more than 3.5 cm under the ground. Before this work knights scored 1,695 overlapping
pairs in idle/walk/run/strike/ride; those clips are now 0. What remains is contact, not piercing: a fist grazing the
shield's inner edge at the end of a spear thrust, an upper arm lying against the settled shield of a corpse, the
scabbard of a man lying on his back (hidden under him).

Then **look**: `... nobake close q4 front horse=horse_destrier only=ride,guard out=<dir>` renders 4 frames × 4 views
(his right, ¾ front, front, his left), with the horse under riding clips.

## 2. The clips (assets/src/units/_combat_anims.py)

A **grip** is how a man holds his kit; each gives a ready pose (arms only, placed exactly with `place_hand` /
`place_shield`) and its blows. Every clip is *stance + grip arms + body motion layered on top* (`P.rot`/`P.move`
add), so a stagger carries arms and shield with it and nothing is re-solved in world space.

| grip | families (suffix) | blows |
|---|---|---|
| sword + shield | maa, knight (foot) | `strike` cut from above into the left of the head (right-hander, Towton) · `strike2` thrust at the face past the shield · `bash` · `strike_down` |
| spear + shield | spear, levy, rider (foot) | `strike` underarm thrust at the chest · `strike2` overhand over the rim · `strike_over` from the 2nd rank · `bash` · `strike_down` |
| two-handed spear | levy `_bare` | `strike` thrust from the hip · `strike_over` |
| club + shield | levy `_club` | `strike` overarm · `bash` |
| pollaxe | maa `_pollaxe` | `strike` overhead · `strike2` the hook behind the leg, hauled back · `strike_down` |
| pike | pike | `strike` the push of pike (levelled at face height) |
| sword + buckler | bow (in melee) | cut, thrust, buckler punched out |
| sword alone | xbow (in melee) | cut, thrust, the left arm fending |

Per grip also: `guard` (loop: the fighting stance, weight shifting), `parry`, `hit` (struck from the front: head and
chest snap back and twist, a stagger back a step), `hit_back` (from behind: pitched forward, a stumble), `press`
(ranks behind: close in, the shield or left hand on the back of the man in front, weapon up), `shove` (chest to
chest, driving in pulses), and with a shield `block` (the shield up to meet it, the impact driving man and shield back)
and `bash`.

Shared per family (the weapon falls from the hand, so one set serves every grip): `fall` (on his back), `fall_fwd`
(face down, arms flung ahead: struck from behind), `fall_crumple` (the legs go: to the knees, then over on his side),
`fall_clutch` (gut-struck: the hand to the wound, doubled over, down on a knee, over, curled), `writhe` (loop:
lying hurt, a knee drawn up, an arm reaching), `knock` (over backwards fast), `getup` (roll to the side, a knee
under him, up into his guard), `thrown` (loop: limbs flung, for the engine's tumble), `idle_cover`/`walk_cover`
(under arrows: shield up and angled over the head, head bowed, hunched).

Blows are **one-shots whose contact fraction is in the clip table** (`CLIP_META` → `<arm>_vat.json` `"hit"`). Every
standing clip ends with `feet_on_floor` (no toe in the ground); every fall ends with the body resting on the ground
(`ground_body`: the lowest joint sphere at z = 0) and the kit settled beside it.

**Riders** (family `knight` for knights and scouts; `rider` for hobelars): `ride` (lance upright on the thigh),
`ride_gallop` (still upright, forward with the stride), `ride_lower` (one-shot: the lance comes down),
`ride_charge` (couched under the right arm across the horse's neck, the rider leaning in behind his shield),
`ride_impact` (the shock drives arm and body back; the lance is gone), `ride_ready` / `ride_sword` (sword out, cutting
down at a man on foot on his right front), `ride_bash` (shield swung into a man on his left), `ride_hit`.

Frame budget: ~85 frames shared + ~85 per grip; levy (three grips) is the largest at 489 frames. VAT for all soldier
arms together: 58 MB. Keep new clips 8–12 frames.

## 3. The engine (js/render/figures.js)

Per man it keeps a one-shot **action** (strike, reaction, knock, get-up, rider action) over his **base loop**
(guard / press / shove / strike_down in a fight, otherwise idle / walk / run / cover by state and speed), and
cross-fades every clip change over 0.2 s (the shader samples the previous clip too: `iPrev`).

- **A blow that lands.** `S.nextAtk[i]` is the sim's next blow time, known in advance. The strike (chosen by grip
  and situation: `bash` for a shield-man close in, `strike_over` from the second rank, `strike2` sometimes, else
  `strike`; `strike_down` loops while the foe is on the ground — the cluster finish) starts so that its contact
  frame lands exactly on it. The attacker turns to his foe (`S.facing`); a rider fighting a man on foot turns so the
  man is on his sword side.
- **The answer.** At the blow (the sim's `blow` event, or `S.nextAtk` changing if no event came) the defender
  answers at once: `block` (res 1, a shield), `parry` (res 0), `hit` (res 2+), `hit_back` if it came from behind;
  riders `ride_hit`. If the blow kills or downs him, the state change does it.
- **Falls** are chosen by what killed him: from behind → face down; a missile → back or crumple; else hashed among
  back / crumple / clutch. The downed (S_DOWN) mostly fall on their backs and then writhe (LOD0). A dead man keeps
  his pose and his arrows. Blood soaks the ground where he fell (`battlefx.patch`); the press tramples it to mud.
- **Knocked down** (posture 1): he goes over away from whatever knocked him (the `knock` event's direction), lies
  struggling, and gets up (`getup`) when the sim stands him again.
- **The charge.** At the gallop the lance stays upright; within ~55 m of the enemy it is lowered (`ride_lower`) and
  couched (`ride_charge`). At the `lance`/`impact` event the rider takes the shock, the lance shatters (the rear of
  the shaft falls and stays on the ground, splinters fly: `battlefx.splinters`), dust bursts, and the knight's kit
  switches to the sword (the sim changes his weapon). Gallops kick up dust.
- **Unhorsed.** When `horseOK` goes 1 → 0 with `S.horse` still set, the horse falls where it was and stays; the rider
  is thrown over its neck (the tumble below) and lands knocked down. A dismount (`S.horse` cleared, the lord) leaves
  no dead horse: it is led away at a walk. A rider killed in the saddle leaves his horse running loose, bolting and
  then standing.
- **The thrown.** A stone's victims (`stoned` event, or a death by `cause: "stone"` near a fresh impact): the first in
  its path is driven flat where he stood (Stirling Skeleton 150); the others are flung — the body's middle flies a
  parabola away from the impact, the figure spinning about it (`iQuat`), the `thrown` flail, landing lying along the
  throw with a dust puff; the corpse keeps the offset.
- **Arrows.** Every shaft in `w.cs.flights` is drawn flying its arc (launch `x0/y0/t0` to landing `tI`, apex from the
  landing angle) by `battlefx` — on the GPU, the CPU only appends it. Where it went comes from the sim's `arrow` event
  (`on`: ground / cover → stuck in the ground; shield / pavise / body / armour / horse → stuck in him), or a
  render-side repeat of the sim's strip test. Stuck arrows ride their host's VAT (an anchor vertex, sticking out
  along its normal), follow him through every clip, vanish with a shield put down, and stay on the dead; up to 8 per
  man, 14 per horse, 6,000 in all; shafts in the ground up to 14,000 (the stubble field before a line). Far shafts are
  widened so a volley reads as streaks.
- **Under arrows**, men standing or walking with a shield raise it over their heads and bow (`w.cs.recentShot`).

`HG.figures.debug(i)` returns what man i is showing (clip, previous clip, action, death, thrown).

## 4. Verifying

- `tools/figview.html?duel=menatarms:spearmen&ranks=2&files=6` stages a fight with no sim (tools/figview-battle.js):
  the same state and events the sim produces. Add `&volley=archers`, `&stone=1`, `&charge=knights`, `&seed=`.
  Camera: `&cam=x,y,z&at=x,y,z` (three.js axes, the fight at the origin; `z = -sim y`).
- `?mode=battle&shot&warm=N` for the real thing.

## 5. Cost (M4, headless Chrome/Metal, figview 3,000 figures, DPR 1)

| | before | after |
|---|---|---|
| mostly LOD1 | 2.05 ms (219 fps) | 2.64 ms (183 fps) |
| `cam=0,25,70`, 1,287 at LOD0 | 3.41 ms (175 fps) | 3.79 ms (164 fps) |

The cross-fade costs two extra VAT fetches per vertex only while a blend runs (0.2 s after a clip change). Stuck
arrows: one draw per arm, per-frame CPU copy of the host's 16 floats per arrow within 120 m.
