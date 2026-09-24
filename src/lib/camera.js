/*
 * camera.js - alma's SimpleCamera over the 1024 box, and shake(), the only
 * shake there is. The camera is what carries it, so a game that shakes imports
 * this and a game that does not pays none of the 2.9 KB.
 *
 * apply() adds the shake outside the scale, so a zoomed board shakes by the
 * same screen distance as a board at 1. alma's docs are the reference for
 * moveTo/approach/toWorld/view/apply.
 *
 * blob and trap want the recoil springs, fit() and glide(); they import
 * lib/camera2d.js for the full Camera2D instead.
 */

import { SimpleCamera } from "../alma/src/simplecamera.js";
import { op } from "./one.js";

export const camera = new SimpleCamera({
  width: 1024,
  height: 1024,
  x: 512,
  y: 512,
});

op.camera = camera; // how one.js updates it without importing this module

// A hit: SHAKE_BASE + SHAKE_FALL * t screen units, falling to SHAKE_BASE over
// t and then off. Written on the camera at each call rather than once here, so
// a game that shakes it directly keeps its own numbers.
const SHAKE_BASE = 10;
const SHAKE_FALL = 20;

export function shake(t = 0.4) {
  camera.shakeBase = SHAKE_BASE;
  camera.shake(t, SHAKE_FALL);
}
