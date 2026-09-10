/*
 * one.js - the shell every game runs inside. run() owns the canvas, the frame
 * loop, input, the score and the game-over screen.
 *
 * A game is a module exporting meta, init(), update(dt) and render(ctx), with
 * no side effects: the build reads `meta` by importing it under Deno, so
 * nothing may touch the DOM at module scope. Sound and the camera are opt-in
 * imports, so a game that wants neither pays for neither.
 *
 * There is no intro; the round starts on frame one. A game calls gameOver()
 * when it ends, and the overlay does the rest, including the next round.
 */

import { registerPlus2d, Screen } from "../alma/src/index.js";
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
  // Only there if the game imported lib/sound.js.
  op.sound?.arm(document);
  overlay.init();
  start();

  screen.start(frame);
  return screen;
}

export function start() {
  // Only there if the game imported lib/camera.js. Back on the whole board, so
  // init() sets only what it wants different.
  op.camera?.moveTo({ x: SIZE / 2, y: SIZE / 2, scale: 1, angle: 0 }).settle();
  flashColor = null;
  overlay.startGame();
  op.playing = true;
  op.game.init?.();
}

export function gameOver() {
  act.reset();
  op.playing = false;
  overlay.gameOver();
}

// Runs `func` `rate` times a second in whole steps. Call it from update(), so
// the steps see this frame's input.
export function fixed(rate, func) {
  return op.screen.fixed(rate, func);
}

// Seconds of meta.desc hint left, 0 once dismissed or gone. An opening move
// waits this out rather than landing on a player who is still reading.
export function hint() {
  return overlay.hint();
}

export function msg(m) {
  op.topmsg = m;
}

/*
 * ugl's Micro.flash(): the whole board one colour, over the game and under the
 * bar. `color` is CSS, so a game on ugl's numeric palette passes css(c).
 *
 * The clock runs after the draw, so t = 0 is one frame and never none whatever
 * the frame rate. cable asks for 0.05 and gets however many frames fit.
 */
let flashColor = null;
let flashTime = 0;

export function flash(color, t = 0) {
  flashColor = color;
  flashTime = t;
}

function frame(dt) {
  act._frame(dt);
  op.camera?.update(dt);
  input.poll();
  overlay.poll(dt);

  if (op.playing) {
    op.game.update?.(dt);
  } else {
    overlay.update(dt, start);
  }

  render();
  if (flashColor !== null && (flashTime -= dt) <= 0) flashColor = null;
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
    if (flashColor !== null) {
      ctx.fillStyle = flashColor;
      ctx.fillRect(0, 0, SIZE, SIZE);
    }
  }

  overlay.render(ctx);
}
