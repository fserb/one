/*
 * tower.
 *
 * A 7x10 board cut into regions, then shuffled. Every region held numbers 1..n
 * before the cut, so every number on the board is a clue about the size and
 * shape of the region it belongs to: a 7 means some region here is at least
 * seven cells across.
 *
 * Drag out a region and commit it. It is legal when it is orthogonally
 * connected and its numbers are exactly 1..n with nothing missing and nothing
 * twice. The board is full when every cell is in a committed region, and the
 * score is how many of those match a region the generator actually cut, which
 * is not the same thing: a board usually admits partitions the generator never
 * chose, and they are all still wins.
 *
 * Clicking a committed region takes it apart into the working set, so a wrong
 * partition is walked back rather than restarted.
 *
 * A region is drawn as one shape rather than a row of tiles: each cell fills
 * into the margin on the sides it has a neighbour on, and rounds off on the
 * sides it does not. Board colour goes over the corner first, so the rounding
 * cuts rather than covers.
 */

import { registerSquircle } from "./alma/src/index.js";
import { GridFiller } from "./lib/pgrid.js";
import { gameOver, hint, mouse, score, SIZE } from "./lib/one.js";

export const meta = {
  title: "tower",
  desc: `
drag out a region of 1..n
until the board is gone
`,
  bg: "#FFFFFF",
  fg: "#333333",
  scoreMax: true,
  date: "2025-08-27",
};

const WIDTH = 7;
const HEIGHT = 10;
const MARGIN = 12;

// The strip under the board, carrying the two buttons and the working set.
const STATUS_H = 120;
const PAD = 36;

// The cell is whatever fits the board once the strip and the padding are off
// it, which on a square is the height that binds: 7x10 is the taller way up.
const CELL = Math.min(
  (SIZE - 2 * PAD - (WIDTH - 1) * MARGIN) / WIDTH,
  (SIZE - 2 * PAD - STATUS_H - (HEIGHT - 1) * MARGIN) / HEIGHT,
);
const GRID_W = WIDTH * CELL + (WIDTH - 1) * MARGIN;
const GRID_H = HEIGHT * CELL + (HEIGHT - 1) * MARGIN;
const X0 = (SIZE - GRID_W) / 2;
const Y0 = PAD;

const STATUS_Y = Y0 + GRID_H + STATUS_H / 2;
const BTN_W = 170;
const BTN_H = 56;

const CELL_BG = "#F5F5F5";
const CELL_LINE = "#CCCCCC";
const HOVER_BG = "#EEEEEE";
const HOVER_LINE = "#999999";
const WORKING_BG = "#E6F3FF";
const INK = "#333333";
const DIM = "#666666";
const GOOD = "#2ECC71";
const BAD = "#E74C3C";
const BUTTON = "#4A90E2";

// A region's fill, one per committed region in order.
const REGION = [
  "#FF6B6B",
  "#4ECDC4",
  "#45B7D1",
  "#96CEB4",
  "#FECA57",
  "#FF9FF3",
  "#54A0FF",
  "#5F27CD",
  "#00D2D3",
  "#FF9F43",
  "#74B9FF",
  "#A29BFE",
  "#FD79A8",
  "#FDCB6E",
  "#6C5CE7",
];

const MIN_REGION = 4;
const MAX_REGION = 9;

/*
 * A region's fill is its colour a quarter of the way to the board, flattened
 * here rather than drawn as an alpha. The shape is filled in overlapping
 * passes, one per rounded corner, and a translucent fill would stack up darker
 * wherever two of them cross.
 */
function wash(hex, amount) {
  const c = parseInt(hex.slice(1), 16);
  const b = parseInt(meta.bg.slice(1), 16);
  let out = "#";
  for (let s = 16; s >= 0; s -= 8) {
    const v = (c >> s) & 255;
    const w = (b >> s) & 255;
    out += Math.round(w + (v - w) * amount).toString(16).padStart(2, "0");
  }
  return out;
}

const REGION_FILL = REGION.map((c) => wash(c, 0.25));

// The generator's cut: group id -> the cells in it and the numbers they carry.
let solution = new Map();
let grid = [];

// The cells being dragged into shape, and the regions already committed.
let working = [];
let committed = [];
let nextId = 0;

let hovered = null;
// "add" or "remove", fixed by the cell the drag started on, so one stroke does
// one thing and crossing a cell twice does not undo it.
let dragMode = null;
let dragLast = null;

function cellAt(x, y) {
  const col = Math.floor((x - X0) / (CELL + MARGIN));
  const row = Math.floor((y - Y0) / (CELL + MARGIN));
  if (row < 0 || row >= HEIGHT || col < 0 || col >= WIDTH) return null;
  return grid[row][col];
}

function cellX(x) {
  return X0 + x * (CELL + MARGIN);
}

function cellY(y) {
  return Y0 + y * (CELL + MARGIN);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function build() {
  const filler = new GridFiller(WIDTH, HEIGHT, {
    minSize: MIN_REGION,
    maxSize: MAX_REGION,
    maxCountPerSize: { 4: 5, 5: 4, 6: 3, 7: 3, 8: 2, 9: 2 },
    minCountPerSize: { 4: 2, 6: 2 },
  });
  filler.solve();

  solution = new Map();
  for (const [id, size] of filler.groups) {
    const cells = [];
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (filler.grid[y][x] === id) cells.push({ x, y });
      }
    }
    // 1..size, scattered over the region's cells: in order they would read as
    // a path and give the shape away.
    const numbers = shuffle(Array.from({ length: size }, (_, i) => i + 1));
    solution.set(id, { cells, size, numbers });
  }

  grid = Array.from({ length: HEIGHT }, () => new Array(WIDTH).fill(null));
  for (const [id, group] of solution) {
    group.cells.forEach(({ x, y }, i) => {
      grid[y][x] = {
        x,
        y,
        number: group.numbers[i],
        groupId: id,
        isSelected: false,
        isCommitted: false,
        committedId: -1,
      };
    });
  }
}

// Orthogonally connected, and the numbers exactly 1..n.
function isValid(group) {
  if (group.length < MIN_REGION || group.length > MAX_REGION) return false;

  const numbers = group.map((c) => c.number).sort((a, b) => a - b);
  for (let i = 0; i < numbers.length; i++) {
    if (numbers[i] !== i + 1) return false;
  }

  const key = (c) => c.x + c.y * WIDTH;
  const inGroup = new Map(group.map((c) => [key(c), c]));
  const seen = new Set([key(group[0])]);
  const queue = [group[0]];

  while (queue.length > 0) {
    const c = queue.shift();
    // x is bounds-checked rather than left to the index: x - 1 off the left
    // edge lands on the previous row's right edge, which is not a neighbour.
    const around = [
      c.x > 0 ? key({ x: c.x - 1, y: c.y }) : -1,
      c.x < WIDTH - 1 ? key({ x: c.x + 1, y: c.y }) : -1,
      c.y > 0 ? key({ x: c.x, y: c.y - 1 }) : -1,
      c.y < HEIGHT - 1 ? key({ x: c.x, y: c.y + 1 }) : -1,
    ];
    for (const k of around) {
      if (k === -1 || seen.has(k) || !inGroup.has(k)) continue;
      seen.add(k);
      queue.push(inGroup.get(k));
    }
  }

  return seen.size === group.length;
}

// The generator's group id this region reproduces, or 0 for none. Sizes match
// and every one of the generator's cells is in the region, so cell-for-cell.
function originalOf(group) {
  for (const [id, s] of solution) {
    if (s.size !== group.length) continue;
    const same = s.cells.every((sc) =>
      group.some((c) => c.x === sc.x && c.y === sc.y)
    );
    if (same) return id;
  }
  return 0;
}

function clearWorking() {
  for (const c of working) c.isSelected = false;
  working = [];
}

function commit() {
  if (!isValid(working)) return false;

  const region = {
    cells: [...working],
    original: originalOf(working),
    color: committed.length % REGION.length,
    id: nextId++,
  };

  for (const c of working) {
    c.isSelected = false;
    c.isCommitted = true;
    c.committedId = region.id;
  }
  committed.push(region);
  working = [];

  let full = 0;
  for (const row of grid) {
    for (const c of row) {
      if (c?.isCommitted) full++;
    }
  }
  if (full === WIDTH * HEIGHT) {
    score.value = committed.filter((r) => r.original !== 0).length;
    gameOver({ win: true, score: true });
  }

  return true;
}

// Back into the working set, so a wrong partition is taken apart in place.
function decommit(region) {
  committed.splice(committed.indexOf(region), 1);
  clearWorking();

  for (const rc of region.cells) {
    const c = grid[rc.y][rc.x];
    c.isSelected = true;
    c.isCommitted = false;
    c.committedId = -1;
    working.push(c);
  }
}

function toggle(cell) {
  if (cell.isCommitted) {
    const region = committed.find((r) => r.id === cell.committedId);
    if (!region) return;
    // The working set is banked first when it is legal, and dropped when it is
    // not: two half-built regions at once has no meaning.
    if (working.length > 0 && !commit()) clearWorking();
    decommit(region);
    return;
  }

  const i = working.indexOf(cell);
  if (i !== -1) {
    working.splice(i, 1);
    cell.isSelected = false;
    return;
  }

  working.push(cell);
  cell.isSelected = true;
}

function inBox(x, y, bx, by, bw, bh) {
  return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
}

function clearBtn() {
  return { x: X0, y: STATUS_Y - BTN_H / 2, w: BTN_W, h: BTN_H };
}

function commitBtn() {
  return {
    x: X0 + GRID_W - BTN_W,
    y: STATUS_Y - BTN_H / 2,
    w: BTN_W,
    h: BTN_H,
  };
}

function click(x, y) {
  if (working.length > 0) {
    const b = clearBtn();
    if (inBox(x, y, b.x, b.y, b.w, b.h)) {
      clearWorking();
      return;
    }
  }

  if (working.length > 0 && isValid(working)) {
    const b = commitBtn();
    if (inBox(x, y, b.x, b.y, b.w, b.h)) {
      commit();
      return;
    }
  }

  const cell = cellAt(x, y);
  if (cell) toggle(cell);
}

export function init() {
  registerSquircle();
  hint(meta.desc);

  working = [];
  committed = [];
  nextId = 0;
  hovered = null;
  dragMode = null;
  dragLast = null;
  score.value = 0;

  build();
}

export function update() {
  hovered = cellAt(mouse.x, mouse.y);

  if (mouse.click) {
    if (hovered && !hovered.isCommitted) {
      dragMode = hovered.isSelected ? "remove" : "add";
    }
    click(mouse.x, mouse.y);
    dragLast = hovered;
  }

  if (mouse.press && dragMode && hovered && hovered !== dragLast) {
    dragLast = hovered;
    if (!hovered.isCommitted) {
      if (dragMode === "add" && !hovered.isSelected) {
        working.push(hovered);
        hovered.isSelected = true;
      } else if (dragMode === "remove" && hovered.isSelected) {
        working.splice(working.indexOf(hovered), 1);
        hovered.isSelected = false;
      }
    }
  }

  if (!mouse.press) {
    dragMode = null;
    dragLast = null;
  }
}

/*
 * One cell of a region. It fills into half the margin on every side it has a
 * neighbour on, which is what joins the cells into one shape, and rounds the
 * corners where neither of the two sides meeting there is connected.
 *
 * A corner is cut, not covered: board colour goes down over the corner square
 * first, then a full-cell squircle is filled through it. The squircle covers
 * the rest of the cell again, which is why the fill has to be opaque.
 */
function regionCell(ctx, cell, set, fill) {
  const half = MARGIN / 2;
  const r = CELL * 0.5;

  const hasLeft = cell.x > 0 && set.has(cell.x - 1 + cell.y * WIDTH);
  const hasRight = cell.x < WIDTH - 1 && set.has(cell.x + 1 + cell.y * WIDTH);
  const hasUp = cell.y > 0 && set.has(cell.x + (cell.y - 1) * WIDTH);
  const hasDown = cell.y < HEIGHT - 1 &&
    set.has(cell.x + (cell.y + 1) * WIDTH);

  const x = cellX(cell.x) - (hasLeft ? half : 0);
  const y = cellY(cell.y) - (hasUp ? half : 0);
  const w = CELL + (hasLeft ? half : 0) + (hasRight ? half : 0);
  const h = CELL + (hasUp ? half : 0) + (hasDown ? half : 0);

  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);

  const corners = [
    [!hasLeft && !hasUp, x, y],
    [!hasRight && !hasUp, x + w - r, y],
    [!hasRight && !hasDown, x + w - r, y + h - r],
    [!hasLeft && !hasDown, x, y + h - r],
  ];

  for (const [cut, cx, cy] of corners) {
    if (!cut) continue;
    ctx.fillStyle = meta.bg;
    ctx.fillRect(cx, cy, r, r);
    ctx.fillStyle = fill;
    // The squircle is a whole cell, placed so the corner it rounds is the one
    // just painted over.
    ctx.squircle(
      cx === x ? x : cx - r,
      cy === y ? y : cy - r,
      r * 2,
      r * 2,
      r,
      2,
    );
    ctx.fill();
  }
}

function regionArea(ctx, cells, fill) {
  if (cells.length === 0) return;
  const set = new Set(cells.map((c) => c.x + c.y * WIDTH));
  for (const c of cells) regionCell(ctx, c, set, fill);
}

function button(ctx, text, b) {
  ctx.fillStyle = BUTTON;
  ctx.squircle(b.x, b.y, b.w, b.h, 14, 2);
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.text(text, b.x + b.w / 2, b.y + b.h / 2, 22);
}

export function render(ctx) {
  regionArea(ctx, working, WORKING_BG);
  for (const r of committed) regionArea(ctx, r.cells, REGION_FILL[r.color]);

  for (const row of grid) {
    for (const cell of row) {
      if (!cell) continue;
      const x = cellX(cell.x);
      const y = cellY(cell.y);

      // A cell in a region already has its background from regionArea().
      if (!cell.isSelected && !cell.isCommitted) {
        const on = cell === hovered;
        ctx.fillStyle = on ? HOVER_BG : CELL_BG;
        ctx.squircle(x, y, CELL, CELL, CELL * 0.5, 2);
        ctx.fill();
        ctx.strokeStyle = on ? HOVER_LINE : CELL_LINE;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.fillStyle = INK;
      ctx.text(`${cell.number}`, x + CELL / 2, y + CELL / 2, CELL * 0.4);
    }
  }

  if (working.length === 0) {
    ctx.fillStyle = DIM;
    ctx.text("drag cells into a region", SIZE / 2, STATUS_Y, 22);
    return;
  }

  const valid = isValid(working);
  button(ctx, "clear", clearBtn());
  if (valid) button(ctx, "commit", commitBtn());

  const numbers = working.map((c) => c.number).sort((a, b) => a - b);
  ctx.fillStyle = valid ? GOOD : BAD;
  ctx.text(`[${numbers.join(", ")}]`, SIZE / 2, STATUS_Y - 12, 24);
  if (valid) {
    ctx.fillStyle = GOOD;
    ctx.text("a region", SIZE / 2, STATUS_Y + 18, 18);
  }
}
