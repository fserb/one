/*
 * jeb - "Jebediah's Revenge".
 *
 * A lander in a system of planets. Gravity is the only thing moving you between
 * them: the green line out of the nose is where you go if you do nothing, drawn
 * AHEAD seconds ahead through the same gravity, ending where you would hit. One
 * planet is lit; land on it slowly and upright and it fills the tank and lights
 * another. The tank is the clock and drains whether you burn or not.
 *
 * The landing rule is the whole of it: over CRASH and you are scrap, more than
 * a quarter turn off the upright of where you touched down and you are scrap,
 * otherwise the ship stops dead and snaps to the vertical. The second is the
 * one that catches you, because rotating is slow.
 *
 * That rule runs on arrival, not on every frame of contact: re-snapping the
 * angle every frame leaves no way to point the nose before lifting off. A
 * landed ship is put on the surface rather than left to sink into it,
 * except while it is burning away, or a frame of thrust moves it less than the
 * resting rule puts back and it can never leave.
 *
 * Gravity is every planet at once, so the pull does not jump when the nearest
 * planet changes. MU is per unit of radius squared, so every planet has the
 * same gravity underfoot, and THRUST is picked against that.
 *
 * The stars are in world coordinates and the patch tiles: the ship holds at the
 * centre and the world moves past it, so on black with no planet in frame
 * nothing else says you are moving, and nothing stops you leaving the system.
 */

import * as ent from "./lib/entity.js";
import { gameOver, hint, score, SIZE } from "./lib/one.js";
import { blip, explosion, powerup } from "./lib/fsfx/sfxr.js";
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

// The 480 box, and where the ship is pinned.
const W = 480;
const EYEX = W / 2;
const EYEY = W / 2;

// A planet is drawn as a chunky circle PX units to the pixel, so its radius is
// PX times its own cell count.
const WORLD = 1100;
const EDGE = 130;
const PLANETS = 6;
const GAP = 150;
const PX = 4;
const CELL_MIN = 6;
const CELL_MAX = 11;

// Per unit of radius squared, so the surface pull is the same on every planet.
// An actual planet pulls MU*r*r/d/d.
const MU = 120;
// Per second. THRUST is picked against MU: 320 against a surface pull of 120
// leaves the ground at 200, so take-off is not most of a tank.
const THRUST = 320;
const TURN = Math.PI;
const CRASH = 62;
// A quarter turn off the vertical of where you touched down.
const TILT = Math.PI / 4;

// One pointer has to aim and burn, so HOLD separates them: a lander that
// cannot turn without firing cannot be landed.
const SHIP_R = 8;
const DEAD = 10;
const AIM_LAG = 0.18;

// REFILL_OFF is the whole of the ramp: the drain and the burn stay put, and a
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

// The patch tiles, so there are stars wherever the ship goes. Nothing stops
// you leaving the system, and out there the stars and the arrow are all there
// is to say which way is back.
const PATCH = 700;
const STARS = 150;
const STAR = 1.6;

const BAR_Y = W - 13;
const BAR_H = 5;
const BAR_PAD = 30;
const ARROW = 10;

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

const SHIP = `
.000.
00300
00100
00000
02220
`;

// The vols are the original game's own volumes.
sound.voice("burn", { ...blip(511), vol: 0.05 });
sound.voice("land", { ...powerup(3607), vol: 0.13 });
sound.voice("crash", { ...explosion(3613), vol: 0.2 });

let ship = null;
// Not read back out of entity.js: ent.get() hides entities that have not begun,
// which is all of them while init() runs, and predict() asks two hundred times
// a frame.
const planets = [];
// Stars are three numbers each and never move.
let target = null;
let fuel = 0;
let dying = 0;
const stars = [];
// Rebuilt every frame as a flat list of world x, y.
const path = [];
let lands = false;
let landsAt = 0;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const css = (c) => `#${c.toString(16).padStart(6, "0")}`;

// Signed, in [-PI, PI). JS's % keeps the sign of its left side, so the usual
// one-liner reads a quarter turn as three quarters once enough left turns have
// taken `angle` below -3*PI. Wrapping the difference works wherever it came
// from, where wrapping `angle` itself needs doing every frame.
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
    // The sprite's nose is -y at angle 0, so upright on top is zero.
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
    // Read every frame, or a run of arrow keys reports as one move at the end.
    const aiming = pointerMoved() || mouse.press;

    // A rate, not a jump: the turn is what you have to have started early.
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
    sound.play("burn", -4 + 8 * Math.random());
    new ent.Particle({
      x: this.pos.x - Math.cos(a) * 12,
      y: this.pos.y - Math.sin(a) * 12,
      color: BROWN,
      count: 3,
      size: 3,
      speed: [60, 30],
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

      // A take-off. Without this the ship can never leave: a frame of thrust
      // moves it a fraction of a unit and the resting rule below puts it back.
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
   * The landing rule, on arrival only: over CRASH is scrap, more than TILT off
   * the vertical of the place you touched down is scrap, and otherwise the
   * ship snaps to that vertical and stops dead.
   *
   * Arrival only: running the whole of it every frame the ship is in contact
   * pins a resting ship upright and leaves no way to turn on the ground.
   * Turning is slow and it is the half of the landing that catches you; being
   * able to point the nose before lifting off is most of what makes the next
   * one possible.
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
  new ent.Particle({
    x: ship.pos.x,
    y: ship.pos.y,
    color: GREY,
    count: 90,
    size: 3,
    speed: [30, 90],
    duration: [0.7, 0.5],
  });
  new ent.Particle({
    x: ship.pos.x,
    y: ship.pos.y,
    color: RED,
    count: 40,
    size: 4,
    speed: [20, 60],
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
    size: 2,
    speed: [70, 40],
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
  hint(meta.desc);
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

  // The tank holds while the hint is up. The ship starts landed anyway.
  if (hint() <= 0) {
    fuel -= (LIFE + (ship.burning ? BURN : 0)) * t;
  }
  predict();
  if (fuel > 0) return;
  fuel = 0;
  expire();
}

// The other way a round ends, and not a crash.
function expire() {
  if (dying > 0) return;
  dying = DEATH;
  sound.play("crash", -8);
  new ent.Particle({
    x: ship.pos.x,
    y: ship.pos.y,
    color: GREY,
    count: 24,
    size: 2,
    speed: [10, 26],
    duration: [0.8, 0.4],
  });
}

// What says a mouse is in play: on a mouse the nose aims without firing, and on
// a finger there is no pointer except while it is down.
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
  // The speed half of the landing rule, said out loud.
  const bad = lands && landsAt > CRASH;
  ctx.strokeStyle = bad ? LINE_BAD : LINE;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ship.pos.x, ship.pos.y);
  for (let i = 0; i < path.length; i += 2) ctx.lineTo(path[i], path[i + 1]);
  ctx.stroke();

  const n = path.length;
  const r = lands ? 3 : 2;
  ctx.globalAlpha = lands ? 0.9 : 0.5;
  ctx.fillStyle = bad ? LINE_BAD : LINE;
  ctx.fillRect(path[n - 2] - r, path[n - 1] - r, 2 * r, 2 * r);
  ctx.globalAlpha = 1;
}

// An arrow at the edge when the lit planet is off screen. The world is more
// than two screens across, so without it you fly until it turns up.
function drawArrow(ctx, ox, oy) {
  if (target === null || dying > 0) return;
  const sx = target.pos.x + ox;
  const sy = target.pos.y + oy;
  if (
    sx > -target.r && sy > -target.r && sx < W + target.r &&
    sy < W + target.r
  ) {
    return;
  }

  ctx.save();
  ctx.translate(
    clamp(sx, ARROW, W - ARROW),
    clamp(sy, ARROW, W - ARROW - 20),
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
