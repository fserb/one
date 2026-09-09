/*
 * input.js - collapses every input device into `mouse`.
 *
 * A game reads mouse.x/y (in 1024-space), the three click edges and
 * mouse.swipe. Arrow keys, WASD, a gamepad d-pad and a flick of the finger all
 * arrive as a swipe; space and enter arrive as a click. poll() runs before the
 * game's update, flush() after the frame, because alma's Input keeps an edge
 * alive for exactly one update() call.
 *
 * The same devices also fill `key`, which is the held state a game ported from
 * ugl wants: a direction it can hold down rather than a swipe it gets once.
 */

import { Input } from "../alma/src/index.js";
import { DOWN, key, LEFT, mouse, op, RIGHT, UP } from "./state.js";

const DIRS = [["up", UP], ["right", RIGHT], ["down", DOWN], ["left", LEFT]];
const KEYS = ["up", "right", "down", "left", "b1", "b2"];

let input = null;

export function init(target) {
  input = new Input();
  input.init(target);

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
  // ugl had X and the full stop on b1 and C on b2. The click is here too, so
  // the action button is the same button the pointer already is.
  input.bind("b1", "click", "space", "enter", "x", "period", "pad:a");
  input.bind("b2", "c", "slash", "pad:b");

  return input;
}

export function poll() {
  const p = op.screen.toLogical(input.pointer.x, input.pointer.y);
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
}
