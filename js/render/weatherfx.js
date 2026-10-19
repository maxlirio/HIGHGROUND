// Weather effects round the camera: rain streaks and falling snow, slanted by the sim's wind.
// One system serves every mode — a pitched battle (battle.env from the setup screen) and the live
// worlds (campaign and realm, from w.wx — js/sim/weather.js). Render-only: zero sim or server cost.
//   const fx = makeWeatherFx(scene);
//   fx.update(dt, { rain, snow, wind, x, y, ground })   // rain/snow 0..1; wind {x,y} m/s sim frame; x,y sim m
import * as THREE from "three";

const R_N = 5000, S_N = 3500, BOX = 260, TOP = 160;

export function makeWeatherFx(scene) {
  let rain = null, snow = null;

  function makeRain() {
    const pos = new Float32Array(R_N * 6), vel = new Float32Array(R_N);
    for (let i = 0; i < R_N; i++) { const x = (Math.random() - 0.5) * 2 * BOX, z = (Math.random() - 0.5) * 2 * BOX, y = Math.random() * TOP; pos.set([x, y, z, x + 0.4, y + 2.2, z], i * 6); vel[i] = 26 + Math.random() * 8; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({ color: "#c8d2dc", transparent: true, opacity: 0.35, depthWrite: false });
    const lines = new THREE.LineSegments(geo, mat); lines.frustumCulled = false; lines.renderOrder = 5; scene.add(lines);
    return { lines, geo, mat, vel };
  }
  function makeSnow() {
    const pos = new Float32Array(S_N * 3), ph = new Float32Array(S_N);
    for (let i = 0; i < S_N; i++) { pos.set([(Math.random() - 0.5) * 2 * BOX, Math.random() * TOP, (Math.random() - 0.5) * 2 * BOX], i * 3); ph[i] = Math.random() * Math.PI * 2; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: "#eef2f6", size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 5; scene.add(pts);
    return { pts, geo, mat, ph, t: 0 };
  }

  return {
    update(dt, { rain: rI = 0, snow: sI = 0, wind = null, x = 0, y = 0, ground = 0 }) {
      dt = Math.min(dt, 0.1);
      // the wind leans the fall over (sim frame → three: x → x, y → −z)
      const wx = wind ? wind.x : 0, wz = wind ? -wind.y : 0;
      if (rI > 0.02) {
        rain ||= makeRain();
        rain.lines.visible = true;
        rain.lines.position.set(x, ground, -y);
        rain.mat.opacity = 0.18 + 0.25 * rI;
        rain.geo.setDrawRange(0, Math.floor(R_N * Math.min(1, 0.25 + rI)) * 2);
        const p = rain.geo.attributes.position.array, lean = 2.2;
        for (let i = 0; i < R_N; i++) {
          let yy = p[i * 6 + 1] - rain.vel[i] * dt; if (yy < -10) yy += TOP + 10;
          const k = i * 6, sx = wx / rain.vel[i] * lean, sz = wz / rain.vel[i] * lean;
          p[k] += wx * dt; p[k + 2] += wz * dt;
          if (p[k] > BOX) p[k] -= 2 * BOX; else if (p[k] < -BOX) p[k] += 2 * BOX;
          if (p[k + 2] > BOX) p[k + 2] -= 2 * BOX; else if (p[k + 2] < -BOX) p[k + 2] += 2 * BOX;
          p[k + 1] = yy; p[k + 3] = p[k] + 0.4 + sx * lean; p[k + 4] = yy + lean; p[k + 5] = p[k + 2] + sz * lean;
        }
        rain.geo.attributes.position.needsUpdate = true;
      } else if (rain) rain.lines.visible = false;
      if (sI > 0.02) {
        snow ||= makeSnow();
        snow.pts.visible = true;
        snow.pts.position.set(x, ground, -y);
        snow.mat.opacity = 0.45 + 0.4 * sI;
        snow.geo.setDrawRange(0, Math.floor(S_N * Math.min(1, 0.3 + sI)));
        snow.t += dt;
        const p = snow.geo.attributes.position.array;
        for (let i = 0; i < S_N; i++) {
          const k = i * 3, drift = Math.sin(snow.t * 0.9 + snow.ph[i]) * 0.6;
          let yy = p[k + 1] - (1.6 + (i % 7) * 0.22) * dt; if (yy < -6) yy += TOP + 6;
          p[k] += (drift + wx * 0.35) * dt; p[k + 2] += (Math.cos(snow.t * 0.7 + snow.ph[i]) * 0.5 + wz * 0.35) * dt;
          if (p[k] > BOX) p[k] -= 2 * BOX; else if (p[k] < -BOX) p[k] += 2 * BOX;
          if (p[k + 2] > BOX) p[k + 2] -= 2 * BOX; else if (p[k + 2] < -BOX) p[k + 2] += 2 * BOX;
          p[k + 1] = yy;
        }
        snow.geo.attributes.position.needsUpdate = true;
      } else if (snow) snow.pts.visible = false;
    },
  };
}
