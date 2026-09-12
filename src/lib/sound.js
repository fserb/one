/*
 * sound.js - sound effects, synthesised at load time or carried as samples.
 *
 * A game imports this itself and defines its sounds at module scope. Nothing
 * here touches the DOM until arm() catches the first gesture, so the build can
 * import a game to read its `meta`. A silent game leaves op.sound null and the
 * bundler drops fsfx and alma's Audio.
 *
 * A Track is callable: one call per stage, each processing what the last left.
 * Import the stages by name; handing the callback the whole `fsfx` namespace
 * would pin every module in the directory.
 *
 * ```js
 * import { ADSR, biquad, envelope, linear, oscillator } from "./lib/fsfx/fsfx.js";
 *
 * sound.make("drop", 0.3, (track) => {
 *   track(oscillator, { type: "saw", freq: linear(100, -300) });
 *   track(biquad, { type: "lowpass", freq: 1000 });
 *   track(envelope, { env: ADSR({ sustainv: 1, release: 0.25 }) });
 * });
 * sound.play("drop", { detune: 800 * (2 * Math.random() - 1) });
 * ```
 */

import { Audio } from "../alma/src/audio.js";
import { op } from "./one.js";
import {
  render as sfxrRender,
  SAMPLE_RATE as SFXR_RATE,
  Track,
} from "./fsfx/fsfx.js";

const SAMPLE_RATE = 48000;

let audio = null;
let muted = true; // nothing rendered yet, so play() has nothing to play
let hasSound = false;
// Asked for before there is an Audio to ask, so they are held until unlock().
let volume = 1;
let limit = 0;

// Each entry is the call that will put a sound into the Audio once there is
// one. A closure rather than the samples, so putPCM8() hands over the base64
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

// An AudioContext starts only under a gesture, and Safari wants the resume()
// inside the handler, so this cannot ride the frame loop.
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

// `rate` is here for sfxr, which counts a period in whole samples and so only
// renders right on a track at its own 44100.
export function make(name, duration, func, rate = SAMPLE_RATE) {
  const track = new Track(duration, rate, 1);
  func(track);
  put(name, track.build(), rate);
}

// One sfxr voice, played as it comes out; alma resamples its 44100. A voice
// that wants an fsfx stage after it goes through make() at that rate instead.
export function voice(name, opts) {
  put(name, sfxrRender(opts), SFXR_RATE);
}

// Samples somebody else rendered, at whatever rate they rendered at.
export function put(name, samples, rate = SAMPLE_RATE) {
  add(name, () => audio.put(name, samples, rate));
}

// 8-bit unsigned PCM in base64, one byte a frame and 128 for silence. `peak` is
// what it was normalised by, so it comes back at its own level.
export function putPCM8(name, base64, { rate = SAMPLE_RATE, peak = 1 } = {}) {
  add(name, () => audio.putPCM8(name, base64, { rate, peak }));
}

// `opts` goes straight to alma's Playback: detune, delay, rate, volume, pan.
// `ready` and not merely built: a suspended context has a stopped clock, and a
// frame of sounds scheduled into one all land together the moment it starts.
export function play(name, opts) {
  if (muted || !audio?.ready) return;
  audio.play(name, opts);
}

export function setVolume(v) {
  volume = v;
  if (audio) audio.volume = v;
}

// A soft ceiling on the sum of what is playing: below it the output is the
// input, above it bends to 1.0. 0 is a straight wire.
export function setLimit(v) {
  limit = v;
  if (audio) audio.limit = v;
}

op.sound = { arm }; // the only way one.js reaches this module
