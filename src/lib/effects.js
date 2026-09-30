/*
 * effects.js - what a game does to the whole board rather than to one thing on
 * it: flash() and delay(). A game asks for one, and one.js runs it. The third,
 * shake(), is lib/camera.js's, since the camera is what carries it.
 *
 * step() runs the flash's clock at the top of the frame. The delay is read by
 * one.js's tick(), which runs the round at dt 0 while it holds.
 */

let flashColor = null;
let flashLeft = 0;

let left = 0; // seconds of hitstop left

// The whole board one colour, over the game and under the panels. Zero seconds
// is the one frame it is asked on.
export function flash(color, t = 0) {
  flashColor = color;
  flashLeft = t;
}

// Hitstop: the round's clock stops for `t` real seconds, and the frames it
// covers still run, at dt 0.
export function delay(t) {
  left = Math.max(left, t);
}

// Whether this frame is held, spending `real` seconds of the hitstop. Read
// before the time is spent, so a delay shorter than a frame still holds one:
// cable and hypermania ask for 0.01 and mean exactly that.
export function held(real) {
  const on = left > 0;
  if (on) left -= real;
  return on;
}

// A round starts, and so does a level: entity.js's reset() calls this too.
export function reset() {
  flashColor = null;
  flashLeft = 0;
  left = 0;
}

export function step(dt) {
  if (flashColor !== null && (flashLeft -= dt) <= 0) flashColor = null;
}

// one.js skips this on the frame the round ends: a game that flashes on death
// would otherwise hold the whole screen one colour under the finish screen.
export function render(ctx) {
  if (flashColor === null) return;
  ctx.fillStyle = flashColor;
  ctx.fillRect(0, 0, 1024, 1024);
}
