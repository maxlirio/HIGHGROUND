// Monte-Carlo calibration harness (docs/combat-research.md §17). Runs seeded scenarios in parallel worker
// threads and prints PASS/FAIL for every calibration band.
//   node tools/battle-mc.mjs                 # everything, default seeds
//   node tools/battle-mc.mjs line shock      # only these scenarios
//   node tools/battle-mc.mjs --seeds 200     # seeds per battle scenario
//   node tools/battle-mc.mjs --quick         # fewer seeds (smoke)
//   node tools/battle-mc.mjs --json out.json # also dump raw results
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { writeFileSync } from "node:fs";

if (!isMainThread) {
  const { SCENARIOS } = await import("./scenarios.mjs");
  const EXTRA = await import("./scenarios-extra.mjs").catch(() => ({}));
  const all = { ...SCENARIOS, ...(EXTRA.SCENARIOS || {}) };
  parentPort.on("message", ({ name, seed, arg }) => {
    let r;
    try { r = all[name](seed, arg); } catch (e) { r = { error: String(e.stack || e) }; }
    parentPort.postMessage({ name, seed, r });
  });
} else await main();

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const quick = args.includes("--quick");
  const seeds = +opt("--seeds", quick ? 16 : 64);
  const only = args.filter((a) => !a.startsWith("--") && !/^\d+$/.test(a) && !a.endsWith(".json"));
  const { BANDS, JOBS } = await import("./bands.mjs");
  const jobs = JOBS(seeds, quick).filter((j) => !only.length || only.includes(j.name) || only.includes(j.group));
  const t0 = Date.now();
  const results = await runPool(jobs.flatMap((j) => j.seeds.map((s) => ({ name: j.name, seed: s, arg: j.arg }))));
  const byName = {};
  for (const { name, seed, r } of results) { if (r && typeof r === "object") r.seed = seed; (byName[name] ||= []).push(r); if (r?.error) console.error(name, seed, r.error); }
  console.log(`\nHIGHGROUND combat calibration — ${results.length} runs in ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
  let pass = 0, fail = 0, skip = 0;
  const rows = [];
  for (const b of BANDS) {
    if (only.length && !only.includes(b.scenario) && !only.includes(b.group)) continue;
    const rs = (byName[b.scenario] || []).filter((r) => r && !r.error);
    if (!rs.length) { skip++; continue; }
    const v = b.value(rs);
    if (b.binom) { const n = rs.filter((r) => !r.draw).length, sd = Math.sqrt(0.25 / Math.max(1, n)); b.band = [0.5 - 2 * sd, 0.5 + 2 * sd]; }
    const ok = v !== null && v !== undefined && !Number.isNaN(v) && v >= b.band[0] && v <= b.band[1];
    ok ? pass++ : fail++;
    rows.push({ sec: b.sec, name: b.name, value: v, band: b.band, ok, fmt: b.fmt || "pct", n: rs.length, note: b.note ? b.note(rs) : "" });
  }
  const f = (x, fmt) => x === null || x === undefined || Number.isNaN(x) ? "  n/a" : fmt === "pct" ? (x * 100).toFixed(1) + "%" : fmt === "exp" ? x.toExponential(1) : fmt === "min" ? x.toFixed(0) + " min" : fmt === "s" ? x.toFixed(0) + " s" : x.toFixed(2);
  for (const r of rows) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.sec.padEnd(6)} ${r.name.padEnd(58)} ${f(r.value, r.fmt).padStart(10)}   band [${f(r.band[0], r.fmt)}, ${f(r.band[1], r.fmt)}]  n=${r.n}${r.note ? "  " + r.note : ""}`);
  console.log(`\n${pass} PASS, ${fail} FAIL${skip ? `, ${skip} skipped` : ""}`);
  const jo = opt("--json", null);
  if (jo) writeFileSync(jo, JSON.stringify({ rows, raw: byName }, null, 1));
  process.exitCode = fail ? 1 : 0;
}

function runPool(tasks) {
  const n = Math.min(availableParallelism(), tasks.length || 1, +(process.env.WORKERS || 99));
  return new Promise((resolve) => {
    const out = []; let next = 0, done = 0;
    if (!tasks.length) return resolve(out);
    const ws = [];
    for (let k = 0; k < n; k++) {
      const wk = new Worker(new URL(import.meta.url), { workerData: {} });
      ws.push(wk);
      const feed = () => { if (next < tasks.length) wk.postMessage(tasks[next++]); };
      wk.on("message", (m) => {
        out.push(m); done++;
        if (process.stderr.isTTY) process.stderr.write(`\r${done}/${tasks.length}`);
        if (done === tasks.length) { ws.forEach((x) => x.terminate()); if (process.stderr.isTTY) process.stderr.write("\n"); resolve(out); } else feed();
      });
      wk.on("error", (e) => { out.push({ name: "?", seed: -1, r: { error: String(e) } }); done++; feed(); });
      feed();
    }
  });
}
