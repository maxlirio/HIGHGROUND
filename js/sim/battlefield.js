// The battlefield: where two hosts meet on the Vale, what the ground between them is, and how each side draws
// up on it. Everything here is READ from the land (js/sim/landread.js fields, the map's water and canopy) —
// a ridge is a ridge because the heights say so, a wood closes a flank because the canopy is there.
//
// Frame: a field is a site (x, y) and an axis (the heading from side 0's ground toward side 1's). fwd is
// along the axis, lat is to side 0's LEFT. Side 0 stands at fwd = −sep/2, side 1 at +sep/2.
//
//   frameOf(site, axis)             → { at(fwd, lat), local(x, y), ... }
//   zonesOf(site, axis)             → [zone0, zone1] deployment grounds (oriented rectangles)
//   surveyField(map, site, axis)    → what the ground is: profile, rises, woods, water, marsh, going; plain lines
//   findSite(map, score, opts)      → the best site/axis by a scenario's wants (every site on a grid × 8 axes)
//   TROOPS / composeHost / costOf   → wages (period rates) and a host picked by a commander's temper
//   placeHost(w, …)                 → units drawn up in a zone: foot in the centre, bows on the wings, horse behind,
//                                     the line put on the best ground of the zone for the commander's temper
import { ARMS, FORMATIONS, formationFiles } from "./arms.js";
import { addUnit } from "./world.js";
import { fieldWork, addFeature } from "./features.js";

export const FIELD = { sep: 520, zoneDepth: 220, zoneWidth: 760, edge: 60 };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------- geometry
export function frameOf(site, axis) {
  const fx = Math.cos(axis), fy = Math.sin(axis), lx = -fy, ly = fx;
  return {
    x: site.x, y: site.y, axis, fx, fy, lx, ly,
    at: (fwd, lat) => ({ x: site.x + fx * fwd + lx * lat, y: site.y + fy * fwd + ly * lat }),
    local: (x, y) => ({ fwd: (x - site.x) * fx + (y - site.y) * fy, lat: (x - site.x) * lx + (y - site.y) * ly }),
  };
}
// zone k: side k's deployment ground. face = the heading its men look (toward the other side)
export function zonesOf(site, axis, o = {}) {
  const sep = o.sep ?? FIELD.sep, depth = o.zoneDepth ?? FIELD.zoneDepth, width = o.zoneWidth ?? FIELD.zoneWidth;
  const F = frameOf(site, axis);
  return [-1, 1].map((sg, k) => {
    const c = F.at(sg * sep / 2, 0);
    return { side: k, cx: c.x, cy: c.y, fwd0: sg * sep / 2, face: k === 0 ? axis : axis + Math.PI, w: width, d: depth, frame: F };
  });
}
// zone-local coordinates: front (+ toward the enemy), lat (+ to this side's left)
export function zoneLocal(z, x, y) {
  const fx = Math.cos(z.face), fy = Math.sin(z.face), dx = x - z.cx, dy = y - z.cy;
  return { front: dx * fx + dy * fy, lat: -dx * fy + dy * fx };
}
export function zonePoint(z, front, lat) {
  const fx = Math.cos(z.face), fy = Math.sin(z.face);
  return { x: z.cx + fx * front - fy * lat, y: z.cy + fy * front + fx * lat };
}
export function inZone(z, x, y, pad = 0) { const p = zoneLocal(z, x, y); return Math.abs(p.front) <= z.d / 2 + pad && Math.abs(p.lat) <= z.w / 2 + pad; }
export function clampToZone(z, x, y, pad = 0) {
  const p = zoneLocal(z, x, y), hd = z.d / 2 - pad, hw = z.w / 2 - pad;
  return zonePoint(z, Math.max(-hd, Math.min(hd, p.front)), Math.max(-hw, Math.min(hw, p.lat)));
}

// ---------------------------------------------------------------- the land, sampled
export function sampler(map) {
  const L0 = map.land, cov = L0?.covers; // (a streamed world's land covers its core square only: elsewhere the canopy and the surface)
  const k = (x, y) => L0.idx(x, y), Lat = cov ? (x, y) => (cov(x, y) ? L0 : null) : () => L0;
  const SR = /rock|scree|cliff|boulder/, SB = /marsh|bog|fen|carr|mud/;
  return {
    h: map.h, water: map.water,
    bog: (x, y) => { const L = Lat(x, y); if (!L) return cov && SB.test(map.surfaceAt(x, y)) ? 0.8 : 0; const i = k(x, y); if (L.water && L.water[i] > 0.05) return 0; return clamp01((L.wet[i] - 0.6) * 3.5) * (1 - L.rock[i]); },
    wood: (x, y) => { const L = Lat(x, y); return L ? L.vegD[k(x, y)] : Math.min(1, map.canopy(x, y) / 14); },
    rock: (x, y) => { const L = Lat(x, y); return L ? L.rock[k(x, y)] : cov && SR.test(map.surfaceAt(x, y)) ? 0.8 : 0; },
    slope: (x, y) => { const L = Lat(x, y); return L ? L.slope[k(x, y)] : cov ? Math.hypot(...map.grad(x, y)) : 0; },
    road: (x, y) => { const L = Lat(x, y); return L?.road ? L.road[k(x, y)] : cov && /track|street|hollow/.test(map.surfaceAt(x, y)) ? 1 : 0; },
    inside: (x, y, m = 20) => x > map.x0 + m && y > map.y0 + m && x < map.x1 - m && y < map.y1 - m,
  };
}

// ---------------------------------------------------------------- survey
// What the ground between and around the two zones is. `coarse` = the fast version the site search uses.
export function surveyField(map, site, axis, { coarse = false, sep = FIELD.sep } = {}) {
  const F = frameOf(site, axis), s = sampler(map), half = sep / 2, zd = FIELD.zoneDepth, zw = FIELD.zoneWidth;
  const st = coarse ? 2 : 1, inside = (p) => s.inside(p.x, p.y, 10);
  let out = 0;
  // mean height of a box in the frame (fwd a..b, lat c..d)
  const box = (a, b, c, d, fn, n = 5 * st) => {
    let sum = 0, cnt = 0; const nf = Math.max(2, Math.round(n / st)), nl = Math.max(2, Math.round(n * 1.6 / st));
    for (let i = 0; i < nf; i++) for (let j = 0; j < nl; j++) {
      const p = F.at(a + (b - a) * (i + 0.5) / nf, c + (d - c) * (j + 0.5) / nl);
      if (!inside(p)) { out++; continue; }
      sum += fn(p.x, p.y); cnt++;
    }
    return cnt ? sum / cnt : 0;
  };
  const H = (x, y) => s.h(x, y);
  // heights: each zone's front half (where the line will stand) and the middle ground
  const zH = [box(-half - 40, -half + zd / 2, -zw / 3, zw / 3, H), box(half - zd / 2, half + 40, -zw / 3, zw / 3, H)];
  const midH = box(-half + zd / 2 + 20, half - zd / 2 - 20, -zw / 3, zw / 3, H);
  const rise = [zH[0] - midH, zH[1] - midH];
  // woods on each zone's flanks (lat measured to SIDE 0's left; side 1's left is side 0's right)
  const W = (x, y) => (s.wood(x, y) > 0.35 ? 1 : 0);
  const flankBand = (fa, fb, sgn) => box(fa, fb, sgn > 0 ? zw / 2 - 60 : -zw / 2 - 120, sgn > 0 ? zw / 2 + 120 : -zw / 2 + 60, W, 4);
  const woods = {
    z0: [flankBand(-half - zd / 2, -half + zd / 2 + 120, 1), flankBand(-half - zd / 2, -half + zd / 2 + 120, -1)], // [left, right] of side 0
    z1: [flankBand(half - zd / 2 - 120, half + zd / 2, -1), flankBand(half - zd / 2 - 120, half + zd / 2, 1)],   // [left, right] of side 1
    in0: box(-half - zd / 2, -half + zd / 2, -zw / 2, zw / 2, W), in1: box(half - zd / 2, half + zd / 2, -zw / 2, zw / 2, W),
    mid: box(-half + zd / 2, half - zd / 2, -zw / 2, zw / 2, W),
  };
  // water across the middle: per lateral bin, the deepest water between the zones
  const bins = [], nb = coarse ? 10 : 18;
  for (let b = 0; b < nb; b++) {
    const lat = -zw / 2 + zw * (b + 0.5) / nb; let deep = 0, at = 0;
    for (let f = -half + zd / 2; f <= half - zd / 2; f += coarse ? 24 : 12) { const p = F.at(f, lat); if (!inside(p)) continue; const d = s.water(p.x, p.y); if (d > deep) { deep = d; at = f; } }
    bins.push({ lat, deep, at });
  }
  const wet = bins.filter((b) => b.deep > 0.05), deepBins = bins.filter((b) => b.deep > 1.1);
  const water = { bins, across: wet.length / nb, deepAcross: deepBins.length / nb, shallowAcross: (wet.length - deepBins.length) / nb, maxDepth: Math.max(0, ...bins.map((b) => b.deep)) };
  // water inside the zones and behind them (a river at your back)
  const Wd = (x, y) => (s.water(x, y) > 1.1 ? 1 : 0), Ws = (x, y) => (s.water(x, y) > 0.05 ? 1 : 0);
  // (sampled finely: a 20 m river slips between coarse samples)
  const inWater = [box(-half - zd / 2, -half + zd / 2, -zw / 2, zw / 2, Ws, 14), box(half - zd / 2, half + zd / 2, -zw / 2, zw / 2, Ws, 14)];
  const rear = [box(-half - zd / 2 - 260, -half - zd / 2, -zw / 2, zw / 2, Wd, 14), box(half + zd / 2, half + zd / 2 + 260, -zw / 2, zw / 2, Wd, 14)];
  // marsh
  const B = (x, y) => (s.bog(x, y) > 0.45 ? 1 : 0);
  const marsh = { z0: box(-half - zd / 2, -half + zd / 2, -zw / 2, zw / 2, B), z1: box(half - zd / 2, half + zd / 2, -zw / 2, zw / 2, B), mid: box(-half + zd / 2, half - zd / 2, -zw / 2, zw / 2, B) };
  // going for horse across the middle, slope in the charge lanes
  const charge = box(-half + zd / 2, half - zd / 2, -zw / 3, zw / 3, (x, y) => clamp01(1 - s.bog(x, y) * 1.5 - s.wood(x, y) * 1.2 - s.rock(x, y) * 0.8 - Math.max(0, s.slope(x, y) - 0.2) * 3 - (s.water(x, y) > 0.3 ? 0.6 : 0)));
  const steep = box(-half, half, -zw / 3, zw / 3, (x, y) => (s.slope(x, y) > 0.22 ? 1 : 0));
  const road = box(-half, half, -zw / 2, zw / 2, (x, y) => s.road(x, y), 4);
  const R = { site, axis, rise, zH, midH, woods, water, inWater, rear, marsh, charge, steep, road, offMap: out };
  if (!coarse) {
    R.profile = [];
    for (let f = -half - zd / 2 - 60; f <= half + zd / 2 + 60; f += 15) {
      let h = 0, n = 0, wd = 0, wood = 0;
      for (let l = -zw / 3; l <= zw / 3; l += zw / 12) { const p = F.at(f, l); if (!inside(p)) continue; h += s.h(p.x, p.y); n++; wd = Math.max(wd, s.water(p.x, p.y)); wood += s.wood(p.x, p.y) > 0.35 ? 1 : 0; }
      R.profile.push({ f, h: n ? h / n : 0, water: wd, wood: n ? wood / n : 0 });
    }
    R.crossings = crossingsOf(map, F, half, zd, zw);
  }
  return R;
}
// fords and bridges over deep water between the hosts: runs of wadeable cells along the deep line
function crossingsOf(map, F, half, zd, zw) {
  // (a crossing is a run of columns with no deep water between columns that have it: a ford, or a bridge whose
  // deck carries the ground dry across)
  const out = [], lat0 = -zw / 2 - 150, lat1 = zw / 2 + 150, cols = [];
  for (let lat = lat0; lat <= lat1; lat += 6) {
    let deepSeen = false, maxD = 0;
    for (let f = -half + zd / 2; f <= half - zd / 2; f += 5) { const p = F.at(f, lat); const d = map.water(p.x, p.y); if (d > 1.1) deepSeen = true; maxD = Math.max(maxD, d); }
    cols.push({ lat, deep: deepSeen, maxD });
  }
  let run = null;
  cols.forEach((c, i) => {
    if (!c.deep) { if (!run) run = { lat0: c.lat, lat1: c.lat, depth: c.maxD, i0: i }; else { run.lat1 = c.lat; run.depth = Math.max(run.depth, c.maxD); } }
    else if (run) { if (run.i0 > 0) out.push(run); run = null; }
  });
  return out.filter((r) => r.lat1 - r.lat0 < 200);
}

// The survey in words, as side `me` sees it. Each line: { icon, text, tone: good|bad|note }.
export function describeField(R, me = 0, names = ["you", "the enemy"]) {
  const L = [], them = 1 - me, you = names[0], They = cap(names[1]);
  const up = R.rise[me] - R.rise[them];
  if (R.rise[me] > 6 && up > 4) L.push({ icon: "rise", tone: "good", text: `Your ground stands ${Math.round(R.rise[me])} m above the field between the hosts — ${names[1]} must come uphill to you.` });
  else if (R.rise[them] > 6 && up < -4) L.push({ icon: "rise", tone: "bad", text: `${They} hold${names[1].endsWith("s") ? "" : "s"} the higher ground, ${Math.round(R.rise[them])} m above the middle — you would attack uphill.` });
  else if (Math.abs(up) > 3) L.push({ icon: "rise", tone: up > 0 ? "good" : "bad", text: up > 0 ? `A gentle rise in your favour (${Math.round(up)} m).` : `The ground rises gently toward ${names[1]} (${Math.round(-up)} m).` });
  else L.push({ icon: "flat", tone: "note", text: "Level ground: neither side has the height." });
  const wz = me === 0 ? R.woods.z0 : R.woods.z1, left = wz[0] > 0.3, right = wz[1] > 0.3;
  if (left && right) L.push({ icon: "wood", tone: "good", text: "Woods close both your flanks: a narrow front nobody can ride round." });
  else if (left || right) L.push({ icon: "wood", tone: "good", text: `A wood covers your ${left ? "left" : "right"} flank; the ${left ? "right" : "left"} lies open.` });
  else L.push({ icon: "open", tone: "note", text: "Both your flanks lie open — horse can ride round them." });
  if ((me === 0 ? R.woods.in1 : R.woods.in0) > 0.25) L.push({ icon: "wood", tone: "bad", text: `${They} stand${names[1].endsWith("s") ? "" : "s"} among trees: hard to see what is there.` });
  if (R.water.deepAcross > 0.6) {
    const c = R.crossings || [];
    L.push({ icon: "river", tone: "note", text: c.length ? `A river too deep to wade lies between the hosts. It can be crossed at ${c.length === 1 ? "one place" : c.length + " places"} — ${c.map((k) => k.depth < 0.2 ? "a bridge or causeway" : `a ford ${k.depth < 0.6 ? "knee" : "waist"}-deep`).join(", ")}.` : "A river too deep to wade lies between the hosts, and no crossing near." });
  } else if (R.water.across > 0.55) L.push({ icon: "stream", tone: "note", text: `A stream ${R.water.maxDepth < 0.5 ? "knee-deep" : "waist-deep"} crosses the whole front: a charge across it arrives in disorder.` });
  else if (R.water.across > 0.12) L.push({ icon: "stream", tone: "note", text: "Water on part of the front — a burn or a pool the lines must go round or through." });
  const mz = me === 0 ? R.marsh.z0 : R.marsh.z1, mo = me === 0 ? R.marsh.z1 : R.marsh.z0;
  if (R.marsh.mid > 0.08) L.push({ icon: "marsh", tone: "note", text: `Marsh in the ground between (${Math.round(R.marsh.mid * 100)}%): horse will founder, armoured men will tire.` });
  if (mz > 0.1) L.push({ icon: "marsh", tone: "bad", text: "Boggy ground inside your own lines." });
  if (mo > 0.1) L.push({ icon: "marsh", tone: "good", text: `${They} must form on soft, wet ground.` });
  const rr = me === 0 ? R.rear[0] : R.rear[1], ro = me === 0 ? R.rear[1] : R.rear[0];
  if (rr > 0.12) L.push({ icon: "river", tone: "bad", text: "Deep water at your back: if your host breaks, men will drown in it." });
  if (ro > 0.12) L.push({ icon: "river", tone: "good", text: `Deep water behind ${names[1]}: a rout there will be a slaughter.` });
  if (R.charge > 0.8 && R.water.across < 0.12 && R.marsh.mid < 0.05) L.push({ icon: "horse", tone: "note", text: "Firm, open going between the hosts — good ground for a charge." });
  else if (R.charge < 0.55) L.push({ icon: "horse", tone: "note", text: "Broken going between the hosts: charges will lose their order." });
  if (R.road > 0.04) L.push({ icon: "road", tone: "note", text: "A road runs across the field." });
  if (R.offMap > 0) L.push({ icon: "edge", tone: "bad", text: "Part of the field runs off the edge of the Vale." });
  return L;
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- the site search
// score(R) → number (higher is better); R is a coarse survey. Sites near the vills are shunned (their people
// are about their work there) and zones must lie inside the Vale.
export function findSite(map, score, { step = 150, axes = 8, avoid = [], near = null, nearR = 1e9, seed = 0, zoneWater = false } = {}) {
  const m = FIELD.sep / 2 + FIELD.zoneDepth / 2 + FIELD.edge, s = sampler(map);
  let best = null;
  for (let y = map.y0 + m; y <= map.y1 - m; y += step) for (let x = map.x0 + m; x <= map.x1 - m; x += step) {
    if (near && Math.hypot(x - near.x, y - near.y) > nearR) continue;
    if (avoid.some((a) => Math.hypot(a.x - x, a.y - y) < (a.r || 700))) continue;
    if (s.water(x, y) > 1.1 && !near) continue;
    for (let k = 0; k < axes; k++) {
      const axis = (k / axes) * Math.PI * 2 + (seed ? ((seed * 0.618) % 1) * 0.3 : 0);
      const [z0, z1] = zonesOf({ x, y }, axis);
      if (![z0, z1].every((z) => corners(z).every((c) => s.inside(c.x, c.y, FIELD.edge)))) continue;
      const R = surveyField(map, { x, y }, axis, { coarse: true });
      // (nobody draws up in a river: water inside either zone costs dear unless the battle wants it there)
      const v = score(R) - (zoneWater ? 0 : (R.inWater[0] + R.inWater[1]) * 8);
      if (!best || v > best.v) best = { v, site: { x, y }, axis };
    }
  }
  return best;
}
const corners = (z) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => zonePoint(z, a * z.d / 2, b * z.w / 2));

// the axis across a river at a point: the normal to the water's long direction (principal axis of the deep cells)
export function riverAxis(map, x, y, r = 90) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, n = 0;
  for (let dy = -r; dy <= r; dy += 4) for (let dx = -r; dx <= r; dx += 4) {
    if (map.water(x + dx, y + dy) < 0.6) continue;
    sx += dx; sy += dy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; n++;
  }
  if (n < 4) return 0;
  const mx = sx / n, my = sy / n, a = sxx / n - mx * mx, b = sxy / n - mx * my, c = syy / n - my * my;
  const along = 0.5 * Math.atan2(2 * b, a - c); // the river runs along this heading
  return along + Math.PI / 2;
}

// ---------------------------------------------------------------- troops and wages
// Daily wages, England in the 1340s (Prestwich, Ayton; Crécy–Calais pay rolls): a foot archer 3d, a mounted
// archer or hobelar 6d, a man-at-arms 12d, a knight 2s, a Welsh or shire spearman 2d, the levy what the shire
// could make them take. Genoese crossbowmen were hired by the company at a premium. A host's size is set by
// what its lord can pay for a day in the field.
export const TROOPS = {
  levy:      { wage: 1,  step: 20, max: 300, note: "Shire levy: spear, bill or club. A penny a day, and worth it only in numbers." },
  spearmen:  { wage: 2,  step: 20, max: 300, note: "Welsh and county spearmen, jacked and helmed. 2d a day." },
  pikemen:   { wage: 2,  step: 20, max: 300, note: "Twelve-foot spears in deep blocks — the Scots' schiltron. 2d." },
  militia:   { wage: 3,  step: 20, max: 300, note: "Flemish town militia: goedendag and pike, drilled by guild. 3d." },
  archers:   { wage: 3,  step: 20, max: 300, note: "English and Welsh longbowmen, sixty shafts a man. 3d a day." },
  crossbow:  { wage: 4,  step: 10, max: 150, note: "Genoese crossbowmen with pavises, hired by the company. 4d." },
  hobelars:  { wage: 6,  step: 10, max: 120, note: "Light horse on hobbies: scouts, raiders, pursuers. 6d." },
  menatarms: { wage: 12, step: 10, max: 200, note: "Men-at-arms in harness, fighting on foot. A shilling a day." },
  knights:   { wage: 24, step: 5,  max: 150, note: "Knights on barded destriers with the couched lance. 2s a day." },
};
export const HOST_MAX = 900; // men a side: more would not fit the field (or the laptop)
export const BUDGETS = [
  { key: "skirmish", name: "A skirmish", pence: 720, note: "£3 a day — a few hundred men" },
  { key: "battle", name: "A battle", pence: 1440, note: "£6 a day — a lord's retinue and his shire" },
  { key: "great", name: "A great battle", pence: 2400, note: "£10 a day — a king's host" },
];
export const costOf = (list) => list.reduce((s, [arm, n]) => s + (TROOPS[arm]?.wage || 2) * n, 0);
export const menOf = (list) => list.reduce((s, [, n]) => s + n, 0);
export const money = (d) => { const L = Math.floor(d / 240), s = Math.floor((d % 240) / 12), p = d % 12; return [L ? `£${L}` : "", s ? `${s}s` : "", p || (!L && !s) ? `${p}d` : ""].filter(Boolean).join(" "); };

// a host by the commander's temper: shares of the budget per arm
export const MIX = {
  defensive:  { spearmen: 0.28, archers: 0.3, menatarms: 0.27, knights: 0.1, levy: 0.05 },
  aggressive: { knights: 0.4, menatarms: 0.25, spearmen: 0.2, crossbow: 0.1, hobelars: 0.05 },
  flanker:    { hobelars: 0.2, knights: 0.25, spearmen: 0.25, archers: 0.2, menatarms: 0.1 },
  skirmish:   { archers: 0.35, crossbow: 0.2, hobelars: 0.2, spearmen: 0.25 },
  ambusher:   { spearmen: 0.25, archers: 0.25, hobelars: 0.2, menatarms: 0.2, levy: 0.1 },
  shock:      { knights: 0.5, hobelars: 0.15, spearmen: 0.2, crossbow: 0.15 },
  inspiring:  { spearmen: 0.14, menatarms: 0.27, levy: 0.05, archers: 0.2, knights: 0.24, hobelars: 0.1 },
};
export function composeHost(pence, temper = "inspiring", rng = Math.random) {
  const mix = MIX[temper] || MIX.inspiring, out = [];
  for (const [arm, f] of Object.entries(mix)) {
    const T = TROOPS[arm], j = 0.85 + rng() * 0.3;
    let n = Math.round(pence * f * j / T.wage / T.step) * T.step;
    n = Math.max(T.step, Math.min(T.max, n)); out.push([arm, n]);
  }
  // trim to the budget and the field's size, cheapest first
  const order = () => out.slice().sort((a, b) => TROOPS[b[0]].wage * b[1] - TROOPS[a[0]].wage * a[1]);
  let guard = 50;
  while ((costOf(out) > pence * 1.03 || menOf(out) > HOST_MAX) && guard--) { const e = order()[0]; e[1] = Math.max(TROOPS[e[0]].step, e[1] - TROOPS[e[0]].step); }
  return out.filter(([, n]) => n > 0);
}
// arm counts → companies: foot up to 90 men, bows 60, horse 30 (a company is what one captain can hold together)
export function companiesOf(list, extra = {}) {
  const out = [];
  for (const [arm, n, o] of list) {
    const A = ARMS[arm]; if (!A || n <= 0) continue;
    const cap = A.mounted ? 30 : A.missile ? 60 : 90, k = Math.ceil(n / cap);
    for (let i = 0; i < k; i++) out.push({ arm, count: Math.round(n / k) + (i < n % k && n % k ? 0 : 0), ...extra, ...(o || {}) });
    // (fix rounding so the companies add up)
    const got = out.slice(-k).reduce((s, c) => s + c.count, 0); out[out.length - 1].count += n - got;
  }
  return out;
}

// ---------------------------------------------------------------- drawing up a host
const FORM = { levy: "line", spearmen: "line", pikemen: "deep", militia: "deep", menatarms: "deep", archers: "loose", crossbow: "loose", hobelars: "line", knights: "wedge", scouts: "loose" };
export function defaultFormation(arm) { return FORM[arm] || "line"; }
function frontWidth(arm, count, formation, depth = 0) {
  const A = ARMS[arm], f = FORMATIONS[formation] || FORMATIONS.line, sp = A.spacing * (f.dense || 1);
  if (formation === "schiltron") return 2 * Math.sqrt(count * sp * sp * 1.15 / Math.PI) + sp * 2;
  if (formation === "wedge") { const rows = Math.ceil(Math.sqrt(count)); return (rows * 2 - 1) * sp; }
  return Math.min(count, formationFiles(formation, count, depth)) * sp;
}
// the role each company takes in the line, by arm and the commander's temper (a company can bring its own)
function roleOf(c, temper, i) {
  if (c.role) return c.role;
  const A = ARMS[c.arm];
  if (A.missile) return temper === "skirmish" ? "front" : "wing";
  if (A.mounted) {
    if (temper === "shock" && c.arm === "knights") return "front";
    if (temper === "ambusher" && c.arm === "hobelars") return "ambush";
    if (temper === "flanker") return "horse-one";
    return "horse";
  }
  if (c.arm === "levy") return "reserve";
  return "centre";
}
// Where a host's line stands in its zone, read from the ground: a defender takes the best-commanding row
// (height over the ground in front of him, firm going under his feet), an attacker the front of his zone.
export function lineSpot(map, z, width, temper) {
  const s = sampler(map), hd = z.d / 2, bold = temper === "aggressive" || temper === "shock" || temper === "flanker";
  let best = null;
  for (let front = -hd + 40; front <= hd - 25; front += 15) for (let lat = -120; lat <= 120; lat += 30) {
    if (Math.abs(lat) + width / 2 > z.w / 2 + 40) continue;
    let hLine = 0, hFront = 0, bad = 0, n = 0;
    for (let l = -width / 2; l <= width / 2; l += Math.max(10, width / 10)) {
      const p = zonePoint(z, front, lat + l), q = zonePoint(z, front + 140, lat + l);
      if (!s.inside(p.x, p.y, 20)) { bad += 3; continue; }
      hLine += s.h(p.x, p.y); hFront += s.h(q.x, q.y); n++;
      bad += (s.water(p.x, p.y) > 0.3 ? 3 : 0) + s.bog(p.x, p.y) * 1.5 + s.wood(p.x, p.y) * 1.2 + Math.max(0, s.slope(p.x, p.y) - 0.3) * 4;
    }
    if (!n) continue;
    const command = (hLine - hFront) / n; // m the line stands above the ground it must hold
    const v = (bold ? front * 0.05 : Math.max(-4, Math.min(20, command)) * 1.0 + front * 0.004) - bad / n * 10 - Math.abs(lat) * 0.004;
    if (!best || v > best.v) best = { v, front, lat };
  }
  return best || { front: bold ? hd - 30 : 0, lat: 0 };
}
// the nearest stand of wood beside a zone where horse (or foot) can lie hidden
export function ambushSpot(map, z) {
  const s = sampler(map); let best = null;
  for (const side of [1, -1]) for (let lat = z.w / 2 - 80; lat <= z.w / 2 + 260; lat += 30) for (let front = -z.d / 2; front <= z.d / 2 + 150; front += 30) {
    const p = zonePoint(z, front, side * lat); if (!s.inside(p.x, p.y, 40)) continue;
    const wd = s.wood(p.x, p.y); if (wd < 0.35 || s.water(p.x, p.y) > 0.1 || s.bog(p.x, p.y) > 0.4) continue;
    const v = wd - Math.abs(lat - z.w / 2) * 0.002 + front * 0.001;
    if (!best || v > best.v) best = { v, ...p };
  }
  return best;
}

// Draw up a host in its zone. companies: [{ arm, count, formation?, role?, stakes?, training? }]
// → the units (each with .role, .battleHost, a hold order where it stands).
export function placeHost(w, { team, zone, companies, temper = "inspiring", stakes = null, supply = true, tag = null }) {
  const map = w.map, face = zone.face, cs = companies.map((c, i) => ({ ...c, formation: c.formation || defaultFormation(c.arm), role: roleOf(c, temper, i) }));
  for (const c of cs) c.width = frontWidth(c.arm, c.count, c.formation, c.depth || 0);
  const gap = 6;
  const centre = cs.filter((c) => c.role === "centre");
  // heavy foot in the middle of the centre, lighter toward the ends
  centre.sort((a, b) => (ARMS[a.arm].armour - ARMS[b.arm].armour)).forEach((c, i, arr) => { c._k = i % 2 ? -(i + 1) / 2 : i / 2; });
  const ordered = centre.slice().sort((a, b) => a._k - b._k);
  const lineW = ordered.reduce((s, c) => s + c.width, 0) + gap * Math.max(0, ordered.length - 1);
  const spot = lineSpot(map, zone, Math.max(lineW, 120), temper);
  const P = (front, lat) => zonePoint(zone, spot.front + front, spot.lat + lat);
  const pos = new Map();
  let x = -lineW / 2;
  for (const c of ordered) { pos.set(c, P(0, -(x + c.width / 2))); x += c.width + gap; } // (lat + = left: lay out right→left)
  // wings: bows split to both ends of the line, a little forward
  const wing = cs.filter((c) => c.role === "wing" || c.role === "wing-left" || c.role === "wing-right");
  let left = lineW / 2 + gap * 2, right = lineW / 2 + gap * 2, k = 0;
  for (const c of wing) {
    const side = c.role === "wing-left" ? 1 : c.role === "wing-right" ? -1 : (k++ % 2 ? -1 : 1);
    if (side > 0) { pos.set(c, P(c.fwd ?? 15, left + c.width / 2)); left += c.width + gap; }
    else { pos.set(c, P(c.fwd ?? 15, -(right + c.width / 2))); right += c.width + gap; }
  }
  // the screen in front (skirmishing bows, a Cavalry Captain's knights)
  const front = cs.filter((c) => c.role === "front"); let fx = -front.reduce((s, c) => s + c.width + gap * 3, 0) / 2;
  for (const c of front) { pos.set(c, P(c.fwd ?? (ARMS[c.arm].missile ? 45 : 35), -(fx + c.width / 2))); fx += c.width + gap * 3; }
  // the reserve behind the centre
  const res = cs.filter((c) => c.role === "reserve"); let rx = -res.reduce((s, c) => s + c.width + gap * 2, 0) / 2;
  for (const c of res) { pos.set(c, P(c.fwd ?? -50, -(rx + c.width / 2))); rx += c.width + gap * 2; }
  // horse behind the wings (split), or all on one wing (a Flanker: the side with the better going)
  const horse = cs.filter((c) => c.role === "horse" || c.role === "horse-one" || c.role === "horse-left" || c.role === "horse-right");
  const s = sampler(map), goingSide = (sg) => { let g = 0; for (let f = 0; f <= 300; f += 50) { const p = P(f, sg * (lineW / 2 + 60)); g += 1 - s.bog(p.x, p.y) - s.wood(p.x, p.y) - (s.water(p.x, p.y) > 0.3 ? 1 : 0); } return g; };
  const oneSide = goingSide(1) >= goingSide(-1) ? 1 : -1;
  let hl = lineW / 2 + 20, hr = lineW / 2 + 20; k = 0;
  for (const c of horse) {
    const side = c.role === "horse-left" ? 1 : c.role === "horse-right" ? -1 : c.role === "horse-one" ? oneSide : (k++ % 2 ? -1 : 1);
    if (side > 0) { pos.set(c, P(c.fwd ?? -60, hl + c.width / 2 - 20)); hl += c.width + gap * 2; }
    else { pos.set(c, P(c.fwd ?? -60, -(hr + c.width / 2 - 20))); hr += c.width + gap * 2; }
  }
  // hidden: well behind the zone (the Bannockburn "small folk" behind Gillies Hill); ambush: in a wood beside it
  const amb = ambushSpot(map, zone);
  let hx = 0;
  for (const c of cs) if (c.role === "hidden") { pos.set(c, zonePoint(zone, -zone.d / 2 - 140, hx)); hx += c.width + 20; }
  let ax = 0;
  for (const c of cs) if (c.role === "ambush") { if (amb) { pos.set(c, { x: amb.x + Math.cos(face + Math.PI / 2) * ax, y: amb.y + Math.sin(face + Math.PI / 2) * ax }); ax += c.width + 10; } else { c.role = "horse"; pos.set(c, P(-70, (k++ % 2 ? -1 : 1) * (lineW / 2 + 40))); } }
  const units = [];
  for (const c of cs) {
    const p = pos.get(c) || P(0, 0);
    const u = addUnit(w, { team, arm: c.arm, count: c.count, x: p.x, y: p.y, facing: face - Math.PI / 2, formation: c.formation, depth: c.depth || 0, training: c.training ?? (c.arm === "levy" ? 0.25 : undefined), ammo: c.ammo });
    if (supply) u.supply = { food: 1e7, arrows: 1e5, carts: 0, packhorses: 0 };
    u.battleHost = true; u.role = c.role; u.finalFacing = face; u.order = { kind: "hold", x: u.ax, y: u.ay, facing: face };
    if (c.name) u.coName = c.name; if (tag) u.hostTag = tag;
    if (c.role === "ambush" || c.role === "hidden") u.lurking = true;
    units.push(u);
    const wantStakes = c.stakes ?? (stakes ?? (temper === "defensive" && c.arm === "archers"));
    if (wantStakes && ARMS[c.arm].missile) plantStakes(w, u);
  }
  return units;
}
// archers' stakes planted before the fighting (not the 60 s drill of fieldWork: they were in the ground at dawn)
export function plantStakes(w, u) {
  unplantStakes(w, u);
  const f = fieldWork(w, u, "archer_stakes", 3); if (!f) return null;
  const P = w.pendingFeatures; const k = P ? P.findIndex((p) => p.f === f) : -1; if (k >= 0) P.splice(k, 1);
  addFeature(w, f); u.stakes = f; return f;
}
export function unplantStakes(w, u) {
  if (!u.stakes) return;
  const k = (w.features || []).indexOf(u.stakes); if (k >= 0) { w.features.splice(k, 1); w.featuresVer = (w.featuresVer || 0) + 1; }
  u.stakes = null;
}

// ---------------------------------------------------------------- generated tweaks to the land
// Where the Vale lacks a feature a battle turned on, it is made — before the world is built, so the nav, the
// going, the drowning and the renderer all see it as ground like any other:
//   bridge: a narrow timber bridge on a causeway across the deep water at the site (Stirling)
//   brooks: a meandering watercourse across the whole field at a given fwd (Courtrai's Groeninge, the Bannock Burn)
export function applyTweaks(map, cfg) {
  const out = { bridge: null, brooks: [] }, F = frameOf(cfg.site, cfg.axis), res = map.res, cell = map.cell, H = map.height, WD = map.waterDepth;
  if (!WD) return out;
  const X0 = map.x0 || 0, Y0 = map.y0 || 0;
  const cellsNear = (x, y, r, fn) => { const i0 = Math.floor((x - r - X0) / cell), i1 = Math.ceil((x + r - X0) / cell), j0 = Math.floor((y - r - Y0) / cell), j1 = Math.ceil((y + r - Y0) / cell);
    for (let j = Math.max(0, j0); j <= Math.min(res - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(res - 1, i1); i++) fn(j * res + i, X0 + i * cell, Y0 + j * cell); };
  if (cfg.bridge) {
    // along the axis from dry bank to dry bank
    let a = 0, b = 0; while (a > -200 && map.water(F.at(a - 4, 0).x, F.at(a - 4, 0).y) > 0.02) a -= 4; while (b < 200 && map.water(F.at(b + 4, 0).x, F.at(b + 4, 0).y) > 0.02) b += 4;
    a -= 10; b += 10;
    const half = 4, p0 = F.at(a, 0), p1 = F.at(b, 0);
    const bank = Math.max(map.h(p0.x, p0.y), map.h(p1.x, p1.y));
    let surf = 0; for (let f = a; f <= b; f += 3) { const p = F.at(f, 0), d = map.water(p.x, p.y); if (d > 0.02) surf = Math.max(surf, map.h(p.x, p.y) + d); }
    const deck = Math.max(surf + 1.2, Math.min(bank, surf + 2.5));
    for (let f = a; f <= b; f += cell / 2) {
      const p = F.at(f, 0);
      cellsNear(p.x, p.y, half + cell, (k, x, y) => { const q = F.local(x, y); if (Math.abs(q.lat) > half || q.fwd < a || q.fwd > b) return;
        const t = Math.min(1, Math.min(q.fwd - a, b - q.fwd) / 10); // (ramps onto the banks)
        H[k] = Math.max(H[k], H[k] * (1 - t) + deck * t, WD[k] > 0.02 ? deck : -1e9); WD[k] = 0; });
    }
    out.bridge = { x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y, width: half * 2, deck, a, b };
  }
  for (const bk of cfg.brooks || []) {
    const line = [], lat0 = -(bk.span || 700), lat1 = bk.span || 700, ph = (cfg.site.x * 0.013 + cfg.site.y * 0.007) % 6.28;
    for (let lat = lat0; lat <= lat1; lat += 4) {
      const fwd = bk.fwd + Math.sin(lat * 0.011 + ph) * 18 + Math.sin(lat * 0.029 + ph * 2) * 7;
      const p = F.at(fwd, lat); if (!map.inBounds(p.x, p.y)) continue; line.push(p);
      cellsNear(p.x, p.y, bk.width / 2 + cell, (k, x, y) => { const d = Math.hypot(x - p.x, y - p.y); if (d > bk.width / 2 + cell * 0.7) return;
        const deep = d < bk.width / 2 ? bk.depth : bk.depth * 0.4; const bed = H[k] - Math.min(0.9, deep * 0.8);
        if (WD[k] < deep) { H[k] = Math.min(H[k], bed); WD[k] = Math.max(WD[k], deep); } });
    }
    out.brooks.push({ ...bk, line });
  }
  if (map.land) map.land.cache = null; // the going is re-read from the changed water
  return out;
}
// the bridge through the nav grid (its 25 m cells see the river either side of an 8 m deck): open the cells on it
export function openBridgeNav(nav, br) {
  if (!br || !nav) return;
  const L = Math.hypot(br.x1 - br.x0, br.y1 - br.y0), n = Math.ceil(L / (nav.cellM / 3));
  for (let s = 0; s <= n; s++) {
    const x = br.x0 + (br.x1 - br.x0) * s / n, y = br.y0 + (br.y1 - br.y0) * s / n, k = Math.round((y - nav.oy) / nav.cellM) * nav.n + Math.round((x - nav.ox) / nav.cellM);
    for (const cls of ["foot", "cavalry"]) { nav.classes[cls][k] = Math.min(Number.isFinite(nav.classes[cls][k]) ? nav.classes[cls][k] : 9, 2.5); if (nav.base?.[cls]) nav.base[cls][k] = nav.classes[cls][k]; }
  }
  (nav.decks ||= []).push({ id: "tweak-bridge", ax: br.x0, ay: br.y0, bx: br.x1, by: br.y1 }); // (a route over the river goes along the deck, not beside it: path.js threadDecks)
}
