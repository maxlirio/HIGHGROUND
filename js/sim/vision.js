// Fog of war: what each team can see, with real line of sight over the heightfield.
// Grid values: 0 = never seen, 1 = explored (remembered), 2 = visible now.
// Observers on high ground see much further (horizon + no terrain masking) — that is the point.
import { ARM_BY_ID } from "./arms.js";
import { WEATHER } from "./terrain-types.js";

export function makeVision(map, cellM = 20) {
  const n = Math.ceil(map.size / cellM);
  return { n, cellM, teams: [new Uint8Array(n * n), new Uint8Array(n * n)], every: 10 };
}

// blockers(x,y) → extra obstruction height (forest canopy, buildings); optional
export function updateVision(w, V, blockers = null) {
  if (w.tick % V.every) return;
  const { n, cellM } = V, map = w.map, S = w.S;
  for (const grid of V.teams) for (let k = 0; k < grid.length; k++) if (grid[k] === 2) grid[k] = 1;
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
  const done = new Set(); // observers standing within the same 30 m cell see the same thing: cast once
  for (const e of eyes) {
    let x, y, team, eye, range;
    if (typeof e === "number") {
      const A = ARM_BY_ID[S.arm[e]]; x = S.x[e]; y = S.y[e]; team = S.team[e];
      eye = A.mounted ? 2.5 : 1.65; range = (A.glyph === "eye" ? 1400 : 900) * weatherMul;
    } else ({ x, y, team, eye, range } = e);
    const key = team * 1e8 + ((x / 30) | 0) * 1e4 + ((y / 30) | 0) + (eye > 2 ? 0.5 : 0) + (range > 1000 ? 0.25 : 0);
    if (done.has(key)) continue; done.add(key);
    const grid = V.teams[team]; const h0 = map.h(x, y) + eye;
    // high ground extends range (more of the landscape is above the line of sight)
    range *= 1 + Math.max(0, h0 - 60) / 200;
    const rays = 96;
    for (let r = 0; r < rays; r++) {
      const a = (r / rays) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
      let maxTan = -Infinity;
      for (let d = cellM * 0.5; d < range; d += cellM * 0.75) {
        const px = x + dx * d, py = y + dy * d; if (!map.inBounds(px, py)) break;
        const g = map.h(px, py), extra = blockers ? blockers(px, py) : 0;
        // target visible if its top (1.7 m man) rises above the horizon so far
        const tanT = (g + 1.7 - h0) / d;
        const ci = (px / cellM) | 0, cj = (py / cellM) | 0, k = cj * n + ci;
        if (tanT >= maxTan) grid[k] = 2; else if (grid[k] === 0 && d < 60) grid[k] = 1;
        const tanG = (g + extra - h0) / d;
        if (tanG > maxTan) maxTan = tanG;
        if (extra > 4 && d > 40) maxTan = Math.max(maxTan, (g + extra * 3 - h0) / d); // woods quickly stop sight
      }
    }
  }
}

export function canSee(V, team, x, y) {
  const i = (x / V.cellM) | 0, j = (y / V.cellM) | 0;
  return V.teams[team][j * V.n + i] === 2;
}
