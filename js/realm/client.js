// The Realm, the browser's side (docs/realm-protocol.md): the connection to the realm server and the MIRROR world.
//
// The client never runs the sim. It keeps a local world `w` shaped like the sim's (w.S soldiers' struct-of-arrays,
// w.units, w.buildings, w.teams, w.econ, w.plans, V fog) filled from what the server sends, so the renderer and the UI
// draw from it unchanged:
//   * soldier frames (binary, ~5 Hz): applied straight into w.S with a DataView (no per-frame garbage: the arrays are
//     reused and grown by doubling). Each man keeps a "from" and a "to" position; every rendered frame lerps between
//     them over the send interval, so movement is smooth at 60 fps. Men who appear or jump far are snapped.
//   * `state` (JSON, 2 Hz): units (their members are rebuilt from the soldier records' unit field), buildings, the
//     team's stores, the town plan, chains, engines, who is online.
//   * `ev`: the tick's sim events the player may see: handed to the same taps (figures: blows, knocks, thrown, arrows;
//     audio) that read w.events in the single-player game.
//   * fog frames (binary): V.teams[0], the terrain's fog texture.
// Team numbers: the player's own team is swapped with team 0 in the mirror (everything that reaches w goes through
// `mt`), so the renderer's and the UI's PLAYER = 0 hold. Orders go up as `cmd` messages (js/game/commands.js ops):
// `commands.run(op, args, done)` has the same shape as the local command layer in main.js.
import { K_SOLDIERS, K_FOG, HDR, REC_STATIC, REC_DYN, REC_MOVE, REC_GONE, MOVE_UNIT, F_COMPLETE, TIMER_NONE, decodeFog } from "../net/realm-codec.js";
import { S_DEAD, S_DOWN } from "../sim/soldiers.js";
import { S_GONE } from "../sim/economy.js";
import { ARM_BY_ID } from "../sim/arms.js";
import { scorchFeatures } from "../sim/wildfire.js"; // (burnt ground takes the map's hedges with it, as on the server)

const TAU = Math.PI * 2;
const SNAP_M = 30; // a man who moved further than this between frames is placed, not slid

// grow every typed array of a soldiers' SoA (and our own per-man arrays) to hold index `need`
function growTo(S, need, extra) {
  if (need <= S.cap) return;
  let cap = S.cap; while (cap < need) cap *= 2;
  for (const k of Object.keys(S)) { const a = S[k]; if (ArrayBuffer.isView(a) && a.length === S.cap) { const b = new a.constructor(cap); b.set(a); S[k] = b; } }
  for (const k of Object.keys(extra)) { const a = extra[k], b = new a.constructor(cap); b.set(a); extra[k] = b; }
  S.cap = cap;
}

// the session this device was signed in with (play.html keeps it; server/accounts.mjs issued it). null: signed out
export const SESSION_KEY = "hg.realm.session";
export function savedSession() { try { return localStorage.getItem(SESSION_KEY); } catch { return null; } }
export function dropSession() { try { localStorage.removeItem(SESSION_KEY); } catch { /* private mode */ } }
// the socket carries no secret in its URL: its FIRST message is { t: "auth", s: session } (server/realm.mjs)
export function connectRealm({ session, url = null, onStatus = () => {} }) {
  const wsUrl = url || `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/realm`;
  const R = {
    hello: null, status: "connecting", ws: null, rid: 0, pending: new Map(), handlers: {}, closedFor: null, retry: 0,
    lastMsg: 0, rtt: 0, queue: [], closes: [], // (messages that arrive before the mirror is attached)
  };
  let firstHello = null; const helloP = new Promise((res, rej) => { firstHello = { res, rej }; });
  const set = (s, why = "") => { R.status = s; onStatus(s, why); };
  function open() {
    if (R.left) return; // (the player left on purpose: js/realm/ui.js exitFlow — no reconnecting)
    set(R.hello ? "reconnecting" : "connecting");
    let ws; try { ws = new WebSocket(wsUrl); } catch (e) { return later(String(e)); }
    ws.binaryType = "arraybuffer"; R.ws = ws;
    ws.onopen = () => { R.retry = 0; ws.send(JSON.stringify({ t: "auth", s: session })); };
    ws.onmessage = (m) => {
      R.lastMsg = performance.now();
      if (typeof m.data !== "string") return deliver({ bin: m.data });
      let o; try { o = JSON.parse(m.data); } catch { return; }
      if (o.t === "hello") { R.hello = o; set("online"); firstHello?.res(o); firstHello = null; for (const f of R.helloWait.splice(0)) f(o); }
      if (o.t === "ack") { const cb = R.pending.get(o.rid); R.pending.delete(o.rid); cb?.(o); return; }
      if (o.t === "pong") { R.rtt = performance.now() - o.c; return; }
      deliver(o);
    };
    ws.onclose = (e) => {
      if (R.ws !== ws) return; // (an old socket's late close)
      R.ws = null; R.closes.push({ code: e.code, reason: e.reason, t: Math.round(performance.now()) }); if (R.closes.length > 20) R.closes.shift();
      for (const cb of R.pending.values()) cb({ ok: false, error: "Lost the connection: the order may not have reached the realm" });
      R.pending.clear();
      if (R.left) { set("left"); return; }
      if (e.code === 4001) { R.closedFor = e.reason || "signed out"; set("refused", R.closedFor); firstHello?.rej(new Error(R.closedFor)); firstHello = null; return; }
      if (e.code === 4003) { set("restarting", e.reason || "starting over"); setTimeout(() => location.reload(), 400); return; } // (a fallen house starts over at another hold: a fresh page)
      later(e.reason || (e.code === 1006 ? "no answer from the server" : `closed (${e.code})`));
    };
    ws.onerror = () => { /* onclose follows */ };
  }
  function later(why) {
    if (R.left) return;
    const wait = Math.min(10, 2 ** R.retry++); set(R.hello ? "reconnecting" : "retrying", why); R.retryAt = performance.now() + wait * 1000;
    setTimeout(open, wait * 1000);
  }
  function deliver(o) { if (R.mirror) R.mirror.on(o); else R.queue.push(o); }
  R.send = (o) => { if (R.ws?.readyState === 1) { R.ws.send(JSON.stringify(o)); return true; } return false; };
  R.cmd = (op, args, done) => {
    const rid = ++R.rid;
    if (!R.send({ t: "cmd", rid, op, args })) { done?.({ ok: false, error: "Not connected to the realm: the order was not sent" }); return; }
    if (done) R.pending.set(rid, done);
  };
  R.leave = () => { R.left = true; if (R.ws?.readyState === 1) { try { R.ws.close(1000, "leaving"); } catch { /* gone */ } } else set("left"); }; // the player rides out (ui.js exitFlow)
  R.hello0 = helloP;
  R.helloWait = []; R.nextHello = () => new Promise((res) => R.helloWait.push(res)); // (the hello that follows founding a house)
  R.attach = (mirror) => { R.mirror = mirror; for (const o of R.queue.splice(0)) mirror.on(o); };
  setInterval(() => { if (R.ws?.readyState === 1) R.send({ t: "ping", c: performance.now() }); }, 5000);
  open();
  return R;
}

// The mirror: fills `w` (made by createWorld, no systems) and V from the server's messages.
export function makeMirror(R, w, V, { myTeam, onChron = () => {}, onPlayers = () => {}, onState = () => {} }) {
  const mt = (t) => (t === myTeam ? 0 : t === 0 ? myTeam : t); // the swap (its own inverse)
  const S = w.S;
  const X = { fx: new Float32Array(S.cap), fy: new Float32Array(S.cap), tx: new Float32Array(S.cap), ty: new Float32Array(S.cap), qx: new Uint32Array(S.cap), qy: new Uint32Array(S.cap), has: new Uint8Array(S.cap) };
  const M = {
    myTeam, mt, X, chains: [], players: [], frames: 0, bytes: 0, lastFrameAt: 0, interval: (R.hello?.send || 0.2) * 1000,
    t0: 0, t1: 0, a0: 0, // server time of the previous and the last frame; when the last one arrived
    sent: 0, seen: 0, // men in view (listed), men drawn
    towns: [], // the house's towns, as the server sums them (js/sim/founding.js townSummary)
  };
  const unitMap = w.units;
  const bmap = new Map(); // building id → record
  w.buildings = w.buildings || [];

  // ---------------------------------------------------------------- soldier frames (binary)
  function soldiers(buf) {
    const dv = new DataView(buf), now = performance.now();
    if (dv.getUint8(0) !== K_SOLDIERS) return;
    const complete = !!(dv.getUint16(2, true) & F_COMPLETE), tick = dv.getUint32(4, true), time = dv.getFloat64(8, true);
    const nS = dv.getUint32(16, true), nD = dv.getUint32(20, true), nM = dv.getUint32(24, true), nG = dv.getUint32(28, true), sc = dv.getFloat32(32, true), sN = dv.getUint32(36, true), ox = dv.getFloat32(40, true), oy = dv.getFloat32(44, true);
    growTo(S, sN + 1, X);
    // the new "from": wherever each man is drawn now (a frame is a new target, not a jump)
    const n0 = S.n;
    for (let i = 0; i < n0; i++) if (X.has[i]) { X.fx[i] = S.x[i]; X.fy[i] = S.y[i]; }
    if (sN > S.n) S.n = sN;
    if (complete) for (let i = 0; i < S.n; i++) if (X.has[i]) gone(i);
    let o = HDR;
    for (let k = 0; k < nS; k++, o += REC_STATIC) {
      const i = dv.getUint32(o, true); growTo(S, i + 1, X); if (i >= S.n) S.n = i + 1;
      S.name[i] = dv.getUint32(o + 4, true); S.kitMask[i] = dv.getUint32(o + 8, true); S.team[i] = mt(dv.getUint8(o + 12)); S.arm[i] = dv.getUint8(o + 13);
      S.weapon[i] = dv.getUint8(o + 14); S.shield[i] = dv.getUint8(o + 15); S.horse[i] = dv.getUint8(o + 16); S.kit[i] = dv.getUint8(o + 17);
      S.legend[i] = dv.getUint8(o + 18); S.pavise[i] = dv.getUint8(o + 19); S.armour[i] = dv.getUint8(o + 20); S.side[i] = dv.getUint8(o + 21); S.missile[i] = dv.getUint8(o + 22);
    }
    const tm = (v) => (v === TIMER_NONE ? 0 : time + v / 100);
    for (let k = 0; k < nD; k++, o += REC_DYN) {
      const i = dv.getUint32(o, true); growTo(S, i + 1, X); if (i >= S.n) S.n = i + 1;
      S.unit[i] = dv.getUint32(o + 4, true); S.foe[i] = dv.getInt32(o + 8, true);
      const qx = dv.getUint16(o + 12, true) | (dv.getUint8(o + 32) << 16), qy = dv.getUint16(o + 14, true) | (dv.getUint8(o + 33) << 16); X.qx[i] = qx; X.qy[i] = qy;
      target(i, ox + qx * sc, oy + qy * sc);
      S.facing[i] = dv.getUint8(o + 16) * TAU / 256; S.state[i] = dv.getUint8(o + 17);
      const fl = dv.getUint8(o + 18); S.alive[i] = fl & 1; S.horseOK[i] = (fl >> 1) & 1; S.shieldArm[i] = (fl >> 2) & 1; S.posture[i] = (fl >> 3) & 3;
      S.lvl[i] = dv.getUint8(o + 19); S.vx[i] = dv.getInt8(o + 20) / 10; S.vy[i] = dv.getInt8(o + 21) / 10; S.status[i] = dv.getUint8(o + 22); S.fatigue[i] = dv.getUint8(o + 23) / 255;
      S.nextAtk[i] = tm(dv.getInt16(o + 24, true)); S.nextShot[i] = tm(dv.getInt16(o + 26, true)); S.busyT[i] = tm(dv.getInt16(o + 28, true));
      S.rank[i] = dv.getUint8(o + 30); S.kills[i] = dv.getUint8(o + 31);
    }
    for (let k = 0; k < nM; k++, o += REC_MOVE) {
      const i = dv.getUint16(o, true); if (i >= S.n) continue;
      X.qx[i] += dv.getInt8(o + 2) * MOVE_UNIT; X.qy[i] += dv.getInt8(o + 3) * MOVE_UNIT;
      target(i, ox + X.qx[i] * sc, oy + X.qy[i] * sc);
      S.facing[i] = dv.getUint8(o + 4) * TAU / 256; S.state[i] = dv.getUint8(o + 5); S.vx[i] = dv.getInt8(o + 6) / 10; S.vy[i] = dv.getInt8(o + 7) / 10;
    }
    for (let k = 0; k < nG; k++, o += REC_GONE) { const i = dv.getUint32(o, true); if (i < S.n) gone(i); }
    // time: the previous frame's server time → this one's, over the send interval
    M.t0 = M.frames ? displayTime(now) : time; M.t1 = time; M.a0 = now;
    if (M.lastFrameAt) M.interval = M.interval * 0.8 + Math.min(1000, Math.max(50, now - M.lastFrameAt)) * 0.2;
    M.lastFrameAt = now; M.frames++; M.bytes += buf.byteLength;
    w.tick = tick;
    rebuildMembers();
  }
  function target(i, x, y) {
    if (!X.has[i] || Math.abs(x - X.fx[i]) + Math.abs(y - X.fy[i]) > SNAP_M) { X.fx[i] = x; X.fy[i] = y; S.x[i] = x; S.y[i] = y; } // new in view, or a jump: place him
    X.tx[i] = x; X.ty[i] = y; X.has[i] = 1;
  }
  function gone(i) { X.has[i] = 0; S.alive[i] = 0; S.state[i] = S_GONE; S.unit[i] = -1; }
  const displayTime = (now) => M.t0 + (M.t1 - M.t0) * Math.min(1, (now - M.a0) / M.interval);
  // members from the soldier records; units the server has not described yet get a stub from their men
  function rebuildMembers() {
    for (const u of unitMap.values()) u.members.length = 0;
    let sent = 0;
    for (let i = 0; i < S.n; i++) {
      if (!X.has[i]) continue; sent++;
      if (!S.alive[i]) continue;
      let u = unitMap.get(S.unit[i]);
      if (!u) { u = stubUnit(S.unit[i], S.team[i], ARM_BY_ID[S.arm[i]]?.key); unitMap.set(u.id, u); }
      u.members.push(i);
    }
    M.sent = sent;
  }
  function stubUnit(id, team, arm) {
    return { id, team, arm, members: [], formation: "line", facing: 0, ax: 0, ay: 0, order: null, state: "formed", morale: 0.8, legendIds: [], stub: true };
  }

  // ---------------------------------------------------------------- per rendered frame: slide every man toward his target
  M.frame = (now = performance.now()) => {
    if (!M.frames) return;
    const a = Math.min(1, (now - M.a0) / M.interval);
    for (let i = 0; i < S.n; i++) {
      if (!X.has[i]) continue;
      S.x[i] = X.fx[i] + (X.tx[i] - X.fx[i]) * a; S.y[i] = X.fy[i] + (X.ty[i] - X.fy[i]) * a;
    }
    w.time = displayTime(now);
    // unit anchors follow their men (the server's ax, ay only for a unit with no one in view); an order shown at once
    // (main.js) that the server's state has not confirmed within 4 s goes back to what the server last said
    for (const u of unitMap.values()) {
      if (u.order?.pending && now - u.order.pending > 4000) u.order = u._srvOrder || null;
      const n = u.members.length; if (!n) continue;
      let x = 0, y = 0; for (const i of u.members) { x += S.x[i]; y += S.y[i]; }
      u.ax = x / n; u.ay = y / n;
    }
  };

  // ---------------------------------------------------------------- state (JSON)
  const swapTeamField = (o) => { if (o && typeof o.team === "number") o.team = mt(o.team); return o; };
  function state(o) {
    if (o.full) {
      for (const id of [...unitMap.keys()]) if (!o.units?.some((u) => u.id === id)) { const u = unitMap.get(id); if (!u.members.length) unitMap.delete(id); else u.stub = true; }
      bmap.clear(); w.buildings.length = 0;
    }
    for (const U of o.units || []) {
      let u = unitMap.get(U.id);
      if (!u) { u = stubUnit(U.id, 0, U.arm); unitMap.set(U.id, u); }
      const members = u.members, ax = u.ax, ay = u.ay;
      for (const k of Object.keys(U)) if (k !== "members") u[k] = U[k];
      u.team = mt(U.team); u.members = members; u.stub = false;
      if (members.length) { u.ax = ax; u.ay = ay; } // (drawn from the men; the server's for a body out of the 5 Hz area)
      if (u.order && typeof u.order.team === "number") u.order.team = mt(u.order.team);
    }
    for (const id of o.ugone || []) { const u = unitMap.get(id); if (u && !u.members.length) unitMap.delete(id); else if (u) u.stub = true; }
    for (const B of o.buildings || []) {
      swapTeamField(B);
      const old = bmap.get(B.id);
      if (old) { const k = w.buildings.indexOf(old); if (k >= 0) w.buildings[k] = B; else w.buildings.push(B); }
      else w.buildings.push(B);
      bmap.set(B.id, B);
    }
    for (const id of o.bgone || []) { const b = bmap.get(id); if (!b) continue; bmap.delete(id); const k = w.buildings.indexOf(b); if (k >= 0) w.buildings.splice(k, 1); }
    if (o.team) {
      const T = w.teams[0];
      for (const k of Object.keys(o.team)) if (k !== "id") T[k] = o.team[k];
      T.id = 0; T.realId = myTeam;
      T.store ||= {}; T.census ||= { inTraining: 0 }; T.dependants ??= 0; T.squires ??= 0;
      if (T.hall === undefined) T.hall = w.buildings.find((b) => b.team === 0 && b.kind === "town_hall")?.id;
      T.hq ||= T.town ? { x: T.town.x, y: T.town.y } : undefined;
    }
    if (o.econ) Object.assign(w.econ, o.econ);
    if (o.wx) { w.weather = o.wx.key; w.wind = o.wx.wind; w.wx = o.wx; } // (one sky for the vale: js/sim/weather.js — same message, same sky on every client)
    if (o.plan) { const P = o.plan; for (const s of P.slots || []) swapTeamField(s); w.plans = w.plans || []; w.plans[0] = P; }
    if (o.towns) M.towns = o.towns; // the house's towns (js/sim/founding.js: the town switcher reads them)
    if (o.townPlans) { const T = w.teams[0]; T.towns ||= []; for (const [id, P] of Object.entries(o.townPlans)) { for (const s of P.slots || []) swapTeamField(s); let D = T.towns.find((q) => q.id === id); if (!D) T.towns.push(D = { id }); Object.assign(D, { name: P.name, x: P.x, y: P.y, state: P.state, plan: { team: 0, slots: P.slots, town: P.town } }); } }
    if (o.recruit) M.recruit = o.recruit;
    if (o.chains) M.chains = o.chains;
    if (o.caps) M.capProps = { props: o.caps, at: performance.now() }; // the captains' cards (js/ui/captain-cards.js); the server keeps the countdown
    if (o.capInit) M.capGlobal = o.capInit;
    if (o.engines && w.siege) { w.siege.engines = o.engines.map(swapTeamField); }
    if (o.features) {
      const keep = (w.features || []).filter((f) => f.fid === undefined || !o.features.some((g) => g.fid === f.fid));
      w.features = [...keep, ...o.features.map(swapTeamField)]; w.featuresVer = (w.featuresVer || 0) + 1;
    }
    if (o.labor) { // the labour core's picture (js/sim/labor.js; server/views.mjs): men's poses and loads, goods lying about
      const L = (w.labor ||= { men: new Map(), items: [], nextItem: 0, ver: 0 }), X = o.labor;
      if (o.full) { L.men.clear(); L.items.length = 0; }
      for (const [id, pose, kind, cart, t0, dur] of X.men || []) L.men.set(id, { pose, carry: kind ? { kind, ...(cart ? { cart: true } : {}) } : null, t0, dur, team: S.team[id] });
      for (const id of X.mgone || []) L.men.delete(id);
      const byId = new Map(L.items.map((it) => [it.id, it]));
      for (const it of X.items || []) { swapTeamField(it); const old = byId.get(it.id); if (old) Object.assign(old, it); else { L.items.push(it); byId.set(it.id, it); } }
      if (X.igone?.length) { const g = new Set(X.igone); L.items = L.items.filter((it) => !g.has(it.id)); }
      L.ver++;
    }
    if (o.wild) { // lane C: the game in sight (js/sim/wild.js; server/views.mjs) — the same w.wild the renderer draws single-player
      const WL = (w.wild ||= { herds: [], a: [], shots: [], ver: 0, credit: {} }), X = o.wild;
      if (o.full) { WL.a.length = 0; WL.herds.length = 0; }
      const am = new Map(WL.a.map((a) => [a.id, a])), hm = new Map(WL.herds.map((h) => [h.id, h]));
      for (const [id, h, sp, x, y, f, st, t0, male, young] of X.a || []) { const a = am.get(id); if (a) Object.assign(a, { h, sp, x, y, f, st, t0, male, young }); else { const n = { id, h, sp, x, y, f, st, t0, male, young, tgt: -1 }; WL.a.push(n); am.set(id, n); } }
      if (X.agone?.length) { const g = new Set(X.agone); WL.a = WL.a.filter((a) => !g.has(a.id)); }
      for (const [id, sp, cx, cy, n] of X.herds || []) { const H = hm.get(id); if (H) Object.assign(H, { sp, cx, cy, n }); else WL.herds.push({ id, sp, cx, cy, n }); }
      if (X.hgone?.length) { const g = new Set(X.hgone); WL.herds = WL.herds.filter((H) => !g.has(H.id)); }
      if (X.shots) WL.shots = X.shots;
      WL.ver++;
    }
    if (o.dragons) { // the dragons in sight (js/sim/dragons.js; server/views.mjs) — the same w.dragons the renderer draws single-player
      const DG = (w.dragons ||= { list: [], shots: [], lairs: [], ver: 0 }), X = o.dragons;
      if (o.full) DG.list.length = 0;
      const dm = new Map(DG.list.map((d) => [d.id, d]));
      for (const rec of X.d || []) {
        if (typeof rec.owner === "number" && rec.owner >= 0) rec.owner = mt(rec.owner);
        if (typeof rec.brokeBy === "number" && rec.brokeBy >= 0) rec.brokeBy = mt(rec.brokeBy);
        const d = dm.get(rec.id); if (d) Object.assign(d, { breath: null, stam: undefined, ...rec }); else { DG.list.push(rec); dm.set(rec.id, rec); }
      }
      if (X.dgone?.length) { const g = new Set(X.dgone); DG.list = DG.list.filter((d) => !g.has(d.id)); }
      if (X.shots) DG.shots = X.shots;
      if (X.lairs) DG.lairs = X.lairs;
      DG.ver++;
    }
    if (o.veins) { // the silver and gold veins (js/sim/veins.js; server/views.mjs): at the server's positions, with their holders —
      // they replace the veins the page read from the map's own files (those are drawn up on the crag, where the working is not)
      const sw = (t) => (Number.isInteger(t) && t >= 0 ? mt(t) : null);
      w.veins = o.veins.map((v) => ({ ...v, holder: sw(v.holder), home: sw(v.home), cap: v.cap ? { ...v.cap, by: sw(v.cap.by) } : null, ...(v.found ? { finder: sw(v.finder), source: "prospect" } : {}) })); // (found: a vein found by prospecting — js/sim/prospect.js)
      const R0 = (w.resources ||= []), keep = R0.filter((n) => n.kind !== "silver_vein" && n.kind !== "gold_vein");
      R0.length = 0; R0.push(...keep);
      for (const v of w.veins) R0.push({ id: v.id, kind: v.kind, res: v.kind === "gold_vein" ? "gold" : "silver", x: v.x, y: v.y, r: v.r, amount: v.band === "spent" ? 0 : 1000, start: 1000, holder: v.holder, holderName: v.hn, cap: v.cap, face: v.face, band: v.band, name: v.name, server: true, ...(v.found ? { source: "prospect", finder: v.finder } : {}) });
      w.veinsVer = (w.veinsVer || 0) + 1;
    }
    if (o.fire || o.burnt) { // fire in the woods (js/sim/wildfire.js; server/views.mjs): the same w.fire the renderer reads single-player
      const F = (w.fire ||= { cells: [], burnt: {}, ver: 0 });
      if (o.fire) { F.cells = (o.fire.c || []).map(([i, j, h, ch]) => ({ i, j, h, ch })); F.ver++; }
      if (o.burnt) {
        if (o.burnt.full) F.burnt = {};
        for (const [i, j, t] of o.burnt.add || []) { const k = i * 65536 + j, had = !!F.burnt[k]; F.burnt[k] = { i, j, t, ch: 1 }; if (!had) scorchFeatures(w, i, j); }
        for (const [i, j] of o.burnt.gone || []) delete F.burnt[i * 65536 + j];
        F.bver = (F.bver || 0) + 1;
      }
    }
    if (o.fgone?.length) { w.features = (w.features || []).filter((f) => !o.fgone.includes(f.fid)); w.featuresVer = (w.featuresVer || 0) + 1; }
    if (o.players) { M.players = o.players; onPlayers(o.players); }
    // (server time moves on even when nobody is in view)
    if (!M.frames && typeof o.time === "number") w.time = o.time;
    onState(o);
  }

  // ---------------------------------------------------------------- events: the same taps as the single-player sim's
  function events(o) {
    const ev = o.ev || []; if (!ev.length) return;
    for (const e of ev) { swapTeamField(e); if (typeof e.side === "number" && e.kind === "spell") e.side = mt(e.side); }
    w.events = ev;
    for (const f of w.systems) f(w); // (in realm mode the only systems are the renderer's and the audio's read-only taps)
    w.events = [];
  }

  function fog(buf) {
    const F = decodeFog(buf, V.teams[0].length === 0 ? null : V.teams[0]);
    if (F.n !== V.n) return; // (a different grid: the renderer's texture is sized to V.n)
    if (F.grid !== V.teams[0]) V.teams[0].set(F.grid);
    V.dirty = true; M.fogAt = performance.now();
  }

  M.letters = Array.isArray(R.hello?.letters) ? R.hello.letters.slice() : []; // the letters couriers have brought this house (js/sim/couriers.js), newest last
  M.on = (o) => {
    if (o.bin) { const k = new Uint8Array(o.bin, 0, 1)[0]; if (k === K_SOLDIERS) soldiers(o.bin); else if (k === K_FOG) fog(o.bin); return; }
    if (o.t === "state") state(o);
    else if (o.t === "ev") events(o);
    else if (o.t === "chron") { for (const L of o.add || []) onChron(L); }
    else if (o.t === "hello") { M.hello = o; M.interval = (o.send || 0.2) * 1000; if (o.players) { M.players = o.players; onPlayers(o.players); } if (Array.isArray(o.letters)) M.letters = o.letters; }
    else if (o.t === "letter") { if (o.letter) { M.letters.push(o.letter); try { dispatchEvent(new CustomEvent("realm-letter", { detail: o.letter })); } catch { /* headless */ } } } // (a courier at our keep: js/sim/couriers.js)
    else if (o.t === "live-bar" || o.t === "live-advance" || o.t === "live-draw") { try { dispatchEvent(new CustomEvent(o.t, { detail: o })); } catch { /* headless */ } } // (a live battle's bar and trumpets: js/ui/ranked.js liveBattle)
    else if (o.t === "live-deploy") { try { dispatchEvent(new CustomEvent("live-deploy", { detail: o })); } catch { /* headless */ } }
    else if (o.t === "ranked-end") { try { dispatchEvent(new CustomEvent("ranked-end", { detail: o })); } catch { /* headless */ } } // (a live ranked battle decided: js/ui/ranked.js)
    else if (o.t === "bye") onChron({ text: o.msg || "The realm is going down for a while", tone: "bad", toast: true });
  };
  // the command layer (same shape as main.js's local one): send, show at once, reconcile on the ack
  M.commands = {
    remote: true,
    run(op, args, done) { R.cmd(op, args, done); },
    chainPoints(ids) {
      for (const c of M.chains) if (c.units?.some((id) => ids.includes(id))) return c.pts;
      return null;
    },
    hasChain(ids) { return !!M.chains.some((c) => c.units?.some((id) => ids.includes(id))); },
  };
  M.visible = (i) => X.has[i] === 1;
  M.stats = () => ({ frames: M.frames, kb: Math.round(M.bytes / 1024), men: M.sent, units: unitMap.size, buildings: w.buildings.length, interval: Math.round(M.interval), rtt: Math.round(R.rtt) });
  return M;
}
