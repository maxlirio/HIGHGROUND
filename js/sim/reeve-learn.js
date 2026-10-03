// THE LEARNING REEVE (the owner: "It watches what you do and records the situations … and COPIES your playstyle … so that it
// helps you instead of constantly fights you").
//
// THE BOOK (T.reeveBook, plain data on the team: saved with the world; an old save simply has none yet):
//   { v: 1, on: true, n: orders seen in all, rows: [row] }   — at most BOOK_MAX rows, the oldest dropped first.
//   row = { t: tick, op, a: {…what was ordered}, s: situation, r: what the reeve would have done instead (or null) }
//   Recorded by js/game/commands.js after every successful player command that is a choice about the economy: villagers
//   set to work (order "work", a broad task, "Work here", a workshop's crew), a building staked out, a field drawn, a
//   muster, a workshop's product, a study begun (and a trade, should the player ever be given one).
//   situation (situation()): the day of the year, days of food in hand, the stocks (timber, stone, ore, coin), the wages
//   and arrears, the labour (all of it, and the men under the player's own orders by kind of work), threat, the stage.
//
// THE LEARNER: k-nearest-neighbours over the situation (vec(): the season on a circle, food, stocks, coin, arrears,
// threat, stage, labour — each scaled to about 0..2). Deterministic: no dice, no clock; ties broken by row order.
//   • labour (allocationTargets): for each kind of work the player puts men on, the share of the labour he keeps on it in
//     situations like this one → the reeve's crews on that work are pulled toward it (ai-general.js allocateLabour)
//   • stock targets (stockTarget): the store level he sends men for timber / stone at → the reeve's wanted stock
//   • workshops (productFor): what he has a workshop of that kind make in situations like this one
//   • building (buildWant): what he builds at this point (how many of the kind he had when he built another)
//   • fields (fieldHa): the size of field he draws
// The hard rules stay the reeve's own and are never learned over: the food watch (famine labour), the harvest, fires, the
// warden's shelter, a crew the player set (economy.setCrew) and any crew under his orders.
// summary() puts it in plain words for the keep's panel ("You keep 12 men on timber in spring; he does the same").
import * as EC from "./economy.js";
import { BUILDINGS, RECIPES } from "./econ-data.js";
import { stageStatus } from "./stages.js";
import { ARMS } from "./arms.js";
import { TECHS } from "./tech.js";

export const BOOK_MAX = 400;   // rows kept (the oldest go first)
export const K = 10;           // neighbours consulted
const CLOSE = 0.9;             // a neighbour nearer than this counts toward confidence
const LEARN_OPS = new Set(["order", "task", "staff", "crew", "place", "field", "recruit", "product", "research", "trade"]);

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const r1 = (v) => Math.round(v * 10) / 10;
export function book(T) { return T.reeveBook ||= { v: 1, on: true, n: 0, rows: [] }; }
export const learning = (T) => !!T && (T.reeveBook ? T.reeveBook.on !== false : true);

// ---------------------------------------------------------------- kinds of work
// a job → the kind of work the book counts it as (null: not work the reeve allocates)
export function catOf(j) {
  if (!j) return null;
  switch (j.kind) {
    case "gather": { const r = j.res || j.node?.res; return r === "timber" || r === "stone" || r === "ore" || r === "silver" || r === "gold" || r === "firewood" || r === "mana" ? r : "food"; }
    case "field": return "field";
    case "build": return "build";
    case "store": return "haul";
    case "craft": return "craft";
    case "practice": return "practice";
    default: return null;
  }
}
export const CAT_WORD = { timber: "timber", stone: "stone", ore: "ore", silver: "silver", gold: "gold", firewood: "firewood", mana: "the ley line", food: "food (game, fish, forage)", field: "the fields", build: "building", haul: "the stores", craft: "the workshops", practice: "the butts" };
const LEARNED_CATS = ["timber", "stone", "ore", "silver", "gold", "food", "firewood"]; // (what the reeve's own allocation can move men between)
const NODE_OF = { timber: ["wood", "coppice"], stone: ["quarry"], ore: ["bog_iron"], silver: ["silver_vein"], gold: ["gold_vein"], food: ["fishery", "hunt", "forage"], firewood: ["coppice", "wood"] };
export const nodeKindsOf = (cat) => NODE_OF[cat] || null;
const underPlayer = (u) => !!(u.ordered || u.broad || (u.job?.b && Number.isInteger(u.job.b.crew) && (u.job.kind === "craft" || u.job.kind === "practice")));

// ---------------------------------------------------------------- the situation
export function situation(w, team) {
  const T = w.teams[team], doy = w.econ?.doy ?? 0;
  const need = Math.max(1, EC.dailyFoodNeed(w, team)), st = T.store || {};
  const lab = {}, mine = {}; let L = 0;
  for (const u of EC.workerUnits(w, team)) {
    const n = u.members.length; if (!n) continue; L += n;
    const c = catOf(u.job) || "home"; lab[c] = (lab[c] || 0) + n;
    if (underPlayer(u) && c !== "home") mine[c] = (mine[c] || 0) + n;
  }
  let threat = 0; const town = T.town;
  if (town) for (const v of w.units.values()) if (v.team !== team && !v.isWorkers && v.members.length && Math.hypot(v.ax - town.x, v.ay - town.y) < 900) { threat = 1; break; }
  return {
    doy: Math.round(((doy % 365) + 365) % 365), food: r1(EC.foodStock(T) / need), timber: Math.round(st.timber || 0), stone: Math.round(st.stone || 0), ore: Math.round(st.ore || 0),
    cash: Math.round((st.silver || 0) + (st.gold || 0) * 12), wages: Math.round(Math.max(50, T.day?.wages || 0)), arrears: Math.round(T.arrears || 0),
    labour: L, lab, mine, threat: threat || T.besieged ? 1 : 0, stage: stageStatus(w, team).reached,
  };
}
// the situation as numbers the learner compares (each about 0..2; the season counts most)
export function vec(s) {
  const a = 2 * Math.PI * s.doy / 365;
  return [Math.cos(a) * 1.4, Math.sin(a) * 1.4, clamp(s.food / 120, 0, 2), clamp(s.timber / 60000, 0, 2), clamp(s.stone / 40000, 0, 2), clamp(s.cash / (s.wages * 60), 0, 2),
    s.arrears > 0 ? 1 : 0, s.threat ? 1 : 0, s.stage / 4, clamp(s.labour / 150, 0, 2)];
}
const dist = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += (a[i] - b[i]) ** 2; return Math.sqrt(d); };
// the k rows nearest situation s among those `keep` accepts → [{ row, d, wt }] (nearest first; ties: the older row first)
export function neighbours(B, s, keep, k = K) {
  const v = vec(s), out = [];
  B.rows.forEach((row, i) => { if (keep(row)) out.push({ row, i, d: dist(v, vec(row.s)) }); });
  out.sort((a, b) => a.d - b.d || a.i - b.i);
  return out.slice(0, k).map((o) => ({ row: o.row, d: o.d, wt: 1 / (0.2 + o.d) }));
}
const confOf = (nb) => clamp(nb.filter((o) => o.d < CLOSE).length / 4, 0, 1);

// ---------------------------------------------------------------- recording (js/game/commands.js apply)
// before the command runs: what the reeve had the men (or the workshop) doing — "what he would have done instead"
export function before(w, team, op, a) {
  if (!LEARN_OPS.has(op)) return null;
  const ids = Array.isArray(a?.ids) ? a.ids : [];
  if (op === "order" || op === "task" || op === "staff") {
    const cats = {}; for (const id of ids) { const u = w.units.get(id); if (u && u.team === team && u.isWorkers && !underPlayer(u)) { const c = catOf(u.job) || "home"; cats[c] = (cats[c] || 0) + u.members.length; } }
    return { cats };
  }
  if (op === "product" || op === "crew") { const b = w.buildings.find((x) => x.id === a?.bid); return b ? { make: b.makeBy === "player" ? null : b.make || null, crew: Number.isInteger(b.crew) ? null : EC.crewOf(w, b).n } : null; }
  return {};
}
// after a successful command: the row (nothing for a march, a fight, a nonsense command)
export function record(w, team, op, a, res, pre) {
  if (!LEARN_OPS.has(op) || !res?.ok || !a) return null;
  const T = w.teams[team]; if (!T?.store) return null;
  let act = null;
  if (op === "order") {
    const o = a.order; if (!o || !["work", "gather", "build"].includes(o.kind)) return null;
    const us = (a.ids || []).map((id) => w.units.get(id)).filter((u) => u && u.team === team && u.isWorkers && u.members.length);
    const by = {}; for (const u of us) { const c = catOf(u.job); if (c) by[c] = (by[c] || 0) + u.members.length; }
    const c = Object.keys(by).sort((x, y) => by[y] - by[x] || (x < y ? -1 : 1))[0]; if (!c) return null;
    act = { what: "work", cat: c, n: by[c] };
  } else if (op === "task") {
    if (a.kind === "home" || a.kind === "patrol") return null;
    const us = (a.ids || []).map((id) => w.units.get(id)).filter((u) => u && u.team === team && u.isWorkers && u.broad);
    const by = {}; for (const u of us) { const c = catOf(u.job); if (c) by[c] = (by[c] || 0) + u.members.length; }
    const c = Object.keys(by).sort((x, y) => by[y] - by[x] || (x < y ? -1 : 1))[0]; if (!c) return null;
    act = { what: "work", cat: c, n: by[c], task: a.kind };
  } else if (op === "staff" || op === "crew") {
    const b = w.buildings.find((x) => x.id === a.bid); if (!b || (op === "crew" && (a.n === null || a.n === undefined))) return null;
    act = { what: "work", cat: b.kind === "archery_range" ? "practice" : "craft", n: Number.isInteger(res.n) ? res.n : a.n | 0, bk: b.kind };
  } else if (op === "place") {
    if (a.kind === "field") return null;
    const hall = w.buildings.find((b) => b.id === T.hall), b = w.buildings.find((x) => x.id === res.bid);
    const have = w.buildings.filter((x) => x.team === team && x.kind === a.kind && !x.ruin && x !== b).length;
    act = { what: "build", kind: a.kind, have, dx: hall && b ? Math.round(b.x - hall.x) : 0, dy: hall && b ? Math.round(b.y - hall.y) : 0 };
  } else if (op === "field") { const b = w.buildings.find((x) => x.id === res.bid); act = { what: "field", ha: r1(b?.field?.ha || 0) }; }
  else if (op === "recruit") act = { what: "recruit", arm: a.arm, n: a.n | 0 || 1 };
  else if (op === "product") { if (a.what === "auto") return null; const b = w.buildings.find((x) => x.id === a.bid); if (!b) return null; act = { what: "product", bk: b.kind, make: a.what }; }
  else if (op === "research") { if (a.cancel) return null; act = { what: "research", id: a.id }; }
  else if (op === "trade") act = { what: "trade", good: a.good, qty: a.qty };
  if (!act) return null;
  const s = situation(w, team);
  if (act.what === "work") act.stock = act.cat === "timber" ? s.timber : act.cat === "stone" ? s.stone : act.cat === "ore" ? s.ore : act.cat === "silver" || act.cat === "gold" ? s.cash : act.cat === "food" ? s.food : undefined;
  let r = null;
  if (pre?.cats) { const c = Object.keys(pre.cats).sort((x, y) => pre.cats[y] - pre.cats[x] || (x < y ? -1 : 1))[0]; r = c ? { cat: c } : null; }
  else if (pre && "make" in pre) r = pre.make ? { make: pre.make } : pre.crew !== null && pre.crew !== undefined ? { crew: pre.crew } : null;
  const B = book(T), row = { t: w.tick, op, a: act, s, r };
  B.rows.push(row); B.n = (B.n || 0) + 1;
  if (B.rows.length > BOOK_MAX) B.rows.splice(0, B.rows.length - BOOK_MAX);
  return row;
}
export function reset(T) { const B = book(T); B.rows.length = 0; B.n = 0; return B; }
export function setOn(T, on) { book(T).on = !!on; }

// ---------------------------------------------------------------- what the reeve takes from it
// labour: { cat: { men (the player's crews on it, in situations like this, scaled to today's labour), conf 0..1 } }
export function allocationTargets(w, team, s = situation(w, team)) {
  const T = w.teams[team]; if (!learning(T) || !T.reeveBook) return null;
  const B = T.reeveBook, out = {};
  for (const c of LEARNED_CATS) {
    const nb = neighbours(B, s, (r) => r.a.what === "work" && (r.s.mine?.[c] || 0) > 0 && r.s.labour > 0);
    if (nb.length < 2) continue;
    let sw = 0, sh = 0; for (const o of nb) { sw += o.wt; sh += o.wt * o.row.s.mine[c] / o.row.s.labour; }
    const conf = confOf(nb); if (!conf) continue;
    out[c] = { men: Math.round(sh / sw * s.labour), conf, rows: nb.length };
  }
  return Object.keys(out).length ? out : null;
}
// the stock the player keeps of res (timber / stone): ~1.5 × the store at which he sends men for it → kg, conf
export function stockTarget(w, team, cat, s = situation(w, team)) {
  const T = w.teams[team]; if (!learning(T) || !T.reeveBook) return null;
  const nb = neighbours(T.reeveBook, s, (r) => r.a.what === "work" && r.a.cat === cat && Number.isFinite(r.a.stock));
  if (nb.length < 2) return null;
  let sw = 0, sk = 0; for (const o of nb) { sw += o.wt; sk += o.wt * o.row.a.stock; }
  return { kg: Math.max(5000, Math.round(1.5 * sk / sw)), conf: confOf(nb) };
}
// what a workshop of kind bk should make, as the player has it make in situations like this → product | null
export function productFor(w, team, bk, s = situation(w, team)) {
  const T = w.teams[team]; if (!learning(T) || !T.reeveBook) return null;
  const nb = neighbours(T.reeveBook, s, (r) => r.a.what === "product" && r.a.bk === bk, 7);
  if (nb.length < 2) return null;
  const vote = new Map(); let sw = 0; for (const o of nb) { vote.set(o.row.a.make, (vote.get(o.row.a.make) || 0) + o.wt); sw += o.wt; }
  const best = [...vote.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  return best && best[1] / sw >= 0.5 && RECIPES[bk]?.[best[0]] ? best[0] : null;
}
// what the player builds at this point: the kind with most weight among the build rows near this situation where he had no
// more of it than we have now (he went on to build another) → { kind, dx, dy, conf } | null
const NEVER_COPY = new Set(["field", "town_hall", "palisade", "stone_wall", "gate", "gatehouse", "tower", "temple"]); // (walls are where he draws them; the keep, the church are given)
export function buildWant(w, team, s = situation(w, team)) {
  const T = w.teams[team]; if (!learning(T) || !T.reeveBook) return null;
  const B = T.reeveBook, have = {};
  for (const b of w.buildings) if (b.team === team && !b.ruin && !b.field) have[b.kind] = (have[b.kind] || 0) + 1;
  const total = {}; for (const r of B.rows) if (r.a.what === "build") total[r.a.kind] = (total[r.a.kind] || 0) + 1;
  const nb = neighbours(B, s, (r) => r.a.what === "build" && !NEVER_COPY.has(r.a.kind) && (total[r.a.kind] || 0) >= 2 && (have[r.a.kind] || 0) <= r.a.have, 8);
  if (!nb.length) return null;
  const score = new Map(); for (const o of nb) { const k = o.row.a.kind, q = score.get(k) || { wt: 0, dx: 0, dy: 0, n: 0, close: 0 }; q.wt += o.wt; q.dx += o.row.a.dx; q.dy += o.row.a.dy; q.n++; if (o.d < CLOSE) q.close++; score.set(k, q); }
  const [kind, q] = [...score.entries()].sort((a, b) => b[1].wt - a[1].wt || (a[0] < b[0] ? -1 : 1))[0];
  if (q.close < 2) return null;
  return { kind, dx: q.dx / q.n, dy: q.dy / q.n, conf: clamp(q.close / 3, 0, 1) };
}
// the size of field the player draws → ha | null
export function fieldHa(w, team) {
  const T = w.teams[team]; if (!learning(T) || !T.reeveBook) return null;
  const hs = T.reeveBook.rows.filter((r) => r.a.what === "field" && r.a.ha > 0).map((r) => r.a.ha);
  return hs.length >= 2 ? clamp(hs.reduce((a, b) => a + b, 0) / hs.length, 1.5, 8) : null;
}

// ---------------------------------------------------------------- the keep's panel: what he has learned, in plain words
const SEASON = (doy) => ["winter", "spring", "summer", "autumn"][Math.floor((((doy + 31) % 365) + 365) % 365 / 91.25) % 4]; // (Dec–Feb winter …)
const PLURAL = { granary: "granaries", house: "houses", lumber_camp: "lumber camps", mining_camp: "mining camps", blacksmith: "smithies", fletcher: "fletchers", weaver: "weavers", barracks: "muster halls", archery_range: "butts",
  stables: "stables", market: "markets", watchtower: "watchtowers", mill: "mills", charcoal_kiln: "charcoal clamps", bloomery: "bloomeries", paddock: "paddocks", siege_workshop: "siege workshops", palisade: "palisades",
  stone_wall: "stone walls", gate: "gates", gatehouse: "gatehouses", temple: "churches", mage_tower: "adepts' towers" };
const plural = (k) => PLURAL[k] || `${(BUILDINGS[k]?.name || k).toLowerCase()}s`;
const SHOP = { blacksmith: "the smithy", fletcher: "the fletcher's", weaver: "the weaver's", siege_workshop: "the siege workshop", charcoal_kiln: "the charcoal clamp", bloomery: "the bloomery" };
const tons = (kg) => kg >= 10000 ? `${Math.round(kg / 1000)} t` : `${r1(kg / 1000)} t`;
export function summary(w, team) {
  const T = w.teams[team], B = T?.reeveBook, on = learning(T), rows = B?.rows || [];
  const lines = [], he = (same, other) => on ? same : other ?? "he is not copying you now";
  // 1. the men he keeps on each kind of work, by season (the crews under his own orders when he gave the order)
  const bySeason = new Map();
  for (const r of rows) if (r.a.what === "work" && LEARNED_CATS.includes(r.a.cat) && r.s.mine?.[r.a.cat] > 0) {
    const key = `${SEASON(r.s.doy)}|${r.a.cat}`, q = bySeason.get(key) || { n: 0, men: 0, share: 0, season: SEASON(r.s.doy), cat: r.a.cat };
    q.n++; q.men += r.s.mine[r.a.cat]; q.share += r.s.mine[r.a.cat] / Math.max(1, r.s.labour); bySeason.set(key, q);
  }
  const L = situation(w, team).labour;
  for (const q of [...bySeason.values()].sort((a, b) => b.n - a.n || (a.season + a.cat < b.season + b.cat ? -1 : 1)).slice(0, 4)) {
    const men = Math.round(q.men / q.n), now = Math.round(q.share / q.n * L);
    lines.push(`You keep ${men} ${men === 1 ? "man" : "men"} on ${CAT_WORD[q.cat]} in ${q.season}; ${he(Math.abs(now - men) <= Math.max(1, men * 0.15) ? "he does the same" : `he keeps about ${now} (the same share of today's ${L} hands)`)}.`);
  }
  // 2. the order he builds in
  const first = new Map(); rows.forEach((r, i) => { if (r.a.what === "build" && !first.has(r.a.kind)) first.set(r.a.kind, i); });
  const seq = [...first.keys()];
  for (let i = 0; i + 1 < seq.length && i < 2; i++) lines.push(`You build ${plural(seq[i])} before ${plural(seq[i + 1])}${i === 0 ? `; ${he("he builds in that order when you leave it to him")}` : ""}.`);
  // 3. the workshops
  const shops = new Map(); for (const r of rows) if (r.a.what === "product") { const m = shops.get(r.a.bk) || new Map(); m.set(r.a.make, (m.get(r.a.make) || 0) + 1); shops.set(r.a.bk, m); }
  for (const [bk, m] of shops) { const tot = [...m.values()].reduce((a, b) => a + b, 0), [best, n] = [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]; if (tot >= 2) lines.push(`At ${SHOP[bk] || (BUILDINGS[bk]?.name || bk).toLowerCase()} you mostly make ${best.replace(/_/g, " ")} (${n} of ${tot} times); ${he("he does too, when it is his to choose")}.`); }
  // 4. stocks
  for (const cat of ["timber", "stone"]) {
    const ks = rows.filter((r) => r.a.what === "work" && r.a.cat === cat && Number.isFinite(r.a.stock)).map((r) => r.a.stock);
    if (ks.length >= 2) { const m = ks.reduce((a, b) => a + b, 0) / ks.length; lines.push(`You send men for ${cat} when the store is near ${tons(m)}; ${he(`he aims to keep about ${tons(Math.max(5000, 1.5 * m))}`)}.`); }
  }
  // 5. fields, musters, studies
  const ha = rows.filter((r) => r.a.what === "field" && r.a.ha > 0).map((r) => r.a.ha);
  if (ha.length >= 2) lines.push(`You draw fields of about ${r1(ha.reduce((a, b) => a + b, 0) / ha.length)} ha; ${he("he lays his the same size")}.`);
  const arms = new Map(); for (const r of rows) if (r.a.what === "recruit") { const q = arms.get(r.a.arm) || { n: 0, men: 0 }; q.n++; q.men += r.a.n; arms.set(r.a.arm, q); }
  const topArm = [...arms.entries()].sort((a, b) => b[1].men - a[1].men || (a[0] < b[0] ? -1 : 1))[0];
  if (topArm) lines.push(`You raise ${(ARMS[topArm[0]]?.name || topArm[0]).toLowerCase()} most (${topArm[1].men} men in ${topArm[1].n} ${topArm[1].n === 1 ? "muster" : "musters"}).`);
  const study = rows.find((r) => r.a.what === "research");
  if (study) lines.push(`You studied ${TECHS[study.a.id]?.name || study.a.id} first.`);
  // 6. where he went against what he would have done
  const differ = rows.filter((r) => r.a.what === "work" && r.r?.cat && r.r.cat !== "home" && r.r.cat !== r.a.cat).length;
  if (differ) lines.push(`${differ} of your work orders took men off work he had set them to; he now leans your way in those seasons.`);
  return { on, n: B?.n || 0, rows: rows.length, max: BOOK_MAX, lines: lines.slice(0, 10) };
}
