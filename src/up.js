/*
 * up - a port of ~/prj/vault/games/sketch/src/Up.hx.
 * Based on Aba Games' WASD THRUST.
 *
 * The ship has four thrusters, one per arrow key, each lettered with the key
 * that fires it, and a thruster pushes the ship away from itself: the one on
 * top drives you down. Everything on screen slides down 50 units a second, the
 * ship with it, so the game is holding enough upward thrust to stay off the
 * bottom of the screen while a field of red crosses comes down at you.
 *
 * The Haxe never shipped: the file is marked `ugl.skip`, so it is not one of
 * the nine on fserb.com/vault/games.
 *
 * Nothing here needs a camera. The scene moves the world rather than the view,
 * adding the same offset to the ship and to every obstacle once a frame, which
 * is why the ship sits at a fixed 240 across and never above 200 down.
 *
 * Changes from the Haxe:
 *
 * - The score is the shell's bar rather than a label in the corner.
 * - The board holds still while the hint is up, which is what the slide in
 *   update() says. The Haxe had no hint to sit under.
 * - Death holds for half a second so the ship is seen coming apart. ugl cleared
 *   every entity on the same frame the burst was made, so it never drew one.
 * - The Haxe's Engine carried a `force` of `min(5, force + 20)`, which is 5 on
 *   the first throttle and 5 on every one after, so it is a constant here.
 * - The thrust and the drag are new numbers. The Haxe's two cannot fly the ship
 *   at all, and THRUST says what they are picked against instead.
 * - The ship collides as two polygons, which turn with it. ugl ran its two hit
 *   boxes through the sprite matrix; entity.js only turns a polygon.
 * - The thrusters draw on top of the ship. ugl's orderGroups() started at layer
 *   20 and left an unlisted group at 10, so the Engine group drew under
 *   everything, and the ship's own cross covered all four of them whole: the
 *   letters that say which key fires which thruster could not be read at all.
 */

import * as ent from "./lib/entity.js";
import { gameOver, hint, score } from "./lib/one.js";

export const meta = {
  title: "up",
  desc: `
arrows fire the thruster on that side
which pushes you off it. x and c spin
`,
  bg: "#464248",
  fg: "#E3C61E",
  scoreMax: true,
  finishGood: false,
  date: "2014-03-30",
};

const W = 480;

// Units a second the world slides down by, and the highest the ship gets to
// sit while it does. Climbing faster than the slide only buys the pin at 200.
const SCROLL = 50;
const HOLD = 200;

// Below this and the ship is gone. Obstacles cash out crossing it too.
const OUT = 500;

// Pieces in play the scene keeps stocked, counting the ones still above the
// screen, and the seconds the wreck holds before the shell takes the screen.
const FIELD = 10;
const DEATH = 0.5;

// Per-second acceleration of one thruster, the rate drift bleeds off at, how
// far out from the ship a thruster sits, how fast the two spin keys turn, and
// how fast the exhaust comes out.
//
// The Haxe had 5 and 0.01, and ugl put both through the same per-second
// accelerate() this does. That ship cannot fly: 5 a second against a 50 a
// second slide takes ten seconds of holding one key to break even, and the
// slide has carried it off the bottom of the screen in five. These two are
// picked instead against the two things that matter, since thrust over drag is
// the top speed and one over drag is how long it takes to get there: a ship
// that tops out at 125, far enough over the 50 slide to climb and not so far
// that it dives into a field it cannot see coming, and gets there in half a
// second.
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
// The fraction of a point the field has earned but not yet paid out.
let adds = 0;
let dying = 0;

/*
 * One thruster, riding a fixed angle out from the ship and lettered with the
 * key that fires it. It is the exhaust that moves the ship, so firing pushes
 * along `offset` reversed.
 */
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
    new ent.Particle()
      .color(FLAME)
      .count(1, 2)
      .size(5, 5)
      .xy(this.pos.x, this.pos.y)
      .speed(EXHAUST, 100)
      .direction(this.angle + this.offset - Math.PI / 8, Math.PI / 4)
      .delay(0, 0.05)
      .duration(0.25, 0.1);
  }
}

class Player extends ent.Entity {
  constructor() {
    super();
    this.art.color(SHIP, SHIP_DARK, 253).size(20, 4, 4)
      .rect(0, 1.5, 4, 1).rect(1.5, 0, 1, 4);
    // The two arms of the cross, in the ship's own coordinates.
    this.hitPoly([-40, -10, 40, -10, 40, 10, -40, 10]);
    this.hitPoly([-10, -40, 10, -40, 10, 40, -10, 40]);
    // Right, up, left, down, which is the order Player.update() fires them in.
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
    // Sliding sideways rolls the ship, and a rolled ship thrusts sideways, so
    // the roll feeds itself and a dodge left alone tips the thrusters over
    // within a few seconds. Spinning it back upright is what x and c are for.
    this.angle += time * this.vel.x / 200;

    if (this.pos.y > OUT) this.kill();
  }

  kill() {
    new ent.Particle()
      .color(SHIP)
      .count(100)
      .xy(this.pos.x, this.pos.y)
      .size(5, 25)
      // The Haxe threw these at 20 to 50 a second, on the frame ugl cleared
      // the board, so it never drew a single one of them. Seen, that is a
      // green lump sitting where the ship was. At 200 to 400 it is a ship
      // coming apart, and the freeze-frame catches it still going.
      .speed(200, 200)
      .delay(0)
      .duration(2, 0.5);
    for (const e of this.engines) e.remove();
    this.remove();
    dying = DEATH;
  }
}

// The red crosses. They only ever move with the world.
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
    new ent.Text()
      .text("+5")
      .duration(1)
      .xy(Math.min(Math.max(this.pos.x, 10), W - 10), W)
      .move(0, -20);
    this.remove();
  }
}

// A coin worth what is written on it, 10 to 90.
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
      new ent.Text()
        .text(`+${this.points}`)
        .duration(1)
        .xy(this.pos.x, this.pos.y)
        .move(0, -20);
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
  ent.reset();
  ent.world(W);
  ent.order([Obstacle, Gold, Player, Engine, ent.Particle, ent.Text]);

  player = new Player();
  player.pos.x = player.pos.y = 240;
  adds = 0;
  dying = 0;
}

export function update(dt) {
  // The wreck runs on a still board: nothing here moves a piece except the
  // slide, so holding it also stops an obstacle from cashing out.
  if (dying > 0) {
    dying -= dt;
    ent.update(dt);
    if (dying <= 0) gameOver();
    return;
  }

  // ugl ran the scene before the entities, and this has to keep that order: it
  // slides the world out from under a step that has not run yet.
  const dx = W / 2 - player.pos.x;
  // The board holds still while the hint is up. A ship that starts falling
  // over a player who is still reading has spent the altitude it needed before
  // they have touched a key, and there is no way back up from the bottom.
  // hint() is 0 the moment they do touch one, and 0 from the second round on.
  const dy = Math.max(hint() > 0 ? 0 : SCROLL * dt, HOLD - player.pos.y);
  player.pos.x += dx;
  player.pos.y += dy;

  // A piece still above the screen counts, so the field is stocked before it
  // arrives; one the ship has flown out of sight of does not, and comes back
  // into the count when the ship flies back.
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

  // A tenth of a point a second for each piece in play, so a stocked field
  // pays about one a second for flying through it.
  adds += valid * dt / 10;
  if (adds >= 1) {
    score.value += 1;
    adds -= 1;
  }

  ent.update(dt);
}

export function render(ctx) {
  ent.render(ctx);
}
