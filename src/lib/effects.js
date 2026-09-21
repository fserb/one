/*
 * effects.js - what a game does to the whole board rather than to one thing on
 * it: flash() and delay(). A game asks for one, and one.js runs it. The third,
 * shake(), is lib/camera.js's, since the camera is what carries it.
 *
 * step() is the clock, run at the top of the frame before anything reads what
 * it advanced. The delay is read where the drawing it changes happens:
 * entity.js's update() asks `frozen` whether to step the world at dt 0.
 */

let flashColor = null;
let flashLeft = 0;

let held = 0; // seconds of hitstop left
export let frozen = false; // held when this frame began

// The whole board one colour, over the game and under the panels. Zero seconds
// is the one frame it is asked on.
export function flash(color, t = 0) {
  flashColor = color;
  flashLeft = t;
}

// Hitstop: the frames it covers still run, at dt 0.
export function delay(t) {
  held = Math.max(held, t);
}

// A round starts, and so does a level: entity.js's reset() calls this too.
export function reset() {
  flashColor = null;
  flashLeft = 0;
  held = 0;
  frozen = false;
}

// The two clocks of a frame, and the only place either of them moves.
export function step(dt) {
  // Read before the time is spent, so a delay shorter than a frame still
  // freezes one: cable and hypermania ask for 0.01 and mean exactly that.
  frozen = held > 0;
  if (frozen) held -= dt;

  if (flashColor !== null && (flashLeft -= dt) <= 0) flashColor = null;
}

// one.js skips this on the frame the round ends: a game that flashes on death
// would otherwise hold the whole screen one colour under the finish screen.
export function render(ctx) {
  if (flashColor === null) return;
  ctx.fillStyle = flashColor;
  ctx.fillRect(0, 0, 1024, 1024);
}
