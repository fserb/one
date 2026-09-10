/*
 * jeb - a port of ~/prj/vault/games/sketch/src/Jebediah.hx, "Jebediah's
 * Revenge".
 *
 * A lander in a system of planets. Gravity is real and it is the only thing
 * moving you between them: the green line out of the nose is where you are
 * going if you do nothing, drawn seven seconds ahead through the same
 * gravity the ship is flying, and it ends where you would hit. One planet is
 * lit. Land on it slowly enough and upright enough and it fills the tank and
 * lights another. The tank is the clock, it goes down whether you are burning
 * or not, and it is the only way the round ends other than hitting something
 * too hard.
 *
 * The Haxe never shipped: the file is marked `ugl.skip`, its asteroids are
 * commented out and its `// TODO:` is empty. What works in it is the landing
 * rule and the trajectory, and both are kept whole.
 *
 * The landing rule, from `Planet.update`, is the whole of the game: come in
 * over CRASH and you are scrap, come in more than a quarter turn off the
 * upright for where you touched down and you are scrap, otherwise the ship
 * stops dead and snaps to the vertical of the place it landed. Two things to
 * get right at once, and the second is the one that catches you, because
 * rotating is slow and you have to have started it long before you arrive.
 *
 * What changed:
 *
 * - The Haxe is three planets on top of each other. `Planet.begin()` runs
 *   `pos.set(240, 240)` after the constructor has already placed it, so the
 *   arguments to all three `new Planet(...)` calls are thrown away. The port
 *   scatters a system instead, in a world four times the size of the screen.
 * - Gravity is every planet at once rather than the nearest one alone. The
 *   Haxe pulled the ship with `closest` and drew the line with `closest`, so
 *   the line was right, but the pull jumped the moment the nearest planet
 *   changed and so did the line. Summing them is both smoother and less code.
 * - `if (Game.key.b1)` wrote a velocity straight into the ship, meant to drop
 *   it into a circular orbit round the nearest planet. What it computes is
 *   `dt*GM/dist`, which is neither the circular speed, `sqrt(GM/dist)`, nor
 *   the same on two screens with different refresh rates. It is gone: a button
 *   that hands you the orbit is a button that plays the game.
 * - The thrust was `5` once the ship was moving, against a surface gravity of
 *   hundreds. It could not lift off. THRUST is picked against the surface
 *   instead, and MU is per unit of radius squared so every planet in the
 *   system has the same gravity underfoot whatever its size.
 * - A landed ship is put on the surface rather than left to sink into it. The
 *   Haxe zeroed the velocity and left the position where the overlap had put
 *   it, so a ship at rest crept in a little further every frame. Doing that
 *   and nothing else makes the ship unable to leave, since a frame of thrust
 *   moves it less than the resting rule puts it back, so a ship already
 *   standing on a planet and burning away from it is left alone.
 * - The landing rule runs on arrival rather than on every frame of contact.
 *   The Haxe re-snapped the angle every frame, which pinned a resting ship
 *   upright: there was no way to point the nose before lifting off, and
 *   pointing it is slow and is the half of the landing that catches you.
 * - The line is red when it ends on the ground at over CRASH. The Haxe drew
 *   it in one colour and stopped at nothing, so the speed half of the landing
 *   rule was a number you could only find out by dying at it.
 * - There are stars. The Haxe holds the ship at the centre of the screen and
 *   moves the whole world past it, which on a black background with no planet
 *   in frame is a still picture of a ship. They are in world coordinates and
 *   they are the only thing that says you are moving. The patch tiles, because
 *   nothing stops you flying out of the system and a screen with neither a
 *   planet nor a star in it says nothing at all.
 * - The energy bar was a sprite redrawn from scratch every frame at the top
 *   left, where this shell's own bar is. It is along the bottom.
 * - The pointer aims and burns: the nose turns to the pointer and holding it
 *   down fires. Landing wants the nose pointed away from what you are landing
 *   on, so the finger goes on the far side of the ship from the planet, which
 *   is the same thing the Haxe's left, right and up spell out more slowly.
 *
 * The asteroids stay commented out. They are four planets' worth of code that
 * arrive on a straight line and are pulled off it, in a game whose whole
 * difficulty is already the two numbers you have to have right when you
 * arrive somewhere.
 */

import * as ent from "./lib/entity.js";
import { gameOver, hint, score, SIZE } from "./lib/one.js";
import * as sfxr from "./lib/sfxr.js";
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
  finishGood: false,
  date: "2014-03-30",
};

// The box the game thinks in, the strip of it the shell's bar covers, and
// where in what is left the ship is pinned.
const W = 480;
const TOP = 21;
const EYEX = W / 2;
const EYEY = (W + TOP) / 2;

// The world the system sits in, how far off its edge a planet may be, how many
// there are, how much clear space each wants around it, and the radii they
// come in. A planet is drawn as a chunky circle PX units to the pixel, so its
// radius is PX times its own cell count.
const WORLD = 1100;
const EDGE = 130;
const PLANETS = 6;
const GAP = 150;
const PX = 4;
const CELL_MIN = 6;
const CELL_MAX = 11;

// Gravity, per unit of the planet's radius squared, so the pull at the surface
// is the same on every planet in the system whatever its size. The pull an
// actual planet makes is MU*r*r/d/d.
const MU = 120;
// Per second: what the engine pushes at, how fast the ship turns, and how fast
// it comes in before landing stops being landing. THRUST is picked against MU
// rather than against anything else: at 320 against a surface pull of 120 a
// ship leaves the ground at 200, which is quick enough that getting off a
// planet is not most of a tank.
const THRUST = 320;
const TURN = Math.PI;
const CRASH = 62;
// A quarter turn off the vertical of the place you touched down and the legs
// are on their side. The Haxe's number.
const TILT = Math.PI / 4;

// The ship, how far off the pointer has to be before it is a heading, and how
// long a press has to be held before it is a burn and not just an aim. One
// pointer has to do both, and a lander that cannot turn without firing cannot
// be landed: the whole of the approach is turning while you coast.
const SHIP_R = 8;
const DEAD = 10;
const AIM_LAG = 0.18;

// The tank: what it holds, what it opens with, what it loses a second doing
// nothing at all, what the engine costs a second on top of that, what landing
// on the lit planet puts back, and what each landing takes off that. The
// refill falling is the whole of the ramp: the drain and the burn are what
// they are, and a run ends when a tankful stops covering the trip.
const TANK = 100;
const START = 90;
const LIFE = 2.2;
const BURN = 7;
const FILL = 54;
const FILL_OFF = 3.5;
const FILL_MIN = 12;

// The line out of the nose: how far ahead it looks, and the step it walks. The
// step is entity.js's own integration at 30Hz, so what it draws is what the
// ship does, near enough.
const AHEAD = 7;
const STEP = 1 / 30;

// Stars: the patch they are made in, how many are in it, and how big they are.
// The patch tiles, so there are stars wherever the ship goes, including well
// outside the system. Nothing stops you flying out of it, and out there the
// stars going past and the arrow at the edge are the only two things saying
// which way is back.
const PATCH = 700;
const STARS = 150;
const STAR = 1.6;

// The tank's bar along the bottom, and the arrow that says where the lit
// planet is when it is off the screen.
const BAR_Y = W - 13;
const BAR_H = 5;
const BAR_PAD = 30;
const ARROW = 10;

// Caught, then this long before the shot the overlay takes.
const DEATH = 0.7;

// The Haxe's Arne colours.
const GREY = 0x697175;
const DARKGREEN = 0x2f484e;
const GREEN = 0x44891a;
const BROWN = 0xeeb62f;
const RED = 0xbe2633;
const PURPLE = 0x342a97;
const STARLIGHT = 0x3c3c46;
const LINE = "#44891a";
const LINE_BAD = "#be2633";

const SHIP = `
.000.
00300
00100
00000
02220
`;

// ugl's Sound.vol(v) set masterVolume to 2v, and sfxr squares that.
voice("burn", sfxr.blip(511), 0.05);
voice("land", sfxr.powerup(3607), 0.13);
voice("crash", sfxr.explosion(3613), 0.2);

function voice(name, params, vol) {
  params.masterVolume = 2 * vol;
  sound.put(name, sfxr.render(params), sfxr.SAMPLE_RATE);
}

let ship = null;
// The system. Kept here rather than read back out of entity.js, because
// ent.get() only answers for entities that have begun, which none of them have
// while init() is still building them, and because the line out of the nose
// asks for the whole list two hundred times a frame.
const planets = [];
// The planet that is lit, the fuel left, seconds left of being wreckage, and
// the stars, which are three numbers each and never move.
let target = null;
let fuel = 0;
let dying = 0;
const stars = [];
// The predicted path, rebuilt every frame as a flat list of world x, y, and
// whether it ends on a planet and how fast it would arrive there.
const path = [];
let lands = false;
let landsAt = 0;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const css = (c) => `#${c.toString(16).padStart(6, "0")}`;

// How far `a` is round from `b`, signed, in [-PI, PI). JS's % keeps the sign of
// its left side, so the usual one-liner reads a quarter turn as three quarters
// the moment the ship has turned enough lefts to take `angle` below -3*PI. The
// Haxe wrapped `angle` into [0, 2*PI) every frame to stay out of that; wrapping
// the difference itself works wherever the two came from.
function apart(a, b) {
  const d = (a - b) % (2 * Math.PI);
  if (d < -Math.PI) return d + 2 * Math.PI;
  if (d >= Math.PI) return d - 2 * Math.PI;
  return d;
}

/*
 * A planet. Its mass is its radius squared, so the pull at the surface is MU
 * on every one of them and a big planet is only a bigger target with a longer
 * reach, never a heavier surface to leave.
 */
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
    this.art.size(PX, 2 * this.cells, 2 * this.cells)
      .color(this.lit ? BROWN : PURPLE)
      .circle(this.cells, this.cells, this.cells);
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
    // Standing on top of the planet it starts on, and the sprite's nose is
    // already -y at an angle of zero, so upright there is zero.
    this.pos.x = p.pos.x;
    this.pos.y = p.pos.y - p.r - SHIP_R;
    this.landed = p;
    this.burning = false;
    this.puff = 0;
    this.pressed = 0;
    this.art.size(4, 5, 5).obj([GREY, DARKGREEN, BROWN, GREEN], SHIP);
  }

  update() {
    if (dying > 0) return;
    const t = ent.game.time;
    const { key, mouse } = ent.game;

    this.pressed = mouse.press ? this.pressed + t : 0;
    // Read every frame, whatever else is going on, or it reports the whole of
    // a run of arrow keys as one move the moment they are let go.
    const aiming = pointerMoved() || mouse.press;

    // The nose turns toward the pointer, or on the two keys. Either way it is
    // a rate, not a jump: the turn is what you have to have started early.
    let want = null;
    if (key.left) this.angle -= TURN * t;
    if (key.right) this.angle += TURN * t;
    if (!key.left && !key.right && aiming) {
      const dx = mouse.x - EYEX;
      const dy = mouse.y - EYEY;
      if (Math.hypot(dx, dy) > DEAD) want = Math.atan2(dy, dx) + Math.PI / 2;
    }
    if (want !== null) {
      const d = apart(want, this.angle);
      const r = TURN * t;
      this.angle += Math.abs(d) <= r ? d : Math.sign(d) * r;
    }
    this.angle = apart(this.angle, 0);

    this.burning = fuel > 0 &&
      (key.up || (mouse.press && this.pressed > AIM_LAG));
    if (this.burning) {
      // The sprite's nose is -y at angle 0, so the push is the angle turned a
      // quarter back.
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
    sound.play("burn", -4 + 8 * Math.random());
    new ent.Particle()
      .xy(this.pos.x - Math.cos(a) * 12, this.pos.y - Math.sin(a) * 12)
      .color(BROWN)
      .count(3)
      .size(3)
      .direction(a + Math.PI - 0.4, 0.8)
      .speed(60, 30)
      .duration(0.4, 0.2);
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

      // Already standing on it and burning away from it: this is a take-off,
      // and resting on the surface has nothing to say about one. Without it
      // the ship can never leave: the thrust moves it a fraction of a unit in
      // a frame, the rest below puts it back on the surface and takes the
      // velocity away, and the two cancel for ever.
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

  /*
   * The Haxe's landing rule, on arrival only: over CRASH is scrap, more than
   * TILT off the vertical of the place you touched down is scrap, and
   * otherwise the ship snaps to that vertical and stops dead.
   *
   * Arrival only, because the Haxe ran the whole of it every frame the ship
   * was in contact, which pinned a resting ship upright and left no way to
   * turn on the ground. Turning is slow and it is the half of the landing that
   * catches you; being able to point the nose before lifting off is most of
   * what makes the next one possible.
   */
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
  ent.shake(0.5);
  sound.play("crash");
  new ent.Particle()
    .xy(ship.pos.x, ship.pos.y)
    .color(GREY)
    .count(90)
    .size(3)
    .speed(30, 90)
    .duration(0.7, 0.5);
  new ent.Particle()
    .xy(ship.pos.x, ship.pos.y)
    .color(RED)
    .count(40)
    .size(4)
    .speed(20, 60)
    .duration(0.5, 0.4);
}

// Landed on the lit one: the tank goes back up by less than it did last time,
// and somewhere else lights.
function arrive(p) {
  score.value += 1;
  fuel = Math.min(TANK, fuel + Math.max(FILL_MIN, FILL - FILL_OFF * score.value));
  sound.play("land");
  new ent.Particle()
    .xy(ship.pos.x, ship.pos.y)
    .color(BROWN)
    .count(24)
    .size(2)
    .speed(70, 40)
    .duration(0.5, 0.3);
  pickTarget(p);
}

// The planet furthest from the one just left, out of a sample, so there is a
// trip in it and it is not the same trip twice.
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

/*
 * Scatter a system: planets inside the world with EDGE to spare and GAP of
 * clear space between any two. Failing to place one is fine, the system is
 * just smaller, and the tries are capped because a run of unlucky rolls in a
 * world this size can take a while to find the last spot.
 */
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

// Seven seconds of coasting, stepped the way entity.js steps, stopping at the
// first planet it would touch. What it draws is where doing nothing takes you.
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
  ent.reset();
  ent.world(W);
  ent.order([Planet, Ship]);

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
    if ((dying -= t) <= 0) gameOver();
    return;
  }

  // The tank holds while the hint is up. The ship starts standing on a planet,
  // so nothing else is happening either.
  if (hint() <= 0) {
    fuel -= (LIFE + (ship.burning ? BURN : 0)) * t;
  }
  predict();
  if (fuel > 0) return;
  fuel = 0;
  expire();
}

// The tank empty is the other way a round ends, and it is not a crash: the
// engine stops, the lights go out, and what is left is a rock with legs.
function expire() {
  if (dying > 0) return;
  dying = DEATH;
  sound.play("crash", -8);
  new ent.Particle()
    .xy(ship.pos.x, ship.pos.y)
    .color(GREY)
    .count(24)
    .size(2)
    .speed(10, 26)
    .duration(0.8, 0.4);
}

// Whether the pointer has moved since the last frame, which is what says a
// mouse is in play: on a mouse the nose can be aimed without firing, and on a
// finger there is no pointer at all except while it is down.
let lastx = null;
let lasty = 0;

function pointerMoved() {
  const { mouse } = ent.game;
  const moved = lastx !== null && (mouse.x !== lastx || mouse.y !== lasty);
  lastx = mouse.x;
  lasty = mouse.y;
  return moved;
}

export function render(ctx) {
  const k = SIZE / W;
  const ox = EYEX - ship.pos.x;
  const oy = EYEY - ship.pos.y;

  ctx.save();
  ctx.scale(k, k);
  ctx.translate(ox, oy);
  drawStars(ctx);
  drawPath(ctx);
  ctx.restore();

  ctx.save();
  ctx.translate(ox * k, oy * k);
  ent.render(ctx);
  ctx.restore();

  ctx.save();
  ctx.scale(k, k);
  drawArrow(ctx, ox, oy);
  drawTank(ctx);
  ctx.restore();
}

// The patch repeated over whatever the view covers, which is at most two of it
// across and two down.
function drawStars(ctx) {
  ctx.fillStyle = css(STARLIGHT);
  const x0 = ship.pos.x - EYEX;
  const y0 = ship.pos.y - EYEY;
  const i0 = Math.floor(x0 / PATCH);
  const j0 = Math.floor(y0 / PATCH);
  for (let j = j0; j <= Math.floor((y0 + W) / PATCH); ++j) {
    for (let i = i0; i <= Math.floor((x0 + W) / PATCH); ++i) {
      const ox = i * PATCH;
      const oy = j * PATCH;
      for (let n = 0; n < stars.length; n += 3) {
        const x = ox + stars[n];
        const y = oy + stars[n + 1];
        if (x < x0 || y < y0 || x > x0 + W || y > y0 + W) continue;
        const s = stars[n + 2];
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
    }
  }
}

function drawPath(ctx) {
  if (path.length < 4 || dying > 0) return;
  // Red once the line ends on the ground at over CRASH, which is the whole of
  // the speed half of the landing rule said out loud. Without it the number is
  // one the player can only learn by dying at it.
  const bad = lands && landsAt > CRASH;
  ctx.strokeStyle = bad ? LINE_BAD : LINE;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ship.pos.x, ship.pos.y);
  for (let i = 0; i < path.length; i += 2) ctx.lineTo(path[i], path[i + 1]);
  ctx.stroke();

  // Where it ends, which is either AHEAD seconds out or the ground.
  const n = path.length;
  const r = lands ? 3 : 2;
  ctx.globalAlpha = lands ? 0.9 : 0.5;
  ctx.fillStyle = bad ? LINE_BAD : LINE;
  ctx.fillRect(path[n - 2] - r, path[n - 1] - r, 2 * r, 2 * r);
  ctx.globalAlpha = 1;
}

// The lit planet when it is off the screen, as an arrow at the edge pointing
// at it. The world is more than two screens across, so without this the only
// way to find it is to fly until it turns up.
function drawArrow(ctx, ox, oy) {
  if (target === null || dying > 0) return;
  const sx = target.pos.x + ox;
  const sy = target.pos.y + oy;
  if (
    sx > -target.r && sy > TOP - target.r && sx < W + target.r &&
    sy < W + target.r
  ) {
    return;
  }

  ctx.save();
  ctx.translate(
    clamp(sx, ARROW, W - ARROW),
    clamp(sy, TOP + ARROW, W - ARROW - 20),
  );
  ctx.rotate(Math.atan2(sy - EYEY, sx - EYEX));
  ctx.fillStyle = css(BROWN);
  ctx.beginPath();
  ctx.moveTo(-ARROW / 2, -ARROW / 2);
  ctx.lineTo(ARROW / 2, 0);
  ctx.lineTo(-ARROW / 2, ARROW / 2);
  ctx.fill();
  ctx.restore();
}

function drawTank(ctx) {
  const w = W - 2 * BAR_PAD;
  ctx.fillStyle = css(0x222222);
  ctx.fillRect(BAR_PAD, BAR_Y, w, BAR_H);
  ctx.fillStyle = css(fuel >= 15 ? BROWN : RED);
  ctx.fillRect(BAR_PAD, BAR_Y, w * clamp(fuel / TANK, 0, 1), BAR_H);
}
