// camera.js

import {ease, act} from "./internal.js";
import * as vec from "./vec.js";

class Camera {
  constructor(x = 0, y = 0, angle = 0, z = 1024, cx = 512, cy = 512) {
    this.x = x;
    this.y = y;
    this.angle = angle;
    this.z = z;
    this.cx = cx;
    this.cy = cy;
  }

  identity() {
    return new Camera();
  }

  reset() {
    this.x = this.y = this.angle = 0;
    this.z = 1024;
    this.cx = this.cy = 512;
    if (this.act) this.act.stop();
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
  }

  approach(target, inp = {}) {
    const res = Object.assign({cx: 0.05, cy: 0.05, z: 0.05, angle: 0.05}, inp);
    for (const dim of ["cx", "cy", "z", "angle"]) {
      const a = this[dim];
      const b = target[dim];

      this[dim] = (1 - res[dim]) * a + res[dim] * b;
    }

    this.x = this.cx - 512;
    this.y = this.cy - 512;

  }

  lerp(target, duration, easing) {
    easing = easing ?? ease.linear;

    if (!this.act) this.act = act(this);

    return this.act
      .attr("x", target.x, duration, easing)
      .attr("y", target.y)
      .attr("angle", target.angle)
      .attr("z", target.z)
      .attr("cx", target.cx)
      .attr("cy", target.cy);
  }

  lookRect(x, y, w, h, ang) {
    h = h ?? w;
    const s = Math.max(w, h);
    return new Camera(
      x - s * 512 / s + w / 2,
      y - s * 512 / s + h / 2,
      ang,
      s,
      x + w / 2, y + h / 2);
  }

  lookAt(x, y) {
    const c = this.copy();
    c.cx = x;
    c.cy = y;
    c.x = c.cx - 512;
    c.y = c.cy - 512;
    return c;
  }

  rotate(ang) {
    const c = this.copy();
    c.angle += ang;
    return c;
  }

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

  map(p) {
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);

    const ax = p.x + this.x - this.cx;
    const ay = p.y + this.y - this.cy;

    const bx = ax * cos - ay * sin;
    const by = ax * sin + ay * cos;

    const cx = (bx * this.z) / 1024 + this.cx;
    const cy = (by * this.z) / 1024 + this.cy;

    return {
      x: cx,
      y: cy,
    };
  }

  shake(t = 0.4, mag = 100) {
    this.shaking = Math.max(this.shaking ?? 0, t);
    this.mag = mag;
  }

  transform(ctx) {
    if (this.shaking) {
      const mag = this.mag * this.shaking;
      ctx.translate(
        mag * (2 * Math.random() - 1),
        mag * (2 * Math.random() - 1));
    }

    ctx.translate(this.cx - this.x, this.cy - this.y);
    ctx.rotate(-this.angle);
    ctx.scale(1024 / this.z, 1024 / this.z);
    ctx.translate(-this.cx, -this.cy);
  }

  _update(dt) {
    this.shaking = Math.max(0.0, (this.shaking ?? 0) - dt);
  }
}

export default new Camera();
