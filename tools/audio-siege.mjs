// Siege/castle sound in the REAL game, headless (docs/siege-audio.md). Three passes, each recorded through the
// engine's own output (post-limiter) into status/audio/*.wav and measured by tools/audio/analyze.py:
//  A. ?demo=siege-engines&wall=stone_wall — the sim's own siege: trebuchet, mangonel, ram at the gate, the belfry
//     rolling up, ladders. Checks the engine sounds, stone flights and impacts actually play.
//  B. ?demo=castle — every castle/siege event SIEGE-MECH emits, played through the real handlers (battle.inject),
//     at the castle's own parts; then the camera goes into the keep (enclosure → the hall's reverb) and down into
//     the gate passage; then a SIEGE-MODE stand-in (w.siegeWar) lets days pass (the camp) and sounds the assault.
// Fails (exit 1) on page errors, on a sound that did not play, or on clipping.
//   python3 tools/serve.py 8321 &   tools/heavy.sh node tools/audio-siege.mjs [--port 8321] [--only A|B]
import { openPage } from "./audio/cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const port = +arg("port", 8321), only = arg("only", ""), ROOT = fileURLToPath(new URL("..", import.meta.url)), OUT = join(ROOT, "status/audio");
mkdirSync(OUT, { recursive: true });
let code = 0; const files = [];
const fail = (m) => { console.log("FAIL " + m); code = 1; };

async function save(p, name) {
  const n = await p.evaluate("window.__rec.length");
  let b64 = ""; for (let i = 0; i < n; i += 1 << 20) b64 += await p.evaluate(`window.__rec.slice(${i}, ${i + (1 << 20)})`);
  const f = join(OUT, name + ".wav"); writeFileSync(f, Buffer.from(b64, "base64")); files.push(f);
}
// in-page helpers: run the game (its own loop, or ours if headless Chrome doesn't tick it), record, stats
const PRE = `
  window.__A = HG_AUDIO; __A.engine.resume();
  window.__run = async (secs) => { await new Promise((r) => setTimeout(r, secs * 1000)); };
  window.__recS = async (secs) => { const b = await __A.engine.record(secs); let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); window.__rec = btoa(s); return b.length; };
  window.__snap = () => ({ ...__A.engine.stats.byName });
  window.__diff = (a) => { const b = __A.engine.stats.byName, o = {}; for (const k in b) if ((b[k] || 0) - (a[k] || 0) > 0) o[k] = b[k] - (a[k] || 0); return o; };
  window.__cam = (x, y, view, dist, pitch) => { const c = HG.camera; c.focus(x, y); c.setView(view); if (dist) c.st.dist = c.goal.dist = dist; if (pitch !== undefined) c.st.pitch = c.goal.pitch = pitch * Math.PI / 180; else c.st.pitch = c.goal.pitch; };
  window.__ensureLoop = async () => { const w = HG.w, t0 = w.tick; await new Promise((r) => setTimeout(r, 1200)); if (w.tick > t0) return true;
    const { step } = await import("/js/sim/world.js"); let acc = 0; window.__loop = setInterval(() => { acc += 0.05; while (acc >= 0.1) { step(w); acc -= 0.1; } HG.camera.update(0.05, 1.6); __A.battle.update(0.05); }, 50); return false; };
`;

async function passA() {
  const p = await openPage(`http://localhost:${port}/?demo=siege-engines&wall=stone_wall&shot&banner=0&nofog&steps=300`, { gpu: true });
  try {
    await new Promise((r) => setTimeout(r, 4000));
    if (!(await p.waitFor("!!(window.HG && window.HG_AUDIO && HG_AUDIO.engine.ready && HG.w.siege && HG.w.siege.engines.length)", 180000))) throw new Error("siege-engines demo / audio did not load");
    const r = await p.evaluate(`(async () => { ${PRE}
      const w = HG.w, E = w.siege.engines, T = E.find((e) => e.kind === "trebuchet"), W = w.buildings.find((b) => b.x1 !== undefined && b.team === 0);
      const self = await __ensureLoop();
      __cam(W ? W.x : T.x, W ? W.y : T.y, 2, 90);
      await __run(20); // the engines start working, stones in the air
      const a = __snap(), rec = __recS(30); const beds = new Set();
      for (let k = 0; k < 28; k++) { await __run(1); for (const L of __A.engine.emitters.values()) if (L.slots.some((q) => q.level > 0.001)) beds.add(L.name); }
      await rec;
      return { self, engines: E.map((e) => e.kind + ":" + (e.status || e.state)).join(" "), shots: w.siege.stats.visible, played: __diff(a), beds: [...beds].join(" "), voices: __A.engine.activeVoices(), rooms: [...__A.engine.rooms.keys()].join(",") };
    })()`, 200000);
    await save(p, "siege_engines");
    console.log(`A siege-engines (loop ${r.self ? "self" : "driven"}): engines ${r.engines}; visible shots ${r.shots}\n   played in 30 s: ${JSON.stringify(r.played)}\n   beds heard: ${r.beds}`);
    if (!/bed_belfry/.test(r.beds)) fail("A: the siege tower / ram moved without a sound (bed_belfry)");
    for (const k of ["trebuchet", "stone_wall"]) if (!r.played[k] && !(k === "stone_wall" && (r.played.stone_ground || r.played.stone_fly))) fail(`A: no ${k} in 30 s of bombardment`);
    if (p.errors.length) { console.log("   page errors:\n     " + p.errors.slice(0, 10).join("\n     ")); if (p.errors.some((e) => /EXCEPTION/.test(e) && /audio/.test(e))) fail("A: audio exception"); }
  } catch (e) { fail("A: " + e.message); }
  p.close();
}

async function passB() {
  const p = await openPage(`http://localhost:${port}/?demo=castle&shot&banner=0&nofog&steps=60&look=medium`, { gpu: true });
  try {
    await new Promise((r) => setTimeout(r, 4000));
    if (!(await p.waitFor("!!(window.HG && window.HG_AUDIO && HG_AUDIO.engine.ready && HG.castleDemo && HG.w.castles && HG.w.castles.length)", 180000))) throw new Error("castle demo / audio did not load");
    // 1. every event through the real handlers, at the castle's parts
    const r = await p.evaluate(`(async () => { ${PRE}
      const w = HG.w, S = w.S, C = w.castles[0], P = C.parts, keep = P.find((q) => q.kind === "keep"), gh = P.find((q) => q.kind === "gatehouse"), tw = P.find((q) => q.kind === "tower");
      const cur = P.find((q) => q.kind === "curtain" && q.bid !== undefined) || P.find((q) => q.kind === "curtain");
      const bx = cur ? (cur.x0 + cur.x1) / 2 : C.x, by = cur ? (cur.y0 + cur.y1) / 2 : C.y, gb = gh?.bid ?? w.buildings.find((b) => b.kind === "gatehouse" || b.kind === "gate")?.id;
      const man = (() => { let best = -1, bd = 1e9; for (let i = 0; i < S.n; i++) if (S.alive[i]) { const d = Math.hypot(S.x[i] - bx, S.y[i] - by); if (d < bd) { bd = d; best = i; } } return best; })();
      const self = await __ensureLoop();
      __cam(bx, by, 2, 70);
      await __run(2);
      const t = w.tick, ev = [
        ["wall-state", { building: cur?.bid, mod: 1, state: "cracked", was: "pocked", x: bx, y: by }, "masonry_crack"],
        ["wall-breached", { building: cur?.bid, mod: 2, x: bx + 6, y: by, cause: "shot", by: 1, team: 0 }, "wall_collapse"],
        ["portcullis-dropped", { building: gb, x: gh?.x ?? bx, y: gh?.y ?? by }, "portcullis_drop"],
        ["portcullis-raised", { building: gb, x: gh?.x ?? bx, y: gh?.y ?? by }, "portcullis_raise"],
        ["gate-leaves-broken", { building: gb, cause: "ram", by: 1 }, "leaves_break"],
        ["portcullis-broken", { building: gb, cause: "ram", by: 1 }, "portcullis_break"],
        ["ladder-pushed", { x: bx - 8, y: by, broken: true }, "ladder_push"],
        ["dropped", { who: man, by: -1, cause: "machicolation", what: "stone" }, "drop_stone"],
        ["dropped", { who: man, by: -1, cause: "murder-hole", what: "sand" }, "drop_sand"],
        ["stoned", { who: man, x: bx - 10, y: by, first: true, big: true }, "stone_men"],
        ["mine-fired", { x: bx - 20, y: by, mine: 1 }, "mine_fire"],
        ["mine-collapse", { building: cur?.bid, mod: 3, x: bx + 12, y: by, tower: false, full: false, by: 1, team: 0 }, "mine_collapse"],
        ["mine-fight", { x: bx - 15, y: by, attackersDead: 2, defendersDead: 1 }, "clash"],
        ["tower-collapsed", { building: tw?.bid ?? 999, x: tw?.x ?? bx, y: tw?.y ?? by, by: 1, team: 0 }, "tower_collapse"],
        ["breach-barricaded", { x: bx, y: by }, "hammer"],
      ];
      const got = [], a0 = __snap(), rec = __recS(58);
      for (const [kind, f, want] of ev) {
        const a = __snap(); __A.battle.inject({ t, kind, ...f });
        await __run(kind === "tower-collapsed" ? 6 : 3.2);
        const d = __diff(a); got.push([kind, want, d[want] || 0, Object.keys(d).join(" ")]);
      }
      // a stone in the air ending on the wall
      const a = __snap(); const s = { kind: "stone", big: true, x0: bx - 300, y0: by, h0: 20, x1: bx, y1: by, h1: 0, t0: w.time, t1: w.time + 3, apex: 60, team: 1, ux: 1, uy: 0 };
      s.h1 = HG.w.map.h(bx, by) + 4; __A.battle.siege.shot(s); await __run(3.5); got.push(["stone shot", "stone_fly", __diff(a).stone_fly || 0, Object.keys(__diff(a)).join(" ")]);
      await rec;
      return { self, got, all: __diff(a0), man };
    })()`, 240000);
    await save(p, "siege_events");
    console.log(`B castle demo (loop ${r.self ? "self" : "driven"}), events through the real handlers:`);
    for (const [kind, want, n, all] of r.got) { console.log(`   ${n ? "ok  " : "MISS"} ${kind.padEnd(20)} → ${want} ×${n}   (${all})`); if (!n) fail(`B: ${kind} did not play ${want}`); }
    // 2. the camera goes inside: the keep, the gate passage
    const q = await p.evaluate(`(async () => {
      const w = HG.w, C = w.castles[0], P = C.parts, E = __A.engine, ss = __A.battle.siege.state, c = HG.camera;
      // the camera clamps its target off the map's edge: take the keep, else the hall, else a tower it can centre on
      const reach = (q) => { c.focus(q.x, q.y); return Math.hypot(c.st.tx - q.x, c.st.ty - q.y) < 1; };
      const keep = ["keep", "hall", "tower"].map((k) => P.find((q) => q.kind === k && reach(q))).find(Boolean), gh = P.find((q) => q.kind === "gatehouse" && reach(q));
      const out = { part: keep?.kind };
      __cam(keep.x, keep.y, 3, 18, 60); await __run(2.5);
      out.keep = { encK: +ss.encK.toFixed(2), room: ss.encRoom, cut: HG.castles?.stats?.().cut.join(",") || "", rooms: [...E.rooms.keys()].join(","), vale: +E.revOut.gain.value.toFixed(2) };
      // a blow in the keep with the ear: record it (the hall's reverb) — and one outside (muffled)
      const [ex, ey] = __A.battle.state.ear, rec = __recS(5);
      await __run(0.3); E.play("clash", ...[ex + 2, HG.w.map.h(ex, ey) + 1.5, -(ey + 1)], { gain: 6 }); await __run(1.6); E.play("clash", ...[ex + 60, HG.w.map.h(ex, ey) + 1.5, -ey], { gain: 12 });
      await rec; out.keepRec = true;
      if (gh) { __cam(gh.x, gh.y, 3, 14, 50); await __run(2.5); out.gate = { encK: +ss.encK.toFixed(2), room: ss.encRoom, cut: HG.castles?.stats?.().cut.join(",") || "" }; }
      __cam(C.x ?? keep.x, C.y ?? keep.y, 2, 250); await __run(2.5); out.away = { encK: +ss.encK.toFixed(2), vale: +E.revOut.gain.value.toFixed(2) };
      return out;
    })()`, 120000);
    await save(p, "siege_keep");
    console.log(`   inside the ${q.part}: ${JSON.stringify(q.keep)}\n   at the gatehouse: ${JSON.stringify(q.gate)}\n   pulled back out: ${JSON.stringify(q.away)}`);
    if (!(q.keep.encK > 0.3) || !q.keep.rooms.includes("hall")) fail("B: no enclosure / hall reverb with the camera in the keep");
    if (q.away.encK > 0.05) fail("B: enclosure stuck on after leaving");
    // 3. SIEGE-MODE stand-in: days pass (the camp), then the assault
    const m = await p.evaluate(`(async () => {
      const w = HG.w, C = w.castles[0], E = __A.engine, ss = __A.battle.siege.state;
      const real = w.siegeWar; const cx = (C.x ?? 0) + 350, cy = C.y ?? 0;
      const G = real || { phase: "siege", camp: { x: cx, y: cy }, att: 1, def: 0, castle: C, assault: null, fake: true }; w.siegeWar = G;
      __cam(cx, cy, 2, 80); await __run(1.5);
      const a = __snap(); w.time += 3 * 86400 / 60; await __run(6); const camp = +ss.camp?.gain.gain.value.toFixed(3); const days = __diff(a);
      const rec = __recS(12); const b = __snap(); G.assault = { on: true }; G.phase = "assault"; await __run(8); const as = __diff(b); await rec;
      if (G.fake) delete w.siegeWar;
      return { real: !real?.fake && !!real, camp, days, assault: as };
    })()`, 120000);
    await save(p, "siege_camp_assault");
    console.log(`   camp (siegeWar ${m.real ? "real" : "stand-in"}): bed gain ${m.camp}; days-pass one-shots ${JSON.stringify(m.days)}\n   assault: ${JSON.stringify(m.assault)}`);
    if (!(m.camp > 0.01)) fail("B: camp bed silent"); if (!m.assault.assault_trumpets) fail("B: no assault trumpets");
    if (p.errors.length) { console.log("   page errors:\n     " + p.errors.slice(0, 10).join("\n     ")); if (p.errors.some((e) => /EXCEPTION/.test(e))) fail("B: page exception"); }
  } catch (e) { fail("B: " + e.message); }
  p.close();
}

if (!only || only === "A") await passA();
if (!only || only === "B") await passB();
const py = arg("py", process.env.HG_PY || "/usr/bin/python3");
if (files.length) {
  const a = spawnSync(py, [join(ROOT, "tools/audio/analyze.py"), ...files], { encoding: "utf8" });
  for (const f of files) { try { const j = JSON.parse((await import("node:fs")).readFileSync(f.replace(".wav", ".json"), "utf8")); console.log(`   ${j.file}: ${j.seconds}s, clipped ${j.clipped_samples}, true peak ${j.true_peak_dbtp} dBTP, integrated ${j.integrated_lufs} LUFS, max short-term ${j.short_term_max_lufs}`); if (j.clipped_samples > 0) fail(j.file + " clipped"); } catch { } }
  if (a.status) console.log(a.stderr?.slice(-400));
}
console.log(code ? "SIEGE AUDIO: FAIL" : "SIEGE AUDIO: OK");
process.exit(code);
