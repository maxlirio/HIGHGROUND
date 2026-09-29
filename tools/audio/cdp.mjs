// Minimal headless-Chrome driver for the audio tools: open a URL, evaluate expressions (awaiting promises),
// collect exceptions/console errors. Used by tools/audio-render.mjs.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function openPage(url, { width = 1280, height = 800, gpu = false } = {}) {
  const port = 9500 + Math.floor(Math.random() * 400);
  const args = ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "hgaudio-"))}`,
    `--window-size=${width},${height}`, "--no-first-run", "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--mute-audio"];
  if (gpu) args.push("--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist");
  const proc = spawn(CHROME, [...args, "about:blank"], { stdio: "ignore" });
  let tabs;
  for (let k = 0; k < 60; k++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (tabs.length) break; } catch { } await sleep(200); }
  const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const wait = new Map(); const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); return; }
    if (d.method === "Runtime.exceptionThrown") { const e = d.params.exceptionDetails; errors.push(`EXCEPTION ${e.exception?.description || e.text} @ ${e.url || ""}:${e.lineNumber}`); }
    if (d.method === "Runtime.consoleAPICalled" && (d.params.type === "error" || d.params.type === "warning")) errors.push(`console.${d.params.type} ` + d.params.args.map((a) => a.value ?? a.description).join(" "));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
  await send("Page.navigate", { url });
  const evaluate = async (expr, timeout = 600000) => {
    const r = await Promise.race([send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }), sleep(timeout).then(() => ({ timeout: true }))]);
    if (r.timeout) throw new Error("evaluate timed out: " + expr.slice(0, 80));
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const waitFor = async (expr, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await evaluate(expr, 5000)) return true; } catch { } await sleep(250); } return false; };
  const close = () => { try { ws.close(); } catch { } proc.kill("SIGKILL"); };
  return { evaluate, waitFor, send, errors, close };
}
