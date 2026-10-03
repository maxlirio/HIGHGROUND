// RESEARCH — the technology track (docs/tech.md). Knowledge a lord CHOOSES to pursue, beside the town's growth by
// stages (js/sim/townplan.js STAGES gate buildings by what the vill has built; techs are what it has learned).
//
// Every tech changes something REAL that the sim already computes — no blanket "+10 % to everything":
//   mul.<key>   a multiplier read at one place in the sim (ploughing man-days, crop yield, spoilage, saw rate …)
//   add.<key>   an additive term read at one place (a second research desk, a cottage's room, the rally threshold …)
//   craft[]     a workshop recipe's days / materials / batch, for one product at one building
//   recruit[]   a muster's training / days for some arms
//   unlock      a new product (the smithy's coat of plates) or spell (the Rite of Quenching)
// The places that read them call mul()/add()/craftMul()/recruitMods() below with the team; a team with no research
// (every battle world, the siege mode, a hold not yet founded) has no T.tech, so every read is the identity.
//
// HOW RESEARCH HAPPENS. At the KEEP (the lord's clerk keeps the books and hires the masters): one study at a time per
// town (the Scriptorium adds a second desk). Starting a study PAYS its cost at once (silver + materials from the
// store); it then runs over econ days (halved while the town is invested; stopped if the keep is a ruin). There is NO
// queue: a house studies only what is on its desk(s) now. When a study finishes the desk sits idle until the lord comes
// back and picks the next one — nothing starts by itself, so an absent realm player researches nothing new (the owner:
// "you should NOT be able to queue studying things"). The AI lords (js/sim/ai-general.js) pick their next study when a
// desk frees. Cancelling a study refunds what it cost. State is plain data on the team (T.tech: { done: {id: day},
// active: [{id, t, days, paid}] }) — saved with the world (server/persist.mjs; an old save's `queue` is dropped on
// restore by dropQueues) and sent to the realm client (server/views.mjs team.tech).
//
// Deterministic, DOM-free, no randomness.
import { STAGES, stageStatus } from "./stages.js"; // (no imports there: tech.js is read from labor.js, low in the import graph)
import { estateFx } from "./estates.js"; // the late game's great buildings fold into the same hooks (js/sim/estates.js; it imports only data)

export const BRANCHES = [
  { id: "fields", name: "Husbandry & Fields", blurb: "The plough, the harvest and the flock: more food from the same land and hands." },
  { id: "craft", name: "Craft & Industry", blurb: "Mill-wheels, bellows and saws: the workshops make more from less." },
  { id: "arms", name: "Arms & Tactics", blurb: "Drill, the tiltyard and the engineers: better soldiers and siegecraft." },
  { id: "works", name: "Building & Fortification", blurb: "Masons, roofs, roads and walls: building faster and holding longer." },
  { id: "lore", name: "Learning & the Arcane", blurb: "Clerks, the scriptorium and the adepts' quiet arts." },
];

// cost: silver d (12 d = 1 s) + kg of materials (or items) from the store; days: econ days at one desk;
// stage: the town stage (0 Hamlet … 3 Town) the study needs; needs: techs first; building: a completed building needed.
export const TECHS = {
  // ─────────────────────────────────────────────── Husbandry & Fields
  heavy_plough: { name: "Heavy Mouldboard Plough", branch: "fields", stage: 0, needs: [], days: 6, cost: { silver: 360, iron: 40, timber: 400 },
    mul: { plough: 0.7 },
    effect: "Ox teams plough a hectare in 3.5 man-days instead of 5.",
    desc: "The wheeled plough with coulter, share and mouldboard turns the heavy clay that the old scratch-ard only scored — the plough that opened the wet lowlands of the north." },
  staddles: { name: "Staddle Barns", branch: "fields", stage: 0, needs: [], days: 5, cost: { silver: 240, stone: 3000, timber: 800 },
    mul: { spoil: 0.5 },
    effect: "Grain in the granary and sheaves in the barn spoil half as fast.",
    desc: "Granaries raised on mushroom-capped stone posts: the rats cannot climb them, and the air under the floor keeps the corn dry." },
  marling: { name: "Marling & Folding", branch: "fields", stage: 1, needs: ["heavy_plough"], days: 10, cost: { silver: 600, timber: 200 },
    mul: { yield: 1.12 },
    effect: "Every crop sown from now on yields 12 % more.",
    desc: "Chalky marl dug from pits and spread on sour ground, and the flock folded on the fallow at night — Walter of Henley's counsel for tired land." },
  horse_collar: { name: "Horse Collar & Harness", branch: "fields", stage: 1, needs: ["heavy_plough"], days: 8, cost: { silver: 480, iron: 30, cloth: 10 },
    add: { horsePlough: 1 }, mul: { cart: 1.25 },
    effect: "Horses draw the plough as oxen do (two to a team), and carts move 25 % faster.",
    desc: "The padded rigid collar sits on the shoulders, not the throat: a horse can lean its whole weight into the traces without choking." },
  fleece: { name: "Fleece Breeding", branch: "fields", stage: 1, needs: [], days: 8, cost: { silver: 300, hay: 1000 },
    mul: { wool: 1.4 },
    effect: "Each sheep gives about 1 kg of wool at the June shearing instead of 0.7 kg.",
    desc: "The Cistercian granges bred their flocks for the fleece the Flemish looms paid for — the wool that made England's fortune." },

  // ─────────────────────────────────────────────── Craft & Industry
  collier: { name: "Earth-banked Clamps", branch: "craft", stage: 0, needs: [], days: 4, cost: { silver: 200, timber: 1000 },
    craft: [{ at: "charcoal_kiln", make: "charcoal", batch: 1.25 }],
    effect: "A clamp's 720 kg of wood comes out as 150 kg of charcoal instead of 120.",
    desc: "The collier stacks his billets tight round a chimney and banks the whole with turf and earth, so it chars slowly instead of burning." },
  water_saw: { name: "Water-powered Saw", branch: "craft", stage: 1, needs: [], days: 8, cost: { silver: 600, iron: 40, timber: 2000 },
    mul: { saw: 1.8 },
    effect: "Sawyers at the saw-pit cut 80 % more board per man-day.",
    desc: "A mill-wheel driving a reciprocating blade, the log fed to it on a ratchet — drawn in Villard de Honnecourt's sketchbook about 1235." },
  fulling_mill: { name: "Fulling Mill", branch: "craft", stage: 1, needs: [], building: "mill", days: 8, cost: { silver: 500, timber: 1500, stone: 1000 },
    craft: [{ at: "weaver", make: "cloth", days: 0.6, withBuilding: "mill" }],
    effect: "With a mill standing, a batch of cloth takes the weaver 0.6 days instead of 1.",
    desc: "Water-driven hammers full the cloth that men once trampled in troughs: the first great machine of the English wool trade." },
  water_bellows: { name: "Water-driven Bellows", branch: "craft", stage: 2, needs: [], days: 10, cost: { silver: 900, iron: 60, timber: 1500, stone: 2000 },
    craft: [{ at: "bloomery", make: "iron", needs: 0.8 }],
    effect: "A bloom takes 20 % less ore and charcoal for each kg of iron.",
    desc: "Bellows worked by a water-wheel blow harder and longer than any man: a hotter hearth and a richer bloom." },
  drawn_wire: { name: "Drawn Wire & Riveted Mail", branch: "craft", stage: 2, needs: ["water_bellows"], days: 12, cost: { silver: 1200, iron: 80 },
    craft: [{ at: "blacksmith", make: "mail", days: 0.65 }],
    effect: "A mail shirt takes 26 smith-days to make instead of 40.",
    desc: "Wire pulled through a draw-plate instead of hammered and cut: the rings come faster and truer, ready to be punched and riveted." },
  coat_of_plates: { name: "Coat of Plates", branch: "craft", stage: 3, needs: ["drawn_wire"], days: 16, cost: { silver: 2400, iron: 150, cloth: 20 },
    unlock: { product: { at: "blacksmith", make: "plates" } }, add: { plates: 1 },
    effect: "The smithy can make coats of plates; men-at-arms and knights raised with one fight one armour class heavier.",
    desc: "Iron plates riveted inside a cloth or leather coat over the mail — the armour of Wisby's dead, and the road to full plate." },
  crossbow_shop: { name: "Crossbow Workshop", branch: "craft", stage: 2, needs: [], days: 9, cost: { silver: 800, iron: 40, timber: 600 },
    craft: [{ at: "fletcher", make: "crossbows", days: 0.6 }], recruit: [{ arms: ["crossbow"], days: 0.7 }],
    effect: "A crossbow takes 4.2 days to make instead of 7, and crossbowmen muster in 15 days instead of 21.",
    desc: "Composite prods of horn and sinew, the belt-hook and the goat's-foot lever: a trade of its own, with masters who teach the spanning drill." },

  // ─────────────────────────────────────────────── Arms & Tactics
  pike_drill: { name: "Pike & Spear Drill", branch: "arms", stage: 2, needs: [], days: 8, cost: { silver: 600, timber: 300 },
    recruit: [{ arms: ["levy", "spearmen", "pikemen"], training: 0.1 }],
    effect: "Levies, spearmen and pikemen muster 0.1 better trained (steadier, more skilled).",
    desc: "Close-order drill with the long spear, the schiltron and the hedge of points — what the Scots and the Flemings had that the knights did not expect." },
  assize: { name: "Sunday Butts", branch: "arms", stage: 2, needs: [], days: 8, cost: { silver: 400, staves: 20 },
    mul: { archer: 0.65 },
    effect: "Men practising at the butts become warbow archers in 26 days instead of 40.",
    desc: "The Assize of Arms and Edward III's proclamation of 1363: every able man to shoot at the butts on Sundays and holy days." },
  tiltyard: { name: "Tourney & the Couched Lance", branch: "arms", stage: 2, needs: [], days: 12, cost: { silver: 1500, lances: 10, timber: 1000 },
    mul: { squire: 0.7 }, recruit: [{ arms: ["knights"], training: 0.05 }],
    effect: "A squire is ready to be knighted in 42 days instead of 60; knights muster a little better trained.",
    desc: "The tourney and the lists, the lance couched under the arm so horse and rider strike as one — a knight's whole schooling." },
  banners: { name: "Banners & Trumpets", branch: "arms", stage: 2, needs: ["pike_drill"], days: 10, cost: { silver: 900, cloth: 30 },
    add: { rally: 0.12 },
    effect: "Men who have fled rally sooner: they stop and re-form below stress 0.72 instead of 0.6.",
    desc: "A banner every company knows and the trumpet that calls it: scattered men have somewhere to run TO." },
  counterweight: { name: "Counterweight Trebuchet", branch: "arms", stage: 2, needs: [], building: "siege_workshop", days: 14, cost: { silver: 1800, iron: 100, timber: 3000, rope: 40 },
    craft: [{ at: "siege_workshop", make: "trebuchet_gear", days: 0.6, needs: 0.8 }],
    effect: "A trebuchet's ironwork, axle and sling take 40 % less time and 20 % less material.",
    desc: "A master engineer who knows the hinged counterweight and the sling's release: the engine that took Stirling in 1304." },
  heraldry: { name: "Heralds & the Round Table", branch: "arms", stage: 4, needs: ["tiltyard"], days: 16, cost: { silver: 3000, cloth: 30, lances: 20 },
    recruit: [{ arms: ["knights"], training: 0.05 }],
    effect: "Knights muster 0.05 better trained, and the Tiltyard & Lists can be built (the Cathedral City stage).",
    desc: "Kings of arms who know every coat in the realm, and Edward I's Round Table feasts: the tournament becomes the school and the show of chivalry." },
  sapping: { name: "Sapping & Countermining", branch: "arms", stage: 2, needs: ["counterweight"], days: 12, cost: { silver: 1200, iron: 60, timber: 2000 },
    mul: { sap: 1.5 },
    effect: "Your miners drive galleries and counter-galleries 50 % faster.",
    desc: "Miners from the Forest of Dean and the lead-dales, who know how to prop a gallery and fire it — Rochester's forty fat pigs." },

  // ─────────────────────────────────────────────── Building & Fortification
  jettied: { name: "Jettied Timber Framing", branch: "works", stage: 1, needs: [], days: 7, cost: { silver: 400, timber: 2000 },
    add: { housePop: 1 },
    effect: "Every cottage shelters 6 people instead of 5 (a loft over the hall).",
    desc: "Box-framed houses with an upper floor jutting over the street: more room on the same plot." },
  tile_roofs: { name: "Tile Roofs & Firebreaks", branch: "works", stage: 1, needs: ["collier"], days: 8, cost: { silver: 600, stone: 2000, timber: 500 },
    mul: { fire: 0.5 },
    effect: "Your buildings take fire half as readily (sparks, torches and raiders' brands).",
    desc: "After the great fire of 1212 London forbade new thatch by the bridge: kiln-fired tiles and stone party walls." },
  roads: { name: "Causeways & Bridges", branch: "works", stage: 1, needs: [], days: 12, cost: { silver: 1200, stone: 8000, timber: 3000 },
    mul: { haul: 1.15 },
    effect: "Everything carried by man, packhorse or cart moves 15 % faster.",
    desc: "Stone causeways over the wet ground and bridges where there were fords: the carts no longer wait for the water to fall." },
  lime_mortar: { name: "Lime Mortar & Ashlar", branch: "works", stage: 2, needs: [], days: 10, cost: { silver: 900, stone: 6000, timber: 1000 },
    add: { masonGang: 2 },
    effect: "Each mason keeps 7 labourers working on stone instead of 5: stone buildings and walls rise faster.",
    desc: "Lime burnt in kilns and slaked in pits, and banker-masons who square ashlar: the craft of the cathedral lodges." },
  machicolations: { name: "Machicolations", branch: "works", stage: 3, needs: ["lime_mortar"], days: 14, cost: { silver: 1500, stone: 10000, timber: 1000 },
    add: { machicolated: 1 },
    effect: "Your stone walls drop stones on men at their foot as fast as from hoardings (three times a bare parapet).",
    desc: "Stone hoardings: the parapet carried out on corbels, with holes in its floor to drop stones and worse straight down the wall's face." },
  rib_vault: { name: "Rib Vaults & Flying Buttresses", branch: "works", stage: 4, needs: ["lime_mortar"], days: 20, cost: { silver: 3000, stone: 20000, timber: 4000 },
    add: { masonGang: 1 },
    effect: "Each mason keeps one more labourer at work on stone, and the Minster can be raised (the Cathedral City stage).",
    desc: "The pointed rib vault carries its weight down to piers and out along flying buttresses: walls become glass, as at Salisbury, Amiens and Lincoln." },
  concentric: { name: "Concentric Design", branch: "works", stage: 3, needs: ["machicolations"], days: 18, cost: { silver: 2400, stone: 20000 },
    mul: { wallHp: 1.3 },
    effect: "Stone curtains and gatehouses raised from now on are 30 % stronger.",
    desc: "A battered talus at the foot, thicker curtains and every stretch flanked: the lessons of Krak and Acre brought home to Wales." },

  // ─────────────────────────────────────────────── Learning & the Arcane
  clerks: { name: "Clerks & Tally-sticks", branch: "lore", stage: 0, needs: [], days: 6, cost: { silver: 300, timber: 100 },
    mul: { rents: 1.12 },
    effect: "Rents and dues bring in 12 % more (fewer escape the roll).",
    desc: "Split hazel tallies, a reeve's account rolled and audited every Michaelmas: the Exchequer's way, brought to the manor." },
  scriptorium: { name: "Scriptorium", branch: "lore", stage: 1, needs: ["clerks"], days: 12, cost: { silver: 1200, timber: 1500, cloth: 10 },
    add: { desks: 1 },
    effect: "A second desk at the keep: two studies can run at once.",
    desc: "A chaplain with two clerks copying the treatises the masters bring — the Hereford map, Grosseteste, Bacon's letters." },
  royal_mint: { name: "Licence to Coin", branch: "lore", stage: 4, needs: ["clerks"], days: 14, cost: { silver: 2400, gold: 20, iron: 50 },
    mul: { rents: 1.05 },
    effect: "Rents and dues are reckoned in good sterling (+5 %), and the Mint can be built.",
    desc: "The king's writ to keep dies and moneyers: a great lord's own pennies, struck to the sterling standard at Canterbury's and Durham's rates." },
  studium: { name: "Studium Generale", branch: "lore", stage: 5, needs: ["scriptorium"], days: 24, cost: { silver: 4000, cloth: 40 },
    mul: { study: 1.1 },
    effect: "Every study runs 10 % faster, and a College can be founded.",
    desc: "Masters licensed to teach anywhere, a hall for the scholars and a chest for the books: the beginnings of Oxford, Cambridge and Paris." },
  ley_lore: { name: "Ley Lore", branch: "lore", stage: 1, needs: [], days: 10, cost: { silver: 600, mana: 10 },
    mul: { mana: 1.5 }, add: { manaCap: 40 },
    effect: "Adepts draw mana 50 % faster at a ley line, and the store holds 40 more.",
    desc: "Old songs about the standing stones, written down at last: where the lines cross, and what hours to sit by them." },
  quench: { name: "Rite of Quenching", branch: "lore", stage: 1, needs: ["ley_lore"], days: 8, cost: { silver: 400, mana: 25 },
    unlock: { spell: "quench" },
    effect: "A new working: Quench puts out every fire within 40 m (15 mana).",
    desc: "A hedge-witch's charm against the red cock on the roof: the flames gutter and die as if drenched." },
};
export const TECH_IDS = Object.keys(TECHS);
// the tree's depth (column): 0 for a root, 1 + the deepest prerequisite otherwise
export const TIER = {};
{ const tier = (id) => TIER[id] ?? (TIER[id] = TECHS[id].needs.length ? 1 + Math.max(...TECHS[id].needs.map(tier)) : 0); TECH_IDS.forEach(tier); }

// what a recipe or spell needs before it can be used (economy.setProduct / castSpell, the panels)
export const PRODUCT_TECH = {}; export const SPELL_TECH = {};
for (const [id, t] of Object.entries(TECHS)) { if (t.unlock?.product) PRODUCT_TECH[`${t.unlock.product.at}.${t.unlock.product.make}`] = id; if (t.unlock?.spell) SPELL_TECH[t.unlock.spell] = id; }

// ─────────────────────────────────────────────── the export the handbook reads
// → [{ id, name, branch, branchName, tier, stage, stageName, needs: [names], building, days, cost, effect, desc }]
export function techList() {
  return TECH_IDS.map((id) => { const t = TECHS[id];
    return { id, name: t.name, branch: t.branch, branchName: BRANCHES.find((b) => b.id === t.branch).name, tier: TIER[id], stage: t.stage, stageName: STAGES[t.stage]?.name,
      needs: t.needs.map((n) => TECHS[n].name), building: t.building || null, days: t.days, cost: { ...t.cost }, effect: t.effect, desc: t.desc }; });
}

// ─────────────────────────────────────────────── reads (the sim's hook points)
const techOf = (w, team) => w?.teams?.[team]?.tech || null;
export const has = (w, team, id) => !!techOf(w, team)?.done?.[id];
// the combined effects of what this team has learned, cached on the count of techs done (not saved: rebuilt on read)
const FX = new WeakMap();
function fxOf(tech) {
  const done = tech.done || {}, n = Object.keys(done).length, c = FX.get(tech);
  if (c && c.n === n) return c;
  const fx = { n, mul: {}, add: {}, craft: [], recruit: [] };
  for (const id of Object.keys(done)) {
    const t = TECHS[id]; if (!t) continue;
    for (const [k, v] of Object.entries(t.mul || {})) fx.mul[k] = (fx.mul[k] ?? 1) * v;
    for (const [k, v] of Object.entries(t.add || {})) fx.add[k] = (fx.add[k] ?? 0) + v;
    for (const c2 of t.craft || []) fx.craft.push(c2);
    for (const r of t.recruit || []) fx.recruit.push(r);
  }
  FX.set(tech, fx); return fx;
}
export function mul(w, team, key) { const t = techOf(w, team), e = estateFx(w, team).mul[key] ?? 1; return t ? (fxOf(t).mul[key] ?? 1) * e : e; } // (× the great buildings standing: js/sim/estates.js)
export function add(w, team, key) { const t = techOf(w, team), e = estateFx(w, team).add[key] ?? 0; return t ? (fxOf(t).add[key] ?? 0) + e : e; }
const standing = (w, team, kind) => w.buildings?.some((b) => b.team === team && b.kind === kind && b.progress >= 1 && !b.ruin);
// a workshop recipe's multipliers for one product at one building: { days, needs, batch } (all 1 without research)
export function craftMul(w, team, at, make) {
  const out = { days: estateFx(w, team).mul.craft ?? 1, needs: 1, batch: 1 }, t = techOf(w, team); if (!t) return out; // (the guildhall's masters: every recipe's days — js/sim/estates.js)
  for (const c of fxOf(t).craft) {
    if (c.at !== at || c.make !== make || (c.withBuilding && !standing(w, team, c.withBuilding))) continue;
    out.days *= c.days ?? 1; out.needs *= c.needs ?? 1; out.batch *= c.batch ?? 1;
  }
  return out;
}
// a muster's changes for an arm: { training (added), days (multiplier) }
export function recruitMods(w, team, arm) {
  const out = { training: 0, days: 1 }, t = techOf(w, team); if (!t) return out;
  for (const r of fxOf(t).recruit) if (r.arms.includes(arm)) { out.training += r.training || 0; out.days *= r.days ?? 1; }
  return out;
}
export const productOpen = (w, team, at, make) => { const id = PRODUCT_TECH[`${at}.${make}`]; return !id || has(w, team, id); };
export const spellOpen = (w, team, kind) => { const id = SPELL_TECH[kind]; return !id || has(w, team, id); };

// ─────────────────────────────────────────────── the research itself
export function techState(T) { return (T.tech ||= { done: {}, active: [] }); }
// MIGRATION: worlds saved while research had a queue may carry T.tech.queue. Drop it (nothing in it was paid for: the
// cost is taken only when a study starts); the studies on the desks carry on. → how many queued studies were dropped
export function dropQueues(w) {
  let n = 0;
  for (const T of w?.teams || []) if (T?.tech && "queue" in T.tech) { n += Array.isArray(T.tech.queue) ? T.tech.queue.length : 0; delete T.tech.queue; }
  return n;
}
export const desks = (w, team) => 1 + add(w, team, "desks");
export const deskFree = (w, team) => (w.teams[team]?.tech?.active?.length || 0) < desks(w, team);
const keepOf = (w, T) => w.buildings?.find((b) => b.id === T.hall) || null;
const keepWorks = (w, T) => { const k = keepOf(w, T); return !!k && k.progress >= 1 && !k.ruin; };
const short = (T, cost) => Object.entries(cost).find(([r, n]) => (T.store?.[r] || 0) < n)?.[0] || null;

// why this team cannot start `id` now (null = it can). `paying: false` ignores the cost (open vs locked, for the tree).
// (A busy desk is not a reason here: deskFree() says that.)
export function whyNot(w, team, id, { paying = true } = {}) {
  const t = TECHS[id], T = w.teams[team];
  if (!t) return "No such study";
  if (!T?.store) return "No town to study in";
  const S = techState(T);
  if (S.done[id]) return "Already learned";
  if (S.active.some((a) => a.id === id)) return "Being studied";
  if (!keepWorks(w, T)) return "The keep must stand to keep a clerk";
  const miss = t.needs.filter((n) => !S.done[n]);
  if (miss.length) return `Needs ${miss.map((n) => TECHS[n].name).join(" and ")}`;
  if (t.stage > 0 && stageStatus(w, team).reached < t.stage) return `Needs the ${STAGES[t.stage].name} stage`;
  if (t.building && !standing(w, team, t.building)) return `Needs a ${buildingName(t.building)}`;
  if (paying) { const r = short(T, t.cost); if (r) return `Not enough ${r} (${Math.round(T.store[r] || 0)} of ${t.cost[r]})`; }
  return null;
}
const BNAME = { mill: "Mill", siege_workshop: "Siege Workshop", bloomery: "Bloomery", mage_tower: "Adepts' Tower" };
const buildingName = (k) => BNAME[k] || k.replace(/_/g, " ");

// start a study now (pays its cost) → true. Not if no desk is free or whyNot says no.
export function start(w, team, id) {
  const T = w.teams[team], S = techState(T);
  if (S.active.length >= desks(w, team) || whyNot(w, team, id)) return false;
  for (const [r, n] of Object.entries(TECHS[id].cost)) T.store[r] = Math.max(0, (T.store[r] || 0) - n);
  S.active.push({ id, t: 0, days: TECHS[id].days, paid: { ...TECHS[id].cost } });
  w.events?.push({ t: w.tick, kind: "research-start", team, tech: id });
  return true;
}
// the player's command: study it now — a desk must be free and the store able to pay; otherwise it is refused (there is
// no queue). → { ok, started, error }
export function order(w, team, id) {
  const T = w.teams[team]; if (!TECHS[id]) return { ok: false, error: "No such study" };
  if (!T?.store) return { ok: false, error: "No town to study in" };
  const S = techState(T);
  if (S.done[id]) return { ok: false, error: "Already learned" };
  if (S.active.some((a) => a.id === id)) return { ok: false, error: "Already being studied" };
  if (!deskFree(w, team)) return { ok: false, error: desks(w, team) > 1 ? "Both desks are busy" : "The desk is busy" };
  const why = whyNot(w, team, id); if (why) return { ok: false, error: why };
  return start(w, team, id) ? { ok: true, started: true } : { ok: false, error: "Cannot start it now" };
}
// abandon a study (its cost comes back to the store) → true if anything changed
export function cancel(w, team, id) {
  const T = w.teams[team], S = T?.tech; if (!S) return false;
  const k = S.active.findIndex((a) => a.id === id); if (k < 0) return false;
  const a = S.active.splice(k, 1)[0];
  for (const [r, n] of Object.entries(a.paid || {})) T.store[r] = (T.store[r] || 0) + n;
  w.events?.push({ t: w.tick, kind: "research-cancel", team, tech: id });
  return true;
}
// the study's speed (desk-days per econ day): halved while the town is invested, nothing without a standing keep
export function rate(w, T) { if (T.fallen || !keepWorks(w, T)) return 0; return (T.besieged ? 0.5 : 1) * mul(w, T.id, "study"); } // (the Studium Generale, the college: js/sim/estates.js)

// per tick, from economy.economySystem: progress every study and finish what is done. A freed desk stays idle: nothing
// starts here (the player picks the next study; an AI lord's general does it for him)
export function researchTick(w, T, dt) {
  const S = T.tech; if (!S || !S.active.length) return;
  const r = rate(w, T);
  for (let k = S.active.length - 1; k >= 0; k--) {
    const a = S.active[k]; a.t += dt * r;
    if (a.t >= a.days) {
      S.active.splice(k, 1); S.done[a.id] = Math.max(1, Math.round(w.econ?.doy ?? 1)); // (the day it was learned; never 0)
      w.events?.push({ t: w.tick, kind: "research-done", team: T.id, tech: a.id });
    }
  }
}

// days left on a study at the current rate (Infinity while stopped)
export function daysLeft(w, T, a) { const r = rate(w, T); return r > 0 ? Math.max(0, (a.days - a.t) / r) : Infinity; }
// a status for each tech, for the tree panel: done | active | open | locked (+ why)
export function statusOf(w, team, id) {
  const T = w.teams[team], S = T?.tech || { done: {}, active: [] };
  if (S.done[id]) return { s: "done" };
  const a = S.active.find((x) => x.id === id); if (a) return { s: "active", p: a.t / a.days, left: daysLeft(w, T, a) };
  const why = whyNot(w, team, id, { paying: false });
  if (why) return { s: "locked", why };
  return { s: "open", why: whyNot(w, team, id) }; // (open: learnable now; why = what the store lacks, if anything)
}
