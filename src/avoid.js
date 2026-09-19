/*
 * avoid. Based on Aba Games' Satellite Catch.
 *
 * Every blob is a soft body in alma's solver, in free space: no field, no
 * gravity, and each body damps its own mean velocity, which is what avoid's
 * 0.95 a frame became. `size` is a getter over the body's scale, so the chase
 * and the graze are still written in sizes and distances; setScale() relaxes
 * the ring into the new size over the next substeps rather than moving a
 * point, and that lag is the squash.
 *
 * The solver owns the positions, so `pos` is copied off the centroid at the
 * top of update() and `vel` stays at zero, leaving Entity's integration a
 * no-op.
 */

import { SoftBodies } from "./alma/src/softbody.js";
import * as ent from "./lib/entity.js";
import { fixed, gameOver, op } from "./lib/one.js";

export const meta = {
  title: "avoid",
  desc: `
graze the red to score
touching it costs you size
`,
  bg: "#464248",
  fg: "#E1B81F",
  scoreMax: true,
  date: "2014-03-30",
  draft: true,
};

// One ring point's radius at scale 1: how far outside the ring the edge
// reaches. A body's own pr is this times its scale, so the silhouette keeps
// its proportions as the player grows.
const R = 7;

// The player grows without bound and pr grows with it. Past this the point
// radius would outrun the broadphase cell and contacts would be missed.
const MAX_SIZE = 300;
const MIN_SIZE = 2;

const GOLD = 0xe1b81f;
const RED = 0xe11c57;

// blob's tier ramps at avoid's two colours, run once through alma's color.js
// and written out: two palettes do not pay for the module.
const GOLD_SKIN = {
  ramp: ["#a7a68b", "#6f6639", "#e1b81f"],
  line: "#2c2300",
};
const RED_SKIN = {
  ramp: ["#b3628d", "#730f41", "#e11c57"],
  line: "#110004",
};

const sim = new SoftBodies({
  width: 1024,
  height: 1024,
  radius: R * MAX_SIZE / 53, // the largest pr the player can reach
  field: null, // free space: no pool, no walls
  gravity: { x: 0, y: 0 },
  maxSpeed: 4000,
  drag: 0, // each body damps its own mean instead
  rigidDamp: 6, // blob's 25 is a stiffer jelly than this game wants
  maxPush: R * 0.6, // off R, not off sim.radius, which the player sets
  recoveryMargin: R * 2 / 3,
});

// One unit ring a point count, since sizes repeat across a round.
const rings = new Map();

function ringOf(n) {
  let base = rings.get(n);
  if (base === undefined) rings.set(n, base = SoftBodies.ring(n));
  return base;
}

const LIGHT_X = -180;
const LIGHT_Y = -180;

// Eight fills at 0.0724 compound to 1 - (1 - a)^8 = 0.45 at the core.
const SHADOW_STEPS = 8;

// The body is built here and not in begin(), since core.js draws an entity
// from the frame it is constructed and begin() waits for the next fixed step.
class Blob extends ent.Entity {
  constructor(size, x, y) {
    super();
    this.base = size;
    const radius = size - R;
    const n = Math.max(12, Math.round(2 * Math.PI * radius / (2 * R * 2 / 3)));
    this.body = sim.add({
      base: ringOf(n),
      radius,
      mass: Math.PI * size * size / 500,
      x,
      y,
      pointRadius: R,
    });
    this.body.ent = this;
    this.pos.x = x;
    this.pos.y = y;
  }

  get size() {
    return this.base * this.body.scale;
  }

  set size(v) {
    const s = Math.max(MIN_SIZE, Math.min(MAX_SIZE, v));
    sim.setScale(this.body, s / this.base);
  }

  get speed() {
    return Math.hypot(this.body.mvx, this.body.mvy);
  }

  // The centroid is where the game reads its distances from.
  sync() {
    this.pos.x = this.body.cx;
    this.pos.y = this.body.cy;
  }

  // The rigid part of the motion only, so the wobble the ring carries rides
  // through it.
  damp(k) {
    const b = this.body;
    sim.pushBody(b, -b.mvx * k, -b.mvy * k);
  }

  remove() {
    sim.remove(this.body);
    super.remove();
  }

  render(ctx) {
    // _draw translated to pos, and the body draws in board units.
    ctx.translate(-this.pos.x, -this.pos.y);
    paint(ctx, this.body, this.skin, this.size);
  }
}

class Enemy extends Blob {
  constructor() {
    super(15 + Math.random() * 32, 1024 * Math.random(), 1024 * Math.random());
    this.tv = 0;
    this.tads = 0;
  }

  get skin() {
    return RED_SKIN;
  }

  update() {
    this.sync();
    this.tv += ent.game.time;

    const player = ent.one(Player);
    if (player === null) return;

    // Towards the player, harder the longer the round has run and the bigger
    // either of them is.
    const dx = player.pos.x - this.pos.x;
    const dy = player.pos.y - this.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > 0) {
      const k = Math.sqrt(ent.game.totalTime * 0.00002) * this.size *
        Math.min(1, this.tv) * player.size * 3.3 / d;
      sim.pushBody(this.body, dx * k, dy * k);
    }
    this.damp(0.05);

    // Points accrue while close without touching, so a near miss scores.
    const gap = d - this.size - player.size;
    const ads = Math.trunc((this.size + player.size) * 2 / (gap + 0.2));
    if (ads > 0) this.tads += ads;
    else this.cash();

    // The pass is what the rings show: both dent where they face each other,
    // and neither body moves for it.
    if (gap > 0 && gap < this.size + player.size) {
      const k = 900 * this.size / (gap + this.size);
      dent(this.body, player.pos.x, player.pos.y, k);
      dent(player.body, this.pos.x, this.pos.y, k);
    }

    const s = 200;
    if (
      this.pos.x < -s || this.pos.y < -s ||
      this.pos.x > 1024 + s || this.pos.y > 1024 + s
    ) {
      this.cash();
      this.remove();
      return;
    }

    if (d < this.size + player.size) {
      this.cash();
      player.chit(this.size);
      this.remove();
      burst(RED, this.pos, this.speed / 10);
      return;
    }

    // The bigger of two touching enemies absorbs the smaller and its points.
    for (const e of ent.get(Enemy)) {
      if (e === this || e.dead) continue;
      if (
        Math.hypot(this.pos.x - e.pos.x, this.pos.y - e.pos.y) > this.size + e.size
      ) continue;

      if (this.size > e.size) {
        burst(RED, e.pos, e.speed / 3);
        this.size -= e.size;
        this.tads += e.tads;
        e.remove();
      } else {
        burst(RED, this.pos, this.speed / 3);
        e.size -= this.size;
        e.tads += this.tads;
        this.remove();
        return;
      }
    }
  }

  cash() {
    if (this.tads <= 0) return;
    ent.addScore(this.tads, this.pos.x, this.pos.y);
    this.tads = 0;
  }
}

// Tight enough that the blob is under the pointer at a graze distance, loose
// enough that a turn is an acceleration the ring can show.
const FOLLOW = 26;

class Player extends Blob {
  constructor() {
    super(53, 512, 512);
  }

  get skin() {
    return GOLD_SKIN;
  }

  update() {
    this.sync();
    const b = this.body;
    sim.pushBody(
      b,
      (ent.game.input.x - b.cx) * FOLLOW - b.mvx,
      (ent.game.input.y - b.cy) * FOLLOW - b.mvy,
    );
    this.size += 2 * ent.game.time;
  }

  chit(s) {
    const left = this.size - s;
    if (left > MIN_SIZE) {
      this.size = left;
      return;
    }
    new ent.Particle({
      x: this.pos.x,
      y: this.pos.y,
      color: GOLD,
      count: 150,
      size: [11, 19],
      speed: [this.speed / 10, 105],
      duration: 5,
    });
    this.remove();
    gameOver({ score: true });
  }
}

// The facing arc pulls toward the other blob and the mean is taken back out,
// so the ring dents and the body stays on the course it was on.
function dent(b, ox, oy, k) {
  const { px, py, vx, vy } = sim;
  const s = b.start;
  const n = b.count;
  let mx = 0;
  let my = 0;
  for (let i = s; i < s + n; i++) {
    const dx = ox - px[i];
    const dy = oy - py[i];
    const d = Math.hypot(dx, dy) || 1;
    const w = k / (d * d); // falls off fast, so only the near arc moves
    const ax = dx * w / d;
    const ay = dy * w / d;
    vx[i] += ax;
    vy[i] += ay;
    mx += ax;
    my += ay;
  }
  mx /= n;
  my /= n;
  for (let i = s; i < s + n; i++) {
    vx[i] -= mx;
    vy[i] -= my;
  }
}

// The body path scaled about the centroid, offset onto the lit face.
function spec(ctx, b, path, L, along, across, sl, sa, alpha) {
  const { cx, cy } = b;
  ctx.save();
  ctx.translate(cx + L.x * along - L.y * across, cy + L.y * along + L.x * across);
  ctx.rotate(L.a);
  ctx.scale(sl, sa);
  ctx.rotate(-L.a);
  ctx.translate(-cx, -cy);
  ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.fill(path);
  ctx.restore();
}

function paint(ctx, b, skin, outer) {
  const path = sim.outline(b);

  const ldx = LIGHT_X - b.cx;
  const ldy = LIGHT_Y - b.cy;
  const llen = Math.hypot(ldx, ldy) || 1;
  const L = { x: ldx / llen, y: ldy / llen, a: Math.atan2(ldy, ldx) };

  // Extent along the light axis and across it.
  const { px, py } = sim;
  let lo = Infinity;
  let hi = -Infinity;
  let across = 0;
  for (let i = b.start; i < b.start + b.count; i++) {
    const dx = px[i] - b.cx;
    const dy = py[i] - b.cy;
    const d = dx * L.x + dy * L.y;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
    const a = Math.abs(dy * L.x - dx * L.y);
    if (a > across) across = a;
  }
  const rad = b.pointRadius * b.scale;
  const span = hi - lo + 2 * rad;
  const reach = hi + rad;
  across += rad;

  const edge = Math.min(Math.max(outer * 0.055, 3.5), 10.5);
  const drop = Math.min(28, outer * 0.22);
  const blur = Math.min(36, outer * 0.34);

  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // `blur` is what shadowBlur was given, in device pixels.
  const spread = blur / op.screen.scale;
  const dropX = b.cx - L.x * drop;
  const dropY = b.cy - L.y * drop;
  ctx.fillStyle = "rgba(0, 0, 0, 0.0724)";
  for (let i = SHADOW_STEPS - 1; i >= 0; i--) {
    const grow = 1.04 + spread * i / (SHADOW_STEPS - 1) / outer;
    ctx.save();
    ctx.translate(dropX, dropY);
    ctx.scale(grow, grow);
    ctx.translate(-b.cx, -b.cy);
    ctx.fill(path);
    ctx.restore();
  }

  ctx.strokeStyle = skin.line;
  ctx.lineWidth = edge;
  ctx.stroke(path);

  ctx.save();
  ctx.clip(path);

  // Darkest first, scaled toward the lamp, so the sides narrow with distance.
  const far = llen - lo + rad; // lamp to the blob's far edge, along the axis
  const steps = [0, Math.max(3.5, 0.020 * span), 0.28 * span];
  for (let i = 0; i < steps.length; i++) {
    const k = Math.max(0, 1 - steps[i] / far);
    ctx.save();
    ctx.translate(LIGHT_X, LIGHT_Y);
    ctx.scale(k, k);
    ctx.translate(-LIGHT_X, -LIGHT_Y);
    ctx.fillStyle = skin.ramp[i];
    ctx.fill(path);
    ctx.restore();
  }

  spec(ctx, b, path, L, reach * 0.62, across * 0.20, 0.23, 0.32, 0.78);
  spec(ctx, b, path, L, reach * 0.78, across * -0.28, 0.095, 0.13, 0.52);
  ctx.restore();
}

function burst(color, pos, speed) {
  new ent.Particle({
    x: pos.x,
    y: pos.y,
    color,
    count: [100, 20],
    size: [15, 11],
    speed: [speed, 210],
    duration: 0.5,
  });
}

function step(dt) {
  sim.measure();
  sim.repair(dt);
  // Last before the substeps, so a dent this frame is solved this step.
  ent.update(dt);
  sim.step(dt);
}

export function init() {
  sim.clear();
  ent.reset([Enemy, Player, ent.Particle]);

  new Player();
  ent.every(1.5, () => {
    new Enemy();
  });
  sim.measure(); // before the first render, which reads the winding
}

export function update() {
  fixed(60, step);
}

export function render(ctx) {
  ent.render(ctx);
}
