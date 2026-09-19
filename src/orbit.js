/*
 * orbit, May 2014.
 *
 * The score is inverted, and that is the design: destroying a chunk scores its
 * health once, while a chunk still standing when the turret dies scores its
 * health repeatedly as the level drains, weighted by its ring. A five-health
 * chunk in the third ring is worth 5 destroyed and 45 left alone, so the game
 * is to cut one hole and shoot through it. `finishLevel`'s re-scoring of the
 * same chunk every tick is deliberate, not a bug.
 *
 * A chunk is a slice of a ring, which is neither shape entity.js collides. In
 * polar coordinates the slice is two comparisons, which is `covers()`.
 *
 * Hitstop runs a frame at dt 0 rather than skipping it, so the two places that
 * divide by dt guard against it.
 */

import * as extra from "./alma/src/utils/extra.js";
import * as random from "./alma/src/random.js";
import * as ent from "./lib/entity.js";
import { delay, flash } from "./lib/effects.js";
import { shake } from "./lib/camera.js";
import { gameOver, msg, score } from "./lib/one.js";
import * as play from "./lib/sounds.js";

export { render } from "./lib/entity.js";

export const meta = {
  title: "orbit",
  desc: `
click flips your orbit
shoot the core; what you leave standing scores
`,
  bg: "#8232CD",
  fg: "#222222",
  scoreMax: true,
  date: "2014-05-01",
};

const WHITE = 0xecebec;
const BLACK = 0x222222;
const COLOR = 0x8232cd;
// Three quarters of the way to the background, so both are nearly invisible.
const HALFWHITE = mix(WHITE, COLOR, 0.75);
const HALFBLACK = mix(BLACK, COLOR, 0.75);

const TAU = 2 * Math.PI;

// The point the board all turns about.
const CX = 512;
const CY = 512;

// 425, reaching 507 out with the recoil and the shield ring.
const ORBIT = 425;
const ANGSPEED = Math.PI / 4;
const SHIELD = 36;

const BSPEED = 640;
const BR = 13;

// One ring gets a new target angle every REPOINT seconds over the ring count.
const REPOINT = 12;

// Frames of player angle the turret averages to lead its shot.
const HISTORY = 60;

// A ring is a pattern and a weight read digit by digit: a pattern digit is how
// many slots that chunk covers, so the digits sum to the ring's slots, and the
// weight digit at the same index is its health.
const DATA = [
  [["11111111", "22222222"]],

  [["1111", "2222"], ["11111111", "22222222"]],

  [["151515", "151515"], ["333333333333", "333333333333"]],

  [["151515", "151515"], ["313131", "313131"], ["111111", "222222"]],

  [["1", "5"], ["111111", "333333"], ["121212", "535353"]],

  [
    ["111111111", "3333333333"],
    ["111", "555"],
    ["1111111", "15151515"],
    ["1111111", "51515151"],
  ],

  [
    ["131313", "151515"],
    ["11111", "12345"],
    ["111", "444"],
    ["515151", "515151"],
    ["111111111111", "333333333333"],
  ],
];

const HARD = [
  ["1", "5"],
  ["111", "555"],
  ["11111", "33333"],
  ["111111111", "3333333333"],
  ["111111111111", "333333333333"],
  ["121212", "535353"],
  ["131313", "151515"],
  ["151515", "151515"],
  ["15551555", "15551555"],
  ["133133133133", "155155155155"],
  ["111111111111", "151515151515"],
];

// `transition` holds while a level builds or drains: nothing fires, and the
// timer scores nothing.
let level = 0;
let transition = false;
let player = null;
let rings = null;

class Player extends ent.Entity {
  constructor() {
    super();
    this.shield = true;
    this.clockwise = false;
    this.radius = ORBIT;
    this.reload = 1;
    this.hitBox(43, 47, 0, -2);
    this.draw();
  }

  // size() centres the drawing on the shield, so losing it does not move it.
  draw() {
    this.gfx.clear().size(2 * SHIELD)
      .fill(WHITE).mt(0, -26).lt(21, 21).lt(0, 9).lt(-21, 21).fill();
    if (this.shield) {
      this.gfx.line(6, HALFWHITE).circle(0, 0, SHIELD);
    }
  }

  addShield() {
    this.shield = true;
    this.draw();
  }

  removeShield() {
    if (this.shield) play.deny();
    this.shield = false;
    this.draw();
  }

  update() {
    const dt = ent.game.time;
    if (ent.game.input.just.act) this.clockwise = !this.clockwise;

    this.angle += (this.clockwise ? -ANGSPEED : ANGSPEED) * dt;
    this.angle = mod(this.angle, TAU);

    this.radius = Math.max(ORBIT, this.radius - 107 * dt);
    this.pos.x = CX + this.radius * Math.cos(this.angle + Math.PI / 2);
    this.pos.y = CY + this.radius * Math.sin(this.angle + Math.PI / 2);

    if (!transition) this.reload -= dt;
    if (this.reload > 0) return;
    this.reload += 0.5;

    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    new Bullet(this.pos.x - 4 * c + 26 * s, this.pos.y - 4 * s - 26 * c, this.angle);
    play.shoot();
    this.radius += 43;
  }
}

class Bullet extends ent.Entity {
  constructor(x, y, angle) {
    super();
    this.pos.x = x;
    this.pos.y = y;
    this.angle = angle;
    this.vel.x = BSPEED * Math.cos(angle - Math.PI / 2);
    this.vel.y = BSPEED * Math.sin(angle - Math.PI / 2);
    // Seconds left of the puff. Zero while the bullet is live.
    this.gone = 0;
    this.hitCircle(BR);
    // Built in the constructor, not begin(): a group is rendered with whatever
    // the constructor added this frame.
    this.gfx.cache(0).fill(WHITE).circle(0, 0, BR);
  }

  explode() {
    this.gfx.cache(2).fill(HALFBLACK).circle(0, 0, 2 * BR);
    this.vel.x = this.vel.y = 0;
    this.gone = 0.05;
  }

  update() {
    if (this.gone > 0) {
      this.gone -= ent.game.time;
      if (this.gone <= 0) this.remove();
      return;
    }

    const { x, y } = this.pos;
    if (x < 0 || y < 0 || x > 1024 || y > 1024) return this.remove();

    if (this.age > 0.06) {
      this.gfx.cache(1).fill(WHITE)
        .mt(0, -13).lt(-6, 9).lt(-6, 13).lt(6, 13).lt(6, 9);
    }

    const e = ent.one(Enemy);
    if (e !== null && this.hit(e)) {
      this.explode();
      finishLevel();
    }
  }
}

class EnemyBullet extends ent.Entity {
  constructor(angle) {
    super();
    this.pos.x = CX;
    this.pos.y = CY;
    this.angle = angle;
    this.vel.x = BSPEED * Math.cos(angle - Math.PI / 2);
    this.vel.y = BSPEED * Math.sin(angle - Math.PI / 2);
    this.hitCircle(BR);
    this.gfx.cache(0).fill(BLACK).circle(0, 0, BR);
  }

  update() {
    const { x, y } = this.pos;
    if (x < 0 || y < 0 || x > 1024 || y > 1024) return this.remove();

    if (this.age > 0.06) {
      this.gfx.cache(1).fill(BLACK)
        .mt(0, -13).lt(-6, 9).lt(-6, 13).lt(6, 13).lt(6, 9);
    }

    if (player !== null && this.hit(player)) {
      this.remove();
      // The only sign that a round landed on the shield.
      flash(ent.css(WHITE));
      if (player.shield) player.removeShield();
      else die();
      return;
    }

    // Not aimed for: the gun aims itself, so this is where the paths cross.
    const b = this.hitGroup(Bullet);
    if (b === null) return;
    play.break();
    b.remove();
    this.remove();
  }
}

// One slice of one ring. `health` is what it has left, `want` where it is
// heading, and -1 there means it is not moving.
class Chunk extends ent.Entity {
  constructor(radius, begin, size, slots, maxHealth) {
    super();
    this.radius = radius;
    this.maxHealth = maxHealth;
    this.health = 0;
    this.want = -1;
    this.pos.x = CX;
    this.pos.y = CY;

    const delta = Math.PI / slots;
    this.arcBegin = TAU * begin / slots - delta;
    this.arcEnd = TAU * (begin + size - 1) / slots + delta;
    this.draw();
  }

  draw() {
    const r = (6 + 20 * this.health / 5) / 2;
    // size() keeps the ring's centre on the entity, which is what `angle`
    // turns about; the arc's own box is off to one side.
    this.gfx.clear().size(2 * (this.radius + 13))
      .fill(mix(COLOR, BLACK, this.health / 5))
      .arc(
        0,
        0,
        this.radius - r,
        this.radius + r,
        this.arcBegin + Math.PI / 128,
        this.arcEnd - Math.PI / 128,
      );
  }

  // The band is a distance test, the sweep an angle one widened by what the
  // circle subtends. The arcs turn against the screen, so a screen direction s
  // is at `angle - s`.
  covers(x, y, r) {
    const dx = x - this.pos.x;
    const dy = y - this.pos.y;
    const d = Math.hypot(dx, dy);
    const half = (6 + 20 * this.health / 5) / 2 + r;
    if (d < this.radius - half || d > this.radius + half) return false;

    const pad = r / d;
    const a = this.angle - Math.atan2(dy, dx) - this.arcBegin + pad;
    return mod(a, TAU) <= this.arcEnd - this.arcBegin + 2 * pad;
  }

  update() {
    const dt = ent.game.time;

    const dx = CX - this.pos.x;
    const dy = CY - this.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > 0) {
      const k = Math.min(1, 107 * dt / d);
      this.pos.x += dx * k;
      this.pos.y += dy * k;
    }

    // A reach and not a clamp, so a hitstop frame at dt 0 cannot end the move
    // a step short.
    if (this.want >= 0) {
      const left = this.want - this.health;
      const step = left < 0 ? -dt / 0.05 : dt / 0.2;
      if (Math.abs(left) <= Math.abs(step)) {
        this.health = this.want;
        this.want = -1;
      } else {
        this.health += step;
      }
      this.draw();
    }

    for (const b of ent.get(Bullet)) {
      if (b.gone > 0) continue;
      if (!this.covers(b.pos.x, b.pos.y, BR)) continue;

      b.explode();
      this.health -= 1;
      this.draw();
      play.hit();

      const a = b.angle - Math.PI / 2;
      if (this.health > 0.2) {
        this.pos.x += Math.cos(a) * 17 / this.health;
        this.pos.y += Math.sin(a) * 17 / this.health;
        shake(0.05);
        continue;
      }

      score.value += this.maxHealth;
      this.remove();
      const wide = this.arcEnd - this.arcBegin;
      new ent.Particle({
        x: CX - this.radius * Math.cos(a),
        y: CY - this.radius * Math.sin(a),
        color: mix(COLOR, BLACK, 1 / 5),
        count: wide * 100 / TAU,
        size: 13,
        speed: 425,
        direction: [a - wide, 2 * wide],
        duration: 0.2,
      });
      shake(0.2);
      return;
    }
  }
}

// The one thing the rings do on their own: every so often one is given a new
// angle to turn to, which is what closes the hole you cut.
class Level extends ent.Entity {
  constructor(n) {
    super();
    this.layers = [];
    this.want = [];

    let radius = 85;
    for (const [pattern, weight] of n < DATA.length ? DATA[n] : roll(n)) {
      let slots = 0;
      for (const c of pattern) slots += Number(c);

      const ring = [];
      let at = 0;
      for (let i = 0; i < pattern.length; ++i) {
        const size = Number(pattern[i]);
        ring.push(new Chunk(radius, at, size, slots, Number(weight[i])));
        at += size;
      }
      // The build and the drain iterate this array in order.
      random.shuffle(ring);

      this.layers.push(ring);
      this.want.push(0);
      radius += 32;
    }

    this.repoint = REPOINT / this.want.length;
    new Enemy(1.5); // 2.2s to the opening shot, 3.3s to the one past the shield
  }

  update() {
    const dt = ent.game.time;

    this.repoint -= dt;
    if (this.repoint <= 0) {
      this.repoint += REPOINT / this.want.length;
      this.want[Math.floor(Math.random() * this.want.length)] = Math.random() *
        TAU;
    }

    for (let i = 0; i < this.layers.length; ++i) {
      // Shot-away chunks stay in the array to keep the count, and every chunk
      // of a ring has the same angle.
      const a = this.layers[i][0].angle;
      if (a === this.want[i]) continue;
      const max = 5 * dt;
      const da = extra.clamp(turn(a, this.want[i]), -max, max);
      for (const c of this.layers[i]) c.angle += da;
    }
  }
}

// It watches the player's angle for a second and fires at where that puts them
// when the round arrives, off by a normal deviate. The lead is why the shield
// exists: the aim was too accurate.
class Enemy extends ent.Entity {
  constructor(first) {
    super();
    this.bulletTime = first;
    this.bulletDelay = 0.75;
    this.angvel = 0;
    this.past = [];
    this.pos.x = CX;
    this.pos.y = CY;
    // Facing away, so the barrel has half a turn to swing before it can fire.
    this.angle = (player?.angle ?? 0) + Math.PI;
    this.hitCircle(36);
    // Background colour, drawing nothing: it keeps the box on the body.
    this.gfx.fill(COLOR).rect(-43, -43, 86, 86)
      .fill(BLACK).circle(0, 0, 21)
      .fill(BLACK).mt(0, -43).lt(21, 0).lt(-21, 0).fill();
  }

  explode() {
    this.remove();
    play.explode();
    new ent.Particle({
      x: CX,
      y: CY,
      color: BLACK,
      count: 100,
      size: [4, 21],
      speed: [107, 107],
      direction: [0, TAU],
      duration: 0.5,
    });
  }

  update() {
    const dt = ent.game.time;
    if (player === null) return;

    let aim = player.angle + Math.PI;
    this.past.push(aim);
    while (this.past.length > HISTORY) this.past.shift();

    // Mean angular step over the buffer, times the round's flight time. The
    // buffer filling is the ramp: a new turret under-leads for a second.
    if (dt > 0 && this.past.length > 1) {
      let sum = 0;
      for (let i = 1; i < this.past.length; ++i) {
        sum += turn(this.past[i - 1], this.past[i]);
      }
      const rate = sum / (this.past.length - 1) / dt;
      aim += rate * (this.past.length / HISTORY) * (ORBIT / BSPEED);
    }

    // A normal deviate: one half of Box-Muller.
    const n = Math.sqrt(-2 * Math.log(Math.random())) *
      Math.cos(Math.random() * TAU);
    aim = mod(aim + n * Math.PI / 32, TAU);

    this.bulletDelay = Math.max(0.1, this.bulletDelay - 0.1 * dt / 30);

    // Damping that never quite settles, so the barrel oscillates around the
    // player rather than tracking them.
    const t = turn(this.angle, aim);
    if (t !== 0) this.angvel += Math.sign(t) * 10 * dt;
    this.angvel *= Math.pow(0.9, dt * 60);
    this.angle += this.angvel * dt;

    if (!transition) this.bulletTime -= dt;
    if (this.bulletTime > 0) return;
    this.bulletTime = this.bulletDelay;
    new EnemyBullet(this.angle);
    play.shoot({ detune: -500 });
  }
}

// The drain scores a chunk on every tick, so one left at health h scores
// h + (h-1) + ... + 1 times one plus its ring index.
function finishLevel() {
  ent.one(Enemy)?.explode();
  delay(0.05);
  transition = true;

  const dying = rings;
  ent.after(0.75, () => {
    ent.every(0.05, () => {
      for (let i = 0; i < dying.layers.length; ++i) {
        for (const c of dying.layers[i]) {
          if (c.health <= 0) continue;
          c.want = 0;
          score.value += c.health * (1 + i);
          return true;
        }
      }

      for (const cls of [Bullet, Enemy, Chunk, Level]) {
        for (const e of ent.get(cls)) e.remove();
      }
      nextLevel();
      return false;
    });
  });
}

function nextLevel() {
  level++;
  msg(`level ${level + 1}`);
  // An enemy round outlives the level that fired it, so a round can end with
  // nobody left to build for.
  if (player === null) return;

  if (!player.shield) player.addShield();
  else if (level > 0) score.value += 50;

  rings = new Level(level);
  play.power();

  const built = rings;
  ent.every(0.05, () => {
    for (const ring of built.layers) {
      for (const c of ring) {
        if (c.health > 0) continue;
        c.want = c.maxHealth;
        return true;
      }
    }
    transition = false;
    return false;
  });
}

function die() {
  const { x, y } = player.pos;
  player.remove();
  player = null;

  play.lose();
  new ent.Particle({
    x,
    y,
    color: WHITE,
    count: [70, 20],
    size: [6, 21],
    speed: [11, 53],
    duration: [2, 0.5],
  });
  delay(0.05);
  shake(0.5);
  ent.after(0.6, () => gameOver({ score: true })); // on top of the hitstop
}

// Past the hand-made levels: four rings out of HARD, up to eight.
function roll(n) {
  const count = Math.min(8, Math.trunc(3 + Math.sqrt(1 + n - DATA.length)));
  const out = [];
  for (let i = 0; i < count; ++i) {
    out.push(HARD[Math.floor(Math.random() * HARD.length)]);
  }
  return out;
}

function mod(a, m) {
  return ((a % m) + m) % m;
}

function turn(a, b) {
  return mod(b - a + Math.PI, TAU) - Math.PI;
}

function mix(a, b, t) {
  let out = 0;
  for (const s of [16, 8, 0]) {
    const from = (a >> s) & 255;
    out |= Math.round(from + (((b >> s) & 255) - from) * t) << s;
  }
  return out;
}

export function init() {
  ent.reset([Enemy, Chunk, ent.Particle, Player, EnemyBullet, Bullet]);

  level = -1;
  transition = true;
  rings = null;
  player = new Player();
  nextLevel();
}

export function update(dt) {
  ent.update(dt);
  // Half a point a second alive, nothing while a level builds or drains.
  if (!transition) score.value += ent.game.time / 2;
}
