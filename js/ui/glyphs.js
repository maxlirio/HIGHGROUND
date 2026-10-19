// Unit-type glyphs, drawn by hand as SVG paths (24×24 box, white strokes on the team badge).
const S = 'fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
export const GLYPHS = {
  spear: `<path ${S} d="M5 20 19 6M19 6l-4 .5M19 6l-.5 4M8 19l-3-3"/>`,
  pike: `<path ${S} d="M3 21 21 3M21 3l-3.5.4M21 3l-.4 3.5M7 21 21 7M21 7l-2 .2"/>`,
  sword: `<path ${S} d="M6 18 18 6l1-3-3 1L4 16M4 16l4 4M5 21l-2-2M9 13l2 2"/>`,
  bow: `<path ${S} d="M7 3c8 3 11 11 7 18M7 3l7 18M4 12h15M19 12l-3-2M19 12l-3 2"/>`,
  crossbow: `<path ${S} d="M4 8c5-3 11-3 16 0M12 5v15M8 16l4 4 4-4M4 8l8 4 8-4"/>`,
  horse: `<path ${S} d="M5 20l2-6-2-3 4-6 3 1 4-2 2 3-3 2 1 4 3 7M10 11l3 1"/>`,
  lighthorse: `<path ${S} d="M5 20l2-6-2-3 4-6 3 1 4-2 2 3-3 2 1 4 3 7M4 4l16 16"/>`,
  strider: `<path ${S} d="M7 20l2-6c-2-1-2-4 0-5l3-1 3-5 3 1-2 4 1 6 2 6M9 20h2M16 20h2M12 9l4 2"/>`,
  drake: `<path ${S} d="M2 12l4 3c3 2 9 2 12 0l4-5-3 2-2-2M6 15l-1 5M10 16v4M15 16l1 4M19 10l-2-4"/>`,
  eye: `<path ${S} d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5" ${S}/>`,
  villager: `<path ${S} d="M6 21l6-10M12 11l3-7 3 1-2 6zM16 21l-5-8"/>`,
  trebuchet: `<path ${S} d="M4 21h16M7 21l5-9 5 9M4 5l16 10M4 5v3M18 13v4h3v-4z"/>`,
  ram: `<path ${S} d="M3 11l9-6 9 6M5 10v8M19 10v8M2 15h20M6 20a1.5 1.5 0 1 0 0 .1M18 20a1.5 1.5 0 1 0 0 .1"/>`,
  tower: `<path ${S} d="M7 21V5h10v16M7 5l-1-2h12l-1 2M17 8l4 3M7 11h10M7 16h10M9 21a1 1 0 1 0 0 .1M15 21a1 1 0 1 0 0 .1"/>`,
  mantlet: `<path ${S} d="M8 20l4-16h2l-4 16zM4 20h16M12 9h-5M11 14H6"/>`,
  ladder: `<path ${S} d="M8 21 11 3M16 21 19 3M8.8 16h8M9.6 11h8M10.4 6h8"/>`,
  mage: `<path ${S} d="M12 3l2.5 6 6 .5-4.6 4 1.5 6.5L12 16.5 6.6 20l1.5-6.5L3.5 9.5l6-.5z"/>`,
  bill: `<path ${S} d="M3.5 21.5 12.5 11.5M12.5 11.5 19.5 3.5M13.2 10.8 17.2 6.4 18.1 11.4zM18.4 5.9c2.3 1 2.7 3 1.3 4.7"/>`,
  greatsword: `<path ${S} d="M12 20.5V3.5M12 3.5 10.3 6.6M12 3.5l1.7 3.1M5 11h14M9.5 14.5h5"/>`,
  gun: `<path ${S} d="M2.5 20.5 10 15M10 15l6.6-4.9M15.4 8.6 18.6 13M20 7.6l1.4-2.4M21.6 9.8l2.2-.8M20.4 12.2l2 1.3"/>`,
  bowhorse: `<g transform="translate(2,5.6) scale(0.78)"><path ${S} d="M5 20l2-6-2-3 4-6 3 1 4-2 2 3-3 2 1 4 3 7"/></g><path ${S} d="M3 7.6c4.2-4.6 11.8-4.6 16 0M3 7.6h16M11 7.6V2.2M11 2.2 9.6 3.9M11 2.2l1.4 1.7"/>`,
  // ── the Riven Marches
  dwarf: `<path ${S} d="M5.5 10a6.5 6.5 0 0 1 13 0M4.5 10h15M8 10.6l4 9.6 4-9.6M9.6 13.6h4.8"/>`,
  orc: `<path ${S} d="M5.4 9.6h13.2M7.2 9.6v4.6c0 2.7 2.1 4.9 4.8 4.9s4.8-2.2 4.8-4.9V9.6M9.4 12.4h.01M14.6 12.4h.01M9.7 16.6 8.3 6.6M14.3 16.6l1.4-10"/>`,
  goblin: `<path ${S} d="M12 7.4c2.6 0 4.7 2.3 4.7 5.1s-2.1 5.4-4.7 5.4-4.7-2.6-4.7-5.4 2.1-5.1 4.7-5.1zM7.9 10.5 2.9 6.2M16.1 10.5 21.1 6.2M10.3 12.2h.01M13.7 12.2h.01"/>`,
  brute: `<path ${S} d="M12 4.4a1.9 1.9 0 1 0 .1 0M4.4 12.6 7 8.4h10l2.6 4.2-1.5 4.6H5.9zM4.9 13.2 3 19.6M19.1 13.2 21 19.6M9.3 17.2 8.7 21.6M14.7 17.2l.6 4.4"/>`,
  // ── The Ardennes, 1944. Each one is the thing's SILHOUETTE, because that is how the player tells them apart on
  // the field too: a rifle on the slant, a stubby gun with a magazine under it, a barrel on a tripod, a tube at
  // the sky, a long flat barrel behind a shield, a fat barrel lobbing, and the three vehicles by their running gear.
  rifle: `<path ${S} d="M3.6 20.4 15.4 8.6M15.4 8.6 20 4M4.9 19.1 2.8 17q1.2-1.2 2.4 0M9.2 14.8l1.9 1.9M13 11l1.6 1.6"/>`,
  smg: `<path ${S} d="M5.4 18.6 14.2 9.8M14.2 9.8 17 7M7.8 16.2 5.9 14.3M10.6 13.4l-2.4 4.2 3 1.7 2.4-4.2M15.6 8.4l1.5 1.5"/>`,
  mg: `<path ${S} d="M3.5 8.5h11M14.5 8.5H20M8.6 8.5 5.4 20.5M11.6 8.5v12M11.6 8.5 17 20.5M6.4 8.5c0 2.6 2 2.6 2 5.2M5.5 6.8h6.5"/>`,
  scope: `<path ${S} d="M3.6 20.4 15.4 8.6M15.4 8.6 19.6 4.4M4.9 19.1 2.8 17q1.2-1.2 2.4 0M9.2 14.8l1.9 1.9"/><circle cx="12.6" cy="8.2" r="2.5" ${S}/><path ${S} d="M12.6 5.7v5M10.1 8.2h5"/>`,
  mortar: `<path ${S} d="M6.8 20.6h7.2M10.2 20.6 16.4 7M13.4 14.2 7.6 17.4"/><circle cx="18" cy="3.9" r="1.5" ${S}/><path ${S} d="M18 2.4V.9M16.8 4.9 15.6 6M19.2 4.9l1.2 1.1"/>`,
  atgun: `<path ${S} d="M3.2 11.5h11.6M14.8 11.5h4.6M19.4 10.2v2.6M8.6 11.5v4.4M8.6 15.9 3.4 20.4M8.6 15.9l5.2 4.5M6.6 15.9a1.7 1.7 0 1 0 .1 0M11.2 8.6v6"/>`,
  pioneer: `<path ${S} d="M6.4 16.2 16.4 10.2M16.4 10.2l3.6-2.2M18.9 11.1 20.4 9.4M17.6 7.4l1.1-1.9M9.4 14.4l1.2 2M5.2 17.4 2.4 18.8M5.4 15.2 2.6 14.6M7 18.4l-1 2.6"/>`,
  car: `<path ${S} d="M2.6 14.6 4.8 9.8h9.4l3.8 2.4h3.4v2.4zM2.6 14.6h18.8M6.4 17a2 2 0 1 0 .1 0M16.4 17a2 2 0 1 0 .1 0M14.2 9.8v2.4M10.2 7.4V5"/>`,
  halftrack: `<path ${S} d="M2.4 13.6 4.6 8.6h5.2v5zM9.8 8.6h9.8v5H9.8zM18.2 8.6V6.4M2.4 13.6h17.2M6 16.2a2 2 0 1 0 .1 0M11.4 17.6h8.2c1 0 1-2.6 0-2.6h-8.2c-1 0-1 2.6 0 2.6zM13.4 16.3a.8.8 0 1 0 .1 0M17.6 16.3a.8.8 0 1 0 .1 0"/>`,
  tank: `<path ${S} d="M2.6 13.4h14.2v3.2H2.6zM5.4 13.4 7 9.6h6.6l1.6 3.8M9 9.6V7.4h3.4M12.4 8.4H21.4M21.4 7.4v2M3.4 18.6h12.6c1.2 0 1.2-2 0-2H3.4c-1.2 0-1.2 2 0 2zM6 17.6a.8.8 0 1 0 .1 0M10 17.6a.8.8 0 1 0 .1 0M14 17.6a.8.8 0 1 0 .1 0"/>`,
  howitzer: `<path ${S} d="M5.6 16.6 15.2 6.4M7.8 18.2 17.4 8M15.2 6.4l3.4-1.4M17.4 8l1.2-3M5.6 16.6 1.8 19.4M7.8 18.2l-1 3.2"/><circle cx="6.4" cy="19.1" r="2.3" ${S}/>`,
};
export const glyphSVG = (key) => `<svg viewBox="0 0 24 24">${GLYPHS[key] || GLYPHS.spear}</svg>`;

// ---------------------------------------------------------------- the sky on the HUD (docs/weather.md)
// Takes either a WEATHER key (js/sim/terrain-types.js: the sim's w.weather) or a setup-screen word.
export const WX_GLYPH = { clear: "☀", overcast: "☁", drizzle: "☂", rain: "☂", heavy_rain: "☂", thunderstorm: "↯", storm: "↯", fog_light: "≡", fog_thick: "≡", fog_dense: "≡", fog: "≡", snow_light: "❄", snow_heavy: "❄", snow: "❄", wind: "≋" };
export const WX_WORD = { clear: "Clear", overcast: "Overcast", drizzle: "Drizzle", rain: "Rain", heavy_rain: "Heavy rain", thunderstorm: "Storm", storm: "Storm", fog_light: "Mist", fog_thick: "Fog", fog_dense: "Fog", fog: "Fog", snow_light: "Snow", snow_heavy: "Heavy snow", snow: "Snow", wind: "High wind" };
export const wxBadge = (key) => `${WX_GLYPH[key] || "☀"} ${WX_WORD[key] || key || "Clear"}`;
