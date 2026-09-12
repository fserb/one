/*
 * flap - a FlappyBird puzzle.
 *
 * No steering. The bird flies at full speed sideways, turns only at a wall, and
 * one button pushes it up against gravity.
 *
 * A coin lands a random distance along the path the bird is already on, no
 * further off its height than it can climb on the way, so every coin is one
 * this pass can reach.
 */

import * as ent from "./lib/entity.js";
import { gameOver, score } from "./lib/one.js";

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
const BIRD = 0xf8b733;
const BIRD_DARK = 0xe0802c;
const BIRD_LIPS = 0xfc3800;

const COIN = 0xe9e1e1;
const COIN_LIT = 0xffffff;
const COIN_DIM = 0xc8c0c0;
const COIN_EDGE = 0x847f7f;

const LEFT = 40;
const RIGHT = 984;
const TOP = 40;
const BOTTOM = 984;

// Sideways speed never changes, only a wall turns it.
const SPEED = 210;
const FLAP = 420;
const GRAVITY = 630;

// It faces right and flipX turns it around. The beak is drawn first, so the
// body's outline is the line between the two. The wing is the second tone on
// the body and the eye the one white. size() holds the box whatever the beak
// reaches, so the drawing does not shift with it.
const BODY_R = 22;

class Bird extends ent.Entity {
  begin() {
    this.pos.x = this.pos.y = 512;
    this.left = false;
    this.gfx.size(80, 52)
      .fill(BIRD_LIPS).mt(10, -11).lt(38, 0).lt(10, 11)
      .fill(BIRD).line(5, DARK).circle(-6, 0, BODY_R)
      .fill(BIRD_DARK).line(null).rect(-24, 3, 20, 11, 11)
      .fill(WHITE).line(4, DARK).circle(6, -9, 9)
      .fill(DARK).line(null).circle(9, -9, 4);
    // The body and the beak, near enough to the drawing.
    this.hitBox(64, 44);
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

    if (ent.game.input.just.act) this.vel.y = -FLAP;
  }
}

class Coin extends ent.Entity {
  static layer = 5;

  begin() {
    const bird = ent.one(Bird);
    // Along the path the bird is already on, so never a round trip away.
    const d = 210 + Math.random() * 600;
    this.pos.x = along(bird.pos.x, bird.left ? -1 : 1, d);

    // No further off its height than it can climb on the way.
    const span = (d / SPEED) * FLAP * 0.7;
    const lo = Math.max(TOP + 40, bird.pos.y - span);
    const hi = Math.min(BOTTOM - 40, bird.pos.y + span);
    this.pos.y = lo + Math.random() * (hi - lo);

    this.life = this.max = d / SPEED +
      Math.abs(this.pos.y - bird.pos.y) / FLAP +
      Math.max(0.8, 2.2 - score.value * 0.05);
    this.hitCircle(21);
    this.draw();
  }

  draw() {
    // Radius 21, a line a fifth of it wide, highlights that far above and
    // below centre, times what is left.
    const r = 21 * this.life / this.max;
    const w = Math.max(2, r / 5);
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
    new ent.Particle({
      x: this.pos.x,
      y: this.pos.y,
      color: COIN_LIT,
      count: [60, 20],
      size: [9, 6],
      speed: [128, 256],
      duration: [0.6, 0.2],
    });
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
  ent.reset();

  // Bird first: a coin reads it in begin(), and groups begin in build order.
  new Bird();
  new Coin();
}

export { render, update } from "./lib/entity.js";
