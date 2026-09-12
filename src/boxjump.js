/*
 * boxjump. Based on a prototype by wombatstuff.
 * https://x.com/wombatstuff/status/1180176881708146688
 *
 * A board of turning shapes, each with a number on it, and a blob standing on
 * one of their faces. The blob turns with the shape it is on, and the one
 * button launches it straight out along that face's normal. Every launch takes
 * 1 off the shape it left; at 0 that shape goes, and the level is over when the
 * last one does. Miss every shape and the blob leaves the board, which is the
 * end of the run.
 *
 * The flight is a straight line at a constant speed. No gravity, no drag: the
 * only thing the player chooses is when to press, and the shape's own turn is
 * what aims the shot. The face the blob stands on is the whole aim, and the
 * blob goes exactly where that face points.
 *
 * The number falls on the launch and not on the landing, so the last shape
 * goes while the blob is still in the air, and the level ends mid-flight.
 * `clearing` is the board holding for a moment before the next one, and it is
 * also what stops that flight counting as leaving the board.
 *
 * A contact is a segment test, not an overlap: the step from last frame's
 * position to this one, against the outline in the piece's own unturned
 * coordinates. That gives the exact point and the exact face in one pass, which
 * an overlap test does not, and nothing tunnels through a shape at 520 a
 * second. The piece is read at this frame's angle for both ends of the step,
 * which is a frame of error in the shape's turn and nothing in the blob's line.
 *
 * The piece just launched from is held in `from` and ignored until the blob is
 * clear of its circumcircle; the blob leaves along the face it stood on, so
 * without that it lands straight back on it.
 */

import { css } from "./lib/art.js";
import * as ent from "./lib/entity.js";
import { flash, gameOver, msg, score } from "./lib/one.js";
import { explosion, hit, jump, powerup } from "./lib/fsfx/sfxr.js";
import * as sound from "./lib/sound.js";

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

const W = 480;
const TAU = 2 * Math.PI;

// meta.bg and meta.fg as the numbers the drawing takes, and the blob.
const BOARD = 0x2b2d42;
const CHALK = 0xedf2f4;
const BLOB = 0xef476f;

// Units a second in flight, and how far the blob's middle floats off the face
// it stands on.
const SPEED = 520;
const RIDE = 11;

// The blob, and how far past the board's edge it gets before the run ends.
const BW = 15;
const BH = 21;
const OUT = 40;

/*
 * A piece is placed with its middle at least its own circumradius plus EDGE
 * from the board's edge, and no two circumcircles come within GAP of each
 * other. EDGE is RIDE plus half the blob, so the blob standing on the face
 * nearest the edge is still on the board, and a small piece can sit much
 * closer in than a big one.
 */
const GAP = 22;
const EDGE = 22;

/*
 * The size a piece is drawn at, before FAT. The range is cut into `n` bands and
 * each piece is rolled inside its own, biggest first, rather than each rolling
 * over the whole range: independent rolls come out all-medium often enough to
 * notice, and a band each puts a shape the blob can barely stand on next to one
 * a third of the board across, on every board. The top falls with the count,
 * which is the only thing that keeps six of them fitting.
 */
const SMIN = 22;
const SMAX = 86;
const PER = 6;

// A triangle, a square, a hexagon, and what each is drawn at against the
// others: a triangle of the same circumradius reads much smaller.
const SHAPES = [3, 4, 6];
const FAT = { 3: 1.32, 4: 1.12, 6: 1.02 };

// Radians a second a piece turns, before the level's ramp. The spread is the
// point: a slow shape is a longer wait for the face to come round and a wider
// press when it does, a fast one the other way about, and a board wants some of
// each. The floor is a wait of five seconds for a full turn, which is as long
// as watching a shape go round stays interesting.
const SPIN = 1.2;
const SPIN_VAR = 1.4;

// Seconds the board holds after the last piece goes, and after the blob does.
const CLEAR = 0.8;
const DEATH = 0.35;

sound.voice("land", { ...hit(21883), vol: 0.1 });
sound.voice("jump", { ...jump(9271), vol: 0.14 });
sound.voice("pop", { ...explosion(4471), vol: 0.16 });
sound.voice("clear", { ...powerup(3311), vol: 0.2 });
sound.voice("die", { ...explosion(1032), vol: 0.2 });

let level = 0;
// Seconds left of the pause between one level and the next, 0 while playing.
let clearing = 0;

/*
 * One turning shape: the regular polygon with `sides` corners, held as those
 * corners in local coordinates so the contact test walks them rather than
 * rebuilding them every frame.
 */
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
    // Fades from 1 on the launch that took a number off it.
    this.pop = 0;

    // size() is the circumcircle's square, and it is load-bearing: Gfx centres
    // a drawing on its own bounding box, and a triangle's box is not centred on
    // its circumcentre, so without it the outline sits a quarter of a radius
    // off the geometry the blob lands against.
    this.gfx.size(2 * this.r).fill(CHALK);
    this.gfx.mt(this.pts[0][0], this.pts[0][1]);
    for (const [x, y] of this.pts.slice(1)) this.gfx.lt(x, y);
    this.gfx.lt(this.pts[0][0], this.pts[0][1]);
    this.paint();
  }

  // The number, which is the only part of a piece that changes.
  paint() {
    this.art.clear().color(BOARD).text(0, 0, `${this.count}`, this.r / 13);
  }

  update() {
    this.angle += this.spin * ent.game.time;
    this.pop = Math.max(0, this.pop - 4 * ent.game.time);
    this.scale = 1 + 0.16 * this.pop;
  }

  // The outline turns and the number does not: a digit coming round upside
  // down is a digit nobody reads at a glance, and the corners already say
  // which way the piece is going.
  render(ctx) {
    this.gfx.render(ctx);
    ctx.rotate(-this.angle);
    this.art.render(ctx);
  }

  // A launch off this piece. The number falls by one, and the piece goes at 0.
  // The last one to go ends the level, with the blob still in the air.
  leave() {
    this.count -= 1;
    this.pop = 1;
    if (this.count > 0) {
      this.paint();
      return;
    }

    new ent.Particle({
      x: this.pos.x,
      y: this.pos.y,
      color: CHALK,
      count: 28,
      size: [2, 4],
      speed: [90, 110],
      spread: this.r * 0.7,
      duration: [0.5, 0.3],
    });
    this.remove();
    sound.play("pop");
    ent.shake(0.25);
    if (ent.get(Piece).length === 0) clear();
  }

  // Where the step from a to b first crosses this outline, in the piece's own
  // unturned coordinates: the point, and the outward normal of the face it
  // crossed. null if the step misses.
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

  // The same turn without the move, which is what a normal wants.
  turn(x, y) {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    return { x: x * c - y * s, y: x * s + y * c };
  }
}

/*
 * The blob, in one of two states: riding a piece, where that piece owns its
 * position and its heading, or flying, where it moves in a straight line until
 * it meets a piece or leaves the board.
 *
 * Riding holds the contact in the piece's local coordinates, `ax, ay` on the
 * face and `nx, ny` out of it, so the turn of the piece is the only thing that
 * moves the blob and nothing accumulates.
 */
class Player extends ent.Entity {
  constructor(x, y, dx, dy) {
    super();
    this.pos.x = x;
    this.pos.y = y;
    this.dir = { x: dx, y: dy };
    this.piece = null;
    this.from = null;
    // The contact in that piece's own coordinates: a point on the face, and the
    // normal out of it. Read only while `piece` is set.
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
    this.gfx.fill(BLOB).rect(-BW / 2, -BH / 2, BW, BH, 9)
      .fill(BOARD).rect(-3, 4 - BH / 2, 6, 4, 4);
  }

  // The press is read here and not in ride(), which land() also calls: a press
  // on the frame the blob touches down would otherwise launch it straight back
  // out of a face it never stood on.
  update() {
    this.squash *= Math.max(0, 1 - 11 * ent.game.time);
    if (this.piece === null) {
      this.fly();
      return;
    }
    this.ride();
    if (ent.game.key.just.b1) this.launch();
  }

  // The piece owns the position. The face's outward normal is both where the
  // blob stands and where it will go.
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
      size: [2, 3],
      speed: [60, 70],
      direction: [Math.atan2(-this.dir.y, -this.dir.x) - 0.6, 1.2],
      duration: [0.3, 0.2],
    });
    sound.play("jump");
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

    const on = this.pos.x > 0 && this.pos.x < W && this.pos.y > 0 &&
      this.pos.y < W;
    this.entered ||= on;
    // The flight that cleared the level is not a flight that can end the run.
    if (on || !this.entered || clearing > 0) return;
    if (
      this.pos.x > -OUT && this.pos.x < W + OUT && this.pos.y > -OUT &&
      this.pos.y < W + OUT
    ) return;
    this.die();
  }

  // The piece the step crossed first, by the fraction of the step at which it
  // crossed. Every outline is convex, so the first edge crossed is the face.
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
      size: [2, 3],
      speed: [50, 70],
      direction: [Math.atan2(n.y, n.x) - Math.PI / 2, Math.PI],
      duration: [0.3, 0.2],
    });
    sound.play("land");
    ent.shake(0.1);
    return true;
  }

  // Off the board, so there is nothing on screen to burst. The board holds for
  // a moment and the finish screen takes it.
  die() {
    this.remove();
    sound.play("die");
    ent.shake(0.3);
    ent.after(DEATH, () => gameOver({ score: true }));
  }

  // Local y is the normal, so a landing flattens the blob against the face and
  // a launch draws it out along the line it leaves on.
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

/*
 * The step against a convex polygon about the origin: the first edge it
 * crosses.
 *
 * A step that starts and ends inside crosses nothing, and a corner turning over
 * a blob that is passing close is exactly that. The nearest face is where it
 * lands, which is where the corner swept it to.
 */
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

// The outward normal of edge i: the perpendicular pointing away from the
// middle, which in local coordinates is the origin.
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

// Anywhere with room for this piece that clears every piece already down. It
// gives the piece up rather than shrink one, since a shape's size is the shape
// of the jump off it; over 3000 boards of six it never had to.
function place(pieces, r) {
  const m = r + EDGE;
  for (let i = 0; i < 300; ++i) {
    const x = m + (W - 2 * m) * Math.random();
    const y = m + (W - 2 * m) * Math.random();
    const free = pieces.every((p) => dist(p.pos, { x, y }) > p.r + r + GAP);
    if (free) return { x, y };
  }
  return null;
}

// How far (x, y) is from the board's edge along (dx, dy).
function reach(x, y, dx, dy) {
  const sx = dx > 0 ? (W - x) / dx : dx < 0 ? -x / dx : Infinity;
  const sy = dy > 0 ? (W - y) / dy : dy < 0 ? -y / dy : Infinity;
  return Math.min(sx, sy);
}

function clear() {
  clearing = CLEAR;
  score.value += 1;
  sound.play("clear");
  flash(css(CHALK), 0.05);
}

/*
 * Three pieces of 1 to open with, then one more piece every other level and one
 * more on the numbers every other level, stopping at six pieces of up to 3.
 * Both caps are there because every death replays from level 1: seven pieces of
 * up to 4 averages 17 launches, and a run that reaches that level spends
 * minutes getting back to ground it has already covered.
 *
 * The turn keeps ramping past both, to 1.6 times the opening rate at level 15,
 * and it is the real difficulty anyway: it sets how long the blob waits for its
 * face to come round to something, and how narrow the press that takes it.
 */
function buildLevel() {
  ent.reset([Piece, Player, ent.Particle]);

  const n = Math.min(3 + (level >> 1), 6);
  const most = Math.min(1 + Math.ceil(level / 2), 3);
  const ramp = Math.min(1.6, 1 + 0.04 * level);
  const big = SMAX - PER * n;
  const pieces = [];

  for (let i = 0; i < n; ++i) {
    const sides = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    // This piece's size band, biggest first, which is the order that packs.
    const s = SMIN + (big - SMIN) * (n - 1 - i + Math.random()) / n;
    const r = s * FAT[sides];
    const at = place(pieces, r);
    if (at === null) continue;
    const spin = (SPIN + SPIN_VAR * Math.random()) * ramp;
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

  // The level opens with the blob already in the air, shot in off the board at
  // one of the pieces, so frame one is the game running.
  const target = pieces[Math.floor(Math.random() * pieces.length)];
  const a = TAU * Math.random();
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const back = reach(target.pos.x, target.pos.y, -dx, -dy) + 30;
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

export { render } from "./lib/entity.js";
