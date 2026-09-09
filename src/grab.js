/*
 * grab - a port of ~/prj/vault/games/sketch/src/LD32.hx, "the name of the game
 * is grab". Ludum Dare 32, April 2015; the theme was An Unconventional
 * Weapon, and the weapon is Blitzcrank's hook.
 *
 * The floor is one of four colours and the ghost wearing that colour is not on
 * the board. Hook one of the other three, reel it in, and its colour becomes
 * the floor: it leaves, and the colour that was the floor walks back on. So
 * there are always three ghosts and always a different three, and each of the
 * four has its own idea of how to kill you. Every grab makes everything 6%
 * faster. Throwing the hook roots you where you stand, which is the cost.
 *
 * It wants a keyboard or a gamepad to move and a pointer to aim. Nothing here
 * aims from the keyboard and nothing moves from the pointer, so unlike the
 * rest of the collection it is not playable with either one alone.
 *
 * What changed from the Haxe:
 *
 * - The shell owns game over, so `EndGame` (a black quadrilateral wiping in
 *   from where you died, then three lines of text) and the score labels are
 *   gone. The `delay(0.2)` and `shake(0.5)` the death fired are still here,
 *   and the freeze-frame waits for them.
 * - Grabbing on the same frame the arm reached full extension set the hook
 *   reeling and then overwrote that with retracting, which left the ghost
 *   flagged as grabbed and frozen for the rest of the round. The two are one
 *   else-if now.
 * - The ghosts' wrap-around read `pos.y` and wrote `pos.x` on the first of its
 *   four lines, so a ghost could only wrap off the left edge while it was also
 *   off the top. All four edges wrap.
 * - Purple removed its old bullet, kept pointing at it, and went on steering
 *   the corpse whenever it was still inside its grace period. It drops the
 *   reference with the bullet.
 * - Yellow's "have I arrived" test measured the step it had just taken rather
 *   than the distance it had left, so it was true on any frame faster than
 *   7fps. Yellow fires whenever it has nothing in the air, which is what the
 *   Haxe did; the test is gone rather than repaired.
 * - `counter` was set to 3.5, added to every frame and never read. Gone, along
 *   with an empty `if (bg.color == C.cyan)`.
 * - The four ghosts the round opens with hold their fire for three seconds
 *   rather than the 1.5/speed a grab gives, because this shell has no title
 *   card and the round has to leave room to read the hint.
 * - The shell's bar covers the top 21 units of the 480 box, so the walls and
 *   the corners the ghosts start in move down by that much.
 * - A hit shape does not turn with the drawing here, so the hook's 20x18 claw
 *   box, which ugl ran through the sprite matrix, is a circle on the claw.
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
  finishGood: false,
  date: "2015-04-18",
};

const BLACK = 0x010101;
const WHITE = 0xfafafa;

// The four ghosts, named as the author's own write-up named them. Two of the
// Haxe's constants disagree with their colour: its `cyan` is this purple and
// its `purple` is this pink.
const YELLOW = 0xffdc3b;
const PINK = 0xff54b1;
const PURPLE = 0xaa00ff;
const BLUE = 0x00aaff;
const FLOORS = [YELLOW, PURPLE, BLUE, PINK];

// The box the game thinks in, and the strip of it the shell's 44px bar covers.
const W = 480;
const TOP = 21;
// How far off each wall the ghosts start, and how far in the player's own wall
// is. A radius of the player pokes out past it, as it did in the Haxe.
const EDGE = 10;

const PR = 16;
const PUSH = 1700;
const DRAG = 5;
// Seconds from the blow to the freeze-frame, on top of the hitstop.
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
// Blue's sidestep.
const DODGE = 50;
// Both over the speed: how fast a ghost walks and how fast a bullet travels.
const WALK = 50;
const SHOT = 100;

// ugl's Sound.vol(v) set masterVolume to 2v and sfxr squares that, so the hook
// ends up a quarter of the loudness of the other two.
voice("hook", sfxr.laser(1249), 0.1);
voice("grab", sfxr.hit(1249), 0.2);
voice("hit", sfxr.explosion(1238), 0.2);

function voice(name, params, vol) {
  params.masterVolume = 2 * vol;
  sound.put(name, sfxr.render(params), sfxr.SAMPLE_RATE);
}

// The scene's own state, as the Haxe kept it on the Scene and on the Player.
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
    // Seconds left of the death beat, or 0 while alive.
    this.dying = 0;
    this.gfx.fill(BLACK).circle(0, 0, PR);
    this.hitCircle(PR);
  }

  update() {
    const { key, time } = ent.game;

    if (this.dying > 0) {
      this.dying -= time;
      if (this.dying <= 0) gameOver();
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
      // Throwing roots you: the hook is the whole of your defence while it is
      // out, and missing costs you the walk back.
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

/*
 * The hook. It points at the pointer while it is idle, goes out at THROW and
 * comes back at PULL, and whatever it catches on the way out comes back with
 * it.
 */
class Hook extends ent.Entity {
  constructor() {
    super();
    this.arm = 0;
    this.action = IDLE;
    this.target = null;
    // A hit shape does not turn with `angle`, so the claw's circle sits on the
    // entity's own origin and draw() puts the claw there. The Haxe's box was
    // five further out; a circle on the claw is near enough.
    this.hitCircle(CLAW);
    this.draw();
  }

  // The claw is the origin and the arm hangs back off it, so size() is what
  // holds the drawing's centre still while the arm changes length.
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
        // standing on you when the reel drops you somewhere new.
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
      // Half of the length the arm gives up moves the ghost and half moves
      // you, so a grab is also a way to travel.
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

    // The claw rides 11 out from the player plus the length of the arm, which
    // leaves the far end of the arm 11 out whatever the arm is doing.
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
    // Pink's and purple's belong to the ghost that made them and are steered
    // by hand; only the two that are fired and forgotten leave the board.
    if (this.color === PINK || this.color === PURPLE) return;
    const { x, y } = this.pos;
    if (x < 0 || x > W || y < TOP || y > W) this.remove();
  }
}

/*
 * A ghost. All four walk the same way, at WALK towards a point, and differ
 * only in how they choose the point and what they do with their one bullet.
 */
class Ghost extends ent.Entity {
  constructor(color, x = null, y = null) {
    super();
    this.color = color;
    // Into the corner furthest from the player, unless the round opened with
    // one in every corner.
    this.pos.x = x ?? (player.pos.x <= W / 2 ? W - 20 : 20);
    this.pos.y = y ?? (player.pos.y <= W / 2 ? W - 20 : TOP + 20);
    this.grabbed = false;
    this.wait = GRACE / speed;
    this.bullet = null;
    // Pink's arm angle and the way it turns; blue's memory of the hook.
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

    // The colour on the floor is out of play, so a ghost leaves the moment its
    // own colour is put down.
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

  // Pink holds KEEP away from you, whichever side of that it is on, and swings
  // its bullet around itself on an arm the same length.
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

  // Purple throws its bullet FAR towards you and then walks over to collect
  // it, so the bullet is always between the two of you.
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

  // Yellow stands FAR out from the centre on the far side of it from you, and
  // fires the moment it has nothing in the air.
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

  // Blue watches the hook. Every throw makes it step DODGE sideways and shoot
  // back, and it is the one that does not sit out its grace period first.
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

// Steps `p` at most `max` towards (x, y).
function towards(p, x, y, max) {
  const d = Math.hypot(x - p.x, y - p.y);
  if (d === 0) return;
  const s = Math.min(1, max / d);
  p.x += (x - p.x) * s;
  p.y += (y - p.y) * s;
}

// The board is a torus. Nothing wraps through the bar: the strip under it is
// not board, so a ghost that leaves the bottom comes back at the bar's edge.
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

// A ghost reeled all the way in. Its colour goes down as the floor, which
// takes it off the board, and the colour it replaces walks back on.
function eat(color) {
  new Ghost(floor);
  ent.shake(0.2);
  floor = color;
  speed *= 1.06;
  score.value += 1;
}

export function init() {
  ent.reset();
  ent.world(W);
  ent.order([Floor, Bullet, Ghost, Hook, Player]);

  speed = 1.5;
  floor = FLOORS[Math.floor(Math.random() * FLOORS.length)];

  new Floor();
  player = new Player();
  hook = new Hook();

  // One in every corner, and the one wearing the floor's colour leaves again
  // on the first frame. These four hold for as long as the hint stands when
  // that is longer than the usual grace, because the shell opens on the
  // running game: at 1.5/speed yellow's first shot lands 2.9 seconds in,
  // before the hint has finished fading, and a player who is still reading is
  // dead. The Haxe had a title card and a click to begin. hint() is already 0
  // on the second round, and from the first input of the first one, so the
  // extra grace ends when the reading does.
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
