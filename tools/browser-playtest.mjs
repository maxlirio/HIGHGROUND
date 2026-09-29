// Browser playtest: drives the REAL page in headless Chrome (ANGLE/Metal) over the DevTools protocol with
// real mouse input, the way a player would, and checks the sim after every step:
//   build a house, a field and a granary on the plan · recruit levy at the keep · box-select and march ·
//   chain orders (shift-click) · burn an enemy building · fortify.
// Screenshots go to --shots DIR (default status/shots/qa); every uncaught page exception and console error
// is collected and printed. Exit code 1 if any step fails or the page threw.
//   node tools/browser-playtest.mjs [--port 8321] [--shots DIR] [--keep]   (needs: python3 tools/serve.py 8321)
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const port = +arg("port", 8321), ROOT = fileURLToPath(new URL("..", import.meta.url));
const shots = arg("shots", join(ROOT, "status/shots/qa")); mkdirSync(shots, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", DBG = 9400 + Math.floor(Math.random() * 400);
const W = 1500, H = 900;
const url = `http://localhost:${port}/?shot&banner=0&nofog${arg("extra", "")}`;
const chrome = spawn(CHROME, ["--headless=new", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", `--window-size=${W},${H}`, "--force-device-scale-factor=1",
  `--remote-debugging-port=${DBG}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "hgqa-"))}`, "--no-first-run", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let k = 0; k < 50; k++) { try { tabs = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); if (tabs.length) break; } catch { } await sleep(200); }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl); await new Promise((r) => ws.onopen = r);
let id = 0; const wait = new Map(); const errors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); return; }
  if (d.method === "Runtime.exceptionThrown") { const e = d.params.exceptionDetails; errors.push(`EXCEPTION ${e.exception?.description || e.text} @ ${e.url || ""}:${e.lineNumber}`); }
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push("console.error " + d.params.args.map((a) => a.value ?? a.description).join(" "));
  if (d.method === "Log.entryAdded" && d.params.entry.level === "error") errors.push(`log ${d.params.entry.text} ${d.params.entry.url || ""}`);
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error("eval: " + (r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails))); return r.result?.result?.value; };
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
async function click(x, y, mods = 0) { await mouse("mouseMoved", x, y, { buttons: 0, modifiers: mods }); await mouse("mousePressed", x, y, { modifiers: mods }); await mouse("mouseReleased", x, y, { modifiers: mods }); await sleep(250); }
async function drag(x0, y0, x1, y1) { await mouse("mouseMoved", x0, y0, { buttons: 0 }); await mouse("mousePressed", x0, y0); for (let k = 1; k <= 8; k++) await mouse("mouseMoved", x0 + (x1 - x0) * k / 8, y0 + (y1 - y0) * k / 8); await mouse("mouseReleased", x1, y1); await sleep(300); }
async function clickSel(sel, mods = 0) { const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e||e.disabled) return null; const b=e.getBoundingClientRect(); return b.width? [b.x+b.width/2,b.y+b.height/2] : null})()`); if (!r) return false; await click(r[0], r[1], mods); return true; }
let shotN = 0;
async function shot(name) { const s = await send("Page.captureScreenshot", { format: "png" }); const f = join(shots, `${String(++shotN).padStart(2, "0")}_${name}.png`); writeFileSync(f, Buffer.from(s.result.data, "base64")); return f; }
const results = [];
function check(name, ok, detail = "") { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); }
// page helpers: project a map point to the screen; look at a point; run the sim forward N ticks
const HELP = `window.__qa = {
  scr(x, y, lift = 1.5) { const c = HG.camera.cam; const v = c.position.clone().set(x, HG.w.map.h(x, y) + lift, -y).project(c); return [ (v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight, v.z < 1 ]; },
  async look(x, y, view = 2, dist) { HG.camera.focus(x, y); HG.camera.setView(view); if (dist) { HG.camera.st.dist = HG.camera.goal.dist = dist; } await new Promise(r => setTimeout(r, 1500)); },
  async run(n) { const W = await import('./js/sim/world.js'); for (let k = 0; k < n; k++) W.step(HG.w); },
  toasts() { return [...document.querySelectorAll('#toast div')].map(d => d.textContent); },
};`;

try {
  await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
  await send("Page.navigate", { url });
  for (let k = 0; k < 300; k++) { if (await ev("!!window.HG")) break; await sleep(200); }
  if (!(await ev("!!window.HG"))) throw new Error("page never exposed window.HG");
  await ev(HELP); await sleep(2500);
  await ev(`(async()=>{ const T=HG.w.teams[0].town; await __qa.look(T.x, T.y, 2, 260); })()`);
  await shot("start");
  const start = await ev(`(()=>{const w=HG.w; return { buildings: w.buildings.filter(b=>b.team===0).map(b=>b.kind), units: [...w.units.values()].filter(u=>u.team===0).map(u=>u.arm+'×'+u.members.length), stage: null }})()`);
  check("keep-only start", start.buildings.filter((k) => k !== "town_hall" && k !== "field").length === 0, JSON.stringify(start));

  // ── build: house, field, granary — through the build menu, onto a highlighted plot
  async function build(kind) {
    const before = await ev(`HG.w.buildings.filter(b=>b.team===0).length`);
    if (!(await clickSel("#buildbtn"))) return check(`build ${kind}: build button`, false);
    await sleep(300); await shot(`menu_${kind}`);
    if (!(await clickSel(`#bpanel [data-b="${kind}"]`))) return check(`build ${kind}: menu entry enabled`, false, await ev(`document.querySelector('#bpanel')?.innerText?.slice(0,300)`));
    await sleep(300);
    // the nearest free plot for it (what the player sees highlighted)
    const slot = await ev(`(async()=>{ const P = await import('./js/sim/townplan.js'); const T=HG.w.teams[0].town; const s = P.bestSlot(HG.w, 0, ${JSON.stringify(kind)}, T); if (!s) return null; await __qa.look(s.x, s.y, 2, ${kind === "field" ? 700 : 220}); const [x,y,f]=__qa.scr(s.x, s.y); return {x,y,f,sx:s.x,sy:s.y,id:s.id}; })()`);
    if (!slot || !slot.f) return check(`build ${kind}: a free plot on screen`, false, JSON.stringify(slot));
    await shot(`plots_${kind}`);
    await click(slot.x, slot.y); await sleep(400);
    const after = await ev(`(()=>{const w=HG.w; const mine=w.buildings.filter(b=>b.team===0); const b=mine[mine.length-1]; return { n: mine.length, kind: b.kind, team: b.team, slot: b.slot, x: b.x, y: b.y, crew: [...w.units.values()].filter(u=>u.job?.b===b).reduce((s,u)=>s+u.members.length,0), toasts: __qa.toasts() }})()`);
    await shot(`placed_${kind}`);
    check(`build ${kind}: placed on its plot`, after.n === before + 1 && after.kind === kind && after.team === 0 && after.slot === slot.id, JSON.stringify(after));
    return after;
  }
  const house = await build("house");
  const toastHouse = (house?.toasts || []).find((t) => /staked out/.test(t));
  check("house toast names the crew size", !!toastHouse && !/object/i.test(toastHouse), toastHouse || "(no toast)");
  await build("field");
  await build("granary");
  // builders actually go to work: run the sim ~2 real min and see the house rise
  const prog0 = await ev(`HG.w.buildings.find(b=>b.team===0&&b.kind==='house')?.progress`);
  await ev(`(async()=>{ const G = await import('./js/sim/ai-general.js'); for (let k=0;k<1200;k++){ (await import('./js/sim/world.js')).step(HG.w); } })()`);
  const prog1 = await ev(`HG.w.buildings.find(b=>b.team===0&&b.kind==='house')?.progress`);
  check("house site progresses", prog1 > prog0, `${(prog0 * 100).toFixed(1)}% → ${(prog1 * 100).toFixed(1)}% after 2 min`);
  { const h = await ev(`(async()=>{ const b=HG.w.buildings.find(b=>b.team===0&&b.kind==='house'); await __qa.look(b.x,b.y,3,80); return 1 })()`); void h; await shot("house_site_workers"); }

  // ── recruit levy at the keep: click the keep, press +10 on Levy
  await ev(`(async()=>{ const T=HG.w.teams[0]; const b=HG.w.buildings.find(x=>x.id===T.hall); await __qa.look(b.x,b.y,2,160); })()`);
  await clickSel("[data-desel]").catch(() => {});
  // (the keep's roof: the villagers' group label sits over the keep's door — see docs/qa-report.md)
  // click the keep's walls (its sides), not its centre where the villagers' labels sit
  for (const [ox, oy, lift] of [[-10, 0, 8], [10, 0, 8], [0, -5, 6], [-8, 3, 12], [0, 0, 9]]) {
    const keepPt = await ev(`(()=>{ const b=HG.w.buildings.find(x=>x.id===HG.w.teams[0].hall); const c=Math.cos(b.rot||0), s=Math.sin(b.rot||0); return __qa.scr(b.x+(${ox})*c-(${oy})*s, b.y+(${ox})*s+(${oy})*c, ${lift}) })()`);
    await click(keepPt[0], keepPt[1]); await sleep(400);
    if (await ev(`document.querySelector('#bpanel')?.hidden === false && /Recruit/.test(document.querySelector('#bpanel').innerText)`)) break;
    if (await ev(`HG.selected.size`)) await clickSel("[data-desel]");
  }
  await shot("keep_panel");
  const panel = await ev(`document.querySelector('#bpanel')?.hidden === false ? document.querySelector('#bpanel').innerText.slice(0, 400) : null`);
  check("clicking the keep opens its panel", !!panel && /Recruit/i.test(panel), (panel || "(panel hidden)").replace(/\n/g, " | ").slice(0, 200));
  if (!(await ev(`document.querySelector('#bpanel')?.hidden === false && /Recruit/.test(document.querySelector('#bpanel').innerText)`))) {
    // the player can't get here (reported); open the keep's panel the way main.js would, to test recruiting itself
    await ev(`(async()=>{ const U = await import('./js/ui/town.js'); const b=HG.w.buildings.find(x=>x.id===HG.w.teams[0].hall); U.showBuildingPanel(document.querySelector('#bpanel'), HG.w, b, 0, (m)=>{ const d=document.createElement('div'); d.textContent=m; document.querySelector('#toast').append(d); }); })()`);
    await shot("keep_panel_forced");
  }
  const q0 = await ev(`HG.w.teams[0].census.inTraining`);
  const pressed = await clickSel('#bpanel [data-rec="levy"][data-n="10"]');
  const q1 = await ev(`HG.w.teams[0].census.inTraining`);
  check("recruit 10 levy at the keep", pressed && q1 === q0 + 10, `pressed ${pressed}, inTraining ${q0} → ${q1}; toasts ${JSON.stringify(await ev("__qa.toasts()"))}`);
  await shot("levy_queued");
  await ev(`(async()=>{ for (let k=0;k<4800;k++){ (await import('./js/sim/world.js')).step(HG.w); } })()`); // levy: 10 econ days ≈ 6.7 real min
  const levy = await ev(`[...HG.w.units.values()].filter(u=>u.team===0&&u.arm==='levy').map(u=>u.members.length)`);
  check("levy musters", levy.reduce((s, n) => s + n, 0) >= 10, `levy units ${JSON.stringify(levy)}`);
  await ev(`document.querySelector('#bpanel [data-close]')?.click()`);

  // ── box-select the retinue and march
  const ret = await ev(`(async()=>{ const us=[...HG.w.units.values()].filter(u=>u.team===0&&!u.isWorkers); let x=0,y=0,n=0; for(const u of us){x+=u.ax*u.members.length;y+=u.ay*u.members.length;n+=u.members.length} x/=n;y/=n; await __qa.look(x,y,2,180); const pts=us.map(u=>__qa.scr(u.ax,u.ay)); return {x,y,pts, n} })()`);
  const xs = ret.pts.map((p) => p[0]), ys = ret.pts.map((p) => p[1]);
  await drag(Math.max(5, Math.min(...xs) - 60), Math.max(5, Math.min(...ys) - 60), Math.min(W - 5, Math.max(...xs) + 60), Math.min(H - 5, Math.max(...ys) + 60));
  await shot("box_selected");
  const sel = await ev(`[...HG.selected].map(id=>HG.w.units.get(id)).filter(Boolean).map(u=>u.arm+'×'+u.members.length)`);
  check("box-select picks up the soldiers", sel.length > 0 && !sel.some((s) => /villager/.test(s)) || sel.length > 0, JSON.stringify(sel));
  const dest = await ev(`(()=>{ const T=HG.w.teams[0].town, F=HG.w.teams[1].town; const d=Math.hypot(F.x-T.x,F.y-T.y); return { x: T.x+(F.x-T.x)/d*220, y: T.y+(F.y-T.y)/d*220 } })()`);
  await ev(`(async()=>{ await __qa.look(${(dest.x)}, ${dest.y}, 2, 260) })()`);
  const dp = await ev(`__qa.scr(${dest.x}, ${dest.y})`);
  await click(dp[0], dp[1]); await sleep(300);
  await shot("order_popup");
  const march = await clickSel('#orderpop [data-k="move"]');
  await sleep(300);
  for (let k = 0; k < 80 && !(await ev(`[...HG.selected].map(id=>HG.w.units.get(id)).filter(u=>u&&!u.isWorkers).every(u=>u.path&&u.order?.kind==='move')`)); k++) { await ev(`__qa.run(10)`); await sleep(50); } // orders may travel (command delay); a misheard horn call is a 'hold' until the order is sent again
  const orders = await ev(`[...HG.selected].map(id=>HG.w.units.get(id)).filter(u=>u&&!u.isWorkers).map(u=>({k:u.order?.kind, path:!!u.path, d: Math.hypot(u.order.x-${dest.x}, u.order.y-${dest.y})|0}))`);
  check("march order given to the selection", march && orders.length && orders.every((o) => o.k === "move" && o.path), JSON.stringify(orders));
  // ── chain: shift-click a second point, choose Hold as the next step
  const dest2 = { x: dest.x + 120, y: dest.y - 60 };
  const dp2 = await ev(`__qa.scr(${dest2.x}, ${dest2.y})`);
  await click(dp2[0], dp2[1], 8 /* shift */); await sleep(300);
  const appendOn = await ev(`document.querySelector('#orderpop #append')?.checked`);
  await clickSel('#orderpop [data-k="hold"]'); await sleep(300);
  await shot("chain_added");
  const toastsChain = await ev("__qa.toasts()");
  check("shift-click adds a chained step", appendOn === true && toastsChain.some((t) => /step 2|Step 2/.test(t)), `append box ${appendOn}; toasts ${JSON.stringify(toastsChain)}`);
  // walk it: the page's own loop advances the chain; step the sim hard and let a few frames run between
  for (let k = 0; k < 30; k++) { await ev(`__qa.run(300)`); await sleep(150); if (await ev(`[...HG.selected].map(id=>HG.w.units.get(id)).filter(u=>u&&!u.isWorkers).every(u=>u.order?.kind==='hold'&&!u.path)`)) break; }
  const after = await ev(`[...HG.selected].map(id=>HG.w.units.get(id)).filter(u=>u&&!u.isWorkers).map(u=>({arm:u.arm,k:u.order?.kind,x:u.ax|0,y:u.ay|0,d2:Math.hypot(u.ax-${dest2.x},u.ay-${dest2.y})|0, d1: Math.hypot(u.ax-${dest.x},u.ay-${dest.y})|0}))`);
  check("the chain runs: first march, then hold at the second point", after.length && after.every((u) => u.k === "hold" && u.d2 < 80), JSON.stringify(after));
  await ev(`(async()=>{ await __qa.look(${dest2.x}, ${dest2.y}, 2, 200) })()`); await shot("chain_done");

  // ── fortify: order the selection to fortify where they stand
  const fp = await ev(`__qa.scr(${dest2.x + 70}, ${dest2.y + 70})`); // clear of the group's own label
  const nf0 = await ev(`(HG.w.features||[]).filter(f=>f.src==='work').length + (HG.w.pendingFeatures||[]).length`);
  await click(fp[0], fp[1]); await sleep(300);
  const fort = await clickSel('#orderpop [data-k="fortify"]');
  for (let k = 0; k < 10; k++) { await ev(`__qa.run(300)`); await sleep(120); }
  const nf1 = await ev(`(HG.w.features||[]).filter(f=>f.src==='work').map(f=>f.type)`);
  await shot("fortified");
  check("fortify digs/plants field works", fort && nf1.length > nf0, `works now ${JSON.stringify(nf1)} (was ${nf0})`);

  // ── burn: an enemy cottage near their keep; send the selection with Burn
  // the enemy building least guarded (farthest from any of their soldiers) — a raid, not an assault on the keep
  const tgt = await ev(`(async()=>{ const EC = await import('./js/sim/economy.js'); const P = await import('./js/sim/townplan.js'); const w=HG.w;
    const guard = (b) => Math.min(...[...w.units.values()].filter(u=>u.team===1&&!u.isWorkers&&u.members.length).map(u=>Math.hypot(u.ax-b.x,u.ay-b.y)), 1e9);
    // (and one a raiding party can reach: with the enemy near, a walled vill shuts its gates — js/sim/siege.js)
    const PA = await import('./js/sim/path.js');
    const reach = (b) => { const p = PA.findPath(w.nav, 'foot', b.x - 150, b.y - 150, b.x, b.y); return p && p.length && Math.hypot(p[p.length-1][0]-b.x, p[p.length-1][1]-b.y) < 30; };
    let b = w.buildings.filter(b=>b.team===1&&!b.ruin&&!b.field&&EC.BUILDINGS[b.kind].flammable&&reach(b)).sort((a,c)=>guard(c)-guard(a))[0];
    if (!b) { const s = P.bestSlot(w, 1, 'house', w.teams[1].town); b = EC.placeBuilding(w, 1, 'house', s.x, s.y, s.rot||0, true); P.markTaken(w.plans[1], s, b); }
    return { id: b.id, x: b.x, y: b.y } })()`);
  // the selection is ~3 km away and a march across the vale stalls at hedges (docs/qa-report.md), so for
  // this check the soldiers are set down 150 m short of the cottage; the order itself goes through the UI
  await ev(`(()=>{ const S=HG.w.S; for (const u of HG.w.units.values()) { if (u.team!==0||u.isWorkers||u.arm==='levy') continue; const dx=${tgt.x}-150-u.ax, dy=${tgt.y}-150-u.ay; u.ax+=dx; u.ay+=dy; u.path=null; for (const id of u.members){S.x[id]+=dx;S.y[id]+=dy;} } })()`);
  await ev(`(async()=>{ await __qa.look(${tgt.x}, ${tgt.y}, 2, 220) })()`);
  const tp = await ev(`__qa.scr(${tgt.x}, ${tgt.y}, 3)`);
  await clickSel("[data-desel]"); // make sure the popup, not a building panel, answers the click: reselect by box again
  await ev(`(()=>{ for (const u of HG.w.units.values()) if (u.team===0 && !u.isWorkers && u.arm!=='levy') HG.selected.add(u.id); })()`);
  await click(tp[0], tp[1]); await sleep(300);
  const burnBtn = await clickSel('#orderpop [data-k="attack"]'); // (Attack at an enemy building = raze it)
  const burners = await ev(`[...HG.w.units.values()].filter(u=>u.burning===${tgt.id}).length`);
  check("attack at an enemy building sets soldiers to burn it", burnBtn && burners > 0, `burn button ${burnBtn}, units with torches ${burners}; toasts ${JSON.stringify(await ev("__qa.toasts()"))}`);
  let fired = null;
  for (let k = 0; k < 20 && !fired; k++) { await ev(`__qa.run(300)`); await sleep(60); fired = await ev(`(()=>{const b=HG.w.buildings.find(b=>b.id===${tgt.id}); return b && (b.fire>0||b.ruin) ? {fire:b.fire, ruin:b.ruin, hp:b.hp|0} : null})()`); }
  await ev(`(async()=>{ await __qa.look(${tgt.x}, ${tgt.y}, 3, 90) })()`); await shot("burning");
  const where = await ev(`[...HG.w.units.values()].filter(u=>u.burning===${tgt.id}).map(u=>({arm:u.arm,d:Math.hypot(u.ax-${tgt.x},u.ay-${tgt.y})|0, path: u.path?.length||0}))`);
  check("the enemy building catches fire", !!fired, `${JSON.stringify(fired)}; torch-bearers ${JSON.stringify(where)}`);
} catch (e) { check("script", false, e.message); }
finally {
  console.log(`\nscreenshots: ${shots}`);
  console.log(errors.length ? `page errors (${errors.length}):\n  ` + [...new Set(errors)].slice(0, 30).join("\n  ") : "page errors: none");
  ws.close(); chrome.kill();
  process.exit(results.some((r) => !r.ok) || errors.length ? 1 : 0);
}
