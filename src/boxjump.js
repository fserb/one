/*
 * boxjump. Based on a prototype by wombatstuff.
 * https://x.com/wombatstuff/status/1180176881708146688
 *
 * The number falls on the launch and not on the landing, so the last shape goes
 * while the blob is still in the air and the level ends mid-flight. `clearing`
 * is the pause before the next board, and also what stops that flight counting
 * as leaving the board.
 *
 * A contact is a segment test and not an overlap: the step from last frame's
 * position to this one, against the outline in the piece's own unturned
 * coordinates. That gives the point and the face in one pass and nothing
 * tunnels at 1110 a second. Both ends of the step use this frame's angle, which
 * is a frame of error in the shape's turn and none in the blob's line.
 */

import * as ent from "./lib/entity.js";
import { flash } from "./lib/effects.js";
import { shake } from "./lib/camera.js";
import { gameOver, msg, score } from "./lib/one.js";
import * as play from "./lib/sounds.js";

export { render } from "./lib/entity.js";

export const meta = {
  title: "boxjump",
  desc: `
ride the turning shape, press to launch
off the face you are standing on
`,
  bg: "#2B2D42",
  fg: "#EDF2F4",
  scoreMax: true,
  date: "2026-09-12",
};

const TAU = 2 * Math.PI;

const BOARD = 0x2b2d42;
const CHALK = 0xedf2f4;
const BLOB = 0xef476f;

const SPEED = 1110;
const RIDE = 23; // how far the blob's middle floats off the face it stands on

// The blob, and how far past the board's edge it gets before the run ends.
const BW = 32;
const BH = 45;
const OUT = 85;

// No two circumcircles come within GAP. EDGE is RIDE plus half the blob, so the
// blob on the face nearest the edge is still on the board.
const GAP = 47;
const EDGE = 47;

// The size a piece is drawn at, before FAT. The range is cut into `n` bands and
// each piece chosen inside its own, since independent choices come out
// all-medium. The top falls with the count, which keeps six of them fitting.
const SMIN = 47;

// A triangle of the same circumradius looks much smaller, hence FAT.
const SHAPES = [3, 4, 6];
const FAT = { 3: 1.32, 4: 1.12, 6: 1.02 };

let level = 0;
let clearing = 0; // seconds left of the pause between levels, 0 while playing

class Piece extends ent.Entity {
  constructor(x, y, sides, r, spin, count) {
    super();
    this.pos.x = x;
    this.pos.y = y;
    this.r = r;
    this.spin = spin;
    this.count = count;
    this.pts = corners(sides, r);
    this.angle = TAU * Math.random();
    this.pop = 0; // fades from 1 on the launch that took a number off

    // size() is the circumcircle's square, and it is required: a triangle's
    // bounding box is not centred on its circumcentre.
    this.gfx.size(2 * this.r).fill(CHALK);
    this.gfx.mt(this.pts[0][0], this.pts[0][1]);
    for (const [x, y] of this.pts.slice(1)) this.gfx.lt(x, y);
    this.gfx.lt(this.pts[0][0], this.pts[0][1]);
  }

  update() {
    this.angle += this.spin * ent.game.time;
    this.pop = Math.max(0, this.pop - 4 * ent.game.time);
    this.scale = 1 + 0.16 * this.pop;
  }

  // The outline turns and the number does not: a digit coming round upside down
  // is a digit nobody reads at a glance.
  render(ctx) {
    this.gfx.render(ctx);
    ctx.rotate(-this.angle);
    ctx.fillStyle = ent.css(BOARD);
    ctx.text(`${this.count}`, 0, 0, this.r * 0.74);
  }

  // The last piece to go ends the level, with the blob still in the air.
  leave() {
    this.count -= 1;
    this.pop = 1;
    if (this.count > 0) return;

    new ent.Particle({
      x: this.pos.x,
      y: this.pos.y,
      color: CHALK,
      count: 28,
      size: [4, 9],
      speed: [190, 235],
      spread: this.r * 0.7,
      duration: [0.5, 0.3],
    });
    this.remove();
    play.break();
    shake(0.25);
    if (ent.get(Piece).length === 0) clear();
  }

  // Where the step from a to b first crosses this outline, in local
  // coordinates: the point and the face's outward normal, or null on a miss.
  cross(ax, ay, bx, by) {
    return crossPoly(this.toLocal(ax, ay), this.toLocal(bx, by), this.pts);
  }

  toLocal(x, y) {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const dx = x - this.pos.x;
    const dy = y - this.pos.y;
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
  }

  toWorld(x, y) {
    const t = this.turn(x, y);
    return { x: this.pos.x + t.x, y: this.pos.y + t.y };
  }

  // The same turn without the move, which is what a normal needs.
  turn(x, y) {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return { x: x * c - y * s, y: x * s + y * c };
  }
}

// Riding holds the contact in the piece's local coordinates, so the piece's
// turn is the only thing that moves the blob and nothing accumulates.
class Player extends ent.Entity {
  constructor(x, y, dx, dy) {
    super();
    this.pos.x = x;
    this.pos.y = y;
    this.dir = { x: dx, y: dy };
    this.piece = null;
    this.from = null;
    // Read only while `piece` is set.
    this.ax =
      this.ay =
      this.nx =
      this.ny =
        0;
    // + is flat against a face, - is stretched along the flight.
    this.squash = 0;
    // It starts off the board, so leaving is only a loss once it has been on.
    this.entered = false;
    this.angle = Math.atan2(dy, dx) + Math.PI / 2;
    this.gfx.fill(BLOB).rect(-BW / 2, -BH / 2, BW, BH, 19)
      .fill(BOARD).rect(-6, 9 - BH / 2, 13, 9, 9);
  }

  // The press is read here and not in ride(), which land() also calls: it would
  // launch the blob straight back out of a face it never stood on.
  update() {
    this.squash *= Math.max(0, 1 - 11 * ent.game.time);
    if (this.piece === null) {
      this.fly();
      return;
    }
    this.ride();
    if (ent.game.input.just.act) this.launch();
  }

  // The face's outward normal is both where the blob stands and where it goes.
  ride() {
    const p = this.piece;
    const n = p.turn(this.nx, this.ny);
    const a = p.toWorld(this.ax, this.ay);
    this.dir = n;
    this.pos.x = a.x + n.x * RIDE;
    this.pos.y = a.y + n.y * RIDE;
    this.angle = Math.atan2(n.y, n.x) + Math.PI / 2;
  }

  launch() {
    const p = this.piece;
    this.piece = null;
    this.from = p;
    this.squash = -0.3;
    new ent.Particle({
      x: this.pos.x,
      y: this.pos.y,
      color: CHALK,
      count: 10,
      size: [4, 6],
      speed: [128, 150],
      direction: [Math.atan2(-this.dir.y, -this.dir.x) - 0.6, 1.2],
      duration: [0.3, 0.2],
    });
    play.jump();
    p.leave();
  }

  fly() {
    const x = this.pos.x;
    const y = this.pos.y;
    this.pos.x += this.dir.x * SPEED * ent.game.time;
    this.pos.y += this.dir.y * SPEED * ent.game.time;
    this.angle = Math.atan2(this.dir.y, this.dir.x) + Math.PI / 2;

    // Clear of the piece it left, so that one can catch it again.
    if (this.from !== null && dist(this.pos, this.from.pos) > this.from.r + BH) {
      this.from = null;
    }
    if (this.land(x, y)) return;

    const on = this.pos.x > 0 && this.pos.x < 1024 && this.pos.y > 0 &&
      this.pos.y < 1024;
    this.entered ||= on;
    // The flight that cleared the level is not a flight that can end the run.
    if (on || !this.entered || clearing > 0) return;
    if (
      this.pos.x > -OUT && this.pos.x < 1024 + OUT && this.pos.y > -OUT &&
      this.pos.y < 1024 + OUT
    ) return;
    this.die();
  }

  // The piece the step crossed earliest. Every outline is convex, so the first
  // edge crossed is the face.
  land(x, y) {
    let best = null;
    let piece = null;
    for (const p of ent.get(Piece)) {
      if (p === this.from) continue;
      const c = p.cross(x, y, this.pos.x, this.pos.y);
      if (c === null || (best !== null && c.t >= best.t)) continue;
      best = c;
      piece = p;
    }
    if (best === null) return false;

    this.piece = piece;
    this.from = null;
    this.ax = best.x;
    this.ay = best.y;
    this.nx = best.nx;
    this.ny = best.ny;
    this.squash = 0.35;
    this.ride();

    const n = piece.turn(best.nx, best.ny);
    new ent.Particle({
      x: this.pos.x,
      y: this.pos.y,
      color: CHALK,
      count: 12,
      size: [4, 6],
      speed: [107, 150],
      direction: [Math.atan2(n.y, n.x) - Math.PI / 2, Math.PI],
      duration: [0.3, 0.2],
    });
    play.land();
    shake(0.1);
    return true;
  }

  die() {
    this.remove();
    play.lose();
    shake(0.3);
    ent.after(0.35, () => gameOver({ score: true }));
  }

  // Local y is the normal, so a landing flattens the blob against the face and
  // a launch stretches it along the line it leaves on.
  render(ctx) {
    ctx.scale(1 + this.squash, 1 - this.squash);
    this.gfx.render(ctx);
  }
}

// A regular polygon's corners, circumradius r, the first one straight up.
function corners(sides, r) {
  const out = [];
  for (let i = 0; i < sides; ++i) {
    const a = -Math.PI / 2 + TAU * i / sides;
    out.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return out;
}

// The first edge the step crosses. A step that starts and ends inside crosses
// nothing, and a corner turning over a blob passing close is exactly that: the
// nearest face is where the corner swept it to.
function crossPoly(a, b, pts) {
  const n = pts.length;
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  let best = null;

  for (let i = 0; i < n; ++i) {
    const [px, py] = pts[i];
    const [qx, qy] = pts[(i + 1) % n];
    const sx = qx - px;
    const sy = qy - py;
    const den = rx * sy - ry * sx;
    if (den === 0) continue;
    const t = ((px - a.x) * sy - (py - a.y) * sx) / den;
    const u = ((px - a.x) * ry - (py - a.y) * rx) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) continue;
    if (best !== null && t >= best.t) continue;
    best = { t, i, x: a.x + rx * t, y: a.y + ry * t };
  }

  if (best === null) {
    if (!inside(b, pts)) return null;
    best = nearest(b, pts);
  }

  const nrm = normal(pts, best.i);
  return { t: best.t, x: best.x, y: best.y, nx: nrm.x, ny: nrm.y };
}

// The perpendicular of edge i pointing away from the origin.
function normal(pts, i) {
  const [px, py] = pts[i];
  const [qx, qy] = pts[(i + 1) % pts.length];
  const len = Math.hypot(qx - px, qy - py);
  const x = (qy - py) / len;
  const y = -(qx - px) / len;
  const out = x * (px + qx) + y * (py + qy) > 0;
  return out ? { x, y } : { x: -x, y: -y };
}

// corners() winds so that every edge has the middle on its left.
function inside(p, pts) {
  for (let i = 0; i < pts.length; ++i) {
    const [px, py] = pts[i];
    const [qx, qy] = pts[(i + 1) % pts.length];
    if ((qx - px) * (p.y - py) - (qy - py) * (p.x - px) < 0) return false;
  }
  return true;
}

// The point on the outline nearest p, and the edge it is on.
function nearest(p, pts) {
  let best = null;
  for (let i = 0; i < pts.length; ++i) {
    const [px, py] = pts[i];
    const [qx, qy] = pts[(i + 1) % pts.length];
    const dx = qx - px;
    const dy = qy - py;
    const u = clamp(((p.x - px) * dx + (p.y - py) * dy) / (dx * dx + dy * dy));
    const x = px + dx * u;
    const y = py + dy * u;
    const d = Math.hypot(p.x - x, p.y - y);
    if (best === null || d < best.d) best = { d, t: 0, i, x, y };
  }
  return best;
}

function clamp(v) {
  return Math.min(1, Math.max(0, v));
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// It drops the piece rather than shrink one, since a shape's size is the shape
// of the jump off it; over 3000 boards of six it never had to.
function place(pieces, r) {
  const m = r + EDGE;
  for (let i = 0; i < 300; ++i) {
    const x = m + (1024 - 2 * m) * Math.random();
    const y = m + (1024 - 2 * m) * Math.random();
    const free = pieces.every((p) => dist(p.pos, { x, y }) > p.r + r + GAP);
    if (free) return { x, y };
  }
  return null;
}

// How far (x, y) is from the board's edge along (dx, dy).
function reach(x, y, dx, dy) {
  const sx = dx > 0 ? (1024 - x) / dx : dx < 0 ? -x / dx : Infinity;
  const sy = dy > 0 ? (1024 - y) / dy : dy < 0 ? -y / dy : Infinity;
  return Math.min(sx, sy);
}

function clear() {
  clearing = 0.8;
  score.value += 1;
  play.power();
  flash(ent.css(CHALK), 0.05);
}

function buildLevel() {
  ent.reset([Piece, Player, ent.Particle]);

  const n = Math.min(3 + (level >> 1), 6);
  const most = Math.min(1 + Math.ceil(level / 2), 3);
  const ramp = Math.min(1.6, 1 + 0.04 * level);
  const big = 183 - 13 * n;
  const pieces = [];

  for (let i = 0; i < n; ++i) {
    const sides = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    // Its size band, biggest first, which is the order that packs.
    const s = SMIN + (big - SMIN) * (n - 1 - i + Math.random()) / n;
    const r = s * FAT[sides];
    const at = place(pieces, r);
    if (at === null) continue;
    // Radians a second: a slow shape is a longer wait for the face and a wider
    // press when it comes, a fast one the opposite.
    const spin = (1.2 + 1.4 * Math.random()) * ramp;
    pieces.push(
      new Piece(
        at.x,
        at.y,
        sides,
        r,
        Math.random() < 0.5 ? -spin : spin,
        1 + Math.floor(Math.random() * most),
      ),
    );
  }

  // The level opens with the blob already in the air, so frame one is the game.
  const target = pieces[Math.floor(Math.random() * pieces.length)];
  const a = TAU * Math.random();
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const back = reach(target.pos.x, target.pos.y, -dx, -dy) + 64;
  new Player(target.pos.x - dx * back, target.pos.y - dy * back, dx, dy);

  msg(`LEVEL ${level + 1}`);
}

export function init() {
  level = 0;
  clearing = 0;
  buildLevel();
}

export function update(dt) {
  ent.update(dt);
  if (clearing <= 0) return;
  clearing -= dt;
  if (clearing > 0) return;
  level += 1;
  buildLevel();
}
