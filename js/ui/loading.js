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
// the steps fill the bar's first 60%; the models (most of a first entry's bytes: ~140 MB, minutes on a slow line) the rest —
// was 89% before a single model had arrived, and the bar then sat at 98-99% for minutes and looked hung
const PRE = 0.6; let modelsPhase = false;
// tips while the land loads: a new one every few seconds, starting somewhere different each time (only what the game does).
// Each is tagged with where it is true: c = any mode (the controls), w = war (every battle), t = the town (campaign and realm),
// r = the Realm only, k = ranked battles. A ranked battle shows only war and ranked tips (the owner: "the ranked battle tips should
// have to do with ranked battles, not with the realm game"); a pitched battle or siege only war ones.
const TIPS = [
  ["c", "Press F1 (or ?) for the Player's Handbook — controls, the economy, battle tactics, the Realm."],
  ["c", "Right-drag the ground with men selected to set where they stand and which way they face; the drag's length is their frontage."],
  ["c", "Every box-select makes the boxed men their own company. Hold Alt as you box to bring along the villagers caught in it too."],
  ["c", "Shift-click adds a step to a company's orders: march, then hold, then attack — a chain they follow in turn."],
  ["c", "Shift+M mutes the sound."],
  ["w", "Pikes braced in a steady line stop horses. Knights win against men caught in the open or already wavering."],
  ["w", "Rain soaks bowstrings — archery suffers — and days of it turn the roads to mud that slows marching and spoils a charge."],
  ["w", "Wind carries arrows further downwind, and fire spreads with it."],
  ["w", "Height matters: archers shoot further from a rise, a charge downhill hits harder, and men tire climbing."],
  ["w", "Most of a battle's dead fall in the rout, not the melee. Keep a reserve to chase — or to cover your own retreat."],
  ["w", "Archers sent at a distant company walk in to about 140 m, where their shafts actually hurt, then stand and loose."],
  ["w", "A company taken in the flank or rear breaks far sooner than one struck in front."],
  ["w", "Your men can burn woods, walls along any stretch, timber buildings and standing corn. Fire runs downwind, and rain drowns it."],
  ["t", "Right-click one of your companies (or press J) for broad tasks: Gather wood, Hunt, Forage, Fish, Farm… they find the nearest work themselves."],
  ["t", "Press M for the world map: everything you have explored. Click anywhere on it to send the camera there."],
  ["t", "A box selects only the men inside it. Click a crew's label for the whole crew, or a single serf for just him."],
  ["t", "Morning mist cuts how far everyone can see. Raiders love it."],
  ["t", "Research happens at the keep, one study per desk. A finished study leaves the desk idle until you pick the next."],
  ["t", "Capture a young strider or drake, pen it at the stables, and train it: your knights can learn to ride them."],
  ["t", "Striders are fast and cheap but fragile; drakes hit hard, frighten men and shrug off arrows — and eat meat."],
  ["t", "A white hart is seen in the vale only a few times a year. Few hunters ever take one."],
  ["t", "Two dragons sleep on far crags. Break one and it yields — claim it, feed it, and it may fight for your house."],
  ["t", "Your reeve runs the work while you're away and watches the food: short of it, he sends men hunting, fishing and to the fields."],
  ["t", "Nothing counts in your stores until someone carries it there: logs, sheaves, stone, meat."],
  ["t", "Walls must be gone through by the gates. Your own gates open for your men; an enemy's do not."],
  ["t", "Your own tasks keep their men even at harvest. Cancel a few for a fortnight and the reeve sends them to reap."],
  ["t", "While ripe corn stands in the fields, the reeve puts most hands to reaping and pauses the crafts and the stockpiles."],
  ["t", "Soldiers at home eat a soldier's ration and never farm. A big garrison is the quickest way to an empty granary."],
  ["t", "Children grow up: each year some of your dependants come of age and join the labourers."],
  ["t", "Families move in only when there's an empty cottage and bread enough to carry them to the next harvest."],
  ["t", "Click one villager to pick him out on his own. The reeve leaves him alone until you set him to work."],
  ["t", "A workshop asks \"How many?\" — 1, 5, 10 or for ever. It makes that many and stops, waiting out any shortage on the way."],
  ["t", "Men learn the spear by drilling at the Muster Hall, and to ride at the Stables while you have horses for them."],
  ["t", "Hobelars and scouts are raised only from men who can ride. Train some at the Stables first."],
  ["t", "If a company can't be raised, its recruit button says why, and what to do about it."],
  ["t", "A paddock beside a finished Stables, with six riding horses or more, breeds you a destrier or two a year."],
  ["t", "The bloomery turns 20 kg of ore and 30 kg of charcoal into about 4 kg of iron a day. Keep a crew at the charcoal kiln."],
  ["t", "Mining and lumber camps keep only a working heap. After the harvest, carters bring the rest home to your keep's yard."],
  ["t", "Your reeve sells surplus at your market. In its Sell section, set \"keep at least\" for anything you are saving."],
  ["t", "Stone is never sold unless you ask: set a \"keep at least\" for it and he sells only what lies above."],
  ["t", "A market earns tolls and stall fees every day, and four times as much in fair week. A house without one must cart its goods to town."],
  ["t", "Gold buys what silver can't: hired companies, destriers, mail and plate. The market's money-changer swaps gold for silver."],
  ["t", "Hired companies are paid in gold every day. Unpaid for three days, they march off."],
  ["t", "When a vein is worked out, send villagers to Prospect. Rocky hills and crags near old veins are the likeliest ground."],
  ["t", "A seam you find is nobody's until your men stand at it and raise your flag."],
  ["t", "Burnt woods are gone: no trees, no cover, no timber. They grow back over many months."],
  ["r", "Send a courier: right-click a villager and pick \"Send as courier…\". He walks the letter there; if he's killed, it's lost."],
  ["r", "In the Realm, leaving asks whether to warn you if your men see an attack. Your warden defends either way."],
  ["r", "In the Realm a new house has days of protection: nobody can attack it, and it can't attack anyone — until it chooses to."],
  ["r", "Your keep cannot fall while you are away (the Keep's Peace). Everything outside it can."],
  // ── ranked battles
  ["k", "Win ranked battles to earn spoils. Spend them in your camp on more men, better drill, stakes, special companies, skills and spells."],
  ["k", "Drill turns Raw men into Veterans, then Elites. It costs spoils for every man, so drill the companies that hold the line."],
  ["k", "In your camp, Split a company in two or Merge two of a kind, and choose where each one draws up."],
  ["k", "Bowmen with stakes driven before them are a wall to horse. Buy stakes for each bow company, or learn Master of Stakes."],
  ["k", "Special companies: Foresters wait in a wood, the Hidden Reserve behind your line, Pavisiers behind their stakes. Two at most."],
  ["k", "Your commander's skills: Iron Discipline, Drillmaster, Quartermaster, Hard Marchers, Eagle Eye, Master of Stakes."],
  ["k", "Eagle Eye shows you the foe's ambushes and hidden men before the trumpets sound."],
  ["k", "Spells are charges you buy in camp and spend on the field after the trumpets: Bless and Mend steady and heal, Thunderclap and Smite break the foe."],
  ["k", "Thunderclap on a line that is already wavering is how a close fight is won."],
  ["k", "During the deployment drag your companies anywhere on your lit ground, turn them, and pick their formation."],
  ["k", "\"What the scouts see\" lists the foe's men in sight before the battle — and how his lord likes to fight."],
  ["k", "Ranked fields are small: the hosts close at once. Men who run off the arena die there, so don't let a rout carry yours past the ring."],
  ["k", "A real lord looking for a battle at the same moment is always matched first; otherwise you meet another player's recorded host or a bot."],
  ["k", "Live battles: the trumpets wait until both lords press \"Sound the advance\". If you both must go, offer a draw."],
  ["k", "Your rating rises more for beating a stronger foe. A draw moves it little."],
];
// which tips fit the mode being loaded (from the page's address, as main.js reads it)
function tipsFor() {
  let q = null; try { q = new URLSearchParams(location.search); } catch { /* headless */ }
  const ranked = q && (q.get("mode") === "ranked" || q.has("live")), battle = q && (q.get("mode") === "battle" || q.get("mode") === "siege"), realm = q && q.has("realm");
  const ok = ranked ? "cwk" : battle ? "cw" : realm ? "cwtr" : "cwt";
  return TIPS.filter(([tag]) => ok.includes(tag)).map(([, text]) => text);
}
let tipT = null;
function rotateTips(el) {
  const box = el.querySelector(".ld-tip"); if (!box) return;
  const L = tipsFor(); let i = Math.floor(Math.random() * L.length);
  const show = () => { box.style.opacity = 0; setTimeout(() => { box.textContent = "Tip: " + L[i++ % L.length]; box.style.opacity = 1; }, 250); };
  show(); tipT = setInterval(show, 7000);
}
export function showLoading(mapName) {
  if (el) return;
  el = document.createElement("div"); el.id = "loading";
  el.innerHTML = `<div class="ld-card"><div class="ld-title">HIGHGROUND</div><div class="ld-sub">${mapName || "Vale of Harrow"}</div>
    <div class="ld-bar"><i></i></div><div class="ld-step">Preparing…</div><div class="ld-hint">Loading about 150 MB of hand-made models and textures — the first load takes longest.</div><div class="ld-tip"></div></div>`;
  try { performance.setResourceTimingBufferSize(5000); } catch { /* old browser */ } // (an entry is ~760 requests; the default 250 dropped the models from the MB count)
  document.body.append(el); bar = el.querySelector(".ld-bar i"); txt = el.querySelector(".ld-step"); t0 = performance.now(); rotateTips(el);
  tick();
}
function tick() { // a slow creep inside the current step, so the bar never looks frozen
  if (!el) return;
  if (modelsPhase) { requestAnimationFrame(tick); return; } // (the models' own count moves the bar now: loadingNote)
  const base = done.size / STEPS.length * PRE, next = (done.size + 1) / STEPS.length * PRE;
  const cur = parseFloat(bar.style.width || "0") / 100 || 0, target = base + (next - base) * 0.9;
  bar.style.width = (Math.min(target, cur + (target - cur) * 0.02 + 0.0004) * 100).toFixed(1) + "%";
  requestAnimationFrame(tick);
}
export function loadingStep(key) {
  if (!el) return;
  done.add(key);
  const i = STEPS.findIndex(([k]) => k === key), nextStep = STEPS[i + 1];
  bar.style.width = (done.size / STEPS.length * PRE * 100).toFixed(1) + "%";
  txt.textContent = nextStep ? nextStep[1] + "…" : "Ready";
}
// resolves when the loading screen lifts (or after `cap` ms regardless): work nobody sees or hears on the loading screen
// waits for it, so the models get the bandwidth and the main thread first
let lifted = null; const liftedP = new Promise((r) => { lifted = r; });
export const afterLoading = (cap = 150000) => Promise.race([liftedP, new Promise((r) => setTimeout(r, cap))]);
export function hideLoading() {
  lifted();
  if (!el || new URLSearchParams(location.search).has("holdload")) return;
  bar.style.width = "100%"; txt.textContent = "Ready";
  const e = el; el = null; clearInterval(tipT);
  e.classList.add("ld-out"); setTimeout(() => e.remove(), 600);
}
// a live note under the bar for the last stretch (models streaming in), with the bar crawling toward the end
export function loadingNote(text, frac = null) {
  if (!el) return;
  txt.textContent = text;
  if (frac !== null) { modelsPhase = true; bar.style.width = (Math.max(parseFloat(bar.style.width) || 0, (PRE + (1 - PRE) * Math.min(1, Math.max(0, frac))) * 100)).toFixed(1) + "%"; }
}
export function loadingStart() { if (txt) txt.textContent = STEPS[0][1] + "…"; }
// after the curtain lifts with models still on the way: a small note in the corner, counting them in, gone when they are
let rib = null;
export function modelsRibbon(text) {
  if (text == null) { rib?.remove(); rib = null; return; }
  if (!rib) { rib = document.createElement("div"); rib.id = "ld-rib"; rib.style.cssText = "position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:40;padding:5px 12px;border-radius:6px;background:rgba(20,17,12,.82);border:1px solid #5a4a2c;color:#d9c9a3;font-size:13px;pointer-events:none"; document.body.append(rib); }
  rib.textContent = text;
}
