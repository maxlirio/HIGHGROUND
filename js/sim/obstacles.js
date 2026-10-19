// Physical obstacles on the battlefield: tree trunks, hedges, bushes, buildings, walls.
// Soldiers are bodies on the ground, not screen dots — after every tick anyone standing inside an
// obstacle is pushed back out along its surface, so men slide around trunks, bunch at hedge gaps
// and file round houses. (Where things ARE is always known to the sim, whether or not anyone is
// looking; what they LOOK like is the renderer's business.)
import { clamp } from "./soldiers.js";

// trunk / body radius in metres at scale 1 (species from maps/*/vegetation.json)
export const BODY_R = {
  oak_a: 0.75, oak_b: 0.7, oak_c: 0.7, oak_stump: 0.6, pine: 0.3, birch: 0.2, alder: 0.3, willow: 0.55,
  dead_tree: 0.4, fruit_tree: 0.15, bush: 0.9, hedge_shrub: 1.25, log: 0.35,
};
// building footprints (half extents, m) for objects.json assets; front faces −Y at rot 0
export const FOOTPRINT = {
  town_hall: [9, 7], house: [2.6, 6], house_a: [2.6, 6], house_b: [2.6, 4], house_c: [2.6, 4.5], barracks: [8, 5],
  archery_range: [3, 3], stables: [9, 6], blacksmith: [5, 4], fletcher: [4, 4], weaver: [4, 3.5], mill: [5, 5],
  granary: [5, 4], market: [2, 2], church: [5, 12], chapel: [2, 3], well: [1.2, 1.2], gallows: [1.5, 1.5],
  temple: [7, 11], mage_tower: [4.5, 4.5], watchtower: [2.5, 2.5], lumber_camp: [3, 2.5], mining_camp: [3, 2.5],
  ruin_keep: [6, 6], gatehouse: [6, 5], standing_stone: [0.6, 0.5], ley_stone: [0.8, 0.6],
};

const CELL = 8;

export function makeObstacles() {
  const O = { circles: new Map(), rects: new Map(), count: 0 };
  return O;
}
const key = (i, j) => i * 100000 + j;

export function addCircle(O, x, y, r) {
  const k = key((x / CELL) | 0, (y / CELL) | 0);
  let b = O.circles.get(k); if (!b) O.circles.set(k, (b = [])); b.push(x, y, r); O.count++;
}
export function addRect(O, x, y, rot, hx, hy, bid) {
  const R = Math.hypot(hx, hy);
  const rec = { x, y, c: Math.cos(rot), s: Math.sin(rot), hx, hy };
  if (bid !== undefined) rec.bid = bid; // (a building's box: its crew at their stations stand inside it — js/sim/jobs/workshops.js)
  (O.fresh ||= []).push(rec); // new footprints, for the nav grid (main drains this)
  for (let i = ((x - R) / CELL) | 0; i <= ((x + R) / CELL) | 0; i++) for (let j = ((y - R) / CELL) | 0; j <= ((y + R) / CELL) | 0; j++) {
    const k = key(i, j); let b = O.rects.get(k); if (!b) O.rects.set(k, (b = [])); b.push(rec);
  }
  O.count++;
}

export function loadVegetation(O, veg) {
  // (the tree list, for felling — js/sim/jobs/forestry.js: static map data, so non-enumerable: the realm save skips it
  // and a restored world keeps its template's)
  Object.defineProperty(O, "veg", { value: veg.instances, enumerable: false, configurable: true, writable: true });
  for (const it of veg.instances) {
    const r = (BODY_R[it.asset] ?? 0.4) * (it.scale || 1);
    addCircle(O, it.x, it.y, r);
  }
}
// the trunks as a tree list puts them (circles before any felling) — built once per list: the realm saves only the
// buckets that differ (server/persist.mjs), and a world saved on the Vale alone gets the big world's other trees back
const pristineTrunks = new WeakMap();
export function trunksOf(veg) {
  let P = pristineTrunks.get(veg); if (!P) { const O = makeObstacles(); loadVegetation(O, { instances: veg }); P = O.circles; pristineTrunks.set(veg, P); }
  return P;
}
// measured = assets/footprints.json (tools/footprints.mjs reads the real models); falls back to FOOTPRINT
export function loadObjects(O, od, measured = {}) {
  for (const o of od.objects) {
    if (o.start === false) continue;
    const m = measured[o.asset], sc = o.scale || 1, rot = o.rot || 0;
    if (m && (FOOTPRINT[o.asset] || m[1] - m[0] > 3)) {
      const lx = (m[0] + m[1]) / 2 * sc, ly = (m[2] + m[3]) / 2 * sc, c = Math.cos(rot), s = Math.sin(rot);
      addRect(O, o.x + lx * c - ly * s, o.y + lx * s + ly * c, rot, (m[1] - m[0]) / 2 * sc, (m[3] - m[2]) / 2 * sc, o.bid);
    } else if (FOOTPRINT[o.asset]) addRect(O, o.x, o.y, rot, FOOTPRINT[o.asset][0] * sc, FOOTPRINT[o.asset][1] * sc, o.bid);
  }
}

// is a point blocked (for pathing / placement checks)
export function blocked(O, x, y, pad = 0) {
  const i = (x / CELL) | 0, j = (y / CELL) | 0;
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    const b = O.circles.get(key(i + di, j + dj));
    if (b) for (let k = 0; k < b.length; k += 3) if ((x - b[k]) ** 2 + (y - b[k + 1]) ** 2 < (b[k + 2] + pad) ** 2) return true;
  }
  const rs = O.rects.get(key(i, j));
  if (rs) for (const r of rs) { const dx = x - r.x, dy = y - r.y, lx = dx * r.c + dy * r.s, ly = -dx * r.s + dy * r.c; if (Math.abs(lx) < r.hx + pad && Math.abs(ly) < r.hy + pad) return true; }
  return false;
}

// sim system: push every standing man out of whatever he has walked into
const BODY = 0.28; // a man's own radius
export function obstacleSystem(w) {
  const O = w.obstacles; if (!O || !O.count) return;
  const S = w.S, M = w.map;
  for (let id = 0; id < S.n; id++) {
    if (!S.alive[id] || S.lvl[id]) continue; // (castle.js: men on a wall-walk or a tower floor are above whatever stands on the ground)
    let x = S.x[id], y = S.y[id];
    const i = (x / CELL) | 0, j = (y / CELL) | 0;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const b = O.circles.get(key(i + di, j + dj)); if (!b) continue;
      for (let k = 0; k < b.length; k += 3) {
        const dx = x - b[k], dy = y - b[k + 1], R = b[k + 2] + BODY, d2 = dx * dx + dy * dy;
        if (d2 >= R * R) continue;
        const d = Math.sqrt(d2) || 1e-3;
        // push out, with a small sideways bias so a man heading straight at a trunk slides past it
        const nx = d2 ? dx / d : 1, ny = d2 ? dy / d : 0;
        const side = ((id & 1) ? 1 : -1) * 0.15;
        x = b[k] + (nx - ny * side) * R; y = b[k + 1] + (ny + nx * side) * R;
      }
    }
    const rs = O.rects.get(key(i, j));
    if (rs) for (const r of rs) {
      const dx = x - r.x, dy = y - r.y, lx = dx * r.c + dy * r.s, ly = -dx * r.s + dy * r.c;
      const hx = r.hx + BODY, hy = r.hy + BODY;
      if (Math.abs(lx) >= hx || Math.abs(ly) >= hy) continue;
      if (r.bid !== undefined && w.labor?.men.get(id)?.inB === r.bid) continue; // (a workshop's crew at their stations, in its yard and bays)
      // exit through the nearest face
      let ox = lx, oy = ly;
      if (hx - Math.abs(lx) < hy - Math.abs(ly)) ox = Math.sign(lx || 1) * hx; else oy = Math.sign(ly || 1) * hy;
      x = r.x + ox * r.c - oy * r.s; y = r.y + ox * r.s + oy * r.c;
    }
    S.x[id] = clamp(x, M.x0, M.x1); S.y[id] = clamp(y, M.y0, M.y1);
  }
}
