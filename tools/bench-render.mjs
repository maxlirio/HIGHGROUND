// Render benchmark: headless Chrome (real GPU via ANGLE/Metal, real clock — no virtual time) drives
// HG.benchView() through every camera preset and prints ms/frame, triangles and draw calls.
//   node tools/bench-render.mjs [--dpr 1|2] [--shots DIR] [--q low|medium|high] [--port 8321] [--yaws 0,2.4]
// Needs the dev server (python3 tools/serve.py 8321). Frame time = whole frame() incl. gl.finish().
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const dpr = +arg("dpr", 1), shots = arg("shots", null), q = arg("q", null), port = +arg("port", 8321);
const yaws = arg("yaws", "0,2.4").split(",").map(Number), views = arg("views", "0,1,2,3").split(",").map(Number);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", DBG = 9400 + Math.floor(Math.random() * 400);
const url = `http://localhost:${port}/?bench&nofog${q ? "&quality=" + q : ""}${arg("extra", "")}`;

const chrome = spawn(CHROME, ["--headless=new", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", `--window-size=1500,900`, `--force-device-scale-factor=${dpr}`,
  `--remote-debugging-port=${DBG}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "hgbench-"))}`, "--no-first-run", "--disable-gpu-vsync", "--disable-frame-rate-limit", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tabs; for (let k = 0; k < 50; k++) { try { tabs = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); if (tabs.length) break; } catch { } await sleep(200); }
const page = tabs.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => ws.onopen = r);
let id = 0; const wait = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result?.result?.value; };

try {
  await send("Page.enable"); await send("Page.navigate", { url });
  for (let k = 0; k < 300; k++) { if (await evalJs("!!window.HG")) break; const t = await evalJs("document.title"); if (/^(ERR|REJ)/.test(t || "")) throw new Error(t); await sleep(200); }
  const gpu = await evalJs(`(()=>{const gl=HG.renderer.getContext();const e=gl.getExtension("WEBGL_debug_renderer_info");return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):"?"})()`);
  console.log(`GPU: ${gpu}  dpr ${dpr}  quality ${q || "(default)"}  ${url}`);
  if (arg("eval")) { await sleep(+arg("wait", 20000)); console.log(JSON.stringify(await evalJs(arg("eval")), null, 1)); }
  const NAMES = ["Map", "Eagle", "Oblique", "Ground"], rows = [];
  if (shots) mkdirSync(shots, { recursive: true });
  for (const v of views) for (const y of yaws) {
    const r = await evalJs(`HG.benchView(${v}, ${y}${arg("at") ? `, { at: [${arg("at")}] }` : ""})`); rows.push(r);
    console.log(`${NAMES[v].padEnd(8)} yaw ${String(y).padEnd(4)} ${String(r.ms).padStart(7)} ms (p90 ${String(r.p90).padStart(6)}, rAF ${String(r.iv).padStart(6)}, cpu-pre ${String(r.pre).padStart(5)})  ~${(1000 / r.ms).toFixed(0).padStart(3)} fps  ${(r.tris / 1e6).toFixed(2).padStart(6)}M tris  ${String(r.calls).padStart(5)} calls  chunks vis ${r.visible}/${r.chunks}`);
    if (shots) { const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 85 }); writeFileSync(join(shots, `${NAMES[v].toLowerCase()}_${y}.jpg`), Buffer.from(s.result.data, "base64")); }
  }
  if (shots) writeFileSync(join(shots, "bench.json"), JSON.stringify(rows, null, 1));
} finally { ws.close(); chrome.kill(); }
process.exit(0);
