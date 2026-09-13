/*
 * props.js - a label, a one-shot particle emitter, the score popup, and two
 * timers. Each is built in one expression from an options object over the
 * defaults.
 *
 * ```js
 * new ent.Text({ text: `+${n}`, x, y, size: 40, vel: [0, -40], duration: 1 });
 * new ent.Particle({ x, y, count: 20, speed: [107, 43], circle: true });
 * ent.addScore(10, this.pos.x, this.pos.y);
 * ent.every(1.5, () => { new Enemy(); });
 * ent.after(0.75, () => gameOver({ score: true }));
 * ```
 */

import { css } from "./gfx.js";
import { Entity, game } from "./core.js";
import { meta, score } from "./one.js";

// The words ctx.text() takes for textAlign and textBaseline.
const ALIGN = ["left", "center", "right"];
const VALIGN = ["top", "middle", "bottom"];

// `size` is the font's height in board units. `align` is one word from each of
// those two lists, in either order and space separated; anything else in it is
// ignored.
export class Text extends Entity {
  static layer = 1000;

  constructor(opts = {}) {
    super();
    const o = {
      text: "",
      x: 0,
      y: 0,
      size: 20,
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

    this.align = "center";
    this.valign = "middle";
    for (const w of o.align.toLowerCase().split(/[\s_]+/)) {
      if (ALIGN.includes(w)) this.align = w;
      if (VALIGN.includes(w)) this.valign = w;
    }
  }

  update() {
    if (this.duration === null) return;
    this.duration -= game.time;
    if (this.duration <= 0) this.remove();
  }

  render(ctx) {
    if (this.text.length === 0) return;
    ctx.fillStyle = css(this.color);
    ctx.text(this.text, 0, 0, this.size, {
      align: this.align,
      valign: this.valign,
    });
  }
}

// The score and the number that rises off the board are one call, so the two
// cannot come apart. The look is the same in every game: 40 board units of
// meta.fg, rising 45 of them over 0.7s. `opts` is the Text's, for the games
// that draw the number in a colour of their own.
export function addScore(n, x, y, opts = {}) {
  score.value += n;
  new Text({
    text: `+${Math.floor(n)}`,
    x,
    y,
    size: 40,
    color: parseInt(meta.fg.slice(1), 16),
    vel: [0, -64],
    duration: 0.7,
    ...opts,
  });
}

// A number, or a [base, spread] pair to choose one value from.
function choose(v) {
  return Array.isArray(v) ? v[0] + v[1] * Math.random() : v;
}

// A one-shot emission, centred on the board unless given a position. Velocity
// scales by the fraction of the lifetime left, so particles slow as they age
// and fade on the same number. Every field takes a number or a [base, spread]
// pair, drawn once per particle; `spread` is how far out each starts along its
// own direction, which is what leaves the middle of a ring empty.
export class Particle extends Entity {
  constructor(opts = {}) {
    super();
    const o = this.opts = {
      x: null,
      y: null,
      color: 0xffffff,
      count: 100,
      size: 2,
      speed: 107,
      direction: [0, 2 * Math.PI],
      delay: 0,
      spread: 0,
      duration: [1, 0.2],
      circle: false,
      ...opts,
    };

    this.pos.x = o.x ?? 512;
    this.pos.y = o.y ?? 512;
    this.parts = []; // begin() fills these in, one frame later
  }

  begin() {
    const o = this.opts;
    for (let i = 0, n = Math.round(choose(o.count)); i < n; ++i) {
      const a = choose(o.direction);
      const speed = choose(o.speed);
      const spread = choose(o.spread);
      this.parts.push({
        x: this.pos.x + Math.cos(a) * spread,
        y: this.pos.y + Math.sin(a) * spread,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        size: choose(o.size),
        delay: choose(o.delay),
        time: choose(o.duration),
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

  // Particles store world positions, so undo the entity translate.
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

// An entity like anything else, so reset() removes it and delay() pauses it.
class Timer extends Entity {
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
  return new Timer(t, fn, false);
}

// Every t seconds until fn returns false, and at t 0 that is every frame.
export function every(t, fn) {
  return new Timer(t, fn, true);
}
