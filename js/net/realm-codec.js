// The Realm's binary frames (docs/realm-protocol.md): soldiers (kind 1) and fog (kind 2). Pure JS, no DOM: the
// server (server/views.mjs) writes frames with the write* helpers, the browser reads them with decode*/apply*.
// Little-endian throughout.
export const PROTO = 2; // (2: the big world — positions are 24-bit steps of QSCALE m from the map's SW corner (ox, oy), which
//  every soldier frame and fog frame carries: docs/big-world.md)
export const K_SOLDIERS = 1, K_FOG = 2;
export const HDR = 48, REC_STATIC = 24, REC_DYN = 34, REC_MOVE = 8, REC_GONE = 4;
export const QSCALE = 1 / 256, QMAX = 0xffffff; // m per position unit (4 mm), the largest position (65 km)
export const MOVE_UNIT = 32; // a move record's dx/dy step, in position units (0.125 m: ±15.9 m per record)
// the position a man is sent at, relative to the map's corner
export const qPos = (v, o) => Math.max(0, Math.min(QMAX, Math.round((v - o) / QSCALE)));
export const F_COMPLETE = 1;
export const TIMER_NONE = -32768;
const TAU = Math.PI * 2;

export const qFacing = (f) => Math.round(f * 256 / TAU) & 255;
export const unFacing = (b) => b * TAU / 256;
export const qVel = (v) => Math.max(-127, Math.min(127, Math.round(v * 10)));
const qTimer = (t, now) => { if (!(t > 0)) return TIMER_NONE; const v = Math.round((t - now) * 100); return v < -32767 ? TIMER_NONE : v > 32767 ? 32767 : v; };
const u8 = (v) => Math.max(0, Math.min(255, v | 0));

export function soldierFrameSize(nStatic, nDyn, nMove, nGone) { return HDR + nStatic * REC_STATIC + nDyn * REC_DYN + nMove * REC_MOVE + nGone * REC_GONE; }

export function writeHeader(dv, { complete = false, tick, time, nStatic, nDyn, nMove, nGone, scale, sN, ox = 0, oy = 0 }) {
  dv.setUint8(0, K_SOLDIERS); dv.setUint8(1, PROTO); dv.setUint16(2, complete ? F_COMPLETE : 0, true);
  dv.setUint32(4, tick >>> 0, true); dv.setFloat64(8, time, true);
  dv.setUint32(16, nStatic, true); dv.setUint32(20, nDyn, true); dv.setUint32(24, nMove, true); dv.setUint32(28, nGone, true);
  dv.setFloat32(32, scale, true); dv.setUint32(36, sN, true); dv.setFloat32(40, ox, true); dv.setFloat32(44, oy, true);
  return HDR;
}
// who he is (rarely changes)
export function writeStatic(dv, o, S, i) {
  dv.setUint32(o, i, true); dv.setUint32(o + 4, S.name[i] >>> 0, true); dv.setUint32(o + 8, S.kitMask[i] >>> 0, true);
  dv.setUint8(o + 12, S.team[i]); dv.setUint8(o + 13, S.arm[i]); dv.setUint8(o + 14, S.weapon[i]); dv.setUint8(o + 15, S.shield[i]);
  dv.setUint8(o + 16, S.horse[i]); dv.setUint8(o + 17, S.kit[i]); dv.setUint8(o + 18, S.legend[i]); dv.setUint8(o + 19, S.pavise[i]);
  dv.setUint8(o + 20, S.armour[i]); dv.setUint8(o + 21, S.side[i]); dv.setUint8(o + 22, S.missile[i]); dv.setUint8(o + 23, 0);
  return o + REC_STATIC;
}
export function dynFlags(S, i) {
  return (S.alive[i] ? 1 : 0) | (S.horseOK[i] ? 2 : 0) | (S.shieldArm[i] ? 4 : 0) | ((S.posture[i] & 3) << 3) | (S.hid?.[i] ? 32 : 0);
}
// where he is, and what changes slowly. qx, qy: the quantized position the client will now hold.
export function writeDyn(dv, o, S, i, now, qx, qy) {
  dv.setUint32(o, i, true); dv.setUint32(o + 4, S.unit[i] >>> 0, true); dv.setInt32(o + 8, S.foe[i] | 0, true);
  dv.setUint16(o + 12, qx & 0xffff, true); dv.setUint16(o + 14, qy & 0xffff, true); dv.setUint8(o + 32, qx >>> 16); dv.setUint8(o + 33, qy >>> 16); dv.setUint8(o + 16, qFacing(S.facing[i])); dv.setUint8(o + 17, S.state[i]);
  dv.setUint8(o + 18, dynFlags(S, i)); dv.setUint8(o + 19, S.lvl[i]); dv.setInt8(o + 20, qVel(S.vx[i])); dv.setInt8(o + 21, qVel(S.vy[i]));
  dv.setUint8(o + 22, S.status[i]); dv.setUint8(o + 23, u8(S.fatigue[i] * 255));
  dv.setInt16(o + 24, qTimer(S.nextAtk[i], now), true); dv.setInt16(o + 26, qTimer(S.nextShot[i], now), true); dv.setInt16(o + 28, qTimer(S.busyT[i], now), true);
  dv.setUint8(o + 30, S.rank[i]); dv.setUint8(o + 31, u8(S.kills[i]));
  return o + REC_DYN;
}
export function writeMove(dv, o, i, dx, dy, facing, state, vx, vy) {
  dv.setUint16(o, i, true); dv.setInt8(o + 2, dx); dv.setInt8(o + 3, dy); dv.setUint8(o + 4, facing); dv.setUint8(o + 5, state);
  dv.setInt8(o + 6, vx); dv.setInt8(o + 7, vy);
  return o + REC_MOVE;
}
export function writeGone(dv, o, i) { dv.setUint32(o, i, true); return o + REC_GONE; }

// ---- reading
export function frameKind(buf) { return new Uint8Array(buf.buffer || buf, buf.byteOffset || 0, 1)[0]; }
function view(buf) { return buf instanceof DataView ? buf : ArrayBuffer.isView(buf) ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength) : new DataView(buf); }

// decode a soldier frame into plain records (for tests and simple clients; see applySoldiers for the fast path)
export function decodeSoldiers(buf) {
  const dv = view(buf);
  if (dv.getUint8(0) !== K_SOLDIERS) throw new Error("not a soldier frame");
  const h = { version: dv.getUint8(1), complete: !!(dv.getUint16(2, true) & F_COMPLETE), tick: dv.getUint32(4, true), time: dv.getFloat64(8, true),
    nStatic: dv.getUint32(16, true), nDyn: dv.getUint32(20, true), nMove: dv.getUint32(24, true), nGone: dv.getUint32(28, true), scale: dv.getFloat32(32, true), sN: dv.getUint32(36, true), ox: dv.getFloat32(40, true), oy: dv.getFloat32(44, true) };
  let o = HDR; const statics = [], dyns = [], moves = [], gones = [];
  for (let k = 0; k < h.nStatic; k++, o += REC_STATIC) statics.push({ id: dv.getUint32(o, true), name: dv.getUint32(o + 4, true), kitMask: dv.getUint32(o + 8, true), team: dv.getUint8(o + 12), arm: dv.getUint8(o + 13), weapon: dv.getUint8(o + 14), shield: dv.getUint8(o + 15), horse: dv.getUint8(o + 16), kit: dv.getUint8(o + 17), legend: dv.getUint8(o + 18), pavise: dv.getUint8(o + 19), armour: dv.getUint8(o + 20), side: dv.getUint8(o + 21), missile: dv.getUint8(o + 22) });
  for (let k = 0; k < h.nDyn; k++, o += REC_DYN) {
    const fl = dv.getUint8(o + 18), tm = (v) => v === TIMER_NONE ? 0 : h.time + v / 100;
    dyns.push({ id: dv.getUint32(o, true), unit: dv.getUint32(o + 4, true), foe: dv.getInt32(o + 8, true), qx: dv.getUint16(o + 12, true) | (dv.getUint8(o + 32) << 16), qy: dv.getUint16(o + 14, true) | (dv.getUint8(o + 33) << 16),
      facing: unFacing(dv.getUint8(o + 16)), state: dv.getUint8(o + 17), alive: fl & 1, horseOK: (fl >> 1) & 1, shieldArm: (fl >> 2) & 1, posture: (fl >> 3) & 3, hid: (fl >> 5) & 1,
      lvl: dv.getUint8(o + 19), vx: dv.getInt8(o + 20) / 10, vy: dv.getInt8(o + 21) / 10, status: dv.getUint8(o + 22), fatigue: dv.getUint8(o + 23) / 255,
      nextAtk: tm(dv.getInt16(o + 24, true)), nextShot: tm(dv.getInt16(o + 26, true)), busyT: tm(dv.getInt16(o + 28, true)), rank: dv.getUint8(o + 30), kills: dv.getUint8(o + 31) });
  }
  for (let k = 0; k < h.nMove; k++, o += REC_MOVE) moves.push({ id: dv.getUint16(o, true), dx: dv.getInt8(o + 2), dy: dv.getInt8(o + 3), facing: unFacing(dv.getUint8(o + 4)), state: dv.getUint8(o + 5), vx: dv.getInt8(o + 6) / 10, vy: dv.getInt8(o + 7) / 10 });
  for (let k = 0; k < h.nGone; k++, o += REC_GONE) gones.push(dv.getUint32(o, true));
  return { ...h, statics, dyns, moves, gones };
}

// A mirror of the server's soldiers for one client: struct-of-arrays like w.S (x, y, facing, state, alive, team, arm,
// unit, … as the renderer reads them) plus `has` (1 = in the client's view) and the held quantized positions.
const MIRROR_F32 = ["x", "y", "vx", "vy", "facing", "fatigue", "nextAtk", "nextShot", "busyT"];
const MIRROR_I32 = ["unit", "foe", "name", "kitMask", "kills"];
const MIRROR_U8 = ["team", "arm", "weapon", "shield", "horse", "kit", "legend", "pavise", "armour", "side", "missile", "state", "alive", "horseOK", "shieldArm", "posture", "hid", "lvl", "status", "rank", "has"];
export function makeMirror(cap = 4096) {
  const M = { n: 0, cap, scale: 1, ox: 0, oy: 0 };
  for (const f of MIRROR_F32) M[f] = new Float32Array(cap);
  for (const f of MIRROR_I32) M[f] = new Int32Array(cap);
  for (const f of MIRROR_U8) M[f] = new Uint8Array(cap);
  M.qx = new Uint32Array(cap); M.qy = new Uint32Array(cap);
  return M;
}
function growMirror(M, need) {
  let cap = M.cap; while (cap < need) cap *= 2; if (cap === M.cap) return;
  for (const k of [...MIRROR_F32, ...MIRROR_I32, ...MIRROR_U8, "qx", "qy"]) { const a = new M[k].constructor(cap); a.set(M[k]); M[k] = a; }
  M.cap = cap;
}
// apply a soldier frame to a mirror; returns the decoded header (tick, time, complete)
export function applySoldiers(M, buf) {
  const F = decodeSoldiers(buf);
  growMirror(M, Math.max(F.sN, 1)); M.n = Math.max(M.n, F.sN); M.scale = F.scale; M.ox = F.ox; M.oy = F.oy;
  if (F.complete) M.has.fill(0);
  const s = F.scale;
  for (const r of F.statics) { const i = r.id; growMirror(M, i + 1); for (const k of ["name", "kitMask", "team", "arm", "weapon", "shield", "horse", "kit", "legend", "pavise", "armour", "side", "missile"]) M[k][i] = r[k]; }
  for (const r of F.dyns) {
    const i = r.id; growMirror(M, i + 1); M.has[i] = 1; M.qx[i] = r.qx; M.qy[i] = r.qy; M.x[i] = F.ox + r.qx * s; M.y[i] = F.oy + r.qy * s;
    for (const k of ["unit", "foe", "facing", "state", "alive", "horseOK", "shieldArm", "posture", "hid", "lvl", "vx", "vy", "status", "fatigue", "nextAtk", "nextShot", "busyT", "rank", "kills"]) M[k][i] = r[k];
  }
  for (const r of F.moves) {
    const i = r.id; M.qx[i] += r.dx * MOVE_UNIT; M.qy[i] += r.dy * MOVE_UNIT; M.x[i] = F.ox + M.qx[i] * s; M.y[i] = F.oy + M.qy[i] * s;
    M.facing[i] = r.facing; M.state[i] = r.state; M.vx[i] = r.vx; M.vy[i] = r.vy;
  }
  for (const i of F.gones) if (i < M.cap) M.has[i] = 0;
  return F;
}

// ---- fog (kind 2): the n×n team sight grid, run-length coded
export function encodeFog(grid, n, cellM, tick, ox = 0, oy = 0) {
  const runs = [];
  for (let k = 0; k < grid.length;) { const v = grid[k]; let r = 1; while (k + r < grid.length && grid[k + r] === v && r < 65535) r++; runs.push(v, r); k += r; }
  const buf = new ArrayBuffer(24 + runs.length / 2 * 4), dv = new DataView(buf);
  dv.setUint8(0, K_FOG); dv.setUint8(1, PROTO); dv.setUint16(2, n, true); dv.setUint32(4, tick >>> 0, true); dv.setFloat32(8, cellM, true); dv.setUint32(12, runs.length / 2, true);
  dv.setFloat32(16, ox, true); dv.setFloat32(20, oy, true); // (the grid's SW corner: the map's)
  for (let j = 0, o = 24; j < runs.length; j += 2, o += 4) { dv.setUint8(o, runs[j]); dv.setUint16(o + 2, runs[j + 1], true); }
  return buf;
}
export function decodeFog(buf, out = null) {
  const dv = view(buf);
  if (dv.getUint8(0) !== K_FOG) throw new Error("not a fog frame");
  const n = dv.getUint16(2, true), nRuns = dv.getUint32(12, true), grid = out && out.length === n * n ? out : new Uint8Array(n * n);
  let k = 0;
  for (let j = 0, o = 24; j < nRuns; j++, o += 4) { const v = dv.getUint8(o), r = dv.getUint16(o + 2, true); grid.fill(v, k, k + r); k += r; }
  return { n, tick: dv.getUint32(4, true), cellM: dv.getFloat32(8, true), ox: dv.getFloat32(16, true), oy: dv.getFloat32(20, true), grid };
}
