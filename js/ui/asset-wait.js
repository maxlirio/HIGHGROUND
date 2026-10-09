// Holds the loading screen until the models and textures have really arrived, so the first view is the real one —
// not bare ground that fills in a minute later. Counts everything that goes through three.js's DefaultLoadingManager
// (props, units, terrain textures: every GLTFLoader/TextureLoader made without its own manager) and waits for a quiet
// spell with nothing in flight. Capped, so a slow or broken file can never trap a player on the loading screen.
import * as THREE from "three";

const M = THREE.DefaultLoadingManager;
let inflight = 0, started = 0, finished = 0;
const start0 = M.itemStart, end0 = M.itemEnd, err0 = M.itemError;
M.itemStart = function (url) { inflight++; started++; return start0.call(this, url); };
M.itemEnd = function (url) { inflight = Math.max(0, inflight - 1); finished++; return end0.call(this, url); };
M.itemError = function (url) { return err0.call(this, url); }; // (an error still calls itemEnd)

export const assetCounts = () => ({ inflight, started, finished });

// resolves once nothing has been loading for `quiet` ms AND `frames` rendered frames (new requests reset both), or after
// `cap` ms regardless. The frames are what matters: a model that has just arrived asks for the next ones only when the
// frame loop gets to it, so a quiet spell counts only once the loop has gone round a few times with nothing new asked
// for. (Was: 900 ms of wall clock alone — most of it, on every entry, spent waiting after the last model.)
// frameCount: the page's own count of drawn frames (main.js: rAF, or its timer while the page is hidden) — by default this
// counts requestAnimationFrame, which stops in a hidden page
export function waitForAssets({ quiet = 350, frames = 8, cap = 120000, frameCount = null, onProgress = () => {} } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now(); let idleSince = inflight ? 0 : t0, idleFrames = 0, seen = started, done = false;
    let own = 0, base = 0; const count = frameCount || (() => own);
    if (!frameCount) { const tick = () => { if (done) return; own++; requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
    const step = () => {
      const now = performance.now();
      if (inflight > 0 || started !== seen) { idleSince = 0; base = count(); seen = started; } else if (!idleSince) { idleSince = now; base = count(); }
      idleFrames = count() - base;
      onProgress({ inflight, started, finished });
      if ((idleSince && now - idleSince >= quiet && idleFrames >= frames) || now - t0 >= cap) { done = true; return resolve({ inflight, started, finished, ms: Math.round(now - t0) }); }
      setTimeout(step, 50);
    };
    step();
  });
}
