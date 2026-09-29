// Command groups: whatever the player last box-selected together becomes ONE group. Given an order,
// the group forms up as one body (foot in the centre, archers on the flanks, horse behind the wings,
// scouts ahead). Labels: each spatial cluster of a group's men gets ONE label listing every troop
// type in it (spear ×60, bow ×40 …). Men who drift off alone are bare dots.
// The sim keeps one unit per arm (combat needs it); u.group ties them together.
import { S_FLEE } from "../sim/soldiers.js";
import { ARMS, formationFiles } from "../sim/arms.js";

export const groupIdOf = (u) => u.group ?? -u.id; // never-grouped units are their own group
const LINK = 14; // m: men closer than this (via neighbours) are one body

export function computeGroups(w) {
  const S = w.S, byGid = new Map();
  for (const u of w.units.values()) {
    if (!u.members.length) continue;
    const gid = groupIdOf(u);
    let g = byGid.get(gid); if (!g) byGid.set(gid, (g = { gid, team: u.team, units: [], ids: [] }));
    g.units.push(u); for (const id of u.members) if (S.state[id] !== S_FLEE) g.ids.push(id);
  }
  const out = [];
  for (const g of byGid.values()) {
    // grid clustering: occupied LINK-sized cells, union 8-connected neighbours
    const cells = new Map();
    for (const id of g.ids) { const k = ((S.x[id] / LINK) | 0) * 4096 + ((S.y[id] / LINK) | 0); let c = cells.get(k); if (!c) cells.set(k, (c = [])); c.push(id); }
    const seen = new Set();
    for (const k0 of cells.keys()) {
      if (seen.has(k0)) continue;
      const stack = [k0], members = []; seen.add(k0);
      while (stack.length) {
        const k = stack.pop(); members.push(...cells.get(k));
        const ci = Math.floor(k / 4096), cj = k % 4096;
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
          const nk = (ci + di) * 4096 + (cj + dj); if (cells.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
        }
      }
      if (members.length < 2) continue;
      const counts = new Map(); let sx = 0, sy = 0;
      for (const id of members) { counts.set(S.arm[id], (counts.get(S.arm[id]) || 0) + 1); sx += S.x[id]; sy += S.y[id]; }
      const unitIds = new Set(members.map((id) => S.unit[id]));
      const units = g.units.filter((u) => unitIds.has(u.id));
      const state = units.some((u) => u.state === "routing") ? "routing" : units.some((u) => u.state === "wavering") ? "wavering" : "formed";
      out.push({ gid: g.gid, team: g.team, units, allUnits: g.units, x: sx / members.length, y: sy / members.length, n: members.length, counts, state });
    }
  }
  return out;
}

// Per-unit destinations so a mixed group arrives as one battle line facing `facing` (radians,
// direction of advance). Returns Map(unitId → {x, y}).
export function groupLayout(units, x, y, facing) {
  const fx = Math.cos(facing), fy = Math.sin(facing), rx = Math.sin(facing), ry = -Math.cos(facing); // forward, right
  const width = (u) => formationFiles(u.formation, u.members.length) * ARMS[u.arm].spacing * 1.05 + 6;
  const foot = units.filter((u) => !ARMS[u.arm].mounted && !ARMS[u.arm].missile);
  const shot = units.filter((u) => ARMS[u.arm].missile);
  const horse = units.filter((u) => ARMS[u.arm].mounted && u.arm !== "scouts");
  const scouts = units.filter((u) => u.arm === "scouts");
  const out = new Map(); const at = (u, side, fwd) => out.set(u.id, { x: x + rx * side + fx * fwd, y: y + ry * side + fy * fwd });
  // centre: foot side by side
  const footW = foot.reduce((s, u) => s + width(u), 0); let cur = -footW / 2;
  for (const u of foot) { at(u, cur + width(u) / 2, 0); cur += width(u); }
  // flanks: missile troops alternate right/left, slightly forward
  let R = footW / 2, L = -footW / 2;
  shot.forEach((u, k) => { const wdt = width(u); if (k % 2 === 0) { at(u, R + wdt / 2, 4); R += wdt; } else { at(u, L - wdt / 2, 4); L -= wdt; } });
  // horse behind the wings
  horse.forEach((u, k) => at(u, (k % 2 === 0 ? R : L) * 0.8, -25 - 12 * Math.floor(k / 2)));
  scouts.forEach((u, k) => at(u, (k - (scouts.length - 1) / 2) * 30, 90));
  return out;
}
