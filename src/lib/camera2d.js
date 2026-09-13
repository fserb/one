/*
 * camera2d.js - alma's full Camera2D over the 1024 box, for the two games that
 * need more than lib/camera.js's SimpleCamera: blob's push() and spin(), which
 * tilt the frame on a spring, and trap's fit() and glide(), its level zoom.
 * 3.4 KB more than the simple one. Both shake the camera themselves, so
 * lib/camera.js's shake() is not here.
 */

import { Camera2D } from "../alma/src/camera.js";
import { op } from "./one.js";

export const camera = new Camera2D({
  width: 1024,
  height: 1024,
  x: 512,
  y: 512,
});

op.camera = camera; // how one.js updates it without importing this module
