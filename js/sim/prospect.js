// PROSPECTING — new silver and gold when the old is worked out (the owner: "What happens when your silver vein is gone?
// There should be a way to find more.")
//
// How medieval miners found metal: by the signs on the surface. Ore showing in an outcrop or a crag face, "shode" stones
// of galena in the stream gravels below a hill, the stunted grass and lead-tolerant plants over a lode, the spoil of old
// workings — the Mendip and Pennine lead-silver "rakes", Cornish tin streaming, the Kutná Hora rush of the 1290s. A
// prospector walked the hills, broke stones and dug trial pits; most days found nothing.
//
//   THE TASK        a villager crew is sent prospecting: the broad task "Prospect" (js/sim/broad.js: the likeliest ground
//                   within reach) or "Prospect here" (a click on hill or crag ground: js/ui/orders.js). The job is
//                   { kind: "prospect", x, y, r } (economy.js workUnit → prospectWork): the men walk out and search the
//                   ground for days — a trial pit here, stones broken there (the labour core's steps: PLANNERS.prospect).
//   THE ODDS        every PROSPECT.rollMD man-days of searching (a crew of 3 throws about once a day; men beyond
//                   PROSPECT.maxMen add nothing) is one throw, a deterministic hash of the place and the tick (not w.rng:
//                   prospecting never shifts anyone else's dice). The chance of a find on a throw is
//                     PROSPECT.p × geology × near-old-workings ÷ (1 + throws already made in that 200 m square / triedK)
//                   geology (0 … 1.5, from the land reader: rock showing, high exposed ground, crag and steep slope, less
//                   for wet ground and thick woods) — under PROSPECT.minGeo (flat, deep-soiled, low ground) there is no chance at all;
//                   near-old-workings ×1 … ×2.5 within PROSPECT.nearR of any known vein, worked out or not (metal lies
//                   in mineral fields, and the old men's spoil is a sign); ground already gone over pays less and less.
//   THE FIND        a seam at a crag's foot (or on the rockiest floor) within the searched ground, PROSPECT.spacing from
//                   every other vein: silver 5–30 thousand d (a hold's seam is 60 thousand), rarely gold
//                   (PROSPECT.goldP, twice that on high ground: 600–2500 s). A new node in w.resources (source:
//                   "prospect", finder: the team; plain data: saved with the world; nothing to migrate).
//   THE CAP         at most liveCap(w) found veins not yet worked out across the realm (max(4, houses)), at most
//                   everCap(w) ever (max(12, 3 × houses)), and a house may hold the finds of at most PROSPECT.perHouse
//                   live at once — beyond that the hills yield nothing more.
//   CLAIMING        nobody holds a find: the finder's own men — the prospectors standing there, villagers too — hoist its
//                   flag over VEIN.hoistS (js/sim/veins.js veinSystem: v.finder), as soldiers do; any other house's
//                   soldiers can hoist theirs first, or stake a camp, as at any unheld vein. Then the vein rules hold.
//   TELLING         w.log: "prospect-found" (the finder), "prospect-nothing" (every PROSPECT.reportDays of fruitless
//                   search), "prospect-ended" (searched out after PROSPECT.giveUpDays), "veins-out" (a house's last
//                   vein worked out: try prospecting).
//   THE REEVE       ai-general.js allocateLabour 5b asks reeveProspect: a house with no live vein of its own (or its
//                   veins near spent) and short of coin sends a crew to the likeliest ground.
// Deterministic (hashes of seed, team, place and tick; iteration in w.units / w.resources order). DOM-free.
import { isVein, holderOf, VEIN } from "./veins.js";
import { PLANNERS, STOOP_S, stop as stopMan } from "./labor.js";
import * as EC from "./economy.js";

export const PROSPECT = {
  r: 140,            // m of ground searched round the spot
  reach: 2500,       // m a crew walks out to prospect (the broad task's pick)
  rollMD: 3,         // man-days of searching per throw
  maxMen: 8,         // more men than this search no faster
  p: 0.10,           // the chance of a find on one throw, on the best ground
  minGeo: 0.15,      // geology below this: no sign of metal at all
  nearR: 1500, nearMul: 1.5, // within this of a known vein the odds rise, up to × (1 + nearMul)
  cell: 200, triedK: 10,     // m squares; the odds fall as 1 / (1 + throws / triedK) there
  goldP: 0.07,       // the share of finds that are gold (×2 on high ground)
  silver: [5000, 30000], gold: [600, 2500], // a find's size (d of silver; s of gold)
  spacing: 150,      // m from any other vein
  perHouse: 2,       // live finds a house may hold at once
  reportDays: 5,     // econ days of fruitless search between "nothing yet" lines
  giveUpDays: 20,    // econ days of search before the ground is called searched out
  every: 10,         // ticks between a crew's reckonings
};
const nHouses = (w) => (w.teams || []).filter((T) => T && T.store && !T.fallen).length || 1;
export const liveCap = (w) => Math.max(4, nHouses(w));
export const everCap = (w) => Math.max(12, 3 * nHouses(w));
// the realm's hills grow poorer as seams are found — never barren (the owner: no wall where prospecting stops for good):
// after everCap finds the odds are halved, after twice as many a third, and so on
export const richness = (w) => 1 / (1 + (w.prospect?.found || 0) / everCap(w));

// ---------------------------------------------------------------- hashes (deterministic, w.rng untouched)
function hash(...a) { let h = 0x811c9dc5 ^ a.length; for (const v of a) { h = Math.imul(h ^ ((v | 0) >>> 0), 0x01000193); h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15; } return (h >>> 0) / 4294967296; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cellOf = (x, y) => `${Math.floor(x / PROSPECT.cell)}:${Math.floor(y / PROSPECT.cell)}`;
const state = (w) => (w.prospect ||= { found: 0, tried: {} });

// ---------------------------------------------------------------- the ground
const slopeAt = (M, x, y) => Math.hypot(M.h(x + 3, y) - M.h(x - 3, y), M.h(x, y + 3) - M.h(x, y - 3)) / 6;
const inB = (M, x, y) => (M.inBounds ? M.inBounds(x, y) : (M.x0 === undefined || (x >= M.x0 && y >= M.y0 && x <= M.x1 && y <= M.y1)));
// the steepest rise within 15–45 m of (x, y), and which way it lies → [rise m, steep, angle]
function riseAt(M, x, y) {
  let rise = 0, steep = 0, fa = 0; const h0 = M.h(x, y);
  for (let q = 0; q < 16; q++) { const b = q / 16 * Math.PI * 2; for (const d of [15, 25, 35, 45]) { const dh = M.h(x + Math.cos(b) * d, y + Math.sin(b) * d) - h0; if (dh / d > steep) { steep = dh / d; rise = dh; fa = b; } } }
  return [rise, steep, fa];
}
// how the ground at (x, y) reads to a prospector, 0 … 1.5: rock showing, high exposed ground, crags and steep slopes; wet
// ground less, and thick woods hide the signs. Flat, deep-soiled low ground reads under PROSPECT.minGeo (no sign of metal).
export function geology(w, x, y, r = PROSPECT.r) {
  const M = w.map; if (!M?.h) return 0;
  const L = M.land;
  let rock = 0, high = 0, wet = 0, n = 0, steep = 0, water = 0, cover = 0;
  for (let q = 0; q < 13; q++) {
    const a = q * 2.399, d = q ? r * Math.sqrt(q / 12) : 0, px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
    if (!inB(M, px, py)) continue;
    n++;
    if (L?.idx) { const k = L.idx(px, py); rock += L.rock?.[k] || 0; high += L.high?.[k] || 0; wet += L.wet?.[k] || 0; cover += L.vegD?.[k] || 0; }
    steep = Math.max(steep, slopeAt(M, px, py));
    if (M.water && M.water(px, py) > 0.05) water++;
  }
  if (!n) return 0;
  const [, crag] = riseAt(M, x, y);
  const g = rock / n * 1.6 + high / n * 0.35 + Math.min(steep, 0.8) * 0.5 + Math.min(crag, 1) * 0.35 - wet / n * 0.4 - water / n * 0.8;
  return clamp(g * (1 - 0.55 * cover / n), 0, 1.5); // (under thick woods the rock lies hidden: fewer signs to read)
}
export const groundWord = (g) => (g >= 0.8 ? "promising ground: rock and crag" : g >= 0.45 ? "fair ground: some rock showing" : g >= PROSPECT.minGeo ? "poor ground: little rock showing" : "no sign of metal: flat, deep-soiled ground");
// the old men's workings and the known veins nearby raise the odds: × 1 … 1 + nearMul
export function nearMul(w, x, y) {
  let d = Infinity; for (const n of w.resources || []) if (isVein(n)) d = Math.min(d, Math.hypot(n.x - x, n.y - y));
  return 1 + PROSPECT.nearMul * clamp(1 - d / PROSPECT.nearR, 0, 1);
}
const triedAt = (w, x, y) => w.prospect?.tried?.[cellOf(x, y)] || 0;
// the chance of a find on one throw at (x, y) for a crew there now (before the caps)
export function oddsAt(w, x, y, geo = geology(w, x, y)) {
  if (geo < PROSPECT.minGeo) return 0;
  return PROSPECT.p * Math.min(1, geo) * (geo > 1 ? 1 + (geo - 1) * 0.5 : 1) * nearMul(w, x, y) / (1 + triedAt(w, x, y) / PROSPECT.triedK) * richness(w);
}
// why nothing more can be found (the realm's caps) → null | the reason
export function capWhy(w, team) {
  const finds = (w.resources || []).filter((n) => isVein(n) && n.source === "prospect"), live = finds.filter((n) => n.amount > 1);
  if (live.length >= liveCap(w)) return `${live.length} new veins already lie open in the realm: none more until one is worked out`;
  if (team !== null && team !== undefined && live.filter((n) => holderOf(n) === team || (holderOf(n) === null && n.finder === team)).length >= PROSPECT.perHouse) return `your house already has ${PROSPECT.perHouse} new veins open: work them out first`;
  return null;
}
// the likeliest ground for a crew of `team` at (x, y): a ring search out to `reach` (fixed order; ties to the first found)
// → { x, y, geo, odds, what } | null. Not by another house's hold, not on a known vein (they would find that one).
export function groundFor(w, team, x, y, reach = PROSPECT.reach) {
  const M = w.map; if (!M?.h) return null;
  const holds = w.holds || [], towns = (w.teams || []).filter((T) => T?.town && T.id !== team).map((T) => T.town);
  let best = null;
  for (let r = 200; r <= reach; r += 150) for (let k = 0, n = Math.max(12, Math.round(r / 60)); k < n; k++) {
    const a = k / n * Math.PI * 2 + r * 0.001, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (!inB(M, px, py) || (M.water && M.water(px, py) > 0.05)) continue;
    if (holds.some((h) => h.team !== team && Math.hypot(h.x - px, h.y - py) < 450) || towns.some((t) => Math.hypot(t.x - px, t.y - py) < 450)) continue;
    if ((w.resources || []).some((n) => isVein(n) && n.amount > 1 && Math.hypot(n.x - px, n.y - py) < PROSPECT.spacing)) continue;
    const geo = geology(w, px, py); if (geo < PROSPECT.minGeo) continue;
    const odds = oddsAt(w, px, py, geo), score = odds * (1 - 0.25 * r / reach);
    if (!best || score > best.score) best = { x: Math.round(px), y: Math.round(py), geo, odds, score };
  }
  if (best) best.what = groundWord(best.geo);
  return best;
}
// the job for a crew prospecting round (x, y) (plain data: saved with the crew)
export const jobAt = (w, x, y) => ({ kind: "prospect", x: Math.round(x), y: Math.round(y), r: PROSPECT.r, md: 0, wd: 0, throws: 0, saidWd: 0, geo: Math.round(geology(w, x, y) * 1000) / 1000, t0: w.time || 0 });

// ---------------------------------------------------------------- the men at it (the labour core's steps)
// each man works his way over the searched ground a few paces at a time — to the rockiest of three spots near where he
// stands (now and then a fresh part of the ground) — digs a trial pit there a good while, then stoops for what came up
PLANNERS.prospect = (w, u, id, k, M, { job }) => {
  const M0 = w.map, L = M0?.land, S = w.S; if (!job || !M0) return null;
  const ep = Math.floor((w.tick + id * 37) / 300), far = hash(id, ep, 7) < 0.2;
  const inR = Math.hypot(S.x[id] - job.x, S.y[id] - job.y) < job.r * 0.9;
  const cx = inR && !far ? S.x[id] : job.x, cy = inR && !far ? S.y[id] : job.y, rr = inR && !far ? 25 : job.r * 0.85;
  let bx = cx, by = cy, br = -1;
  for (let q = 0; q < 3; q++) {
    const a = hash(id, ep, q, 1) * Math.PI * 2, d = (inR && !far ? 6 : 0) + Math.sqrt(hash(id, ep, q, 2)) * rr;
    let x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    const o = Math.hypot(x - job.x, y - job.y); if (o > job.r * 0.9) { x = job.x + (x - job.x) * job.r * 0.9 / o; y = job.y + (y - job.y) * job.r * 0.9 / o; } // (kept to the ground being searched)
    if (!inB(M0, x, y) || (M0.water && M0.water(x, y) > 0.02)) continue;
    const rk = L?.idx ? L.rock?.[L.idx(x, y)] || 0 : 0;
    if (rk > br) { br = rk; bx = x; by = y; }
  }
  // the pick into the ground (a trial pit, the stones broken), then a stoop to pick up what came out and look at it
  return [{ op: "go", x: bx, y: by, near: 1.5 }, { op: "work", pose: "work_pick", secs: 30 + Math.floor(hash(id, ep, 6) * 50), x: bx, y: by }, { op: "work", pose: "work_stoop", secs: 2 * STOOP_S, x: bx, y: by }];
};

// ---------------------------------------------------------------- the search (economy.js workUnit, every tick)
export function prospectWork(w, u, T, md) {
  const J = u.job;
  if ((w.tick + u.id) % PROSPECT.every) return;
  if (J.found !== undefined) return awaitFlag(w, u, J);
  // the men on the ground (within the searched round), up to maxMen
  const S = w.S, R2 = (J.r + 30) ** 2; let men = 0;
  for (const id of u.members) { if (!S.alive[id]) continue; const dx = S.x[id] - J.x, dy = S.y[id] - J.y; if (dx * dx + dy * dy <= R2) men++; }
  if (!men) return;
  men = Math.min(men, PROSPECT.maxMen);
  const step = md * PROSPECT.every; // (man-days a man puts in over these ticks)
  J.md += men * step; J.wd += EC.DT * PROSPECT.every; // (wd: days on the ground, by the calendar)
  while (J.md >= (J.throws + 1) * PROSPECT.rollMD) {
    J.throws++;
    const v = throwAt(w, u.team, J);
    if (v) { // the find: the crew gathers at it (on the working floor before the face) to raise the flag
      J.found = v.id; J.foundT = w.time || 0; J.sx = J.x; J.sy = J.y; J.sr = J.r;
      const f = Number.isFinite(v.face) ? v.face : 0; J.x = Math.round(v.x + Math.cos(f) * 8); J.y = Math.round(v.y + Math.sin(f) * 8); J.r = 16;
      for (const id of u.members) stopMan(w, id);
      return;
    }
  }
  if (J.wd - J.saidWd >= PROSPECT.reportDays && J.wd < PROSPECT.giveUpDays) {
    J.saidWd = J.wd;
    w.log.push({ t: w.tick, kind: "prospect-nothing", team: u.team, unit: u.id, x: J.x, y: J.y, days: Math.round(J.wd), ground: groundWord(J.geo ?? geology(w, J.x, J.y)), cap: capWhy(w, u.team) });
  }
  if (J.wd >= PROSPECT.giveUpDays) { // searched out: the square is marked gone-over, the crew comes home (or, on the task, to the next ground)
    const P = state(w), c = cellOf(J.x, J.y); P.tried[c] = (P.tried[c] || 0) + 2 * PROSPECT.triedK;
    w.log.push({ t: w.tick, kind: "prospect-ended", team: u.team, unit: u.id, x: J.x, y: J.y, days: Math.round(J.wd) });
    if (u.broad?.kind === "prospect") u.broad.n = (u.broad.n || 0) + 1;
    EC.releaseWorkers(w, u); // (the task: the next likeliest ground — js/sim/broad.js retargetCrew)
  }
}
// a throw: → the vein found | null
function throwAt(w, team, J) {
  const P = state(w), c = cellOf(J.x, J.y), geo = J.geo ?? geology(w, J.x, J.y);
  const p = oddsAt(w, J.x, J.y, geo);
  P.tried[c] = (P.tried[c] || 0) + 1;
  if (!(p > 0) || hash(w.seed || 0, team, Math.floor(J.x), Math.floor(J.y), w.tick, 11) >= p) return null;
  if (capWhy(w, team)) return null;
  const s = siteFind(w, J.x, J.y, J.r); if (!s) return null;
  const hiGround = (() => { const L = w.map.land; return L?.idx ? L.high?.[L.idx(s.x, s.y)] || 0 : 0; })();
  const gold = hash(w.seed || 0, team, w.tick, 23) < PROSPECT.goldP * (hiGround > 0.5 ? 2 : 1);
  const [lo, hi] = gold ? PROSPECT.gold : PROSPECT.silver, q = hash(w.seed || 0, team, w.tick, 29);
  const amount = Math.round((lo + (hi - lo) * q * q) / 100) * 100; // (most finds are small)
  const nodes = w.resources || (w.resources = []), id = nodes.reduce((m, n) => Math.max(m, n.id || 0), 0) + 1;
  const name = SEAM_NAMES[Math.floor(hash(w.seed || 0, id, 31) * SEAM_NAMES.length)];
  const v = { id, kind: gold ? "gold_vein" : "silver_vein", res: gold ? "gold" : "silver", x: Math.round(s.x * 10) / 10, y: Math.round(s.y * 10) / 10, amount, start: amount, r: 8,
    source: "prospect", name, finder: team, foundT: Math.round(w.time || 0), holder: null, face: Math.round(s.face * 1000) / 1000, rise: Math.round(s.rise * 10) / 10 };
  nodes.push(v); P.found = (P.found || 0) + 1;
  w.log.push({ t: w.tick, kind: "prospect-found", team, vein: v.id, vk: v.kind, x: v.x, y: v.y, amount, name, days: Math.round(J.wd) });
  return v;
}
// where in the searched round the seam shows: the foot of a rise (flat, dry floor, a face behind it), the rockiest such
// spot; else the rockiest dry floor there. → { x, y, face, rise } | null
const SEAM_NAMES = ["Hob's Rake", "Greenhow Rake", "the Old Man's Vein", "Wheal Fortune", "Lady Rake", "Brandy Bottle Vein", "Wheal Prosper", "the Shode Vein", "Coldside Rake", "Moss Rake", "Wheal Hope", "the Black Vein", "Starve-Crow Rake", "Long Rake", "the Glebe Vein", "Wheal Charity"];
export function siteFind(w, x, y, r = PROSPECT.r) {
  const M = w.map, L = M.land;
  const clearOf = (px, py) => !w.buildings.some((b) => !b.ruin && (b.field ? Math.hypot(b.x - px, b.y - py) < Math.max(b.w || 0, b.h || 0) / 2 + 30 : b.x1 !== undefined ? Math.hypot((b.x1 + b.x2) / 2 - px, (b.y1 + b.y2) / 2 - py) < 50 : Math.hypot(b.x - px, b.y - py) < 50));
  let best = null, fall = null;
  for (let rr = 0; rr <= r; rr += 15) for (let k = 0, n = rr ? Math.max(8, Math.round(rr / 8)) : 1; k < n; k++) {
    const a = k / n * Math.PI * 2, px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (!inB(M, px, py) || (M.water && M.water(px, py) > 0.02) || slopeAt(M, px, py) > 0.12) continue; // (a flat working floor: the crag's foot, not its face)
    if ((w.resources || []).some((n) => isVein(n) && Math.hypot(n.x - px, n.y - py) < PROSPECT.spacing)) continue;
    if (!clearOf(px, py)) continue;
    const rock = L?.idx ? L.rock?.[L.idx(px, py)] || 0 : 0, [rise, steep, fa] = riseAt(M, px, py);
    const score = Math.min(rise, 20) + Math.min(steep, 1.2) * 8 + rock * 12;
    const s = { x: px, y: py, face: (fa + Math.PI) % (2 * Math.PI), rise, score };
    if (rise >= 2 && steep >= 0.08) { if (!best || score > best.score) best = s; }
    else if (!fall || score > fall.score) fall = s;
  }
  return best || fall;
}
// the find made: the prospectors stay to raise the finder's flag (js/sim/veins.js counts them), then go to work it — the
// broad task turns to mining it; a reeve's crew goes back to him (he stakes a camp when the chest wants it)
function awaitFlag(w, u, J) {
  const v = (w.resources || []).find((n) => n.id === J.found);
  const h = v ? holderOf(v) : null;
  if (v && h === null && (w.time || 0) - (J.foundT || 0) < VEIN.hoistS * 6 + 30) return; // (the flag going up)
  if (v && h === u.team && u.broad?.kind === "prospect") { u.broad.kind = v.res; u.broad.n = (u.broad.n || 0) + 1; EC.releaseWorkers(w, u); return; } // (→ "Mine silver": retargetCrew finds this vein, theirs and nearest)
  delete J.found; delete J.foundT;
  if (!v || h !== u.team) { if (J.sx !== undefined) { J.x = J.sx; J.y = J.sy; J.r = J.sr; } return; } // (another house took it first, or the flag never went up: they search on)
  EC.releaseWorkers(w, u);
}

// ---------------------------------------------------------------- per tick (economy.js economySystem): a house's last vein
// worked out is told once (and again only after it holds a live one again)
export function prospectSystem(w) {
  if (w.tick % 50 !== 7 || !w.resources) return;
  for (const T of w.teams || []) {
    if (!T?.store || T.fallen || !T.town) continue;
    let held = 0, live = 0, last = null;
    for (const n of w.resources) if (isVein(n) && holderOf(n) === T.id) { held++; if (n.amount > 1) live++; else if (!last || (n.id > last.id)) last = n; }
    if (live || !held) { if (live) T.veinsOutTold = false; continue; }
    if (T.veinsOutTold) continue;
    T.veinsOutTold = true;
    w.log.push({ t: w.tick, kind: "veins-out", team: T.id, vein: last?.id, vk: last?.kind, x: last?.x, y: last?.y });
  }
}

// ---------------------------------------------------------------- the reeve (ai-general.js allocateLabour 5b)
// a house with no live vein of its own within reach — or its veins near spent — nor one nobody holds, and short of coin, sends men
// prospecting the likeliest ground. → the job | null. The ground is kept (w.prospect.aim[team]) until searched out.
export function reeveProspect(w, team, hall, { short, reach = 3500 } = {}) {
  if (!hall || !short) return null;
  let live = 0; for (const n of w.resources || []) { const h = holderOf(n); if (isVein(n) && (h === team || h === null) && n.amount > 1 && Math.hypot(n.x - hall.x, n.y - hall.y) < reach) live += n.amount; }
  if (live > 4000) return null; // (a vein of its own with a few months in it yet, or one nobody holds to stake a camp at: that first)
  if (capWhy(w, team)) return null;
  const P = state(w), A = (P.aim ||= {});
  let g = A[team];
  if (g && (triedAt(w, g.x, g.y) >= 2 * PROSPECT.triedK || (w.resources || []).some((n) => isVein(n) && n.amount > 1 && Math.hypot(n.x - g.x, n.y - g.y) < PROSPECT.spacing))) g = null; // (searched out, or found)
  if (!g) { const f = groundFor(w, team, hall.x, hall.y); if (!f) return null; g = A[team] = { x: f.x, y: f.y }; }
  return jobAt(w, g.x, g.y);
}
