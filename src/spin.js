/*
 * spin - a port of ~/prj/vault/games/sketch/src/Ball.hx.
 *
 * A room that turns. You run and jump in it, gravity always points down the
 * screen, and every few seconds the whole room rotates a quarter or a half
 * turn under you. The floor you were standing on becomes a wall you slide
 * down, the ceiling you could not reach becomes a floor you can walk on, and
 * the orange mark you were running at is suddenly somewhere else entirely. The
 * needle in the middle is the warning: it swings the way the room is about to
 * go, holds there long enough for you to get somewhere you want to be when it
 * lands, and then the room follows it round.
 *
 * There is no ball in Ball.hx and there is nothing to do in it either. What is
 * there: a 24x24 tile room drawn by hand, a platform controller with wall
 * jumps and one-way platforms, `rotate()` on a key, and `vault.Sight` casting
 * a visibility polygon it draws as cyan triangles over a room that was already
 * fully visible. No score, no clock, no end, and the compass commented out of
 * `begin()`. So the name went to the mechanic.
 *
 * `rotate()` is the piece worth having whole, and the port keeps its timing to
 * the frame: the needle winds for 0.4 seconds, holds for 0.5, and then the
 * room turns over 0.6 with the player locked and swung round the centre with
 * it. That is 1.5 seconds of warning for a move that changes every route in
 * the room, and it is what makes the turn something to plan around rather than
 * something that happens to you.
 *
 * What changed:
 *
 * - The sight is gone. It is the same `castLOS` demo Wall.hx has, drawn the
 *   same way over a room that needs no revealing, and src/wall.js already
 *   turned that into a game. Twice would be the same game twice.
 * - The turn is on a clock rather than on a key. The Haxe fired it from
 *   `Game.key.b1_pressed` and picked the direction at random, which makes it a
 *   toy: a rotation you ask for and can undo is a free look at four rooms. On
 *   a clock it is the thing you play around, and the needle is what you play
 *   it with.
 * - Marks and a clock, which the Haxe has neither of. One mark at a time, as
 *   far from you as a handful of tries can put it, on a tile with something
 *   under it. Taking one buys FEED seconds and shortens the wait between
 *   turns, so the room turns faster the better you do. The ring round the
 *   needle is what is left.
 * - The player's horizontal was `acc.x = -vel.x/Game.time` and then plus or
 *   minus 10000, which is a velocity of 10000*dt: a walk that is a third
 *   slower on a 90Hz screen than on a 60Hz one. It is a speed here.
 * - The wall jump is a wall jump. The Haxe set `vel.x` to 500 off the wall and
 *   then cancelled it on the very next frame with the same drag, so the kick
 *   was one frame of it, about 8px, and a wall jump was a jump. The kick now
 *   holds KICKED seconds before the controls come back. There is a wall slide
 *   too, at SLIDE: falling past a wall at full speed leaves a two-frame window
 *   to take it, which is not a move, it is a lottery.
 * - A rotation moves nothing in the room's own frame, so nothing needs moving.
 *   The Haxe swung the player round the centre through the tween while the
 *   room's sprite turned under them. Drawing the room, the player and the
 *   marks in one transform and rotating that says the same thing, and then the
 *   only work at the end of a turn is the one the Haxe already did: turn the
 *   map array, and put every position where the drawing had it.
 * - `touch & 1` set `vel.y = 0`, which stops a fall dead on the frame the head
 *   clips a corner. It clamps the rise alone now.
 * - The room is 456 across rather than 480, because the shell's bar covers the
 *   top 21 and a room that turns onto itself has to be square. The 12 either
 *   side is meta.bg, which reads as the frame it is.
 *
 * The stretch on the sprite is the Haxe's: three extra rows of body while it
 * is rising faster than BIG, and nothing else in the file is animated at all.
 */

import * as ent from "./lib/entity.js";
import { gameOver, hint, score, SIZE } from "./lib/one.js";
import * as sfxr from "./lib/sfxr.js";
import * as sound from "./lib/sound.js";

export const meta = {
  title: "spin",
  desc: `
run and jump for the orange
the needle says which way the room turns
`,
  bg: "#303030",
  fg: "#FF6819",
  scoreMax: true,
  finishGood: false,
  date: "2015-10-04",
};

// The box the game thinks in, and the strip of it the shell's 44px bar covers.
const W = 480;
const TOP = 21;

// The room, which has to be square to turn onto itself: 24 tiles of 19, and
// what is left over is the margin it sits in.
const GRID = 24;
const TILE = 19;
const ROOM = GRID * TILE;
const ROOMX = (W - ROOM) / 2;
const ROOMY = TOP + (W - TOP - ROOM) / 2;
// The middle of the room, in the box's own coordinates: what a turn goes round
// and where the needle stands.
const CX = ROOMX + ROOM / 2;
const CY = ROOMY + ROOM / 2;

// The Haxe's palette. C.black is the wall, C.white the floor, C.p1 you and
// C.p2 the mark, which is the orange the Haxe declares and never draws.
const WALL = 0x606060;
const FLOOR = 0xfafafa;
const LEDGE = 0xcccccc;
const CYAN = 0x1ebed8;
const ORANGE = 0xff6819;
// The needle and the ring round it, over the floor and under everything
// standing on it.
const NEEDLE = 0x888888;
const RING = 0xff6819;
const RING_BG = 0xdcdcdc;

// Which way the touch bits face: up, right, down, left, as ugl numbered them.
const T_UP = 1;
const T_RIGHT = 2;
const T_DOWN = 4;
const T_LEFT = 8;

// Half the player's box, and how far into a tile a stop lands. Under the
// 19-unit tile on both axes, so a one-tile gap is a gap and a one-tile
// corridor is a corridor.
const HW = 7;
const HH = 8;
const EDGE = 0.01;

// Per second: gravity, the speed a held direction walks at, what a jump leaves
// the ground with, what letting go of the button clips a rise to, what a wall
// jump throws you off the wall at and how long that holds before the controls
// come back, and the fastest you slide down a wall you are against.
const GRAV = 1000;
const WALK = 166;
const JUMP = 430;
const CLIP = 150;
const KICK = 260;
const KICKED = 0.16;
const SLIDE = 190;
// Seconds after walking off a ledge that a jump still counts, and how fast the
// sprite has to be rising to stretch.
const COYOTE = 0.1;
const BIG = 150;
// How far off the pointer has to be before it is a direction and not a tap.
const DEAD = 8;

// The turn: the needle winds for this long, holds for this long, and then the
// room follows over this long, doubled for a half turn. The Haxe's numbers.
const WIND = 0.4;
const HELD = 0.5;
const TURNS = 0.6;

// Seconds between turns at the start, what each mark takes off that, and the
// shortest it gets. A turn takes 1.5 seconds of its own, 2.1 for a half one,
// and the player is locked for the last 0.6 of that, so the floor is what
// leaves a stretch to play in between two of them.
const EVERY = 7;
const EVERY_OFF = 0.3;
const EVERY_MIN = 4;

// The clock: what the round opens with, the most it will hold, what one mark
// puts back, and what each mark adds to the rate it runs down at. The rate is
// the whole of the late game: the turns stop getting closer together at
// EVERY_MIN and a mark keeps buying its FEED, so without it a player who can
// hold one mark every four seconds never loses. At twenty marks the ring
// empties twice as fast and FEED is three seconds, not six.
const TIME = 25;
const TIME_MAX = 30;
const FEED = 6;
const DRAIN_UP = 0.05;
// The ring the clock is drawn as, and the needle inside it.
const RING_R = 27;
const RING_W = 4;
const ARROW = 13;

// No mark lands nearer the player than this.
const MARK_GAP = 150;
const MARK_R = 7;
// Tiles the flood lets a jump climb before it has to land on something. A jump
// tops out at JUMP*JUMP/(2*GRAV), which is 92 of the 19-unit tiles, so four is
// the whole of it and a little under.
const CLIMB = 4;
// How often the mark is checked for still being reachable, and how long it can
// go unreachable before it moves.
const LOOK = 0.4;
const LOST = 2;

// The Haxe's player, which is Wall.hx's player facing the other way. The first
// two rows are the ones that mirror; `big` splices three more rows of body in
// above the feet.
const HEAD_L = "00000..000000.";
const HEAD_R = "..00000.000000";
const BODY = ".0.0.0..00000..00000...000..";
const STRETCH = "..000....000....000..";
const FEET = ".00000.";

// The room. 0 is a wall, 1 a one-way platform you can jump up through and
// stand on, and anything else is air. Straight out of the Haxe.
const MAP = `
000000000000000000000000
0......................0
0......................0
0......................0
000.................0000
0......................0
0........0000...1......0
0......................0
0......................0
0.....1.............0000
0......................0
0..............1.......0
0......................0
0....0.0.0.............0
0......................0
0.........0000.........0
0......................0
00.....................0
0..............11111...0
0......................0
0........000...........0
0.....000.........0....0
0.................0....0
000000000000000000000000
`;

// ugl's Sound.vol(v) set masterVolume to 2v, and sfxr squares that.
voice("jump", sfxr.jump(2801), 0.09);
voice("mark", sfxr.coin(2833), 0.13);
voice("wind", sfxr.blip(2851), 0.05);
voice("turn", rumble(), 0.2);

function voice(name, params, vol) {
  params.masterVolume = 2 * vol;
  sound.put(name, sfxr.render(params), sfxr.SAMPLE_RATE);
}

// The room going over: a sine sliding down under a slow noise, which is the
// nearest sfxr's seven generators get to something heavy moving.
function rumble() {
  const p = sfxr.params();
  p.waveType = 2;
  p.startFrequency = 0.2;
  p.minFrequency = 0.05;
  p.slide = -0.12;
  p.attackTime = 0.05;
  p.sustainTime = 0.25;
  p.decayTime = 0.35;
  p.vibratoDepth = 0.25;
  p.vibratoSpeed = 0.35;
  return p;
}

// 1 wall, 2 platform, 0 air. Rewritten in place by a turn.
const map = new Uint8Array(GRID * GRID);
const spun = new Uint8Array(GRID * GRID);
// Tiles the player can get to from where they are, and the working room the
// flood that fills it needs.
const reach = new Uint8Array(GRID * GRID);
const seen = new Uint8Array(GRID * GRID * (CLIMB + 1));
const queue = [];

let player = null;
// Seconds left, seconds until the next turn is called for, and seconds
// counted off since the last one landed.
let clock = 0;
let every = EVERY;
let waited = 0;
// The turn itself: which phase it is in, how far into that phase, which way it
// is going, how far the room is drawn round and how far the needle is.
let phase = 0;
let since = 0;
let dir = 1;
let turned = 0;
let needle = 0;
// Nothing the player does counts while the room is going over.
let locked = false;
// Seconds since the mark was last checked for being reachable, and seconds it
// has been out of reach for.
let looked = 0;
let lost = 0;

const IDLE = 0;
const WINDING = 1;
const HOLDING = 2;
const TURNING = 3;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const css = (c) => `#${c.toString(16).padStart(6, "0")}`;
// The tile a point in the box falls in, and the box coordinate a tile edge is.
const tx = (x) => Math.floor((x - ROOMX) / TILE);
const ty = (y) => Math.floor((y - ROOMY) / TILE);
const ex = (i) => ROOMX + i * TILE;
const ey = (j) => ROOMY + j * TILE;
// The Haxe's cubicIn, which both halves of a turn are eased on.
const ease = (z) => z * z * z;

function load() {
  map.fill(0);
  let i = 0;
  for (const ch of MAP) {
    if (ch === "\n" || ch === " ") continue;
    if (ch === "0") map[i] = 1;
    else if (ch === "1") map[i] = 2;
    i += 1;
  }
}

/*
 * A quarter turn clockwise, which is the Haxe's `oldmap[y][width-x-1]` in one
 * array. The room is square, so it lands on itself.
 */
function spinMap() {
  for (let y = 0; y < GRID; ++y) {
    for (let x = 0; x < GRID; ++x) {
      spun[y * GRID + x] = map[(GRID - 1 - x) * GRID + y];
    }
  }
  map.set(spun);
}

// The same quarter turn on a point in the box, so a thing standing in the room
// is standing in the same place in it afterwards.
function spinPoint(p) {
  const x = p.x - ROOMX;
  const y = p.y - ROOMY;
  p.x = ROOMX + ROOM - y;
  p.y = ROOMY + x;
}

/*
 * Is the tile solid to a box whose underside is at `bot`? A platform is solid
 * from above alone, which is the Haxe's `block = (bot <= y*tilesize)` on every
 * type 2 tile once a frame, read here off the position the move started from
 * so nothing pops up through one it was standing on.
 */
function blocked(i, j, bot) {
  if (i < 0 || j < 0 || i >= GRID || j >= GRID) return true;
  const t = map[j * GRID + i];
  if (t === 1) return true;
  if (t !== 2) return false;
  return bot <= ey(j);
}

// Nothing solid under the box at (x, y).
function open(x, y, bot) {
  const i0 = tx(x - HW);
  const i1 = tx(x + HW - EDGE);
  const j0 = ty(y - HH);
  const j1 = ty(y + HH - EDGE);
  for (let j = j0; j <= j1; ++j) {
    for (let i = i0; i <= i1; ++i) {
      if (blocked(i, j, bot)) return false;
    }
  }
  return true;
}

/*
 * Move the box, each axis on its own so a diagonal into a wall still slides
 * along it, and in steps no longer than a tile so nothing crosses one at
 * speed. A step that lands in a wall puts the box against the face of the tile
 * it entered instead.
 */
function move(p, dx, dy) {
  const bot = p.y + HH;
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / TILE));
  for (let s = 0; s < n; ++s) {
    axis(p, dx / n, 0, bot);
    axis(p, 0, dy / n, bot);
  }
}

function axis(p, dx, dy, bot) {
  const x = p.x + dx;
  const y = p.y + dy;
  if (open(x, y, bot)) {
    p.x = x;
    p.y = y;
    return;
  }
  if (dx > 0) p.x = ex(tx(x + HW)) - HW - EDGE;
  else if (dx < 0) p.x = ex(tx(x - HW) + 1) + HW + EDGE;
  if (dy > 0) p.y = ey(ty(y + HH)) - HH - EDGE;
  else if (dy < 0) p.y = ey(ty(y - HH) + 1) + HH + EDGE;
}

// What the box is up against, one tile out on each of the four sides. Out of
// the room counts as solid, the same way the Haxe counted it.
function touching(p) {
  const bot = p.y + HH;
  const i0 = tx(p.x - HW);
  const i1 = tx(p.x + HW - EDGE);
  const j0 = ty(p.y - HH);
  const j1 = ty(p.y + HH - EDGE);
  const up = ty(p.y - HH - 1);
  const down = ty(p.y + HH + 1);
  const left = tx(p.x - HW - 1);
  const right = tx(p.x + HW + 1);

  let t = 0;
  for (let i = i0; i <= i1; ++i) {
    if (blocked(i, up, bot)) t |= T_UP;
    if (blocked(i, down, bot)) t |= T_DOWN;
  }
  for (let j = j0; j <= j1; ++j) {
    if (blocked(right, j, bot)) t |= T_RIGHT;
    if (blocked(left, j, bot)) t |= T_LEFT;
  }
  return t;
}

class Player extends ent.Entity {
  constructor(i, j) {
    super();
    this.pos.x = ex(i) + TILE / 2;
    this.pos.y = ey(j) + TILE / 2;
    this.face = -1;
    this.big = false;
    // Where the box was before this frame's step, which is what postUpdate
    // resolves the step from.
    this.was = { x: this.pos.x, y: this.pos.y };
    this.hitBox(2 * HW, 2 * HH);
    // Seconds a wall jump still owns the controls, and seconds since the last
    // ground under the feet.
    this.kicked = 0;
    this.coyote = 0;
    this.touch = 0;
    this.paint();
  }

  paint() {
    this.art.size(3, 7, this.big ? 10 : 7).obj(
      [CYAN],
      (this.face < 0 ? HEAD_L : HEAD_R) + BODY +
        (this.big ? STRETCH : "") + FEET,
    );
  }

  update() {
    this.was.x = this.pos.x;
    this.was.y = this.pos.y;
    if (locked) {
      this.vel.x = this.vel.y = 0;
      return;
    }
    const t = ent.game.time;
    const { key, mouse } = ent.game;
    const held = key.up || key.b1;
    const jump = key.just.up || key.just.b1;
    const touch = this.touch;

    // A head against a ceiling stops a rise, and nothing else.
    if (touch & T_UP) this.vel.y = Math.max(0, this.vel.y);

    let kicked = false;
    if (touch & T_DOWN) {
      this.vel.y = 0;
      this.coyote = COYOTE;
    } else {
      this.accelerate(0, GRAV);
      // Against exactly one wall and nothing else: the jump goes off it.
      if (touch === T_RIGHT || touch === T_LEFT) {
        this.vel.y = Math.min(this.vel.y, SLIDE);
        if (jump) {
          this.vel.y = -JUMP;
          this.vel.x = touch === T_RIGHT ? -KICK : KICK;
          this.kicked = KICKED;
          this.face = touch === T_RIGHT ? -1 : 1;
          this.coyote = 0;
          kicked = true;
          sound.play("jump");
        }
      } else if (!held) {
        // Let go on the way up and the rise is cut short.
        this.vel.y = Math.max(this.vel.y, -CLIP);
      }
    }

    this.coyote = Math.max(0, this.coyote - t);
    if (jump && !kicked && (touch & T_DOWN || this.coyote > 0)) {
      this.vel.y = -JUMP;
      this.coyote = 0;
      sound.play("jump");
    }

    let mx = 0;
    if (key.left) mx -= 1;
    if (key.right) mx += 1;
    // The pointer is a side to run to rather than a place to stand: a
    // platformer needs the run held, and a tap on top of you is a jump alone.
    if (mx === 0 && mouse.press) {
      const d = mouse.x - this.pos.x;
      if (Math.abs(d) > DEAD) mx = Math.sign(d);
    }
    if (mx !== 0) this.face = mx;

    this.kicked = Math.max(0, this.kicked - t);
    if (this.kicked <= 0) this.vel.x = mx * WALK;

    const big = this.vel.y < -BIG;
    if (big !== this.big) {
      this.big = big;
      this.paint();
    }
  }

  // entity.js integrates the step with no idea there are walls, so this puts
  // the box back where it started and walks it there through them instead.
  // That is the Haxe's `pos = grid.update(this, pos)`, and it is in postUpdate
  // for the same reason: it is the frame's own move being resolved.
  postUpdate() {
    if (locked) return;
    const dx = this.pos.x - this.was.x;
    const dy = this.pos.y - this.was.y;
    this.pos.x = this.was.x;
    this.pos.y = this.was.y;
    move(this.pos, dx, dy);
    this.touch = touching(this.pos);
  }
}

class Mark extends ent.Entity {
  constructor(i, j) {
    super();
    this.pos.x = ex(i) + TILE / 2;
    this.pos.y = ey(j) + TILE / 2;
    this.phase = 2 * Math.PI * Math.random();
    this.art.size(3, 5, 5).color(ORANGE).circle(2, 2, 2);
    this.hitCircle(MARK_R);
  }

  update() {
    this.scale = 1 + 0.16 * Math.sin(5 * ent.game.totalTime + this.phase);
    if (locked) return;
    if (!this.hit(player)) return;

    score.value += 1;
    clock = Math.min(TIME_MAX, clock + FEED);
    every = Math.max(EVERY_MIN, every - EVERY_OFF);
    sound.play("mark");
    new ent.Particle()
      .xy(this.pos.x, this.pos.y)
      .color(ORANGE)
      .count(20)
      .size(2)
      .speed(90, 50)
      .duration(0.35, 0.2);
    this.remove();
    addMark();
  }
}

// Something to stand on, which a platform is and the outside of the room is.
function ground(i, j) {
  if (i < 0 || j < 0 || i >= GRID || j >= GRID) return true;
  return map[j * GRID + i] !== 0;
}

/*
 * Where the player can get to from tile (i0, j0), which is not the same
 * question as which tiles are joined up: gravity only goes one way. A state is
 * a tile and how far it has climbed since it last had something under it.
 * Sideways is free, down is free and spends the whole climb, and up costs one
 * of CLIMB and is only paid back by landing on something.
 *
 * It reads a jump as further than it is, since it lets the climb bend sideways
 * as far as it likes, which nothing in the air can do. In a room with a floor
 * under everything that hardly changes the answer: a tile it says you can
 * reach by flying at height, you reach by walking under it and jumping.
 */
function flood(i0, j0) {
  reach.fill(0);
  seen.fill(0);
  queue.length = 0;
  // Seeded as if it had just fallen: a player in the air has to land on
  // something before it counts as climbing again, so the answer is the same
  // one frame before a jump and one frame after it.
  step(i0, j0, CLIMB);

  for (let h = 0; h < queue.length; h += 2) {
    const at = queue[h];
    const climbed = queue[h + 1];
    const i = at % GRID;
    const j = (at - i) / GRID;
    reach[at] = 1;

    const r = ground(i, j + 1) ? 0 : climbed;
    step(i - 1, j, r);
    step(i + 1, j, r);
    // Once it is falling there is no way back up until it lands.
    step(i, j + 1, CLIMB);
    if (r < CLIMB) step(i, j - 1, r + 1);
  }
}

function step(i, j, climbed) {
  if (i < 0 || j < 0 || i >= GRID || j >= GRID) return;
  // A platform is not in the way: it is jumped up through and stood on.
  if (map[j * GRID + i] === 1) return;
  const at = j * GRID + i;
  const k = at * (CLIMB + 1) + climbed;
  if (seen[k]) return;
  seen[k] = 1;
  queue.push(at, climbed);
}

/*
 * A tile with air in it and something under it that the player can actually
 * get to, as far off as a handful of tries can find. Taking the best of a
 * sample rather than the first that clears the gap means a turn that has left
 * the room tight still gets its mark, just a nearer one.
 */
function addMark() {
  flood(tx(player.pos.x), ty(player.pos.y));
  const spots = [];
  for (let j = 1; j < GRID - 1; ++j) {
    for (let i = 1; i < GRID - 1; ++i) {
      const at = j * GRID + i;
      if (map[at] !== 0 || !reach[at]) continue;
      if (map[(j + 1) * GRID + i] === 0) continue;
      spots.push(at);
    }
  }
  if (spots.length === 0) return;

  let at = spots[0];
  let best = -1;
  for (let n = 0; n < 24; ++n) {
    const s = spots[Math.floor(spots.length * Math.random())];
    const d = Math.hypot(
      ex(s % GRID) + TILE / 2 - player.pos.x,
      ey(Math.floor(s / GRID)) + TILE / 2 - player.pos.y,
    );
    if (d > best) {
      best = d;
      at = s;
    }
    if (d >= MARK_GAP) break;
  }
  new Mark(at % GRID, Math.floor(at / GRID));
}

// The turn, in four phases: the needle winds the way the room is about to go,
// holds there, the room follows it round, and then the map and everything
// standing in it are put where the drawing already had them.
function turnClock(t) {
  if (phase === IDLE) {
    waited += t;
    if (waited < every) return;
    phase = WINDING;
    since = 0;
    dir = [1, -1, 2][Math.floor(3 * Math.random())];
    sound.play("wind");
    return;
  }

  since += t;
  const span = Math.PI / 2 * dir;
  if (phase === WINDING) {
    needle = span * ease(Math.min(1, since / WIND));
    if (since < WIND) return;
    phase = HOLDING;
    since = 0;
    return;
  }
  if (phase === HOLDING) {
    if (since < HELD) return;
    phase = TURNING;
    since = 0;
    locked = true;
    sound.play("turn");
    return;
  }

  const run = TURNS * Math.abs(dir);
  const z = ease(Math.min(1, since / run));
  turned = span * z;
  needle = span * (1 - z);
  if (since < run) return;

  for (let n = ((dir % 4) + 4) % 4; n > 0; --n) {
    spinMap();
    spinPoint(player.pos);
    for (const m of ent.get(Mark)) spinPoint(m.pos);
  }
  turned = 0;
  needle = 0;
  locked = false;
  phase = IDLE;
  waited = 0;
  // What the box is up against is read at the end of a step, and the last
  // step was before the room went over.
  player.touch = touching(player.pos);

  // A turn changes every route in the room, so it can leave the mark
  // somewhere there is now no way to. That one moves at once.
  moveStray();
}

/*
 * A mark with no route to it is not a mark. A turn is one way to end up with
 * one and walking into a part of the room the flood cannot climb out of
 * toward it is the other, so the same test runs on a slow clock as well.
 * Waiting three more turns for the room to come back round is not a round.
 */
function checkMark(t) {
  looked += t;
  if (looked < LOOK) return;
  looked = 0;
  if (stray() === null) {
    lost = 0;
    return;
  }
  lost += LOOK;
  if (lost < LOST) return;
  moveStray();
}

function stray() {
  const m = ent.one(Mark);
  if (m === null) return null;
  flood(tx(player.pos.x), ty(player.pos.y));
  return reach[ty(m.pos.y) * GRID + tx(m.pos.x)] ? null : m;
}

function moveStray() {
  lost = 0;
  const m = stray();
  if (m === null) return;
  m.remove();
  addMark();
}

export function init() {
  ent.reset();
  ent.world(W);
  ent.order([Mark, Player]);

  load();
  player = new Player(2, GRID - 2);
  clock = TIME;
  every = EVERY;
  waited = 0;
  phase = IDLE;
  since = 0;
  dir = 1;
  turned = 0;
  needle = 0;
  locked = false;
  looked = 0;
  lost = 0;
  addMark();
}

export function update(dt) {
  ent.update(dt);
  const t = ent.game.time;

  // The turn and the clock both hold while the hint is up, the same way up's
  // board does: a turn that lands on a player who is still reading is not one
  // they had.
  if (hint() > 0) return;

  turnClock(t);
  checkMark(t);
  clock -= t * (1 + DRAIN_UP * score.value);
  if (clock > 0) return;
  clock = 0;
  gameOver();
}

export function render(ctx) {
  const k = SIZE / W;

  ctx.save();
  if (turned !== 0) {
    ctx.translate(CX * k, CY * k);
    ctx.rotate(turned);
    ctx.translate(-CX * k, -CY * k);
  }

  ctx.save();
  ctx.scale(k, k);
  drawRoom(ctx);
  ctx.restore();
  ctx.restore();

  // The needle and its ring stand still while the room goes over, which is the
  // whole of what they are for, so they are drawn outside the turn, and under
  // everything that is standing in the room.
  ctx.save();
  ctx.scale(k, k);
  drawNeedle(ctx);
  ctx.restore();

  ctx.save();
  if (turned !== 0) {
    ctx.translate(CX * k, CY * k);
    ctx.rotate(turned);
    ctx.translate(-CX * k, -CY * k);
  }
  ent.render(ctx);
  ctx.restore();
}

function drawRoom(ctx) {
  ctx.fillStyle = css(FLOOR);
  ctx.fillRect(ROOMX, ROOMY, ROOM, ROOM);

  for (let j = 0; j < GRID; ++j) {
    for (let i = 0; i < GRID; ++i) {
      const t = map[j * GRID + i];
      if (t === 0) continue;
      // Runs, so a wall 20 tiles long is one fill.
      let n = 1;
      while (i + n < GRID && map[j * GRID + i + n] === t) n += 1;
      ctx.fillStyle = css(t === 1 ? WALL : LEDGE);
      ctx.fillRect(ex(i), ey(j), n * TILE, TILE);
      i += n - 1;
    }
  }
}

function drawNeedle(ctx) {
  // The ring is the clock: a full circle is TIME_MAX, and it runs out
  // anticlockwise from straight up.
  ctx.lineWidth = RING_W;
  ctx.strokeStyle = css(RING_BG);
  ctx.beginPath();
  ctx.arc(CX, CY, RING_R, 0, 2 * Math.PI);
  ctx.stroke();

  ctx.strokeStyle = css(RING);
  ctx.beginPath();
  ctx.arc(
    CX,
    CY,
    RING_R,
    -Math.PI / 2,
    -Math.PI / 2 + 2 * Math.PI * clamp(clock / TIME_MAX, 0, 1),
  );
  ctx.stroke();

  ctx.save();
  ctx.translate(CX, CY);
  ctx.rotate(needle);
  ctx.lineWidth = 2;
  ctx.strokeStyle = css(NEEDLE);
  ctx.beginPath();
  ctx.moveTo(0, ARROW / 2);
  ctx.lineTo(0, -ARROW / 2);
  ctx.moveTo(-ARROW / 3, -ARROW / 6);
  ctx.lineTo(0, -ARROW / 2);
  ctx.lineTo(ARROW / 3, -ARROW / 6);
  ctx.stroke();
  ctx.restore();
}
