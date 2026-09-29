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
  eye: `<path ${S} d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5" ${S}/>`,
  villager: `<path ${S} d="M6 21l6-10M12 11l3-7 3 1-2 6zM16 21l-5-8"/>`,
  trebuchet: `<path ${S} d="M4 21h16M7 21l5-9 5 9M4 5l16 10M4 5v3M18 13v4h3v-4z"/>`,
  ram: `<path ${S} d="M3 11l9-6 9 6M5 10v8M19 10v8M2 15h20M6 20a1.5 1.5 0 1 0 0 .1M18 20a1.5 1.5 0 1 0 0 .1"/>`,
  tower: `<path ${S} d="M7 21V5h10v16M7 5l-1-2h12l-1 2M17 8l4 3M7 11h10M7 16h10M9 21a1 1 0 1 0 0 .1M15 21a1 1 0 1 0 0 .1"/>`,
  mantlet: `<path ${S} d="M8 20l4-16h2l-4 16zM4 20h16M12 9h-5M11 14H6"/>`,
  ladder: `<path ${S} d="M8 21 11 3M16 21 19 3M8.8 16h8M9.6 11h8M10.4 6h8"/>`,
  mage: `<path ${S} d="M12 3l2.5 6 6 .5-4.6 4 1.5 6.5L12 16.5 6.6 20l1.5-6.5L3.5 9.5l6-.5z"/>`,
};
export const glyphSVG = (key) => `<svg viewBox="0 0 24 24">${GLYPHS[key] || GLYPHS.spear}</svg>`;
