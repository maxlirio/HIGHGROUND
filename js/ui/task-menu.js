// "What should they get on with?" — the menu of BROAD tasks for a company, opened by right-clicking it (its label or
// its men) or with J for the selection. A task has no spot: the men find the nearest work themselves and move on when
// it runs out (js/sim/broad.js). Only what fits these men is listed; what can't be done now is greyed with the reason.
// Keyboard: ↑/↓ (or ←/→) move, Enter/Space choose, 1–9 pick by number, Esc closes; a click elsewhere closes it too.
//
//   openTaskMenu(el, screen, { title, tasks: [{ id, name, hint, ok, why }], current }, onChoose(id), onCancel) → close()
const CSS = `
#orderpop.tasks { min-width: 260px; max-width: min(340px, calc(100vw - 16px)); }
#orderpop.tasks .tl { display: grid; gap: 3px; margin-top: 6px; }
#orderpop.tasks .tl button { display: grid; grid-template-columns: 18px 1fr; column-gap: 6px; align-items: baseline; padding: 4px 8px; }
#orderpop.tasks .tl button i { font-style: normal; font: 10px ui-monospace, monospace; color: var(--dim); }
#orderpop.tasks .tl button b { font-weight: 400; } #orderpop.tasks .tl button small { grid-column: 2; }
#orderpop.tasks .tl button:focus-visible, #orderpop.tasks .tl button:focus { outline: 1px solid var(--gold); outline-offset: 0; background: #3a3224; }
#orderpop.tasks .tl button.cur { border-color: var(--gold); } #orderpop.tasks .tl button.cur b::after { content: " · now"; color: var(--gold); font-size: 11px; }
#orderpop.tasks .tl button:disabled { opacity: .7; background: #221e17; } #orderpop.tasks .tl button:disabled small { color: #d9a07e; }
#orderpop.tasks .foot { margin-top: 7px; font-size: 11px; color: var(--dim); line-height: 1.35; }
#orderpop.tasks kbd { font: 10px ui-monospace, monospace; border: 1px solid var(--edge); border-radius: 3px; padding: 0 3px; }
`;
let styled = false;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function openTaskMenu(el, screen, { title, tasks, current = null, note = "" }, onChoose, onCancel) {
  if (!styled) { styled = true; const s = document.createElement("style"); s.textContent = CSS; document.head.append(s); }
  const list = tasks || [];
  el.className = "tasks";
  el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Tasks");
  el.innerHTML = `<button class="x" data-cancel title="Close (Esc)" aria-label="Close">✕</button>
    <h4>${esc(title)}</h4>
    <div class="terr">A broad task: they find the nearest work themselves and move on when it runs out.</div>
    ${note ? `<div class="terr">${esc(note)}</div>` : ""}
    <div class="tl" role="menu">${list.map((t, k) => `<button role="menuitem" data-t="${esc(t.id)}" ${t.ok ? "" : "disabled aria-disabled=\"true\""} class="${t.id === current ? "cur" : ""}" title="${esc(t.ok ? t.hint : t.why)}"><i>${k < 9 ? k + 1 : ""}</i><b>${esc(t.name)}</b><small>${esc(t.ok ? t.hint : t.why)}</small></button>`).join("") || `<div class="terr">Nothing for them here.</div>`}</div>
    <div class="foot">Any other order ends the task. <kbd>↑</kbd><kbd>↓</kbd> <kbd>Enter</kbd> · <kbd>1</kbd>–<kbd>9</kbd> · <kbd>Esc</kbd></div>`;
  const btns = [...el.querySelectorAll("[data-t]")], live = () => btns.filter((b) => !b.disabled);
  let open = true;
  const choose = (b) => { if (!b || b.disabled) return; close(); onChoose(b.dataset.t); };
  btns.forEach((b) => b.onclick = () => choose(b));
  el.querySelector("[data-cancel]").onclick = () => { close(); onCancel?.(); };
  const key = (e) => {
    if (!open) return;
    const L = live(), i = L.indexOf(document.activeElement);
    if (e.key === "Escape") { close(); onCancel?.(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowRight") L[(i + 1) % L.length]?.focus();
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") L[(i - 1 + L.length) % L.length]?.focus();
    else if (e.key === "Enter" || e.key === " ") choose(i >= 0 ? L[i] : L[0]);
    else if (/^[1-9]$/.test(e.key)) choose(btns[+e.key - 1]);
    else if (e.key === "Tab") { (e.shiftKey ? L[(i - 1 + L.length) % L.length] : L[(i + 1) % L.length])?.focus(); }
    else return; // (anything else: the game's keys as usual)
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  };
  const away = (e) => { if (open && !el.contains(e.target)) { close(); onCancel?.(); } };
  addEventListener("keydown", key, true);
  setTimeout(() => open && addEventListener("pointerdown", away, true), 0); // (not the right-click that opened it)
  el.hidden = false;
  const r = el.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(screen.x + 12, innerWidth - r.width - 8)) + "px";
  el.style.top = Math.max(8, Math.min(screen.y + 12, innerHeight - r.height - 8)) + "px";
  (live()[0] || el.querySelector("[data-cancel]")).focus({ preventScroll: true });
  function close() {
    if (!open) return; open = false;
    el.hidden = true; el.className = ""; el.removeAttribute("role"); el.removeAttribute("aria-label");
    removeEventListener("keydown", key, true); removeEventListener("pointerdown", away, true);
  }
  return close;
}
