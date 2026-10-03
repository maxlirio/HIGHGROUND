// Gathering lane E — stone, ore & town life: the render side (docs/gathering-plan.md; the sim is js/sim/jobs/quarry.js).
// Pure render; everything is read from w.labor (works / well items, men's loads) and w.buildings, so it draws the same
// on a realm client.
//   • THE QUARRY: a rock mass of rough blocks in strata with turf on top, its face worked back in benches as the cut
//     grows (the sim's faceOff), fresh-cut faces pale, a trodden dusty floor in front, a spoil heap of chips, shear-legs
//     at the face and the cut blocks waiting at its foot (works.n) for the sledge; sledges dragged on a rope
//   • THE MINE: a hillock with a timbered adit (the men go in and vanish), rails out to the ore heap, a spoil heap that
//     grows; ore tubs pushed out. ORE AND CLAY PITS: dug hollows (water in the bog), rims of dug earth, a roasting hearth
//   • CHARCOAL AND IRON: the collier's clamp (a smoking turf mound, the billet stack, the collier's hut) and the bloomery
//     (a clay shaft furnace glowing at its foot, bellows under a lean-to, slag), sparks and smoke at the smithy
//   • TOWN LIFE (render only, near the camera): chimney smoke, the well (its bucket wound up when someone draws), hens
//     scratching in the yards, dogs trotting about, children playing by the well
// Smoke, sparks and glows are GPU particles (their motion is computed in the shader from time: no per-frame CPU work);
// the animals are a few small instanced meshes updated only near the camera.
import * as THREE from "three";
import { PIECE, MARK, COL, tint, merge, logGeo, pyramid, towFrom } from "../labor.js";
import { HOLD_CLIPS, CARRY_PART, POSE_KIT, FIG_NEAR } from "../figures.js";
import { Q, ADIT, PIT, worksInfo, frame, faceOff, depthOf, pitSpots, pitsOpen, hsh } from "../../sim/jobs/quarry.js";
import { BUILDINGS } from "../../sim/econ-data.js";
import { hMirror } from "../terrain.js";

// ---------------------------------------------------------------- the labour-item tables
const nothing = () => { const g = new THREE.BufferGeometry(); for (const a of ["position", "normal", "color"]) g.setAttribute(a, new THREE.BufferAttribute(new Float32Array(9), 3)); return g; };
HOLD_CLIPS.sledge = ["walk_drag", "idle_hand"];      // a sledge of blocks hauled on a rope
HOLD_CLIPS.tub = ["walk_front", "idle_front"];       // an ore tub pushed ahead
HOLD_CLIPS.pail = ["walk_pail", "idle_pail"];        // home from the well
CARRY_PART.oreheap = "basket"; CARRY_PART.clayheap = "basket"; CARRY_PART.pail = "pail";
POSE_KIT.idle_talk = POSE_KIT.idle_talk || [];
const lump = (c, seed) => { const g = new THREE.IcosahedronGeometry(0.5, 0); const P = g.attributes.position; for (let k = 0; k < P.count; k++) { const s = 0.75 + 0.5 * hsh(Math.round(P.getX(k) * 97 + P.getY(k) * 31 + P.getZ(k) * 13) & 0xffff, seed); P.setXYZ(k, P.getX(k) * s * 1.2, P.getY(k) * s * 0.7, P.getZ(k) * s); } g.computeVertexNormals(); return tint(g, c, 0.3, seed).translate(0, 0.2, 0); };
const heapAt = (k) => { const a = k * 2.399, r = 0.36 * Math.sqrt(k); return [Math.cos(a) * r, Math.max(0, (1.3 - r) * 0.5), Math.sin(a) * r, a]; };
PIECE.works = { geo: nothing, at: () => [0, -50, 0, 0] }; PIECE.well = PIECE.works;
PIECE.oreheap = { geo: () => lump("#6f5646", 3), at: heapAt };
PIECE.clayheap = { geo: () => lump("#a8744c", 5), at: heapAt };
PIECE.sledge = { geo: () => sledgeGeo(), at: (k) => [0, 0, (k - 0.5) * 1.4, 0] };
PIECE.tub = { geo: () => tubGeo(), at: (k) => [(k % 3) * 1.1, 0, Math.floor(k / 3) * 0.9, 0] };
PIECE.pail = { geo: () => tint(new THREE.CylinderGeometry(0.15, 0.12, 0.26, 8), "#7a6a4a").translate(0, 0.13, 0), at: () => [0, 0, 0, 0] };
Object.assign(COL, { works: "#a7a296", sledge: "#a7a296", tub: "#5a4a3c", oreheap: "#7b5a45", clayheap: "#b07a52", pail: "#8a7a5a", well: "#8f8a80" });
Object.assign(MARK, { works: 1, sledge: 1, tub: 1, oreheap: 2, clayheap: 2, pail: 2, well: 2 });

// ---------------------------------------------------------------- palette
const STONE = new THREE.Color("#b9b1a0"), TURF = "#5d6b35", EARTH = "#5e4a36", TIMBER = "#6b5138", DARK = "#16120f";
// deterministic 0..1 noise for geometry jitter
const jit = (x, y, z, s = 1) => hsh((Math.round(x * 53) * 73856093) ^ (Math.round(y * 53) * 19349663) ^ (Math.round(z * 53) * 83492791), s);

// ---------------------------------------------------------------- geometry
function roughBlock() {   // a unit block (1 × 1 × 1, base at 0), faces subdivided and jittered consistently at shared corners
  const g = new THREE.BoxGeometry(1, 1, 1, 2, 2, 2).translate(0, 0.5, 0), P = g.attributes.position;
  for (let k = 0; k < P.count; k++) {
    const x = P.getX(k), y = P.getY(k), z = P.getZ(k), e = 0.07;
    P.setXYZ(k, x + (jit(x, y, z, 1) - 0.5) * e * 2, y + (jit(x, y, z, 2) - 0.5) * e * (y > 0.99 ? 1.2 : 0.6), z + (jit(x, y, z, 3) - 0.5) * e * 2);
  }
  return g.toNonIndexed();
}
const BLOCK = roughBlock();
function sledgeGeo() {    // runners, slats, two squared blocks lashed on (along +X, 2.2 m)
  const g = [];
  for (const z of [-0.42, 0.42]) { g.push(tint(new THREE.BoxGeometry(2.2, 0.12, 0.1), TIMBER, 0.2).translate(0, 0.08, z)); g.push(tint(new THREE.BoxGeometry(0.4, 0.1, 0.1), TIMBER, 0.2).rotateZ(0.6).translate(1.2, 0.2, z)); }
  for (let j = 0; j < 5; j++) g.push(tint(new THREE.BoxGeometry(0.12, 0.05, 1.0), "#7a5e40", 0.2, j).translate(-0.9 + j * 0.45, 0.17, 0));
  g.push(tint(new THREE.BoxGeometry(0.85, 0.5, 0.62), "#c2baa8", 0.12, 3).translate(-0.45, 0.45, 0));
  g.push(tint(new THREE.BoxGeometry(0.75, 0.42, 0.58), "#b3ab98", 0.12, 4).translate(0.45, 0.41, 0.02));
  return merge(g);
}
function tubGeo() {       // a small four-wheeled ore tub heaped with ore (along +X, 1 m)
  const g = [tint(new THREE.BoxGeometry(1.0, 0.5, 0.66), "#5a4a3c", 0.25).translate(0, 0.52, 0)];
  for (const x of [-0.32, 0.32]) for (const z of [-0.36, 0.36]) g.push(tint(new THREE.CylinderGeometry(0.15, 0.15, 0.07, 8), "#2e2a26").rotateX(Math.PI / 2).translate(x, 0.15, z));
  for (const z of [-0.36, 0.36]) g.push(tint(new THREE.BoxGeometry(1.0, 0.06, 0.05), "#3a3530").translate(0, 0.32, z));
  g.push(tint(new THREE.SphereGeometry(0.4, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), "#6e5644", 0.35).scale(1.15, 0.5, 0.75).translate(0, 0.76, 0));
  g.push(tint(new THREE.BoxGeometry(0.06, 0.06, 0.6), TIMBER).translate(-0.62, 0.85, 0));   // the handle he pushes by
  return merge(g);
}
function ashlar() { return tint(new THREE.BoxGeometry(0.95, 0.55, 0.62, 1, 1, 1), "#c9c1ae", 0.1).translate(0, 0.275, 0); }
// a small tileable grey detail map (grain, bedding streaks, specks) the quarry face wears over its vertex colours at
// world scale — up close the rock keeps real texture instead of smearing into soft vertex-colour gradients
function rockDetailTex() {
  const N = 128, PD = 8, lat = []; for (let j = 0; j < PD * PD; j++) lat.push(hsh(j, 201));
  const L = (i, j) => lat[(i % PD) * PD + (j % PD)];
  const samp = (x, y) => { const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    return (L(i, j) * (1 - su) + L(i + 1, j) * su) * (1 - sv) + (L(i, j + 1) * (1 - su) + L(i + 1, j + 1) * su) * sv; };
  const d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const fx = x / N * PD, fy = y / N * PD;
    const grain = 0.6 * samp(fx, fy) + 0.25 * samp(fx * 2, fy * 2) + 0.15 * samp(fx * 4, fy * 4);
    const bed = samp(fx, fy * 5);   // (v is height on the face: fast in v = horizontal bedding streaks)
    let v = 0.8 + 0.5 * (grain - 0.5) + 0.26 * (bed - 0.5);
    if (hsh(y * N + x, 7) < 0.035) v -= 0.16;   // pits and specks
    const B = Math.max(70, Math.min(255, Math.round(v * 255))), k = (y * N + x) * 4;
    d[k] = B; d[k + 1] = B; d[k + 2] = Math.max(60, B - 6); d[k + 3] = 255;
  }
  const tex = new THREE.DataTexture(d, N, N); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.anisotropy = 4; tex.needsUpdate = true;
  return tex;
}
function coneHeap(r, h, c, n, seed) {   // a heap of lumps: spoil, slag, chips
  const g = [];
  // (lumps of a size that does not grow with the heap: a bigger heap is more of them, piled higher)
  const N = Math.min(220, Math.round(n * Math.max(1, r * r / 4)));
  for (let k = 0; k < N; k++) { const a = k * 2.399 + seed, rr = r * Math.sqrt((k + 0.5) / N), y = h * (1 - (rr / r) ** 1.3) * (0.75 + 0.25 * hsh(k, seed)); const s = 0.45 + 0.6 * hsh(k, seed + 7);
    g.push(lump(c, seed + k).scale(s * 1.1, s * 0.8, s).translate(Math.cos(a) * rr, Math.max(0, y - 0.25), Math.sin(a) * rr)); }
  return merge(g);
}

// Merge geometries placed in the works frame (local X = b outward, local Z = −a) onto the terrain: each piece is lifted
// to the ground height at its own origin, then the whole is turned to the works' facing and set at the node.
function placeAll(map, it, pieces) {   // pieces: [geo, a, b, lift?, yaw?]
  const P = frame(it), out = [], c = Math.cos(it.rot), s = Math.sin(it.rot);
  for (const [g0, a, b, lift = 0, yaw = 0] of pieces) {
    const [x, y] = P(a, b), h = map.h(x, y) + lift, g = g0.clone();
    g.rotateY(it.rot + yaw).translate(x - it.x, h, -(y - it.y));   // (local X = b outward, local Z = −a)
    out.push(g);
  }
  const m = merge(out); return m;
}

// ---------------------------------------------------------------- the quarry
// the hill the quarry is cut into: height above the ground at (a, b) in the works frame (before the cut)
const QW = () => Q.NC * Q.BS / 2, QTOP = () => Q.NL * Q.LH, QBACK = () => Q.F0 - Q.NR * Q.BS - 7;
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
function hillH(a, b) {
  const W = QW(), side = smooth(W + 12, W - 1, Math.abs(a)), back = smooth(QBACK(), Q.F0 - 12, b), front = Math.abs(a) > W - 0.2 ? smooth(Q.F0 + 6, Q.F0 - 4, b) * (0.75 + 0.25 * smooth(W + 10, W, Math.abs(a))) : 1;
  const n = (fbm(a * 0.45, b * 0.45, 17) - 0.5) * 1.5 + (fbm(a * 1.3, b * 1.3, 23) - 0.5) * 0.5;   // smooth irregularity, no lattice steps
  return Math.max(0, QTOP() * side * back * front + n * side * back);
}
// value noise in 2D (deterministic), fractal: the rock's own irregularity
function vnoise(x, y, s) { const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const h = (p, q) => hsh((p * 73856093) ^ (q * 19349663), s);
  return (h(i, j) * (1 - su) + h(i + 1, j) * su) * (1 - sv) + (h(i, j + 1) * (1 - su) + h(i + 1, j + 1) * su) * sv; }
const fbm = (x, y, s) => vnoise(x, y, s) * 0.55 + vnoise(x * 2.1, y * 2.1, s + 1) * 0.3 + vnoise(x * 4.3, y * 4.3, s + 2) * 0.15;
// Natural stratified rock: the face is one displaced sheet (a along the face, z up). Each bed (layer) stands at its own
// depth — the sim's faceOff for that column and bed, interpolated along the face and broken by noise — so the beds make
// irregular ledges and benches; the beds' thicknesses vary, the rock bulges and is broken back at the edges, fresh-cut
// stone is pale, weathered stone grey-brown with ochre bands, and wedge marks score the freshly worked parts.
function quarryGeo(map, it, cut) {
  const P = frame(it), { NC, NL, BS, LH, F0 } = Q, ci = (NC - 1) / 2, W = QW(), sd = it.node || 1, WRAP = 9, SH = 2.3, NS = 5;
  const lz = [0]; for (let l = 0; l < NL; l++) lz.push(lz[l] + LH * (0.6 + 0.8 * hsh(sd, l + 40)));
  const zs = LH * NL / lz[NL]; for (let l = 0; l <= NL; l++) lz[l] *= zs;
  const offAt = (a, l) => { const x = a / BS + ci, i0 = Math.max(0, Math.min(NC - 1, Math.floor(x))), i1 = Math.min(NC - 1, i0 + 1), f = Math.max(0, Math.min(1, x - i0));
    const o0 = faceOff(cut, i0, l), o1 = faceOff(cut, i1, l); return o0 + (o1 - o0) * smooth(0.3, 0.7, f); };
  // beyond ±W the sheet wraps round: the cut's own rock side walls sweep out to the hill front at the mouth,
  // so the turf skin never has to drape the cliff at the quarry's sides (that drape was a smeared curtain up close)
  const sideT = (a) => smooth(W, W + WRAP, Math.abs(a));
  const topZ = (a) => Math.max(1.0, hillH(a, F0 - (offAt(a, NL - 1) + 0.6) * (1 - sideT(a)) ** 1.5 - 0.4) - 0.2);
  // depth (metres behind the original face line) at (a, z): the bed's own bench, a soft step between beds, rock noise
  const bedOf = (z) => { let l = 0; while (l < NL - 1 && z > lz[l + 1]) l++; return l; };
  const depth = (a, z) => {
    const l = bedOf(z), t = (z - lz[l]) / (lz[l + 1] - lz[l]), side = sideT(a);
    let d = offAt(a, l);
    const bulge = (fbm(a * 0.45, z * 0.6, sd * 7 + l) - 0.5) * 0.7 + (fbm(a * 1.6, z * 1.9, sd * 3) - 0.5) * 0.28;
    // the bed is broken by vertical joints into blocks of its own lengths, each standing at its own depth: ledges and nooks
    const segL = 1.6 + 2.6 * hsh(sd, l + 60), u = (a + 13.7 * hsh(sd, l + 61)) / segL, seg = Math.floor(u), fu = u - seg;
    const sdep = (k) => (hsh(seg + k, sd * 31 + l) - 0.5) * 1.1 + (l % 2 ? 0.35 : -0.1);
    const jointD = sdep(0) + (sdep(1) - sdep(0)) * smooth(0.9, 1, fu);
    const bedD = (hsh(sd, l + 70) - 0.5) * 0.8;   // (a whole bed standing proud or recessed)
    const lip = -0.18 * smooth(0.75, 1, t);   // (each bed's top edge broken back a little: the joint)
    const dIn = d + bulge + lip + jointD + bedD + 0.6;
    return dIn * (1 - side) ** 1.5 - 0.7 * side + (bulge + jointD * 0.4) * side;   // sweeps out to the mouth, still broken rock
  };
  const na = 150, nz = 60, pos = [], col = [], uvs = [];
  const FRESH = new THREE.Color("#d5cab0"), WEATHER = new THREE.Color("#968f7c"), OCHRE = new THREE.Color("#ad9670"), DARKR = new THREE.Color("#6f6a5e"), BROW = new THREE.Color("#6d5d44");
  const grid = [];
  for (let jz = 0; jz <= nz; jz++) { const row = []; for (let ja = 0; ja <= na; ja++) {
    const a = -W - WRAP - 0.5 + (2 * (W + WRAP) + 1) * ja / na, zt = topZ(a), z = zt * jz / nz, d = depth(a, z), b = F0 - d;
    const [x, y] = P(a, b), g = map.h(x, y) - 0.45;
    row.push([x - it.x, g + z, -(y - it.y), a, z, d, 0]); } grid.push(row); }
  // the brow: the sheet carries on over the lip, rising to the turf line with a slight rock crest, then diving under
  // the hill — the skin's edge tucks just beneath the crest, so the junction is FLAT: no turf visor over the face,
  // no see-through slot, and no steep chamfer for the terrain splat to smear on
  const browProf = (f, gy, surf, a) => { const s1 = smooth(0, 0.55, f);
    return gy * (1 - s1) + surf * s1 + 0.05 * smooth(0.35, 0.6, f) - 0.35 * smooth(0.8, 1, f) + (fbm(a * 1.3, f * 2.7, sd + 14) - 0.5) * 0.22 * (1 - f); };
  for (let js = 1; js <= NS; js++) { const f = js / NS, row = []; for (let ja = 0; ja <= na; ja++) {
    const T = grid[nz][ja], a = T[3], d = T[5] + SH * f, b = F0 - d, [x, y] = P(a, b);
    const surf = hMirror(map, x, y) + hillH(a, b);
    row.push([x - it.x, browProf(f, T[1], surf, a), -(y - it.y), a, T[4] + SH * f * 0.4, d, f]); } grid.push(row); }
  const colour = (a, z, d, ny, sh) => {
    const l = bedOf(z), worked = offAt(a, l) > 0.05 && sideT(a) < 0.35;
    const fresh = worked && sh < 0.01 && (z < 3.2 || (ny > 0.55 && z < topZ(a) - 0.9));   // (bench tops pale, never the brow)
    const band = fbm(z * 1.4 + l * 3, a * 0.05, sd + 11), c = new THREE.Color();
    c.copy(fresh ? FRESH : l % 3 === 1 ? OCHRE : WEATHER);
    if (!fresh) c.lerp(DARKR, Math.max(0, (fbm(a * 0.8, z * 0.8, sd + 5) - 0.55)) * 1.4);
    if (sh > 0) c.lerp(BROW, sh * 0.8);   // the brow weathers toward the soil the turf sits on
    let v = (0.86 + 0.26 * band) * 1.12;   // (brightened: the detail map's mid-grey takes it back down)
    if (ny > 0.5) v *= 1.08;                                          // the shelves catch the light
    if (fresh && Math.abs(((a * 2.7 + l * 0.37) % 1 + 1) % 1 - 0.5) < 0.05 && ny < 0.3) v *= 0.8;   // wedge marks
    return [c.r * v, c.g * v, c.b * v];
  };
  const tri = (A, B, C) => {
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz2 = ux * vy - uy * vx; const L = Math.hypot(nx, ny, nz2) || 1; ny /= L;
    for (const V of [A, B, C]) { pos.push(V[0], V[1], V[2]); col.push(...colour(V[3], V[4], V[5], ny, V[6])); uvs.push(V[3] / 3.2, V[4] / 3.2); }
  };
  for (let jz = 0; jz < nz + NS; jz++) for (let ja = 0; ja < na; ja++) {
    const A = grid[jz][ja], B = grid[jz][ja + 1], C = grid[jz + 1][ja], D = grid[jz + 1][ja + 1];
    tri(A, C, B); tri(B, C, D);
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));   // world-scale UVs: the detail map never smears
  // winding: the face looks out along +b; flip if the sheet came out facing into the hill
  g.computeVertexNormals();
  { const n = g.attributes.normal, c = Math.cos(it.rot), s2 = Math.sin(it.rot); let dot = 0; for (let k = 0; k < n.count; k += 3) dot += n.getX(k) * c - n.getZ(k) * s2;
    if (dot < 0) { const p = g.attributes.position.array, q = g.attributes.color.array, u2 = g.attributes.uv.array; for (let k = 0; k < p.length; k += 9) for (let e = 0; e < 3; e++) { const t1 = p[k + 3 + e]; p[k + 3 + e] = p[k + 6 + e]; p[k + 6 + e] = t1; const t2 = q[k + 3 + e]; q[k + 3 + e] = q[k + 6 + e]; q[k + 6 + e] = t2; }
      for (let k = 0; k < u2.length; k += 6) for (let e = 0; e < 2; e++) { const t3 = u2[k + 2 + e]; u2[k + 2 + e] = u2[k + 4 + e]; u2[k + 4 + e] = t3; } g.computeVertexNormals(); } }
  // smooth the normals a little (shared positions averaged) so the rock is not all hard facets
  g = smoothNormals(g, 0.6);
  // the hill's skin: turf over the top and down the sides, stopping on the face's brow. Its edge height is computed
  // from the BROW's own formula (not the hill's), so it lands on the rock everywhere: no slot and no hanging band.
  const browAt = (a) => {
    const zt = topZ(a) * 0.999, dT = depth(a, zt), d2 = dT + SH * 0.8, b2 = F0 - d2;
    const [x0, y0] = P(a, F0 - dT), gy = map.h(x0, y0) - 0.45 + zt;   // the face sheet's top edge
    const [x2, y2] = P(a, b2), surf = hMirror(map, x2, y2) + hillH(a, b2);
    return [d2, browProf(0.8, gy, surf, a) - 0.17];   // how far back the skin reaches, and its height there (under the crest)
  };
  const skin = hillSkin(map, it, browAt);
  // rubble at the foot of the face: chips and broken stone, more where it has been worked hardest
  const deep = Math.max(...Array.from({ length: NC }, (_, i) => faceOff(cut, i))), dA = depthOf("quarry", cut);
  const bits = [];
  for (let k = 0; k < 70; k++) { const a = (hsh(k, 71) - 0.5) * 2 * (W - 0.3), b = F0 - offAt(a, 0) + 0.2 + hsh(k, 72) ** 2 * 3.2, s3 = 0.25 + 0.55 * hsh(k, 73) ** 2;
    bits.push([lump(k % 4 ? "#c6bda8" : "#9b937f", k + 60).scale(s3 * 1.3, s3 * 0.8, s3), a, b, -0.08, hsh(k, 75) * 6]); }
  for (let k = 0; k < 7; k++) { const a = (hsh(k, 81) - 0.5) * 2 * (W - 2), b = F0 - offAt(a, 0) + 0.9 + hsh(k, 82) * 1.5;   // a few broken slabs, fallen and tilted
    bits.push([lump("#b8b09c", k + 90).scale(1.8, 0.9, 1.4), a, b, -0.15, hsh(k, 83) * 6]); }
  const legs = [];
  for (const z of [-1.3, 1.3]) legs.push(tint(new THREE.CylinderGeometry(0.1, 0.13, 8.6, 6), TIMBER, 0.2).translate(0, 4.3, 0).rotateZ(0.3).rotateX(z > 0 ? 0.16 : -0.16).translate(0, 0, z));
  legs.push(tint(new THREE.CylinderGeometry(0.1, 0.1, 2.9, 6), TIMBER).rotateX(Math.PI / 2).translate(1.5, 0.9, 0));   // windlass
  legs.push(tint(new THREE.CylinderGeometry(0.02, 0.02, 5.4, 4), "#cbb994").translate(-1.25, 5.4, 0));                // rope
  legs.push(tint(new THREE.BoxGeometry(0.75, 0.5, 0.55), "#cfc7b3", 0.1).translate(-1.25, 2.4, 0));                    // a block on the hook
  const rest = placeAll(map, it, [
    [merge(legs), 3.2 - W * 0.45, F0 - offAt(3.2 - W * 0.45, 0) + 2.2],
    [coneHeap(2.4 + 3 * dA, 1.1 + 1.6 * dA, "#b9b19c", 44, 3), -(W - 1), F0 + 6.5],
    ...bits,
  ]);
  return { face: g, rock: rest, ground: skin };   // (the face keeps its UVs: it wears the rock detail map)
}
// average the normals of coincident vertices (k: how much of the average to take; 1 = fully smooth)
function smoothNormals(g, k) {
  const p = g.attributes.position.array, n = g.attributes.normal.array, acc = new Map();
  const key = (i) => `${Math.round(p[i] * 50)},${Math.round(p[i + 1] * 50)},${Math.round(p[i + 2] * 50)}`;
  for (let i = 0; i < p.length; i += 3) { const K = key(i); let A = acc.get(K); if (!A) acc.set(K, (A = [0, 0, 0])); A[0] += n[i]; A[1] += n[i + 1]; A[2] += n[i + 2]; }
  for (let i = 0; i < p.length; i += 3) { const A = acc.get(key(i)), L = Math.hypot(A[0], A[1], A[2]) || 1; for (let e = 0; e < 3; e++) n[i + e] = n[i + e] * (1 - k) + A[e] / L * k; const M = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; for (let e = 0; e < 3; e++) n[i + e] /= M; }
  g.attributes.normal.needsUpdate = true; return g;
}
// the hill behind the face: turf and earth, rock where it is steep; lipOff(a) → [how far back the face's brow reaches,
// the height the skin's edge must take there]. The edge is clamped onto the brow — never a visor hanging over the
// face — and the clamp fades out smoothly past the rock's side wrap, so no quad ever stretches hilltop-to-ground.
function hillSkin(map, it, lipOff) {
  const P = frame(it), W = QW(), F0 = Q.F0, WRAP = 9;
  const na = 84, nb = 40, sp = [], sc = [], si = [], a0 = -(W + 14), a1 = W + 14, b0 = QBACK(), b1 = F0 + 6;
  const cT = new THREE.Color(TURF), cE = new THREE.Color("#6d5d44"), cR = new THREE.Color("#8d8878");
  for (let jb = 0; jb <= nb; jb++) for (let ja = 0; ja <= na; ja++) {
    const a = a0 + (a1 - a0) * ja / na; let b = b0 + (b1 - b0) * jb / nb;
    const fade = smooth(W + WRAP - 1.5, W + WRAP + 3, Math.abs(a));
    const [lo, loY] = lipOff(a);
    const bLim = (F0 - lo) * (1 - fade) + b1 * fade;
    let onBrow = 0;
    if (b > bLim) { b = bLim; onBrow = 1 - fade; }
    const hh = hillH(a, b);
    const [x, y] = P(a, b); let h = hMirror(map, x, y) + hh - 0.35 * smooth(1.2, 0, hh);   // (the toe sinks under the terrain: no seam)
    if (onBrow) h = loY * onBrow + h * (1 - onBrow);   // (the edge row sits ON the rock brow, just under its surface)
    sp.push(x - it.x, h, -(y - it.y));
    const steep = Math.abs(hillH(a + 1, b) - hillH(a - 1, b)) + Math.abs(hillH(a, b + 1) - hillH(a, b - 1));
    const c = cT.clone().lerp(cE, Math.min(1, steep / 3) * 0.7 + (fbm(a * 0.2, b * 0.2, 31) - 0.5) * 0.5).lerp(cR, steep > 4 ? 0.35 : 0), v = 0.88 + 0.24 * fbm(a * 0.5, b * 0.5, 9);
    sc.push(c.r * v, c.g * v, c.b * v);
  }
  for (let jb = 0; jb < nb; jb++) for (let ja = 0; ja < na; ja++) { const k = jb * (na + 1) + ja; si.push(k, k + na + 1, k + 1, k + 1, k + na + 1, k + na + 2); }
  const g = new THREE.BufferGeometry(); g.setIndex(si); g.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(sc, 3)); g.computeVertexNormals();
  return g;
}
function quarryFloor(map, it, cut) {   // dusty trodden floor in front of the face, fading at its edges (vertex alpha)
  let deep = 0; for (let i = 0; i < Q.NC; i++) deep = Math.max(deep, faceOff(cut, i));
  const P = frame(it), W = Q.NC * Q.BS / 2 + 6, b0 = Q.F0 - deep - 0.6, b1 = Q.F0 + 20;
  const na = 22, nb = 16, pos = [], col = [], idx = [], c = new THREE.Color("#cfc6b1");
  for (let jb = 0; jb <= nb; jb++) for (let ja = 0; ja <= na; ja++) {
    const a = -W + 2 * W * ja / na, b = b0 + (b1 - b0) * jb / nb, [x, y] = P(a, b);
    pos.push(x - it.x, map.h(x, y) + 0.22, -(y - it.y));   // (proud of the terrain mesh: its coarser triangles never poke through as marbled islands)
    // solid underfoot (a half-seen floor read as marbled patches over the map's rocky ground), fading only at its edges
    const e = Math.min(1, Math.min(ja, na - ja) / 3, (nb - jb) / 2 + (jb === 0 ? 1 : 0.2)), v = 0.88 + 0.2 * jit(a, b, 0, 4);
    col.push(c.r * v, c.g * v, c.b * v, Math.max(0, Math.min(1, e)));
  }
  for (let jb = 0; jb < nb; jb++) for (let ja = 0; ja < na; ja++) { const k = jb * (na + 1) + ja; idx.push(k, k + na + 1, k + 1, k + 1, k + na + 1, k + na + 2); }
  const g = new THREE.BufferGeometry(); g.setIndex(idx);
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4)); g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- the adit
// The hillside the adit is driven into: a smooth rise blended into the terrain (no hard edge), grass over the top, bare
// earth and rock where it is steep, a few outcrops; its front cut back into a low rock face with the timbered portal in
// it, facing the open ground the tubs come out onto.
const HILL = { R: 17, H: 7.5 };
function aditH(a, b) {   // height above the ground (works frame)
  const db = b - ADIT.mound, r = Math.hypot(a * 0.75, db * (db > 0 ? 1.25 : 1.0));   // (the front falls away faster: the slope the level is driven into)
  let h = HILL.H * smooth(HILL.R, 1.5, r) * (0.85 + 0.3 * fbm(a * 0.12, b * 0.12, 51));
  // the working cut: a short rock face either side of the portal, the ground dug level in front of it
  const cw = smooth(5.5, 2.5, Math.abs(a)), cb = ADIT.mouth - 0.3;
  if (cw > 0 && b > cb - 1.2) h = h * (1 - cw) + cw * Math.max(0, Math.min(h + 0.6, 3.3 - Math.max(0, b - cb) * 6 + (fbm(a * 1.3, b, 53) - 0.5) * 0.5));
  return Math.max(0, h);
}
function aditGeo(map, it, cut) {
  const d = depthOf("adit", cut), P = frame(it);
  const na = 56, nb = 44, a0 = -24, a1 = 24, b0 = ADIT.mound - 20, b1 = ADIT.mouth + 6, sp = [], sc = [], si = [];
  const cT = new THREE.Color("#627038"), cT2 = new THREE.Color("#7a7b42"), cE = new THREE.Color("#7a6548"), cR = new THREE.Color("#bdb5a4"), cB = new THREE.Color("#8b7552");
  const H = [];   // the skin's RENDERED heights (absolute Y), kept so the loose rocks can be planted on the same surface
  for (let jb = 0; jb <= nb; jb++) for (let ja = 0; ja <= na; ja++) {
    const a = a0 + (a1 - a0) * ja / na, b = b0 + (b1 - b0) * jb / nb, hh = aditH(a, b), [x, y] = P(a, b);
    // the portal's notch: the rock face stands back a little behind the portal frame
    const Y = hMirror(map, x, y) + hh - 0.35 * smooth(1.2, 0, hh);   // (the toe sinks under the terrain)
    H.push(Y); sp.push(x - it.x, Y, -(y - it.y));
    const sl = Math.hypot(aditH(a + 0.8, b) - aditH(a - 0.8, b), aditH(a, b + 0.8) - aditH(a, b - 0.8)) / 1.6;
    const c = cT.clone().lerp(cT2, fbm(a * 0.3, b * 0.3, 57)).lerp(cE, smooth(0.35, 0.9, sl + (fbm(a * 0.6, b * 0.6, 59) - 0.5) * 0.4)).lerp(cR, smooth(1.2, 2.2, sl));
    c.lerp(cB, smooth(0.9, 0.05, hh) * 0.85);   // (the foot of the hill: trodden earth, blending into the ground)
    const v = 0.86 + 0.26 * fbm(a * 0.9, b * 0.9, 61); sc.push(c.r * v, c.g * v, c.b * v);
  }
  // the skin as it is DRAWN at (a, b): bilinear over the grid above — what any loose rock must be planted against
  const skinY = (a, b) => {
    const fa = Math.min(na - 1e-4, Math.max(0, (a - a0) / (a1 - a0) * na)), fb = Math.min(nb - 1e-4, Math.max(0, (b - b0) / (b1 - b0) * nb));
    const i = Math.floor(fa), j = Math.floor(fb), u = fa - i, v = fb - j, at = (jj, ii) => H[jj * (na + 1) + ii];
    return (at(j, i) * (1 - u) + at(j, i + 1) * u) * (1 - v) + (at(j + 1, i) * (1 - u) + at(j + 1, i + 1) * u) * v;
  };
  // plant a piece: its footprint sampled on the rendered skin, set by the LOWEST corner and sunk 40 % of its height —
  // on the steep front a slab buries itself into the hillside instead of hanging its downhill edge in the sky
  const plant = (a, b, halfW, height) => {
    const m = Math.min(skinY(a, b), skinY(a - halfW, b), skinY(a + halfW, b), skinY(a, b - halfW), skinY(a, b + halfW));
    const [x, y] = P(a, b); return m - map.h(x, y) - 0.4 * height;
  };
  for (let jb = 0; jb < nb; jb++) for (let ja = 0; ja < na; ja++) { const k = jb * (na + 1) + ja; si.push(k, k + na + 1, k + 1, k + 1, k + na + 1, k + na + 2); }
  const hill = new THREE.BufferGeometry(); hill.setIndex(si); hill.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3)); hill.setAttribute("color", new THREE.Float32BufferAttribute(sc, 3)); hill.computeVertexNormals();
  // the portal: two stout posts, a lintel and a cap-piece, sills, the dark of the level behind (local X = b outward, Z = −a)
  const portal = [], bm = 0;
  for (const z of [-1.0, 1.0]) portal.push(tint(new THREE.BoxGeometry(0.32, 2.7, 0.32), "#5f4630", 0.2).rotateX(z * 0.04).translate(bm, 1.35, z));
  portal.push(tint(new THREE.BoxGeometry(0.4, 0.36, 2.9), "#4f3a27", 0.2).translate(bm, 2.8, 0));
  portal.push(tint(new THREE.BoxGeometry(0.3, 0.26, 3.5), "#5a4430", 0.2).translate(bm - 0.35, 3.1, 0));
  for (const z of [-1.0, 1.0]) portal.push(tint(new THREE.BoxGeometry(0.28, 2.5, 0.28), "#5f4630", 0.2).translate(bm - 1.5, 1.25, z));
  portal.push(tint(new THREE.BoxGeometry(0.34, 0.3, 2.5), "#4f3a27", 0.2).translate(bm - 1.5, 2.6, 0));
  portal.push(tint(new THREE.BoxGeometry(2.2, 0.1, 2.6), "#4a3826", 0.25).translate(bm - 0.9, 3.28, 0));          // boards over the entry
  portal.push(tint(new THREE.BoxGeometry(3.4, 2.62, 1.7), "#0e0b09", 0.03).translate(bm - 1.95, 1.31, 0));          // the dark of the level
  // the rock the level is cut into: broken blocks and slabs piled either side and over the hood, not a wall
  for (let k = 0; k < 26; k++) {
    const side = k < 20 ? (k % 2 ? 1 : -1) : 0, up = k < 20 ? Math.floor(k / 2) % 5 : k - 20;
    const z = side ? side * (1.55 + 0.9 * hsh(k, 141) + (up > 2 ? 0.6 : 0)) : (hsh(k, 142) - 0.5) * 3.6;
    // (kept at or below the cut's wall height, tucked against the face — piled higher they float over the crest)
    const y = side ? up * 0.6 + 0.2 : 2.9 + 0.3 * hsh(k, 143), x = bm - 0.8 - 1.4 * hsh(k, 144) - (side ? 0 : 0.4), sc = 0.55 + 0.6 * hsh(k, 145);
    portal.push(lump(["#a1998a", "#8e8778", "#b0a898", "#7f786c"][k % 4], 160 + k).scale(1.5 * sc, 1.25 * sc, 1.35 * sc).rotateY(hsh(k, 146) * 6).rotateX((hsh(k, 147) - 0.5) * 0.6).translate(x, y, z));
  }
  // rails out of the mouth to the heap, sleepers under them
  const railYaw = Math.atan2(2.5, ADIT.heap - ADIT.mouth), L = ADIT.heap - ADIT.mouth + 0.5, rails = [];
  const rail1 = merge([...[-0.33, 0.33].map((z) => tint(new THREE.BoxGeometry(0.92, 0.07, 0.07), "#4a3d30").translate(0, 0.16, z)), tint(new THREE.BoxGeometry(0.14, 0.08, 1.0), "#5a4631", 0.2).translate(0, 0.07, 0)]);
  for (let j = 0; j * 0.9 < L; j++) { const t = j * 0.9 + 0.3; rails.push([rail1, Math.sin(railYaw) * t, ADIT.mouth - 0.6 + Math.cos(railYaw) * t, 0, railYaw]); }
  // the cut rock face either side of the portal: broken rock, not a smooth wall (planted on the drawn surface)
  for (let k = 0; k < 16; k++) { const a = (k % 2 ? 1 : -1) * (1.9 + 3.2 * hsh(k, 131)), b = ADIT.mouth - 0.9 - 1.4 * hsh(k, 132), sc3 = 0.5 + 0.7 * hsh(k, 133);
    rails.push([lump(k % 3 ? "#b4ac9b" : "#9a9282", 140 + k).scale(1.6 * sc3, 1.5 * sc3, 1.3 * sc3), a, b, plant(a, b, sc3, 1.4 * sc3), hsh(k, 135) * 6]); }
  // outcrops breaking through the turf on the hill's flanks
  const rocks = [];
  for (let k = 0; k < 14; k++) {   // rock breaking out of the hill's steep front either side of the cut
    const a = (k % 2 ? 1 : -1) * (3.2 + 7 * hsh(k, 95)), b = ADIT.mouth - 1.5 - 4 * hsh(k, 96), sc2 = 0.6 + 0.9 * hsh(k, 97);
    rocks.push([lump(k % 3 ? "#a39b8b" : "#8f8878", 120 + k).scale(2 * sc2, 1.4 * sc2, 1.6 * sc2), a, b, plant(a, b, 1.2 * sc2, 1.2 * sc2), hsh(k, 98) * 6]); }   // (planted by its lowest footprint corner — never hanging over the drop)
  for (let k = 0; k < 9; k++) { const an = hsh(k, 91) * 6.283, r = 5 + 8 * hsh(k, 92), a = Math.cos(an) * r, b = ADIT.mound + Math.sin(an) * r * 0.8 - 2;
    if (b > ADIT.mouth - 2 && Math.abs(a) < 5) continue;
    const sc2 = 0.8 + 1.4 * hsh(k, 93); rocks.push([lump("#908979", 100 + k).scale(2.2 * sc2, 1.3 * sc2, 1.8 * sc2), a, b, plant(a, b, 1.3 * sc2, 1.1 * sc2), hsh(k, 94) * 6]); }
  return { ground: hill, rock: placeAll(map, it, [
    [merge(portal), 0, ADIT.mouth + 0.1, 0, 0],
    ...rails,
    // the spoil heap: aside, against the hill's flank (off the tubs' way to the ore heap)
    [coneHeap(2.2 + 3.2 * d, 1.0 + 2.2 * d, "#8b8171", 30, 11), -9.5 - 1.5 * d, ADIT.mouth - 1],
    [stackOfPit(), 6.5, ADIT.mouth + 0.8],
    ...rocks,
  ]) };
}
function stackOfPit() { const g = []; for (let k = 0; k < 7; k++) { const [x, y, z] = pyramid(k, 4, 0.3, 0.26); g.push(logGeo(2.2, 0.12).translate(x, y + 0.12, z)); } return merge(g); }   // pit props for the timbering
// A rock drape hugging the adit cut's steep walls (same surface function, 9 cm proud): vertex alpha comes up only on
// steep ground, so the cut reads as bedded rock at Ground view instead of the terrain splat smeared down a cliff.
// The portal's own doorway strip is masked out (the posts, hood and piled blocks dress that).
function aditFaceGeo(map, it) {
  const P = frame(it), cb = ADIT.mouth - 0.3;
  const na = 56, nb = 14, a0 = -9, a1 = 9, b0 = cb - 2.8, b1 = cb + 1.8, pos = [], col = [], uv = [], idx = [];
  const cW = new THREE.Color("#978e7c"), cD = new THREE.Color("#6a6354"), cP = new THREE.Color("#b3a890");
  for (let jb = 0; jb <= nb; jb++) for (let ja = 0; ja <= na; ja++) {
    const a = a0 + (a1 - a0) * ja / na, b = b0 + (b1 - b0) * jb / nb, h = aditH(a, b), [x, y] = P(a, b);
    pos.push(x - it.x, hMirror(map, x, y) + h + 0.09, -(y - it.y));
    const sl = Math.hypot(aditH(a + 0.7, b) - aditH(a - 0.7, b), aditH(a, b + 0.7) - aditH(a, b - 0.7)) / 1.4;
    const band = fbm(h * 1.1, a * 0.1, 53), c = cW.clone().lerp(cP, smooth(0.35, 0.75, band)).lerp(cD, Math.max(0, fbm(a * 0.9, h * 0.9, 57) - 0.55) * 1.3);
    const v = 1.18 + 0.32 * (fbm(a * 1.7, b * 1.4 + h, 59) - 0.5);
    const door = smooth(3.1, 1.9, Math.abs(a)) * smooth(cb - 2.0, cb - 0.8, b);   // the doorway strip stays open
    col.push(c.r * v, c.g * v, c.b * v, smooth(0.9, 1.35, sl) * smooth(cb - 2.6, cb - 1.7, b) * (1 - door));   // (only the true cliff round the mouth, never a shade over the turf)
    uv.push(a / 3.2, h / 3.2);
  }
  for (let jb = 0; jb < nb; jb++) for (let ja = 0; ja < na; ja++) { const k = jb * (na + 1) + ja; idx.push(k, k + na + 1, k + 1, k + 1, k + na + 1, k + na + 2); }
  const g = new THREE.BufferGeometry(); g.setIndex(idx);
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- pits (clay, bog iron)
function pitsGeo(map, it, cut) {
  const clay = it.res === "clay", open = pitsOpen(cut), g = [];
  const water = clay ? "#5f6d72" : "#3b3f38", rim = clay ? "#9a6a44" : "#5a4630", inner = clay ? "#8a8f86" : "#2e241b";
  const P = frame(it), pieces = [];
  pitSpots(it).slice(0, open).forEach(([x, y, r], k) => {
    const pit = [];
    // the hollow: dark wet ground sloping down, water standing in some (a bank of dug earth round it)
    pit.push(tint(new THREE.CircleGeometry(r * 0.95, 14).rotateX(-Math.PI / 2), inner, 0.25, k).translate(0, 0.05, 0));
    if (k % 3 !== 0) pit.push(tint(new THREE.CircleGeometry(r * (0.45 + 0.2 * hsh(k, 8)), 12).rotateX(-Math.PI / 2), water, 0.06, k).translate(0.15, 0.07, -0.1));
    pit.push(tint(new THREE.CylinderGeometry(r + 0.9, r * 0.95, 0.32, 16, 1, true), rim, 0.35, k).translate(0, 0.14, 0));
    for (let j = 0; j < 11; j++) { const a = j / 11 * 6.283 + hsh(k, j) * 0.4, rr = r + 0.7 + hsh(k, j + 20) * 0.9, sc = 0.5 + 0.9 * hsh(k, j + 40);
      pit.push(lump(j % 4 === 0 && !clay ? "#7a4a2a" : rim, k * 13 + j).scale(sc * 1.3, sc * 0.55, sc).rotateY(a).translate(Math.cos(a) * rr, -0.05, Math.sin(a) * rr)); }
    pit.push(tint(new THREE.BoxGeometry(0.05, 0.05, 1.1), TIMBER).rotateX(0.5).translate(r * 0.7, 0.35, 0.3));   // a spade's haft left in the spoil
    const h = map.h(x, y); pieces.push(merge(pit).translate(x - it.x, h, -(y - it.y)));
  });
  if (!clay) {   // the ore-roasting hearth: a ring of stones round a bed of embers
    const [hx, hy] = P(6.5, PIT.c + 11), h = map.h(hx, hy), hearth = [];
    for (let j = 0; j < 9; j++) { const a = j / 9 * 6.283; hearth.push(lump("#7d776c", j + 40).scale(0.7, 0.8, 0.7).translate(Math.cos(a) * 1.3, 0, Math.sin(a) * 1.3)); }
    hearth.push(tint(new THREE.CircleGeometry(1.2, 10).rotateX(-Math.PI / 2), "#2a1a12", 0.3).translate(0, 0.12, 0));
    hearth.push(coneHeap(1.0, 0.5, "#7a3e22", 9, 21));
    pieces.push(merge(hearth).translate(hx - it.x, h, -(hy - it.y)));
  }
  return merge(pieces);
}
export const hearthOf = (it) => frame(it)(6.5, PIT.c + 11);

// ---------------------------------------------------------------- charcoal clamp, bloomery, well
function clampGeo() {   // at the building's centre, local X along its facing
  const g = [];
  const dome = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(3.3, 2.2, 3.3), D = dome.attributes.position, c = [];
  for (let k = 0; k < D.count; k++) { const y = D.getY(k), v = 0.75 + 0.4 * jit(D.getX(k), y, D.getZ(k), 2), col = new THREE.Color(jit(D.getX(k), D.getZ(k), 0, 8) < 0.5 ? "#5a5a36" : "#4a3d2e"); c.push(col.r * v, col.g * v, col.b * v);
    D.setXYZ(k, D.getX(k) * (0.95 + 0.1 * jit(D.getX(k), 0, D.getZ(k), 4)), D.getY(k) * (0.92 + 0.16 * jit(D.getZ(k), 1, D.getX(k), 6)), D.getZ(k)); }
  dome.setAttribute("color", new THREE.Float32BufferAttribute(c, 3)); dome.computeVertexNormals(); g.push(dome);
  for (let k = 0; k < 16; k++) { const a = k * 2.399, r = 1 + 2.1 * Math.sqrt((k + 0.5) / 16), y = 2.2 * Math.sqrt(Math.max(0, 1 - (r / 3.3) ** 2)); g.push(tint(new THREE.BoxGeometry(0.9, 0.12, 0.6), k % 3 ? "#5c6034" : "#4f4430", 0.3, k).rotateY(a).rotateX(0.1 * (k % 3 - 1)).translate(Math.cos(a) * r, y + 0.02, Math.sin(a) * r)); }   // the turves
  for (let v = 0; v < 3; v++) g.push(tint(new THREE.CylinderGeometry(0.12, 0.16, 0.3, 6), "#1e1a16").translate(Math.cos(v * 2.1) * 1.5, 2.05 - 0.05 * v, Math.sin(v * 2.1) * 1.5));   // the vents
  for (let k = 0; k < 14; k++) { const [x, y, z] = pyramid(k, 5, 0.32, 0.28); g.push(logGeo(1.6, 0.13).translate(x, y + 0.13, z).rotateY(Math.PI / 2).translate(-5.2, 0, 1.2)); }   // billets
  const hut = tint(new THREE.ConeGeometry(1.5, 2.8, 8, 1, true), "#6e5a3c", 0.3).translate(0, 1.4, 0); g.push(hut.translate(4.6, 0, -2.4));
  g.push(tint(new THREE.CircleGeometry(4.2, 16).rotateX(-Math.PI / 2), "#2c2620", 0.3).translate(0, 0.05, 0));   // the black ground of the pitstead
  return merge(g);
}
function bloomeryGeo() {
  const g = [];
  g.push(tint(new THREE.CylinderGeometry(0.55, 0.95, 2.1, 12), "#9b5d3f", 0.2).translate(0, 1.05, 0));      // the clay shaft
  g.push(tint(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 10), "#1e1512").translate(0, 2.11, 0));
  g.push(tint(new THREE.BoxGeometry(0.2, 0.55, 0.5), "#2a1a12").translate(0.9, 0.3, 0));                    // the tapping arch
  for (const z of [-0.5, 0.5]) g.push(tint(new THREE.BoxGeometry(1.2, 0.3, 0.55), "#5a3c28", 0.2).rotateZ(0.12).translate(-1.6, 0.35, z));   // bellows
  for (const [x, z] of [[-2.6, -1.4], [-2.6, 1.4], [-0.9, -1.4], [-0.9, 1.4]]) g.push(tint(new THREE.BoxGeometry(0.16, 2.2, 0.16), TIMBER).translate(x, 1.1, z));
  g.push(tint(new THREE.BoxGeometry(2.2, 0.12, 3.2), "#7a6a48", 0.2).rotateZ(-0.18).translate(-1.75, 2.25, 0));   // the lean-to roof
  g.push(coneHeap(1.3, 0.7, "#2d2826", 14, 31).translate(2.3, 0, 1.6));    // slag
  g.push(coneHeap(1.0, 0.55, "#744b35", 10, 37).translate(1.8, 0, -1.9));  // roasted ore
  g.push(coneHeap(1.0, 0.6, "#1a1a1a", 10, 41).translate(-0.4, 0, -2.4));  // charcoal
  return merge(g);
}
function wellGeo() {
  const g = [];
  g.push(tint(new THREE.CylinderGeometry(0.95, 1.0, 0.85, 14, 1, true), "#8f887a", 0.25).translate(0, 0.42, 0));
  g.push(tint(new THREE.TorusGeometry(0.95, 0.12, 5, 14).rotateX(Math.PI / 2), "#9d968a", 0.2).translate(0, 0.85, 0));
  g.push(tint(new THREE.CircleGeometry(0.85, 12).rotateX(-Math.PI / 2), "#101518").translate(0, 0.5, 0));
  for (const z of [-0.95, 0.95]) g.push(tint(new THREE.BoxGeometry(0.14, 2.2, 0.14), TIMBER).translate(0, 1.1, z));
  g.push(tint(new THREE.CylinderGeometry(0.1, 0.1, 1.9, 8), "#7a5e40").rotateX(Math.PI / 2).translate(0, 1.55, 0));
  g.push(tint(new THREE.BoxGeometry(0.06, 0.4, 0.06), "#5a4631").translate(0.2, 1.45, 1.05));   // the crank
  for (const s of [-1, 1]) g.push(tint(new THREE.BoxGeometry(0.9, 0.06, 2.4), "#6a5436", 0.2).rotateX(0).rotateZ(s * 0.62).translate(s * 0.34, 2.35, 0));
  return merge(g);
}

// ---------------------------------------------------------------- GPU particles: smoke (normal blend), sparks and glows (additive)
// Each particle: an origin, a seed, and its emitter kind's parameters; the shader moves it (rise, spread, wind), grows
// it and fades it over its life from the time uniform alone.
const KINDS = {   // n per emitter, life s, rise m/s, spread m, size0, size1 m, rgb, alpha, additive
  chimney: [10, 9, 0.9, 0.35, 0.9, 4.6, [0.86, 0.85, 0.84], 0.42, 0],
  forge: [12, 7, 1.3, 0.3, 0.9, 3.8, [0.45, 0.44, 0.43], 0.45, 0],
  clamp: [18, 12, 0.55, 0.7, 1.3, 6, [0.84, 0.85, 0.88], 0.5, 0],
  hearth: [12, 8, 0.8, 0.4, 0.9, 4, [0.8, 0.78, 0.75], 0.48, 0],
  dust: [10, 2.2, 0.35, 0.8, 0.6, 2.6, [0.88, 0.85, 0.78], 0.4, 0],
  sparks: [12, 1.2, 2.8, 0.5, 0.22, 0.08, [1.0, 0.62, 0.22], 1.0, 1],
  glow: [2, 1.6, 0.0, 0.0, 1.9, 2.2, [1.0, 0.45, 0.12], 0.6, 1],
};
function makeParticles(scene, additive) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, pxPerM: { value: 800 }, dpr: { value: 1 }, wind: { value: new THREE.Vector2(0.45, 0.2) } },
    vertexShader: /* glsl */`
      attribute vec4 prm; attribute vec4 prm2; attribute vec3 rgb; attribute float seed;
      uniform float time; uniform float pxPerM; uniform float dpr; uniform vec2 wind;
      varying vec3 vC; varying float vA;
      float h1(float n){ return fract(sin(n) * 43758.5453); }
      void main(){
        float life = prm.x, age = fract(time / life + seed), rise = prm.y, spread = prm.z;
        vec3 p = position;
        float a = seed * 91.7, r = spread * (0.3 + age) * (0.5 + h1(seed * 13.1));
        p.x += cos(a) * r + wind.x * age * life * (0.3 + rise * 0.4); p.z -= sin(a) * r + wind.y * age * life * (0.3 + rise * 0.4);
        p.y += rise * age * life * (1.0 - 0.35 * age) + (prm2.w > 0.5 ? -4.0 * age * age * life : 0.0);
        vC = rgb; vA = prm2.z * smoothstep(0.0, 0.12, age) * (1.0 - age) * (1.0 - age * 0.3);
        if (prm2.w > 0.5) vA = prm2.z * (1.0 - age) * step(0.5, h1(seed * 7.0 + floor(time / life + seed) * 3.1)); // sparks: in bursts
        if (rise == 0.0) vA = prm2.z * (0.65 + 0.35 * sin(time * 11.0 + seed * 40.0) * sin(time * 3.7 + seed * 9.0));   // a glow: flickers
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        float s = mix(prm.w, prm2.x, age);
        gl_PointSize = clamp(s * pxPerM / -mv.z, 1.0, 180.0) * dpr;
        if (vA <= 0.001) gl_PointSize = 0.0;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC; varying float vA;
      void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float r = dot(q, q); if (r > 1.0) discard;
        float a = vA * pow(1.0 - r, 1.6); gl_FragColor = vec4(vC, a); }`,
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const geo = new THREE.BufferGeometry(); const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 5; scene.add(pts);
  function set(emitters) {   // [{x, y, h, kind, k}] in sim coordinates
    const P = [], PR = [], PR2 = [], C = [], SD = [];
    for (const e of emitters) {
      const K = KINDS[e.kind]; if (!K || (K[8] ? 1 : 0) !== (additive ? 1 : 0)) continue;
      const n = Math.round(K[0] * (e.mul || 1));
      for (let j = 0; j < n; j++) {
        P.push(e.x + (hsh(e.k, j * 3) - 0.5) * (e.jx || 0), e.h, -(e.y + (hsh(e.k, j * 3 + 1) - 0.5) * (e.jx || 0)));
        PR.push(K[1] * (0.8 + 0.4 * hsh(e.k, j + 50)), K[2], K[3], K[4]); PR2.push(K[5], 0, K[7] * (e.a || 1), e.kind === "sparks" ? 1 : 0);
        C.push(...K[6]); SD.push(j / n + hsh(e.k, j) * 0.07);
      }
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute("prm", new THREE.Float32BufferAttribute(PR, 4));
    geo.setAttribute("prm2", new THREE.Float32BufferAttribute(PR2, 4)); geo.setAttribute("rgb", new THREE.Float32BufferAttribute(C, 3)); geo.setAttribute("seed", new THREE.Float32BufferAttribute(SD, 1));
    geo.setDrawRange(0, SD.length); geo.computeBoundingSphere();
  }
  return { mat, set, pts };
}

// ---------------------------------------------------------------- the animals and children (render only)
function henGeo() {
  const g = [tint(new THREE.SphereGeometry(0.2, 8, 6), "#e8e0cc", 0.15).scale(1.25, 0.95, 0.85).translate(0, 0.25, 0),
    tint(new THREE.SphereGeometry(0.09, 7, 5), "#e8e0cc").translate(0.2, 0.42, 0), tint(new THREE.BoxGeometry(0.07, 0.07, 0.025), "#b8322a").translate(0.21, 0.52, 0),
    tint(new THREE.ConeGeometry(0.03, 0.08, 4).rotateZ(-Math.PI / 2), "#d8a040").translate(0.31, 0.41, 0), tint(new THREE.BoxGeometry(0.1, 0.18, 0.14), "#e0d6c0").rotateZ(0.5).translate(-0.24, 0.36, 0)];
  for (const z of [-0.06, 0.06]) g.push(tint(new THREE.CylinderGeometry(0.014, 0.014, 0.16, 4), "#c89040").translate(0, 0.07, z));
  return merge(g);
}
function dogGeo() {
  const c = "#6b4a2e", g = [tint(new THREE.BoxGeometry(0.72, 0.28, 0.26), c, 0.2).translate(0, 0.5, 0), tint(new THREE.BoxGeometry(0.24, 0.24, 0.22), c).translate(0.44, 0.66, 0),
    tint(new THREE.BoxGeometry(0.16, 0.12, 0.13), "#4a3220").translate(0.6, 0.6, 0), tint(new THREE.CylinderGeometry(0.03, 0.05, 0.36, 5), c).rotateZ(0.9).translate(-0.48, 0.66, 0)];
  for (const z of [-0.08, 0.08]) g.push(tint(new THREE.BoxGeometry(0.06, 0.12, 0.05), "#3a2616").translate(0.42, 0.82, z));
  for (const x of [-0.27, 0.27]) for (const z of [-0.09, 0.09]) g.push(tint(new THREE.BoxGeometry(0.08, 0.38, 0.08), c).translate(x, 0.19, z));
  return merge(g);
}
const TUNIC = ["#8a3a2a", "#3a5a7a", "#6a7a3a", "#a08040", "#5a3a6a"];
function childGeo(tunic) {   // ~1.05 m: legs, a tunic, a head with hair
  const g = [];
  for (const z of [-0.07, 0.07]) g.push(tint(new THREE.BoxGeometry(0.09, 0.42, 0.09), "#5a4a3a").translate(0, 0.21, z));
  g.push(tint(new THREE.CylinderGeometry(0.13, 0.22, 0.45, 8), tunic, 0.08).translate(0, 0.62, 0));
  for (const z of [-0.2, 0.2]) g.push(tint(new THREE.BoxGeometry(0.07, 0.34, 0.07), tunic, 0.08).rotateX(z > 0 ? -0.25 : 0.25).translate(0, 0.66, z));
  g.push(tint(new THREE.SphereGeometry(0.13, 8, 6), "#e7c3a0", 0.05).translate(0, 0.96, 0));
  g.push(tint(new THREE.SphereGeometry(0.14, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), "#6a4a2a", 0.1).translate(-0.01, 0.98, 0));
  return merge(g);
}

// where the smoke leaves each building model (its chimney or smoke-louvre: the models' own tops, local x along the
// building's facing, y to its left, height), and what kind of smoke
const FLUE = { house0: [-2.0, 0, 6.6, "chimney"], house1: [1.24, 0, 7.0, "chimney"], house2: [4.1, 0, 6.05, "chimney"],
  blacksmith: [-2.2, 3.0, 8.45, "forge"], weaver: [-1.3, 0.9, 6.6, "chimney"] };
// buildings with no Blender model of their own (render/buildings.js draws nothing for them): drawn here. If one gets a
// model in assets/glb, take it out of this set.
const OWN_MODEL = new Set(["charcoal_kiln", "bloomery"]);
// ---------------------------------------------------------------- the renderer
export function makeRender(scene, map, { figures = null } = {}) {
  if (typeof location !== "undefined" && /[?&]nolaneE\b/.test(location.search)) return { update() {} };   // (A/B: tools/bench-render.mjs --extra "&nolaneE")
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const rockTex = rockDetailTex();
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0, map: rockTex });   // the quarry face
  const rockFaceMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0, map: rockTex, transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });   // the adit cut's drape (alpha by slope)
  const floorMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const group = new THREE.Group(); scene.add(group);
  const sites = new Map();   // key → { sig, obj }
  const smoke = makeParticles(scene, false), glow = makeParticles(scene, true);
  const inst = (geo, cap, colored = false) => { const m = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.frustumCulled = false; if (colored) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); scene.add(m); return m; };
  const blocks = inst(ashlar(), 600), sledges = inst(sledgeGeo(), 200), tubs = inst(tubGeo(), 200);
  const ropes = inst(tint(new THREE.CylinderGeometry(0.02, 0.02, 1, 4), "#cbb994").rotateZ(Math.PI / 2).translate(0.5, 0, 0), 400);
  const buckets = inst(merge([tint(new THREE.CylinderGeometry(0.16, 0.13, 0.28, 8), "#6a5436").translate(0, -0.14, 0), tint(new THREE.CylinderGeometry(0.012, 0.012, 1, 4), "#cbb994").translate(0, 0.5, 0)]), 64);
  const hens = inst(henGeo(), 240, true), dogs = inst(dogGeo(), 40), kids = TUNIC.map((c) => inst(childGeo(c), 30));
  const d = new THREE.Object3D(), B = { x: 0, y: 0, yaw: 0, fade: 0 }, tmpC = new THREE.Color();
  let emitKey = "";

  // the trees and bushes standing where the workings are dug are gone (props.clearArea; render only — the map's own
  // resource props there too, the workings replace them)
  const cleared = new Set();
  function clearFor(it, style) {
    const props = globalThis.HG?.props; if (!props || cleared.has(it.id)) return; cleared.add(it.id);
    const c = Math.cos(it.rot), s = Math.sin(it.rot), off = worksInfo(it).off;
    const loc = (x, y) => { const dx = x - it.x, dy = y - it.y; return [-s * dx + c * dy, c * dx + s * dy - off]; };   // → (a, b)
    const W = Q.NC * Q.BS / 2;
    const inside = style === "quarry" ? (a, b) => (Math.abs(a) < W + 14 && b > Q.F0 - Q.NR * Q.BS - 8 && b < Q.F0 + 22) || (Math.abs(a + 5) < 9 && b > 0 && b < Q.F0 + 34)
      : style === "adit" ? (a, b) => Math.hypot(a * 0.75, (b - ADIT.mound) * 1.05) < HILL.R + 2 || (b > ADIT.mound && b < ADIT.heap + 22 && Math.abs(a) < 12 + (b - ADIT.mound) * 0.6)
      : (a, b) => Math.hypot(a, b - PIT.c) < 17 || (Math.abs(a) < 4 && b > PIT.c && b < PIT.c + 21);
    props.clearArea((x, y) => { const [a, b] = loc(x, y); return inside(a, b); });
  }
  function site(key, sig, build) {
    let S = sites.get(key);
    if (S && S.sig === sig) { S.live = true; return S; }
    if (S) { group.remove(S.obj); S.obj.traverse((o) => o.geometry?.dispose()); }
    const obj = build(); S = { sig, obj, live: true }; group.add(obj); sites.set(key, S); return S;
  }
  // the ground meshes (the hill over the quarry, the mine's hillside) wear the TERRAIN's own material — its splat surfaces
  // at world scale, rock on steep slopes, the same light, fog and haze — so they are part of the land, not a sheet on it
  let terrMat = null;
  const findTerr = () => { if (!terrMat) scene.traverse((o) => { if (!terrMat && o.isMesh && o.material?.uniforms?.albedoArr) terrMat = o.material; }); return terrMat; };
  const groundMesh = (g, it) => {
    const n = g.attributes.position.count; g.setAttribute("shadow", new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    const o = new THREE.Mesh(g, findTerr() || mat); o.position.set(it.x, 0, -it.y); o.frustumCulled = true; g.computeBoundingSphere(); return o;
  };
  const mesh = (g, m = mat, x = 0, y = 0, h = 0, rot = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, h, -y); o.rotation.y = rot; o.frustumCulled = true; g.computeBoundingSphere(); return o; };

  let slowT = -1e9, houses = [], wellsC = [];
  function update(w, cam, { visible = null, visibleMan = null, pxPerM = 800, dpr = 1, now = 0 } = {}) {
    const L = w.labor, t = now;
    smoke.mat.uniforms.time.value = glow.mat.uniforms.time.value = t;
    smoke.mat.uniforms.pxPerM.value = glow.mat.uniforms.pxPerM.value = pxPerM; smoke.mat.uniforms.dpr.value = glow.mat.uniforms.dpr.value = dpr;
    if (w.wind) { const k = Math.min(1, 5 / (Math.hypot(w.wind.x, w.wind.y) || 1)) * 0.35; smoke.mat.uniforms.wind.value.set(w.wind.x * k, w.wind.y * k); } // the chimneys' smoke goes downwind (js/sim/weather.js)
    else smoke.mat.uniforms.wind.value.set(0.45, 0.2);
    const cx = cam.position.x, cy = -cam.position.z, near = (x, y, r) => Math.hypot(x - cx, y - cy) < r;
    const seen = (x, y, team) => !visible || visible(x, y, team);
    if (t - slowT > 0.3 || t < slowT) { slowT = t; slow(w, L, seen, near, t); }
    // ---- sledges, tubs, and the wells' buckets (every frame: they move)
    let ns = 0, nt = 0, nr = 0;
    const drawers = [];
    if (L) for (const [i, M] of L.men) {
      if (M.pose === "work_bucket") drawers.push(i);
      const kind = M.carry?.kind; if (kind !== "sledge" && kind !== "tub") continue;
      if (!w.S.alive[i] || (visibleMan && !visibleMan(i))) continue;
      const fig = figures && figures.bodyOf(i, B), x = fig ? B.x : w.S.x[i], y = fig ? B.y : w.S.y[i];
      if (!near(x, y, FIG_NEAR * 1.3)) continue;
      const hd = fig ? B.yaw - Math.PI / 2 : w.S.facing[i];
      if (kind === "sledge" && ns < 200) {
        // the sledge trails the hauler (trailer kinematics): it follows his track, never sweeps sideways when he turns
        const [bx, by, syaw] = towFrom("s" + i, x, y, 2.6, hd);
        d.position.set(bx, map.h(bx, by) + 0.02, -by); d.rotation.set(0, syaw, 0); d.scale.setScalar(1); d.updateMatrix(); sledges.setMatrixAt(ns++, d.matrix);
        for (const z of [-0.4, 0.4]) { const rx = bx + Math.cos(syaw) * 1.25 + Math.sin(syaw) * z, ry = by + Math.sin(syaw) * 1.25 - Math.cos(syaw) * z, hx = x - Math.cos(hd) * 0.15, hy = y - Math.sin(hd) * 0.15;
          const L2 = Math.hypot(hx - rx, hy - ry), h1 = map.h(rx, ry) + 0.25, h2 = map.h(hx, hy) + 0.95;
          d.position.set(rx, h1, -ry); d.rotation.set(0, Math.atan2(hy - ry, hx - rx), Math.atan2(h2 - h1, L2)); d.scale.set(Math.hypot(L2, h2 - h1), 1, 1); d.updateMatrix(); ropes.setMatrixAt(nr++, d.matrix); }
      } else if (kind === "tub" && nt < 200) {
        const bx = x + Math.cos(hd) * 1.05, by = y + Math.sin(hd) * 1.05;
        d.position.set(bx, map.h(bx, by), -by); d.rotation.set(0, hd, 0); d.scale.setScalar(1); d.updateMatrix(); tubs.setMatrixAt(nt++, d.matrix);
      }
    }
    sledges.count = ns; tubs.count = nt; ropes.count = nr; for (const m of [sledges, tubs, ropes]) m.instanceMatrix.needsUpdate = true;
    // ---- town life near the camera: buckets on the wells, hens in the yards, dogs about, children by the well
    let nbk = 0, nh = 0, nd = 0; const nk = kids.map(() => 0);
    for (const it of wellsC) {
      if (!near(it.x, it.y, 320)) continue;
      let busy = null; for (const i of drawers) if (Math.hypot(w.S.x[i] - it.x, w.S.y[i] - it.y) < 3) { busy = i; break; }
      const M = busy !== null ? L.men.get(busy) : null, ph = M ? ((w.time - M.t0) / Math.max(1, M.dur)) : 0;
      const depth = M ? (ph < 0.5 ? ph * 2 : 2 - ph * 2) * 1.2 : 0;   // let down and wound up again
      d.position.set(it.x, map.h(it.x, it.y) + 1.5 - depth * 0.9, -it.y); d.rotation.set(0, 0, 0); d.scale.set(1, 0.05 + depth, 1); d.updateMatrix(); buckets.setMatrixAt(nbk++, d.matrix);
      // children playing about the well: a ring-chase, now and then a pause
      for (let c = 0; c < 5; c++) {
        const K = kids[(c + it.id) % kids.length], n = (c + it.id) % kids.length; if (nk[n] >= 30) continue;
        const sp = 1.3 + 0.5 * hsh(it.id, c), R = 4.5 + 2.5 * hsh(it.id, c + 9), a0 = hsh(it.id, c + 20) * 6.283, run = Math.sin(t * 0.21 + c * 1.7) > -0.4, dir = c % 2 ? 1 : -1;
        const a = a0 + (run ? t * sp / R : Math.floor(t * 0.21 / 6.283) * 2) * dir, x = it.x + Math.cos(a) * R, y = it.y + Math.sin(a) * R;
        const bob = run ? Math.abs(Math.sin(t * 9 + c)) * 0.09 : 0;
        d.position.set(x, map.h(x, y) + bob, -y); d.rotation.set(0, a + dir * Math.PI / 2 + (run ? 0 : 1.9), run ? -0.12 : 0); d.scale.setScalar(0.95 + 0.15 * hsh(c, it.id)); d.updateMatrix();
        K.setMatrixAt(nk[n]++, d.matrix);
      }
    }
    for (const b of houses) {
      if (!near(b.x, b.y, 260)) continue;
      const fp = BUILDINGS.house?.footprint || [8, 6], c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
      const yx = b.x - s * (fp[1] / 2 + 3.2) + c * 1.5, yy = b.y + c * (fp[1] / 2 + 3.2) + s * 1.5;   // the yard beside the door
      const nH = 2 + Math.floor(hsh(b.id, 2) * 3);
      for (let k = 0; k < nH && nh < 240; k++) {
        const sd = b.id * 7 + k, v = 0.12 + 0.05 * hsh(sd, 1), ph = t * v + hsh(sd, 2) * 6.283;
        const x = yx + Math.cos(ph) * 1.6 + Math.sin(ph * 2.3) * 0.7, y = yy + Math.sin(ph * 1.3) * 1.3;
        const dx = -Math.sin(ph) * 1.6 + Math.cos(ph * 2.3) * 1.61, dy = Math.cos(ph * 1.3) * 1.69, peck = Math.max(0, Math.sin(t * 5 + sd)) ** 6;
        d.position.set(x, map.h(x, y), -y); d.rotation.set(0, Math.atan2(dy, dx), -peck * 0.7); d.scale.setScalar(1); d.updateMatrix();
        hens.setMatrixAt(nh, d.matrix); tmpC.set(hsh(sd, 4) < 0.4 ? "#b07040" : hsh(sd, 4) < 0.55 ? "#4a4038" : "#ffffff"); hens.instanceColor.setXYZ(nh, tmpC.r, tmpC.g, tmpC.b); nh++;
      }
    }
    // dogs: each trots a loop between three houses' yards, stopping to sniff at each
    for (let k = 0; k * 4 < houses.length && nd < 40; k++) {
      const loop = [0, 1, 2].map((j) => houses[(k * 4 + j * 3 + 1) % houses.length]); if (!near(loop[0].x, loop[0].y, 280)) continue;
      const pts = loop.map((b) => { const fp = BUILDINGS.house?.footprint || [8, 6], c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0); return [b.x - s * (fp[1] / 2 + 5), b.y + c * (fp[1] / 2 + 5)]; });
      const lens = pts.map((p, j) => Math.hypot(pts[(j + 1) % 3][0] - p[0], pts[(j + 1) % 3][1] - p[1]) + 6), tot = lens.reduce((a, b) => a + b, 0);
      if (!(tot > 18)) continue;
      let u = (t * 1.7 + hsh(k, 3) * tot) % tot, j = 0; while (j < 2 && u > lens[j]) { u -= lens[j]; j++; }
      const A = pts[j], Bp = pts[(j + 1) % 3], seg = lens[j] - 6, f = Math.min(1, u / Math.max(seg, 1e-3)), trot = u < seg;
      const x = A[0] + (Bp[0] - A[0]) * f, y = A[1] + (Bp[1] - A[1]) * f, hd = Math.atan2(Bp[1] - A[1], Bp[0] - A[0]);
      d.position.set(x, map.h(x, y) + (trot ? Math.abs(Math.sin(t * 11 + k)) * 0.05 : 0), -y); d.rotation.set(0, hd + (trot ? 0 : Math.sin(t * 0.8 + k)), trot ? 0 : -0.25); d.scale.setScalar(1); d.updateMatrix(); dogs.setMatrixAt(nd++, d.matrix);
    }
    buckets.count = nbk; hens.count = nh; dogs.count = nd; kids.forEach((K, n) => { K.count = nk[n]; K.instanceMatrix.needsUpdate = true; });
    for (const m of [buckets, hens, dogs]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
  // ---- the slow part (a few times a second): the workings, the buildings' smoke, the town's houses and wells
  function slow(w, L, seen, near, t) {
    for (const S of sites.values()) S.live = false;
    const emit = []; let nb = 0; wellsC = [];
    if (L) for (const it of L.items) {
      if (it.kind !== "works" && it.kind !== "well") continue;
      if (!seen(it.x, it.y, it.team) && !(it.kind === "works" && w.veins)) continue; // (the realm's mines and quarries are landmarks: drawn in or out of sight — js/sim/veins.js)
      if (it.kind === "well") { wellsC.push(it); site(`well${it.id}`, "w", () => mesh(wellGeo(), mat, it.x, it.y, map.h(it.x, it.y))); continue; }
      const { style, cut } = worksInfo(it), offs = (it.st || "").split(":")[2] || 0;
      clearFor(it, style);
      if (style === "quarry") {
        let sig = `q|${it.rot.toFixed(3)}|${offs}|`; for (let l = 0; l < Q.NL; l++) for (let i = 0; i < Q.NC; i++) sig += faceOff(cut, i, l) + ",";
        sig += Math.round(depthOf("quarry", cut) * 8);
        if (findTerr()) site(`w${it.id}`, sig, () => { const Qg = quarryGeo(map, it, cut), g = new THREE.Group(); g.add(mesh(Qg.face, rockMat, it.x, it.y)); g.add(mesh(Qg.rock, mat, it.x, it.y)); g.add(groundMesh(Qg.ground, it)); g.add(mesh(quarryFloor(map, it, cut), floorMat, it.x, it.y)); return g; });
        else if (sites.has(`w${it.id}`)) sites.get(`w${it.id}`).live = true;
        // the cut blocks at the face foot, waiting for the sledge
        const P = frame(it), row = Q.NC - 4;
        for (let k = 0; k < it.n && nb < 600; k++) {
          const i = 2 + (k * 5) % row, lay = Math.floor(k / row), a = (i - (Q.NC - 1) / 2) * Q.BS + (hsh(k, 3) - 0.5) * 0.5, b = Q.F0 - faceOff(cut, i) + 1.9 + (lay % 2) * 0.8 + hsh(k, 5) * 0.3;
          const [x, y] = P(a, b); d.position.set(x, map.h(x, y) + (lay >= 2 ? 0.55 : 0), -y); d.rotation.set(0, it.rot + (hsh(k, 9) - 0.5) * 0.5, 0); d.scale.setScalar(1); d.updateMatrix(); blocks.setMatrixAt(nb++, d.matrix);
        }
        if (it.act === undefined || w.time - it.act < 60) { const [x, y] = P(0, Q.F0 - faceOff(cut, Q.NC >> 1) + 1); emit.push({ kind: "dust", x, y, h: map.h(x, y) + 0.8, k: it.id * 7 + 1, jx: Q.NC * Q.BS * 0.6 }); }
      } else if (style === "adit") {
        if (findTerr()) site(`w${it.id}`, `a|${Math.round(depthOf("adit", cut) * 10)}|${it.rot.toFixed(3)}|${offs}`, () => { const A = aditGeo(map, it, cut), g = new THREE.Group(); g.add(mesh(A.rock, mat, it.x, it.y)); g.add(mesh(aditFaceGeo(map, it), rockFaceMat, it.x, it.y)); g.add(groundMesh(A.ground, it)); return g; });
      } else {
        site(`w${it.id}`, `p|${pitsOpen(cut)}|${it.rot.toFixed(3)}|${offs}`, () => mesh(pitsGeo(map, it, cut), mat, it.x, it.y));
        if (it.res !== "clay") { const [x, y] = hearthOf(it); emit.push({ kind: "hearth", x, y, h: map.h(x, y) + 0.4, k: it.id * 7 + 2, jx: 1 }); emit.push({ kind: "glow", x, y, h: map.h(x, y) + 0.35, k: it.id * 7 + 3, a: 0.5 }); }
      }
    }
    blocks.count = nb; blocks.instanceMatrix.needsUpdate = true;
    // buildings: the clamp and the bloomery (no model of their own yet), chimneys and forges
    houses = [];
    for (const b of w.buildings || []) {
      if (b.field || b.x1 !== undefined || !seen(b.x, b.y, b.team)) continue;
      const done = b.progress >= 1 && !b.ruin, h0 = map.h(b.x, b.y), c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
      const at = (lx, ly) => [b.x + lx * c - ly * s, b.y + lx * s + ly * c];
      if (OWN_MODEL.has(b.kind) && b.progress >= 0.34) {
        if (!cleared.has(`b${b.id}`)) { const props = globalThis.HG?.props; if (props) { cleared.add(`b${b.id}`); props.clearArea((x, y) => Math.hypot(x - b.x, y - b.y) < 10); } }
        site(`b${b.id}`, `${b.kind}|${done}|${b.ruin ? 1 : 0}`, () => { const o = mesh(b.kind === "bloomery" ? bloomeryGeo() : clampGeo(), mat, b.x, b.y, h0, b.rot || 0); if (!done) o.scale.set(1, 0.5, 1); return o; });
        if (done && !(b.fire > 0)) {
          if (b.kind === "charcoal_kiln") for (let v = 0; v < 3; v++) { const [x, y] = at(Math.cos(v * 2.1) * 1.5, Math.sin(v * 2.1) * 1.5); emit.push({ kind: "clamp", x, y, h: h0 + 1.7, k: b.id * 5 + v, jx: 0.5, mul: v ? 0.6 : 1 }); }
          else { emit.push({ kind: "forge", x: b.x, y: b.y, h: h0 + 2.2, k: b.id * 5 }); emit.push({ kind: "sparks", x: b.x, y: b.y, h: h0 + 2.2, k: b.id * 5 + 1 }); const [gx, gy] = at(1.05, 0); emit.push({ kind: "glow", x: gx, y: gy, h: h0 + 0.35, k: b.id * 5 + 2 }); }
        }
        continue;
      }
      if (!done || b.fire > 0) continue;
      const flue = FLUE[b.kind === "house" ? `house${b.id % 3}` : b.kind];
      if (flue) { const [x, y] = at(flue[0], flue[1]); emit.push({ kind: flue[3], x, y, h: h0 - 0.15 + flue[2], k: b.id * 5 + 3, mul: 0.6 + 0.6 * hsh(b.id, 1) });
        if (flue[3] === "forge") emit.push({ kind: "sparks", x, y, h: h0 + flue[2] - 0.2, k: b.id * 5 + 1, mul: 0.6 }); }
      if (b.kind === "house") houses.push(b);
    }
    for (const [k, S] of sites) if (!S.live) { group.remove(S.obj); S.obj.traverse((o) => o.geometry?.dispose()); sites.delete(k); }
    const ek = emit.map((e) => `${e.kind}${e.k}${Math.round(e.x)},${Math.round(e.y)}`).join("|");
    if (ek !== emitKey) { emitKey = ek; smoke.set(emit); glow.set(emit); }
  }
  return { update };
}
