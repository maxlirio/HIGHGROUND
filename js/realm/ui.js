// The Realm's own HUD (js/realm/client.js is the connection and the mirror):
//   * the joining card ("Joining the realm…", the reason and the next retry when the server can't be reached);
//   * the realm card: your arms, name and house, the world clock (day, season, year), who else is online, and the
//     connection (a reconnecting badge that does not stop anything: the last frame stays on screen);
//   * "While you were away": the team's chronicle since you last looked, once on joining.
//   * founding a house (first join, or starting over): arms and a house name (chooseHouse); the house's standing on the
//     realm card (protection time left, the Keep's Peace, a siege); "Your house has fallen" (showFallen). The rules are
//     server/houses.mjs's (docs/realm-world.md).
import { drawBanner, BANNERS, bannerColor } from "../ui/heraldry.js";
import { wxBadge } from "../ui/glyphs.js";
import { savedSession, dropSession } from "./client.js";

const CSS = `
#realmjoin { position:fixed; inset:0; z-index:40; display:grid; place-items:center; background:#0d0c0a; }
#realmjoin .rj { width:min(440px, calc(100% - 32px)); text-align:center; }
#realmjoin .rj-t { letter-spacing:.3em; color:var(--gold); font-size:22px; }
#realmjoin .rj-s { color:var(--dim); margin:6px 0 20px; font-size:14px; }
#realmjoin .rj-m { font-size:16px; } #realmjoin .rj-w { color:#e7a07a; font-size:13px; margin-top:10px; min-height:1.3em; }
#realmjoin .rj-dots::after { content:"…"; animation: rjd 1.2s steps(4) infinite; display:inline-block; width:1.2em; text-align:left; overflow:hidden; vertical-align:bottom; }
@keyframes rjd { from { width:0 } to { width:1.2em } }
#realmcard { position:absolute; left:12px; top:44px; background:var(--panel); border:1px solid var(--edge); border-radius:4px; padding:8px 10px;
  font-size:13px; display:grid; grid-template-columns:auto 1fr; gap:2px 10px; align-items:center; max-width:300px; }
#realmcard canvas { grid-row:1 / span 2; width:34px; height:26px; border-radius:2px; box-shadow:0 0 0 1px #000a; }
#realmcard .rc-n { color:var(--gold); font-size:15px; } #realmcard .rc-h { color:var(--dim); font-size:12px; }
#realmcard .rc-clock { grid-column:1 / -1; margin-top:4px; border-top:1px solid #6b5a3a66; padding-top:5px; }
#realmcard .rc-clock b { color:var(--gold); font-weight:400; }
#realmcard .rc-on { grid-column:1 / -1; font-size:12px; color:var(--dim); line-height:1.5; }
#realmcard .rc-on span { display:inline-flex; align-items:center; gap:4px; margin-right:8px; white-space:nowrap; color:var(--ink); }
#realmcard .rc-on i { width:8px; height:8px; border-radius:50%; display:inline-block; box-shadow:0 0 0 1px #000a; }
#realmcard .rc-on span.off { color:var(--dim); opacity:.7; } #realmcard .rc-on span.off i { opacity:.35; }
#realmcard .rc-note { grid-column:1 / -1; font-size:11px; color:var(--dim); }
#realmcard .rc-leave { grid-column:1 / -1; margin-top:4px; border-top:1px solid #6b5a3a66; padding-top:6px; }
#realmcard .rc-leave button { width:100%; background:#0003; border:1px solid #6b5a3a; border-radius:3px; color:var(--ink); font:inherit; font-size:12px; padding:4px 6px; cursor:pointer; }
#realmcard .rc-leave button:hover { border-color:var(--gold); color:var(--gold); }
#realmcard .rc-out { display:flex; gap:6px; margin-top:5px; }
#realmcard .rc-out button { flex:1; background:none; border:1px solid #6b5a3a88; font-size:11.5px; color:#c9b88f; padding:3px 4px; }
#realmcard .rc-out button.warn { border-color:#c0654a; color:#f0a08a; }
#realmexit { width:min(480px, calc(100% - 32px)); background:var(--panel); border:1px solid var(--gold); border-radius:4px; padding:16px 18px; box-shadow:0 10px 50px #000c; }
#realmexit h2 { margin:0 0 6px; color:var(--gold); font-weight:400; letter-spacing:.06em; }
#realmexit p { margin:0 0 8px; font-size:14px; line-height:1.5; }
#realmexit .re-h { font-size:12px; color:var(--dim); line-height:1.45; min-height:1.2em; }
#realmexit .re-b { margin-top:12px; display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap; }
#realmexit .re-b button { font:inherit; font-size:14px; padding:6px 12px; background:#0003; border:1px solid #6b5a3a; border-radius:3px; color:var(--ink); cursor:pointer; }
#realmexit .re-b button.on { border-color:var(--gold); color:var(--gold); background:#3a2e1a; }
#realmexit .re-b button:disabled { opacity:.5; cursor:default; }
#realmexit .re-stay { margin-right:auto; border-color:transparent !important; color:var(--dim) !important; background:none !important; }
#realmcard .rc-house { grid-column:1 / -1; font-size:12px; border-radius:3px; padding:3px 6px; margin-top:4px; line-height:1.35; }
#realmcard .rc-house:empty { display:none; }
#realmcard .rc-house.prot { background:#2d4a2a; border:1px solid #6f9a4a; } #realmcard .rc-house.peace { background:#2a3550; border:1px solid #6a80b8; }
#realmcard .rc-house.siege { background:#5a2a1c; border:1px solid #c0654a; }
#realmfound, #realmfell { width:min(620px, calc(100% - 32px)); max-height:min(90vh, 760px); overflow:auto; background:var(--panel); border:1px solid var(--gold); border-radius:4px;
  padding:16px 18px; box-shadow:0 10px 50px #000c; }
#realmfound h2, #realmfell h2 { margin:0 0 4px; color:var(--gold); font-weight:400; letter-spacing:.06em; }
#realmfound .rf-s, #realmfell .rf-s { color:var(--dim); font-size:13px; margin-bottom:10px; line-height:1.45; }
#realmfound .rf-b { display:grid; grid-template-columns:repeat(auto-fill, minmax(76px, 1fr)); gap:6px; margin:8px 0 12px; }
#realmfound .rf-b button { background:#0003; border:1px solid #6b5a3a66; border-radius:3px; padding:4px 2px; color:var(--ink); font-size:11px; cursor:pointer; }
#realmfound .rf-b button.on { border-color:var(--gold); box-shadow:0 0 0 1px var(--gold); } #realmfound .rf-b button.taken { opacity:.35; }
#realmfound .rf-b canvas { width:56px; height:70px; display:block; margin:0 auto 2px; }
#realmfound label { display:block; font-size:13px; margin-bottom:4px; } #realmfound input { width:100%; box-sizing:border-box; font-size:16px; padding:6px 8px; background:#0006; color:var(--ink); border:1px solid #6b5a3a; border-radius:3px; }
#realmfound .rf-h { font-size:12px; color:var(--dim); margin-top:10px; line-height:1.5; } #realmfound .rf-h b { color:var(--ink); font-weight:400; }
#realmfound .rf-go, #realmfell .rf-go { margin-top:14px; display:flex; justify-content:flex-end; gap:8px; }
#realmfell ul { margin:6px 0; padding:0 0 0 14px; font-size:13px; line-height:1.45; } #realmfell .rf-st { display:grid; grid-template-columns:repeat(auto-fill, minmax(130px, 1fr)); gap:4px 12px; font-size:13px; margin:8px 0; }
#realmfell .rf-st b { color:var(--gold); font-weight:400; font-size:16px; display:block; }
#realmconn { position:absolute; left:50%; bottom:74px; transform:translateX(-50%); z-index:9; max-width:calc(100% - 32px); background:#5a2a1c; border:1px solid #c0654a;
  border-radius:3px; padding:4px 12px; font-size:13px; pointer-events:none; }
#realmconn[hidden] { display:none; }
#realmaway { width:min(560px, calc(100% - 32px)); max-height:min(80vh, 640px); display:flex; flex-direction:column; background:var(--panel);
  border:1px solid var(--gold); border-radius:4px; padding:16px 18px; box-shadow:0 10px 50px #000c; }
#realmaway h2 { margin:0 0 2px; color:var(--gold); font-weight:400; letter-spacing:.06em; } #realmaway .ra-s { color:var(--dim); font-size:13px; margin-bottom:10px; }
#realmaway ul { margin:0; padding:0 4px 0 0; list-style:none; overflow:auto; font-size:13px; line-height:1.45; }
#realmaway li { padding:3px 0 3px 10px; border-left:3px solid #6b5a3a; margin:3px 0; }
#realmaway li.good { border-color:#6f9a4a; } #realmaway li.bad, #realmaway li.fall { border-color:#b0503a; } #realmaway li.legend { border-color:var(--gold); } #realmaway li.magic { border-color:#7a6ab8; }
#realmaway li small { color:var(--dim); margin-right:6px; }
#realmaway .ra-b { margin-top:12px; display:flex; justify-content:flex-end; }
body.realm #lordbtn, body.realm #cmdbtn { display:none !important; }
${[2, 3, 4, 5, 6, 7].map((t) => `.gbadge.t${t} { background: var(--t${t}, #777); } .gbadge.t${t} svg path, .gbadge.t${t} svg circle { stroke: var(--t${t}a, #fff); }`).join("\n")}
`;
// the push worker at the page's own address (not the <base> a shipped release gives the game page: server/static.mjs) —
// its scope, and so this device's subscription, must stay the same from one release to the next
const SW_URL = typeof location === "undefined" ? "sw.js" : new URL("sw.js", location.href).href;
const SEASONS = ["Winter", "Spring", "Summer", "Autumn"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const seasonOf = (doy) => SEASONS[Math.floor(((doy + 10) % 365) / 91.25) % 4];
// the world clock from the economy's day of year (w.econ.doy runs on past 365: the years since the realm began)
export function realmClock(econ) {
  const doy = econ?.doy ?? 0, start = econ?.startDoy ?? doy, day = Math.floor(doy - start) + 1, yr = Math.floor(doy / 365) + 1;
  const d = new Date(2026, 0, 1 + Math.floor(doy % 365));
  return { day, season: seasonOf(doy % 365), date: `${d.getDate()} ${MONTHS[d.getMonth()]}`, year: yr };
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let styled = false;
const style = () => { if (styled) return; styled = true; const s = document.createElement("style"); s.textContent = CSS; document.head.append(s); };

// the joining card: shown before anything else loads; setStatus(s, why) follows the connection
export function showJoining() {
  style();
  const el = document.createElement("div"); el.id = "realmjoin";
  el.innerHTML = `<div class="rj"><div class="rj-t">HIGHGROUND</div><div class="rj-s">The Realm</div><div class="rj-m"><span class="rj-dots">Joining the realm</span></div><div class="rj-w"></div></div>`;
  document.body.append(el);
  const m = el.querySelector(".rj-m"), wv = el.querySelector(".rj-w");
  return {
    status(s, why) {
      if (s === "refused") { dropSession(); m.textContent = "You are signed out"; wv.innerHTML = `${esc(why || "signed out")}. <a href="/play.html" style="color:inherit">Sign in again</a>`; return; }
      if (s === "retrying" || s === "reconnecting") { m.innerHTML = `<span class="rj-dots">Trying to reach the realm</span>`; wv.textContent = `${why || "No answer"}. Trying again in a few seconds.`; return; }
      if (s === "online") { m.innerHTML = `<span class="rj-dots">Riding in</span>`; wv.textContent = ""; }
      if (s === "restarting") { m.innerHTML = `<span class="rj-dots">Riding out to a new hold</span>`; wv.textContent = ""; }
    },
    signedOut() { m.textContent = "Sign in to enter the realm"; wv.innerHTML = `This device is not signed in. <a href="/play.html" style="color:inherit">Sign in or create your account</a>`; },
    hide(on) { el.style.display = on ? "none" : ""; },
    remove() { el.remove(); },
  };
}

export function makeRealmUI({ hud, hello, w, myTeam, teamOf, realm = null }) {
  style(); document.body.classList.add("realm");
  const you = hello.you || {}, banner = BANNERS.find((b) => b.id === you.banner) || BANNERS[0];
  const card = document.createElement("div"); card.id = "realmcard";
  const cv = drawBanner(banner, 68, 52);
  card.append(cv);
  card.insertAdjacentHTML("beforeend", `<div class="rc-n">${esc(you.name || "You")}</div><div class="rc-h">House of ${esc(teamName(hello, myTeam))} · ${esc(banner.name)}</div>
    <div class="rc-clock"></div><div class="rc-house"></div><div class="rc-on"></div><div class="rc-note">Your lord keeps to his hall in the realm for now (taking the field comes later).</div>
    <div class="rc-leave"><button data-leave title="Choose whether to be warned of attacks, then go">Leave the realm</button>
    <div class="rc-out"><button data-out title="Sign this device out (your house stays yours)">Sign out</button><button data-outall title="Sign out on every device you have used">Sign out everywhere</button></div></div>`);
  hud.append(card);
  const conn = document.createElement("div"); conn.id = "realmconn"; conn.hidden = true; hud.append(conn);
  const clockEl = card.querySelector(".rc-clock"), onEl = card.querySelector(".rc-on"), houseEl = card.querySelector(".rc-house");
  let house = you.house || null, houseT = performance.now();
  let players = hello.players || [], lastClock = "";
  function drawPlayers() {
    const bOf = (p) => BANNERS.find((b) => b.id === p.banner) || BANNERS[0];
    const list = [...players].sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || String(a.name).localeCompare(b.name));
    const on = list.filter((p) => p.online).length;
    onEl.innerHTML = `${on} of ${list.length} online: ` + list.map((p) => `<span class="${p.online ? "" : "off"}" title="${esc(teamName(hello, p.team))}${p.online ? " · online" : " · away"}"><i style="background:var(--t${p.team === myTeam ? 0 : p.team === 0 ? myTeam : p.team}, ${bannerColor(bOf(p))})"></i>${esc(p.name)}${p.team === myTeam ? " (you)" : ""}</span>`).join("");
  }
  drawPlayers();
  // the house's standing: protection, the Keep's Peace, a siege
  let lastHouse = "";
  function drawHouse() {
    const h = house || {}, left = h.protectLeft ? Math.max(0, h.protectLeft - (performance.now() - houseT) / 1000) : 0;
    let cls = "", html = "";
    if (h.besieged && !h.keepsPeace) { cls = "siege"; html = "Your keep is <b>besieged</b>: if it is stormed with nobody left to hold it, your house falls."; }
    else if (left > 0) { cls = "prot"; html = `<b>Protected</b> for ${dur(left)}: nobody can attack you — and you can't attack anyone. Ordering an attack ends it.`; }
    else if (h.keepsPeace) { cls = "peace"; html = "<b>The Keep's Peace</b>: you were away — your keep cannot fall and your buildings will not burn, for a few minutes more."; }
    const k = cls + html; if (k === lastHouse) return; lastHouse = k;
    houseEl.className = "rc-house " + cls; houseEl.innerHTML = html;
  }
  drawHouse();
  const exit = exitFlow({ realm });
  card.querySelector("[data-leave]").onclick = () => exit.ask("leave");
  // signing out: this device (its attack warnings too), or every device (a second click confirms — no confirm() dialog:
  // the Mac app's web view has none)
  const outAll = card.querySelector("[data-outall]");
  card.querySelector("[data-out]").onclick = () => signOut(realm, false);
  outAll.onclick = () => { if (!outAll.classList.contains("warn")) { outAll.classList.add("warn"); outAll.textContent = "Click again: every device"; setTimeout(() => { outAll.classList.remove("warn"); outAll.textContent = "Sign out everywhere"; }, 5000); return; } signOut(realm, true); };
  return {
    askExit: exit.ask,
    players(list) { players = list || players; drawPlayers(); },
    house(h) { if (h) { house = h; houseT = performance.now(); } drawHouse(); },
    frame() {
      const c = realmClock(w.econ), wx = w.wx ? ` · ${wxBadge(w.weather)}${w.wx.wet > 0.45 ? ", mud" : w.wx.snowCover > 0.3 ? ", snow lies" : ""}` : "";
      const k = `${c.day}|${c.season}|${c.date}|${c.year}|${wx}`;
      if (k !== lastClock) { lastClock = k; clockEl.innerHTML = `<b>Day ${c.day}</b> of the realm · ${c.season}, ${c.date} · year ${c.year}${wx}`; }
      if (house?.protectLeft && performance.now() - houseT > 30000) drawHouse(); // (the countdown, between states)
    },
    connection(s, why) {
      if (s === "online" || s === "left") { conn.hidden = true; return; }
      conn.hidden = false;
      if (s === "refused") { dropSession(); conn.innerHTML = `This device was signed out (${esc(why || "signed out")}). <a href="/play.html" style="color:inherit;pointer-events:auto">Sign in again</a>`; return; }
      conn.textContent = `Reconnecting to the realm… (${why || "lost the connection"}) · your orders wait`;
    },
  };
}
// sign out: this device's push subscription is dropped (best effort), the session revoked, the page back to play.html
async function signOut(realm, everywhere) {
  const s = savedSession(), post = (p, b) => fetch(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  realm?.leave?.();
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : null, sub = reg && await reg.pushManager?.getSubscription();
    if (sub && s) { await post("push/unsubscribe", { s, endpoint: sub.endpoint }); await sub.unsubscribe(); }
  } catch { /* no push here */ }
  try { if (s) await post(everywhere ? "auth/logout-all" : "auth/logout", { s }); } catch { /* the device forgets it anyway */ }
  dropSession();
  location.replace("play.html?signedout");
}
function teamName(hello, team) { return hello.teams?.find((t) => t.id === team)?.name || `team ${team + 1}`; }

// Leaving the realm: "Would you like to be notified if your men see an attack?" — asked at EVERY exit, never a saved
// setting. The choice arms (or disarms) attack notifications for THIS absence only; the server clears it the moment the
// player next connects (server/realm.mjs, server/push.mjs). "Notify me" is the user gesture that, on first use, asks
// Notification permission and subscribes the device (Web Push, self-hosted: sw.js + server/push.mjs); the subscription
// plumbing may persist — the choice cannot. Exits are caught two ways:
//   * the realm card's "Leave the realm" button: the question, then disconnect and close the window where allowed;
//   * closing the window outright: a beforeunload bounce (the browser's own leave dialog, once) — if the player stays,
//     the question is put at once; answered, the next close goes through clean.
// Where the platform cannot push — the Mac app's WKWebView has no Push API; iPhone Safari only grows one once
// HIGHGROUND is on the Home Screen — the card says so plainly instead of asking.
function exitFlow({ realm }) {
  const token = savedSession(); // (the push routes know the account by its session: server/realm.mjs pushRoute)
  const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installed = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  const canPush = !!token && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  let answered = false, asking = false, pending = null; // pending: a bounce-mode answer, sent only at the REAL exit (below)
  const post = (path, body) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true });
  // A bounce-mode "Notify me" is given while still connected and playing on: arming at once would ring them at their own
  // screen on any Wi-Fi blip (the house reads offline the moment the socket drops) and the next reconnect would clear it.
  // So the answer waits here and rides out with the page itself.
  window.addEventListener("pagehide", () => {
    if (pending === null || !token) return;
    try { navigator.sendBeacon("push/arm", new Blob([JSON.stringify({ s: token, on: pending })], { type: "application/json" })); } catch { /* the default is off */ }
  });
  async function ensurePush() { // register the worker, get leave to notify, subscribe this device with the realm's VAPID key
    const reg = await navigator.serviceWorker.register(SW_URL);
    if (await Notification.requestPermission() !== "granted") throw new Error("notifications are blocked for this site — allow them in the browser's site settings");
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const kr = await fetch("push/key"); if (!kr.ok) throw new Error("the realm has no push key");
      const raw = atob(String((await kr.json()).key).replace(/-/g, "+").replace(/_/g, "/")), key = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) key[i] = raw.charCodeAt(i);
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
    const r = await post("push/subscribe", { s: token, sub: sub.toJSON() });
    if (!r.ok) throw new Error("the realm refused this device");
  }
  function ask(mode = "leave") {
    if (asking) return; asking = true;
    style();
    if (canPush) { try { navigator.serviceWorker.register(SW_URL); } catch { /* ensurePush retries */ } } // (early: permission/subscribe then sit close to the click, which WebKit insists on)
    const modal = document.querySelector("#modal"), leaving = mode === "leave";
    modal.innerHTML = `<div id="realmexit"><h2>${leaving ? "Riding out" : "Before you go"}</h2>
      ${canPush ? `<p>Would you like to be notified if your men see an attack?</p>
        <div class="re-h">It holds for this absence only — you will be asked again next time. Your warden defends the house either way.</div>`
      : `<p>Your men cannot send word to this window${iOS && !installed ? " — on iPhone: Share → Add to Home Screen, then open HIGHGROUND from the Home Screen to be warned of attacks" : " — open the realm in Chrome, Edge or Firefox to be warned of attacks"}.</p>
        <div class="re-h">Your warden and captains will defend the house while you are away.</div>`}
      <div class="re-b"><button class="re-stay" data-stay>Stay in the realm</button>
        ${canPush ? `<button data-no>Not this time</button><button class="on" data-yes>Notify me</button>` : `<button class="on" data-no>${leaving ? "Leave" : "Very well"}</button>`}</div></div>`;
    modal.hidden = false;
    const hintEl = modal.querySelector(".re-h"), hint = (m) => { hintEl.textContent = m; };
    const settle = () => { answered = true; window.removeEventListener("beforeunload", onBefore); };
    const dismiss = () => { modal.hidden = true; modal.innerHTML = ""; asking = false; };
    const done = () => { settle(); if (leaving) leaveNow(); else dismiss(); };
    function leaveNow() { // disconnect for good, close the window where the platform lets a page close itself
      pending = null; // (the choice was posted directly; a lingering left-open tab must not re-send it long after)
      modal.querySelector(".re-b").remove();
      realm?.leave?.();
      setTimeout(() => { try { window.close(); } catch { /* not ours to close */ } }, 200);
      setTimeout(() => { hint("Farewell. You can close this window now."); asking = false; }, 800);
    }
    modal.querySelector("[data-stay]").onclick = dismiss; // (no answer given: the question stands for the real exit)
    modal.querySelector("[data-no]").onclick = async () => {
      pending = false; // (any earlier bounce answer is overruled; the beacon resends the same value, harmlessly)
      if (leaving) { try { await post("push/arm", { s: token, on: false }); } catch { /* off is the server's default */ } }
      done();
    };
    const yes = modal.querySelector("[data-yes]");
    if (yes) yes.onclick = async () => {
      for (const b of modal.querySelectorAll(".re-b button")) b.disabled = true;
      hint("Arranging the watch…");
      try {
        await ensurePush(); // (the device subscription itself: done now, on the click)
        if (leaving) { const r = await post("push/arm", { s: token, on: true }); if (!r.ok) throw new Error("the realm did not take the order"); }
        pending = true; // (at a bounce: armed only when the page really goes — see pagehide above; at a leave: the beacon just repeats it)
        hint("Your men will send word if the house is attacked."); done();
      } catch (e) {
        hint(`No watch could be set: ${e.message}.`);
        for (const b of modal.querySelectorAll(".re-b button")) b.disabled = false;
        yes.textContent = "Try again"; modal.querySelector("[data-no]").textContent = leaving ? "Leave without it" : "Not this time";
      }
    };
  }
  // an X-close with the question unanswered: bounce once with the browser's own dialog; if the player stays, ask at once
  // (never on the page's own reloads: starting over after a fall (4003), a refused token, or having already left)
  const onBefore = (e) => {
    if (answered || asking || !realm || realm.left || realm.status === "restarting" || realm.status === "refused") return;
    e.preventDefault(); e.returnValue = "Would you like to be notified if your men see an attack? Stay a moment and choose.";
    setTimeout(() => { if (!answered && !asking) ask("bounce"); }, 250);
  };
  if (canPush) window.addEventListener("beforeunload", onBefore);
  return { ask };
}

// "While you were away": the team's chronicle since the player last looked (hello.away). onJump(x, y) looks there.
export function showAway(modal, lines, { onJump, name } = {}) {
  style();
  if (!lines?.length) return false;
  const tail = lines.slice(-60);
  modal.innerHTML = `<div id="realmaway"><h2>While you were away</h2><div class="ra-s">${esc(name ? `${name}, ` : "")}${lines.length} thing${lines.length === 1 ? "" : "s"} happened in your lands${lines.length > tail.length ? ` (the last ${tail.length} shown)` : ""}. Click one to look there.</div>
    <ul>${tail.map((L, k) => `<li class="${esc(L.tone || "")}" data-k="${k}">${L.date ? `<small>${esc(L.date)}</small>` : ""}${esc(L.text)}</li>`).join("")}</ul>
    <div class="ra-b"><button data-close class="on">To my lands</button></div></div>`;
  modal.hidden = false;
  modal.querySelector("[data-close]").onclick = () => { modal.hidden = true; modal.innerHTML = ""; };
  modal.querySelectorAll("li[data-k]").forEach((li) => li.onclick = () => { const L = tail[+li.dataset.k]; if (Number.isFinite(L.x)) { modal.hidden = true; modal.innerHTML = ""; onJump?.(L.x, L.y); } });
  return true;
}

const dur = (s) => { s = Math.max(0, s); const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.ceil((s % 3600) / 60); return d ? `${d} day${d > 1 ? "s" : ""} ${h} h` : h ? `${h} h ${m} min` : `${m} min`; };

// Found your house: arms (the heraldry's banners; those other houses fly are marked) and a house name. → {banner, house}
export function chooseHouse(modal, hello) {
  style();
  const you = hello.you || {}, h = you.house || {}, taken = new Set((hello.teams || []).filter((t) => t.id !== you.team && t.founded && t.banner !== null && t.banner !== undefined).map((t) => t.banner));
  const held = (hello.holds || []).filter((x) => x.house), rules = h.rules || {};
  let pick = BANNERS.find((b) => b.id === h.banner && !taken.has(b.id)) || BANNERS.find((b) => !taken.has(b.id)) || BANNERS[0];
  return new Promise((resolve) => {
    modal.innerHTML = `<div id="realmfound"><h2>${h.prevName ? "Start again" : "Found your house"}</h2>
      <div class="rf-s">${h.prevName ? `House ${esc(h.prevName)} has fallen. ` : ""}Your hold is <b>${esc(h.hold || "a free hold")}</b>. Choose your arms and the name of your house.
      For the first ${Math.round((rules.protectHours || 72) / 24)} days nobody can attack you — and you can't attack anyone unless you choose to (that ends your protection).
      While you are away your warden and captains defend, and your keep cannot fall.</div>
      <div class="rf-b"></div>
      <label for="rfname">The house of…</label><input id="rfname" maxlength="32" autocomplete="off" value="${esc(h.prevName || you.name || "")}">
      <div class="rf-h">${held.length ? `The realm's houses: ${held.map((x) => `<b>${esc(x.house)}</b> at ${esc(x.name)}`).join(", ")}.` : "You are the first house in the realm."}</div>
      <div class="rf-go"><button class="on" data-go>Found the house</button></div></div>`;
    const grid = modal.querySelector(".rf-b"), name = modal.querySelector("#rfname"), go = modal.querySelector("[data-go]");
    for (const b of BANNERS) {
      const bt = document.createElement("button"); bt.title = b.name + (taken.has(b.id) ? " (another house flies these arms)" : ""); bt.dataset.id = b.id;
      bt.className = (b.id === pick.id ? "on " : "") + (taken.has(b.id) ? "taken" : "");
      bt.append(drawBanner(b, 96, 120)); const sm = document.createElement("small"); sm.textContent = b.name; bt.append(sm);
      bt.onclick = () => { pick = b; for (const q of grid.children) q.classList.toggle("on", +q.dataset.id === b.id); };
      grid.append(bt);
    }
    const ok = () => { go.disabled = !name.value.trim(); }; name.oninput = ok; ok();
    const done = () => { if (!name.value.trim()) return; modal.hidden = true; modal.innerHTML = ""; resolve({ banner: pick.id, house: name.value.trim().slice(0, 32) }); };
    go.onclick = done; name.onkeydown = (e) => { if (e.key === "Enter") done(); };
    modal.hidden = false; setTimeout(() => name.focus(), 50);
  });
}

// "Your house has fallen": the reign in a few lines, and a new beginning. onRestart() → the server's restart op.
export function showFallen(modal, fallen, { onRestart } = {}) {
  style();
  const r = fallen?.reign || {}, n = (v) => (v ?? 0).toLocaleString();
  modal.innerHTML = `<div id="realmfell"><h2>Your house has fallen</h2>
    <div class="rf-s">House ${esc(r.name || "")} held ${esc(r.hold || "its hold")} for ${n(r.days)} day${r.days === 1 ? "" : "s"} of the realm (${r.realHours ?? 0} hours)${r.by ? `, until ${esc(r.by)} took it` : ""}: ${esc(r.why || "the keep was taken")}.</div>
    <div class="rf-st"><div><b>${n(r.slain)}</b>enemies slain</div><div><b>${n(r.lost)}</b>men lost</div><div><b>${n(r.built)}</b>buildings raised</div><div><b>${n(r.peakMen)}</b>men under arms at the height</div></div>
    ${fallen?.chronicle?.length ? `<div class="rf-s">From the chronicle of the house:</div><ul>${fallen.chronicle.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
    <div class="rf-s">Its people have scattered and its halls are ruins. That is part of the game: start again at a free hold, with fresh protection.</div>
    <div class="rf-go"><button data-look>Look on the ruins</button><button class="on" data-go>Start over</button></div></div>`;
  modal.hidden = false;
  modal.querySelector("[data-look]").onclick = () => { modal.hidden = true; modal.innerHTML = ""; };
  const go = modal.querySelector("[data-go]");
  go.onclick = () => { go.disabled = true; go.textContent = "Riding out…"; onRestart?.((err) => { go.disabled = false; go.textContent = "Start over"; modal.querySelector(".rf-s:last-of-type").textContent = err; }); };
}
