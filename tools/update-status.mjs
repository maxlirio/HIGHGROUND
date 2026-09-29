// Rebuilds status/status.json from the repo (git log, renders, map images) + status/notes.json
// (hand-written by the orchestrator: phase, agents, log). Run in a loop: node tools/update-status.mjs --loop
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const rel = (p) => p.replace(ROOT, "");

function images(dir, filter = () => true) {
  const d = join(ROOT, dir); if (!existsSync(d)) return [];
  return readdirSync(d).filter((f) => /\.(png|jpg)$/i.test(f) && filter(f))
    .map((f) => ({ path: `${dir}/${f}`, name: f.replace(/\.(png|jpg)$/i, ""), mtime: statSync(join(d, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

function build() {
  let notes = {};
  try { notes = JSON.parse(readFileSync(join(ROOT, "status/notes.json"), "utf8")); } catch { /* none yet */ }
  let commits = [];
  try {
    commits = execSync("git log -25 --pretty=format:%h%x09%cr%x09%s", { cwd: ROOT }).toString().split("\n").filter(Boolean)
      .map((l) => { const [h, when, msg] = l.split("\t"); return { h, when, msg }; });
  } catch { /* no git yet */ }
  const count = (dir, re) => { const d = join(ROOT, dir); return existsSync(d) ? readdirSync(d).filter((f) => re.test(f)).length : 0; };
  const status = {
    updated: Date.now(),
    ...notes,
    stats: {
      glbAssets: count("assets/glb", /\.glb$/), terrainSurfaces: count("assets/terrain", /\.json$/),
      simModules: count("js/sim", /\.js$/), commits: +execSync("git rev-list --count HEAD", { cwd: ROOT }).toString().trim(),
    },
    commits,
    renders: images("assets/booth").slice(0, 80),
    maps: images("maps/vale", (f) => /overview|hillshade|surface|forest|settle/.test(f)),
    shots: images("status/shots"),
  };
  writeFileSync(join(ROOT, "status/status.json"), JSON.stringify(status));
}

build();
if (process.argv.includes("--loop")) setInterval(build, 15000);
