// Historical battles on the Vale of Harrow. Each scenario reads the land for the ground its battle was fought on
// (a ridge with woods on the flanks, a narrow bridge over a deep river, a burn and a bog, a brook before a town
// militia) and draws up both hosts at playable scale with the historical proportions (about 1:25–1:30 of the
// real numbers; the densities follow docs/combat-research.md §17.2 and tools/scenarios-hist.mjs).
//
// Side 0 stands at fwd < 0 of the field frame, side 1 at fwd > 0 (js/sim/battlefield.js). The player chooses a
// side; the other is fought by the battle AI with the temper its commander really had.
import { findSite, riverAxis, zonesOf, frameOf, surveyField } from "./battlefield.js";

const c01 = (v) => Math.max(0, Math.min(1, v));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const towns = (map) => (map.meta?.features || []).filter((f) => f.type === "town_site").map((f) => ({ x: f.xy_m[0], y: f.xy_m[1], r: 750 }));

export const SCENARIOS = {
  crecy: {
    name: "Crécy", year: 1346, date: "26 August 1346", place: "the ridge between Crécy and Wadicourt, Ponthieu",
    kicker: "The Hundred Years' War",
    brief: "Edward III has turned at bay after a month's chevauchée through Normandy. His army waits on a slope with woods at its back, the men-at-arms dismounted in three battles, the archers on the wings, pits dug before them. Philip VI's host — Genoese crossbowmen in front, the flower of French chivalry behind — arrives late in the day after a storm, and the knights will not wait.",
    history: "The Genoese, their pavises still with the baggage, lost the archery duel in minutes and fell back; the French knights rode them down in their impatience and charged uphill again and again — fifteen times, the chroniclers say, until nightfall. The blind King John of Bohemia had his knights tie their reins to his so he could strike one blow. Some 1,500 French lords and knights died; the English lost perhaps a hundred.",
    sides: [
      { name: "the English", adj: "English", lord: "King Edward", temper: "defensive", flag: "england",
        win: "Hold the slope until nightfall, or break the French.",
        companies: [
          { arm: "menatarms", count: 40, formation: "deep", role: "centre", name: "the Prince's battle" },
          { arm: "menatarms", count: 40, formation: "deep", role: "centre", name: "Northampton's battle" },
          { arm: "spearmen", count: 40, role: "reserve", name: "the Welsh spears" },
          { arm: "archers", count: 50, role: "wing", fwd: 20 }, { arm: "archers", count: 50, role: "wing", fwd: 20 },
          { arm: "archers", count: 50, role: "wing", fwd: 20 }, { arm: "archers", count: 50, role: "wing", fwd: 20 },
          { arm: "knights", count: 12, role: "reserve", fwd: -80, name: "the King's household" },
        ] },
      { name: "the French", adj: "French", lord: "King Philip", temper: "aggressive", flag: "france",
        win: "Break the English line before nightfall.",
        companies: [
          { arm: "crossbow", count: 60, role: "front", name: "the Genoese" }, { arm: "crossbow", count: 60, role: "front", name: "the Genoese" },
          { arm: "knights", count: 30, role: "centre", formation: "line" }, { arm: "knights", count: 30, role: "centre", formation: "line" },
          { arm: "knights", count: 30, role: "centre", formation: "line" }, { arm: "knights", count: 30, role: "centre", formation: "line" },
          { arm: "knights", count: 30, role: "horse" }, { arm: "knights", count: 30, role: "horse" },
          { arm: "levy", count: 90, role: "reserve", name: "the commons" }, { arm: "levy", count: 90, role: "reserve", name: "the commons" },
        ] },
    ],
    playerSide: 0, weather: "clear", tod: "dusk", afterRain: 0.5, timeLimit: { min: 25, side: 0, why: "night fell with the English still on their slope" },
    pits: true,
    site(map) { // a slope rising toward side 0, woods on its flanks, open dry ground below it
      return findSite(map, (R) => clamp(R.rise[0], -5, 18) * 0.12 - Math.max(0, R.rise[0] - 24) * 0.1 - Math.max(0, R.rise[1]) * 0.06 + Math.min(0.6, R.woods.z0[0]) + Math.min(0.6, R.woods.z0[1])
        - R.water.across * 3 - R.marsh.mid * 3 - R.offMap * 0.05 - R.woods.mid * 2 - R.woods.in0 * 1.5 - R.woods.in1 * 1.5 + R.charge * 0.8 - R.steep * 8 - R.offMap * 0.2, { avoid: towns(map) });
    },
  },
  stirling: {
    name: "Stirling Bridge", year: 1297, date: "11 September 1297", place: "the Forth at Stirling",
    kicker: "The Wars of Scottish Independence",
    brief: "The English army of the Earl of Surrey must cross the Forth by a wooden bridge so narrow that two horsemen can barely ride abreast. On the far bank, on the high ground, Andrew Moray and William Wallace wait with the Scots foot. Treasurer Cressingham has refused to pay for a longer road round by the ford. The Scots need only pick their moment.",
    history: "The Scots let the English van cross all morning, then, when as many were over as they reckoned they could beat, came down and seized the bridge's end. The men across were cut off and slaughtered; Cressingham was killed and flayed. Surrey, watching from the south bank, had the bridge broken and fell back — leaving Scotland south of the Forth to the Scots.",
    sides: [
      { name: "the English", adj: "English", lord: "the Earl of Surrey", temper: "aggressive", flag: "england",
        win: "Get 200 men over the bridge and hold the far bank for four minutes, or break the Scots.",
        companies: [
          { arm: "knights", count: 30, role: "front", name: "Cressingham's horse" }, { arm: "knights", count: 30, role: "centre", formation: "line" },
          { arm: "menatarms", count: 40, role: "centre" }, { arm: "spearmen", count: 80, role: "centre", name: "the Welsh foot" },
          { arm: "spearmen", count: 80, role: "centre" }, { arm: "archers", count: 40, role: "wing", name: "the Welsh bows" },
        ] },
      { name: "the Scots", adj: "Scots", lord: "William Wallace", temper: "defensive", flag: "scotland",
        win: "Destroy the English who cross before they can form, or break their army.",
        companies: [
          { arm: "spearmen", count: 70, formation: "deep", role: "centre", name: "Moray's men" }, { arm: "spearmen", count: 70, formation: "deep", role: "centre", name: "Wallace's men" },
          { arm: "spearmen", count: 70, formation: "deep", role: "centre" }, { arm: "levy", count: 60, role: "reserve", name: "the small folk" },
          { arm: "hobelars", count: 12, role: "horse" },
        ] },
    ],
    playerSide: 1, weather: "clear", tod: "noon", bridge: true, objective: "bridgehead",
    site(map) { // the bridge site: a narrow deep reach with firm raised banks, read off the land
      const f = (map.meta?.features || []).find((q) => q.type === "bridge_site");
      let x = f?.xy_m[0], y = f?.xy_m[1];
      if (x === undefined) { // no marked site: the narrowest deep reach (deep water flanked by high, firm banks)
        const b = findSite(map, (R) => R.water.deepAcross * 3 - (R.crossings?.length || 0) - R.marsh.mid * 2, { step: 200 }); if (b) { x = b.site.x; y = b.site.y; }
      }
      let axis = riverAxis(map, x, y);
      const R = surveyField(map, { x, y }, axis, { coarse: true });
      if (R.zH[0] > R.zH[1]) axis += Math.PI; // the Scots (side 1) hold the higher bank
      return { site: { x, y }, axis, v: 1 };
    },
  },
  bannockburn: {
    name: "Bannockburn", year: 1314, date: "24 June 1314 (the second day)", place: "the Carse below Stirling",
    kicker: "The Wars of Scottish Independence",
    brief: "Edward II's great army spent the night on the Carse, the low ground between the Bannock Burn and the Pelstream, among pools and bog. At dawn Robert the Bruce's schiltrons come out of the New Park woods and advance on the English, who have no room to form. Their archers are behind the horse; their knights must charge a hedge of spears with the burn at their backs.",
    history: "The English van charged the schiltrons and could not break them; the archers who began to shoot into the Scots' flank were ridden down by Sir Robert Keith's light horse. Hemmed in, the English could not bring their numbers to bear. When the Scots camp followers — the 'small folk' — came over Gillies' Hill, the English took them for a fresh army. Pembroke led the King away by his bridle; the army broke, and many drowned in the Bannock Burn and the Forth.",
    sides: [
      { name: "the Scots", adj: "Scots", lord: "Robert the Bruce", temper: "inspiring", flag: "scotland", plan: "attack", // (Bruce came down on the English where they lay: battle.generalOf)
        win: "Break the English host.",
        companies: [
          { arm: "pikemen", count: 60, formation: "schiltron", role: "centre", name: "Edward Bruce's schiltron" }, { arm: "pikemen", count: 60, formation: "schiltron", role: "centre", name: "Randolph's schiltron" },
          { arm: "pikemen", count: 60, formation: "schiltron", role: "centre", name: "Douglas's schiltron" }, { arm: "pikemen", count: 60, formation: "schiltron", role: "reserve", name: "the King's schiltron" },
          { arm: "hobelars", count: 16, role: "horse", name: "Keith's horse" },
          { arm: "levy", count: 60, role: "hidden", name: "the small folk" },
        ] },
      { name: "the English", adj: "English", lord: "King Edward II", temper: "aggressive", flag: "england",
        win: "Break the schiltrons.",
        companies: [
          { arm: "knights", count: 25, role: "front", name: "Gloucester's van" }, { arm: "knights", count: 25, role: "front" }, { arm: "knights", count: 25, role: "horse" },
          { arm: "menatarms", count: 40, role: "centre" }, { arm: "spearmen", count: 60, role: "centre" }, { arm: "spearmen", count: 60, role: "centre" },
          { arm: "archers", count: 40, role: "reserve", rear: true, name: "the archers (behind the horse)" }, { arm: "archers", count: 40, role: "reserve", rear: true },
          { arm: "levy", count: 80, role: "reserve" },
        ] },
    ],
    playerSide: 0, weather: "clear", tod: "dawn", afterRain: 0.3,
    brooks: [{ fwd: 450, depth: 1.0, width: 8, name: "the Bannock Burn", unless: (R) => R.rear[1] > 0.15 }],
    site(map) { // the English (side 1) on low wet ground with water behind them; the Scots higher, woods at their back
      return findSite(map, (R) => R.rear[1] * 4 + R.inWater[1] * 1.2 + R.marsh.z1 * 3 + R.marsh.mid * 1 + clamp(R.rise[0] - R.rise[1], -10, 20) * 0.06
        + Math.min(0.6, Math.max(R.woods.z0[0], R.woods.z0[1])) * 0.8 - R.water.deepAcross * 5 - R.inWater[0] * 3 - R.woods.in1 * 2 - R.woods.mid * 1.5 - R.steep * 2 - R.offMap * 0.05, { avoid: towns(map), zoneWater: true });
    },
  },
  courtrai: {
    name: "Courtrai (the Golden Spurs)", year: 1302, date: "11 July 1302", place: "the Groeninge fields outside Kortrijk",
    kicker: "The Franco-Flemish War",
    brief: "The Flemish town militias — weavers and fullers with pikes and goedendags — stand behind the Groeninge brook with the river Lys at their backs: there is nowhere to run, and they have been ordered to take no prisoners. Robert of Artois brings the chivalry of France. His crossbowmen are winning the skirmish, but his knights want the glory for themselves.",
    history: "Artois called back his crossbowmen and sent the knights across the brooks. The horses floundered in the ditches and came up the far bank in disorder, straight into the Flemish pikes; unhorsed knights were killed with the goedendag. Artois himself was pulled down and killed. The French rear fled. Some 500 pairs of golden spurs were hung in the Church of Our Lady at Kortrijk.",
    sides: [
      { name: "the Flemings", adj: "Flemish", lord: "Guy of Namur", temper: "defensive", flag: "flanders", noQuarter: true, // (ordered to take no prisoners)
        win: "Destroy the French chivalry, or break their army.",
        companies: [
          { arm: "militia", count: 90, role: "centre", name: "the men of Bruges" }, { arm: "militia", count: 90, role: "centre", name: "the men of Bruges" },
          { arm: "militia", count: 90, role: "centre", name: "the Franc of Bruges" }, { arm: "militia", count: 90, role: "centre", name: "the men of Ypres" },
          { arm: "crossbow", count: 30, role: "front", name: "the town crossbows" }, { arm: "militia", count: 60, role: "reserve", name: "John of Renesse's reserve" },
        ] },
      { name: "the French", adj: "French", lord: "Robert of Artois", temper: "aggressive", flag: "france",
        win: "Break the Flemish line.",
        companies: [
          { arm: "crossbow", count: 50, role: "front" }, { arm: "crossbow", count: 50, role: "front" },
          { arm: "knights", count: 30, role: "centre", formation: "line" }, { arm: "knights", count: 30, role: "centre", formation: "line" },
          { arm: "knights", count: 30, role: "centre", formation: "line" }, { arm: "knights", count: 30, role: "horse", name: "Artois's battle" },
          { arm: "spearmen", count: 90, role: "reserve", name: "the sergeants" },
        ] },
    ],
    playerSide: 0, weather: "clear", tod: "noon", afterRain: 0.6,
    brooks: [{ fwd: -150, depth: 0.7, width: 7, name: "the Groeninge brook", banks: "ditch" }], // (its steep soft banks: battle.setupBattle)
    site(map) { // level open fields with deep water behind side 0 (the Lys) and soft ground between; the brook is cut across it
      return findSite(map, (R) => R.rear[0] * 3 + R.marsh.mid * 1.5 - R.water.across * 4 - R.woods.mid * 1.5 - R.woods.in0 - R.woods.in1 - R.inWater[0] * 2 - R.inWater[1] * 2
        - Math.abs(R.rise[0] - R.rise[1]) * 0.03 - R.steep * 2 + R.charge * 0.5 - R.offMap * 0.05, { avoid: towns(map) });
    },
  },
  agincourt: {
    name: "Agincourt", year: 1415, date: "25 October 1415 (St Crispin's Day)", place: "between the woods of Tramecourt and Agincourt",
    kicker: "The Hundred Years' War",
    brief: "Henry V's small, sick army has been cut off from Calais. It stands across a field of new-ploughed, rain-soaked ground between two woods, the archers on the flanks behind sharpened stakes. The French — three great battles of dismounted men-at-arms, with horse on the wings — must come to him across the mud, and the woods will squeeze them together as they come.",
    history: "Henry advanced his line into bowshot and the archers loosed. The French horse charged the flanks, failed against the stakes, and bolted back through their own men. The dismounted vanguard struggled across the mud under the arrow storm, bunching as the field narrowed, until the press was so great men could not lift their arms; the lightly armed archers fell on them with mallets and swords. The French lost perhaps 6,000 — the English a few hundred at most.",
    sides: [
      { name: "the English", adj: "English", lord: "King Henry", temper: "defensive", flag: "england",
        win: "Hold between the woods until nightfall, or break the French.",
        companies: [
          { arm: "menatarms", count: 30, formation: "deep", role: "centre", name: "the King's battle" }, { arm: "menatarms", count: 20, formation: "deep", role: "centre", name: "York's battle" },
          { arm: "archers", count: 45, role: "wing", stakes: true, fwd: 10 }, { arm: "archers", count: 45, role: "wing", stakes: true, fwd: 10 },
          { arm: "archers", count: 45, role: "wing", stakes: true, fwd: 10 }, { arm: "archers", count: 45, role: "wing", stakes: true, fwd: 10 },
        ] },
      { name: "the French", adj: "French", lord: "the Constable d'Albret", temper: "aggressive", flag: "france",
        win: "Break the English line before nightfall.",
        companies: [
          { arm: "menatarms", count: 90, formation: "deep", role: "centre", name: "the vanguard" }, { arm: "menatarms", count: 90, formation: "deep", role: "centre", name: "the vanguard" },
          { arm: "menatarms", count: 90, formation: "deep", role: "reserve", name: "the main battle" },
          { arm: "knights", count: 20, role: "horse", name: "Clignet's horse" }, { arm: "knights", count: 20, role: "horse", name: "Vendôme's horse" },
          { arm: "crossbow", count: 30, role: "reserve" },
        ] },
    ],
    playerSide: 0, weather: "overcast", tod: "noon", afterRain: 1.0, timeLimit: { min: 30, side: 0, why: "night fell with the English line unbroken" },
    site(map) { // a narrowing field between two woods, flat, with no water across it
      return findSite(map, (R) => Math.min(0.7, R.woods.z0[0]) + Math.min(0.7, R.woods.z0[1]) + Math.min(0.5, R.woods.z1[0]) * 0.5 + Math.min(0.5, R.woods.z1[1]) * 0.5
        + (Math.min(R.woods.z0[0], R.woods.z0[1]) > 0.2 ? 0.6 : 0) - Math.abs(R.rise[0]) * 0.02 - R.water.across * 3 - R.woods.mid * 2.5 - R.woods.in0 * 2 - R.marsh.mid - R.steep * 3 + R.charge * 0.3 - R.offMap * 0.05, { avoid: towns(map) });
    },
  },
};

// the historical scenario → a battle config (see js/ui/battle-setup.js for the custom one)
export function scenarioConfig(map, id, playerSide = null) {
  const S = SCENARIOS[id]; if (!S) return null;
  const ps = playerSide ?? S.playerSide;
  const found = S.site(map);
  const cfg = {
    kind: "scenario", id, name: `The Battle of ${S.name}`, year: S.year, site: found.site, axis: found.axis, playerSide: ps,
    sides: S.sides.map((d, k) => ({ ...d, companies: d.companies.map((c) => ({ ...c })), ai: k !== ps })),
    weather: S.weather, tod: S.tod, afterRain: S.afterRain || 0, bridge: !!S.bridge, pits: S.pits,
    brooks: (S.brooks || []).filter((b) => !b.unless || !b.unless(surveyField(map, found.site, found.axis, { coarse: true }))),
    objectives: {}, scenario: S,
  };
  if (S.timeLimit) cfg.objectives.timeLimit = { secs: S.timeLimit.min * 60, side: S.timeLimit.side, why: S.timeLimit.why };
  if (S.objective === "bridgehead") cfg.objectives.bridgehead = { side: 0, men: 200, secs: 240, beyond: 25 };
  return cfg;
}
export { zonesOf, frameOf };
