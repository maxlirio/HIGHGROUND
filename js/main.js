import * as THREE from "three";
import { loadMap, placeholderMap } from "./sim/map.js";
import { createWorld, addUnit, issueOrder, step, splitUnit, mergeUnits, TICK, goingMul } from "./sim/world.js";
import { computeGroups, groupLayout } from "./ui/groups.js";
import { makeMarkers } from "./render/markers.js";
import { makeProps, FOG } from "./render/props.js";
import { ARMS, ARM_BY_ID, FORMATIONS } from "./sim/arms.js";
import { makeVision, updateVision } from "./sim/vision.js";
import { combatSystem } from "./sim/combat.js";
import { commandBattle } from "./sim/commander-ai.js";
import { fieldWork } from "./sim/features.js";
import * as EC from "./sim/economy.js";
import { logisticsSystem } from "./sim/logistics.js";
import { convoySystem } from "./sim/convoys.js";
import { setupResources } from "./sim/resources.js";
import { makeGeneral, generalThink, reeveThink } from "./sim/ai-general.js";
import { makeBuildings, setTeamBanners, tickFlags } from "./render/buildings.js";
import { makeFire } from "./render/fire.js";
import { makeFieldWorks } from "./render/fieldworks.js";
import { chooseBanner, drawBanner, bannerColor, bannerAccent, enemyBannerFor, BANNERS } from "./ui/heraldry.js";
import { TEAM as DOT_TEAM } from "./render/dots.js";
import { buildPlan, placeOnPlan, slotsFor, snapSlot, NEAR_RESOURCE } from "./sim/townplan.js";
import { renderResourceBar, showBuildingPanel, showBuildMenu, showLandPanel, landPreview } from "./ui/town.js";
import { makeObstacles, loadVegetation, loadObjects, obstacleSystem } from "./sim/obstacles.js";
import { markObstaclesOnNav } from "./sim/path.js";
import { siegeSystem, ensureSiege, engineOf, engineInfo, engineOrders, makeEngine } from "./sim/siege.js";
import { makeEngines } from "./render/engines.js";
import { makeCastles } from "./render/castle.js";
import { BATTLE_RATE } from "./sim/clock.js";
import { featuresFromMapData } from "./sim/features.js";
import { legendSystem, nameOf } from "./sim/legend.js";
import { showLegend } from "./ui/legend-ui.js";
import { overlayRaster } from "./sim/analysis.js";
import { buildTerrain, SUN_DIR, outside, vnoise } from "./render/terrain.js";
import { makeDots } from "./render/dots.js";
import { makeFigures } from "./render/figures.js";
import { showLoading, loadingStep, hideLoading, loadingStart } from "./ui/loading.js";
import { loadSurfaceArrays, surfaceIdTexture } from "./render/splat.js";
import { SURFACE_TEX, ROCK_TEX } from "./render/surface-tex.js";
import { makeCamera } from "./render/camera.js";
import { Q, PRESETS, setQuality, onQuality } from "./render/quality.js";
import { glyphSVG } from "./ui/glyphs.js";
import { openOrderPopup, openAttackPopup, orderContext } from "./ui/orders.js";
import { setFireMode } from "./sim/ballistics.js";
import { makePlaces } from "./ui/places.js";
import { makeCommand } from "./ui/commanders.js";
import { makeEventLog } from "./ui/eventlog.js";
import { showSpells, canCast, SPELL_INFO } from "./ui/spells.js";
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
import { castlePick, castleOrders, castleChoose, installCastleHover } from "./ui/castle-orders.js";
import { FORCES as SIEGE_FORCES } from "./sim/siege-war.js";
import { showAftermath } from "./ui/aftermath.js";
import { tellBattle, groundSentence } from "./sim/battle-story.js";
import { surveyField } from "./sim/battlefield.js";
import { initAudio } from "./audio/index.js";
import { makeAvatarUI } from "./ui/avatar-ui.js";
import { makeCommandKeys } from "./ui/command-keys.js";
import { takeField, lordStatus } from "./sim/avatar.js";

const PLAYER = 0;
const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);

async function loadTerrainTable() {
  try { return (await import("./sim/terrain-types.js")).TERRAIN || {}; } catch { return {}; }
}

async function boot() {
  // banners first: the player's arms (and the enemy's contrasting ones) colour everything
  const mine = params.has("shot") || params.has("bench") || params.has("banner") ? (BANNERS.find((b) => b.id === +params.get("banner")) || BANNERS[0]) : await chooseBanner(document.querySelector("#modal")); // (?banner=: already chosen — the pitched-battle button carries it over)
  const theirs = enemyBannerFor(mine);
  // the match: difficulty and the enemy lord's temper (headless checks: ?diff=0.7&edisp=aggressive, or ?demo=start to see the screen)
  const BATTLE = params.get("mode") === "battle"; // a pitched battle only: two armies drawn up, no towns to run
  const SIEGE = params.get("mode") === "siege"; // a siege only: a castle, its garrison and the besieging host (js/ui/siege-run.js)
  const quick = ((params.has("shot") || params.has("bench")) && params.get("demo") !== "start") || BATTLE || SIEGE;
  const setup = quick ? { difficulty: +(params.get("diff") || 0.7), disposition: params.get("edisp") || "aggressive", hidden: false }
    : await chooseMatch(document.querySelector("#modal"), mine, theirs);
  setup.diffName = Object.values(DIFFICULTY).find((d) => Math.abs(d.value - setup.difficulty) < 0.01)?.name || `difficulty ${setup.difficulty}`;
  const banners = [mine, theirs];
  banners.forEach((b, i) => { DOT_TEAM[i].set(bannerColor(b)); document.documentElement.style.setProperty(`--t${i}`, bannerColor(b)); document.documentElement.style.setProperty(`--t${i}a`, bannerAccent(b)); });
  setTeamBanners(banners.map((b) => drawBanner(b, 256, 192)));
  let map;
  showLoading(); loadingStart(); await new Promise((r) => setTimeout(r, 30)); // let the screen paint before the heavy work
  try { map = await loadMap("maps/vale"); } catch { map = placeholderMap(); }
  loadingStep("map"); loadingStep("land");
  // ---- a pitched battle: the field, the hosts, the day (the setup screen, a replay of the last one, or ?scenario= for checks)
  let bcfg = null;
  if (BATTLE) {
    const settle0 = await fetch("maps/vale/settlements.json").then((r) => r.ok ? r.json() : null).catch(() => null);
    bcfg = await battleConfig(map, banners, makePlaces(map, settle0));
    prepareField(map, bcfg);
    setup.disposition = bcfg.sides.find((d) => d.ai)?.temper || setup.disposition; setup.hidden = !!bcfg.sides.find((d) => d.ai)?.hidden;
  }
  // ---- a siege: the castle, your side, the forces, the season (the setup screen, or ?castle= for headless checks)
  let scfg = null, castleApi = null;
  if (SIEGE) {
    castleApi = await import("./sim/castle.js").catch(() => null);
    const settle0 = await fetch("maps/vale/settlements.json").then((r) => r.ok ? r.json() : null).catch(() => null);
    scfg = await siegeCfg(map, banners, makePlaces(map, settle0), castleApi);
  }
  const terrain = await loadTerrainTable();
  const w = createWorld({ map, terrain, seed: 1234 });
  w.humanTeam = PLAYER; // (your companies scattered by a charge stay scattered until you order them; the AI's captains re-form theirs)
  const V = makeVision(map);
  w.systems.push(combatSystem, legendSystem, EC.economySystem, logisticsSystem, convoySystem, (w) => updateVision(w, V, map.canopyGrid ? map.canopy : null));
  // trunks, hedges and buildings are physical: loaded before the first tick, resolved after every tick
  w.obstacles = makeObstacles();
  const [vegData, objData, footprints] = await Promise.all(["maps/vale/vegetation.json", "maps/vale/objects.json", "assets/footprints.json"].map((u) => fetch(u).then((r) => r.ok ? r.json() : null).catch(() => null)));
  if (vegData) loadVegetation(w.obstacles, vegData);
  // obstacles: landmarks from the map file; town buildings come from the live economy (below)
  if (objData) loadObjects(w.obstacles, { objects: objData.objects.filter((o) => o.team === undefined || o.team === null) }, footprints || {});
  w.systems.push(obstacleSystem);
  ensureSiege(w); w.systems.push(siegeSystem); // engines, escalades, gates; walls are solid (after everything that moves men)
  // fences and hedgerows are battlefield features too (charges refuse them, archers shelter behind them, columns seek the gaps)
  w.features = featuresFromMapData(objData, vegData);
  // ---- the match: both towns with their people, retinues, stores and fields; Red is run by the AI general
  EC.initEconomy(w);
  let towns = (map.meta?.features || []).filter((f) => f.type === "town_site").map((f) => ({ x: f.xy_m[0], y: f.xy_m[1] }));
  if (towns.length < 2) towns = [{ x: 780, y: 820 }, { x: 3300, y: 3300 }];
  setupResources(w, { objectsJson: objData, towns, seed: 1234 * 7 + 1 });
  loadingStep("world");
  const settle = await fetch("maps/vale/settlements.json").then((r) => r.ok ? r.json() : null).catch(() => null);
  // nothing but the keep stands at the start: the players build their towns — on each town's plan
  towns.slice(0, 2).forEach((t, i) => EC.makeTown(w, i, t.x, t.y, objData?.objects || [], { prebuilt: params.has("prebuilt") }));
  w.plans = [0, 1].map((i) => { const T = w.teams[i]; return buildPlan(i, settle?.towns?.find((s) => s.team === i) || {}, EC.fieldSites(w, i, T.town.x, T.town.y)); });
  // ---- commanders & delegation, the chronicle's feed, the match tally (sim systems: they run in warm-ups and demos too)
  const places = makePlaces(map, settle);
  let chron = null, camRef = null; const early = [];
  const logEv = (text, o = {}) => chron ? chron.add(text, o) : early.push([text, o]);
  const focusAt = (x, y) => camRef?.focus(x, y);
  const tally = makeTally(); w.systems.push((w) => tallyEvents(w, tally));
  const cmd = makeCommand(w, { PLAYER, V, places, toast, log: logEv, focus: focusAt, onDelegate: (ids) => dropChains(ids), promptEl: $("#battlepop"), promptMs: params.has("shot") ? 1e9 : 25000 });
  if (!SIEGE) w.systems.push(cmd.system); // (a siege is one long fight the siege itself tells — js/ui/siege-run.js: no "Battle at…" for every brush at the walls)
  const measured = footprints || {}; const solid = new Set();
  w.systems.push((w) => { // new buildings become physical the moment they're staked out
    if (w.tick % 20) return;
    for (const b of w.buildings) {
      if (solid.has(b.id) || b.field) continue; solid.add(b.id);
      if (b.x1 !== undefined || b.kind === "gate" || b.kind === "gatehouse") continue; // walls and gates are barriers with breaches and a passage (siege.js), not solid boxes
      const m = measured[b.kind === "house" ? ["house_a", "house_b", "house_c"][b.id % 3] : b.kind];
      loadObjects(w.obstacles, { objects: [{ asset: b.kind, x: b.x, y: b.y, rot: b.rot || 0 }] }, m ? { [b.kind]: m } : {});
    }
    if (w.obstacles.fresh?.length) { markObstaclesOnNav(w.nav, w.obstacles.fresh); w.obstacles.fresh.length = 0; }
  });
  w.systems.push((w) => { // soldiers helping on a building site add their labour (less skilled than the crew)
    if (w.tick % 10) return;
    for (const u of w.units.values()) {
      if (!u.helping) continue;
      const b = w.buildings.find((x) => x.id === u.helping);
      if (!b || b.ruin || b.progress >= 1) { u.helping = null; continue; }
      if (Math.hypot(u.ax - b.x, u.ay - b.y) > 40 + (b.x1 !== undefined ? Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 2 : 0)) continue;
      const T = w.teams[u.team], men = u.members.length;
      b.progress = Math.min(1, b.progress + men * 0.6 * EC.DT * 10 * (T.eff || 0.7) * (EC.E.buildSpeed || 1) / (b.labour || 100));
      b.hp = (b.hpMax || 100) * (0.05 + 0.95 * b.progress);
      for (const id of u.members) w.S.state[id] = 6; // S_WORK: they're digging and hauling
      if (b.progress >= 1) { w.events.push({ t: w.tick, kind: "built", building: b.id, team: b.team, what: b.kind }); u.helping = null; }
    }
  });
  w.systems.push((w) => { // soldiers with torches at an enemy building: thatch and timber catch, stone must be pulled down
    if (w.tick % 10) return;
    for (const u of w.units.values()) {
      if (!u.burning) continue;
      const b = w.buildings.find((x) => x.id === u.burning);
      if (!b || b.ruin) { u.burning = null; continue; }
      const reach = 14 + (b.x1 !== undefined ? Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 2 : Math.max(...(EC.BUILDINGS[b.kind].footprint || [10])) / 2);
      if (Math.hypot(u.ax - b.x, u.ay - b.y) > reach || u.state === "routing") {
        // still on their way: if they stopped (a skirmish, a blocked path) and no enemy is at hand, press on
        if (!u.path && !u.hold && u.state !== "routing" && w.tick % 50 === 0) issueOrder(w, [u.id], { kind: "move", x: b.x, y: b.y, pace: "quick" });
        continue;
      }
      const def = EC.BUILDINGS[b.kind], men = u.members.length;
      if (def.flammable) { if (w.rng.chance(Math.min(0.9, 0.05 * men))) EC.damageBuilding(w, b, 0, 0.35); }
      else EC.damageBuilding(w, b, men * 0.4, 0); // hacking at masonry: slow
      for (const id of u.members) w.S.state[id] = 6;
    }
  });
  w.systems.push((w) => { // Fortify: once there, archers plant a stake line before them; foot dig a ditch
    if (w.tick % 10) return;
    for (const u of w.units.values()) {
      if (u.order?.kind !== "fortify" || u.path || u.fortified === u.orderT || u.isWorkers) continue;
      const A = ARMS[u.arm]; if (A.mounted) { u.fortified = u.orderT; continue; }
      fieldWork(w, u, A.missile ? "archer_stakes" : "ditch", A.missile ? 3 : 4); u.fortified = u.orderT;
    }
  });
  w.teams[PLAYER].hq = { x: w.teams[PLAYER].town.x, y: w.teams[PLAYER].town.y }; // your orders go out from the keep
  const enemy = makeGeneral(w, 1, { difficulty: setup.difficulty, disposition: setup.disposition, V });
  let generals = params.has("autoplay") ? [makeGeneral(w, 0, { difficulty: 0.7, disposition: "defensive", V }), enemy] : [enemy];
  let reeve = params.has("autoplay") ? null : makeGeneral(w, PLAYER, { difficulty: 0.7, disposition: "defensive", V });
  let battle = null;
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
  for (let k = +(params.get("warm") || 0); k > 0; k--) step(w); // headless checks: pre-run the sim

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
  const terr = buildTerrain(map); scene.add(terr.group);
  terr.uniforms.terrFar.value = Q.terrFar; onQuality(() => { terr.uniforms.terrFar.value = Q.terrFar; });
  if (map.surface && map.surfaceKeys.length) {
    // texture layers: one per distinct texture used; remap surface ids → layer ids
    const texNames = [ROCK_TEX, "grazed_pasture", "heath", "tall_grass", "forest_floor", "sand", ...new Set(map.surfaceKeys.map((k) => SURFACE_TEX[k] || "short_meadow"))].filter((v, i, a) => a.indexOf(v) === i);
    const layerOf = map.surfaceKeys.map((k) => texNames.indexOf(SURFACE_TEX[k] || "short_meadow"));
    const remapped = new Uint8Array(map.surface.length); for (let k = 0; k < remapped.length; k++) remapped[k] = layerOf[map.surface[k]];
    loadingStep("terrain");
    const arrays = await loadSurfaceArrays(texNames, terrain);
    loadingStep("textures");
    terr.uniforms.surfId.value = surfaceIdTexture({ surface: remapped, res: map.res });
    terr.uniforms.albedoArr.value = arrays.albedo; terr.uniforms.normalArr.value = arrays.normal;
    terr.uniforms.tileM.value.set(arrays.tile); terr.uniforms.splatOn.value = 1;
    const L = (t) => Math.max(0, texNames.indexOf(t));
    terr.uniforms.wildLayers.value.set([L("grazed_pasture"), L("heath"), L("tall_grass"), L("forest_floor")]);
    terr.uniforms.sandLayer.value = L("sand");
  }
  const fogTex = new THREE.DataTexture(new Uint8Array(V.n * V.n), V.n, V.n, THREE.RedFormat);
  fogTex.magFilter = fogTex.minFilter = THREE.LinearFilter;
  terr.uniforms.fogTex.value = fogTex; terr.uniforms.fogOn.value = params.has("nofog") || battle || siege ? 0 : 1; // (a pitched battle: you know the land — only the enemy's men are hidden)
  FOG.fogTex.value = fogTex; FOG.fogOn.value = terr.uniforms.fogOn.value;
  if (map.waterDepth) {
    const wt = new THREE.DataTexture(map.waterDepth, map.res, map.res, THREE.RedFormat, THREE.FloatType);
    wt.minFilter = wt.magFilter = THREE.LinearFilter; wt.needsUpdate = true;
    terr.uniforms.waterTex.value = wt; terr.uniforms.waterOn.value = 1;
  }
  loadingStep("scene");
  const dots = makeDots(); scene.add(dots.points);
  // the men themselves near the camera (VAT-animated figures); ?figures=0 keeps plain dots everywhere
  const figures = params.get("figures") === "0" ? null : makeFigures(scene, map);
  figures?.setAccents(banners.map((b) => bannerAccent(b)));
  loadingStep("figures");
  const markers = makeMarkers(scene, map);
  const blds = makeBuildings(scene);
  // clearance mask: building sites (and the ground around finished buildings) are cleared, trodden sand
  const CLR = 1024, clearData = new Uint8Array(CLR * CLR);
  const clearTex = new THREE.DataTexture(clearData, CLR, CLR, THREE.RedFormat); clearTex.magFilter = clearTex.minFilter = THREE.LinearFilter; clearTex.needsUpdate = true;
  terr.uniforms.clearTex.value = clearTex; terr.uniforms.clearOn.value = 1;
  const cleared = new Set();
  function paintClearings() {
    let dirty = false; const cm = map.size / CLR;
    for (const b of w.buildings) {
      if (cleared.has(b.id) || b.field || b.kind === "town_hall") continue; cleared.add(b.id); dirty = true;
      const isWall = b.x1 !== undefined, fp = EC.BUILDINGS[b.kind]?.footprint || [12, 10];
      const hx = isWall ? Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 2 + 4 : fp[0] * 0.62 + 4, hy = isWall ? 5 : fp[1] * 0.62 + 4;
      const rot = isWall ? Math.atan2(b.y2 - b.y1, b.x2 - b.x1) : b.rot || 0, c = Math.cos(rot), s = Math.sin(rot), R = Math.hypot(hx, hy) + 6;
      for (let j = Math.floor((b.y - R) / cm); j <= Math.ceil((b.y + R) / cm); j++) for (let i = Math.floor((b.x - R) / cm); i <= Math.ceil((b.x + R) / cm); i++) {
        if (i < 0 || j < 0 || i >= CLR || j >= CLR) continue;
        const dx = i * cm - b.x, dy = j * cm - b.y, lx = Math.abs(dx * c + dy * s) / hx, ly = Math.abs(-dx * s + dy * c) / hy;
        const d = Math.pow(Math.pow(lx, 4) + Math.pow(ly, 4), 0.25); // soft rounded rectangle
        const v = Math.max(0, Math.min(1, (1.25 - d) / 0.5)) * 255;
        const k = j * CLR + i; if (v > clearData[k]) clearData[k] = v;
      }
    }
    for (const f of w.features || []) { // ditches and pits: dug earth along the line
      if ((f.type !== "ditch" && f.type !== "pits_pottes") || f._painted) continue; f._painted = true; dirty = true;
      const L = Math.hypot(f.x1 - f.x0, f.y1 - f.y0), n = Math.ceil(L / cm), r = (f.width || 2.5) / 2 + 1;
      for (let s2 = 0; s2 <= n; s2++) { const t = s2 / Math.max(1, n), x = f.x0 + (f.x1 - f.x0) * t, y = f.y0 + (f.y1 - f.y0) * t;
        for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const i = Math.round(x / cm) + di, j = Math.round(y / cm) + dj; if (i < 0 || j < 0 || i >= CLR || j >= CLR) continue;
          const dd = Math.hypot(i * cm - x, j * cm - y); if (dd < r) clearData[j * CLR + i] = 255; } }
    }
    if (dirty) clearTex.needsUpdate = true;
  }
  const fire = makeFire(scene, map);
  const engines = makeEngines(scene, map, fire); // siege engines, stones and quarrels in flight, ladders
  const castles = makeCastles(scene, map, fire); // castles you go inside: walls, towers, keep, the cut-away (js/render/castle.js)
  const visibleFig = (i) => visibleSoldier(i) && !castles.hides(w, i); // (men above a cut-away storey are not drawn)
  const works = makeFieldWorks(scene, map);
  const resBar = $("#res"), bpanel = $("#bpanel");
  let placing = null; // { kind, wall, p1 }
  $("#buildbtn").onclick = () => showBuildMenu(bpanel, w, PLAYER, (pick) => {
    placing = pick;
    if (NEAR_RESOURCE[pick.kind]) { markers.setPlan(null); toast(`Click beside the ${NEAR_RESOURCE[pick.kind].res[0]} it will work`); }
    else { markers.setPlan(slotsFor(w.plans[PLAYER], pick.kind)); toast(`Click a highlighted plot for the ${EC.BUILDINGS[pick.kind].name}`); }
  });
  $("#cmdbtn").onclick = () => { if (!bpanel.hidden && bpanel.querySelector("h3")?.textContent === "Commanders") bpanel.hidden = true; else cmd.showPanel(bpanel, selected); };
  let spellAim = null; // spell being placed
  $("#spellbtn").onclick = () => showSpells(bpanel, w, PLAYER, (k) => { spellAim = k; placing = null; markers.setPlan(null); markers.setGhost(null); toast(SPELL_INFO[k]?.aim || "Click the ground"); });
  // (a spell cast from the UI happens between ticks: its event would be wiped by the next step before the
  // chronicle or the tally saw it, so hand it over now)
  function spellCast() { const e = w.events.at(-1); if (e?.kind === "spell") { w.log.push(e); w.events.pop(); tally.spells[PLAYER]++; } }
  function castAt(pt) {
    const k = spellAim, why = canCast(w, PLAYER, k);
    if (why) { toast(why); return; }
    if (!EC.castSpell(w, PLAYER, k, pt.x, pt.y)) { toast("The working fails"); return; }
    spellCast();
    spellAim = null; spellfx.aim(null); hint.hidden = true;
  }
  // trees & shrubs (our Blender-made GLBs). Species without a model yet borrow the nearest look-alike.
  const props = makeProps(scene, map, { renderer, light: { sunDir: SUN_DIR, sun, hemi } });
  castles.setProps(props); // (a castle clears the trees off its ground)
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
      const glbOk = await assetExists(a);
      if (!glbOk) { sc *= STAND_IN_SCALE[a] ?? 1; a = STAND_IN[a] || "oak_a"; }
      if (!byAsset.has(a)) byAsset.set(a, []);
      byAsset.get(a).push({ x: it.x, y: it.y, rot: it.rot, scale: sc });
    }
    // the land beyond the edge is the map mirrored — so are its woods (render only; nobody goes there)
    const S = map.size, BAND = 90;
    for (const items of byAsset.values()) {
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
    for (let y = -M; y < S + M; y += 22) for (let x = -M; x < S + M; x += 22) {
      if (outside(map, x, y) < 70) continue;
      const jx = x + (vnoise(x * 0.37, y * 0.37) - 0.5) * 20, jy = y + (vnoise(x * 0.41 + 5, y * 0.41) - 0.5) * 20;
      const dense = vnoise(jx * 0.0016 * 1.0, jy * 0.0016) ; if (dense < 0.6 && vnoise(jx * 0.02, jy * 0.02) > 0.04) continue;
      const k = ["oak_a", "oak_b", "oak_c"][(Math.floor(jx * 7 + jy * 3) >>> 0) % 3];
      wild[k].push({ x: jx, y: jy, rot: vnoise(jx, jy) * 6.28, scale: 0.85 + vnoise(jy, jx) * 0.35 });
    }
    for (const [a, items] of Object.entries(wild)) { if (!byAsset.has(a)) byAsset.set(a, []); byAsset.get(a).push(...items); }
    for (const [a, items] of byAsset) props.add(a, items);
  }).finally(() => { vegReady = true; });
  // settlement buildings, landmarks and resource nodes (only assets whose model exists yet)
  Promise.resolve(objData).then(async (od) => {
    if (!od) return;
    const byAsset = new Map();
    for (const o of od.objects) {
      if (o.start === false || (o.team !== undefined && o.team !== null) || !(await assetExists(o.asset))) continue;
      if (!byAsset.has(o.asset)) byAsset.set(o.asset, []);
      byAsset.get(o.asset).push({ x: o.x, y: o.y, rot: o.rot || 0, scale: o.scale || 1, dz: -0.15 });
    }
    for (const [a, items] of byAsset) props.add(a, items);
  });
  const existCache = new Map();
  function assetExists(a) {
    if (!existCache.has(a)) existCache.set(a, fetch(`assets/glb/${a}.glb`, { method: "HEAD" }).then((r) => r.ok).catch(() => false));
    return existCache.get(a);
  }
  const camera = makeCamera(canvas, map);
  camRef = camera;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  chron = makeEventLog($("#chron"), { onJump: (x, y) => camera.focus(x, y), dateOf: () => { if (battle) { const t = battle.phase === "deploy" ? 0 : w.time - battle.rec.t0; return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`; } if (siege) return `day ${Math.floor((w.time - siege.t0) / 40) + 1}`; const d = new Date(2026, 0, 1 + Math.floor(w.econ.doy)); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; } });
  if (battle) chron.add(`${bcfg.name}${bcfg.scenario ? ", " + bcfg.scenario.year : ""}. ${cap(battle.names.lord(1 - PLAYER))} is ${setup.hidden ? "a man you have yet to measure" : "a " + (DISPOSITIONS[setup.disposition]?.name || setup.disposition)}.`, { x: bcfg.site.x, y: bcfg.site.y });
  else if (siege) chron.add(`${siege.cfg.name}. ${siege.att === PLAYER ? "You lay siege to it" : "You hold it"} with ${siege.roster.start[PLAYER]} men against ${siege.roster.start[1 - PLAYER]}.`, { x: siege.castle.x, y: siege.castle.y });
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
  if (params.has("view")) camera.setView(+params.get("view"));
  const atParam = params.get("at");
  const first = [...w.units.values()].find((u) => u.team === PLAYER);
  { const T0 = w.teams[PLAYER].town; camera.focus(T0.x + 60, T0.y + 40); } // open on our own town
  if (battle) { // look from behind your own ground toward the enemy's
    const z = battle.zones[battle.sideOf(PLAYER)], at = { x: z.cx + Math.cos(z.face) * 190, y: z.cy + Math.sin(z.face) * 190 };
    camera.focus(at.x, at.y); camera.setView(1); camera.st.yaw = z.face - Math.PI / 2; camera.goal.dist = camera.st.dist = 1050;
    for (const sel of ["#res", "#buildbtn"]) { const el = document.querySelector(sel); if (el) el.style.display = "none"; }
    document.querySelectorAll("#topbar button").forEach((b) => { if (/Build|Spells/.test(b.textContent)) b.style.display = "none"; });
    document.body.classList.add("battle-mode");
  }
  if (atParam) { const [ax, ay] = atParam.split(",").map(Number); camera.focus(ax, ay); camera.st.yaw = +(params.get("yaw") || 0); }

  const selected = new Set();
  const visibleSoldier = (i) => w.S.team[i] === PLAYER || V.teams[PLAYER][((w.S.y[i] / V.cellM) | 0) * V.n + ((w.S.x[i] / V.cellM) | 0)] === 2;

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
    const hit = ray.intersectObject(terr.mesh)[0];
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
  const selbox = $("#selbox"), pop = $("#orderpop"); let drag = null, closePop = null, lordUI = null;
  let nextGroup = 1;
  // ---- right-drag with troops selected: where they stand (press) and which way they face (drag); the drag's length is
  // the frontage of their line. Release opens the order popup with that facing set.
  let rdrag = null;
  const faceArrow = document.createElementNS("http://www.w3.org/2000/svg", "svg"); faceArrow.id = "facearrow"; faceArrow.hidden = true;
  faceArrow.innerHTML = '<defs><marker id="fah" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z"/></marker></defs><line marker-end="url(#fah)"/><line class="front"/><text></text>';
  document.body.append(faceArrow);
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
    faceArrow.hidden = false;
  });
  addEventListener("pointerup", (e) => {
    if (e.button !== 2) return;
    const r = rdrag; rdrag = null; faceArrow.hidden = true;
    if (!r || !r.moved || !r.g1) { if (e.target === canvas && !lordUI?.captures()) deselect(); return; } // (a plain right-click: deselect, as before)
    const facing = Math.atan2(r.g1.y - r.g0.y, r.g1.x - r.g0.x);
    openOrdersAt(e.clientX, e.clientY, r.g0, { facing, frontage: r.front });
  });
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || lordUI?.captures()) return; // (the lord's view and his placement take the mouse: js/ui/avatar-ui.js)
    drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY };
  });
  const hint = document.createElement("div"); hint.id = "landhint"; hint.hidden = true; document.body.append(hint);
  installCastleHover({ w, canvas, camera, selected, busy: () => !!(placing || spellAim || lordUI?.captures()) }); // ("Tower top · 13 m · 8 men fit" under the pointer)
  let hintT = 0;
  addEventListener("pointermove", (e) => {
    if (spellAim && performance.now() - hintT > 60) {
      hintT = performance.now(); const gp = groundAt(e.clientX, e.clientY);
      if (gp) { const Sp = SPELLS[spellAim]; spellfx.aim(gp.x, gp.y, Sp.radius || 150); hint.textContent = `${SPELL_INFO[spellAim]?.name || spellAim} · ${Sp.mana} mana · ${Sp.desc}`; hint.style.left = e.clientX + 16 + "px"; hint.style.top = e.clientY + 16 + "px"; hint.hidden = false; }
      return;
    }
    if (placing && !NEAR_RESOURCE[placing.kind] && performance.now() - hintT > 120) {
      hintT = performance.now(); const gp = groundAt(e.clientX, e.clientY);
      if (gp) {
        const sl = snapSlot(w.plans[PLAYER], placing.kind, gp.x, gp.y, placing.kind === "field" ? 200 : 45);
        const fp = EC.BUILDINGS[placing.kind]?.footprint || [10, 8];
        markers.setGhost(sl ? (sl.x1 !== undefined ? sl : { x: sl.x, y: sl.y, rot: sl.rot, w: placing.kind === "field" ? sl.w : fp[0], h: placing.kind === "field" ? sl.h : fp[1] }) : null);
        const at = sl || gp;
        hint.textContent = (sl ? "" : "No spot here for this — move to a marked spot · ") + landPreview(w, placing.kind, at.x, at.y);
        hint.style.left = e.clientX + 16 + "px"; hint.style.top = e.clientY + 16 + "px"; hint.hidden = false;
      }
    } else if (!placing) hint.hidden = true;
  });
  let curT = 0;
  addEventListener("pointermove", (e) => {
    if (e.target === canvas && performance.now() - curT > 80) { curT = performance.now(); const g = selected.size ? groupNear(e.clientX, e.clientY) : null; canvas.style.cursor = g && g.team !== PLAYER ? "crosshair" : ""; }
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
    if (spellAim) { const pt = groundAt(e.clientX, e.clientY); if (pt) castAt(pt); return; }
    if (placing) { const pt = groundAt(e.clientX, e.clientY); if (pt) placeAt(pt); return; }
    let g = groupNear(e.clientX, e.clientY);
    if (!selected.size) { // clicking a building opens its panel (unless you clicked right on a group's label)
      ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      let bid = blds.pick(ndc, camera.cam); let bb = bid && w.buildings.find((x) => x.id === bid);
      if (!bb) { // fallback: the ground point falls inside a building's footprint
        const gp0 = groundAt(e.clientX, e.clientY);
        if (gp0) bb = w.buildings.find((b) => !b.field && b.x1 === undefined && (() => { const fp = EC.BUILDINGS[b.kind]?.footprint || [10, 8], c = Math.cos(-(b.rot || 0)), s2 = Math.sin(-(b.rot || 0)), dx = gp0.x - b.x, dy = gp0.y - b.y; return Math.abs(dx * c - dy * s2) < fp[0] / 2 + 2 && Math.abs(dx * s2 + dy * c) < fp[1] / 2 + 2; })());
      }
      if (bb && (!g || !g._label)) { showBuildingPanel(bpanel, w, bb, PLAYER, toast); return; }
    }
    if (!g && !selected.size) {
      const gp = groundAt(e.clientX, e.clientY); // plain ground: what it gives, what building here would do
      if (gp) { showLandPanel(bpanel, w, gp.x, gp.y); return; }
    }
    if (g && g.team !== PLAYER && selected.size) { // clicked the enemy himself: go for THEM, wherever they go — in what order, at what pace?
      const us = [...selected].map((id) => w.units.get(id)).filter((u) => u && !u.isWorkers);
      if (!us.length) { toast("Villagers won't attack soldiers"); return; }
      if (closePop) closePop();
      closePop = openAttackPopup(pop, { x: e.clientX, y: e.clientY }, attackInfo(g, us), (o) => { closePop = null; attackGroup(g, o); }, () => { closePop = null; });
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
      openOrdersAt(e.clientX, e.clientY, pt, { append: e.shiftKey });
    }
  });
  // the order popup for the selection at ground point pt (a click, or a right-drag that also set the facing and frontage)
  function openOrdersAt(sx, sy, pt, { append = false, facing = undefined, frontage = undefined } = {}) {
    if (closePop) { closePop(); closePop = null; }
    markers.pending(pt.x, pt.y);
    const selUnits = [...selected].map((id) => w.units.get(id)).filter(Boolean), place = castlePick(w, camera.cam, pt.sx ?? sx, pt.sy ?? sy), castleOpts = castleOrders(w, selUnits, place), siegeOpts = siege?.popupOrders ? siege.popupOrders(selUnits, pt, []) : [], side = siege ? (siege.att === PLAYER ? "attack" : "defend") : null, ctx = orderContext(w, selUnits, pt, side);
    const missileSel = selUnits.some((u) => ARMS[u.arm]?.missile);
    closePop = openOrderPopup(pop, w, { x: sx, y: sy }, pt, (order) => {
      closePop = null; markers.clearPending();
      if (facing !== undefined) { order.facing = facing; order.frontage = frontage; }
      if (castleChoose(w, order, selUnits, toast)) { markers.ping(place?.x ?? pt.x, place?.y ?? pt.y); return; } // (up onto a tower, the wall-walk, the gatehouse, the keep: js/ui/castle-orders.js)
      if (siege?.popupChoose?.(order, selUnits)) { markers.ping(pt.x, pt.y); return; } // (the siege's own orders: man the walls, hold the breach, to the keep, storm)
      if (order.kind === "attack" && resolveAttack(order, selUnits, ctx)) { markers.ping(pt.x, pt.y); return; }
      if (order.kind === "work") order.kind = ctx.site ? "build" : "gather";
      const n = orderGroup(order, order.append); if (!n) return; markers.ping(pt.x, pt.y);
      toast(order.append ? `Step ${n} added to the chain` : `${ORDER_WORD[order.kind] || order.kind}: ${selectedMen()} men${facing !== undefined ? ", facing as dragged" : ""}`);
    }, () => { closePop = null; markers.clearPending(); }, { append, hasChain: !!chainOfSelection(), siege: siegeOpts, missile: missileSel, ctx, facing, frontage, castle: castleOpts, castleTitle: place?.label });
  }
  // "Attack" means what attacking means at that spot (orders.orderContext): engines bombard / batter / advance; a garrison
  // sallies at an engine; foot fire a gate; men near an enemy building fight what is there and then burn it; else an
  // assault. Returns true when it issued the orders itself; otherwise it rewrites order.kind for orderGroup.
  function resolveAttack(order, units, c) {
    if (c.engines.length) {
      const KIND = { trebuchet: "bombard", mangonel: "bombard", springald: "bombard", ram: "batter", siege_tower: "advance" };
      for (const u of c.engines) if (KIND[u.arm]) issueOrder(w, [u.id], { kind: KIND[u.arm], x: order.x, y: order.y, pace: order.pace || "march" });
      const rest = units.filter((u) => !ARMS[u.arm].engine); if (!rest.length) { toast("The engines go to work"); return true; }
    }
    if (c.side === "defend" && c.enemyEngine) { order.kind = "sally"; return false; }
    if (c.side === "attack" && c.enemyGate && c.foot) { order.kind = "fire-gate"; return false; }
    if (c.enemyBuilding && !c.enemyMen) { order.kind = "burn"; return false; }
    order.kind = "assault";
    if (c.enemyBuilding) { const n = orderGroup(order, order.append); if (n) orderGroup({ ...order, kind: "burn" }, true); toast(`Attack: ${selectedMen()} men, then burn the ${c.enemyBuilding.kind.replace(/_/g, " ")}`); return true; }
    return false;
  }
  canvas.addEventListener("contextmenu", (e) => e.preventDefault()); // (a plain right-click deselects on RELEASE — pointerup below: on a Mac the menu event fires on the press, before a facing drag can start)
  addEventListener("keydown", (e) => { if (!e.metaKey && !e.target.closest?.("input,textarea")) e.preventDefault(); });
  addEventListener("keydown", (e) => { if ((e.key === "x" || e.key === "X") && !e.target.closest?.("input,textarea")) deselect(); }); // not Esc: on a Mac it leaves full screen
  function placeAt(pt) {
    const r = placeOnPlan(w, PLAYER, placing.kind, pt.x, pt.y);
    if (r.error) { toast(r.error); return; } // stay in placing mode so you can click a highlighted plot
    const b = r.b;
    if (!b.field) { const got = EC.assignWorkers(w, PLAYER, { kind: "build", b }, b.x1 !== undefined ? 20 : 12); toast(`${EC.BUILDINGS[b.kind].name} staked out — ${Array.isArray(got) ? got.length : typeof got === "number" ? got : got?.members?.length ?? 12} workers sent`); }
    else toast(`Open field laid out: ${b.field.crop}`);
    placing = null; markers.setPlan(null); markers.setGhost(null); hint.hidden = true;
  }
  function deselect() { spellAim = null; spellfx.aim(null); placing = null; markers.setPlan(null); markers.setGhost(null); hint.hidden = true; selected.clear(); refreshSel(); if (closePop) { closePop(); closePop = null; } markers.clearPending(); }
  $("#selbar").addEventListener("click", (e) => {
    if (e.target.closest("[data-desel]")) deselect();
    if (e.target.closest("[data-take]")) { cmd.takeCommand([...selected]); refreshSel(); }
  });
  function dropChains(ids) { for (const c of [...chains]) if (ids.some((id) => c.units.has(id))) chains.delete(c); } // a captain's orders replace ours
  const ORDER_WORD = { burn: "Burning it", sally: "Sallying out", "fire-gate": "Firing the gate", barricade: "Barricading", mine: "Mining", fortify: "Digging in", volley: "Volleys", loose: "Loose at will", holdfire: "Hold fire", move: "Marching", hold: "Holding", fortify: "Fortifying", ambush: "Setting ambush", assault: "Assaulting", skirmish: "Skirmishing", scout: "Scouting", gather: "Gathering",
    bombard: "Bombarding", batter: "Battering", advance: "Advancing the tower", assemble: "Assembling", escalade: "Escalade", crew: "Manning the engine" };
  const SIEGE_ORDERS = new Set(["bombard", "batter", "advance", "assemble", "escalade", "crew"]);
  const selectedMen = () => [...selected].reduce((s, id) => s + (w.units.get(id)?.members.length || 0), 0);

  // the selected group moves as one body and forms a single battle line at the destination
  // ---- command chains: "go here, then here, then here". A plain order replaces everything the
  // group was doing; an appended order waits until the previous step is finished.
  const chains = new Set(); // { units: Set<unitId>, steps: [order], current: order }
  function chainOfSelection() { for (const c of chains) for (const id of selected) if (c.units.has(id)) return c; return null; }
  // work steps (burn / build / gather): validated when issued, then run as ordinary chain steps
  function workTarget(order) {
    if (order.kind === "burn") return w.buildings.filter((b) => b.team !== PLAYER && !b.ruin).map((b) => ({ b, d: Math.hypot(b.x - order.x, b.y - order.y) })).filter((o) => o.d < 60).sort((a, c) => a.d - c.d)[0]?.b || null;
    if (order.kind === "build") return w.buildings.filter((b) => b.team === PLAYER && (b.progress < 1 || b.hp < (b.hpMax || b.hp)))
      .map((b) => ({ b, d: b.x1 !== undefined ? Math.hypot(b.x - order.x, b.y - order.y) - Math.hypot(b.x2 - b.x1, b.y2 - b.y1) / 2 : Math.hypot(b.x - order.x, b.y - order.y) }))
      .filter((o) => o.d < 45).sort((a, c) => a.d - c.d)[0]?.b || null;
    return null;
  }
  function runWork(us, order) {
    const tgt = order.target;
    if (order.kind === "burn") { for (const u of us) { if (u.isWorkers) continue; u.burning = tgt.id; issueOrder(w, [u.id], { kind: "move", x: tgt.x, y: tgt.y, pace: "quick" }); } return; }
    for (const u of us) {
      if (u.isWorkers) issueOrder(w, [u.id], { ...order, building: order.kind === "build" ? tgt : undefined });
      else if (order.kind === "build" && tgt) { u.helping = tgt.id; issueOrder(w, [u.id], { kind: "move", x: tgt.x, y: tgt.y, pace: "march" }); } // soldiers lend their backs
    }
  }
  const WORK = new Set(["burn", "build", "gather"]);
  const FIRE_ORDERS = { volley: "volley", loose: "will", holdfire: "hold" };
  // ---- attack a unit: foot and horse close with the named body and chase it; missile troops keep it in
  // their sights at a good shooting distance and follow it as it moves
  // what the attack popup tells you about the body you clicked, and what your men make of it
  function attackInfo(g, us) {
    const names = [...g.counts].map(([a, c]) => `${ARM_BY_ID[a]?.name} ×${c}`).join(", ");
    const tu = g.units[0], cx = us.reduce((s, u) => s + u.ax, 0) / us.length, cy = us.reduce((s, u) => s + u.ay, 0) / us.length;
    const mounted = us.some((u) => ARMS[u.arm].mounted), missile = us.some((u) => ARMS[u.arm].missile), melee = us.some((u) => !ARMS[u.arm].missile);
    const theirs = g.units.map((u) => ARMS[u.arm]), pikes = theirs.some((A) => A.reach >= 4), spears = theirs.some((A) => A.pointsRanks >= 2);
    const lines = [`${g.state}${tu.disordered ? ", out of their ranks" : ""} · ${FORMATIONS[tu.formation]?.name || tu.formation} · ${Math.round(Math.hypot(g.x - cx, g.y - cy))} m away`];
    if (mounted && (pikes || tu.formation === "schiltron") && !tu.disordered && g.state !== "routing") lines.push("⚠ A hedge of pikes: horses will refuse it. Take them in the flank or rear, or shoot them first.");
    else if (mounted && spears && !tu.disordered && g.state === "formed") lines.push("Steady spears: many horses will refuse. Better when they are shaken or scattered.");
    else if (mounted && (theirs.some((A) => A.missile) || tu.disordered || g.state !== "formed")) lines.push("Loose, shaken or bowmen: a charge will ride them down.");
    if (mounted) lines.push("A wedge (★) drives deep; a line hits the most men.");
    if (!mounted && theirs.some((A) => A.mounted)) lines.push("Foot won't catch horse in the open; they will stand if the riders draw off.");
    return { title: `Attack the enemy ${names}`, lines, mounted, missile, melee };
  }
  function attackGroup(g, how = {}) {
    const us = [...selected].map((id) => w.units.get(id)).filter((u) => u && !u.isWorkers);
    if (!us.length) { toast("Villagers won't attack soldiers"); return; }
    for (const c of [...chains]) for (const u of us) if (c.units.has(u.id)) { chains.delete(c); break; }
    for (const u of us) {
      const tgt = g.units.reduce((b, v) => (!b || Math.hypot(v.ax - u.ax, v.ay - u.ay) < Math.hypot(b.ax - u.ax, b.ay - u.ay) ? v : b), null);
      u.helping = null; u.burning = null;
      if (ARMS[u.arm].missile) { if (u.fireMode === "hold") setFireMode(w, u, "will"); u.fireAt = tgt.id; u.fireStand = 0; u.atkForm = how.formation || null; followShooters(true); }
      else { u.fireAt = null; issueOrder(w, [u.id], { kind: "assault", x: tgt.ax, y: tgt.ay, target: tgt.id, pace: how.pace || (ARMS[u.arm].mounted ? "charge" : "quick"), ...(how.formation ? { formation: how.formation } : {}) }); }
    }
    const names = [...g.counts.keys()].map((a) => ARM_BY_ID[a]?.name).filter(Boolean).join(" & ");
    toast(`Attack the enemy ${names}!`); markers.ping(g.x, g.y);
  }
  const RANGE = { longbow: 230, crossbow: 190 };
  function followShooters(now = false) {
    for (const u of w.units.values()) {
      if (!u.fireAt || u.team !== PLAYER) continue;
      const t = w.units.get(u.fireAt);
      if (!t || !t.members.length || t.c?.broken) { u.fireAt = null; continue; }
      const A = ARMS[u.arm], R = (RANGE[A.missile] || 200) * 0.75, dx = t.ax - u.ax, dy = t.ay - u.ay, d = Math.hypot(dx, dy) || 1;
      // steer the target choice: this body, whenever it is in range and in sight
      if (u.c && d < R / 0.75) { u.c.mtgt = t; u.c.mT = w.time; }
      // keep it at a good shooting distance: close in if it's out of range, stand if it's in
      if (d > R * 1.15 || now) {
        const sx = t.ax - dx / d * R, sy = t.ay - dy / d * R;
        if (!u.order || Math.hypot((u.order.x ?? 0) - sx, (u.order.y ?? 0) - sy) > 25) { issueOrder(w, [u.id], { kind: "skirmish", x: sx, y: sy, facing: Math.atan2(dy, dx), pace: "quick", ...(u.atkForm ? { formation: u.atkForm } : {}) }); u.atkForm = null; }
      }
    }
  }
  w.systems.push((w) => { if (w.tick % 20 === 0) followShooters(); });
  function orderGroup(order, append = false) {
    const us = [...selected].map((id) => w.units.get(id)).filter(Boolean); if (!us.length) return 0;
    if (WORK.has(order.kind)) {
      if (order.kind !== "gather") { order.target = workTarget(order); if (!order.target) { toast(order.kind === "burn" ? "No enemy building there" : "No building site there"); return 0; } }
      if (order.kind === "burn" && !EC.BUILDINGS[order.target.kind].flammable) toast("Stone won't burn — they'll try to pull it down, slowly");
    }
    if (append) {
      let c = chainOfSelection();
      if (!c) { c = { units: new Set(us.map((u) => u.id)), steps: [], current: { ...(us[0].order || {}), x: us[0].order?.x ?? us[0].ax, y: us[0].order?.y ?? us[0].ay } }; chains.add(c); }
      c.steps.push(order);
      return c.steps.length + 1;
    }
    if (!append) for (const u of [...selected].map((id) => w.units.get(id)).filter(Boolean)) u.fireAt = null;
    // a new order replaces whatever they were doing (the owner changed his mind: no committed orders);
    // Shift / "Add as next step" still queues a chain
    for (const c of [...chains]) for (const u of us) if (c.units.has(u.id)) { for (const id of c.units) { const v = w.units.get(id); if (v) { v.helping = null; v.burning = null; } } }
    for (const c of [...chains]) for (const u of us) if (c.units.has(u.id)) { chains.delete(c); break; }
    const c = { units: new Set(us.map((u) => u.id)), steps: [], current: order, t0: w.tick }; chains.add(c);
    executeStep(us, order);
    return 1;
  }
  function executeStep(us, order) {
    if (WORK.has(order.kind)) return runWork(us, order);
    // fire orders change how the bows shoot, not where they stand (volley: at the enemy body clicked, else the ground)
    if (FIRE_ORDERS[order.kind]) {
      const tgt = [...w.units.values()].filter((v) => v.team !== PLAYER && v.members.length && !v.isWorkers).map((v) => [v, Math.hypot(v.ax - order.x, v.ay - order.y)]).filter(([, d]) => d < 30).sort((a, b) => a[1] - b[1])[0]?.[0];
      for (const u of us) if (setFireMode(w, u, FIRE_ORDERS[order.kind], order.kind === "volley" ? (tgt ? { unit: tgt.id } : { x: order.x, y: order.y }) : null)) u.fireAt = null;
      return;
    }
    // siege orders go to the very spot clicked (the wall section, the gate, the emplacement), not a formation slot
    if (SIEGE_ORDERS.has(order.kind)) { us.forEach((u, k) => issueOrder(w, [u.id], { ...order, x: order.x, y: order.y, facing: Math.atan2(order.y - u.ay, order.x - u.ax), pace: order.pace || (order.kind === "escalade" ? "quick" : "march") })); return; }
    let cx = 0, cy = 0, n = 0; for (const u of us) { cx += u.ax * u.members.length; cy += u.ay * u.members.length; n += u.members.length; }
    cx /= n; cy /= n;
    const facing = order.facing ?? (Math.hypot(order.x - cx, order.y - cy) > 5 ? Math.atan2(order.y - cy, order.x - cx) : (us[0].finalFacing ?? 0));
    if (order.formation) for (const u of us) u.formation = order.formation;
    // a frontage dragged out by the player: the line bodies (not horse, not engines) share it, each as deep as that makes it
    if (order.frontage) {
      const line = us.filter((u) => !ARMS[u.arm].mounted && !ARMS[u.arm].engine && !["wedge", "schiltron", "column"].includes(order.formation || u.formation));
      const men = line.reduce((a, u) => a + u.members.length, 0);
      for (const u of line) { const A = ARMS[u.arm], share = order.frontage * u.members.length / Math.max(1, men); const files = Math.max(2, Math.round(share / (A.spacing * (FORMATIONS[order.formation || u.formation]?.dense || 1)))); u._depth = Math.max(1, Math.ceil(u.members.length / files)); }
    }
    const slots = groupLayout(us, order.x, order.y, facing);
    for (const u of us) { const t = slots.get(u.id) || order, dep = u._depth; u._depth = undefined; issueOrder(w, [u.id], { ...order, x: t.x, y: t.y, facing, ...(dep ? { formation: order.formation || (u.formation === "column" ? "line" : u.formation), depth: dep } : {}) }); }
  }
  // a step is done when every unit has arrived (assaults: when no enemy is left near the objective)
  function stepDone(c, us) {
    const o = c.current;
    if (o.kind === "burn") return !o.target || o.target.ruin;
    if (o.kind === "build") return !o.target || o.target.progress >= 1 || us.every((u) => u.isWorkers && !u.job);
    if (o.kind === "gather") return true; // villagers settle into the work; the next step can follow
    if (FIRE_ORDERS[o.kind]) return true; // (a fire order is given, not walked to)
    if (SIEGE_ORDERS.has(o.kind)) return us.every((u) => { const e = engineOf(w, u); if (o.kind === "escalade") return !u.esc && u.order?.kind !== "escalade" && !u.pendingOrder; if (o.kind === "crew") return u.crewFor === undefined && !u.pendingOrder; if (!e) return true; return !u.pendingOrder && (o.kind === "assemble" ? e.state !== "packed" && e.state !== "assembling" : o.kind === "advance" ? !!e.docked || !e.tgt : !e.tgt); });
    if (o.kind === "assault") {
      for (const v of w.units.values()) if (v.team !== PLAYER && v.members.length && v.state !== "routing" && Math.hypot(v.ax - o.x, v.ay - o.y) < 150) return false;
      return true;
    }
    return us.every((u) => !u.path && Math.hypot(u.ax - (u.order?.x ?? u.ax), u.ay - (u.order?.y ?? u.ay)) < 20);
  }
  function advanceChains() {
    for (const c of [...chains]) {
      const us = [...c.units].map((id) => w.units.get(id)).filter((u) => u && u.members.length);
      if (!us.length || (!c.steps.length && stepDone(c, us))) { if (!c.steps.length) chains.delete(c); continue; }
      if (c.steps.length && stepDone(c, us)) { c.current = c.steps.shift(); executeStep(us, c.current); }
    }
  }
  // chain waypoints of the selection, for the markers
  function selectionChainPoints() {
    const c = chainOfSelection(); if (!c) return null;
    return [c.current, ...c.steps].map((o) => [o.x, o.y]);
  }

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
    if (!add) selected.clear();
    // everyone boxed becomes one new command group; if adding (shift), join the existing selection's group
    const gid = add && selected.size ? w.units.get([...selected][0])?.group ?? nextGroup++ : nextGroup++;
    for (const [uid, ids] of byUnit) {
      const u = w.units.get(uid); if (!u) continue;
      const nu = splitUnit(w, u, ids); nu.group = gid; selected.add(nu.id);
    }
    // same-type pieces inside one group merge back into a single body
    const byArm = new Map();
    for (const id of selected) { const u = w.units.get(id); if (!u) continue; const k = u.arm; if (!byArm.has(k)) byArm.set(k, []); byArm.get(k).push(u); }
    for (const us of byArm.values()) if (us.length > 1) { const keep = mergeUnits(w, us); for (const u of us) if (u !== keep) selected.delete(u.id); }
    refreshSel();
  }
  function groupNear(cx, cy) {
    let best = null, bd = 26;
    for (const g of groupsCache) {
      const p = toScreen(g.x, g.y, 4); const onLabel = Math.abs(p.x - cx) < 34 && Math.abs(p.y - 20 - cy) < 13; // the label box above the men
      const pm = toScreen(g.x, g.y); let dd = Math.min(Math.hypot(p.x - cx, p.y + 18 - cy), Math.hypot(pm.x - cx, pm.y - cy));
      if (onLabel) dd = Math.min(dd, 1);
      if (dd < bd) { bd = dd; best = g; best._label = onLabel; }
    }
    if (best) best._d = bd;
    return best;
  }

  // ---------------------------------------------------------------- the lord in the field (js/sim/avatar.js, js/ui/avatar-ui.js)
  lordUI = makeAvatarUI({ w, camera, canvas, scene, map, PLAYER, groundAt, toScreen, toast, log: logEv, bannerCanvas: drawBanner(mine, 128, 96), onOrders: (ids) => dropChains(ids), params, selected, refreshSel });
  // quick commands (control groups, whole army, form up, follow me, rally, find the lord), the controls hint, tips, courier lines
  const cmdKeys = makeCommandKeys({ w, PLAYER, selected, refreshSel, camera, toast, dropChains, toScreen, lordUI, params });

  // ---------------------------------------------------------------- HUD
  const selinfo = $("#selinfo"), selbar = $("#selbar");
  function refreshSel() {
    const us = [...selected].map((id) => w.units.get(id)).filter(Boolean);
    for (const id of [...selected]) if (!w.units.get(id)) selected.delete(id);
    if (!us.length) { selinfo.hidden = true; selbar.hidden = true; return; }
    const S = w.S; let men = 0, fat = 0, skill = 0;
    for (const u of us) for (const id of u.members) { men++; fat += S.fatigue[id]; skill += S.skill[id]; }
    const bar = (v) => `<div class="bar"><i style="width:${Math.round(v * 100)}%"></i></div>`;
    const kinds = us.map((u) => `<span class="kind">${glyphSVG(ARMS[u.arm].glyph)} ${ARMS[u.arm].name} ×${u.members.length}</span>`).join("");
    selinfo.innerHTML = `<h3>${men} men selected</h3><div class="kinds">${kinds}</div>
      <div class="row">Morale <b>${Math.round(avg(us.map((u) => u.morale)) * 100)}%</b></div>${bar(avg(us.map((u) => u.morale)))}
      <div class="row">Fatigue <b>${Math.round(fat / men * 100)}%</b></div>${bar(fat / men)}
      <div class="row">Average skill <b>${Math.round(skill / men * 100)}</b></div>
      <div class="row">Orders <b>${[...new Set(us.map((u) => ORDER_WORD[u.order?.kind] || "Holding"))].join(", ")}</b></div>`
      + us.map((u) => engineOf(w, u)).filter(Boolean).slice(0, 3).map((e) => { const I = engineInfo(w, e); return `<div class="engine"><div class="row"><b>${I.name}</b> · ${I.status}${I.fire > 0 ? ` · <span class="warn">burning</span>` : ""}</div>
        <div class="row">Crew <b>${I.crew}/${I.crewNeed}</b>${I.crew < I.crewMin ? ` <span class="warn">(needs ${I.crewMin} to work)</span>` : ""}${I.ammo !== null ? ` · ${I.ammoName} <b>${I.ammo}/${I.ammoMax}</b>` : ""}${I.range ? ` · range ${I.range[0]}–${I.range[1]} m` : ""}</div>
        <div class="row">Timbers</div>${bar(I.hp)}
        ${I.target ? `<div class="row">Target <b>${I.target}</b>${I.hitPct !== null ? ` · ${I.hitPct}% of stones strike` : ""}</div>${I.targetHp !== null ? bar(Math.max(0, I.targetHp)) : ""}` : ""}</div>`; }).join("");
    selinfo.hidden = false;
    const led = us.map((u) => cmd.delegatedBattle(u.id)).find(Boolean), sg = led && w.sagas.get(led.cmd.leader);
    const k = `${men}|${led?.id}`;
    if (selbar._k !== k) {
      selbar._k = k;
      selbar.innerHTML = led ? `<span class="led"><b>${men}</b> men — ${cmd.nm(led.cmd.leader)} commands them ${led.phrase} <i>(${sg ? cmd.dispName(sg) : ""})</i></span><button data-take>Take command</button><button data-desel>Deselect <kbd>X</kbd></button>`
        : `<span><b>${men}</b> men selected — click the ground to give an order</span><button data-desel>Deselect <kbd>X</kbd> / right-click</button>`;
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
      else if (e.kind === "unit-rallied" && mine && !battle) { const u = w.units.get(e.unit); if (u) logEv(`Our ${ARMS[u.arm].name.toLowerCase()} rally to the colours`, { x: u.ax, y: u.ay }); }
      else if (e.kind === "recruited" && mine) { toast("New troops mustered."); logEv(`${e.count} ${ARMS[e.arm]?.name || e.arm} mustered${b ? " at the " + bldName(b) : ""}`, pos); }
      else if (e.kind === "built" && mine) { toast("Construction complete."); logEv(`${bldName(b || { kind: e.what })} completed`, { ...pos, tone: "good" }); }
      else if (e.kind === "building-lost") {
        if (mine) { toast(`Our ${bldName(b)} is lost!`); logEv(`Our ${bldName(b)} is destroyed${b ? " " + at(b.x, b.y) : ""}`, { ...pos, tone: "bad" }); }
        else if (b && seen(b.x, b.y)) logEv(`${places.townName(e.team)}'s ${bldName(b)} is destroyed`, { ...pos, tone: "good" });
      }
      else if (e.kind === "fire" && mine && b) { toast(`Raiders have fired our ${bldName(b)}!`); logEv(`Raiders set our ${bldName(b)} alight`, { ...pos, tone: "bad" }); }
      else if (e.kind === "field-fired" && mine && b) { toast("Raiders are burning our fields!"); logEv(`Raiders fire our fields ${at(b.x, b.y)}`, { ...pos, tone: "bad" }); }
      else if (e.kind === "villagers-return" && mine) toast("Villagers finished your order — back to their usual work.");
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
  function drawLabels() {
    let n = 0;
    groupsCache = computeGroups(w);
    for (const g of groupsCache) {
      if (g.team !== PLAYER && V.teams[PLAYER][((g.y / V.cellM) | 0) * V.n + ((g.x / V.cellM) | 0)] !== 2) continue;
      const p = toScreen(g.x, g.y, 4); if (!p.front || p.x < -80 || p.y < -40 || p.x > innerWidth + 80 || p.y > innerHeight + 40) continue;
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
        el._k = key; el.className = "glab" + (sel ? " sel" : "") + (hunted ? " hunted" : "");
        el.innerHTML = parts.map(([arm, c]) => `<span class="gpart"><span class="gbadge t${g.team}">${glyphSVG(ARM_BY_ID[arm].glyph)}</span><span>×${c}</span></span>`).join("")
          + (lead ? `<span class="glead${lead.delegated ? " on" : ""}" title="${lead.delegated ? `${lead.name} is commanding this battle` : `Led by ${lead.name}`}">${PENNANT}${lead.name.split(" ")[0]}</span>` : "")
          + (g.state !== "formed" ? `<span class="st">${g.state}</span>` : "")
          + (scat ? `<span class="st" title="Out of their ranks: give any order (or U, form up) to re-form them">scattered</span>` : "")
          + (eta >= 0 ? `<span class="porder" title="An order is on its way (${po.channel})">${po.channel === "rider" ? "✉" : po.channel === "horn" ? "📯" : "🗣"} ${eta}s</span>` : "");
      }
      el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${(p.y - 20).toFixed(1)}px, 0) translate(-50%, -50%)`; el.hidden = false; n++;
    }
    for (let k = n; k < pool.length; k++) pool[k].hidden = true;
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
  const siegeEl = $("#siegebar"); let panelT = 0;
  let acc = 0, last = performance.now(), hudT = 0, benchRec = null, benchLast = 0; const benchPx = new Uint8Array(4);
  const benchFreeze = params.has("bench"); // render benchmarks: the sim holds still so every run sees the same scene
  function frame(now) {
    const f0 = performance.now();
    const dt = Math.min(0.25, (now - last) / 1000); last = now; if (!benchFreeze && !battle?.frozen && !siege?.frozen) acc += dt;
    while (acc >= TICK) { step(w); for (const G of generals) generalThink(w, G); if (reeve) reeveThink(w, reeve); acc -= TICK; }
    if (V.dirty) { V.dirty = false; fogTex.image.data.set(V.teams[PLAYER].map((v) => v * 127)); fogTex.needsUpdate = true; }
    const W = innerWidth, H = innerHeight; renderer.setSize(W, H, false);
    lordUI.frame(dt, acc); // (input → the lord's body; drives the camera while you are in his view)
    camera.update(dt, W / H);
    audio.update(dt);
    dots.material.uniforms.pxPerM.value = H / (2 * Math.tan(camera.cam.fov * Math.PI / 360));
    dots.material.uniforms.dpr.value = renderer.getPixelRatio();
    castles.update(w, camera, dt); // (before the figures: they stand at its levels and hide above its cut-away)
    figures?.update(w, camera.cam, selected, visibleFig, dt, acc, now / 1000);
    engines.update(w, w.time + acc * BATTLE_RATE, dt, camera.cam, (e) => e.team === PLAYER || canSee(V, PLAYER, e.x, e.y));
    dots.update(w, map, selected, visibleSoldier, figures?.fade);
    terr.uniforms.camPos.value.copy(camera.cam.position); terr.uniforms.time.value = now / 1000;
    advanceChains();
    markers.update(dt, w, selected, camera.st.dist, selectionChainPoints());
    tickFlags(now / 1000); fire.update(dt, w, camera.cam, H);
    spellfx.update(dt, w, camera.cam, H); terr.uniforms.mist.value = Math.max(spellfx.mist, battle?.env?.mist || 0);
    if (battle) { battle.frame(dt, camera, map); battle.frameMoments?.(dt); }
    siege?.frame?.(dt);
    props.update(camera.cam, dt);
    const fR = performance.now();
    renderer.render(scene, camera.cam);
    drawLabels(); cmdKeys.frame(dt);
    drainLog();
    if ((hudT += dt) > 0.5) { hudT = 0; if (selected.size) refreshSel();
      updateSiegeBar(siegeEl, w, PLAYER, places.townName); document.body.classList.toggle("sieging", !siegeEl.hidden);
      if (battle) battle.updateBar(); else if (siege) siege.updateBar?.(); else { watchHome(); checkMatch(); }
      if ((panelT += 0.5) >= 3) { panelT = 0; if (!bpanel.hidden && bpanel.querySelector("h3")?.textContent === "Commanders" && !bpanel.matches(":hover")) cmd.showPanel(bpanel, selected); } $("#clock").textContent = ""; renderResourceBar(resBar, w, PLAYER); blds.sync(w, map); paintClearings(); works.sync(w); }
    if (benchRec) { const gl = renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, benchPx); benchRec.push({ ms: performance.now() - f0, pre: fR - f0, iv: now - benchLast, tris: renderer.info.render.triangles, calls: renderer.info.render.calls }); }
    benchLast = now;
    if (!params.has("shot")) requestAnimationFrame(frame);
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
    const K = addUnit(w, { team: 1 - PLAYER, arm: "knights", count: +(params.get("kn") || 40), formation: "line", depth: 2, x: cx, y: cy + from, facing: Math.PI }); K.noAI = true;
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
  if (params.get("demo") === "plan") setTimeout(() => { placing = { kind: params.get("kind") || "barracks" }; markers.setPlan(slotsFor(w.plans[PLAYER], placing.kind)); }, 100);
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
    for (let t = 0; t < 600; t++) { step(w); for (const G of generals) generalThink(w, G); if (reeve) reeveThink(w, reeve); advanceChains();
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
    for (let t = 0; t < 300; t++) { step(w); advanceChains(); }
    const before = `helping ${m.helping} prog ${site.progress.toFixed(3)}`;
    const r = orderGroup({ kind: "move", x: m.ax + 200, y: m.ay + 100 });
    for (let t = 0; t < 400; t++) { step(w); advanceChains(); }
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
  // ---- the battle's frame: deployment, the moments, the verdict and the reckoning
  function battleUI() {
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
      showAftermath($("#modal"), { w, battle, story, map, onClose: () => {}, onAgain: () => { again(bcfg); location.reload(); }, onNew: () => { try { sessionStorage.removeItem("hg.again"); } catch { } location.href = location.pathname + "?mode=battle&banner=" + mine.id; } });
    };
    battle.reckon = reckon;
    makeMoments(battle, { camera, log: logEv, ping: (x, y) => markers.ping(x, y), seen: seenAt, PLAYER, onEnd: (O) => {
      if (ended) return; ended = true;
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
  if (params.has("shot")) setInterval(() => frame(performance.now()), 60); // headless checks get real frames
  else requestAnimationFrame(frame);
  // the first rendered frames are the slow ones (shaders compile, models upload): lift the curtain after them
  { let n = 0; const wait = () => { if (++n >= 8) { loadingStep("first"); hideLoading(); } else requestAnimationFrame(wait); }; requestAnimationFrame(wait); if (params.has("shot")) setTimeout(hideLoading, 1500); }
  // HG.bench(sec): real frame intervals + GPU-inclusive render time (gl.finish) for perf checks
  const bench = (sec = 5) => new Promise((res) => {
    const gl = renderer.getContext(), iv = [], rt = []; let t0 = performance.now(), last = t0;
    const r0 = renderer.render.bind(renderer);
    renderer.render = (sc, cm) => { const a = performance.now(); r0(sc, cm); gl.finish(); rt.push(performance.now() - a); };
    (function tick(t) { iv.push(t - last); last = t; if (t - t0 < sec * 1000) requestAnimationFrame(tick); else { renderer.render = r0;
      const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length, p = (a, q) => [...a].sort((x, y) => x - y)[Math.floor(a.length * q)];
      res({ fps: +(1000 / avg(iv.slice(2))).toFixed(1), renderMs: +avg(rt).toFixed(2), renderP95: +p(rt, 0.95).toFixed(2), frames: iv.length, figs: figures?.stats(), men: w.S.n, calls: renderer.info.render.calls, tris: renderer.info.render.triangles }); } })(last);
  });
  if (battle) battleUI();
  if (siege) siegeUI(w, siege, { camera, canvas, groundAt, toScreen, selected, refreshSel, toast, log: logEv, ping: (x, y) => markers.ping(x, y), lordUI, seen: (x, y) => canSee(V, PLAYER, x, y),
    onNew: () => { location.href = location.pathname + "?mode=siege&banner=" + mine.id; }, onAgain: () => { try { sessionStorage.setItem("hg.siegeAgain", JSON.stringify(scfg)); } catch { /* private mode */ } location.reload(); } });
  window.HG = { w, V, camera, selected, lordUI, cmdKeys, setOverlay, figures, bench, benchView, props, renderer, battle, castles, siege }; document.title = "HIGHGROUND · " + (map.meta?.name || "map"); // debug handle for headless checks
}

const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ---- the battle's configuration: the one to fight again, ?scenario=/?site= for headless checks, or the setup screen
function again(cfg) { try { sessionStorage.setItem("hg.again", JSON.stringify(cfg.kind === "scenario" ? { kind: "scenario", id: cfg.id, playerSide: cfg.playerSide, follow: cfg.follow } : { ...cfg, _tweaks: undefined, scenario: undefined })); } catch { /* private mode */ } }
// ---- the siege's configuration: the one to fight again, ?castle=hill|concentric|river[&side=defend][&force=small|strong|great]
// [&season=][&provision=][&relief] for headless checks, or the setup screen
async function siegeCfg(map, banners, places, castleApi) {
  let again0 = null; try { again0 = JSON.parse(sessionStorage.getItem("hg.siegeAgain") || "null"); sessionStorage.removeItem("hg.siegeAgain"); } catch { /* ignore */ }
  if (again0) return again0;
  const P = new URLSearchParams(location.search), layout = P.get("castle");
  if (layout && !P.has("setup")) { const F = SIEGE_FORCES[P.get("force") || "strong"] || SIEGE_FORCES.strong; return siegeConfig({ castle: layout, site: siteFor(map, layout, castleApi), side: P.get("side") === "defend" ? "defend" : "attack", garrison: F.garrison, besiegers: F.besiegers, train: F.train, season: P.get("season") || "summer", provision: +(P.get("provision") || 45), relief: P.has("relief"), lord: !P.has("nolord"), names: [places.townName(0), places.townName(1)], places }); }
  const ld = document.querySelector("#loading"); if (ld) ld.style.visibility = "hidden";
  const cfg = await chooseSiege(document.querySelector("#modal"), { map, banners, places, castleApi });
  if (ld) ld.style.visibility = "";
  return cfg;
}
async function battleConfig(map, banners, places) {
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
const PENNANT = `<svg viewBox="0 0 10 10"><path d="M2 .8v8.6" stroke="currentColor" stroke-width="1.3"/><path d="M2.6 1h6.4L7 3.2 9 5.4H2.6z" fill="currentColor"/></svg>`;
const clock = (t) => { const d = Math.floor(t / 86400), h = Math.floor(t / 3600 + 7) % 24, m = Math.floor(t / 60) % 60; return `Day ${d + 1} · ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`; };

addEventListener("error", (e) => { document.title = "ERR " + e.message + " @" + e.lineno; });
addEventListener("unhandledrejection", (e) => { document.title = "REJ " + (e.reason?.stack || e.reason); });
boot().catch((e) => { document.title = "ERR " + e.message; });
