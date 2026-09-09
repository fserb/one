/*
 * asteroid - a port of ~/prj/vault/games/sketch/src/Asteroid.hx, "Super Hot
 * Asteroid", April 2014. Atari's Asteroids crossed with SUPERHOT.
 *
 * Time runs at a fiftieth of its speed unless you are thrusting or shooting.
 * Turning is the exception and always runs on the wall clock, so a frozen
 * board is a place to aim from, and the trigger is what starts everything
 * moving again, your ship and the bullet coming at it together. The score is
 * seconds of running clock, plus 2 a rock and 10 a ship: sitting still earns
 * nothing, which is the whole of the design.
 *
 * The enemy ships fly for a point rather than at you. Each picks a wandering
 * target, weighted further towards the player the longer it has been alive,
 * and steers by mirroring its own heading about the line to that target, which
 * overshoots and is why they weave. Once one is up to speed and already
 * pointed the right way it stops steering and spends the nose on aiming
 * instead. That is the whole AI, and it reads as a pilot.
 *
 * What changed from the Haxe:
 *
 * - The ship's hit shape is its triangle. ugl ran hit shapes through the
 *   sprite matrix and entity.js does not, so every port so far has rounded a
 *   turning shape off to a circle. A circle over this dart is wrong either
 *   way round: one that holds the tail swallows the empty air beside the nose,
 *   and one that fits the nose drops both back corners. At a fiftieth speed
 *   you watch the bullet arrive and can see which it was, so entity.js grew
 *   hitPoly() for this game. The bullet's 14x6 box goes through it too.
 * - The shell's bar covers the top 21 units of the 480 box, so the box things
 *   wrap in is 480x459 and everything the Haxe scattered over 480 scatters
 *   over that. Wrapping needs the whole field visible: an edge under the bar
 *   is an edge a ship can shoot you from unseen.
 * - The death is the Haxe's, over 2.5 seconds it holds the screen for: the
 *   player is removed, the clock comes off the brake, the board you were
 *   picking your way through flies at full speed, and the title and the score
 *   swap places over the top of it once a second, the title first. The one
 *   thing that cannot carry over is the wait: the Haxe flipped forever and
 *   took any key to leave, and here the click that starts the next round is
 *   the shell's finish screen, so holding the flip until input would cost the
 *   player two clicks. It runs for the holdback and then hands over.
 * - The in-game score label is gone; the bar carries the score.
 * - An enemy lands on the aim it wants instead of stopping a step short of it.
 *   The Haxe turned by a whole step or not at all, so a lined-up ship rocked
 *   across its target by a step a frame.
 *
 * The hint needs no grace period. Three seconds of `meta.desc` cost a player
 * who stops to read it six hundredths of a second of game clock, so the ship
 * the round opens against has not crossed a unit by the time it fades. grab and
 * orbit both hold their first shot for exactly as long as the hint stands;
 * this game gets that for free.
 *
 * Two things in the Haxe do nothing and are not here. `totaltime` is summed
 * and never read. `fastforward` is set in `end()` to stop `update()` dividing
 * the clock, but `end()` also moves the scene to its final state, after which
 * `update()` is never called again; the entities keep running at full speed on
 * their own, which is the effect it was reaching for.
 */

import * as ent from "./lib/entity.js";
import "./lib/gfx.js";
import { gameOver, score } from "./lib/one.js";
import * as sfxr from "./lib/sfxr.js";
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
  finishGood: false,
  date: "2014-04-03",
};

const WHITE = 0xffffff;
const BLACK = 0x000000;

const TAU = 2 * Math.PI;

// The box the game thinks in, and the strip of it the shell's 44px bar covers.
const W = 480;
const TOP = 21;

// What the clock is divided by while you are neither thrusting nor shooting.
const SLOW = 50;
// Seconds the board runs at full speed with the player gone, before the shell
// takes the screen. ugl's `holdback`, which is how long the Haxe ignored input
// for, and here it is the whole length of the end screen.
const DYING = 2.5;
// The end screen swaps at this rate, and its three lines sit this far apart,
// centred on the field rather than on the Haxe's unshifted 480 box.
const FLIP = 1;
const FLIP_GAP = 120;

// The triangle both ships collide as: the shape dart() draws, moved from the
// corner of the sprite's 24x24 box onto the centre it is drawn about.
const SHIP = [-12, -12, 12, 0, -12, 12];
// A shot leaves this far along the nose.
const MUZZLE = 10;

const TURN = 1.5 * Math.PI;
const THRUST = 200;
const TOP_SPEED = 200;
// The kick backwards off a shot. Nothing clamps it, so firing over your
// shoulder is the one way past TOP_SPEED.
const RECOIL = 35;
const RELOAD = 0.35;

const SHOT = [-7, -3, 7, -3, 7, 3, -7, 3];
const SHOT_SPEED = 300;
const SHOT_LIFE = 2;

// A rock is 30 to 50 across the radius, and only one that big splits, so the
// halves it leaves are the end of it.
const ROCK_MIN = 30;
const ROCK_VAR = 20;
const ROCK_SPEED = 100;
const SPLIT_SPEED = 50;
const ROCK_FIRST = 2;
const ROCK_EVERY = 23;

// The first wave lands at once, the next in five seconds, and each is a tenth
// bigger than the one before until the count rolls over to another ship.
const WAVE_EVERY = 5;
const WAVE_GROW = 1.1;

const ENEMY_FIRST = 1.5;
const ENEMY_RELOAD = 0.75;
const AIM_TURN = Math.PI;
const STEER_TURN = 1.5 * Math.PI;
// Near enough to a target to want another one.
const ARRIVE = 32;
// Over this speed an enemy stops steering and aims; under this one it thrusts
// whichever way it is pointed.
const CRUISE = 100;
const STALLED = 20;
// How near its heading has to be before an enemy will burn fuel, and how near
// the player has to be to its nose before it will fire.
const CONE = Math.PI / 6;
const SIGHT = Math.PI / 12;

// Asteroid never called ugl's Sound.vol(), so all six sit at sfxr's own
// default volume.
voice("shot", sfxr.laser(1008));
voice("enemyshot", sfxr.laser(1006));
voice("pop", sfxr.explosion(1002));
voice("rock", sfxr.explosion(1010));
voice("enemy", sfxr.explosion(1005));
voice("player", sfxr.explosion(1032));

function voice(name, params) {
  sound.put(name, sfxr.render(params), sfxr.SAMPLE_RATE);
}

// The unscaled frame, which is what the player turns on.
let realtime = 0;
let rockTime = 0;
let waveTime = 0;
let wave = 1;
// Rocks and ships on the board, counted here rather than off ent.get(): one
// made this frame has not begun yet, and the wave clock would read a board
// that just filled as empty and fill it again.
let alive = 0;
// Seconds of full-speed board left before the shell takes over, or 0.
let dying = 0;
// The end screen: which face is up, when it turns, and the labels drawn for
// it, which are rebuilt rather than edited because that is all `Text` offers.
let flip = false;
let flipTime = 0;
let flipped = [];

class Player extends ent.Entity {
  begin() {
    this.pos.x = W / 2;
    this.pos.y = (TOP + W) / 2;
    this.reload = 0;
    dart(this, WHITE);
    this.hitPoly(SHIP);
  }

  update() {
    const { key, time } = ent.game;

    // The one control that runs on the wall clock. Aiming is free; thrusting
    // and shooting are what you pay the clock for.
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
  // Built here rather than in begin(): it leaves along the heading whoever
  // fired it had at the moment of firing, and by the next frame the enemy has
  // already turned off it.
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

    // Shots shoot each other down. Worth aiming for: it is the only answer to
    // a bullet already on its way that does not cost you the clock.
    for (const b of ent.get(Bullet)) {
      if (b.fromPlayer === this.fromPlayer || !this.hit(b)) continue;
      sound.play("pop");
      b.remove();
      this.remove();
      return;
    }
  }
}

// What the wave clock counts: a rock or a ship, the two things on the board
// the player has to answer.
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
  // A fresh rock drifts in off an edge and a split one is placed by the rock
  // it came out of, so both arrive through the constructor.
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

      // The halves go sideways to the shot that broke it, so a rock opens
      // along the line you fired down and leaves the lane you shot through.
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
      this.pos.y = Math.random() < 0.5 ? TOP : W;
    } else {
      this.pos.x = Math.random() < 0.5 ? 0 : W;
      this.pos.y = TOP + (W - TOP) * Math.random();
    }

    this.findTarget();
    const { x, y } = this.target;
    this.angle = Math.atan2(y - this.pos.y, x - this.pos.x);
  }

  // Somewhere on the board, pulled towards the player by how long this ship
  // has been alive: a fresh one wanders, and one ten seconds old flies three
  // quarters of the way at you.
  findTarget() {
    const x = W * Math.random();
    const y = TOP + (W - TOP) * Math.random();
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
    // The Haxe took the difference, then re-targeted, then steered by the
    // difference it already had. Kept: one stale frame, and it costs nothing.
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
      // Already flying where it wants to go, so the nose is free to aim.
      steer(this, toPlayer, AIM_TURN);
    } else {
      let dx = tx;
      let dy = ty;
      if (speed > 0 && this.vel.x * tx + this.vel.y * ty > 0) {
        // Closing on the target: mirror the heading about the line to it, so
        // a drift to one side is answered by as much push to the other. It
        // overshoots every time, and the overshoot is the weave.
        const l = Math.hypot(tx, ty);
        const nx = tx / l;
        const ny = ty / l;
        const k = 2 * (this.vel.x * nx + this.vel.y * ny);
        dx = k * nx - this.vel.x;
        dy = k * ny - this.vel.y;
      } else if (speed > 0) {
        // Heading away from it: turn around.
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

// The ship, nose at (24, 12) and a notch cut out of the tail. Gfx centres it
// on its own 24x24 box, which is where SHIP's numbers come from.
function dart(e, color) {
  e.gfx.fill(color).mt(24, 12).lt(0, 24).lt(6, 12).lt(0, 0).lt(24, 12);
}

// Add dv along the heading and hold the result under TOP_SPEED.
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

// Turn `e` towards `to` at `rate` radians a second, and say how far off it was
// before the turn, which is what the enemy reads to decide whether to thrust.
function steer(e, to, rate) {
  const off = fold(to - e.angle);
  const step = rate * ent.game.time;
  e.angle += Math.max(-step, Math.min(step, off));
  return Math.abs(off);
}

// The first live bullet touching `e` from the other side. A ship sits inside
// its own shot for the first frames of it.
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
  // The Haxe set `flip` true and then turned it over on its first frame, so
  // the title is the face the player sees first. Kept, including the order.
  flip = true;
  flipTime = 0;
}

// Turn the end screen over: the score on one face, the game's name on the
// other. The Haxe removed and remade the labels every second, and `Text` has
// no way to move or retext one, so this does too.
function turnOver() {
  for (const t of flipped) t.remove();
  flip = !flip;
  const mid = (TOP + W) / 2;
  flipped = flip ? [label(mid, 12, Math.floor(score.value))] : [
    label(mid - FLIP_GAP, 9, "SUPER"),
    label(mid, 9, "HOT"),
    label(mid + FLIP_GAP, 9, "ASTEROID"),
  ];
}

function label(y, size, text) {
  return new ent.Text().text(text).color(WHITE).size(size).xy(W / 2, y);
}

// What a ship leaves. A rock throws its own, in chunks the size it was.
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

// A rock drifts in from just outside one of the four edges.
function newRock() {
  const size = ROCK_MIN + ROCK_VAR * Math.random();
  const angle = TAU * Math.random();
  if (Math.random() < 0.5) {
    const y = Math.random() < 0.5 ? TOP - size : W + size;
    new Rock(size, W * Math.random(), y, angle, ROCK_SPEED);
    return;
  }
  const x = Math.random() < 0.5 ? -size : W + size;
  new Rock(size, x, TOP + (W - TOP) * Math.random(), angle, ROCK_SPEED);
}

// Off one edge and back on at the other, a unit short of the threshold it
// would leave by. `s` is how far past the edge the entity is let run before it
// goes, which the Haxe read as its width.
function wrap(e, s) {
  const { pos } = e;
  if (pos.x < -s / 2) pos.x = W + s / 2 - 1;
  else if (pos.x > W + s / 2) pos.x = -s / 2 + 1;

  if (pos.y < TOP - s / 2) pos.y = W + s / 2 - 1;
  else if (pos.y > W + s / 2) pos.y = TOP - s / 2 + 1;
}

// An angle folded into (-PI, PI].
function fold(a) {
  const x = a % TAU;
  if (x > Math.PI) return x - TAU;
  if (x <= -Math.PI) return x + TAU;
  return x;
}

// The angle between two vectors, 0 to PI. A standing ship has no heading to
// compare, and PI is the answer that sends it to the steering branch.
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

  // The player is gone and the board it was holding back is running at full
  // speed. Nothing spawns and nothing scores; the shell takes the screen when
  // this runs out.
  if (dying > 0) {
    dying -= dt;
    flipTime -= dt;
    if (flipTime <= 0) {
      flipTime += FLIP;
      turnOver();
    }
    ent.update(dt);
    if (dying <= 0) gameOver();
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

  // A board cleared out brings the next wave now rather than in five seconds.
  if (alive === 0) rockTime = waveTime = 0;

  score.value += time;
  ent.update(time);
}

export function render(ctx) {
  ent.render(ctx);
}
