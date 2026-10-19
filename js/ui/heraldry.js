// Heraldry: banners drawn in code (tinctures, divisions, charges). The player picks one before the
// game; its colours become the team's colours everywhere (dots, badges, flags on every building).
// Factions come later — for now a banner is identity and colour only.

export const TINCTURES = {
  or: "#d9a927", argent: "#e9e4d6", gules: "#b0282a", azure: "#2a55a5", vert: "#2f7a3b", sable: "#23201c", purpure: "#6d3a7d", tenne: "#b8621f",
};
// [name, field, division, second, charge, chargeTincture]
export const BANNERS = [
  ["Azure, a mullet or", "azure", "plain", null, "mullet", "or"],
  ["Gules, a tower argent", "gules", "plain", null, "tower", "argent"],
  ["Per pale or and vert, a roundel counterchanged", "or", "pale", "vert", "roundel", "vert"],
  ["Sable, a saltire argent", "sable", "plain", null, "saltire", "argent"],
  ["Quarterly argent and gules", "argent", "quarterly", "gules", null, null],
  ["Vert, a crescent argent", "vert", "plain", null, "crescent", "argent"],
  ["Per bend azure and argent, a cross gules", "azure", "bend", "argent", "cross", "gules"],
  ["Or, a chevron sable", "or", "chevron", "sable", null, null],
  ["Purpure, a key or", "purpure", "plain", null, "key", "or"],
  ["Per fess gules and or, a sword argent", "gules", "fess", "or", "sword", "argent"],
  ["Tenné, a boar's head argent", "tenne", "plain", null, "boar", "argent"],
  ["Argent, a cross azure", "argent", "plain", null, "cross", "azure"],
].map(([name, field, div, second, charge, ct], i) => ({ id: i, name, field, div, second, charge, ct }));

// ──────────────────────────────────────────────────────── forged arms (docs/eras-plan.md)
// A lord may forge his own: field, division, second tincture, charge, charge tincture. The five choices PACK
// INTO THE ID, so a forged banner travels anywhere a preset's number goes — ?banner=, a ranked standing, the
// realm's `you.banner` — with nothing new to store and no server to teach.
export const TINCTURE_KEYS = Object.keys(TINCTURES);
export const DIVISIONS = ["plain", "pale", "fess", "quarterly", "bend", "chevron"];
export const CHARGE_KEYS = [null, "mullet", "tower", "roundel", "saltire", "crescent", "cross", "key", "sword", "boar", "lion", "eagle", "wyvern", "hammer", "flame", "bolt", "crown"];
export const FORGED0 = 1000;
const TK = TINCTURE_KEYS, NT = TK.length, ND = DIVISIONS.length, NC = CHARGE_KEYS.length;
const ix = (a, v, d = 0) => { const i = a.indexOf(v); return i < 0 ? d : i; };
export const forgeId = (b) =>
  FORGED0 + ((((ix(TK, b.field) * ND + ix(DIVISIONS, b.div)) * NT + ix(TK, b.second || b.field)) * NC + ix(CHARGE_KEYS, b.charge ?? null)) * NT + ix(TK, b.ct || "argent"));
export function forged(id) {
  let n = Math.max(0, (id | 0) - FORGED0);
  const ct = TK[n % NT]; n = (n / NT) | 0;
  const charge = CHARGE_KEYS[n % NC]; n = (n / NC) | 0;
  const second = TK[n % NT]; n = (n / NT) | 0;
  const div = DIVISIONS[n % ND]; n = (n / ND) | 0;
  const field = TK[n % NT];
  const b = { id, field, div, second: div === "plain" ? null : second, charge, ct, forged: true };
  b.name = blazon(b); return b;
}
export const bannerById = (id) => ((id | 0) >= FORGED0 ? forged(id) : BANNERS.find((b) => b.id === (id | 0)) || BANNERS[0]);

const TN = { or: "Or", argent: "Argent", gules: "Gules", azure: "Azure", vert: "Vert", sable: "Sable", purpure: "Purpure", tenne: "Tenné" };
const tl = (k) => TN[k].toLowerCase();
const DIVN = { pale: "Per pale", fess: "Per fess", quarterly: "Quarterly", bend: "Per bend", chevron: "Per chevron" };
export const CHARGE_NAME = { mullet: "a mullet", tower: "a tower", roundel: "a roundel", saltire: "a saltire", crescent: "a crescent", cross: "a cross",
  key: "a key", sword: "a sword", boar: "a boar's head", lion: "a lion", eagle: "an eagle", wyvern: "a wyvern", hammer: "a hammer", flame: "a flame",
  bolt: "a thunderbolt", crown: "a crown" };
// the arms written out as a herald would read them
export function blazon(b) {
  const head = !b.div || b.div === "plain" ? TN[b.field] : `${DIVN[b.div]} ${tl(b.field)} and ${tl(b.second || b.field)}`;
  return b.charge ? `${head}, ${CHARGE_NAME[b.charge]} ${tl(b.ct || "argent")}` : head;
}

export const bannerColor = (b) => TINCTURES[b.field];
// contrasting accent for UI (the metal/colour pairing of the arms)
export const bannerAccent = (b) => TINCTURES[b.ct || b.second || (b.field === "argent" || b.field === "or" ? "sable" : "argent")];

export function drawBanner(b, W = 256, H = 320, cv = null) {
  cv = cv || document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d"), T = TINCTURES;
  g.fillStyle = T[b.field]; g.fillRect(0, 0, W, H);
  g.fillStyle = b.second ? T[b.second] : T[b.field];
  if (b.div === "pale") g.fillRect(W / 2, 0, W / 2, H);
  else if (b.div === "fess") g.fillRect(0, H / 2, W, H / 2);
  else if (b.div === "quarterly") { g.fillRect(W / 2, 0, W / 2, H / 2); g.fillRect(0, H / 2, W / 2, H / 2); }
  else if (b.div === "bend") { g.beginPath(); g.moveTo(0, 0); g.lineTo(W, H); g.lineTo(0, H); g.fill(); }
  else if (b.div === "chevron") { g.beginPath(); g.moveTo(0, H * 0.85); g.lineTo(W / 2, H * 0.35); g.lineTo(W, H * 0.85); g.lineTo(W, H); g.lineTo(W * 0.5, H * 0.55); g.lineTo(0, H); g.fill(); g.beginPath(); g.moveTo(0, H * 0.85); g.lineTo(W / 2, H * 0.35); g.lineTo(W, H * 0.85); g.lineTo(W, H * 0.66); g.lineTo(W / 2, H * 0.18); g.lineTo(0, H * 0.66); g.fill(); }
  if (b.charge) drawCharge(g, b.charge, W / 2, H * 0.45, Math.min(W, H) * 0.34, b.div === "pale" && b.charge === "roundel" ? null : T[b.ct], b);
  // cloth: a little shading so it reads as fabric, fringe at the fly
  const sh = g.createLinearGradient(0, 0, W, 0); sh.addColorStop(0, "rgba(0,0,0,.18)"); sh.addColorStop(0.5, "rgba(255,255,255,.06)"); sh.addColorStop(1, "rgba(0,0,0,.2)");
  g.fillStyle = sh; g.fillRect(0, 0, W, H);
  return cv;
}

function drawCharge(g, kind, x, y, r, color, b) {
  const T = TINCTURES;
  g.save(); g.translate(x, y); g.fillStyle = color || T.argent; g.strokeStyle = color || T.argent;
  if (kind === "mullet") { g.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.42 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.fill(); }
  else if (kind === "roundel") {
    if (b.div && b.div !== "plain" && b.second) { // counterchanged across the division
      g.beginPath(); g.arc(0, 0, r * 0.7, Math.PI / 2, Math.PI * 1.5); g.fillStyle = T[b.second]; g.fill();
      g.beginPath(); g.arc(0, 0, r * 0.7, -Math.PI / 2, Math.PI / 2); g.fillStyle = T[b.field]; g.fill();
    } else { g.beginPath(); g.arc(0, 0, r * 0.78, 0, Math.PI * 2); g.fill(); }
  }
  else if (kind === "cross") { g.fillRect(-r * 0.2, -r * 1.2, r * 0.4, r * 2.6); g.fillRect(-r * 1.2, -r * 0.35, r * 2.4, r * 0.4); }
  else if (kind === "saltire") { g.lineWidth = r * 0.38; g.beginPath(); g.moveTo(-r * 1.3, -r * 1.3); g.lineTo(r * 1.3, r * 1.3); g.moveTo(r * 1.3, -r * 1.3); g.lineTo(-r * 1.3, r * 1.3); g.stroke(); }
  else if (kind === "crescent") { g.beginPath(); g.arc(0, 0, r * 0.8, 0, Math.PI * 2); g.fill(); g.globalCompositeOperation = "destination-out"; g.beginPath(); g.arc(0, -r * 0.32, r * 0.66, 0, Math.PI * 2); g.fill(); g.globalCompositeOperation = "source-over";
    g.fillStyle = T[b.field]; g.beginPath(); g.arc(0, -r * 0.32, r * 0.66, 0, Math.PI * 2); g.fill(); }
  else if (kind === "tower") { g.fillRect(-r * 0.45, -r * 0.6, r * 0.9, r * 1.5); for (let k = -1; k <= 1; k++) g.fillRect(k * r * 0.33 - r * 0.12, -r * 0.85, r * 0.24, r * 0.3);
    g.fillStyle = T[b.field]; g.beginPath(); g.arc(0, r * 0.62, r * 0.18, Math.PI, 0); g.fillRect(-r * 0.18, r * 0.62, r * 0.36, r * 0.28); g.fill(); }
  else if (kind === "key") { g.lineWidth = r * 0.16; g.beginPath(); g.arc(0, -r * 0.7, r * 0.3, 0, Math.PI * 2); g.stroke(); g.fillRect(-r * 0.08, -r * 0.4, r * 0.16, r * 1.5); g.fillRect(0, r * 0.75, r * 0.4, r * 0.14); g.fillRect(0, r * 0.45, r * 0.3, r * 0.14); }
  else if (kind === "sword") { g.fillRect(-r * 0.07, -r * 1.2, r * 0.14, r * 1.8); g.fillRect(-r * 0.45, r * 0.55, r * 0.9, r * 0.12); g.fillRect(-r * 0.06, r * 0.67, r * 0.12, r * 0.4); g.beginPath(); g.arc(0, r * 1.12, r * 0.1, 0, Math.PI * 2); g.fill(); }
  else if (kind === "lion") { // rampant: on his hind legs, facing dexter, forepaws raised
    g.beginPath();
    g.moveTo(-r * 0.36, r * 1.05); g.lineTo(-r * 0.16, r * 0.25);
    g.quadraticCurveTo(-r * 0.46, -r * 0.15, -r * 0.26, -r * 0.58);
    g.lineTo(r * 0.1, -r * 0.7); g.lineTo(r * 0.1, -r * 0.3);
    g.quadraticCurveTo(r * 0.52, -r * 0.26, r * 0.64, r * 0.1); g.lineTo(r * 0.5, r * 0.32);
    g.quadraticCurveTo(r * 0.2, r * 0.1, r * 0.06, r * 0.36);
    g.lineTo(r * 0.3, r * 1.05); g.lineTo(r * 0.06, r * 1.05); g.lineTo(-r * 0.04, r * 0.62); g.lineTo(-r * 0.12, r * 1.05);
    g.closePath(); g.fill();
    g.beginPath(); for (let k = 0; k < 12; k++) { const a = -Math.PI / 2 + k * Math.PI / 6, rr = k % 2 ? r * 0.3 : r * 0.47; g.lineTo(r * 0.02 + Math.cos(a) * rr, -r * 0.76 + Math.sin(a) * rr); } g.closePath(); g.fill();
    g.beginPath(); g.moveTo(r * 0.28, -r * 0.88); g.lineTo(r * 0.64, -r * 0.78); g.lineTo(r * 0.28, -r * 0.64); g.closePath(); g.fill();
    g.lineWidth = r * 0.1; g.beginPath(); g.moveTo(-r * 0.3, r * 0.3); g.quadraticCurveTo(-r * 0.98, 0, -r * 0.74, -r * 0.66); g.stroke();
    g.beginPath(); g.arc(-r * 0.74, -r * 0.76, r * 0.15, 0, Math.PI * 2); g.fill();
    g.fillStyle = T[b.field]; g.beginPath(); g.arc(r * 0.26, -r * 0.82, r * 0.06, 0, Math.PI * 2); g.fill(); }
  else if (kind === "eagle") { // displayed: body, head, two spread wings
    g.beginPath(); g.ellipse(0, r * 0.12, r * 0.22, r * 0.5, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(0, -r * 0.52, r * 0.2, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(r * 0.16, -r * 0.56); g.lineTo(r * 0.42, -r * 0.46); g.lineTo(r * 0.16, -r * 0.36); g.fill();   // beak
    for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(sg * r * 0.16, -r * 0.3); g.quadraticCurveTo(sg * r * 1.25, -r * 0.75, sg * r * 1.05, r * 0.2);
      g.quadraticCurveTo(sg * r * 0.8, -r * 0.1, sg * r * 0.18, r * 0.12); g.fill(); }
    for (const sg of [-1, 1]) g.fillRect(sg * r * 0.1 - r * 0.07, r * 0.6, r * 0.14, r * 0.45); }
  else if (kind === "wyvern") { // two legs, a barbed tail, one great wing
    g.beginPath();
    g.moveTo(-r * 0.55, r * 0.45); g.quadraticCurveTo(-r * 0.1, r * 0.12, r * 0.2, -r * 0.14);
    g.quadraticCurveTo(r * 0.46, -r * 0.4, r * 0.46, -r * 0.72); g.lineTo(r * 0.98, -r * 0.6); g.lineTo(r * 0.5, -r * 0.4);
    g.quadraticCurveTo(r * 0.34, -r * 0.04, -r * 0.16, r * 0.5); g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(-r * 0.1, r * 0.04); g.quadraticCurveTo(r * 0.08, -r * 0.98, r * 0.86, -r * 1.05);
    g.lineTo(r * 0.48, -r * 0.5); g.lineTo(r * 0.72, -r * 0.44); g.lineTo(r * 0.28, -r * 0.2); g.lineTo(r * 0.5, -r * 0.12);
    g.lineTo(r * 0.04, r * 0.2); g.closePath(); g.fill();
    for (const dx of [-0.44, -0.02]) { g.fillRect(dx * r, r * 0.4, r * 0.15, r * 0.5); g.fillRect((dx - 0.05) * r, r * 0.84, r * 0.27, r * 0.12); }
    g.lineWidth = r * 0.11; g.beginPath(); g.moveTo(-r * 0.5, r * 0.5); g.quadraticCurveTo(-r * 1.1, r * 0.35, -r * 1.0, -r * 0.32); g.stroke();
    g.beginPath(); g.moveTo(-r * 1.08, -r * 0.26); g.lineTo(-r * 0.76, -r * 0.5); g.lineTo(-r * 0.88, -r * 0.1); g.closePath(); g.fill();
    g.fillStyle = T[b.field]; g.beginPath(); g.arc(r * 0.6, -r * 0.6, r * 0.07, 0, Math.PI * 2); g.fill(); }
  else if (kind === "hammer") { g.fillRect(-r * 0.13, -r * 0.2, r * 0.26, r * 1.3);
    g.beginPath(); g.moveTo(-r * 0.78, -r * 0.95); g.lineTo(r * 0.78, -r * 0.95); g.lineTo(r * 0.66, -r * 0.18); g.lineTo(-r * 0.66, -r * 0.18); g.closePath(); g.fill();
    g.fillRect(-r * 0.3, r * 1.02, r * 0.6, r * 0.16); }
  else if (kind === "flame") { g.beginPath(); g.moveTo(0, -r * 1.15); g.quadraticCurveTo(r * 0.72, -r * 0.2, r * 0.5, r * 0.45);
    g.quadraticCurveTo(r * 0.38, r * 1.0, 0, r * 1.05); g.quadraticCurveTo(-r * 0.38, r * 1.0, -r * 0.5, r * 0.45);
    g.quadraticCurveTo(-r * 0.72, -r * 0.2, 0, -r * 1.15); g.fill();
    g.fillStyle = T[b.field]; g.beginPath(); g.moveTo(0, -r * 0.28); g.quadraticCurveTo(r * 0.3, r * 0.25, 0, r * 0.68);
    g.quadraticCurveTo(-r * 0.3, r * 0.25, 0, -r * 0.28); g.fill(); }
  else if (kind === "bolt") { g.beginPath(); g.moveTo(r * 0.35, -r * 1.15); g.lineTo(-r * 0.55, r * 0.12); g.lineTo(-r * 0.02, r * 0.12);
    g.lineTo(-r * 0.35, r * 1.15); g.lineTo(r * 0.55, -r * 0.1); g.lineTo(r * 0.02, -r * 0.1); g.closePath(); g.fill(); }
  else if (kind === "crown") { g.beginPath(); g.moveTo(-r * 0.8, r * 0.5); g.lineTo(-r * 0.95, -r * 0.7); g.lineTo(-r * 0.32, -r * 0.05);
    g.lineTo(0, -r * 0.9); g.lineTo(r * 0.32, -r * 0.05); g.lineTo(r * 0.95, -r * 0.7); g.lineTo(r * 0.8, r * 0.5); g.closePath(); g.fill();
    g.fillRect(-r * 0.82, r * 0.55, r * 1.64, r * 0.26); }
  else if (kind === "boar") { g.beginPath(); g.ellipse(0, 0, r * 0.75, r * 0.55, 0, 0, Math.PI * 2); g.fill(); g.beginPath(); g.moveTo(r * 0.55, -r * 0.1); g.lineTo(r * 1.05, r * 0.05); g.lineTo(r * 0.6, r * 0.35); g.fill();
    g.beginPath(); g.moveTo(-r * 0.3, -r * 0.45); g.lineTo(-r * 0.1, -r * 0.85); g.lineTo(r * 0.05, -r * 0.45); g.fill(); g.fillStyle = T[b.field]; g.beginPath(); g.arc(r * 0.35, -r * 0.1, r * 0.07, 0, Math.PI * 2); g.fill(); }
  g.restore();
}

// The forge itself, shared by the pre-game chooser and the realm's founding card.
// host: an element to fill. start: a banner id to open on. onTake(banner, id): the lord takes these arms.
// Returns { draw } so a caller can re-open it.
export function buildForge(host, { start = null, onTake, takeLabel = "Take these arms", taken = null } = {}) {
  const F = { field: "azure", div: "plain", second: "or", charge: "mullet", ct: "or" };
  if (start >= FORGED0) { const b = forged(start); Object.assign(F, { field: b.field, div: b.div, second: b.second || "or", charge: b.charge, ct: b.ct }); }
  host.innerHTML = `<div class="bn-stage"><div class="bn-big"></div><div class="bn-blazon"></div><div class="bn-warn" hidden>Another house already flies these arms.</div></div>
    <div class="bn-ctl">
      <div class="bn-sub">The field</div><div class="bn-row" data-k="field"></div>
      <div class="bn-sub">Its division</div><div class="bn-row" data-k="div"></div>
      <div class="bn-sub bn-secl">The second tincture</div><div class="bn-row bn-secr" data-k="second"></div>
      <div class="bn-sub">The charge</div><div class="bn-row bn-wrap" data-k="charge"></div>
      <div class="bn-sub bn-ctl2">Its tincture</div><div class="bn-row bn-ctr" data-k="ct"></div>
    </div>
    <button class="bn-take">${takeLabel}</button>`;
  const rows = [...host.querySelectorAll(".bn-row")];
  const OPTS = { field: TINCTURE_KEYS, div: DIVISIONS, second: TINCTURE_KEYS, charge: CHARGE_KEYS, ct: TINCTURE_KEYS };
  const DIVLABEL = { plain: "Plain", pale: "Per pale", fess: "Per fess", quarterly: "Quarterly", bend: "Per bend", chevron: "Per chevron" };
  const label = (k, v) => k === "div" ? DIVLABEL[v] : k === "charge" ? (v ? CHARGE_NAME[v].replace(/^an? /, "") : "no charge") : TN[v];
  const current = () => ({ ...F, second: F.div === "plain" ? null : F.second });
  function draw() {
    const b = current(), id = forgeId(b), clash = taken ? taken.has(id) : false;
    host.querySelector(".bn-big").replaceChildren(drawBanner(b, 168, 210));
    host.querySelector(".bn-blazon").textContent = blazon(b);
    host.querySelector(".bn-warn").hidden = !clash;
    host.querySelector(".bn-take").disabled = clash;
    host.querySelector(".bn-secl").hidden = host.querySelector(".bn-secr").hidden = F.div === "plain";
    host.querySelector(".bn-ctl2").hidden = host.querySelector(".bn-ctr").hidden = !F.charge;
    for (const row of rows) {
      const k = row.dataset.k;
      row.replaceChildren(...OPTS[k].map((v) => {
        const bt = document.createElement("button");
        bt.className = "bn-o" + ((F[k] ?? null) === v ? " on" : ""); bt.title = label(k, v); bt.type = "button";
        bt.append(drawBanner({ ...F, [k]: v }, 40, 50));   // every choice shown as the arms it would make (F, not current(): a plain field still needs its second tincture to show what a division would do)
        bt.onclick = () => { F[k] = v; draw(); };
        return bt;
      }));
    }
  }
  host.querySelector(".bn-take").onclick = () => { const b = current(), id = forgeId(b); onTake(forged(id), id); };
  draw();
  return { draw, current, id: () => forgeId(current()) };
}

// Pre-game chooser: the known arms of the Vale, or a lord's own forged on the spot.
// Resolves with the chosen banner (the enemy gets a contrasting one).
export function chooseBanner(el) {
  return new Promise((resolve) => {
    let saved = null; try { saved = +localStorage.getItem("hg.banner"); } catch { /* private mode */ }
    el.innerHTML = `<div class="banner-pick"><div class="lg-kicker">HIGHGROUND</div><h2>Choose your banner</h2>
      <p>Your arms fly over every building you raise, and your men wear your colours.</p>
      <div class="bn-tabs"><button data-t="known" class="on">Known arms</button><button data-t="forge">Forge your own</button></div>
      <div class="banners"></div><div class="bn-forge" hidden></div></div>`;
    const take = (b, id) => { try { localStorage.setItem("hg.banner", String(id)); } catch { /* ignore */ } el.hidden = true; resolve(b); };
    const grid = el.querySelector(".banners");
    for (const b of BANNERS) {
      const bt = document.createElement("button"); bt.className = "bn" + (b.id === saved ? " on" : ""); bt.title = b.name;
      bt.append(drawBanner(b, 96, 120)); const sm = document.createElement("small"); sm.textContent = b.name; bt.append(sm);
      bt.onclick = () => take(b, b.id); grid.append(bt);
    }
    const forge = el.querySelector(".bn-forge");
    let built = false;
    el.querySelectorAll(".bn-tabs button").forEach((t) => t.onclick = () => {
      el.querySelectorAll(".bn-tabs button").forEach((o) => o.classList.toggle("on", o === t));
      const on = t.dataset.t === "forge"; forge.hidden = !on; grid.hidden = on;
      if (on && !built) { built = true; buildForge(forge, { start: saved, onTake: take }); }
    });
    el.hidden = false;
  });
}
export function enemyBannerFor(mine) {
  // a banner whose field colour is far from ours
  const hue = (hex) => { const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; return [r, g, b]; };
  const [r0, g0, b0] = hue(bannerColor(mine));
  return BANNERS.filter((b) => b.id !== mine.id).map((b) => { const [r, g, bl] = hue(bannerColor(b)); return { b, d: (r - r0) ** 2 + (g - g0) ** 2 + (bl - b0) ** 2 }; }).sort((a, c) => c.d - a.d)[0].b;
}
