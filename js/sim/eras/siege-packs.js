// Which war's castle this is (docs/eras-plan.md § A game each). The castle, the engines, the mining, the escalade
// and the starving are era-agnostic — what is not is WHO is on the walls and who is at the gate.
//
// The Ardennes has no pack here on purpose. Its siege is an assault on a fortified line, not a castle, and giving
// it the Vale's walls with riflemen on them would be the same false move as drawing a tank as a knight.
import * as VALE from "./vale/siege.js";
import * as MARCH from "./march/siege.js";
import { DEFAULT_WAR } from "../wars.js";

export const SIEGE_PACKS = { vale: VALE, march: MARCH };
export const siegePack = (era) => SIEGE_PACKS[era] || SIEGE_PACKS[DEFAULT_WAR];
export const SIEGE_ERAS = Object.keys(SIEGE_PACKS);
