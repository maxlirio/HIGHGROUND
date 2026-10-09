// Feet on the ground (the owner: "something that prevents … all units from sinking into the ground"). The sim's map.h is
// a bilinear 3.9 m grid; the land is DRAWN as 7.8 m triangles (js/render/terrain.js), so on a bump or a steep face a man
// set at map.h stands decimetres — on a crag, metres — off what you see. Figures stand on the drawn ground instead
// (terrain.js groundH: the mesh's own triangles, the buildings' pads, a castle's carve as the sim cuts it).
// A horse is 2.4 m long: set level at his middle, on a slope his uphill hooves were in the hill and the downhill ones in
// the air. He is pitched along his heading and rolled across it so all four stand on the ground, and his rider sits the
// saddle through the same tilt.
import { groundH } from "./terrain.js";

export const standH = (map, x, y) => groundH(map, x, y);

const HALF_L = 1.0, HALF_W = 0.32, MAX_P = 0.5, MAX_R = 0.1; // hoof base (m), the steepest pitch and roll drawn (rad)
// → out { h, q [x, y, z, w] } for a horse at (x, y) facing `yaw` (figures.js: local +z forward, local +x his left)
export function horsePose(map, x, y, yaw, out = { h: 0, q: [0, 0, 0, 1] }) {
  const fx = Math.sin(yaw), fy = -Math.cos(yaw), sx = Math.cos(yaw), sy = Math.sin(yaw);
  const hf = groundH(map, x + fx * HALF_L, y + fy * HALF_L), hb = groundH(map, x - fx * HALF_L, y - fy * HALF_L);
  const hl = groundH(map, x + sx * HALF_W, y + sy * HALF_W), hr = groundH(map, x - sx * HALF_W, y - sy * HALF_W);
  const p = Math.max(-MAX_P, Math.min(MAX_P, Math.atan2(hf - hb, 2 * HALF_L))), r = Math.max(-MAX_R, Math.min(MAX_R, 0.5 * Math.atan2(hl - hr, 2 * HALF_W))); // (across the slope a horse keeps his back near level: half the roll, his legs take the rest)
  out.h = Math.min((hf + hb) / 2, (hl + hr) / 2 + 0.05);
  // q = pitch (about local x, nose up = −) · roll (about local z)
  const a = -p / 2, b = r / 2, sa = Math.sin(a), ca = Math.cos(a), sb = Math.sin(b), cb = Math.cos(b);
  out.q[0] = sa * cb; out.q[1] = -sa * sb; out.q[2] = ca * sb; out.q[3] = ca * cb;
  return out;
}
// the rider's seat (seatP, horse-local, already scaled) and its turn (seatQ) carried through the horse's tilt q
export function seatThrough(q, seatP, seatQ, outP, outQ) {
  const [x, y, z, w] = q, [px, py, pz] = seatP;
  // v' = q v q*
  const ix = w * px + y * pz - z * py, iy = w * py + z * px - x * pz, iz = w * pz + x * py - y * px, iw = -x * px - y * py - z * pz;
  outP[0] = ix * w + iw * -x + iy * -z - iz * -y; outP[1] = iy * w + iw * -y + iz * -x - ix * -z; outP[2] = iz * w + iw * -z + ix * -y - iy * -x;
  const [bx, by, bz, bw] = seatQ;
  outQ[0] = w * bx + x * bw + y * bz - z * by; outQ[1] = w * by - x * bz + y * bw + z * bx; outQ[2] = w * bz + x * by - y * bx + z * bw; outQ[3] = w * bw - x * bx - y * by - z * bz;
  return outP;
}
