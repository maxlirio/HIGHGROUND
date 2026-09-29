// Calibration bands (docs/combat-research.md §17) and the jobs that measure them.
const range = (n, from = +(process.env.SEED0 || 1)) => Array.from({ length: n }, (_, k) => from + k);
const vals = (rs, k) => rs.map((r) => r[k]).filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
export const median = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b.length & 1 ? b[b.length >> 1] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2; };
const decided = (rs) => rs.filter((r) => !r.draw);
const pctile = (a, p) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };

export function JOBS(seeds, quick) {
  const s = (n) => range(n);
  return [
    { name: "line", group: "17.1", seeds: s(seeds) },
    { name: "mirror", group: "17.1", seeds: s(seeds) },
    { name: "line_cav", group: "17.1", seeds: s(Math.ceil(seeds / 2)) },
    // (trapped and shock run the full seed count: their medians sit within a few % of a band edge, and 24 runs
    // left them flickering across it from one change to the next — more runs, same band)
    { name: "trapped", group: "17.1", seeds: s(seeds) },
    { name: "shock", group: "17.1", seeds: s(seeds) },
    { name: "pike_cav", group: "17.2", seeds: s(Math.ceil(seeds / 2)) },
    { name: "cav_disordered", group: "17.2", seeds: s(Math.ceil(seeds / 2)) },
    { name: "crecy", group: "17.2", seeds: s(quick ? 4 : Math.max(8, seeds >> 3)) },
    { name: "agincourt", group: "17.2", seeds: s(quick ? 4 : Math.max(8, seeds >> 3)) },
    { name: "courtrai", group: "17.2", seeds: s(quick ? 4 : Math.max(8, seeds >> 3)) },
    { name: "stirling", group: "17.2", seeds: s(quick ? 4 : Math.max(8, seeds >> 3)) },
    { name: "bannockburn", group: "17.2", seeds: s(quick ? 4 : Math.max(8, seeds >> 3)) },
    { name: "odds", group: "17.3", seeds: range(quick ? 10 : 40) },
    { name: "maa_levy", group: "17.3", seeds: range(quick ? 5 : 20) },
    { name: "missile_foot", group: "17.4", seeds: s(quick ? 6 : 24) },
    { name: "missile_strike200", group: "17.4", seeds: s(quick ? 4 : 12) },
    { name: "missile_maa", group: "17.4", seeds: s(quick ? 6 : 24) },
    { name: "missile_horse", group: "17.4", seeds: s(quick ? 6 : 24) },
    { name: "xbow_longbow", group: "17.4", seeds: s(quick ? 8 : 40) },
  ];
}

// binomial: band widened to ±2σ for the number of decided runs
const B = (sec, scenario, name, band, value, fmt = "pct", note = null, binom = false) => ({ sec, scenario, name, band, value, fmt, note, binom, group: sec.startsWith("17.1") ? "17.1" : sec.startsWith("17.2") ? "17.2" : sec.startsWith("17.3") ? "17.3" : "17.4" });

export const BANDS = [
  // ---- §17.1 global invariants
  B("17.1", "mirror", "Mirror (identical men): south side loses (50 % ± 2σ)", [0.5, 0.5], (rs) => mean(vals(decided(rs), "southLost")), "pct", (rs) => `draws ${rs.filter((r) => r.draw).length}`, true),
  B("17.1", "mirror", "Mirror (identical men): team 0 loses (50 % ± 2σ)", [0.5, 0.5], (rs) => mean(vals(decided(rs), "team0Lost")), "pct", null, true),
  B("17.1", "line", "Victor fatalities (killed + mortal), median", [0.01, 0.05], (rs) => median(vals(decided(rs), "victorFatal"))),
  B("17.1", "line", "Loser fatalities, ordinary rout (foot pursuit), median", [0.08, 0.20], (rs) => median(vals(decided(rs), "loserFatal"))),
  B("17.1", "line_cav", "Loser fatalities, pursued by fresh cavalry, median", [0.30, 0.80], (rs) => median(vals(decided(rs), "loserFatal"))),
  B("17.1", "trapped", "Loser fatalities, trapped against a river, median", [0.30, 0.80], (rs) => median(vals(decided(rs), "loserFatal"))),
  B("17.1", "line", "Share of loser deaths after the break", [0.60, 0.90], (rs) => median(vals(decided(rs), "afterBreakShare"))),
  B("17.1", "line", "Line-fight duration before a break, median", [30, 180], (rs) => median(vals(decided(rs), "duration")), "min"),
  B("17.1", "line", "Contact (flurry) fraction of that duration", [0.10, 0.30], (rs) => median(vals(decided(rs), "flurryFrac"))),
  B("§0", "line", "Flurry (pulse) length, median of battle means (10–60 s, mean ≈25)", [10, 60], (rs) => median(vals(decided(rs), "meanFlurry")), "s"),
  B("§0", "line", "Lull length, median of battle means (1–5 min, mean ≈2.5)", [60, 300], (rs) => median(vals(decided(rs), "meanLull")), "s"),
  B("17.1", "line", "Unit losses at the moment of breaking, median", [0.05, 0.15], (rs) => median(vals(decided(rs), "lossAtBreak"))),
  B("17.1", "shock", "Decided at first shock, large morale gap", [0.30, 0.50], (rs) => mean(vals(decided(rs), "firstShock"))),
  B("17.1", "line", "Decided at first shock, equal veterans (<10 %)", [0, 0.10], (rs) => mean(vals(decided(rs), "firstShock"))),
  // ---- §17.2 scenario benchmarks
  B("17.2", "crecy", "Crécy: attacker:defender deaths ≥ 10:1", [10, 1e9], (rs) => median(vals(rs, "ratio")), "x"),
  B("17.2", "crecy", "Crécy: ≥ 10 repeated charges before exhaustion", [10, 1e9], (rs) => median(vals(rs, "charges")), "x"),
  B("17.2", "agincourt", "Agincourt: French:English deaths ≈ 10:1 (≥ 6)", [6, 1e9], (rs) => median(vals(rs, "ratio")), "x"),
  B("17.2", "agincourt", "Agincourt: pile-ups form (≥ 5 fallen within 1.5 m), share of runs", [0.5, 1], (rs) => mean(vals(rs, "pileup"))),
  B("17.2", "agincourt", "Agincourt: archers join the melee after ammo is spent, share of runs", [0.5, 1], (rs) => mean(vals(rs, "archersMelee"))),
  B("17.2", "courtrai", "Courtrai: charging knights killed", [0.30, 0.90], (rs) => median(vals(rs, "knightsDead"))),
  B("17.2", "courtrai", "Courtrai: horses refuse or fall at the ditches (share of riders)", [0.30, 1], (rs) => median(vals(rs, "refuseOrFall"))),
  B("17.2", "stirling", "Stirling Bridge: bridgehead killed or drowned", [0.60, 1], (rs) => median(vals(rs, "bridgeheadLost"))),
  B("17.2", "stirling", "Stirling Bridge: far bank cannot reinforce (crossers after the attack ≤ 10 %)", [0, 0.10], (rs) => median(vals(rs, "reinforced"))),
  B("17.2", "bannockburn", "Bannockburn: cavalry charges fail against schiltrons (share of runs)", [0.8, 1], (rs) => mean(vals(rs, "chargesFailed"))),
  B("17.2", "bannockburn", "Bannockburn: English infantry losses in the rout", [0.40, 1], (rs) => median(vals(rs, "infLoss"))),
  B("17.2", "pike_cav", "Steady pike vs frontal cavalry: horse contact", [0, 0.10], (rs) => median(vals(rs, "contact"))),
  B("17.2", "pike_cav", "Steady pike vs frontal cavalry: breakthrough", [0, 0.05], (rs) => median(vals(rs, "breakthrough"))),
  B("17.2", "cav_disordered", "Cavalry vs disordered infantry: breaks it (share of runs)", [0.70, 1], (rs) => mean(vals(rs, "broke"))),
  // ---- §17.3 odds curve
  ...[1, 2, 3, 5, 7, 10, 20].map((N, k) => B("17.3", "odds", `P(1 man beats ${N}) (equal mail & skill)`, [[0.4, 0.6], [0.12, 0.2], [0.03, 0.08], [2e-3, 1e-2], [3e-4, 1.5e-3], [1e-4, 5e-4], [1e-5, 1e-4]][k], (rs) => oddsP(rs, N), "exp", (rs) => oddsNote(rs, N))),
  B("17.3", "maa_levy", "MAA (plate-ish, skill 0.8) vs 1 levy", [0.85, 0.95], (rs) => oddsP(rs, "maa1")),
  B("17.3", "maa_levy", "MAA vs 3 levies (pulled down, daggered in the gaps)", [0.30, 0.50], (rs) => oddsP(rs, "maa3")),
  // ---- §17.4 missiles
  B("17.4", "missile_foot", "Archers 150–200 m vs gambeson foot: incap per 1,000 arrows per 100 m", [0.03, 0.08], (rs) => median(vals(rs, "incapPer1000"))),
  B("17.4", "missile_strike200", "Share of arrows striking a man at 200 m into 1.2 men/m² (25–35 %)", [0.25, 0.35], (rs) => median(vals(rs, "strikeShare"))),
  B("17.4", "missile_maa", "Vs mail + gambeson men-at-arms: incap per 1,000 arrows", [0, 0.01], (rs) => median(vals(rs, "incapPer1000"))),
  B("17.4", "missile_horse", "Vs unbarded horses: horses down/bolting per 1,000 arrows", [0.05, 0.15], (rs) => median(vals(rs, "horsePer1000"))),
  B("17.4", "xbow_longbow", "Crossbow (no pavise) vs longbow at 150 m: crossbows break first", [0.80, 1], (rs) => mean(vals(rs, "xbowBrokeFirst"))),
];

// odds results come back as { key, trials, wins, weight2 } per seed-batch; combine to a single estimate
function oddsAgg(rs, key) {
  let w = 0, n = 0, d = 0, e2 = 0, k = 0;
  for (const r of rs) { const o = r[key]; if (!o) continue; w += o.w; n += o.n; d += o.d || 0; e2 += o.w2 || 0; k++; }
  return { p: n ? w / n : null, n, d: k ? d / k : 0, se: n ? Math.sqrt(Math.max(0, e2 / n - (w / n) ** 2) / n) : 0 };
}
function oddsP(rs, key) { return oddsAgg(rs, key).p; }
function oddsNote(rs, key) { const a = oddsAgg(rs, key); return a.n ? `±${a.se.toExponential(1)} (${Math.round(a.n)} decided duels, draws ${(a.d * 100).toFixed(0)}%)` : ""; }
