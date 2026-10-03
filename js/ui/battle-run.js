// The frame round a pitched battle (?mode=battle): the field made ready (generated brooks and bridges, the
// ground soaked by rain), both hosts drawn up in their zones, the enemy's AI with his temper, ambushes that
// wait for their moment, the weather and the light, the recorder, and the battle bar (time, objective, the
// strength of both hosts). main.js calls, in this order:
//   prepareField(map, cfg)                     before createWorld (the nav and the going must see the changes)
//   daylight(THREE, { scene, sun, hemi, cfg }) before buildTerrain (its baked shadows follow the sun)
//   startBattle(w, cfg, deps)                  after the world is built → battle
//   battle.frame(dt, cam)                      every rendered frame (rain, the bar)
import * as THREE from "three";
import { prepareField, setupBattle } from "../sim/battle.js";
import { SUN_DIR } from "../render/terrain.js";
import { WEATHER as WX, TOD } from "./battle-setup.js";
import { wxBadge } from "./glyphs.js";
import { canSee } from "../sim/vision.js";

export { prepareField };

// ---------------------------------------------------------------- the light and the sky
const LIGHT = {
  dawn: { sun: [0.82, 0.24, 0.34], col: "#ffc48a", I: 1.8, hs: "#c7b9c9", hg: "#3b3029", hI: 0.75, sky: ["#6b7ea6", "#e7b596", "#f4d3a6"], fog: "#dcc4ab", tint: "dawn" },
  noon: { sun: null, col: "#fff3dc", I: 2.2, hs: "#bcd2ea", hg: "#4a4032", hI: 0.9, sky: ["#5f86b3", "#a9bfd3", "#d9dccf"], fog: "#9fb2c2" },
  dusk: { sun: [-0.84, 0.2, 0.3], col: "#ff9d5c", I: 1.7, hs: "#b49aaa", hg: "#33261f", hI: 0.62, sky: ["#39467a", "#d6866a", "#f1b27a"], fog: "#caa088", tint: "dusk" },
};
export function daylight({ scene, sun, hemi, cfg }) {
  const L = LIGHT[cfg.tod] || LIGHT.noon, W = WX[cfg.weather] || WX.clear;
  if (L.sun) SUN_DIR.set(...L.sun).normalize(); // (terrain.js bakes its shadows from this vector, figures cast theirs by it)
  sun.position.copy(SUN_DIR).multiplyScalar(1000);
  sun.color.set(L.col); sun.intensity = L.I; hemi.color.set(L.hs); hemi.groundColor.set(L.hg); hemi.intensity = L.hI;
  let sky = L.sky, fogCol = L.fog;
  const wk = cfg.weather;
  const grey = wk === "overcast" || wk === "rain" || wk === "fog" || wk === "storm" || wk === "snow";
  if (grey) { sun.intensity *= wk === "overcast" ? 0.5 : wk === "storm" ? 0.28 : wk === "snow" ? 0.55 : 0.38; hemi.intensity *= 1.2; hemi.color.set(wk === "fog" ? "#c9cdd0" : wk === "snow" ? "#d3d7dc" : "#aab4be");
    sky = wk === "fog" ? ["#b8bec2", "#c9cdcf", "#d3d5d3"] : wk === "rain" ? ["#5d646c", "#80878d", "#a2a6a6"] : wk === "storm" ? ["#3e4450", "#5c6168", "#7d8084"] : wk === "snow" ? ["#9aa3ad", "#c2c7cc", "#dddfe0"] : ["#7d8791", "#a4abb1", "#c3c6c4"]; fogCol = sky[1]; }
  const c = document.createElement("canvas"); c.width = 2; c.height = 256; const g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, sky[0]); gr.addColorStop(0.55, sky[1]); gr.addColorStop(1, sky[2]); g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; scene.background = tex;
  scene.fog = wk === "fog" ? new THREE.Fog(fogCol, 90, 900) : wk === "storm" ? new THREE.Fog(fogCol, 500, 3200) : wk === "snow" ? new THREE.Fog(fogCol, 700, 4200) : wk === "rain" ? new THREE.Fog(fogCol, 900, 5000) : new THREE.Fog(fogCol, 6000, 14000);
  // a wash over the whole view: the colour of the light (the terrain shader has its own sun colour)
  const tint = document.createElement("div"); tint.id = "todtint"; tint.className = [L.tint, wk].filter(Boolean).join(" "); document.body.append(tint);
  return {
    mist: wk === "fog" ? 0.9 : wk === "storm" ? 0.35 : wk === "rain" ? 0.25 : wk === "snow" ? 0.3 : 0,
    rain: wk === "rain" || wk === "storm" ? (wk === "storm" ? 1 : 0.8) : 0, snow: wk === "snow" ? 0.8 : 0,
    wet: wk === "storm" ? 0.8 : W.rain || 0, snowCover: wk === "snow" ? 0.85 : 0,
  };
}

// the generated bridge (Stirling): a timber deck on trestles over the causeway the sim walks on
export function addBridge(scene, map, br) {
  if (!br) return null;
  const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: "#6b5238", roughness: 0.9 }), dark = new THREE.MeshStandardMaterial({ color: "#4a3826", roughness: 0.95 });
  const dx = br.x1 - br.x0, dy = br.y1 - br.y0, L = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(L, 0.35, br.width), wood); deck.position.set(L / 2, 0, 0); g.add(deck);
  for (let s = 2; s < L - 1; s += 5) for (const side of [-1, 1]) {
    const x = s, wx = br.x0 + Math.cos(ang) * x, wy = br.y0 + Math.sin(ang) * x, bed = Math.min(map.h(wx, wy), br.deck) - 2.5, h = br.deck - bed;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, h + 1.2, 0.35), dark); post.position.set(x, -h / 2 + 0.6, side * (br.width / 2 - 0.2)); g.add(post);
  }
  for (const side of [-1, 1]) { const rail = new THREE.Mesh(new THREE.BoxGeometry(L, 0.18, 0.18), dark); rail.position.set(L / 2, 1.05, side * (br.width / 2 - 0.2)); g.add(rail); }
  g.position.set(br.x0, br.deck - 0.1, -br.y0); g.rotation.y = ang; // (three: x east, y up, z south)
  scene.add(g); return g;
}

// ---------------------------------------------------------------- the battle, and the frame round it
// deps = { PLAYER, V, places, scene }
export function startBattle(w, cfg, deps) {
  const battle = setupBattle(w, cfg, deps);
  battle.frame = () => {}; // (rain and snow are drawn by js/render/weatherfx.js, driven from main.js for every mode)
  const bar = document.createElement("div"); bar.id = "battlebar"; document.querySelector("#hud").append(bar); battle.bar = bar;
  battle.updateBar = () => updateBar(w, battle);
  return battle;
}

function updateBar(w, B) {
  const rec = B.rec, t = B.phase === "deploy" ? 0 : w.time - rec.t0, cfg = B.cfg, P = B.PLAYER;
  const st = rec.now || [rec.strength(0), rec.strength(1)];
  const pct = (tm) => Math.max(0, Math.min(100, Math.round(st[tm].fight / Math.max(1, rec.start[tm]) * 100)));
  let obj = "";
  if (B.ob.timeLimit && B.phase !== "deploy") { const left = Math.max(0, B.ob.timeLimit.secs - t); obj = `<span class="bb-obj" title="${B.ob.timeLimit.winner >= 0 ? `At nightfall ${B.names.side(B.ob.timeLimit.winner)} win if they still hold` : "At nightfall both hosts draw off"}">☾ ${B.ob.timeLimit.winner >= 0 ? "Nightfall" : "Dark"} in ${mmss(left)}</span>`; }
  if (B.ob.bridgehead && B.phase !== "deploy") { const bh = B.ob.bridgehead, n = rec.acrossCount(bh); obj += `<span class="bb-obj" title="${cap(B.names.side(bh.team))} win if ${bh.men} of their men hold the far bank for ${bh.secs / 60} minutes">⌒ ${n}/${bh.men} ${B.names.adj(bh.team) || ""} across${bh.heldSince !== undefined ? ` · held ${mmss(t - bh.heldSince)}` : ""}</span>`; }
  const wx = wxBadge(cfg.weather) + (cfg.windFrom ? `, wind from the ${cfg.windFrom}` : ""), tod = TOD[cfg.tod]?.name || "";
  const html = `<span class="bb-name">${cfg.name || "The battle"}</span><span class="bb-t">${B.phase === "deploy" ? "Deploying" : mmss(t)}</span><span class="bb-wx">${tod} · ${wx}</span>${obj}
    <span class="bb-str"><i class="t0" style="width:${pct(P)}%"></i></span><span class="bb-n">${st[P].fight}<small>/${rec.start[P]}</small></span>
    <span class="bb-vs">·</span><span class="bb-n">${B.cfg.sides[B.sideOf(1 - P)].hidden && B.phase === "deploy" ? "?" : st[1 - P].fight}<small>/${B.cfg.sides[B.sideOf(1 - P)].hidden && B.phase === "deploy" ? "?" : rec.start[1 - P]}</small></span><span class="bb-str"><i class="t1" style="width:${pct(1 - P)}%"></i></span>`;
  if (B.bar._h !== html) { B.bar._h = html; B.bar.innerHTML = html; }
}
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
function compass(a) { const k = Math.round((((a * 180 / Math.PI) % 360 + 360) % 360) / 45) % 8; return ["east", "north-east", "north", "north-west", "west", "south-west", "south", "south-east"][k]; }
export { canSee };
