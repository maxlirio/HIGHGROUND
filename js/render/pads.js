// BUILDING PADS (the owner: "there needs to be something that prevents buildings AND all units from sinking into the ground"
// — a mining camp on a steep slope stood on stilts downhill while its yard, posts and eave were buried uphill).
// Every building drawn from a model stands on a levelled pad: a terrace cut and filled to one height (the mean of the
// ground under the model and its yard), held on steep ground by a dry-stone revetment — the downhill side built up to the
// pad, the uphill side cut back and walled. Render side only: the sim keeps its heightfield (nothing it decides turns on
// a metre of cut and fill), so the simulation and its saves are untouched.
//   • the pad: a rotated rectangle (the model's own extent + a margin, in the building's frame) at height P;
//   • the ground round it: the natural ground clamped to P ± K·d (d = metres outside the pad), so it meets the pad
//     within a step and is natural beyond — js/render/terrain.js setPads draws it as fine patches cut into the mesh;
//   • groundH (terrain.js) reads the pads too: men in a yard, piles and stacks stand on the pad, not in the old slope;
//   • the revetment: where the ground is more than WALL_MIN above or below the pad just outside it, a wall band
//     WT wide round that edge, its cap over the step (js/render/buildings.js adds it to the building).
// Fields (painted into the ground) and the paddock (fences that follow the ground: draped) have no pad.
import * as THREE from "three";

export const MARGIN = 0.6;        // m of level ground round the model's extent
export const WT = 1.1;            // the revetment's width (its cap covers the step in the ground)
const IN = 0.55;                  // …and how far its inner face stands inside the pad's edge (the ground's ~0.65 m ramp up to the cut lies behind it)
export const WALL_MIN = 0.45;     // m of cut or fill at the edge that wants a wall (a pad with less all round is banked in earth)
const FLAT = 0.3;                 // m of fall across the pad below which none is made (the old placement is fine)
const K_WALL = 6, K_BANK = 1.1;   // how steeply the ground meets the pad: behind a wall (hidden by its cap) / an earth bank

const PADS = new Map();           // building id → pad
const listeners = new Set();
let dirty = false, ver = 0, grid = new Map();
const GC = 32;                    // the lookup grid (m)
const gkey = (i, j) => (i + 50000) * 100000 + (j + 50000);

// who draws pads: the terrain mesh (and the big world's chunks) say which pads they can cut into the ground
const hosts = [];
export function addPadHost(fn) { hosts.push(fn); }
export const padHosted = (p) => hosts.some((h) => h(p));
export const padOf = (id) => PADS.get(id) || null;
export const padList = () => [...PADS.values()];
export const padVer = () => ver;
export function onPads(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function setPad(id, pad) {
  const o = PADS.get(id);
  if (!pad) { if (o) { PADS.delete(id); dirty = true; } return; }
  if (o && o.P === pad.P && o.x === pad.x && o.y === pad.y && o.rot === pad.rot && o.a0 === pad.a0 && o.a1 === pad.a1 && o.b0 === pad.b0 && o.b1 === pad.b1) return;
  PADS.set(id, pad); dirty = true;
}
// tell the terrain (and anyone else) when the set changed — once per buildings sync
export function flushPads() {
  if (!dirty) return false; dirty = false; ver++;
  grid = new Map();
  for (const p of PADS.values()) for (let i = Math.floor(p.box[0] / GC); i <= Math.floor(p.box[2] / GC); i++) for (let j = Math.floor(p.box[1] / GC); j <= Math.floor(p.box[3] / GC); j++) {
    const k = gkey(i, j); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(p);
  }
  const L = padList(); for (const fn of listeners) fn(L);
  return true;
}

// the pad's own shape at (x, y) over natural ground g
export function padApply(p, x, y, g) {
  const dx = x - p.x, dy = y - p.y, a = dx * p.c + dy * p.s, b = -dx * p.s + dy * p.c;
  const ea = Math.max(p.a0 - a, 0, a - p.a1), eb = Math.max(p.b0 - b, 0, b - p.b1);
  if (ea === 0 && eb === 0) return p.P;
  const lim = p.K * Math.hypot(ea, eb);
  return Math.min(p.P + lim, Math.max(p.P - lim, g));
}
// the drawn ground with the pads: g is the natural drawn ground at (x, y)
export function padGround(x, y, g) {
  if (!PADS.size) return g;
  const a = grid.get(gkey(Math.floor(x / GC), Math.floor(y / GC))); if (!a) return g;
  for (const p of a) if (x >= p.box[0] && y >= p.box[1] && x <= p.box[2] && y <= p.box[3]) g = padApply(p, x, y, g);
  return g;
}
// the height a building's model (and what is set by it) stands at: its pad, else the old rule
export const padBase = (b) => { const p = PADS.get(b.id); return p ? p.P - 0.05 : null; };

// A pad for building b whose model spans ext = { x0, x1, z0, z1 } in its own (three.js) frame, over the natural drawn
// ground g(x, y). → null when the ground under it is level enough as it is.
export function makePad(b, ext, g, { earth = false } = {}) { // (earth: banks all round, no stone — a motte's mound)
  const rot = b.rot || 0, c = Math.cos(rot), s = Math.sin(rot);
  // (the model's local x is the sim's a; its local z is −b: three's z is the sim's −y)
  const a0 = ext.x0 - MARGIN, a1 = ext.x1 + MARGIN, b0 = -ext.z1 - MARGIN, b1 = -ext.z0 + MARGIN;
  const at = (a, bb) => [b.x + a * c - bb * s, b.y + a * s + bb * c];
  let sum = 0, n = 0, lo = Infinity, hi = -Infinity;
  const na = Math.max(2, Math.ceil((a1 - a0) / 1.5)), nb = Math.max(2, Math.ceil((b1 - b0) / 1.5));
  for (let i = 0; i <= na; i++) for (let j = 0; j <= nb; j++) {
    const [x, y] = at(a0 + (a1 - a0) * i / na, b0 + (b1 - b0) * j / nb), h = g(x, y);
    sum += h; n++; if (h < lo) lo = h; if (h > hi) hi = h;
  }
  if (hi - lo < FLAT) return null;
  const P = Math.round((sum / n) * 100) / 100;
  const walls = !earth && (hi - P > WALL_MIN || P - lo > WALL_MIN);
  const K = walls ? K_WALL : K_BANK;
  // how far out the ground is reshaped: until a bank at K meets the natural ground (the fall round it bounded by the slope)
  const reach = Math.min(14, (hi - lo) / K + 2.5) + (walls ? WT : 0);
  const pts = [[a0 - reach, b0 - reach], [a1 + reach, b0 - reach], [a1 + reach, b1 + reach], [a0 - reach, b1 + reach]].map(([a, bb]) => at(a, bb));
  const box = [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))];
  return { id: b.id, x: b.x, y: b.y, rot, c, s, a0, a1, b0, b1, P, K, walls, box, relief: +(hi - lo).toFixed(2) };
}

// ---------------------------------------------------------------- the revetment
let wallMat = null;
function wallMaterial() {
  if (wallMat) return wallMat;
  wallMat = new THREE.MeshStandardMaterial({ color: "#8f8574", roughness: 0.95, side: THREE.DoubleSide });
  // (each map is set on the material only once its image has arrived: an unloaded normal map samples black and the
  // stone draws black; till then the wall is the plain stone colour)
  const L = new THREE.TextureLoader(), load = (suf, srgb, key) => L.load(`assets/tex/castle/rubble_${suf}.jpg`, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; wallMat[key] = t; if (key === "map") wallMat.color.set("#c9bfae"); wallMat.needsUpdate = true; });
  load("albedo", true, "map"); load("normal", false, "normalMap"); load("rough", false, "roughnessMap");
  wallMat.normalScale = new THREE.Vector2(1.2, 1.2);
  return wallMat;
}
export const preloadPadWalls = () => { wallMaterial(); }; // (the stone's textures fetched before the first wall is laid)
const TILE = 2.6; // m of rubble walling per texture repeat
// inside pad q's levelled rectangle?
const inPad = (q, x, y) => { const dx = x - q.x, dy = y - q.y, a = dx * q.c + dy * q.s, b = -dx * q.s + dy * q.c; return a > q.a0 && a < q.a1 && b > q.b0 && b < q.b1; };
// The walls round pad p (null if none is wanted): g is the drawn ground with every pad on it (terrain.js groundH), so
// where a neighbour's pad meets this one at its level there is no step to hold; and none is built where it would stand
// on a neighbour's pad (in its yard, under its eaves). One mesh, world coordinates.
export function padWalls(p, g) {
  if (!p.walls) return null;
  const others = padList().filter((q) => q !== p && q.box[0] < p.box[2] && p.box[0] < q.box[2] && q.box[1] < p.box[3] && p.box[1] < q.box[3]);
  const pos = [], uv = [];
  const at = (a, bb) => [p.x + a * p.c - bb * p.s, p.y + a * p.s + bb * p.c];
  // a quad of four [x, h, y, u, v] corners (its own vertices: flat-shaded stone, both sides drawn)
  const quad = (A, B, C, D) => { for (const q of [A, B, C, A, C, D]) { pos.push(q[0], q[1], -q[2]); uv.push(q[3] / TILE, q[4] / TILE); } };
  // four edges: [the run's start, end along the edge (a or b), the fixed coordinate, the outward sign, which axis runs]
  const E = [[p.a0 - WT, p.a1 + WT, p.b0, -1, "a"], [p.a0 - WT, p.a1 + WT, p.b1, 1, "a"], [p.b0, p.b1, p.a0, -1, "b"], [p.b0, p.b1, p.a1, 1, "b"]];
  for (const [t0, t1, f, sg, ax] of E) {
    const L = t1 - t0, n = Math.max(2, Math.ceil(L / 0.9));
    const pt = (t, o) => (ax === "a" ? at(t, f + sg * o) : at(f + sg * o, t)); // (o: metres outward from the edge)
    const st = [];
    for (let k = 0; k <= n; k++) {
      const t = t0 + L * k / n, gin = g(...pt(t, -IN)), gmid = g(...pt(t, WT * 0.5)), gout = g(...pt(t, WT)), gfar = g(...pt(t, WT + 0.6));
      const d = Math.max(Math.abs(gout - p.P), Math.abs(gfar - p.P));
      // (the cap stands just proud of the ground it holds back, out past its outer edge: the patch's ~0.65 m triangles
      // between there and the natural slope never show through it)
      const top = Math.max(p.P + 0.12, Math.max(gin, gmid, gout, g(...pt(t, WT + 0.3))) + 0.12);
      const [mx, my] = pt(t, WT * 0.5);
      st.push({ t, on: d > WALL_MIN && !others.some((q) => inPad(q, mx, my)), top, bin: p.P - 0.3, bout: Math.min(gout, gfar, p.P) - 0.45 });
    }
    // a station is walled if it or both its neighbours want it (no one-step gaps)
    const on = st.map((q, k) => q.on || (!!st[k - 1]?.on && !!st[k + 1]?.on));
    // per station: inner-bottom, inner-top, outer-top, outer-bottom (the outer face battered back 12 % of its height)
    const C = st.map((q) => { const bat = Math.min(0.35, (q.top - q.bout) * 0.12), [xi, yi] = pt(q.t, -IN), [xo, yo] = pt(q.t, WT - bat), [xb, yb] = pt(q.t, WT);
      return [[xi, q.bin, yi, q.t, q.bin], [xi, q.top, yi, q.t, q.top], [xo, q.top, yo, q.t, q.top + WT], [xb, q.bout, yb, q.t, q.top + WT + (q.top - q.bout)]]; });
    for (let k = 0; k < n; k++) {
      if (!on[k] || !on[k + 1]) continue;
      const A = C[k], B = C[k + 1];
      quad(A[0], B[0], B[1], A[1]); quad(A[1], B[1], B[2], A[2]); quad(A[2], B[2], B[3], A[3]); // inner face, cap, outer face
      if (k === 0 || !on[k - 1]) quad(A[0], A[1], A[2], A[3]);                                 // the run's ends
      if (k + 1 === n || !on[k + 2]) quad(B[0], B[1], B[2], B[3]);
    }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals(); geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, wallMaterial()); m.castShadow = m.receiveShadow = true;
  return m;
}
