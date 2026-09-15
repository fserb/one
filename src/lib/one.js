/*
 * one.js - the code every game runs inside. run() sets up the canvas, the frame
 * loop, input, the score and the game-over screen.
 *
 * A game is a module exporting meta, init(), update(dt) and render(ctx) and
 * doing nothing at module scope: the build reads `meta` by importing it under
 * Deno, so nothing may use the DOM there.
 *
 * It also has the shared state: meta, score, op and the round clock the
 * difficulty is read off.
 */

import { register as registerPlus2d } from "../alma/src/gfx/plus2d.js";
import { Screen } from "../alma/src/screen.js";
import * as effects from "./effects.js";
import { init as initInput, input, poll as pollInput, setDpad } from "./input.js";
import * as overlay from "./overlay.js";

export { input };

// Filled in from the game module's `meta` export by run().
export const meta = {
  title: "untitled",
  desc: "",
  bg: "#f2f0e5",
  fg: "#212123",
  // The colour everything over the board draws in; absent picks it off meta.bg.
  overlay: null,
  scoreMax: true, // false when a low score is the good one
  date: null, // "YYYY-MM-DD"
  // A touch steers rather than pointing: see the two mappings in input.js.
  dpad: false,
};

export const score = {
  value: 0,
  best: null,
};

export let time = 0;

export function ramp(t = time) {
  return Math.sqrt(t * 0.006) + 1;
}

export function roll(level) {
  return Math.random() ** (100 / (level + 1));
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
  op.act?.reset();
  setDpad(meta.dpad);
  // Reset to the whole board, so init() changes only what it needs to.
  op.camera?.moveTo({ x: 512, y: 512, scale: 1, angle: 0 }).settle();
  effects.reset();
  time = 0;
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
  setDpad(false);
  // The tweens in flight end with the round rather than running under the
  // finish screen.
  op.act?.reset();
  overlay.gameOver(opts);
}

// Runs `func` `rate` times a second in whole steps. Call it from update(), so
// the steps use this frame's input.
export function fixed(rate, func) {
  return op.screen.fixed(rate, func);
}

/*
 * The one line of text over the board, and nothing is filled behind it. Setting
 * the text that is already up is a no-op, so a game can call this from update()
 * every frame; null or "" takes it away.
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
 * With no arguments it returns the seconds a fading line has left, 0 once it is
 * gone or when the line is staying, so a game can delay an opening move while
 * the player is still reading.
 */
export function msg(text, opts) {
  if (text === undefined) return overlay.left();
  overlay.show(text, opts);
  return overlay.left();
}

function frame(dt) {
  op.act?._frame(dt);
  op.camera?.update(dt);
  pollInput();
  overlay.poll(dt);
  effects.step(dt);

  if (op.playing) {
    time += dt;
    op.game.update?.(dt);
  } else {
    overlay.update(dt, start);
  }

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
