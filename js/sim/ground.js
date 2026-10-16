import { terrainAt } from "./landread.js";
// Ground: the combat model's view of terrain, placed features, weather and the bodies on the field
// (docs/combat-research.md §16). Reads js/sim/terrain-types.js tables through `w.terrain` (TERRAIN) and
// tolerates missing fields, so the sim runs with an empty table too.
import { FEATURES, WEATHER, ELEVATION } from "./terrain-types.js";
import { eachFeatureNear, pointSeg } from "./features.js";
export { FEATURES, WEATHER, ELEVATION };

const DEF = { footing: { slip: 0.01, fall: 0.002 }, chargeViable: 1, cohesionMul: 1, cover: { soft: 0, hard: 0 }, fatigueMul: 1.1 };

export function ground(w, x, y) { return terrainAt(w, x, y) || DEF; }

// footing {slip, fall} per exchange, worsened by bodies underfoot (Agincourt's "wall of dead") and water
const FOOT = { slip: 0, fall: 0 };
export function footing(w, x, y, out = FOOT) {
  const t = ground(w, x, y), f = t.footing;
  let slip = typeof f === "number" ? f : f?.slip ?? 0.01, fall = typeof f === "number" ? f * 0.2 : f?.fall ?? 0.002;
  const wet = (weather(w).groundWetRate > 0.2 ? 1.3 : 1) * (1 + 0.5 * mud(w));
  const b = w.cs ? bodiesAt(w.cs, x, y) : 0;
  const wd = w.map.water(x, y);
  out.slip = Math.min(0.9, slip * wet * (1 + 1.5 * b) + (wd > 0.3 ? 0.05 : 0));
  out.fall = Math.min(0.5, fall * wet * (1 + 2 * b) + (wd > 0.3 ? 0.01 : 0));
  return out;
}
// Sustained rain turns the open ground to mud (0 = firm, 1 = Agincourt). Battles bake days of rain
// into the land itself (battle.prepareField afterRain → landread); the LIVE world instead carries
// the calendar sky's windowed wetness on w.wx (js/sim/weather.js), and it dries off after.
export function mud(w) { const wet = w.wx?.wet || 0; return wet > 0.45 ? (wet - 0.45) / 0.55 : 0; }
export const chargeViable = (w, x, y) => (ground(w, x, y).chargeViable ?? 1) * (1 - 0.7 * mud(w)); // (a charge over mud arrives a crowd, not a blow)
export const cohesionMul = (w, x, y) => { const t = ground(w, x, y); return (t.cohesionMul ?? t.formationCohesionMul ?? 1) * (1 - 0.3 * mud(w)); };
export function coverAt(w, x, y) {
  const c = ground(w, x, y).cover;
  if (typeof c === "number") return { soft: c, hard: 0 };
  return c || DEF.cover;
}

export function weather(w) { return WEATHER[w.weather] || WEATHER.clear || { visibilityM: 20000, missileDispersionMul: 1, stressAdd: 0 }; }

// ---------------------------------------------------------------- bodies (1 m cells)
export function bodiesAt(cs, x, y) { return cs.bodies.get(((x | 0) << 13) ^ (y | 0)) || 0; }
export function addBody(cs, x, y, n = 1) { const k = ((x | 0) << 13) ^ (y | 0); cs.bodies.set(k, (cs.bodies.get(k) || 0) + n); }
export function removeBody(cs, x, y) { const k = ((x | 0) << 13) ^ (y | 0); const v = (cs.bodies.get(k) || 0) - 1; if (v > 0) cs.bodies.set(k, v); else cs.bodies.delete(k); }

// ---------------------------------------------------------------- placed features
// w.features: [{ type: FEATURES key, x0, y0, x1, y1, width? }] — a line (wall, hedge, ditch, stakes) or a
// strip (pits). Queries are brute force: a battlefield has tens of features, not thousands.
export function featureDef(f) { return FEATURES[f.type] || {}; }

// First feature whose line the segment a→b crosses (or whose strip it enters), or null.
export function featureCrossed(w, ax, ay, bx, by, filter) {
  let hit = null;
  eachFeatureNear(w, ax, ay, bx, by, 2, (f) => { if (filter && !filter(f)) return false; if (segDist(ax, ay, bx, by, f) <= (f.width || 1) / 2) { hit = f; return true; } return false; });
  return hit;
}
// Is point p within `r` of a feature (e.g. "am I standing behind a wall")?
export function featureNear(w, x, y, r, filter) {
  let hit = null;
  eachFeatureNear(w, x, y, x, y, r + 2, (f) => { if (filter && !filter(f)) return false; if (pointSeg(x, y, f.x0, f.y0, f.x1, f.y1) <= r + (f.width || 1) / 2) { hit = f; return true; } return false; });
  return hit;
}
function segDist(ax, ay, bx, by, f) {
  // distance between segment ab and feature segment (0 if they intersect)
  if (segsIntersect(ax, ay, bx, by, f.x0, f.y0, f.x1, f.y1)) return 0;
  return Math.min(pointSeg(ax, ay, f.x0, f.y0, f.x1, f.y1), pointSeg(bx, by, f.x0, f.y0, f.x1, f.y1),
    pointSeg(f.x0, f.y0, ax, ay, bx, by), pointSeg(f.x1, f.y1, ax, ay, bx, by));
}
function segsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = cross(cx, cy, dx, dy, ax, ay), d2 = cross(cx, cy, dx, dy, bx, by), d3 = cross(ax, ay, bx, by, cx, cy), d4 = cross(ax, ay, bx, by, dx, dy);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
const cross = (x0, y0, x1, y1, px, py) => (x1 - x0) * (py - y0) - (y1 - y0) * (px - x0);

// Movement penalty from features and bodies for world.goingMul (installed by combat as w.goingHook).
export function goingHook(w) {
  return (x, y, cls) => {
    let m = 1;
    const cs = w.cs;
    if (cs && cs.bodies.size) { const b = bodiesAt(cs, x, y); if (b) m /= 1 + (cls === "cavalry" ? 0.6 : 0.35) * b; }
    const F = w.features;
    // the worst single feature under his feet: two segments of one hedge meeting at a corner are one hedge,
    // not two (multiplying them froze columns at every joint of the map's 3,000 hedge runs)
    let fm = 1;
    if (F && F.length) eachFeatureNear(w, x, y, x, y, 3, (f) => {
      const D = featureDef(f); if (!D.cross) return false;
      if (pointSeg(x, y, f.x0, f.y0, f.x1, f.y1) > (f.width || 1) / 2 + 0.5) return false;
      // a flat end stops square (a moat at a gate's causeway, or where it has been filled across): the causeway beside it is open ground
      if (f.flatA || f.flatB) { const dx = f.x1 - f.x0, dy = f.y1 - f.y0, t = ((x - f.x0) * dx + (y - f.y0) * dy) / (dx * dx + dy * dy || 1); if ((f.flatA && t < 0) || (f.flatB && t > 1)) return false; }
      const s = D.cross[cls] ?? D.cross.foot; // seconds to cross one span
      const k = s === Infinity ? 0.02 : Math.min(1, 1.5 / Math.max(0.5, s)); // ~1.5 m span
      if (k < fm) fm = k;
      return false;
    });
    return m * fm;
  };
}
