// Loading screen: shows while the vale is prepared, step by step, so nobody wonders if it has crashed.
const STEPS = [
  ["map", "Surveying the Vale of Harrow"],
  ["land", "Reading the land — slopes, streams, soil and woods"],
  ["world", "Placing hedges, woods and landmarks"],
  ["towns", "Mustering the hosts"],
  ["terrain", "Laying the ground"],
  ["textures", "Painting fields, meadows and marsh"],
  ["scene", "Raising buildings and trees"],
  ["figures", "Arming the men"],
  ["first", "First light"],
];
let el = null, bar = null, txt = null, done = new Set(), t0 = 0;
export function showLoading() {
  if (el) return;
  el = document.createElement("div"); el.id = "loading";
  el.innerHTML = `<div class="ld-card"><div class="ld-title">HIGHGROUND</div><div class="ld-sub">Vale of Harrow</div>
    <div class="ld-bar"><i></i></div><div class="ld-step">Preparing…</div><div class="ld-hint">Loading about 150 MB of hand-made models and textures — the first load takes longest.</div></div>`;
  document.body.append(el); bar = el.querySelector(".ld-bar i"); txt = el.querySelector(".ld-step"); t0 = performance.now();
  tick();
}
function tick() { // a slow creep inside the current step, so the bar never looks frozen
  if (!el) return;
  const base = done.size / STEPS.length, next = (done.size + 1) / STEPS.length;
  const cur = parseFloat(bar.style.width || "0") / 100 || 0, target = base + (next - base) * 0.9;
  bar.style.width = (Math.min(target, cur + (target - cur) * 0.02 + 0.0004) * 100).toFixed(1) + "%";
  requestAnimationFrame(tick);
}
export function loadingStep(key) {
  if (!el) return;
  done.add(key);
  const i = STEPS.findIndex(([k]) => k === key), nextStep = STEPS[i + 1];
  bar.style.width = (done.size / STEPS.length * 100).toFixed(1) + "%";
  txt.textContent = nextStep ? nextStep[1] + "…" : "Ready";
}
export function hideLoading() {
  if (!el || new URLSearchParams(location.search).has("holdload")) return;
  bar.style.width = "100%"; txt.textContent = "Ready";
  const e = el; el = null;
  e.classList.add("ld-out"); setTimeout(() => e.remove(), 600);
}
export function loadingStart() { if (txt) txt.textContent = STEPS[0][1] + "…"; }
