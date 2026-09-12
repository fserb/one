/*
 * one.js - the code every game runs inside. run() owns the canvas, the frame
 * loop, input, the score and the game-over screen.
 *
 * A game is a module exporting meta, init(), update(dt) and render(ctx) and
 * doing nothing at module scope: the build reads `meta` by importing it under
 * Deno, so nothing may touch the DOM there.
 *
 * It also holds the shared state: meta, score, act and op. overlay.js reads
 * them back out of here, and camera.js and sound.js write op.camera and
 * op.sound. input.js owns mouse and key, since it is what writes them.
 */

import Act from "../alma/src/Act.js";
import { register as registerPlus2d } from "../alma/src/gfx/plus2d.js";
import { Screen } from "../alma/src/screen.js";
import * as input from "./input.js";
import { DOWN, key, LEFT, mouse, RIGHT, UP } from "./input.js";
import * as overlay from "./overlay.js";

export { DOWN, key, LEFT, mouse, RIGHT, UP };

// Every game draws into this box, whatever the canvas ends up being.
export const SIZE = 1024;

// Filled in from the game module's `meta` export by run().
export const meta = {
  title: "untitled",
  desc: "",
  bg: "#f2f0e5",
  fg: "#212123",
  // { bg, fg }, either half optional; absent derives both from meta.bg.
  overlay: null,
  scoreMax: true, // false when a low score is the good one
  date: null, // "YYYY-MM-DD", the gallery's order, newest first
};

export const act = new Act();

export const score = {
  value: 0,
  best: null,
};

// One mutable object rather than exported `let`s, because overlay.js imports it
// back out of one.js: the two are a cycle, and a binding read at module scope
// would still be in its dead zone.
export const op = {
  game: null,
  screen: null,
  playing: false,
  topmsg: null,
  // Null keeps fsfx, alma's Audio and Camera2D out of the bundle.
  sound: null,
  camera: null,
};

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
  // The board and not the document: the built page hangs the canvas in a square
  // on the gallery's colour, and dev.html's canvas has the body for a parent.
  screen.canvas.parentElement.style.backgroundColor = meta.bg;

  input.init(screen);
  op.sound?.arm(document); // only there if the game imported lib/sound.js
  overlay.init();
  start();

  screen.start(frame);
  return screen;
}

export function start() {
  act.reset();
  // Back on the whole board, so init() sets only what it wants different.
  op.camera?.moveTo({ x: SIZE / 2, y: SIZE / 2, scale: 1, angle: 0 }).settle();
  flashColor = null;
  overlay.startGame();
  op.playing = true;
  op.game.init?.();
}

// opts says what the finish screen holds and an empty one says nothing; see
// overlay.gameOver(). The board is drawn one more time after this frame's
// update, so the frozen shot is the game at the moment it ended.
export function gameOver(opts) {
  // Two collision paths can both end the same round; the first one wins.
  if (!op.playing) return;
  op.playing = false;
  ending = true;
  overlay.gameOver(opts);
}

// Runs `func` `rate` times a second in whole steps. Call it from update(), so
// the steps see this frame's input.
export function fixed(rate, func) {
  return op.screen.fixed(rate, func);
}

// hint() with no text answers the seconds left, 0 once dismissed or gone, so an
// opening move can wait out a player who is still reading.
export function hint(text) {
  if (text === undefined) return overlay.hint();
  overlay.show(text);
  return overlay.hint();
}

export function msg(m) {
  op.topmsg = m;
}

// The whole board one CSS colour, over the game and under the overlay. The
// clock runs after the draw, so t = 0 is one frame and never none.
let flashColor = null;
let flashTime = 0;

// The round ended this frame: draw the board once more, then keep it.
let ending = false;

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
  if (ending) {
    ending = false;
    overlay.shoot(op.screen.canvas);
    act.reset();
  }
  if (flashColor !== null && (flashTime -= dt) <= 0) flashColor = null;
  input.flush();
}

function render() {
  ctx.reset();
  op.screen.apply(ctx);

  ctx.fillStyle = meta.bg;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // `ending` draws the last board, without the flash: a game that flashes on
  // death would otherwise freeze the whole screen one colour.
  if (op.playing || ending) {
    ctx.save();
    op.game.render?.(ctx);
    ctx.restore();
    if (op.playing && flashColor !== null) {
      ctx.fillStyle = flashColor;
      ctx.fillRect(0, 0, SIZE, SIZE);
    }
  }

  overlay.render(ctx);
}
