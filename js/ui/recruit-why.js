// WHY a company can't be raised, and how to fix it (the owner: "I have 11 horses and hundreds of spears, but it is not giving me
// the option to make hoblers"). Every arm is drafted FROM the labourers of certain roles (econ-data RECRUITS.from) and fitted out
// from the store (gear). So the reasons are: no man of that role in the vill (and where such men come from: the training
// grounds, econ-data PRACTICE), or the store short of a piece of gear (and where it comes from). In the style of
// js/ui/workshop-why.js. Works on the realm's mirror too: the server sends the house's roles and training (server/views.mjs).
import * as EC from "../sim/economy.js";
import { sourceOf } from "./workshop-why.js";

const has = (w, team, kind) => w.buildings.some((b) => b.team === team && b.kind === kind && !b.ruin && b.progress >= 1);
const bname = (k) => EC.BUILDINGS[k]?.name || k;
// the house's labourers by role: the sim's own count, or (the realm) the server's
export function rolesOf(w, team) {
  const T = w.teams[team];
  if (w.econ?.role instanceof Map && !T.roles) return EC.roleCounts(w, team);
  return T.roles || {};
}
const trainingOf = (w, team) => (w.econ?.role instanceof Map && !w.teams[team].training ? EC.trainingOf(w, team) : w.teams[team].training || {});

const ONE = { spear: "trained spearman", rider: "rider", archer: "warbow archer", man: "able man", carpenter: "carpenter", smith: "smith", mason: "mason" };
const pct = (v) => `${Math.round(v * 100)}%`;
// how a house gets a man of this role
export function roleHow(w, team, role) {
  const P = Object.entries(EC.PRACTICE).find(([, p]) => p.role === role);
  const tr = trainingOf(w, team)[role];
  const prog = tr?.n ? ` ${tr.n} ${tr.n === 1 ? "man is" : "men are"} part-way there (the furthest ${pct(tr.best)}).` : "";
  if (P) {
    const [kind, p] = P, T = w.teams[team], days = EC.SLOW_TRAINING[role];
    const kit = p.gear ? ` Each needs ${p.gear === "horses" ? "a horse" : "a spear"} to hand in your store (you have ${Math.floor(T.store?.[p.gear] || 0)}).` : "";
    const where = has(w, team, kind) ? `your ${bname(kind)}` : `a ${bname(kind)} (build one)`;
    return `Men ${p.what}: put a crew on ${where} (its panel's Crew +, or select villagers and click it: Work here). A ${p.from.join(" or ")} who trains there every day becomes a ${ONE[role]} in about ${days} working days.${kit}${prog}`;
  }
  if (role === "man") return "Untrained men come with the families who settle in your empty houses (the keep's panel: where the people come from), and levies who are stood down go home as men (select a company: <i>Stand down</i> on the bar at the bottom).";
  if (EC.APPRENTICE_DAYS[role]) return `A man who works beside a ${role} learns the trade in about ${EC.APPRENTICE_DAYS[role]} working days.`;
  return "";
}
// how a house gets a piece of gear
export function gearHow(w, team, g) {
  if (g === "horses") return `${has(w, team, "paddock") ? "your Horse Paddock's stud foals every spring; the foals are broken to the saddle after a year" : "a Horse Paddock breeds them (foals in spring, broken to the saddle after a year)"}; or buy them at a market`;
  if (g === "destriers") {
    const st = EC.destrierStud(w, team), D = EC.E.destrier; // (buildings and store: the same on the realm's mirror)
    const lack = [!st.pads && "a Horse Paddock", !st.stables && "a finished Stables", st.herd < D.minHorses && `${D.minHorses} riding horses in store to pick the colts from (you have ${st.herd})`].filter(Boolean);
    return `great horses are bred at a Horse Paddock beside a Stables, with at least ${D.minHorses} good riding horses to pick the colts from: ${D.perPaddock} a year a paddock (two paddocks at most; twice that with a destrier of your own at stud), schooled ${Math.round(D.days / 365 * 10) / 10} years${lack.length ? ` — you still need ${lack.join(", ")}` : ""}; or buy them at a market (dear)`;
  }
  return sourceOf(w, team, g);
}

// men in the house's foot companies standing at a Siege Workshop, who could be put on an engine (economy.js
// engineHands). The realm's mirror carries the units and the buildings, so this reads the same there; if anything
// it needs is missing it simply answers nobody, and the panel falls back to the vill's labourers.
function companyHands(w, team, R) {
  try { return EC.engineHands(w, team, R).n; } catch { return 0; }
}

// → null (it can be raised) or { line } — why not, and how to fix it. can: the panel's count (the realm: the server's)
export function recruitWhy(w, team, arm, mount, can) {
  if (can >= 1) return null;
  const R = EC.RECRUITS[arm], T = w.teams[team]; if (!R || !T) return null;
  const parts = [];
  // the men
  if (R.from[0] === "squire") {
    if (!(T.squires >= 1)) {
      const riders = rolesOf(w, team).rider || 0, tilt = w.buildings.some((b) => b.team === team && b.kind === "stables" && b.tilt);
      parts.push(`<b>Knights need a squire</b> and you have none. ${tilt ? "One is at the tilt now. " : ""}A rider is schooled as a squire at your Stables (<i>School a squire</i>: ${EC.SLOW_TRAINING.knight} days)${riders ? ` — you have ${riders} rider${riders === 1 ? "" : "s"}` : `; you have no riders: ${roleHow(w, team, "rider")}`}`);
    }
  } else {
    const roles = rolesOf(w, team), need = R.perUnit ? R.crew : 1, men = R.from.reduce((s, r) => s + (roles[r] || 0), 0);
    const atYard = R.perUnit ? companyHands(w, team, R) : 0;
    if (men + atYard < need) {
      const who = R.from.map((r) => ONE[r] || r).join(" or ");
      const fix = R.from.filter((r) => r !== "man" || R.from.length === 1).map((r) => roleHow(w, team, r)).filter(Boolean);
      if (R.from.includes("man") && R.from.length > 1) fix.push(roleHow(w, team, "man"));
      // an engine draws on two pools, and the one players miss is the second: their own standing companies
      if (R.perUnit) {
        parts.push(`<b>Needs ${need} men to work it</b> and you can find ${men + atYard}. They come from two places. `
          + `<b>Out of the vill:</b> ${who} at their work — you have ${men}. ${fix.join(" ")} `
          + `<b>Or off the muster roll:</b> ${atYard ? `${atYard} men in your own foot companies are standing at this workshop and can be put straight on it — the men who go are stood down (their gear back to the store) and crewed in the same breath.` : `a foot company of yours standing within ${EC.ENGINE_DRAFT_R} m of this workshop can be put on it. March one here (levies, spearmen, pikemen — not horse) and the count rises.`}`);
      } else parts.push(`<b>Needs a ${who}</b>: your vill has none. ${fix.join(" ")}`);
    }
  }
  // the gear
  for (const [g, n] of Object.entries(R.gear)) {
    const mnt = mount && (g === "horses" || g === "destriers"), have = mnt ? T.mounts?.[mount] || 0 : T.store?.[g] || 0;
    if (have >= n) continue;
    parts.push(`<b>Short of ${mnt ? `trained ${mount}s` : g.replace(/_/g, " ")}</b> (${n} a ${R.perUnit ? "crew" : "man"}, you have ${Math.floor(have)}): ${mnt ? "capture young ones in the wild and break them at the stables" : gearHow(w, team, g)}.`);
  }
  return parts.length ? { line: parts.join(" ") } : null;
}
