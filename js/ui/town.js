// Town interface: resource bar, building panel (recruit / workshop / status) and the build menu.
// Everything here reads and calls the economy (js/sim/economy.js); nothing is faked in the UI.
import * as EC from "../sim/economy.js";
import { marketHTML, bindMarket, duesHTML, sellHTML, bindSell } from "./market-ui.js";
import { whyHTML } from "./workshop-why.js";
import { recruitWhy, rolesOf } from "./recruit-why.js"; // (why a company can't be raised, and how to fix it)
import { ARMS } from "../sim/arms.js";
import { MOUNTS, MOUNT_ID, mountFits } from "../sim/mounts.js";
import { glyphSVG, wxBadge } from "./glyphs.js";
import { landAt, buildEffects } from "../sim/land.js";
import { STAGES, stageStatus, stageOfKind } from "../sim/townplan.js";
import * as TC from "../sim/tech.js";
import * as LE from "../sim/estates.js"; // the late game's great buildings: what each does, and why one may not be built yet
import { keepResearchHTML } from "./tech.js";
import * as RL from "../sim/reeve-learn.js"; // the learning reeve: what he has learned from the player (the keep's panel)
import { demolishHTML, bindDemolish } from "./demolish-ui.js"; // "Pull it down", "Rebuild in stone" (js/sim/demolish.js)
import { GOLD, MERCS, mercHire, mercDay } from "../sim/econ-data.js"; // (what gold buys: the top bar's Gold tip — js/sim/gold.js)

const kg = (v) => v >= 10000 ? `${(v / 1000).toFixed(0)} t` : v >= 1000 ? `${(v / 1000).toFixed(1)} t` : `${Math.round(v)} kg`;
const n0 = (v) => Math.round(v || 0).toLocaleString();
const SEASON = (doy) => ["Winter", "Spring", "Summer", "Autumn"][Math.floor(((doy + 10) % 365) / 91.25) % 4];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateOf = (doy) => { const d = new Date(2026, 0, 1 + Math.floor(doy)); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };

export function renderResourceBar(el, w, team) {
  const T = w.teams[team]; if (!T.store) return;
  const s = T.store, food = EC.foodStock(T);
  const need = EC.dailyFoodNeed?.(w, team) || 1;
  const hc = EC.headcount?.(w, team);
  const items = [
    ["Food", `${kg(food)} · ${Math.floor(food / need)} days`, food / need < 20 ? "warn" : ""],
    ["Silver", `${n0(s.silver)} d`], ["Gold", `${n0(Math.floor(s.gold || 0))} s`, "", goldTip(w, team)], ["Timber", kg(s.timber || 0)], ["Stone", kg(s.stone || 0)],
    ["Iron", kg(s.iron || 0)], ["Arrows", n0(s.arrows)], ["Mana", n0(s.mana)],
    ["People", hc ? n0(hc.labour + hc.soldiers + (T.dependants || 0) + (T.squires || 0)) : "—", "people"], // (as the keep's panel counts them: economy.js growthInfo)
  ];
  const G = growthOf(w, team);
  const wx = w.wx ? `<span class="date wx" title="One sky over the vale (docs/weather.md)${w.wx.windFrom && w.wind ? ` · wind from the ${w.wx.windFrom}` : ""}"><b>${wxBadge(w.weather)}</b>${w.wx.wet > 0.45 ? "mud" : w.wx.snowCover > 0.3 ? "snow lies" : ""}</span>` : "";
  el.innerHTML = items.map(([k, v, c, tip]) => c === "people" ? `<span class="people" data-people title="${peopleTip(G)}"><b>${k}</b>${v}${G ? ` <i class="${G.rate > 0 ? "up" : "stall"}">${G.rate > 0 ? "▲" : "■"}</i>` : ""}</span>` : `<span class="${c || ""}"${tip ? ` title="${tip}"` : ""}><b>${k}</b>${v}</span>`).join("")
    + `<span class="date"><b>${SEASON(w.econ.doy)}</b>${dateOf(w.econ.doy)}</span>` + wx;
}

// what gold buys (js/sim/gold.js), for the top bar's Gold: the market's Gold section, the great works, the mint
function goldTip(w, team) {
  const T = w.teams[team], bill = (T?.mercs?.list || []).reduce((s, c) => s + mercDay(c.kind, c.n), 0);
  return (`Gold, in shillings. It buys, at a Market: silver from the money-changer (about ${GOLD.sell} d the shilling; his gold costs ${GOLD.buy} d), `
    + `hired companies (${Object.entries(MERCS).map(([k, M]) => `${M.name} ${mercHire(k)} s`).join(", ")}; paid in gold daily), and destriers, mail and coats of plates (sold only for gold). `
    + `Also the Minster's shrine, the Palace's gilding, the Studium's bull, the Licence to Coin, a legend's promotion and a ransom; the Mint strikes it into pennies. `
    + `Wages and the silver market take it at 12 d when the silver runs out.${bill ? ` Your hired companies draw ${bill.toFixed(1)} s a day.` : ""}`).replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------- where the people come from (economy.js growthInfo)
// in the realm the server reckons it (server/views.mjs: the team's `growth`); single-player reads the sim
const growthOf = (w, team) => { const T = w.teams[team]; return T?.growth !== undefined ? T.growth : T?.store && w.econ?.role instanceof Map ? EC.growthInfo(w, team) : null; };
const f1 = (v) => v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
const etaText = (d) => d < 1 ? "within the day" : `in about ${Math.ceil(d)} day${Math.ceil(d) === 1 ? "" : "s"}`;
function peopleTip(G) {
  if (!G) return "Your people";
  const fam = G.rate > 0 ? `Families arriving: about ${f1(G.rate)} a day (next ${etaText(G.eta)})` : `No families arriving: ${G.why.map((x) => x.text).join("; ")}`;
  return `${G.pop} people · room for ${G.cap} (${Math.max(0, G.empty)} empty places) · births ≈ ${f1(G.birthsYear)} a year · ${fam}. Click: the keep`.replace(/"/g, "&quot;");
}
export function growthHTML(G) {
  if (!G) return "";
  let h = `<div class="sub">Your people</div><div class="growth">`;
  h += `<div class="row"><b>${G.pop}</b> people · housing for <b>${G.cap}</b> · <b class="${G.empty >= 5 ? "ok" : "warn"}">${Math.max(0, G.empty)}</b> empty place${G.empty === 1 ? "" : "s"}</div>`;
  h += `<div class="row small">Born: about <b>${f1(G.birthsYear)}</b> a year · died of age: about ${f1(G.deathsYear)} a year · come of age (to work): about ${f1(G.comeOfAgeYear || 0)} a year</div>`;
  if (G.rate > 0) h += `<div class="row small fam ok">Families arriving: about <b>${f1(G.rate)}</b> a day (${G.family} people each, 2 of them workers) · next family <b>${etaText(G.eta)}</b></div>`;
  else h += `<div class="row small fam warn">No families arriving:<ul>${G.why.map((x) => `<li>${x.text}</li>`).join("")}</ul></div>`;
  if (G.leavingDay > 0) h += `<div class="row small warn">Unrest is driving about ${f1(G.leavingDay)} people a day away</div>`;
  h += `<div class="row small hint">No building trains villagers. Your people grow by <b>births</b> and by landless <b>families</b> who move in when a home stands empty (a Cruck House holds ${G.perHouse}, the keep ${G.keepPop}${G.camp > 0 ? `, the settlers' camp ${G.camp} more for now` : ""}), with more than 20 days of food and unrest under 35%. Build cottages to grow.</div>`;
  return h + `</div>`;
}

// ---------------------------------------------------------------- a workshop: what it makes and who works it
// In the realm a choice goes to the server and comes back with its state: until then the panel shows what was clicked (an
// optimistic update), and the server's state confirms it (or, if refused or not confirmed in 5 s, what the server says).
const PEND = new Map(); // building id → { make?, makeBy?, ord?, crew?, until }
const QTY = new Map(); // building id → how many the next product click orders (null: for ever) — the "How many" row
function pendingOf(b) {
  const p = PEND.get(b.id); if (!p) return null;
  const done = (!("make" in p) || (b.make === p.make && (b.makeBy || null) === p.makeBy) || (p.makeBy === null && !b.makeBy)) && (!("ord" in p) || (b.makeOrd ?? null) === p.ord || !b.make) && (!("crew" in p) || (Number.isInteger(b.crew) ? b.crew : null) === p.crew);
  if (done || performance.now() > p.until) { PEND.delete(b.id); return null; }
  return p;
}
const crewNowOf = (w, b) => b.crewNow || (w.econ?.role instanceof Map ? EC.crewOf(w, b) : null);
const TRADE_NAME = { smith: "smiths", fletcher: "fletchers", weaver: "weavers", carpenter: "carpenters" };
const pct = (v) => `${Math.round(v * 100)}%`;
export function workshopHTML(w, b, team) { // (exported for tools/workshop-test.mjs)
  const recipes = EC.RECIPES[b.kind], def = EC.BUILDINGS[b.kind] || {}, p = pendingOf(b);
  const make = p && "make" in p ? p.make : b.make, by = p && "makeBy" in p ? p.makeBy : b.makeBy || null;
  let h = "";
  if (recipes) {
    const r = make && recipes[make], ord = by === "player" ? (p && "ord" in p ? p.ord : b.makeOrd ?? null) : null;
    const left = ord ? (p && "ord" in p ? ord : b.makeLeft ?? ord) : null, nm = make?.replace(/_/g, " ");
    const order = make && ord ? ` · <b class="order">${ord - left} of ${ord} made</b> (making ${left} more, then it stops)` : make && by === "player" ? " · for ever" : "";
    h += `<div class="sub">Workshop makes</div><div class="row small makes-now">${make ? `Making <b>${nm}</b>${order}` : by === "player" ? "Making nothing: <b>your order is done</b> — pick what to make next, or Auto" : "Making nothing"} · ${by === "player" ? "<b class=\"you\">your choice</b> (the reeve leaves it alone)" : "the reeve chooses"}</div>`;
    // how many: an order of so many (then the shop stops), or ∞ — for the product chosen now, or the next one clicked
    const bt = (r && r.batch) || 1, sel = QTY.has(b.id) ? QTY.get(b.id) : ord;
    const presets = [...new Set([1, 5, 10].map((k) => Math.min(999, k * bt)))];
    h += `<div class="crew qty"><span class="small">How many:</span>${presets.map((n) => `<button data-qty="${n}" class="${sel === n ? "on" : ""}" title="${bt > 1 ? `${n / bt | 0 || 1} batch${n / bt > 1 ? "es" : ""} of ${bt}: ` : ""}make ${n}, then stop">${n}</button>`).join("")}<button data-qty="inf" class="${sel == null ? "on" : ""}" title="Keep making it for ever">∞</button></div>`;
    h += `<div class="grid makes"><button data-make="auto" class="auto ${by !== "player" ? "on" : ""}" title="Let the reeve choose what the house lacks">Auto (let the reeve choose)</button>` + Object.keys(recipes).filter((q) => typeof recipes[q] === "object").map((q) => TC.productOpen(w, b.team, b.kind, q)
      ? `<button data-make="${q}" class="${make === q ? (by === "player" ? "on mine" : "on") : ""}">${q.replace(/_/g, " ")}</button>`
      : `<button disabled title="Needs the study ${TC.TECHS[TC.PRODUCT_TECH[`${b.kind}.${q}`]].name} (Research)">${q.replace(/_/g, " ")} (locked)</button>`).join("") + `</div>`;
  }
  if (EC.workJob(b)) {
    const cn = crewNowOf(w, b), max = EC.crewMax(b), want = p && "crew" in p ? p.crew : Number.isInteger(b.crew) ? b.crew : null;
    const shown = want ?? cn?.n ?? 0;
    h += `<div class="sub">Crew</div><div class="crew"><button data-crew="-" ${shown <= 0 ? "disabled" : ""} title="One man fewer">−</button><span class="crewn"><b>${shown}</b> / ${max}</span><button data-crew="+" ${shown >= max ? "disabled" : ""} title="One man more">+</button><button data-crew="auto" class="${want === null ? "on" : ""}" title="Let the reeve set the crew">Auto</button></div>`;
    if (cn) {
      const roles = Object.entries(cn.roles).sort((x, y) => y[1] - x[1]).map(([r, k]) => `${k} ${k === 1 ? r : r === "man" ? "men" : r === "woman" ? "women" : r + "s"}`).join(", ");
      h += `<div class="row small">At work now: <b>${cn.n}</b>${cn.n ? ` — ${roles}` : ""}${want === null ? " · the reeve sets the crew" : ` · you want <b>${want}</b>${cn.n < want ? " (more on their way as hands come free)" : ""}`}</div>`;
    }
    const trade = EC.crewTrade(b);
    if (trade && cn) {
      const T = TRADE_NAME[trade] || trade + "s", R = recipes;
      h += `<div class="row small trade${cn.tradesmen ? "" : " warn"}">${def.name} work is ${T}' work: a ${trade} works at full pace, any other man at ${pct(R.unskilled)}. ${cn.tradesmen ? `Your house has <b>${cn.tradesmen}</b> ${cn.tradesmen === 1 ? trade : T}${cn.skilled ? ` (${cn.skilled} here)` : " — none here: add men and the reeve sends the " + T + " first"}.` : `Your house has <b>no ${T}</b>: it works at ${pct(R.unskilled)} pace.`} <b>Training more:</b> any man who works here learns the trade in about ${EC.APPRENTICE_DAYS?.[trade] ?? 50} working days (twice as long with no ${trade} beside him to teach him) — put more men in the crew.</div>`;
    } else if (EC.PRACTICE[b.kind]) h += practiceHTML(w, b, team, cn);
    else if (recipes && !trade) h += `<div class="row small trade">Any man can work here (${pct(recipes.unskilled)} of a craftsman's pace).</div>`;
    if (recipes && !make) h += `<div class="row small warn">Choose what it makes, or Auto: men here make nothing until it has work.</div>`;
  }
  return h;
}

// a training ground (econ-data PRACTICE: the butts, the muster yard, the stables): who trains here, into what, how long, the gear
const PRACTICE_INTO = { archer: "warbow archers", spear: "trained spearmen (for spearmen, pikemen, men-at-arms)", rider: "riders (for hobelars, scouts, and squires for knights)" };
function practiceHTML(w, b, team, cn) {
  const P = EC.PRACTICE[b.kind], T = w.teams[team], days = EC.SLOW_TRAINING[P.role];
  const kit = P.gear ? Math.floor(T.store?.[P.gear] || 0) : null, tr = (w.econ?.role instanceof Map && !T.training ? EC.trainingOf(w, team) : T.training || {})[P.role];
  const idle = cn ? Object.entries(cn.roles).filter(([r]) => !P.from.includes(r)).reduce((s, [, k]) => s + k, 0) : 0;
  return `<div class="row small trade${P.gear && kit < 1 ? " warn" : ""}">${P.from.map((r) => r === "man" ? "Men" : r + "s").join(" and ")} who ${P.what} day after day become ${PRACTICE_INTO[P.role]} in about ${days} working days.` +
    (P.gear ? ` Each needs ${P.gear === "horses" ? "a horse" : "a spear"} to hand: <b>${kit}</b> in your store${kit < 1 ? " — nobody can train until there is one" : cn && cn.n > kit ? ` (only ${kit} of the crew train at once)` : ""}.` : "") +
    (tr?.n ? ` ${tr.n} part-way (the furthest ${Math.round(tr.best * 100)}%).` : "") + (idle ? ` <b class="warn">${idle} of the crew ${idle === 1 ? "is" : "are"} not ${P.from.join(" or ")}: they cannot train here.</b>` : "") + `</div>`;
}

// THE LEARNING REEVE (js/sim/reeve-learn.js summary): what he has learned from the player, in plain words, with the switch and
// a reset. L = the reeve op's answer (null: not asked yet)
let LEARNED = null; // { team, data, at } — the last answer (the realm: the server's)
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export function learnedHTML(L) {
  let h = `<div class="sub">Your reeve has learned</div><div class="learned" data-learned>`;
  if (!L) return h + `<div class="row small">Asking the reeve…</div></div>`;
  h += L.lines.length ? `<ul class="lrn">${L.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`
    : `<div class="row small">Nothing yet. He watches what you order — who works where, what you build, what the workshops make, the fields you draw — and copies it in times like those.</div>`;
  h += `<div class="row small">${L.n} of your orders watched${L.rows < L.n ? ` · the last ${L.rows} kept` : ""}${L.on ? "" : " · <b>he is not copying you</b>"}</div>`;
  h += `<div class="crew"><button data-reeve="${L.on ? "off" : "on"}" class="${L.on ? "on" : ""}" title="${L.on ? "He copies how you run the vill. Click: back to his own ways" : "He runs the vill his own way. Click: copy me"}">Copy me: ${L.on ? "on" : "off"}</button><button data-reeve="reset" title="Forget everything he has watched">Forget it all</button></div></div>`;
  return h;
}

// what the open panel shows that can change under it (main.js refreshes a hovered panel only when this changes)
export function panelSig(w, b, team) { const cn = EC.workJob(b) ? crewNowOf(w, b) : null, G = b.kind === "town_hall" ? growthOf(w, team) : null; return [b.make, b.makeBy, b.makeLeft, b.makeOrd, b.crew, cn?.n, b.blocked, b.progress >= 1, b.queue?.length, G?.pop, G?.cap, G?.rate > 0, b.guardN, !!b.tilt, (b.kind === "market" || b.kind === "mill" || b.kind === "town_hall") ? `${w.teams[team]?.inc?.day}/${w.teams[team]?.sales?.on !== false}/${JSON.stringify(w.teams[team]?.sales?.keep || {})}` : ""].join("|"); } // (the income lines and the Sell section: a new day's accounts, the reeve's switch and reserves)

// a gate's guards (js/sim/gateguards.js): two real foot soldiers taken from the army for good, one at each side of the passage
const GUARD_ONE = { spearmen: "Spearman", levy: "Levy spearman", menatarms: "Man-at-arms", pikemen: "Pikeman", archers: "Archer", crossbow: "Crossbowman", militia: "Militiaman" };
function gateGuardsHTML(w, b) {
  const G = [...w.units.values()].filter((u) => u.gate === b.id && (u.members.length || u.n));
  const at = (s) => G.find((u) => u.gateSide === s);
  const row = (s, nm) => { const u = at(s); return `<div class="row small">${nm} side: ${u ? `<b>${GUARD_ONE[u.arm] || ARMS[u.arm]?.name || u.arm}</b>` : `<b class="warn">unguarded</b>`}</div>`; };
  const n = G.length;
  return `<div class="sub">Guards (${n} of 2)</div>${row(-1, "Left")}${row(1, "Right")}` +
    `<div class="row small">${n >= 2 ? "Two foot soldiers taken from your army for good. They fight if the gate is attacked; a guard who falls is replaced from the companies at home." : `<b class="warn">The gate stands ${n ? "half " : ""}unguarded</b>: no foot soldier is free at home. It takes ${n ? "one" : "two"} as soon as any are.`}</div>`;
}

// what mount the player last chose at each stables (pure UI state; the sim hears it per command)
const MOUNT_CHOICE = new Map();
const mountsOf = (T) => ["strider", "drake"].filter((k) => T?.tradition?.[k]);

// ---------------------------------------------------------------- building panel
// acts (optional): { recruit(b, arm, n, rushed, done), product(b, what, done), canRecruit(arm) } — the command layer
// (js/game/commands.js via main.js; in the realm the server's). Without it the economy is called directly.
export function showBuildingPanel(el, w, b, team, onChange, acts = null) {
  const def = EC.BUILDINGS[b.kind] || {}, T = w.teams[b.team];
  const mine = b.team === team;
  const stage = b.razing ? (b.ruin ? "Ruined · being cleared" : "Coming down") : b.ruin ? "Ruined" : b.progress >= 1 ? "Complete" : `Under construction · ${Math.round(b.progress * 100)}%`; // (b.razing: js/sim/demolish.js)
  let html = `<button class="x" data-close>✕</button><h3>${def.name || b.kind}</h3>
    <div class="row">${stage}</div><div class="bar"><i style="width:${Math.round((b.hp / (def.hp || 1)) * 100)}%"></i></div>`;
  if (mine && EC.RECIPES[b.kind] && !b.ruin) html += whyHTML(w, b, team, EC.workJob(b) ? crewNowOf(w, b)?.n || 0 : 0); // (first thing in the panel: why it is — or isn't — making anything: js/ui/workshop-why.js)
  if (LE.ESTATE_TEXT[b.kind]) html += `<div class="row small estate">${LE.ESTATE_TEXT[b.kind]}${b.upgradeOf !== undefined ? " Your motte stands and serves until this is finished." : ""}</div>`; // (js/sim/estates.js)
  // (lane D: a site rises only as its materials arrive — js/sim/jobs/haulage.js)
  if (mine && b.need && b.progress < 1 && !b.ruin) html += `<div class="row small">Materials on site: ${Object.entries(b.need).map(([r, n]) => `${r} ${kg((b.used?.[r] || 0) + (b.stock?.[r] || 0))} of ${kg(n)}`).join(" · ")}</div>`;
  const mChoice = b.kind === "stables" ? MOUNT_CHOICE.get(b.id) || "horse" : "horse";
  if (mine && EC.complete(b) && def.recruits?.length) {
    const whyRec = (arm, mnt, can) => { const y = recruitWhy(w, team, arm, mnt, can); return y ? `<span class="row small warn why recwhy">${y.line}</span>` : ""; }; // (js/ui/recruit-why.js)
    html += `<div class="sub">Recruit</div><div class="recruits">` + def.recruits.map((arm) => {
      const A = ARMS[arm], mnt = A?.horse && mChoice !== "horse" && mountFits(arm, mChoice) ? mChoice : null;
      const R = EC.RECRUITS[arm], can = acts?.canRecruit ? acts.canRecruit(arm, mnt) : EC.canRecruit(w, team, arm, mnt);
      const gear = Object.entries(R.gear).map(([g, q]) => `${q} ${mnt && (g === "horses" || g === "destriers") ? mnt + "s" : g}`).join(", ");
      if (R.perUnit) return `<div class="rec"><span class="gl">${glyphSVG(A?.glyph || "spear")}</span><div><b>${A?.name || arm}</b><small>${gear} · crew of ${R.crew} (from ${R.from.join("/")}) · pay ${R.pay}d/day each</small></div>
        <div class="btns"><button data-rec="${arm}" data-n="1" ${can < 1 ? "disabled" : ""}>Crew one</button></div><span class="can">${can} ready</span>${whyRec(arm, mnt, can)}</div>`;
      return `<div class="rec"><span class="gl">${glyphSVG(A?.glyph || "spear")}</span><div><b>${A?.name || arm}${mnt ? ` <i class="mnt">on ${mnt}s</i>` : ""}</b><small>${gear} · ${R.days} days · pay ${R.pay}d/day · from ${R.from.join("/")}</small></div>
        <div class="btns"><button data-rec="${arm}" data-n="10" ${can < 1 ? "disabled" : ""}>+10</button><button data-rec="${arm}" data-n="1" ${can < 1 ? "disabled" : ""}>+1</button>${R.rushedDays ? `<button data-rec="${arm}" data-n="10" data-rush="1" ${can < 1 ? "disabled" : ""} title="Rushed: ${R.rushedDays} days, worse training">Rush</button>` : ""}</div>
        <span class="can">${can} ready</span>${whyRec(arm, mnt, can)}</div>`;
    }).join("") + `</div>`;
    if (b.queue?.length) html += `<div class="sub">Training</div>` + b.queue.map((q) => `<div class="row">${q.retrain !== undefined ? `${q.count} riders re-mounting on ${q.mount || "horse"}s` : q.engines ? `${q.engines} × ${ARMS[q.arm]?.name || q.arm} (crew ${q.count})` : `${q.count} × ${ARMS[q.arm]?.name || q.arm}${q.mount ? ` on ${q.mount}s` : ""}`} <b>${Math.round((q.t / (q.days || 1)) * 100)}%</b></div>`).join("");
    if (b.kind === "paddock" && EC.complete(b)) { // the stud: mares, the year's foals, when the next are broken to the saddle (economy.js breedHorses)
      const F = T.foalsBy || [], foals = F.reduce((s, c) => s + c.n, 0), next = F.length ? Math.min(...F.map((c) => c.born + EC.E.horse.breakDays)) - (w.econ?.doy ?? 0) : null;
      html += `<div class="row small">A stud of ${EC.E.horse.studMares} mares. Foals drop in spring (April to June). ${foals >= 0.5 ? `${Math.round(foals)} foal${Math.round(foals) === 1 ? "" : "s"} growing` : "No foals yet"}${next !== null ? `; the next are broken to the saddle in ${Math.max(0, Math.ceil(next))} days and join your horses` : ""}. Horses in store: ${Math.floor(T.store.horses || 0)}.</div>`;
      const st = EC.destrierStud(w, b.team), D = EC.E.destrier, G = T.destriersBy || [], dn = G.reduce((s, c) => s + c.n, 0);
      html += `<div class="row small${st.ok ? "" : " warn"}">Great horses: ${st.ok ? `beside your Stables, with ${st.herd} riding horses to pick from, the best colts are put aside each spring — about ${st.perYear} a year${st.sire ? " (a destrier of your own at stud)" : ""} — and schooled ${Math.round(D.days / 365 * 10) / 10} years into destriers` : `none are bred: that needs this paddock beside a finished Stables${st.stables ? "" : " (you have none)"} and at least ${D.minHorses} riding horses in store (you have ${st.herd})`}.${dn >= 0.5 ? ` ${Math.round(dn)} in schooling.` : ""} Destriers in store: ${Math.floor(T.store.destriers || 0)}.</div>`;
    }
    if (b.kind === "siege_workshop") html += `<div class="row small">In store: ${["trebuchet_gear", "mangonels", "springalds", "rams", "siege_towers", "mantlets", "ladders", "rope"].map((g) => `${Math.floor(T.store[g] || 0)} ${g.replace("_", " ")}`).join(" · ")}</div>`;
  }
  if (mine && EC.complete(b) && b.kind === "stables") {
    const learned = mountsOf(T), stock = T.mounts || {}, pens = b.pens || {};
    html += `<div class="sub">Mounts</div><div class="mounts">`;
    html += `<div class="row small mchoice">New cavalry ride: ` + ["horse", ...["strider", "drake"]].map((k) => {
      const known = k === "horse" || learned.includes(k);
      const M = k === "horse" ? null : MOUNTS[MOUNT_ID[k]];
      const tip = k === "horse" ? "The baseline: the charge, the recoil, the pursuit — as it has always been."
        : known ? M.blurb : `${M.blurb} — Not yet learned: capture a young one in the wild and the stables will break it.`;
      return `<button data-mount="${k}" class="${mChoice === k ? "on" : ""}" ${known ? "" : "disabled"} title="${tip}">${k === "horse" ? "Horse" : M.name}${k !== "horse" && known ? ` ×${Math.floor(stock[k] || 0)}` : ""}</button>`;
    }).join("") + `</div>`;
    // the chosen mount's strengths in plain words (not only in a tooltip): what changes when these men ride it
    { const M = mChoice === "horse" ? null : MOUNTS[MOUNT_ID[mChoice]];
      html += `<div class="row small mwhy">${M ? `<b>${M.name}</b> <small>(${M.arms.map((a) => ARMS[a]?.name || a).join(", ")})</small>: ${M.blurb}` : `<b>Horse:</b> the baseline — a sure charge, the speed you know, hay and oats.`}${learned.length < 2 ? ` <i>${["strider", "drake"].filter((k) => !learned.includes(k)).map((k) => MOUNTS[MOUNT_ID[k]].name + "s").join(" and ")} not yet learned (hover for what they would give).</i>` : ""}</div>`; }
    const penned = ["strider", "drake"].filter((k) => pens[k] > 0).map((k) => `${pens[k]} young ${k}${pens[k] > 1 ? "s" : ""}`).join(", ");
    if (penned) html += `<div class="row small">In the pens: ${penned}</div>`;
    { const riders = rolesOf(w, team).rider || 0, days = Math.round(EC.SLOW_TRAINING.knight * TC.mul(w, team, "squire"));
      html += `<div class="row small squire">${b.tilt ? `A squire at the tilt: <b>${Math.round(Math.min(1, b.tilt.t / days) * 100)}%</b> of ${days} days, then a knight can be armed here.` : `Knights are raised from squires (you have <b>${T.squires || 0}</b>). A rider schooled at the tilt becomes one in ${days} days.`} <button data-squire="1" ${b.tilt || riders < 1 ? "disabled" : ""} title="${riders < 1 ? "No rider in your vill: men learn to ride here (give the stables a crew; it needs horses)" : "One of your riders goes to the tilt"}">School a squire</button> <small>${riders} rider${riders === 1 ? "" : "s"} in your vill</small></div>`; }
    if (b.train) html += `<div class="row small">Breaking a ${b.train.kind} to the saddle <b>${Math.round((b.train.t / b.train.days) * 100)}%</b></div>`;
    if (!learned.length && !penned && !b.train) html += `<div class="row small">Only horses are ridden here. Wild strider herds and drake dens can be captured young (order a company onto a herd) and broken to the saddle.</div>`;
    // standing cavalry re-mounted at the chosen kind
    const cav = [...w.units.values()].filter((u) => u.team === team && ARMS[u.arm]?.horse && !u.isWorkers && u.members.length);
    for (const u of cav) {
      const cur = u.mount || "horse";
      if (cur === mChoice || !mountFits(u.arm, mChoice)) continue;
      html += `<div class="row small">${ARMS[u.arm].name} ×${u.members.length} — on ${cur}s <button data-retrain="${u.id}">Re-mount on ${mChoice}s</button></div>`;
    }
    html += `</div>`;
  }
  if (mine && EC.complete(b) && (EC.RECIPES[b.kind] || EC.workJob(b))) html += workshopHTML(w, b, team); // (what it makes, and its crew)
  if (b.field) html += `<div class="row">${b.field.crop} · ${b.field.state} · ${kg(b.field.left || 0)} standing</div>`;
  if (mine && b.kind === "town_hall" && EC.complete(b)) html += growthHTML(growthOf(w, team)) + keepResearchHTML(w, team) + learnedHTML(LEARNED?.team === team ? LEARNED.data : null); // (where the people come from; research at the keep: js/ui/tech.js; what the reeve has learned)
  if (EC.complete(b) && (b.kind === "gate" || b.kind === "gatehouse")) html += gateGuardsHTML(w, b); // (its two real guards: js/sim/gateguards.js)
  html += demolishHTML(w, b, team);
  if (mine && b.kind === "market" && EC.complete(b)) html += marketHTML(w, team); // (buy and sell: js/ui/market-ui.js)
  if (mine && b.kind === "mill" && EC.complete(b)) html += duesHTML(w, team, "mill"); // (its multure: js/sim/income.js)
  if (mine && b.kind === "town_hall" && EC.complete(b)) html += duesHTML(w, team, "keep") + (EC.hasBuilding(w, team, "market") ? "" : sellHTML(w, team, false)); // (no market: the reeve carts the surplus to the market town — the Sell section lives here)
  el.innerHTML = html + `<i data-bpanel="${b.id}" hidden></i>`; el.hidden = false; el.dataset.sig = panelSig(w, b, team);
  el.querySelector("[data-close]").onclick = () => { el.hidden = true; };
  const again = () => { const nb = w.buildings.find((x) => x.id === b.id) || b; if (!el.hidden) showBuildingPanel(el, w, nb, team, onChange, acts); };
  el.querySelectorAll("[data-rec]").forEach((bt) => bt.onclick = () => {
    const arm = bt.dataset.rec, n = +bt.dataset.n, rushed = !!bt.dataset.rush;
    const mnt = ARMS[arm]?.horse && mChoice !== "horse" && mountFits(arm, mChoice) ? mChoice : null;
    if (acts?.recruit) { acts.recruit(b, arm, n, rushed, (r) => { onChange?.(r.ok ? r.msg : r.error || "Not enough men or gear"); again(); }, mnt); return; }
    const got = EC.queueRecruit(w, b, arm, n, { rushed, mount: mnt });
    onChange?.(got ? `Mustering ${got} ${ARMS[arm]?.name || arm}${mnt ? ` on ${mnt}s` : ""}` : mnt ? "Not enough trained mounts or men" : "Not enough men or gear");
    again();
  });
  el.querySelector("[data-squire]")?.addEventListener("click", () => {
    if (acts?.run) { acts.run("squire", { bid: b.id }, (r) => { onChange?.(r.ok ? r.msg : r.error || "No rider to send"); again(); }); return; }
    const ok = EC.startSquire(w, b); onChange?.(ok ? "A rider goes to the tiltyard to be schooled as a squire" : "No rider in your vill: men learn to ride at the stables"); again();
  });
  el.querySelectorAll("[data-mount]").forEach((bt) => bt.onclick = () => { MOUNT_CHOICE.set(b.id, bt.dataset.mount); again(); });
  el.querySelectorAll("[data-retrain]").forEach((bt) => bt.onclick = () => {
    const unit = +bt.dataset.retrain;
    if (acts?.retrain) { acts.retrain(b, unit, mChoice, (r) => { onChange?.(r.ok ? r.msg : r.error || "Cannot re-mount them now"); again(); }); return; }
    const got = EC.queueRetrain(w, b, unit, mChoice === "horse" ? null : mChoice);
    onChange?.(got ? `Re-mounting ${got} riders on ${mChoice}s` : "Not enough trained mounts, or the company cannot change now");
    again();
  });
  el.querySelector("[data-techtree]")?.addEventListener("click", () => acts?.techTree?.());
  // the learning reeve: asked afresh every few seconds (the realm: the server keeps the book); on / off; forget it all (twice)
  if (el.querySelector("[data-learned]")) {
    const ask = (what, done) => { if (acts?.reeve) acts.reeve(what, done); else { const T = w.teams[team]; if (what === "on" || what === "off") RL.setOn(T, what === "on"); if (what === "reset") RL.reset(T); done({ ok: true, learned: RL.summary(w, team) }); } };
    const got = (r) => { if (r?.ok && r.learned) LEARNED = { team, data: r.learned, at: performance.now() }; };
    if (!LEARNED || LEARNED.team !== team || performance.now() - LEARNED.at > 3000) ask("learned", (r) => { got(r); if (r?.ok) again(); });
    el.querySelectorAll("[data-reeve]").forEach((bt) => bt.onclick = () => {
      const what = bt.dataset.reeve;
      if (what === "reset" && !bt.dataset.sure) { bt.dataset.sure = "1"; bt.textContent = "Sure? Click again"; return; }
      ask(what, (r) => { got(r); onChange?.(r?.ok ? r.msg : r?.error || "The reeve did not hear"); again(); });
    });
  }
  bindDemolish(el, w, b, team, acts?.run, onChange, again);
  if (b.kind === "market") bindMarket(el, w, team, acts?.run, onChange, again);
  else if (b.kind === "town_hall") bindSell(el, w, team, acts?.run, onChange, again);
  // the product: shown at once as clicked (PEND), confirmed by the sim's / the server's state
  el.querySelectorAll("[data-make]").forEach((bt) => bt.onclick = () => {
    const what = bt.dataset.make, cur = w.buildings.find((x) => x.id === b.id) || b;
    const n = what === "auto" ? null : QTY.has(b.id) ? QTY.get(b.id) : cur.makeBy === "player" ? cur.makeOrd ?? null : null;
    order(cur, what, n);
  });
  // how many: a new order of n of what it makes now (the player's choice), or remembered for the next product clicked
  el.querySelectorAll("[data-qty]").forEach((bt) => bt.onclick = () => {
    const cur = w.buildings.find((x) => x.id === b.id) || b, p = pendingOf(cur), n = bt.dataset.qty === "inf" ? null : Number(bt.dataset.qty);
    QTY.set(b.id, n);
    const make = p && "make" in p ? p.make : cur.make, by = p && "makeBy" in p ? p.makeBy : cur.makeBy || null;
    if (make && by === "player") order(cur, make, n); else again();
  });
  function order(cur, what, n) {
    PEND.set(b.id, { ...PEND.get(b.id), make: what === "auto" ? cur.make : what, makeBy: what === "auto" ? null : "player", ...(what === "auto" ? {} : { ord: n }), until: performance.now() + 5000 });
    again();
    const fin = (r) => { if (!r.ok) { const q = PEND.get(b.id); if (q) { delete q.make; delete q.makeBy; delete q.ord; } if (r.error) onChange?.(r.error); } else if (r.msg) onChange?.(r.msg); again(); };
    if (acts?.product) { acts.product(b, what, fin, n); return; }
    if (what === "auto") { EC.autoProduct(cur); fin({ ok: true }); } else fin(EC.setProduct(w, cur, what, "player", n) ? { ok: true, msg: n ? `Make ${n} ${what.replace(/_/g, " ")}, then stop` : undefined } : { ok: false, error: "Not made here" });
  }
  // the crew: − / + / Auto
  el.querySelectorAll("[data-crew]").forEach((bt) => bt.onclick = () => {
    const cur = w.buildings.find((x) => x.id === b.id) || b, p = pendingOf(cur), cn = crewNowOf(w, cur);
    const want = p && "crew" in p ? p.crew : Number.isInteger(cur.crew) ? cur.crew : cn?.n ?? 0, k = bt.dataset.crew;
    const n = k === "auto" ? null : Math.max(0, Math.min(EC.crewMax(cur), want + (k === "+" ? 1 : -1)));
    PEND.set(b.id, { ...PEND.get(b.id), crew: n, until: performance.now() + 5000 });
    again();
    const fin = (r) => { if (!r.ok) { const q = PEND.get(b.id); if (q) delete q.crew; } onChange?.(r.ok ? r.msg : r.error || "Cannot change the crew now"); again(); };
    if (acts?.crew) { acts.crew(b, n, fin); return; }
    const r = EC.setCrew(w, cur, n); fin({ ...r, msg: r.ok ? `${r.n} at work` : undefined });
  });
}

// ---------------------------------------------------------------- build menu
const BUILDABLE = ["field", "house", "temple", "granary", "mill", "lumber_camp", "mining_camp", "charcoal_kiln", "bloomery", "blacksmith", "fletcher", "weaver",
  "barracks", "archery_range", "stables", "paddock", "siege_workshop", "market", "watchtower", "mage_tower", "palisade", "stone_wall", "gate"];
export function showBuildMenu(el, w, team, onPick) {
  const T = w.teams[team], st = stageStatus(w, team);
  let html = `<button class="x" data-close>✕</button><h3>Build</h3><div class="stage">Your settlement: <b>${st.name}</b>${st.next ? ` · next: ${st.next} — needs ${st.missing.map((m) => `${m.have}/${m.need} ${EC.BUILDINGS[m.kind]?.name || m.kind}`).join(", ")}` : " · fully grown"}</div>`;
  STAGES.forEach((S, i) => {
    const open = i <= st.reached;
    html += `<div class="sub">${i + 1}. ${S.name}${open ? "" : " — locked"}</div><div class="buildlist">` + S.kinds.filter((k) => EC.BUILDINGS[k]).map((k) => {
      const d = EC.BUILDINGS[k], cost = EC.costOf(k, d.perMetre ? 45 : 1), ok = open && EC.canAfford(T, cost);
      const c = Object.entries(cost).map(([r, v]) => r === "silver" ? `${n0(v)}d` : r === "gold" ? `${n0(v)} s gold` : `${kg(v)} ${r}`).join(" · "); // (gold: the great works' shrine and gilding — js/sim/gold.js)
      const ew = open ? LE.estateWhy(w, team, k) : null; // (the great buildings: a study first, one to a house, the shell keep on the motte)
      const why = k === "house" ? `<small class="why">+${(d.pop || 5) + TC.add(w, team, "housePop")} room: families move in when there's room, food and order</small>` : LE.ESTATE_TEXT[k] ? `<small class="why">${ew ? `<b>${ew[0].toUpperCase() + ew.slice(1)}.</b> ` : ""}${LE.ESTATE_TEXT[k]}</small>` : "";
      return `<button data-b="${k}" ${open && !ew ? "" : "disabled"} class="${ok ? "" : "poor"}"><b>${d.name}</b><small>${c || "free"}${d.perMetre ? " per 45 m stretch" : ""} · ${n0(d.labour)} man-days</small>${why}</button>`;
    }).join("") + `</div>`;
  });
  { const d = EC.BUILDINGS.bridge, ok = EC.canAfford(T, EC.costOf("bridge", 20)); // (a house's timber bridge over a river: js/sim/bridges.js, js/ui/bridge-ui.js)
    html += `<div class="sub">Crossings</div><div class="buildlist"><button data-b="bridge" class="${ok ? "" : "poor"}"><b>${d.name} — bridge here</b><small>${kg(d.mat.timber * 20)} timber per 20 m of span · ${n0(d.labour * 20)} man-days · the river lights up where it can be bridged (narrow, firm banks, up to ${d.maxSpan} m)</small></button></div>`; }
  html += `<div class="sub">A new town</div><div class="buildlist"><button data-b="town_hall"><b>${EC.BUILDINGS.town_hall.name} elsewhere</b><small>found a new town: settlers, their families and their goods set out from here · the ground shows where it may stand</small></button></div>`;
  html += `<div class="hint">The ground lights up where the chosen building can go — read from the land and your village as it stands (brighter suits it better); camps go beside what they work; walls follow the circuit your village asks for as it grows, or a line you drag. An Open Field you draw yourself: drag it out on open ground — it lies square to your view — and your men clear and plough it.</div>`;
  el.innerHTML = html; el.hidden = false;
  el.querySelector("[data-close]").onclick = () => { el.hidden = true; };
  el.querySelectorAll("[data-b]").forEach((b) => b.onclick = () => { el.hidden = true; onPick({ kind: b.dataset.b }); });
}

// ---------------------------------------------------------------- land panel: what this ground gives, and what building here does
const SHOW_KINDS = ["field", "house", "granary", "mill", "lumber_camp", "mining_camp", "charcoal_kiln", "bloomery", "barracks", "watchtower", "stone_wall"];
export function showLandPanel(el, w, x, y) {
  const A = landAt(w.map, x, y);
  const fert = A.fert >= 1.05 ? "rich" : A.fert >= 0.85 ? "fair" : A.fert >= 0.5 ? "poor" : A.fert > 0 ? "barren" : "unploughable";
  const found = A.found >= 1.15 ? "bedrock" : A.found >= 0.85 ? "firm" : A.found >= 0.55 ? "soft" : "very soft";
  let html = `<button class="x" data-close>✕</button><h3>${A.name}</h3>
    <div class="row">${Math.round(w.map.h(x, y))} m · slope ${Math.round(Math.atan(A.slope) * 57.3)}° · soil ${fert} · footing ${found}${A.wet > 0.7 ? " · wet" : ""}</div>
    ${A.note ? `<p class="landnote">${A.note}</p>` : ""}
    <div class="sub">Provides</div>
    ${A.provides.length ? `<ul class="landlist">${A.provides.map((p) => `<li>${p.text}</li>`).join("")}</ul>` : `<div class="row">nothing to gather</div>`}
    <div class="sub">If you build here</div>`;
  for (const k of SHOW_KINDS) {
    const fx = buildEffects(w.map, k, x, y), name = EC.BUILDINGS[k]?.name || k;
    const main = fx.lines.filter((l) => !/no penalties/.test(l));
    if (!main.length && k !== "field") continue;
    html += `<div class="landfx"><b>${name}</b><small>${(main.length ? main : fx.lines).join(" · ")}</small></div>`;
  }
  el.innerHTML = html; el.hidden = false;
  el.querySelector("[data-close]").onclick = () => { el.hidden = true; };
}
export function landPreview(w, kind, x, y) {
  const fx = buildEffects(w.map, kind, x, y);
  return `${fx.land.name}: ${fx.lines.join(" · ")}`;
}
