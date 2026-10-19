// MOUNTS — what a cavalry company rides (owner: "ostriches your civilization can learn to ride instead of
// horses, or large lizards … each different thing has different strengths"). DATA + tiny pure helpers only.
// Index-aligned with kit.js HORSES (per-soldier S.horse): 0 none, 1 rouncey, 2 destrier, 3 strider, 4 drake.
//
// CALIBRATION CONTRACT: the HORSE rows (1, 2) are EXACTLY NEUTRAL — every multiplier 1, every additive 0 —
// and every new code branch in the sim is gated so a world where every rider is a horse stays byte-identical
// with the pre-mounts tree (battle-mc's 39/42 set is the acceptance bar; x*1 === x in IEEE 754, so a
// multiplicative knob whose horse value is exactly 1 is safe; anything else must be behind `idx >= MNT_STRIDER`).
//
// Tame→train→ride: wild juveniles are CAPTURED (wildlife lane, docs/mounts-wildlife-spec.md) into the stables'
// pens (b.pens), a handler trains each over trainDays (b.train) into the town's stock (T.mounts) and the first
// one founds the tradition (T.tradition) — from then on the stables offers that mount for new cavalry and for
// retraining standing companies.

const NEUTRAL = {
  speed: 1,        // × ARMS.run (gallop), everywhere a mounted man's speed is read
  speedArmoured: 1,// × run instead of `speed` for riders in heavy harness (armour ≥ 4)
  accel: 1,        // × CAV.accel gathering the gallop
  shock: 1,        // × knock-down P at impact and trample blow energy (mass already does its own work)
  refuse: 1,       // × P(refuse) at a braced line — <1 presses home where a horse shies (pikes still hurt it)
  hedgeKeep: 0.25, // speed kept running onto a pike hedge (horse: CAV.hedge)
  spearKeep: 0.6,  // speed kept over one braced spear (horse: CAV.spearCheck)
  dread: 1,        // × the stress the watching infantry take as the charge comes on (MOR.cavCharge)
  fearHit: 0,      // stress burst to enemies within fearR of the first man struck (drake terror; horse 0)
  fearR: 0,
  fearCap: 0,      // the terror alone lifts a man's stress no higher than this (drake: wavering, never shaken)
  fright: 1,       // × hfright a wound gives the mount (melee.horseWound): >1 bolts easier
  missileBody: 0.6,// share of shafts at a rider that take the mount (ballistics zone pick; horse 0.6)
  hide: [1, 1, 1, 1], // × natural-hide energy absorption per mode [cut, thrust, bodkin, broad] (wounds.penetrateHorse HIDE.pen)
  soft: 1,         // × the chargeViable threshold below which the gallop is forbidden (strider <1: soft ground barely checks it)
  mire: 1,         // share of the cavalry-class terrain penalty felt (goingMul; strider 0.35: marsh/scrub barely slow it)
  swim: 0,         // speed multiplier in swimming-deep water (horse: 0.03 hard-coded; drake paddles at 0.25)
  winter: 1,       // × speed in snow / deep winter (mountWeatherMul)
};

export const MNT_STRIDER = 3, MNT_DRAKE = 4;
export const MOUNTS = [
  null,
  { ...NEUTRAL, key: "rouncey", mount: "horse", name: "Horse" },
  { ...NEUTRAL, key: "destrier", mount: "horse", name: "Horse" },
  { ...NEUTRAL, key: "strider", mount: "strider", name: "Strider",
    arms: ["hobelars", "scouts"],         // light riders only: a strider will not carry a man in harness
    // much faster, cheap to keep, light riders only, weak shock, agile in bad going, flighty under wounds
    speed: 1.28, speedArmoured: 1.12, accel: 1.3,
    shock: 0.55, refuse: 1.05, hedgeKeep: 0.18, spearKeep: 0.5,
    dread: 0.8, fright: 1.7,
    missileBody: 0.45, hide: [0.7, 0.7, 0.6, 0.6],         // small body: more shafts find the (unbarded) rider; thin feathers
    soft: 0.25, mire: 0.35,               // marsh and scrub barely slow it
    feed: { grain: 2 },                   // kg grain/day — no hay, no fodder train
    trainDays: 12,
    blurb: "Much faster and cheap to keep — grain, no fodder. Light in the strike and shy of a wound, but marsh and scrub barely slow it: made for raids, flanks and riding down routers." },
  { ...NEUTRAL, key: "drake", mount: "drake", name: "Drake",
    arms: ["knights"],                    // the heavy horse's place: a drake is for the lance
    // slower, heavily built: hard shock + terror at impact, thick hide, presses pikes further (not through),
    // swims slowly, hates winter, eats meat
    speed: 0.78, speedArmoured: 0.78, accel: 0.8,
    shock: 1.4, refuse: 0.84, hedgeKeep: 0.34, spearKeep: 0.72,
    dread: 1.35, fearHit: 0.025, fearR: 6, fearCap: 0.5, fright: 0.5,
    missileBody: 0.7, hide: [2, 1.5, 6, 6],   // scaled hide: worth a bard against the shafts, far less against a driven point or an edge (pikes still bite)
    soft: 1, mire: 1.05, swim: 0.25, winter: 0.75,
    feed: { meat: 6 },                    // kg fresh meat/day: the larder and the flocks pay for it
    trainDays: 25,
    blurb: "Slow, heavily built and terrible in the strike — men waver where it lands. Thick hide turns arrows; it presses a pike hedge further than any horse (and still bleeds for it). Swims rivers slowly, sulks in winter, and eats meat." },
];
export const MOUNT_ID = { horse: 0, strider: MNT_STRIDER, drake: MNT_DRAKE }; // unit option → S.horse index (0 = the arm's own horse)

// hot-path lookup tables (Float64 so `x * T[idx]` with a horse stays exact)
const tab = (f) => Float64Array.from(MOUNTS, (m) => (m ? f(m) : 0));
export const M_SPD = tab((m) => m.speed), M_SPDA = tab((m) => m.speedArmoured), M_ACC = tab((m) => m.accel);
export const M_SHK = tab((m) => m.shock), M_REF = tab((m) => m.refuse);
export const M_HDG = tab((m) => m.hedgeKeep), M_SPR = tab((m) => m.spearKeep);
export const M_DRD = tab((m) => m.dread), M_FRT = tab((m) => m.fright);
export const M_BODY = tab((m) => m.missileBody), M_SOFT = tab((m) => m.soft);
// hide per wound mode, flattened [idx*4 + mode] so a horse stays exact (×1)
export const M_HIDE = Float64Array.from(MOUNTS.flatMap((m) => (m ? (Array.isArray(m.hide) ? m.hide : [m.hide, m.hide, m.hide, m.hide]) : [0, 0, 0, 0])));

export const mountSpeed = (S, i) => (S.armour[i] >= 4 ? M_SPDA : M_SPD)[S.horse[i]] || 1;

// the drake hates winter: snowy weather, or the dead of the year on the economic calendar
export function mountWeatherMul(w, idx) {
  if (idx !== MNT_DRAKE) return 1;
  const wk = w.weather;
  if (typeof wk === "string" && (wk.startsWith("snow") || wk.startsWith("froz") || wk === "blizzard")) return MOUNTS[MNT_DRAKE].winter;
  const doy = w.econ?.doy;
  const yd = doy === undefined ? undefined : (((doy) % 365) + 365) % 365;
  return yd !== undefined && (yd < 46 || yd > 320) ? 0.85 : 1;
}

// give soldier id this mount's body (spawn-equivalent; used when a standing company is retrained)
export function remount(S, rng, id, idx, HORSES) {
  const H = HORSES[idx];
  S.horse[id] = idx; S.horseOK[id] = 1; S.hfright[id] = 0;
  S.hmass[id] = H.mass * (0.9 + 0.2 * rng.next());
  S.hwp[id] = H.gallopM * (0.8 + 0.4 * rng.next()); S.hwbal[id] = S.hwp[id];
  S.kitMask[id] &= ~(1 << 30); // barding is a horse's harness
  if (H.barding.length > 1 && rng.next() < H.barding[0][1]) S.kitMask[id] |= 1 << 30;
}

// what a unit option string means for ARMS[arm]: 0 = keep the arm's own horse
export const mountIdxFor = (mount) => MOUNT_ID[mount] || 0;
// may this arm ride that mount? (a horse always; a learned mount only for the arms it suits — MOUNTS[].arms)
export const mountFits = (arm, mount) => { const m = MOUNTS[MOUNT_ID[mount] || 0]; return !m || !m.arms || m.arms.includes(arm); };
export const mountName = (idx) => MOUNTS[idx]?.name || "Horse";
