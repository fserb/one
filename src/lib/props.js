/*
 * props.js - the three entities that come with the model.
 *
 * A label, a burst of particles and a clock. No port subclasses them: a game
 * builds one and chains setters onto it, and the entity removes itself when it
 * is spent.
 *
 * ```js
 * new ent.Text().text(`+${n}`).xy(x, y).size(2).move(0, -20).duration(1);
 * new ent.Particle().xy(x, y).count(20).speed(50, 20).circle();
 * new ent.Timer().every(1.5).run(() => { new Enemy(); return true; });
 * ```
 */

import { css, glyphs } from "./art.js";
import { Entity, game } from "./core.js";

// Where align() puts the label's box against its position: the fraction of the
// box that sits before the point. Held as the number render() multiplies by,
// not as the word, so nothing re-decides the anchor every frame.
const ALIGN = { left: 0, center: 0.5, right: 1 };
const VALIGN = { top: 0, middle: 0.5, bottom: 1 };

// A label, centred on its position until align() says otherwise. Lives until
// removed, or duration() seconds if one is set.
export class Text extends Entity {
  static layer = 1000;

  constructor() {
    super();
    this._text = "";
    this._size = 1;
    this._color = 0xffffff;
    this._ax = 0.5;
    this._ay = 0.5;
    this._duration = null;
  }

  text(s) {
    this._text = String(s);
    return this;
  }

  // Velocity, so a score label can drift off the thing that scored it.
  move(x, y) {
    this.vel.x = x;
    this.vel.y = y;
    return this;
  }

  // "left"|"center"|"right" and "top"|"middle"|"bottom", in either order,
  // space separated: align("top left"). A word that is neither is ignored.
  align(a) {
    for (const w of a.toLowerCase().split(/[\s_]+/)) {
      this._ax = ALIGN[w] ?? this._ax;
      this._ay = VALIGN[w] ?? this._ay;
    }
    return this;
  }

  size(s) {
    this._size = s;
    return this;
  }

  color(c) {
    this._color = c;
    return this;
  }

  duration(v) {
    this._duration = v;
    return this;
  }

  update() {
    if (this._duration === null) return;
    this._duration -= game.time;
    if (this._duration <= 0) this.remove();
  }

  render(ctx) {
    if (this._text.length === 0) return;
    const g = glyphs(this._text);
    const s = this._size;
    const x = -g.width * s * this._ax;
    const y = -g.height * s * this._ay;

    ctx.fillStyle = css(this._color);
    for (let i = 0; i < g.dots.length; i += 2) {
      ctx.fillRect(x + g.dots[i] * s, y + g.dots[i + 1] * s, s, s);
    }
  }
}

// A one-shot burst. Every setter takes a base and a spread, and begin() rolls
// one value per particle out of the pair. The step scales velocity by the
// fraction of life left, so particles decelerate as they age, and fade with
// the same number.
export class Particle extends Entity {
  constructor() {
    super();
    this.pos.x = game.width / 2;
    this.pos.y = game.height / 2;
    this._color = 0xffffff;
    this._size = [1, 0];
    this._count = [100, 0];
    this._speed = [50, 0];
    this._angle = [0, 2 * Math.PI];
    this._delay = [0, 0];
    this._spread = [0, 0];
    this._duration = [1, 0.2];
    this._square = true;
    // begin() fills these in, one frame after the setters have run.
    this.parts = [];
  }

  color(c) {
    this._color = c;
    return this;
  }

  count(v, r = 0) {
    this._count = [v, r];
    return this;
  }

  size(v, r = 0) {
    this._size = [v, r];
    return this;
  }

  speed(v, r = 0) {
    this._speed = [v, r];
    return this;
  }

  direction(v, r = 0) {
    this._angle = [v, r];
    return this;
  }

  delay(v, r = 0) {
    this._delay = [v, r];
    return this;
  }

  duration(v, r = 0) {
    this._duration = [v, r];
    return this;
  }

  // How far out each particle starts along its own heading, so a ring is
  // hollow.
  spread(v, r = 0) {
    this._spread = [v, r];
    return this;
  }

  circle() {
    this._square = false;
    return this;
  }

  begin() {
    const val = ([m, d]) => (d === 0 ? m : m + d * Math.random());
    for (let i = 0, n = Math.round(val(this._count)); i < n; ++i) {
      const a = val(this._angle);
      const speed = val(this._speed);
      const spread = val(this._spread);
      this.parts.push({
        x: this.pos.x + Math.cos(a) * spread,
        y: this.pos.y + Math.sin(a) * spread,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        size: val(this._size),
        delay: val(this._delay),
        time: val(this._duration),
        alpha: 1,
        done: false,
      });
    }
  }

  update() {
    for (const p of this.parts) {
      if (this.ticks < p.delay) continue;
      const t = 1 - (this.ticks - p.delay) / p.time;
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
    ctx.fillStyle = css(this._color);
    for (const p of this.parts) {
      if (this.ticks < p.delay) continue;
      ctx.globalAlpha = p.alpha;
      if (this._square) {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}

/*
 * Callbacks on a clock, in one of two modes, and the timer removes itself once
 * it has no callbacks left.
 *
 * every(t).run(f) repeats f every t seconds, until f returns false.
 *
 * delay(t).run(f).run(g) is a queue: f fires t seconds in, g t seconds after
 * that, each one once, and what they return is not read.
 */
export class Timer extends Entity {
  constructor() {
    super();
    this._every = 0;
    this._delay = 0;
    this.fns = [];
  }

  every(v) {
    this._every = v;
    return this;
  }

  delay(v) {
    this._delay = v;
    return this;
  }

  run(f) {
    this.fns.push(f);
    return this;
  }

  update() {
    if (this._delay > 0) this._queue();
    else this._repeat();
    if (this.fns.length === 0) this.remove();
  }

  _queue() {
    if (this.ticks < this._delay) return;
    this.ticks = 0;
    this.fns.shift()();
  }

  _repeat() {
    if (this.ticks < this._every) return;
    this.ticks -= this._every;
    if (!this.fns[0]()) this.fns.shift();
  }
}
