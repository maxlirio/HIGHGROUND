// THE TOWN SWITCHER: a house's towns along the top of the screen (the seat and every daughter settlement, the columns of
// settlers on the road among them). Click one: the camera goes there and it becomes the town you are working in — the
// build menu's plots are its plan's, the line under the switcher is its own stores and people (each town keeps its own
// granary and labour; the silver is the house's). "Found a settlement" starts the founding mode (js/ui/settling.js).
// The keep panel of a daughter's manor hall says the same (decorateKeep).
const CSS = `
#townbar{position:absolute;top:38px;left:14px;z-index:6;display:flex;gap:6px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 260px);font:13px Georgia,serif}
#townbar button{padding:3px 9px;font-size:12px;background:rgba(36,31,23,.92)}
#townbar button.on{border-color:var(--gold,#d8b25a);color:#f5e2b2;box-shadow:0 0 0 1px rgba(216,178,90,.35) inset}
#townbar button small{color:#bfae88;margin-left:5px}
#townbar .found{color:#cfe3b2}
#townline{position:absolute;top:66px;left:14px;z-index:6;background:rgba(24,21,16,.86);border:1px solid #6b5a3a;border-radius:4px;padding:3px 9px;font:12px Georgia,serif;color:#e9e2cf;max-width:calc(100vw - 260px)}
#townline b{color:#d8b25a;font-weight:600;margin-right:6px}#townline span{margin-right:10px}#townline .warn{color:#e8876b}
.keeptown{margin-top:8px;border-top:1px solid #4a3d28;padding-top:6px;font-size:12px}.keeptown .row{margin:2px 0}
@media (max-width:640px){#townbar{top:36px;left:8px;max-width:calc(100vw - 16px)}#townline{top:64px;left:8px;max-width:calc(100vw - 16px)}}
`;
const STATE = { march: "on the road", camp: "camp", town: "", seat: "seat", lost: "lost" };
const t1 = (kg) => kg >= 10000 ? `${Math.round(kg / 1000)} t` : kg >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${Math.round(kg)} kg`;

export function makeTownsUI({ hud = document.body, summaries, focus, onSelect = () => {}, onFound = () => {}, seatName = () => "Your town" }) {
  const style = document.createElement("style"); style.textContent = CSS; document.head.append(style);
  const bar = document.createElement("div"); bar.id = "townbar"; hud.append(bar);
  const line = document.createElement("div"); line.id = "townline"; line.hidden = true; hud.append(line);
  let cur = null, key = "";
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.found !== undefined) { onFound(); return; }
    const id = b.dataset.town === "" ? null : b.dataset.town, s = list().find((q) => (q.id || null) === id);
    cur = id; onSelect(id); if (s) focus(s.x, s.y); refresh(true);
  });
  const list = () => (summaries() || []).filter((s) => !s.lost);
  function refresh(force = false) {
    const L = list(), k = JSON.stringify(L.map((s) => [s.id, s.name, s.state, s.hallProgress, s.settlers])) + cur;
    if (force || k !== key) {
      key = k;
      if (cur && !L.some((s) => s.id === cur)) { cur = null; onSelect(null); }
      bar.innerHTML = L.map((s) => {
        const nm = s.id ? s.name : seatName(), st = s.state === "camp" ? `camp · hall ${s.hallProgress}%` : s.state === "march" ? `on the road · ${s.settlers} settlers` : s.id ? "" : "";
        return `<button data-town="${s.id || ""}" class="${(s.id || null) === cur ? "on" : ""}" title="${s.id ? "A daughter settlement of your house" : "Your seat: the house's first keep"}">${nm}${st ? `<small>${st}</small>` : ""}</button>`;
      }).join("") + `<button data-found class="found" title="Send settlers out to found a new town: the plan is read from the land you pick">+ Found a settlement</button>`;
      bar.hidden = false;
    }
    const s = cur ? L.find((q) => q.id === cur) : null;
    if (!s || s.state === "march") { line.hidden = true; return; }
    line.innerHTML = `<b>${s.name}</b><span class="${s.days < 20 ? "warn" : ""}">Food ${t1(s.food)} · ${s.days} days</span><span>Timber ${t1(s.store.timber)}</span><span>Stone ${t1(s.store.stone)}</span><span>Firewood ${t1(s.store.firewood)}</span>`
      + `<span>${s.labour} hands · ${s.dependants} folk${s.camp ? ` (${s.camp} under canvas)` : ""}</span><span>${s.buildings} buildings · ${s.fields} fields</span><span title="One purse for the whole house">Silver: the house's</span>`;
    line.hidden = false;
  }
  // the keep panel of a daughter's hall (and the seat's): its town, and the way to found another
  function decorateKeep(panel, b, s) {
    if (!panel || !b || b.kind !== "town_hall") return;
    const div = document.createElement("div"); div.className = "keeptown";
    if (s && s.id) div.innerHTML = `<div class="row"><b>${s.name}</b> — a daughter settlement${s.form ? ` (${s.form} village)` : ""}${s.state === "camp" ? `: the settlers' camp; the hall ${s.hallProgress}% built` : ""}</div>`
      + `<div class="row">Food ${t1(s.food)} (${s.days} days) · timber ${t1(s.store.timber)} · stone ${t1(s.store.stone)}</div><div class="row">${s.labour} hands, ${s.dependants} folk, room for ${s.housing} · ${s.buildings} buildings, ${s.fields} fields</div>`
      + `<div class="row"><small>Its own granary and labour, run by its reeve; the silver and the learning are the house's.</small></div>`;
    div.innerHTML += `<div class="row"><button data-found-keep>Found a settlement…</button></div>`;
    panel.append(div);
    div.querySelector("[data-found-keep]").onclick = () => onFound();
  }
  return { refresh, decorateKeep, get current() { return cur; }, select(id) { cur = id; onSelect(id); refresh(true); }, bar, line };
}
