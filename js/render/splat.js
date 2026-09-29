// Surface splatting: the map's per-cell surface ids pick layers from texture arrays (albedo, normal).
// Boundaries are noise-dithered so fields, woods and marsh edges look organic, and every layer is
// sampled twice at different scales/rotations to kill visible tiling.
import * as THREE from "three";

const LAYER_PX = 512;

async function loadImg(url) {
  return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
}

export async function loadSurfaceArrays(keys, terrainTable, base = "assets/terrain") {
  const n = keys.length, px = LAYER_PX;
  const alb = new Uint8Array(px * px * 4 * n), nrm = new Uint8Array(px * px * 4 * n);
  const tile = new Float32Array(n);
  const cv = document.createElement("canvas"); cv.width = cv.height = px; const g = cv.getContext("2d", { willReadFrequently: true });
  const imgs = await Promise.all(keys.flatMap((k) => [loadImg(`${base}/${k}_albedo.png`), loadImg(`${base}/${k}_normal.png`), fetch(`${base}/${k}.json`).then((r) => r.ok ? r.json() : null).catch(() => null)]));
  let loaded = 0;
  for (let i = 0; i < n; i++) {
    const [a, nm, meta] = imgs.slice(i * 3, i * 3 + 3);
    tile[i] = meta?.tile_m ?? meta?.tileSize ?? meta?.tile_size_m ?? 4;
    if (a) { g.drawImage(a, 0, 0, px, px); alb.set(g.getImageData(0, 0, px, px).data, i * px * px * 4); loaded++; }
    else { // flat fallback from the terrain table colour
      const c = new THREE.Color(terrainTable[keys[i]]?.color || "#6b7040");
      for (let p = 0; p < px * px; p++) alb.set([c.r * 255, c.g * 255, c.b * 255, 255], (i * px * px + p) * 4);
    }
    if (nm) { g.drawImage(nm, 0, 0, px, px); nrm.set(g.getImageData(0, 0, px, px).data, i * px * px * 4); }
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
