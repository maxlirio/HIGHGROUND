// Surface splatting: the map's per-cell surface ids pick layers from texture arrays (albedo, normal).
// Boundaries are noise-dithered so fields, woods and marsh edges look organic, and every layer is
// sampled twice at different scales/rotations to kill visible tiling.
import * as THREE from "three";
import { BUILD } from "../build.js";

const LAYER_PX = 512;

// The layers' pixels are fetched, decoded and read out in a worker (OffscreenCanvas), off the main thread — which is
// setting up the world meanwhile. (Was: ~70 images decoded and read back one after another on the main thread, ~0.5 s
// of every loading screen.) Without workers or OffscreenCanvas: the same on the main thread, below.
const WORKER = `onmessage = async (e) => {
  const { sets, px } = e.data, cv = new OffscreenCanvas(px, px), g = cv.getContext("2d", { willReadFrequently: true }), res = [];
  for (const urls of sets) {
    const out = new Uint8Array(px * px * 4 * urls.length), ok = new Uint8Array(urls.length);
    const bmps = await Promise.all(urls.map((u) => fetch(u).then((r) => r.ok ? r.blob() : null).then((b) => b && createImageBitmap(b)).catch(() => null)));
    bmps.forEach((b, i) => { if (!b) return; g.drawImage(b, 0, 0, px, px); out.set(g.getImageData(0, 0, px, px).data, i * px * px * 4); ok[i] = 1; b.close(); });
    res.push({ out, ok });
  }
  postMessage(res, res.map((r) => r.out.buffer));
};`;
function inWorker(sets, px) {
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") return Promise.resolve(null);
  return new Promise((res) => {
    let w; try { w = new Worker(URL.createObjectURL(new Blob([WORKER], { type: "text/javascript" }))); } catch { res(null); return; }
    w.onmessage = (e) => { res(e.data); w.terminate(); }; w.onerror = () => { res(null); w.terminate(); };
    w.postMessage({ sets: sets.map((urls) => urls.map((u) => new URL(u, document.baseURI).href)), px }); // (absolute: a worker resolves against its own URL)
  });
}
async function loadImg(url) {
  const i = new Image(); i.src = url;
  try { await i.decode(); return i; } catch { return null; }
}

export async function loadSurfaceArrays(keys, terrainTable, base = "assets/terrain") {
  const n = keys.length, px = LAYER_PX, ext = BUILD.packed ? "jpg" : "png"; // (a shipped build: JPEG — js/build.js)
  const tile = new Float32Array(n);
  const metas = Promise.all(keys.map((k) => fetch(`${base}/${k}.json`).then((r) => r.ok ? r.json() : null).catch(() => null)));
  const W = await inWorker([keys.map((k) => `${base}/${k}_albedo.${ext}`), keys.map((k) => `${base}/${k}_normal.${ext}`)], px);
  let imgs = null, g = null;
  const alb = W ? W[0].out : new Uint8Array(px * px * 4 * n), nrm = W ? W[1].out : new Uint8Array(px * px * 4 * n);
  if (!W) { // (no worker: on the main thread)
    const cv = document.createElement("canvas"); cv.width = cv.height = px; g = cv.getContext("2d", { willReadFrequently: true });
    imgs = await Promise.all(keys.flatMap((k) => [loadImg(`${base}/${k}_albedo.${ext}`), loadImg(`${base}/${k}_normal.${ext}`)]));
  }
  const meta = await metas;
  let loaded = 0;
  for (let i = 0; i < n; i++) {
    const a = W ? W[0].ok[i] : imgs[i * 2], nm = W ? W[1].ok[i] : imgs[i * 2 + 1];
    tile[i] = meta[i]?.tile_m ?? meta[i]?.tileSize ?? meta[i]?.tile_size_m ?? 4;
    if (a) { if (!W) { g.drawImage(a, 0, 0, px, px); alb.set(g.getImageData(0, 0, px, px).data, i * px * px * 4); } loaded++; }
    else { // flat fallback from the terrain table colour
      const c = new THREE.Color(terrainTable[keys[i]]?.color || "#6b7040");
      for (let p = 0; p < px * px; p++) alb.set([c.r * 255, c.g * 255, c.b * 255, 255], (i * px * px + p) * 4);
    }
    if (nm) { if (!W) { g.drawImage(nm, 0, 0, px, px); nrm.set(g.getImageData(0, 0, px, px).data, i * px * px * 4); } }
    else for (let p = 0; p < px * px; p++) nrm.set([128, 128, 255, 255], (i * px * px + p) * 4);
  }
  const mk = (data, srgb) => {
    const t = new THREE.DataArrayTexture(data, px, px, n);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true; return t;
  };
  return { albedo: mk(alb, true), normal: mk(nrm, false), tile, count: n, loaded };
}

// surface id grid → texture (R8, nearest) so the shader can find the 4 surrounding cells
export function surfaceIdTexture(map) {
  const t = new THREE.DataTexture(map.surface, map.res, map.res, THREE.RedIntegerFormat, THREE.UnsignedByteType);
  t.internalFormat = "R8UI"; t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
}
