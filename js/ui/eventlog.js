// The chronicle: a collapsible log of notable events (bottom-right). Each entry carries a place on the
// map; clicking it swings the camera there. Real time never stops: this is a record, not a pause.
const MAX = 120;

export function makeEventLog(el, { onJump, dateOf }) {
  const entries = []; let open = true, unseen = 0;
  try { open = localStorage.getItem("hg.chron") !== "0"; } catch { /* private mode */ }
  el.innerHTML = `<div class="chron-h"><button data-tog title="Show / hide the chronicle">Chronicle <span class="chron-n"></span><i class="chron-car"></i></button></div><ol class="chron-list"></ol>`;
  const list = el.querySelector(".chron-list"), count = el.querySelector(".chron-n"), tog = el.querySelector("[data-tog]");
  const sync = () => {
    el.classList.toggle("closed", !open);
    count.textContent = !open && unseen ? `· ${unseen} new` : "";
  };
  tog.onclick = () => { open = !open; if (open) unseen = 0; try { localStorage.setItem("hg.chron", open ? "1" : "0"); } catch { /* ignore */ } sync(); };
  list.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-i]"); if (!li) return;
    const en = entries.find((x) => x.i === +li.dataset.i); if (en && en.x !== undefined) onJump(en.x, en.y);
  });
  let seq = 0;
  // tone: "good" (ours did well), "bad" (a loss), "" neutral, "magic", "legend"
  function add(text, { x, y, tone = "", team = null } = {}) {
    const en = { i: seq++, text, x, y, tone, when: dateOf() };
    entries.push(en); if (entries.length > MAX) entries.shift();
    const li = document.createElement("li"); li.dataset.i = en.i; li.className = (tone ? "t-" + tone : "") + (x !== undefined ? " jump" : "");
    if (team === 0 || team === 1) li.classList.add("tm" + team);
    li.innerHTML = `<time>${en.when}</time><span></span>`; li.querySelector("span").textContent = text;
    if (x !== undefined) li.title = "Show on the map";
    list.prepend(li);
    while (list.children.length > MAX) list.lastElementChild.remove();
    if (!open) unseen++;
    sync();
  }
  sync();
  return { add, entries, get open() { return open; } };
}
