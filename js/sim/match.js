// The match: when a side has lost, and the tally the end screen reads.
// A side loses when its keep is ruined, its town has fallen (stormed or starved — logistics.js), or it
// has no soldiers and no villagers left on the map. Shared by the game shell and the headless checks.
import { S_GONE } from "./economy.js";

export function sideLost(w, team) {
  const T = w.teams[team]; if (!T?.store) return null;
  const hall = w.buildings.find((b) => b.id === T.hall);
  if (!hall || hall.ruin) return "its keep lies in ruins";
  if (T.fallen) return `${T.fallReason || "the town has fallen"}`;
  for (const u of w.units.values()) if (u.team === team && u.members.length) return null;
  return "no soldier and no villager is left to it";
}

// → null while the match is undecided, else { winner, loser, why }
export function matchOutcome(w) {
  for (const team of [0, 1]) {
    const why = sideLost(w, team);
    if (why) return { winner: 1 - team, loser: team, why };
  }
  return null;
}

// Running tally for the end screen (fed each tick from w.events: kills are QUIET, so they never reach w.log).
export function makeTally() {
  return { dead: [0, 0], wounded: [0, 0], routs: [0, 0], recruited: [0, 0], built: [0, 0], lost: [0, 0], spells: [0, 0], convoysLost: [0, 0], battles: [] };
}
export function tallyEvents(w, R) {
  const S = w.S;
  for (const e of w.events) {
    if (e.kind === "kill" || e.kind === "die") { const t = S.team[e.victim ?? e.who]; if (t === 0 || t === 1) R.dead[t]++; }
    else if (e.kind === "down") { const t = S.team[e.victim]; if (t === 0 || t === 1) R.wounded[t]++; }
    else if (e.kind === "unit-routing" && (e.team === 0 || e.team === 1)) R.routs[e.team]++;
    else if (e.kind === "recruited") R.recruited[e.team] += e.count || 0;
    else if (e.kind === "built") R.built[e.team]++;
    else if (e.kind === "building-lost") R.lost[e.team]++;
    else if (e.kind === "spell") R.spells[e.team]++;
    else if (e.kind === "convoy-lost") R.convoysLost[e.team]++;
  }
}
export { S_GONE };
