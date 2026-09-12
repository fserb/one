/*
 * berzerk.
 *
 * You aim by walking: a shot leaves along your heading, and the reload freezes
 * you where you stand for a third of a second. Every dead enemy drops a
 * numbered box whose number only increases if you collect the one before it, so
 * the score comes from walking back into the spot you just made dangerous.
 *
 * A player standing still has no heading, so standing still fires nothing.
 */

import { extra } from "./alma/src/index.js";
import * as ent from "./lib/entity.js";
import { gameOver, score } from "./lib/one.js";

export const meta = {
  title: "berzerk",
  desc: `
arrows move, space shoots
each number taken raises the next
`,
  bg: "#FF3155",
  fg: "#000000",
  scoreMax: true,
  date: "2015-09-20",
  dpad: true,
};

const WHITE = 0xffffff;
const BLACK = 0x000000;

const TAU = Math.PI * 2;

// Enemies land no nearer than this to a wall, or SAFE to the player.
const EDGE = 85;
const SAFE = 425;

// The middle, not a corner: a corner has two ways out and a chaser crosses SAFE
// in two seconds, where the middle has eight.
const START = 512;
const SPEED = 256;
const RELOAD = 0.3;
const PR = 23;

const BW = 42;
const BH = 13;
// A hit box does not turn and a bullet does, so it collides as a circle.
const BR = 13;
const BULLET_MIN = 210;
const BULLET_MAX = 850;
// Slower than the player's 850. This board has no cover, so a shot has to be
// one you can step out of, and it makes the turret under-lead.
const ENEMY_MAX = 470;
const BULLET_ACC = 850;
// Distance over this is how far ahead an enemy aims.
const LEAD = 530;

const TR = 26;
const BARREL = 36;
const TURRET_TURN = Math.PI / 2;
// At 2 seconds flat the first shot kills a player still reading the hint, and
// all three opening shots go off together.
const TURRET_FIRST = 3;
const TURRET_EVERY = 3;

const CHASE = 170;
const CHASER = 42;
const CHASER_TURN = Math.PI;
// A shot costs a third of a second still and a chaser closes 51 units in that
// time, so three converging leave no gap wide enough to shoot from. Two do.
const CHASERS_MAX = 2;
// A replacement arrives a moment later and not on the same frame: that moment
// is the window to collect the box it left.
const RESPAWN = 2;

const BOX = 42;

// What the next box collected is worth. Boxes take it when they drop, so three
// lying around are all worth the same.
let next = 1;

// Counted here and not off ent.get(): one made this frame has not begun, and
// would go uncounted until it was on top of you.
let chasers = 0;

class Player extends ent.Entity {
  begin() {
    this.pos.x = this.pos.y = START;
    this.reload = 0;
    this.hitCircle(PR);
  }

  update() {
    const { input, time } = ent.game;
    this.reload = Math.max(0, this.reload - time);

    // Solid when the gun is ready, hollow while it is not: a frozen player is a
    // target.
    if (this.reload > 0) this.gfx.cache(1).line(6, WHITE).circle(0, 0, PR - 3);
    else this.gfx.cache(0).fill(WHITE).circle(0, 0, PR);

    this.vel.x = this.vel.y = 0;
    if (this.reload > 0) return;

    if (input.press.left) this.vel.x = -1;
    if (input.press.right) this.vel.x = 1;
    if (input.press.up) this.vel.y = -1;
    if (input.press.down) this.vel.y = 1;

    const l = Math.hypot(this.vel.x, this.vel.y);
    if (l === 0) return;

    // Fire before the velocity is scaled, so the shooting frame moves at full
    // speed and the freeze starts on the next.
    if (input.press.act) {
      new Bullet(this, WHITE, Math.atan2(this.vel.y, this.vel.x), BULLET_MAX);
      this.reload = RELOAD;
    }
    this.vel.x *= SPEED / l;
    this.vel.y *= SPEED / l;
  }

  postUpdate() {
    // Nothing draws the walls, but the box is the board: without it you walk
    // off the side where nothing can reach you.
    this.pos.x = extra.clamp(this.pos.x, PR, 1024 - PR);
    this.pos.y = extra.clamp(this.pos.y, PR, 1024 - PR);

    if (hitBullet(this) !== null) return this.die();
    if (this.hitGroup(EnemyChaser) !== null) return this.die();
    if (this.hitGroup(EnemyTurret) !== null) this.die();
  }

  die() {
    this.remove();
    gameOver({ score: true });
  }
}

class Bullet extends ent.Entity {
  // From the constructor, not begin(): the owner's heading is the aim, and a
  // frame later the player has frozen for the reload and has none.
  constructor(owner, color, angle, top) {
    super();
    this.owner = owner;
    this.angle = angle;
    this.top = top;
    this.speed = BULLET_MIN;
    this.pos.x = owner.pos.x;
    this.pos.y = owner.pos.y;
    this.hitCircle(BR);
    this.gfx.fill(color).rect(0, 0, BW, BH);
  }

  update() {
    this.speed = Math.min(this.top, this.speed + BULLET_ACC * ent.game.time);
    this.vel.x = Math.cos(this.angle) * this.speed;
    this.vel.y = Math.sin(this.angle) * this.speed;

    const { x, y } = this.pos;
    if (x < -BW || x > 1024 + BW || y < -BW || y > 1024 + BW) this.remove();
  }
}

class EnemyTurret extends ent.Entity {
  begin() {
    this.bullettime = TURRET_FIRST + Math.random() * TURRET_EVERY;
    this.hitCircle(TR);
    // size() keeps the centre on the body while the barrel is to one side.
    this.gfx.size(2 * BARREL, 2 * TR).fill(BLACK)
      .circle(0, 0, TR)
      .rect(0, -BH / 2 - 2, BARREL, BH + 4);
  }

  update() {
    this.angle = aim(this, this.angle, TURRET_TURN);

    this.bullettime -= ent.game.time;
    if (this.bullettime <= 0) {
      this.bullettime = TURRET_EVERY;
      new Bullet(this, BLACK, this.angle, ENEMY_MAX);
    }

    const b = hitBullet(this);
    if (b === null) return;
    b.remove();
    kill(this);
  }
}

class EnemyChaser extends ent.Entity {
  constructor() {
    super();
    chasers += 1;
  }

  remove() {
    if (!this.dead) chasers -= 1;
    super.remove();
  }

  begin() {
    this.dir = 0;
    this.hitBox(CHASER);
    // Four legs under a body with two eyes: the turret is a disc with a
    // barrel, so what chases you has to read as the other thing on the board.
    this.gfx.size(42, 42).fill(BLACK)
      .rect(-21, -21, 42, 30, 16)
      .rects([[-21, 3, 6, 18], [-9, 3, 6, 18], [3, 3, 6, 18], [15, 3, 6, 18]])
      .fill(WHITE).circle(-12, -6, 4.5).circle(12, -6, 4.5);
  }

  update() {
    this.dir = aim(this, this.dir, CHASER_TURN);
    this.vel.x = Math.cos(this.dir) * CHASE;
    this.vel.y = Math.sin(this.dir) * CHASE;

    const b = hitBullet(this);
    if (b !== null) {
      b.remove();
      return kill(this);
    }

    // A chaser that runs into another enemy takes it with it, and the pair
    // leaves one box. Worth luring.
    const e = this.hitGroup(EnemyTurret) ?? this.hitGroup(EnemyChaser);
    if (e === null) return;
    burst(e.pos);
    e.remove();
    newEnemy(RESPAWN);
    kill(this);
  }

  postUpdate() {
    const h = CHASER / 2;
    this.pos.x = extra.clamp(this.pos.x, h, 1024 - h);
    this.pos.y = extra.clamp(this.pos.y, h, 1024 - h);
  }
}

class ScoreBox extends ent.Entity {
  constructor(x, y) {
    super();
    this.pos.x = x;
    this.pos.y = y;
    this.n = next;
    this.hitBox(BOX);
  }

  update() {
    if (this.hitGroup(Player) === null) return;
    this.remove();

    score.value += this.n;
    next = Math.max(this.n + 1, next);
    new ent.Text({
      text: `+${this.n}`,
      x: this.pos.x,
      y: this.pos.y,
      size: 40,
      color: BLACK,
      vel: [0, -64],
      duration: 0.8,
    });
  }

  render(ctx) {
    ctx.fillStyle = ent.css(BLACK);
    ctx.text(String(this.n), 0, 0, 38);
  }
}

// Turn `from` towards where the player will be when a shot arrives, at most
// `rate` radians a second.
function aim(e, from, rate) {
  const p = ent.one(Player);
  if (p === null) return from;

  const lead = Math.hypot(p.pos.x - e.pos.x, p.pos.y - e.pos.y) / LEAD;
  const to = Math.atan2(
    p.pos.y + p.vel.y * lead - e.pos.y,
    p.pos.x + p.vel.x * lead - e.pos.x,
  );

  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  const step = rate * ent.game.time;
  return from + extra.clamp(d, -step, step);
}

// hitGroup() would return its own, since an owner sits inside its shot for a
// few frames.
function hitBullet(e) {
  for (const b of ent.get(Bullet)) {
    if (b.owner !== e && e.hit(b)) return b;
  }
  return null;
}

function kill(e) {
  e.remove();
  burst(e.pos);
  new ScoreBox(e.pos.x, e.pos.y);
  newEnemy(RESPAWN);
}

function burst(pos) {
  new ent.Particle({
    x: pos.x,
    y: pos.y,
    color: BLACK,
    count: [60, 20],
    size: [9, 6],
    speed: [85, 256],
    duration: 0.4,
  });
}

// Anywhere on the board, but not on the player.
function place(e) {
  const p = ent.one(Player);
  const px = p === null ? START : p.pos.x;
  const py = p === null ? START : p.pos.y;

  for (let i = 0; i < 30; ++i) {
    e.pos.x = EDGE + Math.random() * (1024 - 2 * EDGE);
    e.pos.y = EDGE + Math.random() * (1024 - 2 * EDGE);
    if (Math.hypot(e.pos.x - px, e.pos.y - py) >= SAFE) break;
  }
  return e;
}

function newEnemy(delay = 0) {
  if (delay > 0) {
    ent.after(delay, () => newEnemy());
    return;
  }
  const chase = chasers < CHASERS_MAX && Math.random() < 0.5;
  place(chase ? new EnemyChaser() : new EnemyTurret());
}

export function init() {
  ent.reset([ScoreBox, EnemyTurret, EnemyChaser, Bullet, Player, ent.Particle]);

  next = 1;
  chasers = 0;
  new Player();
  // One chaser to open with, not a coin flip three times: two in the first two
  // seconds is not a round anyone can start.
  place(new EnemyChaser());
  place(new EnemyTurret());
  place(new EnemyTurret());
}

export { render, update } from "./lib/entity.js";
