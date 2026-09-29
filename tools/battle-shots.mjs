// Headless screenshots of the battle frame (setup screen, deployment, moments, the reckoning) over the DevTools
// protocol, the way tools/browser-playtest.mjs drives the page. Each --step is "wait:<ms>", "until:<js expr>", "drag:x0,y0,x1,y1", "key:<key>",
// "eval:<js>", "click:<css selector>", "shot:<name>". Prints page errors; shots go to --shots DIR.
//   node tools/battle-shots.mjs --q "mode=battle&shot&setup" --steps "until:document.querySelector('.bs-card')|wait:1500|shot:setup"
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = fileURLToPath(new URL("..", import.meta.url)), port = +arg("port", 8321);
const shots = arg("shots", join(ROOT, "status/shots/battle")); mkdirSync(shots, { recursive: true });
const W = +arg("w", 1500), H = +arg("h", 900);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", DBG = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ["--headless=new", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", `--window-size=${W},${H}`, "--force-device-scale-factor=1",
  `--remote-debugging-port=${DBG}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "hgbs-"))}`, "--no-first-run", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let k = 0; k < 50; k++) { try { tabs = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); if (tabs.length) break; } catch { } await sleep(200); }
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl); await new Promise((r) => ws.onopen = r);
let id = 0; const wait = new Map(), errors = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); return; }
  if (d.method === "Runtime.exceptionThrown") { const e = d.params.exceptionDetails; errors.push(`EXCEPTION ${e.exception?.description || e.text} @ ${e.url || ""}:${e.lineNumber}`); }
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push("console.error " + d.params.args.map((a) => a.value ?? a.description).join(" ")); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) return "EVAL-ERR " + (r.result.exceptionDetails.exception?.description || ""); return r.result?.result?.value; };
await send("Runtime.enable"); await send("Page.enable");
await send("Page.navigate", { url: `${arg("base", `http://localhost:${port}/`)}?${arg("q", "mode=battle&shot")}` }); // (--base https://maxlirio.github.io/HIGHGROUND/ shoots the live site)
for (const st of (arg("steps", "wait:8000|shot:view")).split("|")) {
  const [k, ...rest] = st.split(":"), v = rest.join(":");
  if (k === "wait") await sleep(+v);
  else if (k === "until") { const t0 = Date.now(); while (Date.now() - t0 < 120000) { if (await ev(`!!(${v})`) === true) break; await sleep(300); } }
  else if (k === "eval") console.log("eval →", JSON.stringify(await ev(v))?.slice(0, 600));
  else if (k === "click") { const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(v)}); if(!e) return null; const b=e.getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2]})()`); if (r) { for (const t of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type: t, x: r[0], y: r[1], button: "left", buttons: t === "mousePressed" ? 1 : 0, clickCount: 1 }); await sleep(300); } else console.log("no element", v); }
  else if (k === "drag") { const [x0, y0, x1, y1] = v.split(",").map(Number); const M = (type, x, y, b = 1) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: b, clickCount: 1 });
    await M("mouseMoved", x0, y0, 0); await M("mousePressed", x0, y0); for (let i = 1; i <= 10; i++) { await M("mouseMoved", x0 + (x1 - x0) * i / 10, y0 + (y1 - y0) * i / 10); await sleep(30); } await M("mouseReleased", x1, y1, 0); await sleep(300); }
  else if (k === "rdrag") { const [x0, y0, x1, y1] = v.split(",").map(Number); const M = (type, x, y, b = 2) => send("Input.dispatchMouseEvent", { type, x, y, button: "right", buttons: b, clickCount: 1 });
    await M("mouseMoved", x0, y0, 0); await M("mousePressed", x0, y0); for (let i = 1; i <= 10; i++) { await M("mouseMoved", x0 + (x1 - x0) * i / 10, y0 + (y1 - y0) * i / 10); await sleep(30); } await M("mouseReleased", x1, y1, 0); await sleep(300); }
  else if (k === "key") { await send("Input.dispatchKeyEvent", { type: "keyDown", key: v, code: v === "Enter" ? "Enter" : "Key" + v.toUpperCase(), windowsVirtualKeyCode: v === "Enter" ? 13 : v.toUpperCase().charCodeAt(0) }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: v }); await sleep(300); }
  else if (k === "shot") { const s = await send("Page.captureScreenshot", { format: "png" }); const f = join(shots, v + ".png"); writeFileSync(f, Buffer.from(s.result.data, "base64")); console.log("shot", f); }
}
console.log("title:", await ev("document.title"));
if (errors.length) console.log("ERRORS\n" + errors.join("\n"));
ws.close(); chrome.kill();
process.exit(0);
