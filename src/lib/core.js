/*
 * core.js - the entity model itself: the groups, the frame, and Entity. A game
 * imports entity.js, which re-exports this and props.js.
 *
 * The games are written in one's 1024 board, and render() draws in it directly.
 * With lib/camera.js that board is the camera's opening framing and
 * game.input's pointer is read back through it.
 *
 * begin() cannot run from the constructor, since a subclass's field
 * initialisers run after super() returns and would overwrite it. It runs at the
 * top of the entity's first frame, so an entity is drawn on the frame it was
 * made with only what its constructor set, and one built inside another's
 * update() takes its first step on the next frame.
 */

import { Collider } from "../alma/src/collider.js";
import { Gfx } from "./gfx.js";
import { input } from "./input.js";
import { op, SIZE } from "./one.js";

export const game = {
  time: 0,
  totalTime: 0,
  // The pointer on the board, which with a camera comes back through it. The
  // three button sets are input.js's own objects: unlike the pointer there is
  // nothing to convert.
  input: {
    x: 0,
    y: 0,
    press: input.press,
    just: input.just,
    release: input.release,
  },
};

// Class -> {layer, screen, list}, in construction order.
const groups = new Map();

function groupOf(cls) {
  let g = groups.get(cls);
  if (!g) {
    g = { layer: cls.layer ?? 10, screen: cls.screen ?? false, list: [] };
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

// Only entities that have begun: one constructed earlier this frame has not run
// begin() yet, so its fields are undefined and it is not yet part of the round.
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

// A round starts here: it removes the last one's entities, resets the time and
// the shake, frames the camera on the board and takes the draw order.
export function reset(classes = []) {
  groups.clear();
  game.time = 0;
  game.totalTime = 0;
  shaking = held = 0;
  shakeHold = shakeX = shakeY = 0;
  // The bounds go with them: they belong to a round, and a round starts here.
  // settle() is where the camera clears its own copy of the shake it was
  // running for a round that is now over.
  if (op.camera) {
    const half = SIZE / 2;
    op.camera.bounds = null;
    op.camera.moveTo({ x: half, y: half, scale: 1, angle: 0 }).settle();
    op.camera.shakeBase = SHAKE_BASE;
    op.camera.shakeHz = SHAKE_HZ;
  }
  order(classes);
}

/*
 * shake() offsets the world under render(); delay() is hitstop, holding every
 * entity still while real time runs on. Each takes the longer of what is asked
 * and what is already running.
 *
 * The offset is BASE + FALL times the seconds it has left, a fresh one HZ times
 * a second and reused in between. Reused, or it moves twice as fast at 120Hz as
 * at 60. Camera2D shakes on those same three numbers, so with a camera shake()
 * passes them over rather than offsetting a frame that is already offset.
 */
const SHAKE_BASE = 10;
const SHAKE_FALL = 20;
const SHAKE_HZ = 30;

let shaking = 0;
let shakeHold = 0;
let shakeX = 0;
let shakeY = 0;
let held = 0;

export function shake(t = 0.4) {
  if (op.camera) {
    op.camera.shake(t, SHAKE_FALL);
    return;
  }
  shaking = Math.max(shaking, t);
}

export function delay(t) {
  held = Math.max(held, t);
}

// Math.random and not a seeded stream: how often the screen is drawn must not
// advance the game's own sequence.
function stepShake(dt) {
  shaking = Math.max(0, shaking - dt);
  if (shaking <= 0) {
    shakeHold = shakeX = shakeY = 0;
    return;
  }
  shakeHold -= dt;
  if (shakeHold > 0) return;
  shakeHold = 1 / SHAKE_HZ;
  // Square, not circle: a constant radius puts every offset on one circle, and
  // that looks like rotation rather than shaking.
  const amp = SHAKE_BASE + SHAKE_FALL * shaking;
  shakeX = amp * (2 * Math.random() - 1);
  shakeY = amp * (2 * Math.random() - 1);
}

function anyHit(as, bs) {
  for (const a of as) {
    for (const b of bs) {
      if (Collider.hit(a, b)) return true;
    }
  }
  return false;
}

export class Entity {
  static layer = 10;
  static screen = false; // draws after the world, with camera and shake off

  constructor() {
    this.pos = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 };
    this.acc = { x: 0, y: 0 };
    this.angle = 0;
    this.age = 0; // seconds since it began
    this.dead = false;
    this.gfx = new Gfx();
    this.flipX = false;
    this.scale = 1; // uniform: no game has needed two axes
    this.alpha = 1;
    this.hits = [];
    this.started = false;
    groupOf(this.constructor).list.push(this);
  }

  begin() {}
  update() {}
  postUpdate() {}

  render(ctx) {
    this.gfx.render(ctx);
  }

  remove() {
    this.dead = true;
  }

  xy(x, y) {
    this.pos.x = x;
    this.pos.y = y;
    return this;
  }

  accelerate(x, y) {
    this.acc.x += x;
    this.acc.y += y;
    return this;
  }

  // Removes every shape, so nothing overlaps either way.
  clearHits() {
    this.hits.length = 0;
    return this;
  }

  // These centre on the position and `gfx` on its own bounding box, so a
  // drawing that is not centred on the origin is offset from its hit shape;
  // `gfx.size(w, h)` is the empty box that aligns them.
  hitCircle(r, x = 0, y = 0) {
    this.hits.push({ shape: Collider.circle(x, y, r), turns: false });
    return this;
  }

  // alma centres nothing: its rect is a corner and two extents, this box a
  // centre and two widths.
  hitBox(w, h = w, x = 0, y = 0) {
    const shape = Collider.rect(x - w / 2, y - h / 2, w, h);
    this.hits.push({ shape, turns: false });
    return this;
  }

  // A flat list of x, y pairs, and the one shape that turns with `angle`.
  hitPoly(p) {
    const points = [];
    for (let i = 0; i < p.length; i += 2) points.push({ x: p[i], y: p[i + 1] });
    this.hits.push({ shape: Collider.polygon(points), turns: true });
    return this;
  }

  // One array per call: hitGroup() takes its own once and reuses it.
  _world() {
    return this.hits.map(({ shape, turns }) =>
      Collider.transform(shape, this.pos.x, this.pos.y, turns ? this.angle : 0)
    );
  }

  hit(e) {
    if (e === null || e === this || this.dead || e.dead) return false;
    if (this.hits.length === 0 || e.hits.length === 0) return false;
    return anyHit(this._world(), e._world());
  }

  hitGroup(cls) {
    if (this.dead || this.hits.length === 0) return null;
    const mine = this._world();
    for (const e of get(cls)) {
      if (e === this || e.dead || e.hits.length === 0) continue;
      if (anyHit(mine, e._world())) return e;
    }
    return null;
  }

  _step() {
    this.age += game.time;
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

function ordered() {
  return [...groups.values()].sort((a, b) => a.layer - b.layer);
}

export function update(dt) {
  stepShake(dt);
  // A held frame still runs at dt 0: entities read input, nothing moves.
  if (held > 0) {
    held -= dt;
    dt = 0;
  }

  game.time = dt;
  game.totalTime += dt;

  const m = op.camera ? op.camera.toWorld(input.x, input.y) : input;
  game.input.x = m.x;
  game.input.y = m.y;

  // Everything begins before anything steps, so no entity reads another that
  // is still uninitialised, whatever order the groups draw in.
  for (const g of groups.values()) {
    for (const e of g.list) {
      if (e.started || e.dead) continue;
      e.started = true;
      e.begin();
    }
  }

  for (const g of ordered()) {
    // Copying the list does not by itself exclude entities built during this
    // pass, since a new one can be added to a group this loop has not reached.
    for (const e of [...g.list]) {
      if (!e.dead && e.started) e._step();
    }
  }

  for (const g of groups.values()) {
    if (g.list.some((e) => e.dead)) g.list = g.list.filter((e) => !e.dead);
  }
}

function draw(ctx, layers, screen) {
  for (const g of layers) {
    if (g.screen !== screen) continue;
    for (const e of g.list) {
      if (!e.dead) e._draw(ctx);
    }
  }
}

export function render(ctx) {
  const layers = ordered();
  ctx.save();
  if (op.camera) op.camera.apply(ctx);
  // With a camera there is nothing to add: apply() above already included its
  // own.
  if (shaking > 0) ctx.translate(shakeX, shakeY);
  draw(ctx, layers, false);
  ctx.restore();

  // Two passes and not one layer above the rest, since what separates them is
  // the transform. `layer` still orders the screen classes among themselves.
  draw(ctx, layers, true);
}
