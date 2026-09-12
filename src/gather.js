/*
 * gather - the sketch the full Gather (fserb.com/vault/gather) grew out of.
 *
 * The cursor moves onto a box and extends a chain behind it, one box per press,
 * and the chain scores the moment it holds two or more colours in equal
 * numbers, for `colours * each * (each - 1) * (colours - 1)`.
 *
 * The scroll speed is set by where you are: it is slow while your lowest cursor
 * is in the bottom half and multiplies by up to 23 as it rises, and again by up
 * to 6 once the top of the chain passes the second line. one.js's ramp over the
 * round multiplies it too, and holes and points ride the same ramp.
 *
 * The first round opens on a scripted board that resets the score and the ramp.
 * Dying inside it replays it; finishing means it is not shown again.
 */

import * as ent from "./lib/entity.js";
import { gameOver, ramp, score, time } from "./lib/one.js";
import { coin, explosion, jump } from "./lib/fsfx/sfxr.js";
import * as sound from "./lib/sound.js";

export const meta = {
  title: "gather",
  desc: `
arrows move, space undoes
take an equal count of every colour you touch
`,
  bg: "#FFFFFF",
  fg: "#000000",
  scoreMax: true,
  date: "2014-04-15",
  dpad: true,
};

const BLACK = 0x000000;
const WHITE = 0xffffff;
const COLORS = [0xff6819, 0xc0dc61, 0x1ebed8, 0xfec804, 0xe284cc];

const COLS = 9;
const ROWS = 11;
// ORIGIN is the centre of cell (0, 0) with the board unscrolled.
const CELL = 82;
const X0 = 184;
const Y0 = 151;

// The lines the board starts from and ends on, and the depth a cursor dies at.
const HEAD = 110;
const FOOT = 1012;
const DIE = 973;

// TRAY_Y is a centre and not a top edge, so a tray of one row and a tray of
// five are centred on the same line rather than aligned to the same top edge.
const TRAY_R = 896;
const TRAY_Y = HEAD / 2;
const FLY = 0.3;
const FLYUP = 43;

const DEATH = 0.35;
const GROW = 0.3;
const HELD = 0.5;

// 11/CELL is an eighth of a row a second; the multipliers move the board.
const CRAWL = 11;
const NEAR = 512;
const NEARRATE = 9 / 150;
// Snaps on rather than ramping in: the test is against 260 and the measure runs
// from 512, so the multiplier is already 4.4 the frame it applies.
const HIGH = 260;
const HIGHRATE = 5 / 367;
// Per cell. (hard() - 1) / 15 reaches it a minute in, where the ramp is at 1.6:
// one cell in twenty-five.
const HOLE = 0.04;

// A box is 81 across: 72 of colour under a 9-thick black edge, rounded by that
// same 9, with the two eyes on it. A cursor is four corner brackets, 9 thick
// and 27 along each side.
const BOX = 36;
const EDGE = 9;
const EYE = 13.5;
const EYE_R = 9;
const PUPIL = 4.5;
const ARM = 18;

const _ = -1;

// Fed in from the end of the list, one row per shift. An empty row means "say
// the next line and carry on with the row after it", and running off the front
// ends the script. The first five rows out are the board the round starts on.
const INTRO = [
  [],
  [_, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, 2, 3, 3, _],
  [_, _, _, _, 2, 3, _, _, _],
  [_, _, _, _, 2, _, _, _, _],
  [],
  [_, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _],
  [_, _, _, _, _, _, _, _, _],
  [_, _, _, _, 1, _, _, _, _],
  [_, _, _, _, 1, _, _, _, _],
  [_, _, _, _, 0, _, _, _, _],
  [_, _, _, _, 0, _, _, _, _],
];

// Taken from the end, so the last line is the first said.
const NOTES = [
  "good luck",
  "group with same number of each color",
  "use keys to move, space to undo",
];

sound.voice("move", { ...jump(12), vol: 0.2 });
sound.voice("gather", { ...explosion(25), vol: 0.2 });
sound.voice("score", { ...coin(12), vol: 0.2 });
sound.voice("over", { ...explosion(30), vol: 0.2 });

// grid[x][y] is a Piece or null. y grows downward: row 0 is what the next shift
// pushes in, ROWS-1 what it drops.
const grid = [];
let scroll = 0;
// The second the script ended on, and 0 while it is still playing. The ramp is
// measured from there, so a first-time player does not begin a real round on a
// board that has already ramped through the tutorial.
let from = 0;
// Oldest first. The last is the head, the only one a key moves; the first
// stands on an empty cell and is what an undo leaves behind.
let chain = [];
let tray = null;
let note = null;
let dying = 0;

// Survives a round: the tutorial is once a page unless the player died in it.
let introAt = INTRO.length;
let noteAt = NOTES.length;

function cellX(x) {
  return X0 + CELL * x;
}

function cellY(y) {
  return scroll + Y0 + CELL * y;
}

// A cursor scrolls past the last row before it dies, so y is out of range for a
// frame.
function at(x, y) {
  return grid[x]?.[y] ?? null;
}

// Its pupils follow whatever `eye` is: a random point on the board, the cursor
// when the cursor is next to it, and its own centre while held.
class Piece extends ent.Entity {
  constructor(x, y, color) {
    super();
    this.px = x;
    this.py = y;
    this.color = color;
    this.targeted = false;
    this.popping = false;
    this.eye = { x: Math.random() * 1024, y: Math.random() * 1024 };
    this.pos.x = cellX(x);
    this.pos.y = cellY(y);
    this.draw();
  }

  target() {
    this.targeted = true;
    this.draw();
  }

  untarget() {
    this.targeted = false;
    this.draw();
  }

  see(x, y) {
    this.eye.x = x;
    this.eye.y = y;
    this.draw();
  }

  pop() {
    grid[this.px][this.py] = null;
    this.popping = true;
    this.targeted = false;
  }

  draw() {
    // A pupil sits PUPIL off centre at most, which is where it meets the white.
    const dx = this.eye.x - this.pos.x;
    const dy = this.eye.y - this.pos.y;
    const d = Math.hypot(dx, dy);
    const px = d === 0 ? 0 : PUPIL * dx / d;
    const py = d === 0 ? 0 : PUPIL * dy / d;
    this.gfx.clear()
      .fill(COLORS[this.color]).line(EDGE, BLACK)
      .rect(-BOX, -BOX, 2 * BOX, 2 * BOX, 2 * EDGE)
      .line(null)
      .fill(WHITE).circle(-EYE, -EYE, EYE_R).circle(EYE, -EYE, EYE_R)
      .fill(BLACK)
      .circle(-EYE + px, -EYE + py, PUPIL)
      .circle(EYE + px, -EYE + py, PUPIL);
  }

  update() {
    // Across a full board, a glance every second or so.
    if (Math.random() < 1 / (10 * ROWS * COLS)) {
      this.see(Math.random() * 1024, Math.random() * 1024);
    }

    this.pos.x = cellX(this.px);
    this.pos.y = cellY(this.py);
    if (this.pos.y > 1033) return this.remove();

    const step = ent.game.time / GROW;
    if (this.popping) {
      this.scale = Math.max(0, this.scale - step);
      this.draw();
      if (this.scale <= 0) this.remove();
      return;
    }

    if (this.targeted) {
      this.eye.x = this.pos.x;
      this.eye.y = this.pos.y;
      const s = Math.max(HELD, this.scale - step);
      if (s === this.scale) return;
      this.scale = s;
    } else {
      const s = Math.min(1, this.scale + step);
      if (s === this.scale) return;
      this.scale = s;
    }
    this.draw();
  }
}

// Red while it is the head, grey once the chain has moved past it.
class Cursor extends ent.Entity {
  constructor(x, y) {
    super();
    this.px = x;
    this.py = y;
    this.head = true;
    this.pos.x = cellX(x);
    this.pos.y = cellY(y);
    this.draw();
  }

  draw() {
    const c = this.head ? 0xff6666 : 0x666666;
    const g = this.gfx.clear().line(EDGE, c);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        g.mt(sx * BOX, sy * ARM).lt(sx * BOX, sy * BOX).lt(sx * ARM, sy * BOX);
      }
    }
  }

  update() {
    this.pos.x = cellX(this.px);
    this.pos.y = cellY(this.py);
  }
}

// One row per colour, longest first, one square per box: the whole readout the
// win condition needs, equal rows and two of them or more.
class Tray extends ent.Entity {
  constructor() {
    super();
    this.counts = null;
    this.moving = false;
    this.points = 0;
    this.pos.x = TRAY_R;
    this.pos.y = TRAY_Y;
  }

  set(counts) {
    this.counts = counts;
    const order = [0, 1, 2, 3, 4].sort((a, b) => counts[b] - counts[a]);

    this.gfx.clear();
    let row = 0;
    for (const i of order) {
      if (counts[i] === 0) continue;
      this.gfx.fill(COLORS[i]);
      for (let j = 0; j < counts[i]; ++j) this.gfx.rect(17 * j, 17 * row, 15, 15);
      row += 1;
    }

    // gfx centres on its own box, so the right edge costs half the width.
    this.pos.x = TRAY_R - (17 * Math.max(...counts) - 2) / 2;
    this.pos.y = TRAY_Y;
  }

  go() {
    this.moving = true;
    this.age = 0;
    const kinds = this.counts.filter((c) => c > 0).length;
    const each = Math.max(...this.counts);
    this.points = kinds * each * (each - 1) * (kinds - 1) * hard();
  }

  update() {
    if (!this.moving) return;
    const t = this.age / FLY;
    this.pos.y = TRAY_Y - (TRAY_Y + FLYUP) * t * t;
    this.alpha = Math.max(0, 1 - t * t);
    if (t <= 1) return;
    addScore(this.points);
    this.remove();
  }
}

// The strips an incoming row slides out from behind and a dropped one slides
// away under, plus the two lines that bound the board.
class Frame extends ent.Entity {
  constructor() {
    super();
    this.pos.x = this.pos.y = 512;
    this.gfx.fill(WHITE)
      .rect(0, 0, 1024, HEAD)
      .rect(0, FOOT, 1024, 1024 - FOOT)
      .fill(null);
    for (const [d, alpha] of [[0, 1], [2, 0.25], [4, 0.12]]) {
      this.gfx.line(2, BLACK, alpha)
        .mt(107, HEAD + d).lt(896, HEAD + d)
        .mt(107, FOOT - d).lt(896, FOOT - d);
    }
  }
}

function addScore(v) {
  score.value += v;
  ent.shake(0.25);
  sound.play("score");
  new ent.Text({
    text: `+${Math.floor(v)}`,
    x: TRAY_R,
    y: TRAY_Y,
    align: "right middle",
    size: 40,
    color: BLACK,
    vel: [0, -64],
    duration: 0.5,
  });
}

function say(m) {
  note?.remove();
  note = new ent.Text({
    text: m,
    x: 512,
    y: 960,
    size: 40,
    color: BLACK,
    duration: 5,
  });
}

// one.js's ramp over the seconds since the script ended. It climbs through the
// script as well, and `from` drops it back to 1 for the first real row.
function hard() {
  return ramp(time - from);
}

// Colour indices and holes, or null once the board has nothing left to say.
function nextRow() {
  if (introAt < 0) {
    const row = [];
    const hole = Math.min(HOLE, (hard() - 1) / 15);
    for (let x = 0; x < COLS; ++x) {
      const c = Math.floor(Math.random() * COLORS.length);
      row.push(Math.random() < hole ? _ : c);
    }
    return row;
  }

  let row = INTRO[--introAt];
  if (row.length === 0) {
    say(NOTES[--noteAt]);
    row = INTRO[--introAt];
  }
  if (row !== undefined) return row;

  // None of the script counted: it gives points a real round would not.
  from = time;
  score.value = 0;
  return null;
}

// Boxes, index and chain together, so a cursor keeps the box it was holding.
function shift() {
  for (let y = 0; y < ROWS; ++y) {
    for (let x = 0; x < COLS; ++x) {
      const p = grid[x][y];
      if (p !== null) p.py += 1;
    }
  }
  for (let y = ROWS - 1; y > 0; --y) {
    for (let x = 0; x < COLS; ++x) grid[x][y] = grid[x][y - 1];
  }

  const row = nextRow();
  for (let x = 0; x < COLS; ++x) {
    const c = row === null ? _ : row[x];
    grid[x][0] = c === _ ? null : new Piece(x, 0, c);
  }

  for (const c of chain) c.py += 1;
}

function advance(dt) {
  let low = 0;
  let high = 1024;
  for (const c of chain) {
    const y = cellY(c.py);
    low = Math.max(low, y);
    high = Math.min(high, y);
  }

  let speed = CRAWL * hard();
  if (low < NEAR) speed *= 1 + NEARRATE * (NEAR - low);
  if (high < HIGH) speed *= 1 + HIGHRATE * (NEAR - high);

  scroll += speed * dt;
  if (scroll <= 0) return;
  scroll -= CELL;
  shift();
}

function undo() {
  for (const c of chain.slice(1)) {
    at(c.px, c.py)?.untarget();
    c.remove();
  }
  chain.length = 1;
  chain[0].head = true;
  chain[0].draw();
  tray.set([0, 0, 0, 0, 0]);
}

// A gather is two colours or more, at least two of each, and every colour
// present in the same number.
function check() {
  const counts = [0, 0, 0, 0, 0];
  for (const c of chain) {
    const p = at(c.px, c.py);
    if (p !== null) counts[p.color] += 1;
  }
  tray.set(counts);

  const most = Math.max(...counts);
  if (most <= 1) return;
  if (counts.filter((c) => c > 0).length <= 1) return;
  if (counts.some((c) => c > 0 && c < most)) return;

  const head = chain.at(-1);
  for (const c of chain) {
    at(c.px, c.py)?.pop();
    if (c !== head) c.remove();
  }
  chain = [head];
  sound.play("gather");

  tray.go();
  tray = new Tray();
}

// An empty cell is a step only when the head is on one too, which keeps the
// chain unbroken and the first cursor somewhere an undo can return to.
function control() {
  const { input } = ent.game;
  if (input.just.act) undo();

  const head = chain.at(-1);
  const hx = cellX(head.px);
  const hy = cellY(head.py);
  at(head.px - 1, head.py)?.see(hx, hy);
  at(head.px + 1, head.py)?.see(hx, hy);
  at(head.px, head.py - 1)?.see(hx, hy);
  at(head.px, head.py + 1)?.see(hx, hy);

  let tx = head.px;
  let ty = head.py;
  if (input.just.up) ty -= 1;
  else if (input.just.down) ty += 1;
  else if (input.just.left) tx -= 1;
  else if (input.just.right) tx += 1;
  if (tx === head.px && ty === head.py) return;
  if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) return;

  const box = at(tx, ty);
  if (box === null) {
    if (at(head.px, head.py) === null) {
      head.px = tx;
      head.py = ty;
    }
    return;
  }
  if (box.targeted) return;

  sound.play("move");
  head.head = false;
  head.draw();
  box.target();
  chain.push(new Cursor(tx, ty));
  check();
}

function die() {
  sound.play("over");
  ent.shake(1);
  dying = DEATH;
}

export function init() {
  ent.reset([Piece, Cursor, Frame, Tray]);

  scroll = 0;
  from = 0;
  dying = 0;
  note = null;
  introAt = introAt >= 0 ? INTRO.length : -1;
  noteAt = NOTES.length;

  grid.length = 0;
  for (let x = 0; x < COLS; ++x) grid.push(new Array(ROWS).fill(null));

  new Frame();
  tray = new Tray();

  // Frame one is the game: the script's first five rows are the opening board.
  for (let y = 0; y < 5 && introAt >= 0; ++y) {
    const row = INTRO[--introAt];
    for (let x = 0; x < COLS; ++x) {
      if (row[x] === _) continue;
      grid[x][y] = new Piece(x, y, row[x]);
    }
  }
  if (introAt >= 0) say(NOTES[--noteAt]);

  chain = [new Cursor(4, 4)];
}

export function update(dt) {
  if (dying > 0) {
    dying -= dt;
    if (dying <= 0) return gameOver({ score: true });
  } else {
    advance(dt);
    if (chain.some((c) => cellY(c.py) >= DIE)) die();
    else control();
  }
  ent.update(dt);
}

export { render } from "./lib/entity.js";
