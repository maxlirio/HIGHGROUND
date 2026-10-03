// Command groups: whatever the player last box-selected together becomes ONE group. Given an order,
// the group forms up as one body (foot in the centre, archers on the flanks, horse behind the wings,
// scouts ahead). Labels: each spatial cluster of a group's men gets ONE label listing every troop
// type in it (spear ×60, bow ×40 …). Men who drift off alone are bare dots.
// The sim keeps one unit per arm (combat needs it); u.group ties them together.
import { S_FLEE } from "../sim/soldiers.js";
import { ARMS, formationFiles } from "../sim/arms.js";

export const groupIdOf = (u) => u.group ?? -u.id; // never-grouped units are their own group
const LINK = 14; // m: men closer than this (via neighbours) are one body

// Castles (js/sim/castle.js): men on a wall-walk and men below it are not one body, however close on the map — a
// cluster is of men on one LEVEL (S.lvl), and its label stands at their height (`hOf(i)`: metres above the terrain,
// render/castle.js w.castleLevelH — g.h). A company split between levels (half of it still on the stair, a few left
// below) is labelled once, where most of its men are: the smaller part of the same companies close by on another level
// is folded into the larger.
export function computeGroups(w, hOf = null) {
  const S = w.S, byGid = new Map(), LV = S.lvl;
  for (const u of w.units.values()) {
    if (!u.members.length) continue;
    const gid = groupIdOf(u);
    let g = byGid.get(gid); if (!g) byGid.set(gid, (g = { gid, team: u.team, units: [], ids: [] }));
    g.units.push(u); for (const id of u.members) if (S.state[id] !== S_FLEE) g.ids.push(id);
  }
  const out = [];
  for (const g of byGid.values()) {
    // grid clustering: occupied LINK-sized cells on one level, union 8-connected neighbours
    const cells = new Map(), lvOf = (id) => LV ? Math.min(7, LV[id]) : 0;
    for (const id of g.ids) { const k = (((S.x[id] / LINK) | 0) * 4096 + ((S.y[id] / LINK) | 0)) * 8 + lvOf(id); let c = cells.get(k); if (!c) cells.set(k, (c = [])); c.push(id); }
    const seen = new Set(), mine = [];
    for (const k0 of cells.keys()) {
      if (seen.has(k0)) continue;
      const stack = [k0], members = []; seen.add(k0);
      while (stack.length) {
        const k = stack.pop(); members.push(...cells.get(k));
        const lv = k % 8, kk = (k - lv) / 8, ci = Math.floor(kk / 4096), cj = kk % 4096;
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
          const nk = ((ci + di) * 4096 + (cj + dj)) * 8 + lv; if (cells.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
        }
      }
      let sx = 0, sy = 0, sh = 0; const uids = new Set();
      for (const id of members) { sx += S.x[id]; sy += S.y[id]; if (hOf) sh += hOf(id) || 0; uids.add(S.unit[id]); }
      mine.push({ members, x: sx / members.length, y: sy / members.length, h: sh / members.length, uids });
    }
    // a company split across levels: its smaller part near its larger part (another level, within a couple of cells) joins it
    mine.sort((a, b) => b.members.length - a.members.length);
    for (let a = 0; a < mine.length; a++) {
      const A = mine[a]; if (!A) continue;
      for (let b = a + 1; b < mine.length; b++) {
        const B = mine[b]; if (!B || Math.hypot(A.x - B.x, A.y - B.y) > LINK * 2 || ![...B.uids].every((id) => A.uids.has(id))) continue;
        if (Math.abs(A.h - B.h) < 1 && LV && LV[A.members[0]] === LV[B.members[0]]) continue; // (the same level: two bodies apart on it)
        A.mainN ??= A.members.length; A.members.push(...B.members); mine[b] = null;
      }
    }
    for (const c of mine) {
      if (!c || c.members.length < 2) continue;
      const members = c.members, counts = new Map();
      if (hOf) { // (in a castle the label stands over a man: a file along a wall-walk round a tower has its centre over the bailey)
        const main = c.mainN ? members.slice(0, c.mainN) : members; // (over the larger part, where most of them are)
        let mx = 0, my = 0; for (const id of main) { mx += S.x[id]; my += S.y[id]; } mx /= main.length; my /= main.length;
        let bi = main[0], bd = Infinity; for (const id of main) { const d = (S.x[id] - mx) ** 2 + (S.y[id] - my) ** 2; if (d < bd) { bd = d; bi = id; } }
        c.x = S.x[bi]; c.y = S.y[bi]; c.h = hOf(bi) || 0;
      }
      for (const id of members) { const k = S.arm[id] + (S.horse[id] >= 3 ? 100 * S.horse[id] : 0); counts.set(k, (counts.get(k) || 0) + 1); } // (a learned mount reads at a distance: its own badge — js/sim/mounts.js)
      const unitIds = new Set(members.map((id) => S.unit[id]));
      const units = g.units.filter((u) => unitIds.has(u.id));
      const state = units.some((u) => u.state === "routing") ? "routing" : units.some((u) => u.state === "wavering") ? "wavering" : "formed";
      out.push({ gid: g.gid, team: g.team, units, allUnits: g.units, x: c.x, y: c.y, h: c.h, n: members.length, counts, state });
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
