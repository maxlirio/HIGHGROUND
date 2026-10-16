// The town stages (docs: js/sim/townplan.js): data + the stage a team has reached. No imports, so that modules low in
// the import graph (js/sim/tech.js, read by labor.js) can use it without pulling in the economy. townplan.js re-exports it.
// The order a vill grows in. Each stage opens when the one before it has what it `needs` (completed).
export const STAGES = [
  { name: "Hamlet", kinds: ["house", "field", "lumber_camp", "mining_camp", "charcoal_kiln", "granary"], needs: {} },
  { name: "Village", kinds: ["palisade", "gate", "mill", "market", "temple", "weaver"], needs: { house: 4, granary: 1 } },
  { name: "Stockaded village", kinds: ["barracks", "archery_range", "stables", "paddock", "blacksmith", "fletcher", "bloomery", "siege_workshop"], needs: { palisade: 6, gate: 1 } },
  { name: "Town", kinds: ["stone_wall", "watchtower", "gatehouse", "mage_tower", "motte", "tithe_barn"], needs: { barracks: 1, blacksmith: 1, house: 10 } },
  // the late game (js/sim/estates.js: what each great building does; js/sim/tech.js: the studies some of them need)
  { name: "Chartered Borough", kinds: ["guildhall", "mint", "hospital", "shell_keep"], needs: { stone_wall: 2, market: 1, motte: 1, house: 16 } },
  { name: "Cathedral City", kinds: ["cathedral", "university", "lists"], needs: { guildhall: 1, hospital: 1, shell_keep: 1, house: 22 } },
  { name: "Ducal Seat", kinds: ["concentric_castle", "palace"], needs: { cathedral: 1, university: 1, lists: 1 } },
];
// a building raised on another and replacing it (js/sim/estates.js UPGRADES) still counts as what it replaced
const RAISED_ON = { shell_keep: "motte" };
export const stageOfKind = (kind) => Math.max(0, STAGES.findIndex((st) => st.kinds.includes(kind)));
export function stageStatus(w, team) {
  const have = {};
  for (const b of w.buildings) if (b.team === team && b.progress >= 1 && !b.ruin) have[b.kind] = (have[b.kind] || 0) + 1;
  for (const [k, up] of [["palisade", "stone_wall"], ["gate", "gatehouse"]]) if (have[up]) have[k] = (have[k] || 0) + have[up]; // (a palisade rebuilt in stone still walls the village: js/sim/demolish.js)
  for (const [up, k] of Object.entries(RAISED_ON)) if (have[up]) have[k] = (have[k] || 0) + have[up]; // (the shell keep stands on the motte: js/sim/estates.js)
  let reached = 0;
  for (let i = 1; i < STAGES.length; i++) { if (Object.entries(STAGES[i].needs).every(([k, n]) => (have[k] || 0) >= n)) reached = i; else break; }
  const next = STAGES[reached + 1];
  const missing = next ? Object.entries(next.needs).map(([k, n]) => ({ kind: k, have: have[k] || 0, need: n })) : [];
  return { reached, name: STAGES[reached].name, next: next?.name, missing, have };
}
export const unlocked = (w, team, kind) => stageOfKind(kind) <= stageStatus(w, team).reached;
