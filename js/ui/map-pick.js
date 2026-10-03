// The maps the game ships, and the ?map= choice threading.
// tools/stage-site.sh copies every maps/<dir>'s runtime files; a new generated map
// (tools/map/make_map.py, proven by tools/map-qa.mjs) is OFFERED on the setup screens by adding
// it here. The map must be chosen before the heavy load (js/main.js loads it first), so picking
// one reloads the page with ?map=<dir> — threaded like ?mode=. The realm ignores it: the realm
// server's world config names its own map (server/realm.mjs world.map).
export const MAPS = [
  { id: "vale", name: "The Vale of Harrow", towns: ["Ashby", "Rookham"],
    blurb: "The original river vale: two fords and a bridge, the Moss, Blackfell" },
  // generated: python3 tools/map/make_map.py --seed <seed> --name <id> --archetype <a> --relief <r> (maps/<id>/README.md)
  { id: "bradet", name: "The Bradet Levels", towns: ["Rathworth", "Thornworth"],
    blurb: "River-split lowland: the Bradet and the Crake meet mid-field, three banks, Har Scar and Bir Fell Gap" },
  { id: "grimetdale", name: "Grimetdale", towns: ["Hazelthorpe", "Redcote"],
    blurb: "Highland vale: two crag massifs over 300 m, the great Ket Mere, the pass of Mere Knowe Gap" },
  { id: "gosemarch", name: "The Gose March", towns: ["Oakwell", "Whitthorpe"],
    blurb: "Wooded borderland: the Gose between fells, Stan Crag, Lang Howe, a corrie tarn and Hazel Pike Gap" },
];

export function mapId() {
  let m = "vale";
  try { m = (new URLSearchParams(location.search).get("map") || "vale").replace(/^maps\//, "").replace(/[^\w-]/g, ""); } catch { /* headless */ }
  return MAPS.some((M) => M.id === m) ? m : "vale";
}
export const mapDir = () => "maps/" + mapId();
export const mapInfo = () => MAPS.find((M) => M.id === mapId()) || MAPS[0];

const go = (id, keep) => {
  const p = new URLSearchParams(location.search), q = new URLSearchParams();
  for (const k of keep) if (p.has(k)) q.set(k, p.get(k));
  if (id !== "vale") q.set("map", id);
  location.href = location.pathname + (q.toString() ? "?" + q.toString() : "");
};

// a row of map cards (campaign start screen); "" while only one map ships
export function mapRowHTML() {
  if (MAPS.length < 2) return "";
  return `<div class="sub">The land</div><div class="sp-row sp-maps" data-g="map">${MAPS.map((M) =>
    `<button data-map="${M.id}" class="${M.id === mapId() ? "on" : ""}"><b>${M.name}</b><small>${M.blurb}</small></button>`).join("")}</div>`;
}
export function wireMapRow(el, keep = ["banner", "mode"]) {
  el.querySelectorAll("[data-map]").forEach((b) => b.onclick = () => { if (b.dataset.map !== mapId()) go(b.dataset.map, keep); });
}

// a compact select (battle / siege setup bars); "" while only one map ships
export function mapSelectHTML() {
  if (MAPS.length < 2) return "";
  return `<label class="bs-mappick" title="Choosing another map reloads the setup">Map <select data-mapsel>${MAPS.map((M) =>
    `<option value="${M.id}"${M.id === mapId() ? " selected" : ""}>${M.name}</option>`).join("")}</select></label>`;
}
export function wireMapSelect(el, keep = ["banner", "mode"]) {
  const s = el.querySelector("[data-mapsel]");
  if (s) s.addEventListener("change", () => { if (s.value !== mapId()) go(s.value, keep); });
}
