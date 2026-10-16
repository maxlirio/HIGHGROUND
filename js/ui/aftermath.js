// The reckoning after a battle: the verdict and the decisive factor in plain words, a minimap replay of the
// companies' movements with the key moments on its timeline, the chronicle, casualties by side, troop type and
// cause, the men and companies who distinguished themselves — and, for a historical battle, what really happened.
//   showAftermath(el, { w, battle, story, map, onClose, onAgain, onNew })
import { ARMS, ARM_BY_ID } from "../sim/arms.js";
import { CAUSE } from "../sim/battle-record.js";
import { valeMap, w2c, mapLabels } from "./vale-map.js";
import { glyphSVG } from "./glyphs.js";

const RPX = 400;
// a team colour that reads on the dark card (a black or navy field is lightened, keeping its hue)
function readable(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return hex || "#ccc";
  const n = parseInt(m[1], 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, k = L < 0.35 ? (0.35 - L) / 0.65 + 0.35 : 0;
  r = Math.round(r + (255 - r) * k); g = Math.round(g + (255 - g) * k); b = Math.round(b + (255 - b) * k);
  return `rgb(${r},${g},${b})`;
}
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const CAUSE_COL = { arrows: "#c9a44a", blades: "#b8b2a6", horse: "#8f6a4a", rout: "#a8483a", press: "#6b4a6e", drown: "#4a7da8", wounds: "#7a6a5a", quarter: "#5a2a2a", works: "#6f8a3a", stones: "#888" };

export function showAftermath(el, { w, battle: B, story, map, onClose, onAgain, onNew }) {
  const rec = B.rec, P = B.PLAYER, O = rec.outcome || { winner: -1, loser: -1, why: "the fighting died away" }, N = B.names, cfg = B.cfg;
  rec.finalise?.();
  const won = O.winner === P, isDraw = O.winner < 0, dur = rec.frames.at(-1)?.t || 0;
  const sides = [P, 1 - P];
  const moments = rec.moments.filter((m) => m.kind !== "advance" && (m.sal >= 0.45 || m.kind === "contact" || m.kind === "end"));
  const S0 = cfg.scenario;
  // ---- casualties
  const C = (tm) => rec.cas[tm];
  const causes = Object.keys(CAUSE).filter((k) => sides.some((tm) => C(tm).byCause[k]));
  const maxCause = Math.max(1, ...sides.flatMap((tm) => causes.map((k) => C(tm).byCause[k] || 0)));
  const armsIn = (tm) => { const by = {}; for (const U of rec.units.values()) if (U.team === tm) { by[U.arm] ||= { n: 0, lost: 0 }; by[U.arm].n += U.n0; } for (const [a, v] of Object.entries(C(tm).byArm)) { by[a] ||= { n: 0, lost: 0 }; by[a].lost = v.dead + v.wounded; } return by; }; // (lost = killed + down: out of the fight)
  const verdict = isDraw ? "Nightfall" : won ? "Victory" : "Defeat";
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const tc = [readable(css("--t0")), readable(css("--t1"))], tcOf = (tm) => tc[tm === P ? 0 : 1];
  el.innerHTML = `<div class="am-card ${isDraw ? "draw" : won ? "won" : "lost"}">
    <div class="am-head"><div><div class="lg-kicker">${verdict}${S0 ? ` · ${S0.date}` : ""} · ${mmss(dur)} of fighting</div>
      <h2>${cfg.name || "The battle"}</h2>${story.placeName ? `<div class="am-remember">remembered as <b>${cap(story.placeName.name)}</b></div>` : ""}
      <div class="lg-sub">${isDraw ? cap(O.why) + "." : `${cap(N.side(O.winner))} held the field — ${O.why}.`}</div></div>
      <div class="am-btns"><button data-close>Return to the field</button><button data-again>Fight it again</button><button data-new class="on">A new battle</button></div></div>
    <div class="am-factor"><div class="am-sub">What decided it</div><p>${story.factor.text}</p>${story.factor.also ? `<p class="am-also">${story.factor.also.text}</p>` : ""}</div>
    <div class="am-grid">
      <div class="am-replay"><div class="am-sub">The battle, replayed</div>
        <div class="am-rmap"><canvas width="${RPX}" height="${RPX}"></canvas></div>
        <div class="am-rbar"><button data-play>▶</button><div class="am-track"><input type="range" min="0" max="${Math.max(1, rec.frames.length - 1)}" value="0" step="1">${moments.map((m) => `<i class="am-tick ${m.good === P ? "good" : m.good === 1 - P ? "bad" : ""}" style="left:${(m.t / Math.max(1, dur) * 100).toFixed(1)}%" title="${mmss(m.t)} · ${m.kicker}"></i>`).join("")}</div><span class="am-rt">0:00</span></div>
        <div class="am-leg"><span><i class="t0" style="outline:1px solid #fff8"></i>${cap(N.side(P))}</span><span><i class="t1" style="outline:1px solid #fff8"></i>${cap(N.side(1 - P))}</span><span><i class="rt"></i>in flight</span><span><i class="ft"></i>in contact</span></div>
      </div>
      <div class="am-story"><div class="am-sub">The chronicle</div><p class="am-chron">${story.chronicle}</p>
        <div class="am-sub">The course of the day</div>
        <ol class="am-tl">${moments.map((m, i) => `<li data-m="${i}" class="${m.good === P ? "good" : m.good === 1 - P ? "bad" : ""}"><span class="t">${mmss(m.t)}</span><b>${m.kicker}</b> ${m.text}</li>`).join("")}</ol></div>
    </div>
    <div class="am-grid am-grid3">
      <div><div class="am-sub">The count</div><table class="am-t"><tr><th></th>${sides.map((tm) => `<th style="color:${tcOf(tm)}">${cap(N.side(tm))}</th>`).join("")}</tr>
        ${[["Brought to the field", (tm) => rec.start[tm]], ["Lost (killed + wounded)", (tm) => C(tm).dead + C(tm).wounded], ["Killed", (tm) => C(tm).dead], ["Wounded", (tm) => C(tm).wounded], ["Taken for ransom", (tm) => C(tm).captured], ["Fled the field", (tm) => C(tm).fled], ["Standing at the end", (tm) => C(tm).standing ?? "—"]]
          .map(([l, f]) => `<tr><th>${l}</th>${sides.map((tm) => `<td>${f(tm)}</td>`).join("")}</tr>`).join("")}</table></div>
      <div><div class="am-sub">How they died</div><div class="am-causes">${causes.map((k) => `<div class="am-cause"><span class="nm">${CAUSE[k]}</span>${sides.map((tm) => `<span class="bar t${tm === P ? 0 : 1}"><i style="width:${((C(tm).byCause[k] || 0) / maxCause * 100).toFixed(1)}%; background:${CAUSE_COL[k]}"></i><b>${C(tm).byCause[k] || 0}</b></span>`).join("")}</div>`).join("") || `<p class="am-note">Hardly a man died.</p>`}</div></div>
      <div><div class="am-sub">By troop type</div>${sides.map((tm) => `<div class="am-arms"><div class="am-an">${cap(N.side(tm))}</div>${Object.entries(armsIn(tm)).filter(([, v]) => v.n).map(([a, v]) => `<span class="am-arm" title="${ARMS[a]?.name}: ${v.lost} of ${v.n} killed or wounded"><span class="gbadge t${tm === P ? 0 : 1}">${glyphSVG(ARMS[a]?.glyph)}</span>${v.lost}<small>/${v.n}</small></span>`).join("")}</div>`).join("")}</div>
    </div>
    <div class="am-grid">
      <div><div class="am-sub">Who distinguished themselves</div>${story.legends.length ? `<ul class="am-leg-l">${story.legends.map((l) => `<li class="${l.team === P ? "ours" : "theirs"}"><b>${l.name}</b> <small>${l.arm}, ${N.side(l.team)}${l.rank ? " · " + ["", "veteran", "champion", "captain"][Math.min(3, l.rank)] : ""}</small><br>${l.deed ? cap(l.deed) + ". " : ""}Felled ${l.kills}.${l.alive ? "" : " <i>Did not live to see the end.</i>"}</li>`).join("")}</ul>` : `<p class="am-note">No man did anything the songs will remember.</p>`}</div>
      <div><div class="am-sub">Companies</div><ul class="am-hon">${story.honours.map((h) => `<li class="${h.team === P ? "ours" : "theirs"}"><b>${h.title}</b> ${h.text}</li>`).join("")}</ul>
        ${S0 ? `<div class="am-sub">What really happened in ${S0.year}</div><p class="am-hist">${S0.history}</p>` : ""}</div>
    </div></div>`;
  el.hidden = false; el.classList.add("am-modal");
  el.querySelector("[data-close]").onclick = () => { stop(); el.hidden = true; el.classList.remove("am-modal"); onClose?.(); };
  el.querySelector("[data-again]").onclick = () => { stop(); onAgain?.(); };
  el.querySelector("[data-new]").onclick = () => { stop(); onNew?.(); };
  // ---- the replay: the battlefield, the companies every ~2 s
  const cv = el.querySelector(".am-rmap canvas"), g = cv.getContext("2d");
  const all = rec.frames.flatMap((f) => { const o = []; for (let k = 0; k < f.u.length; k += 7) o.push([f.u[k + 3], f.u[k + 4]]); return o; });
  let x0 = Math.min(...all.map((p) => p[0]), B.zones[0].cx, B.zones[1].cx), x1 = Math.max(...all.map((p) => p[0]), B.zones[0].cx, B.zones[1].cx);
  let y0 = Math.min(...all.map((p) => p[1]), B.zones[0].cy, B.zones[1].cy), y1 = Math.max(...all.map((p) => p[1]), B.zones[0].cy, B.zones[1].cy);
  const side = Math.max(700, x1 - x0, y1 - y0) + 260, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const box = { x0: cx - side / 2, y0: cy - side / 2, x1: cx + side / 2, y1: cy + side / 2 };
  const bg = valeMap(map, RPX, box), toC = w2c(map, RPX, box), labels = mapLabels(map).filter((L) => L.x > box.x0 && L.x < box.x1 && L.y > box.y0 && L.y < box.y1);
  const colT = [getComputedStyle(document.documentElement).getPropertyValue("--t0").trim() || "#2f5fa8", getComputedStyle(document.documentElement).getPropertyValue("--t1").trim() || "#a8322f"];
  const scale = RPX / side;
  function draw(fi) {
    const f = rec.frames[Math.max(0, Math.min(rec.frames.length - 1, fi))]; if (!f) return;
    g.drawImage(bg, 0, 0); g.fillStyle = "rgba(10,8,5,.18)"; g.fillRect(0, 0, RPX, RPX);
    g.font = "italic 10px Georgia, serif"; g.textAlign = "center"; g.fillStyle = "rgba(245,235,210,.75)";
    for (const L of labels) { const [lx, ly] = toC(L.x, L.y); g.fillText(L.name, lx, ly); }
    // trails: where each company has been
    const past = rec.frames.slice(Math.max(0, fi - 30), fi + 1), tr = new Map();
    for (const q of past) for (let k = 0; k < q.u.length; k += 7) { const id = q.u[k]; if (!tr.has(id)) tr.set(id, { team: q.u[k + 1], pts: [] }); tr.get(id).pts.push(toC(q.u[k + 3], q.u[k + 4])); }
    for (const { team, pts } of tr.values()) { if (pts.length < 2) continue; g.strokeStyle = colT[team === P ? 0 : 1] + "88"; g.lineWidth = 1.2; g.beginPath(); pts.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b))); g.stroke(); }
    for (let k = 0; k < f.u.length; k += 7) {
      const team = f.u[k + 1], arm = ARM_BY_ID[f.u[k + 2]], [px, py] = toC(f.u[k + 3], f.u[k + 4]), n = f.u[k + 5], st = f.u[k + 6];
      const r = Math.max(2.5, Math.sqrt(n) * 1.1 * scale * 2.2), c = colT[team === P ? 0 : 1];
      g.globalAlpha = st === 2 ? 0.5 : 1;
      g.beginPath(); if (arm?.mounted) { g.moveTo(px, py - r * 1.2); g.lineTo(px + r, py); g.lineTo(px, py + r * 1.2); g.lineTo(px - r, py); g.closePath(); } else g.rect(px - r, py - r * 0.6, r * 2, r * 1.2);
      if (st === 2) { g.strokeStyle = c; g.lineWidth = 1.5; g.stroke(); } else { g.fillStyle = c; g.fill(); g.strokeStyle = "rgba(255,255,255,.75)"; g.lineWidth = 1; g.stroke(); }
      if (st === 3) { g.strokeStyle = "#ffd98a"; g.lineWidth = 1.2; g.beginPath(); g.arc(px, py, r + 3, 0, 7); g.stroke(); }
      g.globalAlpha = 1;
    }
    // the moments near this time
    for (const m of moments) if (m.x !== undefined && Math.abs(m.t - f.t) < 12) { const [mx, my] = toC(m.x, m.y); g.fillStyle = "#fff4c8"; g.strokeStyle = "#000"; g.lineWidth = 2; g.font = "bold 12px Georgia, serif"; g.strokeText("✶", mx, my + 4); g.fillText("✶", mx, my + 4); }
    el.querySelector(".am-rt").textContent = mmss(f.t);
    el.querySelector(".am-track input").value = String(fi);
  }
  let fi = 0, playing = null;
  const seek = (i) => { fi = i; draw(fi); };
  const stop = () => { if (playing) cancelAnimationFrame(playing); playing = null; el.querySelector("[data-play]").textContent = "▶"; };
  el.querySelector(".am-track input").oninput = (e) => { stop(); seek(+e.target.value); };
  el.querySelector("[data-play]").onclick = () => {
    if (playing) return stop();
    if (fi >= rec.frames.length - 1) fi = 0;
    el.querySelector("[data-play]").textContent = "❚❚"; let last = performance.now(), acc = 0;
    const per = Math.max(0.02, 30 / Math.max(1, rec.frames.length)); // the whole battle in ~30 s
    const tick = (t) => { acc += (t - last) / 1000; last = t; while (acc > per) { acc -= per; fi++; } if (fi >= rec.frames.length - 1) { seek(rec.frames.length - 1); stop(); return; } draw(fi); playing = requestAnimationFrame(tick); };
    playing = requestAnimationFrame(tick);
  };
  el.querySelectorAll(".am-tl [data-m]").forEach((li) => li.onclick = () => { stop(); const m = moments[+li.dataset.m]; let k = rec.frames.findIndex((f) => f.t >= m.t); if (k < 0) k = rec.frames.length - 1; seek(k); el.querySelectorAll(".am-tl li").forEach((x) => x.classList.toggle("on", x === li)); });
  seek(Math.max(0, rec.frames.findIndex((f) => f.t >= (moments.find((m) => m.kind === "contact")?.t ?? 0))));
}
