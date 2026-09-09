/*
 * sound.js - procedural sound effects, synthesised at load time.
 *
 * A game defines its sounds once at module scope; make() renders the samples
 * into memory. Nothing plays and no AudioContext exists until the player has
 * seen a user gesture, which the browser requires anyway.
 *
 * A game with no make() call stays muted, and the overlay hides the ♫ toggle.
 *
 * ```js
 * sound.make("hold", 0.1, (f, track) => {
 *   track.oscillator(f.wave("sine"), f.linear(440, 220))
 *        .envelope(f.adsr(0.01, 0.05, 0, 0.04));
 * });
 * sound.play("hold", 800 * (2 * Math.random() - 1));
 * ```
 */

import * as fsfx from "./fsfx/fsfx.js";

const SAMPLE_RATE = 48000;

let player = null;
let muted = true;
let hasSound = false;

// Samples made before the player exists, or before it has a context.
const pending = [];

function init() {
  player = new fsfx.Player(SAMPLE_RATE);
  player.trapEvents();
  muted = false;
  hasSound = true;
}

function flush() {
  if (!player?.ready()) return;
  for (const s of pending) player.sample(s.name, s.block);
  pending.length = 0;
}

export function make(name, duration, func) {
  const track = new fsfx.Track(duration, SAMPLE_RATE, 1);
  func(fsfx, track);
  pending.push({ name, block: track.build() });

  if (!player) init();
  flush();
}

export function play(name, detune = 0, when = 0) {
  if (muted || !player?.ready()) return;
  flush();
  player.samplePlay(name, detune, when);
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
  if (player) player.volume = v;
}
