// Match flow: the start screen (after the banner), the siege banner in the top bar, and the end screen.
import { DISPOSITIONS } from "../sim/legend.js";
import * as EC from "../sim/economy.js";
import { drawBanner } from "./heraldry.js";

export const DIFFICULTY = {
  easy:   { name: "Easy", value: 0.35, note: "A slow, careful lord. Time to learn the land." },
  normal: { name: "Normal", value: 0.7, note: "He builds, musters and marches when the season says so." },
  hard:   { name: "Hard", value: 0.95, note: "Musters early, marches early, and spares nothing." },
};
const DISP_NOTE = {
  defensive: "holds good ground and waits to be attacked", aggressive: "rides out early and throws his men in",
  flanker: "works round your flanks", skirmish: "harasses with bows and won't close", ambusher: "waits in the woods",
  shock: "leads with his horse", inspiring: "keeps a steady line and picks his moment",
};

// Resolves { difficulty: 0..1, diffKey, disposition, hidden } — hidden when the enemy's temper is left to chance.
export function chooseMatch(el, mine, theirs) {
  return new Promise((resolve) => {
    let diff = "normal", disp = "random";
    try { diff = localStorage.getItem("hg.diff") || diff; disp = localStorage.getItem("hg.edisp") || disp; } catch { /* private mode */ }
    if (!DIFFICULTY[diff]) diff = "normal"; if (disp !== "random" && !DISPOSITIONS[disp]) disp = "random";
    el.innerHTML = `<div class="banner-pick start-pick"><div class="lg-kicker">HIGHGROUND · The Vale of Harrow</div><h2>The season's war</h2>
      <div class="sp-vs"><span class="sp-arms mine"></span><span class="sp-vs-t">Ashby <small>against</small> Rookham</span><span class="sp-arms theirs"></span></div>
      <p>Grow your vill, muster your men and break Rookham before the year turns. You lose if your keep is ruined, your town falls, or no one is left to you.</p>
      <div class="sub">Difficulty</div><div class="sp-row" data-g="diff">${Object.entries(DIFFICULTY).map(([k, d]) => `<button data-v="${k}"><b>${d.name}</b><small>${d.note}</small></button>`).join("")}</div>
      <div class="sub">The enemy lord</div><div class="sp-row sp-disp" data-g="disp"><button data-v="random"><b>Unknown</b><small>you'll learn his temper in the field</small></button>${Object.entries(DISPOSITIONS).map(([k, D]) => `<button data-v="${k}"><b>${D.name}</b><small>${DISP_NOTE[k] || ""}</small></button>`).join("")}</div>
      <div class="sp-go"><button data-start class="on">Begin the campaign</button><button data-battle title="No towns to run: choose a field on the Vale, the hosts and the weather — or fight Crécy, Stirling Bridge, Bannockburn, Courtrai or Agincourt">Fight a pitched battle ⚔</button><button data-siege title="A castle on the Vale: besiege it — engines, mines, ladders, the breach, the keep — or hold it against a host ten times your number">Lay siege ⚔</button></div></div>`;
    el.querySelector(".sp-arms.mine").append(drawBanner(mine, 48, 60)); el.querySelector(".sp-arms.theirs").append(drawBanner(theirs, 48, 60));
    const mark = () => {
      el.querySelectorAll('[data-g="diff"] [data-v]').forEach((b) => b.classList.toggle("on", b.dataset.v === diff));
      el.querySelectorAll('[data-g="disp"] [data-v]').forEach((b) => b.classList.toggle("on", b.dataset.v === disp));
    };
    el.querySelectorAll('[data-g="diff"] [data-v]').forEach((b) => b.onclick = () => { diff = b.dataset.v; mark(); });
    el.querySelectorAll('[data-g="disp"] [data-v]').forEach((b) => b.onclick = () => { disp = b.dataset.v; mark(); });
    el.querySelector("[data-battle]").onclick = () => { location.href = location.pathname + "?mode=battle&banner=" + mine.id; }; // (your banner comes with you: no second choosing)
    el.querySelector("[data-siege]").onclick = () => { location.href = location.pathname + "?mode=siege&banner=" + mine.id; };
    el.querySelector("[data-start]").onclick = () => {
      try { localStorage.setItem("hg.diff", diff); localStorage.setItem("hg.edisp", disp); } catch { /* ignore */ }
      el.hidden = true;
      const keys = Object.keys(DISPOSITIONS);
      resolve({ difficulty: DIFFICULTY[diff].value, diffKey: diff, disposition: disp === "random" ? keys[Math.floor(Math.random() * keys.length)] : disp, hidden: disp === "random" });
    };
    mark(); el.hidden = false;
  });
}

// ---------------------------------------------------------------- siege banner (top bar)
export function updateSiegeBar(el, w, PLAYER, townName) {
  const parts = [];
  for (const team of [PLAYER, 1 - PLAYER]) {
    const T = w.teams[team]; if (!T?.store) continue;
    if (T.fallen) { parts.push(`<span class="sg fell ${team === PLAYER ? "ours" : "theirs"}">${townName(team)} has fallen</span>`); continue; }
    if (!T.besieged) continue;
    const hall = w.buildings.find((b) => b.id === T.hall);
    if (team === PLAYER) {
      const days = Math.floor(EC.foodStock(T) / Math.max(1, EC.dailyFoodNeed(w, team)));
      const garrison = hall ? menNear(w, team, hall.x, hall.y, EC.E.investRadius) : 0;
      const storm = (T.sackT || 0) > 0.05 ? ` · <b class="warn">the gate is being stormed</b>` : "";
      parts.push(`<span class="sg ours" title="Invested: no gathering outside, no trade, no migrants. It falls if stormed or starved.">${townName(team)} besieged · <b class="${days < 10 ? "warn" : ""}">${days} days of food</b> · garrison ${garrison}${storm}</span>`);
    } else {
      const d = Math.floor(T.siegeDays || 0);
      const storm = (T.sackT || 0) > 0.05 ? " · our men are at the gate" : "";
      parts.push(`<span class="sg theirs" title="Their stores are their secret: hunger will tell.">${townName(team)} under siege · day ${d + 1}${storm}</span>`);
    }
  }
  const html = parts.join("");
  if (el._h !== html) { el._h = html; el.innerHTML = html; el.hidden = !html; }
}
function menNear(w, team, x, y, r) { let n = 0; for (const u of w.units.values()) if (u.team === team && !u.isWorkers && u.members.length && u.state !== "routing" && Math.hypot(u.ax - x, u.ay - y) < r) n += u.members.length; return n; }

// ---------------------------------------------------------------- end screen
export function showEnd(el, R, onNew) {
  const row = (label, a, b) => `<tr><th>${label}</th><td>${a}</td><td>${b}</td></tr>`;
  el.innerHTML = `<div class="lg-card end-card ${R.won ? "won" : "lost"}">
    <div class="lg-kicker">${R.won ? "Victory" : "Defeat"}</div>
    <h2>${R.headline}</h2><div class="lg-sub">${R.why}</div>
    <div class="end-meta">${R.days} days of war · ${R.realMin} minutes · ${R.battles} battle${R.battles === 1 ? "" : "s"} · the enemy lord was a <b>${R.enemyDisp}</b> (${R.diffName})</div>
    <table class="end-t"><tr><th></th><th>${R.names[0]}</th><th>${R.names[1]}</th></tr>
      ${row("Fallen", R.dead[0], R.dead[1])}${row("Wounded", R.wounded[0], R.wounded[1])}${row("Companies routed", R.routs[0], R.routs[1])}
      ${row("Men mustered", R.recruited[0], R.recruited[1])}${row("Buildings raised", R.built[0], R.built[1])}${row("Buildings lost", R.lost[0], R.lost[1])}
      ${row("Standing at the end", R.standing[0], R.standing[1])}${row("Spells worked", R.spells[0], R.spells[1])}</table>
    <div class="lg-choose">Legends</div>
    ${R.legends.length ? `<ul class="lg-feats end-leg">${R.legends.map((l) => `<li><b>${l.name}</b> — ${l.what}</li>`).join("")}</ul>` : `<p class="lg-note">No man of either side did anything the songs will remember.</p>`}
    <div class="lg-foot"><span></span><button data-new class="on">New game</button></div></div>`;
  el.hidden = false;
  el.querySelector("[data-new]").onclick = onNew;
}
