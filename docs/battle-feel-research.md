# HIGHGROUND — Battle Feel: how a medieval battle looked, sounded and unfolded

Companion to `docs/combat-research.md` (the quantitative model: frontage table, refusal rule, arrow ballistics,
morale numbers, command latency). This file does **not** repeat those numbers. It collects what eyewitnesses,
chroniclers, bones and experimenters tell us about the *experience* and *mechanics* of battle, turned into
concrete behaviour for animation, formation code, audio, commander play and UI.

Conventions: `[KEY]` = source at the end. **Quote** = primary source wording (translation named in Sources).
**DESIGN** = our implementable reading, not a historical figure. Where a claim is contested it says so.

Five ideas that should shape everything below:

1. **Battle is mostly waiting, shoving and flinching; killing comes in bursts and in the rout.** The bones (Towton,
   Visby) show frenzied overkill on men who were already down; the chroniclers show long standoffs broken by
   moments when one thing gives.
2. **The press is the killer, not the sword.** Agincourt, Dupplin Moor and Crécy all describe men who could not
   rise or lift their arms because of the crowd around them, and piles of the dead "higher than a man".
3. **Horses are animals, not tanks.** They refuse, shy, bolt, throw their riders and trample their own side when hurt.
4. **Command is a banner, a voice and a man on a hill.** What the player sees should be what a lord on a windmill
   mound could see, and orders ride on trumpets, banners and runners.
5. **Battles are remembered for one moment**: a bridge, a banner falling, a king led off by his bridle, a flank
   charge down a hill. The sim should detect those moments and the presentation should *stop and show them*.

---

## 1. Formation fighting in contact

### 1.1 The line of men-at-arms / shield wall in contact

- **Density is total.** William of Poitiers on Hastings: the English "were so tightly packed together that there was
  hardly room for the slain to fall"; another rendering: "the dead could scarcely fall and the wounded could not remove
  themselves from the action" [HASTINGS]. → The dead and badly wounded in a close-order front rank should be held up
  or slide down between their neighbours. They should not ragdoll out of the formation. A body stays in its slot as an
  obstacle until the press slackens (a lull, §8 of the combat spec).
- **Only the front rank really fights; everyone else pushes and waits.** Monstrelet at Agincourt: "excepting the front
  line, and such as had shortened their lances, the enemy could not raise their hands against them" [MONSTRELET].
  French men-at-arms cut their lances down to fight on foot (same source). → Rank 2+ animation: shoulder/shield on the
  back of the man in front, weapon held up and vertical (no room to swing), faces turned sideways. Only spears and
  shortened lances reach from rank 2.
- **Rank replacement is not a drill, it is a fall.** Froissart at Poitiers: "many a man overthrown, and he that was once
  down could not be relieved again without great succour and aid" [FROISSART]. At Crécy "when they were down, they could
  not relieve [= get up] again, the press was so thick that one overthrew another" [FROISSART]. → A man who goes down in
  the front rank is not replaced by a clean step-forward. The man behind is *pushed over him* and has to fight
  standing on or behind the body. The engine's `file-preserving refill` should (a) happen during pulses as a stumble
  forward, not a slide, (b) leave the downed man under his feet as footing penalty (`ground.bodies`), and (c) only become
  a tidy rotation during lulls (the spec's 10–20 s rotation).
- **The "wall of dead".** Gesta Henrici Quinti: "The living fell on top of the dead, and others falling on top of the
  living were killed as well … the heap … grew so great that our men climbed the piles which had grown higher than a
  man's height, and slaughtered their adversaries at the rear with swords, axes and other weapons" [GESTA]. Lanercost at
  Dupplin Moor (1332): "the pile of dead was greater in height … than one whole spear length" [DUPPLIN]. Keegan explains
  the mechanism: the front ranks recoil from the English line (arrows, blows), the ranks behind keep coming, and the men
  caught between go down in a heap that the following men then climb [KEEGAN]. → Emergent: bodies accumulate at the
  contact line, raise the local ground height (the winners stand *higher*), block the losers' advance and become a
  battlefield feature that persists and is visible from the commander's view.
- **Exhaustion before contact.** The monk of Saint-Denis: the French men-at-arms "sank up to their knees" in the mud
  "so that they were already overcome with fatigue even before they came against the enemy" [AGIN-MUD]. Keegan adds the
  heat and breathlessness of a closed visor [KEEGAN]. → The approach walk on heavy going should visibly slow and bunch
  men (heads down, visors down, shuffling) and cost W′ (already in physio.js); the *animation* must show it.

### 1.2 The press and the crush (how formations actually die)

- **Arrow flinch compresses a column.** At Dupplin Moor English archers on both flanks shot into the Scottish column;
  "Scottish infantrymen on the flanks pushed towards the centre to escape the arrows, building more pressure in the
  compressed Scottish column", with fresh troops still coming from behind: hundreds died "suffocated by the dreadful
  press" or trampled [DUPPLIN]. **This is the single most implementable crush mechanic:** men under missile fire from a
  flank drift *away from the threatened side*, the formation's width shrinks, density rises past the combat spec's
  3 men/m² crush threshold, and nobody at the back knows. DESIGN: lateral drift of 0.05–0.15 m/s per man away from the
  incoming-arrow bearing while under missile stress, capped by neighbours; the rear keeps its ordered advance.
- **Cavalry recoiling into its own foot.** Monstrelet: horses "so severely handled by the archers, that, smarting from
  pain, they galloped on the van division and threw it into the utmost confusion" and the whole army "was thrown into
  disorder, and forced back on some lands that had been just sown with corn" [MONSTRELET]. Keegan identifies this
  reversal of the horse into the advancing foot as the moment the Agincourt field became a killing ground [KEEGAN].
  → Bolting horses must path *through* friendly bodies (knock-downs, disorder, stress) rather than being steered
  around them.
- **Ground funnels.** Agincourt's woods, Dupplin's valley, Stirling's bridge and causeway: each narrowed the frontage
  as more men came on. The sim's crush rule should trigger from frontage shrinkage (terrain + flinch), not only from
  total numbers.

### 1.3 The wedge ("cuneus", "boar's head", Keil)

- In Latin chronicles *cuneus* often just means "a body of troops"; the triangle is a later and literary picture. The
  term is reliable where a source describes a *driving* column: the Novgorod First Chronicle at Lake Peipus (1242): "the
  Germans and the Chuds rode at them, driving themselves like a wedge through their army" [PEIPUS]. The Teutonic
  "Schweinekopf" was a deep, narrow column of horse [PEIPUS]. The common reconstruction, which no source here
  confirms, puts the knights at the point and on the edges and the less reliable men in the middle.
- DESIGN reading for the game: a wedge is a **deep column with a narrow, elite head** (3–5 men wide at the point widening
  to 11–15), used to *pierce* a line at one point. Its strength is that the men at the point cannot stop because of
  the men behind (the same press, used offensively). Its weakness is that once through, the column is a mob in the enemy's
  midst and its flanks are unprotected. Implement as a formation template with slot priority for elite/best-armoured
  men at the head, and a momentum term: the head's refusal/stall check uses the *whole column's* push, but a stall
  propagates backwards as a crush.

### 1.4 The schiltron

- **Look:** "They had axes at their sides and lances in their hands. They advanced like a thick-set hedge and such a
  phalanx could not easily be broken" (English account of Bannockburn); "with their shields closely locked in front of
  them, they formed an impenetrable phalanx" [SCHILTRON]. Barbour: Randolph's troop stood "like hedgehog's hide" [BARBOUR].
- **Falkirk 1298 (static):** circular, "driving stakes into the ground before the men, with ropes between"; Oman: "the
  front ranks knelt with their spear butts fixed in the earth; the rear ranks leveled their lances over their comrades'
  heads; the thick-set grove of twelve foot spears was far too dense for the cavalry to penetrate" [SCHILTRON]. English
  horse could not break them; archers and crossbows shot holes in the static ring, then the horse rode in [SCHILTRON].
  → Schiltron formation = ring or block, rank 1 kneeling with butts grounded, ranks 2–3 spears levelled over them.
  It is immune to frontal horse (the refusal rule already gives this) and **helpless against missiles**, and every
  arrow casualty is a hole the horse can use. The hole should be visible: a gap in the spear hedge.
- **Bannockburn 1314 (mobile):** Bruce drilled the schiltrons to *advance* on suitable ground [SCHILTRON]. Barbour on
  the moment of contact: "far off you might hear the clash of arms and captains' shout, and then was stabbed … full
  many a horse … Steeds gored with gashes deep and wide rushed here and there all masterless"; the Scots "drove the
  English back inch by inch before their spears" [BARBOUR]. → A schiltron's attack is a slow walk (not a charge) that
  gains ground a step at a time. Animation: synchronised short steps, spears pumping.

### 1.5 Flemish militia line (Courtrai 1302)

- "deeply stacked lines", *goedendags* and pikes pointed outward, crossbowmen falling back behind the pikes; at contact
  "the disciplined Flemish foot-soldiers kept their pikes ready on the ground and their goedendags raised"; knights
  "quickly knocked from their horses and killed with the goedendag, the spike of which was designed to penetrate the
  spaces between armour segments" [COURTRAI]. The Flemings were ordered to take no prisoners and hold their ranks
  [COURTRAI]. → Mixed-weapon line: the pike stops the horse, the goedendag (club-spike) kills the unhorsed man. Its
  "no plunder" standing order is what made it work (see §3.5: breaking ranks to plunder or capture).

### 1.6 How a line bends, gaps and breaks

- **Bows, not snaps.** Barbour's four Scottish battles fighting "side by side", pressing inch by inch; the English
  front "could not for long sustain the brunt … but, fearing for their lives, drew back" [BARBOUR]. Froissart at
  Poitiers: the marshals' battle "fell one upon another and could not go forth" [FROISSART]. → A line fails in
  sectors. One sector yields a few metres (the spec's contact sectors), the neighbours are now flanked at the
  shoulder, their outside files turn to face, and the gap widens from the edges.
- **The gap is exploited by whoever is behind it.** Courtrai: the French broke into the Flemish centre and the reserve
  under John of Renesse plugged it [COURTRAI]. The commander-AI's second line that "plugs gaps" (combat-implementation §1)
  is historically right. Make it *visible*: the plug is a moment the player should see (§8).
- **Missiles open gaps for the horse** (Falkirk, above). **Horse opens gaps for the foot** (Bannockburn: Keith's light
  horse charging the English archers [BARBOUR]).
- **Defeat starts at the back.** A break almost always begins with men in the rear ranks, who cannot see the fight but
  can see the way out, drifting off. Chronicles consistently describe the rear "fleeing" while the front still fights
  (Poitiers' marshals' battle; Bannockburn after Edward left) [FROISSART; BANNOCK]. The combat spec's contagion radius
  handles the maths. The *animation* should show rear-rankers glancing back and then stepping back before anyone runs.

---

## 2. Cavalry

### 2.1 The charge itself

- **Speeds and energy.** Williams, Edge & Capwell's ballistic-pendulum trials used ~11 m/s (40 km/h) gallops. A couched
  lance delivered 90–200 J without a lance-rest and >200–250 J with one; ~300 J was probably reached but broke the
  lances before the target could register it [LANCE-EXP]. Stirrups added <30 % [LANCE-EXP]. → For the 13th–14th c.
  (before the plate lance-rest) use the 90–200 J band per lance hit, already inside the combat spec's energy model; the
  *visual* consequence is that **the lance breaks** on most solid hits.
- **What the charge looks like.** The walk → trot → gallop-for-the-last-200 m schedule is in the combat spec. Add the
  look: knee-to-knee in a line (*en haie*), lances held upright until the last 30–50 m, then lowered together.
  Levelling early tires the arm and fouls neighbours (DESIGN from the tournament/joust tradition in [LANCE-EXP]).
  Barbour: "Straight as an arrow was their course, and each brave warrior spurred his horse" [BARBOUR].
- **The moment of impact (horse vs foot).** Barbour on Bannockburn: "spears through gallant steeds were thrust, whose
  riders, rolling on the ground, from trampling hoofs no refuge found"; "had heard great spears in flinders [splinters]
  fly" [BARBOUR]. → Impact FX: lance shatter (splinter burst plus a sharp crack), front horses rearing or pulling up at
  3–10 m if refused (combat spec), the ones that hit going down *forward* with their riders thrown over the neck.
  Riderless horses keep running and wander through both sides (Barbour, Bannockburn: "without a rider many a steed"
  fled wandering far astray) [BARBOUR].
- **Horse vs horse.** Mostly decided before contact (combat spec). When it is not, Froissart's single encounters at
  Poitiers are typical: a lance thrust at the shield misses or glances, men "fell to the earth" together, and the one who
  rose first had the advantage until others arrived; five knights "came on him all at once and bare him to the earth,
  and so perforce there he was taken prisoner" [FROISSART]. → After contact a cavalry fight turns into **clusters**:
  2–5 riders around one man, men dismounting to take a fallen opponent's surrender.

### 2.2 Horses under missiles and in the mêlée

- **Arrows turn horses.** Froissart at Poitiers: "the horses when they felt the sharp arrows they would in no wise go
  forward, but drew aback and flang and took on so fiercely, that many of them fell on their masters, so that for press
  they could not rise again" [FROISSART]. Geoffrey le Baker: archers moved round the flank and shot at the horses'
  unprotected hindquarters; "the horses, smarting under the pain of their wounds, would not advance, but turned around
  and through their unruliness threw their masters … nor could those who had fallen get up again"; some French were
  trampled by their own horses [POITIERS]. Crécy: "the sharp arrows ran into the men of arms and into their horses, and
  many fell, horse and men" [FROISSART].
  → Horse wound response states (animation + AI):
  `flinch` (head toss, sidestep; stung) → `balk` (stops, backs, spins) → `bolt` (runs away from the pain, **not** away
  from the enemy: a rump wound bolts *forward*, a chest wound bolts *back* into its own ranks) → `fall` (drops and pins or
  throws the rider). Flank or rear arrows are far worse than frontal ones (Poitiers).
- **Horses take far more hits than riders.** Joinville at Mansourah (1250) took 5 arrow wounds, his horse 15 [JOINVILLE].
  Horses are big, low-armoured targets. → Many unhorsed men-at-arms come from dead horses, not from lance hits.
- **Bolting horses carry their riders anywhere.** Crécy: Sir John of Hainault's black courser "took the bridle in the
  teeth and brought him through all the currours of the Englishmen … he fell in a great dike" [FROISSART]. → A
  bolting horse under a banner-bearer carries the banner with it, a misleading signal (§6).
- **Horses in pits and ditches.** Courtrai: brooks troubled the French horse and "a few fell from their steeds" but
  they crossed; the damage was done by the *disorder* the crossing caused [COURTRAI]. → Crossing an obstacle should
  cost formation cohesion (spacing scatter) more than it costs men.

### 2.3 Unhorsed men

- An unhorsed man-at-arms is on foot in 25–30 kg of armour, often winded or injured, and the enemy's knifemen are
  looking for him. Froissart at Crécy: "rascals that went afoot with great knives … went in among the men of arms, and
  slew and murdered many as they lay on the ground, both earls, barons, knights and squires, whereof the king of England
  was after displeased, for he had rather they had been taken prisoners" [FROISSART].
  → A dedicated **finisher** behaviour for light infantry near downed enemies (already partly in combat.js "finished
  off by men sweeping the field"). Tie it to the **ransom vs no-quarter** stance of the side: English lords wanted
  prisoners; the Flemings at Courtrai and the Welsh knifemen did not.

### 2.4 Disengage, rally and re-charge

- Templar Rule: no brother might charge or leave his squadron without the Marshal's order; the *gonfanon* had to stay
  visible and could never be lowered; five to ten knights guarded it; a brother cut off from his banner rallied to the
  nearest friendly banner; none could leave the field while one of the Order's banners flew [TEMPLAR]. → Rally
  mechanics: riders return to the **banner**, not to a map point. If their banner is down they look for *any* friendly
  banner within sight. A charge that ends (win, refusal, or recoil) should trigger a ride-back to the banner, a
  re-form behind it (tens of seconds; horses blown per physio.js) and then a new charge. Crécy saw 15–16 such
  cycles (combat spec).

---

## 3. Individual combat inside a battle (not a duel)

### 3.1 What a man actually does in contact (per ~10 s)

- Full-contact armoured combat sport (>20 kg armour, 90 s rounds): heart rate 170 bpm mean (90 % of max, peaking above
  age-max), blood lactate 4.7 → 8.2 mmol/L over three rounds, and strike velocity dropping visibly by round 3
  [BUHURT]. A max-effort 4-strike drill ran ~18 repetitions per 90 s (≈ 8 strikes per 10 s) [BUHURT]. That is the
  *ceiling*, for a fit athlete, in the open.
- In a line the rate is much lower: two thirds of the time is spent guarding, watching, shoving or standing
  (combat spec §0: contact fraction 10–30 %; Sabin's "fighting to stay alive").
  **DESIGN animation budget for a front-ranker during a flurry, per 10 s:** 1–3 committed blows or thrusts, 2–4
  guards/parries/shield-takes, 1–2 shoves or shield-punches, 1–2 steps (forward or back), and constant small shuffles.
  During a lull: 0–1 blows, mostly guard-up, shouting, a look behind, a breather with the visor up (see §4.3 on the
  dangers of that).
- **Blows break shields and rain on the head.** Barbour: strokes that "broke the strongest bucklers"; "beneath their
  battle-axes' stroke both head and iron head-piece broke" [BARBOUR]. Froissart on English vs Scots: "there is no ho
  between them as long as spears, swords, axes or daggers will endure" [FROISSART].

### 3.2 What the bones say (wound patterns to drive hit location and death animations)

- **Towton (1461), mass grave:** 27 of 28 skulls wounded; **113 cranial wounds vs 43 on all the rest of the body**
  (38 bodies); 73 sharp, 28 blunt, 12 puncture [TOWTON-SR]. Two men had over ten head wounds [TOWTON]; one man 13 wounds
  in all [TOWTON-REV]. Towton 25: five blade cuts to the left side of the head (survivable), then a horizontal gash to the
  back of the skull, then a face cut from left eye to right jaw [TOWTON-SR]. Blows were mostly from **right-handed**
  attackers; wounds concentrated on **head and forearms** (defence injuries from parrying), and "some cuts and blows to
  the head were delivered from behind and above while their victims were on the ground" [TOWTON; TOWTON-REV]. The grave
  lies about a mile from the main fighting, on the line of the rout, so these men were probably killed as the
  Lancastrians broke [TOWTON-REV]. Most had no effective helmet (lost, removed for air or vision, or never owned)
  [TOWTON-REV]. 9 of 28 had old healed wounds: veterans [MEDIEVALISTS-INJ].
- **Visby (1361):** 456 cutting-weapon wounds, 126 arrow/crossbow wounds on ~1,185 individuals; "a rough estimate is that
  close to 70 percent of the blows detected at Visby were aimed at the lower leg" [VISBY-BAEN]. Both shins cut through
  by one blow; severed feet; skulls cut through mail coifs; some men carried five to seven projectile wounds
  [MEDIEVALISTS-INJ; VISBY-BAEN]. Torsos were covered by mail/coats of plates and shields, so blows went **under the
  shield** [VISBY-BAEN]. Many were boys and old men [VISBY-WIKI].
- **Sidon (1260):** at least 40 % sharp-force injury to hand bones (defensive), one man ≥12 injuries, post-mortem
  decapitations [MEDIEVALISTS-INJ].
- **Richard III (1485):** 11 perimortem wounds, **9 to the skull**, none on the arms or hands (still armoured on the
  body), helmet off by the end; killed by two blows to the base of the skull [RICHARD].

**Implementation (wounds.js / animation):**
1. **Shield-up men get hit low; shield-down or exhausted men get hit high.** Hit location should depend on the
   defender's *guard state*. Guard high (shield up to take arrows or blows) makes the shins the target, as at
   Visby. Guard dropped (fatigue, shoved, turning) makes the head the target, as at Towton. A helmetless man's head
   is the dominant target, as for Towton and Richard.
2. **Right-handed attackers → left side of the victim's head/body** for face-to-face blows (Towton 25).
3. **Forearm/hand defence wounds** are the typical first wound of an unarmoured-arm man: disarm, weapon drop,
   hunch-and-cover animation.
4. **Down = death sentence in the press.** The overkill clusters (8, 10, 13 wounds) come from men struck repeatedly
   after going down. `downed ×3 head` in wounds.js is right; add the visible **cluster finish**: 2–4 enemies stooping
   over one man, short chopping strokes, from behind and above.
5. **Wounds from behind = rout.** A back-of-head wound means a fleeing man. Pursuit blows should come from behind
   and above: a rider's sword downward, a runner's axe to the back of the head.

### 3.3 Armoured men: how they were actually beaten

- Treatises (Fiore, *Le Jeu de la Hache*) show armoured fighting as **half-sword and pollaxe, grips and throws,
  then a thrust into a gap** (armpit, visor, groin, back of knee), "even better, the same against a man who has already
  been cast to the ground" [HEMA-HALF]. At Towton "a weapon consistent with the pollaxe could have easily made these
  injuries" [TOWTON-SR].
- Courtrai: the goedendag's spike "designed to penetrate the spaces between armour segments" after the knight was
  "knocked from his horse" [COURTRAI].
- Monstrelet at Agincourt: English archers "fighting lustily with swords, hatchets, mallets, and bill-hooks, slaying all
  before them" [MONSTRELET]. Gesta: when their arrows were spent they took up "axes, stakes, swords and the heads of lances
  that lay between them" [GESTA]. Lightly armoured men beat exhausted, pressed, fallen men-at-arms with *percussion*
  and then finished them through gaps.
- **Implementation:** vs a plate/mail target the successful sequence is `bind/grab → throw or trip (or he was already
  down) → pin → dagger/spike in a gap`. Stand-up cutting at a man-at-arms mostly *bruises* (combat-implementation §5:
  "equal mail against mail is often a stalemate of bruises"). That is historically right; make the *grapple-to-ground*
  path the decisive one, and animate it.

### 3.4 Surrender, capture and the ransom scramble

- Men yielded by offering their gauntlet/sword and naming themselves. Froissart's Lord Berkeley, run through both
  thighs, is asked "if he would yield him or not … 'what is your name?'" [FROISSART]. Around King John at Poitiers "there
  was a great press to take the king … 'Sir, yield you, or else ye are but dead'"; afterwards men "made riot and
  brawled for the taking of the king", with ten knights claiming him [FROISSART].
- The Crécy English "would not issue out of their battle for taking of any prisoner" [FROISSART]: a standing order
  that kept the line intact. → The capture of a high-ransom target is a **disorder event**: nearby victors break ranks to
  claim him (loot/capture behaviour exists in morale.js). A unit with a "hold ranks, no prisoners" order resists this at
  the cost of killing ransomable men.

### 3.5 Unit "personalities" that follow from the above (DESIGN)
- **English/Welsh archers:** shoot, then fight with mallets and axes once the enemy is pinned or down.
- **Flemish/Scots foot:** hold ranks, no quarter, finish the downed.
- **French/imperial chivalry:** capture-seeking; they break ranks to take prisoners and are vulnerable while doing it.

---

## 4. Archery and crossbows in battle

### 4.1 How arrows were shot

- **Rate:** heavy warbows can loose 10–12 in one minute but not sustain it; ~5–6/min is realistic for up to ~10 minutes,
  and even 3/min "would still produce an 'Agincourt result'"; 48 arrows per man lasted under 5 min at top rate; boys ran
  resupply [WARBOW-RATE; LOADES]. (Rates are already in ballistics.js; this confirms burst vs sustained.)
- **Volley vs at will.** Froissart's "so wholly [together]" (Crécy, Poitiers) shows a massed *opening* discharge, but
  Loades argues sustained shooting was individual, flatter and aimed at medium range (30–80 yd most effective),
  getting "flatter and flatter" as targets closed, with arrows rationed [LOADES]. Monstrelet's French bowing their heads
  "so that the arrow shots would not penetrate the visors" implies arrows arriving *level at the face* [MONSTRELET;
  LOADES]. → Archer AI: **opening volley on command** (visually synchronised, the "snow" moment), then **ragged
  shooting at will** at the nearest/densest target ("ever still the Englishmen shot whereas they saw thickest press"
  [FROISSART]), angle dropping as range falls.
- **Crécy opening, beat by beat** [FROISSART]: the Genoese "made a great leap and cry to abash the Englishmen, but they
  stood still and stirred not"; a second leap and "fell cry", a step forward; a third; "then they shot fiercely with their
  cross-bows. Then the English archers stept forth one pace and let fly their arrows so wholly [together] and so thick,
  that it seemed snow." The Genoese had left their pavises in the baggage and their strings were wet from the storm
  [GENOESE].
- **Wind and weather decide archery duels.** Towton: snow blowing into the Lancastrians' faces; Fauconberg had his
  archers loose, then **step back**; the Lancastrian reply fell short; the Yorkists picked up the enemy's arrows and shot
  them back [TOWTON-WIND]. → Wind drift exists in ballistics.js. Add (a) an AI/player trick: loose and withdraw out of
  the enemy's (shorter, upwind) range, (b) **arrow harvesting** from the ground in front (arrow recovery exists; make it
  a visible action: men stooping in front of the line).

### 4.2 The look of an arrow storm

- "Thick as snow" (Froissart). Barbour: "the arrows in such numbers fell that whoso saw them might say well that they a
  hideous shower did make, for where they fell … they left behind them marks which will severely test the leech's
  skill" [BARBOUR].
- **Arrows stick.** Baha al-Din at Arsuf: Frankish infantry "with from one to ten arrows sticking from their armoured backs
  marching along with no apparent hurt" (padded gambesons stopped light arrows) [ARSUF]. Visby men with 5–7 projectile
  wounds [MEDIEVALISTS-INJ]. Joinville 5, his horse 15 [JOINVILLE].
  → **Persistent stuck arrows** are the key visual: in shields, in padded coats, in horses, in the ground in front of
  a line (a "stubble field" of shafts), in the dead. Decals/instances, capped per man (e.g. 8) and per m² of ground,
  kept for the whole battle. The density of shafts in the ground is also a readable map of where the killing ground was.
- **Men under arrows:** heads bowed, visors down, shields raised and angled, a hunched walk; the whole body turns
  slightly away from the source [MONSTRELET]. Men with arrows in the arm/shield keep going (Arsuf). Men with arrows in
  the face or legs drop.

### 4.3 Crossbows and the pavise drill

- Normal Genoese drill: a crossbowman, a pavise man holding the big shield, sometimes a second man spanning a spare bow,
  "doubling the rate of fire" [GENOESE]. The pavise is planted; the shooter steps out or leans round, looses, and
  steps back behind it to span (spanning with a belt hook or windlass takes several seconds with his back or side to the
  enemy) [GENOESE; PAVISE].
  → Animation loop: `crouch behind pavise → span (hook/windlass) → rise, lean out, aim 1–2 s → loose → back in`.
  Without pavises (Crécy) the crossbowmen are exposed during spanning and break quickly, which is what happened.
- **Courtrai opening:** 1,000 French crossbowmen drove back 900 Flemish ones; bolts then hit the main Flemish lines "but
  inflicted little damage due to the strong defensive lines" [COURTRAI]. Deep, steady, shielded infantry soaks
  missiles; missiles win against the *static and shallow* (Falkirk) or the *compressed* (Dupplin).

---

## 5. Siege engines hitting men

- **What a stone does to a man.** Stirling Castle, siege of 1304 (Edward I's trebuchets, including "Warwolf"): Skeleton
  150 has **over 160 fractures, 61 in the skull, nearly 60 zig-zag rib fractures**, a pattern like high-speed car-crash
  trauma; he was struck **while standing, from behind**, "killed almost instantly" and his body "driven into the
  ground" (Buckberry, Randolph-Quinney, 2026) [STIRLING-150].
- **Simon de Montfort, Toulouse 1218:** a stone from a defenders' engine, worked by "noblewomen, … little girls and men's
  wives", "struck Count Simon on his steel helmet, shattering his eyes, brains, back teeth, forehead and jaw" [MONTFORT].
  A siege commander killed by one shot, and the siege collapsed.
- **Engines against positions full of men:** at Mesoten (1219) the first stone "crushed the enemy's balcony and the men
  in it"; at Castelnaudary (1211) the third stone disintegrated "but not before causing great injury to those who were
  inside" [ENGINE-CHRON].
- **Implementation (siege.js / render/engines.js):**
  - Direct hit on a man = instant death, body **knocked flat and pressed into the ground** (not flung into the air:
    Skeleton 150 was driven down). Adjacent men (≤1 m) knocked down by the spray of fragments and debris.
  - Stone **fragmentation** on hard ground or masonry: a spray of shards (the Castelnaudary stone), a dust puff and
    turf/earth clods; on soft ground the stone buries itself or bounces once.
  - The dominant effect on troops is **morale**: a big impact within sight of a group is a witness event far out of
  proportion to its kill count. Men flatten, scatter from the impact point and look up for the next one.
  - Hits on walls/hoardings with men on them kill by **collapse** (Mesoten's balcony): timber, stones and men fall
    together.

---

## 6. Command in battle

### 6.1 Where commanders stood and what they saw

- **Edward III at Crécy** stayed "on a little windmill hill" and "of all that day till then his helm came never on his
  head": he was watching, not fighting [FROISSART]. The prince's battle sent a knight to ask for help; Edward answered "let
  the boy win his spurs" [FROISSART]. → The player-commander is a **man on a hill with his helmet off**. His view is the
  fog-of-war origin (combat spec §14). Requests for aid should *arrive* as runners with a spoken line.
- **Kings who fought in the line:** Henry V at Agincourt stood over his wounded brother Gloucester, "standing between his
  brother's legs, kept the enemy at bay", and took an axe-blow that knocked a piece off the crown on his helmet
  (Alençon credited with it) [GLOUCESTER]. The Black Prince at Poitiers: "Advance, banner, in the name of God and of Saint
  George" [FROISSART]. Richard III's charge at Bosworth went straight for Henry Tudor, killed his standard-bearer William
  Brandon ("the standard crashed to the ground"), and was then struck in the flank by Stanley's 3,000 [BOSWORTH]. Bruce at
  Bannockburn killed de Bohun in single combat on the first day ("clove skull and brain; the axe-handle shivered in two")
  [BRUCE-BOHUN].
  → The commander as a **unit on the map** with a choice: *watch* (full view, orders flow, but men far away do not see
  him) or *lead* (he joins a battle: its men get a big morale boost and he can make the feat happen, but his view shrinks
  to 30 m and orders to the rest stop). Being in the line risks death, and the king is the most targeted man on the field.
- **What a commander could see:** banners over a crowd, dust, the shapes of the "battles", and very little else once
  lines closed. Barbour: arms and ensigns "so defiled with blood and gore that they could scarce distinguished be"
  [BARBOUR]. Otterburn, fought by moonlight: the English "knew well they had borne one down to the earth, but they wist
  not who it was" (it was Douglas) [FROISSART]. Barnet's fog confused a star badge with a sun (combat spec). → After
  first contact, **heraldry/unit identity on the map should degrade** (less certain colours, "?" on distant banners). The
  UI should show what is known, not what is true.

### 6.2 How orders travelled

- **Trumpet signals.** The French charge at Bouvines (1215) was signalled by trumpet [MILMUSIC]. Barbour: Bruce "bade the
  battle trumpet sound; then on both sides there gathered round their leaders' banners men of might" [BARBOUR]. Agincourt:
  "The English loudly sounded their trumpets as they approached"; Henry ordered prisoners killed "by sound of trumpet"
  [MONSTRELET]. Edward III's household had 5 trumpets, 2 clarions, pipes, 3 waits (horns) and a drum [MILMUSIC].
- **A thrown baton and a shout.** Agincourt: Sir Thomas Erpingham "flung into the air a truncheon which he held in his hand,
  crying out, 'Nestrocque!'" [= "now strike"] and the English "set up a loud shout" [MONSTRELET]. → The *advance* order has
  a visible cue at the commander (baton thrown, banner dipped forward) and an audible wave: the shout travels down the
  line at voice speed.
- **Banners are the order.** Men "under his banner"; "planted their banners" [MONSTRELET]. At Poitiers's end: "the prince's
  banner was set up a-high on a bush, and trumpets and clarions began to sown" to rally the scattered [FROISSART]. Templar
  rule: the banner may never be lowered; rally to any friendly banner [TEMPLAR]. → A banner is a **map entity** carried by a
  specific man. Its position *is* the unit's rally point and its movement is the unit's order. If it moves back, men
  follow it back (the Crécy bolting horse case). If it falls, see §6.3.

### 6.3 Presence, standards and the fall of a leader

- **The standard falling:** Bosworth: Brandon killed and Henry's standard thrown down, picked up (Welsh tradition: Rhys
  Fawr) [BOSWORTH]. Poitiers: "there was slain sir Geoffrey of Charny with the king's banner [the Oriflamme] in his hands",
  immediately followed by "a great press to take the king" [FROISSART].
- **Hiding a leader's death.** Otterburn: the dying Douglas tells his men not to reveal his state "for if mine enemies knew
  it, they would rejoice, and our friends discomforted"; they "raised up again his banner and cried 'Douglas!' Such as were
  behind and heard that cry drew together and set on their enemies valiantly and reculed back the Englishmen"
  [FROISSART]. → Leader death is a **perceived** event: its morale hit spreads only as men see or hear it. A player/AI
  option: *raise the banner* (a nearby noble takes it up and shouts the war cry), which blocks the collapse.
- **A leader leaving the field starts the rout.** Bannockburn: Pembroke "seized King Edward's bridle and led him away";
  "as the panic spread through the English ranks defeat turned into a rout"; Giles d'Argentan, having seen the king safe,
  said "I am not accustomed to flee" and rode back in to die [BANNOCK]. Crécy: Philip VI's horse was killed by an arrow;
  John of Hainault "took the king's horse by the bridle and led him away in a manner perforce" [FROISSART]. → The king's
  banner moving *away* is the strongest single morale signal on the field.
- **Leader killed → army dies.** Courtrai: "the death of Artois, coupled with the collapse of their advance, shattered the
  resolve of the surviving knights" [COURTRAI]. Evesham (1265): Montfort killed and his army slaughtered; Henry III, in
  borrowed armour inside the rebel army, nearly killed by his own side and saved by crying "I am Henry of Winchester!"
  [EVESHAM]. Toulouse: Montfort's death ended the siege [MONTFORT].
- **Personal presence:** the blind King of Bohemia had his knights tie their reins to his so he could "strike one stroke"
  [FROISSART]. Leaders are followed physically, not by order. A unit whose lord charges goes with him whatever its
  orders (DESIGN: "follow the banner" overrides standing orders for household troops).

---

## 7. Soundscape

The chronicles give a clear arc. Build the mix around it.

| Phase | What sources describe | Sound design |
|---|---|---|
| **Pre-battle / approach** | Scots foot (Otterburn campaign, 1388) "beareth about their necks horns in manner like hunters, some great, some small … when they blow all at once, they make such a noise, that it may be heard nigh four miles off … it seemed that all the devils in hell had been among them"; they blew in long bouts, stopped, and blew again as the enemy came nearer [FROISSART]. Trumpets on the advance [MONSTRELET]. Crécy: storm, thunder, lightning, crows flying over both armies before the rain, then sun [FROISSART]. | Distant massed horns in waves (20–40 s bouts, silence, repeat, louder as range closes). Trumpet calls as the orders vocabulary (distinct motif per order). Ambient weather is part of the battle, not background. |
| **Intimidation** | Genoese "leap and cry" three times; English "stood still and stirred not" [FROISSART]. The English "set up a loud shout" on advancing [MONSTRELET]. | Call-and-silence: one side roars, the other is silent. The silence should be audible (drop ambient, keep only wind and harness creak). |
| **War cries** | "Mountjoy! Saint Denis!" vs "Saint George! Guyenne!" (Poitiers); "Percy!" vs "Douglas!" (Otterburn); "Down with them! let us slay them all" (French commons at Crécy) [FROISSART]. | Per-faction cry sets tied to the lord's name/saint. Cries rise at each surge, and when a banner is raised again. |
| **Missiles** | "Thick as snow"; "a hideous shower" [FROISSART; BARBOUR]. | Massed bowstring thrum on the opening volley, then ragged; many-voiced hiss/whirr overhead; the rain-on-a-roof patter of shafts hitting ground, the thock of shields, the clack on plate, horse screams. Crossbows: the heavier *clack* of the release, the ratchet of windlasses. |
| **Contact** | "far off you might hear the clash of arms and captains' shout"; "great spears in flinders fly"; "Loudly resounded then the clang, as weapons upon armour rang … Far sounded shout and dying groan … wounded men … with rage or anguish loudly cried. Most hideous were the noises made" [BARBOUR]. | A wall of metal on metal and wood; lance-shatter cracks at cavalry contact; shouting captains (voice-order bed). |
| **The grinding middle** | "A long while thus they fought: no word was uttered, and no sound was heard, save dying groans and many a dint that struck out fire like steel from flint … shouting aloud no battle cry" [BARBOUR]. | **Key finding:** the long mêlée goes *quiet* of voices. Drop the cries and keep the rhythmic dull blows, heavy breathing, grunts, groans and scraping. This contrast makes the surges hit harder. |
| **Horses** | "Steeds gored … rushed here and there all masterless"; horses that "flang and took on so fiercely" [BARBOUR; FROISSART]. | Screaming horses under arrows (the most-remembered sound of cavalry battles); hoof thunder building over the last 200 m; the sudden cut-off at refusal. |
| **Gunpowder (optional, late 14th c.)** | Villani at Crécy: the English guns "made a noise like thunder and caused much loss in men and horses" [VILLANI]. | Rare, huge, spooks horses (morale on horses more than on men). |
| **After** | Crécy: at night the English "heard no more noise of the Frenchmen" and lit fires and torches [FROISSART]. | The end of a battle is *the noise stopping*: wounded moaning, a few horns rallying, looters, crows. |

**Mixing rules (DESIGN):** density, not individual samples, drives it. Weight audio by men in contact and in flight
within ~300 m of the camera, with distance filtering (high-frequency loss beyond ~150 m). A horn or trumpet cuts through
at up to ~800 m (combat spec §13), and the player should hear the enemy's calls too.

---

## 8. What makes a battle memorable, and how to surface it

Pivotal moment types from these battles, with the sim trigger and the presentation.

| Moment | Historical case | Sim trigger | Presentation |
|---|---|---|---|
| **The bridge/defile trap** | Stirling Bridge: bridge "only two horsemen … abreast"; Scots waited until "as many of the enemy had come over as they believed they could overcome" (~2,000), seized the bridgehead; Cressingham killed; Thweng cut his way back; Warenne burned the bridge [STIRLING] | ≥30 % of a force across a choke ≤6 m wide, bridgehead contested | Camera cut to the choke; "The bridgehead is lost" card; bridge-burn event |
| **Flank or rear charge from high ground** | Poitiers: "a rout of Englishmen coming down a little mountain a-horseback, and many archers with them, who brake in on the side of the duke's battle" [FROISSART]; Bosworth: Stanley's intervention [BOSWORTH] | Fresh unit strikes a locked unit at >60° off its facing | Horn call, slow-motion strike, stress wave visualised along the victim's line |
| **Terrain trap** | Courtrai's brooks; Bannockburn's pits and the burn; Agincourt's mud and woods [COURTRAI; BANNOCK; AGIN-MUD] | Charge disorder from obstacle + contact within 50 m | "They are in the ditches" call-out; horse-fall close-up |
| **Arrow storm breaks the attack** | Crécy's Genoese; Poitiers's horses turning [FROISSART; POITIERS] | Missile-stress break of a unit before contact | Snow-of-arrows shot from the receiving side |
| **The crush / wall of dead** | Agincourt, Dupplin [GESTA; DUPPLIN] | Crush deaths ≥ N in a sector; body pile height ≥1.5 m | Persistent landmark on the map; post-battle "The Mound" place name |
| **The standard falls / is raised again** | Brandon at Bosworth; Charny with the Oriflamme; Douglas's banner raised [BOSWORTH; FROISSART] | Banner-bearer down; a noble takes it up within 10 s, or nobody does | Banner falling close-up; cry of the lord's name if raised |
| **The leader falls / is led away** | Artois at Courtrai; Edward II led off by his bridle; Montfort at Evesham [COURTRAI; BANNOCK; EVESHAM] | Commander entity killed, captured or moving away from contact while his army is engaged | The one mandatory full-screen moment; stress spreads from where it was *seen* |
| **Single-combat prelude** | Bruce vs de Bohun (the axe-shaft broke) [BRUCE-BOHUN] | A champion rides out; accepting is a player choice | Armies stop and watch; the outcome shifts both sides' nerve |
| **The last stand / refusal to flee** | Giles d'Argentan: "I am not accustomed to flee" [BANNOCK] | A noble with a high nerve stays as his unit breaks (feats.js "stands while the unit broke") | Named feat card, saga line |
| **The capture of a king** | Poitiers: the press to take King John, the brawl over who took him [FROISSART] | High-ransom target yields in a crowd | Capture event, disorder around him, name of the captor |
| **Weather turns** | Towton's snow into Lancastrian faces; Crécy's storm then the sun [TOWTON-WIND; FROISSART] | Wind or visibility change during engagement | Weather "beat" in the event log |
| **The rout and the river** | Bannockburn: English fled into the Bannock burn; Courtrai: into the marshes and the Lys [BANNOCK; COURTRAI] | Fleeing men reach water (drowning exists in morale.js) | Grim wide shot; casualty tally |

**Surfacing principles (DESIGN):**
- **Detect, then pause-and-show.** Each moment type is an event with a salience score (casualties × rank of the
  people involved × proximity to the player's attention). Above a threshold the game slows time (to 0.3×) for 2–4 s,
  cuts or pans the camera, plays a sting (horn or bell), and prints a one-line chronicle entry in period voice
  ("The Earl's banner is down"). The player must never miss the moment that decided the battle.
- **After-battle chronicle** built from these events (`legend.js` builds sagas from feats; add the *battle* moments):
  a Froissart-style paragraph naming the turning point, the notable dead, the captured, the feats, and the place
  names the battle created ("the Mound", "Brandon's Ford").
- **Named men.** Every chronicle moment is about a named person (Brandon, Charny, Argentan, Douglas, Artois). Nobles,
  banner-bearers and captains need names and heraldry from spawn so the moment can say *who*.

---

## Top 25 things to implement for battle realism and feel

Ordered by payoff for "legendary battles" per unit of work. System column: **SIM** = sim/formations, **ANIM** =
animation/render, **AUD** = audio, **CMD** = commander play, **UI**.

| # | Implement | System | Basis |
|---|---|---|---|
| 1 | **Banners as map entities** carried by named men: rally point, order signal, morale anchor; can fall, be raised again, bolt with a horse | SIM, CMD, ANIM | §6.2–6.3; Templar rule, Otterburn, Bosworth |
| 2 | **Pivotal-moment detector plus slow-mo/camera/sting/chronicle line** (bridgehead lost, flank charge, standard falls, leader falls or is led away, crush pile, capture of a king) | UI, CMD | §8 |
| 3 | **Leader death/departure as a *perceived* event** (spreads by sight and sound; "raise the banner" counter-action) | SIM, CMD | Otterburn, Bannockburn, Courtrai |
| 4 | **Horse wound state machine** `flinch → balk → bolt (direction depends on where the wound is) → fall`; bolting horses path through their own side | SIM, ANIM | Poitiers (le Baker, Froissart), Agincourt (Monstrelet) |
| 5 | **Arrow-flinch lateral compression → crush** (men drift away from flank fire; the crush threshold is reached by narrowing) | SIM | Dupplin Moor |
| 6 | **Persistent stuck arrows** in shields, men, horses and ground (capped instancing); ground-shaft density map | ANIM | Arsuf, Joinville, Froissart |
| 7 | **Body piles** that persist, raise local ground height, block movement and act as landmarks | SIM, ANIM | Gesta, Lanercost, Keegan |
| 8 | **Guard-state-dependent hit location**: shield up → shins, guard down/exhausted/helmetless → head; right-hander → victim's left | SIM (wounds.js) | Visby, Towton, Richard III |
| 9 | **Down = finished in the press**: cluster-finish animation (2–4 men chopping from above/behind), overkill wounds | SIM, ANIM | Towton, Froissart (Crécy knifemen) |
| 10 | **Soundscape arc with the "quiet grind"** (cries at surges, voices drop out in the long mêlée, the clang of blows and groans remain) | AUD | Barbour |
| 11 | Front-rank vs rear-rank animation sets: rank 1 fights; ranks 2+ push, weapons vertical, glance back; the dead held upright in the press | ANIM | Hastings, Monstrelet |
| 12 | Rank replacement as a **stumble over the fallen** during flurries, tidy rotation only in lulls | SIM, ANIM | Froissart ("could not be relieved") |
| 13 | **Grapple-to-ground-then-gap** as the decisive path vs armour (half-sword, pollaxe, dagger) | SIM (melee.js), ANIM | Fiore/HEMA, Towton pollaxe, Courtrai goedendag |
| 14 | Lance **shatter** on solid hits (splinter FX + crack); lance dropped, sword drawn; rider thrown over a falling horse | ANIM, AUD | Williams/Edge/Capwell; Barbour |
| 15 | Archer AI: **commanded opening volley → ragged aimed shooting at the thickest press**, trajectory flattening with range; loose-and-withdraw vs an upwind enemy; visible arrow harvesting | SIM, ANIM | Froissart, Loades, Towton |
| 16 | **Pavise drill loop** for crossbows; no pavise = exposed spanning | ANIM, SIM | Genoese at Crécy |
| 17 | Men-under-arrows posture: heads bowed, visors down, shields angled, slowed hunched walk | ANIM | Monstrelet |
| 18 | **Commander stance: watch vs lead** (view radius, order flow, morale aura, personal risk; the king is a magnet) | CMD | Edward III at Crécy vs Henry V at Agincourt, Richard III |
| 19 | Heraldry and ID **degrade after contact** (blood, dust, night, fog): uncertain banners in the UI, friendly-fire risk | UI, SIM | Barbour, Otterburn, Barnet, Evesham |
| 20 | Signal vocabulary: trumpet motif per order, horn waves from the Scots, Erpingham's baton + shout wave down the line | AUD, CMD | Monstrelet, Froissart, Bouvines |
| 21 | Capture scramble: a high-ransom yield causes local disorder; "hold ranks / no prisoners" standing order trades ransom for cohesion | SIM, CMD | Poitiers, Crécy, Courtrai |
| 22 | Cavalry rally-on-banner cycle: charge → recoil → ride back to banner → re-form → re-charge, visibly | SIM, ANIM | Templar rule, Crécy's 15 charges |
| 23 | Trebuchet stone vs men: body driven flat, fragment spray, dust/clods, big witness-stress radius; collapse of manned hoardings | SIM, ANIM, AUD | Stirling Skeleton 150, Montfort, Mesoten |
| 24 | Schiltron template (kneeling rank 1, levelled spears over it, stake-and-rope option) that is immune to frontal horse but visibly holed by missiles; mobile schiltron advances at a short-step walk | SIM, ANIM | Falkirk, Bannockburn |
| 25 | **After-battle chronicle** in period voice from the moment log: turning point, named dead and captured, feats, new place names | UI | Froissart/Barbour style; legend.js |

---

## Sources

Primary (in translation):
- **[FROISSART]** Jean Froissart, *Chronicles*, tr. Lord Berners, ed. G.C. Macaulay (1895), Crécy, Poitiers, Otterburn, the
  Scots' horns: https://sourcebooks.fordham.edu/basis/froissart-full.asp ; Crécy extract:
  https://deremilitari.org/2024/05/the-battle-of-crecy-1346-according-to-jean-froissart/
- **[MONSTRELET]** Enguerrand de Monstrelet, *Chronicles*, Agincourt: https://deremilitari.org/2013/02/battle-of-agincourt-1415/
- **[GESTA]** *Gesta Henrici Quinti* (new translation, Univ. of Southampton Agincourt600):
  https://generic.wordpress.soton.ac.uk/agincourt600/wp-content/uploads/sites/169/2015/10/New-translation-of-the-Latin-text-in-the-Gesta-Henrici-Quinti.pdf ;
  and https://www.history.org.uk/publications/resource/8654/the-archers-stake-and-the-battle-of-agincourt
- **[BARBOUR]** John Barbour, *The Bruce*, verse tr. in *The Bruce of Bannockburn* (1914), Books XII–XIII:
  https://archive.org/stream/bruceofbannockbu00barbrich/bruceofbannockbu00barbrich_djvu.txt
- **[BRUCE-BOHUN]** Barbour on Bruce vs de Bohun: https://en.wikipedia.org/wiki/Henry_de_Bohun
- **[POITIERS]** Geoffrey le Baker on the archers and the horses at Poitiers:
  https://warhistory.org/article/battle-of-poitiers-1356-hundred-years-war-i ; https://en.wikipedia.org/wiki/Battle_of_Poitiers
- **[DUPPLIN]** Lanercost Chronicle on Dupplin Moor; flank-compression account: https://en.wikipedia.org/wiki/Battle_of_Dupplin_Moor ;
  https://www.medievalists.net/2024/04/battle-dupplin-moor/
- **[HASTINGS]** William of Poitiers, *Gesta Guillelmi*: https://thehistorypress.co.uk/article/hastings-1066-the-battle/ ;
  https://penelope.uchicago.edu/encyclopaedia_romana/britannia/anglo-saxon/hastings/shieldwall.html
- **[PEIPUS]** Novgorod First Chronicle via https://en.wikipedia.org/wiki/Battle_on_the_Ice and
  https://medievalarchives.com/2026/02/25/the-battle-of-lake-peipus-1242/
- **[ARSUF]** Baha al-Din ibn Shaddad on Frankish infantry: https://en.wikipedia.org/wiki/Battle_of_Arsuf
- **[JOINVILLE]** Joinville, *Life of St Louis* (Mansourah wounds): https://sourcebooks.fordham.edu/basis/joinville.asp ;
  https://en.wikipedia.org/wiki/Battle_of_Mansurah_(1250)
- **[MONTFORT]** *Song of the Cathar Wars* (tr. J. Shirley) on Simon de Montfort's death:
  https://en.wikipedia.org/wiki/Siege_of_Toulouse_(1217%E2%80%931218) ; https://www.polemology.net/p/on-the-women-of-toulouse-and-the
- **[ENGINE-CHRON]** Henry of Livonia (Mesoten 1219), *Song of the Cathar Wars* (Castelnaudary 1211):
  https://en.wikipedia.org/wiki/Petrary
- **[VILLANI]** Giovanni Villani on guns at Crécy: https://en.wikipedia.org/wiki/Bombard_(weapon) ;
  https://warhistory.org/article/artillery-of-the-middle-ages
- **[TEMPLAR]** Rule of the Templars (battle clauses): https://en.wikipedia.org/wiki/Baucent ;
  https://www.warhistoryonline.com/medieval/9-rules-knights-templar-m.html

Battles (secondary syntheses of the chronicles):
- **[STIRLING]** https://en.wikipedia.org/wiki/Battle_of_Stirling_Bridge (Guisborough/Hemingburgh)
- **[BANNOCK]** https://en.wikipedia.org/wiki/Battle_of_Bannockburn ; https://www.britishbattles.com/scottish-war-of-independence/battle-of-bannockburn/ ;
  https://en.wikipedia.org/wiki/Giles_d%27Argentan (Scalacronica)
- **[SCHILTRON]** https://en.wikipedia.org/wiki/Schiltron (incl. Oman on Falkirk; English accounts of Bannockburn)
- **[COURTRAI]** https://en.wikipedia.org/wiki/Battle_of_the_Golden_Spurs ; Annals of Ghent: https://en.wikipedia.org/wiki/Annals_of_Ghent
- **[AGIN-MUD]** Monk of Saint-Denis via https://medievalscholar.substack.com/p/the-battle-of-agincourt-mud-and-blood
- **[KEEGAN]** J. Keegan, *The Face of Battle* (1976), Agincourt chapter; summary https://runway.airforce.gov.au/face-battle-study-agincourt-waterloo-and-somme-john-keegan-1976
- **[TOWTON-WIND]** https://warfarehistorynetwork.com/article/roses-in-the-snow/ ; https://en.wikipedia.org/wiki/Battle_of_Towton
- **[GLOUCESTER]** Henry V over Gloucester: https://en.wikisource.org/wiki/Humphrey_(1391-1447)_(DNB00) ;
  https://en.wikipedia.org/wiki/John_I,_Duke_of_Alen%C3%A7on
- **[BOSWORTH]** Polydore Vergil via https://en.wikipedia.org/wiki/Battle_of_Bosworth_Field ;
  https://en.wikipedia.org/wiki/William_Brandon_(standard-bearer)
- **[EVESHAM]** https://en.wikipedia.org/wiki/Battle_of_Evesham ; https://www.battleofevesham.co.uk/The_Battle/History.html
- **[GENOESE]** https://en.wikipedia.org/wiki/Genoese_crossbowmen ; **[PAVISE]** https://en.wikipedia.org/wiki/Pavise ;
  https://www.medievalists.net/2012/05/the-introduction-and-use-of-the-pavise-in-the-hundred-years-war/
- **[MILMUSIC]** Military signals and instruments: https://en.wikisource.org/wiki/A_Dictionary_of_Music_and_Musicians/Sounds_and_Signals,_Military ;
  https://en.wikipedia.org/wiki/Naqareh ; https://en.wikipedia.org/wiki/Martial_music

Bones and experiments:
- **[TOWTON]** Novak / Holst & Sutherland, Towton osteology: https://www.medievalists.net/2024/03/medieval-battle-injuries/ ;
  https://towton.org.uk/wp-content/uploads/2022/05/osteological_analysis_towton_hall_and_towton_battlefield.pdf
- **[TOWTON-SR]** https://strangeremains.com/2015/02/11/the-game-of-thrones-written-in-bones-the-battle-of-towton/
- **[TOWTON-REV]** Review of Fiorato, Boylston & Knüsel, *Blood Red Roses* (2000), *Assemblage*:
  https://assemblagejournal.wordpress.com/wp-content/uploads/2017/05/blood-red-roses.pdf
- **[MEDIEVALISTS-INJ]** Visby, Towton, Aljubarrota, Sidon wound statistics: https://www.medievalists.net/2024/03/medieval-battle-injuries/
- **[VISBY-BAEN]** "Wounds and the Effects of Swords" (Baen sample chapter; Ingelmark/Thordeman data):
  https://www.baen.com/Chapters/1439132828/1439132828___4.htm (the ~70 % lower-leg figure is the author's "rough estimate")
- **[VISBY-WIKI]** https://en.wikipedia.org/wiki/Battle_of_Visby ; Thordeman, *Armour from the Battle of Wisby 1361* (1939)
- **[RICHARD]** Appleby et al., "Perimortem trauma in King Richard III: a skeletal analysis", *Lancet* 385 (2015):
  https://pubmed.ncbi.nlm.nih.gov/25238931/
- **[STIRLING-150]** Buckberry & Randolph-Quinney, Stirling Castle Skeleton 150 (2026):
  https://archaeologymag.com/2026/08/first-trebuchet-victim-stirling-castle-skeleton/
- **[LANCE-EXP]** A. Williams, D. Edge, T. Capwell, "An experimental investigation of late medieval combat with the couched
  lance", *J. Arms & Armour Soc.* XXII (2016): https://www.academia.edu/33789994/ ; summary https://sovice-snezni.livejournal.com/83863.html
- **[HEMA-HALF]** Half-sword and armoured combat (Fiore, Liechtenauer tradition): https://en.wikipedia.org/wiki/Half-sword ;
  https://hemapenzance.com/blog/half-sword-and-mordschlag-the-longsword-in-armour
- **[BUHURT]** "Kinematic and Physiological Analysis of Medieval Combat Sport …: A Case Study" (2024):
  https://pmc.ncbi.nlm.nih.gov/articles/PMC11174425/
- **[WARBOW-RATE]** Strickland & Hardy, *The Great Warbow* (2005), rates discussed in https://en.wikipedia.org/wiki/English_longbow and
  https://www.tastesofhistory.co.uk/post/dispelling-some-myths-archers-shooting-twelve-arrows-a-minute
- **[LOADES]** M. Loades, "Did medieval English archers shoot into the air?": https://loadesofhistory.substack.com/p/did-medieval-english-archers-shoot

---
## Owner's brief (2026-09-27) — read as a GENERAL DIRECTION, not a checklist
"Make the BATTLES as realistic as possible… make it something the players will remember… a legendary battle
strategy game, not a resource management one." The owner's examples (men thrown by trebuchets, shield-bashing
knights, wedges that stay wedges, arrows that stick, swords that connect, a commander you can play, professional
sound) are ILLUSTRATIONS. Every agent should go beyond them: anything that makes a battle feel real, readable,
tactical and memorable — while staying runnable on an ordinary laptop — is in scope. Use judgement; propose and
build what a great battle game needs even if nobody asked for it.
