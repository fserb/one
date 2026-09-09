/*
 * input.js - collapses every input device into `mouse`.
 *
 * A game only ever reads mouse.x/y (in 1024-space), the three click edges and
 * mouse.swipe. Arrow keys, WASD, a gamepad d-pad and a flick of the finger all
 * arrive as a swipe; space and enter arrive as a click. poll() runs before the
 * game's update, flush() after the frame, because alma's Input keeps an edge
 * alive for exactly one update() call.
 */

import { Input } from "../alma/src/index.js";
import { DOWN, LEFT, mouse, op, RIGHT, UP } from "./state.js";

const DIRS = [["up", UP], ["right", RIGHT], ["down", DOWN], ["left", LEFT]];

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

  return input;
}

export function poll() {
  const p = op.screen.toLogical(input.pointer.x, input.pointer.y);
  mouse.x = p.x;
  mouse.y = p.y;

  mouse.press = input.press("click");
  mouse.click = input.just("click");
  mouse.release = input.release("click");

  mouse.swipe = 0;
  for (const [name, dir] of DIRS) {
    if (input.just(name)) mouse.swipe = dir;
  }
}

export function flush() {
  input.update();
}

export function destroy() {
  input?.destroy();
  input = null;
}
