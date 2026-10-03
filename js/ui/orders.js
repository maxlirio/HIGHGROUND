// "What should they do there?" — the popup after clicking a destination with troops selected.
import { analysePoint } from "../sim/analysis.js";
import { FORMATIONS } from "../sim/arms.js";

import { ARMS } from "../sim/arms.js";
import { herdAt, SPECIES } from "../sim/wild.js";
import { dragonOfHouse } from "../sim/dragons.js";
import { layer as townLayer, onWall } from "../sim/townwall.js"; // a town's walls: "Man the walls" / "Come down"
import { RECIPES, BUILDINGS } from "../sim/econ-data.js";
import { isVein, mineWhy, veinStatus, holderOf, holderName, VEIN } from "../sim/veins.js"; // (veins held and taken)

// What is there, and who is asking: the popup offers only the orders that make sense at this spot for these men
// (the owner: "less actions … a lot of them are similar"). One Attack does whatever attacking means here — fight
// the men there, raze a building, fire a gate, bombard, sally at an engine (main.resolveAttack).
export function orderContext(w, units, pt, side = null) {
  const team = units[0]?.team ?? 0, near = (x, y, r) => Math.hypot(x - pt.x, y - pt.y) < r;
  const arm = (u) => ARMS[u.arm] || {};
  const c = {
    foot: units.some((u) => !arm(u).mounted && !arm(u).engine && !u.isWorkers),
    villagers: units.some((u) => u.isWorkers), missile: units.some((u) => arm(u).missile),
    light: units.some((u) => arm(u).missile || ["hobelars", "scouts"].includes(u.arm)), scouts: units.some((u) => ["scouts", "hobelars"].includes(u.arm)),
    horse: units.some((u) => arm(u).mounted), heavyFoot: units.some((u) => ["menatarms", "knights"].includes(u.arm)),
    points: units.some((u) => ["spearmen", "pikemen", "levy", "militia"].includes(u.arm)),
    engines: units.filter((u) => arm(u).engine), packed: units.some((u) => w.siege?.engines?.some((e) => e.crew === u.id && e.state === "packed")),
    soldiers: units.some((u) => !u.isWorkers), side,
  };
  c.enemyMen = [...w.units.values()].some((v) => v.team !== team && v.members.length && !v.isWorkers && near(v.ax, v.ay, 40));
  const B = w.buildings || [];
  c.enemyBuilding = B.find((b) => b.team !== team && !b.ruin && !b.mods && b.castle === undefined && b.x !== undefined && near(b.x, b.y, 35)) || null; // (walls and castle parts are for the siege orders)
  c.enemyWall = B.some((b) => b.team !== team && !b.ruin && b.mods && (b.x1 !== undefined ? segD(b, pt) < 30 : near(b.x, b.y, 30)));
  c.enemyGate = B.some((b) => b.team !== team && !b.ruin && (b.gx1 !== undefined || /gate/.test(b.kind)) && near(b.gx1 !== undefined ? (b.gx1 + b.gx2) / 2 : b.x, b.gx1 !== undefined ? (b.gy1 + b.gy2) / 2 : b.y, 25));
  c.ownBreach = B.some((b) => b.team === team && b.mods && [...b.mods].some((m) => m <= 0) && (b.x1 !== undefined ? segD(b, pt) < 30 : near(b.x, b.y, 30)));
  c.enemyEngine = (w.siege?.engines || []).some((e) => e.team !== team && e.state !== "burnt" && near(e.x, e.y, 30));
  c.site = B.some((b) => b.team === team && (b.progress < 1 || b.hp < (b.hpMax || b.hp)) && near(b.x, b.y, 45));
  // one of our own finished workshops (or the butts) at the spot: villagers can be its crew — "Work here" (economy.js setCrew)
  c.workshop = c.villagers ? B.filter((b) => b.team === team && !b.ruin && b.progress >= 1 && b.x1 === undefined && (RECIPES[b.kind] || b.kind === "archery_range") && near(b.x, b.y, Math.max(...(BUILDINGS[b.kind]?.footprint || [10, 10])) / 2 + 8))
    .sort((a, b) => Math.hypot(a.x - pt.x, a.y - pt.y) - Math.hypot(b.x - pt.x, b.y - pt.y))[0] || null : null;
  c.resource = (w.resources || []).some((r) => r.amount > 0 && near(r.x, r.y, 60)) || B.some((b) => b.team === team && b.field && near(b.x, b.y, 80));
  c.work = c.villagers && !c.workshop ? workAt(w, team, pt) : null; // ("Mine here", "Fell timber here", "Work this field", "Build this", "Haul here": THAT place)
  // a silver or gold vein at the spot (js/sim/veins.js): soldiers can take another house's — "Take the vein"
  c.vein = (w.resources || []).filter((n) => isVein(n) && near(n.x, n.y, VEIN.r + 15)).sort((a, b) => Math.hypot(a.x - pt.x, a.y - pt.y) - Math.hypot(b.x - pt.x, b.y - pt.y))[0] || null;
  if (c.vein && holderOf(c.vein) === team) c.vein = null; // (ours already: nothing to take)
  // lane C: a herd of game at the spot (seen: the renderer's w.wildSeen where there is fog) → Hunt; a strider herd or
  // drake den with a living juvenile → Capture young (docs/mounts-wildlife-spec.md). The lake serpent is nobody's game.
  const H = w.wild ? herdAt(w, pt.x, pt.y, 25) : null;
  c.herd = H && H.n > 0 && !SPECIES[H.sp].nohunt && (!w.wildSeen || w.wildSeen.has(H.id)) && units.some((u) => !arm(u).engine)
    ? { id: H.id, sp: H.sp, n: H.n, name: SPECIES[H.sp].name, capture: !!SPECIES[H.sp].capture, young: (w.wild.a || []).some((a) => a.h === H.id && a.young) } : null;
  // the house's own dragon (js/sim/dragons.js): a bonded one at its lair can be SUMMONED to this spot; a summoned
  // one is flown and breathes fire where its lord points
  // a town's walls (js/sim/townwall.js): a walk of our own standing within reach → "Man the walls"; men up there → "Come down"
  const TL = c.foot && w.buildings?.length ? townLayer(w) : null;
  c.ownWalls = !!TL && TL.edges.some((e) => !e.gone && e.team === team && e.kind === "walk" && Math.hypot(TL.nodes[e.a].x - pt.x, TL.nodes[e.a].y - pt.y) < 450);
  c.onWalls = units.some((u) => onWall(w, u));
  const PD = dragonOfHouse(w, team);
  c.dragon = PD ? { id: PD.id, name: PD.name, summoned: !!PD.summoned, bonded: PD.stage >= 3, home: PD.mode === "sleep" || PD.mode === "home", near: Math.hypot(PD.x - pt.x, PD.y - pt.y) } : null;
  return c;
}
// THE WORK AT THE SPOT (the owner: "I select them, go to a mining camp, and then it just says 'March here?' instead of
// 'work?'"): what villagers clicked onto (x, y) would work — the building clicked (a site to build or repair, a camp's node,
// a store to haul at, a field), else the field the spot lies in, else the resource node under it. The men then work THAT
// place, not the nearest of its kind (commands.js order "work" resolves it again on the server, from the same spot).
// → { kind: "site" | "camp" | "store" | "field" | "node", b?, node?, label, hint } | null
const CAMP_RES = { mining_camp: ["stone", "ore", "silver", "gold", "iron"], lumber_camp: ["timber", "wood"] }; // (townplan NEAR_RESOURCE: what a camp works)
const CAMP_REACH = 110;
const NODE_WORD = { wood: ["Fell timber here", "the woodland"], coppice: ["Cut wood here", "the coppice"], quarry: ["Quarry stone here", "the quarry face"], bog_iron: ["Dig ore here", "the bog-iron bed"], silver_vein: ["Mine silver here", "the silver vein"],
  gold_vein: ["Mine gold here", "the gold vein"], fishery: ["Fish here", "the fishing water"], forage: ["Forage here", "the thicket"], hunt: ["Hunt here", "the hunting ground"], ley: ["Draw on the ley", "the ley line (adepts only)"] };
const bName = (b) => (BUILDINGS[b.kind]?.name || b.kind).toLowerCase();
export function campNodeOf(w, b) {
  const res = CAMP_RES[b.kind]; if (!res) return null;
  let best = null, bd = CAMP_REACH;
  for (const n of w.resources || []) { if (!res.includes(n.res) || !(n.amount > 0)) continue; const d = Math.hypot(n.x - b.x, n.y - b.y) - (n.r || 0) * 0.5; if (d < bd || (d === bd && best && n.id < best.id)) { bd = d; best = n; } }
  return best;
}
export function workAt(w, team, pt) {
  const B = w.buildings || [], fp = (b) => Math.max(...(BUILDINGS[b.kind]?.footprint || [10, 10])) / 2 + 8;
  const nodeWork = (n, via = null) => { const [label, what] = NODE_WORD[n.kind] || ["Work here", n.kind]; const no = isVein(n) ? mineWhy(w, team, n) : null; // (a vein: only its holder's men mine it — js/sim/veins.js)
    return { kind: via ? "camp" : "node", node: n, b: via, label: via?.kind === "mining_camp" ? "Mine here" : label, hint: no ? `not yours — ${no}` : (via ? `work ${what} this ${bName(via)} serves` : `they work ${what} here — this one, not the nearest`) + (isVein(n) && !no ? ` (${veinStatus(w, team, n)})` : ""), refused: no || null }; };
  // the building clicked (its footprint; a wall stretch by its line)
  let hit = null, hd = Infinity;
  for (const b of B) {
    if (b.team !== team || b.ruin || b.field) continue;
    const d = b.x1 !== undefined ? segD(b, pt) - 6 : Math.hypot(b.x - pt.x, b.y - pt.y) - fp(b);
    if (d < 0 && d < hd) { hd = d; hit = b; }
  }
  if (hit) {
    if (hit.progress < 1) return { kind: "site", b: hit, label: "Build this", hint: `work on the ${bName(hit)} (${Math.round(hit.progress * 100)}% done)` };
    if (hit.hp < (hit.hpMax || hit.hp) * 0.99 && !(hit.fire > 0)) return { kind: "site", b: hit, label: "Repair this", hint: `mend the ${bName(hit)}` };
    if (CAMP_RES[hit.kind]) { const n = campNodeOf(w, hit); if (n) return nodeWork(n, hit); if (hit.kind === "mining_camp") return { kind: "camp", b: hit, node: null, label: "Mine here", hint: "work what this camp serves" }; } // (the realm's mirror may not know every vein: the server finds it)
    if (BUILDINGS[hit.kind]?.stores) return { kind: "store", b: hit, label: "Haul here", hint: `storemen at the ${bName(hit)}: take loads in, stack them, carry rations out` };
  }
  // a field the spot lies in
  const f = B.find((b) => b.team === team && b.field && !b.ruin && inField(b, pt));
  if (f) return { kind: "field", b: f, label: "Work this field", hint: `${f.field.crop || "the field"} · ${f.field.state || ""}${f.field.op ? ` · ${f.field.op}` : ""} — they work this field` };
  // the resource under the spot (its own reach; the nearest edge)
  let node = null, nd = Infinity;
  for (const n of w.resources || []) { if (!(n.amount > 0)) continue; const d = Math.hypot(n.x - pt.x, n.y - pt.y) - (n.r || 20); if (d < 25 && (d < nd || (d === nd && node && n.id < node.id))) { nd = d; node = n; } }
  return node ? nodeWork(node) : null;
}
function inField(b, p) { if (!(b.w > 0) || !(b.h > 0)) return Math.hypot(b.x - p.x, b.y - p.y) < 60; const r = b.rot || 0, c = Math.cos(r), s = Math.sin(r), dx = p.x - b.x, dy = p.y - b.y; return Math.abs(dx * c + dy * s) < b.w / 2 && Math.abs(dy * c - dx * s) < b.h / 2; } // (economy.inFieldRect)
function segD(b, p) { const dx = b.x2 - b.x1, dy = b.y2 - b.y1, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p.x - b.x1) * dx + (p.y - b.y1) * dy) / l2)); return Math.hypot(b.x1 + dx * t - p.x, b.y1 + dy * t - p.y); }

function attackLabel(c) {
  if (c.engines.length && !c.foot && !c.horse) return ["Attack", c.engines.some((u) => u.arm === "ram") ? "batter the gate or wall there" : c.engines.some((u) => u.arm === "siege_tower") ? "push the tower against the wall there" : "bombard what is there"];
  if (c.side === "defend" && c.enemyEngine) return ["Attack", "sally out and burn their engine, then back"];
  if (c.enemyGate && c.side === "attack") return ["Attack", "fire the gate (the ram does it better)"];
  if (c.enemyBuilding && c.enemyMen) return ["Attack", "drive them off, then burn the building"];
  if (c.enemyBuilding) return ["Attack", `burn the ${c.enemyBuilding.kind.replace(/_/g, " ")}`];
  return ["Attack", c.enemyMen ? "go for the enemy there" : "advance and fight what they meet"];
}

// map heading (x east, y north in sim coordinates) to a compass point
function compass(a) { const d = ((90 - a * 180 / Math.PI) % 360 + 360) % 360; return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(d / 45) % 8]; }
export function openOrderPopup(el, w, screen, point, onChoose, onCancel, opts = {}) {
  const A = analysePoint(w, point.x, point.y), c = opts.ctx || {};
  const pct = (v) => `${Math.round(v * 100)}%`;
  const btn = (kind, label, hint, cls = "") => `<button data-k="${kind}" class="${cls}">${label}<small>${hint}</small></button>`;
  // the main orders: what they can do here
  const main = [];
  if (c.herd) main.push(btn("hunt", "Hunt", `the ${c.herd.name} (${c.herd.n}) — ${c.soldiers ? "bring the kills home" : "a hunting crew"}`, "primary")); // (lane C)
  if (c.herd?.capture) main.push(btn("capture", "Capture young", c.herd.young ? `run down a juvenile ${c.herd.name} and pen it at the stables` : `no young among these ${c.herd.name}s just now — they breed in spring; a catch needs stables to pen it`, c.herd.young ? "primary" : "")); // (wildlife: docs/mounts-wildlife-spec.md)
  // villagers onto a place of work: the work is the first and main answer, marching there the second (the owner: "it just
  // says 'March here?' instead of 'work?'")
  const workFirst = c.villagers && (c.workshop || c.work) && !c.enemyMen;
  if (workFirst && c.workshop) main.push(btn("staff", "Work here", `they become the ${BUILDINGS[c.workshop.kind]?.name || c.workshop.kind}'s crew (up to ${BUILDINGS[c.workshop.kind]?.staff || 4})`, "primary"));
  if (workFirst && c.work) main.push(btn("work", c.work.label, c.work.hint, "primary"));
  if (c.soldiers !== false && (c.foot || c.horse || c.engines?.length)) main.push(btn("attack", ...attackLabel(c), (c.herd && !c.enemyMen) || workFirst ? "" : "primary"));
  if (c.vein && (c.foot || c.horse)) main.push(btn("move", "Take the vein", `${holderOf(c.vein) === null ? "nobody holds it" : `${holderName(w, c.vein)} holds it`}: stand there (${VEIN.r} m) with none of theirs left alive and your flag goes up in ${VEIN.hoistS} s`)); // (js/sim/veins.js)
  if (c.foot || c.horse || c.villagers) main.push(btn("move", workFirst ? "March here" : "March", workFirst ? "only go there (back to their work after)" : "go there in good order"));
  if (c.foot || c.horse) main.push(btn("hold", "Hold here", "form up and stand"));
  if (!workFirst && c.workshop) main.push(btn("staff", "Work here", `they become the ${BUILDINGS[c.workshop.kind]?.name || c.workshop.kind}'s crew (up to ${BUILDINGS[c.workshop.kind]?.staff || 4})`, "primary"));
  if (!workFirst && c.villagers && (c.work || c.site || c.resource)) main.push(btn("work", c.work?.label || (c.site ? "Build" : "Work"), c.work?.hint || (c.site ? "work on the site here" : "work the land or resource here")));
  if (c.packed) main.push(btn("assemble", "Assemble here", "frame the engine up on this spot"));
  // the rest, only where they apply
  const more = [];
  const castleEsc = (opts.castle || []).some((o) => o.kind === "escalade"); // ("Scale the wall here" is up in the castle section)
  if (c.foot && c.side !== "defend" && c.enemyWall) { if (!castleEsc) more.push(btn("escalade", "Ladders", "scale the wall there")); more.push(btn("mine", "Mine", "dig under that wall or tower")); }
  if (c.foot && c.side === "defend" && c.ownBreach) more.push(btn("barricade", "Barricade", "stop the breach with timber and rubble"));
  if (c.onWalls && !(opts.castle || []).some((o) => o.kind === "cs-tw-down")) main.push(btn("come_down", "Come down", "off the walls by the ladders and stairs; they form behind the wall"));
  if (c.foot && c.ownWalls && !(opts.castle || []).some((o) => o.kind === "cs-tw-all")) more.push(btn("man_walls", "Man the walls", "each company up onto the nearest stretch, bows first"));
  if (c.foot) more.push(btn("fortify", "Dig in", "ditch and stakes where they stand"));
  if (c.foot || c.light) more.push(btn("ambush", "Ambush", "hide, strike when they come close"));
  if (c.light) more.push(btn("skirmish", "Skirmish", "shoot and keep their distance"));
  if (c.scouts) more.push(btn("scout", "Scout", "look, report, avoid fights"));
  if (c.dragon?.summoned) { main.push(btn("dragon-move", "Dragon: fly here", `${c.dragon.name} wings to this spot and lands`, "primary")); main.push(btn("dragon-breathe", "Dragon: FIRE", c.dragon.near < 38 ? "a cone of flame across this ground" : "too far — fly it closer first", c.dragon.near < 38 ? "primary" : "")); }
  else if (c.dragon?.bonded && c.dragon.home) more.push(btn("dragon-summon", "Summon the dragon", `${c.dragon.name} takes wing for this spot`));
  for (const o of opts.siege || []) more.push(btn(o.kind, o.label, o.hint));
  // formations that suit the men selected (a shallow line is a long right-drag now)
  const fms = ["line", "deep", "column", "loose"]; if (c.horse || c.heavyFoot) fms.push("wedge"); if (c.points) fms.push("schiltron");
  el.innerHTML = `
    <button class="x" data-cancel title="Cancel (X)">✕</button>
    <h4>${c.work?.b ? BUILDINGS[c.work.b.kind]?.name || A.name : c.workshop ? BUILDINGS[c.workshop.kind]?.name || A.name : A.name} · ${Math.round(A.h)} m</h4>
    ${opts.facing !== undefined ? `<div class="facing"><span class="dial" style="transform:rotate(${(-opts.facing * 180 / Math.PI).toFixed(0)}deg)">➜</span> Facing ${compass(opts.facing)} · front about ${Math.round(opts.frontage)} m</div>` : `<div class="facing tip">Right-drag the ground to set their facing</div>`}
    <div class="terr">Rise ${A.prominence >= 0 ? "+" : ""}${A.prominence.toFixed(0)} m · slope ${Math.round(Math.atan(A.slope) * 57.3)}° · cover ${pct(A.cover)} · defensibility <b>${pct(A.defensible)}</b>${A.notes.length ? "<br>" + A.notes.slice(0, 2).map((n) => "• " + n).join("<br>") : ""}</div>
    ${opts.castle?.length ? `<div class="sub">${opts.castleTitle || "Castle"}</div><div class="grid siege">${opts.castle.map((o) => btn(o.kind, o.label, o.hint)).join("")}</div>` : ""}
    <div class="grid main">${main.join("")}</div>
    ${more.length ? `<div class="grid more">${more.join("")}</div>` : ""}
    <div class="seg"><span>Formation</span>${fms.map((k) => `<button data-f="${k}">${FORMATIONS[k].name.replace("Deep block", "Deep")}</button>`).join("")}</div>
    <div class="seg"><span>Pace</span><button data-p="march" class="on">March</button><button data-p="quick">Quick</button><button data-p="charge">Run</button></div>
    ${c.missile ? `<div class="seg"><span>Bows</span><button data-k="loose">At will</button><button data-k="volley">Volleys</button><button data-k="holdfire">Hold fire</button></div>` : ""}
    <label class="chain"><input type="checkbox" id="append" ${opts.append ? "checked" : ""}> Add as next step <small>Shift-click does this</small></label>`;
  let formation = null, pace = "march";
  el.querySelectorAll("[data-f]").forEach((b) => b.onclick = () => { formation = formation === b.dataset.f ? null : b.dataset.f; el.querySelectorAll("[data-f]").forEach((x) => x.classList.toggle("on", x.dataset.f === formation)); });
  el.querySelectorAll("[data-p]").forEach((b) => b.onclick = () => { pace = b.dataset.p; el.querySelectorAll("[data-p]").forEach((x) => x.classList.toggle("on", x === b)); });
  el.querySelectorAll("[data-k]").forEach((b) => b.onclick = () => { close(); onChoose({ kind: b.dataset.k, x: point.x, y: point.y, formation, pace, append: el.querySelector("#append").checked, word: b.firstChild?.textContent?.trim() }); }); // (word: the button's name, for the confirmation at the spot — main.js takes it off before the order goes out)
  el.querySelector("[data-cancel]").onclick = () => { close(); onCancel?.(); };
  el.hidden = false;
  const r = el.getBoundingClientRect();
  el.style.left = Math.min(screen.x + 12, innerWidth - r.width - 8) + "px";
  el.style.top = Math.max(8, Math.min(screen.y + 12, innerHeight - r.height - 8)) + "px";
  function close() { el.hidden = true; }
  return close;
}

// "Attack this body" — the popup after clicking an enemy with troops selected: in what formation, at what pace.
// info = { title, lines: [text], mounted: bool (selection has horse), missile: bool }. onChoose({ formation, pace })
let lastAtk = { formation: null, pace: null };
export function openAttackPopup(el, screen, info, onChoose, onCancel, opts = {}) {
  const fmBtn = (k, name) => `<button data-f="${k}" class="${(lastAtk.formation ?? "") === k ? "on" : ""}">${name}</button>`;
  const pace0 = lastAtk.pace || (info.mounted ? "charge" : "quick");
  el.innerHTML = `
    <button class="x" data-cancel title="Cancel (X)">✕</button>
    <h4>${info.title}</h4>
    <div class="terr">${info.lines.join("<br>")}</div>
    <div class="sub">Formation</div>
    <div class="grid" id="fm">${fmBtn("", "As they are")}${(info.formations || Object.keys(FORMATIONS)).map((k) => fmBtn(k, FORMATIONS[k].name.replace("Deep block", "Deep") + (k === "wedge" && info.mounted ? " ★" : ""))).join("")}</div>
    <div class="sub">Pace</div>
    <div class="grid" id="pc">${[["march", "March"], ["quick", "Quick"], ["charge", "Run / charge"]].map(([k, n]) => `<button data-p="${k}" class="${k === pace0 ? "on" : ""}">${n}</button>`).join("")}</div>
    <button class="go" data-go>${info.missile && !info.melee ? "Shoot at them" : "Attack!"} <small>Enter</small></button>
    ${opts.onOrdersHere ? `<a href="#" class="here" data-here>Orders at this spot instead… <small>⌥-click does this</small></a>` : ""}`;
  let formation = lastAtk.formation || null, pace = pace0;
  el.querySelectorAll("[data-f]").forEach((b) => b.onclick = () => { formation = b.dataset.f || null; el.querySelectorAll("[data-f]").forEach((x) => x.classList.toggle("on", x === b)); });
  el.querySelectorAll("[data-p]").forEach((b) => b.onclick = () => { pace = b.dataset.p; el.querySelectorAll("[data-p]").forEach((x) => x.classList.toggle("on", x === b)); });
  const go = () => { close(); lastAtk = { formation, pace }; onChoose({ formation, pace }); };
  el.querySelector("[data-go]").onclick = go;
  el.querySelector("[data-cancel]").onclick = () => { close(); onCancel?.(); };
  const here = el.querySelector("[data-here]"); if (here) here.onclick = (e) => { e.preventDefault(); close(); onCancel?.(); opts.onOrdersHere(); };
  const key = (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } };
  addEventListener("keydown", key);
  el.hidden = false;
  const r = el.getBoundingClientRect();
  el.style.left = Math.min(screen.x + 12, innerWidth - r.width - 8) + "px";
  el.style.top = Math.min(screen.y + 12, innerHeight - r.height - 8) + "px";
  function close() { el.hidden = true; removeEventListener("keydown", key); }
  return close;
}
