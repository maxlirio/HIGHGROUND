// Render quality presets (View panel: Low / Medium / High). The game must run on an ordinary laptop,
// so Medium is the default and is tuned for an M1/M2 MacBook Air at ~30 fps in the low views.
//   dpr      cap on devicePixelRatio (hi-dpi screens render at most this many pixels per CSS pixel)
//   lod0     metres: full-detail trees inside this
//   lod1     metres: sparse-card trees inside this; beyond, one baked impostor quad per tree
//   cap0/1   hard per-frame caps on full / sparse tree instances (the nearest win)
//   terrFar  metres: beyond this the terrain shader drops normal maps and the broad-blend samples
//   aa       MSAA (read at start-up only)
export const PRESETS = {
  low:    { dpr: 1,   lod0: 70,  lod1: 170, cap0: 160, cap1: 1200, terrFar: 350,  aa: false },
  medium: { dpr: 1.5, lod0: 120, lod1: 280, cap0: 320, cap1: 2600, terrFar: 700,  aa: true },
  high:   { dpr: 2,   lod0: 180, lod1: 450, cap0: 700, cap1: 7000, terrFar: 1500, aa: true },
};
const KEY = "hg.quality";
function initial() {
  const u = new URLSearchParams(location.search).get("quality");
  if (u && PRESETS[u]) return u;
  try { const s = localStorage.getItem(KEY); if (s && PRESETS[s]) return s; } catch { /* storage blocked */ }
  return "medium";
}
export const Q = { name: initial(), ...PRESETS[initial()], version: 0 };
{ // debug/benchmark overrides: ?qset=lod0:3000,cap0:1e6
  const o = new URLSearchParams(location.search).get("qset");
  if (o) for (const kv of o.split(",")) { const [k, v] = kv.split(":"); if (k in Q) Q[k] = +v; }
}
const subs = new Set();
export function setQuality(name) {
  if (!PRESETS[name]) return;
  Object.assign(Q, PRESETS[name], { name }); Q.version++;
  try { localStorage.setItem(KEY, name); } catch { /* storage blocked */ }
  for (const f of subs) f(Q);
}
export const onQuality = (f) => { subs.add(f); return () => subs.delete(f); };
