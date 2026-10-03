// Two-clock model (docs/economy-research.md §10). Every ratio WITHIN a domain stays real.
// The sim ticks at a fixed REAL rate (world.TICK real seconds per tick); each domain converts.

// Tactical clock: combat, movement, fatigue, missiles, morale, bleeding. REAL TIME (owner: men must
// move at a believable walking pace on screen; at 4× they looked like they ran at 50 mph).
export const BATTLE_RATE = 1;
// The sim's fixed tick in REAL seconds (world.js re-exports it) and the combat model's perception cadence:
// every man looks about him once per PERCEIVE_S battle-seconds whatever the clock rate, so the per-pass
// probabilities and rates calibrated in docs/combat-implementation.md keep their battle-time meaning.
export const TICK = 0.1;
export const PERCEIVE_S = 2;
export const PERC = Math.max(1, Math.round(PERCEIVE_S / (TICK * BATTLE_RATE))); // ticks between a man's perception passes

// Economic clock: labour, construction, production, growth, rations, starvation, training.
// 1 real minute = 1.5 economic days → a 75-min match ≈ one campaign season (research §10).
// The always-on Realm runs slower (docs/realm-world.md "Pacing"): its server sets globalThis.HG_ECON_PACE (econ days per
// real minute, e.g. 0.25 = one year a real day) BEFORE the sim modules load (server/pace.mjs). Nothing else sets it.
export const ECON_DAYS_PER_REAL_MIN = (typeof globalThis !== "undefined" && +globalThis.HG_ECON_PACE > 0) ? +globalThis.HG_ECON_PACE : 1.5;
export const ECON_DAYS_PER_REAL_SEC = ECON_DAYS_PER_REAL_MIN / 60;
// Helpers take REAL seconds (world.TICK is real seconds per tick).
export const econDays = (realSec) => realSec * ECON_DAYS_PER_REAL_SEC;
export const realSecForEconDays = (days) => days / ECON_DAYS_PER_REAL_SEC;
export const battleSecs = (realSec) => realSec * BATTLE_RATE;
