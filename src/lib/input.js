/*
 * input.js - collapses every input device into `mouse`.
 *
 * A game only ever reads mouse.x/y (in 1024-space), the three click edges and
 * mouse.swipe. Arrow keys, WASD and a gamepad d-pad all arrive as a swipe;
 * space and enter arrive as a click. poll() runs before the game's update,
 * flush() after the frame, because alma's Input keeps an edge alive for exactly
 * one update() call.
 */

import { Input } from "../alma/input/input.js";
import { DOWN, LEFT, mouse, op, RIGHT, UP } from "./state.js";

// A drag counts as a swipe within this cone of the axis it is closest to.
const CONE = Math.PI / 16;
// 1024-space units per millisecond.
const MIN_SPEED = 0.3;
const MAX_TIME = 500;

const DIRS = [["up", UP], ["right", RIGHT], ["down", DOWN], ["left", LEFT]];

let input = null;
const down = { x: 0, y: 0, t: 0 };

export function init(target) {
  input = new Input();
  input.init(target);

  input.bind("click", "click", "space", "enter", "pad:a");
  input.bind("up", "arrowup", "w", "pad:up", "pad:lsup");
  input.bind("right", "arrowright", "d", "pad:right", "pad:lsright");
  input.bind("down", "arrowdown", "s", "pad:down", "pad:lsdown");
  input.bind("left", "arrowleft", "a", "pad:left", "pad:lsleft");

  return input;
}

// The angle of a drag, as one of the four directions, or 0 for anything that
// does not point cleanly along an axis.
function direction(dx, dy) {
  const a = Math.atan2(-dy, dx);
  if (a < CONE && a > -CONE) return RIGHT;
  if (a > Math.PI / 2 - CONE && a < Math.PI / 2 + CONE) return UP;
  if (a > Math.PI - CONE || a < -Math.PI + CONE) return LEFT;
  if (a < -Math.PI / 2 + CONE && a > -Math.PI / 2 - CONE) return DOWN;
  return 0;
}

export function poll() {
  const p = op.screen.toLogical(input.pointer.x, input.pointer.y);
  mouse.x = p.x;
  mouse.y = p.y;

  mouse.press = input.press("click");
  mouse.click = input.just("click");
  mouse.release = input.release("click");

  if (mouse.click) {
    down.x = p.x;
    down.y = p.y;
    down.t = performance.now();
  }

  mouse.swipe = 0;
  for (const [name, dir] of DIRS) {
    if (input.just(name)) mouse.swipe = dir;
  }

  if (mouse.release) {
    const dt = performance.now() - down.t;
    const dx = p.x - down.x;
    const dy = p.y - down.y;
    if (dt < MAX_TIME && Math.hypot(dx, dy) / dt >= MIN_SPEED) {
      mouse.swipe = direction(dx, dy) || mouse.swipe;
    }
  }
}

export function flush() {
  input.update();
}

export function destroy() {
  input?.destroy();
  input = null;
}
