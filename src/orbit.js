/*
 * orbit, May 2014.
 *
 * You circle a turret at a fixed speed and your gun fires itself twice a second
 * at the middle. The only control is a click, which reverses the direction you
 * circle in. Rings of chunks stand between the gun and the turret; the turret
 * leads its shots, and the shield eats one hit.
 *
 * The score is inverted, and that is the design: destroying a chunk pays its
 * health once, while a chunk still standing when the turret dies pays its
 * health repeatedly as it drains, weighted by its ring. A five-health chunk in
 * the third ring is worth 5 destroyed and 45 left alone, so the game is to
 * punch one hole and thread it. `finishLevel`'s re-scoring of the same chunk
 * every tick is the mechanism, not a slip.
 *
 * A chunk is a slice of a ring, which is neither shape entity.js collides. In
 * polar coordinates the slice is two comparisons, which is `covers()`, rather
 * than an arc walked into a polygon. Both bullets collide as circles, since a
 * hit box does not turn with the drawing.
 *
 * Hitstop runs a frame at dt 0 rather than skipping the frame, so the two
 * places that divide by dt guard against it.
 */

import { extra, random } from "./alma/src/index.js";
import { css } from "./lib/art.js";
import * as ent from "./lib/entity.js";
import { flash, gameOver, hint, msg, score } from "./lib/one.js";
import { explosion, hit, laser, powerup } from "./lib/fsfx/sfxr.js";
import * as sound from "./lib/sound.js";

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
// Three quarters of the way to the background, so both read as barely there.
const HALFWHITE = mix(WHITE, COLOR, 0.75);
const HALFBLACK = mix(BLACK, COLOR, 0.75);

const TAU = 2 * Math.PI;

// The 480 box the game thinks in, and the point it all turns about.
const W = 480;
const CX = W / 2;
const CY = W / 2;

// 200, reaching 238.5 out with the recoil and the shield ring.
const ORBIT = 200;
const RECOIL = 20;
const FALLBACK = 50;
const SETTLE = 50;
const ANGSPEED = Math.PI / 4;
const RELOAD = 0.5;
const SHIELD = 17;
// Half thickness of a chunk at full health.
const THICK = 6;

const BSPEED = 300;
const BR = 6;

// One ring gets a new target angle every REPOINT seconds over the ring count.
const SPIN = 5;
const REPOINT = 12;

const ENEMY_R = 17;
const ENEMY_TURN = 10;
// Or as long as the hint stands, when that is longer: on ENEMY_FIRST alone the
// opening shot lands at 2.2s and the one past the shield at 3.3s, both while
// the hint is still up.
const ENEMY_FIRST = 1.5;
// Frames of player angle the turret averages to lead its shot.
const HISTORY = 60;

const SHIELD_BONUS = 50;
// On top of the hitstop.
const DEATH = 0.6;

// 0.2 is the default these were made against; most are set below it.
sound.voice("shot", { ...laser(1350), vol: 0.15 });
sound.voice("pop", { ...explosion(1002), vol: 0.1 });
sound.voice("chunk", { ...hit(95446), vol: 0.1 });
sound.voice("enemyshot", { ...laser(1006), vol: 0.075 });
sound.voice("shield", { ...explosion(39969), vol: 0.2 });
sound.voice("boom", { ...explosion(81796), vol: 0.2 });
sound.voice("build", { ...powerup(31331), vol: 0.2 });
sound.voice("die", { ...explosion(1032), vol: 0.2 });

/*
 * A level is a list of rings, each a pattern and a weight read digit by digit.
 * A pattern digit is how many slots of the ring that chunk covers, so the
 * digits of a pattern sum to the number of slots; the weight digit at the same
 * index is that chunk's health. The first seven levels are drawn by hand and
 * everything after is rolled out of HARD.
 */
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
// clock pays nothing.
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
    this.hitBox(20, 22, 0, -1);
    this.draw();
  }

  // size() pins the drawing on the shield's centre, so losing the shield does
  // not move the ship.
  draw() {
    this.gfx.clear().size(2 * SHIELD)
      .fill(WHITE).mt(0, -12).lt(10, 10).lt(0, 4).lt(-10, 10).fill();
    if (this.shield) {
      this.gfx.line(3, HALFWHITE).circle(0, 0, SHIELD);
    }
  }

  addShield() {
    this.shield = true;
    this.draw();
  }

  removeShield() {
    if (this.shield) sound.play("shield");
    this.shield = false;
    this.draw();
  }

  update() {
    const dt = ent.game.time;
    if (ent.game.key.just.b1) this.clockwise = !this.clockwise;

    this.angle += (this.clockwise ? -ANGSPEED : ANGSPEED) * dt;
    this.angle = mod(this.angle, TAU);

    this.radius = Math.max(ORBIT, this.radius - FALLBACK * dt);
    this.pos.x = CX + this.radius * Math.cos(this.angle + Math.PI / 2);
    this.pos.y = CY + this.radius * Math.sin(this.angle + Math.PI / 2);

    if (!transition) this.reload -= dt;
    if (this.reload > 0) return;
    this.reload += RELOAD;

    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    new Bullet(this.pos.x - 2 * c + 12 * s, this.pos.y - 2 * s - 12 * c, this.angle);
    sound.play("shot");
    this.radius += RECOIL;
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
    // Every drawing here is built in the constructor, not begin(): a group is
    // rendered with whatever the constructor added this frame.
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
    if (x < 0 || y < 0 || x > W || y > W) return this.remove();

    if (this.ticks > 0.06) {
      this.gfx.cache(1).fill(WHITE)
        .mt(0, -6).lt(-3, 4).lt(-3, 6).lt(3, 6).lt(3, 4);
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
    if (x < 0 || y < 0 || x > W || y > W) return this.remove();

    if (this.ticks > 0.06) {
      this.gfx.cache(1).fill(BLACK)
        .mt(0, -6).lt(-3, 4).lt(-3, 6).lt(3, 6).lt(3, 4);
    }

    if (player !== null && this.hit(player)) {
      this.remove();
      // The only sign that a round landed on the shield.
      flash(css(WHITE));
      if (player.shield) player.removeShield();
      else die();
      return;
    }

    // Free: the gun aims itself, so this only pays where the lines cross.
    const b = this.hitGroup(Bullet);
    if (b === null) return;
    sound.play("pop");
    b.remove();
    this.remove();
  }
}

/*
 * One slice of one ring. `health` is what it has left, `want` where it is
 * heading, and -1 there means it is not moving. The drawing thickens and
 * darkens with the health, so a wall reads as a wall.
 */
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
    const r = (3 + 9 * this.health / 5) / 2;
    // size() holds the centre of the ring on the entity, which is what `angle`
    // turns about; the arc's own box is off to one side.
    this.gfx.clear().size(2 * (this.radius + THICK))
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
  // circle subtends. The arcs turn the opposite way to the screen and `angle`
  // turns the drawing, so a screen direction s is at `angle - s`.
  covers(x, y, r) {
    const dx = x - this.pos.x;
    const dy = y - this.pos.y;
    const d = Math.hypot(dx, dy);
    const half = (3 + 9 * this.health / 5) / 2 + r;
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
      const k = Math.min(1, SETTLE * dt / d);
      this.pos.x += dx * k;
      this.pos.y += dy * k;
    }

    // A ring builds slowly and drains fast. Written as a reach, not a clamp,
    // so a hitstop frame at dt 0 cannot end the move a step short.
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
      sound.play("chunk");

      const a = b.angle - Math.PI / 2;
      if (this.health > 0.2) {
        this.pos.x += Math.cos(a) * 8 / this.health;
        this.pos.y += Math.sin(a) * 8 / this.health;
        ent.shake(0.05);
        continue;
      }

      score.value += this.maxHealth;
      this.remove();
      const wide = this.arcEnd - this.arcBegin;
      new ent.Particle()
        .color(mix(COLOR, BLACK, 1 / 5))
        .xy(CX - this.radius * Math.cos(a), CY - this.radius * Math.sin(a))
        .size(6)
        .count(wide * 100 / TAU)
        .duration(0.2)
        .direction(a - wide, 2 * wide)
        .speed(200);
      ent.shake(0.2);
      return;
    }
  }
}

/*
 * The rings, and the one thing they do on their own: every so often a ring is
 * handed a new angle to turn to. That is what closes the hole you cut.
 */
class Level extends ent.Entity {
  constructor(n) {
    super();
    this.layers = [];
    this.want = [];

    let radius = 40;
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
      // The build and the drain walk this array in order.
      random.shuffle(ring);

      this.layers.push(ring);
      this.want.push(0);
      radius += 15;
    }

    this.repoint = REPOINT / this.want.length;
    new Enemy(Math.max(ENEMY_FIRST, hint()));
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
      // Shot-away chunks stay in the array to hold the count, and every chunk
      // of a ring carries the same angle.
      const a = this.layers[i][0].angle;
      if (a === this.want[i]) continue;
      const max = SPIN * dt;
      const da = extra.clamp(turn(a, this.want[i]), -max, max);
      for (const c of this.layers[i]) c.angle += da;
    }
  }
}

/*
 * The turret. It watches the player's angle for a second and fires at where
 * that puts them when the round arrives, off by a normal deviate. The lead is
 * why the shield exists: the author's note says the aim came out too good.
 */
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
    this.hitCircle(ENEMY_R);
    // Background colour, painting nothing: it holds the bounding box on the
    // middle of the body, the way size() does.
    this.gfx.fill(COLOR).rect(-20, -20, 40, 40)
      .fill(BLACK).circle(0, 0, 10)
      .fill(BLACK).mt(0, -20).lt(10, 0).lt(-10, 0).fill();
  }

  explode() {
    this.remove();
    sound.play("boom");
    new ent.Particle().color(BLACK).size(2, 10).xy(CX, CY)
      .count(100).duration(0.5).direction(0, TAU).speed(50, 50);
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

    // A damping that never quite settles, so the barrel hunts around the
    // player rather than tracking them.
    const t = turn(this.angle, aim);
    if (t !== 0) this.angvel += Math.sign(t) * ENEMY_TURN * dt;
    this.angvel *= Math.pow(0.9, dt * 60);
    this.angle += this.angvel * dt;

    if (!transition) this.bulletTime -= dt;
    if (this.bulletTime > 0) return;
    this.bulletTime = this.bulletDelay;
    new EnemyBullet(this.angle);
    sound.play("enemyshot");
  }
}

/*
 * The turret is dead. Wait, then drain the level a chunk at a time and score
 * what is standing.
 *
 * The drain scores the chunk it finds on every tick rather than once per
 * chunk, so a chunk left at health h pays h + (h-1) + ... + 1 times one plus
 * its ring index. That is the whole scoring: shooting the same chunk pays h
 * flat, which is what makes leaving a wall up worth nine times destroying it
 * out on the third ring.
 */
function finishLevel() {
  ent.one(Enemy)?.explode();
  ent.delay(0.05);
  transition = true;

  const dying = rings;
  new ent.Timer().delay(0.75).run(() => {
    new ent.Timer().every(0.05).run(() => {
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
    return false;
  });
}

function nextLevel() {
  level++;
  msg(`level ${level + 1}`);
  // An enemy round outlives the level that fired it, so a round can end during
  // the drain with nobody left to build for.
  if (player === null) return;

  if (!player.shield) player.addShield();
  else if (level > 0) score.value += SHIELD_BONUS;

  rings = new Level(level);
  sound.play("build");

  const built = rings;
  new ent.Timer().every(0.05).run(() => {
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

  sound.play("die");
  new ent.Particle().color(WHITE).count(70, 20).xy(x, y)
    .size(3, 10).speed(5, 25).duration(2, 0.5);
  ent.delay(0.05);
  ent.shake(0.5);
  new ent.Timer().delay(DEATH).run(() => gameOver({ score: true }));
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

// Lerp two packed colours, per channel, in floats.
function mix(a, b, t) {
  let out = 0;
  for (const s of [16, 8, 0]) {
    const from = (a >> s) & 255;
    out |= Math.round(from + (((b >> s) & 255) - from) * t) << s;
  }
  return out;
}

export function init() {
  hint(meta.desc);
  ent.reset();
  ent.world(W);
  ent.order([Enemy, Chunk, ent.Particle, Player, EnemyBullet, Bullet]);

  level = -1;
  transition = true;
  rings = null;
  player = new Player();
  nextLevel();
}

export function update(dt) {
  ent.update(dt);
  // Half a point a second alive, nothing while a level builds or drains.
  // ent.game.time is already 0 on a held frame.
  if (!transition) score.value += ent.game.time / 2;
}

export { render } from "./lib/entity.js";
