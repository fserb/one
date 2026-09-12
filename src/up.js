/*
 * up. Based on Aba Games' WASD THRUST.
 *
 * Four thrusters, one an arrow key, each pushing the ship away from itself: the
 * one on top drives you down.
 *
 * No camera: the scene moves the world and not the view, so the ship stays at a
 * fixed 240 across and never above 200 down.
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
which pushes you off it. x and c spin
`,
  bg: "#464248",
  fg: "#E3C61E",
  scoreMax: true,
  date: "2014-03-30",
};

const W = 480;

// Climbing faster than the slide only moves the ship up to the pin at HOLD.
const SCROLL = 50;
const HOLD = 200;

// Below this and the ship is gone. Obstacles score when they cross it too.
const OUT = 500;

// Pieces the scene keeps stocked, counting those still above the screen, and
// the seconds the wreck holds before gameOver() runs.
const FIELD = 10;
const DEATH = 0.5;

// Thrust over drag is the top speed and one over drag the time to reach it, so
// these give 125 in half a second: over the 50 a second slide, under a dive
// into a field it cannot see coming.
const THRUST = 250;
const DRAG = 2;
const ARM = 30;
const SPIN = 2 * Math.PI;
const EXHAUST = 250;

const SHIP = 0x2ca244;
const SHIP_DARK = 0x1e702f;
const ROCK = 0xac0213;
const ROCK_DARK = 0x881511;
const GOLD = 0xe3c61e;
const GOLD_DARK = 0xdacc3d;
const GOLD_EDGE = 0xca8727;
const GOLD_TEXT = 0x604013;
const FLAME = 0xaa9936;
const FLAME_DARK = 0x988946;

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
    this.art.size(5, 4, 4).color(FLAME, FLAME_DARK, 23).rect(0, 0, 4, 4)
      .color(0xffffff).text(1.8, 1.8, label, 2);
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
      size: [5, 5],
      speed: [EXHAUST, 100],
      direction: [this.angle + this.offset - Math.PI / 8, Math.PI / 4],
      delay: [0, 0.05],
      duration: [0.25, 0.1],
    });
  }
}

class Player extends ent.Entity {
  constructor() {
    super();
    this.art.color(SHIP, SHIP_DARK, 253).size(20, 4, 4)
      .rect(0, 1.5, 4, 1).rect(1.5, 0, 1, 4);
    this.hitPoly([-40, -10, 40, -10, 40, 10, -40, 10]);
    this.hitPoly([-10, -40, 10, -40, 10, 40, -10, 40]);
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
    const { key, time } = ent.game;
    if (key.right) this.engines[0].fire();
    if (key.up) this.engines[1].fire();
    if (key.left) this.engines[2].fire();
    if (key.down) this.engines[3].fire();

    if (key.b1) this.angle -= SPIN * time;
    if (key.b2) this.angle += SPIN * time;

    this.accelerate(-DRAG * this.vel.x, -DRAG * this.vel.y);
    // Sliding sideways rolls the ship and a rolled ship thrusts sideways, so a
    // dodge left alone tips over within seconds. x and c spin it back.
    this.angle += time * this.vel.x / 200;

    if (this.pos.y > OUT) this.kill();
  }

  kill() {
    // At 20 to 50 a second this is a green lump. At 200 to 400 it is a ship
    // coming apart.
    new ent.Particle({
      x: this.pos.x,
      y: this.pos.y,
      color: SHIP,
      count: 100,
      size: [5, 25],
      speed: [200, 200],
      duration: [2, 0.5],
    });
    for (const e of this.engines) e.remove();
    this.remove();
    dying = DEATH;
  }
}

class Obstacle extends ent.Entity {
  begin() {
    this.art.color(ROCK, ROCK_DARK, 52).size(7, 4, 4)
      .rect(0, 1.5, 4, 1).rect(1.5, 0, 1, 4);
    place(this);
    this.angle = 2 * Math.PI * Math.random();
    this.hitBox(28);
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
      x: Math.min(Math.max(this.pos.x, 10), W - 10),
      y: W,
      vel: [0, -20],
      duration: 1,
    });
    this.remove();
  }
}

class Gold extends ent.Entity {
  begin() {
    this.points = Math.round(1 + Math.random() * 8) * 10;
    this.art.color(GOLD, GOLD_DARK, 23).size(3, 8, 7).rect(0, 0, 8, 7)
      .color(GOLD_EDGE).lrect(0, 0, 8, 7)
      .color(GOLD_TEXT).text(4, 3.5, String(this.points), 1);
    place(this);
    this.hitBox(24, 21);
  }

  update() {
    if (this.hit(player)) {
      score.value += this.points;
      new ent.Text({
        text: `+${this.points}`,
        x: this.pos.x,
        y: this.pos.y,
        vel: [0, -20],
        duration: 1,
      });
      this.remove();
      return;
    }

    if (this.pos.y >= OUT) this.remove();
  }
}

// Anywhere across, and up to a screen above the top one.
function place(e) {
  e.pos.x = W * Math.random();
  e.pos.y = -20 - (W - 20) * Math.random();
}

export function init() {
  ent.reset([Obstacle, Gold, Player, Engine, ent.Particle]);

  player = new Player();
  player.pos.x = player.pos.y = 240;
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
  const dx = W / 2 - player.pos.x;
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
      if (e.pos.x >= 0 && e.pos.x <= W && e.pos.y <= W) valid += 1;
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
