// The weather as heard: the wind bed and the rain bed (js/audio/battle.js ambience drives them every frame; the offline
// harness tools/audio-wind.mjs drives the very same code). Assets: bed_wind / bed_rain (tools/audio/sfx_ambience.py —
// approved, unchanged); everything here is the RUNTIME shaping of those loops.
//
// The wind used to go to static: the weather lane scaled the bed's gain by the wind speed (×0.5…1.8) ON TOP of the old
// ×1.8 for any rain/wind/storm sky, and opened its one low-pass to 1.8 + 9 kHz with the ear's height — so a breezy rain
// seen from the town view played the bed's hiss band wide open at up to ~10 dB over its design level, with the rain
// bed's own bright wash (a 10 kHz low-pass) stacked on it: flat broadband noise, the gusts drowned. Now:
//   • the speed is the one driver (m/s; a sky without a wind vector keeps the old calm / stormy split): level, colour
//     and gustiness all swell with it — calm is a low dark breath, a gale a roar with a whistle in the gusts;
//   • band-limited: a 45 Hz high-pass (no rumble) and TWO cascaded low-passes (24 dB/oct, Q 0.6: no resonant edge) at
//     ~0.6 kHz calm … ~3.6 kHz gale, + a little with the ear's height, never above WIND.lpMax — the hiss band stays shut;
//   • slow gusts: a deterministic value-noise envelope (periods 3–20 s, no dice) swells the level and opens the filter
//     together, deeper the harder it blows — over the loop's own gusts, so it never settles into a flat hiss;
//   • the beds never stack into a wall: the rain's wash goes through two low-passes capped at 4 kHz (it was one opened
//     to 10 kHz — the rain bed's hiss band is most of the 'static'), a little quieter, and the wind gives way a little.
export const WIND = {
  calm: 0.06, gale: 0.32,         // bed gain at 0 m/s and at a gale (GALE m/s); the amb bus and master scale it after
  lp0: 600, lp1: 3000, lpH: 600, lpMax: 4200,   // low-pass Hz: calm, + gale, + ear height (0…1 of 300 m), ceiling
  gust0: 0.25, gust1: 0.7,        // gust depth (fraction of the level) calm → gale
  hp: 45,                         // high-pass Hz
  rainDuck: 0.2,                  // the wind gives way a little under a downpour (×1 − rainDuck·rain)
  rainLp0: 1600, rainLp1: 4000,   // rain low-passes (×2, 24 dB/oct): drizzle … downpour (was one at 2.2 … 10.2 kHz)
  rainGain: 0.45,                 // rain bed gain at a downpour (was 0.55)
};
export const GALE = 17;           // m/s (js/sim/weather.js: a gale)
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
// smooth value noise in [0, 1] (deterministic: audio-only, never the sim's dice)
function vn(t, seed) {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  const h = (k) => { let x = Math.imul((k + seed * 7919) ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };
  return h(i) * (1 - u) + h(i + 1) * u;
}
// the gust envelope at audio time t (s): mostly the slow swells, a little faster flutter on top → [0, 1]
export const gustAt = (t) => clamp(0.55 * vn(t / 9.5, 1) + 0.3 * vn(t / 4.1, 2) + 0.15 * vn(t / 1.7, 3), 0, 1);

// the beds' targets for this moment → { wind: { gain, lp }, rain: { gain, lp } }
//   speed: m/s (null: no wind vector — then a rain/wind/storm sky blows at 11, else a breeze of 4), stormy: that sky,
//   rain 0…1, hN: the ear's height 0…1 (of 300 m), t: audio time (s) for the gusts
export function weatherTargets({ speed = null, stormy = false, rain = 0, hN = 0, t = 0 }) {
  const v = speed ?? (stormy ? 11 : 4), s = clamp(v / GALE, 0, 1), g = gustAt(t);
  const depth = WIND.gust0 + (WIND.gust1 - WIND.gust0) * s;
  const level = (WIND.calm + (WIND.gale - WIND.calm) * Math.pow(s, 1.3)) * (0.85 + 0.3 * hN) * (1 - WIND.rainDuck * clamp(rain, 0, 1));
  const gain = level * (1 - depth * 0.5 + depth * g);
  const lp = Math.min(WIND.lpMax, (WIND.lp0 + WIND.lp1 * Math.pow(s, 1.2) + WIND.lpH * hN) * (0.8 + 0.4 * g));
  const r = clamp(rain, 0, 1);
  return { wind: { gain, lp }, rain: { gain: WIND.rainGain * r, lp: WIND.rainLp0 + (WIND.rainLp1 - WIND.rainLp0) * r } };
}

// the wind bed's graph: loop → high-pass → low-pass × 2 → gain → amb bus (engine.bed makes loop → lp → gain → bus;
// the extra filters are spliced in after its low-pass)
export function makeWindBed(eng) {
  const B = eng.bed("bed_wind", "amb"); if (!B) return null;
  const c = eng.ctx, hp = c.createBiquadFilter(), lp2 = c.createBiquadFilter();
  hp.type = "highpass"; hp.frequency.value = WIND.hp; hp.Q.value = 0.7;
  lp2.type = "lowpass"; lp2.frequency.value = WIND.lp0; lp2.Q.value = 0.6;
  B.lp.Q.value = 0.6; B.lp.frequency.value = WIND.lp0;
  B.src.disconnect(); B.lp.disconnect();
  B.src.connect(hp).connect(B.lp).connect(lp2).connect(B.gain);
  B.lp2 = lp2; B.hp = hp;
  return B;
}
// the rain bed: loop → low-pass × 2 → gain → amb bus (its bright wash shut above a few kHz: rain, not radio static)
export function makeRainBed(eng) {
  const B = eng.bed("bed_rain", "amb"); if (!B) return null;
  const lp2 = eng.ctx.createBiquadFilter(); lp2.type = "lowpass"; lp2.frequency.value = WIND.rainLp0; lp2.Q.value = 0.6;
  B.lp.Q.value = 0.6; B.lp.frequency.value = WIND.rainLp0;
  B.lp.disconnect(); B.lp.connect(lp2).connect(B.gain); B.lp2 = lp2;
  return B;
}
// set this moment's targets on the beds (smoothing: the gusts are already slow; the weather turns slower still)
export function driveWeather(eng, beds, opts) {
  const T = weatherTargets(opts), t = eng.ctx.currentTime;
  if (beds.wind) {
    beds.wind.gain.gain.setTargetAtTime(T.wind.gain, t, 0.4);
    beds.wind.lp.frequency.setTargetAtTime(T.wind.lp, t, 0.4);
    beds.wind.lp2?.frequency.setTargetAtTime(T.wind.lp, t, 0.4);
  }
  if (beds.rain) {
    beds.rain.gain.gain.setTargetAtTime(T.rain.gain, t, 1.5);
    beds.rain.lp.frequency.setTargetAtTime(T.rain.lp, t, 1.5);
    beds.rain.lp2?.frequency.setTargetAtTime(T.rain.lp, t, 1.5);
  }
  return T;
}
