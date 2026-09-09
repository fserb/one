/*
 * entity.js - the entity model the vault micro-games are written against.
 *
 * ~/prj/vault/games/sketch/src is 20 single-file games built on `ugl`, a
 * retained-mode framework: entities own sprites in a display list. This is the
 * same model over one.js's immediate mode. An entity registers itself when it
 * is constructed, the shell walks the groups in draw order once a frame, and
 * each entity paints itself into the 2D context.
 *
 * A game wires it into the three exports one.js calls:
 *
 * ```js
 * import * as ent from "./lib/entity.js";
 *
 * class Enemy extends ent.Entity {
 *   begin() { this.pos.x = 100; this.art.size(5).color(0xe11c57).circle(3, 3, 3); }
 *   update() { this.vel.y += 10 * ent.game.time; }
 * }
 *
 * export function init() { ent.reset(); new Enemy(); }
 * export function update(dt) { ent.update(dt); }
 * export function render(ctx) { ent.render(ctx); }
 * ```
 *
 * The games think in a 480x480 box. world() sets that box and render() scales
 * it onto one's 1024, so ported code keeps the constants it was written with.
 *
 * Overlap is opt-in: an entity that calls hitCircle(), hitBox() or hitPoly()
 * can then ask hitGroup(Other) what it is touching. ugl put those shapes in the
 * sprite's own coordinates and ran them through the sprite matrix; here they
 * are relative to the entity's position, so a port has to move the numbers over
 * by hand, and a polygon is the only one of the three that still turns.
 *
 * One thing does not carry over from Haxe: begin() cannot run from the
 * constructor, because a subclass's field initialisers run after super()
 * returns and would overwrite whatever begin() had set. So begin() runs at the
 * top of the entity's first frame instead, still before its first update().
 *
 * The part of that a port has to watch: an entity is drawn on the frame it was
 * made, so whatever its constructor set is on screen at once and whatever
 * begin() set is not there yet. ugl ran begin() from the constructor and a
 * Haxe game puts the drawing there freely, so moving that drawing into begin()
 * on the way over costs it a frame. An entity built inside another entity's
 * update() also does not step on the frame it was made: it begins and updates
 * on the next one.
 */

import { Art, Gfx, glyphs } from "./art.js";
import { key, mouse, SIZE } from "./state.js";

export const game = {
  // Seconds since the last frame, and since reset().
  time: 0,
  totalTime: 0,
  width: 480,
  height: 480,
  // The pointer, in world coordinates.
  mouse: { x: 0, y: 0, click: false, press: false, release: false },
  // The held directions and the two buttons. The shell's own object, since
  // unlike the pointer there is nothing to convert.
  key,
};

// Class -> {layer, list}. A group holds every live instance of exactly that
// class, in construction order.
const groups = new Map();

export function world(w = 480, h = w) {
  game.width = w;
  game.height = h;
}

function groupOf(cls) {
  let g = groups.get(cls);
  if (!g) {
    g = { layer: cls.layer ?? 10, list: [] };
    groups.set(cls, g);
  }
  return g;
}

// Draw order, bottom first. Classes left out keep their static layer.
export function order(classes) {
  classes.forEach((cls, i) => {
    groupOf(cls).layer = i;
  });
}

// Only entities that have begun. One constructed earlier in this same frame has
// not run begin() yet, so its fields are still undefined and it is not in play.
export function get(cls) {
  const g = groups.get(cls);
  if (!g) return [];
  return g.list.filter((e) => e.started && !e.dead);
}

export function one(cls) {
  const g = groups.get(cls);
  if (!g) return null;
  return g.list.find((e) => e.started && !e.dead) ?? null;
}

export function reset() {
  groups.clear();
  game.time = 0;
  game.totalTime = 0;
  shaking = held = 0;
}

/*
 * The two things ugl let a hit do to the whole screen. shake() jitters the
 * world under render(); delay() is hitstop, holding every entity still while
 * the clock runs on, so a blow lands before the game answers it. Each takes
 * the longer of what is asked for and what is already running.
 */
let shaking = 0;
let held = 0;

export function shake(t = 0.4) {
  shaking = Math.max(shaking, t);
}

export function delay(t) {
  held = Math.max(held, t);
}

export class Entity {
  static layer = 10;

  constructor() {
    this.pos = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 };
    this.acc = { x: 0, y: 0 };
    this.angle = 0;
    this.ticks = 0;
    this.dead = false;
    this.art = new Art();
    this.gfx = new Gfx();
    // Mirror the drawing left to right, which is how the games turn a sprite
    // around: ugl set sprite.scaleX = -1.
    this.flipX = false;
    // ugl's sprite.scaleX/scaleY and sprite.alpha, which is how a game pops a
    // sprite in or fades one out. Uniform, because no port has wanted the two
    // axes to differ.
    this.scale = 1;
    this.alpha = 1;
    this.hits = [];
    this.started = false;
    groupOf(this.constructor).list.push(this);
  }

  // Called once, at the top of this entity's first frame.
  begin() {}
  update() {}
  postUpdate() {}

  // Each of the two centres itself on its own bounding box. ugl centred the
  // union of them, so an entity drawing with both at once sits differently
  // here unless the two are centred on the same point.
  render(ctx) {
    this.art.render(ctx);
    this.gfx.render(ctx);
  }

  remove() {
    this.dead = true;
  }

  // Adds a per-second acceleration, consumed by the next step.
  accelerate(x, y) {
    this.acc.x += x;
    this.acc.y += y;
  }

  // Drops every shape, so nothing can touch this entity and it can touch
  // nothing. ugl's clearHitBox().
  clearHits() {
    this.hits.length = 0;
    return this;
  }

  // Overlap shapes, offset from the entity's position. A box is axis-aligned
  // and stays that way: `angle` turns the drawing, not the box. hitPoly() is
  // the one that turns.
  //
  // These centre on the position; `art` and `gfx` centre on their own bounding
  // box. So a drawing lopsided about the origin, a turret with a barrel out one
  // side, sits off its own hit shape, and `gfx.size(w, h)` is the empty box
  // that puts it back.
  hitCircle(r, x = 0, y = 0) {
    this.hits.push({ r, x, y });
    return this;
  }

  hitBox(w, h = w, x = 0, y = 0) {
    this.hits.push({ w, h, x, y });
    return this;
  }

  // A convex polygon, as a flat list of x, y pairs, and the one shape that
  // turns with `angle`. A box was defined axis-aligned and a circle has no
  // heading to lose; a polygon is what a game reaches for when the heading of
  // the shape is the point, so a ship drawn as a triangle collides as one.
  hitPoly(p) {
    this.hits.push({ p });
    return this;
  }

  hit(e) {
    if (e === null || e === this || this.dead || e.dead) return false;
    for (const a of this.hits) {
      for (const b of e.hits) {
        if (overlap(this, a, e, b)) return true;
      }
    }
    return false;
  }

  // The first live `cls` this touches, or null.
  hitGroup(cls) {
    for (const e of get(cls)) {
      if (this.hit(e)) return e;
    }
    return null;
  }

  _step() {
    this.ticks += game.time;
    this.update();
    if (this.dead) return;

    const ax = this.acc.x * game.time;
    const ay = this.acc.y * game.time;
    this.pos.x += game.time * (this.vel.x + ax / 2);
    this.pos.y += game.time * (this.vel.y + ay / 2);
    this.vel.x += ax;
    this.vel.y += ay;
    this.acc.x = this.acc.y = 0;
    this.postUpdate();
  }

  _draw(ctx) {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    if (this.angle !== 0) ctx.rotate(this.angle);
    if (this.scale !== 1) ctx.scale(this.scale, this.scale);
    if (this.flipX) ctx.scale(-1, 1);
    if (this.alpha !== 1) ctx.globalAlpha = this.alpha;
    this.render(ctx);
    ctx.restore();
  }
}

/*
 * A label. Lives until removed, or for duration() seconds if one is set, which
 * is how the games do floating "+10" score pops.
 */
export class Text extends Entity {
  static layer = 1000;

  constructor() {
    super();
    this._text = "";
    this._size = 1;
    this._color = 0xffffff;
    this._align = "center";
    this._valign = "middle";
    this._duration = null;
  }

  text(s) {
    this._text = String(s);
    return this;
  }

  xy(x, y) {
    this.pos.x = x;
    this.pos.y = y;
    return this;
  }

  move(x, y) {
    this.vel.x = x;
    this.vel.y = y;
    return this;
  }

  // "left"|"center"|"right" and "top"|"middle"|"bottom", in either order,
  // space separated: align("top left").
  align(a) {
    for (const word of a.toLowerCase().split(/[\s_]+/)) {
      if (word === "left" || word === "center" || word === "right") {
        this._align = word;
      } else if (word === "top" || word === "middle" || word === "bottom") {
        this._valign = word;
      }
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
    const w = g.width * s;
    const h = g.height * s;

    const x = this._align === "left" ? 0 : this._align === "right" ? -w : -w / 2;
    const y = this._valign === "top" ? 0 : this._valign === "bottom" ? -h : -h / 2;

    ctx.fillStyle = `#${(this._color & 0xffffff).toString(16).padStart(6, "0")}`;
    for (let i = 0; i < g.dots.length; i += 2) {
      ctx.fillRect(x + g.dots[i] * s, y + g.dots[i + 1] * s, s, s);
    }
  }
}

/*
 * A one-shot burst. Particles decelerate as they age, because the step scales
 * velocity by the fraction of life left, and fade with the same number.
 */
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
    this.parts = null;
  }

  xy(x, y) {
    this.pos.x = x;
    this.pos.y = y;
    return this;
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

  // Distance from the origin the burst starts at, along each particle's own
  // heading, so a ring comes out hollow.
  spread(v, r = 0) {
    this._spread = [v, r];
    return this;
  }

  circle() {
    this._square = false;
    return this;
  }

  update() {
    if (this.parts === null) this._create();

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

  _create() {
    const val = ([m, d]) => (d === 0 ? m : m + d * Math.random());
    this.parts = [];
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
    this.ticks = 0;
  }

  // Particles carry their own world positions, so undo the entity translate.
  render(ctx) {
    ctx.translate(-this.pos.x, -this.pos.y);
    ctx.fillStyle = `#${(this._color & 0xffffff).toString(16).padStart(6, "0")}`;
    for (const p of this.parts ?? []) {
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
 * Runs callbacks on a clock. A callback returning false is dropped, and the
 * timer removes itself once it has none left.
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
    if (this._delay > 0) {
      if (this.ticks >= this._delay) {
        this.ticks = 0;
        this.fns.shift()();
      }
    } else if (this.ticks >= this._every) {
      this.ticks -= this._every;
      if (!this.fns[0]()) this.fns.shift();
    }
    if (this.fns.length === 0) this.remove();
  }
}

function overlap(ea, a, eb, b) {
  if (a.p !== undefined || b.p !== undefined) return polyOverlap(ea, a, eb, b);

  const ax = ea.pos.x + a.x;
  const ay = ea.pos.y + a.y;
  const bx = eb.pos.x + b.x;
  const by = eb.pos.y + b.y;

  if (a.r !== undefined && b.r !== undefined) {
    return Math.hypot(bx - ax, by - ay) <= a.r + b.r;
  }
  if (a.r !== undefined) return circleBox(ax, ay, a.r, bx, by, b.w, b.h);
  if (b.r !== undefined) return circleBox(bx, by, b.r, ax, ay, a.w, a.h);
  return Math.abs(ax - bx) <= (a.w + b.w) / 2 &&
    Math.abs(ay - by) <= (a.h + b.h) / 2;
}

// The circle reaches the box when the box's nearest point is inside it.
function circleBox(cx, cy, r, bx, by, w, h) {
  const dx = Math.max(Math.abs(cx - bx) - w / 2, 0);
  const dy = Math.max(Math.abs(cy - by) - h / 2, 0);
  return dx * dx + dy * dy <= r * r;
}

// A polygon against anything. The box fast path above cannot answer it, so a
// box comes in here as its four corners instead.
function polyOverlap(ea, a, eb, b) {
  if (a.r !== undefined) {
    return circlePoly(ea.pos.x + a.x, ea.pos.y + a.y, a.r, corners(eb, b));
  }
  if (b.r !== undefined) {
    return circlePoly(eb.pos.x + b.x, eb.pos.y + b.y, b.r, corners(ea, a));
  }
  return sat(corners(ea, a), corners(eb, b));
}

// Shape `s` in world coordinates: a polygon turned onto the entity's heading,
// a box as the four points it would have if it were one.
function corners(e, s) {
  if (s.p === undefined) {
    const x = e.pos.x + s.x;
    const y = e.pos.y + s.y;
    const w = s.w / 2;
    const h = s.h / 2;
    return [x - w, y - h, x + w, y - h, x + w, y + h, x - w, y + h];
  }

  const cos = Math.cos(e.angle);
  const sin = Math.sin(e.angle);
  const out = [];
  for (let i = 0; i < s.p.length; i += 2) {
    const x = s.p[i];
    const y = s.p[i + 1];
    out.push(e.pos.x + x * cos - y * sin, e.pos.y + x * sin + y * cos);
  }
  return out;
}

// The separating axis theorem: two convex polygons miss exactly when one of
// their own edge normals has a gap between the two shadows cast on it.
function sat(a, b) {
  for (const p of [a, b]) {
    for (let i = 0; i < p.length; i += 2) {
      const j = (i + 2) % p.length;
      // The normal does not have to be a unit vector: only the order of the
      // shadows along it is read.
      const nx = p[j + 1] - p[i + 1];
      const ny = p[i] - p[j];
      if (apart(a, b, nx, ny)) return false;
    }
  }
  return true;
}

function apart(a, b, nx, ny) {
  let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
  for (let i = 0; i < a.length; i += 2) {
    const d = a[i] * nx + a[i + 1] * ny;
    if (d < amin) amin = d;
    if (d > amax) amax = d;
  }
  for (let i = 0; i < b.length; i += 2) {
    const d = b[i] * nx + b[i + 1] * ny;
    if (d < bmin) bmin = d;
    if (d > bmax) bmax = d;
  }
  return amax < bmin || bmax < amin;
}

// Inside the polygon, or within r of one of its edges. The crossings all come
// out the same sign only for a point inside, whichever way the points wind.
function circlePoly(cx, cy, r, p) {
  let sides = 0;
  let near = Infinity;
  for (let i = 0; i < p.length; i += 2) {
    const j = (i + 2) % p.length;
    const ex = p[j] - p[i];
    const ey = p[j + 1] - p[i + 1];
    const dx = cx - p[i];
    const dy = cy - p[i + 1];
    sides |= ex * dy - ey * dx < 0 ? 1 : 2;
    const t = Math.max(0, Math.min(1, (dx * ex + dy * ey) / (ex * ex + ey * ey)));
    near = Math.min(near, Math.hypot(dx - ex * t, dy - ey * t));
  }
  return sides !== 3 || near <= r;
}

function ordered() {
  return [...groups.values()].sort((a, b) => a.layer - b.layer);
}

export function update(dt) {
  shaking = Math.max(0, shaking - dt);
  // A held frame still runs, at a dt of zero: entities read input and each
  // other, and nothing moves.
  if (held > 0) {
    held -= dt;
    dt = 0;
  }

  game.time = dt;
  game.totalTime += dt;

  game.mouse.x = mouse.x * game.width / SIZE;
  game.mouse.y = mouse.y * game.height / SIZE;
  game.mouse.click = mouse.click;
  game.mouse.press = mouse.press;
  game.mouse.release = mouse.release;

  // Everything begins before anything steps, so an entity never reads another
  // that is still uninitialised, whatever order their groups draw in.
  for (const g of groups.values()) {
    for (const e of g.list) {
      if (e.started || e.dead) continue;
      e.started = true;
      e.begin();
    }
  }

  for (const g of ordered()) {
    // Entities constructed during this pass wait for the next frame, so every
    // entity sees the same dt and none steps before its begin(). The snapshot
    // alone does not do it: a new entity lands in a group this loop may not
    // have reached, and that group's snapshot is taken after it arrives, so
    // `started` is what holds it back.
    for (const e of [...g.list]) {
      if (!e.dead && e.started) e._step();
    }
  }

  for (const g of groups.values()) {
    if (g.list.some((e) => e.dead)) g.list = g.list.filter((e) => !e.dead);
  }
}

export function render(ctx) {
  ctx.save();
  ctx.scale(SIZE / game.width, SIZE / game.height);
  if (shaking > 0) {
    // In world units, so a shake is the same size whatever the box is. The
    // background goes with it, and meta.bg shows along the edge it leaves.
    const mag = 5 + 10 * shaking;
    ctx.translate(mag * (2 * Math.random() - 1), mag * (2 * Math.random() - 1));
  }
  for (const g of ordered()) {
    for (const e of g.list) {
      if (!e.dead) e._draw(ctx);
    }
  }
  ctx.restore();
}
