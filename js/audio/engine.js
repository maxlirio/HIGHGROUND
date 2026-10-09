// HIGHGROUND audio engine: WebAudio graph, sound bank, positional one-shots with a prioritised voice pool,
// and looped "density" emitters. Knows nothing about the sim — js/audio/battle.js drives it.
//
//   master ─ limiter ─ destination
//     ├ sfx bus  ← voices / emitters (dry)   ← reverb return (ConvolverNode, our own synthesized vale IR)
//     │                                      ← room returns (made on first use: the keep's hall, the gate passage)
//     ├ amb bus  ← wind, birds, village
//     └ cue bus  ← optional drum/horn cues (off by default: the game is music-free)
//
// Positions are three.js world coordinates (x, height, -simY). Distances are measured from an "ear" that battle.js
// puts between the camera and what it looks at, so zooming out hears the battle as a roar and the ground view
// hears single blows. Gain, air absorption (low-pass) and the speed-of-sound delay are computed here; the
// PannerNode only places the sound left/right/behind (its own roll-off is disabled).
import { GAIN, CLASS, PRIORITY, LIMIT } from "./bank.js";

const LS_KEY = "hg.audio.v1";
export const DEFAULTS = { master: 0.9, sfx: 1, amb: 0.7, cues: 0, muted: false };
const MAX_VOICES = 32, SOUND_SPEED = 343, MAX_DELAY = 0.6;

export function loadSettings() {
  try { const s = JSON.parse(localStorage.getItem(LS_KEY) || "null"); if (s && typeof s === "object") return { ...DEFAULTS, ...s }; } catch { }
  return { ...DEFAULTS };
}
export function saveSettings(s) { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { } }

const db = (d) => Math.pow(10, d / 20);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// distance model: amplitude ∝ ref/d beyond the class's reference distance (horns and stones carry far,
// a blade clash is a close sound) and air/ground absorption as a low-pass falling with distance.
export function distGain(cls, d) { return Math.pow(cls.ref / Math.max(cls.ref, d), cls.roll); }
export function airCutoff(d) { return d < 25 ? 20000 : clamp(20000 * Math.pow(25 / d, 0.85), 700, 20000); }

export class AudioEngine {
  constructor({ ctx = null, base = "assets/audio/", settings = loadSettings() } = {}) {
    this.base = base; this.settings = settings;
    this.ctx = ctx; this.offline = !!ctx && typeof OfflineAudioContext !== "undefined" && ctx instanceof OfflineAudioContext;
    this.buffers = new Map(); this.manifest = null; this.ready = false;
    this.voices = []; this.lastPick = new Map(); this.recent = new Map();
    this.ear = { x: 0, y: 0, z: 0 }; this.emitters = new Map();
    // ENCLOSURE (docs/siege-audio.md): the ear inside stone walls (a tower, the keep, the gate passage). k 0..1;
    // sources within r m of the ear are in the room with it (they excite `room`), the rest are outside the walls:
    // muffled (low-passed, quieter) and the open vale's reverb fades.
    this.enc = { k: 0, r: 12, room: null };
    this.rooms = new Map();
    this.stats = { played: 0, dropped: 0, stolen: 0, culled: 0, byName: {} };
    if (ctx) this._graph();
  }

  // create the context (suspended until a user gesture resumes it — autoplay policy)
  ensureContext() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    try { this.ctx = new AC({ latencyHint: "interactive" }); } catch { this.ctx = new AC(); }
    this._graph();
    return this.ctx;
  }
  _graph() {
    const c = this.ctx;
    this.master = c.createGain();
    this.limiter = c.createDynamicsCompressor();
    Object.assign(this.limiter, {}); // params set below (AudioParams)
    this.limiter.threshold.value = -8; this.limiter.knee.value = 6; this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003; this.limiter.release.value = 0.25;
    this.post = c.createGain(); this.post.gain.value = 0.84; // -1.5 dB after the limiter: true peak stays under -1 dBTP
    this.master.connect(this.limiter).connect(this.post).connect(c.destination);
    this.sfx = c.createGain(); this.amb = c.createGain(); this.cue = c.createGain();
    this.sfx.connect(this.master); this.amb.connect(this.master); this.cue.connect(this.master);
    this.reverb = c.createConvolver(); this.reverb.normalize = false;
    this.revIn = c.createGain(); this.revOut = c.createGain(); this.revOut.gain.value = 0.7;
    this.revIn.connect(this.reverb); this.reverb.connect(this.revOut); this.revOut.connect(this.sfx);
    this.applySettings();
  }
  applySettings() {
    const s = this.settings; if (!this.ctx) return;
    const t = this.ctx.currentTime, k = 0.05;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master * s.master, t, k); // squared: sliders feel even
    this.sfx.gain.setTargetAtTime(s.sfx * s.sfx, t, k);
    this.amb.gain.setTargetAtTime(s.amb * s.amb, t, k);
    this.cue.gain.setTargetAtTime(s.cues * s.cues, t, k);
  }
  set(key, v) { this.settings[key] = v; this.applySettings(); saveSettings(this.settings); }

  async load(onProgress) {
    const ctx = this.ensureContext(); if (!ctx) return;
    const man = this.manifest = await (await fetch(this.base + "manifest.json")).json();
    const all = []; for (const [name, s] of Object.entries(man.sounds)) s.files.forEach((f, k) => all.push([name, k, f]));
    let done = 0;
    const one = async ([name, k, f]) => {
      try {
        const ab = await (await fetch(this.base + f)).arrayBuffer();
        const buf = await new Promise((res, rej) => { const p = ctx.decodeAudioData(ab, res, rej); if (p?.catch) p.catch(rej); });
        let list = this.buffers.get(name); if (!list) this.buffers.set(name, list = []);
        list[k] = buf; // AAC priming is honoured by Chrome and WebKit: loops come back sample-exact
      } catch (e) { console.warn("audio: could not load", f, e?.message || e); }
      onProgress?.(++done / all.length);
    };
    // the vale IR and beds first (they carry the most), then the rest, a few at a time
    all.sort((a, b) => (b[0] === "ir_vale") - (a[0] === "ir_vale") || (man.sounds[b[0]].kind === "loop") - (man.sounds[a[0]].kind === "loop"));
    const q = all.slice(); const workers = Array.from({ length: 6 }, async () => { while (q.length) await one(q.shift()); });
    await Promise.all(workers);
    for (const name of ["ir_vale", "ir_hall", "ir_passage"]) { // unit energy per channel (as rendered): a send level is then exactly in × out
      const ir = this.buffers.get(name)?.[0]; if (!ir) continue;
      for (let c = 0; c < ir.numberOfChannels; c++) { const d = ir.getChannelData(c); let e = 0; for (let i = 0; i < d.length; i++) e += d[i] * d[i]; const k = 1 / Math.sqrt(e || 1); for (let i = 0; i < d.length; i++) d[i] *= k; }
    }
    const ir = this.buffers.get("ir_vale")?.[0]; if (ir) this.reverb.buffer = ir;
    this.ready = true;
  }
  // A room's reverb (a ConvolverNode on its own IR, "hall" | "passage"), created the first time something is sent to
  // it — a battle with no castle never pays for one. Returns its input gain node (or null before the bank loads).
  room(name) {
    let R = this.rooms.get(name); if (R) return R.in;
    const ir = this.buffers.get("ir_" + name)?.[0]; if (!ir || !this.ctx) return null;
    const c = this.ctx; R = { in: c.createGain(), conv: c.createConvolver(), out: c.createGain() };
    R.conv.normalize = false; R.conv.buffer = ir; R.out.gain.value = 0.8;
    R.in.connect(R.conv).connect(R.out).connect(this.sfx); this.rooms.set(name, R);
    return R.in;
  }
  // The ear's enclosure: k 0 (open air) .. 1 (inside), the room it is in, its radius. Smoothed by the caller.
  setEnclosure(k, room = null, r = 12) {
    const e = this.enc; e.k = clamp(k, 0, 1); e.room = room; e.r = r;
    if (this.ctx) this.revOut.gain.setTargetAtTime(0.7 * (1 - 0.8 * e.k), this.ctx.currentTime, 0.15); // the vale's answer barely reaches in
  }
  // for a source d m from the ear: is it outside the walls around the ear? → [low-pass Hz, gain factor]
  _occl(d) { const e = this.enc; if (e.k < 0.02 || d < e.r) return null; return [20000 + (700 - 20000) * e.k, db(-9 * e.k)]; }
  has(name) { return !!this.buffers.get(name)?.length; }
  pick(name) {
    const list = this.buffers.get(name); if (!list?.length) return null;
    const n = list.length; let k = Math.floor(Math.random() * n);
    if (n > 1 && k === this.lastPick.get(name)) k = (k + 1 + Math.floor(Math.random() * (n - 1))) % n; // never twice running
    this.lastPick.set(name, k); return list[k];
  }
  resume() { if (this.ctx && this.ctx.state !== "running" && !this.offline) this.ctx.resume().catch(() => { }); }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  setEar(x, y, z, fx, fy, fz, ux, uy, uz) {
    this.ear.x = x; this.ear.y = y; this.ear.z = z;
    const L = this.ctx?.listener; if (!L) return;
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(x, t, 0.02); L.positionY.setTargetAtTime(y, t, 0.02); L.positionZ.setTargetAtTime(z, t, 0.02);
      L.forwardX.setTargetAtTime(fx, t, 0.02); L.forwardY.setTargetAtTime(fy, t, 0.02); L.forwardZ.setTargetAtTime(fz, t, 0.02);
      L.upX.setTargetAtTime(ux, t, 0.02); L.upY.setTargetAtTime(uy, t, 0.02); L.upZ.setTargetAtTime(uz, t, 0.02);
    } else { L.setPosition(x, y, z); L.setOrientation(fx, fy, fz, ux, uy, uz); }
  }
  dist(x, y, z) { const dx = x - this.ear.x, dy = y - this.ear.y, dz = z - this.ear.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }

  // How loud (linear) a sound would arrive — used by callers to skip work for sounds nobody would hear.
  audibility(name, d) { return db(GAIN[name] ?? 0) * distGain(CLASS[name] || CLASS._, d); }

  _panner(x, y, z, hrtf) {
    const p = this.ctx.createPanner();
    p.panningModel = hrtf ? "HRTF" : "equalpower"; p.distanceModel = "linear";
    p.refDistance = 1; p.maxDistance = 1e7; p.rolloffFactor = 0; // we attenuate ourselves
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
    return p;
  }

  // Positional one-shot. opts: { gain (dB), rate, delay (s), priority, send (reverb 0..1), pos: false → non-positional }
  play(name, x, y, z, opts = {}) {
    if (!this.ctx || !this.ready || this.settings.muted && !this.offline) return null;
    const cls = CLASS[name] || CLASS._;
    const d = opts.pos === false ? 0 : this.dist(x, y, z);
    const oc = opts.pos === false ? null : this._occl(d);
    const g = db((GAIN[name] ?? 0) + (opts.gain || 0)) * (opts.pos === false ? 1 : distGain(cls, d)) * (oc ? oc[1] : 1);
    if (g < 0.003) { this.stats.culled++; return null; }
    // per-sound concurrency and spam limits
    const lim = LIMIT[name] || LIMIT._;
    const t = this.ctx.currentTime;
    const live = this.voices.filter((v) => v.name === name && v.end > t);
    if (live.length >= lim.max) { this.stats.dropped++; return null; }
    const last = this.recent.get(name) || -1e9; if (t - last < lim.gap) { this.stats.dropped++; return null; }
    const pri = g * (PRIORITY[name] ?? 1) * (opts.priority ?? 1);
    this.voices = this.voices.filter((v) => v.end > t);
    if (this.voices.length >= MAX_VOICES) {
      let worst = null, wp = Infinity;
      for (const v of this.voices) { const left = clamp((v.end - t) / v.dur, 0.05, 1), p = v.pri * left; if (p < wp) { wp = p; worst = v; } }
      if (!worst || wp * 1.25 > pri) { this.stats.dropped++; return null; }
      this._stop(worst); this.stats.stolen++;
    }
    const buf = this.pick(name); if (!buf) return null;
    const c = this.ctx, src = c.createBufferSource(); src.buffer = buf;
    const rate = opts.rate ?? (1 + (Math.random() - 0.5) * (cls.detune ?? 0.06)); src.playbackRate.value = rate;
    const vg = c.createGain(); vg.gain.value = g;
    let head = src, tail;
    let lpF = opts.pos === false ? 20000 : airCutoff(d);
    if (oc) lpF = Math.min(lpF, oc[0]);
    if (opts.muffle) lpF = Math.min(lpF, 20000 * Math.pow(400 / 20000, clamp(opts.muffle, 0, 1))); // heard through earth or stone
    if (lpF < 19000) { const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lpF; f.Q.value = 0.5; src.connect(f); head = f; }
    head.connect(vg); tail = vg;
    if (opts.pos !== false && buf.numberOfChannels === 1) { const p = this._panner(x, y, z, d < 60 && opts.hrtf !== false); vg.connect(p); tail = p; }
    tail.connect(opts.bus === "amb" ? this.amb : opts.bus === "cue" ? this.cue : this.sfx);
    // reverb send grows with distance (far sounds are mostly the vale answering)
    const send = opts.send ?? clamp(0.12 + d / 400, 0.12, 0.7) * (cls.wet ?? 1);
    if (send > 0.01 && opts.bus !== "amb" && opts.bus !== "cue") { const sg = c.createGain(); sg.gain.value = send; tail.connect(sg); sg.connect(this.revIn); }
    // a room: the caller names it (a blow in the gate passage), or the ear's own room hears what is in it with the ear
    const roomName = opts.room || (this.enc.k > 0.02 && this.enc.room && !oc && opts.pos !== false ? this.enc.room : null);
    const roomSend = opts.room ? (opts.roomSend ?? 0.5) : 0.45 * this.enc.k;
    if (roomName && roomSend > 0.01 && opts.bus !== "amb" && opts.bus !== "cue") { const ri = this.room(roomName); if (ri) { const rg = c.createGain(); rg.gain.value = roomSend; tail.connect(rg); rg.connect(ri); } }
    const delay = opts.pos === false ? 0 : Math.min(MAX_DELAY, d / SOUND_SPEED);
    const start = t + delay + (opts.delay || 0);
    src.start(start);
    const dur = buf.duration / rate;
    const v = { name, src, gain: vg, end: start + dur, dur, pri };
    src.onended = () => { try { tail.disconnect(); } catch { } };
    this.voices.push(v); this.recent.set(name, t);
    this.stats.played++; this.stats.byName[name] = (this.stats.byName[name] || 0) + 1;
    return v;
  }
  _stop(v) { const t = this.ctx.currentTime; try { v.gain.gain.setTargetAtTime(0, t, 0.015); v.src.stop(t + 0.08); } catch { } v.end = t; }

  // Non-positional stereo sound (cues, ambience beds, UI) on a bus.
  play2d(name, bus = "sfx", gainDb = 0) {
    if (!this.ctx || !this.ready) return null;
    const buf = this.pick(name); if (!buf) return null;
    const c = this.ctx, src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain(); g.gain.value = db((GAIN[name] ?? 0) + gainDb);
    src.connect(g).connect(bus === "amb" ? this.amb : bus === "cue" ? this.cue : this.sfx);
    src.start(); this.stats.played++; this.stats.byName[name] = (this.stats.byName[name] || 0) + 1;
    return { src, gain: g };
  }

  // ---------------------------------------------------------------- looped emitters (density layers)
  // layer(name, K) keeps up to K looping sources of one bed; drive() hands it this frame's targets
  // [{x,y,z,level}] (level ~ linear amplitude before distance). Sources start lazily, glide to their
  // targets, and fall silent (then stop) when unused.
  layer(name, K = 3, opts = {}) {
    let L = this.emitters.get(name);
    if (!L) { L = { name, K, slots: [], opts }; this.emitters.set(name, L); }
    return L;
  }
  drive(name, targets, dt) {
    const L = this.emitters.get(name); if (!L || !this.ready || !this.ctx) return;
    const c = this.ctx, t = c.currentTime, cls = CLASS[name] || CLASS._;
    const base = db(GAIN[name] ?? 0);
    // match targets to the nearest existing slot so emitters glide instead of jumping
    const free = L.slots.slice(), plan = [];
    for (const tg of targets.slice(0, L.K)) {
      let best = null, bd = Infinity;
      for (const s of free) { const d = Math.hypot(s.x - tg.x, s.z - tg.z); if (d < bd) { bd = d; best = s; } }
      if (best && bd < 250) { free.splice(free.indexOf(best), 1); plan.push([best, tg]); }
      else plan.push([null, tg]);
    }
    for (const [slot, tg] of plan) {
      let s = slot;
      if (!s) {
        if (L.slots.length >= L.K) { s = free.shift(); if (!s) continue; } // reuse a slot left over
        else { s = this._slot(L, tg); if (!s) continue; L.slots.push(s); }
        s.x = tg.x; s.y = tg.y; s.z = tg.z;
      }
      const k = 1 - Math.exp(-dt * 1.5); // positions glide (clusters move, merge, split)
      s.x += (tg.x - s.x) * k; s.y += (tg.y - s.y) * k; s.z += (tg.z - s.z) * k; s.idle = 0;
      const d = Math.max(tg.r || 0, this.dist(s.x, s.y, s.z) - (tg.r || 0) * 0.5);
      const oc = this._occl(d);
      const g = base * tg.level * distGain(cls, d) * (oc ? oc[1] : 1);
      s.gain.gain.setTargetAtTime(g, t, L.opts.smooth ?? 0.35);
      s.lp.frequency.setTargetAtTime(Math.min(airCutoff(d), oc ? oc[0] : 20000, tg.lp ?? 20000), t, 0.3);
      s.send.gain.setTargetAtTime(clamp(0.1 + d / 500, 0.1, 0.6), t, 0.3);
      if (s.pan.positionX) { s.pan.positionX.setTargetAtTime(s.x, t, 0.1); s.pan.positionY.setTargetAtTime(s.y, t, 0.1); s.pan.positionZ.setTargetAtTime(s.z, t, 0.1); }
      else s.pan.setPosition(s.x, s.y, s.z);
      if (tg.rate && s.src.playbackRate) s.src.playbackRate.setTargetAtTime(tg.rate, t, 0.5);
      s.level = g;
    }
    for (const s of free) { // unused this frame: fade out, stop after a while
      s.gain.gain.setTargetAtTime(0, t, L.opts.release ?? 0.8); s.level = 0; s.idle += dt;
      if (s.idle > 8) { try { s.src.stop(); s.out.disconnect(); } catch { } L.slots.splice(L.slots.indexOf(s), 1); }
    }
  }
  _slot(L, tg) {
    const buf = this.pick(L.name); if (!buf) return null;
    const c = this.ctx, src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 20000; lp.Q.value = 0.5;
    const gain = c.createGain(); gain.gain.value = 0;
    // beds are stereo: a StereoPanner-less trick — the PannerNode downmixes stereo to place it, keeping width
    // small, which is what a distant crowd sounds like anyway; near ones we keep wider by mixing a dry share.
    const pan = this._panner(tg.x, tg.y, tg.z, false);
    const send = c.createGain(); send.gain.value = 0.2;
    src.connect(lp).connect(gain).connect(pan).connect(this.sfx); pan.connect(send).connect(this.revIn);
    src.start(c.currentTime, Math.random() * buf.duration); // every emitter at its own place in the loop
    return { src, lp, gain, pan, send, out: pan, x: tg.x, y: tg.y, z: tg.z, idle: 0, level: 0 };
  }
  // A single non-positional looping bed (wind): returns a handle with .gain and .lp
  bed(name, bus = "amb") {
    const buf = this.pick(name); if (!buf || !this.ctx) return null;
    const c = this.ctx, src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 20000;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(lp).connect(g).connect(bus === "amb" ? this.amb : this.sfx);
    src.start(c.currentTime, Math.random() * buf.duration);
    return { src, gain: g, lp };
  }
  // Debug/QA: capture what the player hears (post-limiter) for `seconds` of real time → 16-bit stereo WAV bytes.
  // Used by tools/audio-render.mjs --game to measure a real in-game battle mix.
  record(seconds) {
    const c = this.ctx, n = Math.round(seconds * c.sampleRate), L = new Float32Array(n), R = new Float32Array(n); let k = 0;
    const sp = c.createScriptProcessor(4096, 2, 2), mute = c.createGain(); mute.gain.value = 0;
    this.post.connect(sp); sp.connect(mute).connect(c.destination);
    return new Promise((done) => {
      sp.onaudioprocess = (e) => {
        const a = e.inputBuffer.getChannelData(0), b = e.inputBuffer.getChannelData(1), m = Math.min(a.length, n - k);
        L.set(a.subarray(0, m), k); R.set(b.subarray(0, m), k); k += m;
        if (k >= n) { sp.onaudioprocess = null; try { this.post.disconnect(sp); sp.disconnect(); } catch { } done(wav16(L, R, c.sampleRate)); }
      };
    });
  }
  activeVoices() { const t = this.ctx?.currentTime || 0; return this.voices.filter((v) => v.end > t).length; }
}

export function wav16(L, R, sr) {
  const n = L.length, out = new DataView(new ArrayBuffer(44 + n * 4));
  const w4 = (o, str) => { for (let i = 0; i < 4; i++) out.setUint8(o + i, str.charCodeAt(i)); };
  w4(0, "RIFF"); out.setUint32(4, 36 + n * 4, true); w4(8, "WAVE"); w4(12, "fmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); w4(36, "data"); out.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) { out.setInt16(44 + i * 4, clamp(L[i], -1, 1) * 32767, true); out.setInt16(46 + i * 4, clamp(R[i], -1, 1) * 32767, true); }
  return new Uint8Array(out.buffer);
}
