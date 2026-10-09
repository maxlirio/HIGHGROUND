// The lord in the field — the player's side of js/sim/avatar.js: the "Take the field" button and placement,
// the third-person view (Tab toggles it with the eagle view; the sim never pauses), the controls, the HUD,
// the order radial, his banner in 3D and on the map, and the feedback (camera shake, red flash, sound hooks).
//
//   WASD / arrows   move (camera-relative)      Shift  gallop / run        Z  walk ↔ trot
//   mouse           look / turn                 left   strike (tap = quick cut, hold & release = committed blow)
//   right / Space   guard (shield up)           F      couch the lance (charge)     E  dismount / mount
//   Q (hold)        order radial (move the mouse, release; or 1–6 while it is open) — to the selected groups, else
//                   every company within his presence
//   C               free the cursor: the ordinary RTS interface (click a label / drag a box, click the ground or an
//                   enemy, Shift chains, X deselect) works exactly as in the eagle view, orders travelling from him;
//                   WASD still rides. C again: back to mouse-look and the sword.  ·  Tab  eagle view ↔ the lord
//   Groups (1–9, Ctrl/⌘+1–9, B), T follow me, Y rally, U form up, H find him: js/ui/command-keys.js
//
// Sound: every notable thing he does or suffers is dispatched as `window` CustomEvent "hg-sound"
// ({ kind, x, y, ... }) for the audio layer to pick up.
import * as THREE from "three";
import { takeField, canTakeField, embody, lordOrder, lordStatus, nearbyUnits, LORD_ORDERS, AV } from "../sim/avatar.js";
import { ARMS } from "../sim/arms.js";
import { nameOf } from "../sim/legend.js";
import { glyphSVG } from "./glyphs.js";

const CSS = `
#lordbtn { white-space:nowrap; flex:none; } #lordbtn.on { background:#5a4722; border-color:var(--gold); }
body.lordview #overlays, body.lordview #bpanel, body.lordview:not(.lordcursor) #selinfo, body.lordview:not(.lordcursor) #selbar, body.lordview:not(.lordcursor) #orderpop { display:none !important; }
body.lordview.lordcursor #selinfo { display:none !important; } /* (the list on the right shows the selection) */
body.lordview.lordcursor #lordhud .cross { display:none; }
body.lordview.lordcursor #lordhud .units { pointer-events:auto; } body.lordview.lordcursor #lordhud .u { cursor:pointer; } body.lordview.lordcursor #lordhud .u:hover { background:#3a3224; }
#lordhud .mode { position:absolute; left:14px; top:46px; background:var(--panel); border:1px solid var(--gold); border-radius:3px; padding:3px 10px; font-size:12px; color:var(--gold); letter-spacing:.12em; text-transform:uppercase; }
body.lordview #chron { opacity:.75; }
#lordhud { position:fixed; inset:0; pointer-events:none; font:13px/1.25 "Iowan Old Style", Palatino, Georgia, serif; color:var(--ink); z-index:5; }
#lordhud[hidden] { display:none; }
#lordhud .card { position:absolute; left:14px; bottom:14px; width:270px; background:var(--panel); border:1px solid var(--edge); border-radius:4px; padding:10px 12px; }
#lordhud .card h3 { margin:0 0 2px; font-size:15px; color:var(--gold); display:flex; align-items:center; gap:8px; }
#lordhud .card h3 img { width:26px; height:20px; border:1px solid #000; }
#lordhud .sub { color:var(--dim); font-size:12px; margin-bottom:6px; }
#lordhud .row { display:flex; justify-content:space-between; color:var(--dim); font-size:12px; }
#lordhud .row b { color:var(--ink); font-weight:400; }
#lordhud .bar { height:6px; background:#111; border-radius:2px; overflow:hidden; margin:2px 0 5px; }
#lordhud .bar i { display:block; height:100%; background:var(--gold); transition:width .15s; }
#lordhud .bar.hp i { background:#b8402f; } #lordhud .bar.st i { background:#c9a24a; } #lordhud .bar.hw i { background:#7d6a4b; }
#lordhud .tags { display:flex; flex-wrap:wrap; gap:4px; margin-top:4px; }
#lordhud .tag { font-size:11px; border:1px solid var(--edge); border-radius:3px; padding:1px 5px; color:var(--dim); }
#lordhud .tag.on { color:#1b1812; background:var(--gold); border-color:var(--gold); }
#lordhud .tag.warn { color:#fff; background:#8b2a22; border-color:#c2493d; }
#lordhud .units { position:absolute; right:14px; top:46px; width:300px; background:var(--panel); border:1px solid var(--edge); border-radius:4px; padding:8px 10px; }
#lordhud .units h4 { margin:0 0 4px; font-size:12px; letter-spacing:.15em; text-transform:uppercase; color:var(--dim); font-weight:400; }
#lordhud .u { display:grid; grid-template-columns:18px 22px 1fr auto; gap:6px; align-items:center; padding:2px 3px; border-radius:3px; font-size:12px; }
#lordhud .u.sel { background:#5a4722; } #lordhud .u .k { font:11px ui-monospace, monospace; color:var(--gold); text-align:center; }
#lordhud .units .selsum { color:var(--ink); font-size:12px; margin:-2px 0 4px; } #lordhud .units .selsum i { color:var(--dim); font-style:normal; }
#lordhud .u svg { width:18px; height:18px; background:var(--t0, #2f5fa8); border-radius:2px; }
#lordhud .u .st { color:var(--dim); } #lordhud .u .st.bad { color:#ff9a7a; } #lordhud .u .ch { color:var(--dim); font-size:11px; white-space:nowrap; }
#lordhud kbd { font:11px ui-monospace, monospace; border:1px solid var(--edge); border-radius:3px; padding:0 4px; color:var(--ink); }
#lordhud .cross { position:absolute; left:50%; top:46%; width:14px; height:14px; margin:-7px 0 0 -7px; border:1px solid rgba(255,255,255,.55); border-radius:50%; }
#lordhud .charge { position:absolute; left:50%; top:46%; width:90px; height:4px; margin:18px 0 0 -45px; background:#0008; border-radius:2px; overflow:hidden; }
#lordhud .charge i { display:block; height:100%; background:var(--gold); }
#lordhud .reticle { position:absolute; left:0; top:0; width:30px; height:30px; margin:-15px 0 0 -15px; border:2px solid #e8c35a; border-radius:50%; box-shadow:0 0 6px #000; }
#lordhud .flash { position:absolute; inset:0; background:radial-gradient(ellipse at center, transparent 45%, rgba(150,10,5,.75)); opacity:0; transition:opacity .5s; }
#lordhud .radial { position:absolute; left:50%; top:46%; width:0; height:0; }
#lordhud .radial div { position:absolute; width:118px; margin-left:-59px; margin-top:-15px; text-align:center; padding:6px 4px; background:var(--panel); border:1px solid var(--edge); border-radius:16px; font-size:13px; }
#lordhud .radial div.hi { background:#5a4722; border-color:var(--gold); color:#fff; }
#lordhud .radial div small { color:var(--dim); font:10px ui-monospace, monospace; margin-right:4px; }
#lordhud .radial .to { position:absolute; width:220px; margin-left:-110px; top:112px; text-align:center; color:var(--dim); font-size:12px; background:none; border:0; }
#lordhud .banner-alert { position:absolute; left:50%; top:88px; transform:translateX(-50%); color:#ffd98a; font-size:15px; text-shadow:0 1px 3px #000; }
#lordcard { position:fixed; inset:0; display:grid; place-items:center; background:radial-gradient(ellipse at center, rgba(0,0,0,.35), rgba(0,0,0,.8)); z-index:19; opacity:0; transition:opacity .8s; pointer-events:none; }
#lordcard.show { opacity:1; }
#lordcard .c { text-align:center; max-width:560px; padding:0 20px; }
#lordcard .k { font-size:12px; letter-spacing:.3em; text-transform:uppercase; color:var(--gold); }
#lordcard h2 { font-size:38px; margin:8px 0; color:#f3e9cf; } #lordcard p { color:#d9cfb5; font-style:italic; font-size:15px; }
.lordlab { position:absolute; left:0; top:0; display:flex; align-items:center; gap:4px; font:600 12px/1 ui-sans-serif, system-ui, sans-serif; color:#fff; text-shadow:0 1px 2px #000; white-space:nowrap; pointer-events:none; }
.lordlab[hidden] { display:none; } /* (display:flex above would otherwise keep a hidden label on screen at its last place) */
.lordlab img { width:24px; height:18px; border:1px solid #000; box-shadow:0 1px 3px #000; }
#lordhint { position:fixed; pointer-events:none; background:var(--panel); border:1px solid var(--edge); border-radius:3px; padding:3px 8px; font-size:12px; z-index:6; }
#lordhint.bad { border-color:#c2493d; color:#ffb4a8; }
`;

const CHANNEL = { voice: "🗣 voice", horn: "📯 horn", rider: "✉ rider" };
const STATE_BAD = new Set(["wavering", "shaken", "routing"]);

export function makeAvatarUI({ w, camera, canvas, scene, map, PLAYER, groundAt, toScreen, toast, log, bannerCanvas, onOrders, params, selected, refreshSel }) {
  const S = w.S;
  const style = document.createElement("style"); style.textContent = CSS; document.head.append(style);
  const bannerURL = bannerCanvas.toDataURL();
  // ---- the button
  const btn = document.createElement("button"); btn.id = "lordbtn"; btn.textContent = "Take the field";
  btn.title = "Put your lord on the field with his banner and household knights; ride, fight and command from the saddle (Tab: his view ↔ the eagle view; in his view C frees the cursor to select and order groups)";
  const bar = document.querySelector("#topbar"); (bar.querySelector("#cmdbtn") || bar.lastChild).before(btn);
  // ---- HUD
  const hud = document.createElement("div"); hud.id = "lordhud"; hud.hidden = true;
  hud.innerHTML = `<div class="flash"></div><div class="cross"></div><div class="charge" hidden><i></i></div><div class="reticle" hidden></div>
    <div class="banner-alert" hidden></div><div class="radial" hidden></div>
    <div class="card"></div><div class="units"></div><div class="mode" hidden>Commanding — <kbd>C</kbd> to fight</div>`;
  // (the controls hint under the view is js/ui/command-keys.js, shared with the eagle view)
  document.body.append(hud);
  const $h = (s) => hud.querySelector(s);
  const card = document.createElement("div"); card.id = "lordcard"; document.body.append(card);
  const hint = document.createElement("div"); hint.id = "lordhint"; hint.hidden = true; document.body.append(hint);
  const lab = document.createElement("div"); lab.className = "lordlab"; lab.hidden = true; document.querySelector("#labels").append(lab);
  const bLab = document.createElement("div"); bLab.className = "lordlab"; bLab.hidden = true; bLab.innerHTML = `<img src="${bannerURL}">`; document.querySelector("#labels").append(bLab);

  // ---- 3D banner: a cloth on a lance-pole over the banner-bearer, waving
  const bTex = new THREE.CanvasTexture(bannerCanvas); bTex.colorSpace = THREE.SRGBColorSpace;
  const clothGeo = new THREE.PlaneGeometry(1.5, 1.1, 12, 4); clothGeo.translate(0.75, 0, 0);
  const cloth = new THREE.Mesh(clothGeo, new THREE.MeshStandardMaterial({ map: bTex, side: THREE.DoubleSide, roughness: 0.9 }));
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 4.6, 6), new THREE.MeshStandardMaterial({ color: "#5b4630", roughness: 0.8 }));
  const bannerObj = new THREE.Group(); bannerObj.add(pole, cloth); pole.position.y = 2.3; cloth.position.y = 4.0; bannerObj.visible = false; scene.add(bannerObj);
  const clothBase = clothGeo.attributes.position.array.slice();

  // ---- state
  let placing = false, active = false, cursor = false, entered = false, cursorDist = 120, lostShown = null, hintT = 0, hudT = 0, shake = 0, flashT = 0;
  let camYaw = 0, camPitch = 0.28, camDist = 9, radial = null, lastPos = null, fov0 = camera.cam.fov;
  const sel = selected; let nearby = []; // (the one selection: js/main.js's, the same as in the eagle view)
  const houseId = () => (w.avatar ? S.unit[w.avatar.lord] : -1);
  const keys = new Set(); let walk = false;
  const inp = () => w.avatar?.input;
  const sound = (kind, extra = {}) => dispatchEvent(new CustomEvent("hg-sound", { detail: { kind, ...extra } }));
  const lordName = () => w.lordNames?.[PLAYER] || (w.avatar ? "Sir " + nameOf(S.name[w.avatar.lord]) : "Your lord"); // (a ranked lord's own name: js/sim/battle.js)

  // ---------------------------------------------------------------- placement
  btn.onclick = () => {
    const A = w.avatar;
    if (A && !A.outcome) { setActive(!active); return; }
    const why = A?.outcome ? canTakeField(w, PLAYER, S.x[A.lord], S.y[A.lord]) : null;
    if (why && /fallen|ransom/.test(why)) { toast(why); return; }
    placing = !placing; btn.classList.toggle("on", placing);
    if (placing) toast("Click open ground near your men — not within 120 m of the enemy — where your lord takes the field");
    else hint.hidden = true;
  };
  addEventListener("pointermove", (e) => {
    if (active && !cursor) { // mouse look (pointer lock gives movementX/Y without the cursor leaving)
      if (radial) { radial.vx += e.movementX; radial.vy += e.movementY; return; }
      camYaw -= e.movementX * 0.0032; camPitch = Math.max(-0.05, Math.min(0.95, camPitch + e.movementY * 0.0025));
      return;
    }
    if (!placing || performance.now() - hintT < 90) return; hintT = performance.now();
    const gp = groundAt(e.clientX, e.clientY); if (!gp) { hint.hidden = true; return; }
    const why = canTakeField(w, PLAYER, gp.x, gp.y);
    hint.textContent = why || "Your lord takes the field here"; hint.classList.toggle("bad", !!why);
    hint.style.left = e.clientX + 16 + "px"; hint.style.top = e.clientY + 16 + "px"; hint.hidden = false;
  });
  function placeAt(gp) {
    const r = takeField(w, PLAYER, gp.x, gp.y);
    if (r.error) { toast(r.error); return false; }
    placing = false; btn.classList.remove("on"); hint.hidden = true;
    log(`${lordName()} takes the field with his banner and ${r.unit.members.length - 1} knights of his household`, { x: gp.x, y: gp.y, tone: "legend" });
    sound("horn", { x: gp.x, y: gp.y });
    lostShown = null; setActive(true);
    return true;
  }

  // ---------------------------------------------------------------- the view
  function setActive(on) {
    const A = w.avatar;
    if (on && (!A || A.outcome)) return;
    if (on === active) return;
    active = on; embody(w, on);
    document.body.classList.toggle("lordview", on); hud.hidden = !on; btn.textContent = on ? "Eagle view (Tab)" : A && !A.outcome ? "Lord's view (Tab)" : "Take the field";
    if (on) {
      camYaw = S.facing[A.lord]; camPitch = 0.28; camDist = S.horseOK[A.lord] === 1 ? 9 : 5.5; lastPos = null;
      fov0 = camera.cam.fov; camera.cam.fov = 55; camera.st.drive = drive;
      if (canvas.requestPointerLock && !params.has("shot")) canvas.requestPointerLock()?.catch?.(() => {});
    } else {
      camera.st.drive = null; camera.cam.fov = fov0; camera.cam.updateProjectionMatrix();
      if (A) { camera.focus(S.x[A.lord], S.y[A.lord]); camera.setView(2); }
      if (document.pointerLockElement) document.exitPointerLock();
      keys.clear(); radial = null; $h(".radial").hidden = true;
    }
    if (!on) setCursor(false);
    if (on && !entered) { entered = true; api.onEnter?.(); }
  }
  // C: the cursor comes free and the ordinary RTS interface works from his view (he keeps riding on WASD); the camera
  // rises behind him so the field can be seen and clicked. C again: mouse-look and the sword.
  function setCursor(on) {
    if (on === cursor) return;
    cursor = on; document.body.classList.toggle("lordcursor", on); $h(".mode").hidden = !on;
    const I = inp(); if (I) { I.down = false; I.guard = keys.has(" "); } rmb = false;
    if (on) {
      cursorDist = 120;
      if (document.pointerLockElement) document.exitPointerLock();
      radial = null; $h(".radial").hidden = true; refreshSel?.();
    } else {
      canvas.style.cursor = "";
      if (active && canvas.requestPointerLock && !params.has("shot")) canvas.requestPointerLock()?.catch?.(() => {});
    }
  }
  const tgtV = new THREE.Vector3(), posV = new THREE.Vector3();
  let interp = 0;
  function drive(cam, dt, aspect) {
    const A = w.avatar; if (!A) return;
    const L = A.lord, x = S.x[L] + S.vx[L] * interp, y = S.y[L] + S.vy[L] * interp;
    if (cursor) { // commanding: a steep look down on him and the ground about him (his army is usually behind him), turned the way he faces
      const P = 1.0, gz = map.h(x, y) + (w.castleLevelH ? w.castleLevelH(L) : 0), back = cursorDist * Math.cos(P);
      posV.set(x - Math.cos(camYaw) * back, gz + cursorDist * Math.sin(P), -(y - Math.sin(camYaw) * back));
      if (!lastPos) lastPos = posV.clone(); else lastPos.lerp(posV, 1 - Math.exp(-dt * 6));
      cam.position.copy(lastPos); tgtV.set(x - Math.cos(camYaw) * cursorDist * 0.3, gz, -(y - Math.sin(camYaw) * cursorDist * 0.3));
      cam.lookAt(tgtV); cam.near = 1; cam.aspect = aspect; cam.updateProjectionMatrix();
      camera.st.tx = x; camera.st.ty = y; camera.st.dist = cursorDist; return;
    }
    const mounted = S.horseOK[L] >= 1, down = S.posture[L] !== 0;
    const want = mounted ? camDist : Math.min(camDist, 7) * 0.7;
    const eye = map.h(x, y) + (w.castleLevelH ? w.castleLevelH(L) : 0) + (down ? 0.6 : mounted ? 2.7 : 1.75); // (up on a wall-walk / a keep floor: js/render/castle.js)
    const sh = mounted ? 0.9 : 0.55; // (over his right shoulder, so he does not stand in the middle of what you look at)
    const cx = x - Math.cos(camYaw) * want * Math.cos(camPitch) + Math.sin(camYaw) * sh, cy = y - Math.sin(camYaw) * want * Math.cos(camPitch) - Math.cos(camYaw) * sh;
    let cz = eye + want * Math.sin(camPitch) + 0.6;
    if (map.inBounds(cx, cy)) cz = Math.max(cz, map.h(cx, cy) + 0.8);
    const sx = shake ? (Math.random() - 0.5) * shake : 0, sy = shake ? (Math.random() - 0.5) * shake : 0;
    shake = Math.max(0, shake - dt * 1.6);
    posV.set(cx + sx, cz + sy, -cy);
    if (!lastPos) lastPos = posV.clone(); else lastPos.lerp(posV, 1 - Math.exp(-dt * 10));
    cam.position.copy(lastPos);
    const ahead = mounted ? 7 : 4.5;
    tgtV.set(x + Math.cos(camYaw) * ahead + Math.sin(camYaw) * sh, eye + 0.2 - Math.sin(camPitch) * ahead * 0.35, -(y + Math.sin(camYaw) * ahead - Math.cos(camYaw) * sh));
    cam.lookAt(tgtV); cam.near = 0.3; cam.aspect = aspect; cam.updateProjectionMatrix();
    camera.st.tx = x; camera.st.ty = y; camera.st.dist = want; // (other layers read where the camera is looking)
  }

  // ---------------------------------------------------------------- input
  const typing = (e) => e.target.closest?.("input,textarea");
  addEventListener("keydown", (e) => {
    if (typing(e)) return;
    if (e.key === "Tab") { e.preventDefault(); if (w.avatar && !w.avatar.outcome) setActive(!active); return; }
    if (!active) return;
    const k = e.key.toLowerCase(), I = inp(); if (!I) return;
    keys.add(k);
    if (e.repeat) return;
    if (k === "e") I.mount = true;
    else if (k === "f") { I.charge = !I.charge; if (I.charge) sound("couch"); }
    else if (k === "z") walk = !walk;
    else if (k === " ") I.guard = true;
    else if (k === "c" && !e.ctrlKey && !e.metaKey) setCursor(!cursor);
    else if (k === "q" && !cursor) { radial = { vx: 0, vy: 0 }; showRadial(); }
    else if (/^[1-9]$/.test(k) && radial) { const o = LORD_ORDERS[+k - 1]; if (o) { give(o.key); radial = null; $h(".radial").hidden = true; } }
  });
  addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase(); keys.delete(k);
    if (!active) return; const I = inp(); if (!I) return;
    if (k === " ") I.guard = rmb;
    if (k === "q" && radial) { const i = radialPick(); radial = null; $h(".radial").hidden = true; if (i >= 0) give(LORD_ORDERS[i].key); }
  });
  addEventListener("blur", () => { keys.clear(); });
  let rmb = false, downAt = 0;
  canvas.addEventListener("pointerdown", (e) => {
    if (placing && e.button === 0) { e.stopImmediatePropagation(); return; }
    if (!active || cursor) return; // (with the cursor free, clicks are orders: js/main.js)
    e.preventDefault(); e.stopImmediatePropagation();
    if (!document.pointerLockElement && canvas.requestPointerLock && !params.has("shot")) canvas.requestPointerLock()?.catch?.(() => {});
    const I = inp(); if (!I) return;
    if (e.button === 0) { I.down = true; downAt = performance.now(); }
    if (e.button === 2) { rmb = true; I.guard = true; }
  }, true);
  addEventListener("pointerup", (e) => {
    if (placing && e.button === 0 && e.target === canvas) { const gp = groundAt(e.clientX, e.clientY); if (gp) placeAt(gp); e.stopImmediatePropagation(); return; }
    if (!active || cursor) return;
    e.stopImmediatePropagation();
    const I = inp(); if (!I) return;
    if (e.button === 0 && I.down) { I.down = false; I.releases.push((performance.now() - downAt) / 1000); }
    if (e.button === 2) { rmb = false; I.guard = keys.has(" "); }
  }, true);
  canvas.addEventListener("contextmenu", (e) => { if (active && !cursor) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  canvas.addEventListener("wheel", (e) => { if (active && cursor) cursorDist = Math.max(40, Math.min(420, cursorDist * Math.exp(e.deltaY * 0.0012))); else if (active) camDist = Math.max(3.5, Math.min(40, camDist * Math.exp(e.deltaY * 0.0012))); }, { passive: true });

  function readMove() {
    const I = inp(); if (!I) return;
    const f = (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0);
    const r = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
    const cf = Math.cos(camYaw), sf = Math.sin(camYaw);
    I.mx = cf * f + sf * r; I.my = sf * f - cf * r; // (right of a heading (cos, sin) is (sin, −cos))
    I.gait = keys.has("shift") ? 2 : walk ? 0 : 1;
    I.aim = camYaw;
  }

  // ---------------------------------------------------------------- orders
  function give(kind) {
    const A = w.avatar; if (!A || A.outcome) return;
    const ids = sel.size ? [...sel].filter((id) => id !== houseId() && w.units.get(id) && !w.units.get(id).household) : null;
    const r = lordOrder(w, kind, ids);
    const label = LORD_ORDERS.find((o) => o.key === kind)?.label || kind;
    if (kind === "rally") sound("warcry", { x: S.x[A.lord], y: S.y[A.lord] });
    else sound("order-shout", { order: kind, x: S.x[A.lord], y: S.y[A.lord] });
    if (!r.n) { toast(kind === "charge" && r.target === null ? `"${label}" — but there is no enemy before you` : `"${label}" — nobody within ${Math.round(A.presenceR || AV.presenceR)} m to hear it (select a group first: C, then click its label)`); return; }
    const ch = Object.entries(r.channels).filter(([, n]) => n).map(([c, n]) => `${n} by ${c}`).join(", ");
    toast(`"${label}" — ${r.n} ${r.n > 1 ? "companies" : "company"}${ch ? ` (${ch})` : ""}`);
    if (r.channels.horn) sound("horn", { order: kind });
    onOrders?.(ids || nearby.filter((q) => q.d <= (A.presenceR || AV.presenceR)).map((q) => q.id));
  }
  function showRadial() {
    const el = $h(".radial"); el.hidden = false;
    const to = sel.size ? `to ${sel.size} chosen ${sel.size > 1 ? "companies" : "company"}` : `to every company within ${Math.round(w.avatar?.presenceR || AV.presenceR)} m`;
    el.innerHTML = LORD_ORDERS.map((o, i) => { const a = -Math.PI / 2 + i * Math.PI * 2 / LORD_ORDERS.length; return `<div style="left:${(Math.cos(a) * 130).toFixed(0)}px;top:${(Math.sin(a) * 90).toFixed(0)}px"><small>${i + 1}</small>${o.label}</div>`; }).join("") + `<div class="to">${to}</div>`;
  }
  function radialPick() {
    if (!radial || Math.hypot(radial.vx, radial.vy) < 25) return -1;
    const a = Math.atan2(radial.vy / 90, radial.vx / 130), n = LORD_ORDERS.length;
    return ((Math.round((a + Math.PI / 2) / (Math.PI * 2 / n)) % n) + n) % n;
  }

  // ---------------------------------------------------------------- per frame
  function frame(dt, sinceTick) {
    interp = sinceTick;
    const A = w.avatar;
    if (active) { readMove(); for (const id of sel) if (id === houseId() || w.units.get(id)?.household) sel.delete(id); } // (his own household rides with him, under your keys)
    if (radial) { const i = radialPick(); hud.querySelectorAll(".radial > div:not(.to)").forEach((d, k) => d.classList.toggle("hi", k === i)); }
    feedback(A);
    placeBanner(A, dt);
    labels(A);
    if ((hudT += dt) > 0.2 && active) { hudT = 0; drawHud(A); }
  }

  function feedback(A) {
    if (!A) return;
    for (const f of A.fx.splice(0)) {
      const x = S.x[A.lord], y = S.y[A.lord];
      switch (f.kind) {
        case "hit": case "kill": shake = Math.max(shake, f.kind === "kill" ? 0.35 : 0.22); sound(f.kind === "kill" ? "strike-kill" : "strike-hit", { x, y, sev: f.sev, commit: f.commit }); if (f.kind === "kill" && active) toast("You cut him down"); break;
        case "glance": sound("strike-glance", { x, y }); shake = Math.max(shake, 0.1); break;
        case "blocked": sound("strike-shield", { x, y }); shake = Math.max(shake, 0.12); break;
        case "parried": sound("strike-parried", { x, y }); break;
        case "whiff": sound("strike-whiff", { x, y }); break;
        case "hurt": shake = Math.max(shake, 0.25 + 0.1 * f.sev); flash(0.35 + 0.12 * f.sev); sound("hurt", { x, y, sev: f.sev }); if (f.sev >= 3 && active) toast("You are badly wounded!"); break;
        case "horse-hit": shake = Math.max(shake, 0.3); sound("horse-scream", { x, y }); break;
        case "bolt": toast("Your horse bolts!"); sound("horse-scream", { x, y }); break;
        case "impact": shake = Math.max(shake, 0.6); sound("lance-shatter", { x, y }); if (active) toast(f.killed ? "Your lance takes him — and shatters" : "The lance strikes home and shatters — sword out!"); break;
        case "refuse": shake = Math.max(shake, 0.4); sound("horse-refuse", { x, y }); if (active) toast("Your horse refuses the points!"); break;
        case "lance": if (active) toast("A squire hands you a fresh lance"); break;
        case "dismount": toast("You dismount; your household get down with you"); break;
        case "mount": toast("Mounted"); break;
        case "msg": if (active) toast(f.text); break;
        case "banner-down": { const nm = nameOf(S.name[A.banner]); toast(`Your banner is down — ${nm} has fallen!`); log(`${lordName()}'s banner goes down with ${nm}`, { x, y, tone: "bad" }); sound("banner-down", { x, y }); bannerAlert("Your banner is down!"); break; }
        case "banner-raised": { const nm = nameOf(S.name[A.banner]); toast(`${nm} raises your banner again — "${(w.lordNames?.[PLAYER] || nameOf(S.name[A.lord])).replace(/^(Sir|Dame|Lord|Lady) /, "").split(" ")[0]}!"`); log(`${nm} takes up ${lordName()}'s banner and cries his name`, { x, y, tone: "good" }); sound("warcry", { x, y }); bannerAlert(""); break; }
        case "banner-lost": toast("Your banner is taken by the enemy!"); log(`${lordName()}'s banner is taken by the enemy`, { x, y, tone: "bad" }); sound("banner-down", { x, y }); bannerAlert("Your banner is lost"); break;
        case "lost": lordFalls(A, f.how); break;
      }
    }
  }
  function flash(a) { const el = $h(".flash"); el.style.transition = "none"; el.style.opacity = Math.min(0.9, a); requestAnimationFrame(() => { el.style.transition = "opacity .9s"; el.style.opacity = 0; }); }
  function bannerAlert(t) { const el = $h(".banner-alert"); el.textContent = t; el.hidden = !t; }
  function lordFalls(A, how) {
    const L = A.lord, x = S.x[L], y = S.y[L], nm = lordName();
    const captor = A.captor >= 0 ? nameOf(S.name[A.captor]) : null;
    const [kick, head, line] = how === "captured"
      ? ["Taken for ransom", `${nm} yields`, `${captor ? `He gives his gauntlet to ${captor} of the enemy. ` : ""}Ransom ${A.ransom} gold${A.ransomPaid ? `, paid from the treasury — he is back in ${Math.round(AV.ransomOut / 60)} minutes` : " — but not today"}. The news runs through your army.`]
      : how === "killed" ? ["The lord is slain", `${nm} is dead`, `"The lord is down!" — the cry goes down the line at a runner's pace. Your companies must fight on without him.`]
        : ["The lord is struck down", `${nm} falls`, `He lies among the fallen${S.lastPass[L] === -2 ? ", and his household drag him out of the press" : ""}. The news runs through your army.`];
    if (how === "captured" && ["terms", "starved"].includes(w.siegeWar?.outcome?.how)) { log(`${nm} marches out with the garrison`, { x, y }); if (active) setActive(false); return; } // (a castle yielded: the terms, not a ransom — the siege's own end card tells it)
    log(`${head} ${how === "captured" && captor ? `— taken by ${captor}` : ""}`, { x, y, tone: "fall" });
    sound("lord-falls", { how, x, y });
    card.innerHTML = `<div class="c"><div class="k">${kick}</div><h2>${head}</h2><p>${line}</p></div>`;
    card.classList.add("show"); shake = 1.2; flash(0.9);
    if (params.has("card")) return; // (headless check of the card itself)
    setTimeout(() => card.classList.remove("show"), 4200);
    setTimeout(() => { if (active) setActive(false); btn.textContent = "Take the field"; }, 3500);
  }

  function placeBanner(A, dt) {
    const B = A && !A.outcome && A.bannerState === "up" ? A.banner : -1;
    if (B < 0 || !S.alive[B]) { bannerObj.visible = false; return; }
    const x = S.x[B] + S.vx[B] * interp, y = S.y[B] + S.vy[B] * interp, mounted = S.horseOK[B] >= 1;
    const d = camera.cam.position.distanceTo(posV.set(x, map.h(x, y), -y));
    bannerObj.visible = d < 700;
    const sc = Math.max(1, d / 160); // (far off it is drawn a little larger, so it can be seen at all)
    bannerObj.scale.setScalar(sc);
    bannerObj.position.set(x + 0.4, map.h(x, y) + (mounted ? 1.1 : 0.2), -y);
    const v = Math.hypot(S.vx[B], S.vy[B]), hd = v > 0.5 ? Math.atan2(S.vy[B], S.vx[B]) : S.facing[B];
    bannerObj.rotation.y = hd + Math.PI; // the cloth streams behind him
    const t = performance.now() / 1000, p = clothGeo.attributes.position.array, amp = 0.06 + Math.min(0.25, v * 0.03);
    for (let k = 0; k < p.length; k += 3) { const u = clothBase[k]; p[k + 2] = Math.sin(u * 4.2 - t * (3 + v * 0.6)) * amp * u; p[k + 1] = clothBase[k + 1] - u * u * 0.05; }
    clothGeo.attributes.position.needsUpdate = true;
  }

  // in the eagle view: his name and banner over him, so he can be found
  function labels(A) {
    const on = A && !A.outcome && S.alive[A.lord] && !active;
    lab.hidden = !on; bLab.hidden = !(A && !A.outcome && A.bannerState === "up" && !active);
    if (!on) return;
    const p = toScreen(S.x[A.lord], S.y[A.lord], 9);
    if (!p.front) { lab.hidden = true; } else { if (lab._n !== A.lord) { lab._n = A.lord; lab.innerHTML = `<img src="${bannerURL}"> ${lordName()}`; } lab.style.transform = `translate3d(${p.x.toFixed(1)}px, ${(p.y - 34).toFixed(1)}px, 0) translate(-50%, -50%)`; }
    if (!bLab.hidden && A.banner !== A.lord) {
      const near = Math.hypot(S.x[A.banner] - S.x[A.lord], S.y[A.banner] - S.y[A.lord]) < AV.bannerR;
      if (near) bLab.hidden = true;
      else { const q = toScreen(S.x[A.banner], S.y[A.banner], 7); bLab.hidden = !q.front; bLab.style.transform = `translate3d(${q.x.toFixed(1)}px, ${(q.y - 28).toFixed(1)}px, 0) translate(-50%, -50%)`; }
    }
  }

  function drawHud(A) {
    const st = lordStatus(w); if (!st) return;
    const bar = (cls, v) => `<div class="bar ${cls}"><i style="width:${Math.round(Math.max(0, v) * 100)}%"></i></div>`;
    const gait = st.speed < 0.3 ? "standing" : st.mounted ? (st.speed < 2.5 ? "walk" : st.speed < 6 ? "trot" : "gallop") : st.speed < 1.8 ? "walking" : "running";
    const weapon = st.weapon === "lance" ? (st.couched ? "lance couched" : "lance") : st.weapon;
    $h(".card").innerHTML = `<h3><img src="${bannerURL}">${lordName()}</h3>
      <div class="sub">${st.mounted ? "on his destrier" : "on foot"} · ${gait} · ${st.household} of his household with him · ${st.kills} felled</div>
      <div class="row">Health <b>${Math.round(st.health * 100)}%${st.bleeding ? " · bleeding" : ""}</b></div>${bar("hp", st.health)}
      <div class="row">Wind (his own) <b>${Math.round(st.stamina * 100)}%</b></div>${bar("st", st.stamina)}
      ${st.horse !== null ? `<div class="row">Horse's wind <b>${Math.round(st.horse * 100)}%</b></div>${bar("hw", st.horse)}` : ""}
      <div class="tags"><span class="tag">${weapon}</span>${st.guard ? `<span class="tag on">guard</span>` : ""}${st.couched ? `<span class="tag on">charge</span>` : ""}${walk ? `<span class="tag">walk</span>` : ""}
      <span class="tag${st.banner === "up" ? (st.bannerWithLord ? " on" : "") : " warn"}">${st.banner === "up" ? (st.bannerWithLord ? `banner with you · ${Math.round(st.presenceR)} m` : "banner apart") : st.banner === "down" ? "banner DOWN" : "banner lost"}</span>
      ${st.retreating ? `<span class="tag warn">your banner is seen going back!</span>` : ""}${st.down ? `<span class="tag warn">on the ground!</span>` : ""}${st.bolting ? `<span class="tag warn">horse bolting</span>` : ""}</div>`;
    nearby = nearbyUnits(w, 300, 9);
    for (const id of [...sel]) if (!w.units.get(id)) sel.delete(id);
    const sus = [...sel].map((id) => w.units.get(id)).filter(Boolean), smen = sus.reduce((s, u) => s + u.members.length, 0);
    const selsum = sus.length ? `<div class="selsum">Selected: <b>${smen}</b> men in ${sus.length} ${sus.length > 1 ? "companies" : "company"} <i>· X to clear</i></div>`
      : `<div class="selsum"><i>${cursor ? "Click a company here, its label, or drag a box" : "C to select with the cursor · 1–9 groups · B army"}</i></div>`;
    $h(".units").innerHTML = `<h4>Companies near you</h4>${selsum}` + (nearby.length ? nearby.map((q) => `<div class="u${sel.has(q.id) ? " sel" : ""}" data-u="${q.id}"><span class="k" title="control group">${api.groupOf?.(q.id) || ""}</span>${glyphSVG(ARMS[q.arm].glyph)}<span>${ARMS[q.arm].name} ×${q.men} <span class="st${STATE_BAD.has(q.state) ? " bad" : ""}">${q.state}${q.following ? " · following" : ""}</span><br><span class="st">${q.order}</span></span><span class="ch">${Math.round(q.d)} m · ${CHANNEL[q.channel]}</span></div>`).join("")
      : `<div class="st" style="color:var(--dim)">None within 300 m — your orders go by rider.</div>`);
    // stroke wind-up and the man in reach
    const ch = $h(".charge"); ch.hidden = st.wind < 0; if (st.wind >= 0) ch.firstChild.style.width = Math.round(st.wind * 100) + "%";
    const r = $h(".reticle");
    if (st.target >= 0 && S.alive[st.target]) { const p = toScreen(S.x[st.target], S.y[st.target], 1.4); r.hidden = !p.front; r.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px)`; r.style.borderColor = st.ready ? "#e8c35a" : "#8a7a55"; }
    else r.hidden = true;
  }

  // with the cursor free, a company in the list is picked like its label (Shift adds)
  $h(".units").addEventListener("pointerdown", (e) => { // (not "click": the list is redrawn 5× a second, which can eat a click)
    const row = e.target.closest("[data-u]"); if (!row || !cursor || e.button !== 0) return;
    const id = +row.dataset.u; if (!e.shiftKey) sel.clear();
    const u = w.units.get(id); if (u) { const gid = u.group; for (const v of w.units.values()) if (v === u || (gid !== undefined && v.group === gid && v.team === u.team && v.members.length)) sel.add(v.id); }
    refreshSel?.(); drawHud(w.avatar);
  });

  // demo/testing handle (headless screenshots)
  const api = {
    frame, placeAt, setActive, setCursor,
    get active() { return active; }, get placing() { return placing; }, get cursor() { return active && cursor; }, get radialOpen() { return !!radial; },
    captures: () => (active && !cursor) || placing,
    drawHud: () => drawHud(w.avatar), give, sel,
    setLook(yaw, pitch = camPitch, dist = camDist) { camYaw = yaw; camPitch = pitch; camDist = dist; lastPos = null; },
    keys,
    onEnter: null, groupOf: null, // (set by js/ui/command-keys.js)
  };
  return api;
}
