// Loading screen: shows while the vale is prepared, step by step, so nobody wonders if it has crashed.
const STEPS = [
  ["map", "Surveying the land"],
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
// tips while the land loads: a new one every few seconds, starting somewhere different each time (only what the game does)
const TIPS = [
  "Right-click one of your companies (or press J) for broad tasks: Gather wood, Hunt, Forage, Fish, Farm… they find the nearest work themselves.",
  "Press M for the world map: everything you have explored. Click anywhere on it to send the camera there.",
  "Press F1 (or ?) for the Player's Handbook — controls, the economy, battle tactics, the Realm.",
  "Right-drag the ground with men selected to set where they stand and which way they face; the drag's length is their frontage.",
  "A box selects only the men inside it. Click a crew's label for the whole crew, or a single serf for just him.",
  "Shift-click adds a step to a company's orders: march, then hold, then attack — a chain they follow in turn.",
  "Pikes braced in a steady line stop horses. Knights win against men caught in the open or already wavering.",
  "Rain soaks bowstrings — archery suffers — and days of it turn the roads to mud that slows marching and spoils a charge.",
  "Wind carries arrows further downwind, and fire spreads with it.",
  "Morning mist cuts how far everyone can see. Raiders love it.",
  "Height matters: archers shoot further from a rise, a charge downhill hits harder, and men tire climbing.",
  "Most of a battle's dead fall in the rout, not the melee. Keep a reserve to chase — or to cover your own retreat.",
  "Research happens at the keep, one study per desk. A finished study leaves the desk idle until you pick the next.",
  "Capture a young strider or drake, pen it at the stables, and train it: your knights can learn to ride them.",
  "Striders are fast and cheap but fragile; drakes hit hard, frighten men and shrug off arrows — and eat meat.",
  "A white hart is seen in the vale only a few times a year. Few hunters ever take one.",
  "Two dragons sleep on far crags. Break one and it yields — claim it, feed it, and it may fight for your house.",
  "Your reeve runs the work while you're away and watches the food: short of it, he sends men hunting, fishing and to the fields.",
  "Nothing counts in your stores until someone carries it there: logs, sheaves, stone, meat.",
  "In the Realm, leaving asks whether to warn you if your men see an attack. Your warden defends either way.",
  "In the Realm a new house has days of protection: nobody can attack it, and it can't attack anyone — until it chooses to.",
  "Your keep cannot fall while you are away (the Keep's Peace). Everything outside it can.",
  "Walls must be gone through by the gates. Your own gates open for your men; an enemy's do not.",
  "Hold Alt while box-selecting to split the boxed men off as their own company.",
  "Shift+M mutes the sound.",
];
let tipT = null;
function rotateTips(el) {
  const box = el.querySelector(".ld-tip"); if (!box) return;
  let i = Math.floor(Math.random() * TIPS.length);
  const show = () => { box.style.opacity = 0; setTimeout(() => { box.textContent = "Tip: " + TIPS[i++ % TIPS.length]; box.style.opacity = 1; }, 250); };
  show(); tipT = setInterval(show, 7000);
}
export function showLoading(mapName) {
  if (el) return;
  el = document.createElement("div"); el.id = "loading";
  el.innerHTML = `<div class="ld-card"><div class="ld-title">HIGHGROUND</div><div class="ld-sub">${mapName || "Vale of Harrow"}</div>
    <div class="ld-bar"><i></i></div><div class="ld-step">Preparing…</div><div class="ld-hint">Loading about 150 MB of hand-made models and textures — the first load takes longest.</div><div class="ld-tip"></div></div>`;
  document.body.append(el); bar = el.querySelector(".ld-bar i"); txt = el.querySelector(".ld-step"); t0 = performance.now(); rotateTips(el);
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
  const e = el; el = null; clearInterval(tipT);
  e.classList.add("ld-out"); setTimeout(() => e.remove(), 600);
}
// a live note under the bar for the last stretch (models streaming in), with the bar crawling toward the end
export function loadingNote(text, frac = null) {
  if (!el) return;
  txt.textContent = text;
  if (frac !== null) bar.style.width = (Math.max(parseFloat(bar.style.width) || 0, (0.88 + 0.12 * Math.min(1, Math.max(0, frac))) * 100)).toFixed(1) + "%";
}
export function loadingStart() { if (txt) txt.textContent = STEPS[0][1] + "…"; }
