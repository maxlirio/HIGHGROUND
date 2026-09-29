// The siege setup screen (?mode=siege), in the manner of the battle setup: choose the castle (a hill castle, a
// concentric castle, a river castle — castle.js lays each out on the Vale where its kind would be built), your side
// (lay the siege or hold the castle), the forces (the garrison and the besieging host at the proportions of real
// sieges, and the besiegers' train), the season, the castle's stores and whether a relief may come — then begin.
//   chooseSiege(el, { map, banners, places, castleApi }) → Promise<cfg>   (cfg: js/sim/siege-war.js setupSiege)
import { ARMS } from "../sim/arms.js";
import { LAYOUTS, SEASONS, PROVISION, FORCES, castleSite, approachOf, armMen } from "../sim/siege-war.js";
import { valeMap, w2c, mapLabels } from "./vale-map.js";
import { glyphSVG } from "./glyphs.js";
import { drawBanner } from "./heraldry.js";

const PX = 440;
const GARRISON_ROSTER = ["menatarms", "spearmen", "levy", "crossbow", "archers"];
const HOST_ROSTER = ["menatarms", "spearmen", "levy", "archers", "crossbow", "knights", "hobelars"];
const TRAIN = [
  ["trebuchet", "Trebuchets", 0, 4, "counterweight engines: 90 kg stones at 120–230 m; days to frame up"],
  ["mangonel", "Mangonels", 0, 4, "traction engines: light stones at men on the walls"],
  ["ram", "Rams", 0, 2, "a covered ram for the gate"],
  ["siege_tower", "Siege towers", 0, 2, "a belfry pushed to the wall (needs level ground)"],
  ["mantlet", "Mantlets", 0, 8, "wheeled screens for the crossbows"],
  ["ladders", "Ladders", 0, 60, "scaling ladders (the carpenters make more)"],
];
const STEP = { menatarms: 8, spearmen: 12, levy: 20, crossbow: 8, archers: 10, knights: 5, hobelars: 10 };
const load = () => { try { return JSON.parse(localStorage.getItem("hg.siege") || "{}"); } catch { return {}; } };
const save = (o) => { try { localStorage.setItem("hg.siege", JSON.stringify(o)); } catch { /* private mode */ } };
const siteCache = new Map();
export function siteFor(map, layout, api) {
  if (!siteCache.has(layout)) { let s = null; try { s = api?.castleSite?.(map, layout) || null; } catch { s = null; } if (s) s = { ...s, facing: approachOf(map, s.x, s.y, layout) }; siteCache.set(layout, s || castleSite(map, layout)); } // (the gate and the camp on the most open approach)
  return siteCache.get(layout);
}
const clone = (o) => JSON.parse(JSON.stringify(o));

export function chooseSiege(el, { map, banners, places, castleApi = null }) {
  return new Promise((resolve) => {
    const saved = load();
    const st = {
      castle: LAYOUTS[saved.castle] ? saved.castle : "hill", side: saved.side === "defend" ? "defend" : "attack", force: saved.force || "strong",
      garrison: saved.garrison || clone(FORCES.strong.garrison), besiegers: saved.besiegers || clone(FORCES.strong.besiegers), train: saved.train || clone(FORCES.strong.train),
      season: SEASONS[saved.season] ? saved.season : "summer", provision: saved.provision || 45, relief: saved.relief ?? false, lord: saved.lord ?? true,
    };
    const names = [places.townName(0), places.townName(1)];
    const layouts = castleApi?.CASTLE_LAYOUTS ? Object.fromEntries(Object.entries(LAYOUTS).map(([k, L]) => [k, { ...L, ...(castleApi.CASTLE_LAYOUTS[k] || {}) }])) : LAYOUTS;
    el.innerHTML = `<div class="bs-card sg-card">
      <div class="bs-head"><div><div class="lg-kicker">HIGHGROUND · A siege</div><h2 class="sg-title">Lay siege to a castle</h2></div>
        <div class="bs-arms"><span class="mine"></span><small>against</small><span class="theirs"></span></div></div>
      <div class="bs-tabs sg-tabs">${Object.entries(layouts).map(([k, L]) => `<button data-castle="${k}"><b>${L.name}</b><small>${{ hill: "a keep on a rock", concentric: "walls within walls", river: "its back to the water" }[k] || ""}</small></button>`).join("")}</div>
      <div class="bs-body sg-body">
        <div class="bs-left">
          <div class="bs-map sg-map"><canvas class="base" width="${PX}" height="${PX}"></canvas><canvas class="over" width="${PX}" height="${PX}"></canvas><div class="bs-maphint" hidden></div></div>
          <div class="sg-plan"><svg viewBox="-80 -80 160 160"></svg><div class="sg-about"></div></div>
        </div>
        <div class="bs-right sg-right"></div>
      </div>
      <div class="bs-foot"><button data-random title="A castle, the forces and the season at random">⚄ A random siege</button><span class="bs-warn"></span><button data-go class="on">Begin the siege ▸</button></div></div>`;
    el.querySelector(".bs-arms .mine").append(drawBanner(banners[0], 36, 45)); el.querySelector(".bs-arms .theirs").append(drawBanner(banners[1], 36, 45));
    const base = el.querySelector("canvas.base"), over = el.querySelector("canvas.over"), og = over.getContext("2d");
    base.getContext("2d").drawImage(valeMap(map, PX), 0, 0);
    const toC = w2c(map, PX), labels = mapLabels(map), right = el.querySelector(".sg-right");
    const col = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

    function drawMap() {
      const s = siteFor(map, st.castle, castleApi), [cx, cy] = toC(s.x, s.y), per = PX / map.size;
      og.clearRect(0, 0, PX, PX);
      og.font = "italic 11px Georgia, serif"; og.textAlign = "center";
      for (const L of labels) { const [lx, ly] = toC(L.x, L.y); og.fillStyle = "rgba(20,16,10,.55)"; og.fillText(L.name, lx + 1, ly + 1); og.fillStyle = L.type === "town_site" ? "#f3e1b0" : "rgba(240,232,210,.8)"; og.fillText(L.name, lx, ly); }
      // the investment: the camp on the approach, the lines round the castle
      const attC = st.side === "attack" ? col("--t0") || "#2f5fa8" : col("--t1") || "#a8322f", defC = st.side === "attack" ? col("--t1") || "#a8322f" : col("--t0") || "#2f5fa8";
      og.strokeStyle = attC; og.lineWidth = 2; og.setLineDash([4, 3]); og.beginPath(); og.arc(cx, cy, 340 * per, 0, 7); og.stroke(); og.setLineDash([]);
      const camp = toC(s.x + Math.cos(s.facing) * 360, s.y + Math.sin(s.facing) * 360);
      og.fillStyle = attC; og.strokeStyle = "rgba(255,248,230,.85)"; og.lineWidth = 1.5; og.beginPath(); og.arc(camp[0], camp[1], 7, 0, 7); og.fill(); og.stroke();
      og.font = "bold 11px Georgia, serif"; og.fillStyle = "#fff"; og.strokeStyle = "rgba(0,0,0,.7)"; og.lineWidth = 3; const ct = st.side === "attack" ? "Your camp" : "Their camp"; const cty = camp[1] < cy ? camp[1] - 11 : camp[1] + 19; og.strokeText(ct, camp[0], cty); og.fillText(ct, camp[0], cty);
      og.fillStyle = defC; og.strokeStyle = "#fff"; og.lineWidth = 2; og.beginPath(); og.rect(cx - 6, cy - 6, 12, 12); og.fill(); og.stroke();
      const nm = castleNameAt(places, s.x, s.y), tx = Math.max(70, Math.min(PX - 70, cx)); og.strokeStyle = "rgba(0,0,0,.75)"; og.lineWidth = 3; og.strokeText(nm, tx, cy + 22); og.fillStyle = "#ffe9b0"; og.fillText(nm, tx, cy + 22);
      el.querySelector(".bs-maphint").hidden = false; el.querySelector(".bs-maphint").textContent = `${places.at(s.x, s.y).phrase.replace(/^at /, "")} · ${Math.round(map.h(s.x, s.y))} m · the approach from the ${compassW(s.facing)}`;
      drawPlan();
    }
    function drawPlan() {
      const L = layouts[st.castle], svg = el.querySelector(".sg-plan svg"), P = (n, R, a0) => Array.from({ length: n }, (_, k) => { const a = a0 + (2 * k - 1) * Math.PI / n; return [Math.cos(a) * R, -Math.sin(a) * R]; });
      const ring = (pts, cls) => `<polygon points="${pts.map((p) => p.join(",")).join(" ")}" class="${cls}"/>` + pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${cls === "in" ? 5 : 4}" class="tw"/>`).join("");
      const A = -Math.PI / 2; // (the approach at the bottom of the plan)
      let g = "";
      if (st.castle === "concentric") g = ring(P(8, 66, A), "out") + ring(P(6, 38, A + Math.PI / 3), "in") + `<rect x="-10" y="-14" width="20" height="20" class="kp"/><rect x="-8" y="60" width="16" height="10" class="gh"/><rect x="-7" y="30" width="14" height="10" class="gh"/>`;
      else { g = ring(P(7, 54, A), "out") + `<rect x="-10" y="-24" width="20" height="20" class="kp"/><rect x="-8" y="47" width="16" height="10" class="gh"/>`; if (st.castle === "river") g = `<path d="M-80 -58 Q -20 -80 80 -62 L80 -80 L-80 -80Z" class="wt"/>` + g; if (st.castle === "hill") g = `<ellipse cx="0" cy="0" rx="76" ry="72" class="hl"/>` + g; }
      g += `<text x="0" y="78" class="lb">▲ the approach</text>`;
      svg.innerHTML = g;
      el.querySelector(".sg-about").innerHTML = `<b>${L.name}</b><p>${L.note}</p>`;
    }
    function renderRight() {
      const F = FORCES[st.force] || null, gm = armMen(st.garrison), bm = armMen(st.besiegers), ratio = bm / Math.max(1, gm);
      const me = st.side === "attack";
      const roster = (list, arms, who) => `<div class="bs-roster">${arms.map((a) => { const n = list.find((e) => e[0] === a)?.[1] || 0; return `<div class="bs-tr${n ? "" : " zero"}"><span class="g">${glyphSVG(ARMS[a].glyph)}</span><span class="nm">${ARMS[a].name}</span><button data-${who}="${a}" data-d="-1">−</button><b>${n}</b><button data-${who}="${a}" data-d="1">+</button><span class="c"></span></div>`; }).join("")}</div>`;
      right.innerHTML = `<div class="bs-custom sg-custom">
        <div class="bs-sub">Your part</div>
        <div class="bs-sides sg-sides"><button data-side="attack" class="${me ? "on" : ""}"><b>Lay the siege</b><small>Invest the castle, batter and mine its walls, storm the breach and take the keep. You lead ${names[0]}'s host.</small></button>
          <button data-side="defend" class="${!me ? "on" : ""}"><b>Hold the castle</b><small>Man the walls, stop the breaches, sally against the engines, and hold out — for relief, or till they give up.</small></button></div>
        <div class="bs-sub">The forces <span class="bs-pay">${gm} in the garrison · ${bm} besiegers · <b class="${ratio < 3 ? "warn" : ""}">${ratio.toFixed(1)} : 1</b></span></div>
        <div class="sp-row sg-force">${Object.entries(FORCES).map(([k, f]) => `<button data-force="${k}" class="${k === st.force ? "on" : ""}"><b>${f.name}</b><small>${f.note}</small></button>`).join("")}</div>
        <p class="bs-note">Besiegers usually outnumbered a garrison five or ten to one: a stone curtain made a few hundred men worth thousands.</p>
        <div class="sg-two"><div><div class="bs-sub">The garrison</div>${roster(st.garrison, GARRISON_ROSTER, "gar")}</div>
          <div><div class="bs-sub">The besieging host</div>${roster(st.besiegers, HOST_ROSTER, "host")}</div></div>
        <div class="bs-sub">The siege train</div>
        <div class="sg-train">${TRAIN.map(([k, nm, , , note]) => `<div class="bs-tr" title="${note}"><span class="g">${glyphSVG(ARMS[k]?.glyph || "trebuchet")}</span><span class="nm">${nm}</span><button data-train="${k}" data-d="-1">−</button><b>${st.train[k] || 0}</b><button data-train="${k}" data-d="1">+</button><span class="c"></span></div>`).join("")}</div>
        <div class="bs-sub">The season</div><div class="sp-row sg-season">${Object.entries(SEASONS).map(([k, S]) => `<button data-season="${k}" class="${k === st.season ? "on" : ""}"><b>${S.name}</b><small>${S.note}</small></button>`).join("")}</div>
        <div class="bs-sub">The castle's stores</div><div class="sp-row sg-prov">${PROVISION.map((p) => `<button data-prov="${p.key}" class="${p.key === st.provision ? "on" : ""}"><b>${p.name}</b><small>${p.note}</small></button>`).join("")}</div>
        <label class="bs-opt"><input type="checkbox" data-relief ${st.relief ? "checked" : ""}> A relieving army may come (the garrison sent word before the lines closed)</label>
        <label class="bs-opt"><input type="checkbox" data-lord ${st.lord ? "checked" : ""}> Your lord is with ${me ? "the host" : "the garrison"} (he can lead an assault up a ladder or into the breach, or hold the keep)</label></div>`;
      const bump = (list, arm, d) => { let e = list.find((x) => x[0] === arm); if (!e) { e = [arm, 0]; list.push(e); } e[1] = Math.max(0, Math.min(400, e[1] + d * (STEP[arm] || 10))); st.force = "custom"; };
      right.querySelectorAll("[data-side]").forEach((b) => b.onclick = () => { st.side = b.dataset.side; refresh(); });
      right.querySelectorAll("[data-force]").forEach((b) => b.onclick = () => { st.force = b.dataset.force; const F2 = FORCES[st.force]; st.garrison = clone(F2.garrison); st.besiegers = clone(F2.besiegers); st.train = clone(F2.train); refresh(); });
      right.querySelectorAll("[data-gar]").forEach((b) => b.onclick = () => { bump(st.garrison, b.dataset.gar, +b.dataset.d); refresh(); });
      right.querySelectorAll("[data-host]").forEach((b) => b.onclick = () => { bump(st.besiegers, b.dataset.host, +b.dataset.d); refresh(); });
      right.querySelectorAll("[data-train]").forEach((b) => b.onclick = () => { const k = b.dataset.train, T = TRAIN.find((t) => t[0] === k); st.train[k] = Math.max(T[2], Math.min(T[3], (st.train[k] || 0) + +b.dataset.d * (k === "ladders" ? 5 : 1))); refresh(); });
      right.querySelectorAll("[data-season]").forEach((b) => b.onclick = () => { st.season = b.dataset.season; refresh(); });
      right.querySelectorAll("[data-prov]").forEach((b) => b.onclick = () => { st.provision = +b.dataset.prov; refresh(); });
      right.querySelector("[data-relief]").onchange = (e) => { st.relief = e.target.checked; };
      right.querySelector("[data-lord]").onchange = (e) => { st.lord = e.target.checked; };
      void F;
    }
    function validate() {
      const gm = armMen(st.garrison), bm = armMen(st.besiegers); let warn = "";
      if (gm < 10) warn = "A garrison needs at least ten men."; else if (bm < gm * 1.5) warn = "Too few besiegers to invest the castle (at least half as many again as the garrison)."; else if (gm + bm > 2400) warn = "At most 2,400 men in all.";
      else if (!(st.train.trebuchet || st.train.ram || st.train.ladders || st.train.siege_tower)) warn = "The besiegers need some way in: engines, a ram or ladders.";
      el.querySelector(".bs-warn").textContent = warn; el.querySelector("[data-go]").disabled = !!warn; return !warn;
    }
    function refresh() {
      el.querySelector(".sg-title").textContent = st.side === "attack" ? "Lay siege to a castle" : "Hold a castle against a siege";
      el.querySelectorAll("[data-castle]").forEach((b) => b.classList.toggle("on", b.dataset.castle === st.castle));
      drawMap(); renderRight(); validate();
    }
    el.querySelectorAll("[data-castle]").forEach((b) => b.onclick = () => { st.castle = b.dataset.castle; el.querySelector(".bs-maphint").textContent = "Reading the land for the site…"; setTimeout(refresh, 20); });
    function build() {
      save({ castle: st.castle, side: st.side, force: st.force, garrison: st.garrison, besiegers: st.besiegers, train: st.train, season: st.season, provision: st.provision, relief: st.relief, lord: st.lord });
      return siegeConfig({ castle: st.castle, site: siteFor(map, st.castle, castleApi), side: st.side, garrison: st.garrison, besiegers: st.besiegers, train: st.train, season: st.season, provision: st.provision, relief: st.relief, lord: st.lord, names, places });
    }
    el.querySelector("[data-go]").onclick = () => { if (!validate()) return; el.hidden = true; resolve(build()); };
    el.querySelector("[data-random]").onclick = () => {
      const R = Math.random, ks = Object.keys(LAYOUTS), fs = Object.keys(FORCES), ss = Object.keys(SEASONS);
      st.castle = ks[Math.floor(R() * ks.length)]; st.force = fs[Math.floor(R() * fs.length)]; const F2 = FORCES[st.force]; st.garrison = clone(F2.garrison); st.besiegers = clone(F2.besiegers); st.train = clone(F2.train);
      st.season = ss[Math.floor(R() * ss.length)]; st.provision = PROVISION[Math.floor(R() * PROVISION.length)].key; st.relief = R() < 0.4;
      el.hidden = true; resolve(build());
    };
    el.hidden = false;
    refresh();
  });
}
export function siegeConfig({ castle, site, side = "attack", garrison, besiegers, train, season = "summer", provision = 45, relief = false, lord = true, names = ["Ashby", "Rookham"], places = null }) {
  const nm = places ? castleNameAt(places, site.x, site.y) : "the castle";
  return { kind: "siege", castle, site, playerSide: side, garrison, besiegers, train, season, provision, relief, lord, names, castleName: nm, name: `The siege of ${nm}`, weather: "clear", tod: "noon" };
}
export function castleNameAt(places, x, y) { return `${places.at(x, y).name.replace(/ site$/i, "")} Castle`; }
function compassW(a) { const k = Math.round((((a * 180 / Math.PI) % 360 + 360) % 360) / 45) % 8; return ["east", "north-east", "north", "north-west", "west", "south-west", "south", "south-east"][k]; }
