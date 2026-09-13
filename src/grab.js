/*
 * grab - "the name of the game is grab". Ludum Dare 32, April 2015; the weapon
 * is Blitzcrank's hook.
 *
 * The floor is one of four colours and the ghost of that colour is off the
 * board.
 * Hook one of the other three and reel it in: its colour becomes the floor, it
 * leaves, and the old floor colour walks back on.
 *
 * It needs a keyboard or gamepad to move and a pointer to aim. Alone in the
 * collection, it is not playable with either one alone.
 */

import * as ent from "./lib/entity.js";
import { delay } from "./lib/effects.js";
import { shake } from "./lib/camera.js";
import { gameOver, score } from "./lib/one.js";
import { explosion, hit, laser } from "./lib/fsfx/sfxr.js";
import * as sound from "./lib/sound.js";

export const meta = {
  title: "grab",
  desc: `
arrows move, the mouse aims and throws
grab a ghost, its colour becomes the floor
`,
  bg: "#010101",
  fg: "#FAFAFA",
  scoreMax: true,
  date: "2015-04-18",
  dpad: true,
};

const BLACK = 0x010101;
const WHITE = 0xfafafa;

// Named as the write-up named them, which is not what two of them look like:
// its `cyan` is this purple and its `purple` this pink.
const YELLOW = 0xffdc3b;
const PINK = 0xff54b1;
const PURPLE = 0xaa00ff;
const BLUE = 0x00aaff;
const FLOORS = [YELLOW, PURPLE, BLUE, PINK];

// How far off each wall the ghosts start, and where the player's wall is.
const EDGE = 21;

const PR = 34;
const PUSH = 3600;
const DRAG = 5;
// The hitstop the death holds for, and how fast the black quad's corners move.
const HITSTOP = 0.2;
const FLY = 10700;

const IDLE = 0;
const OUT = 1;
const BACK = 2;
const REEL = 3;
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

// sfxr squares the vol, so the hook is a quarter the loudness of the other two.
sound.voice("hook", { ...laser(1249), vol: 0.1 });
sound.voice("grab", { ...hit(1249), vol: 0.2 });
sound.voice("hit", { ...explosion(1238), vol: 0.2 });

let speed = 1.5;
let floor = YELLOW;
let player = null;
let hook = null;

class Floor extends ent.Entity {
  constructor() {
    super();
    this.pos.x = this.pos.y = 512;
  }

  update() {
    this.gfx.cache(floor).fill(floor).rect(-512, -512, 1024, 1024);
  }
}

class Player extends ent.Entity {
  constructor() {
    super();
    this.pos.x = this.pos.y = 512;
    this.dying = false;
    this.gfx.fill(BLACK).circle(0, 0, PR);
    this.hitCircle(PR);
  }

  update() {
    const { input } = ent.game;

    if (this.dying) return; // EndGame ends the round once the board is black

    if (hook.action === IDLE) {
      let mx = 0;
      let my = 0;
      if (input.press.left) mx = -1;
      if (input.press.right) mx = 1;
      if (input.press.up) my = -1;
      if (input.press.down) my = 1;

      const l = Math.hypot(mx, my);
      if (l > 0) this.accelerate(mx * PUSH / l, my * PUSH / l);
      this.accelerate(-this.vel.x * DRAG, -this.vel.y * DRAG);
    } else {
      // Throwing holds you still: the hook is your whole defence while out.
      this.vel.x = this.vel.y = 0;
    }

    // The walls return the speed you hit them with.
    if (this.pos.x <= EDGE) {
      this.pos.x = EDGE;
      this.vel.x = Math.abs(this.vel.x);
    }
    if (this.pos.x >= 1024 - EDGE) {
      this.pos.x = 1024 - EDGE;
      this.vel.x = -Math.abs(this.vel.x);
    }
    if (this.pos.y <= EDGE) {
      this.pos.y = EDGE;
      this.vel.y = Math.abs(this.vel.y);
    }
    if (this.pos.y >= 1024 - EDGE) {
      this.pos.y = 1024 - EDGE;
      this.vel.y = -Math.abs(this.vel.y);
    }

    // Reeling a ghost in moves you through everything else without collision.
    if (hook.action === REEL) return;
    if (this.hitGroup(Bullet) !== null) return this.die();
    for (const g of ent.get(Ghost)) {
      if (g.wait === 0 && this.hit(g)) return this.die();
    }
  }

  die() {
    sound.play("hit");
    this.clearHits();
    this.vel.x = this.vel.y = 0;
    this.dying = true;
    delay(HITSTOP);
    shake(0.5);
    new EndGame(this.pos.x, this.pos.y);
  }
}

// Points at the pointer while idle, goes out at THROW, comes back at PULL with
// whatever it caught.
class Hook extends ent.Entity {
  constructor() {
    super();
    this.arm = 0;
    this.action = IDLE;
    this.target = null;
    // A hit shape does not turn with `angle`, so the circle is on the entity's
    // origin and draw() puts the claw there.
    this.hitCircle(CLAW);
    this.draw();
  }

  // The claw is the origin and the arm extends back from it, so size() keeps
  // the drawing's centre fixed as the arm changes length.
  draw() {
    this.gfx.clear()
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
      this.angle = Math.atan2(input.y - p.y, input.x - p.x) + Math.PI / 2;
      if (input.just.act) {
        sound.play("hook");
        this.action = OUT;
      }
    } else if (this.action === OUT) {
      this.arm = Math.min(MAXARM, this.arm + time * THROW);
      this.draw();

      const g = this.hitGroup(Ghost);
      if (g !== null) {
        sound.play("grab");
        this.target = g;
        g.grabbed = true;
        this.action = REEL;
        delay(0.05);
        // Everything gets a moment off, so the two you did not catch are not
        // on top of you when the reel lands.
        for (const o of ent.get(Ghost)) o.wait = GRACE / speed;
      } else if (this.arm === MAXARM) {
        this.action = BACK;
      }
    } else if (this.action === BACK) {
      this.arm = Math.max(0, this.arm - time * PULL);
      this.draw();
      if (this.arm === 0) this.action = IDLE;
    } else {
      const was = this.arm;
      this.arm = Math.max(0, this.arm - time * PULL);
      // The arm's lost length splits between the two, so a grab also travels.
      const step = (was - this.arm) / 2;
      const t = this.target.pos;
      const a = Math.atan2(t.y - p.y, t.x - p.x);
      p.x += Math.cos(a) * step;
      p.y += Math.sin(a) * step;
      t.x -= Math.cos(a) * step;
      t.y -= Math.sin(a) * step;
      this.draw();

      if (this.arm === 0) {
        eat(this.target.color);
        this.action = IDLE;
      }
    }

    // The claw is 23 out plus the arm's length, so the arm's far end stays
    // 23 out whatever the arm does.
    this.pos.x = p.x + (23 + this.arm) * Math.cos(this.angle - Math.PI / 2);
    this.pos.y = p.y + (23 + this.arm) * Math.sin(this.angle - Math.PI / 2);
  }
}

class Bullet extends ent.Entity {
  constructor(color, x, y) {
    super();
    this.color = color;
    this.pos.x = x;
    this.pos.y = y;
    this.gfx.fill(color)
      .circle(0, 0, BR).rect(-BR, 0, 2 * BR, BR)
      .fill(WHITE, 0.9).circle(-4, -2, 2).circle(4, -2, 2);
    this.hitCircle(BR);
  }

  update() {
    // Pink's and purple's are steered directly; only the ones fired and left
    // alone leave the board.
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
    this.target = color === BLUE
      ? { x: 512, y: 512 }
      : { x: this.pos.x, y: this.pos.y };

    this.gfx.fill(color)
      .circle(0, 0, GR).rect(-GR, 0, 2 * GR, GR)
      .fill(WHITE, 0.9).circle(-6, -4, 4).circle(6, -4, 4);
    this.hitBox(2 * GR);
  }

  update() {
    this.wait = Math.max(0, this.wait - ent.game.time);

    // The floor's colour is out of play, so a ghost leaves when its own is put
    // down.
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

  // Pink stays KEEP away, either side, and swings its bullet around itself on
  // an arm the same length.
  orbit() {
    const { time } = ent.game;
    if (this.wait === 0 && gone(this.bullet)) {
      this.bullet = new Bullet(this.color, this.pos.x, this.pos.y);
      this.spin = Math.random() < 0.5 ? 1 : -1;
    }

    const a = angle(this.pos, player.pos);
    const side = dist(this.pos, player.pos) < KEEP ? -KEEP : KEEP;
    towards(
      this.pos,
      this.pos.x + Math.cos(a) * side,
      this.pos.y + Math.sin(a) * side,
      WALK * speed * time,
    );

    if (gone(this.bullet)) return;
    this.turn += this.spin * Math.PI * 0.1 * speed * time;
    towards(
      this.bullet.pos,
      this.pos.x + Math.cos(this.turn) * KEEP,
      this.pos.y + Math.sin(this.turn) * KEEP,
      SHOT * speed * time,
    );
  }

  // Purple throws its bullet FAR towards you and walks over to collect it, so
  // it is always between you.
  fetch() {
    const { time } = ent.game;

    if (dist(this.pos, this.target) < 21) {
      this.bullet?.remove();
      this.bullet = this.wait > 0
        ? null
        : new Bullet(this.color, this.pos.x, this.pos.y);
      if (this.bullet === null) return;

      const a = angle(this.pos, player.pos);
      this.bullet.angle = a + Math.PI / 2;
      this.target.x = this.pos.x + Math.cos(a) * FAR;
      this.target.y = this.pos.y + Math.sin(a) * FAR;
      return;
    }

    if (!gone(this.bullet) && dist(this.bullet.pos, this.target) > 11) {
      const s = SHOT * speed * time;
      towards(this.bullet.pos, this.target.x, this.target.y, s);
      return;
    }
    towards(this.pos, this.target.x, this.target.y, WALK * speed * time);
  }

  // Yellow stands FAR out from the centre on the far side from you, and fires
  // whenever it has nothing in the air.
  snipe() {
    const { time } = ent.game;
    const a = angle(player.pos, { x: 512, y: 512 });
    towards(
      this.pos,
      512 + Math.cos(a) * FAR,
      512 + Math.sin(a) * FAR,
      WALK * speed * time,
    );

    if (this.wait === 0 && gone(this.bullet)) this.bullet = shoot(this);
  }

  // Blue watches the hook: every throw makes it step DODGE sideways and shoot
  // back, and it does not wait out its grace period first.
  answer() {
    if (this.seen !== hook.action) {
      this.seen = hook.action;
      if (hook.action === OUT) {
        const a = angle(player.pos, this.pos) + Math.PI / 2;
        const side = Math.random() < 0.5 ? DODGE : -DODGE;
        this.target.x = this.pos.x + Math.cos(a) * side;
        this.target.y = this.pos.y + Math.sin(a) * side;
        if (gone(this.bullet)) this.bullet = shoot(this);
      }
    }
    towards(
      this.pos,
      this.target.x,
      this.target.y,
      WALK * speed * ent.game.time,
    );
  }
}

// A black square on the spot where you died, whose corners then move to the
// four corners of the board. One at a time and each waiting for the one before
// it: all four at once would expand the square, where one at a time stretches
// the black out of the shape.
// [corner, x, y]: top-left, bottom-left, top-right, bottom-right.
const SWEEP = [[0, 0, 0], [3, 0, 1024], [1, 1024, 0], [2, 1024, 1024]];

class EndGame extends ent.Entity {
  constructor(x, y) {
    super();
    this.pos.x = this.pos.y = 512;
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
    if (this.stage >= SWEEP.length) return;

    const [i, tx, ty] = SWEEP[this.stage];
    const p = this.p[i];
    towards(p, tx, ty, FLY * ent.game.time);
    if (p.x === tx && p.y === ty) this.stage += 1;
    this.draw();

    if (this.stage === SWEEP.length) gameOver({ score: true });
  }

  // size() fixes the box to the whole board, so the corners moving inside it do
  // not move the drawing's own centre with them.
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

function towards(p, x, y, max) {
  const d = Math.hypot(x - p.x, y - p.y);
  if (d === 0) return;
  const s = Math.min(1, max / d);
  p.x += (x - p.x) * s;
  p.y += (y - p.y) * s;
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
  const b = new Bullet(g.color, g.pos.x, g.pos.y);
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
  score.value += 1;
}

export function init() {
  ent.reset([Floor, Bullet, Ghost, Hook, Player, EndGame]);

  speed = 1.5;
  floor = FLOORS[Math.floor(Math.random() * FLOORS.length)];

  new Floor();
  player = new Player();
  hook = new Hook();

  // One per corner; the one with the floor's colour leaves on frame one.
  const corners = [
    [YELLOW, EDGE, EDGE],
    [PURPLE, 1024 - EDGE, EDGE],
    [BLUE, 1024 - EDGE, 1024 - EDGE],
    [PINK, EDGE, 1024 - EDGE],
  ];
  for (const [color, x, y] of corners) new Ghost(color, x, y);
}

export { render, update } from "./lib/entity.js";
