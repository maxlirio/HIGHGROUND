// Place names for the UI: "Battle at Hob's Ford", "raiders near Beckfoot". Built from the map's named
// features, the two towns and the hamlets (maps/<map>/meta.json + settlements.json).
//
// A war may bring its OWN names for the same ground (js/sim/eras/names.js PLACES). The map is the Vale of Harrow
// whatever is being fought on it, but "The Battle of Wychwood Bottom" over a battle of 1944 is a label that lies.
// The Vale and the Marches keep the map's own names and nothing changes for them.
import { placeRenamer } from "../sim/eras/names.js";
const SKIP = new Set(["river", "farmland", "reverse_slope"]); // too big or too vague to name a spot by

export function makePlaces(map, settle, era = "vale") {
  const list = [];
  const clean = (s) => String(s).replace(/\s*\(.*?\)\s*/g, "").trim();
  for (const f of map.meta?.features || []) {
    if (!f.xy_m || SKIP.has(f.type)) continue;
    list.push({ name: clean(f.name), x: f.xy_m[0], y: f.xy_m[1], r: f.type === "town_site" ? 450 : f.type === "lake" || f.type === "marsh" || f.type === "wooded_valley" || f.type === "rocky_upland" ? 450 : 300 });
  }
  for (const h of settle?.hamlets || []) if (h.center) list.push({ name: h.name, x: h.center[0], y: h.center[1], r: 250 });
  for (const t of settle?.towns || []) {
    const hall = t.hall?.x !== undefined ? [t.hall.x, t.hall.y] : t.site && typeof t.site[0] === "number" ? t.site : null;
    if (hall && !list.some((p) => p.name === t.name)) list.push({ name: t.name, x: hall[0], y: hall[1], r: 450 });
  }
  // the war's own name for each place, settled once so a village is the same village every battle
  const rename = placeRenamer(era, list.map((p) => p.name).concat(["Ashby", "Rookham"]));
  for (const p of list) p.name = rename(p.name);
  // → { name, near } ; near=false when the spot is on the place itself
  function at(x, y) {
    let best = null, bd = Infinity;
    for (const p of list) { const d = Math.hypot(p.x - x, p.y - y) / p.r; if (d < bd) { bd = d; best = p; } }
    if (!best) return { name: `${Math.round(x)}, ${Math.round(y)}`, near: true, phrase: `at ${Math.round(x)}, ${Math.round(y)}` };
    const near = bd > 1;
    const dist = Math.hypot(best.x - x, best.y - y);
    const dir = near && dist > 700 ? " " + compass(x - best.x, y - best.y) + " of" : "";
    return { name: best.name, near, phrase: near ? `${dir ? `${(dist / 1000).toFixed(1)} km${dir}` : "near"} ${best.name}` : `at ${best.name}` };
  }
  const townName = (team) => rename(settle?.towns?.find((t) => t.team === team)?.name || (team === 0 ? "Ashby" : "Rookham"));
  return { at, townName, list, rename };
}

// compass words from the map's own axes (meta.json: +x east, +y north, metres)
function compass(dx, dy) {
  const a = Math.atan2(dy, dx) * 180 / Math.PI; // 0 = east, 90 = north
  const k = Math.round(((a + 360) % 360) / 45) % 8;
  return ["east", "north-east", "north", "north-west", "west", "south-west", "south", "south-east"][k];
}
