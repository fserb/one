/*
 * props.js - a label, a burst of particles, and two clocks. Each is built in
 * one expression from an options object over the defaults.
 *
 * ```js
 * new ent.Text({ text: `+${n}`, x, y, size: 2, vel: [0, -20], duration: 1 });
 * new ent.Particle({ x, y, count: 20, speed: [50, 20], circle: true });
 * ent.every(1.5, () => { new Enemy(); });
 * ent.after(0.75, () => gameOver({ score: true }));
 * ```
 */

import { css, glyphs } from "./art.js";
import { Entity, game } from "./core.js";

// The fraction of the box that sits before the point.
const ALIGN = { left: 0, center: 0.5, right: 1 };
const VALIGN = { top: 0, middle: 0.5, bottom: 1 };

// `align` is "left"|"center"|"right" and "top"|"middle"|"bottom", in either
// order, space separated; a word that is neither is ignored.
export class Text extends Entity {
  static layer = 1000;

  constructor(opts = {}) {
    super();
    const o = {
      text: "",
      x: 0,
      y: 0,
      size: 1,
      color: 0xffffff,
      align: "center middle",
      vel: [0, 0],
      duration: null,
      ...opts,
    };

    this.pos.x = o.x;
    this.pos.y = o.y;
    this.vel.x = o.vel[0];
    this.vel.y = o.vel[1];
    this.text = String(o.text);
    this.size = o.size;
    this.color = o.color;
    this.duration = o.duration;

    this.ax = 0.5;
    this.ay = 0.5;
    for (const w of o.align.toLowerCase().split(/[\s_]+/)) {
      this.ax = ALIGN[w] ?? this.ax;
      this.ay = VALIGN[w] ?? this.ay;
    }
  }

  update() {
    if (this.duration === null) return;
    this.duration -= game.time;
    if (this.duration <= 0) this.remove();
  }

  render(ctx) {
    if (this.text.length === 0) return;
    const g = glyphs(this.text);
    const s = this.size;
    const x = -g.width * s * this.ax;
    const y = -g.height * s * this.ay;

    ctx.fillStyle = css(this.color);
    for (let i = 0; i < g.dots.length; i += 2) {
      ctx.fillRect(x + g.dots[i] * s, y + g.dots[i + 1] * s, s, s);
    }
  }
}

// A number, or a [base, spread] pair to roll one out of.
function roll(v) {
  return Array.isArray(v) ? v[0] + v[1] * Math.random() : v;
}

/*
 * A one-shot burst, centred on the board unless given a position. The step
 * scales velocity by the fraction of life left, so particles decelerate as
 * they age and fade with the same number. Every field takes a number or a
 * [base, spread] pair, and begin() rolls one value out of the pair per
 * particle. `spread` is how far out each starts along its own heading, which
 * is what makes a ring hollow.
 */
export class Particle extends Entity {
  constructor(opts = {}) {
    super();
    const o = this.opts = {
      x: null,
      y: null,
      color: 0xffffff,
      count: 100,
      size: 1,
      speed: 50,
      direction: [0, 2 * Math.PI],
      delay: 0,
      spread: 0,
      duration: [1, 0.2],
      circle: false,
      ...opts,
    };

    this.pos.x = o.x ?? game.size / 2;
    this.pos.y = o.y ?? game.size / 2;
    this.parts = []; // begin() fills these in, one frame later
  }

  begin() {
    const o = this.opts;
    for (let i = 0, n = Math.round(roll(o.count)); i < n; ++i) {
      const a = roll(o.direction);
      const speed = roll(o.speed);
      const spread = roll(o.spread);
      this.parts.push({
        x: this.pos.x + Math.cos(a) * spread,
        y: this.pos.y + Math.sin(a) * spread,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        size: roll(o.size),
        delay: roll(o.delay),
        time: roll(o.duration),
        alpha: 1,
        done: false,
      });
    }
  }

  update() {
    for (const p of this.parts) {
      if (this.age < p.delay) continue;
      const t = 1 - (this.age - p.delay) / p.time;
      if (t < 0) {
        p.done = true;
        continue;
      }
      p.x += p.vx * game.time * t;
      p.y += p.vy * game.time * t;
      p.alpha = t;
    }

    this.parts = this.parts.filter((p) => !p.done);
    if (this.parts.length === 0) this.remove();
  }

  // Particles carry world positions, so undo the entity translate.
  render(ctx) {
    ctx.translate(-this.pos.x, -this.pos.y);
    ctx.fillStyle = css(this.opts.color);
    for (const p of this.parts) {
      if (this.age < p.delay) continue;
      ctx.globalAlpha = p.alpha;
      if (this.opts.circle) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, 2 * Math.PI);
        ctx.fill();
      } else {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
  }
}

// An entity like anything else, so reset() clears it and delay() holds it.
class Clock extends Entity {
  constructor(t, fn, repeat) {
    super();
    this.t = t;
    this.fn = fn;
    this.repeat = repeat;
  }

  update() {
    if (this.age < this.t) return;
    if (!this.repeat) {
      this.remove();
      this.fn();
      return;
    }
    this.age -= this.t;
    if (this.fn() === false) this.remove();
  }
}

// Once, t seconds from now.
export function after(t, fn) {
  return new Clock(t, fn, false);
}

// Every t seconds until fn returns false, and at t 0 that is every frame.
export function every(t, fn) {
  return new Clock(t, fn, true);
}
