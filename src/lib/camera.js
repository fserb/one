/*
 * camera.js - alma's Camera2D, over the 1024 box.
 *
 * One of the parts of the shell a game imports itself:
 * `import { camera } from "./lib/camera.js"`. A game that never does leaves
 * op.camera null and carries none of the 6.5 KB the class costs, about what
 * gfx and alma's Audio cost together. one.js steps it every frame and puts it
 * back on the whole board at the start of a round, both only if it is there.
 *
 * x, y is the world point in the middle of the screen, scale is how far in and
 * angle how far round. moveTo() jumps, glide() flies, approach(to, dt) chases,
 * fit(box) names the framing that holds a rect, toWorld() takes the pointer
 * into game coordinates, and apply(ctx) is what render() calls.
 */

import { Camera2D } from "../alma/src/camera.js";
import { op, SIZE } from "./state.js";

export const camera = new Camera2D({
  width: SIZE,
  height: SIZE,
  x: SIZE / 2,
  y: SIZE / 2,
});

// How one.js drives it without importing this module.
op.camera = camera;
