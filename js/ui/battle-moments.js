// Decisive moments, shown as they happen — never pausing (real time runs on underneath):
//   · a card across the top of the view (what happened, where, when) with a "Look" button (G) that glides the
//     camera there; with "Glide the camera to decisive moments" on, the big ones glide it on their own unless
//     you have touched the camera in the last few seconds
//   · a line in the chronicle, a ping on the ground
//   · a horn cue for the sound designer: window event "hg-moment" { kind, team, good, mine, x, y, sal, horn }
//     horn ∈ "rally" (good for the player) | "alarm" (bad) | "victory" | "defeat" | "nightfall" | "advance" | "contact"
//   · the end of the battle: the verdict card, then the reckoning (js/ui/aftermath.js)
//   makeMoments(battle, deps) — deps = { camera, log(text, o), ping(x, y), seen(x, y), PLAYER, onEnd(outcome) }
export function makeMoments(B, deps) {
  const P = deps.PLAYER ?? 0, cam = deps.camera;
  const card = document.createElement("div"); card.id = "momentcard"; card.hidden = true; document.querySelector("#hud").append(card);
  let showing = null, hideT = 0, queue = [], lastTouch = -1e9, glide = null;
  const touched = () => { lastTouch = performance.now(); glide = null; };
  addEventListener("wheel", touched, { passive: true }); addEventListener("keydown", (e) => { if (/^(w|a|s|d|q|e|r|f|arrow)/i.test(e.key)) touched(); if ((e.key === "g" || e.key === "G") && showing) lookAt(showing); });
  addEventListener("pointerdown", (e) => { if (e.button === 1 || e.altKey) touched(); });
  function lookAt(m) {
    if (m.x === undefined) return;
    glide = { x0: cam.st.tx, y0: cam.st.ty, x1: m.x, y1: m.y, t: 0, d0: cam.goal.dist, d1: Math.min(cam.goal.dist, 420) };
  }
  const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  function show(m) {
    showing = m; hideT = performance.now() + (m.sal >= 0.9 ? 8000 : 6000);
    const tone = m.good === P ? "good" : m.good === 1 - P ? "bad" : "even";
    card.className = "mc-" + tone + (m.sal >= 0.9 ? " big" : "");
    card.innerHTML = `<div class="mc-k">${m.kicker}<span>${mmss(m.t)}</span></div><div class="mc-t">${m.text}</div>${m.x !== undefined ? `<button data-look>◉ Look <kbd>G</kbd></button>` : ""}`;
    card.querySelector("[data-look]")?.addEventListener("click", () => lookAt(m));
    card.hidden = false; card.classList.remove("in"); void card.offsetWidth; card.classList.add("in");
  }
  B.onMoment = (m) => {
    const visible = m.x === undefined || m.team === P || deps.seen(m.x, m.y) || m.sal >= 0.9;
    const mine = m.good === P;
    const horn = m.kind === "end" ? (m.good === P ? "victory" : m.good < 0 ? "nightfall" : "defeat") : m.kind === "advance" ? "advance" : m.kind === "contact" ? "contact" : mine ? "rally" : m.good === 1 - P ? "alarm" : "contact";
    try { dispatchEvent(new CustomEvent("hg-moment", { detail: { kind: m.kind, team: m.team, good: m.good, mine, x: m.x, y: m.y, sal: m.sal, horn, text: m.text } })); } catch { /* old browsers */ }
    if (!visible) return;
    deps.log(m.text, { ...(m.x !== undefined ? { x: m.x, y: m.y } : {}), tone: m.kind === "end" ? "fall" : mine ? "good" : m.good === 1 - P ? "bad" : undefined });
    if (m.x !== undefined && m.sal >= 0.5) deps.ping?.(m.x, m.y);
    if (m.sal < 0.45) return;
    if (showing && performance.now() < hideT && m.sal < showing.sal) { queue.push(m); queue = queue.sort((a, b) => b.sal - a.sal).slice(0, 2); }
    else show(m);
    if (B.cfg.follow && m.sal >= 0.7 && performance.now() - lastTouch > 4000) lookAt(m);
    if (m.kind === "end") deps.onEnd?.(B.rec.outcome, m);
  };
  B.frameMoments = (dt) => {
    if (showing && performance.now() > hideT) { card.hidden = true; showing = null; const n = queue.shift(); if (n && B.rec && B.rec.moments.at(-1).t - n.t < 20) show(n); }
    if (glide) {
      glide.t = Math.min(1, glide.t + dt / 1.4); const k = glide.t < 0.5 ? 2 * glide.t * glide.t : 1 - Math.pow(-2 * glide.t + 2, 2) / 2;
      cam.focus(glide.x0 + (glide.x1 - glide.x0) * k, glide.y0 + (glide.y1 - glide.y0) * k); cam.goal.dist = glide.d0 + (glide.d1 - glide.d0) * k;
      if (glide.t >= 1) glide = null;
    }
  };
  return { lookAt };
}
