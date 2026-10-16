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
  else if (kind === "roundel") { // counterchanged across a pale
    g.beginPath(); g.arc(0, 0, r * 0.7, Math.PI / 2, Math.PI * 1.5); g.fillStyle = T[b.second]; g.fill();
    g.beginPath(); g.arc(0, 0, r * 0.7, -Math.PI / 2, Math.PI / 2); g.fillStyle = T[b.field]; g.fill();
  }
  else if (kind === "cross") { g.fillRect(-r * 0.2, -r * 1.2, r * 0.4, r * 2.6); g.fillRect(-r * 1.2, -r * 0.35, r * 2.4, r * 0.4); }
  else if (kind === "saltire") { g.lineWidth = r * 0.38; g.beginPath(); g.moveTo(-r * 1.3, -r * 1.3); g.lineTo(r * 1.3, r * 1.3); g.moveTo(r * 1.3, -r * 1.3); g.lineTo(-r * 1.3, r * 1.3); g.stroke(); }
  else if (kind === "crescent") { g.beginPath(); g.arc(0, 0, r * 0.8, 0, Math.PI * 2); g.fill(); g.globalCompositeOperation = "destination-out"; g.beginPath(); g.arc(0, -r * 0.32, r * 0.66, 0, Math.PI * 2); g.fill(); g.globalCompositeOperation = "source-over";
    g.fillStyle = T[b.field]; g.beginPath(); g.arc(0, -r * 0.32, r * 0.66, 0, Math.PI * 2); g.fill(); }
  else if (kind === "tower") { g.fillRect(-r * 0.45, -r * 0.6, r * 0.9, r * 1.5); for (let k = -1; k <= 1; k++) g.fillRect(k * r * 0.33 - r * 0.12, -r * 0.85, r * 0.24, r * 0.3);
    g.fillStyle = T[b.field]; g.beginPath(); g.arc(0, r * 0.62, r * 0.18, Math.PI, 0); g.fillRect(-r * 0.18, r * 0.62, r * 0.36, r * 0.28); g.fill(); }
  else if (kind === "key") { g.lineWidth = r * 0.16; g.beginPath(); g.arc(0, -r * 0.7, r * 0.3, 0, Math.PI * 2); g.stroke(); g.fillRect(-r * 0.08, -r * 0.4, r * 0.16, r * 1.5); g.fillRect(0, r * 0.75, r * 0.4, r * 0.14); g.fillRect(0, r * 0.45, r * 0.3, r * 0.14); }
  else if (kind === "sword") { g.fillRect(-r * 0.07, -r * 1.2, r * 0.14, r * 1.8); g.fillRect(-r * 0.45, r * 0.55, r * 0.9, r * 0.12); g.fillRect(-r * 0.06, r * 0.67, r * 0.12, r * 0.4); g.beginPath(); g.arc(0, r * 1.12, r * 0.1, 0, Math.PI * 2); g.fill(); }
  else if (kind === "boar") { g.beginPath(); g.ellipse(0, 0, r * 0.75, r * 0.55, 0, 0, Math.PI * 2); g.fill(); g.beginPath(); g.moveTo(r * 0.55, -r * 0.1); g.lineTo(r * 1.05, r * 0.05); g.lineTo(r * 0.6, r * 0.35); g.fill();
    g.beginPath(); g.moveTo(-r * 0.3, -r * 0.45); g.lineTo(-r * 0.1, -r * 0.85); g.lineTo(r * 0.05, -r * 0.45); g.fill(); g.fillStyle = T[b.field]; g.beginPath(); g.arc(r * 0.35, -r * 0.1, r * 0.07, 0, Math.PI * 2); g.fill(); }
  g.restore();
}

// Pre-game chooser. Resolves with the chosen banner (the enemy gets a contrasting one).
export function chooseBanner(el) {
  return new Promise((resolve) => {
    let saved = null; try { saved = +localStorage.getItem("hg.banner"); } catch { /* private mode */ }
    el.innerHTML = `<div class="banner-pick"><div class="lg-kicker">HIGHGROUND</div><h2>Choose your banner</h2>
      <p>Your arms fly over every building you raise, and your men wear your colours.</p><div class="banners"></div></div>`;
    const grid = el.querySelector(".banners");
    for (const b of BANNERS) {
      const bt = document.createElement("button"); bt.className = "bn" + (b.id === saved ? " on" : ""); bt.title = b.name;
      const cv = drawBanner(b, 96, 120); bt.append(cv); const s = document.createElement("small"); s.textContent = b.name; bt.append(s);
      bt.onclick = () => { try { localStorage.setItem("hg.banner", String(b.id)); } catch { /* ignore */ } el.hidden = true; resolve(b); };
      grid.append(bt);
    }
    el.hidden = false;
  });
}
export function enemyBannerFor(mine) {
  // a banner whose field colour is far from ours
  const hue = (hex) => { const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; return [r, g, b]; };
  const [r0, g0, b0] = hue(bannerColor(mine));
  return BANNERS.filter((b) => b.id !== mine.id).map((b) => { const [r, g, bl] = hue(bannerColor(b)); return { b, d: (r - r0) ** 2 + (g - g0) ** 2 + (bl - b0) ** 2 }; }).sort((a, c) => c.d - a.d)[0].b;
}
