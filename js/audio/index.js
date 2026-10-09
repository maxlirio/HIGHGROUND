// Audio entry point for the game: one call from main.js, one update per frame.
//   const audio = initAudio({ w, camera, map, player: PLAYER });   …   audio.update(dt);
// Everything is our own synthesized sound (tools/audio/render.py). The context is created at once but
// only starts on the first click/key (browser autoplay policy); the bank decodes in the background meanwhile.
// ?noaudio (or &bench) turns it off.
import { AudioEngine } from "./engine.js";
import { makeBattleAudio } from "./battle.js";
import { mountSoundUI } from "./ui.js";
import { afterLoading } from "../ui/loading.js";

export function initAudio({ w, camera, map, player = 0, castles = null, panel = document.querySelector("#overlays") }) {
  const params = new URLSearchParams(location.search);
  if (params.has("noaudio") || params.has("bench") || !(window.AudioContext || window.webkitAudioContext)) return { update() { }, engine: null };
  const eng = new AudioEngine();
  mountSoundUI(eng, panel);
  const battle = makeBattleAudio(eng, w, camera, map, { player, castles }); // (castles: js/render/castle.js — its cut-away tells us the camera is inside)
  eng.ensureContext();
  // (the bank — 12 MB, ~380 files — once the loading screen has lifted: nothing plays before the first click anyway, and
  // on the loading screen the models need the bandwidth)
  afterLoading().then(() => eng.load()).catch((e) => console.warn("audio: bank failed to load", e));
  const unlock = () => { eng.resume(); if (eng.ctx?.state === "running") for (const k of ["pointerdown", "keydown", "touchend"]) removeEventListener(k, unlock, true); };
  for (const k of ["pointerdown", "keydown", "touchend"]) addEventListener(k, unlock, true);
  window.HG_AUDIO = { engine: eng, battle };
  return { engine: eng, update: (dt) => { try { battle.update(dt); } catch (e) { if (!eng._warned) { eng._warned = true; console.warn("audio:", e); } } } };
}
