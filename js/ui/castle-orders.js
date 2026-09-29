// "Go anywhere in the castle": click a place on a castle with companies selected and send the foot there, at the right
// level (docs/castle-plan.md §1.2). The click is a ray from the camera: the first castle surface it meets (a tower,
// the gatehouse, a stretch of curtain, the keep) or the ground (the bailey) — js/sim/castle.js castleRayPick /
// castlePlace — and the order popup offers what fits that place:
//   a tower        "Man this tower"      its open top (bows at the battlements, crenel cover); the rest wait on the stair
//                                         and the walk. Outside with no way up: "Ladders to this tower" (a low tower
//                                         only; a high one is refused with the reason)
//   the curtain    "Up onto the wall here"   the wall-walk at that point
//   the gatehouse  "Into the gatehouse"  its roof, over the murder holes and machicolation (the rest in the chamber)
//   the keep       "Hold the keep roof" / "Hold the hall"
//   the bailey     "Go here"
// All are castle.js `castle_move { x, y, lvl }` (routed by the ground, gates, breaches, ladders and stairs, fighting
// whoever is in the way). Offered when at least one selected company has a way there. A right-drag's facing is kept.
// main.js: castlePick(w, cam, sx, sy) → place | null; castleOrders(w, units, place) → popup buttons;
// castleChoose(w, order, units, toast) → true if it was one of these; installCastleHover(deps) → the hover hint.
import * as CS from "../sim/castle.js";
import { ARMS } from "../sim/arms.js";
import { issueOrder } from "../sim/world.js";

let last = null; // the place of the popup now open
const m = (v) => Math.round(v * 2) / 2; // (metres to the half: a tower top is 13.5 m)
export const lastPlace = () => last;

// the castle place under screen point (sx, sy), or null
export function castlePick(w, cam, sx, sy) {
  if (!w.castles?.length || !cam || !Number.isFinite(sx)) return null;
  const V = cam.position.constructor, o = cam.position, d = new V(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1, 0.5).unproject(cam).sub(o).normalize();
  const hit = CS.castleRayPick(w, o.x, -o.z, o.y, d.x, -d.z, d.y); if (!hit) return null;
  return CS.castlePlace(w, hit.x, hit.y, hit.part ? { part: hit.part, h: hit.h, top: hit.top } : null);
}
const footOf = (units) => units.filter((u) => u && u.members.length && !u.isWorkers && !ARMS[u.arm]?.mounted && !ARMS[u.arm]?.engine);
// can any of these companies get there (by the ways they have: gates, breaches, stairs, their own ladders)?
function reach(w, units, x, y, lvl) {
  const S = w.S;
  for (const u of units) {
    const i = u.members.find((m) => S.alive[m]); if (i === undefined) continue;
    const p = CS.castlePath(w, i, x, y, lvl);
    if (p && p.length && p[p.length - 1].lvl === lvl) return true;
  }
  return false;
}
export function castleOrders(w, units, place) {
  last = place || null;
  if (!place) return [];
  const foot = footOf(units); if (!foot.length) return [];
  const n = foot.reduce((s, u) => s + u.members.length, 0), bows = foot.every((u) => ARMS[u.arm]?.missile), P = place, out = [];
  const more = (cap) => n > cap ? `; ${n - cap} more wait on the stair and the walk` : "";
  if (P.kind === "tower") {
    if (reach(w, foot, P.x, P.y, P.lvl)) out.push({ kind: "cs-tower", label: "Man this tower", hint: `its top, ${m(P.h)} m: ${Math.min(n, P.cap)} ${bows ? "bows at the battlements" : "men at the battlements"}${more(P.cap)}` });
    else if (P.castle.team !== foot[0].team) out.push({ kind: "cs-ladder", label: "Ladders to this tower", hint: P.h > 12 ? `too high for ladders (${m(P.h)} m): take the wall beside it` : `long ladders to its top, ${m(P.h)} m: a slow climb` });
  } else if (P.kind === "walk") {
    if (reach(w, foot, P.x, P.y, P.lvl)) out.push({ kind: "cs-walk", label: "Up onto the wall here", hint: `the wall-walk, ${m(P.h)} m up, a man to each merlon` });
  } else if (P.kind === "gatehouse") {
    if (reach(w, foot, P.x, P.y, P.lvl)) out.push({ kind: "cs-gate", label: "Into the gatehouse", hint: `its roof over the murder holes and machicolation: ${Math.min(n, P.cap)} men${n > P.cap ? `, the rest in the chamber` : ""}` });
  } else if (P.kind === "keep") {
    if (reach(w, foot, P.x, P.y, CS.L_ROOF)) out.push({ kind: "cs-keeproof", label: "Hold the keep roof", hint: `the battlements, ${m(P.part.floors[3])} m up: ${Math.min(n, P.capRoof)} men${n > P.capRoof ? ", the rest on the floors below" : ""}` });
    if (reach(w, foot, P.x, P.y, CS.L_HALL)) out.push({ kind: "cs-hall", label: "Hold the hall", hint: `the keep's hall, up the forebuilding stair: ${Math.min(n, P.capHall)} men${n > P.capHall ? ", the rest above" : ""}` });
  } else if (P.kind === "bailey") {
    if (reach(w, foot, P.x, P.y, 0)) out.push({ kind: "cs-go", label: "Go here", hint: P.label.toLowerCase() });
  }
  return out;
}
const WORD = { "cs-tower": "To the tower top", "cs-walk": "Up onto the wall", "cs-gate": "Into the gatehouse", "cs-keeproof": "To the keep roof", "cs-hall": "Into the hall", "cs-go": "Into the bailey" };
export function castleChoose(w, order, units, toast = null) {
  if (!order?.kind?.startsWith("cs-")) return false;
  const P = last; last = null;
  const foot = footOf(units);
  if (!P || !foot.length) { toast?.("No one who can go up there"); return true; }
  if (order.kind === "cs-ladder") {
    if (P.h > 12) { toast?.("Too high for ladders: take the wall beside it and go in by the tower's door"); return true; }
    issueOrder(w, foot.map((u) => u.id), { kind: "escalade", x: P.x, y: P.y, pace: order.pace && order.pace !== "march" ? order.pace : "quick" });
    toast?.(`Long ladders to the tower: ${foot.reduce((s, u) => s + u.members.length, 0)} men`); return true;
  }
  const lvl = order.kind === "cs-keeproof" ? CS.L_ROOF : order.kind === "cs-hall" ? CS.L_HALL : P.lvl;
  const o = { kind: "castle_move", x: P.x, y: P.y, lvl, castle: P.castle.id, pace: order.pace || "quick" };
  if (Number.isFinite(order.facing)) { o.facing = order.facing; o.faceSet = true; } // (a right-drag: which way they face up there)
  for (const u of foot) issueOrder(w, [u.id], { ...o });
  const n = foot.reduce((s, u) => s + u.members.length, 0);
  toast?.(`${WORD[order.kind] || "Up"}: ${n} men${P.cap && lvl > 0 && n > P.cap && (order.kind === "cs-tower" || order.kind === "cs-gate") ? ` (${P.cap} fit on top)` : ""}`);
  return true;
}
// the hint that follows the pointer over a castle with companies selected: "Tower top · 13 m · 8 men fit"
export function installCastleHover({ w, canvas, camera, selected, busy = () => false }) {
  const el = document.createElement("div"); el.id = "castlehint"; el.hidden = true;
  Object.assign(el.style, { position: "fixed", maxWidth: "360px", background: "var(--panel, #1c1a17)", border: "1px solid var(--edge, #554)", borderRadius: "3px", padding: "5px 8px", fontSize: "12px", pointerEvents: "none", zIndex: 8 });
  document.body.append(el);
  let t = 0;
  addEventListener("pointermove", (e) => {
    if (e.target !== canvas || !selected.size || !w.castles?.length || busy()) { el.hidden = true; return; }
    if (performance.now() - t < 90) return; t = performance.now();
    const P = castlePick(w, camera.cam, e.clientX, e.clientY);
    if (!P || P.kind === "bailey" && !CS.insideCastle(w, P.x, P.y)) { el.hidden = true; return; }
    el.textContent = P.label; el.style.left = e.clientX + 16 + "px"; el.style.top = e.clientY + 16 + "px"; el.hidden = false;
  });
  return el;
}
