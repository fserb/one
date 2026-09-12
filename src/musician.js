/*
 * musician - "Street Musician".
 *
 * The idea the whole game is built on: `bpm` is both the tempo and the speed in
 * px a second. A grid step is a sixteenth, 60/(4*bpm) seconds, so a step is
 * 15px wide at every tempo and notes stay 75px apart however fast it gets. Only
 * the speed ramps.
 *
 * A throw is an arc arriving at its own apex rather than a straight shot up
 * through the lane: an arc is easier to see in peripheral vision than a
 * straight line at constant speed.
 *
 * The tempo rises with notes played and not with score and combo: a tempo from
 * score accelerates and drops back on every miss, so failing makes it easier.
 *
 * The pointer places the busker and a click plays the note, the same gesture on
 * purpose: from one pointer the press that begins a drag is the same edge as
 * the tap that strikes, and the pointer gives the position directly, so a tap
 * plays where the busker already is. Splitting the screen in two does not work,
 * because alma's Input averages every pointer into one.
 */

import * as ent from "./lib/entity.js";
import { gameOver, msg, score, SIZE } from "./lib/one.js";
import { blip, coin, explosion, hit } from "./lib/fsfx/sfxr.js";
import * as sound from "./lib/sound.js";

export const meta = {
  title: "musician",
  desc: `
tap when a note reaches the mark
slide to catch coins and dodge tomatoes
`,
  bg: "#444444",
  fg: "#F7E26B",
  scoreMax: true,
  date: "2014-03-31",
};

const W = 480;
// The lane along the top, and where a note comes on from.
const LANE = 75;
const BAND = 30;
const MARK = 240;
const SPAWN = 510;
const FIRST = 430;

// The pivot is off the bottom of the screen, so the walk is a shallow curve:
// 36 degrees each way, 247 of the 480 across and 40 of it down.
const PIVX = 240;
const PIVY = 460;
const ARM = 210;
const LEAN = Math.PI / 5;
// Radians a second: the keys, then an untouched lean unwinding.
const TURN = 2 * Math.PI / 3;
const RETURN = 1.2;
// The fraction of the lean the figure is drawn and collides at; the whole 36
// degrees is falling over, not leaning.
const TILT = 0.5;

// A throw starts off the bottom, arrives at the middle of the arc, and is gone
// past FLOOR on the way back down. Each arrives at the top of its own arc, so
// the time sets its gravity, and that is the only difference between the two.
const THROW = 520;
const REACH = 265;
const FLOOR = 560;
const COIN_TIME = 1;
const TOMATO_TIME = 1.6;
// The launch window, which is most of the arc.
const AIM0 = 120;
const AIM1 = 360;

// Notes arrive at bpm/75 a second, so the tempo is its own derivative and
// PER_NOTE fixes the doubling time at 22 seconds.
const BPM0 = 60;
const PER_NOTE = 2.4;
const DENSITY = 0.2;
const TICK = 4; // four sixteenths between ticks, so the tick is the beat
// WINDOW is the two 20-unit boxes overlapping and PAY is exactly centred. The
// run is the tempo too, so an uncapped combo in the coin as well would make the
// score the square of the game.
const WINDOW = 20;
const PAY = 9;
const COMBO_CAP = 9;
// A played note rises and a dropped one falls, at SETTLE, fading over FADE.
const SETTLE = 100;
const FADE = 0.5;

// Half the body: what a tomato has to reach.
const BODYW = 26;
const BODYH = 36;
// How far off the body a coin still counts, and the tomato's radius.
const CATCH = 16;
const SPLAT = 8;

const HATX = 240;
const HATY = 360;

const DEATH = 0.6;

// Arne's palette.
const GREY = 0x697175;
const RED = 0xbe2633;
const ORANGE = 0xeb8931;
const PINK = 0xde65e2;
const YELLOW = 0xf7e26b;
const GREEN = 0x44891a;
const BLACK = 0x000000;
// The one colour outside that palette: it separates instrument from street.
const LANE_BG = "#383838";

// 0 body, 1 hat, 2 instrument, 3 face.
const BUSKER = `
..1..
.111.
.3322
.000.
.0.0.
`;

const NOTE = `
..0..
.000.
00000
.000.
.000.
`;

const HOLD = `
..0..
.0.0.
0...0
.0.0.
.000.
`;

const HAT = `
0000
.00.
`;

sound.voice("note", { ...blip(0), vol: 0.13 });
sound.voice("tick", { ...blip(0), vol: 0.035 });
sound.voice("coin", { ...coin(12), vol: 0.12 });
sound.voice("miss", { ...hit(3), vol: 0.12 });
sound.voice("tomato", { ...explosion(16), vol: 0.2 });

let player = null;
let bpm = BPM0;
let combo = 0;
// Played or dropped. This is the tempo, and it never falls back in a round.
let resolved = 0;
let step = 0;
let steps = 0;
let strike = false;
let dying = 0;
// Only a pointer that has moved takes over, so a stationary mouse does not move
// the busker on frame one. A held key takes it back.
let aiming = false;
let lastx = null;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Notes are 15px apart and 20 wide, so three can cover the mark at once and
// only the leftmost unresolved one is yours. Picked here, ahead of the Note
// group, which is what the draw order in init() is doing.
class Mark extends ent.Entity {
  constructor() {
    super();
    this.pos.x = MARK;
    this.pos.y = LANE;
    this.art.size(4, 5, 5).obj([BLACK], HOLD);
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
  constructor(x = SPAWN) {
    super();
    this.pos.x = x;
    this.pos.y = LANE;
    this.front = false;
    this.done = false;
    this.good = false;
    this.red = false;
    this.art.size(4, 5, 5).obj([ORANGE], NOTE);
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
    if (!this.done) this.pos.x -= bpm * t;
  }

  paint(red) {
    if (red === this.red) return;
    this.red = red;
    this.art.size(4, 5, 5).obj([red ? RED : ORANGE], NOTE);
  }

  play(off) {
    this.done = this.good = true;
    combo += 1;
    resolved += 1;
    sound.play("note");
    const run = Math.min(COMBO_CAP, combo);
    new Coin(Math.round(run + PAY * (1 - off / WINDOW)));
  }

  drop() {
    this.done = true;
    combo = 0;
    resolved += 1;
    sound.play("miss");
    new Tomato();
  }
}

// It reaches the top of its own arc on the busker's line, so `time` is the
// whole shape of it: the gravity that puts the apex there follows, and so does
// the speed it arrives at.
function lob(e, time) {
  e.pos.x = Math.random() * W;
  e.pos.y = THROW;
  e.grav = 2 * (THROW - REACH) / (time * time);
  e.vel.x = (AIM0 + (AIM1 - AIM0) * Math.random() - e.pos.x) / time;
  e.vel.y = -e.grav * time;
}

class Coin extends ent.Entity {
  constructor(value) {
    super();
    this.value = value;
    lob(this, COIN_TIME);
    this.art.size(2, 5, 5).color(YELLOW).circle(2.5, 2.5, 2.5);
    // A coin counts from further out than a tomato, so two aimed at the same
    // place is a choice and not a trap.
    this.hitCircle(CATCH);
  }

  update() {
    this.accelerate(0, this.grav);
    if (dying > 0) return;

    if (this.hit(player)) {
      score.value += this.value;
      sound.play("coin");
      new ent.Text({
        text: `$${this.value}`,
        x: this.pos.x,
        y: this.pos.y,
        size: 2,
        color: YELLOW,
        vel: [0, -20],
        duration: 1,
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
    lob(this, TOMATO_TIME);
    this.art.size(4, 5, 5).color(RED).circle(2.5, 2.5, 2)
      .color(GREEN).dot(2, 1).dot(2, 0).dot(3, 0);
    this.hitCircle(SPLAT);
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
        size: [5, 6],
        speed: [0, 200],
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
    this.art.size(8, 5, 5).obj([GREY, RED, ORANGE, PINK], BUSKER);
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
    this.pos.y = PIVY - ARM * Math.cos(this.lean);
    this.angle = this.lean * TILT;
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

    const rate = TURN * t;
    if (mx !== 0) {
      this.lean += mx * rate;
    } else if (aiming) {
      // A point on the arc, not a direction: it stops under the finger.
      const want = Math.asin(clamp((input.x - PIVX) / ARM, -1, 1));
      const d = want - this.lean;
      this.lean += Math.abs(d) <= rate ? d : Math.sign(d) * rate;
    } else {
      this.lean -= this.lean * RETURN * t;
    }
    this.lean = clamp(this.lean, -LEAN, LEAN);
    this.place();
  }
}

// Scenery, colliding with nothing, and the only thing on screen that shows
// this is a street.
class Hat extends ent.Entity {
  constructor() {
    super();
    this.pos.x = HATX;
    this.pos.y = HATY;
    this.art.size(8, 4, 2).obj([BLACK], HAT);
  }
}

function die() {
  if (dying > 0) return;
  dying = DEATH;
  ent.shake(0.5);
  sound.play("tomato");
}

export function init() {
  ent.reset([Hat, Mark, Coin, Tomato, Note, Player]);

  new Hat();
  new Mark();
  // On screen, not off it, so frame one shows what the lane is for.
  new Note(FIRST);
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
  msg("");
}

export function update(dt) {
  // This frame's, not entity.js's copy, which only refreshes inside
  // ent.update(). Every note has to see the same answer.
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
      if (steps % TICK === 0) sound.play("tick");
      steps += 1;
      if (Math.random() < DENSITY) new Note();
    }
  }

  msg(combo > 1 ? `${combo} IN A ROW` : "");
  if (dying > 0 && (dying -= t) <= 0) gameOver({ score: true });
}

export function render(ctx) {
  ctx.save();
  ctx.scale(SIZE / W, SIZE / W);
  ctx.fillStyle = LANE_BG;
  ctx.fillRect(0, LANE - BAND / 2, W, BAND);
  ctx.restore();
  ent.render(ctx);
}
