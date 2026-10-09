// Fog of war: what each team can see, with real line of sight over the heightfield.
// Grid values: 0 = never seen, 1 = explored (remembered), 2 = visible now.
// Observers on high ground see much further (horizon + no terrain masking) — that is the point.
import { ARM_BY_ID } from "./arms.js";
import { WEATHER } from "./terrain-types.js";

export function makeVision(map, cellM = 20) {
  const n = Math.ceil(map.size / cellM);
  return { n, cellM, ox: map.x0 || 0, oy: map.y0 || 0, teams: [new Uint8Array(n * n), new Uint8Array(n * n)], every: 10 };
}
// the fog cell under (x, y) (k = j·n + i; −1 off the grid). The grid covers the map's extent from (ox, oy).
export const visIdx = (V, x, y) => { const i = ((x - (V.ox || 0)) / V.cellM) | 0, j = ((y - (V.oy || 0)) / V.cellM) | 0; return i >= 0 && j >= 0 && i < V.n && j < V.n ? j * V.n + i : -1; };
// cells made visible on the last pass, per team (not saved: a restored world scans its grids once instead)
const lit = new WeakMap();

// blockers(x,y) → extra obstruction height (forest canopy, buildings); optional
export function updateVision(w, V, blockers = null) {
  if (w.tick % V.every) return;
  const { n, cellM } = V, map = w.map, S = w.S, ox = V.ox || 0, oy = V.oy || 0;
  // what was in sight is now only remembered (the cells lit last pass: a big world's grids are mostly dark)
  let L = lit.get(V);
  if (!L || L.length !== V.teams.length) { for (const grid of V.teams) for (let k = 0; k < grid.length; k++) if (grid[k] === 2) grid[k] = 1; L = V.teams.map(() => []); lit.set(V, L); }
  else for (let t = 0; t < V.teams.length; t++) { const grid = V.teams[t], list = L[t]; for (let q = 0; q < list.length; q++) if (grid[list[q]] === 2) grid[list[q]] = 1; list.length = 0; }
  const eyes = [];
  for (const u of w.units.values()) {
    // observers: one per ~8 soldiers is plenty; spread across the unit so a wide line sees wide
    // (work crews clustered at a job: two lookouts are enough)
    const step = Math.max(1, Math.floor(u.members.length / (u.isWorkers ? 2 : 8)));
    for (let k = 0; k < u.members.length; k += step) eyes.push(u.members[k]);
  }
  for (const b of w.buildings || []) if (b.sight && b.progress >= 1 && !b.ruin) eyes.push({ x: b.x, y: b.y, team: b.team, eye: b.eyeH || 8, range: b.sight });
  V.dirty = true;
  // weather (w.weather names a WEATHER entry: fog and heavy rain shorten sight), the light (dusk: w.lightMul), mist: economy.castSpell
  const wv = WEATHER[w.weather]?.visibilityM ?? 20000;
  const weatherMul = Math.min(1, wv / 1000) * (w.lightMul ?? 1) * (w.mist && w.tick < w.mist.until ? w.mist.visibility : 1);
  // smoke from a fire in the woods (js/sim/wildfire.js: w.fire.smoke, m of smoke per 16 m cell) stands like the canopy
  const SM = w.fire?.cells?.length && w.fire.smoke?.size ? w.fire.smoke : null, SB = SM?.box || [0, 0, 0, 0];
  const done = new Set(); // observers standing within the same 30 m cell see the same thing: cast once
  for (const e of eyes) {
    let x, y, team, eye, range;
    if (typeof e === "number") {
      const A = ARM_BY_ID[S.arm[e]]; x = S.x[e]; y = S.y[e]; team = S.team[e];
      eye = A.mounted ? 2.5 : 1.65; range = (A.glyph === "eye" ? 1400 : 900) * weatherMul;
    } else ({ x, y, team, eye, range } = e);
    const key = team * 1e8 + (((x - ox) / 30) | 0) * 1e4 + (((y - oy) / 30) | 0) + (eye > 2 ? 0.5 : 0) + (range > 1000 ? 0.25 : 0);
    if (done.has(key)) continue; done.add(key);
    const grid = V.teams[team], litT = L[team]; const h0 = map.h(x, y) + eye;
    // high ground extends range (more of the landscape is above the line of sight)
    range *= 1 + Math.max(0, h0 - 60) / 200;
    const rays = 96;
    for (let r = 0; r < rays; r++) {
      const a = (r / rays) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
      let maxTan = -Infinity;
      for (let d = cellM * 0.5; d < range; d += cellM * 0.75) {
        const px = x + dx * d, py = y + dy * d; if (!map.inBounds(px, py)) break;
        const g = map.h(px, py), extra = (blockers ? blockers(px, py) : 0) + (SM && px >= SB[0] && px < SB[2] && py >= SB[1] && py < SB[3] ? SM.get(Math.floor(px / 16) * 65536 + Math.floor(py / 16)) || 0 : 0);
        // target visible if its top (1.7 m man) rises above the horizon so far
        const tanT = (g + 1.7 - h0) / d;
        const ci = ((px - ox) / cellM) | 0, cj = ((py - oy) / cellM) | 0, k = cj * n + ci;
        if (tanT >= maxTan) { if (grid[k] !== 2) { grid[k] = 2; litT.push(k); } } else if (grid[k] === 0 && d < 60) grid[k] = 1;
        const tanG = (g + extra - h0) / d;
        if (tanG > maxTan) maxTan = tanG;
        if (extra > 4 && d > 40) maxTan = Math.max(maxTan, (g + extra * 3 - h0) / d); // woods quickly stop sight
      }
    }
  }
}

export function canSee(V, team, x, y) {
  const i = ((x - (V.ox || 0)) / V.cellM) | 0, j = ((y - (V.oy || 0)) / V.cellM) | 0;
  return V.teams[team][j * V.n + i] === 2;
}
