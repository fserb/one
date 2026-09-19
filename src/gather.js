// gather - the sketch the full Gather (fserb.com/vault/gather) grew out of.

import * as ent from "./lib/entity.js";
import color from "./alma/src/color.js";
import { shake } from "./lib/camera.js";
import { gameOver, ramp, score, time } from "./lib/one.js";
import * as play from "./lib/sounds.js";

export { render } from "./lib/entity.js";

export const meta = {
  title: "gather",
  bg: "#FFFFFF",
  fg: "#000000",
  scoreMax: true,
  date: "2014-04-15",
  release: true,
  dpad: true,
};

const BLACK = 0x000000;
const WHITE = 0xffffff;

const PALETTE = ["#ff6819", "#c0dc61", "#1ebed8", "#fec804", "#e284cc"];
const COLORS = PALETTE.map(ent.hex);
const DARK = PALETTE.map((c) =>
  ent.hex(color(c).mix(color("#000000"), 0.66, "oklab").hex)
);

const COLS = 9;
const ROWS = 11;
const CELL = 82;

// The lines the board starts from and ends on.
const HEAD = 110;
const FOOT = 1012;

// The tray builds rightward from the left board line; TRAY_Y is a centre.
const TRAY_L = 107;
const TRAY_Y = HEAD / 2;
const SCORE_X = 512;

const NEAR = 512;

// BOX, EYE_R and PUPIL are half-sides. ARM is where a cursor's bracket starts.
const BOX = 32;
const EDGE = 9;
const EYE = 13.5;
const EYE_R = 9;
const PUPIL = 4.5;
const ARM = 14;

const _ = -1;

// Fed in from the end, one row per shift. An empty row says the next line and
// carries on with the row after; running off the front ends the script.
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

// grid[x][y] is a Piece or null; row 0 is what the next shift pushes in.
const grid = [];
let scroll = 0;
// The second the script ended on, and 0 while it is still playing.
let from = 0;
// Oldest first; the last is the head, the only one a key moves.
let chain = [];
let tray = null;
let total = null;
let note = null;
let dying = false;

// Survives a round: the tutorial is once a page unless the player died in it.
let introAt = INTRO.length;
let noteAt = NOTES.length;

function cellX(x) {
  return 184 + CELL * x; // 184, 151 is the centre of cell (0, 0) unscrolled
}

function cellY(y) {
  return scroll + 151 + CELL * y;
}

// A cursor scrolls past the last row before it dies, so y goes out of range.
function at(x, y) {
  return grid[x]?.[y] ?? null;
}

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
      .fill(COLORS[this.color]).line(EDGE, DARK[this.color])
      .rect(-BOX, -BOX, 2 * BOX, 2 * BOX)
      .line(null)
      .fill(WHITE)
      .rect(-EYE - EYE_R, -EYE - EYE_R, 2 * EYE_R, 2 * EYE_R)
      .rect(EYE - EYE_R, -EYE - EYE_R, 2 * EYE_R, 2 * EYE_R)
      .fill(BLACK)
      .rect(-EYE + px - PUPIL, -EYE + py - PUPIL, 2 * PUPIL, 2 * PUPIL)
      .rect(EYE + px - PUPIL, -EYE + py - PUPIL, 2 * PUPIL, 2 * PUPIL);
  }

  update() {
    // Across a full board, a glance every second or so.
    if (Math.random() < 1 / (10 * ROWS * COLS)) {
      this.see(Math.random() * 1024, Math.random() * 1024);
    }

    this.pos.x = cellX(this.px);
    this.pos.y = cellY(this.py);
    // Gone once its top edge is under the foot strip, not once its centre is.
    if (this.pos.y - BOX - EDGE / 2 > FOOT) return this.remove();

    const step = ent.game.time / 0.3;
    if (this.popping) {
      this.scale = Math.max(0, this.scale - step);
      this.draw();
      if (this.scale <= 0) this.remove();
      return;
    }

    if (this.targeted) {
      this.eye.x = this.pos.x;
      this.eye.y = this.pos.y;
      const s = Math.max(0.5, this.scale - step);
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

class Tray extends ent.Entity {
  constructor() {
    super();
    this.counts = null;
    this.moving = false;
    this.points = 0;
    this.from = TRAY_L;
    this.pos.x = TRAY_L;
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

    // gfx centres on its own box, so the left edge costs half the width.
    this.from = TRAY_L + (17 * Math.max(...counts) - 2) / 2;
    this.pos.x = this.from;
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
    const t = this.age / 0.3;
    this.pos.x = this.from + (SCORE_X - TRAY_L) * t * t;
    this.alpha = Math.max(0, 1 - t * t);
    if (t <= 1) return;
    addScore(this.points);
    this.remove();
  }
}

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

// `half` is measured as it draws: how far its right edge is from the centre,
// which is where the +N goes.
class Total extends ent.Text {
  constructor() {
    super({ text: "0", x: SCORE_X, y: TRAY_Y, size: 60, color: BLACK });
    this.half = 0;
  }

  update() {
    this.text = String(Math.floor(score.value));
  }

  render(ctx) {
    this.half = ctx.mtext(this.text, this.size).width / 2;
    super.render(ctx);
  }
}

function addScore(v) {
  shake(0.25);
  play.coin();
  ent.addScore(v, SCORE_X + 11 + total.half, TRAY_Y, {
    size: 30,
    color: 0x666666,
    align: "left middle",
    vel: [85, 0],
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

// Seconds since the script ended: `from` drops the ramp back to 1.
function hard() {
  return ramp(time - from);
}

// Colour indices and holes, or null once the script has run out.
function nextRow() {
  if (introAt < 0) {
    const row = [];
    // Per cell, reached a minute in: one cell in twenty-five.
    const hole = Math.min(0.04, (hard() - 1) / 15);
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

  // 11 a second is an eighth of a row; the multipliers move the board.
  let speed = 11 * hard();
  if (low < NEAR) speed *= 1 + 9 / 150 * (NEAR - low);
  if (high < 260) speed *= 1 + 5 / 367 * (NEAR - high);

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
  play.explode();

  tray.go();
  tray = new Tray();
}

// An empty cell is a step only when the head is on one too, which keeps the
// chain unbroken.
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

  play.jump();
  head.head = false;
  head.draw();
  box.target();
  chain.push(new Cursor(tx, ty));
  check();
}

function die() {
  play.lose();
  shake(1);
  dying = true;
  ent.after(0.35, () => gameOver({ score: true }));
}

export function init() {
  ent.reset([Piece, Cursor, Frame, Tray]);

  scroll = 0;
  from = 0;
  dying = false;
  note = null;
  introAt = introAt >= 0 ? INTRO.length : -1;
  noteAt = NOTES.length;

  grid.length = 0;
  for (let x = 0; x < COLS; ++x) grid.push(new Array(ROWS).fill(null));

  new Frame();
  tray = new Tray();
  total = new Total();

  // The script's first five rows are the opening board.
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
  if (!dying) {
    advance(dt);
    if (chain.some((c) => cellY(c.py) >= 973)) die();
    else control();
  }
  ent.update(dt);
}
