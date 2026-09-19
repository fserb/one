/*
 * musician - "Street Musician".
 *
 * The tempo is the speed. A grid step is a sixteenth, 60/(4*bpm) seconds, and a
 * note covers 32 units in one, so notes stay 160 apart however fast it gets.
 *
 * A throw is an arc arriving at its own apex rather than a straight shot up the
 * lane: an arc is easier to see in peripheral vision.
 *
 * The tempo rises with notes played and not with score and combo: a tempo from
 * score drops back on every miss, so failing would make it easier.
 *
 * The pointer places the busker and a click plays the note, one gesture: the
 * press that begins a drag is the same edge as the tap that strikes. Splitting
 * the screen in two does not work, since alma's Input averages the pointers.
 */

import * as ent from "./lib/entity.js";
import { shake } from "./lib/camera.js";
import { gameOver, msg } from "./lib/one.js";
import * as play from "./lib/sounds.js";

export const meta = {
  title: "musician",
  bg: "#444444",
  fg: "#F7E26B",
  scoreMax: true,
  date: "2014-03-31",
};

// The lane along the top.
const LANE = 160;
const BAND = 64;
const MARK = 512;

// The pivot is off the bottom, so the walk is a shallow curve: 36 degrees each
// way, 527 of the 1024 across and 86 of it down.
const PIVX = 512;
const ARM = 448;
const LEAN = Math.PI / 5;

const THROW = 1110;
const FLOOR = 1195;

// Notes arrive at bpm/75 a second, so the tempo is its own derivative and
// PER_NOTE fixes the doubling time at 22 seconds.
const BPM0 = 60;
const PER_NOTE = 2.4;
// A note covers one grid step in a sixteenth, so the speed follows the tempo.
const SPEED = 4 * 32 / 60; // units a second per bpm
const WINDOW = 40;
const PAY = 9;
const SETTLE = 215;
const FADE = 0.5;

// Half the body: what a tomato has to reach.
const BODYW = 55;
const BODYH = 77;

// Arne's palette.
const GREY = 0x697175;
const RED = 0xbe2633;
const ORANGE = 0xeb8931;
const PINK = 0xde65e2;
const YELLOW = 0xf7e26b;
const GREEN = 0x44891a;
const BLACK = 0x000000;
// The one colour outside it: the instrument against the street.
const LANE_BG = "#383838";

// The mark is the note's own diamond as an outline, so a note arriving sits
// inside the shape it has to land in.
const NOTE_R = 16;

let player = null;
let bpm = BPM0;
let combo = 0;
// Played or dropped. This is the tempo, and it never falls back in a round.
let resolved = 0;
let step = 0;
let steps = 0;
let strike = false;
let dying = 0;
// Only a pointer that has moved takes over; a held key takes it back.
let aiming = false;
let lastx = null;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A stroked path does not close itself, so the outline comes back to its start.
function diamond(gfx, r) {
  gfx.mt(0, -r).lt(r, 0).lt(0, r).lt(-r, 0).lt(0, -r);
}

// Notes are 32 apart and 40 wide, so three can cover the mark at once and only
// the leftmost unresolved one is yours. Picked ahead of the Note group.
class Mark extends ent.Entity {
  constructor() {
    super();
    this.pos.x = MARK;
    this.pos.y = LANE;
    diamond(this.gfx.line(6, BLACK), 20);
  }

  update() {
    let front = null;
    for (const n of ent.get(Note)) {
      n.front = false;
      if (n.done) continue;
      if (front === null || n.pos.x < front.pos.x) front = n;
    }
    if (front !== null) front.front = true;
  }
}

class Note extends ent.Entity {
  constructor(x = 1090) {
    super();
    this.pos.x = x;
    this.pos.y = LANE;
    this.front = false;
    this.done = false;
    this.good = false;
    this.red = false;
    diamond(this.gfx.fill(ORANGE), NOTE_R);
  }

  update() {
    if (dying > 0) return;
    const t = ent.game.time;

    if (this.done) {
      this.pos.y += (this.good ? -SETTLE : SETTLE) * t;
      this.alpha -= t / FADE;
      if (this.alpha <= 0) this.remove();
      return;
    }

    const off = Math.abs(this.pos.x - MARK);
    const over = off <= WINDOW;
    // The note on the mark covers it, so the colour is the only cue.
    this.paint(over && this.front);

    if (over) {
      if (this.front && strike) this.play(off);
    } else if (this.front && (this.pos.x < MARK || strike)) {
      this.drop();
    }
    if (!this.done) this.pos.x -= SPEED * bpm * t;
  }

  paint(red) {
    if (red === this.red) return;
    this.red = red;
    diamond(this.gfx.clear().fill(red ? RED : ORANGE), NOTE_R);
  }

  play(off) {
    this.done = this.good = true;
    combo += 1;
    resolved += 1;
    play.blip();
    const run = Math.min(9, combo);
    new Coin(Math.round(run + PAY * (1 - off / WINDOW)));
  }

  drop() {
    this.done = true;
    combo = 0;
    resolved += 1;
    play.deny();
    new Tomato();
  }
}

// It reaches the top of its own arc on the busker's line, so `time` is the
// whole shape of it: the gravity that puts the apex there follows.
function lob(e, time) {
  e.pos.x = Math.random() * 1024;
  e.pos.y = THROW;
  e.grav = 2 * (THROW - 565) / (time * time);
  e.vel.x = (256 + 512 * Math.random() - e.pos.x) / time;
  e.vel.y = -e.grav * time;
}

class Coin extends ent.Entity {
  constructor(value) {
    super();
    this.value = value;
    lob(this, 1);
    this.gfx.fill(YELLOW).circle(0, 0, 10);
    // A coin counts from further out than a tomato, so a pair is a choice.
    this.hitCircle(34);
  }

  update() {
    this.accelerate(0, this.grav);
    if (dying > 0) return;

    if (this.hit(player)) {
      play.coin();
      ent.addScore(this.value, this.pos.x, this.pos.y, {
        text: `$${this.value}`,
      });
      this.remove();
      return;
    }
    if (this.pos.y > FLOOR) this.remove();
  }
}

class Tomato extends ent.Entity {
  constructor() {
    super();
    lob(this, 1.6);
    this.gfx.fill(RED).circle(0, 0, 16)
      .fill(GREEN).rect(-4, -20, 8, 13).mt(3, -20).lt(15, -20).lt(3, -9);
    this.hitCircle(16);
  }

  update() {
    this.accelerate(0, this.grav);
    if (dying > 0) return;

    if (this.hit(player)) {
      new ent.Particle({
        x: this.pos.x,
        y: this.pos.y,
        color: RED,
        count: 200,
        size: [11, 13],
        speed: [0, 425],
        duration: [0.5, 0.5],
      });
      this.remove();
      die();
      return;
    }
    if (this.pos.y > FLOOR) this.remove();
  }
}

class Player extends ent.Entity {
  constructor() {
    super();
    this.lean = 0;
    this.gfx.size(85, 85)
      .fill(GREY).rect(-20, -8, 40, 34, 16)
      .rects([[-19, 22, 14, 20], [5, 22, 14, 20]])
      .fill(PINK).circle(0, -18, 13)
      .fill(RED).rect(-11, -42, 22, 14, 6).rect(-27, -30, 54, 10, 8)
      .fill(ORANGE).mt(-24, -4).lt(-19, -10).lt(6, 8).lt(1, 14)
      .circle(10, 10, 14);
    this.hitPoly([
      -BODYW / 2,
      -BODYH / 2,
      BODYW / 2,
      -BODYH / 2,
      BODYW / 2,
      BODYH / 2,
      -BODYW / 2,
      BODYH / 2,
    ]);
    this.place();
  }

  // `lean` is the place on the arc, `angle` how far over the figure is drawn.
  // The hit polygon turns by `angle`, so a tomato hits what is on screen.
  place() {
    this.pos.x = PIVX + ARM * Math.sin(this.lean);
    this.pos.y = 981 - ARM * Math.cos(this.lean);
    this.angle = this.lean * 0.5;
  }

  update() {
    if (dying > 0) return;
    const { input } = ent.game;
    const t = ent.game.time;

    if (lastx !== null && (input.x !== lastx || input.press.act)) aiming = true;
    if (input.press.left || input.press.right) aiming = false;
    lastx = input.x;

    let mx = 0;
    if (input.press.left) mx -= 1;
    if (input.press.right) mx += 1;

    const rate = 2 * Math.PI / 3 * t;
    if (mx !== 0) {
      this.lean += mx * rate;
    } else if (aiming) {
      // A point on the arc, not a direction: it stops under the finger.
      const want = Math.asin(clamp((input.x - PIVX) / ARM, -1, 1));
      const d = want - this.lean;
      this.lean += Math.abs(d) <= rate ? d : Math.sign(d) * rate;
    } else {
      this.lean -= this.lean * 1.2 * t;
    }
    this.lean = clamp(this.lean, -LEAN, LEAN);
    this.place();
  }
}

// Scenery, colliding with nothing: the one thing that says this is a street.
class Hat extends ent.Entity {
  constructor() {
    super();
    this.pos.x = 512;
    this.pos.y = 768;
    this.gfx.size(68, 34).fill(BLACK)
      .rect(-34, -17, 68, 9, 6)
      .mt(-25, -9).lt(25, -9).lt(18, 17).lt(-18, 17);
  }
}

function die() {
  if (dying > 0) return;
  dying = 0.6;
  shake(0.5);
  play.lose();
}

export function init() {
  ent.reset([Hat, Mark, Coin, Tomato, Note, Player]);

  new Hat();
  new Mark();
  // On screen, not off it, so frame one shows what the lane is for.
  new Note(915);
  player = new Player();

  bpm = BPM0;
  combo = 0;
  resolved = 0;
  step = 0;
  steps = 0;
  strike = false;
  dying = 0;
  aiming = false;
  lastx = null;
}

export function update(dt) {
  // This frame's, not entity.js's copy: every note sees the same answer.
  const { input } = ent.game;
  strike = dying <= 0 && (input.just.act || input.just.up);

  bpm = BPM0 + PER_NOTE * resolved;
  ent.update(dt);

  const t = ent.game.time;
  if (dying <= 0) {
    const grid = 60 / (4 * bpm);
    step += t;
    while (step >= grid) {
      step -= grid;
      if (steps % 4 === 0) play.select(); // four sixteenths to a beat
      steps += 1;
      if (Math.random() < 0.2) new Note();
    }
  }

  msg(combo > 1 ? `${combo} IN A ROW` : "");
  if (dying > 0 && (dying -= t) <= 0) gameOver({ score: true });
}

export function render(ctx) {
  ctx.fillStyle = LANE_BG;
  ctx.fillRect(0, LANE - BAND / 2, 1024, BAND);
  ent.render(ctx);
}
