/*
 * core.js - the entity model itself: the groups, the frame, and Entity. A game
 * imports entity.js, which re-exports this and props.js.
 *
 * With a camera the 1024 board is its opening framing, game.input's pointer is
 * read back through it, and apply() is what puts a shake on the world.
 *
 * begin() cannot run from the constructor, since a subclass's field
 * initialisers run after super() returns and would overwrite it. It runs at the
 * top of the entity's first frame, so an entity is drawn on the frame it was
 * made with only what its constructor set.
 */

import { Collider } from "../alma/src/collider.js";
import * as effects from "./effects.js";
import { Gfx } from "./gfx.js";
import { input } from "./input.js";
import { op } from "./one.js";

export const game = {
  time: 0,
  totalTime: 0,
  // The pointer on the board, which with a camera comes back through it. The
  // three button sets are input.js's own objects.
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

export function reset(classes = []) {
  groups.clear();
  game.time = 0;
  game.totalTime = 0;
  effects.reset();
  // The bounds belong to a round, and a round starts here. settle() is what
  // ends a shake still running, so one cannot outlive the board it was shaking.
  if (op.camera) {
    op.camera.bounds = null;
    op.camera.moveTo({ x: 512, y: 512, scale: 1, angle: 0 }).settle();
  }
  order(classes);
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

  accelerate(x, y) {
    this.acc.x += x;
    this.acc.y += y;
    return this;
  }

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
  // A held frame still runs at dt 0: entities read input, nothing moves.
  if (effects.frozen) dt = 0;

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
  // apply() carries the shake, which is why it moves the world and not the
  // screen-space entities below or the panels over them.
  if (op.camera) op.camera.apply(ctx);
  draw(ctx, layers, false);
  ctx.restore();

  // Two passes and not one layer above the rest, since what separates them is
  // the transform. `layer` still orders the screen classes among themselves.
  draw(ctx, layers, true);
}
