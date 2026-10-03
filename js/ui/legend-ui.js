// Promotion window: a man did something legendary — pay gold to raise him up and choose abilities.
import { ABILITIES, DISPOSITIONS, abilityChoices, promote, nameOf, dispositionOf } from "../sim/legend.js";
import { ARM_BY_ID } from "../sim/arms.js";

export function showLegend(el, w, ev, onDone) {
  const S = w.S, id = ev.who; if (!S.alive[id]) return onDone?.();
  const name = nameOf(S.name[id]), arm = ARM_BY_ID[S.arm[id]].name;
  const choices = abilityChoices(w, id);
  const sg = w.sagas.get(id);
  const title = ev.rank >= 3 ? "A captain is born" : ev.rank === 2 ? "A name men repeat" : "Something legendary";
  el.innerHTML = `
    <div class="lg-card">
      <div class="lg-kicker">${title}</div>
      <h2>${name}</h2>
      <div class="lg-sub">${arm} · ${S.kills[id]} felled · wounds ${Math.round(S.wounds[id] * 100)}%</div>
      <ul class="lg-feats">${ev.feats.map((f) => `<li>${f.text}</li>`).join("")}</ul>
      ${ev.rank >= 3 ? `<p class="lg-note">Promote him and he can lead armies as a <b>${DISPOSITIONS[dispositionOf(sg)].name}</b>. You may leave battles to him.</p>` : ""}
      <div class="lg-choose">Choose ${ev.rank >= 2 ? "one gift" : "one gift"}:</div>
      <div class="lg-abil">${choices.map((k) => `<button data-a="${k}"><b>${ABILITIES[k].name}</b><small>${ABILITIES[k].desc}</small></button>`).join("")}</div>
      <div class="lg-foot"><span>Cost: <b>${ev.cost} gold</b></span><button data-x>Not now</button></div>
    </div>`;
  el.hidden = false;
  el.querySelector("[data-x]").onclick = () => { el.hidden = true; onDone?.(false); };
  el.querySelectorAll("[data-a]").forEach((b) => b.onclick = () => {
    const ok = promote(w, id, [b.dataset.a]);
    if (!ok) { b.closest(".lg-card").querySelector(".lg-foot span").innerHTML = `<b style="color:#e66">Not enough gold (${ev.cost})</b>`; return; }
    el.hidden = true; onDone?.(true);
  });
}
