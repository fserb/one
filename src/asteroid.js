/*
 * asteroid - "Super Hot Asteroid", April 2014. Atari's Asteroids combined with
 * SUPERHOT.
 *
 * Time runs at a fiftieth of its speed unless you are thrusting or shooting.
 * Turning always runs at real time, so a frozen board is a place to aim from,
 * and the score is seconds of running clock plus 2 a rock and 10 a ship.
 *
 * Both spawn clocks are divided by one.js's ramp read on that running clock and
 * not on the wall clock, so aiming from a frozen board costs nothing.
 *
 * Both ships collide as their own triangle: at a fiftieth speed you watch the
 * bullet arrive and can see which. entity.js gained hitPoly() for this game.
 */

import * as ent from "./lib/entity.js";
import { shake } from "./lib/camera.js";
import { gameOver, ramp, score } from "./lib/one.js";
import * as play from "./lib/sounds.js";

export { render } from "./lib/entity.js";

export const meta = {
  title: "asteroid",
  desc: `
arrows fly the ship, space shoots
time crawls until you thrust or shoot
`,
  bg: "#BF1B25",
  fg: "#FFFFFF",
  scoreMax: true,
  date: "2014-04-03",
  dpad: true,
};

const WHITE = 0xffffff;
const BLACK = 0x000000;

const TAU = 2 * Math.PI;

const FLIP_GAP = 256;

// dart()'s shape, moved from the corner of the sprite's 52x52 box onto the
// centre it is drawn about.
const SHIP = [-26, -26, 26, 0, -26, 26];
const MUZZLE = 21;

const TURN = 1.5 * Math.PI;
const THRUST = 425;
const TOP_SPEED = 425;
// Nothing clamps it, so firing over your shoulder is the one way past
// TOP_SPEED.
const RECOIL = 75;

const SHOT = [-15, -6, 15, -6, 15, 6, -15, 6];
const SHOT_SPEED = 640;

// Only a rock this big splits, so the halves it leaves are the end of it.
const ROCK_MIN = 64;
const ROCK_SPEED = 215;

const CONE = Math.PI / 6;

let realtime = 0;
// Seconds of running clock: the ramp is read off this, not off one.js's `time`.
let clock = 0;
let rockTime = 0;
let waveTime = 0;
let wave = 1;
// Not off ent.get(): one made this frame has not begun.
let alive = 0;
let dying = 0;
let flip = false;
let flipTime = 0;
let flipped = [];

class Player extends ent.Entity {
  begin() {
    this.pos.x = 512;
    this.pos.y = 512;
    this.reload = 0;
    dart(this, WHITE);
    this.hitPoly(SHIP);
  }

  update() {
    const { input, time } = ent.game;

    // The one control that runs at real time: aiming is free.
    if (input.press.left) this.angle -= TURN * realtime;
    if (input.press.right) this.angle += TURN * realtime;
    if (input.press.up) thrust(this, THRUST * time);

    this.reload = Math.max(0, this.reload - time);
    if (input.press.act && this.reload <= 0) {
      fire(this, true, play.shoot);
      this.reload += 0.35;
    }

    wrap(this, 26);

    const b = incoming(this, false);
    if (b === null) return;
    b.remove();
    explode(this);
  }
}

class Bullet extends ent.Entity {
  // In the constructor, not begin(): it leaves along the firer's heading at the
  // moment of firing, and by the next frame an enemy has turned off it.
  constructor(src, fromPlayer) {
    super();
    this.fromPlayer = fromPlayer;
    this.angle = src.angle;
    this.life = 2;
    this.pos.x = src.pos.x + MUZZLE * Math.cos(this.angle);
    this.pos.y = src.pos.y + MUZZLE * Math.sin(this.angle);
    this.vel.x = SHOT_SPEED * Math.cos(this.angle);
    this.vel.y = SHOT_SPEED * Math.sin(this.angle);
    this.hitPoly(SHOT);
    this.gfx.fill(fromPlayer ? WHITE : BLACK)
      .mt(0, 6).lt(21, 0).lt(30, 0).lt(30, 12).lt(21, 12).lt(0, 6);
  }

  update() {
    this.life -= ent.game.time;
    if (this.life < 0) return this.remove();

    wrap(this, 0);

    // The only response to a bullet on its way that does not cost clock time.
    for (const b of ent.get(Bullet)) {
      if (b.fromPlayer === this.fromPlayer || !this.hit(b)) continue;
      play.hit();
      b.remove();
      this.remove();
      return;
    }
  }
}

// What the wave clock counts.
class Target extends ent.Entity {
  constructor() {
    super();
    alive += 1;
  }

  remove() {
    if (!this.dead) alive -= 1;
    super.remove();
  }
}

class Rock extends Target {
  // A fresh rock drifts in off an edge, a split one is placed by its parent.
  constructor(size, x, y, angle, speed) {
    super();
    this.size = size;
    this.pos.x = x;
    this.pos.y = y;
    this.vel.x = speed * Math.cos(angle);
    this.vel.y = speed * Math.sin(angle);
    this.hitCircle(size);
    this.gfx.fill(BLACK).circle(0, 0, size);
  }

  update() {
    const b = incoming(this, true);
    if (b !== null) {
      b.remove();
      this.remove();
      shake();
      play.explode();
      ent.addScore(2, this.pos.x, this.pos.y);
      new ent.Particle({
        x: this.pos.x,
        y: this.pos.y,
        color: BLACK,
        count: [2 * this.size, this.size],
        size: [9, this.size / 2],
        speed: [0, 215],
        duration: [1.5, 0.5],
      });

      // Sideways to the shot, so a rock opens along the line you fired down.
      if (this.size >= ROCK_MIN) {
        const half = this.size / 2;
        split(this.pos, half, b.angle + Math.PI / 2);
        split(this.pos, half, b.angle - Math.PI / 2);
      }
      return;
    }

    const p = ent.one(Player);
    if (p !== null && this.hit(p)) explode(p);

    wrap(this, 2 * this.size);
  }
}

class Enemy extends Target {
  begin() {
    dart(this, BLACK);
    this.hitPoly(SHIP);
    this.reload = 1.5;

    if (Math.random() < 0.5) {
      this.pos.x = 1024 * Math.random();
      this.pos.y = Math.random() < 0.5 ? 0 : 1024;
    } else {
      this.pos.x = Math.random() < 0.5 ? 0 : 1024;
      this.pos.y = 1024 * Math.random();
    }

    this.findTarget();
    const { x, y } = this.target;
    this.angle = Math.atan2(y - this.pos.y, x - this.pos.x);
  }

  // Pulled towards the player by age: a fresh ship wanders, one ten seconds old
  // flies three quarters of the way at you.
  findTarget() {
    const x = 1024 * Math.random();
    const y = 1024 * Math.random();
    const p = ent.one(Player);
    if (p === null) {
      this.target = { x, y };
      return;
    }
    const w = 1 - Math.min(0.75, this.age / 10);
    this.target = {
      x: w * x + (1 - w) * p.pos.x,
      y: w * y + (1 - w) * p.pos.y,
    };
  }

  update() {
    const { time } = ent.game;
    const tx = this.target.x - this.pos.x;
    const ty = this.target.y - this.pos.y;
    if (Math.hypot(tx, ty) < 68) this.findTarget();

    const p = ent.one(Player);
    const speed = Math.hypot(this.vel.x, this.vel.y);
    const toPlayer = p === null
      ? 0
      : Math.atan2(p.pos.y - this.pos.y, p.pos.x - this.pos.x);

    // Over 215 it stops steering and aims; under 43 it thrusts as it points.
    if (
      p !== null && speed >= 215 &&
      between(tx, ty, this.vel.x, this.vel.y) <= CONE
    ) {
      steer(this, toPlayer, Math.PI);
    } else {
      let dx = tx;
      let dy = ty;
      if (speed > 0 && this.vel.x * tx + this.vel.y * ty > 0) {
        // Mirror the heading about the line to the target, so a drift one way
        // is answered by as much push the other. The overshoot is the weave.
        const l = Math.hypot(tx, ty);
        const nx = tx / l;
        const ny = ty / l;
        const k = 2 * (this.vel.x * nx + this.vel.y * ny);
        dx = k * nx - this.vel.x;
        dy = k * ny - this.vel.y;
      } else if (speed > 0) {
        dx = -this.vel.x;
        dy = -this.vel.y;
      }

      const off = steer(this, Math.atan2(dy, dx), 1.5 * Math.PI);
      if (off < CONE || speed < 43) thrust(this, THRUST * time);
    }

    if (p !== null) {
      this.reload = Math.max(0, this.reload - time);
      if (Math.abs(fold(toPlayer - this.angle)) < Math.PI / 12 && this.reload <= 0) {
        fire(this, false, play.shoot, -500);
        this.reload += 0.75;
      }
    }

    wrap(this, 26);

    const b = incoming(this, true);
    if (b !== null) {
      b.remove();
      this.remove();
      shake();
      play.break();
      ent.addScore(10, this.pos.x, this.pos.y);
      debris(this.pos, BLACK, 40, 1);
      return;
    }

    if (p === null || !this.hit(p)) return;
    this.remove();
    play.break();
    debris(this.pos, BLACK, 40, 1);
    explode(p);
  }
}

// Gfx centres it on its own 52x52 box, which is where SHIP's numbers come from.
function dart(e, color) {
  e.gfx.fill(color).mt(52, 26).lt(0, 52).lt(13, 26).lt(0, 0).lt(52, 26);
}

function thrust(e, dv) {
  e.vel.x += dv * Math.cos(e.angle);
  e.vel.y += dv * Math.sin(e.angle);
  const l = Math.hypot(e.vel.x, e.vel.y);
  if (l <= TOP_SPEED) return;
  e.vel.x *= TOP_SPEED / l;
  e.vel.y *= TOP_SPEED / l;
}

function fire(e, fromPlayer, shoot, detune = 0) {
  new Bullet(e, fromPlayer);
  e.vel.x -= RECOIL * Math.cos(e.angle);
  e.vel.y -= RECOIL * Math.sin(e.angle);
  shoot({ detune });
}

// Turns `e` towards `to`, returning how far off it was before the turn, which
// is what the enemy reads to decide whether to thrust.
function steer(e, to, rate) {
  const off = fold(to - e.angle);
  const step = rate * ent.game.time;
  e.angle += Math.max(-step, Math.min(step, off));
  return Math.abs(off);
}

// A ship sits inside its own shot for its first frames, so only the other
// side's bullets count.
function incoming(e, fromPlayer) {
  for (const b of ent.get(Bullet)) {
    if (b.fromPlayer === fromPlayer && e.hit(b)) return b;
  }
  return null;
}

function explode(p) {
  if (p.dead) return;
  debris(p.pos, WHITE, 70, 2);
  shake(0.5);
  play.lose();
  p.remove();
  dying = 2.5;
  // `flip` starts true and turns over at once, so the title is seen first.
  flip = true;
  flipTime = 0;
}

// `Text` has no way to move or retext one, so the labels are remade a second.
function turnOver() {
  for (const t of flipped) t.remove();
  flip = !flip;
  const mid = 512;
  flipped = flip ? [label(mid, 220, Math.floor(score.value))] : [
    label(mid - FLIP_GAP, 160, "SUPER"),
    label(mid, 160, "HOT"),
    label(mid + FLIP_GAP, 160, "ASTEROID"),
  ];
}

function label(y, size, text) {
  return new ent.Text({ text, x: 512, y, size, color: WHITE });
}

function debris(pos, color, count, life) {
  new ent.Particle({
    x: pos.x,
    y: pos.y,
    color,
    count: [count, 20],
    size: [6, 21],
    speed: [11, 53],
    duration: [life, 0.5],
  });
}

function split(pos, size, angle) {
  new Rock(size, pos.x, pos.y, angle, 107);
}

function newRock() {
  const size = ROCK_MIN + 43 * Math.random();
  const angle = TAU * Math.random();
  if (Math.random() < 0.5) {
    const y = Math.random() < 0.5 ? -size : 1024 + size;
    new Rock(size, 1024 * Math.random(), y, angle, ROCK_SPEED);
    return;
  }
  const x = Math.random() < 0.5 ? -size : 1024 + size;
  new Rock(size, x, 1024 * Math.random(), angle, ROCK_SPEED);
}

// Back on a unit short of the threshold it would leave by; `s` is the width.
function wrap(e, s) {
  const { pos } = e;
  if (pos.x < -s / 2) pos.x = 1024 + s / 2 - 1;
  else if (pos.x > 1024 + s / 2) pos.x = -s / 2 + 1;

  if (pos.y < -s / 2) pos.y = 1024 + s / 2 - 1;
  else if (pos.y > 1024 + s / 2) pos.y = -s / 2 + 1;
}

function fold(a) {
  const x = a % TAU;
  if (x > Math.PI) return x - TAU;
  if (x <= -Math.PI) return x + TAU;
  return x;
}

// 0 to PI. A standing ship has no heading, and PI sends it to the steering.
function between(ax, ay, bx, by) {
  const l = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (l === 0) return Math.PI;
  return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / l)));
}

export function init() {
  ent.reset([Rock, Enemy, ent.Particle, Player, Bullet]);

  realtime = 0;
  clock = 0;
  rockTime = 2;
  waveTime = 0;
  wave = 1;
  alive = 0;
  dying = 0;
  flip = false;
  flipTime = 0;
  flipped = [];
  new Player();
}

export function update(dt) {
  realtime = dt;

  // Nothing spawns and nothing scores while the board runs itself out.
  if (dying > 0) {
    dying -= dt;
    flipTime -= dt;
    if (flipTime <= 0) {
      flipTime += 1;
      turnOver();
    }
    ent.update(dt);
    if (dying <= 0) gameOver({ score: true });
    return;
  }

  const { input } = ent.game;
  const time = input.press.up || input.press.act ? dt : dt / 50;
  clock += time;
  const hard = ramp(clock);

  rockTime -= time;
  if (rockTime <= 0) {
    rockTime = 23 / hard;
    newRock();
  }

  waveTime -= time;
  if (waveTime <= 0) {
    const n = Math.floor(wave);
    for (let i = 0; i < n; ++i) new Enemy();
    // Each wave is a tenth bigger than the last, rolling over into a ship.
    waveTime += 5 * n / hard;
    wave *= 1.1;
  }

  if (alive === 0) rockTime = waveTime = 0;

  score.value += time;
  ent.update(time);
}
