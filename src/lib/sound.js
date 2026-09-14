/*
 * sound.js - sound effects, synthesised at load time or given as samples.
 *
 * A game imports this itself and defines its sounds at module scope. Nothing
 * here uses the DOM until arm() gets the first gesture, so the build can
 * import a game to read its `meta`. A silent game leaves op.sound null and the
 * bundler drops the synth and alma's Audio.
 *
 * Two synths, and which one a sound uses is what it is: `voice()` is sfxr, one
 * fixed arcade voice out of a seed, and thirteen games use nothing else.
 * `make()` is alma's sfx, a params object with a source and a chain, for the
 * three games whose sounds sfxr has no shape for. A stage is a value you
 * import, so a game ships the stages it names and no others.
 *
 * ```js
 * import { crush, lp } from "./alma/src/sfx.js";
 *
 * sound.make("drop", {
 *   osc: {osc: "brown", env: [0, .3, 1e-4], fx: [crush(4, 8000), lp(1600)]},
 *   env: ["expIn", .005, "expOut", .28],
 * });
 * sound.voice("hit", { ...explosion(1238), vol: 0.2 });
 * sound.play("drop", { detune: 800 * (2 * Math.random() - 1) });
 * ```
 *
 * A sound is rendered once at load and played from the buffer. sfx renders
 * the nine in the three games in about 28 ms between them.
 */

import { Audio } from "../alma/src/audio.js";
import { sfx } from "../alma/src/sfx.js";
import { op } from "./one.js";
import { render as sfxrRender, SAMPLE_RATE as SFXR_RATE } from "./sfxr.js";

const SAMPLE_RATE = 48000;

let audio = null;
let muted = true; // nothing rendered yet, so play() has nothing to play
let hasSound = false;
// Set before there is an Audio to set them on, so they are kept until unlock().
let volume = 1;
let limit = 0;

// Each entry is the call that will put a sound into the Audio once there is
// one. A closure rather than the samples, so putPCM8() passes on the base64
// that alma already decodes rather than restating that decode.
const pending = new Map();

function flush() {
  if (!audio) return;
  for (const put of pending.values()) put();
  pending.clear();
}

function add(name, put) {
  pending.set(name, put);
  hasSound = true;
  muted = false;
  flush();
}

function unlock() {
  if (!hasSound || audio) return;
  audio = new Audio(new AudioContext({ sampleRate: SAMPLE_RATE }));
  audio.volume = volume;
  audio.limit = limit;
  audio.resume();
  flush();
}

// An AudioContext starts only under a gesture, and Safari needs the resume()
// inside the handler, so this cannot run from the frame loop.
export function arm(target) {
  const stop = new AbortController();
  const opts = { capture: true, signal: stop.signal };
  const go = () => {
    unlock();
    if (audio) stop.abort();
  };
  target.addEventListener("pointerdown", go, opts);
  target.addEventListener("keydown", go, opts);
}

// alma's sfx, at the rate the mixer runs and with no supersampling. Both are
// fixed here rather than per sound, because a game's sounds are tuned by ear
// at one setting and `over` is not only a quality knob: alma's brown and pink
// are one-pole filters whose corner follows rate * over, so raising it tilts
// every noise about 10 dB across the band. It is also 6x cheaper at 1, and
// nothing in the gallery aliases enough at 1 to hear.
export function make(name, params) {
  put(name, sfx(params, { rate: SAMPLE_RATE, over: 1 }));
}

// One sfxr voice, played as rendered; alma resamples its 44100, which it has
// to keep because sfxr counts a period in whole samples.
export function voice(name, opts) {
  put(name, sfxrRender(opts), SFXR_RATE);
}

// Samples somebody else rendered, at whatever rate they rendered at.
export function put(name, samples, rate = SAMPLE_RATE) {
  add(name, () => audio.put(name, samples, rate));
}

// 8-bit unsigned PCM in base64, one byte a frame and 128 for silence. `peak` is
// what it was normalised by, so it is restored to its original level.
export function putPCM8(name, base64, { rate = SAMPLE_RATE, peak = 1 } = {}) {
  add(name, () => audio.putPCM8(name, base64, { rate, peak }));
}

// `opts` goes straight to alma's Playback: detune, delay, rate, volume, pan.
// `ready` and not merely built: a suspended context has a stopped clock, and a
// frame of sounds scheduled into one all play together the moment it starts.
export function play(name, opts) {
  if (muted || !audio?.ready) return;
  audio.play(name, opts);
}

export function setVolume(v) {
  volume = v;
  if (audio) audio.volume = v;
}

// A limit on the sum of what is playing: below it the output is the input,
// above it the output curves to 1.0. 0 turns the limiter off.
export function setLimit(v) {
  limit = v;
  if (audio) audio.limit = v;
}

op.sound = { arm }; // the only way one.js reaches this module
