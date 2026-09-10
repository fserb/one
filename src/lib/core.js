/*
 * core.js - the entity model itself: the groups, the frame, and Entity.
 *
 * An entity registers itself under its own class when constructed, and
 * update() walks the groups in draw order once a frame. entity.js is the
 * file a game imports; it re-exports the three.
 *
 * The games think in a 480x480 box. world() sets it and render() scales onto
 * one's 1024, so ported code keeps its constants.
 *
 * There is no screen space, and none is wanted: a game that moves the view
 * wraps ent.render() in its own transform and draws the furniture that holds
 * still outside it.
 *
 * Every entity owns an `art` and a `gfx`, the two drawing buffers: pixels and
 * paths. Both are always there, so a game imports neither file itself.
 *
 * The overlap tests are alma's `Collider`. hitCircle/hitBox/hitPoly build one
 * of its shapes in entity-local coordinates, and _world() moves them out at
 * test time.
 *
 * begin() cannot run from the constructor, since a subclass's field
 * initialisers run after super() returns and would overwrite it. It runs at
 * the top of the entity's first frame, before its first update(). So an entity
 * is drawn on the frame it was made with only what its constructor set, and
 * ugl code that drew from the constructor loses a frame moving into begin().
 * An entity built inside another's update() first steps on the next frame.
 */

import { Collider } from "../alma/src/collider.js";
import { Art } from "./art.js";
import { Gfx } from "./gfx.js";
import { key, mouse } from "./input.js";
import { SIZE } from "./one.js";

export const game = {
  time: 0,
  totalTime: 0,
  width: 480,
  height: 480,
  mouse: { x: 0, y: 0, click: false, press: false, release: false },
  // input.js's own object: unlike the pointer there is nothing to convert.
  key,
};

// Class -> {layer, list}, every live instance of exactly that class, in
// construction order.
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

// Only entities that have begun. One constructed earlier this frame has not
// run begin() yet, so its fields are undefined and it is not in play.
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
 * ugl's two screen-wide effects. shake() jitters the world under render();
 * delay() is hitstop, holding every entity while the clock runs on. Each takes
 * the longer of what is asked and what is already running.
 */
let shaking = 0;
let held = 0;

export function shake(t = 0.4) {
  shaking = Math.max(shaking, t);
}

export function delay(t) {
  held = Math.max(held, t);
}

// Every pair of two entities' world shapes, stopping at the first overlap.
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

  constructor() {
    this.pos = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 };
    this.acc = { x: 0, y: 0 };
    this.angle = 0;
    this.ticks = 0;
    this.dead = false;
    this.art = new Art();
    this.gfx = new Gfx();
    // Mirror the drawing, ugl's sprite.scaleX = -1.
    this.flipX = false;
    // ugl's sprite scale and alpha. Uniform: no port has wanted two axes.
    this.scale = 1;
    this.alpha = 1;
    this.hits = [];
    this.started = false;
    groupOf(this.constructor).list.push(this);
  }

  begin() {}
  update() {}
  postUpdate() {}

  // Each centres on its own bounding box; ugl centred the union. An entity
  // drawing with both sits differently unless they share a centre.
  render(ctx) {
    this.art.render(ctx);
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
  }

  // ugl's clearHitBox(): drops every shape, so nothing overlaps either way.
  clearHits() {
    this.hits.length = 0;
    return this;
  }

  // Overlap shapes, offset from the entity's position. A box stays
  // axis-aligned: `angle` turns the drawing, not the box, so only hitPoly()
  // is built with `turns` set.
  //
  // These centre on the position, `art` and `gfx` on their own bounding box, so
  // a drawing lopsided about the origin sits off its hit shape. `gfx.size(w, h)`
  // is the empty box that puts it back.
  hitCircle(r, x = 0, y = 0) {
    this.hits.push({ shape: Collider.circle(x, y, r), turns: false });
    return this;
  }

  // alma centres nothing: its rect is a corner and two extents, ugl's box a
  // centre and two widths.
  hitBox(w, h = w, x = 0, y = 0) {
    const shape = Collider.rect(x - w / 2, y - h / 2, w, h);
    this.hits.push({ shape, turns: false });
    return this;
  }

  // A convex polygon, a flat list of x, y pairs, and the one shape that turns
  // with `angle`: a ship drawn as a triangle collides as one.
  hitPoly(p) {
    const points = [];
    for (let i = 0; i < p.length; i += 2) points.push({ x: p[i], y: p[i + 1] });
    this.hits.push({ shape: Collider.polygon(points), turns: true });
    return this;
  }

  // The shapes in world coordinates, which is what Collider.hit() reads. One
  // array per call: hitGroup() takes its own once and reuses it down the group.
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

function ordered() {
  return [...groups.values()].sort((a, b) => a.layer - b.layer);
}

export function update(dt) {
  shaking = Math.max(0, shaking - dt);
  // A held frame still runs at dt 0: entities read input, nothing moves.
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
    // Entities built during this pass wait for the next frame. The snapshot
    // alone does not do it, since a new entity can land in a group this loop
    // has not reached yet; `started` is what holds it back.
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
    // World units, so a shake is the same size whatever the box is. The
    // background goes with it and meta.bg shows along the edge it leaves.
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
