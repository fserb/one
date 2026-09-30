// spinner. A bubble shooter where the blob turns on its axle and the gun rides a
// rail around it.

import * as ent from "./lib/entity.js";
import * as ease from "./alma/src/ease.js";
import { shake } from "./lib/camera.js";
import { fold, gameOver } from "./lib/one.js";
import * as play from "./lib/sounds.js";

export { render } from "./lib/entity.js";

export const meta = {
  title: "spinner",
  bg: "#BFB09A",
  fg: "#1A1712",
  scoreMax: true,
  release: true,
  date: "2026-09-21",
  dpad: true,
};

const TAU = 2 * Math.PI;

const EDGE = 0x2a2419;
const ROOM = 0xcdbfa6;
const FLOOR = 0xd8cbb4;
const TRACK = 0xc0b09b;
const INK = 0x1a1712;
const PAPER = 0xfff8ea;
const HUB = 0xbfb09a;

// The six a bubble can be. Board one is played with the first three, so those
// are the three furthest apart. Each one is saturated and none is near INK: a
// bubble that close to the line reads as a hole cut in the board.
const COLORS = [0xf2483f, 0xf5a623, 0x35b8e8, 0x4fbf52, 0xf25a9e, 0x8f6ae0];

const R = 30;
const STEP = 2 * R;
const ROW = STEP * Math.sqrt(3) / 2;

const CX = 512;
const CY = 512;
const MARGIN = 22;
const LOW = MARGIN + R;
const HIGH = 1024 - MARGIN - R;
// With the gun pointing straight out, the next ball's cup stops one short of
// the wall.
const RAIL = 418;
const QUEUE = 50;
const QUEUE_R = 12;
const LIP = 9;
// A cell centre past this leaves 72 between that bubble and a shot leaving the
// chamber, which is 2R and a little. Hex distance 5
// reaches 300 at its furthest and 6 runs from 312 to 360, so the blob fills
// five rings and keeps whichever part of the sixth it is turned to.
const FAR = 346;

const TURN = 1.6;
const MOUTH = 0.7; // the half-angle the chamber is open over

const SPEED = 1400;
const BOUNCES = 5;
const RELOAD = 0.15;
const FEED = 0.15;

const SPIN = 2.5;
const DRAG = 0.6;
const AXLE_MOMENT = 5e4;
const AXLE_R = 28;

// Together these carry the gun 110 degrees on the widest shot and none on a
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
let railA = -Math.PI / 2;
let railV = 0;
let board = 1;
let colors = 3;
let gun = [];
let reload = 0;
let feed = 0;

const key = (q, r) => `${q},${r}`;
const cellX = (q, r) => STEP * (q + r / 2);
const cellY = (_q, r) => ROW * r;
const taken = (q, r) => (q === 0 && r === 0) || cells.has(key(q, r));

const LX = -0.645;
const LY = -0.764;
const LA = Math.atan2(LY, LX);
const CUT = 1.18;
const SHINE = 0.62;
const SHINE_W = 0.17;

// Every ball's outline goes down before any ball is filled. Drawn per ball, the
// outline of the one next door lands on this one's colour and the two read as
// separate discs rather than one sheet.
function outline(ctx, x, y, r, cut = CUT) {
  ctx.fillStyle = ent.css(INK);
  ctx.beginPath();
  ctx.arc(x, y, r * cut, 0, TAU);
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

// FAR is not drawn: a ring 42 inside the track reads as one mark with it.
class Rail extends ent.Entity {
  constructor() {
    super();
    this.pos.x = CX;
    this.pos.y = CY;
    const half = 512 - MARGIN;
    this.gfx.fill(EDGE).rect(-512, -512, 1024, 1024)
      .fill(ROOM).rect(-half, -half, 2 * half, 2 * half)
      .fill(FLOOR).circle(0, 0, RAIL)
      .fill(null).line(8, TRACK).circle(0, 0, RAIL - 4);
  }
}

class Axle extends ent.Entity {
  constructor() {
    super();
    this.pos.x = CX;
    this.pos.y = CY;
    const g = this.gfx.fill(HUB).line(6, INK).circle(0, 0, AXLE_R - 3)
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

  // A ring and not a disc: the drop fades, and a disc under it would show
  // through and darken it. One inside the ball's edge, so no floor shows in the
  // seam.
  render(ctx) {
    const w = R * (CUT - 1) + 1;
    ctx.strokeStyle = ent.css(INK);
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(0, 0, R * CUT - w / 2, 0, TAU);
    ctx.stroke();
    ball(ctx, this.color, R);
  }
}

class Shot extends ent.Entity {
  constructor(color, x, y, a) {
    super();
    this.color = color;
    this.pos.x = x;
    this.pos.y = y;
    this.dir = { x: Math.cos(a), y: Math.sin(a) };
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
    this.pos.x += this.dir.x * d;
    this.pos.y += this.dir.y * d;

    // Flat walls and never the round rail: a bounce inside a circle keeps the
    // shot line's distance from the middle, so a bank off it could never aim
    // the shot in.
    let hit = false;
    for (const k of ["x", "y"]) {
      const p = Math.min(HIGH, Math.max(LOW, this.pos[k]));
      if (p === this.pos[k]) continue;
      this.pos[k] = p;
      this.dir[k] = -this.dir[k];
      hit = true;
    }

    // A corner is one bounce, not two, which is also what keeps the second
    // axis from flipping a direction the turn below has just set.
    if (hit) {
      play.bounce();
      // Out of banks: it goes at the axle along a radius, so a shot that found
      // nothing adds no spin.
      if (--this.left < 0) {
        const d = Math.hypot(CX - this.pos.x, CY - this.pos.y) || 1;
        this.dir.x = (CX - this.pos.x) / d;
        this.dir.y = (CY - this.pos.y) / d;
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

class Gun extends ent.Entity {
  constructor() {
    super();
    this.off = 0;
    // The first frame only records where the pointer is, so a round does not
    // open by swinging the gun at wherever it was left.
    this.ptr = null;
    this.gfx.size(2 * 175).fill(PAPER)
      .arc(0, 0, R * CUT + LIP, 20, MOUTH, TAU - MOUTH)
      .circle(-QUEUE, 0, QUEUE_R + LIP)
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
    const last = this.ptr;
    this.ptr = { x: input.x, y: input.y };

    if (input.press.left) this.off -= TURN * time;
    else if (input.press.right) this.off += TURN * time;
    else if (last && (input.x !== last.x || input.y !== last.y)) {
      const at = Math.atan2(input.y - this.pos.y, input.x - this.pos.x);
      this.off = fold(at - railA - Math.PI);
    }
    this.off = fold(this.off);
    this.place();

    reload = Math.max(0, reload - time);
    feed = Math.max(0, feed - time);
    if (!input.just.act || reload > 0 || feed > 0 || ent.one(Shot)) return;

    new Shot(gun.shift(), this.pos.x, this.pos.y, this.angle);
    gun.push(pick());
    feed = FEED;
    railV += SPEED * Math.sin(this.off) * RECOIL / RAIL;
    play.shoot();
  }

  render(ctx) {
    this.gfx.render(ctx);
    // The balls do not turn with the gun, so every crescent is on the same side.
    const a = this.angle;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    ctx.rotate(-a);

    const t = ease.cubicOut(1 - feed / FEED);
    const r = QUEUE_R + (R - QUEUE_R) * t;
    const back = -QUEUE * (1 - t);
    ctx.translate(back * cos, back * sin);
    outline(ctx, 0, 0, r, 1 + (CUT - 1) * t);
    ball(ctx, gun[0], r);

    ctx.translate((-QUEUE - back) * cos, (-QUEUE - back) * sin);
    ball(ctx, gun[1], QUEUE_R * t);
  }
}

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

// Failing a free neighbour, the nearest free cell anywhere, so a shot that ends
// up inside a pocket still lands.
function settle(cell, lx, ly) {
  const near = (q, r) => (cellX(q, r) - lx) ** 2 + (cellY(q, r) - ly) ** 2;

  let best = null;
  let d = Infinity;
  const consider = (q, r) => {
    if (taken(q, r) || near(q, r) >= d) return;
    d = near(q, r);
    best = { q, r };
  };
  for (const [dq, dr] of DIRS) consider(cell.q + dq, cell.r + dr);
  if (best !== null) return best;

  for (const b of cells.values()) {
    for (const [dq, dr] of DIRS) consider(b.q + dq, b.r + dr);
  }
  return best;
}

function land(shot, cell) {
  const dx = shot.pos.x - CX;
  const dy = shot.pos.y - CY;
  omega += (dx * shot.dir.y - dy * shot.dir.x) * SPEED * SPIN / moment();

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
  const group = [...flood(b.q, b.r, (n) => n?.color === b.color)]
    .map((k) => cells.get(k));
  if (group.length >= MATCH) {
    pop(group);
    dropLoose();
  }
  if (cells.size === 0) return cleared();
  if (!b.dead && Math.hypot(b.lx, b.ly) > FAR) return lose();
  restock();
}

function flood(q, r, keep) {
  const seen = new Set([key(q, r)]);
  const queue = [[q, r]];
  for (let i = 0; i < queue.length; ++i) {
    for (const [dq, dr] of DIRS) {
      const at = [queue[i][0] + dq, queue[i][1] + dr];
      const k = key(...at);
      if (seen.has(k) || !keep(cells.get(k))) continue;
      seen.add(k);
      queue.push(at);
    }
  }
  return seen;
}

function mid(list) {
  let x = 0;
  let y = 0;
  for (const b of list) {
    x += b.pos.x / list.length;
    y += b.pos.y / list.length;
  }
  return { x, y };
}

function pop(group) {
  const c = COLORS[group[0].color];
  const { x, y } = mid(group);
  for (const b of group) {
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
  ent.addScore(10 * group.length * board, x, y, { color: c });
  play.break();
  shake(0.1 + 0.02 * group.length);
}

function dropLoose() {
  const seen = flood(0, 0, (n) => n !== undefined);
  const gone = [...cells.values()].filter((b) => !seen.has(key(b.q, b.r)));
  if (gone.length === 0) return;

  const { x, y } = mid(gone);
  for (const b of gone) {
    new Drop(b);
    b.remove();
  }
  ent.addScore(20 * gone.length * board, x, y);
  play.drop();
}

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

function restock() {
  const on = live();
  if (on.length === 0) return;
  gun = gun.map((c) => on.includes(c) ? c : pick());
}

// Distance 3 ragged, so no two boards present the same edge.
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

  railA = -Math.PI / 2;
  railV = 0;
  board = 0;
  feed = 0;
  gun = [];
  nextBoard();
  gun = [pick(), pick()];
  reload = 0;
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
