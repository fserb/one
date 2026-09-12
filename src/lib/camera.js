// alma's Camera2D over the 1024 box. A game imports it itself; one that does
// not leaves op.camera null and saves the 6.5 KB. alma's docs are the
// reference for moveTo/glide/approach/fit/toWorld/apply.

import { Camera2D } from "../alma/src/camera.js";
import { op, SIZE } from "./one.js";

export const camera = new Camera2D({
  width: SIZE,
  height: SIZE,
  x: SIZE / 2,
  y: SIZE / 2,
});

op.camera = camera; // how one.js updates it without importing this module
