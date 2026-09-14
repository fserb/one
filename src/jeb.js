/*
 * jeb - "Jebediah's Revenge".
 *
 * The green line out of the nose is where you go if you do nothing, drawn AHEAD
 * seconds ahead through the same gravity.
 *
 * The landing rule is the whole of it: over CRASH is a crash, more than a
 * quarter turn off the upright of where you touched down is a crash, otherwise
 * the ship stops and snaps to the vertical. The second is the one that gets
 * you, because rotating is slow.
 *
 * That rule runs on arrival and not on every frame of contact: re-snapping the
 * angle every frame leaves no way to point the nose before lifting off. A
 * landed ship is put back on the surface, except while it is being destroyed,
 * or a frame of thrust moves it less than the resting rule puts back.
 *
 * Gravity is every planet at once, so the force does not jump when the nearest
 * changes. MU is per unit of radius squared, so every planet has the same
 * gravity at its surface, and THRUST is chosen against that.
 */

import * as ent from "./lib/entity.js";
import { shake } from "./lib/camera.js";
import { gameOver, score } from "./lib/one.js";
import { blip, explosion, powerup } from "./lib/sfxr.js";
import * as sound from "./lib/sound.js";

export const meta = {
  title: "jeb",
  desc: `
land on the lit planet, slow and upright
drag to aim the nose, hold to burn
`,
  bg: "#000000",
  fg: "#EEB62F",
  scoreMax: true,
  date: "2014-03-30",
};

// Where the ship is fixed on the board.
const EYEX = 512;
const EYEY = 512;

// A planet is drawn as a large-pixel circle PX units to the pixel, so its
// radius is PX times its own cell count.
const WORLD = 2350;
const EDGE = 280;
const PLANETS = 6;
const GAP = 320;
const PX = 9;
const CELL_MIN = 6;
const CELL_MAX = 11;

// Per unit of radius squared, so the surface pull is the same on every planet;
// an actual planet pulls MU*r*r/d/d. 680 of thrust against a surface pull of
// 256 leaves the ground at 424, so take-off is not most of a tank.
const MU = 256;
const THRUST = 680;
const TURN = Math.PI;
const CRASH = 132;
const TILT = Math.PI / 4;

// One pointer has to aim and burn, so AIM_LAG separates them: a lander that
// cannot turn without firing cannot be landed.
const SHIP_R = 18;
const DEAD = 21;
const AIM_LAG = 0.18;

// REFILL_OFF is the whole of the ramp: the drain and the burn stay fixed, and a
// run ends when a tankful stops covering the trip.
const TANK = 100;
const START = 90;
const LIFE = 2.2;
const BURN = 7;
const FILL = 54;
const FILL_OFF = 3.5;
const FILL_MIN = 12;

// STEP is entity.js's own integration at 30Hz, so the line draws what the ship
// does, near enough.
const AHEAD = 7;
const STEP = 1 / 30;

// The patch tiles, so there are stars wherever the ship goes. Nothing stops you
// leaving the system, and out there the stars and the arrow are all that shows
// which way is back.
const PATCH = 1500;
const STARS = 150;
const STAR = 3.4;

const BAR_Y = 1024 - 28;
const BAR_H = 11;
const BAR_PAD = 64;
const ARROW = 21;

const DEATH = 0.7;

// Arne's palette.
const GREY = 0x697175;
const DARKGREEN = 0x2f484e;
const GREEN = 0x44891a;
const BROWN = 0xeeb62f;
const RED = 0xbe2633;
const PURPLE = 0x342a97;
const STARLIGHT = 0x3c3c46;
const LINE = "#44891a";
const LINE_BAD = "#be2633";

sound.voice("burn", { ...blip(511), vol: 0.05 });
sound.voice("land", { ...powerup(3607), vol: 0.13 });
sound.voice("crash", { ...explosion(3613), vol: 0.2 });

let ship = null;
// Not read back out of entity.js: ent.get() hides entities that have not begun,
// which is all of them while init() runs, and predict() asks two hundred times
// a frame.
const planets = [];
let target = null;
let fuel = 0;
let dying = 0;
const stars = [];
// Rebuilt every frame as a flat list of world x, y.
const path = [];
let lands = false;
let landsAt = 0;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Signed, in [-PI, PI). JS's % keeps the sign of its left side, so the usual
// one-liner gives three quarters of a turn for a quarter turn once enough left
// turns have taken `angle` below -3*PI.
function apart(a, b) {
  const d = (a - b) % (2 * Math.PI);
  if (d < -Math.PI) return d + 2 * Math.PI;
  if (d >= Math.PI) return d - 2 * Math.PI;
  return d;
}

// Its mass is its radius squared, so a big planet is a bigger target with a
// longer range and never a heavier surface to leave.
class Planet extends ent.Entity {
  constructor(x, y, cells) {
    super();
    this.pos.x = x;
    this.pos.y = y;
    this.r = PX * cells;
    this.gm = MU * this.r * this.r;
    this.lit = false;
    this.cells = cells;
    this.paint();
  }

  paint() {
    this.gfx.clear().fill(this.lit ? BROWN : PURPLE).circle(0, 0, this.r);
  }

  light(on) {
    if (on === this.lit) return;
    this.lit = on;
    this.paint();
  }
}

// The pull of the whole system at a point, added into (out.x, out.y).
function gravity(x, y, out) {
  out.x = 0;
  out.y = 0;
  for (const p of planets) {
    const dx = p.pos.x - x;
    const dy = p.pos.y - y;
    const d2 = dx * dx + dy * dy;
    const d = Math.sqrt(d2);
    const a = p.gm / (d2 * d);
    out.x += dx * a;
    out.y += dy * a;
  }
}

const pull = { x: 0, y: 0 };

class Ship extends ent.Entity {
  constructor(p) {
    super();
    // The sprite's nose is -y at angle 0, so upright on top is zero.
    this.pos.x = p.pos.x;
    this.pos.y = p.pos.y - p.r - SHIP_R;
    this.landed = p;
    this.burning = false;
    this.puff = 0;
    this.pressed = 0;
    this.gfx.size(45, 45)
      .fill(GREY).mt(-9, -22).lt(9, -22).lt(20, -4).lt(20, 12).lt(-20, 12)
      .lt(-20, -4)
      .fill(GREEN).line(4, DARKGREEN).circle(0, -5, 7)
      .fill(BROWN).line(null).rect(-15, 9, 30, 11, 6)
      .rect(-20, 16, 6, 6).rect(14, 16, 6, 6);
  }

  update() {
    if (dying > 0) return;
    const t = ent.game.time;
    const { input } = ent.game;

    this.pressed = input.press.act ? this.pressed + t : 0;
    const aiming = pointerMoved() || input.press.act;

    let want = null;
    if (input.press.left) this.angle -= TURN * t;
    if (input.press.right) this.angle += TURN * t;
    if (!input.press.left && !input.press.right && aiming) {
      const dx = input.x - EYEX;
      const dy = input.y - EYEY;
      if (Math.hypot(dx, dy) > DEAD) want = Math.atan2(dy, dx) + Math.PI / 2;
    }
    if (want !== null) {
      const d = apart(want, this.angle);
      const r = TURN * t;
      this.angle += Math.abs(d) <= r ? d : Math.sign(d) * r;
    }
    this.angle = apart(this.angle, 0);

    this.burning = fuel > 0 &&
      (input.press.up || (input.press.act && this.pressed > AIM_LAG));
    if (this.burning) {
      // The nose is -y at angle 0, so the push is a quarter turn back.
      const a = this.angle - Math.PI / 2;
      this.accelerate(Math.cos(a) * THRUST, Math.sin(a) * THRUST);
      this.exhaust(t, a);
    }

    gravity(this.pos.x, this.pos.y, pull);
    this.accelerate(pull.x, pull.y);
  }

  exhaust(t, a) {
    this.puff -= t;
    if (this.puff > 0) return;
    this.puff = 0.05;
    sound.play("burn", { detune: -4 + 8 * Math.random() });
    new ent.Particle({
      x: this.pos.x - Math.cos(a) * 26,
      y: this.pos.y - Math.sin(a) * 26,
      color: BROWN,
      count: 3,
      size: 6,
      speed: [128, 64],
      direction: [a + Math.PI - 0.4, 0.8],
      duration: [0.4, 0.2],
    });
  }

  postUpdate() {
    if (dying > 0) return;
    for (const p of planets) {
      const dx = this.pos.x - p.pos.x;
      const dy = this.pos.y - p.pos.y;
      const d = Math.hypot(dx, dy);
      if (d > p.r + SHIP_R) continue;
      const nx = dx / d;
      const ny = dy / d;

      // Without this the ship can never leave: a frame of thrust moves it a
      // fraction of a unit and the resting rule below puts it back.
      const a = this.angle - Math.PI / 2;
      if (
        this.landed === p && this.burning &&
        Math.cos(a) * nx + Math.sin(a) * ny > 0
      ) {
        return;
      }
      this.touch(p, nx, ny);
      return;
    }
    this.landed = null;
  }

  // On arrival only: running it every frame of contact holds a resting ship
  // upright and leaves no way to point the nose before lifting off.
  touch(p, nx, ny) {
    const up = Math.atan2(ny, nx) + Math.PI / 2;
    if (this.landed !== p) {
      if (Math.hypot(this.vel.x, this.vel.y) > CRASH) {
        wreck();
        return;
      }
      if (Math.abs(apart(this.angle, up)) > TILT) {
        wreck();
        return;
      }
      this.angle = apart(up, 0);
      this.landed = p;
      if (p === target) arrive(p);
    }

    this.pos.x = p.pos.x + nx * (p.r + SHIP_R);
    this.pos.y = p.pos.y + ny * (p.r + SHIP_R);
    this.vel.x = this.vel.y = 0;
  }
}

function wreck() {
  if (dying > 0) return;
  dying = DEATH;
  shake(0.5);
  sound.play("crash");
  new ent.Particle({
    x: ship.pos.x,
    y: ship.pos.y,
    color: GREY,
    count: 90,
    size: 6,
    speed: [64, 190],
    duration: [0.7, 0.5],
  });
  new ent.Particle({
    x: ship.pos.x,
    y: ship.pos.y,
    color: RED,
    count: 40,
    size: 9,
    speed: [43, 128],
    duration: [0.5, 0.4],
  });
}

function arrive(p) {
  score.value += 1;
  fuel = Math.min(TANK, fuel + Math.max(FILL_MIN, FILL - FILL_OFF * score.value));
  sound.play("land");
  new ent.Particle({
    x: ship.pos.x,
    y: ship.pos.y,
    color: BROWN,
    count: 24,
    size: 4,
    speed: [150, 85],
    duration: [0.5, 0.3],
  });
  pickTarget(p);
}

// The furthest of a sample from the one just left, so there is a trip in it.
function pickTarget(from) {
  const all = planets.filter((p) => p !== from);
  if (all.length === 0) return;
  let best = all[0];
  let far = -1;
  for (const p of all) {
    const d = Math.hypot(p.pos.x - from.pos.x, p.pos.y - from.pos.y) *
      (0.6 + 0.8 * Math.random());
    if (d <= far) continue;
    far = d;
    best = p;
  }
  target?.light(false);
  target = best;
  target.light(true);
}

// Failing to place one is fine, the system is just smaller, and the tries are
// capped because a run of unlucky rolls can take a while to find the last spot.
function makeSystem() {
  planets.length = 0;
  for (let n = 0; n < 400 && planets.length < PLANETS; ++n) {
    const cells = CELL_MIN +
      Math.floor((CELL_MAX - CELL_MIN + 1) * Math.random());
    const r = PX * cells;
    const x = EDGE + (WORLD - 2 * EDGE) * Math.random();
    const y = EDGE + (WORLD - 2 * EDGE) * Math.random();
    let ok = true;
    for (const p of planets) {
      if (Math.hypot(p.pos.x - x, p.pos.y - y) > GAP + r + p.r) continue;
      ok = false;
      break;
    }
    if (ok) planets.push(new Planet(x, y, cells));
  }
}

function makeStars() {
  stars.length = 0;
  for (let i = 0; i < STARS; ++i) {
    stars.push(
      PATCH * Math.random(),
      PATCH * Math.random(),
      STAR * (0.5 + Math.random()),
    );
  }
}

// AHEAD seconds of coasting, stepped the way entity.js steps, stopping at the
// first planet it would touch.
function predict() {
  path.length = 0;
  lands = false;
  let x = ship.pos.x;
  let y = ship.pos.y;
  let vx = ship.vel.x;
  let vy = ship.vel.y;
  for (let t = 0; t < AHEAD; t += STEP) {
    gravity(x, y, pull);
    const ax = pull.x * STEP;
    const ay = pull.y * STEP;
    x += STEP * (vx + ax / 2);
    y += STEP * (vy + ay / 2);
    vx += ax;
    vy += ay;
    path.push(x, y);
    for (const p of planets) {
      if (Math.hypot(x - p.pos.x, y - p.pos.y) > p.r + SHIP_R) continue;
      lands = true;
      landsAt = Math.hypot(vx, vy);
      return;
    }
  }
}

export function init() {
  ent.reset([Planet, Ship]);

  makeSystem();
  makeStars();
  const home = planets[0];
  ship = new Ship(home);
  target = null;
  pickTarget(home);
  fuel = START;
  dying = 0;
  lastx = null;
  path.length = 0;
}

export function update(dt) {
  ent.update(dt);
  const t = ent.game.time;

  if (dying > 0) {
    if ((dying -= t) <= 0) gameOver({ score: true });
    return;
  }

  fuel -= (LIFE + (ship.burning ? BURN : 0)) * t;
  predict();
  if (fuel > 0) return;
  fuel = 0;
  expire();
}

function expire() {
  if (dying > 0) return;
  dying = DEATH;
  sound.play("crash", { detune: -8 });
  new ent.Particle({
    x: ship.pos.x,
    y: ship.pos.y,
    color: GREY,
    count: 24,
    size: 4,
    speed: [21, 55],
    duration: [0.8, 0.4],
  });
}

// What shows a mouse is in use: on a mouse the nose aims without firing, and on
// a finger there is no pointer except while it is down.
let lastx = null;
let lasty = 0;

function pointerMoved() {
  const { input } = ent.game;
  const moved = lastx !== null && (input.x !== lastx || input.y !== lasty);
  lastx = input.x;
  lasty = input.y;
  return moved;
}

export function render(ctx) {
  const ox = EYEX - ship.pos.x;
  const oy = EYEY - ship.pos.y;

  ctx.save();
  ctx.translate(ox, oy);
  drawStars(ctx);
  drawPath(ctx);
  ent.render(ctx);
  ctx.restore();

  // Outside the scroll: both are on the board rather than in the system.
  drawArrow(ctx, ox, oy);
  drawTank(ctx);
}

function drawStars(ctx) {
  ctx.fillStyle = ent.css(STARLIGHT);
  const x0 = ship.pos.x - EYEX;
  const y0 = ship.pos.y - EYEY;
  const i0 = Math.floor(x0 / PATCH);
  const j0 = Math.floor(y0 / PATCH);
  for (let j = j0; j <= Math.floor((y0 + 1024) / PATCH); ++j) {
    for (let i = i0; i <= Math.floor((x0 + 1024) / PATCH); ++i) {
      const ox = i * PATCH;
      const oy = j * PATCH;
      for (let n = 0; n < stars.length; n += 3) {
        const x = ox + stars[n];
        const y = oy + stars[n + 1];
        if (x < x0 || y < y0 || x > x0 + 1024 || y > y0 + 1024) continue;
        const s = stars[n + 2];
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
    }
  }
}

function drawPath(ctx) {
  if (path.length < 4 || dying > 0) return;
  const bad = lands && landsAt > CRASH;
  ctx.strokeStyle = bad ? LINE_BAD : LINE;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ship.pos.x, ship.pos.y);
  for (let i = 0; i < path.length; i += 2) ctx.lineTo(path[i], path[i + 1]);
  ctx.stroke();

  const n = path.length;
  const r = lands ? 6 : 4;
  ctx.globalAlpha = lands ? 0.9 : 0.5;
  ctx.fillStyle = bad ? LINE_BAD : LINE;
  ctx.fillRect(path[n - 2] - r, path[n - 1] - r, 2 * r, 2 * r);
  ctx.globalAlpha = 1;
}

// An arrow at the edge when the lit planet is off screen.
function drawArrow(ctx, ox, oy) {
  if (target === null || dying > 0) return;
  const sx = target.pos.x + ox;
  const sy = target.pos.y + oy;
  if (
    sx > -target.r && sy > -target.r && sx < 1024 + target.r &&
    sy < 1024 + target.r
  ) {
    return;
  }

  ctx.save();
  ctx.translate(
    clamp(sx, ARROW, 1024 - ARROW),
    clamp(sy, ARROW, 1024 - ARROW - 43),
  );
  ctx.rotate(Math.atan2(sy - EYEY, sx - EYEX));
  ctx.fillStyle = ent.css(BROWN);
  ctx.beginPath();
  ctx.moveTo(-ARROW / 2, -ARROW / 2);
  ctx.lineTo(ARROW / 2, 0);
  ctx.lineTo(-ARROW / 2, ARROW / 2);
  ctx.fill();
  ctx.restore();
}

function drawTank(ctx) {
  const w = 1024 - 2 * BAR_PAD;
  ctx.fillStyle = ent.css(0x222222);
  ctx.fillRect(BAR_PAD, BAR_Y, w, BAR_H);
  ctx.fillStyle = ent.css(fuel >= 15 ? BROWN : RED);
  ctx.fillRect(BAR_PAD, BAR_Y, w * clamp(fuel / TANK, 0, 1), BAR_H);
}
