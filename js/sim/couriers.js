// Couriers: one villager sent on foot to another house's keep with a letter (the owner: "select a serf and send him as a
// courier to another house with a message"). The journey is real — he walks there at a villager's pace by the ordinary
// order and path, the letter is delivered only when he stands at their keep, then he walks home and rejoins the
// household. Killed on the road, the letter is lost and his house is told. DOM-free; plain data on the world (saved
// with it):
//   w.couriers = [{ id, unit, man, from, to, text, state: "out" | "back", t0, best, bestT, tries }]
//   w.letters  = { [team]: [{ id, from, fromName, text, tick, doy }] }   (the letters a house has received, newest last)
// Events (w.log): { kind: "courier", team, text, tone, x, y, letter? } — one per house told; `letter` on the recipient's.
// The courier's crew carries u.courier = id and u.ordered = true: the reeve, the warden and the recruiters leave him be
// (economy.js econPass / releaseWorkers). Any other order the player gives him calls the errand off (commands.js endHunt).
import { issueOrder, splitUnit } from "./world.js";
import * as EC from "./economy.js";

export const LETTER_MAX = 500;      // characters
const LETTERS_KEPT = 100;           // per house
const ARRIVE_M = 60;                // at the keep: this near its middle
const STAND_M = 24;                 // where he is sent: this far short of the keep's middle, on his side
const STUCK_S = 90;                 // no headway for this long: the order is given again …
const TRIES = 4;                    // … this many times, then he gives it up
const CHECK = 10;                   // ticks between checks (1 s)

export const cleanLetter = (s) => typeof s === "string" ? s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim().slice(0, LETTER_MAX) : "";
export const houseName = (w, t) => { const n = w.teams[t]?.name; return n ? (/^house\b/i.test(n) ? n : `House ${n}`) : `house ${t + 1}`; };
const keepOf = (w, t) => { const T = w.teams[t]; if (!T || T.fallen || !T.town) return null; const h = w.buildings.find((b) => b.id === T.hall && !b.ruin); return h ? { x: h.x, y: h.y } : { x: T.town.x, y: T.town.y }; };
const toN = (w, c) => c.toName || houseName(w, c.to), fromN = (w, c) => c.fromName || houseName(w, c.from);
const tell = (w, team, text, o = {}) => w.log.push({ t: w.tick, kind: "courier", team, text, tone: o.tone, x: o.x, y: o.y, ...(o.letter ? { letter: o.letter } : {}) });
const quote = (s) => { const one = s.replace(/\s+/g, " "); return one.length > 160 ? one.slice(0, 157) + "…" : one; };

function sendTo(w, u, k) { // walk to a keep: a spot just short of it on his side
  const d = Math.hypot(u.ax - k.x, u.ay - k.y) || 1, f = Math.min(1, STAND_M / d);
  issueOrder(w, [u.id], { kind: "move", x: k.x + (u.ax - k.x) * f, y: k.y + (u.ay - k.y) * f, pace: "march", courier: true });
}

// send one villager of `unit` (team `team`) to house `to`'s keep with `text`. names: { toName, fromName } — how the
// single-player shell calls the houses ("the lord of Rookham": its teams have no house names); the realm's are its houses'.
// → { ok, msg, id, eta } | { ok: false, error }
export function sendCourier(w, team, unit, to, text, names = {}) {
  const u = w.units.get(unit);
  if (!u || u.team !== team || !u.isWorkers || !u.members.length) return { ok: false, error: "Select a villager to send" };
  if (u.convoy) return { ok: false, error: "He is carting for the army" };
  if (u.courier !== undefined && u.courier !== null) return { ok: false, error: "He is already on the road as a courier" };
  if (!Number.isInteger(to) || to === team || !w.teams[to]) return { ok: false, error: "Choose another house" };
  const k = keepOf(w, to); if (!k) return { ok: false, error: w.teams[to]?.fallen ? `${houseName(w, to)} has fallen: nobody is left to read it` : "Nobody holds those lands" };
  const msg = cleanLetter(text); if (!msg) return { ok: false, error: "Write the message first" };
  // one man goes: the first of the crew (the rest stay at their work)
  const man = u.members.find((i) => w.S.alive[i]); if (man === undefined) return { ok: false, error: "Select a villager to send" };
  const c = u.members.length === 1 ? u : splitUnit(w, u, [man]);
  if (w.chains) w.chains = w.chains.filter((q) => !q.units.includes(c.id));
  c.hunt = null; c.broad = null; c.helping = null; c.burning = null; c.picked = false; c.ordered = true;
  const id = (w.courierSeq = (w.courierSeq || 0) + 1);
  c.courier = id;
  const nm = (v) => typeof v === "string" && v.trim() ? v.trim().slice(0, 48) : undefined;
  (w.couriers ||= []).push({ id, unit: c.id, man, from: team, to, text: msg, state: "out", t0: w.tick, best: Infinity, bestT: w.time, tries: 0, toName: nm(names.toName), fromName: nm(names.fromName) });
  sendTo(w, c, k);
  const d = Math.hypot(c.ax - k.x, c.ay - k.y), eta = Math.max(1, Math.round(d / 1.0 / 60)); // (a villager on the road makes about 1 m/s, paths and slopes included: tools/courier-test.mjs)
  return { ok: true, id, unit: c.id, eta, msg: `A courier sets out for ${nm(names.toName) || houseName(w, to)} — about ${eta} minute${eta === 1 ? "" : "s"} on foot` };
}

function deliver(w, c, u) {
  const L = { id: c.id, from: c.from, fromName: fromN(w, c), text: c.text, tick: w.tick, doy: Math.floor(w.econ?.doy ?? 0) };
  const box = ((w.letters ||= {})[c.to] ||= []); box.push(L); if (box.length > LETTERS_KEPT) box.splice(0, box.length - LETTERS_KEPT);
  tell(w, c.to, `A courier from ${L.fromName}: "${quote(c.text)}"`, { tone: "good", x: u.ax, y: u.ay, letter: L });
  tell(w, c.from, `Your courier has reached ${toN(w, c)} and given them your letter; he turns for home`, { tone: "good", x: u.ax, y: u.ay });
}
function finish(w, c, u) { // home again: back to the household's work
  u.courier = null; u.ordered = false;
  tell(w, c.from, "Your courier is home again", { x: u.ax, y: u.ay });
  EC.releaseWorkers(w, u);
}

// every tick (cheap: nothing to do without couriers on the road)
export function courierSystem(w) {
  const L = w.couriers; if (!L?.length || w.tick % CHECK) return;
  for (const c of L.slice()) {
    const u = w.units.get(c.unit), drop = () => { w.couriers = w.couriers.filter((q) => q !== c); };
    if (!w.S.alive[c.man]) { // killed on the road
      if (c.state === "out") tell(w, c.from, `Your courier to ${toN(w, c)} was killed on the road — the letter is lost`, { tone: "bad", x: w.S.x[c.man], y: w.S.y[c.man] });
      else tell(w, c.from, `Your courier was killed on the way home from ${toN(w, c)}`, { tone: "bad", x: w.S.x[c.man], y: w.S.y[c.man] });
      if (u && u.courier === c.id) u.courier = null;
      drop(); continue;
    }
    if (!u || !u.members.includes(c.man) || u.courier !== c.id) { // the player gave him other orders (or folded him into a crew)
      if (u && u.courier === c.id) u.courier = null;
      if (c.state === "out") tell(w, c.from, `Your courier to ${toN(w, c)} was called back: the letter was not delivered`, { x: w.S.x[c.man], y: w.S.y[c.man] });
      drop(); continue;
    }
    const k = c.state === "out" ? keepOf(w, c.to) : keepOf(w, c.from);
    if (!k) {
      if (c.state === "out") { tell(w, c.from, `Your courier found nobody to take your letter at ${toN(w, c)}: he turns for home`, { x: u.ax, y: u.ay }); c.state = "back"; c.best = Infinity; c.bestT = w.time; c.tries = 0; const h = keepOf(w, c.from); if (h) sendTo(w, u, h); else { u.courier = null; u.ordered = false; drop(); } }
      else { u.courier = null; u.ordered = false; drop(); }
      continue;
    }
    const d = Math.hypot(u.ax - k.x, u.ay - k.y);
    if (d <= ARRIVE_M) {
      if (c.state === "out") { deliver(w, c, u); c.state = "back"; c.best = Infinity; c.bestT = w.time; c.tries = 0; const h = keepOf(w, c.from); if (h) sendTo(w, u, h); else { u.courier = null; u.ordered = false; drop(); } }
      else { finish(w, c, u); drop(); }
      continue;
    }
    if (d < c.best - 2) { c.best = d; c.bestT = w.time; continue; }
    const idle = !u.path && !u.moving && !u.pendingOrder;
    if ((idle && w.time - c.bestT > 8) || w.time - c.bestT > STUCK_S) { // stopped short, or no headway: the way is asked again
      if (++c.tries > TRIES) {
        if (c.state === "out") { tell(w, c.from, `Your courier could find no way to ${toN(w, c)}: he comes home with the letter`, { tone: "bad", x: u.ax, y: u.ay }); c.state = "back"; c.best = Infinity; c.bestT = w.time; c.tries = 0; const h = keepOf(w, c.from); if (h) sendTo(w, u, h); else { u.courier = null; u.ordered = false; drop(); } }
        else { finish(w, c, u); drop(); } // (he cannot get home either: back to the reeve where he stands)
        continue;
      }
      c.bestT = w.time; sendTo(w, u, k);
    }
  }
}
