/*
 * flap - a port of ~/prj/vault/games/sketch/src/FBP.hx, "FlappyBird Puzzle".
 *
 * No steering. The bird flies flat out sideways, turns only at a wall, and one
 * button pushes it up against gravity. Getting to the coin with that much
 * control is the puzzle.
 *
 * The source is a sketch: neither bird nor coin ever got a hit box, so the coin
 * cannot be picked up, and there is no score and no way to lose. The physics,
 * the art and the coin are the port; the game is new. A coin lands a random
 * distance along the path the bird is already on, no further off its height
 * than it can climb on the way, so every coin is one the sweep could reach.
 *
 * The ceiling is at 42, not 20: the bar covers the top 21 of the 480 box.
 */

import * as ent from "./lib/entity.js";
import "./lib/gfx.js";
import { gameOver, hint, score } from "./lib/one.js";

export const meta = {
  title: "flap",
  desc: `
one button up, the walls turn you around
catch the coin before it goes
`,
  bg: "#4EC0CA",
  fg: "#533846",
  scoreMax: true,
  date: "2015-03-29",
};

const DARK = 0x533846;
const WHITE = 0xfafafa;
const GREY = 0xd7e6cc;
const BIRD = 0xf8b733;
const BIRD_LIGHT = 0xfad78c;
const BIRD_DARK = 0xe0802c;
const BIRD_LIPS = 0xfc3800;

const COIN = 0xe9e1e1;
const COIN_LIT = 0xffffff;
const COIN_DIM = 0xc8c0c0;
const COIN_EDGE = 0x847f7f;

const LEFT = 20;
const RIGHT = 460;
const TOP = 42;
const BOTTOM = 460;

// Sideways speed never changes, only a wall turns it. ugl ran at 60fps and
// added 5 to vel.y a frame, which is this gravity.
const SPEED = 100;
const FLAP = 200;
const GRAVITY = 300;

class Bird extends ent.Entity {
  begin() {
    this.pos.x = this.pos.y = 240;
    this.left = false;
    this.art.size(2, 17, 12).obj(
      [DARK, WHITE, GREY, BIRD, BIRD_LIGHT, BIRD_DARK, BIRD_LIPS],
      `
......000000.........004440110.......04433011110.....0433330211010..
.03333330211010...00000333021110..0111110333000000.04111403306666660
.000005506000000...05555550666660....005555500000.......00000.......`,
    );
    // 17x12 pixels at two units each, near enough to the drawing.
    this.hitBox(30, 20);
  }

  update() {
    if (!this.left && this.pos.x >= RIGHT) this.left = true;
    else if (this.left && this.pos.x <= LEFT) this.left = false;

    // The ceiling and the floor keep a quarter of what they take.
    if (this.pos.y < TOP) {
      this.pos.y = TOP;
      this.vel.y = Math.abs(this.vel.y) * 0.75;
    } else if (this.pos.y > BOTTOM) {
      this.pos.y = BOTTOM;
      this.vel.y = -Math.abs(this.vel.y) * 0.75;
    }

    this.accelerate(0, GRAVITY);
    this.vel.x = this.left ? -SPEED : SPEED;
    this.flipX = this.left;

    if (ent.game.key.just.b1) this.vel.y = -FLAP;
  }
}

class Coin extends ent.Entity {
  static layer = 5;

  begin() {
    const bird = ent.one(Bird);
    // Along the path the bird is already on, so never a round trip away. Miss
    // the pass and it is gone: the height is the whole puzzle.
    const d = 100 + Math.random() * 280;
    this.pos.x = along(bird.pos.x, bird.left ? -1 : 1, d);

    // No further off its height than it can climb on the way.
    const span = (d / SPEED) * FLAP * 0.7;
    const lo = Math.max(TOP + 20, bird.pos.y - span);
    const hi = Math.min(BOTTOM - 20, bird.pos.y + span);
    this.pos.y = lo + Math.random() * (hi - lo);

    this.life = this.max = d / SPEED +
      Math.abs(this.pos.y - bird.pos.y) / FLAP +
      Math.max(0.8, 2.2 - score.value * 0.05);
    this.hitCircle(10);
    this.draw();
  }

  draw() {
    // The original at radius 10, 2 wide line, highlights 2 above and below
    // centre, times what is left.
    const r = 10 * this.life / this.max;
    const w = Math.max(1, r / 5);
    this.gfx.clear()
      .fill(COIN).circle(0, 0, r).fill(null)
      .line(w, COIN_LIT).arc(0, w, r, r, 0, Math.PI)
      .line(w, COIN_DIM).arc(0, -w, r, r, Math.PI, 2 * Math.PI)
      .line(w, COIN_EDGE).circle(0, 0, r);
  }

  update() {
    this.life -= ent.game.time;
    if (this.life <= 0) {
      this.remove();
      gameOver({ score: true });
      return;
    }
    this.draw();

    if (this.hitGroup(Bird) === null) return;

    score.value += 1;
    new ent.Particle()
      .color(COIN_LIT)
      .xy(this.pos.x, this.pos.y)
      .count(60, 20)
      .size(4, 3)
      .duration(0.6, 0.2)
      .speed(60, 120);
    this.remove();
    new Coin();
  }
}

// Where the bird is after `d` of travel: the path folds at the walls.
function along(x, dir, d) {
  const w = RIGHT - LEFT;
  const t = (((x - LEFT) + dir * d) % (2 * w) + 2 * w) % (2 * w);
  return LEFT + (t <= w ? t : 2 * w - t);
}

export function init() {
  hint(meta.desc);
  ent.reset();
  ent.world(480);

  // Bird first: a coin reads it in begin(), and groups begin in build order.
  new Bird();
  new Coin();
}

export function update(dt) {
  ent.update(dt);
}

export function render(ctx) {
  ent.render(ctx);
}
