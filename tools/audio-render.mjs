// Render the scripted 60-s battle mix (tools/audio-preview.html) through the real audio engine in headless
// Chrome's OfflineAudioContext, save the WAVs to status/audio/, then measure them (tools/audio/analyze.py):
// clipping, true peak, loudness (integrated / short-term / per 10 s), octave-band balance, spectrogram PNG.
//   python3 tools/serve.py 8321 &  node tools/audio-render.mjs [--port 8321] [--py <python with numpy+scipy>] [--game]
// --game also plays the REAL game (?mode=battle), fast-forwards to contact, and records what the player hears
// through js/audio for 25 s at the ground view and 20 s at the eagle view (status/audio/game_*.wav).
import { openPage } from "./audio/cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const port = +arg("port", 8321), ROOT = fileURLToPath(new URL("..", import.meta.url)), OUT = join(ROOT, "status/audio");
mkdirSync(OUT, { recursive: true });
const page = await openPage(`http://localhost:${port}/tools/audio-preview.html?render`);
let code = 0;
try {
  if (!(await page.waitFor("window.PREVIEW_READY === true", 30000))) throw new Error("preview page did not load");
  const files = [];
  for (const [name, opts] of process.argv.includes("--game-only") ? [] : [["mix_ground", { eagle: false }], ["mix_eagle", { eagle: true }]]) {
    const t0 = Date.now();
    const r = await page.evaluate(`renderMix(62, ${JSON.stringify(opts)})`);
    let b64 = ""; for (let i = 0; i < r.size; i += 1 << 20) b64 += await page.evaluate(`window.__mix.slice(${i}, ${i + (1 << 20)})`);
    const f = join(OUT, name + ".wav"); writeFileSync(f, Buffer.from(b64, "base64")); files.push(f);
    const top = Object.entries(r.stats.byName).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}×${v}`).join(" ");
    console.log(`${name}: rendered in ${((Date.now() - t0) / 1000).toFixed(1)} s · voices played ${r.stats.played}, stolen ${r.stats.stolen}, dropped ${r.stats.dropped}, culled ${r.stats.culled}, max concurrent ${r.stats.maxVoices}, clipped samples ${r.stats.clippedSamples}\n   most played: ${top}`);
  }
  if (page.errors.length) { console.log("page errors:\n  " + page.errors.join("\n  ")); code = 1; }
  if (process.argv.includes("--game") || process.argv.includes("--game-only")) files.push(...await game());
  const py = arg("py", process.env.HG_PY || "python3");
  const a = spawnSync(py, [join(ROOT, "tools/audio/analyze.py"), ...files], { stdio: "inherit" });
  if (a.status) code = a.status;
} catch (e) { console.error(e.message); code = 1; }
page.close(); process.exit(code);

async function game() {
  const g = await openPage(`http://localhost:${port}/?mode=battle&shot&banner=0&nofog`, { gpu: true });
  const out = [];
  try {
    await new Promise((r) => setTimeout(r, 4000)); // let the navigation settle before polling
    if (!(await g.waitFor("!!(window.HG && window.HG_AUDIO && HG_AUDIO.engine.ready)", 180000))) throw new Error("game/audio did not load: " + (await g.evaluate("document.title").catch((e) => e.message)));
    const info = await g.evaluate(`(async () => {
      const { step, issueOrder } = await import("/js/sim/world.js");
      const { ARMS } = await import("/js/sim/arms.js");
      const w = HG.w, S = w.S, cam = HG.camera, A = HG_AUDIO; A.engine.resume();
      const fight = () => { let n = 0, x = 0, y = 0; for (let i = 0; i < S.n; i++) if (S.alive[i] && S.state[i] === 2) { n++; x += S.x[i]; y += S.y[i]; } return [n, x / (n || 1), y / (n || 1)]; };
      // close the range, then send Blue in (so the recording has a real mêlée, cavalry, horns and war cries)
      let k = 0, f = fight(); for (; k < 2400; k++) step(w);
      const reds = [...w.units.values()].filter((u) => u.team === 1 && !u.isWorkers && u.members.length);
      for (const u of [...w.units.values()].filter((u) => u.team === 0 && !u.isWorkers && u.members.length)) {
        const t = reds.sort((a, b) => Math.hypot(a.ax - u.ax, a.ay - u.ay) - Math.hypot(b.ax - u.ax, b.ay - u.ay))[0]; if (!t) break;
        if (ARMS[u.arm]?.missile) continue;
        issueOrder(w, [u.id], { kind: "assault", x: t.ax, y: t.ay, target: t.id, pace: ARMS[u.arm]?.mounted ? "charge" : "quick" });
      }
      for (; k < 9000 && f[0] < 60; k++) { step(w); if (k % 10 === 0) f = fight(); }
      window.__drive = (view) => { const [n, x, y] = fight(); if (n) cam.focus(x, y); cam.setView(view); cam.st.pitch = cam.goal.pitch; cam.st.dist = cam.goal.dist; };
      // does the game's own frame loop run here (then it steps the sim and calls audio.update itself)?
      const t0 = w.tick; await new Promise((r) => setTimeout(r, 1200)); const selfRun = w.tick > t0;
      let acc = 0; if (!selfRun) window.__loop = setInterval(() => { acc += 0.05; while (acc >= 0.1) { step(w); acc -= 0.1; } cam.update(0.05, 1.6); A.battle.update(0.05); }, 50);
      return { skipped: k, fighting: f[0], battleTime: Math.round(w.time), selfRun };
    })()`);
    console.log(`game: fast-forwarded ${info.skipped} ticks to contact (${info.fighting} men fighting, t=${info.battleTime}s; game loop ${info.selfRun ? "running itself" : "driven by this tool"})`);
    for (const [name, view, secs] of [["game_ground", 3, 25], ["game_eagle", 1, 20]]) {
      const r = await g.evaluate(`(async () => { __drive(${view}); await new Promise((r) => setTimeout(r, 1500)); const b = await HG_AUDIO.engine.record(${secs});
        let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); window.__rec = btoa(s);
        const e = HG_AUDIO.engine; return { size: __rec.length, played: e.stats.played, stolen: e.stats.stolen, dropped: e.stats.dropped, voices: e.activeVoices(),
          beds: [...e.emitters.values()].map((L) => L.name + ":" + L.slots.filter((q) => q.level > 0.001).length).join(" "), top: Object.entries(e.stats.byName).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => k + "×" + v).join(" ") }; })()`, 120000);
      let b64 = ""; for (let i = 0; i < r.size; i += 1 << 20) b64 += await g.evaluate(`window.__rec.slice(${i}, ${i + (1 << 20)})`);
      const f = join(OUT, name + ".wav"); writeFileSync(f, Buffer.from(b64, "base64")); out.push(f);
      console.log(`${name}: played ${r.played} (stolen ${r.stolen}, dropped ${r.dropped}), live voices ${r.voices}\n   active beds: ${r.beds}\n   most played: ${r.top}`);
    }
    if (g.errors.length) console.log("game page errors/warnings:\n  " + g.errors.slice(0, 12).join("\n  "));
  } catch (e) { console.error("game:", e.message); code = 1; }
  g.close();
  return out;
}
