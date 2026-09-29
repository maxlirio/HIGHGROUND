// "What should they do there?" — the popup after clicking a destination with troops selected.
import { analysePoint } from "../sim/analysis.js";
import { FORMATIONS } from "../sim/arms.js";

import { ARMS } from "../sim/arms.js";

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
  c.resource = (w.resources || []).some((r) => r.amount > 0 && near(r.x, r.y, 60)) || B.some((b) => b.team === team && b.field && near(b.x, b.y, 80));
  return c;
}
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
  if (c.soldiers !== false && (c.foot || c.horse || c.engines?.length)) main.push(btn("attack", ...attackLabel(c), "primary"));
  if (c.foot || c.horse || c.villagers) main.push(btn("move", "March", "go there in good order"));
  if (c.foot || c.horse) main.push(btn("hold", "Hold here", "form up and stand"));
  if (c.villagers && (c.site || c.resource)) main.push(btn("work", c.site ? "Build" : "Work", c.site ? "work on the site here" : "work the land or resource here"));
  if (c.packed) main.push(btn("assemble", "Assemble here", "frame the engine up on this spot"));
  // the rest, only where they apply
  const more = [];
  if (c.foot && c.side !== "defend" && c.enemyWall) more.push(btn("escalade", "Ladders", "scale the wall there"), btn("mine", "Mine", "dig under that wall or tower"));
  if (c.foot && c.side === "defend" && c.ownBreach) more.push(btn("barricade", "Barricade", "stop the breach with timber and rubble"));
  if (c.foot) more.push(btn("fortify", "Dig in", "ditch and stakes where they stand"));
  if (c.foot || c.light) more.push(btn("ambush", "Ambush", "hide, strike when they come close"));
  if (c.light) more.push(btn("skirmish", "Skirmish", "shoot and keep their distance"));
  if (c.scouts) more.push(btn("scout", "Scout", "look, report, avoid fights"));
  for (const o of opts.siege || []) more.push(btn(o.kind, o.label, o.hint));
  // formations that suit the men selected (a shallow line is a long right-drag now)
  const fms = ["line", "deep", "column", "loose"]; if (c.horse || c.heavyFoot) fms.push("wedge"); if (c.points) fms.push("schiltron");
  el.innerHTML = `
    <button class="x" data-cancel title="Cancel (X)">✕</button>
    <h4>${A.name} · ${Math.round(A.h)} m</h4>
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
  el.querySelectorAll("[data-k]").forEach((b) => b.onclick = () => { close(); onChoose({ kind: b.dataset.k, x: point.x, y: point.y, formation, pace, append: el.querySelector("#append").checked }); });
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
export function openAttackPopup(el, screen, info, onChoose, onCancel) {
  const fmBtn = (k, name) => `<button data-f="${k}" class="${(lastAtk.formation ?? "") === k ? "on" : ""}">${name}</button>`;
  const pace0 = lastAtk.pace || (info.mounted ? "charge" : "quick");
  el.innerHTML = `
    <button class="x" data-cancel title="Cancel (X)">✕</button>
    <h4>${info.title}</h4>
    <div class="terr">${info.lines.join("<br>")}</div>
    <div class="sub">Formation</div>
    <div class="grid" id="fm">${fmBtn("", "As they are")}${Object.entries(FORMATIONS).map(([k, f]) => fmBtn(k, f.name + (k === "wedge" && info.mounted ? " ★" : ""))).join("")}</div>
    <div class="sub">Pace</div>
    <div class="grid" id="pc">${[["march", "March"], ["quick", "Quick"], ["charge", "Run / charge"]].map(([k, n]) => `<button data-p="${k}" class="${k === pace0 ? "on" : ""}">${n}</button>`).join("")}</div>
    <button class="go" data-go>${info.missile && !info.melee ? "Shoot at them" : "Attack!"} <small>Enter</small></button>`;
  let formation = lastAtk.formation || null, pace = pace0;
  el.querySelectorAll("[data-f]").forEach((b) => b.onclick = () => { formation = b.dataset.f || null; el.querySelectorAll("[data-f]").forEach((x) => x.classList.toggle("on", x === b)); });
  el.querySelectorAll("[data-p]").forEach((b) => b.onclick = () => { pace = b.dataset.p; el.querySelectorAll("[data-p]").forEach((x) => x.classList.toggle("on", x === b)); });
  const go = () => { close(); lastAtk = { formation, pace }; onChoose({ formation, pace }); };
  el.querySelector("[data-go]").onclick = go;
  el.querySelector("[data-cancel]").onclick = () => { close(); onCancel?.(); };
  const key = (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } };
  addEventListener("keydown", key);
  el.hidden = false;
  const r = el.getBoundingClientRect();
  el.style.left = Math.min(screen.x + 12, innerWidth - r.width - 8) + "px";
  el.style.top = Math.min(screen.y + 12, innerHeight - r.height - 8) + "px";
  function close() { el.hidden = true; removeEventListener("keydown", key); }
  return close;
}
