// Sound controls in the View panel: Master / Effects / Ambience sliders, Cues (optional drums & horns on
// battle start, charge, rout, victory — off by default) and Mute (also the M key). Remembered per browser.
const CSS = `.hgsnd{display:grid;grid-template-columns:auto 1fr;gap:2px 6px;align-items:center;font-size:11px;color:var(--dim);margin-bottom:4px}
.hgsnd input[type=range]{width:100%;height:14px;margin:0;accent-color:#c9a24a}
.views.hgsndb{margin-top:2px}`;

export function mountSoundUI(eng, panel) {
  if (!panel) return;
  const st = document.createElement("style"); st.textContent = CSS; document.head.append(st);
  const title = document.createElement("div"); title.className = "ovtitle"; title.innerHTML = "Sound <small>(⇧M mute)</small>";
  const grid = document.createElement("div"); grid.className = "hgsnd";
  for (const [key, label] of [["master", "Master"], ["sfx", "Battle"], ["amb", "Ambience"]]) {
    const l = document.createElement("span"); l.textContent = label;
    const r = document.createElement("input"); r.type = "range"; r.min = 0; r.max = 1; r.step = 0.01; r.value = eng.settings[key]; r.title = label + " volume";
    r.oninput = () => { eng.set(key, +r.value); if (key === "master" && eng.settings.muted && +r.value > 0) setMute(false); };
    grid.append(l, r);
  }
  const row = document.createElement("div"); row.className = "views hgsndb";
  const mute = document.createElement("button"), cues = document.createElement("button");
  cues.textContent = "Cues"; cues.title = "Drums and horns when a battle opens, at a charge, a rout, a victory (off: no music at all)";
  const setMute = (m) => { eng.set("muted", m); mute.textContent = m ? "Unmute" : "Mute"; mute.classList.toggle("on", m); if (!m) eng.resume(); };
  const setCues = (on) => { eng.set("cues", on ? 0.8 : 0); cues.classList.toggle("on", on); };
  mute.onclick = () => setMute(!eng.settings.muted); cues.onclick = () => setCues(!(eng.settings.cues > 0));
  setMute(!!eng.settings.muted); cues.classList.toggle("on", eng.settings.cues > 0);
  row.append(mute, cues);
  // after the render-quality row (the View block), before the Battlefield overlays
  const anchor = panel.querySelector(".views.quality");
  if (anchor) anchor.after(title, grid, row); else panel.append(title, grid, row);
  addEventListener("keydown", (e) => { if ((e.key === "m" || e.key === "M") && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.target.closest?.("input,textarea,select")) setMute(!eng.settings.muted); }); // (⇧M: plain M is the world map — js/ui/worldmap.js)
}
