// sound.js

import * as fsfx from "./fsfx/fsfx.js";

let player;

export function init() {
  player = new fsfx.Player();
  player.trapEvents();
}

const blockBuffer = [];
function flushSamples() {
  if (!player || !player.ready()) return;
  for (const o of blockBuffer) {
    player.sample(o.name, o.block);
  }
  blockBuffer.length = 0;
}

export function make(name, duration, func) {
  const track = new fsfx.Track(duration, 48000, 1);
  func(fsfx, track);
  const block = track.build();

  blockBuffer.push({name, block});
  flushSamples();
}

export function play(name, detune = 0, when = 0) {
  if (!player.ready()) return;
  if (blockBuffer.length > 0) flushSamples();
  player.samplePlay(name, detune, when);
}