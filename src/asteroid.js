// asteroid - "Super Hot Asteroid", April 2014. Atari's Asteroids and SUPERHOT.

import * as ent from "./lib/entity.js";
import { shake } from "./lib/camera.js";
import { gameOver, ramp, score } from "./lib/one.js";
import * as play from "./lib/sounds.js";

export { render } from "./lib/entity.js";

export const meta = {
  title: "asteroid",
  bg: "#BF1B25",
  fg: "#FFFFFF",
  scoreMax: true,
  date: "2014-04-05",
  release: true,
  dpad: true,
};

const WHITE = 0xffffff;
const BLACK = 0x000000;

const TAU = 2 * Math.PI;

// dart()'s shape, moved off the 52x52 box's corner onto the centre gfx uses.
const SHIP = [-26, -26, 26, 0, -26, 26];
const MUZZLE = 21;

const TURN = 1.5 * Math.PI;
const THRUST = 425;
const TOP_SPEED = 425;
// Nothing clamps it, so turning around and firing is the one way past
// TOP_SPEED.
const RECOIL = 75;

const SHOT_SPEED = 640;

const ROCK_MIN = 64;
const ROCK_SPEED = 215;

const CONE = Math.PI / 6;

let realtime = 0;
// Seconds of running clock; the ramp reads this, not one.js's time.
let clock = 0;
let rockTime = 0;
let waveTime = 0;
let wave = 1;
// Not off ent.get(): one made this frame has not begun.
let alive = 0;
// Null once the ship is hit, which is what stops the round.
let player = null;

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
    explode();
  }
}

class Bullet extends ent.Entity {
  // In the constructor, not begin(): it leaves along the heading at fire time.
  constructor(src, fromPlayer) {
    super();
    this.fromPlayer = fromPlayer;
    this.angle = src.angle;
    this.life = 2;
    this.pos.x = src.pos.x + MUZZLE * Math.cos(this.angle);
    this.pos.y = src.pos.y + MUZZLE * Math.sin(this.angle);
    this.vel.x = SHOT_SPEED * Math.cos(this.angle);
    this.vel.y = SHOT_SPEED * Math.sin(this.angle);
    this.hitPoly([-15, -6, 15, -6, 15, 6, -15, 6]);
    this.gfx.fill(fromPlayer ? WHITE : BLACK)
      .mt(0, 6).lt(21, 0).lt(30, 0).lt(30, 12).lt(21, 12).lt(0, 6);
  }

  update() {
    this.life -= ent.game.time;
    if (this.life < 0) return this.remove();

    wrap(this, 0);

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

      if (this.size >= ROCK_MIN) {
        const half = this.size / 2;
        split(this.pos, half, b.angle + Math.PI / 2);
        split(this.pos, half, b.angle - Math.PI / 2);
      }
      return;
    }

    if (this.hit(player)) explode();

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

  // Pulled toward the player by age: three quarters of the way at ten seconds.
  findTarget() {
    const x = 1024 * Math.random();
    const y = 1024 * Math.random();
    if (player === null) {
      this.target = { x, y };
      return;
    }
    const w = 1 - Math.min(0.75, this.age / 10);
    this.target = {
      x: w * x + (1 - w) * player.pos.x,
      y: w * y + (1 - w) * player.pos.y,
    };
  }

  update() {
    const { time } = ent.game;
    const tx = this.target.x - this.pos.x;
    const ty = this.target.y - this.pos.y;
    if (Math.hypot(tx, ty) < 68) this.findTarget();

    const speed = Math.hypot(this.vel.x, this.vel.y);
    const toPlayer = player === null
      ? 0
      : Math.atan2(player.pos.y - this.pos.y, player.pos.x - this.pos.x);

    // Over 215 it stops steering and aims; under 43 it thrusts as it points.
    if (
      player !== null && speed >= 215 &&
      between(tx, ty, this.vel.x, this.vel.y) <= CONE
    ) {
      steer(this, toPlayer, Math.PI);
    } else {
      let dx = tx;
      let dy = ty;
      if (speed > 0 && this.vel.x * tx + this.vel.y * ty > 0) {
        // Mirror about the line to the target; the overshoot is the weave.
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

    if (player !== null) {
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

    if (!this.hit(player)) return;
    this.remove();
    play.break();
    debris(this.pos, BLACK, 40, 1);
    explode();
  }
}

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

// Returns how far off `e` was before the turn.
function steer(e, to, rate) {
  const off = fold(to - e.angle);
  const step = rate * ent.game.time;
  e.angle += Math.max(-step, Math.min(step, off));
  return Math.abs(off);
}

// A ship sits inside its own shot for its first frames.
function incoming(e, fromPlayer) {
  for (const b of ent.get(Bullet)) {
    if (b.fromPlayer === fromPlayer && e.hit(b)) return b;
  }
  return null;
}

class Banner extends ent.Entity {
  render(ctx) {
    ctx.fillStyle = ent.css(WHITE);
    if (Math.trunc(this.age) % 2 === 1) {
      ctx.text(String(Math.floor(score.value)), 512, 512, 220);
      return;
    }
    ctx.text("SUPER", 512, 256, 160);
    ctx.text("HOT", 512, 512, 160);
    ctx.text("ASTEROID", 512, 768, 160);
  }
}

function explode() {
  if (player === null) return;
  debris(player.pos, WHITE, 70, 2);
  shake(0.5);
  play.lose();
  player.remove();
  player = null;
  new Banner();
  ent.after(2.5, () => gameOver({ score: true }));
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

// 0 to PI. A ship at rest has no heading, and PI sends it to the steering.
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
  player = new Player();
}

export function update(dt) {
  realtime = dt;

  // explode()'s timer ends the round.
  if (player === null) return ent.update(dt);

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
    // A tenth bigger each wave; the fraction carries until it adds a ship.
    waveTime += 5 * n / hard;
    wave *= 1.1;
  }

  if (alive === 0) rockTime = waveTime = 0;

  score.value += time;
  ent.update(time);
}
