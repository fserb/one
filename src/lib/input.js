/*
 * input.js - every device mapped onto `mouse` and `key`. poll() runs before
 * the game's update and flush() after the frame, because alma's Input keeps an
 * edge set for exactly one update() call.
 *
 * It declares `mouse` and `key` rather than one.js, so nothing here imports the
 * rest of src/lib and the one.js <-> input.js cycle never exists.
 */

import { Input } from "../alma/src/input/input.js";

export const UP = 1;
export const RIGHT = 2;
export const DOWN = 3;
export const LEFT = 4;

// In 1024-space, rewritten once a frame by poll().
export const mouse = {
  x: 0,
  y: 0,
  click: false, // went down this frame
  press: false, // is down
  release: false, // went up this frame
  swipe: 0, // one of UP/RIGHT/DOWN/LEFT this frame, or 0
};

// Held now, plus what went down this frame. b1 is the pointer as well, so
// every game can be played with a mouse or a finger alone.
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

const DIRS = [["up", UP], ["right", RIGHT], ["down", DOWN], ["left", LEFT]];
const KEYS = ["up", "right", "down", "left", "b1", "b2"];

let input = null;
// alma's Screen, for toLogical(). Kept here rather than read off op, so
// input.js imports nothing from the rest of src/lib.
let screen = null;

export function init(scr) {
  screen = scr;
  input = new Input();
  input.init(screen.canvas);

  input.bind("click", "click", "space", "enter", "pad:a");
  input.bind("up", "arrowup", "w", "pad:up", "pad:lsup", "swipe:up");
  input.bind(
    "right",
    "arrowright",
    "d",
    "pad:right",
    "pad:lsright",
    "swipe:right",
  );
  input.bind("down", "arrowdown", "s", "pad:down", "pad:lsdown", "swipe:down");
  input.bind("left", "arrowleft", "a", "pad:left", "pad:lsleft", "swipe:left");
  // The click is on b1 too, so the action button is the pointer.
  input.bind("b1", "click", "space", "enter", "x", "period", "pad:a");
  input.bind("b2", "c", "slash", "pad:b");

  return input;
}

export function poll() {
  const p = screen.toLogical(input.pointer.x, input.pointer.y);
  mouse.x = p.x;
  mouse.y = p.y;

  mouse.press = input.press("click");
  mouse.click = input.just("click");
  mouse.release = input.release("click");

  for (const k of KEYS) {
    key[k] = input.press(k);
    key.just[k] = input.just(k);
  }

  mouse.swipe = 0;
  for (const [name, dir] of DIRS) {
    if (key.just[name]) mouse.swipe = dir;
  }
}

export function flush() {
  input.update();
}

export function destroy() {
  input?.destroy();
  input = null;
  screen = null;
}
