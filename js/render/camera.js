// RTS camera with switchable 3D views.
//  pan: WASD / arrows / middle-drag      zoom: wheel      rotate: Q/E      tilt: R/F
//  orbit: Option(Alt)+drag               cycle views: V (Map → Eagle → Oblique → Ground)
import * as THREE from "three";

const D2R = Math.PI / 180;
export const MAX_DIST = 1400;
const EDGE = 450; // the view centre never gets closer than this to the edge of the world
export const VIEWS = [
  { key: "map", name: "Map", pitch: 88, dist: 1250 },     // straight down, like a war map
  { key: "eagle", name: "Eagle", pitch: 55, dist: 650 },  // default command view
  { key: "oblique", name: "Oblique", pitch: 28, dist: 320 },
  { key: "ground", name: "Ground", pitch: 9, dist: 90 },  // near eye level — see what the men see
];

export function makeCamera(canvas, map) {
  const cam = new THREE.PerspectiveCamera(35, 1, 1, 30000);
  const X0 = map.x0 || 0, Y0 = map.y0 || 0, X1 = X0 + map.size, Y1 = Y0 + map.size; // (the world's extent: docs/big-world.md)
  const st = { tx: X0 + map.size * 0.3, ty: Y0 + map.size * 0.3, dist: 650, yaw: 0, pitch: 55 * D2R, view: 1 };
  const goal = { dist: st.dist, pitch: st.pitch }; // presets ease toward these
  const keys = new Set();
  const typing = (e) => e.target.closest?.("input,textarea");
  addEventListener("keydown", (e) => {
    if (typing(e)) return; const k = e.key.toLowerCase(); keys.add(k);
    if (k === "v" && !e.repeat && !st.drive) setView((st.view + 1) % VIEWS.length);
  });
  addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  addEventListener("blur", () => keys.clear());
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault(); goal.dist = THREE.MathUtils.clamp(goal.dist * Math.exp(e.deltaY * 0.0012), 25, MAX_DIST); // you can never pull back far enough to see the world end
  }, { passive: false });
  let mid = null, orbit = null, orbitFrom = null;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button === 1) { mid = [e.clientX, e.clientY]; e.preventDefault(); }
    if (e.button === 0 && e.altKey) { orbit = [e.clientX, e.clientY]; orbitFrom = [e.clientX, e.clientY]; e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  addEventListener("pointermove", (e) => {
    if (mid) { const dx = e.clientX - mid[0], dy = e.clientY - mid[1]; mid = [e.clientX, e.clientY]; pan(-dx * st.dist * 0.0012, dy * st.dist * 0.0012); }
    if (orbit) {
      const dx = e.clientX - orbit[0], dy = e.clientY - orbit[1]; orbit = [e.clientX, e.clientY];
      st.yaw -= dx * 0.005; goal.pitch = THREE.MathUtils.clamp(goal.pitch + dy * 0.004, 4 * D2R, 89 * D2R); st.pitch = goal.pitch;
    }
  });
  addEventListener("pointerup", (e) => {
    if (e.button === 1) mid = null;
    if (e.button === 0 && orbit) { orbit = null; e.stopImmediatePropagation(); if (Math.hypot(e.clientX - orbitFrom[0], e.clientY - orbitFrom[1]) < 5) api.onAltClick?.(e); } // (an Alt-click that did not orbit: "orders here" — main.js)
  }, true);

  function pan(right, fwd) {
    const c = Math.cos(st.yaw), s = Math.sin(st.yaw);
    st.tx = THREE.MathUtils.clamp(st.tx + right * c - fwd * s, X0 + EDGE, X1 - EDGE);
    st.ty = THREE.MathUtils.clamp(st.ty + right * s + fwd * c, Y0 + EDGE, Y1 - EDGE);
  }
  function setView(i) {
    st.view = i; const v = VIEWS[i];
    goal.pitch = v.pitch * D2R; goal.dist = v.dist;
    onView?.(v);
  }
  let onView = null;

  function update(dt, aspect) {
    // st.drive: another controller owns the camera (js/ui/avatar-ui.js, the third-person view of the lord)
    if (st.drive) { st.drive(cam, dt, aspect); return; }
    const sp = st.dist * 0.9 * dt;
    if (keys.has("w") || keys.has("arrowup")) pan(0, sp);
    if (keys.has("s") || keys.has("arrowdown")) pan(0, -sp);
    if (keys.has("a") || keys.has("arrowleft")) pan(-sp, 0);
    if (keys.has("d") || keys.has("arrowright")) pan(sp, 0);
    if (keys.has("q")) st.yaw += dt * 1.2;
    if (keys.has("e")) st.yaw -= dt * 1.2;
    if (keys.has("r")) goal.pitch = Math.min(89 * D2R, goal.pitch + dt * 0.9);
    if (keys.has("f")) goal.pitch = Math.max(4 * D2R, goal.pitch - dt * 0.9);
    // ease toward the goal (smooth view changes)
    const k = 1 - Math.exp(-dt * 6);
    st.pitch += (goal.pitch - st.pitch) * k;
    st.dist *= Math.exp((Math.log(goal.dist) - Math.log(st.dist)) * k);
    const ground = map.h(st.tx, st.ty);
    const lookH = ground + (st.pitch < 20 * D2R ? 1.7 : 0); // low views look at head height, not the dirt
    const horiz = Math.cos(st.pitch) * st.dist, up = Math.sin(st.pitch) * st.dist;
    const ox = Math.sin(st.yaw) * horiz, oy = -Math.cos(st.yaw) * horiz;
    let cx = st.tx + ox, cy = st.ty + oy, cz = lookH + up;
    // never inside a hill: keep at least 2.5 m above the ground under the camera
    if (map.inBounds(cx, cy)) cz = Math.max(cz, map.h(cx, cy) + 2.5);
    cam.position.set(cx, cz, -cy);
    cam.lookAt(st.tx, lookH, -st.ty);
    cam.near = st.dist < 200 ? 0.5 : 2;
    cam.aspect = aspect; cam.updateProjectionMatrix();
  }
  const api = {
    cam, st, goal, update, pan, setView, onAltClick: null,
    onViewChange(fn) { onView = fn; },
    zoomTo(d) { goal.dist = d; st.dist = d; },
    focus(x, y) { st.tx = THREE.MathUtils.clamp(x, X0 + EDGE, X1 - EDGE); st.ty = THREE.MathUtils.clamp(y, Y0 + EDGE, Y1 - EDGE); },
  };
  return api;
}
