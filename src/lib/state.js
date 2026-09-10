/*
 * state.js - the shell's shared mutable state. one.js, overlay.js, input.js,
 * camera.js and sound.js all read and write it, so none has to import another
 * and make the graph a cycle.
 */

import { Act } from "../alma/src/index.js";

// Every game draws into this box, whatever the canvas ends up being.
export const SIZE = 1024;

// Filled in from the game module's `meta` export by one.run().
export const meta = {
  title: "untitled",
  desc: "",
  bg: "#f2f0e5",
  fg: "#212123",
  // true: a high score is the good one. false: a low one is.
  scoreMax: true,
  // true: the end screen says WELL DONE instead of GAME OVER.
  finishGood: false,
  // Shown in the gallery, newest first. "YYYY-MM-DD".
  date: null,
};

export const act = new Act();

export const score = {
  value: 0,
  best: null,
};

export const UP = 1;
export const RIGHT = 2;
export const DOWN = 3;
export const LEFT = 4;

// In 1024-space, rewritten once a frame by input.poll().
export const mouse = {
  x: 0,
  y: 0,
  // Went down this frame.
  click: false,
  // Is down.
  press: false,
  // Went up this frame.
  release: false,
  // One of UP/RIGHT/DOWN/LEFT this frame, or 0.
  swipe: 0,
};

// ugl's Game.key: held now, plus what went down this frame. b1 doubles as the
// pointer, so every game plays with a mouse or a finger alone.
export const key = {
  up: false,
  right: false,
  down: false,
  left: false,
  b1: false,
  b2: false,
  just: {
    up: false,
    right: false,
    down: false,
    left: false,
    b1: false,
    b2: false,
  },
};

export const op = {
  game: null,
  screen: null,
  playing: false,
  topmsg: null,
  // sound.js and camera.js write themselves here when a game imports them.
  // Null keeps fsfx, alma's Audio and Camera2D out of the bundle.
  sound: null,
  camera: null,
};
