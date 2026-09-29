# Animation ← sim signals (requests from the combat-animation lead)

The figure layer (`js/render/figures.js`, `js/render/missiles.js`) is purely a render layer: it never writes sim
state. It reads `S.*` every frame and **taps `w.events` once per tick** (a read-only function appended to
`w.systems` on first use, so it sees every event the tick produced). Everything below already has a fallback that
guesses from state, so none of it blocks; each one makes what you see match what the sim decided.

Please push these into `w.events` (the per-tick list). All are QUIET-class (keep them out of `w.log`).

## 1. `blow` — every melee exchange resolved (combat.js after `resolveBlow`, cavalry.js lance/trample)

```js
w.events.push({ t: w.tick, kind: "blow", a, d, res, z, mode, dx, dy });
// a, d   attacker, defender ids
// res    resolveBlow's return: -1 grapple failed, 0 parried/missed, 1 blocked on shield, 2 glance/bruise,
//        3+ wound (severity + 1)
// z      zone (kit.js Z_*), mode (M_CUT / M_THRUST / M_BLUNT) if known, else omit
// dx,dy  unit vector attacker -> defender (sim axes)
```
Used for: the attacker's blow lands at this instant (the strike clip is timed to `S.nextAtk`, this confirms it);
the defender plays **block** (res 1: shield jolts), **parry** (res 0), **flinch/stagger** away along (dx, dy)
(res 2–4), or goes down (state change, already visible). Fallback today: I detect the blow when `S.nextAtk[a]`
jumps and pick block/parry/flinch by the defender's shield and a hash.

## 2. `arrow` — where each missile ended (ballistics.js `land`, siege.js bolts)

```js
w.events.push({ t: w.tick, kind: "arrow", x, y, ux, uy, ang, key, hit, on, z });
// hit  soldier id or -1;  on: "ground" | "shield" | "pavise" | "body" | "horse" | "cover" | "armour"
// (armour = struck but did not penetrate; still sticks in a padded jack, bounces off plate)
```
Used for: the shaft sticks where it really went — in the ground, in his shield, in his pavise, in him, in his horse
— and stays there (corpses keep theirs). Fallback: I repeat your strip test render-side on landing and choose
shield/body by facing.
Also, if cheap: give each flight `x0, y0, t0` when it is pushed in `fire()` (launch point and time) so the arc
starts exactly at the bow. Fallback: the shooter's position the first frame I see the flight.

## 3. `knock` — a man knocked off his feet (melee.js `knockDown`, cavalry trample, shock)

```js
ctx.events.push({ t: ctx.tick, kind: "knock", who: id, by, dx, dy, cause }); // cause: "blow" | "grapple" | "horse" | "shock" | "stone" | "slip"
```
Used for: he goes over *away from* what hit him (backward from a blow, forward from a push in the back, under a
horse), then struggles and gets up at `S.upT`. Fallback: `S.posture` 0 → 1 and the nearest enemy's bearing.

## 4. `stone` casualties carry the impact (siege.js `stoneLands`)

`fell(ctx, o, -1, sev, "stone")` already tags the kill; please add the stone's position/direction so the body
can be thrown (or, for the first man in its path, driven flat — Stirling skeleton 150) the right way:
```js
w.events.push({ t: w.tick, kind: "stoned", who: o, x: s.x1, y: s.y1, ux: s.ux, uy: s.uy, first: k === 0, big: s.big });
```
Fallback: a death within 1 s and 12 m of a fresh `w.siege.impacts` dust/debris entry.

## 5. Nice to have (momentum / breakthrough / volleys work)

- `shove`: `{ kind: "shove", a, d, dx, dy }` when one man physically drives another back (press / shield-push / horse
  barge). Animation: the shover leans in with shield/shoulder, the shoved man staggers back a step.
- `volley`: `{ kind: "volley", unit }` when a commanded volley is loosed. Animation: the whole block's draw is
  synchronised to it instead of each man's own `S.nextShot`.
- `lance`: `{ kind: "lance", who, on, broke: true|false }` for a couched-lance hit (cavalry.js `impact`). Fallback:
  the existing `impact` event; I break the lance on 70 % of them.
- `horse` events already exist (`bolt`, `down`); a `flinch` (`{kind:"horse", who, what:"flinch", from: dx,dy}`) for
  a pricked horse that neither bolts nor falls would drive the head-toss / sidestep.

Status of each (edit this line when you add one): blow ☑ · arrow ☑ (+ flight x0, y0, t0) · knock ☑ · stoned ☑ (+ thrown) · shove ☑ · volley ☑ · lance ☑ · horse flinch ☑

Combat engineer's notes (these are the ONE shape both the figures and js/audio read — sound designer, same events):
- `blow` {a, d, res, dx, dy} from every melee exchange (combat.meleeTick), plus `mode` on lance hits and tramples.
  (No separate `strike` event: the blow lands at the tick it is pushed; the next one is due at `S.nextAtk[a]`.)
- `arrow` {x, y, ux, uy, ang, key, hit, on, z, shooter}; `on` ∈ ground | cover | pavise | shield | armour | body | horse
  (armour = struck, did not wound: stuck in the padding or glanced off plate). Volley shafts too.
- `knock` {who, by, dx, dy, cause}: cause ∈ blow | grapple | slip | horse | shock | crush (melee.knockDown).
- `shove` {a, d, dx, dy}: the front ranks of a body struck by a charge at pace (combat.footShock), up to 24 a charge.
- `shock` {unit, on, shock, burst}: a body arriving at pace hits another (burst = broke through a thin/shaken line).
- `volley` {unit, x, y, n, next}: a company loosed on the word; `next` = battle time of its next volley (the draw
  can be timed to it). Fire modes: ballistics.setFireMode(w, u, "volley" | "will" | "hold", at).
- `stoned` {who, x, y, ux, uy, first, big} for the (≤ 2) men a stone strikes, and `thrown` {who, dx, dy, speed} for
  men beside its path knocked flying (then a `knock` with cause "stone"); siege.stoneLands.
- `bash` {a, d, dx, dy, down}: a shield-bash close in (combat.meleeTick) instead of a cut — the foe is driven back
  0.5-1.2 m and staggered, or knocked down (then also a `knock`, cause "bash").
- `decisive-moment` {type, title, team (the side it happens TO), unit, by, x, y, salience} — types so far:
  `ridden-through` (a charge bursts through a body), `line-burst` (a foot body at pace bursts a thin/shaken line),
  `captain-falls` (the leader of a company of 40+ is killed), `crush` (the third man smothered within 20 m / 30 s).
  battle-record turns them into moments; js/audio sounds a horn and the charge cue.
- `horse` {what: "balk", who, by, dx, dy}: a frightened horse stops dead and refuses for 2-4 s (the second shaft);
  `horse` {what: "bolt", ..., dx, dy}: it bolts away from what hurt it — the sim now moves it (cavalry.bolting),
  at a flat gallop through its own ranks as readily as the enemy's, until its rider masters it.
- `lance` {who, on, broke: true} at every couched-lance hit; `horse` {what: "flinch", who, by, dx, dy} for a
  pricked horse that neither bolts nor falls.

---

# Requests the other way: commander avatar → figures (from the commander-avatar engineer, js/sim/avatar.js)

## A. Dismounted is not unhorsed — please don't drop a dead horse (figures.js, the `deadHorses.push` line)

The player's lord can get down off his horse (E) with his household; the horses are led away by the pages. The sim
signals it by clearing **`S.horse[i] = 0`** at the same tick `S.horseOK[i]` goes 1 → 0 (a horse killed under its
rider keeps `S.horse` = 1 or 2). Remounting sets `S.horse[i] = 2` and `horseOK = 1` again. Today figures.js pushes a
fallen horse whenever `horseOK` goes 1 → 0, so dismounting leaves a dead destrier on the field. One condition fixes it:
```js
if (m.okPrev[i] >= 1 && ok === 0 && S.horse[i] && m.seen[i] && deadHorses.length < 600) deadHorses.push(...)
```
(Nice to have: a `dismount` / `mount` clip; the sim pushes `{ kind: "lord-dismounts" | "lord-mounts", team }`.)

## B. Events the avatar already pushes (read-only for you)
- `{ kind: "blow", a, d, res, dx, dy }` for every one of the lord's own strokes (same shape as §1 above).
- `{ kind: "lance", who, on, broke: true }` for his couched-lance hits (and his household's, riding on behind him).
- `{ kind: "avatar-blow", res, target, killed, commit }` (res −2 = a stroke at the air) — the stroke is timed by the
  player: while he winds up a committed blow the sim holds `S.state = S_FIGHT`, so `ride_strike` / `strike` play.

---
## Status on the figures side (combat-animation lead)
- consumed: `blow` (reaction + attacker's follow-through; per-attacker dedupe, so the avatar's own blows don't switch
  off the `S.nextAtk` fallback for everyone), `arrow` (on: ground/cover → ground; shield/pavise/body/armour/horse →
  stuck in him), `lance` and `impact` (splinters, the stump on the ground, `ride_impact`), `knock` (falls away from
  `by`), `shove` (bash/shove + stagger), `stoned`, `kill`/`down` `cause`, `horse` `flinch` (the horse shies sideways)
  and `down`; flights' `x0, y0, t0`.
- A. done: a dismount (`S.horse` cleared) leaves no dead horse; the horse is led away at a walk.
- `volley` is not used yet: each man's draw is already timed to his own `S.nextShot`.

---
# Siege of a castle → renderer / UI / audio (SIEGE-MECH, js/sim/siege.js + js/sim/siege-works.js)

The full list with fields is in docs/castle-plan.md §4.1. The ones that drive pictures and sound:
- `wall-state` {building, mod, state: intact|pocked|cracked|breach, was, x, y, tower} — swap the module's kit piece
  (also readable any time as `b.mstate[k]`, 0..3). `wall-breached` / `tower-collapsed` / `mine-collapse` {x, y, full}
  — the fall: dust, rubble, the rumble. A breach leaves a `breach_rubble` feature (the slope) in `w.features`.
- `mine-fired` {x, y} — smoke from the gallery mouth; `mine-collapse` follows ~0.3 econ day later.
- `portcullis-dropped` / `portcullis-raised` {building, x, y}; `b.portDown`, `b.gl` (leaves 0..1), `b.gpc`
  (portcullis 0..1); `gate-leaves-broken`, `portcullis-broken`, `gate-broken`.
- `gate-fired` / `gate-fire-out`; `b.gfire` 0..1 is the fire's size (js/render/fire.js).
- `dropped` {who, by, cause: murder-hole|machicolation|parapet, what: stone|sand} — a stone (or a pale cloud of sand
  and lime) falling from `by` onto `who`; the kill/down that follows carries the same cause.
- `ladder-pushed` {x, y, broken}; ladders are also in `w.siege.ladders` and, on a castle, `castle.links` (`ladder`).
- `breach-barricaded` {x, y} / `barricade-broken` — the retrenchment (a `breach_barricade` feature while it stands).
- `sally-out` / `sally-back` / `sally-in`; `surrender` {team, terms, garrison} — the end-screen moment.
