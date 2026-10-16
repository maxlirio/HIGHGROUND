// The year as the plants feel it (FLORA lane). One shared set of uniforms drives the seasonal look of
// every leaf in the game: tree/bush leaf cards and baked impostors (props.js / impostor.js) and the
// ground flora (flora.js). Render-only — the sim never reads any of this.
//
// setDoy(dayOfYear) is called each frame by flora.js from w.econ.doy (the calendar the HUD shows).
// The WEATHER lane owns sky/rain/snow; this is the shared seasonal hook — read SEASON.* freely, and
// anything that wants to drive or follow the season (snow on the ground when SEASON.bare is high, say)
// can import it from here rather than re-deriving the calendar.
import * as THREE from "three";

export const SEASON = {
  doy: { value: 172 },     // day of year, 0..365 (172 = midsummer default when no calendar is running)
  autumn: { value: 0 },    // 0..1 leaves turning (late Sep → early Nov)
  bare: { value: 0 },      // 0..1 broadleaf crowns down to twig-brown; ground flora gone (Nov → Mar)
  bloom: { value: 1 },     // 0..1 wildflowers out (May → early Sep)
  shroom: { value: 0.2 },  // 0..1 mushroom flush (strongest in autumn)
  ground: { value: 0 },    // 0..1 the grass gone dormant: straw/dun in winter, a little in late autumn (terrain.js)
};

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function setDoy(d) {
  if (!(d >= 0)) return;
  d = d % 365;
  if (Math.abs(d - SEASON.doy.value) < 0.25 && SEASON.doy.value === d) return;
  SEASON.doy.value = d;
  SEASON.autumn.value = sm(252, 280, d) * (1 - sm(318, 345, d));
  SEASON.bare.value = d > 180 ? sm(302, 348, d) : 1 - sm(72, 112, d);
  SEASON.bloom.value = sm(112, 142, d) * (1 - sm(238, 272, d));
  SEASON.shroom.value = 0.15 + 0.85 * sm(238, 265, d) * (1 - sm(305, 330, d));
  SEASON.ground.value = Math.max(d > 180 ? sm(296, 340, d) : 1 - sm(78, 120, d), 0.3 * SEASON.autumn.value);
}

// Which assets' leaf cards turn with the year, and what colour they turn. Conifers, dead wood and
// everything that is not a living broadleaf stay out of it (seasonCfg -> null). `thin` is how far the
// crown opens in winter: 1 for the trees (most leaf cards drop out, the limbs show), 0 for the thorns,
// hedges and bushes, which stay as dense dark twig masses — the dark accents that make bare oaks read.
const AUTUMN = {
  oak_a: "#9a6a2a", oak_b: "#9a6a2a", oak_c: "#9a6a2a", beech: "#a05a1e", birch: "#c9a02e",
  alder: "#7e7c30", willow: "#a8a238", fruit_tree: "#b89a30", rowan: "#b4511e", field_maple: "#c9a42e",
  hawthorn: "#8a5a26", bush: "#8a5a26", hedge_shrub: "#8a5a26", berry_bush: "#8a4a26",
};
const SHRUBS = new Set(["hawthorn", "bush", "hedge_shrub", "berry_bush"]);
const cfgCache = new Map();
export function seasonCfg(asset) {
  asset = String(asset).split("~")[0]; // (a render alias such as "willow~alder" wears the willow's leaves)
  if (!cfgCache.has(asset)) cfgCache.set(asset, AUTUMN[asset] ? { autCol: new THREE.Color(AUTUMN[asset]), thin: SHRUBS.has(asset) ? 0 : 1 } : null);
  return cfgCache.get(asset);
}

// The tint itself, shared by the card materials and the impostor shader. Operates on a display-space
// colour: pixels that read as living leaf-green drift to the species' autumn colour, then in winter to
// grey-brown twig (trees) or a dark umber twig mass (thorns and hedges); bark, fruit, buildings untouched.
// seasonDrop(): in winter a tree's leaf fragments drop out in ~1 m clumps (3D value noise), so the crown
// thins to its limbs and the land shows through — no geometry change, one noise per leaf fragment.
export const SEASON_GLSL = /* glsl */`
float sLeafy(vec3 c) { return clamp((c.g - max(c.r * .85, c.b)) * 6.5, 0., 1.); }
vec3 seasonize(vec3 c, float autumn, float bare, vec3 autCol, float thin) {
  float lum = dot(c, vec3(.3, .59, .11));
  float leafy = sLeafy(c);
  vec3 aut = autCol * (1.25 * lum / max(dot(autCol, vec3(.3, .59, .11)), 1e-3));
  c = mix(c, aut, autumn * leafy);
  vec3 twig = mix(vec3(.2, .16, .13) * (.45 + lum), vec3(.5, .45, .4) * (.4 + lum), thin); // umber thorn / grey-brown limb
  return mix(c, twig, bare * leafy * .92);
}
float sHash(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(sHash(i), sHash(i + vec3(1, 0, 0)), f.x), mix(sHash(i + vec3(0, 1, 0)), sHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(sHash(i + vec3(0, 0, 1)), sHash(i + vec3(1, 0, 1)), f.x), mix(sHash(i + vec3(0, 1, 1)), sHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
bool seasonDrop(vec3 albedo, vec3 p, float bare, float thin) {
  if (bare * thin < .01) return false;
  return sLeafy(albedo) > .3 && sNoise(p) < bare * thin * .9;
}`;
