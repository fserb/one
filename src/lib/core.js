/*
 * core.js - the entity model itself: the groups, the frame, and Entity.
 *
 * An entity registers itself under its own class when constructed, and
 * update() walks the groups in draw order once a frame. entity.js is the
 * file a game imports; it re-exports the three.
 *
 * The games think in a 480x480 box. reset() sets it and render() puts it on
 * one's 1024, so a game writes its constants once. A game that imports
 * lib/camera.js gets that box as the camera's opening framing and moves the
 * camera instead of writing its own transform, and game.mouse comes back
 * through it, so nothing has to subtract the view by hand.
 *
 * A class with `static screen = true` draws after the world with the camera and
 * the shake off, in the game's box either way. Only the drawing changes.
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
 * is drawn on the frame it was made with only what its constructor set, and an
 * entity built inside another's update() first steps on the next frame.
 */

import { Collider } from "../alma/src/collider.js";
import { Art } from "./art.js";
import { Gfx } from "./gfx.js";
import { key, mouse } from "./input.js";
import { op, SIZE } from "./one.js";

export const game = {
  time: 0,
  totalTime: 0,
  // The side of the square box the game thinks in. Square because the canvas
  // is, and because a camera has one scale.
  size: 480,
  mouse: { x: 0, y: 0, click: false, press: false, release: false },
  // input.js's own object: unlike the pointer there is nothing to convert.
  key,
};

// Class -> {layer, screen, list}, every live instance of exactly that class, in
// construction order.
const groups = new Map();

/*
 * The box the game thinks in, and with a camera the framing it opens on. The
 * bounds go with it: they belong to a round, and a round starts here.
 *
 * reset() calls this with 480, which is the box every game uses; a game that
 * wants another one calls it again after.
 */
export function world(size) {
  game.size = size;
  if (!op.camera) return;
  op.camera.bounds = null;
  const half = size / 2;
  op.camera.moveTo({ x: half, y: half, scale: SIZE / size, angle: 0 }).settle();
  op.camera.shakeBase = SHAKE_BASE * SIZE / size;
  op.camera.shakeHz = SHAKE_HZ;
}

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

/*
 * A round starts here: the entities from the last one, the clock, the shake
 * and the box. It takes the draw order because every game sets one in the same
 * breath, and world(480) because that is the box all of them use. Both are
 * still exported for a game that wants to change one mid-round.
 */
export function reset(classes = []) {
  groups.clear();
  game.time = 0;
  game.totalTime = 0;
  shaking = held = 0;
  shakeHold = shakeX = shakeY = 0;
  // world() ends in settle(), which is where the camera keeps its own copy of
  // the shake it was running on a world that is now gone.
  world(480);
  order(classes);
}

/*
 * The two screen-wide effects. shake() jitters the world under render();
 * delay() is hitstop, holding every entity while the clock runs on. Each takes
 * the longer of what is asked and what is already running.
 *
 * The rattle is BASE + FALL times the seconds it has left, a fresh offset HZ
 * times a second and held in between. Held, or it runs twice as fast at 120Hz
 * as at 60. Camera2D rattles on those same three numbers, so with a camera
 * shake() hands them over rather than jittering the world under a frame that
 * is already jittering: one call and one rattle either way. world() is what
 * gives the camera BASE and HZ, since turning these world units into the
 * screen ones it counts in needs the box.
 */
const SHAKE_BASE = 5;
const SHAKE_FALL = 10;
const SHAKE_HZ = 30;

let shaking = 0;
let shakeHold = 0;
let shakeX = 0;
let shakeY = 0;
let held = 0;

export function shake(t = 0.4) {
  if (op.camera) {
    op.camera.shake(t, SHAKE_FALL * SIZE / game.size);
    return;
  }
  shaking = Math.max(shaking, t);
}

export function delay(t) {
  held = Math.max(held, t);
}

// Camera2D's own step, on this file's clock. Math.random and not a seeded
// stream: how often the screen is painted must not move a game along.
function stepShake(dt) {
  shaking = Math.max(0, shaking - dt);
  if (shaking <= 0) {
    shakeHold = shakeX = shakeY = 0;
    return;
  }
  shakeHold -= dt;
  if (shakeHold > 0) return;
  shakeHold = 1 / SHAKE_HZ;
  // Square, not circle: a constant radius makes successive throws orbit the
  // centre and the eye tracks it.
  const amp = SHAKE_BASE + SHAKE_FALL * shaking;
  shakeX = amp * (2 * Math.random() - 1);
  shakeY = amp * (2 * Math.random() - 1);
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
  // Over the world, in the game's box, with camera and shake off.
  static screen = false;

  constructor() {
    this.pos = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 };
    this.acc = { x: 0, y: 0 };
    this.angle = 0;
    // Seconds since it began.
    this.age = 0;
    this.dead = false;
    this.art = new Art();
    this.gfx = new Gfx();
    // Mirror the drawing.
    this.flipX = false;
    // Uniform scale: no game has wanted two axes.
    this.scale = 1;
    this.alpha = 1;
    this.hits = [];
    this.started = false;
    groupOf(this.constructor).list.push(this);
  }

  begin() {}
  update() {}
  postUpdate() {}

  // Each centres on its own bounding box, not the union of the two. An entity
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
    return this;
  }

  // Drops every shape, so nothing overlaps either way.
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

  // alma centres nothing: its rect is a corner and two extents, this box a
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

  // Where the pointer points in the world, which under a camera is not where
  // it sits on the board.
  const m = op.camera
    ? op.camera.toWorld(mouse.x, mouse.y)
    : { x: mouse.x * game.size / SIZE, y: mouse.y * game.size / SIZE };
  game.mouse.x = m.x;
  game.mouse.y = m.y;
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
  else ctx.scale(SIZE / game.size, SIZE / game.size);
  // World units, so a shake is the same size whatever the box is. The
  // background goes with it and meta.bg shows along the edge it leaves. With a
  // camera there is nothing to add: apply() above carried its own.
  if (shaking > 0) ctx.translate(shakeX, shakeY);
  draw(ctx, layers, false);
  ctx.restore();

  // Two passes and not one layer past the rest, since what separates them is
  // the transform. `layer` still orders the screen classes among themselves.
  ctx.save();
  ctx.scale(SIZE / game.size, SIZE / game.size);
  draw(ctx, layers, true);
  ctx.restore();
}
