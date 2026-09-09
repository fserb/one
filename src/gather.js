/*
 * gather - a port of ~/prj/vault/games/sketch/src/Gather.hx, the sketch the
 * full Gather (fserb.com/vault/gather) grew out of.
 *
 * A board of five-colour boxes slides down at you. The cursor walks onto a box
 * and drags a chain behind it, one box per press, and the chain cashes in the
 * moment it holds two or more colours in equal numbers: two and two, three and
 * three, two and two and two. Longer and wider pays much more, because the
 * score is `colours * each * (each - 1) * (colours - 1)`.
 *
 * The clock is where you stand. The scroll runs at a crawl while your lowest
 * cursor sits in the bottom half of the board and multiplies by up to 23 as it
 * climbs, and again by up to 6 once the top of the chain passes the second
 * line. So reaching for a box costs speed, and the board shoves you back down
 * for it. The bottom of the board is death.
 *
 * The first round opens on a scripted board rather than a random one: a column
 * of two and two to gather, then a six-box snake of three and three, then the
 * script runs out, resets the score and hands over to the random feed. Dying
 * inside the script replays it; finishing it retires it for the page.
 *
 * What changed from the Haxe:
 *
 * - One press moved the chain as far as it could go. The cursors lived in an
 *   array that ugl's frame loop iterated while each new cursor appended to it,
 *   so the cursor made this frame updated inside the same frame and read the
 *   same still-held key, walking the chain through every box in that direction
 *   and gathering mid-walk. The chain is an explicit list here, the head is the
 *   only cursor that reads a key, and one press is one step.
 * - The shell owns the score, the title card and game over, so the score
 *   display, `Score`, and the accelerating scroll-away `finalupdate()` drew
 *   after a death are gone. The shake and the explosion the death fired stay,
 *   and the freeze-frame waits for them.
 * - The scroll read the chain's depth one frame late, off two fields the
 *   cursors wrote and the scene cleared. Frame one read them before any cursor
 *   had, at 0 and 0, and took the board down a fifth of a row in that single
 *   frame. It is measured off the chain here, on the frame it is used.
 * - The tray of held colours sat at the left of the Haxe's own score line and
 *   flew right into it. The shell's score is top left, so it sits under the bar
 *   and flies up into it.
 * - Undo waits for the pointer to lift, and a lift that turned out to be a
 *   swipe undoes nothing: b1 carries the click, and a press there starts every
 *   swipe, so undoing on the press as the Haxe did would unravel the chain
 *   before the swipe that moved it ever arrived. A key still undoes on press.
 * - ugl gave art and gfx one sprite between them and centred the union. Here
 *   each centres on its own box, so a box's pupils, which are finer than the
 *   4-unit art grid and have to be vectors, need `gfx.size()` to hold them on
 *   the body.
 * - The bar covers the top 21 units of the 480 box. The Haxe's own 50-unit
 *   masking strip, which is what the incoming row slides out from behind, is
 *   still there with the bar sitting inside it.
 */

import * as ent from "./lib/entity.js";
import { gameOver, mouse, score } from "./lib/one.js";
import * as sfxr from "./lib/sfxr.js";
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
  finishGood: false,
  date: "2014-04-15",
};

const BLACK = 0x000000;
const WHITE = 0xffffff;
// The corners of a box, which are a shade rather than the outline.
const SHADE = 0x444444;
const COLORS = [0xff6819, 0xc0dc61, 0x1ebed8, 0xfec804, 0xe284cc];

const COLS = 9;
const ROWS = 11;
// One cell, and the centre of cell (0, 0) with the board unscrolled.
const CELL = 38;
const X0 = 88;
const Y0 = 69;

// The shell's 44px bar in the 480 box, the line the board hangs from, the line
// it ends on, and the depth a cursor dies at.
const TOP = 21;
const HEAD = 50;
const FOOT = 468;
const DIE = 450;

// Top left of the tray of held colours, in the strip between bar and board.
const TRAY_X = 50;
const TRAY_Y = TOP + 2;
// How long the tray takes to fly into the bar, and how far past it it goes.
const FLY = 0.3;
const FLYUP = 20;

// Seconds from the last box crossing the line to the freeze-frame.
const DEATH = 0.35;
// A box takes this long to shrink into the chain, or out of existence.
const GROW = 0.3;
// How small a held box gets.
const HELD = 0.5;

// Rows a second at difficulty 0 is 5/CELL, an eighth of one. What makes the
// board move is the two multipliers below it.
const CRAWL = 5;
// Depth the scroll starts multiplying at, and how fast it climbs from there.
const NEAR = 240;
const NEARRATE = 9 / 70;
// The same again for the top of the chain, from higher up the board.
const HIGH = 122;
const HIGHRATE = 5 / 172;
// Difficulty is a flat ramp: this much a minute, for ever.
const RAMP = 0.4;
// Chance of a hole in an incoming row, which arrives with the difficulty and
// then stops growing. A dense board is the game; the holes are a mercy.
const HOLE = 0.04;

// A box. The outline is black, the corners a shade, and the two eye whites sit
// two pixels in with the pupils drawn over them.
const BODY = `
211111112
100000001
103303301
103303301
100000001
100000001
100000001
211111112`;

// The cursor: four corner brackets, one cell wide.
const BRACKET = `
100...001
0.......0
0.......0
.........
.........
.........
0.......0
0.......0
100...001`;

const _ = -1;

/*
 * The scripted opening, fed in from the end of the list, one row per shift. An
 * empty row means "say the next line and carry on with the row after it", and
 * running off the front of the list ends the script. The first five rows the
 * list gives up are the board the round starts on, so the column of two and
 * two is on screen from frame one.
 */
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

// Taken from the end, so the last line here is the first one said. The two the
// Haxe opened with are meta.desc's job now.
const NOTES = ["good luck", "two colours or more, same count"];

// ugl's Sound.vol() defaulted to 0.2, set masterVolume to twice that, and sfxr
// squares it. Gather never asked for anything else.
voice("move", sfxr.jump(12));
voice("gather", sfxr.explosion(25));
voice("score", sfxr.coin(12));
voice("over", sfxr.explosion(30));

function voice(name, params, vol = 0.2) {
  params.masterVolume = 2 * vol;
  sound.put(name, sfxr.render(params), sfxr.SAMPLE_RATE);
}

// grid[x][y] is a Piece or null. y grows downward; row 0 is the one the next
// shift pushes in and row ROWS-1 the one it drops.
const grid = [];
// How far the board has slid since the last shift, in (-CELL, 0].
let scroll = 0;
let difficulty = 0;
// The chain, oldest first. The last is the head, the only one a key moves; the
// first stands on an empty cell and is what an undo leaves behind.
let chain = [];
let tray = null;
let note = null;
let dying = 0;

// Where the script has got to. Both survive a round: the tutorial is once per
// page, unless the player died inside it.
let introAt = INTRO.length;
let noteAt = NOTES.length;

// A pointer press that has not turned into a swipe yet, so might still be the
// tap that undoes.
let tapping = false;

function cellX(x) {
  return X0 + CELL * x;
}

function cellY(y) {
  return scroll + Y0 + CELL * y;
}

// The box in a cell, or null. A cursor scrolls past the last row before it
// dies, so y is out of range for a frame.
function at(x, y) {
  return grid[x]?.[y] ?? null;
}

/*
 * A box. It shrinks to HELD while the chain holds it and to nothing when it
 * pops, and its pupils follow whatever `eye` is: a random point on the board,
 * the cursor when the cursor is next to it, and its own centre while held.
 */
class Piece extends ent.Entity {
  constructor(x, y, color) {
    super();
    this.px = x;
    this.py = y;
    this.color = color;
    this.targeted = false;
    this.popping = false;
    this.eye = { x: Math.random() * 480, y: Math.random() * 480 };
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

  // Out of the board at once, gone from the screen once it has shrunk.
  pop() {
    grid[this.px][this.py] = null;
    this.popping = true;
    this.targeted = false;
  }

  draw() {
    this.art.size(4, 9, 9).obj([COLORS[this.color], BLACK, SHADE, WHITE], BODY);

    // Half a pixel of travel towards whatever it is looking at. size() holds
    // the pupils on the art's own 36x36 box, which is what ugl got for free by
    // giving art and gfx one sprite.
    const dx = this.eye.x - this.pos.x;
    const dy = this.eye.y - this.pos.y;
    const d = Math.hypot(dx, dy);
    const tx = d === 0 ? 0 : dx / (2 * d);
    const ty = d === 0 ? 0 : dy / (2 * d);
    const eyey = Math.round(4 * (2.5 + ty)) - 18;
    this.gfx.clear().size(36, 36).fill(BLACK)
      .rect(Math.round(4 * (2.5 + tx)) - 18, eyey, 4, 4)
      .rect(Math.round(4 * (5.5 + tx)) - 18, eyey, 4, 4);
  }

  update() {
    // Roughly once every board's worth of box-frames, one box looks somewhere
    // else. Across a full board that is a glance every second or so.
    if (Math.random() < 1 / (10 * ROWS * COLS)) {
      this.see(Math.random() * 480, Math.random() * 480);
    }

    this.pos.x = cellX(this.px);
    this.pos.y = cellY(this.py);
    // Dropped out of the board a shift ago and now off the bottom of it.
    if (this.pos.y > 484) return this.remove();

    const step = ent.game.time / GROW;
    if (this.popping) {
      this.scale = Math.max(0, this.scale - step);
      this.draw();
      if (this.scale <= 0) this.remove();
      return;
    }

    if (this.targeted) {
      // Held boxes look straight ahead.
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

// One link of the chain. Red while it is the head, grey once the chain has
// moved past it. All it does on its own is ride the scroll.
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
    const cols = this.head ? [0xff6666, 0xff9999] : [0x666666, 0x999999];
    this.art.size(4, 9, 9).obj(cols, BRACKET);
  }

  update() {
    this.pos.x = cellX(this.px);
    this.pos.y = cellY(this.py);
  }
}

/*
 * What the chain is holding: one row per colour, longest first, one square per
 * box. It is the whole readout the win condition needs - equal rows, two of
 * them or more - and on a gather it flies up into the bar carrying the points.
 */
class Tray extends ent.Entity {
  constructor() {
    super();
    this.counts = null;
    this.moving = false;
    this.points = 0;
    this.from = TRAY_Y;
    this.pos.x = TRAY_X;
    this.pos.y = TRAY_Y;
  }

  set(counts) {
    this.counts = counts;
    const order = [0, 1, 2, 3, 4].sort((a, b) => counts[b] - counts[a]);

    this.gfx.clear().fill(BLACK);
    let row = 0;
    for (const i of order) {
      if (counts[i] === 0) continue;
      this.gfx.fill(COLORS[i]);
      for (let j = 0; j < counts[i]; ++j) this.gfx.rect(8 * j, 8 * row, 7, 7);
      row += 1;
    }

    // gfx centres on its own box and the tray hangs off its top left corner,
    // so the box has to be measured back out.
    this.pos.x = TRAY_X + (8 * Math.max(...counts) - 1) / 2;
    this.pos.y = TRAY_Y + (8 * row - 1) / 2;
    this.from = this.pos.y;
  }

  // Every colour held is equal by the time this is called, so the widest row
  // is also the count of each.
  go() {
    this.moving = true;
    this.ticks = 0;
    const kinds = this.counts.filter((c) => c > 0).length;
    const each = Math.max(...this.counts);
    this.points = kinds * each * (each - 1) * (kinds - 1) * (1 + difficulty);
  }

  update() {
    if (!this.moving) return;
    const t = this.ticks / FLY;
    // Into the bar, where the score is, accelerating as it goes.
    this.pos.y = this.from - (this.from + FLYUP) * t * t;
    this.alpha = Math.max(0, 1 - t * t);
    if (t <= 1) return;
    addScore(this.points);
    this.remove();
  }
}

/*
 * The white strip above the board and the one below it, which is what an
 * incoming row slides out from behind and a dropped one slides away under, plus
 * the two lines that bound the board. The lines fade downward off the top one
 * and upward off the bottom one.
 */
class Frame extends ent.Entity {
  constructor() {
    super();
    this.pos.x = this.pos.y = 240;
    this.gfx.fill(WHITE)
      .rect(0, 0, 480, HEAD)
      .rect(0, FOOT, 480, 480 - FOOT)
      .fill(null);
    for (const [d, alpha] of [[0, 1], [1, 0.25], [2, 0.12]]) {
      this.gfx.line(1, BLACK, alpha)
        .mt(50, HEAD + d).lt(420, HEAD + d)
        .mt(50, FOOT - d).lt(420, FOOT - d);
    }
  }
}

function addScore(v) {
  score.value += v;
  ent.shake(0.25);
  sound.play("score");
  new ent.Text()
    .text(`+${Math.floor(v)}`)
    .size(2)
    .color(BLACK)
    .xy(TRAY_X + 8, TRAY_Y + 8)
    .move(0, -30)
    .duration(0.5);
}

function say(m) {
  note?.remove();
  note = new ent.Text().xy(240, 450).size(2).color(BLACK).text(m).duration(5);
}

// The row the next shift pushes in, as colour indices and holes, or null once
// the board has nothing left to say.
function nextRow() {
  if (introAt < 0) {
    const row = [];
    const hole = Math.min(HOLE, difficulty / 10);
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

  // The script is over, and none of it counted: it hands out points a round
  // that had to find its own shapes would not.
  difficulty = 0;
  score.value = 0;
  return null;
}

// Everything down one cell: the boxes, the board they are indexed in, and the
// chain, so a cursor keeps hold of the box it was holding.
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

// The board comes down faster the higher the chain reaches: once past NEAR
// hard, and once the top of it passes HIGH harder again.
function advance(dt) {
  let low = 0;
  let high = 480;
  for (const c of chain) {
    const y = cellY(c.py);
    low = Math.max(low, y);
    high = Math.min(high, y);
  }

  let speed = CRAWL * (1 + difficulty);
  if (low < NEAR) speed *= 1 + NEARRATE * (NEAR - low);
  if (high < HIGH) speed *= 1 + HIGHRATE * (NEAR - high);
  difficulty += RAMP * dt / 60;

  scroll += speed * dt;
  if (scroll <= 0) return;
  scroll -= CELL;
  shift();
}

// Undo is a key press, and on a phone it is a tap. A press cannot be the
// signal there: b1 carries the click, so every swipe starts with one, and the
// chain would unravel before the swipe that moved it arrived.
function undoing() {
  if (mouse.click) tapping = true;
  if (mouse.swipe !== 0) tapping = false;
  if (mouse.release) {
    const tap = tapping;
    tapping = false;
    return tap;
  }
  return ent.game.key.just.b1 && !mouse.click;
}

// Drop the chain back to the cursor that started it, which is standing on an
// empty cell and takes the head back.
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

/*
 * What the chain is holding, and whether that is a gather: two colours or
 * more, at least two of each, and every colour present in the same number.
 */
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

  // The tray flies off with the points and an empty one takes its place.
  tray.go();
  tray = new Tray();
}

// One press, one step. An empty cell is a step only when the head is standing
// on one too, which is what keeps the chain unbroken and keeps the cursor that
// started it on a cell an undo can return to.
function control() {
  if (undoing()) undo();

  const head = chain.at(-1);
  const { key } = ent.game;
  const hx = cellX(head.px);
  const hy = cellY(head.py);
  at(head.px - 1, head.py)?.see(hx, hy);
  at(head.px + 1, head.py)?.see(hx, hy);
  at(head.px, head.py - 1)?.see(hx, hy);
  at(head.px, head.py + 1)?.see(hx, hy);

  let tx = head.px;
  let ty = head.py;
  if (key.just.up) ty -= 1;
  else if (key.just.down) ty += 1;
  else if (key.just.left) tx -= 1;
  else if (key.just.right) tx += 1;
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
  ent.reset();
  ent.world(480);
  ent.order([Piece, Cursor, Frame, Tray, ent.Text]);

  scroll = 0;
  difficulty = 0;
  dying = 0;
  note = null;
  tapping = false;
  // Dying inside the script replays it; finishing it left introAt at -1.
  introAt = introAt >= 0 ? INTRO.length : -1;
  noteAt = NOTES.length;

  grid.length = 0;
  for (let x = 0; x < COLS; ++x) grid.push(new Array(ROWS).fill(null));

  new Frame();
  tray = new Tray();

  // Frame one is the game: the first five rows of the script are the board it
  // opens on, not something that scrolls in.
  for (let y = 0; y < 5 && introAt >= 0; ++y) {
    const row = INTRO[--introAt];
    for (let x = 0; x < COLS; ++x) {
      if (row[x] === _) continue;
      grid[x][y] = new Piece(x, y, row[x]);
    }
  }

  chain = [new Cursor(4, 4)];
}

export function update(dt) {
  if (dying > 0) {
    dying -= dt;
    if (dying <= 0) return gameOver();
  } else {
    advance(dt);
    if (chain.some((c) => cellY(c.py) >= DIE)) die();
    else control();
  }
  ent.update(dt);
}

export function render(ctx) {
  ent.render(ctx);
}
