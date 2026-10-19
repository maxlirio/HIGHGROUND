# A war's own game

`docs/eras-plan.md` § *A game each*. The owner, 2026-10-19: *"The different eras of warfare are for 3 separate
game modes, not all combined into one!"* — and, asked how far to pull them apart, chose a full game each.

Three wars are playable: **the Vale** (1340s), **the Riven Marches** (legend) and **the Ardennes** (1944). They
share one engine and one `ARMS` registry; what they do not share is their content.

## What lives where

| | |
|---|---|
| `js/sim/wars.js` | the wars as the **menu** sees them: name, age, prose, and **which of the five games each has built**. Imports nothing, so `play.html` reads it without loading the simulation. |
| `js/sim/eras.js` | the wars as the **battle** sees them: roster, powers, perks, purse, heraldry charges, palette, weather. Spreads `wars.js` back in, so each war's name exists once. |
| `js/sim/eras/<war>/` | the war's own content: `ranked.js` (its ladder), `siege.js` (who is on the walls and who is at the gate) and, for the Vale, `econ-data.js` (its campaign's tables). |
| `js/sim/eras/ranked-packs.js` | resolves a war's ladder. **This one is a resolver** — three real cases, not one imagined one. |
| `js/sim/eras/names.js` | who the people of each war are called. The Vale's two lists are frozen: a man's name is derived from his seed when it is shown, not stored, so moving one word renames every legend in the realm. |

A war is chosen at the menu and carried in the URL from there (`?era=march&mode=battle`). Nothing inside a battle
offers you another age: that row of era tabs was the thing the owner objected to.

## The seam

The simulation is **men on ground** and none of it is medieval: formation, frontage, morale, fatigue, line of
sight over the heightfield, cover, footing, ballistics, weather, pathing, vision, sieges-as-assaults, the map
generator, heraldry, the camera. A rifleman behind a hedge and an archer behind a hedge are the same problem.

The campaign is medieval in its **content** and generic in its **shape**. Every job in `economy.js` and `jobs/` is
one of three verbs — gather at a node, carry to a store, convert at a workshop — and sheaves to a granary are the
same code as jerricans to a fuel dump. So the tables move in here and the verbs stay put.

`js/sim/econ-data.js` is now a one-line re-export of `vale/econ-data.js`. Forty-odd modules import that path and
keep importing it; when a second campaign exists it is that one file, not those forty, that learns to answer for
`w.era`. Deliberately **no resolver has been written yet**: there is one campaign, and an abstraction built for a
second case that does not exist yet is a guess. The directory marks where the second one goes.

## Three ladders

A lord keeps a standing in **every war he fights**, and the books never meet:

```
D.players[id] = { id, name, wars: { vale: STANDING, march: STANDING, ardennes: STANDING } }
STANDING      = { rating, spoils, unlocked, tier, lists, style, w, l, d, defW, defL, last, lord, commander }
```

Only the account's id and name are shared. His lord and his commander are not — the man who leads a company of
riflemen is not the man who leads a company of billmen. Spoils won in one war are not spendable in another,
matchmaking and the table stay inside one war, and a lord cannot muster another war's men by asking for them.

What a war's ladder HOLDS is its own content (`<war>/ranked.js`). The machinery — points, tiers, drill, stakes,
the handicap, how a bot is built to meet him — is the same in every age and lives in `js/sim/ranked-rules.js`.
Those rules read `p.era` off the standing, so a call site rarely has to pass a war at all.

The guards: `tools/ranked-test.mjs` (the Vale's ladder, unchanged), `tools/ranked-eras-test.mjs` (the three kept
apart) and `tools/ranked-eras-browser.mjs` (a camp and a field in 1944 and in the Marches).

## Sieges

The castle is era-agnostic and was so already: the walls, the engines, the mining, the escalade, the starving, the
terms. A troll on a ladder is the same problem as a man on a ladder. What belongs to the war is only the two
hosts — `js/sim/eras/<war>/siege.js`, resolved by `js/sim/eras/siege-packs.js`.

**The Ardennes has no pack here, on purpose.** Its siege is an assault on a fortified line, not a castle, and
giving it the Vale's walls with riflemen on them would be the same false move as drawing a tank as a knight.

Balancing a new war's siege: lay its two hosts beside the Vale's **by role**, not by headcount and not by worth.
Both of those were tried first and both were wrong. What decided it was that the horde had no bowmen — the
besieger's archers are what keep the wall's heads down while men are on the ladders. `tools/wars-test.mjs` now
checks every war's hosts for both (4:1 by worth, 15% of the host carrying shot), and `node tools/siege-run.mjs
--era <war>` fights them.

## The rule that outranks everything here

**APPEND-ONLY IDS.** An arm's id, a kit's id, a weapon's id and a missile's index are all *positions in an object*,
and every soldier in the realm's saves and its lockstep holds those numbers. New entries go at the END of each
table, never in the middle. The guard is `node tools/playtest.mjs`, whose hash must read `1554b43d` for any change
not meant to alter the Vale.
