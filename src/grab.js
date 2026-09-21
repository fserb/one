// grab - "the name of the game is grab". Ludum Dare 32, April 2015; the weapon
// is Blitzcrank's hook.

import * as ent from "./lib/entity.js";
import { delay } from "./lib/effects.js";
import { shake } from "./lib/camera.js";
import { gameOver, score } from "./lib/one.js";
import * as play from "./lib/sounds.js";

export { render, update } from "./lib/entity.js";

export const meta = {
  title: "grab",
  bg: "#010101",
  fg: "#FAFAFA",
  scoreMax: true,
  date: "2015-04-18",
  release: true,
  dpad: true,
};

const BLACK = 0x010101;
const WHITE = 0xfafafa;

// Named as the write-up named them: its `cyan` is this purple and its `purple`
// this pink.
const YELLOW = 0xffdc3b;
const PINK = 0xff54b1;
const PURPLE = 0xaa00ff;
const BLUE = 0x00aaff;
const FLOORS = [YELLOW, PURPLE, BLUE, PINK];

const CENTER = { x: 512, y: 512 };

// How far off each wall the ghosts start, and where the player's wall is.
const EDGE = 21;

const PR = 34;
const PUSH = 3600;
const DRAG = 5;

const IDLE = 0;
const OUT = 1;
const BACK = 2;
const MAXARM = 425;
const THROW = 1070;
const PULL = 1700;
const CLAW = 21;

const GR = 21;
const BR = 13;
// Seconds a fresh ghost cannot hurt you and will not shoot, over the speed.
const GRACE = 1.5;
const KEEP = 275; // pink's stand-off, and the radius its bullet swings at
const FAR = 425; // yellow's distance from the centre, and purple's throw
const DODGE = 107;
// Both over the speed: how fast a ghost walks and how fast a bullet travels.
const WALK = 107;
const SHOT = 215;

let speed = 1.5;
let floor = YELLOW;
let player = null;
let hook = null;
let label = null;

class Floor extends ent.Entity {
  constructor() {
    super();
    this.pos.x = 512;
    this.pos.y = 512;
  }

  update() {
    this.gfx.cache(floor).fill(floor).rect(-512, -512, 1024, 1024);
  }
}

class Player extends ent.Entity {
  constructor() {
    super();
    this.pos.x = 512;
    this.pos.y = 512;
    this.dying = false;
    this.gfx.fill(BLACK).circle(0, 0, PR);
    this.hitCircle(PR);
  }

  // The keys or the pad move, and the pointer aims. Alone in the collection,
  // this is not playable with either one alone.
  update() {
    const { input } = ent.game;

    if (this.dying) return; // EndGame ends the round once the board is black

    if (hook.action === IDLE) {
      let mx = 0;
      let my = 0;
      if (input.press.left) mx -= 1;
      if (input.press.right) mx += 1;
      if (input.press.up) my -= 1;
      if (input.press.down) my += 1;

      const l = Math.hypot(mx, my);
      if (l > 0) this.accelerate(mx * PUSH / l, my * PUSH / l);
      this.accelerate(-this.vel.x * DRAG, -this.vel.y * DRAG);
    } else {
      // Throwing holds you still: the hook is your whole defence while out.
      this.vel.x = this.vel.y = 0;
    }

    this.bounce("x");
    this.bounce("y");

    // Reeling a ghost in moves you through everything else without collision.
    if (hook.target !== null) return;
    if (this.hitGroup(Bullet) !== null) return this.die();
    for (const g of ent.get(Ghost)) {
      if (g.wait === 0 && this.hit(g)) return this.die();
    }
  }

  // The walls return the speed you hit them with.
  bounce(k) {
    if (this.pos[k] < EDGE) {
      this.pos[k] = EDGE;
      this.vel[k] = Math.abs(this.vel[k]);
    } else if (this.pos[k] > 1024 - EDGE) {
      this.pos[k] = 1024 - EDGE;
      this.vel[k] = -Math.abs(this.vel[k]);
    }
  }

  die() {
    play.explode();
    this.clearHits();
    this.vel.x = this.vel.y = 0;
    this.dying = true;
    delay(0.2);
    shake(0.5);
    new EndGame(this.pos.x, this.pos.y);
  }
}

// Points at the pointer while idle, goes out at THROW and comes back at PULL.
// `target` is the ghost it caught, which comes back with it.
class Hook extends ent.Entity {
  constructor() {
    super();
    this.arm = 0;
    this.action = IDLE;
    this.target = null;
    // A hit shape does not turn with `angle`, so the circle is on the origin.
    this.hitCircle(CLAW);
    this.draw();
  }

  // The claw is the origin and the arm extends back from it, so size() keeps
  // the centre fixed as the arm changes length.
  draw() {
    this.gfx.cache(this.arm)
      .size(2 * CLAW, 2 * Math.max(21, this.arm))
      .fill(BLACK)
      .circle(0, 0, 6)
      .rect(-5, -21, 11, 21)
      .rect(-5, 0, 11, this.arm);
    prong(this.gfx, -Math.PI / 6);
    prong(this.gfx, Math.PI + Math.PI / 6);
  }

  update() {
    if (player.dying) return;
    const { input, time } = ent.game;
    const p = player.pos;

    if (this.action === IDLE) {
      // The drawing points along its own -y, so the aim is a quarter turn on.
      this.angle = angle(p, input) + Math.PI / 2;
      if (input.just.act) {
        play.shoot();
        this.action = OUT;
      }
    } else if (this.action === OUT) {
      this.arm = Math.min(MAXARM, this.arm + time * THROW);
      const g = this.hitGroup(Ghost);
      if (g !== null) this.grab(g);
      else if (this.arm === MAXARM) this.action = BACK;
    } else {
      const was = this.arm;
      this.arm = Math.max(0, this.arm - time * PULL);
      // The arm's lost length splits between the two, so a grab also travels.
      if (this.target !== null) {
        const step = (was - this.arm) / 2;
        towards(p, this.target.pos, step);
        towards(this.target.pos, p, step);
      }
      if (this.arm === 0) {
        if (this.target !== null) eat(this.target.color);
        this.target = null;
        this.action = IDLE;
      }
    }

    this.draw();
    // The claw is 23 out plus the arm, so the arm's far end stays 23 out.
    const { x, y } = polar(p, 23 + this.arm, this.angle - Math.PI / 2);
    this.pos.x = x;
    this.pos.y = y;
  }

  grab(g) {
    play.hit();
    this.target = g;
    g.grabbed = true;
    this.action = BACK;
    delay(0.05);
    // Everything gets a moment off, so the two you did not catch are not on
    // top of you when the reel lands.
    for (const o of ent.get(Ghost)) o.wait = GRACE / speed;
  }
}

class Bullet extends ent.Entity {
  constructor(color, p) {
    super();
    this.color = color;
    this.pos.x = p.x;
    this.pos.y = p.y;
    this.gfx.fill(color)
      .circle(0, 0, BR).rect(-BR, 0, 2 * BR, BR)
      .fill(WHITE, 0.9).circle(-4, -2, 2).circle(4, -2, 2);
    this.hitCircle(BR);
  }

  update() {
    // Pink's and purple's are steered directly; only fired ones leave.
    if (this.color === PINK || this.color === PURPLE) return;
    const { x, y } = this.pos;
    if (x < 0 || x > 1024 || y < 0 || y > 1024) this.remove();
  }
}

// All four walk at WALK towards a point and differ only in how they pick the
// point and what they do with their one bullet.
class Ghost extends ent.Entity {
  constructor(color, x = null, y = null) {
    super();
    this.color = color;
    // The corner furthest from the player, unless the round opened with four.
    this.pos.x = x ?? (player.pos.x <= 512 ? 1024 - 43 : 43);
    this.pos.y = y ?? (player.pos.y <= 512 ? 1024 - 43 : 43);
    this.grabbed = false;
    this.wait = GRACE / speed;
    this.bullet = null;
    this.turn = 0;
    this.spin = 1;
    this.seen = IDLE;
    this.target = color === BLUE ? { ...CENTER } : { ...this.pos };

    this.gfx.fill(color)
      .circle(0, 0, GR).rect(-GR, 0, 2 * GR, GR)
      .fill(WHITE, 0.9).circle(-6, -4, 4).circle(6, -4, 4);
    this.hitBox(2 * GR);
  }

  update() {
    this.wait = Math.max(0, this.wait - ent.game.time);

    // The floor's colour is out of play, so a ghost leaves when its own lands.
    if (this.color === floor) {
      this.remove();
      this.bullet?.remove();
      return;
    }
    if (this.grabbed) return;

    wrap(this.target);
    if (this.color === PINK) this.orbit();
    else if (this.color === PURPLE) this.fetch();
    else if (this.color === YELLOW) this.snipe();
    else this.answer();
    wrap(this.pos);
  }

  walk(q) {
    towards(this.pos, q, WALK * speed * ent.game.time);
  }

  steer(q) {
    towards(this.bullet.pos, q, SHOT * speed * ent.game.time);
  }

  // Pink stays KEEP away, either side, and swings its bullet around itself on
  // an arm the same length.
  orbit() {
    if (this.wait === 0 && gone(this.bullet)) {
      this.bullet = new Bullet(this.color, this.pos);
      this.spin = Math.random() < 0.5 ? 1 : -1;
    }

    const side = dist(this.pos, player.pos) < KEEP ? -KEEP : KEEP;
    this.walk(polar(this.pos, side, angle(this.pos, player.pos)));

    if (gone(this.bullet)) return;
    this.turn += this.spin * Math.PI * 0.1 * speed * ent.game.time;
    this.steer(polar(this.pos, KEEP, this.turn));
  }

  // Purple throws its bullet FAR towards you and walks over to collect it, so
  // it is always between you.
  fetch() {
    if (dist(this.pos, this.target) < 21) {
      this.bullet?.remove();
      this.bullet = null;
      if (this.wait > 0) return;

      const a = angle(this.pos, player.pos);
      this.bullet = new Bullet(this.color, this.pos);
      this.bullet.angle = a + Math.PI / 2;
      this.target = polar(this.pos, FAR, a);
      return;
    }

    if (!gone(this.bullet) && dist(this.bullet.pos, this.target) > 11) {
      this.steer(this.target);
      return;
    }
    this.walk(this.target);
  }

  // Yellow stands FAR out from the centre on the far side from you, and fires
  // whenever it has nothing in the air.
  snipe() {
    this.walk(polar(CENTER, FAR, angle(player.pos, CENTER)));
    if (this.wait === 0 && gone(this.bullet)) this.bullet = shoot(this);
  }

  // Blue watches the hook: every throw makes it step DODGE sideways and shoot
  // back, and it does not wait out its grace period first.
  answer() {
    if (this.seen !== OUT && hook.action === OUT) {
      const a = angle(player.pos, this.pos) + Math.PI / 2;
      this.target = polar(this.pos, Math.random() < 0.5 ? DODGE : -DODGE, a);
      if (gone(this.bullet)) this.bullet = shoot(this);
    }
    this.seen = hook.action;
    this.walk(this.target);
  }
}

// A black square on the spot where you died, whose corners then move to the
// four corners of the board, one at a time: all four at once would expand the
// square, where one at a time stretches the black out of the shape.
// [corner, x, y]: top-left, bottom-left, top-right, bottom-right.
const SWEEP = [[0, 0, 0], [3, 0, 1024], [1, 1024, 0], [2, 1024, 1024]];

class EndGame extends ent.Entity {
  constructor(x, y) {
    super();
    this.pos.x = 512;
    this.pos.y = 512;
    this.stage = 0;
    this.p = [
      { x: x - 21, y: y - 21 },
      { x: x + 21, y: y - 21 },
      { x: x + 21, y: y + 21 },
      { x: x - 21, y: y + 21 },
    ];
    this.draw();
  }

  update() {
    if (this.stage === SWEEP.length) return;

    const [i, x, y] = SWEEP[this.stage];
    const p = this.p[i];
    towards(p, { x, y }, 10700 * ent.game.time);
    if (p.x === x && p.y === y) this.stage += 1;
    this.draw();

    if (this.stage === SWEEP.length) gameOver({ score: true });
  }

  // size() fixes the box to the board, so a corner moving does not shift it.
  draw() {
    const [a, b, c, d] = this.p;
    this.gfx.clear().size(1024, 1024, 512, 512).fill(BLACK)
      .mt(a.x, a.y).lt(b.x, b.y).lt(c.x, c.y).lt(d.x, d.y);
  }
}

function prong(gfx, a) {
  const vx = Math.cos(a);
  const vy = Math.sin(a);
  const nx = -vy * 5.5;
  const ny = vx * 5.5;
  gfx.mt(nx, ny)
    .lt(nx + 21 * vx, ny + 21 * vy)
    .lt(-nx + 21 * vx, -ny + 21 * vy)
    .lt(-nx, -ny);
}

const gone = (b) => b === null || b.dead;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angle = (from, to) => Math.atan2(to.y - from.y, to.x - from.x);

// The point `r` from `p` in the direction `a`.
function polar(p, r, a) {
  return { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r };
}

// `max` towards `q`, or onto it.
function towards(p, q, max) {
  const d = dist(p, q);
  if (d <= max) {
    p.x = q.x;
    p.y = q.y;
    return;
  }
  p.x += (q.x - p.x) * max / d;
  p.y += (q.y - p.y) * max / d;
}

// The board is a torus: a ghost leaving one edge comes back at the other.
function wrap(p) {
  if (p.x < 0) p.x += 1024;
  if (p.x >= 1024) p.x -= 1024;
  if (p.y < 0) p.y += 1024;
  if (p.y >= 1024) p.y -= 1024;
}

// Fired at the player and then left to itself. Yellow's and blue's.
function shoot(g) {
  const b = new Bullet(g.color, g.pos);
  const a = angle(g.pos, player.pos);
  b.vel.x = Math.cos(a) * SHOT * speed;
  b.vel.y = Math.sin(a) * SHOT * speed;
  b.angle = a + Math.PI / 2;
  return b;
}

// Its colour becomes the floor, taking it off the board, and the colour it
// replaces walks back on.
function eat(color) {
  new Ghost(floor);
  shake(0.2);
  floor = color;
  speed *= 1.06;
  ent.addScore(1, player.pos.x, player.pos.y, { color: BLACK });
  label.text = String(score.value);
}

export function init() {
  ent.reset([Floor, Bullet, Ghost, Hook, Player, ent.Text, EndGame]);

  speed = 1.5;
  floor = FLOORS[Math.floor(Math.random() * FLOORS.length)];

  new Floor();
  player = new Player();
  hook = new Hook();
  // Black like the player and the hook, so the sweep at the end covers it.
  label = new ent.Text({ text: "0", x: 512, y: 64, size: 64, color: BLACK });

  // One per corner; the one with the floor's colour leaves on frame one.
  const corners = [
    [YELLOW, EDGE, EDGE],
    [PURPLE, 1024 - EDGE, EDGE],
    [BLUE, 1024 - EDGE, 1024 - EDGE],
    [PINK, EDGE, 1024 - EDGE],
  ];
  for (const [color, x, y] of corners) new Ghost(color, x, y);
}
