// A CASTLE'S MASONRY, AS A MAN ON THE GROUND MEETS IT (castle-plan §1; the shapes follow CASTLE-ART's kit,
// assets/castle-kit.json, which is what is drawn). The owner: "men in the masonry" — a company at the wall foot stood
// half inside a tower's base. The castle's 1 m grid only knew the walls' centre lines (a curtain 2.7 m thick, cell
// centres), not the battered plinth that spreads 0.5–0.7 m out at a wall's foot and a tower's, the gatehouse's stair
// turrets behind it, the keep's forebuilding or a hall's porch; and the men of a body walked by world.js (not by
// castle.js) did not know the castle at all.
//
// Level 0 only: a man on a wall-walk, a tower floor or a stair is ON the masonry (castle.js keeps him there).
//   buildMasonry(w, C)        → C._.mas: the solid footprints of every standing part, indexed on a 2 m grid (castle.js
//                                builds it with its ground grid, and re-builds it when a module is breached, a tower
//                                falls or a postern opens)
//   masonryAt(C, x, y, pad)   → the shape (x, y) is inside (grown by pad m), or null
//   castleSolid(w, x, y, pad) → true when (x, y) is in any castle's masonry (world.js: slots and steering)
//   wallBetween(w, ax, ay, bx, by) → true when a standing curtain lies across the line (world.js: a slot moved out of
//                                the masonry stays on its body's side of the wall)
//   pushOut(C, x, y, px, py, rx, ry, out) → out = [x, y] outside the masonry by a body's width (castleSystem's last
//                                word): out of a curtain on the side the man came from (px, py), else on the side his
//                                body stands (rx, ry: its anchor — the bailey for a garrison inside, the field for
//                                stormers), out of the rest by the nearest face
//   stampMasonry(mas, G, cell, pad) the same footprints made solid on castle.js's 1 m ground grid (its paths, its regions)
// Shapes: seg (a curtain: its line, half-thicknesses in/out, gaps along it — breached modules, an open postern) ·
// circ (a tower's foot, the well; `clip` keeps a gatehouse front's half-round out of the passage) · rect (local a/b box).

export const BODY = 0.25;        // m: a man's half-width (his shoulders stop there, not his centre)
const PLINTH = (walkH) => walkH >= 9.5 ? 0.7 : walkH < 7 ? 0.5 : 0.6; // the battered base's spread (kit dims WALLS.*.plinth_out)
const TOWER_FOOT = 6.2 / 5.5;    // a round tower's foot radius / its radius (kit r_foot)
const GATE_PLINTH = 0.7, KEEP_PLINTH = 0.8, HOUSE_PAD = 0.3;
const MC = 2, PADMAX = 1.6;      // index cell (m); the largest pad a query may ask for

export function buildMasonry(w, C) {
  const bOf = (id) => id === undefined ? null : w.buildings.find((b) => b.id === id);
  const sh = [];
  const rect = (x, y, rot, a0, a1, b0, b1, part) => sh.push({ t: 2, x, y, c: Math.cos(rot), s: Math.sin(rot), a0, a1, b0, b1, part });
  const circ = (x, y, r, part, clip) => sh.push({ t: 1, x, y, r, part, clip });
  const ringCen = new Map(C.rings.map((r) => [r.id, r.poly.reduce((s, p) => [s[0] + p[0] / r.poly.length, s[1] + p[1] / r.poly.length], [0, 0])]));
  for (const p of C.parts) {
    if (p.kind === "curtain") {
      const b = bOf(p.bid); if (b && b.ruin) continue;
      const dx = p.x1 - p.x0, dy = p.y1 - p.y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, cen = ringCen.get(p.ring) || [C.x, C.y];
      let nx = uy, ny = -ux; if ((p.x0 - cen[0]) * nx + (p.y0 - cen[1]) * ny < 0) { nx = -nx; ny = -ny; } // outward
      const gaps = [];
      if (b?.mods && b.x1 !== undefined) { // breached modules: their rubble is walked over (siege.js breach links)
        const bx = b.x2 - b.x1, by = b.y2 - b.y1, nm = b.mods.length;
        for (let k = 0; k < nm; k++) if (b.mods[k] <= 0) {
          const t0 = (b.x1 + bx * k / nm - p.x0) * ux + (b.y1 + by * k / nm - p.y0) * uy, t1 = (b.x1 + bx * (k + 1) / nm - p.x0) * ux + (b.y1 + by * (k + 1) / nm - p.y0) * uy;
          gaps.push([Math.min(t0, t1), Math.max(t0, t1)]);
        }
      }
      for (const q of C.posterns || []) if (q.curtain === p.id && q.open) { const t = (q.x - p.x0) * ux + (q.y - p.y0) * uy; gaps.push([t - 0.8, t + 0.8]); }
      sh.push({ t: 0, ax: p.x0, ay: p.y0, ux, uy, L, nx, ny, hin: p.th / 2, hout: p.th / 2 + PLINTH(p.walkH || 8), gaps, part: p });
    } else if (p.kind === "tower") {
      const b = bOf(p.bid); if (b && b.ruin) continue; // (a fallen tower is a heap of rubble men climb over)
      circ(p.x, p.y, p.r * TOWER_FOOT, p);
    } else if (p.kind === "gatehouse") {
      const b = bOf(p.bid); if (b && b.ruin) continue;
      const hw = p.w / 2, pw = p.pw, R = p.R, b0 = p.b0, b1 = p.b1, sw = p.w / 17, sd = p.d / 15, c = Math.cos(p.rot), s = Math.sin(p.rot);
      const G = (a, bb) => [p.x + a * c - bb * s, p.y + a * s + bb * c];
      for (const sg of [-1, 1]) {
        // the flanking tower: its back block, its half-round front (plinth, but never into the passage), its stair turret
        rect(p.x, p.y, p.rot, sg > 0 ? pw : -(hw + GATE_PLINTH), sg > 0 ? hw + GATE_PLINTH : -pw, b0, b1 - R, p);
        const fc = G(sg * (pw + R), b1 - R); circ(fc[0], fc[1], R + GATE_PLINTH, p, { nx: sg * c, ny: sg * s, d: -R });
        rect(p.x, p.y, p.rot, sg > 0 ? 5.0 * sw : -7.6 * sw, sg > 0 ? 7.6 * sw : -5.0 * sw, -8.8 * sd, b0 + 0.1, p);
      }
    } else if (p.kind === "keep") {
      const hw = p.w / 2, hd = p.d / 2;
      rect(p.x, p.y, p.rot, -hw - KEEP_PLINTH, hw + KEEP_PLINTH, -hd - KEEP_PLINTH, hd + KEEP_PLINTH, p);
      if (p.fore) { // the forebuilding stair up the bailey face (castle.js castleFromLayout: the same face, the same run)
        const c = Math.cos(p.rot), s = Math.sin(p.rot), bx = (C.bailey.x - p.x) * c + (C.bailey.y - p.y) * s, by = -(C.bailey.x - p.x) * s + (C.bailey.y - p.y) * c;
        const side = Math.abs(bx) > Math.abs(by) ? (bx > 0 ? 1 : 3) : (by > 0 ? 2 : 0), along = side % 2 === 0, sg = side === 0 || side === 3 ? -1 : 1, half = along ? hw : hd;
        const F1 = p.floors[1], run = Math.max(3, (F1 - 0.2) / 0.2 * 0.3), u0 = -half + 1.2, u1 = u0 + run, doorU = Math.min(half - 2, u1 + 1.6);
        const U0 = u0 - 0.3, U1 = doorU + 1.4, V0 = (along ? hd : hw), V1 = V0 + 3.6;
        if (along) rect(p.x, p.y, p.rot, U0, U1, sg > 0 ? V0 : -V1, sg > 0 ? V1 : -V0, p);
        else rect(p.x, p.y, p.rot, sg > 0 ? V0 : -V1, sg > 0 ? V1 : -V0, U0, U1, p);
      }
    } else if (p.kind === "hall" || p.kind === "chapel" || p.kind === "stable" || p.kind === "kitchen") {
      const hw = p.w / 2 + HOUSE_PAD, hd = p.d / 2 + HOUSE_PAD;
      rect(p.x, p.y, p.rot || 0, -hw, hw, -hd, hd, p);
      if (p.kind === "hall") { const sw = p.w / 18, sd = p.d / 9; rect(p.x, p.y, p.rot || 0, (-6.75 - 1.8) * sw, (-6.75 + 1.8) * sw, -7.9 * sd, -hd + 0.1, p); } // the porch (kit: west bay, −y)
    } else if (p.kind === "well") circ(p.x, p.y, (p.r || 1.2) + 0.1, p);
  }
  // the index: each 2 m cell → the shapes whose box (grown by PADMAX) touches it
  const [x0, y0, x1, y1] = C._.bbox, nx = Math.max(1, Math.ceil((x1 - x0) / MC)), ny = Math.max(1, Math.ceil((y1 - y0) / MC)), idx = new Array(nx * ny).fill(null);
  sh.forEach((q, k) => {
    let bx0, by0, bx1, by1;
    if (q.t === 0) { const h = Math.max(q.hin, q.hout) + PADMAX, ex = [q.ax, q.ax + q.ux * q.L], ey = [q.ay, q.ay + q.uy * q.L]; bx0 = Math.min(...ex) - h; bx1 = Math.max(...ex) + h; by0 = Math.min(...ey) - h; by1 = Math.max(...ey) + h; }
    else if (q.t === 1) { const h = q.r + PADMAX; bx0 = q.x - h; bx1 = q.x + h; by0 = q.y - h; by1 = q.y + h; }
    else { const h = Math.hypot(Math.max(-q.a0, q.a1), Math.max(-q.b0, q.b1)) + PADMAX; bx0 = q.x - h; bx1 = q.x + h; by0 = q.y - h; by1 = q.y + h; }
    for (let j = Math.max(0, Math.floor((by0 - y0) / MC)); j <= Math.min(ny - 1, Math.floor((by1 - y0) / MC)); j++)
      for (let i = Math.max(0, Math.floor((bx0 - x0) / MC)); i <= Math.min(nx - 1, Math.floor((bx1 - x0) / MC)); i++) (idx[j * nx + i] ||= []).push(k);
  });
  return { sh, idx, x0, y0, nx, ny, segs: sh.filter((q) => q.t === 0) };
}

// signed depth of (x, y) inside shape q grown by pad: > 0 inside (how far to the nearest way out), ≤ 0 outside
function depth(q, x, y, pad) {
  if (q.t === 0) {
    const dx = x - q.ax, dy = y - q.ay, t = dx * q.ux + dy * q.uy; if (t < -pad || t > q.L + pad) return 0;
    for (const [g0, g1] of q.gaps) if (t > g0 + pad && t < g1 - pad) return 0;
    const s = dx * q.nx + dy * q.ny; return Math.min(s + q.hin + pad, q.hout + pad - s);
  }
  if (q.t === 1) {
    const dx = x - q.x, dy = y - q.y, r = Math.hypot(dx, dy), d = q.r + pad - r; if (d <= 0) return 0;
    if (q.clip) { const e = dx * q.clip.nx + dy * q.clip.ny - q.clip.d + pad; if (e <= 0) return 0; return Math.min(d, e); }
    return d;
  }
  const dx = x - q.x, dy = y - q.y, a = dx * q.c + dy * q.s, b = -dx * q.s + dy * q.c;
  return Math.min(a - q.a0 + pad, q.a1 + pad - a, b - q.b0 + pad, q.b1 + pad - b);
}
export function masonryAt(C, x, y, pad = 0) {
  const M = C._.mas; if (!M) return null;
  const i = Math.floor((x - M.x0) / MC), j = Math.floor((y - M.y0) / MC); if (i < 0 || j < 0 || i >= M.nx || j >= M.ny) return null;
  const L = M.idx[j * M.nx + i]; if (!L) return null;
  for (const k of L) if (depth(M.sh[k], x, y, pad) > 0) return M.sh[k];
  return null;
}
export function castleSolid(w, x, y, pad = 0) {
  for (const C of w.castles || []) { const b = C._.bbox; if (x < b[0] || y < b[1] || x > b[2] || y > b[3]) continue; if (masonryAt(C, x, y, pad)) return true; }
  return false;
}
// does a standing curtain lie across the line a→b (not at a breach or an open postern)?
export function wallBetween(w, ax, ay, bx, by) {
  for (const C of w.castles || []) {
    const B = C._.bbox; if (Math.max(ax, bx) < B[0] || Math.max(ay, by) < B[1] || Math.min(ax, bx) > B[2] || Math.min(ay, by) > B[3]) continue;
    for (const q of C._.mas?.segs || []) {
      const sa = (ax - q.ax) * q.nx + (ay - q.ay) * q.ny, sb = (bx - q.ax) * q.nx + (by - q.ay) * q.ny;
      if ((sa > 0) === (sb > 0)) continue;
      const f = sa / (sa - sb), t = (ax + (bx - ax) * f - q.ax) * q.ux + (ay + (by - ay) * f - q.ay) * q.uy;
      if (t < 0 || t > q.L || q.gaps.some(([g0, g1]) => t > g0 && t < g1)) continue;
      return true;
    }
  }
  return false;
}
// the castle's 1 m ground grid: every cell whose centre is within `pad` of the masonry is solid (castle.js buildGrid);
// `mark` (optional, one byte a cell) = 1 where the masonry made it so
export function stampMasonry(mas, G, cell, pad = BODY, mark = null) {
  for (const q of mas.sh) {
    let bx0, by0, bx1, by1;
    if (q.t === 0) { const h = Math.max(q.hin, q.hout) + pad; bx0 = Math.min(q.ax, q.ax + q.ux * q.L) - h; bx1 = Math.max(q.ax, q.ax + q.ux * q.L) + h; by0 = Math.min(q.ay, q.ay + q.uy * q.L) - h; by1 = Math.max(q.ay, q.ay + q.uy * q.L) + h; }
    else { const h = (q.t === 1 ? q.r : Math.hypot(Math.max(-q.a0, q.a1), Math.max(-q.b0, q.b1))) + pad; bx0 = q.x - h; bx1 = q.x + h; by0 = q.y - h; by1 = q.y + h; }
    for (let j = Math.max(0, Math.floor((by0 - G.y0) / cell)); j <= Math.min(G.ny - 1, Math.floor((by1 - G.y0) / cell)); j++)
      for (let i = Math.max(0, Math.floor((bx0 - G.x0) / cell)); i <= Math.min(G.nx - 1, Math.floor((bx1 - G.x0) / cell)); i++)
        if (depth(q, G.x0 + (i + 0.5) * cell, G.y0 + (j + 0.5) * cell, pad) > 0) { G.mul[j * G.nx + i] = Infinity; if (mark) mark[j * G.nx + i] = 1; }
  }
}
// out of the masonry: out = [x, y]; returns true if he was moved. (px, py): where he was last (NaN if unknown);
// (rx, ry): where his body stands — out of a curtain he goes on the side he came from, else on his body's side
export function pushOut(C, x, y, px, py, rx, ry, out) {
  const M = C._.mas; out[0] = x; out[1] = y; if (!M) return false;
  let moved = false;
  for (let it = 0; it < 4; it++) {
    const q = masonryAt(C, x, y, BODY - 1e-3); if (!q) break;
    moved = true;
    if (q.t === 0) {
      const dx = x - q.ax, dy = y - q.ay, t = dx * q.ux + dy * q.uy, s = dx * q.nx + dy * q.ny;
      // the side he came from, if he was clear of the wall's thickness; else the side his body is on
      let outSide = s > (q.hout - q.hin) / 2, known = false;
      if (px === px) { const ps = (px - q.ax) * q.nx + (py - q.ay) * q.ny; if (ps > q.hout - 0.05) { outSide = true; known = true; } else if (ps < -q.hin + 0.05) { outSide = false; known = true; } }
      if (!known && rx === rx) { const rs = (rx - q.ax) * q.nx + (ry - q.ay) * q.ny; if (rs > q.hout) outSide = true; else if (rs < -q.hin) outSide = false; }
      let ns = outSide ? q.hout + BODY : -q.hin - BODY, nt = t, best = Math.abs(ns - s);
      // (by the ends of a breach's gap, if nearer: along the wall into the rubble)
      for (const [g0, g1] of q.gaps) for (const e of [g0 + BODY, g1 - BODY]) if (g1 - g0 > 2 * BODY && Math.abs(e - t) < best) { best = Math.abs(e - t); nt = e; ns = s; }
      x = q.ax + q.ux * nt + q.nx * ns; y = q.ay + q.uy * nt + q.ny * ns;
    } else if (q.t === 1) {
      let dx = x - q.x, dy = y - q.y, r = Math.hypot(dx, dy);
      if (r < 1e-3) { dx = px === px ? px - q.x : 1; dy = px === px ? py - q.y : 0; r = Math.hypot(dx, dy) || 1; }
      const rad = q.r + BODY - r;
      if (q.clip) { const e = dx * q.clip.nx + dy * q.clip.ny - q.clip.d + BODY; if (e < rad) { x -= q.clip.nx * e; y -= q.clip.ny * e; continue; } }
      x = q.x + dx / r * (q.r + BODY); y = q.y + dy / r * (q.r + BODY);
    } else {
      const dx = x - q.x, dy = y - q.y; let a = dx * q.c + dy * q.s, b = -dx * q.s + dy * q.c;
      const f = [a - q.a0, q.a1 - a, b - q.b0, q.b1 - b], k = f.indexOf(Math.min(...f));
      if (k === 0) a = q.a0 - BODY; else if (k === 1) a = q.a1 + BODY; else if (k === 2) b = q.b0 - BODY; else b = q.b1 + BODY;
      x = q.x + a * q.c - b * q.s; y = q.y + a * q.s + b * q.c;
    }
  }
  out[0] = x; out[1] = y;
  return moved;
}
