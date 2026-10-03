// Field works the troops make: stake lines (sharpened poles leaning toward the enemy) as instanced
// geometry; ditches and pits are dug into the ground (painted into the terrain's clearance mask by main).
import * as THREE from "three";

export function makeFieldWorks(scene, map) {
  // an archer's stake: a rough split pole ~1.8 m long (about 1.4 m out of the ground), thick as a wrist,
  // sharpened to a short point at the top, a pale fresh-cut facet near the tip
  const shaft = new THREE.CylinderGeometry(0.045, 0.055, 1.25, 6, 3); shaft.translate(0, 0.625, 0);
  const tip = new THREE.ConeGeometry(0.047, 0.28, 6); tip.translate(0, 1.25 + 0.14, 0);
  const P = shaft.attributes.position; // knobbly: jitter the rings so no two faces are perfectly straight
  for (let k = 0; k < P.count; k++) { const y = P.getY(k), a = Math.atan2(P.getZ(k), P.getX(k)); const j = 1 + 0.12 * Math.sin(a * 3 + y * 9) + 0.06 * Math.sin(y * 23); P.setX(k, P.getX(k) * j); P.setZ(k, P.getZ(k) * j); }
  const col = (g, c) => { const n = g.attributes.position.count, arr = new Float32Array(n * 3), cc = new THREE.Color(c); for (let k = 0; k < n; k++) { const v = 0.85 + 0.3 * Math.abs(Math.sin(k * 12.9898)); arr.set([cc.r * v, cc.g * v, cc.b * v], k * 3); } g.setAttribute("color", new THREE.BufferAttribute(arr, 3)); };
  col(shaft, "#5b4632"); col(tip, "#b89a70");
  const geo = mergeTwo(shaft, tip);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const MAX = 20000, mesh = new THREE.InstancedMesh(geo, mat, MAX); mesh.count = 0; mesh.frustumCulled = false; scene.add(mesh);
  const d = new THREE.Object3D(); let ver = -1;
  function sync(w) {
    if (w.featuresVer === ver) return; ver = w.featuresVer;
    let n = 0;
    for (const f of w.features || []) {
      if (f.type !== "archer_stakes" && f.type !== "stakes") continue;
      const L = Math.hypot(f.x1 - f.x0, f.y1 - f.y0), ang = Math.atan2(f.y1 - f.y0, f.x1 - f.x0);
      const steps = Math.floor(L / 1.1); // staggered double row, roughly a pace apart
      for (let k = 0; k <= steps && n < MAX; k++) for (let row = 0; row < 2 && n < MAX; row++) {
        const t = k / Math.max(1, steps), jit = ((k * 7919 + row * 104729) % 97) / 97;
        const x = f.x0 + (f.x1 - f.x0) * t + Math.sin(ang) * (row - 0.5) * 0.8, y = f.y0 + (f.y1 - f.y0) * t - Math.cos(ang) * (row - 0.5) * 0.8;
        d.position.set(x, map.h(x, y) - 0.05, -y);
        d.rotation.set(0, -ang, 0); d.rotateX(-(0.55 + jit * 0.2)); d.rotateZ((jit - 0.5) * 0.35); // leaning ~30–40° toward the enemy, not flat
        d.scale.set(0.9 + jit * 0.25, 0.85 + ((k * 37) % 11) / 30, 0.9 + jit * 0.25); d.updateMatrix(); mesh.setMatrixAt(n++, d.matrix);
      }
    }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
  }
  return { sync };
}

function mergeTwo(a, b) {
  const out = new THREE.BufferGeometry(), A = a.toNonIndexed(), B = b.toNonIndexed();
  for (const name of ["position", "normal", "color"]) {
    const x = A.attributes[name].array, y = B.attributes[name].array, z = new Float32Array(x.length + y.length);
    z.set(x); z.set(y, x.length); out.setAttribute(name, new THREE.BufferAttribute(z, 3));
  }
  out.computeVertexNormals(); return out;
}
