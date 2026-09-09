/*
 * camera.js - a view onto the 1024-space.
 *
 * The camera is a rectangle of side `z` centred on (cx, cy), rotated by
 * `angle`. z == SIZE shows the whole board; smaller zooms in. Most methods
 * return a new Camera rather than moving this one, so they compose into a
 * target to lerp() or approach() towards.
 *
 * ```js
 * camera.reset();
 * camera.lerp(camera.lookAt(px, py).distance(2), 0.5, ease.quadOut);
 * // in render():
 * camera.transform(ctx);
 * ```
 */

import { ease } from "../alma/src/index.js";
import { act, SIZE } from "./state.js";

const HALF = SIZE / 2;

export class Camera {
  constructor(x = 0, y = 0, angle = 0, z = SIZE, cx = HALF, cy = HALF) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.z = z;
    this.cx = cx;
    this.cy = cy;
    this.shaking = 0;
    this.mag = 0;
  }

  reset() {
    act(this).reset();
    this.x = this.y = this.angle = 0;
    this.z = SIZE;
    this.cx = this.cy = HALF;
    this.shaking = 0;
    return this;
  }

  copy() {
    return new Camera(this.x, this.y, this.angle, this.z, this.cx, this.cy);
  }

  set(c) {
    this.x = c.x;
    this.y = c.y;
    this.angle = c.angle;
    this.z = c.z;
    this.cx = c.cx;
    this.cy = c.cy;
    return this;
  }

  // Move a fraction of the way to `target` every frame. Framerate dependent by
  // design: it is a feel knob, not a simulation.
  approach(target, rate = {}) {
    const r = { cx: 0.05, cy: 0.05, z: 0.05, angle: 0.05, ...rate };
    for (const dim of ["cx", "cy", "z", "angle"]) {
      this[dim] = (1 - r[dim]) * this[dim] + r[dim] * target[dim];
    }
    this.x = this.cx - HALF;
    this.y = this.cy - HALF;
    return this;
  }

  lerp(target, duration, easing = ease.linear) {
    return act(this)
      .attr("x", target.x, duration, easing)
      .attr("y", target.y, duration, easing)
      .attr("angle", target.angle, duration, easing)
      .attr("z", target.z, duration, easing)
      .attr("cx", target.cx, duration, easing)
      .attr("cy", target.cy, duration, easing);
  }

  lookRect(x, y, w, h = w, angle = this.angle) {
    const s = Math.max(w, h);
    return new Camera(
      x - HALF + w / 2,
      y - HALF + h / 2,
      angle,
      s,
      x + w / 2,
      y + h / 2,
    );
  }

  lookAt(x, y) {
    const c = this.copy();
    c.cx = x;
    c.cy = y;
    c.x = c.cx - HALF;
    c.y = c.cy - HALF;
    return c;
  }

  rotate(angle) {
    const c = this.copy();
    c.angle += angle;
    return c;
  }

  // dz > 1 zooms in.
  distance(dz) {
    const c = this.copy();
    c.z /= dz;
    return c;
  }

  height(dz) {
    const c = this.copy();
    c.z += dz;
    return c;
  }

  translate(x, y) {
    const c = this.copy();
    c.x += x;
    c.y += y;
    return c;
  }

  // The visible box, in game coordinates.
  box() {
    return { a: this.map({ x: 0, y: 0 }), b: this.map({ x: SIZE, y: SIZE }) };
  }

  // Screen point to game point.
  map(p) {
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);

    const ax = p.x + this.x - this.cx;
    const ay = p.y + this.y - this.cy;

    return {
      x: (ax * cos - ay * sin) * this.z / SIZE + this.cx,
      y: (ax * sin + ay * cos) * this.z / SIZE + this.cy,
    };
  }

  shake(t = 0.4, mag = 100) {
    this.shaking = Math.max(this.shaking, t);
    this.mag = mag;
  }

  transform(ctx) {
    if (this.shaking > 0) {
      const mag = this.mag * this.shaking;
      ctx.translate(
        mag * (2 * Math.random() - 1),
        mag * (2 * Math.random() - 1),
      );
    }

    ctx.translate(this.cx - this.x, this.cy - this.y);
    ctx.rotate(-this.angle);
    ctx.scale(SIZE / this.z, SIZE / this.z);
    ctx.translate(-this.cx, -this.cy);
  }

  _update(dt) {
    this.shaking = Math.max(0, this.shaking - dt);
  }
}
