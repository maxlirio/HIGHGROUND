// Town interface: resource bar, building panel (recruit / workshop / status) and the build menu.
// Everything here reads and calls the economy (js/sim/economy.js); nothing is faked in the UI.
import * as EC from "../sim/economy.js";
import { ARMS } from "../sim/arms.js";
import { glyphSVG } from "./glyphs.js";
import { landAt, buildEffects } from "../sim/land.js";
import { STAGES, stageStatus, stageOfKind } from "../sim/townplan.js";

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
    ["Silver", `${n0(s.silver)} d`], ["Gold", n0(s.gold)], ["Timber", kg(s.timber || 0)], ["Stone", kg(s.stone || 0)],
    ["Iron", kg(s.iron || 0)], ["Arrows", n0(s.arrows)], ["Mana", n0(s.mana)],
    ["People", hc ? n0(hc.labour + hc.soldiers + (T.dependants || 0)) : "—"],
  ];
  el.innerHTML = items.map(([k, v, c]) => `<span class="${c || ""}"><b>${k}</b>${v}</span>`).join("")
    + `<span class="date"><b>${SEASON(w.econ.doy)}</b>${dateOf(w.econ.doy)}</span>`;
}

// ---------------------------------------------------------------- building panel
export function showBuildingPanel(el, w, b, team, onChange) {
  const def = EC.BUILDINGS[b.kind] || {}, T = w.teams[b.team];
  const mine = b.team === team;
  const stage = b.ruin ? "Ruined" : b.progress >= 1 ? "Complete" : `Under construction · ${Math.round(b.progress * 100)}%`;
  let html = `<button class="x" data-close>✕</button><h3>${def.name || b.kind}</h3>
    <div class="row">${stage}</div><div class="bar"><i style="width:${Math.round((b.hp / (def.hp || 1)) * 100)}%"></i></div>`;
  if (mine && EC.complete(b) && def.recruits?.length) {
    html += `<div class="sub">Recruit</div><div class="recruits">` + def.recruits.map((arm) => {
      const R = EC.RECRUITS[arm], can = EC.canRecruit(w, team, arm), A = ARMS[arm];
      const gear = Object.entries(R.gear).map(([g, q]) => `${q} ${g}`).join(", ");
      if (R.perUnit) return `<div class="rec"><span class="gl">${glyphSVG(A?.glyph || "spear")}</span><div><b>${A?.name || arm}</b><small>${gear} · crew of ${R.crew} (from ${R.from.join("/")}) · pay ${R.pay}d/day each</small></div>
        <div class="btns"><button data-rec="${arm}" data-n="1" ${can < 1 ? "disabled" : ""}>Crew one</button></div><span class="can">${can} ready</span></div>`;
      return `<div class="rec"><span class="gl">${glyphSVG(A?.glyph || "spear")}</span><div><b>${A?.name || arm}</b><small>${gear} · ${R.days} days · pay ${R.pay}d/day · from ${R.from.join("/")}</small></div>
        <div class="btns"><button data-rec="${arm}" data-n="10" ${can < 1 ? "disabled" : ""}>+10</button><button data-rec="${arm}" data-n="1" ${can < 1 ? "disabled" : ""}>+1</button>${R.rushedDays ? `<button data-rec="${arm}" data-n="10" data-rush="1" ${can < 1 ? "disabled" : ""} title="Rushed: ${R.rushedDays} days, worse training">Rush</button>` : ""}</div>
        <span class="can">${can} ready</span></div>`;
    }).join("") + `</div>`;
    if (b.queue?.length) html += `<div class="sub">Training</div>` + b.queue.map((q) => `<div class="row">${q.engines ? `${q.engines} × ${ARMS[q.arm]?.name || q.arm} (crew ${q.count})` : `${q.count} × ${ARMS[q.arm]?.name || q.arm}`} <b>${Math.round((q.t / (q.days || 1)) * 100)}%</b></div>`).join("");
    if (b.kind === "siege_workshop") html += `<div class="row small">In store: ${["trebuchet_gear", "mangonels", "springalds", "rams", "siege_towers", "mantlets", "ladders", "rope"].map((g) => `${Math.floor(T.store[g] || 0)} ${g.replace("_", " ")}`).join(" · ")}</div>`;
  }
  const recipes = EC.RECIPES[b.kind];
  if (mine && EC.complete(b) && recipes) {
    html += `<div class="sub">Workshop makes</div><div class="grid">` + Object.keys(recipes).filter((p) => typeof recipes[p] === "object").map((p) => `<button data-make="${p}" class="${b.make === p ? "on" : ""}">${p}</button>`).join("") + `</div>`;
  }
  if (b.field) html += `<div class="row">${b.field.crop} · ${b.field.state} · ${kg(b.field.left || 0)} standing</div>`;
  el.innerHTML = html; el.hidden = false;
  el.querySelector("[data-close]").onclick = () => { el.hidden = true; };
  el.querySelectorAll("[data-rec]").forEach((bt) => bt.onclick = () => {
    const got = EC.queueRecruit(w, b, bt.dataset.rec, +bt.dataset.n, { rushed: !!bt.dataset.rush });
    onChange?.(got ? `Mustering ${got} ${ARMS[bt.dataset.rec]?.name || bt.dataset.rec}` : "Not enough men or gear");
    showBuildingPanel(el, w, b, team, onChange);
  });
  el.querySelectorAll("[data-make]").forEach((bt) => bt.onclick = () => { EC.setProduct(w, b, bt.dataset.make); showBuildingPanel(el, w, b, team, onChange); });
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
      const c = Object.entries(cost).map(([r, v]) => `${r === "silver" ? n0(v) + "d" : kg(v)} ${r === "silver" ? "" : r}`).join(" · ");
      return `<button data-b="${k}" ${open ? "" : "disabled"} class="${ok ? "" : "poor"}"><b>${d.name}</b><small>${c || "free"}${d.perMetre ? " per 45 m stretch" : ""} · ${n0(d.labour)} man-days</small></button>`;
    }).join("") + `</div>`;
  });
  html += `<div class="hint">Marked spots show where the chosen building can go; camps go beside what they work; walls follow the planned circuit.</div>`;
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
