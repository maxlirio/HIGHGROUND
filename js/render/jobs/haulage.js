// Gathering lane D: storehouse & build logistics — its render side (docs/gathering-plan.md; the sim is js/sim/jobs/haulage.js).
// The yard stacks round a store and the piles at a building site are ordinary labour items (render/labor.js draws them);
// this file only registers their pieces — a stack that looks like stores: sacks in tiers, casks two high, a log rick,
// boards stacked on stickers in two columns, dressed stone in courses, a hay rick — and the markers they wear from afar.
import * as THREE from "three";
import { PIECE, MARK, COL, logGeo, tint, merge, pyramid, grid } from "../labor.js";

const along = (g) => g.rotateZ(Math.PI / 2);
function boardLayer() {   // one course of a board stack: five boards on two stickers
  const g = [];
  for (let j = 0; j < 5; j++) g.push(tint(new THREE.BoxGeometry(3.0, 0.045, 0.26), COL.planks, 0.14, j).translate(0, 0.075, (j - 2) * 0.28));
  for (const x of [-1.1, 1.1]) g.push(tint(new THREE.BoxGeometry(0.07, 0.05, 1.45), "#8d7152", 0.1).translate(x, 0.025, 0));
  return merge(g);
}
function sackGeo() {   // a filled sack lying down: a fat pillow, its neck tied off at one end
  const body = tint(new THREE.CapsuleGeometry(0.2, 0.42, 4, 10), "#c4ae83", 0.12).rotateZ(Math.PI / 2).scale(1, 0.72, 1.25).translate(-0.04, 0.15, 0);
  return merge([body, tint(new THREE.CylinderGeometry(0.05, 0.09, 0.16, 6), "#a8936b").rotateZ(Math.PI / 2).translate(0.47, 0.15, 0), tint(new THREE.SphereGeometry(0.07, 6, 4), "#b39e74").translate(0.57, 0.15, 0)]);
}
function caskGeo() {
  return merge([tint(new THREE.CylinderGeometry(0.29, 0.26, 0.82, 12), COL.barrel, 0.22).translate(0, 0.41, 0),
    tint(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 12), "#34332f").translate(0, 0.62, 0), tint(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 12), "#34332f").translate(0, 0.2, 0),
    tint(new THREE.CylinderGeometry(0.24, 0.24, 0.02, 12), "#5d4630").translate(0, 0.82, 0)]);
}
function ashlar() { return merge([tint(new THREE.BoxGeometry(0.95, 0.46, 0.62), COL.stone, 0.16).translate(0, 0.23, 0), tint(new THREE.BoxGeometry(0.97, 0.02, 0.64), "#8e897e").translate(0, 0.465, 0)]); }
function rickGeo() {      // a bound sheaf lying on its side: the rick is built of them in courses
  return merge([along(tint(new THREE.CylinderGeometry(0.2, 0.26, 1.1, 7), COL.sheaf, 0.2)).translate(0, 0.24, 0), along(tint(new THREE.CylinderGeometry(0.14, 0.14, 0.08, 7), "#b0914a")).translate(-0.1, 0.24, 0)]);
}

// sacks in courses, each course laid across the one below (brick-bond), a little narrower as it rises
PIECE.yard_sack = { geo: sackGeo, at: (k) => { const per = 8, l = Math.floor(k / per), r = k % per, i = r % 2, j = Math.floor(r / 2); return l % 2 ? [(j - 1.5) * 0.52 * (1 - 0.08 * l), l * 0.29, (i - 0.5) * 1.05, Math.PI / 2] : [(i - 0.5) * 1.05, l * 0.29, (j - 1.5) * 0.52 * (1 - 0.08 * l), 0]; } };
PIECE.yard_barrel = { geo: caskGeo, at: (k) => grid(k, 4, 3, 0.64, 0.64, 0.84) };
PIECE.yard_logs = { geo: () => logGeo(4.2, 0.2), at: (k) => pyramid(k, 7, 0.42, 0.36) };
PIECE.yard_planks = { geo: boardLayer, at: (k) => [0, Math.floor(k / 2) * 0.13, (k % 2 - 0.5) * 1.6, 0] };
PIECE.yard_stone = { geo: ashlar, at: (k) => { const c = grid(k, 3, 3, 1.0, 0.66, 0.47); c[3] = 0; return c; } };
PIECE.yard_sheaf = { geo: rickGeo, at: (k) => { const l = Math.floor(k / 6), r = k % 6; return [((r % 3) - 1) * 1.15 + (l % 2) * 0.3, l * 0.4, (Math.floor(r / 3) - 0.5) * 0.5, 0]; } };
// the sawyers' trestle: two splayed X-legs and a log across them at hand height (the saw cuts between the men)
PIECE.yard_trestle = { geo: () => {
  const g = [], leg = (x, a) => tint(new THREE.BoxGeometry(0.09, 1.0, 0.09), "#7a6040", 0.15).rotateX(a).translate(x, 0.45, 0);
  for (const x of [-1.1, 1.1]) { g.push(leg(x, 0.42), leg(x, -0.42)); g.push(tint(new THREE.BoxGeometry(0.1, 0.1, 0.5), "#6b5236").translate(x, 0.72, 0)); }
  g.push(logGeo(3.2, 0.19).translate(0, 0.95, 0));
  return merge(g);
}, at: () => [0, 0, 0, 0] };
PIECE.yard_faggot = { geo: PIECE.faggot.geo, at: (k) => pyramid(k, 6, 0.5, 0.3) };
PIECE.yard_basket = { geo: PIECE.basket.geo, at: (k) => grid(k, 4, 3, 0.8, 0.8, 0.5) };
for (const [k, base] of [["yard_sack", "sack"], ["yard_barrel", "barrel"], ["yard_logs", "log"], ["yard_planks", "planks"], ["yard_stone", "stone"], ["yard_sheaf", "sheaf"], ["yard_faggot", "faggot"], ["yard_basket", "basket"], ["yard_trestle", "log"]]) {
  COL[k] = COL[base]; MARK[k] = MARK[base];
}

export function makeRender(scene, map, ctx) { return { update() {} }; }
