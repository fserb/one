/*
 * orbit - a port of ~/prj/vault/games/sketch/src/Orbit.hx, May 2014.
 *
 * You circle a turret at a fixed speed and your gun fires itself, twice a
 * second, straight at the middle. The only control is a click, which reverses
 * the direction you circle in. Rings of chunks stand between the gun and the
 * turret; the turret leads its shots at where you will be when they arrive,
 * and the shield eats one hit.
 *
 * The score is the point of the design and it is inverted: destroying a chunk
 * pays its health once, while a chunk still standing when the turret dies pays
 * its health repeatedly as it drains, weighted by how far out its ring sits. A
 * five-health chunk in the third ring is worth 5 destroyed and 45 left alone.
 * So the game is to punch one hole and thread it, not to clear the board. The
 * `finishLevel` drain below is where that number is made, and its re-scoring
 * of the same chunk every tick is the mechanism, not a slip.
 *
 * What changed from the Haxe:
 *
 * - `Message` and `Scorer`, the sliding banner and the score box, are gone.
 *   The shell's bar already carries a score and a middle line, so the level
 *   number goes through msg() and stays up.
 * - The shell owns game over, so the death no longer drains the level first.
 *   The explosion, the hitstop and the shake are still here; gameOver() lands
 *   DEATH seconds later, with the freeze-frame taken then.
 * - The bar covers the top 21 units of the 480 box. Everything is radial about
 *   one point, so the centre moves down to the middle of what is left and the
 *   orbit comes in: with the recoil and the shield ring the player reaches
 *   ORBIT + RECOIL + 18.5 out, and only 229.5 is left to reach into.
 * - A chunk is a slice of a ring, which is neither shape entity.js collides.
 *   The Haxe walked the arc into a polygon because a polygon was all ugl had.
 *   In polar coordinates the slice is two comparisons, which is `covers()`.
 * - A hit box does not turn with the drawing here, so both bullets collide as
 *   circles rather than as the 10x12 boxes ugl ran through the sprite matrix.
 * - The ship is drawn about the centre of its shield rather than the corner of
 *   its own box. Each of the two centres itself here, so otherwise the ship
 *   jumped a unit sideways the moment the shield went.
 * - The turret damped its turn by 0.9 a frame. That is 0.9 per sixtieth of a
 *   second now, so it steers the same on a 120Hz display.
 * - Enemy bullets were the one black in the game drawn 0x000000 rather than
 *   BLACK. They are BLACK, like everything else black.
 * - A `0` in a level pattern meant an empty slot. No level in the file has
 *   one, so the patterns are read as solid.
 *
 * Hitstop runs a frame at dt 0 here, where ugl skipped the frame outright, so
 * the two places that divide by dt guard against it.
 */

import * as ent from "./lib/entity.js";
import { gameOver, hint, msg, score } from "./lib/one.js";
import * as sfxr from "./lib/sfxr.js";
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
  finishGood: false,
  date: "2014-05-01",
};

const WHITE = 0xecebec;
const BLACK = 0x222222;
const COLOR = 0x8232cd;
// ugl's C.halfwhite and C.halfblack: three quarters of the way from each of
// those to the background, so both read as barely there.
const HALFWHITE = mix(WHITE, COLOR, 0.75);
const HALFBLACK = mix(BLACK, COLOR, 0.75);

const TAU = 2 * Math.PI;

// The box the game thinks in, and the strip of it the shell's 44px bar covers.
const W = 480;
const TOP = 21;
const CX = W / 2;
// The middle of what the bar leaves, not the middle of the box.
const CY = (TOP + W) / 2;

// The player's orbit and the recoil each shot adds to it. The Haxe orbited at
// 200 about the centre of the whole box and reached 238.5 out with the recoil
// and the shield ring, half a unit inside the wall. Here the same sum has
// 229.5 to fit into.
const ORBIT = 190;
const RECOIL = 20;
// Units a second the orbit falls back towards ORBIT, and a knocked chunk
// slides back to the middle.
const FALLBACK = 50;
const SETTLE = 50;
const ANGSPEED = Math.PI / 4;
const RELOAD = 0.5;
const SHIELD = 17;
// A chunk at full health is this thick either side of its ring.
const THICK = 6;

const BSPEED = 300;
const BR = 6;

// Rings turn at SPIN towards a target angle, and one ring of the level is
// given a new target every REPOINT seconds over the number of rings.
const SPIN = 5;
const REPOINT = 12;

const ENEMY_R = 17;
const ENEMY_TURN = 10;
// Seconds before the turret's first shot, or as long as the hint stands when
// that is longer. On ENEMY_FIRST alone the opening shot lands at 2.2s and the
// one that gets through the shield at 3.3s, both while the hint is still on
// screen and a player who is reading cannot answer either. hint() is 0 from
// the second level on, so only the first level pays for it.
const ENEMY_FIRST = 1.5;
// Frames of the player's angle the turret averages to lead its shot.
const HISTORY = 60;

// Carrying the shield into a level is worth this.
const SHIELD_BONUS = 50;
// Seconds from the blow to the freeze-frame, on top of the hitstop.
const DEATH = 0.6;

// ugl's Sound.vol(v) set masterVolume to 2v, which sfxr squares, and the
// constructor's default was vol(0.2).
voice("shot", sfxr.laser(1350), 0.15);
voice("pop", sfxr.explosion(1002), 0.1);
voice("chunk", sfxr.hit(95446), 0.1);
voice("enemyshot", sfxr.laser(1006), 0.075);
voice("shield", sfxr.explosion(39969), 0.2);
voice("boom", sfxr.explosion(81796), 0.2);
voice("build", sfxr.powerup(31331), 0.2);
voice("die", sfxr.explosion(1032), 0.2);

function voice(name, params, vol) {
  params.masterVolume = 2 * vol;
  sound.put(name, sfxr.render(params), sfxr.SAMPLE_RATE);
}

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

// The scene's own state, as the Haxe kept it on the Scene. `transition` holds
// while a level builds or drains: nothing fires, and the clock pays nothing.
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
  // not move the ship: without it the bounding box is the ship's alone.
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

    // The muzzle sits at (-2, -12) in the ship's own frame, turned with it.
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
    // Seconds left of the puff a spent bullet leaves. Zero while it is live.
    this.gone = 0;
    this.hitCircle(BR);
    // Every drawing in this file is built where the entity is made rather than
    // in begin(), because a group is rendered with whatever a constructor
    // added this frame and begin() only runs at the top of the next one.
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

    // A round leaves the muzzle as a ball and stretches into a dart.
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
      new Flash();
      if (player.shield) player.removeShield();
      else die();
      return;
    }

    // Shooting one down is free: the player's gun aims itself at the middle,
    // so this only pays off where the two lines already cross.
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
    // The arc's own bounding box is off to one side of the ring; size() holds
    // the centre of the ring on the entity, which is what `angle` turns about.
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

  // Is the circle of radius `r` about (x, y) touching this slice? The band is
  // a distance test; the sweep is an angle one, widened by what the circle
  // subtends at that distance. ugl's arcs turn the opposite way to the screen
  // and `angle` turns the drawing, so a screen direction s is at `angle - s`.
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

    // Health rises at 5 a second and falls at 20: a ring builds slowly and
    // drains fast. Written as a reach rather than a clamp so a hitstop frame,
    // which arrives with dt 0, cannot end the move a step short.
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

      // Where the round came from, and where the debris goes.
      const a = b.angle - Math.PI / 2;
      if (this.health > 0.2) {
        // Knocked inwards, harder the closer it is to going.
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
      // The build and the drain walk this array in order, so shuffling is what
      // makes a ring come up and go down in no particular direction.
      shuffle(ring);

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
      // Every chunk of a ring carries the same angle, including the ones that
      // have been shot away: they stay in the array to hold the count.
      const a = this.layers[i][0].angle;
      if (a === this.want[i]) continue;
      const max = SPIN * dt;
      const da = clamp(turn(a, this.want[i]), -max, max);
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
    // Facing away from the player, so the barrel has half a turn to swing
    // through before it can fire at them.
    this.angle = (player?.angle ?? 0) + Math.PI;
    this.hitCircle(ENEMY_R);
    // The square is the background colour and paints nothing. It is here to
    // hold the bounding box on the middle of the body, the way size() does.
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

    // Mean angular step over the buffer, over the frame, times the round's
    // flight time. The buffer filling is the ramp: a turret just built
    // under-leads until it has watched a whole second of orbit.
    if (dt > 0 && this.past.length > 1) {
      let sum = 0;
      for (let i = 1; i < this.past.length; ++i) {
        sum += turn(this.past[i - 1], this.past[i]);
      }
      const rate = sum / (this.past.length - 1) / dt;
      aim += rate * (this.past.length / HISTORY) * (ORBIT / BSPEED);
    }

    // A normal deviate, as the Haxe rolled it: one half of Box-Muller.
    const n = Math.sqrt(-2 * Math.log(Math.random())) *
      Math.cos(Math.random() * TAU);
    aim = mod(aim + n * Math.PI / 32, TAU);

    this.bulletDelay = Math.max(0.1, this.bulletDelay - 0.1 * dt / 30);

    // Full thrust towards the aim and a damping that never quite settles, so
    // the barrel hunts around the player rather than tracking them exactly.
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
 * ugl's Micro.flash(): one frame of white over the board. It is the only sign
 * that a round landed on the shield, which otherwise just quietly goes.
 *
 * ugl asked for that frame as `0.01` seconds and there is no length of time
 * that means it here. A flash is made inside another entity's update(), and
 * this group steps after that one, so its own update() runs before anything is
 * drawn: any lifetime under a frame is removed having never been painted, and
 * any lifetime over one lasts however many frames the display happens to fit
 * into it. So it ends itself once it has been drawn, and the drawing is built
 * in the constructor, because begin() waits for the top of the next frame.
 */
class Flash extends ent.Entity {
  constructor() {
    super();
    this.pos.x = CX;
    this.pos.y = CY;
    // Wider than the box, so a frame that also shakes shows no edge.
    this.gfx.fill(WHITE).rect(-W / 2 - 40, -W / 2 - 40, W + 80, W + 80);
  }

  render(ctx) {
    super.render(ctx);
    this.remove();
  }
}

/*
 * The turret is dead. Wait, then drain the level a chunk at a time and score
 * what is standing.
 *
 * The drain scores the chunk it finds on every tick rather than once per
 * chunk, so a chunk left at health h pays h + (h-1) + ... + 1 times one plus
 * its ring index. That is the whole scoring: shooting the same chunk pays h
 * flat. It is the Haxe's behaviour and it is what makes leaving a wall up
 * worth nine times destroying it out on the third ring.
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

// Build the next level a chunk at a time, then hand the board back.
function nextLevel() {
  level++;
  msg(`level ${level + 1}`);
  // A round can end during the drain: an enemy round outlives the level that
  // fired it, and there is nobody to build a board for.
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
  new ent.Timer().delay(DEATH).run(() => gameOver());
}

// Past the hand-made levels: four rings out of HARD, an extra one every few
// levels, up to eight.
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

// The shortest signed way round from `a` to `b`.
function turn(a, b) {
  return mod(b - a + Math.PI, TAU) - Math.PI;
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

// ugl's Color.lerp, in floats rather than its 8-bit fixed point.
function mix(a, b, t) {
  let out = 0;
  for (const s of [16, 8, 0]) {
    const from = (a >> s) & 255;
    out |= Math.round(from + (((b >> s) & 255) - from) * t) << s;
  }
  return out;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; --i) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

export function init() {
  ent.reset();
  ent.world(W);
  ent.order([Enemy, Chunk, ent.Particle, Player, EnemyBullet, Bullet, Flash]);

  level = -1;
  transition = true;
  rings = null;
  player = new Player();
  nextLevel();
}

export function update(dt) {
  ent.update(dt);
  // Half a point a second for staying alive, and nothing while a level builds
  // or drains. ugl ran the scene before the entities and skipped the whole
  // frame during hitstop; here the scene runs after and reads ent.game.time,
  // which is already 0 on a held frame, so the two amount to the same thing.
  if (!transition) score.value += ent.game.time / 2;
}

export function render(ctx) {
  ent.render(ctx);
}
