// The building panel's "Pull it down" and "Rebuild in stone" (js/sim/demolish.js; js/ui/town.js shows them). Pulling down
// asks once more before the men are sent (the confirm row); rebuilding in stone is the palisade's own button, and the whole
// circuit's. In the realm the server decides (commands demolish / rebuild); the mirror only shows.
import * as EC from "../sim/economy.js";
import * as DM from "../sim/demolish.js";

const kg = (v) => v >= 10000 ? `${(v / 1000).toFixed(0)} t` : v >= 1000 ? `${(v / 1000).toFixed(1)} t` : `${Math.round(v)} kg`;
const list = (o) => Object.entries(o || {}).filter(([, n]) => n >= 1).map(([r, n]) => `${kg(n)} ${r}`).join(", ");
const ASK = new Map(); // bid → { what, until } — the confirm row, open for a few seconds (pure UI state)
const asking = (b, what) => { const a = ASK.get(b.id); return a && a.what === what && a.until > performance.now(); };
const NOW = () => (typeof performance !== "undefined" ? performance.now() : 0);

export function demolishHTML(w, b, team) {
  if (b.team !== team || b.field) return "";
  const def = EC.BUILDINGS[b.kind] || {}, T = w.teams[team];
  let h = `<div class="sub">${b.ruin ? "The ruin" : DM.UPGRADE[b.kind] ? "Rebuild in stone · pull down" : "Pull down"}</div><div class="raze">`;
  if (b.razing) {
    const R = b.razing, st = R.done < 1 / 3 ? "stripping it" : R.done < 2 / 3 ? "the frame coming down" : "grubbing out the footings";
    h += `<div class="row small warn">${b.ruin ? "Being cleared" : "Being pulled down"} · <b>${Math.round(R.done * 100)}%</b> — ${st}. Stage ${Math.min(DM.STAGES, R.paid + 1)} of ${DM.STAGES}; ${list(R.refund) || "nothing"} comes back to the store as it comes down.</div>`;
    if (R.done <= 0 && !R.paid) h += `<div class="btns"><button data-raze-cancel>Leave it standing</button></div>`;
    return h + `</div>`;
  }
  const up = b.upBy !== undefined ? w.buildings.find((o) => o.id === b.upBy) : null;
  if (up) h += `<div class="row small ok">Being rebuilt in stone · <b>${Math.round(up.progress * 100)}%</b> — the ${def.name} stands till the ${EC.BUILDINGS[up.kind].name} does.</div>`;
  if (b.replaces !== undefined && b.progress < 1) h += `<div class="row small ok">Rising in the place of the timber ${b.kind === "gatehouse" ? "gate" : "palisade"}: it stands till this is finished.</div>`;
  // rebuild in stone (a palisade stretch, a palisade gate)
  if (DM.UPGRADE[b.kind] && !up) {
    const c = DM.canUpgrade(w, team, b), to = EC.BUILDINGS[DM.UPGRADE[b.kind]];
    if (c.ok) {
      h += `<div class="btns"><button data-up="1" ${c.afford ? "" : "class=\"poor\""} title="The ${to.name} goes up in its place, by stages, while the timber still stands">Rebuild in stone <small>${list(c.cost)} · ${Math.round((to.labour || 0) * (to.perMetre ? Math.hypot(b.x2 - b.x1, b.y2 - b.y1) : 1)).toLocaleString("en")} man-days</small></button></div>`;
      if (b.kind === "palisade") {
        const n = w.buildings.filter((o) => o.team === team && o.town === b.town && (o.kind === "palisade" || o.kind === "gate") && !o.razing && o.upBy === undefined).length;
        if (n > 1) h += `<div class="btns"><button data-up="all" title="The builders rebuild every stretch, two at a time, as the stone comes in">The whole circuit in stone <small>${n} stretches and gates, one after another</small></button></div>`;
      }
      if (!c.afford) h += `<div class="row small warn">Not enough ${Object.keys(c.cost).filter((r) => (T.store?.[r] || 0) < c.cost[r]).join(", ")} in store yet.</div>`;
    } else h += `<div class="row small">Rebuild in stone: ${c.error}.</div>`;
  }
  if (T?.wallUp?.q?.length && (b.kind === "palisade" || b.kind === "gate" || b.kind === "stone_wall" || b.kind === "gatehouse")) h += `<div class="row small">The circuit in stone: ${T.wallUp.q.length} more waiting <button data-up="stop">Stop there</button></div>`;
  // pull it down (a ruin: clear it)
  const d = DM.canDemolish(w, team, b), verb = b.ruin ? "Clear the ruin" : b.progress < 1 ? "Give up the site" : "Pull it down";
  if (!d.ok) h += `<div class="row small">${verb}: ${d.error}.</div>`;
  else if (asking(b, "raze")) {
    const back = { ...d.refund }; for (const [r, n] of Object.entries(d.now || {})) back[r] = (back[r] || 0) + n;
    h += `<div class="row small warn">${b.ruin ? `Clear the ruin of the ${def.name}?` : `Pull down the ${def.name}?`} Men take it down in ${DM.STAGES} stages (~${Math.max(1, Math.round(d.labour))} man-days); ${list(back) || "nothing"} back to the store.${b.queue?.length ? " The men training here go on elsewhere, or home with their gear." : ""}${def.stores ? " Its goods stay in your stores." : ""}</div>`;
    h += `<div class="btns"><button data-raze-yes class="danger">Yes, ${b.ruin ? "clear it" : "pull it down"}</button><button data-raze-no>No</button></div>`;
  } else h += `<div class="btns"><button data-raze title="${b.ruin ? "Men clear the rubble; a little stone is saved" : "Men take it down in stages; part of its materials come back to the store"}">${verb}…</button></div>`;
  return h + `</div>`;
}

// run(op, args, done): the command layer (main.js panelActs.run); again(): the panel redrawn
export function bindDemolish(el, w, b, team, run, onChange, again) {
  const go = (op, a) => {
    if (!run) { onChange?.("Not available here"); return; }
    run(op, a, (r) => { onChange?.(r?.ok ? r.msg || "" : r?.error || "Refused"); again(); });
  };
  el.querySelector("[data-raze]")?.addEventListener("click", () => { ASK.set(b.id, { what: "raze", until: NOW() + 12000 }); again(); });
  el.querySelector("[data-raze-no]")?.addEventListener("click", () => { ASK.delete(b.id); again(); });
  el.querySelector("[data-raze-yes]")?.addEventListener("click", () => { ASK.delete(b.id); go("demolish", { bid: b.id }); });
  el.querySelector("[data-raze-cancel]")?.addEventListener("click", () => go("demolish", { bid: b.id, cancel: true }));
  el.querySelectorAll("[data-up]").forEach((bt) => bt.addEventListener("click", () => {
    const k = bt.dataset.up;
    go("rebuild", k === "stop" ? { stop: true } : { bid: b.id, all: k === "all" });
  }));
}
