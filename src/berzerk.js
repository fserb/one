/*
 * berzerk - a port of ~/prj/vault/games/sketch/src/Berzerk.hx.
 *
 * You aim by walking: a shot leaves along your heading, and the reload freezes
 * you where you stand for a third of a second. Turrets lead their shots,
 * chasers home in. Every dead enemy drops a numbered box, and the number only
 * climbs if you collect the one before it, so the score comes from walking back
 * into the spot you just made dangerous.
 *
 * The Haxe is half a game: nothing could hurt the player, nothing scored, and a
 * round never ended. `nextScoreBox` counting up is its mechanic and nothing
 * consumed it. Every number a sketch with no death never had to balance is set
 * and argued at its own constant below. Difficulty is flat, as in the Haxe.
 *
 * Dropped: `if (vel.length == 0) remove()` in the bullet meant "no shot unless
 * you are moving", but Vec2's length setter turns a zero vector into (100, 0),
 * so a standing player shot to the right. Standing still now fires nothing.
 */

import * as ent from "./lib/entity.js";
import "./lib/gfx.js";
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
  finishGood: false,
  date: "2015-09-20",
};

const WHITE = 0xffffff;
const BLACK = 0x000000;

const TAU = Math.PI * 2;

// The shell's bar, in the 480 box.
const TOP = 21;
// Enemies land no nearer than this to a wall, or SAFE to the player.
const EDGE = 40;
const SAFE = 200;

// The Haxe started at (50, 50). A corner has two ways out and a chaser crosses
// SAFE in two seconds; the middle has eight.
const START = 240;
const SPEED = 120;
const RELOAD = 0.3;
const PR = 11;

const BW = 20;
const BH = 6;
// A hit box does not turn and a bullet does, so it collides as a circle.
const BR = 6;
const BULLET_MIN = 100;
const BULLET_MAX = 400;
// Slower than the player's, which were both 400 in the Haxe where a bullet
// could not hurt you. This board has no cover, so a shot has to be one you can
// step out of. It also makes the turret under-lead.
const ENEMY_MAX = 220;
const BULLET_ACC = 400;
// Distance over this is how far ahead an enemy aims.
const LEAD = 250;

const TR = 12;
const BARREL = 17;
const TURRET_TURN = Math.PI / 2;
// The Haxe held the first shot 2 seconds flat, killing a player still reading
// the hint and firing all three opening shots together.
const TURRET_FIRST = 3;
const TURRET_EVERY = 3;

const CHASE = 80;
const CHASER = 21;
const CHASER_TURN = Math.PI;
// The Haxe threw three, which was fine when they could not kill you. A shot
// costs a third of a second still and a chaser closes 24 units in that time,
// so three converging leave no gap wide enough to shoot from. Two do.
const CHASERS_MAX = 2;
// A dead enemy's replacement arrives a beat later, not on the same frame:
// that beat is the window to collect the box it left.
const RESPAWN = 2;

const BOX = 21;

// What the next box collected is worth. Boxes take it when they drop, so three
// lying around all read and pay the same.
let next = 1;

// Live chasers, counted here and not off ent.get(): one made this frame has
// not begun, and would go uncounted until it was on top of you.
let chasers = 0;

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

class Player extends ent.Entity {
  begin() {
    this.pos.x = this.pos.y = START;
    this.reload = 0;
    this.hitCircle(PR);
  }

  update() {
    const { key, time } = ent.game;
    this.reload = Math.max(0, this.reload - time);

    // Solid when the gun is ready, hollow while it is not: a frozen player is
    // a target.
    if (this.reload > 0) this.gfx.cache(1).line(3, WHITE).circle(0, 0, PR - 1.5);
    else this.gfx.cache(0).fill(WHITE).circle(0, 0, PR);

    this.vel.x = this.vel.y = 0;
    if (this.reload > 0) return;

    if (key.left) this.vel.x = -1;
    if (key.right) this.vel.x = 1;
    if (key.up) this.vel.y = -1;
    if (key.down) this.vel.y = 1;

    const l = Math.hypot(this.vel.x, this.vel.y);
    if (l === 0) return;

    // The Haxe fired before scaling the velocity, so the shooting frame moves
    // at full speed and the freeze starts on the next.
    if (key.b1) {
      new Bullet(this, WHITE, Math.atan2(this.vel.y, this.vel.x), BULLET_MAX);
      this.reload = RELOAD;
    }
    this.vel.x *= SPEED / l;
    this.vel.y *= SPEED / l;
  }

  postUpdate() {
    // Nothing draws the walls, but the box is the board: without it you walk
    // off the side where nothing can reach you.
    this.pos.x = clamp(this.pos.x, PR, ent.game.width - PR);
    this.pos.y = clamp(this.pos.y, TOP + PR, ent.game.height - PR);

    if (hitBullet(this) !== null) return this.die();
    if (this.hitGroup(EnemyChaser) !== null) return this.die();
    if (this.hitGroup(EnemyTurret) !== null) this.die();
  }

  die() {
    this.remove();
    gameOver();
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

    // The Haxe never removed one, so every shot fired was still flying.
    const { width, height } = ent.game;
    const { x, y } = this.pos;
    if (x < -BW || x > width + BW || y < -BW || y > height + BW) this.remove();
  }
}

class EnemyTurret extends ent.Entity {
  begin() {
    this.bullettime = TURRET_FIRST + Math.random() * TURRET_EVERY;
    this.hitCircle(TR);
    // size() holds the centre on the body while the barrel hangs off one side.
    this.gfx.size(2 * BARREL, 2 * TR).fill(BLACK)
      .circle(0, 0, TR)
      .rect(0, -BH / 2 - 1, BARREL, BH + 2);
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
    this.art.size(3, 7, 7).obj(
      [BLACK],
      `
.00000.
0000000
0.000.0
0000000
0000000
0.0.0.0
0.0.0.0`,
    );
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
    // The bar covers the top of the board, so a chaser up there is invisible
    // and still lethal.
    const h = CHASER / 2;
    this.pos.x = clamp(this.pos.x, h, ent.game.width - h);
    this.pos.y = clamp(this.pos.y, TOP + h, ent.game.height - h);
  }
}

class ScoreBox extends ent.Entity {
  constructor(x, y) {
    super();
    this.pos.x = x;
    this.pos.y = y;
    this.n = next;
    this.hitBox(BOX);
    this.art.size(3, 7, 7).color(BLACK).text(3, 3, String(this.n), 2);
  }

  update() {
    if (this.hitGroup(Player) === null) return;
    this.remove();

    score.value += this.n;
    next = Math.max(this.n + 1, next);
    new ent.Text()
      .text(`+${this.n}`)
      .color(BLACK)
      .size(2)
      .duration(0.8)
      .xy(this.pos.x, this.pos.y)
      .move(0, -30);
  }
}

// Turn `from` towards where the player will be when a shot arrives, at most
// `rate` radians a second. The Haxe aimed at the far side and then subtracted
// the turn, which is the same thing twice.
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
  return from + clamp(d, -step, step);
}

// The first bullet touching `e` that `e` did not fire: hitGroup() would hand
// back its own, since an owner sits inside its shot for a few frames.
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
  new ent.Particle()
    .color(BLACK)
    .xy(pos.x, pos.y)
    .count(60, 20)
    .size(4, 3)
    .delay(0)
    .duration(0.4)
    .speed(40, 120);
}

// Anywhere on the board, but not on the player. The Haxe dropped them
// anywhere, which cost nothing when nothing could kill you.
function place(e) {
  const p = ent.one(Player);
  const px = p === null ? START : p.pos.x;
  const py = p === null ? START : p.pos.y;

  for (let i = 0; i < 30; ++i) {
    e.pos.x = EDGE + Math.random() * (ent.game.width - 2 * EDGE);
    e.pos.y = EDGE + Math.random() * (ent.game.height - 2 * EDGE);
    if (Math.hypot(e.pos.x - px, e.pos.y - py) >= SAFE) break;
  }
  return e;
}

function newEnemy(delay = 0) {
  if (delay > 0) {
    new ent.Timer().delay(delay).run(() => newEnemy());
    return;
  }
  const chase = chasers < CHASERS_MAX && Math.random() < 0.5;
  place(chase ? new EnemyChaser() : new EnemyTurret());
}

export function init() {
  ent.reset();
  ent.world(480);
  ent.order([
    ScoreBox,
    EnemyTurret,
    EnemyChaser,
    Bullet,
    Player,
    ent.Particle,
    ent.Text,
  ]);

  next = 1;
  chasers = 0;
  new Player();
  // One chaser to open with, not a coin flip three times: two in the first two
  // seconds is not a round anyone can start.
  place(new EnemyChaser());
  place(new EnemyTurret());
  place(new EnemyTurret());
}

export function update(dt) {
  ent.update(dt);
}

export function render(ctx) {
  ent.render(ctx);
}
