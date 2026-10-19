// Three ladders, one set of rules (docs/eras-plan.md § A game each, stage 3). The owner chose a full game each,
// so a lord of 1944 does not climb the Vale's ladder with 1944's troops: he has his own standing, his own spoils
// and his own unlocks, and the two books are kept apart.
//
// What differs between the wars is CONTENT — which troops a lord starts with, what his spoils open, which picked
// companies exist and what his commander can learn. What does not differ is the machinery: points, tiers, drill,
// stakes, the handicap, how a bot is built to meet him. That machinery stays in js/sim/ranked-rules.js and reads
// a war's tables through here.
//
// Unlike the campaign (js/sim/eras/README.md), this IS a resolver — because there are three real cases, not one
// imagined one. A war with no ladder of its own falls back to the Vale's, so adding `ranked` to a war's `fields`
// in js/sim/wars.js is the only thing that turns one on.
import * as VALE from "./vale/ranked.js";
import * as MARCH from "./march/ranked.js";
import * as ARDENNES from "./ardennes/ranked.js";
import { DEFAULT_WAR } from "../wars.js";

export const RANKED_PACKS = { vale: VALE, march: MARCH, ardennes: ARDENNES };
export const rankedPack = (era) => RANKED_PACKS[era] || RANKED_PACKS[DEFAULT_WAR];
export const RANKED_ERAS = Object.keys(RANKED_PACKS);
