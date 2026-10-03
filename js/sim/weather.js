// Weather: one sky over the whole vale, derived PURELY from (seed, continuous econ day).
// No saved state: the calendar (w.econ.doy) and the map seed are all it needs, so the server and
// every realm client compute the identical sky, and a restored save wakes under the same clouds.
// Ground wetness and snow cover are windowed integrals of the same pure function (sampled a few
// days back), so even "mud dries after rain" needs nothing remembered.
//
// The sim consumes the result as it always has: w.weather names a WEATHER entry (terrain-types.js
// — bowstrings, dispersion, sight, footing, order garbling), w.wind is the ballistic wind vector.
// Effects and numbers: docs/weather.md.

import { WEATHER } from "./terrain-types.js";

// ---------------------------------------------------------------- deterministic noise
// Integer hash → [0,1). (splitmix-style; independent of rng.js so no dice are consumed.)
function hash(seed, i) {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = (h + Math.imul(i | 0, 0x85ebca6b)) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}
// 1-D value noise over continuous x (lattice step 1), smoothstep-interpolated.
function vnoise(seed, x) {
  const i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f);
  return hash(seed, i) + (hash(seed, i + 1) - hash(seed, i)) * s;
}
// Two octaves: a slow front and a faster flurry riding on it.
const front = (seed, x, p1, p2) => 0.7 * vnoise(seed, x / p1) + 0.3 * vnoise(seed ^ 0x51ab, x / p2);

// ---------------------------------------------------------------- seasons (365-day year, wraps)
export const YEAR = 365;
export function seasonOf(doy) {
  const d = ((doy % YEAR) + YEAR) % YEAR;
  return d < 50 ? "winter" : d < 140 ? "spring" : d < 230 ? "summer" : d < 320 ? "autumn" : "winter";
}
// Mean air temperature °C: seasonal sinusoid (coldest ~doy 355) + night cooling.
export function tempAt(seed, day) {
  const doy = ((day % YEAR) + YEAR) % YEAR, hour = ((day % 1) + 1) % 1 * 24;
  const seasonal = 9 + 8.5 * Math.sin(2 * Math.PI * (doy - 112) / YEAR); // ~0.5° midwinter, ~17.5° midsummer
  const diurnal = -3 * Math.cos(2 * Math.PI * (hour - 15) / 24);          // warmest mid-afternoon
  return seasonal + diurnal + (front(seed ^ 0x7e11, day, 5.3, 1.1) - 0.5) * 8; // warm and cold spells
}

// Season biases: how readily fronts become rain, and how misty the mornings are.
const RAIN_BIAS = { winter: 0.08, spring: 0.05, summer: -0.02, autumn: 0.09 };
const MIST_BIAS = { winter: 0.05, spring: 0.0, summer: -0.08, autumn: 0.12 };

// ---------------------------------------------------------------- the sky at one instant
// weatherAt(seed, day) — day is CONTINUOUS econ days (w.econ.doy): the fraction is the hour.
// Returns { key, wind:{x,y}, windSpeed, windFrom, rain, snow, fog, cloud, temp, wet, snowCover, storm }.
//  key       WEATHER entry the sim consumes (clear | overcast | drizzle | rain | heavy_rain |
//            thunderstorm | fog_light | fog_thick | snow_light | snow_heavy)
//  rain/snow 0..1 precipitation intensity; fog 0..1; cloud 0..1 (render)
//  wet       0..1 ground wetness (mud at ≳0.45) — windowed integral, dries after rain
//  snowCover 0..1 lying snow (render whitening + footing)
export function weatherAt(seed, day) {
  const s = seed >>> 0, season = seasonOf(day);
  const hour = ((day % 1) + 1) % 1 * 24;
  const temp = tempAt(s, day);

  // precipitation: a front field crossing thresholds (season-biased)
  const f = front(s, day, 3.1, 0.7) + (RAIN_BIAS[season] || 0);
  const precip = Math.max(0, (f - 0.65) / 0.35); // 0..1; ~20-28 % of hours see some precipitation
  const cloud = Math.min(1, Math.max(0, (f - 0.4) / 0.35) + precip); // cloud builds before rain

  // wind: direction wanders slowly round a prevailing westerly; strength rises with the front
  const dirN = vnoise(s ^ 0x33cd, day / 1.9);
  const windDir = Math.PI + (dirN - 0.5) * 2.4 + 0.6 * (vnoise(s ^ 0x99af, day / 0.45) - 0.5); // rad, blowing TOWARD this
  let windSpeed = Math.max(0, 14 * (front(s ^ 0x5eed, day, 2.3, 0.5) - 0.28)) * (1 + 0.8 * precip); // m/s, 0..~17
  const storm = precip > 0.78 && windSpeed > 9; // rare: heavy rain + gusts + thunder

  // morning mist: some dawns (season-biased), thickening before sunrise, burnt off by mid-morning;
  // calm wet ground helps. A gift to raiders.
  const mistD = hash(s ^ 0x0f09, Math.floor(day)) + (MIST_BIAS[season] || 0) - 0.72; // is this a misty dawn?
  const mistH = hour > 3 && hour < 10 ? Math.sin(Math.PI * (hour - 3) / 7) : 0;       // 3 h–10 h, peak ~6:30
  const fog = precip > 0.05 || windSpeed > 6 ? 0 : Math.min(1, Math.max(0, mistD * 4) * mistH);

  // snow: precipitation falling through freezing air
  const freezing = temp < 0.5;
  const rain = freezing ? 0 : precip, snow = freezing ? precip : 0;

  // ground wetness: yesterday-and-the-day-before's rain, drying off (faster in summer heat).
  // Windowed integral of this same pure function — deterministic, stateless, identical everywhere.
  let wet = 0, snowCover = 0;
  const STEP = 0.125; // 3-hourly samples over the past 4 days
  for (let i = 32; i >= 1; i--) {
    const d = day - i * STEP, t = tempAt(s, d);
    const ff = front(s, d, 3.1, 0.7) + (RAIN_BIAS[seasonOf(d)] || 0);
    const p = Math.max(0, (ff - 0.65) / 0.35);
    const dry = (t > 14 ? 0.18 : 0.1) * STEP;                       // drying per step
    wet = Math.max(0, Math.min(1, wet + (t < 0.5 ? 0 : p) * 0.55 * STEP - dry));
    snowCover = Math.max(0, Math.min(1, snowCover + (t < 0.5 ? p : 0) * 0.9 * STEP - Math.max(0, t) * 0.035 * STEP));
  }
  wet = Math.max(wet, rain * 0.3); // raining now: at least slick

  // name the WEATHER entry the sim reads
  let key = "clear";
  if (snow > 0.05) key = snow > 0.5 ? "snow_heavy" : "snow_light";
  else if (storm) key = "thunderstorm";
  else if (rain > 0.05) key = rain > 0.55 ? "heavy_rain" : rain > 0.18 ? "rain" : "drizzle";
  else if (fog > 0.05) key = fog > 0.5 ? "fog_thick" : "fog_light";
  else if (cloud > 0.45) key = "overcast";

  return {
    key, temp, cloud, rain, snow, fog, wet, snowCover, storm,
    windSpeed, windDir, wind: { x: Math.cos(windDir) * windSpeed, y: Math.sin(windDir) * windSpeed },
    windFrom: compass(windDir + Math.PI),
  };
}

// Outdoor labour under a bad sky (economy.teamFactors): a touch slower, never crippling.
export const LABOR_WX = { drizzle: 0.97, rain: 0.92, heavy_rain: 0.8, thunderstorm: 0.75, snow_light: 0.9, snow_heavy: 0.75 };

// (the same compass battle.js and siege-war.js keep: sim +y is north)
export function compass(a) {
  const k = Math.round((((a * 180 / Math.PI) % 360 + 360) % 360) / 45) % 8;
  return ["east", "north-east", "north", "north-west", "west", "south-west", "south", "south-east"][k];
}

// ---------------------------------------------------------------- the world hook
// Installed on world sims that live on the calendar (the realm, the playtest year). Battles keep
// their setup-screen weather (battle.js cfg.weather) — unless cfg.weather is "calendar", when the
// setup reads this function once for the battle's day.
// w.weatherForce (or globalThis.HG_WEATHER_FORCE) pins the sky — the harness calibration guard:
// every existing scenario runs under forced clear, so the baselines stand.
export const WX_EVERY = 47; // ticks between samples (~5 real s; prime, off the vision cadence)
// a representative w.wx for each forced key (the force hook is for harnesses and dev shots: ?wx=…)
const FORCED = {
  clear: {}, overcast: { cloud: 0.7 }, drizzle: { rain: 0.15, cloud: 0.9, wet: 0.2 },
  rain: { rain: 0.5, cloud: 1, wet: 0.5 }, heavy_rain: { rain: 1, cloud: 1, wet: 0.8 },
  thunderstorm: { rain: 1, cloud: 1, wet: 0.8, storm: true, windSpeed: 12, wind: { x: 8.5, y: -8.5 }, windFrom: "north-west" },
  fog_light: { fog: 0.4, cloud: 0.3 }, fog_thick: { fog: 0.9, cloud: 0.4 },
  snow_light: { snow: 0.4, cloud: 0.9, snowCover: 0.6, temp: -1 }, snow_heavy: { snow: 1, cloud: 1, snowCover: 0.9, temp: -3 },
};
export function weatherSystem(w) {
  if (w.tick % WX_EVERY) return;
  const force = w.weatherForce || (typeof globalThis !== "undefined" && globalThis.HG_WEATHER_FORCE) || (typeof process !== "undefined" && process.env?.HG_WEATHER_FORCE);
  if (force) {
    if (w.weather !== force) {
      const F = FORCED[force] || {};
      w.weather = FORCED[force] ? force : "clear";
      w.wind = F.wind || null;
      w.wx = force === "clear" ? null : { temp: 12, cloud: 0, rain: 0, snow: 0, fog: 0, wet: 0, snowCover: 0, storm: false, windSpeed: 0, windDir: 0, windFrom: "west", ...F };
    }
    return;
  }
  if (!w.econ) return;
  const wx = weatherAt(w.weatherSeed ?? w.seed ?? 1, w.econ.doy);
  const was = w.wx;
  w.wx = wx;
  w.weather = wx.key;
  w.wind = wx.windSpeed > 0.5 ? wx.wind : null;
  // the chronicle notes the sky turning (cosmetic only: no saved state — a restore at worst repeats one line)
  if (was) {
    const kind = (k) => k.startsWith("snow") ? "snow" : k.startsWith("fog") ? "fog" : k === "thunderstorm" ? "storm" : k === "rain" || k === "heavy_rain" || k === "drizzle" ? "rain" : "fair";
    const a = kind(was.key), b = kind(wx.key);
    if (a !== b) w.events.push({ t: w.tick, kind: "weather", wx: b, was: a, windFrom: wx.windFrom, wet: wx.wet });
    if (was.wet <= 0.45 && wx.wet > 0.45) w.events.push({ t: w.tick, kind: "weather", wx: "mud", wet: wx.wet });
    if (was.wet > 0.45 && wx.wet <= 0.45) w.events.push({ t: w.tick, kind: "weather", wx: "dried", wet: wx.wet });
  }
}

// What a battle fought off the calendar is fought under (battle setup "by the calendar", sieges,
// and the chronicle): the sample plus the cfg fields battle.js already understands.
export function battleWeatherFor(seed, day) {
  const wx = weatherAt(seed, day);
  const cfg = { clear: "clear", overcast: "overcast", drizzle: "rain", rain: "rain", heavy_rain: "rain", thunderstorm: "rain", fog_light: "fog", fog_thick: "fog", snow_light: "overcast", snow_heavy: "fog" }[wx.key] || "clear";
  return { wx, cfg, afterRain: wx.wet };
}
