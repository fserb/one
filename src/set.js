/*
 * set.
 *
 * The card game. Sixteen cards, four traits with three values each, and three
 * cards are a set when every trait is all the same or all different.
 *
 * The timer is what makes a wrong guess cost anything: the board holds 560
 * triples and about five sets, so with no penalty the game is 560 button
 * presses rather than looking.
 *
 * The cursor follows the pointer when it moves and the arrows when it is still,
 * so there is no mode and a tap plays with one finger.
 *
 * Sixteen cards almost always hold a set, and almost always is not never, so a
 * board without one is dealt again.
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

// The first three are the cards, the other two the mark and the cursor.
const COLORS = [0xff6819, 0xc0dc61, 0x1ebed8];
const MARKED = 0xfec804;
const POINTED = 0xe284cc;
const INK = 0x010101;

const COLS = 4;
const CELLS = COLS * COLS;

// A card draws in a 100-unit box scaled to CELL, so the eighteen units of pitch
// left over are the gap.
const PITCH = 216;
const CELL = 198;
const MARK = CELL - 17;

// 188 leaves the same margin each side, so MID lands on 512.
const X0 = 188;
const Y0 = 160;
// The clock spans these and the last set is right aligned to them, so the three
// line up as one column.
const LEFT = X0 - CELL / 2;
const RIGHT = X0 + PITCH * (COLS - 1) + CELL / 2;
const MID = (LEFT + RIGHT) / 2;

const CLOCK_Y = 920;
const CLOCK_H = 17;

const GRAVE = 64;
const GRAVE_PITCH = 58;
const GRAVE_X = RIGHT - GRAVE / 2 - GRAVE_PITCH * 2;
const GRAVE_Y = 981;

// One maximum, so a set refills the bar rather than extending past its end.
// Ten seconds a set is the pace a player who can read the board holds.
const CLOCK_MAX = 45;
const SET_TIME = 10;
const MISS_TIME = 5;

// The sixteen on the board are in neither, so the deck refills out of the
// discards without repeating one.
let deck = [];
let discard = [];

let board = [];
let marks = []; // at most three
let grave = []; // the last set found, shrunk into the bottom corner

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

// Every trait all same or all different is exactly "the three values sum to a
// multiple of three": 3v and 0+1+2 do, two alike and one apart never.
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

// The gap counts too, so a tap has no dead strip to land in.
function cellAt(x, y) {
  const col = Math.floor((x - X0 + PITCH / 2) / PITCH);
  const row = Math.floor((y - Y0 + PITCH / 2) / PITCH);
  if (col < 0 || col >= COLS || row < 0 || row >= COLS) return null;
  return col + row * COLS;
}

// A half width and a height each: there is no hatch, so a striped card is a
// shape with four lines inside it.
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

// Built in the constructor so it is on screen the frame it replaces one.
// gfx.size(100) fixes the box, so every coordinate below runs -50..50.
class Card extends ent.Entity {
  constructor(code, x, y) {
    super();
    this.code = code;
    this.pos.x = x;
    this.pos.y = y;
    this.scale = CELL / 100;

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
    this.scale = GRAVE / 100;
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
    this.gfx.line(9, MARKED).rect(-MARK / 2, -MARK / 2, MARK, MARK);
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
    this.gfx.line(9, POINTED).rect(-CELL / 2, -CELL / 2, CELL, CELL);
    this.place();
  }

  update() {
    const { input } = ent.game;

    // The pointer takes the cursor when it moves, the arrows when it is still.
    this.moved = input.x !== this.px || input.y !== this.py;
    this.px = input.x;
    this.py = input.y;
    this.over = cellAt(input.x, input.y);
    if (this.moved && this.over !== null) this.selected = this.over;

    let x = this.selected % COLS;
    let y = Math.floor(this.selected / COLS);
    if (input.just.left) x = (x + COLS - 1) % COLS;
    if (input.just.right) x = (x + 1) % COLS;
    if (input.just.up) y = (y + COLS - 1) % COLS;
    if (input.just.down) y = (y + 1) % COLS;
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
    // The timer holds while the hint is up: here the hint is the rule.
    if (hint() === 0) clock = Math.max(0, clock - ent.game.time);

    const w = RIGHT - LEFT;
    // The empty track fixes the bounding box, so the bar shortens from the right
    // instead of recentring as it goes.
    this.gfx.clear()
      .fill(INK, 0.12).rect(-w / 2, -CLOCK_H / 2, w, CLOCK_H)
      .fill(INK).rect(-w / 2, -CLOCK_H / 2, w * clock / CLOCK_MAX, CLOCK_H);

    if (clock <= 0) gameOver({ score: true });
  }
}

function pop(text) {
  new ent.Text({
    text,
    x: MID,
    y: CLOCK_Y - 17,
    size: 60,
    color: INK,
    vel: [0, -47],
    duration: 0.7,
  });
}

function burst(card) {
  new ent.Particle({
    x: card.pos.x,
    y: card.pos.y,
    color: COLORS[(card.code >> 4) & 3],
    count: [40, 15],
    size: [9, 6],
    speed: [128, 256],
    duration: 0.5,
  });
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

  // Board order and not click order, so the last set is laid out across the
  // corner the way it was across the board.
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
  ent.reset([Card, Mark, Cursor, Clock, ent.Particle]);

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
  if (cursor === null || !ent.game.input.just.act) return;
  // A tap off the board moves the pointer and acts on the same frame. It asked
  // for nothing, not for the cell the arrows left the cursor on.
  if (cursor.moved && cursor.over === null) return;
  mark(cursor.selected);
}

export { render } from "./lib/entity.js";
