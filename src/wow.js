/*
 * wow - a 3x4 sliding puzzle. Based on ZOT.
 * https://www.cs.brandeis.edu/~storer/JimPuzzles/ZPAGES/zzzBullsEye.html
 */

import { ease, utils } from "./alma/src/index.js";
import { act, gameOver, mouse, score, SIZE } from "./lib/one.js";

export const meta = {
  title: "wow",
  desc: `
move the small circle
inside the bigger circle
`,
  bg: "#B8B5B9",
  fg: "#4B4158",
  scoreMax: false,
  date: "2021-05-08",
};

const PAPER = "#EDE19E";
const GREEN = "#8AB060";
const SHADOW = "#352B42";

const COLS = 3;
const ROWS = 4;
const TILE = 234;
// The art is drawn at 2x and downsampled by drawImage.
const ART = TILE * 2;

let pieces;
let empty;
let tiles;
let ox, oy;

function drawTiles() {
  const [canvas, c] = utils.newCanvas(COLS * ART, ROWS * ART);
  const cx = COLS * ART / 2;
  const r = 50;

  c.fillStyle = PAPER;
  c.fillRect(0, 0, COLS * ART, ROWS * ART);

  // The big target circle, straddling the bottom six tiles.
  c.fillStyle = meta.fg;
  c.fillCircle(cx, 1170, 600);
  c.fillStyle = GREEN;
  c.fillCircle(cx, 1170, 600 - r);
  c.fillStyle = meta.fg;
  c.fillCircle(cx, 1170, 600 - r * 2);
  c.fillStyle = PAPER;
  c.fillCircle(cx, 1170, 600 - r * 3);

  // The small circle that has to end up inside it.
  c.fillStyle = meta.fg;
  c.fillCircle(cx, 234, 150);
  c.fillStyle = GREEN;
  c.fillCircle(cx, 234, 150 - r);
  c.fillStyle = meta.fg;
  c.fillCircle(cx, 234, 150 - r * 2);

  c.fillStyle = meta.fg;
  c.text("W", 234, 265, 350);
  c.text("W", 468 * 2 + 234, 265, 350);

  return canvas;
}

export function init() {
  empty = { x: 1, y: 2 };
  pieces = [];

  for (let y = 0; y < ROWS; ++y) {
    for (let x = 0; x < COLS; ++x) {
      if (y === 2 && x === 1) continue;
      const p = x + y * COLS;
      const piece = {
        x,
        y,
        gx: x,
        gy: y,
        px: p % COLS,
        py: Math.floor(p / COLS),
        goal: true,
      };

      // The two W tiles read the same either way round.
      if (y === 0 && x !== 1) piece.goal = false;
      // The small circle has to travel down into the big one.
      if (x === 1 && y === 0) piece.gy = 2;

      pieces.push(piece);
    }
  }

  tiles = drawTiles();
  ox = (SIZE - COLS * TILE) / 2;
  oy = SIZE - ROWS * TILE - 28;
}

function check() {
  for (const p of pieces) {
    if (!p.goal) continue;
    if (p.x !== p.gx || p.y !== p.gy) return;
  }
  gameOver({ win: true, score: true });
}

export function update() {
  if (!mouse.click) return;

  const px = Math.floor((mouse.x - ox) / TILE);
  const py = Math.floor((mouse.y - oy) / TILE);

  // Only the four tiles orthogonally touching the hole can move.
  if (Math.abs(empty.x - px) + Math.abs(empty.y - py) !== 1) return;

  const target = pieces.find((p) => p.x === px && p.y === py);
  if (!target) return;

  score.value += 1;

  act(target)
    .attr("x", empty.x, 0.3, ease.fastOutSlowIn)
    .attr("y", empty.y, 0.3, ease.fastOutSlowIn)
    .then(check);

  empty.x = px;
  empty.y = py;
}

export function render(ctx) {
  const s = 15;
  ctx.fillStyle = SHADOW;
  for (const p of pieces) {
    ctx.fillRect(ox + p.x * TILE + s, oy + p.y * TILE + s, TILE, TILE);
  }

  for (const p of pieces) {
    ctx.drawImage(
      tiles,
      p.px * ART,
      p.py * ART,
      ART,
      ART,
      ox + p.x * TILE,
      oy + p.y * TILE,
      TILE,
      TILE,
    );
  }
}
