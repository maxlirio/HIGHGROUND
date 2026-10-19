// The commander's powers in a pitched battle (?mode=battle).
//
// Ranked buys its charges in the camp; a pitched battle has no camp, so the commander takes a PURSE of power
// into the field (the era's `purse`) and spends it as he likes — one Earthshake or three Blessings. The era
// decides what he may call at all: js/sim/eras.js POWERS, cast by js/sim/ranked-rules.js castRanked, and drawn
// by js/render/spellfx.js. Nothing here touches the simulation itself.
import { eraOf, powersOf } from "../sim/eras.js";
import { castRanked } from "../sim/ranked-rules.js";

const esc = (t) => String(t).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

// kit: { w, era, PLAYER, canvas, groundAt, toast, phase }  → { el, destroy }
// phase() should return the battle's phase; nothing is cast while the lines are still being drawn up.
export function powerBar({ w, era = "vale", PLAYER = 0, canvas, groundAt, toast = () => {}, phase = () => "fight" }) {
  const P = powersOf(era), E = eraOf(era), kinds = Object.keys(P);
  if (!kinds.length) return { el: null, destroy() {} };
  let purse = E.purse || 180, armed = null;

  const bar = document.createElement("div"); bar.className = "pw-bar"; document.body.appendChild(bar);
  const draw = () => {
    bar.innerHTML = `<b>Powers<small>${purse}</small></b>` + kinds.map((k) => {
      const S = P[k], can = purse >= S.cost;
      return `<button data-pw="${k}" class="${armed === k ? "on" : ""}" ${can ? "" : "disabled"} title="${esc(S.desc)}">${esc(S.name)}<i>${S.cost}</i></button>`;
    }).join("") + (armed ? `<span>click the field…</span>` : "");
    bar.querySelectorAll("[data-pw]").forEach((b) => b.onclick = () => { armed = armed === b.dataset.pw ? null : b.dataset.pw; draw(); });
  };
  draw();

  const onDown = (e) => {
    if (!armed || e.button !== 0) return;
    const g = groundAt(e.clientX, e.clientY); if (!g) return;
    e.stopPropagation(); e.preventDefault();
    const k = armed; armed = null;
    const S = P[k];
    if (phase() === "deploy") toast("Powers wait for the trumpets");
    else if (purse < S.cost) toast("Not enough left in the purse");
    else if (castRanked(w, PLAYER, k, g.x, g.y, era)) { purse -= S.cost; toast(`${S.name}!`); }
    draw();
  };
  canvas.addEventListener("pointerdown", onDown, true);
  return { el: bar, destroy() { canvas.removeEventListener("pointerdown", onDown, true); bar.remove(); } };
}
