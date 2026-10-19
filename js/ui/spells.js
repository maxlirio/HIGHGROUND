// Spells panel: low magic, rare and dear. Lists what the adepts can work (economy SPELLS), what each costs
// in mana and does, and whether it can be cast now — by castSpell's own rules: enough mana in the store and
// an adept among the villagers to work it. Mana is drawn by adepts at a ley line (60 at most in the store;
// an Adepts' Tower holds 200).
import * as EC from "../sim/economy.js";
import { SPELLS } from "../sim/econ-data.js";
import * as TC from "../sim/tech.js";

export const SPELL_INFO = {
  bless: { name: "Blessing", verb: "blesses", aim: "Click where the men need steadying", word: "An adept's blessing steadies the men" },
  mend:  { name: "Mending", verb: "mends", aim: "Click where the wounded lie", word: "Wounds close under an adept's hands" },
  mist:  { name: "Valley Mist", verb: "raises a mist", aim: "Click where the mist should rise from", word: "A mist rises out of the valley" },
  quench: { name: "Quench", verb: "quenches the fire", aim: "Click the burning buildings", word: "The flames gutter and die" },
};

export function adeptsOf(w, team) {
  let n = 0; for (const u of EC.workerUnits(w, team)) for (const id of u.members) if (EC.roleOf(w, id) === EC.ROLE.adept) n++;
  return n;
}
export const manaCap = (w, team) => EC.manaCapOf(w, team); // (60; an Adepts' Tower 200; Ley Lore +40 — js/sim/tech.js)
export function canCast(w, team, kind) {
  const Sp = SPELLS[kind], T = w.teams[team];
  if (!Sp) return "Unknown spell";
  if (!TC.spellOpen(w, team, kind)) return `Needs the study ${TC.TECHS[TC.SPELL_TECH[kind]].name} (Research)`;
  if (!adeptsOf(w, team)) return "No adept is left in the village to work it";
  if ((T.store.mana || 0) < Sp.mana) return `Needs ${Sp.mana} mana (you have ${Math.floor(T.store.mana || 0)})`;
  return null;
}

export function showSpells(el, w, team, onPick) {
  const T = w.teams[team], mana = T.store.mana || 0, cap = manaCap(w, team), adepts = adeptsOf(w, team);
  const tower = EC.hasBuilding(w, team, "mage_tower");
  const ley = (w.resources || []).filter((n) => n.kind === "ley");
  let html = `<button class="x" data-close>✕</button><h3>Spells</h3>
    <div class="stage">Mana <b>${Math.floor(mana)}</b> of ${cap} · ${adepts ? `${adepts} adept${adepts > 1 ? "s" : ""}` : "no adepts"}${tower ? " · Adepts' Tower" : ""}</div>
    <div class="bar"><i style="width:${Math.min(100, mana / cap * 100)}%"></i></div>
    <p class="sp-note">Magic here is quiet and rare. Your adepts draw mana at ${ley.length ? "the ley stones" : "a ley line"} while the village works; ${tower ? "the tower lets the store hold 200." : "an Adepts' Tower (Town stage) lets the store hold 200 instead of 60."}${TC.has(w, team, "ley_lore") ? " Ley lore adds 40." : ""}</p>
    <div class="buildlist">`;
  for (const [k, Sp] of Object.entries(SPELLS)) {
    const I = SPELL_INFO[k] || { name: k }, why = canCast(w, team, k);
    html += `<button data-sp="${k}" ${why ? "disabled" : ""} title="${why || ""}"><b>${I.name}</b> <span class="sp-cost">${Sp.mana} mana</span><small>${Sp.desc}${why ? ` — <em>${why}</em>` : ""}</small></button>`;
  }
  html += `</div><div class="hint">Pick a spell, then click the ground. <kbd>X</kbd> puts it away.</div>`;
  el.innerHTML = html; el.hidden = false; el.dataset.kind = "spells";
  el.querySelector("[data-close]").onclick = () => { el.hidden = true; el.dataset.kind = ""; };
  el.querySelectorAll("[data-sp]").forEach((b) => b.onclick = () => { el.hidden = true; el.dataset.kind = ""; onPick(b.dataset.sp); });
}
