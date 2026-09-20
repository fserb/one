/*
 * play.js - the random player tools/record.js records over.
 *
 * rec.js imports this and nothing else does, so it is in no game's bundle. It
 * dispatches what input.js listens for: keydown and keyup on the window,
 * pointermove, pointerdown and pointerup on the canvas. A press has a length
 * and the pointer travels rather than jumping, since one frame of a direction
 * moves most games a pixel.
 */

import { choice, randFloat, randInt, random } from "../alma/src/random.js";

const DIRS = ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"];
const HOLD = [0.12, 0.6];
const REST = 0.2;
const DIAG = 0.3;
const ACT = 0.3;
const SPEED = [0.4, 1.6]; // boards a second
const CLICK = [0.05, 0.3];
const GAP = [0.15, 0.9];
const PID = 9001; // an id no real pointer has

let canvas = null;
let raf = 0;
let last = 0;
const held = new Set();
let turn = 0;
const at = { x: 0, y: 0 }; // the pointer, in client coordinates
const to = { x: 0, y: 0 };
let speed = 0;
let down = false;
let next = 0;

export function start(el) {
  canvas = el;
  const r = canvas.getBoundingClientRect();
  at.x = r.left + r.width / 2;
  at.y = r.top + r.height / 2;
  aim(r);
  last = performance.now();
  turn = 0;
  next = 0;
  raf = requestAnimationFrame(tick);
}

export function stop() {
  cancelAnimationFrame(raf);
  raf = 0;
  for (const key of held) send("keyup", key);
  held.clear();
  if (down) {
    down = false;
    point("pointerup");
  }
  canvas = null;
}

function tick(now) {
  raf = requestAnimationFrame(tick);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const r = canvas.getBoundingClientRect();

  if (now >= turn) keys(now);
  move(dt, r);
  press(now);
}

function keys(now) {
  for (const key of held) send("keyup", key);
  held.clear();
  turn = now + randFloat(...HOLD) * 1000;
  if (random() < REST) return;

  const dir = randInt(DIRS.length);
  held.add(DIRS[dir]);
  // The one beside it, never the opposite: two directions a game reads as a
  // diagonal, where up and down at once is what it reads as neither.
  if (random() < DIAG) held.add(DIRS[(dir + choice([1, 3])) % DIRS.length]);
  if (random() < ACT) held.add(" ");
  for (const key of held) send("keydown", key);
}

function move(dt, r) {
  const dx = to.x - at.x;
  const dy = to.y - at.y;
  const d = Math.hypot(dx, dy);
  const step = speed * r.width * dt;
  if (d <= step) {
    aim(r);
  } else {
    at.x += dx / d * step;
    at.y += dy / d * step;
  }
  point("pointermove");
}

function aim(r) {
  to.x = r.left + random() * r.width;
  to.y = r.top + random() * r.height;
  speed = randFloat(...SPEED);
}

function press(now) {
  if (now < next) return;
  down = !down;
  point(down ? "pointerdown" : "pointerup");
  next = now + randFloat(...(down ? CLICK : GAP)) * 1000;
}

function point(type) {
  canvas.dispatchEvent(
    new PointerEvent(type, {
      pointerId: PID,
      pointerType: "mouse",
      isPrimary: true,
      clientX: at.x,
      clientY: at.y,
      buttons: down ? 1 : 0,
      bubbles: true,
    }),
  );
}

function send(type, key) {
  dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
}
