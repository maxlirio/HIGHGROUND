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

// resolves once nothing has been loading for `quiet` ms (new requests reset the clock), or after `cap` ms regardless
export function waitForAssets({ quiet = 900, cap = 120000, onProgress = () => {} } = {}) {
  return new Promise((resolve) => {
    const t0 = performance.now(); let idleSince = inflight ? 0 : t0;
    const step = () => {
      const now = performance.now();
      if (inflight > 0) idleSince = 0; else if (!idleSince) idleSince = now;
      onProgress({ inflight, started, finished });
      if ((idleSince && now - idleSince >= quiet) || now - t0 >= cap) return resolve({ inflight, started, finished, ms: Math.round(now - t0) });
      setTimeout(step, 100);
    };
    step();
  });
}
