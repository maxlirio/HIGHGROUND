// The battle setup screen (?mode=battle): choose the field on the map of the Vale (with the ground read out —
// slopes, woods, streams, fords, marsh), the hosts (a day's wages at 1340s rates), the enemy's temper, the
// weather and the hour — or one of the historical battles, whose ground is found by reading the land.
//   chooseBattle(el, { map, banners, places, preset }) → Promise<cfg>   (cfg: see js/sim/scenarios.js scenarioConfig)
import { ARMS } from "../sim/arms.js";
import { DISPOSITIONS } from "../sim/legend.js";
import { SCENARIOS, scenarioConfig } from "../sim/scenarios.js";
import { FIELD, zonesOf, zonePoint, frameOf, surveyField, describeField, TROOPS, BUDGETS, HOST_MAX, composeHost, companiesOf, costOf, menOf, money, sampler } from "../sim/battlefield.js";
import { valeMap, w2c, c2w, mapLabels } from "./vale-map.js";
import { glyphSVG } from "./glyphs.js";
import { drawBanner } from "./heraldry.js";

const TEMPER_NOTE = {
  defensive: "takes the best ground and waits; plants stakes", aggressive: "comes straight at you with everything",
  flanker: "masses his horse on one wing to turn a flank", skirmish: "screens with bows and won't close till you're thinned",
  ambusher: "hides horse in the woods beside the field", shock: "leads with a wedge of knights", inspiring: "a steady line, horse in reserve",
};
export const WEATHER = {
  clear: { name: "Clear", note: "Sun; firm going", sim: "clear" },
  overcast: { name: "Overcast", note: "Grey, still; soft light", sim: "overcast" },
  rain: { name: "Rain", note: "Wet strings, mud, short sight", sim: "rain", rain: 0.85 },
  fog: { name: "Fog", note: "You see a bowshot; orders go astray", sim: "fog_light", fog: true },
  wind: { name: "High wind", note: "Arrows carry with it, fall short against it", sim: "clear", wind: 9 },
};
export const TOD = { dawn: { name: "Dawn", note: "Long shadows, cold light" }, noon: { name: "Noon", note: "High sun" }, dusk: { name: "Dusk", note: "Low red sun; night comes on" } };
const WIND_DIR = { back: { name: "At your backs" }, face: { name: "In your faces" }, across: { name: "Across the field" } };
const ROSTER = ["levy", "spearmen", "pikemen", "militia", "archers", "crossbow", "hobelars", "menatarms", "knights"];
const DEFAULT_HOST = [["spearmen", 80], ["menatarms", 30], ["levy", 60], ["archers", 80], ["knights", 15], ["hobelars", 20]];
const PX = 520;

const load = () => { try { return JSON.parse(localStorage.getItem("hg.battle") || "{}"); } catch { return {}; } };
const save = (o) => { try { localStorage.setItem("hg.battle", JSON.stringify(o)); } catch { /* private mode */ } };
const siteCache = new Map();

export function chooseBattle(el, { map, banners, places, preset = null }) {
  return new Promise((resolve) => {
    const saved = load();
    const st = {
      tab: preset?.scenario || saved.tab || "custom",
      site: saved.site || { x: 800, y: 1600 }, axis: saved.axis ?? Math.PI / 2,
      budget: saved.budget || "battle", host: saved.host || DEFAULT_HOST.map((a) => a.slice()), foe: saved.foe || null, foeAuto: saved.foeAuto ?? true,
      temper: saved.temper || "unknown", weather: saved.weather || "clear", tod: saved.tod || "noon", windDir: saved.windDir || "across",
      side: {}, follow: saved.follow ?? false, foeSeed: Math.random(),
    };
    const names = [places.townName(0), places.townName(1)];
    el.innerHTML = `<div class="bs-card">
      <div class="bs-head"><div><div class="lg-kicker">HIGHGROUND · A pitched battle</div><h2>Choose your field</h2></div>
        <div class="bs-arms"><span class="mine"></span><small>against</small><span class="theirs"></span></div></div>
      <div class="bs-tabs"><button data-tab="custom"><b>Your own battle</b><small>any field, any host</small></button>${Object.entries(SCENARIOS).map(([k, S]) => `<button data-tab="${k}"><b>${S.name.replace(/ \(.*/, "")}</b><small>${S.year}</small></button>`).join("")}</div>
      <div class="bs-body">
        <div class="bs-left">
          <div class="bs-map"><canvas class="base" width="${PX}" height="${PX}"></canvas><canvas class="over" width="${PX}" height="${PX}"></canvas><div class="bs-maphint"></div></div>
          <div class="bs-mapbar"><button data-turn="-1" title="Turn the field">⟲ Turn</button><button data-turn="1" title="Turn the field">⟳ Turn</button><button data-swap title="Change ends">⇅ Change ends</button><span class="bs-where"></span></div>
          <div class="bs-read"><div class="bs-sub">The lie of the land</div><svg class="bs-prof" viewBox="0 0 520 90" preserveAspectRatio="none"></svg><ul class="bs-lines"></ul></div>
        </div>
        <div class="bs-right"></div>
      </div>
      <div class="bs-foot"><button data-random title="A random field, hosts and weather — straight into it">⚄ Random battle</button><span class="bs-warn"></span><button data-go class="on">To the field ▸</button></div></div>`;
    el.querySelector(".bs-arms .mine").append(drawBanner(banners[0], 36, 45)); el.querySelector(".bs-arms .theirs").append(drawBanner(banners[1], 36, 45));
    const base = el.querySelector("canvas.base"), over = el.querySelector("canvas.over"), og = over.getContext("2d");
    base.getContext("2d").drawImage(valeMap(map, PX), 0, 0);
    const toC = w2c(map, PX), toW = c2w(map, PX), labels = mapLabels(map), S = sampler(map);
    const right = el.querySelector(".bs-right");
    let cfg = null, survey = null;

    // ---------------------------------------------------------------- the field
    const margin = FIELD.sep / 2 + FIELD.zoneDepth / 2 + FIELD.edge + 10;
    const clampSite = (p) => {
      // keep every zone corner inside the Vale for this axis
      for (let k = 0; k < 30; k++) {
        const zs = zonesOf(p, st.axis), bad = zs.flatMap((z) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => zonePoint(z, a * z.d / 2, b * z.w / 2))).filter((c) => c.x < FIELD.edge || c.y < FIELD.edge || c.x > map.size - FIELD.edge || c.y > map.size - FIELD.edge);
        if (!bad.length) break;
        p = { x: p.x + (map.size / 2 - p.x) * 0.08, y: p.y + (map.size / 2 - p.y) * 0.08 };
      }
      return p;
    };
    function current() {
      if (st.tab === "custom") return { site: st.site, axis: st.axis, sides: [0, 1], brooks: [], bridge: false };
      if (!siteCache.has(st.tab)) siteCache.set(st.tab, scenarioConfig(map, st.tab));
      const c = siteCache.get(st.tab); return { site: c.site, axis: c.axis, brooks: c.brooks, bridge: c.bridge };
    }
    function drawOver() {
      const f = current(), zs = zonesOf(f.site, f.axis), me = st.tab === "custom" ? 0 : (st.side[st.tab] ?? SCENARIOS[st.tab].playerSide);
      og.clearRect(0, 0, PX, PX);
      og.font = "italic 11px Georgia, serif"; og.textAlign = "center";
      for (const L of labels) { const [cx, cy] = toC(L.x, L.y); og.fillStyle = "rgba(20,16,10,.55)"; og.fillText(L.name, cx + 1, cy + 1); og.fillStyle = L.type === "town_site" ? "#f3e1b0" : "rgba(240,232,210,.8)"; og.fillText(L.name, cx, cy); }
      // generated features: the brook(s), the bridge
      const F = frameOf(f.site, f.axis);
      for (const b of f.brooks || []) { og.strokeStyle = "#5d8fbf"; og.lineWidth = 2.5; og.setLineDash([]); og.beginPath(); for (let lat = -700; lat <= 700; lat += 20) { const p = F.at(b.fwd + Math.sin(lat * 0.011) * 18, lat); const [cx, cy] = toC(p.x, p.y); lat === -700 ? og.moveTo(cx, cy) : og.lineTo(cx, cy); } og.stroke(); }
      if (f.bridge) { const a = F.at(-40, 0), b = F.at(40, 0), [ax, ay] = toC(a.x, a.y), [bx, by] = toC(b.x, b.y); og.strokeStyle = "#e8cf8a"; og.lineWidth = 4; og.beginPath(); og.moveTo(ax, ay); og.lineTo(bx, by); og.stroke(); }
      zs.forEach((z, k) => {
        const mine = k === me, col = mine ? getComputedStyle(document.documentElement).getPropertyValue("--t0").trim() || "#2f5fa8" : getComputedStyle(document.documentElement).getPropertyValue("--t1").trim() || "#a8322f";
        const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => toC(...Object.values(zonePoint(z, a * z.d / 2, b * z.w / 2))));
        og.beginPath(); cs.forEach(([x, y], i) => (i ? og.lineTo(x, y) : og.moveTo(x, y))); og.closePath();
        og.fillStyle = col + "55"; og.fill(); og.lineWidth = 3; og.strokeStyle = "rgba(255,248,230,.75)"; og.setLineDash(mine ? [] : [5, 4]); og.stroke(); og.lineWidth = 1.5; og.strokeStyle = col; og.stroke(); og.setLineDash([]);
        const [cx, cy] = toC(z.cx, z.cy); og.font = "bold 12px Georgia, serif"; og.fillStyle = "#fff"; og.strokeStyle = "rgba(0,0,0,.7)"; og.lineWidth = 3;
        const txt = st.tab === "custom" ? (mine ? "You" : "Enemy") : cap(SCENARIOS[st.tab].sides[k].adj); og.strokeText(txt, cx, cy + 4); og.fillText(txt, cx, cy + 4);
      });
      // the axis of advance
      const a = F.at(-FIELD.sep / 2 + 120, 0), b = F.at(FIELD.sep / 2 - 120, 0), [ax, ay] = toC(a.x, a.y), [bx, by] = toC(b.x, b.y);
      og.strokeStyle = "rgba(255,240,200,.85)"; og.lineWidth = 1.5; og.setLineDash([3, 3]); og.beginPath(); og.moveTo(ax, ay); og.lineTo(bx, by); og.stroke(); og.setLineDash([]);
      const [sx, sy] = toC(f.site.x, f.site.y); og.fillStyle = "#ffd98a"; og.beginPath(); og.arc(sx, sy, 3, 0, 7); og.fill();
      el.querySelector(".bs-where").textContent = `${places.at(f.site.x, f.site.y).phrase.replace(/^at /, "")}`;
    }
    function readGround() {
      const f = current(), me = st.tab === "custom" ? 0 : (st.side[st.tab] ?? SCENARIOS[st.tab].playerSide);
      survey = surveyField(map, f.site, f.axis);
      const foe = st.tab === "custom" ? "the enemy" : SCENARIOS[st.tab].sides[1 - me].name;
      const lines = describeField(survey, me, ["you", foe]);
      for (const b of f.brooks || []) lines.push({ icon: "stream", tone: "note", text: `${cap(b.name)} runs across the field ${b.fwd < 0 === (me === 0) ? "before your line" : "behind the enemy"} (${b.depth < 0.8 ? "waist-deep, steep-banked" : "deep and muddy"}).` });
      if (f.bridge) lines.push({ icon: "river", tone: "note", text: "A narrow timber bridge on a causeway: two horsemen abreast, no more. The only crossing in reach." });
      el.querySelector(".bs-lines").innerHTML = lines.map((l) => `<li class="${l.tone}"><i class="ic ic-${l.icon}"></i>${l.text}</li>`).join("");
      // the profile along the axis of advance (side 0's ground on the left)
      const P = survey.profile, flip = me === 1, hs = P.map((p) => p.h), lo = Math.min(...hs) - 3, hi = Math.max(...hs) + 3;
      const X = (i) => (flip ? P.length - 1 - i : i) / (P.length - 1) * 520, Y = (h) => 84 - (h - lo) / Math.max(10, hi - lo) * 74;
      const zoneX = (f0, f1) => { const a = (f0 - P[0].f) / (P.at(-1).f - P[0].f) * 520, b = (f1 - P[0].f) / (P.at(-1).f - P[0].f) * 520; return flip ? [520 - b, 520 - a] : [a, b]; };
      const z0 = zoneX(-FIELD.sep / 2 - FIELD.zoneDepth / 2, -FIELD.sep / 2 + FIELD.zoneDepth / 2), z1 = zoneX(FIELD.sep / 2 - FIELD.zoneDepth / 2, FIELD.sep / 2 + FIELD.zoneDepth / 2);
      const [mz, tz] = me === 0 ? [z0, z1] : [z1, z0];
      el.querySelector(".bs-prof").innerHTML = `<rect x="${mz[0]}" y="0" width="${mz[1] - mz[0]}" height="90" class="pz me"/><rect x="${tz[0]}" y="0" width="${tz[1] - tz[0]}" height="90" class="pz them"/>
        <path d="M0 90 ${P.map((p, i) => `L${X(i).toFixed(1)} ${Y(p.h).toFixed(1)}`).join(" ")} L520 90Z" class="pg"/>
        ${P.map((p, i) => p.water > 0.05 ? `<rect x="${(X(i) - 3).toFixed(1)}" y="${(Y(p.h) - 2).toFixed(1)}" width="6" height="5" class="pw"/>` : p.wood > 0.3 ? `<circle cx="${X(i).toFixed(1)}" cy="${(Y(p.h) - 4).toFixed(1)}" r="${(2 + p.wood * 3).toFixed(1)}" class="pt"/>` : "").join("")}
        <text x="6" y="12" class="pl">${flip ? cap(foe) : "You"}</text><text x="514" y="12" class="pl" text-anchor="end">${flip ? "You" : cap(foe)}</text>
        <text x="260" y="12" class="pl" text-anchor="middle">${Math.round(hi - lo - 6)} m of relief</text>`;
    }
    over.onclick = (e) => {
      if (st.tab !== "custom") { hint("The ground of a historical battle is read from the land — choose “Your own battle” to pick a field"); return; }
      const r = over.getBoundingClientRect(), [x, y] = toW((e.clientX - r.left) / r.width * PX, (e.clientY - r.top) / r.height * PX);
      st.site = clampSite({ x, y }); refresh();
    };
    over.onmousemove = (e) => {
      const r = over.getBoundingClientRect(), [x, y] = toW((e.clientX - r.left) / r.width * PX, (e.clientY - r.top) / r.height * PX);
      const w = S.water(x, y), wd = S.wood(x, y), b = S.bog(x, y), h = S.h(x, y);
      hint(`${places.at(x, y).phrase.replace(/^at /, "")} · ${Math.round(h)} m${w > 1.1 ? " · deep water" : w > 0.05 ? " · shallow water" : b > 0.45 ? " · marsh" : wd > 0.35 ? " · woodland" : ""}${st.tab === "custom" ? " — click to fight here" : ""}`);
    };
    over.onmouseleave = () => hint("");
    const hint = (t) => { el.querySelector(".bs-maphint").textContent = t; el.querySelector(".bs-maphint").hidden = !t; };
    el.querySelectorAll("[data-turn]").forEach((b) => b.onclick = () => { if (st.tab !== "custom") return; st.axis += +b.dataset.turn * Math.PI / 4; st.site = clampSite(st.site); refresh(); });
    el.querySelector("[data-swap]").onclick = () => { if (st.tab === "custom") { st.axis += Math.PI; refresh(); } else { const S0 = SCENARIOS[st.tab]; st.side[st.tab] = 1 - (st.side[st.tab] ?? S0.playerSide); refresh(); } };

    // ---------------------------------------------------------------- the right column
    function renderRight() {
      if (st.tab === "custom") return renderCustom();
      const S0 = SCENARIOS[st.tab], me = st.side[st.tab] ?? S0.playerSide;
      const force = (d) => { const by = {}; for (const c of d.companies) by[c.arm] = (by[c.arm] || 0) + c.count; return Object.entries(by).map(([a, n]) => `<span class="bs-f">${glyphSVG(ARMS[a].glyph)}${n} ${ARMS[a].name}</span>`).join(""); };
      right.innerHTML = `<div class="bs-brief"><div class="lg-kicker">${S0.kicker} · ${S0.date}</div><h3>The Battle of ${S0.name}</h3><div class="bs-place">${cap(S0.place)} — on the Vale: ${places.at(current().site.x, current().site.y).phrase.replace(/^at /, "")}</div>
        <p>${S0.brief}</p>
        <div class="bs-sub">Command</div>
        <div class="bs-sides">${S0.sides.map((d, k) => `<button data-side="${k}" class="${k === me ? "on" : ""}"><b>${cap(d.name)}</b><small>under ${d.lord}${k === S0.playerSide ? " · the historical choice" : ""}</small><small class="win">${d.win}</small><span class="bs-forces">${force(d)}</span></button>`).join("")}</div>
        <div class="bs-sub">The day</div><div class="bs-day">${WEATHER[S0.weather]?.name || S0.weather} · ${TOD[S0.tod].name}${S0.afterRain > 0.5 ? " · the ground sodden after rain" : ""}${S0.timeLimit ? ` · night falls after ${S0.timeLimit.min} minutes` : ""}</div>
        <details class="bs-hist"><summary>What happened in ${S0.year}</summary><p>${S0.history}</p></details>
        <label class="bs-opt"><input type="checkbox" data-follow ${st.follow ? "checked" : ""}> Glide the camera to decisive moments as they happen</label></div>`;
      right.querySelectorAll("[data-side]").forEach((b) => b.onclick = () => { st.side[st.tab] = +b.dataset.side; refresh(); });
      right.querySelector("[data-follow]").onchange = (e) => { st.follow = e.target.checked; };
    }
    function foeHost() {
      const B = BUDGETS.find((b) => b.key === st.budget) || BUDGETS[1];
      if (!st.foeAuto && st.foe) return st.foe;
      let seed = st.foeSeed * 1e6; const rng = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
      const t = st.temper === "unknown" ? Object.keys(DISPOSITIONS)[Math.floor(st.foeSeed * 7)] : st.temper;
      return composeHost(B.pence, t, rng);
    }
    function renderCustom() {
      const B = BUDGETS.find((b) => b.key === st.budget) || BUDGETS[1];
      const row = (list, arm, who) => { const T = TROOPS[arm], n = list.find((e) => e[0] === arm)?.[1] || 0; return `<div class="bs-tr${n ? "" : " zero"}" title="${T.note}"><span class="g">${glyphSVG(ARMS[arm].glyph)}</span><span class="nm">${ARMS[arm].name}<small>${T.wage}d</small></span>
        <button data-${who}="${arm}" data-d="-1">−</button><b>${n}</b><button data-${who}="${arm}" data-d="1">+</button><span class="c">${money(T.wage * n)}</span></div>`; };
      const mine = st.host, cost = costOf(mine), men = menOf(mine), foe = foeHost(), fcost = costOf(foe), fmen = menOf(foe);
      const unknown = st.temper === "unknown" && st.foeAuto;
      right.innerHTML = `<div class="bs-custom">
        <div class="bs-sub">The size of the day</div><div class="sp-row bs-budget">${BUDGETS.map((b) => `<button data-budget="${b.key}" class="${b.key === st.budget ? "on" : ""}"><b>${b.name}</b><small>${b.note}</small></button>`).join("")}</div>
        <div class="bs-sub">Your host <span class="bs-pay ${cost > B.pence ? "over" : ""}">${money(cost)} of ${money(B.pence)} a day · ${men} men${men > HOST_MAX ? ` (at most ${HOST_MAX})` : ""}</span></div>
        <div class="bs-roster">${ROSTER.map((a) => row(mine, a, "me")).join("")}</div>
        <div class="bs-sub">The enemy lord</div>
        <div class="sp-row sp-disp bs-temper"><button data-temper="unknown" class="${st.temper === "unknown" ? "on" : ""}"><b>Unknown</b><small>you'll learn his temper in the field</small></button>${Object.entries(DISPOSITIONS).map(([k, D]) => `<button data-temper="${k}" class="${k === st.temper ? "on" : ""}"><b>${D.name}</b><small>${TEMPER_NOTE[k] || ""}</small></button>`).join("")}</div>
        <div class="bs-sub">His host <span class="bs-pay">${unknown ? "unknown until your scouts see it" : `${money(fcost)} a day · ${fmen} men`}</span> <label class="bs-inl"><input type="checkbox" data-foeauto ${st.foeAuto ? "checked" : ""}> he chooses it by his temper</label></div>
        ${st.foeAuto ? (unknown ? `<p class="bs-note">He will spend what you spend. What he buys depends on the kind of man he is.</p>` : `<div class="bs-forces wide">${foe.map(([a, n]) => `<span class="bs-f">${glyphSVG(ARMS[a].glyph)}${n} ${ARMS[a].name}</span>`).join("")}</div>`)
          : `<div class="bs-roster">${ROSTER.map((a) => row(foe, a, "foe")).join("")}</div>`}
        <div class="bs-sub">Weather</div><div class="sp-row bs-wx">${Object.entries(WEATHER).map(([k, W]) => `<button data-wx="${k}" class="${k === st.weather ? "on" : ""}"><b>${W.name}</b><small>${W.note}</small></button>`).join("")}</div>
        ${st.weather === "wind" ? `<div class="sp-row bs-wind">${Object.entries(WIND_DIR).map(([k, D]) => `<button data-wind="${k}" class="${k === st.windDir ? "on" : ""}"><b>${D.name}</b></button>`).join("")}</div>` : ""}
        <div class="bs-sub">The hour</div><div class="sp-row">${Object.entries(TOD).map(([k, T]) => `<button data-tod="${k}" class="${k === st.tod ? "on" : ""}"><b>${T.name}</b><small>${T.note}</small></button>`).join("")}</div>
        <label class="bs-opt"><input type="checkbox" data-follow ${st.follow ? "checked" : ""}> Glide the camera to decisive moments as they happen</label></div>`;
      const bump = (list, arm, d) => { const T = TROOPS[arm]; let e = list.find((x) => x[0] === arm); if (!e) { e = [arm, 0]; list.push(e); } e[1] = Math.max(0, Math.min(T.max, e[1] + d * T.step)); };
      right.querySelectorAll("[data-me]").forEach((b) => b.onclick = () => { bump(st.host, b.dataset.me, +b.dataset.d); renderRight(); validate(); });
      right.querySelectorAll("[data-foe]").forEach((b) => b.onclick = () => { bump(st.foe, b.dataset.foe, +b.dataset.d); renderRight(); validate(); });
      right.querySelectorAll("[data-budget]").forEach((b) => b.onclick = () => { st.budget = b.dataset.budget; renderRight(); validate(); });
      right.querySelectorAll("[data-temper]").forEach((b) => b.onclick = () => { st.temper = b.dataset.temper; renderRight(); });
      right.querySelector("[data-foeauto]").onchange = (e) => { st.foeAuto = e.target.checked; if (!st.foeAuto) st.foe = foeHost().map((a) => a.slice()); if (!st.foe) st.foe = foeHost().map((a) => a.slice()); renderRight(); validate(); };
      right.querySelectorAll("[data-wx]").forEach((b) => b.onclick = () => { st.weather = b.dataset.wx; renderRight(); });
      right.querySelectorAll("[data-wind]").forEach((b) => b.onclick = () => { st.windDir = b.dataset.wind; renderRight(); });
      right.querySelectorAll("[data-tod]").forEach((b) => b.onclick = () => { st.tod = b.dataset.tod; renderRight(); });
      right.querySelector("[data-follow]").onchange = (e) => { st.follow = e.target.checked; };
    }
    function validate() {
      let warn = "";
      if (st.tab === "custom") {
        const B = BUDGETS.find((b) => b.key === st.budget) || BUDGETS[1];
        if (!menOf(st.host)) warn = "You have no men.";
        else if (costOf(st.host) > B.pence) warn = `Your host costs more than ${money(B.pence)} a day.`;
        else if (menOf(st.host) > HOST_MAX) warn = `At most ${HOST_MAX} men a side.`;
        else if (survey && survey.water.deepAcross > 0.85 && !(survey.crossings || []).length) warn = "A river nobody can cross lies between the hosts — choose another field.";
      }
      el.querySelector(".bs-warn").textContent = warn; el.querySelector("[data-go]").disabled = !!warn;
      return !warn;
    }
    function refresh() {
      el.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === st.tab));
      el.querySelector(".bs-mapbar").classList.toggle("fixed", st.tab !== "custom");
      hint(""); drawOver(); readGround(); renderRight(); validate();
    }
    el.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => {
      st.tab = b.dataset.tab;
      if (st.tab !== "custom" && !siteCache.has(st.tab)) { el.querySelector(".bs-maphint").textContent = "Reading the land for the right ground…"; el.querySelector(".bs-maphint").hidden = false; setTimeout(refresh, 20); return; }
      refresh();
    });

    // ---------------------------------------------------------------- go
    function build() {
      save({ tab: st.tab, site: st.site, axis: st.axis, budget: st.budget, host: st.host, foe: st.foe, foeAuto: st.foeAuto, temper: st.temper, weather: st.weather, tod: st.tod, windDir: st.windDir, follow: st.follow });
      if (st.tab !== "custom") {
        const c = scenarioConfig(map, st.tab, st.side[st.tab] ?? SCENARIOS[st.tab].playerSide);
        Object.assign(c, siteCache.get(st.tab) ? { site: siteCache.get(st.tab).site, axis: siteCache.get(st.tab).axis } : {});
        c.follow = st.follow; return c;
      }
      const temper = st.temper === "unknown" ? Object.keys(DISPOSITIONS)[Math.floor(st.foeSeed * 7)] : st.temper;
      return customConfig({ site: st.site, axis: st.axis, host: st.host, foe: foeHost(), temper, hidden: st.temper === "unknown", weather: st.weather, tod: st.tod, windDir: st.windDir, follow: st.follow, names, places });
    }
    el.querySelector("[data-go]").onclick = () => { if (!validate()) return; el.hidden = true; resolve(build()); };
    el.querySelector("[data-random]").onclick = () => { el.hidden = true; resolve(randomBattle(map, { names, places, follow: st.follow })); };
    el.hidden = false;
    if (st.tab !== "custom" && !SCENARIOS[st.tab]) st.tab = "custom";
    refresh();
  });
}

export function customConfig({ site, axis, host, foe, temper, hidden = false, weather = "clear", tod = "noon", windDir = "across", follow = false, names, places }) {
  const W = WEATHER[weather] || WEATHER.clear;
  const wind = W.wind ? { speed: W.wind, dir: windDir } : null;
  return {
    kind: "custom", name: `The Battle of ${places.at(site.x, site.y).name}`, site, axis, playerSide: 0,
    sides: [
      { name: `the men of ${names[0]}`, adj: names[0], lord: `the lord of ${names[0]}`, temper: "inspiring", companies: companiesOf(host), ai: false },
      { name: `the men of ${names[1]}`, adj: names[1], lord: `the lord of ${names[1]}`, temper, companies: companiesOf(foe), ai: true, hidden },
    ],
    weather, tod, wind, afterRain: W.rain || 0, objectives: { timeLimit: { secs: 45 * 60, side: -1, why: "night fell and both hosts drew off" } }, follow,
  };
}
export function randomBattle(map, { names, places, follow = false }) {
  const S = sampler(map), keys = Object.keys(DISPOSITIONS), R = Math.random;
  let best = null;
  for (let k = 0; k < 60; k++) {
    const site = { x: 700 + R() * (map.size - 1400), y: 700 + R() * (map.size - 1400) }, axis = R() * Math.PI * 2;
    const towns = (map.meta?.features || []).filter((f) => f.type === "town_site");
    if (towns.some((t) => Math.hypot(t.xy_m[0] - site.x, t.xy_m[1] - site.y) < 700)) continue;
    const s = surveyField(map, site, axis, { coarse: true });
    const v = -s.water.deepAcross * 4 - s.woods.mid * 2 - s.offMap * 0.1 - s.inWater[0] * 2 - s.inWater[1] * 2 + R() * 0.8;
    if (!best || v > best.v) best = { v, site, axis };
  }
  const B = BUDGETS[Math.floor(R() * BUDGETS.length)], mt = keys[Math.floor(R() * keys.length)], et = keys[Math.floor(R() * keys.length)];
  const wx = ["clear", "clear", "overcast", "rain", "fog", "wind"][Math.floor(R() * 6)], tod = ["dawn", "noon", "noon", "dusk"][Math.floor(R() * 4)];
  return customConfig({ site: best.site, axis: best.axis, host: composeHost(B.pence, mt, R), foe: composeHost(B.pence, et, R), temper: et, hidden: true, weather: wx, tod, windDir: ["back", "face", "across"][Math.floor(R() * 3)], follow, names, places });
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
