/*
 * grab - a port of ~/prj/vault/games/sketch/src/LD32.hx, "the name of the game
 * is grab". Ludum Dare 32, April 2015; the weapon is Blitzcrank's hook.
 *
 * The floor is one of four colours and the ghost wearing it is off the board.
 * Hook one of the other three and reel it in: its colour becomes the floor, it
 * leaves, and the old floor colour walks back on. Always three ghosts, always a
 * different three, each with its own way to kill you. Every grab makes
 * everything 6% faster, and throwing the hook roots you where you stand.
 *
 * It needs a keyboard or gamepad to move and a pointer to aim. Alone in the
 * collection, it is not playable with either one alone.
 *
 * The opening four ghosts hold fire for as long as the hint stands: at
 * 1.5/speed yellow's first shot lands 2.9 seconds in, before the hint has
 * faded, and the Haxe had a title card where this shell has none.
 *
 * The bar covers the top 21 units of the 480 box, so the walls and the ghosts'
 * starting corners move down. A hit shape does not turn with the drawing, so
 * the hook's 20x18 claw box is a circle on the claw.
 */

import * as ent from "./lib/entity.js";
import "./lib/gfx.js";
import { gameOver, hint, score } from "./lib/one.js";
import * as sfxr from "./lib/sfxr.js";
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
};

const BLACK = 0x010101;
const WHITE = 0xfafafa;

// Named as the author's write-up named them. Two of the Haxe's constants
// disagree with their colour: its `cyan` is this purple, its `purple` this
// pink.
const YELLOW = 0xffdc3b;
const PINK = 0xff54b1;
const PURPLE = 0xaa00ff;
const BLUE = 0x00aaff;
const FLOORS = [YELLOW, PURPLE, BLUE, PINK];

// The 480 box, and the strip the shell's bar covers.
const W = 480;
const TOP = 21;
// How far off each wall the ghosts start, and where the player's wall is. A
// radius of the player pokes past it, as in the Haxe.
const EDGE = 10;

const PR = 16;
const PUSH = 1700;
const DRAG = 5;
// On top of the hitstop.
const DEATH = 0.2;

const IDLE = 0;
const OUT = 1;
const BACK = 2;
const REEL = 3;
const MAXARM = 200;
const THROW = 500;
const PULL = 800;
const CLAW = 10;

const GR = 10;
const BR = 6;
// Seconds a fresh ghost cannot hurt you and will not shoot, over the speed.
const GRACE = 1.5;
// Pink's stand-off, and the radius its bullet swings at.
const KEEP = 128;
// Yellow's distance from the centre, and how far purple throws.
const FAR = 200;
const DODGE = 50;
// Both over the speed: how fast a ghost walks and how fast a bullet travels.
const WALK = 50;
const SHOT = 100;

// ugl's Sound.vol(v) set masterVolume to 2v and sfxr squares it, so the hook
// is a quarter the loudness of the other two.
voice("hook", sfxr.laser(1249), 0.1);
voice("grab", sfxr.hit(1249), 0.2);
voice("hit", sfxr.explosion(1238), 0.2);

function voice(name, params, vol) {
  params.masterVolume = 2 * vol;
  sound.put(name, sfxr.render(params), sfxr.SAMPLE_RATE);
}

let speed = 1.5;
let floor = YELLOW;
let player = null;
let hook = null;

class Floor extends ent.Entity {
  constructor() {
    super();
    this.pos.x = this.pos.y = W / 2;
  }

  update() {
    this.gfx.cache(floor).fill(floor).rect(-W / 2, -W / 2, W, W);
  }
}

class Player extends ent.Entity {
  constructor() {
    super();
    this.pos.x = this.pos.y = W / 2;
    this.dying = 0;
    this.gfx.fill(BLACK).circle(0, 0, PR);
    this.hitCircle(PR);
  }

  update() {
    const { key, time } = ent.game;

    if (this.dying > 0) {
      this.dying -= time;
      if (this.dying <= 0) gameOver({ score: true });
      return;
    }

    if (hook.action === IDLE) {
      let mx = 0;
      let my = 0;
      if (key.left) mx = -1;
      if (key.right) mx = 1;
      if (key.up) my = -1;
      if (key.down) my = 1;

      const l = Math.hypot(mx, my);
      if (l > 0) this.accelerate(mx * PUSH / l, my * PUSH / l);
      this.accelerate(-this.vel.x * DRAG, -this.vel.y * DRAG);
    } else {
      // Throwing roots you: the hook is your whole defence while it is out.
      this.vel.x = this.vel.y = 0;
    }

    // The walls take the speed you carried into them and hand it back.
    if (this.pos.x <= EDGE) {
      this.pos.x = EDGE;
      this.vel.x = Math.abs(this.vel.x);
    }
    if (this.pos.x >= W - EDGE) {
      this.pos.x = W - EDGE;
      this.vel.x = -Math.abs(this.vel.x);
    }
    if (this.pos.y <= TOP + EDGE) {
      this.pos.y = TOP + EDGE;
      this.vel.y = Math.abs(this.vel.y);
    }
    if (this.pos.y >= W - EDGE) {
      this.pos.y = W - EDGE;
      this.vel.y = -Math.abs(this.vel.y);
    }

    // Reeling a ghost in drags you through everything else untouched.
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
    this.dying = DEATH;
    ent.delay(0.2);
    ent.shake(0.5);
  }
}

// The hook: points at the pointer while idle, goes out at THROW, comes back at
// PULL with whatever it caught.
class Hook extends ent.Entity {
  constructor() {
    super();
    this.arm = 0;
    this.action = IDLE;
    this.target = null;
    // A hit shape does not turn with `angle`, so the circle sits on the
    // entity's origin and draw() puts the claw there. The Haxe's box was five
    // further out.
    this.hitCircle(CLAW);
    this.draw();
  }

  // The claw is the origin and the arm hangs back off it, so size() holds the
  // drawing's centre still as the arm changes length.
  draw() {
    this.gfx.clear()
      .size(2 * CLAW, 2 * Math.max(10, this.arm))
      .fill(BLACK)
      .circle(0, 0, 3)
      .rect(-2.5, -10, 5, 10)
      .rect(-2.5, 0, 5, this.arm);
    prong(this.gfx, -Math.PI / 6);
    prong(this.gfx, Math.PI + Math.PI / 6);
  }

  update() {
    if (player.dying > 0) return;
    const { key, mouse, time } = ent.game;
    const p = player.pos;

    if (this.action === IDLE) {
      // The drawing points along its own -y, so the aim is a quarter turn on.
      this.angle = Math.atan2(mouse.y - p.y, mouse.x - p.x) + Math.PI / 2;
      if (key.just.b1) {
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
        ent.delay(0.05);
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

    // The claw rides 11 out plus the arm's length, so the arm's far end stays
    // 11 out whatever the arm does.
    this.pos.x = p.x + (11 + this.arm) * Math.cos(this.angle - Math.PI / 2);
    this.pos.y = p.y + (11 + this.arm) * Math.sin(this.angle - Math.PI / 2);
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
      .fill(WHITE, 0.9).circle(-2, -1, 1).circle(2, -1, 1);
    this.hitCircle(BR);
  }

  update() {
    // Pink's and purple's are steered by hand; only the fire-and-forget ones
    // leave the board.
    if (this.color === PINK || this.color === PURPLE) return;
    const { x, y } = this.pos;
    if (x < 0 || x > W || y < TOP || y > W) this.remove();
  }
}

// A ghost. All four walk at WALK towards a point, and differ only in how they
// pick the point and what they do with their one bullet.
class Ghost extends ent.Entity {
  constructor(color, x = null, y = null) {
    super();
    this.color = color;
    // The corner furthest from the player, unless the round opened with four.
    this.pos.x = x ?? (player.pos.x <= W / 2 ? W - 20 : 20);
    this.pos.y = y ?? (player.pos.y <= W / 2 ? W - 20 : TOP + 20);
    this.grabbed = false;
    this.wait = GRACE / speed;
    this.bullet = null;
    this.turn = 0;
    this.spin = 1;
    this.seen = IDLE;
    this.target = color === BLUE
      ? { x: W / 2, y: W / 2 }
      : { x: this.pos.x, y: this.pos.y };

    this.gfx.fill(color)
      .circle(0, 0, GR).rect(-GR, 0, 2 * GR, GR)
      .fill(WHITE, 0.9).circle(-3, -2, 2).circle(3, -2, 2);
    this.hitBox(2 * GR);
  }

  update() {
    this.wait = Math.max(0, this.wait - ent.game.time);

    // The floor's colour is out of play, so a ghost leaves when its own is
    // put down.
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

  // Pink holds KEEP away, either side, and swings its bullet around itself on
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

    if (dist(this.pos, this.target) < 10) {
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

    if (!gone(this.bullet) && dist(this.bullet.pos, this.target) > 5) {
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
    const a = angle(player.pos, { x: W / 2, y: W / 2 });
    towards(
      this.pos,
      W / 2 + Math.cos(a) * FAR,
      W / 2 + Math.sin(a) * FAR,
      WALK * speed * time,
    );

    if (this.wait === 0 && gone(this.bullet)) this.bullet = shoot(this);
  }

  // Blue watches the hook: every throw makes it step DODGE sideways and shoot
  // back, and it does not sit out its grace period first.
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

// A claw: a bar 5 across and 10 long out of the hook's hub at `a`.
function prong(gfx, a) {
  const vx = Math.cos(a);
  const vy = Math.sin(a);
  const nx = -vy * 2.5;
  const ny = vx * 2.5;
  gfx.mt(nx, ny)
    .lt(nx + 10 * vx, ny + 10 * vy)
    .lt(-nx + 10 * vx, -ny + 10 * vy)
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

// The board is a torus, but nothing wraps through the bar: a ghost leaving the
// bottom comes back at the bar's edge.
function wrap(p) {
  const h = W - TOP;
  if (p.x < 0) p.x += W;
  if (p.x >= W) p.x -= W;
  if (p.y < TOP) p.y += h;
  if (p.y >= W) p.y -= h;
}

// One bullet, fired at the player and then left to itself. Yellow's and blue's.
function shoot(g) {
  const b = new Bullet(g.color, g.pos.x, g.pos.y);
  const a = angle(g.pos, player.pos);
  b.vel.x = Math.cos(a) * SHOT * speed;
  b.vel.y = Math.sin(a) * SHOT * speed;
  b.angle = a + Math.PI / 2;
  return b;
}

// A ghost reeled all the way in. Its colour becomes the floor, taking it off
// the board, and the colour it replaces walks back on.
function eat(color) {
  new Ghost(floor);
  ent.shake(0.2);
  floor = color;
  speed *= 1.06;
  score.value += 1;
}

export function init() {
  hint(meta.desc);
  ent.reset();
  ent.world(W);
  ent.order([Floor, Bullet, Ghost, Hook, Player]);

  speed = 1.5;
  floor = FLOORS[Math.floor(Math.random() * FLOORS.length)];

  new Floor();
  player = new Player();
  hook = new Hook();

  // One per corner; the one wearing the floor's colour leaves on frame one.
  // They hold fire for as long as the hint stands when that beats the usual
  // grace: at 1.5/speed yellow's first shot lands 2.9 seconds in, before the
  // hint has faded, and the Haxe had a title card where this shell has none.
  // hint() is 0 from the first input, so the grace ends when the reading does.
  const corners = [
    [YELLOW, EDGE, TOP + EDGE],
    [PURPLE, W - EDGE, TOP + EDGE],
    [BLUE, W - EDGE, W - EDGE],
    [PINK, EDGE, W - EDGE],
  ];
  for (const [color, x, y] of corners) {
    const g = new Ghost(color, x, y);
    g.wait = Math.max(g.wait, hint());
  }
}

export function update(dt) {
  ent.update(dt);
}

export function render(ctx) {
  ent.render(ctx);
}
