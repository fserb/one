/*
 * sound.js - procedural sound effects, synthesised at load time.
 *
 * A game defines its sounds once at module scope; make() renders the samples
 * into memory. The AudioContext waits for the first user gesture, which is what
 * arm() listens for; nothing here touches the DOM before that, so the build can
 * import a game module under Deno to read its `meta`.
 *
 * A game with no make() call stays muted, and the overlay hides the ♫ toggle.
 *
 * A Track is callable: pass it a module and its parameters, once per stage, and
 * each stage processes the buffer the one before it left.
 *
 * ```js
 * sound.make("drop", 0.3, (f, track) => {
 *   track(f.oscillator, { type: "saw", freq: f.linear(100, -300) });
 *   track(f.biquad, { type: "lowpass", freq: 1000 });
 *   track(f.envelope, { env: f.ADSR({ sustainv: 1, release: 0.25 }) });
 * });
 * sound.play("drop", 800 * (2 * Math.random() - 1));
 * ```
 */

import { Audio } from "../alma/src/index.js";
import * as fsfx from "./fsfx/fsfx.js";

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
  const track = new fsfx.Track(duration, SAMPLE_RATE, 1);
  func(fsfx, track);
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
