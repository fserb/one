/*
 * one.js - the code every game runs inside. run() sets up the canvas, the frame
 * loop, input, the score and the game-over screen.
 *
 * A game is a module exporting meta, init(), update(dt) and render(ctx) and
 * doing nothing at module scope: the build reads `meta` by importing it under
 * Deno, so nothing may use the DOM there.
 *
 * It also holds the shared state: meta, score, op and `time`, and the round's
 * clock. tick() is the round's part of a frame: it scales the frame's seconds
 * by speed(), holds them at 0 through effects.js's delay(), adds what advance()
 * asked for, and passes the result to `time`, fixed(), Act and the game's
 * update(). The camera, the overlay and the flash stay on the real clock.
 */

import { register as registerPlus2d } from "../alma/src/gfx/plus2d.js";
import { Screen } from "../alma/src/screen.js";
import * as effects from "./effects.js";
import { dropAct, init as initInput, input, poll as pollInput } from "./input.js";
import * as overlay from "./overlay.js";

export { input };

// Filled in from the game module's `meta` export by run().
export const meta = {
  title: "untitled",
  bg: "#f2f0e5",
  fg: "#212123",
  // The colour everything over the board draws in; absent picks it off meta.bg.
  overlay: null,
  scoreMax: true, // false when a low score is the good one
  date: null, // "YYYY-MM-DD"
  // A touch screen gets the pad below the board: see input.js.
  dpad: false,
};

export const score = {
  value: 0,
  best: null,
};

export let time = 0;

let rate = 1; // speed()
let owed = 0; // seconds advance() adds to the next tick
let dt = 0; // this tick's seconds on the round's clock
let ticks = 0;
const rates = new Map(); // fixed()'s accumulators, by rate

export function ramp(t = time) {
  return Math.sqrt(t * 0.006) + 1;
}

export function roll(level) {
  return Math.random() ** (100 / (level + 1));
}

// An angle in radians brought into -PI..PI, so fold(b - a) is the shorter turn
// from a to b.
export function fold(a) {
  return a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
}

// One mutable object rather than exported `let`s: sound.js writes into it at
// module scope, and a binding read there would still be in its temporal dead
// zone.
export const op = {
  game: null,
  screen: null,
  playing: false,
  // Null keeps the synth, alma's Audio, the camera and Act out of the bundle.
  sound: null,
  camera: null,
  act: null,
};

let ctx = null;

export async function run(game, { target = null } = {}) {
  registerPlus2d({ font: '"Vera", system-ui, sans-serif' });
  Object.assign(meta, game.meta ?? {});
  op.game = game;

  const el = target ?? document.getElementById("canvas") ?? document.body;
  const screen = new Screen(el, { logical: [1024, 1024] });
  op.screen = screen;
  ctx = screen.canvas.getContext("2d");

  document.title = meta.title;
  screen.canvas.parentElement.style.backgroundColor = meta.bg;

  await Promise.allSettled([
    document.fonts?.load('16px "Vera"'),
    document.fonts?.load('bold 16px "Vera"'),
  ]);

  initInput(screen, { dpad: meta.dpad });
  op.sound?.arm(document); // only there if the game imported lib/sound.js
  overlay.init();
  start();

  screen.start(frame);
  return screen;
}

export function start() {
  // The act that dismissed the finish screen is let go of here, so a game
  // reading press.act does not act on it.
  dropAct();
  op.act?.reset();
  // Reset to the whole board, so init() changes only what it needs to.
  op.camera?.moveTo({ x: 512, y: 512, scale: 1, angle: 0 }).settle();
  effects.reset();
  time = 0;
  rate = 1;
  owed = 0;
  rates.clear();
  overlay.startGame();
  op.playing = true;
  op.game.init?.();
}

// See overlay.gameOver() for opts. The board keeps drawing after this, off the
// state the round ended in, since update() is what stops.
export function gameOver(opts) {
  // Two collision paths can both end the same round; only the first call acts.
  if (!op.playing) return;
  op.playing = false;
  // The tweens in flight end with the round rather than running under the
  // finish screen.
  op.act?.reset();
  overlay.gameOver(opts);
}

// Runs `func` `hz` times a second of the round's clock, in whole steps, and
// returns the leftover as a fraction of a step. Call it from update(), so the
// steps use this frame's input.
export function fixed(hz, func) {
  let f = rates.get(hz);
  if (!f) rates.set(hz, f = { acc: 0, tick: -1, steps: 0 });
  const h = 1 / hz;
  if (f.tick !== ticks) {
    f.tick = ticks;
    f.acc += dt;
    f.steps = 0;
    while (f.acc >= h) {
      f.acc -= h;
      f.steps++;
    }
  }
  for (let i = 0; i < f.steps; i++) func(h);
  return f.acc / h;
}

// How fast the round's clock runs: 1 is real time, 0 stops it, 0.1 is slow
// motion. It stays until the game sets it again or a round starts. With no
// argument it returns the current speed.
export function speed(s) {
  if (s !== undefined) rate = s;
  return rate;
}

// The next tick runs `t` more seconds than the speed gives it, even at speed 0,
// which is how a stopped game steps one frame: advance(1 / 60).
export function advance(t) {
  owed += t;
}

// Moves `time`, and so ramp(), without running the seconds in between.
export function skip(t) {
  time += t;
}

// The round's part of a frame. frame() calls it while the round is playing,
// and a headless harness calls it in place of frame().
export function tick(real) {
  dt = (effects.held(real) ? 0 : real * rate) + owed;
  owed = 0;
  ticks++;
  time += dt;
  op.act?._frame(dt);
  op.game.update?.(dt, real);
}

/*
 * The one line of text over the board. Setting the text that is already up is a
 * no-op, so a game can call this from update() every frame; null or "" takes it
 * away.
 *
 *   at      "top", the default, or "bottom", which is where a rule goes
 *   x, y    the anchor, default the slot's
 *   align   which point of the text that is, "center top" and the like
 *   size    board units, default 28 at the top and 34 at the bottom
 *   color   a 0xrrggbb number or a CSS string, default theme(meta)
 *   hold    seconds before it fades, and input ends it early; without one it
 *           stays until the game replaces it or the round does
 *   once    show it only once a page load, however many rounds are played
 *
 * With no arguments it returns the seconds a fading line has left, and 0 once
 * it is gone or when the line is staying.
 */
export function msg(text, opts) {
  if (text === undefined) return overlay.left();
  overlay.show(text, opts);
  return overlay.left();
}

function frame(real) {
  op.camera?.update(real);
  pollInput();
  overlay.poll(real);
  effects.step(real);

  // A round that start() begins here runs this frame too, so nothing is drawn
  // before its entities have updated once.
  if (!op.playing) overlay.update(real, start);
  if (op.playing) tick(real);

  ctx.reset();
  op.screen.apply(ctx);

  ctx.fillStyle = meta.bg;
  ctx.fillRect(0, 0, 1024, 1024);

  ctx.save();
  op.game.render?.(ctx);
  ctx.restore();

  // The flash belongs to the round: a game that flashes on death would
  // otherwise hold the board one colour under the finish screen.
  if (op.playing) effects.render(ctx);

  overlay.render(ctx);
}
