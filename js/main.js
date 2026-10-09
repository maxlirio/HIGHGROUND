import * as THREE from "three";
import { loadMap, placeholderMap } from "./sim/map.js";
import { streamMap } from "./sim/tilemap.js"; // the Realm's big world, streamed round the camera (docs/big-world.md)
import { makeWorldStream } from "./render/worldstream.js";
import { createWorld, addUnit, issueOrder, step, TICK, goingMul } from "./sim/world.js";
import { computeGroups } from "./ui/groups.js";
import { makeMarkers } from "./render/markers.js";
import { makeProps, FOG } from "./render/props.js";
import { makeFlora, skinOf } from "./render/flora.js";
import { ARMS, ARM_BY_ID, FORMATIONS } from "./sim/arms.js";
import { makeVision, updateVision, visIdx } from "./sim/vision.js";
import { weatherSystem, weatherAt } from "./sim/weather.js";
import { combatSystem } from "./sim/combat.js";
import { commandBattle } from "./sim/commander-ai.js";
import * as EC from "./sim/economy.js";
import { logisticsSystem } from "./sim/logistics.js";
import { convoySystem } from "./sim/convoys.js";
import { setupResources } from "./sim/resources.js";
import { makeGeneral, generalThink, reeveThink } from "./sim/ai-general.js";
import { makeBuildings, setTeamBanners, tickFlags } from "./render/buildings.js";
import { makeFire } from "./render/fire.js";
import { makeWeatherFx } from "./render/weatherfx.js";
import { makeFieldWorks } from "./render/fieldworks.js";
import { makeCrossings } from "./render/crossings.js";
import { makeBridgeUI } from "./ui/bridge-ui.js"; // (Build → Timber Bridge: "Bridge here", the river read about the pointer — js/sim/bridges.js)
import { chooseBanner, drawBanner, bannerColor, bannerAccent, enemyBannerFor, BANNERS, TINCTURES } from "./ui/heraldry.js";
const SPARE_COLS = ["#3a9ab0", "#c94f8a", "#8a9a3a", "#7a5a3a", "#5a6ad0", "#d07a5a", "#9a9a9a", "#4ab07a"];
import { TEAM as DOT_TEAM } from "./render/dots.js";
import { buildPlan, placeOnPlan, slotsFor, snapSlot, NEAR_RESOURCE } from "./sim/townplan.js";
import * as FD from "./sim/founding.js"; // founding new towns; every new town's plan read from the land (js/sim/settle.js)
import * as TW from "./sim/towns.js";
import { makeSettling } from "./ui/settling.js";       // "Found a settlement": the preview of the village the land gives, then the column
import { makeTownsUI } from "./ui/towns-ui.js";         // the town switcher (the seat, the daughters, the columns on the road)
import { makeTownGround } from "./render/towns.js";     // a plan read from the land: its lanes and yards painted as it comes to be; the settlers' camps
import { renderResourceBar, showBuildingPanel, showBuildMenu, showLandPanel, landPreview, panelSig } from "./ui/town.js";
import { makeFieldDraw } from "./ui/fielddraw.js"; // (Build → Open Field: the player draws the field — lane A)
import { makeSitingUI } from "./ui/siting-ui.js"; // (Build → a building: where the land takes it, the walls the village asks for — js/sim/siting.js)
import { makeObstacles, loadVegetation, loadObjects, obstacleSystem } from "./sim/obstacles.js";
import { siegeSystem, ensureSiege, engineOf, engineInfo, engineOrders, makeEngine } from "./sim/siege.js";
import { makeEngines } from "./render/engines.js";
import { makeCastles } from "./render/castle.js";
import { makeTownWalls } from "./render/townwalls.js"; // a town's walls: the ladders and stairs up, men drawn on the walk (js/sim/townwall.js)
import { BATTLE_RATE } from "./sim/clock.js";
import { featuresFromMapData } from "./sim/features.js";
import { legendSystem, nameOf } from "./sim/legend.js";
import { captainSystem, captainHooks } from "./sim/captains.js";
import { makeCaptainCards } from "./ui/captain-cards.js";
import { showLegend } from "./ui/legend-ui.js";
import { overlayRaster } from "./sim/analysis.js";
import { buildTerrain, SUN_DIR, outside, vnoise } from "./render/terrain.js";
import { makeDots } from "./render/dots.js";
import { makeFigures } from "./render/figures.js";
import { makeLaborRender } from "./render/labor.js";
import { makeLaneRenders } from "./render/jobs/index.js";
import { makeDragonsRender } from "./render/dragons.js";
import { makeVeinsRender } from "./render/veins.js"; // silver and gold veins: the mine mouth and the holder's flag (js/sim/veins.js)
import { prospectLine } from "./game/chronicle.js"; // (prospecting's chronicle lines: js/sim/prospect.js)
import * as DGNS from "./sim/dragons.js";
import { dragonAt, STAGE_NAME as DG_STAGE } from "./sim/dragons.js";
import { showLoading, loadingStep, hideLoading, loadingStart, loadingNote, modelsRibbon, afterLoading } from "./ui/loading.js";
import { waitForAssets } from "./ui/asset-wait.js"; // (patches three's loading manager at import, before any model is asked for)
import { glbExists } from "./build.js";
import { mapDir as pickedMapDir, mapInfo as pickedMapInfo, mapId as pickedMapId } from "./ui/map-pick.js";
import * as RK from "./ui/ranked.js"; // Ranked Battle: the camp, the matched foe, the result (server/ranked.mjs)
import { loadSurfaceArrays, surfaceIdTexture } from "./render/splat.js";
import { SURFACE_TEX, ROCK_TEX } from "./render/surface-tex.js";
import { makeCamera } from "./render/camera.js";
import { Q, PRESETS, setQuality, onQuality } from "./render/quality.js";
import { glyphSVG } from "./ui/glyphs.js";
import { openOrderPopup, openAttackPopup, orderContext } from "./ui/orders.js";
import { makePlaces } from "./ui/places.js";
import { makeCommand } from "./ui/commanders.js";
import { makeEventLog } from "./ui/eventlog.js";
import { showSpells, canCast, SPELL_INFO } from "./ui/spells.js";
import { showTechTree } from "./ui/tech.js";               // research at the keep (js/sim/tech.js, docs/tech.md)
import * as TC from "./sim/tech.js"; const { TECHS } = TC;
import { chooseMatch, updateSiegeBar, showEnd, DIFFICULTY } from "./ui/match-ui.js";
import { makeSpellFx } from "./render/spellfx.js";
import { matchOutcome, makeTally, tallyEvents } from "./sim/match.js";
import { DISPOSITIONS } from "./sim/legend.js";
import { canSee } from "./sim/vision.js";
import { SPELLS } from "./sim/econ-data.js";
import { chooseBattle, customConfig } from "./ui/battle-setup.js";
import { scenarioConfig, SCENARIOS } from "./sim/scenarios.js";
import { prepareField, daylight, startBattle, addBridge } from "./ui/battle-run.js";
import { makeDeploy } from "./ui/battle-deploy.js";
import { makeMoments } from "./ui/battle-moments.js";
import { chooseSiege, siegeConfig, siteFor } from "./ui/siege-setup.js";
import { setupSiegeRun, siegeUI } from "./ui/siege-run.js";
import { castlePick, castleOrders, lastPlace } from "./ui/castle-orders.js";
import { makeClickUI } from "./ui/click-target.js";
import { FORCES as SIEGE_FORCES } from "./sim/siege-war.js";
import { showAftermath } from "./ui/aftermath.js";
import { tellBattle, groundSentence } from "./sim/battle-story.js";
import { surveyField } from "./sim/battlefield.js";
import { initAudio } from "./audio/index.js";
import { makeAvatarUI } from "./ui/avatar-ui.js";
import { makeCommandKeys } from "./ui/command-keys.js";
import { openTaskMenu } from "./ui/task-menu.js";          // broad tasks: right-click a company (js/sim/broad.js)
import { openCourierDialog, lettersButton } from "./ui/courier.js"; // "Send as courier…": a villager with a letter to another house (js/sim/couriers.js)
import { TASK_WORD } from "./sim/broad.js";
import { makeHandbook } from "./ui/handbook.js";            // the bottom-left book: how to play, and the settings
import { makeWorldMap } from "./ui/worldmap.js";            // M: the world map of everything explored
import { takeField, lordStatus } from "./sim/avatar.js";
import { makeCommands, commandSystems, advanceChains, ORDER_WORD } from "./game/commands.js";
import { connectRealm, makeMirror, savedSession } from "./realm/client.js";
import { showJoining, makeRealmUI, showAway, realmClock, chooseHouse, showFallen } from "./realm/ui.js";

const PLAYER = 0;
const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);

async function loadTerrainTable() {
  try { return (await import("./sim/terrain-types.js")).TERRAIN || {}; } catch { return {}; }
}

async function boot() {
  // ---- the Realm (?realm): the world lives on the realm server; this page is a window on it (js/realm/). Who you are is
  // the session play.html signed this device in with (localStorage) — never anything in the URL
  const LIVE = params.get("live"); // a live ranked battle: another player's host on a field the server runs (server/live-battle.mjs)
  const REALM = params.has("realm") || !!LIVE;
  let realm = null, joining = null, realmUI = null, fellShown = false;
  // the house's standing (hello.you.house, then state.house): the realm card, and "Your house has fallen" once
  const realmHouse = (h) => {
    if (!h) return; realmUI?.house(h);
    if (h.fallen && !fellShown && realmUI) { fellShown = true; showFallen(document.querySelector("#modal"), h.fallen, { onRestart: (fail) => realm.cmd("restart", {}, (a) => { if (!a.ok) fail(a.error || "No free hold"); }) }); }
  };
  if (REALM) {
    joining = showJoining();
    if (params.has("t")) { const u = new URL(location.href); u.searchParams.delete("t"); history.replaceState(null, "", u); } // (an old invite link: its code means nothing now)
    const session = savedSession(); if (!session) { joining.signedOut(); return; }
    realm = connectRealm({ session, url: LIVE ? `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ranked/live?id=${encodeURIComponent(LIVE)}` : null, onStatus: (s, why) => { joining?.status(s, why); realmUI?.connection(s, why); } });
    try { await realm.hello0; } catch { return; } // (refused: the joining card says why)
    // a player with no house yet (first join, or starting over after a fall) founds it: arms and a name (js/realm/ui.js)
    while (realm.hello.you.house && !realm.hello.you.house.founded) {
      joining.hide?.(true);
      const pick = await chooseHouse(document.querySelector("#modal"), realm.hello);
      joining.hide?.(false); joining.status("online");
      const next = realm.nextHello(), ack = await new Promise((res) => realm.cmd("found", pick, res));
      if (!ack.ok) { toast(ack.error || "The house could not be founded"); continue; }
      await next;
    }
  }
  // banners first: the player's arms (and the enemy's contrasting ones) colour everything
  const realmBanner = (t) => BANNERS.find((b) => b.id === realm.hello.teams?.find((q) => q.id === t)?.banner) || BANNERS[t % BANNERS.length];
  const myTeam = REALM ? realm.hello.you.team : 0;
  const mine = REALM ? (BANNERS.find((b) => b.id === realm.hello.you.banner) || realmBanner(myTeam)) : params.has("shot") || params.has("bench") || params.has("banner") ? (BANNERS.find((b) => b.id === +params.get("banner")) || BANNERS[0]) : params.get("mode") === "ranked" && rankedBanner() ? rankedBanner() : await chooseBanner(document.querySelector("#modal")); // (?banner=: already chosen — the pitched-battle button carries it over)
  // the realm's mirror swaps our team with team 0 (js/realm/client.js): mirror index → the house's real team
  const rawOf = (m) => (REALM ? (m === 0 ? myTeam : m === myTeam ? 0 : m) : m);
  const theirs = REALM ? realmBanner(rawOf(1)) : enemyBannerFor(mine);
  // the match: difficulty and the enemy lord's temper (headless checks: ?diff=0.7&edisp=aggressive, or ?demo=start to see the screen)
  const RANKED = params.get("mode") === "ranked"; // a pitched battle against the matchmaker's foe (js/ui/ranked.js)
  const BATTLE = params.get("mode") === "battle" || RANKED; // a pitched battle only: two armies drawn up, no towns to run
  const SIEGE = params.get("mode") === "siege"; // a siege only: a castle, its garrison and the besieging host (js/ui/siege-run.js)
  const quick = ((params.has("shot") || params.has("bench")) && params.get("demo") !== "start") || BATTLE || SIEGE || REALM;
  const setup = quick ? { difficulty: +(params.get("diff") || 0.7), disposition: params.get("edisp") || "aggressive", hidden: false }
    : await chooseMatch(document.querySelector("#modal"), mine, theirs);
  setup.diffName = Object.values(DIFFICULTY).find((d) => Math.abs(d.value - setup.difficulty) < 0.01)?.name || `difficulty ${setup.difficulty}`;
  const banners = [mine, theirs];
  // every house at its mirror index wears its OWN arms (houses founded after we joined too). (Was: mirror team 1 always
  // got team 0's arms, so on the screens of houses 2+ house 1's men wore house 0's colours, and house 0's men — its arms
  // in twice — whatever spare colour the dedupe below gave the copy)
  if (REALM) for (let m = 0; m < 8; m++) banners[m] = m === 0 ? mine : realmBanner(rawOf(m));
  for (let i = 0; i < banners.length; i++) if (!banners[i]) banners[i] = BANNERS[(i + 3) % BANNERS.length];
  // every house its own colour: arms that share a field (azure, and per bend azure and argent) would put two houses in one
  // coat — the second takes its arms' other tincture, else a colour nobody wears. Houses choose in the realm's order (team
  // 0 first), not the viewer's, so a house wears the same colours on every player's screen
  const houseCol = [], usedCol = new Set();
  banners.map((b, i) => i).sort((a, b) => rawOf(a) - rawOf(b)).forEach((i) => { const b = banners[i]; const opts = [b.field, b.ct, b.second].filter((t) => t && TINCTURES[t]).map((t) => TINCTURES[t]); const c = opts.find((q) => !usedCol.has(q)) || SPARE_COLS.find((q) => !usedCol.has(q)) || opts[0]; usedCol.add(c); houseCol[i] = c; });
  // …and its trim never another house's colour (azure-and-or arms beside a house in or put our men in their gold)
  const houseAcc = banners.map((b, i) => [bannerAccent(b), ...[b.ct, b.second, "argent", "sable", "or", "gules"].filter((t) => t && TINCTURES[t]).map((t) => TINCTURES[t])].find((c) => c !== houseCol[i] && !houseCol.some((q, j) => j !== i && q === c)) || bannerAccent(b));
  while (DOT_TEAM.length < banners.length) DOT_TEAM.push(DOT_TEAM[0].clone());
  banners.forEach((b, i) => { DOT_TEAM[i].set(houseCol[i]); document.documentElement.style.setProperty(`--t${i}`, houseCol[i]); document.documentElement.style.setProperty(`--t${i}a`, houseAcc[i]); });
  setTeamBanners(banners.map((b) => drawBanner(b, 256, 192)));
  let map;
  if (REALM) { joining.remove(); joining = null; }
  // the map dir everything below loads from: the realm server names its own; otherwise ?map= (js/ui/map-pick.js)
  const MAP_DIR = REALM && realm.hello.map ? realm.hello.map : pickedMapDir();
  showLoading(REALM && realm.hello.map ? null : pickedMapInfo().name); loadingStart(); await new Promise((r) => setTimeout(r, 30)); // let the screen paint before the heavy work
  try { map = REALM && realm.hello.world ? await streamMap(MAP_DIR, { fetcher: fetch }) : null; } catch (e) { console.error("the world does not stream", e); }
  if (!map) try { map = await loadMap(MAP_DIR, fetch, { farmland: BATTLE || SIEGE || !!LIVE }); } catch { map = placeholderMap(); }
  const RM = map.core || map; // the square the terrain mesh and its textures cover (the big world draws the rest: js/render/worldstream.js) // (a battle or a siege keeps the painted crops: cover; the world is grass — js/sim/map.js)
  loadingStep("map"); loadingStep("land");
  // ---- a pitched battle: the field, the hosts, the day (the setup screen, a replay of the last one, or ?scenario= for checks)
  let bcfg = null;
  if (BATTLE) {
    const settle0 = await fetch(`${MAP_DIR}/settlements.json`).then((r) => r.ok ? r.json() : null).catch(() => null);
    bcfg = await battleConfig(map, banners, makePlaces(map, settle0));
    prepareField(map, bcfg);
    setup.disposition = bcfg.sides.find((d) => d.ai)?.temper || setup.disposition; setup.hidden = !!bcfg.sides.find((d) => d.ai)?.hidden;
  }
  // ---- a siege: the castle, your side, the forces, the season (the setup screen, or ?castle= for headless checks)
  let scfg = null, castleApi = null;
  if (SIEGE) {
    castleApi = await import("./sim/castle.js").catch(() => null);
    const settle0 = await fetch(`${MAP_DIR}/settlements.json`).then((r) => r.ok ? r.json() : null).catch(() => null);
    scfg = await siegeCfg(map, banners, makePlaces(map, settle0), castleApi);
  }
  const terrain = await loadTerrainTable();
  // the ground's texture layers: one per distinct texture used. Fetched and decoded from here on, while the world is set up
  // (and the realm's first state arrives); awaited when the terrain is laid
  const surfTexNames = RM.surface && RM.surfaceKeys.length ? [ROCK_TEX, "grazed_pasture", "heath", "tall_grass", "forest_floor", "sand", ...new Set(RM.surfaceKeys.map((k) => SURFACE_TEX[k] || "short_meadow"))].filter((v, i, a) => a.indexOf(v) === i) : null;
  const surfArraysP = surfTexNames ? loadSurfaceArrays(surfTexNames, terrain) : null;
  const w = createWorld({ map, terrain, seed: 1234, nav: !map.streamed }); // (the realm's browser runs no sim: a streamed world has no nav grid)
  w.humanTeam = PLAYER; // (your companies scattered by a charge stay scattered until you order them; the AI's captains re-form theirs)
  const V = makeVision(map);
  // the campaign lives under the calendar's sky (js/sim/weather.js); a battle or siege keeps its setup-screen weather
  if (!REALM && !BATTLE && !SIEGE) { if (params.has("wx")) w.weatherForce = params.get("wx"); w.systems.push(weatherSystem); } // (?wx=heavy_rain: a pinned sky for shots and checks)
  if (!REALM) w.systems.push(combatSystem, legendSystem, EC.economySystem, logisticsSystem, convoySystem, (w) => updateVision(w, V, map.canopyGrid ? map.canopy : null)); // (the realm: no sim here, only the renderer's and the audio's event taps)
  // trunks, hedges and buildings are physical: loaded before the first tick, resolved after every tick
  w.obstacles = makeObstacles();
  const [vegFile, objData, footprints] = await Promise.all([map.vegetation ? null : `${MAP_DIR}/vegetation.json`, `${MAP_DIR}/objects.json`, "assets/footprints.json"].map((u) => u && fetch(u).then((r) => r.ok ? r.json() : null).catch(() => null)));
  const vegData = map.vegetation || vegFile; // (a tiled map brings its trees: js/sim/map.js)
  if (vegData && !REALM) loadVegetation(w.obstacles, vegData);
  // obstacles: landmarks from the map file; town buildings come from the live economy (below)
  if (objData && !REALM) loadObjects(w.obstacles, { objects: objData.objects.filter((o) => o.team === undefined || o.team === null) }, footprints || {});
  if (!REALM) w.systems.push(obstacleSystem);
  ensureSiege(w); if (!REALM) w.systems.push(siegeSystem); // engines, escalades, gates; walls are solid (after everything that moves men)
  // fences and hedgerows are battlefield features too (charges refuse them, archers shelter behind them, columns seek the gaps)
  w.features = featuresFromMapData(objData, vegData);
  // ---- the match: both towns with their people, retinues, stores and fields; Red is run by the AI general
  EC.initEconomy(w);
  if (!REALM && !BATTLE && !SIEGE) w.dragonsOn = true; // the campaign has the vale's two dragons (js/sim/dragons.js); battles and sieges never do (the realm's live on the server)
  let towns = (map.meta?.features || []).filter((f) => f.type === "town_site").map((f) => ({ x: f.xy_m[0], y: f.xy_m[1] }));
  if (towns.length < 2) towns = [{ x: 780, y: 820 }, { x: 3300, y: 3300 }];
  setupResources(w, { objectsJson: objData, towns, seed: 1234 * 7 + 1 });
  loadingStep("world");
  const settle = await fetch(`${MAP_DIR}/settlements.json`).then((r) => r.ok ? r.json() : null).catch(() => null);
  // nothing but the keep stands at the start: the players build their towns — on each town's plan
  let mirror = null; const chronQ = []; let chronIn = (L) => chronQ.push(L); // (the realm's chronicle lines, held until the chronicle is up)
  if (!REALM) {
    towns.slice(0, 2).forEach((t, i) => EC.makeTown(w, i, t.x, t.y, objData?.objects || [], { prebuilt: params.has("prebuilt") }));
    w.mapRoads = settle?.roads || []; // the roads on the land: the planner lays the lanes along them
    w.plans = [0, 1].map((i) => { const T = w.teams[i]; return buildPlan(i, params.has("prebuilt") ? settle?.towns?.find((s) => s.team === i) || {} : FD.seatSpec(w, i), EC.fieldSites(w, i, T.town.x, T.town.y)); }); // (?prebuilt keeps the map's baked village: its cottages stand on those plots)
    if (!BATTLE && !SIEGE) w.systems.push(FD.foundingSystem); // settlers, camps and daughter towns (js/sim/founding.js)
  } else { // ---- the realm: a mirror of what the server lets us see (js/realm/client.js); our team is team 0 in it
    w.plans = []; w.mapRoads = settle?.roads || []; // (the roads: the siting preview keeps buildings off them, as the server does)
    for (let t = w.teams.length; t < banners.length; t++) w.teams.push({ id: t, name: `team ${t + 1}`, res: {} });
    for (const T of w.teams) { T.store ||= {}; T.census ||= { inTraining: 0 }; T.dependants ??= 0; T.squires ??= 0; }
    mirror = makeMirror(realm, w, V, { myTeam, onChron: (L) => chronIn(L), onPlayers: (p) => realmUI?.players(p), onState: (o) => { if (o.house) realmHouse(o.house); if (o.teams) realm.hello.teams = o.teams; } });
    realm.attach(mirror);
    if (LIVE) { const F = realm.hello.live?.field, z = F?.zones?.[F.side]; w.teams[0].town = z ? { x: z.cx, y: z.cy } : { x: map.size / 2, y: map.size / 2 }; w.teams[0].hq = { ...w.teams[0].town }; } // (a live battle: no keep — your ground)
    for (let k = 0; k < 150 && !w.teams[0].town; k++) await new Promise((r) => setTimeout(r, 100)); // (the first full state)
    if (!w.teams[0].town) { const h = w.buildings.find((b) => b.team === 0 && b.kind === "town_hall"); w.teams[0].town = h ? { x: h.x, y: h.y } : { x: map.size / 2, y: map.size / 2 }; }
  }
  // ---- commanders & delegation, the chronicle's feed, the match tally (sim systems: they run in warm-ups and demos too)
  const places = makePlaces(map, settle);
  let chron = null, camRef = null; const early = [];
  const logEv = (text, o = {}) => chron ? chron.add(text, o) : early.push([text, o]);
  const focusAt = (x, y) => camRef?.focus(x, y);
  const tally = makeTally(); if (!REALM) w.systems.push((w) => tallyEvents(w, tally));
  const cmd = makeCommand(w, { PLAYER, V, places, toast, log: logEv, focus: focusAt, onDelegate: (ids) => dropChains(ids), promptEl: $("#battlepop"), promptMs: params.has("shot") ? 1e9 : 25000 });
  if (!SIEGE && !REALM) w.systems.push(cmd.system); // (a siege is one long fight the siege itself tells — js/ui/siege-run.js: no "Battle at…" for every brush at the walls)
  if (!REALM) { w.systems.push(captainSystem); captainHooks(w, { V, placeAt: (x, y) => places.at(x, y), delegated: (id) => !!cmd.delegatedBattle(id) }); } // every company's captain: reports, initiative, proposal cards (js/sim/captains.js)
  // ---- the player's commands (js/game/commands.js): here they act on the sim at once; in the realm they go to the server
  // as `cmd` messages and come back as an ack. cmds.run(op, args, done(result)) is the same either way.
  if (!REALM) w.systems.push(...commandSystems(w, { measured: footprints || {} })); // (helping on a site, torches, fortifying, solid buildings, bowmen following a target)
  const local = REALM ? null : makeCommands(w, PLAYER);
  const cmds = REALM ? mirror.commands : {
    remote: false,
    run(op, args, done) { const r = local.apply(op, args); done?.(r); return r; },
    chainPoints: (ids) => local.chainPoints(ids), hasChain: (ids) => !!local.chainOf(ids),
  };
  const styleWatch = RANKED && bcfg?.ranked ? RK.makeStyleWatch(bcfg) : null; // (how you lead, from your orders: the heralds learn it)
  if (styleWatch) { const run0 = cmds.run; cmds.run = (op, a, done) => { try { styleWatch.note(op, a); } catch { /* never in the way */ } return run0.call(cmds, op, a, done); }; }
  w.teams[PLAYER].hq ||= { x: w.teams[PLAYER].town.x, y: w.teams[PLAYER].town.y }; // your orders go out from the keep
  const enemy = REALM ? null : makeGeneral(w, 1, { difficulty: setup.difficulty, disposition: setup.disposition, V });
  let generals = REALM ? [] : params.has("autoplay") ? [makeGeneral(w, 0, { difficulty: 0.7, disposition: "defensive", V }), enemy] : [enemy];
  let reeve = REALM || params.has("autoplay") ? null : makeGeneral(w, PLAYER, { difficulty: 0.7, disposition: "defensive", V });
  let battle = LIVE ? RK.liveBattle(realm.hello, { w, realm, toast: (m) => toast(m) }) : null; // (a live ranked battle: the server's field, framed as a battle here — js/ui/ranked.js)
  if (battle?.live) bcfg = battle.cfg;
  const battleDeps = { PLAYER, V, places, scene: null };
  if (BATTLE) { // ---- pitched battle: clear the field, draw up both hosts in their zones; the enemy is fought by the battle AI (js/ui/battle-run.js)
    generals = []; reeve = null;
    battle = startBattle(w, bcfg, battleDeps);
    if (params.has("shot") && !params.has("demo")) setInterval(() => { const c = [0, 0], f = [0, 0]; for (let i = 0; i < w.S.n; i++) if (w.S.alive[i] && !w.units.get(w.S.unit[i])?.isWorkers) { c[w.S.team[i]]++; if (w.S.state[i] === 3) f[w.S.team[i]]++; } const cen = (t) => { let x = 0, y = 0, n = 0; for (const u of w.units.values()) if (u.team === t && !u.isWorkers && u.members.length) { x += u.ax * u.members.length; y += u.ay * u.members.length; n += u.members.length; } return [Math.round(x / n), Math.round(y / n)]; }; const eu = [...battle.cmd.units].map((id) => w.units.get(id)).filter(Boolean).map((u) => `${u.arm}:${u.order?.kind}@${Math.round(u.ax)},${Math.round(u.ay)}`).join(' '); document.title = `BATTLE ${battle.phase} us@${cen(0)} them@${cen(1)} [${eu}] t=${Math.round(w.time)}s us ${c[0]} (${f[0]} fleeing) them ${c[1]} (${f[1]} fleeing) moments ${battle.rec.moments.length}${battle.rec.outcome ? " OVER winner " + battle.rec.outcome.winner : ""}`; }, 1000);
  }
  let siege = null;
  if (SIEGE) { generals = []; reeve = null; siege = setupSiegeRun(w, scfg, { PLAYER, places, castleApi }); } // ---- a siege: the castle, both hosts, the generals (js/sim/siege-war.js)
  if (reeve) { reeve.econEvery = 60; reeveThink(w, reeve, true); } // put everyone to work from the first moment
  loadingStep("towns"); await new Promise((r) => setTimeout(r, 0));
  for (let k = REALM ? 0 : +(params.get("warm") || 0); k > 0; k--) step(w); // headless checks: pre-run the sim

  const canvas = $("#view");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.aa, powerPreference: "high-performance", preserveDrawingBuffer: params.has("shot") });
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.dpr));
  const scene = new THREE.Scene();
  { // sky: our own gradient (zenith → hazy horizon), seen in low views
    const c = document.createElement("canvas"); c.width = 2; c.height = 256; const g = c.getContext("2d");
    const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, "#5f86b3"); gr.addColorStop(0.55, "#a9bfd3"); gr.addColorStop(1, "#d9dccf");
    g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
    const sky = new THREE.CanvasTexture(c); sky.colorSpace = THREE.SRGBColorSpace; scene.background = sky;
  }
  scene.fog = new THREE.Fog("#9fb2c2", 6000, 14000);
  const sun = new THREE.DirectionalLight("#fff3dc", 2.2); sun.position.copy(SUN_DIR).multiplyScalar(1000); scene.add(sun);
  const hemi = new THREE.HemisphereLight("#bcd2ea", "#4a4032", 0.9); scene.add(hemi);
  if (battle) { battleDeps.scene = scene; battle.env = daylight({ scene, sun, hemi, cfg: bcfg }); addBridge(scene, map, bcfg._tweaks?.bridge); } // the hour and the weather (before the terrain bakes its shadows)
  else if (siege && scfg?.weather && scfg.weather !== "clear") siege.env = daylight({ scene, sun, hemi, cfg: { tod: scfg.tod || "noon", weather: scfg.weather } }); // a siege fought in weather gets the same sky (clear keeps the default look)
  const terr = buildTerrain(RM, { outer: !map.streamed }); scene.add(terr.group); let terrCarveV = 0;
  terr.uniforms.worldBox.value.set(map.x0 || 0, map.y0 || 0, map.size); // (the fog, the clearings and the overlays cover the whole world)
  let surfPaint = null; // the surface id grid the terrain splats (a generated town's lanes are painted into it)
  terr.uniforms.terrFar.value = Q.terrFar; onQuality(() => { terr.uniforms.terrFar.value = Q.terrFar; });
  let layerOfKey = () => 0; // surface key → texture layer (the big world's tiles: js/render/worldstream.js)
  if (RM.surface && RM.surfaceKeys.length) {
    // texture layers: one per distinct texture used; remap surface ids → layer ids
    const texNames = surfTexNames; // (texture layers: one per distinct texture used — above, where their loading starts)
    const layerOf = RM.surfaceKeys.map((k) => texNames.indexOf(SURFACE_TEX[k] || "short_meadow"));
    layerOfKey = (k) => texNames.indexOf(SURFACE_TEX[k] || "short_meadow");
    if (RM.fields) {
      // the sim's plots (laid on these furlongs) are the only live crops: the map's baked late-summer standing corn
      // would be crops nobody planted, so the painted arable reads as last season's ground instead (old stubble/fallow)
      for (const [from, to] of [["standing_wheat", "stubble"], ["standing_barley", "stubble"], ["standing_oats_beans", "stubble"], ["ploughed_field", "fallow"]]) {
        const i = RM.surfaceKeys.indexOf(from), j = RM.surfaceKeys.indexOf(to);
        if (i >= 0 && j >= 0) layerOf[i] = layerOf[j];
      }
    }
    const remapped = new Uint8Array(RM.surface.length); for (let k = 0; k < remapped.length; k++) remapped[k] = layerOf[RM.surface[k]];
    loadingStep("terrain");
    const arrays = await surfArraysP;
    loadingStep("textures");
    terr.uniforms.surfId.value = surfaceIdTexture({ surface: remapped, res: RM.res });
    surfPaint = { data: remapped, tex: terr.uniforms.surfId.value, layer: (key) => texNames.indexOf(SURFACE_TEX[key] || key) }; // (js/render/towns.js paints a generated town's lanes and yards here)
    terr.uniforms.albedoArr.value = arrays.albedo; terr.uniforms.normalArr.value = arrays.normal;
    terr.uniforms.tileM.value.set(arrays.tile); terr.uniforms.splatOn.value = 1;
    const L = (t) => Math.max(0, texNames.indexOf(t));
    terr.uniforms.wildLayers.value.set([L("grazed_pasture"), L("heath"), L("tall_grass"), L("forest_floor")]);
    terr.uniforms.sandLayer.value = L("sand");
  }
  const fogTex = new THREE.DataTexture(new Uint8Array(V.n * V.n), V.n, V.n, THREE.RedFormat);
  fogTex.magFilter = fogTex.minFilter = THREE.LinearFilter;
  // the big world: the fog grid starts at the world's corner, every fog lookup (terrain, trees, men …) is world/size —
  // so the texture holds the grid turned round by the corner's offset and wraps (one layout for every shader)
  const fogShift = map.streamed ? [Math.round(-(V.ox || 0) / V.cellM), Math.round(-(V.oy || 0) / V.cellM)] : null;
  if (fogShift) fogTex.wrapS = fogTex.wrapT = THREE.RepeatWrapping;
  const fogUpload = (G) => { const d = fogTex.image.data, n = V.n; if (!fogShift) { d.set(G.map((v) => v * 127)); return; } for (let j = 0; j < n; j++) { const tj = ((j - fogShift[1]) % n + n) % n; for (let i = 0; i < n; i++) d[tj * n + (((i - fogShift[0]) % n + n) % n)] = G[j * n + i] * 127; } };
  terr.uniforms.fogTex.value = fogTex; terr.uniforms.fogOn.value = params.has("nofog") || battle || siege ? 0 : 1; // (a pitched battle: you know the land — only the enemy's men are hidden)
  FOG.fogTex.value = fogTex; FOG.fogOn.value = terr.uniforms.fogOn.value;
  if (RM.waterDepth) {
    const wt = new THREE.DataTexture(RM.waterDepth, RM.res, RM.res, THREE.RedFormat, THREE.FloatType);
    wt.minFilter = wt.magFilter = THREE.LinearFilter; wt.needsUpdate = true;
    terr.uniforms.waterTex.value = wt; terr.uniforms.waterOn.value = 1;
  }
  loadingStep("scene");
  const dots = makeDots(); scene.add(dots.points);
  // the men themselves near the camera (VAT-animated figures); ?figures=0 keeps plain dots everywhere
  const figures = params.get("figures") === "0" ? null : makeFigures(scene, map);
  const laborR = makeLaborRender(scene, map, { figures }); // (goods lying about and carried: docs/gathering-plan.md)
  const lanesR = makeLaneRenders(scene, map, { figures, laborR }); // (the gathering lanes' own pictures: fields, trees, game …)
  const dragonsR = makeDragonsRender(scene, map, {}); // the vale's dragons and their lairs (js/render/dragons.js)
  const veinsR = makeVeinsRender(scene, map, { realm: REALM, team: () => PLAYER }); // the veins' mouths and their holders' flags (js/render/veins.js)
  figures?.setAccents(houseAcc);
  loadingStep("figures");
  const markers = makeMarkers(scene, map);
  const blds = makeBuildings(scene);
  // clearance mask: building sites (and the ground around finished buildings) are cleared, trodden sand
  const CLR = map.streamed ? 2048 : 1024, clearData = new Uint8Array(CLR * CLR), CX0 = map.x0 || 0, CY0 = map.y0 || 0; // (over the world's extent)
  const clearTex = new THREE.DataTexture(clearData, CLR, CLR, THREE.RedFormat); clearTex.magFilter = clearTex.minFilter = THREE.LinearFilter; clearTex.needsUpdate = true;
  terr.uniforms.clearTex.value = clearTex; terr.uniforms.clearOn.value = 1;
  const cleared = new Set();
  function paintClearings() {
    let dirty = false; const cm = map.size / CLR;
    for (const b of w.buildings) {
      if (cleared.has(b.id) || b.field || b.kind === "town_hall") continue; cleared.add(b.id); dirty = true;
      const isWall = b.x1 !== undefined && !b.br, fp = EC.BUILDINGS[b.kind]?.footprint || [12, 10]; // (a timber bridge: only its near bank's yard is trodden — not the river)
      const hx = isWall ? Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 2 + 4 : fp[0] * 0.62 + 4, hy = isWall ? 5 : fp[1] * 0.62 + 4;
      const rot = isWall ? Math.atan2(b.y2 - b.y1, b.x2 - b.x1) : b.rot || 0, c = Math.cos(rot), s = Math.sin(rot), R = Math.hypot(hx, hy) + 6;
      for (let j = Math.floor((b.y - R - CY0) / cm); j <= Math.ceil((b.y + R - CY0) / cm); j++) for (let i = Math.floor((b.x - R - CX0) / cm); i <= Math.ceil((b.x + R - CX0) / cm); i++) {
        if (i < 0 || j < 0 || i >= CLR || j >= CLR) continue;
        const dx = CX0 + i * cm - b.x, dy = CY0 + j * cm - b.y, lx = Math.abs(dx * c + dy * s) / hx, ly = Math.abs(-dx * s + dy * c) / hy;
        const d = Math.pow(Math.pow(lx, 4) + Math.pow(ly, 4), 0.25); // soft rounded rectangle
        const v = Math.max(0, Math.min(1, (1.25 - d) / 0.5)) * 255;
        const k = j * CLR + i; if (v > clearData[k]) clearData[k] = v;
      }
    }
    for (const f of w.features || []) { // ditches and pits: dug earth along the line
      if ((f.type !== "ditch" && f.type !== "pits_pottes") || f._painted) continue; f._painted = true; dirty = true;
      const L = Math.hypot(f.x1 - f.x0, f.y1 - f.y0), n = Math.ceil(L / cm), r = (f.width || 2.5) / 2 + 1;
      for (let s2 = 0; s2 <= n; s2++) { const t = s2 / Math.max(1, n), x = f.x0 + (f.x1 - f.x0) * t, y = f.y0 + (f.y1 - f.y0) * t;
        for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const i = Math.round((x - CX0) / cm) + di, j = Math.round((y - CY0) / cm) + dj; if (i < 0 || j < 0 || i >= CLR || j >= CLR) continue;
          const dd = Math.hypot(CX0 + i * cm - x, CY0 + j * cm - y); if (dd < r) clearData[j * CLR + i] = 255; } }
    }
    if (dirty) clearTex.needsUpdate = true;
  }
  const fire = makeFire(scene, map);
  const wxFx = makeWeatherFx(scene); // rain and snow round the camera (js/render/weatherfx.js)
  const engines = makeEngines(scene, map, fire); // siege engines, stones and quarrels in flight, ladders
  const castles = makeCastles(scene, map, fire); // castles you go inside: walls, towers, keep, the cut-away (js/render/castle.js)
  const townWalls = makeTownWalls(scene, map); // the walks of a town's walls: ladders and stairs, men at the deck's height (js/render/townwalls.js)
  const visibleFig = (i) => visibleSoldier(i) && !castles.hides(w, i); // (men above a cut-away storey are not drawn)
  const works = makeFieldWorks(scene, map);
  const crossR = makeCrossings(scene, map); // bridges and fascine fills the men make (js/sim/crossings.js)
  const resBar = $("#res"), bpanel = $("#bpanel");
  let placing = null; // { kind, wall, p1 }
  // ---- the house's towns (js/sim/towns.js, js/sim/founding.js): the switcher, the founding mode, the towns on the ground
  let curTown = null; // the town the build menu works in (null: the seat)
  const myTowns = () => (w.teams[PLAYER]?.towns || []).filter((D) => !D.lost);
  const curPlan = () => { const D = curTown && myTowns().find((q) => q.id === curTown); return D?.plan || w.plans?.[PLAYER]; };
  const townSums = () => REALM ? (mirror?.towns || []) : [FD.townSummary(w, PLAYER, null), ...myTowns().map((D) => FD.townSummary(w, PLAYER, D))];
  const settling = (BATTLE || SIEGE || LIVE) ? null : makeSettling({ scene, map, canvas, groundAt: (cx, cy) => groundAt(cx, cy), run: (op, a, done) => cmds.run(op, a, done), toast: (m) => toast(m), onFounded: () => townsUI?.refresh(true) });
  const townsUI = (BATTLE || SIEGE || LIVE) ? null : makeTownsUI({ hud: $("#hud"), summaries: townSums, focus: (x, y) => camera.focus(x, y), onSelect: (id) => { curTown = id; if (placing) siteUI.start(placing.kind); },
    onFound: () => { placing = null; siteUI.cancel(); fieldDraw.cancel(); settling?.start(); if (settling) siteUI.found(() => settling.active); }, seatName: () => REALM ? (realm?.hello?.you?.house?.hold || "Your seat") : places.townName(PLAYER) });
  const townGround = makeTownGround({ scene, map,
    paintPoly: (poly, key) => { if (!surfPaint) return; const L = surfPaint.layer(key); if (L < 0) return; const c = map.cell, R = map.res; let a = Infinity, b = -Infinity, cc = Infinity, d = -Infinity; for (const [x, y] of poly) { a = Math.min(a, x); b = Math.max(b, x); cc = Math.min(cc, y); d = Math.max(d, y); }
      for (let j = Math.max(0, Math.floor(cc / c)); j <= Math.min(R - 1, Math.ceil(d / c)); j++) for (let i = Math.max(0, Math.floor(a / c)); i <= Math.min(R - 1, Math.ceil(b / c)); i++) { const x = i * c, y = j * c; let ins = false; for (let p = 0, q = poly.length - 1; p < poly.length; q = p++) { const [xi, yi] = poly[p], [xj, yj] = poly[q]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } if (ins && !(map.water(x, y) > 0.02)) surfPaint.data[j * R + i] = L; } },
    paintLine: (pts, key, width) => { if (!surfPaint) return; const L = surfPaint.layer(key); if (L < 0) return; const c = map.cell, R = map.res, h = width / 2;
      for (let k = 0; k + 1 < pts.length; k++) { const [ax, ay] = pts[k], [bx, by] = pts[k + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (c / 2))); for (let t = 0; t <= n; t++) { const x = ax + (bx - ax) * t / n, y = ay + (by - ay) * t / n; for (let j = Math.floor((y - h) / c); j <= Math.ceil((y + h) / c); j++) for (let i = Math.floor((x - h) / c); i <= Math.ceil((x + h) / c); i++) { if (i < 0 || j < 0 || i >= R || j >= R) continue; if (Math.hypot(i * c - x, j * c - y) <= h + c * 0.35 && !(map.water(i * c, j * c) > 0.05)) surfPaint.data[j * R + i] = L; } } } },
    flush: () => { if (surfPaint) surfPaint.tex.needsUpdate = true; } });
  // what the ground shows of each town: a plan read from the land (generated) and the plots whose cottages stand
  function townsOnGround() {
    const out = [], teams = REALM ? [0] : w.teams.map((T) => T.id);
    for (const t of teams) {
      const P = w.plans?.[t]; if (P?.town?.generated) out.push({ id: null, team: t, plan: P.town, built: builtPlots(P), state: "seat" });
      for (const D of w.teams[t]?.towns || []) if (!D.lost) out.push({ id: D.id, team: t, x: D.x, y: D.y, rot: D.spec?.hall?.rot || 0, state: D.state, settlers: 24, plan: D.state === "town" ? D.plan?.town || D.spec : null, built: D.plan ? builtPlots(D.plan) : null });
    }
    for (const s of REALM ? mirror?.towns || [] : []) if (s.id && !s.lost && s.state === "camp") out.push({ id: s.id, x: s.x, y: s.y, state: "camp", settlers: s.settlers || 24 });
    return out;
  }
  function builtPlots(P) {
    const plots = P.town?.plots; if (!plots?.length) return new Set();
    const at = new Map(plots.map((p, i) => [`${Math.round(p.house.x)},${Math.round(p.house.y)}`, i])), set = new Set();
    for (const q of P.slots) if (q.type === "toft" && q.taken) { const b = w.buildings.find((x) => x.id === q.taken); if (b && b.progress >= 1 && !b.ruin) { const i = at.get(`${Math.round(q.x)},${Math.round(q.y)}`); if (i !== undefined) set.add(i); } }
    return set;
  }
  // a field is DRAWN, not put on a plot: a rectangle square to the view, then the men clear and plough it (js/ui/fielddraw.js)
  const fieldDraw = makeFieldDraw({ scene, map, w, team: PLAYER, camera: { get st() { return camera.st; } }, canvas, groundAt: (cx, cy) => groundAt(cx, cy), run: (op, a, done) => cmds.run(op, a, done), toast: (m) => toast(m) });
  // the town the build menu works in, as the siting rules read it: its plan and its keep (js/sim/siting.js siteContext)
  const curHub = () => { const D = curTown && myTowns().find((q) => q.id === curTown); if (!D) return null; const h = D.s?.hall !== undefined && w.buildings.find((b) => b.id === D.s.hall); return h ? { x: h.x, y: h.y } : { x: D.x, y: D.y }; };
  const siteUI = makeSitingUI({ scene, map, w, team: PLAYER, canvas, groundAt: (cx, cy) => groundAt(cx, cy), run: (op, a, done) => cmds.run(op, a, done), toast: (m) => toast(m),
    ctxOpts: () => ({ plan: curPlan(), hub: curHub() || undefined, village: !!curHub() }), onDone: () => { placing = null; } });
  const bridgeUI = makeBridgeUI({ scene, map, w, team: PLAYER, canvas, groundAt: (cx, cy) => groundAt(cx, cy), run: (op, a, done) => cmds.run(op, a, done), toast: (m) => toast(m) });
  window.HGbridge = bridgeUI; // (debug handle for headless shots: tools/bridge-shots.mjs)
  $("#buildbtn").onclick = () => showBuildMenu(bpanel, w, PLAYER, (pick) => {
    bridgeUI.cancel();
    if (pick.kind === "bridge") { placing = null; fieldDraw.cancel(); if (typeof siteUI !== "undefined") siteUI.cancel(); markers.setPlan(null); markers.setGhost(null); bridgeUI.start(); return; }
    if (pick.kind === "field") { placing = null; siteUI.cancel(); fieldDraw.start(); return; }
    fieldDraw.cancel();
    if (pick.kind === "town_hall") { placing = null; siteUI.cancel(); if (settling) { settling.start(); siteUI.found(() => settling.active); } return; } // (a new keep elsewhere founds a new town: js/sim/founding.js)
    placing = pick; siteUI.start(pick.kind);
  });
  $("#cmdbtn").onclick = () => { if (!bpanel.hidden && bpanel.querySelector("h3")?.textContent === "Commanders") bpanel.hidden = true; else cmd.showPanel(bpanel, selected); };
  let spellAim = null; // spell being placed
  const techTree = () => { const el = $("#techpanel"); if (!el.hidden && el.dataset.kind === "tech") { el.hidden = true; el.dataset.kind = ""; return; } bpanel.hidden = true; showTechTree(el, w, PLAYER, (op, a, done) => cmds.run(op, a, done), toast); };
  $("#techbtn").onclick = techTree; // (the tech tree: js/ui/tech.js)
  $("#spellbtn").onclick = () => showSpells(bpanel, w, PLAYER, (k) => { spellAim = k; placing = null; siteUI.cancel(); markers.setPlan(null); markers.setGhost(null); toast(SPELL_INFO[k]?.aim || "Click the ground"); });
  // (a spell cast from the UI happens between ticks: its event would be wiped by the next step before the
  // chronicle or the tally saw it, so hand it over now)
  function spellCast() { const e = w.events.at(-1); if (e?.kind === "spell") { w.log.push(e); w.events.pop(); tally.spells[PLAYER]++; } }
  function castAt(pt) {
    const k = spellAim, why = canCast(w, PLAYER, k);
    if (why) { toast(why); return; }
    spellAim = null; spellfx.aim(null); hint.hidden = true;
    cmds.run("spell", { kind: k, x: pt.x, y: pt.y }, (r) => { said(r); if (r.ok && !cmds.remote) tally.spells[PLAYER]++; });
  }
  // trees & shrubs (our Blender-made GLBs). Species without a model yet borrow the nearest look-alike.
  const props = makeProps(scene, map, { renderer, light: { sunDir: SUN_DIR, sun, hemi } });
  castles.setProps(props); // (a castle clears the trees off its ground)
  const flora = makeFlora(scene, map, props); // undergrowth, forage thickets, tree skins + seasons (render-only)
  renderer.localClippingEnabled = true; // (castle.js: the storey in view of a kit part is sectioned by a clipping plane)
  const STAND_IN = { pine: "oak_c", birch: "oak_b", alder: "oak_b", willow: "oak_a", dead_tree: "oak_c", fruit_tree: "oak_b", bush: "oak_c", hedge_shrub: "oak_c", log: "oak_stump" };
  const STAND_IN_SCALE = { bush: 0.18, hedge_shrub: 0.16, fruit_tree: 0.4, birch: 0.8, alder: 0.75, pine: 0.9, dead_tree: 0.7, willow: 0.7 };
  let vegReady = false;
  Promise.resolve(vegData).then(async (veg) => {
    if (!veg || params.has("notrees")) return;
    const have = new Set(Object.keys(veg.assets || {}));
    const byAsset = new Map();
    for (const it of veg.instances) {
      let a = it.asset, sc = it.scale || 1;
      const skin = skinOf(it, map); // render-only species variety (flora.js): same spot, same sim tree
      if (skin !== a && (await assetExists(skin.split("~")[0]))) a = skin; // ("willow~alder": a willow model on a sim alder)
      const glbOk = await assetExists(a.split("~")[0]);
      if (!glbOk) { sc *= STAND_IN_SCALE[a] ?? 1; a = STAND_IN[a] || "oak_a"; }
      if (!byAsset.has(a)) byAsset.set(a, []);
      byAsset.get(a).push({ x: it.x, y: it.y, rot: it.rot, scale: sc });
    }
    // the land beyond the edge is the map mirrored — so are its woods (render only; nobody goes there). The big world has
    // real land there, its own trees (js/render/worldstream.js)
    const S = map.size, BAND = 90;
    if (!map.streamed) for (const items of byAsset.values()) {
      const extra = [];
      for (const it of items) {
        const mx = it.x < BAND ? [-it.x] : it.x > S - BAND ? [2 * S - it.x] : [];
        const my = it.y < BAND ? [-it.y] : it.y > S - BAND ? [2 * S - it.y] : [];
        for (const x of mx) extra.push({ ...it, x });
        for (const y of my) extra.push({ ...it, y });
        for (const x of mx) for (const y of my) extra.push({ ...it, x, y });
      }
      items.push(...extra);
    }
    // wild woods out in the country beyond the edge: clumps where the same noise the shader uses says woodland
    const wild = { oak_a: [], oak_b: [], oak_c: [] }; const M = S * 0.75;
    if (!map.streamed) for (let y = -M; y < S + M; y += 22) for (let x = -M; x < S + M; x += 22) {
      if (outside(map, x, y) < 70) continue;
      const jx = x + (vnoise(x * 0.37, y * 0.37) - 0.5) * 20, jy = y + (vnoise(x * 0.41 + 5, y * 0.41) - 0.5) * 20;
      const dense = vnoise(jx * 0.0016 * 1.0, jy * 0.0016) ; if (dense < 0.6 && vnoise(jx * 0.02, jy * 0.02) > 0.04) continue;
      const k = ["oak_a", "oak_b", "oak_c"][(Math.floor(jx * 7 + jy * 3) >>> 0) % 3];
      wild[k].push({ x: jx, y: jy, rot: vnoise(jx, jy) * 6.28, scale: 0.85 + vnoise(jy, jx) * 0.35 });
    }
    for (const [a, items] of Object.entries(wild)) { if (!byAsset.has(a)) byAsset.set(a, []); byAsset.get(a).push(...items); }
    for (const [a, items] of byAsset) props.add(a, items);
    flora.setVeg([].concat(...[...byAsset].map(([a, items]) => items.map((it) => ({ asset: a, x: it.x, y: it.y, scale: it.scale }))))); // (ivy/moss on the old trunks)
  }).finally(() => { vegReady = true; });
  // settlement buildings, landmarks and resource nodes (only assets whose model exists yet)
  Promise.resolve(objData).then(async (od) => {
    if (!od) return;
    flora.addForage(od.objects.filter((o) => o.kind === "forage")); // the forage thickets get their bushes (flora.js)
    const byAsset = new Map();
    for (const o of od.objects) {
      if (o.start === false || (o.team !== undefined && o.team !== null) || !(await assetExists(o.asset))) continue;
      if (REALM && (o.kind === "silver_vein" || o.kind === "gold_vein")) continue; // (the realm draws its veins where the server has them: js/render/veins.js)
      if (!byAsset.has(o.asset)) byAsset.set(o.asset, []);
      byAsset.get(o.asset).push({ x: o.x, y: o.y, rot: o.rot || 0, scale: o.scale || 1, dz: -0.15 });
    }
    for (const [a, items] of byAsset) props.add(a, items);
  });
  function assetExists(a) { return glbExists(a); } // (a shipped build lists its models — js/build.js: no HEAD request per model)
  const camera = makeCamera(canvas, map);
  // the big world round the Vale (docs/big-world.md): its far land, its tiles and their trees as they stream in
  const worldStream = map.streamed ? makeWorldStream({ scene, map, terr, props, layerOfKey, onTile: (T) => flora.restale([T.ox - 10, T.oy - 10, T.ox + 510, T.oy + 510]), treesOf: (T) => {
    const by = new Map();
    for (const it of T.veg) {
      let a = it.asset, sc = it.scale || 1; const skin = skinOf(it, map);
      if (skin !== a && haveGlb.get(skin.split("~")[0])) a = skin;
      if (!haveGlb.get(a.split("~")[0])) { sc *= STAND_IN_SCALE[a] ?? 1; a = STAND_IN[a] || "oak_a"; }
      if (!by.has(a)) by.set(a, []); by.get(a).push({ x: it.x, y: it.y, rot: it.rot, scale: sc });
    }
    return by;
  } }) : null;
  const haveGlb = new Map(); // (which tree models exist: asked once, before the first tile's trees are drawn)
  if (worldStream) await Promise.all(["oak_a", "oak_b", "oak_c", "oak_stump", "pine", "birch", "alder", "willow", "dead_tree", "fruit_tree", "bush", "hedge_shrub", "log", "struck_oak", "beech", "rowan", "blackthorn", "hawthorn", "elder"].map(async (a) => haveGlb.set(a, await assetExists(a))));
  camRef = camera;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  chron = makeEventLog($("#chron"), { onJump: (x, y) => camera.focus(x, y), dateOf: () => { if (battle) { const t = battle.phase === "deploy" ? 0 : w.time - battle.rec.t0; return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`; } if (siege) return `day ${Math.floor((w.time - siege.t0) / 40) + 1}`; const d = new Date(2026, 0, 1 + Math.floor(w.econ.doy)); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; } });
  if (battle?.live) { // a live ranked battle: the server's chronicle (its moments) fills the log
    chron.add(`${bcfg.name}. ${realm.hello.live.foe.name} commands the host opposite — a living lord, not the heralds' AI.`, { x: bcfg.site.x, y: bcfg.site.y });
    chronIn = (L) => { if (L.toast) toast(L.text); logEv(L.text, { ...(Number.isFinite(L.x) ? { x: L.x, y: L.y } : {}), tone: L.tone }); };
    for (const L of chronQ.splice(0)) chronIn(L);
  }
  else if (battle) chron.add(`${bcfg.name}${bcfg.scenario ? ", " + bcfg.scenario.year : ""}. ${cap(battle.names.lord(1 - PLAYER))} is ${setup.hidden ? "a man you have yet to measure" : "a " + (DISPOSITIONS[setup.disposition]?.name || setup.disposition)}.`, { x: bcfg.site.x, y: bcfg.site.y });
  else if (siege) chron.add(`${siege.cfg.name}. ${siege.att === PLAYER ? "You lay siege to it" : "You hold it"} with ${siege.roster.start[PLAYER]} men against ${siege.roster.start[1 - PLAYER]}.`, { x: siege.castle.x, y: siege.castle.y });
  else if (REALM) { // the realm's own chronicle (written by the server) fills the log; the HUD card; what happened while away
    const H0 = w.teams[PLAYER].town, c0 = realmClock(w.econ);
    chron.add(`${realm.hello.you.name || "You"} ride${realm.hello.you.name ? "s" : ""} into the realm: day ${c0.day}, ${c0.season.toLowerCase()}.`, { x: H0.x, y: H0.y });
    chronIn = (L) => { if (L.toast) toast(L.text); logEv(L.text, { ...(Number.isFinite(L.x) ? { x: L.x, y: L.y } : {}), tone: L.tone }); };
    for (const L of chronQ.splice(0)) chronIn(L);
    realmUI = makeRealmUI({ hud: $("#hud"), hello: realm.hello, w, myTeam, realm });
    realmUI.connection(realm.status);
    realmHouse(realm.hello.you.house);
    { const card = $("#realmcard"); if (card) lettersButton(card, () => mirror.letters, { dayOf: (L) => `day ${realmClock({ doy: L.doy, startDoy: w.econ.startDoy }).day}` }); } // (the letters couriers have brought: js/ui/courier.js)
  }
  else { const H0 = w.teams[PLAYER].town; chron.add(`The campaign opens. The lord of ${places.townName(1)} is ${setup.hidden ? "a man you have yet to measure" : "a " + (DISPOSITIONS[setup.disposition]?.name || setup.disposition)}.`, { x: H0.x, y: H0.y }); }
  for (const [t, o] of early.splice(0)) chron.add(t, o);
  const spellfx = makeSpellFx(scene, map);
  const audio = initAudio({ w, camera, map, player: PLAYER, castles }); // our own synthesized sound (js/audio/)
  { // render quality (View panel): Low / Medium / High, remembered per browser
    const qBtns = document.querySelectorAll("[data-quality]");
    const mark = () => qBtns.forEach((b) => b.classList.toggle("on", b.dataset.quality === Q.name));
    qBtns.forEach((b) => b.onclick = () => setQuality(b.dataset.quality)); mark();
    onQuality(() => { renderer.setPixelRatio(Math.min(devicePixelRatio, Q.dpr)); mark(); });
  }
  const viewBtns = document.querySelectorAll("[data-view]");
  viewBtns.forEach((b) => b.onclick = () => camera.setView(+b.dataset.view));
  camera.onViewChange(() => viewBtns.forEach((b) => b.classList.toggle("on", +b.dataset.view === camera.st.view)));
  // the Player's Handbook (bottom-left; F1 or ?): how to play, the town's growth, battle, beasts, the Realm — and the
  // settings (quality, mute, the views) beside the View panel's own (js/ui/handbook.js). It never pauses anything.
  const handbook = makeHandbook({ realm: REALM, toast: (m) => toast(m), settings: {
    quality: { get: () => Q.name, set: (n) => document.querySelector(`#overlays [data-quality="${n}"]`)?.click() },
    sound: audio.engine ? { muted: () => !!audio.engine.settings.muted, setMuted: (m) => { if (!!audio.engine.settings.muted !== m) document.querySelector("#overlays .hgsndb button")?.click(); } } : null,
    views: [...viewBtns].map((b) => ({ id: b.dataset.view, name: b.textContent.trim() })), setView: (id) => camera.setView(+id) } });
  // the WORLD MAP (M, the map button above the book, "World map" in the View panel): all you have explored, drawn from the
  // map's own data and the fog grid only (js/ui/worldmap.js). The realm: the server's teams (the mirror swaps ours with 0).
  const sidOf = (t) => t === 0 ? myTeam : t === myTeam ? 0 : t, hTeam = (t) => realm?.hello?.teams?.find((q) => q.id === sidOf(t));
  const worldMap = makeWorldMap({ map, w, V, PLAYER, settle, places, banners, camera, realm: REALM, mapName: map.meta?.name,
    landKnown: !!(battle || siege || params.has("nofog")), holds: REALM ? (realm.hello.holds || []).map((h) => ({ name: h.name, x: h.x, y: h.y })) : null,
    teamName: (t) => REALM ? hTeam(t)?.name || `House ${t + 1}` : places.townName(t),
    townName: (t, b) => b?.tname || (REALM ? hTeam(t)?.town || hTeam(t)?.name : places.townName(t)), // (a daughter's manor hall carries its town's name: js/sim/founding.js)
    focus: (x, y) => { lordUI?.setActive?.(false); camera.focus(x, y); } });
  { const vb = document.createElement("button"); vb.id = "wmapview"; vb.textContent = "World map (M)"; vb.title = "Everything you have explored"; vb.onclick = () => worldMap.toggle(); document.querySelector("#overlays .views:not(.quality)")?.after(vb); }
  if (params.has("view")) camera.setView(+params.get("view"));
  const atParam = params.get("at");
  const first = [...w.units.values()].find((u) => u.team === PLAYER);
  { const T0 = w.teams[PLAYER].town; camera.focus(T0.x + 60, T0.y + 40); } // open on our own town
  if (battle) { // look from behind your own ground toward the enemy's
    const z = battle.zones[battle.sideOf(PLAYER)], at = { x: z.cx + Math.cos(z.face) * 190, y: z.cy + Math.sin(z.face) * 190 };
    camera.focus(at.x, at.y); camera.setView(1); camera.st.yaw = z.face - Math.PI / 2; camera.goal.dist = camera.st.dist = 1050;
    for (const sel of ["#res", "#buildbtn"]) { const el = document.querySelector(sel); if (el) el.style.display = "none"; }
    document.querySelectorAll("#topbar button").forEach((b) => { if (/Build|Spells|Research/.test(b.textContent)) b.style.display = "none"; });
    document.body.classList.add("battle-mode");
  }
  if (atParam) { const [ax, ay] = atParam.split(",").map(Number); camera.focus(ax, ay); camera.st.yaw = +(params.get("yaw") || 0); }

  const selected = new Set();
  const visibleSoldier = REALM ? (i) => mirror.visible(i) : (i) => w.S.team[i] === PLAYER || V.teams[PLAYER][visIdx(V, w.S.x[i], w.S.y[i])] === 2;

  // ---------------------------------------------------------------- overlays
  let ovKind = "none"; const OVR = 192;
  const ovTex = new THREE.DataTexture(new Uint8Array(OVR * OVR * 4), OVR, OVR, THREE.RGBAFormat);
  ovTex.magFilter = ovTex.minFilter = THREE.LinearFilter; terr.uniforms.ovTex.value = ovTex;
  function setOverlay(kind) {
    ovKind = kind;
    document.querySelectorAll("#overlays [data-ov]").forEach((b) => b.classList.toggle("on", b.dataset.ov === kind));
    if (kind === "none") { terr.uniforms.ovOn.value = 0; return; }
    let from = null;
    if (kind === "los") { const u = [...selected].map((id) => w.units.get(id))[0]; from = u ? { x: u.ax, y: u.ay } : { x: camera.st.tx, y: camera.st.ty }; }
    ovTex.image.data.set(overlayRaster(w, kind, OVR, from)); ovTex.needsUpdate = true; terr.uniforms.ovOn.value = 1;
  }
  document.querySelectorAll("#overlays [data-ov]").forEach((b) => b.onclick = () => setOverlay(b.dataset.ov));

  // ---------------------------------------------------------------- picking
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function groundAt(cx, cy) {
    ndc.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera.cam);
    const hit = ray.intersectObject(terr.group, true).find((h) => h.object !== terr.outer); // (the group: over a castle the base mesh gives way to its ditch patches — js/render/terrain.js setCarves; never the mirrored land beyond the edge)
    return hit ? { x: hit.point.x, y: -hit.point.z, sx: cx, sy: cy } : null; // (sx, sy: where on the screen — a castle click is picked on its masonry, js/ui/castle-orders.js)
  }
  const proj = new THREE.Vector3();
  function toScreen(x, y, lift = 1.5) {
    proj.set(x, map.h(x, y) + lift, -y).project(camera.cam);
    return { x: (proj.x + 1) / 2 * innerWidth, y: (1 - proj.y) / 2 * innerHeight, front: proj.z < 1 };
  }

  // ---------------------------------------------------------------- input: box select + click-to-order
  // Box-select makes a COMMAND GROUP of exactly the men inside the box (all types together).
  // Click a group's label/men to select that whole group. With a selection, click ground → marker +
  // "what should they do there?" popup. X, right-click or the Deselect button leaves select mode.
  // the building panel's buttons (recruit at the keep, a workshop's product) go through the command layer too
  const panelActs = {
    recruit: (b, arm, n, rushed, done, mount = null) => cmds.run("recruit", { bid: b.id, arm, n, rushed, mount }, done),
    retrain: (b, unit, mount, done) => cmds.run("retrain", { bid: b.id, unit, mount }, done),
    product: (b, what, done, n = null) => cmds.run("product", { bid: b.id, what, n }, done), // (n: make that many, then stop)
    crew: (b, n, done) => cmds.run("crew", { bid: b.id, n }, done), // (a workshop's crew: n men, or null = the reeve's)
    techTree: () => techTree(), // (the keep's "Research…" button)
    reeve: (what, done) => cmds.run("reeve", { do: what }, done), // (the keep's "Your reeve has learned": js/sim/reeve-learn.js)
    run: (op, a, done) => cmds.run(op, a, done), // (pull down, rebuild in stone: js/ui/demolish-ui.js)
    canRecruit: REALM ? (arm, mount) => (mount ? mirror.recruit?.[`${arm}:${mount}`] : mirror.recruit?.[arm]) ?? 0 : null,
  };
  // a building's panel (the keep's with its towns); refreshBuilding: the open one again from the sim's (the realm: the
  // server's) state — what it makes, its crew, the people — unless the pointer is on it
  function openBuilding(bb) { showBuildingPanel(bpanel, w, bb, PLAYER, toast, panelActs); if (bb.team === PLAYER && bb.kind === "town_hall" && townsUI) townsUI.decorateKeep(bpanel, bb, townSums().find((s) => s.hall === bb.id || (bb.town && s.id === bb.town))); }
  function refreshBuilding() { const id = bpanel.hidden ? null : bpanel.querySelector("[data-bpanel]")?.dataset.bpanel; if (id == null) return; const bb = w.buildings.find((x) => x.id === +id); if (!bb || (bpanel.matches(":hover") && bpanel.dataset.sig === panelSig(w, bb, PLAYER))) return; openBuilding(bb); } // (under the pointer: only when what it shows has changed)
  resBar.addEventListener("click", (e) => { if (!e.target.closest("[data-people]")) return; const T = w.teams[PLAYER], hall = w.buildings.find((b) => b.id === T.hall) || w.buildings.find((b) => b.team === PLAYER && b.kind === "town_hall"); if (hall) openBuilding(hall); }); // (the people count: where they come from, at the keep)
  const selbox = $("#selbox"), pop = $("#orderpop"); let drag = null, closePop = null, lordUI = null;
  let boxN = 0;
  const pendingSel = new Map(); // (unit id → time until which a just-split body is kept selected while the realm mirror catches up)
  // ---- right-drag with troops selected: where they stand (press) and which way they face (drag); the drag's length is
  // the frontage of their line. Release opens the order popup with that facing set.
  let rdrag = null;
  const faceArrow = document.createElementNS("http://www.w3.org/2000/svg", "svg"); faceArrow.id = "facearrow"; faceArrow.setAttribute("hidden", "");
  faceArrow.innerHTML = '<defs><marker id="fah" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker></defs><line marker-end="url(#fah)"/><line class="front"/><text></text>';
  document.body.append(faceArrow); // (an <svg> has no .hidden property: the attribute, or the arrow stayed on screen after every right-drag)
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 2 || !selected.size || lordUI?.captures()) return;
    const g0 = groundAt(e.clientX, e.clientY); if (!g0) return;
    rdrag = { x0: e.clientX, y0: e.clientY, g0, moved: false };
  });
  addEventListener("pointermove", (e) => {
    if (!rdrag) return;
    const dx = e.clientX - rdrag.x0, dy = e.clientY - rdrag.y0;
    if (!rdrag.moved && Math.hypot(dx, dy) < 12) return;
    rdrag.moved = true;
    const g1 = groundAt(e.clientX, e.clientY); if (!g1) return;
    rdrag.g1 = g1;
    const L = Math.hypot(g1.x - rdrag.g0.x, g1.y - rdrag.g0.y), front = Math.max(10, L * 1.6); rdrag.front = front;
    // screen arrow, and the frontage drawn across its foot
    const ux = dx / (Math.hypot(dx, dy) || 1), uy = dy / (Math.hypot(dx, dy) || 1), half = Math.min(260, Math.hypot(dx, dy) * 0.8);
    const [a, f, tx] = faceArrow.querySelectorAll("line, text");
    a.setAttribute("x1", rdrag.x0); a.setAttribute("y1", rdrag.y0); a.setAttribute("x2", e.clientX); a.setAttribute("y2", e.clientY);
    f.setAttribute("x1", rdrag.x0 - uy * half); f.setAttribute("y1", rdrag.y0 + ux * half); f.setAttribute("x2", rdrag.x0 + uy * half); f.setAttribute("y2", rdrag.y0 - ux * half);
    tx.setAttribute("x", e.clientX + 12); tx.setAttribute("y", e.clientY - 10); tx.textContent = `face this way · front ${Math.round(front)} m`;
    faceArrow.removeAttribute("hidden");
  });
  addEventListener("pointerup", (e) => {
    if (e.button !== 2) return;
    const r = rdrag; rdrag = null; faceArrow.setAttribute("hidden", "");
    if (!r || !r.moved || !r.g1) { // a plain right-click: on one of our companies (its label or its men) → its Tasks; elsewhere: deselect, as before
      if (e.target === canvas && !lordUI?.captures()) { const g = ownGroupAt(e.clientX, e.clientY); if (g) openTasks(g, e.clientX, e.clientY); else deselect(); }
      return;
    }
    const facing = Math.atan2(r.g1.y - r.g0.y, r.g1.x - r.g0.x);
    openOrdersAt(e.clientX, e.clientY, r.g0, { facing, frontage: r.front });
  });
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || lordUI?.captures()) return; // (the lord's view and his placement take the mouse: js/ui/avatar-ui.js)
    drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
  });
  const hint = document.createElement("div"); hint.id = "landhint"; hint.hidden = true; document.body.append(hint);
  // what a click will do, under the pointer ("⚔ Attack · Spearmen ×40", "Orders · the north-east curtain · ladders possible"): the
  // same pick the click itself uses (js/ui/click-target.js) — an enemy only when the pointer is ON his label or his men
  const clickUI = makeClickUI({ w, map, scene, canvas, camera, PLAYER, selected, groups: () => groupsCache, visible: visibleFig, delegated: (id) => cmd.delegatedBattle(id),
    busy: () => !!(placing || bridgeUI.active() || spellAim || settling?.active || lordUI?.captures() || rdrag || drag || !pop.hidden || document.body.classList.contains("sgpick")) });
  let hintT = 0;
  addEventListener("pointermove", (e) => {
    if (spellAim && performance.now() - hintT > 60) {
      hintT = performance.now(); const gp = groundAt(e.clientX, e.clientY);
      if (gp) { const Sp = SPELLS[spellAim]; spellfx.aim(gp.x, gp.y, Sp.radius || 150); hint.textContent = `${SPELL_INFO[spellAim]?.name || spellAim} · ${Sp.mana} mana · ${Sp.desc}`; hint.style.left = e.clientX + 16 + "px"; hint.style.top = e.clientY + 16 + "px"; hint.hidden = false; }
      return;
    }
    if (!placing) hint.hidden = true; // (placing: the ghost and its reason are js/ui/siting-ui.js's)
  });
  addEventListener("pointermove", (e) => {
    if (!drag) return; drag.x1 = e.clientX; drag.y1 = e.clientY;
    const l = Math.min(drag.x0, drag.x1), t = Math.min(drag.y0, drag.y1);
    Object.assign(selbox.style, { left: l + "px", top: t + "px", width: Math.abs(drag.x1 - drag.x0) + "px", height: Math.abs(drag.y1 - drag.y0) + "px" });
    selbox.hidden = Math.abs(drag.x1 - drag.x0) + Math.abs(drag.y1 - drag.y0) < 6;
  });
  addEventListener("pointerup", (e) => {
    if (!drag || e.button !== 0 || lordUI?.captures()) { drag = null; selbox.hidden = true; return; } const d = drag; drag = null; selbox.hidden = true;
    if (closePop) { closePop(); closePop = null; markers.clearPending(); }
    const isBox = Math.abs(d.x1 - d.x0) + Math.abs(d.y1 - d.y0) >= 6;
    if (isBox) { d.alt = e.altKey; return boxSelect(d, e.shiftKey); }
    clickAt(e, false);
  });
  camera.onAltClick = (e) => { // (Alt/Option-click: orders HERE, even over the enemy — an Alt-drag still orbits the camera)
    if (e.target !== canvas || lordUI?.captures() || !selected.size || placing || bridgeUI.active() || spellAim) return;
    if (closePop) { closePop(); closePop = null; markers.clearPending(); }
    clickAt(e, true);
  };
  function clickAt(e, alt) {
    if (spellAim) { const pt = groundAt(e.clientX, e.clientY); if (pt) castAt(pt); return; }
    if (bridgeUI.active()) { const pt = groundAt(e.clientX, e.clientY); if (pt) { markers.ping(pt.x, pt.y); bridgeUI.place(pt.x, pt.y); } return; }
    if (placing) { const pt = groundAt(e.clientX, e.clientY); if (pt) placeAt(pt); return; }
    const T = selected.size ? clickUI.pick(e.clientX, e.clientY, alt) : null; // (with a selection: the same answer the hover tag gave)
    let g = T ? (T.type === "enemy" || T.type === "own" ? T.g : null) : groupNear(e.clientX, e.clientY);
    if (g && T?.type === "own") g._label = true;
    if (T?.type === "none") return; // (the sky, off the map: nothing, as the tag said)
    // a serf clicked — his body, not a crew's label — with nothing selected (or shift): just that man, detached as his own
    // little crew and selected. (The household is one body of every villager at home: its label still takes the whole crew.)
    if (!selected.size || e.shiftKey) {
      const lab = groupNear(e.clientX, e.clientY);
      if (!(lab && lab._label)) {
        let best = -1, bd = 20; const S = w.S;
        for (const u of w.units.values()) { if (u.team !== PLAYER || !u.isWorkers) continue; for (const i of u.members) { if (!S.alive[i]) continue; const p = toScreen(S.x[i], S.y[i]); if (!p.front) continue; const d = Math.hypot(p.x - e.clientX, p.y - e.clientY); if (d < bd) { bd = d; best = i; } } }
        if (best >= 0) {
          const join = e.shiftKey && selected.size ? [...selected] : null; if (!join) selected.clear();
          const box = ++boxN;
          cmds.run("split", { parts: [{ unit: S.unit[best], ids: [best] }], join }, (r) => {
            if (box !== boxN || !r?.ok) return;
            if (!join) selected.clear();
            const until = performance.now() + 4000; for (const id of r.ids || []) { selected.add(id); pendingSel.set(id, until); }
            refreshSel();
          });
          return;
        }
      }
    }
    { // the dragons (js/sim/dragons.js): attack a wild one, claim a yielded one, call or recall your own
      const gp = groundAt(e.clientX, e.clientY);
      const DGc = gp ? dragonAt(w, gp.x, gp.y, 14) : null;
      if (DGc && DGc.mode !== "dead" && (w.dragonSeen?.has(DGc.id) || DGc.owner === PLAYER)) {
        if (DGc.owner === PLAYER) {
          if (DGc.summoned) cmds.run("dragon", { do: "recall", id: DGc.id }, said);
          else if (DGc.stage >= 3) { clickUI.confirm(gp.x, gp.y, "Summoned", "", 4); cmds.run("dragon", { do: "summon", id: DGc.id }, said); }
          else toast(`${DGc.name} is ${DG_STAGE[DGc.stage] || "yours"} — feed it meat; it will not answer a call until it is bonded`);
          return;
        }
        if (DGc.mode === "yield" && DGc.brokeBy === PLAYER) { clickUI.confirm(gp.x, gp.y, "Claim the dragon", "", 4); cmds.run("dragon", { do: "claim", id: DGc.id }, said); return; }
        const dus = [...selected].map((id) => w.units.get(id)).filter((u) => u && !u.isWorkers && !ARMS[u.arm].engine);
        if (dus.length) { clickUI.confirm(gp.x, gp.y, "At the dragon!", "atk", 4); cmds.run("dragon", { do: "attack", id: DGc.id, ids: dus.map((u) => u.id) }, said); return; }
        if (selected.size) { toast("Villagers and engines won't go against a dragon"); return; }
      }
    }
    if (!selected.size) { // clicking a building opens its panel (unless you clicked right on a group's label)
      ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      let bid = blds.pick(ndc, camera.cam); let bb = bid && w.buildings.find((x) => x.id === bid);
      if (!bb) { // fallback: the ground point falls inside a building's footprint
        const gp0 = groundAt(e.clientX, e.clientY);
        if (gp0) bb = w.buildings.find((b) => !b.field && b.x1 === undefined && (() => { const fp = EC.BUILDINGS[b.kind]?.footprint || [10, 8], c = Math.cos(-(b.rot || 0)), s2 = Math.sin(-(b.rot || 0)), dx = gp0.x - b.x, dy = gp0.y - b.y; return Math.abs(dx * c - dy * s2) < fp[0] / 2 + 2 && Math.abs(dx * s2 + dy * c) < fp[1] / 2 + 2; })());
      }
      if (bb && (!g || !g._label)) { openBuilding(bb); return; }
    }
    if (!g && !selected.size) {
      const gp = groundAt(e.clientX, e.clientY); // plain ground: what it gives, what building here would do
      if (gp) { showLandPanel(bpanel, w, gp.x, gp.y); return; }
    }
    if (g && g.team !== PLAYER && selected.size) { // clicked the enemy himself: go for THEM, wherever they go — in what order, at what pace?
      const us = [...selected].map((id) => w.units.get(id)).filter((u) => u && !u.isWorkers);
      if (!us.length) { toast("Villagers won't attack soldiers"); return; }
      if (closePop) closePop();
      if (us.every((u) => ARMS[u.arm].engine)) { markers.ping(g.x, g.y); clickUI.confirm(g.x, g.y, "Bombard", "atk", 3 + (g.h || 0)); cmds.run("target", { ids: us.map((u) => u.id), x: g.x, y: g.y, enemy: true }, said); return; } // (engines: no menu — they take the target)
      if (us.every((u) => ARMS[u.arm].missile)) { attackGroup(g, {}); return; } // (bows alone: nothing to choose — they shoot at them)
      const sx = e.clientX, sy = e.clientY, shift = e.shiftKey;
      closePop = openAttackPopup(pop, { x: sx, y: sy }, attackInfo(g, us), (o) => { closePop = null; attackGroup(g, o); }, () => { closePop = null; },
        { onOrdersHere: () => { const pt = groundAt(sx, sy); if (pt) openOrdersAt(sx, sy, pt, { append: shift }); } }); // ("Orders at this spot instead…")
      return;
    }
    if (g && g.team === PLAYER && (!selected.size || g._label)) { // with a selection, only a label click picks another group; the ground takes orders
      if (!e.shiftKey) selected.clear();
      for (const u of g.allUnits) selected.add(u.id);
      refreshSel(); return;
    }
    if (selected.size) {
      const led = [...selected].map((id) => cmd.delegatedBattle(id)).find(Boolean);
      if (led) { toast(`${cmd.nm(led.cmd.leader)} is commanding them ${led.phrase} — take command first`); return; }
      const pt = groundAt(e.clientX, e.clientY); if (!pt) return;
      const selU = [...selected].map((id) => w.units.get(id)).filter((u) => u && u.members.length);
      if (selU.length && selU.every((u) => ARMS[u.arm].engine)) { markers.ping(pt.x, pt.y); clickUI.confirm(pt.x, pt.y, "Bombard", "atk"); cmds.run("target", { ids: selU.map((u) => u.id), x: pt.x, y: pt.y }, said); return; } // (engines: the click is their mark)
      openOrdersAt(e.clientX, e.clientY, pt, { append: e.shiftKey });
    }
  }
  // the order popup for the selection at ground point pt (a click, or a right-drag that also set the facing and frontage)
  function openOrdersAt(sx, sy, pt, { append = false, facing = undefined, frontage = undefined } = {}) {
    if (closePop) { closePop(); closePop = null; }
    markers.pending(pt.x, pt.y);
    const selUnits = [...selected].map((id) => w.units.get(id)).filter(Boolean), place = castlePick(w, camera.cam, pt.sx ?? sx, pt.sy ?? sy), castleOpts = castleOrders(w, selUnits, place), siegeOpts = siege?.popupOrders ? siege.popupOrders(selUnits, pt, []) : [], side = siege ? (siege.att === PLAYER ? "attack" : "defend") : null, ctx = orderContext(w, selUnits, pt, side);
    const missileSel = selUnits.some((u) => ARMS[u.arm]?.missile);
    closePop = openOrderPopup(pop, w, { x: sx, y: sy }, pt, (order) => {
      closePop = null; markers.clearPending();
      const word = order.word; delete order.word; // (the button's name: the confirmation at the spot)
      if (facing !== undefined) { order.facing = facing; order.frontage = frontage; }
      if (order.kind === "escalade" && place && (place.kind === "walk" || place.kind === "tower")) { order.x = place.x; order.y = place.y; } // ("Scale the wall here": at the stretch the click was on)
      clickUI.confirm(order.kind?.startsWith("cs-") ? (lastPlace() || place)?.x ?? order.x : order.x, order.kind?.startsWith("cs-") ? (lastPlace() || place)?.y ?? order.y : order.y, word, order.kind === "attack" ? "atk" : "", 2 + (order.kind?.startsWith("cs-") || order.kind === "escalade" ? place?.h || 0 : 0));
      const ids = selUnits.map((u) => u.id);
      if (order.kind?.startsWith("dragon-")) { // the house's dragon (js/sim/dragons.js): summon / fly / fire at the spot
        markers.ping(order.x, order.y);
        cmds.run("dragon", { do: order.kind.slice(7), x: order.x, y: order.y }, said);
        return;
      }
      if (order.kind?.startsWith("cs-")) { // (up onto a tower, the wall-walk, the gatehouse, the keep: js/ui/castle-orders.js)
        const P = lastPlace() || place; markers.ping(P?.x ?? pt.x, P?.y ?? pt.y);
        if (!P) { toast("No one who can go up there"); return; }
        cmds.run("castle", { ids, kind: order.kind, x: P.x, y: P.y, castle: P.castle?.id, part: P.part ? P.castle.parts.indexOf(P.part) : undefined, pace: order.pace, facing: order.facing }, said);
        return;
      }
      if (order.kind === "prospect") { markers.ping(order.x, order.y); cmds.run("task", { ids, kind: "prospect", x: order.x, y: order.y }, (r) => { said(r); refreshSel(); }); return; } // ("Prospect here": the villagers search that ground — js/sim/prospect.js)
      if (order.kind === "staff" && ctx.workshop) { markers.ping(ctx.workshop.x, ctx.workshop.y); cmds.run("staff", { bid: ctx.workshop.id, ids }, (r) => { said(r); refreshBuilding(); if (cmds.remote && selected.size) refreshSel(); }); return; } // ("Work here": the villagers become the workshop's crew)
      if (siege?.popupChoose?.(order, selUnits)) { markers.ping(pt.x, pt.y); return; } // (the siege's own orders: man the walls, hold the breach, to the keep, storm)
      markers.ping(pt.x, pt.y); // (at once: the order is on its way — in the realm, to the server)
      if (cmds.remote && !order.append) for (const u of selUnits) if (order.kind !== "volley" && order.kind !== "loose" && order.kind !== "holdfire") { u._srvOrder = u.order?.pending ? u._srvOrder : u.order; u.order = { kind: order.kind === "attack" ? "assault" : order.kind === "work" ? "gather" : order.kind, x: order.x, y: order.y, pending: performance.now() }; } // (shown until the server's state says otherwise: js/realm/client.js)
      cmds.run("order", { ids, order, append: !!order.append, side }, said);
      if (cmds.remote && selected.size) refreshSel();
    }, () => { closePop = null; markers.clearPending(); }, { append, hasChain: cmds.hasChain([...selected]), siege: siegeOpts, missile: missileSel, ctx, facing, frontage, castle: castleOpts, castleTitle: place?.label });
  }
  // ---- broad tasks (js/sim/broad.js, js/ui/task-menu.js): right-click a company — or J for the selection — for a job with
  // no spot picked ("Gather wood", "Hunt", "Patrol the town"); the server's answer in the realm (its mirror has no fields)
  function ownGroupAt(sx, sy) {
    let best = null, bd = Infinity;
    for (const g of groupsCache) { // its label
      const L = g._lab; if (g.team !== PLAYER || !L || !g._shown) continue;
      const dx = Math.abs(sx - L[0]), dy = Math.abs(sy - L[1]); if (dx <= L[2] + 3 && dy <= L[3] + 3 && dx + dy < bd) { bd = dx + dy; best = g; }
    }
    if (best) return best;
    bd = 11; const S = w.S;
    for (const g of groupsCache) { // one of its men (within about a body on the screen)
      if (g.team !== PLAYER || !g._shown) continue;
      for (const u of g.allUnits) for (const i of u.members) { if (!S.alive[i]) continue; const p = toScreen(S.x[i], S.y[i], 1.1 + (g.h || 0)); if (!p.front) continue; const d = Math.hypot(p.x - sx, p.y - sy); if (d < bd) { bd = d; best = g; } }
    }
    return best;
  }
  function openTasks(g, sx, sy) {
    if (g && !g.allUnits.some((u) => selected.has(u.id))) { selected.clear(); for (const u of g.allUnits) selected.add(u.id); refreshSel(); }
    const us = [...selected].map((id) => w.units.get(id)).filter((u) => u && u.members.length && u.team === PLAYER);
    if (!us.length) { toast("Select a company first, or right-click one"); return; }
    const led = us.map((u) => cmd.delegatedBattle(u.id)).find(Boolean);
    if (led) { toast(`${cmd.nm(led.cmd.leader)} is commanding them ${led.phrase} — take command first`); return; }
    if (closePop) { closePop(); closePop = null; markers.clearPending(); }
    const ids = us.map((u) => u.id), men = us.reduce((n, u) => n + u.members.length, 0), cur = us.every((u) => u.broad?.kind === us[0].broad?.kind) ? us[0].broad?.kind ?? null : null;
    const names = [...new Set(us.map((u) => ARMS[u.arm]?.name || u.arm))].join(" & ");
    const at = g || groupsCache.find((q) => q.allUnits?.some((u) => selected.has(u.id)));
    cmds.run("tasks", { ids }, (r) => {
      if (!r?.ok) { said(r); return; }
      const crew = us.every((u) => u.isWorkers) ? us[0] : null; // villagers: one of them may go as a courier (js/sim/couriers.js)
      const tasks = crew && !BATTLE && !SIEGE ? [...(r.tasks || []), { id: "courier", name: "Send as courier…", hint: `${men > 1 ? "One of them carries" : "He carries"} a letter to another house's keep, and comes home`, ok: true }] : r.tasks || [];
      if (!tasks.length) { toast(us.every((u) => ARMS[u.arm]?.engine) ? "Engines take a mark, not a task: click where they should shoot" : "No tasks for them"); return; }
      closePop = openTaskMenu(pop, { x: sx, y: sy }, { title: `Tasks · ${names} ×${men}`, tasks, current: cur }, (kind) => {
        closePop = null;
        if (kind === "courier") { sendCourier(crew, men, sx, sy); return; }
        const t = r.tasks.find((q) => q.id === kind);
        if (at) clickUI.confirm(at.x, at.y, t?.name || kind, "", 4 + (at.h || 0));
        cmds.run("task", { ids, kind }, (res) => { said(res); refreshSel(); });
      }, () => { closePop = null; });
    });
  }
  // "Send as courier…": which house, what the letter says; then one villager walks it there (js/sim/couriers.js)
  function courierHouses() {
    if (REALM) {
      const ai = new Set((realm.hello.holds || []).filter((h) => h.ai).map((h) => h.id)), on = new Set((mirror?.players || realm.hello.players || []).filter((p) => p.online).map((p) => p.team));
      return (realm.hello.teams || []).filter((t) => t.id !== myTeam && !t.fallen && (t.founded || ai.has(t.id))).map((t) => ({ id: t.id, name: /^house\b/i.test(t.name) ? t.name : `House ${t.name}`, note: ai.has(t.id) ? "a lord of the realm" : on.has(t.id) ? "at home" : "away — it waits for them" }));
    }
    return w.teams.filter((T) => T.id !== PLAYER && !T.fallen && T.town).map((T) => ({ id: T.id, name: `The lord of ${places.townName(T.id)}`, note: "" }));
  }
  function sendCourier(u, men, sx, sy) {
    if (closePop) { closePop(); closePop = null; }
    closePop = openCourierDialog(pop, { x: sx, y: sy }, { houses: courierHouses(), men }, ({ to, text }) => {
      closePop = null;
      const names = REALM ? {} : { toName: `the lord of ${places.townName(to)}`, fromName: `the lord of ${places.townName(PLAYER)}` }; // (single player: its houses go by their towns)
      cmds.run("courier", { ids: [u.id], to, text, ...names }, (r) => { said(r); refreshSel(); });
    }, () => { closePop = null; });
  }
  addEventListener("keydown", (e) => { // J: the selection's Tasks
    if ((e.key !== "j" && e.key !== "J") || e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.target.closest?.("input,textarea,select") || lordUI?.captures?.()) return;
    if (!selected.size) { toast("Select a company first: then J (or right-click it) for its Tasks"); return; }
    const g = groupsCache.find((q) => q.allUnits?.some((u) => selected.has(u.id)) && q._lab && q._shown);
    openTasks(null, g ? g._lab[0] : innerWidth / 2, g ? g._lab[1] + 10 : innerHeight / 2);
  });
  // a command's answer: its message (or why it could not be done) as a toast
  function said(r) { if (!r) return; if (!r.ok) { if (r.error) toast(r.error); return; } if (r.msg) toast(r.msg); }
  canvas.addEventListener("contextmenu", (e) => e.preventDefault()); // (a plain right-click deselects on RELEASE — pointerup below: on a Mac the menu event fires on the press, before a facing drag can start)
  addEventListener("keydown", (e) => { if (!e.metaKey && !e.target.closest?.("input,textarea")) e.preventDefault(); });
  addEventListener("keydown", (e) => { if ((e.key === "x" || e.key === "X") && !e.target.closest?.("input,textarea")) deselect(); }); // not Esc: on a Mac it leaves full screen
  function placeAt(pt) { markers.ping(pt.x, pt.y); siteUI.place(pt.x, pt.y); } // (refused: the reason is toasted and placing goes on — js/ui/siting-ui.js)
  function deselect() { fieldDraw.cancel(); settling?.cancel(); bridgeUI.cancel(); siteUI.cancel(); spellAim = null; spellfx.aim(null); placing = null; markers.setPlan(null); markers.setGhost(null); hint.hidden = true; selected.clear(); refreshSel(); if (closePop) { closePop(); closePop = null; } markers.clearPending(); }
  $("#selbar").addEventListener("click", (e) => {
    if (e.target.closest("[data-desel]")) deselect();
    if (e.target.closest("[data-take]")) { cmd.takeCommand([...selected]); refreshSel(); }
    if (e.target.closest("[data-standdown]")) {
      const ids = [...selected].filter((id) => EC.canDisband(w.units.get(id))), n = ids.reduce((s, id) => s + (w.units.get(id)?.members.length || 0), 0);
      if (ids.length && confirm(`Stand down ${n} men? They go home as villagers, their kit back in the store.`)) cmds.run("disband", { ids }, (r) => { said(r); if (r?.ok) deselect(); });
    }
  });
  function dropChains(ids) { cmds.run("drop", { ids }); } // a captain's orders replace ours
  const selectedMen = () => [...selected].reduce((s, id) => s + (w.units.get(id)?.members.length || 0), 0);
  // ---- attack a unit: foot and horse close with the named body and chase it; missile troops keep it in
  // their sights at a good shooting distance and follow it as it moves (js/game/commands.js)
  // what the attack popup tells you about the body you clicked, and what your men make of it
  function attackInfo(g, us) {
    const names = [...g.counts].map(([a, c]) => `${ARM_BY_ID[a % 100]?.name}${a >= 100 ? ` on ${((a / 100) | 0) === 3 ? "striders" : "drakes"}` : ""} ×${c}`).join(", ");
    const tu = g.units[0], cx = us.reduce((s, u) => s + u.ax, 0) / us.length, cy = us.reduce((s, u) => s + u.ay, 0) / us.length;
    const mounted = us.some((u) => ARMS[u.arm].mounted), missile = us.some((u) => ARMS[u.arm].missile), melee = us.some((u) => !ARMS[u.arm].missile);
    const theirs = g.units.map((u) => ARMS[u.arm]), pikes = theirs.some((A) => A.reach >= 4), spears = theirs.some((A) => A.pointsRanks >= 2);
    const lines = [`${g.state}${tu.disordered ? ", out of their ranks" : ""} · ${FORMATIONS[tu.formation]?.name || tu.formation} · ${Math.round(Math.hypot(g.x - cx, g.y - cy))} m away`];
    if (mounted && (pikes || tu.formation === "schiltron") && !tu.disordered && g.state !== "routing") lines.push("⚠ A hedge of pikes: horses will refuse it. Take them in the flank or rear, or shoot them first.");
    else if (mounted && spears && !tu.disordered && g.state === "formed") lines.push("Steady spears: many horses will refuse. Better when they are shaken or scattered.");
    else if (mounted && (theirs.some((A) => A.missile) || tu.disordered || g.state !== "formed")) lines.push("Loose, shaken or bowmen: a charge will ride them down.");
    if (mounted) lines.push("A wedge (★) drives deep; a line hits the most men.");
    if (!mounted && theirs.some((A) => A.mounted)) lines.push("Foot won't catch horse in the open; they will stand if the riders draw off.");
    const fms = ["line", "deep", "loose"]; if (mounted || us.some((u) => ["menatarms", "knights"].includes(u.arm))) fms.push("wedge"); if (us.some((u) => ["spearmen", "pikemen", "levy", "militia"].includes(u.arm))) fms.push("schiltron");
    return { title: `Attack the enemy ${names}`, lines, mounted, missile, melee, formations: fms };
  }
  function attackGroup(g, how = {}) {
    const us = [...selected].map((id) => w.units.get(id)).filter((u) => u && !u.isWorkers);
    if (!us.length) { toast("Villagers won't attack soldiers"); return; }
    markers.ping(g.x, g.y); clickUI.confirm(g.x, g.y, us.every((u) => ARMS[u.arm].missile) ? "Shoot" : "Attack", "atk", 3 + (g.h || 0));
    cmds.run("attack", { ids: us.map((u) => u.id), targets: g.units.map((u) => u.id), how }, said);
  }
  // the selected group's order chain (its waypoints, for the markers and the step numbers)
  const selectionChainPoints = () => (selected.size ? cmds.chainPoints([...selected]) : null);
  // the demos' shorthand: the whole selection, an order (a plain step or a chain step) → the step number
  const orderGroup = (order, append = false) => cmds.run("order", { ids: [...selected], order, append })?.n || 0;

  function boxSelect(d, add) {
    const l = Math.min(d.x0, d.x1), r = Math.max(d.x0, d.x1), t = Math.min(d.y0, d.y1), b = Math.max(d.y0, d.y1);
    const byUnit = new Map(); const S = w.S;
    for (let i = 0; i < S.n; i++) {
      if (!S.alive[i] || S.team[i] !== PLAYER) continue;
      if (lordUI?.active && w.units.get(S.unit[i])?.household) continue; // (his household rides with you, under your keys)
      const p = toScreen(S.x[i], S.y[i]); if (!p.front) continue;
      if (p.x >= l && p.x <= r && p.y >= t && p.y <= b) { let a = byUnit.get(S.unit[i]); if (!a) byUnit.set(S.unit[i], (a = [])); a.push(i); }
    }
    if (!byUnit.size) return; // empty box keeps the current selection
    // like any RTS: if the box holds soldiers, the villagers caught in it stay at their work
    const hasSoldiers = [...byUnit.keys()].some((uid) => !w.units.get(uid)?.isWorkers);
    if (hasSoldiers && !d.alt) for (const uid of [...byUnit.keys()]) if (w.units.get(uid)?.isWorkers) byUnit.delete(uid);
    // the box selects ONLY the men inside it: they become one command group (js/game/commands.js split; a company boxed
    // whole stays whole). If adding (shift), they join the existing selection's group. In the realm the split is the
    // server's: the boxed companies are selected at once, and the new bodies replace them when the answer comes — kept
    // selected while the mirror catches up (pendingSel), so the selection never falls apart in between
    const join = add && selected.size ? [...selected] : null;
    if (!add) selected.clear();
    const parts = [...byUnit].map(([unit, ids]) => ({ unit, ids }));
    if (cmds.remote) { for (const uid of byUnit.keys()) selected.add(uid); refreshSel(); }
    const box = ++boxN;
    cmds.run("split", { parts, join, alt: !!d.alt }, (r) => {
      if (box !== boxN || !r?.ok) return; // (another box since: that one wins)
      if (!add) selected.clear(); else for (const uid of byUnit.keys()) if (!join.includes(uid)) selected.delete(uid);
      const until = performance.now() + 4000; for (const id of r.ids || []) { selected.add(id); pendingSel.set(id, until); }
      refreshSel();
    });
  }
  function groupNear(cx, cy) {
    let best = null, bd = 26;
    for (const g of groupsCache) {
      const p = toScreen(g.x, g.y, 4 + (g.h || 0)); const onLabel = Math.abs(p.x - cx) < 34 && Math.abs(p.y - 20 - cy) < 13; // the label box above the men
      const pm = toScreen(g.x, g.y, 1.5 + (g.h || 0)); let dd = Math.min(Math.hypot(p.x - cx, p.y + 18 - cy), Math.hypot(pm.x - cx, pm.y - cy));
      if (onLabel) dd = Math.min(dd, 1);
      if (dd < bd) { bd = dd; best = g; best._label = onLabel; }
    }
    if (best) best._d = bd;
    return best;
  }

  // ---------------------------------------------------------------- the lord in the field (js/sim/avatar.js, js/ui/avatar-ui.js)
  const capUI = makeCaptainCards({ w, PLAYER, toScreen, focus: (x, y) => camera.focus(x, y), run: (op, a, done) => cmds.run(op, a, done), toast: (m) => toast(m),
    remoteProps: REALM ? () => mirror.capProps : null, remoteGlobal: REALM ? () => mirror.capGlobal : null }); // (the captains' cards; in the realm the server's countdown)
  $("#selinfo").addEventListener("click", (e) => capUI.onSelClick(e, [...selected], () => refreshSel()));
  lordUI = makeAvatarUI({ w, camera, canvas, scene, map, PLAYER, groundAt, toScreen, toast, log: logEv, bannerCanvas: drawBanner(mine, 128, 96), onOrders: (ids) => dropChains(ids), params, selected, refreshSel });
  // quick commands (control groups, whole army, form up, follow me, rally, find the lord), the controls hint, tips, courier lines
  const cmdKeys = makeCommandKeys({ w, PLAYER, selected, refreshSel, camera, toast, dropChains, toScreen, lordUI, params, formUp: (ids, done) => cmds.run("formup", { ids }, done) });

  // ---------------------------------------------------------------- HUD
  const selinfo = $("#selinfo"), selbar = $("#selbar");
  function refreshSel() {
    const us = [...selected].map((id) => w.units.get(id)).filter(Boolean);
    const now = performance.now();
    for (const id of [...selected]) { if (w.units.get(id)) { pendingSel.delete(id); continue; } if ((pendingSel.get(id) || 0) > now) continue; pendingSel.delete(id); selected.delete(id); } // (a body the server just made isn't in the mirror yet: keep it selected a moment)
    if (!us.length && [...selected].some((id) => pendingSel.has(id))) { setTimeout(refreshSel, 150); return; }
    if (!us.length) { selinfo.hidden = true; selbar.hidden = true; return; }
    const S = w.S; let men = 0, fat = 0, skill = 0;
    for (const u of us) for (const id of u.members) { men++; fat += S.fatigue[id]; skill += S.skill[id]; }
    const bar = (v) => `<div class="bar"><i style="width:${Math.round(v * 100)}%"></i></div>`;
    const kinds = us.map((u) => `<span class="kind">${glyphSVG(ARMS[u.arm].glyph)} ${ARMS[u.arm].name}${u.mount ? ` on ${u.mount}s` : ""} ×${u.members.length}</span>`).join("");
    selinfo.innerHTML = `<h3>${men} men selected</h3><div class="kinds">${kinds}</div>
      <div class="row">Morale <b>${Math.round(avg(us.map((u) => u.morale)) * 100)}%</b></div>${bar(avg(us.map((u) => u.morale)))}
      <div class="row">Fatigue <b>${Math.round(fat / men * 100)}%</b></div>${bar(fat / men)}
      ${REALM ? "" : `<div class="row">Average skill <b>${Math.round(skill / men * 100)}</b></div>`}
      <div class="row">Orders <b>${[...new Set(us.map((u) => u.broad ? TASK_WORD[u.broad.kind] || "On a task" : ORDER_WORD[u.order?.kind] || "Holding"))].join(", ")}</b></div>`
      + us.map((u) => engineOf(w, u)).filter(Boolean).slice(0, 3).map((e) => { const I = engineInfo(w, e); return `<div class="engine"><div class="row"><b>${I.name}</b> · ${I.status}${I.fire > 0 ? ` · <span class="warn">burning</span>` : ""}</div>
        <div class="row">Crew <b>${I.crew}/${I.crewNeed}</b>${I.crew < I.crewMin ? ` <span class="warn">(needs ${I.crewMin} to work)</span>` : ""}${I.ammo !== null ? ` · ${I.ammoName} <b>${I.ammo}/${I.ammoMax}</b>` : ""}${I.range ? ` · range ${I.range[0]}–${I.range[1]} m` : ""}</div>
        <div class="row">Timbers</div>${bar(I.hp)}
        ${I.target ? `<div class="row">Target <b>${I.target}</b>${I.hitPct !== null ? ` · ${I.hitPct}% of stones strike` : ""}</div>${I.targetHp !== null ? bar(Math.max(0, I.targetHp)) : ""}` : ""}</div>`; }).join("")
      + capUI.selHTML(us);
    selinfo.hidden = false;
    const led = us.map((u) => cmd.delegatedBattle(u.id)).find(Boolean), sg = led && w.sagas.get(led.cmd.leader);
    const standable = !led && us.some((u) => EC.canDisband(u));
    const k = `${men}|${led?.id}|${standable}`;
    if (selbar._k !== k) {
      selbar._k = k;
      selbar.innerHTML = led ? `<span class="led"><b>${men}</b> men — ${cmd.nm(led.cmd.leader)} commands them ${led.phrase} <i>(${sg ? cmd.dispName(sg) : ""})</i></span><button data-take>Take command</button><button data-desel>Deselect <kbd>X</kbd></button>`
        : `<span><b>${men}</b> men selected — click the ground to give an order · right-click them for tasks <kbd>J</kbd></span>${standable ? `<button data-standdown title="Send them home: they become villagers again (a levy as able men, spearmen as trained spearmen…), their kit back in the store">Stand down</button>` : ""}<button data-desel>Deselect <kbd>X</kbd></button>`;
    }
    selbar.hidden = false;
  }
  function toast(msg) { const d = document.createElement("div"); d.textContent = msg; $("#toast").append(d); setTimeout(() => d.remove(), 3000); }

  // notable events → toasts, the chronicle, the legend window (real time keeps running underneath)
  const legendQueue = []; let legendOpen = false;
  const legendsSeen = new Map(); // soldier → { team, rank } for the end screen
  const at = (x, y) => places.at(x, y).phrase;
  const bldName = (b) => EC.BUILDINGS[b?.kind]?.name || b?.kind || "building";
  const seen = (x, y) => canSee(V, PLAYER, x, y);
  function drainLog() {
    for (const e of w.log.splice(0)) {
      const mine = e.team === PLAYER, b = e.building !== undefined ? w.buildings.find((x) => x.id === e.building) : null;
      const pos = b ? { x: b.x, y: b.y } : {};
      if (e.kind === "legend") {
        legendsSeen.set(e.who, { team: e.team, rank: Math.max(e.rank - 1, legendsSeen.get(e.who)?.rank || 0) });
        const who = nameOf(w.S.name[e.who]), p = { x: w.S.x[e.who], y: w.S.y[e.who] };
        if (mine) { legendQueue.push(e); logEv(`${who} is spoken of: ${e.feats.at(-1)?.text?.replace(/\s*\(.*\)$/, "") || "a deed men will remember"}`, { ...p, tone: "legend" }); }
        else if (seen(p.x, p.y)) logEv(`A man of ${places.townName(1 - PLAYER)} is making a name for himself ${at(p.x, p.y)}`, { ...p, tone: "legend" });
      }
      else if (e.kind === "unit-routing" && !battle && !siege) { // (a pitched battle tells its breaks as moments: js/ui/battle-moments.js)
        const u = w.units.get(e.unit);
        if (u && (mine || seen(u.ax, u.ay))) { toast(`${mine ? "Our" : "Enemy"} ${ARMS[u.arm].name} are routing!`); logEv(`${mine ? "Our" : "The enemy's"} ${ARMS[u.arm].name.toLowerCase()} break and run ${at(u.ax, u.ay)}`, { x: u.ax, y: u.ay, tone: mine ? "bad" : "good" }); }
      }
      else if (e.kind === "captain-say" && mine) { toast(e.text); logEv(e.text, { x: e.x, y: e.y, tone: e.tone }); }
      else if ((e.kind === "prospect-found" || e.kind === "prospect-nothing" || e.kind === "prospect-ended" || e.kind === "veins-out") && mine) { const P = prospectLine(e, at); if (P) { if (P.toast) toast(P.text.split(" — ")[0].split(". ")[0]); logEv(P.text, { x: e.x, y: e.y, tone: P.tone }); } } // (prospecting: js/sim/prospect.js; the realm's chronicle tells the same — js/game/chronicle.js)
      else if (e.kind === "reeve-say" && mine) { toast(e.text); logEv(e.text, { x: e.x, y: e.y, tone: e.tone }); } // (the reeve's food watch: js/sim/ai-general.js)
      else if (e.kind === "courier" && mine) { toast(e.text); logEv(e.text, { x: e.x, y: e.y, tone: e.tone }); } // (a courier's errand: js/sim/couriers.js)
      else if (e.kind === "unit-rallied" && mine && !battle) { const u = w.units.get(e.unit); if (u) logEv(`Our ${ARMS[u.arm].name.toLowerCase()} rally to the colours`, { x: u.ax, y: u.ay }); }
      else if (e.kind === "recruited" && mine) { toast("New troops mustered."); logEv(`${e.count} ${ARMS[e.arm]?.name || e.arm} mustered${b ? " at the " + bldName(b) : ""}`, pos); }
      else if (e.kind === "built" && mine) { toast("Construction complete."); logEv(`${bldName(b || { kind: e.what })} completed`, { ...pos, tone: "good" }); }
      else if (e.kind === "building-lost") {
        if (mine) { toast(`Our ${bldName(b)} is lost!`); logEv(`Our ${bldName(b)} is destroyed${b ? " " + at(b.x, b.y) : ""}`, { ...pos, tone: "bad" }); }
        else if (b && seen(b.x, b.y)) logEv(`${places.townName(e.team)}'s ${bldName(b)} is destroyed`, { ...pos, tone: "good" });
      }
      else if (e.kind === "weather") { // the sky turning over the vale (js/sim/weather.js)
        const msg = { rain: "Rain sets in over the vale", storm: "A storm breaks over the vale", snow: "Snow falls on the vale", fog: "A mist lies on the vale", fair: e.was === "snow" ? "The snow passes; the sky clears" : e.was === "rain" || e.was === "storm" ? "The rain passes; the sky clears" : "The mist burns off",
          mud: "Days of rain: the roads are mud", dried: "The ground has dried; the roads are firm again" }[e.wx];
        if (msg) logEv(msg, { tone: e.wx === "mud" || e.wx === "storm" ? "bad" : undefined });
      }
      else if (e.kind === "fire" && mine && b) { toast(e.dragon !== undefined ? `Dragon-fire takes our ${bldName(b)}!` : `Raiders have fired our ${bldName(b)}!`); logEv(e.dragon !== undefined ? `Dragon-fire takes our ${bldName(b)}` : `Raiders set our ${bldName(b)} alight`, { ...pos, tone: "bad" }); }
      else if (e.kind === "field-fired" && mine && b && e.dragon === undefined) { toast("Raiders are burning our fields!"); logEv(`Raiders fire our fields ${at(b.x, b.y)}`, { ...pos, tone: "bad" }); }
      // the dragons (js/sim/dragons.js): their tales are told to everyone (the same lines the realm chronicle tells)
      else if (e.kind === "dragon-field") { if (mine) toast("A dragon is burning our fields!"); logEv(mine ? `A dragon burns our fields ${at(e.x, e.y)}` : `A dragon burned ${places.townName(e.team)}'s fields`, { x: e.x, y: e.y, tone: mine ? "bad" : undefined }); }
      else if (e.kind === "dragon-flock" && mine) { toast("A dragon is at our flocks!"); logEv("A dragon stoops on our flocks and carries off sheep", { x: e.x, y: e.y, tone: "bad" }); }
      else if (e.kind === "dragon-wakes") logEv(`${e.name ? e.name[0].toUpperCase() + e.name.slice(1) : "A dragon"} is on the wing over the vale`, { x: e.x, y: e.y });
      else if (e.kind === "dragon-fight") { if (mine) toast("You have woken the dragon!"); logEv(mine ? "We have woken the dragon: it fights" : "Men go against a dragon", { x: e.x, y: e.y, tone: mine ? "bad" : undefined }); }
      else if (e.kind === "dragon-yielded") { if (e.by === PLAYER) toast("The dragon YIELDS — claim it, or finish it"); logEv(e.by === PLAYER ? "The dragon yields, cowed, to our men — stand over it and claim it, or finish it" : "The dragon has yielded", { x: e.x, y: e.y, tone: e.by === PLAYER ? "good" : undefined }); }
      else if (e.kind === "dragon-slain") { toast("The dragon is slain — for good"); logEv(`${e.name ? e.name[0].toUpperCase() + e.name.slice(1) : "The dragon"} is slain${e.by === PLAYER ? " by our men" : ""} — for good`, { x: e.x, y: e.y, tone: "legend" }); }
      else if (e.kind === "dragon-claimed") { if (mine) toast("The dragon is yours — feed it meat"); logEv(mine ? "The dragon is bound to our house: feed it meat and its trust will grow" : `The dragon is bound to ${places.townName(e.team)}`, { x: e.x, y: e.y, tone: mine ? "legend" : "bad" }); }
      else if (e.kind === "dragon-stage") { if (e.stage === 3) { if (mine) toast("The dragon is BONDED: summon it to war"); logEv(mine ? "The dragon is BONDED: your word can call it to war" : `${places.townName(e.team)} has bonded a dragon`, { tone: mine ? "legend" : "bad" }); } else if (mine) logEv("The dragon is broken-in: it suffers its keeper", { tone: "good" }); }
      else if (e.kind === "dragon-wild" && e.team >= 0) { if (mine) toast("The dragon has gone wild!"); logEv(mine ? `The dragon ${e.why === "it went unfed" ? "went unfed too long and " : ""}is wild again` : "A kept dragon has gone wild again", { tone: mine ? "bad" : undefined }); }
      else if (e.kind === "dragon-summoned" && mine) { toast("The dragon answers your call"); logEv("The dragon answers your call", { x: e.x, y: e.y, tone: "good" }); }
      else if (e.kind === "dragon-tired" && mine) toast("The dragon is spent: it turns for its lair");
      else if (e.kind === "dragon-fed" || e.kind === "dragon-game" || e.kind === "dragon-raid") { /* the keeper's day, a deer taken, the push signal: not chronicle lines */ }
      // the wild (js/sim/wild.js, js/sim/jobs/hunting.js): small news — the same lines the realm chronicle tells (js/game/chronicle.js)
      else if (e.kind === "hart-seen") { toast("A white hart has been seen in the vale!"); logEv(`A white hart is seen ${at(e.x, e.y)} — few hunters ever take one`, { x: e.x, y: e.y, tone: "legend" }); }
      else if (e.kind === "white-hart-taken") { if (mine) toast("Our hunters have taken the WHITE HART!"); logEv(mine ? "Our hunters have taken the white hart — the hall will tell it for years, and the companies stand a little prouder" : `${places.townName(e.team)}'s hunters have taken the white hart`, { x: e.x, y: e.y, tone: "legend" }); }
      else if (e.kind === "serpent-sighted") logEv(`Something vast breaks the water ${at(e.x, e.y)} — the fishermen say the serpent`, { x: e.x, y: e.y, tone: "magic" });
      else if (e.kind === "wolves-took-sheep" && mine) logEv(`Wolves take a sheep from our flocks ${at(e.x, e.y)}`, { x: e.x, y: e.y, tone: "bad" });
      else if (e.kind === "taken-by-wolves" && mine) { toast("Wolves have taken one of our villagers!"); logEv(`Wolves take a villager working alone ${at(e.x, e.y)}`, { x: e.x, y: e.y, tone: "bad" }); }
      else if (e.kind === "mauled" && mine) { toast(`A ${e.sp === "drake" ? "drake" : "bear"} has mauled one of our men!`); logEv(`A ${e.sp === "drake" ? "drake" : "bear"} mauls one of our men in its den ${at(e.x, e.y)}`, { x: e.x, y: e.y, tone: "bad" }); }
      else if (e.kind === "animal-captured" && mine) toast(`A young ${e.sp} is netted alive — they lead it home to the stables`);
      else if (e.kind === "mount-penned" && mine) logEv(`A young ${e.mount} is penned at the stables`, { tone: "good" });
      else if (e.kind === "young-escaped" && mine) logEv(`A netted young ${e.sp} slips its halter and is gone back to its kind`, { x: e.x, y: e.y });
      else if (e.kind === "capture-failed" && mine) toast("No young left in that herd to take");
      else if (e.kind === "villagers-return" && mine) toast("Villagers finished your order — back to their usual work.");
      else if (e.kind === "task-ended" && mine) { const word = (TASK_WORD[e.task] || "their task").toLowerCase(); toast(`${e.crew ? "Villagers" : "Our men"} stop ${word}: ${e.why}`); logEv(e.crew ? `The villagers stop ${word} — ${e.why}; back to the reeve's work` : `Our men stop ${word} — ${e.why}; they wait for orders`, { x: e.x, y: e.y }); }
      else if ((e.kind === "crossing-started" || e.kind === "route-refused") && mine && !w.units.get(e.unit)?.cap) { const cap = (t) => t ? t[0].toUpperCase() + t.slice(1) : ""; toast(e.kind === "route-refused" ? `They cannot get there: ${e.why}` : cap(e.why || "They make a crossing")); } // (js/sim/crossings.js; a company with a captain has him say it: js/sim/captains.js)
      else if (e.kind === "crossing-done" && mine) logEv(`${e.crossing.kind === "trestle" ? "A bridge is thrown" : "A fill of fascines is made"} ${at(e.crossing.x, e.crossing.y)}`, { x: e.crossing.x, y: e.crossing.y, tone: "good" });
      else if (e.kind === "crossing-burnt" && (mine || e.by === PLAYER)) logEv(mine ? `Our bridge ${at(e.crossing.x, e.crossing.y)} is burnt` : `We burn the enemy's bridge ${at(e.crossing.x, e.crossing.y)}`, { x: e.crossing.x, y: e.crossing.y, tone: mine ? "bad" : "good" });
      else if (e.kind === "convoy-out" && mine) toast(`A supply cart sets out for the army (${e.kg} kg of bread and grain).`);
      else if (e.kind === "convoy-lost" && mine) { const u = w.units.get(e.unit); toast("A supply convoy has been lost!"); logEv(`A supply convoy is lost${u ? " on the road to the army " + at(u.ax, u.ay) : ""}`, u ? { x: u.ax, y: u.ay, tone: "bad" } : { tone: "bad" }); }
      else if (e.kind === "siege-begins" || e.kind === "siege-lifted") {
        const T = w.teams[e.team], name = places.townName(e.team), hp = { x: T.town.x, y: T.town.y };
        if (e.kind === "siege-begins") { toast(mine ? `${name} is besieged!` : `Our army invests ${name}`); logEv(mine ? `${name} is besieged — no gathering outside the walls, no trade` : `Our army invests ${name}`, { ...hp, tone: mine ? "bad" : "good" }); }
        else logEv(mine ? `The siege of ${name} is lifted` : `The siege of ${name} is broken`, { ...hp, tone: mine ? "good" : "bad" });
      }
      else if (e.kind === "town-fell") { const T = w.teams[e.team]; toast(`${places.townName(e.team)} has fallen!`); logEv(`${places.townName(e.team)} has fallen — ${e.why}`, { x: T.town.x, y: T.town.y, tone: "fall" }); }
      else if (e.kind === "spell") {
        const I = SPELL_INFO[e.spell] || { name: e.spell, word: "An adept works" }, R = SPELLS[e.spell]?.radius;
        if (mine || e.spell === "mist" || seen(e.x, e.y)) {
          spellfx.cast(e.spell, e.x, e.y, R);
          logEv(mine ? `${I.word} ${at(e.x, e.y)}` : `${places.townName(e.team)}'s adepts work ${I.name.toLowerCase()} ${at(e.x, e.y)}`, { x: e.x, y: e.y, tone: "magic" });
          if (mine) toast(`${I.name}: ${I.word.toLowerCase()}`);
        }
      }
      else if ((e.kind === "wall-breached" || e.kind === "gate-broken" || e.kind === "gate-opened") && !siege) { // (a siege tells these itself: js/ui/siege-run.js)
        const wh = e.kind === "wall-breached" ? `a breach is made in ${mine ? "our" : places.townName(e.team) + "'s"} ${bldName(b)}` : e.kind === "gate-broken" ? `${mine ? "our" : places.townName(e.team) + "'s"} gate is broken in` : `the enemy inside have unbarred ${mine ? "our" : "the"} gate`;
        if (mine || (b && seen(b.x, b.y))) { toast(wh[0].toUpperCase() + wh.slice(1) + "!"); logEv(wh[0].toUpperCase() + wh.slice(1), { ...(e.x !== undefined ? { x: e.x, y: e.y } : pos), tone: mine ? "bad" : "good" }); }
      }
      else if (e.kind === "engine-destroyed" || e.kind === "engine-captured" || e.kind === "engine-ready" || e.kind === "engine-abandoned") {
        const en = w.siege?.engines.find((q) => q.id === e.engine), nm = ARMS[e.what || en?.kind]?.name.toLowerCase() || "engine", p2 = en ? { x: en.x, y: en.y } : {};
        if (e.kind === "engine-ready" && mine) logEv(`Our ${nm} is framed up and ready`, p2);
        else if (e.kind === "engine-destroyed" && (mine || (en && seen(en.x, en.y)))) { toast(`${mine ? "Our" : "The enemy's"} ${nm} is ${e.how === "burnt" ? "burnt" : "smashed"}!`); logEv(`${mine ? "Our" : "The enemy's"} ${nm} is ${e.how === "burnt" ? "burnt out" : "smashed to kindling"}`, { ...p2, tone: mine ? "bad" : "good" }); }
        else if (e.kind === "engine-captured") { const ours = e.team === PLAYER; toast(ours ? `We have taken the enemy's ${nm}!` : `The enemy has taken our ${nm}!`); logEv(ours ? `We take the enemy's ${nm}` : `The enemy takes our ${nm}`, { ...p2, tone: ours ? "good" : "bad" }); }
        else if (e.kind === "engine-abandoned" && mine) toast(`Our ${nm} has lost its crew`);
      }
      else if (e.kind === "engine-fired" && mine) toast(`Our ${ARMS[e.what]?.name.toLowerCase() || "engine"} is on fire!`);
      else if (e.kind === "engine-out-of-range" && mine) toast(`Out of range (${e.d} m) — move the engine closer or choose another target`);
      else if (e.kind === "engine-fixed" && mine) toast("A framed-up trebuchet cannot be moved");
      else if (e.kind === "escalade-refused" && mine) toast(`No escalade: ${e.why}`);
      else if (e.kind === "escalade-lodged") { const u = w.units.get(e.unit); if (mine || (u && seen(u.ax, u.ay))) logEv(mine ? `Our men are over the wall (${e.over} up the ladders)` : `The enemy are over our wall!`, { ...(u ? { x: u.ax, y: u.ay } : {}), tone: mine ? "good" : "bad" }); if (!mine) toast("The enemy are over the wall!"); }
      else if (e.kind === "escalade-failed" && mine) { toast(`The escalade fails: ${e.why}`); }
      else if (e.kind === "tower-docked") { if (mine) toast("The siege tower is against the wall"); else if (seen(e.x, e.y)) toast("An enemy siege tower is at our wall!"); }
      else if (e.kind === "squire-ready" && mine) logEv("A squire has won his spurs: a knight can be armed at the stables", {});
      else if (e.kind === "research-done" && mine && TECHS[e.tech]) { logEv(`Learned at the keep: ${TECHS[e.tech].name} — ${TECHS[e.tech].effect}`, { tone: "good" }); toast(`Learned: ${TECHS[e.tech].name}`); } // (research: js/sim/tech.js)
      else if (e.kind === "migrants" && mine) logEv(`${e.n} newcomers settle in ${places.townName(PLAYER)}`, { x: w.teams[PLAYER].town.x, y: w.teams[PLAYER].town.y });
      else if (e.kind === "tallage" && mine) logEv("A tallage is levied on the vill", {});
      else if (e.kind === "disbanded" && mine) logEv(`${e.n} ${ARMS[e.arm]?.name || e.arm} stood down and sent home`, {});
    }
    if (!legendOpen && legendQueue.length) {
      legendOpen = true; const e = legendQueue.shift();
      toast(`${nameOf(w.S.name[e.who])} has done something legendary!`);
      showLegend($("#modal"), w, e, (ok) => {
        legendOpen = false;
        if (ok) { const sg = w.sagas.get(e.who); legendsSeen.set(e.who, { team: PLAYER, rank: sg?.rank || e.rank }); logEv(`${nameOf(w.S.name[e.who])} is raised to ${["", "veteran", "champion", "captain"][Math.min(3, sg?.rank || e.rank)]}${sg?.disposition ? ` — a ${DISPOSITIONS[sg.disposition].name} who can lead our battles` : ""}`, { x: w.S.x[e.who], y: w.S.y[e.who], tone: "legend" }); }
      });
    }
  }
  // enemy troops seen near the vill: a raid, or the army coming
  let sightT = -1e9, sightWas = false;
  function watchHome() {
    const H = w.teams[PLAYER].town; let n = 0, sx = 0, sy = 0;
    for (const v of w.units.values()) if (v.team !== PLAYER && !v.isWorkers && v.members.length && Math.hypot(v.ax - H.x, v.ay - H.y) < 1500 && seen(v.ax, v.ay)) { n += v.members.length; sx += v.ax * v.members.length; sy += v.ay * v.members.length; }
    const now = n >= 5;
    if (now && !sightWas && w.tick - sightT > 1200) { sightT = w.tick; const x = sx / n, y = sy / n; toast(`Enemy troops sighted ${at(x, y)}!`); logEv(`Enemy troops sighted ${at(x, y)} — about ${Math.round(n / 5) * 5 || n} men`, { x, y, tone: "bad" }); }
    sightWas = now;
  }

  // ---------------------------------------------------------------- the match: a side loses when its keep is ruined, its town falls, or no one is left to it
  let ended = null; const t0Tick = w.tick;
  function checkMatch() {
    if (ended) return; const out = matchOutcome(w); if (!out) return;
    ended = out; const won = out.winner === PLAYER; cmd.hush();
    logEv(won ? `Victory: ${places.townName(out.loser)} — ${out.why}` : `Defeat: ${places.townName(out.loser)} — ${out.why}`, { x: w.teams[out.loser].town.x, y: w.teams[out.loser].town.y, tone: "fall" });
    setTimeout(() => showEnd($("#modal"), matchReport(out), () => { location.href = location.pathname; }), params.has("shot") ? 0 : 4500);
  }
  function matchReport(out) {
    const S = w.S, dead = [0, 0], standing = [0, 0];
    for (let i = 0; i < S.n; i++) if (!S.alive[i] && S.state[i] !== EC.S_GONE && (S.team[i] === 0 || S.team[i] === 1)) dead[S.team[i]]++;
    for (const b of w.buildings) if (!b.field && !b.ruin && b.progress >= 1 && b.x1 === undefined) standing[b.team]++;
    for (const [id, sg] of w.sagas || []) if (sg.rank > 0) legendsSeen.set(id, { team: S.team[id], rank: sg.rank });
    const legends = [...legendsSeen].map(([id, L]) => { const sg = w.sagas?.get(id); return { id, L, sg }; })
      .sort((a, b) => b.L.rank - a.L.rank || S.kills[b.id] - S.kills[a.id]).slice(0, 10)
      .map(({ id, L, sg }) => ({ name: nameOf(S.name[id]), what: `${places.townName(L.team)} · ${ARM_BY_ID[S.arm[id]].name}${L.rank ? ", " + ["", "veteran", "champion", "captain"][Math.min(3, L.rank)] : ", noticed"}${sg?.disposition ? " (" + DISPOSITIONS[sg.disposition].name + ")" : ""} · ${S.kills[id]} felled${S.alive[id] ? "" : " · did not live to see the end"}` }));
    const won = out.winner === PLAYER;
    return { won, headline: won ? `${places.townName(out.loser)} is broken` : `${places.townName(out.loser)} is lost`, why: `${places.townName(out.loser)}: ${out.why}.`,
      days: Math.max(1, Math.round(w.econ.doy - w.econ.startDoy)), realMin: Math.round((w.tick - t0Tick) * TICK / 60), battles: cmd.battles.length,
      enemyDisp: DISPOSITIONS[setup.disposition]?.name || setup.disposition, diffName: setup.diffName, names: [places.townName(0), places.townName(1)],
      dead, wounded: tally.wounded, routs: tally.routs, recruited: tally.recruited, built: tally.built, lost: tally.lost, standing, spells: tally.spells, legends };
  }

  // group labels (pooled DOM): one per command group, listing each troop type in it
  const labelsEl = $("#labels"); const pool = []; const numPool = []; let groupsCache = [];
  // is this body hidden from the camera behind a castle's masonry (a tower, the keep, the curtain they stand beneath)?
  // castle.js castleRayPick from the camera toward the men's heads; each body re-tested every ~10 frames
  const occCache = new Map(); let occFrame = 0;
  function labelBehindStone(g) {
    const pick = w.castles?.length && w.castleApi?.castleRayPick; if (!pick) return false;
    const key = `${g.gid}|${Math.round(g.x / 3)}|${Math.round(g.y / 3)}|${Math.round(g.h || 0)}`, c = occCache.get(key);
    if (c && occFrame - c.f < 10 + (g.gid & 3)) return c.occ;
    const cp = camera.cam.position, ox = cp.x, oy = -cp.z, oz = cp.y, tz = map.h(g.x, g.y) + (g.h || 0) + ((g.h || 0) > 0.5 ? 2.8 : 1.6); // (men up on a wall or a tower: over the battlements they stand behind, not into their own stone)
    const dx = g.x - ox, dy = g.y - oy, dz = tz - oz, L = Math.hypot(dx, dy, dz) || 1;
    const hit = pick(w, ox, oy, oz, dx / L, dy / L, dz / L), occ = !!hit && hit.t < L - 2.5;
    if (occCache.size > 400) occCache.clear();
    occCache.set(key, { f: occFrame, occ });
    return occ;
  }
  function drawLabels() {
    occFrame++;
    let n = 0;
    groupsCache = computeGroups(w, (w.castles?.length || w.townWalls?.edges.length) && w.castleLevelH ? w.castleLevelH : null); // (g.h: the men's height — a wall-walk, a tower top)
    for (const g of groupsCache) {
      if (g.team !== PLAYER && V.teams[PLAYER][visIdx(V, g.x, g.y)] !== 2) continue;
      const p = toScreen(g.x, g.y, 4 + (g.h || 0)); if (!p.front || p.x < -80 || p.y < -40 || p.x > innerWidth + 80 || p.y > innerHeight + 40) continue;
      let el = pool[n]; if (!el) { el = document.createElement("div"); el.className = "glab"; labelsEl.append(el); pool.push(el); }
      const sel = g.units.some((u) => selected.has(u.id));
      const hunted = g.team !== PLAYER && selected.size && g.units.some((v) => [...selected].some((id) => { const u = w.units.get(id); return u && (u.fireAt === v.id || u.order?.target === v.id); }));
      const parts = [...g.counts].sort((a, b) => b[1] - a[1]);
      const lead = g.team === PLAYER ? cmd.badgeFor(g.units) : null;
      // an order on its way to these men: horn / rider icon with seconds to arrival
      const po = g.team === PLAYER ? g.units.map((u) => u.pendingOrder).find((o) => o && o.eta) : null;
      const eta = po ? Math.max(0, Math.ceil(po.eta - w.time)) : -1;
      // out of their ranks (a charge through them, a brawl): any order — or U, form up — re-forms them
      const scat = g.team === PLAYER && g.state !== "routing" && g.units.some((u) => u.disordered);
      const key = `${g.team}|${parts.map(([a, c]) => a + ":" + c).join(",")}|${sel}|${g.state}|${lead ? lead.name + lead.delegated : ""}|${eta}|${hunted}|${scat}`;
      if (el._k !== key) {
        el._k = key; el.className = "glab" + (sel ? " sel" : "") + (hunted ? " hunted" : ""); el._hov = false;
        el.innerHTML = parts.map(([arm, c]) => `<span class="gpart"><span class="gbadge t${g.team}">${glyphSVG(arm >= 100 ? ((arm / 100) | 0) === 3 ? "strider" : "drake" : ARM_BY_ID[arm % 100].glyph)}</span><span>×${c}</span></span>`).join("")
          + (lead ? `<span class="glead${lead.delegated ? " on" : ""}" title="${lead.delegated ? `${lead.name} is commanding this battle` : `Led by ${lead.name}`}">${PENNANT}${lead.name.split(" ")[0]}</span>` : "")
          + (g.state !== "formed" ? `<span class="st">${g.state}</span>` : "")
          + (scat ? `<span class="st" title="Out of their ranks: give any order (or U, form up) to re-form them">scattered</span>` : "")
          + (eta >= 0 ? `<span class="porder" title="An order is on its way (${po.channel})">${po.channel === "rider" ? "✉" : po.channel === "horn" ? "📯" : "🗣"} ${eta}s</span>` : "");
      }
      el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${(p.y - 20).toFixed(1)}px, 0) translate(-50%, -50%)`; el.hidden = false; n++;
      const occ = labelBehindStone(g); if (el._occ !== occ) { el._occ = occ; el.style.opacity = occ ? "0.4" : ""; } // (men behind a castle's masonry: their label is dimmed, not hung on the stone as if it were theirs)
      if (el._wk !== el._k) { el._wk = el._k; el._hw = el.offsetWidth / 2; el._hh = el.offsetHeight / 2; } // (measured when its content changes: the click picks a label by its real box)
      g._lab = [p.x, p.y - 20, el._hw, el._hh]; g._shown = true;
      const hov = g.team !== PLAYER && g.gid === clickUI.hoverGid(); if (el._hov !== hov) { el._hov = hov; el.classList.toggle("hov", hov); }
    }
    for (let k = n; k < pool.length; k++) pool[k].hidden = true;
    clickUI.frame(); // (the confirmation words at the spots of orders)
    // step numbers on the selection's command chain
    const pts = selectionChainPoints() || []; let m = 0;
    if (pts.length > 1) for (const [x, y] of pts) {
      const p = toScreen(x, y, 2); if (!p.front) continue;
      let el = numPool[m]; if (!el) { el = document.createElement("div"); el.className = "chainnum"; labelsEl.append(el); numPool.push(el); }
      el.textContent = m + 1; el.style.transform = `translate3d(${(p.x - 9).toFixed(1)}px, ${(p.y - 9).toFixed(1)}px, 0)`; el.hidden = false; m++;
    }
    for (let k = m; k < numPool.length; k++) numPool[k].hidden = true;
  }

  // ---------------------------------------------------------------- loop (pure real time)
  const siegeEl = $("#siegebar"); let panelT = 0, bpanelT = 0;
  let acc = 0, last = performance.now(), hudT = 0, benchRec = null, benchLast = 0; const benchPx = new Uint8Array(4);
  const benchFreeze = params.has("bench"); // render benchmarks: the sim holds still so every run sees the same scene
  // while the loading screen is up and the page can't be seen (the app's window covered or in the background, the
  // screen locked: WebKit and Chrome both stop requestAnimationFrame), a timer draws the frames instead — the frames
  // are what ask for the models and what lift the curtain, and with none the load sat at "First light…" for good
  let framesDrawn = 0, pumping = false; // (the pump itself starts with the frame loop, below)
  function frame(now) {
    const f0 = performance.now();
    const dt = Math.min(0.25, (now - last) / 1000); last = now; if (!benchFreeze && !battle?.frozen && !siege?.frozen && !REALM) acc += dt;
    while (acc >= TICK) { step(w); for (const G of generals) generalThink(w, G); if (reeve) reeveThink(w, reeve); acc -= TICK; }
    if (REALM) { // (the realm: no sim, the mirror slides every man toward the server's last word)
      mirror.frame(now); realmUI?.frame();
      if (now - (realm.viewT || 0) > 1000) { realm.viewT = now; realm.send({ t: "view", x: Math.round(camera.st.tx), y: Math.round(camera.st.ty), r: Math.round(Math.max(700, camera.st.dist * 2.5)) }); } // (men near where you look come at 5 Hz, the rest at 1 Hz)
    }
    if (V.dirty) { V.dirty = false; fogUpload(V.teams[PLAYER]); fogTex.needsUpdate = true; }
    worldMap.tick(now); // (once a second: what we have seen of other houses' buildings — js/ui/worldmap.js)
    const W = innerWidth, H = innerHeight; renderer.setSize(W, H, false);
    lordUI.frame(dt, acc); // (input → the lord's body; drives the camera while you are in his view)
    camera.update(dt, W / H);
    audio.update(dt);
    dots.material.uniforms.pxPerM.value = H / (2 * Math.tan(camera.cam.fov * Math.PI / 360));
    dots.material.uniforms.dpr.value = renderer.getPixelRatio();
    if ((map.carveVer || 0) !== terrCarveV) { terrCarveV = map.carveVer || 0; terr.setCarves(map.carves); } // a castle's ditches dug in (js/sim/earthworks.js), a moat filled
    castles.update(w, camera, dt); // (before the figures: they stand at its levels and hide above its cut-away)
    townWalls.update(w, { buildings: blds.group, camera }); // (a town's walls: the men up on them stand on the walk; a tower's roof is cut away over the men on its platform)
    crossR.sync(w);
    figures?.update(w, camera.cam, selected, visibleFig, dt, acc, now / 1000);
    engines.update(w, w.time + acc * BATTLE_RATE, dt, camera.cam, (e) => e.team === PLAYER || canSee(V, PLAYER, e.x, e.y));
    dots.update(w, map, selected, visibleSoldier, figures?.fade);
    { const lo = { visible: (x, y, team) => team === PLAYER || canSee(V, PLAYER, x, y), visibleMan: visibleSoldier, pxPerM: dots.material.uniforms.pxPerM.value, dpr: renderer.getPixelRatio(), vpH: H, dt, now: now / 1000 };
      laborR.update(w, camera.cam, lo); lanesR.update(w, camera.cam, lo); dragonsR.update(w, camera.cam, lo); veinsR.update(w, camera.cam, lo); }
    terr.uniforms.camPos.value.copy(camera.cam.position); terr.uniforms.time.value = now / 1000;
    if (!REALM) advanceChains(w);
    markers.update(dt, w, selected, camera.st.dist, selectionChainPoints());
    tickFlags(now / 1000); fire.update(dt, w, camera.cam, H);
    spellfx.update(dt, w, camera.cam, H); terr.uniforms.mist.value = Math.max(spellfx.mist, battle?.env?.mist || 0, siege?.env?.mist || 0, w.wx ? Math.min(0.9, w.wx.fog * 0.9) : 0);
    { // one sky over every mode (js/render/weatherfx.js): a battle's or siege's setup weather, or the live world's w.wx
      const sky = battle?.env || siege?.env || w.wx;
      if (sky || wxFx.on) {
        wxFx.on = !!sky && (sky.rain > 0.02 || sky.snow > 0.02);
        wxFx.update(dt, { rain: sky?.rain || 0, snow: sky?.snow || 0, wind: w.wind, x: camera.st.tx, y: camera.st.ty, ground: map.h(camera.st.tx, camera.st.ty) });
      }
      terr.uniforms.wet.value = sky?.wet || 0; terr.uniforms.snow.value = sky?.snowCover || 0;
    }
    if (battle) { battle.frame(dt, camera, map); battle.frameMoments?.(dt); }
    siege?.frame?.(dt);
    worldStream?.update(camera); // (the big world: the tiles round the view, built a few a frame)
    props.update(camera.cam, dt);
    flora.update(w, camera.cam, dt);
    const fR = performance.now();
    renderer.render(scene, camera.cam);
    drawLabels(); cmdKeys.frame(dt); capUI.frame();
    drainLog();
    if ((hudT += dt) > 0.5) { hudT = 0; if (selected.size) refreshSel();
      updateSiegeBar(siegeEl, w, PLAYER, places.townName); document.body.classList.toggle("sieging", !siegeEl.hidden);
      if (battle) battle.updateBar(); else if (siege) siege.updateBar?.(); else if (!REALM) { watchHome(); checkMatch(); } // (the realm: the server's chronicle tells of enemies sighted: js/game/chronicle.js)
      if (++bpanelT % 3 === 0) refreshBuilding(); // (the open building panel, every 1.5 s)
      if ((panelT += 0.5) >= 3) { panelT = 0; if (!bpanel.hidden && bpanel.querySelector("h3")?.textContent === "Commanders" && !bpanel.matches(":hover")) cmd.showPanel(bpanel, selected); } $("#clock").textContent = ""; renderResourceBar(resBar, w, PLAYER); blds.sync(w, map); paintClearings(); works.sync(w); if (townsUI && !battle && !siege) { townsUI.refresh(); townGround.sync(townsOnGround()); } }
    if (benchRec) { const gl = renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, benchPx); benchRec.push({ ms: performance.now() - f0, pre: fR - f0, iv: now - benchLast, tris: renderer.info.render.triangles, calls: renderer.info.render.calls }); }
    benchLast = now;
    framesDrawn++;
    if (!params.has("shot") && !pumping) requestAnimationFrame(frame);
  }
  // HG.benchView(view, yaw): snap to a view preset, let lazy chunks/LODs settle, then time whole frames
  // (CPU + GPU via gl.finish). Driven by tools/bench-render.mjs.
  const benchView = async (view, yaw = 0, { settle = 1500, frames = 40, at = null } = {}) => {
    const T0 = w.teams[PLAYER].town; if (at) camera.focus(at[0], at[1]); else camera.focus(T0.x + 60, T0.y + 40);
    camera.setView(view); camera.st.pitch = camera.goal.pitch; camera.st.dist = camera.goal.dist; camera.st.yaw = yaw;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    while (!vegReady) await sleep(100);
    await sleep(settle); for (let k = 0; k < 40 && props.busy(); k++) await sleep(250); await sleep(300);
    benchRec = []; while (benchRec.length < frames) await sleep(50);
    const rec = benchRec.slice(1); benchRec = null; const ms = rec.map((r) => r.ms).sort((a, b) => a - b), iv = rec.map((r) => r.iv).sort((a, b) => a - b);
    return { view, yaw, ms: +ms[ms.length >> 1].toFixed(2), p90: +ms[Math.floor(ms.length * 0.9)].toFixed(2), iv: +iv[iv.length >> 1].toFixed(2), pre: +(rec.reduce((a, r) => a + r.pre, 0) / rec.length).toFixed(2), tris: rec.at(-1).tris, calls: rec.at(-1).calls, dpr: renderer.getPixelRatio(), ...props.stats() };
  };
  if (params.get("demo") === "select") setTimeout(() => {
    camera.update(0, innerWidth / innerHeight); camera.cam.updateMatrixWorld();
    boxSelect({ x0: 0, y0: 0, x1: innerWidth, y1: innerHeight }, false);
    const u = w.units.get([...selected][0]);
    orderGroup({ kind: "move", x: u.ax + 250, y: u.ay + 180 });
    if (params.has("chain")) { orderGroup({ kind: "move", x: u.ax + 420, y: u.ay + 20 }, true); orderGroup({ kind: "hold", x: u.ax + 300, y: u.ay - 150 }, true); }
    for (let k = 0; k < +(params.get("demosteps") || 60); k++) { step(w); for (const G of generals) generalThink(w, G); }
    const rep = [...selected].map((id) => w.units.get(id)).filter(Boolean).map((u) => { let f = 0; for (const i of u.members) f += w.S.fatigue[i]; return `${u.arm}${u.isWorkers ? "(W)" : ""}:${u.members.length} d=${Math.round(Math.hypot(u.ax - u.order?.x, u.ay - u.order?.y))} fat=${(f / u.members.length).toFixed(2)} job=${u.job?.kind || "-"}`; });
    document.title = "DEMO " + rep.join(" | ");
  }, 50);
  if (params.get("demo") === "site") setTimeout(() => {
    const T = w.teams[PLAYER]; const s1 = slotsFor(w.plans[PLAYER], "house").filter((s) => !s.taken).sort((a, b) => Math.hypot(a.x - T.town.x, a.y - T.town.y) - Math.hypot(b.x - T.town.x, b.y - T.town.y))[0];
    const r = placeOnPlan(w, PLAYER, "house", s1.x, s1.y); EC.assignWorkers(w, PLAYER, { kind: "build", b: r.b }, 15);
    camera.focus(r.b.x, r.b.y); camera.setView(+(params.get("view") || 2)); if (params.has("close")) camera.st.dist = 90;
    for (let k = 0; k < +(params.get("demosteps") || 400); k++) { step(w); for (const G of generals) generalThink(w, G); }
    document.title = "SITE progress " + r.b.progress.toFixed(2);
  }, 100);
  if (params.get("demo") === "fire") setTimeout(() => {
    const b = w.buildings.find((x) => x.team === PLAYER && x.kind === "house") || w.buildings.find((x) => x.team === PLAYER && x.kind !== "town_hall" && !x.field);
    if (b) { b.progress = 1; EC.damageBuilding(w, b, 0, 1); camera.focus(b.x, b.y); camera.setView(2); for (let k = 0; k < 80; k++) step(w); }
  }, 100);
  if (params.get("demo") === "stakes") setTimeout(() => {
    const u = [...w.units.values()].find((x) => x.team === PLAYER && x.arm === "archers");
    const T = w.teams[PLAYER].town; issueOrder(w, [u.id], { kind: "fortify", x: T.x + 120, y: T.y + 120, facing: 0.8, immediate: true });
    for (let k = 0; k < 2500; k++) { step(w); }
    camera.focus(u.ax, u.ay); camera.setView(3); if (params.has("close")) setTimeout(() => camera.zoomTo(12), 50); document.title = "STAKES feats " + (w.features || []).filter((f) => f.src === "work").length;
  }, 100);
  // ?demo=charge[&foot=archers|spearmen|pikemen|levy|menatarms][&formation=line][&count=120][&kn=40][&at=70 m when the page takes over]: 40 knights
  // charge a body of our foot near the town (tools/charge-probe.mjs is the headless twin); the camera sits on the foot
  if (params.get("demo") === "charge") setTimeout(() => {
    const T = w.teams[PLAYER].town, foot = params.get("foot") || "archers", from = +(params.get("from") || 330);
    // open ground: no hedge, fence, ditch or wall across the 60 m-wide lane the horse will ride (unless dx/dy are given)
    const laneClear = (x, y) => !w.features.some((f) => [[f.x0, f.y0], [f.x1, f.y1], [(f.x0 + f.x1) / 2, (f.y0 + f.y1) / 2]].some(([fx, fy]) => Math.abs(fx - x) < 70 && fy - y > -30 && fy - y < from + 20)) && ![0, 0.25, 0.5, 0.75, 1].some((k) => map.water(x, y + from * k) > 0.3 || goingMul(w, ARMS.knights.id, x, y + from * k, 0, -1) < 0.7);
    let cx = T.x + (+(params.get("dx") || 140)), cy = T.y + (+(params.get("dy") || 120));
    if (!params.has("dx")) search: for (let r = 250; r < 1500; r += 100) for (let a = 0; a < 16; a++) { const x = T.x + Math.cos(a * Math.PI / 8) * r, y = T.y + Math.sin(a * Math.PI / 8) * r; if (x > 100 && y > 100 && x < map.size - 100 && y + from < map.size - 100 && laneClear(x, y)) { cx = x; cy = y; break search; } }
    const F = addUnit(w, { team: PLAYER, arm: foot, count: +(params.get("count") || 120), formation: params.get("formation") || (foot === "archers" ? "line" : "deep"), x: cx, y: cy, facing: 0 });
    const K = addUnit(w, { team: 1 - PLAYER, arm: params.get("mount") === "strider" ? "hobelars" : "knights", count: +(params.get("kn") || 40), formation: "line", depth: 2, x: cx, y: cy + from, facing: Math.PI, mount: params.get("mount") || undefined }); K.noAI = true; // (&mount=strider|drake: the learned mounts, js/sim/mounts.js)
    issueOrder(w, [F.id], { immediate: true, kind: "hold", x: cx, y: cy, facing: Math.PI / 2 });
    issueOrder(w, [K.id], { immediate: true, kind: "assault", x: cx, y: cy, pace: "charge", target: F.id });
    const at = +(params.get("at") || 70); // run the approach headless until the conroi is this close
    for (let s = 0; s < 3000 && Math.hypot(K.ax - F.ax, K.ay - F.ay) > at; s++) step(w);
    window.HG.charge = { F, K };
    camera.focus(cx + +(params.get("lx") || 0), cy + +(params.get("ly") || 10)); camera.setView(+(params.get("view") || 3));
    if (params.has("dist")) camera.st.dist = camera.goal.dist = +params.get("dist");
    if (params.has("yaw")) camera.st.yaw = camera.goal.yaw = +params.get("yaw");
    if (params.has("pitch")) camera.st.pitch = camera.goal.pitch = +params.get("pitch") * Math.PI / 180;
  }, 100);
  if (params.get("demo") === "figures") setTimeout(() => { // figures test: two companies face off, villagers look on
    const T = w.teams[PLAYER].town, cx = T.x + (+(params.get("dx") || 140)), cy = T.y + (+(params.get("dy") || 120)), n = +(params.get("n") || 600);
    const arms = (params.get("arms") || "spearmen,villager").split(",");
    const us = [[], []]; let left = n, k = 0;
    while (left > 0) {
      const team = k % 2, arm = arms[(k >> 1) % arms.length], c = Math.min(left, 150);
      const row = k >> 1, off = (row % 4) * 40 - 60, back = Math.floor(row / 4) * 30;
      us[team].push(addUnit(w, { team, arm, count: c, x: cx + off, y: cy + (team ? 22 + back : -22 - back), facing: team ? Math.PI : 0, formation: "deep" }));
      left -= c; k++;
    }
    if (!params.has("still")) for (const t of [0, 1]) for (const u of us[t]) issueOrder(w, [u.id], { kind: "assault", x: cx, y: cy + (t ? 5 : -5), pace: params.get("pace") || "march" });
    for (let s = 0; s < +(params.get("demosteps") || 40); s++) { step(w); for (const G of generals) generalThink(w, G); }
    camera.focus(cx + +(params.get("lx") || 0), cy + +(params.get("ly") || 0)); camera.setView(+(params.get("view") || 3));
    if (params.has("dist")) camera.st.dist = camera.goal.dist = +params.get("dist");
    if (params.has("yaw")) camera.st.yaw = +params.get("yaw");
    if (params.has("pitch")) camera.st.pitch = camera.goal.pitch = +params.get("pitch") * Math.PI / 180;
  }, 100);
  // ---- demos for the gameplay UI (headless screenshots): commander prompt / delegation, spells, siege, end screen
  const demoArmy = () => [...w.units.values()].filter((u) => u.team === PLAYER && !u.isWorkers && u.members.length);
  const demoCentroid = (us) => { let x = 0, y = 0, n = 0; for (const u of us) { x += u.ax * u.members.length; y += u.ay * u.members.length; n += u.members.length; } return { x: x / n, y: y / n }; };
  const demoRun = (n) => { for (let k = 0; k < n; k++) { step(w); for (const G of generals) generalThink(w, G); } };
  function demoCaptain(disp = "aggressive") {
    const us = demoArmy(), u = us.find((x) => x.arm === "menatarms") || us[0], id = u.members[Math.min(4, u.members.length - 1)];
    (w.sagas ||= new Map()).set(id, { score: 31, feats: [{ t: 0, text: "held the ford alone against three" }], tags: { [disp]: 12 }, rank: 3, offered: false, abilities: ["berserker", "duelist", "rally"], disposition: disp });
    w.S.legend[id] = 3; w.S.kills[id] = 7;
    const id2 = (us.find((x) => x.arm === "archers") || us[0]).members[2];
    w.sagas.set(id2, { score: 8, feats: [], tags: { skirmish: 5 }, rank: 1, offered: false, abilities: ["hawkeye"] }); w.S.legend[id2] = 1; w.S.kills[id2] = 3;
    return id;
  }
  if (params.get("demo") === "commander") setTimeout(() => {
    const hero = demoCaptain(params.get("disp") || "aggressive"), us = demoArmy(), c = demoCentroid(us);
    const ang = +(params.get("ang") ?? 2.5), ex = c.x + Math.cos(ang) * 210, ey = c.y + Math.sin(ang) * 210;
    addUnit(w, { team: 1, arm: "spearmen", count: +(params.get("foes") || 40), x: ex, y: ey, facing: ang + Math.PI, formation: "line" });
    if (!params.has("foes")) addUnit(w, { team: 1, arm: "archers", count: 20, x: ex + Math.cos(ang + 1.57) * 50, y: ey + Math.sin(ang + 1.57) * 50, facing: ang + Math.PI, formation: "line" });
    if (params.has("lead")) cmd.assign(hero, us.map((u) => u.id));
    demoRun(+(params.get("demosteps") || 30));
    if (params.has("leave")) { $("#battlepop [data-him]")?.click(); demoRun(+(params.get("after") || 300)); }
    if (params.has("sel")) { for (const u of demoArmy()) selected.add(u.id); refreshSel(); }
    if (params.has("panel")) cmd.showPanel(bpanel, selected);
    camera.focus((c.x + ex) / 2, (c.y + ey) / 2); camera.setView(+(params.get("view") || 2));
    document.title = `CMD battles=${cmd.battles.length} delegated=${cmd.battles.filter((b) => b.cmd).length} captains=${cmd.captains().length} units=${[...w.units.values()].filter((u) => !u.isWorkers).map((u) => u.team + u.arm.slice(0, 3) + u.members.length + ":" + u.order?.kind + "@" + (u.ax | 0) + "," + (u.ay | 0)).join(" ")}`;
  }, 100);
  if (params.get("demo") === "spell") setTimeout(() => {
    const T = w.teams[PLAYER], k = params.get("kind") || "bless", us = demoArmy(), c = demoCentroid(us);
    T.store.mana = +(params.get("mana") ?? 60);
    camera.focus(c.x, c.y); camera.setView(+(params.get("view") || 2));
    if (params.has("panel")) { showSpells(bpanel, w, PLAYER, () => {}); return; }
    if (params.has("aim")) { spellAim = k; spellfx.aim(c.x + 20, c.y, SPELLS[k].radius || 150); return; }
    const ok = EC.castSpell(w, PLAYER, k, c.x, c.y); if (ok) spellCast(); demoRun(2);
    document.title = `SPELL ${k} ok=${ok} mana=${T.store.mana}`;
  }, 100);
  // ?demo=tech[&tstage=early|mid][&keep][&fire[&cast]]: the research track staged for shots (js/ui/tech.js; status/shots/tech/).
  // early: a new foundation's clerk at his first study; mid: a stockaded village, nine studies learned, two desks busy
  // (no queue: js/sim/tech.js); keep: the keep's panel instead of the tree; fire: three cottages alight (cast: the Rite of Quenching on them)
  if (params.get("demo") === "tech") setTimeout(() => {
    const T = w.teams[PLAYER], S = TC.techState(T), hall = w.buildings.find((b) => b.id === T.hall), mid = params.get("tstage") === "mid";
    legendOpen = true; legendQueue.length = 0; $("#modal").hidden = true;
    if (mid) {
      for (const r of ["silver", "timber", "stone"]) T.store[r] = 1e7; // (the buildings below are paid for; the store is then set to a plausible mid-game one)
      const plan = w.plans?.[PLAYER], put = (kind) => { const s = plan && slotsFor(plan, kind).find((q) => !q.taken); if (!s) return null; const r = placeOnPlan(w, PLAYER, kind, s.x, s.y); if (r.b) { r.b.progress = 1; r.b.hp = r.b.hpMax; r.b.stage = "complete"; r.b.need = null; } return r.b; };
      for (let k = 0; k < 10; k++) put("house"); put("granary"); put("mill"); put("market");
      for (let k = 0; k < 7; k++) put("palisade"); put("gate"); put("barracks"); put("blacksmith"); put("stables");
      Object.assign(S.done, Object.fromEntries(["clerks", "heavy_plough", "staddles", "collier", "marling", "jettied", "pike_drill", "scriptorium", "fleece"].map((id, k) => [id, 128 + k * 9])));
      S.active.push({ id: "tile_roofs", t: 4.9, days: 8, paid: { ...TECHS.tile_roofs.cost } }, { id: "assize", t: 2.1, days: 8, paid: { ...TECHS.assize.cost } });
      Object.assign(T.store, { silver: 9000, timber: 32000, stone: 41000, iron: 230, cloth: 45, staves: 30, lances: 6, rope: 50, hay: 4000, mana: 40 });
    } else { T.store.silver = Math.max(0, T.store.silver - 300); S.active.push({ id: "clerks", t: 2.3, days: 6, paid: { ...TECHS.clerks.cost } }); }
    if (params.has("fire")) {
      const all = w.buildings.filter((b) => b.team === PLAYER && b.kind === "house" && b.progress >= 1);
      const near3 = (h) => [...all].sort((p, q) => Math.hypot(p.x - h.x, p.y - h.y) - Math.hypot(q.x - h.x, q.y - h.y)).slice(0, 3);
      const spread = (g) => Math.max(...g.map((b) => Math.hypot(b.x - g[0].x, b.y - g[0].y)));
      const hs = all.length ? all.map(near3).sort((g1, g2) => spread(g1) - spread(g2))[0] : []; // (the tightest knot of three cottages)
      for (const b of hs) b.fire = 0.8; demoRun(+(params.get("burn") || 80));
      const c = hs.length ? { x: hs.reduce((s, b) => s + b.x, 0) / hs.length, y: hs.reduce((s, b) => s + b.y, 0) / hs.length } : hall; camera.focus(c.x, c.y); camera.setView(+(params.get("view") || 2));
      if (params.has("cast")) setTimeout(() => { S.done.ley_lore = 140; S.done.quench = 150; T.store.mana = 60; const ok = EC.castSpell(w, PLAYER, "quench", c.x, c.y); if (ok) spellCast(); demoRun(+(params.get("after") || 5)); document.title = `TECH cast ok=${ok} fire ${hs.map((b) => b.fire.toFixed(2)).join(",")} mana ${T.store.mana}`; }, +(params.get("castAt") || 8000)); // (after the models are in)
      document.title = `TECH fire ${hs.map((b) => b.fire.toFixed(2) + "@" + Math.round(Math.hypot(b.x - c.x, b.y - c.y))).join(",")} mana ${T.store.mana}`;
      return;
    }
    camera.focus(hall.x, hall.y); camera.setView(+(params.get("view") || 1));
    if (params.has("keep")) showBuildingPanel(bpanel, w, hall, PLAYER, toast, panelActs); else techTree();
    document.title = `TECH ${mid ? "mid" : "early"} learned ${Object.keys(S.done).length} active ${S.active.map((a) => a.id)} stage ${w.plans ? stageOf() : "?"}`;
    function stageOf() { return w.buildings.filter((b) => b.team === PLAYER && b.progress >= 1).length; }
  }, 100);
  // ?demo=castle: a castle on the vale, men on its walls and in its keep, an assault at a breach (js/render/castle-demo.js)
  if (params.get("demo") === "castle") setTimeout(() => import("./render/castle-demo.js").then(async (m) => {
    const SG = await import("./sim/siege.js"); legendOpen = true; legendQueue.length = 0; $("#modal").hidden = true;
    window.HG.castleDemo = await m.castleDemo({ w, map, camera, addUnit, issueOrder, demoRun, EC, SG, PLAYER, params, castles, takeField, lordUI });
  }), 100);
  if (params.get("demo") === "siege") setTimeout(() => {
    const T = w.teams[PLAYER], H = T.town, ang = Math.atan2(w.teams[1].town.y - H.y, w.teams[1].town.x - H.x);
    for (let k = 0; k < 3; k++) addUnit(w, { team: 1, arm: "spearmen", count: 50, x: H.x + Math.cos(ang) * 380 + k * 40, y: H.y + Math.sin(ang) * 380, facing: ang + Math.PI, formation: "line" });
    demoRun(90); camera.focus(H.x + Math.cos(ang) * 200, H.y + Math.sin(ang) * 200); camera.setView(1);
    document.title = `SIEGE besieged=${T.besieged}`;
  }, 100);
  // ?demo=siege-engines[&wall=stone_wall][&steps=600][&look=treb|ram|tower|ladders|mangonel|wall][&view=2][&dist=..]: our vill walled
  // on its plan, the enemy's siege train at work on it — trebuchet, mangonel, springald, ram at the gate, a tower
  // going up to the wall, mantlets with crossbowmen behind them, and an escalade
  if (params.get("demo") === "siege-engines") setTimeout(() => {
    const WALL = params.get("wall") || "palisade", T = w.teams[PLAYER], H = T.town, plan = w.plans[PLAYER];
    for (const sl of plan.slots) {
      if (sl.type === "wall") EC.placeWall(w, PLAYER, WALL, sl.x1, sl.y1, sl.x2, sl.y2, true);
      if (sl.type === "gate") { const g = EC.placeBuilding(w, PLAYER, WALL === "stone_wall" ? "gatehouse" : "gate", sl.x, sl.y, sl.rot || 0, true); if (g) Object.assign(g, { gx1: sl.x1, gy1: sl.y1, gx2: sl.x2, gy2: sl.y2 }); }
    }
    const R = w.teams[1 - PLAYER].town, dir = Math.atan2(R.y - H.y, R.x - H.x);
    const walls = w.buildings.filter((b) => b.team === PLAYER && b.x1 !== undefined);
    const gate = w.buildings.find((b) => b.team === PLAYER && (b.kind === "gate" || b.kind === "gatehouse"));
    const aim = { x: H.x + Math.cos(dir) * 400, y: H.y + Math.sin(dir) * 400 };
    // the stretch with open ground before it (the engines want a clear field, not a wood)
    const openness = (b) => { let nx0 = -(b.y2 - b.y1), ny0 = b.x2 - b.x1; const l0 = Math.hypot(nx0, ny0); nx0 /= l0; ny0 /= l0; if ((b.x - H.x) * nx0 + (b.y - H.y) * ny0 < 0) { nx0 = -nx0; ny0 = -ny0; } let c = 0; for (let d = 10; d <= 200; d += 10) for (const l of [-40, 0, 40]) { const x = b.x + nx0 * d - ny0 * l, y = b.y + ny0 * d + nx0 * l; c += (map.canopy(x, y) > 1 ? 1 : 0) + (map.water(x, y) > 0.1 ? 1 : 0) + Math.abs(map.h(x, y) - map.h(b.x, b.y)) * 0.02; } const fx0 = b.x + nx0 * 190, fy0 = b.y + ny0 * 190, E = 470; if (Math.min(fx0, fy0) < E || Math.max(fx0, fy0) > map.size - E) c += 1000; // (the camera keeps off the map's edge)
      return c + Math.hypot(b.x - aim.x, b.y - aim.y) * 0.002; };
    const W = walls.sort((a, b) => openness(a) - openness(b))[0];
    let nx = -(W.y2 - W.y1), ny = W.x2 - W.x1; const L = Math.hypot(nx, ny); nx /= L; ny /= L; if ((W.x - H.x) * nx + (W.y - H.y) * ny < 0) { nx = -nx; ny = -ny; }
    const at = (d, lat) => ({ x: W.x + nx * d - ny * lat, y: W.y + ny * d + nx * lat }), face = Math.atan2(-ny, -nx);
    const eng = (kind, p, crew) => { const u = addUnit(w, { team: 1 - PLAYER, arm: kind, count: crew, x: p.x, y: p.y, facing: face - Math.PI / 2, formation: "line" }); u.noAI = true; const e = makeEngine(w, u, kind, { state: "ready" }); e.facing = face; e.baseFacing = face; return u; };
    const O = (u, o) => issueOrder(w, [u.id], { ...o, immediate: true });
    O(eng("trebuchet", at(185, -20), 16), { kind: "bombard", x: W.x, y: W.y, bid: W.id });
    O(eng("mangonel", at(95, 35), 16), { kind: "bombard", x: W.x, y: W.y, bid: W.id });
    O(eng("springald", at(140, 60), 4), { kind: "move", x: at(140, 60).x, y: at(140, 60).y, facing: face });
    const gd0 = gate ? Math.hypot(gate.x - H.x, gate.y - H.y) : 1, ram = gate ? eng("ram", { x: gate.x + (gate.x - H.x) / gd0 * 40, y: gate.y + (gate.y - H.y) / gd0 * 40 }, 14) : null;
    const tw = eng("siege_tower", at(26, 22), 18);
    for (let k = 0; k < 3; k++) eng("mantlet", at(62, -2 + (k - 1) * 3), 2);
    addUnit(w, { team: 1 - PLAYER, arm: "crossbow", count: 12, x: at(59, -2).x, y: at(59, -2).y, facing: face - Math.PI / 2, formation: "line" });
    w.teams[1 - PLAYER].store.ladders = 12;
    const esc = addUnit(w, { team: 1 - PLAYER, arm: "spearmen", count: 48, x: at(45, -22).x, y: at(45, -22).y, facing: face - Math.PI / 2, formation: "line" }); esc.noAI = true;
    for (const u of w.units.values()) if (u.team !== PLAYER && u.arm === "crossbow") u.noAI = true;
    addUnit(w, { team: PLAYER, arm: "spearmen", count: 30, x: at(-6, -10).x, y: at(-6, -10).y, facing: face + Math.PI / 2, formation: "line", depth: 2 });
    addUnit(w, { team: PLAYER, arm: "archers", count: 16, x: at(-9, 20).x, y: at(-9, 20).y, facing: face + Math.PI / 2, formation: "line", depth: 2 });
    for (let k = 0; k < 30; k++) step(w); // (the walls become features; then the ladders go up)
    O(esc, { kind: "escalade", x: at(0, -22).x, y: at(0, -22).y, pace: "quick" });
    O(tw, { kind: "advance", x: at(0, 22).x, y: at(0, 22).y });
    if (ram) O(ram, { kind: "batter", x: gate.x, y: gate.y, bid: gate.id });
    demoRun(+(params.get("steps") || 600));
    const look = params.get("look") || "wall", f = { treb: at(185, -20), mangonel: at(95, 35), tower: at(20, 22), ladders: at(4, -22), wall: at(40, 0), ram: gate ? { x: gate.x, y: gate.y } : at(40, 0) }[look] || at(40, 0);
    camera.focus(f.x, f.y); camera.setView(+(params.get("view") || 2));
    if (params.has("dist")) camera.st.dist = camera.goal.dist = +params.get("dist");
    if (params.has("yaw")) camera.st.yaw = +params.get("yaw");
    if (params.has("pitch")) camera.st.pitch = camera.goal.pitch = +params.get("pitch") * Math.PI / 180;
    if (params.has("sel")) { // one of OUR engines (inside our walls) with foot beside it, selected, and the order popup open on the wall
      const k = params.get("sel") || "mangonel", p0 = at(-40, 0), u = addUnit(w, { team: PLAYER, arm: k, count: (EC.RECRUITS[k]?.crew || 4), x: p0.x, y: p0.y, facing: face + Math.PI / 2, formation: "line" });
      makeEngine(w, u, k, { state: "ready" }).facing = face + Math.PI;
      const foot = addUnit(w, { team: PLAYER, arm: "spearmen", count: 20, x: p0.x + 15, y: p0.y, facing: face + Math.PI / 2, formation: "line" });
      demoRun(20); selected.add(u.id); selected.add(foot.id); refreshSel();
      const q = at(90, 0), sc = toScreen(q.x, q.y);
      closePop = openOrderPopup(pop, w, { x: sc.x, y: sc.y }, q, () => {}, () => {}, { siege: engineOrders(w, [u, foot]) });
      camera.focus(p0.x, p0.y);
    }
    legendOpen = true; legendQueue.length = 0; $("#modal").hidden = true; // (a clean view of the works)
    // &pose=s (with &bench, which holds the sim still): every thrower s seconds into its throw, a stone and a quarrel in the air
    if (params.has("pose")) { const ps = +params.get("pose"); for (const e of w.siege.engines) { if (e.kind === "trebuchet" || e.kind === "mangonel" || e.kind === "springald") e.lastShot = w.time - ps; if (e.kind === "ram") { e.battering = true; e.swingT = w.time - ps; } }
      const tr = w.siege.engines.find((e) => e.kind === "trebuchet"); if (tr) w.siege.shots.push({ kind: "stone", big: true, x0: tr.x, y0: tr.y, h0: map.h(tr.x, tr.y) + 9, x1: W.x, y1: W.y, h1: map.h(W.x, W.y) + 2, t0: w.time - 3, t1: w.time + 3.4, apex: 45, team: 1 });
      w.siege.impacts.push({ x: W.x + nx * 2, y: W.y + ny * 2, h: map.h(W.x, W.y) + 1.5, t: w.time, kind: "debris", size: 2.2 }); }
    const Z = w.siege;
    document.title = `SIEGE engines=${Z.engines.map((e) => e.kind + ":" + e.state + ":" + (e.status || "")).join(",")} shots=${Z.stats.visible} breaches=${Z.stats.breaches} climbed=${Z.stats.climbed} ladders=${Z.ladders.length}`;
  }, 100);
  // ?demo=dragon&dscene=sleep|range|boss|yield|keeper|bonded (+&prebuilt for range): the dragons staged for shots
  // (js/sim/dragons.js). &steps=N runs the sim on from the staging; &view/&dist/&yaw/&pitch frame the camera.
  if (params.get("demo") === "dragon") setTimeout(async () => {
    demoRun(3); // (the first econ ticks: the dragons take their lairs)
    if (params.has("nofog")) setInterval(() => V.teams[PLAYER].fill(2), 150); // (a shot of a far lair: nothing to hide)
    const G = w.dragons, D = G?.list[+(params.get("which") || 0)];
    if (!D) { document.title = "DRAGON none"; return; }
    const scene = params.get("dscene") || "sleep";
    let fx = D.home.x, fy = D.home.y;
    if (scene === "boss") {
      const bows = addUnit(w, { team: PLAYER, arm: "archers", count: 60, x: D.home.x + 60, y: D.home.y + 55, facing: 0 });
      const foot = addUnit(w, { team: PLAYER, arm: "menatarms", count: 60, x: D.home.x + 42, y: D.home.y + 38, facing: 0 });
      cmds.run("dragon", { do: "attack", id: D.id, ids: [bows.id, foot.id] });
      demoRun(+(params.get("steps") || 420));
      if (params.has("breath")) { for (let k = 0; k < 3000 && !D.breath; k++) demoRun(1); if (D.breath) { D.breath.until = w.time + 30; demoRun(4); } } // (&breath&bench: hold the first fire)
      fx = (D.x + foot.ax) / 2; fy = (D.y + foot.ay) / 2;
    } else if (scene === "range") { // ranging over an enemy hold's margins with fire (needs &prebuilt for its fields; &bench holds the moment)
      const b = w.buildings.filter((q) => q.team === 1 && q.field).sort((a, c) => Math.hypot(c.x - w.teams[1].town.x, c.y - w.teams[1].town.y) - Math.hypot(a.x - w.teams[1].town.x, a.y - w.teams[1].town.y))[0];
      if (b) {
        b.field.state = "ripe"; b.field.left = Math.max(b.field.left, 500);
        D.mode = "range"; D.act = { kind: "field", building: b.id, team: 1, x: b.x, y: b.y }; D.x = b.x - 46; D.y = b.y - 18; D.z = 12; D.tx = b.x; D.ty = b.y;
        for (let k = 0; k < 220 && !D.breath; k++) demoRun(1); // fly in, light the crop — and hold that moment (&bench)
        D.breath = { x: b.x, y: b.y, t0: w.time, until: w.time + 30 };
        fx = (D.x + b.x) / 2; fy = (D.y + b.y) / 2;
      }
    } else if (scene === "yield" || scene === "keeper" || scene === "bonded") {
      D.dmg[PLAYER] = 600; DGNS.hurtDragon(w, D, D.hp - D.hpMax * 0.2, PLAYER); demoRun(12);
      if (scene !== "yield") { D.owner = PLAYER; D.stage = scene === "bonded" ? 3 : 1; D.trust = scene === "bonded" ? 999999 : 0; D.fedT = w.time; D.mode = "sleep"; D.x = D.home.x; D.y = D.home.y; D.z = 0; D.st = "sleep"; D.hp = D.hpMax * 0.8; }
      if (scene === "yield") { const th = DGNS.lairF(D.id), m = addUnit(w, { team: PLAYER, arm: "menatarms", count: 24, x: D.x + Math.sin(th) * 16, y: D.y - Math.cos(th) * 16, facing: th + Math.PI / 2 }); demoRun(26); fx = (D.x + m.ax) / 2; fy = (D.y + m.ay) / 2; } // (out of the crag's mouth, standing over it)
      if (scene === "keeper") { // the keeper at the lair with the day's meat
        const { addItem } = await import("./sim/labor.js");
        const th = DGNS.lairF(D.id), mx = Math.sin(th), my = -Math.cos(th); // (out of the crag's mouth, before its nose)
        addItem(w, { kind: "deer", kg: 70, x: D.x + mx * 6 + Math.cos(th) * 3, y: D.y + my * 6 + Math.sin(th) * 3, team: PLAYER, loose: true, rot: 0.8 }).st = "fall";
        addItem(w, { kind: "boar", kg: 55, x: D.x + mx * 7.5 + Math.cos(th) * 5, y: D.y + my * 7.5 + Math.sin(th) * 5, team: PLAYER, loose: true, rot: 2.4 }).st = "fall";
        demoRun(12); D.st = "stand"; D.t0 = w.time; // (&bench holds it: head up to the keeper)
        addUnit(w, { team: PLAYER, arm: "villager", count: 1, x: D.x + mx * 10 + Math.cos(th) * 4.5, y: D.y + my * 10 + Math.sin(th) * 4.5, facing: Math.atan2(-my, -mx) }).isWorkers = true; // (set down after the run: the labour lanes would call an idle villager home)
      }
      if (scene === "bonded") { // summoned to war: it fights FOR its house (&bench holds the first breath)
        let sx = D.home.x + 240, sy = D.home.y + 120; // open ground for the foe: not under a canopy, not in water
        for (let r = 200; r <= 420; r += 40) { let done = false; for (let a2 = 0; a2 < 16 && !done; a2++) { const x = D.home.x + Math.cos(a2 * 0.3927) * r, y = D.home.y + Math.sin(a2 * 0.3927) * r; if (map.inBounds(x, y) && map.water(x, y) < 0.02 && map.canopy(x, y) < 0.5 && map.canopy(x + 20, y) < 0.5 && map.canopy(x, y + 20) < 0.5) { sx = x; sy = y; done = true; } } if (done) break; }
        const foes = addUnit(w, { team: 1, arm: "spearmen", count: 45, x: sx, y: sy, facing: Math.PI });
        cmds.run("dragon", { do: "summon", x: sx, y: sy });
        for (let k = 0; k < 2400 && !D.breath; k++) demoRun(1);
        if (D.breath) D.breath.until = w.time + 30;
        demoRun(3); if (D.breath) { D.st = "breathe"; D.t0 = w.time; } // (hold the breath pose, wings mantled, for the shot)
        fx = (D.x + foes.ax) / 2; fy = (D.y + foes.ay) / 2;
      }
    }
    camera.focus(fx, fy); camera.setView(+(params.get("view") || 2));
    if (params.has("dist")) camera.st.dist = camera.goal.dist = +params.get("dist");
    if (params.has("yaw")) camera.st.yaw = camera.goal.yaw = +params.get("yaw");
    else if (scene === "sleep" || scene === "keeper" || scene === "yield") camera.st.yaw = camera.goal.yaw = DGNS.lairF(D.id) + 0.45; // (from the crag's open mouth, not over its back wall)
    if (params.has("pitch")) camera.st.pitch = camera.goal.pitch = +params.get("pitch") * Math.PI / 180;
    legendOpen = true; legendQueue.length = 0; $("#modal").hidden = true;
    setInterval(() => { document.title = `DRAGON ${scene} ${D.name} mode=${D.mode} st=${D.st} z=${D.z.toFixed(1)} hp=${Math.round(D.hp)} owner=${D.owner} stage=${D.stage} @${Math.round(D.x)},${Math.round(D.y)} breath=${D.breath ? 1 : 0} cam=${Math.round(camera.st.tx)},${Math.round(camera.st.ty)},d${Math.round(camera.st.dist)} R=${JSON.stringify(dragonsR.stats())}`; }, 400);
  }, 100);
  // ?demo=avatar (headless checks of the lord in the field, battle mode): he takes the field before our line with an
  // enemy band ahead, and is driven for &steps sim ticks: &act=charge (lance couched, at the gallop), melee (on foot,
  // striking), ride (trot forward), idle. &eagle=<view> leaves his view; &fall=killed|captured drops him (the card);
  // &order=hold|follow|charge|rally|line|wedge gives an order from the saddle; &radial opens the radial; &yaw=rad turns the camera.
  if (params.get("demo") === "avatar") setTimeout(() => {
    const us = demoArmy(), c = demoCentroid(us), E = [...w.units.values()].filter((u) => u.team !== PLAYER && !u.isWorkers && u.members.length), ec = demoCentroid(E.length ? E : us);
    const dir = Math.atan2(ec.y - c.y, ec.x - c.x), fx = Math.cos(dir), fy = Math.sin(dir);
    const px = c.x + fx * (+(params.get("ahead") || 40)), py = c.y + fy * (+(params.get("ahead") || 40));
    const r = takeField(w, PLAYER, px, py, { facing: dir });
    if (r.error) { document.title = "AVATAR error " + r.error; return; }
    const A = w.avatar, act = params.get("act") || "charge";
    if (!params.has("nofoes")) addUnit(w, { team: 1, arm: params.get("foe") || "levy", count: +(params.get("foes") || 40), x: px + fx * +(params.get("foeat") || 130), y: py + fy * +(params.get("foeat") || 130), facing: dir + Math.PI - Math.PI / 2, formation: "shallow", training: 0.25 });
    lordUI.setActive(true); lordUI.setLook(dir + (+(params.get("yaw") || 0)), +(params.get("pitch") || 0.22), +(params.get("dist") || 9));
    if (act === "melee") { A.input.mount = true; demoRun(3); }
    const I = A.input; let k = 0;
    const drive = () => {
      const S = w.S, L = A.lord; let e = -1, ed = 1e9;
      for (let i = 0; i < S.n; i++) if (S.alive[i] && S.team[i] !== PLAYER && S.status[i] !== 3) { const d = Math.hypot(S.x[i] - S.x[L], S.y[i] - S.y[L]); if (d < ed) { ed = d; e = i; } }
      const ang = e >= 0 && act !== "ride" ? Math.atan2(S.y[e] - S.y[L], S.x[e] - S.x[L]) : dir;
      I.aim = ang;
      if (act === "charge") { I.charge = true; I.mx = Math.cos(ang); I.my = Math.sin(ang); I.gait = 2; }
      else if (act === "melee" || act === "ride") { const go = act === "ride" || ed > 1.2; I.mx = go ? Math.cos(ang) : 0; I.my = go ? Math.sin(ang) : 0; I.gait = act === "ride" ? 1 : ed > 6 ? 2 : 0; if (act === "melee" && ed < 3) { k++; if (k % 12 === 0) I.down = true; if (k % 12 === 7) { I.down = false; I.releases.push(0.7); } } }
      else { I.mx = I.my = 0; }
    };
    for (let s = 0, n = +(params.get("steps") || 150); s < n; s++) { drive(); demoRun(1); lordUI.frame(0.1, 0); }
    if (act === "melee" && params.has("hold")) I.down = true; // (the stroke drawn back, for the wind-up meter)
    if (params.has("order")) lordUI.give(params.get("order"));
    if (params.get("fall") === "killed") { const S = w.S; S.alive[A.lord] = 0; S.state[A.lord] = 5; demoRun(1); lordUI.frame(0.1, 0); }
    if (params.get("fall") === "captured") { const S = w.S; S.alive[A.lord] = 0; S.state[A.lord] = 8; demoRun(1); lordUI.frame(0.1, 0); }
    if (params.has("radial")) { lordUI.keys.add("q"); dispatchEvent(new KeyboardEvent("keydown", { key: "q" })); }
    if (params.has("eagle")) { lordUI.setActive(false); camera.setView(+(params.get("eagle") || 2)); if (params.has("edist")) camera.st.dist = camera.goal.dist = +params.get("edist"); }
    lordUI.drawHud();
    setInterval(() => { const q = lordStatus(w); document.title = `AVATAR act=${act} outcome=${q.outcome} mounted=${q.mounted} hp=${q.health.toFixed(2)} wind=${q.stamina.toFixed(2)} horse=${q.horse?.toFixed(2)} kills=${q.kills} impacts=${q.stats.impacts} refused=${q.stats.refused} blows=${q.stats.blows} hits=${q.stats.hits} banner=${q.banner} weapon=${q.weapon} hh=${q.household}`; }, 500);
  }, 100);
  if (params.get("demo") === "end") setTimeout(() => {
    const us = demoArmy(), c = demoCentroid(us);
    addUnit(w, { team: 1, arm: "spearmen", count: 30, x: c.x + 60, y: c.y + 60, formation: "line" });
    demoCaptain("defensive");
    for (const u of us) issueOrder(w, [u.id], { kind: "assault", x: c.x + 60, y: c.y + 60, pace: "quick" });
    demoRun(+(params.get("demosteps") || 900));
    const L = w.teams[params.get("loser") === "0" ? 0 : 1]; L.fallen = true; L.fallReason = "stormed and sacked"; w.events.push({ t: w.tick, kind: "town-fell", team: L.id, why: "stormed and sacked" }); w.log.push(...w.events);
    camera.focus(c.x, c.y);
  }, 100);
  if (params.get("demo") === "plan") setTimeout(() => { placing = { kind: params.get("kind") || "barracks" }; siteUI.start(placing.kind); }, 100);
  if (params.get("demo") === "pick") setTimeout(() => {
    const b = w.buildings.find((x) => x.id === w.teams[PLAYER].hall); camera.focus(b.x, b.y); camera.setView(2);
    setTimeout(() => { const out = [];
      for (const lift of [0, 6, 12]) { const p = toScreen(b.x, b.y, lift); ndc.set(p.x / innerWidth * 2 - 1, -(p.y / innerHeight) * 2 + 1);
        const ray2 = new THREE.Raycaster(); ray2.setFromCamera(ndc, camera.cam); const hits = ray2.intersectObject(blds.group, true);
        out.push(lift + ":" + hits.length + ":" + (hits[0]?.object.userData.bid ?? "-") + ":" + blds.group.children.length); }
      document.title = "PICK " + out.join(" "); }, 3000);
  }, 100);
  if (params.get("demo") === "jitter") import("./render/figures.js").then((FM) => {
    const T = w.teams[PLAYER].town; camera.focus(T.x + 40, T.y + 40); camera.setView(3);
    setTimeout(() => { FM.FIGSTAT.flips = 0; FM.FIGSTAT.n = 0; FM.FIGSTAT.old = 0; FM.FIGSTAT.rawRev = 0; FM.FIGSTAT.smRev = 0; setTimeout(() => { document.title = `JITTER rev raw ${FM.FIGSTAT.rawRev} smooth ${FM.FIGSTAT.smRev} | gait new ${FM.FIGSTAT.flips} old ${FM.FIGSTAT.old} over ${FM.FIGSTAT.n} figure-frames`; }, 20000); }, 4000);
  });
  if (params.get("demo") === "knights-order") setTimeout(() => {
    const k = [...w.units.values()].find((u) => u.team === PLAYER && u.arm === "knights");
    selected.clear(); selected.add(k.id);
    const tx = k.ax + 300, ty = k.ay + 200; const r = orderGroup({ kind: "move", x: tx, y: ty });
    const log = [`ret ${r} order ${k.order?.kind} path ${k.path?.length} deleg ${k.delegated} group ${k.group} retinue ${k.retinue}`];
    for (let t = 0; t < 600; t++) { step(w); for (const G of generals) generalThink(w, G); if (reeve) reeveThink(w, reeve); advanceChains(w);
      if (t % 100 === 0) { const S = w.S; let v = 0, st = {}; for (const id of k.members) { v += Math.hypot(S.vx[id], S.vy[id]); st[S.state[id]] = (st[S.state[id]] || 0) + 1; } log.push(`t${t / 10}s ax ${Math.round(k.ax)},${Math.round(k.ay)} ord ${k.order?.kind} path ${k.path?.length} v ${(v / k.members.length).toFixed(2)} st ${JSON.stringify(st)} pending ${(w.command?.queue || w.command?.pending || []).length ?? '-'}`); } }
    log.push(`after60s d=${Math.round(Math.hypot(k.ax - tx, k.ay - ty))} order ${k.order?.kind} ${Math.round(k.order?.x)},${Math.round(k.order?.y)} path ${k.path?.length} state ${k.state} mode ${k.mode || ''}`);
    document.title = "KN " + log.join(" | ");
  }, 300);
  if (params.get("demo") === "wallline") setTimeout(() => {
    const T = w.teams[PLAYER], b = w.buildings.find((x) => x.id === T.hall);
    const a = [...w.units.values()].find((u) => u.team === PLAYER && u.arm === "archers");
    const m = [...w.units.values()].find((u) => u.team === PLAYER && u.arm === "menatarms");
    selected.clear(); selected.add(a.id); selected.add(m.id);
    orderGroup({ kind: "hold", x: b.x, y: b.y + 4, formation: "line", immediate: true });
    for (let t = 0; t < 1200; t++) step(w);
    const fp = EC.BUILDINGS.town_hall.footprint; let pressed = 0;
    for (const u of [a, m]) for (const id of u.members) { const dx = w.S.x[id] - b.x, dy = w.S.y[id] - b.y, c = Math.cos(-(b.rot || 0)), s2 = Math.sin(-(b.rot || 0)); const lx = Math.abs(dx * c - dy * s2), ly = Math.abs(dx * s2 + dy * c); if (lx < 17 && ly < 9) pressed++; }
    camera.focus(b.x, b.y); camera.setView(2); camera.st.dist = 120;
    document.title = `WALL pressed-against-keep ${pressed} of ${a.members.length + m.members.length}`;
  }, 300);
  if (params.get("demo") === "interrupt") setTimeout(() => {
    const T = w.teams[PLAYER]; const sl = slotsFor(w.plans[PLAYER], "house").find((q) => !q.taken);
    const site = placeOnPlan(w, PLAYER, "house", sl.x, sl.y).b;
    const m = [...w.units.values()].find((u) => u.team === PLAYER && u.arm === "menatarms");
    selected.clear(); selected.add(m.id);
    orderGroup({ kind: "build", x: site.x, y: site.y });
    for (let t = 0; t < 300; t++) { step(w); advanceChains(w); }
    const before = `helping ${m.helping} prog ${site.progress.toFixed(3)}`;
    const r = orderGroup({ kind: "move", x: m.ax + 200, y: m.ay + 100 });
    for (let t = 0; t < 400; t++) { step(w); advanceChains(w); }
    document.title = `INTERRUPT ${before} → ret ${r} order ${m.order?.kind} helping ${m.helping} dist ${Math.round(Math.hypot(m.ax - site.x, m.ay - site.y))}`;
  }, 300);
  if (params.get("demo") === "attack") setTimeout(() => {
    const mine = (arm) => [...w.units.values()].find((u) => u.team === PLAYER && u.arm === arm);
    const theirs = (arm) => [...w.units.values()].find((u) => u.team !== PLAYER && u.arm === arm);
    const k = mine("knights"), a = mine("archers"), xb = theirs("crossbow"), sp = theirs("spearmen");
    const gOf = (u) => ({ units: [u], counts: new Map([[w.S.arm[u.members[0]], u.members.length]]), x: u.ax, y: u.ay, team: u.team });
    selected.clear(); selected.add(k.id); attackGroup(gOf(xb));
    selected.clear(); selected.add(a.id); attackGroup(gOf(sp));
    const log = [];
    for (let t = 0; t <= 900; t++) { step(w); if (t % 150 === 0) log.push(`t${t / 10}s knights→xbow ${Math.round(Math.hypot(k.ax - xb.ax, k.ay - xb.ay))}m (${k.order?.kind} tgt ${k.order?.target === xb.id}) | archers→spears ${Math.round(Math.hypot(a.ax - sp.ax, a.ay - sp.ay))}m aim ${a.c?.mtgt === sp} xbow ${xb.members.length} spears ${sp.members.length}`); }
    document.title = "ATTACK " + log.join(" || ");
  }, 300);
  if (params.has("dbgb")) setInterval(() => { const st = blds.stats(); document.title = `B shown=${st.shown} ${st.keys.join(',')} | n=${w.buildings.length} th=${JSON.stringify(w.buildings.filter(b=>b.kind==='town_hall').map(b=>[Math.round(b.x),Math.round(b.y),b.progress,b.team]))}`; }, 2000);
  // ---- a live ranked battle's frame: the same deployment (each move sent to the server), the spells, the verdict
  function liveUI() {
    RK.battleKit({ live: { send: (m) => realm.ws?.send(JSON.stringify(m)), charges: realm.hello.live?.charges, arena: realm.hello.live?.arena }, scene, map, camera, canvas, groundAt, toast });
    let deploy = battle.phase === "deploy" ? makeDeploy(w, battle, { canvas, camera, groundAt, toScreen, terr, ovTex, V, selected, refreshSel: () => {}, toast, remote: battle.remote,
      seen: (u) => u.team !== PLAYER && u.members.some((i) => mirror.visible(i)), refreshVision: () => {} }) : null;
    battle.onBar = (o) => deploy?.liveStatus({ left: o.left, foeReady: o.foeSet });
    battle.onAdvance = () => { deploy?.done(); deploy = null; toast("The trumpets sound the advance!"); };
    battle.onEnd = (o) => { deploy?.done(); deploy = null; RK.liveVerdict(o, battle); };
    battle.deploy = () => deploy;
  }
  // ---- the battle's frame: deployment, the moments, the verdict and the reckoning
  function battleUI() {
    if (RANKED && bcfg.ranked) RK.battleKit({ w, cfg: bcfg, battle, PLAYER, scene, map, camera, canvas, groundAt, toast }); // (skills, the foe's spells, your spell bar, the arena: js/ui/ranked.js)
    const seenAt = (x, y) => canSee(V, PLAYER, x, y);
    let ended = false, deploy = null;
    const reckon = () => {
      if (!battle.rec.outcome) battle.rec.outcome = { winner: -1, loser: -1, why: "the fighting was broken off", t: w.time - battle.rec.t0 };
      battle.rec.finalise();
      const win = battle.rec.outcome.winner, R = surveyField(map, bcfg.site, bcfg.axis), riseT = [0, 0];
      riseT[battle.teamOf(0)] = R.rise[0]; riseT[battle.teamOf(1)] = R.rise[1];
      const story = tellBattle(w, battle.rec, { names: battle.names, weather: bcfg.weather, tod: bcfg.tod, windFrom: bcfg.windFrom, where: battle.names.place(bcfg.site.x, bcfg.site.y), rise: riseT, objective: !!(bcfg.objectives && Object.keys(bcfg.objectives).length),
        ground: win >= 0 ? groundSentence(R, battle.sideOf(win), win, 1 - win, battle.names) : "" });
      document.querySelector("#battleend")?.remove();
      showAftermath($("#modal"), { w, battle, story, map, onClose: () => {}, onAgain: () => { if (RANKED) { location.href = location.pathname + "?mode=ranked"; return; } again(bcfg); location.reload(); }, onNew: () => { try { sessionStorage.removeItem("hg.again"); } catch { } location.href = location.pathname + (RANKED ? "?mode=ranked" : "?mode=battle&banner=" + mine.id); } });
      if (RANKED && bcfg.ranked && !bcfg.ranked.sent) { bcfg.ranked.sent = true; RK.reportResult(bcfg, win, PLAYER, styleWatch?.style || null); }
    };
    battle.reckon = reckon;
    makeMoments(battle, { camera, log: logEv, ping: (x, y) => markers.ping(x, y), seen: seenAt, PLAYER, onEnd: (O) => {
      if (ended) return; ended = true;
      if (RANKED && bcfg.ranked && !bcfg.ranked.sent) { bcfg.ranked.sent = true; RK.reportResult(bcfg, O.winner, PLAYER, styleWatch?.style || null); } // (sent the moment the field is decided)
      const won = O.winner === PLAYER, draw = O.winner < 0, card = document.createElement("div"); card.id = "battleend"; card.className = draw ? "draw" : won ? "won" : "lost";
      card.innerHTML = `<div class="be-k">${draw ? "Nightfall" : won ? "Victory" : "Defeat"}</div><div class="be-t">${draw ? "Both hosts draw off in the dark" : `${cap(battle.names.side(O.winner))} hold the field`}</div><div class="be-b"><button data-reckon class="on">The reckoning</button><button data-watch>Watch the field</button></div>`;
      document.querySelector("#hud").append(card);
      let auto = setTimeout(reckon, params.has("shot") ? 50 : 9000);
      card.querySelector("[data-reckon]").onclick = () => { clearTimeout(auto); reckon(); };
      card.querySelector("[data-watch]").onclick = () => { clearTimeout(auto); card.querySelector("[data-watch]").remove(); };
    } });
    const advance = () => { deploy = null; battle.advance(); toast("The trumpets sound the advance!"); };
    if (params.has("shot") && !params.has("deploy") && !params.has("setup")) advance();
    else deploy = makeDeploy(w, battle, { canvas, camera, groundAt, toScreen, terr, ovTex, V, selected, refreshSel: () => {}, toast,
      refreshVision: () => { const e = V.every; V.every = 1; updateVision(w, V, map.canopyGrid ? map.canopy : null); V.every = e; }, onAdvance: advance });
    battle.deploy = () => deploy;
    if (params.get("demo") === "aar") setTimeout(() => { // headless: fight the battle out at full speed, then the reckoning
      if (deploy) deploy.advance();
      const n = +(params.get("steps") || 6000);
      for (let k = 0; k < n && !battle.rec.outcome; k++) step(w);
      for (let k = 0; k < 200; k++) step(w);
      reckon();
    }, 300);
  }
  // (&manual: the page draws only when told to — window.HGframe(ms) advances a clock of its own by ms and draws one frame,
  // so a capture is the same whatever the machine's speed: tools/motion-shots.mjs)
  if (params.has("shot") && params.has("manual")) { let t = last; window.HGframe = (ms) => frame((t += ms)); }
  else if (params.has("shot")) setInterval(() => frame(performance.now()), 60); // headless checks get real frames
  else {
    requestAnimationFrame(frame);
    const pump = setInterval(() => { if (!document.hidden) return; pumping = true; try { frame(performance.now()); } finally { pumping = false; } }, 250);
    afterLoading().then(() => clearInterval(pump));
  }
  // the first rendered frames are the slow ones (shaders compile, models upload): lift the curtain after them
  { const f0 = framesDrawn, wait = setInterval(() => { if (framesDrawn - f0 >= 8) { clearInterval(wait); holdForModels(); } }, 50); if (params.has("shot")) setTimeout(hideLoading, 1500); } // (counted in frame(): rAF or the hidden-page pump)
  // the first frames ask for every model in view; keep the loading screen up until they have all arrived — or for MODEL_HOLD
  // at most: a first entry over the Funnel brings ~140 MB of models at ~1 MB/s, minutes behind a curtain that looks hung
  // (the owner: "the game still just like stops loading"). Past that the land is up and playable, and the models still on
  // their way are counted in a note at the bottom until the last has come.
  const MODEL_HOLD = 20000;
  const modelMB = () => { let b = 0; try { for (const e of performance.getEntriesByType("resource")) if (/\.(glb|hgz|jpg|png|ktx2)(\?|$)/.test(e.name)) b += e.encodedBodySize || e.transferSize || 0; } catch { /* old browser */ } return b / 1e6; };
  let mbAt = 0, mb = 0; const mbNow = () => { const t = performance.now(); if (t - mbAt > 400) { mbAt = t; mb = modelMB(); } return mb; };
  function holdForModels() {
    waitForAssets({ cap: MODEL_HOLD, frameCount: () => framesDrawn, onProgress: ({ inflight, started, finished }) => { if (inflight) loadingNote(`Bringing in the models… ${finished} of ${started} (${Math.round(mbNow())} MB)`, started ? finished / started : 0); } })
      .then(({ inflight }) => {
        loadingStep("first"); hideLoading();
        if (!inflight) return;
        waitForAssets({ cap: 600000, frameCount: () => framesDrawn, onProgress: ({ inflight, started, finished }) => { if (inflight) modelsRibbon(`Bringing in the models… ${finished} of ${started} (${Math.round(mbNow())} MB)`); } })
          .then(() => modelsRibbon(null));
      });
  }
  // the realm: what happened in your lands while you were away (the team's chronicle, hello.away), once, on joining
  if (REALM && !LIVE && !params.has("noaway")) setTimeout(() => { if ($("#modal").hidden && !fellShown) showAway($("#modal"), (realm.hello.away || []).map((L) => ({ ...L, date: Number.isFinite(L.t) ? ago((realm.hello.tick - L.t) * TICK) : "" })), { name: realm.hello.you.name, onJump: (x, y) => camera.focus(x, y) }); }, params.has("shot") ? 1600 : 900);
  // HG.bench(sec): real frame intervals + GPU-inclusive render time (gl.finish) for perf checks
  const bench = (sec = 5) => new Promise((res) => {
    const gl = renderer.getContext(), iv = [], rt = []; let t0 = performance.now(), last = t0;
    const r0 = renderer.render.bind(renderer);
    renderer.render = (sc, cm) => { const a = performance.now(); r0(sc, cm); gl.finish(); rt.push(performance.now() - a); };
    (function tick(t) { iv.push(t - last); last = t; if (t - t0 < sec * 1000) requestAnimationFrame(tick); else { renderer.render = r0;
      const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length, p = (a, q) => [...a].sort((x, y) => x - y)[Math.floor(a.length * q)];
      res({ fps: +(1000 / avg(iv.slice(2))).toFixed(1), renderMs: +avg(rt).toFixed(2), renderP95: +p(rt, 0.95).toFixed(2), frames: iv.length, figs: figures?.stats(), men: w.S.n, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }); } })(last);
  });
  if (battle?.live) liveUI();
  else if (battle) battleUI();
  if (siege) siegeUI(w, siege, { camera, canvas, groundAt, toScreen, selected, refreshSel, toast, log: logEv, ping: (x, y) => markers.ping(x, y), lordUI, seen: (x, y) => canSee(V, PLAYER, x, y),
    onNew: () => { location.href = location.pathname + "?mode=siege&banner=" + mine.id; }, onAgain: () => { try { sessionStorage.setItem("hg.siegeAgain", JSON.stringify(scfg)); } catch { /* private mode */ } location.reload(); } });
  window.HG = { w, V, camera, worldStream, selected, clickUI, groups: () => groupsCache, openOrdersAt, lordUI, cmdKeys, setOverlay, figures, laborR, bench, benchView, props, flora, renderer, battle, castles, siege, realm, mirror, cmds, toScreen, groundAt, handbook, worldMap, fieldDraw, settling, siteUI, townsUI, curTown: () => curTown, townGround, townsOnGround, surfPaint: () => surfPaint }; document.title = "HIGHGROUND · " + (map.meta?.name || "map"); // debug handle for headless checks
}

const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const ago = (sec) => sec < 90 ? "just now" : sec < 5400 ? `${Math.round(sec / 60)} min ago` : sec < 129600 ? `${Math.round(sec / 3600)} h ago` : `${Math.round(sec / 86400)} days ago`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ---- the battle's configuration: the one to fight again, ?scenario=/?site= for headless checks, or the setup screen
function again(cfg) { try { sessionStorage.setItem("hg.again", JSON.stringify(cfg.kind === "scenario" ? { kind: "scenario", id: cfg.id, playerSide: cfg.playerSide, follow: cfg.follow } : { ...cfg, _tweaks: undefined, scenario: undefined })); } catch { /* private mode */ } }
// ---- the siege's configuration: the one to fight again, ?castle=hill|concentric|river[&side=defend][&force=small|strong|great]
// [&season=][&provision=][&relief] for headless checks, or the setup screen
async function siegeCfg(map, banners, places, castleApi) {
  let again0 = null; try { again0 = JSON.parse(sessionStorage.getItem("hg.siegeAgain") || "null"); sessionStorage.removeItem("hg.siegeAgain"); } catch { /* ignore */ }
  if (again0) return again0;
  const P = new URLSearchParams(location.search), layout = P.get("castle");
  if (layout && !P.has("setup")) { const F = SIEGE_FORCES[P.get("force") || "strong"] || SIEGE_FORCES.strong; return siegeConfig({ castle: layout, site: siteFor(map, layout, castleApi), side: P.get("side") === "defend" ? "defend" : "attack", garrison: F.garrison, besiegers: F.besiegers, train: F.train, season: P.get("season") || "summer", provision: +(P.get("provision") || 45), relief: P.has("relief"), lord: !P.has("nolord"), weather: P.get("weather") || "clear", names: [places.townName(0), places.townName(1)], places }); }
  const ld = document.querySelector("#loading"); if (ld) ld.style.visibility = "hidden";
  const cfg = await chooseSiege(document.querySelector("#modal"), { map, banners, places, castleApi });
  if (ld) ld.style.visibility = "";
  return cfg;
}
async function battleConfig(map, banners, places) {
  if (params.get("mode") === "ranked") { // the camp, then the matched foe on a field drawn from the match's seed
    const ld = document.querySelector("#loading"); if (ld) ld.style.visibility = "hidden";
    const cfg = await RK.rankedConfig(document.querySelector("#modal"), { map, mapId: pickedMapId(), places });
    if (ld) ld.style.visibility = ""; return cfg;
  }
  let again0 = null; try { again0 = JSON.parse(sessionStorage.getItem("hg.again") || "null"); sessionStorage.removeItem("hg.again"); } catch { /* ignore */ }
  if (again0) return again0.kind === "scenario" ? { ...scenarioConfig(map, again0.id, again0.playerSide), follow: again0.follow } : again0;
  const names = [places.townName(0), places.townName(1)];
  if (params.has("scenario") && SCENARIOS[params.get("scenario")] && !params.has("setup")) return scenarioConfig(map, params.get("scenario"), params.has("side") ? +params.get("side") : null);
  if (params.has("shot") && !params.has("setup")) {
    const site = params.has("site") ? (([x, y]) => ({ x, y }))(params.get("site").split(",").map(Number)) : { x: 800, y: 1600 };
    return customConfig({ site, axis: params.has("axis") ? +params.get("axis") * Math.PI / 180 : Math.PI / 2, names, places,
      host: [["spearmen", 80], ["menatarms", 30], ["levy", 60], ["archers", 80], ["knights", 15], ["hobelars", 20]],
      foe: [["spearmen", 80], ["pikemen", 40], ["menatarms", 30], ["crossbow", 40], ["levy", 60], ["knights", 15], ["hobelars", 20]],
      temper: params.get("edisp") || "aggressive", weather: params.get("weather") || "clear", tod: params.get("tod") || "noon", windDir: params.get("wind") || "across" });
  }
  const ld = document.querySelector("#loading"); if (ld) ld.style.visibility = "hidden";
  const cfg = await chooseBattle(document.querySelector("#modal"), { map, banners, places, preset: params.has("scenario") ? { scenario: params.get("scenario") } : null });
  if (ld) ld.style.visibility = "";
  return cfg;
}
// (ranked: the banner chosen once — chooseBanner keeps it — is flown every battle after)
function rankedBanner() { let id = null; try { id = localStorage.getItem("hg.banner"); } catch { /* private mode */ } return id === null ? null : BANNERS.find((b) => String(b.id) === id) || null; }
const PENNANT = `<svg viewBox="0 0 10 10"><path d="M2 .8v8.6" stroke="currentColor" stroke-width="1.3"/><path d="M2.6 1h6.4L7 3.2 9 5.4H2.6z" fill="currentColor"/></svg>`;
const clock = (t) => { const d = Math.floor(t / 86400), h = Math.floor(t / 3600 + 7) % 24, m = Math.floor(t / 60) % 60; return `Day ${d + 1} · ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; };

addEventListener("error", (e) => { document.title = "ERR " + e.message + " @" + e.lineno; });
addEventListener("unhandledrejection", (e) => { document.title = "REJ " + (e.reason?.stack || e.reason); });
boot().catch((e) => { document.title = "ERR " + e.message; console.error("boot failed:", e?.stack || e); window.__bootErr = String(e?.stack || e); });
