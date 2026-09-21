/*
 * spinner. A bubble shooter where both things that matter turn: the blob on its
 * axle, and the gun on the rail around it.
 *
 * The blob is a hexagonal grid in a frame of its own: `cells`, keyed "q,r",
 * with the axle at (0, 0) and never in the map. Nothing in the grid moves. The
 * blob has one `angle`, and a bubble's board position is its cell turned by
 * that about the middle. A landing turns the contact point back the other way
 * to pick the cell the bubble settles in, and turns the blob by the arm crossed
 * with the shot's velocity over the blob's own moment, so one hit moves a small
 * blob further than a big one.
 *
 * The gun has no drive. It rides a circular rail, the bubble leaves the chamber
 * at its pivot, and the only thing that moves the carriage is what that shot
 * pushed back: aim across the rail and it slides, aim at the middle and it
 * holds. So every shot both plays the board and picks where the next one is
 * fired from.
 *
 * What a shot bounces off is the room's four walls and never the rail, because
 * reflection inside a circle conserves the distance from the middle to the
 * shot's line: a shot that misses the axle by 200 misses it by 200 after every
 * bounce, so a bank off a round wall can only turn the chord and never aim it
 * in. A flat wall moves that number, which is what makes a bank worth taking.
 *
 * Three of a colour touching go, and whatever no longer reaches the axle falls
 * off: clearing the axle's six neighbours drops the board in one shot. A bubble
 * whose cell centre lands past FAR ends the round. Emptying the blob starts the
 * next board, one colour wider and worth one more.
 */

import * as ent from "./lib/entity.js";
import { shake } from "./lib/camera.js";
import { gameOver } from "./lib/one.js";
import * as play from "./lib/sounds.js";

export { render } from "./lib/entity.js";

export const meta = {
  title: "spinner",
  bg: "#BFB09A",
  fg: "#1A1712",
  scoreMax: true,
  date: "2026-09-21",
};

const TAU = 2 * Math.PI;

const ROOM = 0xd8cbb4; // inside the four walls
const FLOOR = 0xcdbfa6; // inside the gun's track
// Every line on the board is this one, and everything the game draws is cut
// out of the board with it.
const INK = 0x1a1712;
// What the axle and the chamber are filled with.
const PAPER = 0xfff8ea;

// The six a bubble can be. Board one is played with the first three, so those
// are the three furthest apart. Each one is saturated and none is near INK: a
// bubble that close to the line reads as a hole cut in the board.
const COLORS = [0xf2483f, 0xf5a623, 0x35b8e8, 0x4fbf52, 0xf25a9e, 0x8f6ae0];

const R = 30; // a bubble, and the grid's cell centres sit 2R apart
const STEP = 2 * R;
const ROW = STEP * Math.sqrt(3) / 2;

const CX = 512;
const CY = 512;
// The walls, inset from the board's edge, and where a shot's centre turns
// around.
const MARGIN = 22;
const LOW = MARGIN + R;
const HIGH = 1024 - MARGIN - R;
// The circle the gun's pivot rides. What sets it is the row outward from it:
// the chamber's 40, then the next ball, which has to sit clear of both the
// chamber and the wall.
const RAIL = 418;
const QUEUE = 474;
const QUEUE_R = 12;
// A cell centre past this leaves 72 between that bubble and a shot leaving the
// chamber, which is 2R and a little. Hex distance 5
// reaches 300 at its furthest and 6 runs from 312 to 360, so the blob fills
// five rings and keeps whichever part of the sixth it is turned to.
const FAR = 346;

// The chamber turns the whole way round. Pointing it straight out is the shot
// that only banks, and straight in is the one that moves the gun not at all.
const TURN = 1.6;
const MOUTH = 0.7; // the half-angle the chamber is open over

const SPEED = 1400;
// Bounces before the shot gives up banking. It is never thrown away: the one
// after this turns it at the axle, so every shot fired lands on the blob.
const BOUNCES = 5;
const RELOAD = 0.15;

// omega += cross(arm, velocity) * SPIN / moment.
const SPIN = 2.5;
const DRAG = 0.6;
// The axle's own moment, which is what a nearly empty blob turns on.
const AXLE_MOMENT = 5e4;
const AXLE_R = 28;

// The recoil, as a share of the shot's own momentum, and what bleeds it off.
// Together they carry the gun 110 degrees on the widest shot and none on a
// straight one.
const RECOIL = 1;
const RAIL_DRAG = 1.6;

const MATCH = 3;
// What the drops off a cleared board get before the next one arrives. A Drop
// lives one second, so this is that and a beat to read the empty board.
const FALL = 2;

const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

// "q,r" -> Bubble. The axle holds (0, 0) and is not one of these.
const cells = new Map();

let angle = 0;
let omega = 0;
let cosA = 1;
let sinA = 0;
let railA = -Math.PI / 2; // where the gun is, measured from the middle
let railV = 0;
let board = 1;
let colors = 3;
// The colour in the chamber, then the one waiting on the rail behind it.
let gun = [];
let reload = 0;
// The pointer as the chamber last read it: a pointer that moved aims it, and
// the keys have it the rest of the time. The first frame only records where it
// is, so a round does not open by swinging the gun at wherever it was left.
const ptr = { x: 0, y: 0 };
let aimed = false;

const key = (q, r) => `${q},${r}`;
const cellX = (q, r) => STEP * (q + r / 2);
const cellY = (_q, r) => ROW * r;
const taken = (q, r) => (q === 0 && r === 0) || cells.has(key(q, r));

function fold(a) {
  const x = a % TAU;
  if (x > Math.PI) return x - TAU;
  if (x <= -Math.PI) return x + TAU;
  return x;
}

// Where the crescent sits on a ball: up and to the left, and the same on every
// one of them, since the crescent is the light in the room and not something
// the bubble carries around the blob.
const LX = -0.645;
const LY = -0.764;
const LA = Math.atan2(LY, LX);
// The line under a ball, as a share of its radius, and where the crescent is
// drawn and how wide it is.
const CUT = 1.18;
const SHINE = 0.62;
const SHINE_W = 0.17;

// A ball is one flat colour and one white crescent, and the line it is cut out
// with is not its own: outline() lays that down for every ball on the board
// before any of them is filled. Drawn per ball, the line of the one next door
// lands on top of this one's colour and the pair reads as two discs with a gap
// between rather than as one sheet.
function outline(ctx, x, y, r) {
  ctx.fillStyle = ent.css(INK);
  ctx.beginPath();
  ctx.arc(x, y, r * CUT, 0, TAU);
  ctx.fill();
}

function ball(ctx, color, r) {
  ctx.fillStyle = ent.css(COLORS[color]);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
  ctx.lineWidth = r * SHINE_W;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(0, 0, r * SHINE, LA - 0.7, LA + 0.7);
  ctx.stroke();
}

// The board under everything: the room, the floor, and the next colour, which
// rides out past the chamber.
//
// One circle and not two. The floor ends exactly on the rail and the line
// around it is the track the gun runs on. The line a bubble loses at is 42
// inside that and is not drawn: two rings that close together read as a mark
// rather than as a track, and the blob arriving under the gun says the same
// thing.
class Rail extends ent.Entity {
  constructor() {
    super();
    this.pos.x = CX;
    this.pos.y = CY;
    const half = 512 - MARGIN;
    this.gfx.fill(ROOM).rect(-half, -half, 2 * half, 2 * half)
      .fill(FLOOR).circle(0, 0, RAIL)
      .fill(null).line(8, INK).circle(0, 0, RAIL - 4);
  }

  render(ctx) {
    this.gfx.render(ctx);
    const x = Math.cos(railA) * QUEUE;
    const y = Math.sin(railA) * QUEUE;
    outline(ctx, x, y, QUEUE_R);
    ctx.save();
    ctx.translate(x, y);
    ball(ctx, gun[1], QUEUE_R);
    ctx.restore();
  }
}

// The socket turns with the blob, which is the one place the turn reads when
// the board around it is symmetric.
class Axle extends ent.Entity {
  constructor() {
    super();
    this.pos.x = CX;
    this.pos.y = CY;
    const g = this.gfx.fill(PAPER).line(6, INK).circle(0, 0, AXLE_R - 3)
      .line(null).fill(INK);
    for (let i = 0; i < 6; ++i) {
      const a = i * TAU / 6;
      g.lt(Math.cos(a) * 12, Math.sin(a) * 12);
    }
  }

  update() {
    this.angle = angle;
  }
}

// The line under the whole blob, before any bubble in it is filled.
class Outline extends ent.Entity {
  render(ctx) {
    for (const b of cells.values()) outline(ctx, b.pos.x, b.pos.y, R);
  }
}

class Bubble extends ent.Entity {
  constructor(q, r, color) {
    super();
    this.q = q;
    this.r = r;
    this.color = color;
    this.lx = cellX(q, r);
    this.ly = cellY(q, r);
    cells.set(key(q, r), this);
    this.place();
  }

  place() {
    this.pos.x = CX + this.lx * cosA - this.ly * sinA;
    this.pos.y = CY + this.lx * sinA + this.ly * cosA;
  }

  update() {
    this.place();
  }

  remove() {
    cells.delete(key(this.q, this.r));
    super.remove();
  }

  render(ctx) {
    ball(ctx, this.color, R);
  }
}

// A bubble the blob let go of. It keeps the speed the spin was giving it.
class Drop extends ent.Entity {
  constructor(b) {
    super();
    this.color = b.color;
    this.pos.x = b.pos.x;
    this.pos.y = b.pos.y;
    const dx = this.pos.x - CX;
    const dy = this.pos.y - CY;
    const d = Math.hypot(dx, dy) || 1;
    this.vel.x = dx / d * 140 - dy * omega;
    this.vel.y = dy / d * 140 + dx * omega;
  }

  update() {
    this.accelerate(0, 1600);
    this.alpha = Math.max(0, 1 - this.age);
    if (this.age > 1) this.remove();
  }

  render(ctx) {
    outline(ctx, 0, 0, R);
    ball(ctx, this.color, R);
  }
}

class Shot extends ent.Entity {
  constructor(color, x, y, a) {
    super();
    this.color = color;
    this.pos.x = x;
    this.pos.y = y;
    this.dx = Math.cos(a);
    this.dy = Math.sin(a);
    this.left = BOUNCES;
  }

  // In steps under a radius, so nothing crosses the rail or a bubble between
  // two.
  update() {
    const d = SPEED * ent.game.time;
    const n = Math.ceil(d / R);
    for (let i = 0; i < n && !this.dead; ++i) this.step(d / n);
  }

  step(d) {
    this.pos.x += this.dx * d;
    this.pos.y += this.dy * d;

    let hit = false;
    if (this.pos.x < LOW) {
      this.pos.x = LOW;
      this.dx = -this.dx;
      hit = true;
    } else if (this.pos.x > HIGH) {
      this.pos.x = HIGH;
      this.dx = -this.dx;
      hit = true;
    }
    if (this.pos.y < LOW) {
      this.pos.y = LOW;
      this.dy = -this.dy;
      hit = true;
    } else if (this.pos.y > HIGH) {
      this.pos.y = HIGH;
      this.dy = -this.dy;
      hit = true;
    }

    // A corner is one bounce, not two, which is also what keeps the second
    // axis from flipping a direction the turn below has just set.
    if (hit) {
      play.bounce();
      // Out of banks, so it goes at the axle and takes whatever the blob has
      // turned into its way. It arrives along a radius, so it adds no spin: a
      // shot that found nothing does not get to move the board either.
      if (--this.left < 0) {
        const d = Math.hypot(CX - this.pos.x, CY - this.pos.y) || 1;
        this.dx = (CX - this.pos.x) / d;
        this.dy = (CY - this.pos.y) / d;
      }
    }

    const cell = struck(this.pos.x, this.pos.y);
    if (cell !== null) land(this, cell);
  }

  render(ctx) {
    outline(ctx, 0, 0, R);
    ball(ctx, this.color, R);
  }
}

// The chamber, which turns about its pivot on the rail. `angle` is where the
// shot goes; the carriage under it has no drive of its own.
class Gun extends ent.Entity {
  constructor() {
    super();
    this.off = 0;
    this.gfx.size(2 * 175).fill(PAPER).line(6, INK)
      .arc(0, 0, 40, 28, MOUTH, TAU - MOUTH)
      .line(null).fill(INK, 0.5)
      .circle(85, 0, 6).circle(125, 0, 6).circle(165, 0, 6);
    this.place();
  }

  place() {
    this.pos.x = CX + RAIL * Math.cos(railA);
    this.pos.y = CY + RAIL * Math.sin(railA);
    this.angle = railA + Math.PI + this.off;
  }

  update() {
    const { input, time } = ent.game;
    const moved = input.x !== ptr.x || input.y !== ptr.y;
    ptr.x = input.x;
    ptr.y = input.y;

    if (input.press.left) this.off -= TURN * time;
    else if (input.press.right) this.off += TURN * time;
    else if (moved && aimed) {
      const at = Math.atan2(input.y - this.pos.y, input.x - this.pos.x);
      this.off = fold(at - railA - Math.PI);
    }
    aimed = true;
    this.off = fold(this.off);
    this.place();

    reload = Math.max(0, reload - time);
    if (!input.just.act || reload > 0 || ent.one(Shot) !== null) return;

    new Shot(gun.shift(), this.pos.x, this.pos.y, this.angle);
    gun.push(pick());
    // The shot's momentum across the rail, pushed back into the carriage.
    railV += SPEED * Math.sin(this.off) * RECOIL / RAIL;
    play.shoot();
  }

  render(ctx) {
    this.gfx.render(ctx);
    // The chamber turns and the bubble in it does not: every crescent on the
    // board is on the same side.
    ctx.rotate(-this.angle);
    outline(ctx, 0, 0, R);
    ball(ctx, gun[0], R);
  }
}

// The occupied cell the shot ran into, the axle included.
function struck(x, y) {
  if (Math.hypot(x - CX, y - CY) < R + AXLE_R) return { q: 0, r: 0 };

  let best = null;
  let near = 4 * R * R;
  for (const b of cells.values()) {
    const d = (b.pos.x - x) ** 2 + (b.pos.y - y) ** 2;
    if (d >= near) continue;
    near = d;
    best = b;
  }
  return best;
}

// Where the bubble settles: the free neighbour of what it ran into nearest to
// where it was, and failing that the nearest free edge cell anywhere, so a shot
// that ends up inside a pocket still lands.
function settle(cell, lx, ly) {
  const near = (q, r) => (cellX(q, r) - lx) ** 2 + (cellY(q, r) - ly) ** 2;

  let best = null;
  let d = Infinity;
  for (const [dq, dr] of DIRS) {
    const q = cell.q + dq;
    const r = cell.r + dr;
    if (taken(q, r) || near(q, r) >= d) continue;
    d = near(q, r);
    best = { q, r };
  }
  if (best !== null) return best;

  for (const b of cells.values()) {
    for (const [dq, dr] of DIRS) {
      const q = b.q + dq;
      const r = b.r + dr;
      if (taken(q, r) || near(q, r) >= d) continue;
      d = near(q, r);
      best = { q, r };
    }
  }
  return best;
}

function land(shot, cell) {
  const dx = shot.pos.x - CX;
  const dy = shot.pos.y - CY;
  omega += (dx * shot.dy - dy * shot.dx) * SPEED * SPIN / moment();

  const at = settle(cell, dx * cosA + dy * sinA, dy * cosA - dx * sinA);
  shot.remove();
  reload = RELOAD;
  play.step();
  resolve(new Bubble(at.q, at.r, shot.color));
}

function moment() {
  let m = AXLE_MOMENT;
  for (const b of cells.values()) m += b.lx * b.lx + b.ly * b.ly;
  return m;
}

function resolve(b) {
  const group = same(b);
  if (group.length >= MATCH) {
    pop(group);
    dropLoose();
  }
  if (cells.size === 0) return cleared();
  if (!b.dead && Math.hypot(b.lx, b.ly) > FAR) return lose();
  restock();
}

// Every bubble of one colour touching `b`.
function same(b) {
  const group = [b];
  const seen = new Set([key(b.q, b.r)]);
  for (let i = 0; i < group.length; ++i) {
    for (const [dq, dr] of DIRS) {
      const k = key(group[i].q + dq, group[i].r + dr);
      if (seen.has(k)) continue;
      seen.add(k);
      const n = cells.get(k);
      if (n !== undefined && n.color === b.color) group.push(n);
    }
  }
  return group;
}

function pop(group) {
  // One colour by definition, so the number leaves in it.
  const c = COLORS[group[0].color];
  let cx = 0;
  let cy = 0;
  for (const b of group) {
    cx += b.pos.x / group.length;
    cy += b.pos.y / group.length;
    new ent.Particle({
      x: b.pos.x,
      y: b.pos.y,
      color: c,
      count: 9,
      size: [3, 5],
      speed: [60, 220],
      duration: [0.4, 0.2],
      circle: true,
    });
    b.remove();
  }
  ent.addScore(10 * group.length * board, cx, cy, { color: c });
  play.break();
  shake(0.1 + 0.02 * group.length);
}

// Bubbles the pop cut off the axle: they leave the blob and fall.
function dropLoose() {
  const seen = new Set([key(0, 0)]);
  const queue = [[0, 0]];
  for (let i = 0; i < queue.length; ++i) {
    for (const [dq, dr] of DIRS) {
      const q = queue[i][0] + dq;
      const r = queue[i][1] + dr;
      const k = key(q, r);
      if (seen.has(k) || !cells.has(k)) continue;
      seen.add(k);
      queue.push([q, r]);
    }
  }

  const gone = [...cells.values()].filter((b) => !seen.has(key(b.q, b.r)));
  if (gone.length === 0) return;

  let cx = 0;
  let cy = 0;
  for (const b of gone) {
    cx += b.pos.x / gone.length;
    cy += b.pos.y / gone.length;
    new Drop(b);
    b.remove();
  }
  ent.addScore(20 * gone.length * board, cx, cy);
  play.drop();
}

// The board is empty. The bonus and the sound land on the shot that did it;
// the next board waits for what that shot knocked off to finish falling.
function cleared() {
  ent.addScore(100 * board, CX, CY);
  play.power();
  shake(0.4);
  reload = FALL + 0.6;
  ent.after(FALL, nextBoard);
}

function nextBoard() {
  board += 1;
  colors = Math.min(COLORS.length, 2 + board);
  omega = 0;
  angle = 0;
  cosA = 1;
  sinA = 0;
  build();
  restock();
  // Long enough to read the board that just arrived.
  reload = 0.6;
}

function lose() {
  play.lose();
  shake(0.6);
  gameOver({ score: true });
}

function live() {
  return [...new Set([...cells.values()].map((b) => b.color))];
}

function pick() {
  const on = live();
  return on.length === 0 ? 0 : on[Math.floor(on.length * Math.random())];
}

// A colour the last shot took off the board is no colour to be handed.
function restock() {
  const on = live();
  if (on.length === 0) return;
  gun = gun.map((c) =>
    on.includes(c) ? c : on[Math.floor(on.length * Math.random())]
  );
}

// Hex distance 2 whole and distance 3 ragged, so no two boards present the same
// edge to aim at.
function build() {
  for (let q = -3; q <= 3; ++q) {
    for (let r = -3; r <= 3; ++r) {
      const d = (Math.abs(q) + Math.abs(q + r) + Math.abs(r)) / 2;
      if (d === 0 || d > 3) continue;
      if (d === 3 && Math.random() > 0.4) continue;
      new Bubble(q, r, Math.floor(colors * Math.random()));
    }
  }
}

export function init() {
  ent.reset([Rail, Gun, Axle, Outline, Bubble, Drop, Shot]);
  cells.clear();

  angle = 0;
  omega = 0;
  cosA = 1;
  sinA = 0;
  railA = -Math.PI / 2;
  railV = 0;
  board = 1;
  colors = 3;
  reload = 0;
  aimed = false;

  build();
  gun = [pick(), pick()];
  new Rail();
  new Axle();
  new Gun();
  new Outline();
}

export function update(dt) {
  omega *= Math.exp(-DRAG * dt);
  angle += omega * dt;
  cosA = Math.cos(angle);
  sinA = Math.sin(angle);

  railV *= Math.exp(-RAIL_DRAG * dt);
  railA += railV * dt;

  ent.update(dt);
}
