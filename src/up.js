/*
 * up. Based on Aba Games' WASD THRUST.
 *
 * Four thrusters, one an arrow key, each pushing the ship away from itself: the
 * one on top drives you down.
 *
 * No camera: the scene moves the world and not the view, so the ship stays at a
 * fixed 512 across and never above 425 down.
 *
 * The ship collides as two polygons, which turn: entity.js only turns a
 * polygon, not a box.
 */

import * as ent from "./lib/entity.js";
import { gameOver, score } from "./lib/one.js";

export const meta = {
  title: "up",
  desc: `
arrows fire the thruster on that side
which pushes you off it. space levels you
`,
  bg: "#464248",
  fg: "#E3C61E",
  scoreMax: true,
  date: "2014-03-30",
  dpad: true,
};

// Climbing faster than the slide only moves the ship up to the pin at HOLD.
const SCROLL = 105;
const HOLD = 425;

// Below this and the ship is gone. Obstacles score when they cross it too.
const OUT = 1070;

// Pieces the scene keeps stocked, counting those still above the screen, and
// the seconds the wreck holds before gameOver() runs.
const FIELD = 10;
const DEATH = 0.5;

// Thrust over drag is the top speed and one over drag the time to reach it, so
// these give 265 in half a second: over the 105 a second slide, under a dive
// into a field it cannot see coming.
const THRUST = 530;
const DRAG = 2;
const ARM = 64;
const SPIN = 2 * Math.PI;
const EXHAUST = 530;

const SHIP = 0x2ca244;
const SHIP_DARK = 0x1e702f;
const ROCK = 0xac0213;
const ROCK_DARK = 0x881511;
const GOLD = 0xe3c61e;
const GOLD_EDGE = 0xca8727;
const GOLD_TEXT = 0x604013;
// The WASD letter on each engine.
const KEY = 0xffffff;
const FLAME = 0xaa9936;
const FLAME_DARK = 0x988946;

// The ship and the rocks are the same plus: `arm` out from the centre, `half`
// across, with the darker tone on the square the two bars share. Two bars and
// not one path, since they overlap rather than meet, so no join shows.
function cross(gfx, arm, half, color, dark) {
  gfx.fill(color)
    .rect(-arm, -half, 2 * arm, 2 * half)
    .rect(-half, -arm, 2 * half, 2 * arm)
    .fill(dark).rect(-half, -half, 2 * half, 2 * half);
}

let player = null;
// Earned but not yet added to the score.
let adds = 0;
let dying = 0;

// The exhaust is what moves the ship, so firing pushes along `offset` reversed.
class Engine extends ent.Entity {
  constructor(ship, offset, label) {
    super();
    this.ship = ship;
    this.offset = offset;
    this.label = label;
    this.gfx.fill(FLAME).line(5, FLAME_DARK).rect(-19.5, -19.5, 39, 39, 12);
  }

  update() {
    const a = this.offset + this.ship.angle;
    this.pos.x = this.ship.pos.x + Math.cos(a) * ARM;
    this.pos.y = this.ship.pos.y + Math.sin(a) * ARM;
    this.angle = this.ship.angle;
  }

  fire() {
    this.ship.thrust(THRUST, this.offset + Math.PI);
    new ent.Particle({
      x: this.pos.x,
      y: this.pos.y,
      color: FLAME,
      count: [1, 2],
      size: [11, 11],
      speed: [EXHAUST, 210],
      direction: [this.angle + this.offset - Math.PI / 8, Math.PI / 4],
      delay: [0, 0.05],
      duration: [0.25, 0.1],
    });
  }

  render(ctx) {
    this.gfx.render(ctx);
    ctx.fillStyle = ent.css(KEY);
    ctx.text(this.label, 0, 0, 34);
  }
}

class Player extends ent.Entity {
  constructor() {
    super();
    cross(this.gfx, 84, 21, SHIP, SHIP_DARK);
    this.hitPoly([-84, -21, 84, -21, 84, 21, -84, 21]);
    this.hitPoly([-21, -84, 21, -84, 21, 84, -21, 84]);
    // Right, up, left, down: the order Player.update() fires them.
    this.engines = ["D", "W", "A", "S"].map((label, i) =>
      new Engine(this, -i * Math.PI / 2, label)
    );
  }

  thrust(force, a) {
    this.accelerate(
      force * Math.cos(this.angle + a),
      force * Math.sin(this.angle + a),
    );
  }

  update() {
    const { input, time } = ent.game;
    if (input.press.right) this.engines[0].fire();
    if (input.press.up) this.engines[1].fire();
    if (input.press.left) this.engines[2].fire();
    if (input.press.down) this.engines[3].fire();

    // One button rather than a key for each way round: what the pair was for
    // was getting back upright, and this turns whichever way is shorter.
    if (input.press.act) {
      const off = Math.atan2(Math.sin(this.angle), Math.cos(this.angle));
      this.angle -= Math.sign(off) * Math.min(SPIN * time, Math.abs(off));
    }

    this.accelerate(-DRAG * this.vel.x, -DRAG * this.vel.y);
    // Sliding sideways rolls the ship and a rolled ship thrusts sideways, so a
    // dodge left alone tips over within seconds. Levelling brings it back.
    this.angle += time * this.vel.x / 425;

    if (this.pos.y > OUT) this.kill();
  }

  kill() {
    // At 40 to 105 a second this is a green lump. At 425 to 850 it is a ship
    // coming apart.
    new ent.Particle({
      x: this.pos.x,
      y: this.pos.y,
      color: SHIP,
      count: 100,
      size: [11, 53],
      speed: [425, 425],
      duration: [2, 0.5],
    });
    for (const e of this.engines) e.remove();
    this.remove();
    dying = DEATH;
  }
}

class Obstacle extends ent.Entity {
  begin() {
    cross(this.gfx, 30, 7.5, ROCK, ROCK_DARK);
    place(this);
    this.angle = 2 * Math.PI * Math.random();
    this.hitBox(60);
  }

  update() {
    if (this.hit(player)) {
      player.kill();
      this.remove();
      return;
    }

    if (this.pos.y < OUT) return;
    score.value += 5;
    new ent.Text({
      text: "+5",
      x: Math.min(Math.max(this.pos.x, 20), 1004),
      y: 1024,
      size: 20,
      vel: [0, -40],
      duration: 1,
    });
    this.remove();
  }
}

class Gold extends ent.Entity {
  begin() {
    this.points = Math.round(1 + Math.random() * 8) * 10;
    this.gfx.fill(GOLD).line(6, GOLD_EDGE).rect(-21, -18, 42, 36, 10);
    place(this);
    this.hitBox(48, 42);
  }

  update() {
    if (this.hit(player)) {
      score.value += this.points;
      new ent.Text({
        text: `+${this.points}`,
        x: this.pos.x,
        y: this.pos.y,
        size: 20,
        vel: [0, -40],
        duration: 1,
      });
      this.remove();
      return;
    }

    if (this.pos.y >= OUT) this.remove();
  }

  render(ctx) {
    this.gfx.render(ctx);
    ctx.fillStyle = ent.css(GOLD_TEXT);
    ctx.text(String(this.points), 0, 0, 19);
  }
}

// Anywhere across, and up to a screen above the top one.
function place(e) {
  e.pos.x = 1024 * Math.random();
  e.pos.y = -40 - 984 * Math.random();
}

export function init() {
  ent.reset([Obstacle, Gold, Player, Engine, ent.Particle]);

  player = new Player();
  player.pos.x = player.pos.y = 512;
  adds = 0;
  dying = 0;
}

export function update(dt) {
  // The slide is the only thing that moves a piece, so holding it also stops an
  // obstacle scoring.
  if (dying > 0) {
    dying -= dt;
    ent.update(dt);
    if (dying <= 0) gameOver({ score: true });
    return;
  }

  // Before the entities, and the order matters: this slides the world out from
  // under a step that has not run.
  const dx = 512 - player.pos.x;
  const dy = Math.max(SCROLL * dt, HOLD - player.pos.y);
  player.pos.x += dx;
  player.pos.y += dy;

  // One still above the screen counts, so the field is stocked before it
  // arrives; one below is out of the count until the ship flies back.
  let valid = 0;
  for (const cls of [Obstacle, Gold]) {
    for (const e of ent.get(cls)) {
      e.pos.x += dx;
      e.pos.y += dy;
      if (e.pos.x >= 0 && e.pos.x <= 1024 && e.pos.y <= 1024) valid += 1;
    }
  }

  if (valid < FIELD) {
    if (Math.random() < 0.1) new Gold();
    else new Obstacle();
    valid += 1;
  }

  // A tenth of a point a second per piece in play.
  adds += valid * dt / 10;
  if (adds >= 1) {
    score.value += 1;
    adds -= 1;
  }

  ent.update(dt);
}

export { render } from "./lib/entity.js";
