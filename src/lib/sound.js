/*
 * sound.js - sound effects, synthesised at load time or carried as samples.
 *
 * A game imports this itself and defines its sounds at module scope; make()
 * renders the samples into memory. Nothing here touches the DOM until arm()
 * catches the first gesture, so the build can import a game to read its `meta`.
 * The module writes op.sound on the way in; a silent game leaves that null and
 * the bundler drops fsfx and alma's Audio.
 *
 * voice() is the sfxr path: one options object, no track, since twelve games
 * want the voice exactly as sfxr renders it. src/lib/fsfx/sfxr.js
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
 * putPCM8() is the one door that is not synthesis: base64 8-bit PCM, which is a
 * recording small enough to sit in the source. blob's two knocks come that way.
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
// Asked for before there is an Audio to ask, so they are held until unlock().
let volume = 1;
let limit = 0;

/*
 * Rendered before the AudioContext existed, so each entry is the call that will
 * put it in once there is one. A closure rather than the samples, so putPCM8()
 * hands alma's Audio the base64 it already decodes and this file does not
 * restate that decode.
 */
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

// One sfxr voice, played as it comes out. sfxr renders at its own 44100 and
// alma resamples; a voice that wants an fsfx stage after it goes through make()
// with that rate instead.
export function voice(name, opts) {
  put(name, sfxrRender(opts), SFXR_RATE);
}

// Samples somebody else rendered, at whatever rate they rendered at.
export function put(name, samples, rate = SAMPLE_RATE) {
  add(name, () => audio.put(name, samples, rate));
}

// 8-bit unsigned PCM in base64, one byte a frame and 128 for silence: the
// smallest a recording gets while it is still source rather than a file to
// fetch. `peak` is what it was normalised by, so it comes back at its own
// level. alma's Audio.putPCM8 does the decode.
export function putPCM8(name, base64, { rate = SAMPLE_RATE, peak = 1 } = {}) {
  add(name, () => audio.putPCM8(name, base64, { rate, peak }));
}

/*
 * `opts` goes straight to alma's Playback: detune in cents, delay in seconds,
 * rate as a playback multiplier, volume and pan.
 *
 * `ready` and not merely built: a suspended context has a stopped clock, and a
 * frame of sounds scheduled into one all land together the moment it starts.
 */
export function play(name, opts) {
  if (muted || !audio?.ready) return;
  audio.play(name, opts);
}

export function setVolume(v) {
  volume = v;
  if (audio) audio.volume = v;
}

// A soft ceiling on the sum of what is playing, in alma's Audio.limit: below it
// the output is the input, above it it bends to 1.0. 0 is a straight wire,
// which is what a game that never stacks its sounds wants.
export function setLimit(v) {
  limit = v;
  if (audio) audio.limit = v;
}

// The only way one.js reaches this module.
op.sound = { arm };
