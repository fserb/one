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
 * position to this one, against the outline pushed out by half the blob's
 * width, in the piece's own unturned coordinates. That gives the point and the
 * face in one pass and nothing tunnels at 1110 a second. Both ends of the step use this frame's angle, which
 * is a frame of error in the shape's turn and none in the blob's line.
 */

import * as ent from "./lib/entity.js";
import { flash } from "./lib/effects.js";
import { shake } from "./lib/camera.js";
import { gameOver, msg, score, speed } from "./lib/one.js";
import * as play from "./lib/sounds.js";

export { render } from "./lib/entity.js";

export const meta = {
  title: "boxjump",
  bg: "#08090C",
  fg: "#FFC46B",
  scoreMax: true,
  date: "2026-09-12",
};

const TAU = 2 * Math.PI;

const BOARD = 0x08090c;
const PIECE = 0x14161c;
const CHALK = 0xffd696; // the torch's colour, which the dust and the flash take too
const BLOB = 0xffe3b0;
const EYE = 0x5a3a10;

// The torch's half-angle in radians, and how far its light reaches.
const CONE = 0.32;
const BEAM = 1300;

const SPEED = 1110;
const RIDE = 23; // how far the blob's middle floats off the face it stands on

// The blob, and how far past the board's edge it gets before the run ends.
const BW = 32;
const BH = 45;
const OUT = 85;

// A launch that will reach no piece runs the round at SLOW for MISS real seconds,
// and again while that flight closes in on a piece's outline within NEAR, plus
// PASS real seconds after it stops closing in.
const SLOW = 0.05;
const MISS = 0.5;
const NEAR = 60;
const PASS = 0.15;

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
let slow = 0; // real seconds left at SLOW

class Piece extends ent.Entity {
  constructor(x, y, sides, r, spin, count) {
    super();
    this.pos.x = x;
    this.pos.y = y;
    this.r = r;
    this.spin = spin;
    this.count = count;
    this.pts = corners(sides, r);
    // The outline pushed out by half the blob's width along every face, which
    // is what the blob's middle is tested against.
    this.hit = corners(sides, r + BW / 2 / Math.cos(Math.PI / sides));
    this.angle = TAU * Math.random();
    this.pop = 0; // fades from 1 on the launch that took a number off

    // size() is the circumcircle's square, and it is required: a triangle's
    // bounding box is not centred on its circumcentre.
    this.gfx.size(2 * this.r).fill(PIECE);
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
    const b = ent.one(Player);
    if (b !== null) this.rim(ctx, b);
    ctx.rotate(-this.angle);
    ctx.fillStyle = "#ffc46b88";
    ctx.text(`${this.count}`, 0, 0, this.r * 0.6);
  }

  // The faces turned to the blob catch its light: in full inside the cone,
  // and fading with distance outside it.
  rim(ctx, b) {
    const l = this.toLocal(b.pos.x, b.pos.y);
    const a = Math.atan2(b.dir.y, b.dir.x);
    const n = this.pts.length;
    ctx.lineWidth = 5;
    for (let i = 0; i < n; ++i) {
      const [px, py] = this.pts[i];
      const [qx, qy] = this.pts[(i + 1) % n];
      const mx = (px + qx) / 2 - l.x;
      const my = (py + qy) / 2 - l.y;
      const d = Math.hypot(mx, my);
      const nrm = normal(this.pts, i);
      const lit = -(nrm.x * mx + nrm.y * my) / d;
      if (lit <= 0) continue;
      const w = this.toWorld((px + qx) / 2, (py + qy) / 2);
      const off = Math.atan2(w.y - b.pos.y, w.x - b.pos.x) - a;
      const inside = Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) < CONE;
      const k = lit * (inside ? 1 : Math.min(0.6, 120 / d));
      ctx.strokeStyle = `rgba(255,214,150,${k})`;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(qx, qy);
      ctx.stroke();
    }
  }

  // The faces turned away from (lx, ly), each pushed out to past the board:
  // every quad winds the same way, so one fill of them all is the shadow.
  shadow(ctx, lx, ly) {
    const l = this.toLocal(lx, ly);
    const n = this.pts.length;
    const far = (q) => {
      const dx = q.x - lx;
      const dy = q.y - ly;
      const d = Math.hypot(dx, dy);
      return { x: q.x + dx / d * 3000, y: q.y + dy / d * 3000 };
    };
    for (let i = 0; i < n; ++i) {
      const [px, py] = this.pts[i];
      const nrm = normal(this.pts, i);
      if (nrm.x * (px - l.x) + nrm.y * (py - l.y) < 0) continue;
      const a = this.toWorld(px, py);
      const b = this.toWorld(...this.pts[(i + 1) % n]);
      const fa = far(a);
      const fb = far(b);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(fb.x, fb.y);
      ctx.lineTo(fa.x, fa.y);
      ctx.closePath();
    }
  }

  // The last piece to go ends the level, with the blob still in the air.
  leave() {
    this.count -= 1;
    this.pop = 1;
    if (this.count > 0) {
      this.spin = spin();
      return;
    }

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

  // Where the step from a to b first comes within half the blob's width of
  // this outline, in local coordinates: the point on the face it reached and
  // that face's outward normal, or null on a miss.
  cross(ax, ay, bx, by, angle = this.angle) {
    const a = this.toLocal(ax, ay, angle);
    const b = this.toLocal(bx, by, angle);
    const c = crossPoly(a, b, this.hit);
    if (c === null) return null;
    const { x, y } = onEdge(c, this.pts, c.i);
    return { ...c, x, y };
  }

  toLocal(x, y, angle = this.angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
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

// The blob's torch: a glow round it, a cone down the line it faces, and every
// piece's shadow cut back out of both in the board's colour.
class Light extends ent.Entity {
  render(ctx) {
    const b = ent.one(Player);
    if (b === null) return;
    const { x, y } = b.pos;
    const a = Math.atan2(b.dir.y, b.dir.x);

    const glow = ctx.createRadialGradient(x, y, 0, x, y, 220);
    glow.addColorStop(0, "#ffc46b40");
    glow.addColorStop(1, "#ffc46b00");
    ctx.fillStyle = glow;
    ctx.fillRect(x - 220, y - 220, 440, 440);

    const beam = ctx.createRadialGradient(x, y, 0, x, y, BEAM);
    beam.addColorStop(0, "#ffe2a8");
    beam.addColorStop(0.3, "#b9874a");
    beam.addColorStop(1, "#2a1e10");
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, 1600, a - CONE, a + CONE);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    for (const p of ent.get(Piece)) p.shadow(ctx, x, y);
    ctx.fillStyle = ent.css(BOARD);
    ctx.fill();
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
    this.missing = null; // the piece left on a flight predicted to reach none
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
      .fill(EYE).rect(-6, 9 - BH / 2, 13, 9, 9);
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
    if (clearing > 0 || !this.misses()) return;
    this.missing = p;
    this.gap = Infinity;
    slow = MISS;
    speed(SLOW);
  }

  // How far the nearest outline is, other than the piece it left.
  gapNow() {
    let d = Infinity;
    for (const p of ent.get(Piece)) {
      if (p === this.missing) continue;
      d = Math.min(d, nearest(p.toLocal(this.pos.x, this.pos.y), p.pts).d);
    }
    return d;
  }

  // Runs the flight ahead in 1/240 s steps, every piece turning as it will, and
  // reports whether it leaves the board without crossing one.
  misses() {
    const h = 1 / 240;
    const pieces = ent.get(Piece).filter((p) => p !== this.from);
    let { x, y } = this.pos;
    for (let t = h; x > 0 && x < 1024 && y > 0 && y < 1024; t += h) {
      const bx = x + this.dir.x * SPEED * h;
      const by = y + this.dir.y * SPEED * h;
      for (const p of pieces) {
        if (p.cross(x, y, bx, by, p.angle + p.spin * t)) return false;
      }
      x = bx;
      y = by;
    }
    return true;
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
    if (this.missing !== null) {
      const d = this.gapNow();
      if (d < NEAR && d < this.gap) {
        slow = Math.max(slow, PASS);
        speed(SLOW);
      }
      this.gap = d;
    }

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
    this.missing = null;
    slow = 0;
    speed(1);

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
    ctx.shadowColor = "#ffc46b";
    ctx.shadowBlur = 24;
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
  return { t: best.t, i: best.i, x: best.x, y: best.y, nx: nrm.x, ny: nrm.y };
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
    const e = onEdge(p, pts, i);
    if (best === null || e.d < best.d) best = { d: e.d, t: 0, i, x: e.x, y: e.y };
  }
  return best;
}

// The point on edge i nearest p, and how far it is.
function onEdge(p, pts, i) {
  const [px, py] = pts[i];
  const [qx, qy] = pts[(i + 1) % pts.length];
  const dx = qx - px;
  const dy = qy - py;
  const u = clamp(((p.x - px) * dx + (p.y - py) * dy) / (dx * dx + dy * dy));
  const x = px + dx * u;
  const y = py + dy * u;
  return { d: Math.hypot(p.x - x, p.y - y), x, y };
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

// Radians a second, either way: a slow shape is a longer wait for the face and a
// wider press when it comes, a fast one the opposite.
function spin() {
  const s = (1.6 + 1.4 * Math.random()) * Math.min(1.6, 1 + 0.04 * level);
  return Math.random() < 0.5 ? -s : s;
}

function buildLevel() {
  ent.reset([Light, Piece, Player, ent.Particle]);
  new Light();

  const n = Math.min(3 + (level >> 1), 6);
  const most = Math.min(1 + Math.ceil(level / 2), 3);
  const big = 183 - 13 * n;
  const pieces = [];

  for (let i = 0; i < n; ++i) {
    const sides = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    // Its size band, biggest first, which is the order that packs.
    const s = SMIN + (big - SMIN) * (n - 1 - i + Math.random()) / n;
    const r = s * FAT[sides];
    const at = place(pieces, r);
    if (at === null) continue;
    pieces.push(
      new Piece(at.x, at.y, sides, r, spin(), 1 + Math.floor(Math.random() * most)),
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
  slow = 0;
  buildLevel();
}

export function update(dt, real) {
  ent.update(dt);
  if (slow > 0) {
    slow -= real;
    if (slow <= 0) speed(1);
  }
  if (clearing <= 0) return;
  clearing -= dt;
  if (clearing > 0) return;
  level += 1;
  buildLevel();
}
