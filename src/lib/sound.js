/*
 * sound.js - procedural sound effects, synthesised at load time.
 *
 * A game imports this itself and defines its sounds at module scope; make()
 * renders the samples into memory. Nothing here touches the DOM until arm()
 * catches the first gesture, so the build can import a game to read its `meta`.
 * The module writes op.sound on the way in; a silent game leaves that null and
 * the bundler drops fsfx and alma's Audio.
 *
 * voice() is the sfxr path: one options object, no track, since twelve of the
 * ported games want the voice exactly as sfxr renders it. src/lib/fsfx/sfxr.js
 * says what the options are.
 *
 * A Track is callable: one call per stage, each processing what the last left.
 * The game imports the stages by name, so its bundle carries those and not the
 * other forty; handing the callback the whole `fsfx` namespace would pin every
 * module in the directory.
 *
 * make() takes the rate the Track runs at, which only sfxr's stage has a reason
 * to move: it counts a period in whole samples, so 48000 would be another pitch.
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
import { op } from "./one.js";
import {
  render as sfxrRender,
  SAMPLE_RATE as SFXR_RATE,
  Track,
} from "./fsfx/fsfx.js";

const SAMPLE_RATE = 48000;

let audio = null;
// Nothing rendered yet, so play() has nothing to play.
let muted = true;
let hasSound = false;

// Rendered before the AudioContext existed. The rate travels with the block,
// and alma resamples into the context.
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
  add(name, track.build(), rate);
}

// One sfxr voice, played as it comes out. sfxr renders at its own 44100 and
// alma resamples; a voice that wants an fsfx stage after it goes through make()
// with that rate instead.
export function voice(name, opts) {
  add(name, sfxrRender(opts), SFXR_RATE);
}

// Samples somebody else rendered, at whatever rate they rendered at.
export function put(name, samples, rate = SAMPLE_RATE) {
  add(name, samples, rate);
}

export function play(name, detune = 0, delay = 0) {
  if (muted || !audio) return;
  audio.play(name, { detune, delay });
}

export function setVolume(v) {
  if (audio) audio.volume = v;
}

// The only way one.js reaches this module.
op.sound = { arm };
