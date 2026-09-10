/*
 * musician - a port of ~/prj/vault/games/sketch/src/Musician.hx, "Street
 * Musician".
 *
 * Two hands. One plays: notes march in from the right along a lane at the top
 * and you strike whichever one is sitting on the mark. The other works the
 * crowd, because the crowd answers every note you play. A clean note buys a
 * coin flipped up out of the dark at the bottom of the screen, a dropped one
 * buys a tomato thrown the same way, and both arrive on the busker's own line
 * a second or two later. So a good run is also a run of coins you have to be
 * standing under, and every note you drop is a tomato already in the air. The
 * busker swings on an arc, and that arc is the only thing that gets you across
 * to a coin or out from under a tomato.
 *
 * The one thing in the Haxe worth keeping whole: `bpm` is both the tempo and
 * the speed in px a second the notes travel at. A grid step is a sixteenth,
 * 60/(4*bpm) seconds, so a step is bpm * 60/(4*bpm) = 15px wide at every
 * tempo. The notes stay 75px apart on average however fast it gets, and only
 * the speed ramps: the difficulty is one number and the lane never has to be
 * read differently.
 *
 * What the Haxe has is the playing half finished and the crowd half wired to
 * nothing that works. The mark sits at y=80, the busker's arc at y=140 to 178,
 * and coins and tomatoes are launched from y=500 in a straight line at a
 * random point on that arc and carry on off the top of the screen. The whole
 * game is in the top third of a 480 box, the throws fly through the note lane
 * on their way out, and the bottom 300px holds one static `Hat` at the dead
 * centre that touches nothing.
 *
 * What changed:
 *
 * - The screen is used. The lane is at the top, the busker's arc at 250 to
 *   290, and a throw is a lob: it arrives at the top of its own arc on the
 *   busker's line and falls back down out of the bottom. Nothing crosses the
 *   lane, and an arc coming up out of the dark is readable in the corner of
 *   your eye in a way a straight line at a constant speed is not.
 * - There is a tick on the beat. The Haxe is a rhythm game with no sound on
 *   the beat at all: the only cue is the note arriving, which is the one thing
 *   you cannot watch while you are getting out from under a tomato. The tick
 *   is what lets the two halves be played at once, and it is the whole reason
 *   the lane can be 200px away from the busker.
 * - A dropped note makes a sound. The Haxe answered one with a tomato and
 *   nothing else, so the first you knew of it was the throw.
 * - The tempo climbs on notes gone by rather than on the score and the combo.
 *   The Haxe's `60 + 140*score/2000 + combo` runs away, because `combo` has no
 *   ceiling and the coin it pays for is worth the combo too, so the score is
 *   the square of the run and the tempo is the square of that. It also falls
 *   back every time you drop a note, and a game that gets easier when you fail
 *   has nothing to push against. One note gone by, played or dropped, is worth
 *   PER_NOTE, which makes the tempo an exponential in time doubling every 22
 *   seconds: easy for 20, real by 35, and running at four notes a second by
 *   50. Nothing caps it, and nothing needs to: it is the note rate rather than
 *   the window that beats a hand, and it is beating one long before a note
 *   could cross the whole window inside a frame.
 * - A coin is worth at most COMBO_CAP + PAY. Uncapped it is the length of the
 *   run, which with the run also setting the tempo made the score the square
 *   of the game and told the player nothing.
 * - A note left of the window is dropped whether or not you touched it. The
 *   Haxe only dropped one that had been seen overlapping the mark, so a note
 *   moving further than the window in one frame would stay first in line for
 *   ever and lock every note behind it out of play.
 * - One tomato for one dropped note. The Haxe tested "it went past unplayed"
 *   and "you played it early" as two separate ifs on the same frame, so a note
 *   struck just after it left the mark threw two.
 * - The pointer says where the busker stands and a click plays the note, so
 *   one hand does both halves: slide, tap, slide, tap. The two are the same
 *   gesture on purpose, because they cannot be told apart from one pointer:
 *   the press that begins a drag is the same edge as the tap that strikes.
 *   Since the pointer names the position outright, a tap lands where the
 *   busker already is and moves nothing, which is what makes the pair
 *   playable. Splitting the screen into an instrument half and a street half
 *   does not work: alma's Input averages every pointer that is down into one,
 *   so a thumb on each half reads as one finger between them.
 * - The lean holds when nothing has moved. Arrows and the pointer are two
 *   ways to say the same thing, so the last one used wins, or a mouse parked
 *   somewhere fights every arrow key.
 * - The lean unwinds only when nothing is driving it. The Haxe took 2% of it
 *   per frame whatever else was happening, which both fought the keys and tied
 *   the feel to the frame rate.
 * - A tomato has to hit the figure rather than the sprite: 26x36 as a polygon,
 *   which turns with the lean, instead of the sprite's whole 40x40, most of
 *   which is air. ugl ran its box through the sprite matrix and entity.js
 *   turns a polygon alone.
 * - Death holds for half a second so the splat is seen. ugl cleared the scene
 *   on the frame the burst was made.
 * - The score is the shell's bar and the combo is the bar's message. The Haxe
 *   drew "$N" in a corner and the combo nowhere, though the combo is both what
 *   a coin is worth and how fast the notes come.
 * - The board holds still while the hint is up, and a tap that dismisses the
 *   hint is not a strike.
 *
 * The `Hat` is left exactly what it was: 32x16 of black lying on the ground,
 * touching nothing. It is the only thing on screen that says street, and it
 * puts a floor under the throws coming up out of the crowd.
 */

import * as ent from "./lib/entity.js";
import { gameOver, hint, msg, score, SIZE } from "./lib/one.js";
import * as sfxr from "./lib/sfxr.js";
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
  finishGood: false,
  date: "2014-03-31",
};

// The box the game thinks in.
const W = 480;

// The lane along the top: how far down it runs, the band drawn behind it, the
// mark on it, and where a note comes on from.
const LANE = 75;
const BAND = 30;
const MARK = 240;
const SPAWN = 510;
// Where the note the round opens with stands.
const FIRST = 430;

// The busker swings on an arc with its pivot off the bottom of the screen, so
// the walk is a shallow curve and the ends of it are lower than the middle.
// LEAN is as far round as it goes: 36 degrees each way, which is 247 of the 480
// across and 40 of it down.
const PIVX = 240;
const PIVY = 460;
const ARM = 210;
const LEAN = Math.PI / 5;
// Radians a second the keys turn the lean, and the rate an untouched one
// unwinds at.
const TURN = 2 * Math.PI / 3;
const RETURN = 1.2;
// How much of the lean the busker is drawn tilted by, and collides at. The
// Haxe drew the whole of it, and a figure at 36 degrees is not leaning into a
// swing, it is falling over.
const TILT = 0.5;

// A throw starts this far down, off the screen, and is aimed to arrive here,
// which is the middle of the busker's arc. Past FLOOR on the way back down it
// is gone.
const THROW = 520;
const REACH = 265;
const FLOOR = 560;
// Seconds each takes to get there. Each is thrown to arrive at the top of its
// own arc, so the time is what sets its gravity, and the only real difference
// between a coin and a tomato is how long you have to read it: a tomato is a
// slow lob and a coin is a flick you have to be under already.
const COIN_TIME = 1;
const TOMATO_TIME = 1.6;
// The Haxe's launch window: a throw comes from anywhere across the bottom and
// is aimed at a point between these two, which is most of the arc.
const AIM0 = 120;
const AIM1 = 360;

// The tempo, which is also px a second: where it starts, and what one note
// gone by adds to it. Notes arrive at bpm/75 a second, so the tempo is its own
// derivative and PER_NOTE fixes the doubling time at 22 seconds.
const BPM0 = 60;
const PER_NOTE = 2.4;
// Chance a grid step carries a note, and grid steps between two ticks: four
// sixteenths, so the tick is the beat.
const DENSITY = 0.2;
const TICK = 4;
// A note counts from this far off the mark, which is the two 20-unit boxes
// overlapping, and pays this much for dead centre falling to nothing at the
// edge. On top of the run, up to this much of it: the run is the tempo as
// well, so leaving it in the coin too makes the score the square of the game.
const WINDOW = 20;
const PAY = 9;
const COMBO_CAP = 9;
// A note that has been played rises and one that was dropped falls, both this
// fast, and both fade out over this long.
const SETTLE = 100;
const FADE = 0.5;

// Half the busker's body across and down: what a tomato has to reach.
const BODYW = 26;
const BODYH = 36;
// How far off the body a coin still counts, and a tomato's own radius, which
// is the Haxe's.
const CATCH = 16;
const SPLAT = 8;

// The hat on the ground.
const HATX = 240;
const HATY = 360;

// Caught, then this long before the shell takes the screen.
const DEATH = 0.6;

// The Arne palette the Haxe names.
const GREY = 0x697175;
const RED = 0xbe2633;
const ORANGE = 0xeb8931;
const PINK = 0xde65e2;
const YELLOW = 0xf7e26b;
const GREEN = 0x44891a;
const BLACK = 0x000000;
// The band behind the lane, a shade off meta.bg, which is the only thing here
// that is not the Haxe's: it splits the instrument from the street.
const LANE_BG = "#383838";

// 0 body, 1 hat, 2 instrument, 3 face. The instrument is the one thing that
// sticks out of the 3-wide figure, which is why the sprite is 4 across.
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

// ugl's Sound.vol(v) set masterVolume to 2v, and sfxr squares that. The three
// seeds the Haxe names are its own; the tick and the dropped note are new.
voice("note", sfxr.blip(0), 0.13);
voice("tick", sfxr.blip(0), 0.035);
voice("coin", sfxr.coin(12), 0.12);
voice("miss", sfxr.hit(3), 0.12);
voice("tomato", sfxr.explosion(16), 0.2);

function voice(name, params, vol) {
  params.masterVolume = 2 * vol;
  sound.put(name, sfxr.render(params), sfxr.SAMPLE_RATE);
}

let player = null;
// The tempo, which is px a second too, and the notes played in a row, which is
// what a coin is worth on top of the timing.
let bpm = BPM0;
let combo = 0;
// Notes gone by, played or dropped. This is the tempo, and unlike the combo it
// never falls back inside a round.
let resolved = 0;
// Seconds into the current grid step, and grid steps since the round began,
// which is what the tick counts off.
let step = 0;
let steps = 0;
// This frame's strike, held here because every note has to see the same one.
let strike = false;
// Nothing in the lane moves while the hint is up, for the same reason nothing
// moves in up: an opening the player is still reading is a dropped note.
let frozen = false;
let dying = 0;
// Whether the pointer is the thing steering, and where it was last frame.
// Only a pointer that has moved takes over, so a mouse already sitting
// somewhere off to one side does not drag the busker there on frame one, and
// the keys take it back the moment one is held.
let aiming = false;
let lastx = null;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/*
 * The mark, and the note on it that can be played: the leftmost one still
 * unresolved. Notes are 15px apart and 20 wide, so three of them can cover the
 * mark at once and only the first of those is yours. Picked here rather than in
 * the notes themselves, ahead of the Note group, which is what the draw order
 * in init() is doing.
 */
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
    // Yours to play, resolved, and resolved well.
    this.front = false;
    this.done = false;
    this.good = false;
    this.red = false;
    this.art.size(4, 5, 5).obj([ORANGE], NOTE);
  }

  update() {
    if (frozen || dying > 0) return;
    const t = ent.game.time;

    if (this.done) {
      this.pos.y += (this.good ? -SETTLE : SETTLE) * t;
      this.alpha -= t / FADE;
      if (this.alpha <= 0) this.remove();
      return;
    }

    const off = Math.abs(this.pos.x - MARK);
    const over = off <= WINDOW;
    // The cue: the note that is on the mark and next in line turns red. It
    // covers the mark itself while it is there, so the colour is all there is.
    this.paint(over && this.front);

    if (over) {
      if (this.front && strike) this.play(off);
    } else if (this.front && (this.pos.x < MARK || strike)) {
      // Gone past unplayed, or struck while it was still on its way. Either
      // way the beat is dropped, and one tomato answers it.
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

/*
 * A throw out of the crowd, from off the bottom of the screen. It reaches the
 * top of its own arc on the busker's line, so `time` is the whole shape of it:
 * the gravity that puts the apex there follows, and so does the speed it
 * arrives at, which is zero downward and whatever it needs sideways.
 */
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
    // The reach is the coin's, not the busker's: a coin counts from further
    // out than a tomato does, so a coin and a tomato aimed at the same place
    // is a choice and not a trap.
    this.hitCircle(CATCH);
  }

  update() {
    this.accelerate(0, this.grav);
    if (dying > 0) return;

    if (this.hit(player)) {
      score.value += this.value;
      sound.play("coin");
      new ent.Text().text(`$${this.value}`).size(2).color(YELLOW)
        .xy(this.pos.x, this.pos.y).move(0, -20).duration(1);
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
      new ent.Particle().color(RED).xy(this.pos.x, this.pos.y)
        .count(200).size(5, 6).speed(0, 200).duration(0.5, 0.5);
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

  // `lean` is the place on the arc and `angle` is how far over the figure is
  // drawn, which is also what its box turns by, so what a tomato hits is what
  // is on the screen.
  place() {
    this.pos.x = PIVX + ARM * Math.sin(this.lean);
    this.pos.y = PIVY - ARM * Math.cos(this.lean);
    this.angle = this.lean * TILT;
  }

  update() {
    if (dying > 0) return;
    const { key, mouse } = ent.game;
    const t = ent.game.time;

    if (lastx !== null && (mouse.x !== lastx || mouse.press)) aiming = true;
    if (key.left || key.right) aiming = false;
    lastx = mouse.x;

    let mx = 0;
    if (key.left) mx -= 1;
    if (key.right) mx += 1;

    const rate = TURN * t;
    if (mx !== 0) {
      this.lean += mx * rate;
    } else if (aiming) {
      // The pointer names a point on the arc rather than a direction, so it
      // puts the busker under the finger and stops there.
      const want = Math.asin(clamp((mouse.x - PIVX) / ARM, -1, 1));
      const d = want - this.lean;
      this.lean += Math.abs(d) <= rate ? d : Math.sign(d) * rate;
    } else {
      this.lean -= this.lean * RETURN * t;
    }
    this.lean = clamp(this.lean, -LEAN, LEAN);
    this.place();
  }
}

// Scenery, and the only thing on screen that says street.
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
  ent.reset();
  ent.world(W);
  ent.order([Hat, Mark, Coin, Tomato, Note, Player]);

  new Hat();
  new Mark();
  // On screen rather than off it, so frame one shows what the lane is for.
  new Note(FIRST);
  player = new Player();

  bpm = BPM0;
  combo = 0;
  resolved = 0;
  step = 0;
  steps = 0;
  strike = false;
  frozen = true;
  dying = 0;
  aiming = false;
  lastx = null;
  msg("");
}

export function update(dt) {
  frozen = hint() > 0;
  // Every note has to see the same answer, and it has to be this frame's, so
  // it is read here rather than out of entity.js's copy, which is only
  // refreshed inside ent.update().
  const { key } = ent.game;
  strike = !frozen && dying <= 0 && (key.just.b1 || key.just.up);

  bpm = BPM0 + PER_NOTE * resolved;
  ent.update(dt);

  const t = ent.game.time;
  if (!frozen && dying <= 0) {
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
  if (dying > 0 && (dying -= t) <= 0) gameOver();
}

export function render(ctx) {
  ctx.save();
  ctx.scale(SIZE / W, SIZE / W);
  ctx.fillStyle = LANE_BG;
  ctx.fillRect(0, LANE - BAND / 2, W, BAND);
  ctx.restore();
  ent.render(ctx);
}
