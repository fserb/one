/*
 * asteroid - a port of ~/prj/vault/games/sketch/src/Asteroid.hx, "Super Hot
 * Asteroid", April 2014. Atari's Asteroids crossed with SUPERHOT.
 *
 * Time runs at a fiftieth of its speed unless you are thrusting or shooting.
 * Turning always runs on the wall clock, so a frozen board is a place to aim
 * from. The score is seconds of running clock plus 2 a rock and 10 a ship, so
 * sitting still earns nothing.
 *
 * The enemy AI is one rule: pick a wandering target weighted towards the player
 * by age, and steer by mirroring the heading about the line to it, which
 * overshoots and is why they weave. Up to speed and pointed right, a ship stops
 * steering and spends the nose on aiming.
 *
 * Both ships collide as their own triangle: a circle over this dart is wrong
 * either way round, and at a fiftieth speed you watch the bullet arrive and can
 * see which. entity.js grew hitPoly() for this game.
 *
 * The death is the Haxe's 2.5 seconds of full-speed board with title and score
 * swapping over it, but it cannot wait for input: the click is the shell's
 * finish screen, so holding the flip until a key would cost two clicks.
 */

import * as ent from "./lib/entity.js";
import "./lib/gfx.js";
import { gameOver, score } from "./lib/one.js";
import { explosion, laser } from "./lib/fsfx/sfxr.js";
import * as sound from "./lib/sound.js";

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
};

const WHITE = 0xffffff;
const BLACK = 0x000000;

const TAU = 2 * Math.PI;

// The 480 box the game thinks in.
const W = 480;

const SLOW = 50;
// ugl's `holdback`: how long the Haxe ignored input, and the whole length of
// the end screen here.
const DYING = 2.5;
const FLIP = 1;
const FLIP_GAP = 120;

// The shape dart() draws, moved from the corner of the sprite's 24x24 box onto
// the centre it is drawn about.
const SHIP = [-12, -12, 12, 0, -12, 12];
const MUZZLE = 10;

const TURN = 1.5 * Math.PI;
const THRUST = 200;
const TOP_SPEED = 200;
// Nothing clamps it, so firing over your shoulder is the one way past
// TOP_SPEED.
const RECOIL = 35;
const RELOAD = 0.35;

const SHOT = [-7, -3, 7, -3, 7, 3, -7, 3];
const SHOT_SPEED = 300;
const SHOT_LIFE = 2;

// Only a rock this big splits, so the halves it leaves are the end of it.
const ROCK_MIN = 30;
const ROCK_VAR = 20;
const ROCK_SPEED = 100;
const SPLIT_SPEED = 50;
const ROCK_FIRST = 2;
const ROCK_EVERY = 23;

// Each wave is a tenth bigger than the last until the count rolls over into
// another ship.
const WAVE_EVERY = 5;
const WAVE_GROW = 1.1;

const ENEMY_FIRST = 1.5;
const ENEMY_RELOAD = 0.75;
const AIM_TURN = Math.PI;
const STEER_TURN = 1.5 * Math.PI;
const ARRIVE = 32;
// Over CRUISE an enemy stops steering and aims; under SLOW_SPEED it thrusts
// whichever way it points.
const CRUISE = 100;
const STALLED = 20;
const CONE = Math.PI / 6;
const SIGHT = Math.PI / 12;

// Asteroid never called ugl's Sound.vol(), so all six are at sfxr's default.
sound.voice("shot", laser(1008));
sound.voice("enemyshot", laser(1006));
sound.voice("pop", explosion(1002));
sound.voice("rock", explosion(1010));
sound.voice("enemy", explosion(1005));
sound.voice("player", explosion(1032));

let realtime = 0;
let rockTime = 0;
let waveTime = 0;
let wave = 1;
// Not off ent.get(): one made this frame has not begun, and the wave clock
// would read a board that just filled as empty and fill it again.
let alive = 0;
let dying = 0;
// The labels are rebuilt rather than edited, because that is all `Text` offers.
let flip = false;
let flipTime = 0;
let flipped = [];

class Player extends ent.Entity {
  begin() {
    this.pos.x = W / 2;
    this.pos.y = W / 2;
    this.reload = 0;
    dart(this, WHITE);
    this.hitPoly(SHIP);
  }

  update() {
    const { key, time } = ent.game;

    // The one control on the wall clock: aiming is free.
    if (key.left) this.angle -= TURN * realtime;
    if (key.right) this.angle += TURN * realtime;
    if (key.up) thrust(this, THRUST * time);

    this.reload = Math.max(0, this.reload - time);
    if (key.b1 && this.reload <= 0) {
      fire(this, true, "shot");
      this.reload += RELOAD;
    }

    wrap(this, 12);

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
    this.life = SHOT_LIFE;
    this.pos.x = src.pos.x + MUZZLE * Math.cos(this.angle);
    this.pos.y = src.pos.y + MUZZLE * Math.sin(this.angle);
    this.vel.x = SHOT_SPEED * Math.cos(this.angle);
    this.vel.y = SHOT_SPEED * Math.sin(this.angle);
    this.hitPoly(SHOT);
    this.gfx.fill(fromPlayer ? WHITE : BLACK)
      .mt(0, 3).lt(10, 0).lt(14, 0).lt(14, 6).lt(10, 6).lt(0, 3);
  }

  update() {
    this.life -= ent.game.time;
    if (this.life < 0) return this.remove();

    wrap(this, 0);

    // The only answer to a bullet on its way that does not cost the clock.
    for (const b of ent.get(Bullet)) {
      if (b.fromPlayer === this.fromPlayer || !this.hit(b)) continue;
      sound.play("pop");
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

// `Ball` in the Haxe, which is what ugl's circle primitive called it.
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
      ent.shake();
      sound.play("rock");
      score.value += 2;
      pop(this.pos, "+2");
      new ent.Particle().color(BLACK).xy(this.pos.x, this.pos.y)
        .count(2 * this.size, this.size).size(4, this.size / 2)
        .speed(0, 100).duration(1.5, 0.5);

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
    this.reload = ENEMY_FIRST;

    if (Math.random() < 0.5) {
      this.pos.x = W * Math.random();
      this.pos.y = Math.random() < 0.5 ? 0 : W;
    } else {
      this.pos.x = Math.random() < 0.5 ? 0 : W;
      this.pos.y = W * Math.random();
    }

    this.findTarget();
    const { x, y } = this.target;
    this.angle = Math.atan2(y - this.pos.y, x - this.pos.x);
  }

  // Pulled towards the player by age: a fresh ship wanders, one ten seconds old
  // flies three quarters of the way at you.
  findTarget() {
    const x = W * Math.random();
    const y = W * Math.random();
    const p = ent.one(Player);
    if (p === null) {
      this.target = { x, y };
      return;
    }
    const w = 1 - Math.min(0.75, this.ticks / 10);
    this.target = {
      x: w * x + (1 - w) * p.pos.x,
      y: w * y + (1 - w) * p.pos.y,
    };
  }

  update() {
    const { time } = ent.game;
    const tx = this.target.x - this.pos.x;
    const ty = this.target.y - this.pos.y;
    // The Haxe steered by the difference it took before re-targeting. Kept.
    if (Math.hypot(tx, ty) < ARRIVE) this.findTarget();

    const p = ent.one(Player);
    const speed = Math.hypot(this.vel.x, this.vel.y);
    const toPlayer = p === null
      ? 0
      : Math.atan2(p.pos.y - this.pos.y, p.pos.x - this.pos.x);

    if (
      p !== null && speed >= CRUISE &&
      between(tx, ty, this.vel.x, this.vel.y) <= CONE
    ) {
      steer(this, toPlayer, AIM_TURN);
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

      const off = steer(this, Math.atan2(dy, dx), STEER_TURN);
      if (off < CONE || speed < STALLED) thrust(this, THRUST * time);
    }

    if (p !== null) {
      this.reload = Math.max(0, this.reload - time);
      if (Math.abs(fold(toPlayer - this.angle)) < SIGHT && this.reload <= 0) {
        fire(this, false, "enemyshot");
        this.reload += ENEMY_RELOAD;
      }
    }

    wrap(this, 12);

    const b = incoming(this, true);
    if (b !== null) {
      b.remove();
      this.remove();
      ent.shake();
      sound.play("enemy");
      score.value += 10;
      pop(this.pos, "+10");
      debris(this.pos, BLACK, 40, 1);
      return;
    }

    if (p === null || !this.hit(p)) return;
    this.remove();
    sound.play("enemy");
    debris(this.pos, BLACK, 40, 1);
    explode(p);
  }
}

// Nose at (24, 12), notch in the tail. Gfx centres it on its own 24x24 box,
// which is where SHIP's numbers come from.
function dart(e, color) {
  e.gfx.fill(color).mt(24, 12).lt(0, 24).lt(6, 12).lt(0, 0).lt(24, 12);
}

function thrust(e, dv) {
  e.vel.x += dv * Math.cos(e.angle);
  e.vel.y += dv * Math.sin(e.angle);
  const l = Math.hypot(e.vel.x, e.vel.y);
  if (l <= TOP_SPEED) return;
  e.vel.x *= TOP_SPEED / l;
  e.vel.y *= TOP_SPEED / l;
}

function fire(e, fromPlayer, name) {
  new Bullet(e, fromPlayer);
  e.vel.x -= RECOIL * Math.cos(e.angle);
  e.vel.y -= RECOIL * Math.sin(e.angle);
  sound.play(name);
}

// Turns `e` towards `to`, answering how far off it was before the turn, which
// is what the enemy reads to decide whether to thrust.
function steer(e, to, rate) {
  const off = fold(to - e.angle);
  const step = rate * ent.game.time;
  e.angle += Math.max(-step, Math.min(step, off));
  return Math.abs(off);
}

// A ship sits inside its own shot for its first frames, so only the other
// side's count.
function incoming(e, fromPlayer) {
  for (const b of ent.get(Bullet)) {
    if (b.fromPlayer === fromPlayer && e.hit(b)) return b;
  }
  return null;
}

function explode(p) {
  if (p.dead) return;
  debris(p.pos, WHITE, 70, 2);
  ent.shake(0.5);
  sound.play("player");
  p.remove();
  dying = DYING;
  // The Haxe set `flip` true and turned it over on the first frame, so the
  // title is the face seen first. Kept, order included.
  flip = true;
  flipTime = 0;
}

// The Haxe removed and remade the labels every second, and `Text` has no way to
// move or retext one, so this does too.
function turnOver() {
  for (const t of flipped) t.remove();
  flip = !flip;
  const mid = W / 2;
  flipped = flip ? [label(mid, 12, Math.floor(score.value))] : [
    label(mid - FLIP_GAP, 9, "SUPER"),
    label(mid, 9, "HOT"),
    label(mid + FLIP_GAP, 9, "ASTEROID"),
  ];
}

function label(y, size, text) {
  return new ent.Text().text(text).color(WHITE).size(size).xy(W / 2, y);
}

function debris(pos, color, count, life) {
  new ent.Particle().color(color).xy(pos.x, pos.y)
    .count(count, 20).size(3, 10).speed(5, 25).duration(life, 0.5);
}

function pop(pos, text) {
  new ent.Text().text(text).color(WHITE)
    .xy(pos.x, pos.y).move(0, -20).duration(1);
}

function split(pos, size, angle) {
  new Rock(size, pos.x, pos.y, angle, SPLIT_SPEED);
}

function newRock() {
  const size = ROCK_MIN + ROCK_VAR * Math.random();
  const angle = TAU * Math.random();
  if (Math.random() < 0.5) {
    const y = Math.random() < 0.5 ? -size : W + size;
    new Rock(size, W * Math.random(), y, angle, ROCK_SPEED);
    return;
  }
  const x = Math.random() < 0.5 ? -size : W + size;
  new Rock(size, x, W * Math.random(), angle, ROCK_SPEED);
}

// Back on a unit short of the threshold it would leave by. `s` is how far past
// the edge an entity runs first, which the Haxe read as its width.
function wrap(e, s) {
  const { pos } = e;
  if (pos.x < -s / 2) pos.x = W + s / 2 - 1;
  else if (pos.x > W + s / 2) pos.x = -s / 2 + 1;

  if (pos.y < -s / 2) pos.y = W + s / 2 - 1;
  else if (pos.y > W + s / 2) pos.y = -s / 2 + 1;
}

function fold(a) {
  const x = a % TAU;
  if (x > Math.PI) return x - TAU;
  if (x <= -Math.PI) return x + TAU;
  return x;
}

// 0 to PI. A standing ship has no heading, and PI is the answer that sends it
// to the steering branch.
function between(ax, ay, bx, by) {
  const l = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (l === 0) return Math.PI;
  return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / l)));
}

export function init() {
  ent.reset();
  ent.world(W);
  ent.order([Rock, Enemy, ent.Particle, Player, Bullet, ent.Text]);

  realtime = 0;
  rockTime = ROCK_FIRST;
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
      flipTime += FLIP;
      turnOver();
    }
    ent.update(dt);
    if (dying <= 0) gameOver({ score: true });
    return;
  }

  const { key } = ent.game;
  const time = key.up || key.b1 ? dt : dt / SLOW;

  rockTime -= time;
  if (rockTime <= 0) {
    rockTime = ROCK_EVERY;
    newRock();
  }

  waveTime -= time;
  if (waveTime <= 0) {
    const n = Math.floor(wave);
    for (let i = 0; i < n; ++i) new Enemy();
    waveTime += WAVE_EVERY * n;
    wave *= WAVE_GROW;
  }

  if (alive === 0) rockTime = waveTime = 0;

  score.value += time;
  ent.update(time);
}

export function render(ctx) {
  ent.render(ctx);
}
