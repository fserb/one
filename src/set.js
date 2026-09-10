/*
 * set - a port of ~/prj/vault/games/sketch/src/SET.hx.
 *
 * The card game. Sixteen cards, four traits with three values each, and three
 * cards are a set when every trait is all the same or all different. Take one
 * and the three are replaced off an 81-card deck.
 *
 * The Haxe is the puzzle and none of the game: it deals, marks and checks, with
 * no score, no clock and no way to end. The clock is what makes a wrong guess
 * cost anything, since the board holds 560 triples and about five sets, so with
 * a free guess the game is 560 button presses rather than looking.
 *
 * The cursor follows the pointer when it moves and the arrows when it is still,
 * so there is no mode and a tap plays with one finger.
 *
 * Sixteen cards almost always hold a set, and almost always is not never, so a
 * board without one is dealt again.
 *
 * The layout is not the Haxe's: the pitch is 100 rather than 110, and the room
 * that frees up along the bottom carries the clock and the last set. Cards still
 * draw in the Haxe's own 100-unit box, scaled by `CELL / 100` on the way out.
 */

import * as ent from "./lib/entity.js";
import { gameOver, hint, score } from "./lib/one.js";

export const meta = {
  title: "set",
  desc: `
pick three cards
each trait all same or all different
`,
  bg: "#FAFAFA",
  fg: "#010101",
  scoreMax: true,
  date: "2015-05-03",
};

// C.COLORS in the Haxe. The first three are the cards, the other two the mark
// and the cursor.
const COLORS = [0xff6819, 0xc0dc61, 0x1ebed8];
const MARKED = 0xfec804;
const POINTED = 0xe284cc;
const INK = 0x010101;

const COLS = 4;
const CELLS = COLS * COLS;

// A card draws in a 100-unit box scaled to CELL, so the eight units of pitch
// left over are the gap.
const PITCH = 100;
const CELL = 92;
const MARK = CELL - 8;

const X0 = 90;
const Y0 = 75;
// The board's edges. The clock spans them and the last set is right aligned to
// them, so the three read as one column.
const LEFT = X0 - CELL / 2;
const RIGHT = X0 + PITCH * (COLS - 1) + CELL / 2;
const MID = (LEFT + RIGHT) / 2;

const CLOCK_Y = 431;
const CLOCK_H = 8;

const GRAVE = 30;
const GRAVE_PITCH = 27;
const GRAVE_X = RIGHT - GRAVE / 2 - GRAVE_PITCH * 2;
const GRAVE_Y = 460;

// The starting clock and its ceiling, so a set tops the bar up rather than
// pushing past the end of it. Ten seconds a set is the pace a player who can
// read the board holds.
const CLOCK_MAX = 45;
const SET_TIME = 10;
const MISS_TIME = 5;

// Cards not yet dealt, and cards taken. The sixteen on the board are in
// neither, so the deck refills out of the discards without repeating one.
let deck = [];
let discard = [];

let board = [];
// At most three.
let marks = [];
// The last set found, shrunk into the bottom corner.
let grave = [];

let clock = CLOCK_MAX;

// 81 cards: four traits, three values each, packed two bits apiece.
function newDeck() {
  const d = [];
  for (let count = 0; count < 3; ++count) {
    for (let type = 0; type < 3; ++type) {
      for (let color = 0; color < 3; ++color) {
        for (let fill = 0; fill < 3; ++fill) {
          d.push(count | (type << 2) | (color << 4) | (fill << 6));
        }
      }
    }
  }
  return d;
}

function pick() {
  if (deck.length === 0) {
    deck = discard;
    discard = [];
  }
  const i = Math.floor(Math.random() * deck.length);
  const c = deck[i];
  // Nothing reads the deck in order, so fill the hole from the end.
  deck[i] = deck[deck.length - 1];
  deck.pop();
  return c;
}

// Every trait all same or all different, which is exactly "the three values
// sum to a multiple of three": 3v and 0+1+2 do, two alike and one apart never.
function isSet(a, b, c) {
  for (let s = 0; s <= 6; s += 2) {
    const t = ((a >> s) & 3) + ((b >> s) & 3) + ((c >> s) & 3);
    if (t % 3 !== 0) return false;
  }
  return true;
}

function hasSet(codes) {
  for (let i = 0; i < codes.length; ++i) {
    for (let j = i + 1; j < codes.length; ++j) {
      for (let k = j + 1; k < codes.length; ++k) {
        if (isSet(codes[i], codes[j], codes[k])) return true;
      }
    }
  }
  return false;
}

function cellX(i) {
  return X0 + PITCH * (i % COLS);
}

function cellY(i) {
  return Y0 + PITCH * Math.floor(i / COLS);
}

// The cell a point is in, or null. The gap counts too, so a tap has no dead
// strip to land in.
function cellAt(x, y) {
  const col = Math.floor((x - X0 + PITCH / 2) / PITCH);
  const row = Math.floor((y - Y0 + PITCH / 2) / PITCH);
  if (col < 0 || col >= COLS || row < 0 || row >= COLS) return null;
  return col + row * COLS;
}

// The stripes of a hollow shape, a half width and a height each: ugl had no
// hatch, so a striped card is a shape with four lines inside it.
const STRIPES = [
  [[10, -6], [10, -2], [10, 2], [10, 6]],
  [[7, -6], [10, -2], [10, 2], [7, 6]],
  [[4, -6], [7, -2], [9, 2]],
];

// One symbol, centred on (x, y) in the card's own 100-unit box.
function symbol(gfx, x, y, color, fill, type) {
  const c = COLORS[color];
  gfx.fill(fill === 1 ? c : null).line(2, c);

  if (type === 0) {
    gfx.rect(x - 10, y - 10, 20, 20);
  } else if (type === 1) {
    gfx.circle(x, y, 10);
  } else {
    gfx.mt(x - 11.547, y + 6.666)
      .lt(x, y - 13.333)
      .lt(x + 11.547, y + 6.666)
      .lt(x - 11.547, y + 6.666);
  }

  if (fill !== 2) return;
  for (const [w, dy] of STRIPES[type]) {
    gfx.mt(x - w, y + dy).lt(x + w, y + dy);
  }
}

/*
 * A card, built in the constructor so it is on screen the frame it replaces
 * one. The Haxe drew in a 0..100 box pinned by gfx.size(100, 100); size() is
 * centred on the entity here, so every coordinate below is the Haxe's less 50.
 */
class Card extends ent.Entity {
  constructor(code, x, y) {
    super();
    this.code = code;
    this.pos.x = x;
    this.pos.y = y;
    this.scale = CELL / PITCH;

    const count = code & 3;
    const type = (code >> 2) & 3;
    const color = (code >> 4) & 3;
    const fill = (code >> 6) & 3;

    // The symbols sit high, so without size() the card centres on them.
    this.gfx.size(100);
    if (count === 0) {
      symbol(this.gfx, 0, 0, color, fill, type);
    } else if (count === 1) {
      symbol(this.gfx, -15, 0, color, fill, type);
      symbol(this.gfx, 15, 0, color, fill, type);
    } else {
      for (let i = 0; i < 3; ++i) {
        const a = 3 * Math.PI / 2 + i * 2 * Math.PI / 3;
        symbol(this.gfx, 18 * Math.cos(a), 18 * Math.sin(a), color, fill, type);
      }
    }
  }

  entomb(i) {
    this.scale = GRAVE / PITCH;
    this.pos.x = GRAVE_X + GRAVE_PITCH * i;
    this.pos.y = GRAVE_Y;
  }
}

class Mark extends ent.Entity {
  constructor(cell) {
    super();
    this.cell = cell;
    this.pos.x = cellX(cell);
    this.pos.y = cellY(cell);
    this.gfx.line(4, MARKED).rect(-MARK / 2, -MARK / 2, MARK, MARK);
  }
}

class Cursor extends ent.Entity {
  constructor() {
    super();
    this.selected = 4;
    // Last frame's pointer, which is how a moved one is told from a still one.
    this.px = -1;
    this.py = -1;
    this.over = null;
    this.moved = false;
    this.gfx.line(4, POINTED).rect(-CELL / 2, -CELL / 2, CELL, CELL);
    this.place();
  }

  update() {
    const { key, mouse } = ent.game;

    // The pointer takes the cursor when it moves, the arrows when it is still.
    // Neither locks the other out.
    this.moved = mouse.x !== this.px || mouse.y !== this.py;
    this.px = mouse.x;
    this.py = mouse.y;
    this.over = cellAt(mouse.x, mouse.y);
    if (this.moved && this.over !== null) this.selected = this.over;

    let x = this.selected % COLS;
    let y = Math.floor(this.selected / COLS);
    if (key.just.left) x = (x + COLS - 1) % COLS;
    if (key.just.right) x = (x + 1) % COLS;
    if (key.just.up) y = (y + COLS - 1) % COLS;
    if (key.just.down) y = (y + 1) % COLS;
    this.selected = x + y * COLS;
    this.place();
  }

  place() {
    this.pos.x = cellX(this.selected);
    this.pos.y = cellY(this.selected);
  }
}

class Clock extends ent.Entity {
  constructor() {
    super();
    this.pos.x = MID;
    this.pos.y = CLOCK_Y + CLOCK_H / 2;
  }

  update() {
    // The clock holds while meta.desc is up: here the hint is the rule, and
    // the rule is the game.
    if (hint() === 0) clock = Math.max(0, clock - ent.game.time);

    const w = RIGHT - LEFT;
    // The empty track pins the bounding box, so the bar shortens from the
    // right instead of recentring as it goes.
    this.gfx.clear()
      .fill(INK, 0.12).rect(-w / 2, -CLOCK_H / 2, w, CLOCK_H)
      .fill(INK).rect(-w / 2, -CLOCK_H / 2, w * clock / CLOCK_MAX, CLOCK_H);

    if (clock <= 0) gameOver({ score: true });
  }
}

function pop(text) {
  new ent.Text()
    .text(text)
    .color(INK)
    .size(3)
    .duration(0.7)
    .xy(MID, CLOCK_Y - 8)
    .move(0, -22);
}

function burst(card) {
  new ent.Particle()
    .color(COLORS[(card.code >> 4) & 3])
    .xy(card.pos.x, card.pos.y)
    .count(40, 15)
    .size(4, 3)
    .delay(0)
    .duration(0.5)
    .speed(60, 120);
}

// Every card back into the deck, then sixteen more until they hold a set.
function reshuffle() {
  for (const c of board) {
    if (c === null) continue;
    deck.push(c.code);
    c.remove();
  }

  for (;;) {
    const codes = [];
    for (let i = 0; i < CELLS; ++i) codes.push(pick());
    if (hasSet(codes)) {
      codes.forEach((code, i) => board[i] = new Card(code, cellX(i), cellY(i)));
      return;
    }
    deck.push(...codes);
  }
}

function take(cells) {
  score.value += 1;
  clock = Math.min(CLOCK_MAX, clock + SET_TIME);
  pop(`+${SET_TIME}s`);

  for (const c of grave) c.remove();
  grave = [];

  cells.forEach((cell, i) => {
    const card = board[cell];
    burst(card);
    discard.push(card.code);
    card.entomb(i);
    grave.push(card);
    board[cell] = new Card(pick(), cellX(cell), cellY(cell));
  });

  if (!hasSet(board.map((c) => c.code))) reshuffle();
}

function miss() {
  clock = Math.max(0, clock - MISS_TIME);
  pop(`-${MISS_TIME}s`);
  ent.shake(0.25);
}

function mark(cell) {
  const i = marks.findIndex((m) => m.cell === cell);
  if (i !== -1) {
    marks[i].remove();
    marks.splice(i, 1);
    return;
  }

  marks.push(new Mark(cell));
  if (marks.length < 3) return;

  // Board order, not click order, so the last set reads across the corner the
  // way it read across the board.
  const cells = marks.map((m) => m.cell).sort((a, b) => a - b);
  for (const m of marks) m.remove();
  marks = [];

  if (isSet(board[cells[0]].code, board[cells[1]].code, board[cells[2]].code)) {
    take(cells);
  } else {
    miss();
  }
}

export function init() {
  hint(meta.desc);
  ent.reset();
  ent.world(480);
  ent.order([Card, Mark, Cursor, Clock, ent.Particle, ent.Text]);

  deck = newDeck();
  discard = [];
  board = new Array(CELLS).fill(null);
  marks = [];
  grave = [];
  clock = CLOCK_MAX;

  reshuffle();
  new Cursor();
  new Clock();
}

export function update(dt) {
  ent.update(dt);
  if (clock <= 0) return;

  const cursor = ent.one(Cursor);
  if (cursor === null || !ent.game.key.just.b1) return;
  // A tap off the board moves the pointer and presses b1 on the same frame. It
  // asked for nothing, not for the cell the arrows left the cursor on.
  if (cursor.moved && cursor.over === null) return;
  mark(cursor.selected);
}

export function render(ctx) {
  ent.render(ctx);
}
