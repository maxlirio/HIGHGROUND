// Gathering lane A — FIELDS (docs/gathering-plan.md). The open field's year, done by people you can watch:
//
//   stubble / fallow ──(the plough window opens)──▶ PLOUGH (ox teams turn the strips) ──▶ SOW (broadcast from a seed
//   sheet, seed corn drawn from the store) ──▶ growing (bare earth → shoots → tall green → golden: the renderer reads
//   growth()) ──▶ ripe ──▶ REAP (sickles at the front, binders behind, stooks set up in lines down each strip) ──▶
//   the stooks are CARRIED / CARTED to the granary (sheaves count in the store only when set down there) ──▶ stubble
//   ──▶ next season: three-field rotation (wheat → a spring crop → a year's fallow → wheat).
//   Threshing: villagers at home flail the stored sheaves on the barn's threshing floor (seed corn kept back first).
//
// Geometry: a field is an axis-aligned rect (b.x ± b.w/2, b.y ± b.h/2). Its ground is worked in STRIPS (the medieval
// "lands"), ~40 m wide, running along y; each operation (plough, sow, reap) has one progress number per strip (f.pr).
// A land is PLOUGHED (and sown) the medieval way, round its crown: the turned band grows out from the land's middle
// line to its furrows while the team walks the land's length up one side and down the other. REAPING goes across the
// whole field in one line from its south headland (every land at once, reapers spread along the line), the stooks
// set up behind. The renderer draws exactly this (js/render/jobs/fields.js): where the men are is where the ground changes.
//
// Deterministic (no randomness needed: hashes of ids), DOM-free, plain data on b.field and w.labor.items (stooks).
import * as LB from "../labor.js";
import { E, CROPS } from "../econ-data.js";
import { TICK, BATTLE_RATE } from "../clock.js";
import * as EC from "../economy.js";   // (runtime only: releaseWorkers, give, take, DT — an import cycle)
import * as TC from "../tech.js";      // (research: the heavy plough, the horse collar, marling — docs/tech.md)
import { TREES, treeKg, FALL_S } from "./forestry.js";   // (the woodmen's own felling: hooks forest.fell / forest.landed / forest.limb)
import { BODY_R } from "../obstacles.js";
import { buildEffects } from "../land.js";

const BT = TICK * BATTLE_RATE;
export const STRIP = 40;                                  // m, the width of one land/strip
export const STOOK_SPACING = 6.5;                         // m between stooks down a row (render/jobs/fields.js lays them)
export const STOOK_ROWS = [-0.32, -0.11, 0.11, 0.32];     // four rows of stooks down each land, × STRIP from its middle
const SPRING = ["barley", "oats", "peas"];
// the calendar (day of the year): spring ploughing opens mid-February; winter wheat is ploughed from early September
// (and sown by November); a crop needs at least ~60 days in the ground
const SPRING_PLOUGH = 45, WHEAT_PLOUGH = 250, WHEAT_LAST = 330, MIN_GROW = 60;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const hsh = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };

// ---------------------------------------------------------------- strips
// The field's own frame: strips span local x, run along local y; b.rot turns it into the world (a plot laid on the
// map's painted furlongs keeps the furlong's survey axis). All strip geometry below is in LOCAL metres from b's centre.
export const fieldLocal = (b, x, y) => { const r = b.rot || 0, c = Math.cos(r), s = Math.sin(r), dx = x - b.x, dy = y - b.y; return [dx * c + dy * s, dy * c - dx * s]; };
export const fieldWorld = (b, lx, ly) => { const r = b.rot || 0, c = Math.cos(r), s = Math.sin(r); return [b.x + lx * c - ly * s, b.y + lx * s + ly * c]; };
export const stripsOf = (b) => Math.max(1, Math.round((b.w || STRIP) / STRIP));
// strip i: its local-x span and which way it is worked
export function stripOf(b, i) { const S = stripsOf(b), sw = b.w / S, x0 = -b.w / 2 + i * sw; return { x0, sw, xc: x0 + sw / 2, dir: 1 }; }
// the front of strip i at progress p: its local y (m)
export function frontY(b, i, p) { return -b.h / 2 + p * b.h; }                 // (the reaping line)
// the edge of the turned band on land i at progress p, on side s (−1 west, +1 east)
export function bandX(b, i, p, s) { const st = stripOf(b, i); return st.xc + s * Math.max(0.6, p * st.sw / 2); }
const meanPr = (f) => (f.pr?.length ? f.pr.reduce((s, v) => s + v, 0) / f.pr.length : 0);
export const opDone = meanPr;
// the strips being worked now: the first `W` unfinished ones (in order)
function fronts(f, W) { const out = []; for (let i = 0; i < f.pr.length && out.length < W; i++) if (f.pr[i] < 1) out.push(i); return out; }
// spread `dHa` of work over the first W unfinished strips (overflow runs on to the next); → [[i, p0, p1]]
function advance(b, f, dHa, W) {
  const S = f.pr.length, stripHa = f.ha / S, out = [];
  let left = dHa, guard = 0;
  while (left > 1e-12 && guard++ < 4 * S) {
    const fr = fronts(f, Math.max(1, W)); if (!fr.length) break;
    const share = left / fr.length; left = 0;
    for (const i of fr) {
      const p0 = f.pr[i], p1 = Math.min(1, p0 + share / stripHa);
      left += share - (p1 - p0) * stripHa; f.pr[i] = p1; out.push([i, p0, p1]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- the calendar and the rotation
const Cof = (crop) => CROPS[crop] || null;
const lastStart = (crop) => (Cof(crop)?.ripe || 200) - MIN_GROW;
// when ploughing for `crop` may start, at or after absolute day D
function windowFor(crop, D) {
  const Y = Math.floor(D / 365), d = D - Y * 365;
  if (crop === "wheat") {
    if (d >= WHEAT_PLOUGH && d <= WHEAT_LAST) return D;             // winter wheat, this autumn
    if (d >= SPRING_PLOUGH && d <= lastStart("wheat")) return D;    // (spring wheat on a new field laid in the season)
    return d < WHEAT_PLOUGH && d > lastStart("wheat") ? Y * 365 + WHEAT_PLOUGH : d < SPRING_PLOUGH ? Y * 365 + SPRING_PLOUGH : (Y + 1) * 365 + SPRING_PLOUGH;
  }
  if (d < SPRING_PLOUGH) return Y * 365 + SPRING_PLOUGH;
  if (d <= lastStart(crop)) return D;
  return (Y + 1) * 365 + SPRING_PLOUGH;
}
// the ripening day (absolute) of `crop` ploughed for on day D
function ripeFor(crop, D) {
  const Y = Math.floor(D / 365), d = D - Y * 365, C = Cof(crop);
  return (crop === "wheat" && d >= WHEAT_PLOUGH - 20 ? (Y + 1) * 365 : Y * 365) + (C?.ripe || 220);
}
// A field laid out on day D (absolute): the crop that gives its first harvest soonest, and that harvest's day. Crops
// whose ploughing window is open NOW are preferred among those ripening within three weeks of the soonest (autumn: winter
// wheat goes in now rather than waiting for the spring's peas); `k` rotates between the equals (a reeve laying several).
// → { crop, ripe } (ripe: absolute day). Used by the reeve (ai-general.js) and a new foundation's provisions (world.mjs).
export function firstHarvest(D, k = 0) {
  const c = Object.keys(CROPS).map((crop) => { const at = windowFor(crop, D); return { crop, at, ripe: ripeFor(crop, at) }; });
  const soon = Math.min(...c.map((q) => q.ripe));
  let pick = c.filter((q) => q.ripe <= soon + 21);
  if (pick.some((q) => q.at <= D)) pick = pick.filter((q) => q.at <= D);
  pick.sort((a, b) => a.ripe - b.ripe || (a.crop < b.crop ? -1 : 1));
  const q = pick[((k % pick.length) + pick.length) % pick.length];
  return { crop: q.crop, ripe: Math.max(q.ripe, q.at + MIN_GROW), soonest: soon };
}
// The field's NEXT harvest as things stand on day D: the crop in the ground, or the one its rotation puts in at its next
// ploughing (a year's fallow after a spring crop — the three-field rotation). → { ripe (absolute day), kg net of seed } | null
export function prospect(b, D) {
  const f = b?.field; if (!f || b.ruin) return null;
  if ((f.state === "growing" || f.state === "ripe") && f.left > 0) return { ripe: f.ripe, kg: f.left * (1 - (f.seedFrac || 0)) };
  const crop = f.next, C = Cof(crop); if (!C) return null;
  const at = Math.max(D, f.plAt ?? windowFor(crop, D)), ripe = Math.max(ripeFor(crop, at), at + MIN_GROW);
  return { ripe, kg: f.ha * C.yieldKgHa * (f.soil ?? 1) * (1 - 0.6 * lateness(crop, at)) * (1 - C.seedKgHa / C.yieldKgHa) };
}
// A vill in want sows its fallow (the reeve: ai-general.js reeveFields, when the plan has no ground left to break): a field
// lying fallow or in stubble is ploughed again NOW, without its year's rest, for the crop whose window is open (winter
// wheat in the autumn, a spring crop in the spring) — at OVERCROP of the yield, the ground being tired. → the crop, or
// null (nothing can go in now, the field is not idle, or its own ploughing is due within three weeks anyway)
export const OVERCROP = 0.8;
export function sowFallow(w, b, D) {
  // (a field the cycle has not looked at yet — laid out but not yet ticked, an older save — is set up FIRST: else the next
  // tick's initCycle rotates the stubble and throws away the ploughing decided here, and the caller believes a crop went in)
  if (b?.field && !b.field.cy && !b.ruin) initCycle(w, b);
  const f = b?.field; if (!f || b.ruin || !(f.state === "fallow" || f.state === "stubble") || !(f.plAt > D + 20) || stooksOf(w, b).length) return null;
  const open = Object.keys(CROPS).filter((crop) => windowFor(crop, D) <= D).sort((a, z) => ripeFor(a, D) - ripeFor(z, D) || (a < z ? -1 : 1));
  if (!open.length) return null;
  f.next = open[0]; f.plAt = D; f.tired = 1;
  return open[0];
}
// a crop put in late gives less (the same curve the town plan uses for a field laid out mid-season)
function lateness(crop, D) { const d = D - Math.floor(D / 365) * 365; return crop === "wheat" && d >= WHEAT_PLOUGH - 20 ? clamp((d - 290) / 80, 0, 1) : clamp((d - 100) / 80, 0, 1); }
const springCrop = (b, D) => SPRING[Math.floor(hsh(b.id, Math.floor(D / 365)) * 3) % 3];

// begin an operation on the whole field
function startOp(f, b, op) { f.op = op; f.pr = new Array(stripsOf(b)).fill(0); }
// the plough goes in: the field is committed to `crop` (the crop it will carry is fixed now; seed goes in at sowing)
function commit(w, b, crop, D, fresh) {
  const f = b.field, C = Cof(crop); if (!C) return;
  f.crop = crop; f.state = "growing"; f.ripe = Math.max(ripeFor(crop, D), D + MIN_GROW); f.opAt = D; f.care = 0.5; f.reaped = 0;
  f.seedFrac = C.seedKgHa / C.yieldKgHa;
  // (the soil's multiplier rides in f.yieldKgHa — town plan; a crop change keeps it)
  const soil = f.soil ?? (f.yieldKgHa && Cof(f.crop0) ? f.yieldKgHa / Cof(f.crop0).yieldKgHa : 1);
  f.soil = soil; f.yieldKgHa = C.yieldKgHa * soil;
  f.left = f.ha * f.yieldKgHa * (1 - 0.6 * lateness(crop, D)) * TC.mul(w, b.team, "yield"); // (research: marling & folding)
  if (f.tired) { f.left *= OVERCROP; delete f.tired; }          // (sown without its year's fallow: sowFallow)
  f.seedDue = !fresh;                                           // (a new field's first seed came with the settlers)
  delete f.next; delete f.plAt; delete f.stubAt; delete f.sown;
  startOp(f, b, "plough");
}
// after the harvest: what comes next and when its ploughing opens
function rotate(w, b, D) {
  const f = b.field, Y = Math.floor(D / 365);
  f.state = "stubble"; f.stubAt = D; f.op = null; f.pr = new Array(stripsOf(b)).fill(1);
  if (f.crop === "wheat") { f.next = springCrop(b, D + 200); f.plAt = windowFor(f.next, (Y + 1) * 365 + 1); }
  else { f.next = "wheat"; f.plAt = (Y + 1) * 365 + WHEAT_PLOUGH; }                   // a year's fallow, then wheat
}

// First look at a field (a fresh one from initField, one from the prebuilt layout, or one from an older save).
export function initCycle(w, b) {
  const f = b.field, D = w.econ.doy; if (!f || f.cy) return;
  f.cy = 1; f.crop0 = f.crop;
  f.soil = f.yieldKgHa && Cof(f.crop) ? f.yieldKgHa / Cof(f.crop).yieldKgHa : 1;
  if (f.fresh) {                                                 // just laid out: plough and sow it first
    delete f.fresh;
    if (f.crop === "fallow" || !Cof(f.crop)) { f.state = "fallow"; f.op = null; f.pr = new Array(stripsOf(b)).fill(1); f.next = "wheat"; f.plAt = windowFor("wheat", D); f.left = 0; return; }
    const at = windowFor(f.crop, D);
    if (at <= D) { const left = f.left; commit(w, b, f.crop, D, true); if (Math.floor(D / 365) === 0) f.left = left * TC.mul(w, b.team, "yield"); return; }  // (year one: the town plan's crop, to the kg — and marled ground, if learned)
    f.state = "fallow"; f.op = null; f.pr = new Array(stripsOf(b)).fill(1); f.next = f.crop; f.plAt = at; f.left = 0; return;   // too late this season
  }
  // already in the ground (the prebuilt open fields; an older save)
  if (f.state === "growing") { f.op = null; f.pr = new Array(stripsOf(b)).fill(1); f.sown ??= f.ripe - 110; }
  else if (f.state === "ripe") { const full = f.ha * f.yieldKgHa, c = clamp(1 - f.left / Math.max(1, full), 0, 1); startOp(f, b, "reap"); spreadDone(f, c); f.reaped = 0; }
  else if (f.state === "stubble") rotate(w, b, D);
  else if (f.state === "fallow") { f.op = null; f.pr = new Array(stripsOf(b)).fill(1); f.next ??= "wheat"; f.plAt ??= windowFor(f.next, D); }
  else { f.op = null; f.pr = new Array(stripsOf(b)).fill(1); }
}
function spreadDone(f, c) { const S = f.pr.length; for (let i = 0; i < S; i++) f.pr[i] = clamp(c * S - i, 0, 1); }

// ---------------------------------------------------------------- stooks (w.labor items, one line per half strip)
export const stookKey = (b, i, half) => `stk:${b.id}:${i}:${half}`;
const isStookOf = (it, b) => it.kind === "stook" && it.key && it.key.startsWith(`stk:${b.id}:`);
export function stookKg(w, b) { let kg = 0; for (const it of w.labor?.items || []) if (isStookOf(it, b)) kg += it.kg; return kg; }
function stooksOf(w, b) { return (w.labor?.items || []).filter((it) => isStookOf(it, b) && it.kg > 0); }
// kg reaped from strip i between progress p0 and p1: bound and set up in stooks behind the reapers
function setStooks(w, b, i, p0, p1, kg) {
  if (kg <= 0 || p1 <= p0) return;
  const st = stripOf(b, i);
  for (const half of [0, 1]) {
    const a = Math.max(p0, half * 0.5), z = Math.min(p1, half * 0.5 + 0.5); if (z <= a) continue;
    const share = kg * (z - a) / (p1 - p0);
    const [sx, sy] = fieldWorld(b, st.xc, frontY(b, i, half * 0.5) + 4);
    // one item per half land: its pieces are ranks of four stooks across the land (STOOK_ROWS), STOOK_SPACING apart down it
    const it = LB.sitePile(w, stookKey(b, i, half), "stook", sx, sy, b.team, Math.PI / 2 + (b.rot || 0));
    it.st = stookKey(b, i, half); LB.addKg(w, it, share);   // (st travels to realm clients, the key does not: the renderer reads st)
  }
}

// ---------------------------------------------------------------- the ground is cleared for the plough
// Nobody ploughs round an oak: the map's trees and bushes standing inside a field (more than CLEAR_IN m in from its
// edge — a hedge or a lone tree on the headland stays) are grubbed up when the field is laid. Their trunks leave the
// obstacle grid, and they are entered in lane B's felling ledger (w.labor.forest.felled) with no stump, so the woodmen
// never fell them again, the map's cover over them is thinned (forestry.syncCanopy), and nothing regrows on ploughed
// ground. The renderer hides them by the same rule (render/jobs/fields.js). Done once per field (f.clr, saved).
export const CLEAR_IN = 3;
export const insideField = (b, x, y) => { const [lx, ly] = fieldLocal(b, x, y); return Math.abs(lx) < b.w / 2 - CLEAR_IN && Math.abs(ly) < b.h / 2 - CLEAR_IN; };
function clearGround(w, b) {
  const f = b.field; f.clr = 1;
  const O = w.obstacles, veg = O?.veg; if (!veg) return;
  const Fo = (LB.laborOf(w).forest ||= { felled: {}, claim: {}, next: 0 }), day = w.econ?.doy ?? 0;
  let n = 0;
  for (let vi = 0; vi < veg.length; vi++) {
    const v = veg[vi]; if (!insideField(b, v.x, v.y) || Fo.felled[vi] !== undefined) continue;
    const bk = O.circles.get(((v.x / 8) | 0) * 100000 + ((v.y / 8) | 0));
    if (bk) for (let k = 0; k < bk.length; k += 3) if (bk[k] === v.x && bk[k + 1] === v.y) { bk.splice(k, 3); O.count--; break; }
    Fo.felled[vi] = day; n++;
  }
  if (n) Fo.cv = (Fo.cv || 0) + 1;
}

// ---------------------------------------------------------------- per tick (economy.js fieldTick)
export function tick(w, b) {
  const f = b.field;
  if (f.state === "clearing") { b.stage = "build1"; if (clearingDone(w, b)) finishMaking(w, b); return; }   // (the men are making it: below)
  if (!f.cy) initCycle(w, b);
  if (!f.clr) clearGround(w, b);
  const doy = w.econ.doy;
  if (b.fire > 0) { // the stooks burn with the field (economy.js burns the standing crop)
    for (const it of stooksOf(w, b)) LB.takeKg(w, it, it.kg * Math.min(1, 0.0006 * BT * b.fire));
  }
  if (f.state === "growing") {
    if (doy >= f.ripe) {
      if (f.op) { // the crop never (fully) went in: only what was sown ripens
        const sown = f.op === "sow" ? meanPr(f) : 0; f.left *= sown; f.op = null; f.pr = new Array(stripsOf(b)).fill(1); f.sown ??= doy - MIN_GROW;
      }
      if (f.left > 1) { f.state = "ripe"; startOp(f, b, "reap"); f.reaped = 0; }
      else { f.left = 0; rotate(w, b, doy); }
    }
  } else if (f.state === "ripe") {
    if (doy > f.ripe + 21) f.left *= 1 - 0.015 * EC.DT; // over-ripe grain sheds (EST 1.5 %/day)
    if (f.left <= 1 || (f.op === "reap" && meanPr(f) >= 1)) { f.left = 0; rotate(w, b, doy); }
  } else if (f.state === "stubble" || f.state === "fallow") {
    if (f.state === "stubble" && doy >= (f.stubAt ?? doy) + 75) f.state = "fallow";      // the stubble greens over, grazed
    if (f.plAt !== undefined && doy >= f.plAt && f.next && Cof(f.next) && !stooksOf(w, b).length) commit(w, b, f.next, doy, false);
  } else if (f.state === "burnt") {
    if (!f.plAt) { f.next = f.crop === "wheat" ? springCrop(b, doy + 200) : "wheat"; f.plAt = windowFor(f.next, doy + 30); f.op = null; }
    else if (doy >= f.plAt) { b.fire = 0; commit(w, b, f.next, doy, false); }             // ploughed back in next season
  }
  b.stage = f.state === "burnt" ? "ruin" : b.fire > 0 ? "burning" : f.state === "growing" ? (doy < f.ripe - 40 ? "build1" : "build2") : f.state === "ripe" ? "complete" : f.state;
}

// ---------------------------------------------------------------- the crew's work (economy.js fieldWork)
// plough teams the store can yoke: oxen, and horses too once the town has the horse collar (research)
const ploughTeams = (w, T, b) => Math.floor(((T.store.oxen || 0) + (TC.add(w, b.team, "horsePlough") ? T.store.horses || 0 : 0)) / PLOUGH_TEAM);
const PLOUGH_TEAM = 2;   // oxen to a plough (a pair yoked; research §3: a team of 6–8 on heavy land — ours is light)
function inField(b, x, y, m) { const [lx, ly] = fieldLocal(b, x, y); return Math.abs(lx) < b.w / 2 + m && Math.abs(ly) < b.h / 2 + m; }
// crew members actually at the field's work (on a field task, out at the field or carrying from it)
function atWork(w, u, b) {
  const S = w.S; let n = 0;
  for (const id of u.members) { if (!S.alive[id]) continue; const M = w.labor?.men.get(id); if (!M?.task || M.task.name !== "field") continue; if (M.carry?.res === "sheaves" || inField(b, S.x[id], S.y[id], 30)) n++; }
  return n;
}
export function phase(w, b) {
  const f = b.field; if (!f) return null;
  if (f.state === "clearing") return "clear";
  if (f.state === "growing" && f.op) return f.op;
  if (f.state === "ripe") return "reap";
  if ((f.state === "stubble" || f.state === "fallow" || f.state === "burnt") && stooksOf(w, b).length) return "cart";
  if (f.state === "growing" && w.econ.doy >= f.ripe - 80) return "weed";
  return null;
}
export function work(w, u, T, working, md) {
  const b = u.job.b, f = b.field; if (!f) return;
  if (f.state === "clearing") return clearWork(w, u, b, working, md);
  if (!f.cy) initCycle(w, b);
  // called to the field: whatever else a man was about (another crew's errand) he leaves — unless he has a load in his arms
  const ph = phase(w, b);
  for (const id of u.members) { const M = w.labor?.men.get(id); if (M?.task && (!M.carry || yoke(M)) && (M.task.name !== "field" || !fits(M.task.steps[0]?.ph, ph))) { unyoke(M); LB.stop(w, id); } }
  const n = working + atWork(w, u, b), doy = w.econ.doy;
  const speed = E.fieldPrepSpeed || 1;
  if (ph === "plough") {
    const teams = Math.min(n, ploughTeams(w, T, b));
    const dHa = (teams * md / (E.ploughManDaysPerHa * TC.mul(w, b.team, "plough")) + (n - teams) * md / (E.ploughManDaysPerHa * E.digMul)) * speed;
    advance(b, f, dHa, u.members.length);
    if (meanPr(f) >= 1) { startOp(f, b, "sow"); f.opAt = doy; delete f.virgin; }   // (turned ground is farmland now)
  } else if (ph === "sow") {
    const dHa = n * md / E.sowManDaysPerHa * speed;
    const done = advance(b, f, dHa, Math.ceil(u.members.length / 2));
    if (f.seedDue) { const ha = done.reduce((s, [, p0, p1]) => s + (p1 - p0) * f.ha / f.pr.length, 0), want = ha * (Cof(f.crop)?.seedKgHa || 0); const g = EC.take(T, "seed", want); EC.take(T, "grain", want - g); }
    if (meanPr(f) >= 1) { f.op = null; f.sown = doy; f.pr.fill(1); EC.releaseWorkers(w, u); }
  } else if (ph === "reap") {
    // reap + bind + stook + cart ≈ E.reapManDaysPerHa for the whole crew (§3.1): the carriers are part of it
    const remHa = f.ha * (1 - meanPr(f)), dHa = Math.min(remHa, n * md / E.reapManDaysPerHa);
    if (dHa > 0 && remHa > 0) {
      const W = Math.max(1, reapers(u.members.length, stookKg(w, b) > 0).reap);
      const took = f.left * dHa / remHa;
      for (const [i, p0, p1] of advance(b, f, dHa, W)) { const kg = took * ((p1 - p0) * f.ha / f.pr.length) / dHa; setStooks(w, b, i, p0, p1, kg); }
      f.left -= took; f.reaped = (f.reaped || 0) + took; T.stats.harvested += took;
      // (at game speed the line runs ahead of any walker: the reapers cut their way forward with it, keeping to its edge)
      const S = w.S, S0 = stripsOf(b), step = dHa / f.ha * b.h + 0.1;
      for (const id of u.members) { const M = w.labor?.men.get(id); if (M?.pose !== "work_sickle") continue;
        const [lx, ly] = fieldLocal(b, S.x[id], S.y[id]);
        const i = clamp(Math.floor((lx + b.w / 2) / (b.w / S0)), 0, S0 - 1), yt = frontY(b, i, f.pr[i]) + 1.2;
        if (ly < yt) { const [wx, wy] = fieldWorld(b, lx, Math.min(yt, ly + step)); S.x[id] = wx; S.y[id] = wy; } }
    }
    if (f.left <= 1 || meanPr(f) >= 1) { f.left = 0; rotate(w, b, doy); }
  } else if (ph === "weed") {
    if (doy < f.ripe) f.care = Math.min(1, f.care + n * md / (f.ha * E.weedManDaysPerHa * 1.0) * 0.5);
  } else if (ph !== "cart") EC.releaseWorkers(w, u);
}
// how a reaping crew of n splits: carriers (when there are stooks to carry), binders, reapers
export function reapers(n, stooks) { const carry = stooks ? Math.max(1, Math.round(n * 0.28)) : 0, bind = n - carry > 2 ? Math.max(1, Math.round(n * 0.22)) : 0; return { carry, bind, reap: Math.max(1, n - carry - bind) }; }

// the reeve's field work besides the harvest (ai-general.js allocateLabour): ploughing and sowing in season (two fields
// at a time, the soonest ripening first: which "prep"), and stooks still standing in a reaped field ("cart"). → [[b, n, prefer]]
export function crews(w, team, which = "all", maxPrep = 2) {
  const out = []; let prep = 0;
  // (a field the player drew and is waiting to be made comes first; then the soonest ripening)
  const first = (b) => (b.field.state === "clearing" && b.field.laidBy === "player" ? 0 : b.field.state === "growing" && b.field.op ? 1 : 2); // (ground already cleared is ploughed and sown before more is broken: a reeve who keeps laying new fields would otherwise never plough the old — js/sim/founding.js found it)
  const mine = w.buildings.filter((b) => b.team === team && b.field && !b.ruin).sort((a, c) => first(a) - first(c) || (a.field.ripe || 0) - (c.field.ripe || 0) || a.id - c.id);
  for (const b of mine) {
    const f = b.field;
    if (f.state === "clearing") { if (prep < maxPrep && which !== "cart") { prep++; out.push([b, clearCrew(w, b), ["man", "woman"]]); } continue; }
    if (!f.cy) initCycle(w, b);
    if (f.state === "growing" && f.op && prep < maxPrep && which !== "cart") { prep++; out.push([b, clamp(Math.round(f.ha * 0.5), 3, 6), ["woman", "man"]]); }
    else if (f.state !== "ripe" && which !== "prep" && phase(w, b) === "cart") out.push([b, clamp(Math.ceil(stookKg(w, b) / 400), 3, 16), ["woman", "man"]]);
  }
  return out;
}

// ---------------------------------------------------------------- threshing (economy.js homeWork, its threshing branch)
// the barn: the granary nearest the keep, else the keep itself; the threshing floor lies before its door
export function threshFloor(w, team) {
  const T = w.teams[team], hall = w.buildings.find((b) => b.id === T.hall);
  let barn = null, bd = Infinity;
  for (const b of w.buildings) if (b.team === team && b.kind === "granary" && b.progress >= 1 && !b.ruin) { const d = hall ? Math.hypot(b.x - hall.x, b.y - hall.y) : 0; if (d < bd) { bd = d; barn = b; } }
  barn ||= hall; if (!barn) return null;
  const tx = barn === hall ? (T.town?.x ?? barn.x) + 40 : hall ? hall.x : barn.x + 10, ty = barn === hall ? (T.town?.y ?? barn.y) + 25 : hall ? hall.y : barn.y;
  const [dx, dy] = LB.doorOf(barn, tx, ty), a = Math.atan2(dy - barn.y, dx - barn.x);
  return { barn, x: dx + Math.cos(a) * 5, y: dy + Math.sin(a) * 5 };
}
// → kg of sheaves threshed this tick (the old analytic rate: the home crew's man-days × E.threshPerManDay, the visible
// threshers included); the grain goes to the store, seed corn for next season's sowing kept back first
export function thresh(w, u, T, working, md) {
  const fl = threshFloor(w, u.team); let active = 0;
  if (fl) {
    const S = w.S, want = Math.min(8, Math.max(2, Math.floor(u.members.length * 0.08)));
    for (const id of u.members) { const M = w.labor?.men.get(id); if (M?.task?.name === "thresh") active++; }
    for (let k = 2; k < u.members.length && active < want; k++) {
      const id = u.members[k]; if (!S.alive[id] || w.labor?.men.get(id)) continue;
      const a = (active + 0.5) * 2 * Math.PI / want + (hsh(u.team, 3) - 0.5), r = 2.4 + 0.4 * (active % 2);
      const x = fl.x + Math.cos(a) * r, y = fl.y + Math.sin(a) * r;
      LB.assign(w, id, "thresh", [{ op: "go", x, y, near: 0.6 }, { op: "work", pose: "work_flail", secs: 40 + (id % 7) * 3, face: [fl.x, fl.y] }]);
      active++;
    }
  }
  const kg = Math.min(T.store.sheaves, (working + active) * md * E.threshPerManDay);
  if (kg <= 0) return 0;
  T.store.sheaves -= kg; if (T.store.sheaves < 1e-9) T.store.sheaves = 0;
  const seedWant = Math.max(0, seedNeed(w, u.team) - (T.store.seed || 0)), seed = Math.min(seedWant, kg * 0.35);
  EC.give(T, "seed", seed); EC.give(T, "grain", kg - seed);
  return kg;
}
// seed corn the team's fields will want at their next sowing
export function seedNeed(w, team) {
  let kg = 0;
  for (const b of w.buildings) {
    if (b.team !== team || !b.field || b.ruin) continue; const f = b.field;
    const crop = f.state === "growing" && f.op && f.seedDue ? f.crop : (f.state === "stubble" || f.state === "fallow") ? f.next : null;
    if (crop && Cof(crop)) kg += Cof(crop).seedKgHa * f.ha;
  }
  return kg;
}

// ---------------------------------------------------------------- what the renderer reads
// growth of the standing crop, 0 (just sown) … 1 (ripe). Winter wheat sits as short shoots until spring.
export function growth(f, doy) {
  if (f.state === "ripe") return 1;
  if (f.state !== "growing" || f.op) return 0;
  const s = f.sown ?? f.ripe - 110, R = f.ripe;
  if (R - s > 200) { const spring = R - (f.ripe % 365) + 60; if (doy < spring) return 0.12 * clamp((doy - s) / 40, 0, 1); return 0.12 + 0.88 * clamp((doy - spring) / (R - spring), 0, 1); }
  return clamp((doy - s) / Math.max(1, R - s), 0, 1);
}

// ---------------------------------------------------------------- the labour core: who does what next
LB.ITEMS.stook = { res: "sheaves", hold: "front", slow: 0.95, kg: 15, piece: 26 };          // ranks of stooks down half a land (a stook ≈ 10 sheaves; a piece = a rank of 4)
LB.ITEMS.wain = { res: "sheaves", hold: "wain", slow: 0.8, kg: 300, piece: 400 };           // sheaves heaped on a harvest cart
LB.ITEMS.plough = { res: "oxen", hold: "plough", slow: 0.8, kg: 0, piece: 1 };              // (an ox team and plough: kg 0)
LB.ITEMS.seedlip = { res: "seed", hold: "sow", slow: 0.8, kg: 0, piece: 1 };                // (the sower's seed sheet: kg 0)

LB.HOOKS["fields.yoke"] = (w, id, M, st) => { if (!M.carry) M.carry = { kind: st.arg, res: LB.ITEMS[st.arg].res, kg: 0 }; };
LB.HOOKS["fields.unyoke"] = (w, id, M) => { if (M.carry && M.carry.kg === 0 && (M.carry.kind === "plough" || M.carry.kind === "seedlip")) M.carry = null; };
// between the rounds: the land done (or the work moved on) → straight to the last step (unyoke)
LB.HOOKS["fields.more"] = (w, id, M, st) => {
  const b = w.buildings.find((x) => x.id === st.arg.b), f = b?.field;
  if (!f || f.op !== st.arg.op || !(f.pr?.[st.arg.i] < 1)) M.task.k = M.task.steps.length - 2;
};
// THE TEAM GOES HOME. A ploughman's yoke (or a sower's seed sheet) is no load: the moment his work in the field is not
// what he is doing — his crew sent to other work, his field's ploughing done or moved on, the player ordering him
// elsewhere, his task dropped — the team is unyoked (the oxen back with the stock: they were never taken from it) and he
// is a plain villager again. Without this a man kept a plough-walk whose field his crew no longer worked, and the crew's
// own work pulled him the other way: the owner's "guy with a plow that just walks in circles all day … and REFUSES to do
// anything I tell him to" (live realm, 2 Oct 2026). Checked every tick for the few men with a team (cheap).
const yoke = (M) => M?.carry && M.carry.kg === 0 && (M.carry.kind === "plough" || M.carry.kind === "seedlip");
function unyoke(M) { if (yoke(M)) M.carry = null; }
LB.TICKS["fields.yoke"] = (w) => {
  const L = w.labor; if (!L) return;
  for (const [id, M] of L.men) {
    if (!yoke(M)) continue;
    const u = w.units.get(w.S.unit[id]), b = u?.job?.kind === "field" ? u.job.b : null, f = b?.field;
    const want = M.carry.kind === "plough" ? "plough" : "sow";
    const ok = M.task?.name === "field" && w.S.alive[id] && f && !b.ruin && f.state === "growing" && f.op === want;
    if (!ok) { M.carry = null; if (M.task?.name === "field") LB.stop(w, id); else if (!M.task) L.men.delete(id); }
  }
};
LB.HOOKS["fields.wain"] = (w, id, M) => { if (M.carry?.kind === "stook") M.carry.kind = "wain"; };

// every field task is tagged with the phase it was planned for (its first step's `ph`): when the field moves on (the
// corn ripens under the weeders, the ploughing ends) work() calls the men off the old job at once
const tag = (steps, ph) => { if (steps?.length) steps[0].ph ??= ph; return steps; };
const fits = (tph, ph) => tph === ph || (tph === "carry" && (ph === "reap" || ph === "cart"));
LB.PLANNERS.field = (w, u, id, k, M, ctx) => { const b = ctx.job.b; if (!b?.field) return null; const ph = phase(w, b); return tag(planField(w, u, id, k, M, ctx), ph); };
function planField(w, u, id, k, M, ctx) {
  const b = ctx.job.b, f = b?.field; if (!f) return null;
  if (!f.cy) initCycle(w, b);
  const ph = phase(w, b), n = u.members.length, T = ctx.T;
  if (ph === "reap") {
    const R = reapers(n, stookKg(w, b) > 0);
    if (k < R.carry) { const c = carryTask(w, u, b, id, k, T); if (c) { c[0].ph = "carry"; return c; } return reapTask(w, b, id, 0, R.reap, true); }
    if (k < R.carry + R.bind) return reapTask(w, b, id, k - R.carry, R.bind, false, R.reap);
    return reapTask(w, b, id, k - R.carry - R.bind, R.reap, true);
  }
  if (ph === "cart") { const c = carryTask(w, u, b, id, k, T); if (c) c[0].ph = "carry"; return c; }
  if (ph === "clear") return clearTask(w, u, b, id, k, T);
  if (ph === "plough") { const teams = Math.min(n, ploughTeams(w, T, b)); return k < teams ? walkTask(w, b, id, k, n, n, "plough") : digTask(w, b, id, k, n); }
  if (ph === "sow") return walkTask(w, b, id, k, n, Math.ceil(n / 2), "seedlip");
  if (ph === "weed") return weedTask(w, b, id, k);
  return null;
}

// the j-th of `m` workers on the operation: which front (strip) and where across it
function slotFor(b, f, j, m, W = m) {
  const fr = fronts(f, Math.max(1, Math.min(W, f.pr.length))); if (!fr.length) return null;
  const i = fr[j % fr.length], per = Math.ceil(m / fr.length), slot = Math.floor(j / fr.length), st = stripOf(b, i);
  return { i, st, x: st.x0 + (slot + 0.5) * st.sw / per, y: frontY(b, i, f.pr[i]) };
}
// a reaper (sickle, at the standing corn's edge — a stride ahead of where the front is, it runs quickly at game speed)
// or a binder (a few paces behind, stooping over the cut swathes)
function reapTask(w, b, id, j, m, reap, mReap = m) {
  const f = b.field, s = slotFor(b, f, j % Math.max(1, mReap), Math.max(1, mReap)); if (!s) return null;
  const [mlx, mly] = fieldLocal(b, w.S.x[id], w.S.y[id]);   // the man, in the field's frame
  { // a man already out in the field keeps to the land he is on (the whole line advances together)
    const S0 = f.pr.length, i = Math.floor((mlx + b.w / 2) / (b.w / S0));
    if (i >= 0 && i < S0 && f.pr[i] < 1) { const st = stripOf(b, i); s.i = i; s.st = st; s.x = st.x0 + (0.1 + 0.8 * hsh(id, 41)) * st.sw; s.y = frontY(b, i, f.pr[i]); }
  }
  const dir = s.st.dir, jit = (hsh(id, w.tick >> 6) - 0.5) * 1.6;
  if (reap) {
    const secs = 5 + 4 * hsh(id, w.tick >> 5);
    const ahead = 1 + 3 * hsh(id, 5), y = clamp(s.y + dir * ahead, -b.h / 2 + 0.5, b.h / 2 - 0.5);
    const [fx, fy] = fieldWorld(b, s.x + jit, y + dir * 6);
    const work = { op: "work", pose: "work_sickle", secs, face: [fx, fy] };
    // already at the line, or just behind it (it runs on at game speed): straight to the cutting (work() keeps him at its edge)
    if (mly < y && y - mly < 40 && Math.abs(mlx - s.x) < 10) return [work];
    const [gx, gy] = fieldWorld(b, s.x + jit, y);
    return [{ op: "go", x: gx, y: gy, near: 0.8 }, work];
  }
  const y = clamp(s.y - dir * (3 + 3 * hsh(id, 9)), -b.h / 2 + 0.5, b.h / 2 - 0.5);
  const [gx, gy] = fieldWorld(b, s.x + jit + (j % 2 ? 2 : -2), y), [fx, fy] = fieldWorld(b, s.x, y + dir * 4);
  return [{ op: "go", x: gx, y: gy, near: 0.8 }, { op: "work", pose: "work_stoop", secs: 16 / 9 * 2, face: [fx, fy] }];
}
// a plough team (or a sower) on its land: up one edge of the turned band, wheel on the headland, down the other edge —
// two rounds, then (if the land is still unfinished) the next task carries on
function walkTask(w, b, id, j, m, W, kind) {
  const f = b.field, s = slotFor(b, f, j, m, W); if (!s) return null;
  const y0 = -b.h / 2 + 3, y1 = b.h / 2 - 3, p = f.pr[s.i], lane = (hsh(id, 3) - 0.5) * 1.5;
  const [, mly] = fieldLocal(b, w.S.x[id], w.S.y[id]);
  const south = Math.abs(mly - y0) < Math.abs(mly - y1), ya = south ? y0 : y1, yb = south ? y1 : y0;
  const xw = bandX(b, s.i, p, -1) + lane, xe = bandX(b, s.i, p, 1) + lane, arg = { b: b.id, i: s.i, op: f.op };
  const go = (lx, ly, near) => { const [x, y] = fieldWorld(b, lx, ly); return { op: "go", x, y, near }; };
  const steps = [{ op: "hook", name: "fields.yoke", arg: kind }, go(xw, ya, 2)];
  for (let r = 0; r < 2; r++) steps.push(go(xw, yb, 1.2), { op: "hook", name: "fields.more", arg }, go(xe, yb, 1.5), go(xe, ya, 1.2), { op: "hook", name: "fields.more", arg });
  steps.push({ op: "hook", name: "fields.unyoke" });
  return steps;
}
// no oxen: turning the ground by spade (the digging clip), at the front
function digTask(w, b, id, j, m) {
  const f = b.field, s = slotFor(b, f, j, Math.max(1, m)); if (!s) return null;
  const side = hsh(id, w.tick >> 8) < 0.5 ? -1 : 1, lx = bandX(b, s.i, f.pr[s.i], side) + side * 0.8, ly = -b.h / 2 + (0.05 + 0.9 * hsh(id, w.tick >> 7)) * b.h;
  const [x, y] = fieldWorld(b, lx, ly), [fx, fy] = fieldWorld(b, lx + side * 5, ly);
  return [{ op: "go", x, y, near: 0.8 }, { op: "work", pose: "work_hoe", secs: 8, face: [fx, fy] }];
}
// weeding the growing corn: along the furrows of one strip
function weedTask(w, b, id, k) {
  const S = stripsOf(b), i = Math.floor(hsh(id, 21) * S), st = stripOf(b, i), q = hsh(id, w.tick >> 7);
  const lx = st.x0 + (0.15 + 0.7 * hsh(id, 23)) * st.sw, ly = -b.h / 2 + (0.05 + 0.9 * q) * b.h;
  const [x, y] = fieldWorld(b, lx, ly), [fx, fy] = fieldWorld(b, lx, ly + st.dir * 5);
  return [{ op: "go", x, y, near: 1.0 }, { op: "work", pose: "work_hoe", secs: 10, face: [fx, fy] }];
}
// a carrier: to a line of stooks, take a lot, to the granary (the harvest counts only when it is set down there)
function carryTask(w, u, b, id, k, T) {
  const S = w.S, list = stooksOf(w, b); if (!list.length) return null;
  let it = null, bd = Infinity;
  for (const s of list) { const n = s.n, ex = s.x + Math.cos(s.rot) * (Math.floor((n - 1) / 2)) * STOOK_SPACING, ey = s.y + Math.sin(s.rot) * (Math.floor((n - 1) / 2)) * STOOK_SPACING; const d = Math.hypot(ex - S.x[id], ey - S.y[id]) - s.kg * 0.02; if (d < bd) { bd = d; it = s; } }
  const store = LB.nearestStore(w, u.team, "sheaves", it.x, it.y); if (!store) return null;
  const n = it.n, off = Math.floor((n - 1) / 2) * STOOK_SPACING, side = (k % 2 ? 1 : -1) * 3.2;
  const ex = it.x + Math.cos(it.rot) * off - Math.sin(it.rot) * side, ey = it.y + Math.sin(it.rot) * off + Math.cos(it.rot) * side;
  const cart = k === 0 && (T.store.carts || 0) > 0 && ((T.store.oxen || 0) + (T.store.horses || 0)) > 0;
  const d = Math.hypot(store.x - it.x, store.y - it.y), [dx, dy] = LB.doorOf(store, ex, ey);
  const steps = [{ op: "go", x: ex, y: ey, near: 1.2 }, { op: "take", item: it.id, kg: LB.lotFor(w, T, d, cart ? "wain" : "stook", cart), share: 3 }];
  if (cart) steps.push({ op: "hook", name: "fields.wain" });
  steps.push({ op: "go", x: dx, y: dy, near: 1.5 }, { op: "put", to: "store", b: store.id });
  return steps;
}

// ================================================================ MAKING A FIELD
// (the owner, 2026-10-02: "when you try to make a field, you draw your OWN rectangle that is orientated toward the
// direction your camera is facing … the men … actually make it. They cut down trees in that area, plow it, and leave it
// looking like an actual shape.") The land is grass (js/sim/map.js grassOver); a field is a rectangle the player draws —
// or the reeve picks (pickFieldRect) — laid with layField. It is MADE before it is farmed:
//   CLEARING  woodmen fell every tree inside it (lane B's own felling: hooks forest.fell / forest.landed / forest.limb —
//             the trunk leaves the obstacle grid, the tree comes down, a stump stays), limb it, skid the logs to a landing
//             at the field's edge and carry them to the store (the timber counts when it is set down there); then the
//             stumps are GRUBBED out, the bushes grubbed up, the brush and undergrowth cut (man-days by area and scrub)
//   BREAKING  then the plough breaks the sod: the field is a fresh one on virgin turf (initCycle: the first ploughing —
//             3D furrows behind the team — and sowing for the crop the season allows)
// State: b.field.state "clearing", b.field.make = { fell: [vi], bush: [vi], brush: 0..1, scrub, landing: [x, y, rot] };
// the trees and stumps are lane B's items (key tree:<vi> / stump:<vi>, node "f<b.id>", so no wood crew takes them).
export const FIELD_RECT = { minSide: 30, maxSide: 420, minHa: 0.25, maxHa: 12, reach: 1400 };
const CLEAR_TIMBER = 0.25;        // of what a tree stands for in the woods (forestry treeKg): its usable timber when it is felled to clear ground
const BRUSH_MD_HA = 3;            // man-days a hectare to cut the brush and undergrowth of open grass (×(1 + 2 × scrub))
const FELL_MD = 0.8, GRUB_MD = 0.15;   // (estimates for the preview: a tree felled, limbed, skidded and grubbed; a bush)
const BAD_SURF = { deep_water: "water", shallow_ford: "water", stream_bed: "a stream", marsh: "marsh", reed_bed_fen: "fen", peat_bog: "bog", alder_carr: "wet carr",
  dirt_track: "a road", village_street: "a street", hollow_way: "a road", cobbled_road: "a road", stone_paving: "paving", cliff_rock: "rock", rock_slab: "rock", scree: "scree",
  boulder_field: "boulders", quarry_floor: "a quarry", ruins_rubble: "ruins", limestone_pavement: "rock" };
const SCRUB = { bramble_thicket: 1, gorse_scrub: 1, bracken: 0.6, coppice: 1, open_forest: 1, dense_forest: 1, pine_forest: 1, heath_heather: 0.5, deadfall_clearing: 1 };
const nodeOf = (b) => "f" + b.id;
// do two oriented rectangles {x, y, w, h, rot} overlap, each shrunk by `inset` m (grown, if negative) — separating axes
export function rectsOverlap(a, b, inset = 0) {
  const cs = (q) => { const c = Math.cos(q.rot || 0), n = Math.sin(q.rot || 0), hw = Math.max(0.5, q.w / 2 - inset), hh = Math.max(0.5, q.h / 2 - inset); return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([p, r]) => [q.x + p * c - r * n, q.y + p * n + r * c]); };
  const A = cs(a), B = cs(b);
  for (const P of [A, B]) for (let i = 0; i < 4; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % 4], ax = -(y2 - y1), ay = x2 - x1;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [px, py] of A) { const d = px * ax + py * ay; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const [px, py] of B) { const d = px * ax + py * ay; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 <= b0 || b1 <= a0) return false;
  }
  return true;
}
// the rectangle as a field lies: strips along its LONG side (local +y) — so w ≤ h, rot in (−π/2, π/2]
export function normRect(r) {
  let { x, y, w: W, h: H, rot = 0 } = r;
  if (W > H) { [W, H] = [H, W]; rot += Math.PI / 2; }
  rot = Math.atan2(Math.sin(rot), Math.cos(rot)); if (rot > Math.PI / 2) rot -= Math.PI; if (rot <= -Math.PI / 2) rot += Math.PI;
  return { x, y, w: W, h: H, rot };
}
// the map's plants in 32 m buckets (static data: built once per vegetation list)
const vegGrids = new WeakMap();
function vegIn(w, r, m = 0) {
  const veg = w.obstacles?.veg; if (!veg) return null;
  let G = vegGrids.get(veg); if (!G) { G = new Map(); veg.forEach((v, i) => { const k = ((v.x / 32) | 0) * 100000 + ((v.y / 32) | 0); let a = G.get(k); if (!a) G.set(k, (a = [])); a.push(i); }); vegGrids.set(veg, G); }
  const R = Math.hypot(r.w, r.h) / 2 + m, out = [];
  for (let i = ((r.x - R) / 32) | 0; i <= ((r.x + R) / 32) | 0; i++) for (let j = ((r.y - R) / 32) | 0; j <= ((r.y + R) / 32) | 0; j++) {
    const a = G.get(i * 100000 + j); if (!a) continue;
    for (const vi of a) { const v = veg[vi], [lx, ly] = fieldLocal(r, v.x, v.y); if (Math.abs(lx) < r.w / 2 + m && Math.abs(ly) < r.h / 2 + m) out.push(vi); }
  }
  return out.sort((a, b) => a - b);
}
const hallOf = (w, team) => { const T = w.teams[team]; return w.buildings.find((b) => b.id === T?.hall && !b.ruin) || (T?.town ? { x: T.town.x, y: T.town.y } : null); };
const segHitsRect = (r, x1, y1, x2, y2, m) => { for (let t = 0; t <= 1; t += 0.05) { const [lx, ly] = fieldLocal(r, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t); if (Math.abs(lx) < r.w / 2 + m && Math.abs(ly) < r.h / 2 + m) return true; } return false; };
// Can a field be made on this rectangle? → { ok, why, ha, trees, bushes, scrub, labour (man-days), yieldKg, rect }. The same
// check for the player's drawing (its live preview), the server's command, the reeve's choice.
export function fieldRect(w, team, r0) {
  const r = normRect(r0), map = w.map, ha = r.w * r.h / 1e4, out = { ok: false, why: "", ha, rect: r, trees: 0, bushes: 0, scrub: 0, labour: 0, yieldKg: 0 };
  const say = (why) => { out.why = why; return out; };
  if (!(r.w > 0 && r.h > 0)) return say("draw the field: press, drag, release");
  if (r.w < FIELD_RECT.minSide || ha < FIELD_RECT.minHa) return say(`too small (at least ${FIELD_RECT.minSide} m across and ${FIELD_RECT.minHa} ha)`);
  if (r.h > FIELD_RECT.maxSide || ha > FIELD_RECT.maxHa) return say(`too big (at most ${FIELD_RECT.maxSide} m long and ${FIELD_RECT.maxHa} ha)`);
  const H = hallOf(w, team); if (!H) return say("you have no town");
  const dh = Math.hypot(r.x - H.x, r.y - H.y); if (dh > FIELD_RECT.reach) return say(`too far from the town (${Math.round(dh)} m; ${FIELD_RECT.reach} at most)`);
  // the ground: sampled every few metres inside it
  const nx = Math.max(3, Math.min(30, Math.round(r.w / 8))), ny = Math.max(3, Math.min(40, Math.round(r.h / 8)));
  let steep = 0, n = 0, scrub = 0;
  for (let a = 0; a <= nx; a++) for (let c = 0; c <= ny; c++) {
    const [x, y] = fieldWorld(r, (a / nx - 0.5) * (r.w - 1), (c / ny - 0.5) * (r.h - 1));
    if (!map.inBounds(x, y)) return say("off the map");
    if (map.water(x, y) > 0.02) return say("there is water in it");
    const k = map.surfaceAt?.(x, y); if (BAD_SURF[k]) return say(`it runs over ${BAD_SURF[k]}`);
    scrub += SCRUB[k] || 0; n++;
    if (Math.hypot(...map.grad(x, y)) > 0.2) steep++;
  }
  if (steep > n * 0.12) return say("too steep to plough");
  out.scrub = scrub / n;
  // nothing standing in it, no other field, no wall; worked sites (quarries, mines, pits) keep their ground
  for (const b of w.buildings) {
    if (b.ruin) continue;
    if (b.field) { if (rectsOverlap(b, r, -3)) return say("it overlaps another field"); continue; }
    if (b.x1 !== undefined) { if (segHitsRect(r, b.x1, b.y1, b.x2, b.y2, 4)) return say("a wall runs through it"); continue; }
    const fp = EC.BUILDINGS[b.kind]?.footprint || [10, 8];
    if (Math.hypot(b.x - r.x, b.y - r.y) > Math.hypot(r.w, r.h) / 2 + Math.hypot(fp[0], fp[1]) / 2 + 6) continue;
    const [lx, ly] = fieldLocal(r, b.x, b.y), R = Math.hypot(fp[0], fp[1]) / 2 + 4;
    if (Math.abs(lx) < r.w / 2 + R && Math.abs(ly) < r.h / 2 + R) return say(`a ${(EC.BUILDINGS[b.kind]?.name || b.kind).toLowerCase()} stands there`);
  }
  for (const q of w.resources || []) {
    if (q.kind === "hunt" || q.kind === "forage" || q.kind === "fish" || q.res === "timber" || q.res === "wood" || q.res === "firewood") continue;
    const [lx, ly] = fieldLocal(r, q.x, q.y); if (Math.abs(lx) < r.w / 2 + (q.r || 0) && Math.abs(ly) < r.h / 2 + (q.r || 0)) return say(`it takes in the ${q.name || q.kind || "workings"}`);
  }
  // what making it takes: the trees to fell and the bushes to grub (those still standing), the brush to cut, the sod to break
  const veg = w.obstacles?.veg, felled = w.labor?.forest?.felled || {}, inside = vegIn(w, r, -1) || [];
  for (const vi of inside) { if (felled[vi] !== undefined) continue; if (TREES[veg[vi].asset]) out.trees++; else if (BODY_R[veg[vi].asset] !== undefined) out.bushes++; }
  out.labour = out.trees * FELL_MD + out.bushes * GRUB_MD + ha * BRUSH_MD_HA * (1 + 2 * out.scrub) + ha * E.ploughManDaysPerHa;
  const fx = buildEffects(map, "field", r.x, r.y);
  out.yieldKg = ha * CROPS.wheat.yieldKgHa * fx.yieldMul * TC.mul(w, team, "yield");
  out.ok = true; out.soil = fx.yieldMul;
  return out;
}
// Lay a field on the rectangle (the player's "field" command; the reeve's laying; the AI lord's) → { b, check } | { error }.
// It starts as ground to be cleared (the crop it will carry is chosen when the sod is broken: the season decides then).
export function layField(w, team, r0, { by = "player" } = {}) {
  const chk = fieldRect(w, team, r0); if (!chk.ok) return { error: chk.why, check: chk };
  const r = chk.rect, b = EC.placeBuilding(w, team, "field", r.x, r.y, r.rot, true); if (!b) return { error: "can't lay a field there" };
  EC.initField(b, "wheat", r.w, r.h);
  const f = b.field, veg = w.obstacles?.veg, felled = w.labor?.forest?.felled || {}, inside = vegIn(w, r, -1) || [];
  Object.assign(f, { state: "clearing", left: 0, clr: 1, virgin: 1, laidBy: by, laidDay: w.econ.doy, soil: chk.soil });
  delete f.fresh;
  f.make = { fell: inside.filter((vi) => felled[vi] === undefined && TREES[veg[vi].asset]), bush: inside.filter((vi) => felled[vi] === undefined && !TREES[veg[vi].asset] && BODY_R[veg[vi].asset] !== undefined), brush: 0, scrub: chk.scrub };
  const fx = buildEffects(w.map, "field", r.x, r.y); b.land = { key: fx.land.key, lines: fx.lines };
  // nobody builds a cottage in it: the plan's free plots it covers are gone (js/sim/townplan.js)
  for (const q of w.plans?.[team]?.slots || []) if (!q.taken && q.x1 === undefined && q.w > 0 && rectsOverlap(q, b, 0)) { q.taken = b.id; q.takenKind = "field"; }
  w.events?.push({ t: w.tick, kind: "field-laid", team, building: b.id, x: b.x, y: b.y, by });
  return { b, check: chk };
}
// the clearing is done: the sod is broken next (a fresh field on virgin turf; the crop the season allows)
function clearingDone(w, b) {
  const f = b.field, M = f.make; if (!M) return true;
  if ((M.brush || 0) < 1) return false;
  const Fo = w.labor?.forest, felled = Fo?.felled || {};
  for (const vi of M.fell) if (felled[vi] === undefined) return false;
  for (const vi of M.bush) if (felled[vi] === undefined) return false;
  const node = nodeOf(b);
  for (const it of w.labor?.items || []) if (it.node === node && ((it.kind === "tree" && (it.st !== "logs" || it.kg > 0)) || (it.kind === "stump" && it.st !== "gone"))) return false;
  return true;
}
function finishMaking(w, b) {
  const f = b.field, D = w.econ.doy, fh = firstHarvest(D, b.id), C = CROPS[fh.crop];
  const pile = LB.itemByKey(w, `site:${nodeOf(b)}:${b.team}`); if (pile) pile.loose = true;   // (logs left at the landing: the reserve fetches them home)
  delete f.make; f.made = 1;
  Object.assign(f, { state: "growing", crop: fh.crop, yieldKgHa: C.yieldKgHa * (f.soil ?? 1), left: f.ha * C.yieldKgHa * (f.soil ?? 1), seedFrac: C.seedKgHa / C.yieldKgHa, ripe: C.ripe, fresh: true, virgin: 1 });
  delete f.cy; delete f.soil;   // (initCycle reads the soil back off yieldKgHa)
  initCycle(w, b);
  w.events?.push({ t: w.tick, kind: "field-made", team: b.team, building: b.id, x: b.x, y: b.y });
}
// how many hands the reeve puts to the clearing
export function clearCrew(w, b) { const M = b.field.make; return clamp(Math.round(3 + (M?.fell.length || 0) / 12 + b.field.ha * 0.8), 4, 12); }
// the analytic part of the clearing: the brush and undergrowth cut by the men at it (the trees, stumps and bushes are
// tasks: below); speeded as the rest of the field's preparation (E.fieldPrepSpeed)
function clearWork(w, u, b, working, md) {
  const f = b.field, M = f.make; if (!M) return;
  for (const id of u.members) { const m = w.labor?.men.get(id); if (m?.task && !m.carry && (m.task.name !== "field" || !fits(m.task.steps[0]?.ph, "clear"))) LB.stop(w, id); }
  let n = 0; for (const id of u.members) { const m = w.labor?.men.get(id); if (m?.task?.steps[0]?.tag === "fbrush") n++; }
  if (n) M.brush = Math.min(1, (M.brush || 0) + n * md / (BRUSH_MD_HA * f.ha * (1 + 2 * (M.scrub || 0))) * (E.fieldPrepSpeed || 1));
  if (clearingDone(w, b)) { finishMaking(w, b); }
}
// the field's landing: on its edge nearest the store (where the logs are stacked for the carriers)
function landingOf(w, b, store) {
  const M = b.field.make; if (M.landing) return M.landing;
  const [lx, ly] = fieldLocal(b, store.x, store.y), ex = clamp(lx, -b.w / 2, b.w / 2), ey = clamp(ly, -b.h / 2, b.h / 2);
  const out = Math.abs(lx) / b.w > Math.abs(ly) / b.h ? [Math.sign(lx) * (b.w / 2 + 4), clamp(ly, -b.h / 2 + 4, b.h / 2 - 4)] : [clamp(lx, -b.w / 2 + 4, b.w / 2 - 4), Math.sign(ly) * (b.h / 2 + 4)];
  const [x, y] = fieldWorld(b, out[0], out[1]); void ex; void ey;
  return (M.landing = [x, y, (b.rot || 0) + Math.PI / 2]);
}
// one man's next job in the clearing: fell, limb, skid, carry, grub a stump, grub a bush, else cut the brush
function clearTask(w, u, b, id, k, T) {
  const f = b.field, M = f.make, veg = w.obstacles?.veg, S = w.S; if (!M) return null;
  const Fo = LB.laborOf(w).forest ||= { felled: {}, claim: {}, next: 0 }, node = nodeOf(b), n = u.members.length;
  const store = LB.nearestStore(w, b.team, "timber", b.x, b.y);
  const mine = (w.labor.items || []).filter((it) => it.node === node);
  const busy = new Map(); for (const [, m] of w.labor.men) { const t = m.task?.steps[0]; if (t?.fitem) busy.set(t.fitem, (busy.get(t.fitem) || 0) + 1); }
  // carriers: the landing pile to the store (a quarter of the crew while there are logs on it)
  const pile = LB.itemByKey(w, `site:${node}:${b.team}`);
  if (store && pile?.kg > 0 && k < Math.max(1, Math.ceil(n / 4))) {
    const [dx, dy] = LB.doorOf(store, pile.x, pile.y), d = Math.hypot(dx - pile.x, dy - pile.y);
    return [{ op: "go", x: pile.x + 1.4, y: pile.y, near: 1.2, tag: "fcarry" }, { op: "take", item: pile.id, kg: LB.lotFor(w, T, d, "log"), share: 3 }, { op: "go", x: dx, y: dy, near: 1.5 }, { op: "put", to: "store", b: store.id }];
  }
  // fell: a few trees at a time, the nearest the landing first (the clearing opens from the side the logs go out)
  if (veg && store) {
    const fellMax = Math.max(1, Math.ceil(n / 3)); let chopping = 0;
    for (const [, m] of w.labor.men) if (m.task?.steps[0]?.tag === "ffell" && m.task.steps[0].fnode === node) chopping++;
    const [lx, ly] = landingOf(w, b, store);
    if (chopping < fellMax) {
      let best = -1, bd = Infinity;
      for (const vi of M.fell) {
        if (Fo.felled[vi] !== undefined) continue;
        const c = Fo.claim[vi]; if (c !== undefined && c !== id && w.labor.men.get(c)?.task?.steps[0]?.tag === "ffell") continue;
        const v = veg[vi], d = Math.hypot(v.x - lx, v.y - ly) + Math.hypot(v.x - S.x[id], v.y - S.y[id]) * 0.3; if (d < bd) { bd = d; best = vi; }
      }
      if (best >= 0) {
        const v = veg[best], dir = Math.atan2(ly - v.y, lx - v.x) + Math.PI + (hsh(best, 5) - 0.5) * 1.6;   // (it falls into the field, away from the landing)
        const sa = dir + Math.PI + (hsh(best, 9) < 0.5 ? -0.5 : 0.5), r = (BODY_R[v.asset] ?? 0.4) * (v.scale || 1) + 0.5, sx = v.x + Math.cos(sa) * r, sy = v.y + Math.sin(sa) * r;
        Fo.claim[best] = id;
        return [{ op: "go", x: sx, y: sy, near: 0.5, tag: "ffell", fnode: node },
          { op: "work", pose: "work_axe", secs: 22 + 12 * hsh(best, 3) * (v.scale || 1), x: sx, y: sy, face: [v.x, v.y], hook: "forest.fell", arg: { vi: best, node, dir } },
          { op: "wait", secs: FALL_S + 0.8, face: [v.x + Math.cos(dir) * 8, v.y + Math.sin(dir) * 8] },
          { op: "hook", name: "forest.landed", arg: { vi: best } }];
      }
    }
    // limb a tree that is down; skid a log off a limbed one to the landing
    for (const t of mine) if (t.kind === "tree" && (t.st === "down" || t.st === "falling") && (busy.get(t.id) || 0) < 2) {
      const tv = veg[t.vi]; if (!tv) continue; const H = (TREES[tv.asset]?.h || 15) * (tv.scale || 1), fr = (busy.get(t.id) || 0) ? 0.72 : 0.5, c = Math.cos(t.rot), s2 = Math.sin(t.rot), px = t.x + c * H * fr, py = t.y + s2 * H * fr;
      return [{ op: "go", x: px - s2 * 1.3, y: py + c * 1.3, near: 0.8, tag: "flimb", fitem: t.id }, { op: "work", pose: "work_axe", secs: 14 + 4 * hsh(id, t.id), face: [px, py], hook: "fields.limb", arg: { item: t.id } }];
    }
    for (const t of mine) if (t.kind === "tree" && t.st === "logs" && t.kg > 0 && (busy.get(t.id) || 0) < 2) {
      const tv = veg[t.vi], H = tv ? (TREES[tv.asset]?.h || 15) * (tv.scale || 1) * 0.55 : 8, c = Math.cos(t.rot), s2 = Math.sin(t.rot);
      return [{ op: "go", x: t.x + c * (H + 1.2), y: t.y + s2 * (H + 1.2), near: 1.2, tag: "fskid", fitem: t.id }, { op: "take", item: t.id, kg: Math.min(t.kg, LB.lotFor(w, T, Math.hypot(lx - t.x, ly - t.y), "tree")) },
        { op: "go", x: lx, y: ly, near: 2.2 }, { op: "put", to: "pile", key: `site:${node}:${b.team}`, kind: "log", x: lx, y: ly, rot: (b.rot || 0) + Math.PI / 2 }];
    }
  }
  // grub out the stumps of the felled trees (their brushwood heaped first or not: it goes on the fire)
  const stumps = mine.filter((it) => it.kind === "stump" && it.st !== "gone" && !(busy.get(it.id) >= 2) && !mine.some((t) => t.kind === "tree" && t.vi === it.vi && t.st !== "logs"));
  if (stumps.length) {
    const it = stumps[(k + (w.tick >> 8)) % stumps.length], a = hsh(id, it.id) * 6.283;
    return [{ op: "go", x: it.x + Math.cos(a) * 1.1, y: it.y + Math.sin(a) * 1.1, near: 0.6, tag: "fgrub", fitem: it.id }, { op: "work", pose: "work_hoe", secs: 14 + 6 * hsh(it.id, 3), face: [it.x, it.y], hook: "fields.grub", arg: { item: it.id } }];
  }
  // grub up the bushes (hedge, scrub)
  if (veg) {
    const left = M.bush.filter((vi) => Fo.felled[vi] === undefined);
    if (left.length) {
      const vi = left[(k * 7 + (w.tick >> 8)) % left.length], v = veg[vi], a = hsh(id, vi) * 6.283;
      return [{ op: "go", x: v.x + Math.cos(a) * 1.3, y: v.y + Math.sin(a) * 1.3, near: 0.7, tag: "fgrubb" }, { op: "work", pose: "work_hoe", secs: 8 + 5 * hsh(vi, 3), face: [v.x, v.y], hook: "fields.grubBush", arg: { vi, b: b.id } }];
    }
  }
  // cut the brush and undergrowth: across the field, a few metres each task
  if ((M.brush || 0) < 1) {
    const q = hsh(id, w.tick >> 7), lx = (hsh(id, 21 + (w.tick >> 9)) - 0.5) * (b.w - 6), ly = (q - 0.5) * (b.h - 6), [x, y] = fieldWorld(b, lx, ly), [fx, fy] = fieldWorld(b, lx + 3, ly);
    return [{ op: "go", x, y, near: 1.2, tag: "fbrush" }, { op: "work", pose: hsh(id, 4) < 0.5 ? "work_hoe" : "work_stoop", secs: 10, face: [fx, fy] }];
  }
  return null;
}
LB.HOOKS["fields.limb"] = (w, id, M, st) => {
  LB.HOOKS["forest.limb"](w, id, M, st);
  const t = LB.itemById(w, st.arg.item), v = t && w.obstacles?.veg?.[t.vi];
  if (t?.st === "logs" && !t.got && v) { const kg = treeKg(v) * CLEAR_TIMBER; t.got = kg; LB.addKg(w, t, kg); }
};
LB.HOOKS["fields.grub"] = (w, id, M, st) => { const it = LB.itemById(w, st.arg.item); if (it && it.kind === "stump" && it.st !== "gone") { it.st = "gone"; w.labor.ver++; } };
LB.HOOKS["fields.grubBush"] = (w, id, M, st) => {
  const { vi, b: bid } = st.arg, O = w.obstacles, v = O?.veg?.[vi], Fo = LB.laborOf(w).forest ||= { felled: {}, claim: {}, next: 0 };
  if (!v || Fo.felled[vi] !== undefined) return;
  const bk = O.circles.get(((v.x / 8) | 0) * 100000 + ((v.y / 8) | 0));
  if (bk) for (let k = 0; k < bk.length; k += 3) if (bk[k] === v.x && bk[k + 1] === v.y) { bk.splice(k, 3); O.count--; break; }
  Fo.felled[vi] = w.econ?.doy ?? 0; Fo.cv = (Fo.cv || 0) + 1;
  // (a "gone" stump marks the spot: the renderer hides the bush's standing instance, nothing grows back on ploughed ground)
  const s = LB.addItem(w, { kind: "stump", res: "stump", kg: 0, x: v.x, y: v.y, team: M.team, key: `stump:${vi}` }); Object.assign(s, { st: "gone", t0: w.time, vi, node: "f" + bid });
};

// ================================================================ THE REEVE'S SURVEY: a rectangle of good ground near the town
// Open, flat, dry ground near the vill, the fewer trees the better, laid tidily: alongside a field the house already has
// (the same axis, a headland's width apart) or, on fresh ground, with its long side along the slope's contour. → a rect
// fieldRect accepts, or null. Deterministic.
export function pickFieldRect(w, team, { ha = 2.4, near = null, fresh = false } = {}) {   // (fresh: open ground round `near` only, not beside the fields)
  const H = near || hallOf(w, team); if (!H) return null;
  const mine = w.buildings.filter((b) => b.team === team && b.field && !b.ruin), W0 = clamp(Math.round(ha * 1e4 / 280), 80, 150), L0 = clamp(Math.round(ha * 1e4 / W0), 120, 360);   // (a long field: strips 280 m or so, as a plough team likes)
  // the survey: the ground beside the fields the house has first, then fresh ground on rings round the hall; when no field
  // of the size wanted fits any more, smaller ones on a closer search (the gaps between fields and woods) — a vill must not
  // run out of ground at ~180 ha with good land still lying between its fields (famine-test, a 2-year run)
  const pass = (W0, L0, step, gap, both) => {
    const cands = [];
    // beside an existing field: the same axis, a 9 m headland between (a cart's turning room)
    for (const b of fresh ? [] : mine) for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const sl of both ? [0, -0.3, 0.3] : [0]) {
      const w2 = ox ? W0 : b.w, h2 = oy ? L0 : b.h, lx = ox * (b.w / 2 + 9 + w2 / 2) + (oy ? sl * b.w : 0), ly = oy * (b.h / 2 + 9 + h2 / 2) + (ox ? sl * b.h : 0), [x, y] = fieldWorld(b, lx, ly);
      cands.push({ x, y, w: w2, h: h2, rot: b.rot || 0, beside: 1 });
    }
    // fresh ground: rings round the hall, the long side along the contour (or across it, on the closer search)
    for (let r = 160; r <= FIELD_RECT.reach - 150; r += step) for (let k = 0, m = Math.round(r / gap); k < m; k++) {
      const a = (k + 0.5) / m * 2 * Math.PI + team * 0.37, x = H.x + Math.cos(a) * r, y = H.y + Math.sin(a) * r;
      if (!w.map.inBounds(x, y)) continue;
      const [gx, gy] = w.map.grad(x, y), rot = Math.hypot(gx, gy) > 0.01 ? Math.atan2(gy, gx) : a;   // (local +y, the strips, runs along the contour: perpendicular to the fall)
      cands.push({ x, y, w: W0, h: L0, rot, beside: 0 });
      if (both) cands.push({ x, y, w: W0, h: L0, rot: rot + Math.PI / 2, beside: 0 });
    }
    let best = null, bs = Infinity;
    for (const c of cands) {
      const d = Math.hypot(c.x - H.x, c.y - H.y); if (d > FIELD_RECT.reach - 60) continue;
      const pre = d / 120 - c.beside * 3; if (pre >= bs) continue;
      const chk = fieldRect(w, team, c); if (!chk.ok) continue;
      const sc = pre + chk.trees * 0.08 + chk.bushes * 0.01 + chk.scrub * 4;
      if (sc < bs) { bs = sc; best = chk.rect; }
    }
    return best;
  };
  return pass(W0, L0, 70, 22, false) || pass(70, 150, 45, 16, true) || pass(50, 100, 35, 12, true);
}
