/*
 * one.js - the code every game runs inside. run() sets up the canvas, the frame
 * loop, input, the score and the game-over screen.
 *
 * A game is a module exporting meta, init(), update(dt) and render(ctx) and
 * doing nothing at module scope: the build reads `meta` by importing it under
 * Deno, so nothing may use the DOM there.
 *
 * It also has the shared state: meta, score, act and op. overlay.js reads
 * them back out of here, and camera.js and sound.js write op.camera and
 * op.sound. input.js declares `input`, since it is what writes it.
 */

import Act from "../alma/src/Act.js";
import { register as registerPlus2d } from "../alma/src/gfx/plus2d.js";
import { Screen } from "../alma/src/screen.js";
import { init as initInput, input, poll as pollInput, setDpad } from "./input.js";
import * as overlay from "./overlay.js";

export { input };

// Every game draws into this square, whatever size the canvas ends up being.
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
  // A touch steers rather than pointing: see the two mappings in input.js.
  dpad: false,
};

export const act = new Act();

export const score = {
  value: 0,
  best: null,
};

// One mutable object rather than exported `let`s, because overlay.js imports it
// back out of one.js: the two are a cycle, and a binding read at module scope
// would still be in its temporal dead zone.
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
  // The board and not the document: the built page puts the canvas in a square
  // on the gallery's colour, and dev.html's canvas has the body for a parent.
  screen.canvas.parentElement.style.backgroundColor = meta.bg;

  initInput(screen, { dpad: meta.dpad });
  op.sound?.arm(document); // only there if the game imported lib/sound.js
  overlay.init();
  start();

  screen.start(frame);
  return screen;
}

export function start() {
  act.reset();
  setDpad(meta.dpad);
  // Reset to the whole board, so init() changes only what it needs to.
  op.camera?.moveTo({ x: SIZE / 2, y: SIZE / 2, scale: 1, angle: 0 }).settle();
  flashColor = null;
  overlay.startGame();
  op.playing = true;
  op.game.init?.();
}

// opts says what the finish screen shows and an empty one shows nothing; see
// overlay.gameOver(). The board is drawn one more time after this frame's
// update, so the frozen shot is the game at the moment it ended.
export function gameOver(opts) {
  // Two collision paths can both end the same round; only the first call acts.
  if (!op.playing) return;
  op.playing = false;
  setDpad(false);
  ending = true;
  overlay.gameOver(opts);
}

// Runs `func` `rate` times a second in whole steps. Call it from update(), so
// the steps use this frame's input.
export function fixed(rate, func) {
  return op.screen.fixed(rate, func);
}

// hint() with no text returns the seconds left, 0 once dismissed or faded, so a
// game can delay an opening move while the player is still reading.
export function hint(text) {
  if (text === undefined) return overlay.hint();
  overlay.show(text);
  return overlay.hint();
}

export function msg(m) {
  op.topmsg = m;
}

// The whole board one CSS colour, over the game and under the overlay. The
// timer runs after the draw, so t = 0 lasts one frame rather than none.
let flashColor = null;
let flashTime = 0;

// The round ended this frame: draw the board once more, then store it.
let ending = false;

export function flash(color, t = 0) {
  flashColor = color;
  flashTime = t;
}

function frame(dt) {
  act._frame(dt);
  op.camera?.update(dt);
  pollInput();
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
