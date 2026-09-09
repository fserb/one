/*
 * one.js - the shell every game runs inside.
 *
 * A game is a module with four exports and no side effects:
 *
 * ```js
 * export const meta = {
 *   title: "wow", desc: "line\nline", bg: "#B8B5B9", fg: "#4B4158",
 * };
 * export function init() {}          // a round starts
 * export function update(dt) {}      // once a frame, seconds
 * export function render(ctx) {}     // 1024x1024, origin top-left
 * ```
 *
 * The build reads `meta` by importing the module under Deno, so nothing in it
 * may touch the DOM at module scope.
 *
 * Sound is opt-in: a game that wants it imports lib/sound.js directly, and one
 * that does not never pays for the synth.
 *
 * run() owns the canvas, the frame loop, input, the score and the game-over
 * screen. There is no intro: the round starts on frame one and the first input
 * goes to the game. A game calls gameOver() when the round ends; the overlay
 * handles everything after that, including starting the next one.
 */

import { registerPlus2d, Screen } from "../alma/src/index.js";
import { Camera } from "./camera.js";
import * as input from "./input.js";
import * as overlay from "./overlay.js";
import {
  act,
  DOWN,
  LEFT,
  meta,
  mouse,
  op,
  RIGHT,
  score,
  SIZE,
  UP,
} from "./state.js";

export { act, DOWN, LEFT, meta, mouse, RIGHT, score, SIZE, UP };

export const camera = new Camera();

let ctx = null;

export function run(game, { target = null } = {}) {
  registerPlus2d();
  Object.assign(meta, game.meta ?? {});
  op.game = game;

  const el = target ?? document.getElementById("canvas") ?? document.body;
  const screen = new Screen(el, { logical: [SIZE, SIZE] });
  op.screen = screen;
  ctx = screen.canvas.getContext("2d");

  document.title = meta.title;
  document.body.style.backgroundColor = meta.bg;

  input.init(screen.canvas);
  // Only there if the game imported lib/sound.js itself.
  op.sound?.arm(document);
  overlay.init();
  start();

  screen.start(frame);
  return screen;
}

export function start() {
  overlay.startGame();
  op.playing = true;
  op.game.init?.();
}

export function gameOver() {
  act.reset();
  op.playing = false;
  overlay.gameOver();
}

// Runs `func` `rate` times a second, whole steps per frame. Call it from
// update(), so the steps see this frame's input.
export function fixed(rate, func) {
  return op.screen.fixed(rate, func);
}

// Seconds the meta.desc hint has left on screen, and 0 once the player has
// dismissed it or it has gone. A game's opening move waits this out when it
// would otherwise land on a player who is still reading.
export function hint() {
  return overlay.hint();
}

// A line of text in the middle of the top bar.
export function msg(m) {
  op.topmsg = m;
}

function frame(dt) {
  act._frame(dt);
  camera._update(dt);
  input.poll();
  overlay.poll(dt);

  if (op.playing) {
    op.game.update?.(dt);
  } else {
    overlay.update(dt, start);
  }

  render();
  input.flush();
}

function render() {
  ctx.reset();
  op.screen.apply(ctx);

  ctx.fillStyle = meta.bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  if (op.playing) {
    ctx.save();
    op.game.render?.(ctx);
    ctx.restore();
  }

  overlay.render(ctx);
}
