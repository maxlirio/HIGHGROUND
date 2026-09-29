# HIGHGROUND — Combat & Morale Model Spec (research basis)

Scope: 13th–14th c. northern Europe, one dot = one soldier. The model aims at what happens to a man in a fight, and what makes him stay or run. It is not meant as a board-game abstraction. Every number below either cites a source (keys at the end, `[KEY]`) or is labelled **DERIVED** (computed by us from cited inputs) or **DESIGN** (an informed choice we must calibrate in the Monte-Carlo harness, see §17).

Four ideas drive everything:

1. **Men fight to survive, not to kill.** "Man does not enter battle to fight, but for victory. He does everything that he can to avoid the first and obtain the second." [DUPICQ] About ¾ of front-rankers "fought more with the aim of staying alive, than of actually aiming to kill the enemy" (Goldsworthy, quoted in [SABIN] p.11).
2. **Combat is pulsed.** Brief surges of hand-to-hand fighting separate into a "default state" stand-off at a small distance, with insults and missiles. The lines surge again when someone nerves himself to it, and the sequence ends when one side runs [SABIN] pp.13–15.
3. **Killing happens in the rout.** Victors "usually suffered less than 5 per cent fatalities". Hoplite losers averaged 14 % (Krentz, in [SABIN] p.5). When losers were caught, encircled or pursued by cavalry, "over half the defeated army" could die [SABIN]. At Cannae Hannibal's cavalry killed 3,000+ Roman horse for <200 of their own, "because they took to flight … and were struck with impunity from behind" [DUPICQ, Cannae analysis].
4. **Friction.** Orders are late, wrong or lost. Commanders see little. Plans must be simple [CLAUSEWITZ; BANNERS].

---

## 0. Time and space scales

| Quantity | Value | Basis |
|---|---|---|
| Sim tick | 0.25 s game-time | DESIGN. Resolves a sword blow (≈0.5–1 s) and an arrow flight (0.2–7 s, §9). |
| "Exchange" | one attack attempt resolution between two soldiers in reach | DESIGN |
| Flurry (pulse) | 10–60 s, mean ≈25 s | DERIVED from anaerobic capacity, §6: W′≈20 kJ at ~400 W above CP ≈ 50 s max |
| Lull | 1–5 min, mean ≈2.5 min, lines 2–10 m apart | [SABIN] "safety distance"; Appian's Forum Gallorum pause "as in gymnastic games" |
| Line fight, equal steady foot | 30 min – 3 h, rarely 5 h | [SABIN] p.3 (Vegetius: "two or three hours"; Caesar up to 5 h); Agincourt ≈3 h [AGIN]; Hastings ≈ all day |
| Contact fraction of an engagement | 10–30 % of elapsed time spent in flurries | DERIVED: needed to keep victors ≤5 % dead (§17) |

1 world unit = 1 m (art bible). Man 1.72 m, 0.45–0.55 m shoulder width.

---

## 1. Per-soldier attributes

All ranges are for the population. Sample from truncated normals unless noted.

### 1.1 Body
| Attr | Unit | Levy | Trained | Elite | Notes |
|---|---|---|---|---|---|
| `mass` | kg | 55–70 | 60–75 | 65–85 | Medieval male stature ≈1.70–1.72 m |
| `strength` | 0–1 | 0.35–0.6 | 0.45–0.7 | 0.6–0.9 | Scales blow energy (§3) and bow draw |
| `CP` (critical power) | W | 150–190 | 180–220 | 200–250 | Power sustainable for hours (critical-power model, [CP]) |
| `Wprime` | kJ | 12–18 | 16–22 | 20–28 | Anaerobic reserve. It limits flurries |
| `glycogen` | h at CP | 2.5–3.5 | 3–4 | 3.5–4.5 | Long-duration fatigue; refilled by food (§6.3) |
| `bloodVol` | L | 5.0 | 5.0 | 5.2 | Loss >30 % ⇒ unconscious, >40 % ⇒ death [ATLS] |
| `hydration` | L deficit | 0 | 0 | 0 | >2 % body-mass loss ⇒ −10–20 % capacity [HEAT] |

### 1.2 Mind
| Attr | Range | Meaning |
|---|---|---|
| `skill[weapon]` | 0–1 | Parry/strike quality per weapon class. Levy 0.1–0.3, trained 0.35–0.6, elite 0.6–0.9 |
| `aggression` | categorical | **fighter** 15 %, **cautious** 70 %, **passive** 15 % (DESIGN from Goldsworthy's ¾ figure in [SABIN]; Marshall's WWII ratio of firers [MARSHALL] has been challenged, so treat it as a tunable) |
| `nerve` | 0–1 | Resistance to stress gain. Levy 0.3±0.1, trained 0.5±0.1, elite 0.7±0.1 |
| `discipline` | 0–1 | Drill: keeps formation and order latency (§12), resists breaking ranks to pursue or loot |
| `experience` | battles survived | +0.03 nerve per battle up to +0.15; the first battle is the worst |
| `loyalty/bond` | 0–1 per unit and leader | Scales how much a leader's presence or death moves stress |
| `ransomValue` | pennies | Knights ≫ commoners. It sets whether surrender is accepted (§11.6) |

### 1.3 Kit
`armourMap` gives each body zone (head, face, neck, torso-front, torso-back, arms, hands, thighs, shins, feet) a list of layers `{material, thickness_mm, quality}`. Also `shield {type, area_m2, facing}`, `weapons[]`, `ammo`, `loadKg` (armour + weapons + kit), and `mounted {horse ref}`.

### 1.4 State
`posture` (standing, crouched, down, prone, dead), `wounds[]`, `bleedRate` (L/min), `Wbal` (kJ), `stress` (0–1), `status` (formed, wavering, shaken, fleeing, rallying, surrendered, captive, looting), `facing`, `velocity`, `knownContacts` (fog of war, §13), `currentOrder` + `orderAge`.

---

## 2. Hit location

Skeletal evidence shows that heads and legs are what get hit, and that the torso is protected.

- **Towton (1461):** 113 wounds on 28 skulls, against 43 post-cranial wounds on all 38 bodies [TOWTON]. Many men were evidently not wearing helmets when they died. One skull (Towton 25) had 8 head wounds, which is overkill on men already down.
- **Visby (1361):** 1,185 individuals. Wounds are concentrated on skulls and legs, lower legs above all, because torsos were covered by mail and shields. One skeleton had both lower legs severed in a single blow [VISBY].

**Base melee hit-location weights** (standing, facing, no shield). DESIGN, fitted so that a mail-and-shield soldier's wound pattern reproduces Visby/Towton (head and legs dominant):

| Zone | Head | Face | Neck | Torso | Arms | Hands | Thighs | Shins/feet |
|---|---|---|---|---|---|---|---|---|
| Weight | 18 | 4 | 3 | 30 | 16 | 5 | 12 | 12 |

Modifiers:
- **Shield** (heater 0.25–0.3 m², kite 0.4 m²) on the guarded side: skill-dependent block chance, 0.35 + 0.4·skill against frontal blows to torso, left arm and thigh. Blows deflect to head (+50 %) and shins (+60 %). This is the Visby leg-wound mechanism.
- **Soldier down:** head weight ×3. This is the Towton coup-de-grâce pattern.
- **Mounted target, attacker on foot:** thighs ×2 and horse ×1 (a new zone, see §10); head and neck ×0.3.
- **Plunging arrows (>20° impact):** head and shoulders ×2; shins ×0.3.

---

## 3. Weapons

Energies are in joules delivered at impact. Williams' measured band for "a normal sword or axe blow" is **60–130 J** [WILLIAMS via ACOUP]. Blow energy = `E_base · (0.6 + 0.6·strength) · fatigueFactor` (fatigueFactor 1 → 0.6 as W′ is exhausted).

| Weapon | Reach m | Mass kg | Mode | E_base J | Blows/min in flurry (fighter / cautious) | Ranks that can strike | Notes |
|---|---|---|---|---|---|---|---|
| Arming sword | 0.9 | 1.1–1.4 | cut / thrust | 80 cut, 60 thrust (area small) | 20 / 5 | 1 | Thrust concentrates energy; prefer vs mail gaps |
| Falchion / seax | 0.8 | 1.2–1.5 | cut | 100 | 18 / 5 | 1 | |
| Hand axe | 0.7 | 1.0–1.5 | cut / hook | 100 | 16 / 4 | 1 | Can hook shields (−shield block 0.15) |
| Dane axe / pollaxe | 1.6 | 2.0–3.0 | cut / blunt / thrust | 130–180 | 10 / 3 | 1 (2 with gaps) | Two-handed, no shield |
| Mace / war hammer | 0.7 | 1.2–1.8 | blunt / spike | 100 blunt | 16 / 4 | 1 | Blunt transmits through mail and plate (§4.3) |
| Spear, one-handed | 2.2–2.5 | 1.5–2.0 | thrust | 70 | 20 / 6 | 1–2 | With a shield: the default infantry weapon |
| Long spear / goedendag | 1.5–3 | 2.0–2.5 | thrust / blunt | 90 | 14 / 4 | 1–2 | Goedendag at Courtrai [COURTRAI] |
| Pike (late-14th c. Flemish/Scots) | 4.5–5.5 | 3–4 | thrust | 80 | 10 / 4 | 1–4 | Schiltron [BANNOCK]; ranks 2–4 present points |
| Couched lance (mounted) | 3.5–4 | 3–4 | thrust | **200–600, capped by shaft breaking** | 1 per pass | cav rank 1 | DERIVED. 600 kg horse+rider at 7 m/s = 14.7 kJ available; a lance shaft fails at a few kN, so delivered energy is limited by the break |
| Knife / dagger (grappling) | 0.3 | 0.3 | thrust | 40 (focused point) | 30 | 1 (clinch only) | Kills men who are down, through visors and armpits |
| Club / flail (levy) | 0.8 | 1.0 | blunt | 70 | 16 / 5 | 1 | |

The hit chance of an exchange is resolved in §7. Weapon length matters most at the first contact: a spear against a sword gives the spear +0.15 first-strike chance for the first 2 s of a flurry. Inside 1 m, short weapons get +0.15.

---

## 4. Armour and penetration

### 4.1 Material thresholds

These are the energy levels at which the weapon starts to go through. Sources: Williams' tests as summarised in [ACOUP], the arrow-vs-mail tests [JMMH18], and Bane's shoot tests in [LONGBOW-WIKI].

| Armour | vs cut | vs thrust / spear | vs bodkin arrow | vs broadhead arrow | vs blunt (transmits) |
|---|---|---|---|---|---|
| Linen/wool clothing | 5 | 3 | 2 | 2 | 100 % |
| Gambeson, 16 layers linen | **80** | **50** | 50 | 35 | 70 % |
| Padded jack, 26 layers (quilted) | **200** | 90 | 80 | 60 | 55 % |
| Cuir bouilli 5 mm | **90** | **30** | 40 | 45 | 70 % |
| Riveted mail alone | >150 (effectively immune to cuts: "a 200 J halberd blow failed to defeat mail") | 140–200 (Williams' spearhead estimate) | **80** splits rings | 110 | 90 % |
| Mail over gambeson | immune | 180+ | **100** penetrates the padding, **120** total failure | 150 | 50 % |
| Iron plate 1 mm (quality 0.7) | immune | 90 | 70 | immune-ish (260) | 40 % |
| Steel plate 2 mm | immune | 250 | **175** | immune | 30 % |
| Coat of plates (1–1.5 mm iron + textile) | immune | 150 | 110 | 300 | 35 % |

Plate penetration scales with thickness and quality (DERIVED fit through the Williams 2 mm = 175 J point):

```
E_pen_plate(t_mm, Q) = 175 J · (t / 2.0)^1.6 · Q
Q: bloomery iron 0.6–0.75 · mild steel 0.85–1.0 · hardened steel (late 14th c. Milanese) 1.3–1.5
```

Thickness varies across a harness: helmet crown 1.5 mm, breastplate 1.3 mm, legs 0.7 mm in one surviving example [ACOUP]. Model per zone.

**Angle of incidence.** Effective energy is `E·cos²θ`. Beyond θ≈55°, a point glances (P(glance) rises linearly from 0 at 45° to 1 at 70°). Stretton's heavy arrow still went through a brigandine at 40° off perpendicular [LONGBOW-WIKI].

### 4.2 Wound from residual energy

`E_res = E_eff − E_pen` of the outer layer. Then apply each inner layer in turn (for mail + gambeson, use the combined row).

- **Point weapons:** penetration depth into flesh ≈ `E_res / 1.2 J·mm⁻¹` (DESIGN, so that 50 J of residual gives ≈40 mm). **>40 mm into the torso is "potentially lethal"** [JMMH18]. Neck, face and armpit gaps have no armour, so a 40 J dagger kills through them.
- **Cutting:** cut depth ≈ `E_res / 1.5 J·mm⁻¹`. Limbs: >25 mm ⇒ disabling, >50 mm on a shin ⇒ severs (Visby).
- **Blunt:** transmitted energy `E·transmit%`. Skull: >60 J ⇒ fracture/concussion (P=0.5), >100 J ⇒ likely incapacitation. Limb >80 J ⇒ fracture.

### 4.3 Wound severity outcome

| Class | Effect | Bleed L/min | Typical cause |
|---|---|---|---|
| Bruise / none | stress +0.02, W′ −1 kJ | 0 | Energy absorbed |
| Light | −10 % skill; stress +0.05 | 0.01–0.03 | Shallow cut |
| Disabling | limb unusable (drop shield or weapon; leg ⇒ `down`) | 0.05–0.2 | Deep limb cut, fracture |
| Incapacitating | `down`; P(dies within 24 h) 0.3–0.6 without care | 0.1–0.5 | Torso penetration >40 mm, skull fracture |
| Mortal | `down`, dies in 1–30 min | 0.5–2.0 | Arterial neck/thigh, deep torso |
| Instant | dead | — | Brain, heart, severed neck |

Most men are not killed outright in the line. They go **down**, and the rout or the aftermath (§11) turns downed men into dead men. That produced the Towton overkill pattern.

---

## 5. Frontage, ranks and who can fight

| Formation | Frontage per man | Rank depth | Density men/m² | Striking ranks | Source / basis |
|---|---|---|---|---|---|
| Shield wall / close order foot | 0.75–0.9 m | 1.0 m | 1.1–1.3 | 1 (+2 with spears) | DESIGN; shoulder width 0.5 m plus arm room |
| Open order foot (skirmish) | 2–5 m | 2–5 m | 0.05–0.25 | 1 | |
| Pike block / schiltron | 0.9 m | 0.9–1.0 m | 1.2 | 4 present points; rank 5+ push and replace | [BANNOCK]; DESIGN |
| Archers behind stakes | 1.2–2 m, staggered in 3–6 ranks | 1.5 m | 0.3–0.5 | all ranks shoot (lofted) | Agincourt 750 yd field [AGIN] |
| Close-order cavalry ("knee to knee", conroi of 20–30) | 1.0–1.2 m per rider | 3.0 m | 0.3 | rank 1 (rank 2 follows into gaps) | [VERB] via [CAVCHARGE] |
| Loose cavalry | 2–4 m | 4–8 m | 0.05 | rank 1 | |

**Rules:**
- A soldier can **strike** a target within his weapon reach + 0.5 m (lunge), provided the path is not blocked by a friend's body. Spears and pikes can pass between front-rankers.
- A front rank can **be struck by** at most about 3 opponents at 0.8 m frontage. Only with an open flank, or when isolated, can 6–8 reach one man. This is why melee follows Lanchester's *linear* law locally, not the square law, and why depth does not add kills.
- **Rear ranks do three things:** (a) they supply morale (stress −0.02 per supporting rank up to 6, du Picq's "moral impulsion"); (b) they replace the fallen and exhausted front-rankers during lulls (rotation takes 10–20 s); (c) they physically *prevent* the front rank from backing off. The same pressure turned lethal at Agincourt, where the press of men behind pushed the living onto the dead and some suffocated [AGIN].
- **Crowd crush:** if density exceeds 3 men/m² for more than 10 s, each man in the crush has P(fall) = 0.01/s. A fallen man in a press has P(asphyxia) 0.02/s while more than 2 bodies lie on top (DESIGN, calibrated to the Agincourt "piles").

---

## 6. Fatigue (physiology, not a stamina bar)

### 6.1 Locomotion cost
Use the **Pandolf equation** [PANDOLF] with the terrain factor η from `js/sim/terrain-types.js` (`fatigueMul`):

```
M (W) = 1.5·W + 2.0·(W+L)·(L/W)² + η·(W+L)·(1.5·V² + 0.35·V·G)
W body kg, L load kg, V m/s, G grade %
```
- Armour penalty: **net cost of locomotion is ×2.1–2.3 walking and ×1.9 running in 30–50 kg of 15th-c. plate** [ASKEW]. That is more than the same mass carried on the trunk, because the limbs are loaded and breathing is restricted. Rule: add `armourLimbMass × 1.0` extra to `L`, and cap VO₂ at 0.85 of maximum when wearing a closed helm or a tight breastplate.
- Grade: each +1 % grade adds ≈18 % of the level-walking locomotion term at 1.33 m/s (DERIVED from Pandolf). Downhill cost falls to a minimum at about −10 % and rises again on steeper descents (braking).

### 6.2 Combat work and W′
- Flurry work rate ≈ 500–800 W for a man in mail swinging a sword and shield. Hold ≈ 250–350 W (guard, shoving, holding position). Lull ≈ standing + breathing ≈ 120–180 W. (DESIGN; consistent with near-VO₂max work in combat sports.)
- **W′ balance** [CP]: below CP, W′ refills with time constant `τ = 546·e^(−0.01·(CP−P)) + 316` s, which gives ≈390–650 s. A 2.5 min lull restores only ~25–35 % of W′.
  - **Consequence (emergent):** successive surges get shorter and weaker, and a fresh unit committed late has a large, real advantage. This matches the historical value of reserves.
- Effects of low W′: at <30 % of W′, blow energy ×0.8, parry skill ×0.85, and the man will not step forward (joins "cautious"). At <10 %: blows ×0.6, parry ×0.6, P(stumble) ×2. At 0: he can only defend or yield ground.

### 6.3 Long fatigue, heat, hunger
- `glycogen` drains at `max(0, P−0.5·CP)/CP` hours per hour. Below 20 %, CP ×0.75. A battle that starts after a night march with no breakfast (Agincourt men-at-arms, Bannockburn English) starts at 60–70 %.
- **Heat:** in armour plus gambeson, sweat is 1.0–2.0 L/h at >20 °C under exertion (DESIGN from [HEAT]). A deficit >2 % of body mass costs −10–20 % CP and W′. P(heat collapse) per hour = 0.01·(deficit % − 3) above 3 %.
- **Hunger:** less than 60 % of the ration for more than 3 days gives CP −10 %, nerve −0.05 (see economy doc).

---

## 7. Melee resolution (per exchange)

When soldier A attacks B, both in reach:

1. **Willingness.** A attacks only if `status ∈ {formed, wavering}` and `W′ > 10 %`, with a per-second attack hazard that depends on aggression class (§3 blows/min). Passive men only parry.
2. **Defence roll.**
   - `P(parry/void) = 0.25 + 0.45·skill_B − 0.25·skill_A + stanceMods` (clamped 0.05–0.9).
   - Shield block (§2) applies first if the blow lands on the shield arc.
   - Footing: roll the terrain `footing.slip` for both. Slip ⇒ that man's next defence −0.3, and on a failed recovery (`footing.fall`) ⇒ `down`.
3. **Location** from §2, then **armour** from §4, then **wound** from §4.3.
4. **Stress** (§11) to both, and to watchers within 5 m.

**Calibration target for exchange lethality** (DERIVED from Sabin's numbers). Sabin notes that with only 5 % of men in the front rank, striking every 5 s, and <1 % of strikes lethal, each army would lose **5 % every 10 minutes**, which is far above the historical rate. Therefore:
- Mean hazard of **incapacitation or worse per front-ranker per minute of flurry**, mail vs mail, equal skill: **3–6 %**. Unarmoured levy vs levy: 8–15 %.
- Combined with a contact fraction of 10–30 % and front-rank rotation, this gives a loss for a steady unit of ≈1–3 % per hour of line fighting. That fits the ≤5 % victor loss over 1–3 h [SABIN].

---

## 8. The pulse/lull cycle (emergent state machine per contact sector)

The line is divided into sectors of about 10 m. Each sector has a **surge pressure** `Π`:

```
Π = Σ_front (aggressionWeight · (1 − stress) · W′frac) / N_front
  + 0.15 · leaderWithin15m + 0.1 · musicianOrWarcry + 0.1 · enemyWavering
  − 0.2 · recentLossesInSector(60 s)
```

- **Approach → contact:** a surge begins when `Π > 0.45` on either side (DESIGN). The side with higher Π closes. If the defender's Π < 0.2 and stress > 0.6, it may break **before contact** (the "bayonet-charge" effect, "decided at the first shock" [SABIN] p.13). Expected share of engagements decided at first shock: 30–50 % when the morale gap is large, <10 % between veterans.
- **Flurry** lasts until either side's mean W′ < 35 % or its sector losses exceed 2 men in 10 s. The losing side **steps back 1–3 m** (ground is lost here).
- **Separation:** the lines back off to 2–10 m, the "safety distance" [SABIN]. During the lull: rotation of front-rankers (discipline ≥0.5 units only); insults and missiles (thrown stones, javelins, arrows at 5–30 m); wounded crawl or are dragged back; W′ recovers per §6.2.
- **Repeat.** Each cycle raises accumulated stress on both sides. The side whose stress first crosses the break threshold (§11) runs. That is where the dying begins.

---

## 9. Missiles

### 9.1 Weapons (DERIVED from the ballistic model below, calibrated to published data)

| Launcher | Draw | Missile | v₀ m/s | E₀ J | Max range (flat) | Rate aimed / max | Source |
|---|---|---|---|---|---|---|---|
| Warbow (yew) | 130–160 lbf (Mary Rose avg 150–160 [LONGBOW-WIKI]) | 64 g livery, bodkin | 53 | **90** | ≈235–270 m | 6/min sustained with heavy bows, **10/min** bursts | Stretton 144 lbf, 102 g → 47.2 m/s, 114 J; Gibbs 170 lbf, 64 g → 267 m [LONGBOW-WIKI]; Crécy "up to ten a minute" [CRECY] |
| Warbow, heavy shaft | 150 lbf | 96 g | 47 | **106** | ≈200–250 m | 6/min | 150 lbf replica, 96 g → 250 m [LONGBOW-WIKI] |
| Hunting / levy bow | 60–90 lbf | 45 g | 48 | **52** | ≈190 m | 10/min | Hedgeley Moor bow 61 lbf [LONGBOW-WIKI] |
| Crossbow, 13th c. composite, belt-hook or goat's-foot | 250–400 lbf (short power stroke) | 60–75 g | 42–46 | **60–75** | ≈170 m | **2–3/min** (goat's foot 3/min, Genoese ≈2/min at Crécy) | 275 lbf, 54.6 g → 63 J (measured) [XBOW]; [CRECY] |
| Crossbow, steel prod + windlass (late 14th c.) | 800–1,200 lbf | 90–100 g | 48 | **105–115** | ≈200 m, accurate to ~100 m | **1/min** | Todeschini 976 lbf, 96 g → 47.9 m/s = 110 J [XBOW]; windlass 1/min [XBOW-RATE] |
| Javelin / dart | — | 0.4–0.8 kg | 18–22 | 80–150 | 30–40 m | 3–4/min, 2–4 carried | DESIGN |
| Sling | — | 50 g stone | 30–35 | 25–30 (blunt) | 150 m | 8/min | DESIGN |
| Thrown stone (lull harassment) | — | 0.3–1 kg | 12–15 | 30–70 blunt | 25 m | 6/min | DESIGN |

Crossbows are energy-inefficient: 5–10× the draw weight of a warbow yields roughly the same joules, because of the short power stroke. What they buy is a trained-in-weeks shooter and aimed, flat fire.

### 9.2 Ballistic model (point-mass with quadratic drag)
`a = −g ŷ − k·|v_rel|·v_rel`, where `v_rel = v − wind`. Values of k: livery arrow 0.0010 m⁻¹, heavy arrow 0.0007, levy arrow 0.0013, 13th-c. bolt 0.0012, heavy bolt 0.0010. These reproduce the flight ranges above within about 10 %.

**Energy remaining vs range (lowest trajectory hitting the range; ↓ = impact angle below horizontal):**

| Missile | 25 m | 50 m | 100 m | 150 m | 200 m | Time of flight at 200 m |
|---|---|---|---|---|---|---|
| Livery 64 g / 90 J | 85 J, 3° | 81 J, 5° | 74 J, 12° | 68 J, 20° | 63 J, 30° | 4.7 s |
| Heavy 96 g / 106 J | 102 J | 99 J | 93 J, 15° | 87 J, 24° | 85 J, 44° | 6.1 s |
| Levy 45 g / 52 J | 49 J | 46 J | 40 J | 36 J | — | — |
| 13th-c. bolt 70 g / 71 J | 67 J | 63 J | 56 J, 17° | 52 J, 31° | — | — |
| Windlass bolt 90 g / 108 J | 103 J | 98 J | 89 J, 14° | 82 J, 24° | 78 J, 40° | 5.6 s |

**Penetration consequences (DERIVED; §4 thresholds):**

| Target zone armour | Livery arrow | Heavy arrow | 13th-c. bolt | Windlass bolt |
|---|---|---|---|---|
| Unarmoured / clothing | lethal at all ranges | lethal | lethal | lethal |
| Gambeson 16 layers | penetrates ≤200 m (bodkin); broadhead ≤200 m | yes | yes ≤150 m | yes |
| Mail alone | penetrates at all ranges (splits at 80 J only ≤50 m; below that the bodkin still goes 20–40 mm in: "penetration to a potentially lethal depth at almost every shot" at 70 lbf [JMMH18]) | yes | marginal ≤50 m | yes ≤150 m |
| Mail + gambeson | **no** beyond ~25 m; wound only if E_res>0 | **marginal ≤75 m** | no | **yes ≤50 m**, marginal ≤100 m |
| Coat of plates | no (except weak spots) | marginal ≤25 m | no | marginal ≤25 m |
| 2 mm steel plate | **no** (Tod's 2019 tests: no frontal penetration at any range, with 160 lbf) | no | no | no |
| Horse, unbarded | lethal/disabling at all ranges | yes | yes | yes |

So against men-at-arms, arrows **kill the horses** and wound limbs, faces and the less-armoured. They disorder and enrage rather than slaughter. This matches the Agincourt and Crécy narratives: the arrows broke the charges, and the killing of the French was done hand-to-hand by archers with mallets and hatchets once the French were disordered and exhausted in the mud [AGIN].

### 9.3 Aiming and dispersion
- **Aimed (direct) fire**, target ≤80 m: angular dispersion σ = 0.8° (skill 0.9) to 2.0° (skill 0.2). Hit if the ray intersects the target's presented silhouette, 0.45 × 1.7 m standing, including 0.3 m² of shield.
- **Area (lofted) fire at a formation:** landing points are drawn from a 2-D normal around the aim point with σ_long = 0.04·R and σ_lat = 0.02·R (DESIGN; plausible for experienced archers). Each landing point is tested against the plan-view footprints (0.25 m² per man, 1.2 m² per horse) and the upper-body projection at the actual impact angle.
- **Implied expectation** (DERIVED): at 200 m into a close-order block of 1.2 men/m², ~25–35 % of arrows strike a man or horse.

### 9.4 Ammunition and supply
- Archer: **24 arrows per sheaf; 60–72 per man per battle** (at Crécy two extra quivers were issued on the morning, giving 72 [CRECY]). The English crown bought 51,350 sheaves (1.23 M arrows) between 1341 and 1359 [LONGBOW-WIKI].
- A 5,000-archer army at 72 arrows each carries ~360,000 arrows. "Half a million arrows could have been shot" at Crécy [CRECY].
- **Arrow recovery:** 30–50 % of arrows landing in the open field are recoverable. Towton's Yorkists "collected the enemy's wasted shafts … and fired them back" [TOWTON-WIND].
- **Burst budget:** at 10/min an archer is dry in 6–7 min. At a sustainable 4–6/min it lasts 12–18 min. Resupply needs pages, carts and wagons (economy doc).
- Crossbowman: 18–50 bolts; needs a **pavise** (0.9 × 1.3 m, hard cover 0.9 frontal) for the reload. At Crécy the Genoese had left the pavises and reserve bolts in the baggage [CRECY].

### 9.5 Missile-stress
Being shot at without being able to reply is the most corrosive stress there is. It is set out in §11.

---

## 10. Cavalry

### 10.1 Horse
| Attr | Value | Source |
|---|---|---|
| Destrier mass | ≥400 kg, 15–16 hands; carries ≈160 kg (rider 70 + kit 90) | [HORSE-NISKANEN] |
| Rounceys / hobelars | 300–400 kg | DESIGN |
| Gaits | walk 7 km/h, trot 13, canter 16–27, gallop 40–48 (unburdened racehorse; war-laden ~30) | [GAIT] |
| Gallop endurance | 1.5–3 km before blown | [GAIT] |
| Charge schedule | walk → trot → gallop only for the **last ~200 m** (≈220 yd) | [CAVCHARGE, citing Verbruggen] |
| Horse armour (bard) | mail bard 20–40 kg; rare in the 13th c. | [HORSE-NISKANEN]; [EXARC-BARD] |

### 10.2 Charging formed infantry: the refusal rule
Horses will not run into a solid obstacle they cannot see through or over. At the moment of contact, each horse rolls against **refusal**:

```
solidity = steadiness(front 3 ranks, 1−mean stress) × min(1, density/1.1) × min(1, ranks/3)
         × (1 + 0.3·pointsPresented) × terrainChargeViable(ground in last 30 m)
P(refuse) = clamp(0.05 + 0.95·solidity², 0.02, 0.97)
```

| Target | P(refuse) per horse | Outcome |
|---|---|---|
| Steady close-order spears or pikes, ≥3 ranks | 0.85–0.97 | Horses shy, pull up at 3–10 m, mill and turn. The riders are then targets |
| Steady infantry, 1–2 ranks | 0.5–0.7 | Some contact; lances unseat front men |
| Wavering (mean stress >0.5), gaps opening | 0.2–0.4 | Penetration, and the formation fragments |
| Disordered, fleeing or crossing an obstacle | 0.02–0.05 | Slaughter |
| Stakes or a ditch between (Agincourt, Courtrai, Bannockburn pits) | horse cannot cross at speed; P(fall) 0.3–0.6 if forced | [COURTRAI]: "many horses refused; men and horses fell into the ditches" |

Contact physics: the contacted infantryman is knocked `down` with P = 0.4 + 0.4·(speed/8 m/s) − 0.3·bracedSpear. The horse takes the braced-spear thrust (spear E ≈ horse closing KE × 0.01, capped by shaft break at ~300 J). A horse with a torso wound has P(fall) 0.5, and its rider is `down` and stunned for 2–10 s.

**Cavalry-vs-cavalry** is usually decided before contact. One side turns (du Picq on the Roman horse at Cannae: charges were repeated until "one of the two … turned in flight and was pursued to the limit" [DUPICQ]). When both close, it becomes a mêlée of individuals, often dismounted.

**Repeat charges** cost W′ for horse and rider. French knights made 15–16 charges at Crécy, from late afternoon to near midnight [CRECY]. Each charge that ends in refusal adds stress +0.08 to the riders and −0.05 to the infantry (the infantry gain confidence).

---

## 11. Morale

### 11.1 State per soldier
`stress ∈ [0,1]`. Its thresholds map to behaviour:

| Stress | Status | Behaviour |
|---|---|---|
| <0.45 | formed | Obeys orders; may surge |
| 0.45–0.65 | wavering | Won't advance on his own; aggression class drops one step; slower to follow orders (+50 % latency) |
| 0.65–0.85 | shaken | Backs off during lulls, won't enter flurries, looks for exits; drops heavy kit at >0.8 |
| >0.85 (and a trigger) | **fleeing** | Runs from the threat. Drops shield (+10 % speed) |
| fleeing, cornered | surrender / fight at bay | §11.6 |

### 11.2 Stress inputs (per second unless noted; DESIGN, to be tuned against §17)
Gains are multiplied by `(1.3 − nerve)`.

| Input | Δstress |
|---|---|
| Friend killed or downed within 3 m (seen) | +0.04 (+0.08 if a messmate/bond) |
| Wounded self (light / disabling) | +0.05 / +0.20 |
| Under missile fire with no ability to reply, per arrow landing within 3 m | +0.006; ×2 if friends are falling |
| Enemy on flank (within 20 m, outside the ±60° front arc) | +0.01/s |
| Enemy to rear | +0.02/s |
| Cavalry charging at you (visible, <150 m, gallop) | +0.004/s, ×0 if in a steady ≥3-rank spear block; ×2 in the open |
| Leader killed (seen, or rumour within 30 s via neighbours) | +0.15 one-off; bond-weighted |
| Leader or banner present within 30 m | −0.004/s (decay term) |
| Friend fleeing within 30 m (visible) | +0.015/s each, capped +0.06/s. **This is contagion** |
| Unit within 150 m breaks (visible) | +0.10 one-off; ×0.5 at 150–400 m if it is large (a whole "battle"/division) |
| Flanks anchored (wood, river, wall within 20 m) | −0.002/s |
| Each supporting rank behind (up to 6) | −0.0005/s |
| Enemy flees before you | −0.05 one-off (winners become braver) |
| Night / fog (can't see friends) | +0.002/s |
| W′ < 10 % | +0.003/s (exhaustion breeds fear) |
| Baseline decay when not threatened | −0.003/s toward the unit's baseline |

### 11.3 Break trigger (the actual run)
A soldier with stress >0.85 flees when any of these holds:
(a) a friend within 5 m is already fleeing;
(b) an enemy is on his flank or rear within 10 m;
(c) he is wounded;
(d) his unit's `brokenFrac > 0.2`.
Otherwise he holds, shaken (the lone brave man).

**Unit break:** when `brokenFrac ≥ 0.3`, or the front collapses (a front sector with <40 % of its men standing), the unit status becomes `broken`. Every member gets +0.25 stress, and cohesion is gone.

**Historical check on break casualties (DESIGN target):** ordinary units break after 5–15 % losses. Elite or trapped units hold to 25–40 %. Walls of men who could not flee (Cannae's encircled legions) fought to near annihilation [DUPICQ].

### 11.4 Contagion radius summary
- Direct: **30 m**, individual visible flight.
- Neighbour unit: **150 m**, full; up to **400 m** at half effect for large units, line-of-sight only.
- Rumour: "the king is dead" or "treason!" propagates at runner speed through the army, ≈3 m/s, and loses 10 % of its strength per 100 m. At Barnet, a badge misidentified in fog triggered a cry of treason and a collapse [BARNET].

### 11.5 Rally
A fleeing soldier can stop when all of these hold:
- no enemy within 150 m (cavalry: 300 m);
- he has passed an obstacle, or has run 200–500 m;
- stress has decayed below 0.6 (decay −0.004/s while not pursued, ×2 near a leader or banner).

A **leader rally**: a leader with nerve >0.6 standing still with a banner pulls fugitives within 50 m toward him. After 60–120 s of regrouping they re-form at stress 0.5 and `formed`. Rallied units carry a permanent −0.1 nerve for the rest of the battle.

Typical rally time from flight to re-formed: 5–15 min. Rate of success: ~30–50 % of fugitives for a good leader, near 0 % when pursued.

### 11.6 Surrender and quarter
A cornered fugitive (no escape path, enemies within 5 m) either surrenders (P = 0.6 if ransomValue is high, 0.3 otherwise) or fights at bay (+0.3 aggression, a "cornered animal").

Quarter granted: P = 0.9 for a high ransom value if the victor's discipline is ≥0.5 and no "no prisoners" order is in force. It is 0.2 for commoners. At Courtrai the Flemings took no prisoners; at Agincourt Henry ordered prisoners killed. Captives may be killed later on an order.

---

## 12. Pursuit and rout casualties

- **Speeds:** fleeing lightly armed foot sprint 5–6 m/s for 20–60 s (W′), then 2–3 m/s jog/walk. Men in mail and gambeson reach 4 m/s and then 1.5–2 m/s ([ASKEW] cost multiplier). Pursuing cavalry trot or canter at 4–7 m/s for kilometres.
- **Kill rate:** a pursuing horseman or light foot kills a **back-turned, non-resisting** man with P(incapacitate per attack) = 0.35–0.6. Cutting at head and back gives the Towton skull-wound pattern. Per pursuer that is one victim per 15–40 s while targets are dense.
- **Why pursuit stops:** darkness; pursuer W′ and horse blown after 2–3 km of fast work; **pursuers loot or take prisoners** (each pursuer rolls P = 0.02/s × (1 − discipline) to stop and loot or ransom); recall orders; terrain (woods, marsh); the fugitives' own rally.
- **Obstacles in flight:**
  - A river behind the routers: drowning P = 0.05–0.3 per man crossing, higher in armour. Bannockburn: English killed or drowned "15,000" [BANNOCK].
  - A bridge or bottleneck: throughput is limited by `FEATURES.bridge.menAbreast`. Stirling Bridge was "broad enough to let only two horsemen cross abreast"; ~2,000 English were caught across it [STIRLING].
- **Downed men:** in the rout, the victor's infantry passing over the field kill downed enemies at P = 0.5 per man passed (DESIGN, from the Towton head-wound overkill).

---

## 13. Command & control (friction)

Orders travel. Every order issued by the player goes from the **commander entity** to the **unit leader**, who executes it through his men.

| Channel | Speed / range | Latency | Failure modes |
|---|---|---|---|
| Mounted messenger | 20–30 km/h on open ground × terrain `moveMul.cavalry` → 5.5–8 m/s | + find the leader: 20–90 s | Killed or captured (real entity on the map); P(garble) 5–10 %; takes the wrong route |
| Runner on foot | 3–4 m/s | + 20–60 s | Same; tires |
| Trumpet or horn call | Pre-arranged vocabulary only (advance / halt / retire / rally / charge), audible ≈800 m in quiet, ≈200–300 m amid battle noise | 5 s | Misheard P = 0.1–0.3 at range; heard by the wrong unit |
| Banner signal | Visible 500–1,500 m in clear weather; LOS; illegible once fighting starts in dust | 10 s | Obscured by dust, fog, rain and terrain [BANNERS] |
| Voice | ≈30 m in battle | 2 s | — |

- **Unit reaction delay after receipt:** `t = 5 s + (1 − discipline)·30 s + (wavering? 30 s : 0) + (inContact? 60–180 s, and often impossible)`. Units in contact cannot disengage cleanly; withdrawal under pressure risks triggering a break (stress +0.1).
- **Pre-battle plan:** units start with standing orders (hold, advance on signal, charge if the enemy breaks). Most of what happens follows these, as historical commanders "designed simple battle plans; complex manoeuvres were rarely reliable" [BANNERS].
- **Commander's view:** the player's intel is what their commander and scouts can **see** (§14), plus reports that arrive by messenger and are therefore stale. Reports describe what was true when the messenger left.

---

## 14. Fog of war (what a soldier or commander can perceive)

Recognition distances in clear daylight (DESIGN, from military observation doctrine):

| Detail | Distance |
|---|---|
| Individual face, livery badge detail | 25–50 m (fog: 5–15 m; this caused Barnet's star/sun mistake [BARNET]) |
| Heraldry colours, individual armour class | 100–200 m |
| Banners, unit identity | 300–600 m |
| A formed body of troops, its type | 1–3 km |
| Dust cloud of a marching column (dry `dust` terrain) | 5–10 km |

- Numbers estimation error: observer estimate = true × lognormal(μ = ln 1.4, σ = 0.35). Scared observers overestimate (μ = ln 2).
- LOS is blocked by terrain, crests and concealment (`terrain-types.js`). Men prone or kneeling in tall crops, bracken or behind hedges are hidden per `concealment`.
- Night and weather multipliers are in `WEATHER` of `terrain-types.js`.

---

## 15. "Legendary feat" detection

Each soldier logs per battle: kills (incap+), duels won, max simultaneous attackers survived, longest-range hit, wounds survived, rallies led, stands while the unit broke.

Maintain a **reference distribution** from the calibration harness (§17) per soldier archetype, e.g. P(kills ≥ k | archetype, role, battle duration). Then:

| Tier | Tail probability under the reference distribution | Example |
|---|---|---|
| Notable | p < 1e-2 | Levy spearman with 3 kills; archer hit on a single man at 150 m |
| Heroic | p < 1e-3 | Man-at-arms with 8+ kills; survived surrounded by 5 |
| **Legendary** | **p < 1e-4** | Won against ≥10 simultaneous attackers; single man held a bridge span for >2 min against a unit |
| Mythic | p < 1e-5 | Won 1-vs-20 (see §17) |

Detection runs at the end of the battle and on key events. Store the raw p-value, not only the tier, so the storytelling layer can rank them.

---

## 16. Environment hooks

All ground, elevation and weather effects live as data in `js/sim/terrain-types.js` (`TERRAIN`, `FEATURES`, `ELEVATION`, `WEATHER`). The combat model reads: `moveMul`, `fatigueMul` (Pandolf η), `footing`, `chargeViable`, `cohesionMul`, `cover`, `concealment`, `dust`, the ELEVATION missile and fighting modifiers, and the WEATHER modifiers (bowstring damp, wind drift, visibility).

---

## 17. Calibration: target outcome distributions for the Monte-Carlo harness

The harness must run ≥1,000 seeds per scenario and assert that each metric falls inside its band. Bands are wide because the sources are chronicle numbers.

### 17.1 Global invariants
| Metric | Target band | Source |
|---|---|---|
| Victor fatalities (killed + mortal) | **1–5 %**, median ≈3 % | [SABIN] pp.5–6 |
| Loser fatalities, ordinary rout (no cavalry pursuit, open escape) | **8–20 %**, median ≈14 % | Krentz in [SABIN]; "10 to 15 percent" [ROUT] |
| Loser fatalities, pursued by fresh cavalry or trapped (river, encirclement) | **30–80 %** | Cannae: ~20,000 of the Roman battle line died; Cynoscephalae 8,000 killed + 5,000 captured of 25,500 [SABIN]; Bannockburn [BANNOCK] |
| **Share of loser deaths occurring after the break** (rout + pursuit + massacre of the downed) | **60–90 %** | [SABIN]; [ROUT] |
| Line-fight duration before a break, equal steady infantry | 30–180 min | [SABIN]; [AGIN] |
| Contact (flurry) fraction of that duration | 10–30 % | DERIVED §0 |
| Share of engagements decided at first shock, large morale gap | 30–50 % | [SABIN] p.13 |
| Unit losses at the moment of breaking, ordinary troops | 5–15 % | DESIGN |

### 17.2 Scenario benchmarks
| Scenario (set up from the cited orders of battle) | Target |
|---|---|
| **Crécy-like:** ~5,000 longbow + 2,500 dismounted men-at-arms on a terraced slope with pits vs mounted men-at-arms charging uphill + crossbowmen without pavises | Attacker:defender deaths **≥10:1** (1,542 French nobles counted, plus infantry; English 40–300) [CRECY]; ≥10 repeated charges before exhaustion |
| **Agincourt-like:** 1,500 MAA + 7,000 archers with stakes in a 690 m defile vs ~10,000 dismounted MAA crossing ploughed mud | French deaths ≈6,000 vs English ≤600 (≈**10:1**); pile-ups form; archers join the melee after ammo is spent [AGIN] |
| **Courtrai-like:** ~11,000 Flemish communal foot behind stream and ditches vs French knightly cavalry | ≥30–50 % of the charging knights die; horses refuse or fall at the ditches [COURTRAI] |
| **Stirling Bridge-like:** 9,000 attackers crossing a 2-abreast bridge; defenders strike when ~2,000 are across | The bridgehead force is destroyed (>60 % killed or drowned); the far bank cannot reinforce [STIRLING] |
| **Bannockburn-like:** pike schiltrons in woodland-flanked ground vs heavy cavalry, then a rout into streams | Cavalry charges fail against steady schiltrons; the loser's rout into the burn gives >40 % infantry losses [BANNOCK] |
| **Steady pike vs frontal cavalry, open field** | Horse contact <10 %, breakthrough <5 % |
| **Cavalry vs wavering or disordered infantry** | Breaks it in >70 % of runs |

### 17.3 Duel and odds curve (equal gear and skill unless noted)
P(single soldier wins, i.e. incapacitates or routs all opponents without being incapacitated), with N opponents able to engage simultaneously. The curve is built to be steep until ~6 attackers (the most who can physically reach him) and shallower beyond:

```
P(N) ≈ 0.5 · exp(−1.1·min(N−1, 6)) · exp(−0.3·max(0, N−7))
```

| N | 1 | 2 | 3 | 5 | 7 | 10 | 20 |
|---|---|---|---|---|---|---|---|
| Target P | 0.5 | 0.12–0.2 | 0.03–0.08 | 2e-3–1e-2 | 3e-4–1.5e-3 | 1e-4–5e-4 | **1e-5–1e-4** |

Equipment asymmetry benchmarks:
- Man-at-arms (mail + coat of plates + great helm, skill 0.8) vs levy (gambeson, spear, skill 0.2): **0.85–0.95**.
- Same MAA vs 3 levies: **0.3–0.5**. The armour works; he is pulled down by the legs and daggered through the gaps.

### 17.4 Missile benchmarks
- Archers at 150–200 m against close-order, unshielded, gambeson-armoured foot: 3–8 % of targets incapacitated per 1,000 arrows per 100 m of front (DESIGN; tune).
- Against mail + gambeson men-at-arms: ≤1 % incapacitated per 1,000 arrows. Against their unbarded horses: 5–15 % of horses down or bolting per 1,000 arrows.
- Crossbow vs longbow duel at 150 m, equal numbers, crossbowmen without pavises: the crossbowmen break first in >80 % of runs [CRECY].

---

## 18. Sources

- **[DUPICQ]** Ardant du Picq, *Battle Studies* (1880, tr. Greely & Cotton), Project Gutenberg #7294: https://www.gutenberg.org/files/7294/7294-h/7294-h.htm (Cannae analysis, Part I ch. III).
- **[SABIN]** P. Sabin, "The Face of Roman Battle", *JRS* 90 (2000): https://gwern.net/doc/history/2000-sabin.pdf
- **[KEEGAN]** J. Keegan, *The Face of Battle* (1976): Agincourt chapter (mud, stakes, the "wall of dead"). Used qualitatively via [AGIN].
- **[CLAUSEWITZ]** C. von Clausewitz, *On War*, Bk I ch. 7 "Friction in War".
- **[VERB]** J.F. Verbruggen, *The Art of Warfare in Western Europe during the Middle Ages* (1997): conroi and charge doctrine, via [CAVCHARGE]: https://en.wikipedia.org/wiki/Cavalry and https://www.thecollector.com/hollywood-medieval-cavalry-charges/
- **[ACOUP]** B. Devereaux, "Punching Through Some Armor Myths" (summarising A. Williams, *The Knight and the Blast Furnace*, 2003): https://acoup.blog/2019/06/21/collections-punching-through-some-armor-myths/
- **[WILLIAMS]** A. Williams, *The Knight and the Blast Furnace* (Brill 2003), §9.2.
- **[JMMH18]** "Experimental Tests of Arrows against Mail and Padding", *Journal of Medieval Military History* XVIII: https://www.cambridge.org/core/books/abs/journal-of-medieval-military-history/experimental-tests-of-arrows-against-mail-and-padding/BEBF228DC18DB9A7F8CACE58AFAEA4C3
- **[LONGBOW-WIKI]** "English longbow" (Hardy, Stretton 2010, Bane 2006, Loades 2011, Gibbs 2012, Tod's Workshop 2019, arrow procurement): https://en.wikipedia.org/wiki/English_longbow
- **[BOURKE]** Bourke & Whetham, Defence Academy Warbow Trials 2005/2007: https://www.medievalists.net/2011/12/english-longbow-testing-against-various-armor-circa-1400/
- **[XBOW]** Crossbow energy measurements (Todeschini 976 lbf / 96 g / 47.9 m/s; 275 lbf / 63 J): https://en.wikipedia.org/wiki/Crossbow and http://bowyersdiary.blogspot.com/2011/10/graingram-scales.html
- **[XBOW-RATE]** Spanning methods and rates: https://www.benjaminrose.com/post/fast-archery-techniques-part-3-the-crossbow/
- **[CRECY]** https://en.wikipedia.org/wiki/Battle_of_Cr%C3%A9cy
- **[AGIN]** https://en.wikipedia.org/wiki/Battle_of_Agincourt
- **[COURTRAI]** https://en.wikipedia.org/wiki/Battle_of_the_Golden_Spurs and https://www.historyofwar.org/articles/battles_courtrai.html
- **[STIRLING]** https://en.wikipedia.org/wiki/Battle_of_Stirling_Bridge
- **[BANNOCK]** https://en.wikipedia.org/wiki/Battle_of_Bannockburn
- **[TOWTON]** Towton skeletal analyses (Fiorato, Boylston & Knüsel 2000; Holst & Sutherland 2014): https://strangeremains.com/2015/02/11/the-game-of-thrones-written-in-bones-the-battle-of-towton/ and https://www.towton.org.uk/research/
- **[TOWTON-WIND]** https://en.wikipedia.org/wiki/Battle_of_Towton and https://warfarehistorynetwork.com/article/roses-in-the-snow/
- **[VISBY]** Thordeman, *Armour from the Battle of Wisby 1361* (1939); summary: https://en.wikipedia.org/wiki/Battle_of_Visby and https://historiska.se/en/explore-history/history-hub/3d-skull-from-the-battle-of-visby/
- **[BARNET]** https://www.historyhit.com/fighting-in-the-fog-who-won-the-battle-of-barnet/
- **[BANNERS]** Medieval battlefield communication (Jones, *Bloodied Banners*): https://www.goodreads.com/book/show/8578129-bloodied-banners and https://www.medievalchronicles.com/medieval-knights/medieval-knights-questions-answers/how-did-knights-communicate-on-the-battlefield/
- **[ROUT]** Summary of casualty-by-phase scholarship: https://scholars-stage.org/pre-modern-battlefields-were-absolutely-terrifying/
- **[PANDOLF]** Pandolf, Givoni & Goldman (1977), terrain factors: https://en.wikipedia.org/wiki/Pandolf_equation
- **[ASKEW]** Askew, Formenti & Minetti, "Limitations imposed by wearing armour on Medieval soldiers' locomotor performance", *Proc. R. Soc. B* 279 (2012): https://pubmed.ncbi.nlm.nih.gov/21775328/
- **[CP]** Critical power / W′ balance model (Monod & Scherrer; Skiba et al. 2012 τ formula).
- **[HEAT]** Standard exercise-physiology dehydration findings (≥2 % body-mass loss degrades performance).
- **[ATLS]** ATLS haemorrhage classes (blood-loss % vs consciousness).
- **[MARSHALL]** S.L.A. Marshall, *Men Against Fire* (1947). Figures contested; used only as a tunable prior.
- **[GAIT]** https://en.wikipedia.org/wiki/Horse_gait, https://madbarn.com/horse-gaits-guide/ and https://en.wikipedia.org/wiki/Horses_in_warfare
- **[HORSE-NISKANEN]** Niskanen et al., "Size and conformation of Medieval horses of NW Europe": https://www.researchgate.net/publication/370765331
- **[EXARC-BARD]** "Evaluation of Mail Horse-Armour", EXARC 2022/1: https://exarc.net/issue-2022-1/ea/evaluation-mail-horse-armour
