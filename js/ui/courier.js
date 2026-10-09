// "Send as courier…" (js/sim/couriers.js): the dialog that asks which house and what the letter says, and the house's
// Letters — what couriers have brought it, to read again. Plain text everywhere: every name and letter is escaped.
//
//   openCourierDialog(el, screen, { houses: [{ id, name, note }], men }, onSend({ to, text }), onCancel) → close()
//   lettersButton(card, modal, getLetters)   a "Letters" button on the realm card (a count of the unread ones)
import { LETTER_MAX } from "../sim/couriers.js";

const CSS = `
#orderpop.courier { width: min(360px, calc(100vw - 16px)); }
#orderpop.courier .cr-h { display: grid; gap: 3px; margin: 6px 0 8px; max-height: 180px; overflow: auto; }
#orderpop.courier .cr-h label { display: flex; gap: 6px; align-items: baseline; padding: 3px 6px; border: 1px solid var(--edge, #554); border-radius: 3px; cursor: pointer; font-size: 13px; }
#orderpop.courier .cr-h label small { color: var(--dim); font-size: 11px; margin-left: auto; }
#orderpop.courier .cr-h label:has(input:checked) { border-color: var(--gold); background: #3a3224; }
#orderpop.courier textarea { width: 100%; box-sizing: border-box; min-height: 84px; resize: vertical; font: 13px/1.35 Georgia, serif; background: #1b1812; color: inherit; border: 1px solid var(--edge, #554); border-radius: 3px; padding: 5px; }
#orderpop.courier .cr-n { font-size: 11px; color: var(--dim); text-align: right; }
#orderpop.courier .cr-b { display: flex; gap: 6px; justify-content: flex-end; margin-top: 6px; }
#orderpop.courier .cr-e { color: #d9a07e; font-size: 12px; min-height: 1em; }
#letters { position: fixed; inset: 0; display: grid; place-items: center; background: #0008; z-index: 60; }
#letters > div { width: min(520px, calc(100vw - 32px)); max-height: min(70vh, 640px); overflow: auto; background: var(--panel, #24201a); border: 1px solid var(--gold, #c9a45c); border-radius: 6px; padding: 14px 16px; box-shadow: 0 6px 30px #000a; }
#letters h2 { margin: 0 0 8px; color: var(--gold, #c9a45c); font-size: 18px; }
#letters ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
#letters li { border-left: 2px solid var(--gold, #c9a45c); padding: 4px 8px; }
#letters li b { display: block; font-size: 13px; } #letters li small { color: var(--dim, #998); font-size: 11px; }
#letters li p { margin: 4px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 14px/1.4 Georgia, serif; }
#letters .lt-b { text-align: right; margin-top: 10px; }
.rc-letters { margin-top: 4px; } .rc-letters b { color: var(--gold, #c9a45c); }
`;
let styled = false;
const style = () => { if (styled) return; styled = true; const s = document.createElement("style"); s.textContent = CSS; document.head.append(s); };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function openCourierDialog(el, screen, { houses = [], men = 1 } = {}, onSend, onCancel) {
  style();
  el.className = "courier";
  el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Send a courier");
  el.innerHTML = `<button class="x" data-cancel title="Close (Esc)" aria-label="Close">✕</button>
    <h4>Send a courier</h4>
    <div class="terr">${men > 1 ? "One of them" : "He"} walks to the house's keep with your letter, gives it into their hands, and comes home. If he is killed on the road, the letter is lost.</div>
    ${houses.length ? `<div class="cr-h" role="radiogroup" aria-label="To which house">${houses.map((h, k) => `<label><input type="radio" name="cr-to" value="${h.id}" ${k === 0 ? "checked" : ""}>${esc(h.name)}${h.note ? `<small>${esc(h.note)}</small>` : ""}</label>`).join("")}</div>
    <textarea data-text maxlength="${LETTER_MAX}" placeholder="Your letter (plain words, up to ${LETTER_MAX} characters)"></textarea>
    <div class="cr-n"><span data-n>0</span> / ${LETTER_MAX}</div>` : `<div class="terr">There is no other house to send to.</div>`}
    <div class="cr-e" data-err></div>
    <div class="cr-b"><button data-cancel2>Cancel</button>${houses.length ? `<button class="on" data-send>Send the courier</button>` : ""}</div>`;
  const ta = el.querySelector("[data-text]"), nEl = el.querySelector("[data-n]"), err = el.querySelector("[data-err]"), send = el.querySelector("[data-send]");
  let open = true;
  const cancel = () => { close(); onCancel?.(); };
  el.querySelector("[data-cancel]").onclick = cancel; el.querySelector("[data-cancel2]").onclick = cancel;
  if (ta) ta.oninput = () => { nEl.textContent = ta.value.length; err.textContent = ""; };
  if (send) send.onclick = () => {
    const to = +el.querySelector("input[name=cr-to]:checked")?.value, text = ta.value.trim();
    if (!Number.isInteger(to)) { err.textContent = "Choose a house"; return; }
    if (!text) { err.textContent = "Write the letter first"; ta.focus(); return; }
    close(); onSend({ to, text: text.slice(0, LETTER_MAX) });
  };
  const key = (e) => { // typing a letter is not giving orders: the game's keys stay out of it
    if (!open) return;
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
    else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send?.click(); }
    e.stopPropagation();
  };
  el.addEventListener("keydown", key);
  const away = (e) => { if (open && !el.contains(e.target)) cancel(); };
  setTimeout(() => open && addEventListener("pointerdown", away, true), 0);
  el.hidden = false;
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(screen.x + 12, innerWidth - r.width - 8)) + "px";
  el.style.top = Math.max(8, Math.min(screen.y + 12, innerHeight - r.height - 8)) + "px";
  (ta || el.querySelector("[data-cancel2]")).focus({ preventScroll: true });
  function close() {
    if (!open) return; open = false;
    el.hidden = true; el.className = ""; el.removeAttribute("role"); el.removeAttribute("aria-label");
    el.removeEventListener("keydown", key); removeEventListener("pointerdown", away, true);
  }
  return close;
}

// the house's letters, newest first
export function showLetters(letters, { dayOf = (L) => L.doy } = {}) {
  style();
  document.querySelector("#letters")?.remove();
  const box = document.createElement("div"); box.id = "letters";
  const list = [...(letters || [])].reverse();
  box.innerHTML = `<div role="dialog" aria-label="Letters"><h2>Letters</h2>
    ${list.length ? `<ul>${list.map((L) => `<li><b>From ${esc(L.fromName)}</b><small>${esc(dayOf(L) ?? "")}</small><p>${esc(L.text)}</p></li>`).join("")}</ul>` : `<div class="terr">No courier has come to your keep yet.</div>`}
    <div class="lt-b"><button class="on" data-close>Close</button></div></div>`;
  document.body.append(box);
  const close = () => { box.remove(); removeEventListener("keydown", key, true); };
  const key = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
  addEventListener("keydown", key, true);
  box.onclick = (e) => { if (e.target === box) close(); };
  box.querySelector("[data-close]").onclick = close;
  box.querySelector("[data-close]").focus({ preventScroll: true });
  return close;
}

// a "Letters" line on the realm card: how many, how many unread; click to read them
export function lettersButton(card, getLetters, opts = {}) {
  style();
  const row = document.createElement("div"); row.className = "rc-letters";
  row.innerHTML = `<button data-letters title="The letters couriers have brought to your keep">Letters</button>`;
  card.append(row);
  const btn = row.querySelector("button");
  let seen = (getLetters() || []).length, unread = 0;
  const draw = () => { const n = (getLetters() || []).length; btn.innerHTML = `Letters (${n})${unread ? ` · <b>${unread} new</b>` : ""}`; };
  btn.onclick = () => { unread = 0; seen = (getLetters() || []).length; draw(); showLetters(getLetters(), opts); };
  addEventListener("realm-letter", () => { unread = Math.max(0, (getLetters() || []).length - seen); draw(); });
  draw();
  return { draw };
}
