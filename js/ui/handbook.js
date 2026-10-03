// The Player's Handbook — the bottom-left book button (F1 or ?): how to play, how a house grows, how battles are won,
// the beasts, the Realm, and a few settings. Never pauses the game.
//
// Every statement here was checked against the code it describes (2026-10). The tables of stages, buildings, recruits
// and workshop recipes are generated from the game's own data (js/sim/townplan.js STAGES, js/sim/econ-data.js), so they
// cannot drift; the prose numbers quote js/sim/* and server/houses.mjs — if you change one of those, change the prose.
// HANDBOOK is exported separately from the DOM code so it can be imported (and searched, tested) in node.
import { STAGES } from "../sim/townplan.js";
import { BUILDINGS, RECRUITS, RECIPES, SPELLS } from "../sim/econ-data.js";
import { ARMS } from "../sim/arms.js";
import { techList, BRANCHES } from "../sim/tech.js"; // the research track (docs/tech.md "For other code"): listed from its data, never by hand
import { ESTATE_TEXT, UPGRADES } from "../sim/estates.js"; // the late game's great buildings: what each does, from the sim's own table

const K = (k) => `<kbd>${k}</kbd>`;
const kg = (v) => v >= 1000 ? `${+(v / 1000).toFixed(1)} t` : `${+v.toFixed(1)} kg`;
const MASS = new Set(["timber", "iron", "rope", "hemp", "wool", "charcoal", "ore", "stone"]); // (recipe inputs weighed in kg; the rest are counted)
const bName = (k) => BUILDINGS[k]?.name || k.replace(/_/g, " ");
const aName = (k) => ARMS[k]?.name || k.replace(/_/g, " ");
const costOf = (d) => {
  const m = Object.entries(d.mat || {}).map(([r, v]) => `${kg(v)} ${r}`);
  if (d.money) m.push(`${d.money} d`);
  return (m.join(", ") || "no materials") + (d.perMetre ? " per metre" : "") + ` · ${d.labour} man-days${d.perMetre ? " per metre" : ""}`;
};

// ---- tables built from the game's data
const stageTable = () => `<div class="tw"><table><tr><th>Stage</th><th>Opens when you have (finished)</th><th>What you may then build</th></tr>${STAGES.map((S, i) => {
  const needs = Object.entries(S.needs).map(([k, n]) => `${n} × ${bName(k)}`).join(", ") || "from the start";
  const kinds = S.kinds.filter((k) => BUILDINGS[k] && !BUILDINGS[k].prebuiltOnly).map(bName).join(", ");
  return `<tr><td><b>${i + 1}. ${S.name}</b></td><td>${needs}</td><td>${kinds}</td></tr>`;
}).join("")}</table></div>`;
const costTable = () => `<div class="tw"><table><tr><th>Building</th><th>Materials · labour</th></tr>${STAGES.flatMap((S) => S.kinds).filter((k) => BUILDINGS[k] && !BUILDINGS[k].prebuiltOnly).map((k) => `<tr><td>${bName(k)}</td><td>${costOf(BUILDINGS[k])}</td></tr>`).join("")}</table></div>`;
const recruitTable = () => `<div class="tw"><table><tr><th>Building</th><th>Raises</th></tr>${Object.entries(BUILDINGS).filter(([, d]) => d.recruits?.length).map(([k, d]) => `<tr><td>${d.name}</td><td>${d.recruits.map(aName).join(", ")}</td></tr>`).join("")}</table></div>`;
const musterTable = () => `<div class="tw"><table><tr><th>Company</th><th>Drawn from</th><th>Gear per man</th><th>Days</th><th>Pay</th></tr>${Object.entries(RECRUITS).filter(([, R]) => !R.perUnit).map(([k, R]) => `<tr><td>${aName(k)}</td><td>${R.from.join(", ")}</td><td>${Object.entries(R.gear).map(([g, n]) => `${n} ${g}`).join(", ")}${R.optGear ? `<br><small>if in store: ${Object.keys(R.optGear).join(", ")}</small>` : ""}</td><td>${R.days}${R.rushedDays ? ` <small>(rushed ${R.rushedDays})</small>` : ""}</td><td>${R.pay ? `${R.pay} d/day` : `none at home${R.payAway ? `, ${R.payAway} d away` : ""}`}</td></tr>`).join("")}</table></div>`;
const engineTable = () => `<div class="tw"><table><tr><th>Engine</th><th>Crew</th><th>Takes from the store</th></tr>${Object.entries(RECRUITS).filter(([, R]) => R.perUnit).map(([k, R]) => `<tr><td>${aName(k)}</td><td>${R.crew}</td><td>${Object.entries(R.gear).map(([g, n]) => `${g === "timber" ? kg(n) : n} ${g.replace(/_/g, " ")}`).join(", ")}</td></tr>`).join("")}</table></div>`;
const recipeTable = () => `<div class="tw"><table><tr><th>Workshop</th><th>Makes (inputs per batch)</th></tr>${Object.entries(RECIPES).map(([k, R]) => `<tr><td>${bName(k)}</td><td>${Object.entries(R).filter(([, r]) => r && typeof r === "object").map(([p, r]) => `<b>${(r.batch || 1) > 1 ? r.batch + (MASS.has(p) ? " kg " : " ") : ""}${p.replace(/_/g, " ")}</b> ← ${Object.entries(r.needs).map(([x, n]) => `${MASS.has(x) ? kg(n) : n} ${x}`).join(", ")}${r.fuel ? `, ${kg(r.fuel)} charcoal` : ""}`).join(" · ")}</td></tr>`).join("")}</table></div>`;
// the technology track, from js/sim/tech.js techList(): by branch, each study's stage, what it needs first, cost, days, effect
const hesc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const techCost = (c) => Object.entries(c || {}).map(([r, v]) => r === "silver" ? `${v} d` : `${MASS.has(r) || r === "hay" || r === "grain" ? kg(v) : v} ${r.replace(/_/g, " ")}`).join(", ");
const techTable = () => { let list = []; try { list = techList(); } catch { list = []; }
  if (!list.length) return `<p>The list of studies is not to hand.</p>`;
  return BRANCHES.map((B) => { const L = list.filter((t) => t.branch === B.id).sort((a, b) => a.tier - b.tier || a.stage - b.stage); if (!L.length) return "";
    return `<p><b>${hesc(B.name)}</b> — <i>${hesc(B.blurb || "")}</i></p><div class="tw"><table><tr><th>Study</th><th>Needs first</th><th>Cost · days</th><th>What it gives</th></tr>${L.map((t) => `<tr><td><b>${hesc(t.name)}</b>${t.stage > 0 ? `<br><small>${hesc(t.stageName)} stage</small>` : ""}</td><td>${[...t.needs, ...(t.building ? [bName(t.building)] : [])].map(hesc).join(", ") || "—"}</td><td>${hesc(techCost(t.cost))} · ${hesc(t.days)} days</td><td>${hesc(t.effect)}</td></tr>`).join("")}</table></div>`; }).join(""); };
// the great works (js/sim/estates.js): each late building, its stage, the study it needs, what it does
const greatTable = () => `<div class="tw"><table><tr><th>Building</th><th>Stage · needs first</th><th>What it does</th></tr>${STAGES.flatMap((S, i) => S.kinds.map((k) => [k, i])).filter(([k]) => ESTATE_TEXT[k] && BUILDINGS[k]).map(([k, i]) => { const d = BUILDINGS[k];
  return `<tr><td><b>${bName(k)}</b>${d.unique ? "<br><small>one to a house</small>" : ""}</td><td>${i + 1}. ${STAGES[i].name}${d.tech ? `<br><small>the study ${d.techName || d.tech}</small>` : ""}${UPGRADES[k] ? `<br><small>raised on your ${bName(UPGRADES[k])}</small>` : ""}</td><td>${ESTATE_TEXT[k]}</td></tr>`; }).join("")}</table></div>`;
const spellList = () => `<ul>${Object.entries(SPELLS).map(([k, S]) => `<li><b>${{ bless: "Blessing", mend: "Mending", mist: "Valley Mist" }[k] || k}</b> (${S.mana} mana): ${S.desc}</li>`).join("")}</ul>`;

export const HANDBOOK = [
  // ======================================================================== 1
  { id: "start", title: "Getting started", intro: "The world does not wait for you, and nor does this book: the game runs on while you read.", subs: [
    { h: "The camera and its four views", html: `<p>Pan with ${K("W")}${K("A")}${K("S")}${K("D")} or the arrow keys, or drag with the middle button. The wheel zooms. ${K("Q")} and ${K("E")} turn the view, ${K("R")} and ${K("F")} tilt it, and ${K("⌥")}/Alt-drag orbits freely.</p>
<p>${K("V")} steps through the four views, which are also buttons in the View panel on the right:</p>
<ul><li><b>Map</b>: straight down, like a war map.</li><li><b>Eagle</b>: the usual command view.</li><li><b>Oblique</b>: lower, to read the ground.</li><li><b>Ground</b>: near eye level, to see what the men see.</li></ul>` },
    { h: "The world map", html: `<p>Press ${K("M")}, or the map button above the book (bottom left), for the <b>world map</b>: a cartographer's sheet of everything your house has explored. It is also <b>World map</b> in the View panel. ${K("M")} again or ${K("Esc")} closes it.</p>
<ul><li><b>Never seen</b>: blank parchment. The map shows nothing you have not been near, and learns a place's name only when you go there.</li><li><b>Explored</b>: the land, faded, with other houses' buildings <b>as you last saw them</b>.</li><li><b>In sight now</b>: bright, with the men, game and dragons that are there.</li></ul>
<p>Your keeps, buildings and companies (with how many men are in each) are always shown. Other houses' men appear only where you can see them now. The dragons' lairs are known to every lord. A legend, a compass and a scale bar in metres are on the sheet; the dashed frame is where you are looking.</p>
<p><b>Click</b> anywhere to go there. <b>Drag</b> to pan, and use the <b>wheel</b> (or pinch) to zoom in. Hover over a spot for its name and what is known of it. The game runs on while the map is open.</p>` },
    { h: "Selecting your men", html: `<ul><li>Click a company's <b>label</b>, or drag a box round the men.</li>
<li>${K("⇧")}/Shift adds to what you already have.</li>
<li>${K("Ctrl/⌘")}+${K("1–9")} makes the selection a group. ${K("1–9")} recalls it; tap twice to look at it. ${K("⇧")}+${K("1–9")} adds a group to the selection.</li>
<li>${K("B")} takes the whole army.</li>
<li>${K("X")} deselects, and so does a plain right-click on empty ground. Not ${K("Esc")}: on a Mac that leaves full screen.</li></ul>
<p>With nothing selected, a click on a building opens its panel, and a click on open ground tells you what the land gives and what would stand well there.</p>` },
    { h: "Giving orders", html: `<p>With men selected, <b>click the ground</b>. A small menu asks <i>what should they do there?</i>: March, Hold here, Attack, and whatever else makes sense at that spot (Hunt a herd, Build, Dig in, Ladders…). It also shows the ground: rise, slope, cover and defensibility.</p>
<p><b>Click an enemy</b>, his label or his men, to go for him wherever he goes. A second menu asks in what formation and at what pace; ${K("Enter")} sends them.</p>
<p>The tag by the pointer always says what a click will do. ${K("⌥")}/Alt-click gives orders <i>at that spot</i>, even over enemy men. In the menu, <b>Pace</b> is March, Quick or Run.</p>` },
    { h: "Where they stand and which way they face", html: `<p><b>Right-drag on the ground.</b> Press where the line should stand and drag the way it should face. An arrow shows the facing, and the frontage is drawn across its foot. <b>The longer the drag, the wider the line</b>, and a long drag makes a shallow line.</p>
<p>Let go and the order menu opens with that facing already set.</p>` },
    { h: "Chains of orders and forming up", html: `<p>${K("⇧")}-click the ground, or tick <b>Add as next step</b> in the menu, to queue an order after the ones they already have: march here, then there, then hold.</p>
<p>${K("U")} is <b>“Form up!”</b>. The selected companies re-form their ranks where they stand, in their formation. Use it after a charge has scattered them.</p>` },
    { h: "Tasks: broad jobs for a company", html: `<p><b>Right-click one of your companies</b> (its label or its men), or press ${K("J")} with men selected, for its Tasks. A task is a broad job with no spot to pick: they find the nearest work themselves and move on to the next when it runs out. The menu says where they would go and how far.</p>
<ul><li><b>Villagers:</b> Gather wood, Quarry stone, Mine ore, Forage, Hunt, Fish, Farm (tend the fields), Build (help the nearest unfinished site), Haul (carry loads into the stores), and Back to the reeve (their usual work).</li>
<li><b>Soldiers:</b> Hunt (the nearest herd), Gather wood and Quarry stone (they cut it and carry it home on their backs, slower than villagers), Patrol the town, and Back to the keep.</li></ul>
<p>A greyed task says why it can't be done (“no hunting grounds within reach”, “no field needs hands now”). The reeve leaves a crew on a task alone. When nothing is left within reach they stop, and the chronicle says why; villagers go back to the reeve's work. Hunters never go after a herd kept for the stables (capturing young is always your own click on the herd), nor wolves, bears or the white hart.</p>
<p>Any other order ends the task. A plain right-click on empty ground still deselects, and a right-drag still sets facing. In the menu, ${K("↑")}${K("↓")} and ${K("Enter")} or ${K("1")}–${K("9")} choose; ${K("Esc")} closes it.</p>` },
    { h: "How orders travel", html: `<p>An order is not obeyed the instant you give it. It goes from the commander to the company's captain:</p>
<ul><li><b>By voice</b> within 30 m, in about 2 s.</li><li><b>By horn</b> within 250 m, in about 5 s. A horn carries only the simple calls (hold, charge, assault, retire, move, rally, escalade), and is now and then misheard; then the men stand fast.</li><li><b>By rider</b> beyond that. Riders can be taken by enemies near their road (another is sent), and can garble the spot.</li></ul>
<p>However far the rider, no order takes more than about <b>5 seconds</b> to arrive and be acted on. A company whose captain has fallen is slower until a sergeant takes his place. Rain, storm and fog make calls harder to hear.</p>` },
    { h: "Your lord in the field", html: `<p><b>Take the field</b> puts your lord on the field, a knight with his household. ${K("Tab")} switches between riding as him and the eagle view; ${K("H")} looks at him.</p>
<p>In the saddle: ${K("WASD")} ride, ${K("⇧")} gallop, ${K("Z")} walk or trot, the mouse looks, ${K("click")} strikes (hold and release for a committed blow), right button or ${K("Space")} guards, ${K("F")} couches the lance, ${K("E")} dismounts or mounts. Hold ${K("Q")} for the order wheel (Follow me, Charge, Hold, Rally to me, Form line, Form wedge), or press ${K("1–6")} while it is open.</p>
<p>${K("C")} frees the cursor: select and order exactly as from above, while ${K("WASD")} still rides. Orders go out <i>from where he stands</i>, so a near company hears his voice at once. ${K("T")} “Follow me!”, ${K("Y")} “Rally to me!” (heard within 250 m; his cry also steadies running men near him). He can fall, or be taken and held for ransom.</p>` },
    { h: "Captains", html: `<p>Every company has a captain. Select one and its panel shows him and an <b>Initiative</b> switch: <b>On</b>, <b>Ask me</b> or <b>Off</b>, with an <b>Army</b> button to set the default for all.</p>
<p>On <i>Ask me</i> (the default) a captain who sees a chance puts a card at the top left: charge their unguarded bowmen, take a flank, pursue, fall back, get into cover, help a company in trouble. Answer <b>Do it now</b> or <b>No</b>. If you say nothing in 8 seconds, he does it. See <i>Battle</i> for more.</p>` },
    { h: "Every key at a glance", html: `<div class="tw"><table>
<tr><td>${K("1–9")} · ${K("Ctrl/⌘")}+${K("1–9")} · ${K("⇧")}+${K("1–9")}</td><td>recall a group · make one · add one</td></tr>
<tr><td>${K("B")}</td><td>the whole army</td></tr>
<tr><td>click · drag a box · ${K("⇧")}</td><td>select · select many · add</td></tr>
<tr><td>click ground / an enemy</td><td>the order menu / the attack menu</td></tr>
<tr><td>${K("⌥")}-click</td><td>orders at this spot, even over enemies</td></tr>
<tr><td>right-drag</td><td>where they stand and which way they face</td></tr>
<tr><td>right-click a company · ${K("J")}</td><td>its Tasks (broad jobs) · the selection's Tasks</td></tr>
<tr><td>${K("⇧")}-click</td><td>add as the next step</td></tr>
<tr><td>${K("U")}</td><td>form up</td></tr>
<tr><td>${K("X")} or right-click empty ground</td><td>deselect</td></tr>
<tr><td>${K("T")} · ${K("Y")} · ${K("H")}</td><td>follow me · rally to me · find the lord (lord in the field)</td></tr>
<tr><td>${K("Tab")}</td><td>ride as the lord ↔ eagle view</td></tr>
<tr><td>${K("WASD")} ${K("⇧")} ${K("Z")}</td><td>ride · gallop · walk (in the saddle)</td></tr>
<tr><td>${K("click")} · ${K("RMB")}/${K("Space")} · ${K("F")} · ${K("E")}</td><td>strike · guard · lance · dismount (in the saddle)</td></tr>
<tr><td>${K("C")} · hold ${K("Q")}</td><td>free the cursor to command · the order wheel (in the saddle)</td></tr>
<tr><td>${K("WASD")}/arrows · wheel · middle-drag</td><td>pan · zoom · pan</td></tr>
<tr><td>${K("Q")}/${K("E")} · ${K("R")}/${K("F")} · ${K("⌥")}-drag</td><td>turn · tilt · orbit</td></tr>
<tr><td>${K("V")}</td><td>next view: Map, Eagle, Oblique, Ground</td></tr>
<tr><td>${K("M")}</td><td>the world map (everything you have explored)</td></tr>
<tr><td>${K("⇧")}${K("M")}</td><td>mute</td></tr>
<tr><td>${K("F1")} or ${K("?")}</td><td>this handbook</td></tr></table></div>` },
  ] },

  // ======================================================================== 2
  { id: "economy", title: "Economy", intro: "A house lives on what its people carry home. You set the plan; the reeve sets the hands.", subs: [
    { h: "Villagers and the reeve", html: `<p>Your villagers work on their own. A <b>reeve</b> shares them out every few moments, by what the house needs most:</p>
<ul><li>the harvest first, and carting the stooks;</li><li>putting out fires;</li><li>wild food in a lean season;</li><li>building sites;</li><li>workshops, and adepts at the ley line;</li><li>fishing and weeding;</li><li>timber, firewood, stone and ore up to a sensible stock;</li><li>practice at the butts;</li><li>ploughing and sowing.</li></ul>
<p>You may still order them yourself: select them, click a resource, a field or a building site, and choose <b>Work</b> or <b>Build</b>. Click a workshop and choose <b>Work here</b> to make them its crew. An ordered <b>move</b> holds while they walk and for about <b>5 seconds</b> after they arrive; then they go back to their usual work (“Villagers finished your order”). To keep a crew at a kind of work, give it a <b>Task</b> instead (right-click it: Gather wood, Farm, Haul…): the reeve leaves it alone, and it moves on by itself when the work runs out.</p>` },
    { h: "Growing your people", html: `<p>No building trains villagers. Your people grow in two ways, and the <b>keep's panel</b> shows both (click the keep, or the <b>People</b> count at the top: hover it for the short version).</p>
<ul><li><b>Births:</b> about <b>3.5</b> a year for every 100 people, fewer when rations are short (half as many at no food). About <b>3</b> in 100 die of age each year.</li>
<li><b>Families moving in:</b> landless families come to a village with room, bread and order: a man and a woman who work, and two or three children and elders (4.5 people on average). At best <b>one family every 3 days</b> (0.35 a day, at full pace with 10 or more empty places, slower with fewer).</li></ul>
<p>A family comes only when <b>all</b> of these hold:</p>
<ul><li>at least <b>5 empty places</b> in your homes: a <b>Cruck House</b> holds 5 (6 with jettied timber framing), the keep 45;</li><li>more than <b>20 days of food</b> in store;</li><li>unrest under <b>35%</b>;</li><li>not besieged.</li></ul>
<p>A new house starts <b>overfull</b>. About 200 settlers crowd the keep and a <b>settlers' camp</b> of tents for 90. The camp folds by 5 as each cottage goes up, so the first cottages only rehouse the settlers: it takes some <b>30 Cruck Houses</b> before the first family comes. The keep's panel counts them for you. When unrest rises above half, people start to <b>leave</b>.</p>` },
    { h: "Days and seasons", html: `<p>Work is counted in <b>days</b> and <b>man-days</b>: one worker's ten-hour day. Time runs fast. In a single game <b>one real minute is 1.5 days</b>, so a long match is about one campaign season. In the Realm the year runs slower: a day takes 4 real minutes, and a year about a real day.</p>
<p>A game begins on <b>1 May</b>, in the hungry gap before harvest. The crops ripen from late July (peas) to mid-August (oats).</p>` },
    { h: "The fields' year", html: `<p>The land is grass: there are no fields until your men make them. Pick <b>Open Field</b> from <b>Build</b>, then press on the ground at one corner and drag to size it. The field lies square to your view, so turn the camera (Q/E) to angle it; its long side is the way the strips and furrows will run. The outline is green where the men can make it and red where they cannot (water, too steep, a building, a road, another field, too far from the town), with its size, the trees in it and the work it takes. Click inside it to lay it out. The men <b>clear</b> it first: woodmen fell every tree in it and the logs go to the store, then the stumps and bushes are grubbed out and the brush is cut. Then it is worked through its year:</p>
<ol><li><b>Plough.</b> The first ploughing breaks the sod. An ox team turns it; by spade it is four times slower.</li><li><b>Sow.</b> The seed comes from the stores.</li><li><b>Weed</b> through the growing weeks.</li><li><b>Reap and bind</b> the ripe crop into stooks.</li><li><b>Cart</b> the stooks home.</li><li><b>Thresh</b> them into grain, keeping seed back for next year.</li></ol>
<p>Fields follow a rotation of wheat, barley, oats and peas, with a fallow year.</p>
<p>The <b>soil</b> decides the harvest: click open ground with nothing selected to see whether it is rich, fair or poor. A field sown late, after mid-April, gives a thinner crop. Ripe corn left standing more than three weeks starts to shed.</p>` },
    { h: "Timber, boards and firewood", html: `<p>Woodmen at a <b>Lumber Camp</b> fell, limb and drag the logs to the landing, where they are stored.</p>
<p>When the stores hold timber to spare, two sawyers at the camp's saw-pit rip logs into <b>boards</b>. About 60% of a log becomes boards, and the slabs become firewood.</p>
<p><b>Firewood</b> is cut when the stock runs low. Every soul burns about 1 kg a day.</p>
<p>A <b>Collier's Clamp</b> burns 720 kg of timber down to 120 kg of <b>charcoal</b>, the fuel the smithy and the bloomery need.</p>` },
    { h: "Stone, ore and iron", html: `<p>A <b>Mining Camp</b> beside a quarry or ore-bed works it: quarry faces with sledges, adits with ore tubs, pits with baskets. A man cuts about 1.5 t of stone a day, but only 300 kg of ore.</p>
<p>Ore becomes iron at a <b>Bloomery</b>: 6.7 kg of ore and 10 kg of charcoal make 1 kg of iron. The smithy turns iron into arms.</p>` },
    { h: "Silver and gold veins: held and taken", html: `<p>Wages are paid in coin, and coin comes from the <b>veins</b>. In the Realm <b>every hold has its own silver vein</b>, at the foot of a crag 500–1000 m from its keep, and the house there <b>holds it from the start</b>: its flag flies on the pole by the mine mouth. The map's other veins (Blackfell, Cold Knowe…) are prizes, held by whoever holds them.</p>
<ul><li><b>Only the holder's men mine a vein.</b> "Mine silver", "Mine here" and the reeve all refuse another house's vein, and say whose it is. A Mining Camp goes up only at a vein you hold or that nobody holds — staking one at an unheld vein claims it.</li>
<li><b>Taking one:</b> kill the men who work it, then stand your soldiers at it (within 40 m) with <b>none of the holder's men left alive there</b>. Your flag goes up over 10 seconds; if their men come back, or yours leave, it stops. Once it is up the vein is yours, and their mining camp there becomes yours with what is stored in it. Click a vein with soldiers selected: <b>Take the vein</b>.</li>
<li><b>You can't take</b> a vein from a house under the newcomer's protection or the Keep's Peace, nor from anyone you are not at war with. Both houses hear of a taking in the chronicle, and the loser is sent a notice if they asked to be told of attacks.</li></ul>
<p>The world map shows every vein with its holder's banner.</p>` },
    { h: "Hunting, fowling, fishing and forage", html: `<p>Hunters stalk and shoot. A kill counts as food only once the carcass is carried home, racked and butchered. Fowlers flush ducks and geese, which take wing. Fishers and foragers work the waters and the wild.</p>
<p>Each brings in only a few kilos a day, but it is fresh food, and in a lean season the reeve sends hands to it.</p>
<p>Fish stocks come back slowly. A herd hunted down to its last beast is gone for good.</p>` },
    { h: "Stores, and why carrying matters", html: `<p><b>Nothing counts until it is carried into a store.</b> Wood felled in the forest, stone in the quarry, sheaves in the field: none of it is yours until someone sets it down in a store that takes it. Mana is the one exception.</p>
<div class="tw"><table><tr><th>Store</th><th>Takes</th></tr>
<tr><td>Keep &amp; Manor</td><td>everything (grain up to 25 t); fresh food goes only here</td></tr>
<tr><td>Granary &amp; Barn</td><td>grain, sheaves, seed, hay (grain up to 60 t)</td></tr>
<tr><td>Lumber Camp</td><td>timber, firewood, boards</td></tr>
<tr><td>Mining Camp</td><td>stone, ore, silver, clay</td></tr></table></div>
<p>A building site rises only as its materials arrive. Its panel shows how much is on site.</p>
<p>When the village is large enough, storemen keep the bigger stores.</p>` },
    { h: "Bread, rations and spoilage", html: `<p>Each day a dependant eats about <b>0.65 kg</b> of grain or its worth, a labourer <b>1 kg</b>, and a soldier <b>1.2 kg</b>. Destriers eat grain too.</p>
<p>The village eats fresh food first, then grain, then sheaves. It eats its <b>seed</b> only in desperation.</p>
<p>Fresh food spoils fast, about 6% a day. Grain keeps well, and far better in a granary than in the open. A granary that burns loses most of its corn.</p>
<p><b>Without a mill</b>, grinding by hand-quern costs the village about 6% of its labour. With one, the miller takes his toll of a sixteenth.</p>` },
    { h: "Hunger, cold and unrest", html: `<p>When rations run short, work slows, down to about half pace.</p>
<p><b>Unrest</b> rises from hunger, unpaid wages, a siege, a cold hearth (no firewood) and recent losses. After about three weeks of hunger people begin to die, the dependants first.</p>
<p>The <b>lean season</b> comes when the stores will not last until the harvest. Then the reeve sends hands to gather wild food.</p>
<p>The reeve keeps a <b>food watch</b>. When the food in hand and the coming harvest will not carry the village a year, he lays out new fields on open ground near the village, the same way you do, choosing flat, dry ground with few trees beside the fields you have; his men clear them and break the sod. He builds nothing else and pulls nothing down, and the chronicle tells you. When less than about 60 days of food is in sight, food comes before walls and crafts: the cut stooks are carted in first, the fields are ploughed and sown, and up to half the hands hunt, forage and fish. The flocks are slaughtered a few at a time, and he buys grain if you have a market. A besieged village cannot do any of this. Its flocks are outside the walls and it starves as it always did.</p>
<p>Hungry soldiers at home tire and fret, and hunger, arrears and unrest all make men desert.</p>` },
    { h: "Growth and silver", html: `<p>Families come to a house that has room, food and peace. Newcomers need:</p>
<ul><li>at least 5 free places in its cottages (a Cruck House holds 5);</li><li>more than 20 days of food;</li><li>no siege;</li><li>low unrest.</li></ul>
<p>When unrest runs high, people leave. Births and deaths turn over slowly, and births follow the rations.</p>
<p><b>Silver</b> comes in as rents and dues of 0.4 d a head each day, but nothing while besieged. It goes out as wages for building and craft work, and as soldiers' pay. Retained men at home draw a quarter of their pay; on campaign, more than 1.5 km from the keep, they draw it in full.</p>` },
    { h: "Feeding an army in the field", html: `<p>A company within <b>550 m</b> of a keep or granary eats from it.</p>
<p>Farther out, <b>supply carts</b> go to it on their own, three carters to each cart or string of packhorses (“A supply cart sets out for the army”). They never take the village's last 14 days of food, or 30 before harvest.</p>
<p>The line is <b>cut</b> when an enemy is within about 200 m of the road, when the town is besieged, or when there is no food or cart to send. Then the army lives on its baggage. Convoys can be caught and lost.</p>
<p>Out of supply, men forage enemy fields, stop recovering from fatigue, fret and desert. Levies go home after 40 days, or when their own corn is ripe.</p>` },
  ] },

  // ======================================================================== 3
  { id: "progression", title: "Progression", intro: "A vill does not grow anyhow: it grows on a plan, stage by stage, from hamlet to walled town — and on to a borough, a cathedral city and a ducal seat.", subs: [
    { h: "The keep", html: `<p>Every house begins with its <b>Keep &amp; Manor</b>. You never build one: it comes with the land. It is your first store (it takes everything), it houses the household, it sees far, and it raises Levy Spearmen, Spearmen, Longbowmen, Hobelars and Scouts.</p>
<p>The <b>Church &amp; Infirmary</b> likewise comes with the land. Its infirmary heals the wounded.</p>
<p>An old village may already stand around them with a smithy, a weaver and a mill. A new foundation, as in the Realm, begins with the keep alone.</p>` },
    { h: "The stages of a town", html: `<p>Each stage opens when the one before it has the buildings it needs, <i>finished</i>. The <b>Build</b> menu at the top shows your stage and what the next one still lacks.</p>${stageTable()}` },
    { h: "The great works: borough, city and ducal seat", html: `<p>A walled town is not the end. Past it lie three more stages, for a house that means to last: the <b>Chartered Borough</b>, the <b>Cathedral City</b> and the <b>Ducal Seat</b>. Their buildings are great works — months of masons' labour, hundreds of tonnes of stone and a chest of silver each — and every one of them changes how your house lives:</p>
<ul><li><b>The castle grows with the house.</b> A <b>Motte &amp; Bailey</b> first (an earth mound and a timber tower, the Town stage). Later, with mortar learned, a <b>Shell Keep</b> is raised <i>on</i> that motte: click your motte with it chosen. The motte serves until the stone stands, then the shell keep takes its place. Last, with <i>Concentric Design</i> learned, a <b>Concentric Castle</b>: moat, two rings of walls, towers and a barbican. A castle makes your keep hold out longer once the enemy is at its gate (the best one you have counts), and its castle-guard cuts the fee of the men you keep at home.</li>
<li><b>Some need a study first</b> (Research): the Mint needs <i>Licence to Coin</i>, the Minster <i>Rib Vaults &amp; Flying Buttresses</i>, the College <i>Studium Generale</i>, the Tiltyard <i>Heralds &amp; the Round Table</i>.</li>
<li><b>One to a house</b>, most of them: a second guildhall adds nothing. Each kind's effect counts once.</li>
<li><b>Their stone and silver are paid when you lay them out</b>, like any building: save up (a minster wants 1,600 t of stone and 18,000 d). Masons set the pace on stone: each keeps 5 labourers at work (more with mortar and rib vaults).</li></ul>${greatTable()}
<p>The AI lords raise them too, one at a time, once their vill is a Town with a season's food in store and silver to spare.</p>` },
    { h: "Placing buildings", html: `<p>Pick a building from <b>Build</b>: the land is read for it and the ground lights up green wherever it can stand — brighter where it suits it best — and faint red where your town's ground will not take it (a field you draw yourself: see <i>The fields' year</i>). A footprint follows the pointer, snapped to the nearest good spot and turned to face the lane; it says why a spot is good, or why not. Click to stake it out.</p>
<ul><li>every building wants dry ground (no water, marsh or bare rock), level enough for it, off the roads, the fields and the other buildings, within your town's reach (about 300 m of the keep, 210 m for a new village, or near what it has built);</li><li>cottages and crafts like to front a lane; the market the middle of things; a church a rise; a watchtower the high ground; the big yards (muster hall, stables, butts, paddock) the edge of the village;</li><li>the mill must stand on a stream with a fall;</li><li>a plot of your town's plan near the click is taken first.</li></ul>
<p><b>Walls</b> follow your village as it stands: pick a palisade or stone wall and the circuit it asks for is drawn round it — bent to the slope and the water, round the houses and fields, with gold gates where the lanes leave. Click a bright stretch to raise it, or press and drag your own line (red with the reason if the land refuses it). The circuit grows as the village does; walls already built stay.</p>
<p><b>Camps</b> go beside what they work: a Lumber Camp within about 90 m of timber, a Mining Camp by stone or ore, a Bloomery near ore. A stone curtain may replace a palisade stretch, and a wall takes any plot it runs through. <b>A new town:</b> Build → Keep &amp; Manor elsewhere shows where the house may found one.</p>
<p>The hover tag shows how the ground will suit it (soil, footing, slope).</p>` },
    { h: "What each building costs", html: `${costTable()}<p><small>Walls are priced per metre; the circuit is laid out in stretches of about 45 m.</small></p>` },
    { h: "Who raises which men", html: `${recruitTable()}<p>Knights are drawn from your <b>squires</b>; a house starts with three. Men who practise at the <b>Archery Butts</b> day after day slowly become warbow archers.</p>` },
    { h: "Mustering a company", html: `<p>Open a finished building's panel and use <b>+10</b>, <b>+1</b> or <b>Rush</b>. The men are drafted at once from the villagers in the trades shown, and their gear is taken from the stores. They muster after the days given. A rushed muster is faster but worse trained. “Ready” counts how many you could raise now.</p>${musterTable()}
<p>Siege engines are crewed at the <b>Siege Workshop</b> (“Crew one”), from the engines already made and in store:</p>${engineTable()}` },
    { h: "Workshops and what they make", html: `<p>A workshop turns stores into arms and gear: craftsman-days, plus its materials, plus charcoal for the forge. It stops when an input runs out.</p>
<p>Click a finished workshop to open its panel. It shows what it makes, who chose it, and who works there.</p>
<ul><li><b>What it makes:</b> click a product and it stays that way. The reeve never changes your choice. <b>Auto (let the reeve choose)</b> hands it back: he sets it to what the house lacks (arrowheads when arrows run short, spears for the levy, rope for the engines…).</li>
<li><b>Crew:</b> <b>−</b> and <b>+</b> set how many men work there, from none up to its places (4 at a smithy, fletcher or weaver, 6 at a bloomery, 8 at the siege workshop, 20 at the butts). The men go at once, and the reeve keeps the crew at that size, even in a famine. <b>Auto</b> lets the reeve staff it again. You can also select villagers, click the workshop and choose <b>Work here</b>.</li>
<li><b>Trades:</b> a smithy and a bloomery need <b>smiths</b>, the fletcher <b>fletchers</b>, the weaver <b>weavers</b>, the siege workshop <b>carpenters</b>. A man of the trade works at full pace, any other man at 30–50% of that pace (the panel gives the figure). Your house's tradesmen are the ones it started with: families who move in bring none, so the panel sends yours to the bench first. A collier's clamp needs no trade.</li></ul>${recipeTable()}
<p>A <b>bow</b> needs a seasoned stave, and a suit of <b>mail</b> takes a smith some forty days.</p>` },
    { h: "Mana, adepts and spells", html: `<p>Magic here is quiet and rare. Your <b>adepts</b> draw mana at a <b>ley line</b> while the village works. The store holds 60, or 200 with an <b>Adepts' Tower</b> (Town stage).</p>
<p>Open <b>Spells</b> at the top, pick one, then click the ground. ${K("X")} puts it away. Casting needs the mana and at least one adept left alive in the village.</p>${spellList()}` },
    { h: "Feats, legends and commanders", html: `<p>Men are watched in battle. A man who does what the odds say he should not becomes a <b>legend</b>:</p>
<ul><li>many kills in melee;</li><li>surviving four or more foes at once;</li><li>standing on long after his company broke.</li></ul>
<p>Cutting down men who are running never counts. Feats are notable, heroic, legendary or mythic.</p>
<p>As his saga grows you are offered his <b>promotion</b>, for gold, to <b>Veteran</b>, <b>Champion</b> and then <b>Captain</b>. Each rank brings a gift you choose from three, and a little more skill and courage.</p>
<p>A Captain gains a temper from his deeds. Within 500 m of a fight he may be offered command of it: see <b>Commanders</b> at the top.</p>` },
    { h: "The technology track", html: `<p>Stages decide what you may <i>build</i>; research is what your house chooses to <i>learn</i>. Open <b>Research</b> on the top bar, or <i>Research…</i> in the keep's panel.</p>
<ul><li>Studies are kept at the <b>keep</b>: one at a time (the <i>Scriptorium</i> adds a second desk), and none while the keep is a ruin.</li>
<li>The cost is paid <b>once, when a study starts</b>; abandon it and the cost comes back to the store.</li>
<li>Time is in days at a desk, <b>halved while your town is besieged</b>.</li>
<li>There is <b>no queue</b>: you can only start a study on a free desk. When a study is done its desk sits <b>idle</b> until you come back and choose the next one. In the Realm nothing new is studied while you are away.</li>
<li>Some studies need a stage, a building, or another study first. In a pitched battle or a siege there is no research.</li></ul>
<p>Every study, from the game's own list (silver in pence, d):</p>${techTable()}` },
  ] },

  // ======================================================================== 4
  { id: "battle", title: "Battle", intro: "Ground, order and nerve win more fights than numbers. Read the field before you commit.", subs: [
    { h: "Formations", html: `<p>Pick one in the order or attack menu.</p>
<ul><li><b>Line</b> (4 ranks): the most men in the fight. A long right-drag makes a shallow 2-rank line.</li>
<li><b>Deep</b> (8 ranks): ranks behind hold the front's nerve.</li>
<li><b>Column</b>: for the road. A long march (over 400 m) goes in column on its own and is a little quicker; it re-forms on arrival or when the enemy comes near.</li>
<li><b>Loose</b>: wide spacing. Arrows do less, and flanking fire does not crush it together. But it has no rank support, takes fright at a charge, and horses ride straight through it.</li>
<li><b>Wedge</b> (horse, men-at-arms, knights): drives deep; its sloping sides both count as front.</li>
<li><b>Schiltron</b> (spears, pikes, levy): a ring facing out. It has no flank or rear, horses meet a hedge from every side, it is never scattered by a charge, and it re-forms at once.</li></ul>` },
    { h: "The charge", html: `<p>Horse gallop the last 220 m. Charging uphill or over soft ground blunts them badly.</p>
<p>At the line a horse may <b>refuse</b>. It is likelier to refuse a steady, dense, deep front of points or armour, and far less likely from the flank or rear.</p>
<p>Where it strikes home, men are <b>thrown</b> and knocked down, and their neighbours stumble and lose heart. A body that has enough men thrown is <b>disordered</b>.</p>
<p>Horse then draw off, rest and charge again. Held by a line that stands, they fight a few seconds and pull back. Foot will not catch horse in the open.</p>` },
    { h: "What stops horses, and who is ridden down", html: `<ul><li><b>Pikes braced, or a schiltron:</b> the horse is stopped dead. “A hedge of pikes: horses will refuse it. Take them in the flank or rear, or shoot them first.”</li>
<li><b>Steady spears braced:</b> they check the horse but do not stop it. “Many horses will refuse. Better when they are shaken or scattered.”</li>
<li><b>Ridden down:</b> loose order, bowmen, men already running, other horse, lines only one or two ranks deep, shaken shallow bodies, and foot caught on the move. “Loose, shaken or bowmen: a charge will ride them down.”</li></ul>
<p>A <b>wedge</b> (★) drives deep; a <b>line</b> hits the most men.</p>` },
    { h: "Bows: volleys, at will, hold fire", html: `<p>Select bowmen and the order menu shows <b>Bows: At will · Volleys · Hold fire</b>.</p>
<ul><li><b>At will</b>: each man shoots as he finds a mark. A longbowman looses 6–10 shafts a minute, a crossbowman 2–3.</li>
<li><b>Volleys</b>: the whole company looses together at the body nearest the spot you click (or at the ground there), about every 7 s for longbows and every 20 s for crossbows.</li>
<li><b>Hold fire</b>: they keep their arrows.</li></ul>
<p>Click an enemy with only bowmen selected and they simply go to shoot at him, standing off at about three-quarters of their range.</p>` },
    { h: "Range, arrows and cover", html: `<ul><li><b>Range.</b> The longbow reaches about 260 m, the crossbow about 170 m. Height adds reach (about 4% for every 10 m above the target), and the wind adds or takes a little.</li>
<li><b>Supply.</b> Longbowmen take 60 shafts into battle and crossbowmen 30 bolts. Out of the fight they pick up spent shafts near them. Bowmen with nothing to shoot will go in with their blades against foot that is shaken, broken or already locked in a fight.</li>
<li><b>Cover.</b> Woods, walls and field works catch arrows. A crossbowman's pavise turns most shots from the front while he stands steady. Shields help too.</li>
<li><b>Nerve.</b> Arrows wear down nerve as well as men, less so for armoured men, for men advancing, and for men who can shoot back.</li></ul>` },
    { h: "Height and slope", html: `<p>Slopes slow foot, and armour makes it worse. In a melee the man above has the advantage: the steeper the slope, the bigger the edge, up to a point. Men on a height also hold their nerve a little better.</p>
<p>A charge up a steep slope arrives “broken and blown”.</p>` },
    { h: "Reading the field", html: `<p>The order menu reads the ground at the spot: <b>rise</b>, <b>slope</b>, <b>cover</b> and <b>defensibility</b>, with notes such as “Commanding height” or “Cavalry cannot charge effectively here”.</p>
<p>The <b>Battlefield</b> overlays in the View panel (right) paint the whole field:</p>
<ul><li><b>Elevation</b>: height, with 10 m contours.</li><li><b>Defensible</b>: red to green. It weighs height, view, cover, bad going for horse and slope, and marks down a spot overlooked by a nearby height.</li><li><b>Cover</b>: shelter from missiles, and concealment.</li><li><b>Going</b>: how fast foot can move; deep water shows blue.</li><li><b>Charge lanes</b>: gold where horse can charge.</li><li><b>Line of sight</b>: what can be seen from a point.</li></ul>` },
    { h: "Morale: wavering, rout and rally", html: `<p>Each man carries his own stress. Rising stress makes him <b>waver</b>, then become <b>shaken</b>, then <b>break</b>. Even then he runs only if friends are running, he is flanked or hurt, or his company is already going.</p>
<p><b>What frightens men:</b></p><ul><li>enemies on the flank, and worse in the rear;</li><li>friends fleeing;</li><li>the captain killed, or a company nearby breaking;</li><li>exhaustion, the dark, and horse galloping near.</li></ul>
<p><b>What steadies them:</b></p><ul><li>a leader within 30 m;</li><li>ranks behind them;</li><li>flanks resting on a wood, river or wall;</li><li>seeing the enemy run;</li><li>time out of danger.</li></ul>
<p>A company <b>routs</b> when about a third of it has broken or its front collapses. Runaways stop after a few hundred metres once calmer and clear of pursuit. A broken company may re-form once, after at least 90 s, never quite as bold. The lord's “Rally to me!” and an adept's Blessing steady men.</p>` },
    { h: "Fatigue", html: `<p>Men tire by what they do, not by a bar ticking down: running, fighting, climbing in armour. Winded men strike and parry more weakly.</p>
<p>Horses lose their wind at the gallop.</p>
<p>Rest them between efforts. Out of supply, men do not recover.</p>` },
    { h: "Disorder", html: `<p>A charge that throws men leaves a company <b>disordered</b>: scattered, their ranks broken. A long, wavering melee can do the same.</p>
<p><b>Any order clears it.</b> Press ${K("U")} to form up where they stand. If they are still fighting, they re-form when the fight ends.</p>
<p>A schiltron is never scattered.</p>` },
    { h: "Weather", html: `<div class="tw"><table><tr><th>Weather</th><th>What it does</th></tr>
<tr><td>Rain</td><td>wet bowstrings: weaker, slower, wider shooting; sight about 2.5 km</td></tr>
<tr><td>Heavy rain</td><td>worse again for bows; sight about 800 m; calls misheard</td></tr>
<tr><td>Thunderstorm</td><td>sight about 600 m; men fret; calls misheard</td></tr>
<tr><td>Light fog</td><td>sight about 800 m</td></tr>
<tr><td>Thick fog</td><td>sight about 150 m; orders garbled</td></tr>
<tr><td>Heavy snow</td><td>sight about 300 m</td></tr>
<tr><td>Mud</td><td>after wet weather: foot slowed (heavy foot more), horse most of all; footing slips</td></tr></table></div>
<p>Wind lengthens or shortens a bowshot. Bad weather shortens the reach of a horn.</p>` },
    { h: "Captains and initiative", html: `<p>Set each company's <b>Initiative</b> in its panel:</p><ul><li><b>On</b>: the captain acts on his own.</li><li><b>Ask me</b>: he proposes with a card and an 8-second countdown.</li><li><b>Off</b>: he waits for your word.</li></ul>
<p>Cards offer to:</p><ul><li>charge unguarded bowmen;</li><li>take a flank;</li><li>pursue;</li><li>fall back;</li><li>get into cover;</li><li>go to a company in trouble.</li></ul>
<p>Click the card itself to look at the target. At most three show at once. A captain keeps quiet while his company is holding, digging in, in ambush, forming up or assaulting.</p>` },
    { h: "Dig in, and Ambush", html: `<p><b>Dig in</b> (foot only) works where they stand:</p>
<ul><li><b>Bowmen</b> plant <b>stakes</b> 3 m in front, as wide as their front, in about a minute. Horses cannot cross stakes, and those that try are impaled.</li>
<li><b>Other foot</b> dig a <b>ditch</b> 4 m in front in about two minutes. It checks a charge, tumbles riders at speed, and gives the defenders cover and an edge.</li></ul>
<p>The work stops if they are attacked or break.</p>
<p><b>Ambush</b> (foot and light troops) sends them to wait at the spot; their captain keeps quiet. Choose the ground: the order menu notes “ambush ground” where troops are hard to spot, and the Cover overlay shows concealment.</p>` },
    { h: "Rivers and crossings", html: `<p>A march that meets water goes round by a ford or bridge if that is not much longer. Otherwise the company <b>builds a crossing</b> where it is:</p>
<ul><li><b>fascines</b> to fill a ditch or moat up to 12 m wide, in under a minute or so;</li><li>a <b>trestle bridge</b> over a stream up to 15 m wide and 3 m deep, in a few minutes.</li></ul>
<p>Building is slower with few men, without timber in store, or under arrows. Nobody bridges a real river: find a ford.</p>
<p>Crossings serve both sides. A trestle bridge burns, in about 25 s for men with torches, longer in rain. Fascines stay.</p>` },
    { h: "Siege engines", html: `<ul><li><b>Trebuchet</b>: travels as parts and is framed up where it will shoot, then never moves. It hurls 90 kg stones at 120–230 m, only within the arc its frame faces.</li>
<li><b>Mangonel</b>: towed. It needs a minute to set up, then throws 8 kg stones at 30–110 m.</li>
<li><b>Springald</b>: a great crossbow. It picks off men out to 300 m, engine crews first.</li>
<li><b>Covered ram</b>: pushed to a gate or wall and swung. A timber gate goes in hours.</li>
<li><b>Siege tower</b>: its crew fill the ditch, then it is pushed to the wall and its bridge drops onto the wall-walk. It needs level ground.</li>
<li><b>Mantlet</b>: a screen that turns most arrows from the front.</li></ul>
<p>Select engines and click a target: they take it as their mark. Engines burn (fire arrows, sally torches, pitch); crews fight the flames, and an engine left without a crew can be taken.</p>` },
    { h: "Walls, ladders and mines", html: `<ul><li><b>Ladders</b>: foot scale a wall from ladders in store, or from ones knocked up out of timber, about one for every eight men. They climb one at a time and are met at the top. Ladders reach 12 m, so no higher.</li>
<li><b>Towers</b>: a docked siege tower is a wider, safer way up.</li>
<li><b>Battering</b>: walls crack stretch by stretch, from pocked to cracked to <b>breach</b>. A tower falls whole. Gates have leaves and then a portcullis.</li>
<li><b>Mines</b>: <b>Mine</b> digs a gallery under a wall or tower, slowly in earth and very slowly in rock, never under water. The props are fired, and the work most likely brings it down. Defenders listen for miners and dig countermines; then men fight underground.</li>
<li><b>Barricade</b>: defenders stop a breach with timber and rubble.</li></ul>` },
    { h: "Holding or taking a castle", html: `<p>A full siege is a game of its own. Choose the castle and your side from the siege button on the match screen.</p>
<p>It runs from investment to the long siege, to the assault, to fighting inside, and at the last to <b>the keep</b>, the final stand.</p>
<p>Defenders may <b>sally</b>, out by the postern or the gate, to burn an engine and come back.</p>
<p>A garrison eats its stores. Once they run out, starving men lose heart and then die. Every day it weighs whether to yield. Heralds can carry terms:</p><ul><li>yield before a storm and the garrison marches out with the honours of war;</li><li>starved out, their lives are spared;</li><li>otherwise they surrender at discretion.</li></ul>
<p>A relief army may come.</p>` },
  ] },

  // ======================================================================== 5
  { id: "beasts", title: "Beasts", intro: "The vale is not empty. Some of what lives in it can be eaten, some ridden, and one thing should be left well alone.", subs: [
    { h: "Horses", html: `<p>The horse is the measure of every other mount: a sure charge, the speed you know, fed on hay and oats. A destrier eats about 4.5 kg of grain a day, less in summer on paddock grass.</p>
<p>Riders need horses in store: the keep and the <b>Stables</b> raise mounted companies. A <b>Horse Paddock</b> gives grazing.</p>` },
    { h: "Striders and drakes", html: `<ul><li><b>Strider</b> (Hobelars and Scouts): much faster than a horse and cheap to keep, eating 2 kg of grain and no fodder. It is light in the strike and shy of a wound, but marsh and scrub barely slow it: made for raids, flanks and riding down routers.</li>
<li><b>Drake</b> (Knights): slow, heavy and terrible in the strike, so that men waver where it lands. Its thick hide turns arrows, and it presses a pike hedge further than any horse. It swims rivers slowly, sulks in winter, and eats 6 kg of meat a day.</li></ul>` },
    { h: "Capturing the young", html: `<p>Wild strider herds and drake dens sometimes have young with them. With a finished <b>Stables</b>, click such a herd: the order menu offers <b>Capture young</b>.</p>
<p>The men run a juvenile down until it tires. A strider is led home, a drake carried, to the stables' pens.</p>
<p>If none is left, “No young left in that herd to take.”</p>` },
    { h: "Breaking them to the saddle", html: `<p>At the stables a handler, one of your riders, breaks one penned beast at a time: about 12 days for a strider and 25 for a drake. The first one broken founds the stables' tradition. From then on the stables panel lets new cavalry ride that mount.</p>
<p>The same panel offers <b>Re-mount</b> for standing companies. It takes about two days, needs enough trained mounts, and the arm must suit the beast. The old mounts go back to stock.</p>` },
    { h: "Game of the vale", html: `<p>Red deer, roe deer, wild boar and hare are hunted. Mallard and greylag geese are taken by fowlers, and take wing when flushed.</p>
<p>Click a herd with men selected and choose <b>Hunt</b>. Soldiers bring the kills home; villagers make a hunting crew. Meat counts only once it is home and butchered.</p>
<p>Herds breed back, but a herd hunted to a single beast is gone for good.</p>` },
    { h: "Wolves, bears and dens", html: `<p><b>Wolves</b> run in packs. When a town keeps more than 30 sheep they take one now and then, more often in winter. In a hard winter, very rarely, they take a villager working alone far from the town.</p>
<p>A <b>brown bear</b>, or a drake in its den, may charge men who come too close (“mauled”), at most once a day for each den.</p>
<p>None of this troubles a house that is shielded or under the Keep's Peace in the Realm.</p>` },
    { h: "The white hart", html: `<p>Now and then a <b>white hart</b> is seen in the vale (“A white hart has been seen in the vale!”), and it stays only some days. Few hunters ever take one.</p>
<p>The house that does is remembered for it, and its companies stand a little prouder.</p>` },
    { h: "The lake serpent", html: `<p>Where a map has a deep lake, something very large sometimes surfaces in it. The lake serpent is nobody's game. There is no Hunt order for it.</p>` },
    { h: "Dragons", html: `<p>Dragons live in the campaign and in the Realm, never in a set battle or siege.</p>
<p>A dragon sleeps most of the time. Every so often it ranges out to take game or sheep, or to burn a field.</p>
<p>Shoot at it, or bring a strong armed party close to its lair, and you will wake it (“You have woken the dragon!”).</p>
<p>In a fight it bites, terrifies the men near it, and breathes a cone of fire every half minute or so. Arrows do little while it is on the wing.</p>
<p>In the Realm a dragon never harms the men or buildings of a shielded house or one under the Keep's Peace, though their fields are still fair game.</p>` },
    { h: "Claiming a dragon", html: `<p>Beaten down far enough, a dragon <b>yields</b>, cowed (“The dragon YIELDS — claim it, or finish it”). If men keep at it, it dies, for good.</p>
<p>To <b>claim</b> it, your men must be close, your house must have done it the most harm, and you must not keep a dragon already. Then click it. Left unclaimed long enough, it goes home.</p>` },
    { h: "A dragon of your own", html: `<p>A claimed dragon is sullen. <b>Feed it meat</b>: about 60 kg a day, and when that runs out it takes live sheep. Its trust grows only while it is fed. It becomes <b>broken-in</b>, and in time <b>bonded</b>.</p>
<p>A bonded dragon at its lair can be <b>summoned</b>: click it, or choose <b>Summon the dragon</b> in the order menu. Then <b>Dragon: fly here</b> and <b>Dragon: FIRE</b> (a cone of flame where you point, when it is close) are yours. Click it again to send it home. It tires after a while and turns for its lair.</p>
<p>Leave it unfed too long, or lose your house, and it goes <b>wild</b> again.</p>` },
  ] },

  // ======================================================================== 6
  { id: "realm", title: "The Realm", intro: "The Realm is the family's always-on world: one vale, several houses, and it does not stop when you log off.", subs: [
    { h: "Joining", html: `<p>Open <b>play.html</b> and choose <b>The Realm</b>.</p>
<p><b>Create account</b> with a name (2–24 letters, digits or spaces), a password of at least 6 characters, and the <b>realm key</b>, a phrase whoever runs the realm gives the family. After that, <b>Sign in</b> with your name and password.</p>
<p>Each account holds one house, on one of the realm's free holds.</p>` },
    { h: "Founding your house", html: `<p>Choose your <b>arms</b> (your banner) and a <b>house name</b>, then <b>Found the house</b>. Arms another house already flies are marked as such.</p>
<p>You begin at your hold with a keep, about 120 settlers, a small retinue (6 knights, 12 men-at-arms, 12 archers), a store, a town plan, a reeve to run the work, and enough grain to reach the first harvest.</p>` },
    { h: "Newcomer's protection", html: `<p>A new house is <b>protected for 72 hours</b> of realm time. Nobody can attack you, and you can't attack anyone. The realm card shows how long is left.</p>
<p><b>Ordering an attack ends it at once</b> (“You drew the sword: your protection has ended”).</p>` },
    { h: "When you are away: the warden", html: `<p>Ten minutes after you go offline (a dropped connection doesn't count), a <b>warden</b> keeps your house:</p>
<ul><li>your companies come home and meet a threat before the keep, or man the walls if outnumbered;</li>
<li>while an enemy is within about 1 km of the hall, the villagers shelter in the keep, and go back to work when it leaves;</li>
<li>the warden never attacks anyone.</li></ul>
<p>The reeve keeps the fields and stores going as ever.</p>` },
    { h: "The Keep's Peace", html: `<p>While you are away, and for <b>15 minutes</b> after you come back, your house is under the <b>Keep's Peace</b>:</p>
<ul><li>the keep cannot fall (no sack, no storm, no starving out);</li><li>it cannot be battered below a quarter of its strength;</li><li>raiders cannot burn your buildings, though ripe fields can still burn.</li></ul>
<p>Battles in the open still happen, and men still die.</p>
<p>A house left alone for more than <b>14 days</b> loses the Peace and can be conquered.</p>` },
    { h: "What counts as an attack", html: `<p>An attacking order counts against a house when it lands within <b>200 m</b> of that house's men or standing buildings. That includes:</p>
<ul><li>attack, assault, burn, bombard, batter, escalade, mine;</li><li>volleys or loosing at will, skirmish, ambush;</li><li>setting your dragon's fire on it;</li><li>clicking straight on its men.</li></ul>
<p>You will be told plainly if a house is protected, or if you are not at war with it.</p>` },
    { h: "Being told of an attack", html: `<p>When you leave, you are asked <i>“Would you like to be notified if your men see an attack?”</i> Your answer holds for that absence only.</p>
<p>If you said yes and nobody from your house is on, you get one alert for each attack, such as <i>“⚔ The house of … is under attack at … — the keep is under siege. Tap to take command.”</i></p>
<p>A new alert comes only after ten minutes of quiet, or if things get worse: from a raid, to a siege, to the walls breached or the gate broken. A dragon raid on your lands sends an alert whether you are on or not.</p>` },
    { h: "While you were away", html: `<p>Every house keeps its own <b>chronicle</b>.</p>
<p>When you come back after a while, a summary waits, for example <i>“While you were away (9 hours): 23 of your men fell and they slew 41 of the enemy; raiders fired 2 fields; your keep was besieged and held (the Keep's Peace).”</i></p>
<p>The lines below it are the chronicle. Click one to look at the place.</p>` },
    { h: "If your house falls", html: `<p>A house falls when its <b>keep</b> falls. Its people scatter, its halls become ruins, and the conqueror takes the lord's chest.</p>
<p>You will see what your house did (enemies slain, men lost, buildings raised) and the last lines of its chronicle. <i>That is part of the game:</i> choose <b>Start over</b> to begin again at a free hold with fresh protection, or <b>Look on the ruins</b>.</p>` },
    { h: "Time in the Realm", html: `<p>The Realm never pauses. Battles and marches run in real time, but its year is slow: <b>a day passes in 4 real minutes</b>, an evening is about a month, and a year about a real day.</p>
<p>When the server itself is down, the realm clock stops, and protection does not run out.</p>` },
  ] },
];


const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------------------------------------------------------------- the panel
const CSS = `
#hbbtn { position:fixed; left:12px; bottom:12px; z-index:35; width:38px; height:38px; padding:0; border-radius:50%; display:grid; place-items:center;
  background:var(--panel); border:1px solid var(--edge); color:var(--gold); box-shadow:0 2px 10px #0008; cursor:pointer; }
#hbbtn:hover, #hbbtn.on { border-color:var(--gold); background:#3a3224; }
#hbbtn svg { width:20px; height:20px; display:block; }
#handbook { position:fixed; left:12px; bottom:58px; z-index:35; width:min(720px, calc(100vw - 24px)); max-height:min(78vh, 760px); display:flex; flex-direction:column;
  background:rgba(24,21,16,.96); border:1px solid var(--gold); border-radius:4px; box-shadow:0 8px 40px #000b; color:var(--ink); font-size:13.5px; line-height:1.5; user-select:text; }
#handbook[hidden] { display:none; }
#handbook .hbhead { display:flex; align-items:center; gap:10px; padding:10px 12px 6px; border-bottom:1px solid #6b5a3a88; flex-wrap:wrap; }
#handbook .hbhead h2 { margin:0; font-size:13px; font-weight:400; letter-spacing:.22em; text-transform:uppercase; color:var(--gold); flex:1 1 auto; }
#handbook .hbsearch { flex:1 1 200px; min-width:0; max-width:320px; font:inherit; font-size:13px; color:var(--ink); background:#14120d; border:1px solid var(--edge); border-radius:3px; padding:4px 8px; }
#handbook .hbsearch:focus { outline:none; border-color:var(--gold); }
#handbook .hbx { padding:0 8px; font-size:13px; }
#handbook .hbtabs { display:flex; flex-wrap:wrap; gap:3px; padding:6px 12px; border-bottom:1px solid #6b5a3a88; }
#handbook .hbtabs button { font-size:12px; padding:3px 9px; letter-spacing:.04em; }
#handbook .hbtabs button[aria-selected="true"] { background:#5a4722; border-color:var(--gold); }
#handbook .hbtabs button:focus-visible, #handbook button:focus-visible { outline:1px solid var(--gold); outline-offset:1px; }
#handbook .hbbody { overflow-y:auto; overflow-x:hidden; padding:4px 16px 16px; overscroll-behavior:contain; }
#handbook .hbintro { color:var(--dim); font-style:italic; margin:10px 0 4px; }
#handbook section { padding:2px 0 4px; border-bottom:1px dotted #6b5a3a66; }
#handbook section:last-child { border-bottom:0; }
#handbook h3 { margin:12px 0 4px; font-size:13px; font-weight:400; font-variant:small-caps; letter-spacing:.08em; color:var(--gold); }
#handbook h3 .from { font-variant:normal; letter-spacing:0; color:var(--dim); font-size:11px; margin-left:6px; }
#handbook p { margin:4px 0; } #handbook ul { margin:4px 0; padding-left:18px; } #handbook li { margin:2px 0; }
#handbook b { color:#f1e6c8; font-weight:600; } #handbook i { color:var(--ink); }
#handbook .tw { overflow-x:auto; max-width:100%; }
#handbook table { border-collapse:collapse; margin:6px 0; font-size:12.5px; width:100%; }
#handbook th { text-align:left; font-weight:400; color:var(--dim); font-size:11px; letter-spacing:.08em; text-transform:uppercase; border-bottom:1px solid var(--edge); padding:2px 6px; }
#handbook td { border-bottom:1px solid #6b5a3a44; padding:3px 6px; vertical-align:top; }
#handbook kbd { font:11px ui-monospace, monospace; border:1px solid var(--edge); border-bottom-width:2px; border-radius:3px; padding:0 4px; color:var(--ink); background:#14120d; white-space:nowrap; }
#handbook mark { background:#d8b25a55; color:inherit; border-radius:2px; padding:0 1px; }
#handbook .hbnone { color:var(--dim); margin:14px 0; }
#handbook .hbset { display:flex; flex-wrap:wrap; gap:4px; align-items:center; margin:4px 0 8px; }
#handbook .hbset button { font-size:12px; }
#handbook .hbset button[aria-pressed="true"] { background:#5a4722; border-color:var(--gold); }
/* the book has the bottom-left corner: what used to sit there moves over beside it */
body:has(#hbbtn) #selinfo, body:has(#hbbtn) #scoutpanel, body:has(#hbbtn) #lordhud .card { left:60px; }
body:has(#hbbtn) #selinfo { max-width:min(420px, calc(100% - 72px)); }
@media (max-width:600px) {
  #hbbtn { left:8px; bottom:8px; }
  body:has(#hbbtn) #selinfo, body:has(#hbbtn) #scoutpanel, body:has(#hbbtn) #lordhud .card { left:54px; }
  #handbook { left:8px; right:8px; width:auto; bottom:52px; max-height:calc(100vh - 70px); }
  #handbook .hbbody { padding:4px 10px 12px; }
}
`;
const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v15H5.5C4.7 19 4 19.7 4 20.5z"/><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v15h5.5c.8 0 1.5.7 1.5 1.5z"/><path d="M11 4c.6.8 1.4 1 2 0"/><path d="M6.5 8h2.5M6.5 11h2.5M15 8h2.5M15 11h2.5"/></svg>`;
const LS_TAB = "hg-handbook-tab";

export function makeHandbook({ realm = false, toast = () => {}, settings = null } = {}) {
  const style = document.createElement("style"); style.textContent = CSS; document.head.append(style);
  const button = document.createElement("button");
  button.id = "hbbtn"; button.type = "button"; button.title = "Handbook & settings (F1)";
  button.setAttribute("aria-label", "Handbook & settings (F1)"); button.setAttribute("aria-haspopup", "dialog"); button.setAttribute("aria-expanded", "false");
  button.innerHTML = ICON;
  const panel = document.createElement("div");
  panel.id = "handbook"; panel.hidden = true; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Player's handbook and settings");
  document.body.append(button, panel);

  // the Realm tab leads when you are in the realm; otherwise it sits before Settings
  const tabs = HANDBOOK.map((t) => t.id).filter((id) => id !== "realm");
  if (realm) tabs.unshift("realm"); else tabs.splice(tabs.length, 0, "realm");
  tabs.push("settings");
  const titleOf = (id) => id === "settings" ? "Settings" : HANDBOOK.find((t) => t.id === id)?.title || id;
  let tab = tabs[0];
  try { const t = localStorage.getItem(LS_TAB); if (t && tabs.includes(t)) tab = t; } catch { /* (private window) */ }

  panel.innerHTML = `<div class="hbhead"><h2>The Player's Handbook</h2>
      <input class="hbsearch" type="search" placeholder="Search the handbook…" aria-label="Search the handbook" spellcheck="false" autocomplete="off">
      <button class="hbx" type="button" title="Close (Esc)" aria-label="Close">✕</button></div>
    <div class="hbtabs" role="tablist" aria-label="Handbook sections">${tabs.map((id) => `<button type="button" role="tab" data-tab="${id}" id="hbtab-${id}" aria-controls="hbbody">${titleOf(id)}</button>`).join("")}</div>
    <div class="hbbody" id="hbbody" role="tabpanel" tabindex="0"></div>`;
  const search = panel.querySelector(".hbsearch"), body = panel.querySelector(".hbbody"), tabBtns = [...panel.querySelectorAll("[role=tab]")];

  const subHTML = (s, from = "") => `<section><h3>${s.h}${from ? `<span class="from">· ${from}</span>` : ""}</h3>${s.html}</section>`;
  function renderTab() {
    for (const b of tabBtns) { const on = b.dataset.tab === tab; b.setAttribute("aria-selected", on ? "true" : "false"); b.tabIndex = on ? 0 : -1; }
    body.setAttribute("aria-labelledby", "hbtab-" + tab);
    if (tab === "settings") { renderSettings(); body.scrollTop = 0; return; }
    const T = HANDBOOK.find((t) => t.id === tab);
    const intro = tab === "realm" && !realm ? `<p class="hbintro">The Realm is the family's always-on world, reached from play.html. You are in a single game now; this is how the Realm works when you go there.</p>` : T.intro ? `<p class="hbintro">${T.intro}</p>` : "";
    body.innerHTML = intro + T.subs.map((s) => subHTML(s)).join("");
    body.scrollTop = 0;
  }
  function setTab(id, focus = false) {
    if (!tabs.includes(id)) return;
    tab = id;
    try { localStorage.setItem(LS_TAB, id); } catch { /* (private window) */ }
    if (search.value) search.value = "";
    renderTab();
    if (focus) tabBtns.find((b) => b.dataset.tab === id)?.focus();
  }

  // ---- search: every sub-section of every tab, the hits marked
  const plain = (html) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ");
  const INDEX = HANDBOOK.flatMap((t) => t.subs.map((s) => ({ tab: t.id, title: t.title, s, text: (s.h + " " + plain(s.html)).toLowerCase() })));
  function mark(html, words) {
    const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return html.split(/(<[^>]+>)/).map((part) => part.startsWith("<") ? part : part.replace(re, "<mark>$1</mark>")).join("");
  }
  function renderSearch(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) { renderTab(); return; }
    for (const b of tabBtns) b.setAttribute("aria-selected", "false");
    const hits = INDEX.filter((e) => words.every((w) => e.text.includes(w)));
    body.innerHTML = hits.length
      ? `<p class="hbintro">${hits.length} ${hits.length === 1 ? "passage" : "passages"} found.</p>` + hits.map((e) => subHTML({ h: mark(e.s.h, words), html: mark(e.s.html, words) }, e.title)).join("")
      : `<p class="hbnone">Nothing in the handbook speaks of “${esc(q)}”. Try a single word: charge, arrows, granary, dragon…</p>`;
    body.scrollTop = 0;
  }
  search.addEventListener("input", () => renderSearch(search.value.trim()));

  // ---- settings: only what the game hands us
  function renderSettings() {
    const parts = [];
    const Q = settings?.quality, M = settings?.sound, V = settings?.views;
    if (Q?.get && Q?.set) {
      const cur = safe(() => Q.get());
      parts.push(`<section><h3>Render quality</h3><p>Low for an older laptop, High for a strong graphics card.</p><div class="hbset" data-set="quality">${["low", "medium", "high"].map((k) => `<button type="button" data-q="${k}" aria-pressed="${cur === k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}</div></section>`);
    }
    if (M?.muted && M?.setMuted) {
      const m = !!safe(() => M.muted());
      parts.push(`<section><h3>Sound</h3><div class="hbset"><button type="button" data-mute aria-pressed="${m}">${m ? "Sound is off — turn it on" : "Mute all sound"}</button><span style="color:var(--dim);font-size:12px">or press <kbd>⇧</kbd><kbd>M</kbd> at any time</span></div></section>`);
    }
    if (Array.isArray(V) && V.length && settings?.setView) {
      parts.push(`<section><h3>Camera view</h3><p>Or press <kbd>V</kbd> to step through them.</p><div class="hbset">${V.map((v) => `<button type="button" data-view="${esc(v.id)}">${esc(v.name)}</button>`).join("")}</div></section>`);
    }
    parts.push(`<section><h3>Elsewhere on the screen</h3><p>The Battlefield overlays (<i>Elevation, Defensible, Cover, Going, Charge lanes, Line of sight</i>) and the sound sliders stay in the View panel on the right, where you can flick them on while you give orders.</p><p>This handbook never pauses the game: the world runs on while you read.</p></section>`);
    body.innerHTML = parts.join("");
    body.querySelectorAll("[data-q]").forEach((b) => b.onclick = () => {
      safe(() => Q.set(b.dataset.q));
      body.querySelectorAll("[data-q]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    });
    const mb = body.querySelector("[data-mute]");
    if (mb) mb.onclick = () => { const m = !safe(() => M.muted()); safe(() => M.setMuted(m)); renderSettings(); toast(m ? "Sound off" : "Sound on"); };
    body.querySelectorAll("[data-view]").forEach((b) => b.onclick = () => safe(() => settings.setView(b.dataset.view)));
  }
  function safe(f) { try { return f(); } catch (e) { console.warn("handbook setting:", e); return undefined; } }

  // ---- open / close
  let lastFocus = null;
  function open(tabId) {
    if (tabId && tabs.includes(tabId)) { tab = tabId; try { localStorage.setItem(LS_TAB, tab); } catch { /* */ } search.value = ""; }
    if (panel.hidden) { lastFocus = document.activeElement; panel.hidden = false; button.classList.add("on"); button.setAttribute("aria-expanded", "true"); }
    if (search.value.trim()) renderSearch(search.value.trim()); else renderTab();
    search.focus({ preventScroll: true });
  }
  function close() {
    if (panel.hidden) return;
    panel.hidden = true; button.classList.remove("on"); button.setAttribute("aria-expanded", "false");
    button.focus({ preventScroll: true });
    lastFocus = null;
  }
  const toggle = () => (panel.hidden ? open() : close());
  const isOpen = () => !panel.hidden;

  button.addEventListener("click", (e) => { e.stopPropagation(); toggle(); });
  panel.querySelector(".hbx").addEventListener("click", () => close());
  panel.querySelector(".hbtabs").addEventListener("click", (e) => { const b = e.target.closest("[role=tab]"); if (b) setTab(b.dataset.tab); });
  panel.querySelector(".hbtabs").addEventListener("keydown", (e) => {
    const i = tabBtns.findIndex((b) => b.dataset.tab === tab); let j = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") j = 0; else if (e.key === "End") j = tabs.length - 1;
    if (j >= 0) { e.preventDefault(); setTab(tabs[j], true); }
  });
  // typing in the handbook never reaches the game's hotkeys (they listen on window); Esc and F1 are handled here
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === "F1") { e.preventDefault(); e.stopPropagation(); close(); return; }
    e.stopPropagation();
  });
  addEventListener("keydown", (e) => {
    if (e.key === "F1") { e.preventDefault(); e.stopPropagation(); toggle(); return; }
    if (e.key === "Escape" && !panel.hidden) { e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.("input,textarea,select,[contenteditable]")) { e.preventDefault(); e.stopPropagation(); toggle(); }
  }, true);
  // a click anywhere else (not on the button) closes it
  addEventListener("pointerdown", (e) => {
    if (panel.hidden || panel.contains(e.target) || button.contains(e.target)) return;
    close();
  }, true);

  return { open, close, toggle, isOpen, button, panel };
}
