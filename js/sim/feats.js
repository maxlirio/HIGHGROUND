// Legendary-feat detection (docs/combat-research.md §15). A deed is legendary because it is improbable,
// not because it is big: each soldier's tallies are compared with a reference distribution measured in the
// calibration harness (js/sim/feat-ref.js, written by tools/feat-ref.mjs), and the tail probability p is
// what is reported. Tiers: notable p<1e-2, heroic p<1e-3, legendary p<1e-4, mythic p<1e-5.
// Emits {kind:'feat', who, p, tier, text, tag} when a man climbs into a higher tier; js/sim/legend.js turns
// feats into sagas and promotion offers.
import { ARM_BY_ID, armKey } from "./arms.js";
import { ST_FLEE, S_FIGHT } from "./soldiers.js";
import { REF } from "./feat-ref.js";

export const TIERS = [[1e-5, "mythic"], [1e-4, "legendary"], [1e-3, "heroic"], [1e-2, "notable"]];
const tierOf = (p) => { for (let k = 0; k < TIERS.length; k++) if (p < TIERS[k][0]) return 4 - k; return 0; };
export const TIER_NAME = ["", "notable", "heroic", "legendary", "mythic"];

// P(K ≥ k) for fighting kills (victims not running) by one man of this arm in one battle: the measured
// share of men with ≥1 kill, then a geometric tail fitted to the measured histogram.
export function killTail(armName, k) {
  if (k <= 0) return 1;
  const R = REF.kills[armName] || REF.kills._all;
  return Math.min(1, R.p1 * Math.pow(R.r, k - 1));
}
// P(a lone man lives through N attackers at once): the §17.3 odds curve shape, scaled to "survived" (not "won")
export function surroundTail(N) {
  if (N < 3) return 1;
  return Math.min(1, REF.surround?.[Math.min(N, 12)] ?? 0.5 * Math.exp(-1.1 * Math.min(N - 1, 6)) * Math.exp(-0.3 * Math.max(0, N - 7)) * 4);
}

export function featsTick(w, cs) {
  const S = w.S;
  const F = cs.feats || (cs.feats = { tier: new Map(), standT: new Float32Array(S.cap) });
  if (F.standT.length < S.cap) { const a = new Float32Array(S.cap); a.set(F.standT); F.standT = a; }
  // kills: checked when they happen
  for (const e of w.events) {
    if ((e.kind === "kill" || e.kind === "down") && e.by >= 0 && !e.fleeing && e.cause === "melee" && S.alive[e.by]) {
      const a = e.by, arm = armKey(S.arm[a]), k = S.mkills[a]; // hand-to-hand only: an arrow into a crowd is not a deed
      const p = killTail(arm, k);
      award(w, F, a, p, `felled ${k} men in the press`, ARM_BY_ID[S.arm[a]].mounted ? "shock" : "aggressive");
    }
  }
  // surrounded and still standing, and standing fast while the unit broke (checked every 2 s)
  if (w.tick % 5) return;
  const dt = 5 * (w.time / Math.max(1, w.tick));
  for (let i = 0; i < S.n; i++) {
    if (!S.alive[i] || S.status[i] === ST_FLEE) { F.standT[i] = 0; continue; }
    const n = cs.nAtk[i];
    if (n > S.maxAtk[i] && S.state[i] === S_FIGHT) S.maxAtk[i] = n;
    if (S.maxAtk[i] >= 4 && n === 0 && S.maxAtk[i] > (F.tier.get(i)?.surround || 0)) {
      const N = S.maxAtk[i], p = surroundTail(N);
      const T = F.tier.get(i) || {}; T.surround = N; F.tier.set(i, T);
      award(w, F, i, p, `lived through ${N} enemies at once`, "defensive");
    }
    const u = w.units.get(S.unit[i]);
    if (u?.c?.broken && S.state[i] === S_FIGHT) {
      F.standT[i] += dt;
      const s = F.standT[i];
      if (s > 45) award(w, F, i, Math.pow(0.01, s / 60), `stood his ground ${Math.round(s)} s after his company broke`, "defensive");
    } else F.standT[i] = 0;
  }
}

function award(w, F, id, p, text, tag) {
  const tier = tierOf(p); if (!tier) return;
  const T = F.tier.get(id) || {};
  if ((T.top || 0) >= tier) return; // only a climb into a higher tier is news
  T.top = Math.max(T.top || 0, tier); T.p = Math.min(T.p ?? 1, p); F.tier.set(id, T);
  w.events.push({ t: w.tick, kind: "feat", who: id, p, tier: TIER_NAME[tier], text, tag, team: w.S.team[id] });
}
