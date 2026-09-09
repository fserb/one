/*
 * sound.js - procedural sound effects, synthesised at load time.
 *
 * A game defines its sounds once at module scope; make() renders the samples
 * into memory. The AudioContext waits for the first user gesture, which is what
 * arm() listens for; nothing here touches the DOM before that, so the build can
 * import a game module under Deno to read its `meta`.
 *
 * The shell does not import this module. A game that wants sound imports it
 * itself, and the module registers what the overlay needs into `op.sound` on
 * the way in; a silent game leaves that null, and the bundler drops fsfx and
 * alma's Audio out of its page. A game that imports it but never calls make()
 * stays muted, and the overlay hides the ♫ toggle.
 *
 * A Track is callable: pass it a module and its parameters, once per stage, and
 * each stage processes the buffer the one before it left. The game imports the
 * stages it wants by name, so its bundle carries those and not the other forty:
 * make() handing its callback the whole `fsfx` namespace instead would pin
 * every module in the directory, since nothing can be shaken out of a namespace
 * object that is passed around at runtime.
 *
 * ```js
 * import { ADSR, biquad, envelope, linear, oscillator } from "./lib/fsfx/fsfx.js";
 *
 * sound.make("drop", 0.3, (track) => {
 *   track(oscillator, { type: "saw", freq: linear(100, -300) });
 *   track(biquad, { type: "lowpass", freq: 1000 });
 *   track(envelope, { env: ADSR({ sustainv: 1, release: 0.25 }) });
 * });
 * sound.play("drop", 800 * (2 * Math.random() - 1));
 * ```
 */

import { Audio } from "../alma/src/index.js";
import { op } from "./state.js";
import { Track } from "./fsfx/fsfx.js";

const SAMPLE_RATE = 48000;

let audio = null;
let muted = true;
let hasSound = false;

// Rendered before the AudioContext existed, so audio.put() could not run yet.
// The rate travels with the block: a renderer that is tuned for some other rate
// hands us its own, and alma resamples into the context.
const pending = new Map();

function flush() {
  if (!audio) return;
  for (const [name, { block, rate }] of pending) audio.put(name, block, rate);
  pending.clear();
}

function add(name, block, rate) {
  pending.set(name, { block, rate });
  hasSound = true;
  muted = false;
  flush();
}

function unlock() {
  if (!hasSound || audio) return;
  audio = new Audio(new AudioContext({ sampleRate: SAMPLE_RATE }));
  audio.resume();
  flush();
}

// A browser starts an AudioContext only under a user gesture, and Safari wants
// the resume() inside the handler, so this cannot ride the frame loop.
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

export function make(name, duration, func) {
  const track = new Track(duration, SAMPLE_RATE, 1);
  func(track);
  add(name, track.build(), SAMPLE_RATE);
}

// Registers samples somebody else rendered, at whatever rate they rendered at.
export function put(name, samples, rate = SAMPLE_RATE) {
  add(name, samples, rate);
}

export function play(name, detune = 0, delay = 0) {
  if (muted || !audio) return;
  audio.play(name, { detune, delay });
}

export function available() {
  return hasSound;
}

export function isMuted() {
  return muted;
}

export function toggle() {
  if (!hasSound) return;
  muted = !muted;
}

export function setVolume(v) {
  if (audio) audio.volume = v;
}

// What one.js and overlay.js call, and the only way they reach this module.
op.sound = { arm, available, isMuted, toggle };
