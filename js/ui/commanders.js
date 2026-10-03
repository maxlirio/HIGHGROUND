// Commanders & delegation (roadmap: "whenever a battle begins you can direct it yourself or leave it to
// them"). Watches for our men coming into contact (a seen enemy body within CONTACT m); if a captain of
// ours (legend rank ≥3, with a disposition) is with or near that force, a small prompt offers the battle to
// him. Left to him, the force is run by commandBattle with HIS disposition until the fighting is over, he
// falls, or we take command back. The Commanders panel lists every captain: rank, disposition, gifts,
// where he is and which men follow him; a captain can be given the selected group to lead.
import { commandBattle } from "../sim/commander-ai.js";
import { ABILITIES, DISPOSITIONS, nameOf } from "../sim/legend.js";
import { ARMS, ARM_BY_ID } from "../sim/arms.js";
import { canSee } from "../sim/vision.js";
import { groupIdOf } from "./groups.js";
import { S_GONE } from "../sim/economy.js";

const CONTACT = 250;    // m: a seen enemy body this close to one of ours is a battle
const JOIN = 700;       // m: contacts this close to a running battle are part of it
const FORCE_R = 400;    // m: our companies this close to the contact are "the force"
const NEAR_CAPTAIN = 500; // m: a captain this close to the fighting can take it
const QUIET_T = 600;    // ticks (60 real s) without contact: the battle is over
const PROMPT_T = 25000; // ms the prompt waits before you are taken to command it yourself
const RANKS = ["", "Veteran", "Champion", "Captain"];

export function makeCommand(w, { PLAYER, V, places, toast, log, focus, onDelegate, promptEl, promptMs = PROMPT_T }) {
  const S = w.S;
  const battles = []; let seq = 1;
  const byUnit = new Map(); // unitId → battle (delegated only)
  const pending = []; let promptOpen = null;

  const captains = () => {
    const out = [];
    for (const [id, sg] of w.sagas || []) if (sg.rank >= 3 && sg.disposition && S.alive[id] && S.team[id] === PLAYER) out.push({ id, sg });
    return out.sort((a, b) => b.sg.score - a.sg.score);
  };
  const legends = (team = PLAYER) => { const out = []; for (const [id, sg] of w.sagas || []) if (sg.rank >= 1 && S.alive[id] && S.team[id] === team) out.push({ id, sg }); return out.sort((a, b) => b.sg.rank - a.sg.rank || b.sg.score - a.sg.score); };
  const nm = (id) => nameOf(S.name[id]);
  const dispName = (sg) => DISPOSITIONS[sg.disposition]?.name || sg.disposition;
  const ledBy = (id) => { const out = []; for (const u of w.units.values()) if (u.leader === id && u.team === PLAYER && u.members.length) out.push(u); return out; };
  const soldiers = () => { const out = []; for (const u of w.units.values()) if (u.team === PLAYER && !u.isWorkers && u.members.length) out.push(u); return out; };

  // ---------------------------------------------------------------- the watch (a sim system: deterministic, runs in headless demos too)
  function system(w) {
    for (const b of battles) if (b.cmd && !b.over) runDelegated(b);
    if (w.tick % 10) return;
    const mine = soldiers(); if (!mine.length) return;
    const foes = []; for (const v of w.units.values()) if (v.team !== PLAYER && !v.isWorkers && v.members.length >= 3 && canSee(V, PLAYER, v.ax, v.ay)) foes.push(v);
    for (const u of mine) {
      let f = null, fd = CONTACT;
      for (const v of foes) { const d = Math.hypot(v.ax - u.ax, v.ay - u.ay); if (d < fd) { fd = d; f = v; } }
      if (!f) continue;
      const cx = (u.ax + f.ax) / 2, cy = (u.ay + f.ay) / 2;
      let b = battles.find((x) => !x.over && Math.hypot(x.x - cx, x.y - cy) < JOIN);
      if (!b) b = openBattle(cx, cy, u, f);
      b.last = w.tick; b.units.add(u.id); b.foes.add(f.id);
      if (b.cmd) { b.cmd.units.add(u.id); byUnit.set(u.id, b); }
    }
    for (const b of battles) if (!b.over && w.tick - b.last > QUIET_T) closeBattle(b);
  }

  function openBattle(x, y, u, f) {
    const P = places.at(x, y);
    const b = { id: seq++, x, y, place: P.name, phrase: P.phrase, t0: w.tick, last: w.tick, units: new Set(), foes: new Set(), cmd: null, dead0: deadCount(), over: false };
    // the force: our companies around the contact, and everyone of the same command group
    const gid = groupIdOf(u);
    for (const v of soldiers()) if (Math.hypot(v.ax - x, v.ay - y) < FORCE_R || groupIdOf(v) === gid) b.units.add(v.id);
    battles.push(b);
    const theirs = (w.units.get(f.id)?.members.length) || 0;
    log(`Battle ${P.phrase}: ${theirs} of the enemy's ${ARMS[f.arm].name.toLowerCase()} come to blows with our men`, { x, y, tone: "battle" });
    const cap = captainFor(b);
    if (cap) ask(b, cap); else toast(`Battle ${P.phrase}!`);
    return b;
  }
  // the captain who leads any of this force, or whose own company is in it, or who stands nearest the fight
  function captainFor(b) {
    let best = null, bs = -Infinity;
    for (const c of captains()) {
      if (battles.some((x) => x !== b && !x.over && x.cmd?.leader === c.id)) continue; // already fighting elsewhere
      const leads = [...b.units].some((id) => w.units.get(id)?.leader === c.id);
      const inIt = b.units.has(S.unit[c.id]);
      const d = Math.hypot(S.x[c.id] - b.x, S.y[c.id] - b.y);
      if (!leads && !inIt && d > NEAR_CAPTAIN) continue;
      const s = (leads ? 1e6 : 0) + (inIt ? 1e5 : 0) + c.sg.score - d;
      if (s > bs) { bs = s; best = c; }
    }
    return best;
  }
  function closeBattle(b) {
    b.over = true; b.t1 = w.tick;
    const d = deadCount(), ours = d[PLAYER] - b.dead0[PLAYER], theirs = d[1 - PLAYER] - b.dead0[1 - PLAYER];
    b.cas = [0, 0]; b.cas[PLAYER] = ours; b.cas[1 - PLAYER] = theirs;
    const who = b.cmd ? `${nm(b.cmd.leader)}'s battle` : "The fighting";
    log(`${who} ${b.phrase} is over — we lost ${ours}, they lost ${theirs}`, { x: b.x, y: b.y, tone: theirs > ours ? "good" : ours > theirs ? "bad" : "" });
    if (b.cmd) { toast(`${nm(b.cmd.leader)} hands the men back to you`); release(b); }
    if (promptOpen?.b === b) closePrompt();
    pending.splice(0, pending.length, ...pending.filter((p) => p.b !== b));
  }
  function deadCount() { const d = [0, 0]; for (let i = 0; i < S.n; i++) if (!S.alive[i] && S.state[i] !== S_GONE && (S.team[i] === 0 || S.team[i] === 1)) d[S.team[i]]++; return d; }

  function runDelegated(b) {
    const L = b.cmd.leader;
    if (!S.alive[L]) {
      log(`${nm(L)} has fallen ${b.phrase} — the men look to you`, { x: S.x[L], y: S.y[L], tone: "bad" });
      toast(`${nm(L)} has fallen — you command ${b.phrase}`); release(b); return;
    }
    for (const u of w.units.values()) if (u.delegated === b.id && u.members.length && !b.cmd.units.has(u.id)) { b.cmd.units.add(u.id); byUnit.set(u.id, b); } // split-off pieces stay with him
    commandBattle(w, b.cmd);
  }

  function delegate(b, capId) {
    const sg = w.sagas.get(capId); if (!sg || b.over) return;
    b.cmd = { team: PLAYER, units: new Set(b.units), disposition: sg.disposition, V, anchor: { x: b.x, y: b.y }, leader: capId };
    for (const id of b.cmd.units) { const u = w.units.get(id); if (u) { u.delegated = b.id; byUnit.set(id, b); } }
    onDelegate?.([...b.cmd.units]);
    log(`We leave the battle ${b.phrase} to ${nm(capId)}, ${dispName(sg)}`, { x: b.x, y: b.y, tone: "legend" });
    toast(`${nm(capId)} takes command ${b.phrase}`);
  }
  function release(b) {
    if (!b.cmd) return;
    for (const id of b.cmd.units) { const u = w.units.get(id); if (u && u.delegated === b.id) delete u.delegated; byUnit.delete(id); }
    for (const u of w.units.values()) if (u.delegated === b.id) delete u.delegated;
    b.cmd = null;
  }
  function takeCommand(unitIds) {
    const bs = new Set(); for (const id of unitIds) { const b = delegatedBattle(id); if (b) bs.add(b); }
    for (const b of bs) { const who = nm(b.cmd.leader); release(b); log(`We take command ${b.phrase} from ${who}`, { x: b.x, y: b.y }); toast(`You take command ${b.phrase}`); }
    return bs.size;
  }
  const delegatedBattle = (unitId) => { const b = byUnit.get(unitId); if (b && b.cmd && !b.over) return b; const u = w.units.get(unitId); return u?.delegated ? battles.find((x) => x.id === u.delegated && x.cmd && !x.over) || null : null; };

  // ---------------------------------------------------------------- the prompt (non-blocking; one at a time)
  function ask(b, cap) { pending.push({ b, cap: cap.id }); if (!promptOpen) nextPrompt(); }
  function nextPrompt() {
    const p = pending.shift(); if (!p) return;
    if (p.b.over || !S.alive[p.cap]) return nextPrompt();
    const sg = w.sagas.get(p.cap);
    promptEl.innerHTML = `<div class="bp-k">Battle</div><h4>Battle ${p.b.phrase}</h4>
      <div class="bp-sub">${nm(p.cap)} — ${RANKS[Math.min(3, sg.rank)]}, <i>${dispName(sg)}</i> — is with the force.</div>
      <div class="bp-btns"><button data-me>Command it myself</button><button data-him class="on">Leave it to ${nm(p.cap).split(" ")[0]} <small>(${dispName(sg)})</small></button></div>
      <div class="bp-foot"><button data-go>Show me</button><i class="bp-timer"></i></div>`;
    promptEl.hidden = false; promptEl.classList.remove("fade");
    const t0 = performance.now(), timer = promptEl.querySelector(".bp-timer");
    promptOpen = { b: p.b, raf: 0, to: 0 };
    const tickBar = () => { if (!promptOpen) return; timer.style.transform = `scaleX(${Math.max(0, 1 - (performance.now() - t0) / promptMs)})`; promptOpen.raf = requestAnimationFrame(tickBar); };
    tickBar();
    promptOpen.to = setTimeout(() => { if (promptOpen?.b === p.b) { toast(`You command ${p.b.phrase}`); closePrompt(); } }, promptMs);
    promptEl.querySelector("[data-me]").onclick = () => { toast(`You command ${p.b.phrase}`); closePrompt(); };
    promptEl.querySelector("[data-him]").onclick = () => { delegate(p.b, p.cap); closePrompt(); };
    promptEl.querySelector("[data-go]").onclick = () => focus(p.b.x, p.b.y);
  }
  function closePrompt() {
    if (promptOpen) { cancelAnimationFrame(promptOpen.raf); clearTimeout(promptOpen.to); }
    promptOpen = null; promptEl.hidden = true; nextPrompt();
  }

  // ---------------------------------------------------------------- labels: who leads this group
  function badgeFor(units) {
    for (const u of units) { const b = delegatedBattle(u.id); if (b) return { name: nm(b.cmd.leader), delegated: true }; }
    for (const u of units) if (u.leader !== undefined && S.alive[u.leader]) return { name: nm(u.leader), delegated: false };
    return null;
  }

  // ---------------------------------------------------------------- Commanders panel
  function assign(capId, unitIds) {
    const set = new Set(unitIds);
    for (const u of w.units.values()) if (u.leader === capId && !set.has(u.id)) delete u.leader;
    let men = 0; for (const id of set) { const u = w.units.get(id); if (u && !u.isWorkers) { u.leader = capId; men += u.members.length; } }
    return men;
  }
  function showPanel(el, selection) {
    const caps = captains(), rising = legends().filter((l) => l.sg.rank < 3);
    const sel = [...selection].map((id) => w.units.get(id)).filter((u) => u && !u.isWorkers && u.members.length);
    const selMen = sel.reduce((s, u) => s + u.members.length, 0);
    const armList = (us) => { const m = new Map(); for (const u of us) m.set(u.arm, (m.get(u.arm) || 0) + u.members.length); return [...m].map(([a, n]) => `${ARMS[a].name} ×${n}`).join(", "); };
    let html = `<button class="x" data-close>✕</button><h3>Commanders</h3>
      <div class="stage">Captains lead a force and can be left to fight its battles in their own way.</div>`;
    if (!caps.length) html += `<p class="cm-none">No captains yet. When a man's deeds make him a legend and you raise him three times, he can lead your men — and fight their battles his way.</p>`;
    for (const { id, sg } of caps) {
      const D = DISPOSITIONS[sg.disposition] || {};
      const own = w.units.get(S.unit[id]); const P = places.at(S.x[id], S.y[id]);
      const leads = ledBy(id), fight = battles.find((b) => !b.over && b.cmd?.leader === id);
      const temper = D.aggression > 0.8 ? "throws his men in" : D.aggression < 0.35 ? "takes the high ground and waits" : D.flank > 0.7 ? "works round the flanks" : D.usesCover ? "strikes from cover" : "keeps his line and picks his moment";
      html += `<div class="cm">
        <div class="cm-h"><b>${nm(id)}</b><span class="cm-rank">${RANKS[Math.min(3, sg.rank)]}${sg.rank > 3 ? " " + sg.rank : ""}</span></div>
        <div class="cm-disp"><i>${dispName(sg)}</i> — ${temper}</div>
        <div class="cm-abil">${(sg.abilities || []).map((k) => `<span title="${ABILITIES[k]?.desc || ""}">${ABILITIES[k]?.name || k}</span>`).join("")}</div>
        <div class="row">Where: <b>${own ? ARMS[own.arm].name + ", " : ""}${P.phrase}</b></div>
        <div class="row">Leads: <b>${leads.length ? armList(leads) : "no force given him"}</b></div>
        ${fight ? `<div class="row cm-fight">Commanding the battle ${fight.phrase} with ${[...fight.cmd.units].reduce((n, uid) => n + (w.units.get(uid)?.members.length || 0), 0)} men</div>` : ""}
        <div class="btns">${fight ? `<button data-take="${fight.id}">Take command</button>` : ""}<button data-lead="${id}" ${sel.length ? "" : "disabled"} title="${sel.length ? "" : "Select a group of soldiers first"}">Lead the selected${sel.length ? ` (${selMen})` : ""}</button><button data-go="${id}">Show</button>${leads.length ? `<button data-free="${id}">Release</button>` : ""}</div>
      </div>`;
    }
    if (rising.length) {
      html += `<div class="sub">Rising names</div>` + rising.slice(0, 8).map(({ id, sg }) => `<div class="cm-rise"><b>${nm(id)}</b> <small>${RANKS[sg.rank]} · ${ARM_BY_ID[S.arm[id]].name} · ${S.kills[id]} felled</small><button data-go="${id}">Show</button></div>`).join("");
    }
    el.innerHTML = html; el.hidden = false; el.dataset.kind = "cmd";
    el.querySelector("[data-close]").onclick = () => { el.hidden = true; el.dataset.kind = ""; };
    el.querySelectorAll("[data-lead]").forEach((bt) => bt.onclick = () => { const id = +bt.dataset.lead; const n = assign(id, sel.map((u) => u.id)); toast(`${nm(id)} now leads ${n} men`); log(`${nm(id)} is given ${n} men to lead`, { x: S.x[id], y: S.y[id], tone: "legend" }); showPanel(el, selection); });
    el.querySelectorAll("[data-free]").forEach((bt) => bt.onclick = () => { assign(+bt.dataset.free, []); showPanel(el, selection); });
    el.querySelectorAll("[data-go]").forEach((bt) => bt.onclick = () => { const id = +bt.dataset.go; focus(S.x[id], S.y[id]); });
    el.querySelectorAll("[data-take]").forEach((bt) => bt.onclick = () => { const b = battles.find((x) => x.id === +bt.dataset.take); if (b?.cmd) takeCommand([...b.cmd.units]); showPanel(el, selection); });
  }

  return { system, battles, captains, legends, delegate, takeCommand, delegatedBattle, badgeFor, showPanel, assign, nm, dispName, closePrompt, hush: () => { pending.length = 0; closePrompt(); } };
}
