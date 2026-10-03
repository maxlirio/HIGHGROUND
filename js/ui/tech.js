// The TECH TREE (research at the keep: js/sim/tech.js, docs/tech.md). One column per branch, the studies laid out by
// depth (a study sits below what it needs), lines from each prerequisite. Every card says where it stands — learned,
// being studied (with its progress), can be studied now, or locked and why — what it costs, how long it takes and what
// it changes. Click a card's button to study it (only while a desk is free: there is no queue, and a finished study
// leaves its desk idle until you pick the next) or to set it aside. Everything is read from the sim; the command goes through `run` (js/game/commands.js, or the realm
// server's — so the same panel works on a realm client, whose mirror carries T.tech).
import * as TC from "../sim/tech.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ITEMS = new Set(["lances", "staves", "cloth"]);
const amt = (r, n) => r === "silver" ? `${n.toLocaleString("en")} d` : r === "mana" ? `${n} mana` : ITEMS.has(r) ? `${n} ${r}` : n >= 1000 ? `${(n / 1000).toLocaleString("en")} t ${r}` : `${n} kg ${r}`;
const costOf = (t, T) => Object.entries(t.cost).map(([r, n]) => `<span class="${(T.store?.[r] || 0) < n ? "short" : ""}">${amt(r, n)}</span>`).join(" · ");
const days = (d) => d === Infinity ? "stopped" : d < 1 ? "under a day" : `${d.toFixed(d < 10 ? 1 : 0)} days`;
const LABEL = { done: "Learned", active: "Studying", open: "Can study", locked: "Locked" };

let timer = 0;
// el: the panel element; run(op, args, done): the command layer; say(msg): a toast
export function showTechTree(el, w, team, run, say = () => {}) {
  let sig = "", hover = null;
  const render = () => {
    const T = w.teams[team]; if (!T) return;
    const S = T.tech || { done: {}, active: [] };
    const st = Object.fromEntries(TC.TECH_IDS.map((id) => [id, TC.statusOf(w, team, id)]));
    const nextSig = JSON.stringify([S.done, S.active.map((a) => a.id), Object.values(st).map((x) => x.s + (x.why || "")), TC.desks(w, team)]);
    if (nextSig === sig && el.querySelector(".tt-grid")) { live(); return; }
    sig = nextSig;
    const nDesks = TC.desks(w, team), learned = Object.keys(S.done).length;
    let html = `<button class="x" data-close>✕</button>
      <div class="tt-head"><h3>Research <small>at the Keep</small></h3>
      <div class="tt-sum">${learned} of ${TC.TECH_IDS.length} learned · ${nDesks} desk${nDesks > 1 ? "s" : ""}${T.besieged ? " · <b class='warn'>invested: study at half speed</b>" : ""}</div></div>
      <div class="tt-desks">`;
    for (let k = 0; k < nDesks; k++) {
      const a = S.active[k];
      html += a ? `<div class="tt-desk on" data-desk="${a.id}"><span class="lbl">Desk ${k + 1}</span><b>${esc(TC.TECHS[a.id].name)}</b><span class="tt-bar"><i style="width:${Math.round(a.t / a.days * 100)}%"></i></span><span class="pct">${Math.round(a.t / a.days * 100)}% · ${days(TC.daysLeft(w, T, a))} left</span><button data-cancel="${a.id}" title="Abandon it: what it cost comes back to the store">Set aside</button></div>`
        : `<div class="tt-desk"><span class="lbl">Desk ${k + 1}</span><i>idle — pick the next study below</i></div>`;
    }
    html += `</div><div class="tt-legend">${["done", "active", "open", "locked"].map((s) => `<span class="k ${s}">${LABEL[s]}</span>`).join("")}<span class="note">Stages gate buildings; studies are knowledge you choose. Cost is paid when a study starts. No queue: a finished study leaves its desk idle until you choose the next.</span></div>`;
    // one column per branch, each an OUTLINE: a study, then (indented under it) what it leads to
    html += `<div class="tt-wrap"><svg class="tt-lines"></svg><div class="tt-grid">`;
    for (const B of TC.BRANCHES) {
      html += `<div class="tt-colwrap"><div class="tt-col"><b>${esc(B.name)}</b><small>${esc(B.blurb)}</small></div><div class="tt-cell">`;
      for (const [id, depth] of outline(B.id)) html += card(w, T, id, st[id], depth);
      html += `</div></div>`;
    }
    html += `</div></div><div class="tt-detail">${hover ? detail(hover) : "<i>Hover a study for its history.</i>"}</div>`;
    el.innerHTML = html; el.hidden = false; el.dataset.kind = "tech";
    el.querySelector("[data-close]").onclick = close;
    el.querySelectorAll("[data-study]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); const id = b.dataset.study; run("research", { id }, (r) => { say(r.ok ? r.msg : r.error); sig = ""; render(); }); });
    el.querySelectorAll("[data-cancel]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); run("research", { id: b.dataset.cancel, cancel: true }, (r) => { say(r.ok ? r.msg : r.error); sig = ""; render(); }); });
    el.querySelectorAll(".tt-card").forEach((c) => c.onmouseenter = () => { hover = c.dataset.id; el.querySelector(".tt-detail").innerHTML = detail(hover); });
    lines();
  };
  const detail = (id) => { const t = TC.TECHS[id]; return `<b>${esc(t.name)}</b> — ${esc(t.desc)}`; };
  // the prerequisite lines: from the bottom of what is needed to the top of what needs it
  const lines = () => {
    const wrap = el.querySelector(".tt-wrap"), svg = el.querySelector(".tt-lines"); if (!wrap || !svg) return;
    const R0 = wrap.getBoundingClientRect(); svg.setAttribute("width", R0.width); svg.setAttribute("height", wrap.scrollHeight);
    const box = (id) => { const c = wrap.querySelector(`.tt-card[data-id="${id}"]`); if (!c) return null; const r = c.getBoundingClientRect(); return { top: r.top - R0.top, bot: r.bottom - R0.top, l: r.left - R0.left }; };
    const T = w.teams[team], done = T.tech?.done || {};
    let p = "";
    for (const id of TC.TECH_IDS) for (const n of TC.TECHS[id].needs) {
      if (TC.TECHS[n].branch !== TC.TECHS[id].branch) continue; // (a need in another branch is said in words on the card)
      const a = box(n), b = box(id); if (!a || !b) continue;
      const x = a.l + 10, y = b.top + 14;
      p += `<path d="M${x},${a.bot} L${x},${y - 4} Q${x},${y} ${x + 4},${y} L${b.l},${y}" class="${done[n] ? "lit" : ""}"/><circle cx="${b.l}" cy="${y}" r="2.5" class="${done[n] ? "lit" : ""}"/>`;
    }
    svg.innerHTML = p;
  };
  // progress in place (no re-render: the hover and the lines stay)
  const live = () => {
    const T = w.teams[team];
    for (const a of T.tech?.active || []) {
      const pct = Math.round(a.t / a.days * 100);
      el.querySelectorAll(`[data-desk="${a.id}"] .tt-bar i, .tt-card[data-id="${a.id}"] .tt-bar i`).forEach((i) => { i.style.width = pct + "%"; });
      el.querySelectorAll(`[data-desk="${a.id}"] .pct`).forEach((s) => { s.textContent = `${pct}% · ${days(TC.daysLeft(w, T, a))} left`; });
      el.querySelectorAll(`.tt-card[data-id="${a.id}"] .st`).forEach((s) => { s.textContent = `Studying · ${pct}% · ${days(TC.daysLeft(w, T, a))} left`; });
    }
  };
  const close = () => { el.hidden = true; el.dataset.kind = ""; clearInterval(timer); timer = 0; removeEventListener("resize", lines); };
  clearInterval(timer); render();
  timer = setInterval(() => { if (el.hidden || el.dataset.kind !== "tech") { clearInterval(timer); timer = 0; return; } render(); }, 1000);
  addEventListener("resize", lines);
  return { close, render };
}

// a branch as an outline: [id, depth] — each study followed by what it leads to in the same branch (depth-first)
function outline(branch) {
  const ids = TC.TECH_IDS.filter((id) => TC.TECHS[id].branch === branch), out = [], seen = new Set();
  const parent = (id) => TC.TECHS[id].needs.find((n) => TC.TECHS[n].branch === branch) || null;
  const visit = (id, d) => { if (seen.has(id)) return; seen.add(id); out.push([id, d]); for (const c of ids) if (parent(c) === id) visit(c, d + 1); };
  for (const id of ids) if (!parent(id)) visit(id, 0);
  return out;
}

function card(w, T, id, st, depth = 0) {
  const t = TC.TECHS[id];
  const free = TC.deskFree(w, T.id ?? 0), busy = TC.desks(w, T.id ?? 0) > 1 ? "Both desks are busy" : "The desk is busy";
  const status = st.s === "active" ? `Studying · ${Math.round(st.p * 100)}% · ${days(st.left)} left` : st.s === "locked" ? st.why : st.s === "open" ? (st.why ? `Can study — ${st.why}` : free ? "Can study now" : `Can study — ${busy.toLowerCase()}`) : `Learned${T.tech?.done?.[id] > 1 ? ` · day ${Math.round(T.tech.done[id]) % 365}` : ""}`;
  // the button: Study only when it can start NOW (a desk free, the store able to pay); otherwise a greyed note why not
  const act = st.s === "done" || st.s === "locked" ? "" : st.s === "active" ? `<button data-cancel="${id}" title="Abandon it: the cost comes back">Set aside</button>`
    : free && !st.why ? `<button data-study="${id}" class="go" title="Start now: the cost is paid from the store">Study</button>`
    : `<button disabled class="wait" title="${esc(free ? st.why : `${busy}: when a study finishes, its desk waits for you to choose the next`)}">${free ? "Can't pay" : "A desk is busy"}</button>`;
  const needs = [t.stage ? `${["", "Village", "Stockaded", "Town"][t.stage]} stage` : "", ...t.needs.map((n) => TC.TECHS[n].name), t.building ? t.building.replace(/_/g, " ") : ""].filter(Boolean);
  return `<div class="tt-card ${st.s}${act.includes('class="wait"') ? " wait" : ""}" data-id="${id}" style="margin-left:${depth * 18}px" title="${esc(t.desc)}">
    <div class="nm">${esc(t.name)}</div>${act}
    <div class="st">${esc(status)}</div>
    ${st.s === "active" ? `<span class="tt-bar"><i style="width:${Math.round(st.p * 100)}%"></i></span>` : ""}
    <div class="fx">${esc(t.effect)}</div>
    ${st.s === "done" ? "" : `<div class="ct">${costOf(t, T)} · ${t.days} days${needs.length && st.s !== "locked" ? ` · <span class="nd">needs ${esc(needs.join(", "))}</span>` : ""}</div>`}</div>`;
}

// the keep's panel: what the clerk is studying (js/ui/town.js shows it under the keep)
export function keepResearchHTML(w, team) {
  const T = w.teams[team], S = T?.tech; if (!T?.store) return "";
  const rows = (S?.active || []).map((a) => `<div class="row">${esc(TC.TECHS[a.id].name)} <b>${Math.round(a.t / a.days * 100)}%</b> · ${days(TC.daysLeft(w, T, a))} left</div><div class="bar"><i style="width:${Math.round(a.t / a.days * 100)}%"></i></div>`).join("");
  const idle = TC.desks(w, team) - (S?.active?.length || 0);
  const q = rows && idle > 0 ? `<div class="row small">A desk is idle: choose the next study.</div>` : "";
  const n = Object.keys(S?.done || {}).length;
  return `<div class="sub">Research</div>${rows || `<div class="row small">The clerk's desk is idle: choose a study.</div>`}${q}<div class="row small">${n} of ${TC.TECH_IDS.length} studies learned.</div><button data-techtree>Research…</button>`;
}
