// Sides: who fights whom, for any number of teams (the single-player game and battles have two; the realm has up to 8).
// The sim never takes "the enemy" as 1 − team: an enemy is a man of a team AT WAR with yours.
//
//   w.dip = { n, rel: Uint8Array(n·n), shield: Uint8Array(n), foe: Uint8Array(n·n), ver, foes: [[team…]…] }
//   rel[a·n+b]: the relation between two different teams (REL: war | truce | peace | alliance); every pair starts at war.
//   shield[t]: the team is out of the war for now (the realm's newcomer protection, an unclaimed hold's villagers): it
//     fights nobody and nobody fights it, whatever rel says.
//   foe[a·n+b] = 1 when a ≠ b, rel is war, and neither is shielded. The hot loops read this table directly.
//   ver: bumped on every change (combat.js re-derives its per-team "enemy" grids from it).
// Two teams at war (every battle and the single-player match): foe = [0,1,1,0], exactly the old "1 − team".
export const REL = { war: 0, truce: 1, peace: 2, alliance: 3 };
export const REL_NAME = ["war", "truce", "peace", "alliance"];

// the table for w's teams (grown to w.teams.length if teams were added)
export function sides(w) {
  const n = Math.max(2, w.teams?.length || 2);
  let D = w.dip;
  if (D && D.n === n) return D;
  const rel = new Uint8Array(n * n), shield = new Uint8Array(n);
  if (D) { for (let a = 0; a < D.n; a++) { shield[a] = D.shield[a]; for (let b = 0; b < D.n; b++) rel[a * n + b] = D.rel[a * D.n + b]; } }
  D = w.dip = { n, rel, shield, foe: new Uint8Array(n * n), ver: (D?.ver || 0) + 1, foes: [] };
  derive(D);
  return D;
}
function derive(D) {
  const n = D.n;
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) D.foe[a * n + b] = a !== b && D.rel[a * n + b] === REL.war && !D.shield[a] && !D.shield[b] ? 1 : 0;
  D.foes = []; for (let a = 0; a < n; a++) { const L = []; for (let b = 0; b < n; b++) if (D.foe[a * n + b]) L.push(b); D.foes.push(L); }
}

// are a and b at war (and neither shielded)? (teams outside the table: different teams are foes)
export function isFoe(w, a, b) {
  if (a === b) return false;
  const D = w.dip || sides(w);
  return a < D.n && b < D.n ? D.foe[a * D.n + b] === 1 : true;
}
// the teams at war with t
export function foesOf(w, t) { const D = sides(w); return D.foes[t] || []; }
export function relation(w, a, b) { const D = sides(w); return a === b ? "self" : REL_NAME[D.rel[a * D.n + b]]; }
export function setRelation(w, a, b, rel) {
  const D = sides(w), r = typeof rel === "number" ? rel : REL[rel];
  if (a === b || r === undefined || a >= D.n || b >= D.n) return false;
  if (D.rel[a * D.n + b] === r && D.rel[b * D.n + a] === r) return false;
  D.rel[a * D.n + b] = D.rel[b * D.n + a] = r; derive(D); D.ver++;
  return true;
}
export function setShield(w, t, on) {
  const D = sides(w); if (t >= D.n) return false;
  const v = on ? 1 : 0; if (D.shield[t] === v) return false;
  D.shield[t] = v; derive(D); D.ver++;
  return true;
}
export const shielded = (w, t) => { const D = sides(w); return t < D.n && D.shield[t] === 1; };
